export const FACTORY_TAB_VERSION = 'factory-tab:v1';

export const FACTORY_TAB_IDS = Object.freeze([
  'factory/start',
  'factory/db',
  'factory/fields',
  'factory/competitor',
  'factory/assets',
  'factory/sections',
  'factory/publish',
]);

function clean(value) { return String(value ?? '').trim(); }

function deepFrozen(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return true;
  if (seen.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && !descriptor.get && !descriptor.set && deepFrozen(descriptor.value, seen);
  });
}

function ownValue(source, name) {
  const descriptor = source && Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || descriptor.get || descriptor.set) {
    throw new TypeError(`factory menu field ${name} must be an own value`);
  }
  return descriptor.value;
}

function requiredFunction(source, name) {
  const descriptor = source && Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function') {
    throw new TypeError(`factory menu capability ${name} must be an own function`);
  }
  return descriptor.value;
}

export function validateFactoryTabRegistry(tabRegistry) {
  if (!Array.isArray(tabRegistry) || tabRegistry.length !== FACTORY_TAB_IDS.length) {
    throw new TypeError('factory tab registry must contain exactly seven descriptors');
  }
  const seen = new Set();
  tabRegistry.forEach((descriptor, index) => {
    if (!deepFrozen(descriptor)) throw new TypeError(`factory tab registry descriptor ${index} must be immutable`);
    const id = clean(ownValue(descriptor, 'id'));
    if (id !== FACTORY_TAB_IDS[index]) throw new Error(`factory tab registry order mismatch: ${id || '<empty>'}`);
    if (seen.has(id)) throw new Error(`duplicate factory tab registry id: ${id}`);
    seen.add(id);
    if (ownValue(descriptor, 'kind') !== 'factory-tab'
      || ownValue(descriptor, 'order') !== index
      || ownValue(descriptor, 'api') !== FACTORY_TAB_VERSION) {
      throw new Error(`invalid factory tab registry descriptor: ${id}`);
    }
  });
  return tabRegistry;
}

export function validateFactoryTabs(tabs) {
  if (!(tabs instanceof Map)) throw new TypeError('factory tabs must be a Map');
  if (tabs.size !== FACTORY_TAB_IDS.length) {
    throw new Error('factory tab registry missing or extra tabs: expected exactly seven');
  }
  const seen = new Set();
  for (const id of FACTORY_TAB_IDS) {
    if (!tabs.has(id)) throw new Error(`missing factory tab: ${id}`);
    const tab = tabs.get(id);
    if (seen.has(tab) || !deepFrozen(tab)
      || ownValue(tab, 'version') !== FACTORY_TAB_VERSION
      || ownValue(tab, 'id') !== id) {
      throw new Error(`invalid factory tab: ${id}`);
    }
    for (const field of ['select', 'render', 'bind', 'onEnter', 'onLeave']) requiredFunction(tab, field);
    seen.add(tab);
  }
  for (const id of tabs.keys()) {
    if (!FACTORY_TAB_IDS.includes(id)) throw new Error(`unknown factory tab: ${clean(id)}`);
  }
  return tabs;
}
