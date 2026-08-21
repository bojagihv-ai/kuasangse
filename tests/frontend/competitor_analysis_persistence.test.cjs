'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable: ${startMarker}`);
  return source.slice(start, end);
}

test('작업파일에 연결된 초안의 후보 선택은 서버 프로젝트 스냅샷으로 저장한다', async () => {
  const core02 = read('src/app-core-02.js');
  const saveSource = sourceBetween(
    core02,
    'async function saveServerLastWorkSnapshot(',
    'function scheduleServerLastWorkSave(',
  );
  let built = null;
  let committed = null;
  const authorityScopes = [];
  const context = vm.createContext({
    captureWorkspaceDocumentFence: () => ({ scopeId: 'draft:tab', resetToken: 0 }),
    workspaceDocumentFenceIsCurrent: () => true,
    workspaceScopeTransitionState: { inProgress: false },
    serverLastWorkHydrated: true,
    serverLastWorkRetryAfter: 0,
    serverLastWorkSavePromise: null,
    serverLastWorkSaveRequestedAgain: false,
    serverLastWorkForceSaveRequested: false,
    serverLastWorkFactorySnapshotRequested: null,
    serverLastWorkFailureCount: 0,
    serverLastWorkLastSavedAt: 0,
    getCurrentDocumentWorkspaceScope: () => 'project:current',
    getCurrentLastWorkWorkspaceScope: () => 'draft:tab',
    ensureWorkspaceEditAuthority: async scopeId => {
      authorityScopes.push(scopeId);
      return { mode: 'editing', scopeId };
    },
    buildServerLastWorkSnapshot: (reason, options) => {
      built = { reason, options };
      return { assets: { compPage: { marketScrape: { selectedIds: ['candidate-1'] } } }, savedAt: 100 };
    },
    sessionAssetsForAuthoritativeCommit: async () => null,
    lastWorkSnapshotScore: () => 2,
    state: { contentVersion: 1 },
    workspacePersistenceApi: () => ({
      commit: async command => {
        committed = command;
        return { accepted: true, partial: false, stale: false, protectedNoOp: false, clean: true };
      },
    }),
    workspaceCommitMetadata: () => ({}),
    workspaceSnapshotRevision: () => null,
    getServerLastWorkBases: () => [],
    serverLastWorkFailureDelayMs: () => 0,
    scheduleServerLastWorkSave: () => {},
    Date: { now: () => 100 },
    console: { warn() {} },
  });
  vm.runInContext(`${saveSource}\nglobalThis.save = saveServerLastWorkSnapshot;`, context);

  await context.save('manual-now');

  assert.equal(committed.scopeId, 'project:current');
  assert.equal(built.reason, 'manual-now');
  assert.deepEqual(authorityScopes, ['project:current', 'draft:tab']);
});

test('작업파일 프로젝트 스냅샷은 draft 전용 branch를 만들지 않는다', () => {
  const core02 = read('src/app-core-02.js');
  const snapshotSource = sourceBetween(
    core02,
    'function buildServerLastWorkSnapshot(',
    'function workspaceCommitMetadata(',
  );
  const context = vm.createContext({
    state: { currentProjectId: 'current', productName: '모시꽃수파우치' },
    lastLightweightSessionPayload: null,
    getCurrentDocumentWorkspaceScope: () => 'project:current',
    getCurrentLastWorkWorkspaceScope: () => 'draft:tab',
    factoryRuntimeReadCommittedFactory: () => ({ product: { productName: '모시꽃수파우치' } }),
    currentSessionAssetsPayload: () => ({ compPage: { marketScrape: { selectedIds: ['candidate-1'] } } }),
    buildLightweightSessionPayload: () => ({ compPage: { marketScrape: { selectedIds: ['candidate-1'] } } }),
    sanitizeLastWorkPayloadProductScope: value => value,
    currentWorkspaceRevision: () => ({ counter: 1 }),
    currentWorkspaceBranch: scopeId => {
      if (String(scopeId).startsWith('project:')) throw new Error('work branch scope must be a draft scope');
      return { scopeId };
    },
    compactProductImageBackupPayload: () => ({}),
    location: { origin: 'http://127.0.0.1:8081', href: 'http://127.0.0.1:8081/app.html' },
    navigator: { userAgent: 'test' },
    Date: { now: () => 100 },
  });
  vm.runInContext(`${snapshotSource}\nglobalThis.build = buildServerLastWorkSnapshot;`, context);

  const snapshot = context.build('candidate-selection');

  assert.equal(snapshot.workspaceId, 'project:current');
  assert.equal(snapshot.workspaceBranch, null);
});

test('작업 저장은 조립공장 후보 사본의 이전 작업 식별값을 서버 snapshot까지 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const core03 = read('src/app-core-03.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeSameWorkDerivedValue(',
    'function recoverStaleSessionInlineImages(',
  );
  const payloadSource = sourceBetween(
    core03,
    'function buildWorkspacePayload(',
    'function restoreProjectFileFactoryAssetsFromPayload(',
  );
  let receivedCompPage = null;
  const context = vm.createContext({
    state: {
      currentProjectId: 'manual-cut-project',
      currentProjectName: '수동 A컷 검증',
      currentProjectCreatedAt: 1,
      compPage: {
        marketScrape: {
          results: [{
            id: 'coupang_8441491560',
            factoryWorkKey: 'project:manual-cut-project',
          }],
        },
      },
    },
    workspacePersistenceApi: () => ({ normalizeWorkspaceScope: value => value }),
    getCurrentLastWorkWorkspaceScope: () => 'project:manual-cut-project',
    factoryRuntimeReadCommittedFactory: () => ({
      competitors: {
        compPage: {
          marketScrape: {
            results: [{
              id: 'coupang_8441491560',
              factoryWorkKey: 'project:manual-cut-project',
              sourceFactoryWorkKey: 'batch:prior-job',
            }],
          },
        },
      },
    }),
    cloneData: value => structuredClone(value),
    factoryStampWorkspaceIdentity() {},
    factoryEnsureCurrentDetailHtmlAsset() {},
    currentWorkspaceInputImageFingerprint: () => '',
    ensureActiveWorkIdentity: () => ({ workspaceId: 'project:manual-cut-project' }),
    deriveProjectName: () => '수동 A컷 검증',
    sectionWorkScopeMeta: () => ({}),
    normalizeAnalysisMatchSettings: () => ({}),
    normalizeProductInfoFieldSettings: () => ({}),
    loadFixedDetailImages: () => ({}),
    currentWorkspaceRevision: () => null,
    currentWorkspaceBranch: () => null,
    currentSessionAssetsPayload: options => {
      receivedCompPage = options.compPageSnapshot || null;
      return { compPage: receivedCompPage };
    },
    buildLightweightSessionPayload: value => value,
    productImageBackupReferencePayload: () => ({}),
    Date: { now: () => 100 },
  });
  vm.runInContext(`${mergeSource}\n${payloadSource}\nglobalThis.build = buildWorkspacePayload;`, context);

  const payload = context.build({ scopeId: 'project:manual-cut-project' });

  assert.equal(payload.compPage.marketScrape.results[0].sourceFactoryWorkKey, 'batch:prior-job');
  assert.equal(receivedCompPage.marketScrape.results[0].sourceFactoryWorkKey, 'batch:prior-job');
});

