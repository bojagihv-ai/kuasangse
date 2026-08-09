const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const WORKSPACE_PERSISTENCE = path.resolve(__dirname, '../../src/modules/workspace-persistence.mjs');
const SESSION_ADAPTER = path.resolve(__dirname, '../../src/modules/persistence/session-storage-adapter.mjs');
const FENCING = path.resolve(__dirname, '../../src/modules/persistence/fencing.mjs');

async function load(name) {
  const source = name === 'workspace'
    ? WORKSPACE_PERSISTENCE
    : name === 'fencing'
      ? FENCING
      : SESSION_ADAPTER;
  return import(`${pathToFileURL(source).href}?session-recovery=${Date.now()}-${Math.random()}`);
}

function storage(values) {
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function passiveAdapter(writes) {
  return {
    async read() { return null; },
    async write(envelope) {
      writes.push(structuredClone(envelope));
      return envelope;
    },
  };
}

function authorityAt(revision = 9, {
  scopeId = 'project:alpha',
  leaseId = 'live-lease',
  fencingToken = 7,
  mode = 'editing',
} = {}) {
  let current = {
    scopeId,
    leaseId,
    fencingToken,
    revision,
    mode,
  };
  let queue = Promise.resolve();
  return {
    snapshot: () => current,
    observeRevision(nextRevision) { current = { ...current, revision: nextRevision }; },
    runMutation(operation) {
      const running = queue.then(operation);
      queue = running.catch(() => undefined);
      return running;
    },
  };
}

function existingSession({
  scopeId = 'project:alpha',
  leaseId = 'live-lease',
  fencingToken = '7',
  revision = 10,
  value = 'old-tab-session',
} = {}) {
  const persistenceEnvelope = {
    schema: 'kuasangse.workspace',
    version: 2,
    scopeId,
    savedAt: 10,
    digest: `digest:${value}`,
    metadata: {
      operationId: `operation:${value}`,
      leaseId,
      fencingToken,
      revision: { scopeId, counter: revision, updatedAt: 10, writerId: 'prior-tab' },
    },
    snapshot: { currentProjectId: 'alpha', workspaceScope: { id: scopeId }, value },
  };
  return JSON.stringify({
    ...persistenceEnvelope.snapshot,
    workspaceScope: { id: scopeId },
    workspaceRevision: persistenceEnvelope.metadata.revision,
    persistenceEnvelope,
  });
}

function existingBootstrap({
  scopeId = 'project:alpha',
  leaseId = 'live-lease',
  fencingToken = '7',
  revision = 10,
  value = 'old-tab-bootstrap',
} = {}) {
  return JSON.stringify({
    schema: 'kuasangse.recovery.v1',
    value: JSON.stringify({
      workspaceScope: { id: scopeId },
      currentProjectId: scopeId.replace(/^project:/, ''),
      currentProjectName: value,
    }),
    persistenceAuthority: {
      scopeId,
      leaseId,
      fencingToken,
      revision,
      operationId: `operation:${value}`,
      digest: `digest:${value}`,
    },
  });
}

async function commitAfterReload({
  existingLeaseId = 'live-lease',
  existingRevision = 10,
  writeBootstrap = false,
} = {}) {
  const [{ createWorkspacePersistence }, { createSessionStorageAdapter }] = await Promise.all([
    load('workspace'),
    load('session'),
  ]);
  const tabValues = new Map([['pdp_session', existingSession({
    leaseId: existingLeaseId,
    revision: existingRevision,
  })]]);
  if (writeBootstrap) {
    tabValues.set('pdp_last_work_bootstrap_v1', existingBootstrap({
      leaseId: existingLeaseId,
      revision: existingRevision,
    }));
  }
  const authority = authorityAt();
  const serverWrites = [];
  const indexedDbWrites = [];
  const adapters = {
    session: createSessionStorageAdapter({
      storage: storage(new Map()),
      draftStorage: storage(tabValues),
      authority,
    }),
    indexeddb: passiveAdapter(indexedDbWrites),
    server: passiveAdapter(serverWrites),
    workfile: passiveAdapter([]),
    archive: passiveAdapter([]),
  };
  const gateway = createWorkspacePersistence({ adapters, authority });
  const result = await gateway.commit({
    scopeId: 'project:alpha',
    snapshot: {
      currentProjectId: 'alpha',
      workspaceScope: { id: 'project:alpha' },
      value: 'field-confirmed',
    },
    metadata: {
      operationId: 'operation:field-confirmed',
      leaseId: 'live-lease',
      fencingToken: '7',
      revision: {
        scopeId: 'project:alpha', counter: 10, updatedAt: 11, writerId: 'fresh-tab',
      },
    },
    replicas: ['session'],
    rebaseRevision: true,
    context: writeBootstrap ? { session: { writeBootstrap: true } } : undefined,
  });
  return { authority, result, serverWrites, indexedDbWrites, tabValues };
}

test('Ctrl+F5 뒤 같은 편집권의 같은 revision 세션 복구본은 서버 승인된 필수값 저장으로 교체된다', async () => {
  const { authority, result, serverWrites, tabValues } = await commitAfterReload();

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.equal(serverWrites.at(-1).metadata.revision.counter, 10);
  assert.equal(authority.snapshot().revision, 10);
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
});

test('Ctrl+F5 뒤 같은 revision bootstrap pointer도 현재 필수값 저장을 막지 않는다', async () => {
  const { result, tabValues } = await commitAfterReload({ writeBootstrap: true });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
  const bootstrap = JSON.parse(JSON.parse(tabValues.get('pdp_last_work_bootstrap_v1')).value);
  assert.equal(bootstrap.workspaceScope.id, 'project:alpha');
  assert.equal(bootstrap.workspaceRevision.counter, 10);
});

test('같은 revision이라도 다른 lease의 세션 복구본은 서버 승인 뒤에도 덮어쓰지 않는다', async () => {
  const { result, tabValues } = await commitAfterReload({ existingLeaseId: 'different-lease' });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, false, JSON.stringify(result));
  assert.equal(result.partial, true, JSON.stringify(result));
  assert.match(result.failures[0]?.message || '', /lease differs/);
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'old-tab-session',
  );
});

