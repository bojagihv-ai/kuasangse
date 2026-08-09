const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');
const persistenceSource = fs.readFileSync(path.join(root, 'src', 'app-core-02.js'), 'utf8');

function sourceSlice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('색상명 자동 생성은 사진-옵션 매칭을 저장 완료한 뒤 성공으로 끝낸다', () => {
  const refresh = sourceSlice(
    'async function optRefreshVisionColorHints',
    'function optColorHintMinConfidence',
  );
  assert.match(
    refresh,
    /if \(options\.applySlotNames\) await saveLastWorkNow\(\{ force: true \}\);/,
    '색상명과 조합 매칭을 저장 완료하기 전에 화면 완료 상태가 되면 Ctrl+F5 경주가 발생합니다.',
  );
  assert.doesNotMatch(
    refresh,
    /if \(options\.applySlotNames\) saveLastWorkNow\(\{ force: true \}\);/,
    '색상명 자동 생성 저장은 fire-and-forget이면 안 됩니다.',
  );
});

test('색상명 자동 생성은 현재 슬롯의 첫 사진 매칭을 기준으로 번호 색상명을 만든다', () => {
  const rename = sourceSlice(
    'function optApplyNumberedVisionColorSlotNames',
    'async function optRefreshVisionColorHints',
  );
  assert.match(rename, /os\.slots\.forEach\(\(slot, index\) =>/);
  assert.match(rename, /os\.images\.find\(item => item\.id === slot\.imgIds\?\.\[0\]\)/);
  assert.match(rename, /slot\.name = `\$\{index \+ 1\}\.\$\{label\}`/);
});

test('부팅 중 옵션 저장은 기존 색상명을 덮어쓰지 않고 복원 완료 뒤 flush한다', () => {
  assert.match(persistenceSource, /let optionSorterLiveSaveQueued = false;/);
  const saveStart = persistenceSource.indexOf('function saveOptionSorterLiveRecovery');
  const saveEnd = persistenceSource.indexOf('function flushOptionSorterLiveRecoverySave', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.match(
    persistenceSource.slice(saveStart, saveEnd),
    /if \(!serverLastWorkHydrated \|\| serverLastWorkHydrating\)/,
  );
  assert.match(source, /await flushOptionSorterLiveRecoverySave\(\)\.catch/);
});
