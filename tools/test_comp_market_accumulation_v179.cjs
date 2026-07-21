const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core02 = fs.readFileSync(path.join(root, 'src', 'app-core-02.js'), 'utf8');
const core03 = fs.readFileSync(path.join(root, 'src', 'app-core-03.js'), 'utf8');
const core05 = fs.readFileSync(path.join(root, 'src', 'app-core-05.js'), 'utf8');
const core06 = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');
const competitorMenu = fs.readFileSync(path.join(root, 'src', 'menus', 'competitor-menu.mjs'), 'utf8');

function extractFunction(source, name, nextName) {
  const plainStart = source.indexOf(`function ${name}(`);
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 && (plainStart < 0 || asyncStart < plainStart) ? asyncStart : plainStart;
  const plainEnd = source.indexOf(`function ${nextName}(`, start);
  const asyncEnd = source.indexOf(`async function ${nextName}(`, start);
  const end = asyncEnd >= 0 && (plainEnd < 0 || asyncEnd < plainEnd) ? asyncEnd : plainEnd;
  assert.ok(start >= 0, `${name} not found`);
  assert.ok(end > start, `${nextName} boundary not found`);
  return source.slice(start, end);
}

const context = {
  window: { location: { href: 'http://127.0.0.1:8081/app.html' } },
  COMP_MARKET_STATE_IMAGE_LIMIT: 80,
  compMarketStableKey(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  },
  compMarketTrimImageRowsForState: rows => (Array.isArray(rows) ? rows : []).slice(0, 80),
};

vm.createContext(context);
vm.runInContext([
  extractFunction(core05, 'compMarketNormalizeScrapedImagePath', 'compMarketProductUrlFromItem'),
  extractFunction(core05, 'compMarketScrapedImageOriginalUrl', 'compMarketScrapedImagePageCaptureKey'),
  extractFunction(core05, 'compMarketScrapedImagePageCaptureKey', 'compMarketScrapedImageDedupeKey'),
  extractFunction(core05, 'compMarketScrapedImageDedupeKey', 'compMarketDedupeScrapedImages'),
  extractFunction(core05, 'compMarketDedupeScrapedImages', 'compMarketSiteLabel'),
  extractFunction(core05, 'compMarketCandidateDedupeKey', 'compMarketDedupeCandidateRows'),
  extractFunction(core05, 'compMarketDedupeCandidateRows', 'compMarketSetCandidateSource'),
  extractFunction(core05, 'compMarketMergeScrapedImages', 'compMarketSiteLabel'),
].join('\n'), context);

const detailCaptureFunction = extractFunction(core06, 'runCompMarketDetailCapture', 'reloadCompMarketDetailImagesFromCurrentJob');
const detailReloadFunction = extractFunction(core06, 'reloadCompMarketDetailImagesFromCurrentJob', 'loadLatestJepumDetailImages');
const candidateCollectionFunction = extractFunction(core06, 'factoryRunVmCompetitorCollectionForSelection', 'factoryRunDbVmCandidatesOnlyFlow');
const sizeRestoreFunction = extractFunction(core02, 'findRestorableCurrentSizeFactoryAsset', 'restoreSpecificationSizeImageFromFactory');

const repeatedBase64 = 'A'.repeat(160);
const duplicateRows = [
  {
    id: 'capture-0',
    src: 'http://127.0.0.1:5012/api/v1/detail-captures/job-1/screenshots/0',
    base64: repeatedBase64,
    mime: 'image/png',
    title: 'U자봉투0926(택) 300장',
    platform: 'elevenst',
    candidateId: 'eleven-product-1',
    source: 'screenshot',
    captureIndex: 0,
  },
  {
    id: 'capture-1',
    src: 'http://127.0.0.1:5012/api/v1/detail-captures/job-1/screenshots/1',
    base64: repeatedBase64,
    mime: 'image/png',
    title: 'U자봉투0926(택) 300장',
    platform: 'elevenst',
    candidateId: 'eleven-product-1',
    source: 'screenshot',
    captureIndex: 1,
  },
];
const deduped = context.compMarketDedupeScrapedImages(duplicateRows, null);
assert.equal(deduped.length, 1, '같은 후보의 동일 이미지 바이트는 캡처 번호가 달라도 한 장만 남겨야 합니다.');

