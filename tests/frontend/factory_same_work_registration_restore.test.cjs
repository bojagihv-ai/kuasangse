'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { isDeepStrictEqual } = require('node:util');

const CORE = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-03.js'), 'utf8');
const LOG_CORE = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-05.js'), 'utf8');
const JOB = 'factory-job-b8996417eb8543139f295f73e8c9d723';
const WORKSPACE = `batch:${JOB}`;
const RUN = 'factory_work_run_mtthqr5b_hdumgl';

function loadPreserver() {
  const start = CORE.indexOf('function factoryMergeIdentityScope');
  const end = CORE.indexOf('function factoryHasMeaningfulWork', start);
  assert.ok(start >= 0 && end > start, 'factory preservation helper boundary is required');
  const context = vm.createContext({
    cloneData: value => structuredClone(value),
    normalizeFactoryState: value => value,
    factoryNormalizeIdentityText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    factoryIdentityKey: factory => String(factory?.product?.productKey || factory?.product?.productName || '').trim(),
    factoryHasMeaningfulWork: factory => !!(factory?.product?.productName || factory?.assets?.length),
    factorySinhwaCandidateKey: candidate => candidate?.jcode || candidate?.id || '',
    factoryCafe24CandidateKey: candidate => candidate?.product_no || candidate?.id || '',
  });
  vm.runInContext(`${CORE.slice(start, end)}\nthis.preserve = factoryPreserveProgressForSameWork;`, context);
  return context.preserve;
}

