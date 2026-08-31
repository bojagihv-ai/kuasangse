'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const MODEL_PATH = path.resolve(__dirname, '../../frontend/src/production-board-model.mjs');
const MODEL_URL = new URL(`file://${MODEL_PATH.split(String.fromCharCode(92)).join('/')}`).href;

function job(overrides) {
  return {
    jobId: 'factory-job-1',
    productName: '전통 수저집',
    status: 'waiting_manual',
    stageKey: '',
    message: 'GPT 자동판단 보류 · 수동 선택 필요',
    progress: { percent: 100, stageKey: 'cuts', stages: [] },
    ...overrides,
  };
}

/**
 * 등록 차단은 진행 스냅샷에 있는데 보드까지 오지 않아, 작업이 "내 선택 대기" 인 동안에는
 * 차단 사유가 보이는데도 그것을 푸는 버튼이 없었다 - 실측 2026-08-31:
 * 섹션에 남의 상품명이 박힌 것을 읽고도 「Cafe24 대상 떼기」 를 누를 수 없었다.
 */
test('등록이 막혀 있으면 선택 대기 중에도 보드가 그것을 안다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);
  const { rows } = projectProductionBoard([job({
    progress: {
      percent: 100,
      stageKey: 'cuts',
      stages: [],
      registration: {
        status: 'blocked',
        blockers: ['category_id', '상세페이지 HTML에 현재 상품과 다른 상품명 단서가 남아 있어 전송하지 않습니다: 칠색단수저집'],
      },
    },
  })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].registrationBlocked, true);
  assert.equal(rows[0].registrationBlockers.length, 2);
  assert.match(rows[0].registrationBlockers[1], /칠색단수저집/);
});

test('등록이 막히지 않았으면 거짓이다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);
  const { rows } = projectProductionBoard([job({})]);
  assert.equal(rows[0].registrationBlocked, false);
  assert.deepEqual(rows[0].registrationBlockers, []);
});

test('진행 스냅샷에 registration 이 없어도 터지지 않는다', async () => {
  const { projectProductionBoard } = await import(MODEL_URL);
  const { rows } = projectProductionBoard([job({ progress: null })]);
  assert.equal(rows[0].registrationBlocked, false);
});
