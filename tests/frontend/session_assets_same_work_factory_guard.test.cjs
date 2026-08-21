'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CORE = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-02.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function createRuntime(currentFactory, initialState = {}, expectedFence = null) {
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const state = {
    compPage: {},
    optionSorter: {},
    productName: '',
    ...clone(initialState),
  };
  let replacedFactory = null;
  let preserveCalls = 0;
  const payloadFence = payload => ({
    workspaceId: String(payload?.workspaceScope?.id || payload?.workspaceId || payload?.factory?.workspace?.id || ''),
    productKey: String(payload?.workIdentity?.initialProductKey || payload?.factory?.product?.productKey || ''),
    currentRunId: String(payload?.currentRunId || payload?.factory?.automation?.currentRunId || payload?.factory?.goalRun?.currentRunId || ''),
    inputImageFingerprint: String(payload?.inputImageFingerprint || payload?.workIdentity?.initialInputImageFingerprint || payload?.factory?.product?.lockedInputImageFingerprint || ''),
    activeStage: String(payload?.activeStage || payload?.factory?.activeStage || ''),
  });
  const matchesExpectedFence = payload => !expectedFence
    || Object.entries(expectedFence).every(([key, value]) => payloadFence(payload)[key] === value);
  const context = vm.createContext({
    state,
    cloneData: clone,
    workspaceBlankResetInProgress: false,
    validateIncomingWorkspaceBoundary: payload => ({ ok: matchesExpectedFence(payload) }),
    lastWorkSnapshotMatchesCurrentWorkspace: matchesExpectedFence,
    workspaceRevisionAllowsSnapshot: () => true,
    restoreLastWorkProjectIdentityFromAssets: () => {},
    lastWorkFactoryHasSelfConsistentCurrentAssets: () => false,
    stripRuntimeAssetsForApply: value => value,
    factoryRuntimeReadFactory: () => clone(currentFactory),
    normalizeFactoryState: value => clone(value),
    lastWorkPayloadProductName: () => '',
    sanitizeLastWorkPayloadProductScope: value => value,
    workspaceValidatedImageStatePayload: () => ({ payload: null, images: [], blocked: false }),
    factoryIdentityKey: factory => String(factory?.product?.productKey || ''),
    factoryProductHasImage: () => false,
    restoreSectionContentsFromStoredVariants: () => false,
    mergeRuntimeSectionImages: (currentImages, incomingImages) => {
      const result = clone(incomingImages || {});
      for (const [sectionId, image] of Object.entries(result)) {
        if (image === '__stored_in_indexeddb__' && currentImages?.[sectionId]) {
          result[sectionId] = currentImages[sectionId];
        }
      }
      return result;
    },
    mergeFactoryStoredImages: value => value,
    factoryWorkspaceIdentityFromSource: factory => ({ id: String(factory?.workspace?.id || '') }),
    resolveRestoredCandidateReviewWorkspaceId: value => value,
    factoryRecoverRestoredReviewCandidateWorkspaceScope: () => 0,
    restoreOptionSorterLabelsFromFactory: optionSorter => optionSorter,
    repairRestoredDraftFactoryAssetWorkspaceScope: () => false,
    restoreSpecificationSizeImageFromFactory: () => false,
    repairRestoredSessionIdentityDrift: () => false,
    observeWorkspaceRevisionSnapshot: () => null,
    factoryRuntimeReplaceFactorySnapshot: value => { replacedFactory = clone(value); },
    factoryPreserveProgressForSameWork: (incoming, current) => {
      preserveCalls += 1;
      return {
        ...clone(current),
        ...clone(incoming),
        product: { ...clone(current.product), ...clone(incoming.product) },
        assets: clone(current.assets),
        goalRun: clone(current.goalRun),
      };
    },
  });
  const applySource = sourceSlice(CORE, 'function applySessionAssetsPayload(', 'function repairRestoredSessionIdentityDrift(');
  vm.runInContext(`${applySource}\nglobalThis.apply = applySessionAssetsPayload;`, context);
  return {
    apply: context.apply,
    readState: () => clone(state),
    readReplaced: () => replacedFactory,
    readPreserveCalls: () => preserveCalls,
  };
}

test('forced same-work asset hydrate cannot lower existing factory progress', () => {
  const current = {
    workspace: { id: 'project-pouch' },
    product: {
      productName: '모시꽃수파우치',
      productKey: '모시꽃수파우치',
      dbCandidates: [{ jcode: 'DB-1' }],
    },
    assets: [{ id: 'color-group-shot' }],
    goalRun: { progress: 100 },
  };
  const incoming = {
    factory: {
      workspace: { id: 'project-pouch' },
      product: { productName: '모시꽃수파우치', productKey: '모시꽃수파우치' },
    },
  };
  const runtime = createRuntime(current);

  runtime.apply(incoming, {
    forceProductRestore: true,
    forceWorkspaceRestore: true,
    forceRevisionRestore: true,
    payloadAlreadyCloned: true,
  });

  assert.equal(runtime.readPreserveCalls(), 1);
  assert.deepEqual(runtime.readReplaced().assets, [{ id: 'color-group-shot' }]);
  assert.deepEqual(runtime.readReplaced().product.dbCandidates, [{ jcode: 'DB-1' }]);
  assert.equal(runtime.readReplaced().goalRun.progress, 100);
});

