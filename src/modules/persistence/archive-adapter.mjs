import { normalizeProjectScope } from './contracts.mjs';
import { publishWorkspaceFile } from './file-publish.mjs';

export async function fetchArchiveWithAuthority({
  adapter,
  authority,
  url,
  options = {},
  createAuthorityError,
}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return adapter.fetchResponse(url, options);
  const mutate = async () => {
    let payload = {};
    try {
      payload = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    } catch (error) {
      throw createAuthorityError('INVALID_ARCHIVE_BODY', 'archive mutation body must be JSON', error);
    }
    const current = authority?.snapshot?.() || null;
    const currentScope = String(current?.scopeId || '').trim();
    const currentOfflineBranch = current?.mode === 'offline-edit'
      && currentScope.startsWith('draft:');
    if (currentOfflineBranch) {
      const guardedPayload = {
        ...payload,
        authorityWorkspaceId: currentScope,
        leaseId: current.leaseId || '',
        fencingToken: Number(current.fencingToken) || 0,
        expectedRevision: Number(current.revision) || 0,
        revision: Number(current.revision) || 0,
      };
      const response = await adapter.fetchResponse(url, {
        ...options,
        body: JSON.stringify(guardedPayload),
      });
      const latest = authority?.snapshot?.() || null;
      if (!latest || latest.mode !== 'offline-edit' || latest.scopeId !== currentScope) {
        throw createAuthorityError(
          'STALE_FENCE',
          'archive mutation completed after authority changed',
          latest,
        );
      }
      return response;
    }
    const pathScope = decodeURIComponent(String(url).match(/\/workfiles\/([^/?]+)/)?.[1] || '');
    const rawScope = String(
      payload.authorityWorkspaceId
      || payload.asset?.workspaceId
      || payload.workspaceId
      || payload.currentProjectId
      || pathScope
      || '',
    ).trim();
    if (!rawScope || rawScope.startsWith('draft:')) return adapter.fetchResponse(url, options);
    const scopeId = normalizeProjectScope(rawScope);
    if (!current || current.scopeId !== scopeId || current.mode !== 'editing') {
      throw createAuthorityError('READ_ONLY', 'archive mutation requires the current edit authority', current);
    }
    const guardedPayload = {
      ...payload,
      authorityWorkspaceId: scopeId,
      leaseId: current.leaseId,
      fencingToken: current.fencingToken,
      expectedRevision: Number(current.revision) || 0,
      revision: Number(current.revision) || 0,
    };
    const response = await adapter.fetchResponse(url, { ...options, body: JSON.stringify(guardedPayload) });
    const latest = authority.snapshot();
    if (latest.scopeId !== scopeId || latest.leaseId !== current.leaseId
      || Number(latest.fencingToken) !== Number(current.fencingToken)) {
      throw createAuthorityError('STALE_FENCE', 'archive mutation completed after authority changed', latest);
    }
    return response;
  };
  return authority?.runMutation ? authority.runMutation(mutate) : mutate();
}

export function createArchiveAdapter({ root = typeof self === 'undefined' ? null : self } = {}) {
  async function fetchResponse(url, options = {}) {
    if (typeof root?.fetch !== 'function') throw new Error('archive fetch unavailable');
    return root.fetch(url, options);
  }

  async function request(url, options = {}) {
    const response = await fetchResponse(url, options);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const type = response.headers?.get?.('content-type') || '';
    return type.includes('application/json') ? response.json() : response;
  }

  async function writeHandle(handle, value, context = {}) {
    return publishWorkspaceFile({ root, handle, value, context });
  }

  return Object.freeze({
    name: 'archive',
    fetchResponse,
    request,
    writeHandle,
    async read() { return null; },
    async write(envelope, context = {}) {
      context.assertAuthority?.();
      if (context.url) {
        await request(context.url, {
          method: context.method || 'POST',
          headers: { 'Content-Type': 'application/json', ...(context.headers || {}) },
          body: JSON.stringify({
            envelope,
            workspaceId: envelope.scopeId,
            leaseId: context.leaseId || envelope.metadata.leaseId,
            fencingToken: context.fencingToken || envelope.metadata.fencingToken,
            expectedRevision: Number(context.expectedRevision) || 0,
            revision: envelope.metadata.revision.counter,
          }),
        });
        context.assertCompletion?.();
      }
      context.assertAuthority?.();
      if (context.handle) {
        await writeHandle(context.handle, context.value || JSON.stringify(envelope), {
          ...context,
          scopeId: context.scopeId || envelope.scopeId,
        });
      }
      context.assertCompletion?.();
      return envelope;
    },
  });
}
