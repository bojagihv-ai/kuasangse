function requiredStage(options, field) {
  if (typeof options?.[field] !== 'function') {
    throw new TypeError(`bootstrap ${field} must be a function`);
  }
  return options[field];
}

function versionedEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('bootstrap hydration envelope must be an object');
  }
  if (!String(value.schema ?? '').trim()) {
    throw new TypeError('bootstrap hydration envelope schema is required');
  }
  if (!String(value.version ?? '').trim()) {
    throw new TypeError('bootstrap hydration envelope version is required');
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'state')) {
    throw new TypeError('bootstrap hydration envelope state is required');
  }
  return value;
}

function status(phase, ready, error) {
  return Object.freeze({ phase, ready, error });
}

export function createBootstrapCoordinator(options = {}) {
  const authority = requiredStage(options, 'authority');
  const modules = requiredStage(options, 'modules');
  const bundleCompat = requiredStage(options, 'bundleCompat');
  const installMenuModules = requiredStage(options, 'installMenuModules');
  const hydrate = requiredStage(options, 'hydrate');
  const render = requiredStage(options, 'render');
  let currentStatus = status('idle', false, null);
  let bootPromise = null;

  async function runBoot() {
    currentStatus = status('booting', false, null);
    try {
      await authority();
      await modules();
      await bundleCompat();
      await installMenuModules();
      await hydrate(versionedEnvelope(options.hydrationEnvelope));
      await render();
      currentStatus = status('ready', true, null);
      return currentStatus;
    } catch (error) {
      currentStatus = status('failed', false, error);
      throw error;
    }
  }

  function boot() {
    if (!bootPromise) bootPromise = runBoot();
    return bootPromise;
  }

  function getStatus() {
    return currentStatus;
  }

  return Object.freeze({ boot, getStatus });
}