test('작업 저장은 기존 저장본에만 남은 경쟁사 후보 작업 키를 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const core03 = read('src/app-core-03.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeSameWorkDerivedValue(',
    'function recoverStaleSessionInlineImages(',
  );
  const payloadSource = sourceBetween(
    core03,
    'function buildWorkspacePayload(',
    'function restoreProjectFileFactoryAssetsFromPayload(',
  );
  let receivedCompPage = null;
  const currentResult = {
    id: 'content',
    content: {
      coupang_8441491560: { factoryWorkKey: 'project:manual-cut-project' },
    },
  };
  const storedResult = {
    id: 'content',
    content: {
      coupang_8441491560: {
        factoryWorkKey: 'project:manual-cut-project',
        sourceFactoryWorkKey: 'batch:prior-job',
      },
    },
  };
  const context = vm.createContext({
    state: {
      currentProjectId: 'manual-cut-project',
      currentProjectName: '수동 A컷 검증',
      currentProjectCreatedAt: 1,
      compPage: { marketScrape: { results: [currentResult] } },
    },
    workspacePersistenceApi: () => ({ normalizeWorkspaceScope: value => value }),
    getCurrentLastWorkWorkspaceScope: () => 'project:manual-cut-project',
    factoryRuntimeReadCommittedFactory: () => ({
      competitors: { compPage: { marketScrape: { results: [currentResult] } } },
    }),
    cloneData: value => structuredClone(value),
    factoryStampWorkspaceIdentity() {},
    factoryEnsureCurrentDetailHtmlAsset() {},
    currentWorkspaceInputImageFingerprint: () => '',
    ensureActiveWorkIdentity: () => ({ workspaceId: 'project:manual-cut-project' }),
    deriveProjectName: () => '수동 A컷 검증',
    sectionWorkScopeMeta: () => ({}),
    normalizeAnalysisMatchSettings: () => ({}),
    normalizeProductInfoFieldSettings: () => ({}),
    loadFixedDetailImages: () => ({}),
    currentWorkspaceRevision: () => null,
    currentWorkspaceBranch: () => null,
    currentSessionAssetsPayload: options => {
      receivedCompPage = options.compPageSnapshot || null;
      return { compPage: receivedCompPage };
    },
    buildLightweightSessionPayload: value => value,
    productImageBackupReferencePayload: () => ({}),
    Date: { now: () => 100 },
  });
  vm.runInContext(`${mergeSource}\n${payloadSource}\nglobalThis.build = buildWorkspacePayload;`, context);

  const payload = context.build({
    scopeId: 'project:manual-cut-project',
    storedCompPage: { marketScrape: { results: [storedResult] } },
  });

  assert.equal(
    payload.compPage.marketScrape.results[0].content.coupang_8441491560.sourceFactoryWorkKey,
    'batch:prior-job',
  );
  assert.equal(
    receivedCompPage.marketScrape.results[0].content.coupang_8441491560.sourceFactoryWorkKey,
    'batch:prior-job',
  );
});

test('작업 저장은 same-work map 형태 경쟁사 결과의 product_id를 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const core03 = read('src/app-core-03.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeSameWorkDerivedValue(',
    'function recoverStaleSessionInlineImages(',
  );
  const payloadSource = sourceBetween(
    core03,
    'function buildWorkspacePayload(',
    'function restoreProjectFileFactoryAssetsFromPayload(',
  );
  const resultKey = 'coupang_8441491560';
  const storedResults = {
    content: {
      [resultKey]: { product_id: '8441491560', factoryWorkKey: 'project:manual-cut-project' },
    },
  };
  const currentResults = {
    content: {
      [resultKey]: { factoryWorkKey: 'project:manual-cut-project' },
    },
  };
  let receivedCompPage = null;
  const context = vm.createContext({
    state: {
      currentProjectId: 'manual-cut-project',
      currentProjectName: '수동 A컷 검증',
      currentProjectCreatedAt: 1,
      compPage: { marketScrape: { results: currentResults } },
    },
    workspacePersistenceApi: () => ({ normalizeWorkspaceScope: value => value }),
    getCurrentLastWorkWorkspaceScope: () => 'project:manual-cut-project',
    factoryRuntimeReadCommittedFactory: () => ({
      competitors: { compPage: { marketScrape: { results: currentResults } } },
    }),
    cloneData: value => structuredClone(value),
    factoryStampWorkspaceIdentity() {},
    factoryEnsureCurrentDetailHtmlAsset() {},
    currentWorkspaceInputImageFingerprint: () => '',
    ensureActiveWorkIdentity: () => ({ workspaceId: 'project:manual-cut-project' }),
    deriveProjectName: () => '수동 A컷 검증',
    sectionWorkScopeMeta: () => ({}),
    normalizeAnalysisMatchSettings: () => ({}),
    normalizeProductInfoFieldSettings: () => ({}),
    loadFixedDetailImages: () => ({}),
    currentWorkspaceRevision: () => null,
    currentWorkspaceBranch: () => null,
    currentSessionAssetsPayload: options => {
      receivedCompPage = options.compPageSnapshot || null;
      return { compPage: receivedCompPage };
    },
    buildLightweightSessionPayload: value => value,
    productImageBackupReferencePayload: () => ({}),
    Date: { now: () => 100 },
  });
  vm.runInContext(
    mergeSource + '\n' + payloadSource + '\nglobalThis.build = buildWorkspacePayload;',
    context,
  );

  const payload = context.build({
    scopeId: 'project:manual-cut-project',
    storedCompPage: { marketScrape: { results: storedResults } },
  });

  assert.equal(Array.isArray(payload.compPage.marketScrape.results), false);
  assert.equal(payload.compPage.marketScrape.results.content[resultKey].product_id, '8441491560');
  assert.equal(receivedCompPage.marketScrape.results.content[resultKey].product_id, '8441491560');
});

