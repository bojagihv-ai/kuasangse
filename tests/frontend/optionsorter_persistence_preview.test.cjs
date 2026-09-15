'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const APP_CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const GENERATION_BINDINGS = path.join(ROOT, 'src', 'menus', 'optionsorter-generation-bindings.mjs');
const VIEW = path.join(ROOT, 'src', 'menus', 'optionsorter-view.mjs');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('OPTIONS-RESULT-RELOAD: 보관 아카이브가 가진 누락 결과 레코드도 복원 경로가 유지된다', () => {
  const source = fs.readFileSync(APP_CORE_06, 'utf8');
  const restore = sourceSlice(
    source,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  assert.match(restore, /optionResultId/);
  assert.match(restore, /optionResults\.push/);
  assert.match(restore, /imageUrl/);
  assert.match(restore, /currentRunId/);
});

test('OPTIONS-RESULT-SAVE: 생성 결과 완료 경계에서 비동기 저장을 기다린다', () => {
  const source = fs.readFileSync(APP_CORE_06, 'utf8');
  const generation = sourceSlice(
    source,
    'async function optGenerateOptionImages(',
    '\nfunction optDownloadOptionResult',
  );
  assert.match(generation, /await optPersistGeneratedResultState\(\)/);
});

test('OPTIONS-PREVIEW: 결과 크게 보기 버튼은 직접 미리보기 API를 호출하고 sort 화면에 모달을 포함한다', () => {
  const bindings = fs.readFileSync(GENERATION_BINDINGS, 'utf8');
  assert.match(bindings, /optOpenImagePreview/);
  assert.match(bindings, /optOpenImagePreview\(null, resultId\)/);

  const view = fs.readFileSync(VIEW, 'utf8');
  const sortView = sourceSlice(view, "if (os.subStep === 'sort')", "  // ── 업로드 화면");
  assert.match(sortView, /renderOptionSorterImagePreviewModal\(os\)/);
});

function previewHarness() {
  const core = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
  const option = fs.readFileSync(APP_CORE_06, 'utf8');
  const bindings = fs.readFileSync(path.join(ROOT, 'src/menus/optionsorter-bindings.mjs'), 'utf8');
  const images = fs.readFileSync(path.join(ROOT, 'src/menus/optionsorter-image-bindings.mjs'), 'utf8');
  const frames = [];
  function element(id, html = '') {
    return {
      id, html, children: [], parentElement: null,
      appendChild(node) {
        node.remove();
        node.parentElement = this;
        this.children.push(node);
      },
      remove() {
        if (this.parentElement) {
          this.parentElement.children = this.parentElement.children.filter(node => node !== this);
          this.parentElement = null;
        }
      },
      querySelectorAll(selector) {
        const direct = selector.startsWith(':scope > ');
        const target = direct ? selector.slice(9) : selector;
        return this.children.flatMap(node => [
          ...(target === '#' + node.id ? [node] : []),
          ...(direct ? [] : node.querySelectorAll(selector)),
        ]);
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    };
  }
  const body = element('body');
  const root = element('app');
  body.appendChild(root);
  const state = {
    step: 'optionsorter', currentProjectId: 'same-work',
    factory: { product: { name: '보존 제품' }, selectedIds: ['selected-a'] },
    sectionImages: { hero: '/hero-original.png' }, logs: ['보존 로그'],
    optionSorter: {
      previewImageId: null, previewResultId: null,
      images: [{ id: 'source-a', name: '원본 A', imageUrl: '/source-a.png' }],
      optionResults: ['B', 'C'].map((name, index) => ({
        id: name, order: index + 1, optionName: name, imageUrl: '/' + name + '.png',
      })),
      slots: [{ id: 'slot-a', name: '옵션 A', imgIds: ['source-a'] }], pool: [],
      optionGenProgress: 100, logs: ['생성 완료'],
    },
  };
  let dispose;
  let context;
  const menu = {
    bind() {
      dispose?.();
      dispose = context.bindOptionSorter(root, {
        getSnapshot: () => state, assertMutable() {}, requestRender: () => context.render(),
        reportError(error) { throw error; }, bindHelpers: {},
      });
      return dispose;
    },
    refresh() { this.bind(); }, onEnter() {}, onLeave() {},
  };
  context = vm.createContext({
    state, document: { body, getElementById: id => body.querySelector('#' + id), documentElement: { dataset: {} } },
    runtimeMenuModules: new Map([['optionsorter', menu]]), shellRuntimeComposition: null,
    classicRuntimeHydrationActive: false, classicRuntimeBatchWorkerMode: false,
    classicRuntimeBatchConsoleMode: false, shouldDeferFactoryWizardFullRender: () => context.deferRender,
    ensureWorkfileActionDelegation() {}, bindRenderedWorkfileActionButtons() {}, bindShellAfterRender() {},
    bindOptionSorterLayout() {}, bindOptionSorterGeneration() {}, bindOptionSorterResults() {}, bindOptionSorterSlots() {},
    renderActiveRuntimeMenu: () => state.step === 'optionsorter'
      ? context.renderOptionSorterImagePreviewModal(state.optionSorter) : '',
    renderShellMarkup: html => html,
    patchAppHtml(target, html) {
      for (const child of [...target.children]) child.remove();
      if (!html) return;
      const overlay = element('optImagePreviewOverlay', html);
      overlay.appendChild(element('closeOptImagePreview'));
      target.appendChild(overlay);
    },
    requestAnimationFrame: callback => frames.push(callback),
    factoryOptionSorterResultDisplayImage: result => result.imageUrl,
    escapeHtml: value => String(value || ''), optFormatDateTime: () => '',
    optRenderImageOrPlaceholder: image => '<img src="' + image.imageUrl + '">',
  });
  vm.runInContext([
    sourceSlice(core, 'function renderShellFrame(input)', 'let factoryControlProjectionSequence'),
    sourceSlice(core, 'const render = function render()', 'function getCurrentStepLabel()'),
    sourceSlice(option, 'function optOpenImagePreview(', 'function factoryCompetitorDelegatedMarketPayload'),
    sourceSlice(option, 'function renderOptionSorterImagePreviewModal(', 'function optRenderDetailKv('),
    images.replace('export function', 'function'),
    bindings.slice(bindings.indexOf('const EVENT_PROPERTIES')).replace('export function', 'function'),
    'this.render = render;',
  ].join('\n'), context);
  return {
    context, state, root, body, menu,
    flushFrames() { while (frames.length) frames.shift()(); },
    overlays: () => body.querySelectorAll('#optImagePreviewOverlay'),
    dataSnapshot() {
      const copy = structuredClone(state);
      delete copy.step;
      delete copy.runtimeRenderLastMs;
      delete copy.optionSorter.previewImageId;
      delete copy.optionSorter.previewResultId;
      return copy;
    },
  };
}

test('OPTIONS-PREVIEW-PORTAL: 전체 렌더 뒤 확대창은 하나이며 닫기, B→C, 원본, 화면 이탈이 상태를 보존한다', () => {
  const h = previewHarness();
  const before = h.dataSnapshot();
  h.context.optOpenImagePreview(null, 'B');
  h.flushFrames();
  assert.equal(h.overlays().length, 1);
  for (let index = 0; index < 3; index += 1) {
    h.context.render();
    assert.equal(h.overlays().length, 1, '전체 렌더 직후 옛 body 포털과 새 inline 확대창이 중복되면 안 된다');
    h.flushFrames();
    assert.equal(h.overlays().length, 1);
    assert.equal(h.overlays()[0].parentElement, h.body);
  }
  const current = h.overlays()[0];
  h.context.deferRender = true;
  h.context.render();
  h.flushFrames();
  assert.equal(h.overlays()[0], current, '전체 DOM 갱신을 건너뛴 부분/지연 경로는 포털을 제거하지 않는다');
  h.context.deferRender = false;
  current.querySelector('#closeOptImagePreview').onclick();
  h.flushFrames();
  assert.equal(h.overlays().length, 0, '한 번 닫으면 body 잔존 확대창도 없어야 한다');
  h.context.optOpenImagePreview(null, 'C');
  h.flushFrames();
  assert.equal(h.overlays().length, 1);
  assert.match(h.overlays()[0].html, /02\. C<\/div>/);
  assert.match(h.overlays()[0].html, /src="\/C\.png"/);
  assert.doesNotMatch(h.overlays()[0].html, /src="\/B\.png"/);
  h.context.optOpenImagePreview('source-a');
  h.flushFrames();
  assert.equal(h.overlays().length, 1);
  assert.match(h.overlays()[0].html, /원본 A/);
  assert.match(h.overlays()[0].html, /src="\/source-a\.png"/);
  h.overlays()[0].onclick({ target: h.overlays()[0] });
  h.flushFrames();
  assert.equal(h.overlays().length, 0, '바깥 배경 클릭도 한 번에 닫는다');
  h.context.optOpenImagePreview(null, 'C');
  h.flushFrames();
  h.context.render();
  h.state.step = 'upload';
  h.context.render();
  h.flushFrames();
  assert.equal(h.overlays().length, 0, '화면 이탈 후 지연 rAF도 옛 포털을 되살리지 않는다');
  assert.deepEqual(h.dataSnapshot(), before, 'preview 선택 외 같은 작업의 본문과 데이터는 불변이다');
});

test('OPTIONS-PREVIEW-PORTAL: 메뉴 진입의 마지막 bind 이후 승격되어 닫기 버튼이 살아 있다', async () => {
  const h = previewHarness();
  const { createRenderLifecycleCoordinator } = await import('../../src/shell/render-lifecycle.mjs');
  h.state.optionSorter.previewResultId = 'B';
  const lifecycle = createRenderLifecycleCoordinator({ root: h.root, render: () => h.context.render() });
  await lifecycle.activate({ route: 'optionsorter', menu: h.menu });
  h.flushFrames();
  assert.equal(h.overlays().length, 1);
  assert.equal(h.overlays()[0].parentElement, h.body, 'open 핸들러 없이 메뉴 진입만 해도 현재 모달을 승격한다');
  h.overlays()[0].querySelector('#closeOptImagePreview').onclick();
  h.flushFrames();
  assert.equal(h.overlays().length, 0);
  await lifecycle.dispose();
});
