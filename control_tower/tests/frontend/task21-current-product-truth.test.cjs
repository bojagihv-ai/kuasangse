const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const FRONTEND = path.resolve(__dirname, '../../frontend');
const WORKBENCH = path.join(FRONTEND, 'src', 'production-workbench.mjs');
const MODEL = path.join(FRONTEND, 'src', 'production-workbench-model.mjs');

function projection(overrides = {}) {
  return {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    sequence: 21,
    cursor: '21',
    connected: true,
    session: {
      workspaceId: 'task-21:current', productId: 'cafe24:3021', productKey: '진실 상태 보자기',
      runId: 'run-task-21', inputFingerprint: 'sha256:task-21', revision: 21,
      workfileName: '진실 상태 보자기.kuasangse', workfileSha256: 'a'.repeat(64),
    },
    inputs: [{ key: 'requirements', count: 2, missing: [], items: [{ key: 'material', value: '면' }, { key: 'stock', value: '99' }] }],
    stages: [{ key: 'representative', status: 'waiting_manual', selectedId: 'hero-a', candidates: [{ id: 'hero-a' }, { id: 'hero-b' }] }],
    progress: { stageKey: 'representative', stageLabel: '대표이미지', status: 'waiting_manual' },
    registration: { status: 'staged_verified', jobId: 'factory-job-21', productId: 'cafe24:3021', productKey: '진실 상태 보자기' },
    receipts: [], products: [],
    ...overrides,
  };
}

test('Task 21 RED: remote read-back 없는 staged/historical Cafe24 주장은 상품번호나 링크를 만들지 않는다', async () => {
  const workbench = await import(`${pathToFileURL(WORKBENCH).href}?task21-receipt-red=${Date.now()}`);
  const weakReceipt = {
    schema: 'factory-cafe24-terminal-publication-receipt:v1', status: 'staged_verified', receiptId: 'historic-claim',
    jobId: 'factory-job-21', productId: 'cafe24:3021', remoteProductNo: '3021', productName: '과거 주장',
    sourceWorkfileName: '진실 상태 보자기.kuasangse',
  };

  const summary = workbench.cafe24RegistrationSummary(projection().registration, projection().session, weakReceipt);

  assert.equal(summary.registered, false);
  assert.equal(summary.productNo, '');
  assert.equal(summary.storefrontUrl, '');
  assert.equal(summary.adminUrl, '');
});

test('Task 21 RED: 스키마 없는 read-back 객체는 원격 등록 영수증으로 신뢰하지 않는다', async () => {
  const workbench = await import(`${pathToFileURL(WORKBENCH).href}?task21-receipt-schema-red=${Date.now()}`);
  const fakeReceipt = {
    receiptId: 'fake-receipt', status: 'staged_verified', remoteReadbackDigest: 'sha256:fake',
    jobId: 'factory-job-21', productId: 'cafe24:3021',
    remoteReadback: { productNo: '999999', productName: '가짜 상품', storefrontUrl: 'https://example.invalid/fake' },
  };

  const summary = workbench.cafe24RegistrationSummary(projection().registration, projection().session, fakeReceipt);
  assert.equal(summary.registered, false);
  assert.equal(summary.productNo, '');
  assert.equal(summary.storefrontUrl, '');
  assert.equal(summary.adminUrl, '');
});

test('Task 21 RED: Ctrl+F5/reconnect의 같은 작업 축소 snapshot은 A의 필수값·후보·선택·단계·작업파일을 낮추지 않는다', async () => {
  const workbench = await import(`${pathToFileURL(WORKBENCH).href}?task21-preserve-red=${Date.now()}`);
  const before = projection();
  const incoming = projection({
    inputs: [],
    stages: [],
    progress: {},
    session: { ...before.session, workfileName: '', workfileSha256: '' },
  });

  const after = workbench.preserveCurrentProductProjection(before, incoming);

  assert.deepEqual(after.inputs.map(item => [item.key, item.items.map(value => value.key)]), [['requirements', ['material', 'stock']]]);
  assert.deepEqual(after.stages.map(stage => [stage.key, stage.candidates.map(candidate => candidate.id), stage.selectedId]), [['representative', ['hero-a', 'hero-b'], 'hero-a']]);
  assert.equal(after.progress.stageKey, 'representative');
  assert.equal(after.session.workfileName, '진실 상태 보자기.kuasangse');
  assert.equal(after.session.workfileSha256, 'a'.repeat(64));
});

test('Task 21 RED: staged_verified 문자열만으로 전송 단계를 완료로 칠 수 없다', async () => {
  const model = await import(`${pathToFileURL(MODEL).href}?task21-step-red=${Date.now()}`);
  const workbench = model.deriveAssemblyWorkbench(
    { registration: { status: 'staged_verified', remoteReadbackDigest: '' } },
    { stageKey: 'final_detail', status: 'completed' },
  );

  assert.notEqual(workbench.steps.find(step => step.key === 'send').state, 'done');
});

test('Task 21 RED: digest 문자열도 원격 read-back 영수증 없이는 전송 완료 증거가 아니다', async () => {
  const model = await import(`${pathToFileURL(MODEL).href}?task21-step-digest-red=${Date.now()}`);
  const workbench = model.deriveAssemblyWorkbench(
    { registration: { status: 'staged_verified', remoteReadbackDigest: 'sha256:claim-only' } },
    { stageKey: 'final_detail', status: 'completed' },
  );

  assert.notEqual(workbench.steps.find(step => step.key === 'send').state, 'done');
});