test('저장 스냅샷은 assets가 메타데이터뿐이어도 lightweight의 경쟁사 분석 시각을 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const helper = sourceBetween(
    core02,
    'function lastWorkCompAnalysisTime(',
    'function getCurrentCompAnalysisTime(',
  );
  const context = vm.createContext({});
  vm.runInContext(`${helper}\nglobalThis.readAnalysisTime = lastWorkCompAnalysisTime;`, context);

  const snapshot = {
    savedAt: 300,
    assets: { compPage: { uploadedImages: [], evidenceImages: [] } },
    lightweight: {
      compPage: { analysisResult: { analyzedAt: 1234 }, savedAt: 1234 },
    },
  };

  assert.equal(context.readAnalysisTime(snapshot), 1234);
});

test('서버 복원은 assets 적용 여부와 무관하게 lightweight의 완료 분석을 별도로 복원한다', () => {
  const core02 = read('src/app-core-02.js');
  const applySource = sourceBetween(
    core02,
    'function applyServerLastWorkSnapshot(',
    'async function hydrateServerLastWorkSnapshot(',
  );

  assert.match(applySource, /lightweightCompPage/);
  assert.match(
    applySource,
    /applyCompAnalysisSnapshot\(\s*lightweightCompPage,/,
    'assets에 분석 본문이 없어도 lightweight 분석 복원 경계가 필요합니다.',
  );
});

test('완료 분석 새로고침은 assets에 본문이 없을 때 lightweight 분석을 선택하고 현재 선택은 읽기 전용으로 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const refreshSource = sourceBetween(
    core02,
    'async function refreshCompetitorAnalysisFromServer(',
    'async function saveSessionAssetsToDb(',
  );

  assert.match(refreshSource, /assetComp/);
  assert.match(refreshSource, /lightweightComp/);
  assert.match(
    refreshSource,
    /previousAnalysisViewOnly/,
    '현재 선택과 저장 분석이 다르면 이전 분석 읽기 전용 상태를 표시해야 합니다.',
  );
  assert.doesNotMatch(
    refreshSource,
    /if \(requiredSelection\?\.key[\s\S]*?\) \{\s*return false;\s*\}/,
    '선택이 다르다는 이유로 보존된 분석 자체를 불러오지 않으면 안 됩니다.',
  );
});

test('경쟁사 리포트 열기는 저장된 이전 분석을 읽기 전용으로 열고, 플랜 생성·적용은 현재 이미지 분석을 요구한다', () => {
  const core03 = read('src/app-core-03.js');
  const core05 = read('src/app-core-05.js');
  const openSource = sourceBetween(
    core03,
    "if (action === 'open-competitor-report')",
    "if (action === 'refresh-competitor-analysis')",
  );
  const guardSource = sourceBetween(
    core05,
    'function compMarketRequireCurrentImageAnalysis(',
    'function compMarketMarkSelectionChanged(',
  );

  assert.match(openSource, /allowPreviousResult:\s*true/);
  assert.match(guardSource, /allowPreviousResult/);
  assert.match(guardSource, /previousAnalysisViewOnly/);
});

test('같은 작업의 얇거나 동수인 빈 경쟁사 snapshot은 기존 분석·플랜·상세 수집을 낮추지 않는다', () => {
  const core02 = read('src/app-core-02.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeSameWorkDerivedValue(',
    'function recoverStaleSessionInlineImages(',
  );
  const applySource = sourceBetween(
    core02,
    'function applyCompAnalysisSnapshot(',
    'function saveCompAnalysis(',
  );
  const scope = { scopeKey: 'project:current' };
  const state = {
    compPage: {
      sectionWorkScope: scope,
      analysisResult: { analyzedAt: 100, conclusion: '기존 분석', evidence: ['선택 상세'] },
      sectionPlan: { sections: ['hero', 'detail'], hero: { title: '기존 플랜' } },
      planEdits: { hero: '수정 지시' },
      uploadedImages: [{ id: 'upload-1' }],
      evidenceImages: [{ id: 'evidence-1' }],
      htmlText: '<article>기존</article>',
      urlInput: 'https://example.test/detail',
      scraperImportInfo: { imported: true },
      marketScrape: {
        results: [{ id: 'candidate-1', title: '기존 후보', detailUrl: 'https://example.test/candidate' }],
        selectedIds: ['candidate-1'],
        scrapedImages: [{ id: 'detail-1', imageUrl: 'https://example.test/detail.png' }],
        selectedImageIds: ['detail-1'],
        detailResults: { status: 'done', raw: ['상세 내용'] },
      },
      analyzeMsg: '기존 분석 완료',
      analyzeProgress: 100,
      analyzeStage: 'done',
      analyzeDetail: '기존 상세 수집 완료',
      analyzeLogs: [{ message: '기존 로그' }],
      analyzeModel: { id: 'gpt' },
      analyzeElapsedSec: 12,
      analysisImageSelection: { key: 'detail-1' },
    },
  };
  const context = vm.createContext({
    state,
    sectionWorkScopeMeta: () => scope,
    sectionWorkScopeMatches: () => true,
    sanitizeCompMarketScrapeForPersistence: value => value,
    compImagePersistenceWarningMessage: () => 'warning',
  });
  vm.runInContext(`${mergeSource}\n${applySource}\nglobalThis.apply = applyCompAnalysisSnapshot;`, context);

  assert.equal(context.apply({
    sectionWorkScope: scope,
    analysisResult: { analyzedAt: 100, analysisProductScope: scope },
    sectionPlan: { sections: [] },
    planEdits: { hero: '' },
    uploadedImages: [],
    evidenceImages: [],
    htmlText: '',
    urlInput: '',
    scraperImportInfo: null,
    marketScrape: {
      results: [{ id: 'candidate-1' }],
      scrapedImages: [{ id: 'detail-1' }],
      detailResults: { status: 'done' },
    },
    analyzeMsg: '',
    analyzeProgress: 0,
    analyzeStage: '',
    analyzeDetail: '',
    analyzeLogs: [],
    analyzeModel: null,
    analyzeElapsedSec: 0,
    analysisImageSelection: null,
  }, 'input'), true);

  const page = state.compPage;
  assert.equal(page.analysisResult.conclusion, '기존 분석');
  assert.equal(Array.from(page.analysisResult.evidence).join('|'), '선택 상세');
  assert.equal(Array.from(page.sectionPlan.sections).join('|'), 'hero|detail');
  assert.equal(page.sectionPlan.hero.title, '기존 플랜');
  assert.equal(page.planEdits.hero, '수정 지시');
  assert.equal(page.marketScrape.detailResults.raw[0], '상세 내용');
  assert.equal(page.marketScrape.results[0].title, '기존 후보');
  assert.equal(page.marketScrape.results[0].detailUrl, 'https://example.test/candidate');
  assert.equal(page.marketScrape.scrapedImages[0].imageUrl, 'https://example.test/detail.png');
  assert.deepEqual(Array.from(page.marketScrape.selectedIds), ['candidate-1']);
  assert.equal(page.htmlText, '<article>기존</article>');
  assert.equal(page.urlInput, 'https://example.test/detail');
  assert.deepEqual(page.analyzeLogs, [{ message: '기존 로그' }]);
  assert.equal(page.analyzeProgress, 100);
  assert.deepEqual(page.analysisImageSelection, { key: 'detail-1' });
});

