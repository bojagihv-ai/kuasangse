const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

test('batch worker module is registered as one versioned ESM capability', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8'));
  assert.equal(manifest.modules.filter(item => item === 'src/modules/batch-control-worker.mjs').length, 1);
  assert.equal(manifest.modules.filter(item => item === 'src/modules/factory-cafe24-command-bridge.mjs').length, 1);
  assert.equal(manifest.modules.filter(item => item === 'src/modules/factory-control-command-bridge.mjs').length, 1);
  assert.equal(manifest.modules.filter(item => item === 'src/modules/factory-workspace-command-bridge.mjs').length, 0);
  assert.equal(manifest.modules.some(item => item.includes('control_tower/tests/fixtures')), false);
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  assert.equal(module.BATCH_CONTROL_WORKER_CAPABILITY_VERSION, 'batch-control-worker:v1');
  assert.equal(module.BATCH_CONTROL_CAFE24_COMMAND_VERSION, 'factory-cafe24-command:v1');
  assert.deepEqual(module.BATCH_CONTROL_COMMAND_KINDS, ['factory-composition', 'factory-store', 'workspace-persistence', 'factory-cafe24', 'factory-control', 'factory-workfile']);
});

test('production worker startup cannot seed or mutate an isolated test workspace', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-loader.js'), 'utf8');
  const classicRuntime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const classicHydration = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const persistentRuntime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  const bundle = fs.readFileSync(path.join(ROOT, 'dist', 'app-runtime.bundle.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8');
  const launcher = fs.readFileSync(path.join(ROOT, 'launcher.ps1'), 'utf8');
  const bridgeSource = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs'), 'utf8');
  assert.match(source, /searchParams\.get\('batchWorker'\) === '1'/);
  assert.match(source, /installBatchControlWorker/);
  assert.match(source, /installFactoryCafe24CommandBridge/);
  assert.match(source, /installFactoryControlCommandBridge/);
  assert.match(source, /__KUASANGSE_BATCH_CONTROL_COMMAND_BRIDGE__/);
  assert.match(source, /__KUASANGSE_FACTORY_CONTROL_COMMAND_BRIDGE__/);
  assert.match(source, /startPolling/);
  assert.match(source, /startProjectionPolling/);
  assert.match(source, /controlTowerBase/);
  assert.match(source, /\['127\.0\.0\.1', 'localhost'\]/);
  assert.match(source, /render: \(\) => requestClassicRuntime\('render', isBatchWorker \? \{ mode: 'batch-worker' \} : null\)/);
  assert.match(
    source,
    /\['factory-cafe24-command', 'factory-control-command'\]\.includes\(command\)\s*\?\s*CLASSIC_RUNTIME_FACTORY_COMMAND_TIMEOUT_MS/,
    '제품 전체 공정 명령은 Cafe24 명령과 같은 장시간 응답 제한을 사용해야 합니다.',
  );
  assert.match(
    source,
    /CLASSIC_RUNTIME_FACTORY_COMMAND_TIMEOUT_MS\s*=\s*3600000/,
    '상세 15개 생성과 저장까지 끝날 수 있도록 제품 공정 명령은 60분을 기다려야 합니다.',
  );
  assert.match(source, /batch-worker-shell/);
  assert.match(source, /const expectedRootSelector = isBatchWorker \? '\.batch-worker-shell' : '\.app'/);
  assert.match(source, /ttlMs: isBatchWorker \? 120_000 : undefined/);
  assert.match(source, /authorityHeartbeat: \(\) => window\.__KUASANGSE_WORKSPACE_LOCK__\?\.heartbeat\?\.\(\)/);
  assert.doesNotMatch(source, /factoryState|window\.state/);
  assert.match(classicRuntime, /renderClassicRuntimeAfterHydration\(request\.payload\)/);
  assert.match(
    classicRuntime,
    /factory_product_checkpoint_save_failed\$\{detail \? `: \$\{detail\}` : ''\}/,
    '체크포인트 저장 실패는 조립공장 내부 원문을 생산관제 워커까지 전달해야 합니다.',
  );
  assert.match(classicRuntime, /options\?\.mode === 'batch-worker'/);
  assert.match(classicRuntime, /classicRuntimeBatchWorkerMode = true/);
  assert.match(classicRuntime, /classicRuntimeHydrationActive \|\| classicRuntimeBatchWorkerMode/);
  assert.match(classicHydration, /classicRuntimeIsBatchWorker/);
  assert.match(classicHydration, /if \(!batchWorker\) \{\s*await hydrateServerLastWorkSnapshot\(/);
  assert.match(
    classicHydration,
    /const initialWorkspaceAuthority = !batchWorker\s*&&\s*hydrationIdentityIsCurrent\(initialHydrationIdentity\)/,
    '백그라운드 batchWorker는 일반 작업 화면의 편집권을 획득하면 안 됩니다.',
  );
  assert.match(
    classicHydration,
    /activeAuthority = batchWorker\s*\?\s*null\s*:\s*await ensureWorkspaceEditAuthority\(activeHydrationIdentity\.scopeId\)/,
    '지연 복원 중 workspace identity가 바뀌어도 batchWorker는 편집권을 재획득하면 안 됩니다.',
  );
  assert.match(persistentRuntime, /suppressHydrationRender/);
  assert.match(classicRuntime, /request\.command === 'factory-cafe24-command'/);
  assert.match(classicRuntime, /factoryRuntimePublishTab\.invoke\('runGuideAction', request\.payload\)/);
  assert.match(
    classicRuntime,
    /const connected = Boolean\(\s*workspaceId\s*&& productKey\s*&& currentRunId\s*&& inputFingerprint\s*\)/,
    '불완전한 작업 신원은 서버에 connected 프로젝션으로 보내면 안 됩니다.',
  );
  assert.doesNotMatch(bridgeSource, /app-core-0[56]|querySelector|window\.state|factoryState|localStorage|indexedDB/);
  assert.match(
    launcher,
    /app\.html\?batchWorker=1&controlTowerBase=' \+ \$EncodedControlTowerBase/,
  );
  for (const productionSource of [source, classicRuntime, bundle, manifest, launcher]) {
    assert.doesNotMatch(
      productionSource,
      /isolatedFactoryWorkspace|task13-live|registered-factory-workspace|local-contract|factory-live-candidate|factory-workspace-command-bridge|control_tower\/tests\/fixtures/,
    );
  }
});

test('factory product preparation is a declared store command with its real write partitions', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryRuntimeCreateCommandPolicies()');
  const end = source.indexOf('\nconst FACTORY_RUNTIME_COMMAND_POLICIES', start);
  assert.ok(start >= 0 && end > start);
  const policies = vm.runInNewContext(`${source.slice(start, end)}; factoryRuntimeCreateCommandPolicies()`);
  const policy = policies['factory/control:prepareProduct'];

  assert.equal(policy.coordinator, 'factory');
  const paths = new Set(policy.parts.flatMap(part => part.paths));
  for (const pathName of [
    'workspace', 'currentProjectId', 'currentProjectName', 'product', 'automation.dbSearchQuery',
    'automation.activeTab', 'automation.activeTaskId', 'automation.optionMode', 'automation.optionSourceSummary',
    'stages.db', 'batchJobId', 'goalRun', 'logs', 'logStageId',
  ]) assert.equal(paths.has(pathName), true, pathName);
});

test('workfile creation is a declared factory command that owns workspace metadata', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryRuntimeCreateCommandPolicies()');
  const end = source.indexOf('\nconst FACTORY_RUNTIME_COMMAND_POLICIES', start);
  const policies = vm.runInNewContext(`${source.slice(start, end)}; factoryRuntimeCreateCommandPolicies()`);
  const policy = policies['factory/control:workfileCreated'];
  assert.equal(policy.coordinator, 'factory');
  assert.equal(policy.parts.flatMap(part => part.paths).includes('workspace'), true);
});

test('production A-cut selection may update its existing detail placement map', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryRuntimeCreateCommandPolicies()');
  const end = source.indexOf('\nconst FACTORY_RUNTIME_COMMAND_POLICIES', start);
  const policies = vm.runInNewContext(`${source.slice(start, end)}; factoryRuntimeCreateCommandPolicies()`);
  const paths = new Set(policies['factory/assets:selectFactoryACut'].parts.flatMap(part => part.paths));

  assert.equal(paths.has('detailPlacement'), true);
});