test('Task 21 RED: 같은 작업의 같은 개수지만 다른 B snapshot은 A와 합쳐지고 작업파일·영수증은 감소하지 않는다', async () => {
  const workbench = await import(`${pathToFileURL(WORKBENCH).href}?task21-preserve-union-red=${Date.now()}`);
  const trustedReceipt = {
    receiptId: 'receipt-task-21', status: 'staged_verified', remoteReadbackDigest: 'sha256:verified',
    remoteReadback: { productNo: '3021', productName: '진실 상태 보자기' },
  };
  const before = projection({
    progress: { stageKey: 'sections', stageLabel: '섹션 생성', status: 'waiting_manual', mode: 'manual' },
    registration: { ...projection().registration, publicationReceipt: trustedReceipt },
    receipts: [trustedReceipt],
  });
  const incoming = projection({
    sequence: 22,
    cursor: '22',
    session: { ...before.session, revision: 21, workfileName: '', workfileSha256: '' },
    inputs: [{
      key: 'requirements', count: 2, missing: [],
      items: [{ key: 'material', value: '실크' }, { key: 'usage', value: '선물' }],
    }],
    stages: [{
      key: 'representative', status: 'waiting_manual', selectedId: 'hero-c',
      candidates: [{ id: 'hero-b' }, { id: 'hero-c' }],
    }],
    progress: { stageKey: 'sections', stageLabel: '섹션 생성', status: 'waiting_manual', mode: 'manual' },
    registration: {},
    receipts: [],
  });

  const after = workbench.preserveCurrentProductProjection(before, incoming);
  const values = Object.fromEntries(after.inputs[0].items.map(item => [item.key, item.value]));
  assert.deepEqual(values, { material: '실크', stock: '99', usage: '선물' });
  assert.deepEqual(after.stages[0].candidates.map(candidate => candidate.id), ['hero-a', 'hero-b', 'hero-c']);
  assert.equal(after.stages[0].selectedId, 'hero-c');
  assert.equal(after.progress.stageKey, 'sections');
  assert.equal(after.progress.mode, 'manual');
  assert.equal(after.session.revision, 21);
  assert.equal(after.session.workfileName, '진실 상태 보자기.kuasangse');
  assert.equal(after.session.workfileSha256, 'a'.repeat(64));
  assert.equal(after.registration.publicationReceipt.receiptId, 'receipt-task-21');
  assert.equal(after.receipts[0].receiptId, 'receipt-task-21');
  assert.deepEqual(workbench.preserveCurrentProductProjection(after, incoming), after);
});

test('Task 21 RED: 같은 작업의 오래된 revision·정책·현재 단계는 A를 뒤로 돌리지 않는다', async () => {
  const workbench = await import(`${pathToFileURL(WORKBENCH).href}?task21-preserve-stale-red=${Date.now()}`);
  const before = projection({
    progress: { stageKey: 'sections', stageLabel: '섹션 생성', status: 'waiting_manual', mode: 'manual' },
  });
  const incoming = projection({
    sequence: 20,
    cursor: '20',
    session: { ...before.session, revision: 1, workfileName: '', workfileSha256: '' },
    progress: { stageKey: 'intake', stageLabel: '시작', status: 'running', mode: 'auto' },
  });

  const after = workbench.preserveCurrentProductProjection(before, incoming);
  assert.equal(after.progress.stageKey, 'sections');
  assert.equal(after.progress.mode, 'manual');
  assert.equal(after.session.revision, 21);
  assert.equal(after.session.workfileName, '진실 상태 보자기.kuasangse');
  assert.equal(after.session.workfileSha256, 'a'.repeat(64));
});

test('Task 21 PIN: 다른 제품 snapshot에는 이전 제품 A를 섞지 않는다', async () => {
  const workbench = await import(`${pathToFileURL(WORKBENCH).href}?task21-cross-product-pin=${Date.now()}`);
  const incoming = projection({
    session: {
      workspaceId: 'task-21:other', productId: 'cafe24:9999', productKey: '다른 제품',
      runId: 'run-other', inputFingerprint: 'sha256:other', revision: 1,
      workfileName: '다른 제품.kuasangse', workfileSha256: 'b'.repeat(64),
    },
    inputs: [], stages: [], progress: {}, registration: {}, receipts: [],
  });

  const after = workbench.preserveCurrentProductProjection(projection(), incoming);
  assert.equal(after.session.productId, 'cafe24:9999');
  assert.deepEqual(after.inputs, []);
  assert.deepEqual(after.stages, []);
});

test('Task 21 RED: 원격 영수증이 있어도 조립공장 연결 끊김이면 7단계 전체 완료로 보이지 않는다', async () => {
  const model = await import(`${pathToFileURL(MODEL).href}?task21-disconnected-red=${Date.now()}`);
  const job = { stageKey: 'cafe24', status: 'completed' };
  const connected = model.deriveAssemblyWorkbench({ connected: true, registration: {} }, job, true);
  const disconnected = model.deriveAssemblyWorkbench({ connected: false, registration: {} }, job, true);

  assert.equal(connected.steps.find(step => step.key === 'send').state, 'done');
  assert.notEqual(disconnected.steps.find(step => step.key === 'send').state, 'done');
  assert.notEqual(disconnected.steps.filter(step => step.state === 'done').length, 7);
});
