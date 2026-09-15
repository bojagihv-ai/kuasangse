import { installNativeFactoryCommandRouting, watchNativeFactorySelection, isNativeFactoryConsole, configureNativeFactoryRuntime, nativeFactoryIntakeFacade, dispatchNativeFactoryCommand, assertNativeFactoryJobOpen, waitForNativeFactoryWorkerAdmission, wrapNativeSectionActions } from './native-factory-command-routing.mjs';
import { createNativeBatchStart, createNativeBatchConsoleView, NATIVE_START_ERRORS as START_ERRORS } from './native-batch-console-view.mjs';
export { createNativeBatchStart, isNativeFactoryConsole, configureNativeFactoryRuntime, nativeFactoryIntakeFacade, dispatchNativeFactoryCommand, assertNativeFactoryJobOpen, waitForNativeFactoryWorkerAdmission, wrapNativeSectionActions };


export async function mountNativeBatchConsole(document, options) {
  const { root, panel, queuePanel, activate } = createNativeBatchConsoleView(document, options.publishMenu);
  const button = panel.querySelector('#nativeBatchStart');
  const status = panel.querySelector('#nativeBatchStatus');
  const identityDetails = document.createElement('details');
  identityDetails.id = 'nativeBatchIdentityDetails';
  identityDetails.setAttribute('style', 'flex-basis:100%;min-width:0;color:var(--text-d);overflow-wrap:anywhere;word-break:keep-all');
  const identitySummary = document.createElement('summary');
  identitySummary.textContent = '확인 시점의 연결 대상 · 확인 전';
  const identityCheck = document.createElement('button');
  identityCheck.type = 'button';
  identityCheck.id = 'nativeBatchIdentityCheck';
  identityCheck.className = 'btn-sm';
  identityCheck.textContent = '현재 연결대상 확인';
  identityCheck.setAttribute('style', 'margin:var(--space-2) 0;min-height:44px;white-space:normal');
  const identityMessage = document.createElement('p');
  identityMessage.setAttribute('role', 'status');
  identityMessage.setAttribute('aria-live', 'polite');
  identityMessage.textContent = '아직 확인하지 않았습니다.';
  const identityObservedAt = document.createElement('p');
  identityObservedAt.id = 'nativeBatchIdentityObservedAt';
  identityObservedAt.textContent = '마지막 관측 시각: 없음';
  identityDetails.append(identitySummary, identityCheck, identityMessage, identityObservedAt);
  const identityFields = {};
  for (const [key, label] of [['Product', '제품명'], ['JobId', '작업 ID'], ['RunId', '실행 ID']]) {
    const row = document.createElement('p');
    row.textContent = `${label}: `;
    const value = document.createElement('span');
    value.id = `nativeBatchIdentity${key}`;
    value.textContent = '확인 전';
    row.append(value);
    identityDetails.append(row);
    identityFields[key] = value;
  }
  panel.querySelector('.native-batch-command').append(identityDetails);
  identityCheck.addEventListener('click', async () => {
    if (identityCheck.disabled) return;
    identityCheck.disabled = true;
    identityMessage.textContent = '현재 연결 대상을 확인하는 중입니다…';
    try {
      const observed = await options.readStartupIdentity();
      identityFields.Product.textContent = observed.productName || '없음(빈 값)';
      identityFields.JobId.textContent = observed.registration.jobId || '없음(빈 값)';
      identityFields.RunId.textContent = observed.session.runId || '없음(빈 값)';
      identitySummary.textContent = `${observed.productName || '제품명 미입력'} · 확인 시점의 연결 대상`;
      identityObservedAt.textContent = `마지막 관측 시각: ${observed.capturedAt || '제공되지 않음'}`;
      identityMessage.textContent = '확인 시점의 값입니다. 작업 변경 후에는 다시 확인하세요.';
    } catch {
      identitySummary.textContent = '확인 시점의 연결 대상 · 미확인';
      for (const value of Object.values(identityFields)) value.textContent = '미확인';
      identityMessage.textContent = '확인 실패 · 현재 연결 대상은 미확인입니다. 마지막 관측 시각은 갱신하지 않았습니다.';
    } finally { identityCheck.disabled = false; }
  });
  const resumeButton = panel.querySelector('#nativeBatchResume');
  resumeButton.disabled = true;
  const start = createNativeBatchStart(options);
  let connected = false;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    if (commandRouting.pending || commandRouting.localActive || commandRouting.needsLocalRecovery) { status.textContent = '현재 작업의 변경·명령을 확인한 뒤 연결하세요.'; return; }
    button.disabled = true;
    panel.dataset.status = 'connecting';
    status.textContent = '기존 실행과 화면 버전을 확인하는 중입니다…';
    try {
      if (commandRouting.dirty) {
        const { jobs } = await client.apiRequest('/api/factory/jobs');
        if (!Array.isArray(jobs) || jobs.some(job => job.dispatched || ['queued', 'running'].includes(job.status))) throw new Error('native_command_reconnect_busy');
      }
      await start();
      connected = true;
      panel.dataset.status = 'running';
      button.textContent = '작업큐 연결됨';
      status.textContent = '기존 작업큐에 연결했습니다. 실행 가능한 제품부터 진행하며, 컷 선택과 상품등록 승인은 유지됩니다.';
      await refreshQueue();
    } catch (error) {
      panel.dataset.status = 'blocked';
      const code = error?.code || error?.message;
      status.textContent = START_ERRORS[code] || '생산관제 연결에 실패했습니다. 서버 상태를 확인하고 다시 시작하세요.';
      button.disabled = false;
    }
  });
  button.disabled = true;
  const [{ createControlTowerClient }, { mountBulkIntake }, { buildOperatorQueueRow }, { buildFactoryTabCommand, readFactoryOperatorControls }, { buildFactoryResumePayload }] = await Promise.all([
    import('/src/control-tower-client.mjs'), import('/src/bulk-intake.mjs'), import('/src/operator-queue-model.mjs'),
    import('/src/factory-operator-controls.mjs'),
    import('/src/production-workbench.mjs'),
  ]);
  const client = createControlTowerClient({ apiBase: options.apiBase });
  const commandRouting = installNativeFactoryCommandRouting({ apiRequest: client.apiRequest,
    journal: options.journal, randomUUID: options.randomUUID, digest: options.digest, wait: options.wait,
    readProjection: options.readState, syncProjection: options.syncProjection, buildCommand: buildFactoryTabCommand,
    buildResumePayload: buildFactoryResumePayload,
    watchSelection: (cursor, receive) => watchNativeFactorySelection(options, cursor, receive),
    onState(next) {
      root.inert = next.pending;
      if (next.message) status.textContent = next.message;
      panel.querySelector('#nativeBatchReconcile').hidden = !next.pending;
      panel.querySelector('#nativeBatchSave').disabled = next.pending || next.localActive;
      resumeButton.disabled = !connected || next.pending || next.localActive || next.needsLocalRecovery;
      panel.querySelector('#nativeBatchLocalRecovery').hidden = !next.needsLocalRecovery;
      for (const open of queuePanel.querySelectorAll('[data-native-open-job]')) {
        open.disabled = open.dataset.nativeOpenBlocked === 'true' || !commandRouting.canOpen(open.dataset.nativeOpenJob);
      }
    },
  });
  root.addEventListener('input', () => commandRouting.markDirty(), true);
  root.addEventListener('change', () => commandRouting.markDirty(), true);
  commandRouting.refreshState();
  panel.querySelector('#nativeBatchLocalRecovery').addEventListener('click', () => {
    if (options.confirm('새로고침으로 중단된 파일은 자동 완료되지 않습니다. 기존 저장 자료를 검증한 뒤 편집을 재개합니다. 누락된 파일은 다시 첨부하고 작업 저장하세요.')) {
      void commandRouting.recoverLocal().catch(error => { status.textContent = `기존 저장 자료 확인 실패 · ${error.message} · 현재 자료는 변경하지 않았습니다.`; });
    }
  });
  options.onBeforeUnload(event => {
    if (commandRouting.pending || commandRouting.dirty || commandRouting.localActive) { event.preventDefault(); event.returnValue = ''; }
  });
  panel.querySelector('#nativeBatchSave').addEventListener('click', () => {
    if (!connected) { status.textContent = '작업큐 연결 후 작업 저장을 누르세요. 현재 로컬 변경은 그대로 유지됩니다.'; return; }
    try { void commandRouting.save().catch(error => { status.textContent = `작업 저장 확인 필요 · ${error.message}`; }); }
    catch (error) { status.textContent = `작업 저장 대기 · ${error.message}`; }
  });
  panel.querySelector('#nativeBatchReconcile').addEventListener('click', () => {
    void commandRouting.reconcile().then(refreshQueue).catch(error => { status.textContent = `결과 확인 대기 · ${error.message} · 중복 실행하지 마세요.`; });
  });
  resumeButton.addEventListener('click', async () => {
    if (!connected || resumeButton.disabled) return;
    resumeButton.disabled = true;
    try { await commandRouting.resume(); }
    catch (error) { status.textContent = `작업 재개 확인 필요 · ${error.message} · 현재 자료는 유지하며 불명확한 요청은 다시 보내지 않습니다.`; }
    finally { await refreshQueue(); }
  });
  const runtime = { apiHub: 'http://127.0.0.1:4321', automation: {}, apiRequest: (path, init = {}) => {
    if (init.method === 'POST' && (commandRouting.pending || commandRouting.dirty)) throw new Error('현재 작업의 변경·명령 확인 전에는 새 작업을 투입할 수 없습니다.');
    if (path === '/api/factory/jobs' && init.method === 'POST' && !connected) {
      throw new Error('먼저 상단의 작업큐 연결 · 시작을 눌러 이 화면의 원본 조립공장을 연결하세요.');
    }
    return client.apiRequest(path, init);
  } };
  let settings;
  const refreshSettings = async () => {
    settings = await options.readSettings();
    document.getElementById('nativeBatchModels').textContent = `판단 모델: GPT OAuth · ${settings.judgment.model} · 추론 ${settings.judgment.reasoningEffort} · 원본 조립공장 설정 사용`;
    return settings.judgment;
  };
  await refreshSettings();
  document.getElementById('nativeBatchTab-input').addEventListener('click', () => {
    void refreshSettings().catch(error => { document.getElementById('nativeBatchModels').textContent = `원본 판단 설정 확인 실패 · ${error.message}`; });
  });
  mountBulkIntake(runtime, { root: document.getElementById('bulk-intake'), imageModels: settings.imageModels,
    getJudgmentSettings: refreshSettings,
    intake: nativeFactoryIntakeFacade(),
    presetOptions: [
      { id: 'full_auto', label: '전체 자동' }, { id: 'representative_manual', label: '대표 이미지만 직접 선택' },
      { id: 'representative_and_size_manual', label: '대표·사이즈 직접 선택' }, { id: 'all_images_manual', label: '모든 생성 이미지 직접 선택' },
      { id: 'custom', label: '사용자 지정' },
    ],
  });
  let refreshing = false;
  let opening = false;
  async function openJob(job) {
    if (!connected || opening) return;
    if (!commandRouting.canOpen(job.jobId)) { status.textContent = '미확인 변경·명령을 보존하기 위해 작업 전환을 잠갔습니다.'; return; }
    const finishOpen = commandRouting.beginOpen(job.jobId);
    opening = true;
    await refreshQueue();
    status.textContent = `${job.productName} 저장본을 확인하고 있습니다. 생성은 시작하지 않습니다.`;
    try {
      const currentJobs = await client.apiRequest('/api/factory/jobs');
      const targetJob = currentJobs.jobs?.find(item => item.jobId === job.jobId);
      if (!targetJob) throw new Error('작업큐에서 이 제품을 찾지 못했습니다.');
      if (currentJobs.jobs.some(item => item.dispatched || ['queued', 'running'].includes(item.status))) {
        throw new Error('다른 실행을 처리 중입니다. 현재 작업을 마친 뒤 저장본을 열 수 있습니다.');
      }
      let projection = await options.readState();
      let restored = projection.registration?.jobId === job.jobId
        && ['waiting_manual', 'blocked', 'completed'].includes(readFactoryOperatorControls(projection)?.workflow?.status);
      if (!restored) {
        if (!Number.isInteger(targetJob.checkpointRevision) || !targetJob.checkpointRunId) throw new Error('저장본의 버전을 확인하지 못했습니다.');
        await client.apiRequest(`/api/factory/jobs/${encodeURIComponent(job.jobId)}/resume`, {
          method: 'POST', body: JSON.stringify({ restoreOnly: true,
            expectedCheckpointRevision: targetJob.checkpointRevision, expectedCheckpointRunId: targetJob.checkpointRunId }),
        });
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          await options.wait(1000);
          projection = await options.readState();
          const response = await client.apiRequest('/api/factory/jobs');
          const currentJob = response.jobs?.find(item => item.jobId === job.jobId);
          if (projection.registration?.jobId === job.jobId && !currentJob?.dispatched
            && ['waiting_manual', 'blocked', 'completed'].includes(currentJob?.status)
            && ['waiting_manual', 'blocked', 'completed'].includes(readFactoryOperatorControls(projection)?.workflow?.status)) { restored = true; break; }
        }
      }
      if (!restored || projection.registration?.jobId !== job.jobId || projection.session?.workspaceId !== `batch:${job.jobId}`) {
        throw new Error('같은 제품의 복원 결과를 아직 확인하지 못했습니다. 작업큐 상태를 확인하세요.');
      }
      activate('factory');
      status.textContent = `${job.productName} · 원본 조립공장에서 저장본을 열었습니다. 기존 결과를 유지합니다.`;
    } catch (error) { commandRouting.markDirty(); status.textContent = `저장본 열기 중단 · ${error.message}`; }
    finally { opening = false; finishOpen(); await refreshQueue(); }
  }
  async function refreshQueue() {
    if (refreshing) return;
    refreshing = true;
    const queueStatus = document.getElementById('nativeBatchQueueStatus');
    try {
      const response = await client.apiRequest('/api/factory/jobs');
      const jobs = Array.isArray(response.jobs) ? response.jobs : [];
      const projection = await options.readState();
      const currentJob = jobs.find(job => job.jobId === projection.registration?.jobId);
      resumeButton.disabled = !connected || commandRouting.pending || commandRouting.localActive || commandRouting.needsLocalRecovery
        || currentJob?.status !== 'waiting_manual' || jobs.some(job => job.dispatched || ['queued', 'running'].includes(job.status));
      resumeButton.title = '현재 제품의 확정·로컬 변경을 저장한 뒤 같은 작업의 다음 공정을 확인합니다. 확정이 부족하면 다시 대기합니다.';
      queueStatus.textContent = `${jobs.length}건 · 선택 대기 ${jobs.filter(job => job.status === 'waiting_manual').length} · 실행 ${jobs.filter(job => job.status === 'running').length} · 오류 ${jobs.filter(job => job.status === 'blocked').length}`;
      queuePanel.querySelector('.native-batch-queue-list').replaceChildren(...jobs.map((job, index) => {
        const row = document.createElement('article');
        row.className = 'native-batch-queue-row';
        const view = buildOperatorQueueRow(job, index);
        const name = document.createElement('strong');
        name.textContent = `${view.orderLabel} · ${job.productName}`;
        const stage = document.createElement('span');
        stage.textContent = `${view.stepLabel} · ${view.stageLabel} · ${view.stateLabel}`;
        const message = document.createElement('p');
        message.textContent = (job.message || view.actionLabel) + (job === currentJob && job.status === 'waiting_manual'
          ? ' · 원본 탭에서 확정한 뒤 상단 저장 후 작업 재개를 누르세요. 누락값이 있으면 다시 대기합니다.' : '');
        const open = document.createElement('button');
        open.className = 'btn-sm';
        open.textContent = '저장본 열기';
        open.dataset.nativeOpenJob = job.jobId;
        open.dataset.nativeOpenBlocked = String(!connected || opening || !job.checkpointAvailable || !['waiting_manual', 'blocked', 'completed'].includes(job.status));
        open.disabled = open.dataset.nativeOpenBlocked === 'true' || !commandRouting.canOpen(job.jobId);
        open.title = !connected ? '상단에서 이 창의 조립공장을 먼저 연결하세요.' : '기존 결과만 복원합니다. 생성은 다시 시작하지 않습니다.';
        open.addEventListener('click', () => { void openJob(job); });
        row.append(name, stage, message, open);
        return row;
      }));
    } catch (error) { queueStatus.textContent = `작업큐 조회 실패 · ${error.message}`; }
    finally { refreshing = false; }
  }
  document.getElementById('nativeBatchQueueRefresh').addEventListener('click', () => { void refreshQueue(); });
  options.onJobCreated(() => { activate('queue'); void refreshQueue(); });
  await refreshQueue();
  button.disabled = false;
}
