'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function goalLoopRegion() {
  const run = sourceSlice(
    source('src/app-core-03.js'),
    'async function factoryRuntimeControlRunProduct(',
    'async function factoryRuntimeControlCommand(',
  );
  const start = run.indexOf('factoryRunGoalLoop(');
  assert.notEqual(start, -1, 'goal 루프 호출을 찾지 못했습니다');
  return run.slice(Math.max(0, start - 400), start + 900);
}

test('실행이 실패해도 그때까지 만든 것을 체크포인트에 남긴다', () => {
  // 남기지 않으면 다시 살릴 때 아무것도 없는 이른 시점으로 되돌아간다.
  const region = goalLoopRegion();
  assert.ok(region.includes('catch'), 'goal 루프 실패를 잡지 않습니다');
  const afterCatch = region.slice(region.indexOf('catch'));
  assert.ok(
    afterCatch.includes('factoryRuntimeControlSaveProductCheckpoint'),
    '실패 경로에서 체크포인트를 저장하지 않습니다',
  );
  assert.ok(afterCatch.includes('throw'), '원인을 그대로 올리지 않습니다');
});

test('체크포인트 저장이 실패해도 원래 원인을 가리지 않는다', () => {
  const region = goalLoopRegion();
  const afterCatch = region.slice(region.indexOf('catch'));
  const savePos = afterCatch.indexOf('factoryRuntimeControlSaveProductCheckpoint');
  const throwPos = afterCatch.indexOf('throw error');
  assert.notEqual(throwPos, -1, '원래 오류를 다시 던지지 않습니다');
  assert.ok(savePos < throwPos, '체크포인트 저장이 재던지기 뒤에 있습니다');
  const between = afterCatch.slice(savePos, throwPos);
  assert.ok(
    between.includes('catch'),
    '체크포인트 저장 실패가 원래 원인을 덮어쓸 수 있습니다',
  );
});
