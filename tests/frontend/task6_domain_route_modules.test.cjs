const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const BUNDLE = path.join(ROOT, 'dist', 'app-runtime.bundle.js');

const TASK6_MENU_SOURCES = [
  'sections-menu.mjs',
  'sections-menu-view.mjs',
  'sections-menu-cards-view.mjs',
  'preview-menu.mjs',
  'preview-menu-view.mjs',
  'competitor-menu.mjs',
  'competitor-menu-view.mjs',
  'competitor-menu-report-view.mjs',
  'competitor-menu-plan-view.mjs',
];

const ROUTES = [
  { id: 'upload', file: 'upload-menu.mjs', factory: 'createUploadMenu', owner: 'product-analysis', actions: ['startAnalysis'] },
  { id: 'analyzing', file: 'analysis-menu.mjs', factory: 'createAnalysisMenu', owner: 'product-analysis', actions: ['stopAnalysis'] },
  { id: 'sections', file: 'sections-menu.mjs', factory: 'createSectionsMenu', owner: 'detail-document', actions: ['generateAll', 'generateSection', 'navigate'] },
  { id: 'generating', file: 'generating-menu.mjs', factory: 'createGeneratingMenu', owner: 'detail-document', actions: ['stopAfterCurrent'] },
  { id: 'preview', file: 'preview-menu.mjs', factory: 'createPreviewMenu', owner: 'detail-document', actions: ['setViewport', 'navigate', 'startGenerating'] },
  { id: 'competitor', file: 'competitor-menu.mjs', factory: 'createCompetitorMenu', owner: 'competitors', actions: ['startAnalysis'] },
];

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function helperProxy() {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'SECTION_BASIS_MODES' || property === 'SECTION_GENERATION_MODES') return [];
      return () => '';
    },
  });
}

function createCapabilities(spec, options = {}) {
  const snapshot = Object.freeze({ route: spec.id });
  const calls = [];
  let operationToken = 'workspace-a:fence-1';
  const actions = Object.fromEntries(spec.actions.map(name => [name, (value, context) => {
    calls.push({ name, value, context });
    if (options.deferred && name === spec.actions[0]) return options.deferred.promise;
    return { name, value };
  }]));
  return {
    value: {
      getSnapshot: () => snapshot,
      assertMutable() {
        if (options.readOnly) throw new Error('READ_ONLY');
      },
      getOperationToken: () => operationToken,
      reportError() {},
      actions,
      renderHelpers: helperProxy(),
    },
    snapshot,
    calls,
    setOperationToken(value) {
      operationToken = value;
    },
  };
}

