/**
 * 새 앞면(작업대)의 관제탑 API 클라이언트.
 *
 * 옛 앞면(control-tower.html)은 세션·CSRF·주소 해석이 페이지 인라인 스크립트와 production-workbench.mjs
 * 안에 묶여 있어 나눠 쓸 수 없었다. 여기서는 그 규칙만 그대로 옮긴다:
 * - 주소는 쿼리(apiBase/apiHub/factoryBackend)로 받되 loopback http 만 허용한다.
 * - 쓰기 요청은 GET /api/session 이 준 csrfToken 을 X-Control-Tower-CSRF 로 싣는다.
 * - 오류는 {code, status, message} 로 정리해 던진다 — 화면은 code 로 사람 말을 고른다.
 */
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/u;

function fromQuery(name, fallback) {
  const value = new URLSearchParams(globalThis.location?.search || '').get(name);
  return LOOPBACK.test(value || '') ? value : fallback;
}

export const ORIGINS = Object.freeze({
  apiBase: fromQuery('apiBase', 'http://localhost:41009'),
  apiHub: fromQuery('apiHub', 'http://127.0.0.1:4321'),
  factoryBackend: fromQuery('factoryBackend', 'http://127.0.0.1:43030'),
});

export class ApiError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

let sessionPromise = null;

export function session(fetchImpl = fetch) {
  if (!sessionPromise) {
    sessionPromise = fetchImpl(`${ORIGINS.apiBase}/api/session`, { credentials: 'include' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.csrfToken) throw new ApiError('session_unavailable', response.status, '관제탑 세션을 받지 못했습니다.');
        return { csrfToken: String(body.csrfToken), sessionId: String(body.sessionId || '') };
      })
      .catch(error => { sessionPromise = null; throw error; });
  }
  return sessionPromise;
}

/** 관제탑 API 를 부른다. 쓰기(GET 이 아닌 것)는 세션 헤더를 자동으로 싣는다. */
export async function apiRequest(path, { method = 'GET', body = undefined, fetchImpl = fetch } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const current = await session(fetchImpl);
    headers['X-Control-Tower-CSRF'] = current.csrfToken;
    if (current.sessionId) headers['X-Control-Tower-Session'] = current.sessionId;
  }
  const response = await fetchImpl(`${ORIGINS.apiBase}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    const error = parsed && typeof parsed === 'object' ? parsed.error || parsed : null;
    throw new ApiError(
      String(error?.code || `http_${response.status}`),
      response.status,
      String(error?.message || `요청이 실패했습니다 (${response.status})`),
    );
  }
  return parsed;
}
