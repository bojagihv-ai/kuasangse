import {
  STATE_PATH_OWNERSHIP,
  assertExhaustiveStateOwnership,
  createInitialAppState,
  ownerForStatePath,
  validateStateOwnership,
} from './state-ownership.mjs';

export const APP_STATE_ENVELOPE_SCHEMA = 'kuasangse.app-state';
export const APP_STATE_VERSION = 'app-state:v1';
const UNSAFE_STATE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function cleanText(value) {
  return String(value ?? '').trim();
}

function clonePlainData(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError('value must be plain state data');
  if (seen.has(value)) throw new TypeError('plain state data must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    const copy = value.map(item => clonePlainData(item, seen));
    seen.delete(value);
    return copy;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('value must be plain state data');
  const copy = {};
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_STATE_KEYS.has(key)) throw new TypeError(`unsafe state key: ${key}`);
    copy[key] = clonePlainData(child, seen);
  }
  seen.delete(value);
  return copy;
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

function immutableCopy(value) {
  if (value === undefined) return undefined;
  return freezeTree(clonePlainData(value));
}

function readPath(state, statePath) {
  return statePath.split('.').reduce((current, segment) => current?.[segment], state);
}

function writePath(state, statePath, value) {
  const segments = statePath.split('.');
  let current = state;
  for (const segment of segments.slice(0, -1)) {
    if (!current[segment] || typeof current[segment] !== 'object') current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

export function defineReducer(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('reducer definition is required');
  const type = cleanText(definition.type);
  const owner = cleanText(definition.owner);
  const path = cleanText(definition.path);
  if (!type || !owner || !path || typeof definition.reduce !== 'function') {
    throw new TypeError('reducer requires type, owner, path, and reduce');
  }
  return Object.freeze({ type, owner, path, reduce: definition.reduce });
}

export function createAppStore({
  initialState = createInitialAppState(),
  ownership = STATE_PATH_OWNERSHIP,
  reducers = [],
  hydrators = {},
} = {}) {
  const ownershipEntries = validateStateOwnership(ownership);
  let state = clonePlainData(initialState);
  assertExhaustiveStateOwnership(state, ownershipEntries);

  if (!Array.isArray(reducers)) throw new TypeError('reducers must be an array');
  const reducersByType = new Map();
  for (const candidate of reducers) {
    const reducer = defineReducer(candidate);
    if (reducersByType.has(reducer.type)) throw new Error(`duplicate reducer action: ${reducer.type}`);
    const pathOwner = ownerForStatePath(reducer.path, ownershipEntries);
    if (pathOwner !== reducer.owner) {
      throw new Error(`peer mutation rejected: ${reducer.owner} cannot write ${reducer.path} owned by ${pathOwner || 'nobody'}`);
    }
    reducersByType.set(reducer.type, reducer);
  }

  if (!hydrators || typeof hydrators !== 'object' || Array.isArray(hydrators)) {
    throw new TypeError('hydrators must be an object');
  }
  for (const [version, hydrate] of Object.entries(hydrators)) {
    if (!cleanText(version) || typeof hydrate !== 'function') throw new TypeError('hydrator entries require version functions');
  }
  const listeners = new Set();

  function snapshot() {
    return immutableCopy(state);
  }

  function notify(change) {
    if (listeners.size === 0) return;
    const nextSnapshot = snapshot();
    for (const listener of [...listeners]) listener(nextSnapshot, Object.freeze({ ...change }));
  }

  function dispatch(action) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new TypeError('action must be an object');
    const type = cleanText(action.type);
    const reducer = reducersByType.get(type);
    if (!reducer) throw new Error(`unknown action: ${type || '<empty>'}`);
    const currentSlice = immutableCopy(readPath(state, reducer.path));
    const payload = immutableCopy(action.payload);
    const reduced = reducer.reduce(currentSlice, payload);
    const nextSlice = clonePlainData(reduced);
    const nextState = clonePlainData(state);
    writePath(nextState, reducer.path, nextSlice);
    assertExhaustiveStateOwnership(nextState, ownershipEntries);
    state = nextState;
    notify({ kind: 'dispatch', type, owner: reducer.owner, path: reducer.path });
    return snapshot();
  }

  function hydrate(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new TypeError('hydration envelope must be an object');
    }
    if (envelope.schema !== APP_STATE_ENVELOPE_SCHEMA) throw new Error('invalid hydration schema');
    const version = cleanText(envelope.version);
    let candidate;
    if (version === APP_STATE_VERSION) {
      candidate = clonePlainData(envelope.state);
    } else if (Object.prototype.hasOwnProperty.call(hydrators, version)
      && typeof hydrators[version] === 'function') {
      candidate = clonePlainData(hydrators[version](immutableCopy(envelope.state)));
    } else {
      throw new Error(`unsupported hydration version: ${version || '<empty>'}`);
    }
    assertExhaustiveStateOwnership(candidate, ownershipEntries);
    state = candidate;
    notify({ kind: 'hydrate', version: APP_STATE_VERSION });
    return APP_STATE_VERSION;
  }

  function select(selector) {
    if (typeof selector !== 'function') throw new TypeError('selector must be a function');
    return immutableCopy(selector(snapshot()));
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }

  return Object.freeze({
    dispatch,
    hydrate,
    select,
    snapshot,
    subscribe,
    version: APP_STATE_VERSION,
  });
}
