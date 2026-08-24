'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function successRegion() {
  const core = source('src/app-core-06.js');
  // 같은 선언이 두 곳에 있어, 성공 판정이 있는 마지막 것을 본다.
  const at = core.lastIndexOf('const stoppedByUser = !!factory.goalRun.stopRequested;');
  assert.notEqual(at, -1, 'goal 루프 성공 판정을 찾지 못했습니다');
  return core.slice(at, at + 1200);
}

test('검수 대기는 실패가 아니라 멈춤으로 센다', () => {
  // 실패로 세면 단계별 수동 진행으로 만든 제품은 목표를 다 채우고도 영원히 완료가 되지 않고,
  // 관제탑은 그 작업을 blocked 로 붙든다.
  const region = successRegion();
  assert.ok(region.includes('reviewPauseOnly'), `검수 대기를 구분하지 않습니다: ${region.slice(0, 200)}`);
  assert.ok(
    region.includes("=== '검수형 루프 대기'"),
    '검수 대기 사유를 정확히 식별하지 않습니다',
  );
});

test('목표를 다 채웠을 때만 성공으로 본다', () => {
  const region = successRegion();
  assert.ok(region.includes('targetsMet'), '목표 달성 여부를 따로 보지 않습니다');
  assert.ok(
    region.includes('factoryGoalAssetCount'),
    '단계별 산출물 수를 세지 않습니다',
  );
  // 사용자가 직접 멈춘 것은 여전히 성공이 아니다.
  assert.ok(region.includes('!stoppedByUser'), '사용자 중지를 성공으로 볼 수 있습니다');
});

test('검수 대기로 완료되면 남은 안내 문구를 지운다', () => {
  const region = successRegion();
  assert.ok(
    region.includes("factory.goalRun.failureReason = ''"),
    '완료인데 검수 대기 사유가 남습니다',
  );
});
