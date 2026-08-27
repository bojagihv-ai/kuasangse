/**
 * 조립공장 제어 명령이 주고받는 값의 생김새를 확인하는 자리.
 *
 * 명령을 실제로 넘기는 일(bridge)과 값이 옳은지 보는 일은 서로 다른 일이다.
 * 한 파일에 같이 두면 명령이 하나 늘 때마다 검사도 같이 불어나 파일이 계속 커진다.
 * 그래서 값 검사만 여기에 모은다.
 */

export const FACTORY_CONTROL_COMMAND_VERSION = 'factory-control-command:v1';
export const FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION = 'factory-workfile-hydration-command:v1';

export class FactoryControlCommandError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FactoryControlCommandError';
    this.code = code;
  }
}

export function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

export function text(value) {
  return String(value ?? '').trim();
}

/** 빠진 칸이 있으면 어느 칸인지 이름을 붙여 알린다. 그래야 어디를 채울지 안다. */
export function requireFields(value, fields, missingCode) {
  for (const field of fields) {
    if (!text(value[field])) throw new FactoryControlCommandError(`${missingCode}:${field}`);
  }
}

export function selectionPayload(value) {
  if (!record(value)) throw new FactoryControlCommandError('factory_control_payload_invalid');
  requireFields(value, [
    'productId',
    'productKey',
    'stageKey',
    'candidateId',
    'expectedRunId',
    'expectedInputFingerprint',
    'idempotencyKey',
  ], 'factory_control_field_missing');
  if (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 0) {
    throw new FactoryControlCommandError('factory_control_revision_invalid');
  }
  return Object.freeze({ ...value });
}

export function hydrationPayload(value, order) {
  if (!record(value) || !record(order)) {
    throw new FactoryControlCommandError('factory_workfile_payload_invalid');
  }
  if (
    value.contractVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
    || value.capabilityVersion !== FACTORY_WORKFILE_HYDRATION_COMMAND_VERSION
  ) {
    throw new FactoryControlCommandError('factory_workfile_command_version_unsupported');
  }
  requireFields(value, [
    'fileName',
    'workfileText',
    'expectedSha256',
    'expectedWorkspaceId',
    'expectedProductId',
    'expectedProductKey',
    'expectedRunId',
    'idempotencyKey',
  ], 'factory_workfile_field_missing');
  if (
    (value.expectedInputFingerprint !== undefined && !text(value.expectedInputFingerprint))
    || !/^[a-f0-9]{64}$/u.test(text(value.expectedSha256).toLocaleLowerCase('en-US'))
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
