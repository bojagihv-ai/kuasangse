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

function decisionGateSource() {
  const run = sourceSlice(
    source('src/app-core-03.js'),
    'async function factoryRuntimeControlRunProduct(',
    'async function factoryRuntimeControlCommand(',
  );
  const marker = 'const expectedStageKey';
  const start = run.indexOf(marker);
  assert.notEqual(start, -1, 'expectedStageKey 게이트를 찾지 못했습니다');
  return run.slice(start, start + 700);
}

test('다시 만들라는 표식이 있을 때만 결정 없이 통과한다', () => {
  // 복원 직후처럼 후보가 비어 있는 작업까지 막으면 재개도 후보 생성도 못 해 갇힌다.
  const gate = decisionGateSource();
  assert.ok(gate.includes('regenerateStage'), `표식을 보지 않습니다: ${gate.slice(0, 200)}`);
  assert.ok(gate.includes('factory_decision_required'));
});

test('후보가 비어 보인다는 이유만으로 통과시키지 않는다', () => {
  // 방금 고른 컷이 반영되는 찰나에 통과시키면 그 단계를 다시 만들며 선택을 지운다.
  const gate = decisionGateSource();
  assert.ok(
    !gate.includes('expectedHasCandidates'),
    `후보 유무만으로 통과시킵니다: ${gate.slice(0, 240)}`,
  );
});

test('관제탑도 같은 조건으로 재개를 판단한다', () => {
  const sync = source('control_tower/backend/factory_sync.py');
  assert.ok(
    sync.includes('_stage_has_candidates_locked'),
    '관제탑에 후보 유무 판정이 없습니다',
  );
  const gateStart = sync.indexOf('raise FactorySyncError("factory_decision_required")');
  assert.notEqual(gateStart, -1);
  const gate = sync.slice(Math.max(0, gateStart - 400), gateStart);
  assert.ok(
    gate.includes('_stage_has_candidates_locked'),
    '재개 게이트가 후보 유무를 보지 않습니다',
  );
});

test('관제탑이 다시 만들라는 표식을 실어 보낸다', () => {
  const sync = source('control_tower/backend/factory_sync.py');
  const start = sync.indexOf('"expectedStageKey": job.stage_key,');
  assert.notEqual(start, -1);
  const dispatch = sync.slice(start, start + 700);
  assert.ok(dispatch.includes('"regenerateStage"'), '표식을 보내지 않습니다');
  assert.ok(
    dispatch.includes('_stage_has_candidates_locked'),
    '표식을 후보 유무로 정하지 않습니다',
  );
});
