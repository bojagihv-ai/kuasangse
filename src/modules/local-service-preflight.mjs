const serviceDefinitions = Object.freeze([
  Object.freeze({ id: 'sinhwa', label: '신화사DB', statusPath: '/api/sinhwa-db/status', startPath: '/api/sinhwa-db/start' }),
  Object.freeze({ id: 'cafe24', label: 'Cafe24 Control Tower', statusPath: '/api/cafe24-control/status', startPath: '/api/cafe24-control/start' }),
  Object.freeze({ id: 'jepum', label: 'VM 후보 수집기', statusPath: '/api/jepum-scraper/status', startPath: '/api/jepum-scraper/start' }),
]);

function backendBaseUrl(runtime) {
  const configured = typeof runtime.factoryBackendBaseUrl === 'function'
    ? runtime.factoryBackendBaseUrl()
    : runtime.state?.backendBaseUrl;
  return String(configured || 'http://127.0.0.1:5050').replace(/\/+$/, '');
}

function responseMessage(value, fallback) {
  return String(value?.message || value?.error || fallback || '').trim();
}

async function requestLocalService(runtime, base, path, method, timeoutMs) {
  return runtime.fetchJsonWithTimeout(`${base}${path}`, {
    method,
    headers: method === 'POST'
      ? { 'Accept': 'application/json', 'Content-Type': 'application/json' }
      : { 'Accept': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : { cache: 'no-store' }),
  }, timeoutMs);
}

function logFactory(runtime, factory, message, type = 'info') {
  if (typeof runtime.factoryLog === 'function') runtime.factoryLog(message, type, factory);
}

function renderFactory(runtime, factory) {
  if (typeof runtime.renderFactoryDraft === 'function') {
    runtime.renderFactoryDraft(factory);
    return;
  }
  if (typeof runtime.render === 'function') runtime.render();
}

function selectedServices(options = {}) {
  const requested = Array.isArray(options.serviceIds)
    ? new Set(options.serviceIds.map(value => String(value || '').trim()).filter(Boolean))
    : null;
  return requested ? serviceDefinitions.filter(service => requested.has(service.id)) : [...serviceDefinitions];
}

function setPreflightState(runtime, factory, state, message, options = {}) {
  if (factory && typeof factory === 'object') {
    factory.automation = factory.automation && typeof factory.automation === 'object' ? factory.automation : {};
    factory.automation.localServicePreflight = {
      state,
      running: state === 'checking' || state === 'starting',
      message: String(message || ''),
      sourceMode: options.sourceMode === 'cafe24-only' ? 'cafe24-only' : 'all',
      updatedAt: Date.now(),
    };
  }
  renderFactory(runtime, factory);
}

