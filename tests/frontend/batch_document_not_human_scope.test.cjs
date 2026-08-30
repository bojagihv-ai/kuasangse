'use strict';

// 계약: 생산관제(다량생산) 워커가 만든 문서는 **사람 세션의 작업문서가 아니다.**
//
// 2026-08-30 실측으로 잡은 사고:
//   조립공장에서 일하다 새로고침하면 8/29 배치 워커가 남긴 값이 통째로 되살아났다 —
//   제품명 '수저집 파우치', 판매가 12500.00, 공급가 1.00, 재고 9930,
//   무게 1.00g, 소재 '면 100%', 사용용도 '생활'.
//   디스크에서 원본을 찾았다:
//     backend/.local/pdp-last-work-scoped/ff2f7f1d....json
//     workspaceId = project:batch:factory-job-d9881fb8d93b4d01b7f1ac625a61c1ac
//   사람이 만든 작업파일이 아니라 배치 워커 문서였다.
//
//   경로: getCurrentDocumentWorkspaceScope 가 복원된 factory 의 workspace.id 를 읽는데
//   draft: 만 걸러내고 batch: 는 안 걸러냈다. 그래서 배치 문서가 한 번 실려 오면
//   그 뒤로 **저장도 복원도 전부** 그 배치 문서 범위로 나갔다.
//
//   같은 규칙이 시작 복원에는 이미 있었다(app-core-03.js 의 batch: 필터).
//   저장/복원 범위에만 빠져 있었다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src/app-core-02.js'), 'utf8');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 자체가 검사 대상이므로 실물을 싣는다.
function loadDocumentScope({ workspaceId, batchWorkerMode = false }) {
  const source = sourceSlice(
    CORE_02,
    'function getCurrentDocumentWorkspaceScope(',
    '\nfunction currentWorkspaceBranch(',
  );
  const context = vm.createContext({
    classicRuntimeBatchWorkerMode: batchWorkerMode,
    factoryRuntimeReadFactory: () => ({ workspace: { id: workspaceId } }),
    workspacePersistenceApi: () => ({
      normalizeProjectScope: id => `project:${id}`,
      normalizeWorkspaceScope: id => String(id || ''),
    }),
    console,
  });
  vm.runInContext(`${source}\nthis.scope = getCurrentDocumentWorkspaceScope;`, context);
  return context.scope;
}

test('사람 작업파일은 그대로 문서 범위가 된다', () => {
  const scope = loadDocumentScope({ workspaceId: 'project_mtdmof5z_0my1re' });
  assert.equal(scope(), 'project:project_mtdmof5z_0my1re');
});

test('배치 워커 문서는 사람 세션의 문서가 되지 않는다', () => {
  // 이것이 이번 사고의 핵심이다. 빈 값이어야 draft 범위로 떨어져 남의 문서를 안 건드린다.
  const scope = loadDocumentScope({ workspaceId: 'batch:factory-job-d9881fb8d93b4d01b7f1ac625a61c1ac' });
  assert.equal(
    scope(),
    '',
    '배치 문서를 문서 범위로 삼으면 저장·복원이 전부 그쪽으로 나갑니다.',
  );
});

test('워커 자신이 돌 때는 배치 문서가 제 작업이다', () => {
  // 다량생산이 망가지면 안 된다. 워커 모드에서는 그대로 쓴다.
  const scope = loadDocumentScope({
    workspaceId: 'batch:factory-job-d9881fb8d93b4d01b7f1ac625a61c1ac',
    batchWorkerMode: true,
  });
  assert.equal(scope(), 'project:batch:factory-job-d9881fb8d93b4d01b7f1ac625a61c1ac');
});

test('초안(draft:)은 예전처럼 문서 범위가 아니다', () => {
  const scope = loadDocumentScope({ workspaceId: 'draft:lastwork_mrummk1d_zgln83' });
  assert.equal(scope(), '');
});

test('시작 복원에도 같은 규칙이 살아 있다', () => {
  // 두 곳이 같은 규칙을 써야 한다. 한쪽만 고치면 다른 쪽으로 다시 샌다.
  assert.match(
    CORE_03,
    /classicRuntimeBatchWorkerMode \|\| !\/\^batch:\/i\.test\(String\(project\?\.id \|\| ''\)\)/,
    '시작 복원의 batch: 필터가 사라졌습니다.',
  );
});
