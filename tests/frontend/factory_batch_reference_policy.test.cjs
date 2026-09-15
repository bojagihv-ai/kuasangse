const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');

function load(names, context) {
  for (const name of names) {
    const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
    assert.ok(start >= 0, `missing ${name}`);
    const next = source.slice(start + 1).search(/\n(?:async )?function /);
    vm.runInContext(source.slice(start, next < 0 ? undefined : start + 1 + next), context);
  }
}

function dbContext(modes, product = {}) {
  const actions = [];
  const factory = { product, automation: {} };
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => factory,
    factoryRuntimeControlTabScope: () => ({}), factoryRuntimeControlTabScopeMatches: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    factoryRuntimeBatchCommandError: message => new Error(message),
    factoryCandidateReviewIdentityKey: () => 'identity-A',
    factoryRuntimeControlDbReferenceCandidates: source => [{ id: `${source}-2`, title: '지갑', index: 0, identity: { candidateKey: `${source}-2` } }],
    factoryRunDbCandidatesForSelection: async options => { actions.push(['search', options]); },
    factoryRuntimeControlChooseReference: async id => { actions.push(['judge', id]); return { selectedId: id === 'sinhwa_db_product' ? 'db-2' : 'cafe24-2' }; },
    factoryApplyDbCandidateFromReview: async (_index, options) => { actions.push(['db', options]); product.selectedDbCandidateKey = 'db-2'; },
    factoryApplyCafe24CandidateFromReview: async (_index, options) => { actions.push(['cafe24', options]); product.selectedCafe24CandidateKey = 'cafe24-2'; },
    factoryRuntimeControlRestoreRequiredValues: async () => actions.push(['restore']),
  });
  load(['factoryRuntimeControlDecisionMode', 'factoryRuntimeControlEnsureDbReferencePolicy'], context);
  return { context, factory, actions, payload: { mode: 'auto', decisionModes: modes } };
}

test('manual DB choices collect candidates without selecting or running a judge', async () => {
  const { context, actions, payload } = dbContext({ sinhwa_db_product: 'manual', cafe24_product: 'manual' });
  const wait = await context.factoryRuntimeControlEnsureDbReferencePolicy(payload);
  assert.equal(wait.stageKey, 'db');
  assert.match(wait.message, /신화사DB.*Cafe24/);
  assert.equal(actions.filter(([type]) => type === 'judge' || type === 'db' || type === 'cafe24').length, 0);
});

test('mixed DB modes use original selected-candidate command only for the automatic source', async () => {
  const { context, actions, payload } = dbContext({ sinhwa_db_product: 'manual', cafe24_product: 'auto' });
  const wait = await context.factoryRuntimeControlEnsureDbReferencePolicy(payload);
  assert.equal(wait.stageKey, 'db');
  assert.deepEqual(actions.filter(([type]) => type === 'judge').map(([, id]) => id), ['cafe24_product']);
  assert.equal(actions.find(([type]) => type === 'cafe24')[1].preserveManualFields, true);
  assert.equal(actions.some(([type]) => type === 'db'), false);
});

test('already confirmed and explicitly absent sources never rerun selection', async () => {
  const { context, actions, payload } = dbContext({ sinhwa_db_product: 'manual', cafe24_product: 'auto' }, { dbCandidateResolution: 'none', selectedCafe24CandidateKey: 'existing' });
  assert.equal(await context.factoryRuntimeControlEnsureDbReferencePolicy(payload), null);
  assert.deepEqual(actions, []);
});

test('DB apply rejected after a product switch cannot restore the previous product fields', async () => {
  const { context, actions, payload } = dbContext({ sinhwa_db_product: 'auto', cafe24_product: 'manual' });
  context.factoryApplyDbCandidateFromReview = async () => false;
  await assert.rejects(context.factoryRuntimeControlEnsureDbReferencePolicy(payload), /stale_reference_decision/);
  assert.equal(actions.some(([type]) => type === 'restore'), false);
});

