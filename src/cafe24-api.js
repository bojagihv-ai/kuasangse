const CAFE24_CONTROL_API = {
  hubBase: 'http://127.0.0.1:4321',
  controlBase: 'http://127.0.0.1:8787',
  connectorId: 'cafe24_control_tower',
  defaultMallId: 'bojagi1928',
  registeredRedirectUri: 'https://cafe24-callback.bojagihv.shop/api/auth/cafe24/callback',
  endpoints: {
    products: 'products',
    catalog: 'cafe24-catalog',
    console: 'console-products',
    oauthRefresh: 'refresh-token',
    oauthStatus: 'setup-status',
    oauthConnections: 'connections',
  },
};

let cafe24ConsolePayloadGuard = null;

function installCafe24ConsolePayloadGuard(guard = null) {
  if (!guard ||
      typeof guard.preflightProduct !== 'function' ||
      typeof guard.sanitizeProduct !== 'function') {
    cafe24ConsolePayloadGuard = null;
    return false;
  }
  cafe24ConsolePayloadGuard = guard;
  return true;
}

const CAFE24_OAUTH_PREFLIGHT_CACHE_MS = 60 * 1000;
const CAFE24_OAUTH_REFRESH_WARNING_SECONDS = 3 * 24 * 60 * 60;
const CAFE24_OAUTH_AUTO_REFRESH_INTERVAL_MS = 80 * 60 * 1000;
const CAFE24_CONTROL_READY_LEASE_MS = 30 * 1000;
let cafe24OAuthPreflightPromise = null;
let cafe24OAuthPreflightUntil = 0;
const cafe24OAuthRefreshPromises = new Map();
let cafe24OAuthAutoRefreshTimer = null;
let cafe24OAuthAutoRefreshPromise = null;
let cafe24ControlReadyPromise = null;
let cafe24ControlReadyUntil = 0;

const ANALYSIS_MATCH_SOURCE_DEFS = [
  {
    id: 'sinhwa',
    label: '신화사DB',
    badge: '실검색/자동적용',
    description: '이미지 추론 단서와 입력명을 신화사 상품명 검색에 넣고, 가장 맞는 상품의 규격/색상/재고/원가를 오른쪽 기준값에 반영합니다.',
  },
  {
    id: 'cafe24',
    label: 'Cafe24',
    badge: '스냅샷 보조검색',
    description: '저장된 Cafe24 상품 스냅샷에서 같은 제품 후보를 찾아 상품번호, 상품코드, 가격, 진열/판매 상태를 보조값으로 반영합니다.',
  },
  {
    id: 'sachyo',
    label: '사쵸박사',
    badge: '연결 확인',
    description: '현재 API Hub에는 검색 엔드포인트가 없어서 선택 상태와 연결 필요 로그만 표시합니다. 검색 API가 붙으면 같은 구조로 추가됩니다.',
  },
];

function unwrapApiHubBody(data) {
  return data?.response?.body ?? data?.body ?? data;
}

function formatApiErrorMessage(payload, fallback = 'API 호출 실패') {
  if (payload === null || payload === undefined) return fallback;
  if (typeof payload === 'string') return payload || fallback;
  if (typeof payload?.message === 'string' && payload.message.trim()) return payload.message.trim();
  if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error.trim();
  if (payload?.error) return formatApiErrorMessage(payload.error, fallback);
  if (payload?.response?.body) return formatApiErrorMessage(payload.response.body, fallback);
  if (payload?.body) return formatApiErrorMessage(payload.body, fallback);
  try {
    const text = JSON.stringify(payload);
    return text && text !== '{}' ? text.slice(0, 500) : fallback;
  } catch(_) {
    return fallback;
  }
}

