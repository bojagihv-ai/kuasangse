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

function forceDetailArgument() {
  const run = sourceSlice(
    source('src/app-core-03.js'),
    'async function factoryRuntimeControlRunProduct(',
    'async function factoryRuntimeControlCommand(',
  );
  const marker = 'forceDetail:';
  const start = run.indexOf(marker);
  assert.notEqual(start, -1, 'forceDetail 인자를 찾지 못했습니다');
  return run.slice(start + marker.length, start + marker.length + 160);
}

test('수동으로 A컷을 골라도 상세페이지 자산이 없으면 생성한다', () => {
  // 실행 모드로 막으면 A컷을 모두 고른 뒤에도 detail-asset 이 빈 채로
  // Cafe24 등록이 막힌 상태에서 '완료' 로 보고된다.
  const argument = forceDetailArgument();
  assert.ok(
    argument.includes('factoryRuntimeControlNeedsDetailRebuild()'),
    `상세페이지 필요 여부로 판단해야 합니다: ${argument}`,
  );
  assert.ok(
    !argument.includes('factoryRuntimeControlExecutionMode'),
    `실행 모드로 상세페이지 생성을 막으면 수동 진행에서 상세페이지가 비어 완료됩니다: ${argument}`,
  );
});

test('상세페이지 생성 필요 판단은 사용 가능한 detail 자산 유무로 한다', () => {
  const needs = sourceSlice(
    source('src/app-core-03.js'),
    'function factoryRuntimeControlNeedsDetailRebuild(',
    'async function factoryRuntimeControlRunProduct(',
  );
  assert.ok(needs.includes('factoryUsableAssetsForStage'));
  assert.ok(needs.includes("'detail'"));
});
