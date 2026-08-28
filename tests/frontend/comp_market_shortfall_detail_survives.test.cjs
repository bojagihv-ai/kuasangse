'use strict';

// 회귀: 차단 사유 상세가 '수집 중에는 보이다가 완료되면 사라지던' 문제.
//
// 2026-08-29 실측. VM 후보수집을 돌리는 동안 화면에는 이렇게 떴다:
//   "미달 사유: 사이트가 접근을 막아 대기 중입니다.
//    (Naver Shopping access is temporarily restricted in the VM Chrome profile session.)"
// 그런데 수집이 끝나자 같은 자리가 이렇게 바뀌었다:
//   "미달 사유: 수집 중 오류가 났습니다. 로그를 확인하세요."
//
// 서버는 두 경우 모두 상세를 갖고 있었다 (backend /api/vm-candidate-searches/recent):
//   result.marketReports = [{ marketId: 'naver', shortfallReason: 'error', ... }]
//   result.search_report.platforms['네이버쇼핑'] = {
//     error: 'cooldown until 2026-08-29T08:53:20: blocked',
//     policy: { last_status: 'blocked', consecutive_failures: 42,
//               cooldown_until: '2026-08-29T08:53:20' },
//     raw_count: 0,
//   }
//
// 원인은 두 군데였다:
//   1) 탐색 목록(roots)에 payload.result.search_report 가 없어서, 저장된 job 껍데기로
//      다시 그릴 때 platforms 를 아예 못 찾았다.
//   2) compMarketFinalizeCollectionReports 가 마켓별 행을 새로 만들면서
//      shortfallReason/sourceLabel 만 이어받고 상세 필드를 버렸다.
//
// 계약: 두 경로 어디로 지나가도 차단 상세가 살아남는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 로직 자체이므로 스텁으로 대체하지 않고 실물을 싣는다.
function loadIngestion() {
  const normalizeSite = sourceSlice(
    CORE_06,
    'function compMarketNormalizeSite(',
    'function compMarketNormalizeProduct(',
  );
  const collectionStatus = sourceSlice(
    CORE_06,
    'function compMarketNormalizeCollectionStatus(',
    'function compMarketFinalizeCollectionReports(',
  );
  const finalize = sourceSlice(
    CORE_06,
    'function compMarketFinalizeCollectionReports(',
    'function compMarketVmCandidateBridgeBaseUrl(',
  );
  const factory = new Function(`
    ${normalizeSite}
    ${collectionStatus}
    ${finalize}
    // 이 시나리오에서 쓰지 않는 주변부만 최소한으로 채운다.
    function ensureCompMarketScrapeState() { return {}; }
    function factoryCompetitorCandidateScopePayload() {
      return { currentRunId: '', productKey: '', inputImageFingerprint: '', stageId: 'competitors' };
    }
    function compMarketTargetForSite(market, siteId) { return 4; }
    return {
      normalizeCollectionStatus: compMarketNormalizeCollectionStatus,
      finalizeCollectionReports: compMarketFinalizeCollectionReports,
    };
  `);
  return factory();
}

// backend /api/vm-candidate-searches/recent 이 실제로 돌려준 모양 그대로.
function storedJobPayload() {
  return {
    job_id: 'vm_candidate_90da99dd8f144e439c4e4f72958',
    search_id: 'search_08798f610417409f85b361ecfe5ffc65',
    status: 'completed',
    ok: true,
    result: {
      total: 16,
      status: 'success',
      keyword: '수저집 파우치',
      marketReports: [
        { accepted: 4, marketId: 'coupang', requested: 4, shortfallReason: null },
        { accepted: 0, marketId: 'naver', requested: 4, shortfallReason: 'error' },
        { accepted: 4, marketId: 'gmarket', requested: 4, shortfallReason: null },
        { accepted: 4, marketId: 'auction', requested: 4, shortfallReason: null },
        { accepted: 4, marketId: '11st', requested: 4, shortfallReason: null },
      ],
      search_report: {
        platforms: {
          네이버쇼핑: {
            error: 'cooldown until 2026-08-29T08:53:20: blocked',
            status: '차단/보안 확인',
            raw_count: 0,
            policy: {
              last_status: 'blocked',
              consecutive_failures: 42,
              cooldown_until: '2026-08-29T08:53:20',
            },
          },
          쿠팡: { error: null, status: '성공', raw_count: 30, policy: { last_status: 'success', consecutive_failures: 0 } },
        },
      },
    },
  };
}

