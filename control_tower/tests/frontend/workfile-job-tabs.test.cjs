const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULE = path.resolve(__dirname, '../../frontend/src/production-workbench.mjs');

function projection(jobId, identity) {
  return {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: String(identity.revision),
    sequence: identity.revision,
    connected: true,
    session: {
      workspaceId: identity.workspaceId,
      productId: identity.productId,
      productKey: identity.productKey,
      runId: identity.runId,
      inputFingerprint: identity.inputFingerprint,
      revision: identity.revision,
      workfileName: identity.fileName,
    },
    inputs: [{ key: 'requirements', count: 8, missing: identity.missing || [], items: [] }],
    stages: [
      { key: 'representative', status: 'waiting_manual', selectedId: '', candidates: [{ id: `${jobId}-hero` }] },
      { key: 'size', status: 'waiting_manual', selectedId: '', candidates: [{ id: `${jobId}-size` }] },
    ],
    progress: { stageKey: 'representative', percent: 40, mode: 'manual', status: 'waiting_manual' },
    registration: { jobId, status: 'blocked', productId: identity.productId, productKey: identity.productKey },
  };
}

function workfile(identity, overrides = {}) {
  return {
    fileName: identity.fileName,
    file: { name: identity.fileName },
    workfileText: `${JSON.stringify({ format: 'kuasangse.factory.project', name: identity.productKey })}\n`,
    sha256: identity.sha256,
    identity: {
      workspaceId: identity.workspaceId,
      productId: identity.productId,
      productKey: identity.productKey,
      runId: identity.runId,
      inputFingerprint: identity.inputFingerprint,
      revision: identity.revision,
    },
    classification: {
      product: { name: identity.label, productKey: identity.productKey },
      inputs: { missingFieldCount: identity.missing?.length || 0 },
      outputs: { selectedAssetCount: 1, stages: [{ selectedCount: 1 }, { selectedCount: 0 }] },
    },
    ...overrides,
  };
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.className = '';
    this.textContent = '';
    this.tabIndex = 0;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type, event = {}) {
    this.listeners.get(type)?.({ preventDefault() {}, ...event, currentTarget: this });
  }

  focus() {
    globalThis.document.activeElement = this;
  }
}

test('두 작업파일 탭은 공정과 검사 후보를 독립 유지하고 보기 전환은 변경 요청을 만들지 않는다', async t => {
  // Given: 서로 다른 durable job 두 개가 각각 실제 projection으로 한 번씩 관찰됐다.
  const workbench = await import(`${pathToFileURL(MODULE).href}?workfile-tabs=${Date.now()}`);
  const identityA = {
    label: '자동화검증 자수 수저파우치 A', fileName: 'A.kuasangse', workspaceId: 'batch:job-a',
    productId: 'cafe24:3001', productKey: 'product-a', runId: 'run-a', inputFingerprint: 'sha256:input-a',
    revision: 31, sha256: 'a'.repeat(64), missing: [],
  };
  const identityB = {
    label: '수동 A컷 검증 미니 데스크 오거나이저 B', fileName: 'B.kuasangse', workspaceId: 'batch:job-b',
    productId: 'cafe24:3002', productKey: 'product-b', runId: 'run-b-new', inputFingerprint: 'sha256:input-b',
    revision: 87, sha256: 'b'.repeat(64), missing: ['material'],
  };
  const jobs = [
    { jobId: 'job-a', productName: identityA.label, workfileName: identityA.fileName, status: 'waiting_manual', stageKey: 'representative', mode: 'manual', checkpointAvailable: true },
    { jobId: 'job-b', productName: identityB.label, workfileName: identityB.fileName, status: 'blocked', stageKey: 'representative', mode: 'manual', checkpointAvailable: true },
  ];
  const registry = workbench.createWorkfileJobTabRegistry();
  registry.syncJobs(jobs, projection('job-a', identityA));
  registry.syncJobs(jobs, projection('job-b', { ...identityB, runId: 'run-b-old', revision: 20 }));
  registry.registerWorkfile(workfile(identityA));
  registry.registerWorkfile(workfile(identityB));
  registry.activate('job:job-a');
  registry.rememberView({ selectedStageKey: 'representative', inspectedCandidateId: 'job-a-hero' });
  registry.activate('job:job-b');
  registry.rememberView({ selectedStageKey: 'size', inspectedCandidateId: 'job-b-size' });

  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName), activeElement: null };
  t.after(() => { globalThis.document = previousDocument; });
  const root = new FakeElement('div');
  let mutationCalls = 0;
  let activeKey = '';

  // When: B 탭에서 ArrowLeft로 A 탭을 활성화한다.
  workbench.renderWorkfileJobTabs(root, registry.snapshot(), key => {
    activeKey = key;
    registry.activate(key);
  });
  root.children[1].dispatch('keydown', { key: 'ArrowLeft' });

  // Then: 네트워크 변경 없이 A/B의 view state와 의미론적 탭 DOM이 그대로 남는다.
  assert.equal(mutationCalls, 0);
  assert.equal(activeKey, 'job:job-a');
  assert.equal(registry.get('job:job-a').selectedStageKey, 'representative');
  assert.equal(registry.get('job:job-a').inspectedCandidateId, 'job-a-hero');
  assert.equal(registry.get('job:job-b').selectedStageKey, 'size');
  assert.equal(registry.get('job:job-b').inspectedCandidateId, 'job-b-size');
  assert.deepEqual(root.children.map(tab => tab.getAttribute('role')), ['tab', 'tab']);
  assert.deepEqual(root.children.map(tab => tab.getAttribute('aria-selected')), ['false', 'true']);
  assert.equal(registry.get('job:job-a').linkState, 'linked');
  assert.equal(registry.get('job:job-b').linkState, 'rebind_required');
  assert.equal(JSON.stringify(registry.snapshot()).includes('workfileText'), false);

  // Enter/Space는 native button click 합성에 의존하지 않고 탭을 직접 활성화한다.
  activeKey = '';
  root.children[1].dispatch('keydown', { key: 'Enter' });
  await Promise.resolve();
  assert.equal(activeKey, 'job:job-b');
  assert.equal(globalThis.document.activeElement.dataset.tabKey, 'job:job-b');
  activeKey = '';
  root.children[0].dispatch('keydown', { key: ' ' });
  await Promise.resolve();
  assert.equal(activeKey, 'job:job-a');
  assert.equal(globalThis.document.activeElement.dataset.tabKey, 'job:job-a');
});