function sanitizeCafe24SensitiveText(value = '') {
  let text = String(value || '');
  if (!text) return '';
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [마스킹]');
  text = text.replace(/((?:access|refresh)[_-]?token|client[_-]?secret|authorization|api[_-]?key|webhook[_-]?key)\s*[:=]\s*["']?[^\s,"'}`]+/gi, '$1=[마스킹]');
  text = text.replace(/((?:access|refresh)[_-]?token|client[_-]?secret|authorization|api[_-]?key|webhook[_-]?key)=([^&\s]+)/gi, '$1=[마스킹]');
  return text;
}

function compactCafe24ApiErrorText(value = '') {
  const text = sanitizeCafe24SensitiveText(value).trim();
  if (!text) return '';
  const jsonStart = text.indexOf('{');
  if (jsonStart >= 0) {
    const prefix = text.slice(0, jsonStart).trim().replace(/[:：]\s*$/, '');
    try {
      const message = formatApiErrorMessage(JSON.parse(text.slice(jsonStart)), '');
      const compact = [prefix, message].filter(Boolean).join(': ');
      if (compact) return compact.length > 700 ? `${compact.slice(0, 700)}...` : compact;
    } catch(_) {}
  }
  return text.length > 700 ? `${text.slice(0, 700)}...` : text;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch(e) { json = { raw: text }; }
    if (!res.ok) {
      throw new Error(formatApiErrorMessage(json, `HTTP ${res.status}`));
    }
    return json;
  } catch(e) {
    const message = String(e?.message || e || '');
    if (e?.name === 'AbortError' || /aborted/i.test(message)) {
      const seconds = Math.max(1, Math.round(Number(timeoutMs || 0) / 1000));
      throw new Error(`요청 시간이 ${seconds}초를 넘어 중단되었습니다. 사용자가 취소한 것이 아니라 Cafe24/API Hub 응답 대기가 너무 길어진 상태입니다. 잠시 후 다시 실행하거나 API Hub/Cafe24 응답 상태를 확인해주세요.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function invokeSinhwaDbEndpoint(endpointId, payload = {}) {
  const url = `${SINHWA_DB_API.hubBase}/api/invoke/${SINHWA_DB_API.connectorId}/${endpointId}`;
  const data = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(normalizeApiHubInvokeRequest(payload)),
  });
  if (data?.ok === false || Number(data?.status || 200) >= 400) {
    throw new Error(formatApiErrorMessage(data, data?.statusText || `API Hub 호출 실패 (${data?.status || 'unknown'})`));
  }
  return unwrapApiHubBody(data);
}

function normalizeApiHubInvokeRequest(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { body: payload };
  }
  const requestKeys = ['pathParams', 'query', 'body', 'headers', 'method'];
  if (requestKeys.some(key => Object.prototype.hasOwnProperty.call(payload, key))) {
    return payload;
  }
  return { body: payload };
}

async function invokeApiHubConnector(connectorId, endpointId, payload = {}, timeoutMs = 12000) {
  const url = `${CAFE24_CONTROL_API.hubBase}/api/invoke/${connectorId}/${endpointId}`;
  const data = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(normalizeApiHubInvokeRequest(payload)),
  }, timeoutMs);
  if (data?.ok === false || Number(data?.status || 200) >= 400) {
    throw new Error(formatApiErrorMessage(data, data?.statusText || `API Hub 호출 실패 (${data?.status || 'unknown'})`));
  }
  return unwrapApiHubBody(data);
}

async function invokeCafe24Endpoint(endpointId, payload = {}, options = {}) {
  const skipOAuthPreflight = options?.skipOAuthPreflight === true
    || endpointId === CAFE24_CONTROL_API.endpoints.oauthRefresh
    || endpointId === CAFE24_CONTROL_API.endpoints.oauthStatus
    || endpointId === CAFE24_CONTROL_API.endpoints.oauthConnections;
  if (!skipOAuthPreflight) {
    await ensureCafe24OAuthPreflight(payload?.mallId || payload?.body?.mallId);
  }
  return invokeApiHubConnector(CAFE24_CONTROL_API.connectorId, endpointId, payload, 180000);
}

async function fetchSinhwaDirect(path, query = {}) {
  const url = new URL(`${SINHWA_DB_API.directBase}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return fetchJsonWithTimeout(url.toString(), { headers: { 'Accept': 'application/json' } });
}

async function fetchSinhwaPdpBackend(path, query = {}, options = {}) {
  const url = new URL(`${kuasangseBackendBaseUrl()}/api/sinhwa-pdp/${String(path || '').replace(/^\/+/, '')}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return fetchJsonWithTimeout(url.toString(), {
    method: options.method || 'GET',
    headers: {
      'Accept': 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }, options.timeoutMs || 15000);
}

async function uploadSinhwaPdpWorkBundleAsset({
  bundleId,
  assetId,
  blob,
  mimeType,
  filename,
  idempotencyKey,
  version,
}) {
  const root = kuasangseBackendBaseUrl();
  const url = new URL(
    `${root}/api/sinhwa-pdp/work-bundles/${encodeURIComponent(bundleId)}`
    + `/assets/${encodeURIComponent(assetId)}/content`,
  );
  const asciiFilename = encodeURIComponent(
    String(filename || 'asset.png').trim() || 'asset.png',
  ).slice(0, 240);
  return fetchJsonWithTimeout(url.toString(), {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': String(mimeType || blob?.type || 'image/png'),
      'X-Asset-Filename': asciiFilename,
      'Idempotency-Key': String(idempotencyKey || ''),
      'If-Match': String(version || 1),
    },
    body: blob,
  }, 120000);
}

async function putSinhwaDirect(path, body = {}) {
  const url = new URL(`${SINHWA_DB_API.directBase}${path}`);
  return fetchJsonWithTimeout(url.toString(), {
    method: 'PUT',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body && typeof body === 'object' ? body : {}),
  }, 60000);
}

function kuasangseBackendBaseUrl() {
  const base = typeof factoryBackendBaseUrl === 'function'
    ? factoryBackendBaseUrl()
    : (typeof state !== 'undefined' && state?.backendBaseUrl ? state.backendBaseUrl : 'http://127.0.0.1:5050');
  return String(base || 'http://127.0.0.1:5050').replace(/\/+$/, '');
}

function isSinhwaDbOfflineError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /failed to fetch|connection refused|econnrefused|err_connection_refused|networkerror|load failed|port 8200|127\.0\.0\.1:8200|localhost:8200|local program is not running|프로그램.*실행|연결.*거부|신화사.*꺼져/.test(message);
}

function isSinhwaDbUnavailableError(error, status = null) {
  const message = String(error?.message || error || '').toLowerCase();
  if (/connection refused|econnrefused|err_connection_refused|port 8200|127\.0\.0\.1:8200|localhost:8200|local program is not running|프로그램.*실행|연결.*거부|신화사.*꺼져/.test(message)) return true;
  return !!(status && status.ok !== false && status.running === false);
}

function isCafe24ControlOfflineError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return /connection refused|econnrefused|err_connection_refused|port 8787|127\.0\.0\.1:8787|localhost:8787|control tower.*꺼|cafe24.*꺼/.test(message);
}

function isCafe24ControlUnavailableError(error, status = null) {
  if (isCafe24ControlOfflineError(error)) return true;
  return !!(status && status.ok !== false && status.running === false);
}

function isSinhwaDbNoCandidateError(error) {
  const message = String(error?.message || error || '');
  return /신화사\s*DB에서\s*"[^"]*"\s*후보를 찾지 못했습니다/.test(message)
    || /신화사DB에서.*후보를 찾지 못했습니다/.test(message);
}

async function fetchSinhwaDbLocalStatus() {
  return fetchJsonWithTimeout(`${kuasangseBackendBaseUrl()}/api/sinhwa-db/status`, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  }, 6000);
}

async function startSinhwaDbLocalProgram() {
  return fetchJsonWithTimeout(`${kuasangseBackendBaseUrl()}/api/sinhwa-db/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: '{}',
  }, 70000);
}

async function fetchCafe24ControlStatus() {
  return fetchJsonWithTimeout(`${kuasangseBackendBaseUrl()}/api/cafe24-control/status`, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  }, 6000);
}

function cafe24OAuthStartUrl(mallId = CAFE24_CONTROL_API.defaultMallId) {
  const base = String(CAFE24_CONTROL_API.controlBase || '').replace(/\/+$/, '');
  const selectedMallId = String(mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  const query = new URLSearchParams({
    mall_id: selectedMallId,
    registered_redirect_uri: CAFE24_CONTROL_API.registeredRedirectUri,
  });
  return `${base}/api/auth/cafe24/start?${query.toString()}`;
}

function cafe24OAuthSafeCheck(check = {}) {
  return {
    id: String(check.id || '').trim(),
    label: String(check.label || '').trim(),
    status: String(check.status || '').trim().toLowerCase(),
    message: compactCafe24ApiErrorText(check.message || '').slice(0, 360),
  };
}

async function refreshCafe24OAuthToken(mallId = CAFE24_CONTROL_API.defaultMallId) {
  const selectedMallId = String(mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  const activeRefresh = cafe24OAuthRefreshPromises.get(selectedMallId);
  if (activeRefresh) return activeRefresh;
  const refreshPromise = (async () => {
    const response = await invokeCafe24Endpoint(CAFE24_CONTROL_API.endpoints.oauthRefresh, { mallId: selectedMallId });
    const body = response?.data && typeof response.data === 'object' ? response.data : response;
    const results = Array.isArray(body?.results) ? body.results : [];
    const result = results.find(item => String(item?.mall_id || '').trim() === selectedMallId) || results[0] || {};
    return {
      attempted: true,
      refreshed: result?.refreshed === true || body?.refreshed === true,
      state: String(result?.status || '').trim().toLowerCase(),
      message: compactCafe24ApiErrorText(result?.reason || result?.message || '').slice(0, 360),
    };
  })().finally(() => cafe24OAuthRefreshPromises.delete(selectedMallId));
  cafe24OAuthRefreshPromises.set(selectedMallId, refreshPromise);
  return refreshPromise;
}

function cafe24OAuthPreflightError(result = {}) {
  const state = String(result.state || '').trim().toLowerCase();
  const message = String(result.message || '').trim();
  if (['reauth_required', 'refresh_error', 'error', 'fail'].includes(state)
    || /재승인|재연결|expired|reauth|required/i.test(`${state} ${message}`)) {
    return new Error(`Cafe24 OAuth 재연결 필요: ${message || state || '갱신 권한을 확인할 수 없습니다.'}`);
  }
  return null;
}

async function ensureCafe24OAuthPreflight(mallId = CAFE24_CONTROL_API.defaultMallId) {
  const selectedMallId = String(mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  if (Date.now() < cafe24OAuthPreflightUntil) return { attempted: false, cached: true, state: 'healthy' };
  if (cafe24OAuthPreflightPromise) return cafe24OAuthPreflightPromise;
  cafe24OAuthPreflightPromise = refreshCafe24OAuthToken(selectedMallId)
    .then(result => {
      const error = cafe24OAuthPreflightError(result);
      if (error) throw error;
      cafe24OAuthPreflightUntil = Date.now() + CAFE24_OAUTH_PREFLIGHT_CACHE_MS;
      return result;
    })
    .finally(() => { cafe24OAuthPreflightPromise = null; });
  return cafe24OAuthPreflightPromise;
}

async function fetchCafe24OAuthConnection(mallId = CAFE24_CONTROL_API.defaultMallId) {
  const selectedMallId = String(mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  const response = await invokeCafe24Endpoint(
    CAFE24_CONTROL_API.endpoints.oauthConnections,
    { body: { mallId: selectedMallId } },
    { skipOAuthPreflight: true },
  );
  const body = response?.data && typeof response.data === 'object' ? response.data : response;
  const rows = Array.isArray(body?.data) ? body.data : (Array.isArray(body) ? body : []);
  const connection = rows.find(item => String(item?.mall_id || '').trim() === selectedMallId) || rows[0] || {};
  const refreshTokenExpiresInSeconds = Number(connection?.refresh_token_expires_in_seconds);
  return {
    found: !!connection?.mall_id,
    tokenStatus: String(connection?.token_status || connection?.status || '').trim().toLowerCase(),
    refreshTokenExpiresAt: String(connection?.refresh_token_expires_at || '').trim(),
    refreshTokenExpiresInSeconds: Number.isFinite(refreshTokenExpiresInSeconds) ? refreshTokenExpiresInSeconds : null,
  };
}

function formatCafe24Remaining(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  if (days > 0) return `${days}일 ${hours}시간`;
  return `${hours}시간`;
}

async function fetchCafe24OAuthStatus(mallId = CAFE24_CONTROL_API.defaultMallId) {
  const selectedMallId = String(mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  let autoRefresh = { attempted: false, refreshed: false, state: '', message: '' };
  try {
    autoRefresh = await refreshCafe24OAuthToken(selectedMallId);
  } catch (error) {
    autoRefresh = {
      attempted: true,
      refreshed: false,
      state: 'refresh_error',
      message: compactCafe24ApiErrorText(error?.message || error).slice(0, 360),
    };
  }
  const response = await invokeCafe24Endpoint(CAFE24_CONTROL_API.endpoints.oauthStatus, {}, { skipOAuthPreflight: true });
  const body = response?.data && typeof response.data === 'object' ? response.data : response;
  const checks = Array.isArray(body?.checks) ? body.checks.map(cafe24OAuthSafeCheck) : [];
  const tokenCheck = checks.find(check => check.id === 'token-keeper');
  const connectionCheck = checks.find(check => check.id === 'mall-connection');
  const scopeCheck = checks.find(check => check.id === 'scopes');
  const publicUrlCheck = checks.find(check => check.id === 'public-url');
  const oauthRedirectUrl = String(body?.oauth_redirect_url || '').trim();
  const callbackWarning = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//i.test(oauthRedirectUrl);
  let connectionInfo = { found: false, tokenStatus: '', refreshTokenExpiresAt: '', refreshTokenExpiresInSeconds: null };
  try {
    connectionInfo = await fetchCafe24OAuthConnection(selectedMallId);
  } catch (_) {}
  const missingScopes = Array.isArray(body?.missing_scopes)
    ? body.missing_scopes.map(scope => String(scope || '').trim()).filter(Boolean).slice(0, 40)
    : [];
  const tokenMessage = tokenCheck?.message || '';
  const connectionMessage = connectionCheck?.message || '';
  const needsReauth = tokenCheck?.status === 'fail'
    || /만료|재승인|재연결|expired|reauth|refresh(?:[_\s-]*(?:required|expired|fail|error))/i.test(`${tokenMessage} ${connectionMessage} ${autoRefresh.state} ${autoRefresh.message}`);
  const connectionFailed = ['fail', 'error'].includes(connectionCheck?.status);
  const scopeFailed = scopeCheck?.status === 'fail';
  const hasCoreChecks = !!tokenCheck && !!connectionCheck && !!scopeCheck;
  const controlReady = hasCoreChecks && !connectionFailed && !scopeFailed;
  const refreshWarning = Number.isFinite(connectionInfo.refreshTokenExpiresInSeconds)
    && connectionInfo.refreshTokenExpiresInSeconds > 0
    && connectionInfo.refreshTokenExpiresInSeconds <= CAFE24_OAUTH_REFRESH_WARNING_SECONDS;
  const refreshWarningMessage = refreshWarning
    ? `Cafe24 OAuth 갱신 권한 만료까지 ${formatCafe24Remaining(connectionInfo.refreshTokenExpiresInSeconds)} 남았습니다. 공개 HTTPS 재승인 경로를 미리 점검하세요.`
    : '';
  const callbackWarningMessage = callbackWarning
    ? 'Cafe24 재승인 콜백이 로컬 주소입니다. Cafe24 Developers의 공개 HTTPS Redirect URI와 동일한 운영 콜백 브리지가 필요합니다.'
    : '';
  const state = needsReauth
    ? 'reauth_required'
    : ((missingScopes.length || scopeFailed)
      ? 'scope_required'
      : (connectionFailed ? 'connection_error' : (controlReady ? 'ready' : 'unknown')));
  return {
    state,
    needsReauth,
    mallId: String(body?.selected_mall_id || selectedMallId || CAFE24_CONTROL_API.defaultMallId).trim(),
    checkedAt: Date.now(),
    source: 'api-hub',
    scopesReady: missingScopes.length === 0 && scopeCheck?.status === 'pass',
    missingScopes,
    tokenStatus: tokenCheck?.status || 'unknown',
    tokenMessage,
    connectionStatus: connectionCheck?.status || 'unknown',
    connectionMessage,
    refreshAttempted: autoRefresh.attempted,
    refreshed: autoRefresh.refreshed,
    refreshState: autoRefresh.state,
    refreshMessage: autoRefresh.message,
    message: needsReauth
      ? 'Cafe24 OAuth access 토큰이 만료되어 재연결이 필요합니다.'
      : ((missingScopes.length || scopeFailed)
        ? `Cafe24 권한 범위 ${missingScopes.length || 1}개 확인이 필요합니다.`
        : (connectionFailed
          ? 'Cafe24 OAuth 연결 상태를 확인할 수 없습니다. 연결을 다시 점검해주세요.'
          : (refreshWarningMessage || callbackWarningMessage || (controlReady ? 'Cafe24 OAuth 연결 상태가 정상입니다.' : 'Cafe24 OAuth 상태 응답이 불완전합니다. 상태를 다시 확인해주세요.')))),
    refreshTokenExpiresAt: connectionInfo.refreshTokenExpiresAt,
    refreshTokenExpiresInSeconds: connectionInfo.refreshTokenExpiresInSeconds,
    refreshWarning,
    refreshWarningMessage,
    oauthRedirectUrl,
    callbackWarning,
    callbackWarningMessage,
    publicUrlStatus: publicUrlCheck?.status || 'unknown',
  };
}

function runCafe24OAuthAutoRefresh(mallId, onStatus, onError) {
  if (cafe24OAuthAutoRefreshPromise) return cafe24OAuthAutoRefreshPromise;
  cafe24OAuthAutoRefreshPromise = fetchCafe24OAuthStatus(mallId)
    .then(status => {
      if (typeof onStatus === 'function') onStatus(status);
      return status;
    })
    .catch(error => {
      if (typeof onError === 'function') onError(error);
      return null;
    })
    .finally(() => { cafe24OAuthAutoRefreshPromise = null; });
  return cafe24OAuthAutoRefreshPromise;
}

function startCafe24OAuthAutoRefresh(options = {}) {
  const mallId = String(options.mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  if (cafe24OAuthAutoRefreshTimer !== null) {
    return { started: false, intervalMs: CAFE24_OAUTH_AUTO_REFRESH_INTERVAL_MS };
  }
  const tick = () => runCafe24OAuthAutoRefresh(mallId, onStatus, onError);
  cafe24OAuthAutoRefreshTimer = setInterval(tick, CAFE24_OAUTH_AUTO_REFRESH_INTERVAL_MS);
  tick();
  return { started: true, intervalMs: CAFE24_OAUTH_AUTO_REFRESH_INTERVAL_MS };
}

function stopCafe24OAuthAutoRefresh() {
  if (cafe24OAuthAutoRefreshTimer === null) return false;
  clearInterval(cafe24OAuthAutoRefreshTimer);
  cafe24OAuthAutoRefreshTimer = null;
  return true;
}

async function startCafe24ControlTowerLocalProgram() {
  return fetchJsonWithTimeout(`${kuasangseBackendBaseUrl()}/api/cafe24-control/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: '{}',
  }, 70000);
}

async function ensureCafe24ControlTowerReady() {
  if (Date.now() < cafe24ControlReadyUntil) {
    return { running: true, cached: true, started: false };
  }
  if (cafe24ControlReadyPromise) return cafe24ControlReadyPromise;
  cafe24ControlReadyPromise = (async () => {
    const status = await fetchCafe24ControlStatus();
    if (status?.running) {
      cafe24ControlReadyUntil = Date.now() + CAFE24_CONTROL_READY_LEASE_MS;
      return { ...status, cached: false, started: false };
    }
    const started = await startCafe24ControlTowerLocalProgram();
    if (!started?.running) {
      const message = started?.message || started?.error || 'Cafe24 Control Tower 실행 확인이 끝나지 않았습니다.';
      throw new Error(message);
    }
    cafe24ControlReadyUntil = Date.now() + CAFE24_CONTROL_READY_LEASE_MS;
    return { ...started, cached: false, started: true };
  })().finally(() => {
    cafe24ControlReadyPromise = null;
  });
  return cafe24ControlReadyPromise;
}

function asSinhwaProductArray(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  if (Array.isArray(data?.value)) return data.value;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function cleanDbSearchTerm(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/상세\s*페이지|상세\s*스펙|상세\s*정보|자동\s*생성|프로젝트|작업/g, '')
    .replace(/[|/]+/g, ' ')
    .trim();
}

const ANALYSIS_AI_ENGINE_DEFS = [
  { id: 'current', label: '전역 LLM 설정', desc: '모델 설정 탭의 현재 LLM을 그대로 사용합니다.' },
  { id: 'gpt_oauth', label: 'GPT OAuth', desc: 'ChatGPT 로그인 OAuth/API Hub로 이미지와 후보를 판정합니다.' },
  { id: 'gemini', label: 'Gemini', desc: 'Gemini API 또는 백엔드 연결로 이미지와 후보를 판정합니다.' },
];
const ANALYSIS_RANK_ENGINE_DEFS = [
  ...ANALYSIS_AI_ENGINE_DEFS,
  { id: 'local', label: '로컬 점수만', desc: 'LLM 없이 상품명/색상/분류 단서 점수로만 정렬합니다.' },
];

function getDefaultLlmModelForProvider(providerId) {
  return (LLM_PROVIDERS[providerId]?.models || [])[0]?.id || (providerId === 'gemini' ? 'gemini-3.5-flash' : 'gpt-5.5');
}

function normalizeAnalysisAiEngine(value, allowLocal = false) {
  const allowed = allowLocal ? ANALYSIS_RANK_ENGINE_DEFS : ANALYSIS_AI_ENGINE_DEFS;
  return allowed.some(item => item.id === value) ? value : 'current';
}

function normalizeAnalysisProviderModel(providerId, value) {
  const allowed = (LLM_PROVIDERS[providerId]?.models || []).map(item => item.id);
  return allowed.includes(value) ? value : getDefaultLlmModelForProvider(providerId);
}

function normalizeAnalysisMatchSettings(raw = null) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const sourceFlags = source.sources && typeof source.sources === 'object' ? source.sources : {};
  const sources = {
    sinhwa: sourceFlags.sinhwa !== false,
    cafe24: !!sourceFlags.cafe24,
    sachyo: !!sourceFlags.sachyo,
  };
  if (!sources.sinhwa && !sources.cafe24 && !sources.sachyo) sources.sinhwa = true;
  return {
    useName: source.useName !== false,
    useNaturalText: source.useNaturalText !== false,
    naturalText: typeof source.naturalText === 'string' ? source.naturalText : '',
    imageInferenceEngine: normalizeAnalysisAiEngine(source.imageInferenceEngine || source.imageEngine || source.inferenceEngine),
    cafe24RankEngine: normalizeAnalysisAiEngine(source.cafe24RankEngine || source.rankEngine || source.matchEngine, true),
    gptOAuthModel: normalizeAnalysisProviderModel('gpt_oauth', source.gptOAuthModel),
    geminiModel: normalizeAnalysisProviderModel('gemini', source.geminiModel),
    sources,
  };
}

function getAnalysisMatchSettings() {
  state.analysisMatchSettings = normalizeAnalysisMatchSettings(state.analysisMatchSettings);
  return state.analysisMatchSettings;
}

function flattenSearchValues(value, out = [], depth = 0) {
  if (value == null || depth > 4) return out;
  if (Array.isArray(value)) {
    value.forEach(item => flattenSearchValues(item, out, depth + 1));
  } else if (typeof value === 'object') {
    Object.values(value).forEach(item => flattenSearchValues(item, out, depth + 1));
  } else {
    const text = String(value).trim();
    if (text) out.push(text);
  }
  return out;
}

function addSearchTermVariants(rawValue, add) {
  const cleaned = cleanDbSearchTerm(rawValue);
  if (!cleaned) return;
  const pieces = [
    cleaned,
    cleaned.replace(/\([^)]*\)/g, '').trim(),
    ...cleaned.split(/[,;\n]+/).map(v => v.trim()),
  ].filter(Boolean);
  pieces.forEach(piece => {
    if (piece.length >= 2) add(piece);
    const noBundle = piece.replace(/\d+\s*개\s*묶음\s*판매|개당\s*가격|품절/g, '').trim();
    if (noBundle && noBundle !== piece) add(noBundle);
  });
}

function addTranslatedImageHints(text, add) {
  const raw = String(text || '').toLowerCase();
  if (!raw) return;
  if (/wallet|purse|지갑|장지갑/.test(raw)) {
    add('지갑');
    add('장지갑');
  }
  if (/pouch|bag|파우치|주머니/.test(raw)) {
    add('파우치');
    add('주머니');
  }
  if (/glasses|eyeglass|spectacle|sunglasses|안경/.test(raw)) {
    add('안경케이스');
    add('안경집');
  }
  if (/pencil\s*case|pen\s*case|stationery|필통|펜\s*케이스|필기구/.test(raw)) {
    add('필통');
    add('펜케이스');
  }
  if (/spoon|chopstick|cutlery|수저|젓가락/.test(raw)) add('수저집');
  if (/traditional|korean|hanbok|한국|전통|한복/.test(raw)) {
    add('전통');
    add('한국 전통');
  }
  if (/saekdong|색동|stripe|striped|줄무늬/.test(raw)) {
    add('색동');
    if (/wallet|purse|지갑|장지갑/.test(raw)) add('색동 지갑');
  }
}

function hasBoxLikeVisualContext(analysis) {
  const visualText = flattenSearchValues([
    analysis?.shape,
    analysis?.form_factor,
    analysis?.key_features,
    analysis?.visual_match_terms,
    analysis?.product_type_candidates,
    analysis?.candidate_search_queries,
    analysis?.use_cases,
    analysis?.detailed_description,
    analysis?.reasoning?.category_basis,
    analysis?.reasoning?.product_name_basis,
  ]).join(' ').toLowerCase();
  return /상자|박스|보관함|보석함|예단|돈상자|선물상자|함\b|box|gift\s*box|container|lidded|lid|뚜껑|덮개/.test(visualText);
}

function hasGlassesCaseVisualContext(analysis) {
  const visualText = flattenSearchValues([
    analysis?.product_name,
    analysis?.product_name_en,
    analysis?.category,
    analysis?.shape,
    analysis?.form_factor,
    analysis?.key_features,
    analysis?.visual_match_terms,
    analysis?.product_type_candidates,
    analysis?.candidate_search_queries,
    analysis?.use_cases,
    analysis?.detailed_description,
    analysis?.reasoning?.category_basis,
    analysis?.reasoning?.product_name_basis,
  ]).join(' ').toLowerCase();
  return /안경|안경집|안경케이스|glasses|eyeglass|spectacle|sunglasses/.test(visualText);
}

function shouldSkipImageOnlyConflictingSearchTerm(term, analysis, imageOnlyMode) {
  if (!imageOnlyMode || !term) return false;
  const raw = String(term || '').toLowerCase();
  const hasWalletTerm = /지갑|장지갑|반지갑|카드지갑|명함지갑|명함집|wallet|purse|card\s*case|business\s*card/.test(raw);
  const hasGlassesContext = hasGlassesCaseVisualContext(analysis);
  if (hasGlassesContext && /동전|지갑|wallet|purse|카드|명함|coin/.test(raw) && !/안경|glasses|eyeglass|spectacle/.test(raw)) return true;
  if (!hasWalletTerm) return false;
  const termAlsoBox = /상자|박스|보관함|보석함|예단|돈상자|선물상자|함\b|box|gift\s*box|container/.test(raw);
  return hasBoxLikeVisualContext(analysis) && !termAlsoBox;
}

function collectCurrentAnalysisImageInputs() {
  const { primaryImg, extraImgs } = getPrimaryAnalysisInput();
  return [primaryImg, ...extraImgs].filter(img => img?.base64);
}

function getCurrentAnalysisImageSignature() {
  const inputs = collectCurrentAnalysisImageInputs();
  if (!inputs.length) return '';
  return inputs.map((img, idx) => {
    const base64 = String(img.base64 || '');
    return [
      idx,
      img.mime || img.mimeType || 'image/png',
      base64.length,
      base64.slice(0, 32),
      base64.slice(-32),
    ].join(':');
  }).join('|');
}

function analysisMatchesCurrentImageInput(analysis = state.analysis) {
  const signature = getCurrentAnalysisImageSignature();
  if (!signature) return true;
  if (!analysis || typeof analysis !== 'object') return false;
  return analysis.image_input_signature === signature;
}

function attachCurrentAnalysisImageIdentity(analysis) {
  if (!analysis || typeof analysis !== 'object') return analysis;
  const signature = getCurrentAnalysisImageSignature();
  if (signature) {
    analysis.image_input_signature = signature;
    analysis.image_input_count = collectCurrentAnalysisImageInputs().length;
  }
  return analysis;
}

function clearStaleImageDependentAnalysis(reason = '') {
  if (!state.analysis || analysisMatchesCurrentImageInput(state.analysis)) return false;
  state.analysis = null;
  state.competitorData = null;
  state.analysisTimestamp = null;
  state.dbMatchBusy = false;
  state.dbMatchCandidates = [];
  state.dbMatchError = '';
  state.dbMatchLastQuery = '';
  state.dbMatchSelectionOpen = false;
  if (reason) setUiNotice(reason, 'info');
  return true;
}

function clearAnalysisMatchOutputs(options = {}) {
  if (state.analysis && typeof state.analysis === 'object') {
    [
      'cafe24_match',
      'cafe24_product_no',
      'cafe24_product_code',
      'cafe24_product_name',
      'cafe24_candidates',
      'cafe24_rank_meta',
      'source_match_summary',
      'sinhwa_match',
      'db_match',
      'db_product',
    ].forEach(key => { delete state.analysis[key]; });
    if (options.clearExperiments) {
      delete state.analysis.image_only_cafe24_experiments;
      delete state.analysis.image_only_cafe24_matrix_last;
    }
  }
  state.dbMatchBusy = false;
  state.dbMatchCandidates = [];
  state.dbMatchError = '';
  state.dbMatchLastQuery = '';
  state.dbMatchSelectionOpen = false;
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message || `작업 시간이 ${Math.round(timeoutMs / 1000)}초를 초과했습니다.`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function colorAliasTerms(value) {
  const raw = String(value || '').toLowerCase();
  const aliases = [];
  const maps = [
    [/빨|붉|홍|red|crimson/, ['빨강', '홍색', '레드']],
    [/파랑|청색|청\b|blue|navy|남색/, ['파랑', '청색', '남색']],
    [/초록|녹색|green/, ['초록', '녹색']],
    [/노랑|황색|yellow|gold/, ['노랑', '황색', '금색']],
    [/분홍|핑크|pink/, ['분홍', '핑크']],
    [/보라|자주|purple|violet/, ['보라', '자주']],
    [/검정|흑|black/, ['검정', '흑색']],
    [/하양|흰|백색|white|ivory|아이보리/, ['흰색', '백색', '아이보리']],
  ];
  maps.forEach(([pattern, terms]) => {
    if (pattern.test(raw)) aliases.push(...terms);
  });
  return aliases;
}

function collectProductSearchTermInfo(options = {}) {
  const rawAnalysis = state.analysis || {};
  const analysisFresh = options.allowStaleAnalysis === true || analysisMatchesCurrentImageInput(rawAnalysis);
  const a = analysisFresh ? rawAnalysis : {};
  const settings = normalizeAnalysisMatchSettings(options.settings || state.analysisMatchSettings);
  const imageOnlyMode = options.imageOnly === true;
  const useName = imageOnlyMode ? false : (options.useName !== undefined ? !!options.useName : settings.useName);
  const useNaturalText = imageOnlyMode ? false : (options.useNaturalText !== undefined ? !!options.useNaturalText : settings.useNaturalText);
  const includeImageInferredName = options.includeImageInferredName === true;
  const includeVisualClues = options.includeVisualClues !== false;
  const seen = new Set();
  const nameTerms = [];
  const clueTerms = [];
  const manualTerms = [];
  const analysisTerms = [];
  const imageNameTerms = [];
  const addTo = (bucket) => (term) => {
    const cleaned = cleanDbSearchTerm(term);
    const key = cleaned.toLowerCase();
    if (shouldSkipImageOnlyConflictingSearchTerm(cleaned, a, imageOnlyMode)) return;
    if (!cleaned || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    bucket.push(cleaned);
  };
  const addAux = (bucket) => (term) => {
    const cleaned = cleanDbSearchTerm(term);
    const key = cleaned.toLowerCase();
    if (shouldSkipImageOnlyConflictingSearchTerm(cleaned, a, imageOnlyMode)) return;
    if (!cleaned || key.length < 2 || bucket.some(item => item.toLowerCase() === key)) return;
    bucket.push(cleaned);
  };
  const addName = addTo(nameTerms);
  const addClue = addTo(clueTerms);
  const addManual = addAux(manualTerms);
  const addAnalysis = addAux(analysisTerms);
  const addImageName = addAux(imageNameTerms);
  if (useName) {
    const directNameKey = normalizeTextForScore(state.productName);
    [
      state.productName,
    ].forEach(value => {
      addSearchTermVariants(value, addManual);
      addSearchTermVariants(value, addName);
    });
    const projectNameForSearch = analysisFresh || !getCurrentAnalysisImageSignature()
      ? state.currentProjectName
      : '';
    if (!directNameKey) {
      [
        a.product_name,
        a.productName,
        a.product_name_ko,
        a.product_name_en,
        a.name,
        a.title,
        projectNameForSearch,
      ].forEach(value => {
        addSearchTermVariants(value, addAnalysis);
        addSearchTermVariants(value, addName);
      });
    }
  }
  if (includeImageInferredName && analysisFresh) {
    [
      a.product_name,
      a.productName,
      a.product_name_ko,
      a.product_name_en,
      a.name,
      a.title,
    ].forEach(value => {
      addSearchTermVariants(value, addImageName);
      addSearchTermVariants(value, addClue);
    });
  }
  if (includeVisualClues) {
    const visualValues = [
      a.category,
      a.product_category,
      a.usage,
      a.use_case,
      a.use_cases,
      a.material,
      a.materials,
      a.material_summary,
      a.colors,
      a.color,
      a.option_colors,
      a.size_estimate,
      a.shape,
      a.form_factor,
      a.style,
      a.style_keywords,
      a.visual_match_terms,
      a.product_type_candidates,
      a.candidate_search_queries,
      a.key_features,
      a.selling_point,
      a.selling_points,
      a.unique_selling_point,
      a.detected_text,
      a.ocr_text,
      a.text_in_image,
      a.visible_text,
      a.description,
      a.detailed_description,
      a.reasoning,
    ];
    flattenSearchValues(visualValues).forEach(value => {
      addSearchTermVariants(value, addClue);
      addTranslatedImageHints(value, addClue);
      colorAliasTerms(value).forEach(addClue);
    });
  }
  if (useNaturalText) {
    addTranslatedImageHints(settings.naturalText, addClue);
    colorAliasTerms(settings.naturalText).forEach(addClue);
    addSearchTermVariants(settings.naturalText, addClue);
  }
  const nouns = [...nameTerms, ...clueTerms].filter(term => /지갑|파우치|주머니|수저집|보자기|병보|함|케이스/.test(term)).slice(0, 4);
  const colors = [...nameTerms, ...clueTerms].filter(term => colorAliasTerms(term).length || /빨강|홍색|분홍|핑크|초록|녹색|노랑|황색|파랑|청색|남색|보라|자주|흰색|검정/.test(term)).slice(0, 4);
  colors.forEach(color => nouns.forEach(noun => {
    const colorKey = normalizeTextForScore(color);
    const nounKey = normalizeTextForScore(noun);
    if (!colorKey || !nounKey || colorKey === nounKey || nounKey.includes(colorKey) || colorKey.includes(nounKey)) return;
    addClue(`${color} ${noun}`);
    addClue(`${noun} ${color}`);
  }));
  const terms = [...nameTerms, ...clueTerms];
  return {
    terms: terms.slice(0, options.limit || 12),
    nameTerms,
    clueTerms,
    manualTerms,
    analysisTerms,
    imageNameTerms,
    analysisFresh,
    imageOnlyMode,
    settings,
  };
}

function collectSinhwaDbSearchTerms(options = {}) {
  return collectProductSearchTermInfo({ ...options, includeVisualClues: options.includeVisualClues !== false }).terms
    .slice(0, options.limit || 8);
}

function normalizeDbName(product) {
  return String(product?.jname || product?.product_name || product?.name || product?.title || '').trim();
}

function normalizeTextForScore(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[(){}\[\]_\-·,./|]/g, '');
}

function scoreSinhwaProductCandidate(product, terms, index = 0) {
  const name = normalizeDbName(product);
  const nameKey = normalizeTextForScore(name);
  const code = String(product?.jcode || product?.code || product?.id || '');
  let score = Math.max(0, 20 - index);
  terms.forEach(term => {
    const termKey = normalizeTextForScore(term);
    if (!termKey) return;
    if (code && termKey === code) score += 80;
    if (nameKey === termKey) score += 100;
    else if (nameKey.includes(termKey)) score += 65;
    else if (termKey.includes(nameKey) && nameKey.length >= 3) score += 45;
  });
  if (product?.jshow === '1' || product?.stock_status === '정상') score += 3;
  if (product?.spec || product?.width_mm || product?.depth_mm || product?.height_mm) score += 8;
  return score;
}

function candidateSearchText(product) {
  if (!product) return '';
  const raw = product.raw_json && typeof product.raw_json === 'string'
    ? (() => { try { return JSON.parse(product.raw_json); } catch(_) { return {}; } })()
    : (product.raw_json || product.raw || {});
  return flattenSearchValues([
    product.jcode,
    product.code,
    product.id,
    product.jname,
    product.jname2,
    product.product_name,
    product.productName,
    product.name,
    product.title,
    product.category,
    product.color,
    product.color_label,
    product.material,
    product.summary_description,
    product.product_tag,
    raw.product_name,
    raw.summary_description,
    raw.product_material,
    raw.product_tag,
    raw.options,
    raw.variants,
  ]).join(' ');
}

function getProductTypeIntentFlags(termInfo = {}) {
  const sourceTerms = [
    ...(termInfo?.terms || []),
    ...(termInfo?.manualTerms || []),
    ...(termInfo?.analysisTerms || []),
    ...(termInfo?.nameTerms || []),
    ...(termInfo?.clueTerms || []),
    ...(termInfo?.imageNameTerms || []),
    ...(termInfo?.cafe24QueryHints || []),
  ];
  const raw = sourceTerms.join(' ');
  const explicitPenCase = /필통|펜\s*케이스|펜케이스|필기구|문구\s*\/?\s*사무용품|pencil\s*case|pen\s*case|stationery/i.test(raw);
  const explicitGlassesCase = /안경|안경집|안경\s*케이스|안경케이스|안경\s*파우치|glasses\s*case|eyeglass|spectacle|sunglasses/i.test(raw);
  const longCaseLike = /케이스|case|반달|반월|돔형|아치형|길쭉|긴|long|narrow/i.test(raw)
    && /파우치|주머니|pouch|case|케이스|필통|펜케이스|지갑|wallet|purse/i.test(raw);
  return { explicitPenCase, explicitGlassesCase, longCaseLike };
}

function shouldSkipCafe24QueryForIntent(term, termInfo = {}) {
  if (!termInfo?.imageOnlyMode) return false;
  const intent = getProductTypeIntentFlags(termInfo);
  if (!intent.explicitPenCase) return false;
  const raw = String(term || '').toLowerCase();
  if (/안경|안경집|안경\s*케이스|안경케이스|안경\s*파우치|glasses|eyeglass|spectacle|sunglasses/.test(raw)) return true;
  return /^(파우치|주머니|pouch|pocket|케이스|case)$/.test(cleanDbSearchTerm(raw));
}

function scoreCandidateAgainstImageClues(product, termInfo, index = 0) {
  const textKey = normalizeTextForScore(candidateSearchText(product));
  if (!textKey) return 0;
  const clueTerms = [
    ...(termInfo?.clueTerms || []),
    ...(termInfo?.imageNameTerms || []),
    ...(termInfo?.cafe24QueryHints || []),
    ...(termInfo?.nameTerms || []).slice(1),
  ];
  const clueText = clueTerms.join(' ');
  const clueKey = normalizeTextForScore(clueText);
  const wantsWallet = /지갑|wallet|purse|카드|명함/.test(clueText);
  const candidateWallet = /지갑|wallet|purse|카드지갑|명함지갑|통장지갑|도장지갑/.test(textKey);
  const intent = getProductTypeIntentFlags(termInfo);
  const penCaseGuard = intent.explicitPenCase && (!intent.explicitGlassesCase || termInfo?.imageOnlyMode);
  const candidatePenCase = /필통|펜케이스|pencilcase|pencase|stationery/.test(textKey);
  const candidateGlassesCase = /안경|안경케이스|안경집|glasses|eyeglass|spectacle|sunglasses/.test(textKey);
  let score = Math.max(0, 8 - index);
  clueTerms.forEach(term => {
    const key = normalizeTextForScore(term);
    if (!key || key.length < 2) return;
    const colorOnly = colorAliasTerms(term).length > 0 && !/지갑|wallet|purse|카드|명함|색동|누비|누빔|퀼팅|퀼트|전통|한복/.test(term);
    if (textKey.includes(key)) score += colorOnly ? 2 : (key.length >= 4 ? 22 : 10);
    colorAliasTerms(term).forEach(alias => {
      const aliasKey = normalizeTextForScore(alias);
      if (aliasKey && textKey.includes(aliasKey)) score += colorOnly ? 2 : 8;
    });
  });
  if (/색동/.test(textKey) && clueTerms.some(term => /색동|전통|traditional|korean/i.test(term))) score += 18;
  if (/지갑|장지갑|wallet|purse/.test(textKey) && clueTerms.some(term => /지갑|wallet|purse/i.test(term))) score += 18;
  if (/수저|젓가락|spoon|cutlery/.test(textKey) && clueTerms.some(term => /수저|젓가락|spoon|cutlery/i.test(term))) score += 18;
  if (/카드지갑|명함지갑|카드wallet|cardwallet/.test(textKey) && /카드|명함|납작|작은|소형|직사각|rectangle|flat|지갑|wallet|purse/.test(clueText)) score += 28;
  if (candidatePenCase && /필통|펜\s*케이스|펜케이스|필기구|pencil\s*case|pen\s*case|stationery/i.test(clueText)) score += 60;
  if (/누비|누빔|퀼팅|퀼트|quilt/.test(textKey) && /누비|누빔|퀼팅|퀼트|quilt|스티치|박음|봉제|바느질|stitch|stitched|격자/.test(clueText)) score += 28;
  if (/색동/.test(textKey) && /색동|다색|여러색|줄무늬|stripe|striped|세로|컬러블록|colorblock/.test(clueText)) score += 24;
  if (/카드지갑/.test(textKey) && /카드지갑|카드 지갑/.test(clueText)) score += 34;
  if (/누비/.test(textKey) && /누비/.test(clueText)) score += 34;
  if (penCaseGuard && candidateGlassesCase) score -= 160;
  if (intent.explicitGlassesCase && candidatePenCase && !intent.explicitPenCase) score -= 90;
  if (intent.explicitPenCase && /지갑|wallet|purse|동전|coin|카드지갑|명함지갑/.test(textKey) && !candidatePenCase) score -= 70;
  if (wantsWallet && !candidateWallet) score -= 90;
  if (/수저|젓가락|spoon|cutlery/.test(textKey) && !/수저|젓가락|spoon|cutlery/.test(clueKey)) score -= 70;
  if (/보자기|공단보|양단보|겹보|보\b|wrapping/.test(textKey) && wantsWallet) score -= 110;
  return score;
}

function collectCafe24ImageOnlyQueryHints(termInfo) {
  const sourceTerms = [
    ...(termInfo?.terms || []),
    ...(termInfo?.clueTerms || []),
    ...(termInfo?.imageNameTerms || []),
  ];
  const raw = sourceTerms.join(' ');
  const intent = getProductTypeIntentFlags(termInfo);
  const add = (list, value) => {
    const cleaned = cleanDbSearchTerm(value);
    const key = cleaned.toLowerCase();
    if (shouldSkipCafe24QueryForIntent(cleaned, termInfo)) return;
    if (!cleaned || key.length < 2 || list.some(item => item.toLowerCase() === key)) return;
    list.push(cleaned);
  };
  const queries = [];
  const hasWallet = /지갑|wallet|purse|카드지갑|명함지갑|장지갑|반지갑|동전지갑/i.test(raw);
  const hasCoinWallet = /동전|coin/i.test(raw) && /지갑|주머니|파우치|wallet|purse|pouch/i.test(raw);
  const hasCardLike = /카드지갑|카드\s*지갑|명함지갑|명함\s*지갑|card\s*wallet|business\s*card|card\s*case|card\s*holder/i.test(raw);
  const hasHalfMoon = /반달|반월|half[-\s]*moon|semicircle|semi[-\s]*circle|돔형|아치형|arched|dome/i.test(raw);
  const hasGlassesCase = intent.explicitGlassesCase;
  const hasGenericPouch = /파우치|주머니|pouch|pocket|cosmetic|화장품|소품/i.test(raw);
  const hasPouch = hasGenericPouch && !intent.explicitPenCase;
  const hasPenCase = intent.explicitPenCase;
  const hasLongCaseLike = intent.longCaseLike && !intent.explicitPenCase;
  const hasBox = /상자|함|박스|box|예단|돈상자|보석함|선물상자|선물함|gift\s*box/i.test(raw);
  const hasWrapper = /보자기|보\\b|포장보|겹보|홑보|봉투|wrapper|wrap/i.test(raw);
  const hasSaekdong = /색동|다색|여러색|줄무늬|stripe|striped|세로|컬러블록|colorblock/i.test(raw);
  const hasQuilt = /누비|누빔|퀼팅|퀼트|quilt|스티치|박음|봉제|바느질|stitch|stitched|격자/i.test(raw);
  const hasTraditional = /전통|한국|한복|traditional|korean/i.test(raw);
  const shouldSearchGlassesCase = (hasGlassesCase || hasLongCaseLike) && !hasPenCase;

  if (hasPenCase) {
    [
      '필통',
      '펜케이스',
      '펜 케이스',
      '필기구 케이스',
      ...(hasQuilt ? ['누비필통', '누비 필통'] : []),
      ...(hasSaekdong ? ['색동필통', '색동 필통'] : []),
    ].forEach(value => add(queries, value));
  }
  if (shouldSearchGlassesCase) {
    ['안경케이스', '안경 케이스', '안경집', '안경 파우치'].forEach(value => add(queries, value));
  }
  if (hasHalfMoon) {
    ['반달파우치', '반달 파우치', ...(!shouldSearchGlassesCase && hasCoinWallet ? ['반달띠동전지갑', '반달 띠 동전지갑', '반달동전지갑', '반달 동전지갑'] : []), ...(!shouldSearchGlassesCase ? ['반달 지갑'] : [])].forEach(value => add(queries, value));
  }
  if (hasCoinWallet && !shouldSearchGlassesCase) {
    [...(hasHalfMoon ? ['반달띠동전지갑', '반달 띠 동전지갑', '반달동전지갑', '반달 동전지갑'] : []), '띠동전지갑', '띠 동전지갑', '동전지갑', '동전 지갑'].forEach(value => add(queries, value));
  }
  if (hasPouch) {
    ['파우치', '미니파우치', '미니 파우치', '소품파우치', '소품 파우치', '주머니'].forEach(value => add(queries, value));
  }
  if (hasPenCase) ['패브릭필통', '패브릭 필통', '자수필통', '자수 필통'].forEach(value => add(queries, value));
  if (hasCardLike) {
    ['카드지갑', '카드 지갑', '명함지갑', '명함 지갑'].forEach(value => add(queries, value));
  }
  if (hasWallet && !hasCardLike && !hasCoinWallet && !hasPouch && !shouldSearchGlassesCase) {
    ['지갑', '반지갑', '장지갑'].forEach(value => add(queries, value));
  }
  if (hasBox) {
    ['상자', '함', '예단상자', '예단비상자', '돈상자', '선물상자'].forEach(value => add(queries, value));
  }
  if (hasWrapper) {
    ['보자기', '포장보', '겹보', '홑보', '봉투'].forEach(value => add(queries, value));
  }
  if (hasSaekdong) {
    ['색동', ...(hasWallet ? ['색동 지갑', '색동 카드지갑'] : [])].forEach(value => add(queries, value));
  }
  if (hasQuilt) {
    ['누비', '누빔', '퀼팅', ...(hasWallet ? ['누비 지갑'] : [])].forEach(value => add(queries, value));
  }
  if (hasTraditional && hasWallet) {
    ['전통 지갑', '한복 지갑', '한국 전통 지갑'].forEach(value => add(queries, value));
  }
  return queries.slice(0, 24);
}

function scoreImageWeightedSinhwaCandidate(product, termInfo, index = 0) {
  return scoreSinhwaProductCandidate(product, termInfo?.terms || [], index)
    + scoreCandidateAgainstImageClues(product, termInfo, index);
}

function asCafe24ProductArray(data) {
  const body = unwrapApiHubBody(data);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.products)) return body.products;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.results)) return body.results;
  return [];
}

function parseCafe24Raw(product) {
  if (!product || typeof product !== 'object') return {};
  if (product.data?.response?.product && typeof product.data.response.product === 'object') return product.data.response.product;
  if (product.response?.product && typeof product.response.product === 'object') return product.response.product;
  if (product.data?.product && typeof product.data.product === 'object') return product.data.product;
  if (product.body?.product && typeof product.body.product === 'object') return product.body.product;
  if (product.raw_json) {
    if (typeof product.raw_json === 'object') return product.raw_json;
    try { return JSON.parse(product.raw_json); } catch(_) { return {}; }
  }
  if (product.raw && typeof product.raw === 'object') return product.raw;
  if (product.rawProduct && typeof product.rawProduct === 'object') return product.rawProduct;
  return product;
}

function normalizeCafe24ProductCandidate(product, query, score = 0, index = 0) {
  const raw = parseCafe24Raw(product);
  const numericScore = Number.isFinite(Number(score)) ? Number(score) : 0;
  return {
    source: 'Cafe24 Control Tower',
    connector_id: CAFE24_CONTROL_API.connectorId,
    matched_at: Date.now(),
    match_query: query || '',
    match_score: numericScore,
    local_match_score: numericScore,
    gpt_similarity_score: null,
    gpt_decision: '',
    gpt_reason: '',
    gpt_rank: null,
    product_no: product?.product_no ?? raw.product_no ?? '',
    product_code: product?.product_code || raw.product_code || '',
    product_name: product?.product_name || raw.product_name || '',
    display: product?.display || raw.display || '',
    selling: product?.selling || raw.selling || '',
    price: product?.price || raw.price || '',
    sale_price: product?.price || raw.price || '',
    retail_price: product?.retail_price || raw.retail_price || '',
    supply_price: product?.supply_price || raw.supply_price || '',
    summary_description: raw.summary_description || product?.summary_description || '',
    product_tag: raw.product_tag || product?.product_tag || [],
    material: raw.product_material || product?.product_material || '',
    manufacturer: raw.manufacturer_code || product?.manufacturer_code || '',
    brand: raw.brand_code || product?.brand_code || '',
    supplier: raw.supplier_code || product?.supplier_code || '',
    display_status: `${product?.display || raw.display || '-'} / ${product?.selling || raw.selling || '-'}`,
    image: raw.detail_image || raw.list_image || raw.small_image || raw.tiny_image || '',
    raw,
    rawProduct: product,
    index,
  };
}

function scoreCafe24ProductCandidate(product, termInfo, index = 0) {
  const name = String(product?.product_name || parseCafe24Raw(product).product_name || '').trim();
  const nameKey = normalizeTextForScore(name);
  const code = String(product?.product_code || parseCafe24Raw(product).product_code || product?.product_no || '');
  let score = Math.max(0, 18 - index);
  (termInfo?.terms || []).forEach(term => {
    const termKey = normalizeTextForScore(term);
    if (!termKey) return;
    if (code && normalizeTextForScore(code) === termKey) score += 90;
    if (nameKey === termKey) score += 100;
    else if (nameKey.includes(termKey)) score += 62;
    else if (termKey.includes(nameKey) && nameKey.length >= 3) score += 38;
  });
  score += scoreCandidateAgainstImageClues(product, termInfo, index);
  if (product?.display === 'T') score += 3;
  if (product?.selling === 'T') score += 3;
  return score;
}

function cafe24ProductKey(product) {
  const raw = parseCafe24Raw(product);
  return [
    product?.product_no ?? raw.product_no ?? '',
    product?.product_code || raw.product_code || '',
    product?.product_name || raw.product_name || '',
  ].join('|').toLowerCase();
}

function cafe24ConsoleIsRootProductWrite(method, path) {
  const httpMethod = String(method || '').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(httpMethod)) return false;
  const cleanPath = String(path || '').split('?')[0].replace(/\/+$/, '');
  return cleanPath === '/api/v2/admin/products' ||
    /^\/api\/v2\/admin\/products\/[^/]+$/i.test(cleanPath);
}

function cafe24ConsoleProductObjectFromPayloadBody(payloadBody) {
  if (!payloadBody || typeof payloadBody !== 'object') return null;
  if (payloadBody.product && typeof payloadBody.product === 'object') return payloadBody.product;
  return payloadBody;
}

const CAFE24_CONSOLE_UNSUPPORTED_PRODUCT_FIELD_LABELS = {
  cultural_tax_deduction: '문화비 소득공제',
  price_excluding_tax: '부가세 제외 판매가',
  product_volume: '상품 부피',
};

function cafe24ConsoleRemoveUnsupportedProductFields(product) {
  if (!product || typeof product !== 'object') return [];
  const removed = [];
  Object.entries(CAFE24_CONSOLE_UNSUPPORTED_PRODUCT_FIELD_LABELS).forEach(([field, label]) => {
    if (!Object.prototype.hasOwnProperty.call(product, field)) return;
    delete product[field];
    removed.push(`${label}(${field})`);
  });
  return removed;
}

function cafe24ConsoleSanitizeProductDetailPayload(method, path, payloadBody) {
  if (!cafe24ConsoleIsRootProductWrite(method, path)) return payloadBody;
  const product = cafe24ConsoleProductObjectFromPayloadBody(payloadBody);
  if (!product || typeof product !== 'object') return payloadBody;
  const removedUnsupported = cafe24ConsoleRemoveUnsupportedProductFields(product);
  if (removedUnsupported.length && typeof factoryLog === 'function') {
    factoryLog(`Cafe24 전송 직전 미지원 필드 제외: ${removedUnsupported.join(', ')}`, 'ok');
  }
  if (!cafe24ConsolePayloadGuard) return payloadBody;
  const preflight = cafe24ConsolePayloadGuard.preflightProduct(product);
  if (preflight.ok) return payloadBody;
  const sanitized = cafe24ConsolePayloadGuard.sanitizeProduct(product);
  if ((preflight.unsafeFields || []).length && !Object.keys(sanitized || {}).length) {
    const issues = Array.isArray(preflight.issues) ? preflight.issues.filter(Boolean).join(' ') : '';
    throw new Error(`Cafe24 전송 직전 상세설명 안전검사 실패: ${issues || '상세설명 필드가 모두 제외되었습니다.'}`);
  }
  Object.keys(product).forEach(key => { delete product[key]; });
  Object.assign(product, sanitized);
  if (typeof factoryLog === 'function') {
    factoryLog(`Cafe24 전송 직전 안전하지 않은 상세설명 제외: ${preflight.unsafeFields.join(', ')}`, 'ok');
  }
  return payloadBody;
}

async function fetchCafe24ProductsByQuery(query, limit = 80) {
  const body = await invokeCafe24Endpoint(CAFE24_CONTROL_API.endpoints.products, {
    query: { q: query, limit },
  });
  return asCafe24ProductArray(body);
}

async function fetchCafe24ProductSnapshot(limit = 5000) {
  const body = await invokeCafe24Endpoint(CAFE24_CONTROL_API.endpoints.products, {
    query: { limit },
  });
  return asCafe24ProductArray(body);
}

async function fetchCafe24ApiCatalog() {
  const body = await invokeCafe24Endpoint(CAFE24_CONTROL_API.endpoints.catalog, {});
  const unwrapped = unwrapApiHubBody(body);
  return Array.isArray(unwrapped?.data) ? unwrapped.data : (Array.isArray(unwrapped) ? unwrapped : []);
}

async function callCafe24Console(method, path, payload = {}, title = 'Cafe24 API console') {
  const controlStatus = await ensureCafe24ControlTowerReady();
  if (controlStatus?.started && typeof factoryLog === 'function') {
    factoryLog('Cafe24 전송 전 Control Tower 자동 기동 완료.', 'ok');
  }
  const mallId = payload.mallId || CAFE24_CONTROL_API.defaultMallId;
  const body = {
    mallId,
    method,
    path,
    title,
  };
  if (payload.body !== undefined) body.body = cafe24ConsoleSanitizeProductDetailPayload(method, path, payload.body);
  if (payload.executeDirect === true) body.executeDirect = true;
  const result = await invokeCafe24Endpoint(CAFE24_CONTROL_API.endpoints.console, { body });
  return unwrapApiHubBody(result);
}

async function approveCafe24ControlPlan(plan = {}, options = {}) {
  const planId = String(plan?.id || options.planId || '').trim();
  if (!planId) throw new Error('Cafe24 변경안 승인 중단: plan id가 없습니다.');
  const requirement = plan.approval_requirement && typeof plan.approval_requirement === 'object'
    ? plan.approval_requirement
    : {};
  let confirmation = String(options.confirmation || '').trim();
  if (requirement.required) {
    const phrase = String(requirement.phrase || '').trim();
    // 배치 워커에는 확인문구를 타이핑할 사람이 없다. 그런데 prompt 는 네이티브 창이라
    // 렌더러를 통째로 멈춘다 — 워커 하트비트가 그 자리에서 끊기고 등록이 영영 끝나지
    // 않는다. 실측: 방울수저집 등록이 이 자리에서 얼어붙어 CDP 평가까지 막혔다.
    // 사람의 승인은 관제탑에서 등록을 지시하는 순간 이미 끝났고, 화면에서도 이 창은
    // 확인문구가 기본값으로 채워진 채 확인만 누르는 자리다. 그 기본값을 그대로 쓴다.
    const approvalRunsHeadless = typeof classicRuntimeIsBatchWorker === 'function'
      && classicRuntimeIsBatchWorker();
    if (!confirmation && approvalRunsHeadless) confirmation = phrase;
    if (!confirmation && !approvalRunsHeadless && typeof prompt === 'function') {
      const reasons = Array.isArray(requirement.reasons) && requirement.reasons.length
        ? `\n사유: ${requirement.reasons.join(', ')}`
        : '';
      confirmation = String(prompt(`Cafe24 변경안 실행 확인문구를 입력해주세요.${reasons}\n\n확인문구: ${phrase}`, phrase) || '').trim();
    }
    if (phrase && confirmation !== phrase) {
      throw new Error(`Cafe24 변경안 승인 중단: 확인문구 "${phrase}"가 필요합니다.`);
    }
  }
  const base = String(CAFE24_CONTROL_API.controlBase || '').replace(/\/+$/, '');
  const approvalTimeoutMs = Math.max(30000, Number(options.approvalTimeoutMs || 180000));
  const data = await fetchJsonWithTimeout(`${base}/api/change-plans/${encodeURIComponent(planId)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ confirmation }),
  }, approvalTimeoutMs);
  if (data?.ok === false) {
    throw new Error(formatApiErrorMessage(data, 'Cafe24 변경안 승인 실패'));
  }
  return data?.data ?? data;
}

async function fetchCafe24ControlJobs(options = {}) {
  const base = String(CAFE24_CONTROL_API.controlBase || '').replace(/\/+$/, '');
  const limit = Math.max(1, Math.min(50, Number(options.limit || 20) || 20));
  const data = await fetchJsonWithTimeout(`${base}/api/jobs?limit=${encodeURIComponent(limit)}`, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  }, 10000);
  const body = data?.data ?? data;
  return Array.isArray(body) ? body : [];
}

function formatCafe24ControlJobError(job = {}) {
  const raw = job.error_json || job.error || '';
  if (!raw) return '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .map(item => compactCafe24ApiErrorText(item?.error || item?.message || JSON.stringify(item)))
      .filter(Boolean)
      .join(' / ');
  } catch(e) {
    return compactCafe24ApiErrorText(raw);
  }
}

async function waitCafe24ControlJob(jobRunId, options = {}) {
  const id = String(jobRunId || '').trim();
  if (!id) return null;
  const attempts = Math.max(1, Number(options.attempts || 12));
  const delayMs = Math.max(250, Number(options.delayMs || 500));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  for (let index = 0; index < attempts; index += 1) {
    const jobs = await fetchCafe24ControlJobs({ limit: 20 });
    const job = jobs.find(item => String(item?.id || '') === id) || null;
    if (onProgress) {
      try { onProgress({ attempt: index + 1, attempts, job, jobRunId: id }); } catch(_) {}
    }
    if (job && !/queued|running/i.test(String(job.status || ''))) return job;
    if (index < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  const jobs = await fetchCafe24ControlJobs({ limit: 20 }).catch(() => []);
  return jobs.find(item => String(item?.id || '') === id) || null;
}

async function fetchCafe24ProductDetailByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!productNo) return null;
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}?embed=category,categories`, { mallId }, `Read Cafe24 product ${productNo}`);
  const product = body?.data?.response?.product || body?.response?.product || body?.product || null;
  if (!product) return null;
  return {
    mall_id: mallId,
    product_no: product.product_no,
    product_code: product.product_code,
    product_name: product.product_name,
    display: product.display,
    selling: product.selling,
    price: product.price,
    retail_price: product.retail_price,
    supply_price: product.supply_price,
    raw: product,
    rawProduct: product,
    source: 'Cafe24 Admin API detail',
    matched_at: Date.now(),
  };
}

function asCafe24VariantArray(data) {
  const body = unwrapApiHubBody(data);
  const candidates = [
    body?.data?.response?.variants,
    body?.response?.variants,
    body?.variants,
    body?.data?.variants,
    body?.items,
    body?.data?.items,
    Array.isArray(body) ? body : null,
  ];
  const found = candidates.find(Array.isArray);
  return found || [];
}

function asCafe24OptionObject(data) {
  const body = unwrapApiHubBody(data);
  const candidates = [
    body?.data?.response?.option,
    body?.response?.option,
    body?.option,
    body?.data?.option,
  ];
  return candidates.find(candidate => candidate && typeof candidate === 'object') || null;
}

function asCafe24InventoryObject(data) {
  const body = unwrapApiHubBody(data);
  const candidates = [
    body?.data?.response?.inventory,
    body?.response?.inventory,
    body?.inventory,
    body?.data?.inventory,
    body?.data?.response?.inventories,
    body?.response?.inventories,
    body?.inventories,
    body?.data?.inventories,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate[0] || null;
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}

function asCafe24IconList(data) {
  const body = unwrapApiHubBody(data);
  const candidates = [
    body?.data?.response?.icons,
    body?.response?.icons,
    body?.icons,
    body?.data?.icons,
    Array.isArray(body) ? body : null,
  ];
  const found = candidates.find(Array.isArray);
  return (found || []).filter(item => item && typeof item === 'object' && item.code);
}

function asCafe24ProductIconsObject(data) {
  const body = unwrapApiHubBody(data);
  const candidates = [
    body?.data?.response?.icons,
    body?.response?.icons,
    body?.icons,
    body?.data?.icons,
  ];
  return candidates.find(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) || null;
}

function asCafe24SeoObject(data) {
  const body = unwrapApiHubBody(data);
  const candidates = [
    body?.data?.response?.seo,
    body?.response?.seo,
    body?.seo,
    body?.data?.seo,
  ];
  return candidates.find(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) || null;
}

function asCafe24ProductTagList(data) {
  const body = unwrapApiHubBody(data);
  const candidates = [
    body?.data?.response?.tags?.tags,
    body?.response?.tags?.tags,
    body?.tags?.tags,
    body?.data?.tags?.tags,
    body?.data?.response?.tags,
    body?.response?.tags,
    body?.tags,
    body?.data?.tags,
    Array.isArray(body) ? body : null,
  ];
  const found = candidates.find(Array.isArray) || [];
  return factoryDedupeRealOptionValues(found.map(item => {
    if (item && typeof item === 'object') return item.tag || item.name || item.value || item.text || '';
    return item;
  }));
}

async function fetchCafe24ProductVariantsByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!productNo) return [];
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}/variants`, { mallId }, `Read Cafe24 product variants ${productNo}`);
  return asCafe24VariantArray(body);
}

async function fetchCafe24ProductOptionsByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!productNo) return null;
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}/options`, { mallId }, `Read Cafe24 product options ${productNo}`);
  return asCafe24OptionObject(body);
}

async function fetchCafe24VariantInventory(productNo, variantCode, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!productNo || !variantCode) return null;
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}/variants/${encodeURIComponent(variantCode)}/inventories`, { mallId }, `Read Cafe24 inventory ${productNo}/${variantCode}`);
  return asCafe24InventoryObject(body);
}

