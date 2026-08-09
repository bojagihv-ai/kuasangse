import {
  FACTORY_TAB_CONTRACT_VERSION,
  createFactoryTabContract,
} from '../factory-tab-contract.mjs';
import { renderAssetsTab } from './assets-tab-render.mjs';
import { bindAssetsTab } from './assets-tab-bind.mjs';

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return source[name];
}

function runtimeFunction(source, name) {
  const descriptor = source && Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function') {
    throw new TypeError(`factory tab capability ${name} must be an own function`);
  }
  return descriptor.value;
}

function runtimeRecord(source, name) {
  const descriptor = source && Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || descriptor.get || descriptor.set || !descriptor.value || typeof descriptor.value !== 'object' || Array.isArray(descriptor.value)) {
    throw new TypeError(`factory tab capability ${name} must be an own record`);
  }
  return descriptor.value;
}

const ACTION_NAMES = Object.freeze({
  guideAction: ['runFactoryGuideAction', 'runGuideAction', 'guideAction'],
  setStageTarget: ['setFactoryStageTarget', 'factorySetStageTarget', 'setStageTarget', 'updateStageTarget'],
  setStagePrompt: ['setFactoryStagePrompt', 'factorySetStagePrompt', 'setStagePrompt', 'updateStagePrompt'],
  runStage: ['runFactoryStage', 'factoryRunStage', 'runStage'],
  addStageInputFiles: ['addFactoryStageInputFiles', 'factoryAddStageInputFiles', 'addStageInputFiles'],
  createProductInputAsset: ['createFactoryProductInputAsset', 'factoryCreateProductInputAsset', 'createProductInputAsset'],
  sendAsset: ['sendFactoryAssetToStage', 'factorySendAssetToStage', 'sendAssetToStage', 'sendAsset'],
  toggleAssetUse: ['toggleFactoryAssetUse', 'factoryToggleAssetUse', 'toggleAssetUse', 'useAsset'],
  selectACut: ['selectFactoryACut', 'factorySelectACut', 'selectACut'],
  toggleAssetReject: ['toggleFactoryAssetReject', 'factoryToggleAssetReject', 'toggleAssetReject', 'rejectAsset'],
  previewAsset: ['openFactoryAssetPreview', 'factoryOpenAssetPreview', 'previewAsset', 'openAssetPreview'],
  placeAsset: ['placeFactoryAsset', 'factoryPlaceAsset', 'placeAsset'],
  archiveAsset: ['archiveFactoryAsset', 'factoryArchiveAsset', 'archiveAsset'],
  confirmSizeImage: ['confirmFactorySizeImage', 'factoryConfirmSizeImage', 'confirmSizeImage'],
  openOptionsorter: ['openFactoryOptionSorter', 'factoryOpenOptionSorterEditor', 'openOptionSorter', 'openOptionsorter'],
  syncDbOptions: ['syncFactoryDbOptions', 'factorySyncDbOptionsToOptionSorter', 'syncDbOptions'],
  syncOptionResults: ['syncFactoryOptionResults', 'factoryImportOptionSorterResults', 'syncOptionResults'],
  setColorImageUsage: ['setFactoryOptionColorImageUsage', 'factorySetOptionColorImageUsage', 'setColorImageUsage'],
  setGroupShotImageSelected: ['setFactoryGroupShotImageSelected', 'setGroupShotImageSelected'],
  selectAllGroupShotImages: ['selectAllFactoryGroupShotImages', 'selectAllGroupShotImages'],
  clearGroupShotImages: ['clearFactoryGroupShotImages', 'clearGroupShotImages'],
  setGroupShotPrompt: ['setFactoryGroupShotPrompt', 'setGroupShotPrompt'],
  generateGroupShot: ['generateFactoryGroupShot', 'generateGroupShot'],
  toggleAssets: ['toggleFactoryAssets', 'factoryToggleAssets', 'toggleAssets'],
  togglePreviousAssets: ['toggleFactoryPreviousAssets', 'factoryTogglePreviousAssets', 'togglePreviousAssets'],
  openStageFile: ['openFactoryStageFile', 'factoryOpenStageFile', 'openStageFile'],
  openOptionColorFile: ['openFactoryOptionColorFile', 'factoryOpenOptionColorFile', 'openOptionColorFile'],
  addCompletedFiles: ['addFactoryCompletedFiles', 'factoryAddCompletedFiles', 'addCompletedFiles'],
  openCompletedFile: ['openFactoryCompletedFile', 'factoryOpenCompletedFile', 'openCompletedFile'],
});


