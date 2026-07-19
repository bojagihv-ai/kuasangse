const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = require('node:path').resolve(__dirname, '../..');

function moduleUrl(file) {
  return `${pathToFileURL(require('node:path').join(ROOT, file)).href}?task7-image-insert=${Date.now()}-${Math.random()}`;
}

function node(selector, dataset = {}) {
  const listeners = new Map();
  return {
    selector,
    dataset: { ...dataset },
    listeners,
    files: [],
    value: '',
    clickCount: 0,
    rootToken: null,
    closest(candidate) { return candidate === selector ? this : null; },
    click() { this.clickCount += 1; },
  };
}

function rootFor(controls) {
  const nodes = new Map(controls.map(control => [control.selector, node(control.selector, control.dataset)]));
  const rootListeners = new Map();
  const rootToken = {};
  for (const item of nodes.values()) item.rootToken = rootToken;
  return {
    nodes,
    rootListeners,
    contains(item) { return item?.rootToken === rootToken; },
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
    querySelector(selector) { return nodes.get(selector) || null; },
  };
}

function fire(root, selector, type, extra = {}) {
  const target = root.nodes.get(selector);
  const event = { target, preventDefault() {}, stopPropagation() {}, ...extra };
  for (const listener of root.rootListeners.get(type) || []) listener(event);
}

function capabilities(overrides = {}) {
  let token = 'workspace:1';
  const calls = [];
  const actions = Object.fromEntries([
    'closeImageInsert', 'applyImageInsert', 'updateImageInsertFolder', 'loadDetailDriveImages',
    'connectImageInsertDrive', 'useDriveDetailImage', 'useCutDetailImage', 'setImageInsertError', 'requestRender',
  ].map(name => [name, (...args) => calls.push([name, ...args])]));
  return {
    calls,
    actions,
    getSnapshot: () => ({ imageInsert: { open: true } }),
    getOperationToken: () => token,
    setToken(value) { token = value; },
    readImageFileAsDataUrl: async file => `data:${file.name}`,
    reportError: error => calls.push(['reportError', error]),
    ...overrides,
  };
}

test('Task 7 B2C image insert binder owns all nine legacy behaviors through injected capabilities', async () => {
  const { createPreviewImageInsertEvents } = await import(moduleUrl('src/menus/preview-image-insert-events.mjs'));
  const controls = [
    { selector: '#imageInsertOverlay' }, { selector: '#closeImageInsert' },
    { selector: '#pickDetailImageFile' }, { selector: '#detailImageInsertFileInput' },
    { selector: '#detailImageDriveFolderInput' }, { selector: '#loadDetailDriveImages' },
    { selector: '#connectImageInsertDrive' },
    { selector: '[data-use-drive-detail-image]', dataset: { useDriveDetailImage: 'drive-1' } },
    { selector: '[data-use-cut-detail-image]', dataset: { useCutDetailImage: '2' } },
  ];
  const root = rootFor(controls);
  const capability = capabilities();
  const events = createPreviewImageInsertEvents(capability);
  let dispose = events.bind(root, () => true);

  fire(root, '#imageInsertOverlay', 'click');
  dispose = events.bind(root, () => true);
  fire(root, '#closeImageInsert', 'click');
  dispose = events.bind(root, () => true);
  fire(root, '#pickDetailImageFile', 'click');
  root.nodes.get('#detailImageDriveFolderInput').value = 'folder-1';
  fire(root, '#detailImageDriveFolderInput', 'input');
  fire(root, '#loadDetailDriveImages', 'click');
  fire(root, '#connectImageInsertDrive', 'click');
  fire(root, '[data-use-drive-detail-image]', 'click');
  fire(root, '[data-use-cut-detail-image]', 'click');
  const file = { name: 'local.png', type: 'image/png' };
  fire(root, '#detailImageInsertFileInput', 'change', { target: { files: [file] } });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(root.nodes.get('#detailImageInsertFileInput').clickCount, 1);
  assert.deepEqual(capability.calls.map(([name, value]) => [name, value]), [
    ['closeImageInsert', undefined],
    ['closeImageInsert', undefined],
    ['updateImageInsertFolder', 'folder-1'],
    ['loadDetailDriveImages', 'folder-1'],
    ['connectImageInsertDrive', undefined],
    ['useDriveDetailImage', 'drive-1'],
    ['useCutDetailImage', '2'],
    ['applyImageInsert', 'data:local.png'],
  ]);
  dispose();
  assert.equal(root.rootListeners.size, 0);
});

test('Task 7 B2C closed modal gates actions and stale file completion cannot apply or report', async () => {
  const { createPreviewImageInsertEvents } = await import(moduleUrl('src/menus/preview-image-insert-events.mjs'));
  let open = false;
  let resolveRead;
  const capability = capabilities({
    getSnapshot: () => ({ imageInsert: { open } }),
    readImageFileAsDataUrl: () => new Promise(resolve => { resolveRead = resolve; }),
  });
  const root = rootFor([{ selector: '#detailImageInsertFileInput' }]);
  const events = createPreviewImageInsertEvents(capability);
  const dispose = events.bind(root, () => open);
  fire(root, '#detailImageInsertFileInput', 'change', { target: { files: [{ name: 'closed.png', type: 'image/png' }] } });
  assert.deepEqual(capability.calls, []);
  open = true;
  const file = { name: 'late.png', type: 'image/png' };
  fire(root, '#detailImageInsertFileInput', 'change', { target: { files: [file] } });
  dispose();
  resolveRead('data:late');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(capability.calls, []);
  assert.equal(root.rootListeners.size, 0);
});

test('Task 7 B2C Drive list and connect completions are fenced after token change', async () => {
  const { createPreviewImageInsertEvents } = await import(moduleUrl('src/menus/preview-image-insert-events.mjs'));
  const pending = [];
  const capability = capabilities({
    actions: {
      ...capabilities().actions,
      loadDetailDriveImages: (_folder, context) => new Promise(resolve => pending.push({ resolve, context })),
      connectImageInsertDrive: context => new Promise(resolve => pending.push({ resolve, context })),
    },
  });
  const root = rootFor([
    { selector: '#loadDetailDriveImages' }, { selector: '#connectImageInsertDrive' },
  ]);
  const events = createPreviewImageInsertEvents(capability);
  const dispose = events.bind(root, () => true);
  fire(root, '#loadDetailDriveImages', 'click');
  fire(root, '#connectImageInsertDrive', 'click');
  capability.setToken('workspace:2');
  pending.forEach(item => item.resolve(true));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(capability.calls.length, 0);
  dispose();
});

test('Task 7 B2C current file read failures report error and request render', async () => {
  const { createPreviewImageInsertEvents } = await import(moduleUrl('src/menus/preview-image-insert-events.mjs'));
  const capability = capabilities({ readImageFileAsDataUrl: () => Promise.reject(new Error('read failed')) });
  const root = rootFor([{ selector: '#detailImageInsertFileInput' }]);
  const events = createPreviewImageInsertEvents(capability);
  const dispose = events.bind(root, () => true);
  fire(root, '#detailImageInsertFileInput', 'change', { target: { files: [{ name: 'broken.png', type: 'image/png' }] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(capability.calls.map(([name, value]) => [name, value]), [
    ['setImageInsertError', 'read failed'],
    ['requestRender', undefined],
  ]);
  dispose();
});