async function fetchCafe24ProductIconsByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!productNo) return null;
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}/icons`, { mallId }, `Read Cafe24 product icons ${productNo}`);
  return asCafe24ProductIconsObject(body);
}

async function fetchCafe24ProductSeoByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!productNo) return null;
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}/seo`, { mallId }, `Read Cafe24 product SEO ${productNo}`);
  return asCafe24SeoObject(body);
}

async function fetchCafe24ProductTagsByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!productNo) return [];
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}/tags`, { mallId }, `Read Cafe24 product tags ${productNo}`);
  return asCafe24ProductTagList(body);
}

  async function fetchCafe24IconCatalog(mallId = CAFE24_CONTROL_API.defaultMallId) {
    const body = await callCafe24Console('GET', '/api/v2/admin/products/icons', { mallId }, 'Read Cafe24 product icon catalog');
    return asCafe24IconList(body);
  }

  async function fetchCafe24ProductMemosByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
    if (!productNo) return [];
    const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}/memos`, { mallId }, `Read Cafe24 product memos ${productNo}`);
    return factoryCafe24MemoRowsFromBody(body);
  }

async function fetchCafe24MainProducts(displayGroup, mallId = CAFE24_CONTROL_API.defaultMallId) {
  const group = String(displayGroup || '').trim();
  if (!group) return [];
  const body = await callCafe24Console('GET', `/api/v2/admin/mains/${encodeURIComponent(group)}/products?limit=100`, { mallId }, `Read Cafe24 main products ${group}`);
  const source = unwrapApiHubBody(body);
  const rows = source?.data?.response?.products || source?.response?.products || source?.products || source?.data?.products || [];
  return Array.isArray(rows) ? rows : [];
}