test('명시적 작업 교체만 빈 경쟁사 snapshot 적용을 허용한다', () => {
  const core02 = read('src/app-core-02.js');
  const mergeSource = sourceBetween(core02, 'function mergeSameWorkDerivedValue(', 'function recoverStaleSessionInlineImages(');
  const applySource = sourceBetween(core02, 'function applyCompAnalysisSnapshot(', 'function saveCompAnalysis(');
  const scope = { scopeKey: 'project:replacement' };
  const state = {
    compPage: {
      analysisResult: { analyzedAt: 100, conclusion: '이전 작업' },
      sectionPlan: { sections: ['hero'] },
      planEdits: { hero: '이전 지시' },
      marketScrape: { selectedIds: ['candidate-1'], detailResults: { status: 'done' } },
      analyzeLogs: [{ message: '이전 로그' }],
    },
  };
  const context = vm.createContext({
    state,
    sectionWorkScopeMeta: () => scope,
    sectionWorkScopeMatches: () => true,
    sanitizeCompMarketScrapeForPersistence: value => value,
    compImagePersistenceWarningMessage: () => 'warning',
  });
  vm.runInContext(`${mergeSource}\n${applySource}\nglobalThis.apply = applyCompAnalysisSnapshot;`, context);

  context.apply({
    sectionWorkScope: scope,
    analysisResult: null,
    sectionPlan: null,
    planEdits: {},
    marketScrape: null,
    analyzeLogs: [],
  }, 'input', { replaceWorkspace: true });

  assert.equal(state.compPage.analysisResult, null);
  assert.equal(state.compPage.sectionPlan, null);
  assert.deepEqual(state.compPage.planEdits, {});
});

test('같은 작업 복원은 시작·버전·작업파일 경로와 무관하게 현재 A 상태를 초기화하지 않는다', () => {
  const core03 = read('src/app-core-03.js');
  const helper = sourceBetween(
    core03,
    'function projectRestorePreservesCurrentWork(',
    'function resetLiveWorkspaceForProjectFileReplacement(',
  );
  const context = vm.createContext({
    state: { currentProjectId: 'project-current' },
  });
  vm.runInContext(`${helper}\nglobalThis.preserve = projectRestorePreservesCurrentWork;`, context);

  assert.equal(context.preserve('project-current', { startupRestore: true }), true);
  assert.equal(context.preserve('project-current'), true);
  assert.equal(context.preserve('project-other'), false);
  assert.equal(context.preserve(''), false);

  const loadProjectSource = sourceBetween(
    core03,
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );
  assert.match(loadProjectSource, /const preserveCurrentWork = projectRestorePreservesCurrentWork\(project\.id, options\);/);
  assert.match(loadProjectSource, /resetLiveWorkspaceForProjectFileReplacement\(\{ preserveCurrentWork \}\);/);

  const snapshotSource = sourceBetween(
    core03,
    'async function loadSnapshotRecord(',
    'async function importFactoryProjectFileBundle(',
  );
  const workfileSource = sourceBetween(
    core03,
    'async function importFactoryProjectFileBundle(',
    'async function openFactoryProjectFilePicker(',
  );
  assert.match(snapshotSource, /const preserveCurrentWork = projectRestorePreservesCurrentWork\(snapshot\.projectId\);/);
  assert.match(workfileSource, /const preserveCurrentWork = projectRestorePreservesCurrentWork\(projectId\);/);
});

test('같은 작업의 빈 백업도 옵션 슬롯명과 이미지 배정을 A+B로 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeOptionSorterStoredImages(',
    'function mergeCompMarketStoredState(',
  );
  const context = vm.createContext({
    hasInlineImagePayload: () => false,
    optionSorterSlotNameIsGeneric: value => /^\d+(?:\s*번)?$/.test(String(value || '').trim()),
  });
  vm.runInContext(`${mergeSource}\nglobalThis.merge = mergeOptionSorterStoredImages;`, context);

  const result = context.merge({
    images: [{ id: 'oi_archive_red', archiveId: 'archive-red' }],
    slots: [{ id: 'slot_1', name: '1.빨강', imgIds: ['oi_archive_red'] }],
    pool: [],
  }, {
    images: [],
    slots: [{ id: 'slot_1', name: '1번', imgIds: [] }],
    pool: [],
  });

  assert.deepEqual(Array.from(result.images, image => image.id), ['oi_archive_red']);
  assert.equal(result.slots[0].name, '1.빨강');
  assert.deepEqual(Array.from(result.slots[0].imgIds), ['oi_archive_red']);
});

test('같은 작업의 기본 번호 슬롯은 생성 ID가 달라도 서버 색상명으로 병합한다', () => {
  const core02 = read('src/app-core-02.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeOptionSorterStoredImages(',
    'function mergeCompMarketStoredState(',
  );
  const context = vm.createContext({
    hasInlineImagePayload: () => false,
    optionSorterSlotNameIsGeneric: value => /^\d+(?:\s*번)?$/.test(String(value || '').trim()),
  });
  vm.runInContext(`${mergeSource}\nglobalThis.merge = mergeOptionSorterStoredImages;`, context);

  const result = context.merge({
    slots: [
      { id: 'slot_1786416976481_10', name: '11번', imgIds: ['image-11'] },
      { id: 'slot_1786416976481_11', name: '12번', imgIds: ['image-12'] },
    ],
  }, {
    slots: [
      { id: 'slot_1786411989347_10', name: '11.형광연두', imgIds: [] },
      { id: 'slot_1786411989347_11', name: '12.노랑', imgIds: [] },
    ],
  });

  assert.equal(result.slots.length, 2);
  assert.deepEqual(Array.from(result.slots, slot => slot.id), ['slot_1786411989347_10', 'slot_1786411989347_11']);
  assert.deepEqual(Array.from(result.slots, slot => slot.name), ['11.형광연두', '12.노랑']);
  assert.deepEqual(Array.from(result.slots, slot => Array.from(slot.imgIds)), [['image-11'], ['image-12']]);
});

