export const STATE_OWNERSHIP_VERSION = 'state-ownership:v1';

const DEFAULT_OWNERSHIP = [
  ['shell', 'shell'],
  ['shared', 'composition'],
  ['productAnalysis', 'product-analysis'],
  ['competitors', 'competitors'],
  ['detailDocument', 'detail-document'],
  ['imageCuts', 'image-cuts'],
  ['options', 'options'],
  ['factory', 'factory'],
  ['automation', 'automation'],
  ['appPreferences', 'app-preferences'],
  ['manualUi', 'manual-ui'],
  ['productDb', 'product-db'],
  ['factoryAssets', 'factory-assets'],
  ['cafe24', 'cafe24'],
];

function cleanText(value) {
  return String(value ?? '').trim();
}

function normalizePath(value) {
  const path = cleanText(value);
  if (!path || !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(path)) {
    throw new TypeError(`invalid state path: ${path || '<empty>'}`);
  }
  return path;
}

function pathExists(state, statePath) {
  let current = state;
  for (const segment of statePath.split('.')) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return false;
    }
    current = current[segment];
  }
  return true;
}

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}

export function validateStateOwnership(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new TypeError('state ownership entries are required');
  }
  const normalized = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new TypeError(`ownership entry ${index} must be an object`);
    const path = normalizePath(entry.path);
    const owner = cleanText(entry.owner);
    if (!owner) throw new TypeError(`ownership owner is required for ${path}`);
    return Object.freeze({ path, owner });
  });
  for (let left = 0; left < normalized.length; left += 1) {
    for (let right = left + 1; right < normalized.length; right += 1) {
      const a = normalized[left].path;
      const b = normalized[right].path;
      if (a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)) {
        throw new Error(`overlapping ownership: ${a} and ${b}`);
      }
    }
  }
  return Object.freeze(normalized.slice());
}

export const STATE_PATH_OWNERSHIP = validateStateOwnership(
  DEFAULT_OWNERSHIP.map(([path, owner]) => ({ path, owner })),
);

export function ownerForStatePath(statePath, entries = STATE_PATH_OWNERSHIP) {
  const path = normalizePath(statePath);
  const ownership = validateStateOwnership(entries);
  const matches = ownership
    .filter(entry => path === entry.path || path.startsWith(`${entry.path}.`))
    .sort((left, right) => right.path.length - left.path.length);
  return matches[0]?.owner || null;
}

export function assertExhaustiveStateOwnership(state, entries = STATE_PATH_OWNERSHIP) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('state must be a plain object');
  }
  const ownership = validateStateOwnership(entries);
  for (const statePath of Object.keys(state)) {
    if (!ownerForStatePath(statePath, ownership)) throw new Error(`unowned state path: ${statePath}`);
  }
  for (const entry of ownership) {
    if (!pathExists(state, entry.path)) throw new Error(`owned state path is missing: ${entry.path}`);
  }
  return true;
}

export function createInitialAppState() {
  return freezeTree({
    shell: { route: 'upload' },
    shared: { workfile: null, composition: { lastTransition: null } },
    productAnalysis: {},
    competitors: {},
    detailDocument: {},
    imageCuts: {},
    options: {},
    factory: {},
    automation: {},
    appPreferences: {},
    manualUi: {},
    productDb: {},
    factoryAssets: {},
    cafe24: {},
  });
}
