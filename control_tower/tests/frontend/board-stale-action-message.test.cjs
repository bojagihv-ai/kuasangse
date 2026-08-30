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
