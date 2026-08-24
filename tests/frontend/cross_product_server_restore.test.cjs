'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function applySource() {
  const core = source('src/app-core-02.js');
  const at = core.indexOf('function applyServerLastWorkSnapshot(');
  assert.notEqual(at, -1, '서버 저장본 적용 함수를 찾지 못했습니다');
  const end = core.indexOf(String.fromCharCode(10) + 'async function hydrateServerLastWorkSnapshot(', at);
  assert.notEqual(end, -1);
  return core.slice(at, end);
}

test('부르는 쪽이 범위를 못박으면 그 범위로 저장본을 판정한다', () => {
  // 갓 켠 탭의 활성 범위는 draft: 이라 프로젝트 저장본과 영영 맞지 않는다. 실측: R3
  // 저장본이 신원·판 모두 맞는데도 "지금 열린 작업과 다르다"며 실리지 않았다.
  const region = applySource();
  assert.ok(region.includes('expectedWorkspaceScopeId'), '못박은 범위를 받지 않습니다');
  assert.ok(
    region.includes('lastWorkSnapshotMatchesWorkspaceScope(snapshot, expectedWorkspaceScopeId)'),
    '못박은 범위로 정확히 비교하지 않습니다',
  );
});

test('범위를 못박지 않으면 예전대로 현재 작업 기준이다', () => {
  // 평소 부팅 복원의 판정은 건드리지 않는다.
  const region = applySource();
  assert.ok(
    region.includes('lastWorkSnapshotMatchesCurrentWorkspace(snapshot)'),
    '기본 판정이 사라졌습니다',
  );
});

test('못박은 범위는 실제 적용 단계까지 전달된다', () => {
  // 여기까지 넘기지 않으면 안쪽에서 같은 이유로 다시 걸러진다.
  const region = applySource();
  const calls = region.split('applySessionAssetsPayload(').slice(1);
  assert.equal(calls.length, 2, `적용 호출이 2개가 아닙니다: ${calls.length}`);
  for (const call of calls) {
    assert.ok(
      call.slice(0, 500).includes('forceWorkspaceRestore: !!expectedWorkspaceScopeId'),
      '적용 호출에 못박은 범위를 넘기지 않습니다',
    );
  }
});

test('서버 복원은 부르는 쪽이 범위를 준 경우에만 못박는다', () => {
  const core = source('src/app-core-02.js');
  const at = core.indexOf('const changed = applyServerLastWorkSnapshot(snapshot, {');
  assert.notEqual(at, -1);
  const region = core.slice(at, at + 700);
  assert.ok(region.includes('options.documentScopeId'), '부르는 쪽의 범위를 보지 않습니다');
  assert.ok(region.includes('expectedWorkspaceScopeId: restoreScopeId'), '확인한 범위를 넘기지 않습니다');
});

test('못박은 복원은 이 탭이 붙들고 있던 작업을 갈아끼운다', () => {
  // 실측: 탭이 단색을 붙들고 있으면 R6 저장본이 WORK_IDENTITY_INSTANCE_CONFLICT 로
  // 막혔다. 완성된 다른 제품을 다시 열 방법이 아예 없어진다.
  const region = applySource();
  assert.ok(region.includes('const replaceWorkspace = options.replaceWorkspace === true || !!expectedWorkspaceScopeId'),
    '못박은 복원에서 작업을 갈아끼우지 않습니다');
  assert.ok(region.includes('replaceWorkspace,'), '적용 단계에 갈아끼움을 넘기지 않습니다');
});

test('탭 작업 경계 검사에도 갈아끼움을 함께 넘긴다', () => {
  // 경계 검사에 넘기지 않으면 같은 이유로 앞단에서 먼저 막힌다.
  const region = applySource();
  assert.ok(region.includes('boundaryOptions'), '경계 검사에 선택지를 만들지 않습니다');
  assert.ok(
    region.includes('validateIncomingWorkspaceBoundary(rawAssets, boundaryOptions)'),
    '경계 검사가 갈아끼움을 모릅니다',
  );
});

test('평소 복원은 탭 작업 경계를 그대로 지킨다', () => {
  // 범위를 못박지 않은 보통 복원에서 남의 작업이 밀고 들어오면 안 된다.
  const region = applySource();
  assert.ok(
    region.includes('options.replaceWorkspace === true || !!expectedWorkspaceScopeId'),
    '조건 없이 갈아끼웁니다',
  );
});
