const clean = value => String(value ?? '').trim();

export function readFactoryOperatorControls(projection) {
  return projection?.inputs?.find(input => input.key === 'operator_controls')?.items
    ?.find(item => item?.schema === 'factory-operator-controls:v1') || null;
}

export function buildFactoryTabCommand({ job, projection, tabId, action, value, idempotencyKey }) {
  const session = projection?.session || {};
  if (tabId === 'workfile' && action === 'export-current') {
    if (job?.status === 'blocked') throw new Error('차단된 작업은 내보낼 수 없습니다. 차단 사유를 먼저 해결하세요.');
    if (projection?.storage?.ok !== true || projection.storage.warning) {
      throw new Error('현재 제품의 저장 확인이 필요합니다. 저장 오류를 해결한 뒤 다운로드하세요.');
    }
  }
  if (!job?.jobId || projection?.connected !== true
    || !['waiting_manual', 'blocked', 'completed'].includes(job.status)
    || projection.registration?.jobId !== job.jobId
    || session.workspaceId !== `batch:${job.jobId}`
    || !['productId', 'productKey', 'runId', 'inputFingerprint'].every(key => clean(session[key]))
    || ![session.revision, session.storeRevision].every(number => Number.isInteger(number) && number >= 0)) {
    throw new Error('현재 제품의 저장 상태를 확인할 수 없습니다. 작업을 연 뒤 다시 시도하세요.');
  }
  return Object.freeze({
    schema: 'factory-tab-command:v1', jobId: job.jobId, tabId, action, value,
    expectedWorkspaceId: session.workspaceId,
    productId: session.productId, productKey: session.productKey,
    expectedRunId: session.runId, expectedInputFingerprint: session.inputFingerprint,
    expectedRevision: session.revision, expectedStoreRevision: session.storeRevision,
    idempotencyKey,
  });
}

export function factoryWorkfileExportBlocker(context, busy = false) {
  try {
    if (busy) throw new Error('다른 요청을 처리 중입니다. 끝난 뒤 다운로드하세요.');
    buildFactoryTabCommand({ ...context, tabId: 'workfile', action: 'export-current', value: {}, idempotencyKey: 'export-availability' });
    return '';
  } catch (error) { return clean(error.message); }
}

