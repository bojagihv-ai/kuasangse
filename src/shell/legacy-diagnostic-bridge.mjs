const DIAGNOSTIC_NAME = '__KUASANGSE_DIAGNOSTIC__';
const MUTABLE_ALIASES = Object.freeze(['state', '__kuasangseState', 'factoryState']);

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, child);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function detachedFrozen(value) {
  return deepFreeze(structuredClone(value));
}

export function createLegacyDiagnosticBridge({ store, root } = {}) {
  if (typeof store?.snapshot !== 'function') {
    throw new TypeError('diagnostic store snapshot must be a function');
  }
  if (!root || !['object', 'function'].includes(typeof root)) {
    throw new TypeError('diagnostic root is required');
  }

  let installed = false;
  let installedSnapshot = null;

  function assertNoMutableAliases() {
    const alias = MUTABLE_ALIASES.find(name => name in root);
    if (alias) throw new Error(`mutable legacy global alias is forbidden: ${alias}`);
  }

  function snapshot() {
    return detachedFrozen(store.snapshot());
  }

  function install() {
    assertNoMutableAliases();
    if (installed) return installedSnapshot;
    if (Object.prototype.hasOwnProperty.call(root, DIAGNOSTIC_NAME)) {
      throw new Error(`legacy diagnostic global already exists: ${DIAGNOSTIC_NAME}`);
    }
    installedSnapshot = snapshot();
    Object.defineProperty(root, DIAGNOSTIC_NAME, {
      value: installedSnapshot,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    installed = true;
    return installedSnapshot;
  }

  function dispose() {
    // A non-configurable diagnostic cannot be removed safely. Keeping the
    // detached frozen value makes repeated disposal and installation inert.
  }

  return Object.freeze({ install, snapshot, dispose });
}
