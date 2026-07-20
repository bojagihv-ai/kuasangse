import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';
import { createImageCutsController } from './imagecuts-controller.mjs';
import { renderImageCutsView } from './imagecuts-view.mjs';

const ACTION_NAMES = Object.freeze([
  'loadSource', 'goFactoryStart', 'clearSource', 'loadWorkImage', 'clearWorkImage',
  'runWorkDrive', 'chooseArchive', 'archiveAll', 'downloadAll', 'saveSession',
  'recoverPrompts', 'resetGeneration', 'setCutSlotCount', 'setSizeSlotCount',
  'generateCut', 'generateSizeCut', 'generateAllCuts', 'generateAllSizeCuts',
  'clearCutResults', 'clearSizeResults', 'applyPlacement',
]);

const RENDER_HELPER_NAMES = Object.freeze([
  'factoryClearDisconnectedImageGenerationRuntime',
  'cutsClearOverdueGenerationRuntime',
  'factoryHasCurrentPageImageGenerationRun',
  'factoryClearRestoredImageGenerationRuntime',
  'cutsHasActiveImageGeneration',
  'syncCutPromptsFromDom',
  'cutsShouldRunRenderMaintenance',
  'restoreCutImagePayloadsFromPreview',
  'normalizeCutPromptSlotCount',
  'normalizeCutPrompts',
  'restoreSizeCutResultsFromCache',
  'factoryRestoreCutPromptResultsFromAssets',
  'clearLocalFallbackResultsFromPrompts',
  'applyLatestCutPromptSlotBackups',
  'restoreGeneralCutsAfterSizeMix',
  'clearFinishedCutGenerationFlagsFromLogs',
  'factoryRejectLocalFallbackAssetsForStage',
  'cutsDataUrlFromPayload',
  'cutsCurrentLockedProductSourceState',
  'cutImageFingerprint',
  'factoryCutPromptPreviewSrc',
  'getCurrentImageRunInfo',
  'hasImageConnection',
  'renderCutsRunLogPanel',
  'renderFactoryLightImage',
  'cutGeneratingHelperText',
  'cutsVisibleLogText',
  'renderFactoryCutPromptPreviewImage',
  'renderSizeCutsPanel',
  'renderDetailSectionPlacementPanel',
  'disabledAttr',
  'escapeHtml',
  'escapeAttr',
  'sessionAssetsHydrated',
  'hasPromptFields',
  'hasDriveService',
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createImageCutsMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const updateCuts = requiredFunction(capabilities, 'updateCuts');
  const updatePrompt = requiredFunction(capabilities, 'updatePrompt');
  const updatePlacement = requiredFunction(capabilities, 'updatePlacement');
  const persistCuts = requiredFunction(capabilities, 'persistCuts');
  const requestRender = requiredFunction(capabilities, 'requestRender');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const promptUser = requiredFunction(capabilities, 'promptUser');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  for (const name of [...ACTION_NAMES, 'resolveWorkFolder']) requiredFunction(actions, name);
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);
  const defaultPromptCount = Number(renderHelpers.defaultPromptCount || 4);
  const maxPromptCount = Number(renderHelpers.maxPromptCount || 30);

  let active = false;
  let generation = 0;
  let contract;

  const stamp = () => ({ generation, token: getOperationToken() });
  const isCurrent = operation => active
    && operation.generation === generation
    && operation.token === getOperationToken();

  async function guarded(service, apply, value) {
    const operation = stamp();
    const result = await service(value);
    if (!isCurrent(operation)) return { ignored: true, reason: 'stale-operation' };
    apply(result, value);
    return result;
  }

  function persist(reason, value) {
    persistCuts({ reason, value });
  }

  const commands = {
    setStyleReference: {
      capability: 'image-cuts:write',
      execute(value) {
        assertMutable();
        const styleReferenceEnabled = value !== false;
        updateCuts({ styleReferenceEnabled });
        persist('style-reference', styleReferenceEnabled);
        requestRender();
        return styleReferenceEnabled;
      },
    },
    saveWorkFolder: {
      capability: 'image-cuts:write',
      execute(value) {
        assertMutable();
        const folderId = String(value || '').trim();
        if (!folderId) return Promise.resolve(null);
        return guarded(actions.resolveWorkFolder, result => {
          updateCuts({
            workDriveFolderId: result.id || folderId,
            workDriveFolderName: result.name || result.id || folderId,
          });
          persist('work-drive-folder', result);
          requestRender();
        }, folderId);
      },
    },
    setPrompt: {
      capability: 'image-cuts:write',
      execute(value = {}) {
        assertMutable();
        const kind = value.kind === 'size' ? 'size' : 'cut';
        const index = Number.parseInt(value.index, 10);
        if (!Number.isFinite(index) || index < 0) return false;
        updatePrompt({ kind, index, patch: { prompt: String(value.value || ''), promptUpdatedAt: Date.now() } });
        persist('prompt', { kind, index });
        return true;
      },
    },
    renamePrompt: {
      capability: 'image-cuts:write',
      execute(value = {}) {
        assertMutable();
        const kind = value.kind === 'size' ? 'size' : 'cut';
        const index = Number.parseInt(value.index, 10);
        const label = String(value.label || '').trim();
        if (!Number.isFinite(index) || index < 0 || !label) return false;
        updatePrompt({ kind, index, patch: { label } });
        persist('rename-prompt', { kind, index });
        requestRender();
        return true;
      },
    },
    setPlacement: {
      capability: 'image-cuts:write',
      execute(value = {}) {
        assertMutable();
        const sectionId = String(value.sectionId || '').trim();
        if (!sectionId) return false;
        updatePlacement({ sectionId, value: String(value.value || '') });
        persist('placement', { sectionId });
        return true;
      },
    },
  };

  for (const name of ACTION_NAMES) {
    commands[name] = {
      capability: 'image-cuts:write',
      execute(value) {
        assertMutable();
        return actions[name](value);
      },
    };
  }

  function invoke(command, value) {
    try {
      return Promise.resolve(contract.invoke(command, value)).catch(reportError);
    } catch (error) {
      reportError(error);
      return Promise.resolve(null);
    }
  }

  const controller = createImageCutsController({
    defaultPromptCount,
    getSnapshot,
    invoke,
    promptUser,
  });

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'imagecuts',
    routes: ['imagecuts'],
    ownedSlices: ['image-cuts'],
    capabilities: ['image-cuts:read', 'image-cuts:write'],
    select(root = {}) {
      const snapshot = getSnapshot() || {};
      return { cuts: root.cuts || snapshot.cuts || {} };
    },
    commands,
    render(view) {
      return renderImageCutsView(view, { ...renderHelpers, defaultPromptCount, maxPromptCount });
    },
    bind(root) {
      return controller.bind(root);
    },
    onEnter() {
      active = true;
      generation += 1;
    },
    onLeave() {
      active = false;
      generation += 1;
    },
    persistence: { reads: ['image-cuts'], writes: ['image-cuts'] },
  });

  return contract;
}