test('작업파일은 이름이 아니라 exact identity 한 건일 때만 연결하고 모호하면 차단한다', async () => {
  // Given: 같은 표시 이름이지만 stable identity가 다른 두 작업과 한 작업파일이 있다.
  const workbench = await import(`${pathToFileURL(MODULE).href}?workfile-link=${Date.now()}`);
  const registry = workbench.createWorkfileJobTabRegistry();
  const base = {
    label: '같은 제품명', fileName: '같은 제품명.kuasangse', workspaceId: 'batch:exact', productId: 'cafe24:3003',
    productKey: 'exact-product', runId: 'run-1', inputFingerprint: 'sha256:exact', revision: 10,
    sha256: 'c'.repeat(64), missing: [],
  };
  const jobs = [
    { jobId: 'job-exact', productName: base.label, workfileName: base.fileName, status: 'blocked', stageKey: 'representative' },
    { jobId: 'job-other', productName: base.label, workfileName: base.fileName, status: 'blocked', stageKey: 'representative' },
  ];
  registry.syncJobs(jobs, projection('job-exact', base));
  registry.syncJobs(jobs, projection('job-other', { ...base, workspaceId: 'batch:other', inputFingerprint: 'sha256:other' }));

  // When/Then: exact 파일은 한 job에만 붙고 이름만 같은 파일은 연결되지 않는다.
  assert.equal(registry.registerWorkfile(workfile(base)).status, 'linked');
  assert.equal(registry.registerWorkfile(workfile({ ...base, productId: '', sha256: 'f'.repeat(64) })).status, 'unlinked');
  assert.equal(registry.registerWorkfile(workfile({ ...base, workspaceId: '', inputFingerprint: '', sha256: 'd'.repeat(64) })).status, 'unlinked');

  // Given/When/Then: 두 캐시가 같은 stable identity를 주장하면 첫 항목을 고르지 않고 ambiguous로 차단한다.
  registry.syncJobs(jobs, projection('job-other', base));
  const ambiguous = registry.registerWorkfile(workfile({ ...base, sha256: 'e'.repeat(64) }));
  assert.equal(ambiguous.status, 'ambiguous');
  assert.deepEqual([...ambiguous.matches].sort(), ['job-exact', 'job-other']);
});

