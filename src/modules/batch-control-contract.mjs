import {
  BatchWorkerContractError,
  hasSensitiveProductField,
  hasSensitiveProductValue,
  record,
  text,
  validateProductCheckpoint,
  validateProductRunPayload,
} from './batch-control-product-contract.mjs';

export {
  BatchWorkerContractError,
  hasSensitiveProductField,
  hasSensitiveProductValue,
  record,
  text,
  validateProductCheckpoint,
  validateProductRunPayload,
};

export const BATCH_CONTROL_WORKER_CAPABILITY_VERSION = 'batch-control-worker:v1';
export const BATCH_CONTROL_WORK_ORDER_VERSION = 'control-work-order:v1';
export const BATCH_CONTROL_CAFE24_COMMAND_VERSION = 'factory-cafe24-command:v1';
export const BATCH_CONTROL_FACTORY_COMMAND_VERSION = 'factory-control-command:v1';
export const BATCH_CONTROL_WORKFILE_COMMAND_VERSION = 'factory-workfile-hydration-command:v1';
export const BATCH_CONTROL_COMMAND_KINDS = Object.freeze([
  'factory-composition',
  'factory-store',
  'workspace-persistence',
  'factory-cafe24',
  'factory-control',
  'factory-workfile',
]);

export const WORKER_ENDPOINTS = Object.freeze({
  claim: '/api/worker/claim',
  ack: orderId => `/api/worker/${encodeURIComponent(orderId)}/ack`,
  heartbeat: orderId => `/api/worker/${encodeURIComponent(orderId)}/heartbeat`,
  events: orderId => `/api/worker/${encodeURIComponent(orderId)}/events`,
  complete: orderId => `/api/worker/${encodeURIComponent(orderId)}/complete`,
  fail: orderId => `/api/worker/${encodeURIComponent(orderId)}/fail`,
  factoryHello: '/api/factory/session/hello',
  factoryHeartbeat: '/api/factory/session/heartbeat',
  factorySync: '/api/factory/sync',
  factoryWorkfileHydrate: '/api/factory/workfile/hydrate',
});

export class BatchWorkerHttpError extends Error {
  constructor(status, endpoint, code = '') {
    const errorCode = text(code);
    super(`batch worker HTTP ${status}: ${endpoint}${errorCode ? ` (${errorCode})` : ''}`);
    this.name = 'BatchWorkerHttpError';
    this.status = status;
    this.endpoint = endpoint;
    this.code = errorCode || 'batch_worker_http_error';
  }
}

