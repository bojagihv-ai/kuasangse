import {
  validateProductCheckpoint,
  validateProductRunPayload,
} from './batch-control-contract.mjs';

export const FACTORY_CONTROL_COMMAND_BRIDGE_VERSION = 'factory-control-command-bridge:v1';
export const FACTORY_CONTROL_COMMAND_VERSION = 'factory-control-command:v1';
export const FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION = 'factory-workfile-hydration-command:v1';

export class FactoryControlCommandError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FactoryControlCommandError';
    this.code = code;
  }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return String(value ?? '').trim();
}

function selectionPayload(value) {
  if (!record(value)) throw new FactoryControlCommandError('factory_control_payload_invalid');
  const fields = [
    'productId',
    'productKey',
    'stageKey',
    'candidateId',
    'expectedRunId',
    'expectedInputFingerprint',
    'idempotencyKey',
  ];
  for (const field of fields) {
    if (!text(value[field])) throw new FactoryControlCommandError(`factory_control_field_missing:${field}`);
  }
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) {
    throw new FactoryControlCommandError('factory_control_revision_invalid');
  }
  return Object.freeze({ ...value });
}

function productRunPayload(value) {
  try {
    return validateProductRunPayload(value);
  } catch (error) {
    throw new FactoryControlCommandError(text(error?.code || 'factory_product_payload_invalid'));
  }
}

function hydrationPayload(value, order) {
  if (!record(value) || !record(order)) {
    throw new FactoryControlCommandError('factory_workfile_payload_invalid');
  }
  if (
    value.contractVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
    || value.capabilityVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
  ) {
    throw new FactoryControlCommandError('factory_workfile_command_version_unsupported');
  }
  for (const field of [
    'fileName',
    'workfileText',
    'expectedSha256',
    'expectedWorkspaceId',
    'expectedProductId',
    'expectedProductKey',
    'expectedRunId',
    'idempotencyKey',
  ]) {
    if (!text(value[field])) {
      throw new FactoryControlCommandError(`factory_workfile_field_missing:${field}`);
    }
  }
  if (
    (value.expectedInputFingerprint !== undefined && !text(value.expectedInputFingerprint))
    ||
    !/^[a-f0-9]{64}$/u.test(text(value.expectedSha256).toLocaleLowerCase('en-US'))
    || !Number.isInteger(value.expectedWorkfileRevision)
    || value.expectedWorkfileRevision < 0
  ) {
    throw new FactoryControlCommandError('factory_workfile_identity_invalid');
  }
  if (
    value.expectedProductId !== order.productId
    || value.expectedProductKey !== order.productKey
    || value.expectedRunId !== order.currentRunId
    || value.expectedWorkfileRevision !== order.expectedWorkfileRevision
    || value.idempotencyKey !== order.idempotencyKey
  ) {
    throw new FactoryControlCommandError('factory_workfile_identity_mismatch');
  }
  return Object.freeze({ ...value });
}