test('production control reads the stored competitor view after the screen mirror is replaced', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const groupStart = source.indexOf('function factoryRuntimeControlCompPage(');
  const groupEnd = source.indexOf('\nfunction factoryControlAssetCandidate(', groupStart);
  const snapshotStart = source.indexOf('function factoryRuntimeControlCompetitorSnapshot(');
  const snapshotEnd = source.indexOf('\nasync function factoryRuntimeControlEnsureAutoReferences(', snapshotStart);
  assert.ok(groupStart >= 0 && groupEnd > groupStart, 'canonical competitor view helper must be extractable');
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart, 'control competitor snapshot must be extractable');

  const canonicalCompPage = {
    marketScrape: {
      results: [{ id: 'vm-candidate-1', title: '방울수저집 경쟁상품', platform: '쿠팡' }],
      selectedIds: ['vm-candidate-1'],
      scrapedImages: [{ id: 'detail-image-1' }],
    },
    analysisResult: { summary: '현재 선택 경쟁사 분석' },
  };
  const factory = { compPage: { marketScrape: { results: [] } } };
  const context = vm.createContext({
    Object,
    Set,
    String,
    state: { compPage: { marketScrape: { results: [] } } },
    factoryRuntimeReadFactory: () => factory,
    factoryRuntimeReadViewSnapshot: () => ({ factory, competitors: { compPage: canonicalCompPage } }),
    compMarketAllCandidateResults: market => market.results || [],
    compMarketResultId: item => item.id,
    factoryControlThumbnailReference: () => '',
  });
  vm.runInContext(
    `${source.slice(groupStart, groupEnd)}\n${source.slice(snapshotStart, snapshotEnd)}`,
    context,
    { filename: 'src/app-core-03.js#control-competitor-view' },
  );

  const group = context.factoryControlCompetitorInputGroup(factory);
  const snapshot = context.factoryRuntimeControlCompetitorSnapshot();
  assert.equal(group.count, 1);
  assert.deepEqual(Array.from(group.missing), []);
  assert.equal(group.items[0].selected, true);
  assert.equal(snapshot.candidates.length, 1);
  assert.deepEqual(Array.from(snapshot.selectedIds), ['vm-candidate-1']);
  assert.equal(snapshot.detailImages.length, 1);
  assert.equal(snapshot.analysis.summary, '현재 선택 경쟁사 분석');
});

test('VM detail analysis refreshes the stored detail images before starting analysis', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const start = source.indexOf('async function runCompMarketDetailCaptureAndAnalyze(');
  const end = source.indexOf('\nasync function compMarketFetchJson(', start);
  assert.ok(start >= 0 && end > start, 'detail capture and analysis function must be extractable');

  let canonicalCompPage = {
    marketScrape: { selectedIds: ['candidate-1'], scrapedImages: [] },
  };
  const state = {
    compPage: { marketScrape: { selectedIds: ['candidate-1'], scrapedImages: [] } },
  };
  const analysisModes = [];
  const context = vm.createContext({
    Array,
    String,
    state,
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeReadViewSnapshot: () => ({ competitors: { compPage: canonicalCompPage } }),
    ensureCompMarketScrapeState: () => state.compPage.marketScrape,
    compMarketVisibleDetailImagesForSelection: market => market.scrapedImages || [],
    compMarketScrapedImageId: image => image.id,
    compMarketLog: () => {},
    compMarketSave: () => {},
    compMarketSetStatus: () => {},
    compMarketDetailJobInfo: () => ({}),
    compMarketDetailJobWaitMessage: () => '',
    render: () => {},
    runCompMarketDetailCapture: async () => {
      canonicalCompPage = {
        marketScrape: {
          selectedIds: ['candidate-1'],
          scrapedImages: [{ id: 'detail-image-1' }],
        },
      };
    },
    analyzeCompMarketScrapedImages: async mode => { analysisModes.push(mode); },
  });
  vm.runInContext(source.slice(start, end), context, {
    filename: 'src/app-core-06.js#detail-capture-analysis',
  });

  await context.runCompMarketDetailCaptureAndAnalyze(['candidate-1']);
  assert.deepEqual(analysisModes, ['all']);
  assert.deepEqual(Array.from(state.compPage.marketScrape.selectedImageIds), ['detail-image-1']);
});

test('production control analyzes already captured competitor images without recapturing them', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('async function factoryRuntimeControlEnsureAutoReferences(');
  const end = source.indexOf('\nfunction factoryRuntimeControlNeedsDetailRebuild(', start);
  assert.ok(start >= 0 && end > start, 'auto-reference function must be extractable');

  const actions = [];
  let analysis = null;
  const pendingPersistence = new Promise(() => {});
  const context = vm.createContext({
    state: {},
    factoryRuntimeReadFactory: () => ({
      product: {
        selectedDbCandidateKey: 'db-1',
        selectedCafe24CandidateKey: 'cafe24-1',
      },
    }),
    factoryRuntimeControlCompetitorSnapshot: () => ({
      candidates: [{ id: 'candidate-1' }],
      selectedIds: ['candidate-1'],
      detailImages: [{ id: 'detail-image-1' }],
      analysis,
    }),
    factoryRuntimeCompetitorMarketAction: async payload => {
      actions.push(payload);
      if (payload.type === 'analyze-images') analysis = { summary: '현재 상세 이미지 분석' };
    },
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeBatchCommandError: message => new Error(message),
    factoryRunDbCandidatesForSelection: async () => {},
    factoryRuntimeControlRestoreRequiredValues: async () => {},
    compMarketResultId: item => item.id,
    saveLastWorkNow: () => pendingPersistence,
  });
  vm.runInContext(source.slice(start, end), context, {
    filename: 'src/app-core-03.js#auto-reference-analysis',
  });

  const completion = await Promise.race([
    context.factoryRuntimeControlEnsureAutoReferences({ mode: 'auto' }).then(() => 'continued'),
    new Promise(resolve => setTimeout(() => resolve('blocked-by-persistence'), 50)),
  ]);
  assert.equal(completion, 'continued', '자동 참조 완료 뒤 저장 대기가 다음 생성 공정을 막으면 안 됩니다.');
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, 'analyze-images');
  assert.equal(actions[0].mode, 'all');
  assert.equal(context.state.competitorData.summary, '현재 상세 이미지 분석');
});

test('production control continues when Cafe24 is confirmed but Sinhwa DB has no match', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('async function factoryRuntimeControlEnsureAutoReferences(');
  const end = source.indexOf('\nfunction factoryRuntimeControlNeedsDetailRebuild(', start);
  assert.ok(start >= 0 && end > start, 'auto-reference function must be extractable');

  let dbRuns = 0;
  const context = vm.createContext({
    state: {},
    factoryRuntimeReadFactory: () => ({
      product: {
        selectedDbCandidateKey: '',
        selectedCafe24CandidateKey: 'cafe24-1',
      },
    }),
    factoryRuntimeControlCompetitorSnapshot: () => ({
      candidates: [{ id: 'candidate-1' }],
      selectedIds: ['candidate-1'],
      detailImages: [{ id: 'detail-image-1' }],
      analysis: { summary: '이미 완료된 분석' },
    }),
    factoryRuntimeCompetitorMarketAction: async () => {
      throw new Error('already-ready references must not rerun');
    },
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeBatchCommandError: message => new Error(message),
    factoryRunDbCandidatesForSelection: async () => { dbRuns += 1; },
    factoryRuntimeControlRestoreRequiredValues: async () => {},
    compMarketResultId: item => item.id,
    saveLastWorkNow: () => Promise.resolve(),
  });
  vm.runInContext(source.slice(start, end), context, {
    filename: 'src/app-core-03.js#auto-reference-cafe24-only',
  });

  await context.factoryRuntimeControlEnsureAutoReferences({ mode: 'auto' });

  assert.equal(dbRuns, 0, '신화사 DB 후보가 비어도 확정 Cafe24 후보가 있으면 재수집하지 않습니다.');
  assert.equal(context.state.competitorData.summary, '이미 완료된 분석');
});

test('startup session binding does not read the state TDZ before state is initialized', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  const documentScopeStart = source.indexOf('function getCurrentDocumentWorkspaceScope(');
  const branchStart = source.indexOf('function currentWorkspaceBranch(', documentScopeStart);
  const branchEnd = source.indexOf('\nfunction bindWorkspaceSnapshotToCurrentBranch(', branchStart);
  const documentScopeSource = source.slice(documentScopeStart, branchStart);
  const branchSource = source.slice(branchStart, branchEnd);

  assert.doesNotMatch(documentScopeSource, /state\?\./);
  assert.doesNotMatch(branchSource, /state\?\./);
});