function factoryCafe24EndpointProbeDefinitions(productNo = '') {
  const no = String(productNo || '').trim();
  const productPath = suffix => `/api/v2/admin/products/${encodeURIComponent(no)}${suffix || ''}`;
  return [
    { key: 'product', label: '상품 기본정보', method: 'GET', path: no ? productPath('?embed=categories') : '', savePath: no ? `PUT ${productPath('')}` : 'POST /api/v2/admin/products', required: true },
    { key: 'options', label: '옵션 구조', method: 'GET', path: no ? productPath('/options') : '', savePath: no ? `PUT ${productPath('/options')}` : '새 상품 등록 payload options', required: false },
    { key: 'variants', label: '품목', method: 'GET', path: no ? productPath('/variants') : '', savePath: no ? `PUT ${productPath('/variants/{품목코드}')}` : '옵션 생성 후 품목 API', required: false },
    { key: 'icons', label: '상품 아이콘', method: 'GET', path: no ? productPath('/icons') : '', savePath: no ? `PUT ${productPath('/icons')}` : '등록 후 아이콘 API', required: false },
    { key: 'seo', label: '검색엔진 SEO', method: 'GET', path: no ? productPath('/seo') : '', savePath: no ? `PUT ${productPath('/seo')}` : '등록 후 SEO API', required: false },
    { key: 'tags', label: '상품 태그', method: 'GET', path: no ? productPath('/tags') : '', savePath: no ? `POST/DELETE ${productPath('/tags')}` : '등록 후 태그 API', required: false },
    { key: 'memos', label: '관리 메모', method: 'GET', path: no ? productPath('/memos') : '', savePath: no ? `POST/PUT ${productPath('/memos')}` : '등록 후 메모 API', required: false },
    { key: 'additionalImages', label: '추가 이미지', method: 'GET', path: no ? productPath('/additionalimages') : '', savePath: no ? `POST ${productPath('/additionalimages')}` : '등록 후 추가이미지 API', required: false, mustVerifyBeforeWrite: true },
    { key: 'iconCatalog', label: '아이콘 목록', method: 'GET', path: '/api/v2/admin/products/icons', savePath: '아이콘 선택 목록', required: false },
    { key: 'mains', label: '메인 진열 목록', method: 'GET', path: '/api/v2/admin/mains', savePath: 'POST /api/v2/admin/mains/{진열번호}/products', required: false },
  ];
}