function extractFunction(name, source = CORE) {
  const start = source.search(new RegExp(`function ${name}\\(`));
  assert.notEqual(start, -1, `${name} is required`);
  let signatureEnd = source.indexOf('(', start);
  let signatureDepth = 0;
  for (; signatureEnd < source.length; signatureEnd += 1) {
    if (source[signatureEnd] === '(') signatureDepth += 1;
    if (source[signatureEnd] === ')' && --signatureDepth === 0) break;
  }
  const bodyStart = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body not closed`);
}

function loadRealNormalizerPreserver() {
  const context = vm.createContext({
    structuredClone,
    state: {},
    cloneData: value => structuredClone(value),
    FACTORY_STAGE_DEFS: [
      { id: 'db' }, { id: 'hero' }, { id: 'size' }, { id: 'options' },
      { id: 'cuts' }, { id: 'detail' }, { id: 'export' },
    ],
    FACTORY_NORMALIZED_STATE_MARKER: '__factoryNormalizedStateV2',
    FACTORY_NORMALIZED_IDENTITY_MARKER: '__factoryNormalizedIdentityKeyV2',
    factoryLiveGoalOperationId: '',
    factoryLoadCafe24FieldViewStorage: () => ({}),
    factoryNormalizeCafe24FieldView: value => value || {},
    normalizeFactoryAsset: value => value,
    factoryRepairProductImagePayloadDrift: () => {},
    factorySanitizeCafe24ProductState: product => product,
    factoryPruneRuntimeFactoryAssets: () => {},
    repairFactoryProductIdentityDrift: value => value,
    factorySinhwaCandidateKey: candidate => candidate?.jcode || candidate?.id || '',
    factoryCafe24CandidateKey: candidate => candidate?.product_no || candidate?.id || '',
  });
  const names = [
    'factoryNormalizePersistedFactoryLogs', 'factoryNormalizationIdentityKey',
    'factoryMarkNormalizedState', 'factoryAlreadyNormalized', 'factoryWorkspaceIdentityFromSource',
    'factoryNormalizeIdentityText', 'factoryObjectHasEntries', 'factoryProductHasImage',
    'defaultFactoryStageState', 'defaultFactoryState', 'normalizeFactoryStageState', 'normalizeFactoryState',
    'factoryHasMeaningfulWork', 'factoryIdentityKey', 'factoryCurrentProductNameForIdentity',
    'factoryIdentityKeysCompatible', 'factoryCurrentProductKey', 'factoryCurrentProductIdentityMeta',
    'factoryCurrentWorkspaceId', 'factoryCurrentInputImageFingerprint', 'factoryLockedInputImageFingerprint',
    'factoryCurrentStageRunId', 'factoryCurrentWorkflowRunId', 'factoryCurrentJobKey', 'factoryNormalizeStageScope',
  ];
  const preservation = CORE.slice(
    CORE.indexOf('function factoryMergeIdentityScope'),
    CORE.indexOf('function factoryHasMeaningfulWork', CORE.indexOf('function factoryMergeIdentityScope')),
  );
  const logging = ['factoryNowTime', 'factoryCompactLogMessage', 'factoryLogStageId', 'factoryLog']
    .map(name => extractFunction(name, LOG_CORE)).join('\n');
  vm.runInContext(`${names.map(name => extractFunction(name)).join('\n')}\n${preservation}\n${logging}\nthis.runtime = { normalizeFactoryState, preserve: factoryPreserveProgressForSameWork, factoryLog };`, context);
  return context.runtime;
}

function factory({ successful }) {
  const capturedAt = successful ? 1789298532255 : 1789292723410;
  const identity = {
    jobId: JOB,
    workspaceId: WORKSPACE,
    productKey: 'registration-restore-v1501',
    runId: RUN,
    inputFingerprint: 'v1501-input',
    targetProductNo: '3027',
  };
  const product = {
    productName: '등록 복원 회귀 상품',
    productKey: 'registration-restore-v1501',
    inputImageFingerprint: 'v1501-input',
    dbFieldSettings: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [
      `manual-${index + 1}`,
      { manualValue: `값-${index + 1}`, manualTouched: true },
    ])),
    finalDb: { product_no: '3027' },
    cafe24RegistrationReceipt: successful ? {
      schema: 'kuasangse.cafe24-registration-receipt',
      version: 1,
      status: 'verified',
      capturedAt,
      verifiedAt: 1789300288815,
      identity,
      mode: 'update',
      productNo: '3027',
      display: 'F',
      selling: 'F',
      comparisons: Array.from({ length: 13 }, (_, index) => ({ label: `check-${index + 1}`, matched: true })),
      mismatches: [],
      readback: { productNo: '3027', inventoryByOption: { 기본: { quantity: '99' } } },
    } : {
      schema: 'kuasangse.cafe24-registration-receipt',
      version: 1,
      status: 'failed',
      capturedAt,
      identity,
      mode: 'create',
      productNo: '3027',
      error: 'old create failure',
    },
  };
  if (successful) {
    product.cafe24PublicationReceipt = {
      schema: 'kuasangse.cafe24-publication-receipt',
      version: 1,
      projectId: WORKSPACE,
      productNo: '3027',
      registeredAt: 1789300289543,
      registrationMode: 'update',
      display: 'F',
      selling: 'F',
    };
  }
  return {
    workspace: { id: WORKSPACE },
    batchJobId: JOB,
    automation: { currentRunId: RUN },
    goalRun: { jobId: JOB, currentRunId: RUN },
    product,
    assets: Array.from({ length: 20 }, (_, index) => ({ id: `asset-${index + 1}` })),
    stages: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`section-${index + 1}`, { status: 'done' }])),
    openMarketSync: successful ? {
      cafe24RegistrationMode: 'update',
      cafe24Display: 'F',
      cafe24Selling: 'F',
      finalTarget: 'cafe24_only',
      finalRegistrationRunning: false,
      finalRegistrationProgress: 100,
      finalRegistrationStatus: '최종 등록 완료: Cafe24까지만 처리했습니다.',
      finalRegistrationUpdatedAt: 1789300289543,
    } : {
      cafe24RegistrationMode: 'create',
      cafe24Display: 'T',
      cafe24Selling: 'T',
      finalTarget: 'cafe24_openmarket',
      finalRegistrationRunning: false,
      finalRegistrationProgress: 0,
      finalRegistrationStatus: '최종 등록 실패: old create failure',
      finalRegistrationUpdatedAt: 1789292836397,
    },
  };
}

test('같은 작업의 오래된 실패 복원은 최신 검증 등록을 create 실패로 되살리지 않는다', () => {
  const preserve = loadPreserver();
  const restored = preserve(factory({ successful: false }), factory({ successful: true }));

  assert.equal(restored.product.cafe24RegistrationReceipt.status, 'verified');
  assert.equal(restored.product.cafe24RegistrationReceipt.mode, 'update');
  assert.equal(restored.product.cafe24RegistrationReceipt.capturedAt, 1789298532255);
  assert.equal(restored.product.cafe24RegistrationReceipt.verifiedAt, 1789300288815);
  assert.equal(restored.product.cafe24RegistrationReceipt.comparisons.length, 13);
  assert.deepEqual(restored.product.cafe24RegistrationReceipt.mismatches, []);
  assert.equal(restored.product.cafe24RegistrationReceipt.readback.inventoryByOption.기본.quantity, '99');
  assert.equal(restored.product.cafe24PublicationReceipt.productNo, '3027');
  assert.equal(restored.product.cafe24PublicationReceipt.registrationMode, 'update');
  assert.equal(restored.openMarketSync.cafe24RegistrationMode, 'update');
  assert.equal(restored.openMarketSync.finalTarget, 'cafe24_only');
  assert.match(restored.openMarketSync.finalRegistrationStatus, /최종 등록 완료/);
  assert.equal(restored.assets.length, 20);
  assert.equal(Object.keys(restored.stages).length, 14);
  assert.equal(Object.keys(restored.product.dbFieldSettings).length, 17);

  const unverifiedCurrent = factory({ successful: true });
  unverifiedCurrent.product.cafe24RegistrationReceipt.mismatches = ['price'];
  const rejected = preserve(factory({ successful: false }), unverifiedCurrent);
  assert.equal(rejected.product.cafe24RegistrationReceipt.status, 'failed');
  assert.equal(rejected.openMarketSync.cafe24RegistrationMode, 'create');

  const newerFailure = factory({ successful: false });
  newerFailure.product.cafe24RegistrationReceipt.capturedAt = 1789300291000;
  newerFailure.openMarketSync.finalRegistrationUpdatedAt = 1789300292000;
  const preservedNewerFailure = preserve(newerFailure, factory({ successful: true }));
  assert.equal(preservedNewerFailure.product.cafe24RegistrationReceipt.status, 'failed');
  assert.equal(preservedNewerFailure.product.cafe24RegistrationReceipt.verifiedAt, undefined);
  assert.equal(preservedNewerFailure.product.cafe24RegistrationReceipt.comparisons, undefined);

  for (const mutate of [
    value => { value.workspace.id = 'batch:other-job'; value.batchJobId = 'other-job'; value.goalRun.jobId = 'other-job'; },
    value => { value.automation.currentRunId = 'other-run'; value.goalRun.currentRunId = 'other-run'; },
    value => { value.product.inputImageFingerprint = 'other-input'; },
    value => { value.product.finalDb.product_no = '4000'; value.product.cafe24RegistrationReceipt.productNo = '4000'; },
  ]) {
    const differentScope = factory({ successful: false });
    mutate(differentScope);
    assert.equal(
      preserve(differentScope, factory({ successful: true })).product.cafe24RegistrationReceipt.status,
      'failed',
    );
  }

  const explicitSettings = factory({ successful: false });
  explicitSettings.openMarketSync.finalTargetUserTouched = true;
  const preservedExplicitSettings = preserve(explicitSettings, factory({ successful: true }));
  assert.equal(preservedExplicitSettings.openMarketSync.finalTarget, 'cafe24_openmarket');
  assert.equal(preservedExplicitSettings.product.cafe24RegistrationReceipt.status, 'failed');
  assert.equal(preservedExplicitSettings.product.cafe24RegistrationReceipt.verifiedAt, undefined);
});

test('같은 작업 등록 기록은 성공 여부가 아니라 양방향 최신 시각으로 원자 선택한다', () => {
  const preserve = loadPreserver();
  const oldSuccess = factory({ successful: true });
  oldSuccess.product.cafe24RegistrationReceipt.capturedAt = 100;
  oldSuccess.product.cafe24RegistrationReceipt.verifiedAt = 200;
  oldSuccess.product.cafe24PublicationReceipt.registeredAt = 220;
  oldSuccess.openMarketSync.finalRegistrationUpdatedAt = 230;

  const newerFailure = factory({ successful: false });
  newerFailure.product.cafe24RegistrationReceipt.capturedAt = 300;
  newerFailure.openMarketSync.finalRegistrationUpdatedAt = 400;
  const failed = preserve(oldSuccess, newerFailure);
  assert.equal(failed.product.cafe24RegistrationReceipt.status, 'failed');
  assert.equal(failed.product.cafe24RegistrationReceipt.capturedAt, 300);
  assert.equal(failed.product.cafe24RegistrationReceipt.verifiedAt, undefined);
  assert.equal(failed.product.cafe24RegistrationReceipt.comparisons, undefined);
  assert.equal(failed.product.cafe24PublicationReceipt, undefined);
  assert.equal(failed.openMarketSync.finalRegistrationUpdatedAt, 400);
  assert.doesNotMatch(failed.openMarketSync.finalRegistrationStatus, /최종 등록 완료/);

  const pendingCurrent = factory({ successful: false });
  pendingCurrent.product.cafe24RegistrationReceipt.status = 'pending';
  pendingCurrent.product.cafe24RegistrationReceipt.capturedAt = 300;
  delete pendingCurrent.product.cafe24RegistrationReceipt.error;
  pendingCurrent.openMarketSync.finalRegistrationRunning = true;
  pendingCurrent.openMarketSync.finalRegistrationProgress = 42;
  pendingCurrent.openMarketSync.finalRegistrationStatus = '최종 등록 대기: 확인 중';
  pendingCurrent.openMarketSync.finalRegistrationUpdatedAt = 400;
  const pending = preserve(oldSuccess, pendingCurrent);
  assert.equal(pending.product.cafe24RegistrationReceipt.status, 'pending');
  assert.equal(pending.product.cafe24RegistrationReceipt.verifiedAt, undefined);
  assert.equal(pending.product.cafe24PublicationReceipt, undefined);
  assert.equal(pending.openMarketSync.finalRegistrationRunning, true);
  assert.equal(pending.openMarketSync.finalRegistrationProgress, 42);

  const foreignTarget = factory({ successful: false });
  foreignTarget.product.finalDb.product_no = '4000';
  foreignTarget.product.cafe24RegistrationReceipt.productNo = '4000';
  const isolated = preserve(foreignTarget, factory({ successful: true }));
  assert.equal(isolated.product.cafe24RegistrationReceipt.productNo, '4000');
  assert.equal(isolated.product.cafe24RegistrationReceipt.verifiedAt, undefined);
  assert.equal(isolated.product.cafe24PublicationReceipt, undefined);
});

test('같은 작업의 receipt 없는 thin snapshot은 현재 유효 등록 결과를 의도적 삭제로 취급하지 않는다', () => {
  const preserve = loadPreserver();
  const thin = factory({ successful: false });
  delete thin.product.cafe24RegistrationReceipt;
  delete thin.product.cafe24PublicationReceipt;
  delete thin.product.finalDb.product_no;
  thin.openMarketSync = {};

  const restored = preserve(thin, factory({ successful: true }));

  assert.equal(restored.product.cafe24RegistrationReceipt.status, 'verified');
  assert.equal(restored.product.cafe24RegistrationReceipt.productNo, '3027');
  assert.equal(restored.product.cafe24PublicationReceipt.productNo, '3027');
  assert.equal(restored.openMarketSync.cafe24RegistrationMode, 'update');
  assert.match(restored.openMarketSync.finalRegistrationStatus, /최종 등록 완료/);
  assert.equal(restored.assets.length, 20);
  assert.equal(Object.keys(restored.stages).length, 14);
  assert.equal(Object.keys(restored.product.dbFieldSettings).length, 17);
});

test('실제 normalizer를 먼저 거친 thin snapshot도 현재 등록 결과와 수동 자료를 낮추지 않는다', () => {
  const runtime = loadRealNormalizerPreserver();
  const thin = factory({ successful: false });
  delete thin.product.cafe24RegistrationReceipt;
  delete thin.product.cafe24PublicationReceipt;
  delete thin.product.finalDb.product_no;
  thin.openMarketSync = {};

  const restored = runtime.preserve(runtime.normalizeFactoryState(thin), factory({ successful: true }));

  assert.equal(restored.product.cafe24RegistrationReceipt.status, 'verified');
  assert.equal(restored.openMarketSync.finalTarget, 'cafe24_only');
  assert.equal(restored.openMarketSync.cafe24Display, 'F');
  assert.equal(restored.openMarketSync.cafe24Selling, 'F');
  assert.equal(restored.openMarketSync.finalRegistrationProgress, 100);
  assert.equal(restored.assets.length, 20);
  assert.equal(Object.keys(restored.product.dbFieldSettings).length, 17);
});

test('같은 시도에서는 실제 완료 시각이 뒤인 verified 기록을 pending이나 failed가 막지 않는다', () => {
  const preserve = loadPreserver();
  const verified = factory({ successful: true });
  verified.product.cafe24RegistrationReceipt.capturedAt = 300;
  verified.product.cafe24RegistrationReceipt.verifiedAt = 500;
  verified.openMarketSync.finalRegistrationUpdatedAt = 500;

  for (const status of ['failed', 'pending']) {
    const unfinished = factory({ successful: false });
    unfinished.product.cafe24RegistrationReceipt.capturedAt = 300;
    unfinished.product.cafe24RegistrationReceipt.status = status;
    unfinished.openMarketSync.finalRegistrationUpdatedAt = 400;
    assert.equal(preserve(verified, unfinished).product.cafe24RegistrationReceipt.status, 'verified');
  }
});

test('verified 기록은 실제 비교와 receipt identity가 모두 현재 factory 범위와 맞아야 한다', () => {
  const preserve = loadPreserver();
  for (const mutate of [
    value => { value.product.cafe24RegistrationReceipt.comparisons = []; },
    value => { value.product.cafe24RegistrationReceipt.comparisons = [{ matched: false }]; },
    value => { value.product.cafe24RegistrationReceipt.identity.runId = 'foreign-run'; },
  ]) {
    const invalid = factory({ successful: true });
    mutate(invalid);
    assert.equal(preserve(factory({ successful: false }), invalid).product.cafe24RegistrationReceipt.status, 'failed');
  }
});

test('null receipt는 삭제 명령이 아니며 receipt 없는 publication 기록도 thin 복원에서 유지한다', () => {
  const preserve = loadPreserver();
  const thin = factory({ successful: false });
  thin.product.cafe24RegistrationReceipt = null;
  delete thin.product.cafe24PublicationReceipt;
  delete thin.product.finalDb.product_no;
  thin.openMarketSync = {};
  assert.equal(preserve(thin, factory({ successful: true })).product.cafe24RegistrationReceipt.status, 'verified');

  const publicationOnly = factory({ successful: true });
  delete publicationOnly.product.cafe24RegistrationReceipt;
  const restored = preserve(thin, publicationOnly);
  assert.equal(restored.product.cafe24RegistrationReceipt, undefined);
  assert.equal(restored.product.cafe24PublicationReceipt.productNo, '3027');
});

test('receipt 상품번호보다 현재 finalDb와 실제 선택 후보를 우선해 foreign success를 차단한다', () => {
  const preserve = loadPreserver();
  for (const selectedTarget of [false, true]) {
    const staleSuccess = factory({ successful: true });
    staleSuccess.product.finalDb.product_no = selectedTarget ? '' : '4000';
    staleSuccess.product.selectedCafe24CandidateKey = selectedTarget ? '4000' : '';
    staleSuccess.product.cafe24Candidates = selectedTarget ? [{ product_no: '4000' }] : [];
    const current = factory({ successful: false });
    current.product.finalDb.product_no = '4000';
    current.product.selectedCafe24CandidateKey = selectedTarget ? '4000' : '';
    current.product.cafe24Candidates = selectedTarget ? [{ product_no: '4000' }] : [];
    assert.equal(preserve(current, staleSuccess).product.cafe24RegistrationReceipt.verifiedAt, undefined);
    assert.equal(preserve(current, staleSuccess).product.cafe24PublicationReceipt, undefined);
  }
});

test('persisted UserTouched flag만 같고 설정값이 같으면 오래된 failed 기록을 강제로 고르지 않는다', () => {
  const preserve = loadPreserver();
  const incoming = factory({ successful: false });
  incoming.openMarketSync.finalTarget = 'cafe24_only';
  incoming.openMarketSync.finalTargetUserTouched = true;
  const restored = preserve(incoming, factory({ successful: true }));
  assert.equal(restored.openMarketSync.finalTarget, 'cafe24_only');
  assert.equal(restored.product.cafe24RegistrationReceipt.status, 'verified');
});

test('C18: 등록 시각 0인 실제 정규화 thin snapshot은 absent/null receipt를 삭제로 취급하지 않는다', () => {
  const runtime = loadRealNormalizerPreserver();
  const current = factory({ successful: true });
  const outcomes = [];
  for (const receiptShape of ['absent', 'null']) {
    const thin = factory({ successful: false });
    delete thin.product.cafe24RegistrationReceipt;
    delete thin.product.cafe24PublicationReceipt;
    delete thin.product.finalDb.product_no;
    if (receiptShape === 'null') {
      thin.product.cafe24RegistrationReceipt = null;
      thin.product.cafe24PublicationReceipt = null;
    }
    thin.openMarketSync = { finalRegistrationUpdatedAt: 0 };
    thin.assets = [];
    thin.product.dbFieldSettings = {};
    const normalized = runtime.normalizeFactoryState(thin);
    assert.equal(normalized.openMarketSync.finalRegistrationUpdatedAt, 0);
    const restored = runtime.preserve(normalized, current);
    assert.deepEqual(restored.assets, current.assets);
    assert.deepEqual(restored.product.dbFieldSettings, current.product.dbFieldSettings);
    outcomes.push({
      receiptShape,
      status: restored.product.cafe24RegistrationReceipt?.status ?? null,
      display: restored.openMarketSync.cafe24Display,
      selling: restored.openMarketSync.cafe24Selling,
      progress: restored.openMarketSync.finalRegistrationProgress,
    });
  }
  assert.deepEqual(outcomes, ['absent', 'null'].map(receiptShape => ({
    receiptShape, status: 'verified', display: 'F', selling: 'F', progress: 100,
  })));
});

test('same-work 일반 로그는 80개 초과·반복 발생·novel incoming을 원본 normalize/preserve/writer 뒤에도 보존한다', () => {
  const runtime = loadRealNormalizerPreserver();
  const same = (actual, expected) => isDeepStrictEqual(structuredClone(actual), expected);
  const row = (message, extra = {}) => ({
    time: '오전 10:00:00', message, type: 'info',
    workspaceId: 'log-work', currentRunId: 'log-run', productKey: '로그상품',
    inputImageFingerprint: 'log-image', stageId: 'general', scopeKey: 'log-scope',
    metadata: { left: 1, right: 2 }, ...extra,
  });
  const ordinary = Array.from({ length: 81 }, (_, index) => row('일반 기록 ' + index));
  const repeated = row('반복 일반 기록');
  const warning = row('로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다: 401', { type: 'warn' });
  const reorder = value => Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [
    key, child && typeof child === 'object' && !Array.isArray(child) ? reorder(child) : child,
  ]));
  const current = {
    workspace: { id: 'log-work' }, automation: { currentRunId: 'log-run' },
    product: { productName: '로그상품', productKey: '로그상품', inputImageFingerprint: 'log-image' },
    logs: [...ordinary, repeated, structuredClone(repeated), warning, { ...warning, stageId: 'export' }],
  };
  const novel = [
    row('새 일반 기록'),
    row(ordinary[0].message, { time: '오전 10:00:01' }),
    row(ordinary[0].message, { currentRunId: 'another-run', scopeKey: 'another-scope' }),
  ];
  const incoming = {
    ...structuredClone(current),
    logs: [reorder(ordinary[80]), ...Array.from({ length: 3 }, () => reorder(repeated)), ...novel, { ...warning, stageId: 'db' }],
  };
  const inputsBefore = structuredClone([current, incoming]);
  const expectedCurrent = [...ordinary, repeated, structuredClone(repeated), warning];
  const expectedMerged = [...expectedCurrent, repeated, ...novel];
  const normalizedCurrent = runtime.normalizeFactoryState(structuredClone(current));
  const normalizedIncoming = runtime.normalizeFactoryState(structuredClone(incoming));
  const restored = runtime.preserve(normalizedIncoming, normalizedCurrent);
  const preservedExact = same(restored.logs, expectedMerged);
  const secondRestoreExact = same(runtime.preserve(normalizedIncoming, restored).logs, expectedMerged);
  const writerRow = runtime.factoryLog('writer 일반 기록', 'info', restored, { patchGoalRun: false });
  const rewritten = runtime.normalizeFactoryState(restored);
  const foreignScopeUnmixed = [
    value => { value.workspace.id = 'foreign-work'; },
    value => { value.product.productName = '다른상품'; value.product.productKey = '다른상품'; },
    value => { value.product.inputImageFingerprint = 'foreign-image'; },
  ].every(mutate => {
    const foreign = structuredClone(incoming);
    mutate(foreign);
    const expected = runtime.normalizeFactoryState(structuredClone(foreign)).logs;
    return same(runtime.preserve(foreign, current).logs, structuredClone(expected));
  });
  assert.deepEqual({
    normalizedCurrentCount: normalizedCurrent.logs.length,
    normalizedCurrentExact: same(normalizedCurrent.logs, expectedCurrent),
    preservedExact, secondRestoreExact,
    finalCount: rewritten.logs.length,
    finalOrderAndRawRowsExact: same(rewritten.logs, [structuredClone(writerRow), ...expectedMerged]),
    repeatCount: rewritten.logs.filter(log => log.message === repeated.message).length,
    warningCount: rewritten.logs.filter(log => log.message === warning.message).length,
    writerScopeExact: same({
      workspaceId: writerRow.workspaceId, currentRunId: writerRow.currentRunId,
      productKey: writerRow.productKey, inputImageFingerprint: writerRow.inputImageFingerprint,
    }, { workspaceId: 'log-work', currentRunId: 'log-run', productKey: '로그상품', inputImageFingerprint: 'log-image' }),
    foreignScopeUnmixed,
    inputsUnchanged: same([current, incoming], inputsBefore),
  }, {
    normalizedCurrentCount: 84, normalizedCurrentExact: true,
    preservedExact: true, secondRestoreExact: true,
    finalCount: 89, finalOrderAndRawRowsExact: true, repeatCount: 3, warningCount: 1,
    writerScopeExact: true, foreignScopeUnmixed: true, inputsUnchanged: true,
  });
});