export function createFactoryControlCommandBridge({ requestClassicRuntime, hydrateWorkfile } = {}) {
  if (typeof requestClassicRuntime !== 'function') {
    throw new FactoryControlCommandError('classic_runtime_endpoint_missing');
  }

  async function getProjection() {
    const result = await requestClassicRuntime(Object.freeze({
      capabilityVersion: FACTORY_CONTROL_COMMAND_VERSION,
      command: 'getFactoryProjection',
    }));
    if (!record(result) || result.schema !== 'factory-control-projection:v1') {
      throw new FactoryControlCommandError('factory_projection_invalid');
    }
    return Object.freeze(result);
  }

  async function selectACut(payloadValue) {
    const payload = selectionPayload(payloadValue);
    const result = await requestClassicRuntime(Object.freeze({
      capabilityVersion: FACTORY_CONTROL_COMMAND_VERSION,
      command: 'selectFactoryACut',
      payload,
    }));
    if (!record(result) || result.schema !== 'factory-a-cut-receipt:v1') {
      throw new FactoryControlCommandError('factory_a_cut_receipt_invalid');
    }
    return Object.freeze(result);
  }

  async function runProduct(payloadValue) {
    const payload = productRunPayload(payloadValue);
    const result = await requestClassicRuntime(Object.freeze({
      capabilityVersion: FACTORY_CONTROL_COMMAND_VERSION,
      command: 'runFactoryProduct',
      payload,
    }));
    if (
      !record(result)
      || result.schema !== 'factory-product-run-receipt:v1'
      || text(result.jobId) !== text(payload.jobId)
      || !['waiting_manual', 'completed', 'blocked'].includes(result.status)
    ) {
      throw new FactoryControlCommandError('factory_product_receipt_invalid');
    }
    let checkpoint;
    try {
      checkpoint = validateProductCheckpoint(result.checkpoint, payload.jobId);
    } catch {
      throw new FactoryControlCommandError('factory_product_checkpoint_invalid');
    }
    if (checkpoint.status !== result.status || checkpoint.stageKey !== text(result.stageKey)) {
      throw new FactoryControlCommandError('factory_product_checkpoint_invalid');
    }
    return Object.freeze(result);
  }

  async function hydrateFactoryWorkfile(payloadValue, order) {
    if (typeof hydrateWorkfile !== 'function') {
      throw new FactoryControlCommandError('factory_workfile_bridge_missing');
    }
    const payload = hydrationPayload(payloadValue, order);
    const currentProjection = await getProjection();
    const currentSession = record(currentProjection.session) ? currentProjection.session : {};
    const blankRebind = text(order.workerSessionId)
      && currentSession.revision === 0
      && !text(currentSession.workspaceId)
      && !text(currentSession.productId)
      && !text(currentSession.productKey)
      && !text(currentSession.runId)
      && !text(currentSession.inputFingerprint)
      && text(payload.expectedInputFingerprint);
    if (currentSession.revision !== payload.expectedWorkfileRevision && !blankRebind) {
      throw new FactoryControlCommandError('stale_workfile_revision');
    }
    const receipt = await hydrateWorkfile(payload);
    if (
      !record(receipt)
      || receipt.schema !== 'factory-workfile-hydration-receipt:v1'
      || receipt.capabilityVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
      || text(receipt.workfileSha256).toLocaleLowerCase('en-US')
        !== text(payload.expectedSha256).toLocaleLowerCase('en-US')
      || text(receipt.projectId) !== text(payload.expectedWorkspaceId)
      || text(receipt.name) !== text(payload.expectedProductKey)
    ) {
      throw new FactoryControlCommandError('factory_workfile_receipt_invalid');
    }
    const projection = await getProjection();
    const session = record(projection.session) ? projection.session : {};
    if (
      text(session.workspaceId) !== text(payload.expectedWorkspaceId)
      || text(session.productId) !== text(payload.expectedProductId)
      || text(session.productKey) !== text(payload.expectedProductKey)
      || text(session.runId) !== text(payload.expectedRunId)
      || !text(session.inputFingerprint)
      || (
        text(payload.expectedInputFingerprint)
        && text(session.inputFingerprint) !== text(payload.expectedInputFingerprint)
      )
      || !Number.isInteger(session.revision)
      || session.revision < 0
    ) {
      throw new FactoryControlCommandError('factory_workfile_projection_mismatch');
    }
    return Object.freeze({
      ...receipt,
      projection,
    });
  }

  async function run(kind, name, payload = {}, order = {}) {
    if (kind === 'factory-workfile') {
      if (name === 'hydrateFactoryWorkfile') return hydrateFactoryWorkfile(payload, order);
      throw new FactoryControlCommandError('factory_workfile_command_unsupported');
    }
    if (kind !== 'factory-control') {
      throw new FactoryControlCommandError('factory_control_command_unsupported');
    }
    if (name === 'getFactoryProjection') return getProjection();
    if (name === 'selectFactoryACut') return selectACut(payload);
    if (name === 'runFactoryProduct') return runProduct(payload);
    throw new FactoryControlCommandError('factory_control_command_unsupported');
  }

  return Object.freeze({
    version: FACTORY_CONTROL_COMMAND_BRIDGE_VERSION,
    getProjection,
    hydrateFactoryWorkfile,
    runProduct,
    selectACut,
    run,
  });
}

export function installFactoryControlCommandBridge(windowObject, options = {}) {
  if (!record(windowObject)) throw new FactoryControlCommandError('window_missing');
  const bridge = createFactoryControlCommandBridge({
    ...options,
    hydrateWorkfile: options.hydrateWorkfile || ((command) => {
      const workfileBridge = windowObject.__KUASANGSE_WORKFILE_COMMAND_BRIDGE__;
      if (!record(workfileBridge) || typeof workfileBridge.hydrate !== 'function') {
        throw new FactoryControlCommandError('factory_workfile_bridge_missing');
      }
      return workfileBridge.hydrate(command);
    }),
  });
  const receipt = Object.freeze({
    schema: 'factory-control-command-bridge:v1',
    version: FACTORY_CONTROL_COMMAND_BRIDGE_VERSION,
    bridge,
  });
  Object.defineProperty(windowObject, '__KUASANGSE_FACTORY_CONTROL_COMMAND_BRIDGE__', {
    value: bridge,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return receipt;
}