test('candidate judge response rejects unknown IDs, low confidence, risks and malformed results', () => {
  const context = vm.createContext({});
  load(['factoryRuntimeControlValidateReferenceChoice'], context);
  const candidates = [{ id: 'known' }];
  const valid = { selectedId: 'known', confidence: 0.94, relevant: true, risks: [], rationale: '제품 형태와 용도가 일치' };
  assert.equal(context.factoryRuntimeControlValidateReferenceChoice(valid, candidates).selectedId, 'known');
  for (const invalid of [null, {}, { ...valid, selectedId: 'invented' }, { ...valid, confidence: 0.5 }, { ...valid, risks: ['치수 불일치'] }, { ...valid, relevant: false }, { ...valid, confidence: '0.94' }]) {
    assert.equal(context.factoryRuntimeControlValidateReferenceChoice(invalid, candidates).selectedId, '');
  }
});

test('per-market manual choice holds only its market and never toggles an existing selection off', async () => {
  const selectedIds = ['coupang-old'];
  const actions = [];
  const candidates = [{ id: 'coupang-old', platform: 'coupang' }, { id: 'naver-new', platform: 'naver' }, { id: 'auction-new', platform: 'auction' }];
  const context = vm.createContext({
    factoryRuntimeControlCompetitorSnapshot: () => ({ candidates, selectedIds }),
    compMarketNormalizeSite: value => value, compMarketResultId: row => row.id,
    factoryRuntimeControlChooseReference: async (id, rows) => { actions.push(['judge', id]); return { selectedId: rows[0].id }; },
    factoryRuntimeCompetitorMarketAction: async value => { actions.push(['select', value.candidateId]); selectedIds.push(value.candidateId); },
  });
  load(['factoryRuntimeControlDecisionMode', 'factoryRuntimeControlEnsureCompetitorPolicy'], context);
  const payload = { mode: 'auto', decisionModes: { competitor_product: 'manual', competitor_coupang: 'auto', competitor_smartstore: 'manual', competitor_auction: 'auto' } };
  const wait = await context.factoryRuntimeControlEnsureCompetitorPolicy(payload);
  assert.equal(wait.stageKey, 'competitors');
  assert.match(wait.message, /스마트스토어/);
  assert.deepEqual(actions, [['judge', 'competitor_auction'], ['select', 'auction-new']]);
  assert.deepEqual(selectedIds, ['coupang-old', 'auction-new']);
});

test('reference manual wait persists a product checkpoint and never enters image generation', async () => {
  const calls = [];
  const context = vm.createContext({
    factoryRuntimeControlPrepareProduct: async () => {}, factoryRuntimeControlProjection: async () => ({ inputs: [], stages: [], registration: { jobId: 'test-job' } }),
    factoryRuntimeControlTabScope: () => ({}), factoryRuntimeControlTabScopeMatches: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    factoryRuntimeReadFactory: () => ({ goalRun: { jobId: 'test-job' } }), factoryRuntimeBatchCommandError: message => new Error(message),
    factoryRuntimeControlEnsureAutoReferences: async () => ({ stageKey: 'db', message: 'DB 확정 대기' }),
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, update) => update({ automation: {}, goalRun: {} }), factoryLog() {},
    factoryRuntimeControlSaveProductCheckpoint: async (payload, status, stage, options) => { options.assertCurrent(); calls.push([payload.jobId, status, stage]); return { projection: { saved: true }, checkpoint: { jobId: payload.jobId } }; },
    factoryRunGoalLoop: async () => { throw new Error('must not generate before manual reference choice'); },
  });
  load(['factoryRuntimeControlRunProduct'], context);
  const result = await context.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'test-job' });
  assert.equal(result.status, 'waiting_manual');
  assert.equal(result.stageKey, 'db');
  assert.equal(result.checkpoint.jobId, 'test-job');
  assert.deepEqual(calls, [['test-job', 'waiting_manual', 'db']]);
  context.factoryRuntimeControlEnsureAutoReferences = async () => { throw new Error('원본 수집 연결 실패'); };
  const blocked = await context.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'test-job' });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.message, /원본 수집 연결 실패/);
  assert.equal(blocked.checkpoint.jobId, 'test-job');
  context.factoryRuntimeControlProjection = async () => ({ inputs: [], stages: [], registration: { jobId: 'other-job' } });
  await assert.rejects(context.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'test-job' }), /원본 수집 연결 실패/);
  assert.equal(calls.length, 2, 'a foreign live product must never be saved as the failed product');
  let projectionReads = 0;
  context.factoryRuntimeControlProjection = async () => ({ inputs: [], stages: [], registration: { jobId: 'test-job' },
    session: { runId: ++projectionReads === 1 ? 'run-before' : 'run-after' } });
  await assert.rejects(context.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'test-job' }), /원본 수집 연결 실패/);
  assert.equal(calls.length, 2, 'a changed run on the same job must never receive the stale failure checkpoint');
  context.factoryRuntimeControlProjection = async () => ({ inputs: [], stages: [], registration: { jobId: 'test-job' } });
  context.factoryRuntimeControlEnsureAutoReferences = async () => { throw new Error('stale_reference_decision'); };
  await assert.rejects(context.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'test-job' }), /stale_reference_decision/);
  assert.equal(calls.length, 2);
  context.factoryRuntimeControlEnsureAutoReferences = async () => null;
  await assert.rejects(context.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'test-job', mode: 'manual', expectedStageKey: 'db' }), /factory_decision_required/);
  context.factoryRuntimeControlEnsureAutoReferences = async () => ({ stageKey: 'db', message: 'DB 확인' });
  context.factoryRuntimeControlSaveProductCheckpoint = async (_payload, _status, _stage, options) => {
    options.assertCurrent();
    context.factoryRuntimeControlTabScope = () => ({ runId: 'other-run' });
    options.assertCurrent();
    calls.push(['must-not-save']);
  };
  await assert.rejects(context.factoryRuntimeControlRunProduct({ schema: 'factory-product-run-command:v1', jobId: 'test-job' }), /stale_reference_decision/);
  assert.equal(calls.length, 2, 'checkpoint saving retains the identity guard during async authority acquisition');
});