test('Sinhwa job crosses the real worker and runtime bridge before exact-jcode collection', async () => {
  const workerModule = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const bridgeModule = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-control-command-bridge.mjs')));
  const contractModule = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-contract.mjs')));
  const candidateSource = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');
  const runtimeSource = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const runtimeStart = runtimeSource.indexOf('function factoryRuntimeControlProductImage(');
  const runtimeEnd = runtimeSource.indexOf('\nconst CLASSIC_RUNTIME_REQUEST_EVENT', runtimeStart);
  assert.ok(runtimeStart >= 0 && runtimeEnd > runtimeStart, 'factory product runtime must be extractable');

  const factory = {
    workspace: { id: 'bootstrap' },
    product: {
      productName: '',
      pendingDbCandidates: [],
      pendingCafe24Candidates: [],
      dbCandidates: [],
      cafe24Candidates: [],
    },
    stages: {},
    automation: { parallelProgress: {} },
    goalRun: {},
    logs: [],
  };
  let rankedSearchCalled = false;
  const fetchedJcodes = [];
  let appliedCandidate = null;
  let savedProject = null;
  let workerAuthorityScope = '';
  let workerProductAuthorityScope = '';
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    URL,
    structuredClone,
    state: {
      currentProjectId: 'bootstrap',
      currentProjectName: '',
      currentProjectCreatedAt: null,
      productName: '',
      projectBusy: false,
      workspaceDocumentDirty: false,
    },
    CAFE24_CONTROL_API: { defaultMallId: 'test-mall' },
    factoryRuntimeReadFactory: () => factory,
    factorySinhwaCandidateKey: candidate => String(candidate?.jcode || candidate?.id || ''),
    fetchSinhwaProductDetail: async jcode => {
      fetchedJcodes.push(jcode);
      return { jcode, product_name: '동명이상품', images: [{ thumb_url: 'exact.jpg' }] };
    },
    normalizeSinhwaDbCandidate: detail => ({ jcode: detail.jcode, product_name: detail.product_name }),
    normalizeSinhwaDbMatch: (_candidate, detail) => ({ jcode: detail.jcode, images: detail.images }),
    findSinhwaDbCandidateMatches: async () => {
      rankedSearchCalled = true;
      return { ranked: [], usedQuery: '' };
    },
  });
  context.globalThis = context;
  vm.runInContext(candidateSource, context, { filename: 'src/cafe24-sync.js' });
  Object.assign(context, {
    compactCafe24ApiErrorText: value => String(value || ''),
    completeWorkspaceBlankResetBoundary: () => {},
    factoryApplyCafe24CandidateFromReview: async () => true,
    factoryApplyDbCandidateFromReview: async (index, options) => {
      appliedCandidate = options.factory.product.pendingDbCandidates[index];
      options.factory.product.selectedDbCandidateKey = String(appliedCandidate?.jcode || '');
      return true;
    },
    factoryApplyProductImagePayload: () => {},
    factoryApplySelectedAssetsToSections: () => true,
    factoryCandidateCollectionScope: () => 'sinhwa-job-scope',
    factoryCandidateCollectionScopeMatches: () => true,
    factoryCandidateSearchTerms: current => [current.product.productName],
    factoryCaptureCandidateReviewSelection: () => ({}),
    factoryCurrentProductKey: current => current.product.productName,
    factoryCurrentWorkflowRunId: () => 'run-sinhwa-731',
    factoryImagePayloadFingerprint: value => String(value || '').slice(0, 12),
    factoryLog: () => {},
    factoryResetDbContextForNewCollection: () => {},
    factoryRestoreCandidateReviewSelection: () => false,
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    factoryRuntimeControlProjection: async () => ({
      schema: 'factory-control-projection:v1',
      connected: true,
      session: {
        workspaceId: context.state.currentProjectId,
        productId: `factory:${factory.product.productKey}`,
        productKey: factory.product.productKey,
        runId: 'run-sinhwa-731',
        inputFingerprint: 'sha256:sinhwa-731',
        revision: 0,
      },
      stages: [],
      registration: { jobId: factory.goalRun.jobId },
    }),
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, mutate) => ({ result: await mutate(factory) }),
    factorySearchCafe24DirectReviewCandidates: async () => [],
    factorySearchCafe24ReviewCandidates: async () => [],
    factorySetCurrentProductIdentity: (name, options) => {
      options.factory.product.productName = name;
      options.factory.product.productKey = name;
      options.factory.product.currentRunId = 'run-sinhwa-731';
    },
    factorySetParallelTaskProgress: () => null,
    factoryStartCafe24CandidateRerank: () => {},
    factoryUpdateCandidateReviewStageStatus: () => {},
    factoryUpdateFinalDbFromFields: () => ({}),
    fetchCafe24ControlStatus: async () => ({ ok: true, running: true }),
    fetchCafe24OAuthStatus: async () => ({ mallId: 'test-mall', message: 'ready', needsReauth: false, state: 'ready' }),
    fetchSinhwaDbLocalStatus: async () => ({ ok: true, running: true }),
    isCafe24ControlOfflineError: () => false,
    isCafe24ControlUnavailableError: () => false,
    isSinhwaDbNoCandidateError: () => false,
    isSinhwaDbOfflineError: () => false,
    isSinhwaDbUnavailableError: () => false,
    getCurrentLastWorkWorkspaceScope: () => 'draft:batch-worker-runtime',
    getCurrentDocumentWorkspaceScope: projectId => `project:${projectId}`,
    ensureWorkspaceEditAuthority: async (scopeId, options = {}) => {
      if (String(scopeId).startsWith('project:')) {
        assert.equal(options.force, true);
        assert.equal(options.confirmedTakeover, true);
        workerProductAuthorityScope = scopeId;
        return { scopeId, mode: 'editing' };
      }
      if (options.force === true) {
        workerAuthorityScope = scopeId;
        return { scopeId, mode: 'offline-edit' };
      }
      return { scopeId, mode: 'readonly' };
    },
    resetActiveWorkspaceDocumentCore: async () => {
      assert.equal(workerAuthorityScope, 'draft:batch-worker-runtime');
    },
    saveCurrentProject: async () => {
      savedProject = {
        id: context.state.currentProjectId,
        name: context.state.currentProjectName,
        createdAt: context.state.currentProjectCreatedAt,
        factory: structuredClone(factory),
      };
      return true;
    },
    saveLastWorkNow: async () => {},
    loadProjectRecord: async projectId => {
      if (!savedProject || savedProject.id !== projectId) return null;
      for (const key of Object.keys(factory)) delete factory[key];
      Object.assign(factory, structuredClone(savedProject.factory));
      context.state.currentProjectId = savedProject.id;
      context.state.currentProjectName = savedProject.name;
      context.state.currentProjectCreatedAt = savedProject.createdAt;
      return savedProject;
    },
    uid: prefix => `${prefix}-fixture`,
  });
  vm.runInContext(runtimeSource.slice(runtimeStart, runtimeEnd), context, { filename: 'src/app-core-03.js#factory-product-runtime' });
  context.factoryRuntimeControlEnsureAutoReferences = async () => {};
  context.factoryRuntimeControlNeedsDetailRebuild = () => false;
  context.factoryRunGoalLoop = async () => {
    await context.factoryCollectProductCandidatesForReview({ factory, render: false });
    return true;
  };

  const payload = {
    schema: 'factory-product-run-command:v1',
    jobId: 'run-sinhwa-731',
    batchId: 'batch-sinhwa',
    mode: 'auto',
    productName: '동명이상품',
    source: { kind: 'sinhwa-db', selectionId: '731' },
    jcode: 731,
    requiredValues: {},
    inputImages: [],
    startFresh: true,
    expectedStageKey: '',
    idempotencyKey: 'sinhwa-731',
  };
  const order = {
    orderId: 'order-sinhwa-731',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: payload.batchId,
    productId: 'sinhwa:731',
    productKey: payload.productName,
    currentRunId: payload.jobId,
    stageId: 'factory-product',
    operationToken: 'factory-product:sinhwa-731',
    idempotencyKey: 'sinhwa-731:1',
    expectedWorkfileRevision: 0,
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'runFactoryProduct',
      payload,
    },
  };
  const posted = [];
  const responseFor = endpoint => ({
    ok: true,
    status: 200,
    json: async () => endpoint === '/api/worker/claim'
      ? { order }
      : endpoint === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { accepted: true },
  });
  const bridge = bridgeModule.createFactoryControlCommandBridge({
    requestClassicRuntime: request => context.factoryRuntimeControlCommand(request),
  });
  const worker = workerModule.createBatchControlWorker({
    workerId: 'factory-worker-live',
    commandBridge: bridge,
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      posted.push({ endpoint, body: options.body ? JSON.parse(options.body) : null });
      return responseFor(endpoint);
    },
  });

  const result = await worker.start();

  assert.equal(result.status, 'completed');
  assert.equal(workerAuthorityScope, 'draft:batch-worker-runtime');
  assert.equal(workerProductAuthorityScope, 'project:batch:run-sinhwa-731');
  assert.deepEqual(fetchedJcodes, [731]);
  assert.equal(rankedSearchCalled, false);
  assert.equal(appliedCandidate?.jcode, 731);
  assert.equal(appliedCandidate?.image, 'exact.jpg');
  assert.equal(factory.product.jcode, 731);
  assert.equal(factory.product.candidateAutoApply, true);
  assert.deepEqual(posted.map(item => item.endpoint), [
    '/api/session',
    '/api/worker/claim',
    '/api/worker/order-sinhwa-731/ack',
    '/api/worker/order-sinhwa-731/events',
    '/api/worker/order-sinhwa-731/complete',
  ]);
  const checkpoint = posted.at(-1).body.result.checkpoint;
  assert.equal(checkpoint.projectId, 'batch:run-sinhwa-731');
  assert.equal(checkpoint.status, 'completed');

  factory.product.productName = '다음 제품';
  factory.product.productKey = '다음 제품';
  factory.goalRun.jobId = 'next-job';
  context.state.currentProjectId = 'batch:next-job';
  context.state.currentProjectName = '다음 제품';
  const restored = await bridge.run('factory-control', 'runFactoryProduct', {
    ...payload,
    startFresh: false,
    restoreOnly: true,
    checkpoint,
  });
  assert.equal(restored.status, 'completed');
  assert.equal(restored.projection.registration.jobId, payload.jobId);
  assert.equal(factory.product.productName, payload.productName);

  const imageBytesOrder = structuredClone(order);
  imageBytesOrder.command.payload.inputImages = [{
    role: 'base',
    ordinal: 1,
    name: '정면',
    fileName: 'front.png',
    sha256: 'fixture-sha',
    dataUrl: 'data:image/png;base64,skAAAAAAAAAAAAAAAAAA',
  }];
  assert.doesNotThrow(() => contractModule.validateOrder(imageBytesOrder));

  const factoryTermsOrder = structuredClone(order);
  factoryTermsOrder.command.payload.requiredValues = {
    stock: '99',
    usage: '수저 보관',
    optionMode: 'provided',
  };
  assert.doesNotThrow(() => contractModule.validateOrder(factoryTermsOrder));
  const lockedPolicyOrder = structuredClone(order);
  lockedPolicyOrder.command.payload.decisionModes = {
    sinhwa_db_product: 'auto',
    cafe24_product: 'auto',
    competitor_product: 'auto',
    competitor_coupang: 'auto',
    competitor_smartstore: 'auto',
    competitor_gmarket: 'auto',
    competitor_auction: 'auto',
    competitor_elevenst: 'auto',
    required_field_candidate: 'auto',
    representative_image: 'manual',
    size_image: 'auto',
    option_image: 'auto',
    general_image: 'auto',
    section_variant: 'auto',
    final_detail: 'auto',
  };
  assert.doesNotThrow(() => contractModule.validateOrder(lockedPolicyOrder));
  const invalidOptionModeOrder = structuredClone(factoryTermsOrder);
  invalidOptionModeOrder.command.payload.requiredValues.optionMode = 'custom-code';
  assert.throws(
    () => contractModule.validateOrder(invalidOptionModeOrder),
    error => error?.code === 'factory_product_payload_invalid',
  );
  const invalidStockOrder = structuredClone(factoryTermsOrder);
  invalidStockOrder.command.payload.requiredValues.stock = '99개';
  assert.throws(
    () => contractModule.validateOrder(invalidStockOrder),
    error => error?.code === 'factory_product_payload_invalid',
  );

  const sensitiveOrder = structuredClone(order);
  sensitiveOrder.command.payload.requiredValues = { nested: { accessToken: 'must-not-persist' } };
  assert.throws(
    () => contractModule.validateOrder(sensitiveOrder),
    error => error?.code === 'factory_product_sensitive_field_forbidden',
  );
  await assert.rejects(
    () => bridge.run('factory-control', 'runFactoryProduct', sensitiveOrder.command.payload),
    error => error?.code === 'factory_product_sensitive_field_forbidden',
  );
  const hiddenValueOrder = structuredClone(order);
  hiddenValueOrder.command.payload.requiredValues = { material: 'Bearer credential-value' };
  assert.throws(
    () => contractModule.validateOrder(hiddenValueOrder),
    error => error?.code === 'factory_product_sensitive_field_forbidden',
  );
  await assert.rejects(
    () => bridge.run('factory-control', 'runFactoryProduct', hiddenValueOrder.command.payload),
    error => error?.code === 'factory_product_sensitive_field_forbidden',
  );
});