function factoryCafe24EndpointHealthMessage(error) {
  const text = String(error?.message || error || '').replace(/\s+/g, ' ').trim();
  if (!text) return '조회 실패';
  if (/No API found|404|not found|찾을 수 없음/i.test(text)) return '현재 Cafe24 API 경로 미지원(404 No API found)';
  if (/500|Internal Server Error/i.test(text)) return '현재 Control Tower/Cafe24 응답 500';
  if (/401|403|unauthor/i.test(text)) return '권한 또는 OAuth 확인 필요';
  return text.slice(0, 140);
}

async function factoryProbeCafe24EndpointHealth(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  const defs = factoryCafe24EndpointProbeDefinitions(productNo);
  const rows = [];
  for (const def of defs) {
    const checkedAt = Date.now();
    if (!def.path) {
      rows.push({ ...def, ok: false, pending: true, status: '대기', message: '상품번호를 먼저 확정해야 합니다.', checkedAt });
      continue;
    }
    try {
      const body = await callCafe24Console(def.method || 'GET', def.path, { mallId }, `Probe Cafe24 ${def.label}`);
      const unwrapped = unwrapApiHubBody(body);
      const response = unwrapped?.data?.response || unwrapped?.response || unwrapped?.data || unwrapped || {};
      const keys = response && typeof response === 'object' ? Object.keys(response).slice(0, 5) : [];
      rows.push({
        ...def,
        ok: true,
        pending: false,
        status: '연결됨',
        message: keys.length ? `응답 확인: ${keys.join(', ')}` : '응답 확인',
        checkedAt,
      });
    } catch(e) {
      rows.push({
        ...def,
        ok: false,
        pending: false,
        status: def.required ? '필수 경로 실패' : '조회 실패',
        message: factoryCafe24EndpointHealthMessage(e),
        checkedAt,
      });
    }
  }
  return rows;
}