export async function ensureRequiredLocalServices(factory, runtime, options = {}) {
  if (!runtime || typeof runtime !== 'object') {
    throw new TypeError('local-service preflight runtime is required');
  }
  const sourceMode = options.sourceMode === 'cafe24-only' ? 'cafe24-only' : 'all';
  const services = selectedServices(options);
  const base = backendBaseUrl(runtime);
  setPreflightState(
    runtime,
    factory,
    'checking',
    sourceMode === 'cafe24-only'
      ? '카페24 전용 경로를 준비하고 있습니다. Cafe24와 VM 후보 수집기 상태를 확인합니다.'
      : '전체 수집 경로를 준비하고 있습니다. 신화사DB, Cafe24, VM 후보 수집기 상태를 확인합니다.',
    { sourceMode },
  );
  const checked = await Promise.all(services.map(async service => {
    try {
      const status = await requestLocalService(runtime, base, service.statusPath, 'GET', 4500);
      return { service, status, error: null };
    } catch (error) {
      return { service, status: null, error };
    }
  }));

  const conflicts = checked.filter(item => item.status?.portConflict === true);
  if (conflicts.length) {
    const detail = conflicts
      .map(item => `${item.service.label}: 포트 ${item.status?.port || '?'}에 다른 프로그램이 실행 중입니다.`)
      .join('\n');
    logFactory(runtime, factory, `로컬 프로그램 포트 충돌: ${detail}`, 'error');
    setPreflightState(runtime, factory, 'failed', `필수 프로그램 포트 충돌: ${detail}`, { sourceMode });
    runtime.window?.alert?.(`필수 프로그램을 시작할 수 없습니다.\n\n${detail}\n\n해당 포트를 사용 중인 다른 프로그램을 종료하거나 포트를 변경한 뒤 다시 실행해주세요.`);
    return false;
  }

  const unavailable = checked.filter(item => item.status?.running !== true);
  if (!unavailable.length) {
    setPreflightState(runtime, factory, 'ready', sourceMode === 'cafe24-only'
      ? 'Cafe24와 VM 후보 수집기가 준비됐습니다. 카페24 전용 수집을 시작합니다.'
      : '필수 프로그램이 모두 준비됐습니다. 전체 수집을 시작합니다.', { sourceMode });
    return true;
  }

  const labels = unavailable.map(item => item.service.label).join(', ');
  const confirmed = runtime.window?.confirm?.(`${labels}의 응답이 없습니다.\n꺼져 있습니다. 실행하시겠습니까?`) === true;
  if (!confirmed) {
    logFactory(runtime, factory, `로컬 프로그램 실행 취소: ${labels}`, 'warn');
    setPreflightState(runtime, factory, 'cancelled', `로컬 프로그램 실행을 취소했습니다: ${labels}`, { sourceMode });
    return false;
  }

  logFactory(runtime, factory, `로컬 프로그램 실행 요청: ${labels}`, 'info');
  setPreflightState(runtime, factory, 'starting', `${labels} 실행 확인 중입니다.`, { sourceMode });
  const started = await Promise.all(unavailable.map(async item => {
    try {
      const status = await requestLocalService(runtime, base, item.service.startPath, 'POST', 50000);
      return { ...item, startStatus: status, startError: null };
    } catch (error) {
      return { ...item, startStatus: null, startError: error };
    }
  }));
  const failed = started.filter(item => item.startStatus?.running !== true);
  if (failed.length) {
    const detail = failed
      .map(item => `${item.service.label}: ${responseMessage(item.startStatus || item.startError, '실행 확인 실패')}`)
      .join('\n');
    const sinhwaOnlyFailure = sourceMode !== 'cafe24-only'
      && failed.every(item => item.service.id === 'sinhwa');
    if (sinhwaOnlyFailure) {
      const continueCafe24Only = runtime.window?.confirm?.(
        `신화사DB 연결 확인이 실패했습니다.\n\n${detail}\n\n카페24만 수집하고 VM 후보 수집, 대표이미지와 이미지컷 생성을 계속하시겠습니까?`,
      ) === true;
      if (continueCafe24Only) {
        logFactory(runtime, factory, '신화사DB를 제외하고 카페24 전용 수집, VM 후보 수집, 대표이미지와 이미지컷 생성을 계속합니다.', 'warn');
        setPreflightState(runtime, factory, 'ready', '신화사DB를 제외했습니다. 카페24 전용 수집과 나머지 작업을 계속합니다.', { sourceMode: 'cafe24-only' });
        return { ready: true, sourceMode: 'cafe24-only' };
      }
    }
    logFactory(runtime, factory, `로컬 프로그램 실행 실패: ${detail}`, 'error');
    setPreflightState(runtime, factory, 'failed', `로컬 프로그램 실행 실패: ${detail}`, { sourceMode });
    runtime.window?.alert?.(`필수 프로그램 실행을 확인하지 못했습니다.\n\n${detail}`);
    return false;
  }

  logFactory(runtime, factory, `로컬 프로그램 실행 확인 완료: ${labels}`, 'ok');
  setPreflightState(runtime, factory, 'ready', `${labels} 실행 확인 완료. 수집과 생성을 시작합니다.`, { sourceMode });
  return true;
}
