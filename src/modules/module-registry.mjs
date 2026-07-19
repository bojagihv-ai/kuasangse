const SIDEBAR_TARGETS = [
  ['upload', 'src/menus/upload-menu.mjs', 'product-analysis', 'menu:v1 + product commands', 'MENU-UPLOAD'],
  ['analyzing', 'src/menus/analysis-menu.mjs', 'product-analysis', 'menu:v1 + analysis commands', 'MENU-ANALYSIS'],
  ['competitor', 'src/menus/competitor-menu.mjs', 'competitors', 'menu:v1 + competitor commands', 'MENU-COMP'],
  ['sections', 'src/menus/sections-menu.mjs', 'detail-document', 'menu:v1 + section commands', 'MENU-SECTIONS'],
  ['generating', 'src/menus/generating-menu.mjs', 'detail-document', 'menu:v1 + generation commands', 'MENU-GENERATE'],
  ['preview', 'src/menus/preview-menu.mjs', 'detail-document', 'menu:v1 + preview selectors', 'MENU-PREVIEW'],
  ['imagecuts', 'src/menus/imagecuts-menu.mjs', 'image-cuts', 'menu:v1 + cut commands', 'MENU-CUTS'],
  ['optionsorter', 'src/menus/optionsorter-menu.mjs', 'options', 'menu:v1 + option commands', 'MENU-OPTIONS'],
  ['factory', 'src/menus/factory/factory-menu.mjs', 'factory', 'menu:v1 + factory composition', 'MENU-FACTORY'],
  ['automation', 'src/menus/automation-menu.mjs', 'automation', 'menu:v1 + automation commands', 'MENU-AUTO'],
  ['modelsettings', 'src/menus/modelsettings-menu.mjs', 'app-preferences', 'menu:v1 + settings commands', 'MENU-SETTINGS'],
  ['manual', 'src/menus/manual-menu.mjs', 'manual-ui', 'menu:v1', 'MENU-MANUAL'],
];

const FACTORY_TAB_TARGETS = [
  ['factory/start', 'src/menus/factory/tabs/start-tab.mjs', 'factory', 'factory-tab:v1', 'FACTORY-START'],
  ['factory/db', 'src/menus/factory/tabs/db-tab.mjs', 'product-db', 'factory-tab:v1', 'FACTORY-DB'],
  ['factory/fields', 'src/menus/factory/tabs/fields-tab.mjs', 'product-db', 'factory-tab:v1', 'FACTORY-FIELDS'],
  ['factory/competitor', 'src/menus/factory/tabs/competitor-tab.mjs', 'competitors', 'factory-tab:v1', 'FACTORY-COMP'],
  ['factory/assets', 'src/menus/factory/tabs/assets-tab.mjs', 'factory-assets', 'factory-tab:v1', 'FACTORY-ASSETS'],
  ['factory/sections', 'src/menus/factory/tabs/sections-tab.mjs', 'detail-document', 'factory-tab:v1', 'FACTORY-SECTIONS'],
  ['factory/publish', 'src/menus/factory/tabs/publish-tab.mjs', 'cafe24', 'factory-tab:v1', 'FACTORY-PUBLISH'],
];

