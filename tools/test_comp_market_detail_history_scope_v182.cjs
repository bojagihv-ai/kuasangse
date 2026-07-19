const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core06 = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');

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

const historyRecoveryOperation = extractFunction(core06, 'compMarketHistoryRecoveryOperation');
const historyItemMatchesOperation = extractFunction(core06, 'compMarketHistoryItemMatchesDetailOperation');
const detailOperationUrl = extractFunction(core06, 'compMarketDetailOperationUrl');
const detailOperationIds = extractFunction(core06, 'compMarketDetailOperationIds');
const operationStillCurrent = extractFunction(core06, 'compMarketDetailOperationStillCurrent');

const currentScope = {
  currentRunId: 'run-current',
  productKey: 'slab-navisujeojip',
  inputImageFingerprint: 'image-current',
  stageId: 'competitors',
};
const context = {
  compMarketCurrentWorkScope: () => currentScope,
};
vm.createContext(context);
vm.runInContext([
  detailOperationUrl,
  detailOperationIds,
  operationStillCurrent,
  historyRecoveryOperation,
  historyItemMatchesOperation,
].join('\n'), context);

const operation = {
  id: 'detail-current',
  status: 'done',
  completedAt: Date.now(),
  selectionVersion: 3,
  selectedIds: ['coupang-current'],
  acceptedCandidateIds: ['coupang-current'],
  selectedUrls: ['https://www.coupang.com/vp/products/9075021207'],
  scope: currentScope,
};
const market = {
  selectedIds: ['coupang-current'],
  detailSelectionVersion: 3,
  detailOperation: operation,
};

assert.equal(context.compMarketHistoryRecoveryOperation(market), operation);
assert.equal(context.compMarketHistoryItemMatchesDetailOperation({
  candidateId: 'coupang-current',
}, operation), true);
assert.equal(context.compMarketHistoryItemMatchesDetailOperation({
  product_id: 'VM_쿠팡_검색_슬라브나비수저집_상품_수저주머니_coupang-current',
  platform: 'vm',
}, operation), true, 'VM 상세 이력의 긴 product_id 안에 선택 후보 ID가 있으면 현재 작업으로 복구해야 합니다.');
assert.equal(context.compMarketHistoryItemMatchesDetailOperation({
  candidateId: 'gmarket-old',
  title: '소피아 수저',
}, operation), false);
assert.equal(context.compMarketHistoryItemMatchesDetailOperation({
  productUrl: 'https://item.11st.co.kr/u-envelope',
  title: 'U자봉투',
}, operation), false);

market.selectedIds = ['gmarket-old'];
market.detailSelectionVersion += 1;
assert.equal(
  context.compMarketHistoryRecoveryOperation(market),
  null,
  '선택이 바뀐 뒤에는 이전 선택의 상세수집 이력을 자동 복구하면 안 됩니다.'
);

market.selectedIds = ['coupang-current'];
assert.equal(
  context.compMarketHistoryRecoveryOperation(market),
  operation,
  '완료된 상세수집과 현재 선택이 다시 정확히 같으면 같은 작업 범위의 이력을 복구해야 합니다.'
);

console.log(JSON.stringify({ ok: true, selectedOnly: true }));