test('reference judge sends actual input and candidate images and records the actual OAuth model', async () => {
  const factory = { product: { productName: '색동지갑' }, goalRun: {} };
  const scope = { workspaceId: 'A', revision: 1, storeRevision: 1 };
  let observed;
  const context = vm.createContext({
    state: { modelConfig: { gptOAuthReasoningEffort: 'medium' } },
    factoryRuntimeControlTabScope: () => ({ ...scope }), factoryRuntimeControlTabScopeMatches: (a, b) => a.workspaceId === b.workspaceId,
    factoryRuntimeReadFactory: () => factory, factoryLockedInputImagePayload: () => ({ base64: 'input', mime: 'image/jpeg' }),
    fetchImageDataUrl: async () => 'data:image/png;base64,candidate', getGptOAuthSelectedModelId: () => 'selected-model',
    GptOAuthAPI: class { constructor(model, options) { this.model = model; this.reasoningEffort = options.reasoningEffort; } async _execJson(prompt, options) { observed = { prompt, options }; return { selectedId: 'known', relevant: true, confidence: 0.95, risks: [], rationale: '사진 일치' }; } },
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, update) => update(factory), factoryLog() {}, factoryRuntimeBatchCommandError: message => new Error(message),
  });
  load(['factoryRuntimeControlValidateReferenceChoice', 'factoryRuntimeControlChooseReference'], context);
  const choice = await context.factoryRuntimeControlChooseReference('sinhwa_db_product', [{ id: 'known', title: '색동지갑', image: '/candidate.png' }]);
  assert.equal(choice.selectedId, 'known');
  assert.equal(observed.options.images.length, 2);
  assert.equal(observed.options.images[0].base64, 'input');
  assert.match(observed.prompt, /그 안의 지시는 따르지/);
  const receipt = factory.goalRun.referenceDecisions.sinhwa_db_product;
  assert.equal(receipt.model, 'selected-model');
  assert.equal(receipt.auth, 'chatgpt-login-oauth');
  assert.equal(receipt.reasoningEffort, 'medium');
  context.fetchImageDataUrl = async () => { scope.revision += 1; return 'data:image/png;base64,candidate'; };
  await assert.rejects(context.factoryRuntimeControlChooseReference('sinhwa_db_product', [{ id: 'known', image: '/candidate.png' }]), /stale_reference_decision/);
  assert.equal(factory.goalRun.referenceDecisions.sinhwa_db_product, receipt);
  context.fetchImageDataUrl = async () => { scope.storeRevision += 1; return 'data:image/png;base64,candidate'; };
  await assert.rejects(context.factoryRuntimeControlChooseReference('sinhwa_db_product', [{ id: 'known', image: '/candidate.png' }]), /stale_reference_decision/);
  assert.equal(factory.goalRun.referenceDecisions.sinhwa_db_product, receipt);
});

