const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function createFakeElement() {
  return {
    classList: { add() {} },
    dataset: {},
    style: {},
    children: [],
    replaceChildren() {
      this.children = [];
    },
    append(child) {
      this.children.push(child);
    },
  };
}

function installFakeDocument(t) {
  const previousDocument = global.document;
  global.document = { createElement: createFakeElement };
  t.after(() => {
    global.document = previousDocument;
  });
}

test('virtual queue keeps 100 and 200 item models bounded', async () => {
  const module = await import('../../frontend/src/virtual-queue.mjs');
  for (const count of [100, 200]) {
    const model = module.createQueueModel(count);
    assert.equal(model.length, count);
    assert.ok(14 < model.length);
    assert.ok(model.every(item => !String(item.thumbnailRef).startsWith('data:')));
  }
});

test('virtual queue renders API thumbnails as deferred images without raw originals', async t => {
  installFakeDocument(t);
  const module = await import('../../frontend/src/virtual-queue.mjs');
  const items = module.createQueueModel(3, { thumbnailBase: 'http://127.0.0.1:43210/path-is-ignored' });
  const root = createFakeElement();

  module.renderVirtualQueue(root, items, { viewportHeight: 112, overscan: 0 });

  assert.equal(items[0].thumbnailRef, 'http://127.0.0.1:43210/api/assets/thumbnail/queue-product-1.svg');
  assert.match(root.children[1].innerHTML, /<img[^>]*loading="lazy"[^>]*decoding="async"/);
  assert.doesNotMatch(root.children[1].innerHTML, /raw-original|original-content|\/content(?:[/?]|$)/);
});

test('virtual queue keeps a valid tail window when root scroll passes the queue into following content', async t => {
  installFakeDocument(t);
  const module = await import('../../frontend/src/virtual-queue.mjs');
  const root = createFakeElement();
  const items = module.createQueueModel(200);
  const rowHeight = 112;
  const logicalHeight = items.length * rowHeight;

  const result = module.renderVirtualQueue(root, items, {
    rowHeight,
    viewportHeight: 768,
    overscan: 4,
    scrollTop: logicalHeight + 10_000,
  });

  assert.ok(result.rendered > 0, `rendered must stay positive after overshoot, received ${result.rendered}`);
  assert.ok(result.first < items.length, `first must stay within the queue, received ${result.first}`);
  assert.equal(result.last, items.length);
  assert.equal(root.style.rowGap, '0px');
  assert.equal(root.children.at(-2).dataset.productId, 'product-200');
  assert.ok(
    root.children.filter(child => child.className?.includes('virtual-row')).every(child => child.style.blockSize === `${rowHeight}px`),
    'rendered row height must match the logical projection height',
  );
  assert.ok(
    root.children.filter(child => child.className?.includes('virtual-row')).every(child => child.style.marginBlock === '0px'),
    'rendered rows must not add count-dependent margins',
  );
  const spacerHeights = root.children
    .filter(child => child.className === 'virtual-spacer')
    .map(child => Number.parseFloat(child.style.blockSize));
  assert.ok(Math.max(...spacerHeights) <= logicalHeight);
});

test('queue root-scroll projection caps overshoot at logical height without rendered-height feedback', async () => {
  const module = await import('../../frontend/src/virtual-queue.mjs');
  assert.equal(typeof module.getQueueScrollTop, 'function');

  const total = 200;
  const rowHeight = 112;
  const queueOffsetTop = 800;
  const pageScrollTop = queueOffsetTop + (total * rowHeight) + 10_000;
  assert.equal(
    module.getQueueScrollTop(pageScrollTop, queueOffsetTop, total, rowHeight),
    total * rowHeight,
  );
});

test('fixture queue listens to the one main page scrollbar instead of window scroll', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../frontend/control-tower.html'), 'utf8');
  const fixtureScript = html.match(/const fixtureCount =[\s\S]*?__CONTROL_TOWER_QUEUE_METRICS__[\s\S]*?\n\s*}\n\s*<\/script>/)?.[0] || '';

  assert.match(fixtureScript, /const scrollRoot = document\.querySelector\("main\.page"\)/);
  assert.match(fixtureScript, /scrollRoot\.addEventListener\("scroll", render/);
  assert.doesNotMatch(fixtureScript, /window\.addEventListener\("scroll", render/);
});

test('virtual queue fixture rows expose event-shaped progress without rejected planned actions', async () => {
  const module = await import('../../frontend/src/virtual-queue.mjs');
  const model = module.createQueueModel(3);
  const source = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/virtual-queue.mjs'), 'utf8');

  assert.deepEqual(
    Object.keys(model[0].progress).sort(),
    ['elapsedMs', 'mode', 'percent', 'stageKey', 'stageLabel', 'status'],
  );
  assert.doesNotMatch(source, /data-action="open-factory"/);
  assert.doesNotMatch(source, /bridge_planned|연결 예정/);
});
