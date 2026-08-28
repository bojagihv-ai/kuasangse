// 조립공장 워커 탭이 뒤에 있으면 크롬이 렌더러째 얼린다(freeze). 시계는 이미
// unthrottled-interval.mjs 가 전용 워커로 옮겼지만, 얼어붙는 것은 시계가 아니라
// 메인 스레드다 — 시계는 계속 울리는데 받아 줄 스레드가 없어 큐가 조용히 멎는다.
// 실측 2026-08-26·08-28: 관제탑은 connected:true 인 채로 보고만 끊겼고,
// CDP Runtime.evaluate 가 45초 타임아웃, 크롬 CPU 는 늘지 않았다.
//
// 여기서 두 가지를 한다.
//  1) 잠금(Web Lock)을 계속 쥔다. 크로미엄의 동결 정책은 잠금을 쥔 문서를 얼리지 않는다.
//  2) 그래도 얼면 freeze/resume 을 적어 둔다. 막는 것과 아는 것은 다르다 —
//     못 막았을 때 조용히 멎지 말고 얼마나 얼어 있었는지 말할 수 있어야 한다.

export const WORKER_TAB_LIVENESS_LOCK = 'kuasangse.batch-worker.tab-liveness';

function readNow(windowObject) {
  const now = windowObject?.Date?.now;
  return typeof now === 'function' ? Number(now()) : Number(Date.now());
}

/**
 * 얼었다 깨어난 기록. 관제탑 하트비트에 실어 보내면 "붙어 있는데 죽어 있던" 구간이 보인다.
 */
export function createFreezeLog(windowObject) {
  let frozenAt = 0;
  let lastFreeze = null;
  let freezeCount = 0;
  return Object.freeze({
    markFrozen() {
      if (frozenAt) return;
      frozenAt = readNow(windowObject);
      freezeCount += 1;
    },
    markResumed() {
      if (!frozenAt) return;
      const resumedAt = readNow(windowObject);
      lastFreeze = Object.freeze({
        frozenAt,
        resumedAt,
        // 얼어 있던 시간. 관제탑이 "N초 조용했다" 로 읽는 값이다.
        durationMs: Math.max(0, resumedAt - frozenAt),
      });
      frozenAt = 0;
    },
    snapshot() {
      return Object.freeze({
        schema: 'batch-worker-tab-liveness:v1',
        freezeCount,
        frozen: frozenAt > 0,
        ...(frozenAt ? { frozenAt } : {}),
        ...(lastFreeze ? { lastFreeze } : {}),
      });
    },
  });
}

/**
 * 탭이 얼지 않게 잠금을 쥐고, 얼면 기록한다.
 *
 * 잠금을 못 쓰는 환경(구형 브라우저·비보안 오리진)에서도 워커는 그대로 돌아야 하므로
 * 실패는 조용히 넘기고 held:false 로 알린다 — 이 기능은 보험이지 전제가 아니다.
 */
export function installWorkerTabLiveness(windowObject) {
  if (!windowObject || typeof windowObject !== 'object') {
    throw new TypeError('window object is required');
  }
  const log = createFreezeLog(windowObject);
  const document = windowObject.document;
  const onFreeze = () => log.markFrozen();
  const onResume = () => log.markResumed();
  if (document && typeof document.addEventListener === 'function') {
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
  }

  let release = null;
  let held = false;
  const locks = windowObject.navigator && windowObject.navigator.locks;
  if (locks && typeof locks.request === 'function') {
    // 잠금을 쥔 채로 영원히 기다린다. 풀어 주는 것은 stop() 뿐이다.
    const pending = new Promise(resolve => { release = resolve; });
    try {
      const requested = locks.request(WORKER_TAB_LIVENESS_LOCK, () => pending);
      if (requested && typeof requested.catch === 'function') requested.catch(() => {});
      held = true;
    } catch (_error) {
      held = false;
    }
  }

  return Object.freeze({
    schema: 'batch-worker-tab-liveness:v1',
    lockName: WORKER_TAB_LIVENESS_LOCK,
    // 설치 시점에 잠금을 쥐었는지. 이후 stop() 으로 놓았는지는 holding() 이 말한다.
    held,
    holding: () => held,
    liveness: log.snapshot,
    stop() {
      if (document && typeof document.removeEventListener === 'function') {
        document.removeEventListener('freeze', onFreeze);
        document.removeEventListener('resume', onResume);
      }
      if (typeof release === 'function') {
        release();
        release = null;
      }
      held = false;
    },
  });
}
