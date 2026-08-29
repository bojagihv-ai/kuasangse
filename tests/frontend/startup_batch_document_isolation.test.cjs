'use strict';

// 회귀: 앱을 새로 열면 남의(배치 워커) 작업이 열려 제품명이 옛 이름으로 바뀌던 문제.
//
// 사용자 제보(2026-08-29):
//   "이거 자꾸문제가 반복되는데 왜자꾸 수저집 파우치로 자동으로 바뀌는거야?
//    슬라브나비수수저집으로 했는데 자꾸 예전 수저집 파우치로 돌아가네"
//
// 실측(브라우저 IndexedDB 를 앱을 띄우지 않고 같은 오리진에서 직접 조회):
//   pdp_workspace_v1/projects 총 36건 중 10건이 `batch:factory-job-...` 문서였고,
//   updatedAt 내림차순 **상위 7건이 전부 배치 문서**였다. 사람이 만든 첫 작업은 8번째였다.
//   그리고 사용자 화면 헤더에 `ID batch:factory-job-d9881fb8d93b4d01...` 이 찍혀 있었다.
//   즉 사용자 탭은 배치 워커 문서('수저집 파우치')를 열고 있었다.
//
// 원인 두 겹:
//   1) 작업 목록이 배치 문서를 걸러내지 않아 최근 순 맨 앞을 배치 문서가 차지했다.
//   2) 부팅 복원에 `|| projects[0]` 폴백이 있어, 저장된 포인터가 없으면 그 맨 앞 문서를
//      묻지도 않고 열었다.
//
// 계약: 사람의 작업 목록에 배치 문서를 섞지 않는다. 무엇을 이어서 열지 모르면 아무것도 열지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('부팅 복원은 목록 맨 앞 문서를 묻지 않고 열지 않는다', () => {
  const restore = sourceSlice(
    CORE_03,
    'async function maybeRestoreLatestSavedProjectOnStartup(',
    '\n  if (savedProjectBootstrap) {',
  );
  assert.match(restore, /savedProjectId && projects\.find/);
  assert.match(restore, /savedProjectName && projects\.find/);
  // 주석에는 옛 코드를 인용해 두었으므로, 실제 대입문만 겨냥한다.
  const assignment = sourceSlice(restore, 'const target =', ';');
  assert.doesNotMatch(
    assignment,
    /projects\[0\]/,
    '무엇을 열지 모르는데 맨 앞 문서를 여는 폴백이 남아 있습니다. 남의 작업이 열립니다.',
  );
});

test('사람의 작업 목록에서 배치 워커 문서를 걸러낸다', () => {
  // 이 필터가 없으면 배치 문서가 최근 순 맨 앞을 차지해 화면 목록까지 오염된다.
  assert.match(CORE_03, /\.filter\(project => classicRuntimeBatchWorkerMode \|\| !\/\^batch:\/i\.test\(String\(project\?\.id \|\| ''\)\)\)/);
  // 워커 탭 자신은 제 문서를 찾아야 하므로 그때는 거르지 않는다.
  assert.match(CORE_03, /classicRuntimeBatchWorkerMode \|\| !\/\^batch:/);
});

test('배치 워커 문서는 여전히 batch: 접두사로 구분된다', () => {
  // 필터가 기대는 규칙이 실제 생성 규칙과 어긋나면 조용히 무력화된다.
  assert.match(CORE_03, /draft\.workspace\.id = `batch:\$\{jobId\}`/);
});

test('제품명은 Cafe24 등록 잠금일 때만 되돌리고, 되돌릴 때는 알린다', () => {
  // 예전에는 factoryCurrentProductIdentityMeta 가 준 '현재 값' 을 권위로 삼아
  // 사람이 친 이름을 말없이 덮었다. 그것은 잠금이 아니라 단순 조회다.
  const sync = sourceSlice(
    CORE_05,
    'const shouldRestoreProtectedName',
    'if (typeof factorySetCurrentProductIdentity',
  );
  assert.match(sync, /registrationLockedName/);
  assert.doesNotMatch(
    sync,
    /shouldRestoreProtectedName = !activeNameEl && protectedName/,
    '단순 현재값을 권위로 삼아 입력을 덮는 판정이 남아 있습니다.',
  );
  assert.match(CORE_05, /const registrationLockedName = factoryFinalRegistrationAuthoritativeProductName\(/);
  // 조용히 되돌리면 사람은 자기가 친 이름이 왜 사라졌는지 알 수 없다.
  assert.match(sync, /setUiNotice\(/);
  assert.match(sync, /제품명을 되돌렸습니다/);
});
