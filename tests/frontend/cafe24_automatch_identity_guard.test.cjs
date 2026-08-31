'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src/cafe24-sync.js'), 'utf8');

function block(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `블록을 찾지 못함: ${startMarker}`);
  return SOURCE.slice(start, end);
}

const context = vm.createContext({});
const localParts = value => [...context.parts(value)];

vm.runInContext(
  block('const FACTORY_GENERIC_CATEGORY_NOUNS', 'function factoryCandidateSearchTerms(')
  + '; globalThis.shares = factoryCandidateSharesProductIdentity;'
  + ' globalThis.parts = factoryDistinguishingNameParts;',
  context,
);

/**
 * 실측 2026-08-31: 조작자가 직접 넣은 신규 제품 "전통 수저집" 이, 이름에 "수저집" 이 들어간다는
 * 이유만으로 기존 Cafe24 상품 394번 "칠색단 수저집(대) 빨강에노란띠" 에 자동으로 묶였다.
 * 점수 158 중 62점이 일반명사 "수저집" 의 부분문자열 일치였고 "전통" 은 0점이었다.
 * 그 뒤 섹션 15개가 남의 상품명으로 만들어져 등록이 통째로 막혔다.
 */
test('실제 사고: 전통 수저집은 칠색단 수저집에 자동으로 묶이지 않는다', () => {
  assert.equal(context.shares('전통 수저집', '칠색단 수저집(대) 빨강에노란띠'), false);
});

test('실제 사고: 신화사DB의 나비수저집소도 마찬가지다', () => {
  assert.equal(context.shares('전통 수저집', '나비수저집소'), false);
});

test('고유 이름이 겹치면 자동 확정을 막지 않는다', () => {
  assert.equal(context.shares('칠색단 수저집', '칠색단 수저집(대) 빨강에노란띠'), true);
  assert.equal(context.shares('전통 수저집', '전통 수저집 대형'), true);
});

test('띄어쓰기와 괄호가 달라도 같은 상품은 알아본다', () => {
  assert.equal(context.shares('칠색단수저집', '칠색단 수저집(대)'), true);
});

test('제품명이 카테고리 명사뿐이면 새로 막지 않는다', () => {
  assert.deepEqual(localParts('수저집'), []);
  assert.equal(context.shares('수저집', '칠색단 수저집(대) 빨강에노란띠'), true);
});

test('빈 이름에서도 터지지 않는다', () => {
  assert.equal(context.shares('', '아무거나'), true);
  assert.equal(context.shares('전통 수저집', ''), true);
});

test('고유 부분만 남기고 카테고리 명사는 뺀다', () => {
  assert.deepEqual(localParts('전통 수저집'), ['전통']);
  assert.deepEqual(localParts('크리스탈 보자기'), ['크리스탈']);
});

/**
 * 자동 확정은 근거가 없으면 보류하고 사람에게 넘겨야 한다. 조용히 넘어가면
 * 조작자는 남의 상품명이 박힌 섹션을 만들고 나서야 알게 된다.
 */
test('보류하면 화면에 이유와 다음 행동을 적는다', () => {
  const applyBlock = block('if (current.product.candidateAutoApply) {', '  } else {');
  assert.ok(applyBlock.includes('factoryCandidateSharesProductIdentity'), '가드를 쓰지 않는다');
  assert.ok(applyBlock.includes('자동 확정 보류'), '보류 사실을 상태에 적지 않는다');
  assert.ok(applyBlock.includes('직접 골라 주세요'), '다음에 할 일을 알려 주지 않는다');
});
