const TRANSITION_DEFINITIONS = [
  ['productToOptions', 'product-analysis', 'options', 'composition:product-to-options'],
  ['optionsToFactory', 'options', 'factory', 'composition:options-to-factory'],
  ['factoryToWorkfile', 'factory', 'shared.workfile', 'composition:factory-to-workfile'],
  ['workfileToDetail', 'shared.workfile', 'detail-document', 'composition:workfile-to-detail'],
  ['detailToCafe24', 'detail-document', 'cafe24', 'composition:detail-to-cafe24'],
];
const UNSAFE_PAYLOAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function cloneData(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError('composition payload must be plain data');
  if (seen.has(value)) throw new TypeError('composition payload must not contain cycles');
  seen.add(value);
  const copy = Array.isArray(value) ? [] : {};
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('composition payload must be plain data');
  }
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_PAYLOAD_KEYS.has(key)) throw new TypeError(`unsafe composition payload key: ${key}`);
    copy[key] = cloneData(child, seen);
  }
  seen.delete(value);
  return copy;
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

export const COMPOSITION_TRANSITIONS = Object.freeze(TRANSITION_DEFINITIONS.map(
  ([name, source, target, capability]) => Object.freeze({ name, source, target, capability }),
));

export const COMPOSITION_COMMAND_NAMES = Object.freeze(COMPOSITION_TRANSITIONS.map(item => item.name));

export class WorkspaceReadOnlyError extends Error {
  constructor(snapshot = {}) {
    super(snapshot.reason || 'Workspace is read-only');
    this.name = 'WorkspaceReadOnlyError';
    this.code = snapshot.reasonCode || 'READ_ONLY';
    this.snapshot = Object.freeze({ ...snapshot });
  }
}

export function createCompositionCommands({ dispatch, authority = null } = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('composition dispatch is required');
  const byName = new Map(COMPOSITION_TRANSITIONS.map(transition => [transition.name, transition]));

  function run(name, payload = {}) {
    const lock = authority?.snapshot?.() || null;
    if (lock && !['editing', 'offline-edit'].includes(lock.mode)) {
      throw new WorkspaceReadOnlyError(lock);
    }
    const transition = byName.get(String(name ?? '').trim());
    if (!transition) throw new Error(`undeclared composition command: ${String(name ?? '').trim() || '<empty>'}`);
    const action = freezeTree({
      type: 'composition/bridge',
      owner: 'composition',
      capability: transition.capability,
      transition: transition.name,
      source: transition.source,
      target: transition.target,
      payload: cloneData(payload),
    });
    return dispatch(action);
  }

  return Object.freeze({
    run,
    productToOptions: payload => run('productToOptions', payload),
    optionsToFactory: payload => run('optionsToFactory', payload),
    factoryToWorkfile: payload => run('factoryToWorkfile', payload),
    workfileToDetail: payload => run('workfileToDetail', payload),
    detailToCafe24: payload => run('detailToCafe24', payload),
  });
}
