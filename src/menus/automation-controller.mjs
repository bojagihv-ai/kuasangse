export function createAutomationController(config) {
  const {
    assertMutable, updateAutomation, persistAutomation, refreshServer, applyServerSnapshot,
    pollServerStatus, applyServerStatus, connectDrive, setFolder, saveProfile, runMode,
    applyRunResult, setModeEnabled, refreshOutput, applyOutputResult, openOutputPreview,
    startAutomation, stopAutomation, runOnce, resetProcessed, requestRender,
    getSnapshot, getOperationToken, setIntervalFn, clearIntervalFn, reportError,
  } = config;

  let active = false;
  let generation = 0;
  let pollingTimer = null;
  let contract;

  const stamp = () => ({ generation, token: getOperationToken() });
  const current = operation => active
    && operation.generation === generation
    && operation.token === getOperationToken();

  async function guarded(service, apply, value) {
    const operation = stamp();
    const result = await service(value);
    if (!current(operation)) return { ignored: true, reason: 'stale-operation' };
    apply?.(result, value);
    return result;
  }

  function updateAndPersist(patch) {
    updateAutomation(patch);
    persistAutomation(patch);
    return patch;
  }

  const commands = {
    setApiBase: { capability: 'automation:write', execute(value) {
      assertMutable();
      const serverApiBase = String(value || '').trim();
      updateAndPersist({ serverApiBase });
      return serverApiBase;
    }},
    setIntervalMinutes: { capability: 'automation:write', execute(value) {
      assertMutable();
      const intervalMin = Math.max(5, Math.min(60, Number.parseInt(value, 10) || 10));
      updateAndPersist({ intervalMin });
      return intervalMin;
    }},
    refreshServer: { capability: 'automation:read', execute: base => guarded(refreshServer, applyServerSnapshot, base) },
    pollServer: { capability: 'automation:read', execute: base => guarded(pollServerStatus, applyServerStatus, base) },
    connectDrive: { capability: 'automation:write', execute(clientId) {
      assertMutable();
      return guarded(connectDrive, null, clientId);
    }},
    setFolder: { capability: 'automation:write', async execute(value) {
      assertMutable();
      const result = await guarded(setFolder, null, value);
      if (result?.ignored) return result;
      const kind = value?.kind === 'output' ? 'output' : 'input';
      updateAndPersist({
        [`${kind}FolderId`]: result.id || value.id || '',
        [`${kind}FolderName`]: result.name || result.id || value.id || '',
      });
      requestRender();
      return result;
    }},
    saveProfile: { capability: 'automation:write', execute(value) {
      assertMutable();
      return guarded(saveProfile, applyServerSnapshot, value);
    }},
    runMode: { capability: 'automation:write', execute(value) {
      assertMutable();
      return guarded(runMode, applyRunResult, value);
    }},
    setModeEnabled: { capability: 'automation:write', execute(value) {
      assertMutable();
      return guarded(setModeEnabled, applyServerSnapshot, value);
    }},
    refreshOutput: { capability: 'automation:read', execute: mode => guarded(refreshOutput, applyOutputResult, mode) },
    openOutputPreview: { capability: 'automation:read', execute: openOutputPreview },
    start: { capability: 'automation:write', execute() { assertMutable(); return startAutomation(); }},
    stop: { capability: 'automation:write', execute() { assertMutable(); return stopAutomation(); }},
    runOnce: { capability: 'automation:write', execute() { assertMutable(); return runOnce(); }},
    resetProcessed: { capability: 'automation:write', execute() {
      assertMutable();
      const result = resetProcessed();
      updateAndPersist({ processedFileIds: [], totalProcessed: 0, completed: [] });
      requestRender();
      return result;
    }},
  };

  function attachContract(value) {
    contract = value;
  }

  function invokeAsync(command, value) {
    try {
      return Promise.resolve(contract.invoke(command, value)).catch(reportError);
    } catch (error) {
      reportError(error);
      return Promise.resolve(null);
    }
  }

  function onEnter() {
    active = true;
    generation += 1;
    if (pollingTimer !== null) clearIntervalFn(pollingTimer);
    pollingTimer = setIntervalFn(() => {
      const base = getSnapshot()?.automation?.serverApiBase || '';
      if (base) invokeAsync('pollServer', base);
    }, 5000);
    const snapshot = getSnapshot()?.automation || {};
    if (!snapshot.serverFetchedOnce && !snapshot.serverLoading) {
      updateAutomation({ serverFetchedOnce: true });
      invokeAsync('refreshServer', snapshot.serverApiBase || '');
    }
  }

  function onLeave() {
    active = false;
    generation += 1;
    if (pollingTimer !== null) clearIntervalFn(pollingTimer);
    pollingTimer = null;
  }

  return { commands, attachContract, invokeAsync, onEnter, onLeave };
}
