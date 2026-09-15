const assert = require('node:assert/strict');
const test = require('node:test');

test('파일명은 명시한 이름을 보존하며 지원하지 않는 MIME은 기존 PNG 확장자를 유지한다', async () => {
  const { filenameFor } = await import('../../src/modules/work-bundle-foundation.mjs');
  for (const [mime, expected] of [
    ['image/jpeg', 'photo.jpg'], ['image/webp', 'photo.webp'], ['image/png', 'photo.png'],
    ['text/html', 'photo.png'], ['toString', 'photo.png'], ['constructor', 'photo.png'], ['', 'photo.png'],
  ]) assert.equal(filenameFor({}, 'photo', mime), expected);
  assert.equal(filenameFor({ name: 'chosen.png' }, 'photo', 'image/jpeg'), 'chosen.png');
});

function fixture() {
  const factory = {
    currentProjectId: 'work-a',
    product: { productKey: 'product-a', inputImageFingerprint: 'fingerprint-a' },
    assets: [],
    stages: {},
    archive: { localAssets: [] },
  };
  return {
    format: 'kuasangse.factory.project', version: 1, workspaceId: 'work-a',
    project: { payload: { factory, sectionImages: {}, sectionVariants: {}, currentSectionVariantIds: {} } },
  };
}

function selectedSection(value, sectionId) {
  const payload = value.project.payload;
  const asset = {
    id: `source-${sectionId}`, type: 'image', stageId: sectionId === 'size_color' ? 'options' : 'size',
    workspaceId: 'work-a', productKey: 'product-a', inputImageFingerprint: 'fingerprint-a',
    imageUrl: `/api/local-archive/assets/original-${sectionId}/image`,
  };
  payload.factory.assets.push(asset);
  payload.factory.stages[asset.stageId] = { selectedAssetIds: [asset.id] };
  payload.sectionImages[sectionId] = '__stored_in_indexeddb__';
  payload.currentSectionVariantIds[sectionId] = `variant-${sectionId}`;
  payload.sectionVariants[sectionId] = [{
    id: `variant-${sectionId}`, image: null, imageRef: 'current-section-image',
    content: { placed_asset_key: `factory:${asset.id}` },
  }];
  payload.factory.archive.localAssets.push({
    archiveId: `reference-only-${sectionId}`, sectionId, stageId: `section_${sectionId}`,
    workspaceId: 'work-a', type: 'image', files: { imageRefPath: 'image-ref.txt' },
  });
  return asset;
}

test('HTML 후보와 선택 ID는 문서 참조로 보존하고 이미지 업로드에서만 분리한다', async () => {
  const { buildWorkBundleSyncPlan } = await import('../../src/modules/work-bundle-auto-sync.mjs');
  const { binarySource } = await import('../../src/modules/work-bundle-foundation.mjs');
  assert.equal(binarySource({ documentArchiveId: 'document-only', imageUrl: '/not-an-image' }), '');
  const value = fixture();
  const factory = value.project.payload.factory;
  factory.assets = [
    { id: 'html-old', stageId: 'detail', type: 'html', documentArchiveId: 'document-old', archiveId: 'document-old', imageUrl: '/api/local-archive/assets/document-old/image', mime: 'image/png' },
    { id: 'html-selected', stageId: 'detail', type: 'html', documentArchiveId: 'document-selected', html: '<section>선택한 원문</section>' },
  ];
  factory.stages.detail = { selectedAssetIds: ['html-selected'] };
  const before = JSON.stringify(value);
  const plan = buildWorkBundleSyncPlan(value);
  assert.deepEqual(plan.manifest.assets.map(a => [a.metadata.sourceAssetId, a.selectionState]), [
    ['html-old', 'candidate'], ['html-selected', 'selected'],
  ]);
  assert.equal(plan.uploads.length, 0);
  for (const asset of plan.manifest.assets) {
    const original = factory.assets.find(a => a.id === asset.metadata.sourceAssetId);
    assert.equal(binarySource(original), '');
    assert.equal(asset.metadata.mimeType, 'text/html');
    assert.equal(asset.metadata.documentArchiveId, original.documentArchiveId);
    assert.equal(asset.metadata.documentReference, `/api/local-archive/assets/${original.documentArchiveId}`);
  }
  assert.equal(JSON.stringify(value), before);
});

test('손상된 문서 참조를 이미지 URL이나 가짜 원본으로 대체하지 않는다', async () => {
  const { buildWorkBundleSyncPlan } = await import('../../src/modules/work-bundle-auto-sync.mjs');
  const { binarySource } = await import('../../src/modules/work-bundle-foundation.mjs');
  for (const documentArchiveId of ['', '../other/image', 'https://other.test/document']) {
    const value = fixture();
    const asset = { id: 'malformed', type: 'html', stageId: 'detail', documentArchiveId, imageUrl: '/api/local-archive/assets/not-a-document/image' };
    value.project.payload.factory.assets.push(asset);
    assert.equal(binarySource(asset), '');
    assert.throws(() => buildWorkBundleSyncPlan(value), /work_bundle_document_source_invalid/);
  }
});

test('size_color와 specifications는 선택 variant가 배치한 정확한 원본을 복구한다', async () => {
  const { buildWorkBundleSyncPlan } = await import('../../src/modules/work-bundle-auto-sync.mjs');
  const value = fixture();
  const originals = ['size_color', 'specifications'].map(id => selectedSection(value, id));
  const before = JSON.stringify(value);
  const plan = buildWorkBundleSyncPlan(value);
  for (const [index, sectionId] of ['size_color', 'specifications'].entries()) {
    const upload = plan.uploads.find(a => a.assetKey === `output:sections:${sectionId}`);
    assert.equal(upload.source, originals[index].imageUrl);
  }
  assert.equal(JSON.stringify(value), before);
});

test('선택 variant라도 다른 작업이나 제품 또는 입력 이미지의 원본은 거부한다', async () => {
  const { buildWorkBundleSyncPlan } = await import('../../src/modules/work-bundle-auto-sync.mjs');
  for (const field of ['workspaceId', 'productKey', 'inputImageFingerprint']) {
    const value = fixture();
    selectedSection(value, 'specifications')[field] = 'foreign';
    const before = JSON.stringify(value);
    assert.throws(() => buildWorkBundleSyncPlan(value), /work_bundle_section_source_invalid/);
    assert.equal(JSON.stringify(value), before);
  }
  const value = fixture();
  selectedSection(value, 'specifications').workspaceId = 'foreign';
  value.project.payload.factory.workspace = { id: 'foreign' };
  assert.throws(() => buildWorkBundleSyncPlan(value), /work_bundle_section_source_invalid/);
});

test('같은 sectionId인 다른 작업 archive를 marker 복원에 사용하지 않는다', async () => {
  const { buildWorkBundleSyncPlan } = await import('../../src/modules/work-bundle-auto-sync.mjs');
  const value = fixture();
  const payload = value.project.payload;
  payload.sectionImages.specifications = '__stored_in_indexeddb__';
  payload.factory.archive.localAssets.push({
    archiveId: 'foreign', workspaceId: 'work-b', stageId: 'section_specifications', sectionId: 'specifications',
  }, {
    archiveId: 'current-legacy', sectionId: 'specifications',
  });
  const plan = buildWorkBundleSyncPlan(value);
  assert.equal(plan.uploads.some(a => a.source.includes('/foreign/')), false);
  assert.equal(plan.uploads.find(a => a.assetKey === 'output:sections:specifications')?.source,
    '/api/local-archive/assets/current-legacy/image');
});
