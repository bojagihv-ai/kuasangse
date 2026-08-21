const DEFAULT_RETRY_DELAYS = Object.freeze([2_000, 5_000, 15_000, 60_000]);

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name}_missing`);
  return value;
}

export function createWorkBundleActivityHeartbeat({
  getBundleKey,
  isReady = () => true,
  sendActivity,
  clientId,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = 5000,
  onError = () => {},
} = {}) {
  requiredFunction(getBundleKey, 'get_bundle_key');
  requiredFunction(isReady, 'is_ready');
  requiredFunction(sendActivity, 'send_activity');
  requiredFunction(setIntervalFn, 'set_interval');
  requiredFunction(clearIntervalFn, 'clear_interval');
  requiredFunction(onError, 'on_error');
  const normalizedClientId = String(clientId || '').trim();
  if (!normalizedClientId) throw new TypeError('client_id_missing');

  let timer = null;
  let running = false;
  let disposed = false;

  async function pulse() {
    if (disposed || running) return null;
    if (!isReady()) return null;
    const bundleKey = String(getBundleKey() || '').trim();
    if (!bundleKey) return null;
    running = true;
    try {
      return await sendActivity(Object.freeze({
        bundleKey,
        clientId: normalizedClientId,
      }));
    } catch (error) {
      onError(error);
      return null;
    } finally {
      running = false;
    }
  }

  function start() {
    if (disposed) return Promise.resolve(null);
    if (timer === null) {
      timer = setIntervalFn(() => pulse(), intervalMs);
    }
    return pulse();
  }

  function dispose() {
    disposed = true;
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  }

  return Object.freeze({ start, pulse, dispose });
}

export function createWorkBundleLiveSync({
  buildBundle,
  synchronize,
  hasPending = () => false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  debounceMs = 900,
  retryDelays = DEFAULT_RETRY_DELAYS,
  onState = () => {},
} = {}) {
  requiredFunction(buildBundle, 'build_bundle');
  requiredFunction(synchronize, 'synchronize');
  requiredFunction(hasPending, 'has_pending');
  requiredFunction(setTimer, 'set_timer');
  requiredFunction(clearTimer, 'clear_timer');
  requiredFunction(onState, 'on_state');

  let timer = null;
  let running = null;
  let queued = false;
  let disposed = false;
  let retryIndex = 0;
  let latestOptions = Object.freeze({
    reason: '로컬 자산 변경',
    sourceScheme: 'local-archive',
    fullReconcile: false,
  });

  function cancelTimer() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function schedule(delay) {
    cancelTimer();
    timer = setTimer(() => {
      timer = null;
      return flush();
    }, delay);
  }

  function scheduleRetry() {
    const delay = retryDelays[Math.min(retryIndex, retryDelays.length - 1)] ?? 60_000;
    retryIndex += 1;
    queued = true;
    onState(Object.freeze({ status: 'retry-waiting', delay }));
    schedule(delay);
  }

  async function flush() {
    if (disposed) return null;
    if (running) {
      queued = true;
      return running;
    }
    if (!queued && !hasPending()) return null;
    queued = false;
    const options = latestOptions;
    onState(Object.freeze({ status: 'syncing', reason: options.reason }));
    running = (async () => {
      const bundle = await buildBundle();
      if (!bundle) return null;
      const result = await synchronize(bundle, options);
      if (!result) {
        scheduleRetry();
        return null;
      }
      retryIndex = 0;
      onState(Object.freeze({ status: 'synced', reason: options.reason }));
      return result;
    })();
    try {
      return await running;
    } catch (error) {
      onState(Object.freeze({
        status: 'failed',
        reason: options.reason,
        message: String(error?.message || error || '동기화 실패'),
      }));
      scheduleRetry();
      return null;
    } finally {
      running = null;
      if (queued && timer === null) schedule(debounceMs);
    }
  }

  function request(reason = '로컬 자산 변경', options = {}) {
    if (disposed) return Promise.resolve(null);
    latestOptions = Object.freeze({
      ...latestOptions,
      ...options,
      reason: String(reason || '로컬 자산 변경'),
      sourceScheme: String(options.sourceScheme || 'local-archive'),
      fullReconcile: options.fullReconcile === true,
    });
    queued = true;
    if (options.immediate === true) {
      cancelTimer();
      return flush();
    }
    const requestedDebounceMs = Number(options.debounceMs);
    schedule(Number.isFinite(requestedDebounceMs) && requestedDebounceMs > 0
      ? Math.max(debounceMs, requestedDebounceMs)
      : debounceMs);
    return Promise.resolve(null);
  }

  function replayPending(reason = '대기 작업 재전송') {
    if (!hasPending()) return Promise.resolve(null);
    return request(reason, { immediate: true, fullReconcile: true });
  }

  function dispose() {
    disposed = true;
    queued = false;
    cancelTimer();
  }

  return Object.freeze({
    request,
    replayPending,
    flush,
    dispose,
  });
}
