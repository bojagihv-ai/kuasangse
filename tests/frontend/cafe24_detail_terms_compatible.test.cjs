'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

/**
 * 등록 사전점검의 "다른 상품명 단서" 호환 규칙(factoryCafe24DetailTermsCompatible).
 * 2026-09-18 실측: "[생산관제 시험] 색동 동전지갑 작업대 20260917" 이 신화DB 후보 "동전지갑"(4글자) 때문에
 * 등록마다 막혔다 — 우리 이름이 그 말로 끝나지 않으면 5글자 미만은 호환으로 안 봤기 때문. 포함이면 4글자부터 호환.
 * 원본은 브라우저용 고전 스크립트라 함수 둘만 잘라 내어 격리 실행한다.
 */
function loadFunctions() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/cafe24-payloads.js'), 'utf8');
  const pick = name => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} 를 찾지 못했다`);
    const end = source.indexOf('\n}\n', start);
    return source.slice(start, end + 3);
  };
  const context = { factoryNormalizeIdentityText: undefined };
  vm.createContext(context);
  vm.runInContext(`${pick('factoryCafe24DetailNormalizeName')}\n${pick('factoryCafe24DetailTermsCompatible')}`, context);
  return context;
}

const EXPECTED = ['[생산관제 시험] 색동 동전지갑 작업대 20260917', '[생산관제 시험] 색동 동전지갑 작업대'];

test('우리 상품명 안에 통째로 든 4글자 후보 이름(동전지갑)은 다른 상품명이 아니다', () => {
  const { factoryCafe24DetailTermsCompatible: compatible } = loadFunctions();
  assert.equal(compatible('동전지갑', EXPECTED), true);
  assert.equal(compatible('색동동전지갑', EXPECTED), true);
  assert.equal(compatible('색동 동전지갑 작업대', EXPECTED), true);
});

test('세 글자 이하이거나 우리 이름에 없는 후보 이름은 여전히 다른 상품명이다', () => {
  const { factoryCafe24DetailTermsCompatible: compatible } = loadFunctions();
  assert.equal(compatible('지갑', EXPECTED), false, '3글자는 너무 짧아 어느 지갑이든 맞아 버린다');
  assert.equal(compatible('누비동전지갑', EXPECTED), false, '우리 이름에 없는 이름');
  assert.equal(compatible('교통카드지갑', EXPECTED), false);
  assert.equal(compatible('', EXPECTED), false);
  assert.equal(compatible('동전지갑', []), false);
});

test('우리 이름이 후보 이름으로 끝나거나 후보 이름이 우리 이름을 품으면 전과 같이 호환', () => {
  const { factoryCafe24DetailTermsCompatible: compatible } = loadFunctions();
  assert.equal(compatible('동전지갑', ['누비 동전지갑']), true);
  assert.equal(compatible('색동동전지갑 대형', ['색동동전지갑']), true);
});
