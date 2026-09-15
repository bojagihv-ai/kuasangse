import { FACTORY_TAB_COMMAND_ACTIONS, selectionPayload, tabCommandPayload } from './factory-control-payloads.mjs';
import { readNativeCommandReceipt, validateNativeCommandReceipt, assertNativeCommandCheckpoint,
  recoverInterruptedNativeLocal, sameCommandIdentity as same, localCommandValue, nativeFieldValue } from './native-command-journal.mjs';
import { createNativeFactoryResume } from './native-factory-resume.mjs';
const VIEW = new Set(['previewAsset', 'toggleAssets', 'togglePreviousAssets', 'openStageFile', 'openOptionColorFile',
  'openCompletedFile', 'openOptionsorter', 'toggleSection', 'navigate', 'openCompetitor', 'beginSectionOrderChange',
  'toggle-competitor-panel', 'open-competitor', 'open-competitor-report', 'open-vm-capture',
  'source-view', 'preview-image', 'close-image-preview']);
const fail = code => { throw Object.assign(new Error(code), { code }); };
let nativeRuntime, nativeRouting;
export function isNativeFactoryConsole(location = nativeRuntime?.location) {
  if (!location?.href) return false;
  const url = new URL(location.href);
  return url.pathname.startsWith('/factory-native/') && url.searchParams.get('batchWorker') === '1' && url.searchParams.get('batchConsole') === '1';
}
export function configureNativeFactoryRuntime(runtime) { nativeRuntime = { ...nativeRuntime, ...runtime }; }
export function nativeFactoryIntakeFacade() {
  return nativeRuntime?.intake || null;
}
export function installNativeFactoryCommandRouting(io) { return nativeRouting = createNativeFactoryCommandRouting({ ...nativeRuntime, ...io }); }
export function dispatchNativeFactoryCommand(request) {
  if (!nativeRouting) fail('native_command_routing_unavailable');
  return nativeRouting.dispatch(request);
}
export async function assertNativeFactoryJobOpen(jobId) {
  if (!nativeRouting) fail('native_command_routing_unavailable');
  if (nativeRouting.allowsWorkerResume(jobId)) return;
  if (nativeRouting.resuming) nativeRouting.assertWorkerJob(jobId);
  if (nativeRouting.pending) await nativeRouting.reconcile();
  nativeRouting.assertWorkerJob(jobId);
}
export async function waitForNativeFactoryWorkerAdmission(order) {
  if (order.command.kind !== 'factory-control' || order.command.name !== 'runFactoryProduct') return;
  const routing = nativeRouting;
  if (!routing) fail('native_command_routing_unavailable');
  await routing.waitForWorkerAdmission(order.command.payload.jobId);
  if (nativeRouting !== routing) fail('native_command_stale_identity');
}
export function wrapNativeSectionActions(actions, runtime) {
  return Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, (value, context) => {
    if (!runtime.enabled()) return action(value, context);
    const localDraft = ['updateSectionInstruction', 'updateSectionAssemblyNote'].includes(name);
    if (!localDraft && runtime.tab().commands[name]) return runtime.tab().invoke(name, name === 'generateSection' ? { sectionId: value } : value);
    const routed = dispatchNativeFactoryCommand({ tabId: 'factory/sections', commandName: name, args: [value], localDraft });
    if (routed?.handled) return routed.result;
    const result = action(value, context);
    routed?.observeLocalResult?.(result);
    return result;
  }]));
}
export function watchNativeFactorySelection({ apiBase, openEventSource }, cursor, receive) {
  const events = openEventSource(`${apiBase}/api/factory/events?cursor=${encodeURIComponent(cursor || '0')}`);
  events.addEventListener('factory.a_cut.selected', event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; } // Malformed events never release the pending fence.
    receive(data.receipt);
  });
  return () => events.close();
}
export function createNativeFactoryCommandRouting(io) {
  const journal = io.journal, restored = journal.restored;
  let pending = restored?.pending ? { ...restored.pending, restored: true } : null;
  let dirty = restored?.dirty || false, dirtyEpoch = restored?.dirtyEpoch || 0, dirtyBinding = restored?.dirtyBinding;
  let localFlights = 0, opening = '';
  let interrupted = restored?.localActive || false;
  let needsLocalRecovery = !!restored?.dirty || interrupted;
  const admissionWaiters = new Set();
  const persist = () => journal.write({ pending, dirty, dirtyEpoch, dirtyBinding, localActive: interrupted || localFlights > 0 });
  const publish = message => {
    persist(); io.onState?.({ pending: !!pending || !!opening || resumeControl.pending, dirty, localActive: interrupted || localFlights > 0, needsLocalRecovery, message });
    for (const resolve of admissionWaiters) resolve();
    admissionWaiters.clear();
  };
  const blocked = () => !!pending || !!opening || localFlights > 0 || interrupted || needsLocalRecovery || io.localBusy?.();
  const resumeControl = createNativeFactoryResume({ ...io, publish, blocked, dirty: () => dirty,
    saveCheckpoint: () => dispatch({ tabId: 'factory/workfile', commandName: 'save-checkpoint', args: [{}] }, true).result });
  function assertLocal(basis, revisions = false) {
    const current = io.readLocal();
    if (current.store !== basis.store || !basis.store.isOperationCurrent(basis.token)
      || current.jobId !== basis.jobId || !same(current.session, basis.session)
      || (revisions && current.session.storeRevision !== basis.session.storeRevision)) fail('native_command_stale_identity');
    return current;
  }
  function observeLocalResult(result) {
    if (!result || typeof result.then !== 'function') return;
    localFlights += 1;
    persist();
    const settled = () => { localFlights -= 1; publish('로컬 변경 보존 중 · 체크포인트 확인 전에는 다른 작업을 열 수 없습니다.'); };
    Promise.resolve(result).then(settled, settled);
  }
  function markDirty() {
    dirty = true;
    dirtyBinding ||= { jobId: io.readLocal().jobId, session: io.readLocal().session };
    dirtyEpoch += 1;
    publish('로컬 변경 보존 중 · 체크포인트 확인 전에는 다른 작업을 열 수 없습니다.');
  }
  async function validateReceipt(entry, receipt) {
    await validateNativeCommandReceipt(entry, receipt);
    const current = await assertNativeCommandCheckpoint(io, entry, receipt);
    entry.close?.();
    pending = null;
    dirty = dirtyEpoch !== entry.dirtyEpoch;
    if (!dirty) { dirtyBinding = null; needsLocalRecovery = false; interrupted = false; }
    publish(dirty ? '명령 영수증 확인 · 뒤에 생긴 로컬 변경은 아직 보존 중입니다.' : '원본 명령 완료 · 같은 작업의 체크포인트 영수증을 확인했습니다.');
    return Object.freeze({ schema: 'factory-runtime-command-receipt:v1', operationToken: current.token, value: receipt });
  }
  async function settle(entry) {
    for (let count = 0; count < (io.maxPolls ?? 450); count += 1) {
      if (entry.restored || entry.selection || entry.orderId) {
        const result = entry.restored || entry.selection ? await readNativeCommandReceipt(io, entry)
          : await io.apiRequest(`${entry.base}/${encodeURIComponent(entry.orderId)}`);
        if (result?.jobId !== entry.payload.jobId || result?.orderId !== entry.orderId) fail('native_command_receipt_mismatch');
        if (result.status === 'failed') {
          dirtyBinding ||= { jobId: entry.basis.jobId, session: entry.basis.session };
          dirtyBinding.failed = true;
          needsLocalRecovery = !!entry.restored;
          pending = null;
          markDirty();
          fail(result.error || 'native_command_failed');
        }
        if (result.status === 'completed') return validateReceipt(entry, result.receipt);
      }
      await io.wait(2000);
    }
    fail('native_command_receipt_pending');
  }
  async function post(entry) {
    entry.sent = true;
    persist();
    const accepted = await io.apiRequest(entry.base, { method: 'POST', body: JSON.stringify(entry.payload) });
    const orderId = entry.selection ? accepted?.order?.orderId : accepted?.orderId;
    if (accepted?.accepted !== true || typeof orderId !== 'string' || !orderId) fail('native_command_acceptance_unknown');
    entry.orderId = orderId;
    persist();
  }
  async function submit(entry, command) {
    try {
      await io.syncProjection();
      assertLocal(entry.basis, true);
      const projection = await io.readProjection();
      const response = await io.apiRequest('/api/factory/jobs');
      const current = assertLocal(entry.basis, true);
      if (!same(current.session, projection?.session)
        || !same(current.session, projection?.session, ['revision', 'storeRevision'])) fail('native_command_stale_projection');
      const job = response.jobs?.find(item => item.jobId === entry.basis.jobId);
      const common = io.buildCommand({ job, projection, ...command, idempotencyKey: `native-factory:${io.randomUUID()}` });
      entry.payload = entry.selection ? selectionPayload({ jobId: common.jobId, productId: common.productId,
        productKey: common.productKey, expectedRunId: common.expectedRunId, expectedInputFingerprint: common.expectedInputFingerprint,
        expectedRevision: common.expectedRevision, idempotencyKey: common.idempotencyKey, decisionMode: 'manual',
        stageKey: command.value.stageKey, candidateId: command.value.candidateId }) : tabCommandPayload(common);
      entry.base = `/api/factory/jobs/${encodeURIComponent(common.jobId)}/${entry.selection ? 'select' : 'tab-command'}`;
      if (entry.selection) entry.close = io.watchSelection(projection.eventCursor || projection.cursor, receipt => {
        if (receipt?.idempotencyKey === entry.payload.idempotencyKey) entry.receipt = receipt;
      });
      await post(entry);
      return await settle(entry);
    } catch (error) {
      // A lost response may already have executed a toggle. Keep its key and fence.
      if (!entry.sent || (!entry.orderId && Number.isInteger(error?.status) && error.status >= 400 && error.status < 500)) {
        entry.close?.();
        if (pending === entry) pending = null;
      }
      publish(pending ? '명령 접수·저장 결과 확인 필요 · 중복 실행과 작업 전환을 잠갔습니다.' : '명령 중단 · 기존 작업을 유지합니다.');
      throw error;
    }
  }
  function dispatch(request, resumeSave = false) {
    if (blocked() || (resumeControl.pending && !resumeSave)) fail('native_command_pending');
    const tabId = request.tabId.replace(/^factory\//, '');
    let action = request.commandName, value = request.args[0];
    if (io.readLocal().jobId && ((tabId === 'start' && ['setProductName', 'setProductImage', 'promoteStoredProductImage', 'runDb'].includes(action))
      || (tabId === 'db' && action === 'run-db'))) {
      publish('현재 배치 작업의 제품명·기본 사진 교체와 전체 시작 다시 실행은 지원하지 않습니다. 이어가려면 상단 저장 후 작업 재개를, 새 제품은 대량 입력을 사용하세요. 기존 자료는 유지됩니다.');
      fail('native_command_identity_change_requires_new_job');
    }
    const innerAction = typeof value === 'string' ? value : value?.action || value?.type || '';
    const view = VIEW.has(action) || /^(?:go-tab:|focus-)/.test(action)
      || (['guideAction', 'marketAction', 'runGuideAction'].includes(action)
        && (VIEW.has(innerAction) || /^(?:go-tab:|focus-)/.test(innerAction)));
    const draft = tabId === 'competitor' && action === 'marketAction' && value?.type === 'candidate-target';
    if (view) return;
    if (localCommandValue(request.args) || draft || request.localDraft) { markDirty(); return { observeLocalResult }; }
    if (tabId === 'db' && ['rerun-db-query', 'rerun-cafe24-query'].includes(action)) {
      value = { query: value, source: action === 'rerun-cafe24-query' ? 'cafe24' : 'all' }; action = 'search';
    }
    const selection = tabId === 'assets' && action === 'selectACut';
    if (dirtyBinding?.failed && (selection || FACTORY_TAB_COMMAND_ACTIONS[tabId]?.includes(action)) && action !== 'save-checkpoint') fail('native_command_failed_save_required');
    if (!selection && !FACTORY_TAB_COMMAND_ACTIONS[tabId]?.includes(action)) {
      markDirty(); return { observeLocalResult };
    }
    if (tabId === 'db' && action.startsWith('apply-')) {
      value = { candidateIdentity: io.captureCandidate(action === 'apply-cafe24-candidate' ? 'cafe24' : 'sinhwa', value?.index) };
    } else if (tabId === 'fields') {
      value = action === 'commitAllFields' ? { fields: value?.fields?.map(nativeFieldValue),
        ...(value?.renderAfter === undefined ? {} : { renderAfter: value.renderAfter }) } : nativeFieldValue(value);
    } else if (value === undefined) value = null;
    // Capture before the first await, including candidate identity, never its later index.
    const basis = io.readLocal();
    if (dirtyBinding && (basis.jobId !== dirtyBinding.jobId || !same(basis.session, dirtyBinding.session))) fail('native_command_dirty_binding');
    const capturedValue = structuredClone(value);
    const entry = { basis, selection, dirtyEpoch, sent: false, orderId: '', payload: null, close: null, receipt: null, promise: null };
    pending = entry;
    publish('원본 명령 요청 중 · 체크포인트 저장 영수증을 기다립니다.');
    entry.promise = submit(entry, { tabId, action, value: capturedValue }).finally(() => { entry.promise = null; });
    return { handled: true, result: entry.promise };
  }
  function reconcile() {
    if (resumeControl.pending && !pending) return resumeControl.reconcile();
    const entry = pending;
    if (!entry) return Promise.resolve(null);
    if (entry.promise) return entry.promise;
    entry.promise = (async () => {
      if (!entry.restored && !entry.orderId && !entry.selection) await post(entry); // Same frozen payload/key only; never after refresh.
      return settle(entry);
    })().finally(() => { entry.promise = null; });
    return entry.promise;
  }
  return Object.freeze({ dispatch, reconcile, markDirty, resume: resumeControl.resume, allowsWorkerResume: resumeControl.allowsWorker,
    async waitForWorkerAdmission(jobId) {
      if (!resumeControl.pending || resumeControl.allowsWorker(jobId)) return;
      publish('다음 작업은 주문 접수 후 현재 작업의 저장 결과 확인을 기다립니다. 아직 다음 작업을 실행하지 않았습니다.');
      while (resumeControl.pending || blocked() || dirty) await new Promise(resolve => admissionWaiters.add(resolve));
      this.assertWorkerJob(jobId);
    },
    async recoverLocal() {
      if (!needsLocalRecovery || pending || opening || localFlights) fail('native_command_pending');
      await recoverInterruptedNativeLocal(io, dirtyBinding);
      interrupted = false;
      needsLocalRecovery = false;
      publish('기존 저장 자료를 확인했습니다. 중단된 파일은 다시 첨부한 뒤 작업 저장하세요. 아직 체크포인트 완료가 아닙니다.');
    },
    save() { return dispatch({ tabId: 'factory/workfile', commandName: 'save-checkpoint', args: [{}] }).result; },
    refreshState() { publish(interrupted ? '새로고침 중 로컬 파일 처리가 끊겼습니다. 원본 파일과 저장 상태 확인이 필요합니다.' : pending ? '이전 명령 결과 확인 대기 · 새 실행과 전환은 잠겨 있습니다.' : dirty ? '로컬 변경이 있습니다. 작업 저장으로 체크포인트를 확인하세요.' : ''); },
    get localActive() { return interrupted || localFlights > 0; },
    get resuming() { return resumeControl.pending; },
    get needsLocalRecovery() { return needsLocalRecovery; },
    get pending() { return !!pending || !!opening || resumeControl.pending; }, get dirty() { return dirty; },
    assertWorkerJob(jobId) {
      if (opening && opening === jobId) return;
      if (pending || opening || dirty || localFlights || needsLocalRecovery || resumeControl.pending) fail('native_command_dirty_or_pending');
    },
    canOpen(jobId) { return !blocked() && !resumeControl.pending && (!dirty || jobId === io.readLocal().jobId); },
    beginOpen(jobId) {
      if (!this.canOpen(jobId)) fail('native_command_dirty_or_pending');
      opening = jobId; publish('저장본 복원 결과를 확인하고 있습니다.');
      return () => { opening = ''; publish(''); };
    },
  });
}
