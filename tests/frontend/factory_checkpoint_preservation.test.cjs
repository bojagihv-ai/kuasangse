const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load() {
  const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryRuntimeControlSnapshotPreservesBaseline(');
  assert.ok(start >= 0, '저장 후보 보존 검사 없음');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  return context.factoryRuntimeControlSnapshotPreservesBaseline;
}

function fixture() {
  const stages = ['representative', 'size', 'option_color', 'general', 'sections', 'final_detail']
    .map(key => ({ key, candidates: [], selectedIds: [] }));
  stages[0] = { key: 'representative', candidates: [{ id: 'hero-a', digest: 'archive-a' }], selectedIds: ['hero-a'] };
  stages[4] = { key: 'sections', candidates: [{ id: 'hook:variant-a', digest: '' }], selectedIds: ['hook:variant-a'] };
  const assets = { factory: { product: { finalDb: { material: '누비', stock: '99' } },
    assets: [{ id: 'hero-a', stageId: 'hero', image: 'saved-image', metadata: { localArchiveId: 'archive-a' } }],
    stages: { hero: { selectedAssetIds: ['hero-a'] } } },
    sectionVariants: { hook: [{ id: 'variant-a', image: 'saved-section' }] },
    currentSectionVariantIds: { hook: 'variant-a' } };
  return { snapshot: { assets }, payload: { restoreBaseline: stages, requiredValues: { material: '누비', stock: '99' } } };
}

test('문서와 메모리 판이 달라도 모든 기존 후보·선택·필수값을 대조한다', () => {
  const check = load(), { snapshot, payload } = fixture();
  assert.equal(check(snapshot, payload), true);
  snapshot.assets.factory.assets.push({ id: 'new', stageId: 'hero' });
  assert.equal(check(snapshot, payload), true);
});

test('실제 저장 형식의 옵션 방식과 원산지를 canonical 위치에서 대조한다', () => {
  const check = load(), { snapshot, payload } = fixture();
  payload.requiredValues = { ...payload.requiredValues, optionMode: 'provided', originCountry: '한국' };
  snapshot.assets.factory.automation = { optionMode: 'provided' };
  snapshot.assets.factory.product.finalDb.origin = '한국';
  snapshot.assets.factory.product.finalDb.optionMode = 'none';
  snapshot.assets.factory.product.finalDb.originCountry = '중국';
  assert.equal(check(snapshot, payload), true);

  const none = structuredClone(snapshot);
  payload.requiredValues.optionMode = 'none';
  none.assets.factory.automation.optionMode = 'none';
  none.assets.factory.product.finalDb.optionMode = 'provided';
  assert.equal(check(none, payload), true);
  payload.requiredValues.optionMode = 'provided';

  const legacyOrigin = structuredClone(snapshot);
  delete legacyOrigin.assets.factory.product.finalDb.origin;
  legacyOrigin.assets.factory.product.finalDb.originCountry = '한국';
  assert.equal(check(legacyOrigin, payload), true);

  for (const change of [
    s => { s.assets.factory.automation.optionMode = 'none'; s.assets.factory.product.finalDb.optionMode = 'provided'; },
    s => { delete s.assets.factory.automation.optionMode; s.assets.factory.product.finalDb.optionMode = 'provided'; },
    s => { s.assets.factory.product.finalDb.origin = '중국'; s.assets.factory.product.finalDb.originCountry = '한국'; },
    s => { s.assets.factory.product.finalDb.origin = ''; s.assets.factory.product.finalDb.originCountry = '한국'; },
    s => { delete s.assets.factory.product.finalDb.origin; delete s.assets.factory.product.finalDb.originCountry; },
  ]) {
    const current = structuredClone(snapshot); change(current);
    assert.equal(check(current, payload), false);
  }
});

test('기존 후보·선택·섹션·필수값 중 하나라도 감소하면 복원하지 않는다', () => {
  const check = load();
  for (const change of [
    s => s.assets.factory.assets.splice(0),
    s => s.assets.factory.stages.hero.selectedAssetIds.splice(0),
    s => { s.assets.factory.assets[0].metadata.localArchiveId = 'different'; },
    s => { s.assets.currentSectionVariantIds.hook = 'other'; },
    s => { s.assets.sectionVariants.hook = []; },
    s => { s.assets.factory.product.finalDb.stock = '0'; },
  ]) {
    const { snapshot, payload } = fixture(); change(snapshot);
    assert.equal(check(snapshot, payload), false);
  }
  assert.equal(check(fixture().snapshot, {}), false);
  const { snapshot, payload } = fixture(); payload.restoreBaseline = payload.restoreBaseline.slice(0, 1);
  assert.equal(check(snapshot, payload), false);
});

test('작업파일 복원은 상세 HTML 보관 주소와 A컷을 유지하고 이미지와 구분한다', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');
  const start = source.indexOf('function normalizeFactoryAsset(');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = vm.createContext({
    FACTORY_STAGE_DEFS: [{ id: 'detail' }, { id: 'hero' }],
    factoryCoerceImageSrc: value => typeof value === 'string' && value.startsWith('data:image') ? value : '',
    cloneData: structuredClone, factoryStageLabel: value => value,
  });
  vm.runInContext(source.slice(start, end), context);
  for (const archive of [{ documentArchiveId: 'document-a' }, { metadata: { localArchiveId: 'document-a' } }]) {
    const saved = { id: 'chosen-final', stageId: 'detail', type: 'html', used: true, html: '<main>14섹션</main>', ...archive };
    const restored = context.normalizeFactoryAsset(context.normalizeFactoryAsset(saved));
    assert.equal(restored.id, saved.id);
    assert.equal(restored.documentArchiveId, 'document-a');
    assert.equal(restored.used, true);
    assert.equal(restored.html, saved.html);
  }
  const image = context.normalizeFactoryAsset({ id: 'hero', stageId: 'hero', type: 'image', archiveId: 'image-a' });
  assert.equal(image.documentArchiveId, '');
});

test('복원 시 경량화는 후보 개수나 과거 상세 변형을 줄이지 않는다', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryPruneRuntimeFactoryAssets(');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = vm.createContext({
    factorySelectedAssetIdsOnly: factory => new Set(factory.stages.detail.selectedAssetIds),
    factoryRecentAssetIdsByStage: () => new Set(['detail-14']),
    factoryAssetLooksLikeMisplacedDetailDocument: () => false,
    factoryRuntimeAssetDedupeKey: asset => asset.documentArchiveId,
    factoryRuntimePruneAsset: asset => ({ ...asset, image: null, imageUrl: `/archive/${asset.id}` }),
  });
  vm.runInContext(source.slice(start, end), context);
  const factory = { stages: { detail: { selectedAssetIds: ['detail-14'] } }, assets: [
    ...Array.from({ length: 15 }, (_, index) => ({ id: `detail-${index}`, stageId: 'detail', type: 'html', documentArchiveId: `document-${index}`, createdAt: index })),
    ...Array.from({ length: 90 }, (_, index) => ({ id: `hero-${index}`, stageId: 'hero', image: 'original', createdAt: index })),
  ] };
  const ids = factory.assets.map(asset => asset.id).sort();
  context.factoryPruneRuntimeFactoryAssets(factory, { reason: 'normalize' });
  context.factoryPruneRuntimeFactoryAssets(factory, { reason: 'normalize' });
  assert.deepEqual(factory.assets.map(asset => asset.id).sort(), ids);
  assert.equal(factory.assets.find(asset => asset.id === 'detail-0').documentArchiveId, 'document-0');
  assert.deepEqual(factory.stages.detail.selectedAssetIds, ['detail-14']);
});
