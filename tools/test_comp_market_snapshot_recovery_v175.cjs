const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core05 = fs.readFileSync(path.join(root, 'src', 'app-core-05.js'), 'utf8');
const core06 = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');

function extractFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0, `${name} not found`);
  assert.ok(end > start, `${nextName} boundary not found`);
  return source.slice(start, end);
}

const current = {
  scopeKey: 'run-current::slab-navisujeojip::fingerprint-current',
  currentRunId: 'run-current',
  productKey: 'slab-navisujeojip',
  inputImageFingerprint: 'fingerprint-current',
  stageId: 'competitors',
  productName: '슬라브나비수저집',
};

const snapshot = {
  key: 'run-previous::slab-navisujeojip::fingerprint-current',
  savedAt: 100,
  currentRunId: 'run-previous',
  productKey: current.productKey,
  inputImageFingerprint: current.inputImageFingerprint,
  stageId: current.stageId,
  productName: current.productName,
  selectedSites: ['coupang'],
  results: [{
    id: 'candidate-1',
    platform: 'coupang',
    title: '슬라브나비수저집 경쟁 상품',
    product_url: 'https://example.test/candidate-1',
    factoryWorkKey: 'run-previous::slab-navisujeojip::fingerprint-current',
    currentRunId: 'run-previous',
    generationRunId: 'run-previous',
    productKey: current.productKey,
    factoryProductKey: current.productKey,
    scopeProductKey: current.productKey,
    inputImageFingerprint: current.inputImageFingerprint,
    stageId: current.stageId,
    workProductName: current.productName,
  }],
  groupedResults: {},
};

const context = {
  COMP_MARKET_CANDIDATE_SNAPSHOT_RESULT_LIMIT: 60,
  COMP_MARKET_STAGE_ID: 'competitors',
  compMarketCurrentWorkScope: () => current,
  compMarketCandidateSnapshotKey: scope => scope.scopeKey,
  compMarketReadCandidateSnapshotStore: () => ({ snapshots: { [snapshot.key]: snapshot } }),
  compMarketCandidateNormalizeText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
  compMarketTextCompatible: (left, right) => {
    const a = String(left || '').replace(/\s+/g, '').toLowerCase();
    const b = String(right || '').replace(/\s+/g, '').toLowerCase();
    return a === b || a.includes(b) || b.includes(a);
  },
  compMarketFilterCandidatesForCurrentWork: rows => Array.isArray(rows) ? rows : [],
  compMarketTrimImageRowsForState: rows => Array.isArray(rows) ? rows : [],
  compMarketDedupeScrapedImages: rows => Array.isArray(rows) ? rows : [],
  compMarketFilterScrapedImagesForCurrentWork: rows => Array.isArray(rows) ? rows : [],
  compMarketScrapedImageId: (row, index) => String(row?.id || `image-${index}`),
  compMarketNormalizeSite: value => String(value || ''),
  compMarketResultId: row => String(row?.id || ''),
};

vm.createContext(context);
vm.runInContext([
  extractFunction(core05, 'compMarketFindCandidateSnapshot', 'compMarketRestoreCandidateSnapshot'),
  extractFunction(core05, 'compMarketRestoreCandidateSnapshot', 'compMarketHasWorkPayload'),
  extractFunction(core05, 'compMarketStampRowsWithCurrentWork', 'compMarketCandidateIsVmSearchResult'),
].join('\n'), context);

assert.strictEqual(
  context.compMarketFindCandidateSnapshot(current),
  snapshot,
  '같은 제품·입력이미지 후보는 실행 ID가 바뀌어도 보관함에서 찾아야 합니다.'
);
assert.strictEqual(
  context.compMarketFindCandidateSnapshot({ ...current, inputImageFingerprint: 'different-image' }),
  null,
  '다른 입력이미지 후보는 보관함에서 복구하면 안 됩니다.'
);

const restoredMarket = {};
const restoredRows = context.compMarketRestoreCandidateSnapshot(restoredMarket, current, { force: true });
assert.equal(restoredRows.length, 1, '보관 후보를 선택판으로 복구해야 합니다.');
assert.equal(restoredRows[0].currentRunId, current.currentRunId, '복구 후보는 현재 상세수집 실행 ID로 재스탬프해야 합니다.');
assert.equal(restoredRows[0].factoryWorkKey, current.scopeKey, '복구 후보는 현재 작업 범위를 사용해야 합니다.');
assert.equal(restoredRows[0].sourceCurrentRunId, 'run-previous', '후보가 온 이전 실행 ID는 보존해야 합니다.');

const detailCaptureFunction = extractFunction(core06, 'runCompMarketDetailCapture', 'reloadCompMarketDetailImagesFromCurrentJob');
for (const contract of [
  /factory_scope:\s*true/,
  /currentRunId:\s*factoryDetailScope\.currentRunId/,
  /productKey:\s*factoryDetailScope\.productKey/,
  /inputImageFingerprint:\s*factoryDetailScope\.inputImageFingerprint/,
  /stageId:\s*factoryDetailScope\.stageId/,
]) {
  assert.match(detailCaptureFunction, contract, `VM 상세수집 identity contract missing: ${contract}`);
}

console.log(JSON.stringify({ ok: true, restoredCount: restoredRows.length, currentRunId: restoredRows[0].currentRunId }));