export const KNOWN_FOUNDATION_MODULE_IDS = Object.freeze([
  'src/modules/workspace-revision.mjs',
  'src/modules/state-ownership.mjs',
  'src/modules/menu-contracts.mjs',
  'src/modules/app-store.mjs',
  'src/modules/composition-commands.mjs',
  'src/modules/module-registry.mjs',
  'src/modules/persistence/contracts.mjs',
  'src/modules/persistence/fencing.mjs',
  'src/modules/persistence/indexeddb-driver.mjs',
  'src/modules/persistence/migrations.mjs',
  'src/modules/persistence/serialization.mjs',
  'src/modules/persistence/file-publish.mjs',
  'src/modules/persistence/session-storage-adapter.mjs',
  'src/modules/persistence/indexeddb-adapter.mjs',
  'src/modules/persistence/server-last-work-adapter.mjs',
  'src/modules/persistence/workfile-adapter.mjs',
  'src/modules/persistence/archive-adapter.mjs',
  'src/modules/workspace-mutations.mjs',
  'src/modules/workspace-persistence.mjs',
  'src/domains/cafe24/fields.mjs',
  'src/domains/cafe24/options.mjs',
  'src/domains/cafe24/payload.mjs',
  'src/domains/cafe24/api.mjs',
  'src/domains/cafe24/sync.mjs',
  'src/domains/cafe24/ui.mjs',
  'src/domains/cafe24/index.mjs',
  'src/menus/manual-menu.mjs',
  'src/menus/modelsettings-menu.mjs',
  'src/menus/automation-menu.mjs',
  'src/menus/imagecuts-menu.mjs',
  'src/menus/optionsorter-menu.mjs',
  'src/menus/upload-menu.mjs',
  'src/menus/analysis-menu.mjs',
  'src/menus/sections-menu-cards-view.mjs',
  'src/menus/sections-menu-view.mjs',
  'src/menus/sections-menu.mjs',
  'src/menus/sections-menu-a2-events.mjs',
  'src/menus/generating-menu.mjs',
  'src/menus/preview-menu-view.mjs',
  'src/menus/preview-menu.mjs',
  'src/menus/competitor-menu-report-view.mjs',
  'src/menus/competitor-menu-plan-view.mjs',
  'src/menus/competitor-menu-view.mjs',
  'src/menus/competitor-menu.mjs',
  'src/modules/factory-store.mjs',
  'src/menus/factory/factory-tab-contract.mjs',
  'src/menus/factory/tabs/start-tab.mjs',
  'src/menus/factory/tabs/db-tab.mjs',
  'src/menus/factory/tabs/fields-tab-render.mjs',
  'src/menus/factory/tabs/fields-tab.mjs',
  'src/menus/factory/tabs/competitor-tab-model.mjs',
  'src/menus/factory/tabs/competitor-tab-analysis.mjs',
  'src/menus/factory/tabs/competitor-tab-candidates.mjs',
  'src/menus/factory/tabs/competitor-tab-images.mjs',
  'src/menus/factory/tabs/competitor-tab-view.mjs',
  'src/menus/factory/tabs/competitor-tab-events.mjs',
  'src/menus/factory/tabs/competitor-tab.mjs',
  'src/menus/factory/tabs/assets-tab-render.mjs',
  'src/menus/factory/tabs/assets-tab-bind.mjs',
  'src/menus/factory/tabs/assets-tab.mjs',
  'src/menus/factory/tabs/sections-tab.mjs',
  'src/menus/factory/tabs/publish-tab-render.mjs',
  'src/menus/factory/tabs/publish-tab.mjs',
  'src/menus/factory/factory-menu.mjs',
  'src/shell/render-lifecycle.mjs',
  'src/shell/route-controller.mjs',
  'src/shell/legacy-diagnostic-bridge.mjs',
  'src/shell/bootstrap.mjs',
]);

const KNOWN_FOUNDATION_MODULE_ID_SET = new Set(KNOWN_FOUNDATION_MODULE_IDS);
const MODULE_GRAPH_CONTRACTS = new WeakSet();

function cleanText(value) {
  return String(value ?? '').trim();
}

function targetDescriptor(kind, order, target) {
  const [id, implementation, owner, api, gate] = target;
  return Object.freeze({ id, kind, order, implementation, owner, api, gate });
}

export const SIDEBAR_MODULE_DESCRIPTORS = Object.freeze(
  SIDEBAR_TARGETS.map((target, order) => targetDescriptor('sidebar', order, target)),
);

export const FACTORY_TAB_MODULE_DESCRIPTORS = Object.freeze(
  FACTORY_TAB_TARGETS.map((target, order) => targetDescriptor('factory-tab', order, target)),
);

export const TARGET_MODULE_DESCRIPTORS = Object.freeze([
  ...SIDEBAR_MODULE_DESCRIPTORS,
  ...FACTORY_TAB_MODULE_DESCRIPTORS,
]);

function validateDescriptor(descriptor, index) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    throw new TypeError(`module descriptor ${index} must be an object`);
  }
  const normalized = {
    id: cleanText(descriptor.id),
    kind: cleanText(descriptor.kind),
    order: descriptor.order,
    implementation: cleanText(descriptor.implementation),
    owner: cleanText(descriptor.owner),
    api: cleanText(descriptor.api),
    gate: cleanText(descriptor.gate),
  };
  if (!normalized.id || !normalized.implementation || !normalized.owner || !normalized.api || !normalized.gate) {
    throw new TypeError(`module descriptor ${index} is missing required fields`);
  }
  if (!['sidebar', 'factory-tab'].includes(normalized.kind)) throw new TypeError(`invalid module kind: ${normalized.kind}`);
  if (!Number.isInteger(normalized.order) || normalized.order < 0) throw new TypeError(`invalid module order: ${normalized.order}`);
  return Object.freeze(normalized);
}

