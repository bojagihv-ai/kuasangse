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
    // 서버 응답을 자체 검사보다 **먼저** 본다.
    // 예전에는 아래 스코프 검사가 먼저 던져서, 서버가 409로 거절한 사실이
    // '권한이 바뀌었다' 로 가려졌다. 저장이 끝날 때마다 편집권을 반납하는 동작이
    // 이미지 업로드와 겹치면 서버가 409를 주는데, 화면에는 엉뚱한 이유가 보였다.
    // (GENERATE-01 간헐 실패의 실제 흐름: release 200 → POST assets 409)
    // 게다가 스코프가 그대로면 409 응답이 성공처럼 그냥 반환돼 나갔다.
    if (!response.ok) {
      throw createAuthorityError(
        'ARCHIVE_REJECTED',
        `archive mutation rejected by server (${response.status})`,
        { status: response.status, scopeId, authority: authority.snapshot?.() || null },
      );
    }
    const latest = authority.snapshot();
    // 이 시점의 쓰기는 서버가 leaseId·fencingToken·expectedRevision 으로 이미 검증해 반영했다.
    // 왕복 사이에 같은 스코프 안에서 lease 가 갱신·재획득된 것뿐이라면(하이드레이션 끝의
    // draft 브랜치 권한 복구 등) 성공한 쓰기를 실패로 뒤집을 이유가 없다. 되돌려지지도 않는다.
    // 스코프가 바뀐 경우만 위험하다. 결과를 다른 작업에 적용하면 그 작업이 오염된다.
    if (latest.scopeId !== scopeId) {
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