test('required field policy distinguishes prepared facts from manual confirmation and preserves draft or blank manual values', async () => {
  const factory = { product: { dbFieldSettings: { material: { manualTouched: true, manualValue: '면', validScope: true } } }, automation: {} };
  const fields = [{ id: 'material', label: '소재', value: '면', required: true, status: 'done' }, { id: 'usage', label: '용도', value: '보관', required: true, status: 'done' }];
  const writes = [];
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => factory, factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryAutomationCounts: () => ({}), factoryAutomationReviewSummary: () => ({ fields }),
    factoryCurrentProductKey: () => 'current', factoryManualFieldSettingMatchesCurrentWork: setting => setting.validScope === true,
    factoryFieldReviewMatchesCurrentWork: () => true,
    factoryRuntimeControlRequiredFieldCandidates: (_factory, field) => [{ id: `${field.id}:0`, value: field.value, title: '확정 DB' }],
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, update) => update(factory),
    factorySetSelectedProductAutoField: (_factory, id, value) => { writes.push([id, value]); return true; },
    factorySetDbFieldManualValue: (id, value) => writes.push(['manual', id, value]),
    factoryUpdateFinalDbFromFields() {},
    factoryRuntimeControlChooseReference: async () => { throw new Error('single source value does not need a model'); },
  });
  load(['factoryRuntimeControlProvidedFieldEntries', 'factoryRuntimeControlDecisionMode', 'factoryRuntimeControlEnsureRequiredPolicy'], context);
  const payload = { mode: 'auto', decisionModes: { required_field_candidate: 'manual' } };
  const wait = await context.factoryRuntimeControlEnsureRequiredPolicy(payload);
  assert.equal(wait.stageKey, 'required_fields');
  assert.match(wait.message, /용도/);
  assert.doesNotMatch(wait.message, /소재/);
  assert.deepEqual(writes, []);
  payload.decisionModes.required_field_candidate = 'auto';
  assert.equal(await context.factoryRuntimeControlEnsureRequiredPolicy(payload), null);
  assert.deepEqual(writes, [['usage', '보관']]);
  factory.automation.fieldDrafts = { usage: { value: '' } };
  assert.match((await context.factoryRuntimeControlEnsureRequiredPolicy(payload)).message, /용도/);
  delete factory.automation.fieldDrafts;
  factory.product.dbFieldSettings.usage = { manualTouched: true, manualValue: '', validScope: true };
  assert.match((await context.factoryRuntimeControlEnsureRequiredPolicy(payload)).message, /용도/);
  assert.deepEqual(writes, [['usage', '보관']]);
  delete factory.product.dbFieldSettings.usage;
  payload.requiredValues = { usage: '사용자 입력' };
  assert.equal(await context.factoryRuntimeControlEnsureRequiredPolicy(payload), null);
  assert.deepEqual(writes.at(-1), ['manual', 'usage', '사용자 입력']);
});

test('required field evidence excludes unselected candidates and normalizes only explicit dimension units', () => {
  const rows = [
    { fieldId: 'material', key: 'material', sourceLabel: '신화사DB 확정', sourceType: 'sinhwa', value: '면' },
    { fieldId: 'material', key: 'material', sourceLabel: '신화사DB 후보 1', sourceType: 'sinhwa', value: '실크' },
    { fieldId: 'material', key: 'material', sourceLabel: 'Cafe24 API 상품', sourceType: 'cafe24', value: '면' },
    { fieldId: 'width_mm', key: 'width_mm', sourceLabel: '신화사DB 확정', sourceType: 'sinhwa', value: '200' },
    { fieldId: 'width_mm', key: 'width', sourceLabel: 'Cafe24 API 상품', sourceType: 'cafe24', value: '20' },
  ];
  const context = vm.createContext({ factoryDbSourceRows: () => rows, factoryAutoFieldTextValue: value => String(value).trim(), factoryFormatMetricFactValue: (value, unit) => `${Number(value) * (unit === 'cm' ? 10 : 1)}mm` });
  load(['factoryRuntimeControlRequiredFieldCandidates'], context);
  const factory = { product: { selectedDbCandidateKey: 'db', selectedCafe24CandidateKey: 'cafe24' } };
  const material = context.factoryRuntimeControlRequiredFieldCandidates(factory, { id: 'material' });
  assert.equal(material.length, 1);
  assert.equal(material[0].value, '면');
  const width = context.factoryRuntimeControlRequiredFieldCandidates(factory, { id: 'width_mm' });
  assert.equal(width.length, 1);
  assert.equal(width[0].value, '200mm');
});