function emptyRoot() {
  return {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function populatedRoot({ single = {}, multiple = {} } = {}) {
  return {
    querySelector(selector) { return single[selector] || null; },
    querySelectorAll(selector) { return multiple[selector] || []; },
  };
}

function clickable(dataset = {}) {
  const original = () => 'original-handler';
  return { dataset, onclick: original, original };
}

function pureLoc(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter(line => line.trim() && !line.trim().startsWith('//'))
    .length;
}

test('Task 6 여섯 route는 allowlist export와 독립 menu:v1 계약을 제공한다', async () => {
  for (const spec of ROUTES) {
    const modulePath = path.join(ROOT, 'src', 'menus', spec.file);
    const namespace = await import(pathToFileURL(modulePath).href + `?task6=${Date.now()}-${spec.id}`);
    assert.deepEqual(Object.keys(namespace), [spec.factory], spec.id);
    const capabilities = createCapabilities(spec);
    const menu = namespace[spec.factory](capabilities.value);
    assert.equal(menu.id, spec.id);
    assert.deepEqual([...menu.routes], [spec.id]);
    assert.deepEqual([...menu.ownedSlices], [spec.owner]);
    assert.strictEqual(menu.select({ forbiddenRawRoot: true }), capabilities.snapshot, `${spec.id}: raw root state를 받지 않는다`);
    assert.deepEqual(Object.keys(menu.commands), spec.actions);
    assert.deepEqual([...menu.persistence.reads], [spec.owner]);
    assert.deepEqual([...menu.persistence.writes], [spec.owner]);
  }
});

test('Task 6 route bind/onEnter/onLeave 50회는 핸들러 잔존 없이 정리된다', async () => {
  for (const spec of ROUTES) {
    const namespace = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', spec.file)).href);
    const menu = namespace[spec.factory](createCapabilities(spec).value);
    const root = emptyRoot();
    for (let index = 0; index < 50; index += 1) {
      menu.onEnter();
      const dispose = menu.bind(root);
      dispose();
      dispose();
      menu.onLeave();
    }
  }
});

test('Task 6 route binder는 소유 명령만 연결하고 복제 cross-route selector는 건드리지 않는다', async () => {
  const event = { preventDefault() {}, stopPropagation() {} };

  const sectionsSpec = ROUTES.find(spec => spec.id === 'sections');
  const sectionsNamespace = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', sectionsSpec.file)).href);
  const sectionsCapabilities = createCapabilities(sectionsSpec);
  const sectionsMenu = sectionsNamespace[sectionsSpec.factory](sectionsCapabilities.value);
  const generateAll = clickable();
  const navigate = clickable({ routeTarget: 'preview' });
  const generateSection = clickable({ generateSection: 'hero' });
  const foreignViewport = clickable({ previewViewport: 'mobile' });
  const foreignStart = clickable();
  const disposeSections = sectionsMenu.bind(populatedRoot({ multiple: {
    '#generateAll,#generateAll2': [generateAll],
    '[data-route-target]': [navigate],
    '[data-generate-section]': [generateSection],
    '[data-preview-viewport]': [foreignViewport],
    '[data-start-generating]': [foreignStart],
  } }));
  assert.strictEqual(foreignViewport.onclick, foreignViewport.original);
  assert.strictEqual(foreignStart.onclick, foreignStart.original);
  generateAll.onclick(event);
  navigate.onclick(event);
  generateSection.onclick(event);
  assert.deepEqual(sectionsCapabilities.calls.map(call => call.name), ['generateAll', 'navigate', 'generateSection']);
  disposeSections();
  disposeSections();
  for (const node of [generateAll, navigate, generateSection, foreignViewport, foreignStart]) {
    assert.strictEqual(node.onclick, node.original);
  }

  const previewSpec = ROUTES.find(spec => spec.id === 'preview');
  const previewNamespace = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', previewSpec.file)).href);
  const previewCapabilities = createCapabilities(previewSpec);
  const previewMenu = previewNamespace[previewSpec.factory](previewCapabilities.value);
  const previewNavigate = clickable({ routeTarget: 'sections' });
  const viewport = clickable({ previewViewport: 'mobile' });
  const startGenerating = clickable();
  const foreignGenerateSection = clickable({ generateSection: 'hero' });
  const disposePreview = previewMenu.bind(populatedRoot({ multiple: {
    '[data-route-target]': [previewNavigate],
    '[data-generate-section]': [foreignGenerateSection],
    '[data-preview-viewport]': [viewport],
    '[data-start-generating]': [startGenerating],
  } }));
  assert.strictEqual(foreignGenerateSection.onclick, foreignGenerateSection.original);
  previewNavigate.onclick(event);
  viewport.onclick(event);
  startGenerating.onclick(event);
  assert.deepEqual(previewCapabilities.calls.map(call => call.name), ['navigate', 'setViewport', 'startGenerating']);
  disposePreview();
  for (const node of [previewNavigate, viewport, startGenerating, foreignGenerateSection]) {
    assert.strictEqual(node.onclick, node.original);
  }

  const competitorSpec = ROUTES.find(spec => spec.id === 'competitor');
  const competitorNamespace = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', competitorSpec.file)).href);
  const competitorCapabilities = createCapabilities(competitorSpec);
  const competitorMenu = competitorNamespace[competitorSpec.factory](competitorCapabilities.value);
  const analyze = clickable();
  const foreignNodes = {
    '[data-route-target]': [clickable({ routeTarget: 'sections' })],
    '[data-generate-section]': [clickable({ generateSection: 'hero' })],
    '[data-preview-viewport]': [clickable({ previewViewport: 'mobile' })],
    '[data-start-generating]': [clickable()],
  };
  const disposeCompetitor = competitorMenu.bind(populatedRoot({
    single: { '#compStartAnalyze': analyze },
    multiple: foreignNodes,
  }));
  for (const nodes of Object.values(foreignNodes)) assert.strictEqual(nodes[0].onclick, nodes[0].original);
  analyze.onclick(event);
  assert.deepEqual(competitorCapabilities.calls.map(call => call.name), ['startAnalysis']);
  disposeCompetitor();
  assert.strictEqual(analyze.onclick, analyze.original);
  for (const nodes of Object.values(foreignNodes)) assert.strictEqual(nodes[0].onclick, nodes[0].original);
});

test('Task 6 메뉴 controller/view/fragment ESM은 각각 250 pure LOC 이하이다', () => {
  for (const file of TASK6_MENU_SOURCES) {
    const modulePath = path.join(ROOT, 'src', 'menus', file);
    assert.ok(fs.existsSync(modulePath), `${file}: 분리 모듈이 존재해야 한다`);
    assert.ok(pureLoc(source(modulePath)) <= 250, `${file}: ${pureLoc(source(modulePath))} pure LOC`);
  }
});

test('Task 6 route 명령은 읽기 전용 권한에서 실제 action 전에 거부된다', async () => {
  for (const spec of ROUTES) {
    const namespace = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', spec.file)).href);
    const capabilities = createCapabilities(spec, { readOnly: true });
    const menu = namespace[spec.factory](capabilities.value);
    assert.throws(() => menu.invoke(spec.actions[0], 'blocked'), /READ_ONLY/, spec.id);
    assert.equal(capabilities.calls.length, 0, spec.id);
  }
});

test('Task 6 비동기 route 명령은 작업공간 fence가 바뀐 뒤 완료값을 승인하지 않는다', async () => {
  for (const spec of ROUTES) {
    let resolve;
    const deferred = {
      promise: new Promise(done => { resolve = done; }),
    };
    const namespace = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', spec.file)).href);
    const capabilities = createCapabilities(spec, { deferred });
    const menu = namespace[spec.factory](capabilities.value);
    const pending = menu.invoke(spec.actions[0], 'pending');
    capabilities.setOperationToken('workspace-b:fence-2');
    resolve('foreign-result');
    await assert.rejects(pending, /STALE_MENU_OPERATION/, spec.id);
  }
});

test('Task 6 route 구현은 classic 전역과 중복 렌더 구현에 의존하지 않는다', () => {
  const classic = source(CORE_05);
  const bundle = source(BUNDLE);
  const app = source(CORE_03);
  const classicNames = [
    'renderUpload',
    'renderAnalyzing',
    'renderSections',
    'renderGenerating',
    'renderPreview',
    'renderCompetitorStep',
  ];
  for (const name of classicNames) {
    assert.doesNotMatch(classic, new RegExp(`function\\s+${name}\\s*\\(`), name);
    assert.doesNotMatch(bundle, new RegExp(`function\\s+${name}\\s*\\(`), name);
  }
  for (const spec of ROUTES) {
    const moduleText = source(path.join(ROOT, 'src', 'menus', spec.file));
    assert.doesNotMatch(moduleText, /\b(?:window|globalThis|document|localStorage|sessionStorage|state)\s*(?=\?*\.|\[)/, spec.id);
  }
  const renderStart = app.indexOf('const render = function render()');
  const renderEnd = app.indexOf('function getCurrentStepLabel(', renderStart);
  assert.notEqual(renderStart, -1, 'generic classic render boundary exists');
  assert.notEqual(renderEnd, -1, 'generic classic render boundary is complete');
  const renderBlock = app.slice(renderStart, renderEnd);
  assert.match(app, /const\s+registry\s*=\s*createRuntimeMenuRegistryAdapter\(runtimeMenuModules\)/);
  assert.match(app, /render\s*:\s*renderRuntimeMenuActivation/);
  assert.match(renderBlock, /runtimeMenuModules\.get\(state\.step\)/);
  assert.match(renderBlock, /renderActiveRuntimeMenu\(menu\)/);
  assert.doesNotMatch(renderBlock, /state\.step\s*===/);
  assert.doesNotMatch(renderBlock, /renderRuntimeMenu\s*\(/);
});

test('Task 6 route view는 렌더 중 상세 이미지 배치를 동기화하지 않는다', () => {
  for (const file of ['preview-menu-view.mjs', 'sections-menu-view.mjs']) {
    const moduleText = source(path.join(ROOT, 'src', 'menus', file));
    assert.doesNotMatch(moduleText, /syncFixedSectionPlacementImages\s*\(\s*\{/,
      `${file}: 렌더 함수 안에서 상태를 변경하는 배치 동기화를 호출하지 않는다`);
  }
});

test('Task 6 외부/LLM 텍스트는 innerHTML sink에 들어가기 전에 이스케이프된다', () => {
  const competitor = source(path.join(ROOT, 'src', 'menus', 'competitor-menu-view.mjs'));
  const report = source(path.join(ROOT, 'src', 'menus', 'competitor-menu-report-view.mjs'));
  assert.match(competitor, /<textarea[\s\S]*\$\{escapeHtml\(cp\.htmlText/);
  assert.doesNotMatch(report, /\$\{r\.overall_strategy\s*\|\|\s*'-'\}/);
  assert.doesNotMatch(report, /\$\{ps\.verdict\}/);
  assert.doesNotMatch(report, /\$\{p\}<\/div>/);
  assert.doesNotMatch(report, /\$\{s\}<\/div>/);
});

test('Task 6 제품 분석의 경쟁사 검색 catch는 stale fence를 완료 처리하지 않는다', () => {
  const analysis = source(CORE_06);
  assert.match(analysis, /catch\s*\(e\)\s*\{\s*if\s*\(!runtimeOperationContextIsCurrent\(operationContext\)\)\s*throw\s+e;\s*state\.competitorData\s*=\s*null;/s);
});