export function createFactoryOperatorControls({ getContext, apiRequest, onChange, onApplied, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const statuses = new Map();
  const drafts = new Map();
  let stopped = false;
  let busy = false;
  const status = jobId => statuses.get(jobId) || { message: '', pending: false, tone: '' };
  const publish = (jobId, next) => { statuses.set(jobId, next); onChange?.(); };
  async function submit(tabId, action, value, label = '변경 저장', targetJobId = '') {
    if (busy || stopped) return;
    const context = getContext();
    const jobId = context.job?.jobId;
    busy = true;
    publish(jobId, { pending: true, tone: 'warning', message: `${label} 요청을 확인하고 있습니다.` });
    try {
      if (targetJobId && targetJobId !== jobId) throw new Error('다른 제품으로 전환되어 이전 화면의 요청을 중단했습니다.');
      const payload = buildFactoryTabCommand({
        ...context, tabId, action, value,
        idempotencyKey: `factory-tab:${jobId}:${crypto.randomUUID()}`,
      });
      const base = `/api/factory/jobs/${encodeURIComponent(jobId)}/tab-command`;
      const accepted = await apiRequest(base, { method: 'POST', body: JSON.stringify(payload) });
      if (!accepted.accepted || !accepted.orderId) throw new Error('조립공장이 요청을 접수하지 못했습니다.');
      publish(jobId, { pending: true, tone: 'warning', message: `${label} 진행 중 · 조립공장 저장 영수증을 기다립니다.` });
      const deadline = Date.now() + 15 * 60 * 1000;
      while (!stopped && Date.now() < deadline) {
        const result = await apiRequest(`${base}/${encodeURIComponent(accepted.orderId)}`);
        if (result.status === 'failed') throw new Error(clean(result.error) || '조립공장 처리 실패');
        if (result.status === 'completed') {
          const receipt = result.receipt;
          if (receipt?.schema !== 'factory-tab-command-receipt:v1' || receipt.status !== 'applied'
            || receipt.jobId !== jobId || receipt.tabId !== tabId || receipt.action !== action) {
            throw new Error('현재 작업의 저장 영수증이 일치하지 않습니다.');
          }
          const session = receipt.projection?.session;
          if (tabId === 'workfile' && (session?.workfileSource !== 'browser-download-requested'
            || receipt.projection?.registration?.jobId !== jobId
            || [['workspaceId', 'expectedWorkspaceId'], ['productId', 'productId'], ['productKey', 'productKey'],
              ['runId', 'expectedRunId'], ['inputFingerprint', 'expectedInputFingerprint']].some(([key, expected]) => session[key] !== payload[expected])
            || !Number.isSafeInteger(session.revision) || session.revision < payload.expectedRevision
            || !Number.isSafeInteger(session.storeRevision) || session.storeRevision < payload.expectedStoreRevision
            || !/\.kuasangse$/i.test(session.workfileName) || !/^[a-f0-9]{64}$/.test(session.workfileSha256)
            || !Number.isSafeInteger(session.workfileBytes) || session.workfileBytes <= 0)) {
            throw new Error('현재 제품의 다운로드 요청 영수증이 일치하지 않습니다. 디스크 저장은 확인되지 않았습니다.');
          }
          await onApplied?.(receipt);
          publish(jobId, { pending: false, tone: tabId === 'workfile' ? 'warning' : 'ok', message: tabId === 'workfile'
            ? `${session.workfileName} 다운로드 요청 · 디스크 저장 미확인 · ${session.workfileBytes}바이트 · SHA-256 ${session.workfileSha256}`
            : `${label} 완료 · 같은 제품의 작업파일에 저장했습니다.` });
          return receipt;
        }
        await wait(2000);
      }
      if (!stopped) throw new Error('처리가 오래 걸리고 있습니다. 작업 상태를 확인하세요. 같은 요청을 중복 실행하지 마세요.');
    } catch (error) {
      const detail = clean(error?.message || error);
      const message = tabId !== 'workfile' ? detail
        : /blocked|not_editable|checkpoint_missing/.test(detail) ? '작업이 차단되었거나 저장된 체크포인트가 없습니다. 작업 상태를 먼저 확인하세요.'
          : /busy/.test(detail) ? '조립공장이 다른 요청을 처리 중입니다. 끝난 뒤 다운로드하세요.'
            : /stale|mismatch|identity|session_missing/.test(detail) ? '현재 제품·저장 버전·다운로드 출처가 일치하지 않습니다. 같은 작업을 다시 확인하세요.' : detail;
      publish(jobId, { pending: false, tone: 'error', message: `${label} 실패 · ${message}` });
    } finally { busy = false; onChange?.(); }
  }
  return Object.freeze({
    submit, status,
    get busy() { return busy; },
    draft(key, initial = '') { return drafts.has(key) ? drafts.get(key) : initial; },
    remember(key, value) { drafts.set(key, value); },
    stop() { stopped = true; },
  });
}

export function operatorElement(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function operatorField(ctx, key, label, initial, choices = null, multiline = false) {
  const wrapper = operatorElement('label', '', 'field-stack');
  wrapper.append(operatorElement('span', label));
  const control = operatorElement(choices ? 'select' : multiline ? 'textarea' : 'input');
  const draftKey = `${ctx.job.jobId}:${ctx.projection.session.runId}:${key}`;
  control.dataset.operatorField = key;
  if (choices) for (const choice of choices) {
    const option = operatorElement('option', choice.label || choice.name || choice.id);
    option.value = choice.id;
    control.append(option);
  }
  control.value = ctx.controller.draft(draftKey, initial ?? '');
  if (multiline) control.rows = 3;
  control.disabled = ctx.disabled;
  control.addEventListener('input', () => ctx.controller.remember(draftKey, control.value));
  wrapper.append(control);
  return { wrapper, control };
}

export function operatorAction(ctx, label, tab, action, value) {
  const button = operatorElement('button', label, 'button-secondary');
  button.type = 'button';
  button.dataset.operatorAction = `${tab}:${action}`;
  button.disabled = ctx.disabled;
  button.addEventListener('click', () => void ctx.controller.submit(tab, action, typeof value === 'function' ? value() : value, label, ctx.job.jobId));
  return button;
}

export function operatorImage(ctx, item) {
  const source = item.thumbnailUrl || item.contentUrl || '';
  if (!source) return operatorElement('span', '이미지 없음', 'factory-empty-state');
  const button = operatorElement('button', '', 'operator-image-preview');
  button.type = 'button';
  const image = operatorElement('img');
  image.alt = item.title || item.label || '후보 이미지';
  image.loading = 'lazy';
  image.decoding = 'async';
  image.src = ctx.assetUrl(source);
  button.append(image);
  button.setAttribute('aria-label', `${image.alt} 크게 보기`);
  button.addEventListener('click', () => {
    const dialog = operatorElement('dialog', '', 'operator-image-dialog');
    const full = operatorElement('img');
    full.alt = image.alt;
    full.src = ctx.assetUrl(item.contentUrl || source);
    const close = operatorElement('button', '닫기', 'button-secondary');
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.append(full, close);
    document.body.append(dialog);
    dialog.showModal();
  });
  return button;
}
