import {
  BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
  BatchWorkerContractError,
  record,
} from './batch-control-contract.mjs';
import { installFactoryWorkfileWebMcp } from './factory-workfile-webmcp.mjs';
import { installWorkerTabLiveness } from './worker-tab-liveness.mjs';

export function installBatchControlWorkerWithFactory(windowObject, options, createWorker) {
  if (!record(windowObject)) throw new BatchWorkerContractError('window_missing');
  const worker = createWorker(options);
  const webMcpReady = installFactoryWorkfileWebMcp(windowObject.document, worker);
  // 뒤에 있는 탭이 얼면 큐가 조용히 멎는다. 얼지 않게 붙들고, 얼면 기록한다.
  const tabLiveness = installWorkerTabLiveness(windowObject);
  const receipt = Object.freeze({
    schema: 'batch-control-worker:v1',
    capabilityVersion: BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
    worker,
    webMcpReady,
    tabLiveness,
  });
  Object.defineProperty(windowObject, '__KUASANGSE_BATCH_CONTROL_WORKER__', {
    value: receipt,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return receipt;
}
