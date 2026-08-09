const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../../src/app-core-03.js'),
  'utf8',
);
const uiSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/app-core-06.js'),
  'utf8',
);

function slice(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing source start: ${start}`);
  assert.notEqual(to, -1, `missing source end: ${end}`);
  return source.slice(from, to);
}

test('명시적으로 최근 작업파일을 열 때 문서 임대를 빼앗지 않고 이 탭의 새 편집 브랜치로 연다', () => {
  const authority = slice(
    'async function ensureExplicitProjectLoadAuthority(',
    'async function loadProjectRecord(',
  );
  const loader = slice(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );

  assert.match(authority, /rotateLastWorkDraftScope\(\)/);
  assert.match(authority, /await settleLastWorkDraftScopePersistence/);
  assert.match(authority, /await ensureWorkspaceEditAuthority\(branchScope, \{ force: true \}\)/);
  assert.doesNotMatch(authority, /window\.confirm|confirmedTakeover|targetScope/);
  assert.match(loader, /await ensureExplicitProjectLoadAuthority\(\)/);
  assert.match(loader, /targetBranchScope/);
});

test('최근 작업 열기 클릭은 브라우저 응답을 먼저 돌려준 뒤 복원을 시작한다', () => {
  const start = uiSource.indexOf("document.querySelectorAll('[data-factory-recent-load-project]')");
  const end = uiSource.indexOf("document.querySelectorAll('[data-factory-recent-open-file]')", start);
  assert.ok(start >= 0 && end > start, '최근 작업 열기 바인딩을 찾지 못했습니다.');
  const binding = uiSource.slice(start, end);

  assert.match(binding, /btn\.disabled\s*=\s*true/);
  assert.match(binding, /setTimeout\(\(\)\s*=>\s*\{/);
  assert.match(binding, /void loadProjectRecord\(projectId\)/);
  assert.doesNotMatch(binding, /btn\.onclick\s*=\s*\(\)\s*=>\s*loadProjectRecord/);
});

test('최근 작업 열기는 같은 IndexedDB payload를 권위 봉투로 다시 읽지 않고 한 번만 복원한다', () => {
  const loader = slice(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );

  assert.match(loader, /hydrateWorkspacePayloadImageBackup\(project\.payload\)/);
  assert.match(loader, /compactFactoryProjectFileCanonicalInputImages\(hydratedPayload\)/);
  assert.doesNotMatch(loader, /workspacePersistenceApi\(\)\.restore\(\{[\s\S]*sources:\s*\['indexeddb'\]/);
});

test('최근 작업 복원 직후에는 전체 작업목록과 로컬 자산관을 중복 강제 조회하지 않는다', () => {
  const loader = slice(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );

  assert.doesNotMatch(loader, /refreshWorkspaceLists\(/);
  assert.doesNotMatch(loader, /refreshLoadedWorkfileArchiveAssets\(/);
});

test('저장 안 함은 명시적 작업파일 열기를 취소하지 않고 대상 조회까지 계속 진행한다', () => {
  const confirmFlow = slice(
    'async function confirmSaveBeforeLeavingWorkspace(',
    'function deriveProjectName(',
  );
  const loader = slice(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );

  assert.match(confirmFlow, /if \(choice === ['"]cancel['"]\) return ['"]cancel['"]/);
  assert.match(confirmFlow, /if \(choice === ['"]save['"]\)[\s\S]*?return ['"]continue['"]/);
  assert.match(confirmFlow, /return ['"]continue['"]\s*;\s*$/m);
  assert.match(loader, /if \(leave === ['"]cancel['"]\) return null;[\s\S]*?workspaceGet\(WORKSPACE_DB\.projects, projectId\)/);
});

test('저장 버전 복원도 원본 문서를 덮지 않고 이 탭의 새 브랜치에 원자적으로 연다', () => {
  const loader = slice(
    'async function loadSnapshotRecord(',
    'function factoryProjectFileSummary(',
  );

  assert.match(loader, /await confirmSaveBeforeLeavingWorkspace\('저장 버전 불러오기'\)/);
  assert.match(loader, /await settleWorkspaceScopeTransitionPersistence\(\)/);
  assert.match(loader, /await ensureExplicitProjectLoadAuthority\(\)/);
  assert.match(loader, /resetLiveWorkspaceForProjectFileReplacement\(\)/);
  assert.match(loader, /applyWorkspacePayload\(payload, \{[\s\S]*skipPersistence: true,[\s\S]*skipSideEffects: true,[\s\S]*replaceWorkspace: true/);
  assert.match(loader, /await factoryWaitForVisualValidationOperation\(visualValidationBatch\.token\)/);
  assert.match(loader, /markWorkspaceDocumentDirty\(\)/);
  assert.match(loader, /await flushQueuedPersistentState\(\{[\s\S]*skipVisibleSync: true/);
  assert.match(loader, /factoryRuntimeRequireStore\(\)\.switchWorkspace\(factoryOperationBackup\.workspaceId/);
  assert.doesNotMatch(loader, /workspacePut\(WORKSPACE_DB\.projects|persistFactoryProjectBundleLocally/);
});

test('최근 작업과 저장 버전은 교체 경계 안에서 새 브랜치 복구 checkpoint를 저장한다', () => {
  const recentLoader = slice(
    'async function loadProjectRecord(',
    'async function loadSnapshotRecord(',
  );
  const snapshotLoader = slice(
    'async function loadSnapshotRecord(',
    'function factoryProjectFileSummary(',
  );
  const checkpointPattern = /await flushQueuedPersistentState\(\{[\s\S]*?allowBlankResetCheckpoint:\s*true,[\s\S]*?expectedWorkspaceScope:\s*targetBranchScope,[\s\S]*?expectedWorkspaceResetToken:\s*workspaceBlankResetToken/;

  assert.match(recentLoader, checkpointPattern);
  assert.match(snapshotLoader, checkpointPattern);
});
