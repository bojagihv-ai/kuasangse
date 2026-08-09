import { FACTORY_TAB_TARGETS, SIDEBAR_TARGETS } from './module-targets.mjs';
import { KNOWN_FOUNDATION_MODULE_IDS } from './runtime-module-ids.mjs';

export { KNOWN_FOUNDATION_MODULE_IDS };
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
  const normalized = values.map(value => {
    const item = cleanText(value);
    return field === 'imports' ? item.replace(/[?#].*$/u, '') : item;
  });
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
