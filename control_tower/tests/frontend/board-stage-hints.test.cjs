'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const MODEL_PATH = path.resolve(ROOT, 'control_tower/frontend/src/production-board-model.mjs');
const MODEL_URL = new URL(`file://${MODEL_PATH.split(String.fromCharCode(92)).join('/')}`).href;
const BOARD = fs.readFileSync(path.resolve(ROOT, 'control_tower/frontend/src/production-board.mjs'), 'utf8');

/**
 * 실측 2026-08-31: 조작자가 "최종이라는게 뭐며 섹션 1개 2개 13개 14개가 뭘 말하는건지
 * 너무 불친절하다" 고 물었다. 그때 화면에는 섹션 1개(8월 22일)짜리가 선택된 채였고
 * 바로 옆에 섹션 14개(8월 28일)가 있었다. 그대로 등록하면 거의 빈 상세페이지가 올라간다.
 */
test('최종 단계는 그게 무엇인지 한 줄로 말한다', async () => {
  const { BOARD_STAGES } = await import(MODEL_URL);
  const final = BOARD_STAGES.find(stage => stage.key === 'final_detail');
  assert.ok(final.hint, '최종 단계에 설명이 없다');
  assert.match(final.hint, /Cafe24/);
  assert.match(final.hint, /섹션/);
});

test('모든 단계에 설명이 붙어 있다', async () => {
  const { BOARD_STAGES } = await import(MODEL_URL);
  for (const stage of BOARD_STAGES) {
    assert.ok(stage.hint && stage.hint.length > 4, `${stage.key} 에 설명이 없다`);
  }
});

test('고르는 자리에서 그 설명을 보여 준다', () => {
  assert.ok(BOARD.includes('stageHint'), '패널이 단계 설명을 쓰지 않는다');
});

test('고른 컷이 바로 적용되지 않는다는 것을 알려 준다', () => {
  assert.ok(
    BOARD.includes('고르면 예약됩니다'),
    '예약이라는 말만 뜨고 무엇을 더 눌러야 하는지 알려 주지 않는다',
  );
  assert.ok(BOARD.includes('다시 시도'), '다음에 누를 버튼을 알려 주지 않는다');
});

test('섹션이 적은 변형은 얼마나 적은지 알려 준다', () => {
  assert.ok(BOARD.includes('candidateSectionCount'), '섹션 수를 읽지 않는다');
  assert.ok(BOARD.includes('bestSectionCount'), '가장 많은 변형과 견주지 않는다');
  assert.ok(BOARD.includes('개 적습니다'), '얼마나 적은지 말해 주지 않는다');
});
