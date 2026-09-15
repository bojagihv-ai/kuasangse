const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
function fn(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} exists`);
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

test('partial manual section content preserves omitted body and extra elements', () => {
  const state = { sectionContents: { hero: { headline: '이전', subheadline: '부제', body_text: '본문', cta_text: '구매', extra_elements: ['보존'], layout_suggestion: '기존' } }, manualSectionEdits: {} };
  const context = vm.createContext({ state, cloneData: structuredClone, savePersistentState() {},
    applySectionContent: (id, content) => { state.sectionContents[id] = content; } });
  vm.runInContext(fn('src/app-core-03.js', 'saveManualSectionContent'), context);
  context.saveManualSectionContent('hero', { headline: '수정' });
  assert.equal(state.sectionContents.hero.body_text, '본문');
  assert.equal(state.sectionContents.hero.subheadline, '부제');
  assert.deepEqual(Array.from(state.sectionContents.hero.extra_elements), ['보존']);
  context.saveManualSectionContent('hero', { body_text: '', extra_elements: [] });
  assert.equal(state.sectionContents.hero.body_text, '');
  assert.deepEqual(Array.from(state.sectionContents.hero.extra_elements), []);
});

test('competitor guide and market actions preserve object values and local operation context', async () => {
  const { createCompetitorFactoryTab } = await import(pathToFileURL(path.join(root, 'src/menus/factory/tabs/competitor-tab.mjs')));
  const token = Object.freeze({ local: true });
  const calls = [];
  const renderHelpers = Object.fromEntries(['escapeHtml','escAttr','disabledAttr','renderFactoryAutomationVmSearchInfo','renderFactoryAutomationTaskChecklist','renderFactoryAutomationStatusCard','renderFactoryLightImage','renderCompetitorAnalyzeLogItems','renderCompMarketScrapePanel'].map(key => [key, () => '']));
  const tab = createCompetitorFactoryTab({ getSnapshot: () => ({}), assertMutable() {}, getOperationToken: () => token,
    isOperationCurrent: value => value === token, reportError() {}, renderHelpers,
    actions: { runGuideAction: (value, context) => { calls.push({ value, context }); return true; }, runMarketAction: (value, context) => { calls.push({ value, context }); return true; } } });
  const value = { action: 'rerun-with-keyword', site: 'naver', runtime: 'vm', searchKeyword: '짧게' };
  await tab.invoke('guideAction', value);
  await tab.invoke('marketAction', { type: 'toggle-candidate', candidateId: 'candidate-a' });
  assert.equal(calls[0].value, value);
  assert.equal(calls[0].context.operationToken, token);
  assert.equal(calls[1].context.operationToken, token);
});

test('search-only terms use the query without changing product identity', () => {
  const factory = { product: { productName: '고정 상품', naturalHint: '다른 힌트' } };
  const context = vm.createContext({ state: { productName: '고정 상품' }, cleanDbSearchTerm: value => String(value).trim(),
    factoryAddSearchTerm: (terms, value) => { if (value && !terms.includes(value)) terms.push(value); },
    factoryAddSearchTermVariants() {} });
  vm.runInContext(fn('src/cafe24-sync.js', 'factoryCandidateSearchTerms'), context);
  assert.deepEqual(Array.from(context.factoryCandidateSearchTerms(factory, { query: '짧은 검색' })), ['짧은 검색', '짧은검색']);
  assert.equal(factory.product.productName, '고정 상품');
});

test('candidate identity resolves after reorder and rejects foreign run and late input replacement', () => {
  const factory = { product: { pendingDbCandidates: [{ id: 'b' }, { id: 'a' }] } };
  const identity = id => ({ type: 'sinhwa', candidateKey: id, productNo: '', jcode: id, productCode: '', scopeKey: 'scope-a', identityKey: 'run-a' });
  let scope = { workspaceId: 'batch:a', productKey: 'a', runId: 'run-a', inputFingerprint: 'image-a' };
  const context = vm.createContext({ factoryRuntimeReadFactory: () => factory,
    factoryFindCandidateReviewByRequestIdentity: (f, request) => f.product.pendingDbCandidates.find(item => item.id === request.candidateKey),
    factoryCaptureCandidateReviewRequestIdentity: (_type, candidate) => identity(candidate.id),
    factoryCandidateReviewIdentityKey: () => scope.runId, factoryCandidateReviewScopeKey: () => 'scope-a',
    factoryRuntimeControlTabScope: () => ({ ...scope }),
    factoryRuntimeBatchCommandError: code => new Error(code) });
  vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeControlTabScopeMatches'), context);
  vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeControlCandidateRequest'), context);
  const guard = context.factoryRuntimeControlCandidateRequest('sinhwa', identity('a'));
  assert.equal(guard.isCurrent(), true);
  assert.throws(() => context.factoryRuntimeControlCandidateRequest('sinhwa', { ...identity('a'), identityKey: 'old' }), /identity_mismatch/);
  scope.inputFingerprint = 'image-b';
  assert.equal(guard.isCurrent(), false);
});

test('manual DB search scopes sources and merges candidates without autoapply or overwriting A', async () => {
  for (const source of ['all', 'db', 'cafe24']) {
    const factory = { product: { productName: '고정 상품', candidateAutoApply: true, selectedDbCandidateKey: 'db-old',
      dbCandidateResolution: 'none', cafe24CandidateResolution: 'none', finalDb: { material: '직접 입력' },
      pendingDbCandidates: [{ id: 'db-old' }], pendingCafe24Candidates: [{ id: 'cafe-old' }] },
      automation: {}, assets: [{ id: 'keep' }], goalRun: { jobId: 'a', status: 'blocked' } };
    const before = structuredClone(factory);
    const calls = [];
    const token = { revision: 1 };
    const store = { getSnapshot: () => ({ factory }), getOperationToken: () => token, isOperationCurrent: value => value === token };
    const context = vm.createContext({ factoryRuntimeRequireStore: () => store,
      factoryRuntimeWithOperationLease: (_key, _ctx, execute) => execute({ operationToken: token }),
      factoryCandidateCollectionScope: () => 'scope', factoryCandidateCollectionScopeMatches: () => true,
      factoryRuntimeControlTabScope: () => ({ revision: 1 }), factoryRuntimeControlTabScopeMatches: () => true,
      factoryCandidateSearchTerms: (_f, options) => [options.query], factoryCandidateReviewIdentityKey: () => 'identity-a',
      factorySearchSinhwaReviewCandidates: async terms => { calls.push(['db', terms]); return [{ id: 'db-new' }]; },
      factorySearchCafe24ReviewCandidates: async terms => { calls.push(['cafe24', terms]); return [{ id: 'cafe-new' }]; },
      factorySlimReviewCandidateList: rows => [...new Map(rows.map(row => [row.id, row])).values()],
      factoryRuntimeBridgeAction: (_name, ctx, execute) => { assert.equal(ctx.operationToken, token); return execute(factory); },
      factoryRuntimeStaleActionError: code => new Error(code),
    });
    vm.runInContext(fn('src/app-core-06.js', 'factoryRunDbCandidatesForSelection'), context);
    assert.equal((await context.factoryRunDbCandidatesForSelection({ searchOnly: true, query: '짧게', source, preserveManualFields: true })).ok, true);
    assert.deepEqual(calls.map(row => row[0]), source === 'all' ? ['db', 'cafe24'] : [source]);
    assert.equal(factory.product.productName, before.product.productName);
    assert.deepEqual(factory.product.finalDb, before.product.finalDb);
    assert.equal(factory.product.selectedDbCandidateKey, before.product.selectedDbCandidateKey);
    assert.equal(factory.product.candidateAutoApply, true);
    assert.equal(factory.product.dbCandidateResolution, 'none');
    assert.equal(factory.product.cafe24CandidateResolution, 'none');
    assert.deepEqual(factory.assets, before.assets);
    assert.deepEqual(factory.goalRun, before.goalRun);
    assert.equal(factory.product.pendingDbCandidates[0].id, 'db-old');
    assert.equal(factory.product.pendingCafe24Candidates[0].id, 'cafe-old');
  }
});

test('operator controls emits exact fields, official choices and reference-only metadata', () => {
  const state = { hiddenSectionIds: ['hero'], sectionInstructions: { hero: '지시문' }, sectionContents: { hero: { body_text: '보존 본문', imageBase64: 'private', apiKey: 'private' } }, currentSectionVariantIds: { hero: 'v1' } };
  const factory = { product: { productName: '제품', pendingDbCandidates: [{ id: 'db-a', title: 'DB A', thumbnailUrl: 'data:image/png;base64,private' }], selectedDbCandidateKey: 'db-a', dbCandidateResolution: 'none' }, automation: { dbSearchQuery: '검색어' } };
  const market = { selectedSites: ['naver'], results: [{ id: 'comp-a', title: '경쟁사', thumbnail_url: '/candidate.png' }], selectedIds: ['comp-a'], scrapedImages: [{ id: 'image-a', src: '/image.png' }], selectedImageIds: ['image-a'], detailSelectionVersion: 2 };
  const context = vm.createContext({ state, factoryRuntimeControlTabWorkflow: () => ({ status: 'blocked', stageKey: 'sections' }),
    factoryCaptureCandidateReviewRequestIdentity: (_type, item) => ({ candidateKey: item.id }), factoryCandidateName: item => item.title,
    factoryRuntimeControlCompPage: () => ({ marketScrape: market }), compMarketAllCandidateResults: value => value.results,
    compMarketResultId: item => item.id, compMarketScrapedImageId: item => item.id,
    orderedSections: () => [{ id: 'hero', name: '공식 섹션' }], getSectionBasisMode: () => 'current', getSectionGenerationMode: () => 'mixed',
    getSectionAssembly: () => ({ note: '보존', sources: { current: true } }),
    SECTION_BASIS_MODES: [{ id: 'current', label: '현재 지시문' }], SECTION_GENERATION_MODES: [{ id: 'mixed', label: '공식 모드' }],
    SECTION_ASSEMBLY_SOURCES: [{ id: 'current', label: '현재 지시문' }], SECTION_ASSEMBLY_CUT_USAGES: [{ id: 'none', label: '이미지컷 사용 안 함' }],
    sectionAssemblyGeneralCutChoices: () => [{ key: 'cut:a', label: '공식 컷', image: '/cut.png' }],
  });
  vm.runInContext(fn('src/app-core-03.js', 'factoryControlThumbnailReference'), context);
  vm.runInContext(fn('src/app-core-03.js', 'factoryControlOperatorControls'), context);
  const result = JSON.parse(JSON.stringify(context.factoryControlOperatorControls(factory, { fields: [{ id: 'material', label: '소재', value: '면' }] })));
  assert.deepEqual(Object.keys(result), ['schema', 'workflow', 'db', 'competitor', 'sections', 'fields', 'options']);
  assert.equal(result.db.dbCandidates[0].selected, true);
  assert.equal(result.db.dbCandidates[0].thumbnailUrl, '');
  assert.equal(result.competitor.detailImages[0].selected, true);
  assert.equal(result.sections[0].enabled, false);
  assert.equal(result.sections[0].currentVariantId, 'v1');
  assert.equal(result.options.basisModes[0].label, '현재 지시문');
  assert.deepEqual(result.options.cutCandidates[0], { id: 'cut:a', label: '공식 컷', thumbnailUrl: '/cut.png' });
  assert.doesNotMatch(JSON.stringify(result), /base64|private|apiKey/);
});

test('resume requiredValues cannot overwrite confirmed DB or current operator field edits', async () => {
  const factory = { product: { selectedDbCandidateKey: 'db-a', finalDb: { material: '확정 소재', width_mm: '250' },
    confirmedDb: { material: '확정 소재', width_mm: '250' }, requirementsSnapshot: {},
    dbFieldSettings: { width_mm: { manualTouched: true, manualValue: '300' }, usage: { manualTouched: true, manualValue: '' } } }, automation: {} };
  const context = vm.createContext({ state: { productInfoManualValues: {} }, factoryRuntimeDetachedValue: structuredClone,
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, execute) => execute(factory) });
  vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeControlRestoreRequiredValues'), context);
  await context.factoryRuntimeControlRestoreRequiredValues({ productName: '고정 제품', requiredValues: { material: '옛 소재', widthMm: '100', usage: '옛 용도' } });
  assert.equal(factory.product.finalDb.material, '확정 소재');
  assert.equal(factory.product.finalDb.width_mm, '300');
  assert.equal(factory.product.finalDb.widthMm, '300');
  assert.equal(factory.product.confirmedDb.width_mm, '300');
  assert.equal(factory.product.requirementsSnapshot.usage, '');
});

test('none and completed candidate review do not trigger DB search on every resumed cut', async () => {
  for (const product of [{ dbCandidateResolution: 'none', cafe24CandidateResolution: 'none' },
    { pendingDbCandidates: [{ id: 'reviewed-a' }] },
    { cafe24AutoMatchDeclined: true }]) {
    let searches = 0;
    const context = vm.createContext({ state: {}, factoryRuntimeReadFactory: () => ({ product }),
      factoryRunDbCandidatesForSelection: async () => { searches += 1; }, factoryRuntimeControlRestoreRequiredValues: async () => {},
      factoryRuntimeControlCompetitorSnapshot: () => ({ candidates: [{ id: 'comp-a' }], selectedIds: ['comp-a'], detailImages: [{ id: 'image-a' }], analysis: { ready: true } }),
      factoryRuntimeDetachedValue: structuredClone, saveLastWorkNow() {},
    });
    vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeControlEnsureAutoReferences'), context);
    await context.factoryRuntimeControlEnsureAutoReferences({ mode: 'auto' });
    assert.equal(searches, 0);
  }
});

test('delayed manual search rejects a foreign scope or newer document before any write', async () => {
  for (const kind of ['workspace', 'revision']) {
    let resolve;
    const pendingSearch = new Promise(yes => { resolve = yes; });
    let current = true, documentRevision = 1, writes = 0;
    const token = { revision: 1 };
    const factory = { product: { productName: '고정' }, automation: {} };
    const context = vm.createContext({ factoryRuntimeRequireStore: () => ({ getSnapshot: () => ({ factory }),
      getOperationToken: () => token, isOperationCurrent: () => current }),
      factoryRuntimeWithOperationLease: (_key, _ctx, execute) => execute({ operationToken: token }),
      factoryCandidateCollectionScope: () => 'scope', factoryCandidateCollectionScopeMatches: () => current,
      factoryRuntimeControlTabScope: () => ({ revision: documentRevision }), factoryRuntimeControlTabScopeMatches: () => current,
      factoryCandidateSearchTerms: () => ['검색'], factorySearchSinhwaReviewCandidates: () => pendingSearch,
      factoryRuntimeBridgeAction: () => { writes += 1; }, factoryRuntimeStaleActionError: code => new Error(`stale:${code}`),
    });
    vm.runInContext(fn('src/app-core-06.js', 'factoryRunDbCandidatesForSelection'), context);
    const pending = context.factoryRunDbCandidatesForSelection({ searchOnly: true, query: '검색', source: 'db' });
    if (kind === 'workspace') current = false; else documentRevision = 2;
    resolve([{ id: 'late' }]);
    await assert.rejects(pending, /stale/);
    assert.equal(writes, 0);
    assert.equal(factory.product.productName, '고정');
    assert.deepEqual(factory.automation, {});
  }
});

test('sections tab reuses native editor actions and generation failure does not report success', async () => {
  const { createSectionsFactoryTab } = await import(pathToFileURL(path.join(root, 'src/menus/factory/tabs/sections-tab.mjs')));
  const token = { local: true }, calls = [];
  const state = { sectionContents: { hero: { body_text: '본문' } }, sectionGenerating: { hero: 'error' } };
  const context = vm.createContext({ state, factoryRuntimeSectionsGuideAction() {},
    factoryRuntimeControlTabScope: () => ({ workspaceId: 'a', productKey: 'a', runId: 'a', inputFingerprint: 'a' }),
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => token, isOperationCurrent: value => value === token }),
    currentRuntimeMenuOperationToken: () => 'local-menu', factoryRuntimeStaleActionError: code => new Error(code),
    factoryRuntimeBatchCommandError: code => new Error(code), assertRuntimeOperationContextCurrent() {},
    pushEditorHistory() {}, saveManualSectionContent: (id, patch) => calls.push({ action: 'saveManualSection', value: { id, patch } }),
    applySectionVariant: (sectionId, variantId) => calls.push({ action: 'applySectionVariant', value: { sectionId, variantId } }), render() {},
  });
  vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeControlTabScopeMatches'), context);
  vm.runInContext(fn('src/app-core-03.js', 'factoryRuntimeSectionsActions'), context);
  context.factoryRuntimeSectionsActions.editorActions = Object.fromEntries(['updateSectionInstruction', 'updateSectionAssemblySource',
    'updateSectionAssemblyCutUsage', 'updateSectionAssemblyCut', 'updateSectionAssemblyNote', 'setSectionBasisMode',
    'setSectionGenerationMode', 'updateSectionOrder', 'setSectionEnabled', 'generateSection'].map(action => [action, (value, operation) => {
    assert.equal(operation.isCurrent(), true);
    calls.push({ action, value });
  }]));
  const helpers = Object.fromEntries(['factoryAutomationCounts', 'factoryAutomationWizardTasks', 'factoryAutomationReviewSummary',
    'renderFactoryAutomationStatusCard', 'renderFactoryAutomationTaskChecklist'].map(key => [key, () => ({})]));
  const tab = createSectionsFactoryTab({ getSnapshot: () => ({}), assertMutable() {}, getOperationToken: () => token,
    isOperationCurrent: value => value === token, reportError() {}, actions: { ...context.factoryRuntimeSectionsActions() }, renderHelpers: helpers });
  const source = { sectionId: 'hero', sourceId: 'current', selected: false };
  await tab.invoke('updateSectionAssemblySource', source);
  await tab.invoke('saveManualSection', { sectionId: 'hero', content: { headline: '추가' } });
  await assert.rejects(tab.invoke('generateSection', { sectionId: 'hero' }), /generation_failed/);
  assert.equal(calls[0].value, source);
  assert.equal(calls[1].value.patch.body_text, '본문');
  assert.equal(calls[1].value.patch.headline, '추가');
  assert.equal(calls[2].value, 'hero');
});