test('project 편집권의 더 최신 세션 복구본은 새 revision으로 전체 저장을 다시 실행한다', async () => {
  const { authority, result, serverWrites, indexedDbWrites, tabValues } = await commitAfterReload({
    existingRevision: 12,
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.equal(result.envelope.metadata.revision.counter, 13);
  assert.deepEqual(serverWrites.map(item => item.metadata.revision.counter), [10, 13]);
  assert.deepEqual(indexedDbWrites.map(item => item.metadata.revision.counter), [10, 13]);
  assert.equal(authority.snapshot().revision, 13);
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
});

test('같은 offline draft authority의 같은 revision 세션은 현재 필수값으로 안전하게 갱신한다', async () => {
  const [{ createWorkspacePersistence }, { createSessionStorageAdapter }] = await Promise.all([
    load('workspace'),
    load('session'),
  ]);
  const scopeId = 'draft:field-same-revision';
  const tabValues = new Map([['pdp_session', existingSession({
    scopeId,
    leaseId: '',
    fencingToken: '',
    revision: 11,
    value: 'before-field-confirm',
  })]]);
  const authority = authorityAt(10, {
    scopeId,
    leaseId: '',
    fencingToken: 0,
    mode: 'offline-edit',
  });
  const indexedDbWrites = [];
  const sessionContexts = [];
  const sessionAdapter = createSessionStorageAdapter({
    storage: storage(new Map()),
    draftStorage: storage(tabValues),
    authority,
  });
  const adapters = {
    session: {
      ...sessionAdapter,
      async write(envelope, context) {
        sessionContexts.push(context || {});
        return sessionAdapter.write(envelope, context);
      },
    },
    indexeddb: passiveAdapter(indexedDbWrites),
    server: passiveAdapter([]),
    workfile: passiveAdapter([]),
    archive: passiveAdapter([]),
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    scopeId,
    snapshot: {
      currentProjectId: '',
      workspaceScope: { id: scopeId },
      value: 'field-confirmed',
    },
    metadata: {
      operationId: 'operation:field-same-revision-draft',
      leaseId: '',
      fencingToken: '',
      revision: {
        scopeId, counter: 1, updatedAt: 11, writerId: 'fresh-tab',
      },
    },
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(sessionContexts.at(-1)?.allowSameRevisionMutation, true, JSON.stringify(sessionContexts));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.equal(result.envelope.metadata.revision.counter, 11);
  assert.deepEqual(indexedDbWrites.map(item => item.metadata.revision.counter), [11]);
  assert.equal(authority.snapshot().revision, 11);
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
});

test('같은 offline draft authority는 같은 revision IndexedDB 복원본도 현재 필수값으로 안전하게 갱신한다', async () => {
  const [
    { createWorkspacePersistence },
    { createSessionStorageAdapter },
    { assertReplicaCanPublish },
  ] = await Promise.all([
    load('workspace'),
    load('session'),
    load('fencing'),
  ]);
  const scopeId = 'draft:indexeddb-same-revision';
  const existing = JSON.parse(existingSession({
    scopeId,
    leaseId: '',
    fencingToken: '',
    revision: 11,
    value: 'before-field-confirm',
  })).persistenceEnvelope;
  let indexedDbCurrent = structuredClone(existing);
  const indexedDbContexts = [];
  const authority = authorityAt(10, {
    scopeId,
    leaseId: '',
    fencingToken: 0,
    mode: 'offline-edit',
  });
  const tabValues = new Map([['pdp_session', existingSession({
    scopeId,
    leaseId: '',
    fencingToken: '',
    revision: 11,
    value: 'before-field-confirm',
  })]]);
  const adapters = {
    session: createSessionStorageAdapter({
      storage: storage(new Map()),
      draftStorage: storage(tabValues),
      authority,
    }),
    indexeddb: {
      async read() { return null; },
      async write(envelope, context = {}) {
        indexedDbContexts.push(context);
        assertReplicaCanPublish(indexedDbCurrent, envelope, {
          allowSameRevisionMutation: context.allowSameRevisionMutation === true,
        });
        indexedDbCurrent = structuredClone(envelope);
        return envelope;
      },
    },
    server: passiveAdapter([]),
    workfile: passiveAdapter([]),
    archive: passiveAdapter([]),
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    scopeId,
    snapshot: {
      currentProjectId: '',
      workspaceScope: { id: scopeId },
      value: 'field-confirmed',
    },
    metadata: {
      operationId: 'operation:field-same-revision-indexeddb-draft',
      leaseId: '',
      fencingToken: '',
      revision: {
        scopeId, counter: 1, updatedAt: 11, writerId: 'fresh-tab',
      },
    },
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.equal(indexedDbContexts.at(-1)?.allowSameRevisionMutation, true, JSON.stringify(indexedDbContexts));
  assert.equal(indexedDbCurrent.snapshot.value, 'field-confirmed');
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
});

test('저장된 작업파일의 탭 초안은 같은 revision session 복구본을 현재 필수값으로 갱신한다', async () => {
  const [{ createWorkspacePersistence }, { createSessionStorageAdapter }] = await Promise.all([
    load('workspace'),
    load('session'),
  ]);
  const scopeId = 'draft:alpha-tab';
  const tabValues = new Map([['pdp_session', existingSession({
    scopeId,
    leaseId: '',
    fencingToken: '',
    revision: 11,
    value: 'before-field-confirm',
  })]]);
  const authority = authorityAt(10, {
    scopeId: 'project:alpha',
    leaseId: 'project-lease',
    fencingToken: 7,
    mode: 'editing',
  });
  const indexedDbWrites = [];
  const adapters = {
    session: createSessionStorageAdapter({
      storage: storage(new Map()),
      draftStorage: storage(tabValues),
      authority,
    }),
    indexeddb: passiveAdapter(indexedDbWrites),
    server: passiveAdapter([]),
    workfile: passiveAdapter([]),
    archive: passiveAdapter([]),
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    scopeId,
    snapshot: {
      currentProjectId: 'alpha',
      workspaceScope: { id: scopeId },
      workspaceBranch: {
        schema: 'kuasangse.work-branch.v1',
        branchId: 'alpha-tab',
        scopeId,
        documentId: 'alpha',
        documentScopeId: 'project:alpha',
        createdAt: 0,
      },
      value: 'field-confirmed',
    },
    metadata: {
      operationId: 'operation:field-same-revision-linked-draft',
      leaseId: '',
      fencingToken: '',
      revision: {
        scopeId, counter: 11, updatedAt: 11, writerId: 'fresh-tab',
      },
    },
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.deepEqual(indexedDbWrites.map(item => item.metadata.revision.counter), [11]);
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
});

test('저장된 작업파일의 탭 초안의 더 최신 세션은 현재 필수값 저장 안에서 재기준화해 즉시 교체한다', async () => {
  const [{ createWorkspacePersistence }, { createSessionStorageAdapter }] = await Promise.all([
    load('workspace'),
    load('session'),
  ]);
  const scopeId = 'draft:alpha-tab-recovery';
  const tabValues = new Map([['pdp_session', existingSession({
    scopeId,
    leaseId: '',
    fencingToken: '',
    revision: 12,
    value: 'before-field-confirm',
  })]]);
  const authority = authorityAt(10, {
    scopeId: 'project:alpha',
    leaseId: 'project-lease',
    fencingToken: 7,
    mode: 'editing',
  });
  const indexedDbWrites = [];
  const adapters = {
    session: createSessionStorageAdapter({
      storage: storage(new Map()),
      draftStorage: storage(tabValues),
      authority,
    }),
    indexeddb: passiveAdapter(indexedDbWrites),
    server: passiveAdapter([]),
    workfile: passiveAdapter([]),
    archive: passiveAdapter([]),
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    scopeId,
    snapshot: {
      currentProjectId: 'alpha',
      workspaceScope: { id: scopeId },
      workspaceBranch: {
        schema: 'kuasangse.work-branch.v1',
        branchId: 'alpha-tab-recovery',
        scopeId,
        documentId: 'alpha',
        documentScopeId: 'project:alpha',
        createdAt: 0,
      },
      value: 'field-confirmed',
    },
    metadata: {
      operationId: 'operation:field-newer-revision-linked-draft',
      leaseId: '',
      fencingToken: '',
      revision: {
        scopeId, counter: 11, updatedAt: 11, writerId: 'fresh-tab',
      },
    },
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.equal(result.envelope.metadata.revision.counter, 13);
  assert.deepEqual(indexedDbWrites.map(item => item.metadata.revision.counter), [11, 13]);
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
});

test('오프라인 초안의 더 최신 탭 세션은 첫 필수값 저장 안에서 재기준화해 즉시 교체한다', async () => {
  const [{ createWorkspacePersistence }, { createSessionStorageAdapter }] = await Promise.all([
    load('workspace'),
    load('session'),
  ]);
  const scopeId = 'draft:field-recovery';
  const tabValues = new Map([['pdp_session', existingSession({
    scopeId,
    leaseId: '',
    fencingToken: '',
    revision: 12,
    value: 'before-field-confirm',
  })]]);
  const authority = authorityAt(10, {
    scopeId,
    leaseId: '',
    fencingToken: 0,
    mode: 'offline-edit',
  });
  const indexedDbWrites = [];
  const adapters = {
    session: createSessionStorageAdapter({
      storage: storage(new Map()),
      draftStorage: storage(tabValues),
      authority,
    }),
    indexeddb: passiveAdapter(indexedDbWrites),
    server: passiveAdapter([]),
    workfile: passiveAdapter([]),
    archive: passiveAdapter([]),
  };
  const gateway = createWorkspacePersistence({ adapters, authority });

  const result = await gateway.commit({
    scopeId,
    snapshot: {
      currentProjectId: '',
      workspaceScope: { id: scopeId },
      value: 'field-confirmed',
    },
    metadata: {
      operationId: 'operation:field-confirmed-draft',
      leaseId: '',
      fencingToken: '',
      revision: {
        scopeId, counter: 11, updatedAt: 11, writerId: 'fresh-tab',
      },
    },
    replicas: ['session'],
    rebaseRevision: true,
  });

  assert.equal(result.accepted, true, JSON.stringify(result));
  assert.equal(result.clean, true, JSON.stringify(result));
  assert.equal(result.partial, false, JSON.stringify(result));
  assert.equal(result.envelope.metadata.revision.counter, 13);
  assert.deepEqual(indexedDbWrites.map(item => item.metadata.revision.counter), [11, 13]);
  assert.equal(authority.snapshot().revision, 13);
  assert.equal(
    JSON.parse(tabValues.get('pdp_session')).persistenceEnvelope.snapshot.value,
    'field-confirmed',
  );
});
