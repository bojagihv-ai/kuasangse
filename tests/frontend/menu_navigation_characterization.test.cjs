const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_HTML = path.join(ROOT, 'app.html');
const CORE_02 = path.join(ROOT, 'src', 'app-core-02.js');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const MODULE_REGISTRY = path.join(ROOT, 'src', 'modules', 'module-registry.mjs');
const RENDER_LIFECYCLE = path.join(ROOT, 'src', 'shell', 'render-lifecycle.mjs');
const FACTORY_MENU = path.join(ROOT, 'src', 'menus', 'factory', 'factory-menu.mjs');
const FACTORY_DB_TAB = path.join(ROOT, 'src', 'menus', 'factory', 'tabs', 'db-tab.mjs');

const SIDEBAR = [
  { icon: 'upload_file', label: '이미지 업로드', step: 'upload', always: true },
  { icon: 'analytics', label: 'AI 분석', step: 'analyzing', always: true },
  { icon: 'manage_search', label: '경쟁사 분석', step: 'competitor', always: true },
  { icon: 'dashboard_customize', label: '섹션 설정', step: 'sections', need: 'analysis' },
  { icon: 'auto_fix_high', label: '자동 생성', step: 'generating', need: 'analysis' },
  { icon: 'preview', label: '미리보기', step: 'preview', need: 'preview' },
  { icon: 'auto_awesome', label: '이미지컷 생성', step: 'imagecuts', always: true },
  { icon: 'style', label: '옵션 분류기', step: 'optionsorter', always: true },
  { icon: 'precision_manufacturing', label: '조립공장', step: 'factory', always: true },
  { icon: 'cloud_sync', label: '자동화', step: 'automation', always: true },
  { icon: 'tune', label: '모델 설정', step: 'modelsettings', always: true },
  { icon: 'menu_book', label: '상세페이지 자동화 설명서', step: 'manual', always: true, bottom: true },
];

const FACTORY_TABS = [
  { id: 'start', no: 1, label: '시작', desc: '제품 이미지와 제품명을 넣고 병렬 수집/생성을 시작합니다.' },
  { id: 'db', no: 2, label: 'DB 확정', desc: '신화사DB와 Cafe24 후보 중 맞는 제품을 고릅니다.' },
  { id: 'fields', no: 3, label: '필수값', desc: '상품등록값과 생성에 필요한 사이즈/소재/용도를 검수합니다.' },
  { id: 'competitor', no: 4, label: '경쟁사', desc: 'VM 후보를 선택하고 상세페이지 수집/분석 이미지를 고릅니다.' },
  { id: 'assets', no: 5, label: '생성컷 선택', desc: '대표이미지, 사이즈이미지, 색상옵션, 이미지컷 사용 컷을 확정합니다.' },
  { id: 'sections', no: 6, label: '섹션 생성', desc: 'DB/경쟁사 소스 기준을 확인하고 상세페이지 섹션을 생성합니다.' },
  { id: 'publish', no: 7, label: '전송', desc: '완성 체크 후 Cafe24/마켓플러스 전송 버튼을 누릅니다.' },
];

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function moduleUrl(file) {
  return `${pathToFileURL(file).href}?test=${Date.now()}-${Math.random()}`;
}

function extractFunction(fileSource, functionName) {
  const start = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} 정의를 찾지 못했습니다.`);
  const parameterStart = fileSource.indexOf('(', start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '(') parameterDepth += 1;
    if (fileSource[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const braceStart = fileSource.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} 함수 경계를 찾지 못했습니다.`);
}