function factoryCafe24EndpointHealthRow(factory = factoryRuntimeReadFactory(), key = '', productNo = '') {
  const rows = Array.isArray(factory.product?.cafe24EndpointHealth) ? factory.product.cafe24EndpointHealth : [];
  if (!rows.length) return null;
  const currentProductNo = String(productNo || factoryCafe24TargetInfo(factory).productNo || '').trim();
  const checkedProductNo = String(factory.product?.cafe24EndpointHealthProductNo || '').trim();
  if (checkedProductNo && !currentProductNo) return null;
  if (checkedProductNo && currentProductNo && checkedProductNo !== currentProductNo) return null;
  return rows.find(row => String(row?.key || '') === String(key || '')) || null;
}

function factoryCafe24EndpointKnownBlocked(factory = factoryRuntimeReadFactory(), key = '', productNo = '') {
  const row = factoryCafe24EndpointHealthRow(factory, key, productNo);
  if (key === 'additionalImages') return !row || !!row.pending || !!row.warning || row.ok !== true;
  return !!row && !row.pending && row.ok === false;
}

function factoryCafe24EndpointDisabledReason(factory = factoryRuntimeReadFactory(), key = '', label = '전용 API', productNo = '') {
  const row = factoryCafe24EndpointHealthRow(factory, key, productNo);
  if (key === 'additionalImages') {
    if (!row) return `${label} 경로는 전용 API 상태 점검에서 연결됨으로 확인된 뒤에만 실제 동기화할 수 있습니다. Cafe24 상품 후보 확정 후 “전용 API 상태 점검”을 먼저 실행해주세요.`;
    if (row.pending) return `${label} 경로는 아직 대기 상태입니다. Cafe24 상품번호를 확정하고 전용 API 상태 점검을 다시 실행해주세요.`;
    if (row.warning) return `${label} 경로가 이전 점검에서 경고 상태였습니다: ${row.status || '경고'}${row.message ? ` · ${row.message}` : ''}. 추가 이미지는 경고 상태에서 실제 동기화하지 않습니다.`;
    if (row.ok === true) return '';
    const status = row.status || '조회 실패';
    const message = row.message ? ` · ${row.message}` : '';
    return `${label} 경로가 상태 점검에서 실패했습니다: ${status}${message}. 추가 이미지는 전용 API 경로가 연결됨으로 확인될 때만 실제 동기화할 수 있습니다.`;
  }
  if (!row || row.pending || row.ok !== false) return '';
  const status = row.status || '조회 실패';
  const message = row.message ? ` · ${row.message}` : '';
  return `${label} 경로가 상태 점검에서 실패했습니다: ${status}${message}. 전용 API 상태가 연결됨으로 확인될 때만 실제 동기화할 수 있습니다.`;
}

  function asCafe24NamedList(body, keys = []) {
    const source = unwrapApiHubBody(body);
    const candidates = [];
    keys.forEach(key => {
      candidates.push(source?.data?.response?.[key], source?.response?.[key], source?.[key], source?.data?.[key]);
    });
    candidates.push(source?.data?.response, source?.response, source?.data, source);
    const rows = candidates.find(Array.isArray) || [];
    return rows.map((item, index) => item && typeof item === 'object'
      ? { ...item, _factory_key: String(item.benefit_no || item.coupon_no || item.no || item.id || index + 1) }
      : { name: String(item || ''), _factory_key: String(index + 1) });
  }

  async function fetchCafe24Benefits(mallId = CAFE24_CONTROL_API.defaultMallId) {
    const body = await callCafe24Console('GET', '/api/v2/admin/benefits?limit=100', { mallId }, 'Read Cafe24 benefits');
    return asCafe24NamedList(body, ['benefits']);
  }

  async function fetchCafe24Coupons(mallId = CAFE24_CONTROL_API.defaultMallId) {
    const body = await callCafe24Console('GET', '/api/v2/admin/coupons?limit=100', { mallId }, 'Read Cafe24 coupons');
    return asCafe24NamedList(body, ['coupons']);
  }

  async function fetchCafe24ProductFullByNo(productNo, mallId = CAFE24_CONTROL_API.defaultMallId) {
  const detail = await fetchCafe24ProductDetailByNo(productNo, mallId);
  if (!detail) return null;
  try {
    const [option, variants, icons, seo, tags] = await Promise.all([
      fetchCafe24ProductOptionsByNo(productNo, mallId).catch(e => {
        detail.optionLoadError = e.message || String(e);
        return null;
      }),
      fetchCafe24ProductVariantsByNo(productNo, mallId).catch(e => {
        detail.variantLoadError = e.message || String(e);
        return [];
      }),
      fetchCafe24ProductIconsByNo(productNo, mallId).catch(e => {
        detail.iconLoadError = e.message || String(e);
        return null;
      }),
      fetchCafe24ProductSeoByNo(productNo, mallId).catch(e => {
        detail.seoLoadError = e.message || String(e);
        return null;
      }),
      fetchCafe24ProductTagsByNo(productNo, mallId).catch(e => {
        detail.tagsLoadError = e.message || String(e);
        return [];
      }),
    ]);
    if (option) {
      const optionGroups = Array.isArray(option.options) ? option.options : [];
      detail.raw = {
        ...(detail.raw || {}),
        option,
        options: optionGroups,
        has_option: option.has_option ?? detail.raw?.has_option,
        option_type: option.option_type ?? detail.raw?.option_type,
        option_list_type: option.option_list_type ?? detail.raw?.option_list_type,
        select_one_by_option: option.select_one_by_option ?? detail.raw?.select_one_by_option,
      };
      detail.rawProduct = { ...(detail.rawProduct || {}), option, options: optionGroups };
      detail.option = option;
    }
    if (variants.length) {
      detail.raw = { ...(detail.raw || {}), variants };
      detail.rawProduct = { ...(detail.rawProduct || {}), variants };
      detail.variants = variants;
    }
    if (icons) {
      detail.raw = { ...(detail.raw || {}), product_icons: icons };
      detail.rawProduct = { ...(detail.rawProduct || {}), product_icons: icons };
      detail.product_icons = icons;
    }
    if (seo) {
      detail.raw = { ...(detail.raw || {}), seo };
      detail.rawProduct = { ...(detail.rawProduct || {}), seo };
      detail.seo = seo;
    }
    if (tags.length) {
      detail.raw = { ...(detail.raw || {}), tags };
      detail.rawProduct = { ...(detail.rawProduct || {}), tags };
      detail.tags = tags;
    }
  } catch(e) {
    detail.variantLoadError = e.message || String(e);
  }
  return detail;
}

