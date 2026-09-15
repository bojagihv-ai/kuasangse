const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const readSource = name => fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8');
const core = readSource('app-core-02.js');
const sections = readSource('app-core-03.js');
const summaries = readSource('app-core-05.js');
const generation = readSource('app-core-06.js');
const imageIdentity = readSource('cafe24-api.js');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function functionSource(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `missing existing function: ${name}`);
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}

function pricingRuntime(state) {
  const context = vm.createContext({ state, cloneData: structuredClone,
    factoryRuntimeReadFactory: () => state.factory,
    SECTIONS: [{ id: 'promotion', n: 11, name: '프로모션' }, { id: 'cta_footer', n: 15, name: 'CTA' }],
  });
  const load = (source, names) => names.forEach(name => vm.runInContext(functionSource(source, name), context));
  load(core, ['formatDbPrice', 'formatDbDimensions', 'hasProductValue', 'firstProductValue',
    'productInfoAnalysisMatch', 'productInfoDbMatch', 'productInfoSpec', 'productInfoObjectValue',
    'productInfoCafe24Match', 'productInfoCafe24Raw', 'productInfoCafe24Value',
    'productInfoCafe24FlagText', 'productInfoWithUnit', 'productInfoSizeText',
    'factoryProductAnalysisForGeneration', 'restoreFactoryInputImageForGeneration',
    'ensureCurrentProductAnalysisForGeneration']);
  vm.runInContext(core.slice(core.indexOf('const PRODUCT_INFO_FIELD_CATALOG = ['),
    core.indexOf('function setProductInfoFieldSetting(')), context);
  vm.runInContext(sections.slice(sections.indexOf('const SECTION_DB_PROMPT_FIELD_IDS = {'),
    sections.indexOf('function buildProductIdentityGuard(')), context);
  load(summaries, ['getProductContextSummary', 'getDbContextSummary']);
  load(generation, ['getPrimaryAnalysisInput']);
  load(imageIdentity, ['collectCurrentAnalysisImageInputs', 'getCurrentAnalysisImageSignature',
    'analysisMatchesCurrentImageInput', 'attachCurrentAnalysisImageIdentity']);
  state.productInfoFieldSettings = context.normalizeProductInfoFieldSettings(state.productInfoFieldSettings);
  return context;
}

function fixture(manual = { salePrice: '2000' }) {
  const state = { analysis: null, productName: '색동동전지갑', imageBase64: 'pricing-fixture',
    imageMime: 'image/png', imagePreview: 'fixture-preview', productInfoManualValues: manual,
    factory: { product: { analysis: { product_name: '색동동전지갑', category: '지갑' },
      selectedDbCandidateKey: '818', finalDb: { sale_price: '2000' } } },
  };
  const context = pricingRuntime(state);
  context.attachCurrentAnalysisImageIdentity(state.factory.product.analysis);
  assert.equal(context.ensureCurrentProductAnalysisForGeneration({ save: false }), true);
  return { state, context };
}

test('promotion and CTA preserve manual salePrice through current-image analysis and shared fact resolution', t => {
  const snapshotPath = process.env.PRICE_PROVENANCE_SNAPSHOT;
  const snapshot = snapshotPath ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : null;
  const originalDigest = snapshot ? digest(snapshot) : null;
  const { state, context } = snapshot
    ? (() => { const state = structuredClone(snapshot.assets); return { state, context: pricingRuntime(state) }; })()
    : fixture();
  if (snapshot) {
    assert.equal(state.factory.batchJobId, 'factory-job-b8996417eb8543139f295f73e8c9d723');
    assert.equal(state.analysis, null);
    assert.equal(Object.keys(state.productInfoManualValues).length, 17);
    assert.equal(Object.keys(state.sectionContents).length, 14);
    assert.equal(context.analysisMatchesCurrentImageInput(state.factory.product.analysis), true);
    assert.equal(context.ensureCurrentProductAnalysisForGeneration({ save: false }), true);
  }
  const before = digest(state);
  const row = context.getConfiguredProductInfoRows(context.getProductContextSummary(),
    context.getDbContextSummary(), { includeInactive: true }).find(item => item.id === 'sale_price');
  const facts = ['promotion', 'cta_footer'].map(id => context.buildSectionScopedAnalysisPayload(id, state.analysis).allowed_product_facts);
  t.diagnostic(JSON.stringify({ input: snapshot ? 'readonly C backup' : 'fixture',
    manualSalePrice: state.productInfoManualValues.salePrice, resolvedPrice: row.text, source: row.source,
    sectionSaleLines: facts.map(text => text.split('\n').filter(line => line.startsWith('- 판매가:'))),
    unchanged: digest(state) === before }));
  assert.equal(row.text, '2000', 'saved salePrice=2000 must not resolve to 0');
  assert.equal(row.source, '직접 입력');
  for (const text of facts) {
    assert.match(text, /^- 판매가: 2000$/m);
    assert.doesNotMatch(text, /^- 판매가: 0$/m);
  }
  assert.equal(digest(state), before, 'fact resolution must not mutate inputs, analysis or generated contents');
  if (snapshot) {
    assert.equal(digest(snapshot), originalDigest);
    assert.equal(digest(JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))), originalDigest);
  }
});

test('price alias preserves canonical priority, explicit zero, DB fallback and unrelated fields', () => {
  for (const [manual, expected] of [
    [{ salePrice: '2000' }, '2000'],
    [{ sale_price: '3100', salePrice: '2000' }, '3100'],
    [{ sale_price: ' ', salePrice: '2000' }, '2000'],
    [{ sale_price: 0, salePrice: '2000' }, '0'],
    [{ salePrice: 0 }, '0'],
    [{ sale_price: '0', salePrice: '2000' }, '0'],
    [{ salePrice: '' }, '4,500'],
    [{}, '4,500'],
  ]) {
    const { state, context } = fixture({ ...manual, material: '색동원단', width_mm: '150mm' });
    const before = digest(state);
    const rows = context.getConfiguredProductInfoRows({}, { match: { sale_price: 4500 } }, { includeInactive: true });
    assert.equal(rows.find(row => row.id === 'sale_price').text, expected, JSON.stringify(manual));
    assert.equal(rows.find(row => row.id === 'material').text, '색동원단');
    assert.equal(rows.find(row => row.id === 'width_mm').text, '150mm');
    assert.equal(digest(state), before);
  }
});
