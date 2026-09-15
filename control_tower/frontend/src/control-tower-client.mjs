export function createControlTowerClient({ apiBase, setStatus = () => {}, fetchImpl = globalThis.fetch.bind(globalThis) }) {
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(apiBase)) throw new Error('factory_api_origin_invalid');
  const API_BASE = apiBase;
  const session = { id: '', csrf: '' };
  const sendRequest = async (path, options = {}) => {
    const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    if (session.id && options.method && options.method !== "GET") headers["X-Control-Tower-Session"] = session.id;
    if (session.csrf && options.method && options.method !== "GET") headers["X-Control-Tower-CSRF"] = session.csrf;
    const response = await fetchImpl(`${API_BASE}${path}`, { ...options, cache: "no-store", headers, credentials: "include" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(body.error?.code || `HTTP_${response.status}`));
      error.status = response.status;
      error.code = String(body.error?.code || "");
      throw error;
    }
    return body;
  };
  const apiRequest = async (path, options = {}) => {
    try {
      return await sendRequest(path, options);
    } catch (error) {
      // 관제탑이 잠깐 꺼져 있는 동안 화면을 열어 두면 session 이 비어 있다. 그 뒤 첫 요청이
      // csrf_required 로 튕기면서 투입이 통째로 실패한다. 한 번은 세션을 다시 받아 재시도한다.
      if (error.code !== "csrf_required" && error.code !== "session_required") throw error;
      await loadSession();
      if (!session.id || !session.csrf) throw error;
      return sendRequest(path, options);
    }
  };
  const loadSession = async () => {
    try {
      const response = await fetchImpl(`${API_BASE}/api/session`, { credentials: "include" });
      const body = await response.json();
      session.id = String(body.sessionId || "");
      session.csrf = String(body.csrfToken || "");
      setStatus("intake-status", session.id ? "변경 요청 session 준비됨" : "session을 만들지 못했습니다.", session.id ? "ok" : "error");
    } catch (error) {
      setStatus("intake-status", `session 차단: ${String(error.message || error)}`, "error");
    }
  };

  return Object.freeze({ apiRequest, loadSession });
}
