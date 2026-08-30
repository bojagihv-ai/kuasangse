const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const BOARD = path.resolve(__dirname, '../../frontend/src/production-board.mjs');

/**
 * busy 는 보드의 모든 버튼을 한꺼번에 잠근다. 깃발을 세운 뒤 try 밖에서 무언가를
 * 하다가 예외가 나면 finally 가 없어 깃발이 영원히 걸리고, 「다시 시도」·「작업 재개」·
 * 「Cafe24 등록」이 통째로 죽는다. 화면은 그 사실을 말해 주지 않는다.
 * 실측 2026-08-31: 카드가 "다음: 다시 시도 누르기" 라고 안내하는 그 버튼이 잠겨 있었다.
 */
function readLines() {
  const raw = fs.readFileSync(BOARD, 'utf8');
  return raw.split(String.fromCharCode(10));
}

test('busy 를 세운 바로 다음 줄은 언제나 try 여야 한다', () => {
  const lines = readLines();
  const offenders = [];
  lines.forEach((line, index) => {
    if (line.trim() !== 'busy = true;') return;
    const next = (lines[index + 1] || '').trim();
    if (next !== 'try {') offenders.push(`${index + 1}행 다음이 ${JSON.stringify(next)}`);
  });
  assert.deepEqual(offenders, [], `busy 를 세운 뒤 try 밖에서 하는 일이 있으면 깃발이 걸린 채 남는다: ${offenders.join(' / ')}`);
});

test('busy 를 내리는 일은 finally 안에서만 한다', () => {
  const lines = readLines();
  const raises = lines.filter(line => line.trim() === 'busy = true;').length;
  const clears = [];
  lines.forEach((line, index) => {
    if (line.trim() !== 'busy = false;') return;
    const previous = lines.slice(Math.max(0, index - 3), index).map(item => item.trim());
    clears.push(previous.includes('} finally {'));
  });
  assert.ok(raises > 0, '깃발을 세우는 자리가 하나도 없다면 이 시험이 대상을 잘못 보고 있다');
  assert.equal(clears.length, raises, '세우는 자리와 내리는 자리의 수가 같아야 한다');
  assert.deepEqual(
    clears.filter(inFinally => !inFinally),
    [],
    'finally 밖에서 내리면 예외가 난 경로에서 깃발이 그대로 남는다',
  );
});
