const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');

function importModule(file) {
  const url = pathToFileURL(path.join(ROOT, 'src', 'menus', file)).href;
  return import(`${url}?task7-ai-repair=${Date.now()}-${Math.random()}`);
}

class FakeNode {
  constructor(id, { value = '', dataset = {}, tagName = 'BUTTON' } = {}) {
    this.id = id;
    this.dataset = { ...dataset };
    this.value = value;
    this.tagName = tagName;
    this.disabled = false;
    this.listeners = new Map();
    this.parentNode = null;
    this.children = [];
    this.style = {};
    this.textContent = '';
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.clientWidth = 320;
    this.clientHeight = 240;
  }

  append(child) { child.parentNode = this; this.children.push(child); return child; }

  addEventListener(type, listener) {
    const bucket = this.listeners.get(type) || new Set();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type, listener) {
    const bucket = this.listeners.get(type);
    bucket?.delete(listener);
    if (!bucket?.size) this.listeners.delete(type);
  }

  dispatch(type, extra = {}) {
    const event = { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  closest(selector) {
    if (selector === `#${this.id}`) return this;
    return this.parentNode?.closest(selector) || null;
  }

  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
}

class FakeCanvas extends FakeNode {
  constructor() {
    super('repairMaskCanvas', { tagName: 'CANVAS' });
    this.width = 0;
    this.height = 0;
    this.context = {
      lineCap: '', lineJoin: '', globalCompositeOperation: '', strokeStyle: '', fillStyle: '', lineWidth: 0,
      strokeCount: 0, fillCount: 0, clearCount: 0,
      clearRect: () => { this.context.clearCount += 1; },
      beginPath() {}, moveTo() {}, lineTo() {},
      stroke: () => { this.context.strokeCount += 1; },
      arc() {}, fill: () => { this.context.fillCount += 1; },
      drawImage: () => { this.context.drawCount = (this.context.drawCount || 0) + 1; },
    };
    this.pointerCaptures = new Set();
    this.serial = 0;
  }

  getContext() { return this.context; }
  toDataURL() { this.serial += 1; return `mask-${this.serial}`; }
  setPointerCapture(id) { this.pointerCaptures.add(id); }
  releasePointerCapture(id) { this.pointerCaptures.delete(id); }
}

class FakeImage extends FakeNode {
  constructor() { super('restored-mask-image', { tagName: 'IMG' }); this.onload = null; this.src = ''; }
}

function fakeRoot({ open = true, maskDataUrl = '', brushSize = 48, sectionId = 'hero' } = {}) {
  const root = new FakeNode('root', { tagName: 'DIV' });
  const overlay = root.append(new FakeNode('aiRepairOverlay'));
  const close = root.append(new FakeNode('closeAiRepair'));
  const mode = root.append(new FakeNode('repairMode', { value: 'spot', tagName: 'SELECT' }));
  const prompt = root.append(new FakeNode('repairPrompt', { value: '', tagName: 'TEXTAREA' }));
  const model = root.append(new FakeNode('repairModel', { value: 'gpt-image-1', tagName: 'SELECT' }));
  const brush = root.append(new FakeNode('repairBrushSize', { value: String(brushSize), tagName: 'INPUT' }));
  const rangeRow = root.append(new FakeNode('range-row', { tagName: 'DIV' }));
  rangeRow.append(new FakeNode('brushLabel', { tagName: 'B' }));
  brush.parentNode = rangeRow;
  const clear = root.append(new FakeNode('repairClearMask'));
  const undoMask = root.append(new FakeNode('repairUndoMask'));
  const undoEdit = root.append(new FakeNode('repairUndoLastEdit'));
  const run = root.append(new FakeNode('runAiRepair'));
  const image = root.append(new FakeImage());
  image.naturalWidth = 640; image.naturalHeight = 480; image.complete = true;
  const canvas = root.append(new FakeCanvas());
  root.nodes = { overlay, close, mode, prompt, model, brush, clear, undoMask, undoEdit, run, image, canvas };
  root.contains = node => node?.parentNode === root || node === root;
  root.querySelector = selector => {
    const selectors = {
      '#aiRepairOverlay': overlay, '#closeAiRepair': close, '#repairMode': mode, '#repairPrompt': prompt,
      '#repairModel': model, '#repairBrushSize': brush, '#repairClearMask': clear, '#repairUndoMask': undoMask,
      '#repairUndoLastEdit': undoEdit, '#runAiRepair': run, '#repairSourceImage': image, '#repairMaskCanvas': canvas,
    };
    if (selector === '.range-row') return rangeRow;
    if (selector === 'b') return rangeRow.children[0];
    return selectors[selector] || null;
  };
  root.querySelectorAll = selector => selector.split(',').map(value => root.querySelector(value.trim())).filter(Boolean);
  root.snapshot = { aiRepair: { open, sectionId, brushSize, maskDataUrl, busy: false } };
  return root;
}

function capabilities(root, calls, token = 'workspace:a:fence:1') {
  const actions = {
    updateAiRepairField(value) { calls.push(['field', value]); },
    persistAiRepairMask(value) { calls.push(['mask', value]); },
    closeAiRepair() { calls.push(['close']); },
    undoAiRepair(value) { calls.push(['undo', value]); },
    runAiRepair(value, context) { calls.push(['run', value, context]); },
  };
  return {
    getSnapshot: () => root.snapshot,
    getOperationToken: () => token,
    actions,
    callAction(name, value, context) {
      const action = actions[name];
      return action?.(value, context);
    },
    createImage: () => new FakeImage(),
    setTimeout: (fn, delay) => { const handle = setTimeout(fn, delay); return handle; },
    clearTimeout: handle => clearTimeout(handle),
    reportError(error) { calls.push(['error', error.message]); },
  };
}

test('RED: AI repair helper module exists and owns closed/open modal behavior', async () => {
  const helper = await importModule('preview-ai-repair-events.mjs');
  assert.equal(typeof helper.createPreviewAiRepairEvents, 'function');
  const closed = fakeRoot({ open: false });
  const calls = [];
  const events = helper.createPreviewAiRepairEvents(capabilities(closed, calls));
  const closedDispose = events.bind(closed, () => true);
  closed.nodes.close.dispatch('click');
  assert.deepEqual(calls, []);
  closedDispose();
  assert.equal(closed.listeners.size, 0);
});

test('RED: AI repair fields/buttons/canvas preserve behavior and disposer fences stale work', async () => {
  const helper = await importModule('preview-ai-repair-events.mjs');
  const root = fakeRoot();
  const calls = [];
  const events = helper.createPreviewAiRepairEvents(capabilities(root, calls));
  const dispose = events.bind(root, () => true);
  root.nodes.mode.value = 'replace'; root.nodes.mode.dispatch('change');
  root.nodes.prompt.value = '흰 꽃'; root.nodes.prompt.dispatch('input');
  root.nodes.model.value = 'gpt-image-1'; root.nodes.model.dispatch('change');
  root.nodes.brush.value = '72'; root.nodes.brush.dispatch('input');
  root.nodes.canvas.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
  root.nodes.canvas.dispatch('pointermove', { pointerId: 1, clientX: 80, clientY: 80 });
  root.nodes.canvas.dispatch('pointerup', { pointerId: 1 });
  root.nodes.clear.dispatch('click');
  root.nodes.undoMask.dispatch('click');
  root.nodes.undoEdit.dispatch('click');
  root.nodes.run.dispatch('click');
  assert.equal(root.nodes.canvas.context.strokeCount > 0, true);
  assert.equal(root.nodes.canvas.pointerCaptures.size, 0);
  assert.equal(calls.some(([kind]) => kind === 'field'), true);
  assert.equal(calls.some(([kind]) => kind === 'mask'), true);
  assert.deepEqual(calls.filter(([kind]) => kind === 'undo')[0], ['undo', 'hero']);
  assert.equal(calls.some(([kind]) => kind === 'run'), true);
  const before = calls.length;
  dispose();
  root.nodes.prompt.value = 'stale'; root.nodes.prompt.dispatch('input');
  root.nodes.canvas.dispatch('pointerdown', { button: 0, pointerId: 2, clientX: 4, clientY: 4 });
  assert.equal(calls.length, before);
  assert.equal(root.nodes.canvas.listeners.size, 0);
  assert.equal(root.nodes.image.onload, null);
});

test('RED: preview menu wires AI repair actions through injected capabilities', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-menu.mjs'), 'utf8');
  assert.match(source, /preview-ai-repair-events\.mjs/);
  assert.match(source, /createPreviewAiRepairEvents/);
  assert.match(source, /aiRepairEvents\.bind/);
  // runAiRepair 액션은 추출된 헬퍼가 소유한다(이 파일이 검증하는 분리의 목적이다).
  // 메뉴는 위임만 하므로 액션 이름은 계약과 헬퍼에서 확인한다.
  const contract = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-menu-contract.mjs'), 'utf8');
  assert.match(contract, /'runAiRepair'/);
  const events = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-ai-repair-events.mjs'), 'utf8');
  assert.match(events, /call\('runAiRepair'/);
});

test('RED: AI repair helper fences workspace revision and keeps global state/persistence out of ESM', async () => {
  const helper = await importModule('preview-ai-repair-events.mjs');
  const source = fs.readFileSync(path.join(ROOT, 'src', 'menus', 'preview-ai-repair-events.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:window|document|localStorage|sessionStorage|state)\b/);
  const root = fakeRoot();
  const calls = [];
  const token = { value: 'workspace:a:fence:1' };
  const events = helper.createPreviewAiRepairEvents({
    ...capabilities(root, calls),
    getOperationToken: () => token.value,
  });
  const dispose = events.bind(root, () => true);
  token.value = 'workspace:a:fence:2';
  root.nodes.prompt.value = 'stale';
  root.nodes.prompt.dispatch('input');
  root.nodes.canvas.dispatch('pointerdown', { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
  assert.deepEqual(calls, []);
  dispose();
});

test('RED: classic AI repair binder/canvas ownership is removed and capability seam is explicit', () => {
  const core05 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
  const core03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  assert.doesNotMatch(core05, /bindAiRepairEvents\s*\(/);
  assert.doesNotMatch(core05, /initAiRepairCanvas\s*\(/);
  assert.match(core03, /updateAiRepairField/);
  assert.match(core03, /persistAiRepairMask/);
  assert.match(core03, /runAiRepair\([^)]*operationContext/);
});
