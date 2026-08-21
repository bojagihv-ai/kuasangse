import {
  BATCH_CONTROL_WORKFILE_COMMAND_VERSION,
  BatchWorkerContractError,
} from './batch-control-contract.mjs';

export const FACTORY_WORKFILE_WEBMCP_TOOL_NAME = 'hydrate_factory_workfile';

const PAYLOAD_KEYS = Object.freeze([
  'contractVersion',
  'capabilityVersion',
  'fileName',
  'workfileText',
  'expectedSha256',
  'expectedWorkspaceId',
  'expectedProductId',
  'expectedProductKey',
  'expectedRunId',
  'expectedInputFingerprint',
  'expectedWorkfileRevision',
  'idempotencyKey',
]);

const INPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: Object.freeze({
    contractVersion: Object.freeze({ type: 'string', const: BATCH_CONTROL_WORKFILE_COMMAND_VERSION }),
    capabilityVersion: Object.freeze({ type: 'string', const: BATCH_CONTROL_WORKFILE_COMMAND_VERSION }),
    fileName: Object.freeze({ type: 'string' }),
    workfileText: Object.freeze({ type: 'string' }),
    expectedSha256: Object.freeze({ type: 'string', pattern: '^[a-fA-F0-9]{64}$' }),
    expectedWorkspaceId: Object.freeze({ type: 'string' }),
    expectedProductId: Object.freeze({ type: 'string' }),
    expectedProductKey: Object.freeze({ type: 'string' }),
    expectedRunId: Object.freeze({ type: 'string' }),
    expectedInputFingerprint: Object.freeze({ type: 'string' }),
    expectedWorkfileRevision: Object.freeze({ type: 'integer', minimum: 0 }),
    idempotencyKey: Object.freeze({ type: 'string' }),
  }),
  required: Object.freeze(PAYLOAD_KEYS.filter(key => key !== 'expectedInputFingerprint')),
});

export class FactoryWorkfileWebMcpError extends Error {
  constructor(code) {
    super(code);
    this.name = 'FactoryWorkfileWebMcpError';
    this.code = code;
  }
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createFactoryWorkfileHydrationSubmission({ post, runOnce, endpoint }) {
  const waiters = new Map();
  function settle(orderId, method, value) {
    const waiter = waiters.get(orderId);
    if (!waiter) return;
    waiters.delete(orderId);
    waiter[method](value);
  }
  async function submit(value, timeoutMs = 120000) {
    const accepted = await post(endpoint, value);
    const order = record(accepted?.order) ? accepted.order : {};
    const orderId = String(order.orderId ?? '').trim();
    if (
      accepted?.accepted !== true
      || !orderId
      || String(order.idempotencyKey ?? '').trim() !== String(value?.idempotencyKey ?? '').trim()
    ) {
      throw new BatchWorkerContractError('factory_workfile_queue_receipt_invalid');
    }
    if (waiters.has(orderId)) throw new BatchWorkerContractError('factory_workfile_hydration_pending');
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        waiters.delete(orderId);
        reject(new BatchWorkerContractError('factory_workfile_hydration_timeout'));
      }, Math.max(1, Number(timeoutMs) || 120000));
      waiters.set(orderId, {
        resolve(result) { clearTimeout(timeoutId); resolve(result); },
        reject(error) { clearTimeout(timeoutId); reject(error); },
      });
      void runOnce().catch(() => null);
    });
  }
  return Object.freeze({
    submit,
    resolve: (orderId, result) => settle(orderId, 'resolve', result),
    reject: (orderId, error) => settle(orderId, 'reject', error),
  });
}

function payload(value) {
  if (!record(value) || Object.keys(value).some(key => !PAYLOAD_KEYS.includes(key))) {
    throw new FactoryWorkfileWebMcpError('factory_workfile_webmcp_payload_invalid');
  }
  if (
    value.contractVersion !== BATCH_CONTROL_WORKFILE_COMMAND_VERSION
    || value.capabilityVersion !== BATCH_CONTROL_WORKFILE_COMMAND_VERSION
  ) {
    throw new FactoryWorkfileWebMcpError('factory_workfile_command_version_unsupported');
  }
  for (const key of INPUT_SCHEMA.required) {
    if (key === 'expectedWorkfileRevision') continue;
    if (!String(value[key] ?? '').trim()) {
      throw new FactoryWorkfileWebMcpError(`factory_workfile_field_missing:${key}`);
    }
  }
  if (!Number.isInteger(value.expectedWorkfileRevision) || value.expectedWorkfileRevision < 0) {
    throw new FactoryWorkfileWebMcpError('factory_workfile_identity_invalid');
  }
  return Object.freeze({ ...value });
}

function terminalReceipt(result, command) {
  const projection = record(result?.projection) ? result.projection : {};
  const session = record(projection.session) ? projection.session : {};
  if (
    result?.schema !== 'factory-workfile-hydration-receipt:v1'
    || result.capabilityVersion !== BATCH_CONTROL_WORKFILE_COMMAND_VERSION
    || result.workfileSha256 !== command.expectedSha256
    || result.projectId !== command.expectedWorkspaceId
    || result.name !== command.expectedProductKey
    || session.workspaceId !== command.expectedWorkspaceId
    || session.productId !== command.expectedProductId
    || session.productKey !== command.expectedProductKey
    || session.runId !== command.expectedRunId
    || (command.expectedInputFingerprint && session.inputFingerprint !== command.expectedInputFingerprint)
    || !Number.isInteger(session.revision)
    || session.revision < 0
  ) {
    throw new FactoryWorkfileWebMcpError('factory_workfile_terminal_receipt_invalid');
  }
  const stages = Array.isArray(projection.stages) ? projection.stages : [];
  return Object.freeze({
    schema: 'factory-workfile-webmcp-receipt:v1',
    capabilityVersion: BATCH_CONTROL_WORKFILE_COMMAND_VERSION,
    workfileSha256: result.workfileSha256,
    workspaceId: session.workspaceId,
    productId: session.productId,
    productKey: session.productKey,
    runId: session.runId,
    inputFingerprint: session.inputFingerprint,
    revision: session.revision,
    assetCount: stages.reduce((sum, stage) => sum + (Array.isArray(stage?.candidates) ? stage.candidates.length : 0), 0),
    selectedAssetCount: stages.reduce((sum, stage) => sum + (Array.isArray(stage?.selectedIds) ? stage.selectedIds.length : 0), 0),
  });
}

export async function installFactoryWorkfileWebMcp(documentObject, worker) {
  const modelContext = documentObject?.modelContext;
  if (typeof modelContext?.registerTool !== 'function') {
    return Object.freeze({ active: false, toolName: FACTORY_WORKFILE_WEBMCP_TOOL_NAME });
  }
  if (!record(worker) || typeof worker.hydrateFactoryWorkfile !== 'function') {
    throw new FactoryWorkfileWebMcpError('factory_workfile_worker_missing');
  }
  await modelContext.registerTool(Object.freeze({
    name: FACTORY_WORKFILE_WEBMCP_TOOL_NAME,
    description: 'Hydrate one exact factory workfile and return its terminal identity and asset counts.',
    inputSchema: INPUT_SCHEMA,
    annotations: Object.freeze({ readOnlyHint: false, destructiveHint: false }),
    async execute(value) {
      const command = payload(value);
      return terminalReceipt(await worker.hydrateFactoryWorkfile(command), command);
    },
  }));
  return Object.freeze({ active: true, toolName: FACTORY_WORKFILE_WEBMCP_TOOL_NAME });
}
