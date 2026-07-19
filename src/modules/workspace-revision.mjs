const REGISTRY_KEY = 'kuasangse_workspace_revisions_v1';
const WRITER_KEY = 'kuasangse_workspace_writer_v1';
const REVISION_CAPABILITY_KEY = '__KUASANGSE_WORKSPACE_REVISION__';
const REVISION_CAPABILITY_MARKER = Symbol.for('kuasangse.workspace.revision.capability');

function cleanText(value) {
  return String(value ?? '').trim();
}

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

export function normalizeWorkspaceRevision(value) {
  if (!value || typeof value !== 'object') return null;
  const scopeId = cleanText(value.scopeId);
  const counter = finiteInteger(value.counter);
  if (!scopeId || counter < 1) return null;
  return Object.freeze({
    scopeId,
    counter,
    updatedAt: finiteInteger(value.updatedAt),
    writerId: cleanText(value.writerId) || 'unknown',
  });
}

export function compareWorkspaceRevisions(left, right) {
  const a = normalizeWorkspaceRevision(left);
  const b = normalizeWorkspaceRevision(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.scopeId !== b.scopeId) return null;
  if (a.counter !== b.counter) return Math.sign(a.counter - b.counter);
  if (a.updatedAt !== b.updatedAt) return Math.sign(a.updatedAt - b.updatedAt);
  return a.writerId.localeCompare(b.writerId);
}

export function nextWorkspaceRevision({ scopeId, current = null, writerId = '', now = Date.now() } = {}) {
  const normalizedScope = cleanText(scopeId);
  if (!normalizedScope) throw new TypeError('workspace revision scopeId is required');
  const previous = normalizeWorkspaceRevision(current);
  const sameScope = previous?.scopeId === normalizedScope ? previous : null;
  return Object.freeze({
    scopeId: normalizedScope,
    counter: (sameScope?.counter || 0) + 1,
    updatedAt: Math.max(finiteInteger(now), (sameScope?.updatedAt || 0) + 1),
    writerId: cleanText(writerId) || 'unknown',
  });
}

export function shouldApplyWorkspaceSnapshot({ candidate, current = null, scopeId = '', allowEqual = false } = {}) {
  const next = normalizeWorkspaceRevision(candidate);
  const activeScope = cleanText(scopeId);
  if (!next || !activeScope || next.scopeId !== activeScope) return false;
  const active = normalizeWorkspaceRevision(current);
  if (!active) return true;
  if (active.scopeId !== activeScope) return true;
  const comparison = compareWorkspaceRevisions(next, active);
  return comparison > 0 || (allowEqual && comparison === 0);
}

function parseRegistry(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(REGISTRY_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writerId(root) {
  try {
    const saved = cleanText(root.sessionStorage?.getItem(WRITER_KEY));
    if (saved) return saved;
    const created = root.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    root.sessionStorage?.setItem(WRITER_KEY, created);
    return created;
  } catch (_) {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export function createWorkspaceRevisionCoordinator(root = globalThis) {
  const storage = root.localStorage;
  const sessionWriterId = writerId(root);

  function current(scopeId) {
    const scope = cleanText(scopeId);
    return normalizeWorkspaceRevision(parseRegistry(storage)[scope]);
  }

  function observe(candidate, scopeId = candidate?.scopeId) {
    const scope = cleanText(scopeId);
    const next = normalizeWorkspaceRevision(candidate);
    if (!next || next.scopeId !== scope) return current(scope);
    const active = current(scope);
    const comparison = compareWorkspaceRevisions(next, active);
    if (comparison === null || comparison < 0) return active;
    const registry = parseRegistry(storage);
    registry[scope] = next;
    try { storage?.setItem(REGISTRY_KEY, JSON.stringify(registry)); } catch (_) {}
    return next;
  }

  function advance(scopeId, now = Date.now()) {
    const scope = cleanText(scopeId);
    return observe(next(scope, now), scope);
  }

  function next(scopeId, now = Date.now()) {
    const scope = cleanText(scopeId);
    return nextWorkspaceRevision({
      scopeId: scope,
      current: current(scope),
      writerId: sessionWriterId,
      now,
    });
  }

  const capability = {
    advance,
    compare: compareWorkspaceRevisions,
    current,
    next,
    observe,
    shouldApply(candidate, scopeId, options = {}) {
      return shouldApplyWorkspaceSnapshot({
        candidate,
        current: current(scopeId),
        scopeId,
        allowEqual: options.allowEqual === true,
      });
    },
    writerId: sessionWriterId,
  };
  Object.defineProperty(capability, REVISION_CAPABILITY_MARKER, {
    value: true,
    enumerable: false,
  });
  return Object.freeze(capability);
}

export function installWorkspaceRevisionGlobals(root = globalThis) {
  const existing = Object.getOwnPropertyDescriptor(root, REVISION_CAPABILITY_KEY);
  if (existing) {
    const value = existing.value;
    if (!value || value[REVISION_CAPABILITY_MARKER] !== true || !Object.isFrozen(value)) {
      throw new TypeError('conflicting workspace revision capability already exists');
    }
    if (existing.configurable) {
      Object.defineProperty(root, REVISION_CAPABILITY_KEY, {
        value,
        enumerable: false,
        writable: false,
        configurable: false,
      });
    } else if (existing.writable !== false || existing.enumerable !== false) {
      throw new TypeError('workspace revision capability descriptor is mutable');
    }
    return value;
  }
  const capability = createWorkspaceRevisionCoordinator(root);
  Object.defineProperty(root, REVISION_CAPABILITY_KEY, {
    value: capability,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return capability;
}

if (typeof window !== 'undefined') installWorkspaceRevisionGlobals(window);