export function validateOrder(order) {
  if (!record(order)) throw new BatchWorkerContractError('order_invalid');
  if (order.contractVersion !== BATCH_CONTROL_WORK_ORDER_VERSION) {
    throw new BatchWorkerContractError('contract_version_unsupported');
  }
  if (order.capabilityVersion !== BATCH_CONTROL_WORKER_CAPABILITY_VERSION) {
    throw new BatchWorkerContractError('capability_version_unsupported');
  }
  for (const field of ['orderId', 'batchId', 'productId', 'productKey', 'currentRunId', 'stageId', 'operationToken', 'idempotencyKey']) {
    if (!text(order[field])) throw new BatchWorkerContractError(`identifier_missing:${field}`);
  }
  if (!Number.isInteger(order.expectedWorkfileRevision) || order.expectedWorkfileRevision < 0) {
    throw new BatchWorkerContractError('revision_invalid');
  }
  if (!record(order.command) || !BATCH_CONTROL_COMMAND_KINDS.includes(text(order.command.kind))) {
    throw new BatchWorkerContractError('command_kind_unsupported');
  }
  if (!text(order.command.version) || !text(order.command.name)) {
    throw new BatchWorkerContractError('command_version_missing');
  }
  if (order.command.kind === 'factory-cafe24') {
    const isPreflight = order.command.name === 'inspectDetailToCafe24';
    const isReconcile = order.command.name === 'verifyDetailToCafe24';
    if (
      order.command.version !== BATCH_CONTROL_CAFE24_COMMAND_VERSION
      || (!isPreflight && !isReconcile && order.command.name !== 'detailToCafe24')
    ) {
      throw new BatchWorkerContractError('cafe24_command_version_unsupported');
    }
    if (!record(order.command.payload) || 'approvalToken' in order.command.payload) {
      throw new BatchWorkerContractError('cafe24_command_payload_invalid');
    }
    if (isPreflight) {
      if (Object.keys(order.command.payload).length !== 0) {
        throw new BatchWorkerContractError('cafe24_command_payload_invalid');
      }
      return Object.freeze({ ...order, command: Object.freeze({ ...order.command }) });
    }
    const requiredFields = [
      'jobId', 'productId', 'productKey', 'categoryId', 'htmlDigest',
      'expectedRunId', 'expectedInputFingerprint', 'idempotencyKey',
    ];
    if (!isReconcile) requiredFields.push('approvalGrantDigest');
    for (const field of requiredFields) {
      if (!text(order.command.payload[field])) {
        throw new BatchWorkerContractError(`cafe24_command_field_missing:${field}`);
      }
    }
    if (
      !Array.isArray(order.command.payload.imageDigests)
      || order.command.payload.imageDigests.length === 0
      || order.command.payload.imageDigests.some(item => !text(item))
    ) {
      throw new BatchWorkerContractError('cafe24_command_image_digests_invalid');
    }
    if (
      !Number.isInteger(order.command.payload.expectedWorkfileRevision)
      || order.command.payload.expectedWorkfileRevision < 0
    ) {
      throw new BatchWorkerContractError('cafe24_command_revision_invalid');
    }
  }
  if (order.command.kind === 'factory-control') {
    const isProductRun = order.command.name === 'runFactoryProduct';
    if (
      order.command.version !== BATCH_CONTROL_FACTORY_COMMAND_VERSION
      || ![
        'getFactoryProjection',
        'selectFactoryACut',
        'runFactoryProduct',
        'registerFactoryCafe24',
        // 관제탑에서 적어 준 프롬프트로 그 단계의 컷을 새로 만든다.
        'composeFactoryCut',
      ].includes(order.command.name)
    ) {
      throw new BatchWorkerContractError('factory_control_command_version_unsupported');
    }
    if (!record(order.command.payload)) {
      throw new BatchWorkerContractError('factory_control_command_payload_invalid');
    }
    if (order.command.name === 'getFactoryProjection') {
      if (Object.keys(order.command.payload).length !== 0) {
        throw new BatchWorkerContractError('factory_control_command_payload_invalid');
      }
      return Object.freeze({ ...order, command: Object.freeze({ ...order.command }) });
    }
    const payload = order.command.payload;
    if (order.command.name === 'composeFactoryCut') {
      if (!text(payload.jobId)) throw new BatchWorkerContractError('factory_control_command_payload_invalid');
      if (!text(payload.stageKey)) throw new BatchWorkerContractError('factory_control_command_payload_invalid');
      if (!text(payload.prompt)) throw new BatchWorkerContractError('factory_control_command_payload_invalid');
      return Object.freeze({ ...order, command: Object.freeze({ ...order.command }) });
    }
    if (order.command.name === 'registerFactoryCafe24') {
      if (!text(payload.jobId)) {
        throw new BatchWorkerContractError('factory_control_field_missing:jobId');
      }
      if (payload.cafe24 !== undefined && !record(payload.cafe24)) {
        throw new BatchWorkerContractError('factory_control_command_payload_invalid');
      }
      return Object.freeze({ ...order, command: Object.freeze({ ...order.command }) });
    }
    if (isProductRun) {
      validateProductRunPayload(payload);
      if (
        payload.jobId !== order.currentRunId
        || payload.batchId !== order.batchId
        || payload.productName !== order.productKey
      ) {
        throw new BatchWorkerContractError('factory_product_identity_mismatch');
      }
      if (payload.source.kind === 'sinhwa-db' && order.productId !== `sinhwa:${payload.jcode}`) {
        throw new BatchWorkerContractError('factory_product_jcode_invalid');
      }
      return Object.freeze({ ...order, command: Object.freeze({ ...order.command }) });
    }
    for (const field of [
      'productId',
      'productKey',
      'stageKey',
      'candidateId',
      'expectedRunId',
      'expectedInputFingerprint',
      'idempotencyKey',
    ]) {
      if (!text(payload[field])) {
        throw new BatchWorkerContractError(`factory_control_field_missing:${field}`);
      }
    }
    if (!Number.isInteger(payload.expectedRevision) || payload.expectedRevision < 0) {
      throw new BatchWorkerContractError('factory_control_revision_invalid');
    }
    if (
      payload.productId !== order.productId
      || payload.productKey !== order.productKey
      || payload.expectedRunId !== order.currentRunId
      || payload.expectedRevision !== order.expectedWorkfileRevision
      || payload.idempotencyKey !== order.idempotencyKey
      || payload.stageKey !== order.stageId
    ) {
      throw new BatchWorkerContractError('factory_control_identity_mismatch');
    }
  }
  if (order.command.kind === 'factory-workfile') {
    if (
      order.command.version !== BATCH_CONTROL_WORKFILE_COMMAND_VERSION
      || order.command.name !== 'hydrateFactoryWorkfile'
      || !record(order.command.payload)
    ) {
      throw new BatchWorkerContractError('factory_workfile_command_version_unsupported');
    }
    const payload = order.command.payload;
    if (
      payload.contractVersion !== BATCH_CONTROL_WORKFILE_COMMAND_VERSION
      || payload.capabilityVersion !== BATCH_CONTROL_WORKFILE_COMMAND_VERSION
    ) {
      throw new BatchWorkerContractError('factory_workfile_command_version_unsupported');
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
      if (!text(payload[field])) {
        throw new BatchWorkerContractError(`factory_workfile_field_missing:${field}`);
      }
    }
    if (
      (payload.expectedInputFingerprint !== undefined && !text(payload.expectedInputFingerprint))
      ||
      !/^[a-f0-9]{64}$/u.test(text(payload.expectedSha256).toLocaleLowerCase('en-US'))
      || !Number.isInteger(payload.expectedWorkfileRevision)
      || payload.expectedWorkfileRevision < 0
    ) {
      throw new BatchWorkerContractError('factory_workfile_identity_invalid');
    }
    if (
      payload.expectedProductId !== order.productId
      || payload.expectedProductKey !== order.productKey
      || payload.expectedRunId !== order.currentRunId
      || payload.expectedWorkfileRevision !== order.expectedWorkfileRevision
      || payload.idempotencyKey !== order.idempotencyKey
      || order.stageId !== 'workfile-hydration'
    ) {
      throw new BatchWorkerContractError('factory_workfile_identity_mismatch');
    }
  }
  return Object.freeze({ ...order, command: Object.freeze({ ...order.command }) });
}

export function jsonHeaders() {
  return Object.freeze({ 'Content-Type': 'application/json' });
}

export function projectionIdentity(projection) {
  const session = record(projection?.session) ? projection.session : {};
  return Object.freeze({
    productId: text(session.productId),
    productKey: text(session.productKey),
    runId: text(session.runId),
    inputFingerprint: text(session.inputFingerprint),
    revision: Number.isInteger(session.revision) && session.revision >= 0 ? session.revision : 0,
  });
}
