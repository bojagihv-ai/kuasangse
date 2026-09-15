'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-06.js'), 'utf8');
function sourceSlice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}
const original = sourceSlice('function factoryOpenAssetPreview(', 'function factoryAutomationCustomCutPrompts(')
  + sourceSlice('function factoryConfirmAssetFromPreview(', 'function factoryCutPromptListForStage(');

function preview(previewOnly = false) {
  let overlay = null;
  const nodes = new Map();
  const listeners = new Map();
  const calls = { confirmed: [], sent: [] };
  const assets = Array.from({ length: 4 }, (_, index) => ({
    id: `hero-${index + 1}`, stageId: 'hero', image: 'fixture-image', used: index === 0, previewOnly,
  }));
  const document = {
    getElementById: id => id === 'factoryAssetPreviewOverlay' ? overlay : nodes.get(id),
    createElement: () => ({ innerHTML: '', remove() { if (overlay === this) overlay = null; } }),
    body: { appendChild(value) {
      overlay = value;
      nodes.clear();
      for (const [, id] of value.innerHTML.matchAll(/<button[^>]*\bid="([^"]+)"/g)) {
        nodes.set(id, {
          id, handlers: new Map(),
          closest(selector) { assert.equal(selector, 'button'); return this; },
          addEventListener(type, handler) { this.handlers.set(type, handler); },
          setAttribute() {},
        });
      }
    } },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type); },
  };
  const context = vm.createContext({
    document,
    factoryRuntimeReadFactory: () => ({ assets }),
    factoryPreviewOnlySizeAssets: () => previewOnly ? assets : [],
    factoryPreviewableAssetImage: asset => asset.image,
    factoryStageLabel: () => '대표',
    escapeHtml: value => String(value ?? ''), escAttr: value => String(value ?? ''),
    factoryConfirmAssetUse: (id, options) => {
      assert.equal(options.skipRender, true);
      calls.confirmed.push(id);
      return true;
    },
    factorySendAssetToStage: (id, stage) => calls.sent.push({ id, stage }),
    factoryLog() {}, render() {},
  });
  vm.runInContext(original, context);
  context.factoryOpenAssetPreview('hero-1');
  return {
    calls, assets,
    button: suffix => nodes.get(`factoryAssetPreview${suffix}`),
    markup: () => overlay?.innerHTML || '',
    key(key, target = {}) {
      const event = { key, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      listeners.get('keydown')?.(event);
      return event;
    },
    click: button => button.handlers.get('click')(),
  };
}

test('PREVIEW-ENTER-01: 미리보기 버튼과 자식의 Enter는 확정 단축키가 가로채지 않는다', () => {
  for (const suffix of ['Next', 'Prev', 'Close', 'SendSize', 'SendCuts', 'Confirm']) {
    for (const child of [false, true]) {
      const page = preview();
      const before = JSON.stringify(page.assets);
      const button = page.button(suffix);
      const target = child ? { closest(selector) { assert.equal(selector, 'button'); return button; } } : button;
      const event = page.key('Enter', target);
      assert.equal(event.defaultPrevented, false, `${suffix}${child ? ' child' : ''}: native activation must remain uncancelled`);
      assert.deepEqual(page.calls.confirmed, [], 'document keydown must not confirm a focused button');
      // VM has no native default actions; check the separately registered original click handler.
      page.click(button);
      assert.deepEqual(page.calls.confirmed, suffix === 'Confirm' ? ['hero-1'] : []);
      assert.deepEqual(page.calls.sent, suffix.startsWith('Send') ? [{ id: 'hero-1', stage: suffix === 'SendSize' ? 'size' : 'cuts' }] : []);
      if (suffix === 'Next') assert.match(page.markup(), /대표 · 2\/4/);
      if (suffix === 'Prev') assert.match(page.markup(), /대표 · 4\/4/);
      if (suffix === 'Close' || suffix.startsWith('Send')) assert.equal(page.markup(), '');
      assert.equal(JSON.stringify(page.assets), before);
    }
  }
  const bare = preview();
  assert.equal(bare.key('Enter').defaultPrevented, true);
  assert.deepEqual(bare.calls.confirmed, ['hero-1']);
  assert.equal(bare.key('ArrowRight').defaultPrevented, true);
  assert.match(bare.markup(), /대표 · 2\/4/);
  assert.equal(bare.key('ArrowLeft').defaultPrevented, true);
  assert.match(bare.markup(), /대표 · 1\/4/);
  assert.equal(bare.key('Escape').defaultPrevented, true);
  assert.equal(bare.markup(), '');
  const only = preview(true);
  assert.equal(only.key('Enter').defaultPrevented, false);
  assert.equal(only.key('Enter', only.button('Next')).defaultPrevented, false);
  assert.deepEqual(only.calls.confirmed, []);
  assert.equal(only.button('Confirm'), undefined);
});