test('저장된 작업을 다시 읽어도 차단 상세를 찾아낸다', () => {
  // roots 에 payload.result.search_report 가 없으면 platforms 를 못 찾아 상세가 빈다.
  const { normalizeCollectionStatus } = loadIngestion();
  const market = {};
  const status = normalizeCollectionStatus(storedJobPayload(), market);

  const naver = (status.marketReports || []).find(row => row.marketId === 'naver');
  assert.ok(naver, '네이버 보고를 찾지 못했습니다.');
  assert.equal(
    naver.error,
    'cooldown until 2026-08-29T08:53:20: blocked',
    '차단 상세를 못 실으면 화면이 "로그를 확인하세요" 로만 말하게 됩니다.',
  );
  assert.equal(naver.lastStatus, 'blocked');
  assert.equal(naver.cooldownUntil, '2026-08-29T08:53:20');
  assert.equal(naver.consecutiveFailures, 42);
});

test('성공한 마켓에는 없는 사유를 지어내지 않는다', () => {
  const { normalizeCollectionStatus } = loadIngestion();
  const status = normalizeCollectionStatus(storedJobPayload(), {});
  const coupang = (status.marketReports || []).find(row => row.marketId === 'coupang');
  assert.ok(coupang);
  assert.equal(coupang.error, '');
  assert.equal(coupang.shortfallReason, '');
  assert.equal(coupang.rawCount, 30, 'raw 수집량은 성공한 마켓에서도 실려야 합니다.');
});

test('수집이 완료돼도 차단 상세가 사라지지 않는다', () => {
  // 실제 피해: 수집 중에는 사유가 보이다가 완료되는 순간 사라졌다.
  const { normalizeCollectionStatus, finalizeCollectionReports } = loadIngestion();
  const market = { selectedSites: ['coupang', 'naver'] };
  normalizeCollectionStatus(storedJobPayload(), market);

  const before = market.collectionStatus.marketReports.find(row => row.marketId === 'naver');
  assert.equal(before.error, 'cooldown until 2026-08-29T08:53:20: blocked');

  // 완료 처리는 마켓별 행을 새로 만든다. 여기서 상세를 이어받아야 한다.
  finalizeCollectionReports(market, { coupang: [{}, {}, {}, {}], naver: [] });

  const after = market.collectionStatus.marketReports.find(row => row.marketId === 'naver');
  assert.ok(after, '완료 후 네이버 행이 사라졌습니다.');
  assert.equal(
    after.error,
    'cooldown until 2026-08-29T08:53:20: blocked',
    '완료 처리에서 상세를 버리면, 수집 중에만 보이다 끝나면 사라집니다.',
  );
  assert.equal(after.lastStatus, 'blocked');
  assert.equal(after.cooldownUntil, '2026-08-29T08:53:20');
  assert.equal(after.consecutiveFailures, 42);
  assert.equal(after.accepted, 0);
});

test('탐색 경로와 이어받기가 소스에 남아 있다', () => {
  // 둘 중 하나만 빠져도 증상이 되살아나므로 자리 자체를 지킨다.
  assert.match(CORE_06, /payload\?\.result\?\.search_report/);
  assert.match(CORE_06, /error: String\(prior\.error \|\| ''\)/);
  assert.match(CORE_06, /cooldownUntil: String\(prior\.cooldownUntil \|\| ''\)/);
});
