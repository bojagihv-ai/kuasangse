export const MENU_CONTRACT_VERSION = 'menu:v1';

export const MENU_REQUIRED_FIELDS = Object.freeze([
  'id',
  'routes',
  'ownedSlices',
  'select',
  'commands',
  'render',
  'bind',
  'onEnter',
  'onLeave',
  'persistence',
]);

const VALIDATED_MENU_CONTRACTS = new WeakSet();

function cleanText(value) {
  return String(value ?? '').trim();
}

function uniqueStrings(values, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    throw new TypeError(`${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  const normalized = values.map(value => cleanText(value));
  if (normalized.some(value => !value)) throw new TypeError(`${field} contains an empty value`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`duplicate ${field}`);
  return Object.freeze(normalized);
}

function persistenceContract(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('persistence must be an object');
  }
  return Object.freeze({
    reads: uniqueStrings(value.reads || [], 'persistence reads', { allowEmpty: true }),
    writes: uniqueStrings(value.writes || [], 'persistence writes', { allowEmpty: true }),
  });
}

function commandContracts(commands, capabilities) {
  if (!commands || typeof commands !== 'object' || Array.isArray(commands)) {
    throw new TypeError('commands must be an object');
  }
  const result = Object.create(null);
  for (const [name, command] of Object.entries(commands)) {
    const commandName = cleanText(name);
    if (!commandName || !command || typeof command !== 'object') {
      throw new TypeError('command declaration must be an object');
    }
    const capability = cleanText(command.capability);
    if (!capability || !capabilities.has(capability)) {
      throw new Error(`undeclared capability for command ${commandName}: ${capability || '<empty>'}`);
    }
    if (typeof command.execute !== 'function') throw new TypeError(`command ${commandName} execute must be a function`);
    result[commandName] = Object.freeze({ capability, execute: command.execute });
  }
  return Object.freeze(result);
}

function requiredFunction(definition, field) {
  if (typeof definition[field] !== 'function') throw new TypeError(`${field} must be a function`);
  return definition[field];
}

function createDefaultBindingLifecycle(originalBind, menuId) {
  let active = null;

  function install(record, args) {
    const dispose = originalBind(...args);
    if (typeof dispose !== 'function') throw new TypeError(`menu ${menuId} bind must return a disposer`);
    record.args = args;
    record.disposeCurrent = dispose;
  }

  function bind(...args) {
    active?.dispose();
    const record = { args, disposeCurrent: null, disposed: false, dispose: null };
    record.dispose = () => {
      if (record.disposed) return;
      record.disposed = true;
      const dispose = record.disposeCurrent;
      record.disposeCurrent = null;
      dispose?.();
      if (active === record) active = null;
    };
    install(record, args);
    active = record;
    return record.dispose;
  }

  function refresh(...args) {
    const record = active;
    if (!record || record.disposed) return;
    const nextArgs = [...record.args];
    args.forEach((value, index) => { nextArgs[index] = value; });
    const dispose = record.disposeCurrent;
    record.disposeCurrent = null;
    dispose?.();
    install(record, nextArgs);
  }

  return Object.freeze({ bind, refresh });
}

export function createMenuContract(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('menu contract must be an object');
  }
  if (definition.version !== MENU_CONTRACT_VERSION) {
    throw new Error(`unsupported menu contract version: ${cleanText(definition.version) || '<empty>'}`);
  }
  for (const field of MENU_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(definition, field)) throw new TypeError(`missing menu contract field: ${field}`);
  }

  const id = cleanText(definition.id);
  if (!id) throw new TypeError('menu id is required');
  const routes = uniqueStrings(definition.routes, 'routes');
  const ownedSlices = uniqueStrings(definition.ownedSlices, 'ownedSlices');
  const capabilities = new Set(uniqueStrings(definition.capabilities || [], 'capabilities', { allowEmpty: true }));
  const commands = commandContracts(definition.commands, capabilities);
  const originalBind = requiredFunction(definition, 'bind');
  const defaultBinding = typeof definition.refresh === 'function'
    ? null
    : createDefaultBindingLifecycle(originalBind, id);

  const contract = {
    version: MENU_CONTRACT_VERSION,
    id,
    routes,
    ownedSlices,
    capabilities: Object.freeze([...capabilities]),
    select: requiredFunction(definition, 'select'),
    commands,
    render: requiredFunction(definition, 'render'),
    refresh: typeof definition.refresh === 'function' ? definition.refresh : defaultBinding.refresh,
    bind(...args) {
      const dispose = defaultBinding ? defaultBinding.bind(...args) : originalBind(...args);
      if (typeof dispose !== 'function') throw new TypeError(`menu ${id} bind must return a disposer`);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        dispose();
      };
    },
    onEnter: requiredFunction(definition, 'onEnter'),
    onLeave: requiredFunction(definition, 'onLeave'),
    persistence: persistenceContract(definition.persistence),
    invoke(commandName, ...args) {
      const normalizedName = cleanText(commandName);
      if (!Object.prototype.hasOwnProperty.call(commands, normalizedName)) {
        throw new Error(`undeclared command: ${normalizedName || '<empty>'}`);
      }
      const command = commands[normalizedName];
      return command.execute(...args);
    },
  };
  if (typeof definition.prepare === 'function') contract.prepare = definition.prepare;
  const validatedContract = Object.freeze(contract);
  VALIDATED_MENU_CONTRACTS.add(validatedContract);
  return validatedContract;
}

export function createMenuContractRegistry(contracts) {
  if (!Array.isArray(contracts)) throw new TypeError('menu contracts must be an array');
  const byId = new Map();
  const byRoute = new Map();
  for (const contract of contracts) {
    if (!contract
      || contract.version !== MENU_CONTRACT_VERSION
      || !VALIDATED_MENU_CONTRACTS.has(contract)) {
      throw new TypeError('invalid menu contract');
    }
    if (byId.has(contract.id)) throw new Error(`duplicate menu id: ${contract.id}`);
    byId.set(contract.id, contract);
    for (const route of contract.routes) {
      if (byRoute.has(route)) throw new Error(`duplicate route: ${route}`);
      byRoute.set(route, contract);
    }
  }
  return Object.freeze({
    getById(id) { return byId.get(cleanText(id)) || null; },
    getByRoute(route) { return byRoute.get(cleanText(route)) || null; },
    list() { return Object.freeze([...byId.values()]); },
    size: byId.size,
  });
}
