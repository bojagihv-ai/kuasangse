export function createRecurringTask({
  run,
  setIntervalImpl,
  clearIntervalImpl,
  immediate = false,
  singleFlight = false,
  timerError,
}) {
  let timer = null;
  let request = null;

  function runOnce() {
    if (singleFlight && request) return request;
    const current = Promise.resolve().then(run);
    if (!singleFlight) return current;
    request = current.finally(() => {
      request = null;
    });
    return request;
  }

  function start(intervalMs) {
    if (timer !== null) return () => {};
    if (typeof setIntervalImpl !== 'function' || typeof clearIntervalImpl !== 'function') {
      throw timerError();
    }
    const scheduled = () => runOnce().catch(() => null);
    if (immediate) void scheduled();
    timer = setIntervalImpl(scheduled, intervalMs);
    return () => {
      if (timer === null) return;
      clearIntervalImpl(timer);
      timer = null;
    };
  }

  return Object.freeze({ runOnce, start });
}
