'use strict';

// 계약: **끊긴 생성은 '완료' 라고 적지 않는다.**
//
// 실측 2026-09-06: 사이즈컷 3장 생성 중 새로고침 → 1장만 남았는데, 색상 검수가 끝나며
// 단계를 "1개 후보 표시 완료 · 완료(done)" 로 굳혔다. 위에는 "완료", 실제로는 2장이 빠졌다.
// 이미지컷도 같은 무늬(예상 3 · 완료 1 · "1개 후보 표시 완료").
//
// 기대 개수(expectedItemCount)보다 적게 남았으면 '검토(review)' 로 두고 몇 개가 빠졌는지 적는다.
// 그리고 이 화면에서 아직 루프가 돌고 있으면(첫 장 검수가 먼저 끝나는 경우) 상태를 건드리지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function loadDisplayHelper() {
  const source = fs.readFileSync(CORE_03, 'utf8');
  const helper = sourceSlice(source, 'function factoryStageDisplayAfterRestore(', '\n// 전체 생성 루프가 이 화면에서');
  const context = vm.createContext({});
  vm.runInContext(`${helper}\nthis.display = factoryStageDisplayAfterRestore;`, context);
  // vm 안에서 만든 객체는 프로토타입이 달라 strict deepEqual 이 거짓 실패한다 - 값만 꺼낸다.
  return (stage, visible) => {
    const result = context.display(stage, visible);
    return { status: result.status, message: result.message };
  };
}

test('3개 기대 · 1개만 남음 → 검토 상태 + 몇 개가 빠졌는지 적는다', () => {
  const display = loadDisplayHelper();
  const result = display({ expectedItemCount: 3, completedItemCount: 1 }, 1);
  assert.equal(result.status, 'review', '"완료" 로 굳히면 빠진 2장이 숨는다');
  assert.match(result.message, /3개 중 1개만 생성됨/);
  assert.match(result.message, /나머지 2개/);
  assert.doesNotMatch(result.message, /표시 완료/);
});

test('기대한 만큼 다 있으면 예전처럼 완료', () => {
  const display = loadDisplayHelper();
  assert.deepEqual(display({ expectedItemCount: 3 }, 3), { status: 'done', message: '3개 후보 표시 완료' });
  assert.deepEqual(display({ expectedItemCount: 3 }, 5), { status: 'done', message: '5개 후보 표시 완료' });
});

test('기대 개수를 모르는 단계(예전 작업파일)는 예전처럼 완료', () => {
  const display = loadDisplayHelper();
  assert.deepEqual(display({}, 2), { status: 'done', message: '2개 후보 표시 완료' });
  assert.deepEqual(display({ expectedItemCount: '' }, 2), { status: 'done', message: '2개 후보 표시 완료' });
  assert.deepEqual(display(null, 1), { status: 'done', message: '1개 후보 표시 완료' });
});

test('색상 검수가 끝날 때 두 자리 모두 이 판정을 쓰고, 살아 있는 루프는 건드리지 않는다', () => {
  const source = fs.readFileSync(CORE_03, 'utf8');
  const refresh = sourceSlice(source, 'function factoryRefreshStageAfterVisualValidation(', '\nfunction factoryScheduleAssetVisualValidation(');
  assert.match(refresh, /if \(factoryStageRunAliveInThisPage\(normalizedStage\)\) return;/,
    '루프가 도는 동안 첫 장 검수가 끝났다고 단계 상태를 바꾸면 안 된다');
  assert.match(refresh, /factoryStageDisplayAfterRestore\(stage, usableCount\)/);
  assert.doesNotMatch(refresh, /'done', `\$\{usableCount\}개 후보 표시 완료`/, '하드코딩 "완료" 가 남아 있으면 안 된다');

  // 명령 이름은 정책표에도 나오므로, 검수 완료 함수 안(성공 경로)만 정확히 자른다.
  const complete = sourceSlice(source, 'function factoryScheduleAssetVisualValidation(', '}).catch(() => {');
  assert.match(complete, /status === 'running'\s*&&\s*!factoryStageRunAliveInThisPage\(liveAsset\.stageId\)/,
    "'running' 인데 이 화면에 실행이 없을 때(새로고침으로 끊김)만 상태를 정리한다");
  assert.match(complete, /factoryStageDisplayAfterRestore\(liveFactory\.stages\[liveAsset\.stageId\], visibleCount\)/);
  assert.doesNotMatch(complete, /\.status = 'done';/, '끊긴 실행을 무조건 완료로 굳히는 줄이 남아 있으면 안 된다');
});
