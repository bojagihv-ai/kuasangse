import { tabCommandPayload, selectionPayload } from './factory-control-payloads.mjs';
import { createFactoryControlCommandBridge } from './factory-control-command-bridge.mjs';
import { validateProductCheckpoint } from './batch-control-contract.mjs';

const fail = code => { throw new Error(code); };
export const sameCommandIdentity = (a, b, keys = ['workspaceId', 'productId', 'productKey', 'runId', 'inputFingerprint']) => keys.every(key => a?.[key] === b?.[key]);

// Only command JSON and binding metadata belong here; never a File or a factory snapshot.
export function createNativeCommandJournal({ read, write }) {
  let restored = null;
  const text = read();
  if (text) {
    try {
      restored = JSON.parse(text);
      if (restored.schema !== 'native-factory-command:v1' || typeof restored.dirty !== 'boolean'
        || !Number.isSafeInteger(restored.dirtyEpoch) || typeof restored.localActive !== 'boolean') fail('invalid');
      if (restored.pending) {
        const entry = restored.pending;
        entry.payload = entry.selection ? selectionPayload(entry.payload) : tabCommandPayload(entry.payload);
        if (!entry.basis?.session || entry.basis.jobId !== entry.payload.jobId) fail('invalid');
      }
      if (restored.resume && (!restored.resume.jobId || !Number.isSafeInteger(restored.resume.attempts)
        || restored.resume.attempts < 0 || restored.resume.session?.workspaceId !== `batch:${restored.resume.jobId}`
        || !['productId', 'productKey', 'runId', 'inputFingerprint'].every(key => typeof restored.resume.session[key] === 'string' && restored.resume.session[key])
        || !Number.isSafeInteger(restored.resume.session.revision))) fail('invalid');
    } catch { fail('native_command_journal_invalid'); }
  }
  let resume = restored?.resume || null;
  let current = restored || { schema: 'native-factory-command:v1', dirty: false, dirtyEpoch: 0, localActive: false, pending: null };
  const persist = next => write(JSON.stringify({ ...current, resume: next }));
  return Object.freeze({ restored, get resume() { return resume; },
    writeResume(next) { persist(next); resume = next; },
    write({ dirty, dirtyEpoch, dirtyBinding, localActive, pending }) {
    const entry = pending?.payload ? { payload: pending.payload, selection: pending.selection,
      orderId: pending.orderId, dirtyEpoch: pending.dirtyEpoch, sent: pending.sent,
      basis: { jobId: pending.basis.jobId, session: pending.basis.session } } : null;
    current = { schema: 'native-factory-command:v1', dirty, dirtyEpoch, dirtyBinding, localActive, pending: entry };
    persist(resume);
  } });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export function sameCommandData(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
export async function nativeCommandDigest(payload, selection, digestBytes) {
  const value = { ...payload };
  if (selection) delete value.decisionMode;
  const digest = await digestBytes(new TextEncoder().encode(JSON.stringify(canonical(value))));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function readNativeCommandReceipt(io, entry) {
  const payload = entry.payload;
  const result = await io.apiRequest(`/api/factory/jobs/${encodeURIComponent(payload.jobId)}/command-receipt/${encodeURIComponent(payload.idempotencyKey)}`);
  if (result?.jobId !== payload.jobId || result?.idempotencyKey !== payload.idempotencyKey
    || typeof result.orderId !== 'string' || !result.orderId || (entry.orderId && entry.orderId !== result.orderId)
    || result.commandName !== (entry.selection ? 'selectFactoryACut' : 'invokeFactoryTabCommand')
    || result.requestDigest !== await nativeCommandDigest(payload, entry.selection, io.digest)) fail('native_command_receipt_mismatch');
  entry.orderId = result.orderId;
  return result;
}
export async function validateNativeCommandReceipt(entry, receipt) {
  const p = entry.payload;
  if (!entry.selection) {
    await createFactoryControlCommandBridge({ requestClassicRuntime: async () => receipt }).invokeFactoryTabCommand(p);
    return;
  }
  const session = receipt?.projection?.session;
  const checkpoint = validateProductCheckpoint(receipt?.checkpoint, p.jobId);
  if (receipt?.schema !== 'factory-a-cut-receipt:v1' || receipt.idempotencyKey !== p.idempotencyKey
    || receipt.stageKey !== p.stageKey || receipt.candidateId !== p.candidateId
    || !sameCommandIdentity(receipt, session, ['productId', 'productKey', 'runId', 'inputFingerprint', 'revision'])
    || receipt.projection?.schema !== 'factory-control-projection:v1' || receipt.status !== checkpoint.status
    || !sameCommandIdentity(session, entry.basis.session) || receipt.projection?.registration?.jobId !== p.jobId
    || !sameCommandIdentity(checkpoint, session, ['productId', 'productKey', 'runId', 'inputFingerprint', 'revision'])
    || checkpoint.projectId !== session.workspaceId || checkpoint.stageKey !== p.stageKey
    || session.revision < p.expectedRevision || session.storeRevision < entry.basis.session.storeRevision
    || !receipt.projection.stages?.find(stage => stage.key === p.stageKey)?.selectedIds?.includes(p.candidateId)) fail('native_command_receipt_mismatch');
}

export async function assertNativeCommandCheckpoint(io, entry, receipt) {
  const fail = code => { throw Object.assign(new Error(code), { code }); };
  let current = entry.restored ? await assertRestoredNativeCheckpoint(io, entry, receipt) : io.readLocal();
  if (!entry.restored && (current.store !== entry.basis.store || !entry.basis.store.isOperationCurrent(entry.basis.token)
    || current.jobId !== entry.payload.jobId || !sameCommandIdentity(current.session, receipt.projection.session)
    || !sameCommandIdentity(current.session, receipt.projection.session, ['storeRevision'])
    || !Number.isSafeInteger(current.session.revision) || current.session.revision < receipt.projection.session.revision)) fail('native_command_stale_receipt');
  if (!entry.restored && current.session.revision !== receipt.projection.session.revision) {
    const local = await io.readLocalProjection();
    if (!sameCommandIdentity(local.session, current.session) || !sameCommandIdentity(local.session, current.session, ['revision', 'storeRevision'])
      || !sameCommandData(local.inputs, receipt.projection.inputs)
      || !sameCommandData(local.stages, receipt.projection.stages)) fail('native_command_stale_receipt');
    if (!(await io.verifySavedCheckpoint(receipt.checkpoint))) fail('native_command_restore_unverified');
    const latest = io.readLocal();
    if (latest.store !== current.store || latest.jobId !== current.jobId || !entry.basis.store.isOperationCurrent(entry.basis.token)
      || !sameCommandIdentity(latest.session, current.session) || !sameCommandIdentity(latest.session, current.session, ['storeRevision'])
      || !Number.isSafeInteger(latest.session.revision) || latest.session.revision < current.session.revision) fail('native_command_stale_receipt');
    current = latest;
  }
  return current;
}

export async function assertRestoredNativeCheckpoint(io, entry, receipt) {
  let current = io.readLocal();
  const session = receipt.projection.session;
  if (!current.jobId && !current.session.productKey) {
    await io.restoreCheckpoint(receipt);
    current = io.readLocal();
  }
  if (current.jobId !== entry.payload.jobId || !sameCommandIdentity(current.session, session)
    || !(await io.verifySavedCheckpoint(receipt.checkpoint))) fail('native_command_restore_unverified');
  const local = await io.readLocalProjection();
  if (io.readLocal().store !== current.store || !current.store.isOperationCurrent(current.token)
    || !sameCommandIdentity(local.session, current.session)
    || !sameCommandIdentity(local.session, current.session, ['storeRevision'])) fail('native_command_stale_receipt');
  // Read back the restored A+B evidence. A server receipt alone does not restore this page.
  for (const stage of receipt.projection.stages || []) {
    const actual = local.stages?.find(item => item.key === stage.key);
    if (!actual || (stage.candidates || []).some(candidate => !actual.candidates?.some(item => item.id === candidate.id))
      || JSON.stringify([...(stage.selectedIds || [])].sort()) !== JSON.stringify([...(actual.selectedIds || [])].sort())) fail('native_command_restore_unverified');
  }
  let missingWorkflow = false;
  for (const group of receipt.projection.inputs || []) {
    const actual = local.inputs?.find(item => item.key === group.key);
    if (!actual || (typeof group.count === 'number' && actual.count < group.count)) fail('native_command_restore_unverified');
    if (group.key === 'operator_controls' && !sameCommandData(actual.items, group.items)) {
      const before = actual.items?.[0], saved = group.items?.[0];
      missingWorkflow = !entry.selection && entry.payload.tabId === 'workfile' && entry.payload.action === 'save-checkpoint'
        && actual.items?.length === 1 && group.items?.length === 1
        && before?.workflow?.status === '' && before.workflow.stageKey === ''
        && saved?.workflow?.status === receipt.checkpoint.status && saved.workflow.stageKey === receipt.checkpoint.stageKey
        && sameCommandData([{ ...before, workflow: saved.workflow }], group.items);
      if (!missingWorkflow) fail('native_command_restore_unverified');
    }
  }
  if (missingWorkflow) {
    if (typeof io.restoreWorkflowCheckpoint !== 'function' || io.localBusy?.()
      || !sameCommandIdentity(local.progress, receipt.projection.progress, ['status', 'stageKey'])) fail('native_command_restore_unverified');
    await io.restoreWorkflowCheckpoint(receipt);
    const rebound = await io.readLocalProjection();
    if (io.readLocal().store !== current.store || !current.store.isOperationCurrent(current.token)
      || !sameCommandIdentity(rebound.session, current.session)
      || !sameCommandIdentity(rebound.session, current.session, ['storeRevision'])
      || !sameCommandData(rebound.inputs?.find(group => group.key === 'operator_controls')?.items,
        receipt.projection.inputs.find(group => group.key === 'operator_controls').items)) fail('native_command_restore_unverified');
  }
  return current;
}

export async function recoverInterruptedNativeLocal(io, binding) {
  let current = io.readLocal();
  if (binding && !current.jobId && !current.session.productKey) {
    await io.restoreLocalDraft(binding);
    current = io.readLocal();
  }
  if (!binding || binding.jobId !== current.jobId || !sameCommandIdentity(binding.session, current.session)) fail('native_command_dirty_binding');
  const saved = await io.readSavedLocalProof();
  if (!saved) fail('native_command_restore_unverified');
  // This only re-enables editing after an explicit acknowledgement. It does not claim the interrupted File finished.
  if (current.store !== io.readLocal().store || !current.store.isOperationCurrent(current.token)) fail('native_command_stale_receipt');
}

export function localCommandValue(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]') return true;
  return Object.values(value).some(child => localCommandValue(child, seen));
}
export function nativeFieldValue(value) {
  return { fieldId: value?.fieldId ?? value?.id, value: value?.value,
    ...(value?.label === undefined ? {} : { label: value.label }) };
}
