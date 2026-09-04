const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const MODEL_PATH = path.resolve(__dirname, '../../frontend/src/production-board-model.mjs');
const MODEL_URL = new URL(`file://${MODEL_PATH.split(String.fromCharCode(92)).join('/')}`).href;

/**
 * 내부 코드가 그대로 화면에 뜨면 조작자는 무엇을 해야 할지 알 수 없다.
 * 실측 2026-08-31: 카드에 STALE_FACTORY_RUNTIME_ACTION: factory/competitor:market:analyze-images
 * 만 떴고, 그 옆에는 아무 안내도 없었다.
 */
test('밀린 지시는 무엇을 누르라고 알려 준다', async () => {
  const { operatorMessage } = await import(MODEL_URL);
  const shown = operatorMessage('STALE_FACTORY_RUNTIME_ACTION: factory/competitor:market:analyze-images');
  assert.match(shown.copy, /다시 시도/);
  assert.doesNotMatch(shown.copy, /STALE_FACTORY_RUNTIME_ACTION/);
  assert.equal(shown.code, 'STALE_FACTORY_RUNTIME_ACTION: factory/competitor:market:analyze-images');
});

test('원래 코드는 접어 둔 자리에 그대로 남는다', async () => {
  const { operatorMessage } = await import(MODEL_URL);
  const shown = operatorMessage('STALE_FACTORY_RUNTIME_ACTION: factory/hero:generate');
  assert.ok(shown.code.includes('factory/hero:generate'));
});

/**
 * 실측 2026-09-04: 개요 "내 차례" 다섯째 줄에 조립공장 로더(src/app-loader.js)의 영문 예외
 * classic runtime endpoint did not respond: factory-control-command 가 번역 없이 그대로 떴다.
 * 다른 아홉 줄은 전부 우리말 한 문장이었다.
 */
test('조립공장 앱이 응답하지 않은 것은 우리말로 말한다', async () => {
  const { operatorMessage } = await import(MODEL_URL);
  const shown = operatorMessage('classic runtime endpoint did not respond: factory-control-command');
  assert.match(shown.copy, /조립공장 앱이 응답하지 않았습니다/);
  assert.doesNotMatch(shown.copy, /classic runtime/i);
  assert.equal(shown.code, 'classic runtime endpoint did not respond: factory-control-command');
});

test('조립공장 앱이 지시를 처리하지 못한 것도 우리말로 말한다', async () => {
  const { operatorMessage } = await import(MODEL_URL);
  const shown = operatorMessage('classic runtime factory-control-command failed');
  assert.match(shown.copy, /지시를 처리하지 못했습니다/);
  assert.doesNotMatch(shown.copy, /[a-z]/i);
  assert.equal(shown.code, 'classic runtime factory-control-command failed');
});

test('한글이 한 글자도 없는 낯선 영문은 문장을 우리말로 바꾸고 원문은 코드 자리에 둔다', async () => {
  const { operatorMessage } = await import(MODEL_URL);
  const shown = operatorMessage('Unexpected token < in JSON at position 0');
  assert.equal(shown.copy, '조립공장에서 처리하지 못했습니다.');
  assert.equal(shown.code, 'Unexpected token < in JSON at position 0');
});

test('우리말 문장은 손대지 않고 그대로 보여 준다', async () => {
  const { operatorMessage } = await import(MODEL_URL);
  const shown = operatorMessage('경쟁사 후보 수집 결과가 없어 상세수집을 진행할 수 없습니다.');
  assert.equal(shown.copy, '경쟁사 후보 수집 결과가 없어 상세수집을 진행할 수 없습니다.');
  assert.equal(shown.code, '');
});
