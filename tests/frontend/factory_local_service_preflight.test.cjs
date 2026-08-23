const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const corePath = path.join(process.cwd(), 'src', 'app-core-06.js');
const core = fs.readFileSync(corePath, 'utf8');
const core03 = fs.readFileSync(path.join(process.cwd(), 'src', 'app-core-03.js'), 'utf8');
const startTab = fs.readFileSync(path.join(process.cwd(), 'src', 'menus', 'factory', 'tabs', 'start-tab.mjs'), 'utf8');
const factoryMenuShell = fs.readFileSync(path.join(process.cwd(), 'src', 'menus', 'factory', 'factory-menu-shell.mjs'), 'utf8');

function sourceSlice(startMarker, endMarker) {
  const start = core.indexOf(startMarker);
  const end = core.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return core.slice(start, end);
}

function immutableClone(value) {
  const clone = JSON.parse(JSON.stringify(value));
  const freeze = current => {
    if (!current || typeof current !== 'object' || Object.isFrozen(current)) return current;
    Object.values(current).forEach(freeze);
    return Object.freeze(current);
  };
  return freeze(clone);
}

test('VM service start requires confirmation when health is unavailable', async () => {
  // Given: the health request fails as it does when JepumScraper is off.
  let startCalls = 0;
  let confirmCalls = 0;
  const sandbox = {
    Error,
    JSON,
    compMarketInvokeV1: async () => { throw new Error('connection refused'); },
    compMarketRunningSearchCountFromHealth: () => null,
    compMarketCreateJepumServiceError: message => new Error(message),
    compMarketNormalizeJepumApiError: () => 'connection refused',
    compMarketShouldAutoStartJepum: () => true,
    compMarketLog: () => {},
    compMarketSetStatus: () => {},
    compMarketStartLocalJepumApi: async () => {
      startCalls += 1;
      return { running: true };
    },
    render: () => {},
    window: {
      confirm: () => {
        confirmCalls += 1;
        return false;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${sourceSlice('async function compMarketEnsureJepumApiReady(', 'function compMarketSetSiteSearchStatus(')}\nthis.run = compMarketEnsureJepumApiReady;`,
    sandbox,
  );

  // When: the user cancels the start confirmation.
  await assert.rejects(sandbox.run(25));

  // Then: the confirmation is shown once and no start request is sent.
  assert.equal(confirmCalls, 1);
  assert.equal(startCalls, 0);
});

test('production-control VM service start reuses its command approval without a hidden confirm', async () => {
  let startCalls = 0;
  let confirmCalls = 0;
  const sandbox = {
    Error,
    JSON,
    JEPUM_MARKET_API: { endpoints: { health: '/health' } },
    compMarketInvokeV1: async () => {
      if (!startCalls) throw new Error('connection refused');
      return { ok: true };
    },
    compMarketRunningSearchCountFromHealth: () => null,
    compMarketCreateJepumServiceError: message => new Error(message),
    compMarketNormalizeJepumApiError: () => 'connection refused',
    compMarketShouldAutoStartJepum: () => true,
    compMarketLog: () => {},
    compMarketSetStatus: () => {},
    compMarketStartLocalJepumApi: async () => {
      startCalls += 1;
      return { running: true };
    },
    render: () => {},
    window: {
      confirm: () => {
        confirmCalls += 1;
        return false;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${sourceSlice('async function compMarketEnsureJepumApiReady(', 'function compMarketSetSiteSearchStatus(')}\nthis.run = compMarketEnsureJepumApiReady;`,
    sandbox,
  );

  const status = await sandbox.run(25, { skipConfirm: true });

  assert.equal(status.ok, true);
  assert.equal(confirmCalls, 0);
  assert.equal(startCalls, 1);
});

test('VM service preflight trusts the backend status used by the shared-folder bridge', async () => {
  // Given: the backend confirms the exact JepumScraper process used by VM candidate collection.
  let directStatusCalls = 0;
  let apiHubCalls = 0;
  const sandbox = {
    Error,
    JSON,
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    fetchJsonWithTimeout: async (url, options) => {
      directStatusCalls += 1;
      assert.equal(url, 'http://127.0.0.1:5050/api/jepum-scraper/status');
      assert.equal(options.method, 'GET');
      return { ok: true, running: true, port: 5012 };
    },
    compMarketInvokeV1: async () => {
      apiHubCalls += 1;
      throw new Error('stale API Hub connector must not gate VM bridge');
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${sourceSlice('async function compMarketEnsureJepumApiReady(', 'function compMarketSetSiteSearchStatus(')}\nthis.run = compMarketEnsureJepumApiReady;`,
    sandbox,
  );

  // When: VM readiness is checked.
  const status = await sandbox.run(25);

  // Then: the bridge-owned backend status is authoritative and API Hub is not queried.
  assert.equal(status.running, true);
  assert.equal(directStatusCalls, 1);
  assert.equal(apiHubCalls, 0);
});

test('factory one-click preflights local services before marking the goal running', () => {
  // Given: the production one-click flow source.
  const flow = sourceSlice(
    'async function factoryRunDbCompetitorHeroCutsFlow(',
    'async function factoryRunDbVmCandidatesOnlyFlow(',
  );

  // When: its service-preflight and running-state statements are located.
  const preflightIndex = flow.indexOf('await factoryEnsureRequiredLocalServices');
  const runningIndex = flow.indexOf('factory.goalRun.running = true');

  // Then: preflight exists and runs before progress/heartbeat state starts.
  assert.ok(preflightIndex >= 0, 'one-click flow must call the local-service preflight');
  assert.ok(preflightIndex < runningIndex, 'local-service preflight must run before goalRun.running');
  assert.match(
    flow,
    /if \(!localServicesReady\) \{\s*factory\.automation\.activeTab = 'start';\s*factoryRuntimeRenderWithOwnedDraft\(factory\);\s*return false;\s*\}/,
    'a blocked or cancelled preflight must keep the user on the start tab',
  );
  assert.match(
    flow,
    /factoryRunVmCompetitorCollectionForSelection\(\{\s*factory,\s*operationToken,\s*skipServicePreflight:\s*true\s*\}\)/,
    'the VM lane must reuse the successful one-click preflight instead of blocking behind the concurrent image analysis request',
  );
});

test('VM scrape can reuse an authoritative outer service preflight', () => {
  const scrape = sourceSlice(
    'async function runCompMarketScrape(',
    'function compMarketDetailOperationUrl(',
  );

  assert.match(scrape, /if \(collectMode === 'vm' && !options\.skipServicePreflight\)/);
});

test('VM candidate search starts and verifies the actual VM before submitting to the shared-folder bridge', () => {
  const scrape = sourceSlice(
    'async function runCompMarketScrape(',
    'function compMarketDetailOperationUrl(',
  );
  const ensureIndex = scrape.indexOf('await compMarketEnsureVmCandidateRuntimeReady(');
  const submitIndex = scrape.indexOf('products = await compMarketTryVmSearch(');

  assert.ok(ensureIndex >= 0, 'VM collection must call the VM runtime autoconnect readiness check');
  assert.ok(submitIndex >= 0, 'VM collection must still submit through the VM bridge');
  assert.ok(ensureIndex < submitIndex, 'the VM must be running and ready before the bridge request is submitted');
});

test('VM runtime readiness asks before startup, opens GUI mode, and rejects a non-ready response', () => {
  const runtimeSlice = sourceSlice(
    'async function compMarketFetchVmCaptureStatus(',
    'async function compMarketEnsureVmDetailCaptureReady(',
  );

  assert.match(runtimeSlice, /async function compMarketEnsureVmCandidateRuntimeReady\(/);
  assert.match(runtimeSlice, /\/api\/vm-capture\/autoconnect/);
  assert.match(runtimeSlice, /window\.confirm\('VM이 꺼져 있습니다\. 켜시겠습니까\?'\)/);
  assert.match(runtimeSlice, /vm_start_mode:\s*'gui'/);
  assert.doesNotMatch(runtimeSlice, /vm_start_mode:\s*'headless'/);
  assert.match(runtimeSlice, /wait_sec:\s*120/);
  assert.match(runtimeSlice, /\},\s*150000\);/, 'the browser timeout must outlast the VM worker wait window');
  assert.match(runtimeSlice, /String\(data\?\.status \|\| ''\)\.toLowerCase\(\) === 'pending'/);
  assert.match(runtimeSlice, /const workerDeadline = Date\.now\(\) \+ 120000/);
  assert.match(runtimeSlice, /await compMarketFetchVmCaptureStatus\(1\)/);
  assert.match(runtimeSlice, /VM 상태 \$\{failedState \|\| '미확인'\}/);
  assert.match(runtimeSlice, /if \(!(?:data|result)\?\.ready\)/);
  assert.doesNotMatch(runtimeSlice, /!stateText \|\| stateText === 'running'/);
  assert.match(runtimeSlice, /stateText === 'running'/);
  assert.match(runtimeSlice, /status\?\.vm_visible \|\| status\?\.vm_status\?\.visible/);
  assert.match(runtimeSlice, /startedVisible/);
  assert.match(runtimeSlice, /if \(!startedVisible\)/);
});

test('VM candidate failure stops without silently running Windows Chrome fallback', () => {
  const scrape = sourceSlice(
    'async function runCompMarketScrape(',
    'function compMarketDetailOperationUrl(',
  );

  assert.match(
    scrape,
    /VM 후보검색 실패[^]*내 Windows Chrome에서 수집을 직접 선택해주세요[^]*return \{ ok: false, collectMode, error: vmSearchFailure \}/,
  );
  assert.match(
    scrape,
    /VM 후보검색 결과가 0건입니다[^]*내 Windows Chrome에서 수집을 직접 선택해주세요[^]*return \{ ok: true, collectMode, productsCount: 0, pickedCount: 0/,
  );
});

test('a fresh VM collection suppresses stale candidate restoration until new rows are persisted', () => {
  const worker = sourceSlice(
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );
  const scrape = sourceSlice(
    'async function runCompMarketScrape(',
    'function compMarketDetailOperationUrl(',
  );

  assert.match(worker, /market\.candidateSnapshotSuppressed = true;/);
  assert.match(scrape, /market\.candidateSnapshotSuppressed = true;/);
  assert.doesNotMatch(worker, /market\.candidateSnapshotSuppressed = false;/);
  assert.doesNotMatch(
    scrape.slice(0, scrape.indexOf('try {', scrape.indexOf('market.candidateSnapshotSuppressed'))),
    /market\.candidateSnapshotSuppressed = false;/,
  );
});

test('explicit VM collection choice holds a lease and runs the VM path regardless of factory batch count', () => {
  const start = core03.indexOf('function factoryRuntimeCompetitorMarketAction(');
  const end = core03.indexOf('function factoryRuntimeCompetitorHelpers(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const action = core03.slice(start, end);
  const vmStart = action.slice(
    action.indexOf("if (type === 'quick-action' && quickAction === 'start-vm')"),
    action.indexOf("if (type === 'analyze-images')"),
  );

  assert.match(vmStart, /factoryRuntimeWithOperationLease\(/);
  assert.match(vmStart, /factoryRunVmCompetitorCollectionForSelection\(\{[^]*forceCollect: true/);
  assert.match(vmStart, /skipConfirm: payload\.skipConfirm === true/);
  assert.doesNotMatch(vmStart, /runCompMarketScrape\('local'\)/);
});

test('factory collection choice guide actions keep VM and Windows Chrome paths separate', () => {
  const start = core03.indexOf('function factoryRuntimeCompetitorGuideAction(');
  const end = core03.indexOf('function factoryRuntimeCompetitorMarketAction(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const guide = core03.slice(start, end);
  const vmGuide = guide.slice(
    guide.indexOf("if (action === 'rerun-vm-competitors')"),
    guide.indexOf("if (action === 'rerun-local-competitors')"),
  );

  assert.match(vmGuide, /factoryRuntimeWithOperationLease\(/);
  assert.match(vmGuide, /factoryRunVmCompetitorCollectionForSelection\(\{/);
  assert.match(guide, /rerun-local-competitors[^]*runCompMarketScrape\('local'\)/);
  assert.doesNotMatch(vmGuide, /runCompMarketScrape\('local'\)/);
});

test('VM collection guide command can update the competitor page draft', () => {
  const policyStart = core03.indexOf('function factoryRuntimeCreateCommandPolicies(');
  const policyEnd = core03.indexOf('const FACTORY_RUNTIME_COMMAND_POLICIES', policyStart);
  assert.notEqual(policyStart, -1);
  assert.notEqual(policyEnd, -1);
  const policy = core03.slice(policyStart, policyEnd);
  const actionIndex = policy.indexOf("'factory/competitor:guide:rerun-vm-competitors'");
  assert.notEqual(actionIndex, -1);
  const ruleStart = policy.lastIndexOf('add([', actionIndex);
  const ruleEnd = policy.indexOf(');', actionIndex);
  assert.notEqual(ruleStart, -1);
  assert.notEqual(ruleEnd, -1);
  const rule = policy.slice(ruleStart, ruleEnd + 2);

  assert.match(rule, /part\('competitors', \['compPage'\]\)/);
  assert.match(rule, /,\s*'competitors'\s*\);/);
});

test('factory shell forwards collection choices when the active tab binding is stale', () => {
  const start = core03.indexOf('function runFactoryShellGuideAction(');
  const end = core03.indexOf('function factoryRuntimeStartActions(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const shellGuide = core03.slice(start, end);

  assert.match(shellGuide, /value === 'rerun-vm-competitors' \|\| value === 'rerun-local-competitors'/);
  assert.match(shellGuide, /factoryRuntimeCompetitorTab\.invoke\('guideAction', value\)/);
  assert.match(shellGuide, /factoryRuntimeCompetitorGuideAction\(value\)/);
  assert.match(factoryMenuShell, /'rerun-vm-competitors'/);
  assert.match(factoryMenuShell, /'rerun-local-competitors'/);
});

test('classic capture listener leaves factory competitor collection choices to the tab contract', () => {
  const start = core.indexOf('function handleCompMarketQuickActionClick(');
  const end = core.indexOf('function bindClassicRuntimeDocumentEvents(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = core.slice(start, end);

  assert.match(handler, /data-factory-competitor-tab/);
  assert.doesNotMatch(handler, /data-factory-guide-action/);
  assert.doesNotMatch(handler, /runFactoryShellGuideAction/);
});

test('fresh VM collection replaces stale search identity and grouped results', () => {
  const start = core.indexOf('async function factoryRunVmCompetitorCollectionForSelection(');
  const end = core.indexOf('async function factoryRunHeroAndCutsForOneClick(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = core.slice(start, end);

  assert.match(handler, /updated\.searchId = preservedSearchId;/);
  assert.match(handler, /updated\.vmSearchId = preservedSearchId;/);
  // 신선한 그룹핑은 상수로 추출됐다. 조건 없이 새로 계산해 vm/전체 양쪽에 넣는지를 본다.
  assert.match(handler, /const freshGroupedResults = typeof compMarketGroupProducts === 'function'/);
  assert.match(handler, /groupedResults: freshGroupedResults,\s*vmGroupedResults: freshGroupedResults,/);
  assert.doesNotMatch(handler, /updated\.searchId = updated\.searchId \|\| preservedSearchId/);
  assert.doesNotMatch(handler, /if \(!updated\.groupedResults \|\|[^]*?updated\.groupedResults = typeof compMarketGroupProducts/);
  assert.doesNotMatch(handler, /factoryRunMarketplaceAssistedCandidateFallback/);
});

test('candidate finalization promotes the fresh VM row identity over stale market state', () => {
  const start = core.indexOf('function compMarketFinalizeResults(');
  const end = core.indexOf('function compMarketDataUrlParts(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const finalize = core.slice(start, end);

  assert.match(finalize, /const freshResultSearchId = results/);
  assert.match(finalize, /market\.searchId = freshResultSearchId;/);
  assert.match(finalize, /if \(market\.collectMode === 'vm'\)/);
  assert.match(finalize, /market\.vmSearchId = results/);
  assert.match(finalize, /\|\| freshResultSearchId;/);
});

test('factory one-click starts analysis, DB, VM, hero, and cuts in the same task batch', () => {
  // Given: the production one-click flow source.
  const flow = sourceSlice(
    'async function factoryRunDbCompetitorHeroCutsFlow(',
    'async function factoryRunDbVmCandidatesOnlyFlow(',
  );
  const tasks = flow.slice(flow.indexOf('const tasks = ['), flow.indexOf('const results = await Promise.allSettled(tasks)'));

  // When: the task batch is inspected.
  const labels = [...tasks.matchAll(/startTask\('([^']+)'/g)].map(match => match[1]);
  const delayedStarts = [...tasks.matchAll(/startTask\([^\n]+,\s*(\d+)\)/g)].map(match => Number(match[1]));

  // Then: all four required operations are in one batch without staged delays.
  assert.deepEqual(labels, [
    '현재 이미지 AI 분석',
    'DB 후보 수집',
    'VM 경쟁사 후보 수집',
    '대표이미지·이미지컷 생성',
  ]);
  assert.deepEqual(delayedStarts, [0, 0, 0, 0]);
  assert.equal(flow.slice(0, flow.indexOf('const tasks = [')).includes('await factoryEnsureCurrentProductImageAnalysisForOneClick'), false);
});

test('factory start offers a Cafe24-only route and forwards its source mode', () => {
  // Given: the start-tab surface and one-click orchestration source.
  const flow = sourceSlice(
    'async function factoryRunDbCompetitorHeroCutsFlow(',
    'async function factoryRunDbVmCandidatesOnlyFlow(',
  );

  // Then: the visible fallback route is explicit and the orchestration consumes it.
  assert.match(startTab, /data-factory-guide-action="run-cafe24-only"/);
  assert.match(startTab, /카페24만 수집/);
  assert.match(startTab, /sourceMode:\s*actionName === 'run-cafe24-only' \? 'cafe24-only' : 'all'/);
  assert.match(flow, /requestedSourceMode/);
  assert.match(flow, /cafe24Only:\s*sourceMode === 'cafe24-only'/);
});

test('local-service preflight starts stopped services only after one confirmation', async () => {
  // Given: three stopped local services and an accepting user.
  const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'modules', 'local-service-preflight.mjs')).href}?case=start`;
  const { ensureRequiredLocalServices } = await import(moduleUrl);
  const startTabModuleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'menus', 'factory', 'tabs', 'start-tab.mjs')).href}?case=preflight-render`;
  const { createStartFactoryTab } = await import(startTabModuleUrl);
  const calls = [];
  const renderedStates = [];
  let confirmCalls = 0;
  const factory = { automation: { activeTab: 'start' }, product: {}, assets: [] };
  const startTabRuntime = createStartFactoryTab({
    getSnapshot: () => immutableClone({ factory }),
    assertMutable: () => true,
    getOperationToken: () => Object.freeze({ revision: 1 }),
    isOperationCurrent: () => true,
    reportError: () => {},
    actions: {},
    renderHelpers: {},
  });
  const runtime = {
    fetchJsonWithTimeout: async (url, options) => {
      calls.push({ url: String(url), method: options.method, contentType: options.headers?.['Content-Type'] });
      return options.method === 'POST' ? { running: true } : { running: false, portConflict: false };
    },
    window: {
      confirm: () => {
        confirmCalls += 1;
        return true;
      },
      alert: () => assert.fail('successful starts must not alert'),
    },
    factoryLog: () => {},
    render: () => {},
    renderFactoryDraft: draft => {
      const state = draft.automation.localServicePreflight.state;
      const html = startTabRuntime.render(startTabRuntime.select());
      assert.match(html, new RegExp(`data-factory-local-service-preflight="${state}"`));
      assert.equal(draft.automation.activeTab, 'start');
      renderedStates.push(state);
    },
  };

  // When: preflight runs.
  const ready = await ensureRequiredLocalServices(factory, runtime);

  // Then: one prompt precedes three starts and the workflow may continue.
  assert.equal(ready, true);
  assert.equal(confirmCalls, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 3);
  assert.equal(calls.filter(call => call.method === 'GET').every(call => call.contentType === undefined), true);
  assert.deepEqual(renderedStates, ['checking', 'starting', 'ready']);
});

test('local-service preflight never launches into a wrong-service port conflict', async () => {
  // Given: Cafe24 port is open but owned by another program.
  const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'modules', 'local-service-preflight.mjs')).href}?case=conflict`;
  const { ensureRequiredLocalServices } = await import(moduleUrl);
  let startCalls = 0;
  let confirmCalls = 0;
  let alertCalls = 0;
  const runtime = {
    fetchJsonWithTimeout: async (url, options) => {
      if (options.method === 'POST') startCalls += 1;
      return String(url).includes('cafe24-control')
        ? { running: false, portConflict: true, port: 8787 }
        : { running: true, portConflict: false };
    },
    window: {
      confirm: () => {
        confirmCalls += 1;
        return true;
      },
      alert: () => { alertCalls += 1; },
    },
    factoryLog: () => {},
    render: () => {},
  };

  // When: preflight runs.
  const ready = await ensureRequiredLocalServices({}, runtime);

  // Then: it reports immediately without confirmation, launch, or polling.
  assert.equal(ready, false);
  assert.equal(confirmCalls, 0);
  assert.equal(startCalls, 0);
  assert.equal(alertCalls, 1);
});

test('Cafe24-only preflight does not check or launch Sinhwa DB', async () => {
  // Given: only Cafe24 and the VM collector are required for the fallback route.
  const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'modules', 'local-service-preflight.mjs')).href}?case=cafe24-only`;
  const { ensureRequiredLocalServices } = await import(moduleUrl);
  const calls = [];
  const runtime = {
    fetchJsonWithTimeout: async (url, options) => {
      calls.push({ url: String(url), method: options.method });
      return { running: true, portConflict: false };
    },
    window: { confirm: () => assert.fail('ready services must not prompt'), alert: () => assert.fail('ready services must not alert') },
    factoryLog: () => {},
    render: () => {},
  };

  // When: the Cafe24-only route performs its preflight.
  const ready = await ensureRequiredLocalServices({}, runtime, { serviceIds: ['cafe24', 'jepum'], sourceMode: 'cafe24-only' });

  // Then: Sinhwa DB is completely outside this route.
  assert.equal(ready, true);
  assert.equal(calls.some(call => call.url.includes('sinhwa-db')), false);
  assert.equal(calls.filter(call => call.method === 'GET').length, 2);
  assert.equal(calls.filter(call => call.method === 'POST').length, 0);
});

test('failed Sinhwa start can continue as Cafe24-only without blocking other lanes', async () => {
  // Given: Cafe24 and VM are ready, but Sinhwa DB cannot finish starting.
  const moduleUrl = `${pathToFileURL(path.join(process.cwd(), 'src', 'modules', 'local-service-preflight.mjs')).href}?case=sinhwa-fallback`;
  const { ensureRequiredLocalServices } = await import(moduleUrl);
  const prompts = [];
  const runtime = {
    fetchJsonWithTimeout: async (url, options) => {
      const target = String(url);
      if (options.method === 'GET') return { running: !target.includes('sinhwa-db'), portConflict: false };
      return target.includes('sinhwa-db')
        ? { running: false, message: '신화사DB 실행 확인 실패' }
        : { running: true };
    },
    window: {
      confirm: message => { prompts.push(String(message)); return true; },
      alert: () => assert.fail('accepted Cafe24-only fallback must not alert'),
    },
    factoryLog: () => {},
    render: () => {},
  };

  // When: the user accepts both the start attempt and the Cafe24-only fallback.
  const ready = await ensureRequiredLocalServices({}, runtime);

  // Then: orchestration receives an explicit fallback mode instead of a hard stop.
  assert.deepEqual(ready, { ready: true, sourceMode: 'cafe24-only' });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /카페24만 수집/);
});
