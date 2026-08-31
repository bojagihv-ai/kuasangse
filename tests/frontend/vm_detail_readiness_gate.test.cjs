'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function block(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `블록을 찾지 못함: ${startMarker}`);
  return SOURCE.slice(start, end);
}

const READY = block(
  'async function compMarketEnsureVmDetailCaptureReady(',
  'async function compMarketOpenVisibleVmCapture(',
);
const TRY_VM = block(
  'async function compMarketTryVmScrapeDetails(',
  'async function compMarketReadV1SearchProducts(',
);

/**
 * VM 준비 판정은 VM 을 봐야 한다. 이 앱 백엔드의 /health 만 보면 게스트 watcher 가 죽어도
 * "준비됨" 이 되어 상세수집을 VM 으로 보내고 job_timeout(3600초) 을 기다린다.
 * 실측 2026-08-31: 같은 고장을 후보검색은 5초 만에 알아채는데 상세수집만 한 시간이 걸렸다.
 */
test('준비 판정은 watcher 하트비트를 묻는다', () => {
  assert.ok(READY.includes('/api/vm-bridge/readiness'), '판정이 watcher 상태를 묻지 않는다');
  assert.ok(READY.includes('watcherAlive'), '판정 결과에 watcher 생사가 반영되지 않는다');
});

/**
 * compMarketFetchVmCandidateBridge 는 ok:false 를 예외로 바꾼다. 그 헬퍼로 판정을 물으면
 * "쓸 수 없다" 는 답이 예외가 되어 fail-open catch 에 삼켜진다 - 실측 2026-08-31:
 * 그 때문에 판정을 넣고도 VM 으로 계속 보냈다.
 */
test('판정은 ok:false 를 예외로 바꾸는 헬퍼로 묻지 않는다', () => {
  const line = READY.split(String.fromCharCode(10)).find(row => row.includes('/api/vm-bridge/readiness'));
  assert.ok(line, '판정 조회 줄을 찾지 못함');
  assert.ok(
    !line.includes('compMarketFetchVmCandidateBridge'),
    'ok:false 를 던지는 헬퍼로 물으면 "쓸 수 없다" 는 답이 삼켜진다',
  );
});

/**
 * runtime 은 'vm' 상수다. 가드에 OR 로 넣으면 조건이 영원히 참이라 판정이 무의미해진다.
 */
test('가드는 상수 runtime 과 OR 로 묶이지 않는다', () => {
  const guard = TRY_VM.split(String.fromCharCode(10)).find(row => row.includes('vmStatus.ready'));
  assert.ok(guard, '가드 줄을 찾지 못함');
  assert.ok(
    !guard.includes("vmStatus.runtime === 'vm'"),
    'runtime 은 상수라서 OR 에 넣으면 가드가 절대 막지 못한다',
  );
});

test('판정 경로가 없는 옛 백엔드는 새로 막지 않는다', () => {
  assert.ok(
    READY.includes('response.ok') && READY.includes('watcherKnown'),
    '판정을 모를 때 통과시키는 처리가 없다',
  );
});
