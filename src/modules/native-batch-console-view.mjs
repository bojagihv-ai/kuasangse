import { createSingleFlight } from './batch-control-polling.mjs';
export const NATIVE_START_ERRORS = Object.freeze({
  factory_worker_already_connected: '다른 창에서 조립공장이 연결되어 있습니다. 기존 작업을 보존하기 위해 이 창에서는 시작하지 않았습니다.',
  factory_worker_build_mismatch: '실행 서버와 화면 버전이 다릅니다. 기존 작업을 저장하고 생산관제를 다시 연 뒤 시작하세요.',
  factory_worker_not_admitted: '실행 승인을 확인하지 못해 시작하지 않았습니다.',
  factory_state_invalid: '작업큐 상태를 확인하지 못해 시작하지 않았습니다.',
});

export function createNativeBatchStart({ readState, installWorker, allowExistingSession = false }) {
  const singleFlight = createSingleFlight();
  let started = false;
  return () => singleFlight(async () => {
    if (started) return;
    const state = await readState();
    if (state?.schema !== 'factory-control-projection:v1' || typeof state.connected !== 'boolean') {
      throw new Error('factory_state_invalid');
    }
    if (state.connected && !allowExistingSession) throw new Error('factory_worker_already_connected');
    const { worker } = installWorker({ replaceExistingSession: allowExistingSession });
    const admission = await worker.hello();
    if (admission?.accepted !== true) throw new Error('factory_worker_not_admitted');
    worker.startHeartbeat();
    worker.startSessionHeartbeat();
    worker.startPolling();
    worker.startProjectionPolling();
    started = true;
  });
}


export function createNativeBatchConsoleView(document, publishMenu) {
  const root = document.getElementById('app');
  const panel = document.createElement('section');
  panel.id = 'nativeBatchConsole';
  panel.setAttribute('aria-label', '생산관제 실행');
  panel.innerHTML = `
    <div class="native-batch-command">
      <strong>생산관제 · 원본 조립공장</strong>
      <button type="button" class="btn btn-primary" id="nativeBatchStart">작업큐 연결 · 시작</button>
      <button type="button" class="btn-sm" id="nativeBatchReconcile" hidden>명령 결과 다시 확인</button>
      <button type="button" class="btn-sm" id="nativeBatchSave">작업 저장</button>
      <button type="button" class="btn btn-primary" id="nativeBatchResume">저장 후 작업 재개</button>
      <button type="button" class="btn-sm" id="nativeBatchLocalRecovery" hidden>중단된 로컬 처리 확인</button>
      <span id="nativeBatchStatus" role="status" aria-live="polite">시작 대기 · 이 화면을 여는 것만으로 작업이 실행되지 않습니다.</span>
    </div>
    <nav class="factory-automation-tabs" role="tablist" aria-label="생산관제 작업 영역">
      <button id="nativeBatchTab-input" class="factory-automation-tab active" role="tab" aria-selected="true" aria-controls="nativeBatchInput">대량 입력</button>
      <button id="nativeBatchTab-queue" class="factory-automation-tab" role="tab" aria-selected="false" aria-controls="nativeBatchQueue">작업큐</button>
      <button id="nativeBatchTab-factory" class="factory-automation-tab" role="tab" aria-selected="false" aria-controls="app">조립공장</button>
    </nav>`;
  const styles = document.createElement('style');
  styles.textContent = `
    body.native-batch-console {overflow-y:auto;scrollbar-gutter:stable}
    body.native-batch-console .app {height:auto;overflow:visible}
    body.native-batch-console .work-identity-float {position:static;margin:var(--space-3);max-width:calc(100% - var(--space-6))}
    #nativeBatchConsole {padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--border);background:var(--bg-card);font-size:13px}
    #nativeBatchConsole [hidden] {display:none!important}
    .native-batch-command {display:flex;align-items:center;flex-wrap:wrap;gap:var(--space-3);min-width:0}
    #nativeBatchStatus {flex:1 1 320px;font-size:13px;color:var(--text-d);line-height:1.6;overflow-wrap:anywhere}
    #nativeBatchStart,#nativeBatchResume {white-space:normal;min-height:44px}
    #nativeBatchConsole[data-status="blocked"] #nativeBatchStatus {color:var(--warn)}
    #nativeBatchConsole > nav {display:flex;flex-wrap:wrap;margin:12px 0 0;gap:8px}
    #nativeBatchConsole > nav > button {flex:0 1 160px;min-height:42px}
    .native-batch-panel {max-width:1500px;margin:auto;padding:16px;min-width:0;font-size:13px;line-height:1.5}
    .native-batch-panel h2 {font-size:20px;margin:0}
    .native-batch-panel[hidden],body.native-batch-console #app[hidden] {display:none!important}
    .native-batch-queue-list {display:grid;gap:8px;margin-top:12px}
    .native-batch-queue-row {display:grid;grid-template-columns:minmax(160px,1.5fr) minmax(130px,1fr) minmax(140px,1fr) auto;gap:12px;align-items:center;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-card);padding:12px}
    .native-batch-queue-row :is(strong,p,span) {min-width:0;word-break:keep-all;overflow-wrap:anywhere}
    .native-batch-queue-row p {color:var(--text-d);font-size:12px;margin:4px 0}
    #nativeBatchQueueStatus,#nativeBatchModels {color:var(--text-d);font-size:12px;line-height:1.6;word-break:keep-all;overflow-wrap:anywhere}
    #nativeBatchModels {text-wrap:balance}
    @media(max-width:700px) {.native-batch-queue-row {grid-template-columns:minmax(0,1fr)} .native-batch-panel {padding:12px}}
  `;
  document.head.appendChild(styles);
  document.body.classList.add('native-batch-console', 'production-control');
  root.before(panel);
  const inputPanel = document.createElement('section');
  inputPanel.id = 'nativeBatchInput';
  inputPanel.className = 'native-batch-panel';
  inputPanel.setAttribute('role', 'tabpanel');
  inputPanel.setAttribute('aria-labelledby', 'nativeBatchTab-input');
  inputPanel.innerHTML = '<p id="nativeBatchModels" role="status">원본 조립공장 설정 확인 중…</p><section id="bulk-intake" class="section bulk-intake" aria-label="제품 일괄 투입"></section>';
  const queuePanel = document.createElement('section');
  queuePanel.id = 'nativeBatchQueue';
  queuePanel.className = 'native-batch-panel';
  queuePanel.setAttribute('role', 'tabpanel');
  queuePanel.setAttribute('aria-labelledby', 'nativeBatchTab-queue');
  queuePanel.innerHTML = '<div class="native-batch-command"><h2>작업큐</h2><button id="nativeBatchQueueRefresh" class="btn-sm">새로 확인</button><span id="nativeBatchQueueStatus" role="status">기존 작업 조회 중…</span></div><div class="native-batch-queue-list"></div>';
  root.before(inputPanel, queuePanel);
  const activate = key => {
    const selected = key === 'input-source' ? 'input' : key;
    for (const [id, body] of [['input', inputPanel], ['queue', queuePanel], ['factory', root]]) {
      const active = id === selected;
      body.hidden = !active;
      const tab = document.getElementById(`nativeBatchTab-${id}`);
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
  };
  for (const key of ['input', 'queue', 'factory']) {
    document.getElementById(`nativeBatchTab-${key}`).addEventListener('click', () => activate(key));
  }
  activate('input');
  publishMenu(Object.freeze({ activate }));
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/src/bulk-intake.css';
  document.head.append(css);
  return { root, panel, inputPanel, queuePanel, activate };
}
