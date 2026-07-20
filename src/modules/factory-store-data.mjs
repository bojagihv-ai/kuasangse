import { STATE_PATH_OWNERSHIP, ownerForStatePath } from './state-ownership.mjs';

export { ownerForStatePath };

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OWNER_PATHS = new Map(STATE_PATH_OWNERSHIP.map(entry => [entry.owner, entry.path]));

export function cleanText(value) {
  return String(value ?? '').trim();
}

export function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isUnsafeStateKey(value) {
  return typeof value === 'string' && UNSAFE_KEYS.has(value);
}

export function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return number;
}

export function clonePlainData(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === 'string'
    || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') throw new TypeError('factory snapshot must contain plain data');
  if (seen.has(value)) throw new TypeError('factory snapshot must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    const copy = value.map(item => clonePlainData(item, seen));
    seen.delete(value);
    return copy;
  }
  if (!isPlainRecord(value)) throw new TypeError('factory snapshot must contain plain records');
  const copy = {};
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) throw new TypeError(`unsafe factory snapshot key: ${key}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new TypeError(`factory snapshot key must be a data field: ${key}`);
    }
    copy[key] = clonePlainData(descriptor.value, seen);
  }
  seen.delete(value);
  return copy;
}

function freezeTree(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

export function immutableCopy(value) {
  return freezeTree(clonePlainData(value));
}

export function plainDataEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key)
    && plainDataEqual(left[key], right[key]));
}

export function readPath(state, statePath) {
  return statePath.split('.').reduce((current, segment) => current?.[segment], state);
}

export function writePath(state, statePath, value) {
  const segments = statePath.split('.');
  let current = state;
  for (const segment of segments.slice(0, -1)) {
    if (!isPlainRecord(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

export function validateSnapshotRoots(snapshot) {
  if (!isPlainRecord(snapshot)) throw new TypeError('factory snapshot must be an object');
  for (const statePath of Object.keys(snapshot)) {
    if (!ownerForStatePath(statePath)) throw new Error(`unowned factory snapshot path: ${statePath}`);
  }
}

export function ownerPath(owner) {
  const normalized = cleanText(owner);
  const path = OWNER_PATHS.get(normalized);
  if (!path) throw new Error(`unknown factory store owner: ${normalized || '<empty>'}`);
  return Object.freeze({ owner: normalized, path });
}

function commandPath(value, field) {
  const path = cleanText(value);
  const segments = path.split('.');
  if (!path || segments.some(segment => !segment || UNSAFE_KEYS.has(segment)
    || !/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment))) {
    throw new TypeError(`${field} must be a safe state path`);
  }
  return path;
}

export function normalizeCommandPolicies(value) {
  if (value === undefined) return new Map();
  if (!isPlainRecord(value)) throw new TypeError('factory command policies must be an object');
  const policies = new Map();
  for (const [rawName, rawPolicy] of Object.entries(value)) {
    const name = cleanText(rawName);
    if (!name || !isPlainRecord(rawPolicy)) throw new TypeError('factory command policy must be a named object');
    const keys = Object.keys(rawPolicy).sort();
    if (keys.length !== 3 || keys[0] !== 'coordinator' || keys[1] !== 'parts' || keys[2] !== 'targetPath') {
      throw new TypeError(`factory command policy ${name} requires exactly coordinator, parts, and targetPath`);
    }
    const coordinator = ownerPath(rawPolicy.coordinator).owner;
    const targetPath = commandPath(rawPolicy.targetPath, `factory command policy ${name} targetPath`);
    if (!ownerForStatePath(targetPath)) throw new Error(`unowned factory command target path: ${targetPath}`);
    if (!Array.isArray(rawPolicy.parts) || rawPolicy.parts.length === 0) {
      throw new TypeError(`factory command policy ${name} requires composition parts`);
    }
    const claims = [];
    const parts = rawPolicy.parts.map((rawPart, index) => {
      if (!isPlainRecord(rawPart)) throw new TypeError(`factory command policy ${name} part ${index} must be an object`);
      const partKeys = Object.keys(rawPart).sort();
      if (partKeys.length !== 2 || partKeys[0] !== 'owner' || partKeys[1] !== 'paths') {
        throw new TypeError(`factory command policy ${name} part ${index} requires exactly owner and paths`);
      }
      const owner = ownerPath(rawPart.owner).owner;
      if (!Array.isArray(rawPart.paths) || rawPart.paths.length === 0) {
        throw new TypeError(`factory command policy ${name} part ${index} requires paths`);
      }
      const paths = [...new Set(rawPart.paths.map((path, pathIndex) =>
        commandPath(path, `factory command policy ${name} part ${index} path ${pathIndex}`)
      ))].sort();
      for (const path of paths) {
        for (const claim of claims) {
          if (path === claim.path || path.startsWith(`${claim.path}.`) || claim.path.startsWith(`${path}.`)) {
            throw new Error(`overlapping factory command policy paths: ${name}:${claim.path}:${path}`);
          }
        }
        claims.push({ owner, path });
      }
      return Object.freeze({ owner, paths: Object.freeze(paths) });
    });
    policies.set(name, Object.freeze({ name, coordinator, targetPath, parts: Object.freeze(parts) }));
  }
  return policies;
}

function collectChangedPaths(left, right, prefix = '', output = []) {
  if (plainDataEqual(left, right)) return output;
  if (isPlainRecord(left) && isPlainRecord(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    if (keys.size === 0 && prefix) output.push(prefix);
    for (const key of [...keys].sort()) {
      collectChangedPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  output.push(prefix || '<root>');
  return output;
}

export function validateCommandDiff(policy, before, after) {
  const changedPaths = collectChangedPaths(before, after);
  const assignments = [];
  for (const changedPath of changedPaths) {
    const matches = policy.parts.flatMap(part => part.paths
      .filter(path => changedPath === path || changedPath.startsWith(`${path}.`))
      .map(path => ({ owner: part.owner, path })));
    if (matches.length !== 1) {
      throw new Error(`FACTORY_COMMAND_PATH_REJECTED: ${policy.name}:${changedPath}`);
    }
    assignments.push(Object.freeze({ changedPath, owner: matches[0].owner, policyPath: matches[0].path }));
  }
  return Object.freeze(assignments);
}

export function mutationMetadata(value) {
  if (!isPlainRecord(value)) throw new TypeError('mutation metadata must be an object');
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'expectedRevision' || keys[1] !== 'owner') {
    throw new TypeError('mutation metadata requires exactly owner and expectedRevision');
  }
  const ownership = ownerPath(value.owner);
  const expectedRevision = nonNegativeInteger(value.expectedRevision, 'expectedRevision');
  return Object.freeze({ ...ownership, expectedRevision });
}
