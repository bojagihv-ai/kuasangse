export const FACTORY_TAB_CONTRACT_VERSION = 'factory-tab:v1';

const RUNTIME_CAPABILITY_NAMES = Object.freeze([
  'getSnapshot',
  'assertMutable',
  'getOperationToken',
  'isOperationCurrent',
  'reportError',
  'actions',
  'renderHelpers',
]);

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'owner',
  'capabilities',
  'commands',
  'select',
  'render',
  'bind',
  'onEnter',
  'onLeave',
  'persistence',
]);

function cleanText(value) {
  return String(value ?? '').trim();
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredFunction(record, name) {
  const descriptor = Object.getOwnPropertyDescriptor(record, name);
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function') {
    throw new TypeError(`factory tab capability ${name} must be an own function`);
  }
  return descriptor.value;
}

function validateRuntimeCapabilities(capabilities) {
  if (capabilities === undefined) return null;
  if (!isPlainRecord(capabilities)) {
    throw new TypeError('factory tab runtime capabilities must be an own-field record');
  }
  const actual = Object.keys(capabilities).sort();
  const expected = [...RUNTIME_CAPABILITY_NAMES].sort();
  const missing = expected.filter(name => !actual.includes(name));
  const unexpected = actual.filter(name => !expected.includes(name));
  if (missing.length || unexpected.length) {
    const details = [
      missing.length ? `missing ${missing.join(', ')}` : '',
      unexpected.length ? `unexpected ${unexpected.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw new TypeError(`invalid factory tab capabilities: ${details}`);
  }
  const runtime = {
    getSnapshot: requiredFunction(capabilities, 'getSnapshot'),
    assertMutable: requiredFunction(capabilities, 'assertMutable'),
    getOperationToken: requiredFunction(capabilities, 'getOperationToken'),
    isOperationCurrent: requiredFunction(capabilities, 'isOperationCurrent'),
    reportError: requiredFunction(capabilities, 'reportError'),
  };
  for (const name of ['actions', 'renderHelpers']) {
    const descriptor = Object.getOwnPropertyDescriptor(capabilities, name);
    if (!descriptor || descriptor.get || descriptor.set || !isPlainRecord(descriptor.value)) {
      throw new TypeError(`factory tab capability ${name} must be an own record`);
    }
  }
  return Object.freeze(runtime);
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array`);
  const normalized = values.map(value => cleanText(value));
  if (normalized.some(value => !value)) throw new TypeError(`${field} contains an empty value`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`duplicate ${field}`);
  return Object.freeze(normalized);
}

function persistenceContract(value, owner) {
  if (!isPlainRecord(value)) throw new TypeError('persistence must be an object');
  const reads = uniqueStrings(value.reads, 'persistence reads');
  const writes = uniqueStrings(value.writes, 'persistence writes');
  if (reads.length !== 1 || reads[0] !== owner || writes.length !== 1 || writes[0] !== owner) {
    throw new Error(`factory tab persistence must remain owned by ${owner}`);
  }
  return Object.freeze({ reads, writes });
}

function commandContracts(commands, capabilities) {
  if (!isPlainRecord(commands)) throw new TypeError('commands must be an own-key object');
  const result = Object.create(null);
  for (const [name, command] of Object.entries(commands)) {
    const commandName = cleanText(name);
    if (!commandName || !isPlainRecord(command)) {
      throw new TypeError('command declaration must be an object');
    }
    const capability = cleanText(command.capability);
    if (!capability || !capabilities.has(capability)) {
      throw new Error(`undeclared capability for command ${commandName}: ${capability || '<empty>'}`);
    }
    if (typeof command.execute !== 'function') {
      throw new TypeError(`command ${commandName} execute must be a function`);
    }
    result[commandName] = Object.freeze({ capability, execute: command.execute });
  }
  return Object.freeze(result);
}

function isFrozenTree(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value) || (!Array.isArray(value) && !isPlainRecord(value))) return false;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every(key => {
    if (key === 'length' && Array.isArray(value)) return true;
    const descriptor = descriptors[key];
    return typeof key === 'string' && !descriptor.get && !descriptor.set
      && isFrozenTree(descriptor.value, seen);
  });
}

