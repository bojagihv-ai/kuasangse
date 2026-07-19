const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');

function importHelper() {
  const url = pathToFileURL(path.join(ROOT, 'src', 'menus', 'preview-layer-events.mjs')).href;
  return import(`${url}?task7-preview-layer=${Date.now()}-${Math.random()}`);
}

function makeNode(selector, dataset = {}) {
  const listeners = new Map();
  return {
    selector,
    dataset: { ...dataset },
    listeners,
    style: {},
    value: '',
    tagName: 'DIV',
    rootToken: null,
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture(id) { if (this.captured === id) this.captured = null; },
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = listeners.get(type);
      bucket?.delete(listener);
      if (!bucket?.size) listeners.delete(type);
    },
    closest(candidate) { return candidate === selector ? this : null; },
  };
}

function makeRoot(nodes) {
  const rootListeners = new Map();
  const rootToken = {};
  const map = new Map(nodes.map(item => [item.selector, item]));
  for (const node of nodes) node.rootToken = rootToken;
  return {
    nodes: map,
    rootListeners,
    contains(node) { return node?.rootToken === rootToken; },
    querySelector(selector) { return map.get(selector) || null; },
    querySelectorAll(selector) {
      if (selector.includes(',')) return selector.split(',').map(value => map.get(value.trim())).filter(Boolean);
      return map.has(selector) ? [map.get(selector)] : [];
    },
    addEventListener(type, listener) {
      const bucket = rootListeners.get(type) || new Set();
      bucket.add(listener);
      rootListeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = rootListeners.get(type);
      bucket?.delete(listener);
      if (!bucket?.size) rootListeners.delete(type);
    },
  };
}

function makeDocument() {
  const listeners = new Map();
  return {
    activeElement: { tagName: 'DIV' },
    listeners,
    addEventListener(type, listener) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      const bucket = listeners.get(type);
      bucket?.delete(listener);
      if (!bucket?.size) listeners.delete(type);
    },
  };
}

function fire(target, type, event = {}, root = null) {
  const payload = { target, currentTarget: target, preventDefault() {}, stopPropagation() {}, ...event };
  for (const listener of target?.listeners?.get(type) || []) listener(payload);
  for (const listener of root?.rootListeners?.get(type) || []) listener(payload);
  return payload;
}

test('RED: preview layer helper owns all controls through capabilities and disposes root/document/sortable', async () => {
  const helper = await importHelper();
  assert.equal(typeof helper.createPreviewLayerEvents, 'function');

  const undo = makeNode('#editorUndoBtn');
  const undoTop = makeNode('#editorUndoTopBtn');
  const redo = makeNode('#editorRedoBtn');
  const redoTop = makeNode('#editorRedoTopBtn');
  const tone = makeNode('[data-tone-preset]', { tonePreset: 'warm' });
  const resetOrder = makeNode('#resetPreviewOrder');
  const sortable = makeNode('#previewOutlineSortable');
  const layer = makeNode('[data-layer-select]', { layerSelect: 'hero:headline' });
  const prop = makeNode('[data-layer-prop]', { layerProp: 'hero:headline:x' });
  const domLayer = makeNode('[data-layer-section][data-layer-id]', { layerSection: 'hero', layerId: 'headline' });
  const root = makeRoot([undo, undoTop, redo, redoTop, tone, resetOrder, sortable, layer, prop, domLayer]);
  const documentRef = makeDocument();
  const calls = [];
  const sortableInstance = { destroy() { calls.push(['sortable-destroy']); } };
  const sortableApi = { create(_node, options) { calls.push(['sortable-create', options]); return sortableInstance; } };
  const helperInstance = helper.createPreviewLayerEvents({
    getSnapshot: () => ({ previewLayerMode: true, activePreviewLayer: { sectionId: 'hero', layerId: 'headline' } }),
    getOperationToken: () => 'workspace:1',
    getDocument: () => documentRef,
    getSortable: () => sortableApi,
    getLayerEdit: () => ({ x: 0, y: 0, scale: 1 }),
    actions: Object.fromEntries([
      'undoEditorChange', 'redoEditorChange', 'applyTonePreset', 'resetPreviewOrder',
      'beginPreviewOrderChange', 'updatePreviewOrder', 'selectPreviewLayer', 'beginLayerEdit',
      'updateLayerEdit', 'resetLayerEdit', 'resetLayerSection', 'nudgeLayer', 'commitLayerDrag',
    ].map(name => [name, value => calls.push([name, value])])),
  });
  const dispose = helperInstance.bind(root, () => true);

  fire(undo, 'click', {}, root); fire(undoTop, 'click', {}, root);
  fire(redo, 'click', {}, root); fire(redoTop, 'click', {}, root);
  fire(tone, 'click', {}, root); fire(layer, 'click', {}, root);
  fire(prop, 'focus', {}, root); fire(prop, 'pointerdown', { button: 0 }, root);
  prop.value = '12'; fire(prop, 'input', {}, root); fire(prop, 'blur', {}, root);
  fire(domLayer, 'pointerdown', { button: 0, pointerId: 1, clientX: 0, clientY: 0 }, root);
  fire(domLayer, 'pointermove', { pointerId: 1, clientX: 5, clientY: 6 }, root);
  fire(domLayer, 'pointerup', { pointerId: 1 }, root);
  const keydown = [...documentRef.listeners.get('keydown')][0];
  keydown({ key: 'ArrowRight', shiftKey: true, preventDefault() {} });
  dispose();
  assert.equal(root.rootListeners.size, 0);
  assert.equal(documentRef.listeners.size, 0);
  assert.deepEqual(calls.filter(([name]) => name.startsWith('undo') || name.startsWith('redo')).map(([name]) => name), [
    'undoEditorChange', 'undoEditorChange', 'redoEditorChange', 'redoEditorChange',
  ]);
  assert.ok(calls.some(([name]) => name === 'sortable-create'));
  assert.ok(calls.some(([name]) => name === 'sortable-destroy'));
});

test('RED: preview layer source has no classic binder, globals, or document.onkeydown residue', () => {
  const core05 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
  const helper = fs.existsSync(path.join(ROOT, 'src', 'menus', 'preview-layer-events.mjs'))
    ? fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-layer-events.mjs'), 'utf8') : '';
  assert.doesNotMatch(core05, /function bindPreviewLayerEvents\s*\(/);
  assert.doesNotMatch(core05, /bindPreviewLayerEvents\s*\(\)/);
  assert.doesNotMatch(core05, /document\.onkeydown/);
  assert.doesNotMatch(helper, /\b(?:window|document|localStorage|sessionStorage|state)\b/);
});