function buildCafe24SearchQueries(termInfo) {
  const terms = Array.isArray(termInfo?.terms) ? termInfo.terms : [];
  const add = (list, value) => {
    const cleaned = cleanDbSearchTerm(value);
    const key = cleaned.toLowerCase();
    if (shouldSkipCafe24QueryForIntent(cleaned, termInfo)) return;
    if (!cleaned || key.length < 2 || list.some(item => item.toLowerCase() === key)) return;
    list.push(cleaned);
  };
  const queries = [];
  if (termInfo?.imageOnlyMode) {
    const imageOnlyHints = collectCafe24ImageOnlyQueryHints(termInfo);
    termInfo.cafe24QueryHints = imageOnlyHints;
    imageOnlyHints.forEach(value => add(queries, value));
    (termInfo?.imageNameTerms || []).forEach(value => add(queries, value));
  } else {
    (termInfo?.manualTerms || []).forEach(value => add(queries, value));
    (termInfo?.analysisTerms || []).forEach(value => add(queries, value));
    (termInfo?.nameTerms || []).forEach(value => add(queries, value));
  }
  terms.filter(term => /지갑|파우치|주머니|필통|펜케이스|펜\s*케이스|필기구|수저집|보자기|병보|함|케이스/.test(term)).forEach(value => add(queries, value));
  terms.forEach(value => add(queries, value));
  return queries.slice(0, termInfo?.imageOnlyMode ? 24 : 8);
}

async function findCafe24CandidateMatches(termInfo) {
  const queries = buildCafe24SearchQueries(termInfo);
  if (!queries.length) throw new Error('Cafe24 검색에 사용할 단서가 없습니다.');
  const candidateMap = new Map();
  const failures = [];
  const addCandidate = (product, index = 0, source = 'snapshot', query = '') => {
    if (!product) return;
    const key = cafe24ProductKey(product);
    if (!key.trim()) return;
    const sourceBoost = source === 'query' ? 36 : 0;
    const directBoost = (termInfo?.manualTerms || []).some(term => normalizeTextForScore(product?.product_name || parseCafe24Raw(product).product_name || '') === normalizeTextForScore(term)) ? 45 : 0;
    const score = scoreCafe24ProductCandidate(product, termInfo, index) + sourceBoost + directBoost;
    const minScore = termInfo?.imageOnlyMode ? 16 : 25;
    if (score < minScore) return;
    const previous = candidateMap.get(key);
    if (previous) {
      const queries = new Set([...(previous.queries || []), query].filter(Boolean));
      previous.queries = [...queries];
      if (score > previous.score) {
        candidateMap.set(key, { ...previous, product, index, score, query, source, queries: [...queries] });
      }
    } else {
      candidateMap.set(key, { product, index, score, query, source, queries: query ? [query] : [] });
    }
  };
  const requestedLimit = termInfo?.candidateLimit || (termInfo?.imageOnlyMode ? 120 : 24);
  const queryFetchLimit = Math.max(
    24,
    Math.min(termInfo?.imageOnlyMode ? 120 : 64, requestedLimit * 2)
  );
  const queryResults = await Promise.allSettled(queries.map(query =>
    fetchCafe24ProductsByQuery(query, queryFetchLimit)
  ));
  for (let queryIndex = 0; queryIndex < queryResults.length; queryIndex += 1) {
    const query = queries[queryIndex];
    const result = queryResults[queryIndex];
    if (result.status === 'fulfilled') {
      result.value.forEach((product, index) => addCandidate(product, index, 'query', query));
    } else {
      failures.push(`${query}: ${result.reason?.message || result.reason}`);
    }
  }
  let snapshotCount = 0;
  const snapshotThreshold = termInfo?.imageOnlyMode ? 40 : Math.min(16, requestedLimit);
  if (candidateMap.size < snapshotThreshold) {
    try {
      const snapshotLimit = Math.max(
        120,
        Math.min(termInfo?.imageOnlyMode ? 1200 : 600, requestedLimit * 12)
      );
      const snapshot = await fetchCafe24ProductSnapshot(snapshotLimit);
      snapshotCount = snapshot.length;
      snapshot.forEach((product, index) => addCandidate(product, index, 'snapshot', 'Cafe24 보조 스냅샷'));
    } catch(e) {
      failures.push(`Cafe24 보조 스냅샷: ${e?.message || e}`);
    }
  }
  const allRanked = [...candidateMap.values()].sort((a, b) => b.score - a.score);
  const limit = requestedLimit;
  let ranked = allRanked.slice(0, limit);
  if (termInfo?.imageOnlyMode) {
    const picked = [];
    const seen = new Set();
    const add = item => {
      if (!item || picked.length >= limit) return;
      const key = cafe24ProductKey(item.product);
      if (!key || seen.has(key)) return;
      seen.add(key);
      picked.push(item);
    };
    const perQueryLimit = Math.max(3, Math.min(8, Math.ceil(limit / Math.max(queries.length, 1))));
    queries.forEach(query => {
      const queryKey = normalizeTextForScore(query);
      if (!queryKey) return;
      allRanked
        .filter(item => (item.queries || []).some(q => normalizeTextForScore(q) === queryKey))
        .slice(0, perQueryLimit)
        .forEach(add);
    });
    allRanked.forEach(add);
    ranked = picked.slice(0, limit);
  }
  if (!ranked.length) {
    const tried = queries.join(' / ');
    const suffix = failures.length ? ` (${failures.slice(0, 2).join(' / ')})` : '';
    throw new Error(`Cafe24 스냅샷에서 현재 단서 "${tried}" 후보를 찾지 못했습니다.${suffix}`);
  }
  return {
    usedQuery: ranked[0].query || queries[0] || 'Cafe24 전체 스냅샷',
    ranked,
    searchedQueries: queries,
    snapshotCount,
    candidatePoolCount: candidateMap.size,
    poolStrategy: termInfo?.imageOnlyMode ? 'recall_by_query_then_score' : 'score_only',
    failureNotes: failures,
  };
}

function buildCafe24GptRankingContext(termInfo) {
  const analysis = analysisMatchesCurrentImageInput(state.analysis) ? (state.analysis || {}) : {};
  const imageOnlyMode = termInfo?.imageOnlyMode === true;
  const intent = getProductTypeIntentFlags(termInfo);
  const penCaseGuard = intent.explicitPenCase && (!intent.explicitGlassesCase || imageOnlyMode);
  return {
    image_only_mode: imageOnlyMode,
    direct_product_name: imageOnlyMode ? '' : String(state.productName || '').trim(),
    image_ai_name: getInferredProductName(),
    image_category: analysis.category || '',
    image_colors: analysis.colors || analysis.color || [],
    image_material: analysis.material || analysis.materials || '',
    image_shape: analysis.shape || analysis.form_factor || '',
    image_key_features: analysis.key_features || [],
    image_visual_match_terms: analysis.visual_match_terms || [],
    image_product_type_candidates: analysis.product_type_candidates || [],
    image_candidate_search_queries: analysis.candidate_search_queries || [],
    visible_text: analysis.detected_text || analysis.ocr_text || analysis.text_in_image || '',
    natural_hint: imageOnlyMode ? '' : (termInfo?.settings?.naturalText || ''),
    search_terms: termInfo?.terms || [],
    manual_terms: imageOnlyMode ? [] : (termInfo?.manualTerms || []),
    image_name_terms: termInfo?.imageNameTerms || [],
    product_type_intent: {
      pen_case: !!intent.explicitPenCase,
      glasses_case: !!intent.explicitGlassesCase,
      long_case_like: !!intent.longCaseLike,
      guard: penCaseGuard
        ? '필통/펜케이스 의도가 명확하므로 안경케이스 후보는 실제 안경 단서가 있을 때만 match로 인정한다.'
        : '',
    },
    visual_priority: ['제품 실루엣', '윗부분 패턴/색동 여부', '위아래 색상 배치', '덮개/입구 모양', '직사각형/둥근형 같은 형태', '주 색상'],
    note: imageOnlyMode
      ? '이미지 단독 Cafe24 실험이다. direct_product_name/manual_terms/natural_hint는 의도적으로 비웠다. 현재 첨부 이미지와 새 이미지 판독 단서만으로 후보를 고른다. Cafe24 display=F 미진열 상품도 후보로 인정한다.'
      : 'direct_product_name이 있으면 image_ai_name보다 우선한다. Cafe24 display=F 미진열 상품도 후보로 인정한다. 이미지 판독명이 직접 입력명과 다르면 직접 입력명과 실제 시각 특징을 우선한다.',
  };
}

function compactCafe24CandidateForGpt(candidate, index = 0) {
  const raw = candidate.raw || parseCafe24Raw(candidate.rawProduct || candidate);
  return {
    rank: index + 1,
    product_no: String(candidate.product_no || raw.product_no || ''),
    product_code: candidate.product_code || raw.product_code || '',
    product_name: candidate.product_name || raw.product_name || '',
    match_queries: candidate.match_queries || [],
    display: candidate.display || raw.display || '',
    selling: candidate.selling || raw.selling || '',
    sold_out: raw.sold_out || '',
    price: candidate.price || raw.price || '',
    material: candidate.material || raw.product_material || '',
    summary: candidate.summary_description || raw.summary_description || '',
    image: candidate.image || raw.list_image || raw.small_image || '',
    local_score: Math.round(Number(candidate.match_score || candidate.local_match_score || 0)),
  };
}

function getCafe24CandidateImageAttachLimit(engine) {
  const normalized = normalizeAnalysisAiEngine(engine, true);
  if (normalized === 'gemini') return 16;
  if (normalized === 'gpt_oauth') return 7;
  return 0;
}

function selectCafe24CandidatesForImagePayloads(candidates, limit = 6, termInfo = {}) {
  const list = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({ ...candidate, _candidate_rank: index + 1 }));
  const picked = [];
  const seen = new Set();
  const add = candidate => {
    if (!candidate || picked.length >= limit) return;
    const key = cafe24ProductKey(candidate.rawProduct || candidate);
    if (!key || seen.has(key)) return;
    seen.add(key);
    picked.push(candidate);
  };

  list.slice(0, Math.min(4, limit)).forEach(add);

  const queryTerms = [
    ...(Array.isArray(termInfo?.cafe24QueryHints) ? termInfo.cafe24QueryHints : []),
    ...(Array.isArray(termInfo?.imageNameTerms) ? termInfo.imageNameTerms : []),
    ...(Array.isArray(termInfo?.terms) ? termInfo.terms : []),
  ].map(cleanDbSearchTerm).filter(Boolean);
  queryTerms.forEach(term => {
    const termKey = normalizeTextForScore(term);
    if (!termKey) return;
    const exactQueryHit = list.find(candidate => normalizeTextForScore(candidate.match_query || '') === termKey);
    add(exactQueryHit);
    const nameHit = list.find(candidate => normalizeTextForScore(candidate.product_name || parseCafe24Raw(candidate.rawProduct || candidate).product_name || '').includes(termKey));
    add(nameHit);
  });

  const byQuery = new Map();
  list.forEach(candidate => {
    const queries = Array.isArray(candidate.match_queries) && candidate.match_queries.length
      ? candidate.match_queries
      : [candidate.match_query || ''];
    queries.forEach(rawQuery => {
      const query = cleanDbSearchTerm(rawQuery || '');
      if (!query || /전체 스냅샷/.test(query)) return;
      if (!byQuery.has(query)) byQuery.set(query, candidate);
    });
  });
  [...byQuery.values()].forEach(add);

  list.forEach(add);
  return picked.slice(0, limit);
}