test('same-work session assets add missing durable section objects without reducing current A state', () => {
  const sectionIds = [
    'header',
    'hook',
    'key_features',
    'specifications',
    'use_scenarios',
    'competitive_edge',
    'material_tech',
    'certifications',
    'reviews',
    'size_color',
    'promotion',
    'shipping',
    'faq',
    'brand_story',
    'cta_footer',
  ];
  const currentSectionIds = sectionIds.filter(sectionId => sectionId !== 'size_color');
  const currentSectionContents = Object.fromEntries(currentSectionIds.map(sectionId => [
    sectionId,
    { headline: `current:${sectionId}` },
  ]));
  const currentSectionImages = Object.fromEntries(currentSectionIds.map(sectionId => [
    sectionId,
    `https://current.example/${sectionId}.png`,
  ]));
  const incomingSectionContents = Object.fromEntries(sectionIds.map(sectionId => [
    sectionId,
    { headline: `incoming:${sectionId}` },
  ]));
  const incomingSectionImages = Object.fromEntries(sectionIds.map(sectionId => [
    sectionId,
    `https://incoming.example/${sectionId}.png`,
  ]));
  const fence = {
    workspaceId: 'batch-20260724:factory-job-88e6ba8fa26a41b0ae396d2be6cb160a',
    productKey: '방울수저집',
    currentRunId: 'factory-run-attempt-58',
    inputImageFingerprint: 'sha256:input-image-attempt-58',
    activeStage: 'detail',
  };
  const currentFactory = {
    workspace: { id: fence.workspaceId },
    activeStage: fence.activeStage,
    automation: { currentRunId: fence.currentRunId },
    product: {
      productName: '방울수저집',
      productKey: fence.productKey,
      lockedInputImageFingerprint: fence.inputImageFingerprint,
    },
  };
  const incoming = {
    workspaceScope: { id: fence.workspaceId },
    currentRunId: fence.currentRunId,
    inputImageFingerprint: fence.inputImageFingerprint,
    activeStage: fence.activeStage,
    workIdentity: {
      initialProductKey: fence.productKey,
      initialInputImageFingerprint: fence.inputImageFingerprint,
    },
    sectionContents: incomingSectionContents,
    sectionImages: incomingSectionImages,
    factory: cloneFactory(currentFactory),
  };
  const runtime = createRuntime(currentFactory, {
    currentProjectId: fence.workspaceId,
    sectionContents: currentSectionContents,
    sectionImages: currentSectionImages,
  }, fence);

  assert.equal(runtime.apply(incoming, {
    forceProductRestore: true,
    forceRevisionRestore: true,
    preserveInlineImages: true,
    allowScopedInlineImages: true,
    payloadAlreadyCloned: true,
  }), true);

  const restored = runtime.readState();
  assert.equal(Object.keys(restored.sectionContents).length, 15);
  assert.equal(Object.keys(restored.sectionImages).length, 15);
  for (const sectionId of currentSectionIds) {
    assert.deepEqual(restored.sectionContents[sectionId], currentSectionContents[sectionId]);
    assert.equal(restored.sectionImages[sectionId], currentSectionImages[sectionId]);
  }
  assert.deepEqual(restored.sectionContents.size_color, incomingSectionContents.size_color);
  assert.equal(restored.sectionImages.size_color, incomingSectionImages.size_color);
  assert.deepEqual(restored.sectionContents.specifications, currentSectionContents.specifications);
  assert.equal(restored.sectionImages.specifications, currentSectionImages.specifications);

  const beforeForeign = runtime.readState();
  const foreignIncoming = {
    ...incoming,
    workspaceScope: { id: 'batch-foreign:factory-job-foreign' },
    factory: {
      ...cloneFactory(currentFactory),
      workspace: { id: 'batch-foreign:factory-job-foreign' },
    },
  };
  assert.equal(runtime.apply(foreignIncoming, {
    forceProductRestore: true,
    forceRevisionRestore: true,
    preserveInlineImages: true,
    allowScopedInlineImages: true,
    payloadAlreadyCloned: true,
  }), false);
  assert.deepEqual(runtime.readState(), beforeForeign);
});

function cloneFactory(factory) {
  return JSON.parse(JSON.stringify(factory));
}
