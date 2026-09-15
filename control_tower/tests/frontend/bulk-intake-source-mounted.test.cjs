const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { Element } = require('../../../tests/frontend/native_console_dom_fixture.cjs');

const MODULE = pathToFileURL(path.resolve(__dirname, '../../frontend/src/bulk-intake.mjs')).href;
const settle = () => new Promise(resolve => setImmediate(resolve));
const dataKey = key => key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);

class MountedElement extends Element {
  constructor(tag, document) {
    super(tag, document);
    this.style = {};
    this.value = '';
  }
  get firstElementChild() { return this.children[0] || null; }
  append(...nodes) {
    for (const node of nodes) {
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const node of this.children) { node.parent = null; node.parentNode = null; }
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
    this.parentNode = null;
  }
  removeEventListener(name, handler) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== handler));
  }
  focus() { this.document.activeElement = this; }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(item => item.trim());
    return descendants(this).filter(node => selectors.some(part => {
      if (part.startsWith('#')) return node.id === part.slice(1);
      if (part.startsWith('.')) return String(node.className || '').split(' ').includes(part.slice(1));
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);
      if (attribute) {
        const [, name, expected] = attribute;
        const value = name.startsWith('data-') ? node.dataset[dataKey(name.slice(5))] : node.attributes[name];
        return value !== undefined && (expected === undefined || value === expected);
      }
      return node.tagName === part;
    }));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function mountedDocument() {
  const document = {
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    createElement: tag => new MountedElement(tag, document),
  };
  document.body = document.createElement('body');
  document.getElementById = id => document.body.querySelector(`#${id}`);
  return document;
}

test('mounted bulk intake keeps a stale A search out of B and renders current candidate names as literal text', async t => {
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  const document = mountedDocument();
  const root = document.createElement('main');
  root.id = 'bulk-intake';
  document.body.append(root);
  const pending = new Map();
  Object.assign(globalThis, {
    document,
    Element: MountedElement,
    HTMLElement: MountedElement,
    controlTowerRuntime: undefined,
    indexedDB: undefined,
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
  });
  t.after(() => {
    for (const key of ['document', 'Element', 'HTMLElement', 'controlTowerRuntime', 'indexedDB', 'localStorage', 'window']) {
      if (saved[key]) Object.defineProperty(globalThis, key, saved[key]);
      else delete globalThis[key];
    }
  });

  const { mountBulkIntake } = await import(`${MODULE}?mounted-source=${Date.now()}-${Math.random()}`);
  mountBulkIntake({ apiRequest: async () => ({}) }, {
    root,
    intake: {
      definitions: [],
      renderRequiredFields: () => '',
      selectCandidate: async () => ({}),
      searchCandidates: ({ productName }) => new Promise(resolve => pending.set(productName, resolve)),
    },
  });
  await settle();

  const add = async productName => {
    root.querySelector('#bulk-new-product-name').value = productName;
    await root.querySelector('#bulk-add-product').click();
    await settle();
  };
  const search = async () => {
    await root.querySelector('[data-source-search="cafe24"]').click();
    await settle();
  };

  await add('A');
  await search();
  await add('B');
  pending.get('A')([{ product_no: 701, product_name: 'A 결과' }]);
  await settle();
  await settle();
  assert.equal(root.querySelectorAll('[data-source-candidate]').length, 0);
  assert.equal(root.querySelector('.bulk-source-selected'), null);

  await search();
  const unsafeName = '<img src=x onerror=alert(1)>';
  pending.get('B')([{ product_no: 802, product_name: unsafeName }]);
  await settle();
  await settle();
  const candidate = root.querySelector('[data-source-candidate="cafe24:802"]');
  assert.ok(candidate);
  assert.equal(candidate.querySelector('span').textContent, `${unsafeName} · #802`);
  assert.equal(candidate.querySelectorAll('img').length, 0);
  await new Promise(resolve => setTimeout(resolve, 600));
});
