'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sessionDirectorySource() {
  const core = source('src/app-core-06.js');
  const at = core.indexOf('async function factoryGetSessionDirectory(');
  assert.notEqual(at, -1, '세션 폴더 함수를 찾지 못했습니다');
  const end = core.indexOf(String.fromCharCode(10) + 'function ', at);
  assert.notEqual(end, -1);
  return core.slice(at, end);
}

test('생산관제 워커는 폴더 선택창을 띄우지 않는다', () => {
  // 실측: 워커가 showDirectoryPicker 를 부르자 "Must be handling a user gesture" 로 거부됐고,
  // 그 실패가 완성된 제품 작업을 통째로 죽였다. 답할 사람이 없는 창은 띄우면 안 된다.
  const region = sessionDirectorySource();
  const at = region.indexOf('factoryChooseArchiveFolder(');
  assert.notEqual(at, -1);
  const before = region.slice(0, at);
  assert.ok(before.includes('classicRuntimeIsBatchWorker'), '워커인지 보지 않습니다');
  assert.ok(before.includes('if (batchWorker) return null;'), '워커에서도 선택창을 띄웁니다');
});

test('사람이 쓰는 화면에서는 예전대로 폴더를 물어본다', () => {
  const region = sessionDirectorySource();
  assert.ok(region.includes('factoryChooseArchiveFolder({'), '폴더를 물어보는 길이 사라졌습니다');
  assert.ok(region.includes("throw new Error('저장 폴더 권한이 없습니다.')"), '거절 시 알리지 않습니다');
});

test('폴더를 건너뛴 자산 보관은 실패가 아니라 건너뜀이다', () => {
  const core = source('src/app-core-06.js');
  const at = core.indexOf('const sessionDir = await factoryGetSessionDirectory({\n    factory: archiveContext,');
  assert.notEqual(at, -1, '자산 보관 호출을 찾지 못했습니다');
  const region = core.slice(at, at + 400);
  assert.ok(region.includes('if (!sessionDir) return false;'), '폴더가 없을 때를 다루지 않습니다');
});

test('폴더를 건너뛴 세션 보관은 작업을 죽이지 않는다', () => {
  // 그림은 이미 로컬 보관에 들어가 있다. 디스크 사본이 없다고 완성된 제품을 버릴 수 없다.
  const core = source('src/app-core-06.js');
  const at = core.indexOf('const sessionDir = await factoryGetSessionDirectory({ factory, operationToken });');
  assert.notEqual(at, -1);
  const region = core.slice(at, at + 700);
  assert.ok(region.includes('if (!sessionDir) {'), '폴더가 없을 때를 다루지 않습니다');
  assert.ok(region.includes('return true;'), '건너뛰고도 실패로 돌려줍니다');
  assert.ok(region.includes('디스크 보관 건너뜀'), '사람에게 건너뛴 사실을 알리지 않습니다');
});

test('워커 복원은 남아 있던 폴더 실패 표시를 정리한다', () => {
  // 디스크 보관은 이제 정상 건너뜀이다. 문서에 남은 옛 실패를 그대로 두면 다 만들어 둔
  // 제품이 다시 열 때마다 검수 대기로 되돌아온다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlClearSkippedArchiveFailure(');
  assert.notEqual(at, -1, '정리 함수가 없습니다');
  const region = core.slice(at, at + 1200);
  assert.ok(region.includes('classicRuntimeIsBatchWorker'), '워커에서만 정리하지 않습니다');
  assert.ok(region.includes("String(stage?.status || '') !== 'error'"), '실패 표시만 골라 보지 않습니다');
  assert.ok(region.includes('FACTORY_ARCHIVE_FOLDER_FAILURE'), '폴더 실패만 골라 보지 않습니다');
});

test('다른 이유의 export 실패는 건드리지 않는다', () => {
  // 진짜 실패까지 지우면 망가진 제품이 완료로 보인다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlClearSkippedArchiveFailure(');
  const region = core.slice(at, at + 1200);
  assert.ok(
    region.includes("includes(FACTORY_ARCHIVE_FOLDER_FAILURE)") && region.includes('return false;'),
    '폴더 실패가 아닌 경우 그대로 두지 않습니다',
  );
});

test('복원은 색상옵션을 손보기 전에 옛 실패부터 정리한다', () => {
  const core = source('src/app-core-03.js');
  const at = core.indexOf('async function factoryRuntimeControlRestoreProductCheckpoint(');
  assert.notEqual(at, -1);
  const end = core.indexOf(String.fromCharCode(10) + 'async function ', at + 10);
  const region = core.slice(at, end);
  const clearAt = region.indexOf('factoryRuntimeControlClearSkippedArchiveFailure()');
  assert.notEqual(clearAt, -1, '복원이 옛 실패를 정리하지 않습니다');
  assert.ok(clearAt < region.indexOf('restoredProgress'), '진행 상태를 읽은 뒤에야 정리합니다');
});

test('정리한 뒤에는 판을 다시 읽어 보고한다', () => {
  // 정리 전에 뜬 판을 그대로 쓰면 관제탑에는 방금 지운 실패가 그대로 보고된다.
  const core = source('src/app-core-03.js');
  const at = core.indexOf('&& await factoryRuntimeControlClearSkippedArchiveFailure()');
  assert.notEqual(at, -1, '정리 호출부를 찾지 못했습니다');
  const region = core.slice(at, at + 320);
  assert.ok(
    region.includes('projection = await factoryRuntimeControlProjection()'),
    '정리한 뒤 판을 다시 읽지 않습니다',
  );
});
