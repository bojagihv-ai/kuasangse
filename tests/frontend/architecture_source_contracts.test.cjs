const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { verifyRuntimeBundle } = require('../../tools/build_runtime_bundle.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_HTML = path.join(ROOT, 'app.html');
const APP_LOADER = path.join(ROOT, 'src', 'app-loader.js');
const RUNTIME_MANIFEST = path.join(ROOT, 'src', 'runtime-manifest.json');
const WORKSPACE_REVISION_MODULE = path.join(ROOT, 'src', 'modules', 'workspace-revision.mjs');
const REQUIRED_FOUNDATIONS = [
  'src/modules/state-ownership.mjs',
  'src/modules/menu-contracts.mjs',
  'src/modules/app-store.mjs',
  'src/modules/composition-commands.mjs',
  'src/modules/module-registry.mjs',
  'src/modules/persistence/contracts.mjs',
  'src/modules/persistence/fencing.mjs',
  'src/modules/persistence/indexeddb-driver.mjs',
  'src/modules/persistence/migrations.mjs',
  'src/modules/persistence/serialization.mjs',
  'src/modules/persistence/file-publish.mjs',
  'src/modules/persistence/session-storage-adapter.mjs',
  'src/modules/persistence/indexeddb-adapter.mjs',
  'src/modules/persistence/server-last-work-adapter.mjs',
  'src/modules/persistence/workfile-adapter.mjs',
  'src/modules/persistence/archive-adapter.mjs',
  'src/modules/workspace-mutations.mjs',
  'src/modules/workspace-persistence.mjs',
];

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractFunction(fileSource, functionName) {
  const start = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} 정의를 찾지 못했습니다.`);
  const braceStart = fileSource.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} 함수 경계를 찾지 못했습니다.`);
}