const pathAndUrlRows = [
  {
    id: 'local-path',
    src: 'http://127.0.0.1:5012/api/local_image?path=C%3A%5CJepumScraper%5Cdetail%5C1.jpg',
    sourcePath: 'C:\\JepumScraper\\detail\\1.jpg',
    candidateId: 'https://shop.test/product/1',
    productUrl: 'https://shop.test/product/1',
    source: 'screenshots',
    captureIndex: 0,
  },
  {
    id: 'api-url',
    src: 'http://127.0.0.1:5012/api/v1/detail-captures/job-1/screenshots/product-1/0',
    candidateId: 'https://shop.test/product/1',
    productUrl: 'https://shop.test/product/1',
    source: 'screenshot_urls',
    captureIndex: 0,
  },
];
const dedupedPathAndUrl = context.compMarketDedupeScrapedImages(pathAndUrlRows, null);
assert.equal(dedupedPathAndUrl.length, 1, '같은 캡처의 로컬 경로와 API URL을 서로 다른 상세이미지 두 장으로 표시하면 안 됩니다.');

const oldImage = { ...duplicateRows[0], id: 'old-image', base64: 'B'.repeat(160), src: 'http://127.0.0.1:5012/old' };
const newImage = { ...duplicateRows[0], id: 'new-image', base64: 'C'.repeat(160), src: 'http://127.0.0.1:5012/new', captureIndex: 2 };
const merged = context.compMarketMergeScrapedImages([oldImage], [newImage], null);
assert.deepEqual(Array.from(merged, row => row.id), ['old-image', 'new-image'], '새 상세수집은 기존 이미지 뒤에 누적되어야 합니다.');

const candidateRows = context.compMarketDedupeCandidateRows([
  { id: 'row-a', platform: 'elevenst', product_url: 'https://mall.test/item/123', title: '상품 A' },
  { id: 'row-b', platform: 'elevenst', product_url: 'https://mall.test/item/123', title: '상품 A 중복' },
  { id: 'row-c', platform: 'elevenst', product_url: 'https://mall.test/item/456', title: '상품 B' },
]);
assert.deepEqual(Array.from(candidateRows, row => row.id), ['row-a', 'row-c'], '같은 오픈마켓 상품 URL 후보는 한 건으로 보여야 합니다.');

assert.doesNotMatch(detailCaptureFunction, /market\.scrapedImages\s*=\s*\[\]/, '상세수집 시작 시 기존 이미지 목록을 비우면 안 됩니다.');
assert.match(detailCaptureFunction, /compMarketMergeScrapedImages/, '상세수집 결과는 누적 병합 경로를 사용해야 합니다.');
const detailMergeIndex = detailCaptureFunction.indexOf('market.scrapedImages = typeof compMarketMergeScrapedImages');
const duplicateWarningIndex = detailCaptureFunction.indexOf('if (duplicateDetailImages > 0)');
assert.ok(detailMergeIndex >= 0 && duplicateWarningIndex >= 0 && detailMergeIndex < duplicateWarningIndex,
  '중복 상세이미지 경고 로그가 상태 객체를 교체하기 전에 현재 작업 이미지를 먼저 병합해야 합니다.');
const detailReloadMergeIndex = detailReloadFunction.indexOf('market.scrapedImages = typeof compMarketMergeScrapedImages');
const detailReloadWarningIndex = detailReloadFunction.indexOf('if (reloadedDuplicateImages > 0)');
assert.ok(detailReloadMergeIndex >= 0 && detailReloadWarningIndex >= 0 && detailReloadMergeIndex < detailReloadWarningIndex,
  '상세이미지 다시 표시에서도 중복 경고 로그보다 현재 작업 이미지 병합을 먼저 해야 합니다.');
assert.doesNotMatch(sizeRestoreFunction, /typeof state !== ['"]undefined['"]\s*&&\s*target === state/,
  '영구 세션 초기화 중에는 아직 선언되지 않은 전역 state를 참조하면 안 됩니다.');
assert.doesNotMatch(candidateCollectionFunction, /market\.scrapedImages\s*=\s*\[\]/, 'VM 후보 재수집 시 기존 상세 이미지 목록을 비우면 안 됩니다.');
assert.match(
  competitorMenu,
  /compMarketReloadDetailImages:\s*'reloadDetailImages'/,
  '상세이미지 다시 표시 버튼은 메뉴 소유 이벤트 명령에 연결되어야 합니다.',
);
assert.match(
  core03,
  /reloadDetailImages\(\)\s*{\s*return reloadCompMarketDetailImagesFromCurrentJob\(\);\s*}/,
  '메뉴 소유 다시 표시 명령은 기존 누적 병합 구현에 연결되어야 합니다.',
);

console.log(JSON.stringify({
  ok: true,
  identicalImageCount: deduped.length,
  pathAndUrlImageCount: dedupedPathAndUrl.length,
  mergedImageIds: merged.map(row => row.id),
  candidateIds: candidateRows.map(row => row.id),
}));
