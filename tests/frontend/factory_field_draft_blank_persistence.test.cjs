const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');
const REVIEW_SOURCE = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');

function loadDraftWriter() {
  const start = SOURCE.indexOf('function factorySetAutomationWizardFieldDraft(');
  const end = SOURCE.indexOf('function factoryCommitAutomationWizardFieldFromButton(', start + 1);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    String,
    Date,
    factoryRuntimeUpdateOwnedFactory() { throw new Error('unexpected runtime branch'); },
    factoryAutomationWizardDrafts(current) {
      current.automation = current.automation || {};
      current.automation.fieldDrafts = current.automation.fieldDrafts || {};
      return current.automation.fieldDrafts;
    },
    factoryPersistAutomationWizardDrafts() {},
  });
  vm.runInContext(`${SOURCE.slice(start, end)}\nthis.writeDraft = factorySetAutomationWizardFieldDraft;`, context);
  return context.writeDraft;
}

function loadReviewSummary() {
  const start = REVIEW_SOURCE.indexOf('function factoryAutomationReviewSummary(');
  const end = REVIEW_SOURCE.indexOf('function factoryAutomationSizeReviewStatus(', start + 1);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    String,
    factoryAutomationFieldReviewItems() {
      return [{ id: 'size', label: '사이즈/규격', status: 'done', group: '생성 필수', required: true, value: '가로21cm*세로14cm' }];
    },
  });
  vm.runInContext(`${REVIEW_SOURCE.slice(start, end)}\nthis.reviewSummary = factoryAutomationReviewSummary;`, context);
  return context.reviewSummary;
}

function loadReviewSummaryWithDraftHydration() {
  const start = REVIEW_SOURCE.indexOf('function factoryAutomationReviewSummary(');
  const end = REVIEW_SOURCE.indexOf('function factoryAutomationSizeReviewStatus(', start + 1);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = vm.createContext({
    String,
    calls,
    factoryAutomationWizardDrafts(factory) {
      calls.push(factory);
      factory.automation = factory.automation || {};
      factory.automation.fieldDrafts = { size: { value: '저장된 사이즈' } };
      return factory.automation.fieldDrafts;
    },
    factoryAutomationFieldReviewItems() {
      return [{ id: 'size', label: '사이즈/규격', status: 'done', group: '생성 필수', required: true, value: '가로21cm*세로14cm' }];
    },
  });
  vm.runInContext(`${REVIEW_SOURCE.slice(start, end)}\nthis.reviewSummary = factoryAutomationReviewSummary; this.calls = calls;`, context);
  return { reviewSummary: context.reviewSummary, calls: context.calls };
}

function loadDraftReader(raw, workKey, checkpointRaw = null) {
  const start = SOURCE.indexOf('function factoryReadAutomationWizardDraftPayload(');
  const end = SOURCE.indexOf('function factoryPersistAutomationWizardDrafts(', start + 1);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    JSON,
    String,
    FACTORY_WIZARD_FIELD_DRAFT_STORAGE_KEY: 'factory_drafts',
    LAST_WORK_INPUT_CHECKPOINT_KEY: 'input_checkpoint',
    factoryRuntimeReadFactory() { return {}; },
    workspaceSessionGetItem(key) { return key === 'factory_drafts' ? raw : checkpointRaw; },
    factoryAutomationWizardDraftWorkKey() { return workKey; },
    factoryNormalizeIdentityText(value) { return String(value || '').trim().toLowerCase(); },
  });
  vm.runInContext(`${SOURCE.slice(start, end)}\nthis.readDraft = factoryReadAutomationWizardDraftPayload;`, context);
  return context.readDraft;
}

function loadDraftCollection(payload, workKey) {
  const start = SOURCE.indexOf('function factoryAutomationWizardDrafts(current)');
  const end = SOURCE.indexOf('function factorySetAutomationWizardFieldDraft(', start + 1);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    String,
    Object,
    setTimeout() {},
    render() {},
    state: { step: 'factory' },
    factoryAutomationWizardDraftHydratedWorkKey: '',
    factoryAutomationWizardDraftRenderScheduled: false,
    factoryAutomationWizardDraftWorkKey() { return workKey; },
    factoryReadAutomationWizardDraftPayload() { return payload; },
  });
  vm.runInContext(`${SOURCE.slice(start, end)}\nthis.readDrafts = factoryAutomationWizardDrafts;`, context);
  return context.readDrafts;
}