test('같은 작업의 기본 번호 복원값은 생성 ID가 달라도 기존 색상명을 덮지 않는다', () => {
  const core02 = read('src/app-core-02.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeOptionSorterStoredImages(',
    'function mergeCompMarketStoredState(',
  );
  const context = vm.createContext({
    hasInlineImagePayload: () => false,
    optionSorterSlotNameIsGeneric: value => /^\d+(?:\s*번)?$/.test(String(value || '').trim()),
  });
  vm.runInContext(`${mergeSource}\nglobalThis.merge = mergeOptionSorterStoredImages;`, context);

  const result = context.merge({
    slots: [
      { id: 'slot_1786411989347_10', name: '11.형광연두', imgIds: ['image-11'] },
      { id: 'slot_1786411989347_11', name: '12.노랑', imgIds: ['image-12'] },
    ],
  }, {
    slots: [
      { id: 'slot_1786416976481_10', name: '11번', imgIds: [] },
      { id: 'slot_1786416976481_11', name: '12번', imgIds: [] },
    ],
  });

  assert.equal(result.slots.length, 2);
  assert.deepEqual(Array.from(result.slots, slot => slot.id), ['slot_1786411989347_10', 'slot_1786411989347_11']);
  assert.deepEqual(Array.from(result.slots, slot => slot.name), ['11.형광연두', '12.노랑']);
  assert.deepEqual(Array.from(result.slots, slot => Array.from(slot.imgIds)), [['image-11'], ['image-12']]);
});