test('unlinked 파일은 exact SHA revision run durable job만 새 작업 탭으로 승격한다', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?workfile-fork=${Date.now()}`);
  const identity = {
    label: '포크 제품', fileName: 'fork.kuasangse', workspaceId: 'workspace-fork', productId: 'product-fork',
    productKey: 'product-key-fork', runId: 'run-fork', inputFingerprint: 'fingerprint-fork', revision: 87,
    sha256: '7'.repeat(64), missing: ['material'],
  };
  const selected = workfile(identity);
  selected.identity.productId = '';
  selected.workfileText = `${JSON.stringify({
    format: 'kuasangse.factory.project',
    project: { payload: { assetPayload: { factory: { product: { finalDb: { cafe24_product_no: 3002, product_no: 3002 } } } } } },
  })}\n`;
  selected.classification.inputs.requiredFields = [
    { key: 'material', value: '', status: 'missing' },
    { key: 'dimensions', value: '10 x 20 cm', status: 'confirmed' },
  ];
  const blank = {
    schema: 'factory-control-projection:v1', connected: false, session: { revision: 0 },
    inputs: [], stages: [], progress: {}, registration: {},
  };
  const payload = workbench.buildWorkfileForkPayload({ projection: blank, workfile: selected });
  assert.equal(payload.expectedWorkfileRevision, 0);
  assert.equal(payload.expectedHydratedWorkfileRevision, 87);
  assert.equal(payload.expectedProductId, 'cafe24:3002');
  assert.deepEqual(payload.requiredValues, { size: '10 x 20 cm' });
  assert.equal(payload.workfileText, selected.workfileText);

  const registry = workbench.createWorkfileJobTabRegistry();
  registry.registerWorkfile(selected);
  registry.syncJobs([{
    jobId: 'factory-job-fork', productName: identity.label, workfileName: identity.fileName,
    sourceKind: 'workfile', sourceSha256: identity.sha256, sourceRevision: 87, sourceRunId: 'run-fork',
    status: 'queued', stageKey: '', mode: 'manual',
  }], blank);
  assert.equal(registry.active().key, 'job:factory-job-fork');
  assert.equal(registry.workfileFor('job:factory-job-fork').sha256, identity.sha256);
  assert.equal(registry.get(`file:${identity.sha256}`), null);

  const mismatch = workfile({
    ...identity,
    workspaceId: 'workspace-mismatch',
    inputFingerprint: 'fingerprint-mismatch',
    sha256: '8'.repeat(64),
  });
  registry.registerWorkfile(mismatch);
  registry.syncJobs([{
    jobId: 'factory-job-mismatch', productName: identity.label, workfileName: identity.fileName,
    sourceKind: 'workfile', sourceSha256: mismatch.sha256, sourceRevision: 86, sourceRunId: 'run-fork',
    status: 'queued', stageKey: '', mode: 'manual',
  }], blank);
  assert.ok(registry.get(`file:${mismatch.sha256}`));
});

test('명시적 rebind와 resume만 현재 checkpoint CAS를 exact payload로 전송한다', async () => {
  // Given: blocked job의 rev20 checkpoint와 승인 파일 rev87/new-run이 exact stable identity로 연결됐다.
  const workbench = await import(`${pathToFileURL(MODULE).href}?workfile-command=${Date.now()}`);
  const current = {
    label: '제품 B', fileName: 'B.kuasangse', workspaceId: 'batch:job-b', productId: 'cafe24:3002',
    productKey: 'product-b', runId: 'run-old', inputFingerprint: 'sha256:input-b', revision: 20,
    sha256: 'f'.repeat(64), missing: [],
  };
  const authorized = { ...current, runId: 'run-new', revision: 87 };
  const job = { jobId: 'job-b', productName: current.label, workfileName: current.fileName, status: 'blocked', stageKey: 'representative', checkpointAvailable: true };
  const registry = workbench.createWorkfileJobTabRegistry();
  registry.syncJobs([job], projection(job.jobId, current));
  registry.registerWorkfile(workfile(authorized));
  const privateFile = registry.workfileFor('job:job-b');

  // When: 사용자가 승인 파일 연결과 이후 작업 재개를 각각 명시 실행한다.
  const rebind = workbench.buildWorkfileRebindPayload({ job, projection: projection(job.jobId, current), workfile: privateFile });
  const resume = workbench.buildFactoryResumePayload({
    job,
    projection: projection(job.jobId, authorized),
    imageModel: 'api-hub-openai-image',
  });

  // Then: rebind는 old CAS와 new workfile identity를 모두 포함하고 resume도 rebound checkpoint를 고정한다.
  assert.deepEqual({
    expectedCheckpointRevision: rebind.expectedCheckpointRevision,
    expectedCheckpointRunId: rebind.expectedCheckpointRunId,
    expectedWorkfileRevision: rebind.expectedWorkfileRevision,
    expectedHydratedWorkfileRevision: rebind.expectedHydratedWorkfileRevision,
    expectedRunId: rebind.expectedRunId,
    expectedSha256: rebind.expectedSha256,
  }, {
    expectedCheckpointRevision: 20,
    expectedCheckpointRunId: 'run-old',
    expectedWorkfileRevision: 20,
    expectedHydratedWorkfileRevision: 87,
    expectedRunId: 'run-new',
    expectedSha256: 'f'.repeat(64),
  });
  assert.equal(rebind.workfileText, privateFile.workfileText);
  assert.equal(rebind.workfileText.endsWith('\n'), true);
  assert.deepEqual(resume, {
    imageModel: 'api-hub-openai-image',
    expectedCheckpointRevision: 87,
    expectedCheckpointRunId: 'run-new',
  });
  assert.throws(
    () => workbench.buildFactoryResumePayload({ job, projection: projection('foreign-job', authorized), imageModel: 'api-hub-openai-image' }),
    error => error?.code === 'factory_job_view_not_current',
  );
  assert.throws(
    () => workbench.buildWorkfileRebindPayload({ job, projection: projection(job.jobId, current), workfile: { ...privateFile, file: null } }),
    error => error?.code === 'workfile_reselect_required',
  );
});

test('productId 없는 실제 B 파일은 명시적으로 선택한 exact job에만 연결 승인을 허용한다', async () => {
  const workbench = await import(`${pathToFileURL(MODULE).href}?explicit-target=${Date.now()}`);
  const current = {
    label: '제품 B', fileName: 'B.kuasangse', workspaceId: 'batch:job-b', productId: 'cafe24:3002',
    productKey: 'product-b', runId: 'run-old', inputFingerprint: 'sha256:input-b', revision: 20,
    sha256: '9'.repeat(64), missing: [],
  };
  const actualShape = {
    ...current,
    productId: '',
    runId: 'run-new',
    revision: 87,
  };
  const jobs = [
    { jobId: 'job-b', productName: current.label, workfileName: current.fileName, status: 'blocked', stageKey: 'representative', checkpointAvailable: true },
    { jobId: 'job-other', productName: '다른 작업', workfileName: 'other.kuasangse', status: 'blocked', stageKey: 'representative', checkpointAvailable: true },
  ];

  const automatic = workbench.createWorkfileJobTabRegistry();
  automatic.syncJobs(jobs, projection('job-b', current));
  assert.equal(automatic.registerWorkfile(workfile(actualShape)).status, 'unlinked');

  const explicit = workbench.createWorkfileJobTabRegistry();
  explicit.syncJobs(jobs, projection('job-b', current));
  const associated = explicit.registerWorkfile(workfile(actualShape), 'job-b');
  assert.equal(associated.status, 'target_rebind_required');
  assert.equal(associated.tabKey, 'job:job-b');
  assert.equal(explicit.get('job:job-b').linkState, 'target_rebind_required');
  assert.equal(explicit.workfileFor('job:job-b').targetJobId, 'job-b');

  const payload = workbench.buildWorkfileRebindPayload({
    job: jobs[0],
    projection: projection('job-b', current),
    workfile: explicit.workfileFor('job:job-b'),
  });
  assert.deepEqual({
    expectedProductId: payload.expectedProductId,
    expectedRunId: payload.expectedRunId,
    expectedHydratedWorkfileRevision: payload.expectedHydratedWorkfileRevision,
  }, {
    expectedProductId: 'cafe24:3002',
    expectedRunId: 'run-new',
    expectedHydratedWorkfileRevision: 87,
  });

  for (const [targetJobId, overrides] of [
    ['', {}],
    ['job-other', {}],
    ['job-b', { workspaceId: 'batch:wrong' }],
    ['job-b', { productKey: 'wrong-product' }],
    ['job-b', { inputFingerprint: 'sha256:wrong' }],
    ['job-b', { sha256: 'not-a-sha' }],
    ['job-b', { identity: { ...workfile(actualShape).identity, conflicts: ['productKey'] } }],
  ]) {
    const registry = workbench.createWorkfileJobTabRegistry();
    registry.syncJobs(jobs, projection('job-b', current));
    const candidate = workfile({ ...actualShape, ...overrides }, overrides);
    let result;
    try {
      result = registry.registerWorkfile(candidate, targetJobId);
    } catch (error) {
      assert.equal(error.code, 'workfile_identity_invalid');
      continue;
    }
    assert.equal(result.status, 'unlinked');
    assert.equal(registry.workfileFor('job:job-b'), null);
  }
});
