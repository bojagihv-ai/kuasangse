'use strict';

// 계약: **신화사DB를 못 쓰는 상태면 "후보 0건" 이라고 말하지 않는다.**
//
// 2026-08-31 주인님: "또 날라갔다 db랑 카페24 몇번쨰냐"
//   화면에는 "DB 후보 0건, Cafe24 후보 0건", "아직 후보를 확인하지 않음" 만 있었다.
//
// 실측으로 확인한 것:
//   /api/sinhwa-pdp/status  -> {"configured": false, "serviceKeyExposed": false}
//   /api/sinhwa-pdp/products/search?q=수저집 -> {"code": "service_key_missing"}
//   그런데 /api/sinhwa-db/status 는 {"running": true, "ok": true} 를 그대로 돌려줬다.
//
// 앱은 수집 전에 후자만 봤다. 그래서 "프로그램 켜져 있음 = 정상" 으로 판단하고 조회를 보냈고,
// 전부 막힌 결과를 "후보 0건" 으로 표시했다. 켜져 있는 것과 쓸 수 있는 것은 다른 얘기다.
// (키를 넣고 다시 띄우자 같은 검색이 743 칠색단 수저집, 873 칠색단수저집소 … 를 돌려줬다)
//
// 두 번째 거짓말도 같이 막는다: candidateReviewStatus 는 DB와 Cafe24가 나눠 쓰는 칸 하나여서,
// DB 확정이 실패한 직후 Cafe24 확정이 성공하면 DB 실패가 화면에서 통째로 지워졌다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const API = fs.readFileSync(path.join(ROOT, 'src/cafe24-api.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'src/cafe24-sync.js'), 'utf8');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('쓸 수 있는지 묻는 길이 있다', () => {
  assert.match(API, /async function fetchSinhwaPdpServiceStatus\(\)/);
  assert.match(API, /\/api\/sinhwa-pdp\/status/);
});

test('수집 전 점검이 켜짐 여부만 보지 않는다', () => {
  const preflight = sourceSlice(SYNC, 'const [sinhwaStatusResult, cafe24StatusResult, cafe24OAuthStatusResult', 'ensureCollectionScope();');
  assert.match(preflight, /fetchSinhwaPdpServiceStatus/,
    '프로그램이 켜져 있는지만 보면, 키가 없어 전부 막힌 상태를 정상으로 읽습니다.');
  assert.match(preflight, /configured === false/);
});

test('못 쓰면 조회를 보내기 전에 사유를 말한다', () => {
  const preflight = sourceSlice(SYNC, 'const sinhwaServiceUnusable =', 'ensureCollectionScope();');
  assert.match(preflight, /신화사 서비스 키가 설정되지 않았습니다/);
  assert.match(preflight, /후보가 없는 것이 아니라/, '"후보 0건" 과 구별되지 않으면 고친 의미가 없습니다.');
  assert.match(preflight, /launcher\.ps1/, '무엇을 하면 되는지 없으면 사용자가 할 수 있는 일이 없습니다.');
  assert.match(preflight, /factorySetStageStatus\('db', 'error'/);
});

test('DB 패널이 "아직 확인하지 않음" 대신 사유를 보여준다', () => {
  const view = sourceSlice(CORE_05, 'function factoryCandidateCollectionStatusView(', 'const progress = factory?.automation');
  assert.match(view, /sinhwaServiceKeyMissing === true/);
  assert.match(view, /조회 불가 · 서비스 키 없음/);
  // 원래의 거짓말이 그 자리에 그대로 있으면 안 된다 - 조건 앞에서 가로채야 한다.
  const idleAt = CORE_05.indexOf("label: '아직 후보를 확인하지 않음'");
  const guardAt = CORE_05.indexOf('sinhwaServiceKeyMissing === true');
  assert.ok(guardAt >= 0 && guardAt < idleAt, '사유 판정이 idle 문구보다 뒤에 있으면 가려집니다.');
});

test('DB 확정 실패가 Cafe24 성공에 덮이지 않는다', () => {
  // candidateReviewStatus 한 칸을 28곳이 나눠 쓴다. 마지막에 쓴 쪽만 남는다.
  assert.match(SYNC, /factory\.product\.dbConfirmFailureNote = `신화사DB 후보 적용 실패/);
  assert.match(SYNC, /current\.product\.dbConfirmFailureNote = '';/,
    '확정에 성공하면 지워야 합니다. 낡은 실패가 남아 있는 것도 거짓말입니다.');
  const view = sourceSlice(CORE_05, 'function factoryCandidateCollectionStatusView(', 'const progress = factory?.automation');
  assert.match(view, /dbConfirmFailureNote/);
  assert.match(view, /!factory\?\.product\?\.confirmedDb/, '확정이 된 뒤에도 실패를 띄우면 안 됩니다.');
});