function extractArray(fileSource, declaration) {
  const start = fileSource.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} 선언을 찾지 못했습니다.`);
  const arrayStart = fileSource.indexOf('[', start);
  let depth = 0;
  for (let index = arrayStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '[') depth += 1;
    if (fileSource[index] === ']') depth -= 1;
    if (depth === 0) {
      return Function(`"use strict"; return (${fileSource.slice(arrayStart, index + 1)});`)();
    }
  }
  throw new Error(`${declaration} 배열 경계를 찾지 못했습니다.`);
}

test('사이드바는 현재 12개 항목의 순서·라벨·아이콘·선언 gate를 그대로 유지한다', () => {
  const sidebarSource = extractFunction(source(CORE_03), 'renderSidebar');
  const actual = extractArray(sidebarSource, 'const items =');

  assert.equal(actual.length, 12);
  assert.deepEqual(actual, SIDEBAR);
  assert.deepEqual(actual.map(item => item.step), SIDEBAR.map(item => item.step));
  assert.deepEqual(actual.map(item => item.label), SIDEBAR.map(item => item.label));
  assert.match(sidebarSource, /data-nav="\$\{it\.step\}"/);
  assert.match(sidebarSource, /getNavGateInfo\(it\.step\)/);
  assert.match(sidebarSource, /gate\.blocked\?'blocked':''/);
});

test('현재 sidebar gate는 analyzing 안내와 generating 리다이렉트만 적용한다', () => {
  const gateSource = extractFunction(source(CORE_03), 'getNavGateInfo');
  const state = { analysis: null, sectionContents: {} };
  let analysisRunning = false;
  const getGate = Function(
    'state',
    'isProductAnalysisRunning',
    `"use strict"; ${gateSource}; return getNavGateInfo;`,
  )(state, () => analysisRunning);

  for (const step of SIDEBAR.map(item => item.step).filter(step => !['analyzing', 'generating'].includes(step))) {
    assert.deepEqual(getGate(step), { redirect: step, blocked: false, reason: '', note: '' }, step);
  }
  assert.deepEqual(getGate('analyzing'), {
    redirect: 'analyzing',
    blocked: false,
    note: 'AI 분석 종합 화면으로 이동합니다.',
  });
  analysisRunning = true;
  assert.equal(getGate('analyzing').note, '현재 제품 이미지 분석이 진행 중입니다.');

  assert.deepEqual(getGate('generating'), {
    redirect: 'upload',
    blocked: true,
    reason: '자동 생성은 제품 이미지 분석 후 사용할 수 있습니다.',
  });
  state.analysis = { product_name: 'characterization' };
  assert.deepEqual(getGate('generating'), {
    redirect: 'sections',
    blocked: true,
    reason: '자동 생성을 시작하려면 섹션 설정에서 원하는 섹션을 확인한 뒤 생성 버튼을 눌러주세요.',
  });
  state.sectionContents = { hero: '완료' };
  assert.deepEqual(getGate('generating'), {
    redirect: 'preview',
    blocked: false,
    note: '이미 생성된 섹션이 있어 미리보기로 이동했습니다. 다시 만들려면 섹션 설정에서 생성 버튼을 눌러주세요.',
  });
});

test('render는 registry의 12개 ESM route를 단일 lifecycle과 shell frame으로 연결한다', async () => {
  const renderSource = extractFunction(source(CORE_03), 'render');
  const frameSource = extractFunction(source(CORE_03), 'renderShellFrame');
  const shellInstall = extractFunction(source(CORE_03), 'installShellRuntimeComposition');
  const { moduleRegistry } = await import(moduleUrl(MODULE_REGISTRY));
  const descriptors = moduleRegistry.list('sidebar');

  assert.equal(descriptors.length, 12);
  assert.deepEqual(descriptors.map(item => item.id), SIDEBAR.map(item => item.step));
  for (const descriptor of descriptors) {
    assert.match(descriptor.implementation, /^src\/menus\/.+\.mjs$/);
    assert.equal(fs.existsSync(path.join(ROOT, ...descriptor.implementation.split('/'))), true, descriptor.id);
  }
  assert.match(renderSource, /runtimeMenuModules\.get\(state\.step\)/);
  assert.match(renderSource, /shellRuntimeComposition\.routeController\.navigate\([\s\S]*?state\.step/);
  assert.match(renderSource, /renderShellFrame\(\{/);
  assert.doesNotMatch(renderSource, /state\.step\s*===\s*['"]/);
  assert.doesNotMatch(renderSource, /\brenderFactory\s*\(/);
  assert.match(shellInstall, /descriptorRegistry\.list\('sidebar'\)/);
  assert.match(shellInstall, /sidebarDescriptors\.length !== 12/);

  const patchIndex = frameSource.indexOf('patchAppHtml(root, renderShellMarkup');
  const bindIndex = frameSource.indexOf('bindShellAfterRender(root)');
  const hydrateIndex = frameSource.indexOf('scheduleFactoryHydrateLightImages');
  assert.ok(patchIndex > 0 && bindIndex > patchIndex && hydrateIndex > bindIndex);
  assert.equal((frameSource.match(/\bbindShellAfterRender\(root\)/g) || []).length, 1);
});

test('bind lifecycle는 shell navigation을 router에 위임하고 ESM menu disposer를 정확히 정리한다', () => {
  const shellBind = extractFunction(source(CORE_03), 'bindShellAfterRender');
  const lifecycleSource = source(RENDER_LIFECYCLE);
  const activationSource = extractFunction(lifecycleSource, 'performActivation');
  const cleanupSource = extractFunction(lifecycleSource, 'cleanup');

  assert.match(shellBind, /root\.querySelectorAll\('\.sidebar \[data-nav\]'\)/);
  assert.match(shellBind, /shellRuntimeComposition\.routeController\.navigate\(/);
  assert.match(shellBind, /runtimeShellNavigationSnapshot\(\)/);
  assert.doesNotMatch(shellBind, /state\.step\s*=/);
  assert.match(activationSource, /await input\.menu\.onEnter\(\)/);
  assert.match(activationSource, /const disposer = await input\.menu\.bind\(root\)/);
  assert.match(activationSource, /if \(typeof disposer !== 'function'\)/);
  assert.match(activationSource, /record\.disposer = once\(disposer\)/);
  assert.match(cleanupSource, /record\.disposer\?\.\(\)/);
  assert.match(cleanupSource, /return leave\(record\)/);
});

test('조립공장 ESM은 registry의 7개 탭 순서·표시·canonical fallback을 소유한다', async () => {
  const factoryMenuSource = source(FACTORY_MENU);
  const tabs = extractArray(factoryMenuSource, 'const TAB_PRESENTATION =');
  const canonicalSource = extractFunction(factoryMenuSource, 'canonicalTab');
  const canonical = Function(
    'TAB_ALIASES',
    'TAB_PRESENTATION',
    'clean',
    `"use strict"; ${canonicalSource}; return canonicalTab;`,
  )({ materials: 'start', collect: 'db', generate: 'assets' }, tabs, value => String(value ?? '').trim());
  const { moduleRegistry } = await import(moduleUrl(MODULE_REGISTRY));
  const descriptors = moduleRegistry.list('factory-tab');

  assert.deepEqual(tabs, FACTORY_TABS);
  assert.deepEqual(descriptors.map(item => item.id), FACTORY_TABS.map(tab => `factory/${tab.id}`));
  assert.deepEqual(descriptors.map(item => item.order), [0, 1, 2, 3, 4, 5, 6]);
  for (const descriptor of descriptors) {
    assert.equal(fs.existsSync(path.join(ROOT, ...descriptor.implementation.split('/'))), true, descriptor.id);
  }
  assert.equal(canonical('materials'), 'start');
  assert.equal(canonical('collect'), 'db');
  assert.equal(canonical('generate'), 'assets');
  assert.equal(canonical('factory/publish'), 'publish');
  assert.equal(canonical('unknown'), 'start');
  assert.match(factoryMenuSource, /data-factory-auto-tab="\$\{escapeHtml\(tab\.id\)\}"/);
  assert.match(factoryMenuSource, /role="tablist" aria-label="조립공장 자동화 단계"/);
  assert.match(factoryMenuSource, /const tabMarkup = tabFor\(shortId\)\.render\(tabSnapshot\)/);
  assert.match(factoryMenuSource, /const dispose = tab\.bind\(root\)/);
});

test('현재 top workfile strip은 최상단에서 모든 작업파일 명령과 상태를 노출한다', () => {
  const stripSource = extractFunction(source(CORE_02), 'renderGlobalDbSyncStatusStrip');
  const shellMarkupSource = extractFunction(source(CORE_03), 'renderShellMarkup');
  const required = [
    ['blankWorkBtn', '새 작업'],
    ['saveCurrentProjectFileBtn', '현재 상태 저장'],
    ['saveProjectFileAsBtn', '다른 이름으로 저장'],
    ['importProjectFileBtn', '작업파일 불러오기'],
  ];

  assert.match(stripSource, /class="db-workfile-strip" aria-label="DB 동기화와 작업파일"/);
  assert.match(stripSource, /현재 작업파일/);
  assert.match(stripSource, /\.kuasangse/);
  assert.match(stripSource, /renderWorkfileSaveStatus\(\)/);
  assert.match(stripSource, /renderWorkfileBuildLabel\(\)/);
  for (const [id, label] of required) {
    assert.match(stripSource, new RegExp(`id="${id}"[^>]*>${label}<\\/button>`));
  }
  assert.ok(shellMarkupSource.indexOf('<div class="top-command-row">') < shellMarkupSource.indexOf('<div class="container'));
  assert.ok(shellMarkupSource.indexOf('renderGlobalDbSyncStatusStrip') < shellMarkupSource.indexOf('renderApiStatusStrip'));
});

test('작은 창 기준선은 main 우측 세로 스크롤과 반응형 workfile stack을 유지한다', () => {
  const html = source(APP_HTML);
  assert.match(html, /\.app\{display:flex;height:100vh;min-height:100vh;overflow:hidden\}/);
  assert.match(html, /\.main\{flex:1;min-width:0;padding:0 76px 104px 0;overflow-y:auto;scrollbar-gutter:stable(?:;overflow-anchor:none)?\}/);
  assert.match(html, /@media\(max-width:900px\)[\s\S]*?\.main\{padding:0 54px 108px 0\}/);
  assert.match(html, /\.sidebar\{[^}]*overflow-y:auto;overflow-x:hidden(?:;overflow-anchor:none)?\}/);
  assert.match(html, /\.db-workfile-strip\{display:grid;grid-template-columns:/);
  assert.match(html, /\.db-workfile-actions\{[^}]*flex-wrap:wrap/);
  assert.match(html, /@media\(max-height:640px\)[\s\S]*?\.top-command-row\{position:static;display:block\}/);
});

test('한글 작업파일 이름은 음절 중간 분리를 피하면서 긴 무공백 이름도 안전하게 접는다', () => {
  const html = source(APP_HTML);
  assert.match(html, /\.db-workfile-name\{[^}]*overflow-wrap:break-word;word-break:keep-all/);
  assert.match(html, /\.db-workfile-name-base\{[^}]*overflow-wrap:break-word;word-break:keep-all/);
  assert.doesNotMatch(html, /\.db-workfile-name(?:-base)?\{[^}]*overflow-wrap:anywhere/);
});

test('후보 선택 카드는 첫 trusted pointer hit-test 전에 페인트를 생략하지 않는다', () => {
  const html = source(APP_HTML);
  const candidateSource = extractFunction(source(CORE_05), 'renderFactoryCandidateCards');
  const dbTabSource = extractFunction(source(FACTORY_DB_TAB), 'renderDb');
  assert.match(html, /\.factory-candidate-actions\{grid-column:1 \/ -1\}/);
  assert.match(html, /\.factory-automation-panel:has\(\.factory-candidate-panel\)\{content-visibility:visible\}/);
  assert.match(html, /\.factory-candidate-automation-panel\{content-visibility:visible;contain-intrinsic-size:none\}/);
  assert.match(html, /\.factory-candidate-card\{content-visibility:visible\}/);
  assert.match(candidateSource, /class="factory-candidate-actions"/);
  assert.match(dbTabSource, /const review = candidateReview\(factory\)/);
  assert.match(dbTabSource, /class="factory-automation-panel factory-candidate-automation-panel"/);
});

test('사이즈 확인판은 결합 규격을 전체 행에서 줄바꿈해 23cm까지 노출한다', () => {
  const html = source(APP_HTML);
  const reviewSource = extractFunction(source(CORE_05), 'renderFactoryAutomationSizeReviewBox');
  assert.match(reviewSource, /class="factory-size-review-grid"/);
  assert.match(reviewSource, /class="factory-size-review-value"/);
  assert.match(html, /\.factory-size-review-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(160px,100%\),1fr\)\)/);
  assert.match(html, /\[data-factory-size-card="size"\]\{grid-column:1\/-1\}/);
  assert.match(html, /\.factory-size-review-value\{[^}]*white-space:normal;overflow-wrap:break-word;word-break:keep-all/);
});

test('필수값 전송판은 390px 내부 폭보다 큰 고정 최소열을 만들지 않는다', () => {
  const html = source(APP_HTML);
  const transferSource = extractFunction(source(CORE_05), 'renderFactorySelectedFieldTransferPanel');
  assert.match(transferSource, /class="factory-field-transfer-grid"/);
  assert.match(transferSource, /class="factory-field-transfer-target-grid"/);
  assert.match(html, /\.factory-field-transfer-grid\{[^}]*minmax\(min\(210px,100%\),1fr\)/);
  assert.match(html, /\.factory-field-transfer-target-grid\{[^}]*minmax\(min\(260px,100%\),1fr\)/);
});
