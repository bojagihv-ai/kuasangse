'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
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

test('VM 상세 이미지가 같은 상품 스냅샷의 새 실행 세대로 복구되면 표시 상태를 유지한다', () => {
  const source = fs.readFileSync(CORE_05, 'utf8');
  const context = vm.createContext({
    COMP_MARKET_CANDIDATE_SNAPSHOT_RESULT_LIMIT: 60,
    compMarketCurrentWorkScope: () => ({
      scopeKey: 'new-run::mosi::image-a',
      currentRunId: 'new-run',
      productKey: 'mosi',
      inputImageFingerprint: 'image-a',
      stageId: 'competitors',
      productName: '모시꽃수파우치',
    }),
    compMarketFindCandidateSnapshot: () => ({
      key: 'old-run::mosi::image-a',
      currentRunId: 'old-run',
      productKey: 'mosi',
      inputImageFingerprint: 'image-a',
      stageId: 'competitors',
      productName: '모시꽃수파우치',
      results: [{ id: 'auction_B853119262', platform: 'auction', title: '옥션 후보' }],
      groupedResults: { auction: [{ id: 'auction_B853119262', platform: 'auction', title: '옥션 후보' }] },
      selectedIds: ['auction_B853119262'],
      scrapedImages: [{
        id: 'detail-image-1',
        src: '/api/vm-detail-capture/vm_candidate_test/artifacts/0',
        candidateId: 'auction_B853119262',
        currentRunId: 'old-run',
        productKey: 'mosi',
        inputImageFingerprint: 'image-a',
        stageId: 'competitors',
        detailOperationId: 'detail-old',
      }],
      detailOperation: {
        id: 'detail-old',
        selectedIds: ['auction_B853119262'],
        scope: { currentRunId: 'old-run', productKey: 'mosi', inputImageFingerprint: 'image-a', stageId: 'competitors' },
      },
      detailJobId: 'vm_candidate_test',
      detailPhase: 'detail-done',
      detailStatus: '상세수집 완료',
    }),
    compMarketStampRowsWithCurrentWork(rows, current) {
      return (Array.isArray(rows) ? rows : []).map(row => ({
        ...row,
        currentRunId: current.currentRunId,
        productKey: current.productKey,
        inputImageFingerprint: current.inputImageFingerprint,
        stageId: current.stageId,
      }));
    },
    compMarketFilterCandidatesForCurrentWork: rows => rows,
    compMarketNormalizeSite: value => String(value || '').toLowerCase(),
    compMarketResultId: (row, index) => String(row?.id || `row-${index}`),
    compMarketAllCandidateResults: market => [
      ...(Array.isArray(market.results) ? market.results : []),
      ...Object.values(market.groupedResults || {}).flatMap(rows => Array.isArray(rows) ? rows : []),
    ],
    compMarketTrimResultRowsForState: rows => rows,
    compMarketTrimImageRowsForState: rows => rows,
    compMarketDedupeCandidateRows: rows => rows,
    compMarketDedupeScrapedImages: rows => rows,
    compMarketScrapedImageId: (image, index) => String(image?.id || `image-${index}`),
    compMarketFilterScrapedImagesForCurrentWork: (rows, current) => (Array.isArray(rows) ? rows : [])
      .filter(row => row.currentRunId === current.currentRunId),
  });
  vm.runInContext(`${extractFunction(source, 'compMarketRestoreCandidateSnapshot')}\nthis.restore = compMarketRestoreCandidateSnapshot;`, context);

  const market = { results: [], groupedResults: {}, selectedIds: [] };
  context.restore(market, context.compMarketCurrentWorkScope());

  assert.equal(market.scrapedImages.length, 1, '새 실행 세대에서도 같은 상품의 실제 VM 이미지를 숨기면 안 된다.');
  assert.equal(market.scrapedImages[0].src, '/api/vm-detail-capture/vm_candidate_test/artifacts/0');
  assert.equal(market.scrapedImages[0].currentRunId, 'new-run');
});

test('명시적 최근 VM 이미지 복구는 같은 상품의 입력 이미지 세대가 달라도 완료 작업을 찾는다', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const requested = [];
  const context = vm.createContext({
    URLSearchParams,
    compMarketDetailBridgeJobIds: () => [],
    compMarketFetchVmCandidateBridge: async requestPath => {
      requested.push(requestPath);
      if (requestPath.startsWith('/api/vm-detail-captures/recent?')) {
        return { jobs: [{ job_id: 'vm_candidate_deadbeef' }] };
      }
      return { result: { images: [{ src: '/api/vm-detail-capture/vm_candidate_deadbeef/artifacts/0' }] } };
    },
    compMarketExtractDetailImages: payload => payload.images || [],
    compMarketDetailJobInfo: () => ({ manual: false }),
  });
  const bridgeFunction = extractFunction(source, 'compMarketRecoverDetailBridgePayload');
  vm.runInContext(`async ${bridgeFunction}\nthis.recoverBridge = compMarketRecoverDetailBridgePayload;`, context);

  const recovered = await context.recoverBridge({}, {
    productKey: 'mosi',
    inputImageFingerprint: 'new-image-fingerprint',
    stageId: 'competitors',
  }, { productFallback: true });

  assert.equal(recovered.jobId, 'vm_candidate_deadbeef');
  assert.equal(requested.length, 2);
  assert.match(requested[0], /productKey=mosi/);
  assert.doesNotMatch(requested[0], /inputImageFingerprint=/);
  assert.doesNotMatch(requested[0], /stageId=/);
});
