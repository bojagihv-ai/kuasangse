import {
  binarySource,
  binaryText,
  list,
  record,
  revisionNumber,
  STORED_IMAGE_MARKER,
  text,
  tinyHash,
} from './work-bundle-foundation.mjs';
import {
  addCafe24CandidateAssets,
  addCompetitorAssets,
  addCompetitorDetailAssets,
  addInputAssets,
  addOptionInputAssets,
} from './work-bundle-input-assets.mjs';
import {
  addFactoryOutputAssets,
  addListOutputAssets,
  addMappedOutputAssets,
} from './work-bundle-output-assets.mjs?v=20260809-restore-isolated-v540';
import {
  assetTargetRows,
  fieldRows,
  sourceIdentity,
} from './work-bundle-fields.mjs';

export {
  resolveWorkBundleUpload,
  synchronizeWorkBundlePlan,
} from './work-bundle-sync-execution.mjs';

export function resolveWorkBundleSourceScheme(options = {}) {
  const explicitScheme = text(options.sourceScheme);
  if (explicitScheme) return explicitScheme;
  return options.fileHandle ? 'workfile-handle' : 'live-sync';
}

function archiveIdFromSource(source) {
  const match = text(source).match(/\/api\/local-archive\/assets\/([^/]+)\/image(?:[?#]|$)/u);
  return match ? decodeURIComponent(match[1]) : '';
}

function sourceFor(value) {
  return typeof value === 'string' ? binaryText(value) : binarySource(record(value));
}

function hasCurrentSectionArchive(asset, sectionId, source, workspaceId, runId) {
  const sourceArchiveId = archiveIdFromSource(source);
  const archived = record(asset);
  const archivedSource = sourceFor(archived);
  const sameSource = archivedSource === source
    || (sourceArchiveId && sourceArchiveId === text(archived.archiveId));
  const archivedWorkspaceId = text(archived.workspaceId);
  const archivedRunId = text(archived.currentRunId || archived.runId || archived.generationRunId);
  const archivedStage = text(archived.stageId || archived.stage);
  const validStage = archivedStage === 'sections' || archivedStage === 'section' || archivedStage === `section_${sectionId}`;
  return sameSource
    && text(archived.sectionId) === sectionId
    && validStage
    && (!archivedWorkspaceId || archivedWorkspaceId === workspaceId)
    && (!archivedRunId || !runId || archivedRunId === runId);
}

function recordStaleSectionLocators(plan, directSections, assetSections, archiveAssets, workspaceId, runId) {
  for (const [sectionId, directValue] of Object.entries(record(directSections))) {
    if (text(directValue) !== STORED_IMAGE_MARKER) continue;
    const fallbackSource = sourceFor(record(assetSections)[sectionId]);
    if (!fallbackSource) continue;
    const valid = list(archiveAssets).some(asset => hasCurrentSectionArchive(
      asset, sectionId, fallbackSource, workspaceId, runId,
    ));
    if (!valid) plan.excludedImageSources.push(Object.freeze({
      assetKey: `output:sections:${sectionId}`,
      reason: '원본 저장파일의 잘못된 locator라 제외',
    }));
  }
}

export function buildWorkBundleSyncPlan(value, options = {}) {
  const root = record(value);
  if (
    root.format !== 'kuasangse.factory.project'
    || Number(root.version) !== 1
  ) {
    throw new Error('workfile_format_invalid');
  }
  const project = record(root.project);
  const payload = record(project.payload);
  const assetPayload = record(payload.assetPayload);
  const factory = Object.keys(record(payload.factory)).length
    ? record(payload.factory)
    : record(assetPayload.factory);
  const factoryProduct = record(factory.product);
  const workspaceId = text(root.workspaceId || project.id || payload.currentProjectId);
  if (!workspaceId) throw new Error('workfile_workspace_id_missing');
  const workfileName = text(options.workfileName)
    || `${text(project.name || payload.currentProjectName) || '상세페이지 작업'}.kuasangse`;
  const sourcePath = text(options.sourceLocator)
    || `workfile-reference://${encodeURIComponent(workspaceId)}/${encodeURIComponent(workfileName)}`;
  const summary = record(root.summary);
  const productName = text(
    summary.productName
    || project.name
    || payload.productName
    || factoryProduct.productName
    || record(factoryProduct.finalDb).product_name
    || record(factoryProduct.confirmedDb).product_name,
  ) || null;
  const identity = sourceIdentity(factoryProduct, payload);
  const plan = {
    assets: [],
    uploads: [],
    assetKeys: new Set(),
    assetKeyGroups: new Map(),
    assetKeyCollisions: new Map(),
    assetSourceKeys: new Set(),
    missingRequiredAssetKeys: [],
    missingImageSources: [],
    excludedImageSources: [],
  };
  const cuts = record(payload.cuts);
  const optionSorter = record(payload.optionSorter);
  const directCompPage = record(payload.compPage);
  const compPage = Object.keys(directCompPage).length
    ? directCompPage
    : record(assetPayload.compPage);
  const compPageSourceLocator = Object.keys(directCompPage).length
    ? 'project.payload.compPage'
    : 'project.payload.assetPayload.compPage';
  const archiveAssets = list(record(factory.archive).localAssets).length
    ? record(factory.archive).localAssets
    : record(record(assetPayload.factory).archive).localAssets;
  const directSectionImages = record(payload.sectionImages);
  const assetSectionImages = record(assetPayload.sectionImages);
  addInputAssets(plan, payload, factoryProduct);
  addOptionInputAssets(plan, optionSorter.images);
  addCafe24CandidateAssets(plan, factoryProduct);
  addCompetitorAssets(plan, factoryProduct);
  addCompetitorDetailAssets(
    plan,
    compPage,
    `${compPageSourceLocator}.marketScrape.scrapedImages`,
  );
  addFactoryOutputAssets(plan, factory);
  recordStaleSectionLocators(
    plan,
    directSectionImages,
    assetSectionImages,
    archiveAssets,
    workspaceId,
    text(factory.currentRunId || factoryProduct.currentRunId),
  );
  addMappedOutputAssets(
    plan,
    Object.keys(directSectionImages).length ? directSectionImages : assetSectionImages,
    'sections',
    'project.payload.sectionImages',
    payload.currentSectionVariantIds,
    archiveAssets,
  );
  addMappedOutputAssets(
    plan,
    Object.keys(record(payload.fixedDetailImages)).length
      ? payload.fixedDetailImages
      : assetPayload.fixedDetailImages,
    'sections',
    'project.payload.fixedDetailImages',
    {},
    archiveAssets,
  );
  addListOutputAssets(
    plan,
    list(payload.detailImageBlocks).length
      ? payload.detailImageBlocks
      : assetPayload.detailImageBlocks,
    'detail',
    'project.payload.detailImageBlocks',
  );
  addListOutputAssets(
    plan,
    cuts.prompts,
    'cuts',
    'project.payload.cuts.prompts',
  );
  addListOutputAssets(
    plan,
    cuts.sizePrompts,
    'size',
    'project.payload.cuts.sizePrompts',
  );
  addListOutputAssets(
    plan,
    optionSorter.optionResults,
    'options',
    'project.payload.optionSorter.optionResults',
  );
  const revision = revisionNumber(root, factory);
  const bundleKey = `kuasangse:${workspaceId}`.slice(0, 320);
  const manifest = Object.freeze({
    bundleKey,
    workfileName,
    sourcePath,
    sourceFormat: root.format,
    sourceVersion: Number(root.version),
    sourceSystem: identity.sourceSystem,
    detectedJcode: identity.detectedJcode,
    cafe24ProductNo: identity.cafe24ProductNo,
    productName,
    fields: Object.freeze([
      ...fieldRows(payload, factoryProduct, productName),
      ...assetTargetRows(payload, factory, summary),
    ]),
    assets: Object.freeze(plan.assets),
  });
  const manifestJson = JSON.stringify(manifest);
  const manifestFingerprint = `${tinyHash(`manifest-a\u001f${manifestJson}`)}`
    + `${tinyHash(`manifest-b\u001f${manifestJson}`)}`;
  return Object.freeze({
    manifest,
    uploads: Object.freeze(plan.uploads),
    assetKeyCollisions: Object.freeze(
      [...plan.assetKeyCollisions.values()].sort((left, right) => (
        left.baseAssetKey < right.baseAssetKey
          ? -1
          : left.baseAssetKey > right.baseAssetKey
            ? 1
            : 0
      )),
    ),
    missingRequiredAssetKeys: Object.freeze(plan.missingRequiredAssetKeys),
    missingImageSources: Object.freeze(plan.missingImageSources),
    excludedImageSources: Object.freeze(plan.excludedImageSources),
    revision,
    idempotencyKey: `work-bundle:${tinyHash(bundleKey)}:r${revision}:m${manifestFingerprint}:plan-v5`,
  });
}
