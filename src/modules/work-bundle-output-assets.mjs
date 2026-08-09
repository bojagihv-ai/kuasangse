import {
  binarySource,
  binaryText,
  filenameFor,
  hasValue,
  list,
  mimeFromSource,
  pushAsset,
  record,
  roleForStage,
  safeKey,
  selectedIds,
  STORED_IMAGE_MARKER,
  text,
} from './work-bundle-foundation.mjs';

function identityKey(value) {
  return text(value).replace(/\s+/gu, '').toLowerCase();
}

function restoredCandidateMatchesCurrentWork(asset, factory) {
  const metadata = record(asset.metadata);
  if (metadata.isolatedOnProjectFileRestore !== true) return false;
  const sourceMap = record(asset.sourceMap);
  const product = record(factory.product);
  const expected = {
    workspaceId: text(record(factory.workspace).id || factory.currentProjectId),
    productKey: identityKey(product.productKey || product.productIdentityKey || product.productName),
    fingerprint: text(product.lockedInputImageFingerprint || product.inputImageFingerprint),
  };
  const actual = {
    workspaceId: text(asset.workspaceId || asset.currentProjectId || metadata.workspaceId || sourceMap.workspaceId),
    productKey: identityKey(asset.productKey || metadata.productKey || sourceMap.productKey),
    fingerprint: text(asset.inputImageFingerprint || metadata.inputImageFingerprint || sourceMap.inputImageFingerprint),
  };
  return Object.values(expected).every(Boolean)
    && actual.workspaceId === expected.workspaceId
    && actual.productKey === expected.productKey
    && actual.fingerprint === expected.fingerprint;
}

function factoryOutputAssetRows(factory) {
  const current = list(factory.assets).map((value, index) => ({
    value,
    sourceLocator: `project.payload.assetPayload.factory.assets[${index}]`,
  }));
  const seen = new Set(current.map(({ value }) => text(record(value).id)).filter(Boolean));
  const restored = list(factory.previousAssets)
    .map((value, index) => ({
      value,
      sourceLocator: `project.payload.assetPayload.factory.previousAssets[${index}]`,
    }))
    .filter(({ value }) => restoredCandidateMatchesCurrentWork(record(value), factory))
    .filter(({ value }) => {
      const id = text(record(value).id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  return [...current, ...restored];
}

export function addFactoryOutputAssets(plan, factory) {
  const selected = selectedIds(factory.stages);
  factoryOutputAssetRows(factory).forEach(({ value, sourceLocator }, index) => {
    const asset = record(value);
    const id = text(asset.id) || `asset-${index + 1}`;
    const stage = text(asset.stageId) || 'cuts';
    const source = binarySource(asset);
    if (!source) return;
    const mimeType = mimeFromSource(source, text(asset.mime));
    const selectionState = asset.rejected === true
      ? 'rejected'
      : asset.archived === true
        ? 'archived'
        : selected.has(id)
          ? 'selected'
          : 'candidate';
    pushAsset(
      plan,
      {
        assetKey: `output:${safeKey(id, String(index))}`.slice(0, 320),
        phase: 'output',
        stage,
        role: roleForStage(stage),
        displayName: text(asset.title || asset.name) || `${stage} 결과 ${index + 1}`,
        sourceLocator,
        selectionState,
        sortOrder: index,
        metadata: {
          sourceAssetId: id,
          sectionId: text(asset.sectionId || asset.placedSectionId),
          runId: text(asset.currentRunId || asset.generationRunId),
          parentAssetIds: list(asset.parentAssetIds).map(text).filter(Boolean),
          mimeType,
          sourceKind: 'factory-output',
        },
      },
      source,
      filenameFor(asset, `${stage}-${index + 1}`, mimeType),
      mimeType,
    );
  });
}

export function addMappedOutputAssets(
  plan,
  sourceRecord,
  stage,
  sourceLocator,
  selectedMap = {},
  archiveAssets = [],
) {
  Object.entries(record(sourceRecord)).forEach(([key, value], index) => {
    const sourceValue = record(value);
    let source = typeof value === 'string'
      ? binaryText(value)
      : binarySource(sourceValue);
    const storedImageKnown = text(value) === STORED_IMAGE_MARKER;
    if (!source && storedImageKnown) {
      const archived = list(archiveAssets).find((item) => (
        text(record(item).sectionId) === key
        && binarySource(record(item))
      ));
      source = binarySource(record(archived));
    }
    if (!source) return;
    const mimeType = mimeFromSource(source, text(sourceValue.mime));
    const selected = hasValue(record(selectedMap)[key]);
    pushAsset(
      plan,
      {
        assetKey: `output:${stage}:${safeKey(key, String(index))}`.slice(0, 320),
        phase: 'output',
        stage,
        role: roleForStage(stage),
        displayName: text(sourceValue.title || sourceValue.name) || `${key} 섹션`,
        sourceLocator: `${sourceLocator}.${key}`,
        selectionState: selected ? 'selected' : 'candidate',
        sortOrder: 2000 + index,
        metadata: {
          sectionId: key,
          mimeType,
          sourceKind: 'section-output',
        },
      },
      source,
      filenameFor(sourceValue, `${stage}-${index + 1}`, mimeType),
      mimeType,
    );
  });
}

export function addListOutputAssets(plan, values, stage, sourceLocator) {
  list(values).forEach((value, index) => {
    const asset = record(value);
    const source = typeof value === 'string'
      ? binaryText(value)
      : binaryText(asset.result) || binarySource(asset);
    const storedImageKnown = text(value) === STORED_IMAGE_MARKER;
    if (!source && !storedImageKnown) return;
    const mimeType = mimeFromSource(source, text(asset.mime));
    const selectionState = asset.rejected === true
      ? 'rejected'
      : asset.archived === true
        ? 'archived'
        : asset.selected === true || asset.used === true
          ? 'selected'
          : 'candidate';
    const displayName = text(asset.title || asset.name || asset.label) || `${stage} ${index + 1}`;
    const alreadyCapturedByFactoryAsset = plan.uploads.some((upload) => {
      if (upload.source !== source) return false;
      const existing = plan.assets.find((candidate) => candidate.assetKey === upload.assetKey);
      return existing?.stage === stage
        && existing?.role === roleForStage(stage)
        && existing?.displayName === displayName
        && existing?.selectionState === selectionState
        && record(existing?.metadata).sourceKind === 'factory-output';
    });
    if (alreadyCapturedByFactoryAsset) return;
    pushAsset(
      plan,
      {
        assetKey: `output:${stage}:${safeKey(asset.id, String(index))}`.slice(0, 320),
        phase: 'output',
        stage,
        role: roleForStage(stage),
        displayName,
        sourceLocator: `${sourceLocator}[${index}]`,
        selectionState,
        sortOrder: 3000 + index,
        metadata: {
          mimeType,
          sourceKind: 'detail-output',
        },
      },
      source,
      filenameFor(asset, `${stage}-${index + 1}`, mimeType),
      mimeType,
    );
  });
}
