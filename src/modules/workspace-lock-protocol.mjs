export const DEFAULT_HEARTBEAT_MS = 10_000;
export const DEFAULT_TTL_MS = 30_000;

const PUBLIC_FIELDS = [
  'mode', 'scopeId', 'leaseId', 'fencingToken', 'ownerId', 'sessionId',
  'expiresAt', 'revision', 'reasonCode', 'reason', 'updatedAt',
];

export function text(value) {
  return String(value ?? '').trim();
}

export function frozenSnapshot(value = {}) {
  const snapshot = {};
  for (const field of PUBLIC_FIELDS) snapshot[field] = value[field] ?? '';
  snapshot.fencingToken = Number(value.fencingToken) || 0;
  snapshot.expiresAt = Number(value.expiresAt) || 0;
  snapshot.revision = Number(value.revision) || 0;
  snapshot.updatedAt = Number(value.updatedAt) || Date.now();
  return Object.freeze(snapshot);
}

export function bases(root) {
  const origin = text(root.location?.origin).replace(/\/$/, '');
  return [...new Set([origin, 'http://127.0.0.1:5050', 'http://localhost:5050'].filter(Boolean))];
}

export function isDraft(scopeId) {
  return /^draft:/i.test(text(scopeId));
}

export function unavailable(scopeId, error) {
  if (isDraft(scopeId)) {
    return frozenSnapshot({
      mode: 'offline-edit', scopeId, reasonCode: 'OFFLINE_DRAFT',
      reason: '새 작업은 오프라인 편집 모드로 계속할 수 있습니다.',
    });
  }
  return frozenSnapshot({
    mode: 'readonly', scopeId, reasonCode: 'AUTHORITY_UNAVAILABLE',
    reason: `편집권 서버를 확인할 수 없어 읽기 전용으로 열었습니다.${error ? ` (${text(error.message || error)})` : ''}`,
  });
}

export function fromServer(payload, fallbackScope = '') {
  const granted = payload?.granted === true;
  const state = text(payload?.state);
  return frozenSnapshot({
    mode: granted && state !== 'readonly' ? 'editing' : (state === 'available' ? 'available' : 'readonly'),
    scopeId: text(payload?.scopeId || fallbackScope),
    leaseId: text(payload?.leaseId),
    fencingToken: Number(payload?.fencingToken) || 0,
    ownerId: text(payload?.ownerId),
    sessionId: text(payload?.sessionId),
    expiresAt: Number(payload?.expiresAt) || 0,
    revision: Number(payload?.revision) || 0,
    reasonCode: text(payload?.code),
    reason: text(payload?.reason || payload?.error),
  });
}

export class WorkspaceLockError extends Error {
  constructor(code, message, snapshot = null) {
    super(message);
    this.name = 'WorkspaceLockError';
    this.code = code;
    this.snapshot = snapshot;
  }
}
