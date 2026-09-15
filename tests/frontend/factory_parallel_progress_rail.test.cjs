'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

test('비동기 factory 명령 중 일반 render도 진행 중 draft를 읽어 대기 화면으로 되돌아가지 않는다', async () => {
  const core = source('src/app-core-03.js');
  const ownershipSource = sourceSlice(
    core,
    'var factoryRuntimeOwnedRenderDraft = null;',
    'function factoryRuntimeNormalizeFactorySnapshot(',
  );
  const committed = { goalRun: { running: false, progress: 0 } };
  const context = vm.createContext({
    render: () => undefined,
    factoryRuntimeStore: { getSnapshot: () => ({ factory: committed }) },
    factoryRuntimeBootstrapFactory: null,
    state: { factory: committed },
  });
  vm.runInContext(`${ownershipSource}\nthis.runtime = {\n    readFactory: factoryRuntimeReadFactory,\n    renderWithOwnedDraft: factoryRuntimeRenderWithOwnedDraft,\n  };`, context);

  const running = { goalRun: { running: true, progress: 62 } };
  let finish;
  const transaction = context.runtime.renderWithOwnedDraft(
    running,
    () => new Promise(resolve => { finish = resolve; }),
  );

  assert.strictEqual(
    context.runtime.readFactory(),
    running,
    '비동기 명령이 끝나기 전인데 committed 대기 snapshot을 읽었습니다.',
  );
  finish('done');
  await transaction;
  assert.strictEqual(context.runtime.readFactory(), committed);
});

test('겹쳐 실행된 factory 명령이 진행 중 화면을 대기 snapshot으로 바꾸거나 종료된 draft를 되살리지 않는다', async () => {
  const core = source('src/app-core-03.js');
  const ownershipSource = sourceSlice(
    core,
    'var factoryRuntimeOwnedRenderDraft = null;',
    'function factoryRuntimeNormalizeFactorySnapshot(',
  );
  const committed = { id: 'committed', goalRun: { running: false, progress: 0 } };
  const context = vm.createContext({
    render: () => undefined,
    factoryRuntimeStore: { getSnapshot: () => ({ factory: committed }) },
    factoryRuntimeBootstrapFactory: null,
    state: { factory: committed },
  });
  vm.runInContext(`${ownershipSource}\nthis.runtime = {\n    readFactory: factoryRuntimeReadFactory,\n    renderWithOwnedDraft: factoryRuntimeRenderWithOwnedDraft,\n  };`, context);

  const running = { id: 'running', goalRun: { running: true, progress: 66 } };
  const staleIdle = { id: 'stale-idle', goalRun: { running: false, progress: 0 } };
  let finishRunning;
  let finishStaleIdle;
  const runningTransaction = context.runtime.renderWithOwnedDraft(
    running,
    () => new Promise(resolve => { finishRunning = resolve; }),
  );
  const staleIdleTransaction = context.runtime.renderWithOwnedDraft(
    staleIdle,
    () => new Promise(resolve => { finishStaleIdle = resolve; }),
  );

  assert.strictEqual(
    context.runtime.readFactory(),
    running,
    '먼저 시작해 실행 중인 66% draft 대신 뒤늦은 0% 대기 draft가 화면 소유권을 빼앗았습니다.',
  );

  finishRunning('running-done');
  await runningTransaction;
  assert.strictEqual(context.runtime.readFactory(), staleIdle);
  finishStaleIdle('idle-done');
  await staleIdleTransaction;
  assert.strictEqual(
    context.runtime.readFactory(),
    committed,
    '모든 명령이 끝났는데 종료된 이전 draft가 다시 화면 소유권을 얻었습니다.',
  );
});

