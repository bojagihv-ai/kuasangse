import {
  BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
  BatchWorkerContractError,
  record,
} from './batch-control-contract.mjs';
import { installFactoryWorkfileWebMcp } from './factory-workfile-webmcp.mjs';

export function installBatchControlWorkerWithFactory(windowObject, options, createWorker) {
  if (!record(windowObject)) throw new BatchWorkerContractError('window_missing');
  const worker = createWorker(options);
  const webMcpReady = installFactoryWorkfileWebMcp(windowObject.document, worker);
  const receipt = Object.freeze({
    schema: 'batch-control-worker:v1',
    capabilityVersion: BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
    worker,
    webMcpReady,
  });
  Object.defineProperty(windowObject, '__KUASANGSE_BATCH_CONTROL_WORKER__', {
    value: receipt,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return receipt;
}