test('workfile adopt command is exact, non-fresh, and rejects divergent identity', async () => {
  const contract = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-contract.mjs')));
  const payload = {
    schema: 'factory-product-run-command:v1',
    jobId: 'factory-job-fork',
    batchId: 'batch-fork',
    idempotencyKey: 'fork-idempotency',
    mode: 'manual',
    source: {
      kind: 'workfile',
      sha256: 'a'.repeat(64),
      revision: 87,
      runId: 'run-fork',
      workspaceId: 'workspace-fork',
      productId: 'product-fork',
      productKey: 'product-key-fork',
      inputFingerprint: 'fingerprint-fork',
    },
    productName: '포크 제품',
    workfileName: 'fork.kuasangse',
    requiredValues: {},
    inputImages: [],
    startFresh: false,
    expectedStageKey: '',
    restoreOnly: false,
    adoptHydratedWorkfile: true,
    hydratedRevision: 91,
  };
  assert.doesNotThrow(() => contract.validateProductRunPayload(payload));
  assert.throws(
    () => contract.validateProductRunPayload({ ...payload, startFresh: true }),
    error => error?.code === 'factory_workfile_fork_identity_invalid',
  );
  assert.throws(
    () => contract.validateProductRunPayload({ ...payload, source: { ...payload.source, revision: 86.5 } }),
    error => error?.code === 'factory_workfile_fork_identity_invalid',
  );
  assert.throws(
    () => contract.validateProductRunPayload({ ...payload, hydratedRevision: 91.5 }),
    error => error?.code === 'factory_product_payload_invalid',
  );
});

test('production color inputs become one idempotent Cafe24 color option draft', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryRuntimeControlProvidedColorOptionValues(');
  const end = source.indexOf('\nfunction factoryRuntimeControlWaitingStage(', start);
  assert.ok(start >= 0 && end > start, 'production color option helper must be extractable');

  const factory = { product: { cafe24OptionGroupsDraft: [], dbFieldSettings: {} } };
  const storedGroups = [];
  const context = vm.createContext({
    factoryCafe24CurrentProductKey: () => '2994',
    factoryStoreCafe24OptionGroupDraft: (groups, options) => {
      storedGroups.push(structuredClone(groups));
      options.factory.product.cafe24DraftProductKey = '2994';
      options.factory.product.cafe24OptionGroupsDraft = structuredClone(groups);
      options.factory.product.dbFieldSettings.option_name = {
        enabled: true,
        manualTouched: true,
        manualValue: groups[0].name,
      };
      options.factory.product.dbFieldSettings.option_values = {
        enabled: true,
        manualTouched: true,
        manualValue: groups[0].values.join('\n'),
      };
    },
    factorySetDbFieldManualValue: (fieldId, value, options) => {
      options.factory.product.dbFieldSettings[fieldId] = {
        enabled: true,
        manualTouched: true,
        manualValue: String(value),
      };
    },
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.applyOptions = factoryRuntimeControlApplyProvidedColorOptions;`, context);
  const payload = {
    requiredValues: { optionMode: 'provided' },
    inputImages: [
      { role: 'base', name: '대표' },
      { role: 'color-option', colorName: '초록', name: '2번' },
      { role: 'color-option', colorName: '꽃핑', name: '3번' },
      { role: 'color-option', colorName: '초록', name: '중복' },
      { role: 'color-option', colorName: '', name: '민트' },
    ],
  };

  assert.equal(context.applyOptions(factory, payload), true);
  assert.deepEqual(storedGroups[0][0], {
    key: 'group_1',
    name: '색상',
    values: ['초록', '꽃핑', '민트'],
    required_option: 'T',
    option_display_type: 'S',
  });
  assert.equal(factory.product.dbFieldSettings.option_count.manualValue, '3');
  assert.equal(context.applyOptions(factory, payload), false);
  assert.equal(storedGroups.length, 1, 'same production inputs must not churn the workfile revision');
});

test('automatic DB selection restores the declared option mode and supplied color draft', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('async function factoryRuntimeControlRestoreRequiredValues(');
  const end = source.indexOf('\nfunction factoryRuntimeControlCompetitorSnapshot(', start);
  assert.ok(start >= 0 && end > start, 'required-value restoration must be extractable');

  const factory = {
    automation: { optionMode: 'pending' },
    product: { finalDb: {}, requirementsSnapshot: {} },
  };
  const restoredColorDrafts = [];
  const context = vm.createContext({
    state: { productInfoManualValues: {} },
    factoryRuntimeDetachedValue: value => structuredClone(value),
    factoryRuntimeUpdateOwnedFactory: async (_command, _owner, mutate) => ({ result: await mutate(factory) }),
    factoryRuntimeControlApplyProvidedColorOptions: (draft, payload) => {
      restoredColorDrafts.push(structuredClone(payload));
      draft.product.colorDraftRestored = true;
      return true;
    },
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.restoreRequiredValues = factoryRuntimeControlRestoreRequiredValues;`, context, {
    filename: 'src/app-core-03.js#restore-required-values',
  });

  await context.restoreRequiredValues({
    productName: '자동 선택 제품',
    requiredValues: { optionMode: 'provided', stock: '99' },
    inputImages: [{ role: 'color-option', colorName: '초록' }],
  });

  assert.equal(factory.automation.optionMode, 'provided');
  assert.equal(factory.product.colorDraftRestored, true);
  assert.equal(restoredColorDrafts.length, 1);
});

test('production Cafe24 preflight reads the normalized option draft without rebuilding the write plan', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('async function factoryRuntimeInspectBatchCafe24Registration(');
  const end = source.indexOf('\nasync function factoryRuntimeVerifyBatchCafe24Registration(', start);
  assert.ok(start >= 0 && end > start, 'Cafe24 preflight must be extractable');

  const factory = {
    automation: { optionMode: 'provided', currentRunId: 'run-1' },
    product: {
      currentProductKey: 'product-1',
      inputImageFingerprint: 'fingerprint-1',
      cafe24OptionGroupsDraft: [{ name: '색상', values: ['초록', '꽃핑', '민트'] }],
    },
  };
  const context = vm.createContext({
    factoryRuntimeReadViewSnapshot: () => ({ factory }),
    factoryCurrentProductKey: value => value.product.currentProductKey,
    factoryCurrentWorkflowRunId: value => value.automation.currentRunId,
    factoryCurrentInputImageFingerprint: value => value.product.inputImageFingerprint,
    factoryCafe24TargetInfo: () => ({ productNo: '2994' }),
    factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ counter: 19 }),
    factoryRuntimeResolveCafe24Category: async () => ({ categoryId: '107', categoryLabel: '주방용품' }),
    factoryCafe24CurrentScopedDetailHtml: () => ({ html: '<img src="detail.jpg">' }),
    factoryRuntimeBatchImageReferences: () => ['hero.jpg'],
    factoryRuntimeSha256Text: async value => `sha:${value}`,
    factoryBuildCafe24OptionSyncPlan: () => { throw new Error('write planner must not run during projection'); },
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.inspect = factoryRuntimeInspectBatchCafe24Registration;`, context);

  const result = await context.inspect();
  assert.equal(result.status, 'ready');
  assert.equal(result.optionName, '색상');
  assert.deepEqual(Array.from(result.optionValues), ['초록', '꽃핑', '민트']);
  assert.equal(result.variantCount, 3);
  assert.equal(result.inventoryQuantity, '99');
});

test('batch worker manual field updates do not run screen-only Cafe24 button refreshes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');
  const start = source.indexOf('function factorySetDbFieldManualValue(');
  const end = source.indexOf('\nfunction factoryCollectCafe24CategoryRowsFromDom(', start);
  assert.ok(start >= 0 && end > start, 'manual field setter must be extractable');
  let primaryRefreshes = 0;
  let dedicatedRefreshes = 0;
  const setting = { enabled: true, manualTouched: false, manualValue: '' };
  const factory = { product: { dbFieldSettings: { option_count: setting } }, automation: {} };
  const context = vm.createContext({
    classicRuntimeBatchWorkerMode: true,
    FACTORY_CAFE24_PRODUCT_SCOPED_OPTION_FIELDS: new Set(),
    state: { currentProjectId: 'batch:job-1', productName: '상품' },
    factoryDbFieldSetting: () => setting,
    factoryCurrentProductIdentityMeta: () => ({ productIdentityKey: '상품' }),
    factoryCurrentWorkflowRunId: () => 'run-1',
    factoryCurrentInputImageFingerprint: () => 'fingerprint-1',
    factoryUpdateFinalDbFromFields() {},
    factoryRefreshCafe24PrimaryActionButtons: () => { primaryRefreshes += 1; },
    factoryRefreshCafe24DedicatedActionButtons: () => { dedicatedRefreshes += 1; },
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.setValue = factorySetDbFieldManualValue;`, context);

  assert.equal(context.setValue('option_count', '9', { enabled: true, factory }), true);
  assert.equal(setting.manualValue, '9');
  assert.equal(primaryRefreshes, 0);
  assert.equal(dedicatedRefreshes, 0);
});