async function fetchCafe24CandidateImagePayloads(candidates, limit = 6) {
  const payloads = [];
  const failures = [];
  const list = Array.isArray(candidates) ? candidates : [];
  for (let i = 0; i < list.length && payloads.length < limit; i += 1) {
    const candidate = list[i];
    const raw = candidate?.raw || parseCafe24Raw(candidate?.rawProduct || candidate);
    const url = candidate?.image || raw?.detail_image || raw?.list_image || raw?.small_image || raw?.tiny_image || '';
    if (!url) continue;
    const candidateRank = Math.max(1, Math.round(Number(candidate?._candidate_rank || candidate?.candidate_rank || candidate?.rank || i + 1) || (i + 1)));
    try {
      const dataUrl = await fetchImageDataUrl(url);
      const [, mime = 'image/jpeg', base64 = ''] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) || [];
      if (!base64) throw new Error('이미지 base64 변환 실패');
      payloads.push({
        rank: candidateRank,
        product_no: candidate.product_no || raw.product_no || '',
        product_code: candidate.product_code || raw.product_code || '',
        product_name: candidate.product_name || raw.product_name || '',
        base64,
        mimeType: mime,
        name: `Cafe24 후보 이미지 rank=${candidateRank} #${candidate.product_no || raw.product_no || '-'} ${candidate.product_name || raw.product_name || ''}`.trim(),
      });
    } catch(e) {
      failures.push(`#${candidate?.product_no || raw?.product_no || i + 1}: ${e?.message || e}`);
    }
  }
  return { payloads, failures };
}

function mergeCafe24CandidatesForRecallDisplay(rankedCandidates, recallCandidates, limit = 50) {
  const ranked = Array.isArray(rankedCandidates) ? rankedCandidates : [];
  const recall = Array.isArray(recallCandidates) ? recallCandidates : [];
  const rankedByKey = new Map(ranked.map(candidate => [cafe24ProductKey(candidate.rawProduct || candidate), candidate]));
  const merged = [];
  const seen = new Set();
  const add = (candidate, recallPreserved = false) => {
    if (!candidate || merged.length >= limit) return;
    const key = cafe24ProductKey(candidate.rawProduct || candidate);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const hydrated = rankedByKey.get(key) || candidate;
    merged.push(recallPreserved ? { ...hydrated, recall_preserved: true } : hydrated);
  };

  ranked.filter(candidate => !isRejectedCafe24Candidate(candidate)).slice(0, 12).forEach(candidate => add(candidate, false));

  const byQuery = new Map();
  recall.forEach(candidate => {
    const queries = Array.isArray(candidate.match_queries) && candidate.match_queries.length
      ? candidate.match_queries
      : [candidate.match_query || ''];
    queries.forEach(rawQuery => {
      const query = cleanDbSearchTerm(rawQuery || '');
      if (!query || /전체 스냅샷/.test(query)) return;
      if (!byQuery.has(query)) byQuery.set(query, []);
      byQuery.get(query).push(candidate);
    });
  });
  [...byQuery.values()].forEach(group => {
    group.slice(0, 3).forEach(candidate => add(candidate, true));
  });

  ranked.forEach(candidate => add(candidate, false));
  recall.forEach(candidate => add(candidate, true));
  return merged.slice(0, limit);
}

function normalizeCafe24GptRanking(result) {
  const rows = Array.isArray(result?.ranked_candidates)
    ? result.ranked_candidates
    : (Array.isArray(result?.candidates) ? result.candidates : []);
  return {
    basis: String(result?.ranking_basis || result?.basis || '').trim(),
    rows: rows.map((row, index) => ({
      candidate_rank: Math.max(0, Math.round(Number(row?.rank ?? row?.candidate_rank ?? row?.candidateRank ?? row?.candidate_index ?? 0) || 0)),
      product_no: String(row?.product_no ?? '').trim(),
      product_code: String(row?.product_code ?? '').trim(),
      product_name: String(row?.product_name ?? row?.name ?? '').trim(),
      similarity_score: Math.max(0, Math.min(100, Math.round(Number(
        row?.similarity_score
        ?? row?.score
        ?? row?.match_score
        ?? row?.relevance_score
        ?? row?.visual_score
        ?? row?.confidence
        ?? 0
      ) || 0))),
      decision: String(row?.decision || 'candidate').trim(),
      reason: String(row?.reason || '').trim(),
      rank: index + 1,
    })).filter(row => row.product_no || row.product_code || row.product_name || row.candidate_rank),
  };
}

function cafe24CandidateDecisionRank(candidate) {
  const decision = String(candidate?.gpt_decision || '').toLowerCase();
  if (/match|동일|확정/.test(decision)) return 3;
  if (/candidate|유사|가능/.test(decision)) return 2;
  if (/reject|탈락|불일치/.test(decision)) return 0;
  return 1;
}

function isRejectedCafe24Candidate(candidate) {
  const rawScore = candidate?.gpt_similarity_score;
  const score = rawScore === null || rawScore === undefined || rawScore === '' ? NaN : Number(rawScore);
  if (Number.isFinite(score) && score <= 5) return true;
  return cafe24CandidateDecisionRank(candidate) === 0;
}

function isAcceptableCafe24Candidate(candidate, usedLlm = false) {
  if (!candidate) return false;
  if (!usedLlm) return true;
  if (isRejectedCafe24Candidate(candidate)) return false;
  const score = Number(candidate.gpt_similarity_score);
  return !Number.isFinite(score) || score >= 60;
}

function scoreCafe24MatrixResult(snapshot) {
  const meta = snapshot?.cafe24_rank_meta || {};
  const candidate = Array.isArray(snapshot?.cafe24_candidates)
    ? snapshot.cafe24_candidates.find(item => isAcceptableCafe24Candidate(item, meta.used_llm))
    : null;
  if (!candidate) return -1;
  const decisionScore = cafe24CandidateDecisionRank(candidate) * 10000;
  const llmScore = Number.isFinite(Number(candidate.gpt_similarity_score)) ? Number(candidate.gpt_similarity_score) * 100 : 0;
  const localScore = Number(candidate.local_match_score || candidate.match_score || 0);
  const llmBoost = meta.used_llm ? 5000 : 0;
  return decisionScore + llmBoost + llmScore + localScore;
}

async function rerankCafe24CandidatesWithGpt(termInfo, candidates, options = {}) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return { candidates: [], usedGpt: false, usedLlm: false, engine: 'none', engineLabel: '후보 없음', warning: '재랭킹할 Cafe24 후보가 없습니다.' };
  }
  const settings = getAnalysisMatchSettings();
  const engine = normalizeAnalysisAiEngine(settings.cafe24RankEngine, true);
  if (engine === 'local') {
    return {
      candidates,
      usedGpt: false,
      usedLlm: false,
      engine,
      engineLabel: '로컬 점수',
      basis: 'LLM을 사용하지 않고 상품명, 색상, 카테고리, 로컬 검색 점수만 사용했습니다.',
      warning: '',
    };
  }
  let llm;
  const runInfo = getAnalysisEngineRunInfo(engine, settings);
  try {
    llm = getAnalysisEngineClient(engine, settings);
  } catch(e) {
    return { candidates, usedGpt: false, usedLlm: false, engine, engineLabel: runInfo.providerLabel || 'LLM', warning: e?.message || 'LLM 연결을 확인할 수 없습니다.' };
  }
  if (typeof llm.rankCafe24Candidates !== 'function') {
    return { candidates, usedGpt: false, usedLlm: false, engine, engineLabel: runInfo.providerLabel || 'LLM', warning: '현재 선택한 LLM 클라이언트에 Cafe24 후보 재랭킹 함수가 없습니다.' };
  }
  const compactLimit = termInfo?.imageOnlyMode ? 40 : 20;
  const compact = candidates.slice(0, compactLimit).map(compactCafe24CandidateForGpt);
  const { primaryImg, extraImgs } = getPrimaryAnalysisInput();
  try {
    const result = await llm.rankCafe24Candidates(buildCafe24GptRankingContext(termInfo), compact, {
      primaryImg,
      extraImgs,
      candidateImages: options.candidateImages || [],
    });
    const ranking = normalizeCafe24GptRanking(result);
    const byKey = new Map();
    const byName = new Map();
    const byRank = new Map();
    ranking.rows.forEach(row => {
      if (row.product_no) byKey.set(`no:${row.product_no}`, row);
      if (row.product_code) byKey.set(`code:${row.product_code.toLowerCase()}`, row);
      if (row.product_name) byName.set(normalizeTextForScore(row.product_name), row);
      if (row.candidate_rank) byRank.set(`rank:${row.candidate_rank}`, row);
    });
    const ranked = candidates.map((candidate, candidateIndex) => {
      const normalizedName = normalizeTextForScore(candidate.product_name || '');
      const hit = byKey.get(`no:${String(candidate.product_no || '')}`)
        || byKey.get(`code:${String(candidate.product_code || '').toLowerCase()}`)
        || byRank.get(`rank:${candidateIndex + 1}`)
        || byName.get(normalizedName);
      if (!hit) return { ...candidate, gpt_similarity_score: null, gpt_decision: '', gpt_reason: '', gpt_rank: 999 };
      return {
        ...candidate,
        gpt_similarity_score: hit.similarity_score,
        gpt_decision: hit.decision,
        gpt_reason: hit.reason,
        gpt_rank: hit.rank,
        match_score: hit.similarity_score,
      };
    }).sort((a, b) => {
      const bd = cafe24CandidateDecisionRank(b);
      const ad = cafe24CandidateDecisionRank(a);
      if (bd !== ad) return bd - ad;
      const ag = Number.isFinite(Number(a.gpt_similarity_score)) ? Number(a.gpt_similarity_score) : -1;
      const bg = Number.isFinite(Number(b.gpt_similarity_score)) ? Number(b.gpt_similarity_score) : -1;
      if (bg !== ag) return bg - ag;
      return Number(b.local_match_score || b.match_score || 0) - Number(a.local_match_score || a.match_score || 0);
    });
    return {
      candidates: ranked,
      usedGpt: runInfo.providerId === 'gpt_oauth',
      usedLlm: true,
      engine,
      engineLabel: runInfo.providerLabel || 'LLM',
      modelId: runInfo.modelId || '',
      modelLabel: runInfo.modelLabel || '',
      basis: ranking.basis,
      warning: '',
    };
  } catch(e) {
    return { candidates, usedGpt: false, usedLlm: false, engine, engineLabel: runInfo.providerLabel || 'LLM', warning: `${runInfo.providerLabel || 'LLM'} 재랭킹 실패: ${e?.message || e}` };
  }
}

function applyCafe24ProductMatch(match) {
  if (!match) return;
  state.analysis = state.analysis || {};
  state.analysis.cafe24_match = match;
  state.analysis.cafe24_product_no = match.product_no || '';
  state.analysis.product_no = match.product_no || state.analysis.product_no || '';
  state.analysis.cafe24_product_code = match.product_code || '';
  state.analysis.product_code = match.product_code || state.analysis.product_code || '';
  state.analysis.display_status = match.display_status || '';
  state.analysis.display = match.display || '';
  state.analysis.selling = match.selling || '';
  state.analysis.retail_price = match.retail_price || '';
  state.analysis.supply_price = match.supply_price || '';
  state.analysis.sale_price = match.sale_price || state.analysis.sale_price || '';
  state.analysis.summary_description = match.summary_description || state.analysis.summary_description || '';
  state.analysis.search_keywords = Array.isArray(match.product_tag) ? match.product_tag.join(', ') : (match.product_tag || state.analysis.search_keywords || '');
  state.analysis.material = state.analysis.material || match.material || '';
  state.analysis.manufacturer = match.manufacturer || state.analysis.manufacturer || '';
  state.analysis.supplier = match.supplier || state.analysis.supplier || '';
  state.analysis.brand = match.brand || state.analysis.brand || '';
  if (!state.productName && match.product_name) state.productName = match.product_name;
}

function applyCafe24CandidateByProductNo(productNo) {
  const code = String(productNo || '').trim();
  const candidates = Array.isArray(state.analysis?.cafe24_candidates) ? state.analysis.cafe24_candidates : [];
  const candidate = candidates.find(item => String(item.product_no || '') === code || String(item.product_code || '') === code);
  if (!candidate) {
    setUiNotice('적용할 Cafe24 후보를 찾지 못했습니다. 후보 검색을 다시 실행해주세요.', 'warn');
    render();
    return;
  }
  applyCafe24ProductMatch(candidate);
  state.analysis.cafe24_rank_meta = {
    ...(state.analysis.cafe24_rank_meta || {}),
    manually_applied_product_no: candidate.product_no || '',
    manually_applied_at: Date.now(),
  };
  savePersistentState();
  setUiNotice(`Cafe24 후보 #${candidate.product_no || '-'} ${candidate.product_name || ''} 값을 적용했습니다.`, 'ok');
  render();
}
