const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core05 = fs.readFileSync(path.join(root, 'src', 'app-core-05.js'), 'utf8');
const core06 = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');
const core03 = fs.readFileSync(path.join(root, 'src', 'app-core-03.js'), 'utf8');
const competitorMenu = fs.readFileSync(path.join(root, 'src', 'menus', 'competitor-menu.mjs'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const signatureStart = source.indexOf('(', start);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') signatureDepth += 1;
    if (char === ')') signatureDepth -= 1;
    if (signatureDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.ok(bodyStart >= 0, `${name} body start not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body not closed`);
}

const scrapedImageId = extractFunction(core05, 'compMarketScrapedImageId');
const visibleDetailImagesForSelection = extractFunction(core05, 'compMarketVisibleDetailImagesForSelection');
const selectedScrapedImages = extractFunction(core05, 'compMarketSelectedScrapedImages');
const renderedImagePanel = extractFunction(core05, 'renderCompMarketScrapedImagesPanel');
const analyzeSelectedImages = extractFunction(core06, 'analyzeCompMarketScrapedImages');

const imageSelectionContext = {
  compMarketScrapedImageDedupeKey(image) {
    return `capture:${image.candidateId || image.productUrl || image.title || ''}:${image.captureIndex ?? 0}`;
  },
  compMarketDedupeScrapedImages(images) {
    return Array.isArray(images) ? images : [];
  },
  compMarketCurrentDetailImages(market) {
    return {
      currentImages: Array.isArray(market?.currentImages) ? market.currentImages : (Array.isArray(market?.scrapedImages) ? market.scrapedImages : []),
      previousImages: Array.isArray(market?.previousImages) ? market.previousImages : [],
    };
  },
};
vm.createContext(imageSelectionContext);
vm.runInContext([scrapedImageId, visibleDetailImagesForSelection, selectedScrapedImages].join('\n'), imageSelectionContext);

const duplicatedSourceIdImages = [
  {
    id: 'screenshots_0',
    candidateId: 'coupang-9075021207',
    productUrl: 'https://www.coupang.com/vp/products/9075021207',
    title: 'VM 쿠팡 검색 수저주머니',
    captureIndex: 0,
  },
  {
    id: 'screenshots_0',
    candidateId: 'elevenst-rilakkuma',
    productUrl: 'https://www.11st.co.kr/products/rilakkuma',
    title: '리락쿠마 멀티케이스',
    captureIndex: 0,
  },
];

const coupangImageId = imageSelectionContext.compMarketScrapedImageId(duplicatedSourceIdImages[0], 0);
const elevenstImageId = imageSelectionContext.compMarketScrapedImageId(duplicatedSourceIdImages[1], 1);
assert.notEqual(
  coupangImageId,
  elevenstImageId,
  '서로 다른 VM 상세페이지가 같은 원본 screenshots_0 ID를 가져도 독립적으로 한 장씩 선택할 수 있어야 합니다.',
);
assert.deepEqual(
  Array.from(imageSelectionContext.compMarketSelectedScrapedImages({
    scrapedImages: duplicatedSourceIdImages,
    selectedImageIds: [coupangImageId],
  }).map(image => image.title)),
  ['VM 쿠팡 검색 수저주머니'],
  '쿠팡 한 장을 선택하면 리락쿠마 이미지는 분석 입력에 섞이면 안 됩니다.',
);
assert.deepEqual(
  Array.from(imageSelectionContext.compMarketVisibleDetailImagesForSelection({
    currentImages: [],
    previousImages: duplicatedSourceIdImages,
  }).map(image => image.title)),
  ['VM 쿠팡 검색 수저주머니', '리락쿠마 멀티케이스'],
  '현재 작업 이미지가 비어도 화면에 보이는 이전 상세이미지는 사용자가 명시적으로 한 장씩 분석 대상으로 고를 수 있어야 합니다.',
);
assert.match(
  renderedImagePanel,
  /compMarketVisibleDetailImagesForSelection\(market\)/,
  '화면에 선택 가능하게 보인 상세이미지 배열과 분석 배열의 기준을 하나로 맞춰야 합니다.',
);
assert.match(
  analyzeSelectedImages,
  /compMarketVisibleDetailImagesForSelection\(market\)/,
  '선택 이미지 분석은 화면에 보인 동일한 상세이미지 배열을 분석해야 합니다.',
);

const detailOperationUrl = extractFunction(core06, 'compMarketDetailOperationUrl');
const detailOperationIds = extractFunction(core06, 'compMarketDetailOperationIds');
const beginOperation = extractFunction(core06, 'compMarketBeginDetailOperation');
const operationStillCurrent = extractFunction(core06, 'compMarketDetailOperationStillCurrent');
const imageMatchesOperation = extractFunction(core06, 'compMarketDetailImageMatchesOperation');
const stampDetailImages = extractFunction(core06, 'compMarketStampDetailImagesForOperation');
const recoverDetailHistory = extractFunction(core06, 'recoverCompMarketDetailImagesFromHistory');
const autoRecoverDetailHistory = extractFunction(core06, 'compMarketMaybeAutoRecoverDetailImages');
const detailCapture = extractFunction(core06, 'runCompMarketDetailCapture');
const candidateCollection = extractFunction(core06, 'factoryRunVmCompetitorCollectionForSelection');

const context = { Date: { now: () => 1710000000000 } };
vm.createContext(context);
vm.runInContext([
  detailOperationUrl,
  detailOperationIds,
  beginOperation,
  operationStillCurrent,
  imageMatchesOperation,
  stampDetailImages,
].join('\n'), context);

const market = {
  selectedIds: ['coupang-current'],
  detailSelectionVersion: 4,
};
const operation = context.compMarketBeginDetailOperation(market, {
  ids: ['coupang-current'],
  selectedItems: [{
    id: 'coupang-current',
    title: '수저주머니 복주머니',
    platform: 'coupang',
    product_url: 'https://www.coupang.com/vp/products/9075021207',
  }],
  runtime: 'vm',
  scope: {
    currentRunId: 'run-current',
    productKey: 'slab-navisujeojip',
    inputImageFingerprint: 'image-current',
    stageId: 'competitors',
  },
});

assert.deepEqual(Array.from(operation.selectedIds), ['coupang-current']);
assert.equal(context.compMarketDetailOperationStillCurrent(market, operation), true);
assert.equal(context.compMarketDetailImageMatchesOperation({
  candidateId: 'coupang-current',
  productUrl: 'https://www.coupang.com/vp/products/9075021207',
}, operation), true);
assert.equal(context.compMarketDetailImageMatchesOperation({
  candidateId: 'https://www.coupang.com/vp/products/9075021207',
  productUrl: 'https://www.coupang.com/vp/products/9075021207',
}, operation), true, 'VM 결과가 candidateId 자리에 상품 URL을 넣어도 선택 URL이 같으면 상세이미지를 유지해야 합니다.');
assert.equal(context.compMarketDetailImageMatchesOperation({
  candidateId: 'VM_쿠팡_검색_슬라브나비수저집_상품_coupang-current',
  productUrl: '',
}, operation), true, '상세수집 이력 ID 안에 선택 후보 ID가 포함돼 있으면 현재 선택 결과로 복구해야 합니다.');
assert.equal(context.compMarketDetailImageMatchesOperation({
  candidateId: 'gmarket-old',
  productUrl: 'https://item.gmarket.co.kr/old',
}, operation), false);
const stampedImages = context.compMarketStampDetailImagesForOperation([{
  id: 'history-image',
  candidateId: 'VM_쿠팡_검색_슬라브나비수저집_상품_coupang-current',
  src: 'http://127.0.0.1:5002/api/local_image?path=current.jpg',
}], operation, ['detail-job-current']);
assert.equal(stampedImages[0].currentRunId, operation.scope.currentRunId);
assert.equal(stampedImages[0].productKey, operation.scope.productKey);
assert.equal(stampedImages[0].inputImageFingerprint, operation.scope.inputImageFingerprint);
assert.equal(stampedImages[0].stageId, operation.scope.stageId);
assert.ok(
  recoverDetailHistory.indexOf('compMarketStampDetailImagesForOperation')
    < recoverDetailHistory.indexOf('compMarketFilterScrapedImagesForCurrentWork'),
  '복구 이력에는 작업 식별자를 먼저 붙인 뒤 현재 작업 필터를 적용해야 합니다.'
);
assert.match(
  autoRecoverDetailHistory,
  /!recovered\.ok[\s\S]{0,180}compMarketAutoRecoverDetailImagesKey\s*=\s*''/,
  '자동 복구가 아직 비어 있으면 다음 경쟁사 탭 진입에서 다시 시도할 수 있어야 합니다.'
);

market.selectedIds = ['gmarket-old'];
market.detailSelectionVersion += 1;
assert.equal(
  context.compMarketDetailOperationStillCurrent(market, operation),
  false,
  '선택 변경 뒤 이전 상세수집 operation은 결과를 현재 목록에 병합하면 안 됩니다.'
);

assert.doesNotMatch(
  candidateCollection,
  /market\.topN\s*=\s*requestedTopN/,
  '자동 실행 횟수가 시장별 목표 수량을 덮어쓰면 안 됩니다.'
);
assert.match(detailCapture, /compMarketBeginDetailOperation/);
assert.match(detailCapture, /compMarketAssertDetailOperationCurrent/);
assert.match(detailCapture, /await factoryYieldToPaint\(\)/);
assert.match(
  competitorMenu,
  /bind\(root\)[\s\S]*call\('maybeRecoverDetailImages'\)/,
  '경쟁사 메뉴가 활성 DOM을 바인딩하면 현재 작업의 VM 상세 이미지 자동 복구를 다시 시도해야 합니다.'
);
assert.match(
  core03,
  /maybeRecoverDetailImages\(\)\s*{\s*return compMarketMaybeAutoRecoverDetailImages\(\);\s*}/,
  '메뉴 소유 복구 명령은 기존 상세 이미지 복구 구현에 연결되어야 합니다.'
);

console.log(JSON.stringify({
  ok: true,
  operationId: operation.id,
  selectedIds: operation.selectedIds,
  staleAfterSelectionChange: !context.compMarketDetailOperationStillCurrent(market, operation),
}));
