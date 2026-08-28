// 관제탑 화면도 크롬이 얼린다. 창이 뒤에 있거나 가려지면 렌더러가 통째로 멈추는데,
// 그동안 화면은 마지막 그림 그대로 남아 있어 "지금 상태"처럼 보인다.
// 실측 2026-08-28: 얼어 있는 동안 투입 요청이 응답도 거절도 없이 매달렸고, 깨어난 뒤에도
// 새 요청이 즉시 실패했다. CDP 평가는 45초 타임아웃, 같은 시각 PowerShell 은 200 이었다.
//
// 워커 탭과 같은 처방이다(src/modules/worker-tab-liveness.mjs):
//  1) 잠금을 쥔다 — 크로미엄은 잠금을 쥔 문서를 얼리지 않는다.
//  2) 그래도 얼면 얼마나 얼어 있었는지 재서 화면이 말하게 한다.
//     붙어 있는 것과 살아 있는 것은 다르다.

export const TAB_LIVENESS_LOCK = 'kuasangse.control-tower.tab-liveness';

/** 이 시간을 넘겨 얼어 있었으면 화면이 낡았을 수 있다고 본다. */
export const STALE_AFTER_MS = 20000;

export function describeFreeze(state) {
  const last = state && state.lastFreeze;
  if (!last || !(last.durationMs >= STALE_AFTER_MS)) return '';
  const seconds = Math.round(last.durationMs / 1000);
  const measure = seconds >= 60 ? `${Math.round(seconds / 60)}분` : `${seconds}초`;
  return `이 화면이 ${measure} 동안 멈춰 있었습니다 · 방금 다시 읽었습니다`;
}

export function installTabLiveness(windowObject) {
  if (!windowObject || typeof windowObject !== 'object') {
    throw new TypeError('window object is required');
  }
  const now = () => Number(windowObject.Date?.now ? windowObject.Date.now() : Date.now());
  let frozenAt = 0;
  let freezeCount = 0;
  let lastFreeze = null;
  const listeners = new Set();

  const snapshot = () => Object.freeze({
    schema: 'control-tower-tab-liveness:v1',
    freezeCount,
    frozen: frozenAt > 0,
    ...(lastFreeze ? { lastFreeze } : {}),
  });

  const onFreeze = () => {
    if (frozenAt) return;
    frozenAt = now();
    freezeCount += 1;
  };
  const onResume = () => {
    if (!frozenAt) return;
    const resumedAt = now();
    lastFreeze = Object.freeze({ frozenAt, resumedAt, durationMs: Math.max(0, resumedAt - frozenAt) });
    frozenAt = 0;
    for (const listener of listeners) {
      try { listener(snapshot()); } catch (_error) { /* 한 명이 넘어져도 나머지는 알려야 한다 */ }
    }
  };

  const document = windowObject.document;
  if (document && typeof document.addEventListener === 'function') {
    document.addEventListener('freeze', onFreeze);
    document.addEventListener('resume', onResume);
  }

  let held = false;
  let release = null;
  const locks = windowObject.navigator && windowObject.navigator.locks;
  if (locks && typeof locks.request === 'function') {
    const pending = new Promise(resolve => { release = resolve; });
    try {
      const requested = locks.request(TAB_LIVENESS_LOCK, () => pending);
      if (requested && typeof requested.catch === 'function') requested.catch(() => {});
      held = true;
    } catch (_error) {
      held = false;
    }
  }

  return Object.freeze({
    lockName: TAB_LIVENESS_LOCK,
    held,
    holding: () => held,
    liveness: snapshot,
    /** 얼었다 깨어날 때마다 부른다. 화면을 다시 읽는 자리를 여기에 건다. */
    onResumed(listener) {
      if (typeof listener === 'function') listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      if (document && typeof document.removeEventListener === 'function') {
        document.removeEventListener('freeze', onFreeze);
        document.removeEventListener('resume', onResume);
      }
      listeners.clear();
      if (typeof release === 'function') { release(); release = null; }
      held = false;
    },
  });
}
