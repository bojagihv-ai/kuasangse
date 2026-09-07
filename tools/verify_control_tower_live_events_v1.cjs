// 계약: **실제 앱이 관제탑 이벤트 스트림에 붙고, 관제탑 이벤트가 오면 작업 목록을 스스로 다시 읽는다.**
//
// 주인님 2026-09-06: "작업중인게 실시간으로 동기화로 볼 수 있어야 하는데".
// EventSource 는 가짜(앱 코드보다 먼저 심는다)로 바꿔 이벤트를 우리가 쏜다. 관제탑 목록·세션·상태도 가짜.
//   1) 목록을 한 번 읽으면 앱이 세션 쿠키를 받고 지금 커서(eventCursor)부터 스트림에 붙는다 (cursor=0 아님)
//   2) 연결되면 카드에 "실시간 연결" 이 보인다
//   3) factory.product.updated 를 쏘면 1.2초 안에 목록을 다시 읽어 바뀐 상태가 화면에 보인다
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'control-tower-live-events-v1.json');

const INJECT = `(() => {
  if (window.__towerLiveV1) return;
  const st = { jobsCalls: 0, sessionCalls: 0, stateCalls: 0, sources: [], jobs: [
    { schema: 'factory-product-job:v1', jobId: 'factory-job-live-1', productName: '실시간 검사 작업', status: 'blocked', stageKey: 'representative', message: '막힘 검사', imageCount: 1, checkpointAvailable: true },
  ] };
  window.__towerLiveV1 = st;
  class FakeEventSource {
    constructor(url, options) {
      this.url = String(url); this.options = options || {}; this.readyState = 0; this.listeners = {}; this.onopen = null; this.onerror = null;
      st.sources.push(this);
      setTimeout(() => { this.readyState = 1; if (typeof this.onopen === 'function') this.onopen({ type: 'open' }); }, 50);
    }
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); }
    removeEventListener() {}
    close() { this.readyState = 2; }
    emit(type, data) { (this.listeners[type] || []).forEach(handler => handler({ type, data: JSON.stringify(data || {}) })); }
  }
  window.EventSource = FakeEventSource;
  const nativeFetch = window.fetch.bind(window);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (input, init) => {
    const url = String((input && input.url) || input || '');
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'GET' && /:\\d+\\/api\\/factory\\/jobs(?:\\?|$)/.test(url)) { st.jobsCalls += 1; return json({ jobs: st.jobs, total: st.jobs.length }); }
    if (method === 'GET' && /:\\d+\\/api\\/session(?:\\?|$)/.test(url)) { st.sessionCalls += 1; st.sessionCredentials = init && init.credentials; return json({ session: 'ready', sessionId: 'fake-session', csrfToken: 'fake-csrf' }); }
    if (method === 'GET' && /:\\d+\\/api\\/factory\\/state(?:\\?|$)/.test(url)) { st.stateCalls += 1; return json({ schema: 'factory-control-state:v1', eventCursor: '4321', connected: true }); }
    return nativeFetch(input, init);
  };
})();`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  const seed = String(Date.now());
  await cdp.send('Page.navigate', { url: `${APP_URL}?towerLive=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()} && !!window.__towerLiveV1 && typeof factoryTowerLiveConnect === 'function'`, 60000);
  await evaluate(cdp, `(() => { state.step = 'factory'; render(); return true; })()`);

  // 1) 목록을 읽으면(부팅 또는 버튼) 스트림에 붙는다.
  await waitFor(cdp, `!!document.querySelector('[data-factory-tower-jobs-refresh]')`, 15000);
  await evaluate(cdp, `(() => { const b = document.querySelector('[data-factory-tower-jobs-refresh]'); if (!state.factoryTowerJobs?.loading) b.click(); return true; })()`);
  await waitFor(cdp, `(window.__towerLiveV1.sources || []).length >= 1 && state.factoryTowerJobs?.live?.connected === true`, 20000);
  const connected = await evaluate(cdp, `(() => {
    const st = window.__towerLiveV1;
    const src = st.sources[0];
    const card = document.querySelector('[data-factory-tower-jobs]');
    return {
      sources: st.sources.length, url: src.url, withCredentials: src.options.withCredentials === true,
      sessionCalls: st.sessionCalls, sessionCredentials: st.sessionCredentials, stateCalls: st.stateCalls,
      jobsCallsBefore: st.jobsCalls,
      livePill: card?.querySelector('[data-factory-tower-live]')?.getAttribute('data-factory-tower-live') || '',
      liveText: card?.querySelector('[data-factory-tower-live]')?.innerText || '',
      listened: Object.keys(src.listeners),
      statusBefore: (state.factoryTowerJobs.items || []).map(job => job.status),
    };
  })()`);

  // 3) 관제탑에서 작업이 바뀐 척 이벤트를 쏜다 → 목록을 다시 읽어 화면이 바뀐다.
  await evaluate(cdp, `(() => {
    const st = window.__towerLiveV1;
    st.jobs = st.jobs.map(job => ({ ...job, status: 'waiting_manual', message: '5개 후보 표시 완료' }));
    st.sources[0].emit('factory.product.updated', { job: st.jobs[0] });
    return true;
  })()`);
  await waitFor(cdp, `window.__towerLiveV1.jobsCalls >= ${JSON.stringify(0)} + (${JSON.stringify(1)}) && (state.factoryTowerJobs.items || []).some(job => job.status === 'waiting_manual') && !state.factoryTowerJobs.loading`, 10000);
  const refreshed = await evaluate(cdp, `(() => {
    const card = document.querySelector('[data-factory-tower-jobs]');
    return {
      jobsCallsAfter: window.__towerLiveV1.jobsCalls,
      statusAfter: (state.factoryTowerJobs.items || []).map(job => job.status),
      lastEventType: state.factoryTowerJobs.live?.lastEventType || '',
      cardShowsWaiting: /사람 선택 대기/.test(card?.innerText || ''),
    };
  })()`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ connected, refreshed }, null, 2), 'utf8');
  assertChecks([
    { ok: connected.sources === 1 && /\/api\/factory\/events\?cursor=4321$/.test(connected.url),
      message: `지금 커서(4321)부터 한 번만 붙어야 합니다(cursor=0 이면 쌓인 이벤트가 쏟아진다): ${JSON.stringify(connected)}` },
    { ok: connected.withCredentials === true && connected.sessionCalls >= 1 && connected.sessionCredentials === 'include' && connected.stateCalls >= 1,
      message: `세션 쿠키(credentials include)와 상태 커서를 먼저 받아야 합니다: ${JSON.stringify(connected)}` },
    { ok: connected.livePill === 'on' && /실시간 연결/.test(connected.liveText),
      message: `연결되면 카드에 "실시간 연결" 이 보여야 합니다: ${JSON.stringify(connected)}` },
    { ok: ['factory.snapshot', 'factory.product.updated', 'factory.a_cut.selected', 'factory.stage.updated'].every(type => connected.listened.includes(type)),
      message: `관제탑 화면과 같은 이벤트를 들어야 합니다: ${JSON.stringify(connected.listened)}` },
    { ok: refreshed.jobsCallsAfter > connected.jobsCallsBefore && refreshed.statusAfter.includes('waiting_manual') && refreshed.cardShowsWaiting,
      message: `이벤트 뒤 목록을 다시 읽어 바뀐 상태("사람 선택 대기")가 화면에 보여야 합니다: ${JSON.stringify({ before: connected.jobsCallsBefore, ...refreshed })}` },
    { ok: refreshed.lastEventType === 'factory.product.updated', message: `어떤 이벤트가 왔는지 남겨야 합니다: ${JSON.stringify(refreshed)}` },
  ]);
  console.log(`[PASS] 관제탑 실시간 연결 - cursor=4321 부터 · 세션 쿠키 · "실시간 연결" 표시 · 이벤트 뒤 목록 재조회(${connected.jobsCallsBefore}→${refreshed.jobsCallsAfter}) - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
