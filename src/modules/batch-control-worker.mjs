import {
  BATCH_CONTROL_CAFE24_COMMAND_VERSION,
  BATCH_CONTROL_COMMAND_KINDS,
  BATCH_CONTROL_FACTORY_COMMAND_VERSION,
  BATCH_CONTROL_WORKFILE_COMMAND_VERSION,
  BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
  BATCH_CONTROL_WORK_ORDER_VERSION,
  BatchWorkerContractError,
  BatchWorkerHttpError,
  jsonHeaders,
  projectionIdentity,
  record,
  text,
  validateOrder,
  WORKER_ENDPOINTS,
} from './batch-control-contract.mjs';
import { createRecurringTask } from './batch-control-polling.mjs';

export { BATCH_CONTROL_CAFE24_COMMAND_VERSION, BATCH_CONTROL_COMMAND_KINDS, BATCH_CONTROL_FACTORY_COMMAND_VERSION, BATCH_CONTROL_WORKFILE_COMMAND_VERSION, BATCH_CONTROL_WORKER_CAPABILITY_VERSION, BATCH_CONTROL_WORK_ORDER_VERSION, BatchWorkerContractError, BatchWorkerHttpError };

export function createBatchControlWorker({
  apiBase = 'http://127.0.0.1:5062',
  workerId,
  runtimeBuildId = 'runtime-build-unknown',
  workerSessionId = '',
  commandBridge,
  projectionBridge = null,
  fetchImpl,
  setIntervalImpl,
  clearIntervalImpl,
  nowImpl = Date.now,
} = {}) {
  if (!text(workerId)) throw new BatchWorkerContractError('worker_id_missing');
  if (!text(runtimeBuildId)) throw new BatchWorkerContractError('runtime_build_id_missing');
  if (!record(commandBridge) || typeof commandBridge.run !== 'function') throw new BatchWorkerContractError('command_bridge_missing');
  if (typeof fetchImpl !== 'function') throw new BatchWorkerContractError('fetch_missing');
  if (typeof nowImpl !== 'function') throw new BatchWorkerContractError('clock_missing');
  const base = text(apiBase).replace(/\/+$/, '');
  const liveSessionId = text(workerSessionId)
    || `${workerId}:${Math.trunc(nowImpl())}:${Math.random().toString(36).slice(2, 12)}`;
  const liveSessionStartedAt = Math.max(1, Math.trunc(nowImpl()));
  let activeOrder = null;
  let eventSequence = 0;
  let heartbeatTimer = null;
  let helloRequest = null;
  let liveSessionCursor = 0;
  let liveSessionReady = false;
  let lastProjection = null;
  let sessionHeaders = null;

  async function ensureSession() {
    if (sessionHeaders) return sessionHeaders;
    const response = await fetchImpl(`${base}/api/session`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new BatchWorkerHttpError(response.status, '/api/session');
    const session = await response.json();
    if (!record(session) || !text(session.sessionId) || !text(session.csrfToken)) {
      throw new BatchWorkerContractError('session_invalid');
    }
    sessionHeaders = Object.freeze({
      'X-Control-Tower-CSRF': session.csrfToken,
      'X-Control-Tower-Session': session.sessionId,
    });
    return sessionHeaders;
  }

  async function post(endpoint, payload) {
    const headers = { ...jsonHeaders(), ...(await ensureSession()) };
    const response = await fetchImpl(`${base}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new BatchWorkerHttpError(response.status, endpoint);
    return response.status === 204 ? null : response.json();
  }

  async function heartbeat() {
    if (!activeOrder) return null;
    return post(WORKER_ENDPOINTS.heartbeat(activeOrder.orderId), {
      contractVersion: BATCH_CONTROL_WORK_ORDER_VERSION,
      capabilityVersion: BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
      orderId: activeOrder.orderId,
      productId: activeOrder.productId,
      currentRunId: activeOrder.currentRunId,
      operationToken: activeOrder.operationToken,
      eventSequence,
    });
  }

  function sessionEnvelope(projection = lastProjection) {
    return {
      schema: 'factory-worker-session:v1',
      sessionId: liveSessionId,
      workerId,
      buildId: text(runtimeBuildId),
      capabilityVersion: BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
      factoryCapabilityVersion: BATCH_CONTROL_FACTORY_COMMAND_VERSION,
      startedAt: liveSessionStartedAt,
      cursor: ++liveSessionCursor,
      identity: projectionIdentity(projection),
    };
  }

  async function hello() {
    if (helloRequest) return helloRequest;
    if (!record(projectionBridge) || typeof projectionBridge.getProjection !== 'function') {
      throw new BatchWorkerContractError('projection_bridge_missing');
    }
    helloRequest = (async () => {
      const projection = await projectionBridge.getProjection();
      if (!record(projection) || projection.schema !== 'factory-control-projection:v1') {
        throw new BatchWorkerContractError('factory_projection_invalid');
      }
      lastProjection = projection;
      const result = await post(WORKER_ENDPOINTS.factoryHello, {
        ...sessionEnvelope(projection),
        projection,
      });
      liveSessionReady = true;
      return result;
    })().finally(() => {
      helloRequest = null;
    });
    return helloRequest;
  }

  async function sessionHeartbeat() {
    if (!liveSessionReady) return hello();
    try {
      return await post(WORKER_ENDPOINTS.factoryHeartbeat, sessionEnvelope());
    } catch (error) {
      liveSessionReady = false;
      throw error;
    }
  }

  async function syncProjection() {
    if (!record(projectionBridge) || typeof projectionBridge.getProjection !== 'function') {
      throw new BatchWorkerContractError('projection_bridge_missing');
    }
    const projection = await projectionBridge.getProjection();
    if (!record(projection) || projection.schema !== 'factory-control-projection:v1') {
      throw new BatchWorkerContractError('factory_projection_invalid');
    }
    if (!liveSessionReady) {
      lastProjection = projection;
      return hello();
    }
    lastProjection = projection;
    return post(WORKER_ENDPOINTS.factorySync, {
      ...sessionEnvelope(projection),
      projection,
    });
  }

  async function start() {
    const claimed = await post(WORKER_ENDPOINTS.claim, {
      workerId,
      sessionId: liveSessionId,
      contractVersion: BATCH_CONTROL_WORK_ORDER_VERSION,
      capabilityVersion: BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
    });
    if (!claimed || !claimed.order) return Object.freeze({ status: 'idle', workerId });
    activeOrder = validateOrder(claimed.order);
    eventSequence = 0;
    await post(WORKER_ENDPOINTS.ack(activeOrder.orderId), { ...activeOrder, workerId, accepted: true, eventSequence: ++eventSequence });
    try {
      if (
        activeOrder.command.kind === 'factory-workfile'
        && (!record(projectionBridge) || typeof projectionBridge.run !== 'function')
      ) {
        throw new BatchWorkerContractError('factory_workfile_bridge_missing');
      }
      const result = activeOrder.command.kind === 'factory-workfile'
        ? await projectionBridge.run(
          activeOrder.command.kind,
          activeOrder.command.name,
          activeOrder.command.payload ?? {},
          activeOrder,
        )
        : activeOrder.command.kind === 'factory-cafe24'
        && activeOrder.command.name === 'inspectDetailToCafe24'
        ? await commandBridge.inspect()
        : activeOrder.command.kind === 'factory-cafe24'
          && activeOrder.command.name === 'verifyDetailToCafe24'
          ? await commandBridge.verify(activeOrder.command.kind, activeOrder.command.name, activeOrder.command.payload ?? {}, activeOrder)
        : await commandBridge.run(activeOrder.command.kind, activeOrder.command.name, activeOrder.command.payload ?? {}, activeOrder);
      await post(WORKER_ENDPOINTS.events(activeOrder.orderId), { ...activeOrder, workerId, status: 'completed', eventSequence: ++eventSequence, result });
      await post(WORKER_ENDPOINTS.complete(activeOrder.orderId), { ...activeOrder, workerId, eventSequence, result });
      return Object.freeze({ status: 'completed', orderId: activeOrder.orderId });
    } catch (error) {
      await post(WORKER_ENDPOINTS.fail(activeOrder.orderId), { ...activeOrder, workerId, eventSequence: ++eventSequence, error: String(error?.code || error?.message || error) });
      throw error;
    } finally {
      activeOrder = null;
    }
  }

  function startHeartbeat(intervalMs = 15000) {
    if (heartbeatTimer !== null) return () => {};
    if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') {
      throw new BatchWorkerContractError('timer_missing');
    }
    heartbeatTimer = setIntervalImpl(() => { void heartbeat(); }, intervalMs);
    return () => {
      if (heartbeatTimer === null) return;
      clearIntervalImpl(heartbeatTimer);
      heartbeatTimer = null;
    };
  }

  const timerError = () => new BatchWorkerContractError('timer_missing');
  const sessionHeartbeatTask = createRecurringTask({
    run: sessionHeartbeat, setIntervalImpl, clearIntervalImpl, immediate: true, timerError,
  });
  const pollingTask = createRecurringTask({
    run: start, setIntervalImpl, clearIntervalImpl, immediate: true, singleFlight: true, timerError,
  });
  const projectionPollingTask = createRecurringTask({
    run: syncProjection, setIntervalImpl, clearIntervalImpl, immediate: true, singleFlight: true,
    timerError,
  });

  function startSessionHeartbeat(intervalMs = 15000) {
    return sessionHeartbeatTask.start(intervalMs);
  }

  function startPolling(intervalMs = 1000) {
    return pollingTask.start(intervalMs);
  }

  function startProjectionPolling(intervalMs = 1000) {
    if (!record(projectionBridge) || typeof projectionBridge.getProjection !== 'function') {
      throw new BatchWorkerContractError('projection_bridge_missing');
    }
    return projectionPollingTask.start(intervalMs);
  }

  return Object.freeze({
    capabilityVersion: BATCH_CONTROL_WORKER_CAPABILITY_VERSION,
    sessionId: liveSessionId,
    runtimeBuildId: text(runtimeBuildId),
    start,
    heartbeat,
    hello,
    sessionHeartbeat,
    startHeartbeat,
    startSessionHeartbeat,
    startPolling,
    syncProjection,
    startProjectionPolling,
    endpoints: WORKER_ENDPOINTS,
  });
}

export function installBatchControlWorker(windowObject, options = {}) {
  if (!record(windowObject)) throw new BatchWorkerContractError('window_missing');
  const worker = createBatchControlWorker(options);
  const receipt = Object.freeze({ schema: 'batch-control-worker:v1', capabilityVersion: BATCH_CONTROL_WORKER_CAPABILITY_VERSION, worker });
  Object.defineProperty(windowObject, '__KUASANGSE_BATCH_CONTROL_WORKER__', {
    value: receipt,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return receipt;
}
