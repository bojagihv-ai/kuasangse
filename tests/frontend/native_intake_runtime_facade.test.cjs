const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');
const syncSource = fs.readFileSync(path.join(__dirname, '../../src/cafe24-sync.js'), 'utf8');
const start = source.indexOf('function factoryRuntimeBulkIntakeFacade(');
const end = source.indexOf('\nfunction installFactoryRuntimeStart(', start);

test('native initial-input facade gives search an isolated row factory and never current C', async () => {
  assert.ok(start >= 0 && end > start);
  const currentC = { product: { productName: '현재 C', naturalHint: '현재 C 힌트' } };
  let searchOptions;
  let directTerms;
  const context = vm.createContext({
    factoryAutomationFieldReviewDefinitions: () => [{ id: 'product_name' }],
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeFreezeDetachedValue: value => Object.freeze(value),
    factorySearchSinhwaReviewCandidates: async () => [],
    factorySearchCafe24ReviewCandidates: async (_terms, _limit, options) => { searchOptions = options; return [{ product_no: 9999 }]; },
    factorySearchCafe24DirectReviewCandidates: async terms => { directTerms = terms; return [{ product_no: 3000 }]; },
    factoryCandidateImageUrl: () => '', escapeHtml() {}, escAttr() {}, factoryAutomationStatusTone() {},
    fetchSinhwaProductDetail() {}, normalizeSinhwaDbMatch() {}, factoryExtractBojagiSquareSizeFromSelectedText() {},
    factorySelectedProductFieldValues: () => ({}), parseCafe24Raw: value => value.raw || value,
    fetchCafe24ProductFullByNo: async productNo => ({ product_no: productNo, product_name: '선택 Cafe' }),
    normalizeCafe24ProductCandidate: value => value, factoryCafe24CandidateKey: value => String(value.product_no),
    factoryCafe24DbFieldValue: (_field, factory) => factory.product.productName,
    CAFE24_CONTROL_API: { defaultMallId: 'default' },
  });
  vm.runInContext(source.slice(start, end), context);
  const facade = context.factoryRuntimeBulkIntakeFacade(() => '<section></section>');

  const candidates = await facade.searchCandidates({ source: 'cafe24', query: '행 제품', productName: '행 제품' });

  assert.equal(candidates[0].product_no, 3000);
  assert.deepEqual(Array.from(directTerms), ['행 제품']);
  assert.equal(searchOptions, undefined, '초기입력 실조회에서 전체 snapshot 보조 후보를 사용하면 안 됩니다.');
  assert.deepEqual(currentC, { product: { productName: '현재 C', naturalHint: '현재 C 힌트' } });
});