test('빈 편집 입력은 수정 적용 전 기존 초안을 지우지 않는다', () => {
  const writeDraft = loadDraftWriter();
  const current = {
    automation: {
      fieldDrafts: { size: { value: '가로21cm*세로14cm' } },
    },
  };
  writeDraft({ value: '', dataset: { factoryWizardField: 'size', factoryWizardLabel: '사이즈/규격', factoryWizardPreviousValue: '가로21cm*세로14cm' } }, current);
  assert.equal(current.automation.fieldDrafts.size.value, '가로21cm*세로14cm');
});

test('빈 입력은 DOM 기준 이전 값도 초안으로 보존한다', () => {
  const writeDraft = loadDraftWriter();
  const current = { automation: { fieldDrafts: {} } };
  writeDraft({ value: '', dataset: { factoryWizardField: 'size', factoryWizardLabel: '사이즈/규격', factoryWizardPreviousValue: '가로21cm*세로14cm' } }, current);
  assert.equal(current.automation.fieldDrafts.size.value, '가로21cm*세로14cm');
});

test('같은 작업공간·제품의 초기 키 차이는 초안을 복원한다', () => {
  const readDraft = loadDraftReader(JSON.stringify({ workKey: 'project-a|run-old|product-a|image-old', drafts: { size: { value: '가로21cm*세로14cm' } } }), 'project-a|run-new|product-a|image-new');
  assert.equal(readDraft({}).drafts.size.value, '가로21cm*세로14cm');
});

test('다른 작업공간·제품의 초안은 복원하지 않는다', () => {
  const readDraft = loadDraftReader(JSON.stringify({ workKey: 'project-b|run-old|product-b|image-old', drafts: { size: { value: '오염' } } }), 'project-a|run-new|product-a|image-new');
  assert.equal(readDraft({}), null);
});

test('전용 초안이 비어도 같은 작업의 입력 체크포인트에서 사이즈 초안을 복원한다', () => {
  const checkpoint = JSON.stringify({
    savedAt: 42,
    checkpointScope: { workspaceId: 'project-a', productKey: 'product-a' },
    factory: { automation: { fieldDrafts: { size: { value: '가로21cm*세로14cm' } } } },
  });
  const readDraft = loadDraftReader(null, 'project-a|run-new|product-a|image-new', checkpoint);
  assert.equal(readDraft({}).drafts.size.value, '가로21cm*세로14cm');
});

test('빈 현재 초안은 저장된 정상 초안으로 병합한다', () => {
  const readDrafts = loadDraftCollection({ drafts: { size: { value: '가로21cm*세로14cm' } } }, 'project-a|run|product-a|image');
  const current = { automation: { fieldDrafts: { size: { value: '' } } } };
  assert.equal(readDrafts(current).size.value, '가로21cm*세로14cm');
});

test('현재의 정상 초안은 저장된 오래된 초안보다 우선한다', () => {
  const readDrafts = loadDraftCollection({ drafts: { size: { value: '오래된 값' } } }, 'project-a|run|product-a|image');
  const current = { automation: { fieldDrafts: { size: { value: '현재 값' } } } };
  assert.equal(readDrafts(current).size.value, '현재 값');
});

test('비어 있지 않은 필드 초안은 계속 저장한다', () => {
  const writeDraft = loadDraftWriter();
  const current = { automation: { fieldDrafts: {} } };
  writeDraft({ value: '가로21cm*세로14cm', dataset: { factoryWizardField: 'size', factoryWizardLabel: '사이즈/규격' } }, current);
  assert.equal(current.automation.fieldDrafts.size.value, '가로21cm*세로14cm');
});

test('빈 필드 초안은 확정값을 화면 요약에서 가리지 않는다', () => {
  const reviewSummary = loadReviewSummary();
  const summary = reviewSummary({ automation: { fieldDrafts: { size: { value: '' } } } }, {});
  assert.equal(summary.fields[0].hasDraft, undefined);
  assert.equal(summary.fields[0].value, '가로21cm*세로14cm');
});

test('값이 있는 필드 초안은 화면 요약에 반영한다', () => {
  const reviewSummary = loadReviewSummary();
  const summary = reviewSummary({ automation: { fieldDrafts: { size: { value: '수정 사이즈', updatedAt: 7 } } } }, {});
  assert.equal(summary.fields[0].hasDraft, true);
  assert.equal(summary.fields[0].draftValue, '수정 사이즈');
});

test('초기 필수값 요약도 저장된 사이즈 초안을 먼저 복원한다', () => {
  const { reviewSummary, calls } = loadReviewSummaryWithDraftHydration();
  const factory = { automation: { fieldDrafts: {} } };
  const summary = reviewSummary(factory, {});
  assert.equal(calls.length, 1, '초기 필수값 렌더 전에 저장 초안을 읽어야 합니다.');
  assert.equal(summary.fields[0].hasDraft, true);
  assert.equal(summary.fields[0].draftValue, '저장된 사이즈');
});