test('앱 HTML과 로더는 빌드 ID를 하드코딩하지 않고 매니페스트만 따른다', () => {
  // Given: 실제 앱 엔트리와 로더 소스를 읽는다.
  const html = source(APP_HTML);
  const loader = source(APP_LOADER);

  // When: 두 파일에 박힌 기존 빌드 ID를 추출한다.
  const htmlBuild = html.match(/app-loader\.js\?v=([^"']+)/)?.[1] || '';
  const loaderBuild = loader.match(/\bAPP_BUILD_ID\s*=\s*['"]([^'"]+)['"]/)?.[1] || '';

  // Then: 한쪽만 바뀔 수 있는 하드코딩을 없애고 매니페스트만 읽어야 한다.
  assert.equal(htmlBuild, '');
  assert.equal(loaderBuild, '');
  assert.match(html, /src\/runtime-manifest\.json/);
  assert.match(loader, /src\/runtime-manifest\.json/);
});

test('앱 로더는 전체 소스를 문자열로 합쳐 eval하지 않는다', () => {
  // Given: 실제 앱 로더 소스를 읽는다.
  const loader = source(APP_LOADER);

  // When/Then: 검증된 외부 번들을 실행하고 동적 eval을 사용하지 않아야 한다.
  assert.doesNotMatch(loader, /\beval\s*\(/);
  assert.match(loader, /manifest-bundle-no-eval/);
  assert.match(loader, /manifest\.bundle/);
});

test('런타임 매니페스트가 모든 실제 ESM foundation을 발견하고 안전한 순서로 선언한다', () => {
  // Given: canonical runtime manifest 경로를 준비한다.
  // When: 파일 존재 여부와 JSON 계약을 확인한다.
  assert.equal(fs.existsSync(RUNTIME_MANIFEST), true, 'src/runtime-manifest.json이 필요합니다.');
  const manifest = JSON.parse(source(RUNTIME_MANIFEST));

  // Then: 앱 엔트리, classic sources, native modules가 모두 명시되어야 한다.
  assert.equal(manifest.entry, 'app.html');
  assert.ok(Array.isArray(manifest.scripts) && manifest.scripts.length >= 12);
  const foundations = [
    'src/modules/workspace-revision.mjs',
    ...REQUIRED_FOUNDATIONS,
  ];
  assert.deepEqual(manifest.modules.slice(0, foundations.length), foundations);
  assert.deepEqual(manifest.modules.slice(foundations.length), [
    'src/domains/cafe24/fields.mjs',
    'src/domains/cafe24/options.mjs',
    'src/domains/cafe24/payload.mjs',
    'src/domains/cafe24/api.mjs',
    'src/domains/cafe24/sync.mjs',
    'src/domains/cafe24/ui.mjs',
    'src/domains/cafe24/index.mjs',
    'src/menus/manual-menu.mjs',
    'src/menus/modelsettings-menu.mjs',
    'src/menus/automation-menu.mjs',
    'src/menus/imagecuts-menu.mjs',
    'src/menus/optionsorter-menu.mjs',
    'src/menus/upload-menu.mjs',
    'src/menus/analysis-menu.mjs',
    'src/menus/sections-menu-cards-view.mjs',
    'src/menus/sections-menu-view.mjs',
    'src/menus/sections-menu.mjs',
    'src/menus/sections-menu-a2-events.mjs',
    'src/menus/generating-menu.mjs',
    'src/menus/preview-menu-view.mjs',
    'src/menus/preview-layer-events.mjs',
    'src/menus/preview-image-insert-events.mjs',
    'src/menus/preview-ai-repair-events.mjs',
    'src/menus/preview-menu.mjs',
    'src/menus/competitor-menu-report-view.mjs',
    'src/menus/competitor-menu-plan-view.mjs',
    'src/menus/competitor-menu-view.mjs',
    'src/menus/competitor-menu.mjs',
    'src/modules/factory-store.mjs',
    'src/menus/factory/factory-tab-contract.mjs',
    'src/menus/factory/tabs/start-tab.mjs',
    'src/menus/factory/tabs/db-tab.mjs',
    'src/menus/factory/tabs/fields-tab-render.mjs',
    'src/menus/factory/tabs/fields-tab.mjs',
    'src/menus/factory/tabs/competitor-tab-model.mjs',
    'src/menus/factory/tabs/competitor-tab-analysis.mjs',
    'src/menus/factory/tabs/competitor-tab-candidates.mjs',
    'src/menus/factory/tabs/competitor-tab-images.mjs',
    'src/menus/factory/tabs/competitor-tab-view.mjs',
    'src/menus/factory/tabs/competitor-tab-events.mjs',
    'src/menus/factory/tabs/competitor-tab.mjs',
    'src/menus/factory/tabs/assets-tab-render.mjs',
    'src/menus/factory/tabs/assets-tab-bind.mjs',
    'src/menus/factory/tabs/assets-tab.mjs',
    'src/menus/factory/tabs/sections-tab.mjs',
    'src/menus/factory/tabs/publish-tab-render.mjs',
    'src/menus/factory/tabs/publish-tab.mjs',
    'src/menus/factory/factory-menu.mjs',
    'src/shell/render-lifecycle.mjs',
    'src/shell/route-controller.mjs',
    'src/shell/legacy-diagnostic-bridge.mjs',
    'src/shell/bootstrap.mjs',
  ]);
  for (const modulePath of manifest.modules) {
    const absolutePath = path.join(ROOT, modulePath);
    assert.equal(fs.existsSync(absolutePath), true, `missing runtime module: ${modulePath}`);
    assert.equal(path.extname(modulePath), '.mjs', `${modulePath}: native ESM extension`);
    const syntax = spawnSync(process.execPath, ['--check', absolutePath], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, `${modulePath}: ${syntax.stderr || syntax.stdout}`);
  }
  assert.equal(manifest.bundle, 'dist/app-runtime.bundle.js');
  assert.equal(fs.existsSync(path.join(ROOT, manifest.bundle)), true, '검증된 runtime bundle이 필요합니다.');
  assert.equal(verifyRuntimeBundle(ROOT), true, 'runtime bundle은 현재 manifest/source와 정확히 일치해야 합니다.');
});

test('최종 등록용 이름 조회는 오래된 Cafe24 값보다 현재 작업 identity를 우선한다', () => {
  // Given: 현재 작업명과 서로 다른 오래된 Cafe24 등록명을 준비한다.
  const functionSource = extractFunction(
    source(path.join(ROOT, 'src', 'app-core-05.js')),
    'factoryFinalRegistrationAuthoritativeProductName',
  );
  const build = new Function(
    'factoryFinalRegistrationFirstText',
    'factoryAuthoritativeProductName',
    'state',
    `${functionSource}; return factoryFinalRegistrationAuthoritativeProductName;`,
  );
  const firstText = (...values) => values.map(value => String(value || '').trim()).find(Boolean) || '';
  const resolveName = build(firstText, factory => factory.product.userProductName, { productName: '현재 작업명' });

  // When: 실제 우선순위 함수를 호출한다.
  const resolved = resolveName({
    product: {
      userProductName: '현재 작업명',
      productName: '현재 작업명',
      cafe24FinalRegistration: { productName: '오래된 Cafe24 이름' },
    },
  });

  // Then: 현재 작업 identity가 유지되어야 한다.
  assert.equal(resolved, '현재 작업명');
});

test('세 세션의 저장 revision은 최신 저장만 적용하고 이전 저장을 거부한다', async () => {
  // Given: revision policy ES module이 준비되어 있어야 한다.
  assert.equal(fs.existsSync(WORKSPACE_REVISION_MODULE), true, 'workspace revision ES module이 필요합니다.');
  const moduleUrl = `${pathToFileURL(WORKSPACE_REVISION_MODULE).href}?test=${Date.now()}`;
  const { nextWorkspaceRevision, shouldApplyWorkspaceSnapshot } = await import(moduleUrl);

  // When: 같은 workspace에서 A→B→C 세 세션이 순서대로 저장한다.
  const a = nextWorkspaceRevision({ scopeId: 'project:one', writerId: 'session-a', now: 1000 });
  const b = nextWorkspaceRevision({ scopeId: 'project:one', current: a, writerId: 'session-b', now: 1001 });
  const c = nextWorkspaceRevision({ scopeId: 'project:one', current: b, writerId: 'session-c', now: 1002 });

  // Then: C 이후에는 A/B 저장본을 적용할 수 없어야 한다.
  assert.equal(shouldApplyWorkspaceSnapshot({ candidate: c, current: b, scopeId: 'project:one' }), true);
  assert.equal(shouldApplyWorkspaceSnapshot({ candidate: a, current: c, scopeId: 'project:one' }), false);
  assert.equal(shouldApplyWorkspaceSnapshot({ candidate: b, current: c, scopeId: 'project:one' }), false);
  assert.equal(shouldApplyWorkspaceSnapshot({ candidate: c, current: c, scopeId: 'project:one' }), false);
  assert.equal(shouldApplyWorkspaceSnapshot({ candidate: c, current: c, scopeId: 'project:one', allowEqual: true }), true);
  assert.equal(shouldApplyWorkspaceSnapshot({ candidate: c, current: c, scopeId: 'project:other' }), false);
});

test('revision fence가 로컬·IndexedDB·서버 복원과 저장 payload에 연결된다', () => {
  // Given: 실제 저장/복원 코드와 상태 초기화 코드를 읽는다.
  const persistence = source(path.join(ROOT, 'src', 'app-core-02.js'));
  const stateSource = source(path.join(ROOT, 'src', 'app-core-03.js'));

  // When/Then: revision이 단순 유틸로 끝나지 않고 저장 및 모든 복원 경계에 연결되어야 한다.
  assert.match(persistence, /function workspaceRevisionAllowsSnapshot\(/);
  assert.match(persistence, /workspaceRevision:\s*currentWorkspaceRevision\(/);
  assert.match(persistence, /nextCurrentWorkspaceRevision\(/);
  assert.match(persistence, /workspaceRevisionAllowsSnapshot\(snapshot/);
  assert.match(persistence, /workspaceRevisionAllowsSnapshot\(assets/);
  assert.match(stateSource, /workspaceRevision:\s*_savedSession\?\.workspaceRevision/);
});

test('검증된 작업파일만 revision 없는 내장 자산을 명시적으로 복원할 수 있다', () => {
  // Given: 일반 세션 복원과 작업파일 복원이 공유하는 자산 적용 경계를 읽는다.
  const persistence = source(path.join(ROOT, 'src', 'app-core-02.js'));
  const stateSource = source(path.join(ROOT, 'src', 'app-core-03.js'));
  // When/Then: revision 우회는 검증된 inline 작업파일 호출에만 capability로 전달되어야 한다.
  assert.match(persistence, /options\.forceRevisionRestore\s*!==\s*true\s*&&\s*!workspaceRevisionAllowsSnapshot/);
  assert.match(stateSource, /explicitProjectFileRestore\s*=\s*options\.validatedProjectFileRestore\s*===\s*true\s*&&\s*projectFileInline/);
  assert.match(stateSource, /forceRevisionRestore:\s*explicitProjectFileRestore/);
  assert.match(stateSource, /allowScopedInlineImages:\s*explicitProjectFileRestore/);
  assert.match(stateSource, /validatedProjectFileRestore:\s*true/);
});

test('작업 편집권 UI는 표시 의미가 없는 revision 변화로 전체 화면을 다시 그리지 않는다', () => {
  // Given: 편집권 구독과 작업파일 복원 상태를 연결하는 UI 코드를 읽는다.
  const uiSource = source(path.join(ROOT, 'src', 'app-core-06.js'));
  const bindAuthorityUi = extractFunction(uiSource, 'bindWorkspaceAuthorityUi');

  // When/Then: 표시 signature에는 실제 배너 필드만 포함하고 복원 중 full render는 지연한다.
  assert.match(bindAuthorityUi, /snapshot\.scopeId[\s\S]*snapshot\.mode[\s\S]*snapshot\.ownerId[\s\S]*snapshot\.reasonCode[\s\S]*snapshot\.reason/);
  assert.doesNotMatch(bindAuthorityUi, /snapshot\.(?:revision|fencingToken|leaseId)/);
  assert.match(bindAuthorityUi, /state\.projectBusy\s*&&\s*state\.workfileRestoreState/);
  assert.match(bindAuthorityUi, /renderQueued/);
});

test('메뉴 비동기 작업 identity는 저장 revision이 아니라 작업 범위와 fencing token을 따른다', () => {
  // Given: 모든 메뉴가 공유하는 실제 operation token 함수를 읽는다.
  const uiSource = source(path.join(ROOT, 'src', 'app-core-03.js'));
  const functionSource = extractFunction(uiSource, 'currentRuntimeMenuOperationToken');
  const state = { currentProjectId: 'project-a', workspaceRevision: { revision: 1 } };
  let authority = { scopeId: 'project:project-a', fencingToken: 7 };
  const resolveToken = new Function(
    'currentWorkspaceAuthority',
    'state',
    `${functionSource}; return currentRuntimeMenuOperationToken;`,
  )(() => authority, state);

  // When: 같은 작업의 저장 revision만 바꾸고, 이어서 편집권 fencing token을 바꾼다.
  const initial = resolveToken();
  state.workspaceRevision.revision = 2;
  const afterSave = resolveToken();
  authority = { ...authority, fencingToken: 8 };
  const afterTakeover = resolveToken();

  // Then: 정상 저장은 진행 중 작업을 무효화하지 않고 편집권 교체는 반드시 무효화한다.
  assert.equal(afterSave, initial);
  assert.notEqual(afterTakeover, initial);
  assert.match(functionSource, /authority\?\.fencingToken/);
  assert.doesNotMatch(functionSource, /workspaceRevision|authority\?\.fence(?:\W|$)/);
  assert.doesNotMatch(uiSource, /authority\?\.fence(?:\W|$)/);
});

test('작업파일 복원은 시각 검증과 server IndexedDB session commit을 각각 한 번만 끝낸다', () => {
  // Given: 이미지 변경 뒤 지연 렌더를 예약하는 경계를 읽는다.
  const uiSource = source(path.join(ROOT, 'src', 'app-core-03.js'));
  const scheduleVisualRender = extractFunction(uiSource, 'factoryScheduleVisualValidationRender');

  // When/Then: 복원 중인 예약은 취소하고 외부 import 흐름의 마지막 렌더에 합쳐야 한다.
  assert.match(scheduleVisualRender, /factoryVisualValidationRenderTimer[\s\S]*clearTimeout/);
  assert.match(scheduleVisualRender, /state\.projectBusy\s*&&\s*state\.workfileRestoreState[\s\S]*return/);
  assert.match(uiSource, /function factoryBeginVisualValidationRenderBatch\(/);
  assert.match(uiSource, /function factoryWaitForVisualValidationOperation\(/);
  assert.match(uiSource, /factoryPrimeCurrentAssetVisualValidation\(factoryRuntimeDetachedValue\(factoryRuntimeReadFactory\(\)\)\)/);
  assert.doesNotMatch(uiSource, /factoryPrimeCurrentAssetVisualValidation\(state\.factory\)/);
  assert.match(uiSource, /await factoryWaitForVisualValidationOperation\(visualValidationBatch\.token\)/);
  assert.match(scheduleVisualRender, /factoryVisualValidationRenderBatches\.get\(operationToken\)[\s\S]*dirty\s*=\s*true[\s\S]*return/);
  assert.match(uiSource, /!validationRecord\.operationToken[\s\S]*scheduleSessionAssetSaveIfChanged/);

  const persistence = source(path.join(ROOT, 'src', 'app-core-02.js'));
  assert.match(persistence, /options\.skipSessionAssetSave\s*!==\s*true[\s\S]*scheduleSessionAssetSaveIfChanged/);
  const persistImport = extractFunction(uiSource, 'persistFactoryProjectBundleLocally');
  const importStart = uiSource.indexOf('async function importFactoryProjectFileBundle(');
  const importEnd = uiSource.indexOf('async function importFactoryProjectFileFromText(', importStart);
  const importBundle = uiSource.slice(importStart, importEnd);
  assert.match(persistImport, /replicas:\s*\[\s*['"]session['"]\s*\]/);
  assert.match(persistImport, /selectLocalSessionPayload\(prepared\.snapshot\)/);
  assert.match(persistImport, /indexeddb:\s*\{\s*records:\s*prepared\.records,\s*sessionAssets:\s*prepared\.sessionAssets\s*\}/);
  assert.match(persistImport, /session:\s*\{\s*writeBootstrap:\s*true,\s*recoverySnapshot:\s*sessionRecovery\.payload\s*\}/);
  assert.match(importBundle, /await persistFactoryProjectBundleLocally\([\s\S]*commitCurrentWorkspaceRevision\([\s\S]*commitResult\.envelope\.metadata\.revision/);
  assert.doesNotMatch(importBundle, /savePersistentState\s*\(/);
});

test('OAuth 백그라운드 상태 완료는 작업파일 복원 렌더를 끼어들지 않는다', () => {
  // Given: Cafe24 OAuth 자동 상태 갱신 callback을 읽는다.
  const uiSource = source(path.join(ROOT, 'src', 'app-core-06.js'));
  const autoRefresh = extractFunction(uiSource, 'factoryStartCafe24OAuthAutoRefresh');

  // When/Then: 상태는 반영하되 복원 중에는 마지막 import 렌더에 합친다.
  assert.match(uiSource, /function factoryRenderAfterBackgroundStatusUpdate\([\s\S]*state\.projectBusy\s*&&\s*state\.workfileRestoreState[\s\S]*return/);
  assert.match(autoRefresh, /const commitStatus = \(buildStatus, buildSignature, buildLog\) =>/);
  assert.match(autoRefresh, /factoryRuntimeUpdateOwnedFactory\([\s\S]*?'product-db'/);
  assert.equal((autoRefresh.match(/factoryRenderAfterBackgroundStatusUpdate\(\)/g) || []).length, 1);
  assert.doesNotMatch(autoRefresh, /\n\s+render\(\);/);
});

test('가벼운 저장본도 작업파일 범위와 commit된 revision을 잃지 않는다', () => {
  // Given: 서버/로컬 저장본을 만드는 실제 함수 경계를 읽는다.
  const persistence = source(path.join(ROOT, 'src', 'app-core-02.js'));
  const serverSnapshot = extractFunction(persistence, 'buildServerLastWorkSnapshot');
  const loadSession = extractFunction(persistence, 'loadPersistentSession');

  // When/Then: 보조 저장본이 주 저장본에 재사용돼도 작업파일 identity가 보존되어야 한다.
  assert.match(serverSnapshot, /currentProjectId:\s*state\.currentProjectId/);
  assert.match(serverSnapshot, /workspaceScope:\s*\{\s*id:\s*workspaceScope\s*\}/);
  assert.match(serverSnapshot, /workspaceRevision:\s*currentWorkspaceRevision\(workspaceScope\)/);
  assert.match(persistence, /workspaceRevision:\s*payload\.workspaceRevision\s*\|\|\s*null/);

  // And: payload 저장 성공 뒤에만 revision/부트스트랩을 확정해야 한다.
  const saveStart = persistence.indexOf('function savePersistentState(');
  const saveEnd = persistence.indexOf('function flushQueuedPersistentState(', saveStart);
  const savePersistentState = persistence.slice(saveStart, saveEnd);
  const sessionAssetsCommit = extractFunction(persistence, 'sessionAssetsForAuthoritativeCommit');
  const acceptedIndex = savePersistentState.indexOf('if (!commitResult.accepted || commitResult.partial)');
  const protectedNoOpIndex = savePersistentState.indexOf('if (commitResult.protectedNoOp)');
  const protectedWarningClearIndex = savePersistentState.indexOf(
    'clearResolvedSessionPersistenceWarning()',
    protectedNoOpIndex,
  );
  const protectedReturnIndex = savePersistentState.indexOf('return true;', protectedNoOpIndex);
  const commitIndex = savePersistentState.indexOf('commitCurrentWorkspaceRevision(commitResult.envelope.metadata.revision)');
  const bootstrapIndex = savePersistentState.indexOf('saveLastWorkBootstrap()', commitIndex);
  const completionReturnIndex = savePersistentState.lastIndexOf('return persistenceCompletion;');
  assert.ok(
    protectedNoOpIndex > acceptedIndex
      && protectedWarningClearIndex > protectedNoOpIndex
      && protectedReturnIndex > protectedWarningClearIndex
      && commitIndex > protectedReturnIndex,
    'protected server no-op must clear the resolved warning and stop before publishing a new local revision',
  );
  assert.ok(acceptedIndex >= 0 && commitIndex > acceptedIndex && bootstrapIndex > commitIndex);
  assert.ok(completionReturnIndex > bootstrapIndex, 'savePersistentState must return durable completion');
  assert.match(sessionAssetsCommit, /currentFingerprint\s*===\s*lastSessionAssetFingerprint[\s\S]*return existing/);
  assert.match(savePersistentState, /await sessionAssetsForAuthoritativeCommit\(\)[\s\S]*indexeddb:\s*\{\s*sessionAssets\s*\}/);
  assert.match(savePersistentState, /commitCurrentWorkspaceRevision[\s\S]*markSessionAssetFingerprintSaved\(\)[\s\S]*scheduleSessionAssetSaveIfChanged/);

  // And: 아직 commit되지 않은 revision이나 identity-only bootstrap을 live restore fence로 공개하지 않는다.
  const nextRevision = extractFunction(persistence, 'nextCurrentWorkspaceRevision');
  const saveNowStart = persistence.indexOf('function saveLastWorkNow(');
  const saveNowEnd = persistence.indexOf('function flushLastWorkBeforeLeave(', saveNowStart);
  const saveLastWorkNow = persistence.slice(saveNowStart, saveNowEnd);
  assert.doesNotMatch(nextRevision, /state\.workspaceRevision\s*=/);
  assert.doesNotMatch(saveLastWorkNow, /saveLastWorkBootstrap\(\);\s*const pending/);

  // And: 과거에 범위 필드만 빠진 저장본은 revision scope로 안전 복구한다.
  assert.match(loadSession, /workspaceSnapshotRevision\(s\)\?\.scopeId/);
});