test('Cafe24 detail selection returns direct reference fields without update authority', async () => {
  let selectedArguments;
  const context = vm.createContext({
    factoryAutomationFieldReviewDefinitions: () => [{ id: 'sale_price' }],
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeFreezeDetachedValue: value => Object.freeze(value),
    factorySearchSinhwaReviewCandidates: async () => [], factorySearchCafe24ReviewCandidates: async () => [],
    factoryCandidateImageUrl: () => '/thumb.jpg', escapeHtml() {}, escAttr() {}, factoryAutomationStatusTone() {},
    fetchSinhwaProductDetail() {}, normalizeSinhwaDbMatch() {}, factoryExtractBojagiSquareSizeFromSelectedText: () => null,
    factorySelectedProductFieldValues: args => { selectedArguments = args; return { sale_price: args.cafe24Value('sale_price') }; },
    parseCafe24Raw: value => value.raw || value,
    fetchCafe24ProductFullByNo: async productNo => ({ product_no: productNo, product_name: '선택 Cafe', price: '5000' }),
    normalizeCafe24ProductCandidate: value => value, factoryCafe24CandidateKey: value => String(value.product_no),
    factoryCafe24DbFieldValue: (_field, factory) => factory.product.cafe24Candidates[0].price,
    CAFE24_CONTROL_API: { defaultMallId: 'default' },
  });
  vm.runInContext(source.slice(start, end), context);
  const candidate = {
    product_no: 3000,
    reviewProductScopeKey: 'current-c-scope',
    reviewProductIdentityKey: 'current-c-identity',
    reviewProductName: 'current C',
  };
  const result = await context.factoryRuntimeBulkIntakeFacade(() => '').selectCandidate({
    source: 'cafe24', candidate, productName: '행 제품',
  });

  assert.deepEqual(result.source, { kind: 'direct', selectionId: '3000' });
  assert.equal(result.values.sale_price, '5000');
  assert.equal(selectedArguments.productName, '행 제품');
  assert.equal(result.updateProductNo, undefined);

  const [{ applySelectedProductSource }, { buildBulkPlan, buildProductPayload, serializeWorkingState }] = await Promise.all([
    import('../../control_tower/frontend/src/bulk-intake-source.mjs'),
    import('../../control_tower/frontend/src/bulk-intake-model.mjs'),
  ]);
  const product = {
    productName: '행 제품',
    images: [{ fileName: 'a.jpg', role: 'base' }],
    requiredValues: { category: '지갑', widthMm: '10', depthMm: '10' },
    sourceLookup: { cafe24: { candidates: [candidate] } },
  };
  applySelectedProductSource(product, result, 7);
  const stored = serializeWorkingState({ grouped: { products: [product] } });
  const payload = buildProductPayload(buildBulkPlan([product]).entries[0], {
    dataUrls: ['data:image/jpeg;base64,eA=='], sha256s: ['abc'],
  });
  assert.equal(stored.products[0].sourceLookup, undefined);
  assert.deepEqual(product.sourceSelection, {
    kind: 'direct', selectionId: '3000', label: 'Cafe24 #3000 · 선택 Cafe', thumbnail: '/thumb.jpg', confirmedAt: 7,
  });
  assert.deepEqual(payload.source, { kind: 'direct', selectionId: '3000' });
  assert.equal(JSON.stringify({ result, stored, payload }).includes('current-c-'), false);
});

test('original Cafe24 candidate search honors the explicit row factory context', async () => {
  const searchStart = syncSource.indexOf('async function factorySearchCafe24ReviewCandidates(');
  const searchEnd = syncSource.indexOf('\nfunction factoryCafe24RerankKey(', searchStart);
  let naturalText;
  const context = vm.createContext({
    cleanDbSearchTerm: value => value,
    getAnalysisMatchSettings: () => ({ cafe24RankEngine: 'local' }),
    factoryRuntimeReadFactory: () => { throw new Error('current C must not be read'); },
    findCafe24CandidateMatches: async termInfo => { naturalText = termInfo.settings.naturalText; return { ranked: [], usedQuery: '', candidatePoolCount: 0, snapshotCount: 0 }; },
    normalizeCafe24ProductCandidate: value => value,
    factorySearchCafe24DirectReviewCandidates: async () => [],
    factoryDedupeCafe24Candidates: value => value,
    factoryCandidateScore: () => 0,
    normalizeAnalysisAiEngine: () => 'local',
    getCafe24CandidateImageAttachLimit: () => 0,
    selectCafe24CandidatesForImagePayloads: () => [],
    fetchCafe24CandidateImagePayloads: async () => ({ payloads: [] }),
    rerankCafe24CandidatesWithGpt: async () => ({ candidates: [] }),
    getAnalysisEngineRunInfo: () => ({}),
    factoryLog: () => {},
    factorySlimReviewCandidateList: value => value,
  });
  vm.runInContext(syncSource.slice(searchStart, searchEnd), context);

  await context.factorySearchCafe24ReviewCandidates(['행 제품'], 24, { factory: { product: { naturalHint: '행 전용 힌트' } } });

  assert.equal(naturalText, '행 전용 힌트');
});
