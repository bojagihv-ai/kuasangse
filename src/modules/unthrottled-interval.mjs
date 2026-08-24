// 크롬은 숨은 탭의 setInterval 을 1분에 한 번까지 늦춘다. 배치 워커가 뒤에 있으면
// 그 사이 관제탑이 세션을 끊어버리고, 사람이 탭을 다시 볼 때까지 큐가 멈춘다.
// 전용 워커의 시계는 이 감속을 받지 않으므로 시계만 워커로 옮긴다.
const CLOCK_SOURCE = `
const timers = new Map();
self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'start') {
    timers.set(message.id, setInterval(() => self.postMessage({ id: message.id }), message.delay));
    return;
  }
  if (message.type === 'stop') {
    clearInterval(timers.get(message.id));
    timers.delete(message.id);
  }
};
`;

function windowTimers(windowObject) {
  return Object.freeze({
    setIntervalImpl: windowObject.setInterval.bind(windowObject),
    clearIntervalImpl: windowObject.clearInterval.bind(windowObject),
    backing: 'window',
  });
}

export function createUnthrottledTimers(windowObject) {
  if (!windowObject || typeof windowObject.setInterval !== 'function') {
    throw new TypeError('window object with timers is required');
  }
  if (typeof windowObject.Worker !== 'function'
    || typeof windowObject.Blob !== 'function'
    || !windowObject.URL
    || typeof windowObject.URL.createObjectURL !== 'function') {
    return windowTimers(windowObject);
  }
  let clock = null;
  try {
    const blob = new windowObject.Blob([CLOCK_SOURCE], { type: 'text/javascript' });
    const url = windowObject.URL.createObjectURL(blob);
    clock = new windowObject.Worker(url);
    windowObject.URL.revokeObjectURL(url);
  } catch (error) {
    // 워커를 못 만들면 늦더라도 도는 편이 낫다.
    return windowTimers(windowObject);
  }
  const callbacks = new Map();
  let nextId = 0;
  clock.onmessage = (event) => {
    const handler = callbacks.get(event.data && event.data.id);
    if (typeof handler === 'function') handler();
  };
  return Object.freeze({
    setIntervalImpl(handler, delay) {
      if (typeof handler !== 'function') throw new TypeError('handler is required');
      nextId += 1;
      const id = nextId;
      callbacks.set(id, handler);
      clock.postMessage({ type: 'start', id, delay: Number(delay) || 0 });
      return id;
    },
    clearIntervalImpl(id) {
      if (!callbacks.has(id)) return;
      callbacks.delete(id);
      clock.postMessage({ type: 'stop', id });
    },
    backing: 'worker',
  });
}