export function createAssetsFactoryTab(capabilities = {}) {
  const getSnapshot = runtimeFunction(capabilities, 'getSnapshot');
  const assertMutable = runtimeFunction(capabilities, 'assertMutable');
  const getOperationToken = runtimeFunction(capabilities, 'getOperationToken');
  const isOperationCurrent = runtimeFunction(capabilities, 'isOperationCurrent');
  const actions = runtimeRecord(capabilities, 'actions');
  const renderHelpers = runtimeRecord(capabilities, 'renderHelpers');
  const reportError = runtimeFunction(capabilities, 'reportError');
  const runtimeCapabilities = Object.freeze({
    getSnapshot, assertMutable, getOperationToken, isOperationCurrent, reportError, actions, renderHelpers,
  });

  const helpers = Object.freeze({
    factoryAutomationCounts: requiredFunction(renderHelpers, 'factoryAutomationCounts'),
    factoryAutomationWizardTasks: requiredFunction(renderHelpers, 'factoryAutomationWizardTasks'),
    renderFactoryAutomationStatusCard: requiredFunction(renderHelpers, 'renderFactoryAutomationStatusCard'),
    renderFactoryAutomationAssetChooser: requiredFunction(renderHelpers, 'renderFactoryAutomationAssetChooser'),
    renderFactoryAutomationTaskChecklist: requiredFunction(renderHelpers, 'renderFactoryAutomationTaskChecklist'),
  });

  function invokeAction(name, ...args) {
    const target = ACTION_NAMES[name].map(candidate => actions?.[candidate]).find(item => typeof item === 'function');
    if (!target) throw new Error(`missing injected factory action: ${ACTION_NAMES[name][0]}`);
    const operationToken = getOperationToken();
    const context = Object.freeze({ operationToken, isCurrent: () => isOperationCurrent(operationToken) });
    return target(...args, context);
  }

  const commands = {
    guideAction: { capability: 'factory-assets:write', execute: value => invokeAction('guideAction', value) },
    setStageTarget: { capability: 'factory-assets:write', execute: (stageId, value) => invokeAction('setStageTarget', stageId, value) },
    setStagePrompt: { capability: 'factory-assets:write', execute: (stageId, value) => invokeAction('setStagePrompt', stageId, value) },
    runStage: { capability: 'factory-assets:write', execute: stageId => invokeAction('runStage', stageId) },
    addStageInputFiles: { capability: 'factory-assets:write', execute: (stageId, files) => invokeAction('addStageInputFiles', stageId, files) },
    createProductInputAsset: { capability: 'factory-assets:write', execute: stageId => invokeAction('createProductInputAsset', stageId) },
    sendAsset: { capability: 'factory-assets:write', execute: (assetId, stageId) => invokeAction('sendAsset', assetId, stageId) },
    toggleAssetUse: { capability: 'factory-assets:write', execute: assetId => invokeAction('toggleAssetUse', assetId) },
    selectACut: { capability: 'factory-assets:write', execute: value => invokeAction('selectACut', value) },
    toggleAssetReject: { capability: 'factory-assets:write', execute: assetId => invokeAction('toggleAssetReject', assetId) },
    previewAsset: { capability: 'factory-assets:read', execute: assetId => invokeAction('previewAsset', assetId) },
    placeAsset: { capability: 'factory-assets:write', execute: assetId => invokeAction('placeAsset', assetId) },
    archiveAsset: { capability: 'factory-assets:write', execute: assetId => invokeAction('archiveAsset', assetId) },
    confirmSizeImage: { capability: 'factory-assets:write', execute: () => invokeAction('confirmSizeImage') },
    openOptionsorter: { capability: 'factory-assets:write', execute: () => invokeAction('openOptionsorter') },
    syncDbOptions: { capability: 'factory-assets:write', execute: () => invokeAction('syncDbOptions') },
    syncOptionResults: { capability: 'factory-assets:write', execute: () => invokeAction('syncOptionResults') },
    setColorImageUsage: { capability: 'factory-assets:write', execute: value => invokeAction('setColorImageUsage', value) },
    setGroupShotImageSelected: { capability: 'factory-assets:write', execute: value => invokeAction('setGroupShotImageSelected', value) },
    selectAllGroupShotImages: { capability: 'factory-assets:write', execute: () => invokeAction('selectAllGroupShotImages') },
    clearGroupShotImages: { capability: 'factory-assets:write', execute: () => invokeAction('clearGroupShotImages') },
    setGroupShotPrompt: { capability: 'factory-assets:write', execute: value => invokeAction('setGroupShotPrompt', value) },
    generateGroupShot: { capability: 'factory-assets:write', execute: () => invokeAction('generateGroupShot') },
    toggleAssets: { capability: 'factory-assets:write', execute: () => invokeAction('toggleAssets') },
    togglePreviousAssets: { capability: 'factory-assets:write', execute: stageId => invokeAction('togglePreviousAssets', stageId) },
    openStageFile: { capability: 'factory-assets:read', execute: stageId => invokeAction('openStageFile', stageId) },
    openOptionColorFile: { capability: 'factory-assets:read', execute: () => invokeAction('openOptionColorFile') },
    addCompletedFiles: { capability: 'factory-assets:write', execute: files => invokeAction('addCompletedFiles', files) },
    openCompletedFile: { capability: 'factory-assets:read', execute: () => invokeAction('openCompletedFile') },
  };

  let contract;
  const fire = (name, ...args) => {
    try {
      const result = contract.invoke(name, ...args);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  };

  contract = createFactoryTabContract({
    version: FACTORY_TAB_CONTRACT_VERSION,
    id: 'factory/assets',
    owner: 'factory-assets',
    capabilities: ['factory-assets:read', 'factory-assets:write'],
    commands,
    select() {
      return getSnapshot();
    },
    render(view) {
      const factory = view?.factory || view || {};
      return renderAssetsTab(factory, helpers);
    },
    bind(root) { return bindAssetsTab(root, fire); },
    onEnter() {
      getOperationToken();
    },
    onLeave() {},
    persistence: { reads: ['factory-assets'], writes: ['factory-assets'] },
  }, runtimeCapabilities);

  return contract;
}
