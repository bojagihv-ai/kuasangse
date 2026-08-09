const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const CONTRACTS = path.resolve(__dirname, '../../src/modules/persistence/contracts.mjs');
const ORCHESTRATOR = path.resolve(__dirname, '../../src/modules/workspace-persistence-orchestrator.mjs');

async function loadContracts() {
  return import(`${pathToFileURL(CONTRACTS).href}?identity=${Date.now()}-${Math.random()}`);
}

test('Given a persisted work has conflicting product identities When validated Then the whole snapshot is rejected', async () => {
  const { validateWorkspaceSnapshotIdentity } = await loadContracts();
  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'project-needle-case',
    workspaceScope: { id: 'project:project-needle-case' },
    productName: '양단호박바늘쌈',
    factory: {
      currentProjectId: 'project-needle-case',
      workspace: { id: 'project-needle-case' },
      product: {
        userProductName: '롱카드지갑',
        productName: '롱카드지갑',
        productKey: '롱카드지갑',
        lockedInputImageFingerprint: '4784892:/9j/4US4RX',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_IDENTITY_PRODUCT_CONFLICT');
});

test('Given a persisted work has conflicting project scopes When validated Then the whole snapshot is rejected', async () => {
  const { validateWorkspaceSnapshotIdentity } = await loadContracts();
  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    workspaceScope: { id: 'project:needle-case' },
    productName: '양단호박바늘쌈',
    factory: {
      currentProjectId: 'wallet',
      workspace: { id: 'wallet' },
      product: { productName: '양단호박바늘쌈' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_IDENTITY_SCOPE_CONFLICT');
});

test('Given an immutable identity belongs to another workfile When validated Then the snapshot is rejected', async () => {
  const { createWorkspaceWorkIdentity, validateWorkspaceSnapshotIdentity } = await loadContracts();
  const identity = createWorkspaceWorkIdentity({
    instanceId: 'work-needle-case',
    workspaceId: 'project:needle-case',
    initialProductName: '양단호박바늘쌈',
    initialInputImageFingerprint: '4526768:/9j/4UIURX',
    createdAt: 100,
  });

  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'wallet',
    workspaceScope: { id: 'project:wallet' },
    productName: '양단호박바늘쌈',
    inputImageFingerprint: '4526768:/9j/4UIURX',
    workIdentity: identity,
    factory: {
      currentProjectId: 'wallet',
      workspace: { id: 'wallet' },
      workIdentity: identity,
      product: {
        productName: '양단호박바늘쌈',
        userProductName: '양단호박바늘쌈',
        lockedInputImageFingerprint: '4526768:/9j/4UIURX',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_IDENTITY_SCOPE_BINDING_CONFLICT');
});

test('Given two workfiles have different immutable instance ids When compared Then they can never merge', async () => {
  const { createWorkspaceWorkIdentity, workspaceWorkIdentitiesMatch } = await loadContracts();
  const needleCase = createWorkspaceWorkIdentity({
    instanceId: 'work-needle-case',
    workspaceId: 'needle-case',
    initialProductName: '양단호박바늘쌈',
    initialInputImageFingerprint: '4526768:/9j/4UIURX',
    createdAt: 100,
  });
  const wallet = createWorkspaceWorkIdentity({
    instanceId: 'work-wallet',
    workspaceId: 'wallet',
    initialProductName: '롱카드지갑',
    initialInputImageFingerprint: '4784892:/9j/4US4RX',
    createdAt: 200,
  });

  assert.equal(workspaceWorkIdentitiesMatch(needleCase, wallet), false);
  assert.equal(workspaceWorkIdentitiesMatch(needleCase, { ...needleCase }), true);
});

test('Given one immutable identity changes its original image fingerprint When compared Then the source is rejected', async () => {
  const { createWorkspaceWorkIdentity, workspaceWorkIdentitiesMatch } = await loadContracts();
  const original = createWorkspaceWorkIdentity({
    instanceId: 'work-needle-case',
    workspaceId: 'needle-case',
    initialProductName: '양단호박바늘쌈',
    initialInputImageFingerprint: '4526768:/9j/4UIURX',
    createdAt: 100,
  });
  const forged = { ...original, initialInputImageFingerprint: '4784892:/9j/4US4RX' };

  assert.equal(workspaceWorkIdentitiesMatch(original, forged), false);
});

test('Given a snapshot carries an immutable needle-case identity over a wallet image When validated Then it is rejected', async () => {
  const { createWorkspaceWorkIdentity, validateWorkspaceSnapshotIdentity } = await loadContracts();
  const identity = createWorkspaceWorkIdentity({
    instanceId: 'work-needle-case',
    workspaceId: 'needle-case',
    initialProductName: '양단호박바늘쌈',
    initialInputImageFingerprint: '4526768:/9j/4UIURX',
    createdAt: 100,
  });

  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    workspaceScope: { id: 'project:needle-case' },
    productName: '양단호박바늘쌈',
    workIdentity: identity,
    factory: {
      currentProjectId: 'needle-case',
      workspace: { id: 'needle-case' },
      workIdentity: identity,
      product: {
        productName: '양단호박바늘쌈',
        userProductName: '양단호박바늘쌈',
        lockedInputImageFingerprint: '4784892:/9j/4US4RX',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_IDENTITY_IMAGE_BINDING_CONFLICT');
});

test('Given a snapshot carries an immutable product name different from its live product When validated Then it is rejected', async () => {
  const { createWorkspaceWorkIdentity, validateWorkspaceSnapshotIdentity } = await loadContracts();
  const identity = createWorkspaceWorkIdentity({
    instanceId: 'work-needle-case',
    workspaceId: 'needle-case',
    initialProductName: '양단호박바늘쌈',
    initialInputImageFingerprint: '4526768:/9j/4UIURX',
    createdAt: 100,
  });

  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    productName: '롱카드지갑',
    workIdentity: identity,
    factory: {
      currentProjectId: 'needle-case',
      workspace: { id: 'needle-case' },
      product: {
        productName: '롱카드지갑',
        userProductName: '롱카드지갑',
        lockedInputImageFingerprint: '4526768:/9j/4UIURX',
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_IDENTITY_PRODUCT_BINDING_CONFLICT');
});

test('Given a persistence replica contains a mixed product snapshot When restored Then the replica is skipped atomically', async () => {
  const { createWorkspacePersistence } = await import(
    `${pathToFileURL(ORCHESTRATOR).href}?identity=${Date.now()}-${Math.random()}`
  );
  const mixedEnvelope = {
    schema: 'kuasangse.workspace',
    version: 2,
    scopeId: 'project:needle-case',
    savedAt: 100,
    digest: 'mixed-digest',
    metadata: {
      operationId: 'mixed-operation',
      leaseId: '',
      fencingToken: '0',
      revision: {
        scopeId: 'project:needle-case', counter: 1, updatedAt: 100, writerId: 'mixed-test',
      },
    },
    snapshot: {
      currentProjectId: 'needle-case',
      workspaceScope: { id: 'project:needle-case' },
      productName: '양단호박바늘쌈',
      factory: {
        currentProjectId: 'needle-case',
        workspace: { id: 'needle-case' },
        product: { productName: '롱카드지갑', userProductName: '롱카드지갑' },
      },
    },
  };
  const emptyAdapter = { async read() { return null; }, async write(value) { return value; } };
  const adapters = {
    session: { ...emptyAdapter, async read() { return mixedEnvelope; } },
    indexeddb: emptyAdapter,
    server: emptyAdapter,
    workfile: emptyAdapter,
    archive: emptyAdapter,
  };
  const persistence = createWorkspacePersistence({ adapters });

  const restored = await persistence.restore({ scopeId: 'project:needle-case' });

  assert.equal(restored, null);
});

test('Given one document is opened in a tab-local branch When validated Then document and branch scopes stay independently bound', async () => {
  const {
    createWorkspaceWorkBranch,
    createWorkspaceWorkIdentity,
    validateWorkspaceSnapshotIdentity,
  } = await loadContracts();
  const identity = createWorkspaceWorkIdentity({
    instanceId: 'work-needle-case',
    workspaceId: 'project:needle-case',
    initialProductName: '양단호박바늘쌈',
    initialInputImageFingerprint: '4526768:/9j/4UIURX',
    createdAt: 100,
  });
  const branch = createWorkspaceWorkBranch({
    branchId: 'tab-a',
    scopeId: 'draft:tab-a',
    documentId: 'needle-case',
    documentScopeId: 'project:needle-case',
    createdAt: 200,
  });

  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    workspaceScope: { id: 'draft:tab-a' },
    workspaceRevision: { scopeId: 'draft:tab-a', counter: 3, updatedAt: 300, writerId: 'tab-a' },
    workspaceBranch: branch,
    productName: '양단호박바늘쌈',
    inputImageFingerprint: '4526768:/9j/4UIURX',
    workIdentity: identity,
    factory: {
      currentProjectId: 'needle-case',
      workspace: { id: 'needle-case' },
      workIdentity: identity,
      product: {
        productName: '양단호박바늘쌈',
        userProductName: '양단호박바늘쌈',
        lockedInputImageFingerprint: '4526768:/9j/4UIURX',
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.scopeId, 'draft:tab-a');
  assert.equal(result.documentScopeId, 'project:needle-case');
  assert.equal(result.branch.scopeId, 'draft:tab-a');
});

test('Given a saved document snapshot embeds assets from its own tab branch When validated Then the project and draft scopes are both accepted', async () => {
  const { createWorkspaceWorkBranch, validateWorkspaceSnapshotIdentity } = await loadContracts();
  const branch = createWorkspaceWorkBranch({
    branchId: 'tab-a',
    scopeId: 'draft:tab-a',
    documentId: 'needle-case',
    documentScopeId: 'project:needle-case',
    createdAt: 200,
  });

  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    workspaceScope: { id: 'project:needle-case' },
    workspaceRevision: { scopeId: 'project:needle-case', counter: 4, updatedAt: 400, writerId: 'tab-a' },
    workspaceBranch: branch,
    productName: '양단호박바늘쌈',
    assetPayload: {
      currentProjectId: 'needle-case',
      workspaceScope: { id: 'draft:tab-a' },
      workspaceRevision: { scopeId: 'draft:tab-a', counter: 3, updatedAt: 300, writerId: 'tab-a' },
      workspaceBranch: branch,
    },
    factory: {
      currentProjectId: 'needle-case',
      workspace: { id: 'needle-case' },
      product: { productName: '양단호박바늘쌈' },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.scopeId, 'draft:tab-a');
  assert.equal(result.documentScopeId, 'project:needle-case');
});

test('Given a saved document snapshot embeds assets from another tab branch When validated Then the foreign branch scope is rejected', async () => {
  const { createWorkspaceWorkBranch, validateWorkspaceSnapshotIdentity } = await loadContracts();
  const branch = createWorkspaceWorkBranch({
    branchId: 'tab-a',
    scopeId: 'draft:tab-a',
    documentId: 'needle-case',
    documentScopeId: 'project:needle-case',
    createdAt: 200,
  });

  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    workspaceScope: { id: 'project:needle-case' },
    workspaceBranch: branch,
    productName: '양단호박바늘쌈',
    assetPayload: {
      currentProjectId: 'needle-case',
      workspaceScope: { id: 'draft:tab-b' },
      workspaceRevision: { scopeId: 'draft:tab-b', counter: 3, updatedAt: 300, writerId: 'tab-b' },
      workspaceBranch: branch,
    },
    factory: {
      currentProjectId: 'needle-case',
      workspace: { id: 'needle-case' },
      product: { productName: '양단호박바늘쌈' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_BRANCH_SCOPE_CONFLICT');
});

test('Given a tab branch names another document When validated Then the whole snapshot is rejected', async () => {
  const { createWorkspaceWorkBranch, validateWorkspaceSnapshotIdentity } = await loadContracts();
  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    workspaceScope: { id: 'draft:tab-a' },
    workspaceBranch: createWorkspaceWorkBranch({
      branchId: 'tab-a',
      scopeId: 'draft:tab-a',
      documentId: 'wallet',
      documentScopeId: 'project:wallet',
      createdAt: 200,
    }),
    productName: '양단호박바늘쌈',
    factory: {
      currentProjectId: 'needle-case',
      workspace: { id: 'needle-case' },
      product: { productName: '양단호박바늘쌈' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_BRANCH_DOCUMENT_CONFLICT');
});

test('Given a branch payload is written under another tab scope When validated Then the whole snapshot is rejected', async () => {
  const { createWorkspaceWorkBranch, validateWorkspaceSnapshotIdentity } = await loadContracts();
  const result = validateWorkspaceSnapshotIdentity({
    currentProjectId: 'needle-case',
    workspaceScope: { id: 'draft:tab-b' },
    workspaceBranch: createWorkspaceWorkBranch({
      branchId: 'tab-a',
      scopeId: 'draft:tab-a',
      documentId: 'needle-case',
      documentScopeId: 'project:needle-case',
      createdAt: 200,
    }),
    productName: '양단호박바늘쌈',
    factory: {
      currentProjectId: 'needle-case',
      workspace: { id: 'needle-case' },
      product: { productName: '양단호박바늘쌈' },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORK_BRANCH_SCOPE_CONFLICT');
});