test('production control auto run owns source analysis and rebuilds an exact 14-section detail', () => {
  const runtime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const factory = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const cafe24 = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');
  const workbench = fs.readFileSync(path.join(ROOT, 'control_tower', 'frontend', 'src', 'production-workbench.mjs'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'control_tower', 'frontend', 'control-tower.html'), 'utf8');

  assert.match(runtime, /function factoryRuntimeControlExecutionMode\(payload = \{\}\)/);
  assert.match(runtime, /goalRun\.mode = factoryRuntimeControlExecutionMode\(payload\)/);
  assert.match(runtime, /factoryRunDbCandidatesForSelection\(\{ preserveManualFields: true \}\)/);
  assert.match(runtime, /factoryRuntimeCompetitorMarketAction\(\{\s*type: 'quick-action',\s*action: 'start-vm',\s*skipConfirm: true,\s*\}\)/);
  assert.match(runtime, /factoryRuntimeCompetitorMarketAction\(\{ type: 'quick-action', action: 'analyze-vm' \}\)/);
  assert.match(runtime, /factoryRunGoalLoop\(\{\s*forceDetail:/);
  assert.match(runtime, /factory_cafe24_options_incomplete/);
  assert.match(runtime, /inventoryQuantity:\s*'99'/);
  assert.match(runtime, /\['size', 'options', 'cuts'\]\.includes\(stageId\)[\s\S]{0,120}factoryApplySelectedAssetsToSections\(draft\)/);
  assert.match(runtime, /const revisesPublishedProduct = \([\s\S]*registrationReceipt\?\.status === 'verified'[\s\S]*targetProductNo === String\(registrationReceipt\.productNo/);
  assert.match(runtime, /const publicationReceipt = factoryRuntimeBatchCafe24BindingMatches\([\s\S]*product\.cafe24BatchControlBinding[\s\S]*htmlDigest: preflight\.htmlDigest/);
  assert.match(runtime, /payload\.startFresh !== true[\s\S]*?hydrateServerLastWorkSnapshot\(\{\s*force: true,\s*forceRevisionRestore: true,\s*render: false,\s*\}\)/);
  assert.match(runtime, /payload\.startFresh !== true[\s\S]*?factoryApplyProductImagePayload\(firstBase, \{ factory: draft, syncState: true \}\)/);
  assert.match(runtime, /key: 'competitors'/);
  assert.match(factory, /hiddenSectionIds\.includes\('certifications'\)/);
  assert.match(factory, /cut\.placedSectionId = 'material_tech'/);
  assert.match(factory, /sectionCount: requiredSections\.length/);
  assert.match(factory, /competitorAnalysisReady:/);
  assert.match(factory, /stageId === 'detail' && forceDetail/);
  assert.match(cafe24, /preserveManualFields: options\.preserveManualFields === true/);
  assert.match(workbench, /competitors: '경쟁사 후보·상세 분석'/);
  assert.match(workbench, /registrationBlockerLabel/);
  assert.match(workbench, /'옵션 구성'/);
  assert.match(workbench, /'품목별 재고'/);
  assert.doesNotMatch(html, /신화사 코드 \/ 품번|policy snapshot|reasoning<\/label>|service tier<\/label>/i);
});

test('manual representative A-cut stops the goal loop before size generation', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');
  const start = source.indexOf('const FACTORY_GOAL_STAGE_A_CUT_DECISIONS');
  const end = source.indexOf('\nfunction factoryMakeSessionFolderName(', start);
  assert.ok(start >= 0 && end > start, 'goal loop must be extractable');
  const stageCalls = [];
  const completed = new Set();
  const factory = {
    product: { analysis: { id: 'reviewed' } },
    goalRun: {
      maxLoops: 2,
      targets: { hero: 1, size: 1 },
      mode: 'auto',
      decisionModes: { representative_image: 'manual', size_image: 'auto' },
    },
  };
  const context = vm.createContext({
    state: { analysis: { id: 'reviewed' } },
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => 'fixture-token' }),
    factoryRequireCurrentRunOperation: () => true,
    factoryUpdateFromInputs: () => {},
    factoryLog: () => {},
    saveLastWorkNow: () => {},
    render: () => {},
    factoryGoalAssetCount: stageId => completed.has(stageId) ? 1 : 0,
    factoryHasSizeFacts: () => true,
    factorySetStageStatus: () => {},
    factoryStageLabel: stageId => stageId,
    factoryRunStage: async stageId => {
      stageCalls.push(stageId);
      completed.add(stageId);
      return true;
    },
    factoryArchiveSession: async () => {},
    factoryRunOperationIsStale: () => false,
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.runGoalLoop = factoryRunGoalLoop;`, context);

  const success = await context.runGoalLoop({ factory, operationToken: 'fixture-token' });

  assert.equal(success, false);
  assert.deepEqual(stageCalls, ['hero']);
  assert.equal(factory.goalRun.failureReason, '검수형 루프 대기');
});

test('long-running product heartbeats carry the claimed worker session fence', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  let releaseCommand;
  const commandWait = new Promise(resolve => { releaseCommand = resolve; });
  const posts = [];
  let authorityHeartbeats = 0;
  const order = {
    orderId: 'order-heartbeat-1',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-heartbeat',
    productId: 'factory:heartbeat',
    productKey: 'heartbeat',
    currentRunId: 'run-heartbeat',
    stageId: 'factory-product',
    operationToken: 'factory-product:heartbeat',
    idempotencyKey: 'heartbeat:1',
    expectedWorkfileRevision: 0,
    workerSessionId: 'factory-session-heartbeat',
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'runFactoryProduct',
      payload: {
        schema: 'factory-product-run-command:v1',
        jobId: 'run-heartbeat',
        batchId: 'batch-heartbeat',
        mode: 'auto',
        productName: 'heartbeat',
        source: { kind: 'manual' },
        jcode: null,
        requiredValues: {},
        inputImages: [{
          role: 'base', ordinal: 1, name: '기본', fileName: 'base.png',
          sha256: 'fixture-sha', dataUrl: 'data:image/png;base64,AAAA',
        }],
        startFresh: true,
        expectedStageKey: '',
        idempotencyKey: 'heartbeat:1',
      },
    },
  };
  const worker = module.createBatchControlWorker({
    workerId: 'factory-worker-heartbeat',
    workerSessionId: order.workerSessionId,
    commandBridge: { run: async () => commandWait },
    authorityHeartbeat: async () => { authorityHeartbeats += 1; },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') return { ok: true, status: 200, json: async () => ({ sessionId: 'http-session', csrfToken: 'csrf' }) };
      const body = JSON.parse(options.body);
      posts.push({ endpoint, body });
      if (endpoint === '/api/worker/claim') return { ok: true, status: 200, json: async () => ({ order }) };
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });

  const running = worker.start();
  await new Promise(resolve => setImmediate(resolve));
  await worker.heartbeat();
  releaseCommand({ status: 'completed' });
  await running;

  const heartbeat = posts.find(item => item.endpoint.endsWith('/heartbeat'));
  assert.equal(heartbeat.body.workerSessionId, order.workerSessionId);
  assert.equal(heartbeat.body.workerId, 'factory-worker-heartbeat');
  assert.equal(heartbeat.body.productKey, order.productKey);
  assert.equal(heartbeat.body.idempotencyKey, order.idempotencyKey);
  assert.equal(heartbeat.body.expectedWorkfileRevision, order.expectedWorkfileRevision);
  assert.equal(authorityHeartbeats, 1);
});

test('factory projection preflight cache reuses an unchanged revision and invalidates on change', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function createFactoryControlPreflightCache(');
  const end = source.indexOf('\nconst factoryControlPreflightCache =', start);
  assert.ok(start >= 0 && end > start, 'factory preflight cache helper must be extractable');
  const createCache = new Function(`${source.slice(start, end)}; return createFactoryControlPreflightCache;`)();
  const cache = createCache();
  let calls = 0;
  const load = async () => ({ call: ++calls });

  const first = await cache.read('workspace-a:revision-1', load);
  const repeated = await cache.read('workspace-a:revision-1', load);
  const changed = await cache.read('workspace-a:revision-2', load);

  assert.equal(first.call, 1);
  assert.equal(repeated.call, 1);
  assert.equal(changed.call, 2);
});

test('factory projection keeps an archived candidate content identity', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  const start = source.indexOf('function factoryControlThumbnailReference(');
  const end = source.indexOf('\nfunction factoryControlAssetStage(', start);
  assert.ok(start >= 0 && end > start, 'factory candidate projection must be extractable');
  const projectCandidate = new Function(
    'factoryRuntimeDetachedValue',
    `${source.slice(start, end)}; return factoryControlAssetCandidate;`,
  )(value => structuredClone(value));

  const candidate = projectCandidate({
    id: 'hero-a',
    archiveId: 'archive-content-identity-a',
    imageUrl: '/api/local-archive/assets/archive-content-identity-a/image',
  });

  assert.equal(candidate.digest, 'archive-content-identity-a');
});

test('isolated workspace builder exists only as a detached integration harness', async () => {
  const fixturePath = path.join(
    ROOT,
    'control_tower',
    'tests',
    'fixtures',
    'isolated-factory-workspace-harness.mjs',
  );
  const module = await import(pathToFileURL(fixturePath));
  const harness = module.createIsolatedFactoryWorkspaceHarness({
    workspaceId: 'fixture-workspace-a',
    productKey: 'fixture-product-a',
    productName: 'Fixture Product A',
    runId: 'fixture-run-a',
    inputFingerprint: 'sha256:fixture-input-a',
    candidates: [
      {
        id: 'representative-a',
        stageKey: 'representative',
        thumbnailUrl: 'fixture://representative-a',
        digest: 'sha256:representative-a',
      },
      {
        id: 'representative-b',
        stageKey: 'representative',
        thumbnailUrl: 'fixture://representative-b',
        digest: 'sha256:representative-b',
      },
    ],
  });
  const snapshot = harness.store.getSnapshot();
  assert.equal(harness.schema, 'factory-workspace-integration-harness:v1');
  assert.equal(snapshot.factory.workspace.id, 'fixture:fixture-workspace-a');
  assert.equal(snapshot.factory.product.productKey, 'fixture-product-a');
  assert.equal(snapshot.factory.assets.length, 2);
  assert.equal(harness.store.getOperationToken().revision, 0);
  assert.doesNotMatch(
    fs.readFileSync(fixturePath, 'utf8'),
    /localStorage|sessionStorage|indexedDB|querySelector|window\.state|factoryState/,
  );
  harness.dispose();
});

test('batch worker validates and executes the versioned factory A-cut selection command', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const payload = {
    productId: 'cafe24:3001',
    productKey: 'product:alpha',
    stageKey: 'representative',
    candidateId: 'representative-b',
    expectedRevision: 9,
    expectedRunId: 'run-7',
    expectedInputFingerprint: 'sha256:input',
    idempotencyKey: 'a-cut:product:alpha:representative:representative-b:9',
  };
  const order = {
    orderId: 'factory-a-cut-1',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: 'factory-session',
    productId: payload.productId,
    productKey: payload.productKey,
    currentRunId: payload.expectedRunId,
    stageId: payload.stageKey,
    operationToken: 'factory-a-cut:1',
    idempotencyKey: payload.idempotencyKey,
    expectedWorkfileRevision: payload.expectedRevision,
    command: {
      kind: 'factory-control',
      version: 'factory-control-command:v1',
      name: 'selectFactoryACut',
      payload,
    },
  };
  const responseFor = endpoint => ({
    ok: true,
    status: 200,
    json: async () => endpoint === '/api/worker/claim'
      ? { order }
      : endpoint === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { accepted: true },
  });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: {
      run: async (...args) => {
        calls.push(args);
        return { schema: 'factory-a-cut-receipt:v1', revision: 10 };
      },
    },
    fetchImpl: async url => responseFor(new URL(url).pathname),
  });

  await worker.start();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-control');
  assert.equal(calls[0][1], 'selectFactoryACut');
  assert.deepEqual(calls[0][2], payload);
});

test('factory projection polling pushes the registered public projection without originals', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const timers = [];
  const posts = [];
  const projection = {
    schema: 'factory-control-projection:v1',
    connected: true,
    session: {
      productId: 'cafe24:3001',
      productKey: 'product:alpha',
      runId: 'run-7',
      inputFingerprint: 'sha256:input',
      revision: 9,
    },
    inputs: [],
    stages: [],
  };
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({}) },
    projectionBridge: { getProjection: async () => projection },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ sessionId: 'session-001', csrfToken: 'csrf-001' }) };
      }
      posts.push({ endpoint, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
    setIntervalImpl: callback => (timers.push(callback), timers.length),
    clearIntervalImpl() {},
  });

  const stop = worker.startProjectionPolling(25);
  await new Promise(resolve => setImmediate(resolve));
  await timers[0]();
  stop();

  assert.ok(posts.length >= 2);
  assert.equal(posts[0].endpoint, '/api/factory/session/hello');
  assert.ok(posts.slice(1).every(item => item.endpoint === '/api/factory/sync'));
  assert.ok(posts.every(item => item.body.projection.schema === 'factory-control-projection:v1'));
  assert.doesNotMatch(JSON.stringify(posts), /data:image|file:\/\//);
});

test('worker startup registers one real runtime session and idle heartbeat preserves its cursor identity', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const posts = [];
  const projection = {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: '41',
    sequence: 41,
    connected: true,
    session: {
      productId: 'factory:live-product',
      productKey: 'live-product',
      runId: 'run-live',
      inputFingerprint: 'sha256:live',
      revision: 7,
    },
    inputs: [{ key: 'product', count: 1, missing: [], items: [] }],
    stages: [],
  };
  const worker = module.createBatchControlWorker({
    workerId: 'factory-worker-live',
    runtimeBuildId: 'build-live',
    workerSessionId: 'worker-session-live',
    commandBridge: { run: async () => ({}) },
    projectionBridge: { getProjection: async () => projection },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ sessionId: 'csrf-session', csrfToken: 'csrf-live' }) };
      }
      posts.push({ endpoint, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true, cursor: String(posts.length) }) };
    },
  });

  await worker.hello();
  await worker.sessionHeartbeat();

  assert.deepEqual(posts.map(item => item.endpoint), [
    '/api/factory/session/hello',
    '/api/factory/session/heartbeat',
  ]);
  assert.equal(posts[0].body.sessionId, 'worker-session-live');
  assert.equal(posts[0].body.buildId, 'build-live');
  assert.equal(posts[0].body.projection.session.productKey, 'live-product');
  assert.equal(posts[1].body.sessionId, 'worker-session-live');
  assert.ok(posts[1].body.cursor > posts[0].body.cursor);
  assert.equal(posts[1].body.identity.runId, 'run-live');
  assert.equal(posts[1].body.identity.inputFingerprint, 'sha256:live');
});

test('factory session sync and heartbeat share one monotonic in-flight request', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const posts = [];
  const projection = {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: '41',
    sequence: 41,
    connected: true,
    session: {
      productId: 'factory:live-product',
      productKey: 'live-product',
      runId: 'run-live',
      inputFingerprint: 'sha256:live',
      revision: 7,
    },
    inputs: [],
    stages: [],
  };
  const worker = module.createBatchControlWorker({
    workerId: 'factory-worker-live',
    runtimeBuildId: 'build-live',
    workerSessionId: 'worker-session-live',
    commandBridge: { run: async () => ({}) },
    projectionBridge: { getProjection: async () => projection },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ sessionId: 'csrf-session', csrfToken: 'csrf-live' }) };
      }
      posts.push({ endpoint, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });

  await worker.hello();
  await Promise.all([worker.syncProjection(), worker.sessionHeartbeat()]);
  await worker.sessionHeartbeat();

  assert.deepEqual(posts.map(item => item.endpoint), [
    '/api/factory/session/hello',
    '/api/factory/sync',
    '/api/factory/session/heartbeat',
  ]);
  assert.ok(posts[0].body.cursor < posts[1].body.cursor);
  assert.ok(posts[1].body.cursor < posts[2].body.cursor);
});

test('projection sync is fenced by the live session id and monotonically increasing cursor', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const posts = [];
  const projection = {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: '1',
    sequence: 1,
    connected: false,
    reason: 'factory_workspace_missing',
    session: {},
    inputs: [],
    stages: [],
  };
  const worker = module.createBatchControlWorker({
    workerId: 'factory-worker-live',
    runtimeBuildId: 'build-live',
    workerSessionId: 'worker-session-live',
    commandBridge: { run: async () => ({}) },
    projectionBridge: { getProjection: async () => projection },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        return { ok: true, status: 200, json: async () => ({ sessionId: 'csrf-session', csrfToken: 'csrf-live' }) };
      }
      posts.push({ endpoint, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ accepted: true }) };
    },
  });

  await worker.hello();
  await worker.syncProjection();

  assert.equal(posts[1].endpoint, '/api/factory/sync');
  assert.equal(posts[1].body.sessionId, 'worker-session-live');
  assert.ok(posts[1].body.cursor > posts[0].body.cursor);
  assert.equal(posts[1].body.buildId, 'build-live');
});

test('Cafe24 batch revision fence reads the registered workspace authority capability', () => {
  const classicRuntime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  assert.match(classicRuntime, /function factoryRuntimeAuthoritativeWorkspaceRevision/);
  assert.match(classicRuntime, /__KUASANGSE_WORKSPACE_LOCK__\?\.snapshot\?\.\(\)/);
  assert.match(classicRuntime, /authority\?\.mode === 'editing'/);
  assert.match(classicRuntime, /factoryRuntimeAuthoritativeWorkspaceRevision\(\)/);
});

test('batch worker fences order identifiers and rejects unknown command kinds', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run() {} },
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      json: async () => new URL(url).pathname === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { order: {} },
    }),
  });
  assert.equal(worker.capabilityVersion, 'batch-control-worker:v1');
  await assert.rejects(
    worker.start(),
    error => error.code === 'order_invalid' || error.code === 'contract_version_unsupported',
  );
});

test('batch worker refreshes a stale CSRF session once after backend restart', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  let sessionCalls = 0;
  let claimCalls = 0;
  const claimHeaders = [];
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({}) },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      if (endpoint === '/api/session') {
        sessionCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ sessionId: `session-${sessionCalls}`, csrfToken: `csrf-${sessionCalls}` }),
        };
      }
      claimCalls += 1;
      claimHeaders.push(options.headers);
      if (claimCalls === 1) return { ok: false, status: 428, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ order: null }) };
    },
  });

  const result = await worker.start();

  assert.equal(result.status, 'idle');
  assert.equal(sessionCalls, 2);
  assert.equal(claimCalls, 2);
  assert.equal(claimHeaders[0]['X-Control-Tower-CSRF'], 'csrf-1');
  assert.equal(claimHeaders[1]['X-Control-Tower-CSRF'], 'csrf-2');
});

test('batch worker exposes the backend conflict code in HTTP errors', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({}) },
    fetchImpl: async url => new URL(url).pathname === '/api/session'
      ? { ok: true, status: 200, json: async () => ({ sessionId: 'session', csrfToken: 'csrf' }) }
      : { ok: false, status: 409, json: async () => ({ error: { code: 'lease_conflict' } }) },
  });

  await assert.rejects(
    worker.start(),
    error => error instanceof module.BatchWorkerHttpError
      && error.status === 409
      && error.code === 'lease_conflict'
      && error.message.includes('lease_conflict'),
  );
});

test('batch worker sends ack event and complete in order for one remote command', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'order-001', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-001', productId: 'product-001', productKey: 'product-001', currentRunId: 'run-001',
    stageId: 'validation', operationToken: 'op-001', idempotencyKey: 'idem-001', expectedWorkfileRevision: 0,
    command: { kind: 'factory-composition', version: 'composition:v1', name: 'validation', payload: {} },
  };
  const responseFor = endpoint => ({ ok: true, status: 200, json: async () => endpoint === '/api/worker/claim' ? { order } : endpoint === '/api/session' ? { sessionId: 'session-001', csrfToken: 'csrf-001' } : { accepted: true } });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({ digest: 'result' }) },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return responseFor(new URL(url).pathname); },
  });
  await worker.start();
  assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
    '/api/session',
    '/api/worker/claim',
    '/api/worker/order-001/ack',
    '/api/worker/order-001/events',
    '/api/worker/order-001/complete',
  ]);
});

test('batch worker accepts only the versioned Cafe24 factory command and forwards no approval token', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'order-cafe24', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-001', productId: 'product-001', productKey: 'product-001', currentRunId: 'run-001',
    stageId: 'cafe24', operationToken: 'op-001', idempotencyKey: 'idem-001', expectedWorkfileRevision: 3,
    command: {
      kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'detailToCafe24',
      payload: {
        jobId: 'job-001', productId: 'product-001', productKey: 'product-001', categoryId: 'cat',
        htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 3, expectedRunId: 'run-001',
        expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001', approvalGrantDigest: 'grant',
      },
    },
  };
  const responseFor = endpoint => ({ ok: true, status: 200, json: async () => endpoint === '/api/worker/claim' ? { order } : endpoint === '/api/session' ? { sessionId: 'session-001', csrfToken: 'csrf-001' } : { accepted: true } });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async (...args) => { calls.push(args); return { remoteReadbackDigest: 'html' }; } },
    fetchImpl: async (url) => responseFor(new URL(url).pathname),
  });
  await worker.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-cafe24');
  assert.equal(calls[0][1], 'detailToCafe24');
  assert.equal(calls[0][2].approvalGrantDigest, 'grant');
  assert.equal('approvalToken' in calls[0][2], false);
});

test('batch worker routes the read-only Cafe24 preflight through the registered bridge', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'order-cafe24-preflight', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: 'cafe24-preflight', productId: 'cafe24-preflight', productKey: 'cafe24-preflight', currentRunId: 'cafe24-preflight',
    stageId: 'cafe24', operationToken: 'preflight-001', idempotencyKey: 'preflight-001', expectedWorkfileRevision: 0,
    command: {
      kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'inspectDetailToCafe24', payload: {},
    },
  };
  const responseFor = endpoint => ({
    ok: true,
    status: 200,
    json: async () => endpoint === '/api/worker/claim'
      ? { order }
      : endpoint === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { accepted: true },
  });
  const result = {
    schema: 'factory-cafe24-preflight:v1',
    status: 'ready',
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    htmlDigest: 'canonical-html',
    imageDigests: ['image-1'],
    expectedWorkfileRevision: 108,
    expectedRunId: 'run-001',
    expectedInputFingerprint: 'fp',
  };
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: {
      run: async () => { throw new Error('write bridge must not run'); },
      inspect: async () => { calls.push('inspect'); return result; },
    },
    fetchImpl: async url => responseFor(new URL(url).pathname),
  });

  await worker.start();

  assert.deepEqual(calls, ['inspect']);
});

test('batch worker routes Cafe24 reconciliation through the read-only registered bridge', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const payload = {
    jobId: 'job-001', batchId: 'batch-001', productId: 'cafe24:2994', productKey: '방울수저집',
    categoryId: '71', htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 108,
    expectedRunId: 'run-001', expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001',
    selling: 'F', display: 'F', market_sync: 'F',
  };
  const order = {
    orderId: 'order-cafe24-reconcile', contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1',
    batchId: payload.batchId, productId: payload.productId, productKey: payload.productKey, currentRunId: payload.expectedRunId,
    stageId: 'cafe24', operationToken: 'reconcile-001', idempotencyKey: payload.idempotencyKey,
    expectedWorkfileRevision: payload.expectedWorkfileRevision, payloadDigest: 'approved-payload',
    command: { kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'verifyDetailToCafe24', payload },
  };
  const responseFor = endpoint => ({
    ok: true,
    status: 200,
    json: async () => endpoint === '/api/worker/claim'
      ? { order }
      : endpoint === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : { accepted: true },
  });
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: {
      run: async () => { throw new Error('write bridge must not run'); },
      verify: async (...args) => {
        calls.push(args);
        return {
          status: 'staged_verified', payloadDigest: 'approved-payload',
          remoteReadbackDigest: 'remote-html', externalProductNo: '2994', idempotencyKey: 'idem-001',
        };
      },
    },
    fetchImpl: async url => responseFor(new URL(url).pathname),
  });

  await worker.start();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-cafe24');
  assert.equal(calls[0][1], 'verifyDetailToCafe24');
  assert.equal('approvalGrantDigest' in calls[0][2], false);
});

test('registered Cafe24 bridge fences safe defaults and forwards through the classic runtime endpoint', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs')));
  const requests = [];
  const windowObject = {};
  const receipt = module.installFactoryCafe24CommandBridge(windowObject, {
    requestClassicRuntime: async payload => {
      requests.push(payload);
      return {
        status: 'staged_verified',
        remoteReadbackDigest: 'remote-html',
        remoteReadback: { productNo: '4120' },
        externalProductNo: '4120',
      };
    },
  });
  const payload = {
    jobId: 'job-001', batchId: 'batch-001', productId: 'cafe24:2994', productKey: '방울수저집',
    categoryId: '71', htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 108,
    expectedRunId: 'run-001', expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001',
    approvalGrantDigest: 'grant', selling: 'F', display: 'F', market_sync: 'F',
  };
  const order = {
    orderId: 'order-001', productId: payload.productId, productKey: payload.productKey,
    currentRunId: payload.expectedRunId, expectedWorkfileRevision: 108, idempotencyKey: payload.idempotencyKey,
    payloadDigest: 'approved-payload', command: { kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'detailToCafe24' },
  };

  const result = await receipt.bridge.run('factory-cafe24', 'detailToCafe24', payload, order);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'run-batch-cafe24-registration');
  assert.equal(requests[0].batchControl.productId, 'cafe24:2994');
  assert.equal('approvalToken' in requests[0].batchControl, false);
  assert.deepEqual(result, {
    status: 'staged_verified',
    payloadDigest: 'approved-payload',
    remoteReadbackDigest: 'remote-html',
    remoteReadback: { productNo: '4120' },
    externalProductNo: '4120',
    idempotencyKey: 'idem-001',
  });
  await assert.rejects(
    receipt.bridge.run('factory-cafe24', 'detailToCafe24', { ...payload, selling: 'T' }, order),
    error => error.code === 'unsafe_cafe24_defaults',
  );
});

test('registered Cafe24 bridge reconciles by remote readback without invoking the write action', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs')));
  const requests = [];
  const receipt = module.installFactoryCafe24CommandBridge({}, {
    requestClassicRuntime: async payload => {
      requests.push(payload);
      return { status: 'staged_verified', remoteReadbackDigest: 'remote-html', remoteReadback: { productNo: '4120' }, externalProductNo: '4120' };
    },
  });
  const payload = {
    jobId: 'job-001', batchId: 'batch-001', productId: 'cafe24:2994', productKey: '방울수저집',
    categoryId: '71', htmlDigest: 'html', imageDigests: ['img'], expectedWorkfileRevision: 108,
    expectedRunId: 'run-001', expectedInputFingerprint: 'fp', idempotencyKey: 'idem-001',
    selling: 'F', display: 'F', market_sync: 'F',
  };
  const order = {
    orderId: 'order-001', productId: payload.productId, productKey: payload.productKey,
    currentRunId: payload.expectedRunId, expectedWorkfileRevision: 108, idempotencyKey: payload.idempotencyKey,
    payloadDigest: 'approved-payload',
    command: { kind: 'factory-cafe24', version: 'factory-cafe24-command:v1', name: 'verifyDetailToCafe24' },
  };

  const result = await receipt.bridge.verify('factory-cafe24', 'verifyDetailToCafe24', payload, order);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'verify-batch-cafe24-registration');
  assert.equal('approvalGrantDigest' in requests[0].batchControl, false);
  assert.equal(result.remoteReadbackDigest, 'remote-html');
  assert.equal(result.externalProductNo, '4120');
});

test('registered Cafe24 bridge exposes a versioned read-only factory preflight', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-cafe24-command-bridge.mjs')));
  const requests = [];
  const receipt = module.installFactoryCafe24CommandBridge({}, {
    requestClassicRuntime: async payload => {
      requests.push(payload);
      return {
        schema: 'factory-cafe24-preflight:v1',
        status: 'ready',
        productId: 'cafe24:2994',
        productKey: '방울수저집',
        htmlDigest: 'canonical-html',
        imageDigests: ['image-1'],
        expectedWorkfileRevision: 108,
        expectedRunId: 'run-001',
        expectedInputFingerprint: 'fp',
      };
    },
  });

  const preflight = await receipt.bridge.inspect();

  assert.deepEqual(requests, [{ action: 'inspect-batch-cafe24-registration' }]);
  assert.equal(preflight.schema, 'factory-cafe24-preflight:v1');
  assert.equal(preflight.productId, 'cafe24:2994');
  assert.equal(preflight.htmlDigest, 'canonical-html');
});

test('batch worker routes a versioned workfile hydration order only through the registered command bridge', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const calls = [];
  const order = {
    orderId: 'workfile-hydrate-001',
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
    batchId: 'batch-001',
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    currentRunId: 'factory_work_run_mrw3euf3_elu0dd',
    stageId: 'workfile-hydration',
    operationToken: 'workfile-hydration:001',
    idempotencyKey: 'workfile:b363c06c',
    expectedWorkfileRevision: 3,
    command: {
      kind: 'factory-workfile',
      version: 'factory-workfile-hydration-command:v1',
      name: 'hydrateFactoryWorkfile',
      payload: {
        contractVersion: 'factory-workfile-hydration-command:v1',
        capabilityVersion: 'factory-workfile-hydration-command:v1',
        fileName: 'gpt가한방울수저집 (8).kuasangse',
        workfileText: '{"format":"kuasangse.factory.project"}',
        expectedSha256: 'b363c06ce83373807f76a4323b35da4212eb6b8a3f5a77c7520acb18a13189d2',
        expectedWorkspaceId: 'project_mrx0tgw5_mrzrpg',
        expectedProductId: 'cafe24:2994',
        expectedProductKey: '방울수저집',
        expectedRunId: 'factory_work_run_mrw3euf3_elu0dd',
        expectedInputFingerprint: 'fingerprint-001',
        expectedWorkfileRevision: 3,
        idempotencyKey: 'workfile:b363c06c',
      },
    },
  };
  const responses = [];
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    workerSessionId: 'session-001',
    commandBridge: { run: async () => ({}) },
    projectionBridge: {
      async run(...args) {
        calls.push(args);
        return { schema: 'factory-workfile-hydration-receipt:v1' };
      },
    },
    fetchImpl: async (url, options = {}) => {
      const endpoint = new URL(url).pathname;
      responses.push({ endpoint, body: options.body ? JSON.parse(options.body) : null });
      return {
        ok: true,
        status: 200,
        json: async () => endpoint === '/api/session'
          ? { sessionId: 'http-session', csrfToken: 'csrf-001' }
          : endpoint === '/api/worker/claim'
            ? { order }
            : { accepted: true },
      };
    },
  });

  await worker.start();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'factory-workfile');
  assert.equal(calls[0][1], 'hydrateFactoryWorkfile');
  assert.equal(calls[0][2].expectedWorkspaceId, 'project_mrx0tgw5_mrzrpg');
  const claims = responses.filter(item => item.endpoint === '/api/worker/claim');
  assert.equal(claims.length, 1);
  assert.equal(claims[0].body.sessionId, 'session-001');
});

test('factory control bridge binds hydrated workfile receipt to the exact public projection', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'factory-control-command-bridge.mjs')));
  const payload = {
    contractVersion: 'factory-workfile-hydration-command:v1',
    capabilityVersion: 'factory-workfile-hydration-command:v1',
    fileName: 'target.kuasangse',
    workfileText: '{"target":2994}',
    expectedSha256: 'b'.repeat(64),
    expectedWorkspaceId: 'project-target',
    expectedProductId: 'cafe24:2994',
    expectedProductKey: '방울수저집',
    expectedRunId: 'run-target',
    expectedInputFingerprint: 'fingerprint-target',
    expectedWorkfileRevision: 3,
    idempotencyKey: 'workfile:target',
  };
  const beforeProjection = {
    schema: 'factory-control-projection:v1',
    connected: true,
    session: { revision: 3 },
  };
  const projection = {
    schema: 'factory-control-projection:v1',
    connected: true,
    session: {
      workspaceId: 'project-target',
      productId: 'cafe24:2994',
      productKey: '방울수저집',
      runId: 'run-target',
      inputFingerprint: 'fingerprint-target',
      revision: 10,
    },
  };
  let hydrated = false;
  const bridge = module.createFactoryControlCommandBridge({
    requestClassicRuntime: async () => hydrated ? projection : beforeProjection,
    hydrateWorkfile: async () => {
      hydrated = true;
      return {
        schema: 'factory-workfile-hydration-receipt:v1',
        capabilityVersion: 'factory-workfile-hydration-command:v1',
        workfileSha256: 'b'.repeat(64),
        projectId: 'project-target',
        name: '방울수저집',
      };
    },
  });
  const order = {
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    currentRunId: 'run-target',
    expectedWorkfileRevision: 3,
    idempotencyKey: 'workfile:target',
  };

  const receipt = await bridge.run('factory-workfile', 'hydrateFactoryWorkfile', payload, order);

  assert.equal(receipt.projection.session.productId, 'cafe24:2994');
  assert.equal(receipt.projection.session.revision, 10);
  await assert.rejects(
    bridge.run('factory-workfile', 'hydrateFactoryWorkfile', {
      ...payload,
      expectedProductId: 'cafe24:594',
    }, order),
    error => error.code === 'factory_workfile_identity_mismatch',
  );
});

test('batch worker polling keeps claiming after idle without overlapping starts', async () => {
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'modules', 'batch-control-worker.mjs')));
  const timers = [];
  let claimCount = 0;
  const worker = module.createBatchControlWorker({
    workerId: 'worker-001',
    commandBridge: { run: async () => ({}) },
    fetchImpl: async url => ({
      ok: true,
      status: 200,
      json: async () => new URL(url).pathname === '/api/session'
        ? { sessionId: 'session-001', csrfToken: 'csrf-001' }
        : new URL(url).pathname === '/api/worker/claim'
          ? (claimCount += 1, { order: null })
          : { accepted: true },
    }),
    setIntervalImpl: callback => (timers.push(callback), timers.length),
    clearIntervalImpl() {},
  });

  const stop = worker.startPolling(25);
  await new Promise(resolve => setImmediate(resolve));
  await timers[0]();
  stop();

  assert.ok(claimCount >= 2);
});
