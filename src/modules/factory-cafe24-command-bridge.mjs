export const FACTORY_CAFE24_COMMAND_BRIDGE_VERSION = 'factory-cafe24-command-bridge:v1';
export const FACTORY_CAFE24_COMMAND_VERSION = 'factory-cafe24-command:v1';

export class FactoryCafe24CommandError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'FactoryCafe24CommandError';
    this.code = code;
  }
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value) {
  return String(value ?? '').trim();
}

function assertSafeCommand(kind, name, payload, order) {
  const isReconcile = name === 'verifyDetailToCafe24';
  if (kind !== 'factory-cafe24' || (!isReconcile && name !== 'detailToCafe24')) {
    throw new FactoryCafe24CommandError('cafe24_command_version_unsupported');
  }
  if (!record(payload) || !record(order) || 'approvalToken' in payload) {
    throw new FactoryCafe24CommandError('cafe24_command_payload_invalid');
  }
  if (order.command?.version !== FACTORY_CAFE24_COMMAND_VERSION) {
    throw new FactoryCafe24CommandError('cafe24_command_version_unsupported');
  }
  const requiredFields = [
    'jobId', 'batchId', 'productId', 'productKey', 'categoryId', 'htmlDigest',
    'expectedRunId', 'expectedInputFingerprint', 'idempotencyKey',
  ];
  if (!isReconcile) requiredFields.push('approvalGrantDigest');
  for (const field of requiredFields) {
    if (!text(payload[field])) throw new FactoryCafe24CommandError(`cafe24_command_field_missing:${field}`);
  }
  if (!Array.isArray(payload.imageDigests) || payload.imageDigests.length === 0 || payload.imageDigests.some(item => !text(item))) {
    throw new FactoryCafe24CommandError('cafe24_command_image_digests_invalid');
  }
  if (!Number.isInteger(payload.expectedWorkfileRevision) || payload.expectedWorkfileRevision < 0) {
    throw new FactoryCafe24CommandError('cafe24_command_revision_invalid');
  }
  if (payload.selling !== 'F' || payload.display !== 'F' || payload.market_sync !== 'F') {
    throw new FactoryCafe24CommandError('unsafe_cafe24_defaults');
  }
  const identityPairs = [
    ['productId', 'productId'],
    ['productKey', 'productKey'],
    ['expectedRunId', 'currentRunId'],
    ['expectedWorkfileRevision', 'expectedWorkfileRevision'],
    ['idempotencyKey', 'idempotencyKey'],
  ];
  for (const [payloadField, orderField] of identityPairs) {
    if (payload[payloadField] !== order[orderField]) {
      throw new FactoryCafe24CommandError(
        payloadField === 'expectedWorkfileRevision' ? 'stale_workfile_revision' : 'stale_run_fingerprint',
      );
    }
  }
  if (!text(order.payloadDigest)) throw new FactoryCafe24CommandError('approved_payload_digest_missing');
}

export function createFactoryCafe24CommandBridge({ requestClassicRuntime } = {}) {
  if (typeof requestClassicRuntime !== 'function') {
    throw new FactoryCafe24CommandError('classic_runtime_endpoint_missing');
  }

  async function inspect() {
    const result = await requestClassicRuntime(Object.freeze({
      action: 'inspect-batch-cafe24-registration',
    }));
    if (
      !record(result)
      || result.schema !== 'factory-cafe24-preflight:v1'
      || !['ready', 'blocked'].includes(result.status)
    ) {
      throw new FactoryCafe24CommandError('factory_cafe24_preflight_invalid');
    }
    return Object.freeze({
      ...result,
      imageDigests: Object.freeze(Array.isArray(result.imageDigests) ? [...result.imageDigests] : []),
    });
  }

  async function run(kind, name, payload, order) {
    assertSafeCommand(kind, name, payload, order);
    const result = await requestClassicRuntime(Object.freeze({
      action: 'run-batch-cafe24-registration',
      batchControl: Object.freeze({
        ...payload,
        payloadDigest: order.payloadDigest,
        operationToken: order.operationToken,
        orderId: order.orderId,
      }),
    }));
    if (!record(result) || result.status !== 'staged_verified') {
      throw new FactoryCafe24CommandError('factory_cafe24_result_unverified');
    }
    const externalProductNo = text(result.externalProductNo);
    const expectedProductNo = text(payload.productId).startsWith('cafe24:')
      ? text(payload.productId).slice('cafe24:'.length)
      : '';
    if (!externalProductNo || expectedProductNo && externalProductNo !== expectedProductNo) {
      throw new FactoryCafe24CommandError('factory_cafe24_target_mismatch');
    }
    if (!text(result.remoteReadbackDigest)) {
      throw new FactoryCafe24CommandError('factory_cafe24_readback_missing');
    }
    return Object.freeze({
      status: 'staged_verified',
      payloadDigest: order.payloadDigest,
      remoteReadbackDigest: result.remoteReadbackDigest,
      externalProductNo,
      idempotencyKey: payload.idempotencyKey,
    });
  }

  async function verify(kind, name, payload, order) {
    assertSafeCommand(kind, name, payload, order);
    const result = await requestClassicRuntime(Object.freeze({
      action: 'verify-batch-cafe24-registration',
      batchControl: Object.freeze({
        ...payload,
        payloadDigest: order.payloadDigest,
        operationToken: order.operationToken,
        orderId: order.orderId,
      }),
    }));
    if (!record(result) || result.status !== 'staged_verified') {
      throw new FactoryCafe24CommandError('factory_cafe24_result_unverified');
    }
    const externalProductNo = text(result.externalProductNo);
    const expectedProductNo = text(payload.productId).startsWith('cafe24:')
      ? text(payload.productId).slice('cafe24:'.length)
      : '';
    if (!externalProductNo || expectedProductNo && externalProductNo !== expectedProductNo) {
      throw new FactoryCafe24CommandError('factory_cafe24_target_mismatch');
    }
    if (!text(result.remoteReadbackDigest)) {
      throw new FactoryCafe24CommandError('factory_cafe24_readback_missing');
    }
    return Object.freeze({
      status: 'staged_verified',
      payloadDigest: order.payloadDigest,
      remoteReadbackDigest: result.remoteReadbackDigest,
      externalProductNo,
      idempotencyKey: payload.idempotencyKey,
    });
  }

  return Object.freeze({
    version: FACTORY_CAFE24_COMMAND_BRIDGE_VERSION,
    inspect,
    run,
    verify,
  });
}

export function installFactoryCafe24CommandBridge(windowObject, options = {}) {
  if (!record(windowObject)) throw new FactoryCafe24CommandError('window_missing');
  const bridge = createFactoryCafe24CommandBridge(options);
  const receipt = Object.freeze({
    schema: 'factory-cafe24-command-bridge:v1',
    version: FACTORY_CAFE24_COMMAND_BRIDGE_VERSION,
    bridge,
  });
  Object.defineProperty(windowObject, '__KUASANGSE_BATCH_CONTROL_COMMAND_BRIDGE__', {
    value: bridge,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return receipt;
}
