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
const RUNTIME_MODULE_IDS = path.join(ROOT, 'src', 'modules', 'runtime-module-ids.mjs');

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

test('런타임 매니페스트가 모든 실제 ESM foundation을 발견하고 안전한 순서로 선언한다', async () => {
  // Given: canonical runtime manifest 경로를 준비한다.
  // When: 파일 존재 여부와 JSON 계약을 확인한다.
  assert.equal(fs.existsSync(RUNTIME_MANIFEST), true, 'src/runtime-manifest.json이 필요합니다.');
  const manifest = JSON.parse(source(RUNTIME_MANIFEST));

  // Then: 앱 엔트리, classic sources, native modules가 모두 명시되어야 한다.
  assert.equal(manifest.entry, 'app.html');
  assert.ok(Array.isArray(manifest.scripts) && manifest.scripts.length >= 12);
  const moduleIds = await import(`${pathToFileURL(RUNTIME_MODULE_IDS).href}?architecture=${Date.now()}`);
  assert.deepEqual(manifest.modules, Array.from(moduleIds.KNOWN_FOUNDATION_MODULE_IDS));
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

test('검증된 대용량 작업파일은 제품 이미지와 경쟁사 상태를 중복 복원하지 않는다', () => {
  // Given: 작업파일 payload와 assetPayload에는 같은 제품 이미지 백업이 함께 들어갈 수 있다.
  const persistence = source(path.join(ROOT, 'src', 'app-core-02.js'));
  const stateSource = source(path.join(ROOT, 'src', 'app-core-03.js'));

  // When/Then: 자산 복원 중 시장 동기화는 마지막 단일 동기화까지 미루고, 같은 백업은 두 번 적용하지 않는다.
  assert.match(persistence, /applyProductImageBackupPayload\(assets\.productImageBackup,[\s\S]{0,260}syncMarket:\s*false/);
  assert.match(persistence, /options\.syncMarket\s*!==\s*false\s*&&\s*typeof ensureCompMarketScrapeState/);
  assert.match(stateSource, /next\.productImageBackup\s*&&\s*!workspaceAssetPayload\?\.productImageBackup/);

  // And: JSON.parse·검증·준비를 끝낸 전용 payload를 다시 20MB 전체 직렬화하지 않는다.
  assert.match(stateSource, /options\.payloadAlreadyDetached\s*===\s*true\s*\?\s*payload\s*:\s*cloneData\(payload\)/);
  assert.match(stateSource, /validatedProjectFileRestore:\s*true,[\s\S]{0,100}payloadAlreadyDetached:\s*true/);
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

  const currentCheckSource = extractFunction(uiSource, 'factoryRuntimeIsOperationCurrent');
  const isCurrent = new Function(
    'currentRuntimeMenuOperationToken',
    'factoryRuntimeRequireStore',
    `${currentCheckSource}; return factoryRuntimeIsOperationCurrent;`,
  )(() => 'project-a:project:project-a:7', () => ({ isOperationCurrent: token => token?.revision === 3 }));
  assert.equal(isCurrent('project-a:project:project-a:7'), true);
  assert.equal(isCurrent('project-a:project:project-a:8'), false);
  assert.equal(isCurrent({ revision: 3 }), true);
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

test('Cafe24 참조목록 자동 로딩은 경쟁사·생성·섹션 탭의 작업 토큰에 끼어들지 않는다', () => {
  // Given: 조립공장 이벤트 바인더는 모든 탭 렌더 뒤 실행된다.
  const uiSource = source(path.join(ROOT, 'src', 'app-core-06.js'));
  const bindFactoryEvents = extractFunction(uiSource, 'bindFactoryEvents');

  // When/Then: Cafe24 목록이 필요한 탭에서만 네트워크 갱신을 시작해야 한다.
  assert.match(bindFactoryEvents, /new Set\(\['db', 'fields', 'publish'\]\)/);
  assert.match(bindFactoryEvents, /cafe24ReferenceTabs\.has\(String\(factory\.automation\?\.activeTab \|\| ''\)\)[\s\S]*factoryEnsureCafe24ReferenceLists\(\)/);
  assert.doesNotMatch(bindFactoryEvents, /bindFactoryCriticalActions\(\);\s*try\s*\{\s*factoryEnsureCafe24ReferenceLists\(\)/);
});

test('모듈 소유 탭의 생성 버튼은 레거시 인라인 핸들러와 이벤트를 이중 소유하지 않는다', () => {
  // Given: assets/publish 탭은 각 ESM binder가 data-factory-run-stage 클릭을 소유한다.
  const uiSource = source(path.join(ROOT, 'src', 'app-core-05.js'));
  const assetChooser = extractFunction(uiSource, 'renderFactoryAutomationAssetChooser');
  const finalRegistration = extractFunction(uiSource, 'renderFactoryFinalRegistrationPanel');

  // When/Then: 해당 탭 마크업이 레거시 inline handler로 bubbling을 가로막으면 안 된다.
  assert.doesNotMatch(assetChooser, /factoryRunStageButtonInline/);
  assert.doesNotMatch(finalRegistration, /factoryRunStageButtonInline/);
  assert.match(source(path.join(ROOT, 'src', 'menus', 'factory', 'tabs', 'assets-tab-bind.mjs')), /fire\('runStage'/);
  assert.match(source(path.join(ROOT, 'src', 'menus', 'factory', 'tabs', 'publish-tab.mjs')), /data-factory-run-stage/);
});

test('장시간 생성 렌더는 현재 명령 draft를 읽고 렌더 동기화로 revision을 중첩 증가시키지 않는다', () => {
  // Given: 이미지 생성 명령은 하나의 store draft를 장시간 소유한 채 진행 상태를 렌더한다.
  const runtime = source(path.join(ROOT, 'src', 'app-core-03.js'));
  const factoryUi = source(path.join(ROOT, 'src', 'app-core-06.js'));
  const renderScope = extractFunction(runtime, 'factoryRuntimeRenderWithOwnedDraft');
  const readFactory = extractFunction(runtime, 'factoryRuntimeReadFactory');
  const updateFactory = extractFunction(runtime, 'factoryRuntimeUpdateOwnedFactory');
  const runImageStageStart = factoryUi.indexOf('async function factoryGenerateImageCutsBackedStage(');
  const runImageStageEnd = factoryUi.indexOf('async function factoryGenerateImageStage(', runImageStageStart);
  const runStageStart = factoryUi.indexOf('async function factoryRunStage(');
  const runStageEnd = factoryUi.indexOf('function factorySendAssetToStage(', runStageStart);
  assert.ok(runImageStageStart >= 0 && runImageStageEnd > runImageStageStart);
  assert.ok(runStageStart >= 0 && runStageEnd > runStageStart);
  const runImageStage = factoryUi.slice(runImageStageStart, runImageStageEnd);
  const runStage = factoryUi.slice(runStageStart, runStageEnd);

  // When/Then: 렌더 호출 중에는 동일 draft를 읽고 렌더 전용 세 명령만 그 draft에 합쳐야 한다.
  assert.match(renderScope, /factoryRuntimeOwnedRenderDraft\s*=\s*factory/);
  assert.match(renderScope, /finally[\s\S]*factoryRuntimeOwnedRenderDraft\s*=\s*previous/);
  assert.match(readFactory, /if \(factoryRuntimeOwnedRenderDraft\) return factoryRuntimeOwnedRenderDraft/);
  assert.match(updateFactory, /FACTORY_RUNTIME_OWNED_RENDER_COMMANDS\.has\(commandName\)[\s\S]*mutator\(factoryRuntimeOwnedRenderDraft\)/);
  for (const command of [
    'factory/runtime:updateFromInputs',
    'factory/runtime:preserveDetailHtml',
    'factory/runtime:saveSnapshotMetadata',
  ]) {
    assert.match(runtime, new RegExp(command.replace('/', '\\/')));
  }

  // And: 생성 진행 및 최종 성공 렌더가 모두 명령 소유 범위 안에서 실행되어야 한다.
  assert.match(runImageStage, /factoryRuntimeRenderWithOwnedDraft\(factory\)/);
  assert.match(runStage, /factoryRuntimeRenderWithOwnedDraft\(done\)/);
});

test('섹션 작업 범위는 퇴역한 state.factory 대신 canonical runtime snapshot을 읽는다', () => {
  // Given: 섹션 결과에 상품·실행·입력 이미지 범위를 찍는 실제 함수를 읽는다.
  const persistence = source(path.join(ROOT, 'src', 'app-core-02.js'));
  const scopeMeta = extractFunction(persistence, 'sectionWorkScopeMeta');

  // When/Then: 명시적 source가 없으면 store 소유 factory snapshot을 기준으로 삼아야 한다.
  assert.match(scopeMeta, /!source\s*&&\s*typeof factoryRuntimeReadFactory === 'function'/);
  assert.match(scopeMeta, /factory\s*=\s*factoryRuntimeReadFactory\(\)/);
  assert.match(scopeMeta, /catch\(e\)/, 'runtime store 선언 전 startup 호출은 bootstrap state로 안전하게 폴백해야 합니다.');
  assert.doesNotMatch(scopeMeta, /const factory = live\?\.factory \|\| \{\}/);
});

test('섹션 일괄 생성 중지 명령은 인자 없이 호출해도 저장 옵션을 안전하게 처리한다', () => {
  // Given: 생성 화면 버튼이 인자 없이 호출하는 실제 중지 명령을 읽는다.
  const uiSource = source(path.join(ROOT, 'src', 'app-core-06.js'));
  const start = uiSource.indexOf('function requestSectionBatchStopAfterCurrent(');
  const end = uiSource.indexOf('function finishSectionBatchAfterStop(', start);
  assert.ok(start >= 0 && end > start);
  const stopAfterCurrent = uiSource.slice(start, end);

  // When/Then: 선택적 저장 옵션은 기본 객체를 가져 ReferenceError를 만들지 않아야 한다.
  assert.match(stopAfterCurrent, /function requestSectionBatchStopAfterCurrent\(options\s*=\s*\{\}\)/);
  assert.match(stopAfterCurrent, /options\.save\s*!==\s*false/);
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

test('초기 세션 정규화는 state 선언 전에도 백엔드 URL을 안전하게 계산한다', () => {
  // Given: 저장 세션은 전역 state가 만들어지기 전에 정규화된다.
  const runtime = source(path.join(ROOT, 'src', 'app-core-03.js'));
  const baseUrlResolver = extractFunction(runtime, 'factoryRuntimeBackendBaseUrl');
  const sessionLoadIndex = runtime.indexOf('const _savedSession = loadPersistentSession();');
  const stateDeclarationIndex = runtime.indexOf('const state = {');

  // When/Then: resolver가 TDZ의 lexical state를 직접 읽으면 초기 복원이 통째로 실패한다.
  assert.ok(sessionLoadIndex >= 0 && stateDeclarationIndex > sessionLoadIndex);
  assert.doesNotMatch(baseUrlResolver, /\bstate\s*\??\./);
  assert.doesNotMatch(baseUrlResolver, /window\.__kuasangseState/);
  assert.match(baseUrlResolver, /loadBackendUrl\(\)/);

  const resolveBeforeState = new Function(
    'window',
    'loadBackendUrl',
    `${baseUrlResolver}\nreturn factoryRuntimeBackendBaseUrl();`,
  );
  assert.equal(
    resolveBeforeState({}, () => 'http://127.0.0.1:15061/'),
    'http://127.0.0.1:15061',
  );
});