export function createModuleRegistry(descriptors = TARGET_MODULE_DESCRIPTORS) {
  if (!Array.isArray(descriptors)) throw new TypeError('module descriptors must be an array');
  const normalized = descriptors.map(validateDescriptor);
  const ids = new Set();
  const implementations = new Set();
  const gates = new Set();
  const orders = new Set();
  for (const descriptor of normalized) {
    if (ids.has(descriptor.id)) throw new Error(`duplicate module id: ${descriptor.id}`);
    if (implementations.has(descriptor.implementation)) throw new Error(`duplicate module implementation: ${descriptor.implementation}`);
    if (gates.has(descriptor.gate)) throw new Error(`duplicate module gate: ${descriptor.gate}`);
    const orderKey = `${descriptor.kind}:${descriptor.order}`;
    if (orders.has(orderKey)) throw new Error(`duplicate ${descriptor.kind} order: ${descriptor.order}`);
    ids.add(descriptor.id);
    implementations.add(descriptor.implementation);
    gates.add(descriptor.gate);
    orders.add(orderKey);
  }
  for (const kind of ['sidebar', 'factory-tab']) {
    const kindOrders = normalized.filter(item => item.kind === kind).map(item => item.order).sort((a, b) => a - b);
    kindOrders.forEach((order, index) => {
      if (order !== index) throw new Error(`incomplete ${kind} order: expected ${index}, received ${order}`);
    });
  }
  const list = Object.freeze(normalized.slice().sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'sidebar' ? -1 : 1;
    return left.order - right.order;
  }));
  const byId = new Map(list.map(item => [item.id, item]));
  return Object.freeze({
    get(id) { return byId.get(cleanText(id)) || null; },
    has(id) { return byId.has(cleanText(id)); },
    list(kind = '') {
      const normalizedKind = cleanText(kind);
      return normalizedKind ? Object.freeze(list.filter(item => item.kind === normalizedKind)) : list;
    },
    size: list.length,
  });
}

function cleanGraphList(values, field, id) {
  if (!Array.isArray(values)) throw new TypeError(`invalid ${field} for module graph contract: ${id}`);
  const normalized = values.map(cleanText);
  if (normalized.some(value => !value)) throw new TypeError(`empty ${field} in module graph contract: ${id}`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`duplicate ${field} in module graph contract: ${id}`);
  return Object.freeze(normalized);
}

export function createModuleGraphContract(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('module graph contract input must be an object');
  }
  if ('source' in input) throw new TypeError('source is not part of runtime module contracts');
  const id = cleanText(input.id);
  if (!KNOWN_FOUNDATION_MODULE_ID_SET.has(id)) throw new TypeError(`unknown foundation module: ${id || '<empty>'}`);
  const owner = cleanText(input.owner);
  const role = cleanText(input.role);
  if (!owner || !role) throw new TypeError(`invalid module graph contract: ${id}`);
  const imports = cleanGraphList(input.imports, 'imports', id);
  const exports = cleanGraphList(input.exports, 'exports', id);
  const unknownImport = imports.find(importedId => !KNOWN_FOUNDATION_MODULE_ID_SET.has(importedId));
  if (unknownImport) throw new Error(`unknown foundation module import: ${unknownImport}`);
  const graphContract = Object.freeze({ id, owner, role, imports, exports });
  MODULE_GRAPH_CONTRACTS.add(graphContract);
  return graphContract;
}

export function validateModuleImportGraph(entries) {
  if (!Array.isArray(entries)) throw new TypeError('import graph entries must be an array');
  const byId = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!MODULE_GRAPH_CONTRACTS.has(entry) || !KNOWN_FOUNDATION_MODULE_ID_SET.has(entry.id)) {
      throw new TypeError(`import graph entry ${index} must be a branded module graph contract`);
    }
    if (byId.has(entry.id)) throw new Error(`duplicate import graph id: ${entry.id}`);
    if (entry.exports.some(name => /^(?:raw|mutable|root)?state$/i.test(name))) {
      throw new Error(`raw mutable state export: ${entry.id}`);
    }
    byId.set(entry.id, entry);
  }
  for (const entry of entries) {
    for (const importedId of entry.imports) {
      const imported = byId.get(importedId);
      if (!imported) throw new Error(`unknown import ${importedId} from ${entry.id}`);
      if (imported.role === 'store'
        && imported.owner !== entry.owner
        && entry.role !== 'composition'
        && entry.role !== 'foundation') {
        throw new Error(`peer-store import: ${entry.id} -> ${imported.id}`);
      }
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) throw new Error(`import cycle: ${[...trail, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const importedId of byId.get(id).imports) visit(importedId, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }
  for (const entry of entries) visit(entry.id, []);
  return true;
}

export const moduleRegistry = createModuleRegistry();