function mutationCommand(name, capability) {
  return /(?:^|:)(?:write|mutate|save|publish|run|set|update|delete|create)(?:$|:)/i
    .test(`${capability}:${name}`);
}

function staleOperationError(id) {
  const error = new Error(`STALE_FACTORY_TAB_OPERATION: ${id}`);
  error.code = 'STALE_FACTORY_TAB_OPERATION';
  return error;
}

function runtimeCommandReceipt(value) {
  if (!value || typeof value !== 'object' || !Object.isFrozen(value)) return null;
  if (value.schema !== 'factory-runtime-command-receipt:v1') return null;
  if (!value.operationToken || typeof value.operationToken !== 'object') {
    throw new TypeError('factory runtime command receipt requires an operation token');
  }
  return value;
}

export function createFactoryTabContract(definition, runtimeCapabilities) {
  if (!isPlainRecord(definition)) throw new TypeError('factory tab contract must be an object');
  if (definition.version !== FACTORY_TAB_CONTRACT_VERSION) {
    throw new Error(`unsupported factory tab contract version: ${cleanText(definition.version) || '<empty>'}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(definition, field)) {
      throw new TypeError(`missing factory tab contract field: ${field}`);
    }
  }
  const runtime = validateRuntimeCapabilities(runtimeCapabilities);
  const id = cleanText(definition.id);
  const owner = cleanText(definition.owner);
  if (!id.startsWith('factory/')) throw new TypeError('factory tab id must start with factory/');
  if (!owner) throw new TypeError('factory tab owner is required');
  const capabilityList = uniqueStrings(definition.capabilities, 'capabilities');
  const capabilities = new Set(capabilityList);
  const commands = commandContracts(definition.commands, capabilities);
  const select = requiredFunction(definition, 'select');
  const bind = requiredFunction(definition, 'bind');

  function reportAndThrow(error) {
    runtime.reportError(error);
    throw error;
  }

  function invoke(commandName, ...args) {
    const normalizedName = cleanText(commandName);
    if (!Object.prototype.hasOwnProperty.call(commands, normalizedName)) {
      throw new Error(`undeclared command: ${normalizedName || '<empty>'}`);
    }
    const command = commands[normalizedName];
    if (!runtime) return command.execute(...args);
    let token;
    let result;
    try {
      if (mutationCommand(normalizedName, command.capability)) runtime.assertMutable(owner);
      token = runtime.getOperationToken();
      result = command.execute(...args);
      if (!result || typeof result.then !== 'function') {
        const receipt = runtimeCommandReceipt(result);
        if (!runtime.isOperationCurrent(receipt?.operationToken || token)) throw staleOperationError(id);
        return receipt ? receipt.value : result;
      }
    } catch (error) {
      return reportAndThrow(error);
    }
    return Promise.resolve(result)
      .then(value => {
        const receipt = runtimeCommandReceipt(value);
        if (!runtime.isOperationCurrent(receipt?.operationToken || token)) throw staleOperationError(id);
        return receipt ? receipt.value : value;
      })
      .catch(reportAndThrow);
  }

  return Object.freeze({
    version: FACTORY_TAB_CONTRACT_VERSION,
    id,
    owner,
    capabilities: capabilityList,
    commands,
    select(...args) {
      const selected = select(...args);
      if (!isFrozenTree(selected)) throw new TypeError(`factory tab ${id} select must return immutable frozen data`);
      return selected;
    },
    render: requiredFunction(definition, 'render'),
    bind(...args) {
      const cleanup = bind(...args);
      if (typeof cleanup !== 'function') throw new TypeError(`factory tab ${id} bind must return a disposer`);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        cleanup();
      };
    },
    onEnter: requiredFunction(definition, 'onEnter'),
    onLeave: requiredFunction(definition, 'onLeave'),
    persistence: persistenceContract(definition.persistence, owner),
    invoke,
  });
}
