const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const BOARD = path.join(__dirname, '..', '..', 'frontend', 'src', 'production-board.mjs');

test('Cafe24 value submission saves pending values without calling the registration route', () => {
  const source = fs.readFileSync(BOARD, 'utf8');
  const start = source.indexOf('async function saveCafe24Values(');

  assert.notEqual(start, -1, 'Cafe24 값 저장 handler가 없습니다');
  const handler = source.slice(start, start + 700);
  assert.match(handler, /\/cafe24\/values/);
  assert.doesNotMatch(handler, /\/cafe24\/register/);
});