test('생산관제 VM 재수집은 기존 후보의 상세값을 보존하고 새 후보를 더한다', () => {
  const core02 = read('src/app-core-02.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeSameWorkDerivedValue(',
    'function recoverStaleSessionInlineImages(',
  );
  const context = vm.createContext({});
  vm.runInContext(`${mergeSource}\nglobalThis.merge = mergeCompMarketStoredState;`, context);

  const result = JSON.parse(JSON.stringify(context.merge({
    results: [{ id: 'candidate-1', title: '기존 제목', product_url: 'https://example.test/1', detail: { image: 'saved.jpg' } }],
    vmResults: [{ id: 'candidate-1', title: '기존 제목', product_url: 'https://example.test/1', detail: { image: 'saved.jpg' } }],
    groupedResults: { coupang: [{ id: 'candidate-1', detail: { image: 'saved.jpg' } }] },
    vmGroupedResults: { coupang: [{ id: 'candidate-1', detail: { image: 'saved.jpg' } }] },
  }, {
    results: [
      { id: 'candidate-1', title: '새 제목', product_url: 'https://example.test/1', detail: { image: '' } },
      { id: 'candidate-2', title: '새 후보', product_url: 'https://example.test/2' },
    ],
    vmResults: [
      { id: 'candidate-1', title: '새 제목', product_url: 'https://example.test/1', detail: { image: '' } },
      { id: 'candidate-2', title: '새 후보', product_url: 'https://example.test/2' },
    ],
    groupedResults: { coupang: [{ id: 'candidate-1', title: '새 제목', detail: { image: '' } }, { id: 'candidate-2' }] },
    vmGroupedResults: { coupang: [{ id: 'candidate-1', title: '새 제목', detail: { image: '' } }, { id: 'candidate-2' }] },
  })));

  assert.deepEqual(result.results.map(row => row.id), ['candidate-1', 'candidate-2']);
  assert.equal(result.results[0].title, '새 제목');
  assert.equal(result.results[0].detail.image, 'saved.jpg');
  assert.equal(result.groupedResults.coupang[0].detail.image, 'saved.jpg');

  const core06 = read('src/app-core-06.js');
  const runSource = sourceBetween(
    core06,
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  assert.match(runSource, /const preservedMarket = cloneData\(sanitizeCompMarketScrapeForPersistence\(market\) \|\| \{\}\);/);
  assert.match(runSource, /updated = mergeCompMarketStoredState\(preservedMarket,/);
  assert.match(runSource, /factoryImportCompetitorDataToFactory\(\s*mergedVmRows,/);
});

test('동일 작업 자산 저장은 선택·상세·분석·섹션 플랜을 빠뜨리지 않는다', () => {
  const core02 = read('src/app-core-02.js');
  const compPageSource = sourceBetween(
    core02,
    'function sanitizeCompMarketScrapeForPersistence(',
    'function stripOptionSorterImages(',
  );
  const payloadSource = sourceBetween(
    core02,
    'function currentSessionAssetsPayload(',
    'function getServerLastWorkBases(',
  );
  const sourceCompPage = {
    sectionWorkScope: { scopeKey: 'project:current' },
    analysisResult: { analyzedAt: 100, conclusion: '보존할 분석' },
    sectionPlan: { sections: ['hero', 'detail'] },
    planEdits: { hero: '보존할 지시' },
    analyzeLogs: [{ message: '분석 완료' }],
    marketScrape: {
      selectedIds: ['candidate-1'],
      selectedImageIds: ['detail-1'],
      scrapedImages: [{ id: 'detail-1', src: 'https://example.test/detail.png' }],
      detailResults: { id: 'job-1', status: 'done', raw: ['원문 상세'] },
    },
  };
  const state = {
    currentProjectId: 'current',
    productName: '모시꽃수파우치',
    compPage: sourceCompPage,
    factory: { product: { finalDb: { option_values: '1.빨강,2.연핑' } } },
    optionSorter: {},
  };
  const cloneData = value => JSON.parse(JSON.stringify(value ?? null));
  const context = vm.createContext({
    state,
    SESSION_ASSET_ID: 'session-assets',
    IMAGE_STORED_MARKER: '__stored__',
    cloneData,
    workspacePersistenceApi: () => ({ normalizeWorkspaceScope: value => value || '' }),
    getCurrentLastWorkWorkspaceScope: () => 'project:current',
    getCurrentDocumentWorkspaceScope: () => '',
    factoryRuntimeReadCommittedFactory: () => state.factory,
    stripFactoryImages: value => cloneData(value),
    getCafe24FieldViewStorageSnapshot: () => ({}),
    resolveCafe24FieldViewForLastWork: () => ({}),
    currentWorkspaceInputImageFingerprint: () => '',
    ensureActiveWorkIdentity: () => ({}),
    currentWorkspaceRevision: () => ({}),
    currentWorkspaceBranch: () => ({}),
    productImageBackupReferencePayload: () => ({}),
    stripAnalysisImages: () => [],
    stripSectionImages: () => ({}),
    stripDetailBlockImages: () => [],
    loadFixedDetailImages: () => [],
    stripFixedDetailImagesForSession: () => [],
    stripVariantImages: () => ({}),
    stripAiRepairUndoImages: () => ({}),
    stripAiRepairDraft: () => ({}),
    stripCutsImages: () => ({}),
    stripOptionSorterImages: value => cloneData(value),
  });
  vm.runInContext(`${compPageSource}\n${payloadSource}\nglobalThis.snapshot = currentSessionAssetsPayload;`, context);

  const saved = JSON.parse(JSON.stringify(context.snapshot({ includeImages: false, scopeId: 'project:current' }).compPage));

  assert.equal(saved.analysisResult.conclusion, '보존할 분석');
  assert.deepEqual(saved.sectionPlan.sections, ['hero', 'detail']);
  assert.deepEqual(saved.planEdits, { hero: '보존할 지시' });
  assert.deepEqual(saved.marketScrape.selectedIds, ['candidate-1']);
  assert.deepEqual(saved.marketScrape.selectedImageIds, ['detail-1']);
  assert.equal(saved.marketScrape.scrapedImages[0].id, 'detail-1');
  assert.deepEqual(saved.analyzeLogs, [{ message: '분석 완료' }]);
});

test('경쟁사 복원용 스냅샷은 후보의 인라인 이미지 본문을 저장하지 않는다', () => {
  const core02 = read('src/app-core-02.js');
  const sanitizerSource = sourceBetween(
    core02,
    'function sanitizeCompMarketScrapeForPersistence(',
    'function stripCompPageImages(',
  );
  const context = vm.createContext({ IMAGE_STORED_MARKER: '__stored__' });
  vm.runInContext(`${sanitizerSource}\nglobalThis.sanitize = sanitizeCompMarketScrapeForPersistence;`, context);

  const inline = `data:image/jpeg;base64,${'A'.repeat(8000)}`;
  const compacted = context.sanitize({
    results: [{
      id: 'candidate-a',
      product_url: 'https://example.test/candidate-a',
      imageBase64: 'B'.repeat(8000),
      thumbnail: inline,
      detail: { image: inline, src: inline },
    }],
    vmResults: [{ id: 'candidate-b', preview: inline, src: inline }],
    localResults: [{ id: 'candidate-c', dataUrl: inline }],
    groupedResults: { coupang: [{ id: 'candidate-a', thumbnail: inline }] },
    vmGroupedResults: { coupang: [{ id: 'candidate-b', preview: inline }] },
  });

  assert.equal(compacted.results[0].product_url, 'https://example.test/candidate-a');
  assert.equal(compacted.results[0].imageBase64, '');
  assert.equal(compacted.results[0].thumbnail, '');
  assert.equal(compacted.results[0].detail.image, '');
  assert.equal(compacted.results[0].detail.src, '__stored__');
  assert.equal(compacted.vmResults[0].preview, '');
  assert.equal(compacted.vmResults[0].src, '__stored__');
  assert.equal(compacted.localResults[0].dataUrl, '');
  assert.equal(compacted.groupedResults.coupang[0].thumbnail, '');
  assert.equal(compacted.vmGroupedResults.coupang[0].preview, '');
  assert.ok(JSON.stringify(compacted).length < 4000);
});

test('모든 기본 번호 슬롯만 같은 작업 확정 옵션명으로 복구한다', () => {
  const core02 = read('src/app-core-02.js');
  const helper = sourceBetween(
    core02,
    'function restoreOptionSorterLabelsFromFactory(',
    'function normalizeOptionSorterState(',
  );
  const context = vm.createContext({
    optionSorterSlotNameIsGeneric: value => /^\d+(?:\s*번)?$/.test(String(value || '').trim()),
  });
  vm.runInContext(`${helper}\nglobalThis.restore = restoreOptionSorterLabelsFromFactory;`, context);

  const generic = {
    slots: [{ id: 'slot_1', name: '1번', imgIds: [] }, { id: 'slot_2', name: '2번', imgIds: [] }],
    images: [{ id: 'image-1' }, { id: 'image-2' }],
    pool: ['image-1', 'image-2'],
  };
  const factory = { product: { finalDb: { option_values: '1.빨강, 2.연핑' } } };
  const restored = context.restore(generic, factory);
  assert.deepEqual(Array.from(restored.slots, slot => slot.name), ['1.빨강', '2.연핑']);
  assert.deepEqual(Array.from(restored.slots, slot => Array.from(slot.imgIds)), [['image-1'], ['image-2']]);
  assert.deepEqual(Array.from(restored.pool), []);
  assert.equal(restored.optionSlotSource, 'db');

  const bareNumeric = { slots: [{ id: 'slot_1', name: '1' }, { id: 'slot_2', name: '2' }] };
  const restoredBareNumeric = context.restore(bareNumeric, factory);
  assert.deepEqual(Array.from(restoredBareNumeric.slots, slot => slot.name), ['1.빨강', '2.연핑']);

  const custom = { slots: [{ id: 'slot_1', name: '1.빨강' }, { id: 'slot_2', name: '2번' }] };
  assert.equal(context.restore(custom, factory), custom);
  assert.equal(context.restore(generic, { product: { finalDb: { option_values: '1.빨강' } } }), generic);
});

test('로컬 옵션 원본을 늦게 붙인 뒤에도 같은 작업 DB 슬롯명과 순번 매칭을 복구한다', async () => {
  const core02 = read('src/app-core-02.js');
  const core06 = read('src/app-core-06.js');
  const labelsSource = sourceBetween(
    core02,
    'function restoreOptionSorterLabelsFromFactory(',
    'function normalizeOptionSorterState(',
  );
  const restoreSource = sourceBetween(
    core06,
    'async function optRestoreSourceImagesFromLocalArchive()',
    'function optAddImage(',
  );
  const state = {
    step: 'optionsorter',
    optionSorter: {
      slots: [{ id: 'slot_1', name: '1.빨강', imgIds: [] }, { id: 'slot_2', name: '2.연핑', imgIds: [] }],
      images: [],
      pool: [],
    },
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    OPTION_SORTER_SOURCE_ARCHIVE_TYPE: 'option-sorter-source-upload',
    OPT_SOURCE_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({ workspaceId: 'project:current', productKey: 'product', inputImageFingerprint: 'input' }),
    optRestoreGeneratedResultsFromLocalArchive: async () => ({ restored: 0 }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => ({
      ok: true,
      json: async () => ({ assets: [
        { id: 'archive-1', marker: 'option-sorter-source-upload', metadata: { optionImageId: 'image-1', originalName: 'IMG_1' } },
        { id: 'archive-2', marker: 'option-sorter-source-upload', metadata: { optionImageId: 'image-2', originalName: 'IMG_2' } },
      ] }),
    }),
    optSourceArchiveMarker: record => record.marker,
    optSourceArchiveId: record => record.id,
    optSyncSlotCountToImages: os => {
      os.slots = os.images.map((image, index) => ({
        ...os.slots[index],
        id: `slot_${index + 1}`,
        name: os.slots[index]?.name || `${index + 1}번`,
        imgIds: [],
      }));
    },
    optScheduleSave: () => {},
    render: () => {},
    factoryRuntimeReadFactory: () => ({ product: { finalDb: { option_values: ['1.빨강', '2.연핑'] } } }),
    optionSorterSlotNameIsGeneric: value => /^\d+(?:\s*번)?$/.test(String(value || '').trim()),
  });
  vm.runInContext(`${labelsSource}\n${restoreSource}\nglobalThis.restore = optRestoreSourceImagesFromLocalArchive;`, context);

  await context.restore();

  assert.deepEqual(Array.from(state.optionSorter.slots, slot => slot.name), ['1.빨강', '2.연핑']);
  assert.deepEqual(Array.from(state.optionSorter.slots, slot => Array.from(slot.imgIds)), [['image-1'], ['image-2']]);
  assert.deepEqual(Array.from(state.optionSorter.pool), []);
});

test('같은 작업의 더 완전한 옵션 상태는 얇은 서버 저장본을 다시 보강한다', () => {
  const core02 = read('src/app-core-02.js');
  const helper = sourceBetween(
    core02,
    'function optionSorterDurableProgress(',
    'function lastWorkSnapshotScore(',
  );
  const context = vm.createContext({
    optionSorterSlotNameIsGeneric: value => /^\d+(?:\s*번)?$/.test(String(value || '').trim()),
  });
  vm.runInContext(`${helper}\nglobalThis.isMoreComplete = optionSorterSnapshotIsMoreComplete;`, context);

  assert.equal(context.isMoreComplete({
    slots: Array.from({ length: 15 }, (_, index) => ({ name: `${index + 1}.색상` })),
    images: Array.from({ length: 15 }, (_, index) => ({ id: `image-${index}` })),
    optionResults: [{ id: 'result-1' }],
  }, {
    slots: Array.from({ length: 10 }, (_, index) => ({ name: `${index + 1}번` })),
    images: [],
    optionResults: [],
  }), true);
  assert.equal(context.isMoreComplete({
    slots: [{ name: '1.빨강' }],
    images: [],
    optionResults: [],
  }, {
    slots: [{ name: '1번' }],
    images: [{ id: 'server-only' }],
    optionResults: [],
  }), false);
  assert.equal(context.isMoreComplete({
    slots: [{ name: '1.빨강' }],
    images: [],
    optionResults: [],
  }, {
    slots: [{ name: '1번' }],
    images: [],
    optionResults: [],
  }), true);
  assert.equal(context.isMoreComplete({
    slots: [{ name: '1.빨강' }],
    images: [],
    optionResults: [],
  }, {
    slots: [{ name: '1' }],
    images: [],
    optionResults: [],
  }), true);

  const hydrateSource = sourceBetween(
    core02,
    'async function hydrateServerLastWorkSnapshot(',
    'async function refreshCompetitorAnalysisFromServer(',
  );
  assert.match(
    hydrateSource,
    /const currentStateOutranksServer = currentScore > serverScore[\s\S]*?optionSorterSnapshotIsMoreComplete\(/,
    '현재 A가 더 완전하면 서버의 얇은 저장본을 적용 대상으로 삼으면 안 됩니다.',
  );
  assert.match(
    hydrateSource,
    /const serverHasBetterOptionSorter = optionSorterSnapshotIsMoreComplete\(\s*serverAssetPayload\.optionSorter,\s*state\.optionSorter,\s*\);[\s\S]*?\|\| serverHasBetterOptionSorter/,
    '서버 저장본의 색상명이 현재 기본 번호보다 완전하면 같은 작업에 적용해야 합니다.',
  );
  assert.match(
    hydrateSource,
    /if \(!shouldApply\) \{\s*shouldResaveAfterHydrate = options\.takeoverSync !== true && currentStateOutranksServer;\s*return false;/,
    '화면만 보정하고 얇은 서버 저장본을 남기면 새 탭에서 다시 기본 번호로 돌아갑니다.',
  );
});

test('같은 행 수라도 매칭과 생성컷 원본이 비어 있는 snapshot은 현재 결과를 낮출 수 없다', () => {
  const core02 = read('src/app-core-02.js');
  const helper = sourceBetween(
    core02,
    'function optionSorterDurableProgress(',
    'function lastWorkSnapshotScore(',
  );
  const context = vm.createContext({
    optionSorterSlotNameIsGeneric: value => /^\d+(?:\s*번)?$/.test(String(value || '').trim()),
  });
  vm.runInContext(`${helper}\nglobalThis.isMoreComplete = optionSorterSnapshotIsMoreComplete;`, context);

  const labels = Array.from({ length: 15 }, (_, index) => `${index + 1}.색상`);
  const current = {
    slots: labels.map((name, index) => ({ id: `slot-${index + 1}`, name, imgIds: [`image-${index + 1}`] })),
    images: labels.map((_, index) => ({ id: `image-${index + 1}` })),
    optionResults: Array.from({ length: 4 }, (_, index) => ({
      id: `result-${index + 1}`,
      archiveId: `archive-${index + 1}`,
      imageUrl: `/api/local-archive/assets/archive-${index + 1}/image`,
    })),
  };
  const incoming = {
    slots: labels.map((name, index) => ({ id: `slot-${index + 1}`, name, imgIds: [] })),
    images: labels.map((_, index) => ({ id: `image-${index + 1}` })),
    optionResults: Array.from({ length: 4 }, (_, index) => ({ id: `result-${index + 1}` })),
  };

  assert.equal(context.isMoreComplete(current, incoming), true);
});

test('같은 작업파일 복원은 빈 파생 상태만 현재 A로 보강하고 저장본 B는 적용한다', () => {
  const core03 = read('src/app-core-03.js');
  const helper = sourceBetween(
    core03,
    'function preserveSameWorkWorkspacePayload(',
    'function resetLiveWorkspaceForProjectFileReplacement(',
  );
  const context = vm.createContext({ cloneData: value => structuredClone(value) });
  vm.runInContext(`${helper}\nglobalThis.preserve = preserveSameWorkWorkspacePayload;`, context);

  const result = context.preserve({
    productName: '저장본 B 제품명',
    optionSorter: { sourceImages: [], slots: [] },
    sectionContents: {},
    compPage: {
      analysisResult: null,
      sectionPlan: null,
      marketScrape: { results: [], selectedIds: [], scrapedImages: [] },
    },
  }, {
    productName: '현재 A 제품명',
    optionSorter: { sourceImages: [{ id: 'source-a' }], slots: [{ id: 'slot-a' }] },
    sectionContents: { hero: '<section>A</section>' },
    compPage: {
      analysisResult: { conclusion: '현재 분석 A' },
      sectionPlan: { sections: ['hero'] },
      marketScrape: {
        results: [{ id: 'candidate-a' }],
        selectedIds: ['candidate-a'],
        scrapedImages: [{ id: 'detail-a' }],
      },
    },
  });

  assert.equal(result.productName, '저장본 B 제품명');
  assert.equal(result.sectionContents.hero, '<section>A</section>');
  assert.equal(result.optionSorter.sourceImages[0].id, 'source-a');
  assert.equal(result.optionSorter.slots[0].id, 'slot-a');
  assert.equal(result.compPage.analysisResult.conclusion, '현재 분석 A');
  assert.equal(result.compPage.sectionPlan.sections[0], 'hero');
  assert.equal(result.compPage.marketScrape.results[0].id, 'candidate-a');
  assert.equal(result.compPage.marketScrape.selectedIds[0], 'candidate-a');
  assert.equal(result.compPage.marketScrape.scrapedImages[0].id, 'detail-a');
});

test('같은 작업 복원은 이전 탭 브랜치를 현재 작업 내용과 섞지 않는다', () => {
  const core03 = read('src/app-core-03.js');
  const helper = sourceBetween(
    core03,
    'function preserveSameWorkWorkspacePayload(',
    'function resetLiveWorkspaceForProjectFileReplacement(',
  );
  const context = vm.createContext({ cloneData: value => structuredClone(value) });
  vm.runInContext(`${helper}\nglobalThis.preserve = preserveSameWorkWorkspacePayload;`, context);

  const result = context.preserve({
    currentProjectId: 'project-current',
    workspaceScope: { id: 'project:project-current' },
    optionSorter: { slots: [] },
  }, {
    currentProjectId: 'project-current',
    workspaceScope: { id: 'draft:old-tab' },
    workspaceRevision: { scopeId: 'draft:old-tab' },
    workspaceBranch: { scopeId: 'draft:old-tab', documentScopeId: 'project:project-current' },
    optionSorter: { slots: [{ id: 'slot-a' }] },
  });

  assert.equal(result.workspaceScope.id, 'project:project-current');
  assert.equal(result.workspaceRevision, undefined);
  assert.equal(result.workspaceBranch, undefined);
  assert.equal(result.optionSorter.slots[0].id, 'slot-a');
});

test('같은 작업의 세션 자산 복원은 비어 있거나 얇은 파생 상태로 A를 덮어쓰지 않는다', () => {
  const core02 = read('src/app-core-02.js');
  const applySource = sourceBetween(
    core02,
    'function applySessionAssetsPayload(',
    'function repairRestoredSessionIdentityDrift(',
  );

  assert.match(applySource, /const preserveCurrentWork = options\.replaceWorkspace !== true && matchesWorkspace;/);
  assert.match(applySource, /state\.sectionContents = cloneData\(restoreIncomingValue\(assets\.sectionContents, state\.sectionContents\)\);/);
  assert.match(applySource, /const incomingDetailBlocks = restoreIncomingValue\(assets\.detailImageBlocks, state\.detailImageBlocks\);/);
  assert.match(applySource, /state\.compPage\.uploadedImages = restoreIncomingValue\(assets\.compPage\.uploadedImages, state\.compPage\.uploadedImages\);/);
});

test('분석 결과 리포트의 프리셋 저장 버튼과 저장 API는 계속 연결되어 있다', () => {
  const reportView = read('src/app-core-05.js');
  const menu = read('src/menus/competitor-menu.mjs');
  const core03 = read('src/app-core-03.js');

  assert.match(reportView, /data-comp-style-save/);
  assert.match(menu, /data-comp-style-save[\s\S]*?call\('applyStylePreset', true\)/);
  assert.match(core03, /function applyCompetitorStylePreset\(saveAsPreset = false\)/);
  assert.match(core03, /saveBrandPresets\(state\.brandPresets\)/);
});

test('GPT OAuth 경쟁사 이미지 입력은 원본을 보존하고 안전한 분석 전송 크기와 JPEG로 축소한다', () => {
  const core01 = read('src/app-core-01.js');
  const scaleSource = sourceBetween(
    core01,
    'function gptOAuthVisionImageScale(',
    'async function compactGptOAuthVisionImage(',
  );
  const context = vm.createContext({ Math });
  vm.runInContext(`${scaleSource}\nglobalThis.scaleImage = gptOAuthVisionImageScale;`, context);

  const transport = { maxDimension: 2048, maxPixels: 2_000_000 };
  const tall = context.scaleImage(1905, 39323, transport);
  assert.equal(tall.changed, true);
  assert.ok(tall.width <= 2048 && tall.height <= 2048);
  assert.ok(tall.width * tall.height <= 2_000_000);
  const normal = context.scaleImage(1905, 7877, transport);
  assert.equal(normal.changed, true);
  assert.ok(normal.width <= 2048 && normal.height <= 2048);
  assert.ok(normal.width * normal.height <= 2_000_000);
  assert.match(
    core01,
    /const preparedImages = await prepareGptOAuthVisionImages\(imagesArray, \{\s*maxDimension: 2048,\s*maxPixels: 2_000_000,\s*outputMime: 'image\/jpeg',\s*quality: 0\.82,\s*\}\);/,
    '경쟁사 분석은 원본이 아니라 안전한 JPEG 전송 파생 이미지를 사용해야 합니다.',
  );
  assert.match(
    core01,
    /resizeImageDataUrl\(dataUrl, target\.width, target\.height, \{\s*mime: options\.outputMime \|\| 'image\/png',\s*quality: options\.quality,\s*\}\)/,
    '전송 파생 이미지는 출력 형식과 품질을 지정해 PNG 대용량 재인코딩을 피해야 합니다.',
  );
});
