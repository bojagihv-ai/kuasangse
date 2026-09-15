const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor(tag, document) {
    this.tagName = tag; this.document = document; this.children = []; this.dataset = {}; this.attributes = {};
    this.listeners = new Map(); this.hidden = false; this.disabled = false; this.open = false;
    this.classList = { add() {}, toggle() {} };
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); }
  before(...nodes) { this.parent.append(...nodes); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  set textContent(value) { this.text = String(value); this.html = ''; this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(node => node.textContent).join(''); }
  set innerHTML(value) {
    this.html = value; this.children = [];
    for (const match of value.matchAll(/<(button|span|p|section|div|nav|strong)\b([^>]*)>([^<]*)/g)) {
      const node = new Element(match[1], this.document);
      node.id = /\bid="([^"]+)"/.exec(match[2])?.[1] || '';
      node.className = /\bclass="([^"]+)"/.exec(match[2])?.[1] || '';
      node.textContent = match[3]; node.hidden = /\bhidden\b/.test(match[2]);
      node.disabled = /\bdisabled\b/.test(match[2]);
      this.append(node);
    }
  }
  get innerHTML() { return this.html || ''; }
  querySelectorAll(selector) {
    return this.children.flatMap(node => {
      const match = selector.startsWith('#') ? node.id === selector.slice(1)
        : selector.startsWith('.') ? (node.className || '').split(' ').includes(selector.slice(1))
          : selector === '[data-native-open-job]' ? !!node.dataset.nativeOpenJob : node.tagName === selector;
      return [...(match ? [node] : []), ...node.querySelectorAll(selector)];
    });
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(name, handler) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(handler); }
  async click() {
    if (this.disabled || this.hidden) return;
    if (this.tagName === 'summary' && this.parent?.tagName === 'details') {
      this.parent.open = !this.parent.open;
      for (const handler of this.parent.listeners.get('toggle') || []) await handler({ target: this.parent });
    }
    for (const handler of this.listeners.get('click') || []) await handler({ target: this, preventDefault() {}, stopPropagation() {} });
  }
}

async function mountConsole(h, overrides = {}, { autoStart = true } = {}) {
  const document = { createElement: tag => new Element(tag, document) };
  document.body = new Element('body', document); document.head = new Element('head', document);
  document.getElementById = id => document.body.querySelector(`#${id}`);
  const app = document.createElement('main'); app.id = 'app'; document.body.append(app);
  const routing = await import('../../src/modules/native-factory-command-routing.mjs');
  const entry = await import('../../src/modules/native-batch-console.mjs');
  let view = {};
  if (fs.existsSync('src/modules/native-batch-console-view.mjs')) view = await import('../../src/modules/native-batch-console-view.mjs');
  routing.configureNativeFactoryRuntime({ ...h.io, ...overrides.io });
  const operator = await import('../../control_tower/frontend/src/factory-operator-controls.mjs');
  const queue = await import('../../control_tower/frontend/src/operator-queue-model.mjs');
  const workbench = await import('../../control_tower/frontend/src/production-workbench.mjs');
  let connected = false;
  const options = { apiBase: 'http://fixture', journal: h.io.journal, digest: h.io.digest, randomUUID: h.io.randomUUID,
    wait: h.io.wait, publishMenu() {}, confirm: () => false, onBeforeUnload() {}, onJobCreated() {},
    syncProjection: h.io.syncProjection, readState: async () => ({ ...await h.io.readProjection(), connected }),
    readSettings: async () => ({ judgment: { model: 'fixture', reasoningEffort: 'high' }, imageModels: [] }),
    installWorker: () => ({ worker: { hello: async () => { connected = true; return { accepted: true }; },
      startHeartbeat() {}, startSessionHeartbeat() {}, startPolling() {}, startProjectionPolling() {} } }), ...overrides,
  };
  const namespaces = { '/src/control-tower-client.mjs': { createControlTowerClient: () => ({ apiRequest: h.io.apiRequest }) },
    '/src/bulk-intake.mjs': { mountBulkIntake() {} }, '/src/operator-queue-model.mjs': queue,
    '/src/factory-operator-controls.mjs': operator, '/src/production-workbench.mjs': workbench };
  const code = fs.readFileSync('src/modules/native-batch-console.mjs', 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export \{.*\};\r?\n/gm, '')
    .replace('export async function mountNativeBatchConsole', 'async function mountNativeBatchConsole')
    .replace(/import\(/g, 'importModule(');
  const context = vm.createContext({ ...routing, ...entry, ...view, START_ERRORS: routing.NATIVE_START_ERRORS || view.NATIVE_START_ERRORS,
    installNativeFactoryCommandRouting: io => { const result = routing.installNativeFactoryCommandRouting(io); h.useRouting(result); return result; },
    importModule: async name => namespaces[name], URL, Date, Promise, Object, Array, JSON });
  vm.runInContext(code, context);
  await context.mountNativeBatchConsole(document, options);
  if (autoStart) await document.getElementById('nativeBatchStart').click();
  return { document, app, options, status: document.getElementById('nativeBatchStatus') };
}
module.exports = { Element, mountConsole };