test('조립공장 메뉴 shell도 진행 중 owned draft snapshot을 사용한다', () => {
  const core = source('src/app-core-03.js');
  const installSource = sourceSlice(
    core,
    'function installFactoryRuntimeStart(',
    'var factoryEnsureRequiredLocalServices = async () => true;',
  );

  assert.match(
    installSource,
    /runtimeMenuModules\.set\('factory',[\s\S]*getSnapshot:\s*factoryRuntimeReadViewSnapshot/,
    '조립공장 메뉴 shell이 owned draft를 우회하고 committed 대기 snapshot을 직접 읽습니다.',
  );
});

test('조립공장 메뉴 render는 select 이후 committed snapshot을 다시 읽지 않는다', async () => {
  const moduleUrl = `${pathToFileURL(path.join(ROOT, 'src/menus/factory/factory-menu.mjs')).href}?owned-view=${Date.now()}`;
  const { createFactoryMenu } = await import(moduleUrl);
  const tabIds = ['start', 'db', 'fields', 'competitor', 'assets', 'sections', 'publish'];
  const tabs = new Map(tabIds.map((shortId, order) => {
    const id = `factory/${shortId}`;
    return [id, Object.freeze({
      version: 'factory-tab:v1',
      id,
      select: snapshot => snapshot,
      render: () => '',
      bind: () => () => {},
      onEnter: () => {},
      onLeave: () => {},
    })];
  }));
  const tabRegistry = Object.freeze(tabIds.map((shortId, order) => Object.freeze({
    id: `factory/${shortId}`,
    kind: 'factory-tab',
    order,
    api: 'factory-tab:v1',
  })));
  const committedIdle = Object.freeze({ factory: Object.freeze({
    automation: Object.freeze({ activeTab: 'db' }),
    goalRun: Object.freeze({ running: false, progress: 0 }),
  }) });
  const activeRunning = Object.freeze({ factory: Object.freeze({
    automation: Object.freeze({ activeTab: 'db' }),
    goalRun: Object.freeze({ running: true, progress: 66 }),
  }) });
  const menu = createFactoryMenu({
    getSnapshot: () => committedIdle,
    assertMutable: () => true,
    getOperationToken: () => Object.freeze({ revision: 0 }),
    isOperationCurrent: () => true,
    reportError: error => error,
    actions: Object.freeze({
      selectFactoryTab: () => true,
      jumpFactoryStage: () => true,
      setFactoryStageLogFilter: () => true,
      runFactoryShellGuideAction: () => true,
    }),
    renderHelpers: Object.freeze({
      renderFactoryAutomationRunStatus: factory => `<output data-progress="${factory.goalRun?.progress || 0}"></output>`,
      renderFactoryWorkspacePanel: () => '',
    }),
    tabs,
    tabRegistry,
  });

  const markup = menu.render(menu.select(activeRunning));
  assert.match(
    markup,
    /data-progress="66"/,
    'select가 받은 66% owned snapshot 대신 render가 committed 0% snapshot을 다시 읽었습니다.',
  );
});

test('조립공장 1~7 공정표는 다섯 병렬 작업의 실제 진행 게이지를 노출한다', () => {
  const ui = source('src/app-core-05.js');
  const runtime = source('src/app-core-06.js');
  const overview = sourceSlice(ui, 'function renderFactoryStageProgress(', 'function renderFactoryStageLogBoard(');
  const progressWriter = sourceSlice(runtime, 'function factorySetParallelTaskProgress(', 'function factoryStageGoalProgressRange(');

  for (const taskId of ['sinhwa', 'cafe24', 'vm', 'hero', 'cuts']) {
    assert.match(ui, new RegExp(`id: '${taskId}'`), `${taskId} 진행 게이지 정의가 없습니다.`);
  }
  assert.match(overview, /data-factory-stage-progress=/);
  assert.match(overview, /data-factory-parallel-task=/);
  assert.match(overview, /aria-valuenow=/);
  assert.match(progressWriter, /factoryPatchGoalRunStatusInPlace/);
  assert.match(progressWriter, /parallelProgress/);
});

test('VM 공유폴더 브리지의 플랫폼 진행상태가 조립공장 VM 게이지에 반영된다', () => {
  const runtime = source('src/app-core-06.js');
  const bridge = sourceSlice(
    runtime,
    'async function compMarketTryVmCandidateBridgeSearch(',
    'async function compMarketTryV1Search(',
  );
  const oneClickVm = sourceSlice(
    runtime,
    'async function factoryRunVmCompetitorCollectionForSelection(',
    'async function factoryRunHeroAndCutsForOneClick(',
  );

  assert.match(oneClickVm, /runCompMarketScrape\('vm',[\s\S]*factory/);
  assert.match(bridge, /factorySetParallelTaskProgress\('vm'/);
  assert.match(bridge, /progress\.message/);
  assert.match(bridge, /elapsed_seconds/);
  const pollLoop = bridge.slice(bridge.indexOf('for (let index = 0;'), bridge.indexOf('const finalState'));
  assert.doesNotMatch(pollLoop, /compMarketSetStatus\(/, '1.5초 폴링마다 전체 저장을 유발하면 안 됩니다.');
});

test('공정 진행표와 로그는 내부 높이 제한 없이 앱의 오른쪽 주 스크롤을 사용한다', () => {
  const html = source('app.html');
  assert.match(html, /\.app\{[^}]*overflow-y:auto/);
  assert.match(html, /\.factory-run-status-rail\{[^}]*position:relative[^}]*top:auto/);
  assert.match(html, /\.factory-run-status-card\{[^}]*max-height:none[^}]*overflow:visible/);
  assert.match(html, /\.factory-run-status-card \[data-factory-goal-log-list\]\{[^}]*max-height:none[^}]*overflow:visible/);
  assert.doesNotMatch(html, /\.factory-run-status-card\{[^}]*overflow-y:auto/);
});
