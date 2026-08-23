export class BatchWorkerContractError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'BatchWorkerContractError';
    this.code = code;
  }
}

export function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function text(value) {
  return String(value ?? '').trim();
}

const SENSITIVE_PRODUCT_FIELD = /authorization|bearer|secret|password|credential|token|api.?key|service.?key|csrf|cookie/iu;
const SENSITIVE_PRODUCT_VALUE = /\bbearer\s+\S+|\b(?:sk|AIza)[-_A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|[?&](?:token|api.?key|secret)=/iu;

export function hasSensitiveProductField(value) {
  if (record(value)) {
    return Object.entries(value).some(([key, child]) => (
      SENSITIVE_PRODUCT_FIELD.test(key) || hasSensitiveProductField(child)
    ));
  }
  return Array.isArray(value) && value.some(hasSensitiveProductField);
}

export function hasSensitiveProductValue(value) {
  if (typeof value === 'string') return SENSITIVE_PRODUCT_VALUE.test(value);
  if (record(value)) {
    return Object.entries(value).some(([key, child]) => key !== 'dataUrl' && hasSensitiveProductValue(child));
  }
  return Array.isArray(value) && value.some(hasSensitiveProductValue);
}

const PRODUCT_CHECKPOINT_KEYS = Object.freeze([
  'schema',
  'jobId',
  'projectId',
  'productId',
  'productKey',
  'runId',
  'inputFingerprint',
  'revision',
  'status',
  'stageKey',
  'savedAt',
]);

export function validateProductCheckpoint(value, jobId) {
  if (
    !record(value)
    || Object.keys(value).length !== PRODUCT_CHECKPOINT_KEYS.length
    || Object.keys(value).some(key => !PRODUCT_CHECKPOINT_KEYS.includes(key))
    || value.schema !== 'factory-product-checkpoint:v1'
    || text(value.jobId) !== text(jobId)
    || value.projectId !== `batch:${text(jobId)}`
    || !['waiting_manual', 'blocked', 'completed'].includes(value.status)
    || typeof value.stageKey !== 'string'
    || value.stageKey !== text(value.stageKey)
    || !Number.isInteger(value.revision)
    || value.revision < 0
    || !Number.isInteger(value.savedAt)
    || value.savedAt < 1
  ) {
    throw new BatchWorkerContractError('factory_product_checkpoint_invalid');
  }
  for (const field of ['productId', 'productKey', 'runId', 'inputFingerprint']) {
    if (!text(value[field])) {
      throw new BatchWorkerContractError('factory_product_checkpoint_invalid');
    }
  }
  return Object.freeze({ ...value });
}

const PRODUCT_RUN_KEYS = Object.freeze([
  'batchId',
  'idempotencyKey',
  'mode',
  'source',
  'productName',
  'workfileName',
  'jcode',
  'imageModel',
  'requiredValues',
  'inputImages',
  'decisionModes',
  'schema',
  'jobId',
  'startFresh',
  'expectedStageKey',
  'restoreOnly',
  'adoptHydratedWorkfile',
  'hydratedRevision',
  'checkpoint',
  'regenerateStage',
]);
const POLICY_DECISION_KEYS = Object.freeze([
  'sinhwa_db_product',
  'cafe24_product',
  'competitor_product',
  'competitor_coupang',
  'competitor_smartstore',
  'competitor_gmarket',
  'competitor_auction',
  'competitor_elevenst',
  'required_field_candidate',
  'representative_image',
  'size_image',
  'option_image',
  'general_image',
  'section_variant',
  'final_detail',
]);
const PRODUCT_REQUIRED_VALUE_KEYS = Object.freeze([
  'category', 'material', 'originCountry', 'size', 'salePrice', 'stock', 'usage', 'optionMode',
  // 관제탑에서 고르는 Cafe24 등록 대상 값. 비어 있어도 되지만 오면 받아야 한다.
  'cafe24CategoryId', 'supplyPrice', 'displayStatus', 'sellingStatus',
]);
const PRODUCT_IMAGE_KEYS = Object.freeze([
  'role', 'ordinal', 'name', 'fileName', 'colorName', 'sha256', 'dataUrl',
]);
const PRODUCT_IMAGE_MODELS = Object.freeze(['api-hub-openai-image', 'gemini-3.1-flash-image']);

export function validateProductRunPayload(payload) {
  if (
    !record(payload)
    || Object.keys(payload).some(key => !PRODUCT_RUN_KEYS.includes(key))
    || hasSensitiveProductField(payload)
    || hasSensitiveProductValue(payload)
  ) {
    throw new BatchWorkerContractError('factory_product_sensitive_field_forbidden');
  }
  for (const field of ['jobId', 'batchId', 'mode', 'productName']) {
    if (!text(payload[field])) {
      throw new BatchWorkerContractError(`factory_product_field_missing:${field}`);
    }
  }
  if (
    payload.schema !== 'factory-product-run-command:v1'
    || !['manual', 'auto'].includes(payload.mode)
    || (payload.imageModel !== undefined && !PRODUCT_IMAGE_MODELS.includes(payload.imageModel))
    || typeof payload.startFresh !== 'boolean'
    || (payload.restoreOnly !== undefined && typeof payload.restoreOnly !== 'boolean')
    || (payload.adoptHydratedWorkfile !== undefined && typeof payload.adoptHydratedWorkfile !== 'boolean')
    || (payload.hydratedRevision !== undefined && (
      !Number.isInteger(payload.hydratedRevision) || payload.hydratedRevision < 0
    ))
    || (payload.expectedStageKey !== undefined && payload.expectedStageKey !== text(payload.expectedStageKey))
    || (payload.workfileName !== undefined && (
      typeof payload.workfileName !== 'string'
      || !/^[^\\/:*?"<>|]+\.kuasangse$/u.test(payload.workfileName)
      || payload.workfileName.length > 160
    ))
    || !record(payload.source)
    || !['manual', 'sinhwa-db', 'workfile'].includes(payload.source.kind)
    || Object.keys(payload.source).length !== ({ manual: 1, 'sinhwa-db': 2, workfile: 8 })[payload.source.kind]
    || Object.keys(payload.source).some(key => ![
      'kind', 'selectionId', 'sha256', 'revision', 'runId', 'workspaceId', 'productId', 'productKey', 'inputFingerprint',
    ].includes(key))
    || !record(payload.requiredValues)
    || Object.keys(payload.requiredValues).some(key => !PRODUCT_REQUIRED_VALUE_KEYS.includes(key))
    || Object.values(payload.requiredValues).some(value => typeof value !== 'string' || value.length > 200)
    || (
      payload.requiredValues.salePrice !== undefined
      && !/^\d{1,12}$/u.test(payload.requiredValues.salePrice)
    )
    || (
      payload.requiredValues.stock !== undefined
      && !/^\d{1,9}$/u.test(payload.requiredValues.stock)
    )
    || (
      payload.requiredValues.optionMode !== undefined
      && !['provided', 'none'].includes(payload.requiredValues.optionMode)
    )
    || !Array.isArray(payload.inputImages)
    || (payload.decisionModes !== undefined && (
      !record(payload.decisionModes)
      || Object.keys(payload.decisionModes).length !== POLICY_DECISION_KEYS.length
      || Object.keys(payload.decisionModes).some(key => !POLICY_DECISION_KEYS.includes(key))
      || Object.values(payload.decisionModes).some(mode => !['auto', 'manual'].includes(mode))
    ))
    || payload.inputImages.some(image => (
      !record(image)
      || Object.keys(image).some(key => !PRODUCT_IMAGE_KEYS.includes(key))
      || !['base', 'color-option'].includes(image.role)
      || !text(image.name)
      || !text(image.dataUrl).startsWith('data:image/')
    ))
  ) {
    throw new BatchWorkerContractError('factory_product_payload_invalid');
  }
  if (
    payload.source.kind === 'sinhwa-db'
    && (
      !Number.isInteger(payload.jcode)
      || payload.jcode < 1
      || payload.source.selectionId !== String(payload.jcode)
    )
  ) {
    throw new BatchWorkerContractError('factory_product_jcode_invalid');
  }
  if (
    payload.source.kind === 'workfile'
    && (
      payload.adoptHydratedWorkfile !== true
      || payload.startFresh !== false
      || !Number.isInteger(payload.hydratedRevision)
      || payload.hydratedRevision < 0
      || !/^[a-f0-9]{64}$/u.test(text(payload.source.sha256))
      || !Number.isInteger(payload.source.revision)
      || payload.source.revision < 0
      || ['runId', 'workspaceId', 'productId', 'productKey', 'inputFingerprint'].some(
        field => !text(payload.source[field]),
      )
    )
  ) {
    throw new BatchWorkerContractError('factory_workfile_fork_identity_invalid');
  }
  if (
    payload.source.kind === 'manual'
    && !payload.inputImages.some(image => image.role === 'base')
  ) {
    throw new BatchWorkerContractError('factory_product_base_image_required');
  }
  if (payload.restoreOnly === true) validateProductCheckpoint(payload.checkpoint, payload.jobId);
  else if (payload.checkpoint !== undefined) {
    throw new BatchWorkerContractError('factory_product_checkpoint_invalid');
  }
  return Object.freeze({ ...payload });
}
