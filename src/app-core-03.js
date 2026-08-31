let factoryLiveGoalOperationId = '';

const FACTORY_SINHWA_FIELD_SECTIONS = [
  { title: '신화사 기본값', fields: [
    { id: 'product_name', label: '상품명', required: true, dbFieldId: 'product_name', aliases: ['product_name','jname','name','상품명'] },
    { id: 'product_code', label: '신화사 코드 / 품번', required: true, dbFieldId: 'product_code', aliases: ['jcode','product_code','product_no','code','품번','상품코드'] },
    { id: 'category', label: '분류', dbFieldId: 'category', aliases: ['category','category_name','분류','카테고리'] },
    { id: 'size', label: '규격 / 사이즈', required: true, dbFieldId: 'size', aliases: ['size','spec','specification','dimension','dimensions','규격','사이즈','크기'] },
    { id: 'material', label: '소재', dbFieldId: 'material', aliases: ['material','fabric','소재','재질'] },
    { id: 'weight', label: '무게', dbFieldId: 'weight', aliases: ['weight','무게','중량'] },
  ]},
  { title: '가격 / 운영', fields: [
    { id: 'sale_price', label: '판매가', required: true, dbFieldId: 'sale_price', aliases: ['sale_price','selling_price','price','판매가'] },
    { id: 'consumer_price', label: '소비자가', required: true, dbFieldId: 'consumer_price', aliases: ['consumer_price','retail_price','market_price','소비자가'] },
    { id: 'purchase_price', label: '원가 / 공급가', dbFieldId: 'purchase_price', aliases: ['purchase_price','supply_price','cost','원가','공급가'] },
    { id: 'stock', label: '재고', dbFieldId: 'stock', aliases: ['stock','stock_qty','quantity','재고'] },
    { id: 'manufacturer', label: '제조사', required: true, dbFieldId: 'manufacturer', aliases: ['manufacturer','maker','supplier','제조사','공급사'] },
    { id: 'supplier', label: '공급사', dbFieldId: 'supplier', aliases: ['supplier','vendor','vendor_name','공급사','거래처'] },
  ]},
  { title: '옵션', fields: [
    { id: 'option_values', label: '옵션 구성', required: true, dbFieldId: 'option_values', aliases: ['options','option_values','color_options','variants','색상','옵션'] },
    { id: 'option_count', label: '옵션수', required: true, dbFieldId: 'option_count', aliases: ['option_count','color_count','variant_count','옵션수'] },
  ]},
];

const FACTORY_STAGE_STATUS_LABELS = {
  idle: '대기',
  review: '선택 대기',
  running: '진행 중',
  done: '완료',
  blocked: '검수 필요',
  error: '오류',
};

function defaultFactoryStageState() {
  return FACTORY_STAGE_DEFS.reduce((acc, def) => {
    acc[def.id] = {
      status: 'idle',
      message: '',
      targetCount: def.id === 'db' || def.id === 'detail' || def.id === 'export'
        ? 1
        : (def.id === 'hero' || def.id === 'cuts' ? 4 : 3),
      prompt: '',
      inputAssetIds: [],
      selectedAssetIds: [],
      updatedAt: null,
    };
    return acc;
  }, {});
}

function defaultFactoryState() {
  return {
    workspace: {
      id: '',
      name: '',
      createdAt: null,
      updatedAt: null,
    },
    currentProjectId: '',
    currentProjectName: '',
    workspaceRevision: null,
    product: {
      productName: '',
      userProductName: '',
      naturalHint: '',
      imageBase64: null,
      imageMime: '',
      imagePreview: null,
      imageName: '',
      lockedInputImageFingerprint: '',
      lockedInputImageName: '',
      lockedInputImageMime: '',
      lockedInputImageSetAt: null,
      inputImages: [],
      analysis: null,
      confirmedDb: null,
      finalDb: null,
      dbFieldSettings: {},
      dbCustomFields: [],
      dbFieldPresetId: '',
      dbCandidates: [],
      cafe24Candidates: [],
      pendingDbCandidates: [],
      pendingCafe24Candidates: [],
      candidateAutoApply: false,
      candidateReviewStatus: '',
      sinhwaDbProgramStatus: null,
      selectedDbCandidateKey: '',
      selectedCafe24CandidateKey: '',
      dbCandidateResolution: '',
      cafe24CandidateResolution: '',
      cafe24ApiCatalog: [],
      cafe24ApiLastFetchedAt: null,
      cafe24ApiStatus: '',
      cafe24EndpointHealth: [],
      cafe24EndpointHealthFetchedAt: null,
      cafe24EndpointHealthProductNo: '',
      cafe24ReferenceLists: {},
      cafe24ReferenceFetchedAt: null,
      cafe24ReferenceStatus: '',
      cafe24ReferenceLoading: false,
      cafe24ReferenceAutoTried: false,
      cafe24DraftProductKey: '',
      cafe24VariantEdits: {},
      cafe24OptionGroupsDraft: [],
      cafe24OptionExtrasDraft: {},
      cafe24OptionContextMatch: null,
      cafe24OptionContextMatchBusy: false,
      cafe24ImageDraft: {},
      cafe24IconDraft: {},
      cafe24RelationDraft: {},
      cafe24MemoDraft: {},
      cafe24MainDraft: {},
      cafe24PromotionDraft: {},
      cafe24SeoDraft: {},
      cafe24TagsDraft: {},
      cafe24LastSaveVerification: null,
      cafe24SyncResults: {},
      cafe24AutoSendOnSave: true,
      dbInputSavedAt: null,
      dbInputSnapshots: [],
      sourcePanelState: {
        cafe24Collapsed: false,
        sinhwaCollapsed: false,
        cafe24CollapsedSections: [],
        sinhwaCollapsedSections: [],
      },
      competitors: [],
      competitorSource: '',
      dbLocked: false,
    },
    stages: defaultFactoryStageState(),
    assets: [],
    previousAssets: [],
    previousAssetsExpanded: {},
    detailPlacement: {},
    detailMode: 'mixed',
    automation: {
      activeTab: 'start',
      activeTaskId: '',
      confirmedTasks: {},
      skippedTasks: {},
      fieldReview: {},
      sectionPromptPlan: {},
      parallelProgress: {},
      startRunCounts: {},
      startRunScopeKey: '',
      dbSearchQuery: '',
      lastWizardActionAt: null,
      competitorMode: 'preset',
      optionMode: 'pending',
      cutMode: 'pending',
      updatedAt: null,
    },
    uiPanels: {
      materials: false,
      assets: false,
    },
    openMarketSync: {
      mode: 'cafe24_marketplus',
      finalTarget: 'cafe24_openmarket',
      cafe24Display: 'T',
      cafe24Selling: 'T',
      finalRegistrationRunning: false,
      finalRegistrationProgress: 0,
      finalRegistrationStatus: '',
      finalRegistrationUpdatedAt: null,
      selectedChannels: ['coupang', 'smartstore', 'gmarket', 'auction', 'elevenst'],
      channelStatus: {},
      drafts: {},
      dryRuns: {},
      logs: [],
      marketPlusStatus: null,
      marketPlusAction: null,
      marketPlusDetailStatus: null,
      marketPlusCategoryFields: null,
      marketPlusCategoryApply: null,
      marketPlusSendLimitStatus: null,
      marketPlusSendLimitAction: null,
      marketPlusCafe24LinkageStatus: null,
      marketPlusUrl: '',
      browserAutomation: null,
      browserSnapshot: null,
      lastCheckedAt: null,
      lastDraftedAt: null,
      lastDryRunAt: null,
      lastBrowserCheckedAt: null,
      lastBrowserSnapshotAt: null,
      lastMarketPlusStartedAt: null,
      lastMarketPlusDetailCheckedAt: null,
      lastMarketPlusCategoryCheckedAt: null,
      lastMarketPlusSendLimitCheckedAt: null,
      lastMarketPlusCafe24LinkageCheckedAt: null,
      loading: false,
      status: '',
    },
    activeStage: 'db',
    logs: [],
    cafe24FieldView: factoryLoadCafe24FieldViewStorage(),
    lastSavedAt: null,
    goalRun: {
      running: false,
      mode: 'review',
      progress: 0,
      currentStage: '',
      loopCount: 0,
      maxLoops: 3,
      targets: { hero: 4, size: 1, options: 1, cuts: 4, detail: 1 },
      failureReason: '',
      nextAction: '',
      startedAt: null,
      finishedAt: null,
      stopRequested: false,
    },
    archive: {
      folderName: '',
      sessionFolderName: '',
      supported: false,
      saveLog: [],
      lastSavedAt: null,
      autoSave: true,
      status: '',
      localRoot: '',
      localIndexPath: '',
      localStatus: '',
      localLastSavedAt: null,
      localRunId: '',
      stageRunIds: {},
      localAssets: [],
      localAssetsLoading: false,
      localAssetsError: '',
    },
  };
}

function normalizeFactoryStageState(sourceStages) {
  const base = defaultFactoryStageState();
  const source = sourceStages && typeof sourceStages === 'object' ? sourceStages : {};
  for (const def of FACTORY_STAGE_DEFS) {
    const raw = source[def.id] || {};
    base[def.id] = {
      ...base[def.id],
      ...raw,
      status: ['idle', 'review', 'running', 'done', 'blocked', 'error'].includes(raw.status) ? raw.status : (raw.done ? 'done' : base[def.id].status),
      targetCount: Math.max(1, Math.min(30, Number.parseInt(raw.targetCount ?? base[def.id].targetCount, 10) || base[def.id].targetCount)),
      prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
      inputAssetIds: Array.isArray(raw.inputAssetIds) ? raw.inputAssetIds.filter(Boolean) : [],
      selectedAssetIds: Array.isArray(raw.selectedAssetIds) ? raw.selectedAssetIds.filter(Boolean) : [],
      message: typeof raw.message === 'string' ? raw.message : '',
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    };
  }
  return base;
}

function factoryImageSrcFromString(value, mime = 'image/png', assumeBase64 = false) {
  const raw = String(value || '').trim();
  if (!raw || raw === '__stored_in_indexeddb__') return '';
  const direct = displayableImageSrc(raw);
  if (direct) return direct;
  const imgMatch = /<img\b[^>]*\bsrc=(["'])(.*?)\1/i.exec(raw);
  if (imgMatch) return factoryImageSrcFromString(imgMatch[2], mime);
  const compact = raw.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=]+$/.test(compact) && compact.length > (assumeBase64 ? 16 : 200)) {
    const safeMime = typeof inferImageMimeFromBase64 === 'function'
      ? inferImageMimeFromBase64(compact, mime || 'image/png')
      : (mime || 'image/png');
    return `data:${safeMime};base64,${compact}`;
  }
  return '';
}

function factoryCoerceImageSrc(value, seen = new WeakSet()) {
  if (!value) return '';
  if (typeof value === 'string') return factoryImageSrcFromString(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const image = factoryCoerceImageSrc(item, seen);
      if (image) return image;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  const mime = value.mime || value.mimeType || value.contentType || 'image/png';
  for (const key of ['image', 'dataUrl', 'preview', 'previewUrl', 'imageUrl', 'url', 'src', 'thumbnail', 'thumb', 'result', 'output', 'file', 'html']) {
    const image = factoryCoerceImageSrc(value[key], seen);
    if (image) return image;
  }
  for (const key of ['base64', 'data', 'b64', 'imageBase64']) {
    const image = factoryImageSrcFromString(value[key], mime, true);
    if (image) return image;
  }
  return '';
}

function factorySourceCutResultForAsset(asset) {
  const sourceMap = asset?.sourceMap || {};
  const metadata = asset?.metadata || {};
  const cutId = sourceMap.cutId || metadata.cutId || sourceMap.originalCutId || metadata.originalCutId || '';
  const prompts = asset.stageId === 'size'
    ? (state.cuts?.sizePrompts || [])
    : (state.cuts?.prompts || []);
  const runId = asset?.generationRunId || asset?.currentRunId || metadata.generationRunId || metadata.currentRunId || sourceMap.generationRunId || sourceMap.currentRunId || '';
  const candidateIds = new Set([
    cutId,
    sourceMap.originalCutId,
    metadata.originalCutId,
    sourceMap.cutSlotKey,
    metadata.cutSlotKey,
  ].map(value => String(value || '').trim()).filter(Boolean));
  const slotIndex = Number(sourceMap.cutSlotIndex ?? metadata.cutSlotIndex);
  const cutIndex = prompts.findIndex((cut, index) => {
    if (!cut) return false;
    if (candidateIds.has(String(cut.id || '').trim())) return true;
    if (Number.isFinite(slotIndex) && slotIndex === index) return true;
    if (typeof factoryCutPromptImportKey === 'function') {
      const importKey = factoryCutPromptImportKey(cut, asset.stageId, index, runId);
      if (candidateIds.has(String(importKey || '').trim())) return true;
    }
    return false;
  });
  const cut = cutIndex >= 0 ? prompts[cutIndex] : null;
  if (cut?.result) return cut.result;
  if (asset.stageId === 'size') {
    const cache = state.cuts?.sizeCutResultCache || {};
    const firstCandidateId = [...candidateIds][0] || cutId;
    const byId = typeof resolveSizeCutCacheEntry === 'function'
      ? resolveSizeCutCacheEntry(cache, `id:${firstCandidateId}`)
      : cache[`id:${firstCandidateId}`];
    const byIndex = cutIndex >= 0
      ? (typeof resolveSizeCutCacheEntry === 'function'
          ? resolveSizeCutCacheEntry(cache, `index:${cutIndex}`)
          : cache[`index:${cutIndex}`])
      : null;
    return byId?.result ||
      byIndex?.result ||
      null;
  }
  return null;
}

function factoryInlineImageLooksHeavy(value = '', minLength = 180000) {
  const text = String(value || '');
  return /^data:image\//i.test(text) && text.length > minLength;
}

function factoryLocalArchiveImageReference(value = '') {
  const raw = String(value || '').trim();
  if (!raw || raw === '__stored_in_indexeddb__') return null;
  const match = raw.match(/^(?:https?:\/\/[^/]+)?(\/api\/local-archive\/assets\/([^/?#]+)\/image)(?:[?#].*)?$/i);
  if (!match) return null;
  const archiveId = decodeURIComponent(String(match[2] || '').trim());
  if (!archiveId) return null;
  const imageUrl = `/api/local-archive/assets/${encodeURIComponent(archiveId)}/image`;
  const displayUrl = typeof factoryRuntimeArchiveImageUrl === 'function'
    ? factoryRuntimeArchiveImageUrl({ archiveId, imageUrl })
    : imageUrl;
  return { archiveId, imageUrl, displayUrl };
}

function factoryApplyLocalArchiveImageReference(asset = {}, ref = null) {
  if (!asset || typeof asset !== 'object' || !ref?.archiveId) return asset;
  asset.archiveId = asset.archiveId || ref.archiveId;
  asset.imageUrl = ref.imageUrl || asset.imageUrl || '';
  asset.imagePersistence = 'local-archive-url';
  asset.hasImage = true;
  if (factoryLocalArchiveImageReference(asset.image)) asset.image = '';
  if (factoryLocalArchiveImageReference(asset.dataUrl)) asset.dataUrl = '';
  if (factoryLocalArchiveImageReference(asset.result)) asset.result = '';
  asset.localArchive = {
    ...(asset.localArchive || {}),
    saved: true,
    archiveId: asset.archiveId || ref.archiveId,
    imageUrl: asset.imageUrl || ref.imageUrl || '',
  };
  asset.metadata = {
    ...(asset.metadata || {}),
    localArchiveId: asset.archiveId || ref.archiveId,
    imageUrl: asset.imageUrl || ref.imageUrl || '',
    imagePersistence: 'local-archive-url',
  };
  asset.sourceMap = {
    ...(asset.sourceMap || {}),
    localArchiveId: asset.archiveId || ref.archiveId,
    imageUrl: asset.imageUrl || ref.imageUrl || '',
  };
  return asset;
}

function factoryNormalizeAssetImageReference(asset = {}) {
  if (!asset || typeof asset !== 'object') return null;
  const ref = factoryLocalArchiveImageReference(asset.image) ||
    factoryLocalArchiveImageReference(asset.dataUrl) ||
    factoryLocalArchiveImageReference(asset.result) ||
    factoryLocalArchiveImageReference(asset.imageUrl) ||
    factoryLocalArchiveImageReference(asset.thumbnailUrl) ||
    factoryLocalArchiveImageReference(asset.metadata?.image) ||
    factoryLocalArchiveImageReference(asset.metadata?.result) ||
    factoryLocalArchiveImageReference(asset.metadata?.imageUrl) ||
    factoryLocalArchiveImageReference(asset.sourceMap?.imageUrl);
  if (!ref) return null;
  factoryApplyLocalArchiveImageReference(asset, ref);
  return ref;
}

function factoryRuntimeBackendBaseUrl() {
  const candidates = [];
  try {
    if (typeof loadBackendUrl === 'function') candidates.push(loadBackendUrl());
  } catch (_) {}
  candidates.push('http://127.0.0.1:5050');
  const picked = candidates.find(value => String(value || '').trim());
  return String(picked || 'http://127.0.0.1:5050').replace(/\/+$/, '');
}

function factoryRuntimeArchiveImageUrl(asset = {}) {
  const raw = String(
    asset?.imageUrl ||
    asset?.thumbnailUrl ||
    asset?.localArchive?.imageUrl ||
    asset?.localArchive?.thumbnailUrl ||
    asset?.metadata?.imageUrl ||
    asset?.metadata?.thumbnailUrl ||
    asset?.sourceMap?.imageUrl ||
    asset?.sourceMap?.thumbnailUrl ||
    ''
  ).trim();
  if (raw) {
    if (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)) return raw;
    const base = factoryRuntimeBackendBaseUrl();
    return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
  }
  const archiveId = String(
    asset?.archiveId ||
    asset?.localArchive?.archiveId ||
    asset?.metadata?.localArchiveId ||
    asset?.metadata?.sourceArchiveId ||
    asset?.sourceMap?.localArchiveId ||
    asset?.sourceMap?.sourceArchiveId ||
    ''
  ).trim();
  if (!archiveId) return '';
  const base = factoryRuntimeBackendBaseUrl();
  return `${base}/api/local-archive/assets/${encodeURIComponent(archiveId)}/image`;
}

const FACTORY_ASSET_DISPLAY_IMAGE_ID_CACHE_LIMIT = 180;
const factoryAssetDisplayImageCache = new WeakMap();
const factoryAssetDisplayImageIdCache = new Map();

function factoryAssetDisplayImageCacheId(asset) {
  return String(asset?.id || '').trim();
}

function factoryCachedAssetDisplayImage(asset) {
  const direct = factoryAssetDisplayImageCache.get(asset);
  if (direct) return direct;
  const id = factoryAssetDisplayImageCacheId(asset);
  if (!id) return null;
  const cached = factoryAssetDisplayImageIdCache.get(id) || null;
  if (cached) {
    factoryAssetDisplayImageIdCache.delete(id);
    factoryAssetDisplayImageIdCache.set(id, cached);
  }
  return cached;
}

function factoryTrimAssetDisplayImageIdCache() {
  while (factoryAssetDisplayImageIdCache.size > FACTORY_ASSET_DISPLAY_IMAGE_ID_CACHE_LIMIT) {
    const oldestId = factoryAssetDisplayImageIdCache.keys().next().value;
    if (!oldestId) break;
    factoryAssetDisplayImageIdCache.delete(oldestId);
  }
}

function factoryAssetDisplayImageCacheMatches(asset, cached) {
  if (!asset || !cached) return false;
  const metadata = asset.metadata || {};
  const sourceMap = asset.sourceMap || {};
  const localArchive = asset.localArchive || {};
  return cached.image === asset.image &&
    cached.dataUrl === asset.dataUrl &&
    cached.result === asset.result &&
    cached.imageUrl === asset.imageUrl &&
    cached.thumbnailUrl === asset.thumbnailUrl &&
    cached.archiveId === asset.archiveId &&
    cached.localArchiveImageUrl === localArchive.imageUrl &&
    cached.localArchiveThumbnailUrl === localArchive.thumbnailUrl &&
    cached.localArchiveId === localArchive.archiveId &&
    cached.metadataImage === metadata.image &&
    cached.metadataResult === metadata.result &&
    cached.metadataPreview === metadata.preview &&
    cached.metadataDataUrl === metadata.dataUrl &&
    cached.metadataImageUrl === metadata.imageUrl &&
    cached.metadataThumbnailUrl === metadata.thumbnailUrl &&
    cached.metadataLocalArchiveId === metadata.localArchiveId &&
    cached.metadataSourceArchiveId === metadata.sourceArchiveId &&
    cached.sourceMapImageUrl === sourceMap.imageUrl &&
    cached.sourceMapThumbnailUrl === sourceMap.thumbnailUrl &&
    cached.sourceMapLocalArchiveId === sourceMap.localArchiveId &&
    cached.sourceMapSourceArchiveId === sourceMap.sourceArchiveId &&
    cached.imageLoadFailed === asset.imageLoadFailed &&
    cached.imageLoadFailedSrc === asset.imageLoadFailedSrc &&
    cached.metadataImageLoadFailed === metadata.imageLoadFailed &&
    cached.metadataImageLoadFailedAt === metadata.imageLoadFailedAt &&
    cached.metadataImageLoadFailedSrc === metadata.imageLoadFailedSrc &&
    cached.backendBaseUrl === factoryRuntimeBackendBaseUrl();
}

function factoryRememberAssetDisplayImage(asset, image) {
  if (!asset || typeof asset !== 'object') return;
  const metadata = asset.metadata || {};
  const sourceMap = asset.sourceMap || {};
  const localArchive = asset.localArchive || {};
  const cached = {
    image: asset.image,
    dataUrl: asset.dataUrl,
    result: asset.result,
    imageUrl: asset.imageUrl,
    thumbnailUrl: asset.thumbnailUrl,
    archiveId: asset.archiveId,
    localArchiveImageUrl: localArchive.imageUrl,
    localArchiveThumbnailUrl: localArchive.thumbnailUrl,
    localArchiveId: localArchive.archiveId,
    metadataImage: metadata.image,
    metadataResult: metadata.result,
    metadataPreview: metadata.preview,
    metadataDataUrl: metadata.dataUrl,
    metadataImageUrl: metadata.imageUrl,
    metadataThumbnailUrl: metadata.thumbnailUrl,
    metadataLocalArchiveId: metadata.localArchiveId,
    metadataSourceArchiveId: metadata.sourceArchiveId,
    sourceMapImageUrl: sourceMap.imageUrl,
    sourceMapThumbnailUrl: sourceMap.thumbnailUrl,
    sourceMapLocalArchiveId: sourceMap.localArchiveId,
    sourceMapSourceArchiveId: sourceMap.sourceArchiveId,
    imageLoadFailed: asset.imageLoadFailed,
    imageLoadFailedSrc: asset.imageLoadFailedSrc,
    metadataImageLoadFailed: metadata.imageLoadFailed,
    metadataImageLoadFailedAt: metadata.imageLoadFailedAt,
    metadataImageLoadFailedSrc: metadata.imageLoadFailedSrc,
    backendBaseUrl: factoryRuntimeBackendBaseUrl(),
    value: image,
  };
  factoryAssetDisplayImageCache.set(asset, cached);
  const id = factoryAssetDisplayImageCacheId(asset);
  if (!id) return;
  factoryAssetDisplayImageIdCache.delete(id);
  factoryAssetDisplayImageIdCache.set(id, cached);
  factoryTrimAssetDisplayImageIdCache();
}

function factoryForgetAssetDisplayImage(asset) {
  factoryAssetDisplayImageCache.delete(asset);
  const id = factoryAssetDisplayImageCacheId(asset);
  if (id) factoryAssetDisplayImageIdCache.delete(id);
}

function factoryAssetDisplayImage(asset) {
  if (!asset) return '';
  const cached = factoryCachedAssetDisplayImage(asset);
  if (factoryAssetDisplayImageCacheMatches(asset, cached)) return cached.value;

  factoryNormalizeAssetImageReference(asset);
  const directSources = [
    factoryRuntimeArchiveImageUrl(asset),
    asset.image,
    asset.dataUrl,
    asset.result,
    asset.metadata?.image,
    asset.metadata?.result,
    asset.metadata?.preview,
    asset.metadata?.dataUrl,
  ];
  let image = '';
  let cacheable = true;
  for (const source of directSources) {
    const candidate = factoryCoerceImageSrc(source);
    if (candidate) {
      image = candidate;
      cacheable = cacheable && typeof source === 'string';
      break;
    }
    if (source && typeof source !== 'string') cacheable = false;
  }
  if (!image) {
    image = factoryCoerceImageSrc(factorySourceCutResultForAsset(asset));
    cacheable = false;
  }
  const display = factoryAssetImageLoadFailedForSrc(asset, image) ? '' : image;
  if (cacheable) factoryRememberAssetDisplayImage(asset, display);
  else factoryForgetAssetDisplayImage(asset);
  return display;
}

function factoryAssetImageLoadFailedForSrc(asset, image = '') {
  if (!asset) return false;
  const meta = asset.metadata || {};
  const failed = !!(asset.imageLoadFailed || meta.imageLoadFailedAt || meta.imageLoadFailed);
  if (!failed) return false;
  const current = String(image || '').slice(0, 500);
  const failedSrc = String(asset.imageLoadFailedSrc || meta.imageLoadFailedSrc || '').slice(0, 500);
  return !current || !failedSrc || current === failedSrc;
}

function normalizeFactoryAsset(asset, index = 0) {
  const stageId = FACTORY_STAGE_DEFS.some(def => def.id === asset?.stageId) ? asset.stageId : 'cuts';
  const isHtmlAsset = asset?.type === 'html' || (stageId === 'detail' && typeof asset?.html === 'string' && /<[^>]+>/.test(asset.html));
  const image = factoryCoerceImageSrc(asset?.image) ||
    factoryCoerceImageSrc(asset?.dataUrl) ||
    factoryCoerceImageSrc(asset?.result) ||
    (isHtmlAsset ? '' : factoryCoerceImageSrc(asset)) ||
    null;
  const localArchive = asset?.localArchive && typeof asset.localArchive === 'object' ? cloneData(asset.localArchive) : null;
  const archiveId = String(asset?.archiveId || localArchive?.archiveId || asset?.metadata?.localArchiveId || asset?.sourceMap?.localArchiveId || asset?.sourceMap?.sourceArchiveId || '');
  return {
    id: asset?.id || uid(`factory_${stageId}`),
    stageId,
    type: asset?.type || (isHtmlAsset ? 'html' : (image ? 'image' : 'record')),
    title: String(asset?.title || `${factoryStageLabel(stageId)} 결과 ${index + 1}`),
    image,
    html: typeof asset?.html === 'string' ? asset.html : '',
    mime: asset?.mime || (image && /^data:([^;,]+)/.exec(String(image || ''))?.[1]) || 'image/png',
    prompt: typeof asset?.prompt === 'string' ? asset.prompt : '',
    imageUrl: typeof asset?.imageUrl === 'string' ? asset.imageUrl : '',
    thumbnailUrl: typeof asset?.thumbnailUrl === 'string' ? asset.thumbnailUrl : '',
    archiveId,
    archiveCopyPath: typeof asset?.archiveCopyPath === 'string' ? asset.archiveCopyPath : '',
    imagePersistence: typeof asset?.imagePersistence === 'string' ? asset.imagePersistence : '',
    metadata: cloneData(asset?.metadata || {}),
    sourceMap: cloneData(asset?.sourceMap || {}),
    parentAssetIds: Array.isArray(asset?.parentAssetIds) ? asset.parentAssetIds.filter(Boolean) : [],
    used: !!asset?.used,
    rejected: !!asset?.rejected,
    currentProductHidden: !!asset?.currentProductHidden,
    workspaceId: String(asset?.workspaceId || asset?.currentProjectId || asset?.projectId || asset?.metadata?.workspaceId || asset?.metadata?.currentProjectId || asset?.sourceMap?.workspaceId || asset?.sourceMap?.currentProjectId || localArchive?.workspaceId || ''),
    currentRunId: String(asset?.currentRunId || asset?.metadata?.currentRunId || asset?.sourceMap?.currentRunId || asset?.generationRunId || asset?.metadata?.generationRunId || asset?.sourceMap?.generationRunId || ''),
    productKey: String(asset?.productKey || asset?.metadata?.productKey || asset?.sourceMap?.productKey || asset?.metadata?.productIdentityKey || asset?.sourceMap?.productIdentityKey || ''),
    inputImageFingerprint: String(asset?.inputImageFingerprint || asset?.metadata?.inputImageFingerprint || asset?.sourceMap?.inputImageFingerprint || asset?.metadata?.inputImageKey || asset?.sourceMap?.inputImageKey || asset?.metadata?.sourceImageKey || asset?.sourceMap?.sourceImageKey || ''),
    generationRunId: String(asset?.generationRunId || asset?.metadata?.generationRunId || asset?.sourceMap?.generationRunId || asset?.currentRunId || asset?.metadata?.currentRunId || asset?.sourceMap?.currentRunId || ''),
    isolatedReason: typeof asset?.isolatedReason === 'string' ? asset.isolatedReason : '',
    isolatedAt: asset?.isolatedAt || null,
    placedSectionId: asset?.placedSectionId || '',
    assetKind: String(asset?.assetKind || asset?.metadata?.assetKind || asset?.sourceMap?.assetKind || ''),
    category: String(asset?.category || asset?.metadata?.category || asset?.sourceMap?.category || ''),
    categoryLabel: String(asset?.categoryLabel || asset?.metadata?.categoryLabel || asset?.sourceMap?.categoryLabel || ''),
    sectionId: String(asset?.sectionId || asset?.metadata?.sectionId || asset?.sourceMap?.sectionId || ''),
    archived: !!asset?.archived,
    archivedAt: asset?.archivedAt || null,
    localArchive,
    imageLoadFailed: !!(asset?.imageLoadFailed || asset?.metadata?.imageLoadFailedAt || asset?.metadata?.imageLoadFailed),
    imageLoadFailedSrc: String(asset?.imageLoadFailedSrc || asset?.metadata?.imageLoadFailedSrc || ''),
    hasImage: !!(image || asset?.hasImage),
    createdAt: asset?.createdAt || Date.now(),
  };
}

function factoryIsTechnicalCafe24StateKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase();
  return /^raw([._\s]|$)/i.test(raw) ||
    /(^|[._\s])raw([._\s]|$)/i.test(raw) ||
    /^rawproduct([._\s]|$)/i.test(raw) ||
    /^custom_cafe24api/i.test(raw) ||
    /^custom_cafe24.*raw/i.test(raw) ||
    /^cafe24_raw/i.test(normalized) ||
    /^cafe24api_raw/i.test(normalized);
}

function factorySanitizeCafe24ProductState(product = {}) {
  if (!product || typeof product !== 'object') return product;
  product.dbCustomFields = (Array.isArray(product.dbCustomFields) ? product.dbCustomFields : [])
    .filter(field => field && field.id && field.label)
    .filter(field => !factoryIsTechnicalRawDbField(field))
    .filter(field => ![
      field.id,
      field.label,
      field.sourceKey,
      field.sourceLabel,
    ].some(factoryIsTechnicalCafe24StateKey));
  if (product.dbFieldSettings && typeof product.dbFieldSettings === 'object') {
    Object.keys(product.dbFieldSettings).forEach(key => {
      if (factoryIsTechnicalCafe24StateKey(key)) delete product.dbFieldSettings[key];
    });
  }
  ['finalDb', 'confirmedDb'].forEach(key => {
    if (!product[key] || typeof product[key] !== 'object') return;
    Object.keys(product[key]).forEach(fieldKey => {
      if (factoryIsTechnicalCafe24StateKey(fieldKey)) delete product[key][fieldKey];
    });
  });
  return product;
}

const FACTORY_NORMALIZED_STATE_MARKER = '__factoryNormalizedStateV2';
const FACTORY_NORMALIZED_IDENTITY_MARKER = '__factoryNormalizedIdentityKeyV2';

function factoryNormalizationIdentityKey(source = {}) {
  const product = source?.product && typeof source.product === 'object' ? source.product : {};
  return factoryNormalizeIdentityText([
    product.userProductName,
    product.productName,
  ].map(value => String(value || '').trim()).find(Boolean) || '');
}

function factoryMarkNormalizedState(factory) {
  if (!factory || typeof factory !== 'object') return factory;
  try {
    Object.defineProperty(factory, FACTORY_NORMALIZED_STATE_MARKER, {
      value: true,
      enumerable: false,
      configurable: true,
    });
    Object.defineProperty(factory, FACTORY_NORMALIZED_IDENTITY_MARKER, {
      value: factoryNormalizationIdentityKey(factory),
      enumerable: false,
      configurable: true,
    });
  } catch(e) {
    factory[FACTORY_NORMALIZED_STATE_MARKER] = true;
    factory[FACTORY_NORMALIZED_IDENTITY_MARKER] = factoryNormalizationIdentityKey(factory);
  }
  return factory;
}

function factoryAlreadyNormalized(source = {}) {
  if (!source || typeof source !== 'object') return false;
  if (source[FACTORY_NORMALIZED_STATE_MARKER] !== true) return false;
  return String(source[FACTORY_NORMALIZED_IDENTITY_MARKER] || '') === factoryNormalizationIdentityKey(source);
}

function factoryWorkspaceIdentityFromSource(source = {}) {
  const workspace = source?.workspace && typeof source.workspace === 'object' ? source.workspace : {};
  const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const sourceMap = source?.sourceMap && typeof source.sourceMap === 'object' ? source.sourceMap : {};
  const localArchive = source?.localArchive && typeof source.localArchive === 'object' ? source.localArchive : {};
  const id = String(
    source?.workspaceId ||
    source?.currentProjectId ||
    source?.projectId ||
    workspace.id ||
    workspace.workspaceId ||
    workspace.projectId ||
    metadata.workspaceId ||
    metadata.currentProjectId ||
    sourceMap.workspaceId ||
    sourceMap.currentProjectId ||
    localArchive.workspaceId ||
    ''
  ).trim();
  const name = String(
    source?.workspaceName ||
    source?.currentProjectName ||
    source?.projectName ||
    workspace.name ||
    workspace.projectName ||
    metadata.workspaceName ||
    sourceMap.workspaceName ||
    ''
  ).trim();
  const createdAt = source?.workspaceCreatedAt || source?.currentProjectCreatedAt || workspace.createdAt || null;
  return { id, name, createdAt };
}

function factoryCurrentWorkspaceId(factory = factoryRuntimeReadFactory()) {
  const workspaceId = String(
    state.currentProjectId ||
    factoryWorkspaceIdentityFromSource(factory).id ||
    ''
  ).trim();
  if (workspaceId) return workspaceId;
  return typeof getCurrentLastWorkWorkspaceScope === 'function'
    ? String(getCurrentLastWorkWorkspaceScope() || '').trim()
    : '';
}

function factoryStampWorkspaceIdentity(factory, overrides = {}) {
  if (!factory || typeof factory !== 'object') return { id: '', name: '', createdAt: null };
  const current = factoryWorkspaceIdentityFromSource(factory);
  const id = String(overrides.projectId || overrides.workspaceId || state.currentProjectId || current.id || '').trim();
  const name = String(overrides.projectName || overrides.workspaceName || state.currentProjectName || current.name || '').trim();
  const createdAt = overrides.createdAt || state.currentProjectCreatedAt || current.createdAt || null;
  factory.workspace = {
    ...(factory.workspace && typeof factory.workspace === 'object' ? factory.workspace : {}),
    id,
    name,
    createdAt,
    updatedAt: Date.now(),
  };
  factory.currentProjectId = id;
  factory.currentProjectName = name;
  return factory.workspace;
}

function factoryStampItemWorkspaceIdentity(item = {}, workspaceId = '', options = {}) {
  if (!item || typeof item !== 'object' || !workspaceId) return;
  const previousWorkspaceId = String(options.previousWorkspaceId || '').trim();
  const currentItemWorkspaceId = factoryAssetWorkspaceId(item);
  if (!options.force && currentItemWorkspaceId && previousWorkspaceId && currentItemWorkspaceId !== previousWorkspaceId) return;
  if (!options.force && currentItemWorkspaceId && !previousWorkspaceId && currentItemWorkspaceId !== workspaceId) return;
  item.workspaceId = workspaceId;
  item.currentProjectId = workspaceId;
  if (item.metadata && typeof item.metadata === 'object') {
    item.metadata.workspaceId = workspaceId;
    item.metadata.currentProjectId = workspaceId;
  }
  if (item.sourceMap && typeof item.sourceMap === 'object') {
    item.sourceMap.workspaceId = workspaceId;
    item.sourceMap.currentProjectId = workspaceId;
  }
  if (item.localArchive && typeof item.localArchive === 'object') {
    item.localArchive.workspaceId = workspaceId;
  }
}

function factoryStampFactoryItemsWorkspaceIdentity(factory = factoryRuntimeReadFactory(), workspaceId = '', options = {}) {
  if (!factory || typeof factory !== 'object' || !workspaceId) return;
  ['assets', 'previousAssets'].forEach(key => {
    if (Array.isArray(factory[key])) {
      factory[key].forEach(item => factoryStampItemWorkspaceIdentity(item, workspaceId, options));
    }
  });
  if (Array.isArray(factory.archive?.localAssets)) {
    factory.archive.localAssets.forEach(item => factoryStampItemWorkspaceIdentity(item, workspaceId, options));
  }
  if (Array.isArray(factory.product?.competitors)) {
    factory.product.competitors.forEach(item => factoryStampItemWorkspaceIdentity(item, workspaceId, options));
  }
}

function factoryReviewCandidateWorkspaceId(value = {}) {
  if (!value || typeof value !== 'object') return '';
  const structuredKeys = [
    value.reviewProductScopeKey,
    value.reviewProductIdentityKey,
    value.candidateProductIdentityKey,
  ];
  for (const rawKey of structuredKeys) {
    const parts = String(rawKey || '').trim().split('::');
    if (parts.length === 3 && parts[2] === 'candidate-review' && parts[0]) return parts[0].trim();
    if (parts.length === 5 && parts[4] === 'candidate-review' && parts[0]) return parts[0].trim();
  }
  return '';
}

function factoryMigrateReviewCandidateWorkspaceScope(factory = factoryRuntimeReadFactory(), previousWorkspaceId = '', nextWorkspaceId = '') {
  if (!factory || typeof factory !== 'object') return 0;
  const previousId = String(previousWorkspaceId || '').trim();
  const nextId = String(nextWorkspaceId || '').trim();
  const currentProductKey = factoryCurrentProductKey(factory);
  if (!previousId || !nextId || previousId === nextId || !currentProductKey) return 0;
  const nextScopeKey = `${nextId}::${currentProductKey}::candidate-review`;
  const candidateKeys = ['dbCandidates', 'pendingDbCandidates', 'cafe24Candidates', 'pendingCafe24Candidates'];
  const migratedCandidates = new Set();
  candidateKeys.forEach(key => {
    const candidates = factory.product?.[key];
    if (!Array.isArray(candidates)) return;
    candidates.forEach(candidate => {
      if (!candidate || typeof candidate !== 'object' || migratedCandidates.has(candidate)) return;
      const candidateWorkspaceId = factoryReviewCandidateWorkspaceId(candidate);
      const candidateProductKey = factoryReviewCandidateProductKey(candidate);
      if (candidateWorkspaceId !== previousId || candidateProductKey !== currentProductKey) return;
      candidate.reviewProductScopeKey = nextScopeKey;
      const identityParts = String(candidate.reviewProductIdentityKey || '').trim().split('::');
      if (identityParts.length === 5 && identityParts[0] === previousId && identityParts[2] === currentProductKey && identityParts[4] === 'candidate-review') {
        identityParts[0] = nextId;
        candidate.reviewProductIdentityKey = identityParts.join('::');
      }
      migratedCandidates.add(candidate);
    });
  });
  return migratedCandidates.size;
}

function factoryRecoverRestoredReviewCandidateWorkspaceScope(factory = factoryRuntimeReadFactory(), sourceWorkspaceId = '', nextWorkspaceId = '', options = {}) {
  if (!factory || typeof factory !== 'object') return 0;
  const sourceId = String(sourceWorkspaceId || '').trim();
  const nextId = String(nextWorkspaceId || '').trim();
  const product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  const productNameKey = factoryNormalizeIdentityText(product.userProductName || product.productName || '');
  const explicitProductKey = [
    product.currentProductKey,
    product.productKey,
    product.productIdentityKey,
    product.lockedProductKey,
  ].map(value => factoryNormalizeIdentityText(value || '')).find(key =>
    key && (!productNameKey || factoryIdentityKeysCompatible(key, productNameKey))
  );
  const fallbackProductKey = factoryNormalizeIdentityText(options?.productName || '');
  const currentProductKey = explicitProductKey || productNameKey || fallbackProductKey;
  if (!nextId || !currentProductKey) return 0;
  const nextScopeKey = `${nextId}::${currentProductKey}::candidate-review`;
  const candidateKeys = ['dbCandidates', 'pendingDbCandidates', 'cafe24Candidates', 'pendingCafe24Candidates'];
  const migratedCandidates = new Set();
  candidateKeys.forEach(key => {
    const candidates = factory.product?.[key];
    if (!Array.isArray(candidates)) return;
    candidates.forEach(candidate => {
      if (!candidate || typeof candidate !== 'object' || migratedCandidates.has(candidate)) return;
      const candidateWorkspaceId = factoryReviewCandidateWorkspaceId(candidate);
      const candidateProductKey = factoryReviewCandidateProductKey(candidate);
      const belongsToRestoredWorkspace = !!sourceId && sourceId !== nextId && candidateWorkspaceId === sourceId;
      const isLegacyDraftWorkspace = /^(?:draft|lastwork)(?:[:_-]|$)/i.test(candidateWorkspaceId);
      if ((!belongsToRestoredWorkspace && !isLegacyDraftWorkspace) || candidateProductKey !== currentProductKey) return;
      candidate.reviewProductScopeKey = nextScopeKey;
      const identityParts = String(candidate.reviewProductIdentityKey || '').trim().split('::');
      if (identityParts.length === 5 && identityParts[0] === candidateWorkspaceId && identityParts[2] === currentProductKey && identityParts[4] === 'candidate-review') {
        identityParts[0] = nextId;
        candidate.reviewProductIdentityKey = identityParts.join('::');
      }
      migratedCandidates.add(candidate);
    });
  });
  return migratedCandidates.size;
}

function factoryAssetWorkspaceId(asset = {}) {
  return factoryWorkspaceIdentityFromSource(asset).id;
}

function factoryReconcileRestoredCompletionState(factory = {}, payload = {}) {
  factory.automation = factory.automation && typeof factory.automation === 'object'
    ? factory.automation
    : {};
  factory.goalRun = factory.goalRun && typeof factory.goalRun === 'object'
    ? factory.goalRun
    : {};
  factory.stages = factory.stages && typeof factory.stages === 'object'
    ? factory.stages
    : {};
  factory.automation.activeTaskId = '';
  factory.goalRun.running = false;
  factory.goalRun.activeOperationId = '';

  const sectionOrder = Array.isArray(payload.sectionOrder)
    ? payload.sectionOrder.filter(Boolean)
    : [];
  const sectionContents = payload.sectionContents && typeof payload.sectionContents === 'object'
    ? payload.sectionContents
    : {};
  const sectionImages = payload.sectionImages && typeof payload.sectionImages === 'object'
    ? payload.sectionImages
    : {};
  const defaultSectionOrder = typeof SECTIONS !== 'undefined' && Array.isArray(SECTIONS)
    ? SECTIONS.map(section => section?.id).filter(Boolean)
    : [];
  const requiredSectionOrder = sectionOrder.length ? sectionOrder : defaultSectionOrder;
  const hasPersistedOutput = value => {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, item]) => {
      if (key.startsWith('__')) return false;
      if (typeof item === 'string') return item.trim().length > 0;
      if (Array.isArray(item)) return item.length > 0;
      if (item && typeof item === 'object') return Object.keys(item).length > 0;
      return item !== null && item !== undefined && item !== false;
    });
  };
  const completed = requiredSectionOrder.length > 0
    && requiredSectionOrder.every(sectionId => (
      hasPersistedOutput(sectionContents[sectionId])
      || hasPersistedOutput(sectionImages[sectionId])
    ));
  if (!completed) return factory;

  const detailStage = factory.stages.detail;
  if (detailStage && detailStage.status === 'running') {
    detailStage.status = 'done';
    detailStage.message = '저장된 상세페이지 섹션 복원 완료';
  }
  const staleRecoveryText = `${factory.goalRun.currentStage || ''} ${factory.goalRun.failureReason || ''}`;
  if (/후보 선택 대기|이전 실행의 후보\/이미지는 보존했습니다/.test(staleRecoveryText)) {
    factory.goalRun.progress = 100;
    factory.goalRun.currentStage = '완료된 작업 복원';
    factory.goalRun.failureReason = '';
  }
  return factory;
}

function factoryReconcilePersistedStageState(factory = {}, options = {}) {
  if (!factory || typeof factory !== 'object') return factory;
  const product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  const activeState = typeof state !== 'undefined' && state && typeof state === 'object' ? state : {};
  const hasEntries = value => {
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (!value || typeof value !== 'object') return !!value;
    return Object.values(value).some(item => hasEntries(item));
  };
  const countRows = (...rows) => rows.reduce((sum, row) => sum + (Array.isArray(row) ? row.length : 0), 0);
  const dbCandidates = Array.isArray(product.dbCandidates) ? product.dbCandidates : [];
  const pendingDbCandidates = Array.isArray(product.pendingDbCandidates) ? product.pendingDbCandidates : [];
  const cafe24Candidates = Array.isArray(product.cafe24Candidates) ? product.cafe24Candidates : [];
  const pendingCafe24Candidates = Array.isArray(product.pendingCafe24Candidates) ? product.pendingCafe24Candidates : [];
  const dbReady = !!String(product.selectedDbCandidateKey || '').trim()
    || product.dbCandidateResolution === 'none'
    || hasEntries(product.confirmedDb);
  const cafe24Ready = !!String(
    product.selectedCafe24CandidateKey
      || product.confirmedCafe24ProductKey
      || product.cafe24DraftProductKey
      || '',
  ).trim()
    || product.cafe24CandidateResolution === 'none';
  const dbEvidence = dbReady || dbCandidates.length > 0 || pendingDbCandidates.length > 0;
  const cafe24Evidence = cafe24Ready || cafe24Candidates.length > 0 || pendingCafe24Candidates.length > 0;
  const market = activeState.compPage?.marketScrape && typeof activeState.compPage.marketScrape === 'object'
    ? activeState.compPage.marketScrape
    : {};
  const vmRows = countRows(
    market.vmResults,
    market.vmLocalResults,
    Object.values(market.vmGroupedResults || {}),
    Object.values(market.vmLocalGroupedResults || {}),
  );
  const vmScrapedImages = Array.isArray(market.scrapedImages) ? market.scrapedImages.length : 0;
  const vmReady = vmRows > 0 || vmScrapedImages > 0 || (Array.isArray(product.competitors) && product.competitors.length > 0);

  const sectionIds = (() => {
    const ordered = Array.isArray(activeState.sectionOrder) ? activeState.sectionOrder.filter(Boolean) : [];
    if (ordered.length) return ordered;
    if (typeof orderedSections === 'function') {
      try { return orderedSections().map(section => section?.id).filter(Boolean); } catch (_) {}
    }
    return [];
  })();
  const outputFor = id => hasEntries(activeState.sectionContents?.[id]) || hasEntries(activeState.sectionImages?.[id]);
  const generatedSections = sectionIds.filter(outputFor).length;
  const detailAssets = (Array.isArray(factory.assets) ? factory.assets : []).filter(asset =>
    asset?.stageId === 'detail'
    && (hasEntries(asset.html) || hasEntries(asset.image) || hasEntries(asset.dataUrl) || hasEntries(asset.result) || hasEntries(asset.archiveId))
  ).length;

  let next = factory;
  let stages = factory.stages;
  let automation = factory.automation;
  let parallelProgress = automation?.parallelProgress;
  const ensureStageCopy = () => {
    if (next === factory) next = { ...factory };
    if (stages === factory.stages) stages = { ...(factory.stages || {}) };
    next.stages = stages;
    if (!stages.db) stages.db = {};
    if (!stages.detail) stages.detail = {};
  };
  const ensureAutomationCopy = () => {
    if (next === factory) next = { ...factory };
    if (automation === factory.automation) automation = { ...(factory.automation || {}) };
    if (parallelProgress === factory.automation?.parallelProgress) parallelProgress = { ...(factory.automation?.parallelProgress || {}) };
    automation.parallelProgress = parallelProgress;
    next.automation = automation;
  };
  const patchStage = (stageId, patch) => {
    const current = next.stages?.[stageId] || {};
    const currentStatus = String(current.status || 'idle');
    if (['running', 'blocked', 'error'].includes(currentStatus)) return;
    if (currentStatus === 'done' && patch.status !== 'done') return;
    const changed = Object.entries(patch).some(([key, value]) => current[key] !== value);
    if (!changed) return;
    ensureStageCopy();
    stages[stageId] = { ...current, ...patch, updatedAt: current.updatedAt || Date.now() };
  };
  const patchParallel = (taskId, patch) => {
    const current = next.automation?.parallelProgress?.[taskId] || {};
    const currentStatus = String(current.status || 'queued');
    if (['running', 'error'].includes(currentStatus)) return;
    if (currentStatus === 'done' && patch.status !== 'done') return;
    const changed = Object.entries(patch).some(([key, value]) => current[key] !== value);
    if (!changed) return;
    ensureAutomationCopy();
    parallelProgress[taskId] = { ...current, ...patch, updatedAt: current.updatedAt || Date.now() };
  };

  if (dbReady || cafe24Ready) {
    patchParallel('sinhwa', dbReady
      ? { status: 'done', progress: 100, completedItemCount: 1, expectedItemCount: 1, message: `후보 ${dbCandidates.length || (product.dbCandidateResolution === 'none' ? 0 : 1)}건 확정` }
      : { status: 'queued', progress: 0 });
    patchParallel('cafe24', cafe24Ready
      ? { status: 'done', progress: 100, completedItemCount: 1, expectedItemCount: 1, message: `후보 ${cafe24Candidates.length || (product.cafe24CandidateResolution === 'none' ? 0 : 1)}건 확정` }
      : { status: 'queued', progress: 0 });
  }
  if (vmReady) {
    patchParallel('vm', {
      status: 'done',
      progress: 100,
      completedItemCount: 1,
      expectedItemCount: 1,
      message: `후보 ${Math.max(vmRows, vmScrapedImages, product.competitors?.length || 0)}건 확인`,
    });
  }
  if (dbReady && cafe24Ready) {
    patchStage('db', {
      status: 'done',
      message: `신화사DB ${product.dbCandidateResolution === 'none' ? '신제품' : `${dbCandidates.length}건`}, Cafe24 ${product.cafe24CandidateResolution === 'none' ? '신제품' : `${cafe24Candidates.length}건`} 후보 검토 완료`,
    });
  } else if (dbEvidence || cafe24Evidence) {
    patchStage('db', {
      status: 'review',
      message: `${dbEvidence && !dbReady ? '신화사DB 후보 선택' : ''}${dbEvidence && !dbReady && cafe24Evidence && !cafe24Ready ? ', ' : ''}${cafe24Evidence && !cafe24Ready ? 'Cafe24 후보 선택' : ''} 대기 중입니다.`,
    });
  }

  if (generatedSections > 0 || detailAssets > 0) {
    const detailTarget = Math.max(1, sectionIds.length || detailAssets || Number(next.stages?.detail?.targetCount) || 1);
    const detailCompleted = sectionIds.length ? generatedSections : Math.min(detailTarget, detailAssets);
    const detailDone = detailCompleted >= detailTarget;
    patchStage('detail', {
      status: detailDone ? 'done' : String(next.stages?.detail?.status || 'idle'),
      message: sectionIds.length
        ? `상세페이지 섹션 ${detailCompleted}/${detailTarget}개 복원`
        : `상세페이지 자산 ${detailCompleted}개 복원`,
      targetCount: Math.max(Number(next.stages?.detail?.targetCount) || 1, detailTarget),
      completedItemCount: Math.max(Number(next.stages?.detail?.completedItemCount) || 0, detailCompleted),
    });
  }
  return next;
}

function factoryNormalizePersistedFactoryLogs(logs = []) {
  const bounded = Array.isArray(logs) ? logs.slice(-80) : [];
  const seenSyncWarnings = new Set();
  return bounded.filter(log => {
    const message = String(log?.message || '');
    if (!message.includes('로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다')) return true;
    const key = message;
    if (seenSyncWarnings.has(key)) return false;
    seenSyncWarnings.add(key);
    return true;
  });
}

function normalizeFactoryState(saved) {
  if (factoryAlreadyNormalized(saved)) {
    const logs = factoryNormalizePersistedFactoryLogs(saved.logs);
    if (logs.length !== (Array.isArray(saved.logs) ? saved.logs.length : 0)) saved.logs = logs;
    return saved;
  }
  const base = defaultFactoryState();
  const source = saved && typeof saved === 'object' ? saved : {};
  const product = source.product && typeof source.product === 'object' ? source.product : {};
  const goal = source.goalRun && typeof source.goalRun === 'object' ? source.goalRun : {};
  const archive = source.archive && typeof source.archive === 'object' ? source.archive : {};
  const openMarket = source.openMarketSync && typeof source.openMarketSync === 'object' ? source.openMarketSync : {};
  const workspaceIdentity = factoryWorkspaceIdentityFromSource(source);
  const normalized = {
    ...base,
    ...source,
    workspace: {
      ...base.workspace,
      ...(source.workspace && typeof source.workspace === 'object' ? source.workspace : {}),
      id: workspaceIdentity.id,
      name: workspaceIdentity.name,
      createdAt: workspaceIdentity.createdAt,
      updatedAt: Number.isFinite(Number(source.workspace?.updatedAt)) ? Number(source.workspace.updatedAt) : null,
    },
    currentProjectId: workspaceIdentity.id,
    currentProjectName: workspaceIdentity.name,
    product: {
      ...base.product,
      ...product,
      productName: typeof product.productName === 'string' ? product.productName : '',
      userProductName: typeof product.userProductName === 'string' ? product.userProductName : '',
      naturalHint: typeof product.naturalHint === 'string' ? product.naturalHint : '',
      imageBase64: product.imageBase64 || null,
      imageMime: product.imageMime || '',
      imagePreview: product.imagePreview || null,
      imageName: typeof product.imageName === 'string' ? product.imageName : '',
      lockedInputImageFingerprint: typeof product.lockedInputImageFingerprint === 'string' ? product.lockedInputImageFingerprint : '',
      lockedInputImageName: typeof product.lockedInputImageName === 'string' ? product.lockedInputImageName : '',
      lockedInputImageMime: typeof product.lockedInputImageMime === 'string' ? product.lockedInputImageMime : '',
      lockedInputImageSetAt: Number.isFinite(Number(product.lockedInputImageSetAt)) ? Number(product.lockedInputImageSetAt) : null,
      inputImages: Array.isArray(product.inputImages) ? product.inputImages : [],
      analysis: product.analysis || null,
      confirmedDb: product.confirmedDb || null,
      finalDb: product.finalDb && typeof product.finalDb === 'object' ? product.finalDb : null,
      dbFieldSettings: product.dbFieldSettings && typeof product.dbFieldSettings === 'object' ? product.dbFieldSettings : {},
      dbCustomFields: Array.isArray(product.dbCustomFields) ? product.dbCustomFields : [],
      dbFieldPresetId: typeof product.dbFieldPresetId === 'string' ? product.dbFieldPresetId : '',
      dbCandidates: Array.isArray(product.dbCandidates) ? product.dbCandidates : [],
      cafe24Candidates: Array.isArray(product.cafe24Candidates) ? product.cafe24Candidates : [],
      pendingDbCandidates: Array.isArray(product.pendingDbCandidates) ? product.pendingDbCandidates : [],
      pendingCafe24Candidates: Array.isArray(product.pendingCafe24Candidates) ? product.pendingCafe24Candidates : [],
      candidateAutoApply: !!product.candidateAutoApply,
      candidateReviewStatus: typeof product.candidateReviewStatus === 'string' ? product.candidateReviewStatus : '',
      // 신원 불일치로 떼어낸 이전 DB/Cafe24 선택. 되돌리기 전까지 보관한다.
      detachedDbSelection: product.detachedDbSelection && typeof product.detachedDbSelection === 'object'
        ? product.detachedDbSelection
        : null,
      sinhwaDbProgramStatus: product.sinhwaDbProgramStatus && typeof product.sinhwaDbProgramStatus === 'object' ? product.sinhwaDbProgramStatus : null,
      selectedDbCandidateKey: typeof product.selectedDbCandidateKey === 'string' ? product.selectedDbCandidateKey : '',
      selectedCafe24CandidateKey: typeof product.selectedCafe24CandidateKey === 'string' ? product.selectedCafe24CandidateKey : '',
      dbCandidateResolution: ['selected', 'none'].includes(product.dbCandidateResolution) ? product.dbCandidateResolution : '',
      cafe24CandidateResolution: ['selected', 'none'].includes(product.cafe24CandidateResolution) ? product.cafe24CandidateResolution : '',
      cafe24ApiCatalog: Array.isArray(product.cafe24ApiCatalog) ? product.cafe24ApiCatalog : [],
      cafe24ApiLastFetchedAt: Number.isFinite(product.cafe24ApiLastFetchedAt) ? product.cafe24ApiLastFetchedAt : null,
      cafe24ApiStatus: typeof product.cafe24ApiStatus === 'string' ? product.cafe24ApiStatus : '',
      cafe24EndpointHealth: Array.isArray(product.cafe24EndpointHealth) ? product.cafe24EndpointHealth : [],
      cafe24EndpointHealthFetchedAt: Number.isFinite(product.cafe24EndpointHealthFetchedAt) ? product.cafe24EndpointHealthFetchedAt : null,
      cafe24EndpointHealthProductNo: typeof product.cafe24EndpointHealthProductNo === 'string' ? product.cafe24EndpointHealthProductNo : '',
      cafe24ReferenceLists: product.cafe24ReferenceLists && typeof product.cafe24ReferenceLists === 'object' ? product.cafe24ReferenceLists : {},
      cafe24ReferenceFetchedAt: Number.isFinite(product.cafe24ReferenceFetchedAt) ? product.cafe24ReferenceFetchedAt : null,
      cafe24ReferenceStatus: typeof product.cafe24ReferenceStatus === 'string' ? product.cafe24ReferenceStatus : '',
      cafe24ReferenceLoading: !!product.cafe24ReferenceLoading,
      cafe24ReferenceAutoTried: !!product.cafe24ReferenceAutoTried,
      cafe24DraftProductKey: typeof product.cafe24DraftProductKey === 'string' ? product.cafe24DraftProductKey : '',
      cafe24VariantCatalog: Array.isArray(product.cafe24VariantCatalog) ? product.cafe24VariantCatalog : [],
      cafe24VariantCatalogProductNo: typeof product.cafe24VariantCatalogProductNo === 'string' ? product.cafe24VariantCatalogProductNo : '',
      cafe24VariantEdits: product.cafe24VariantEdits && typeof product.cafe24VariantEdits === 'object' ? product.cafe24VariantEdits : {},
      cafe24OptionGroupsDraft: Array.isArray(product.cafe24OptionGroupsDraft) ? product.cafe24OptionGroupsDraft : [],
      cafe24OptionExtrasDraft: product.cafe24OptionExtrasDraft && typeof product.cafe24OptionExtrasDraft === 'object' ? product.cafe24OptionExtrasDraft : {},
      cafe24OptionContextMatch: product.cafe24OptionContextMatch && typeof product.cafe24OptionContextMatch === 'object' ? product.cafe24OptionContextMatch : null,
      cafe24OptionContextMatchBusy: false,
      cafe24ImageDraft: product.cafe24ImageDraft && typeof product.cafe24ImageDraft === 'object' ? product.cafe24ImageDraft : {},
      cafe24IconDraft: product.cafe24IconDraft && typeof product.cafe24IconDraft === 'object' ? product.cafe24IconDraft : {},
      cafe24RelationDraft: product.cafe24RelationDraft && typeof product.cafe24RelationDraft === 'object' ? product.cafe24RelationDraft : {},
      cafe24MemoDraft: product.cafe24MemoDraft && typeof product.cafe24MemoDraft === 'object' ? product.cafe24MemoDraft : {},
      cafe24MainDraft: product.cafe24MainDraft && typeof product.cafe24MainDraft === 'object' ? product.cafe24MainDraft : {},
      cafe24PromotionDraft: product.cafe24PromotionDraft && typeof product.cafe24PromotionDraft === 'object' ? product.cafe24PromotionDraft : {},
      cafe24SeoDraft: product.cafe24SeoDraft && typeof product.cafe24SeoDraft === 'object' ? product.cafe24SeoDraft : {},
      cafe24TagsDraft: product.cafe24TagsDraft && typeof product.cafe24TagsDraft === 'object' ? product.cafe24TagsDraft : {},
      cafe24LastSaveVerification: product.cafe24LastSaveVerification && typeof product.cafe24LastSaveVerification === 'object' ? product.cafe24LastSaveVerification : null,
      cafe24SyncResults: product.cafe24SyncResults && typeof product.cafe24SyncResults === 'object' ? product.cafe24SyncResults : {},
      cafe24AutoSendOnSave: product.cafe24AutoSendOnSave !== false,
      dbInputSavedAt: Number.isFinite(Number(product.dbInputSavedAt)) ? Number(product.dbInputSavedAt) : null,
      dbInputSnapshots: Array.isArray(product.dbInputSnapshots) ? product.dbInputSnapshots.slice(0, 30).filter(item => item && typeof item === 'object') : [],
      sourcePanelState: {
        cafe24Collapsed: !!product.sourcePanelState?.cafe24Collapsed,
        sinhwaCollapsed: !!product.sourcePanelState?.sinhwaCollapsed,
        cafe24CollapsedSections: Array.isArray(product.sourcePanelState?.cafe24CollapsedSections) ? product.sourcePanelState.cafe24CollapsedSections.filter(Boolean) : [],
        sinhwaCollapsedSections: Array.isArray(product.sourcePanelState?.sinhwaCollapsedSections) ? product.sourcePanelState.sinhwaCollapsedSections.filter(Boolean) : [],
      },
      competitors: Array.isArray(product.competitors) ? product.competitors : [],
      competitorSource: typeof product.competitorSource === 'string' ? product.competitorSource : '',
      dbLocked: !!product.dbLocked,
    },
    stages: normalizeFactoryStageState(source.stages),
    assets: (Array.isArray(source.assets) ? source.assets : []).map(normalizeFactoryAsset),
    previousAssets: (Array.isArray(source.previousAssets) ? source.previousAssets : []).map(normalizeFactoryAsset),
    previousAssetsExpanded: source.previousAssetsExpanded && typeof source.previousAssetsExpanded === 'object' ? source.previousAssetsExpanded : {},
    detailPlacement: source.detailPlacement && typeof source.detailPlacement === 'object' ? source.detailPlacement : {},
    detailMode: ['db', 'competitor', 'mixed'].includes(source.detailMode) ? source.detailMode : 'mixed',
    uiPanels: {
      ...base.uiPanels,
      ...(source.uiPanels && typeof source.uiPanels === 'object' ? source.uiPanels : {}),
      materials: !!source.uiPanels?.materials,
      assets: !!source.uiPanels?.assets,
    },
    automation: {
      ...base.automation,
      ...(source.automation && typeof source.automation === 'object' ? source.automation : {}),
      activeTab: ['start', 'db', 'fields', 'competitor', 'assets', 'sections', 'publish'].includes(source.automation?.activeTab)
        ? source.automation.activeTab
        : (source.automation?.activeTab === 'materials'
          ? 'start'
          : source.automation?.activeTab === 'collect'
            ? 'db'
            : source.automation?.activeTab === 'generate'
              ? 'assets'
              : source.automation?.activeTab === 'publish'
                ? 'publish'
                : 'start'),
      activeTaskId: typeof source.automation?.activeTaskId === 'string' ? source.automation.activeTaskId : '',
      confirmedTasks: source.automation?.confirmedTasks && typeof source.automation.confirmedTasks === 'object' ? source.automation.confirmedTasks : {},
      skippedTasks: source.automation?.skippedTasks && typeof source.automation.skippedTasks === 'object' ? source.automation.skippedTasks : {},
      fieldReview: source.automation?.fieldReview && typeof source.automation.fieldReview === 'object' ? source.automation.fieldReview : {},
      sectionPromptPlan: source.automation?.sectionPromptPlan && typeof source.automation.sectionPromptPlan === 'object' ? source.automation.sectionPromptPlan : {},
      parallelProgress: source.automation?.parallelProgress && typeof source.automation.parallelProgress === 'object' ? source.automation.parallelProgress : {},
      startRunCounts: source.automation?.startRunCounts && typeof source.automation.startRunCounts === 'object' ? source.automation.startRunCounts : {},
      startRunScopeKey: typeof source.automation?.startRunScopeKey === 'string' ? source.automation.startRunScopeKey : '',
      dbSearchQuery: typeof source.automation?.dbSearchQuery === 'string' ? source.automation.dbSearchQuery : '',
      lastWizardActionAt: Number.isFinite(Number(source.automation?.lastWizardActionAt)) ? Number(source.automation.lastWizardActionAt) : null,
      competitorMode: ['preset', 'manual', 'auto'].includes(source.automation?.competitorMode) ? source.automation.competitorMode : 'preset',
      optionMode: ['pending', 'provided', 'none'].includes(source.automation?.optionMode) ? source.automation.optionMode : 'pending',
      cutMode: ['pending', 'provided', 'generate', 'none'].includes(source.automation?.cutMode) ? source.automation.cutMode : 'pending',
      updatedAt: Number.isFinite(Number(source.automation?.updatedAt)) ? Number(source.automation.updatedAt) : null,
    },
    openMarketSync: {
      ...base.openMarketSync,
      ...openMarket,
      mode: ['cafe24_marketplus', 'direct_api'].includes(openMarket.mode) ? openMarket.mode : 'cafe24_marketplus',
      selectedChannels: Array.isArray(openMarket.selectedChannels) ? openMarket.selectedChannels.filter(Boolean) : base.openMarketSync.selectedChannels,
      channelStatus: openMarket.channelStatus && typeof openMarket.channelStatus === 'object' ? openMarket.channelStatus : {},
      marketPlusStatus: openMarket.marketPlusStatus && typeof openMarket.marketPlusStatus === 'object' ? openMarket.marketPlusStatus : null,
      marketPlusAction: openMarket.marketPlusAction && typeof openMarket.marketPlusAction === 'object' ? openMarket.marketPlusAction : null,
      marketPlusDetailStatus: openMarket.marketPlusDetailStatus && typeof openMarket.marketPlusDetailStatus === 'object' ? openMarket.marketPlusDetailStatus : null,
      marketPlusCategoryFields: openMarket.marketPlusCategoryFields && typeof openMarket.marketPlusCategoryFields === 'object' ? openMarket.marketPlusCategoryFields : null,
      marketPlusCategoryApply: openMarket.marketPlusCategoryApply && typeof openMarket.marketPlusCategoryApply === 'object' ? openMarket.marketPlusCategoryApply : null,
      marketPlusSendLimitStatus: openMarket.marketPlusSendLimitStatus && typeof openMarket.marketPlusSendLimitStatus === 'object' ? openMarket.marketPlusSendLimitStatus : null,
      marketPlusSendLimitAction: openMarket.marketPlusSendLimitAction && typeof openMarket.marketPlusSendLimitAction === 'object' ? openMarket.marketPlusSendLimitAction : null,
      marketPlusCafe24LinkageStatus: openMarket.marketPlusCafe24LinkageStatus && typeof openMarket.marketPlusCafe24LinkageStatus === 'object' ? openMarket.marketPlusCafe24LinkageStatus : null,
      marketPlusUrl: typeof openMarket.marketPlusUrl === 'string' ? openMarket.marketPlusUrl : '',
      drafts: openMarket.drafts && typeof openMarket.drafts === 'object' ? openMarket.drafts : {},
      dryRuns: openMarket.dryRuns && typeof openMarket.dryRuns === 'object' ? openMarket.dryRuns : {},
      browserAutomation: openMarket.browserAutomation && typeof openMarket.browserAutomation === 'object' ? openMarket.browserAutomation : null,
      browserSnapshot: openMarket.browserSnapshot && typeof openMarket.browserSnapshot === 'object' ? openMarket.browserSnapshot : null,
      logs: Array.isArray(openMarket.logs) ? openMarket.logs.slice(0, 80) : [],
      loading: false,
      status: typeof openMarket.status === 'string' ? openMarket.status : '',
      lastCheckedAt: Number.isFinite(Number(openMarket.lastCheckedAt)) ? Number(openMarket.lastCheckedAt) : null,
      lastDraftedAt: Number.isFinite(Number(openMarket.lastDraftedAt)) ? Number(openMarket.lastDraftedAt) : null,
      lastDryRunAt: Number.isFinite(Number(openMarket.lastDryRunAt)) ? Number(openMarket.lastDryRunAt) : null,
      lastBrowserCheckedAt: Number.isFinite(Number(openMarket.lastBrowserCheckedAt)) ? Number(openMarket.lastBrowserCheckedAt) : null,
      lastBrowserSnapshotAt: Number.isFinite(Number(openMarket.lastBrowserSnapshotAt)) ? Number(openMarket.lastBrowserSnapshotAt) : null,
      lastMarketPlusStartedAt: Number.isFinite(Number(openMarket.lastMarketPlusStartedAt)) ? Number(openMarket.lastMarketPlusStartedAt) : null,
      lastMarketPlusDetailCheckedAt: Number.isFinite(Number(openMarket.lastMarketPlusDetailCheckedAt)) ? Number(openMarket.lastMarketPlusDetailCheckedAt) : null,
      lastMarketPlusCategoryCheckedAt: Number.isFinite(Number(openMarket.lastMarketPlusCategoryCheckedAt)) ? Number(openMarket.lastMarketPlusCategoryCheckedAt) : null,
      lastMarketPlusSendLimitCheckedAt: Number.isFinite(Number(openMarket.lastMarketPlusSendLimitCheckedAt)) ? Number(openMarket.lastMarketPlusSendLimitCheckedAt) : null,
      lastMarketPlusCafe24LinkageCheckedAt: Number.isFinite(Number(openMarket.lastMarketPlusCafe24LinkageCheckedAt)) ? Number(openMarket.lastMarketPlusCafe24LinkageCheckedAt) : null,
    },
    activeStage: FACTORY_STAGE_DEFS.some(def => def.id === source.activeStage) ? source.activeStage : 'db',
    logs: factoryNormalizePersistedFactoryLogs(source.logs),
    cafe24FieldView: factoryNormalizeCafe24FieldView(source.cafe24FieldView, base.cafe24FieldView),
    goalRun: {
      ...base.goalRun,
      ...goal,
      running: (String(factoryLiveGoalOperationId || '').trim()
        && String(goal.activeOperationId || '').trim() === String(factoryLiveGoalOperationId || '').trim())
        ? !!goal.running
        : false,
      mode: goal.mode === 'auto' ? 'auto' : 'review',
      progress: Math.max(0, Math.min(100, Number(goal.progress) || 0)),
      loopCount: Math.max(0, Number.parseInt(goal.loopCount, 10) || 0),
      maxLoops: Math.max(1, Math.min(20, Number.parseInt(goal.maxLoops, 10) || base.goalRun.maxLoops)),
      targets: {
        ...base.goalRun.targets,
        ...(goal.targets && typeof goal.targets === 'object' ? goal.targets : {}),
      },
      stopRequested: false,
    },
    archive: {
      ...base.archive,
      ...archive,
      supported: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
      saveLog: Array.isArray(archive.saveLog) ? archive.saveLog.slice(-60) : [],
      autoSave: archive.autoSave !== false,
      localAssets: Array.isArray(archive.localAssets) ? archive.localAssets.slice(0, 300) : [],
      localAssetsLoading: archive.localAssetsLoading === true,
      localAssetsError: '',
      localAssetsLoadedAt: Number(archive.localAssetsLoadedAt || 0) || 0,
      localAssetsSignature: String(archive.localAssetsSignature || ''),
    },
  };
  if (!normalized.product.imagePreview || normalized.product.imagePreview === '__stored_in_indexeddb__') {
    const inputImages = Array.isArray(normalized.product.inputImages) ? normalized.product.inputImages : [];
    const inputImage = inputImages.find(img => img?.base64 || (img?.preview && img.preview !== '__stored_in_indexeddb__'));
    const hasStoredInputMarker = inputImages.some(img =>
      img?.hasImage &&
      !img?.base64 &&
      !(img?.preview && img.preview !== '__stored_in_indexeddb__') &&
      !img?.dataUrl &&
      !img?.image
    );
    const inputPayload = inputImage
      ? factoryImagePayloadFromCurrentVisual(inputImage.base64, inputImage.mime || normalized.product.imageMime || 'image/png', inputImage.preview || inputImage.dataUrl || inputImage.image, {
        preview: inputImage.preview || inputImage.dataUrl || inputImage.image,
        name: inputImage.name || normalized.product.imageName || '제품사진',
        source: 'factory-input-restore',
      })
      : null;
    if (inputPayload?.base64) {
      normalized.product.imageBase64 = inputPayload.base64;
      normalized.product.imageMime = inputPayload.mime || normalized.product.imageMime || 'image/png';
      normalized.product.imagePreview = inputPayload.preview || `data:${normalized.product.imageMime};base64,${normalized.product.imageBase64}`;
    } else if (normalized.product.imageBase64 && !hasStoredInputMarker) {
      normalized.product.imagePreview = `data:${normalized.product.imageMime || 'image/png'};base64,${normalized.product.imageBase64}`;
    }
  }
  factoryRepairProductImagePayloadDrift(normalized);
  if (!normalized.product.lockedInputImageFingerprint) {
    const lockedPayload = typeof factoryLockedInputImagePayload === 'function'
      ? factoryLockedInputImagePayload(normalized, { includeAppState: false })
      : null;
    if (lockedPayload?.inputImageFingerprint) {
      normalized.product.lockedInputImageFingerprint = lockedPayload.inputImageFingerprint;
      normalized.product.lockedInputImageName = lockedPayload.name || normalized.product.imageName || normalized.product.inputImages?.[0]?.name || '제품사진';
      normalized.product.lockedInputImageMime = lockedPayload.mime || normalized.product.imageMime || 'image/png';
      normalized.product.lockedInputImageSetAt = normalized.product.lockedInputImageSetAt || Date.now();
    }
  }
  factorySanitizeCafe24ProductState(normalized.product);
  factoryPruneRuntimeFactoryAssets(normalized, { reason: 'normalize' });
  return factoryMarkNormalizedState(repairFactoryProductIdentityDrift(normalized));
}

function factoryReferencedAssetIds(factory = {}) {
  const ids = new Set();
  Object.values(factory?.stages || {}).forEach(stage => {
    (stage?.inputAssetIds || []).forEach(id => { if (id) ids.add(id); });
    (stage?.selectedAssetIds || []).forEach(id => { if (id) ids.add(id); });
  });
  Object.values(factory?.detailPlacement || {}).forEach(id => { if (id) ids.add(id); });
  (factory?.assets || []).forEach(asset => {
    if (asset?.used && asset.id) ids.add(asset.id);
  });
  return ids;
}

function factoryRecentAssetIdsByStage(factory = {}, options = {}) {
  const ids = new Set();
  if (options.preserveRecentImages !== true) return ids;
  const perStageLimits = {
    hero: 4,
    size: 4,
    cuts: 8,
    options: 4,
    detail: 4,
    ...(options.recentStageLimits && typeof options.recentStageLimits === 'object' ? options.recentStageLimits : {}),
  };
  const grouped = new Map();
  (Array.isArray(factory?.assets) ? factory.assets : []).forEach((asset, index) => {
    if (!asset?.id || !asset?.stageId || !asset?.image) return;
    if (!grouped.has(asset.stageId)) grouped.set(asset.stageId, []);
    grouped.get(asset.stageId).push({ asset, index });
  });
  grouped.forEach((items, stageId) => {
    const limit = Math.max(0, Number(perStageLimits[stageId] ?? 6) || 0);
    if (!limit) return;
    items
      .sort((a, b) => {
        const at = Number(a.asset.createdAt || a.asset.metadata?.createdAt || 0) || 0;
        const bt = Number(b.asset.createdAt || b.asset.metadata?.createdAt || 0) || 0;
        return (bt - at) || (a.index - b.index);
      })
      .slice(0, limit)
      .forEach(item => ids.add(item.asset.id));
  });
  return ids;
}

function factorySelectedAssetIdsOnly(factory = {}) {
  const ids = new Set();
  Object.values(factory?.stages || {}).forEach(stage => {
    (stage?.inputAssetIds || []).forEach(id => { if (id) ids.add(String(id)); });
    (stage?.selectedAssetIds || []).forEach(id => { if (id) ids.add(String(id)); });
  });
  Object.values(factory?.detailPlacement || {}).forEach(id => { if (id) ids.add(String(id)); });
  return ids;
}

function factorySanitizeHeavyInlineHolder(holder = {}, keepInline = false) {
  if (!holder || typeof holder !== 'object') return holder;
  ['image', 'result', 'preview', 'dataUrl', 'thumbnail', 'thumb'].forEach(key => {
    if (!keepInline && factoryInlineImageLooksHeavy(holder[key])) {
      holder[`had_${key}`] = true;
      holder[`${key}Length`] = String(holder[key] || '').length;
      delete holder[key];
    }
  });
  return holder;
}

function factoryRuntimePruneAsset(asset = {}, keepInline = false) {
  if (!asset || typeof asset !== 'object') return asset;
  const next = { ...asset };
  const archiveUrl = factoryRuntimeArchiveImageUrl(next);
  if (archiveUrl) {
    next.imageUrl = next.imageUrl || archiveUrl;
    next.imagePersistence = next.imagePersistence || 'local-archive-url';
  }
  const canRebuildDetailHtml = !keepInline &&
    String(next.stageId || '') === 'detail' &&
    typeof next.html === 'string' &&
    next.html.length > 24000 &&
    factoryAppStateReady === true &&
    typeof factoryCurrentDetailSectionsComplete === 'function' &&
    factoryCurrentDetailSectionsComplete();
  if (canRebuildDetailHtml) {
    next.hasHtml = true;
    next.htmlLength = next.html.length;
    next.html = '';
  }
  const shouldKeepInline = keepInline && !archiveUrl;
  if (!shouldKeepInline) {
    ['image', 'dataUrl', 'result'].forEach(key => {
      if (factoryInlineImageLooksHeavy(next[key])) {
        next.hasImage = true;
        next.inlineImageLength = Math.max(Number(next.inlineImageLength || 0), String(next[key] || '').length);
        next[key] = null;
      }
    });
    if (String(next.stageId || '') === 'detail' && typeof next.html === 'string' && next.html.length > 24000) {
      next.hasHtml = true;
      next.htmlLength = next.html.length;
      next.html = '';
    }
    next.metadata = factorySanitizeHeavyInlineHolder({ ...(next.metadata || {}) }, false);
    next.sourceMap = factorySanitizeHeavyInlineHolder({ ...(next.sourceMap || {}) }, false);
  }
  return next;
}

function factoryAssetLooksLikeMisplacedDetailDocument(asset = {}) {
  if (!asset || typeof asset !== 'object') return false;
  const stageId = String(asset.stageId || '').trim();
  if (!stageId || stageId === 'detail') return false;
  const text = [
    stageId,
    asset.type,
    asset.assetKind,
    asset.category,
    asset.categoryLabel,
    asset.title,
    asset.metadata?.assetKind,
    asset.metadata?.category,
    asset.metadata?.categoryLabel,
    asset.sourceMap?.assetKind,
    asset.sourceMap?.category,
    asset.sourceMap?.categoryLabel,
  ].map(value => String(value || '')).join(' ').toLowerCase();
  return !!(
    asset.type === 'html' ||
    asset.assetKind === 'detail' ||
    asset.category === 'detail-page-files' ||
    text.includes('상세페이지 html') ||
    text.includes('detail-page') ||
    text.includes('detail html')
  );
}

function factoryHasMisplacedDetailAssets(factory = {}) {
  return (Array.isArray(factory?.assets) ? factory.assets : [])
    .some(asset => factoryAssetLooksLikeMisplacedDetailDocument(asset));
}

function factoryPruneRuntimeFactoryAssets(factory = {}, options = {}) {
  if (!factory || typeof factory !== 'object' || !Array.isArray(factory.assets)) return factory;
  const maxTotal = Math.max(24, Number(options.maxTotal || 80) || 80);
  const originalAssetCount = factory.assets.length;
  const selectedIds = factorySelectedAssetIdsOnly(factory);
  const recentIds = factoryRecentAssetIdsByStage(factory, {
    preserveRecentImages: true,
    recentStageLimits: {
      hero: 3,
      size: 3,
      cuts: 6,
      options: 3,
      detail: 1,
    },
  });
  const keepInlineIds = new Set([...selectedIds, ...recentIds]);
  const stageLimits = {
    hero: 12,
    size: 10,
    cuts: 18,
    options: 10,
    detail: 4,
  };
  const indexed = factory.assets
    .filter(Boolean)
    .filter(asset => !factoryAssetLooksLikeMisplacedDetailDocument(asset))
    .map((asset, index) => ({
      asset,
      index,
      stageId: String(asset.stageId || 'cuts'),
      selected: selectedIds.has(String(asset.id || '')),
      recent: recentIds.has(String(asset.id || '')),
      createdAt: Number(asset.createdAt || asset.metadata?.createdAt || 0) || 0,
      hasArchive: !!(asset.archiveId || asset.localArchive?.archiveId || asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId || asset.sourceMap?.sourceArchiveId),
    }));
  const keepIds = new Set();
  indexed.filter(item => item.selected || item.recent).forEach(item => {
    if (item.asset?.id) keepIds.add(String(item.asset.id));
  });
  const byStage = new Map();
  indexed.forEach(item => {
    if (!byStage.has(item.stageId)) byStage.set(item.stageId, []);
    byStage.get(item.stageId).push(item);
  });
  byStage.forEach((items, stageId) => {
    const limit = Math.max(1, Number(stageLimits[stageId] || 8) || 8);
    items
      .sort((a, b) => (Number(b.selected) - Number(a.selected)) || (Number(b.recent) - Number(a.recent)) || (b.createdAt - a.createdAt) || (a.index - b.index))
      .slice(0, limit)
      .forEach(item => { if (item.asset?.id) keepIds.add(String(item.asset.id)); });
  });
  const kept = [];
  const seen = new Set();
  const seenPayload = new Set();
  indexed
    .filter(item => item.asset?.id && keepIds.has(String(item.asset.id)))
    .sort((a, b) => (Number(b.selected) - Number(a.selected)) || (Number(b.recent) - Number(a.recent)) || (Number(b.hasArchive) - Number(a.hasArchive)) || (b.createdAt - a.createdAt) || (a.index - b.index))
    .forEach(item => {
      if (seen.has(item.asset.id) || kept.length >= maxTotal) return;
      const payloadKey = factoryRuntimeAssetDedupeKey(item.asset);
      if (payloadKey && seenPayload.has(payloadKey) && !item.selected) return;
      seen.add(item.asset.id);
      if (payloadKey) seenPayload.add(payloadKey);
      kept.push(factoryRuntimePruneAsset(item.asset, keepInlineIds.has(String(item.asset.id))));
    });
  factory.assets = kept;
  if (Array.isArray(factory.previousAssets)) {
    factory.previousAssets = factory.previousAssets
      .map(asset => factoryRuntimePruneAsset(asset, true));
  }
  factory.runtimeAssetPrunedAt = Date.now();
  factory.runtimeAssetPrunedCount = originalAssetCount - kept.length;
  return factory;
}

function factoryRuntimeAssetDedupeKey(asset = {}) {
  if (!asset || typeof asset !== 'object') return '';
  const stageId = String(asset.stageId || 'cuts').trim();
  if (stageId === 'detail') {
    const productKey = String(asset.productKey || asset.sourceMap?.productKey || asset.metadata?.productKey || '').trim();
    const fingerprint = String(asset.inputImageFingerprint || asset.sourceMap?.inputImageFingerprint || asset.metadata?.inputImageFingerprint || '').trim();
    const title = String(asset.title || '').trim();
    if (title) return `${stageId}|detail|${productKey}|${fingerprint}|${title}`;
  }
  const archiveId = String(
    asset.archiveId ||
    asset.localArchive?.archiveId ||
    asset.metadata?.localArchiveId ||
    asset.sourceMap?.localArchiveId ||
    asset.sourceMap?.sourceArchiveId ||
    ''
  ).trim();
  if (archiveId) return `${stageId}|archive|${archiveId}`;
  const htmlKey = String(asset.type || '') === 'html' || !!asset.hasHtml || (stageId === 'detail' && Number(asset.htmlLength || 0) > 0);
  if (htmlKey) {
    return `${stageId}|html|${String(asset.title || '')}|${Number(asset.htmlLength || 0) || ''}`;
  }
  return '';
}

function factoryHasRuntimeDuplicateAssets(factory = {}) {
  const assets = Array.isArray(factory?.assets) ? factory.assets : [];
  if (assets.length < 2) return false;
  const seen = new Set();
  for (const asset of assets) {
    const key = factoryRuntimeAssetDedupeKey(asset);
    if (!key) continue;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

function factoryHasRuntimeLargeDetailHtmlAssets(factory = {}) {
  return (Array.isArray(factory?.assets) ? factory.assets : [])
    .some(asset => String(asset?.stageId || '') === 'detail' && typeof asset?.html === 'string' && asset.html.length > 24000);
}

function stripFactoryImages(factory = {}, options = {}) {
  const copy = { ...(factory || {}) };
  const preserveReferencedImages = options.preserveReferencedImages === true;
  const preserveRecentImages = options.preserveRecentImages === true;
  const referencedAssetIds = preserveReferencedImages ? factoryReferencedAssetIds(copy) : new Set();
  const recentAssetIds = preserveRecentImages ? factoryRecentAssetIdsByStage(copy, options) : new Set();
  if (copy.product) {
    copy.product = { ...(copy.product || {}) };
    copy.product.hasImage = !!(copy.product.imageBase64 || copy.product.imagePreview || copy.product.hasImage);
    copy.product.imageBase64 = null;
    copy.product.imagePreview = copy.product.hasImage ? '__stored_in_indexeddb__' : null;
    copy.product.inputImages = (Array.isArray(copy.product.inputImages) ? copy.product.inputImages : []).map(img => ({
      id: img.id,
      name: img.name,
      mime: img.mime,
      inputImageFingerprint: img.inputImageFingerprint || img.sourceImageKey || img.productImageKey || '',
      lockedInput: !!img.lockedInput,
      uploadedAt: img.uploadedAt || null,
      hasImage: !!(img.base64 || img.preview || img.hasImage),
    }));
    ['dbCandidates', 'cafe24Candidates', 'pendingDbCandidates', 'pendingCafe24Candidates', 'selectedDbCandidate', 'selectedCafe24Candidate', 'cafe24Product'].forEach(key => {
      const value = copy.product[key];
      if (Array.isArray(value)) {
        copy.product[key] = value.map(stripFactoryCandidateRawJson);
      } else if (value && typeof value === 'object') {
        copy.product[key] = stripFactoryCandidateRawJson(value);
      }
    });
  }
  copy.assets = (Array.isArray(copy.assets) ? copy.assets : []).map(asset => {
    const keepImage = !!asset?.image && (
      (preserveReferencedImages && referencedAssetIds.has(asset?.id)) ||
      (preserveRecentImages && recentAssetIds.has(asset?.id))
    );
    return {
      ...asset,
      hasImage: !!(asset.image || asset.hasImage),
      image: keepImage ? asset.image : null,
      imagePersistence: keepImage ? 'session-selected-inline' : asset.imagePersistence,
    };
  });
  if (copy.archive && typeof copy.archive === 'object') {
    copy.archive = {
      ...copy.archive,
      localAssets: [],
      localAssetsLoading: false,
      localAssetsError: '',
      localAssetsLoadedAt: 0,
      localAssetsSignature: '',
    };
  }
  if (copy.stages && typeof copy.stages === 'object') {
    copy.stages = { ...copy.stages };
    ['hero', 'size', 'cuts'].forEach(stageId => {
      const stage = copy.stages?.[stageId];
      if (!stage || typeof stage !== 'object') return;
      copy.stages[stageId] = { ...stage };
      const nextStage = copy.stages[stageId];
      if (nextStage.status === 'running') {
        nextStage.status = 'idle';
        nextStage.message = nextStage.message || '저장 중 진행 표시는 보존하지 않습니다. 필요하면 다시 생성해주세요.';
        nextStage.runStartedAt = null;
      }
    });
  }
  if (copy.goalRun) copy.goalRun = { ...copy.goalRun, running: false };
  return copy;
}

function stripFactoryCandidateRawJson(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const copy = { ...candidate };
  const stripRawHolder = holder => {
    if (!holder || typeof holder !== 'object') return holder;
    const next = { ...holder };
    const rawJson = next.raw_json;
    if (typeof rawJson === 'string' && rawJson.length > 2048) {
      next.hasRawJson = true;
      next.rawJsonLength = rawJson.length;
      delete next.raw_json;
    }
    ['description', 'mobile_description'].forEach(key => {
      if (typeof next[key] === 'string' && next[key].length > 4096) {
        next[`has_${key}`] = true;
        next[`${key}_length`] = next[key].length;
        delete next[key];
      }
    });
    if (next.raw && typeof next.raw === 'object') next.raw = stripRawHolder(next.raw);
    if (next.rawProduct && typeof next.rawProduct === 'object') next.rawProduct = stripRawHolder(next.rawProduct);
    return next;
  };
  copy.rawProduct = stripRawHolder(copy.rawProduct);
  copy.raw = stripRawHolder(copy.raw);
  return stripRawHolder(copy);
}

function factoryObjectHasEntries(value) {
  return !!(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length);
}

function factoryProductHasImage(product = {}) {
  if (!product || typeof product !== 'object') return false;
  if (product.imageBase64) return true;
  if (product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__') return true;
  if (product.hasImage) return true;
  return (Array.isArray(product.inputImages) ? product.inputImages : []).some(img =>
    !!(img?.base64 || (img?.preview && img.preview !== '__stored_in_indexeddb__') || img?.hasImage)
  );
}

function factoryIdentityTextFromObject(value = {}) {
  if (!value || typeof value !== 'object') return '';
  const raw = value.rawProduct && typeof value.rawProduct === 'object' ? value.rawProduct : {};
  return [
    value.productName,
    value.product_name,
    value.jname,
    value.name,
    value.title,
    value.item_name,
    value.product_name_ko,
    value.cafe24_product_name,
    value.mall_product_name_ko,
    raw.productName,
    raw.product_name,
    raw.name,
    raw.title,
  ].map(item => String(item || '').trim()).find(Boolean) || '';
}

function factoryNormalizeIdentityText(text = '') {
  return String(text || '').replace(/\s+/g, '').toLowerCase();
}

function factoryObjectIdentityKey(value = {}) {
  return factoryNormalizeIdentityText(factoryIdentityTextFromObject(value));
}

function factoryIdentityKeysCompatible(a = '', b = '') {
  const left = factoryNormalizeIdentityText(a);
  const right = factoryNormalizeIdentityText(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function factoryCurrentProductNameForIdentity(factory = null, fallbacks = []) {
  const product = (factory?.product && typeof factory.product === 'object')
    ? factory.product
    : (state?.factory?.product || {});
  const stateName = String(state?.productName || '').trim();
  const productName = String(product.productName || '').trim();
  const userProductName = String(product.userProductName || '').trim();
  const rows = [];
  const add = value => {
    const text = String(value || '').trim();
    if (text && !rows.includes(text)) rows.push(text);
  };
  if (stateName) {
    const productSideName = userProductName || productName;
    const stateMatchesProduct = !productSideName || factoryIdentityKeysCompatible(stateName, productSideName);
    if (stateMatchesProduct) {
      add(stateName);
      if (userProductName && factoryIdentityKeysCompatible(stateName, userProductName)) add(userProductName);
      if (productName && factoryIdentityKeysCompatible(stateName, productName)) add(productName);
    } else {
      add(userProductName);
      add(productName);
      add(stateName);
    }
  } else {
    add(userProductName);
    add(productName);
  }
  (Array.isArray(fallbacks) ? fallbacks : [fallbacks]).forEach(add);
  return rows[0] || '';
}

function factoryImageRecordCompatibleWithCurrentProduct(record = {}, identityKey = '') {
  const currentKey = factoryNormalizeIdentityText(identityKey || factoryCurrentProductIdentityMeta().productIdentityKey || '');
  if (!currentKey || !record || typeof record !== 'object') return true;
  const recordName = [
    record.productName,
    record.product_name,
    record.name,
    record.title,
    record.fileName,
    record.filename,
    record.originalName,
  ].map(value => String(value || '').trim()).find(Boolean);
  if (!recordName) return true;
  const recordKey = factoryNormalizeIdentityText(recordName);
  return !recordKey || factoryIdentityKeysCompatible(recordKey, currentKey);
}

function factoryCurrentProductIdentityMeta(
  factory = typeof factoryRuntimeReadFactory === 'function' ? factoryRuntimeReadFactory() : state?.factory,
  fallbacks = [],
) {
  const productName = factoryCurrentProductNameForIdentity(factory, [
    ...(Array.isArray(fallbacks) ? fallbacks : [fallbacks]),
    state?.analysis?.product_name,
  ]);
  return {
    productName,
    productIdentityKey: factoryNormalizeIdentityText(productName),
  };
}

function factoryBeginExplicitWorkIdentityTransition(factory, reason = 'explicit-work-transition', options = {}) {
  if (options.invalidateBackgroundHydration !== false
    && typeof invalidateWorkspaceBackgroundHydration === 'function') {
    invalidateWorkspaceBackgroundHydration();
  }
  if (options.clearState === true) state.workIdentity = null;
  if (factory && typeof factory === 'object') factory.workIdentity = null;
  if (factory?.automation && typeof factory.automation === 'object') {
    factory.automation.workIdentityTransition = {
      reason: String(reason || 'explicit-work-transition'),
      at: Date.now(),
    };
  }
}

function factorySetCurrentProductIdentity(productName = '', options = {}) {
  if (
    typeof workspaceBlankResetInProgress !== 'undefined' &&
    workspaceBlankResetInProgress &&
    options.allowDuringBlankReset !== true
  ) return '';
  if (!options.factory) {
    const receipt = factoryRuntimeUpdateOwnedFactory(
      'factory/runtime:setCurrentProductIdentity',
      'product-db',
      draft => factorySetCurrentProductIdentity(productName, { ...options, factory: draft }),
    );
    return receipt.result;
  }
  const factory = options.factory;
  if (!factory || typeof factory !== 'object') return '';
  factory.product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  factory.automation = factory.automation && typeof factory.automation === 'object' ? factory.automation : {};
  const name = String(productName || '').trim();
  if (!name) return factoryCurrentProductKey(factory);
  const previousProductKey = factoryNormalizeIdentityText(
    factory.product.productKey || factory.product.productIdentityKey || factory.product.userProductName || factory.product.productName || ''
  );
  const productKey = factoryNormalizeIdentityText(options.productKey || name);
  const productChanged = !!(previousProductKey && productKey && previousProductKey !== productKey);
  if (productChanged && options.rotateWorkIdentity === true) {
    factoryBeginExplicitWorkIdentityTransition(factory, 'explicit-product-replacement');
  }
  factory.product.productName = name;
  factory.product.userProductName = name;
  if (productKey) {
    factory.product.productKey = productKey;
    factory.product.productIdentityKey = productKey;
    factory.product.currentProductKey = productKey;
  }
  if (options.syncState !== false) state.productName = name;
  if (productChanged && typeof factoryClearProductScopedDbManualFields === 'function') {
    // ★ 제품명을 바꾸는 것은 '새 작업' 이 아니다.
    //   주인님 규칙: "필수값뿐만 아니라 모든 게 안 날아가야 한다. **새 작업 누르기 전에는.**"
    //
    //   예전에는 여기서 보존 옵션을 하나도 안 넘겨서, 이름을 고치거나 파란 시작 버튼을 누르는
    //   순간 **확인 눌러 확정해 둔 필수값·신화사DB 선택·카페24 선택이 그 자리에서 전부 삭제**됐다.
    //   (실측 2026-08-30: manualTouched:true 인 필수값 5개 + confirmedDb + 후보목록이 통째로 사라짐)
    //   새로고침은 그것을 처음 눈으로 보는 시점일 뿐, 원인이 아니었다.
    //
    //   형제 호출부(신화사 후보 변경·카페24 후보 변경)는 **전부** 보존 옵션을 넘긴다.
    //   여기만 빠져 있었다. 같은 규칙으로 맞춘다.
    factoryClearProductScopedDbManualFields(factory, 'product-identity-change', {
      nextProductName: name,
      preserveManualFields: true,
      preserveDb: true,
      preserveCafe24: true,
    });
    // 이름이 바뀌었으니 예전 선택이 여전히 맞는지는 **사람이** 판단할 일이다.
    // 지우지 말고 화면에 물어본다.
    const keptDbSelection = !!(factory.product?.confirmedDb
      || String(factory.product?.selectedDbCandidateKey || '').trim()
      || String(factory.product?.selectedCafe24CandidateKey || '').trim());
    if (keptDbSelection) {
      factory.product.candidateReviewStatus =
        `제품명을 '${name}' 으로 바꿨습니다. 이전에 고른 DB·카페24 상품과 확정한 값은 그대로 두었으니, 맞는지 확인해주세요.`;
    }
  }
  if (options.setSearchQuery !== false) factory.automation.dbSearchQuery = name;
  if (options.syncFinal !== false) {
    factory.product.cafe24FinalRegistration = factory.product.cafe24FinalRegistration && typeof factory.product.cafe24FinalRegistration === 'object'
      ? factory.product.cafe24FinalRegistration
      : {};
    factory.product.cafe24FinalRegistration.productName = name;
  }
  if (typeof document !== 'undefined' && options.syncDom !== false) {
    ['factoryGuideProductName', 'factoryProductName', 'productNameInput', 'analysisMatchNameInput'].forEach(id => {
      const input = document.getElementById(id);
      if (!input || (document.activeElement === input && options.forceDom !== true)) return;
      input.value = name;
    });
    const inlineInput = document.querySelector('[data-factory-db-search-query]');
    if (inlineInput && (document.activeElement !== inlineInput || options.forceDom === true)) {
      inlineInput.value = name;
    }
  }
  return productKey;
}

function factoryAuthoritativeProductName(factory = null, fallbacks = []) {
  return factoryCurrentProductNameForIdentity(factory, fallbacks);
}

function factoryIdentityKey(factory = {}) {
  const product = factory?.product || {};
  const names = [
    factoryCurrentProductNameForIdentity(factory),
    product.confirmedDb?.product_name,
    product.confirmedDb?.jname,
    product.finalDb?.product_name,
    product.finalDb?.jname,
  ];
  const name = names.map(value => String(value || '').trim()).find(Boolean) || '';
  return factoryNormalizeIdentityText(name);
}

function factoryReviewCandidateProductKey(value = {}) {
  if (!value || typeof value !== 'object') return '';
  const structuredKeys = [
    value.reviewProductScopeKey,
    value.reviewProductIdentityKey,
    value.candidateProductIdentityKey,
  ];
  for (const rawKey of structuredKeys) {
    const parts = String(rawKey || '').trim().split('::');
    if (parts.length === 3 && parts[2] === 'candidate-review' && parts[1]) {
      return factoryNormalizeIdentityText(parts[1]);
    }
    if (parts.length === 5 && parts[4] === 'candidate-review' && parts[2]) {
      return factoryNormalizeIdentityText(parts[2]);
    }
  }
  const directKey = value.sourceMap?.productKey || value.metadata?.productKey || '';
  if (directKey) return factoryNormalizeIdentityText(directKey);
  if (value.reviewProductName) return factoryNormalizeIdentityText(value.reviewProductName);
  return '';
}

function factoryObjectConflictsWithIdentity(value = {}, identityKey = '', options = {}) {
  if (!identityKey || !value || typeof value !== 'object') return false;
  const reviewProductKey = factoryReviewCandidateProductKey(value);
  if (reviewProductKey) return !factoryIdentityKeysCompatible(reviewProductKey, identityKey);
  const reviewKey = factoryNormalizeIdentityText(
    value.reviewProductIdentityKey ||
    value.candidateProductIdentityKey ||
    value.sourceMap?.productKey ||
    value.metadata?.productKey ||
    ''
  );
  if (reviewKey && factoryIdentityKeysCompatible(reviewKey, identityKey)) return false;
  // 도장(어느 작업에서 고른 것인지)이 없으면 예전에는 **이름**으로 판정했다.
  // 검색으로 긁어온 후보라면 이름이 제품명과 닮는 게 맞지만, 사람이 확정한
  // 신화사DB/Cafe24 상품은 카탈로그 이름이라 제품명과 다른 것이 정상이다.
  // 실측(2026-08-29): 제품명 '수저집 파우치' 에 확정 DB '누비꽃수파우치' 를 골랐더니
  // 새로고침마다 떼어내졌다. 같은 문서의 Cafe24 후보 394 는 이름이 똑같이 안 맞는데도
  // 도장이 있어서 살아남았다. 즉 이름 비교가 정상 선택을 죽이고 있었다.
  if (options.nameFallback === false) return false;
  const key = factoryObjectIdentityKey(value);
  return !!(key && !factoryIdentityKeysCompatible(key, identityKey));
}

// ── 값이 사라진 것을 기록한다 (회귀 검증기들이 공통으로 확인한다) ───────────────
//
// 사용자 규칙(2026-08-29): "모든게 이미지고른거든 뭐든 안날라가야돼. 새작업 누르기전에는"
//
// 오늘 일일 회귀는 145/145 초록불이었는데도 사용자 화면에서 값이 날아갔다. 검사를 몇 개
// 더 늘리는 것으로는 못 막는다. 그래서 **삭제가 일어났다는 사실 자체를 남기고**,
// 브라우저 검증기들이 끝날 때 공통으로 "사람이 버린 것 말고 사라진 게 있나" 를 묻는다.
// 이렇게 하면 검사 개수를 늘리지 않고도 기존 스텝 전부가 보존 검사가 된다.
const FACTORY_DATA_LOSS_LOG_LIMIT = 200;

function factoryDataLossLog() {
  const root = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (!root) return null;
  if (!Array.isArray(root.__factoryDataLoss)) root.__factoryDataLoss = [];
  return root.__factoryDataLoss;
}

// 사람이 '새 작업'·'다른 이름'·'사본 저장' 을 누른 순간에만 부른다.
// 그 뒤의 삭제는 사고가 아니라 사람이 시킨 것이다.
function factoryMarkUserRequestedReset(reason) {
  const root = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  if (!root) return;
  root.__factoryUserRequestedReset = { reason: String(reason || ''), at: Date.now() };
}

function factoryUserRequestedResetRecently(windowMs = 15000) {
  const root = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
  const mark = root && root.__factoryUserRequestedReset;
  if (!mark) return false;
  return Date.now() - Number(mark.at || 0) <= windowMs;
}

function factoryRecordFieldLoss(fieldId, reason, detail = {}) {
  const log = factoryDataLossLog();
  if (!log) return;
  log.push({
    fieldId: String(fieldId || ''),
    reason: String(reason || ''),
    manualTouched: detail.manualTouched === true,
    userRequested: factoryUserRequestedResetRecently(),
    at: Date.now(),
  });
  if (log.length > FACTORY_DATA_LOSS_LOG_LIMIT) log.splice(0, log.length - FACTORY_DATA_LOSS_LOG_LIMIT);
}

function factoryProductScopedFieldIdsForRepair() {
  return [
    'sale_price', 'purchase_price', 'stock', 'quantity',
    'size', 'dimensions', 'width_mm', 'depth_mm', 'height_mm',
    'weight', 'product_weight', 'product_weight_g',
    'material', 'usage', 'use_case', 'purpose',
    'option_name', 'option_values', 'option_count', 'has_option',
    'option_type', 'option_list_type', 'select_one_by_option',
  ];
}

// 판정을 참/거짓 둘로 두면 **'모른다' 가 곧 '지워도 된다' 가 된다.**
// 오늘 사고가 정확히 그것이었다 — 작업파일을 가르는 순간 저장 ID가 잠시 비었고,
// 그러자 모든 값이 '내 것이 아니다' 로 판정돼 지워졌다. 모른다는 것은 남의 것이라는
// 뜻이 아니다. 그래서 네 갈래로 나눈다:
//   'mine'    도장이 지금 작업과 맞는다 — 내 것이 확실하다
//   'foreign' 도장이 있는데 다르다 — 남의 것이 확실하다
//   'unknown' 판단할 근거가 없다 (지금 작업을 모르거나, 값에 도장이 아예 없다)
//   'auto'    사람이 넣은 값이 아니다 — 필요하면 다시 만들어낼 수 있다
// 삭제는 **확실할 때만** 한다. 'unknown' 은 건드리지 않는다.
function factoryManualFieldSettingOwnership(setting = {}, factory = {}, fieldId = '', identityKey = '') {
  if (!setting || typeof setting !== 'object' || !fieldId) return 'unknown';
  if (setting.manualTouched !== true) return 'auto';
  if (!identityKey) return 'unknown';
  const workspaceId = String(state.currentProjectId || factory.workspace?.id || factory.workspaceId || '').trim();
  const productKey = typeof factoryCurrentProductKey === 'function'
    ? factoryCurrentProductKey(factory)
    : identityKey;
  const currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
    ? factoryCurrentWorkflowRunId(factory)
    : String(factory.automation?.currentRunId || factory.product?.currentRunId || '').trim();
  const inputImageFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
    ? factoryCurrentInputImageFingerprint(factory)
    : String(factory.product?.lockedInputImageFingerprint || factory.product?.inputImageFingerprint || '').trim();
  // 지금 작업이 무엇인지 모르면 아무 판단도 하지 않는다.
  if (!workspaceId || !productKey || !currentRunId || !inputImageFingerprint) return 'unknown';
  // 값에 도장이 아예 없으면 낡은 데이터다. 남의 것이라는 증거가 아니다.
  if (!setting.workspaceId && !setting.productKey && !setting.currentRunId) return 'unknown';
  const matches = setting.workspaceId === workspaceId
    && factoryIdentityKeysCompatible(setting.productKey, productKey)
    && setting.currentRunId === currentRunId
    && setting.inputImageFingerprint === inputImageFingerprint
    && setting.stageId === `field:${fieldId}`;
  return matches ? 'mine' : 'foreign';
}

function factoryManualFieldSettingMatchesCurrentWork(setting = {}, factory = {}, fieldId = '', identityKey = '') {
  if (!setting || setting.manualTouched !== true || !fieldId || !identityKey) return false;
  const workspaceId = String(state.currentProjectId || factory.workspace?.id || factory.workspaceId || '').trim();
  const productKey = typeof factoryCurrentProductKey === 'function'
    ? factoryCurrentProductKey(factory)
    : identityKey;
  const currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
    ? factoryCurrentWorkflowRunId(factory)
    : String(factory.automation?.currentRunId || factory.product?.currentRunId || '').trim();
  const inputImageFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
    ? factoryCurrentInputImageFingerprint(factory)
    : String(factory.product?.lockedInputImageFingerprint || factory.product?.inputImageFingerprint || '').trim();
  return !!(
    workspaceId && productKey && currentRunId && inputImageFingerprint &&
    setting.workspaceId === workspaceId &&
    factoryIdentityKeysCompatible(setting.productKey, productKey) &&
    setting.currentRunId === currentRunId &&
    setting.inputImageFingerprint === inputImageFingerprint &&
    setting.stageId === `field:${fieldId}`
  );
}

function factoryBackfillManualFieldSettingScopeFromReview(setting = {}, review = {}, factory = {}, fieldId = '', identityKey = '') {
  if (!setting || !review || setting.manualTouched !== true || review.fieldId !== fieldId) return false;
  const workspaceId = String(state.currentProjectId || factory.workspace?.id || factory.workspaceId || '').trim();
  const productKey = typeof factoryCurrentProductKey === 'function'
    ? factoryCurrentProductKey(factory)
    : identityKey;
  const currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
    ? factoryCurrentWorkflowRunId(factory)
    : String(factory.automation?.currentRunId || factory.product?.currentRunId || '').trim();
  const inputImageFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
    ? factoryCurrentInputImageFingerprint(factory)
    : String(factory.product?.lockedInputImageFingerprint || factory.product?.inputImageFingerprint || '').trim();
  if (
    !workspaceId || !productKey || !currentRunId || !inputImageFingerprint ||
    String(setting.manualValue ?? '') !== String(review.value ?? '') ||
    review.workspaceId !== workspaceId ||
    !factoryIdentityKeysCompatible(review.productKey, productKey) ||
    review.currentRunId !== currentRunId ||
    review.inputImageFingerprint !== inputImageFingerprint ||
    review.stageId !== `field:${fieldId}`
  ) return false;
  setting.workspaceId = workspaceId;
  setting.productKey = productKey;
  setting.currentRunId = currentRunId;
  setting.inputImageFingerprint = inputImageFingerprint;
  setting.stageId = `field:${fieldId}`;
  return true;
}

function repairFactoryProductIdentityDrift(factory = {}) {
  const normalized = factory && typeof factory === 'object' ? factory : {};
  const product = normalized.product && typeof normalized.product === 'object' ? normalized.product : null;
  if (!product) return normalized;
  const productName = String(product.userProductName || product.productName || '').trim();
  const identityKey = factoryNormalizeIdentityText(productName);
  if (!identityKey) return normalized;
  const staleDb =
    // confirmedDb 와 finalDb 는 성격이 다르다. 실측(2026-08-29, 같은 저장본):
    //   confirmedDb.product_name = '누비꽃수파우치'  ← 신화사DB 카탈로그 이름
    //   finalDb.product_name     = '수저집 파우치'   ← 이 작업의 제품명을 따라감
    // 그래서 confirmedDb 는 이름으로 판정하면 안 되고(카탈로그 이름은 원래 다르다),
    // finalDb 는 이름이 제품을 따라가므로 이름 비교가 유효한 신호다.
    // finalDb 까지 풀면 제품을 바꿨을 때 이전 제품의 최종값이 남는다(FIELD-01 이 잡아냈다).
    factoryObjectConflictsWithIdentity(product.confirmedDb, identityKey, { nameFallback: false }) ||
    factoryObjectConflictsWithIdentity(product.finalDb, identityKey);
  if (staleDb) {
    // 사람이 직접 고른 선택이다. 이름이 다르다는 이유로 그냥 버리면 되돌릴 방법이 없다.
    // (2026-08-28 '수저집 파우치' 작업에서 고른 DB/Cafe24 후보가 이렇게 사라졌다.)
    // 그래서 화면에서만 떼어내고 값 자체는 격리해 둔다. 되돌리기는 사용자가 정한다.
    const detachable = {
      confirmedDb: product.confirmedDb,
      finalDb: product.finalDb,
      selectedDbCandidateKey: product.selectedDbCandidateKey,
      selectedCafe24CandidateKey: product.selectedCafe24CandidateKey,
      dbCandidateResolution: product.dbCandidateResolution,
      cafe24CandidateResolution: product.cafe24CandidateResolution,
      cafe24DraftProductKey: product.cafe24DraftProductKey,
      confirmedCafe24ProductKey: product.confirmedCafe24ProductKey,
      dbLocked: product.dbLocked,
    };
    const hasSomethingToKeep = !!(
      detachable.confirmedDb || detachable.finalDb
      || String(detachable.selectedDbCandidateKey || '').trim()
      || String(detachable.selectedCafe24CandidateKey || '').trim()
    );
    // 이 정리는 normalize 마다 돌기 때문에, 이미 비운 뒤 다시 들어와 빈 값으로
    // 앞선 보관본을 덮어쓰지 않도록 실제로 남길 것이 있을 때만 기록한다.
    if (hasSomethingToKeep) {
      product.detachedDbSelection = {
        detachedAt: Date.now(),
        detachedFromProductName: productName,
        ...detachable,
      };
    }
    product.confirmedDb = null;
    product.finalDb = null;
    product.selectedDbCandidateKey = '';
    product.selectedCafe24CandidateKey = '';
    product.dbCandidateResolution = '';
    product.cafe24CandidateResolution = '';
    product.cafe24DraftProductKey = '';
    product.confirmedCafe24ProductKey = '';
    product.dbLocked = false;
    product.candidateReviewStatus = product.detachedDbSelection
      ? `${productName} 기준과 맞지 않는 이전 DB 값을 따로 보관했습니다. 아래 '이전 DB 선택 되돌리기'로 되살리거나, 후보를 다시 선택하세요.`
      : `${productName} 기준과 맞지 않는 이전 DB 값을 분리했습니다. DB/Cafe24 후보를 다시 선택해주세요.`;
    if (product.dbFieldSettings && typeof product.dbFieldSettings === 'object') {
      // 사람이 직접 친 값을 지울지 말지는 '지금 작업이 무엇인지' 를 알 때만 판단할 수 있다.
      // 작업파일을 새로 가르는 순간에는 저장 ID가 잠시 비어 있는데(startNewProjectDraft),
      // 그때 판정하면 **모든 수동 입력값이 '남의 것' 으로 몰려 통째로 지워진다.**
      // 실제로 그 사고가 났다: 사용자가 확인까지 눌러 넣은 사이즈/가로/세로가
      // 새로고침마다 사라졌다("왜자꾸 너가 코딩하나할떄마다 이게날라가냐고").
      // 모른다는 것은 남의 것이라는 뜻이 아니다. 모를 때는 건드리지 않는다.
      const currentWorkspaceId = String(
        state.currentProjectId || normalized.workspace?.id || normalized.workspaceId || '',
      ).trim();
      if (currentWorkspaceId) {
        factoryProductScopedFieldIdsForRepair().forEach(fieldId => {
          const setting = product.dbFieldSettings[fieldId];
          const review = normalized.automation?.fieldReview?.[fieldId];
          if (setting && !factoryManualFieldSettingMatchesCurrentWork(setting, normalized, fieldId, identityKey)) {
            factoryBackfillManualFieldSettingScopeFromReview(setting, review, normalized, fieldId, identityKey);
          }
          // 사람이 직접 넣은 값은 자동으로 지우지 않는다.
          // 사용자 규칙(2026-08-29): "필수값뿐만아니라 모든게 이미지고른거든 뭐든
          // 안날라가야돼. 새작업 누르기전에는"
          // 지우는 것은 사람이 '새 작업' 을 눌렀을 때만이어야 한다.
          if (setting && setting.manualTouched === true) return;
          // 자동으로 채워진 값이라도 **확실할 때만** 지운다.
          // 'unknown'(지금 작업을 모르거나 도장이 없는 낡은 값)은 건드리지 않는다.
          if (setting && factoryManualFieldSettingOwnership(setting, normalized, fieldId, identityKey) === 'unknown') return;
          if (setting && !factoryManualFieldSettingMatchesCurrentWork(setting, normalized, fieldId, identityKey)) {
            factoryRecordFieldLoss(fieldId, 'identity-drift-repair', { manualTouched: setting.manualTouched === true });
            delete product.dbFieldSettings[fieldId];
          }
        });
      }
    }
    if (normalized.automation && typeof normalized.automation === 'object') {
      normalized.automation.optionMode = 'pending';
      normalized.automation.optionSourceSummary = null;
      normalized.automation.fieldReview = {};
    }
  }
  ['dbCandidates', 'pendingDbCandidates', 'cafe24Candidates', 'pendingCafe24Candidates'].forEach(key => {
    if (!Array.isArray(product[key])) return;
    product[key] = product[key].filter(item => !factoryObjectConflictsWithIdentity(item, identityKey));
  });
  if (Array.isArray(normalized.assets)) {
    normalized.assets.forEach(asset => {
      if (!asset || asset.rejected) return;
      if (factoryAssetCompatibleWithCurrentProduct(asset, identityKey)) return;
      const hasGeneratedPayload = !!(
        asset.image ||
        asset.result ||
        asset.html ||
        asset.sourceMap?.cutId ||
        asset.sourceMap?.importedStageId ||
        asset.metadata?.source
      );
      if (!hasGeneratedPayload) return;
      asset.rejected = true;
      asset.metadata = {
        ...(asset.metadata || {}),
        rejectedReason: `${productName} 기준과 맞지 않는 이전 생성 결과로 자동 분리됨`,
        rejectedAt: Date.now(),
      };
    });
    FACTORY_STAGE_DEFS.forEach(def => {
      const stage = normalized.stages?.[def.id];
      if (!stage || !Array.isArray(stage.selectedAssetIds)) return;
      const validIds = new Set(normalized.assets
        .filter(asset => asset?.stageId === def.id && !asset.rejected)
        .map(asset => asset.id));
      stage.selectedAssetIds = stage.selectedAssetIds.filter(id => validIds.has(id));
    });
  }
  return normalized;
}

function factoryMergeIdentityScope(factory = {}) {
  const product = factory?.product || {};
  return {
    workspaceId: String(
      factory?.workspace?.id ||
      factory?.workspaceId ||
      factory?.currentProjectId ||
      ''
    ).trim(),
    currentRunId: String(
      factory?.automation?.currentRunId ||
      factory?.goalRun?.currentRunId ||
      product.currentRunId ||
      product.generationRunId ||
      factory?.archive?.localRunId ||
      ''
    ).trim(),
    productKey: factoryNormalizeIdentityText(
      product.currentProductKey ||
      product.productKey ||
      product.productIdentityKey ||
      product.userProductName ||
      product.productName ||
      ''
    ),
    inputImageFingerprint: String(
      product.lockedInputImageFingerprint ||
      product.inputImageFingerprint ||
      product.currentUploadImageFingerprint ||
      ''
    ).trim(),
  };
}

function factoryStatesCompatibleForMerge(a = {}, b = {}) {
  const aScope = factoryMergeIdentityScope(a);
  const bScope = factoryMergeIdentityScope(b);
  const strictFields = ['workspaceId', 'currentRunId', 'productKey', 'inputImageFingerprint'];
  const strictMismatch = strictFields.some(field =>
    aScope[field] && bScope[field] && aScope[field] !== bScope[field]
  );
  if (strictMismatch) return false;
  const aKey = factoryIdentityKey(a);
  const bKey = factoryIdentityKey(b);
  if (aKey && bKey) return aKey === bKey;
  return !factoryHasMeaningfulWork(a) || !factoryHasMeaningfulWork(b);
}

function factoryStatesHaveIdentityConflict(a = {}, b = {}) {
  const aKey = factoryIdentityKey(a);
  const bKey = factoryIdentityKey(b);
  return !!(aKey && bKey && aKey !== bKey);
}

function factoryPreserveProgressScopeMatches(a = {}, b = {}) {
  const aScope = factoryMergeIdentityScope(a);
  const bScope = factoryMergeIdentityScope(b);
  const fields = ['workspaceId', 'productKey', 'inputImageFingerprint'];
  let matched = false;
  for (const field of fields) {
    const left = String(aScope[field] || '').trim();
    const right = String(bScope[field] || '').trim();
    if (left && right && left !== right) return false;
    if (left && right && left === right) matched = true;
  }
  const incomingHasIdentity = fields.some(field => String(aScope[field] || '').trim());
  const currentHasIdentity = fields.some(field => String(bScope[field] || '').trim());
  if (!matched && !incomingHasIdentity && currentHasIdentity) return true;
  return matched;
}

function factoryPreserveProgressForSameWork(incomingFactory = {}, currentFactory = {}) {
  const incoming = normalizeFactoryState(cloneData(incomingFactory || {}));
  const current = normalizeFactoryState(cloneData(currentFactory || {}));
  if (!factoryHasMeaningfulWork(incoming) && factoryHasMeaningfulWork(current)) {
    return current;
  }
  if (!factoryPreserveProgressScopeMatches(incoming, current)) return incoming;

  const preservePositiveMoney = (next, previous, path = '') => {
    if (!/(sale_price|salePrice|consumer_price|consumerPrice|purchase_price|purchasePrice|retailPrice|supplyPrice|\.price)$/i.test(path)) {
      return false;
    }
    const incoming = Number(String(next ?? '').replace(/,/g, '').trim());
    const existing = Number(String(previous ?? '').replace(/,/g, '').trim());
    return Number.isFinite(incoming) && incoming <= 0 && Number.isFinite(existing) && existing > 0;
  };
  const mergeBlankSafe = (next, previous, path = '') => {
    if (next === undefined || next === null) return cloneData(previous);
    if (preservePositiveMoney(next, previous, path)) return cloneData(previous);
    if (typeof next === 'string' && !next.trim()) return cloneData(previous);
    if (Array.isArray(next)) return next.length ? cloneData(next) : cloneData(previous || []);
    if (next && typeof next === 'object' && !Array.isArray(next)) {
      const merged = previous && typeof previous === 'object' && !Array.isArray(previous)
        ? cloneData(previous)
        : {};
      Object.entries(next).forEach(([key, value]) => {
        merged[key] = mergeBlankSafe(value, merged[key], path ? `${path}.${key}` : key);
      });
      return merged;
    }
    return cloneData(next);
  };

  const preserved = mergeBlankSafe(incoming, current);
  const mergeRows = (nextRows, previousRows, keyOf) => {
    const rows = [...(Array.isArray(nextRows) ? nextRows : []), ...(Array.isArray(previousRows) ? previousRows : [])];
    const seen = new Set();
    return rows.filter(row => {
      const key = String(keyOf(row) || JSON.stringify(row));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const product = preserved.product || (preserved.product = {});
  const currentProduct = current.product || {};
  const finalRegistrationKeys = {
    product_name: ['productName', 'product_name'],
    sale_price: ['price', 'salePrice', 'sale_price'],
    consumer_price: ['retailPrice', 'consumerPrice', 'consumer_price', 'retail_price'],
    purchase_price: ['supplyPrice', 'purchasePrice', 'purchase_price', 'supply_price'],
  };
  Object.entries(currentProduct.dbFieldSettings || {}).forEach(([fieldId, setting]) => {
    const manualValue = String(setting?.manualValue ?? '').trim();
    if (setting?.manualTouched !== true || !manualValue) return;
    product.dbFieldSettings = product.dbFieldSettings && typeof product.dbFieldSettings === 'object'
      ? product.dbFieldSettings
      : {};
    product.dbFieldSettings[fieldId] = cloneData(setting);
    product.finalDb = product.finalDb && typeof product.finalDb === 'object' ? product.finalDb : {};
    product.finalDb[fieldId] = manualValue;
    const keys = finalRegistrationKeys[fieldId];
    if (!keys) return;
    product.cafe24FinalRegistration = product.cafe24FinalRegistration && typeof product.cafe24FinalRegistration === 'object'
      ? product.cafe24FinalRegistration
      : {};
    keys.forEach(key => { product.cafe24FinalRegistration[key] = manualValue; });
  });
  [
    ['dbCandidates', candidate => typeof factorySinhwaCandidateKey === 'function' ? factorySinhwaCandidateKey(candidate) : candidate?.jcode || candidate?.id],
    ['cafe24Candidates', candidate => typeof factoryCafe24CandidateKey === 'function' ? factoryCafe24CandidateKey(candidate) : candidate?.product_no || candidate?.id],
    ['pendingDbCandidates', candidate => typeof factorySinhwaCandidateKey === 'function' ? factorySinhwaCandidateKey(candidate) : candidate?.jcode || candidate?.id],
    ['pendingCafe24Candidates', candidate => typeof factoryCafe24CandidateKey === 'function' ? factoryCafe24CandidateKey(candidate) : candidate?.product_no || candidate?.id],
  ].forEach(([field, keyOf]) => {
    product[field] = mergeRows(product[field], currentProduct[field], keyOf);
  });
  // 실어 온 작업의 기본 이미지는 이미지 저장소로 빠져 본문이 비어 있을 수 있다. 그 빈 값을
  // "값 없음" 으로 보고 화면에 떠 있던 사진을 채우면, 이 작업의 잠긴 지문과 다른 사진이
  // 들어앉는다. 그러면 기본 이미지가 바뀐 것으로 판단해 새 run 을 발급하고, 그 지문으로
  // 만들어 둔 생성물 전량을 이전 자산으로 밀어낸다. 실측: 방울수저집 복원에서 잠긴 지문이
  // 190196(JPEG) 에서 6508820(다른 PNG) 으로 바뀌고 자산 30장이 previousAssets 로 밀렸다.
  const incomingProduct = incoming.product || {};
  const lockedInputFingerprint = String(
    incomingProduct.lockedInputImageFingerprint || incomingProduct.inputImageFingerprint || ''
  ).trim();
  const incomingHasInlineInputImage = !!String(incomingProduct.imageBase64 || '').trim();
  if (lockedInputFingerprint && !incomingHasInlineInputImage
    && typeof factoryImagePayloadFingerprint === 'function') {
    const inheritedFingerprint = factoryImagePayloadFingerprint(product.imageBase64 || '');
    if (inheritedFingerprint && inheritedFingerprint !== lockedInputFingerprint) {
      product.imageBase64 = '';
      product.imageMime = incomingProduct.imageMime || '';
      product.imagePreview = incomingProduct.imagePreview || '';
      product.inputImages = cloneData(incomingProduct.inputImages || []);
    }
  }
  return normalizeFactoryState(preserved);
}

function factoryHasMeaningfulWork(factory = {}) {
  const product = factory?.product || {};
  return !!(
    String(product.productName || '').trim() ||
    factoryProductHasImage(product) ||
    factoryObjectHasEntries(product.confirmedDb) ||
    factoryObjectHasEntries(product.finalDb) ||
    factoryObjectHasEntries(product.dbFieldSettings) ||
    factoryObjectHasEntries(product.cafe24SyncResults) ||
    (Array.isArray(product.dbCandidates) && product.dbCandidates.length) ||
    (Array.isArray(product.cafe24Candidates) && product.cafe24Candidates.length) ||
    (Array.isArray(product.pendingDbCandidates) && product.pendingDbCandidates.length) ||
    (Array.isArray(product.pendingCafe24Candidates) && product.pendingCafe24Candidates.length) ||
    (Array.isArray(factory.assets) && factory.assets.length)
  );
}

function factoryWorkScore(factory = {}) {
  const product = factory?.product || {};
  let score = 0;
  if (String(product.productName || '').trim()) score += 4;
  if (String(product.naturalHint || '').trim()) score += 1;
  if (factoryProductHasImage(product)) score += 5;
  if (factoryObjectHasEntries(product.analysis)) score += 2;
  if (factoryObjectHasEntries(product.confirmedDb)) score += 8;
  if (factoryObjectHasEntries(product.finalDb)) score += 6;
  if (factoryObjectHasEntries(product.dbFieldSettings)) score += Math.min(8, Object.keys(product.dbFieldSettings).length);
  score += Math.min(8, (Array.isArray(product.dbCandidates) ? product.dbCandidates.length : 0));
  score += Math.min(8, (Array.isArray(product.cafe24Candidates) ? product.cafe24Candidates.length : 0));
  score += Math.min(8, (Array.isArray(product.pendingDbCandidates) ? product.pendingDbCandidates.length : 0));
  score += Math.min(8, (Array.isArray(product.pendingCafe24Candidates) ? product.pendingCafe24Candidates.length : 0));
  score += Math.min(8, (Array.isArray(factory.assets) ? factory.assets.length : 0));
  return score;
}

function saveFactoryLastSnapshot(factory = null) {
  try {
    const source = factory || (typeof state !== 'undefined' ? state.factory : null);
    if (!source) return;
    const snapshot = stripFactoryImages(normalizeFactoryState(source));
    const previous = loadFactoryLastSnapshot();
    if (previous && !factoryHasMeaningfulWork(snapshot) && factoryHasMeaningfulWork(previous)) {
      const preserved = stripFactoryImages(mergeFactoryStoredImages(snapshot, previous));
      preserved.cafe24FieldView = factoryNormalizeCafe24FieldView(snapshot.cafe24FieldView, previous.cafe24FieldView);
      preserved.lastSavedAt = Date.now();
      const safePreserved = typeof prepareFactorySnapshotForLocalStorage === 'function'
        ? prepareFactorySnapshotForLocalStorage(preserved)
        : preserved;
      workspaceSessionSetItem(STORAGE_KEYS.factoryLastSnapshot, JSON.stringify(safePreserved));
      return;
    }
    snapshot.lastSavedAt = Date.now();
    const safeSnapshot = typeof prepareFactorySnapshotForLocalStorage === 'function'
      ? prepareFactorySnapshotForLocalStorage(snapshot)
      : snapshot;
    workspaceSessionSetItem(STORAGE_KEYS.factoryLastSnapshot, JSON.stringify(safeSnapshot));
  } catch(e) {}
}

function loadFactoryLastSnapshot() {
  try {
    const raw = workspaceSessionGetItem(STORAGE_KEYS.factoryLastSnapshot);
    if (!raw) return null;
    return normalizeFactoryState(JSON.parse(raw));
  } catch(e) {
    return null;
  }
}

function mergeFactoryStoredImages(latestFactory = {}, storedFactory = {}, options = {}) {
  const latest = normalizeFactoryState(latestFactory);
  const stored = normalizeFactoryState(storedFactory);
  const latestAt = Number(latest.lastSavedAt || 0);
  const storedAt = Number(stored.lastSavedAt || stored.savedAt || 0);
  const latestScore = factoryWorkScore(latest);
  const storedScore = factoryWorkScore(stored);
  const compatible = factoryStatesCompatibleForMerge(latest, stored);
  const latestMeaningful = factoryHasMeaningfulWork(latest);
  const preferStored = options.keepLatestFactory !== true &&
    factoryHasMeaningfulWork(stored) &&
    (!latestMeaningful || (compatible && storedAt > latestAt && storedScore >= latestScore));
  const base = preferStored ? stored : latest;
  const imageSource = preferStored ? latest : stored;
  const merged = normalizeFactoryState(base);
  const storedProduct = stored.product || {};
  const extraProduct = imageSource.product || {};
  const safeToBackfillFromOther = options.mediaOnly !== true &&
    (compatible || !factoryHasMeaningfulWork(merged));
  const identityConflict = factoryStatesHaveIdentityConflict(latest, stored);
  const safeToBackfillMediaFromOther = !identityConflict && (compatible || !factoryHasMeaningfulWork(merged));

  if (safeToBackfillFromOther) {
    const otherProduct = preferStored ? latest.product || {} : stored.product || {};
    const fillString = key => {
      if (!String(merged.product[key] || '').trim() && String(otherProduct[key] || '').trim()) {
        merged.product[key] = otherProduct[key];
      }
    };
    ['productName', 'naturalHint', 'candidateReviewStatus', 'selectedDbCandidateKey', 'selectedCafe24CandidateKey', 'dbCandidateResolution', 'cafe24CandidateResolution', 'confirmedCafe24ProductKey', 'cafe24DraftProductKey', 'cafe24ApiStatus', 'cafe24ReferenceStatus', 'competitorSource'].forEach(fillString);
    ['analysis', 'confirmedDb', 'finalDb', 'dbFieldSettings', 'sinhwaDbProgramStatus', 'cafe24ReferenceLists', 'cafe24SyncResults'].forEach(key => {
      if (!factoryObjectHasEntries(merged.product[key]) && factoryObjectHasEntries(otherProduct[key])) {
        merged.product[key] = cloneData(otherProduct[key]);
      }
    });
    ['dbCandidates', 'cafe24Candidates', 'pendingDbCandidates', 'pendingCafe24Candidates', 'competitors', 'cafe24ApiCatalog', 'cafe24EndpointHealth'].forEach(key => {
      if (!(Array.isArray(merged.product[key]) && merged.product[key].length) && Array.isArray(otherProduct[key]) && otherProduct[key].length) {
        merged.product[key] = cloneData(otherProduct[key]);
      }
    });
  }
  merged.cafe24FieldView = factoryNormalizeCafe24FieldView(merged.cafe24FieldView, preferStored ? latest.cafe24FieldView : stored.cafe24FieldView);

  if (safeToBackfillMediaFromOther && (!merged.product.imageBase64 || merged.product.imagePreview === '__stored_in_indexeddb__') && storedProduct.imageBase64) {
    merged.product.imageBase64 = storedProduct.imageBase64;
  }
  if (safeToBackfillMediaFromOther && (!merged.product.imageBase64 || merged.product.imagePreview === '__stored_in_indexeddb__') && extraProduct.imageBase64) {
    merged.product.imageBase64 = extraProduct.imageBase64;
  }
  if (safeToBackfillMediaFromOther && (!merged.product.imagePreview || merged.product.imagePreview === '__stored_in_indexeddb__') && storedProduct.imagePreview && storedProduct.imagePreview !== '__stored_in_indexeddb__') {
    merged.product.imagePreview = storedProduct.imagePreview;
  }
  if (safeToBackfillMediaFromOther && (!merged.product.imagePreview || merged.product.imagePreview === '__stored_in_indexeddb__') && extraProduct.imagePreview && extraProduct.imagePreview !== '__stored_in_indexeddb__') {
    merged.product.imagePreview = extraProduct.imagePreview;
  }
  if (safeToBackfillMediaFromOther && !merged.product.imageMime && storedProduct.imageMime) merged.product.imageMime = storedProduct.imageMime;
  if (safeToBackfillMediaFromOther && !merged.product.imageMime && extraProduct.imageMime) merged.product.imageMime = extraProduct.imageMime;

  const storedInputs = [
    ...(Array.isArray(storedProduct.inputImages) ? storedProduct.inputImages : []),
    ...(Array.isArray(extraProduct.inputImages) ? extraProduct.inputImages : []),
  ];
  const findStoredInput = (img, index) =>
    storedInputs.find(item => item?.id && item.id === img?.id) ||
    storedInputs.find(item => item?.name && item.name === img?.name) ||
    storedInputs[index] ||
    null;
  merged.product.inputImages = (Array.isArray(merged.product.inputImages) ? merged.product.inputImages : []).map((img, index) => {
    if (!safeToBackfillMediaFromOther) return img;
    const storedImg = findStoredInput(img, index);
    if (!storedImg) return img;
    return {
      ...img,
      base64: img.base64 || storedImg.base64 || '',
      preview: (img.preview && img.preview !== '__stored_in_indexeddb__') ? img.preview : (storedImg.preview || ''),
      mime: img.mime || storedImg.mime || merged.product.imageMime || 'image/png',
      hasImage: !!(img.hasImage || storedImg.hasImage || storedImg.base64 || storedImg.preview),
    };
  });
  if (safeToBackfillMediaFromOther && !merged.product.inputImages.length && storedInputs.length) {
    merged.product.inputImages = storedInputs;
  }
  if (!merged.product.imagePreview && merged.product.imageBase64) {
    merged.product.imagePreview = `data:${merged.product.imageMime || 'image/png'};base64,${merged.product.imageBase64}`;
  }

  const storedAssetMap = new Map((stored.assets || []).map(asset => [asset.id, asset]));
  const storedAssetSourceMap = new Map();
  const factoryAssetSourceKeys = asset => {
    const sourceMap = asset?.sourceMap || {};
    return [
      sourceMap.cutId ? `cut:${sourceMap.importedStageId || asset?.stageId || ''}:${sourceMap.cutId}` : '',
      sourceMap.optionResultId ? `option:${sourceMap.optionResultId}` : '',
      sourceMap.sectionId ? `section:${sourceMap.sectionId}` : '',
      sourceMap.localFileName ? `local:${sourceMap.inputStageId || asset?.stageId || ''}:${sourceMap.localFileName}` : '',
      asset?.metadata?.fileName ? `file:${asset?.stageId || ''}:${asset.metadata.fileName}` : '',
    ].filter(Boolean);
  };
  (stored.assets || []).forEach(asset => {
    factoryAssetSourceKeys(asset).forEach(key => {
      if (!storedAssetSourceMap.has(key)) storedAssetSourceMap.set(key, asset);
    });
  });
  const mergedIds = new Set();
  merged.assets = (merged.assets || []).map(asset => {
    mergedIds.add(asset.id);
    const storedAsset = safeToBackfillMediaFromOther
      ? (storedAssetMap.get(asset.id) || factoryAssetSourceKeys(asset).map(key => storedAssetSourceMap.get(key)).find(Boolean))
      : null;
    if (!storedAsset) return asset;
    return {
      ...asset,
      image: asset.image || storedAsset.image || null,
      mime: asset.mime || storedAsset.mime || 'image/png',
      hasImage: !!(asset.hasImage || asset.image || storedAsset.image || storedAsset.hasImage),
    };
  });

  const referencedAssetIds = new Set();
  Object.values(merged.stages || {}).forEach(stage => {
    (stage?.inputAssetIds || []).forEach(id => referencedAssetIds.add(id));
    (stage?.selectedAssetIds || []).forEach(id => referencedAssetIds.add(id));
  });
  Object.values(merged.detailPlacement || {}).forEach(id => { if (id) referencedAssetIds.add(id); });
  if (safeToBackfillMediaFromOther) stored.assets.forEach(asset => {
    if (!mergedIds.has(asset.id) && (referencedAssetIds.has(asset.id) || !merged.assets.length)) {
      merged.assets.push(asset);
      mergedIds.add(asset.id);
    }
  });

  return normalizeFactoryState(merged);
}

function factoryStageDef(stageId) {
  return FACTORY_STAGE_DEFS.find(def => def.id === stageId) || FACTORY_STAGE_DEFS[0];
}

function factoryStageLabel(stageId) {
  return factoryStageDef(stageId).label;
}

function factoryAssetImagePart(asset) {
  const dataUrl = asset?.image || '';
  const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  return { base64: match[2], mime: asset?.mime || match[1] || 'image/png' };
}

// ════════════════════════════════════════════════════════════════
// APP STATE
// ════════════════════════════════════════════════════════════════
var factoryAppStateReady = false;
const _savedKey = loadKey();
const _savedBackendUrl = loadBackendUrl();
const _savedOpenAIKey = loadOpenAIKey();
const _savedSession = loadPersistentSession();
const _savedInstructions = loadSectionInstructions(_savedSession);
const _savedSectionGenerationModes = loadSectionGenerationModes();
const _savedSectionBasisModes = loadSectionBasisModes();
const _savedSectionAssembly = loadSectionAssembly();
const _savedModelConfig = normalizeModelConfig(loadModelConfig());
const _savedBrandPresets = loadBrandPresets();
const _savedActiveBrandPresetId = loadActiveBrandPresetId();
const _savedLayoutTemplate = _savedSession?.layoutTemplate || loadLayoutTemplate();
const CUTS_DEFAULT_PROMPT_COUNT = 4;
const CUTS_MAX_PROMPT_COUNT = 30;
const CUTS_IMAGE_GENERATION_TIMEOUT_MS = 240000;
const CUTS_ARCHIVE_SETTING_ID = 'imageCutsArchiveDirectory';
const CUTS_PROMPTS_STORAGE_KEY = 'cuts_prompts';
const CUTS_PROMPTS_BACKUP_KEY = 'cuts_prompts_live_backup';
const CUTS_PROMPTS_SLOT_BACKUP_KEY = 'cuts_prompts_slot_backup';
const CUTS_PROMPTS_HISTORY_KEY = 'cuts_prompts_history';
const CUTS_PROMPT_SLOT_COUNT_STORAGE_KEY = 'cuts_prompt_slot_count';
const CUTS_PROMPTS_UPDATED_AT_KEY = 'cuts_prompts_updated_at';
const SIZE_CUTS_PROMPTS_STORAGE_KEY = 'cuts_size_prompts';
const SIZE_CUTS_PROMPT_SLOT_COUNT_STORAGE_KEY = 'cuts_size_prompt_slot_count';
const SIZE_CUTS_PROMPTS_UPDATED_AT_KEY = 'cuts_size_prompts_updated_at';
let cutsArchiveDirectoryHandle = null;
const _savedCutPromptState = resolveSavedCutPromptState(_savedSession?.cuts);
const _savedCutPrompts = _savedCutPromptState.prompts;
const _savedCutPromptSlotCount = normalizeCutPromptSlotCount(
  _savedSession?.cuts?.promptSlotCount ?? localStorage.getItem(CUTS_PROMPT_SLOT_COUNT_STORAGE_KEY),
  _savedCutPrompts.length
);
const _savedSizeCutPromptState = resolveSavedSizeCutPromptState(_savedSession?.cuts);
const _savedSizeCutPrompts = _savedSizeCutPromptState.prompts;
const _savedSizeCutPromptSlotCount = normalizeCutPromptSlotCount(
  _savedSession?.cuts?.sizePromptSlotCount ?? localStorage.getItem(SIZE_CUTS_PROMPT_SLOT_COUNT_STORAGE_KEY),
  _savedSizeCutPrompts.length
);
const _savedStartupStorageWarning = consumeStartupStorageWarning();
let factoryRuntimeStore = null;
let factoryRuntimeBootstrapFactory = null;

const state = {
  step: _savedSession?.step || 'upload', // upload | analyzing | sections | generating | preview | modelsettings
  apiKey: _savedKey,
  backendBaseUrl: _savedBackendUrl,
  showApiModal: _savedModelConfig.llmProvider !== 'gpt_oauth' && !_savedKey && !_savedBackendUrl && !_savedOpenAIKey,
  modelConfig: _savedModelConfig,
  openaiKey: _savedOpenAIKey,
  gptOAuthStatus: null,
  gptOAuthOptions: null,
  gptOAuthStatusLoading: false,
  gptOAuthStatusError: '',
  gptOAuthLastCheckedAt: null,
  runtimeDegradedStatus: null,
  currentProjectId: _savedSession?.currentProjectId || '',
  currentProjectName: _savedSession?.currentProjectName || '',
  currentProjectCreatedAt: _savedSession?.currentProjectCreatedAt || null,
  workIdentity: _savedSession?.workIdentity || null,
  workspaceRevision: _savedSession?.workspaceRevision || null,
  workfileSaveState: '',
  workfileLastSavedAt: Number(_savedSession?.workfileLastSavedAt || 0) || null,
  workfileRestoreState: '',
  workfileRestoreMessage: '',
  workfileRestoreDurationMs: null,
  projectSafetyBackupState: '',
  projectSafetyBackupMessage: '',
  projectsLoaded: false,
  projectBusy: false,
  projects: [],
  snapshots: [],
  factoryBatchSelectedIds: [],
  factoryBatchRunning: false,
  factoryBatchStatus: '',
  factoryBatchProgress: 0,
  factoryBatchLogs: [],
  factoryRegistrationHistoryLoaded: false,
  factoryRegistrationHistory: [],
  expandedFactoryRegistrationIds: [],
  productName: _savedSession?.productName || '',
  imagePreview: _savedSession?.imagePreview || null,
  imageBase64: _savedSession?.imageBase64 || null,
  imageMime: _savedSession?.imageMime || null,
  analysis: _savedSession?.analysis || null,
  competitorData: _savedSession?.competitorData || null,
  analysisTimestamp: _savedSession?.analysisTimestamp || null,
  analysisLogOpen: false, // 로그 패널 펼침 여부
  showRawJson: false,
  sectionInstructions: _savedInstructions,
  sectionWorkScope: _savedSession?.sectionWorkScope || sectionWorkScopeMeta(_savedSession),
  sectionContents: _savedSession?.sectionContents || {},
  sectionImages: _savedSession?.sectionImages || {},
  sectionLocks: _savedSession?.sectionLocks || {},
  sectionInstructionSources: _savedSession?.sectionInstructionSources || {},
  sectionGenerationModes: normalizeSectionGenerationModes(_savedSession?.sectionGenerationModes || _savedSectionGenerationModes),
  sectionBasisModes: normalizeSectionBasisModes(_savedSession?.sectionBasisModes || _savedSectionBasisModes),
  sectionAssembly: normalizeSectionAssembly(_savedSession?.sectionAssembly || _savedSectionAssembly),
  sectionGenerationMeta: _savedSession?.sectionGenerationMeta || {},
  sectionVariants: _savedSession?.sectionVariants || {},
  currentSectionVariantIds: _savedSession?.currentSectionVariantIds || {},
  sectionTipHelperApplied: _savedSession?.sectionTipHelperApplied || {},
  sectionVariantEvaluations: _savedSession?.sectionVariantEvaluations || {},
  analysisRuns: Array.isArray(_savedSession?.analysisRuns) ? _savedSession.analysisRuns : [],
  currentAnalysisRunId: _savedSession?.currentAnalysisRunId || '',
  analysisCompareMode: _savedSession?.analysisCompareMode || 'image',
  analysisMatchSettings: normalizeAnalysisMatchSettings(_savedSession?.analysisMatchSettings),
  dbMatchBusy: false,
  dbMatchCandidates: Array.isArray(_savedSession?.dbMatchCandidates) ? _savedSession.dbMatchCandidates : [],
  dbMatchError: _savedSession?.dbMatchError || '',
  dbMatchLastQuery: _savedSession?.dbMatchLastQuery || '',
  dbMatchSelectionOpen: !!_savedSession?.dbMatchSelectionOpen,
  dbColorOptionsBusy: false,
  dbColorOptions: Array.isArray(_savedSession?.dbColorOptions) ? _savedSession.dbColorOptions : [],
  dbColorOptionsError: _savedSession?.dbColorOptionsError || '',
  dbColorOptionsLastJcode: _savedSession?.dbColorOptionsLastJcode || '',
  dbColorOptionsLoadedAt: _savedSession?.dbColorOptionsLoadedAt || null,
  productInfoFieldSettings: normalizeProductInfoFieldSettings(_savedSession?.productInfoFieldSettings),
  productInfoOptionsOpen: !!_savedSession?.productInfoOptionsOpen,
  productInfoManualValues: normalizeProductInfoManualValues(_savedSession?.productInfoManualValues),
  sectionVariantEvaluationBusy: {},
  aiRepairUndoStack: _savedSession?.aiRepairUndoStack || {},
  manualSectionEdits: _savedSession?.manualSectionEdits || {},
  previewLayerEdits: _savedSession?.previewLayerEdits || {},
  editorHistory: { undo: [], redo: [] },
  detailImageBlocks: Array.isArray(_savedSession?.detailImageBlocks) ? _savedSession.detailImageBlocks : [],
  fixedDetailImages: mergeFixedDetailImages(loadFixedDetailImages(), _savedSession?.fixedDetailImages),
  previewLayerMode: false,
  activePreviewLayer: null, // { sectionId, layerId }
  imageInsert: {
    open: false,
    afterSectionId: null,
    targetSectionId: null,
    driveFolderId: localStorage.getItem('detail_insert_drive_folder_id') || '',
    driveLoading: false,
    driveFiles: [],
    error: '',
  },
  promptTraceModal: {
    open: false,
    sectionId: null,
    variantId: null,
  },
  aiRepair: {
    open: false,
    sectionId: _savedSession?.aiRepair?.sectionId || null,
    mode: _savedSession?.aiRepair?.mode || 'spot',
    prompt: _savedSession?.aiRepair?.prompt || '',
    brushSize: Number(_savedSession?.aiRepair?.brushSize || 48),
    model: _savedSession?.aiRepair?.model || '',
    maskDataUrl: '',
    busy: false,
    error: '',
  },
  sectionGenerating: {}, // sectionId → 'loading' | 'done' | undefined
  sectionBatchSelection: {},
  sectionBatchBasisMode: _savedSession?.sectionBatchBasisMode || 'keep',
  sectionBatchGenerationMode: _savedSession?.sectionBatchGenerationMode || 'keep',
  sectionBatchRun: null,
  imageDirectives: loadImageDirectives(), // [{id, text, active}]
  imageDirectivesOpen: false,
  brandPresets: _savedBrandPresets,
  activeBrandPresetId: _savedBrandPresets.some(p => p.id === _savedActiveBrandPresetId) ? _savedActiveBrandPresetId : '',
  brandPresetDraft: createEmptyBrandPreset(),
  layoutTemplate: _savedLayoutTemplate,
  qaReport: null,
  contentVersion: _savedSession?.contentVersion || 0,
  qaVersion: _savedSession?.qaVersion || 0,
  // ── Agent Chat ──
  agentOpen: false,
  agentMessages: [], // [{role:'user'|'assistant', content, actions, done}]
  agentStreaming: false,
  imageDirectiveInput: _savedSession?.imageDirectiveInput || '',
  imageDirectiveProcessing: false,
  sectionDriveFolderId: localStorage.getItem('section_drive_folder_id') || '',
  sectionDriveUploadStatus: {}, // sectionId → 'uploading'|'done'|'error'
  progress: 0,
  progressMsg: '',
  error: '',
  uiNotice: null,
  storageWarning: _savedStartupStorageWarning?.message || '',
  storageWarningDismissKey: _savedStartupStorageWarning?.dismissKey || '',
  activeSectionEdit: null,
  editingPreviewSection: null,
  jpgExportBusy: '',
  // ── Feature: Preview viewport toggle ──
  previewViewport: 'pc',  // 'pc' | 'mobile'
  // ── Feature: Section drag-drop order ──
  sectionOrder: _savedSession?.sectionOrder || SECTIONS.map(s => s.id),
  hiddenSectionIds: Array.isArray(_savedSession?.hiddenSectionIds) ? _savedSession.hiddenSectionIds.filter(Boolean) : [],
  customSections: normalizeCustomSections(_savedSession?.customSections || []),
  // ── Feature: Multi-image analysis ──
  analysisImages: Array.isArray(_savedSession?.analysisImages)
    ? _savedSession.analysisImages.filter(img => img?.base64 || img?.preview)
    : [],  // [{base64, mime, preview}]  (primary = [0])
  // ── Image Cuts ──
  cuts: {
    sourceBase64: _savedSession?.cuts?.sourceBase64 || null,
    sourceMime: _savedSession?.cuts?.sourceMime || null,
    sourcePreview: _savedSession?.cuts?.sourcePreview || null,
    workImageBase64: _savedSession?.cuts?.workImageBase64 || null,
    workImageMime: _savedSession?.cuts?.workImageMime || null,
    workImagePreview: _savedSession?.cuts?.workImagePreview || null,
    styleReferenceEnabled: _savedSession?.cuts?.styleReferenceEnabled !== false,
    workDriveFolderId: _savedSession?.cuts?.workDriveFolderId || localStorage.getItem('cuts_work_drive_folder_id') || '',
    workDriveFolderName: _savedSession?.cuts?.workDriveFolderName || localStorage.getItem('cuts_work_drive_folder_name') || '',
    workDriveRunning: false,
    localArchiveFolderName: _savedSession?.cuts?.localArchiveFolderName || '',
    localArchiveStatus: _savedSession?.cuts?.localArchiveStatus || '',
    localArchiveLastSavedAt: _savedSession?.cuts?.localArchiveLastSavedAt || null,
    localArchiveSavedCount: Number(_savedSession?.cuts?.localArchiveSavedCount || 0),
    localArchiveSaving: false,
    runBusy: false,
    runStatus: _savedSession?.cuts?.runStatus || '',
    runStatusType: _savedSession?.cuts?.runStatusType || '',
    runLogs: Array.isArray(_savedSession?.cuts?.runLogs) ? _savedSession.cuts.runLogs.slice(-40) : [],
    promptsUpdatedAt: _savedCutPromptState.updatedAt || Number(_savedSession?.cuts?.promptsUpdatedAt || 0),
    promptSlotCount: _savedCutPromptSlotCount,
    prompts: normalizeCutPrompts(_savedCutPrompts, { count: _savedCutPromptSlotCount, clearGenerating: true }),
    sizePromptsUpdatedAt: _savedSizeCutPromptState.updatedAt || Number(_savedSession?.cuts?.sizePromptsUpdatedAt || 0),
    sizePromptSlotCount: _savedSizeCutPromptSlotCount,
    sizePrompts: normalizeCutPrompts(_savedSizeCutPrompts, { count: _savedSizeCutPromptSlotCount, clearGenerating: true }),
    sizeRunBusy: false,
    // 상세페이지 섹션 배치: { sectionId: cutId }
    placement: _savedSession?.cuts?.placement || JSON.parse(localStorage.getItem('cuts_placement') || '{}'),
  },
  // ── Automation ──
  auto: {
    driveConnected: false,
    accessToken: null,
    gdClientId: localStorage.getItem('gd_client_id') || '',
    inputFolderId: localStorage.getItem('auto_input_folder_id') || '',
    inputFolderName: localStorage.getItem('auto_input_folder_name') || '',
    outputFolderId: localStorage.getItem('auto_output_folder_id') || '',
    outputFolderName: localStorage.getItem('auto_output_folder_name') || '',
    intervalMin: parseInt(localStorage.getItem('auto_interval') || '20'),
    running: false,
    queue: [],
    completed: JSON.parse(localStorage.getItem('auto_completed') || '[]'),
    currentItem: null,
    currentProgress: 0,
    currentMsg: '',
    timerId: null,
    nextRunAt: null,
    totalProcessed: parseInt(localStorage.getItem('auto_total_processed') || '0'),
    processedFileIds: new Set(JSON.parse(localStorage.getItem('auto_processed_ids') || '[]')),
    serverApiBase: loadServerAutomationApiBase(),
    serverLoading: false,
    serverError: '',
    serverConfig: null,
    serverStatus: null,
    serverFetchedOnce: false,
    outputImages: {},
    outputImagesLoading: {},
    outputImagesError: {},
    draftCuts: loadDraftCuts(),
    draftCutsFromServer: false,
  },
  vertexConfig: null, // { project, location } — API에서 로드
  // ── 경쟁사 상세페이지 분석 ──
  compPage: {
    subStep: 'input',
    mode: 'images',
    analyzeMsg: '',
    uploadedImages: [],
    htmlText: '',
    urlInput: '',
    analysisResult: null,
    sectionPlan: null,
    planEdits: {},
    scraperBase: 'http://127.0.0.1:5001',
    scraperImportLoading: false,
    scraperImportInfo: null,
    scraperImportError: '',
    previewImageIndex: null,
    evidencePreview: null,
    analyzeProgress: 0,
    analyzeStage: '',
    analyzeDetail: '',
    analyzeLogs: [],
    analyzeModel: null,
    analyzeStartedAt: null,
    analyzeElapsedSec: 0,
    evidenceImages: [],
    backendOk: null,
    marketScrape: null,
    sectionStatus: {},  // {sectionId: 'loading'|'done'|'error'}
  },
  // ── 옵션 이미지 분류기 ──
  optionSorter: normalizeOptionSorterState(_savedSession?.optionSorter),
  // ── 상세페이지 조립공장 ──
  factory: factoryReconcileRestoredCompletionState(
    normalizeFactoryState(_savedSession?.factory),
    _savedSession || {},
  ),
};
factoryAppStateReady = true;

// 저장된 경쟁사 분석 복원
(function() {
  const saved = loadCompAnalysis();
  if (saved) {
    applyCompAnalysisSnapshot(saved, state.compPage.subStep || 'input');
    try { accumulateCompetitorTips(saved.analysisResult, saved.sectionPlan); } catch(e) {}
  }
  try {
    if (typeof repairRestoredSessionIdentityDrift === 'function') {
      repairRestoredSessionIdentityDrift('startup', state.factory);
    }
  } catch(e) {}
})();

function getBrandPresetById(id) {
  return (state.brandPresets || []).find(p => p.id === id) || null;
}

function getActiveBrandPreset() {
  return getBrandPresetById(state.activeBrandPresetId);
}

function getInitialBrandPresetDraft(id) {
  const found = getBrandPresetById(id);
  return found ? cloneData(found) : createEmptyBrandPreset();
}

function getPresetImageDirectives() {
  const preset = getActiveBrandPreset();
  if (!preset?.imageDirectives) return [];
  return preset.imageDirectives
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function getEffectiveImageDirectives() {
  const activeManual = (state.imageDirectives || [])
    .filter(d => d.active)
    .map(d => String(d.text || '').trim())
    .filter(Boolean);
  return [...new Set([...getPresetImageDirectives(), ...activeManual])];
}

function buildBrandPromptBlock() {
  const preset = getActiveBrandPreset();
  if (!preset) return '';
  const parts = [];
  if (preset.tone) parts.push(`Brand tone: ${preset.tone}`);
  if (preset.requiredKeywords) parts.push(`Required keywords or themes: ${preset.requiredKeywords}`);
  if (preset.bannedPhrases) parts.push(`Banned phrases: ${preset.bannedPhrases}`);
  if (preset.headlineFont || preset.bodyFont) parts.push(`Preferred fonts: headline=${preset.headlineFont || 'auto'}, body=${preset.bodyFont || preset.headlineFont || 'auto'}`);
  if (preset.accentColor) parts.push(`Preferred accent color: ${preset.accentColor}`);
  if (preset.backgroundColor) parts.push(`Preferred background color: ${preset.backgroundColor}`);
  if (preset.globalInstruction) parts.push(`Global instruction: ${preset.globalInstruction}`);
  if (!parts.length) return '';
  return `\nBRAND PRESET (keep the result consistent with this brand system):\n${parts.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}\n`;
}

function buildLayoutPromptBlock() {
  const template = LAYOUT_TEMPLATES.find(t => t.id === state.layoutTemplate);
  if (!template) return '';
  return `\nPREFERRED PAGE TEMPLATE:\n- ${template.label}: ${template.desc}\n`;
}

function applyBrandPresetToContent(content) {
  const preset = getActiveBrandPreset();
  const next = cloneData(content) || {};
  next.color_scheme = { ...(next.color_scheme || {}) };
  next.font_suggestion = { ...(next.font_suggestion || {}) };
  if (preset?.headlineFont) next.font_suggestion.headline_font = preset.headlineFont;
  if (preset?.bodyFont) next.font_suggestion.body_font = preset.bodyFont;
  if (preset?.accentColor && !next.color_scheme.accent) next.color_scheme.accent = preset.accentColor;
  if (preset?.backgroundColor && !next.color_scheme.background) next.color_scheme.background = preset.backgroundColor;
  return next;
}

function markContentChanged(shouldPersist = true) {
  state.contentVersion = (state.contentVersion || 0) + 1;
  state.qaReport = null;
  markWorkspaceDocumentDirty();
  if (shouldPersist) savePersistentState();
}

function markWorkspaceDocumentDirty() {
  state.workspaceDocumentDirty = true;
}

function markWorkspaceDocumentClean() {
  state.workspaceDocumentDirty = false;
  state.workspaceDocumentCleanAt = Date.now();
}

function workspaceHasActiveDocumentContent() {
  const factory = state.factory && typeof state.factory === 'object' ? state.factory : null;
  const product = factory?.product || {};
  const hasFactoryImage = !!(
    product.imageBase64 ||
    (product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__') ||
    (Array.isArray(product.inputImages) && product.inputImages.some(img => img?.base64 || (img?.preview && img.preview !== '__stored_in_indexeddb__'))) ||
    product.lockedInputImageFingerprint
  );
  const hasAssets = Array.isArray(factory?.assets) && factory.assets.some(asset => asset && !asset.rejected);
  const hasDb = !!(product.confirmedDb && Object.keys(product.confirmedDb || {}).length);
  const hasCandidates = !!(
    (Array.isArray(product.dbCandidates) && product.dbCandidates.length) ||
    (Array.isArray(product.cafe24Candidates) && product.cafe24Candidates.length) ||
    (Array.isArray(product.competitors) && product.competitors.length)
  );
  const hasSections = !!(
    Object.keys(state.sectionContents || {}).length ||
    Object.keys(state.sectionImages || {}).length
  );
  const hasAnalysis = !!(state.analysis || state.competitorData || state.imageBase64 || state.imagePreview);
  const hasName = !!(String(product.productName || product.userProductName || state.productName || state.currentProjectName || '').trim());
  return !!(hasFactoryImage || hasAssets || hasDb || hasCandidates || hasSections || hasAnalysis || hasName || state.currentProjectId);
}

function workspaceDocumentStatusLabel() {
  if (!workspaceHasActiveDocumentContent()) return '빈 문서';
  if (state.workspaceDocumentDirty) return state.currentProjectId ? '작업파일 미저장 · 수정됨' : '작업파일 미저장 · 임시 초안';
  return state.currentProjectId ? '작업파일 저장됨' : '임시 초안';
}

function promptWorkspaceDocumentChoice(message, options = {}) {
  const title = options.title || '작업 문서';
  return new Promise(resolve => {
    const existing = document.getElementById('workspaceDocumentModal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'workspaceDocumentModal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(7,8,14,.72);padding:18px;';
    overlay.innerHTML = `
      <div style="width:min(520px,100%);border:1px solid rgba(99,102,241,.4);border-radius:14px;background:#151722;color:#e5e7eb;box-shadow:0 24px 80px rgba(0,0,0,.45);font-family:system-ui,'Malgun Gothic',sans-serif">
        <div style="padding:18px 18px 8px">
          <div style="font-size:16px;font-weight:800;margin-bottom:8px">${escapeHtml(title)}</div>
          <div style="font-size:13px;line-height:1.65;color:#cbd5e1;white-space:pre-wrap">${escapeHtml(message)}</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 18px 18px">
          <button type="button" data-choice="cancel" class="btn-sm" style="min-width:84px">취소</button>
          <button type="button" data-choice="discard" class="btn-sm" style="min-width:110px">저장 안 함</button>
          <button type="button" data-choice="save" class="btn-sm primary" style="min-width:110px;background:#6366f1;border-color:#818cf8;color:#fff">저장</button>
        </div>
      </div>`;
    const finish = (choice) => {
      overlay.remove();
      resolve(choice);
    };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) finish('cancel');
    });
    overlay.querySelectorAll('[data-choice]').forEach(btn => {
      btn.addEventListener('click', () => finish(btn.getAttribute('data-choice') || 'cancel'));
    });
    document.body.appendChild(overlay);
    const saveBtn = overlay.querySelector('[data-choice="save"]');
    if (saveBtn) saveBtn.focus();
  });
}

async function confirmSaveBeforeLeavingWorkspace(reason = '새 작업') {
  if (!workspaceHasActiveDocumentContent()) return 'continue';
  const projectLabel = deriveProjectName() || '현재 작업';
  const dirtyNote = state.workspaceDocumentDirty ? '아직 저장되지 않은 변경이 있습니다.' : '이전 작업 내용이 화면에 남아 있습니다.';
  const choice = await promptWorkspaceDocumentChoice(
    [
      `"${projectLabel}" 작업이 열려 있습니다.`,
      dirtyNote,
      '',
      `${reason} 전에 저장할까요?`,
      '· 저장: 현재 작업파일(브라우저 작업본 + .kuasangse 파일)로 보존',
      '· 저장 안 함: 화면만 비우고 새 통로로 시작',
      '· 취소: 지금 작업 유지',
    ].join('\n'),
    { title: '이전 작업 저장' }
  );
  if (choice === 'cancel') return 'cancel';
  if (choice === 'save') {
    try {
      if (typeof factoryUpdateFromInputs === 'function') factoryUpdateFromInputs();
      state.currentProjectName = (
        typeof resolveFactoryProjectInputName === 'function'
          ? resolveFactoryProjectInputName()
          : deriveProjectName()
      ) || deriveProjectName();
      await saveCurrentProject();
      // 포토샵 PSD처럼 파일로도 남겨 언제든 불러올 수 있게 한다.
      await exportCurrentProjectFile({ name: state.currentProjectName || deriveProjectName() });
      markWorkspaceDocumentClean();
      return 'continue';
    } catch (e) {
      state.error = `작업 저장 실패: ${e.message || e}`;
      render();
      return 'cancel';
    }
  }
  return 'continue';
}

function deriveProjectName() {
  return String(
    state.currentProjectName ||
    state.factory?.product?.productName ||
    state.productName ||
    state.analysis?.product_name ||
    state.analysis?.product_name_en ||
    '상세페이지 작업'
  ).trim();
}

function resolveFactoryProjectInputName() {
  const quickInput = document.getElementById('factoryQuickProjectName');
  const workspaceInput = document.getElementById('factoryWorkspaceProjectName');
  return String(quickInput?.value || workspaceInput?.value || '').trim() || deriveProjectName();
}

function workspaceImageBackupKey(kind, id) {
  return `workspaceProductImageBackup:${kind}:${id}`;
}

const FACTORY_REGISTRATION_HISTORY_SETTING_ID = 'factoryRegistrationHistory:v1';
const KUASANGSE_PROJECT_FILE_FORMAT = 'kuasangse.factory.project';
const KUASANGSE_PROJECT_FILE_VERSION = 1;
const KUASANGSE_PROJECT_FILE_MAX_BYTES = 256 * 1024 * 1024;
const KUASANGSE_PROJECT_FILE_PICKER_ID = 'kuasangse-project-workfiles';
const KUASANGSE_PROJECT_FILE_HANDLE_SETTING_ID = 'kuasangseProjectFileHandle:v1';
const KUASANGSE_PROJECT_FILE_LOCATION_LABEL_KEY = 'kuasangse.projectFileLocationLabel.v1';
const KUASANGSE_SAFETY_BACKUP_FORMAT = 'kuasangse.factory.safety-backup';
const KUASANGSE_SAFETY_BACKUP_VERSION = 1;
let kuasangseProjectFileLastHandle = null;
let kuasangseProjectFileActiveHandle = null;
let kuasangseProjectFileActiveHandleScope = '';

function factoryProjectFilePickerTypes() {
  return [{
    description: 'Kuasangse 작업파일',
    accept: { 'application/json': ['.kuasangse', '.json'] },
  }];
}

function factoryProjectFileLocationLabel() {
  try {
    return workspaceSessionGetItem(KUASANGSE_PROJECT_FILE_LOCATION_LABEL_KEY) || '';
  } catch (_) {
    return '';
  }
}

function clearFactoryProjectFileLocationForBlankWork() {
  try { void workspaceSessionRemoveItem(KUASANGSE_PROJECT_FILE_LOCATION_LABEL_KEY); } catch (_) {}
  kuasangseProjectFileActiveHandle = null;
  kuasangseProjectFileActiveHandleScope = '';
}

function factoryProjectFileHandleScope() {
  const projectId = String(state?.currentProjectId || '').trim();
  if (projectId) return `project:${projectId}`;
  return typeof getCurrentLastWorkWorkspaceScope === 'function'
    ? String(getCurrentLastWorkWorkspaceScope() || '').trim()
    : '';
}

function factoryProjectFileHandleSettingId(scope = factoryProjectFileHandleScope()) {
  return scope ? `${KUASANGSE_PROJECT_FILE_HANDLE_SETTING_ID}:${scope}` : '';
}

async function loadFactoryProjectFileHandle(scope = factoryProjectFileHandleScope()) {
  if (!scope) return null;
  if (kuasangseProjectFileActiveHandle && kuasangseProjectFileActiveHandleScope === scope) {
    return kuasangseProjectFileActiveHandle;
  }
  const settingId = factoryProjectFileHandleSettingId(scope);
  const record = settingId ? await workspaceGet(WORKSPACE_DB.appSettings, settingId).catch(() => null) : null;
  if (!record?.handle) return null;
  kuasangseProjectFileActiveHandle = record.handle;
  kuasangseProjectFileActiveHandleScope = scope;
  kuasangseProjectFileLastHandle = record.handle;
  await workspacePersistenceApi().readProjectFile(record.handle);
  return record.handle;
}

async function rememberFactoryProjectFileHandle(handle, options = {}) {
  if (!handle) return;
  const scope = String(options.scope || factoryProjectFileHandleScope()).trim();
  kuasangseProjectFileLastHandle = handle;
  if (scope) {
    kuasangseProjectFileActiveHandle = handle;
    kuasangseProjectFileActiveHandleScope = scope;
  }
  const fileName = String(handle.name || '').trim();
  try {
    void workspaceSessionSetItem(KUASANGSE_PROJECT_FILE_LOCATION_LABEL_KEY, fileName);
  } catch (_) {}
  const settingId = factoryProjectFileHandleSettingId(scope);
  if (!settingId) return;
  await workspacePut(WORKSPACE_DB.appSettings, {
    id: settingId,
    handle,
    fileName,
    scope,
    updatedAt: Date.now(),
  }).catch(() => {});
}

function warmFactoryProjectFileHandle() {
  const scope = factoryProjectFileHandleScope();
  loadFactoryProjectFileHandle(scope)
    .then(record => {
      clearRuntimeDegraded('workfile-warm-load');
      if (record?.name && !factoryProjectFileLocationLabel()) {
        try { void workspaceSessionSetItem(KUASANGSE_PROJECT_FILE_LOCATION_LABEL_KEY, record.name); } catch (_) {}
      }
    })
    .catch(error => {
      reportRuntimeDegradedOnce(
        'workfile-warm-load',
        '작업파일 자동 연결 저하 · 현재 작업은 유지되며 수동으로 다시 열 수 있습니다',
        error,
      );
    });
}

warmFactoryProjectFileHandle();

function workspaceImageBackupReferencePayload(record) {
  if (!record?.id || !record?.primary) return null;
  return {
    id: record.id,
    storage: 'appSettings',
    productName: record.productName || '',
    savedAt: Number(record.savedAt || Date.now()) || Date.now(),
    hasImageData: !!record.primary.base64,
    primary: {
      source: record.primary.source || 'backup',
      mime: record.primary.mime || 'image/png',
      name: record.primary.name || '제품사진',
      base64Length: String(record.primary.base64 || '').length,
      preview: record.primary.base64 ? IMAGE_STORED_MARKER : '',
      updatedAt: record.primary.updatedAt || record.savedAt || Date.now(),
    },
  };
}

function factorySanitizeProjectFileName(name = '') {
  const cleaned = String(name || '상세페이지 작업')
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || '상세페이지 작업';
}

function factoryProjectNameFromFileName(fileName = '', fallback = '') {
  const baseName = String(fileName || '').trim().replace(/^.*[\\/]/, '');
  const match = /^(.*)\.(?:kuasangse|json)$/i.exec(baseName);
  return String(match?.[1] || fallback || '').trim();
}

function factoryEnsureCurrentProjectIdentityForFile(nameOverride = '', options = {}) {
  const store = factoryRuntimeRequireStore();
  if (options.operationToken && !store.isOperationCurrent(options.operationToken)) {
    throw factoryRuntimeStaleActionError('factory/runtime:adoptWorkspaceIdentity');
  }
  const currentFactory = factoryRuntimeReadFactory();
  const previousWorkspaceId = String(
    options.previousWorkspaceId || factoryWorkspaceIdentityFromSource(currentFactory).id || '',
  ).trim();
  const previousCandidateWorkspaceId = String(
    options.previousCandidateWorkspaceId || factoryCurrentWorkspaceId(currentFactory) || '',
  ).trim();
  const id = String(options.projectId || state.currentProjectId || uid('project')).trim();
  const name = String(nameOverride || deriveProjectName() || '상세페이지 작업').trim() || '상세페이지 작업';
  const createdAt = options.createdAt || state.currentProjectCreatedAt || Date.now();
  const stampedWorkspace = currentFactory.workspace && typeof currentFactory.workspace === 'object'
    ? currentFactory.workspace
    : {};
  const identityAlreadyCurrent =
    String(currentFactory.currentProjectId || stampedWorkspace.id || '').trim() === id &&
    String(currentFactory.currentProjectName || stampedWorkspace.name || '').trim() === name &&
    String(stampedWorkspace.createdAt || '') === String(createdAt || '');
  if (identityAlreadyCurrent) {
    state.currentProjectId = id;
    state.currentProjectName = name;
    state.currentProjectCreatedAt = createdAt;
    return {
      id,
      name,
      createdAt,
      previousWorkspaceId,
      operationToken: store.getOperationToken(),
    };
  }
  const receipt = factoryRuntimeUpdateOwnedFactory(
    'factory/runtime:adoptWorkspaceIdentity',
    'composition',
    factory => {
      factoryStampWorkspaceIdentity(factory, { projectId: id, projectName: name, createdAt });
      factoryMigrateReviewCandidateWorkspaceScope(factory, previousCandidateWorkspaceId, id);
      factoryStampFactoryItemsWorkspaceIdentity(factory, id, {
        previousWorkspaceId,
        force: !previousWorkspaceId || previousWorkspaceId === id,
      });
      return { id, name, createdAt, previousWorkspaceId };
    },
  );
  state.currentProjectId = id;
  state.currentProjectName = name;
  state.currentProjectCreatedAt = createdAt;
  return { ...receipt.result, operationToken: store.getOperationToken() };
}

async function saveWorkspaceProductImageBackup(kind, id) {
  return saveWorkspaceProductImageBackupFromPayload(kind, id, currentProductImageBackupPayload());
}

async function hydrateWorkspacePayloadImageBackup(payload) {
  if (!payload?.productImageBackup?.id || payload.productImageBackup?.primary?.base64) return payload;
  if (payload.productImageBackup.storage !== 'appSettings') return payload;
  const stored = await workspaceGet(WORKSPACE_DB.appSettings, payload.productImageBackup.id).catch(() => null);
  if (!stored?.primary?.base64) return payload;
  return {
    ...payload,
    productImageBackup: stored,
  };
}

function workspaceProductImageBackupFromPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.productImageBackup?.primary) return payload.productImageBackup;
  const analysisImage = (Array.isArray(payload.analysisImages) ? payload.analysisImages : [])
    .find(img => img?.base64 || img?.preview || img?.dataUrl || img?.image);
  const factoryProduct = payload.factory?.product || payload.assetPayload?.factory?.product || {};
  const market = payload.compPage?.marketScrape || payload.assetPayload?.compPage?.marketScrape || {};
  const appItem = productImageBackupItem('app', {
    base64: payload.imageBase64,
    mime: payload.imageMime,
    preview: payload.imagePreview,
    name: payload.imageName || analysisImage?.name || '제품사진',
  });
  const analysisItem = productImageBackupItem('analysis', analysisImage ? {
    base64: analysisImage.base64,
    mime: analysisImage.mime,
    preview: analysisImage.preview || analysisImage.dataUrl || analysisImage.image,
    name: analysisImage.name || '제품사진',
  } : null);
  const factoryItem = productImageBackupItem('factory', {
    base64: factoryProduct.imageBase64,
    mime: factoryProduct.imageMime,
    preview: factoryProduct.imagePreview,
    name: factoryProduct.imageName || factoryProduct.inputImages?.[0]?.name || '제품사진',
  });
  const marketItem = productImageBackupItem('market', {
    base64: market.imageBase64,
    mime: market.imageMime,
    preview: market.imagePreview,
    name: market.imageName || '제품사진',
    defaultImageSeeded: market.defaultImageSeeded === true,
  });
  const candidates = [factoryItem, appItem, analysisItem, marketItem && marketItem.defaultImageSeeded ? marketItem : null].filter(Boolean);
  const primary = candidates[0] || null;
  if (!primary) return null;
  return {
    id: LAST_PRODUCT_IMAGE_BACKUP_ID,
    savedAt: Number(payload.savedAt || Date.now()) || Date.now(),
    productName: payload.productName || factoryProduct.productName || market.productName || '',
    primary,
    app: appItem,
    analysis: analysisItem,
    factory: factoryItem,
    market: marketItem,
  };
}

async function saveWorkspaceProductImageBackupFromPayload(kind, id, payload) {
  const key = workspaceImageBackupKey(kind, id);
  const compact = compactProductImageBackupPayload(workspaceProductImageBackupFromPayload(payload));
  if (!compact?.primary?.base64) return null;
  const record = {
    ...compact,
    id: key,
    workspaceKind: kind,
    workspaceId: id,
    savedAt: Date.now(),
  };
  await workspacePut(WORKSPACE_DB.appSettings, record);
  return workspaceImageBackupReferencePayload(record);
}

function compactWorkspacePayloadForStorage(payload = {}, productImageBackup = null) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const compact = buildLightweightSessionPayload({
    ...source,
    fixedDetailImages: source.fixedDetailImages || {},
  });
  compact.name = source.name || compact.name || '';
  compact.productImageBackup = productImageBackup || source.productImageBackup || productImageBackupReferencePayload(workspaceProductImageBackupFromPayload(source));
  compact.assetPayload = source.assetPayload
    ? buildLightweightSessionPayload({
        ...source.assetPayload,
        productImageBackup: productImageBackup || source.assetPayload.productImageBackup,
        fixedDetailImages: source.assetPayload.fixedDetailImages || {},
      })
    : null;
  if (compact.assetPayload) {
    compact.assetPayload.productImageBackup = productImageBackup || productImageBackupReferencePayload(workspaceProductImageBackupFromPayload(source.assetPayload));
  }
  compact.imagePersistence = {
    mode: compact.productImageBackup?.storage === 'appSettings' ? 'appSettings-reference' : 'lightweight',
    note: '기존 저장 작업을 열람용 메타데이터와 이미지 백업 참조 중심으로 경량화했습니다.',
    compactedAt: Date.now(),
  };
  compact.savedAt = Number(source.savedAt || Date.now()) || Date.now();
  return compact;
}

function workspacePayloadFactorySummary(payload = {}) {
  const factory = payload?.factory || payload?.assetPayload?.factory || {};
  const product = factory.product || {};
  const confirmedDb = product.confirmedDb || product.finalDb || {};
  const cafe24Candidates = Array.isArray(product.cafe24Candidates) ? product.cafe24Candidates : [];
  const selectedCafe24 = cafe24Candidates.find(item =>
    item?.key && (item.key === product.selectedCafe24CandidateKey || item.key === product.confirmedCafe24ProductKey)
  ) || cafe24Candidates[0] || {};
  const title = product.productName || payload.productName || payload.name || '';
  const sectionContents = payload.sectionContents || payload.assetPayload?.sectionContents || {};
  const sectionImages = payload.sectionImages || payload.assetPayload?.sectionImages || {};
  const sectionOrder = Array.isArray(payload.sectionOrder) && payload.sectionOrder.length
    ? payload.sectionOrder
    : (typeof SECTIONS !== 'undefined' && Array.isArray(SECTIONS) ? SECTIONS.map(section => section.id).filter(Boolean) : []);
  const sectionIds = new Set([
    ...Object.keys(sectionContents || {}),
    ...Object.keys(sectionImages || {}),
  ].filter(id => !!(sectionContents?.[id] || sectionImages?.[id])));
  const sync = factory.openMarketSync && typeof factory.openMarketSync === 'object' ? factory.openMarketSync : {};
  const selectedChannels = Array.isArray(sync.selectedChannels) ? sync.selectedChannels.filter(Boolean) : [];
  const hasFactory = payload.step === 'factory' ||
    !!title ||
    !!product.hasImage ||
    !!(confirmedDb && Object.keys(confirmedDb).length) ||
    !!cafe24Candidates.length ||
    !!(Array.isArray(factory.assets) && factory.assets.length);
  const thumb = product.imagePreview && product.imagePreview !== IMAGE_STORED_MARKER ? product.imagePreview : '';
  return {
    hasFactory,
    product: {
      productName: title,
      hasImage: !!(product.hasImage || thumb || product.imageBase64),
    },
    thumb,
    dbName: confirmedDb.product_name || confirmedDb.jname || confirmedDb.name || '',
    cafe24Name: selectedCafe24.product_name || selectedCafe24.name || selectedCafe24.title || '',
    assetCount: Array.isArray(factory.assets) ? factory.assets.length : 0,
    sectionGenerated: sectionIds.size,
    sectionTotal: sectionOrder.length,
    finalTarget: sync.finalTarget === 'cafe24_only' ? 'cafe24_only' : 'cafe24_openmarket',
    cafe24Display: sync.cafe24Display || 'T',
    cafe24Selling: sync.cafe24Selling || 'T',
    selectedChannelCount: selectedChannels.length,
    finalRegistrationStatus: sync.finalRegistrationStatus || '',
    finalRegistrationUpdatedAt: sync.finalRegistrationUpdatedAt || null,
  };
}

function workspaceProjectListItem(project = {}, snapshotCount = 0) {
  return {
    id: project.id,
    name: project.name || project.payload?.name || project.payload?.productName || '저장된 작업',
    createdAt: project.createdAt || null,
    updatedAt: project.updatedAt || project.payload?.savedAt || null,
    snapshotCount,
    factorySummary: workspacePayloadFactorySummary(project.payload || {}),
    imagePersistence: project.payload?.imagePersistence || null,
    batchStatus: project.batchStatus || null,
  };
}

function workspaceSnapshotListItem(snapshot = {}) {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    projectName: snapshot.projectName || snapshot.payload?.name || '',
    createdAt: snapshot.createdAt || snapshot.payload?.savedAt || null,
    label: snapshot.label || '',
    imagePersistence: snapshot.payload?.imagePersistence || null,
  };
}

function normalizeFactoryRegistrationHistoryRecord(item = {}) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || item.registrationId || '').trim();
  if (!id) return null;
  const registeredAt = Number(item.registeredAt || item.createdAt || Date.now()) || Date.now();
  const target = item.target === 'cafe24_only' ? 'cafe24_only' : 'cafe24_openmarket';
  return {
    id,
    productName: String(item.productName || item.name || '등록 상품').trim(),
    productNo: String(item.productNo || item.cafe24ProductNo || '').trim(),
    registeredAt,
    target,
    targetLabel: String(item.targetLabel || (target === 'cafe24_only' ? '카페24만 등록' : '카페24 + 오픈마켓')).trim(),
    cafe24Display: String(item.cafe24Display || 'T').trim().toUpperCase() === 'F' ? 'F' : 'T',
    cafe24DisplayLabel: String(item.cafe24DisplayLabel || '').trim(),
    cafe24Selling: String(item.cafe24Selling || 'T').trim().toUpperCase() === 'F' ? 'F' : 'T',
    cafe24SellingLabel: String(item.cafe24SellingLabel || '').trim(),
    openMarketStatus: String(item.openMarketStatus || '').trim(),
    openMarketChannels: Array.isArray(item.openMarketChannels) ? item.openMarketChannels.filter(Boolean).map(String) : [],
    finalStatus: String(item.finalStatus || item.status || '').trim(),
    projectId: String(item.projectId || '').trim(),
    projectName: String(item.projectName || '').trim(),
    storageLabel: String(item.storageLabel || '').trim(),
    storageRef: item.storageRef && typeof item.storageRef === 'object' ? item.storageRef : null,
    heroImage: item.heroImage && typeof item.heroImage === 'object' ? item.heroImage : null,
    detailImages: Array.isArray(item.detailImages) ? item.detailImages.filter(Boolean).slice(0, 8) : [],
    detailSectionCount: Number(item.detailSectionCount || 0) || 0,
    detailAssetCount: Number(item.detailAssetCount || 0) || 0,
    savedProjectUpdatedAt: item.savedProjectUpdatedAt || null,
    source: String(item.source || 'final-registration').trim(),
  };
}

function factoryRegistrationHistoryItems(record = {}) {
  const items = Array.isArray(record?.items) ? record.items : [];
  return items
    .map(normalizeFactoryRegistrationHistoryRecord)
    .filter(Boolean)
    .sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0));
}

async function loadFactoryRegistrationHistory(renderAfter = true) {
  try {
    const record = await workspaceGet(WORKSPACE_DB.appSettings, FACTORY_REGISTRATION_HISTORY_SETTING_ID)
      .catch(() => null);
    state.factoryRegistrationHistory = factoryRegistrationHistoryItems(record);
    state.factoryRegistrationHistoryLoaded = true;
  } catch (e) {
    state.factoryRegistrationHistoryLoaded = true;
    console.warn('Factory registration history load failed:', e);
  }
  if (renderAfter) render();
}

async function saveFactoryRegistrationHistory(items = []) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeFactoryRegistrationHistoryRecord)
    .filter(Boolean)
    .sort((a, b) => (b.registeredAt || 0) - (a.registeredAt || 0))
    .slice(0, 300);
  await workspacePut(WORKSPACE_DB.appSettings, {
    id: FACTORY_REGISTRATION_HISTORY_SETTING_ID,
    updatedAt: Date.now(),
    items: normalized,
  });
  state.factoryRegistrationHistory = normalized;
  state.factoryRegistrationHistoryLoaded = true;
}

function factoryRegistrationHistoryDedupeKey(item = {}) {
  if (item.productNo) {
    return [
      item.productNo || '',
      item.target || '',
      item.finalStatus || '',
    ].join('|');
  }
  return [
    item.projectId || '',
    item.productName || '',
    item.target || '',
    item.finalStatus || '',
  ].join('|');
}

async function prependFactoryRegistrationHistoryRecord(record = {}, options = {}) {
  const normalized = normalizeFactoryRegistrationHistoryRecord(record);
  if (!normalized) return null;
  if (!state.factoryRegistrationHistoryLoaded) {
    await loadFactoryRegistrationHistory(false);
  }
  const key = factoryRegistrationHistoryDedupeKey(normalized);
  const existing = Array.isArray(state.factoryRegistrationHistory) ? state.factoryRegistrationHistory : [];
  const items = [
    normalized,
    ...existing.filter(item => factoryRegistrationHistoryDedupeKey(item) !== key),
  ];
  await saveFactoryRegistrationHistory(items);
  if (options.render !== false) render();
  return normalized;
}

let workspaceImagePayloadCompactionPromise = null;

async function compactWorkspaceRecordImages(storeName, kind, record) {
  if (!record?.payload) return record;
  if (record.payload.imagePersistence?.mode && record.payload.imagePersistence.mode !== 'inline') return record;
  if (!snapshotHasInlineImagePayload(record.payload)) return record;
  const productImageBackup = await saveWorkspaceProductImageBackupFromPayload(kind, record.id, record.payload)
    .catch(() => null);
  const compactPayload = compactWorkspacePayloadForStorage(record.payload, productImageBackup);
  const nextRecord = {
    ...record,
    payload: compactPayload,
    compactedAt: Date.now(),
  };
  await workspacePut(storeName, nextRecord);
  return nextRecord;
}

async function compactWorkspaceExistingImagePayloads(projects = [], snapshots = []) {
  if (workspaceImagePayloadCompactionPromise) return workspaceImagePayloadCompactionPromise;
  workspaceImagePayloadCompactionPromise = (async () => {
    const nextProjects = [];
    const nextSnapshots = [];
    for (const project of projects) {
      nextProjects.push(await compactWorkspaceRecordImages(WORKSPACE_DB.projects, 'project', project));
    }
    for (const snapshot of snapshots) {
      nextSnapshots.push(await compactWorkspaceRecordImages(WORKSPACE_DB.snapshots, 'snapshot', snapshot));
    }
    const sessionAssets = await workspaceGetSessionAssets().catch(() => null);
    if (sessionAssets && (!sessionAssets.imagePersistence?.mode || sessionAssets.imagePersistence.mode === 'inline') && snapshotHasInlineImagePayload(sessionAssets)) {
      const productImageBackup = await saveWorkspaceProductImageBackupFromPayload('session', SESSION_ASSET_ID, sessionAssets).catch(() => null);
      await workspacePutSessionAssets(compactWorkspacePayloadForStorage(sessionAssets, productImageBackup));
    }
    return { projects: nextProjects, snapshots: nextSnapshots };
  })().finally(() => {
    workspaceImagePayloadCompactionPromise = null;
  });
  return workspaceImagePayloadCompactionPromise;
}

function workspaceIdentityFailureMessage(result, context = '작업 복원') {
  const code = String(result?.code || 'WORK_IDENTITY_INVALID');
  return `${context} 차단: 서로 다른 작업파일·제품명·기본이미지가 섞인 상태입니다. (${code})`;
}

function attachWorkspaceWorkIdentity(snapshot, identity, inputImageFingerprint = '') {
  if (!snapshot || typeof snapshot !== 'object' || !identity) return snapshot;
  const copy = cloneData(identity);
  snapshot.workIdentity = copy;
  if (inputImageFingerprint && !snapshot.inputImageFingerprint) {
    snapshot.inputImageFingerprint = inputImageFingerprint;
  }
  const attachFactory = factory => {
    if (!factory || typeof factory !== 'object') return;
    factory.workIdentity = cloneData(identity);
    factory.product = factory.product && typeof factory.product === 'object' ? factory.product : {};
    if (inputImageFingerprint && !factory.product.inputImageFingerprint) {
      factory.product.inputImageFingerprint = inputImageFingerprint;
    }
  };
  attachFactory(snapshot.factory);
  if (snapshot.assetPayload && typeof snapshot.assetPayload === 'object') {
    snapshot.assetPayload.workIdentity = cloneData(identity);
    if (inputImageFingerprint && !snapshot.assetPayload.inputImageFingerprint) {
      snapshot.assetPayload.inputImageFingerprint = inputImageFingerprint;
    }
    attachFactory(snapshot.assetPayload.factory);
  }
  return snapshot;
}

function rebindWorkspaceSnapshotForExplicitProjectLoad(snapshot, identity, projectId) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const targetProjectId = String(projectId || '').trim();
  if (!targetProjectId) return snapshot;
  const targetScopeId = workspacePersistenceApi().normalizeWorkspaceScope(
    getCurrentLastWorkWorkspaceScope(),
  );
  const workspaceBranch = currentWorkspaceBranch(targetScopeId, targetProjectId);
  snapshot.currentProjectId = targetProjectId;
  snapshot.workspaceScope = {
    ...(snapshot.workspaceScope && typeof snapshot.workspaceScope === 'object' ? snapshot.workspaceScope : {}),
    id: targetScopeId,
  };
  snapshot.workspaceRevision = currentWorkspaceRevision(targetScopeId) || null;
  snapshot.workspaceBranch = workspaceBranch;
  const rebindFactory = factory => {
    if (!factory || typeof factory !== 'object') return;
    factory.currentProjectId = targetProjectId;
    factory.workspace = {
      ...(factory.workspace && typeof factory.workspace === 'object' ? factory.workspace : {}),
      id: targetProjectId,
    };
  };
  rebindFactory(snapshot.factory);
  if (snapshot.assetPayload && typeof snapshot.assetPayload === 'object') {
    snapshot.assetPayload.currentProjectId = targetProjectId;
    snapshot.assetPayload.workspaceScope = {
      ...(snapshot.assetPayload.workspaceScope && typeof snapshot.assetPayload.workspaceScope === 'object'
        ? snapshot.assetPayload.workspaceScope
        : {}),
      id: targetScopeId,
    };
    snapshot.assetPayload.workspaceRevision = currentWorkspaceRevision(targetScopeId) || null;
    snapshot.assetPayload.workspaceBranch = workspaceBranch;
    rebindFactory(snapshot.assetPayload.factory);
  }
  if (identity) {
    attachWorkspaceWorkIdentity(snapshot, identity, identity.initialInputImageFingerprint || '');
  }
  return snapshot;
}

function projectWorkspaceSnapshotForDocument(snapshot, projectId = state.currentProjectId) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const targetProjectId = String(projectId || '').replace(/^project:/i, '').trim();
  if (!targetProjectId) return snapshot;
  const documentScopeId = workspacePersistenceApi().normalizeWorkspaceScope(
    `project:${targetProjectId}`,
  );
  const bindDocumentScope = target => {
    if (!target || typeof target !== 'object') return;
    target.currentProjectId = targetProjectId;
    target.workspaceScope = {
      ...(target.workspaceScope && typeof target.workspaceScope === 'object' ? target.workspaceScope : {}),
      id: documentScopeId,
    };
    target.workspaceRevision = currentWorkspaceRevision(documentScopeId) || null;
    delete target.workspaceBranch;
  };
  bindDocumentScope(snapshot);
  bindDocumentScope(snapshot.assetPayload);
  return snapshot;
}

function currentWorkspaceInputImageFingerprint(factorySnapshot = null) {
  const factory = factorySnapshot || factoryRuntimeReadFactory();
  const visible = typeof factoryCurrentVisualImageFingerprint === 'function'
    ? factoryCurrentVisualImageFingerprint(
        state.imageBase64,
        state.imageMime || factory?.product?.imageMime || 'image/png',
        state.imagePreview,
      )
    : '';
  const factoryFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
    ? factoryCurrentInputImageFingerprint(factory)
    : '';
  if (visible && factoryFingerprint && visible !== factoryFingerprint) {
    throw new Error(workspaceIdentityFailureMessage({ code: 'WORK_IDENTITY_IMAGE_CONFLICT' }, '현재 작업 저장'));
  }
  return String(visible || factoryFingerprint || '').trim();
}

function ensureActiveWorkIdentity(options = {}) {
  const api = workspacePersistenceApi();
  const factorySnapshot = options.factorySnapshot || factoryRuntimeDetachedValue(factoryRuntimeReadFactory());
  const product = factorySnapshot?.product || {};
  const productName = String(
    state.productName || product.userProductName || product.productName || '',
  ).trim();
  const inputImageFingerprint = String(
    options.inputImageFingerprint || currentWorkspaceInputImageFingerprint(factorySnapshot) || '',
  ).trim();
  const runtimeScopeId = api.normalizeWorkspaceScope(
    options.scopeId || getCurrentLastWorkWorkspaceScope(),
  );
  const documentScopeId = getCurrentDocumentWorkspaceScope(
    state.currentProjectId || factorySnapshot?.workspace?.id || '',
  );
  const identityScopeId = documentScopeId || runtimeScopeId;
  const boundary = {
    currentProjectId: state.currentProjectId || '',
    workspaceScope: { id: runtimeScopeId },
    workspaceRevision: currentWorkspaceRevision(runtimeScopeId) || null,
    workspaceBranch: runtimeScopeId.startsWith('draft:')
      ? currentWorkspaceBranch(runtimeScopeId, state.currentProjectId || factorySnapshot?.workspace?.id || '')
      : null,
    productName,
    inputImageFingerprint,
    factory: factorySnapshot,
  };
  const legacyValidation = api.validateSnapshotIdentity(boundary);
  if (!legacyValidation.ok) throw new Error(workspaceIdentityFailureMessage(legacyValidation, '현재 작업 저장'));

  let identity = options.forceNew === true ? null : (state.workIdentity || null);
  if (!identity && productName && inputImageFingerprint) {
    const projectId = String(state.currentProjectId || factorySnapshot?.workspace?.id || '').trim();
    const createdAt = Number(
      state.currentProjectCreatedAt || factorySnapshot?.workspace?.createdAt || Date.now(),
    ) || Date.now();
    identity = api.createWorkIdentity({
      instanceId: projectId ? `work:${projectId}:${createdAt}` : uid('work'),
      workspaceId: identityScopeId,
      initialProductName: productName,
      initialInputImageFingerprint: inputImageFingerprint,
      createdAt,
    });
  }
  if (!identity) return null;

  const guarded = attachWorkspaceWorkIdentity(boundary, identity, inputImageFingerprint);
  const validation = api.validateSnapshotIdentity(guarded);
  if (!validation.ok) throw new Error(workspaceIdentityFailureMessage(validation, '현재 작업 저장'));
  state.workIdentity = cloneData(identity);
  attachWorkspaceWorkIdentity(factorySnapshot, identity, inputImageFingerprint);
  return state.workIdentity;
}

function resolveIncomingWorkspaceWorkIdentity(snapshot, options = {}) {
  const api = workspacePersistenceApi();
  const initialValidation = api.validateSnapshotIdentity(snapshot);
  if (!initialValidation.ok) {
    throw new Error(workspaceIdentityFailureMessage(initialValidation, options.context || '작업 복원'));
  }
  const replaceWorkspace = options.replaceWorkspace === true;
  const explicitTargetProjectId = replaceWorkspace ? String(options.projectId || '').trim() : '';
  const explicitTargetScopeId = explicitTargetProjectId ? `project:${explicitTargetProjectId}` : '';
  const activeIdentity = state.workIdentity || null;
  let identity = initialValidation.identity || null;
  if (!replaceWorkspace && activeIdentity) {
    if (identity && !api.workIdentitiesMatch(activeIdentity, identity)) {
      throw new Error(workspaceIdentityFailureMessage({ code: 'WORK_IDENTITY_INSTANCE_CONFLICT' }, options.context || '작업 복원'));
    }
    identity = activeIdentity;
  }
  if (explicitTargetProjectId) {
    const createdAt = Number(
      identity?.createdAt || options.createdAt || snapshot.currentProjectCreatedAt
        || snapshot.factory?.workspace?.createdAt || Date.now(),
    ) || Date.now();
    if ((identity?.initialProductName || initialValidation.productName)
      && (identity?.initialInputImageFingerprint || initialValidation.inputImageFingerprint)
      && (!identity || identity.workspaceId !== explicitTargetScopeId)) {
      identity = api.createWorkIdentity({
        instanceId: `work:${explicitTargetProjectId}:${createdAt}`,
        workspaceId: explicitTargetScopeId,
        initialProductName: identity?.initialProductName || initialValidation.productName,
        initialInputImageFingerprint: identity?.initialInputImageFingerprint
          || initialValidation.inputImageFingerprint,
        createdAt,
      });
    }
    rebindWorkspaceSnapshotForExplicitProjectLoad(snapshot, identity, explicitTargetProjectId);
  } else if (!identity && initialValidation.productName && initialValidation.inputImageFingerprint) {
    const projectId = String(
      options.projectId || snapshot.currentProjectId || snapshot.factory?.workspace?.id || '',
    ).trim();
    const createdAt = Number(
      options.createdAt || snapshot.currentProjectCreatedAt || snapshot.factory?.workspace?.createdAt || Date.now(),
    ) || Date.now();
    const scopeId = snapshot.workspaceScope?.id
      || snapshot.workspaceScope
      || (projectId ? `project:${projectId}` : getCurrentLastWorkWorkspaceScope());
    identity = api.createWorkIdentity({
      instanceId: projectId ? `work:${projectId}:${createdAt}` : uid('work'),
      workspaceId: scopeId,
      initialProductName: initialValidation.productName,
      initialInputImageFingerprint: initialValidation.inputImageFingerprint,
      createdAt,
    });
  }
  if (identity) {
    attachWorkspaceWorkIdentity(snapshot, identity, initialValidation.inputImageFingerprint);
    const guardedValidation = api.validateSnapshotIdentity(snapshot);
    if (!guardedValidation.ok) {
      throw new Error(workspaceIdentityFailureMessage(guardedValidation, options.context || '작업 복원'));
    }
  }
  return identity ? cloneData(identity) : null;
}

function buildWorkspacePayload(options = {}) {
  const runtimeScopeId = workspacePersistenceApi().normalizeWorkspaceScope(
    options.scopeId || getCurrentLastWorkWorkspaceScope(),
  );
  const documentSnapshot = options.documentSnapshot === true;
  const factorySnapshot = cloneData(
    options.factorySnapshot
      || (typeof factoryRuntimeReadCommittedFactory === 'function'
        ? factoryRuntimeReadCommittedFactory()
        : state.factory)
      || {},
  );
  try {
    if (state.currentProjectId) {
      factoryStampWorkspaceIdentity(factorySnapshot, {
        projectId: state.currentProjectId,
        projectName: state.currentProjectName || deriveProjectName(),
        createdAt: state.currentProjectCreatedAt || null,
      });
    }
    if (typeof factoryEnsureCurrentDetailHtmlAsset === 'function') {
      factoryEnsureCurrentDetailHtmlAsset(factorySnapshot);
    }
  } catch(e) {
    console.warn('Detail preview preserve before workspace payload failed:', e);
  }
  const stateCompPage = state.compPage && typeof state.compPage === 'object' ? state.compPage : {};
  const storedCompPage = options.storedCompPage && typeof options.storedCompPage === 'object'
    ? options.storedCompPage
    : null;
  const factoryCompPage = factorySnapshot.competitors?.compPage
    && typeof factorySnapshot.competitors.compPage === 'object'
    ? factorySnapshot.competitors.compPage
    : null;
  const compPageSources = [storedCompPage, factoryCompPage, stateCompPage]
    .filter(source => source && typeof source === 'object');
  // 파생 분석 결과는 "지금 이 화면 사본에 없다" 는 이유만으로 지워지면 안 된다. 아래 펼치기는
  // 뒤 원본이 앞을 통째로 덮으므로, state.compPage.analysisResult 가 null 이면 저장된 쪽에 값이
  // 있어도 최종 payload 가 null 이 되고 서버가 마지막 저장을 통째로 거절한다.
  // 실측 2026-08-31: 100% 까지 끝난 작업이 여기서 막혀
  // "dropped protected work data: compPage.analysisResult" 로 18회 연속 거절됐다.
  // marketScrape 가 mergeCompMarketStoredState 로 받는 보호를 분석 묶음에도 준다.
  // 다만 "일부러 분리했다" 표시(analysisInvalidatedAt)가 더 새로우면 비우는 것을 허용한다 —
  // 서버의 판정 규칙과 같은 기준이어야 양쪽이 어긋나지 않는다.
  const derivedAnalysisKeys = ['analysisResult', 'sectionPlan', 'planEdits'];
  const compPageSnapshot = compPageSources.reduce((merged, source) => {
    const next = {
      ...merged,
      ...source,
      ...(merged.marketScrape || source.marketScrape
        ? { marketScrape: mergeCompMarketStoredState(merged.marketScrape || {}, source.marketScrape || {}) }
        : {}),
    };
    const mergedMark = Number(merged.analysisInvalidatedAt || 0);
    const sourceMark = Number(source.analysisInvalidatedAt || 0);
    if (!(sourceMark > mergedMark)) {
      for (const key of derivedAnalysisKeys) {
        next[key] = mergeSameWorkDerivedValue(merged[key], source[key]);
      }
    }
    return next;
  }, {});
  const inputImageFingerprint = currentWorkspaceInputImageFingerprint(factorySnapshot);
  const workIdentity = ensureActiveWorkIdentity({
    factorySnapshot,
    inputImageFingerprint,
    scopeId: runtimeScopeId,
  });
  const rawPayload = {
    name: deriveProjectName(),
    currentProjectId: state.currentProjectId || '',
    currentProjectName: state.currentProjectName || '',
    currentProjectCreatedAt: state.currentProjectCreatedAt || null,
    workspaceScope: { id: runtimeScopeId },
    workspaceRevision: currentWorkspaceRevision(runtimeScopeId) || null,
    workspaceBranch: runtimeScopeId.startsWith('draft:')
      ? currentWorkspaceBranch(runtimeScopeId, state.currentProjectId)
      : null,
    workIdentity: cloneData(workIdentity),
    inputImageFingerprint,
    step: state.step,
    productName: state.productName,
    imagePreview: state.imagePreview,
    imageBase64: state.imageBase64,
    imageMime: state.imageMime,
    analysisImages: state.analysisImages || [],
    analysis: cloneData(state.analysis),
    competitorData: cloneData(state.competitorData),
    analysisTimestamp: state.analysisTimestamp,
    sectionWorkScope: cloneData(state.sectionWorkScope || sectionWorkScopeMeta()),
    sectionInstructions: cloneData(state.sectionInstructions),
    sectionContents: cloneData(state.sectionContents),
    sectionImages: state.sectionImages,
    sectionLocks: cloneData(state.sectionLocks),
    sectionInstructionSources: cloneData(state.sectionInstructionSources),
    sectionGenerationModes: cloneData(state.sectionGenerationModes),
    sectionBasisModes: cloneData(state.sectionBasisModes),
    sectionAssembly: cloneData(state.sectionAssembly || {}),
    sectionBatchBasisMode: state.sectionBatchBasisMode || 'keep',
    sectionBatchGenerationMode: state.sectionBatchGenerationMode || 'keep',
    sectionGenerationMeta: cloneData(state.sectionGenerationMeta),
    sectionVariants: state.sectionVariants,
    currentSectionVariantIds: cloneData(state.currentSectionVariantIds),
    sectionTipHelperApplied: cloneData(state.sectionTipHelperApplied),
    sectionVariantEvaluations: cloneData(state.sectionVariantEvaluations),
    analysisRuns: cloneData(state.analysisRuns || []),
    currentAnalysisRunId: state.currentAnalysisRunId || '',
    analysisCompareMode: state.analysisCompareMode || 'image',
    analysisMatchSettings: cloneData(state.analysisMatchSettings || normalizeAnalysisMatchSettings()),
    dbMatchCandidates: cloneData(state.dbMatchCandidates || []),
    dbMatchError: state.dbMatchError || '',
    dbMatchLastQuery: state.dbMatchLastQuery || '',
    dbMatchSelectionOpen: !!state.dbMatchSelectionOpen,
    dbColorOptions: cloneData(state.dbColorOptions || []),
    dbColorOptionsError: state.dbColorOptionsError || '',
    dbColorOptionsLastJcode: state.dbColorOptionsLastJcode || '',
    dbColorOptionsLoadedAt: state.dbColorOptionsLoadedAt || null,
    productInfoFieldSettings: cloneData(state.productInfoFieldSettings || normalizeProductInfoFieldSettings()),
    productInfoOptionsOpen: !!state.productInfoOptionsOpen,
    productInfoManualValues: cloneData(state.productInfoManualValues || {}),
    aiRepairUndoStack: state.aiRepairUndoStack,
    manualSectionEdits: cloneData(state.manualSectionEdits),
    detailImageBlocks: state.detailImageBlocks,
    fixedDetailImages: state.fixedDetailImages || loadFixedDetailImages(),
    imageDirectives: cloneData(state.imageDirectives),
    imageDirectiveInput: state.imageDirectiveInput || '',
    aiRepair: state.aiRepair || {},
    cuts: state.cuts || {},
    modelConfig: cloneData(state.modelConfig),
    layoutTemplate: state.layoutTemplate,
    activeBrandPresetId: state.activeBrandPresetId,
    brandPresetDraft: cloneData(state.brandPresetDraft || null),
    contentVersion: state.contentVersion || 0,
    qaVersion: state.qaVersion || 0,
    sectionOrder: cloneData(state.sectionOrder || []),
    hiddenSectionIds: cloneData(state.hiddenSectionIds || []),
    customSections: cloneData(state.customSections || []),
    compPage: compPageSnapshot,
    factory: factorySnapshot,
    assetPayload: currentSessionAssetsPayload({
      includeImages: false,
      factorySnapshot,
      compPageSnapshot,
      scopeId: runtimeScopeId,
      documentSnapshot,
    }),
    savedAt: Date.now(),
  };
  const payload = buildLightweightSessionPayload(rawPayload);
  payload.name = rawPayload.name;
  payload.assetPayload = rawPayload.assetPayload;
  payload.productImageBackup = options.productImageBackup || productImageBackupReferencePayload();
  payload.imagePersistence = {
    mode: payload.productImageBackup?.storage === 'appSettings' ? 'appSettings-reference' : 'lightweight',
    note: '프로젝트 본문에는 큰 이미지 문자열을 넣지 않고, 이미지 백업 참조와 메타데이터만 저장합니다.',
    savedAt: Date.now(),
  };
  payload.savedAt = Date.now();
  return documentSnapshot
    ? projectWorkspaceSnapshotForDocument(payload, state.currentProjectId)
    : payload;
}

function restoreProjectFileFactoryAssetsFromPayload(workspaceAssetPayload = {}, options = {}) {
  if (!workspaceAssetPayload?.factory || typeof workspaceAssetPayload.factory !== 'object') return false;
  const incomingFactory = workspaceAssetPayload.factory;
  const incomingAssets = Array.isArray(incomingFactory.assets) ? incomingFactory.assets : [];
  const incomingPreviousAssets = Array.isArray(incomingFactory.previousAssets) ? incomingFactory.previousAssets : [];
  const incomingArchiveAssets = Array.isArray(incomingFactory.archive?.localAssets) ? incomingFactory.archive.localAssets : [];
  if (!incomingAssets.length && !incomingPreviousAssets.length && !incomingArchiveAssets.length) return false;

  const projectId = String(options.projectId || state.currentProjectId || incomingFactory.workspace?.id || '').trim();
  const projectName = String(options.projectName || state.currentProjectName || incomingFactory.workspace?.name || '').trim();
  const createdAt = options.createdAt || state.currentProjectCreatedAt || incomingFactory.workspace?.createdAt || null;
  const restoredFactory = normalizeFactoryState(cloneData(incomingFactory));
  const restoredCandidateWorkspaceId = factoryWorkspaceIdentityFromSource(restoredFactory).id;
  if (projectId) {
    factoryStampWorkspaceIdentity(restoredFactory, { projectId, projectName, createdAt });
    factoryMigrateReviewCandidateWorkspaceScope(restoredFactory, restoredCandidateWorkspaceId, projectId);
    factoryRecoverRestoredReviewCandidateWorkspaceScope(restoredFactory, restoredCandidateWorkspaceId, projectId);
    factoryStampFactoryItemsWorkspaceIdentity(restoredFactory, projectId, { force: true });
  }
  const currentFactory = normalizeFactoryState(factoryRuntimeDetachedValue(factoryRuntimeReadFactory()));
  currentFactory.product = {
    ...(currentFactory.product || {}),
    ...(restoredFactory.product || {}),
    productName: restoredFactory.product?.productName || currentFactory.product?.productName || state.productName || '',
    userProductName: restoredFactory.product?.userProductName || restoredFactory.product?.productName || currentFactory.product?.userProductName || state.productName || '',
  };
  currentFactory.assets = Array.isArray(restoredFactory.assets) ? cloneData(restoredFactory.assets) : [];
  currentFactory.previousAssets = Array.isArray(restoredFactory.previousAssets) ? cloneData(restoredFactory.previousAssets) : [];
  currentFactory.stages = cloneData(restoredFactory.stages || currentFactory.stages || {});
  currentFactory.detailPlacement = cloneData(restoredFactory.detailPlacement || currentFactory.detailPlacement || {});
  currentFactory.automation = {
    ...(currentFactory.automation || {}),
    ...(restoredFactory.automation || {}),
    activeTab: restoredFactory.automation?.activeTab || currentFactory.automation?.activeTab || 'start',
  };
  currentFactory.goalRun = {
    ...(currentFactory.goalRun || {}),
    ...(restoredFactory.goalRun || {}),
  };
  currentFactory.archive = {
    ...(currentFactory.archive || {}),
    ...(restoredFactory.archive || {}),
    localAssets: incomingArchiveAssets.length ? cloneData(restoredFactory.archive?.localAssets || []) : (currentFactory.archive?.localAssets || []),
  };
  const nextFactory = normalizeFactoryState(currentFactory);
  if (projectId) {
    const currentCandidateWorkspaceId = factoryWorkspaceIdentityFromSource(nextFactory).id;
    factoryStampWorkspaceIdentity(nextFactory, { projectId, projectName, createdAt });
    factoryMigrateReviewCandidateWorkspaceScope(nextFactory, currentCandidateWorkspaceId, projectId);
    factoryRecoverRestoredReviewCandidateWorkspaceScope(nextFactory, currentCandidateWorkspaceId, projectId);
    factoryStampFactoryItemsWorkspaceIdentity(nextFactory, projectId, { force: true });
  }
  factoryRuntimeReplaceFactorySnapshot(nextFactory, {
    mode: 'hydrate',
    reason: 'project-file-factory-assets',
    workspaceId: projectId,
    normalized: true,
    restorePayload: workspaceAssetPayload,
  });
  return true;
}

function projectRestorePreservesCurrentWork(projectId) {
  const targetId = String(projectId || '').trim();
  return !!targetId
    && targetId === String(state.currentProjectId || '').trim();
}

function preserveSameWorkWorkspacePayload(incomingPayload = {}, currentPayload = {}) {
  const hasValue = value => (
    Array.isArray(value) ? value.length > 0
      : value && typeof value === 'object' ? Object.keys(value).length > 0
        : typeof value === 'string' ? !!value.trim()
          : value !== null && value !== undefined
  );
  const itemKey = item => {
    if (item && typeof item === 'object') {
      return String(item.id || item.assetId || item.sourceAssetId || item.candidateId || item.product_no || item.jcode || item.key || JSON.stringify(item));
    }
    return JSON.stringify(item);
  };
  const preserve = (incoming, current) => {
    if (!hasValue(incoming)) return hasValue(current) ? cloneData(current) : cloneData(incoming);
    if (Array.isArray(incoming)) {
      if (!Array.isArray(current) || !current.length) return cloneData(incoming);
      const seen = new Set();
      return [...incoming, ...current].filter(item => {
        const key = itemKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(item => cloneData(item));
    }
    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
      const merged = cloneData(incoming);
      const previous = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
      Object.keys(previous).forEach(key => { merged[key] = preserve(merged[key], previous[key]); });
      return merged;
    }
    return cloneData(incoming);
  };
  const next = preserve(incomingPayload, currentPayload);
  const restoreIncomingRoute = (target, incoming) => {
    if (!target || typeof target !== 'object') return;
    ['currentProjectId', 'workspaceScope', 'workspaceRevision', 'workspaceBranch'].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(incoming || {}, key)) {
        target[key] = cloneData(incoming[key]);
      } else {
        delete target[key];
      }
    });
  };
  restoreIncomingRoute(next, incomingPayload);
  restoreIncomingRoute(next.assetPayload, incomingPayload?.assetPayload);
  if (typeof factoryPreserveProgressForSameWork === 'function' && incomingPayload.factory && currentPayload.factory) {
    next.factory = factoryPreserveProgressForSameWork(incomingPayload.factory, currentPayload.factory);
  }
  return next;
}

function resetLiveWorkspaceForProjectFileReplacement({ preserveCurrentWork = false } = {}) {
  if (preserveCurrentWork) return;
  state.cuts = {};
  state.optionSorter = typeof defaultOptionSorterState === 'function'
    ? defaultOptionSorterState()
    : (typeof normalizeOptionSorterState === 'function' ? normalizeOptionSorterState({}) : {});
  state.compPage = {};
  state.fixedDetailImages = {};
  state.aiRepair = {};
  state.sectionGenerationModes = {};
  state.sectionBasisModes = {};
  state.sectionAssembly = {};
}

function persistAppliedWorkspacePayloadSideEffects(options = {}) {
  saveFixedDetailImages(state.fixedDetailImages || {});
  saveSectionInstructions(state.sectionInstructions);
  saveSectionGenerationModes(state.sectionGenerationModes);
  saveSectionBasisModes(state.sectionBasisModes);
  saveSectionAssembly(state.sectionAssembly);
  saveImageDirectives({ skipPersistentState: options.skipPersistentState === true });
  saveModelConfig(state.modelConfig);
  saveLayoutTemplate(state.layoutTemplate);
  saveActiveBrandPresetId(state.activeBrandPresetId);
  if (state.compPage?.analysisResult) {
    saveCompAnalysis(state.compPage.analysisResult, state.compPage.sectionPlan, state.compPage.planEdits);
  }
}

function applyWorkspacePayload(payload, options = {}) {
  if (!payload) return;
  let next = options.payloadAlreadyDetached === true ? payload : cloneData(payload);
  const identityApi = workspacePersistenceApi();
  const identityValidation = identityApi.validateSnapshotIdentity(next);
  if (!identityValidation.ok) {
    throw new Error(workspaceIdentityFailureMessage(identityValidation, '작업 복원'));
  }
  const replaceWorkspace = options.replaceWorkspace === true;
  const preserveCurrentWork = options.preserveCurrentWork === true;
  if (preserveCurrentWork && options.preserveFallback) {
    next = preserveSameWorkWorkspacePayload(next, options.preserveFallback);
  }
  const incomingSourceWorkspaceId = String(
    next.factory?.workspace?.id || next.factory?.currentProjectId || identityValidation.scopeId || '',
  ).replace(/^(?:project:|draft:)/i, '').trim();
  if (!replaceWorkspace
    && state.workIdentity
    && identityValidation.identity
    && !identityApi.workIdentitiesMatch(state.workIdentity, identityValidation.identity)) {
    throw new Error(workspaceIdentityFailureMessage({ code: 'WORK_IDENTITY_INSTANCE_CONFLICT' }, '작업 복원'));
  }
  const incomingWorkIdentity = resolveIncomingWorkspaceWorkIdentity(next, {
    replaceWorkspace,
    projectId: options.projectId,
    createdAt: options.createdAt,
    context: '작업 복원',
  });
  state.workIdentity = incomingWorkIdentity || (replaceWorkspace ? null : state.workIdentity);
  state.currentProjectId = options.projectId !== undefined ? options.projectId : (state.currentProjectId || '');
  state.currentProjectName = next.name || '';
  state.currentProjectCreatedAt = options.createdAt || state.currentProjectCreatedAt || Date.now();
  state.step = next.step === 'generating' ? 'preview' : (next.step || (next.sectionContents ? 'preview' : 'upload'));
  state.productName = next.productName || '';
  const incomingInputImageFingerprint = String(
    next.inputImageFingerprint
      || next.workIdentity?.initialInputImageFingerprint
      || next.factory?.product?.lockedInputImageFingerprint
      || next.factory?.product?.inputImageFingerprint
      || ''
  ).trim();
  const validatedWorkspaceImage = workspaceValidatedImageStatePayload({
    direct: {
      base64: next.imageBase64 || '',
      mime: next.imageMime || next.factory?.product?.imageMime || 'image/png',
      preview: next.imagePreview || '',
      name: next.imageName || next.factory?.product?.imageName || '제품사진',
    },
    images: Array.isArray(next.analysisImages) ? next.analysisImages : [],
  }, incomingInputImageFingerprint);
  state.imagePreview = validatedWorkspaceImage.payload?.preview
    || (validatedWorkspaceImage.blocked ? null : (next.imagePreview || null));
  state.imageBase64 = validatedWorkspaceImage.payload?.base64 || null;
  state.imageMime = validatedWorkspaceImage.payload?.mime || next.imageMime || null;
  state.analysisImages = validatedWorkspaceImage.images || [];
  if (validatedWorkspaceImage.blocked) {
    state.storageWarning = '작업 지문과 다른 입력 이미지 복구본을 차단했습니다. 현재 작업의 기본 이미지를 다시 선택해주세요.';
    state.storageWarningDismissKey = `foreign-input-image:${incomingInputImageFingerprint}`;
  }
  if (!state.imagePreview && state.analysisImages[0]?.preview) state.imagePreview = state.analysisImages[0].preview;
  if (!state.imageBase64 && state.analysisImages[0]?.base64) state.imageBase64 = state.analysisImages[0].base64;
  if (!state.imageMime && state.analysisImages[0]?.mime) state.imageMime = state.analysisImages[0].mime;
  state.analysis = next.analysis || null;
  state.competitorData = next.competitorData || null;
  state.analysisTimestamp = next.analysisTimestamp || null;
  state.sectionWorkScope = next.sectionWorkScope || sectionWorkScopeMeta(next);
  state.sectionInstructions = next.sectionInstructions || {};
  state.sectionContents = next.sectionContents || {};
  state.sectionImages = next.sectionImages || {};
  state.sectionLocks = next.sectionLocks || {};
  state.sectionInstructionSources = next.sectionInstructionSources || {};
  state.sectionGenerationModes = normalizeSectionGenerationModes(next.sectionGenerationModes || state.sectionGenerationModes);
  state.sectionBasisModes = normalizeSectionBasisModes(next.sectionBasisModes || state.sectionBasisModes);
  state.sectionAssembly = normalizeSectionAssembly(next.sectionAssembly || state.sectionAssembly);
  state.sectionBatchBasisMode = next.sectionBatchBasisMode || state.sectionBatchBasisMode || 'keep';
  state.sectionBatchGenerationMode = next.sectionBatchGenerationMode || state.sectionBatchGenerationMode || 'keep';
  state.sectionGenerationMeta = next.sectionGenerationMeta || {};
  state.sectionOrder = Array.isArray(next.sectionOrder) && next.sectionOrder.length ? next.sectionOrder : SECTIONS.map(s => s.id);
  state.hiddenSectionIds = Array.isArray(next.hiddenSectionIds) ? next.hiddenSectionIds.filter(Boolean) : [];
  state.customSections = normalizeCustomSections(next.customSections || []);
  state.sectionVariants = next.sectionVariants || {};
  state.currentSectionVariantIds = next.currentSectionVariantIds || {};
  state.sectionTipHelperApplied = next.sectionTipHelperApplied || {};
  state.sectionVariantEvaluations = next.sectionVariantEvaluations || {};
  state.analysisRuns = Array.isArray(next.analysisRuns) ? next.analysisRuns : [];
  state.currentAnalysisRunId = next.currentAnalysisRunId || '';
  state.analysisCompareMode = next.analysisCompareMode || 'image';
  state.analysisMatchSettings = normalizeAnalysisMatchSettings(next.analysisMatchSettings);
  state.dbMatchCandidates = Array.isArray(next.dbMatchCandidates) ? next.dbMatchCandidates : [];
  state.dbMatchError = next.dbMatchError || '';
  state.dbMatchLastQuery = next.dbMatchLastQuery || '';
  state.dbMatchBusy = false;
  state.dbMatchSelectionOpen = !!next.dbMatchSelectionOpen;
  state.dbColorOptionsBusy = false;
  state.dbColorOptions = Array.isArray(next.dbColorOptions) ? next.dbColorOptions : [];
  state.dbColorOptionsError = next.dbColorOptionsError || '';
  state.dbColorOptionsLastJcode = next.dbColorOptionsLastJcode || '';
  state.dbColorOptionsLoadedAt = next.dbColorOptionsLoadedAt || null;
  state.productInfoFieldSettings = normalizeProductInfoFieldSettings(next.productInfoFieldSettings);
  state.productInfoOptionsOpen = !!next.productInfoOptionsOpen;
  state.productInfoManualValues = normalizeProductInfoManualValues(next.productInfoManualValues);
  state.sectionVariantEvaluationBusy = {};
  state.aiRepairUndoStack = next.aiRepairUndoStack || {};
  state.manualSectionEdits = next.manualSectionEdits || {};
  state.detailImageBlocks = Array.isArray(next.detailImageBlocks) ? next.detailImageBlocks : [];
  state.fixedDetailImages = mergeFixedDetailImages(
    replaceWorkspace && !preserveCurrentWork ? {} : loadFixedDetailImages(),
    replaceWorkspace && !preserveCurrentWork ? {} : state.fixedDetailImages,
    next.fixedDetailImages,
  );
  if (options.skipSideEffects !== true) saveFixedDetailImages(state.fixedDetailImages);
  state.imageDirectives = Array.isArray(next.imageDirectives) ? next.imageDirectives : [];
  state.imageDirectiveInput = typeof next.imageDirectiveInput === 'string' ? next.imageDirectiveInput : '';
  state.aiRepair = {
    ...(state.aiRepair || {}),
    ...(next.aiRepair || {}),
    open: false,
    busy: false,
    error: '',
  };
  if (next.cuts && typeof next.cuts === 'object') {
    state.cuts = {
      ...state.cuts,
      ...next.cuts,
      prompts: (Array.isArray(next.cuts.prompts) ? next.cuts.prompts : state.cuts.prompts)
        .map(p => ({ ...p, generating: false })),
      sizePrompts: (Array.isArray(next.cuts.sizePrompts) ? next.cuts.sizePrompts : state.cuts.sizePrompts)
        .map(p => ({ ...p, generating: false })),
      placement: next.cuts.placement || {},
      workDriveRunning: false,
      sizeRunBusy: false,
    };
  }
  state.modelConfig = normalizeModelConfig(next.modelConfig || state.modelConfig);
  state.layoutTemplate = LAYOUT_TEMPLATES.some(t => t.id === next.layoutTemplate) ? next.layoutTemplate : state.layoutTemplate;
  state.activeBrandPresetId = typeof next.activeBrandPresetId === 'string' ? next.activeBrandPresetId : state.activeBrandPresetId;
  state.brandPresetDraft = next.brandPresetDraft ? normalizeBrandPreset(next.brandPresetDraft) : getInitialBrandPresetDraft(state.activeBrandPresetId);
  state.contentVersion = Number.isFinite(next.contentVersion) ? next.contentVersion : (state.contentVersion || 0);
  state.qaVersion = Number.isFinite(next.qaVersion) ? next.qaVersion : 0;
  state.qaReport = null;
  state.sectionGenerating = {};
  state.sectionBatchRun = null;
  state.progress = 0;
  state.progressMsg = '';
  if (next.compPage) {
    applyCompAnalysisSnapshot(next.compPage, next.compPage.subStep || state.compPage.subStep || 'input', {
      replaceWorkspace: replaceWorkspace && !preserveCurrentWork,
    });
  }
  const restoredFactory = normalizeFactoryState(next.factory || factoryRuntimeReadFactory());
  const restoredCandidateWorkspaceId = incomingSourceWorkspaceId
    || factoryWorkspaceIdentityFromSource(restoredFactory).id;
  if (state.currentProjectId) {
    factoryStampWorkspaceIdentity(restoredFactory, {
      projectId: state.currentProjectId,
      projectName: state.currentProjectName,
      createdAt: state.currentProjectCreatedAt,
    });
    factoryMigrateReviewCandidateWorkspaceScope(restoredFactory, restoredCandidateWorkspaceId, state.currentProjectId);
    factoryRecoverRestoredReviewCandidateWorkspaceScope(restoredFactory, restoredCandidateWorkspaceId, state.currentProjectId);
  }
  if (incomingWorkIdentity) {
    attachWorkspaceWorkIdentity(restoredFactory, incomingWorkIdentity, incomingWorkIdentity.initialInputImageFingerprint || '');
  }
  factoryRuntimeReplaceFactorySnapshot(restoredFactory, {
    mode: 'hydrate',
    reason: 'workspace-payload',
    workspaceId: state.currentProjectId,
    normalized: true,
    restorePayload: next,
  });
  const workspaceAssetPayload = next.assetPayload || next.sessionAssets || next.assetsPayload || null;
  if (workspaceAssetPayload) {
    const projectFileInline = next.imagePersistence?.mode === 'kuasangse-file-inline';
    const explicitProjectFileRestore = options.validatedProjectFileRestore === true && projectFileInline;
    applySessionAssetsPayload(workspaceAssetPayload, {
      preserveInlineImages: projectFileInline,
      forceProductRestore: projectFileInline,
      forceWorkspaceRestore: true,
      forceRevisionRestore: explicitProjectFileRestore,
      allowScopedInlineImages: explicitProjectFileRestore,
      replaceWorkspace: replaceWorkspace && !preserveCurrentWork,
      payloadAlreadyCloned: true,
      targetName: next.productName || next.currentProjectName || lastWorkPayloadProductName(workspaceAssetPayload),
    });
    if (projectFileInline) {
      restoreProjectFileFactoryAssetsFromPayload(workspaceAssetPayload, {
        projectId: state.currentProjectId,
        projectName: state.currentProjectName,
        createdAt: state.currentProjectCreatedAt,
      });
    }
  }
  if (next.productImageBackup && !workspaceAssetPayload?.productImageBackup) {
    applyProductImageBackupPayload(next.productImageBackup, { restoreInline: true, force: true });
  }
  const identityFactory = factoryRuntimeDetachedValue(factoryRuntimeReadFactory());
  const sealedWorkIdentity = ensureActiveWorkIdentity({ factorySnapshot: identityFactory });
  if (sealedWorkIdentity) {
    factoryRuntimeUpdateOwnedFactory('factory/runtime:sealWorkIdentity', 'factory', factory => {
      factory.workIdentity = cloneData(sealedWorkIdentity);
      factory.product = factory.product && typeof factory.product === 'object' ? factory.product : {};
      if (!factory.product.inputImageFingerprint && identityFactory.product?.inputImageFingerprint) {
        factory.product.inputImageFingerprint = identityFactory.product.inputImageFingerprint;
      }
      return sealedWorkIdentity.instanceId;
    });
  }
  if (options.skipSideEffects !== true) persistAppliedWorkspacePayloadSideEffects();
  if (options.skipPersistence !== true) saveLastWorkNow();
}

async function refreshWorkspaceLists(renderAfter = true) {
  try {
    let [projects, snapshots, registrationHistoryRecord] = await Promise.all([
      workspaceGetAll(WORKSPACE_DB.projects),
      workspaceGetAll(WORKSPACE_DB.snapshots),
      workspaceGet(WORKSPACE_DB.appSettings, FACTORY_REGISTRATION_HISTORY_SETTING_ID).catch(() => null),
    ]);
    const compacted = await compactWorkspaceExistingImagePayloads(projects, snapshots).catch(() => null);
    if (compacted?.projects && compacted?.snapshots) {
      projects = compacted.projects;
      snapshots = compacted.snapshots;
    }
    const counts = {};
    for (const snap of snapshots) counts[snap.projectId] = (counts[snap.projectId] || 0) + 1;
    state.projects = projects
      // 관제탑 배치 워커가 저장한 문서(batch:...)는 사람이 만든 작업이 아니다.
      // 이것이 목록에 섞이면 최근 순 정렬에서 맨 앞을 차지한다. 2026-08-29 실측:
      // 전체 36건 중 10건이 배치 문서였고 **상위 7건이 전부 배치 문서**였다.
      // 그 결과 부팅 복원이 배치 문서를 열어 제품명이 남의 작업 이름으로 바뀌었다.
      // (사용자 화면 헤더에 ID batch:factory-job-d9881fb8... '수저집 파우치' 가 찍혀 있었다.)
      // 워커 탭 자신은 제 문서를 찾아야 하므로 그때는 거르지 않는다.
      .filter(project => classicRuntimeBatchWorkerMode || !/^batch:/i.test(String(project?.id || '')))
      .map(project => workspaceProjectListItem(project, counts[project.id] || 0))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.snapshots = snapshots
      .filter(snap => snap.projectId === state.currentProjectId)
      .map(workspaceSnapshotListItem)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.factoryRegistrationHistory = factoryRegistrationHistoryItems(registrationHistoryRecord);
    state.factoryRegistrationHistoryLoaded = true;
    state.projectsLoaded = true;
    const startupProject = await maybeRestoreLatestSavedProjectOnStartup(state.projects);
    if (startupProject) {
      state.snapshots = snapshots
        .filter(snap => snap.projectId === state.currentProjectId)
        .map(workspaceSnapshotListItem)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
  } catch (e) {
    state.projectsLoaded = true;
    state.factoryRegistrationHistoryLoaded = true;
    console.warn('Workspace list load failed:', e);
  }
  if (renderAfter) render();
}

let startupProjectRestoreAttempted = false;

function startupCurrentWorkHasContent() {
  const factory = typeof factoryRuntimeReadFactory === 'function'
    ? factoryRuntimeReadFactory()
    : (state.factory || {});
  const product = factory?.product && typeof factory.product === 'object' ? factory.product : {};
  return !!(
    state.currentProjectId
    || state.productName
    || state.imageBase64
    || (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__')
    || state.analysis
    || Object.keys(state.sectionContents || {}).length
    || product.productName
    || product.imageBase64
    || (product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__')
    || product.hasImage
    || product.confirmedDb
    || product.finalDb
    || product.cafe24Product
  );
}

async function maybeRestoreLatestSavedProjectOnStartup(projects = []) {
  if (startupProjectRestoreAttempted) return false;
  startupProjectRestoreAttempted = true;
  if (!Array.isArray(projects) || !projects.length) return false;
  let bootstrap = null;
  try {
    bootstrap = typeof loadLastWorkBootstrap === 'function' ? loadLastWorkBootstrap() : null;
  } catch (_) {}
  const workspaceKind = String(bootstrap?.workspaceKind || '').trim();
  if (workspaceKind === 'blank-reset' || workspaceKind === 'content-draft') return false;
  const savedProjectBootstrap = workspaceKind === 'project';
  const savedProjectId = String(bootstrap?.currentProjectId || '').trim();
  const savedProjectName = String(bootstrap?.currentProjectName || '').trim();
  // 예전에는 여기 `|| projects[0]` 폴백이 있었다. 저장된 포인터가 없으면
  // **목록 맨 앞 문서를 묻지도 않고 열었다.** 그 자리를 배치 워커 문서가 차지하면서
  // 사용자가 만든 적 없는 작업이 열리고 제품명이 그 이름으로 바뀌었다.
  // 무엇을 이어서 열지 모르면 아무것도 열지 않는다. 화면의 '최근 작업파일' 목록에서
  // 사람이 직접 고르면 된다.
  const target = (savedProjectId && projects.find(project => project.id === savedProjectId))
    || (savedProjectName && projects.find(project => project.name === savedProjectName));
  if (!target?.id || typeof loadProjectRecord !== 'function') return false;
  if ((!savedProjectBootstrap && startupCurrentWorkHasContent())
    || state.workspaceDocumentDirty
    || state.projectBusy) return false;
  if (savedProjectBootstrap) {
    const currentFactory = typeof factoryRuntimeReadFactory === 'function'
      ? factoryRuntimeReadFactory()
      : state.factory;
    const candidateCount = factory => {
      const product = factory?.product && typeof factory.product === 'object' ? factory.product : {};
      return [
        product.dbCandidates,
        product.pendingDbCandidates,
        product.cafe24Candidates,
        product.pendingCafe24Candidates,
      ].reduce((count, candidates) => count + (Array.isArray(candidates) ? candidates.length : 0), 0);
    };
    const currentProjectId = String(
      state.currentProjectId
      || currentFactory?.currentProjectId
      || currentFactory?.workspace?.id
      || '',
    ).replace(/^project:/i, '').trim();
    if (currentProjectId && currentProjectId !== String(target.id).replace(/^project:/i, '').trim()) {
      return false;
    }
    if (candidateCount(currentFactory) > 0) return false;
    const savedProject = await workspaceGet(WORKSPACE_DB.projects, target.id).catch(() => null);
    const savedPayload = savedProject?.payload || {};
    const savedFactory = savedPayload.factory || savedPayload.assetPayload?.factory || {};
    if (candidateCount(savedFactory) === 0) return false;
  }
  const restored = await loadProjectRecord(target.id, { startupRestore: true });
  return !!restored;
}

async function saveCurrentProject(options = {}) {
  await settleWorkspaceScopeTransitionPersistence();
  const activeBranchScope = getCurrentLastWorkWorkspaceScope();
  const retainProjectAuthority = options?.retainProjectAuthority === true;
  let savedSuccessfully = false;
  workspaceScopeTransitionState.inProgress = true;
  state.projectBusy = true;
  render();
  try {
    const currentFactory = factoryRuntimeNormalizeFactorySnapshot(factoryRuntimeReadCommittedFactory());
    const previousWorkspaceId = factoryWorkspaceIdentityFromSource(currentFactory).id;
    const previousCandidateWorkspaceId = factoryCurrentWorkspaceId(currentFactory);
    const previousStoreWorkspaceId = String(
      factoryRuntimeStore?.getOperationToken?.()?.workspaceId || previousCandidateWorkspaceId,
    ).trim();
    const id = state.currentProjectId || uid('project');
    const existing = state.currentProjectId ? await workspaceGet(WORKSPACE_DB.projects, id) : null;
    const name = deriveProjectName();
    const createdAt = existing?.createdAt || state.currentProjectCreatedAt || Date.now();
    const authority = await ensureWorkspaceEditAuthority(`project:${id}`);
    if (authority?.mode !== 'editing') {
      throw new Error('이 작업은 다른 창에서 편집 중입니다. 편집권을 가져오거나 새 작업으로 저장하세요.');
    }
    const targetScopeId = `project:${id}`;
    const activeWorkIdentity = state.workIdentity || currentFactory.workIdentity || null;
    const restored = await workspacePersistenceApi().restore({
      scopeId: targetScopeId,
      sources: ['server'],
    }).catch(() => null);
    const restoredSnapshot = restored?.source === 'server' ? restored.snapshot : null;
    const restoredAssets = restoredSnapshot?.assets && typeof restoredSnapshot.assets === 'object'
      ? restoredSnapshot.assets
      : null;
    const restoredLightweight = restoredSnapshot?.lightweight && typeof restoredSnapshot.lightweight === 'object'
      ? restoredSnapshot.lightweight
      : null;
    const restoredPayload = !restoredAssets && !restoredLightweight
      && restoredSnapshot && typeof restoredSnapshot === 'object'
      ? restoredSnapshot
      : null;
    const activeIdentityKey = activeWorkIdentity?.initialProductKey || factoryObjectIdentityKey(currentFactory?.product || {});
    const restoredIdentityKey = (restoredAssets?.workIdentity || restoredLightweight?.workIdentity || restoredPayload?.workIdentity)?.initialProductKey
      || factoryObjectIdentityKey((restoredAssets?.factory || restoredLightweight?.factory || restoredPayload?.factory)?.product || {});
    const serverCompPage = restored?.source === 'server'
      && lastWorkSnapshotMatchesWorkspaceScope(restoredSnapshot, targetScopeId)
      && (!activeIdentityKey || !restoredIdentityKey || factoryIdentityKeysCompatible(activeIdentityKey, restoredIdentityKey))
      ? (restoredAssets?.compPage?.marketScrape && typeof restoredAssets.compPage.marketScrape === 'object'
        ? restoredAssets.compPage
        : (restoredLightweight?.compPage?.marketScrape && typeof restoredLightweight.compPage.marketScrape === 'object'
          ? restoredLightweight.compPage
          : (restoredPayload?.compPage?.marketScrape && typeof restoredPayload.compPage.marketScrape === 'object'
            ? restoredPayload.compPage
            : null)))
      : null;
    if (activeWorkIdentity?.workspaceId && activeWorkIdentity.workspaceId !== targetScopeId) {
      factoryBeginExplicitWorkIdentityTransition(currentFactory, 'project-scope-transition', { clearState: true });
    }
    state.currentProjectId = id;
    state.currentProjectName = name;
    state.currentProjectCreatedAt = createdAt;
    factoryStampWorkspaceIdentity(currentFactory, { projectId: id, projectName: name, createdAt });
    factoryMigrateReviewCandidateWorkspaceScope(currentFactory, previousCandidateWorkspaceId, id);
    factoryStampFactoryItemsWorkspaceIdentity(currentFactory, id, {
      previousWorkspaceId,
      force: !previousWorkspaceId || previousWorkspaceId === id || !existing,
    });
    if (previousStoreWorkspaceId !== id) {
      factoryRuntimeReplaceFactorySnapshot(currentFactory, {
        mode: 'hydrate',
        workspaceId: id,
        reason: 'project-save-workspace-transition',
        normalized: true,
      });
    }
    state.factory = factoryRuntimeDetachedValue(factoryRuntimeReadCommittedFactory());
    const existingOptionSorter = existing?.payload?.assetPayload?.optionSorter;
    const existingFactory = existing?.payload?.assetPayload?.factory || existing?.payload?.factory;
    const existingCompPage = existing?.payload?.assetPayload?.compPage || existing?.payload?.compPage || null;
    const existingWorkIdentity = existing?.payload?.workIdentity || existing?.payload?.assetPayload?.workIdentity || null;
    const existingWorkspaceId = String(
      existing?.payload?.workspaceScope?.id || existing?.payload?.assetPayload?.workspaceScope?.id || '',
    );
    const existingSameProjectScope = !!existing && existingWorkspaceId === targetScopeId;
    const existingSameFactoryWork = !!existing && (
      factoryIdentityKeysCompatible(
        factoryObjectIdentityKey(existingFactory?.product || {}),
        factoryObjectIdentityKey(currentFactory?.product || {}),
      ) || factoryIdentityKeysCompatible(
        existingWorkIdentity?.initialProductKey,
        activeWorkIdentity?.initialProductKey,
      ) || (existingSameProjectScope && (
        !existingWorkIdentity?.initialProductKey || !activeWorkIdentity?.initialProductKey
      ))
    );
    if (
      existingOptionSorter
      && existingSameFactoryWork
    ) {
      state.optionSorter = normalizeOptionSorterState(
        mergeOptionSorterStoredImages(existingOptionSorter, state.optionSorter || {}),
      );
    }
    // 여기도 펼치기라서 로컬 사본의 null 이 서버가 들고 있던 분석을 덮는다. buildWorkspacePayload 에
    // 보호를 넣어도 그 함수에 넘어가기 전에 이미 지워져 있으면 소용이 없다 - 실측 2026-08-31:
    // 마지막 저장이 "dropped protected work data: compPage.analysisResult" 로 26회 연속 거절됐다.
    // marketScrape 가 받는 보호를 분석 묶음에도 준다. "일부러 분리했다" 표시가 더 새로우면 그대로 비운다.
    const storedCompPage = serverCompPage && existingSameFactoryWork ? (() => {
      const merged = {
        ...serverCompPage,
        ...existingCompPage,
        ...(serverCompPage.marketScrape || existingCompPage.marketScrape
          ? { marketScrape: mergeCompMarketStoredState(serverCompPage.marketScrape || {}, existingCompPage.marketScrape || {}) }
          : {}),
      };
      const serverMark = Number(serverCompPage.analysisInvalidatedAt || 0);
      const existingMark = Number((existingCompPage || {}).analysisInvalidatedAt || 0);
      if (!(existingMark > serverMark)) {
        for (const key of ['analysisResult', 'sectionPlan', 'planEdits']) {
          merged[key] = mergeSameWorkDerivedValue(serverCompPage[key], (existingCompPage || {})[key]);
        }
      }
      return merged;
    })() : (serverCompPage || (existingSameFactoryWork ? existingCompPage : null));
    const backupPayload = compactProductImageBackupPayload();
    const backupRecord = backupPayload?.primary?.base64 ? {
      ...backupPayload,
      id: workspaceImageBackupKey('project', id),
      workspaceKind: 'project',
      workspaceId: id,
      savedAt: Date.now(),
    } : null;
    const productImageBackup = backupRecord
      ? workspaceImageBackupReferencePayload(backupRecord)
      : backupPayload;
    const record = {
      id,
      name,
      createdAt,
      updatedAt: Date.now(),
      batchStatus: existing?.batchStatus || null,
      payload: buildWorkspacePayload({
        productImageBackup,
        scopeId: targetScopeId,
        documentSnapshot: true,
        storedCompPage,
      }),
    };
    const scopeId = targetScopeId;
    const contentVersion = Number(state.contentVersion || 0);
    const records = [{ storeName: WORKSPACE_DB.projects, value: record }];
    if (backupRecord) records.unshift({ storeName: WORKSPACE_DB.appSettings, value: backupRecord });
    const commitResult = await workspacePersistenceApi().commit({
      scopeId,
      snapshot: record.payload,
      metadata: workspaceCommitMetadata(scopeId, 'project-save'),
      rebaseRevision: true,
      context: {
        indexeddb: { records },
        server: {
          serverSnapshot: buildFactoryProjectPersistenceServerSnapshot({
            snapshot: record.payload,
            scopeId,
          }, 'project-save'),
        },
      },
      isCurrent: () => state.currentProjectId === id
        && Number(state.contentVersion || 0) === contentVersion,
    });
    if (!commitResult.accepted) throw new Error(commitResult.failures?.[0]?.message || '권위 저장소 저장 실패');
    if (commitResult.protectedNoOp) {
      throw new Error(commitResult.reason || '최신 서버 저장본이 작업파일 저장을 보호했습니다. 상태를 새로고침한 뒤 다시 저장해주세요.');
    }
    if (!commitResult.clean) throw new Error(commitResult.failures?.[0]?.message || '저장 중 작업 내용이 변경되었습니다.');
    markWorkspaceDocumentClean();
    if (typeof factoryLog === 'function') {
      factoryLog(`현재 조립 작업 저장 완료: ${name}`, 'ok');
    }
    setUiNotice(`작업 저장 완료: ${name}`, 'ok');
    await refreshWorkspaceLists(false);
    savedSuccessfully = true;
  } catch (e) {
    state.error = `작업 저장 실패: ${e.message}`;
  } finally {
    if (!retainProjectAuthority) {
      try {
        await ensureWorkspaceEditAuthority(activeBranchScope, { force: true });
      } catch (authorityError) {
        state.error = state.error
          || `작업 저장 후 이 탭의 편집 브랜치를 복구하지 못했습니다: ${authorityError.message || String(authorityError)}`;
      }
    }
    const persistAfterTransition = workspaceScopeTransitionState.persistentSaveQueued;
    workspaceScopeTransitionState.inProgress = false;
    workspaceScopeTransitionState.persistentSaveQueued = false;
    state.projectBusy = false;
    render();
    if (!retainProjectAuthority && (savedSuccessfully || persistAfterTransition)) {
      savePersistentState({ server: false });
    }
  }
  return savedSuccessfully;
}

async function saveCurrentSnapshot() {
  const hasFactoryWork = !!(
    state.factory?.product?.productName ||
    state.factory?.product?.imageBase64 ||
    state.factory?.product?.confirmedDb && Object.keys(state.factory.product.confirmedDb || {}).length ||
    Array.isArray(state.factory?.assets) && state.factory.assets.length
  );
  if (!state.analysis && !Object.keys(state.sectionContents || {}).length && !hasFactoryWork) {
    state.error = '버전을 만들려면 먼저 작업물이 있어야 합니다.';
    render();
    return;
  }
  if (!state.currentProjectId) await saveCurrentProject();
  if (!state.currentProjectId) return;
  state.projectBusy = true;
  render();
  try {
    const snapshotId = uid('snapshot');
    const productImageBackup = await saveWorkspaceProductImageBackup('snapshot', snapshotId)
      .catch(() => compactProductImageBackupPayload());
    await workspacePut(WORKSPACE_DB.snapshots, {
      id: snapshotId,
      projectId: state.currentProjectId,
      projectName: deriveProjectName(),
      createdAt: Date.now(),
      label: new Date().toLocaleString('ko-KR'),
      payload: buildWorkspacePayload({
        productImageBackup,
        scopeId: `project:${state.currentProjectId}`,
        documentSnapshot: true,
      }),
    });
    if (typeof factoryLog === 'function') {
      factoryLog(`현재 조립 작업 버전 저장 완료: ${new Date().toLocaleString('ko-KR')}`, 'ok');
    }
    await refreshWorkspaceLists(false);
  } catch (e) {
    state.error = `버전 저장 실패: ${e.message}`;
  } finally {
    state.projectBusy = false;
    render();
  }
}

async function refreshLoadedWorkfileArchiveAssets(options = {}) {
  if (typeof factoryRefreshLocalArchiveAssets !== 'function') return false;
  const store = factoryRuntimeRequireStore();
  const operationToken = store.getOperationToken();
  try {
    await factoryRefreshLocalArchiveAssets({
      force: true,
      auto: true,
      silent: true,
      cacheMs: 0,
    });
    return store.isOperationCurrent(operationToken);
  } catch (error) {
    console.warn(`작업파일 로컬 보관 목록 자동 갱신 실패${options.source ? ` (${options.source})` : ''}:`, error);
    return false;
  }
}

async function ensureExplicitProjectLoadAuthority(options = {}) {
  const branchScope = options.preserveCurrentScope === true
    ? getCurrentLastWorkWorkspaceScope()
    : rotateLastWorkDraftScope();
  await settleLastWorkDraftScopePersistence(branchScope);
  const authority = await ensureWorkspaceEditAuthority(branchScope, { force: true });
  if (!['editing', 'offline-edit'].includes(authority?.mode)
    || authority.scopeId !== branchScope) {
    throw new Error('이 탭의 독립 편집 브랜치를 열지 못했습니다. 현재 문서는 변경하지 않았습니다.');
  }
  return { branchScope, authority };
}

async function loadProjectRecord(projectId, options = {}) {
  const loadTimingStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const loadTiming = { projectId: String(projectId || ''), phases: [] };
  const recordLoadTiming = phase => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    loadTiming.phases.push({ phase, elapsedMs: Math.round(now - loadTimingStartedAt) });
    if (typeof window !== 'undefined') window.__KUASANGSE_PROJECT_LOAD_TIMING__ = loadTiming;
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.kuasangseProjectLoadTiming = JSON.stringify(loadTiming);
    }
  };
  recordLoadTiming('start');
  const leave = options.checkpointRestore === true
    ? 'continue'
    : options.startupRestore === true
      && !state.workspaceDocumentDirty
      && !state.projectBusy
      ? 'continue'
      : await confirmSaveBeforeLeavingWorkspace('다른 작업 불러오기');
  if (leave === 'cancel') return null;
  await settleWorkspaceScopeTransitionPersistence();
  workspaceScopeTransitionState.inProgress = true;
  let resetBoundaryStarted = false;
  let visualValidationBatch = null;
  let liveStateBackup = null;
  let factoryStoreBackup = null;
  let factoryOperationBackup = null;
  let previousAuthority = null;
  let targetBranchScope = '';
  let targetAuthorityAcquired = false;
  let liveMutationStarted = false;
  let durableSessionCompleted = false;
  try {
    const project = await workspaceGet(WORKSPACE_DB.projects, projectId);
    recordLoadTiming('project-read');
    if (!project) throw new Error('저장된 작업을 찾을 수 없습니다.');
    const projectIdentityValidation = workspacePersistenceApi().validateSnapshotIdentity(project.payload);
    if (!projectIdentityValidation.ok) {
      throw new Error(workspaceIdentityFailureMessage(projectIdentityValidation, '최근 작업 복원'));
    }
    const hydratedPayload = await hydrateWorkspacePayloadImageBackup(project.payload);
    compactFactoryProjectFileCanonicalInputImages(hydratedPayload);
    recordLoadTiming('image-mirrors-compacted');
    previousAuthority = currentWorkspaceAuthority();
    const explicitLoad = await ensureExplicitProjectLoadAuthority({
      preserveCurrentScope: options.startupRestore === true,
    });
    targetBranchScope = explicitLoad.branchScope;
    const targetAuthority = explicitLoad.authority;
    const currentTargetAuthority = currentWorkspaceAuthority();
    if (!['editing', 'offline-edit'].includes(targetAuthority?.mode)
      || targetAuthority.scopeId !== targetBranchScope
      || !['editing', 'offline-edit'].includes(currentTargetAuthority?.mode)
      || currentTargetAuthority.scopeId !== targetBranchScope) {
      throw new Error('이 탭의 독립 편집 브랜치를 열지 못했습니다.');
    }
    targetAuthorityAcquired = previousAuthority?.scopeId !== targetBranchScope;
    recordLoadTiming('branch-authority-ready');
    if (typeof structuredClone !== 'function') {
      throw new Error('이 브라우저는 안전한 최근 작업 복원을 지원하지 않습니다.');
    }
    const payload = structuredClone(hydratedPayload);
    const factoryStore = factoryRuntimeRequireStore();
    liveStateBackup = structuredClone(state);
    factoryStoreBackup = factoryRuntimeDetachedValue(factoryStore.getSnapshot());
    factoryOperationBackup = factoryStore.getOperationToken();
    recordLoadTiming('rollback-snapshots-ready');
    liveMutationStarted = true;
    const preserveCurrentWork = projectRestorePreservesCurrentWork(project.id, options);
    if (typeof markWorkspaceBlankResetBoundary === 'function') {
      markWorkspaceBlankResetBoundary();
      resetBoundaryStarted = true;
    }
    visualValidationBatch = factoryBeginVisualValidationRenderBatch();
    resetLiveWorkspaceForProjectFileReplacement({ preserveCurrentWork });
    applyWorkspacePayload(payload, {
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      skipPersistence: true,
      skipSideEffects: true,
      replaceWorkspace: true,
      preserveCurrentWork,
      preserveFallback: { ...liveStateBackup, factory: factoryStoreBackup },
      payloadAlreadyDetached: true,
    });
    recordLoadTiming('payload-applied');
    await new Promise(resolve => setTimeout(resolve, 0));
    factoryPrimeCurrentAssetVisualValidation(factoryRuntimeDetachedValue(factoryRuntimeReadFactory()));
    await factoryWaitForVisualValidationOperation(visualValidationBatch.token);
    recordLoadTiming('visual-validation-ready');
    await new Promise(resolve => setTimeout(resolve, 0));
    const loadOperationToken = factoryRuntimeRequireStore().getOperationToken();
    const authorityBeforePersist = currentWorkspaceAuthority();
    if (!['editing', 'offline-edit'].includes(authorityBeforePersist?.mode)
      || authorityBeforePersist.scopeId !== targetBranchScope
      || (targetAuthority?.fencingToken
        && authorityBeforePersist.fencingToken !== targetAuthority.fencingToken)
      || !factoryRuntimeRequireStore().isOperationCurrent(loadOperationToken)) {
      throw new Error('최근 작업을 적용하는 동안 편집권이 변경되었습니다. 이전 작업으로 되돌립니다.');
    }
    persistAppliedWorkspacePayloadSideEffects({ skipPersistentState: true });
    recordLoadTiming('side-effects-applied');
    markWorkspaceDocumentClean();
    workspaceScopeTransitionState.inProgress = false;
    const sessionPersisted = options.checkpointRestore === true
      ? true
      : await flushQueuedPersistentState({
        skipVisibleSync: true,
        deferWarningRender: true,
        allowBlankResetCheckpoint: true,
        expectedWorkspaceScope: targetBranchScope,
        expectedWorkspaceResetToken: workspaceBlankResetToken,
      });
    if (!sessionPersisted) {
      throw new Error('최근 작업의 새로고침 복구용 세션을 저장하지 못했습니다.');
    }
    recordLoadTiming('reload-checkpoint-saved');
    durableSessionCompleted = true;
    await refreshLoadedWorkfileArchiveAssets({ source: 'recent-workfile' });
    recordLoadTiming('local-archive-refreshed');
    try {
      if (typeof factoryLog === 'function') {
        factoryLog(`작업 불러오기 완료: ${project.name || project.id}`, 'ok');
      }
    } catch (error) {
      console.warn('최근 작업 복원 완료 로그 기록 실패:', error);
    }
    setUiNotice(`작업 불러옴: ${project.name || project.id} (단계·이미지·후보 포함)`, 'ok');
    recordLoadTiming('complete');
    return project;
  } catch (e) {
    recordLoadTiming('error');
    let rollbackFailure = null;
    if (liveMutationStarted
      && liveStateBackup
      && factoryStoreBackup
      && factoryOperationBackup
      && !durableSessionCompleted) {
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, liveStateBackup);
      try {
        factoryRuntimeRequireStore().switchWorkspace(factoryOperationBackup.workspaceId, {
          snapshot: factoryStoreBackup,
          revision: factoryOperationBackup.revision,
        });
      } catch (restoreError) {
        rollbackFailure = restoreError;
      }
      if (targetAuthorityAcquired) {
        try {
          if (previousAuthority?.scopeId && ['editing', 'offline-edit'].includes(previousAuthority.mode)) {
            await ensureWorkspaceEditAuthority(previousAuthority.scopeId);
          } else {
            const lock = workspaceLockApi();
            const current = lock?.snapshot?.();
            if (current?.scopeId === targetBranchScope && current.mode === 'editing') await lock.release();
          }
        } catch (authorityRestoreError) {
          rollbackFailure ||= authorityRestoreError;
        }
      }
    }
    const reportedError = rollbackFailure
      ? new Error(
        `최근 작업 복원 실패 후 이전 작업 상태를 되돌리지 못했습니다: ${rollbackFailure.message || String(rollbackFailure)}`,
        { cause: e },
      )
      : e;
    state.error = `작업 불러오기 실패: ${reportedError.message || String(reportedError)}`;
    return null;
  } finally {
    workspaceScopeTransitionState.inProgress = false;
    if (visualValidationBatch) factoryEndVisualValidationRenderBatch(visualValidationBatch);
    if (resetBoundaryStarted && typeof completeWorkspaceBlankResetBoundary === 'function') {
      completeWorkspaceBlankResetBoundary();
    }
    render();
    recordLoadTiming('rendered');
  }
}

async function loadSnapshotRecord(snapshotId) {
  const leave = await confirmSaveBeforeLeavingWorkspace('저장 버전 불러오기');
  if (leave === 'cancel') return null;
  await settleWorkspaceScopeTransitionPersistence();
  workspaceScopeTransitionState.inProgress = true;
  state.projectBusy = true;
  let resetBoundaryStarted = false;
  let visualValidationBatch = null;
  let liveStateBackup = null;
  let factoryStoreBackup = null;
  let factoryOperationBackup = null;
  let previousAuthority = null;
  let targetBranchScope = '';
  let targetAuthorityAcquired = false;
  let liveMutationStarted = false;
  let durableSessionCompleted = false;
  try {
    const snapshot = await workspaceGet(WORKSPACE_DB.snapshots, snapshotId);
    if (!snapshot) throw new Error('저장된 버전을 찾을 수 없습니다.');
    previousAuthority = currentWorkspaceAuthority();
    const explicitLoad = await ensureExplicitProjectLoadAuthority();
    targetBranchScope = explicitLoad.branchScope;
    const targetAuthority = explicitLoad.authority;
    const currentTargetAuthority = currentWorkspaceAuthority();
    if (!['editing', 'offline-edit'].includes(targetAuthority?.mode)
      || targetAuthority.scopeId !== targetBranchScope
      || !['editing', 'offline-edit'].includes(currentTargetAuthority?.mode)
      || currentTargetAuthority.scopeId !== targetBranchScope) {
      throw new Error('이 탭의 독립 편집 브랜치를 열지 못했습니다.');
    }
    targetAuthorityAcquired = previousAuthority?.scopeId !== targetBranchScope;
    if (typeof structuredClone !== 'function') {
      throw new Error('이 브라우저는 안전한 버전 복원을 지원하지 않습니다.');
    }
    const payload = structuredClone(await hydrateWorkspacePayloadImageBackup(snapshot.payload));
    const factoryStore = factoryRuntimeRequireStore();
    liveStateBackup = structuredClone(state);
    factoryStoreBackup = factoryRuntimeDetachedValue(factoryStore.getSnapshot());
    factoryOperationBackup = factoryStore.getOperationToken();
    liveMutationStarted = true;
    const preserveCurrentWork = projectRestorePreservesCurrentWork(snapshot.projectId);
    if (typeof markWorkspaceBlankResetBoundary === 'function') {
      markWorkspaceBlankResetBoundary();
      resetBoundaryStarted = true;
    }
    visualValidationBatch = factoryBeginVisualValidationRenderBatch();
    resetLiveWorkspaceForProjectFileReplacement({ preserveCurrentWork });
    applyWorkspacePayload(payload, {
      projectId: snapshot.projectId,
      projectName: snapshot.projectName,
      skipPersistence: true,
      skipSideEffects: true,
      replaceWorkspace: true,
      preserveCurrentWork,
      preserveFallback: { ...liveStateBackup, factory: factoryStoreBackup },
      payloadAlreadyDetached: true,
    });
    state.currentProjectName = snapshot.projectName || state.currentProjectName;
    await new Promise(resolve => setTimeout(resolve, 0));
    factoryPrimeCurrentAssetVisualValidation(factoryRuntimeDetachedValue(factoryRuntimeReadFactory()));
    await factoryWaitForVisualValidationOperation(visualValidationBatch.token);
    await new Promise(resolve => setTimeout(resolve, 0));
    const restoreOperationToken = factoryRuntimeRequireStore().getOperationToken();
    const authorityBeforePersist = currentWorkspaceAuthority();
    if (!['editing', 'offline-edit'].includes(authorityBeforePersist?.mode)
      || authorityBeforePersist.scopeId !== targetBranchScope
      || (targetAuthority?.fencingToken
        && authorityBeforePersist.fencingToken !== targetAuthority.fencingToken)
      || !factoryRuntimeRequireStore().isOperationCurrent(restoreOperationToken)) {
      throw new Error('저장 버전을 적용하는 동안 편집 브랜치가 변경되었습니다. 이전 작업으로 되돌립니다.');
    }
    persistAppliedWorkspacePayloadSideEffects({ skipPersistentState: true });
    markWorkspaceDocumentDirty();
    workspaceScopeTransitionState.inProgress = false;
    const sessionPersisted = await flushQueuedPersistentState({
      skipVisibleSync: true,
      deferWarningRender: true,
      allowBlankResetCheckpoint: true,
      expectedWorkspaceScope: targetBranchScope,
      expectedWorkspaceResetToken: workspaceBlankResetToken,
    });
    if (!sessionPersisted) {
      throw new Error('복원한 버전의 새로고침 복구용 탭 브랜치를 저장하지 못했습니다.');
    }
    durableSessionCompleted = true;
    if (typeof factoryLog === 'function') {
      factoryLog(`저장 버전 불러오기 완료: ${snapshot.label || snapshot.projectName || snapshot.id}`, 'ok');
    }
    setUiNotice('저장 버전을 이 탭의 독립 브랜치로 불러왔습니다. 저장 전까지 원본 작업파일은 바뀌지 않습니다.', 'ok');
    await refreshWorkspaceLists(false);
    await refreshLoadedWorkfileArchiveAssets({ source: 'saved-version' });
    return snapshot;
  } catch (e) {
    let rollbackFailure = null;
    if (liveMutationStarted
      && liveStateBackup
      && factoryStoreBackup
      && factoryOperationBackup
      && !durableSessionCompleted) {
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, liveStateBackup);
      try {
        factoryRuntimeRequireStore().switchWorkspace(factoryOperationBackup.workspaceId, {
          snapshot: factoryStoreBackup,
          revision: factoryOperationBackup.revision,
        });
      } catch (restoreError) {
        rollbackFailure = restoreError;
      }
    }
    if (targetAuthorityAcquired && !durableSessionCompleted) {
      try {
        if (previousAuthority?.scopeId && ['editing', 'offline-edit'].includes(previousAuthority.mode)) {
          await ensureWorkspaceEditAuthority(previousAuthority.scopeId);
        } else {
          const lock = workspaceLockApi();
          const current = lock?.snapshot?.();
          if (current?.scopeId === targetBranchScope && current.mode === 'editing') await lock.release();
        }
      } catch (authorityRestoreError) {
        rollbackFailure ||= authorityRestoreError;
      }
    }
    const reportedError = rollbackFailure
      ? new Error(
        `버전 복원 실패 후 이전 작업 상태를 되돌리지 못했습니다: ${rollbackFailure.message || String(rollbackFailure)}`,
        { cause: e },
      )
      : e;
    state.error = `버전 복원 실패: ${reportedError.message || String(reportedError)}`;
    return null;
  } finally {
    workspaceScopeTransitionState.inProgress = false;
    state.projectBusy = false;
    if (visualValidationBatch) factoryEndVisualValidationRenderBatch(visualValidationBatch);
    if (resetBoundaryStarted && typeof completeWorkspaceBlankResetBoundary === 'function') {
      completeWorkspaceBlankResetBoundary();
    }
    render();
  }
}

function factoryProjectFileSummary(payload = {}) {
  const factory = payload.factory || payload.assetPayload?.factory || {};
  const product = factory.product || {};
  const assets = [
    ...(Array.isArray(factory.assets) ? factory.assets : []),
    ...(Array.isArray(factory.archive?.localAssets) ? factory.archive.localAssets : []),
  ];
  const stageCounts = {};
  assets.forEach(asset => {
    const stageId = String(asset?.stageId || 'unknown');
    stageCounts[stageId] = (stageCounts[stageId] || 0) + 1;
  });
  const sectionContents = payload.sectionContents || payload.assetPayload?.sectionContents || {};
  const sectionImages = payload.sectionImages || payload.assetPayload?.sectionImages || {};
  const completedSectionIds = new Set([
    ...Object.keys(sectionContents || {}).filter(id => !!sectionContents[id]),
    ...Object.keys(sectionImages || {}).filter(id => !!sectionImages[id]),
  ]);
  return {
    productName: product.productName || payload.productName || payload.name || '',
    workspaceId: payload.currentProjectId || factory.workspace?.id || '',
    assets: assets.length,
    stageCounts,
    sections: completedSectionIds.size,
    hasProductImage: !!(
      payload.imageBase64 ||
      payload.imagePreview ||
      payload.assetPayload?.imageBase64 ||
      product.imageBase64 ||
      product.imagePreview ||
      payload.productImageBackup?.primary?.base64
    ),
  };
}

function factoryProjectFileImageValueKind(value = '', key = '') {
  const text = String(value || '').trim();
  if (!text || text === IMAGE_STORED_MARKER || text === '__stored_in_indexeddb__') return '';
  if (/^data:image\//i.test(text)) return 'inline-data-url';
  if (/^https?:\/\//i.test(text) || /^\/static\//i.test(text) || /^backend\//i.test(text) || /^\/api\/local-archive\/assets\/[^/?#]+\/image(?:[?#].*)?$/i.test(text) || /^[A-Za-z]:[\\/]/.test(text)) {
    return 'reference';
  }
  const keyHint = /(image|preview|base64|dataurl|data_url|thumbnail|thumb|src|url|path)$/i.test(String(key || ''));
  if (!keyHint || text.length < 80) return '';
  const sample = text.slice(0, Math.min(320, text.length)).replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/=_-]+$/.test(sample)) return 'inline-base64';
  return '';
}

function factoryProjectFileImageFingerprint(value = '') {
  const text = String(value || '');
  if (!text) return '';
  let hashA = 2166136261;
  let hashB = 2246822507;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    hashA ^= code;
    hashA = Math.imul(hashA, 16777619);
    hashB ^= code + i;
    hashB = Math.imul(hashB, 3266489909);
  }
  return `${text.length}:${(hashA >>> 0).toString(36)}:${(hashB >>> 0).toString(36)}`;
}

function factoryProjectFileScopeFromSource(source = {}, fallback = {}) {
  const metadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const sourceMap = source?.sourceMap && typeof source.sourceMap === 'object' ? source.sourceMap : {};
  const productName = String(
    source?.productName ||
    metadata.productName ||
    sourceMap.productName ||
    fallback.productName ||
    ''
  ).trim();
  const productKey = factoryNormalizeIdentityText(
    source?.productKey ||
    source?.productIdentityKey ||
    metadata.productKey ||
    metadata.productIdentityKey ||
    sourceMap.productKey ||
    sourceMap.productIdentityKey ||
    fallback.productKey ||
    productName
  );
  return {
    workspaceId: String(
      source?.workspaceId ||
      source?.currentProjectId ||
      metadata.workspaceId ||
      metadata.currentProjectId ||
      sourceMap.workspaceId ||
      sourceMap.currentProjectId ||
      fallback.workspaceId ||
      ''
    ).trim(),
    currentRunId: String(
      source?.currentRunId ||
      source?.generationRunId ||
      metadata.currentRunId ||
      metadata.generationRunId ||
      sourceMap.currentRunId ||
      sourceMap.generationRunId ||
      fallback.currentRunId ||
      ''
    ).trim(),
    productKey,
    productName,
    inputImageFingerprint: String(
      source?.lockedInputImageFingerprint ||
      source?.inputImageFingerprint ||
      source?.inputImageKey ||
      source?.sourceImageKey ||
      source?.productImageKey ||
      metadata.lockedInputImageFingerprint ||
      metadata.inputImageFingerprint ||
      metadata.inputImageKey ||
      metadata.sourceImageKey ||
      metadata.productImageKey ||
      sourceMap.inputImageFingerprint ||
      sourceMap.inputImageKey ||
      sourceMap.sourceImageKey ||
      sourceMap.productImageKey ||
      fallback.inputImageFingerprint ||
      ''
    ).trim(),
    stageId: String(
      source?.stageId ||
      metadata.stageId ||
      sourceMap.stageId ||
      sourceMap.importedStageId ||
      fallback.stageId ||
      ''
    ).trim(),
    sectionId: String(
      source?.sectionId ||
      metadata.sectionId ||
      sourceMap.sectionId ||
      fallback.sectionId ||
      ''
    ).trim(),
    assetId: String(
      source?.assetId ||
      source?.id ||
      metadata.assetId ||
      sourceMap.assetId ||
      fallback.assetId ||
      ''
    ).trim(),
  };
}

function factoryProjectFileBuildManifest(payload = {}, identity = {}, options = {}) {
  const assetPayload = payload.assetPayload && typeof payload.assetPayload === 'object' ? payload.assetPayload : {};
  const factory = assetPayload.factory || payload.factory || {};
  const product = factory.product || {};
  const baseScope = factoryProjectFileScopeFromSource(product, {
    workspaceId: identity.id || payload.currentProjectId || factory.workspace?.id || '',
    productName: product.productName || payload.productName || identity.name || '',
    productKey: typeof factoryCurrentProductKey === 'function' ? factoryCurrentProductKey(factory) : '',
    currentRunId: typeof factoryCurrentWorkflowRunId === 'function' ? factoryCurrentWorkflowRunId(factory) : '',
    inputImageFingerprint: typeof factoryCurrentInputImageFingerprint === 'function' ? factoryCurrentInputImageFingerprint(factory, { includeDerived: true }) : '',
  });
  const imageEntries = [];
  const seen = new Set();
  const addImage = (pathName, value, source = {}, fallback = {}) => {
    const kind = factoryProjectFileImageValueKind(value, pathName.split('.').pop());
    if (!kind) return;
    const fingerprint = options.legacyFingerprint === true
      ? factoryImagePayloadFingerprint(value)
      : factoryProjectFileImageFingerprint(value);
    const dedupeKey = `${pathName}|${fingerprint || String(value || '').slice(0, 120)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    const scope = factoryProjectFileScopeFromSource(source, { ...baseScope, ...fallback });
    imageEntries.push({
      path: pathName,
      kind,
      length: String(value || '').length,
      fingerprint,
      workspaceId: scope.workspaceId,
      currentRunId: scope.currentRunId,
      productKey: scope.productKey,
      inputImageFingerprint: scope.inputImageFingerprint,
      stageId: scope.stageId,
      sectionId: scope.sectionId,
      assetId: scope.assetId,
    });
  };
  const scan = (value, pathName, fallback = {}, depth = 0) => {
    if (depth > 32) throw new Error(`작업파일 이미지 구조가 허용 깊이를 초과했습니다: ${pathName}`);
    if (value == null) return;
    const scopedFallback = { ...fallback };
    if (!scopedFallback.stageId) {
      if (/sectionImages|detailImageBlocks|fixedDetailImages|sectionVariants/i.test(pathName)) scopedFallback.stageId = 'detail';
      else if (/cuts/i.test(pathName)) scopedFallback.stageId = 'cuts';
      else if (/optionSorter/i.test(pathName)) scopedFallback.stageId = 'options';
      else if (/analysisImages|productImageBackup|factory\.product\.inputImages|imageBase64|imagePreview/i.test(pathName)) scopedFallback.stageId = 'input';
    }
    if (!scopedFallback.sectionId) {
      const sectionMatch = /sectionImages\.([A-Za-z0-9_-]+)/.exec(pathName) || /sectionVariants\.([A-Za-z0-9_-]+)/.exec(pathName);
      if (sectionMatch?.[1]) scopedFallback.sectionId = sectionMatch[1];
    }
    if (typeof value === 'string') {
      addImage(pathName, value, scopedFallback, scopedFallback);
      return;
    }
    if (typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${pathName}[${index}]`, scopedFallback, depth + 1));
      return;
    }
    const nextFallback = factoryProjectFileScopeFromSource(value, scopedFallback);
    Object.keys(value).forEach(key => {
      if (key === 'projectFileManifest' || key === 'imageLoadFailedSrc') return;
      scan(value[key], `${pathName}.${key}`, nextFallback, depth + 1);
    });
  };

  scan(assetPayload, 'assetPayload', baseScope);
  scan(payload.productImageBackup, 'productImageBackup', baseScope);

  const requiredScopes = ['currentRunId', 'productKey', 'inputImageFingerprint', 'stageId'];
  const scopedImages = imageEntries.filter(entry =>
    ['hero', 'size', 'cuts', 'detail', 'options'].includes(String(entry.stageId || '')) ||
    /factory\.assets|sectionImages|detailImageBlocks|sectionVariants|cuts|optionSorter/i.test(entry.path)
  );
  const missingScopedFields = scopedImages
    .map(entry => ({
      path: entry.path,
      missing: requiredScopes.filter(field => !entry[field]),
    }))
    .filter(row => row.missing.length);

  return {
    schema: 'kuasangse.factory.project.manifest',
    version: 1,
    createdAt: Date.now(),
    identity: {
      projectId: identity.id || payload.currentProjectId || factory.workspace?.id || '',
      workspaceId: identity.id || payload.currentProjectId || factory.workspace?.id || '',
      projectName: identity.name || payload.currentProjectName || product.productName || payload.productName || '',
      productName: product.productName || payload.productName || identity.name || '',
      currentRunId: baseScope.currentRunId,
      productKey: baseScope.productKey,
      inputImageFingerprint: baseScope.inputImageFingerprint,
      activeStep: payload.step || assetPayload.step || state.step || '',
      activeFactoryTab: factory.automation?.activeTab || '',
      stageIds: Object.keys(factory.stages || {}),
    },
    images: {
      total: imageEntries.length,
      inline: imageEntries.filter(entry => entry.kind !== 'reference').length,
      references: imageEntries.filter(entry => entry.kind === 'reference').length,
      scoped: scopedImages.length,
      entries: imageEntries,
      missingScopedFields,
    },
    archive: {
      localAssets: Array.isArray(factory.archive?.localAssets) ? factory.archive.localAssets.length : 0,
      note: 'Manifest records archive references only; output/local-archive files are not deleted or packed by new-file reset.',
    },
  };
}

function factoryProjectFileCurrentImageEntry(entry = {}) {
  const path = String(entry.path || '');
  if (!path || /\.previousAssets(?:\[|\.)|\.archive\.|\.cuts\.(?:prompts|sizePrompts)(?:\[|\.)/i.test(path)) return false;
  return /assetPayload\.factory\.assets(?:\[|\.)|assetPayload\.factory\.product\.(?:imageBase64|imagePreview|inputImages)(?:\[|\.)|sectionImages|detailImageBlocks|fixedDetailImages|sectionVariants|cuts|optionSorter/i.test(path);
}

function factoryProjectFileExpectedStageForPath(path = '') {
  const value = String(path || '');
  if (/optionSorter/i.test(value)) return 'options';
  if (/sectionImages|detailImageBlocks|fixedDetailImages|sectionVariants/i.test(value)) return 'detail';
  if (/\.cuts\./i.test(value)) return 'cuts';
  if (/factory\.product\.(?:imageBase64|imagePreview|inputImages)|analysisImages|productImageBackup/i.test(value)) return 'input';
  return '';
}

function factoryProjectFileAssetMatchesCurrentScope(asset = {}, factory = {}, identity = {}) {
  const stageId = String(asset.stageId || asset.metadata?.stageId || asset.sourceMap?.stageId || '').trim();
  const stage = factory.stages?.[stageId] || {};
  const expectedRunId = String(stage.latestGenerationRunId || stage.currentRunId || '').trim();
  const actualRunId = String(asset.currentRunId || asset.generationRunId || asset.metadata?.currentRunId || asset.sourceMap?.currentRunId || '').trim();
  const actualProductKey = factoryNormalizeIdentityText(asset.productKey || asset.metadata?.productKey || asset.sourceMap?.productKey || '');
  const actualFingerprint = String(asset.inputImageFingerprint || asset.metadata?.inputImageFingerprint || asset.sourceMap?.inputImageFingerprint || '').trim();
  const actualWorkspaceId = String(asset.workspaceId || asset.currentProjectId || asset.metadata?.workspaceId || asset.sourceMap?.workspaceId || '').trim();
  return !!(
    stageId &&
    expectedRunId &&
    actualRunId === expectedRunId &&
    actualProductKey === factoryNormalizeIdentityText(identity.productKey || '') &&
    actualFingerprint === String(identity.inputImageFingerprint || '').trim() &&
    actualWorkspaceId === String(identity.workspaceId || identity.projectId || '').trim()
  );
}

function factoryProjectFileStartupRecoveryLog(log = {}) {
  const message = String(log?.message || '');
  return /(?:생성 중 표시|생성 종료 표시|완료된 생성 표시|오래 멈춘 생성 표시)\s*(?:\d+개?)?[^.]*정리했습니다\./.test(message) ||
    /(?:대표이미지|사이즈이미지|이미지컷|이미지 생성).*상태 복구 완료:.*진행 표시.*(?:응답 제한|시간 초과)/.test(message);
}

function factoryHasActiveRecoveryFailure(factory = {}) {
  const stages = factory?.stages || {};
  const stageFailure = ['hero', 'size', 'cuts'].some(stageId => stages[stageId]?.status === 'error');
  const goal = factory?.goalRun || {};
  const goalFailure = !!(goal.failureReason && goal.activeOperationId);
  const runtimeToken = !!(
    (typeof factoryActiveImageRequestKeys !== 'undefined' && factoryActiveImageRequestKeys.size) ||
    (typeof factoryActiveImageStageRunKeys !== 'undefined' && factoryActiveImageStageRunKeys.size)
  );
  const cuts = typeof state !== 'undefined' ? state.cuts || {} : {};
  const promptFailure = [...(cuts.prompts || []), ...(cuts.sizePrompts || [])]
    .some(prompt => {
      const pageSessionId = String(prompt?.generationPageSessionId || prompt?.metadata?.generationPageSessionId || '');
      return !!(prompt?.generating && (prompt.error || prompt.warning) &&
        typeof FACTORY_IMAGE_GENERATION_PAGE_SESSION_ID !== 'undefined' &&
        pageSessionId === FACTORY_IMAGE_GENERATION_PAGE_SESSION_ID);
    });
  return promptFailure || (runtimeToken && (stageFailure || goalFailure));
}

function factoryProjectFileTransientDiagnosticLog(log = {}) {
  const message = String(log?.message || '');
  return factoryProjectFileStartupRecoveryLog(log) ||
    /이미지 원본을 표시할 수 없어 기본 후보에서 분리/.test(message) ||
    /현재 작업키가 맞는 생성 결과 .*색상 차이가 있어도 기본 후보에 유지/.test(message) ||
    /색상 검수 (?:완료|확인 실패).*(?:현재 작업 후보로 유지|후보는 현재 작업 기준으로 유지)/.test(message) ||
    /(?:자동 로컬 보관|로컬 보관 목록|제품 원본 로컬 보관).*(?:Failed to fetch|fetch failed|network error)/i.test(message) ||
    /Cafe24 OAuth (?:자동 점검:\s*)?재연결 필요/i.test(message) ||
    /Cafe24 OAuth.*(?:access 토큰이 만료|재연결이 필요)/i.test(message);
}

function factoryRetireProjectFileTransientDiagnostics(factory = {}) {
  if (!factory || typeof factory !== 'object') return factory;
  const activeRecoveryFailure = factoryHasActiveRecoveryFailure(factory);
  factory.assets = (Array.isArray(factory.assets) ? factory.assets : []).map(asset => {
    const metadata = asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata : {};
    const retryableReference = [
      asset?.image, asset?.dataUrl, asset?.result, asset?.imageUrl, asset?.thumbnailUrl,
      metadata.image, metadata.result, metadata.preview, metadata.dataUrl, metadata.imageUrl,
      asset?.sourceMap?.imageUrl, asset?.localArchive?.imageUrl,
    ].some(value => typeof value === 'string' && value.trim());
    if (!retryableReference) return asset;
    const next = { ...asset, metadata: { ...metadata } };
    delete next.imageLoadFailed;
    delete next.imageLoadFailedSrc;
    delete next.metadata.imageLoadFailed;
    delete next.metadata.imageLoadFailedAt;
    delete next.metadata.imageLoadFailedSrc;
    delete next.metadata.imageLoadFailedReason;
    return next;
  });
  factory.logs = (Array.isArray(factory.logs) ? factory.logs : [])
    .filter(log => {
      if (factoryProjectFileStartupRecoveryLog(log)) {
        return activeRecoveryFailure && log?.activeDiagnostic === true;
      }
      return !factoryProjectFileTransientDiagnosticLog(log) || log?.activeDiagnostic === true;
    });
  if (factory.archive && typeof factory.archive === 'object') {
    factory.archive = { ...factory.archive };
    if (/(?:Failed to fetch|fetch failed|network error)/i.test(String(factory.archive.localAssetsError || ''))) {
      factory.archive.localAssetsError = '';
    }
    if (/(?:로컬 보관|local archive).*(?:Failed to fetch|fetch failed|network error)/i.test(String(factory.archive.localStatus || ''))) {
      factory.archive.localStatus = '';
    }
  }
  return factory;
}

function prepareFactoryProjectFilePayload(payload = {}, manifest = {}) {
  const prepared = {
    ...payload,
    cuts: payload.cuts ? cloneData(payload.cuts) : payload.cuts,
    factory: payload.factory ? cloneData(payload.factory) : payload.factory,
    assetPayload: payload.assetPayload ? {
      ...payload.assetPayload,
      cuts: payload.assetPayload.cuts ? cloneData(payload.assetPayload.cuts) : payload.assetPayload.cuts,
      factory: payload.assetPayload.factory ? cloneData(payload.assetPayload.factory) : payload.assetPayload.factory,
    } : payload.assetPayload,
  };
  const identity = manifest.identity || {};
  const isolateCutPromptImages = cuts => {
    if (!cuts || typeof cuts !== 'object') return;
    ['prompts', 'sizePrompts'].forEach(key => {
      if (!Array.isArray(cuts[key])) return;
      const expectedStageId = key === 'sizePrompts' ? 'size' : 'cuts';
      cuts[key] = cuts[key].map(prompt => {
        const scope = factoryProjectFileScopeFromSource(prompt);
        const matches = !!(
          scope.workspaceId === String(identity.workspaceId || identity.projectId || '').trim() &&
          scope.currentRunId === String(identity.currentRunId || '').trim() &&
          factoryNormalizeIdentityText(scope.productKey) === factoryNormalizeIdentityText(identity.productKey || '') &&
          scope.inputImageFingerprint === String(identity.inputImageFingerprint || '').trim() &&
          scope.stageId === expectedStageId
        );
        if (matches) return prompt;
        const next = { ...prompt, generating: false };
        [
          'result', 'image', 'imageUrl', 'dataUrl', 'preview', 'thumbnail', 'thumbnailUrl', 'src', 'base64',
          'archiveId', 'localArchiveId', 'localArchive', 'metadata', 'sourceMap', 'resultAssetId', 'resultImageUrl',
        ].forEach(field => { delete next[field]; });
        return next;
      });
    });
  };
  const isolateFactoryAssets = factory => {
    if (!factory || typeof factory !== 'object') return;
    const currentAssets = Array.isArray(factory.assets) ? factory.assets : [];
    const previousAssets = Array.isArray(factory.previousAssets) ? factory.previousAssets : [];
    const kept = [];
    const isolated = [];
    currentAssets.forEach(asset => {
      if (factoryProjectFileAssetMatchesCurrentScope(asset, factory, identity)) kept.push(asset);
      else isolated.push({
        ...asset,
        used: false,
        currentProductHidden: true,
        metadata: {
          ...(asset.metadata || {}),
          isolatedOnProjectFileRestore: true,
          hiddenReason: '저장 당시 현재 단계 실행 범위와 달라 이전 작업 결과로 분리됨',
        },
      });
    });
    const seen = new Set();
    factory.assets = kept;
    factory.previousAssets = [...isolated, ...previousAssets].filter(asset => {
      const key = String(asset?.id || `${asset?.stageId || ''}:${asset?.createdAt || ''}:${asset?.title || ''}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  isolateFactoryAssets(prepared.factory);
  isolateFactoryAssets(prepared.assetPayload?.factory);
  factoryRetireProjectFileTransientDiagnostics(prepared.factory);
  factoryRetireProjectFileTransientDiagnostics(prepared.assetPayload?.factory);
  isolateCutPromptImages(prepared.cuts);
  isolateCutPromptImages(prepared.assetPayload?.cuts);
  return prepared;
}

function validateFactoryProjectFileBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || !bundle.project?.payload) {
    throw new Error('작업파일 안에 복원할 payload가 없습니다.');
  }
  if (bundle.format !== KUASANGSE_PROJECT_FILE_FORMAT || Number(bundle.version) !== KUASANGSE_PROJECT_FILE_VERSION) {
    throw new Error('지원하지 않는 작업파일 형식 또는 버전입니다.');
  }
  const project = bundle.project;
  const payload = project.payload;
  const projectId = String(project.id || '').trim();
  const bundleProjectId = String(bundle.currentProjectId || bundle.workspaceId || '').trim();
  const payloadProjectId = String(payload.currentProjectId || payload.factory?.workspace?.id || payload.assetPayload?.factory?.workspace?.id || '').trim();
  if (!projectId || !bundleProjectId || !payloadProjectId || projectId !== bundleProjectId || projectId !== payloadProjectId) {
    throw new Error('작업파일의 projectId/workspaceId가 서로 일치하지 않습니다.');
  }
  const manifest = bundle.manifest;
  const payloadManifest = payload.projectFileManifest;
  if (!manifest || manifest.schema !== 'kuasangse.factory.project.manifest' || Number(manifest.version) !== 1) {
    throw new Error('작업 범위 manifest가 없는 파일은 불러올 수 없습니다.');
  }
  if (!payloadManifest || payloadManifest.schema !== manifest.schema) {
    throw new Error('payload의 작업 범위 manifest가 일치하지 않습니다.');
  }
  const identity = manifest.identity || {};
  const expectedManifest = factoryProjectFileBuildManifest(payload, {
    id: projectId,
    name: project.name || payload.currentProjectName || payload.name || '',
  });
  const expectedIdentity = expectedManifest.identity || {};
  const identityFields = ['workspaceId', 'currentRunId', 'productKey', 'inputImageFingerprint'];
  for (const field of identityFields) {
    const actualValue = field === 'productKey'
      ? factoryNormalizeIdentityText(identity[field] || '')
      : String(identity[field] || '').trim();
    const expectedValue = field === 'productKey'
      ? factoryNormalizeIdentityText(expectedIdentity[field] || '')
      : String(expectedIdentity[field] || '').trim();
    if (!actualValue || !expectedValue || actualValue !== expectedValue) {
      throw new Error(`작업파일 manifest의 ${field}가 payload와 일치하지 않습니다.`);
    }
  }
  if (String(identity.projectId || '').trim() !== projectId || String(identity.workspaceId || '').trim() !== projectId) {
    throw new Error('작업파일 manifest의 workspaceId가 projectId와 일치하지 않습니다.');
  }
  const suppliedManifestEntries = Array.isArray(manifest.images?.entries) ? manifest.images.entries : [];
  const payloadManifestEntries = Array.isArray(payloadManifest.images?.entries) ? payloadManifest.images.entries : [];
  const isDiagnosticImageEntry = entry => /(?:^|\.)imageLoadFailedSrc$/i.test(String(entry?.path || ''));
  const suppliedManifestPaths = suppliedManifestEntries.map(entry => String(entry.path || ''));
  const payloadManifestPaths = payloadManifestEntries.map(entry => String(entry.path || ''));
  if (new Set(suppliedManifestPaths).size !== suppliedManifestPaths.length || new Set(payloadManifestPaths).size !== payloadManifestPaths.length) {
    throw new Error('작업파일 manifest에 중복 이미지 경로가 있습니다.');
  }
  const suppliedEntries = suppliedManifestEntries.filter(entry => !isDiagnosticImageEntry(entry));
  const payloadEntries = payloadManifestEntries.filter(entry => !isDiagnosticImageEntry(entry));
  const expectedEntries = Array.isArray(expectedManifest.images?.entries) ? expectedManifest.images.entries : [];
  const legacyTruncatedManifest = suppliedManifestEntries.length === 500 && expectedEntries.length > suppliedEntries.length;
  if (!suppliedEntries.length || payloadEntries.length !== suppliedEntries.length || (suppliedEntries.length !== expectedEntries.length && !legacyTruncatedManifest)) {
    throw new Error('작업파일 manifest의 이미지 목록이 payload와 일치하지 않습니다.');
  }
  const expectedByPath = new Map(expectedEntries.map(entry => [String(entry.path || ''), entry]));
  const legacyByPath = legacyTruncatedManifest
    ? new Map(factoryProjectFileBuildManifest(payload, {
        id: projectId,
        name: project.name || payload.currentProjectName || payload.name || '',
      }, { legacyFingerprint: true }).images.entries.map(entry => [String(entry.path || ''), entry]))
    : null;
  const payloadByPath = new Map(payloadEntries.map(entry => [String(entry.path || ''), entry]));
  for (const entry of suppliedEntries) {
    const path = String(entry.path || '');
    const expected = expectedByPath.get(path);
    const payloadEntry = payloadByPath.get(path);
    if (!path || !expected || !payloadEntry) throw new Error(`작업파일 manifest 이미지 경로가 유효하지 않습니다: ${path || '(없음)'}`);
    if (Number(entry.length || 0) !== Number(expected.length || 0) || Number(payloadEntry.length || 0) !== Number(expected.length || 0)) {
      throw new Error(`작업파일 이미지 길이 불일치: ${path}`);
    }
    for (const field of ['fingerprint', 'workspaceId', 'currentRunId', 'productKey', 'inputImageFingerprint', 'stageId']) {
      const normalize = field === 'productKey' ? factoryNormalizeIdentityText : value => String(value || '').trim();
      const actualValue = normalize(entry[field]);
      const expectedValue = field === 'fingerprint' && legacyTruncatedManifest
        ? normalize(legacyByPath?.get(path)?.fingerprint)
        : normalize(expected[field]);
      if (actualValue !== expectedValue || actualValue !== normalize(payloadEntry[field])) {
        throw new Error(`작업파일 이미지 범위 불일치: ${path} (${field})`);
      }
    }
  }
  for (const entry of expectedEntries) {
    const path = String(entry.path || '');
    if (!factoryProjectFileCurrentImageEntry(entry)) continue;
    if (/assetPayload\.factory\.assets(?:\[|\.)/i.test(path)) continue;
    const currentScope = {
      workspaceId: String(entry.workspaceId || '').trim(),
      currentRunId: String(entry.currentRunId || '').trim(),
      productKey: factoryNormalizeIdentityText(entry.productKey || ''),
      inputImageFingerprint: String(entry.inputImageFingerprint || '').trim(),
      stageId: String(entry.stageId || '').trim(),
    };
    const expectedStageId = factoryProjectFileExpectedStageForPath(path);
    if (Object.values(currentScope).some(value => !value)) {
      throw new Error(`현재 작업 이미지의 범위 식별자가 비어 있습니다: ${path}`);
    }
    if (
      currentScope.workspaceId !== projectId ||
      currentScope.currentRunId !== String(identity.currentRunId || '').trim() ||
      currentScope.productKey !== factoryNormalizeIdentityText(identity.productKey || '') ||
      currentScope.inputImageFingerprint !== String(identity.inputImageFingerprint || '').trim()
    ) {
      throw new Error(`현재 작업과 다른 이미지가 포함되어 있습니다: ${path}`);
    }
    if (expectedStageId && currentScope.stageId !== expectedStageId) {
      throw new Error(`현재 작업 이미지의 stageId가 경로와 일치하지 않습니다: ${path}`);
    }
  }
  return { projectId, manifest: expectedManifest };
}

function factoryProjectFileCanonicalImageMatches(value, canonicalBase64) {
  if (typeof value !== 'string' || !value || !canonicalBase64) return false;
  if (value === canonicalBase64) return true;
  const markerIndex = value.indexOf(';base64,');
  return markerIndex >= 0 && value.slice(markerIndex + 8) === canonicalBase64;
}

function compactFactoryProjectFileCanonicalImageMirror(record, canonicalBase64, options = {}) {
  if (!record || typeof record !== 'object') return false;
  let matched = false;
  for (const key of ['base64', 'imageBase64']) {
    if (!factoryProjectFileCanonicalImageMatches(record[key], canonicalBase64)) continue;
    record[key] = null;
    matched = true;
  }
  for (const key of ['preview', 'imagePreview', 'dataUrl', 'image']) {
    if (!factoryProjectFileCanonicalImageMatches(record[key], canonicalBase64)) continue;
    record[key] = IMAGE_STORED_MARKER;
    matched = true;
  }
  if (!matched) return false;
  if ('hasImageData' in record) record.hasImageData = true;
  if ('hasImage' in record) record.hasImage = true;
  if (options.backupShell === true) record.restoredFrom = 'lastProductImageBackup';
  return true;
}

function compactFactoryProjectFileCanonicalInputImages(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const canonicalBase64 = String(payload.productImageBackup?.primary?.base64 || '');
  if (!canonicalBase64) return payload;

  const compactInputContainer = container => {
    if (!container || typeof container !== 'object') return;
    compactFactoryProjectFileCanonicalImageMirror(container, canonicalBase64);
    for (const image of Array.isArray(container.analysisImages) ? container.analysisImages : []) {
      compactFactoryProjectFileCanonicalImageMirror(image, canonicalBase64, { backupShell: true });
    }
    compactFactoryProjectFileCanonicalImageMirror(container.compPage?.marketScrape, canonicalBase64);
    const product = container.factory?.product || container.factorySnapshot?.product;
    compactFactoryProjectFileCanonicalImageMirror(product, canonicalBase64);
    for (const image of Array.isArray(product?.inputImages) ? product.inputImages : []) {
      compactFactoryProjectFileCanonicalImageMirror(image, canonicalBase64, { backupShell: true });
    }
  };

  compactInputContainer(payload);
  compactInputContainer(payload.assetPayload);
  const nestedBackupBase64 = payload.assetPayload?.productImageBackup?.primary?.base64;
  if (factoryProjectFileCanonicalImageMatches(nestedBackupBase64, canonicalBase64)) {
    payload.assetPayload.productImageBackup = null;
  }
  return payload;
}

async function buildFactoryProjectFileBundle(options = {}) {
  const identity = factoryEnsureCurrentProjectIdentityForFile(options.name);
  const persistenceScope = `project:${identity.id}`;
  const factorySnapshot = cloneData(factoryRuntimeReadCommittedFactory());
  const inlineProductImageBackup = compactProductImageBackupPayload() || null;
  const payload = buildWorkspacePayload({
    productImageBackup: inlineProductImageBackup || productImageBackupReferencePayload(),
    factorySnapshot,
    scopeId: persistenceScope,
    documentSnapshot: true,
  });
  payload.assetPayload = currentSessionAssetsPayload({
    includeImages: true,
    preserveSectionImages: true,
    preserveRecentWorkingImages: true,
    preserveSelectedFactoryImages: true,
    factorySnapshot,
    scopeId: persistenceScope,
    documentSnapshot: true,
  });
  payload.fixedDetailImages = cloneData(state.fixedDetailImages || loadFixedDetailImages());
  payload.productImageBackup = inlineProductImageBackup || payload.assetPayload?.productImageBackup || payload.productImageBackup;
  compactFactoryProjectFileCanonicalInputImages(payload);
  payload.currentProjectId = identity.id;
  payload.currentProjectName = identity.name;
  payload.currentProjectCreatedAt = identity.createdAt;
  payload.imagePersistence = {
    mode: 'kuasangse-file-inline',
    note: '작업파일 내보내기는 후보/섹션/이미지컷 원본을 되살릴 수 있도록 세션 자산을 이미지 포함으로 포장합니다.',
    savedAt: Date.now(),
  };
  const summary = factoryProjectFileSummary(payload);
  payload.resultReport = buildFactoryWorkfileResultReport({
    payload, identity, summary, defaultMallId: CAFE24_CONTROL_API.defaultMallId,
  });
  const manifest = factoryProjectFileBuildManifest(payload, identity);
  payload.projectFileManifest = manifest;
  projectWorkspaceSnapshotForDocument(payload, identity.id);
  const persistenceRevision = currentWorkspaceRevision(persistenceScope) || {
    scopeId: persistenceScope,
    counter: 1,
    updatedAt: Date.now(),
    writerId: 'workfile-export',
  };
  const workfileOperation = workspaceCommitMetadata(
    persistenceScope,
    'workfile-save',
    persistenceRevision,
  );
  return {
    format: KUASANGSE_PROJECT_FILE_FORMAT,
    version: KUASANGSE_PROJECT_FILE_VERSION,
    manifest,
    exportedAt: Date.now(),
    app: 'kuasangse',
    workspaceId: identity.id,
    currentProjectId: identity.id,
    persistence: {
      operationId: workfileOperation.operationId,
      revision: workfileOperation.revision,
      fencingToken: workfileOperation.fencingToken,
      leaseId: workfileOperation.leaseId,
      digest: workspacePersistenceApi().contentDigest(payload),
    },
    project: {
      id: identity.id,
      name: identity.name,
      createdAt: identity.createdAt,
      updatedAt: Date.now(),
      payload,
    },
    resultReport: payload.resultReport,
    summary,
  };
}

async function factoryBuildProjectSafetyBackupEnvelope(workfile, localArchiveEntries = [], indexedDbEntries = []) {
  const safeWorkfile = JSON.parse(JSON.stringify(workfile));
  const archiveEntries = [];
  for (const entry of localArchiveEntries) {
    const value = JSON.parse(JSON.stringify(entry));
    archiveEntries.push({
      ...value,
      checksum: await factoryRuntimeSha256Text(JSON.stringify(value)),
    });
  }
  const indexedEntries = JSON.parse(JSON.stringify(indexedDbEntries));
  const workfileChecksum = await factoryRuntimeSha256Text(JSON.stringify(safeWorkfile));
  const localArchiveChecksum = await factoryRuntimeSha256Text(JSON.stringify(
    archiveEntries.map(({ checksum, archiveId }) => ({ archiveId: String(archiveId || ''), checksum })),
  ));
  const indexedDbChecksum = await factoryRuntimeSha256Text(JSON.stringify(indexedEntries));
  const checksum = await factoryRuntimeSha256Text(JSON.stringify({
    workfileChecksum,
    localArchiveChecksum,
    indexedDbChecksum,
  }));
  return {
    format: KUASANGSE_SAFETY_BACKUP_FORMAT,
    version: KUASANGSE_SAFETY_BACKUP_VERSION,
    createdAt: Date.now(),
    checksum,
    workfile: safeWorkfile,
    workfileChecksum,
    localArchive: {
      count: archiveEntries.length,
      checksum: localArchiveChecksum,
      entries: archiveEntries,
    },
    indexedDb: {
      count: indexedEntries.length,
      checksum: indexedDbChecksum,
      entries: indexedEntries,
    },
  };
}

async function factoryValidateProjectSafetyBackupEnvelope(backup) {
  if (!backup || backup.format !== KUASANGSE_SAFETY_BACKUP_FORMAT
    || Number(backup.version) !== KUASANGSE_SAFETY_BACKUP_VERSION) {
    throw new Error('지원하지 않는 안전 백업 형식입니다.');
  }
  const workfileChecksum = await factoryRuntimeSha256Text(JSON.stringify(backup.workfile));
  if (workfileChecksum !== String(backup.workfileChecksum || '')) {
    throw new Error('작업파일 체크섬이 일치하지 않습니다. 백업 파일이 손상됐습니다.');
  }
  const archiveEntries = Array.isArray(backup.localArchive?.entries) ? backup.localArchive.entries : [];
  for (const entry of archiveEntries) {
    const { checksum, ...value } = entry || {};
    if (!checksum || checksum !== await factoryRuntimeSha256Text(JSON.stringify(value))) {
      throw new Error(`로컬 보관본 체크섬이 일치하지 않습니다: ${value.archiveId || '(식별자 없음)'}`);
    }
  }
  const localArchiveChecksum = await factoryRuntimeSha256Text(JSON.stringify(
    archiveEntries.map(({ checksum, archiveId }) => ({ archiveId: String(archiveId || ''), checksum })),
  ));
  if (localArchiveChecksum !== String(backup.localArchive?.checksum || '')) {
    throw new Error('로컬 보관본 체크섬 목록이 일치하지 않습니다.');
  }
  const indexedEntries = Array.isArray(backup.indexedDb?.entries) ? backup.indexedDb.entries : [];
  const indexedDbChecksum = await factoryRuntimeSha256Text(JSON.stringify(indexedEntries));
  if (indexedDbChecksum !== String(backup.indexedDb?.checksum || '')) {
    throw new Error('IndexedDB manifest 체크섬이 일치하지 않습니다.');
  }
  const checksum = await factoryRuntimeSha256Text(JSON.stringify({
    workfileChecksum,
    localArchiveChecksum,
    indexedDbChecksum,
  }));
  if (checksum !== String(backup.checksum || '')) {
    throw new Error('안전 백업 전체 체크섬이 일치하지 않습니다.');
  }
  return backup;
}

function factoryProjectSafetyBackupIndexedDbEntries(workfile) {
  const prepared = prepareFactoryProjectBundlePersistence(workfile);
  return [
    ...prepared.records.map(({ storeName, value }) => ({
      store: storeName,
      id: String(value?.id || ''),
      digest: workspacePersistenceApi().contentDigest(value),
    })),
    {
      store: WORKSPACE_DB.sessionAssets,
      id: prepared.scopeId,
      digest: workspacePersistenceApi().contentDigest(prepared.sessionAssets),
    },
  ].sort((left, right) => `${left.store}:${left.id}`.localeCompare(`${right.store}:${right.id}`));
}

async function factoryCollectProjectSafetyBackupArchiveEntries(factory = factoryRuntimeReadFactory()) {
  if (typeof factoryFetchCurrentWorkfileArchiveAssets !== 'function') {
    throw new Error('로컬 보관본 조회 기능을 불러오지 못했습니다.');
  }
  const result = await factoryFetchCurrentWorkfileArchiveAssets(factory);
  const history = typeof factoryFetchProductArchiveHistoryAssets === 'function'
    ? await factoryFetchProductArchiveHistoryAssets(factory)
    : { ok: false, skipped: true, assets: [] };
  if (!result.ok && !history.ok && !(result.skipped && history.skipped)) {
    throw new Error(result.errors?.[0] || history.error || '현재 상품의 로컬 보관 이력을 읽지 못했습니다.');
  }
  const records = [];
  const seen = new Set();
  [...(result.assets || []), ...(history.assets || [])].forEach(record => {
    const archiveId = String(record?.archiveId || record?.id || '').trim();
    if (!archiveId || seen.has(archiveId)) return;
    seen.add(archiveId);
    records.push(record);
  });
  const base = (typeof factoryBackendBaseUrl === 'function'
    ? factoryBackendBaseUrl()
    : (state.backendBaseUrl || 'http://127.0.0.1:5050')).replace(/\/+$/, '');
  const entries = [];
  for (const record of records) {
    const archiveId = String(record?.archiveId || record?.id || '').trim();
    if (!archiveId) throw new Error('로컬 보관본 archiveId가 비어 있습니다.');
    const response = await workspaceArchiveFetch(
      `${base}/api/local-archive/assets/${encodeURIComponent(archiveId)}`,
      { cache: 'no-store' },
    );
    const detail = await response.json().catch(() => ({}));
    if (!response.ok || detail.ok === false) {
      throw new Error(detail.error || `로컬 보관본 읽기 실패: HTTP ${response.status}`);
    }
    const sourceAsset = detail.asset && typeof detail.asset === 'object' ? detail.asset : {};
    const metadata = detail.metadata && typeof detail.metadata === 'object' ? detail.metadata : {};
    entries.push({
      archiveId,
      asset: {
        ...sourceAsset,
        id: sourceAsset.id || record.assetId || record.sourceAssetId || archiveId,
        title: sourceAsset.title || record.title || record.stageId || archiveId,
        stageId: sourceAsset.stageId || record.stageId || '',
        workspaceId: sourceAsset.workspaceId || record.workspaceId || record.currentProjectId || '',
        productKey: sourceAsset.productKey || record.productKey || '',
        currentRunId: sourceAsset.currentRunId || sourceAsset.generationRunId || record.currentRunId || record.generationRunId || '',
        inputImageFingerprint: sourceAsset.inputImageFingerprint || record.inputImageFingerprint || '',
        image: detail.imageDataUrl || sourceAsset.image || '',
        html: detail.html || sourceAsset.html || '',
        content: sourceAsset.content || metadata.content || null,
        metadata: { ...(metadata.metadata || {}), ...(sourceAsset.metadata || {}), ...(record.metadata || {}) },
        sourceMap: { ...(metadata.sourceMap || {}), ...(sourceAsset.sourceMap || {}), ...(record.sourceMap || {}) },
      },
    });
  }
  return entries;
}

async function exportCurrentProjectSafetyBackup() {
  if (state.projectBusy) return null;
  state.projectBusy = true;
  state.projectSafetyBackupState = 'exporting';
  state.projectSafetyBackupMessage = '';
  render();
  try {
    if (typeof factoryUpdateFromInputs === 'function') factoryUpdateFromInputs();
    const name = state.currentProjectName || deriveProjectName();
    const workfile = await buildFactoryProjectFileBundle({ name });
    const localArchiveEntries = await factoryCollectProjectSafetyBackupArchiveEntries();
    const indexedDbEntries = factoryProjectSafetyBackupIndexedDbEntries(workfile);
    const backup = await factoryBuildProjectSafetyBackupEnvelope(workfile, localArchiveEntries, indexedDbEntries);
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json;charset=utf-8' });
    if (blob.size > KUASANGSE_PROJECT_FILE_MAX_BYTES) {
      throw new Error('안전 백업이 256MB 제한을 초과했습니다. 현재 작업의 불필요한 과거 이미지를 정리한 뒤 다시 시도해주세요.');
    }
    const fileName = `${factorySanitizeProjectFileName(name)}.safety-backup.json`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    state.projectSafetyBackupState = 'completed';
    state.projectSafetyBackupMessage = `안전 백업 완료 · 이미지 ${backup.localArchive.count}개`;
    window.__KUASANGSE_LAST_SAFETY_BACKUP_RECEIPT__ = Object.freeze({
      fileName,
      bytes: blob.size,
      checksum: backup.checksum,
      archiveCount: backup.localArchive.count,
      indexedDbCount: backup.indexedDb.count,
    });
    setUiNotice(`${state.projectSafetyBackupMessage} · SHA-256 ${backup.checksum.slice(0, 12)}...`, 'ok');
    if (typeof factoryLog === 'function') factoryLog(`${state.projectSafetyBackupMessage}: ${fileName}`, 'ok');
    return backup;
  } catch (error) {
    state.projectSafetyBackupState = 'error';
    state.projectSafetyBackupMessage = error?.message || String(error);
    setUiNotice(`안전 백업 실패 · 기존 작업은 그대로 유지됩니다: ${state.projectSafetyBackupMessage}`, 'warn');
    if (typeof factoryLog === 'function') factoryLog(`안전 백업 실패: ${state.projectSafetyBackupMessage}`, 'error');
    return null;
  } finally {
    state.projectBusy = false;
    render();
  }
}

async function restoreProjectSafetyBackupFromText(text, options = {}) {
  const sourceText = String(text || '');
  if (sourceText.length > KUASANGSE_PROJECT_FILE_MAX_BYTES) throw new Error('안전 백업이 256MB 제한을 초과했습니다.');
  const backup = await factoryValidateProjectSafetyBackupEnvelope(JSON.parse(sourceText));
  state.projectSafetyBackupState = 'restoring';
  state.projectSafetyBackupMessage = '';
  state.projectBusy = true;
  render();
  try {
    const name = String(backup.workfile?.project?.name || '안전 백업').trim();
    const imported = await importFactoryProjectFileBundle(backup.workfile, {
      fileName: `${name}.kuasangse`,
      skipLeaveConfirm: options.skipLeaveConfirm === true,
      deferFinalRender: true,
    });
    if (!imported) return null;
    let restoredArchiveCount = 0;
    for (const entry of backup.localArchive.entries) {
      const result = await factoryBackendArchiveAsset(entry.asset, 'safety-backup-restore');
      if (!result) throw new Error(`로컬 보관본 복원 실패: ${entry.archiveId || '(식별자 없음)'}`);
      restoredArchiveCount += 1;
    }
    await refreshLoadedWorkfileArchiveAssets({ source: 'safety-backup-restore' });
    state.projectSafetyBackupState = 'completed';
    state.projectSafetyBackupMessage = `백업 복원 완료 · 이미지 ${restoredArchiveCount}개`;
    setUiNotice(`${state.projectSafetyBackupMessage} · IndexedDB manifest ${backup.indexedDb.count}건 검증`, 'ok');
    if (typeof factoryLog === 'function') factoryLog(state.projectSafetyBackupMessage, 'ok');
    return { imported, restoredArchiveCount, checksum: backup.checksum };
  } catch (error) {
    state.projectSafetyBackupState = 'error';
    state.projectSafetyBackupMessage = error?.message || String(error);
    setUiNotice(`백업 복원 실패: ${state.projectSafetyBackupMessage}`, 'warn');
    if (typeof factoryLog === 'function') factoryLog(`백업 복원 실패: ${state.projectSafetyBackupMessage}`, 'error');
    throw error;
  } finally {
    state.projectBusy = false;
    render();
  }
}

function openProjectSafetyBackupPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      await restoreProjectSafetyBackupFromText(await file.text());
    } catch (error) {
      state.projectSafetyBackupState = 'error';
      state.projectSafetyBackupMessage = error?.message || String(error);
      render();
    }
  };
  document.body.appendChild(input);
  input.click();
}

function prepareFactoryProjectBundlePersistence(bundle) {
  const project = bundle?.project || {};
  const payload = project.payload || bundle?.payload || null;
  if (!payload) throw new Error('작업파일 payload가 비어 있습니다.');
  const projectId = String(project.id || bundle.currentProjectId || payload.currentProjectId || uid('project'));
  const name = String(project.name || payload.currentProjectName || payload.name || deriveProjectName() || '상세페이지 작업').trim();
  const createdAt = Number(project.createdAt || payload.currentProjectCreatedAt || Date.now()) || Date.now();
  const backupPayload = compactProductImageBackupPayload(workspaceProductImageBackupFromPayload(payload));
  const backupRecord = backupPayload?.primary?.base64 ? {
    ...backupPayload,
    id: workspaceImageBackupKey('project', projectId),
    workspaceKind: 'project',
    workspaceId: projectId,
    savedAt: Date.now(),
  } : null;
  const productImageBackup = backupRecord
    ? workspaceImageBackupReferencePayload(backupRecord)
    : productImageBackupReferencePayload(workspaceProductImageBackupFromPayload(payload));
  const compactPayload = compactWorkspacePayloadForStorage(payload, productImageBackup);
  compactPayload.currentProjectId = projectId;
  compactPayload.currentProjectName = name;
  compactPayload.currentProjectCreatedAt = createdAt;
  const projectRecord = {
    id: projectId,
    name,
    createdAt,
    updatedAt: Date.now(),
    batchStatus: null,
    payload: compactPayload,
  };
  const entries = [{ storeName: WORKSPACE_DB.projects, value: projectRecord }];
  if (backupRecord) entries.unshift({ storeName: WORKSPACE_DB.appSettings, value: backupRecord });
  return {
    projectId,
    name,
    createdAt,
    scopeId: `project:${projectId}`,
    snapshot: compactPayload,
    sessionAssets: cloneData(payload.assetPayload || {}),
    records: entries,
  };
}

function buildFactoryProjectPersistenceServerSnapshot(prepared, reason) {
  const savedAt = Date.now();
  const lightweight = cloneData(prepared.snapshot || {});
  const assets = cloneData(prepared.snapshot?.assetPayload || prepared.snapshot || {});
  return {
    id: 'current',
    workspaceId: prepared.scopeId,
    workspaceScope: { id: prepared.scopeId },
    workspaceRevision: currentWorkspaceRevision(prepared.scopeId),
    savedAt,
    reason,
    origin: location.origin,
    href: location.href,
    userAgent: navigator.userAgent,
    lightweight,
    assets,
    productImageBackup: productImageBackupReferencePayload(
      workspaceProductImageBackupFromPayload(prepared.snapshot),
    ),
  };
}

async function persistFactoryProjectBundleLocally(bundle) {
  const prepared = prepareFactoryProjectBundlePersistence(bundle);
  const sessionRecovery = selectLocalSessionPayload(prepared.snapshot);
  if (!sessionRecovery.ok) throw sessionRecovery.error || new Error('작업파일 세션 복구본 준비 실패');
  const authority = await ensureWorkspaceEditAuthority(prepared.scopeId);
  if (authority?.mode !== 'editing') {
    throw new Error('이 작업은 다른 창에서 편집 중이라 가져온 내용을 덮어쓸 수 없습니다.');
  }
  const contentVersion = Number(state.contentVersion || 0);
  const commitResult = await workspacePersistenceApi().commit({
    scopeId: prepared.scopeId,
    snapshot: prepared.snapshot,
    metadata: workspaceCommitMetadata(prepared.scopeId, 'workfile-import'),
    rebaseRevision: true,
    replicas: ['session'],
    context: {
      indexeddb: { records: prepared.records, sessionAssets: prepared.sessionAssets },
      server: {
        serverSnapshot: buildFactoryProjectPersistenceServerSnapshot(prepared, 'workfile-import'),
        force: true,
        repair: true,
      },
      session: { writeBootstrap: true, recoverySnapshot: sessionRecovery.payload },
    },
    isCurrent: () => state.currentProjectId === prepared.projectId
      && Number(state.contentVersion || 0) === contentVersion,
  });
  if (!commitResult.accepted) throw new Error(commitResult.failures?.[0]?.message || '권위 저장소 저장 실패');
  if (!commitResult.clean) throw new Error(commitResult.failures?.[0]?.message || '저장 중 작업 내용이 변경되었습니다.');
  return { ...prepared, commitResult };
}

async function canWriteFactoryProjectFileHandle(handle) {
  if (!handle || typeof handle.createWritable !== 'function') return false;
  if (typeof handle.queryPermission !== 'function') return true;
  try {
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return true;
    if (typeof handle.requestPermission === 'function') {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }
    return permission === 'granted';
  } catch (_) {
    return false;
  }
}

async function selectFactoryProjectFileSaveHandle(fileName, options = {}) {
  if (typeof window === 'undefined'
    || typeof window.showSaveFilePicker !== 'function') return null;
  const reuseCurrentFile = options.reuseCurrentFile === true;
  const scope = factoryProjectFileHandleScope();
  const currentHandle = reuseCurrentFile ? await loadFactoryProjectFileHandle(scope) : null;
  if (currentHandle) {
    if (await canWriteFactoryProjectFileHandle(currentHandle)) {
      return currentHandle;
    }
    throw new Error('현재 작업파일에 쓸 권한이 없습니다. 다른 이름으로 저장을 사용하세요.');
  }
  return workspacePersistenceApi().chooseProjectFileForSave({
    id: KUASANGSE_PROJECT_FILE_PICKER_ID,
    suggestedName: fileName,
    startIn: kuasangseProjectFileLastHandle || 'documents',
    types: factoryProjectFilePickerTypes(),
    excludeAcceptAllOption: false,
  });
}

function handleWorkfileActionEvent(event) {
  const action = String(event.detail?.action || '');
  if (action === 'blank') {
    startBlankWorkDraft();
  } else if (action === 'save-current') {
    void exportCurrentProjectFile({ name: state.currentProjectName || deriveProjectName(), saveAs: false });
  } else if (action === 'save-as') {
    void exportCurrentProjectFile({ name: state.currentProjectName || deriveProjectName(), saveAs: true });
  } else if (action === 'import') {
    void openFactoryProjectFilePicker();
  } else if (action === 'import-direct') {
    void openFactoryProjectFileInput({ direct: true });
  } else if (action === 'export-safety-backup') {
    void exportCurrentProjectSafetyBackup();
  } else if (action === 'restore-safety-backup') {
    openProjectSafetyBackupPicker();
  } else if (action === 'sync-assets') {
    void requestCurrentWorkBundleLiveSync('사용자 수동 전체 대조', {
      immediate: true,
      fullReconcile: true,
      sourceScheme: 'local-archive',
    });
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('kuasangse:workfile-action', handleWorkfileActionEvent);
}

const WORK_BUNDLE_SYNC_PENDING_KEY = 'kuasangse_work_bundle_sync_pending_v1';

function createWorkBundleSyncWarningDedupe() {
  const signatures = new Map();
  return Object.freeze({
    shouldRecord(bundleKey, message) {
      const key = String(bundleKey || '').trim() || 'current-work';
      const signature = String(message || '동기화 실패').trim() || '동기화 실패';
      if (signatures.get(key) === signature) return false;
      signatures.set(key, signature);
      return true;
    },
    clear(bundleKey) {
      signatures.delete(String(bundleKey || '').trim() || 'current-work');
    },
  });
}

const workBundleSyncWarningDedupe = createWorkBundleSyncWarningDedupe();
const runtimeDegradedWarningDedupe = createWorkBundleSyncWarningDedupe();

function reportRuntimeDegradedOnce(key, message, error) {
  const detail = String(error?.message || error || '').trim();
  const displayMessage = `${String(message || '일부 기능 저하').trim()}${detail ? `: ${detail}` : ''}`;
  if (!runtimeDegradedWarningDedupe.shouldRecord(key, displayMessage)) return false;
  state.runtimeDegradedStatus = { key, message: displayMessage, at: Date.now() };
  setUiNotice(displayMessage, 'warn');
  console.warn(displayMessage, error || '');
  if (typeof factoryLog === 'function') factoryLog(displayMessage, 'warn');
  return true;
}

function clearRuntimeDegraded(key) {
  runtimeDegradedWarningDedupe.clear(key);
  if (state.runtimeDegradedStatus?.key !== key) return;
  const currentMessage = state.runtimeDegradedStatus.message;
  state.runtimeDegradedStatus = null;
  if (state.uiNotice?.message === currentMessage) setUiNotice(null);
}

function rememberPendingWorkBundleSync(plan, error) {
  try {
    const current = JSON.parse(localStorage.getItem(WORK_BUNDLE_SYNC_PENDING_KEY) || '{}');
    const next = current && typeof current === 'object' && !Array.isArray(current)
      ? current
      : {};
    next[plan.manifest.bundleKey] = {
      bundleKey: plan.manifest.bundleKey,
      workfileName: plan.manifest.workfileName,
      sourcePath: plan.manifest.sourcePath,
      pendingAssetCount: plan.uploads.length,
      missingAssetCount: plan.missingRequiredAssetKeys?.length || 0,
      revision: plan.revision,
      lastError: String(error?.message || error || '동기화 실패').slice(0, 500),
      updatedAt: Date.now(),
    };
    localStorage.setItem(WORK_BUNDLE_SYNC_PENDING_KEY, JSON.stringify(next));
  } catch (_) {}
}

function clearPendingWorkBundleSync(bundleKey) {
  try {
    const current = JSON.parse(localStorage.getItem(WORK_BUNDLE_SYNC_PENDING_KEY) || '{}');
    if (!current || typeof current !== 'object' || Array.isArray(current)) return;
    delete current[bundleKey];
    if (Object.keys(current).length) {
      localStorage.setItem(WORK_BUNDLE_SYNC_PENDING_KEY, JSON.stringify(current));
    } else {
      localStorage.removeItem(WORK_BUNDLE_SYNC_PENDING_KEY);
    }
  } catch (_) {}
}

function hasPendingWorkBundleSync(bundleKey = '') {
  try {
    const current = JSON.parse(localStorage.getItem(WORK_BUNDLE_SYNC_PENDING_KEY) || '{}');
    if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
    const normalizedBundleKey = String(bundleKey || '').trim();
    return normalizedBundleKey
      ? Object.prototype.hasOwnProperty.call(current, normalizedBundleKey)
      : Object.keys(current).length > 0;
  } catch (_) {
    return false;
  }
}

function hasPendingCurrentWorkBundleSync() {
  const bundleKey = currentWorkBundleKey();
  return !!bundleKey && hasPendingWorkBundleSync(bundleKey);
}

function workBundleFactoryProducts(bundle) {
  const payload = bundle?.project?.payload;
  if (!payload || typeof payload !== 'object') return [];
  return [payload.factory?.product, payload.assetPayload?.factory?.product]
    .filter(product => product && typeof product === 'object');
}

function workBundleProductHasBinarySource(product) {
  const source = value => String(value || '').trim();
  if ([product?.imageBase64, product?.imagePreview].some(value => {
    const current = source(value);
    return current && current !== '__stored_in_indexeddb__';
  })) return true;
  return Array.isArray(product?.inputImages) && product.inputImages.some(image => (
    ['image', 'imageBase64', 'imagePreview', 'dataUrl', 'preview'].some(key => {
      const current = source(image?.[key]);
      return current && current !== '__stored_in_indexeddb__';
    })
  ));
}

async function withCurrentInputArchiveForWorkBundle(bundle) {
  const products = workBundleFactoryProducts(bundle);
  const factory = products.length
    ? (bundle?.project?.payload?.factory || bundle?.project?.payload?.assetPayload?.factory)
    : null;
  if (!factory || products.every(workBundleProductHasBinarySource)
    || typeof factoryCurrentInputArchiveSourcePart !== 'function') return bundle;
  const source = await factoryCurrentInputArchiveSourcePart('input', factory, { log: false }).catch(() => null);
  if (!source?.base64 || !source?.mime) return bundle;
  const next = typeof structuredClone === 'function'
    ? structuredClone(bundle)
    : JSON.parse(JSON.stringify(bundle));
  workBundleFactoryProducts(next).forEach(product => {
    product.imageBase64 = source.base64;
    product.imageMime = source.mime;
    if (source.name) product.imageName = source.name;
  });
  return next;
}

// 자산관에 올릴 원본을 마지막으로 한 번 더 찾는다.
// 사진을 백업에서 되살리면 inputImages 에는 '__stored_in_indexeddb__' 표식만 남고
// 실제 바이트는 IndexedDB 에 있다. 그대로 두면 플랜이 '필수 자산 없음' 으로 판정해
// **아예 올리려는 시도조차 하지 않는다.**
// 실측 2026-08-30: work_bundle_required_assets_missing:1:input:factory_input_restore_...
//   → 화면에는 "로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다" 만 뜬다.
// 플랜에는 이미 payload.productImageBackup.primary 로 되돌아가는 길이 있다(work-bundle-input-assets.mjs).
// 그 백업을 실제 바이트로 채워 주면 그 길이 살아난다.
async function withHydratedImageBackupForWorkBundle(bundle) {
  const payload = bundle?.project?.payload;
  if (!payload || typeof payload !== 'object') return bundle;
  if (typeof hydrateWorkspacePayloadImageBackup !== 'function') return bundle;
  const backupPrimary = payload.productImageBackup?.primary;
  const existing = String(backupPrimary?.base64 || '').trim();
  if (existing && existing !== '__stored_in_indexeddb__') return bundle;
  let hydrated = null;
  try {
    hydrated = await hydrateWorkspacePayloadImageBackup(payload);
  } catch (error) {
    console.warn('자산관 업로드용 원본 이미지 복원 실패:', error);
    return bundle;
  }
  const filled = String(hydrated?.productImageBackup?.primary?.base64 || '').trim();
  if (!filled || filled === '__stored_in_indexeddb__') return bundle;
  // 원본을 건드리지 않는다. 바뀔 때만 복사한다.
  const next = typeof structuredClone === 'function'
    ? structuredClone(bundle)
    : JSON.parse(JSON.stringify(bundle));
  next.project.payload = hydrated;
  return next;
}

async function scheduleCurrentWorkBundleSync(bundle, options = {}) {
  let plan = null;
  try {
    workBundleSyncStatusLabel = '자산관 사진: 대조 중...';
    const syncStatus = document.getElementById('workBundleSyncStatus');
    if (syncStatus) syncStatus.textContent = workBundleSyncStatusLabel;
    const moduleUrl = new URL(
      'src/modules/work-bundle-auto-sync.mjs?v=20260809-restore-isolated-v540',
      document.baseURI,
    ).href;
    const workBundle = await import(moduleUrl);
    const scopedBundle = scopeWorkBundleForCurrentBranch(bundle, options);
    if (!scopedBundle) return null;
    const archiveRecovered = await withCurrentInputArchiveForWorkBundle(scopedBundle);
    // 로컬 자산관에서 못 찾았으면 이미지 백업에서라도 원본을 채운다.
    const recoverableBundle = await withHydratedImageBackupForWorkBundle(archiveRecovered);
    const fileName = String(options.fileName || recoverableBundle?.project?.name || '상세페이지 작업.kuasangse');
    const workspaceId = String(recoverableBundle.workspaceId || '').trim();
    const scheme = workBundle.resolveWorkBundleSourceScheme(options);
    const sourceLocator = `${scheme}://${encodeURIComponent(workspaceId)}/${encodeURIComponent(fileName)}`;
    plan = workBundle.buildWorkBundleSyncPlan(recoverableBundle, {
      workfileName: fileName,
      sourceLocator,
    });
    const result = await workBundle.synchronizeWorkBundlePlan(plan, {
      backendBaseUrl: kuasangseBackendBaseUrl(),
      concurrency: 2,
      fetcher: window.fetch.bind(window),
      sendManifest: (manifest, idempotencyKey) => fetchSinhwaPdpBackend(
        'work-bundles/sync',
        {},
        {
          method: 'POST',
          body: { manifest, idempotencyKey },
          timeoutMs: 60000,
        },
      ),
      sendAsset: uploadSinhwaPdpWorkBundleAsset,
    });
    clearPendingWorkBundleSync(plan.manifest.bundleKey);
    workBundleSyncWarningDedupe.clear(plan.manifest.bundleKey);
    workBundleActivityReadyKey = plan.manifest.bundleKey;
    void currentWorkBundleActivityHeartbeat().then((heartbeat) => heartbeat.start());
    const uploadKeys = new Set(plan.uploads.map(item => item.assetKey));
    const inputAssetCount = plan.manifest.assets.filter(asset => (
      asset.phase === 'input' && uploadKeys.has(asset.assetKey)
    )).length;
    const outputAssetCount = plan.manifest.assets.filter(asset => (
      asset.phase === 'output' && uploadKeys.has(asset.assetKey)
    )).length;
    const excludedImageSources = plan.excludedImageSources || [];
    const exclusionNotice = excludedImageSources.length
      ? ` · ${excludedImageSources.map(item => item.reason).join(' · ')}`
      : '';
    workBundleSyncStatusLabel = `자산관 사진: 입력 ${inputAssetCount}장 · 결과 ${outputAssetCount}장 저장 완료${exclusionNotice}`;
    if (syncStatus) syncStatus.textContent = workBundleSyncStatusLabel;
    if (typeof factoryLog === 'function') {
      factoryLog(
        `신화사 자산관 동기화 완료: ${plan.manifest.workfileName} `
        + `(신규 ${result.uploads.length}개 · 기존 ${result.reusedAssetKeys?.length || 0}개)`,
        'ok',
      );
    }
    setUiNotice(
      `로컬 저장 완료 · 신화사 자산관 사진 전량 저장 완료 `
      + `(입력 ${inputAssetCount}장 · 결과 ${outputAssetCount}장 · `
      + `신규 ${result.uploads.length}개 · 기존 ${result.reusedAssetKeys?.length || 0}개)${exclusionNotice}`,
      'ok',
    );
    return result;
  } catch (error) {
    const missingAssetCount = plan?.missingRequiredAssetKeys?.length || 0;
    const missingImageReason = (plan?.missingImageSources || []).map(item => item.reason).join(' · ');
    const excludedImageReason = (plan?.excludedImageSources || []).map(item => item.reason).join(' · ');
    const imageReason = [missingImageReason, excludedImageReason].filter(Boolean).join(' · ');
    workBundleSyncStatusLabel = missingAssetCount > 0
      ? `자산관 사진: 전량 저장 보류 (원본 ${missingAssetCount}장 누락${imageReason ? ` · ${imageReason}` : ''})`
      : '자산관 사진: 전량 저장 보류';
    const syncStatus = document.getElementById('workBundleSyncStatus');
    if (syncStatus) syncStatus.textContent = workBundleSyncStatusLabel;
    if (plan) rememberPendingWorkBundleSync(plan, error);
    const errorMessage = String(error?.message || error || '연결 실패');
    const bundleKey = plan?.manifest?.bundleKey || currentWorkBundleKey();
    const shouldRecordWarning = workBundleSyncWarningDedupe.shouldRecord(bundleKey, errorMessage);
    if (shouldRecordWarning) console.warn('신화사 자산관 자동 동기화 보류:', error);
    if (shouldRecordWarning && typeof factoryLog === 'function') {
      factoryLog(
        `로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다: `
        + errorMessage,
        'warn',
      );
    }
    setUiNotice(
      shouldRecordWarning
        ? '작업파일은 로컬에 정상 저장됐습니다. 신화사 자산관 동기화는 다음 저장 때 다시 시도합니다.'
        : '신화사 자산관 동기화 재시도 대기 중입니다. 같은 오류는 한 번만 기록합니다.',
      'warn',
    );
    return null;
  }
}

let workBundleLiveSyncControllerPromise = null;
let workBundleActivityHeartbeatPromise = null;
let workBundleActivityReadyKey = '';
const workBundleActivityClientId = (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

function currentWorkBundleWorkspaceId(options = {}) {
  if (options.documentCommit !== true) {
    const branchScope = workspacePersistenceApi().normalizeWorkspaceScope(
      getCurrentLastWorkWorkspaceScope(),
    );
    if (branchScope.startsWith('draft:')) return branchScope;
  }
  return String(
    state.currentProjectId
      || factoryRuntimeReadFactory()?.workspace?.id
      || '',
  ).trim();
}

function currentWorkBundleKey(options = {}) {
  const workspaceId = currentWorkBundleWorkspaceId(options);
  return workspaceId ? `kuasangse:${workspaceId}` : '';
}

function scopeWorkBundleForCurrentBranch(bundle, options = {}) {
  if (!bundle || typeof bundle !== 'object') return null;
  const workspaceId = currentWorkBundleWorkspaceId(options);
  if (!workspaceId) return null;
  if (String(bundle.workspaceId || '').trim() === workspaceId) return bundle;
  return Object.freeze({ ...bundle, workspaceId });
}

function currentWorkBundleActivityHeartbeat() {
  if (!workBundleActivityHeartbeatPromise) {
    const moduleUrl = new URL(
      'src/modules/work-bundle-live-sync.mjs?v=20260809-heartbeat-ready-v860',
      document.baseURI,
    ).href;
    workBundleActivityHeartbeatPromise = import(moduleUrl).then((module) => (
      module.createWorkBundleActivityHeartbeat({
        getBundleKey: currentWorkBundleKey,
        isReady: () => workBundleActivityReadyKey === currentWorkBundleKey(),
        sendActivity: (activity) => fetchSinhwaPdpBackend(
          'work-bundles/activity',
          {},
          {
            method: 'POST',
            body: activity,
            timeoutMs: 5000,
          },
        ),
        clientId: workBundleActivityClientId,
        intervalMs: 5000,
        onError: (error) => {
          console.debug('신화사 자산관 작업 중 상태 전송 보류:', error);
        },
      })
    ));
  }
  return workBundleActivityHeartbeatPromise;
}

function currentWorkBundleLiveSyncController() {
  if (!workBundleLiveSyncControllerPromise) {
    const moduleUrl = new URL(
      'src/modules/work-bundle-live-sync.mjs?v=20260809-heartbeat-ready-v860',
      document.baseURI,
    ).href;
    workBundleLiveSyncControllerPromise = import(moduleUrl).then((module) => (
      module.createWorkBundleLiveSync({
        buildBundle: () => buildFactoryProjectFileBundle({
          name: state.currentProjectName || deriveProjectName() || '상세페이지 작업',
        }),
        synchronize: (bundle, options) => scheduleCurrentWorkBundleSync(bundle, options),
        hasPending: hasPendingCurrentWorkBundleSync,
        debounceMs: 900,
      })
    ));
  }
  return workBundleLiveSyncControllerPromise;
}

function requestCurrentWorkBundleLiveSync(reason = '로컬 자산 변경', options = {}) {
  if (!String(state.currentProjectId || '').trim()) {
    return Promise.resolve(null);
  }
  return currentWorkBundleLiveSyncController()
    .then((controller) => controller.request(reason, options))
    .catch((error) => {
      console.warn('신화사 자산관 실시간 동기화 예약 실패:', error);
      return null;
    });
}

function replayPendingWorkBundleSync(reason = '대기 작업 재전송') {
  if (!hasPendingCurrentWorkBundleSync()) return;
  void currentWorkBundleLiveSyncController()
    .then((controller) => controller.replayPending(reason))
    .catch((error) => {
      console.warn('신화사 자산관 대기 작업 재전송 실패:', error);
    });
}

function reconcileHydratedCurrentWorkBundle() {
  const factory = factoryRuntimeReadFactory();
  const cuts = state.cuts || {};
  const optionSorter = state.optionSorter || {};
  const hasCurrentImages = !!(
    state.imagePreview
    || state.imageBase64
    || (factory.assets || []).length
    || (factory.product?.inputImages || []).length
    || [...(cuts.prompts || []), ...(cuts.sizePrompts || [])].some(item => (
      item?.result || item?.image || item?.imageUrl || item?.archiveId
    ))
    || [...(optionSorter.images || []), ...(optionSorter.optionResults || [])].some(item => (
      item?.image || item?.imageUrl || item?.archiveId
    ))
  );
  if (!hasCurrentImages) return;
  void requestCurrentWorkBundleLiveSync('프로그램 시작 최신 자산 대조', {
    immediate: true,
    fullReconcile: true,
    sourceScheme: 'local-archive',
  });
}

if (typeof window !== 'undefined') {
  const replayWhenReady = () => replayPendingWorkBundleSync('프로그램 시작');
  if (document.readyState === 'complete') {
    queueMicrotask(replayWhenReady);
  } else {
    window.addEventListener('load', replayWhenReady, { once: true });
  }
  document.addEventListener('kuasangse:session-assets-hydrated', reconcileHydratedCurrentWorkBundle);
  if (window.__KUASANGSE_SESSION_ASSETS_HYDRATED__ === true) {
    queueMicrotask(reconcileHydratedCurrentWorkBundle);
  }
  window.addEventListener('online', () => replayPendingWorkBundleSync('연결 복구'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      replayPendingWorkBundleSync('화면 복귀');
      void currentWorkBundleActivityHeartbeat().then((heartbeat) => heartbeat.pulse());
    }
  });
}

async function exportCurrentProjectFile(options = {}) {
  await settleWorkspaceScopeTransitionPersistence();
  workspaceScopeTransitionState.inProgress = true;
  const startedAt = performance.now();
  const saveAs = options.saveAs === true;
  const downloadOnly = options.downloadOnly === true;
  const sourceFactory = factoryRuntimeReadCommittedFactory();
  const sourceWorkspaceId = factoryWorkspaceIdentityFromSource(sourceFactory).id;
  if (saveAs && state.currentProjectId) await startNewProjectDraft();
  const activeBranchScope = getCurrentLastWorkWorkspaceScope();
  let savedSuccessfully = false;
  const previousProjectName = state.currentProjectName;
  let adoptedProjectFileIdentity = null;
  state.workfileSaveState = 'saving';
  state.workfileSaveMode = downloadOnly ? 'download' : saveAs ? 'save-as' : 'current';
  state.projectBusy = true;
  render();
  try {
    if (typeof factoryUpdateFromInputs === 'function') factoryUpdateFromInputs();
    const requestedName = (saveAs ? state.currentProjectName : options.name) || state.currentProjectName || deriveProjectName();
    const fileName = `${factorySanitizeProjectFileName(requestedName)}.kuasangse`;
    const fileHandle = downloadOnly
      ? null
      : await selectFactoryProjectFileSaveHandle(fileName, {
        reuseCurrentFile: !saveAs,
      });
    const projectName = factoryProjectNameFromFileName(fileHandle?.name || fileName, requestedName);
    adoptedProjectFileIdentity = factoryEnsureCurrentProjectIdentityForFile(projectName, {
      previousWorkspaceId: saveAs ? sourceWorkspaceId : undefined,
    });
    const documentScopeId = `project:${adoptedProjectFileIdentity.id}`;
    const committedDocumentFactory = factoryRuntimeReadCommittedFactory();
    const activeWorkIdentity = state.workIdentity || committedDocumentFactory?.workIdentity || null;
    if (activeWorkIdentity?.workspaceId && activeWorkIdentity.workspaceId !== documentScopeId) {
      factoryBeginExplicitWorkIdentityTransition(
        committedDocumentFactory,
        'workfile-document-scope-transition',
        { clearState: true },
      );
    }
    const authority = await ensureWorkspaceEditAuthority(factoryProjectFileHandleScope());
    if (authority?.mode !== 'editing') {
      throw new Error('이 작업은 다른 창에서 편집 중입니다. 편집권을 가져오거나 새 작업으로 저장하세요.');
    }
    const currentHandleScope = factoryProjectFileHandleScope();
    const reusedCurrentFile = !!fileHandle && fileHandle === kuasangseProjectFileActiveHandle
      && currentHandleScope === kuasangseProjectFileActiveHandleScope;
    const bundle = await buildFactoryProjectFileBundle({ ...options, name: projectName });
    const serializedBundle = JSON.stringify(bundle);
    const blob = new Blob([serializedBundle], { type: 'application/json;charset=utf-8' });
    const prepared = prepareFactoryProjectBundlePersistence(bundle);
    const contentVersion = Number(state.contentVersion || 0);
    const metadata = workspacePersistenceApi().createMetadata({
      scopeId: prepared.scopeId,
      revision: bundle.persistence.revision,
      fencingToken: bundle.persistence.fencingToken,
      leaseId: bundle.persistence.leaseId,
      operationId: bundle.persistence.operationId,
    });
    const commitResult = await workspacePersistenceApi().commit({
      scopeId: prepared.scopeId,
      snapshot: prepared.snapshot,
      metadata,
      rebaseRevision: true,
      replicas: fileHandle ? ['workfile'] : [],
      context: {
        indexeddb: { records: prepared.records, sessionAssets: prepared.sessionAssets },
        server: {
          serverSnapshot: buildFactoryProjectPersistenceServerSnapshot(prepared, 'workfile-save'),
          force: true,
          repair: true,
        },
        workfile: { handle: fileHandle, value: blob, saveAs },
      },
      isCurrent: () => state.currentProjectId === prepared.projectId
        && Number(state.contentVersion || 0) === contentVersion,
    });
    if (!commitResult.accepted) throw new Error(commitResult.failures?.[0]?.message || '권위 저장소 저장 실패');
    if (!commitResult.clean) throw new Error(commitResult.failures?.[0]?.message || '작업파일 또는 필수 저장소 저장에 실패했습니다.');
    // 배치(조립공장 워커)에서는 브라우저 다운로드를 일으키지 않는다. 크롬이 저장 위치를 물으면
    // 그 대화상자가 페이지를 멈춰 세워 세션 하트비트가 끊기고, 제품마다 7MB 파일이 운영자의
    // 다운로드 폴더에 쌓인다. 작업파일 내용은 바로 위 commit 에서 이미 권위 저장소에 들어간다.
    if (!fileHandle && options.skipBrowserDownload !== true) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    if (fileHandle) {
      await rememberFactoryProjectFileHandle(fileHandle, { scope: factoryProjectFileHandleScope() });
    }
    markWorkspaceDocumentClean();
    state.workfileLastSavedAt = Date.now();
    state.workfileLastSaveDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
    state.workfileSaveState = 'saved';
    if (typeof factoryLog === 'function') {
      factoryLog(`작업파일 저장 완료: ${fileHandle?.name || fileName} (${state.workfileLastSaveDurationMs}ms)`, 'ok');
    }
    const saveTarget = fileHandle?.name || fileName;
    const saveMethod = downloadOnly
      ? '브라우저 다운로드'
      : reusedCurrentFile
        ? '현재 작업파일'
        : '선택한 로컬 위치';
    setUiNotice(`작업파일 저장: ${saveTarget} (${saveMethod})`, 'ok');
    if (typeof window !== 'undefined') {
      window.__KUASANGSE_LAST_WORKFILE_RECEIPT__ = Object.freeze({
        schema: 'kuasangse.workfile-save-receipt:v1',
        fileName: saveTarget,
        source: fileHandle ? 'workfile-handle' : 'browser-download',
        bytes: blob.size,
        sha256: await factoryRuntimeSha256Text(serializedBundle),
        workspaceId: String(bundle.workspaceId || '').trim(),
        projectName: String(bundle.project?.name || projectName || '').trim(),
        revision: Number(
          bundle.persistence?.revision?.counter
            ?? bundle.persistence?.revision
            ?? 0,
        ),
        exportedAt: Number(bundle.exportedAt || Date.now()),
      });
    }
    void requestCurrentWorkBundleLiveSync('작업파일 저장 최종 대조', {
      immediate: true,
      fullReconcile: true,
      documentCommit: true,
      sourceScheme: fileHandle ? 'workfile-handle' : 'browser-download',
      fileName: saveTarget,
      fileHandle,
    });
    try { await refreshWorkspaceLists(false); } catch (error) {
      console.warn('작업파일 복원 후 목록 갱신 실패:', error);
    }
    savedSuccessfully = true;
    return bundle;
  } catch (e) {
    if (adoptedProjectFileIdentity
      && factoryRuntimeRequireStore().isOperationCurrent(adoptedProjectFileIdentity.operationToken)) {
      factoryEnsureCurrentProjectIdentityForFile(previousProjectName, {
        projectId: adoptedProjectFileIdentity.id,
        previousWorkspaceId: adoptedProjectFileIdentity.id,
        createdAt: adoptedProjectFileIdentity.createdAt,
        operationToken: adoptedProjectFileIdentity.operationToken,
      });
    }
    if (e?.name === 'AbortError') {
      state.workfileSaveState = '';
      return null;
    }
    state.workfileSaveState = 'error';
    state.error = `작업파일 내보내기 실패: ${e.message || String(e)}`;
    if (typeof factoryLog === 'function') factoryLog(state.error, 'error');
    return null;
  } finally {
    try {
      await ensureWorkspaceEditAuthority(activeBranchScope, { force: true });
    } catch (authorityError) {
      state.error = state.error
        || `작업파일 저장 후 이 탭의 편집 브랜치를 복구하지 못했습니다: ${authorityError.message || String(authorityError)}`;
    }
    const persistAfterTransition = workspaceScopeTransitionState.persistentSaveQueued;
    workspaceScopeTransitionState.inProgress = false;
    workspaceScopeTransitionState.persistentSaveQueued = false;
    state.projectBusy = false;
    state.workfileSaveMode = '';
    render();
    if (savedSuccessfully || persistAfterTransition) {
      try { await savePersistentState({ skipSessionAssetSave: true, server: false }); } catch (error) {
        console.warn('작업파일 저장 후 탭 복구 상태 저장 실패:', error);
      }
    }
  }
}

function parseFactoryProjectFileBundle(text = '') {
  const sourceText = String(text || '');
  if (sourceText.length > KUASANGSE_PROJECT_FILE_MAX_BYTES) {
    throw new Error('작업파일이 256MB 제한을 초과했습니다. 파일을 나누거나 이미지 수를 줄여주세요.');
  }
  const parsed = JSON.parse(sourceText);
  if (parsed?.format === KUASANGSE_PROJECT_FILE_FORMAT && parsed?.project?.payload) return parsed;
  if (parsed?.payload || parsed?.factory || parsed?.assetPayload) {
    const migrated = workspacePersistenceApi().migrateWorkfilePayload(parsed);
    const payload = migrated.snapshot;
    return {
      ...parsed,
      format: KUASANGSE_PROJECT_FILE_FORMAT,
      version: KUASANGSE_PROJECT_FILE_VERSION,
      exportedAt: Number(parsed.exportedAt || Date.now()) || Date.now(),
      app: 'kuasangse',
      workspaceId: parsed.currentProjectId || payload.currentProjectId || '',
      currentProjectId: parsed.currentProjectId || payload.currentProjectId || '',
      persistence: migrated.metadata,
      project: {
        id: parsed.currentProjectId || payload.currentProjectId || uid('project'),
        name: parsed.name || payload.currentProjectName || payload.name || payload.productName || '가져온 작업파일',
        createdAt: parsed.currentProjectCreatedAt || payload.currentProjectCreatedAt || Date.now(),
        updatedAt: Date.now(),
        payload,
      },
      summary: factoryProjectFileSummary(payload),
    };
  }
  throw new Error('kuasangse 작업파일 형식이 아닙니다.');
}

async function importFactoryProjectFileBundle(bundle, options = {}) {
  const startedAt = performance.now();
  let preflightStateBackup = null;
  try {
    if (typeof structuredClone === 'function') preflightStateBackup = structuredClone(state);
  } catch (_) {}
  state.workfileRestoreState = 'loading';
  state.workfileRestoreMessage = '';
  state.workfileRestoreDurationMs = null;
  render();
  if (options.skipLeaveConfirm !== true) {
    const leave = await confirmSaveBeforeLeavingWorkspace('작업파일 불러오기');
    if (leave === 'cancel') {
      state.workfileRestoreState = '';
      render();
      return null;
    }
  }
  await settleWorkspaceScopeTransitionPersistence();
  workspaceScopeTransitionState.inProgress = true;
  let resetBoundaryStarted = false;
  let liveStateBackup = null;
  let factoryStoreBackup = null;
  let factoryOperationBackup = null;
  let previousAuthority = null;
  let targetScope = '';
  let targetAuthorityAcquired = false;
  let liveMutationStarted = false;
  let durableCommitCompleted = false;
  let visualValidationBatch = null;
  try {
    state.workfileRestoreState = 'validating';
    await new Promise(resolve => setTimeout(resolve, 0));
    const validation = validateFactoryProjectFileBundle(bundle);
    const project = bundle.project;
    const projectId = validation.projectId;
    const sourceDocumentScope = workspacePersistenceApi().normalizeWorkspaceScope(`project:${projectId}`);
    previousAuthority = currentWorkspaceAuthority();
    const preserveCurrentWork = projectRestorePreservesCurrentWork(projectId);
    const restoredWorkfile = await workspacePersistenceApi().restore({
      scopeId: sourceDocumentScope,
      explicitWorkfile: bundle,
    });
    const explicitLoad = await ensureExplicitProjectLoadAuthority();
    targetScope = explicitLoad.branchScope;
    const targetAuthority = explicitLoad.authority;
    const currentTargetAuthority = currentWorkspaceAuthority();
    const targetAuthorityIsEditable = ['editing', 'offline-edit'].includes(targetAuthority?.mode)
      && targetAuthority.scopeId === targetScope
      && ['editing', 'offline-edit'].includes(currentTargetAuthority?.mode)
      && currentTargetAuthority.scopeId === targetScope;
    if (!targetAuthorityIsEditable) {
      if (previousAuthority?.scopeId && previousAuthority.scopeId !== targetScope
        && ['editing', 'offline-edit'].includes(previousAuthority.mode)) {
        await ensureWorkspaceEditAuthority(previousAuthority.scopeId).catch(() => null);
      }
      throw new Error('이 탭의 독립 편집 브랜치를 열지 못했습니다.');
    }
    targetAuthorityAcquired = previousAuthority?.scopeId !== targetScope;
    const restoredPayload = restoredWorkfile?.snapshot || project.payload;
    const embeddedName = String(project.name || restoredPayload.currentProjectName || restoredPayload.name || '가져온 작업파일').trim();
    const name = factoryProjectNameFromFileName(options.fileName, embeddedName);
    const createdAt = Number(project.createdAt || restoredPayload.currentProjectCreatedAt || Date.now()) || Date.now();
    const hydratedPayload = await hydrateWorkspacePayloadImageBackup({
      ...restoredPayload,
      name,
      currentProjectId: projectId,
      currentProjectName: name,
      currentProjectCreatedAt: createdAt,
    });
    const payload = prepareFactoryProjectFilePayload(hydratedPayload, validation.manifest);
    await new Promise(resolve => setTimeout(resolve, 0));
    const preparedManifest = factoryProjectFileBuildManifest(payload, { id: projectId, name });
    payload.projectFileManifest = preparedManifest;
    if (typeof structuredClone !== 'function') throw new Error('이 브라우저는 안전한 작업파일 복원을 지원하지 않습니다.');
    const factoryStore = factoryRuntimeRequireStore();
    liveStateBackup = structuredClone(state);
    factoryStoreBackup = factoryRuntimeDetachedValue(factoryStore.getSnapshot());
    factoryOperationBackup = factoryStore.getOperationToken();
    await new Promise(resolve => setTimeout(resolve, 0));
    liveMutationStarted = true;
    if (typeof markWorkspaceBlankResetBoundary === 'function') {
      markWorkspaceBlankResetBoundary();
      resetBoundaryStarted = true;
    }
    visualValidationBatch = factoryBeginVisualValidationRenderBatch();
    resetLiveWorkspaceForProjectFileReplacement({ preserveCurrentWork });
    applyWorkspacePayload(payload, {
      projectId,
      projectName: name,
      createdAt,
      skipPersistence: true,
      skipSideEffects: true,
      replaceWorkspace: true,
      preserveCurrentWork,
      preserveFallback: { ...liveStateBackup, factory: factoryStoreBackup },
      validatedProjectFileRestore: true,
      payloadAlreadyDetached: true,
    });
    factoryEnsureCurrentProjectIdentityForFile(name, {
      projectId,
      previousWorkspaceId: factoryWorkspaceIdentityFromSource(factoryRuntimeReadFactory()).id,
      createdAt,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    factoryPrimeCurrentAssetVisualValidation(factoryRuntimeDetachedValue(factoryRuntimeReadFactory()));
    await factoryWaitForVisualValidationOperation(visualValidationBatch.token);
    await new Promise(resolve => setTimeout(resolve, 0));
    const importOperationToken = factoryRuntimeRequireStore().getOperationToken();
    const authorityBeforePersist = currentWorkspaceAuthority();
    if (!['editing', 'offline-edit'].includes(authorityBeforePersist?.mode)
      || authorityBeforePersist.scopeId !== targetScope
      || (targetAuthority?.fencingToken && authorityBeforePersist.fencingToken !== targetAuthority.fencingToken)
      || !factoryRuntimeRequireStore().isOperationCurrent(importOperationToken)) {
      const authorityChangedError = new Error(
        '작업파일을 적용하는 동안 편집권이 변경되었습니다. 현재 작업은 이전 상태로 복원됩니다.',
      );
      authorityChangedError.details = {
        targetScope,
        targetAuthority,
        authorityBeforePersist,
        operationCurrent: factoryRuntimeRequireStore().isOperationCurrent(importOperationToken),
      };
      throw authorityChangedError;
    }
    state.storageWarning = '';
    state.storageWarningDismissKey = '';
    try { persistAppliedWorkspacePayloadSideEffects({ skipPersistentState: true }); } catch (error) {
      console.warn('작업파일 복원 후 설정 저장 실패:', error);
    }
    try { markWorkspaceDocumentClean(); } catch (error) {
      console.warn('작업파일 복원 후 문서 상태 갱신 실패:', error);
    }
    workspaceScopeTransitionState.inProgress = false;
    if (resetBoundaryStarted && typeof completeWorkspaceBlankResetBoundary === 'function') {
      completeWorkspaceBlankResetBoundary();
      resetBoundaryStarted = false;
    }
    const sessionPersisted = await flushQueuedPersistentState({
      skipVisibleSync: true,
      deferWarningRender: true,
    });
    if (!sessionPersisted) {
      throw new Error('불러온 작업의 새로고침 복구용 탭 브랜치를 저장하지 못했습니다.');
    }
    durableCommitCompleted = true;
    clearResolvedSessionPersistenceWarning();
    state.workfileRestoreState = 'completed';
    state.workfileRestoreMessage = name;
    state.workfileRestoreDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
    try {
      if (typeof factoryLog === 'function') factoryLog(`작업파일 불러오기 완료: ${name}`, 'ok');
    } catch (error) {
      console.warn('작업파일 복원 완료 로그 기록 실패:', error);
    }
    try { setUiNotice(`작업파일 복원: ${name} (저장 당시 단계·이미지 그대로)`, 'ok'); } catch (error) {
      console.warn('작업파일 복원 완료 알림 표시 실패:', error);
    }
    try { await refreshWorkspaceLists(false); } catch (error) {
      console.warn('작업파일 복원 후 목록 갱신 실패:', error);
    }
    void requestCurrentWorkBundleLiveSync('저장 작업파일 불러오기 최종 대조', {
      immediate: true,
      fullReconcile: true,
      sourceScheme: 'loaded-workfile',
      fileName: String(options.fileName || `${name}.kuasangse`),
    });
    await refreshLoadedWorkfileArchiveAssets({ source: 'imported-workfile' });
    return { projectId, name, createdAt };
  } catch (error) {
    let rollbackFailure = null;
    if (!liveMutationStarted && preflightStateBackup) {
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, preflightStateBackup);
    }
    if (liveMutationStarted && liveStateBackup && factoryStoreBackup && factoryOperationBackup && !durableCommitCompleted) {
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, liveStateBackup);
      try {
        factoryRuntimeRequireStore().switchWorkspace(factoryOperationBackup.workspaceId, {
          snapshot: factoryStoreBackup,
          revision: factoryOperationBackup.revision,
        });
      } catch (restoreError) {
        rollbackFailure = restoreError;
      }
      if (targetAuthorityAcquired) {
        try {
          if (previousAuthority?.scopeId && ['editing', 'offline-edit'].includes(previousAuthority.mode)) {
            await ensureWorkspaceEditAuthority(previousAuthority.scopeId);
          } else {
            const lock = workspaceLockApi();
            const current = lock?.snapshot?.();
            if (current?.scopeId === targetScope && current.mode === 'editing') await lock.release();
          }
        } catch (authorityRestoreError) {
          rollbackFailure ||= authorityRestoreError;
        }
      }
    }
    state.workfileRestoreState = 'error';
    const reportedError = rollbackFailure
      ? new Error(`작업파일 복원 실패 후 이전 작업 상태를 되돌리지 못했습니다: ${rollbackFailure.message || String(rollbackFailure)}`, { cause: error })
      : error;
    state.workfileRestoreMessage = reportedError?.message || String(reportedError);
    state.workfileRestoreDurationMs = Math.max(0, Math.round(performance.now() - startedAt));
    throw reportedError;
  } finally {
    workspaceScopeTransitionState.inProgress = false;
    if (visualValidationBatch) factoryEndVisualValidationRenderBatch(visualValidationBatch);
    if (resetBoundaryStarted && typeof completeWorkspaceBlankResetBoundary === 'function') completeWorkspaceBlankResetBoundary();
    if (options.deferFinalRender !== true) render();
  }
}

async function importFactoryProjectFileFromText(text, options = {}) {
  const bundle = parseFactoryProjectFileBundle(text);
  await new Promise(resolve => requestAnimationFrame(resolve));
  return importFactoryProjectFileBundle(bundle, options);
}

function openFactoryProjectFileInput(options = {}) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = options.direct === true ? '.kuasangse' : '.kuasangse,application/json,.json';
  input.style.display = 'none';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    if (options.direct === true && !String(file.name || '').toLowerCase().endsWith('.kuasangse')) {
      state.error = '작업파일 직접 선택은 .kuasangse 파일만 지원합니다.';
      state.workfileRestoreState = 'error';
      state.workfileRestoreMessage = state.error;
      render();
      return;
    }
    if (file.size > KUASANGSE_PROJECT_FILE_MAX_BYTES) {
      state.error = '작업파일이 256MB 제한을 초과했습니다.';
      state.workfileRestoreState = 'error';
      state.workfileRestoreMessage = state.error;
      render();
      return;
    }
    state.projectBusy = true;
    render();
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      const text = await file.text();
      await importFactoryProjectFileFromText(text, {
        fileName: file.name,
        skipLeaveConfirm: options.skipLeaveConfirm === true,
        deferFinalRender: true,
      });
    } catch (e) {
      state.error = `작업파일 불러오기 실패: ${e.message || String(e)}`;
      if (typeof factoryLog === 'function') factoryLog(state.error, 'error');
    } finally {
      state.projectBusy = false;
      render();
    }
  };
  document.body.appendChild(input);
  input.click();
}

async function openFactoryProjectFilePicker(options = {}) {
  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const handle = await workspacePersistenceApi().chooseProjectFileForOpen({
        id: KUASANGSE_PROJECT_FILE_PICKER_ID,
        startIn: kuasangseProjectFileLastHandle || 'documents',
        types: factoryProjectFilePickerTypes(),
        excludeAcceptAllOption: false,
        multiple: false,
      });
      if (!handle) return;
      const { file, text } = await workspacePersistenceApi().readProjectFile(handle);
      if (file.size > KUASANGSE_PROJECT_FILE_MAX_BYTES) {
        throw new Error('작업파일이 256MB 제한을 초과했습니다.');
      }
      state.projectBusy = true;
      render();
      await new Promise(resolve => setTimeout(resolve, 0));
      const imported = await importFactoryProjectFileFromText(text, {
        fileName: file.name,
        skipLeaveConfirm: options.skipLeaveConfirm === true,
        deferFinalRender: true,
      });
      if (imported) await rememberFactoryProjectFileHandle(handle, { scope: factoryProjectFileHandleScope() });
    } catch (e) {
      if (e?.name !== 'AbortError') {
        state.error = `작업파일 불러오기 실패: ${e.message || String(e)}`;
        if (typeof factoryLog === 'function') factoryLog(state.error, 'error');
      }
    } finally {
      state.projectBusy = false;
      render();
    }
    return;
  }
  return openFactoryProjectFileInput(options);
}

async function initializeExternalWorkfileOpenBridge() {
  const moduleUrl = new URL(
    'src/modules/external-workfile-open.mjs',
    document.baseURI,
  ).href;
  const { createExternalWorkfileOpenBridge } = await import(moduleUrl);
  createExternalWorkfileOpenBridge({
    root: window,
    allowedOrigins: [
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ],
    importWorkfile: async (text, fileName, options = {}) => {
      const bundle = parseFactoryProjectFileBundle(text);
      await new Promise(resolve => requestAnimationFrame(resolve));
      const imported = await importFactoryProjectFileBundle(bundle, {
        fileName,
        deferFinalRender: true,
        skipLeaveConfirm: options.skipLeaveConfirm === true,
      });
      if (imported) {
        factoryControlPreflightCache.clear();
        const syncBundle = await buildFactoryProjectFileBundle({
          name: imported.name || fileName,
        });
        await requestCurrentWorkBundleLiveSync('로컬 작업파일 불러오기', {
          immediate: true,
          fullReconcile: true,
          sourceScheme: 'local-workfile',
          fileName,
          fileHandle: null,
        });
        return {
          ...imported,
          productKey: String(syncBundle?.manifest?.identity?.productKey || '').trim(),
        };
      }
      return imported;
    },
  });
}

void initializeExternalWorkfileOpenBridge().catch((error) => {
  console.warn('신화사 자산관 작업파일 열기 연결 실패:', error);
});

async function deleteProjectRecord(projectId) {
  try {
    const snapshots = await workspaceGetAll(WORKSPACE_DB.snapshots);
    const linked = snapshots.filter(s => s.projectId === projectId);
    for (const snap of linked) {
      await workspaceDelete(WORKSPACE_DB.snapshots, snap.id);
      await workspaceDelete(WORKSPACE_DB.appSettings, workspaceImageBackupKey('snapshot', snap.id)).catch(() => {});
    }
    await workspaceDelete(WORKSPACE_DB.projects, projectId);
    await workspaceDelete(WORKSPACE_DB.appSettings, workspaceImageBackupKey('project', projectId)).catch(() => {});
    if (state.currentProjectId === projectId) {
      state.currentProjectId = '';
      state.currentProjectName = '';
      state.currentProjectCreatedAt = null;
      state.snapshots = [];
      savePersistentState();
    }
    await refreshWorkspaceLists(false);
    render();
  } catch (e) {
    state.error = `작업 삭제 실패: ${e.message}`;
    render();
  }
}

async function deleteSnapshotRecord(snapshotId) {
  try {
    await workspaceDelete(WORKSPACE_DB.snapshots, snapshotId);
    await workspaceDelete(WORKSPACE_DB.appSettings, workspaceImageBackupKey('snapshot', snapshotId)).catch(() => {});
    await refreshWorkspaceLists(false);
    render();
  } catch (e) {
    state.error = `버전 삭제 실패: ${e.message}`;
    render();
  }
}

// 조립공장 시작 버튼(파란 버튼)을 누른 제품명이 그 작업의 작업파일 이름이 되게 한다.
//
// 왜 필요한가: 예전에는 시작 버튼이 **이름만** 바꾸고 작업파일은 열려 있던 것 그대로였다.
// 그래서 관제탑 배치 문서가 열려 있으면 그 안에서 이름표만 갈아 끼우는 꼴이 됐고,
// 새로고침하면 그 문서의 원래 이름으로 되돌아갔다.
// (사용자: "슬라브나비수부채집으로 입력하고 해도 ... 어느샌가 제품명이 수저집 파우치로
//  맘대로 돌아가있어 ... 한 20번정도 계속같은문제로 고통받았던 문제야")
//
// 규칙 — 이름은 출발점이지 족쇄가 아니다:
//   - 남의 문서(batch:) 안이면 내 작업파일로 분리한다. 내용은 그대로 가져간다.
//   - 아직 저장본이 없으면 이 이름을 첫 작업파일 이름으로 세운다.
//   - **이미 내 작업파일 안이면 이름을 건드리지 않는다.** 첫 이름에 매몰되지 않게,
//     이후 이름 변경은 사람이 '다른 이름' 으로 한다.
//   - 다량생산(배치 워커) 탭에서는 아무것도 하지 않는다. 워커는 제 문서를 그대로 써야 한다.
async function factoryAdoptWorkfileNameOnStart(productName) {
  // typeof 로는 못 막는다. 이 변수는 아래에서 let 으로 선언되므로 선언 전 접근이면
  // typeof 조차 ReferenceError 를 던진다. 지금은 이 함수가 늦게 불려 안 터지지만 지뢰라 감싼다.
  // (같은 함정이 app-core-02.js 에서 실제로 터져 강제 새로고침에 생성물이 통째로 사라졌다 — SAVE-26)
  let batchWorkerModeNow = false;
  try { batchWorkerModeNow = classicRuntimeBatchWorkerMode === true; } catch (_) { batchWorkerModeNow = false; }
  if (batchWorkerModeNow) return false;
  const name = String(productName || '').trim().slice(0, 80);
  if (!name) return false;
  const currentId = String(state.currentProjectId || '').trim();
  if (currentId) {
    // 남의 문서(batch:) 안이어도 **여기서 작업파일을 가르지 않는다.**
    //
    // 8/9 '잘되는상태커밋ver1' 과 지금을 대조해 배운 것:
    //   저장 ID를 비우는 진입점이 그때는 4개였고 **전부 사람이 직접 누르는 것**이었다
    //   ('새 작업', '다른 이름', '사본 저장'). 내가 시작 버튼에 다섯 번째를 붙였고,
    //   그 순간 저장 ID가 비면서 신원 정리가 사람이 손으로 넣은 값을 전부 지웠다.
    //   ("왜자꾸 너가 코딩하나할떄마다 이게날라가냐고")
    //
    // 규칙: **파괴적인 동작은 사람이 명시적으로 누른 순간에만 연결한다.**
    // 편의 기능을 위해 파괴 함수를 재사용하지 않는다. 여기서는 알려만 주고,
    // 가르는 것은 사람이 '다른 이름' 을 눌렀을 때만 한다.
    if (/^batch:/i.test(currentId) && typeof setUiNotice === 'function') {
      setUiNotice(
        `지금 열려 있는 것은 생산관제가 만든 작업파일입니다. '${name}' 로 따로 저장하려면 '다른 이름' 을 눌러주세요.`,
        'warn',
      );
    }
    return false;
  }
  // 아직 저장본이 없다. 저장 ID를 흔들지 않고 이름만 세운다.
  if (String(state.currentProjectName || '').trim() === name) return false;
  state.currentProjectName = name;
  if (typeof factoryRuntimeUpdateOwnedFactory === 'function') {
    factoryRuntimeUpdateOwnedFactory('factory/runtime:updateWorkspaceIdentity', 'factory', factory => {
      factory.workspace = factory.workspace && typeof factory.workspace === 'object' ? factory.workspace : {};
      factory.workspace.name = name;
      factory.currentProjectName = name;
      return name;
    });
  }
  if (typeof savePersistentState === 'function') savePersistentState();
  return true;
}

async function startNewProjectDraft(options = {}) {
  // 사람이 직접 누른 것이다. 이 뒤의 삭제는 사고가 아니다.
  if (typeof factoryMarkUserRequestedReset === 'function') factoryMarkUserRequestedReset('start-new-project-draft');
  // 내용은 유지하고 저장 ID만 분리 (다른 이름으로 저장 / Save As)
  // options.name 을 주면 그 이름으로 분리한다. 안 주면 예전처럼 '… 복사본'.
  const requestedName = String(options.name || '').trim().slice(0, 80);
  const draftScope = typeof rotateLastWorkDraftScope === 'function'
    ? rotateLastWorkDraftScope()
    : getCurrentLastWorkWorkspaceScope();
  if (typeof settleLastWorkDraftScopePersistence === 'function') {
    await settleLastWorkDraftScopePersistence(draftScope);
  }
  state.currentProjectId = '';
  state.currentProjectName = requestedName || `${deriveProjectName() || '상세페이지 작업'} 복사본`.slice(0, 80);
  state.currentProjectCreatedAt = null;
  state.workIdentity = null;
  await ensureWorkspaceEditAuthority(draftScope, { force: true });
  state.workfileSaveState = '';
  state.workfileLastSavedAt = null;
  state.workfileLastSaveDurationMs = null;
  state.workfileRestoreState = '';
  state.workfileRestoreMessage = '';
  state.workfileRestoreDurationMs = null;
  state.snapshots = [];
  factoryRuntimeUpdateOwnedFactory('factory/runtime:updateWorkspaceIdentity', 'factory', factory => {
    factory.workIdentity = null;
    factory.workspace = { id: '', name: state.currentProjectName, createdAt: null, updatedAt: null };
    factory.currentProjectId = '';
    factory.currentProjectName = state.currentProjectName;
    return state.currentProjectName;
  });
  markWorkspaceDocumentDirty();
  savePersistentState();
  setUiNotice(requestedName
    ? `'${requestedName}' 작업파일로 시작합니다. 이름은 나중에 '다른 이름' 으로 언제든 바꿀 수 있습니다.`
    : '새 저장본으로 분리했습니다. 지금 저장하면 별도 작업파일이 됩니다.', 'ok');
  render();
}

async function resetActiveWorkspaceDocumentCore() {
  if (typeof markWorkspaceBlankResetBoundary === 'function') {
    try { markWorkspaceBlankResetBoundary(); } catch (e) {}
  }
  if (typeof settleWorkspaceScopeTransitionPersistence === 'function') {
    await settleWorkspaceScopeTransitionPersistence();
  }
  if (typeof settleLastWorkBootstrapWrites === 'function') {
    await settleLastWorkBootstrapWrites();
  }
  await clearPersistentSession();
  if (typeof clearFactoryProjectFileLocationForBlankWork === 'function') {
    clearFactoryProjectFileLocationForBlankWork();
  }
  const draftScope = typeof rotateLastWorkDraftScope === 'function'
    ? rotateLastWorkDraftScope()
    : getCurrentLastWorkWorkspaceScope();
  if (typeof settleLastWorkDraftScopePersistence === 'function') {
    await settleLastWorkDraftScopePersistence(draftScope);
  }
  await ensureWorkspaceEditAuthority(draftScope, { force: true });
  const resetFence = typeof captureWorkspaceDocumentFence === 'function'
    ? captureWorkspaceDocumentFence({
      expectedWorkspaceScope: draftScope,
      expectedWorkspaceResetToken: workspaceBlankResetToken,
      allowBlankResetCheckpoint: true,
    })
    : null;
  if (typeof saveLastWorkBootstrap === 'function') {
    await saveLastWorkBootstrap({
      scopeId: draftScope,
      currentProjectId: '',
      currentProjectName: '',
      currentProjectCreatedAt: null,
      step: 'factory',
      documentFence: resetFence,
      awaitWrite: true,
      errorMessage: '새 작업의 현재 작업파일 포인터를 저장하지 못했습니다. 새로고침하지 말고 다시 시도해주세요.',
    });
  }
  state.currentProjectId = '';
  state.currentProjectName = '';
  state.currentProjectCreatedAt = null;
  state.workIdentity = null;
  state.workfileSaveState = '';
  state.workfileLastSavedAt = null;
  state.workfileLastSaveDurationMs = null;
  state.workfileRestoreState = '';
  state.workfileRestoreMessage = '';
  state.workfileRestoreDurationMs = null;
  state.snapshots = [];
  state.productName = '';
  state.imagePreview = null;
  state.imageBase64 = null;
  state.imageMime = null;
  state.imageName = '';
  state.analysisImages = [];
  state.analysis = null;
  state.competitorData = null;
  state.analysisTimestamp = null;
  state.analysisRuns = [];
  state.currentAnalysisRunId = '';
  state.analysisLogOpen = false;
  state.analysisCompareMode = 'image';
  state.analysisMatchSettings = normalizeAnalysisMatchSettings();
  state.dbMatchBusy = false;
  state.dbMatchCandidates = [];
  state.dbMatchError = '';
  state.dbMatchLastQuery = '';
  state.dbMatchSelectionOpen = false;
  state.dbColorOptionsBusy = false;
  state.dbColorOptions = [];
  state.dbColorOptionsError = '';
  state.dbColorOptionsLastJcode = '';
  state.dbColorOptionsLoadedAt = null;
  state.productInfoFieldSettings = normalizeProductInfoFieldSettings();
  state.productInfoOptionsOpen = false;
  state.productInfoManualValues = {};
  state.showRawJson = false;
  if (typeof factoryPreserveCurrentDetailHtmlBeforeSectionReset === 'function') {
    try { factoryPreserveCurrentDetailHtmlBeforeSectionReset('새 작업으로 섹션 상태 초기화'); } catch (e) {}
  }
  state.sectionInstructions = {};
  state.sectionContents = {};
  state.sectionImages = {};
  state.sectionLocks = {};
  state.sectionInstructionSources = {};
  state.sectionGenerationModes = {};
  state.sectionBasisModes = {};
  state.sectionAssembly = {};
  state.sectionGenerationMeta = {};
  state.sectionVariants = {};
  state.currentSectionVariantIds = {};
  state.sectionTipHelperApplied = {};
  state.sectionVariantEvaluations = {};
  state.sectionVariantEvaluationBusy = {};
  state.aiRepairUndoStack = {};
  state.manualSectionEdits = {};
  state.previewLayerEdits = {};
  state.editorHistory = { undo: [], redo: [] };
  state.detailImageBlocks = [];
  state.fixedDetailImages = {};
  if (typeof saveFixedDetailImages === 'function') {
    try { saveFixedDetailImages({}); } catch (e) {}
  }
  state.imageDirectives = [];
  state.imageDirectiveInput = '';
  state.previewLayerMode = false;
  state.activePreviewLayer = null;
  state.promptTraceModal = { open: false, sectionId: null, variantId: null };
  state.aiRepair = { ...(state.aiRepair || {}), open: false, sectionId: null, prompt: '', maskDataUrl: '', busy: false, error: '' };
  state.sectionGenerating = {};
  state.sectionBatchRun = null;
  state.activeSectionEdit = null;
  state.editingPreviewSection = null;
  state.qaReport = null;
  state.contentVersion = 0;
  state.qaVersion = 0;
  state.sectionOrder = SECTIONS.map(s => s.id);
  state.hiddenSectionIds = [];
  state.customSections = [];
  state.progress = 0;
  state.progressMsg = '';
  state.error = '';
  state.storageWarning = '';
  state.compPage = {
    ...(state.compPage || {}),
    subStep: 'input',
    analyzeMsg: '',
    uploadedImages: [],
    htmlText: '',
    urlInput: '',
    analysisResult: null,
    sectionPlan: null,
    planEdits: {},
    scraperImportLoading: false,
    scraperImportInfo: null,
    scraperImportError: '',
    previewImageIndex: null,
    evidencePreview: null,
    analyzeProgress: 0,
    analyzeStage: '',
    analyzeDetail: '',
    analyzeLogs: [],
    analyzeModel: null,
    analyzeStartedAt: null,
    analyzeElapsedSec: 0,
    evidenceImages: [],
    marketScrape: null,
    sectionStatus: {},
    sectionWorkScope: null,
  };

  const previousCuts = state.cuts && typeof state.cuts === 'object' ? state.cuts : {};
  const cleanCutPrompt = prompt => {
    const next = { ...(prompt || {}), generating: false };
    [
      'result', 'image', 'imageUrl', 'dataUrl', 'preview', 'thumbnail', 'thumbnailUrl', 'src', 'base64',
      'archiveId', 'localArchiveId', 'localArchive', 'metadata', 'sourceMap', 'resultAssetId', 'resultImageUrl',
      'workspaceId', 'currentProjectId', 'projectId', 'currentRunId', 'generationRunId',
      'productKey', 'productIdentityKey', 'inputImageFingerprint', 'inputImageKey', 'sourceImageKey', 'stageId',
    ].forEach(key => { if (key in next) delete next[key]; });
    return next;
  };
  state.cuts = {
    ...previousCuts,
    sourceBase64: null,
    sourceMime: null,
    sourcePreview: null,
    workImageBase64: null,
    workImageMime: null,
    workImagePreview: null,
    hasSourceImage: false,
    hasWorkImage: false,
    workDriveRunning: false,
    localArchiveSaving: false,
    runBusy: false,
    runStatus: '',
    runStatusType: '',
    runLogs: [],
    prompts: (Array.isArray(previousCuts.prompts) ? previousCuts.prompts : []).map(cleanCutPrompt),
    sizePrompts: (Array.isArray(previousCuts.sizePrompts) ? previousCuts.sizePrompts : []).map(cleanCutPrompt),
    placement: {},
    results: [],
    sizeResults: [],
    resultCache: {},
    sizeCutResultCache: {},
  };
  state.optionSorter = typeof defaultOptionSorterState === 'function'
    ? defaultOptionSorterState()
    : (typeof normalizeOptionSorterState === 'function' ? normalizeOptionSorterState({}) : {});

  const freshFactory = typeof defaultFactoryState === 'function' ? defaultFactoryState() : {
    workspace: { id: '', name: '', createdAt: null, updatedAt: null },
    product: {},
    assets: [],
    previousAssets: [],
    stages: {},
    automation: { activeTab: 'start' },
    logs: [],
  };
  if (typeof factoryStartNewWorkflowRun === 'function') {
    try { factoryStartNewWorkflowRun(freshFactory); } catch (e) {}
  }
  factoryRuntimeReplaceFactorySnapshot(freshFactory, {
    mode: 'hydrate',
    reason: 'blank-workspace-reset',
    workspaceId: draftScope,
    blankDraftReset: true,
  });
  state.sectionWorkScope = sectionWorkScopeMeta({
    factory: freshFactory,
    productName: '',
    analysis: null,
    analysisImages: [],
    imageBase64: '',
  });
  state.step = 'factory';
  saveSectionInstructions({});
  saveSectionGenerationModes({});
  saveSectionBasisModes({});
  saveSectionAssembly({});
  if (typeof saveImageDirectives === 'function') {
    try { saveImageDirectives(); } catch (e) {}
  }
  const blankFactory = typeof factoryRuntimeReadCommittedFactory === 'function'
    ? factoryRuntimeReadCommittedFactory()
    : state.factory;
  const blankFactorySnapshot = typeof factoryRuntimeDetachedValue === 'function'
    ? factoryRuntimeDetachedValue(blankFactory)
    : cloneData(blankFactory);
  const blankSaved = await savePersistentState({
    factory: blankFactorySnapshot,
    skipVisibleSync: true,
    deferWarningRender: true,
    skipSessionAssetSave: true,
    allowBlankResetCheckpoint: true,
    expectedWorkspaceScope: draftScope,
    expectedWorkspaceResetToken: resetFence?.resetToken,
  });
  if (blankSaved !== true) {
    throw new Error('새 작업의 빈 문서 checkpoint를 저장하지 못했습니다. 새로고침하지 말고 다시 시도해주세요.');
  }
  if (typeof settleLastWorkBootstrapWrites === 'function') {
    await settleLastWorkBootstrapWrites();
  }
  markWorkspaceDocumentClean();
  render();
}

async function startBlankWorkDraft() {
  const leave = await confirmSaveBeforeLeavingWorkspace('새 작업');
  if (leave === 'cancel') return;
  try {
    await resetActiveWorkspaceDocumentCore();
    if (typeof factoryLog === 'function') {
      factoryLog('새 작업을 시작했습니다. 이전 기본이미지와 후보/컷/상세 통로를 비웠습니다.', 'ok');
    }
    setUiNotice('새 작업을 시작했습니다. 이전 기본이미지와 작업 내용은 비웠고 저장된 작업 목록·프리셋·API 설정은 유지됩니다.', 'ok');
    render();
  } finally {
    if (typeof completeWorkspaceBlankResetBoundary === 'function') {
      completeWorkspaceBlankResetBoundary();
    }
  }
}

async function startNewWorkDocument() {
  return startBlankWorkDraft();
}

function sectionContentFingerprint(content, imageData) {
  return JSON.stringify({
    headline: content?.headline || '',
    subheadline: content?.subheadline || '',
    body_text: content?.body_text || '',
    cta_text: content?.cta_text || '',
    extra_elements: content?.extra_elements || [],
    image: imageData ? `img:${String(imageData).slice(0, 32)}` : '',
  });
}

function nextVariantLabel(sectionId, source = 'variant') {
  const list = state.sectionVariants[sectionId] || [];
  const count = list.length + 1;
  if (source === 'manual') return `수정안 ${count}`;
  if (source === 'baseline') return `기준안 ${count}`;
  if (source === 'competitor') return `경쟁사 플랜안 ${count}`;
  if (source === 'analysis_self') return `이미지 분석안 ${count}`;
  return `시안 ${count}`;
}

function captureSectionVariantModels(sectionId, hasImage = true) {
  const meta = state.sectionGenerationMeta?.[sectionId] || {};
  const llm = meta.llmModelId
    ? {
        providerId: meta.llmProviderId || '',
        providerLabel: meta.llmProviderLabel || '',
        modelId: meta.llmModelId,
        modelLabel: meta.llmModelLabel || getLlmModelLabel(meta.llmModelId, meta.llmProviderId),
        route: meta.llmRoute || '',
      }
    : getCurrentLlmRunInfo();
  const img = !hasImage ? null : (meta.imageModelId
    ? {
        providerId: meta.imageProviderId || '',
        providerLabel: meta.imageProviderLabel || '',
        modelId: meta.imageModelId,
        modelLabel: meta.imageModelLabel || getImageModelLabel(meta.imageModelId),
        route: meta.imageRoute || '',
      }
    : getCurrentImageRunInfo());
  return {
    llmProviderId: llm.providerId || '',
    llmProviderLabel: llm.providerLabel || '',
    llmModelId: llm.modelId || '',
    llmModelLabel: llm.modelLabel || '',
    llmRoute: llm.route || '',
    imageProviderId: img?.providerId || '',
    imageProviderLabel: img?.providerLabel || '',
    imageModelId: img?.modelId || '',
    imageModelLabel: img?.modelLabel || '',
    imageRoute: img?.route || '',
    recordedAt: Date.now(),
  };
}

const SECTION_VARIANT_CURRENT_IMAGE_REF = 'current-section-image';

function sectionVariantImageForDisplay(sectionId, variant) {
  if (!variant || typeof variant !== 'object') return '';
  if (variant.image) return variant.image;
  if (
    variant.imageRef === SECTION_VARIANT_CURRENT_IMAGE_REF &&
    state.currentSectionVariantIds?.[sectionId] === variant.id
  ) {
    return state.sectionImages?.[sectionId] || '';
  }
  return '';
}

function materializeCurrentSectionVariantImage(sectionId, list = []) {
  const currentId = state.currentSectionVariantIds?.[sectionId] || '';
  const currentImage = state.sectionImages?.[sectionId] || '';
  if (!currentId || !currentImage) return list;
  let changed = false;
  const next = list.map(item => {
    if (
      item?.id === currentId &&
      item.imageRef === SECTION_VARIANT_CURRENT_IMAGE_REF &&
      !item.image
    ) {
      changed = true;
      return { ...item, image: currentImage, imageRef: '' };
    }
    return item;
  });
  if (changed) state.sectionVariants[sectionId] = next;
  return changed ? next : list;
}

function compactCurrentSectionVariantImages(sectionId = '') {
  const ids = sectionId ? [sectionId] : Object.keys(state.currentSectionVariantIds || {});
  let changed = false;
  ids.forEach(id => {
    const currentId = state.currentSectionVariantIds?.[id] || '';
    const currentImage = state.sectionImages?.[id] || '';
    if (!currentId || !currentImage) return;
    const list = Array.isArray(state.sectionVariants?.[id]) ? state.sectionVariants[id] : [];
    list.forEach(variant => {
      if (variant?.id === currentId && variant.image === currentImage) {
        variant.image = null;
        variant.imageRef = SECTION_VARIANT_CURRENT_IMAGE_REF;
        changed = true;
      }
    });
  });
  return changed;
}

/**
 * 섹션 변형 그림을 보관함에 남긴다.
 *
 * 대표·사이즈·옵션·일반 네 단계는 후보마다 보관함 주소를 달고 있어 관제탑에서
 * 그림을 보고 고를 수 있다. 섹션만 그 주소가 없어 "미리보기 없음" 이 떴고,
 * 사람은 무엇을 고르는지 모른 채 찍어야 했다.
 *
 * 그림 자체를 보고에 실으면 무거워지므로 싣지 않는다. 보관함에 한 번 넣고
 * 주소 한 줄만 변형에 남긴다. 화면은 그 주소로 필요할 때만 받아 온다.
 *
 * 실패해도 생성은 막지 않는다. 주소가 없으면 예전처럼 글로 구분될 뿐이다.
 */
async function archiveSectionVariantImage(sectionId, variant, imageData) {
  const dataUrl = String(imageData || '').trim();
  if (!variant || !/^data:image\//i.test(dataUrl)) return false;
  try {
    const base = typeof factoryRuntimeBackendBaseUrl === 'function' ? factoryRuntimeBackendBaseUrl() : '';
    const factory = (typeof factoryRuntimeReadFactory === 'function' ? factoryRuntimeReadFactory() : null) || {};
    const product = factory.product || {};
    const workspaceId = typeof factoryCurrentWorkspaceId === 'function'
      ? factoryCurrentWorkspaceId(factory)
      : String(factory.currentProjectId || '');
    const body = {
      workspaceId,
      productName: String(product.productName || state.productName || '').trim(),
      productKey: String(product.productKey || product.productIdentityKey || '').trim(),
      stageId: 'sections',
      asset: {
        id: variant.id,
        stageId: 'sections',
        type: 'image',
        title: `${sectionId} ${variant.label || ''}`.trim(),
        image: dataUrl,
        createdAt: variant.createdAt || Date.now(),
        workspaceId,
        currentProjectId: workspaceId,
        metadata: { sectionId, variantId: variant.id, source: variant.source || 'section-variant' },
      },
    };
    // 보관함 쓰기는 작업파일 점유권(lease)이 있어야 통과한다. 맨 fetch 로 부르면
    // 428 PRECONDITION_REQUIRED 로 거절된다. 점유권을 붙여 주는 통로로 부른다.
    if (typeof workspaceArchiveFetch !== 'function') return false;
    if (typeof ensureWorkspaceEditAuthority === 'function') {
      const authority = await ensureWorkspaceEditAuthority();
      if (!['editing', 'offline-edit'].includes(String(authority?.mode || ''))) return false;
    }
    const res = await workspaceArchiveFetch(`${base}/api/local-archive/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false;
    const payload = await res.json();
    const archiveId = String(payload?.archive?.id || payload?.archive?.archiveId || '').trim();
    if (!archiveId) return false;
    variant.archiveId = archiveId;
    variant.imageUrl = `/api/local-archive/assets/${encodeURIComponent(archiveId)}/image`;
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 상세페이지 변형의 본문을 보관함에 파일로 남긴다.
 *
 * 상세 HTML 은 24000자를 넘으면 작업 상태에서 지워진다(factoryRuntimePruneAsset).
 * "지금 섹션으로 다시 만들 수 있다"는 이유인데, 다시 만들면 지금 섹션이 나올 뿐
 * 그때 그 변형은 아니다. 그래서 고른 변형이 무엇이었는지 확인할 길이 사라진다 —
 * 실측 2026-08-27: 보관함에 html 0건, jpg 665건.
 *
 * 보관함 백엔드는 asset.html 을 받으면 detail.html 로 써 두고 그대로 돌려준다.
 * 보내 주기만 하면 되므로, 변형을 만들 때 본문 사본을 함께 남긴다.
 */
async function archiveDetailVariantHtml(asset, html) {
  const body = String(html || '').trim();
  if (!asset || !body || typeof workspaceArchiveFetch !== 'function') return false;
  if (String(asset.documentArchiveId || '').trim()) return true;
  try {
    const base = typeof factoryRuntimeBackendBaseUrl === 'function' ? factoryRuntimeBackendBaseUrl() : '';
    const factory = (typeof factoryRuntimeReadFactory === 'function' ? factoryRuntimeReadFactory() : null) || {};
    const product = factory.product || {};
    const workspaceId = typeof factoryCurrentWorkspaceId === 'function'
      ? factoryCurrentWorkspaceId(factory)
      : String(factory.currentProjectId || '');
    const payload = {
      workspaceId,
      productName: String(product.productName || state.productName || '').trim(),
      productKey: String(product.productKey || product.productIdentityKey || '').trim(),
      stageId: 'detail',
      asset: {
        id: asset.id,
        stageId: 'detail',
        type: 'html',
        title: String(asset.title || '상세페이지 변형'),
        html: body,
        prompt: String(asset.prompt || ''),
        createdAt: asset.createdAt || Date.now(),
        workspaceId,
        currentProjectId: workspaceId,
        metadata: {
          ...(asset.metadata && typeof asset.metadata === 'object' ? asset.metadata : {}),
          detailVariantAssetId: asset.id,
          source: 'detail-variant-document',
        },
      },
    };
    // 보관함 쓰기는 편집 점유권을 요구한다. 없으면 fetch 가
    // "archive mutation requires the current edit authority" 로 거절된다.
    if (typeof ensureWorkspaceEditAuthority === 'function') {
      const authority = await ensureWorkspaceEditAuthority();
      if (!['editing', 'offline-edit'].includes(String(authority?.mode || ''))) return false;
    }
    const res = await workspaceArchiveFetch(`${base}/api/local-archive/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return false;
    const result = await res.json();
    const archiveId = String(result?.archive?.id || result?.archive?.archiveId || '').trim();
    if (!archiveId) return false;
    // documentArchiveId 만 남긴다. archiveId 까지 붙이면 투영이 "그림이 있는 자산"으로 보고
    // .../thumbnail 주소를 만들어 내는데, 이 보관본에는 그림이 없어 빈 칸이 뜬다.
    asset.documentArchiveId = archiveId;
    // 보관은 저장이 끝난 뒤에 마무리된다. 그래서 위에서 붙인 표는 이미 커밋된 사본에
    // 닿지 못하고 사라진다. 저장된 자산에 같은 표를 한 번 더 붙여야 화면이 찾을 수 있다.
    if (typeof factoryRuntimeUpdateOwnedFactory === 'function') {
      try {
        await factoryRuntimeUpdateOwnedFactory(
          'factory/runtime:preserveDetailHtml',
          'factory-assets',
          draft => {
            const target = (draft.assets || []).find(item => String(item?.id || '') === String(asset.id || ''));
            if (!target) return false;
            target.documentArchiveId = archiveId;
            return true;
          },
        );
      } catch (_) { /* 표를 못 붙여도 본문은 이미 남았다. 다음 저장에서 다시 붙는다. */ }
    }
    return true;
  } catch (error) {
    return false;
  }
}

function rememberSectionVariant(sectionId, content, imageData, source = 'variant', explicitLabel = '') {
  if (!content) return null;
  const list = materializeCurrentSectionVariantImage(sectionId, state.sectionVariants[sectionId] || []);
  const fingerprint = sectionContentFingerprint(content, imageData);
  const existing = list.find(item => item.fingerprint === fingerprint);
  if (existing) {
    if (!existing.models) existing.models = captureSectionVariantModels(sectionId, !!imageData);
    return existing;
  }
  const useCurrentImageRef = !!imageData && state.sectionImages?.[sectionId] === imageData;
  const variant = {
    id: uid(`variant_${sectionId}`),
    label: explicitLabel || nextVariantLabel(sectionId, source),
    source,
    createdAt: Date.now(),
    fingerprint,
    content: cloneData(content),
    image: useCurrentImageRef ? null : (imageData || null),
    imageRef: useCurrentImageRef ? SECTION_VARIANT_CURRENT_IMAGE_REF : '',
    models: captureSectionVariantModels(sectionId, !!imageData),
  };
  state.sectionVariants[sectionId] = [variant, ...list].slice(0, 8);
  // 그림은 보관함에 맡기고 주소만 들고 있는다. 저장을 기다리지 않는다 —
  // 늦게 붙어도 다음 보고부터 화면에 그림이 뜬다.
  const variantImage = imageData || (useCurrentImageRef ? state.sectionImages?.[sectionId] : null);
  if (variantImage) void archiveSectionVariantImage(sectionId, variant, variantImage);
  return variant;
}

function captureCurrentSectionVariant(sectionId, source = 'baseline', label = '') {
  return rememberSectionVariant(sectionId, state.sectionContents[sectionId], state.sectionImages[sectionId] || null, source, label);
}

function applySectionContent(sectionId, content, imageData, source = 'variant', label = '', options = {}) {
  const effectiveImage = imageData === undefined ? (state.sectionImages[sectionId] || null) : imageData;
  const scopedContent = cloneData(content);
  if (typeof stampSectionContentWorkScope === 'function') {
    stampSectionContentWorkScope(scopedContent, sectionId, source);
  }
  state.sectionContents[sectionId] = scopedContent;
  if (imageData === null) delete state.sectionImages[sectionId];
  else if (imageData !== undefined) state.sectionImages[sectionId] = imageData;
  const variant = rememberSectionVariant(sectionId, state.sectionContents[sectionId], effectiveImage, source, label);
  if (variant) state.currentSectionVariantIds[sectionId] = variant.id;
  compactCurrentSectionVariantImages(sectionId);
  if (typeof queueSectionContentLocalArchive === 'function') {
    queueSectionContentLocalArchive(sectionId, state.sectionContents[sectionId], effectiveImage, source, label);
  }
  markContentChanged(options.persist !== false);
}

function applySectionVariant(sectionId, variantId) {
  const variants = materializeCurrentSectionVariantImage(
    sectionId,
    state.sectionVariants[sectionId] || [],
  );
  const variant = variants.find(item => item.id === variantId);
  if (!variant) return;
  if (typeof sectionContentBelongsToCurrentWork === 'function' && !sectionContentBelongsToCurrentWork(sectionId, variant.content || {})) {
    state.error = '현재 상품/입력 이미지 기준과 맞지 않는 이전 섹션 결과라 적용하지 않았습니다. 필요한 경우 현재 상품 기준으로 다시 생성해주세요.';
    render();
    return;
  }
  state.sectionContents[sectionId] = cloneData(variant.content);
  const image = sectionVariantImageForDisplay(sectionId, variant);
  if (image) state.sectionImages[sectionId] = image;
  else delete state.sectionImages[sectionId];
  state.currentSectionVariantIds[sectionId] = variant.id;
  compactCurrentSectionVariantImages(sectionId);
  markContentChanged();
  render();
}

function previewSelectorValue(value) {
  const text = String(value || '');
  if (window.CSS?.escape) return CSS.escape(text);
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function preloadImageForSwitch(src) {
  return new Promise(resolve => {
    if (!src) return resolve(false);
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
    if (image.complete) resolve(true);
  });
}

async function updateSectionVariantImageDom(sectionId, variant, switchToken, operationContext = null) {
  if (!runtimeOperationContextIsCurrent(operationContext)) return false;
  const sectionSel = previewSelectorValue(sectionId);
  const root = document.querySelector(`[data-preview-section="${sectionSel}"]`);
  const imageSrc = sectionVariantImageForDisplay(sectionId, variant);
  if (!root || !imageSrc) return false;

  const paint = () => {
    root.querySelectorAll('img[data-section-main-image]').forEach(img => {
      if (img.getAttribute('src') !== imageSrc) img.setAttribute('src', imageSrc);
    });

    const outlineImg = document.querySelector(`[data-outline-section-id="${sectionSel}"] .preview-outline-thumb img`);
    if (outlineImg && outlineImg.getAttribute('src') !== imageSrc) outlineImg.setAttribute('src', imageSrc);

    root.querySelectorAll('.variant-quickchip[data-apply-variant-image]').forEach(btn => {
      const active = btn.dataset.applyVariantImage === `${sectionId}:${variant.id}`;
      btn.classList.toggle('active', active);
      const check = btn.querySelector('.variant-quickcheck');
      if (active && !check) {
        btn.insertAdjacentHTML('beforeend', '<span class="material-icons-outlined variant-quickcheck">check_circle</span>');
      } else if (!active && check) {
        check.remove();
      }
    });
  };

  paint();
  await preloadImageForSwitch(imageSrc);
  if (!runtimeOperationContextIsCurrent(operationContext)) return true;
  if (switchToken && state.sectionVariantSwitchTokens?.[sectionId] !== switchToken) return true;
  paint();
  return true;
}

async function applySectionVariantImageOnly(sectionId, variantId, operationContext = null) {
  if (!runtimeOperationContextIsCurrent(operationContext)) return false;
  const variants = materializeCurrentSectionVariantImage(
    sectionId,
    state.sectionVariants[sectionId] || [],
  );
  const variant = variants.find(item => item.id === variantId);
  const image = sectionVariantImageForDisplay(sectionId, variant);
  if (!image) return false;
  state.sectionImages[sectionId] = image;
  state.currentSectionVariantIds[sectionId] = variant.id;
  compactCurrentSectionVariantImages(sectionId);
  if (!state.sectionVariantSwitchTokens) state.sectionVariantSwitchTokens = {};
  const switchToken = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  state.sectionVariantSwitchTokens[sectionId] = switchToken;
  markContentChanged(false);
  scheduleLastWorkSave(500);
  try {
    const updated = await updateSectionVariantImageDom(sectionId, variant, switchToken, operationContext);
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    if (!updated) render();
    return true;
  } catch(_) {
    if (runtimeOperationContextIsCurrent(operationContext)) render();
    return false;
  }
}

function setSectionInstructionSource(sectionId, type, extra = {}) {
  if (!state.sectionInstructionSources) state.sectionInstructionSources = {};
  const labels = {
    manual: '직접 입력',
    competitor_plan: '경쟁사 분석 플랜',
    competitor_plan_edit: '경쟁사 플랜 수정',
    competitor_tip_bank: '누적 경쟁사 팁',
    ai_analysis: '제품 AI 분석',
  };
  state.sectionInstructionSources[sectionId] = {
    type,
    label: labels[type] || '출처 확인',
    updatedAt: Date.now(),
    ...sectionWorkScopeMeta(),
    ...extra,
  };
}

function pushFactoryBatchLog(message, type = 'info') {
  const entry = { time: typeof factoryNowTime === 'function' ? factoryNowTime() : new Date().toLocaleTimeString('ko-KR'), message: String(message || ''), type };
  state.factoryBatchLogs = [entry, ...(Array.isArray(state.factoryBatchLogs) ? state.factoryBatchLogs : [])].slice(0, 80);
  state.factoryBatchStatus = entry.message;
}

async function updateProjectBatchStatus(projectId, status = {}) {
  if (!projectId) return null;
  const project = await workspaceGet(WORKSPACE_DB.projects, projectId);
  if (!project) return null;
  const next = {
    ...project,
    updatedAt: Date.now(),
    batchStatus: {
      ...(project.batchStatus || {}),
      ...status,
      updatedAt: Date.now(),
    },
  };
  await workspacePut(WORKSPACE_DB.projects, next);
  return next;
}

async function factoryRunSavedProjectsBatchRegistration(projectIds = [], target = 'cafe24_only') {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  if (!ids.length) {
    pushFactoryBatchLog('일괄등록할 저장본을 먼저 선택해주세요.', 'error');
    render();
    return false;
  }
  if (state.factoryBatchRunning) {
    pushFactoryBatchLog('이미 일괄등록이 진행 중입니다. 현재 작업이 끝난 뒤 다시 실행해주세요.', 'error');
    render();
    return false;
  }
  const targetLabel = target === 'cafe24_openmarket' ? '카페24 + 오픈마켓' : '카페24만';
  const ok = window.confirm([
    `선택한 저장본 ${ids.length}개를 ${targetLabel} 일괄등록합니다.`,
    '',
    '각 저장본을 순서대로 불러와 실제 Cafe24/오픈마켓 전송을 실행합니다.',
    '외부 데이터가 변경될 수 있습니다. 계속할까요?',
  ].join('\n'));
  if (!ok) return false;

  state.factoryBatchRunning = true;
  state.factoryBatchProgress = 0;
  state.factoryBatchLogs = [];
  pushFactoryBatchLog(`${targetLabel} 일괄등록 시작: ${ids.length}개`, 'info');
  render();

  let success = 0;
  let failed = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const projectId = ids[index];
    const projectNumber = index + 1;
    try {
      const project = await workspaceGet(WORKSPACE_DB.projects, projectId);
      if (!project) throw new Error('저장본을 찾을 수 없습니다.');
      pushFactoryBatchLog(`[${projectNumber}/${ids.length}] ${project.name || projectId} 불러오는 중`, 'info');
      const payload = await hydrateWorkspacePayloadImageBackup(project.payload);
      applyWorkspacePayload(payload, {
        projectId: project.id,
        createdAt: project.createdAt,
        replaceWorkspace: true,
      });
      const factory = state.factory || {};
      const sync = typeof factoryEnsureOpenMarketSync === 'function'
        ? factoryEnsureOpenMarketSync(factory)
        : (factory.openMarketSync ||= {});
      sync.finalTarget = target === 'cafe24_openmarket' ? 'cafe24_openmarket' : 'cafe24_only';
      sync.finalRegistrationStatus = `${targetLabel} 일괄등록 대기 중입니다.`;
      sync.finalRegistrationProgress = 1;
      sync.finalRegistrationRunning = false;
      saveLastWorkNow();
      await updateProjectBatchStatus(projectId, { status: 'running', target, message: '등록 진행 중' });
      render();
      const result = typeof factoryRunFinalRegistration === 'function'
        ? await factoryRunFinalRegistration({ skipConfirm: true, batch: true })
        : false;
      const currentFactory = state.factory || {};
      const currentSync = currentFactory.openMarketSync || {};
      if (result) {
        success += 1;
        await updateProjectBatchStatus(projectId, {
          status: 'success',
          target,
          message: currentSync.finalRegistrationStatus || `${targetLabel} 등록 완료`,
        });
        pushFactoryBatchLog(`[${projectNumber}/${ids.length}] 완료: ${project.name || projectId}`, 'ok');
      } else {
        failed += 1;
        await updateProjectBatchStatus(projectId, {
          status: 'failed',
          target,
          message: currentSync.finalRegistrationStatus || `${targetLabel} 등록 실패`,
        });
        pushFactoryBatchLog(`[${projectNumber}/${ids.length}] 실패: ${project.name || projectId}`, 'error');
      }
      await saveCurrentProject();
    } catch (e) {
      failed += 1;
      await updateProjectBatchStatus(projectId, {
        status: 'failed',
        target,
        message: e.message || String(e),
      }).catch(() => null);
      pushFactoryBatchLog(`[${projectNumber}/${ids.length}] 실패: ${e.message || String(e)}`, 'error');
    }
    state.factoryBatchProgress = Math.round((projectNumber / ids.length) * 100);
    await refreshWorkspaceLists(false);
    render();
  }

  state.factoryBatchRunning = false;
  state.factoryBatchProgress = 100;
  pushFactoryBatchLog(`일괄등록 완료: 성공 ${success}개 · 실패 ${failed}개`, failed ? 'error' : 'ok');
  await refreshWorkspaceLists(false);
  render();
  return failed === 0;
}

function setSectionInstructionValue(sectionId, value, sourceType = 'manual', extra = {}) {
  const text = String(value || '');
  state.sectionInstructions[sectionId] = text;
  if (text.trim()) setSectionInstructionSource(sectionId, sourceType, extra);
  else if (state.sectionInstructionSources) delete state.sectionInstructionSources[sectionId];
  saveSectionInstructions(state.sectionInstructions);
  scheduleLastWorkSave();
}

function getSectionInstructionSourceInfo(sectionId) {
  const text = String(state.sectionInstructions?.[sectionId] || '').trim();
  const saved = state.sectionInstructionSources?.[sectionId];
  if (saved && text) {
    return {
      label: saved.label || '출처 확인',
      detail: saved.source || saved.detail || '',
      type: saved.type || 'unknown',
    };
  }
  const compInstruction = String(state.compPage?.planEdits?.[sectionId]?.instructions || '').trim();
  if (text && compInstruction && text === compInstruction) {
    return { label: '경쟁사 분석 플랜', detail: '경쟁사 분석 섹션에서 적용된 지시', type: 'competitor_plan' };
  }
  if (text) return { label: '직접 입력', detail: '섹션 설정에서 입력한 지시', type: 'manual' };
  return { label: 'AI 자동', detail: '제품 분석과 기본 섹션 목적 기준', type: 'ai_analysis' };
}

function getCompetitorPlanInstruction(sectionId) {
  if (!sectionWorkScopeMatches(state.compPage?.sectionWorkScope, sectionWorkScopeMeta())) return '';
  return String(state.compPage?.planEdits?.[sectionId]?.instructions || '').trim();
}

function hasCompetitorPlanInstruction(sectionId) {
  return !!getCompetitorPlanInstruction(sectionId);
}

function sectionCompetitorPlanMissing(sectionId) {
  return !hasCompetitorPlanInstruction(sectionId);
}

function sectionBasisOptionLabel(mode, sectionId) {
  if (!mode) return '';
  if (mode.id === 'competitor_plan' && sectionCompetitorPlanMissing(sectionId)) {
    return `${mode.label} · 플랜 생성 필요`;
  }
  return mode.label;
}

function sectionBasisDisplayInfo(sectionId) {
  const info = getSectionBasisModeInfo(sectionId);
  if (info.id === 'competitor_plan' && sectionCompetitorPlanMissing(sectionId)) {
    return {
      ...info,
      label: '경쟁사 분석플랜 없음',
      shortLabel: '플랜 생성 필요',
      desc: '아직 이 섹션에 적용할 경쟁사 섹션 플랜이 없습니다. 경쟁사 분석 메뉴에서 섹션 플랜을 생성/적용해야 이 기준을 사용할 수 있습니다.',
    };
  }
  return info;
}

function resolveSectionBasisInstructions(sectionId, baseInstructions = '', basisOverride = null) {
  const basis = getSectionBasisModeInfo(basisOverride || sectionId);
  const current = String(baseInstructions || state.sectionInstructions?.[sectionId] || '').trim();
  const helperBlock = getAppliedSectionHelperBlock(sectionId);
  if (basis.id === 'competitor_plan') {
    const plan = getCompetitorPlanInstruction(sectionId);
    const fallback = current || '경쟁사 분석플랜 지시사항이 아직 없습니다. 제품 이미지 분석과 기본 섹션 목적을 기준으로 구성하되, 경쟁사 진단에서 얻은 개선 원칙이 있다면 일반 원칙으로만 참고하세요.';
    return [plan || fallback, helperBlock].filter(Boolean).join('\n\n');
  }
  if (basis.id === 'image_analysis') {
    return [
      'AI 분석 결과, 신화사DB 확정값, Cafe24 동기화 값, 원본 제품 이미지를 기준으로 이 섹션을 새로 기획하세요.',
      '경쟁사 분석플랜, 타사 제품 진단 내용, 누적 경쟁사 팁, 수동으로 복사된 경쟁사 문구는 사용하지 마세요.',
      '아래에 표시된 이 섹션 전용 DB 항목만 사용하세요. 표시되지 않은 다른 DB값을 끌어와 문구에 넣지 마세요.',
      '단, 원본 제품의 형태, 색상 배치, 장식, 비율은 반드시 보존하세요.',
      '',
      '우리 제품 분석/DB 요약(섹션별 필터 적용):',
      productIdentitySummaryForPrompt(null, sectionId)
    ].filter(Boolean).join('\n\n');
  }
  if (basis.id === 'combined') {
    const plan = getCompetitorPlanInstruction(sectionId);
    const parts = [
      '총합버전: 아래 자료를 함께 보되, 원본 제품 이미지와 DB/Cafe24 확정값을 사실 기준으로 최우선합니다.',
      '경쟁사 분석은 타사 상품을 복제하지 말고 구조, 설득 흐름, 빠진 정보 보완 아이디어로만 참고하세요.',
      current ? `현재 지시문:\n${current}` : '현재 지시문: 직접 입력된 지시가 없으면 섹션 목적에 맞게 구성하세요.',
      plan ? `경쟁사 섹션 플랜:\n${plan}` : '경쟁사 섹션 플랜: 아직 없으면 경쟁사 분석 리포트의 일반 개선 원칙만 참고하세요.',
      '우리 제품 분석/DB 요약(섹션별 필터 적용):',
      productIdentitySummaryForPrompt(null, sectionId),
      helperBlock ? `섹션 이미지 도우미 누적 팁:\n${helperBlock}` : '',
    ];
    return parts.filter(Boolean).join('\n\n');
  }
  return current;
}

function competitorPromptReportIsCurrent(reportScope, currentScope, previousAnalysisViewOnly = false) {
  return previousAnalysisViewOnly !== true
    && !!currentScope?.scopeKey
    && !!reportScope?.scopeKey
    && sectionWorkScopeMatches(reportScope, currentScope);
}

function getCompetitorPromptReportInfo() {
  const candidate = state.compPage?.analysisResult || state.competitorData || null;
  if (!candidate) return { report: null, current: false, stale: false };
  const reportScope = candidate.analysisProductScope || null;
  const currentScope = sectionWorkScopeMeta();
  const current = competitorPromptReportIsCurrent(
    reportScope,
    currentScope,
    state.compPage?.previousAnalysisViewOnly,
  );
  return { report: current ? candidate : null, current, stale: !current };
}

function buildSectionCompetitorReferenceForPrompt(sectionId, basisId = getSectionBasisMode(sectionId)) {
  if (basisId === 'image_analysis') return '';
  const report = getCompetitorPromptReportInfo().report;
  const plan = getCompetitorPlanInstruction(sectionId);
  const tips = typeof getScopedCompetitorTipsForSection === 'function'
    ? getScopedCompetitorTipsForSection(sectionId)
    : '';
  const ref = {
    competitor_report: report,
    section_plan_instruction: plan || '',
    scoped_competitor_tips: tips || '',
    usage_rule: '경쟁사 내용은 구조/설득/개선 아이디어만 참고하고, 타사 제품명/효능/가격/인증/색상은 복제하지 않는다.',
  };
  return report || plan || tips ? JSON.stringify(ref).substring(0, 2200) : '';
}

function resolveSectionAssemblyAsset(cutAssetKey = '') {
  const key = String(cutAssetKey || '').trim();
  if (!key) return null;
  if (typeof resolveSectionPlacementAsset === 'function') {
    const found = resolveSectionPlacementAsset(key);
    if (found) return found;
  }
  const cutId = key.startsWith('cut:') ? key.slice(4) : key;
  const cut = (state.cuts?.prompts || []).find(item => item?.id === cutId);
  if (!cut) return null;
  const image = typeof factoryCoerceImageSrc === 'function'
    ? factoryCoerceImageSrc(cut.result)
    : (cut.result || '');
  return {
    key: `cut:${cut.id}`,
    legacyId: cut.id,
    image,
    label: cut.label || '이미지컷',
    source: '이미지컷',
    prompt: cut.prompt || '',
  };
}

function buildSectionAssemblySourceInstructions(sectionId, baseInstructions = '') {
  if (!hasCustomSectionAssembly(sectionId)) return '';
  const selected = sectionAssemblySelectedSourceIds(sectionId);
  if (!selected.length) return '';
  const blocks = selected.map(sourceId => {
    const source = SECTION_ASSEMBLY_SOURCES.find(item => item.id === sourceId);
    const text = resolveSectionBasisInstructions(sectionId, baseInstructions, sourceId);
    return [
      `선택 소스: ${source?.label || sourceId}`,
      text || '(입력된 지시가 아직 없습니다. 이 소스는 보조 참고로만 사용하세요.)',
    ].join('\n');
  });
  return [
    '사용자가 섹션 설정의 조립판에서 아래 소스들을 직접 골랐습니다. 한 소스만 보지 말고 선택된 소스를 조합하세요.',
    '충돌할 때는 원본 제품 이미지와 DB 확정값을 사실 기준으로 우선하고, 경쟁사 플랜은 구조/설득 방식만 참고하며, 현재 지시문은 사용자의 최종 의도로 우선 반영하세요.',
    blocks.join('\n\n'),
  ].join('\n\n');
}

function buildSectionAssemblyPromptBlock(sectionId, options = {}) {
  if (!hasCustomSectionAssembly(sectionId)) return '';
  const assembly = getSectionAssembly(sectionId);
  const usage = sectionAssemblyCutUsageInfo(assembly.cutUsage);
  const selectedSources = sectionAssemblySelectedSourceIds(sectionId)
    .map(id => SECTION_ASSEMBLY_SOURCES.find(source => source.id === id)?.label || id)
    .join(' + ');
  const lines = [
    'SECTION ASSEMBLY SETTINGS - user-selected lego blocks:',
    `Selected source mix: ${selectedSources || '현재 지시문'}.`,
    'Use selected sources together. Do not copy competitor products; adapt only strategy, layout intent, and persuasive angle to our current uploaded product.',
  ];
  if (assembly.cutUsage !== 'none') {
    const asset = resolveSectionAssemblyAsset(assembly.cutAssetKey);
    lines.push(`Generated imagecut usage: ${usage.label}.`);
    if (asset) {
      lines.push(`Selected imagecut: ${asset.source || '이미지컷'} / ${asset.label || '이름 없음'}.`);
      if (asset.prompt) lines.push(`Imagecut prompt/context: ${asset.prompt}`);
    } else if (assembly.cutAssetKey) {
      lines.push(`Selected imagecut key was saved but the image result is not currently available: ${assembly.cutAssetKey}. If unavailable, continue with the selected source mix and do not invent a fake cut.`);
    } else {
      lines.push('No specific imagecut was selected yet. If the usage is auto, decide from available section context only.');
    }
    if (assembly.cutUsage === 'prompt') {
      lines.push('Blend the imagecut as a visual/story reference inside this section prompt. Keep the uploaded product identity as the source of truth.');
    } else if (assembly.cutUsage === 'section') {
      lines.push('This imagecut is intended to be inserted as this section image. Write copy/layout notes that connect naturally before and after the inserted image.');
    } else if (assembly.cutUsage === 'both') {
      lines.push('Use this imagecut both as prompt reference and as the section image. Make the generated content reinforce the selected cut instead of fighting it.');
    } else if (assembly.cutUsage === 'auto') {
      lines.push('Use the imagecut only if it genuinely helps this section. If it does not fit, keep the section focused on the base product image and facts.');
    }
  }
  if (assembly.note.trim()) {
    lines.push(`User assembly note for this section: ${assembly.note.trim()}`);
  }
  if (options.imageOnly) {
    lines.push('For image generation, treat these as composition/reference instructions only. Do not change the product shape, color, or visible parts.');
  }
  return lines.join('\n');
}

function getSectionBasisDetail(sectionId) {
  const basis = getSectionBasisModeInfo(sectionId);
  if (basis.id === 'competitor_plan') {
    return hasCompetitorPlanInstruction(sectionId)
      ? '경쟁사 분석플랜의 섹션별 최종 프롬프트를 우선 사용합니다.'
      : '경쟁사 분석 리포트만 있고 섹션별 플랜 프롬프트는 아직 없습니다. 경쟁사 분석 메뉴에서 "이 분석으로 15개 섹션 플랜 생성"을 누른 뒤 섹션 설정에 적용해야 합니다.';
  }
  if (basis.id === 'image_analysis') {
    return '경쟁사 플랜을 제외하고 AI 분석, 신화사DB 확정값, Cafe24 동기화 값, 원본 보존을 기준으로 생성합니다.';
  }
  if (basis.id === 'combined') {
    return 'AI 이미지 분석, DB/Cafe24 확정값, 경쟁사 분석/플랜, 현재 지시문을 종합합니다. 충돌하면 원본 이미지와 DB 확정값을 우선합니다.';
  }
  return '현재 섹션 입력창과 적용된 섹션 이미지 도우미 팁을 기준으로 생성합니다.';
}

function getSectionVariantSourceForBasis(sectionId, fallback = 'generated') {
  const basis = getSectionBasisMode(sectionId);
  if (basis === 'competitor_plan') return 'competitor';
  if (basis === 'image_analysis') return 'analysis_self';
  if (basis === 'combined') return 'combined';
  return fallback;
}

function getSectionResultSourceInfo(sectionId) {
  const meta = state.sectionGenerationMeta?.[sectionId];
  if (meta?.label) return meta;
  const variantId = state.currentSectionVariantIds?.[sectionId];
  const variant = (state.sectionVariants?.[sectionId] || []).find(v => v.id === variantId);
  if (variant?.source === 'manual') return { label: '직접 수정 결과', detail: '미리보기에서 저장한 수정안' };
  if (variant?.source === 'baseline') return { label: '기준안 보관', detail: '재생성 전 백업' };
  if (variant?.source === 'combined') return { label: '총합버전 결과', detail: 'DB/이미지분석/경쟁사/현재 지시문 종합 생성' };
  if (state.sectionContents?.[sectionId]) return { label: 'AI 생성 결과', detail: '현재 모델 설정으로 생성' };
  return { label: '미생성', detail: '아직 섹션 결과 없음' };
}

function sectionVariantSourceLabel(source) {
  if (source === 'manual') return '직접 수정';
  if (source === 'baseline') return '기준안';
  if (source === 'competitor') return '경쟁사분석';
  if (source === 'analysis_self') return '이미지분석';
  if (source === 'combined') return '총합버전';
  if (source === 'generated') return 'AI 생성';
  if (source === 'single') return '개별 생성';
  if (source === 'preview') return '재생성';
  return 'AI 생성';
}

function sectionVariantLetter(index) {
  return `${String.fromCharCode(65 + Math.max(0, index % 26))}안`;
}

function sectionVariantModeLabel(sectionId, variant) {
  const modeId = variant?.content?.generation_mode || state.sectionGenerationMeta?.[sectionId]?.mode || getSectionGenerationMode(sectionId);
  return getSectionGenerationModeInfo(modeId).shortLabel;
}

function sectionVariantBasisLabel(sectionId, variant) {
  const basisId = variant?.content?.generation_basis || state.sectionGenerationMeta?.[sectionId]?.basis || getSectionBasisMode(sectionId);
  return getSectionBasisModeInfo(basisId).shortLabel;
}

function sectionVariantModelInfo(sectionId, variant) {
  const models = variant?.models || {};
  const llmLabel = models.llmModelLabel || '';
  const imgLabel = models.imageModelLabel || '';
  const llmId = models.llmModelId || '';
  const imgId = models.imageModelId || '';
  if (!llmLabel && !imgLabel && !llmId && !imgId) {
    return {
      compact: '모델 기록 없음',
      detail: '이전 저장 시안이라 생성 모델 기록이 남아있지 않습니다. 새로 생성하면 모델명이 함께 저장됩니다.',
      llm: '',
      image: '',
    };
  }
  const llmText = llmLabel || llmId;
  const imgText = imgLabel || imgId;
  const compact = [
    llmText ? `LLM: ${llmText}` : '',
    imgText ? `IMG: ${imgText}` : '',
  ].filter(Boolean).join(' · ');
  const detail = [
    llmText ? `LLM 모델: ${llmText}${models.llmRoute ? ` (${models.llmRoute})` : ''}` : '',
    imgText ? `이미지 모델: ${imgText}${models.imageRoute ? ` (${models.imageRoute})` : ''}` : '',
  ].filter(Boolean).join('\n');
  return { compact, detail, llm: llmText, image: imgText };
}

function scoreClamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function dataUrlParts(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  return {
    mime: match[1] || 'image/png',
    base64: match[2] ? match[3] : btoa(unescape(encodeURIComponent(match[3] || ''))),
  };
}

function imageSourceToScaledDataUrl(src, maxSide = 1280) {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error('이미지가 없습니다.'));
    const img = new Image();
    if (!String(src).startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || img.width || 1;
        const h0 = img.naturalHeight || img.height || 1;
        const scale = Math.min(1, maxSide / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      } catch(e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('이미지를 심사용으로 읽지 못했습니다.'));
    img.src = src;
  });
}

async function imageSourceToLlmPayload(src, maxSide = 1280) {
  const dataUrl = String(src || '').startsWith('data:')
    ? await imageSourceToScaledDataUrl(src, maxSide).catch(() => src)
    : await imageSourceToScaledDataUrl(src, maxSide);
  const parsed = dataUrlParts(dataUrl);
  if (!parsed?.base64) throw new Error('이미지를 LLM 입력 형식으로 변환하지 못했습니다.');
  return parsed;
}

function getOriginalProductDataUrl() {
  if (state.imageBase64) return `data:${state.imageMime || 'image/png'};base64,${state.imageBase64}`;
  return state.imagePreview || '';
}

function normalizeVariantEvaluation(raw, sectionId, variants) {
  const variantIds = new Set(variants.map(v => v.id));
  const normalized = cloneData(raw || {});
  let rows = Array.isArray(normalized.variants) ? normalized.variants : [];
  rows = rows.map((row, idx) => {
    let id = row.variant_id || row.id || row.variantId || variants[idx]?.id || '';
    if (!variantIds.has(id)) {
      const labelText = String(row.label || row.name || '');
      const byLabel = variants.find(v => labelText && (labelText.includes(v.evalLabel) || labelText.includes(v.label || '')));
      id = byLabel?.id || variants[idx]?.id || id;
    }
    const criteria = Array.isArray(row.criteria) ? row.criteria : [];
    return {
      ...row,
      variant_id: id,
      label: row.label || variants.find(v => v.id === id)?.evalLabel || `시안 ${idx + 1}`,
      total_score: scoreClamp(row.total_score ?? row.score ?? 0),
      grade: row.grade || '',
      recommended: !!row.recommended,
      criteria: criteria.slice(0, 8).map(c => ({
        id: c.id || c.name || '',
        name: c.name || c.id || '평가 항목',
        score: scoreClamp(c.score),
        reason: c.reason || c.feedback || '',
      })),
      pros: Array.isArray(row.pros) ? row.pros : [],
      cons: Array.isArray(row.cons) ? row.cons : [],
      decision: row.decision || row.reason || '',
    };
  }).filter(row => variantIds.has(row.variant_id));
  if (!rows.length) {
    rows = variants.map((variant, idx) => ({
      variant_id: variant.id,
      label: variant.evalLabel || `시안 ${idx + 1}`,
      total_score: 0,
      grade: '',
      recommended: false,
      criteria: [],
      pros: [],
      cons: ['평가 결과를 파싱하지 못했습니다.'],
      decision: '',
    }));
  }
  rows.sort((a, b) => b.total_score - a.total_score);
  const best = rows.find(r => r.recommended) || rows[0];
  rows.forEach(row => row.recommended = row.variant_id === best?.variant_id);
  return {
    id: uid(`variant_eval_${sectionId}`),
    sectionId,
    recommended_variant_id: best?.variant_id || normalized.recommended_variant_id || '',
    summary: normalized.summary || best?.decision || '',
    variants: rows,
    evaluatedAt: Date.now(),
    model: getCurrentLlmRunInfo(),
  };
}

async function evaluateSectionVariants(sectionId, operationContext = null) {
  if (!runtimeOperationContextIsCurrent(operationContext)) return false;
  const section = SECTIONS.find(s => s.id === sectionId);
  if (!section) return false;
  const variants = (state.sectionVariants?.[sectionId] || [])
    .map(v => ({
      ...v,
      image: sectionVariantImageForDisplay(sectionId, v),
    }))
    .filter(v => v.image)
    .slice(0, 6)
    .map((variant, index) => ({
      ...variant,
      evalLabel: `${sectionVariantLetter(index)} · ${sectionVariantSourceLabel(variant.source)} · ${sectionVariantBasisLabel(sectionId, variant)} · ${sectionVariantModeLabel(sectionId, variant)}`,
    }));
  if (variants.length < 2) {
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    state.error = 'AI 컷 심사는 이미지 시안이 2개 이상일 때 사용할 수 있습니다.';
    render();
    return false;
  }
  const originalSrc = getOriginalProductDataUrl();
  if (!originalSrc) {
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    state.error = '원본 제품 이미지가 없어 후보 컷을 비교할 수 없습니다.';
    render();
    return false;
  }
  if (!runtimeOperationContextIsCurrent(operationContext)) return false;
  state.sectionVariantEvaluationBusy[sectionId] = true;
  render();
  let completed = false;
  try {
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    const llm = getLLMClient();
    const original = await imageSourceToLlmPayload(originalSrc, 1200);
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    const images = [];
    for (const variant of variants) {
      if (!runtimeOperationContextIsCurrent(operationContext)) return false;
      images.push({
        id: variant.id,
        label: variant.evalLabel,
        payload: await imageSourceToLlmPayload(variant.image, 1200),
      });
      if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    }
    const prompt = `You are a strict Korean ecommerce image QA judge.
Evaluate generated section image variants against the original product image and known product data.

Reference image #1 is the ORIGINAL PRODUCT. It is the source of truth.
Images #2 and after are generated variants in the exact order below:
${variants.map((v, idx) => `${idx + 2}. variant_id=${v.id}, label="${v.evalLabel}", headline="${v.content?.headline || ''}"`).join('\n')}

Section:
${JSON.stringify({ id: section.id, name: section.name, purpose: section.purpose }, null, 2)}

Known product analysis / DB facts:
${JSON.stringify(state.analysis || {}, null, 2).substring(0, 4500)}

Current section content:
${JSON.stringify(state.sectionContents?.[sectionId] || {}, null, 2).substring(0, 2200)}

Judge the variants with these criteria:
1. original_shape_similarity: product silhouette, proportions, color blocking, strings/handles, ornament/embroidery/bead placement, fabric texture, and visible details must remain close to the original. Penalize heavily if it becomes a different product.
2. db_data_accuracy: dimensions, color, material, product name, and details must match known data. If data is unknown, do not invent it and do not punish harshly.
3. text_legibility_accuracy: Korean text is readable, not garbled, and does not hallucinate wrong specs.
4. ecommerce_composition: detail-page composition, crop, spacing, hierarchy, and shopping-mall usability.
5. section_goal_fit: how well this image serves the section purpose.
6. product_focus_safety: product remains the sold item; props/background do not mislead.

Return ONLY JSON:
{
  "recommended_variant_id": "exact variant_id",
  "summary": "한국어 한 문장 추천 요약",
  "variants": [
    {
      "variant_id": "exact variant_id",
      "label": "A안 · ...",
      "total_score": 0,
      "grade": "A|B|C|D|F",
      "recommended": false,
      "criteria": [
        {"id":"original_shape_similarity","name":"원본 형태 유사도","score":0,"reason":"한국어 근거"},
        {"id":"db_data_accuracy","name":"DB/분석값 정확도","score":0,"reason":"한국어 근거"},
        {"id":"text_legibility_accuracy","name":"문구 정확도","score":0,"reason":"한국어 근거"},
        {"id":"ecommerce_composition","name":"상세페이지 구성","score":0,"reason":"한국어 근거"},
        {"id":"section_goal_fit","name":"섹션 목적 적합도","score":0,"reason":"한국어 근거"},
        {"id":"product_focus_safety","name":"상품 오인 방지","score":0,"reason":"한국어 근거"}
      ],
      "pros": ["한국어 장점"],
      "cons": ["한국어 단점"],
      "decision": "한국어 판단"
    }
  ]
}`;

    let raw;
    if (llm instanceof GeminiAPI) {
      const parts = [
        { text: prompt },
        { inline_data: { mime_type: original.mime, data: original.base64 } },
        ...images.map(img => ({ inline_data: { mime_type: img.payload.mime, data: img.payload.base64 } })),
      ];
      const data = await llm._generateContent(llm.model, {
        contents: [{ parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 6000 },
      });
      if (!runtimeOperationContextIsCurrent(operationContext)) return false;
      tokenTracker.record(llm.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, '컷심사');
      let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      text = text.trim().replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
      raw = JSON.parse(text);
    } else if (llm instanceof OpenAIAPI) {
      const content = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${original.mime};base64,${original.base64}`, detail: 'high' } },
        ...images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.payload.mime};base64,${img.payload.base64}`, detail: 'high' } })),
      ];
      const body = { model: llm.model, messages: [{ role: 'user', content }], max_completion_tokens: 6000, temperature: 0.2 };
      const res = await fetch(`${llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llm.apiKey}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!runtimeOperationContextIsCurrent(operationContext)) return false;
      if (data.error) throw new Error(data.error.message);
      tokenTracker.record(llm.model, data.usage?.prompt_tokens, data.usage?.completion_tokens, false, '컷심사');
      raw = llm._parseJSON(data.choices?.[0]?.message?.content || '{}');
    } else {
      throw new Error('지원하지 않는 LLM 연결입니다.');
    }
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    if (!state.sectionVariantEvaluations) state.sectionVariantEvaluations = {};
    state.sectionVariantEvaluations[sectionId] = normalizeVariantEvaluation(raw, sectionId, variants);
    savePersistentState();
    completed = true;
  } catch(e) {
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    state.error = `AI 컷 심사 실패: ${e.message}`;
  } finally {
    if (!runtimeOperationContextIsCurrent(operationContext)) return;
    state.sectionVariantEvaluationBusy[sectionId] = false;
    render();
  }
  return completed;
}

function applyBestEvaluatedVariant(sectionId, operationContext = null) {
  const evalResult = state.sectionVariantEvaluations?.[sectionId];
  const bestId = evalResult?.recommended_variant_id || evalResult?.variants?.find(v => v.recommended)?.variant_id;
  if (!bestId) return false;
  return applySectionVariantImageOnly(sectionId, bestId, operationContext);
}

function renderSectionVariantQuickBar(sectionId) {
  const variants = (state.sectionVariants?.[sectionId] || [])
    .map(variant => ({
      ...variant,
      image: sectionVariantImageForDisplay(sectionId, variant),
    }))
    .filter(variant => variant.image);
  if (variants.length < 2) return '';
  const currentId = state.currentSectionVariantIds?.[sectionId];
  const currentImage = state.sectionImages?.[sectionId] || '';
  const busy = !!state.sectionVariantEvaluationBusy?.[sectionId];
  return `<div class="variant-quickbar" aria-label="이미지 시안 빠른 비교">
    <div class="variant-quickbar-title">
      <span class="material-icons-outlined" style="font-size:15px">photo_library</span>
      이미지 빠른 비교
    </div>
    <button type="button" class="btn-sm" data-eval-section-variants="${sectionId}" ${busy ? 'disabled' : ''} title="원본 제품 이미지와 후보 이미지를 AI가 비교해 가장 좋은 컷을 추천합니다.">
      ${busy ? '<span class="spinner" style="width:12px;height:12px;border-width:2px"></span>' : '<span class="material-icons-outlined" style="font-size:14px">grading</span>'}
      ${busy ? '심사 중' : 'AI 컷 심사'}
    </button>
    <div class="variant-quickbar-list">
      ${variants.map((variant, index) => {
        const sourceLabel = sectionVariantSourceLabel(variant.source);
        const modeLabel = sectionVariantModeLabel(sectionId, variant);
        const basisLabel = sectionVariantBasisLabel(sectionId, variant);
        const modelInfo = sectionVariantModelInfo(sectionId, variant);
        const quickName = `${sectionVariantLetter(index)} · ${sourceLabel}`;
        const active = currentId ? variant.id === currentId : variant.image === currentImage;
        const title = `${quickName} / ${basisLabel} / ${modeLabel}\n${modelInfo.detail}\n${variant.label || ''}\n${variant.content?.headline || ''}`.trim();
        return `<button type="button" class="variant-quickchip ${active ? 'active' : ''}" data-apply-variant-image="${sectionId}:${variant.id}" title="${escAttr(title)}">
          <img class="variant-quickthumb" src="${escAttr(variant.image)}" alt="${escAttr(quickName)} 미리보기">
          <span class="variant-quickcopy">
            <span class="variant-quickname">${escapeHtml(quickName)}</span>
            <span class="variant-quickmeta">${escapeHtml(basisLabel)} · ${escapeHtml(modeLabel)} · ${escapeHtml(modelInfo.compact)}</span>
          </span>
          ${active ? '<span class="material-icons-outlined variant-quickcheck">check_circle</span>' : ''}
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

function renderSectionVariantEvaluationPanel(sectionId, mode = 'full') {
  const variants = (state.sectionVariants?.[sectionId] || [])
    .map(v => ({
      ...v,
      image: sectionVariantImageForDisplay(sectionId, v),
    }))
    .filter(v => v.image);
  const result = state.sectionVariantEvaluations?.[sectionId];
  const busy = !!state.sectionVariantEvaluationBusy?.[sectionId];
  if (variants.length < 2 && !result && !busy) return '';
  const best = result?.variants?.find(v => v.recommended) || result?.variants?.[0] || null;
  const model = result?.model?.modelLabel || result?.model?.modelId || '';
  const evaluatedAt = result?.evaluatedAt
    ? new Date(result.evaluatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
  if (mode === 'compact') {
    if (!result && !busy) return '';
    return `<div class="variant-eval-panel">
      <div class="variant-eval-head">
        <div class="variant-eval-title">
          <span class="material-icons-outlined" style="font-size:16px">workspace_premium</span>
          AI 컷 심사
        </div>
        <button class="btn-sm" data-eval-section-variants="${sectionId}" ${busy ? 'disabled' : ''}>
          ${busy ? '심사 중...' : '다시 심사'}
        </button>
      </div>
      ${busy ? `<div class="variant-eval-summary">원본 이미지와 후보 컷을 비교하고 있습니다.</div>` : best ? `<div class="variant-eval-best">
        <span>추천</span>
        <strong>${escapeHtml(best.label || '시안')}</strong>
        <span class="variant-eval-score">${scoreClamp(best.total_score)}점</span>
        ${model ? `<span style="color:var(--text-m)">분석 ${escapeHtml(model)}</span>` : ''}
        <button class="btn-sm" data-apply-eval-best="${sectionId}">추천 컷 적용</button>
      </div>
      <div class="variant-eval-summary">${escapeHtml(result.summary || best.decision || '')}</div>` : ''}
    </div>`;
  }
  return `<div class="variant-eval-panel" style="border:1px solid rgba(16,163,127,.18);border-radius:12px;margin-top:12px">
    <div class="variant-eval-head">
      <div class="variant-eval-title">
        <span class="material-icons-outlined" style="font-size:16px">workspace_premium</span>
        AI 컷 심사와 추천
      </div>
      <button class="btn-sm" data-eval-section-variants="${sectionId}" ${busy ? 'disabled' : ''}>
        ${busy ? '<span class="spinner" style="width:12px;height:12px;border-width:2px"></span> 심사 중' : '<span class="material-icons-outlined" style="font-size:14px">grading</span> AI 컷 심사'}
      </button>
    </div>
    <div class="variant-eval-summary">
      원본 제품 이미지, DB/분석값, 생성 후보를 비교해서 원본 형태 유지와 실제 데이터 반영 여부를 점수화합니다.
      ${model ? ` · 최근 분석 모델: ${escapeHtml(model)}` : ''}${evaluatedAt ? ` · ${escapeHtml(evaluatedAt)}` : ''}
    </div>
    ${busy ? `<div class="variant-eval-best"><span class="spinner" style="width:14px;height:14px;border-width:2px"></span> 후보 컷을 비교 중입니다.</div>` : ''}
    ${best ? `<div class="variant-eval-best">
      <span>추천 컷</span>
      <strong>${escapeHtml(best.label || '시안')}</strong>
      <span class="variant-eval-score">${scoreClamp(best.total_score)}점</span>
      <span>${escapeHtml(result.summary || best.decision || '')}</span>
      <button class="btn-sm" data-apply-eval-best="${sectionId}">추천 컷 적용</button>
    </div>` : ''}
    ${result?.variants?.length ? `<div class="variant-eval-grid">
      ${result.variants.map(row => {
        const variant = variants.find(v => v.id === row.variant_id);
        return `<div class="variant-eval-card ${row.recommended ? 'best' : ''}">
          <div class="variant-eval-card-head">
            <div>
              <div class="variant-eval-name">${escapeHtml(row.label || variant?.label || '시안')}</div>
              <div style="font-size:10px;color:var(--text-m);margin-top:2px">${row.recommended ? '추천됨' : sectionVariantSourceLabel(variant?.source)}</div>
            </div>
            <div class="variant-eval-score">${scoreClamp(row.total_score)}</div>
          </div>
          ${variant?.image ? `<img src="${escAttr(variant.image)}" alt="${escAttr(row.label || '시안')}" style="width:100%;aspect-ratio:16/9;object-fit:contain;background:#050711;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">` : ''}
          <div class="variant-eval-criteria">
            ${(row.criteria || []).slice(0, 6).map(c => `<div class="variant-eval-criterion">
              <span>${escapeHtml(c.name)}</span>
              <strong>${scoreClamp(c.score)}</strong>
              <div class="variant-eval-bar"><span style="width:${scoreClamp(c.score)}%"></span></div>
            </div>`).join('')}
          </div>
          <div class="variant-eval-reason">${escapeHtml(row.decision || row.cons?.[0] || row.pros?.[0] || '')}</div>
          ${row.cons?.length ? `<div class="variant-eval-reason" style="color:#ffb4b4">주의: ${escapeHtml(row.cons.slice(0, 2).join(' / '))}</div>` : ''}
          <div class="variant-eval-actions">
            <button class="btn-sm" data-apply-variant-image="${sectionId}:${row.variant_id}">이 컷 보기</button>
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}

function buildSectionPromptInstructions(sectionId, baseInstructions = '') {
  if (typeof ensureSectionWorkScopeCurrent === 'function') ensureSectionWorkScopeCurrent({ save: false });
  const mode = getSectionGenerationModeInfo(sectionId);
  const basis = getSectionBasisModeInfo(sectionId);
  const source = getSectionInstructionSourceInfo(sectionId);
  const resolvedInstructions = resolveSectionBasisInstructions(sectionId, baseInstructions);
  const assemblySourceInstructions = buildSectionAssemblySourceInstructions(sectionId, baseInstructions);
  const assemblyBlock = buildSectionAssemblyPromptBlock(sectionId);
  const parts = [];
  if (assemblySourceInstructions) parts.push(assemblySourceInstructions);
  else if (resolvedInstructions) parts.push(resolvedInstructions);
  parts.push(`Instruction source: ${source.label}${source.detail ? ` (${source.detail})` : ''}.`);
  parts.push(`${basis.prompt} Basis label: ${basis.label}.`);
  if (assemblyBlock) parts.push(assemblyBlock);
  parts.push(mode.prompt);
  return parts.join('\n\n');
}

const SECTION_PROMPT_PIPELINE_VERSION = 'section-prompt-v2';

function formatSectionGenerationRequestInputs(contentPrompt = '', competitorReference = '') {
  return [
    contentPrompt ? `[section_content_prompt]\n${contentPrompt}` : '',
    competitorReference ? `[competitor_reference]\n${competitorReference}` : '',
  ].filter(Boolean).join('\n\n');
}

function getSectionPromptResolutionInfo(sectionId) {
  const basis = getSectionBasisModeInfo(sectionId);
  const mode = getSectionGenerationModeInfo(sectionId);
  const sectionDef = SECTIONS.find(section => section.id === sectionId) || null;
  const currentInstruction = String(state.sectionInstructions?.[sectionId] || '').trim();
  const competitorPlan = getCompetitorPlanInstruction(sectionId);
  const helperBlock = getAppliedSectionHelperBlock(sectionId);
  const competitorReference = buildSectionCompetitorReferenceForPrompt(sectionId, basis.id);
  const contentPrompt = buildSectionPromptInstructions(sectionId, currentInstruction);
  const requestInputs = formatSectionGenerationRequestInputs(contentPrompt, competitorReference);
  const currentProductAnalysis = typeof hasCurrentProductAnalysisForGeneration === 'function'
    ? (hasCurrentProductAnalysisForGeneration() ? state.analysis : null)
    : state.analysis;
  const providerVariant = state.modelConfig?.llmProvider === 'gpt_oauth' ? 'gpt_oauth' : 'standard';
  const providerLabel = providerVariant === 'gpt_oauth'
    ? 'GPT OAuth'
    : (state.modelConfig?.llmProvider === 'openai' ? 'OpenAI' : 'Gemini');
  const scopedAnalysis = buildSectionScopedAnalysisPayload(sectionId, currentProductAnalysis);
  const providerPrompt = sectionDef
    ? buildSectionContentProviderPrompt(
        sectionDef,
        scopedAnalysis,
        contentPrompt,
        competitorReference,
        { variant: providerVariant },
      )
    : requestInputs;
  const reportInfo = getCompetitorPromptReportInfo();
  const reportCurrent = reportInfo.current;
  const competitorEnabled = basis.id !== 'image_analysis';
  const activeDirectives = getEffectiveImageDirectives();
  const brandBlock = buildBrandPromptBlock();
  const layoutBlock = buildLayoutPromptBlock();
  const sources = [
    { id: 'product_analysis_db', label: '제품 분석/DB', active: !!currentProductAnalysis },
    { id: 'current_instruction', label: '현재 지시문', active: !!currentInstruction && (basis.id === 'current' || basis.id === 'combined') },
    { id: 'competitor_report', label: '경쟁사 리포트', active: competitorEnabled && reportCurrent && !!reportInfo.report },
    { id: 'competitor_plan', label: '경쟁사 섹션 플랜', active: competitorEnabled && !!competitorPlan },
    { id: 'helper_tips', label: '누적 이미지 팁', active: !!helperBlock },
    { id: 'global_directives', label: '전역 생성 제약', active: activeDirectives.length > 0 },
    { id: 'brand_preset', label: '브랜드 프리셋', active: !!brandBlock },
    { id: 'layout_preset', label: '레이아웃 프리셋', active: !!layoutBlock },
    { id: 'response_schema', label: '응답 JSON 규격', active: true },
  ];
  let competitorStatus = '경쟁사 분석 자료 없음 · 제품 분석/DB와 현재 지시문 기준';
  if (!competitorEnabled) competitorStatus = '경쟁사 분석 미반영 · 이미지 분석/DB 전용 기준';
  else if (reportInfo.stale) competitorStatus = '이전 경쟁사 리포트는 현재 작업 범위와 달라 제외됨';
  else if (reportCurrent && competitorPlan) competitorStatus = '현재 경쟁사 분석 리포트와 섹션 플랜 반영';
  else if (reportCurrent) competitorStatus = '현재 경쟁사 분석 리포트 반영 · 섹션 플랜 없음';
  else if (competitorPlan) competitorStatus = '현재 경쟁사 섹션 플랜 반영 · 리포트 본문 없음';
  return {
    version: SECTION_PROMPT_PIPELINE_VERSION,
    providerVersion: SECTION_CONTENT_PROVIDER_PROMPT_VERSION,
    providerLabel,
    basisId: basis.id,
    basisLabel: basis.label,
    modeId: mode.id,
    modeLabel: mode.label,
    requestInputs,
    resolvedPrompt: providerPrompt,
    competitorStatus,
    sources,
  };
}

const SECTION_DB_PROMPT_FIELD_IDS = {
  overview: [
    'product_name', 'category_usage', 'color_options', 'material', 'packaging',
    'usage_place', 'recommended_use', 'target_customer', 'season_event',
    'image_keywords', 'selling_point', 'detail_page_hint'
  ],
  header: [
    'product_name', 'category_usage', 'usage_place', 'recommended_use',
    'target_customer', 'season_event', 'image_keywords', 'image_work_hint',
    'selling_point'
  ],
  hook: [
    'product_name', 'category_usage', 'usage_place', 'recommended_use',
    'target_customer', 'season_event', 'selling_point', 'detail_page_hint'
  ],
  key_features: [
    'product_name', 'category_usage', 'material', 'packaging', 'color_options',
    'recommended_use', 'selling_point', 'image_work_hint'
  ],
  specifications: [
    'product_name', 'width_mm', 'depth_mm', 'height_mm', 'dimensions',
    'product_weight_g', 'package_weight_g', 'material', 'packaging',
    'component_count', 'model_name', 'origin', 'cafe24_notice'
  ],
  use_scenarios: [
    'product_name', 'category_usage', 'usage_place', 'recommended_use',
    'target_customer', 'season_event', 'image_keywords', 'detail_page_hint'
  ],
  competitive_edge: [
    'product_name', 'category_usage', 'material', 'packaging', 'care_notice',
    'selling_point', 'cafe24_summary', 'detail_page_hint'
  ],
  material_tech: [
    'product_name', 'material', 'care_notice', 'origin', 'manufacturer',
    'image_keywords', 'image_work_hint', 'detail_page_hint'
  ],
  certifications: [
    'product_name', 'cafe24_certification', 'origin', 'manufacturer',
    'cafe24_notice', 'care_notice'
  ],
  reviews: [
    'product_name', 'recommended_use', 'target_customer', 'selling_point',
    'usage_place', 'care_notice'
  ],
  size_color: [
    'product_name', 'color_options', 'option_name', 'option_value',
    'option_count', 'packaging'
  ],
  promotion: [
    'product_name', 'sale_price', 'retail_price', 'recommended_use',
    'season_event', 'packaging', 'component_count', 'selling_point'
  ],
  shipping: [
    'product_name', 'packaging', 'package_weight_g', 'shipping_weight_g',
    'shipping_fee_type', 'origin', 'care_notice'
  ],
  faq: [
    'product_name', 'category_usage', 'material', 'color_options', 'packaging',
    'care_notice', 'shipping_fee_type', 'recommended_use'
  ],
  brand_story: [
    'product_name', 'category_usage', 'material', 'origin', 'manufacturer',
    'brand', 'image_keywords', 'detail_page_hint'
  ],
  cta_footer: [
    'product_name', 'sale_price', 'retail_price', 'recommended_use',
    'season_event', 'selling_point'
  ],
};

const SECTION_DB_PROMPT_SCOPE_LABELS = {
  header: '상품명, 첫인상, 용도/분위기만 사용합니다. 다른 섹션용 수치나 운영값은 제외합니다.',
  hook: '구매 욕구를 만드는 용도, 타깃, 핵심 판매 포인트만 사용합니다.',
  key_features: '핵심 특징, 소재, 구성, 색상/옵션 중 장점 설명에 필요한 값만 사용합니다.',
  specifications: '가로/세로/높이, 무게, 소재, 구성처럼 상세 스펙 표에 필요한 실제 수치만 사용합니다.',
  use_scenarios: '사용처, 용도, 타깃, 시즌/행사처럼 사용 장면을 만드는 값만 사용합니다.',
  competitive_edge: '비교 우위에 필요한 품질, 소재, 구성, 핵심 판매 포인트만 사용합니다.',
  material_tech: '소재, 질감, 제작/관리/품질 힌트만 사용합니다. 다른 섹션용 수치나 가격 정보는 제외합니다.',
  certifications: '인증, 원산지, 제조/고시/주의 정보처럼 신뢰 근거만 사용합니다.',
  reviews: '고객이 느낄 사용 가치, 용도, 장점, 주의사항만 사용합니다.',
  size_color: '옵션분류기와 색상/옵션 구성만 사용합니다. 치수 수치는 상세스펙 섹션에만 둡니다.',
  promotion: '판매가/소비자가, 구성, 시즌/행사처럼 구매 촉진에 필요한 값만 사용합니다.',
  shipping: '포장, 배송 무게, 배송/주의 정보만 사용합니다.',
  faq: '고객 질문에 답할 수 있는 기본 정보, 소재, 옵션, 포장/주의 정보만 사용합니다.',
  brand_story: '브랜드/전통/소재/원산지/이미지 키워드처럼 스토리에 필요한 값만 사용합니다.',
  cta_footer: '마지막 구매 유도에 필요한 상품명, 가격, 용도, 핵심 포인트만 사용합니다.',
  overview: '상품명, 카테고리, 소재, 옵션, 용도처럼 전반 맥락만 간단히 사용합니다.'
};

const SECTION_DB_PROMPT_NEVER_FIELD_IDS = new Set([
  'stock_qty',
  'purchase_price',
  'cafe24_product_no',
  'cafe24_product_code',
  'variant_code',
  'barcode',
  'display_status',
  'tax_type',
  'supplier_order_name',
  'purchase_site',
  'inbound_memo',
  'storage_location',
  'procurement_status'
]);

function sectionDbPromptFieldIds(sectionId) {
  return SECTION_DB_PROMPT_FIELD_IDS[sectionId] || SECTION_DB_PROMPT_FIELD_IDS.overview;
}

function sectionDbPromptValueText(value) {
  if (typeof productInfoValueText === 'function') return productInfoValueText(value);
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => String(v ?? '').trim())
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' / ');
  }
  return String(value ?? '').trim();
}

function addSectionDbPromptLine(lines, seenLabels, label, value) {
  const text = sectionDbPromptValueText(value);
  if (!label || !text) return;
  const key = `${label}::${text}`;
  if (seenLabels.has(key)) return;
  seenLabels.add(key);
  lines.push(`- ${label}: ${text}`);
}

function buildSectionScopedDbSummary(sectionId = 'overview', analysisOverride = null) {
  const currentAnalysisOk = analysisOverride || typeof analysisMatchesCurrentImageInput !== 'function'
    ? true
    : analysisMatchesCurrentImageInput(state.analysis);
  const a = analysisOverride || (currentAnalysisOk ? (state.analysis || {}) : {});
  const pick = (...keys) => keys
    .map(k => a?.[k])
    .find(v => Array.isArray(v) ? v.length : String(v || '').trim());
  const lines = [];
  const seenLabels = new Set();
  const fieldIds = new Set(sectionDbPromptFieldIds(sectionId));
  const sectionInfo = SECTIONS.find(s => s.id === sectionId);
  const add = (label, value) => addSectionDbPromptLine(lines, seenLabels, label, value);

  lines.push(`- 섹션: ${sectionInfo ? `${sectionInfo.n}. ${sectionInfo.name}` : '공통'}`);
  lines.push(`- DB 사용 범위: ${SECTION_DB_PROMPT_SCOPE_LABELS[sectionId] || SECTION_DB_PROMPT_SCOPE_LABELS.overview}`);

  const productName = (analysisOverride ? '' : state.productName) || pick('product_name', 'productName', 'name', 'title', 'product_name_ko');
  const category = pick('category', 'product_category', 'category_name', 'type', 'usage');
  const color = pick('color', 'colors', 'main_color', 'color_palette');
  const material = pick('material', 'materials', 'fabric', 'texture');
  const size = pick('size', 'dimensions', 'spec_size', 'specs', 'measurements');
  const features = pick('key_features', 'features', 'visual_features', 'distinctive_features');
  const dbMatch = a.db_match || a.db_product || a.dbProduct || a.matched_db_product || a.matchedDbProduct || null;

  if (fieldIds.has('product_name')) add('상품명', productName);
  if (fieldIds.has('category_usage')) add('카테고리/용도', category);
  if (fieldIds.has('color_options')) add('색상/옵션', color);
  if (fieldIds.has('material')) add('소재/질감', material);
  if (fieldIds.has('dimensions')) add('규격/사이즈', size);
  if (fieldIds.has('selling_point')) add('식별 특징', features);

  try {
    const dbForPrompt = dbMatch && typeof dbMatch === 'object' ? { match: dbMatch } : getDbContextSummary();
    const configuredRows = getConfiguredProductInfoRows(getProductContextSummary(), dbForPrompt, { includeInactive: true })
      .filter(row => row && row.ok && fieldIds.has(row.id) && !SECTION_DB_PROMPT_NEVER_FIELD_IDS.has(row.id));
    configuredRows.forEach(row => add(row.label, row.text));
  } catch(e) {}

  if (dbMatch && typeof dbMatch === 'object') {
    const dbName = dbMatch.product_name || dbMatch.jname || dbMatch.name || '';
    const dbSize = dbMatch.dimensions || dbMatch.size || formatDbDimensions(dbMatch.spec || {});
    if (fieldIds.has('product_name')) add('DB 확정 상품', dbName);
    if (sectionId === 'specifications') {
      add('DB 확정 규격', dbSize);
      add('DB 확정 무게', dbMatch.product_weight_g ? `${dbMatch.product_weight_g}g` : '');
    }
    if (fieldIds.has('color_options')) add('DB 확정 색상/옵션', dbMatch.color || dbMatch.color_name || dbMatch.colors);
    if (fieldIds.has('material')) add('DB 확정 소재', dbMatch.material_summary || dbMatch.spec?.material_summary || dbMatch.material);
    if (fieldIds.has('packaging')) add('DB 확정 구성/포장', dbMatch.packaging_summary || dbMatch.spec?.packaging_summary || dbMatch.packaging);
  }
  const cafe24Match = typeof productInfoCafe24Match === 'function' ? productInfoCafe24Match(a) : null;
  const cafe24No = pick('cafe24_product_no', 'product_no') || (typeof productInfoCafe24Value === 'function' ? productInfoCafe24Value(a, ['product_no', 'cafe24_product_no']) : '');
  const cafe24Code = pick('cafe24_product_code', 'product_code', 'custom_product_code') || (typeof productInfoCafe24Value === 'function' ? productInfoCafe24Value(a, ['product_code', 'cafe24_product_code', 'custom_product_code']) : '');
  const cafe24Name = pick('cafe24_product_name') || (typeof productInfoCafe24Value === 'function' ? productInfoCafe24Value(a, ['product_name', 'product_name_ko', 'shop_product_name']) : '');
  const cafe24Price = pick('sale_price', 'price', 'selling_price') || (typeof productInfoCafe24Value === 'function' ? productInfoCafe24Value(a, ['sale_price', 'price', 'selling_price']) : '');
  const cafe24Retail = pick('retail_price', 'consumer_price', 'market_price') || (typeof productInfoCafe24Value === 'function' ? productInfoCafe24Value(a, ['retail_price', 'consumer_price', 'market_price']) : '');
  const cafe24Supply = pick('supply_price', 'supplier_price', 'purchase_price') || (typeof productInfoCafe24Value === 'function' ? productInfoCafe24Value(a, ['supply_price', 'supplier_price', 'purchase_price']) : '');
  const cafe24Status = pick('display_status', 'selling_status', 'display', 'selling') || (typeof productInfoCafe24Value === 'function' ? productInfoCafe24Value(a, ['display_status', 'selling_status', 'display', 'selling']) : '');
  const cafe24Sync = a.factory_sync_status || state.lastDbSyncStatus || null;
  const hasCafe24Context = !!(cafe24Match || cafe24No || cafe24Code || (cafe24Sync && typeof cafe24Sync === 'object' && (cafe24Sync.cafe24_product_no || cafe24Sync.cafe24_product_code)));
  // 사람이 「Cafe24 대상 떼기」를 눌렀으면 그 상품명을 섹션 프롬프트에 실으면 안 된다.
  // 실으면 LLM 이 그 이름으로 본문을 쓰고 — 실측 2026-08-29: "투톤반달파우치는 면 100%
  // 소재에…" — 등록 직전 점검이 남의 상품명이라며 막는다. 떼기를 눌러도, 섹션을 몇 번을
  // 다시 만들어도 같은 이름이 또 박히던 뿌리가 여기였다.
  const cafe24TargetDeclined = (() => {
    try {
      return factoryRuntimeReadFactory()?.product?.cafe24AutoMatchDeclined === true;
    } catch (_) {
      return false;
    }
  })();
  if (hasCafe24Context && !cafe24TargetDeclined && fieldIds.has('product_name')) {
    add('Cafe24 확정 상품명', cafe24Name);
  }
  if (hasCafe24Context && (fieldIds.has('sale_price') || fieldIds.has('retail_price') || fieldIds.has('supply_price'))) {
    add('Cafe24 가격', [
      cafe24Price ? `판매가 ${cafe24Price}` : '',
      cafe24Retail ? `소비자가 ${cafe24Retail}` : '',
      fieldIds.has('supply_price') && cafe24Supply ? `공급가 ${cafe24Supply}` : ''
    ].filter(Boolean).join(' / '));
  }
  if (hasCafe24Context && fieldIds.has('display_status')) {
    add('Cafe24 상태', cafe24Status);
  }
  return lines.length > 2 ? lines.join('\n') : '- 제품 분석 정보가 부족하므로 업로드된 원본 이미지를 유일한 기준으로 삼는다.';
}

function productIdentitySummaryForPrompt(analysisOverride = null, sectionId = 'overview') {
  return buildSectionScopedDbSummary(sectionId || 'overview', analysisOverride);
}

function buildSectionScopedAnalysisPayload(sectionId, analysisOverride = null) {
  const section = SECTIONS.find(s => s.id === sectionId);
  return {
    section_id: sectionId || 'overview',
    section_name: section ? `${section.n}. ${section.name}` : '공통',
    section_purpose: section?.purpose || '',
    allowed_product_facts: productIdentitySummaryForPrompt(analysisOverride, sectionId || 'overview'),
    strict_rule: '이 객체에 없는 DB/Cafe24 값은 이 섹션 문구에 사용하지 않는다. 원본 제품 형태는 이미지 기준으로 보존한다.',
  };
}

function buildProductIdentityGuard(modeId = 'mixed', analysisOverride = null, sectionId = 'overview') {
  const mode = getSectionGenerationModeInfo(modeId);
  const textRule = mode.id === 'full_image'
    ? 'This mode may include concise Korean copy inside the image, but text must not cover, redraw, or replace the product.'
    : 'Do not render Korean copy inside the image unless the user explicitly asks; the app will place editable text separately.';
  return `PRODUCT IDENTITY LOCK - absolutely mandatory:
The uploaded product image is the source of truth for the item being sold. This is not a concept redesign task.
Preserve the exact product identity: category, silhouette, proportions, front/back orientation, visible edges, fabric texture, color blocking, string/handle position, ornament placement, embroidery/bead details, logo/markings, and size impression.
The uploaded/current product image wins over every saved analysis field. If old DB text, old prompts, old competitor notes, or previous session data mention a different color or product, ignore that stale text and preserve the uploaded image color exactly.
Do NOT turn the item into a different product shape. If the source is a slim rectangular pouch, do not convert it into a round drawstring pouch, bucket bag, handbag, box, sack, or any new silhouette.
Do NOT invent new patterns, decorative bands, large embroidery panels, extra handles, extra ornaments, extra tassels, extra strings, different closures, or new product parts that are not visible in the source.
Allowed improvements: background, lighting, shadow, crop, camera angle, nearby props, clean composition, subtle reflection, spacing, and ecommerce layout styling around the product.
If exact preservation conflicts with a beautification idea, prioritize preserving the original product. A plain but accurate product image is better than a beautiful but wrong product.
${textRule}

Known product facts from analysis for this section only:
${productIdentitySummaryForPrompt(analysisOverride, sectionId)}`;
}

function buildSectionImagePrompt(sectionDef, content, modeId, analysisOverride = null) {
  const mode = getSectionGenerationModeInfo(modeId);
  const base = content.image_description || content.design_notes || sectionDef.purpose;
  const identityGuard = buildProductIdentityGuard(mode.id, analysisOverride, sectionDef.id);
  const basisId = content?.generation_basis || getSectionBasisMode(sectionDef.id);
  const helperBlock = basisId === 'image_analysis' ? '' : getAppliedSectionHelperBlock(sectionDef.id);
  const helperPrompt = helperBlock ? `\n\nACCUMULATED SECTION IMAGE HELPER TIPS:\n${helperBlock}` : '';
  const assemblyPrompt = buildSectionAssemblyPromptBlock(sectionDef.id, { imageOnly: true });
  const assemblyImagePrompt = assemblyPrompt ? `\n\nSECTION ASSEMBLY IMAGE SETTINGS:\n${assemblyPrompt}` : '';
  if (mode.id === 'full_image') {
    return `Create one complete Korean ecommerce detail-page section image for section "${sectionDef.name}".
The image itself must include the key visual layout and concise Korean copy.
Use these exact or near-exact copy elements when appropriate:
- Headline: ${content.headline || ''}
- Subheadline: ${content.subheadline || ''}
- Body key message: ${content.body_text || ''}
- Extra points: ${(content.extra_elements || []).join(' / ')}
Visual direction: ${base}
Keep it clean, legible, product-focused, and suitable as a standalone detail-page section.
${helperPrompt}
${assemblyImagePrompt}

${identityGuard}`;
  }
  return `${base}
${helperPrompt}
${assemblyImagePrompt}

${identityGuard}`;
}

function buildImageApiPromptEnvelope(prompt, imageModelId = null) {
  const imgModel = imageModelId || getImageModel();
  const providerId = getImageProvider(imgModel);
  const openAIImage = isOpenAIImageModel(imgModel);
  const activeDirectives = getEffectiveImageDirectives();
  const brandBlock = buildBrandPromptBlock();
  const layoutBlock = buildLayoutPromptBlock();
  const directiveStr = activeDirectives.length > 0
    ? (openAIImage
      ? `\n\nCRITICAL CONSTRAINTS - follow exactly:\n${activeDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n')}`
      : `\n\nCRITICAL CONSTRAINTS — you MUST follow these exactly, no exceptions:\n${activeDirectives.map((d,i)=>`${i+1}. ${d}`).join('\n')}`)
    : '';
  const cfg = state.modelConfig || {};
  const sizeHint = (cfg.imageSizeMode === 'custom' && cfg.imageWidth)
    ? `Exact size: ${cfg.imageWidth}px wide${cfg.imageHeight ? ' × ' + cfg.imageHeight + 'px tall' : ''}.`
    : 'Size: 860px wide.';
  const requestedSize = getRequestedImageSize(imgModel);
  const fullPrompt = openAIImage
    ? `Create a professional Korean e-commerce product detail page section image. ${prompt}${directiveStr}\n${brandBlock}\n${layoutBlock}`
    : `Create a professional Korean e-commerce product detail page section image. ${prompt} Style: clean, modern, high-end Korean shopping mall aesthetic. ${sizeHint}${directiveStr}\n${brandBlock}\n${layoutBlock}`;
  return {
    provider: getCurrentImageRunInfo(imgModel).providerLabel,
    providerId,
    modelId: imgModel,
    modelLabel: getImageModelLabel(imgModel),
    requestedSize: openAIImage ? requestedSize : sizeHint,
    directives: activeDirectives,
    brandBlock,
    layoutBlock,
    fullPrompt,
  };
}

function attachSectionPromptTrace(sectionDef, content, options = {}) {
  if (!content || !sectionDef) return content;
  const mode = getSectionGenerationModeInfo(content.generation_mode || sectionDef.id);
  const basis = getSectionBasisModeInfo(content.generation_basis || sectionDef.id);
  const contentPrompt = options.contentPrompt || buildSectionPromptInstructions(sectionDef.id, state.sectionInstructions?.[sectionDef.id] || '');
  const imagePrompt = options.imagePrompt || (mode.id === 'text_only' ? '' : buildSectionImagePrompt(sectionDef, content, mode.id, options.analysisOverride || null));
  const apiPrompt = imagePrompt ? (options.imageApiPrompt || buildImageApiPromptEnvelope(imagePrompt)) : null;
  const sourceImageUsed = !!(apiPrompt && (options.sourceImageUsed ?? (state.imageBase64 || state.imagePreview)));
  const llmInfo = getCurrentLlmRunInfo();
  const assemblyPromptBlock = buildSectionAssemblyPromptBlock(sectionDef.id);
  content.prompt_trace = {
    promptPipelineVersion: SECTION_PROMPT_PIPELINE_VERSION,
    sectionId: sectionDef.id,
    sectionName: `${sectionDef.n}. ${sectionDef.name}`,
    trigger: options.trigger || '',
    createdAt: Date.now(),
    reconstructed: !!options.reconstructed,
    basisId: basis.id,
    basisLabel: basis.label,
    modeId: mode.id,
    modeLabel: mode.label,
    llmProviderLabel: llmInfo.providerLabel,
    llmModelId: llmInfo.modelId,
    llmModelLabel: llmInfo.modelLabel,
    imageProviderLabel: apiPrompt?.provider || '',
    imageModelId: apiPrompt?.modelId || '',
    imageModelLabel: apiPrompt?.modelLabel || '',
    imageRequestedSize: apiPrompt?.requestedSize || '',
    sourceImageUsed,
    sourceImageNote: sourceImageUsed
      ? '원본 제품 이미지가 이미지 모델의 참고 이미지로 함께 입력되었습니다.'
      : (apiPrompt ? '원본 제품 이미지 파일은 함께 입력되지 않았고, 텍스트 컨텍스트 기준으로 생성되었습니다.' : '이미지 API를 호출하지 않은 텍스트/레이아웃 생성입니다.'),
    productAnalysisSummary: productIdentitySummaryForPrompt(options.analysisOverride || null, sectionDef.id),
    competitorContext: options.compRef || '',
    contentGenerationPrompt: contentPrompt,
    imageSectionPrompt: imagePrompt,
    imageApiFinalPrompt: apiPrompt?.fullPrompt || '',
    assemblySettings: cloneData(getSectionAssembly(sectionDef.id)),
    assemblyPromptBlock,
    imageDirectives: apiPrompt?.directives || [],
    brandBlock: apiPrompt?.brandBlock || '',
    layoutBlock: apiPrompt?.layoutBlock || '',
  };
  return content;
}

function renderSectionModeChooser(sectionId) {
  const active = getSectionGenerationMode(sectionId);
  return `<div class="section-mode-panel" onclick="event.stopPropagation()">
    <div class="section-mode-panel-title">
      <span class="material-icons-outlined" style="font-size:15px;color:var(--primary-h)">tune</span>
      생성 방식 선택
    </div>
    <div class="section-mode-choices">
      ${SECTION_GENERATION_MODES.map(m => `<button type="button" class="section-mode-choice ${active === m.id ? 'active' : ''}" data-section-mode-choice="${sectionId}:${m.id}">
        <b>${escapeHtml(m.label)}</b>
        <span>${escapeHtml(m.desc)}</span>
      </button>`).join('')}
    </div>
  </div>`;
}

function renderSectionBasisChooser(sectionId) {
  const active = getSectionBasisMode(sectionId);
  return `<div class="section-mode-panel" onclick="event.stopPropagation()">
    <div class="section-mode-panel-title">
      <span class="material-icons-outlined" style="font-size:15px;color:var(--ok)">rule</span>
      생성 기준 선택
      <span style="font-size:11px;color:var(--text-m);font-weight:700">어떤 지시를 우선 볼지 정합니다</span>
    </div>
    <div class="section-mode-choices">
      ${SECTION_BASIS_MODES.map(m => {
        const missingPlan = m.id === 'competitor_plan' && sectionCompetitorPlanMissing(sectionId);
        const desc = missingPlan ? '아직 이 섹션의 경쟁사 플랜이 없습니다. 경쟁사 분석 메뉴에서 섹션 플랜을 먼저 생성/적용해야 합니다.' : m.desc;
        return `<button type="button" class="section-mode-choice ${active === m.id ? 'active' : ''}" data-section-basis-choice="${sectionId}:${m.id}">
          <b>${escapeHtml(sectionBasisOptionLabel(m, sectionId))}</b>
          <span>${escapeHtml(desc)}</span>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

function renderSectionBasisPromptCompare(sectionId) {
  const active = getSectionBasisMode(sectionId);
  const currentInstruction = state.sectionInstructions?.[sectionId] || '';
  const items = [
    {
      id: 'competitor_plan',
      icon: 'manage_search',
      title: '경쟁사 분석플랜 프롬프트',
      empty: '아직 이 섹션의 경쟁사 분석플랜 프롬프트가 없습니다. 경쟁사 분석에서 섹션 플랜을 만들면 여기에 표시됩니다.',
      text: getCompetitorPlanInstruction(sectionId)
        ? resolveSectionBasisInstructions(sectionId, currentInstruction, 'competitor_plan')
        : ''
    },
    {
      id: 'image_analysis',
      icon: 'image_search',
      title: 'AI 분석 + DB 확정값 프롬프트',
      empty: '제품 분석/DB 값이 없으면 기본 원본 보존 지시만 표시됩니다.',
      text: resolveSectionBasisInstructions(sectionId, currentInstruction, 'image_analysis')
    },
    {
      id: 'combined',
      icon: 'hub',
      title: '총합버전 프롬프트',
      empty: '현재 지시문, 이미지/DB 분석, 경쟁사 분석을 함께 쓰는 종합 기준입니다.',
      text: resolveSectionBasisInstructions(sectionId, currentInstruction, 'combined')
    }
  ];
  return `<div class="basis-prompt-compare" onclick="event.stopPropagation()">
    ${items.map(item => {
      const activeClass = active === item.id ? ' active' : '';
      const text = String(item.text || '').trim();
      return `<div class="basis-prompt-box${activeClass}">
        <div class="basis-prompt-head">
          <div class="basis-prompt-title">
            <span class="material-icons-outlined" style="font-size:14px;color:${item.id === 'competitor_plan' ? 'var(--primary-h)' : 'var(--ok)'}">${item.icon}</span>
            ${escapeHtml(item.title)}
          </div>
          ${active === item.id ? '<span class="basis-prompt-badge">현재 선택</span>' : `<button type="button" class="btn-sm" data-section-basis-choice="${sectionId}:${item.id}">이 기준 선택</button>`}
        </div>
        <div class="basis-prompt-text ${text ? '' : 'basis-prompt-empty'}">${escapeHtml(text || item.empty)}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function sectionAssemblyGeneralCutChoices() {
  if (typeof sectionPlacementChoicesFromCuts === 'function') {
    return sectionPlacementChoicesFromCuts().filter(choice => String(choice.key || '').startsWith('cut:'));
  }
  const choices = [];
  (state.cuts?.prompts || []).forEach((cut, index) => {
    const image = typeof factoryCoerceImageSrc === 'function'
      ? factoryCoerceImageSrc(cut?.result)
      : (cut?.result || '');
    if (!image) return;
    choices.push({
      key: `cut:${cut.id}`,
      legacyId: cut.id,
      image,
      label: cut.label || `이미지컷 ${index + 1}`,
      source: '이미지컷',
      prompt: cut.prompt || '',
    });
  });
  return choices;
}

function renderSectionAssemblySummaryPanel() {
  const cutChoices = sectionAssemblyGeneralCutChoices();
  const configured = Object.keys(state.sectionAssembly || {}).filter(sectionId => hasCustomSectionAssembly(sectionId)).length;
  const placedCuts = Object.entries(state.cuts?.placement || {}).filter(([, value]) => String(value || '').startsWith('cut:')).length;
  return `<div class="section-mode-panel" style="margin:0 0 14px" onclick="event.stopPropagation()">
    <div class="section-mode-panel-title" style="align-items:flex-start;gap:10px;flex-wrap:wrap">
      <span class="material-icons-outlined" style="font-size:17px;color:var(--primary-h)">extension</span>
      <div style="flex:1;min-width:220px">
        <div>섹션 조립판</div>
        <div style="font-size:12px;color:var(--text-m);font-weight:600;margin-top:3px">섹션별로 DB/경쟁사/현재 지시문을 섞고, 생성한 이미지컷을 프롬프트 참고나 섹션 이미지로 꽂습니다.</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm" id="autoSectionAssemblyCutsBtn" ${disabledAttr(!cutChoices.length, '배치할 일반 이미지컷 결과가 없습니다.')}>
          <span class="material-icons-outlined" style="font-size:14px">auto_awesome</span>이미지컷 추천 배치
        </button>
        <button class="btn-sm" id="clearSectionAssemblyCutsBtn" ${disabledAttr(!configured && !placedCuts, '초기화할 조립 설정이 없습니다.')}>
          <span class="material-icons-outlined" style="font-size:14px">backspace</span>이미지컷 조립 초기화
        </button>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--text-m)">
      <span class="section-source-pill"><span class="material-icons-outlined" style="font-size:13px">inventory_2</span>일반 이미지컷 <strong>${cutChoices.length}개</strong></span>
      <span class="section-source-pill"><span class="material-icons-outlined" style="font-size:13px">tune</span>조립 설정 <strong>${configured}개</strong></span>
      <span class="section-source-pill"><span class="material-icons-outlined" style="font-size:13px">push_pin</span>사이즈/색상컷 <strong>고정 유지</strong></span>
    </div>
  </div>`;
}

function renderSectionAssemblyPanel(sectionId) {
  const assembly = getSectionAssembly(sectionId);
  const cutChoices = sectionAssemblyGeneralCutChoices();
  const selectedAsset = resolveSectionAssemblyAsset(assembly.cutAssetKey);
  const canPlace = sectionAssemblyCanPlaceCutInSection(sectionId);
  const sourceSummary = sectionAssemblySourceSummary(sectionId);
  const usageInfo = sectionAssemblyCutUsageInfo(assembly.cutUsage);
  const cutLabel = selectedAsset ? `${selectedAsset.source || '이미지컷'} · ${selectedAsset.label || '선택됨'}` : '선택한 이미지컷 없음';
  return `<div class="section-mode-panel" onclick="event.stopPropagation()">
    <div class="section-mode-panel-title" style="align-items:flex-start;gap:10px;flex-wrap:wrap">
      <span class="material-icons-outlined" style="font-size:16px;color:var(--primary-h)">view_in_ar</span>
      <div style="flex:1;min-width:220px">
        <div>섹션 조립판</div>
        <div style="font-size:12px;color:var(--text-m);font-weight:600;margin-top:3px">현재 조합: ${escapeHtml(sourceSummary)} · 이미지컷: ${escapeHtml(usageInfo.shortLabel)} · ${escapeHtml(cutLabel)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-top:10px">
      ${SECTION_ASSEMBLY_SOURCES.map(source => `<label class="section-mode-choice ${assembly.sources?.[source.id] ? 'active' : ''}" style="cursor:pointer">
        <input type="checkbox" data-section-assembly-source="${escAttr(sectionId)}:${escAttr(source.id)}" ${assembly.sources?.[source.id] ? 'checked' : ''} style="accent-color:var(--primary);margin:0 6px 0 0">
        <b>${escapeHtml(source.label)}</b>
        <span>${escapeHtml(source.desc)}</span>
      </label>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px">
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-m);font-weight:700">
        이미지컷 사용 방식
        <select class="input section-assembly-select" data-section-assembly-cut-usage="${escAttr(sectionId)}">
          ${SECTION_ASSEMBLY_CUT_USAGES.map(usage => {
            const placementOnly = usage.id === 'section' || usage.id === 'both';
            const disabled = placementOnly && !canPlace;
            const suffix = disabled ? ' · 고정 섹션 제외' : '';
            return `<option value="${usage.id}" ${assembly.cutUsage === usage.id ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(usage.label + suffix)}</option>`;
          }).join('')}
        </select>
        <span style="font-size:11px;color:var(--text-d);font-weight:500">${escapeHtml(usageInfo.desc)}</span>
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-m);font-weight:700">
        사용할 일반 이미지컷
        <select class="input section-assembly-select" data-section-assembly-cut="${escAttr(sectionId)}" ${disabledAttr(!cutChoices.length, '일반 이미지컷 생성 결과가 없습니다.')}>
          <option value="">선택 안 함</option>
          ${cutChoices.map(choice => `<option value="${escAttr(choice.key)}" ${assembly.cutAssetKey === choice.key || assembly.cutAssetKey === choice.legacyId ? 'selected' : ''}>${escapeHtml(choice.source)} · ${escapeHtml(choice.label)}</option>`).join('')}
        </select>
        <span style="font-size:11px;color:var(--text-d);font-weight:500">사이즈컷과 색상옵션컷은 각 고정 섹션에서 따로 유지됩니다.</span>
      </label>
    </div>
    <textarea class="textarea" data-section-assembly-note="${escAttr(sectionId)}" rows="2" style="margin-top:10px" placeholder="이 섹션에서 선택한 소스/이미지컷을 어떻게 섞을지 적어두세요. 예: 훅 문구는 경쟁사 플랜 톤을 쓰되, 비주얼은 2번 이미지컷 분위기로.">${escapeHtml(assembly.note || '')}</textarea>
    ${!canPlace ? `<div style="margin-top:8px;font-size:12px;color:var(--warn);line-height:1.5">이 섹션은 사이즈/색상 고정 영역이라 일반 이미지컷을 섹션 이미지로 배치하지 않습니다. 대신 “프롬프트에 녹이기”는 사용할 수 있습니다.</div>` : ''}
  </div>`;
}

function noteSectionGenerated(sectionId, trigger = 'single') {
  if (!state.sectionGenerationMeta) state.sectionGenerationMeta = {};
  const mode = getSectionGenerationModeInfo(sectionId);
  const basis = getSectionBasisModeInfo(sectionId);
  const instructionSource = getSectionInstructionSourceInfo(sectionId);
  const llmInfo = getCurrentLlmRunInfo();
  const imageInfo = mode.id === 'text_only' ? null : getCurrentImageRunInfo();
  const triggerLabels = {
    single: '섹션 설정에서 개별 생성',
    all: '섹션 설정 일괄 생성',
    competitor: '경쟁사 분석 플랜에서 생성',
    preview: '미리보기 재생성',
  };
  state.sectionGenerationMeta[sectionId] = {
    label: triggerLabels[trigger] || 'AI 생성 결과',
    detail: `${instructionSource.label} · ${basis.shortLabel} · ${mode.shortLabel} · 조립 ${sectionAssemblySourceSummary(sectionId)}`,
    trigger,
    mode: mode.id,
    modeLabel: mode.shortLabel,
    basis: basis.id,
    basisLabel: basis.shortLabel,
    instructionSource: instructionSource.label,
    llmProviderId: llmInfo.providerId,
    llmProviderLabel: llmInfo.providerLabel,
    llmModelId: llmInfo.modelId,
    llmModelLabel: llmInfo.modelLabel,
    llmRoute: llmInfo.route,
    imageProviderId: imageInfo?.providerId || '',
    imageProviderLabel: imageInfo?.providerLabel || '',
    imageModelId: imageInfo?.modelId || '',
    imageModelLabel: imageInfo?.modelLabel || '',
    imageRoute: imageInfo?.route || '',
    ...sectionWorkScopeMeta(),
    createdAt: Date.now(),
  };
}

function getAiRepairUndoStack(sectionId, create = true) {
  if (!sectionId) return [];
  if (!state.aiRepairUndoStack || typeof state.aiRepairUndoStack !== 'object') {
    if (!create) return [];
    state.aiRepairUndoStack = {};
  }
  if (!Array.isArray(state.aiRepairUndoStack[sectionId])) {
    if (!create) return [];
    state.aiRepairUndoStack[sectionId] = [];
  }
  return state.aiRepairUndoStack[sectionId];
}

function canUndoAiRepair(sectionId) {
  return getAiRepairUndoStack(sectionId, false).some(item => item?.image);
}

function pushAiRepairUndo(sectionId, imageData, content, mode = 'spot') {
  if (!sectionId || !imageData) return;
  const stack = getAiRepairUndoStack(sectionId);
  const entry = {
    id: uid(`repair_undo_${sectionId}`),
    label: mode === 'replace' ? 'AI 부분 교체 전' : 'AI 스팟 복구 전',
    mode,
    image: imageData,
    content: cloneData(content || state.sectionContents[sectionId] || {}),
    createdAt: Date.now(),
  };
  state.aiRepairUndoStack[sectionId] = [entry, ...stack].slice(0, 5);
}

function undoAiRepair(sectionId, operationContext = null) {
  if (!runtimeOperationContextIsCurrent(operationContext)) return false;
  const stack = getAiRepairUndoStack(sectionId);
  const entryIndex = stack.findIndex(item => item?.image);
  if (entryIndex < 0) {
    if (!runtimeOperationContextIsCurrent(operationContext)) return false;
    state.error = '되돌릴 AI 수정 기록이 없습니다.';
    render();
    return false;
  }
  const [entry] = stack.splice(entryIndex, 1);
  state.aiRepairUndoStack[sectionId] = stack;
  if (state.sectionContents[sectionId] || state.sectionImages[sectionId]) {
    rememberSectionVariant(sectionId, state.sectionContents[sectionId], state.sectionImages[sectionId] || null, 'variant', 'AI 되돌리기 전');
  }
  state.sectionContents[sectionId] = cloneData(entry.content || state.sectionContents[sectionId] || {});
  state.sectionImages[sectionId] = entry.image;
  const variant = rememberSectionVariant(sectionId, state.sectionContents[sectionId], entry.image, 'baseline', entry.label || 'AI 수정 전');
  if (variant) state.currentSectionVariantIds[sectionId] = variant.id;
  markContentChanged();
  if (!runtimeOperationContextIsCurrent(operationContext)) return false;
  savePersistentState();
  render();
  return true;
}

function saveManualSectionContent(sectionId, patch) {
  const current = cloneData(state.sectionContents[sectionId] || {});
  current.headline = patch.headline;
  current.subheadline = patch.subheadline;
  current.body_text = patch.body_text;
  current.cta_text = patch.cta_text;
  current.extra_elements = (patch.extra_elements || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  current.layout_suggestion = patch.layout_suggestion || current.layout_suggestion || '';
  applySectionContent(sectionId, current, undefined, 'manual');
  state.manualSectionEdits[sectionId] = true;
  savePersistentState();
}

function setSectionLock(sectionId, locked) {
  if (locked) state.sectionLocks[sectionId] = true;
  else delete state.sectionLocks[sectionId];
  savePersistentState();
  render();
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hexToRgb(hex) {
  const raw = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) return null;
  const normalized = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
  const num = parseInt(normalized, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function contrastRatio(fg, bg) {
  const a = hexToRgb(fg);
  const b = hexToRgb(bg);
  if (!a || !b) return null;
  const toLum = ({ r, g, b }) => {
    const chan = [r, g, b].map(v => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
  };
  const l1 = toLum(a);
  const l2 = toLum(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function runQaCheck({ renderAfter = true } = {}) {
  const findings = [];
  const preset = getActiveBrandPreset();
  const headlineSeen = new Map();
  const ctaSeen = new Map();
  const banned = String(preset?.bannedPhrases || '')
    .split(/[,\n]/)
    .map(item => item.trim())
    .filter(Boolean);

  for (const section of SECTIONS) {
    const content = state.sectionContents[section.id];
    if (!content) {
      findings.push({ severity: 'warning', sectionId: section.id, title: `${section.name} 미생성`, detail: '이 섹션은 아직 생성되지 않았습니다.' });
      continue;
    }
    const headline = String(content.headline || '').trim();
    const body = String(content.body_text || '').trim();
    const cta = String(content.cta_text || '').trim();
    const contrast = contrastRatio(content.color_scheme?.text_primary, content.color_scheme?.background);

    if (!headline) findings.push({ severity: 'critical', sectionId: section.id, title: `${section.name} 헤드라인 누락`, detail: '헤드라인이 비어 있습니다.' });
    if (!body) findings.push({ severity: 'critical', sectionId: section.id, title: `${section.name} 본문 누락`, detail: '본문 카피가 비어 있습니다.' });
    if (body && body.length < 28) findings.push({ severity: 'warning', sectionId: section.id, title: `${section.name} 본문이 너무 짧음`, detail: '본문 설명이 짧아서 설득력이 약할 수 있습니다.' });
    if ((section.id === 'header' || section.id === 'features') && !state.sectionImages[section.id]) {
      findings.push({ severity: 'warning', sectionId: section.id, title: `${section.name} 이미지 없음`, detail: '핵심 섹션인데 전용 이미지가 없습니다.' });
    }
    if (contrast && contrast < 3.5) {
      findings.push({ severity: 'warning', sectionId: section.id, title: `${section.name} 대비 부족`, detail: `텍스트 대비가 낮습니다 (${contrast.toFixed(2)}:1).` });
    }
    if (headline) {
      const key = normalizeText(headline);
      if (headlineSeen.has(key)) findings.push({ severity: 'warning', sectionId: section.id, title: `${section.name} 헤드라인 중복`, detail: `"${headline}" 문구가 다른 섹션과 겹칩니다.` });
      headlineSeen.set(key, section.id);
    }
    if (cta) {
      const key = normalizeText(cta);
      if (ctaSeen.has(key)) findings.push({ severity: 'info', sectionId: section.id, title: `${section.name} CTA 반복`, detail: `"${cta}" CTA가 반복됩니다.` });
      ctaSeen.set(key, section.id);
    }
    for (const phrase of banned) {
      if (!phrase) continue;
      const allText = `${headline} ${content.subheadline || ''} ${body} ${(content.extra_elements || []).join(' ')}`.toLowerCase();
      if (allText.includes(phrase.toLowerCase())) {
        findings.push({ severity: 'critical', sectionId: section.id, title: `${section.name} 금지 표현 포함`, detail: `"${phrase}" 금지 표현이 들어 있습니다.` });
      }
    }
  }

  if (Object.keys(state.sectionContents || {}).length < 6) {
    findings.push({ severity: 'warning', sectionId: '', title: '전체 섹션 수 부족', detail: '생성된 섹션 수가 적어서 완성도가 낮아 보일 수 있습니다.' });
  }

  state.qaReport = {
    generatedAt: Date.now(),
    version: state.contentVersion || 0,
    totalSections: Object.keys(state.sectionContents || {}).length,
    findings,
    summary: {
      critical: findings.filter(f => f.severity === 'critical').length,
      warning: findings.filter(f => f.severity === 'warning').length,
      info: findings.filter(f => f.severity === 'info').length,
    },
  };
  state.qaVersion = state.contentVersion || 0;
  if (renderAfter) render();
  return state.qaReport;
}

// ── AI QA 체크 (LLM 기반 10개 항목 채점) ─────────────────────
async function runAiQaCheck() {
  const sections = Object.entries(state.sectionContents || {});
  if (sections.length === 0) { state.error = '먼저 섹션을 생성해주세요.'; render(); return; }

  let llm;
  try { llm = getLLMClient(); } catch(e) { state.error = e.message; render(); return; }

  state.progressMsg = '🤖 AI QA 분석 중...';
  state.progress = 10;
  render();

  const sectionSummary = sections.map(([id, c]) => {
    const s = SECTIONS.find(x => x.id === id);
    return `[${s?.name || id}] 헤드라인: "${c.headline || '없음'}" | 본문: "${(c.body_text || '').slice(0, 80)}" | CTA: "${c.cta_text || '없음'}"`;
  }).join('\n');

  const prompt = `당신은 한국 이커머스 상세페이지 전문 QA 컨설턴트입니다.
아래는 상세페이지를 구성하는 섹션들의 내용입니다.

=== 제품 정보 ===
${state.analysis ? `${state.analysis.product_name} / ${state.analysis.category}` : '(미분석)'}

=== 섹션 내용 ===
${sectionSummary}

다음 10개 항목을 100점 만점으로 채점하고, 각 항목별 개선 제안을 1-2문장으로 작성하세요.
반드시 JSON만 반환하세요:
{
  "total_score": 75,
  "grade": "B",
  "summary": "전체 총평 2-3문장",
  "items": [
    {"id":"korean","name":"한국어 자연스러움","score":80,"feedback":"구체적 개선 제안"},
    {"id":"cta","name":"CTA 설득력","score":70,"feedback":"..."},
    {"id":"uniqueness","name":"차별화 포인트 명확성","score":65,"feedback":"..."},
    {"id":"tone","name":"브랜드 톤 일관성","score":75,"feedback":"..."},
    {"id":"info_density","name":"정보 충실도","score":80,"feedback":"..."},
    {"id":"duplicate","name":"중복 문구 없음","score":90,"feedback":"..."},
    {"id":"emotion","name":"감성적 호소력","score":70,"feedback":"..."},
    {"id":"seo","name":"키워드 최적화","score":60,"feedback":"..."},
    {"id":"flow","name":"섹션 간 흐름","score":75,"feedback":"..."},
    {"id":"conversion","name":"구매 전환 가능성","score":70,"feedback":"..."}
  ]
}`;

  try {
    let result;
    if (llm instanceof GeminiAPI) {
      const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 2048 } };
      const data = await llm._generateContent(llm.model, body);
      tokenTracker.record(llm.model, data.usageMetadata?.promptTokenCount, data.usageMetadata?.candidatesTokenCount, false, 'AI QA');
      let txt = data.candidates[0].content.parts[0].text.trim().replace(/^```json\s*/,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
      result = JSON.parse(txt);
    } else {
      const body = { model: llm.model, messages: [{ role: 'user', content: prompt }], max_completion_tokens: 2048, temperature: 0.3 };
      const res = await fetch(`${llm.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llm.apiKey}` }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      tokenTracker.record(llm.model, data.usage?.prompt_tokens, data.usage?.completion_tokens, false, 'AI QA');
      result = llm._parseJSON(data.choices[0].message.content);
    }

    // 기존 rule-based findings와 병합
    const ruleReport = runQaCheck({ renderAfter: false });
    state.qaReport = {
      ...ruleReport,
      aiScore: result,
      generatedAt: Date.now(),
    };
    state.qaVersion = state.contentVersion || 0;
    state.progressMsg = '';
    state.progress = 0;
    render();
  } catch(e) {
    state.error = `AI QA 실패: ${e.message}`;
    state.progressMsg = '';
    state.progress = 0;
    render();
  }
}

function updateBrandPresetDraftFromInputs() {
  const read = id => {
    const el = document.getElementById(id);
    return el ? el.value : undefined;
  };
  state.brandPresetDraft = normalizeBrandPreset({
    ...state.brandPresetDraft,
    name: read('brandPresetName') ?? state.brandPresetDraft?.name,
    tone: read('brandPresetTone') ?? state.brandPresetDraft?.tone,
    requiredKeywords: read('brandPresetKeywords') ?? state.brandPresetDraft?.requiredKeywords,
    bannedPhrases: read('brandPresetBanned') ?? state.brandPresetDraft?.bannedPhrases,
    headlineFont: read('brandPresetHeadlineFont') ?? state.brandPresetDraft?.headlineFont,
    bodyFont: read('brandPresetBodyFont') ?? state.brandPresetDraft?.bodyFont,
    accentColor: read('brandPresetAccent') ?? state.brandPresetDraft?.accentColor,
    backgroundColor: read('brandPresetBackground') ?? state.brandPresetDraft?.backgroundColor,
    imageDirectives: read('brandPresetImageDirectives') ?? state.brandPresetDraft?.imageDirectives,
    globalInstruction: read('brandPresetGlobalInstruction') ?? state.brandPresetDraft?.globalInstruction,
  });
  scheduleLastWorkSave();
}

function saveBrandPresetFromDraft() {
  updateBrandPresetDraftFromInputs();
  const draft = normalizeBrandPreset(state.brandPresetDraft);
  if (!draft.name) {
    state.error = '프리셋 이름을 입력하세요.';
    render();
    return;
  }
  if (!draft.id) draft.id = uid('preset');
  const rest = (state.brandPresets || []).filter(item => item.id !== draft.id);
  state.brandPresets = [draft, ...rest].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  state.activeBrandPresetId = draft.id;
  state.brandPresetDraft = cloneData(draft);
  saveBrandPresets(state.brandPresets);
  saveActiveBrandPresetId(state.activeBrandPresetId);
  markContentChanged();
  render();
}

function applyCompetitorStylePreset(saveAsPreset = false) {
  const draft = competitorStyleToBrandPreset(state.compPage?.analysisResult || {});
  if (!draft) {
    state.error = '타사 상세페이지에서 추출된 톤앤매너/컬러 프리셋이 아직 없습니다. 경쟁사 분석을 다시 실행해 주세요.';
    render();
    return;
  }
  state.error = '';
  if (saveAsPreset) {
    const next = normalizeBrandPreset({ ...draft, id: draft.id || uid('comp_style') });
    const rest = (state.brandPresets || []).filter(item => item.id !== next.id);
    state.brandPresets = [next, ...rest].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    state.activeBrandPresetId = next.id;
    state.brandPresetDraft = cloneData(next);
    saveBrandPresets(state.brandPresets);
    saveActiveBrandPresetId(next.id);
    state.progressMsg = `타사 스타일 프리셋 "${next.name}"을 저장하고 활성화했습니다.`;
  } else {
    state.activeBrandPresetId = '';
    state.brandPresetDraft = normalizeBrandPreset({ ...draft, id: '' });
    saveActiveBrandPresetId('');
    state.progressMsg = '타사 톤앤매너/컬러를 브랜드 프리셋 초안에 넣었습니다. 브랜드 스튜디오에서 확인 후 저장할 수 있습니다.';
  }
  setUiNotice(state.progressMsg, 'ok');
  markContentChanged();
  render();
}

function deleteActiveBrandPreset() {
  if (!state.activeBrandPresetId) return;
  state.brandPresets = (state.brandPresets || []).filter(item => item.id !== state.activeBrandPresetId);
  state.activeBrandPresetId = '';
  state.brandPresetDraft = createEmptyBrandPreset();
  saveBrandPresets(state.brandPresets);
  saveActiveBrandPresetId('');
  markContentChanged();
  render();
}

if (_savedSession?.brandPresetDraft) {
  state.brandPresetDraft = normalizeBrandPreset(_savedSession.brandPresetDraft);
} else if (state.activeBrandPresetId) {
  state.brandPresetDraft = getInitialBrandPresetDraft(state.activeBrandPresetId);
}
if (_savedSession?.compPage) {
  applyCompAnalysisSnapshot(_savedSession.compPage, state.compPage.subStep || 'input');
}

let gemini = null;
const factoryLiveInputDraft = {
  productName: null,
  naturalHint: null,
};

// ════════════════════════════════════════════════════════════════
// RENDER ENGINE
// ════════════════════════════════════════════════════════════════
function morphAttrMap(node) {
  const map = new Map();
  if (!node?.attributes) return map;
  Array.from(node.attributes).forEach(attr => map.set(attr.name, attr.value));
  return map;
}

function shouldReplaceNode(current, next) {
  if (!current || !next) return true;
  if (current.nodeType !== next.nodeType) return true;
  if (current.nodeType !== Node.ELEMENT_NODE) return false;
  if (current.tagName !== next.tagName) return true;
  const currentKey = current.getAttribute('data-render-key') || current.id || '';
  const nextKey = next.getAttribute('data-render-key') || next.id || '';
  return !!(currentKey && nextKey && currentKey !== nextKey);
}

function syncFormElementState(current, next) {
  if (!(current instanceof HTMLElement) || !(next instanceof HTMLElement)) return;
  const active = document.activeElement === current;
  if (current instanceof HTMLInputElement) {
    if (current.type === 'checkbox' || current.type === 'radio') {
      current.checked = next.checked;
    } else if (!active) {
      current.value = next.value;
    }
    return;
  }
  if (current instanceof HTMLTextAreaElement) {
    if (!active) current.value = next.value;
    return;
  }
  if (current instanceof HTMLSelectElement) {
    if (!active) current.value = next.value;
  }
}

function morphAttributes(current, next) {
  const currentAttrs = morphAttrMap(current);
  const nextAttrs = morphAttrMap(next);
  currentAttrs.forEach((_, name) => {
    if (!nextAttrs.has(name)) current.removeAttribute(name);
  });
  nextAttrs.forEach((value, name) => {
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  });
  syncFormElementState(current, next);
}

function morphNode(current, next) {
  if (shouldReplaceNode(current, next)) {
    current.replaceWith(next.cloneNode(true));
    return;
  }
  if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  morphAttributes(current, next);
  if (current instanceof HTMLCanvasElement || current.tagName === 'IFRAME' || current.tagName === 'VIDEO') return;
  morphChildren(current, next);
}

function topLevelRenderKey(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
  return node.getAttribute('data-render-key') ||
    node.id ||
    Array.from(node.classList || []).find(Boolean) ||
    node.tagName;
}

function morphChildren(currentParent, nextParent) {
  const nextNodes = Array.from(nextParent.childNodes);
  let current = currentParent.firstChild;
  const reconcileByTopLevelKey = currentParent.id === 'app';
  nextNodes.forEach(nextNode => {
    if (!current) {
      currentParent.appendChild(nextNode.cloneNode(true));
      return;
    }
    if (reconcileByTopLevelKey && nextNode.nodeType === Node.ELEMENT_NODE && current.nodeType === Node.ELEMENT_NODE) {
      const nextKey = topLevelRenderKey(nextNode);
      const currentKey = topLevelRenderKey(current);
      if (nextKey && currentKey && nextKey !== currentKey) {
        let match = current.nextSibling;
        while (match && topLevelRenderKey(match) !== nextKey) match = match.nextSibling;
        if (match) {
          currentParent.insertBefore(match, current);
          morphNode(match, nextNode);
        } else {
          currentParent.insertBefore(nextNode.cloneNode(true), current);
        }
        return;
      }
    }
    const following = current.nextSibling;
    morphNode(current, nextNode);
    current = following;
  });
  while (current) {
    const following = current.nextSibling;
    current.remove();
    current = following;
  }
}

function patchAppHtml(app, html) {
  if (!app.childNodes.length) {
    app.innerHTML = html;
    return;
  }
  const template = document.createElement('template');
  template.innerHTML = html;
  morphChildren(app, template.content);
}

function shouldDeferFactoryWizardFullRender() {
  if (typeof document === 'undefined' || state.step !== 'factory') return false;
  const active = document.activeElement;
  if (!active || typeof active.closest !== 'function') return false;
  const inWizard = active.closest('#factoryAutomationWizard');
  const isWizardEditor = !!inWizard && (
    active.matches?.('input, textarea, select, [contenteditable="true"]') ||
    active.closest('[contenteditable="true"]')
  );
  if (!isWizardEditor) return false;
  const factory = typeof factoryRuntimeReadFactory === 'function' ? factoryRuntimeReadFactory() : state.factory;
  if (factory?.automation?.fieldCommitInProgress) return false;
  if (active.matches?.('[data-factory-wizard-field]') && typeof factorySetAutomationWizardFieldDraft === 'function') {
    try { factorySetAutomationWizardFieldDraft(active); } catch(_) {}
  }
  return true;
}

function renderWorkspaceAuthorityBanner() {
  const authority = currentWorkspaceAuthority();
  if (!authority?.scopeId) return '';
  const labels = {
    editing: ['편집 가능', '이 창이 현재 작업의 편집권을 가지고 있습니다.'],
    readonly: ['읽기 전용', authority.reason || '다른 창에서 이 작업을 편집 중입니다.'],
    'offline-edit': ['로컬 초안', '새 작업은 서버 연결 없이 이 창에서 편집\u00a0가능합니다.'],
    acquiring: ['편집권 확인 중', '현재 작업의 편집권을 확인하고 있습니다.'],
    available: ['편집권 없음', '상태를 새로고침하거나 편집권을 가져오세요.'],
    released: ['편집권 반납됨', authority.reason || '이 창은 현재 작업을 편집하지 않습니다.'],
  };
  const [label, description] = labels[authority.mode] || ['작업 상태 확인', authority.reason || '현재 작업의 편집 상태를 확인하세요.'];
  const owner = authority.ownerId
    ? `<span class="workspace-authority-owner" title="${escAttr(`편집 창: ${authority.ownerId}`)}">${escapeHtml(`편집 창: ${authority.ownerId}`)}</span>`
    : '';
  const editing = authority.mode === 'editing';
  const readonly = authority.mode === 'readonly';
  const acquiring = authority.mode === 'acquiring';
  const offlineDraft = authority.mode === 'offline-edit' || /^draft:/i.test(String(authority.scopeId || ''));
  const takeoverDisabled = editing || acquiring || offlineDraft;
  const takeoverTitle = offlineDraft
    ? '로컬 초안은 서버 편집권 인계 대상이 아닙니다.'
    : (editing
      ? '이 창이 이미 편집권을 가지고 있습니다.'
      : (acquiring ? '편집권 확인이 끝날 때까지 기다려 주세요.' : '다른 창의 편집권을 이 창으로 가져옵니다.'));
  const readonlyTitle = acquiring
    ? '편집권 확인이 끝날 때까지 기다려 주세요.'
    : (readonly ? '이 창은 이미 읽기 전용입니다.' : '현재 작업을 읽기 전용으로 엽니다.');
  const transitionTitle = acquiring ? '편집권 확인이 끝날 때까지 기다려 주세요.' : '';
  return `<section class="workspace-authority-banner" data-mode="${escAttr(authority.mode)}" role="status" aria-live="polite">
    <div class="workspace-authority-copy">
      <strong>${escapeHtml(label)}</strong>
      <span class="workspace-authority-description">${escapeHtml(description)}</span>
      ${owner}
    </div>
    <div class="workspace-authority-actions">
      <button class="btn-sm" type="button" data-workspace-authority-action="refresh" title="${escAttr(transitionTitle)}" ${acquiring ? 'disabled aria-disabled="true"' : ''}>상태 새로고침</button>
      <button class="btn-sm" type="button" data-workspace-authority-action="readonly" title="${escAttr(readonlyTitle)}" ${readonly || acquiring ? 'disabled aria-disabled="true"' : ''}>읽기 전용으로 열기</button>
      <button class="btn-sm" type="button" data-workspace-authority-action="save-copy" title="${escAttr(transitionTitle)}" ${acquiring ? 'disabled aria-disabled="true"' : ''}>새 작업으로 저장</button>
      <button class="btn-sm primary" type="button" data-workspace-authority-action="takeover" title="${escAttr(takeoverTitle)}" ${takeoverDisabled ? 'disabled aria-disabled="true"' : ''}>편집권 가져오기</button>
    </div>
  </section>`;
}

const runtimeMenuModules = new Map();
let shellRuntimeComposition = null;
let classicRuntimeHydrationActive = true;
let classicRuntimeHydrationReady = false;
let classicRuntimeInitialRenderComplete = false;
let classicRuntimeBatchWorkerMode = false;
let factoryRuntimeStartTab = null;
let factoryRuntimeDbTab = null;
let factoryRuntimeFieldsTab = null;
let factoryRuntimeCompetitorTab = null;
let factoryRuntimeAssetsTab = null;
let factoryRuntimeSectionsTab = null;
let factoryRuntimePublishTab = null;

function createRuntimeMenuRegistryAdapter(menuModules) {
  if (!(menuModules instanceof Map)) throw new TypeError('runtime menu modules must be a Map');
  return Object.freeze({
    getByRoute(route) {
      return menuModules.get(String(route || '').trim()) || null;
    },
  });
}

function renderRuntimeMenuActivation({ root, route, menu, snapshot } = {}) {
  if (!root || typeof menu?.render !== 'function') {
    throw new TypeError('runtime menu activation requires root and menu render');
  }
  const normalizedRoute = String(route || '').trim();
  if (!normalizedRoute) throw new TypeError('runtime menu activation route is required');
  state.step = normalizedRoute;
  return renderShellFrame({
    root,
    menu,
    activeMenuHtml: renderActiveRuntimeMenu(menu, snapshot),
  });
}

function installShellRuntimeComposition(moduleNamespaces) {
  if (shellRuntimeComposition) return shellRuntimeComposition;
  const createRenderLifecycleCoordinator = moduleNamespaces['src/shell/render-lifecycle.mjs']?.createRenderLifecycleCoordinator;
  const createRouteController = moduleNamespaces['src/shell/route-controller.mjs']?.createRouteController;
  const createLegacyDiagnosticBridge = moduleNamespaces['src/shell/legacy-diagnostic-bridge.mjs']?.createLegacyDiagnosticBridge;
  const descriptorRegistry = moduleNamespaces['src/modules/module-registry.mjs']?.moduleRegistry;
  if (typeof createRenderLifecycleCoordinator !== 'function'
    || typeof createRouteController !== 'function'
    || typeof createLegacyDiagnosticBridge !== 'function'
    || typeof descriptorRegistry?.list !== 'function') {
    throw new Error('shell runtime modules are incomplete');
  }
  const root = document.getElementById('app');
  const registry = createRuntimeMenuRegistryAdapter(runtimeMenuModules);
  const sidebarDescriptors = descriptorRegistry.list('sidebar');
  if (sidebarDescriptors.length !== 13 || sidebarDescriptors.some(item => !registry.getByRoute(item.id))) {
    throw new Error('shell runtime sidebar registry is incomplete');
  }
  const renderLifecycle = createRenderLifecycleCoordinator({
    root,
    render: renderRuntimeMenuActivation,
  });
  const routeController = createRouteController({
    registry,
    renderLifecycle,
    routeGate: getNavGateInfo,
  });
  const diagnosticBridge = createLegacyDiagnosticBridge({
    store: Object.freeze({
      snapshot() { return factoryRuntimeRequireStore().getSnapshot(); },
    }),
    root: window,
  });
  shellRuntimeComposition = Object.freeze({
    diagnosticBridge,
    renderLifecycle,
    routeController,
  });
  diagnosticBridge.install();
  return shellRuntimeComposition;
}

function currentRuntimeMenuOperationToken() {
  const authority = currentWorkspaceAuthority();
  const authorityScope = String(authority?.scopeId || '').trim();
  const fallbackScope = state.currentProjectId
    ? `project:${String(state.currentProjectId).trim()}`
    : 'draft:unscoped';
  return [authorityScope || fallbackScope, authority?.fencingToken].join(':');
}

function factoryRuntimeDetachedValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  if (seen.has(value)) throw new TypeError('factory runtime snapshot must not contain cycles');
  if (value instanceof Date) return value.toISOString();
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map(item => factoryRuntimeDetachedValue(item, seen));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) throw new TypeError(`factory runtime snapshot field must be data: ${key}`);
    result[key] = factoryRuntimeDetachedValue(descriptor.value, seen);
  }
  seen.delete(value);
  return result;
}

function factoryRuntimeFreezeDetachedValue(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) factoryRuntimeFreezeDetachedValue(child, seen);
  return Object.freeze(value);
}

var factoryRuntimeOwnedRenderDraft = null;
var factoryRuntimeOwnedRenderLeases = [];
const FACTORY_RUNTIME_OWNED_RENDER_COMMANDS = new Set([
  'factory/runtime:updateFromInputs',
  'factory/runtime:preserveDetailHtml',
  'factory/runtime:saveSnapshotMetadata',
]);
const FACTORY_RUNTIME_DEFER_DURING_OPERATION_COMMANDS = new Set([
  'factory/runtime:updateFromInputs',
  'factory/runtime:preserveDetailHtml',
  'factory/runtime:saveSnapshotMetadata',
  'factory/runtime:setCafe24OAuthAutoRefreshStatus',
  'factory/runtime:log',
  'factory/runtime:completeVisualValidation',
  'factory/runtime:clearForeignCompetitorRunCount',
  'factory/runtime:refreshLocalArchiveAssets',
  'factory/runtime:restoreLocalArchiveToCurrentWork',
  'factory/archive:completeWorkfileBootstrap',
  'factory/assets:clearRestoredImageGenerationRuntime',
  'factory/db:clearRestoredCandidateRuntime',
]);
const FACTORY_RUNTIME_BACKGROUND_HYDRATE_REASONS = new Set([
  'product-image-backup-restore',
  'session-assets-payload',
]);
const FACTORY_RUNTIME_QUEUE_DURING_OPERATION_COMMANDS = new Set([
  'factory/runtime:adoptWorkspaceIdentity',
  'factory/cafe24:rerank-candidates',
  'factory/cafe24:apply-db-candidate',
  'factory/cafe24:apply-cafe24-candidate',
  'factory/cafe24:refresh-selected-cafe24-candidate',
  'factory/optionsorter:sendResultsToFactory',
]);
var factoryRuntimeDeferredOperationQueue = [];
var factoryRuntimeDeferredOperationTimer = null;
var factoryRuntimeDeferredOperationDrain = null;
var factoryRuntimeDeferredOperationWaiters = [];
const FACTORY_RUNTIME_DEFERRED_OPERATION_RETRY_MS = 50;
const FACTORY_RUNTIME_DEFERRED_OPERATION_INTERNAL_DRAIN = Symbol('factory-runtime-deferred-operation-drain');
const FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL = Symbol('factory-runtime-operation-lease');

function factoryRuntimeDeferredOperationsPending() {
  return factoryRuntimeDeferredOperationDrain !== null || factoryRuntimeDeferredOperationQueue.length > 0;
}

function factoryRuntimeResolveDeferredOperationWaiters() {
  if (factoryRuntimeDeferredOperationsPending()) return;
  const waiters = factoryRuntimeDeferredOperationWaiters.splice(0);
  waiters.forEach(resolve => resolve());
}

function factoryRuntimeScheduleDeferredOperationRetry() {
  if (factoryRuntimeDeferredOperationTimer !== null) return;
  factoryRuntimeDeferredOperationTimer = setTimeout(() => {
    factoryRuntimeDeferredOperationTimer = null;
    factoryRuntimeFlushDeferredOperations();
  }, FACTORY_RUNTIME_DEFERRED_OPERATION_RETRY_MS);
}

function factoryRuntimeFlushDeferredOperations() {
  if (factoryRuntimeDeferredOperationDrain || !factoryRuntimeDeferredOperationQueue.length) {
    if (!factoryRuntimeDeferredOperationDrain && !factoryRuntimeDeferredOperationQueue.length) {
      factoryRuntimeResolveDeferredOperationWaiters();
    }
    return factoryRuntimeDeferredOperationDrain;
  }
  if (factoryRuntimeDeferredOperationTimer !== null) {
    clearTimeout(factoryRuntimeDeferredOperationTimer);
    factoryRuntimeDeferredOperationTimer = null;
  }
  const drain = (async () => {
    while (factoryRuntimeDeferredOperationQueue.length) {
      const store = factoryRuntimeStore;
      if (!store) {
        while (factoryRuntimeDeferredOperationQueue.length) {
          factoryRuntimeDeferredOperationQueue.shift().resolve(false);
        }
        return;
      }
      let leaseActive = false;
      try {
        leaseActive = store.hasActiveOperationLease();
      } catch (_) {
        while (factoryRuntimeDeferredOperationQueue.length) {
          factoryRuntimeDeferredOperationQueue.shift().resolve(false);
        }
        return;
      }
      if (leaseActive) {
        factoryRuntimeScheduleDeferredOperationRetry();
        return;
      }
      const item = factoryRuntimeDeferredOperationQueue.shift();
      let current = false;
      try {
        current = item.store === store && store.isOperationCurrent(item.operationToken);
      } catch (_) {}
      if (!current) {
        item.resolve(false);
        continue;
      }
      try {
        if (item.kind === 'lease') {
          const result = await Promise.resolve(item.execute());
          let stillCurrent = false;
          try {
            stillCurrent = item.store === factoryRuntimeStore
              && item.store.isOperationCurrent(item.operationToken);
          } catch (_) {}
          item.resolve(stillCurrent ? result : false);
          continue;
        }
        const transaction = factoryRuntimeUpdateOwnedFactory(
          item.commandName,
          item.owner,
          item.mutator,
          FACTORY_RUNTIME_DEFERRED_OPERATION_INTERNAL_DRAIN,
        );
        const receipt = await Promise.resolve(transaction);
        let stillCurrent = false;
        try {
          stillCurrent = item.store === factoryRuntimeStore
            && item.store.isOperationCurrent(item.operationToken);
        } catch (_) {}
        item.resolve(stillCurrent ? receipt : false);
      } catch (error) {
        let stillCurrent = false;
        try {
          stillCurrent = item.store === factoryRuntimeStore
            && item.store.isOperationCurrent(item.operationToken);
        } catch (_) {}
        if (stillCurrent) item.reject(error);
        else item.resolve(false);
      }
    }
  })();
  factoryRuntimeDeferredOperationDrain = drain;
  Promise.resolve(drain).catch(() => undefined).finally(() => {
    if (factoryRuntimeDeferredOperationDrain === drain) factoryRuntimeDeferredOperationDrain = null;
    if (factoryRuntimeDeferredOperationQueue.length) factoryRuntimeScheduleDeferredOperationRetry();
    else {
      if (factoryRuntimeDeferredOperationTimer !== null) {
        clearTimeout(factoryRuntimeDeferredOperationTimer);
        factoryRuntimeDeferredOperationTimer = null;
      }
      factoryRuntimeResolveDeferredOperationWaiters();
    }
  });
  return drain;
}

function factoryRuntimeWaitForDeferredOperations() {
  factoryRuntimeFlushDeferredOperations();
  if (!factoryRuntimeDeferredOperationsPending()) return Promise.resolve();
  return new Promise(resolve => {
    factoryRuntimeDeferredOperationWaiters.push(resolve);
  });
}

function factoryRuntimeDeferOwnedFactoryUpdate(commandName, owner, mutator, store) {
  const operationToken = store.getOperationToken();
  let resolve;
  let reject;
  const transaction = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  factoryRuntimeDeferredOperationQueue.push({
    commandName, owner, mutator, operationToken, store, resolve, reject,
  });
  factoryRuntimeScheduleDeferredOperationRetry();
  return transaction;
}

function factoryRuntimeHasForeignOperationLease(excludedKey = '') {
  const store = factoryRuntimeStore;
  if (!store || typeof store.getActiveOperationLeaseKeys !== 'function') return false;
  const excluded = String(excludedKey || '').trim();
  return store.getActiveOperationLeaseKeys().some(key => String(key || '').trim() !== excluded);
}

function factoryRuntimeRenderWithOwnedDraft(factory, renderer = render) {
  if (!factory || typeof factory !== 'object') return renderer();
  const lease = { factory };
  factoryRuntimeOwnedRenderLeases.push(lease);
  factoryRuntimeOwnedRenderDraft = factoryRuntimeOwnedRenderLeases[0].factory;
  const release = () => {
    const leaseIndex = factoryRuntimeOwnedRenderLeases.indexOf(lease);
    if (leaseIndex >= 0) factoryRuntimeOwnedRenderLeases.splice(leaseIndex, 1);
    factoryRuntimeOwnedRenderDraft = factoryRuntimeOwnedRenderLeases[0]?.factory || null;
  };
  let result;
  try {
    result = renderer();
  } catch (error) {
    release();
    throw error;
  }
  if (result && typeof result.then === 'function') {
    return Promise.resolve(result).finally(release);
  }
  release();
  return result;
}

function factoryRuntimeReadFactory() {
  if (factoryRuntimeOwnedRenderDraft) return factoryRuntimeOwnedRenderDraft;
  return factoryRuntimeReadCommittedFactory();
}

function factoryRuntimeReadCommittedFactory() {
  if (factoryRuntimeStore) {
    const current = factoryRuntimeStore.getSnapshot()?.factory;
    return current && typeof current === 'object' ? current : Object.freeze({});
  }
  return factoryRuntimeFreezeDetachedValue(factoryRuntimeDetachedValue(
    factoryRuntimeBootstrapFactory || state.factory || {},
  ));
}

function factoryRuntimeCandidateRows(market = {}) {
  return [
    ...(Array.isArray(market.results) ? market.results : []),
    ...(Array.isArray(market.vmResults) ? market.vmResults : []),
    ...(Array.isArray(market.localResults) ? market.localResults : []),
    ...Object.values(market.groupedResults && typeof market.groupedResults === 'object' ? market.groupedResults : {})
      .flatMap(rows => Array.isArray(rows) ? rows : []),
    ...Object.values(market.vmGroupedResults && typeof market.vmGroupedResults === 'object' ? market.vmGroupedResults : {})
      .flatMap(rows => Array.isArray(rows) ? rows : []),
    ...Object.values(market.localGroupedResults && typeof market.localGroupedResults === 'object' ? market.localGroupedResults : {})
      .flatMap(rows => Array.isArray(rows) ? rows : []),
  ];
}

function factoryRuntimeResolveSelectedIdsForVisibleCandidates(canonicalMarket = {}, fallbackMarket = {}) {
  const canonicalRows = factoryRuntimeCandidateRows(canonicalMarket);
  const fallbackRows = factoryRuntimeCandidateRows(fallbackMarket);
  const canonicalSelectedIds = Array.isArray(canonicalMarket.selectedIds)
    ? canonicalMarket.selectedIds.map(String).filter(Boolean)
    : [];
  const fallbackSelectedIds = Array.isArray(fallbackMarket.selectedIds)
    ? fallbackMarket.selectedIds.map(String).filter(Boolean)
    : [];
  const selectedIds = Array.from(new Set([...canonicalSelectedIds, ...fallbackSelectedIds]));
  if (!selectedIds.length) return [];
  if (typeof compMarketSelectionIdsForVisibleRows === 'function') {
    return compMarketSelectionIdsForVisibleRows(
      selectedIds,
      [...canonicalRows, ...fallbackRows],
      canonicalRows.length ? canonicalRows : fallbackRows,
    );
  }
  const visibleIds = new Set(canonicalRows.map((row, index) => String(row?.id || row?.product_id || row?.product_url || `market_${index}`)));
  return selectedIds.filter(id => visibleIds.has(id));
}

function factoryRuntimeReadViewSnapshot() {
  const snapshot = factoryRuntimeRequireStore().getSnapshot();
  const rawFactory = factoryRuntimeOwnedRenderDraft
    ? factoryRuntimeFreezeDetachedValue(factoryRuntimeDetachedValue(factoryRuntimeOwnedRenderDraft))
    : snapshot.factory;
  const reconciledFactory = typeof factoryReconcilePersistedStageState === 'function'
    ? factoryReconcilePersistedStageState(rawFactory)
    : rawFactory;
  const factory = reconciledFactory === rawFactory
    ? rawFactory
    : factoryRuntimeFreezeDetachedValue(factoryRuntimeDetachedValue(reconciledFactory));
  const snapshotCompetitors = snapshot.competitors && typeof snapshot.competitors === 'object'
    ? snapshot.competitors
    : {};
  const canonicalCompPage = snapshotCompetitors.compPage && typeof snapshotCompetitors.compPage === 'object'
    ? snapshotCompetitors.compPage
    : null;
  const factoryCompPage = factory?.competitors?.compPage;
  const factoryMarket = factoryCompPage?.marketScrape && typeof factoryCompPage.marketScrape === 'object'
    ? factoryCompPage.marketScrape
    : null;
  const legacyCompPage = typeof state !== 'undefined'
    && state?.compPage && typeof state.compPage === 'object'
    ? state.compPage
    : null;
  const legacyMarket = legacyCompPage?.marketScrape && typeof legacyCompPage.marketScrape === 'object'
    ? legacyCompPage.marketScrape
    : null;
  let legacyVisibleImages = [];
  if (legacyMarket && Array.isArray(legacyMarket.scrapedImages) && legacyMarket.scrapedImages.length) {
    try {
      const currentScope = typeof compMarketCurrentWorkScope === 'function'
        ? compMarketCurrentWorkScope()
        : null;
      legacyVisibleImages = typeof compMarketFilterScrapedImagesForCurrentWork === 'function'
        && currentScope?.scopeKey
        ? compMarketFilterScrapedImagesForCurrentWork(legacyMarket.scrapedImages, currentScope, legacyMarket)
        : legacyMarket.scrapedImages;
    } catch (_) {
      legacyVisibleImages = [];
    }
  }
  const fallbackCompPage = !factoryMarket?.scrapedImages?.length && legacyVisibleImages.length
    ? {
        ...(factoryCompPage && typeof factoryCompPage === 'object' ? factoryCompPage : {}),
        marketScrape: { ...legacyMarket, scrapedImages: legacyVisibleImages },
      }
    : factoryCompPage && typeof factoryCompPage === 'object'
    ? factoryCompPage
    : canonicalCompPage;
  const fallbackMarket = fallbackCompPage?.marketScrape && typeof fallbackCompPage.marketScrape === 'object'
    ? fallbackCompPage.marketScrape
    : {};
  const canonicalMarket = canonicalCompPage?.marketScrape && typeof canonicalCompPage.marketScrape === 'object'
    ? canonicalCompPage.marketScrape
    : {};
  const candidateRowsOrFallback = (canonicalRows, fallbackRows) => {
    const canonicalList = Array.isArray(canonicalRows) ? canonicalRows : [];
    if (canonicalList.length) return canonicalList;
    return Array.isArray(fallbackRows) ? fallbackRows : [];
  };
  const candidateGroupsOrFallback = (canonicalGroups, fallbackGroups) => {
    const canonicalMap = canonicalGroups && typeof canonicalGroups === 'object' ? canonicalGroups : {};
    if (Object.values(canonicalMap).some(rows => Array.isArray(rows) && rows.length)) return canonicalMap;
    return fallbackGroups && typeof fallbackGroups === 'object' ? fallbackGroups : {};
  };
  const canonicalHasCandidateRows = [
    canonicalMarket.results,
    canonicalMarket.vmResults,
    canonicalMarket.localResults,
  ].some(rows => Array.isArray(rows) && rows.length)
    || Object.values(canonicalMarket.groupedResults || {}).some(rows => Array.isArray(rows) && rows.length)
    || Object.values(canonicalMarket.vmGroupedResults || {}).some(rows => Array.isArray(rows) && rows.length)
    || Object.values(canonicalMarket.localGroupedResults || {}).some(rows => Array.isArray(rows) && rows.length);
  const canonicalSelectionVersion = Math.max(0, Number(canonicalMarket.detailSelectionVersion || 0) || 0);
  const fallbackSelectionVersion = Math.max(0, Number(fallbackMarket.detailSelectionVersion || 0) || 0);
  const selectedIdsOrFallback = factoryRuntimeResolveSelectedIdsForVisibleCandidates(canonicalMarket, fallbackMarket);
  const compPage = canonicalCompPage && fallbackCompPage && canonicalCompPage !== fallbackCompPage
    ? {
        ...fallbackCompPage,
        ...canonicalCompPage,
        marketScrape: {
          ...fallbackMarket,
          ...canonicalMarket,
          results: candidateRowsOrFallback(canonicalMarket.results, fallbackMarket.results),
          vmResults: candidateRowsOrFallback(canonicalMarket.vmResults, fallbackMarket.vmResults),
          localResults: candidateRowsOrFallback(canonicalMarket.localResults, fallbackMarket.localResults),
          groupedResults: candidateGroupsOrFallback(canonicalMarket.groupedResults, fallbackMarket.groupedResults),
          vmGroupedResults: candidateGroupsOrFallback(canonicalMarket.vmGroupedResults, fallbackMarket.vmGroupedResults),
          localGroupedResults: candidateGroupsOrFallback(canonicalMarket.localGroupedResults, fallbackMarket.localGroupedResults),
          selectedIds: selectedIdsOrFallback,
          scrapedImages: Array.isArray(canonicalMarket.scrapedImages) && canonicalMarket.scrapedImages.length
            ? canonicalMarket.scrapedImages
            : (Array.isArray(fallbackMarket.scrapedImages) ? fallbackMarket.scrapedImages : []),
        },
      }
    : (canonicalCompPage || fallbackCompPage || {});
  if (!factoryRuntimeOwnedRenderDraft
      && compPage === snapshotCompetitors.compPage
      && factory === rawFactory) return snapshot;
  const viewCompPage = factoryRuntimeFreezeDetachedValue(factoryRuntimeDetachedValue(compPage));
  return Object.freeze({
    ...snapshot,
    factory,
    competitors: Object.freeze({ ...snapshotCompetitors, compPage: viewCompPage }),
  });
}

function factoryRuntimeNormalizeFactorySnapshot(value) {
  const imported = factoryRuntimeDetachedValue(value || {});
  const initialFactory = typeof normalizeFactoryState === 'function'
    ? normalizeFactoryState(imported)
    : imported;
  if (typeof repairRestoredDraftFactoryAssetWorkspaceScope === 'function') {
    repairRestoredDraftFactoryAssetWorkspaceScope(initialFactory);
  }
  if (typeof resolveRestoredCandidateReviewWorkspaceId === 'function'
      && typeof factoryRecoverRestoredReviewCandidateWorkspaceScope === 'function') {
    const restoredCandidateWorkspaceId = factoryWorkspaceIdentityFromSource(initialFactory).id;
    const restoredCandidateTargetWorkspaceId = resolveRestoredCandidateReviewWorkspaceId(
      restoredCandidateWorkspaceId,
      state.currentProjectId,
    );
    factoryRecoverRestoredReviewCandidateWorkspaceScope(
      initialFactory,
      restoredCandidateWorkspaceId,
      restoredCandidateTargetWorkspaceId,
      { productName: state.productName || initialFactory.product?.productName || '' },
    );
  }
  initialFactory.uiPanels = initialFactory.uiPanels && typeof initialFactory.uiPanels === 'object'
    ? initialFactory.uiPanels
    : {};
  return initialFactory;
}

function factoryRuntimeInitialSnapshot(factory = factoryRuntimeBootstrapFactory || state.factory || {}, options = {}) {
  const normalizedFactory = options.normalized === true
    ? factory
    : factoryRuntimeNormalizeFactorySnapshot(factory);
  const initialFactory = typeof factoryReconcilePersistedStageState === 'function'
    ? factoryReconcilePersistedStageState(normalizedFactory)
    : normalizedFactory;
  const product = initialFactory.product || {};
  const snapshot = {
    factory: initialFactory,
    productDb: { product },
    competitors: { compPage: state.compPage || {} },
    factoryAssets: {
      stages: initialFactory.stages || {},
      assets: initialFactory.assets || [],
      previousAssets: initialFactory.previousAssets || [],
      detailPlacement: initialFactory.detailPlacement || {},
    },
    detailDocument: {
      sectionContents: state.sectionContents || {},
      sectionImages: state.sectionImages || {},
      sectionInstructions: state.sectionInstructions || {},
    },
    cafe24: {
      selectedCandidateKey: product.selectedCafe24CandidateKey || product.cafe24DraftProductKey || '',
      syncResults: product.cafe24SyncResults || {},
      openMarketSync: initialFactory.openMarketSync || {},
    },
  };
  return options.detach === false ? snapshot : factoryRuntimeDetachedValue(snapshot);
}

function factoryRuntimeReplaceFactorySnapshot(value, options = {}) {
  let nextFactory = options.normalized === true
    ? value
    : factoryRuntimeNormalizeFactorySnapshot(value);
  if (!nextFactory || typeof nextFactory !== 'object') {
    throw new TypeError('factory snapshot must be an object');
  }
  if (options.mode === 'hydrate' && typeof factoryReconcilePersistedStageState === 'function') {
    nextFactory = factoryReconcilePersistedStageState(nextFactory);
  }
  if (!factoryRuntimeStore) {
    factoryRuntimeBootstrapFactory = factoryRuntimeDetachedValue(nextFactory);
    return factoryRuntimeBootstrapFactory;
  }
  const store = factoryRuntimeRequireStore();
  const operationToken = store.getOperationToken();
  const blocksBackgroundHydration = options.mode === 'hydrate'
    && !options.takeoverAuthority
    && FACTORY_RUNTIME_BACKGROUND_HYDRATE_REASONS.has(String(options.reason || ''))
    && store.hasActiveOperationLease();
  if (blocksBackgroundHydration) return store.getSnapshot().factory;
  if (options.operationToken && !store.isOperationCurrent(options.operationToken)) {
    throw factoryRuntimeStaleActionError(options.reason || 'factory-snapshot-import');
  }
  if (options.mode === 'hydrate') {
    const takeoverIdentity = options.takeoverAuthority
      ? workspaceTakeoverHydrationAuthority.assert(options.takeoverAuthority)
      : null;
    const workspaceId = String(
      options.workspaceId || state.currentProjectId || nextFactory.workspace?.id || operationToken.workspaceId,
    ).trim() || operationToken.workspaceId;
    const blankDraftReset = options.blankDraftReset === true
      && typeof workspaceBlankResetInProgress !== 'undefined'
      && workspaceBlankResetInProgress === true
      && /^draft:/.test(workspaceId)
      && !String(state.currentProjectId || '').trim();
    if (!blankDraftReset && options.restorePayload && typeof options.restorePayload === 'object') {
      nextFactory = factoryReconcileRestoredCompletionState(
        nextFactory,
        options.restorePayload,
      );
    }
    if (!takeoverIdentity && !blankDraftReset) {
      nextFactory = factoryPreserveProgressForSameWork(nextFactory, factoryRuntimeReadFactory());
    }
    if (!takeoverIdentity && !blankDraftReset) store.assertMutable('factory');
    const revision = operationToken.workspaceId === workspaceId ? operationToken.revision + 1 : 0;
    store.switchWorkspace(workspaceId, {
      snapshot: factoryRuntimeInitialSnapshot(nextFactory, { normalized: true, detach: false }),
      revision,
    });
  } else {
    store.replaceSnapshot({
      ...store.getSnapshot(),
      factory: nextFactory,
    }, { owner: 'factory', expectedRevision: operationToken.revision });
  }
  return store.getSnapshot().factory;
}

function factoryRuntimeUpdateOwnedFactory(commandName, owner, mutator, internalMode = null) {
  if (typeof mutator !== 'function') throw new TypeError('factory owned update requires a mutator');
  const store = factoryRuntimeStore ? factoryRuntimeRequireStore() : null;
  const isInternalMutation = internalMode === FACTORY_RUNTIME_DEFERRED_OPERATION_INTERNAL_DRAIN
    || internalMode === FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL;
  const queuesUntilIdle = FACTORY_RUNTIME_QUEUE_DURING_OPERATION_COMMANDS.has(commandName);
  const hasActiveLease = store?.hasActiveOperationLease() === true;
  if (
    store &&
    isInternalMutation &&
    commandName === 'factory/runtime:restoreLocalArchiveToCurrentWork' &&
    factoryRuntimeHasForeignOperationLease('factory-archive:restore-current-work')
  ) {
    return Object.freeze({
      snapshot: store.getSnapshot(),
      result: false,
      assignments: Object.freeze([]),
    });
  }
  if (store && !isInternalMutation && queuesUntilIdle
    && (hasActiveLease || factoryRuntimeDeferredOperationsPending())) {
    return factoryRuntimeDeferOwnedFactoryUpdate(commandName, owner, mutator, store);
  }
  if (!isInternalMutation && hasActiveLease && FACTORY_RUNTIME_DEFER_DURING_OPERATION_COMMANDS.has(commandName)) {
    return Object.freeze({
      snapshot: store.getSnapshot(),
      result: false,
      assignments: Object.freeze([]),
    });
  }
  if (factoryRuntimeOwnedRenderDraft && FACTORY_RUNTIME_OWNED_RENDER_COMMANDS.has(commandName)) {
    return Object.freeze({
      snapshot: Object.freeze({ factory: factoryRuntimeOwnedRenderDraft }),
      result: mutator(factoryRuntimeOwnedRenderDraft),
      assignments: Object.freeze([]),
    });
  }
  if (!store) {
    const factory = factoryRuntimeNormalizeFactorySnapshot(factoryRuntimeBootstrapFactory || state.factory || {});
    const result = mutator(factory);
    return Object.freeze({
      snapshot: Object.freeze({ factory: factoryRuntimeReplaceFactorySnapshot(factory) }),
      result,
      assignments: Object.freeze([]),
    });
  }
  const operationToken = store.getOperationToken();
  return store.updateDraft(
    mutator,
    { owner, expectedRevision: operationToken.revision },
    commandName,
    { rebaseOnStale: true },
  );
}

function factoryRuntimeUpdateOwnedFactoryDuringLease(commandName, owner, mutator) {
  return factoryRuntimeUpdateOwnedFactory(
    commandName,
    owner,
    mutator,
    FACTORY_RUNTIME_OPERATION_LEASE_INTERNAL,
  );
}

function factoryRuntimeWorkspaceId() {
  const authority = currentWorkspaceAuthority();
  const currentFactory = factoryRuntimeReadFactory();
  return String(state.currentProjectId || authority?.scopeId || currentFactory.workspace?.id || 'draft:factory').trim();
}

function factoryRuntimeRequireStore() {
  if (!factoryRuntimeStore) throw new Error('factory runtime store is not installed');
  return factoryRuntimeStore;
}

function factoryRuntimeIsOperationCurrent(operationToken) {
  if (typeof operationToken === 'string') {
    return operationToken === currentRuntimeMenuOperationToken();
  }
  return factoryRuntimeRequireStore().isOperationCurrent(operationToken);
}

function factoryRuntimeStaleActionError(actionName) {
  const error = new Error(`STALE_FACTORY_RUNTIME_ACTION: ${actionName}`);
  error.code = 'STALE_FACTORY_RUNTIME_ACTION';
  return error;
}

function factoryRuntimeCreateCommandPolicies() {
  const policies = {};
  const part = (owner, paths) => Object.freeze({ owner, paths: Object.freeze([...paths]) });
  const add = (names, coordinator, parts, targetPath = 'factory') => {
    for (const name of names) {
      if (policies[name]) throw new Error(`duplicate factory runtime command policy: ${name}`);
      policies[name] = Object.freeze({
        coordinator,
        targetPath,
        parts: Object.freeze([...parts]),
      });
    }
  };
  const factoryNavigation = part('factory', [
    'automation.activeTab', 'automation.activeTaskId', 'automation.lastWizardActionAt',
    'uiPanels.assets',
  ]);
  const factoryStart = part('factory', [
    'automation.activeTab', 'automation.activeTaskId', 'automation.confirmedTasks',
    'automation.skippedTasks', 'automation.startRunCounts', 'automation.lastWizardActionAt',
  ]);
  const factoryUpdatedAt = part('factory', ['automation.updatedAt']);
  const factoryFieldUpdatedAt = part('factory', [
    'automation.lastWizardActionAt', 'automation.updatedAt',
  ]);
  const factoryWorkflow = part('factory', [
    'automation', 'goalRun', 'logs', 'logStageId', 'activeStage', 'uiPanels',
  ]);
  const factoryWorkflowStatus = part('factory', [
    'goalRun', 'logs', 'logStageId', 'activeStage', 'uiPanels',
  ]);
  const factoryAssetStatus = part('factory', ['logs', 'logStageId', 'activeStage']);
  const factoryAssetLogStatus = part('factory', [
    'logs', 'logStageId',
    'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
  ]);
  const product = part('product-db', ['product']);
  const productDbUi = part('product-db', [
    'automation.dbSearchQuery', 'automation.fieldDrafts', 'automation.fieldReview',
    'automation.fieldCommitNotice', 'automation.fieldCommitInProgress',
    'automation.fieldTransfer',
  ]);
  const productDbSizeUi = part('product-db', ['automation.sizeFieldDrafts']);
  const candidateResolutionAssets = part('factory-assets', [
    'stages', 'automation.optionMode', 'automation.optionSourceSummary',
  ]);
  const competitors = part('competitors', [
    'automation.competitorPanelOpen', 'automation.competitorSelection',
  ]);
  const factoryAssets = part('factory-assets', [
    'stages', 'assets', 'previousAssets', 'detailPlacement', 'assetListExpanded',
    'previousAssetsExpanded', 'automation.sizeImageDbConfirmedKey',
    'automation.sizeImageDbConfirmedAt', 'automation.optionMode',
  ]);
  const factoryWorkflowAssets = part('factory-assets', [
    'stages', 'assets', 'previousAssets', 'detailPlacement', 'archive',
    'assetListExpanded', 'previousAssetsExpanded',
    'runtimeAssetPrunedAt', 'runtimeAssetPrunedCount',
  ]);
  const detailDocument = part('detail-document', [
    'automation.sectionPromptPlan',
  ]);
  const cafe24 = part('cafe24', [
    'openMarketSync', 'uiPanels.materials',
  ]);
  const openMarketWorkflow = Object.freeze([
    part('cafe24', ['openMarketSync']),
    part('product-db', ['product']),
    part('factory-assets', [
      'stages', 'assets', 'previousAssets', 'detailPlacement', 'archive',
      'assetListExpanded', 'previousAssetsExpanded',
    ]),
    part('factory', ['goalRun', 'logs', 'logStageId', 'activeStage']),
  ]);
  const candidateApplyWorkflow = Object.freeze([
    ...openMarketWorkflow,
    part('product-db', ['automation.fieldReview']),
    part('factory-assets', [
      'automation.lastAutoSizeRunKey', 'automation.optionMode',
      'automation.optionSourceSummary', 'automation.sizeAutoRunRunning',
      'automation.sizeAutofillNotice', 'automation.sizeImageDbConfirmedKey',
    ]),
  ]);
  const candidateCollectionWorkflow = Object.freeze([
    ...candidateApplyWorkflow,
    part('factory', [
      'automation.parallelProgress',
      'automation.candidateSearchProgress',
    ]),
  ]);
  const finalRegistrationWorkflow = Object.freeze([
    ...openMarketWorkflow,
    // 기본정보 확정은 필드 확정과 같은 자리를 쓴다. 임시값·검토 기록만 열어 두면 확정
    // 알림과 마지막 작업 시각에서 경로가 거절돼 최종 등록이 통째로 멈춘다. 실측:
    // FACTORY_COMMAND_PATH_REJECTED: ...apply-basic-info:automation.lastWizardActionAt
    productDbUi,
    factoryFieldUpdatedAt,
  ]);
  const persistenceMetadata = part('factory', ['cafe24FieldView', 'lastSavedAt']);
  const workspaceIdentity = part('factory', [
    // productName 은 작업 신원 검사가 읽는 값이다. 여기 없으면 새 제품으로 바뀌지 않아
    // 앞 제품 이름이 남고, 두 번째 제품의 작업파일 저장이 통째로 막힌다.
    'workIdentity', 'workspace', 'currentProjectId', 'currentProjectName', 'productName',
  ]);
  const explicitWorkIdentityTransition = part('factory', [
    'workIdentity', 'automation.workIdentityTransition',
  ]);
  const workspaceScopedAssets = part('factory-assets', ['assets', 'previousAssets', 'archive.localAssets']);
  const workspaceScopedProduct = part('product-db', [
    'product.competitors', 'product.dbCandidates', 'product.pendingDbCandidates',
    'product.cafe24Candidates', 'product.pendingCafe24Candidates',
  ]);

  add(['factory/runtime:saveSnapshotMetadata'], 'factory', [persistenceMetadata]);
  add(['factory/runtime:sealWorkIdentity'], 'factory', [
    part('factory', ['workIdentity']),
    part('product-db', ['product.inputImageFingerprint']),
  ]);
  add(['factory/runtime:updateWorkspaceIdentity'], 'factory', [workspaceIdentity]);
  add(
    ['factory/runtime:adoptWorkspaceIdentity'],
    'composition',
    [workspaceIdentity, workspaceScopedAssets, workspaceScopedProduct],
  );
  add(['factory/control:prepareProduct'], 'factory', [
    workspaceIdentity,
    product,
    productDbUi,
    factoryNavigation,
    part('factory-assets', ['stages.db']),
    part('factory', [
      'batchJobId', 'goalRun', 'logs', 'logStageId',
      'automation.workIdentityTransition', 'automation.optionMode', 'automation.optionSourceSummary',
    ]),
  ]);
  add(['factory/control:workfileCreated'], 'factory', [workspaceIdentity]);
  add(['factory/runtime:removeCustomDbField'], 'product-db', [
    product,
    part('factory', ['logs', 'logStageId']),
  ]);
  add(['factory/runtime:setDbFieldManualValue'], 'product-db', [product, productDbUi]);
  add(['factory/runtime:setCurrentProductIdentity'], 'product-db', [product, productDbUi]);
  add(['factory/runtime:clearForeignCompetitorRunCount'], 'factory', [
    part('factory', ['automation.startRunCounts.competitors']),
  ]);
  add(['factory/runtime:log'], 'factory', [
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
    part('factory-assets', ['stages.db.status', 'stages.db.message']),
  ]);
  add(['factory/runtime:setStageStatus'], 'factory-assets', [
    part('factory-assets', ['stages']),
    part('factory', ['activeStage', 'logStageId']),
  ]);
  add(['factory/runtime:rememberPreviousAsset'], 'factory-assets', [
    part('factory-assets', ['previousAssets']),
  ]);
  add(['factory/runtime:registerAsset'], 'factory-assets', [
    part('factory-assets', ['assets', 'stages', 'previousAssets']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/runtime:completeRegisteredAssetArchive'], 'factory-assets', [
    part('factory-assets', ['assets', 'archive']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/runtime:updateFromInputs'], 'factory', [
    product,
    part('product-db', ['automation.dbSearchQuery']),
    part('cafe24', ['openMarketSync']),
    part('factory-assets', ['stages']),
    part('factory', ['goalRun.targets', 'goalRun.maxLoops', 'goalRun.mode']),
  ]);
  add(['factory/runtime:apply-product-to-app'], 'product-db', [product]);
  add(['factory/runtime:apply-latest-to-analysis'], 'product-db', [
    product,
    part('factory-assets', ['stages.db']),
    part('factory', [
      'activeStage', 'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/runtime:sync-current-state'], 'factory-assets', [
    product,
    part('factory-assets', ['stages', 'assets', 'previousAssets', 'detailPlacement']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add([
    'factory/db:setSizeManualDraft',
    'factory/db:commitSizeManualDraft',
  ], 'product-db', [product, productDbUi, productDbSizeUi, factoryUpdatedAt]);
  add(['factory/db:applyWizardSearchQuery'], 'product-db', [
    product,
    part('product-db', ['automation.dbSearchQuery']),
    part('factory', [
      'automation.activeTab', 'automation.activeTaskId',
      'automation.lastWizardActionAt', 'automation.updatedAt',
    ]),
  ]);
  add(['factory/db:add-custom-field'], 'product-db', [
    product,
    part('factory-assets', ['stages.db.status', 'stages.db.message']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/db:apply-final-db'], 'product-db', [
    product,
    part('factory-assets', ['stages.db']),
    part('factory', [
      'activeStage', 'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add([
    'factory/db:save-field-preset',
    'factory/db:apply-field-preset',
  ], 'product-db', [
    product,
    part('factory-assets', ['stages.db.status', 'stages.db.message']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/runtime:clearHeroDetailPlacements'], 'factory-assets', [
    part('factory-assets', ['assets', 'detailPlacement']),
    part('factory', ['logs', 'logStageId']),
  ]);
  add(['factory/runtime:preserveDetailHtml'], 'factory-assets', [
    part('factory-assets', ['stages', 'assets', 'previousAssets']),
    part('factory', ['logs', 'logStageId']),
  ]);
  add(['factory/runtime:archiveCurrentInputImage'], 'factory-assets', [
    part('factory-assets', ['assets', 'archive', 'runtimeAssetPrunedAt', 'runtimeAssetPrunedCount']),
    part('factory', ['logs', 'logStageId']),
  ]);
  add([
    'factory/source:ensureLockedInput',
    'factory/source:promoteStoredProductInput',
  ], 'factory-assets', [
    factoryWorkflow, product, factoryWorkflowAssets,
  ]);
  add(['factory/source:setInputArchiveRestoreStatus'], 'factory-assets', [
    part('factory-assets', ['archive.localStatus']),
    factoryAssetLogStatus,
  ]);
  add(['factory/db:runCandidatesForSelection'], 'product-db', [
    factoryWorkflow, product, factoryWorkflowAssets,
  ]);
  add(['factory/db:setCandidateProgramState'], 'product-db', [
    factoryWorkflow, product,
  ]);
  add(['factory/db:clearRestoredCandidateRuntime'], 'product-db', [
    part('product-db', [
      'product.sinhwaDbProgramStatus',
      'product.cafe24ProgramStatus',
      'product.candidateReviewStatus',
    ]),
    part('factory-assets', ['stages.db']),
    part('factory', [
      'automation.candidateSearchProgress',
      'automation.parallelProgress',
    ]),
  ]);
  add([
    'factory/db:openCafe24OAuthLogin',
    'factory/db:setCafe24OAuthStatus',
  ], 'product-db', [product, factoryAssetLogStatus]);
  add(['factory/competitor:runVmCandidatesForSelection'], 'competitors', [
    factoryWorkflow, product, factoryWorkflowAssets,
    part('competitors', ['competitors']),
  ]);
  add(['factory/competitor:initializeDetailScope'], 'competitors', [
    factoryWorkflow, product,
  ]);
  add(['factory/db:runCurrentProductAnalysisOnly'], 'product-db', [
    factoryWorkflow, product, factoryWorkflowAssets,
  ]);
  add([
    'factory/automation:runAuto',
    'factory/automation:runGoalLoop',
  ], 'factory', [factoryWorkflow, product, factoryWorkflowAssets]);
  add(['factory/automation:stopGoalRun'], 'factory', [factoryWorkflow]);
  add(['factory/assets:handleRunStageButton'], 'factory', [
    factoryWorkflow, product, factoryWorkflowAssets,
  ]);
  add(['factory/competitor:runDetailCapture'], 'competitors', [
    factoryWorkflowStatus,
    part('factory', ['competitors']),
    part('factory-assets', ['stages.detail']),
  ]);
  add(['factory/competitor:syncDetailMarket'], 'competitors', [
    part('competitors', ['compPage']),
  ], 'competitors');
  add(['factory/competitor:syncRecoveredDetailProgress'], 'competitors', [
    part('factory-assets', ['stages.detail']),
  ]);
  add([
    'factory/assets:generateAllCuts',
    'factory/assets:generateAllSizeCuts',
  ], 'factory-assets', [factoryWorkflowStatus, product, factoryWorkflowAssets]);
  add(['factory/archive:completeWorkfileBootstrap'], 'factory-assets', [
    part('factory-assets', ['archive.stageRunIds', 'archive.localStatus', 'stages']),
  ]);
  add(['factory/archive:setPreviewCopyStatus'], 'factory-assets', [
    part('factory-assets', ['archive.localStatus']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/archive:setLocalShowAll'], 'factory-assets', [
    part('factory-assets', ['archive.localShowAll']),
  ]);
  add(['factory/archive:restoreDirectoryHandle'], 'factory-assets', [
    part('factory-assets', ['archive.folderName']),
  ]);
  add(['factory/archive:chooseDirectory'], 'factory-assets', [
    part('factory-assets', ['archive.folderName', 'archive.status']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/archive:setSessionDirectory'], 'factory-assets', [
    part('factory-assets', [
      'archive.folderName', 'archive.sessionFolderName', 'archive.status',
    ]),
  ]);
  add(['factory/archive:clearSkippedArchiveFailure'], 'factory-assets', [
    part('factory-assets', ['stages.export']),
  ]);
  add(['factory/runtime:refreshLocalArchiveAssets'], 'factory-assets', [
    factoryWorkflowAssets,
    part('factory', ['logs', 'logStageId']),
    part('product-db', [
      'product.lockedInputImageFingerprint',
      'product.currentUploadImageFingerprint',
      'product.inputImageFingerprint',
    ]),
  ]);
  add(['factory/runtime:completeVisualValidation'], 'factory-assets', [
    factoryWorkflowAssets, factoryWorkflowStatus,
  ]);
  add(['factory/runtime:syncProductImageAcrossWorkspaces'], 'factory-assets', [
    factoryWorkflow, product, factoryWorkflowAssets,
  ]);
  add([
    'factory/cafe24:load-db-input-snapshot',
    'factory/cafe24:delete-db-input-snapshot',
    'factory/cafe24:update-image-draft',
  ], 'cafe24', [
    product,
    part('factory', ['logs', 'logStageId']),
  ]);
  add(['factory/cafe24:update-form-drafts'], 'cafe24', [
    product,
    part('product-db', ['automation.fieldReview']),
    part('factory', ['logs', 'logStageId']),
  ]);
  add(['factory/cafe24:rerank-candidates'], 'cafe24', [
    product,
    part('factory-assets', ['stages']),
    part('factory', [
      'activeStage', 'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/db:schedule-size-cut-review'], 'factory-assets', [
    part('factory-assets', [
      'automation.lastAutoSizeRunKey', 'automation.sizeImageDbConfirmedKey',
      'automation.sizeAutoRunRunning', 'stages',
    ]),
    part('factory', [
      'activeStage', 'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add([
    'factory/runtime:loadLocalArchiveAsset',
    'factory/runtime:hydrateCafe24ImagesFromLocalArchive',
    'factory/runtime:restoreLocalArchiveToCurrentWork',
  ], 'factory-assets', openMarketWorkflow);
  add([
    'factory/openmarket:log', 'factory/openmarket:set-browser-automation',
    'factory/openmarket:set-browser-snapshot', 'factory/openmarket:check-browser',
    'factory/openmarket:launch-debug-chrome', 'factory/openmarket:open-normal-chrome',
    'factory/openmarket:restore-normal-login', 'factory/openmarket:submit-normal-login',
    'factory/openmarket:snapshot-page', 'factory/openmarket:read-detail-status',
    'factory/openmarket:read-category-fields', 'factory/openmarket:read-send-limit',
    'factory/openmarket:read-cafe24-linkage', 'factory/openmarket:run-send-limit-action',
    'factory/openmarket:apply-category-fields', 'factory/openmarket:wait-ready',
    'factory/openmarket:poll-results', 'factory/openmarket:safe-click-send',
    'factory/openmarket:add-channel', 'factory/openmarket:remove-channel',
    'factory/openmarket:refresh-connectors', 'factory/openmarket:build-drafts',
    'factory/openmarket:dry-run-draft', 'factory/openmarket:dry-run-all',
    'factory/openmarket:open-admin', 'factory/openmarket:start-send-flow',
    'factory/openmarket:save-channel-result', 'factory/openmarket:send-draft',
    'factory/openmarket:copy-guide',
    'factory/openmarket:event',
    'factory/final-registration:prepare-assets',
    'factory/final-registration:update-status',
  ], 'cafe24', openMarketWorkflow);
  add([
    'factory/final-registration:apply-basic-info',
    'factory/final-registration:run',
  ], 'cafe24', finalRegistrationWorkflow);
  add([
    'factory/cafe24:refresh-api-sources',
    'factory/cafe24:probe-endpoint-health',
    'factory/cafe24:refresh-reference-lists',
    'factory/cafe24:sync-product-images',
    'factory/cafe24:sync-additional-images',
    'factory/cafe24:publish-detail-html',
    'factory/cafe24:refresh-icons',
    'factory/cafe24:sync-icons',
    'factory/cafe24:sync-relations',
    'factory/cafe24:refresh-promotions',
    'factory/cafe24:refresh-seo-tags',
    'factory/cafe24:sync-seo',
    'factory/cafe24:sync-english-shop-name',
    'factory/cafe24:sync-tags',
    'factory/cafe24:refresh-memos',
    'factory/cafe24:sync-memo',
    'factory/cafe24:delete-memo',
    'factory/cafe24:refresh-main-products',
    'factory/cafe24:sync-main-product',
    'factory/cafe24:delete-main-product',
    'factory/cafe24:sync-category-link',
    'factory/cafe24:sync-options-variants',
    'factory/cafe24:run-option-context-match',
    'factory/cafe24:save-product',
    'factory/cafe24:rollback-single-field',
    'factory/cafe24:run-ready-sync',
    'factory/cafe24:run-post-create-sync',
    'factory/cafe24:use-test-product',
    'factory/cafe24:resume-exact-product',
    'factory/cafe24:set-market-sync',
    'factory/cafe24:create-product',
    'factory/cafe24:create-hidden-test',
    'factory/cafe24:flush-db-input-panel',
    'factory/cafe24:set-source-panels-collapsed',
    'factory/cafe24:save-db-input-snapshot',
  ], 'cafe24', openMarketWorkflow);
  add([
    'factory/cafe24:collect-product-candidates',
    'factory/cafe24:collect-cafe24-candidates',
    'factory/cafe24:collect-additional-cafe24-candidates',
    'factory/cafe24:run-candidate-additional-search',
    'factory/cafe24:run-candidate-search-only',
  ], 'cafe24', candidateCollectionWorkflow);
  add([
    'factory/cafe24:apply-db-candidate',
    'factory/cafe24:apply-cafe24-candidate',
    'factory/cafe24:refresh-selected-cafe24-candidate',
  ], 'cafe24', candidateApplyWorkflow);
  add(['factory/optionsorter:sendResultsToFactory'], 'factory-assets', [
    factoryAssets, factoryAssetStatus, factoryNavigation,
  ]);
  add(['factory/optionsorter:ensureArchiveStageRunId'], 'factory-assets', [
    part('factory-assets', [
      'archive.stageRunIds',
      'stages.options.currentRunId',
      'stages.options.latestGenerationRunId',
  ]),
  ]);
  add(['factory/optionsorter:archiveGeneratedResult'], 'factory-assets', [
    part('factory-assets', [
      'assets', 'previousAssets', 'archive', 'stages.options', 'stages.hero',
      'runtimeAssetPrunedAt', 'runtimeAssetPrunedCount',
    ]),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/assets:touchImageStageRun'], 'factory-assets', [
    part('factory-assets', ['stages.hero', 'stages.size', 'stages.cuts']),
  ]);
  add(['factory/assets:markImageStageTimeout'], 'factory-assets', [
    part('factory-assets', ['stages.hero', 'stages.size', 'stages.cuts']),
  ]);
  add(['factory/assets:clearRestoredImageGenerationRuntime'], 'factory-assets', [
    part('factory-assets', ['stages.hero', 'stages.size', 'stages.cuts']),
    part('factory', [
      'goalRun.running', 'goalRun.stopRequested',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
      'logs', 'logStageId',
    ]),
  ]);
  add(['factory/assets:restoreCutStageRunIdentity'], 'factory-assets', [
    part('factory-assets', ['stages.hero', 'stages.size', 'stages.cuts']),
  ]);
  add(['factory/assets:importImageCutResults'], 'factory-assets', [
    part('factory-assets', ['assets', 'previousAssets', 'stages']),
    part('factory', [
      'activeStage', 'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/assets:forceImportFreshCutResults'], 'factory-assets', [
    part('factory-assets', ['assets', 'previousAssets', 'stages']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/runtime:toggleUiPanel'], 'factory', [
    part('factory', ['uiPanels']),
  ]);
  add(['factory/db:setCafe24AdvancedPanelOpen'], 'product-db', [
    part('product-db', ['product.cafe24AdvancedOpen']),
  ]);
  add(['factory/runtime:setCafe24OAuthAutoRefreshStatus'], 'product-db', [
    part('product-db', ['product.cafe24OAuthStatus']),
    part('factory', [
      'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);

  add(['factory:selectFactoryTab'], 'factory', [factoryNavigation, factoryUpdatedAt]);
  add(['factory:jumpFactoryStage'], 'factory', [
    factoryNavigation,
    factoryUpdatedAt,
    part('factory', ['activeStage']),
  ]);
  add(['factory:setFactoryStageLogFilter'], 'factory', [
    part('factory', ['stageLogFilter']),
  ]);
  add([
    'factory/start:setStartCount', 'factory/start:confirmTask', 'factory/start:skipTask',
  ], 'factory', [factoryStart, factoryUpdatedAt]);
  add(['factory/start:setProductName'], 'factory', [
    product,
    part('product-db', ['automation.dbSearchQuery']),
    explicitWorkIdentityTransition,
  ]);
  add(['factory/start:setNaturalHint'], 'factory', [product]);
  add(['factory/start:promoteStoredProductImage'], 'factory', [
    factoryWorkflow, product, factoryWorkflowAssets,
  ]);
  add(['factory/start:setProductImage'], 'factory', [
    product,
    factoryWorkflowAssets,
    factoryAssetStatus,
    explicitWorkIdentityTransition,
    part('cafe24', ['openMarketSync']),
    part('factory', [
      'automation.currentRunId', 'automation.currentRunStartedAt',
      'goalRun.currentRunId',
    ]),
  ]);
  // ★ competitors 를 빠뜨리면 **수집에 성공할수록 전부 잃는다.**
  //   이 흐름은 경쟁사 수집이 성공했을 때만 factory.competitors.compPage 에 쓴다
  //   (app-core-06.js 의 factorySyncCompetitorMarketToOwnedFactory).
  //   그 경로가 정책에 없으면 커밋 순간 FACTORY_COMMAND_PATH_REJECTED 가 나고
  //   드래프트가 통째로 폐기된다 — 후보 19건, 실행번호, 실행 상태, 단계, 로그까지 함께.
  //   화면에는 시장 결과만 남는데 그건 작업 밖(state.compPage)에 있기 때문이다.
  //   실측 2026-08-30: 바로 이것 때문에 "수집 19건인데 작업 반영 0건" 이었다.
  //   같은 함수를 단독으로 부르는 factory/competitor:runVmCandidatesForSelection 에는
  //   이 part 가 있어서 '다시 수집' 버튼만 되고 파란 시작 버튼은 안 됐다.
  add(['factory/start:runDb'], 'factory', [
    factoryWorkflow,
    product,
    factoryWorkflowAssets,
    part('cafe24', ['openMarketSync']),
    part('competitors', ['competitors']),
  ]);

  // 아래 둘도 같은 흐름을 타므로 같은 경로가 필요하다.
  // rerunDbVmOnly 는 stages 까지 빠져 있었다(factorySetStageStatus('db', ...) 를 쓴다).
  add(['factory/db:rerunDbVmOnly'], 'product-db', [
    factoryWorkflow, product, factoryWorkflowAssets,
    part('competitors', ['competitors']),
  ]);
  add(['factory/db:runDb'], 'product-db', [
    factoryWorkflow, product, factoryWorkflowAssets,
    part('cafe24', ['openMarketSync']),
    part('competitors', ['competitors']),
  ]);

  add([
    'factory/db:rerunDbQuery', 'factory/db:rerunCafe24Query', 'factory/db:appendCafe24Query',
    'factory/db:resetDbQuery',
    'factory/db:setDbSearchQuery', 'factory/db:commitDbSearchQuery',
    'factory/db:applyDbCandidate', 'factory/db:applyCafe24Candidate',
  ], 'product-db', [product, productDbUi, factoryNavigation, factoryUpdatedAt]);
  add([
    'factory/db:confirmNoDbCandidate', 'factory/db:confirmNoCafe24Candidate',
    'factory/db:restoreDetachedDbSelection', 'factory/db:discardDetachedDbSelection',
    'factory/db:clearDbCandidateSelection', 'factory/db:clearCafe24CandidateSelection',
  ], 'product-db', [
    product, productDbUi, factoryNavigation, factoryUpdatedAt,
    candidateResolutionAssets, factoryAssetStatus,
  ]);
  add([
    'factory/db:startSinhwaDbAndRerun',
    'factory/db:startCafe24ControlAndRerun',
  ], 'product-db', [factoryWorkflow, product]);
  add([
    'factory/db:cafe24OauthStart',
    'factory/db:cafe24OauthStatusRefreshAndRerun',
  ], 'product-db', [product, factoryAssetLogStatus]);

  add([
    'factory/fields:setFieldDraft', 'factory/fields:commitField',
    'factory/fields:commitAllFields', 'factory/fields:editField',
  ], 'product-db', [product, productDbUi, factoryFieldUpdatedAt]);
  add([
    'factory/fields:setFieldTransferSelection', 'factory/fields:clearFieldTransferSelection',
  ], 'product-db', [productDbUi]);
  add([
    'factory/fields:executeSelectedFieldTransfer',
  ], 'product-db', [product, productDbUi, factoryAssetLogStatus]);
  add([
    'factory/fields:guide:go-tab:assets', 'factory/fields:guide:open-field-review',
    'factory/fields:guide:focus-missing-field-source', 'factory/fields:guide:run-size-now',
  ], 'product-db', [product, productDbUi, factoryNavigation, factoryAssets, factoryUpdatedAt]);
  add([
    'factory/fields:guide:mark-no-options', 'factory/fields:guide:mark-options-match',
    'factory/fields:uploadOptionColor',
  ], 'product-db', [product, productDbUi, factoryAssets, factoryAssetStatus, factoryUpdatedAt]);

  add([
    'factory/competitor:guide:toggle-competitor-panel',
    'factory/competitor:guide:open-competitor',
    'factory/competitor:guide:go-tab:sections',
    'factory/competitor:guide:go-tab:competitor',
    'factory/competitor:guide:focus-competitor-images',
    'factory/competitor:guide:open-competitor-report',
    'factory/competitor:guide:refresh-competitor-analysis',
  ], 'competitors', [competitors, factoryNavigation, factoryUpdatedAt]);
  add([
    'factory/competitor:guide:rerun-local-competitors',
    'factory/competitor:guide:rerun-vm-competitors',
    // 사이트 하나만 다시 수집. 형제들과 같은 범위를 써야 한다 —
    // 빠뜨리면 수집에 성공하는 순간 저장이 거절되어 작업이 통째로 버려진다(300edbe 참고).
    'factory/competitor:guide:rerun-site-competitors',
    'factory/competitor:guide:rerun-with-keyword',
  ], 'competitors', [part('competitors', ['compPage'])], 'competitors');
  add([
    'factory/competitor:market:candidate-target', 'factory/competitor:market:source-view',
    'factory/competitor:market:use-candidate-url', 'factory/competitor:market:toggle-candidate',
    'factory/competitor:market:toggle-image', 'factory/competitor:market:preview-image',
    'factory/competitor:market:close-image-preview', 'factory/competitor:market:analyze-images',
    'factory/competitor:market:quick-action',
  ], 'competitors', [part('competitors', ['compPage'])], 'competitors');

  add([
    'factory/assets:guide:go-tab:sections', 'factory/assets:guide:focus-asset-stage:hero',
    'factory/assets:guide:focus-asset-stage:size', 'factory/assets:guide:focus-asset-stage:options',
    'factory/assets:guide:focus-asset-stage:cuts',
  ], 'factory-assets', [factoryAssets, factoryNavigation, factoryUpdatedAt]);
  add([
    'factory/assets:setFactoryStageTarget', 'factory/assets:setFactoryStagePrompt',
    'factory/assets:toggleFactoryAssets', 'factory/assets:toggleFactoryPreviousAssets',
  ], 'factory-assets', [factoryAssets, factoryUpdatedAt]);
  add(['factory/assets:confirmFactoryAssetUse'], 'factory-assets', [
    part('factory-assets', ['assets', 'stages']),
    factoryAssetLogStatus,
  ]);
  add(['factory/assets:markFactoryAssetImageLoadFailed'], 'factory-assets', [
    part('factory-assets', ['assets', 'stages.db.status', 'stages.db.message']),
    factoryAssetLogStatus,
  ]);
  add(['factory/assets:goFactoryNextStage'], 'factory-assets', [
    part('factory-assets', ['stages']),
    part('factory', [
      'activeStage', 'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/assets:importFactoryImageCutPrompts'], 'factory-assets', [
    part('factory-assets', ['stages']),
    factoryAssetLogStatus,
  ]);
  add(['factory/assets:sendFactoryAssetToStage'], 'factory-assets', [
    part('factory-assets', ['stages']),
    part('factory', [
      'activeStage', 'logs', 'logStageId',
      'goalRun.currentStage', 'goalRun.progress', 'goalRun.failureReason',
    ]),
  ]);
  add(['factory/assets:toggleFactoryAssetUse'], 'factory-assets', [
    part('factory-assets', ['assets', 'stages']),
    factoryAssetLogStatus,
  ]);
  add(['factory/assets:selectFactoryACut'], 'factory-assets', [
    part('factory-assets', ['assets', 'stages', 'detailPlacement']),
    factoryAssetLogStatus,
  ]);
  add(['factory/assets:placeFactoryAsset'], 'factory-assets', [
    part('factory-assets', ['assets', 'detailPlacement']),
    factoryAssetLogStatus,
  ]);
  add([
    'factory/assets:addFactoryStageInputFiles',
    'factory/assets:createFactoryProductInputAsset', 'factory/assets:toggleFactoryAssetReject',
    'factory/assets:syncFactoryDbOptions',
    'factory/assets:syncFactoryOptionResults', 'factory/assets:setFactoryOptionColorImageUsage',
    'factory/assets:addFactoryCompletedFiles', 'factory/assets:openFactoryOptionSorter',
  ], 'factory-assets', [factoryAssets, factoryAssetStatus, product, productDbUi, factoryUpdatedAt]);
  add(['factory/assets:confirmFactorySizeImage'], 'factory-assets', [
    factoryAssets, factoryAssetStatus, product, productDbUi, productDbSizeUi, factoryUpdatedAt,
  ]);
  add(['factory/assets:archiveFactoryAsset'], 'factory-assets', [
    part('factory-assets', [
      'assets', 'archive', 'runtimeAssetPrunedAt', 'runtimeAssetPrunedCount',
    ]),
    factoryAssetLogStatus,
  ]);
  add(['factory/source:promoteCutsInputFile'], 'factory-assets', [
    product,
    part('factory-assets', ['assets', 'previousAssets', 'stages']),
    part('factory', [
      'automation.currentRunId', 'automation.currentRunStartedAt',
      'goalRun.currentRunId',
    ]),
  ]);
  add(['factory/assets:runFactoryStage'], 'factory-assets', [
    part('factory-assets', ['automation']), factoryWorkflowStatus, product, factoryWorkflowAssets,
  ]);

  add([
    'factory/sections:guide:apply-sections', 'factory/sections:guide:focus-detail-assets',
  ], 'detail-document', [detailDocument, factoryNavigation, factoryAssets, factoryAssetStatus, factoryUpdatedAt]);
  add(['factory/sections:runFactoryStage'], 'detail-document', [
    part('detail-document', ['automation']), factoryWorkflowStatus, product, factoryWorkflowAssets,
  ]);
  // 섹션 잠금 풀기. 잠금은 state.sectionLocks 에만 있고 draft 를 건드리지 않지만,
  // 이 명령도 다른 되살리기와 같은 문을 지나야 저장까지 이어진다.
  add(['factory/sections:unlock'], 'detail-document', [detailDocument, factoryUpdatedAt]);
  add([
    'factory/publish:guide:focus-final-registration',
    'factory/publish:guide:focus-materials',
  ], 'cafe24', [cafe24, factoryNavigation, factoryUpdatedAt]);
  add(['factory/publish:batch-control-prepare'], 'cafe24', finalRegistrationWorkflow);
  return Object.freeze(policies);
}

const FACTORY_RUNTIME_COMMAND_POLICIES = factoryRuntimeCreateCommandPolicies();
const FACTORY_RUNTIME_COMMAND_RECEIPT_SCHEMA = 'factory-runtime-command-receipt:v1';
const FACTORY_RUNTIME_READ_COMMANDS = Object.freeze([
  'factory/start:focusProductPanel', 'factory/db:focusSize',
  'factory/db:runFactoryGuideAction', 'factory/assets:openFactoryAssetPreview',
  'factory/assets:openFactoryStageFile',
  'factory/assets:openFactoryOptionColorFile', 'factory/assets:openFactoryCompletedFile',
  'factory/publish:guide:focus-stage-log',
]);

function factoryRuntimeBridgeAction(actionName, operationContext, execute, options = {}) {
  const store = factoryRuntimeRequireStore();
  const operationToken = operationContext?.operationToken || store.getOperationToken();
  if (!store.isOperationCurrent(operationToken)) throw factoryRuntimeStaleActionError(actionName);
  if (typeof execute !== 'function') throw new TypeError(`factory runtime action requires execute: ${actionName}`);
  const commandPolicy = FACTORY_RUNTIME_COMMAND_POLICIES[actionName] || null;
  const declaredRead = FACTORY_RUNTIME_READ_COMMANDS.includes(actionName);
  const finishRead = value => {
    if (!store.isOperationCurrent(operationToken)) throw factoryRuntimeStaleActionError(actionName);
    return value;
  };
  if (options.refresh === false || options.mutate === false) {
    if (!declaredRead) throw new Error(`undeclared read-only factory runtime action: ${actionName}`);
    const result = execute(store.getSnapshot().factory);
    return result && typeof result.then === 'function'
      ? Promise.resolve(result).then(finishRead)
      : finishRead(result);
  }
  if (!commandPolicy) throw new Error(`undeclared mutable factory runtime action: ${actionName}`);
  const commitOperationToken = store.getOperationToken();
  const reuseActiveOneClickDraft = !!factoryRuntimeOwnedRenderDraft && [
    'factory/cafe24:apply-db-candidate',
    'factory/cafe24:apply-cafe24-candidate',
    'factory/cafe24:refresh-selected-cafe24-candidate',
  ].includes(actionName);
  const finishWrite = receipt => {
    const committedProduct = store.getSnapshot().factory?.product || {};
    if (options.syncWorkIdentity === true) {
      state.workIdentity = cloneData(store.getSnapshot().factory?.workIdentity || null);
    }
    if (options.syncActiveProduct === true) {
      state.productName = String(committedProduct.userProductName || committedProduct.productName || '').trim();
    }
    if (options.syncActiveProductImage === true) {
      state.imageBase64 = committedProduct.imageBase64 || null;
      state.imageMime = committedProduct.imageMime || null;
      state.imagePreview = committedProduct.imagePreview || null;
      state.imageName = committedProduct.imageName || '';
      const committedInput = Array.isArray(committedProduct.inputImages)
        ? committedProduct.inputImages[0] || null
        : null;
      state.analysisImages = committedInput?.base64
        ? [{
            base64: committedInput.base64,
            mime: committedInput.mime || committedProduct.imageMime || 'image/png',
            preview: committedInput.preview || committedProduct.imagePreview || '',
            name: committedInput.name || committedProduct.imageName || '제품사진',
          }]
        : [];
    }
    if (options.forceSave === true) {
      try {
        if (typeof saveLastWorkInputCheckpoint === 'function') {
          saveLastWorkInputCheckpoint(options.checkpointReason || 'factory-runtime-force-save');
        }
      } catch (error) {
        console.warn('Forced factory input checkpoint failed:', error);
      }
      try {
        void saveLastWorkNow({
          factory: factoryRuntimeDetachedValue(store.getSnapshot().factory),
          sync: false,
        });
      } catch (error) {
        console.warn('Forced factory persistence start failed:', error);
      }
    } else scheduleLastWorkSave();
    if (options.render === true && state.step === 'factory') {
      const patchTab = String(options.patchTab || '').trim();
      const patched = patchTab === 'competitor-selection'
        ? typeof factoryPatchAutomationCompetitorSelection === 'function'
          && factoryPatchAutomationCompetitorSelection(factoryRuntimeReadFactory())
        : patchTab
          && typeof factoryPatchAutomationWizardTab === 'function'
          && factoryPatchAutomationWizardTab(factoryRuntimeReadFactory(), patchTab);
      if (!patched) render();
    }
    return Object.freeze({
      schema: FACTORY_RUNTIME_COMMAND_RECEIPT_SCHEMA,
      operationToken: store.getOperationToken(),
      value: receipt.result,
      assignments: receipt.assignments,
    });
  };
  const transaction = reuseActiveOneClickDraft
    ? (() => {
        const result = execute(factoryRuntimeOwnedRenderDraft);
        const receipt = value => Object.freeze({
          snapshot: Object.freeze({ factory: factoryRuntimeOwnedRenderDraft }),
          result: value,
          assignments: Object.freeze([]),
        });
        return result && typeof result.then === 'function'
          ? Promise.resolve(result).then(receipt)
          : receipt(result);
      })()
    : store.updateDraft(
        draft => factoryRuntimeRenderWithOwnedDraft(draft, () => execute(draft)),
        { owner: commandPolicy.coordinator, expectedRevision: commitOperationToken.revision },
        actionName,
        { rebaseOnStale: true },
      );
  return transaction && typeof transaction.then === 'function'
    ? Promise.resolve(transaction).then(finishWrite)
    : finishWrite(transaction);
}

function factoryRuntimeWithOperationLease(operationKey, operationContext, execute) {
  if (typeof execute !== 'function') throw new TypeError('factory runtime leased action requires execute');
  const initialStore = factoryRuntimeRequireStore();
  const requestedOperationToken = operationContext?.operationToken || initialStore.getOperationToken();
  const queueWhenBusy = operationContext?.queueWhenBusy === true;
  if (!initialStore.isOperationCurrent(requestedOperationToken)) {
    throw factoryRuntimeStaleActionError(operationKey);
  }
  const acquireAndExecute = () => {
    const store = factoryRuntimeRequireStore();
    if (requestedOperationToken && !store.isOperationCurrent(requestedOperationToken)) {
      throw factoryRuntimeStaleActionError(operationKey);
    }
    const operationToken = store.getOperationToken();
    const lease = store.acquireOperationLease(operationKey, operationToken);
    if (!lease.acquired) {
      if (
        queueWhenBusy
        && !store.hasActiveOperationLease(operationKey)
        && !factoryRuntimeHasDeferredOperationLease(operationKey, store)
      ) {
        return factoryRuntimeDeferOperationLease(
          operationKey,
          requestedOperationToken,
          acquireAndExecute,
          store,
        );
      }
      return false;
    }
    const release = () => {
      const released = lease.release();
      if (released) factoryRuntimeFlushDeferredOperations();
      return released;
    };
    try {
      const result = execute(Object.freeze({
        operationToken,
        operationSignal: lease.signal,
      }));
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).finally(release);
      }
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  };
  const acquireWhenIdle = () => {
    if (queueWhenBusy && factoryRuntimeHasDeferredOperationLease(operationKey, initialStore)) {
      return false;
    }
    return factoryRuntimeDeferredOperationsPending()
      ? factoryRuntimeWaitForDeferredOperations().then(acquireWhenIdle)
      : acquireAndExecute();
  };
  return acquireWhenIdle();
}

function factoryRuntimeHasDeferredOperationLease(operationKey, store) {
  return factoryRuntimeDeferredOperationQueue.some(item => (
    item?.kind === 'lease'
    && item.store === store
    && item.operationKey === operationKey
  ));
}

function factoryRuntimeDeferOperationLease(operationKey, operationToken, execute, store) {
  let resolve;
  let reject;
  const transaction = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  factoryRuntimeDeferredOperationQueue.push({
    kind: 'lease', operationKey, operationToken, store, execute, resolve, reject,
  });
  factoryRuntimeScheduleDeferredOperationRetry();
  return transaction;
}

function factoryRuntimeFollowupCommandReceipt(receipt, value) {
  const operationToken = receipt?.operationToken;
  if (!factoryRuntimeRequireStore().isOperationCurrent(operationToken)) {
    throw factoryRuntimeStaleActionError('factory/followup');
  }
  return Object.freeze({
    ...receipt,
    operationToken,
    value: factoryRuntimeDetachedValue(value),
  });
}

function factoryRuntimeRequireCurrentFollowupReceipt(actionName, receipt) {
  const operationToken = receipt?.operationToken;
  if (!operationToken || !factoryRuntimeRequireStore().isOperationCurrent(operationToken)) {
    throw factoryRuntimeStaleActionError(actionName);
  }
  return receipt;
}

function factoryRuntimeReportError(error) {
  const failure = error instanceof Error ? error : new Error(String(error || 'factory runtime error'));
  if (failure.message !== 'READ_ONLY') state.error = failure.message;
  // ★ 조용히 묻지 않는다. 예전에는 state.error 한 줄만 적고 끝이라,
  //   커밋이 통째로 거절돼 작업이 폐기돼도 화면에도 로그에도 아무 말이 없었다.
  //   "수집 19건인데 작업 반영 0건" 의 원인을 찾는 데 그래서 한참 걸렸다.
  //   특히 정책 거절(FACTORY_COMMAND_PATH_REJECTED)은 개발자가 고쳐야 하는 것이므로
  //   반드시 눈에 띄어야 한다.
  if (failure.message !== 'READ_ONLY') {
    try { console.error('[factory] 작업 저장 실패: ' + failure.message); } catch (logError) { void logError; }
    if (/FACTORY_COMMAND_PATH_REJECTED|STALE_FACTORY_/.test(failure.message)) {
      try {
        if (typeof factoryLog === 'function') {
          factoryLog(`작업 저장이 거절되어 이번 작업 내용이 반영되지 않았습니다: ${failure.message}`, 'error');
        }
      } catch (logError) { void logError; }
    }
  }
  return failure;
}

function factoryRuntimeCapabilities(actions, renderHelpers, owner = 'factory') {
  return {
    getSnapshot: factoryRuntimeReadViewSnapshot,
    assertMutable: requestedOwner => factoryRuntimeRequireStore().assertMutable(requestedOwner || owner),
    getOperationToken: () => factoryRuntimeRequireStore().getOperationToken(),
    isOperationCurrent: factoryRuntimeIsOperationCurrent,
    reportError: error => factoryRuntimeRequireStore().reportError(
      error instanceof Error ? error : new Error(String(error || 'factory runtime error')),
    ),
    actions: Object.freeze({ ...actions }),
    renderHelpers: Object.freeze({ ...renderHelpers }),
  };
}

const FACTORY_RUNTIME_TAB_IDS = Object.freeze([
  'factory/start',
  'factory/db',
  'factory/fields',
  'factory/competitor',
  'factory/assets',
  'factory/sections',
  'factory/publish',
]);

function factoryRuntimeApplyTabSelection(draft, fullId) {
  const id = String(fullId || '').trim();
  if (!FACTORY_RUNTIME_TAB_IDS.includes(id)) throw new Error(`unknown factory tab: ${id || '<empty>'}`);
  const shortId = id.slice('factory/'.length);
  draft.automation = draft.automation || {};
  draft.automation.activeTab = shortId;
  draft.automation.updatedAt = Date.now();
  scheduleLastWorkSave(shortId === 'assets' ? 1200 : 700);
  return id;
}

function selectFactoryTab(fullId, operationContext) {
  if (String(fullId || '').trim() !== 'factory/competitor'
    && typeof factoryRemoveCompetitorPreviewPortal === 'function') {
    factoryRemoveCompetitorPreviewPortal();
  }
  return factoryRuntimeBridgeAction(
    'factory:selectFactoryTab',
    operationContext,
    draft => factoryRuntimeApplyTabSelection(draft, fullId),
    { render: true },
  );
}

const FACTORY_STAGE_TAB_MAP = Object.freeze({
  db: 'db',
  hero: 'assets',
  size: 'assets',
  options: 'assets',
  cuts: 'assets',
  detail: 'sections',
  export: 'publish',
});

function jumpFactoryStage(stageId, operationContext) {
  const id = String(stageId || '').trim();
  const tabId = FACTORY_STAGE_TAB_MAP[id];
  if (!tabId) throw new Error(`unknown factory stage jump: ${id || '<empty>'}`);
  return factoryRuntimeBridgeAction('factory:jumpFactoryStage', operationContext, draft => {
    factoryRuntimeApplyTabSelection(draft, `factory/${tabId}`);
    draft.activeStage = id;
    if (tabId === 'assets') {
      draft.uiPanels = draft.uiPanels && typeof draft.uiPanels === 'object' ? draft.uiPanels : {};
      draft.uiPanels.assets = true;
    }
    const selector = tabId === 'assets'
      ? `#factoryAutomationAssetChooser_${id}`
      : '.factory-automation-body';
    setTimeout(() => document.querySelector(selector)?.scrollIntoView?.({ behavior: 'auto', block: 'start' }), 0);
    return id;
  }, { render: true });
}

function setFactoryStageLogFilter(filter, operationContext) {
  const value = String(filter || '').trim();
  const allowed = new Set(['all', 'db', 'hero', 'size', 'options', 'cuts', 'detail', 'export', 'general']);
  if (!allowed.has(value)) throw new Error(`unknown factory stage log filter: ${value || '<empty>'}`);
  return factoryRuntimeBridgeAction('factory:setFactoryStageLogFilter', operationContext, draft => {
    draft.stageLogFilter = value;
    return value;
  }, { render: true });
}

function runFactoryShellGuideAction(action) {
  const value = String(action || '').trim();
  try {
    const result = value === 'open-vm-capture'
      ? compMarketOpenVisibleVmCapture()
      : value === 'resume-comp-market-detail'
        ? compMarketResumeDetailJob()
        : value === 'rerun-vm-competitors' || value === 'rerun-local-competitors'
          ? (typeof factoryRuntimeCompetitorTab?.invoke === 'function'
            ? factoryRuntimeCompetitorTab.invoke('guideAction', value)
            : factoryRuntimeCompetitorGuideAction(value))
        : (() => { throw new Error(`unknown factory shell guide action: ${value || '<empty>'}`); })();
    return result && typeof result.catch === 'function'
      ? result.catch(error => {
        factoryRuntimeReportError(error);
        render();
        return null;
      })
      : result;
  } catch (error) {
    factoryRuntimeReportError(error);
    render();
    return null;
  }
}

function factoryRuntimeStartActions() {
  return {
    runDb(value = {}, operationContext) {
      return factoryRuntimeWithOperationLease('factory/runDb', operationContext, async operation => {
        // 작업파일 위주로 간다. 시작 버튼을 누른 제품명이 그 작업파일의 첫 이름이 된다.
        // 반드시 잠금 **안에서** 한다. 밖에서 await 하면 그 사이에 START 가 두 번 걸린다.
        // 합성 런타임 하네스에는 이 함수가 없을 수 있으므로 있을 때만 부른다.
        if (typeof factoryAdoptWorkfileNameOnStart === 'function') {
          await factoryAdoptWorkfileNameOnStart(value.productName);
        }
        let promotionResult = null;
        const transaction = factoryRuntimeBridgeAction(
          'factory/start:runDb',
          { ...operationContext, operationToken: operation.operationToken },
          async draft => {
            const current = draft;
            factorySetCurrentProductIdentity(value.productName || '', {
              factory: current,
              syncDom: true,
              syncFinal: true,
              rotateWorkIdentity: true,
            });
            current.product.naturalHint = String(value.naturalHint || '');
            promotionResult = await factoryPromoteStoredProductCandidateToInput({
              quiet: true,
              render: false,
              save: false,
              requireInputSource: true,
              factory: current,
              operationToken: operation.operationToken,
            });
            scheduleLastWorkSave(1200);
            return factoryRunDbCompetitorHeroCutsFlow({
              factory: draft,
              operationToken: operation.operationToken,
              operationSignal: operation.operationSignal,
              operationLeaseHeld: true,
              sourceMode: value.sourceMode === 'cafe24-only' ? 'cafe24-only' : 'all',
            });
          },
          { render: true },
        );
        return Promise.resolve(transaction).then(receipt => {
          if (promotionResult?.ok && typeof factoryFinalizeStoredProductPromotion === 'function') {
            factoryFinalizeStoredProductPromotion(promotionResult, {
              operationToken: receipt.operationToken,
              render: false,
              save: false,
            });
          }
          return receipt;
        });
      });
    },
    focusProductPanel(_value, operationContext) {
      return factoryRuntimeBridgeAction('factory/start:focusProductPanel', operationContext, draft => {
        document.querySelector('#factoryProductDbPanel')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return true;
      }, { refresh: false });
    },
    setProductName(value, operationContext) {
      return factoryRuntimeBridgeAction('factory/start:setProductName', operationContext, draft => {
        const current = draft;
        factorySetCurrentProductIdentity(value, {
          factory: current,
          syncDom: false,
          syncState: false,
          syncFinal: false,
          rotateWorkIdentity: true,
        });
        scheduleLastWorkSave();
        return value;
      }, { syncWorkIdentity: true, syncActiveProduct: true });
    },
    setNaturalHint(value, operationContext) {
      return factoryRuntimeBridgeAction('factory/start:setNaturalHint', operationContext, draft => {
        draft.product.naturalHint = String(value || '');
        scheduleLastWorkSave();
        return value;
      });
    },
    setStartCount(value = {}, operationContext) {
      return factoryRuntimeBridgeAction('factory/start:setStartCount', operationContext, draft => {
        const limits = { hero: 4, cuts: 4, competitors: 3 };
        const key = String(value.key || '');
        if (!Object.prototype.hasOwnProperty.call(limits, key)) throw new Error(`unknown factory start count: ${key}`);
        const count = Math.max(0, Math.min(limits[key], Math.round(Number(value.value) || 0)));
        const current = draft;
        current.automation.startRunCounts = current.automation.startRunCounts || {};
        current.automation.startRunCounts[key] = count;
        current.automation.lastWizardActionAt = Date.now();
        scheduleLastWorkSave();
        return count;
      });
    },
    confirmTask(taskId, operationContext) {
      return factoryRuntimeBridgeAction('factory/start:confirmTask', operationContext, draft => {
        const current = draft;
        current.automation.confirmedTasks = current.automation.confirmedTasks || {};
        current.automation.skippedTasks = current.automation.skippedTasks || {};
        current.automation.confirmedTasks[taskId] = true;
        const { [taskId]: _removedSkippedTask, ...remainingSkippedTasks } = current.automation.skippedTasks;
        current.automation.skippedTasks = remainingSkippedTasks;
        current.automation.activeTaskId = taskId;
        saveLastWorkNow();
        return true;
      }, { render: true });
    },
    skipTask(taskId, operationContext) {
      return factoryRuntimeBridgeAction('factory/start:skipTask', operationContext, draft => {
        const current = draft;
        current.automation.skippedTasks = current.automation.skippedTasks || {};
        current.automation.skippedTasks[taskId] = true;
        current.automation.activeTaskId = taskId;
        saveLastWorkNow();
        return true;
    }, { render: true });
    },
    setProductImage(file, operationContext) {
      return factoryRuntimeWithOperationLease('factory/setProductImage', operationContext, operation => (
        Promise.resolve(factoryReadProductImageFile(file)).then(payload => {
        if (!payload) return false;
        const store = factoryRuntimeRequireStore();
        const requestedToken = operationContext?.operationToken || null;
        const currentToken = store.getOperationToken();
        if (operation.operationSignal.aborted) throw factoryRuntimeStaleActionError('factory/start:setProductImage');
        if (requestedToken?.workspaceId && requestedToken.workspaceId !== currentToken.workspaceId) {
          throw factoryRuntimeStaleActionError('factory/start:setProductImage');
        }
        const transaction = factoryRuntimeBridgeAction(
          'factory/start:setProductImage',
          { ...operationContext, operationToken: currentToken },
          draft => factoryApplyProductImagePayload(payload, {
            factory: draft,
            operationToken: currentToken,
            syncState: false,
          }),
          { render: true, syncWorkIdentity: true, syncActiveProductImage: true },
        );
        return Promise.resolve(transaction).then(receipt => {
          const archivePayload = receipt.value?.archivePayload;
          if (archivePayload && typeof factoryArchiveCurrentInputImage === 'function') {
            void Promise.resolve(factoryArchiveCurrentInputImage(archivePayload, { reason: 'factory-product-upload' }))
              .then(saved => saved && typeof factoryRefreshLocalArchiveAssets === 'function'
                ? factoryRefreshLocalArchiveAssets({ auto: true, silent: true })
                : false)
              .catch(error => {
                const staleBackgroundArchive = /STALE_FACTORY_(?:STORE_(?:REVISION|OPERATION)|RUNTIME_ACTION)/.test(String(error?.message || error));
                if (!staleBackgroundArchive) factoryRuntimeReportError(error);
              });
          }
          return receipt;
        });
        })
      ));
    },
    promoteStoredProductImage(_value, operationContext) {
      const operationToken = operationContext?.operationToken || factoryRuntimeRequireStore().getOperationToken();
      let promotionResult = null;
      const transaction = factoryRuntimeBridgeAction(
        'factory/start:promoteStoredProductImage',
        { ...operationContext, operationToken },
        async draft => {
          promotionResult = await factoryPromoteStoredProductCandidateToInput({
            quiet: false,
            render: false,
            save: false,
            factory: draft,
            operationToken,
          });
          return promotionResult;
        },
        { render: true },
      );
      return Promise.resolve(transaction).then(receipt => {
        if (promotionResult?.ok && typeof factoryFinalizeStoredProductPromotion === 'function') {
          factoryFinalizeStoredProductPromotion(promotionResult, {
            operationToken: receipt.operationToken,
            render: false,
            save: false,
          });
        }
        return receipt;
      });
    },
  };
}

function factoryRuntimeDbActions() {
  return {
    goToFields(_value, operationContext) {
      return selectFactoryTab('factory/fields', operationContext);
    },
    rerunDbQuery(value, operationContext) {
      const transaction = factoryRuntimeBridgeAction('factory/db:rerunDbQuery', operationContext, draft => {
        const query = factoryApplyWizardDbSearchQuery(value, { factory: draft });
        return !!query;
      });
      return Promise.resolve(transaction).then(async receipt => {
        factoryRuntimeRequireCurrentFollowupReceipt('factory/db:rerunDbQuery', receipt);
        if (!receipt.value) return receipt;
        const result = await factoryRunDbCandidatesForSelection({ operationToken: receipt.operationToken });
        return factoryRuntimeFollowupCommandReceipt(receipt, result);
      });
    },
    rerunCafe24Query(value, operationContext) {
      const transaction = factoryRuntimeBridgeAction('factory/db:rerunCafe24Query', operationContext, draft => {
        const query = factoryApplyWizardDbSearchQuery(value, { factory: draft });
        return !!query;
      });
      return Promise.resolve(transaction).then(async receipt => {
        factoryRuntimeRequireCurrentFollowupReceipt('factory/db:rerunCafe24Query', receipt);
        if (!receipt.value) return receipt;
        const result = await factoryRunCafe24CandidateSearchOnly({ operationToken: receipt.operationToken });
        return factoryRuntimeFollowupCommandReceipt(receipt, result);
      });
    },
    appendCafe24Query(value, operationContext) {
      const transaction = factoryRuntimeBridgeAction('factory/db:appendCafe24Query', operationContext, draft => {
        const query = factoryApplyWizardDbSearchQuery(value, { factory: draft });
        return !!query;
      });
      return Promise.resolve(transaction).then(async receipt => {
        factoryRuntimeRequireCurrentFollowupReceipt('factory/db:appendCafe24Query', receipt);
        if (!receipt.value) return receipt;
        const result = await factoryRunCafe24CandidateAdditionalSearch({ operationToken: receipt.operationToken });
        return factoryRuntimeFollowupCommandReceipt(receipt, result);
      });
    },
    resetDbQuery(_value, operationContext) {
      return factoryRuntimeBridgeAction('factory/db:resetDbQuery', operationContext, draft => {
        const current = draft;
        current.automation = current.automation || {};
        const query = String(current.product?.productName || state.productName || current.product?.naturalHint || '').trim();
        current.automation.dbSearchQuery = query;
        current.automation.updatedAt = Date.now();
        saveLastWorkNow();
        return query;
      }, { render: true });
    },
    rerunDbVmOnly(_value, operationContext) {
      return factoryRuntimeBridgeAction('factory/db:rerunDbVmOnly', operationContext, draft => factoryRunDbVmCandidatesOnlyFlow({ factory: draft }), );
    },
    runDb(_value, operationContext) {
      return factoryRuntimeWithOperationLease('factory/runDb', operationContext, operation => (
        factoryRuntimeBridgeAction(
          'factory/db:runDb',
          { ...operationContext, operationToken: operation.operationToken },
          draft => factoryRunDbCompetitorHeroCutsFlow({
            factory: draft,
            operationToken: operation.operationToken,
            operationSignal: operation.operationSignal,
            operationLeaseHeld: true,
          }),
        )
      ));
    },
    startSinhwaDbAndRerun(_value, operationContext) {
      const transaction = factoryRuntimeBridgeAction(
        'factory/db:startSinhwaDbAndRerun',
        operationContext,
        draft => factoryBeginCandidateProgramStart('sinhwa', draft),
        { render: true },
      );
      return Promise.resolve(transaction).then(async receipt => {
        factoryRuntimeRequireCurrentFollowupReceipt('factory/db:startSinhwaDbAndRerun', receipt);
        if (!receipt.value?.ok) return receipt;
        const result = await factoryStartSinhwaDbAndRerunCandidates({
          started: receipt.value,
          operationToken: receipt.operationToken,
        });
        return factoryRuntimeFollowupCommandReceipt(receipt, result);
      });
    },
    startCafe24ControlAndRerun(_value, operationContext) {
      const transaction = factoryRuntimeBridgeAction(
        'factory/db:startCafe24ControlAndRerun',
        operationContext,
        draft => factoryBeginCandidateProgramStart('cafe24', draft),
        { render: true },
      );
      return Promise.resolve(transaction).then(async receipt => {
        factoryRuntimeRequireCurrentFollowupReceipt('factory/db:startCafe24ControlAndRerun', receipt);
        if (!receipt.value?.ok) return receipt;
        const result = await factoryStartCafe24ControlAndRerunCandidates({
          started: receipt.value,
          operationToken: receipt.operationToken,
        });
        return factoryRuntimeFollowupCommandReceipt(receipt, result);
      });
    },
    cafe24OauthStart(_value, operationContext) {
      const store = factoryRuntimeRequireStore();
      const operationToken = operationContext?.operationToken || store.getOperationToken();
      return factoryRuntimeBridgeAction(
        'factory/db:cafe24OauthStart',
        operationContext,
        draft => factoryOpenCafe24OAuthLogin({
          factory: draft,
          operationToken,
          render: false,
          save: false,
        }),
        { render: true },
      );
    },
    cafe24OauthStatusRefreshAndRerun(_value, operationContext) {
      const transaction = factoryRuntimeBridgeAction(
        'factory/db:cafe24OauthStatusRefreshAndRerun',
        operationContext,
        draft => factoryBeginCafe24OAuthStatusCheck(draft),
        { render: true },
      );
      return Promise.resolve(transaction).then(async receipt => {
        factoryRuntimeRequireCurrentFollowupReceipt('factory/db:cafe24OauthStatusRefreshAndRerun', receipt);
        if (!receipt.value?.ok) return receipt;
        const result = await factoryRefreshCafe24OAuthStatus({
          started: receipt.value,
          mallId: receipt.value.mallId,
          operationToken: receipt.operationToken,
          rerunCandidates: true,
        });
        return factoryRuntimeFollowupCommandReceipt(receipt, result);
      });
    },
    focusSize(_value, operationContext) {
      return factoryRuntimeBridgeAction('factory/db:focusSize', operationContext, draft => {
        document.querySelector('#factoryStageCard_size')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return true;
      }, { refresh: false });
    },
    setDbSearchQuery(value, operationContext) {
      return factoryRuntimeBridgeAction('factory/db:setDbSearchQuery', operationContext, draft => {
        const current = draft;
        current.automation = current.automation || {};
        current.automation.dbSearchQuery = String(value || '');
        current.automation.updatedAt = Date.now();
        scheduleLastWorkSave();
        return current.automation.dbSearchQuery;
      });
    },
    commitDbSearchQuery(value, operationContext) {
      return factoryRuntimeBridgeAction('factory/db:commitDbSearchQuery', operationContext, draft => {
        const current = draft;
        current.automation = current.automation || {};
        current.automation.dbSearchQuery = String(value || '').trim();
        current.automation.updatedAt = Date.now();
        saveLastWorkNow();
        return current.automation.dbSearchQuery;
      });
    },
    applyDbCandidate(value = {}, operationContext) {
      return factoryApplyDbCandidateFromReview(Number(value.index), {
        operationToken: operationContext?.operationToken,
        returnReceipt: true,
      });
    },
    applyCafe24Candidate(value = {}, operationContext) {
      return factoryApplyCafe24CandidateFromReview(Number(value.index), {
        operationToken: operationContext?.operationToken,
        returnReceipt: true,
      });
    },
    confirmNoDbCandidate(_value, operationContext) {
      return factoryRuntimeBridgeAction(
        'factory/db:confirmNoDbCandidate',
        operationContext,
        draft => factoryConfirmNoDbCandidate({ factory: draft, render: false }),
        { render: true, patchTab: 'db', forceSave: true },
      );
    },
    confirmNoCafe24Candidate(_value, operationContext) {
      return factoryRuntimeBridgeAction(
        'factory/db:confirmNoCafe24Candidate',
        operationContext,
        draft => factoryConfirmNoCafe24Candidate({ factory: draft, render: false }),
        { render: true, patchTab: 'db', forceSave: true },
      );
    },
    restoreDetachedDbSelection(_value, operationContext) {
      return factoryRuntimeBridgeAction(
        'factory/db:restoreDetachedDbSelection',
        operationContext,
        draft => factoryRestoreDetachedDbSelection({ factory: draft, render: false }),
        { render: true, patchTab: 'db', forceSave: true },
      );
    },
    discardDetachedDbSelection(_value, operationContext) {
      return factoryRuntimeBridgeAction(
        'factory/db:discardDetachedDbSelection',
        operationContext,
        draft => factoryDiscardDetachedDbSelection({ factory: draft, render: false }),
        { render: true, patchTab: 'db', forceSave: true },
      );
    },
    clearDbCandidateSelection(_value, operationContext) {
      return factoryRuntimeBridgeAction(
        'factory/db:clearDbCandidateSelection',
        operationContext,
        draft => factoryClearDbCandidateSelection({ factory: draft, render: false }),
        { render: true, patchTab: 'db', forceSave: true },
      );
    },
    clearCafe24CandidateSelection(_value, operationContext) {
      return factoryRuntimeBridgeAction(
        'factory/db:clearCafe24CandidateSelection',
        operationContext,
        draft => factoryClearCafe24CandidateSelection({ factory: draft, render: false }),
        { render: true, patchTab: 'db', forceSave: true },
      );
    },
    runFactoryGuideAction(value, operationContext) {
      return factoryRuntimeBridgeAction('factory/db:runFactoryGuideAction', operationContext, draft => {
        throw new Error(`unsupported factory DB guide action: ${String(value?.action || value || '<empty>')}`);
      }, { refresh: false });
    },
  };
}

function factoryRuntimeDbHelpers() {
  return {
    escapeHtml,
    escAttr,
    factoryAutomationCounts: factory => factoryAutomationCounts(factoryRuntimeDetachedValue(factory)),
    factoryAutomationWizardTasks: (factory, counts) => factoryAutomationWizardTasks(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(counts),
    ),
    renderFactoryAutomationTaskChecklist,
    renderFactoryCandidateReviewPanels: factory => renderFactoryCandidateReviewPanels(
      factoryRuntimeDetachedValue(factory),
    ),
  };
}

function factoryRuntimeFieldsActions() {
  return {
    setFieldDraft(value = {}, operationContext) {
      const eventType = String(value.eventType || 'input').trim().toLowerCase();
      const persistenceBoundary = eventType !== 'input' || !String(value.value || '').trim();
      return factoryRuntimeBridgeAction('factory/fields:setFieldDraft', operationContext, draft => {
        const fieldId = String(value.fieldId || value.id || '').trim();
        if (!fieldId) throw new Error('factory field draft id is required');
        factorySetAutomationWizardFieldDraft({
          value: String(value.value || ''),
          dataset: {
            factoryWizardField: fieldId,
            factoryWizardLabel: String(value.label || fieldId),
            factoryWizardPreviousValue: String(value.previousValue || ''),
          },
        }, draft);
        return fieldId;
      }, { forceSave: persistenceBoundary });
    },
    commitField(value = {}, operationContext) {
      return factoryRuntimeBridgeAction('factory/fields:commitField', operationContext, draft => {
        const fieldId = String(value.fieldId || value.id || '').trim();
        if (!fieldId) throw new Error('factory field commit id is required');
        factoryCommitAutomationWizardFieldValue(
          fieldId,
          String(value.value || ''),
          String(value.label || fieldId),
          false,
          draft,
        );
        return fieldId;
      }, { render: value.renderAfter === true, forceSave: true });
    },
    commitAllFields(value = {}, operationContext) {
      return factoryRuntimeBridgeAction('factory/fields:commitAllFields', operationContext, draft => {
        const fields = Array.isArray(value.fields) ? value.fields : [];
        const byId = new Map();
        for (const field of fields) {
          const fieldId = String(field?.fieldId || field?.id || '').trim();
          if (fieldId) byId.set(fieldId, field);
        }
        for (const [fieldId, field] of byId) {
          factoryCommitAutomationWizardFieldValue(
            fieldId,
            String(field.value || ''),
            String(field.label || fieldId),
            false,
            draft,
          );
        }
        return byId.size;
      }, { render: value.renderAfter === true, forceSave: true });
    },
    editField(value = {}, operationContext) {
      return factoryRuntimeBridgeAction('factory/fields:editField', operationContext, draft => {
        const fieldId = String(value.fieldId || '').trim();
        if (!fieldId) throw new Error('factory field edit id is required');
        const current = draft;
        const counts = factoryAutomationCounts(current);
        const item = factoryAutomationReviewSummary(current, counts)?.fields?.find(field => field.id === fieldId);
        if (!item || item.readonly) return false;
        const drafts = factoryAutomationWizardDrafts(current);
        drafts[fieldId] = {
          value: item.value || '',
          label: item.label || fieldId,
          updatedAt: Date.now(),
        };
        current.automation.fieldCommitNotice = `${item.label || fieldId}: 수정 중입니다. 값을 바꾼 뒤 수정 적용을 누르세요.`;
        current.automation.lastWizardActionAt = Date.now();
        factoryPersistAutomationWizardDrafts(current);
        scheduleLastWorkSave();
        return true;
      }, { render: true });
    },
    setFieldTransferSelection(value = {}, operationContext) {
      return factoryRuntimeBridgeAction('factory/fields:setFieldTransferSelection', operationContext, draft => factorySetFieldTransferSelection(value.selectedFieldIds || [], draft), { render: true },);
    },
    clearFieldTransferSelection(_value, operationContext) {
      return factoryRuntimeBridgeAction('factory/fields:clearFieldTransferSelection', operationContext, draft => factorySetFieldTransferSelection([], draft), { render: true },);
    },
    executeSelectedFieldTransfer(value = {}, operationContext) {
      return factoryRuntimeBridgeAction('factory/fields:executeSelectedFieldTransfer', operationContext, draft => {
        const target = String(value.target || '').trim();
        if (!['sinhwa', 'cafe24'].includes(target)) throw new Error(`unknown field transfer target: ${target || '<empty>'}`);
        return factoryExecuteSelectedFieldTransfer(target, draft);
      }, { render: true });
    },
    runGuideAction(value = {}, operationContext) {
      const action = String(value.action || '').trim();
      return factoryRuntimeBridgeAction(`factory/fields:guide:${action || '<empty>'}`, operationContext, async draft => {
        const current = draft;
        current.automation = current.automation || {};
        if (action === 'go-tab:assets') return factoryRuntimeApplyTabSelection(draft, 'factory/assets');
        if (action === 'open-field-review') return factoryRuntimeApplyTabSelection(draft, 'factory/fields');
        if (action === 'focus-missing-field-source') {
          const selector = factoryMissingFieldSourceSelector();
          setTimeout(() => document.querySelector(selector)?.scrollIntoView?.({ behavior: 'auto', block: 'start' }), 0);
          return selector;
        }
        if (action === 'run-size-now') {
          current.automation.activeTaskId = 'asset-picks';
          current.uiPanels = current.uiPanels && typeof current.uiPanels === 'object' ? current.uiPanels : {};
          current.uiPanels.assets = true;
          factoryRuntimeApplyTabSelection(draft, 'factory/assets');
          return factoryRunStage('size', { factory: current });
        }
        if (action === 'mark-no-options') {
          return factorySetOptionColorImageUsage('none', { log: true, save: false, render: false, factory: current });
        }
        if (action === 'mark-options-match') {
          factorySetOptionColorImageUsage('use', { log: false, save: false, render: false, factory: current });
          if (typeof factoryOpenOptionSorterEditor === 'function') return factoryOpenOptionSorterEditor({ factory: current });
          return true;
        }
        throw new Error(`unsupported factory fields guide action: ${action || '<empty>'}`);
      }, {
        render: !['focus-missing-field-source', 'mark-options-match'].includes(action),
        forceSave: action === 'mark-no-options' || action === 'mark-options-match',
      });
    },
    uploadOptionColor(value = {}, operationContext) {
      return factoryRuntimeBridgeAction('factory/fields:uploadOptionColor', operationContext, draft => factoryAddOptionColorImageFiles(value.files || [], { factory: draft }), );
    },
  };
}

function factoryRuntimeFieldsHelpers() {
  return {
    escapeHtml,
    escAttr,
    disabledAttr,
    factoryAutomationStatusTone,
    factoryAutomationCounts: factory => factoryAutomationCounts(factoryRuntimeDetachedValue(factory)),
    factoryAutomationReviewSummary: (factory, counts) => factoryAutomationReviewSummary(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(counts),
    ),
    factoryBojagiSquareSizeOptionSuggestion: factory => factoryBojagiSquareSizeOptionSuggestion(
      factoryRuntimeDetachedValue(factory),
    ),
    factoryFieldTransferRows: (factory, summary) => factoryFieldTransferRows(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(summary),
    ),
    factoryFieldTransferState: factory => factoryFieldTransferState(factoryRuntimeDetachedValue(factory)),
    factorySinhwaSelectedTransferTarget: factory => factorySinhwaSelectedTransferTarget(
      factoryRuntimeDetachedValue(factory),
    ),
    factoryCafe24SelectedTransferTarget: factory => factoryCafe24SelectedTransferTarget(
      factoryRuntimeDetachedValue(factory),
    ),
    renderFactoryAutomationTaskChecklist,
    renderFactoryAutomationStatusCard,
  };
}

function factoryRuntimeCompetitorGuideAction(actionValue, operationContext) {
  // 예전에는 문자열만 받았다. 사이트 하나만 다시 수집하려면 어느 사이트인지도 실어야 해서
  // 객체({ action, site, runtime })도 받도록 넓혔다. 문자열은 예전 그대로 동작한다.
  const detail = actionValue && typeof actionValue === 'object' ? actionValue : {};
  const action = String(detail.action ?? actionValue ?? '').trim();
  const options = detail;
  if (action === 'open-vm-capture') {
    return runFactoryShellGuideAction(action);
  }
  if (action === 'resume-comp-market-detail') {
    const actionName = 'factory/competitor:market:quick-action';
    const transaction = factoryRuntimeBridgeAction(actionName, operationContext, draft => {
      const { market } = factoryRuntimeCompetitorDraft(draft);
      const retryIds = compMarketManualRetryCandidateIds(market);
      if (!retryIds.length) {
        market.status = '다시 수집할 후보가 없습니다. 후보 카드를 선택한 뒤 VM 상세수집을 실행해주세요.';
        market.phase = 'detail-retry-empty';
        market.lastUpdatedAt = Date.now();
      }
      return retryIds;
    }, { render: true });
    return Promise.resolve(transaction).then(async receipt => {
      factoryRuntimeRequireCurrentFollowupReceipt(actionName, receipt);
      if (!receipt.value?.length) return receipt;
      const result = await runCompMarketDetailCapture(receipt.value, {
        runtime: 'vm',
        selectionMode: 'subset',
        reuseVmSearchSession: false,
        operationToken: receipt.operationToken,
      });
      return factoryRuntimeFollowupCommandReceipt(receipt, result);
    });
  }
  if (action === 'rerun-vm-competitors') {
    const actionName = 'factory/competitor:guide:rerun-vm-competitors';
    const requestedContext = operationContext || Object.freeze({
      operationToken: factoryRuntimeRequireStore().getOperationToken(),
    });
    return Promise.resolve().then(() => factoryRuntimeWithOperationLease(
      actionName,
      requestedContext,
      operation => {
        const receipt = Object.freeze({
          schema: FACTORY_RUNTIME_COMMAND_RECEIPT_SCHEMA,
          operationToken: operation.operationToken,
          value: true,
          assignments: Object.freeze([]),
        });
        return Promise.resolve(factoryRunVmCompetitorCollectionForSelection({
          operationToken: operation.operationToken,
          operationSignal: operation.operationSignal,
          forceCollect: true,
        })).then(result => factoryRuntimeFollowupCommandReceipt(receipt, result));
      },
    ));
  }
  if (action === 'rerun-local-competitors') {
    if (!compMarketConfirmLocalCandidateCollection()) return false;
    return factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:guide:rerun-local-competitors',
      operationContext,
      () => runCompMarketScrape('local'),
    );
  }
  // 사이트 하나만 다시 수집한다. 스마트스토어만 막혔는데 다섯 곳을 전부 다시 도는 건 낭비다.
  // 실행 경로(본컴/VM)는 지금 화면에서 고른 것을 그대로 따른다 — 사용자가 고른 것을 바꾸지 않는다.
  if (action === 'rerun-site-competitors') {
    const site = String(options.site || '').trim();
    if (!site) return false;
    const runtime = String(options.runtime || '').trim()
      || (ensureCompMarketScrapeState().collectMode === 'local' ? 'local' : 'vm');
    if (runtime === 'local' && !compMarketConfirmLocalCandidateCollection()) return false;
    return factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:guide:rerun-site-competitors',
      operationContext,
      () => runCompMarketScrape(runtime, { onlySites: [site], searchKeyword: options.searchKeyword }),
    );
  }
  // 검색어를 바꿔서 다시 수집한다. 제품명 그대로는 안 잡히는데 짧게 줄이면 잡히는 경우가 많다.
  // 작업의 제품명은 바꾸지 않는다 — 이번 검색에만 쓴다.
  if (action === 'rerun-with-keyword') {
    const keyword = String(options.searchKeyword || '').trim();
    if (!keyword) {
      if (typeof compMarketLog === 'function') compMarketLog('검색어를 입력해주세요.', 'warn');
      return false;
    }
    const runtime = String(options.runtime || '').trim()
      || (ensureCompMarketScrapeState().collectMode === 'local' ? 'local' : 'vm');
    if (runtime === 'local' && !compMarketConfirmLocalCandidateCollection()) return false;
    const onlySites = String(options.site || '').trim() ? [String(options.site).trim()] : undefined;
    return factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:guide:rerun-with-keyword',
      operationContext,
      () => runCompMarketScrape(runtime, { searchKeyword: keyword, ...(onlySites ? { onlySites } : {}) }),
    );
  }
  return factoryRuntimeBridgeAction(`factory/competitor:guide:${action || '<empty>'}`, operationContext, draft => {
    const current = draft;
    current.automation = current.automation || {};
    if (action === 'toggle-competitor-panel') {
      current.automation.competitorPanelOpen = !current.automation.competitorPanelOpen;
      return current.automation.competitorPanelOpen;
    }
    if (action === 'open-competitor') {
      state.step = 'competitor';
      saveLastWorkNow();
      return true;
    }
    if (action === 'go-tab:sections') {
      if (typeof compMarketRequireCurrentImageAnalysis === 'function'
        && !compMarketRequireCurrentImageAnalysis('섹션 생성으로 이동')) return false;
      return factoryRuntimeApplyTabSelection(draft, 'factory/sections');
    }
    if (action === 'go-tab:competitor') return factoryRuntimeApplyTabSelection(draft, 'factory/competitor');
    if (action === 'focus-competitor-images') {
      current.automation.activeTaskId = 'competitor-images';
      setTimeout(() => document.querySelector('#factoryCompetitorImagePicker')?.scrollIntoView?.({ behavior: 'auto', block: 'start' }), 0);
      return true;
    }
    if (action === 'open-competitor-report') {
      if (typeof compMarketRequireCurrentImageAnalysis === 'function'
        && !compMarketRequireCurrentImageAnalysis('경쟁사 리포트 열기', { allowPreviousResult: true })) return false;
      state.step = 'competitor';
      state.compPage = state.compPage || {};
      state.compPage.subStep = state.compPage.analysisResult ? 'report' : (state.compPage.subStep || 'input');
      saveLastWorkNow();
      return true;
    }
    if (action === 'refresh-competitor-analysis') {
      return refreshCompetitorAnalysisFromServer({ targetSubStep: state.compPage?.subStep || 'input' });
    }
    throw new Error(`unsupported factory competitor guide action: ${action || '<empty>'}`);
  }, { render: !['rerun-vm-competitors', 'rerun-local-competitors', 'refresh-competitor-analysis'].includes(action) });
}

function factoryRuntimeCompetitorDraft(draft) {
  const competitors = draft && typeof draft === 'object' ? draft : {};
  competitors.compPage = competitors.compPage && typeof competitors.compPage === 'object'
    ? competitors.compPage
    : {};
  const compPage = competitors.compPage;
  compPage.marketScrape = compPage.marketScrape && typeof compPage.marketScrape === 'object'
    ? compPage.marketScrape
    : {};
  return { compPage, market: compPage.marketScrape };
}

function factoryRuntimePreserveLatestCompetitorSelection(staleCompPage, currentCompPage) {
  const next = factoryRuntimeDetachedValue(staleCompPage || {});
  const current = currentCompPage && typeof currentCompPage === 'object' ? currentCompPage : {};
  const currentMarket = current.marketScrape && typeof current.marketScrape === 'object'
    ? current.marketScrape
    : {};
  const nextMarket = next.marketScrape && typeof next.marketScrape === 'object'
    ? next.marketScrape
    : {};
  const currentVersion = Math.max(0, Number(currentMarket.detailSelectionVersion || 0) || 0);
  const nextVersion = Math.max(0, Number(nextMarket.detailSelectionVersion || 0) || 0);
  const currentImages = Array.isArray(currentMarket.scrapedImages) ? currentMarket.scrapedImages : [];
  const nextImages = Array.isArray(nextMarket.scrapedImages) ? nextMarket.scrapedImages : [];
  const preservedImages = currentImages.length > nextImages.length
    ? factoryRuntimeDetachedValue(currentImages)
    : nextImages;
  if (currentVersion <= nextVersion) {
    if (currentImages.length > nextImages.length) {
      next.marketScrape = { ...nextMarket, scrapedImages: preservedImages };
    }
    return next;
  }
  next.marketScrape = {
    ...nextMarket,
    scrapedImages: preservedImages,
    selectedIds: Array.isArray(currentMarket.selectedIds) ? [...currentMarket.selectedIds] : [],
    selectedImageIds: Array.isArray(currentMarket.selectedImageIds) ? [...currentMarket.selectedImageIds] : [],
    detailSelectionVersion: currentVersion,
    detailOperation: factoryRuntimeDetachedValue(currentMarket.detailOperation || null),
    showPreviousDetailImages: currentMarket.showPreviousDetailImages === true,
  };
  return next;
}

function factoryRuntimeMarkCompetitorDetailSelectionChanged(market, message = '') {
  market.detailSelectionVersion = Math.max(0, Number(market.detailSelectionVersion || 0) || 0) + 1;
  market.selectedImageIds = [];
  market.showPreviousDetailImages = false;
  const operation = market.detailOperation;
  if (market.loading && operation?.id && !operation.selectionChangedAt) {
    operation.selectionChangedAt = Date.now();
    operation.status = 'selection-changed';
    market.logs = [
      { time: new Date().toISOString(), message, type: 'warn' },
      ...(Array.isArray(market.logs) ? market.logs : []),
    ].slice(0, 80);
  }
}

function factoryRuntimeMarkCompetitorImageSelectionChanged(compPage, reason = '') {
  if (!compPage.analysisResult && !compPage.sectionPlan) return;
  // 일부러 분리했다는 표시를 남긴다. 서버는 분석 결과가 사라지는 저장을 막는데(사고로
  // 잃는 것을 지키기 위해), 이 표시가 없으면 "선택이 바뀌어 분리한 것"과 "실수로 잃은 것"을
  // 구분하지 못해 완성된 작업이 마지막 저장에서 막힌다 — 실측 2026-08-29:
  // factory_product_checkpoint_save_failed ... dropped protected work data: compPage.analysisResult
  compPage.analysisInvalidatedAt = Math.max(
    Date.now(),
    Number(compPage.analysisInvalidatedAt || 0) + 1,
  );
  compPage.analysisResult = null;
  compPage.sectionPlan = null;
  compPage.planEdits = {};
  compPage.analyzeProgress = 0;
  compPage.analyzeStage = '이미지 선택 변경';
  compPage.analyzeMsg = '선택 이미지가 바뀌어 이전 분석 결과를 분리했습니다.';
  compPage.analyzeDetail = reason || '현재 선택 이미지 기준으로 다시 분석해야 합니다.';
  compPage.analysisImageSelection = null;
  compPage.pendingAnalysisImageSelection = null;
  compPage.previousAnalysisViewOnly = false;
}

function factoryRuntimeSetCompetitorCandidateSource(market, source) {
  const view = String(source || '').toLowerCase() === 'local' ? 'local' : 'vm';
  const rows = Array.isArray(market[`${view}Results`])
    ? market[`${view}Results`]
    : (market.collectMode === view && Array.isArray(market.results) ? market.results : []);
  const grouped = market[`${view}GroupedResults`] && typeof market[`${view}GroupedResults`] === 'object'
    ? market[`${view}GroupedResults`]
    : {};
  market.candidateView = view;
  market.results = [...rows];
  market.groupedResults = { ...grouped };
  market.selectedIds = [];
  market.status = `${view === 'vm' ? 'VM' : '본컴'} 후보 ${rows.length}건을 표시합니다.`;
  market.phase = rows.length ? 'done' : 'ready';
  market.lastUpdatedAt = Date.now();
  return market;
}

function factoryRuntimeRunLegacyCompetitorMarketAction(actionName, operationContext, execute) {
  let committedCompPage = {};
  const transaction = factoryRuntimeBridgeAction(actionName, operationContext, draft => {
    const { compPage, market } = factoryRuntimeCompetitorDraft(draft);
    market.lastUpdatedAt = Date.now();
    committedCompPage = factoryRuntimeDetachedValue(compPage);
    return true;
  }, { render: false });
  return Promise.resolve(transaction).then(async receipt => {
    factoryRuntimeRequireCurrentFollowupReceipt(actionName, receipt);
    state.compPage = factoryRuntimeDetachedValue(committedCompPage);
    let result;
    let failure = null;
    try {
      result = await execute(state.compPage.marketScrape || {}, receipt.operationToken);
    } catch (error) {
      failure = error;
    }
    if (!factoryRuntimeRequireStore().isOperationCurrent(receipt.operationToken)) {
      throw factoryRuntimeStaleActionError(actionName);
    }
    await Promise.resolve(factoryRuntimeUpdateOwnedFactory(actionName, 'competitors', draft => {
      draft.compPage = factoryRuntimePreserveLatestCompetitorSelection(
        state.compPage || {},
        draft.compPage || {},
      );
      return true;
    }));
    scheduleLastWorkSave();
    if (state.step === 'factory') render();
    if (failure) throw failure;
    return factoryRuntimeFollowupCommandReceipt(receipt, result);
  });
}

// 본컴 후보 수집이 쓸 제품명을 시장 상태에 넣는다. VM 경로가 쓰는 것과 같은 우선순위다.
function factoryRuntimeControlSeedLocalCompetitorName(market) {
  if (!market || typeof market !== 'object') return '';
  const clean = typeof cleanDbSearchTerm === 'function' ? cleanDbSearchTerm : (value => String(value || '').trim());
  if (clean(market.productName)) return String(market.productName).trim();
  let factory = {};
  try {
    factory = factoryRuntimeReadFactory() || {};
  } catch (_) {
    factory = {};
  }
  const analysis = factory.product?.analysis || state.analysis || {};
  const productName = clean(
    factory.automation?.dbSearchQuery
    || factory.product?.productName
    || state.productName
    || analysis.product_name
    || factory.product?.naturalHint
    || '',
  );
  if (!productName) return '';
  market.productName = productName;
  market.searchKeyword = productName;
  if (typeof compMarketApplyCurrentWorkScope === 'function'
    && typeof factoryCompetitorCandidateScopePayload === 'function') {
    try {
      compMarketApplyCurrentWorkScope(market, factoryCompetitorCandidateScopePayload('competitors', factory));
    } catch (_) { /* 범위를 못 붙여도 이름만으로 수집은 시작할 수 있다 */ }
  }
  return productName;
}

function factoryRuntimeCompetitorMarketAction(payload = {}, operationContext) {
  const type = String(payload.type || '').trim();
  const quickAction = type === 'quick-action' ? String(payload.action || '').trim() : '';
  const asyncActions = new Set(['start-local', 'reload', 'detail-vm', 'detail-local', 'detail-scrapling', 'analyze-vm']);
  if (type === 'quick-action' && quickAction === 'start-vm') {
    const actionName = 'factory/competitor:market:quick-action';
    const transaction = factoryRuntimeBridgeAction(actionName, operationContext, draft => {
      const { market } = factoryRuntimeCompetitorDraft(draft);
      market.lastUpdatedAt = Date.now();
      return true;
    }, { render: false });
    return Promise.resolve(transaction).then(receipt => {
      factoryRuntimeRequireCurrentFollowupReceipt(actionName, receipt);
      return factoryRuntimeWithOperationLease(
        actionName,
        { operationToken: receipt.operationToken },
        operation => Promise.resolve(factoryRunVmCompetitorCollectionForSelection({
          operationToken: operation.operationToken,
          operationSignal: operation.operationSignal,
          forceCollect: true,
          skipConfirm: payload.skipConfirm === true,
        })).then(result => factoryRuntimeFollowupCommandReceipt(receipt, result)),
      );
    });
  }
  if (type === 'analyze-images') {
    const mode = payload.mode === 'all' ? 'all' : 'selected';
    return factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:market:analyze-images',
      operationContext,
      () => analyzeCompMarketScrapedImages(mode),
    );
  }
  if (type === 'quick-action' && quickAction === 'recover-images') {
    return factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:market:quick-action',
      operationContext,
      () => {
        const recoveryFactory = factoryRuntimeDetachedValue(factoryRuntimeReadFactory());
        recoveryFactory.compPage = state.compPage;
        return Promise.resolve(recoverCompMarketDetailImagesFromHistory({
          allowProductFallback: true,
          syncFactory: true,
          factory: recoveryFactory,
        })).then(async result => {
          if (result?.ok && recoveryFactory.compPage && typeof recoveryFactory.compPage === 'object') {
            await Promise.resolve(factoryRuntimeUpdateOwnedFactory(
              'factory/competitor:syncDetailMarket',
              'competitors',
              draft => {
                draft.compPage = factoryRuntimeDetachedValue(recoveryFactory.compPage);
                return true;
              },
            ));
          }
          return result;
        });
      },
    );
  }
  if (type === 'quick-action' && quickAction === 'open-vm-login') {
    return factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:market:quick-action',
      operationContext,
      () => compMarketOpenVmLoginSession(),
    );
  }
  if (type === 'quick-action' && ['detail-vm', 'detail-local', 'detail-scrapling'].includes(quickAction)) {
    const actionName = 'factory/competitor:market:quick-action';
    let detailRunId = '';
    try {
      const currentFactory = typeof factoryRuntimeRequireStore === 'function'
        ? factoryRuntimeRequireStore().getSnapshot().factory
        : factoryRuntimeReadFactory();
      detailRunId = typeof factoryCurrentStageRunId === 'function'
        ? factoryCurrentStageRunId('competitors', currentFactory)
        : '';
    } catch (_) {
      detailRunId = '';
    }
    const scopeTransaction = detailRunId
      ? null
      : factoryRuntimeBridgeAction('factory/competitor:initializeDetailScope', operationContext, draft => {
          const runId = typeof factoryStartNewWorkflowRun === 'function'
            ? factoryStartNewWorkflowRun(draft)
            : '';
          return runId;
        }, { render: false });
    return Promise.resolve(scopeTransaction).then(scopeReceipt => {
      if (scopeTransaction) factoryRuntimeRequireCurrentFollowupReceipt('factory/competitor:initializeDetailScope', scopeReceipt);
      const detailOperationContext = scopeReceipt?.operationToken
        ? { ...(operationContext || {}), operationToken: scopeReceipt.operationToken }
        : operationContext;
      const transaction = factoryRuntimeBridgeAction(actionName, detailOperationContext, draft => {
        const { market } = factoryRuntimeCompetitorDraft(draft);
        const currentFactory = typeof factoryRuntimeRequireStore === 'function'
          ? factoryRuntimeRequireStore().getSnapshot().factory
          : factoryRuntimeReadFactory();
        const scope = typeof factoryCompetitorCandidateScopePayload === 'function'
          ? factoryCompetitorCandidateScopePayload('competitors', currentFactory)
          : null;
        if (scope?.scopeKey && typeof compMarketApplyCurrentWorkScope === 'function') {
          compMarketApplyCurrentWorkScope(market, scope);
        }
        if (scope?.scopeKey && typeof compMarketStampRowsWithCurrentWork === 'function') {
          market.results = compMarketStampRowsWithCurrentWork(market.results, scope, { replaceScope: true });
          market.groupedResults = Object.fromEntries(Object.entries(market.groupedResults || {}).map(([site, rows]) => [
            site,
            compMarketStampRowsWithCurrentWork(rows, scope, { replaceScope: true }),
          ]));
        }
        market.lastUpdatedAt = Date.now();
        return {
          selectedIds: Array.isArray(market.selectedIds) ? market.selectedIds.map(String).filter(Boolean) : [],
          selectionVersion: Math.max(0, Number(market.detailSelectionVersion || 0) || 0),
        };
      }, { render: false });
      return Promise.resolve(transaction).then(async receipt => {
        factoryRuntimeRequireCurrentFollowupReceipt(actionName, receipt);
        const selectionSnapshot = receipt.value && typeof receipt.value === 'object' ? receipt.value : {};
        const selectedIds = Array.isArray(selectionSnapshot.selectedIds)
          ? selectionSnapshot.selectedIds.map(String).filter(Boolean)
          : [];
        if (!selectedIds.length) return receipt;
        const result = quickAction === 'detail-scrapling'
          ? await runCompMarketScraplingDetailCapture(selectedIds, {
              operationToken: receipt.operationToken,
              selectionSnapshot,
            })
          : await runCompMarketDetailCapture(selectedIds, {
              runtime: quickAction === 'detail-local' ? 'local' : 'vm',
              operationToken: receipt.operationToken,
              selectionSnapshot,
            });
        return factoryRuntimeFollowupCommandReceipt(receipt, result);
      });
    });
  }
  if (type === 'quick-action' && asyncActions.has(quickAction)) {
    // 조립공장이 무인으로 돌리는 경로에서는 확인창을 띄우지 않는다. 사람이 없는 워커 탭에서
    // window.confirm 은 취소로 떨어지고, 수집이 시작조차 못 한 채 "결과 0건" 으로 보였다
    // — 실측 2026-08-29: 본컴 수집기는 같은 이름으로 8건을 돌려주는데 앱만 0건이었다.
    if (quickAction === 'start-local'
      && payload.skipConfirm !== true
      && !compMarketConfirmLocalCandidateCollection()) return false;
    return factoryRuntimeRunLegacyCompetitorMarketAction(
      'factory/competitor:market:quick-action',
      operationContext,
      (market, operationToken) => {
        const selectedIds = Array.isArray(market.selectedIds) ? market.selectedIds.map(String) : [];
        if (quickAction === 'start-local') {
          // VM 경로(factoryRunVmCompetitorCollectionForSelection)는 제품명을 시장 상태에
          // 넣어 주는데, 본컴 경로는 그 준비 없이 runCompMarketScrape 로 바로 들어간다.
          // 그러면 제품명이 비어 수집기에 검색을 만들지도 못하고 조용히 0건으로 끝난다
          // — 실측 2026-08-29: 수집기에는 요청 자체가 남지 않았다.
          factoryRuntimeControlSeedLocalCompetitorName(market);
          return runCompMarketScrape('local');
        }
        if (quickAction === 'reload') return reloadCompMarketSearchResultsFromCurrentId();
        if (quickAction === 'detail-vm') {
          return runCompMarketDetailCapture(selectedIds, { operationToken });
        }
        if (quickAction === 'detail-local') {
          return runCompMarketDetailCapture(selectedIds, { runtime: 'local', operationToken });
        }
        if (quickAction === 'detail-scrapling') {
          return runCompMarketScraplingDetailCapture(selectedIds, { operationToken });
        }
        return runCompMarketDetailCaptureAndAnalyze(selectedIds, { operationToken });
      },
    );
  }
  const competitorSelectionChanged = type === 'toggle-candidate'
    || ['toggle-image'].includes(type)
    || (type === 'quick-action' && [
      'select-all', 'clear-selection', 'select-all-images', 'clear-images', 'toggle-history-images',
    ].includes(quickAction));
  return factoryRuntimeBridgeAction(`factory/competitor:market:${type || '<empty>'}`, operationContext, draft => {
    const { compPage, market } = factoryRuntimeCompetitorDraft(draft);
    if (type === 'candidate-target') {
      const value = Math.round(Number(payload.value) || 0);
      if (payload.scope === 'total') market.totalTarget = Math.max(1, Math.min(100, value || 1));
      else {
        const siteId = String(payload.siteId || '').trim();
        if (!siteId) throw new Error('competitor candidate target site is required');
        market.marketTargets = market.marketTargets && typeof market.marketTargets === 'object' ? market.marketTargets : {};
        market.marketTargets[siteId] = Math.max(1, Math.min(20, value || 1));
        market.topN = Math.max(1, ...Object.values(market.marketTargets).map(item => Math.max(1, Number(item) || 1)));
      }
      market.lastUpdatedAt = Date.now();
      if (payload.commit) scheduleLastWorkSave();
      return value;
    }
    if (type === 'source-view') {
      const selected = factoryRuntimeSetCompetitorCandidateSource(market, payload.source);
      scheduleLastWorkSave();
      return selected;
    }
    if (type === 'use-candidate-url') {
      const found = compMarketFindResultById(market, String(payload.candidateId || ''));
      const item = found?.item;
      const url = item?.product_url || item?.url || item?.link || item?.detail_url || '';
      if (!url) return false;
      compPage.mode = 'url';
      compPage.urlInput = url;
      market.lastUpdatedAt = Date.now();
      scheduleLastWorkSave();
      return url;
    }
    if (type === 'toggle-candidate') {
      const id = String(payload.candidateId || '').trim();
      if (!id) throw new Error('competitor candidate id is required');
      const selected = new Set(market.selectedIds || []);
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      market.selectedIds = [...selected];
      factoryRuntimeMarkCompetitorDetailSelectionChanged(market, '선택 후보가 바뀌었습니다. 이전 상세수집 결과는 현재 선택에 섞지 않습니다.');
    } else if (type === 'toggle-image') {
      const id = String(payload.imageId || '').trim();
      if (!id) throw new Error('competitor image id is required');
      const selected = new Set(market.selectedImageIds || []);
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      market.selectedImageIds = [...selected];
      factoryRuntimeMarkCompetitorImageSelectionChanged(compPage, '분석할 상세페이지 이미지 선택이 바뀌었습니다.');
    } else if (type === 'preview-image') {
      market.previewImageId = String(payload.imageId || '');
    } else if (type === 'close-image-preview') {
      market.previewImageId = '';
    } else if (type === 'quick-action') {
      if (quickAction === 'select-all') {
        const candidates = compMarketAllCandidateResults(market);
        market.results = candidates;
        market.selectedIds = candidates.map((item, index) => compMarketResultId(item, index));
        factoryRuntimeMarkCompetitorDetailSelectionChanged(market, '후보 전체 선택으로 상세수집 선택 범위가 바뀌었습니다.');
      } else if (quickAction === 'clear-selection') {
        market.selectedIds = [];
        factoryRuntimeMarkCompetitorDetailSelectionChanged(market, '후보 선택을 해제해 이전 상세수집 결과를 현재 선택에 섞지 않습니다.');
      } else if (quickAction === 'select-all-images') {
        const images = compMarketVisibleDetailImagesForSelection(market);
        market.selectedImageIds = images.map((image, index) => compMarketScrapedImageId(image, index));
        factoryRuntimeMarkCompetitorImageSelectionChanged(compPage, '이번 선택으로 수집한 상세페이지 이미지를 분석 대상으로 선택했습니다.');
      } else if (quickAction === 'clear-images') {
        market.selectedImageIds = [];
        factoryRuntimeMarkCompetitorImageSelectionChanged(compPage, '상세페이지 이미지 선택을 해제했습니다.');
      } else if (quickAction === 'toggle-history-images') {
        market.showPreviousDetailImages = !market.showPreviousDetailImages;
      } else {
        throw new Error(`unsupported competitor quick action: ${quickAction || '<empty>'}`);
      }
    } else {
      throw new Error(`unsupported competitor market action: ${type || '<empty>'}`);
    }
    market.lastUpdatedAt = Date.now();
    scheduleLastWorkSave();
    return true;
  }, {
    render: type === 'candidate-target'
      ? payload.commit === true
      : type !== 'source-view' && type !== 'analyze-images' && !asyncActions.has(quickAction),
    patchTab: competitorSelectionChanged ? 'competitor-selection' : 'competitor',
  });
}

function factoryRuntimeCompetitorHelpers() {
  return {
    escapeHtml,
    escAttr,
    disabledAttr,
    renderFactoryAutomationVmSearchInfo: (factory, tone, market) => renderFactoryAutomationVmSearchInfo(
      factoryRuntimeDetachedValue(factory), tone, factoryRuntimeDetachedValue(market),
    ),
    renderFactoryAutomationTaskChecklist,
    renderFactoryAutomationStatusCard,
    renderFactoryLightImage,
    renderCompetitorAnalyzeLogItems: logs => renderCompetitorAnalyzeLogItems(
      factoryRuntimeDetachedValue(logs),
    ),
    renderCompMarketScrapePanel: (snapshot, market, options) => renderCompMarketScrapePanel(snapshot, market, options),
  };
}

function factoryRuntimeAssetsActions() {
  return {
    runFactoryGuideAction(value, operationContext) {
      const action = String(value || '').trim();
      return factoryRuntimeBridgeAction(`factory/assets:guide:${action || '<empty>'}`, operationContext, draft => {
        const current = draft;
        current.automation = current.automation || {};
        if (action === 'go-tab:sections') {
          if (typeof compMarketRequireCurrentImageAnalysis === 'function'
            && !compMarketRequireCurrentImageAnalysis('섹션 생성으로 이동')) return false;
          return factoryRuntimeApplyTabSelection(draft, 'factory/sections');
        }
        const match = /^focus-asset-stage:(hero|size|options|cuts)$/.exec(action);
        if (!match) throw new Error(`unsupported factory assets guide action: ${action || '<empty>'}`);
        current.automation.activeTab = 'assets';
        current.automation.activeTaskId = 'asset-picks';
        current.automation.updatedAt = Date.now();
        current.uiPanels = current.uiPanels && typeof current.uiPanels === 'object' ? current.uiPanels : {};
        current.uiPanels.assets = true;
        scheduleLastWorkSave(900);
        const selector = `#factoryStageCard_${match[1]}`;
        setTimeout(() => document.querySelector(selector)?.scrollIntoView?.({ behavior: 'auto', block: 'start' }), 0);
        return selector;
      }, { render: true });
    },
    setFactoryStageTarget(stageId, value, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:setFactoryStageTarget', operationContext, draft => {
        const id = String(stageId || '').trim();
        if (!['hero', 'size', 'options', 'cuts'].includes(id)) throw new Error(`unknown factory asset stage: ${id || '<empty>'}`);
        const current = draft;
        current.stages[id] = current.stages[id] || {};
        current.stages[id].targetCount = Math.max(1, Math.min(12, Math.round(Number(value) || 1)));
        current.stages[id].updatedAt = Date.now();
        scheduleLastWorkSave(900);
        return current.stages[id].targetCount;
      });
    },
    setFactoryStagePrompt(stageId, value, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:setFactoryStagePrompt', operationContext, draft => {
        const id = String(stageId || '').trim();
        if (!['hero', 'size', 'options', 'cuts'].includes(id)) throw new Error(`unknown factory asset stage: ${id || '<empty>'}`);
        const current = draft;
        current.stages[id] = current.stages[id] || {};
        current.stages[id].prompt = String(value || '');
        current.stages[id].updatedAt = Date.now();
        scheduleLastWorkSave(900);
        return current.stages[id].prompt;
      });
    },
    runFactoryStage(stageId, operationContext) {
      const normalizedStageId = String(stageId || '').trim();
      return factoryRuntimeWithOperationLease('factory/assets:runFactoryStage', operationContext, operation => (
        factoryHandleRunStageButton({
          dataset: { factoryRunStage: normalizedStageId },
          disabled: false,
        }, {
          operationToken: operation.operationToken,
          operationSignal: operation.operationSignal,
        })
      ));
    },
    addFactoryStageInputFiles(stageId, files, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:addFactoryStageInputFiles', operationContext, draft => factoryAddStageInputFiles(String(stageId || '').trim(), files || [], { factory: draft }), );
    },
    createFactoryProductInputAsset(stageId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:createFactoryProductInputAsset', operationContext, draft => factoryCreateProductInputAsset(String(stageId || '').trim(), draft), );
    },
    sendFactoryAssetToStage(assetId, stageId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:sendFactoryAssetToStage', operationContext, draft => factorySendAssetToStage(String(assetId || ''), String(stageId || ''), draft, { save: false, render: false }), { render: true });
    },
    toggleFactoryAssetUse(assetId, operationContext) {
      // 진행 중인 다른 작업 때문에 이 클릭이 '오래된 것' 으로 판정되면 예외만 던지고 끝난다.
      // 그러면 사람 눈에는 버튼이 죽은 것으로 보인다("먹통이야 왜이래").
      // 삼키지 말고 왜 안 되는지 말한다.
      try {
        return factoryRuntimeBridgeAction('factory/assets:toggleFactoryAssetUse', operationContext, draft => factoryToggleAssetUse(String(assetId || ''), draft, { save: false, saveAssets: false, render: false }), { render: true });
      } catch (error) {
        if (typeof setUiNotice === 'function') {
          setUiNotice('다른 작업이 진행 중이라 이미지 선택이 반영되지 않았습니다. 생성이 끝난 뒤 다시 눌러주세요.', 'error');
        }
        throw error;
      }
    },
    selectFactoryACut(value, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:selectFactoryACut', operationContext, draft => {
        const payload = value && typeof value === 'object' ? value : {};
        const stageMap = {
          representative: 'hero',
          size: 'size',
          option_color: 'options',
          general: 'cuts',
          final_detail: 'detail',
        };
        const stageKey = String(payload.stageKey || '').trim();
        const stageId = stageMap[stageKey];
        const candidateId = String(payload.candidateId || '').trim();
        if (!stageId || !candidateId) throw new Error('factory_a_cut_candidate_invalid');
        const candidate = (draft.assets || []).find(asset => (
          String(asset?.id || '') === candidateId && String(asset?.stageId || '') === stageId
        ));
        if (!candidate || candidate.rejected) throw new Error('factory_a_cut_candidate_missing');
        if (!factoryAssetHasCurrentProductPayload(candidate, draft, { allowHtml: stageId === 'detail' })) {
          throw new Error('stale_run_fingerprint');
        }
        for (const asset of draft.assets || []) {
          if (String(asset?.stageId || '') === stageId) asset.used = asset.id === candidate.id;
        }
        candidate.rejected = false;
        draft.stages[stageId] = draft.stages[stageId] || {};
        draft.stages[stageId].selectedAssetIds = [candidate.id];
        draft.stages[stageId].status = 'done';
        draft.stages[stageId].updatedAt = Date.now();
        if (['size', 'options', 'cuts'].includes(stageId)) {
          factoryApplySelectedAssetsToSections(draft);
        }
        factoryLog(`${candidate.title || candidate.id} A컷 확정`, 'ok', draft);
        return Object.freeze({
          stageKey,
          candidateId: candidate.id,
          selectedAt: new Date().toISOString(),
        });
      }, { render: true });
    },
    toggleFactoryAssetReject(assetId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:toggleFactoryAssetReject', operationContext, draft => factoryToggleAssetReject(String(assetId || ''), draft, { render: false }), { render: true });
    },
    openFactoryAssetPreview(assetId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:openFactoryAssetPreview', operationContext, draft => factoryOpenAssetPreview(String(assetId || '')), { refresh: false },);
    },
    placeFactoryAsset(assetId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:placeFactoryAsset', operationContext, draft => factoryPlaceAsset(String(assetId || ''), draft, { save: false, render: false }), { render: true });
    },
    archiveFactoryAsset(assetId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:archiveFactoryAsset', operationContext, draft => {
        const asset = (draft.assets || []).find(item => String(item?.id || '') === String(assetId || ''));
        if (!asset) throw new Error(`unknown factory asset: ${String(assetId || '<empty>')}`);
        return factoryArchiveAsset(asset, draft);
      });
    },
    confirmFactorySizeImage(operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:confirmFactorySizeImage', operationContext, draft => {
        const current = draft;
        factoryUpdateFromInputs(current);
        factoryCommitVisibleDbSizeManualDrafts(document, { render: false, factory: current });
        current.automation = current.automation || {};
        const review = factoryAutomationSizeReviewStatus(current);
        if (review.requiredMissing.length) {
          factorySetStageStatus('size', 'blocked', '가로/세로 필수값을 먼저 채워야 합니다.', current);
          factoryLog('사이즈이미지 확인 중단: DB 필수 사이즈값이 없습니다.', 'warn', current);
          return false;
        }
        current.automation.sizeImageDbConfirmedKey = review.key;
        current.automation.sizeImageDbConfirmedAt = Date.now();
        current.automation.updatedAt = Date.now();
        factorySetStageStatus('size', 'idle', '확정 DB 사이즈값으로 생성할 준비가 됐습니다.', current);
        factoryLog('사이즈이미지용 DB 사이즈값을 확인했습니다.', 'ok', current);
        return true;
      }, { render: true });
    },
    openFactoryOptionSorter(operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:openFactoryOptionSorter', operationContext, draft => factoryOpenOptionSorterEditor({ factory: draft }), { render: false },);
    },
    syncFactoryDbOptions(operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:syncFactoryDbOptions', operationContext, draft => factorySyncDbOptionsToOptionSorter({ render: false, factory: draft }), { render: true },);
    },
    syncFactoryOptionResults(operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:syncFactoryOptionResults', operationContext, draft => factoryImportOptionSorterResults({ render: false, factory: draft }), { render: true },);
    },
    setFactoryOptionColorImageUsage(value, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:setFactoryOptionColorImageUsage', operationContext, draft => factorySetOptionColorImageUsage(value, { log: true, save: true, render: false, factory: draft }), { render: true },);
    },
    setFactoryGroupShotImageSelected(value) {
      const payload = value && typeof value === 'object' ? value : {};
      const selected = optSetGroupShotImageSelected(payload.imageId, payload.selected === true, state.optionSorter);
      optScheduleSave();
      saveLastWorkNow();
      render();
      return selected;
    },
    selectAllFactoryGroupShotImages() {
      const count = optSelectAllGroupShotImages(state.optionSorter);
      optScheduleSave();
      saveLastWorkNow();
      render();
      return count;
    },
    clearFactoryGroupShotImages() {
      const count = optClearGroupShotImages(state.optionSorter);
      optScheduleSave();
      saveLastWorkNow();
      render();
      return count;
    },
    setFactoryGroupShotPrompt(value) {
      state.optionSorter.optionGroupShotPrompt = String(value || '');
      optScheduleSave();
      return state.optionSorter.optionGroupShotPrompt;
    },
    generateFactoryGroupShot(operationContext) {
      return optGenerateOptionGroupShot({
        source: 'factory',
        operationToken: operationContext?.operationToken || null,
      });
    },
    toggleFactoryAssets(operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:toggleFactoryAssets', operationContext, draft => {
        const current = draft;
        current.assetListExpanded = !current.assetListExpanded;
        saveLastWorkNow();
        return current.assetListExpanded;
      }, { render: true });
    },
    toggleFactoryPreviousAssets(stageId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:toggleFactoryPreviousAssets', operationContext, draft => {
        const id = String(stageId || '').trim();
        const current = draft;
        current.previousAssetsExpanded = current.previousAssetsExpanded && typeof current.previousAssetsExpanded === 'object'
          ? current.previousAssetsExpanded
          : {};
        current.previousAssetsExpanded[id] = !current.previousAssetsExpanded[id];
        scheduleLastWorkSave(900);
        return current.previousAssetsExpanded[id];
      }, { render: true });
    },
    openFactoryStageFile(stageId, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:openFactoryStageFile', operationContext, draft => {
        document.getElementById(`factoryStageFile_${String(stageId || '').trim()}`)?.click?.();
        return true;
      }, { refresh: false });
    },
    openFactoryOptionColorFile(operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:openFactoryOptionColorFile', operationContext, draft => {
        document.querySelector('[data-factory-option-color-file]')?.click?.();
        return true;
      }, { refresh: false });
    },
    addFactoryCompletedFiles(files, operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:addFactoryCompletedFiles', operationContext, draft => factoryAddCompletedFiles(files || [], { factory: draft }), );
    },
    openFactoryCompletedFile(operationContext) {
      return factoryRuntimeBridgeAction('factory/assets:openFactoryCompletedFile', operationContext, draft => {
        document.getElementById('factoryCompleteFile')?.click?.();
        return true;
      }, { refresh: false });
    },
  };
}

function factoryRuntimeAssetsHelpers() {
  return {
    factoryAutomationCounts: factory => factoryAutomationCounts(factoryRuntimeDetachedValue(factory)),
    factoryAutomationWizardTasks: (factory, counts) => factoryAutomationWizardTasks(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(counts),
    ),
    renderFactoryAutomationStatusCard,
    renderFactoryAutomationAssetChooser: (factory, ...args) => renderFactoryAutomationAssetChooser(
      factoryRuntimeDetachedValue(factory),
      ...args,
    ),
    renderFactoryAutomationTaskChecklist,
  };
}

function factoryRuntimeSectionsGuideAction(value, operationContext) {
  const action = String(value || '').trim();
  return factoryRuntimeBridgeAction(`factory/sections:guide:${action || '<empty>'}`, operationContext, draft => {
    const current = draft;
    current.automation = current.automation || {};
    if (action === 'apply-sections') {
      const applied = factoryApplySelectedAssetsToSections(current);
      current.automation.sectionPromptPlan = {
        ...(current.automation.sectionPromptPlan && typeof current.automation.sectionPromptPlan === 'object'
          ? current.automation.sectionPromptPlan
          : {}),
        size: '확정 DB + 사이즈이미지 고정',
        options: current.automation.optionMode === 'none' ? '옵션 없음 문구 고정' : '옵션분류기 최종 결과 우선',
        db: '소재/구조/사용법은 DB 필드 우선',
        competitor: '후킹/활용/비교/구매 설득은 경쟁사 분석 + 선택 이미지컷',
        updatedAt: Date.now(),
      };
      current.automation.activeTaskId = 'section-ready';
      factoryLog(
        applied
          ? `선택한 생성컷 ${applied}개를 상세페이지 섹션 후보로 배치했습니다.`
          : '선택된 생성컷이 없어 섹션 배치 후보를 만들지 못했습니다.',
        applied ? 'ok' : 'warn',
        current,
      );
      return applied;
    }
    if (action === 'focus-detail-assets') {
      current.uiPanels = current.uiPanels && typeof current.uiPanels === 'object' ? current.uiPanels : {};
      current.uiPanels.assets = true;
      setTimeout(() => document.querySelector('#factoryAssetsSection')?.scrollIntoView?.({ behavior: 'auto', block: 'start' }), 0);
      return '#factoryAssetsSection';
    }
    throw new Error(`unsupported factory sections guide action: ${action || '<empty>'}`);
  }, { render: true });
}

function factoryRuntimeSectionsActions() {
  return {
    runFactoryGuideAction: factoryRuntimeSectionsGuideAction,
    runFactoryStage(value, operationContext) {
      const stageId = String(value || '').trim();
      return factoryRuntimeWithOperationLease('factory/sections:runFactoryStage', operationContext, operation => (
        factoryRuntimeBridgeAction('factory/sections:runFactoryStage', operationContext, draft => {
          if (stageId !== 'detail') throw new Error(`unsupported factory sections stage: ${stageId || '<empty>'}`);
          return factoryRunStage(stageId, {
            factory: draft,
            operationToken: operation.operationToken,
            operationSignal: operation.operationSignal,
          });
        }, { render: true })
      ));
    },
    applySectionVariant(value, operationContext) {
      assertRuntimeOperationContextCurrent(operationContext);
      const payload = value && typeof value === 'object' ? value : {};
      const sectionId = String(payload.sectionId || '').trim();
      const variantId = String(payload.variantId || '').trim();
      if (!sectionId || !variantId) throw new Error('factory_section_variant_invalid');
      applySectionVariant(sectionId, variantId);
      return true;
    },
  };
}

function factoryRuntimeSectionsHelpers() {
  return {
    factoryAutomationCounts: factory => factoryAutomationCounts(factoryRuntimeDetachedValue(factory)),
    factoryAutomationWizardTasks: (factory, counts) => factoryAutomationWizardTasks(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(counts),
    ),
    factoryAutomationReviewSummary: (factory, counts) => factoryAutomationReviewSummary(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(counts),
    ),
    renderFactoryAutomationStatusCard,
    renderFactoryAutomationTaskChecklist,
  };
}

function factoryRuntimeBatchCommandError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function factoryRuntimeAuthoritativeWorkspaceRevision() {
  const scopeId = String(getCurrentLastWorkWorkspaceScope() || '').trim();
  const authority = typeof window !== 'undefined'
    ? window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.()
    : null;
  const authorityRevision = Number(authority?.revision);
  if (
    authority?.mode === 'editing'
    && String(authority.scopeId || '').trim() === scopeId
    && Number.isInteger(authorityRevision)
    && authorityRevision >= 0
  ) {
    return Object.freeze({ scopeId, counter: authorityRevision });
  }
  return currentWorkspaceRevision(scopeId);
}

async function factoryRuntimeSha256Text(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function factoryRuntimeBatchImageReferences(factory = {}) {
  const seen = new Set();
  return (Array.isArray(factory.assets) ? factory.assets : [])
    .filter(asset => asset?.used && asset?.type === 'image')
    .map(asset => {
      const archiveId = String(
        asset.metadata?.localArchiveId
        || asset.sourceMap?.localArchiveId
        || asset.sourceMap?.sourceArchiveId
        || '',
      ).trim();
      const reference = archiveId
        ? `local-archive:${archiveId}`
        : String(
          asset.imageUrl
          || asset.metadata?.imageUrl
          || asset.thumbnailUrl
          || (typeof asset.image === 'string' ? asset.image : '')
          || '',
        ).trim();
      if (!reference || seen.has(reference)) return '';
      seen.add(reference);
      return reference;
    })
    .filter(Boolean);
}

function factoryRuntimeBatchCafe24Binding(value = {}) {
  return Object.freeze({
    productId: String(value.productId || '').trim(),
    productKey: String(value.productKey || '').trim(),
    categoryId: String(value.categoryId || '').trim(),
    htmlDigest: String(value.htmlDigest || '').trim(),
    imageDigests: Object.freeze((Array.isArray(value.imageDigests) ? value.imageDigests : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .sort()),
    idempotencyKey: String(value.idempotencyKey || '').trim(),
    expectedWorkfileRevision: Number(value.expectedWorkfileRevision),
    expectedRunId: String(value.expectedRunId || '').trim(),
    expectedInputFingerprint: String(value.expectedInputFingerprint || '').trim(),
  });
}

function factoryRuntimeBatchCafe24BindingMatches(left, right) {
  return JSON.stringify(factoryRuntimeBatchCafe24Binding(left))
    === JSON.stringify(factoryRuntimeBatchCafe24Binding(right));
}

async function factoryRuntimeVerifiedCafe24Readback(batch) {
  if (batch.selling !== 'F' || batch.display !== 'F' || batch.market_sync !== 'F') {
    throw factoryRuntimeBatchCommandError('unsafe_cafe24_defaults');
  }
  const sourceProductNo = String(batch.productId || '').startsWith('cafe24:')
    ? String(batch.productId).slice('cafe24:'.length).trim()
    : '';
  if (!sourceProductNo) throw factoryRuntimeBatchCommandError('approval_target_required');
  const finalFactory = factoryRuntimeReadViewSnapshot().factory;
  if (!factoryRuntimeBatchCafe24BindingMatches(finalFactory.product?.cafe24BatchControlBinding, batch)) {
    throw factoryRuntimeBatchCommandError('stale_run_fingerprint');
  }
  const registrationReceipt = finalFactory.product?.cafe24RegistrationReceipt;
  if (registrationReceipt?.status !== 'verified') {
    throw factoryRuntimeBatchCommandError('factory_cafe24_result_unverified');
  }
  const finalTarget = factoryCafe24TargetInfo(finalFactory);
  const finalProductNo = String(registrationReceipt.productNo || finalTarget?.productNo || '').trim();
  const sameProductUpdate = registrationReceipt.mode === 'update' && finalProductNo === sourceProductNo;
  if (
    !finalProductNo
    || String(finalTarget?.productNo || '').trim() !== finalProductNo
    || (finalProductNo === sourceProductNo && !sameProductUpdate)
  ) {
    throw factoryRuntimeBatchCommandError('factory_cafe24_target_mismatch');
  }
  const finalDetail = await fetchCafe24ProductFullByNo(
    finalProductNo,
    finalTarget?.mallId || CAFE24_CONTROL_API.defaultMallId,
  );
  const finalRaw = parseCafe24Raw(finalDetail) || finalDetail?.raw || finalDetail || {};
  if (
    String(finalRaw.product_name || '').trim() !== String(batch.productKey || '').trim()
    || String(finalRaw.display || '').trim() !== 'F'
    || String(finalRaw.selling || '').trim() !== 'F'
    || String(finalRaw.market_sync || '').trim() !== 'F'
  ) {
    throw factoryRuntimeBatchCommandError('factory_cafe24_safe_readback_mismatch');
  }
  const remoteHtml = String(finalRaw.description || finalRaw.mobile_description || '').trim();
  if (!remoteHtml) throw factoryRuntimeBatchCommandError('factory_cafe24_readback_missing');
  const remoteHtmlDigest = await factoryRuntimeSha256Text(remoteHtml);
  const remoteImageDigests = await Promise.all(
    [finalRaw.detail_image, finalRaw.list_image, finalRaw.small_image, finalRaw.tiny_image]
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .map(factoryRuntimeSha256Text),
  );
  const categoryIds = typeof factoryCafe24CategoryNoSet === 'function'
    ? [...factoryCafe24CategoryNoSet(finalRaw)].sort()
    : [];
  if (!categoryIds.includes(String(batch.categoryId || '').trim())) {
    throw factoryRuntimeBatchCommandError('factory_cafe24_category_readback_mismatch');
  }
  const verifiedReadback = registrationReceipt.readback && typeof registrationReceipt.readback === 'object'
    ? registrationReceipt.readback
    : {};
  const optionValues = Array.isArray(verifiedReadback.optionValues)
    ? verifiedReadback.optionValues.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  const inventoryByOption = Object.fromEntries(Object.entries(
    verifiedReadback.inventoryByOption && typeof verifiedReadback.inventoryByOption === 'object'
      ? verifiedReadback.inventoryByOption
      : {},
  ).map(([key, value]) => [String(key), Object.freeze({
    quantity: String(value?.quantity ?? '').trim(),
    useInventory: String(value?.useInventory ?? '').trim().toUpperCase(),
  })]));
  const variantCount = Number(verifiedReadback.variantCount || 0);
  if (
    finalFactory.automation?.optionMode === 'provided'
    && (
      !optionValues.length
      || variantCount !== optionValues.length
      || optionValues.some(value => (
        inventoryByOption[value]?.quantity !== '99'
        || inventoryByOption[value]?.useInventory !== 'T'
      ))
    )
  ) {
    throw factoryRuntimeBatchCommandError('factory_cafe24_options_readback_mismatch');
  }
  const remoteReadback = Object.freeze({
    productNo: finalProductNo,
    productCode: String(finalRaw.product_code || '').trim(),
    productName: String(finalRaw.product_name || '').trim(),
    display: 'F',
    selling: 'F',
    marketSync: 'F',
    categoryIds,
    representativeImageCount: Number(verifiedReadback.representativeImageCount || 0),
    detailImageCount: Number(verifiedReadback.detailImageCount || 0),
    optionValues: Object.freeze(optionValues),
    variantCount,
    inventoryByOption: Object.freeze(inventoryByOption),
    detailHtmlDigest: remoteHtmlDigest,
    imageDigests: Object.freeze(remoteImageDigests),
    updatedAt: String(finalRaw.updated_date || finalRaw.updated_at || registrationReceipt.verifiedAt || '').trim(),
  });
  const remoteReadbackDigest = await factoryRuntimeSha256Text(JSON.stringify(remoteReadback));
  return Object.freeze({
    status: 'staged_verified',
    externalProductNo: finalProductNo,
    remoteReadbackDigest,
    remoteReadback,
    remoteHtmlDigest,
    remoteImageDigests: Object.freeze(remoteImageDigests),
    categoryIds: Object.freeze(categoryIds),
  });
}

async function factoryRuntimeRunBatchCafe24Registration(value, operationContext = {}) {
  const batch = value?.batchControl && typeof value.batchControl === 'object'
    ? value.batchControl
    : null;
  if (!batch) throw factoryRuntimeBatchCommandError('factory_cafe24_command_payload_invalid');
  if (batch.selling !== 'F' || batch.display !== 'F' || batch.market_sync !== 'F') {
    throw factoryRuntimeBatchCommandError('unsafe_cafe24_defaults');
  }
  const expectedProductNo = String(batch.productId || '').startsWith('cafe24:')
    ? String(batch.productId).slice('cafe24:'.length).trim()
    : '';
  if (!expectedProductNo) throw factoryRuntimeBatchCommandError('approval_target_required');
  const initialFactory = factoryRuntimeReadViewSnapshot().factory;
  const initialProduct = initialFactory.product || {};
  const priorCreateFailure = [
    initialProduct.cafe24ApiStatus,
    initialFactory.openMarketSync?.finalRegistrationStatus,
  ].map(value => String(value || '')).join(' ');
  const initialTargetProductNo = String(factoryCafe24TargetInfo(initialFactory)?.productNo || '').trim();
  let recoveredExactProduct = null;
  let recoveredExactProductNo = '';
  if (
    initialTargetProductNo === expectedProductNo
    && /본체 생성 후 후속 동기화 실패/.test(priorCreateFailure)
    && typeof factoryFindLiveCafe24ProductByExactName === 'function'
  ) {
    const productName = String(batch.productKey || initialProduct.productName || '').trim();
    const candidate = await factoryFindLiveCafe24ProductByExactName(productName, CAFE24_CONTROL_API.defaultMallId);
    const rawCandidate = typeof parseCafe24Raw === 'function' ? (parseCafe24Raw(candidate) || candidate || {}) : (candidate || {});
    const candidateProductNo = String(candidate?.product_no || rawCandidate.product_no || '').trim();
    const expectedNumber = Number(expectedProductNo);
    const candidateNumber = Number(candidateProductNo);
    const isLaterProduct = Number.isFinite(expectedNumber) && Number.isFinite(candidateNumber)
      ? candidateNumber > expectedNumber
      : candidateProductNo !== expectedProductNo;
    if (candidateProductNo && isLaterProduct) {
      recoveredExactProduct = candidate;
      recoveredExactProductNo = candidateProductNo;
    }
  }
  const store = factoryRuntimeRequireStore();
  const operationToken = operationContext?.operationToken || store.getOperationToken();
  const prepared = await factoryRuntimeBridgeAction(
    'factory/publish:batch-control-prepare',
    { operationToken },
    async draft => {
      const revision = factoryRuntimeAuthoritativeWorkspaceRevision();
      const product = draft.product ||= {};
      const bindingMatches = factoryRuntimeBatchCafe24BindingMatches(product.cafe24BatchControlBinding, batch);
      const registrationReceipt = product.cafe24RegistrationReceipt;
      if (bindingMatches && registrationReceipt?.status === 'verified') {
        return Object.freeze({ alreadyVerified: true });
      }
      if (!bindingMatches && Number(revision?.counter) !== Number(batch.expectedWorkfileRevision)) {
        throw factoryRuntimeBatchCommandError('stale_workfile_revision');
      }
      const productKey = typeof factoryCurrentProductKey === 'function'
        ? factoryCurrentProductKey(draft)
        : String(draft.product?.currentProductKey || draft.product?.productKey || '').trim();
      const currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
        ? factoryCurrentWorkflowRunId(draft)
        : String(draft.automation?.currentRunId || draft.product?.currentRunId || '').trim();
      const inputFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
        ? factoryCurrentInputImageFingerprint(draft)
        : String(draft.product?.lockedInputImageFingerprint || draft.product?.inputImageFingerprint || '').trim();
      let targetProductNo = String(factoryCafe24TargetInfo(draft)?.productNo || '').trim();
      if (recoveredExactProduct && recoveredExactProductNo && typeof factoryAttachCafe24ProductAsCurrentTarget === 'function') {
        const recovered = factoryAttachCafe24ProductAsCurrentTarget(
          recoveredExactProduct,
          `batch-control-partial-create:${recoveredExactProductNo}`,
          draft,
        );
        targetProductNo = String(recovered?.productNo || recoveredExactProductNo).trim();
        product.cafe24ApiStatus = `Cafe24 부분 등록 복구: 새 상품 #${targetProductNo}을 이어서 수정합니다.`;
      }
      if (
        productKey !== String(batch.productKey || '').trim()
        || currentRunId !== String(batch.expectedRunId || '').trim()
        || inputFingerprint !== String(batch.expectedInputFingerprint || '').trim()
      ) {
        throw factoryRuntimeBatchCommandError('stale_run_fingerprint');
      }
      const partialProductNo = String(
        product.cafe24LastSaveVerification?.productNo
        || registrationReceipt?.productNo
        || '',
      ).trim();
      const resumesCreatedProduct = (
        registrationReceipt?.status !== 'verified'
        && registrationReceipt?.mode === 'update'
        && targetProductNo === String(registrationReceipt.productNo || '').trim()
      ) || (
        bindingMatches
        && targetProductNo !== expectedProductNo
        && (targetProductNo === partialProductNo || targetProductNo === recoveredExactProductNo)
      );
      const revisesPublishedProduct = (
        registrationReceipt?.status === 'verified'
        && targetProductNo === String(registrationReceipt.productNo || '').trim()
      );
      if (targetProductNo !== expectedProductNo && !resumesCreatedProduct) {
        throw factoryRuntimeBatchCommandError('factory_cafe24_target_mismatch');
      }
      const detail = factoryEnsureCurrentDetailHtmlAsset(draft);
      const detailHtml = String(detail?.html || '').trim();
      if (!detailHtml || await factoryRuntimeSha256Text(detailHtml) !== String(batch.htmlDigest || '').trim()) {
        throw factoryRuntimeBatchCommandError('stale_detail_html_digest');
      }
      const imageDigests = await Promise.all(
        factoryRuntimeBatchImageReferences(draft).map(factoryRuntimeSha256Text),
      );
      const expectedImageDigests = Array.isArray(batch.imageDigests)
        ? batch.imageDigests.map(item => String(item || '').trim()).filter(Boolean)
        : [];
      if (
        imageDigests.length !== expectedImageDigests.length
        || [...imageDigests].sort().some((digest, index) => digest !== [...expectedImageDigests].sort()[index])
      ) {
        throw factoryRuntimeBatchCommandError('stale_image_digest');
      }
      const sync = factoryEnsureOpenMarketSync(draft);
      sync.finalTarget = 'cafe24_only';
      sync.cafe24RegistrationMode = resumesCreatedProduct || revisesPublishedProduct ? 'update' : 'create';
      sync.cafe24RegistrationModeUserTouched = true;
      sync.cafe24Display = 'F';
      sync.cafe24Selling = 'F';
      sync.selectedChannels = [];
      product.cafe24BatchControlBinding = factoryRuntimeBatchCafe24Binding(batch);
      product.finalDb = product.finalDb && typeof product.finalDb === 'object' ? product.finalDb : {};
      product.finalDb.category = [{
        category_no: String(batch.categoryId || '').trim(),
        display_group: '1',
        recommend: 'F',
        new: 'F',
      }];
      factoryApplyFinalCafe24StatusToDb(draft);
      return Object.freeze({
        productNo: targetProductNo,
        htmlDigest: batch.htmlDigest,
        imageDigests: Object.freeze(imageDigests),
      });
    },
    { render: false },
  );
  if (prepared.value?.alreadyVerified) return factoryRuntimeVerifiedCafe24Readback(batch);
  const registrationResult = await factoryRunFinalRegistration({
    operationToken: prepared.operationToken,
    skipConfirm: true,
    forceInventoryQuantity: '99',
    historySource: 'batch-control-approved',
  });
  if (registrationResult !== true) {
    const latestFactory = factoryRuntimeReadViewSnapshot().factory;
    const failureReason = String(
      latestFactory?.openMarketSync?.finalRegistrationStatus
      || latestFactory?.product?.cafe24RegistrationReceipt?.error
      || latestFactory?.product?.cafe24ApiStatus
      || '',
    ).trim();
    throw factoryRuntimeBatchCommandError(
      failureReason
        ? `factory_cafe24_registration_failed: ${failureReason}`
        : 'factory_cafe24_registration_failed',
    );
  }
  await factoryRuntimeBridgeAction(
    'factory/publish:batch-control-prepare',
    { operationToken: store.getOperationToken() },
    draft => {
      const productKey = typeof factoryCurrentProductKey === 'function'
        ? factoryCurrentProductKey(draft)
        : String(draft.product?.currentProductKey || draft.product?.productKey || '').trim();
      const currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
        ? factoryCurrentWorkflowRunId(draft)
        : String(draft.automation?.currentRunId || draft.product?.currentRunId || '').trim();
      const inputFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
        ? factoryCurrentInputImageFingerprint(draft)
        : String(draft.product?.lockedInputImageFingerprint || draft.product?.inputImageFingerprint || '').trim();
      if (
        productKey !== String(batch.productKey || '').trim()
        || currentRunId !== String(batch.expectedRunId || '').trim()
        || inputFingerprint !== String(batch.expectedInputFingerprint || '').trim()
      ) {
        throw factoryRuntimeBatchCommandError('stale_run_fingerprint');
      }
      draft.product.cafe24BatchControlBinding = factoryRuntimeBatchCafe24Binding(batch);
    },
    { render: false },
  );
  return factoryRuntimeVerifiedCafe24Readback(batch);
}

function factoryRuntimeCafe24CategorySelection(factory = {}, remoteRaw = {}) {
  const product = factory.product || {};
  const finalDb = product.finalDb || {};
  const finalDbCategoryRows = Array.isArray(finalDb.category)
    ? finalDb.category
    : (finalDb.category && typeof finalDb.category === 'object' ? [finalDb.category] : []);
  const explicitId = String(
    finalDb.category_no
    || finalDb.categoryId
    || finalDbCategoryRows.at(-1)?.category_no
    || finalDbCategoryRows.at(-1)?.categoryNo
    || finalDbCategoryRows.at(-1)?.no
    || product.categoryId
    || '',
  ).trim();
  const remoteSource = remoteRaw.category ?? remoteRaw.categories ?? [];
  const remoteRows = Array.isArray(remoteSource)
    ? remoteSource
    : (remoteSource && typeof remoteSource === 'object' ? [remoteSource] : []);
  const remoteId = String(
    remoteRows.at(-1)?.category_no
    || remoteRows.at(-1)?.categoryNo
    || remoteRows.at(-1)?.no
    || '',
  ).trim();
  const categoryId = explicitId || remoteId;
  const reference = (Array.isArray(product.cafe24ReferenceLists?.categories)
    ? product.cafe24ReferenceLists.categories
    : []).find(item => String(item?.code || item?.id || item?.category_no || '').trim() === categoryId);
  const remoteRow = remoteRows.find(item => String(
    item?.category_no || item?.categoryNo || item?.no || '',
  ).trim() === categoryId);
  const normalized = remoteRow && typeof factoryCafe24NormalizeReferenceItem === 'function'
    ? factoryCafe24NormalizeReferenceItem(remoteRow, 'categories')
    : null;
  const categoryLabel = String(
    reference?.name || reference?.label || normalized?.name || normalized?.label || '',
  ).trim();
  return Object.freeze({ categoryId, categoryLabel: categoryLabel === categoryId ? '' : categoryLabel });
}

async function factoryRuntimeResolveCafe24Category(factory = {}, productNo = '') {
  let selected = factoryRuntimeCafe24CategorySelection(factory);
  const target = typeof factoryCafe24TargetInfo === 'function' ? factoryCafe24TargetInfo(factory) : null;
  const mallId = String(target?.mallId || target?.mall_id || CAFE24_CONTROL_API.defaultMallId).trim();
  try {
    if (!selected.categoryId && productNo && typeof fetchCafe24ProductDetailByNo === 'function') {
      const detail = await fetchCafe24ProductDetailByNo(productNo, mallId);
      const raw = typeof parseCafe24Raw === 'function'
        ? (parseCafe24Raw(detail) || detail?.raw || detail?.rawProduct || {})
        : (detail?.raw || detail?.rawProduct || {});
      selected = factoryRuntimeCafe24CategorySelection(factory, raw);
    }
    if (selected.categoryId && !selected.categoryLabel && typeof callCafe24Console === 'function') {
      const body = await callCafe24Console(
        'GET',
        `/api/v2/admin/categories/${encodeURIComponent(selected.categoryId)}`,
        { mallId },
        `Read Cafe24 category ${selected.categoryId}`,
      );
      const source = typeof unwrapApiHubBody === 'function' ? unwrapApiHubBody(body) : body;
      const response = source?.data?.response || source?.response || source?.data || source || {};
      selected = factoryRuntimeCafe24CategorySelection(factory, {
        category: response.category || response.categories?.[0] || {},
      });
    }
  } catch (_) {}
  return selected;
}

async function factoryRuntimeInspectBatchCafe24Registration() {
  const factory = factoryRuntimeReadViewSnapshot().factory;
  const productKey = typeof factoryCurrentProductKey === 'function'
    ? factoryCurrentProductKey(factory)
    : String(factory.product?.currentProductKey || factory.product?.productKey || '').trim();
  const currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
    ? factoryCurrentWorkflowRunId(factory)
    : String(factory.automation?.currentRunId || factory.product?.currentRunId || '').trim();
  const inputFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
    ? factoryCurrentInputImageFingerprint(factory)
    : String(factory.product?.lockedInputImageFingerprint || factory.product?.inputImageFingerprint || '').trim();
  const productNo = String(factoryCafe24TargetInfo(factory)?.productNo || '').trim();
  const revision = factoryRuntimeAuthoritativeWorkspaceRevision();
  const category = await factoryRuntimeResolveCafe24Category(factory, productNo);
  const detail = typeof factoryCafe24CurrentScopedDetailHtml === 'function'
    ? factoryCafe24CurrentScopedDetailHtml(factory)
    : { html: '' };
  const detailHtml = String(detail?.html || '').trim();
  const htmlDigest = detailHtml ? await factoryRuntimeSha256Text(detailHtml) : '';
  const imageDigests = await Promise.all(
    factoryRuntimeBatchImageReferences(factory).map(factoryRuntimeSha256Text),
  );
  const storedBinding = factory.product?.cafe24BatchControlBinding;
  const storedImageDigests = Array.isArray(storedBinding?.imageDigests)
    ? storedBinding.imageDigests.map(item => String(item || '').trim()).filter(Boolean).sort()
    : [];
  const currentImageDigests = imageDigests.map(item => String(item || '').trim()).filter(Boolean).sort();
  const reuseStoredBinding = Boolean(
    storedBinding
    && String(storedBinding.idempotencyKey || '').startsWith('cafe24-stage:v6:')
    && String(storedBinding.productKey || '').trim() === productKey
    && String(storedBinding.categoryId || '').trim() === category.categoryId
    && String(storedBinding.htmlDigest || '').trim() === htmlDigest
    && String(storedBinding.expectedRunId || '').trim() === currentRunId
    && String(storedBinding.expectedInputFingerprint || '').trim() === inputFingerprint
    && storedImageDigests.length === currentImageDigests.length
    && storedImageDigests.every((digest, index) => digest === currentImageDigests[index])
  );
  const optionGroup = Array.isArray(factory.product?.cafe24OptionGroupsDraft)
    ? factory.product.cafe24OptionGroupsDraft.find(group => Array.isArray(group?.values) && group.values.length)
    : null;
  const optionValues = Array.isArray(optionGroup?.values)
    ? [...new Set(optionGroup.values.map(value => String(value || '').trim()).filter(Boolean))]
    : [];
  const variantCount = optionValues.length;
  const providedOptionsRequired = factory.automation?.optionMode === 'provided';
  const optionsReady = !providedOptionsRequired || (optionValues.length > 0 && variantCount === optionValues.length);
  const ready = Boolean(
    productNo
    && productKey
    && currentRunId
    && inputFingerprint
    && Number.isInteger(Number(revision?.counter))
    && detailHtml
    && imageDigests.length
    && optionsReady
  );
  return Object.freeze({
    schema: 'factory-cafe24-preflight:v1',
    status: ready ? 'ready' : 'blocked',
    reason: ready
      ? ''
      : !optionsReady
        ? 'factory_cafe24_options_incomplete'
        : String(detail?.message || detail?.source || 'factory_cafe24_preflight_incomplete'),
    productId: productNo ? `cafe24:${productNo}` : '',
    productKey,
    categoryId: category.categoryId,
    categoryLabel: category.categoryLabel,
    htmlDigest,
    imageDigests: Object.freeze(imageDigests),
    optionName: String(optionGroup?.name || '').trim(),
    optionValues: Object.freeze(optionValues),
    variantCount,
    inventoryQuantity: '99',
    expectedWorkfileRevision: reuseStoredBinding
      ? Number(storedBinding.expectedWorkfileRevision)
      : Number(revision?.counter),
    expectedRunId: currentRunId,
    expectedInputFingerprint: inputFingerprint,
  });
}

async function factoryRuntimeVerifyBatchCafe24Registration(value) {
  const batch = value?.batchControl && typeof value.batchControl === 'object'
    ? value.batchControl
    : null;
  if (!batch) throw factoryRuntimeBatchCommandError('factory_cafe24_command_payload_invalid');
  const preflight = await factoryRuntimeInspectBatchCafe24Registration();
  if (preflight.status !== 'ready') {
    throw factoryRuntimeBatchCommandError('factory_cafe24_preflight_incomplete');
  }
  if (Number(preflight.expectedWorkfileRevision) !== Number(batch.expectedWorkfileRevision)) {
    throw factoryRuntimeBatchCommandError('stale_workfile_revision');
  }
  for (const [actual, expected] of [
    [preflight.productId, batch.productId],
    [preflight.productKey, batch.productKey],
    [preflight.expectedRunId, batch.expectedRunId],
    [preflight.expectedInputFingerprint, batch.expectedInputFingerprint],
  ]) {
    if (String(actual || '').trim() !== String(expected || '').trim()) {
      throw factoryRuntimeBatchCommandError('stale_run_fingerprint');
    }
  }
  if (String(preflight.htmlDigest || '').trim() !== String(batch.htmlDigest || '').trim()) {
    throw factoryRuntimeBatchCommandError('stale_detail_html_digest');
  }
  const actualImageDigests = Array.isArray(preflight.imageDigests)
    ? preflight.imageDigests.map(item => String(item || '').trim()).filter(Boolean).sort()
    : [];
  const expectedImageDigests = Array.isArray(batch.imageDigests)
    ? batch.imageDigests.map(item => String(item || '').trim()).filter(Boolean).sort()
    : [];
  if (
    actualImageDigests.length !== expectedImageDigests.length
    || actualImageDigests.some((digest, index) => digest !== expectedImageDigests[index])
  ) {
    throw factoryRuntimeBatchCommandError('stale_image_digest');
  }
  return factoryRuntimeVerifiedCafe24Readback(batch);
}

function factoryRuntimePublishGuideAction(value, operationContext) {
  const action = typeof value === 'string' ? value.trim() : String(value?.action || '').trim();
  if (action === 'inspect-batch-cafe24-registration') {
    return factoryRuntimeInspectBatchCafe24Registration();
  }
  if (action === 'verify-batch-cafe24-registration') {
    return factoryRuntimeVerifyBatchCafe24Registration(value);
  }
  const store = factoryRuntimeRequireStore();
  const operationToken = operationContext?.operationToken || store.getOperationToken();
  if (action === 'resume-exact-cafe24-product') {
    return factoryResumeLatestExactCafe24Product();
  }
  if (action === 'run-final-registration') {
    return factoryRunFinalRegistration({ operationToken });
  }
  if (action === 'run-batch-cafe24-registration') {
    return factoryRuntimeRunBatchCafe24Registration(value, { operationToken });
  }
  return factoryRuntimeBridgeAction(`factory/publish:guide:${action || '<empty>'}`, { operationToken }, draft => (
    Promise.resolve().then(() => {
      if (!store.isOperationCurrent(operationToken)) throw factoryRuntimeStaleActionError(`factory/publish:guide:${action || '<empty>'}`);
      const current = draft;
      if (action === 'focus-stage-log') {
        const target = document.querySelector('.factory-run-status-rail');
        target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        return !!target;
      }
      current.automation = current.automation || {};
      current.uiPanels = current.uiPanels && typeof current.uiPanels === 'object' ? current.uiPanels : {};
      if (action === 'focus-final-registration') {
        current.automation.activeTab = 'publish';
        current.automation.activeTaskId = 'publish-ready';
        current.automation.lastWizardActionAt = Date.now();
        current.uiPanels.materials = true;
        saveLastWorkNow();
        setTimeout(() => {
          const target = document.querySelector('#factoryPublishInlineFinalPanel #factoryFinalRegistrationPanel')
            || document.querySelector('#factoryFinalRegistrationPanel')
            || document.querySelector('[data-factory-open-market-panel], #factoryMaterialReviewSection');
          target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          target?.querySelector?.('button, input, textarea, select')?.focus?.();
        }, 0);
        return '#factoryFinalRegistrationPanel';
      }
      if (action === 'focus-materials') {
        current.uiPanels.materials = true;
        saveLastWorkNow();
        setTimeout(() => document.querySelector('#factoryMaterialReviewSection')?.scrollIntoView?.({ behavior: 'auto', block: 'start' }), 0);
        return '#factoryMaterialReviewSection';
      }
      throw new Error(`unsupported factory publish guide action: ${action || '<empty>'}`);
    })
  ), {
    refresh: action !== 'focus-stage-log',
    render: action !== 'focus-stage-log',
  });
}

function factoryRuntimePublishHelpers() {
  return {
    factoryAutomationCounts: factory => factoryAutomationCounts(factoryRuntimeDetachedValue(factory)),
    factoryAutomationWizardTasks: (factory, counts) => factoryAutomationWizardTasks(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(counts),
    ),
    factoryFinalRegistrationSettings: factory => factoryFinalRegistrationSettings(
      factoryRuntimeDetachedValue(factory),
    ),
    renderFactoryAutomationStatusCard,
    renderFactoryAutomationTaskChecklist,
    factoryRenderCacheBaseDraft: (factory, cache) => factoryRenderCacheBaseDraft(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(cache),
    ),
    factoryOpenMarketBuildBaseDraft: (factory, options) => factoryOpenMarketBuildBaseDraft(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(options),
    ),
    factoryRenderCacheFinalCafe24Model: (factory, cache) => factoryRenderCacheFinalCafe24Model(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(cache),
    ),
    factoryRenderCacheFinalDetailModel: (factory, cache) => factoryRenderCacheFinalDetailModel(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(cache),
    ),
    factoryFinalRegistrationCafe24Model: (factory, options) => factoryFinalRegistrationCafe24Model(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(options),
    ),
    orderedSections: () => factoryRuntimeDetachedValue(SECTIONS),
    escapeHtml,
    disabledAttr,
    renderFactoryFinalRegistrationPanel: (factory, baseDraft, options) => renderFactoryFinalRegistrationPanel(
      factoryRuntimeDetachedValue(factory),
      factoryRuntimeDetachedValue(baseDraft),
      factoryRuntimeDetachedValue(options),
    ),
  };
}

function installFactoryRuntimeStart(moduleNamespaces) {
  const createFactoryStore = moduleNamespaces['src/modules/factory-store.mjs']?.createFactoryStore;
  const createStartFactoryTab = moduleNamespaces['src/menus/factory/tabs/start-tab.mjs']?.createStartFactoryTab;
  const createDbFactoryTab = moduleNamespaces['src/menus/factory/tabs/db-tab.mjs']?.createDbFactoryTab;
  const createFieldsFactoryTab = moduleNamespaces['src/menus/factory/tabs/fields-tab.mjs']?.createFieldsFactoryTab;
  const createCompetitorFactoryTab = moduleNamespaces['src/menus/factory/tabs/competitor-tab.mjs']?.createCompetitorFactoryTab;
  const createAssetsFactoryTab = moduleNamespaces['src/menus/factory/tabs/assets-tab.mjs']?.createAssetsFactoryTab;
  const createSectionsFactoryTab = moduleNamespaces['src/menus/factory/tabs/sections-tab.mjs']?.createSectionsFactoryTab;
  const createPublishFactoryTab = moduleNamespaces['src/menus/factory/tabs/publish-tab.mjs']?.createPublishFactoryTab;
  const createFactoryMenu = moduleNamespaces['src/menus/factory/factory-menu.mjs']?.createFactoryMenu;
  if (typeof createFactoryStore !== 'function') throw new TypeError('missing factory runtime capability: createFactoryStore');
  if (typeof createStartFactoryTab !== 'function') throw new TypeError('missing factory runtime capability: createStartFactoryTab');
  if (typeof createDbFactoryTab !== 'function') throw new TypeError('missing factory runtime capability: createDbFactoryTab');
  if (typeof createFieldsFactoryTab !== 'function') throw new TypeError('missing factory runtime capability: createFieldsFactoryTab');
  if (typeof createCompetitorFactoryTab !== 'function') throw new TypeError('missing factory runtime capability: createCompetitorFactoryTab');
  if (typeof createAssetsFactoryTab !== 'function') throw new TypeError('missing factory runtime capability: createAssetsFactoryTab');
  if (typeof createSectionsFactoryTab !== 'function') throw new TypeError('missing factory runtime capability: createSectionsFactoryTab');
  if (typeof createPublishFactoryTab !== 'function') throw new TypeError('missing factory runtime capability: createPublishFactoryTab');
  if (typeof createFactoryMenu !== 'function') throw new TypeError('missing factory runtime capability: createFactoryMenu');
  factoryRuntimeStore?.dispose?.();
  factoryRuntimeStore = createFactoryStore({
    initialSnapshot: factoryRuntimeInitialSnapshot(),
    workspaceId: factoryRuntimeWorkspaceId(),
    revision: 0,
    commandPolicies: FACTORY_RUNTIME_COMMAND_POLICIES,
    assertMutable() {
      if (workspaceAuthorityIsReadOnly()) throw new Error('READ_ONLY');
    },
    reportError: factoryRuntimeReportError,
  });
  factoryRuntimeStartTab = createStartFactoryTab(factoryRuntimeCapabilities(
    factoryRuntimeStartActions(),
    { escapeHtml, escAttr, renderFactoryLightImage },
  ));
  factoryRuntimeDbTab = createDbFactoryTab(factoryRuntimeCapabilities(
    factoryRuntimeDbActions(),
    factoryRuntimeDbHelpers(),
    'product-db',
  ));
  factoryRuntimeFieldsTab = createFieldsFactoryTab(factoryRuntimeCapabilities(
    factoryRuntimeFieldsActions(),
    factoryRuntimeFieldsHelpers(),
    'product-db',
  ));
  factoryRuntimeCompetitorTab = createCompetitorFactoryTab(factoryRuntimeCapabilities(
    {
      runGuideAction: factoryRuntimeCompetitorGuideAction,
      runMarketAction: factoryRuntimeCompetitorMarketAction,
    },
    factoryRuntimeCompetitorHelpers(),
    'competitors',
  ));
  factoryRuntimeAssetsTab = createAssetsFactoryTab(factoryRuntimeCapabilities(
    factoryRuntimeAssetsActions(),
    factoryRuntimeAssetsHelpers(),
    'factory-assets',
  ));
  factoryRuntimeSectionsTab = createSectionsFactoryTab(factoryRuntimeCapabilities(
    factoryRuntimeSectionsActions(),
    factoryRuntimeSectionsHelpers(),
    'detail-document',
  ));
  factoryRuntimePublishTab = createPublishFactoryTab(factoryRuntimeCapabilities(
    { runFactoryGuideAction: factoryRuntimePublishGuideAction },
    factoryRuntimePublishHelpers(),
    'cafe24',
  ));
  const tabs = new Map([
    ['factory/start', factoryRuntimeStartTab],
    ['factory/db', factoryRuntimeDbTab],
    ['factory/fields', factoryRuntimeFieldsTab],
    ['factory/competitor', factoryRuntimeCompetitorTab],
    ['factory/assets', factoryRuntimeAssetsTab],
    ['factory/sections', factoryRuntimeSectionsTab],
    ['factory/publish', factoryRuntimePublishTab],
  ]);
  const tabRegistry = Object.freeze(FACTORY_RUNTIME_TAB_IDS.map((id, order) => Object.freeze({
    id,
    kind: 'factory-tab',
    order,
    api: 'factory-tab:v1',
  })));
  runtimeMenuModules.set('factory', createFactoryMenu({
    getSnapshot: factoryRuntimeReadViewSnapshot,
    assertMutable: owner => factoryRuntimeRequireStore().assertMutable(owner || 'factory'),
    getOperationToken: () => factoryRuntimeRequireStore().getOperationToken(),
    isOperationCurrent: factoryRuntimeIsOperationCurrent,
    reportError: error => factoryRuntimeRequireStore().reportError(
      error instanceof Error ? error : new Error(String(error || 'factory runtime error')),
    ),
    actions: Object.freeze({
      selectFactoryTab,
      jumpFactoryStage,
      setFactoryStageLogFilter,
      runFactoryShellGuideAction,
    }),
    renderHelpers: Object.freeze({
      renderFactoryAutomationRunStatus,
      renderFactoryWorkspacePanel: typeof renderFactoryWorkspacePanel === 'function'
        ? renderFactoryWorkspacePanel
        : () => '',
    }),
    tabs,
    tabRegistry,
  }));
}

var factoryEnsureRequiredLocalServices = async () => true;

function installRuntimeMenuModules(moduleNamespaces = {}) {
  const ensureRequiredLocalServices = moduleNamespaces['src/modules/local-service-preflight.mjs']?.ensureRequiredLocalServices;
  if (typeof ensureRequiredLocalServices === 'function') {
    factoryEnsureRequiredLocalServices = (factory, options = {}) => ensureRequiredLocalServices(factory, {
      factoryBackendBaseUrl,
      state,
      fetchJsonWithTimeout,
      factoryLog,
      render,
      renderFactoryDraft: factoryRuntimeRenderWithOwnedDraft,
      window,
    }, options);
  }
  if (Object.keys(moduleNamespaces).some(moduleId => moduleId === 'src/modules/factory-store.mjs' || moduleId.startsWith('src/menus/factory/'))) {
    installFactoryRuntimeStart(moduleNamespaces);
  }
  const createCafe24Domain = moduleNamespaces['src/domains/cafe24/index.mjs']?.createCafe24Domain;
  if (typeof createCafe24Domain === 'function' && typeof installCafe24ConsolePayloadGuard === 'function') {
    const cafe24Domain = createCafe24Domain();
    installCafe24ConsolePayloadGuard(cafe24Domain.payloadGuard);
  }
  const createModelSettingsMenu = moduleNamespaces['src/menus/modelsettings-menu.mjs']?.createModelSettingsMenu;
  if (typeof createModelSettingsMenu === 'function') {
    runtimeMenuModules.set('modelsettings', createModelSettingsMenu({
      providers: LLM_PROVIDERS,
      imageModels: IMAGE_MODELS,
      normalizeConfig: normalizeModelConfig,
      getImageProvider,
      getRuntimeOpenAIKey,
      renderGptOAuthPanel: renderGptOAuthLlmPanel,
      disabledAttr,
      isGptOAuthConnected,
      getReasoningLabel: getGptOAuthReasoningLabel,
      getServiceTierLabel: getGptOAuthServiceTierLabel,
      escapeHtml,
      assertMutable() {
        if (workspaceAuthorityIsReadOnly()) throw new Error('READ_ONLY');
      },
      getSnapshot() {
        return {
          modelConfig: state.modelConfig,
          backendBaseUrl: state.backendBaseUrl,
          apiKey: state.apiKey,
          vertexConfig: state.vertexConfig,
        };
      },
      updatePreferences(patch = {}) {
        if (patch.modelConfig) state.modelConfig = normalizeModelConfig(patch.modelConfig);
        if (Object.prototype.hasOwnProperty.call(patch, 'backendBaseUrl')) state.backendBaseUrl = patch.backendBaseUrl;
        if (patch.vertexConfig) state.vertexConfig = patch.vertexConfig;
      },
      savePreferences(patch = {}) {
        if (Object.prototype.hasOwnProperty.call(patch, 'backendBaseUrl')) saveBackendUrl(patch.backendBaseUrl);
        if (patch.modelConfig) {
          saveModelConfig(patch.modelConfig);
          savePersistentState();
        }
      },
      saveCredentials(credentials = {}) {
        state.apiKey = String(credentials.geminiKey || '').trim();
        saveKey(state.apiKey);
        const openaiKey = String(credentials.openaiKey || '').trim();
        if (openaiKey) state.openaiKey = openaiKey;
        saveOpenAIKey(state.openaiKey);
        gemini = hasGeminiConnection() ? createGeminiClient() : null;
      },
      async loadVertexConfig() {
        const base = state.auto.serverApiBase || 'http://127.0.0.1:4000/v1';
        const response = await fetch(`${base}/pdp/vertex-config`);
        return response.json();
      },
      async saveVertexConfig(value) {
        const base = state.auto.serverApiBase || 'http://127.0.0.1:4000/v1';
        const response = await fetch(`${base}/pdp/vertex-config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        });
        return response.json();
      },
      updateVertexConfig(value = {}) {
        state.vertexConfig = { project: value.project || '', location: value.location || 'us-central1' };
      },
      applyGptOAuthPreset(presetId) {
        const changed = applyGptOAuthPreset(presetId);
        if (changed) render();
        return changed;
      },
      selectGptOAuthModel(modelId) {
        state.modelConfig.llmProvider = 'gpt_oauth';
        state.modelConfig.llmModel = modelId;
        if (state.gptOAuthProbe && state.gptOAuthProbe.uiModel !== modelId) state.gptOAuthProbe = null;
        state.modelConfig = normalizeModelConfig(state.modelConfig);
        const policy = gptOAuthModelTierPolicy(modelId);
        if (policy.allowFast === false) state.modelConfig.gptOAuthServiceTier = 'standard';
        state.modelConfig = normalizeModelConfig(state.modelConfig);
        saveModelConfig(state.modelConfig);
        savePersistentState();
        render();
        return state.modelConfig;
      },
      selectGptOAuthReasoning(reasoningEffort) {
        state.modelConfig.gptOAuthReasoningEffort = normalizeGptOAuthReasoningEffort(reasoningEffort);
        state.modelConfig.llmProvider = 'gpt_oauth';
        state.modelConfig = normalizeModelConfig(state.modelConfig);
        saveModelConfig(state.modelConfig);
        savePersistentState();
        render();
        return state.modelConfig;
      },
      selectGptOAuthServiceTier(serviceTier) {
        state.modelConfig.gptOAuthServiceTier = normalizeGptOAuthServiceTier(serviceTier, state.modelConfig?.llmModel);
        state.modelConfig.llmProvider = 'gpt_oauth';
        state.modelConfig = normalizeModelConfig(state.modelConfig);
        saveModelConfig(state.modelConfig);
        savePersistentState();
        render();
        return state.modelConfig;
      },
      useGptOAuthAsLlm(modelId) {
        if (modelId) state.modelConfig.llmModel = modelId;
        state.modelConfig.llmProvider = 'gpt_oauth';
        state.modelConfig = normalizeModelConfig(state.modelConfig);
        saveModelConfig(state.modelConfig);
        savePersistentState();
        render();
        return state.modelConfig;
      },
      refreshGptOAuthStatus: () => refreshGptOAuthStatus({ silent: false }),
      refreshClaudeOAuthStatus: () => refreshClaudeOAuthStatus({ silent: false }),
      openClaudeOAuthLogin: force => openClaudeOAuthLogin(force === true),
      probeGptOAuth: () => probeGptOAuthLiveCall({ silent: false }),
      openGptOAuthLogin: force => openGptOAuthLogin(force === true),
      requestRender: render,
      reportError(error) {
        state.error = String(error?.message || error);
      },
      getOperationToken() {
        return currentRuntimeMenuOperationToken();
      },
      schedule: (callback, delay) => setTimeout(callback, delay),
      alertUser: message => alert(message),
    }));
  }
  const createAutomationMenu = moduleNamespaces['src/menus/automation-menu.mjs']?.createAutomationMenu;
  if (typeof createAutomationMenu === 'function') {
    const requestAutomationJson = async (path, options = {}, requireOk = true) => {
      const base = normalizeServerAutomationApiBase(state.auto.serverApiBase);
      assertServerAutomationApiBaseAllowed(base);
      const response = await fetch(`${base}${path}`, options);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || (requireOk && !data?.ok)) {
        throw new Error(data?.message || data?.error || `자동화 API 요청 실패 (${response.status})`);
      }
      return data;
    };
    runtimeMenuModules.set('automation', createAutomationMenu({
      getSnapshot() {
        return {
          automation: state.auto,
          savedClientId: state.auto.gdClientId || localStorage.getItem('gd_client_id') || '',
          logs: autoLogs,
        };
      },
      assertMutable() {
        if (workspaceAuthorityIsReadOnly()) throw new Error('READ_ONLY');
      },
      updateAutomation(patch = {}) {
        const next = { ...patch };
        if (Array.isArray(next.processedFileIds)) next.processedFileIds = new Set(next.processedFileIds);
        Object.assign(state.auto, next);
      },
      persistAutomation(patch = {}) {
        if (Object.prototype.hasOwnProperty.call(patch, 'serverApiBase')) {
          state.auto.serverApiBase = saveServerAutomationApiBase(patch.serverApiBase);
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'intervalMin')) localStorage.setItem('auto_interval', String(patch.intervalMin));
        for (const kind of ['input', 'output']) {
          const idKey = `${kind}FolderId`;
          const nameKey = `${kind}FolderName`;
          if (Object.prototype.hasOwnProperty.call(patch, idKey)) localStorage.setItem(`auto_${kind}_folder_id`, String(patch[idKey] || ''));
          if (Object.prototype.hasOwnProperty.call(patch, nameKey)) localStorage.setItem(`auto_${kind}_folder_name`, String(patch[nameKey] || ''));
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'processedFileIds')) {
          const ids = patch.processedFileIds instanceof Set ? [...patch.processedFileIds] : patch.processedFileIds;
          localStorage.setItem('auto_processed_ids', JSON.stringify(Array.isArray(ids) ? ids : []));
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'totalProcessed')) localStorage.setItem('auto_total_processed', String(patch.totalProcessed || 0));
        if (Object.prototype.hasOwnProperty.call(patch, 'completed')) localStorage.setItem('auto_completed', JSON.stringify(patch.completed || []));
      },
      async refreshServer(base) {
        state.auto.serverApiBase = normalizeServerAutomationApiBase(base || state.auto.serverApiBase);
        return requestAutomationJson('/pdp/automation/config');
      },
      applyServerSnapshot(data, request = null) {
        if (!data || typeof data !== 'object') return;
        state.auto.serverConfig = data;
        state.auto.serverStatus = data.status || null;
        state.auto.serverLoading = false;
        state.auto.serverError = '';
        const serverCuts = data?.profiles?.['image-cuts']?.customCuts;
        if (Array.isArray(serverCuts) && serverCuts.some(cut => cut?.prompt?.trim())) {
          const serverCount = countDraftCutPrompts(serverCuts);
          const localCount = countDraftCutPrompts(state.auto.draftCuts);
          if (!state.auto.draftCutsFromServer || serverCount > localCount) {
            mergeServerDraftCutsFromConfig(serverCuts);
            state.auto.draftCutsFromServer = true;
          }
        }
        if (request && typeof request === 'object' && request.mode) {
          const enabled = request.profile?.enabled;
          autoLog(enabled === true ? 'ok' : 'info', enabled === true
            ? `${request.mode} 자동화 실행 시작됨`
            : (enabled === false ? `${request.mode} 자동화 설정을 저장했습니다.` : '서버 자동화 설정을 저장했습니다.'));
        } else {
          autoLog('ok', '서버 자동화 상태를 불러왔습니다.');
        }
        if (state.step === 'automation') render();
      },
      async pollServerStatus(base) {
        state.auto.serverApiBase = normalizeServerAutomationApiBase(base || state.auto.serverApiBase);
        return requestAutomationJson('/pdp/automation/status', {}, false);
      },
      applyServerStatus(data) {
        state.auto.serverStatus = data || null;
        patchAutomationStatusInPlace();
      },
      connectDrive: clientId => {
        if (clientId) {
          state.auto.gdClientId = String(clientId).trim();
          localStorage.setItem('gd_client_id', state.auto.gdClientId);
        }
        return connectDrive();
      },
      async setFolder(value = {}) {
        const id = extractFolderId(value.id || '');
        if (!id) throw new Error('Google Drive 폴더 ID를 입력하세요.');
        autoLog('info', `${value.kind === 'output' ? '출력' : '입력'} 폴더 ID 추출: ${id}`);
        try {
          if (!driveService && !await ensureDriveServiceReady()) throw new Error('Google Drive 연결이 필요합니다.');
          return { id, name: await driveService.getFolderName(id) };
        } catch (error) {
          autoLog('err', `폴더 이름 조회 실패: ${error.message || error}`);
          return { id, name: id };
        }
      },
      async saveProfile(value = {}) {
        return requestAutomationJson('/pdp/automation/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profiles: { [value.mode]: value.profile } }),
        });
      },
      async runMode(value = {}) {
        const config = await requestAutomationJson('/pdp/automation/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profiles: { [value.mode]: value.profile } }),
        });
        const run = await requestAutomationJson('/pdp/automation/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: value.mode }),
        });
        return { mode: value.mode, config, run };
      },
      applyRunResult(result) {
        if (result?.config) state.auto.serverConfig = result.config;
        if (result?.run?.status) state.auto.serverStatus = result.run.status;
        autoLog('info', result?.run?.message || `${result?.mode || '자동화'} 실행을 요청했습니다.`);
        patchAutomationStatusInPlace();
        if (state.step === 'automation') render();
      },
      setModeEnabled(value = {}) {
        return requestAutomationJson('/pdp/automation/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profiles: { [value.mode]: value.profile } }),
        });
      },
      async refreshOutput(mode) {
        const data = await requestAutomationJson(`/pdp/automation/output-images?mode=${encodeURIComponent(mode)}&limit=12`);
        return { mode, images: Array.isArray(data.images) ? data.images : [] };
      },
      applyOutputResult(result) {
        ensureAutomationOutputBuckets();
        state.auto.outputImages[result.mode] = result.images;
        state.auto.outputImagesError[result.mode] = '';
        state.auto.outputImagesLoading[result.mode] = false;
        if (result.images.length) autoLog('ok', `${automationOutputModeLabel(result.mode)} 최근 출력 ${result.images.length}장을 불러왔습니다.`);
        if (state.step === 'automation') render();
      },
      openOutputPreview: ({ mode, index }) => openAutomationOutputPreview(mode, index),
      startAutomation,
      stopAutomation,
      runOnce() {
        autoLog('info', '수동 1회 실행');
        return autoProcessOne();
      },
      resetProcessed() {
        autoLog('info', '처리 기록 초기화됨');
      },
      requestRender: render,
      getOperationToken() {
        return currentRuntimeMenuOperationToken();
      },
      setIntervalFn: (callback, delay) => setInterval(callback, delay),
      clearIntervalFn: timer => clearInterval(timer),
      formatServerDriveMessage,
      renderModeEditor: renderServerAutomationModeEditor,
      renderPlacementPanel: renderDetailSectionPlacementPanel,
      makeDefaultProfile,
      disabledAttr,
      escapeHtml,
      escapeAttr: escAttr,
      extractFolderId,
      parsePositiveInt,
      getDraftCuts: () => state.auto.draftCuts || [],
      updateDraftCut(index, field, value) {
        if (!state.auto.draftCuts[index]) state.auto.draftCuts[index] = { label: `컷 ${index + 1}`, prompt: '' };
        state.auto.draftCuts[index][field] = value;
        saveDraftCuts(state.auto.draftCuts);
      },
      recoverDraftCuts: recoverServerDraftCutsFromBackups,
      reportError(error) {
        state.auto.serverLoading = false;
        state.auto.serverError = String(error?.message || error);
        autoLog('err', `서버 자동화 연결 실패: ${state.auto.serverError}`);
        if (state.step === 'automation') render();
      },
    }));
  }
  const createImageCutsMenu = moduleNamespaces['src/menus/imagecuts-menu.mjs']?.createImageCutsMenu;
  if (typeof createImageCutsMenu === 'function') {
    runtimeMenuModules.set('imagecuts', createImageCutsMenu({
      getSnapshot: () => ({ cuts: state.cuts }),
      assertMutable() {
        if (workspaceAuthorityIsReadOnly()) throw new Error('READ_ONLY');
      },
      updateCuts(patch = {}) {
        Object.assign(state.cuts, patch);
      },
      updatePrompt(value = {}) {
        const rows = value.kind === 'size' ? state.cuts.sizePrompts : state.cuts.prompts;
        if (!rows?.[value.index]) return;
        Object.assign(rows[value.index], value.patch || {});
        if (value.kind !== 'size') saveCutPromptSlotBackup(value.index, rows[value.index], { force: true, allowEmpty: true });
      },
      updatePlacement(value = {}) {
        if (!state.cuts.placement || typeof state.cuts.placement !== 'object') state.cuts.placement = {};
        if (value.value) state.cuts.placement[value.sectionId] = value.value;
        else delete state.cuts.placement[value.sectionId];
      },
      persistCuts(entry = {}) {
        const reason = entry.reason || '';
        if (reason === 'work-drive-folder') {
          localStorage.setItem('cuts_work_drive_folder_id', state.cuts.workDriveFolderId || '');
          localStorage.setItem('cuts_work_drive_folder_name', state.cuts.workDriveFolderName || '');
          saveLastWorkNow();
          return;
        }
        if (reason === 'placement') {
          savePlacement();
          scheduleLastWorkSave();
          return;
        }
        if (reason === 'prompt' || reason === 'rename-prompt') savePrompts();
        if (reason === 'style-reference' || reason === 'rename-prompt') saveLastWorkNow();
      },
      requestRender: render,
      getOperationToken() {
        return currentRuntimeMenuOperationToken();
      },
      promptUser: (message, value) => prompt(message, value),
      reportError(error) {
        state.error = String(error?.message || error);
        if (state.step === 'imagecuts') renderPreservingMainScroll();
      },
      actions: {
        loadSource: loadCutSource,
        goFactoryStart() {
          state.step = 'factory';
          factoryRuntimeUpdateOwnedFactory('factory:selectFactoryTab', 'factory', factory => {
            factory.automation = factory.automation || {};
            factory.automation.activeTab = 'start';
          });
          cutsScheduleLightSave(400);
          render();
          setTimeout(() => document.getElementById('factoryProductDrop')?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 80);
        },
        clearSource: clearCutSourceImage,
        loadWorkImage: loadCutWorkImage,
        clearWorkImage,
        runWorkDrive: runCutsWorkDriveAutomation,
        chooseArchive: chooseCutsArchiveFolder,
        archiveAll: cutsArchiveAllLocal,
        downloadAll: cutsDownloadAllResultsFallback,
        async saveSession() {
          restoreCutImagePayloadsFromPreview(state.cuts);
          state.cuts.localArchiveStatus = '현재 이미지컷 작업을 브라우저 작업공간에 저장했습니다.';
          savePrompts();
          saveLastWorkNow();
          if (sessionAssetsHydrated) await saveSessionAssetsToDb().catch(() => {});
          renderPreservingMainScroll();
        },
        recoverPrompts: recoverCutPromptsFromBackup,
        resetGeneration() {
          const changed = clearCutGenerationRuntimeState();
          if (!changed) {
            cutsAppendRunLog('초기화할 생성 상태가 없습니다.', 'info');
            renderPreservingMainScroll();
          }
        },
        setCutSlotCount: setCutPromptSlotCount,
        setSizeSlotCount: setSizeCutPromptSlotCount,
        generateCut,
        generateSizeCut,
        generateAllCuts,
        generateAllSizeCuts,
        clearCutResults() {
          const cutIds = new Set((state.cuts.prompts || []).map(item => item.id));
          state.cuts.prompts.forEach(item => { item.result = null; item.generating = false; });
          Object.entries(state.cuts.placement || {}).forEach(([sectionId, value]) => {
            const placementValue = String(value || '');
            if (placementValue.startsWith('cut:') || cutIds.has(placementValue)) delete state.cuts.placement[sectionId];
          });
          savePlacement();
          saveLastWorkNow();
          render();
        },
        clearSizeResults() {
          const sizeIds = new Set((state.cuts.sizePrompts || []).map(item => `size:${item.id}`));
          state.cuts.sizePrompts.forEach(item => { item.result = null; item.generating = false; });
          Object.entries(state.cuts.placement || {}).forEach(([sectionId, value]) => {
            const placementValue = String(value || '');
            if (placementValue.startsWith('size:') || sizeIds.has(placementValue)) delete state.cuts.placement[sectionId];
          });
          state.cuts.sizeRunBusy = false;
          clearSizeCutResultCache(state.cuts);
          savePlacement();
          savePrompts();
          saveLastWorkNow();
          renderPreservingMainScroll();
        },
        applyPlacement,
        async resolveWorkFolder(folderId) {
          if (!driveService) return { id: folderId, name: folderId };
          try {
            const meta = await driveService.getFolderMeta(folderId);
            return { id: folderId, name: meta.name || folderId };
          } catch (_) {
            return { id: folderId, name: folderId };
          }
        },
      },
      renderHelpers: {
        defaultPromptCount: CUTS_DEFAULT_PROMPT_COUNT,
        maxPromptCount: CUTS_MAX_PROMPT_COUNT,
        sessionAssetsHydrated: () => typeof sessionAssetsHydrated !== 'undefined' && !!sessionAssetsHydrated,
        hasPromptFields: () => !!document.querySelector('[data-cut-prompt]'),
        hasDriveService: () => !!driveService,
        factoryClearDisconnectedImageGenerationRuntime: options => typeof factoryClearDisconnectedImageGenerationRuntime === 'function' ? factoryClearDisconnectedImageGenerationRuntime(options) : undefined,
        cutsClearOverdueGenerationRuntime: options => typeof cutsClearOverdueGenerationRuntime === 'function' ? cutsClearOverdueGenerationRuntime(options) : undefined,
        factoryHasCurrentPageImageGenerationRun: cuts => typeof factoryHasCurrentPageImageGenerationRun === 'function' && factoryHasCurrentPageImageGenerationRun(cuts),
        factoryClearRestoredImageGenerationRuntime: options => typeof factoryClearRestoredImageGenerationRuntime === 'function' ? factoryClearRestoredImageGenerationRuntime(options) : undefined,
        cutsHasActiveImageGeneration,
        syncCutPromptsFromDom,
        cutsShouldRunRenderMaintenance,
        restoreCutImagePayloadsFromPreview,
        normalizeCutPromptSlotCount,
        normalizeCutPrompts,
        restoreSizeCutResultsFromCache,
        factoryRestoreCutPromptResultsFromAssets,
        clearLocalFallbackResultsFromPrompts,
        applyLatestCutPromptSlotBackups,
        restoreGeneralCutsAfterSizeMix,
        clearFinishedCutGenerationFlagsFromLogs,
        factoryRejectLocalFallbackAssetsForStage,
        cutsDataUrlFromPayload,
        cutsCurrentLockedProductSourceState,
        cutImageFingerprint,
        factoryCutPromptPreviewSrc,
        getCurrentImageRunInfo,
        hasImageConnection,
        renderCutsRunLogPanel,
        renderFactoryLightImage,
        cutGeneratingHelperText,
        cutsVisibleLogText,
        renderFactoryCutPromptPreviewImage,
        renderSizeCutsPanel,
        renderDetailSectionPlacementPanel,
        disabledAttr,
        escapeHtml,
        escapeAttr: escAttr,
      },
    }));
  }
  const createOptionSorterMenu = moduleNamespaces['src/menus/optionsorter-menu.mjs']?.createOptionSorterMenu;
  if (typeof createOptionSorterMenu === 'function') {
    runtimeMenuModules.set('optionsorter', createOptionSorterMenu({
      getSnapshot: () => ({ optionSorter: state.optionSorter }),
      assertMutable() {
        if (workspaceAuthorityIsReadOnly()) throw new Error('READ_ONLY');
      },
      mutateOptions(action = {}) {
        ensureOptionSorterDefaults(state.optionSorter);
        if (action.type === 'add-slot' && action.slot) state.optionSorter.slots.push(action.slot);
        if (action.type === 'set-sub-step') {
          state.optionSorter.subStep = action.subStep === 'sort' ? 'sort' : 'input';
          state.optionSorter.subStepUpdatedAt = Date.now();
        }
      },
      persistOptions() {
        optScheduleSave();
      },
      getSlotNamePresets: getOptionSlotNamePresets,
      saveSlotNamePreset: saveOptionSlotNamePreset,
      async loadVisionColors() {
        await optRefreshVisionColorHints();
        return { applied: true };
      },
      applyVisionColors() {},
      restoreArchivedSourceImages: optRestoreSourceImagesFromLocalArchive,
      requestRender: render,
      getOperationToken() {
        return currentRuntimeMenuOperationToken();
      },
      reportError(error) {
        state.error = String(error?.message || error);
        if (state.step === 'optionsorter') renderPreservingMainScroll();
      },
      bindHelpers: {
        getCurrentStep: () => state.step,
        getActiveElement: () => document.activeElement,
        getSortable: () => window.Sortable,
        reportWarning: (...args) => console.warn(...args),
        applyOptionGenerationPipeline,
        clampOptionSheetCount,
        clampOptionSheetPixels,
        clearFixedDetailImage,
        clearOptionColorSectionPlacement,
        defaultOptionSorterState,
        detectOptionTonePresetId,
        ensureDefaultSectionPlacements,
        ensureOptionSorterDefaults,
        factorySendOptionSorterResultsToFactory,
        getOptionGenerationPipeline,
        getOptionImagePairs,
        getOptionOutputSheets,
        getOptionToneDisplayName,
        getOptionTonePreset,
        handleFixedDetailImageFile,
        optAddImages,
        optAppendLogs,
        optApplyOptionSheetPixelPreset,
        optArchiveAllOptionResults,
        optArchiveOptionResult,
        optChooseArchiveFolder,
        optClearGroupShotImages,
        optClearStyleSample,
        optDeleteSlot,
        optDeleteStyleSampleFromLibrary,
        optDownloadAllOptionResults,
        optDownloadOptionResult,
        optDownloadOptionResultSplits,
        optDownloadSlot,
        optFocusSlotNameByIndex,
        optGenerateOptionGroupShot,
        optGenerateOptionImages,
        optGetArchiveDirectoryHandle,
        optGetOptionSheetPixelRecommendations,
        optGetOptionSheetSize,
        optGetPixelAspectWarning,
        optGetSelectedLayoutPattern,
        optLayoutSummaryFromSheets,
        optLoadArchiveFolderStatus,
        optOpenImagePreview,
        optParseLayoutPatternInput,
        optRefreshOptionSheetPixelForLayout,
        optRefreshVisionColorHints,
        optRenderPatternPreview,
        optScheduleSave,
        optSelectAllGroupShotImages,
        optSetColorImageUsage,
        optSetGroupShotImageSelected,
        optSetStyleSample,
        optSetStyleSampleFromLibrary,
        optSetStyleSampleFromResult,
        optSwapOptionPairOrder,
        optSyncSlotCountToImages,
        optUseExistingColorImagesFromResult,
        readImageFileAsDataUrl,
        saveLastWorkNow,
        syncOptFromDOM,
        syncOptSlotsFromDOM,
        uid,
      },
      renderHelpers: {
        ensureOptionSorterDefaults,
        optMissingImagePayloadCount,
        renderOptionSorterSourceStrip,
        renderOptionSorterAssignmentWorkspace,
        renderOptionImageGeneratorPanel,
        optRenderImageOrPlaceholder,
        renderOptionSorterImagePreviewModal,
        disabledAttr,
        escapeHtml,
      },
    }));
  }
  const runtimeDomainMenuBase = getSnapshot => ({
    getSnapshot,
    assertMutable() {
      if (workspaceAuthorityIsReadOnly()) throw new Error('READ_ONLY');
    },
    getOperationToken() {
      return currentRuntimeMenuOperationToken();
    },
    isOperationCurrent(operationToken) {
      return factoryRuntimeIsOperationCurrent(operationToken);
    },
    reportError(error) {
      const message = String(error?.message || error || '메뉴 작업 중 오류가 발생했습니다.');
      if (message !== 'READ_ONLY') state.error = message;
      if (runtimeMenuModules.has(state.step)) renderPreservingMainScroll();
    },
  });
  const runtimeRouteNavigate = target => {
    const route = String(target || '').trim();
    if (!route) return false;
    state.step = route;
    saveLastWorkNow();
    render();
    return true;
  };

  const createReportsMenu = moduleNamespaces['src/menus/reports-menu.mjs']?.createReportsMenu;
  if (typeof createReportsMenu === 'function') {
    const reportApiBase = () => (
      state.backendBaseUrl || 'http://127.0.0.1:5050'
    ).replace(/\/+$/, '');
    const readReportResponse = async response => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `작업 리포트 요청 실패 (HTTP ${response.status})`);
      }
      return payload;
    };
    runtimeMenuModules.set('reports', createReportsMenu({
      fetchReports() {
        return fetch(`${reportApiBase()}/api/workfile-reports`, {
          cache: 'no-store',
        }).then(readReportResponse);
      },
      openReportFolder() {
        return fetch(`${reportApiBase()}/api/workfile-reports/folder/open`, {
          method: 'POST',
          cache: 'no-store',
        }).then(readReportResponse);
      },
      requestRender: render,
      escapeHtml,
      escapeAttr: escAttr,
      resetScroll: () => document.querySelector('.app')?.scrollTo({ top: 0, behavior: 'auto' }),
    }));
  }

  const createManualMenu = moduleNamespaces['src/menus/manual-menu.mjs']?.createManualMenu;
  if (typeof createManualMenu === 'function') {
    runtimeMenuModules.set('manual', createManualMenu({
      getWorkflowSteps: imageAnalysisWorkflowSteps,
      escapeHtml,
      navigate: runtimeRouteNavigate,
    }));
  }

  const createUploadMenu = moduleNamespaces['src/menus/upload-menu.mjs']?.createUploadMenu;
  if (typeof createUploadMenu === 'function') {
    runtimeMenuModules.set('upload', createUploadMenu({
      ...runtimeDomainMenuBase(() => ({
        analysisImages: state.analysisImages,
        imagePreview: state.imagePreview,
        productName: state.productName,
      })),
      actions: {
        uploadFiles(files) {
          return handleMultipleFiles(files);
        },
        updateProductName(value) {
          if (typeof factorySetCurrentProductIdentity === 'function') {
            factorySetCurrentProductIdentity(value, {
              syncDom: false,
              syncFinal: false,
              rotateWorkIdentity: true,
            });
          } else {
            state.productName = value;
          }
          scheduleLastWorkSave();
        },
        saveProductName() {
          saveLastWorkNow();
        },
        clearAnalysisImages() {
          state.analysisImages = [];
          state.imagePreview = null;
          state.imageBase64 = null;
          state.imageMime = null;
          resetProductAnalysisDerivedState({ clearDb: true });
          saveLastWorkNow();
          render();
        },
        removeAnalysisImage(index) {
          state.analysisImages.splice(index, 1);
          const primary = state.analysisImages[0] || null;
          state.imagePreview = primary?.preview || null;
          state.imageBase64 = primary?.base64 || null;
          state.imageMime = primary?.mime || null;
          clearStaleImageDependentAnalysis('분석 이미지 구성이 바뀌어 이전 이미지 추론/DB 매칭값을 분리했습니다.');
          saveLastWorkNow();
          render();
        },
        startAnalysis(_value, operationContext) {
          return startAnalysis(operationContext);
        },
      },
      renderHelpers: { renderFactoryLightImage, analysisImageSrc, disabledAttr, escapeHtml },
    }));
  }

  const analysisPanelActions = {
    toggleAnalysisLog() {
      state.analysisLogOpen = !state.analysisLogOpen;
      render();
    },
    toggleRawJson() {
      state.showRawJson = !state.showRawJson;
      render();
    },
    selectBrandPreset(value) {
      state.activeBrandPresetId = String(value || '');
      state.brandPresetDraft = getInitialBrandPresetDraft(state.activeBrandPresetId);
      saveActiveBrandPresetId(state.activeBrandPresetId);
      markContentChanged();
      render();
    },
    selectLayoutTemplate(value) {
      state.layoutTemplate = String(value || '');
      saveLayoutTemplate(state.layoutTemplate);
      markContentChanged();
      render();
    },
    createBrandPreset() {
      state.activeBrandPresetId = '';
      state.brandPresetDraft = createEmptyBrandPreset();
      render();
    },
    saveBrandPreset() {
      return saveBrandPresetFromDraft();
    },
    deleteBrandPreset() {
      return deleteActiveBrandPreset();
    },
    updateBrandPresetDraft(value = {}) {
      const fields = new Set([
        'name', 'tone', 'requiredKeywords', 'bannedPhrases', 'headlineFont', 'bodyFont',
        'accentColor', 'backgroundColor', 'imageDirectives', 'globalInstruction',
      ]);
      const field = String(value.field || '');
      if (!fields.has(field)) return;
      state.brandPresetDraft = normalizeBrandPreset({
        ...state.brandPresetDraft,
        [field]: value.value,
      });
      scheduleLastWorkSave();
    },
  };
  const analysisMenuNamespace = moduleNamespaces['src/menus/analysis-menu.mjs'] || {};
  const createAnalysisMenu = analysisMenuNamespace.createAnalysisMenu;
  const bindAnalysisPanelEvents = analysisMenuNamespace.bindAnalysisPanelEvents
    || createAnalysisMenu?.bindAnalysisPanelEvents;
  if (typeof createAnalysisMenu === 'function') {
    runtimeMenuModules.set('analyzing', createAnalysisMenu({
      ...runtimeDomainMenuBase(() => ({
        progress: state.progress,
        progressMsg: state.progressMsg,
      })),
      actions: {
        ...analysisPanelActions,
        stopAnalysis() {
          return stopActiveAnalysisRun('분석 요청을 중단하고 AI 분석 종합 화면으로 돌아왔습니다. 다시 실행해도 됩니다.');
        },
        updateProductName(value) {
          if (typeof factorySetCurrentProductIdentity === 'function') {
            factorySetCurrentProductIdentity(value, {
              syncDom: false,
              syncFinal: false,
              rotateWorkIdentity: true,
            });
          }
          else state.productName = value;
          scheduleLastWorkSave();
        },
        commitProductName() { saveLastWorkNow(); render(); },
        updateNaturalText(value) {
          const settings = getAnalysisMatchSettings();
          settings.naturalText = value;
          state.analysisMatchSettings = settings;
          scheduleLastWorkSave();
        },
        commitNaturalText() { saveLastWorkNow(); render(); },
        setUseName(value) {
          const settings = getAnalysisMatchSettings();
          settings.useName = !!value;
          state.analysisMatchSettings = settings;
          savePersistentState(); render();
        },
        setUseNaturalText(value) {
          const settings = getAnalysisMatchSettings();
          settings.useNaturalText = !!value;
          state.analysisMatchSettings = settings;
          savePersistentState(); render();
        },
        setImageInferenceEngine(value) {
          const settings = getAnalysisMatchSettings();
          settings.imageInferenceEngine = normalizeAnalysisAiEngine(value);
          state.analysisMatchSettings = normalizeAnalysisMatchSettings(settings);
          savePersistentState(); render();
        },
        setCafe24RankEngine(value) {
          const settings = getAnalysisMatchSettings();
          settings.cafe24RankEngine = normalizeAnalysisAiEngine(value, true);
          state.analysisMatchSettings = normalizeAnalysisMatchSettings(settings);
          savePersistentState(); render();
        },
        setGptOAuthModel(value) {
          const settings = getAnalysisMatchSettings();
          settings.gptOAuthModel = normalizeAnalysisProviderModel('gpt_oauth', value);
          state.analysisMatchSettings = normalizeAnalysisMatchSettings(settings);
          savePersistentState(); render();
        },
        setGeminiModel(value) {
          const settings = getAnalysisMatchSettings();
          settings.geminiModel = normalizeAnalysisProviderModel('gemini', value);
          state.analysisMatchSettings = normalizeAnalysisMatchSettings(settings);
          savePersistentState(); render();
        },
        setMatchSource(value) {
          const settings = getAnalysisMatchSettings();
          settings.sources[value.source] = !!value.enabled;
          state.analysisMatchSettings = normalizeAnalysisMatchSettings(settings);
          savePersistentState(); render();
        },
        startAnalysis(_value, operationContext) { return startAnalysis(operationContext); },
        startImageAnalysisOnly(_value, operationContext) { return startImageAnalysisOnly(operationContext); },
        matchCurrentProductToSinhwaDb(_value, operationContext) { return matchCurrentProductToSinhwaDb({ manual: true, operationContext }); },
        startImageBasedSinhwaDbMatch(_value, operationContext) { return startImageBasedSinhwaDbMatch({ operationContext }); },
        startIntegratedSourceMatch(_value, operationContext) { return startIntegratedSourceMatch(operationContext); },
        startImageOnlyCafe24Experiment(_value, operationContext) { return startImageOnlyCafe24Experiment({ operationContext }); },
        startImageOnlyCafe24ExperimentMatrix(_value, operationContext) { return startImageOnlyCafe24ExperimentMatrix(operationContext); },
        openAutomationManual() { state.step = 'manual'; setUiNotice(null); savePersistentState(); render(); },
        uploadFiles(value) {
          if (value.replace) {
            state.analysisImages = []; state.imagePreview = null; state.imageBase64 = null; state.imageMime = '';
          }
          return handleMultipleFiles(value.files);
        },
        clearImages() {
          state.analysisImages = []; state.imagePreview = null; state.imageBase64 = null; state.imageMime = '';
          resetProductAnalysisDerivedState({ clearDb: true }); saveLastWorkNow(); render();
        },
        setPrimaryImage(index) {
          if (!Number.isFinite(index) || index <= 0 || index >= state.analysisImages.length) return;
          const [picked] = state.analysisImages.splice(index, 1);
          state.analysisImages.unshift(picked);
          state.imagePreview = analysisImageSrc(picked) || null;
          state.imageBase64 = picked?.base64 || null;
          state.imageMime = picked?.mime || state.imageMime || '';
          clearStaleImageDependentAnalysis('대표 이미지가 바뀌어 이전 이미지 추론/DB 매칭값을 분리했습니다.');
          saveLastWorkNow(); render();
        },
        refreshCurrentDbMatch(_value, operationContext) { return refreshCurrentSinhwaDbMatch(operationContext); },
        loadFactoryLatest() {
          if (typeof factoryApplyLatestToAnalysisHub === 'function') return factoryApplyLatestToAnalysisHub();
          setUiNotice('조립공장 연결 함수를 아직 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.', 'error'); render();
        },
        loadDbColorOptions(_value, operationContext) { return loadDbColorOptionsForCurrentProduct({ operationContext }); },
        applyDbColorOptions(_value, operationContext) { return applyDbColorOptionsToOptionSorter({ operationContext }); },
        closeDbCandidate() { state.dbMatchSelectionOpen = false; savePersistentState(); render(); },
        applyDbCandidate(value) { return applySinhwaDbCandidateByCode(value); },
        applyCafe24Candidate(value) { return applyCafe24CandidateByProductNo(value); },
        toggleProductInfoOptions() { state.productInfoOptionsOpen = !state.productInfoOptionsOpen; savePersistentState(); render(); },
        resetProductInfoFields() { return resetProductInfoFieldSettings(); },
        toggleProductInfoField(value) {
          const [fieldId, prop] = String(value || '').split(':');
          const current = productInfoFieldSetting(fieldId);
          if (prop === 'active') setProductInfoFieldSetting(fieldId, { active: !current.active });
          if (prop === 'required') setProductInfoFieldSetting(fieldId, { active: true, required: !current.required });
        },
        saveProductInfoValue(value) { return setProductInfoManualValue(value.fieldId, value.value); },
        clearProductInfoValue(value) { return clearProductInfoManualValue(value); },
        setAnalysisCombo(value) { state.analysisCompareMode = value || 'image'; savePersistentState(); render(); },
        toggleAnalysisSource(value) {
          const current = normalizeAnalysisSourceIds();
          const next = current.includes(value) ? current.filter(id => id !== value) : [...current, value];
          state.analysisCompareMode = (next.length ? next : ['image']).join('+');
          savePersistentState(); render();
        },
      },
      renderHelpers: {
        getActiveAnalysisRun,
        expireStaleAnalysisRunIfNeeded,
        renderAnalysisHub,
        escapeHtml,
        renderModelRunLine,
        renderAnalysisRunLogs,
      },
    }));
  }

  const createSectionsMenu = moduleNamespaces['src/menus/sections-menu.mjs']?.createSectionsMenu;
  if (typeof createSectionsMenu === 'function') {
    runtimeMenuModules.set('sections', createSectionsMenu({
      ...runtimeDomainMenuBase(() => ({
        activeSectionEdit: state.activeSectionEdit,
        analysis: state.analysis,
        auto: state.auto,
        competitorData: state.competitorData,
        hiddenSectionIds: state.hiddenSectionIds,
        imagePreview: state.imagePreview,
        sectionBatchBasisMode: state.sectionBatchBasisMode,
        sectionBatchGenerationMode: state.sectionBatchGenerationMode,
        sectionBatchRun: state.sectionBatchRun,
        sectionBatchSelection: state.sectionBatchSelection,
        sectionBasisModes: state.sectionBasisModes,
        sectionContents: state.sectionContents,
        sectionDriveFolderId: state.sectionDriveFolderId,
        sectionDriveUploadStatus: state.sectionDriveUploadStatus,
        sectionGenerationModes: state.sectionGenerationModes,
        sectionGenerating: state.sectionGenerating,
        sectionImages: state.sectionImages,
        sectionInstructions: state.sectionInstructions,
        sectionLocks: state.sectionLocks,
      })),
      actions: {
        ...analysisPanelActions,
        generateCompetitorPlan(_value, operationContext) {
          if (!runtimeOperationContextIsCurrent(operationContext)) return false;
          const result = generateCompetitorPlan(operationContext);
          return result && typeof result.then === 'function'
            ? Promise.resolve(result).then(output => runtimeOperationContextIsCurrent(operationContext) ? output : undefined)
            : result;
        },
        openCompetitor() {
          state.step = 'competitor';
          state.compPage = state.compPage || {};
          state.compPage.subStep = state.compPage.analysisResult ? 'report' : 'input';
          savePersistentState();
          render();
        },
        generateAll(_value, operationContext) {
          return generateAllSections(operationContext);
        },
        generateSection(sectionId, operationContext) {
          return generateSingleSection(sectionId, { operationContext });
        },
        updateBatchBasisMode(value) {
          state.sectionBatchBasisMode = value === 'keep' || SECTION_BASIS_MODES.some(mode => mode.id === value) ? value : 'keep';
          savePersistentState();
          renderPreservingMainScroll();
        },
        updateBatchGenerationMode(value) {
          state.sectionBatchGenerationMode = value === 'keep' || SECTION_GENERATION_MODES.some(mode => mode.id === value) ? value : 'keep';
          savePersistentState();
          renderPreservingMainScroll();
        },
        selectMissingSections() {
          setMissingSectionBatchSelection(missingSectionIdsForBatch());
          renderPreservingMainScroll();
        },
        clearMissingSectionSelection() {
          state.sectionBatchSelection = {};
          renderPreservingMainScroll();
        },
        generateMissingSections(options, operationContext) {
          return generateSelectedMissingSections({ ...(options || {}), operationContext });
        },
        updateBatchSelection(value = {}) {
          if (!value.sectionId) return;
          if (!state.sectionBatchSelection || typeof state.sectionBatchSelection !== 'object') state.sectionBatchSelection = {};
          if (value.selected) state.sectionBatchSelection[value.sectionId] = true;
          else delete state.sectionBatchSelection[value.sectionId];
          renderPreservingMainScroll();
        },
        addCustomSection() {
          const name = prompt('추가할 이미지 섹션 이름을 입력하세요.', '추가 이미지 섹션');
          if (name === null) return false;
          pushEditorHistory('이미지 섹션 추가 전');
          addCustomDetailSection(name);
          savePersistentState();
          saveLastWorkNow();
          renderPreservingMainScroll();
          return true;
        },
        restoreHiddenSections() {
          pushEditorHistory('숨긴 섹션 복원 전');
          restoreDetailSections();
          savePersistentState();
          saveLastWorkNow();
          renderPreservingMainScroll();
        },
        saveDriveFolder(value) {
          state.sectionDriveFolderId = String(value || '');
          localStorage.setItem('section_drive_folder_id', state.sectionDriveFolderId);
          render();
        },
        connectDrive() {
          return connectDrive();
        },
        async uploadAllSectionImages(_value, operationContext) {
          for (const section of orderedSections()) {
            if (!operationContext.isCurrent()) return false;
            if (state.sectionImages[section.id]) await uploadSectionImageToDrive(section.id);
          }
          return true;
        },
        toggleSection(sectionId) {
          state.activeSectionEdit = state.activeSectionEdit === sectionId ? null : sectionId;
          render();
        },
        hideSection(sectionId) {
          if (!sectionId) return;
          pushEditorHistory('섹션 숨김 전');
          hideDetailSection(sectionId);
          savePersistentState();
          saveLastWorkNow();
          renderPreservingMainScroll();
        },
        updateSectionInstruction(value = {}) {
          setSectionInstructionValue(value.sectionId, value.value, 'manual', { source: '섹션 설정 입력창' });
        },
        setSectionGenerationMode(value = {}) {
          if (!value.sectionId) return;
          state.sectionGenerationModes[value.sectionId] = value.modeId;
          saveSectionGenerationModes(state.sectionGenerationModes);
          savePersistentState();
          render();
        },
        setSectionBasisMode(value = {}) {
          if (!value.sectionId || !SECTION_BASIS_MODES.some(mode => mode.id === value.basisId)) return;
          const wasCustomAssembly = hasCustomSectionAssembly(value.sectionId);
          state.sectionBasisModes[value.sectionId] = value.basisId;
          if (!wasCustomAssembly && state.sectionAssembly) delete state.sectionAssembly[value.sectionId];
          saveSectionBasisModes(state.sectionBasisModes);
          saveSectionAssembly(state.sectionAssembly || {});
          savePersistentState();
          render();
        },
        toggleSectionLock(sectionId) {
          setSectionLock(sectionId, !state.sectionLocks[sectionId]);
        },
        updateSectionAssemblySource(value = {}) {
          const sectionId = String(value.sectionId || '').trim();
          const sourceId = String(value.sourceId || '').trim();
          if (!sectionId || !SECTION_ASSEMBLY_SOURCES.some(source => source.id === sourceId)) return false;
          if (!state.sectionAssembly || typeof state.sectionAssembly !== 'object') state.sectionAssembly = {};
          const current = getSectionAssembly(sectionId);
          const sources = { ...(current.sources || {}) };
          sources[sourceId] = !!value.selected;
          if (!Object.values(sources).some(Boolean)) sources.current = true;
          state.sectionAssembly[sectionId] = {
            ...current,
            sources: normalizeSectionAssemblySources(sources),
            updatedAt: Date.now(),
          };
          const selected = sectionAssemblySelectedSourceIds(sectionId);
          if (selected.length === 1) {
            state.sectionBasisModes[sectionId] = selected[0];
            saveSectionBasisModes(state.sectionBasisModes);
          }
          saveSectionAssemblyState();
          render();
          return true;
        },
        updateSectionAssemblyCutUsage(value = {}) {
          const sectionId = String(value.sectionId || '').trim();
          const cutUsage = String(value.cutUsage || '').trim();
          if (!sectionId || !SECTION_ASSEMBLY_CUT_USAGES.some(usage => usage.id === cutUsage)) return false;
          if (!state.sectionAssembly || typeof state.sectionAssembly !== 'object') state.sectionAssembly = {};
          const current = getSectionAssembly(sectionId);
          const nextUsage = (!sectionAssemblyCanPlaceCutInSection(sectionId) && (cutUsage === 'section' || cutUsage === 'both'))
            ? 'prompt'
            : cutUsage;
          state.sectionAssembly[sectionId] = { ...current, cutUsage: nextUsage, updatedAt: Date.now() };
          applySectionAssemblyPlacement(sectionId);
          saveSectionAssemblyState();
          render();
          return true;
        },
        updateSectionAssemblyCut(value = {}) {
          const sectionId = String(value.sectionId || '').trim();
          if (!sectionId) return false;
          if (!state.sectionAssembly || typeof state.sectionAssembly !== 'object') state.sectionAssembly = {};
          const current = getSectionAssembly(sectionId);
          const cutAssetKey = String(value.cutAssetKey || '').trim();
          state.sectionAssembly[sectionId] = {
            ...current,
            cutAssetKey,
            cutUsage: cutAssetKey && current.cutUsage === 'none' ? 'prompt' : current.cutUsage,
            updatedAt: Date.now(),
          };
          applySectionAssemblyPlacement(sectionId);
          saveSectionAssemblyState();
          render();
          return true;
        },
        updateSectionAssemblyNote(value = {}) {
          const sectionId = String(value.sectionId || '').trim();
          if (!sectionId) return false;
          if (!state.sectionAssembly || typeof state.sectionAssembly !== 'object') state.sectionAssembly = {};
          const current = getSectionAssembly(sectionId);
          state.sectionAssembly[sectionId] = {
            ...current,
            note: String(value.note || ''),
            updatedAt: Date.now(),
          };
          saveSectionAssembly(state.sectionAssembly);
          scheduleLastWorkSave(900);
          return true;
        },
        autoDistributeSectionAssemblyCuts() {
          return autoDistributeSectionAssemblyCuts();
        },
        clearSectionAssemblyCutUsage() {
          return clearSectionAssemblyCutUsage();
        },
        applySectionImageHelperTips(sectionId) {
          applySectionImageHelperTips(sectionId);
          render();
        },
        applyAllSectionImageHelperTips() {
          return applyAllSectionImageHelperTips();
        },
        beginSectionOrderChange() {
          pushEditorHistory('섹션 설정 순서 변경 전');
        },
        updateSectionOrder(value) {
          if (!Array.isArray(value)) return false;
          state.sectionOrder = value.map(sectionId => String(sectionId || '').trim()).filter(Boolean);
          savePersistentState();
          render();
          return true;
        },
        navigate: runtimeRouteNavigate,
      },
      renderHelpers: {
        ensureCurrentProductAnalysisForGeneration,
        ensureSectionWorkScopeCurrent,
        syncFixedSectionPlacementImages,
        hasCurrentProductAnalysisForGeneration,
        productAnalysisGenerationBlockReason,
        orderedSections,
        displayableImageSrc,
        getSectionBasisModeInfo,
        getSectionGenerationModeInfo,
        renderBrandStudioPanel,
        renderFixedDetailImagePanel,
        renderFactoryLightImage,
        renderAnalysisLog,
        renderImageDirectivesPanel,
        renderCompetitorTipBankSummary,
        renderSectionAssemblySummaryPanel,
        renderSectionBatchRunPanel,
        getSectionAssembly,
        sectionAssemblyCutUsageInfo,
        getSectionInstructionSourceInfo,
        getSectionResultSourceInfo,
        sectionBasisDisplayInfo,
        getSectionBasisDetail,
        sectionAssemblySourceSummary,
        sectionBasisOptionLabel,
        renderSectionCompactPromptPreview,
        renderSectionCompetitorPlanNotice,
        renderSectionGeneratedImagePreview,
        renderSectionImageHelper,
        renderSectionBasisChooser,
        renderSectionBasisPromptCompare,
        renderSectionAssemblyPanel,
        renderSectionModeChooser,
        bindAnalysisPanelEvents: typeof bindAnalysisPanelEvents === 'function'
          ? bindAnalysisPanelEvents
          : () => () => {},
        normalizeBrandPresetColor: normalizeHexColor,
        getSortable: () => (typeof window !== 'undefined' ? window.Sortable : null),
        disabledAttr,
        escAttr,
        escapeHtml,
        SECTION_BASIS_MODES,
        SECTION_GENERATION_MODES,
      },
    }));
  }

  const createGeneratingMenu = moduleNamespaces['src/menus/generating-menu.mjs']?.createGeneratingMenu;
  if (typeof createGeneratingMenu === 'function') {
    runtimeMenuModules.set('generating', createGeneratingMenu({
      ...runtimeDomainMenuBase(() => ({
        progress: state.progress,
        progressMsg: state.progressMsg,
        sectionBatchRun: state.sectionBatchRun,
        sectionContents: state.sectionContents,
      })),
      actions: { stopAfterCurrent: requestSectionBatchStopAfterCurrent },
      renderHelpers: { orderedSections, escapeHtml },
    }));
  }

  const createPreviewMenu = moduleNamespaces['src/menus/preview-menu.mjs']?.createPreviewMenu;
  if (typeof createPreviewMenu === 'function') {
    runtimeMenuModules.set('preview', createPreviewMenu({
      ...runtimeDomainMenuBase(() => ({
        analysis: state.analysis,
        contentVersion: state.contentVersion,
        editingPreviewSection: state.editingPreviewSection,
        editorHistory: state.editorHistory,
        html: state.html,
        jpgExportBusy: state.jpgExportBusy,
        activePreviewLayer: state.activePreviewLayer,
        previewLayerMode: state.previewLayerMode,
        previewLayerEdits: state.previewLayerEdits,
        previewArchiveRecovery: state.previewArchiveRecovery,
        previewRecoveredDetailMode: state.previewRecoveredDetailMode,
        previewViewport: state.previewViewport,
        qaReport: state.qaReport,
        qaVersion: state.qaVersion,
        sectionBatchRun: state.sectionBatchRun,
        sectionContents: state.sectionContents,
        sectionLocks: state.sectionLocks,
        sectionGenerating: state.sectionGenerating,
        sectionImages: state.sectionImages,
        sectionInstructions: state.sectionInstructions,
        imageInsert: state.imageInsert,
      })),
      actions: {
        setViewport(value) {
          state.previewViewport = value === 'mobile' ? 'mobile' : 'pc';
          render();
        },
        navigate: runtimeRouteNavigate,
        startGenerating(_value, operationContext) {
          return startGenerating(operationContext);
        },
        openRemainingSectionsAfterStop() {
          state.step = 'sections';
          saveLastWorkNow();
          render();
        },
        recoverPreviewArchiveSections(_value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          return factoryRecoverPreviewSectionsFromLocalArchive({ operationContext });
        },
        togglePreviewEdit(sectionId) {
          state.editingPreviewSection = state.editingPreviewSection === sectionId ? null : sectionId;
          render();
        },
        openAiRepair: (sectionId, operationContext) => openAiRepair(sectionId, operationContext),
        closeAiRepair: (_value, operationContext) => closeAiRepair(operationContext),
        updateAiRepairField: (value, operationContext) => updateAiRepairField(value, operationContext),
        persistAiRepairMask: (value, operationContext) => persistAiRepairMask(value, operationContext),
        runAiRepair: (value, operationContext) => runAiRepair(value, operationContext),
        undoAiRepair: (sectionId, operationContext) => undoAiRepair(sectionId, operationContext),
        regenerateSection: sectionId => regenerateSection(sectionId),
        applyPreviewEdit(payload) {
          pushEditorHistory(`${payload.sectionId} 지시문 적용 전`);
          setSectionInstructionValue(payload.sectionId, payload.value, 'manual', { source: '미리보기 수정 패널' });
          state.editingPreviewSection = null;
          return regenerateSection(payload.sectionId);
        },
        setSectionLock(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          if (!sectionId) return false;
          setSectionLock(sectionId, !!payload.locked);
          return true;
        },
        saveManualSection(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          if (!sectionId || !payload.patch || typeof payload.patch !== 'object') return false;
          pushEditorHistory(`${sectionId} 직접 수정 저장 전`);
          saveManualSectionContent(sectionId, payload.patch);
          render();
          return true;
        },
        applySectionVariant(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          const variantId = String(payload.variantId || '').trim();
          if (!sectionId || !variantId) return false;
          applySectionVariant(sectionId, variantId);
          return true;
        },
        applySectionVariantImage(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          const variantId = String(payload.variantId || '').trim();
          if (!sectionId || !variantId) return false;
          return applySectionVariantImageOnly(sectionId, variantId, operationContext);
        },
        evaluateSectionVariants(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          if (!sectionId) return false;
          return evaluateSectionVariants(sectionId, operationContext);
        },
        applyBestEvaluatedVariant(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          if (!sectionId) return false;
          return applyBestEvaluatedVariant(sectionId, operationContext);
        },
        setRecoveredDetailMode(enabled, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          state.previewRecoveredDetailMode = !!enabled;
          saveLastWorkNow({ sync: false, server: false });
          render();
          return state.previewRecoveredDetailMode;
        },
        deleteDetailImage(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const blockId = String(payload.blockId || '').trim();
          if (!blockId) return false;
          deleteDetailImageBlock(blockId);
          return true;
        },
        moveDetailImage(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const blockId = String(payload.blockId || '').trim();
          const direction = String(payload.direction || '').trim();
          if (!blockId || (direction !== 'up' && direction !== 'down')) return false;
          moveDetailImageBlock(blockId, direction);
          return true;
        },
        focusSectionImage(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          if (!sectionId) return false;
          focusSectionImageLayer(sectionId);
          return true;
        },
        deleteSectionImage(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          if (!sectionId) return false;
          deleteSectionImage(sectionId);
          return true;
        },
        openImageInsert(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          if (!sectionId) return false;
          openImageInsert(sectionId, payload.mode);
          return true;
        },
        chooseSectionPlacement(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(payload.sectionId || '').trim();
          const placementValue = String(payload.placementValue || '').trim();
          if (!sectionId || !placementValue) return false;
          return applyPreviewSectionPlacement(sectionId, placementValue, operationContext);
        },
        closeImageInsert(_value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          closeImageInsert();
          return true;
        },
        updateImageInsertFolder(value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          state.imageInsert.driveFolderId = String(value || '');
          return state.imageInsert.driveFolderId;
        },
        applyImageInsert(payload = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          if (!payload?.dataUrl) return false;
          applyImageInsert(payload.dataUrl, payload.label, payload.source, operationContext);
          return true;
        },
        loadDetailDriveImages(value, operationContext) {
          return loadDetailDriveImages(value, operationContext);
        },
        connectImageInsertDrive(_value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          return connectDrive(operationContext);
        },
        useDriveDetailImage(value, operationContext) {
          return useDriveDetailImage(value, operationContext);
        },
        useCutDetailImage(value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          return useCutDetailImage(value, operationContext);
        },
        setImageInsertError(value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          if (!state.imageInsert) state.imageInsert = {};
          state.imageInsert.error = String(value || '');
          return true;
        },
        requestRender(_value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          render();
          return true;
        },
        undoEditorChange(_value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          return undoEditorChange();
        },
        redoEditorChange(_value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          return redoEditorChange();
        },
        applyTonePreset(value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          return applyTonePreset(value);
        },
        pushEditorHistory(value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          pushEditorHistory(String(value || '편집 전'));
          return true;
        },
        resetPreviewOrder(_value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          pushEditorHistory('섹션 순서 초기화 전');
          state.sectionOrder = allSectionDefinitions().map(section => section.id);
          savePersistentState();
          render();
          return true;
        },
        updateSectionOrder(value, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          if (!Array.isArray(value)) return false;
          state.sectionOrder = value.map(sectionId => String(sectionId || '').trim()).filter(Boolean);
          savePersistentState();
          render();
          return true;
        },
        setActivePreviewLayer(value = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(value.sectionId || '').trim();
          const layerId = String(value.layerId || '').trim();
          if (!sectionId || !layerId) return false;
          state.activePreviewLayer = { sectionId, layerId };
          state.previewLayerMode = true;
          render();
          return true;
        },
        setLayerEdit(value = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(value.sectionId || '').trim();
          const layerId = String(value.layerId || '').trim();
          if (!sectionId || !layerId || !value.patch || typeof value.patch !== 'object') return false;
          setLayerEdit(sectionId, layerId, value.patch);
          state.activePreviewLayer = { sectionId, layerId };
          render();
          return true;
        },
        resetLayerEdit(value = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(value.sectionId || '').trim();
          const layerId = String(value.layerId || '').trim();
          if (!sectionId || !layerId) return false;
          resetLayerEdit(sectionId, layerId);
          state.activePreviewLayer = { sectionId, layerId };
          render();
          return true;
        },
        resetLayerSection(value = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(value.sectionId || '').trim();
          if (!sectionId) return false;
          resetLayerEdit(sectionId);
          state.activePreviewLayer = null;
          render();
          return true;
        },
        nudgeLayer(value = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(value.sectionId || '').trim();
          const layerId = String(value.layerId || '').trim();
          if (!sectionId || !layerId) return false;
          const current = getLayerEdit(sectionId, layerId);
          setLayerEdit(sectionId, layerId, { x: current.x + Number(value.dx || 0), y: current.y + Number(value.dy || 0) });
          state.activePreviewLayer = { sectionId, layerId };
          render();
          return true;
        },
        commitLayerDrag(value = {}, operationContext) {
          assertRuntimeOperationContextCurrent(operationContext);
          const sectionId = String(value.sectionId || '').trim();
          const layerId = String(value.layerId || '').trim();
          if (!sectionId || !layerId) return false;
          setLayerEdit(sectionId, layerId, { x: Number(value.x || 0), y: Number(value.y || 0) });
          state.activePreviewLayer = { sectionId, layerId };
          savePersistentState();
          render();
          return true;
        },
        updatePreviewInstruction(payload) {
          setSectionInstructionValue(payload.sectionId, payload.value, 'manual', { source: '미리보기 수정 패널' });
        },
        runQaCheck: () => runQaCheck(),
        runAiQaCheck: () => runAiQaCheck(),
        toggleLayerMode() {
          state.previewLayerMode = !state.previewLayerMode;
          render();
        },
        resetAllLayers() {
          if (!confirm('모든 섹션의 레이어 위치/크기 조정을 초기화할까요?')) return;
          state.previewLayerEdits = {};
          state.activePreviewLayer = null;
          savePersistentState();
          render();
        },
        exportLayeredSVG: () => exportLayeredSVG(),
        exportPhotoshopPackage: () => exportPhotoshopPackage(),
        exportJpgAll: () => exportJpgAll(),
        exportJpgSections: () => exportJpgSections(),
        exportHTML: () => exportHTML(),
      },
      getLayerEdit: (sectionId, layerId) => {
        const edit = getLayerEdit(sectionId, layerId);
        return { ...edit };
      },
      getDocument: () => document,
      getSortable: () => (typeof window !== 'undefined' ? window.Sortable : null),
      renderHelpers: {
        syncFixedSectionPlacementImages,
        orderedSections,
        factoryRecoveredDetailPreviewHtml,
        renderBrandStudioPanel,
        renderToneQuickPanel,
        renderQaPanel,
        renderFixedDetailImagePanel,
        renderRecoveredDetailPreviewNotice,
        renderRecoveredDetailPreviewAside,
        renderPreviewOutline,
        renderFixedDetailImageForExport,
        cssFontFamily,
        displayableImageSrc,
        canUndoAiRepair,
        getSectionGenerationModeInfo,
        resolveSectionRenderGenerationMode,
        renderSectionVariantQuickBar,
        renderSectionVariantEvaluationPanel,
        renderPreviewEditPanel,
        renderSectionTemplate,
        renderDetailImageBlocksAfter,
        renderFactoryLightImage,
        sectionPlacementChoicesFromOptions,
        publicSectionText,
        nl2br,
        escAttr,
        escapeHtml,
      },
      hasMaskPaint: maskCanvasHasPaint,
      buildEditMask: buildTransparentEditMaskDataUrl,
      createImage: () => new Image(),
      readImageFileAsDataUrl,
    }));
  }

  const createCompetitorMenu = moduleNamespaces['src/menus/competitor-menu.mjs']?.createCompetitorMenu;
  if (typeof createCompetitorMenu === 'function') {
    runtimeMenuModules.set('competitor', createCompetitorMenu({
      ...runtimeDomainMenuBase(() => ({
        analysis: state.analysis,
        compPage: state.compPage,
        analysisMatchSettings: state.analysisMatchSettings,
        sectionContents: state.sectionContents,
      })),
      actions: {
        setMode(value) {
          state.compPage.mode = value;
          scheduleLastWorkSave();
          render();
        },
        setSubStep(value) {
          if (value === 'plan' && state.compPage.previousAnalysisViewOnly) {
            compMarketSetStatus('이전 분석 결과는 보기 전용입니다. 현재 선택 이미지 기준으로 다시 분석해야 섹션 플랜을 사용할 수 있습니다.', 'saved-analysis-view-only', 'warn');
            render();
            return;
          }
          state.compPage.subStep = value || 'input';
          render();
        },
        navigateFlow(value) {
          if (value === 'report' && !state.compPage.analysisResult) return;
          if (value === 'plan' && state.compPage.previousAnalysisViewOnly) {
            compMarketSetStatus('이전 분석 결과는 보기 전용입니다. 현재 선택 이미지 기준으로 다시 분석해야 섹션 플랜을 사용할 수 있습니다.', 'saved-analysis-view-only', 'warn');
            render();
            return;
          }
          if (value === 'plan' && !state.compPage.sectionPlan) return;
          state.compPage.subStep = value || 'input';
          render();
        },
        generatePlan() {
          if (!state.compPage.analysisResult) return;
          if (state.compPage.previousAnalysisViewOnly) {
            compMarketSetStatus('이전 분석 결과로 새 섹션 플랜을 만들 수 없습니다. 현재 선택 이미지 기준으로 다시 분석해주세요.', 'saved-analysis-view-only', 'warn');
            render();
            return;
          }
          return generateCompetitorPlan();
        },
        applyStylePreset(value) { return applyCompetitorStylePreset(!!value); },
        importImages(files) { return handleCompImages(files); },
        loadLatestDetailImages() { return loadLatestJepumDetailImages(); },
        openDetailFolder() { return openJepumDetailFolderList(); },
        updateMarketName(value) {
          ensureCompMarketScrapeState().productName = value;
          scheduleLastWorkSave();
        },
        setGptOAuthModel(value) {
          const settings = getAnalysisMatchSettings();
          settings.gptOAuthModel = normalizeAnalysisProviderModel('gpt_oauth', value);
          state.analysisMatchSettings = normalizeAnalysisMatchSettings(settings);
          savePersistentState();
          render();
        },
        updateMarketTarget(value) {
          const market = ensureCompMarketScrapeState();
          if (value?.siteId) {
            market.marketTargets[value.siteId] = compMarketTargetValue(value.value);
            market.topN = Math.max(...Object.values(market.marketTargets));
          } else {
            market.totalTarget = Math.max(1, Math.min(100, Math.round(Number(value?.value || COMP_MARKET_DEFAULT_TOTAL_TARGET) || COMP_MARKET_DEFAULT_TOTAL_TARGET)));
          }
          market.lastUpdatedAt = Date.now();
          if (value?.commit) { saveCompMarketUiState(); render(); } else scheduleLastWorkSave();
        },
        setMarketAutoCapture(value) {
          ensureCompMarketScrapeState().autoCapture = !!value;
          saveLastWorkNow();
        },
        setMarketSite(value) {
          const market = ensureCompMarketScrapeState();
          const selected = Array.isArray(market.selectedSites) ? market.selectedSites : [];
          market.selectedSites = value?.enabled
            ? (selected.includes(value.siteId) ? selected : [...selected, value.siteId])
            : selected.filter(siteId => siteId !== value?.siteId);
          saveLastWorkNow();
          render();
        },
        importMarketImage(file) { return setCompMarketImageFromFile(file); },
        useCurrentProductImage() { return copyCurrentProductToCompMarket(); },
        startMarketSearch(runtime) {
          if (runtime === 'local') {
            if (typeof compMarketConfirmLocalCandidateCollection === 'function' && !compMarketConfirmLocalCandidateCollection()) return;
            return runCompMarketScrape('local');
          }
          return typeof factoryRunVmCompetitorCollectionForSelection === 'function'
            ? factoryRunVmCompetitorCollectionForSelection()
            : runCompMarketScrape('vm');
        },
        setCandidateSourceView(value) { return compMarketSetCandidateSourceView(value); },
        reloadMarketResults() { return reloadCompMarketSearchResultsFromCurrentId(); },
        recoverDetailImages() {
          return recoverCompMarketDetailImagesFromHistory({ allowProductFallback: true });
        },
        reloadDetailImages() { return reloadCompMarketDetailImagesFromCurrentJob(); },
        captureDetails(value) { return runCompMarketDetailCapture(null, value?.runtime === 'local' ? { runtime: 'local' } : {}); },
        captureDetailsAndAnalyze() { return runCompMarketDetailCaptureAndAnalyze(); },
        selectAllCandidates() {
          const market = ensureCompMarketScrapeState();
          const candidates = compMarketAllCandidateResults(market);
          market.results = candidates;
          market.selectedIds = candidates.map((item, index) => compMarketResultId(item, index));
          compMarketMarkDetailSelectionChanged(market, '후보 전체 선택으로 상세수집 선택 범위가 바뀌었습니다.');
          market.lastUpdatedAt = Date.now();
          saveCompMarketUiState();
          render();
        },
        clearCandidateSelection() {
          const market = ensureCompMarketScrapeState();
          market.selectedIds = [];
          compMarketMarkDetailSelectionChanged(market, '후보 선택을 해제해 이전 상세수집 결과를 현재 선택에 섞지 않습니다.');
          market.lastUpdatedAt = Date.now();
          saveCompMarketUiState();
          render();
        },
        clearMarket() {
          const market = ensureCompMarketScrapeState();
          Object.assign(market, {
            loading: false, phase: 'idle', status: '결과를 지웠습니다.', route: '', searchId: '', sessionId: '', detailJobId: '',
            results: [], groupedResults: {}, candidateView: 'vm', vmResults: [], vmGroupedResults: {}, localResults: [],
            localGroupedResults: {}, selectedIds: [], detailResults: null, manualIntervention: null, scrapedImages: [],
            selectedImageIds: [], candidateSnapshotSuppressed: true, error: '', lastUpdatedAt: Date.now(),
          });
          saveCompAnalysis(state.compPage.analysisResult, state.compPage.sectionPlan, state.compPage.planEdits);
          render();
        },
        useCandidateUrl(id) {
          const market = ensureCompMarketScrapeState();
          const found = compMarketFindResultById(market, id);
          const item = found?.item;
          const url = item?.product_url || item?.url || item?.link || item?.detail_url || '';
          if (!url) return;
          state.compPage.mode = 'url';
          state.compPage.urlInput = url;
          market.lastUpdatedAt = Date.now();
          saveCompMarketUiState();
          render();
        },
        toggleCandidate(id) {
          const market = ensureCompMarketScrapeState();
          const selected = new Set(market.selectedIds || []);
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          market.selectedIds = Array.from(selected);
          compMarketMarkDetailSelectionChanged(market, '선택 후보가 바뀌었습니다. 이전 상세수집 결과는 현재 선택에 섞지 않습니다.');
          market.lastUpdatedAt = Date.now();
          saveCompMarketUiState();
          render();
        },
        runMarketQuickAction(action) {
          if (action === 'start-vm') return runCompMarketScrape('vm');
          if (action === 'start-local') {
            if (typeof compMarketConfirmLocalCandidateCollection === 'function' && !compMarketConfirmLocalCandidateCollection()) return;
            return runCompMarketScrape('local');
          }
          if (action === 'reload') return reloadCompMarketSearchResultsFromCurrentId();
          if (action === 'detail-vm') return runCompMarketDetailCapture();
          if (action === 'detail-local') return runCompMarketDetailCapture(null, { runtime: 'local' });
          if (action === 'detail-scrapling') return runCompMarketScraplingDetailCapture();
          if (action === 'analyze-vm') return runCompMarketDetailCaptureAndAnalyze();
          const market = ensureCompMarketScrapeState();
          if (action === 'select-all') {
            const candidates = compMarketAllCandidateResults(market);
            market.results = candidates;
            market.selectedIds = candidates.map((item, index) => compMarketResultId(item, index));
            compMarketMarkDetailSelectionChanged(market, '후보 전체 선택으로 상세수집 선택 범위가 바뀌었습니다.');
          } else if (action === 'clear-selection') {
            market.selectedIds = [];
            compMarketMarkDetailSelectionChanged(market, '후보 선택을 해제해 이전 상세수집 결과를 현재 선택에 섞지 않습니다.');
          } else if (action === 'select-all-images') {
            market.selectedImageIds = compMarketVisibleDetailImagesForSelection(market).map((img, index) => compMarketScrapedImageId(img, index));
            compMarketMarkSelectionChanged('이번 선택으로 수집한 상세페이지 이미지를 분석 대상으로 선택했습니다.');
          } else if (action === 'clear-images') {
            market.selectedImageIds = [];
            compMarketMarkSelectionChanged('상세페이지 이미지 선택을 해제했습니다.');
          } else if (action === 'toggle-history-images') market.showPreviousDetailImages = !market.showPreviousDetailImages;
          else return;
          market.lastUpdatedAt = Date.now();
          saveCompMarketUiState();
          render();
        },
        toggleMarketImage(id) {
          const market = ensureCompMarketScrapeState();
          const selected = new Set(market.selectedImageIds || []);
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          market.selectedImageIds = Array.from(selected);
          market.lastUpdatedAt = Date.now();
          compMarketMarkSelectionChanged('분석할 상세페이지 이미지 선택이 바뀌었습니다.');
          saveCompMarketUiState();
          render();
        },
        previewMarketImage(id) { ensureCompMarketScrapeState().previewImageId = String(id || ''); render(); },
        closeMarketImagePreview() { ensureCompMarketScrapeState().previewImageId = ''; render(); },
        openVisibleVm() { return compMarketOpenVisibleVmCapture(); },
        resumeDetailJob() { return compMarketResumeDetailJob(); },
        openVmLogin() { return compMarketOpenVmLoginSession(); },
        selectAllMarketImages() {
          const market = ensureCompMarketScrapeState();
          market.selectedImageIds = compMarketVisibleDetailImagesForSelection(market).map((img, index) => compMarketScrapedImageId(img, index));
          market.lastUpdatedAt = Date.now();
          compMarketMarkSelectionChanged('전체 상세페이지 이미지를 새 분석 대상으로 선택했습니다.');
          saveCompMarketUiState();
          render();
        },
        clearMarketImageSelection() {
          const market = ensureCompMarketScrapeState();
          market.selectedImageIds = [];
          market.lastUpdatedAt = Date.now();
          compMarketMarkSelectionChanged('상세페이지 이미지 선택을 해제했습니다.');
          saveCompMarketUiState();
          render();
        },
        analyzeMarketImages(value) { return analyzeCompMarketScrapedImages(value); },
        previewUploadedImage(value) { state.compPage.previewImageIndex = value; render(); },
        closeUploadedImagePreview() { state.compPage.previewImageIndex = null; render(); },
        openEvidencePreview(value) {
          state.compPage.evidencePreview = value;
          render();
        },
        closeEvidencePreview() { state.compPage.evidencePreview = null; render(); },
        removeUploadedImage(value) { state.compPage.uploadedImages.splice(value, 1); saveLastWorkNow(); render(); },
        importHtmlFile(file) {
          const reader = new FileReader();
          reader.onload = event => { state.compPage.htmlText = event.target.result; saveLastWorkNow(); render(); };
          reader.readAsText(file, 'utf-8');
        },
        updateHtmlText(value) { state.compPage.htmlText = value; scheduleLastWorkSave(); },
        updateUrl(value) { state.compPage.urlInput = value; scheduleLastWorkSave(); },
        updateScraperBase(value) { state.compPage.scraperBase = String(value || '').trim(); scheduleLastWorkSave(); },
        async pingBackend() {
          const base = (state.compPage.scraperBase || 'http://127.0.0.1:5001').replace(/\/+$/, '');
          try {
            const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) });
            state.compPage.backendOk = response.ok || response.status < 500;
          } catch (_) { state.compPage.backendOk = false; }
          render();
        },
        startAnalysis(_value, operationContext) {
          return startCompetitorAnalysis(operationContext);
        },
        loadSavedReport() {
          const saved = loadCompAnalysis();
          if (!saved) return;
          const selectionStale = !compMarketSavedAnalysisMatchesSelectedImages(saved, ensureCompMarketScrapeState());
          const currentScope = sectionWorkScopeMeta();
          const scopeStale = !!(currentScope.scopeKey && !sectionWorkScopeMatches(saved.sectionWorkScope, currentScope));
          const analysisProductScope = saved.analysisResult?.analysisProductScope || null;
          const analysisScopeStale = !analysisProductScope || !sectionWorkScopeMatches(analysisProductScope, currentScope);
          const stale = selectionStale || scopeStale || analysisScopeStale;
          if (!applyCompAnalysisSnapshot(saved, 'report', { allowScopeMismatch: true })) {
            compMarketSetStatus('이전 저장 결과를 읽지 못했습니다.', 'saved-analysis-load-failed', 'warn');
            render();
            return;
          }
          state.compPage.previousAnalysisViewOnly = stale;
          if (stale) {
            state.compPage.analyzeStage = '이전 결과 보기';
            state.compPage.analyzeMsg = '현재 제품/선택 이미지 기준과 다른 이전 경쟁사 분석 결과를 열었습니다.';
            state.compPage.analyzeDetail = '보기 전용이며 기본 섹션 플랜에는 쓰지 않습니다. 현재 기준으로 쓰려면 선택 이미지 분석을 다시 실행해주세요.';
          }
          render();
        },
        loadSavedPlan() {
          const saved = loadCompAnalysis();
          if (!saved) return;
          if (!compMarketSavedAnalysisMatchesSelectedImages(saved, ensureCompMarketScrapeState())) {
            compMarketSetStatus('이전 섹션 플랜은 현재 선택 이미지와 다릅니다. 선택 이미지 분석을 다시 실행해주세요.', 'saved-plan-stale', 'warn');
            render();
            return;
          }
          applyCompAnalysisSnapshot(saved, 'plan');
          render();
        },
        updatePlanEnabled(value) {
          if (!state.compPage.planEdits[value.sectionId]) state.compPage.planEdits[value.sectionId] = {};
          state.compPage.planEdits[value.sectionId].enabled = value.enabled;
          render();
        },
        updatePlanInstructions(value) {
          if (!state.compPage.planEdits[value.sectionId]) state.compPage.planEdits[value.sectionId] = {};
          state.compPage.planEdits[value.sectionId].instructions = value.instructions;
        },
        setSectionBasisMode(value = {}) {
          if (!value.sectionId || !SECTION_BASIS_MODES.some(mode => mode.id === value.basisId)) return;
          const wasCustomAssembly = hasCustomSectionAssembly(value.sectionId);
          state.sectionBasisModes[value.sectionId] = value.basisId;
          if (!wasCustomAssembly && state.sectionAssembly) delete state.sectionAssembly[value.sectionId];
          saveSectionBasisModes(state.sectionBasisModes);
          saveSectionAssembly(state.sectionAssembly || {});
          savePersistentState();
          renderPreservingMainScroll();
        },
        setSectionGenerationMode(value = {}) {
          if (!value.sectionId || !SECTION_GENERATION_MODES.some(mode => mode.id === value.modeId)) return;
          state.sectionGenerationModes[value.sectionId] = value.modeId;
          saveSectionGenerationModes(state.sectionGenerationModes);
          savePersistentState();
          renderPreservingMainScroll();
        },
        generateSection(value) { return generateCompSection(value); },
        applyPlan(value, operationContext) {
          if (!applyCompetitorPlan()) return;
          if (value === 'generating') return startGenerating(operationContext);
          return shellRuntimeComposition.routeController.navigate(
            value,
            runtimeShellNavigationSnapshot(),
          );
        },
        maybeRecoverDetailImages() { return compMarketMaybeAutoRecoverDetailImages(); },
      },
      renderHelpers: {
        getCurrentLlmRunInfo,
        formatElapsedSeconds,
        renderCompetitorFlowNav,
        renderCompetitorAnalyzeLogItems,
        renderCompetitorLlmPill,
        compMarketAnalysisMatchesSelectedImages,
        renderCompetitorStylePresetCard,
        renderCompetitorEvidenceCard,
        ensureCurrentProductAnalysisForGeneration,
        hasCurrentProductAnalysisForGeneration,
        orderedSections,
        getSectionGenerationModeInfo,
        sectionBasisDisplayInfo,
        getSectionBasisModeInfo,
        getSectionBasisDetail,
        sectionBasisOptionLabel,
        renderPlanInstructionReadable,
        renderPlanImprovementBridge,
        getSectionPromptResolutionInfo,
        productAnalysisGenerationBlockReason,
        loadCompAnalysis,
        ensureCompMarketScrapeState,
        compMarketSavedAnalysisMatchesSelectedImages,
        sectionWorkScopeMeta,
        sectionWorkScopeMatches,
        renderCompMarketScrapePanel,
        renderCompetitorAnalysisModelOptions(selected) {
          return renderAnalysisModelOptions('gpt_oauth', selected);
        },
        renderFactoryLightImage,
        disabledAttr,
        escAttr,
        escapeHtml,
        SECTION_BASIS_MODES,
        SECTION_GENERATION_MODES,
      },
    }));
  }
  if (Object.keys(moduleNamespaces).some(moduleId => moduleId.startsWith('src/shell/'))) {
    return installShellRuntimeComposition(moduleNamespaces);
  }
  return runtimeMenuModules.has(state.step) ? render() : undefined;
}

function renderActiveRuntimeMenu(menu, snapshot) {
  if (!menu) {
    return '<div class="analysis-box" role="status">메뉴 모듈을 불러오는 중입니다.</div>';
  }
  const source = menu.id === 'factory' && factoryRuntimeStore
    ? factoryRuntimeReadViewSnapshot()
    : (snapshot === undefined ? state : snapshot);
  const view = menu.select(source);
  return menu.render(view);
}

let workfileActionDelegationInstalled = false;

function handleWorkfileActionClick(event) {
  if (event?.__kuasangseWorkfileActionHandled) return;
  const button = event.target?.closest?.(
    '#blankWorkBtn, #newProjectBtn, #saveProjectBtn, #saveCurrentProjectFileBtn, #saveProjectFileAsBtn, #importProjectFileBtn, #importProjectFileDirectBtn',
  );
  if (!button) return;
  event.__kuasangseWorkfileActionHandled = true;
  event.preventDefault();
  event.stopImmediatePropagation?.();
  if (button.id === 'blankWorkBtn') {
    startBlankWorkDraft();
    return;
  }
  if (button.id === 'newProjectBtn') {
    void startNewProjectDraft();
    return;
  }
  if (button.id === 'saveProjectBtn') {
    void saveCurrentProject();
    return;
  }
  if (button.id === 'saveCurrentProjectFileBtn') {
    void exportCurrentProjectFile({ name: state.currentProjectName || deriveProjectName(), saveAs: false });
    return;
  }
  if (button.id === 'saveProjectFileAsBtn') {
    void exportCurrentProjectFile({ name: state.currentProjectName || deriveProjectName(), saveAs: true });
    return;
  }
  if (button.id === 'importProjectFileBtn') {
    void openFactoryProjectFilePicker();
  }
  if (button.id === 'importProjectFileDirectBtn') {
    void openFactoryProjectFileInput({ direct: true });
  }
}

// ── 저장 전 작업 복구본 되살리기 ──────────────────────────────
// 사본은 편집권을 거치지 않고 저장된 참고본이라 자동 복원에 쓰지 않는다.
// 목록을 보여 주고, 사람이 고른 한 건만 불러온다.
let draftRecoveryDelegationInstalled = false;

function draftRecoveryState() {
  if (!state.draftRecovery) state.draftRecovery = { opened: false, loading: false, entries: [], error: '' };
  return state.draftRecovery;
}

async function loadDraftRecoveryList() {
  const view = draftRecoveryState();
  const scopeId = String(getCurrentLastWorkWorkspaceScope?.() || '');
  view.opened = true;
  view.loading = true;
  view.error = '';
  render();
  try {
    const url = `${kuasangseBackendBaseUrl()}/api/draft-recovery?scopeId=${encodeURIComponent(scopeId)}`;
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    view.entries = Array.isArray(payload.entries) ? payload.entries : [];
  } catch (error) {
    view.entries = [];
    view.error = String(error?.message || error);
  } finally {
    view.loading = false;
    render();
  }
}

async function restoreDraftRecoveryEntry(savedAt) {
  const view = draftRecoveryState();
  const scopeId = String(getCurrentLastWorkWorkspaceScope?.() || '');
  view.loading = true;
  view.error = '';
  render();
  try {
    const url = `${kuasangseBackendBaseUrl()}/api/draft-recovery/entry`
      + `?scopeId=${encodeURIComponent(scopeId)}&savedAt=${encodeURIComponent(String(savedAt))}`;
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok !== true || !payload.snapshot) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    // 되살리기는 지금 화면을 덮는다. 그래서 자동으로는 절대 하지 않고 여기서만 한다.
    // 이 사본은 이 탭의 draft 범위에서 나온 것이므로 그 범위로 못박아 적용한다.
    const applied = applyServerLastWorkSnapshot(payload.snapshot, {
      expectedWorkspaceScopeId: scopeId,
      replaceWorkspace: true,
      persistReplica: true,
    });
    if (!applied) throw new Error('이 사본이 지금 작업 범위와 맞지 않아 적용하지 않았습니다.');
    view.opened = false;
    view.entries = [];
    if (typeof factoryLog === 'function') {
      factoryLog(`복구본으로 되살렸습니다: ${new Date(Number(savedAt) || 0).toLocaleString('ko-KR')}`, 'ok');
    }
  } catch (error) {
    view.error = `되살리지 못했습니다: ${String(error?.message || error)}`;
  } finally {
    view.loading = false;
    render();
  }
}

function handleDraftRecoveryClick(event) {
  const button = event.target?.closest?.('[data-draft-recovery-action]');
  if (!button) return;
  const action = String(button.getAttribute('data-draft-recovery-action') || '');
  event.preventDefault();
  event.stopImmediatePropagation?.();
  if (action === 'list') { void loadDraftRecoveryList(); return; }
  if (action === 'close') { draftRecoveryState().opened = false; render(); return; }
  if (action === 'restore') {
    const savedAt = String(button.getAttribute('data-saved-at') || '').trim();
    if (savedAt) void restoreDraftRecoveryEntry(savedAt);
  }
}

function ensureDraftRecoveryDelegation() {
  if (draftRecoveryDelegationInstalled || typeof document === 'undefined') return;
  document.addEventListener('click', handleDraftRecoveryClick, true);
  draftRecoveryDelegationInstalled = true;
}

function ensureWorkfileActionDelegation() {
  ensureDraftRecoveryDelegation();
  if (workfileActionDelegationInstalled || typeof document === 'undefined') return;
  document.addEventListener('click', handleWorkfileActionClick, true);
  workfileActionDelegationInstalled = true;
}

function bindRenderedWorkfileActionButtons(root = document) {
  if (!root?.querySelector) return;
  const buttonHandlers = {
    blankWorkBtn: () => startBlankWorkDraft(),
    saveCurrentProjectFileBtn: () => exportCurrentProjectFile({
      name: state.currentProjectName || deriveProjectName(),
      saveAs: false,
    }),
    saveProjectFileAsBtn: () => exportCurrentProjectFile({
      name: state.currentProjectName || deriveProjectName(),
      saveAs: true,
    }),
    importProjectFileBtn: () => openFactoryProjectFilePicker(),
    importProjectFileDirectBtn: () => openFactoryProjectFileInput({ direct: true }),
  };
  Object.entries(buttonHandlers).forEach(([id, handler]) => {
    const button = root.querySelector(`#${id}`);
    if (button) button.onclick = event => {
      event?.preventDefault?.();
      void handler();
    };
  });
}

let workfileActionObserverInstalled = false;

function ensureWorkfileActionObserver() {
  if (workfileActionObserverInstalled || typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
  const target = document.body || document.documentElement;
  if (!target) return;
  const bind = () => bindRenderedWorkfileActionButtons(document);
  new MutationObserver(bind).observe(target, { childList: true, subtree: true });
  workfileActionObserverInstalled = true;
  bind();
}

ensureWorkfileActionDelegation();
ensureWorkfileActionObserver();

let previewOutlineNavigationRoot = null;
let previewOutlineNavigationHandler = null;

function bindPreviewOutlineNavigation(root) {
  if (!root?.addEventListener) return;
  if (previewOutlineNavigationRoot === root) return;
  previewOutlineNavigationRoot?.removeEventListener?.('click', previewOutlineNavigationHandler, true);
  const handler = event => {
    const outline = event.target?.closest?.('[data-outline-section-id]');
    if (!outline || !root.contains(outline)) return;
    const sectionId = String(outline.dataset.outlineSectionId || '').trim();
    if (!sectionId) return;
    const target = [...(root.querySelectorAll?.('[data-preview-section]') || [])]
      .find(node => String(node.dataset.previewSection || '') === sectionId);
    if (!target) return;
    const scroller = root.querySelector?.('.app') || document.querySelector?.('.app');
    if (!scroller) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    const align = behavior => {
      const currentTarget = [...(root.querySelectorAll?.('[data-preview-section]') || [])]
        .find(node => String(node.dataset.previewSection || '') === sectionId);
      const currentScroller = root.querySelector?.('.app') || document.querySelector?.('.app');
      if (!currentTarget || !currentScroller) return;
      const top = currentScroller.scrollTop
        + currentTarget.getBoundingClientRect().top
        - currentScroller.getBoundingClientRect().top
        - 18;
      currentScroller.scrollTo({ top: Math.max(0, top), behavior });
    };
    align('smooth');
    [120, 360, 800, 1400].forEach(delay => setTimeout(() => align('auto'), delay));
  };
  root.addEventListener('click', handler, true);
  previewOutlineNavigationRoot = root;
  previewOutlineNavigationHandler = handler;
}

function runtimeShellNavigationSnapshot(options) {
  return {
    ...state,
    ...(options || {}),
    workspaceId: factoryRuntimeWorkspaceId(),
  };
}

function renderShellMarkup(activeMenuHtml, activeMenu) {
  const factoryLayout = activeMenu?.ownedSlices?.includes('factory');
  return `
    ${state.showApiModal ? renderApiModal() : ''}
    ${state.aiRepair?.open ? renderAiRepairModal() : ''}
    ${state.imageInsert?.open ? renderImageInsertModal() : ''}
    ${state.promptTraceModal?.open ? renderPromptTraceModal() : ''}
    ${renderCompImagePreviewModal()}
    ${renderCompEvidencePreviewModal()}
    <div class="app">
      ${renderSidebar()}
      <main class="main">
        <div class="top-command-row">
          ${typeof renderGlobalDbSyncStatusStrip === 'function' ? renderGlobalDbSyncStatusStrip() : ''}
          ${renderApiStatusStrip()}
        </div>
        ${renderWorkspaceAuthorityBanner()}
        <div class="container ${factoryLayout ? 'container-factory' : ''}">
          ${renderMobileStepBanner()}
          ${renderUiNotice()}
          ${state.error ? renderError() : ''}
          ${shouldRenderStorageWarning() ? renderStorageWarning() : ''}
          ${activeMenuHtml}
        </div>
      </main>
    </div>
    ${renderActiveWorkIdentityCard()}
    ${typeof renderDraftRecoveryPanel === 'function' ? renderDraftRecoveryPanel() : ''}
    ${renderAgentChat()}
  `;
}

function bindShellAfterRender(root) {
  ensureWorkfileActionDelegation();
  ensureWorkfileActionObserver();
  bindPreviewOutlineNavigation(document);
  bindRenderedWorkfileActionButtons(root);
  bindEvents();
  bindRenderedWorkfileActionButtons(root);
  if (!shellRuntimeComposition) return;
  root.querySelectorAll('.sidebar [data-nav]').forEach(button => {
    button.onclick = event => {
      event?.preventDefault?.();
      const target = String(button.dataset.nav || '').trim();
      if (!target) return;
      const gate = getNavGateInfo(target);
      setUiNotice(gate.blocked ? gate.reason : (gate.note || null), gate.blocked ? 'warn' : 'info');
      Promise.resolve(shellRuntimeComposition.routeController.navigate(
        gate.redirect || target,
        runtimeShellNavigationSnapshot(),
      )).catch(error => {
        state.error = String(error?.message || error);
        render();
      });
      if (target === 'modelsettings' && !state.vertexConfig) {
        const base = state.auto.serverApiBase || 'http://127.0.0.1:4000/v1';
        fetch(`${base}/pdp/vertex-config`)
          .then(response => response.json())
          .then(value => { state.vertexConfig = value; render(); })
          .catch(() => {});
      }
    };
  });
}

function renderShellFrame(input) {
  const activation = input || {};
  const root = activation.root || document.getElementById('app');
  const menu = activation.menu || runtimeMenuModules.get(state.step) || null;
  ensureWorkfileActionDelegation();
  if (menu?.ownedSlices?.includes('detail-document')
    && typeof syncFixedSectionPlacementImages === 'function') {
    syncFixedSectionPlacementImages({ savePlacement: false });
  }
  if (typeof showImageRestoreWarningIfNeeded === 'function') {
    showImageRestoreWarningIfNeeded();
  }
  const renderStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  patchAppHtml(root, renderShellMarkup(activation.activeMenuHtml, menu));
  try {
    menu?.refresh?.(root);
  } catch (error) {
    console.warn('메뉴 화면 보조 갱신 실패:', error);
  }
  bindRenderedWorkfileActionButtons(root);
  bindShellAfterRender(root);
  if (typeof syncWorkspaceAuthorityReadOnlyDom === 'function') {
    syncWorkspaceAuthorityReadOnlyDom();
  }
  if (typeof factoryHydrateLightImages === 'function') factoryHydrateLightImages(root);
  if (typeof scheduleFactoryHydrateLightImages === 'function') scheduleFactoryHydrateLightImages(root);
  if (typeof scheduleCompetitorEvidenceCanvasPaint === 'function') scheduleCompetitorEvidenceCanvasPaint();
  else if (typeof paintCompetitorEvidenceCanvases === 'function') paintCompetitorEvidenceCanvases();
  const renderEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const renderLastMs = Math.max(0, renderEndedAt - renderStartedAt);
  state.runtimeRenderLastMs = Math.round(renderLastMs);
  if (document?.documentElement?.dataset) {
    document.documentElement.dataset.kuasangseRenderLastMs = String(state.runtimeRenderLastMs);
    document.documentElement.dataset.kuasangseRenderEndedAt = new Date().toISOString();
  }
}

let factoryControlProjectionSequence = 0;

function factoryControlThumbnailReference(source = {}) {
  const candidates = [
    source.thumbnailUrl,
    source.thumbnailRef,
    source.previewUrl,
    source.imageUrl,
    source.localArchive?.thumbnailUrl,
    source.metadata?.thumbnailUrl,
    source.sourceMap?.thumbnailUrl,
    // 섹션 변형은 보관함 주소를 image 에 들고 있다. 여기를 안 보면 이미 저장해 둔
    // 그림이 있는데도 "미리보기 없음" 이 뜬다. 아래 걸러내기가 data:/blob: 은
    // 어차피 막으므로, 주소인 경우에만 통과한다.
    source.image,
    source.preview,
    source.dataUrl,
  ];
  const direct = candidates.map(value => String(value || '').trim()).find(value => (
    /^(?:https?:\/\/|\/)/i.test(value)
    && !/^(?:data|blob|file):/i.test(value)
    && !/\/content(?:\/|$|\?)/i.test(value)
  ));
  if (direct) return direct;
  const archiveId = String(
    source.archiveId
    || source.localArchive?.archiveId
    || source.metadata?.localArchiveId
    || source.sourceMap?.localArchiveId
    || '',
  ).trim();
  return archiveId ? `/api/local-archive/assets/${encodeURIComponent(archiveId)}/thumbnail` : '';
}

function factoryRuntimeControlCompPage(factory = factoryRuntimeReadFactory()) {
  const viewCompPage = typeof factoryRuntimeReadViewSnapshot === 'function'
    ? factoryRuntimeReadViewSnapshot()?.competitors?.compPage
    : null;
  if (viewCompPage && typeof viewCompPage === 'object') return viewCompPage;
  if (factory?.competitors?.compPage && typeof factory.competitors.compPage === 'object') {
    return factory.competitors.compPage;
  }
  if (factory?.compPage && typeof factory.compPage === 'object') return factory.compPage;
  return state.compPage || {};
}

function factoryControlCompetitorInputGroup(factory) {
  const compPage = factoryRuntimeControlCompPage(factory);
  const market = compPage.marketScrape && typeof compPage.marketScrape === 'object'
    ? compPage.marketScrape
    : {};
  const candidates = typeof compMarketAllCandidateResults === 'function'
    ? compMarketAllCandidateResults(market)
    : (Array.isArray(market.results) ? market.results : []);
  const selectedIds = new Set(Array.isArray(market.selectedIds) ? market.selectedIds.map(String) : []);
  const detailImages = Array.isArray(market.scrapedImages) ? market.scrapedImages : [];
  const analysisReady = !!compPage.analysisResult;
  const missing = [];
  if (!candidates.length) missing.push('경쟁사 후보 수집');
  if (!selectedIds.size) missing.push('상세수집 후보 선택');
  if (!detailImages.length) missing.push('경쟁사 상세 이미지');
  if (!analysisReady) missing.push('경쟁사 이미지 분석');
  return Object.freeze({
    key: 'competitors',
    count: candidates.length,
    missing: Object.freeze(missing),
    items: Object.freeze(candidates.slice(0, 24).map((item, index) => {
      const id = typeof compMarketResultId === 'function'
        ? compMarketResultId(item, index)
        : String(item?.id || item?.product_id || item?.url || index);
      return Object.freeze({
        id,
        name: String(item?.title || item?.name || item?.product_name || `경쟁사 후보 ${index + 1}`).trim(),
        market: String(item?.platform || item?.site || item?.mall || '').trim(),
        price: String(item?.price_text || item?.price || item?.sale_price || '').trim(),
        thumbnailUrl: factoryControlThumbnailReference({
          thumbnailUrl: item?.thumbnail_url || item?.thumbnail || item?.image_url || item?.imageUrl || item?.main_image,
        }),
        selected: selectedIds.has(String(id)),
        detailImageCount: detailImages.length,
        analysisReady,
      });
    })),
  });
}

function factoryControlAssetCandidate(asset = {}) {
  const id = String(asset.id || asset.assetId || '').trim();
  if (!id) return null;
  // 최종 상세페이지 후보는 그림이 아니라 HTML 문서다. 그림이 없다고 빈 칸을 두면
  // 무엇을 고르는지 알 수 없다. 그 문서가 무엇인지를 대신 적어 보낸다 —
  // 섹션이 몇 개인지, 언제 저장했는지.
  const assetMeta = asset && typeof asset.metadata === 'object' ? asset.metadata : {};
  const assetKind = String(asset.type || '').trim() === 'html' ? 'html' : 'image';
  const sectionCount = Number(assetMeta.sectionCount);
  const preservedAt = Number(assetMeta.preservedAt || asset.createdAt || 0);
  const summaryParts = [];
  if (Number.isFinite(sectionCount) && sectionCount > 0) summaryParts.push(`섹션 ${sectionCount}개`);
  if (Number.isFinite(preservedAt) && preservedAt > 0) {
    const at = new Date(preservedAt);
    summaryParts.push(`${at.getMonth() + 1}월 ${at.getDate()}일 ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`);
  }
  if (assetMeta.productCheckWarning) summaryParts.push('상품 확인 필요');
  return Object.freeze({
    id,
    assetId: id,
    kind: assetKind,
    label: String(asset.title || '').trim(),
    summary: summaryParts.join(' · '),
    // 상세페이지 변형은 그림이 아니라 문서다. 보관함에 남긴 본문의 주소를 함께 보내
    // 관제탑이 그 문서를 그대로 그려 보여 줄 수 있게 한다.
    documentArchiveId: String(asset.documentArchiveId || '').trim(),
    // 문서 자산에는 그림이 없다. 보관 id 만 보고 .../thumbnail 주소를 만들어 보내면
    // 화면에 404 나는 빈 칸이 뜬다. 문서는 문서로 보여 준다.
    thumbnailUrl: assetKind === 'html' ? '' : factoryControlThumbnailReference(asset),
    digest: String(
      asset.digest || asset.imageDigest || asset.contentDigest
      || asset.contentHash || asset.localArchive?.contentHash
      || asset.metadata?.digest || asset.sourceMap?.digest
      || asset.archiveId || asset.localArchive?.archiveId
      || asset.metadata?.localArchiveId || asset.sourceMap?.localArchiveId || '',
    ).trim(),
    source: String(asset.source || asset.metadata?.source || asset.sourceMap?.source || 'factory').trim(),
    model: String(asset.model || asset.metadata?.model || asset.sourceMap?.model || '').trim(),
    confidence: Number.isFinite(Number(asset.confidence ?? asset.metadata?.confidence))
      ? Number(asset.confidence ?? asset.metadata?.confidence)
      : null,
    rationale: String(
      asset.rationale || asset.metadata?.rationale || asset.sourceMap?.rationale || '',
    ).trim(),
    receipt: factoryRuntimeDetachedValue(
      asset.receipt || asset.generationReceipt || asset.metadata?.receipt || null,
    ),
  });
}

function factoryControlAssetStage(factory, key, stageId) {
  const stage = factory.stages?.[stageId] || {};
  const selectedIds = Array.isArray(stage.selectedAssetIds)
    ? stage.selectedAssetIds.map(value => String(value || '').trim()).filter(Boolean)
    : [];
  const stageAssets = (factory.assets || [])
    .filter(asset => String(asset?.stageId || '') === stageId && !asset?.rejected);
  // 같은 파일을 가리키는 후보가 둘이면 같은 컷을 두 번 고르라고 내미는 셈이다.
  // 보관함에서 되살린 컷과 원래 컷이 같은 파일인 일이 잦다 —
  // 실측 2026-08-27: 대표 후보 10개 중 2개가 같은 보관 파일(e91390053bcb37ce)이었다.
  // 파일 지문으로 겹치는 것을 걸러 내되, 이미 고른 컷이 있으면 그쪽을 남긴다.
  // 어느 쪽을 남길지는 사람이 고른 것 > 지금 쓰는 것 > 나머지 순으로 정한다.
  // 사람이 고른 id 를 버리면 그림은 같아도 뒤에서 그 id 를 찾는 쪽(등록·영수증)이 헛짚는다.
  const selectedIdSet = new Set(selectedIds);
  const usedIdSet = new Set(
    stageAssets.filter(asset => asset?.used).map(asset => String(asset?.id || '').trim()).filter(Boolean),
  );
  const keepRank = id => (selectedIdSet.has(id) ? 2 : (usedIdSet.has(id) ? 1 : 0));
  const candidates = [];
  const seenAtByFingerprint = new Map();
  for (const asset of stageAssets) {
    const candidate = factoryControlAssetCandidate(asset);
    if (!candidate) continue;
    const fingerprint = candidate.digest || candidate.thumbnailUrl || '';
    const seenAt = fingerprint ? seenAtByFingerprint.get(fingerprint) : undefined;
    if (seenAt === undefined) {
      if (fingerprint) seenAtByFingerprint.set(fingerprint, candidates.length);
      candidates.push(candidate);
      continue;
    }
    if (keepRank(candidate.id) > keepRank(candidates[seenAt].id)) {
      candidates[seenAt] = candidate;
    }
  }
  const selectedId = selectedIds.find(id => candidates.some(candidate => candidate.id === id))
    || String(stageAssets.find(asset => (
      asset?.used && candidates.some(candidate => candidate.id === String(asset?.id || '').trim())
    ))?.id || '').trim();
  return Object.freeze({
    key,
    factoryStageId: stageId,
    status: String(stage.status || (candidates.length ? 'waiting_manual' : 'empty')).trim(),
    selectedId,
    selectedIds: Object.freeze(selectedIds),
    updatedAt: Number(stage.updatedAt || stage.runHeartbeatAt || 0)
      ? new Date(Number(stage.updatedAt || stage.runHeartbeatAt)).toISOString()
      : '',
    candidates: Object.freeze(candidates),
  });
}

function factoryControlSectionStage(factory = {}) {
  if (Array.isArray(factory.sectionCandidates) && factory.sectionCandidates.length) {
    const candidates = factory.sectionCandidates
      .map(factoryControlAssetCandidate)
      .filter(Boolean);
    const selectedIds = Array.isArray(factory.sectionSelectedIds)
      ? factory.sectionSelectedIds.map(value => String(value || '').trim()).filter(Boolean)
      : [];
    return Object.freeze({
      key: 'sections',
      factoryStageId: 'sections',
      status: selectedIds.length ? 'done' : 'waiting_manual',
      selectedId: selectedIds.find(id => candidates.some(candidate => candidate.id === id)) || '',
      selectedIds: Object.freeze(selectedIds),
      updatedAt: String(factory.sectionSelectionUpdatedAt || ''),
      candidates: Object.freeze(candidates),
    });
  }
  const candidates = [];
  const selectedIds = [];
  for (const [sectionId, variants] of Object.entries(state.sectionVariants || {})) {
    const currentId = String(state.currentSectionVariantIds?.[sectionId] || '').trim();
    // 같은 그림을 가리키는 변형이 둘 이상 있으면 한 컷을 두 번 내놓는 셈이다.
    // 보관함에서 되살린 변형과 '지금 쓰는' 변형이 같은 파일을 가리키는 일이 잦다.
    // 실측 2026-08-26: 훅·핵심 특징의 두 카드가 바이트까지 같은 파일이었다.
    // 지금 쓰는 변형의 그림은 state.sectionImages[sectionId] 와 같은 값이므로,
    // 그 값을 기준으로 겹치는 것을 걸러 낸다. 겹치면 지금 쓰는 것을 남긴다.
    const currentSectionImageValue = String(state.sectionImages?.[sectionId] || '').trim();
    const seenImageKeys = new Set();
    const orderedVariants = (Array.isArray(variants) ? variants : []).slice().sort((left, right) => {
      const leftCurrent = String(left?.id || '') === currentId ? 0 : 1;
      const rightCurrent = String(right?.id || '') === currentId ? 0 : 1;
      return leftCurrent - rightCurrent;
    });
    const sectionCandidates = [];
    let sectionSelectedId = '';
    for (const variant of orderedVariants) {
      const variantId = String(variant?.id || '').trim();
      if (!variantId) continue;
      const id = `${sectionId}:${variantId}`;
      const isCurrentVariant = variantId === currentId;
      if (isCurrentVariant) sectionSelectedId = id;
      // 지금 쓰는 변형은 그림을 따로 안 들고 '현재 섹션 그림' 을 가리키기만 한다.
      // 그 가리킨 곳을 여기서 풀어 주지 않으면, 정작 쓰이는 컷이 빈칸으로 뜬다.
      // 가리킴을 푸는 것은 이 변형에만 한다 — 지금 현재인 것은 하나뿐이고,
      // 나머지에도 같은 그림을 붙이면 서로 다른 안이 똑같아 보인다.
      const currentSectionImage = isCurrentVariant
        && String(variant?.imageRef || '') === SECTION_VARIANT_CURRENT_IMAGE_REF
        ? String(state.sectionImages?.[sectionId] || '').trim()
        : '';
      const variantThumbnail = factoryControlThumbnailReference(variant)
        || factoryControlThumbnailReference({ image: currentSectionImage });
      // 이 화면은 '사진 컷을 고르는 곳' 이다. 그림이 없는 변형을 카드로 내놓으면
      // 무엇을 고르는지 모른 채 찍으라는 말이 된다. 조립공장 자기 화면도
      // 그림 없는 변형은 빼고 보여 준다(renderSectionVariantEvaluationPanel 의
      // filter(v => v.image)). 관제탑만 빈 카드를 내놓고 있었다.
      // 지금 쓰는 컷은 그림이 없더라도 남긴다 — 무엇이 쓰이는지는 보여야 한다.
      if (!variantThumbnail && !isCurrentVariant) continue;
      // 그림은 있는데 주소가 없는 경우(아직 보관함에 안 들어간 data URL)다.
      // 한 번 넣어 두면 다음 보고부터 화면에 뜬다. 기다리지 않는다.
      if (!variantThumbnail && currentSectionImage.startsWith('data:image/')) {
        void archiveSectionVariantImage(sectionId, variant, currentSectionImage);
      }
      // 같은 그림을 두 번 내놓지 않는다. 지금 쓰는 변형을 먼저 보므로 그것이 남는다.
      const variantImageKey = String(
        variant?.image
        || (isCurrentVariant ? currentSectionImageValue : '')
        || variantThumbnail
        || '',
      ).trim();
      if (variantImageKey) {
        if (seenImageKeys.has(variantImageKey)) continue;
        seenImageKeys.add(variantImageKey);
      }
      // 변형은 그림이 아니라 '무엇이 다른가' 로 고른다. 이름과 첫 문구만 실어도
      // 사람이 고를 수 있다. 그림 전체를 실으면 보고가 무거워져 화면이 느려진다.
      const variantContent = variant && typeof variant.content === 'object' ? variant.content : {};
      const variantSummary = String(
        variantContent.headline
        || variantContent.title
        || variantContent.subheadline
        || variantContent.body
        || '',
      ).replace(/\s+/g, ' ').trim().slice(0, 60);
      sectionCandidates.push(Object.freeze({
        id,
        assetId: id,
        sectionId,
        variantId,
        pickedFlag: isCurrentVariant ? '1' : '',
        label: String(variant.label || '').trim(),
        summary: variantSummary,
        // 이 변형의 그림이 곧 지금 섹션 그림이면, 관제탑이 이미 받아 둔 그림을 쓴다.
        imageRef: String(variant.imageRef || '').trim(),
        hasImage: variant.image || variant.hasImage ? '1' : '',
        thumbnailUrl: variantThumbnail,
        digest: String(variant.digest || variant.imageDigest || '').trim(),
        source: String(variant.source || 'section-variant').trim(),
        model: String(variant.model || variant.modelId || '').trim(),
        confidence: Number.isFinite(Number(variant.confidence)) ? Number(variant.confidence) : null,
        rationale: String(variant.rationale || variant.evaluation?.rationale || '').trim(),
        receipt: factoryRuntimeDetachedValue(variant.receipt || variant.evaluationReceipt || null),
      }));
    }
    // 지금 쓰는 변형이 제 그림 없이 '현재 섹션 그림' 을 가리키기만 하고, 그 섹션에
    // 그림을 가진 변형이 딱 하나뿐이면 — 그 둘은 같은 컷이다. 실제로 파일이
    // 바이트까지 같았다(2026-08-26 훅·핵심 특징). 두 장으로 내놓으면 사람은 같은
    // 사진을 두 번 보며 무엇이 다른지 찾게 된다. 하나로 합치고 선택 표시를 옮긴다.
    const withImage = sectionCandidates.filter(item => String(item.thumbnailUrl || '').trim());
    const selectedItem = sectionCandidates.find(item => item.id === sectionSelectedId);
    const selectedHasImage = !!String(selectedItem?.thumbnailUrl || '').trim();
    if (selectedItem && !selectedHasImage && withImage.length === 1) {
      const merged = withImage[0];
      for (const item of sectionCandidates) {
        if (item === selectedItem) continue;
        candidates.push(item);
      }
      selectedIds.push(merged.id);
    } else {
      for (const item of sectionCandidates) candidates.push(item);
      if (sectionSelectedId) selectedIds.push(sectionSelectedId);
    }
  }
  return Object.freeze({
    key: 'sections',
    factoryStageId: 'sections',
    status: candidates.length ? (selectedIds.length ? 'completed' : 'waiting_manual') : 'empty',
    selectedId: selectedIds[0] || '',
    selectedIds: Object.freeze(selectedIds),
    updatedAt: '',
    candidates: Object.freeze(candidates),
  });
}

function factoryControlInputGroups(factory) {
  const product = factory.product || {};
  const review = typeof factoryAutomationReviewSummary === 'function'
    ? factoryAutomationReviewSummary(factory, factoryAutomationCounts(factory))
    : {};
  const missingRequirements = [
    ...(Array.isArray(review.missingRegister) ? review.missingRegister : []),
    ...(Array.isArray(review.missingGenerate) ? review.missingGenerate : []),
  ].map(item => String(item?.id || item || '').trim()).filter(Boolean);
  const inputImages = Array.isArray(product.inputImages) ? product.inputImages : [];
  const colorImages = Array.isArray(product.colorImages) ? product.colorImages : [];
  const optionImages = Array.isArray(product.optionImages) ? product.optionImages : [];
  return Object.freeze([
    Object.freeze({
      key: 'product',
      count: product.productName || product.userProductName ? 1 : 0,
      missing: Object.freeze(product.productName || product.userProductName ? [] : ['product_name']),
      items: Object.freeze([Object.freeze({
        productName: factoryCurrentProductNameForIdentity(factory),
        dbSelectedId: String(product.selectedDbCandidateKey || '').trim(),
        cafe24SelectedId: String(product.selectedCafe24CandidateKey || '').trim(),
        source: product.confirmedDb ? 'sinhwa-db' : 'manual',
      })]),
    }),
    Object.freeze({
      key: 'requirements',
      count: Object.keys(product.finalDb || {}).length,
      missing: Object.freeze([...new Set(missingRequirements)]),
      items: Object.freeze([factoryRuntimeDetachedValue(product.requirementsSnapshot || product.finalDb || {})]),
    }),
    Object.freeze({
      key: 'source_images',
      count: Number(Boolean(product.imageBase64 || product.imagePreview))
        + inputImages.length + colorImages.length + optionImages.length,
      missing: Object.freeze(product.imageBase64 || product.imagePreview ? [] : ['base_image']),
      items: Object.freeze([
        ...inputImages,
        ...colorImages,
        ...optionImages,
      ].map(item => Object.freeze({
        id: String(item?.id || item?.name || '').trim(),
        name: String(item?.name || item?.label || '').trim(),
        color: String(item?.color || item?.colorName || '').trim(),
        thumbnailUrl: factoryControlThumbnailReference(item),
      }))),
    }),
    Object.freeze({
      key: 'strategy',
      count: 1,
      missing: Object.freeze([]),
      items: Object.freeze([factoryRuntimeDetachedValue({
        goalMode: factory.goalRun?.mode || '',
        optionMode: factory.automation?.optionMode || '',
        sectionPromptPlan: factory.automation?.sectionPromptPlan || {},
        stageOverrides: factory.policyOverrides || {},
      })]),
    }),
    factoryControlCompetitorInputGroup(factory),
  ]);
}

function factoryControlProgress(factory) {
  const activeStage = String(factory.activeStage || '').trim();
  const stage = factory.stages?.[activeStage] || {};
  const goal = factory.goalRun || {};
  const startedAt = Number(
    stage.runStartedAt || goal.startedAt || factory.automation?.currentRunStartedAt || 0,
  );
  const rawStatus = String(
    goal.running ? 'running' : stage.status || goal.status || 'manual',
  ).toLowerCase();
  const allowed = ['auto', 'manual', 'blocked', 'failed', 'completed', 'running', 'paused'];
  return Object.freeze({
    stageKey: activeStage,
    stageLabel: String(goal.currentStage || factoryStageLabel(activeStage) || activeStage).trim(),
    percent: Math.max(0, Math.min(100, Math.round(Number(
      goal.progress ?? stage.progress ?? factory.automation?.progress ?? 0,
    ) || 0))),
    elapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0,
    mode: goal.running || goal.mode === 'auto' ? 'auto' : 'manual',
    status: allowed.includes(rawStatus) ? rawStatus : 'manual',
    message: String(stage.message || goal.failureReason || '').trim(),
  });
}

function createFactoryControlPreflightCache() {
  let cacheKey = '';
  let cacheFlight = null;
  return Object.freeze({
    async read(nextKey, load) {
      const key = String(nextKey || '').trim();
      if (!key) throw new TypeError('factory control preflight cache key is required');
      if (typeof load !== 'function') throw new TypeError('factory control preflight cache loader is required');
      if (cacheKey === key && cacheFlight) return cacheFlight;
      const flight = Promise.resolve().then(load);
      cacheKey = key;
      cacheFlight = flight;
      try {
        return await flight;
      } catch (error) {
        if (cacheFlight === flight) {
          cacheKey = '';
          cacheFlight = null;
        }
        throw error;
      }
    },
    clear() {
      cacheKey = '';
      cacheFlight = null;
    },
  });
}
const factoryControlPreflightCache = createFactoryControlPreflightCache();

async function factoryRuntimeControlProjection() {
  const factory = factoryRuntimeReadViewSnapshot().factory || {};
  const productKey = String(factoryCurrentProductKey(factory) || '').trim();
  const workspaceId = String(
    state.currentProjectId || factory.workspace?.id || factory.currentProjectId || '',
  ).trim();
  const currentRunId = String(factoryCurrentWorkflowRunId(factory) || '').trim();
  const inputFingerprint = String(factoryCurrentInputImageFingerprint(factory) || '').trim();
  const revisionSnapshot = factoryRuntimeAuthoritativeWorkspaceRevision();
  const operationToken = factoryRuntimeRequireStore().getOperationToken();
  const normalizedScope = value => String(value || '').replace(/^(?:project|draft):/i, '').trim();
  const revision = (
    Number.isInteger(Number(revisionSnapshot?.counter))
    && normalizedScope(revisionSnapshot?.scopeId) === normalizedScope(workspaceId)
  )
    ? Number(revisionSnapshot.counter)
    : operationToken.revision;
  const targetProductNo = String(factoryCafe24TargetInfo(factory)?.productNo || '').trim();
  const productId = targetProductNo ? `cafe24:${targetProductNo}` : (productKey ? `factory:${productKey}` : '');
  const connected = Boolean(workspaceId && productKey && currentRunId && inputFingerprint);
  const preflightKey = JSON.stringify({
    workspaceId,
    productKey,
    currentRunId,
    inputFingerprint,
    targetProductNo,
    revision,
    storeRevision: Number(operationToken.revision),
    storeFence: Number(operationToken.fence),
  });
  const preflight = await factoryControlPreflightCache.read(preflightKey, async () => {
    try {
      return await factoryRuntimeInspectBatchCafe24Registration();
    } catch (error) {
      return { status: 'blocked', reason: String(error?.code || error?.message || error) };
    }
  });
  const stages = Object.freeze([
    factoryControlAssetStage(factory, 'representative', 'hero'),
    factoryControlAssetStage(factory, 'size', 'size'),
    factoryControlAssetStage(factory, 'option_color', 'options'),
    factoryControlAssetStage(factory, 'general', 'cuts'),
    factoryControlSectionStage(factory),
    factoryControlAssetStage(factory, 'final_detail', 'detail'),
  ]);
  const product = factory.product || {};
  const finalDb = product.finalDb || {};
  const blockers = [];
  if (!targetProductNo) blockers.push('product_id');
  if (!productKey) blockers.push('product_key');
  if (!currentRunId) blockers.push('run_id');
  if (!inputFingerprint) blockers.push('input_fingerprint');
  // 보드에서 넣은 분류는 factoryRuntimeControlApplyCafe24Category 가 등록 행
  // (finalDb.category = [{ category_no }]) 으로 써 넣는다. 그런데 여기서는 스칼라
  // finalDb.category_no 만 읽고 있어, 사람이 화면에서 분류를 채워도 등록 직전 점검은
  // 계속 category_id 로 막았다 — 실측 2026-08-29: 107 을 넣어도 차단이 안 풀렸다.
  const categoryRowNo = Array.isArray(finalDb.category)
    ? String(finalDb.category.find(row => row && row.category_no)?.category_no || '').trim()
    : '';
  const categoryId = String(
    finalDb.category_no || finalDb.categoryId || categoryRowNo
      || product.categoryId || preflight.categoryId || '',
  ).trim();
  const categoryLabel = String(preflight.categoryLabel || '').trim();
  if (!categoryId) blockers.push('category_id');
  if (!preflight.htmlDigest) blockers.push('html_digest');
  if (!Array.isArray(preflight.imageDigests) || !preflight.imageDigests.length) blockers.push('image_digests');
  if (preflight.reason && preflight.status !== 'ready') blockers.push(String(preflight.reason));
  for (const stage of stages) {
    // 후보가 하나도 생성되지 않은 단계는 이 상품에 해당하지 않는다.
    // (색상이 하나뿐이라 옵션컷이 없는 경우 등) 고를 수 없는 것을 차단 사유로 삼지 않는다.
    const stageHasCandidates = Array.isArray(stage.candidates) && stage.candidates.length > 0;
    if (stageHasCandidates && !(stage.selectedIds || []).length) blockers.push(`${stage.key}_a_cut`);
  }
  const registrationImageFingerprint = factoryProjectFileImageFingerprint(
    (Array.isArray(preflight.imageDigests) ? preflight.imageDigests : [])
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .sort()
      .join('|'),
  );
  const registrationIdempotencyKey = productKey && preflight.htmlDigest && registrationImageFingerprint
    ? `cafe24-stage:v6:${workspaceId || 'factory'}:${productKey}:${preflight.htmlDigest}:${registrationImageFingerprint}`
    : '';
  const publicationReceipt = factoryRuntimeBatchCafe24BindingMatches(
    product.cafe24BatchControlBinding,
    {
      productId,
      productKey,
      categoryId,
      htmlDigest: preflight.htmlDigest,
      imageDigests: preflight.imageDigests,
      idempotencyKey: registrationIdempotencyKey,
      expectedWorkfileRevision: preflight.expectedWorkfileRevision,
      expectedRunId: currentRunId,
      expectedInputFingerprint: inputFingerprint,
    },
  ) ? product.cafe24PublicationReceipt : null;
  const sequence = factoryControlProjectionSequence += 1;
  return Object.freeze({
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    cursor: String(sequence),
    sequence,
    connected,
    status: connected ? 'connected' : 'blocked',
    reason: connected ? '' : 'factory_session_missing',
    capturedAt: new Date().toISOString(),
    session: Object.freeze({
      workspaceId,
      productId,
      productKey,
      runId: currentRunId,
      inputFingerprint,
      revision,
      workfileName: (() => {
        const stored = String(
          factory.workspace?.workfileName || state.currentProjectName || '',
        ).trim();
        if (!stored) return '';
        return /\.kuasangse$/i.test(stored) ? stored : `${stored}.kuasangse`;
      })(),
      workfileSource: String(factory.workspace?.workfileSource || '').trim(),
      workfileSha256: String(factory.workspace?.workfileSha256 || '').trim(),
      workfileBytes: Number(factory.workspace?.workfileBytes || 0),
    }),
    inputs: factoryControlInputGroups(factory),
    stages,
    // 워커가 저장하지 못하고 있다는 사실이 지금까지 이 탭 콘솔에만 남았다. 조작자는
    // 관제탑을 보고 있으므로, 화면에서 넣은 값이 붙지 않아도 이유를 알 길이 없었다
    // — 실측 2026-08-29: 저장 거부가 70초마다 반복되는 동안 화면은 아무 말도 없었고,
    // 사람은 값을 잘못 넣은 줄로 안다. 관제탑까지 실어 보낸다.
    storage: Object.freeze({
      ok: !String(state.storageWarning || '').trim(),
      warning: String(state.storageWarning || '').trim(),
    }),
    progress: factoryControlProgress(factory),
    registration: Object.freeze({
      status: blockers.length
        ? 'blocked'
        : publicationReceipt
          ? 'staged_verified'
          : 'approval_required',
      blockers: Object.freeze([...new Set(blockers)]),
      mode: String(factory.openMarketSync?.cafe24RegistrationMode || '').trim(),
      productId,
      productKey,
      jobId: String(
        publicationReceipt?.jobId
        || factory.goalRun?.jobId
        || factory.batchJobId
        || '',
      ).trim(),
      categoryId,
      categoryLabel,
      htmlDigest: String(preflight.htmlDigest || '').trim(),
      imageDigests: Object.freeze(Array.isArray(preflight.imageDigests) ? [...preflight.imageDigests] : []),
      optionName: String(preflight.optionName || '').trim(),
      optionValues: Object.freeze(Array.isArray(preflight.optionValues) ? [...preflight.optionValues] : []),
      variantCount: Number(preflight.variantCount || 0),
      inventoryQuantity: String(preflight.inventoryQuantity || '').trim(),
      expectedWorkfileRevision: Number.isInteger(Number(preflight.expectedWorkfileRevision))
        ? Number(preflight.expectedWorkfileRevision)
        : revision,
      selling: 'F',
      display: 'F',
      market_sync: 'F',
      idempotencyKey: registrationIdempotencyKey,
      approvalTokenState: publicationReceipt ? 'consumed' : 'missing',
      remoteReadbackDigest: String(publicationReceipt?.remoteReadbackDigest || '').trim(),
      publicationReceipt: factoryRuntimeDetachedValue(publicationReceipt),
    }),
    receipts: Object.freeze([]),
  });
}

function factoryRuntimeControlAssertSelection(projection, payload) {
  const session = projection.session || {};
  const identityPairs = [
    ['productId', payload.productId, session.productId],
    ['productKey', payload.productKey, session.productKey],
    ['runId', payload.expectedRunId, session.runId],
    ['inputFingerprint', payload.expectedInputFingerprint, session.inputFingerprint],
  ];
  const mismatch = identityPairs.find(
    ([, actual, expected]) => String(actual || '').trim() !== String(expected || '').trim(),
  );
  if (mismatch) {
    throw factoryRuntimeBatchCommandError(`stale_run_fingerprint:${mismatch[0]}`);
  }
  if (Number(payload.expectedRevision) !== Number(session.revision)) {
    throw factoryRuntimeBatchCommandError('stale_workfile_revision');
  }
  const stage = (projection.stages || []).find(item => item.key === payload.stageKey);
  if (!stage || !(stage.candidates || []).some(candidate => candidate.id === payload.candidateId)) {
    throw factoryRuntimeBatchCommandError('factory_a_cut_candidate_missing');
  }
}

async function factoryRuntimeControlSelectACut(payload = {}) {
  const before = await factoryRuntimeControlProjection();
  factoryRuntimeControlAssertSelection(before, payload);
  const stageKey = String(payload.stageKey || '').trim();
  const candidateId = String(payload.candidateId || '').trim();
  if (stageKey === 'sections') {
    const separator = candidateId.indexOf(':');
    const sectionId = separator > 0 ? candidateId.slice(0, separator) : '';
    const variantId = separator > 0 ? candidateId.slice(separator + 1) : '';
    if (!sectionId || !variantId || !factoryRuntimeSectionsTab || typeof factoryRuntimeSectionsTab.invoke !== 'function') {
      throw factoryRuntimeBatchCommandError('factory_a_cut_candidate_missing');
    }
    await factoryRuntimeSectionsTab.invoke('applySectionVariant', { sectionId, variantId });
  } else {
    if (!factoryRuntimeAssetsTab || typeof factoryRuntimeAssetsTab.invoke !== 'function') {
      throw factoryRuntimeBatchCommandError('factory_assets_capability_unavailable');
    }
    await factoryRuntimeAssetsTab.invoke('selectACut', { stageKey, candidateId });
  }
  if (typeof saveLastWorkNow === 'function') {
    await saveLastWorkNow({ sync: false });
  }
  const verified = await factoryRuntimeControlProjection();
  const selected = verified.stages.find(item => item.key === stageKey);
  if (!selected || !selected.selectedIds.includes(candidateId)) {
    throw factoryRuntimeBatchCommandError('factory_a_cut_selection_not_persisted');
  }
  // 선택을 체크포인트에 남기지 않으면 다음 배치 실행이 선택 이전 체크포인트를 복원하며
  // 방금 고른 A컷이 사라져 factory_decision_required 로 막힌다.
  const selectionJobId = String(payload.jobId || '').trim();
  let checkpoint = null;
  let projection = verified;
  if (selectionJobId) {
    const saved = await factoryRuntimeControlSaveProductCheckpoint(payload, 'waiting_manual', stageKey);
    checkpoint = saved.checkpoint;
    projection = saved.projection;
  }
  const receiptBasis = [
    projection.session.productKey,
    stageKey,
    candidateId,
    projection.session.revision,
    payload.idempotencyKey,
  ].join('|');
  const receiptDigest = typeof factoryRuntimeSha256Text === 'function'
    ? await factoryRuntimeSha256Text(receiptBasis)
    : receiptBasis;
  return Object.freeze({
    schema: 'factory-a-cut-receipt:v1',
    receiptId: `factory-a-cut:${receiptDigest}`,
    productId: projection.session.productId,
    productKey: projection.session.productKey,
    stageKey,
    candidateId,
    runId: projection.session.runId,
    inputFingerprint: projection.session.inputFingerprint,
    revision: projection.session.revision,
    idempotencyKey: String(payload.idempotencyKey || '').trim(),
    selectedAt: new Date().toISOString(),
    ...(checkpoint ? { status: 'waiting_manual', checkpoint } : {}),
    projection,
  });
}

function factoryRuntimeControlProductImage(value = {}) {
  const dataUrl = String(value.dataUrl || '').trim();
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu.exec(dataUrl);
  if (!match) throw factoryRuntimeBatchCommandError('factory_product_image_invalid');
  return {
    base64: match[2].replace(/\s+/g, ''),
    mime: match[1],
    preview: dataUrl,
    name: String(value.name || value.fileName || '제품사진').trim(),
    colorName: String(value.colorName || '').trim(),
    role: String(value.role || '').trim(),
  };
}

function factoryRuntimeControlProvidedColorOptionValues(payload = {}) {
  const seen = new Set();
  return (Array.isArray(payload.inputImages) ? payload.inputImages : [])
    .filter(image => image?.role === 'color-option')
    .map(image => String(image.colorName || image.name || '').trim())
    .filter(value => value && !seen.has(value) && seen.add(value));
}

function factoryRuntimeControlProvidedColorOptionsMatch(factory, payload = {}) {
  const values = factoryRuntimeControlProvidedColorOptionValues(payload);
  if (!values.length || payload.requiredValues?.optionMode === 'none') return true;
  const group = Array.isArray(factory?.product?.cafe24OptionGroupsDraft)
    ? factory.product.cafe24OptionGroupsDraft[0]
    : null;
  const currentValues = Array.isArray(group?.values) ? group.values.map(value => String(value || '').trim()) : [];
  const settings = factory?.product?.dbFieldSettings || {};
  const currentProductKey = String(factoryCafe24CurrentProductKey(factory) || '').trim();
  const draftProductKey = String(factory?.product?.cafe24DraftProductKey || '').trim();
  return String(group?.name || '').trim() === '색상'
    && currentValues.length === values.length
    && values.every((value, index) => currentValues[index] === value)
    && (!currentProductKey || draftProductKey === currentProductKey)
    && settings.option_name?.manualTouched === true
    && String(settings.option_name?.manualValue || '').trim() === '색상'
    && settings.option_values?.manualTouched === true
    && String(settings.option_values?.manualValue || '').trim() === values.join('\n')
    && settings.option_count?.manualTouched === true
    && String(settings.option_count?.manualValue || '').trim() === String(values.length);
}

function factoryRuntimeControlDecisionMode(payload = {}, decisionId = '') {
  const decisionModes = payload?.decisionModes && typeof payload.decisionModes === 'object'
    && !Array.isArray(payload.decisionModes)
    ? payload.decisionModes
    : {};
  const mode = String(decisionModes[decisionId] || '').trim();
  if (mode === 'auto' || mode === 'manual') return mode;
  return payload.mode === 'auto' ? 'auto' : 'manual';
}

function factoryRuntimeControlExecutionMode(payload = {}) {
  const decisionModes = payload?.decisionModes && typeof payload.decisionModes === 'object'
    && !Array.isArray(payload.decisionModes)
    ? payload.decisionModes
    : {};
  return Object.keys(decisionModes).length ? 'auto' : (payload.mode === 'auto' ? 'auto' : 'review');
}

function factoryRuntimeControlApplyProvidedColorOptions(factory, payload = {}) {
  const values = factoryRuntimeControlProvidedColorOptionValues(payload);
  if (!values.length || payload.requiredValues?.optionMode === 'none') return false;
  if (factoryRuntimeControlProvidedColorOptionsMatch(factory, payload)) return false;
  factoryStoreCafe24OptionGroupDraft([{
    key: 'group_1',
    name: '색상',
    values,
    required_option: 'T',
    option_display_type: 'S',
  }], { factory });
  factorySetDbFieldManualValue('option_count', String(values.length), { enabled: true, factory });
  return true;
}

function factoryRuntimeControlWaitingStage(projection = {}, payload = {}) {
  return (projection.stages || []).find(stage => (
    !(stage?.key === 'option_color' && payload.requiredValues?.optionMode === 'none')
    &&
    Array.isArray(stage?.candidates)
    && stage.candidates.length > 0
    && (!Array.isArray(stage.selectedIds) || stage.selectedIds.length === 0)
  )) || null;
}

function factoryRuntimeControlCheckpointProjectId(jobId = '') {
  return `batch:${String(jobId || '').trim()}`;
}

// 배치 진입점(시작·복원·저장)이 모두 같은 문서 scope 를 요구하도록 이 작업의 프로젝트를 확정한다.
// 워커가 재시작해 컨텍스트가 비었거나 앞 작업의 프로젝트가 남아 있으면 draft scope 또는 남의
// 문서 scope 로 권한을 요구하게 되어 저장이 막힌다.
function factoryRuntimeControlAdoptProductProject(jobId = '') {
  const id = String(jobId || '').trim();
  if (!id) return String(state.currentProjectId || '').trim();
  const projectId = factoryRuntimeControlCheckpointProjectId(id);
  if (String(state.currentProjectId || '').trim() !== projectId) {
    state.currentProjectId = projectId;
  }
  return projectId;
}

function factoryRuntimeControlValidateProductCheckpoint(value = {}, jobId = '') {
  const expectedJobId = String(jobId || '').trim();
  const keys = [
    'schema', 'jobId', 'projectId', 'productId', 'productKey', 'runId',
    'inputFingerprint', 'revision', 'status', 'stageKey', 'savedAt',
  ];
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))
    || value.schema !== 'factory-product-checkpoint:v1'
    || String(value.jobId || '').trim() !== expectedJobId
    || value.projectId !== factoryRuntimeControlCheckpointProjectId(expectedJobId)
    || !['waiting_manual', 'blocked', 'completed'].includes(value.status)
    || typeof value.stageKey !== 'string'
    || value.stageKey !== String(value.stageKey).trim()
    || !Number.isInteger(value.revision)
    || value.revision < 0
    || !Number.isInteger(value.savedAt)
    || value.savedAt < 1
    || ['productId', 'productKey', 'runId', 'inputFingerprint']
      .some(field => !String(value[field] || '').trim())
  ) {
    throw factoryRuntimeBatchCommandError('factory_product_checkpoint_invalid');
  }
  return factoryRuntimeDetachedValue(value);
}

function factoryRuntimeControlCheckpointFromProjection(payload = {}, projection = {}, status = '', stageKey = '') {
  const jobId = String(payload.jobId || '').trim();
  const session = projection?.session && typeof projection.session === 'object'
    ? projection.session
    : {};
  const registration = projection?.registration && typeof projection.registration === 'object'
    ? projection.registration
    : {};
  if (
    String(registration.jobId || '').trim() !== jobId
    || String(session.workspaceId || '').trim() !== factoryRuntimeControlCheckpointProjectId(jobId)
    || ['productId', 'productKey', 'runId', 'inputFingerprint']
      .some(field => !String(session[field] || '').trim())
    || !Number.isInteger(session.revision)
    || session.revision < 0
  ) {
    throw factoryRuntimeBatchCommandError('factory_product_checkpoint_identity_mismatch');
  }
  return Object.freeze({
    schema: 'factory-product-checkpoint:v1',
    jobId,
    projectId: session.workspaceId,
    productId: session.productId,
    productKey: session.productKey,
    runId: session.runId,
    inputFingerprint: session.inputFingerprint,
    revision: session.revision,
    status,
    stageKey,
    savedAt: Date.now(),
  });
}

function factoryRuntimeControlProjectionMatchesCheckpoint(projection = {}, checkpoint = {}, jobId = '', options = {}) {
  const session = projection?.session && typeof projection.session === 'object'
    ? projection.session
    : {};
  const registration = projection?.registration && typeof projection.registration === 'object'
    ? projection.registration
    : {};
  const restoredProductId = String(session.productId || '').trim();
  const checkpointProductId = String(checkpoint.productId || '').trim();
  const staleProductBeforeHydration = options.allowStaleProductBeforeHydration === true
    && /^cafe24:[1-9]\d*$/.test(checkpointProductId)
    && /^cafe24:[1-9]\d*$/.test(restoredProductId)
    && checkpointProductId !== restoredProductId
    && String(registration.mode || '').trim() === 'create'
    && String(registration.productId || '').trim() === restoredProductId;
  const productIdMatches = restoredProductId === checkpointProductId || (
    checkpointProductId === `factory:${String(checkpoint.productKey || '').trim()}`
    && /^cafe24:[1-9]\d*$/.test(restoredProductId)
    && String(registration.productId || '').trim() === restoredProductId
  ) || (
    /^cafe24:[1-9]\d*$/.test(checkpointProductId)
    && /^cafe24:[1-9]\d*$/.test(restoredProductId)
    && checkpointProductId !== restoredProductId
    && String(registration.mode || '').trim() === 'update'
    && String(registration.productId || '').trim() === restoredProductId
  ) || staleProductBeforeHydration;
  // 체크포인트는 되돌아갈 지점이지 판을 고정하는 표가 아니다. 저장이 한 번이라도 앞서 나가면
  // 완전 일치를 요구하는 순간 같은 작업인데도 영영 복원할 수 없게 된다. 신원은 그대로 엄격히
  // 확인하고, 판은 체크포인트와 같거나 더 나아간 것까지 같은 작업으로 받아들인다.
  // 저장된 문서를 다시 불러오면 판 카운터가 매번 다르게 매겨진다. 같은 문서를 연속으로 두 번
  // 불러와도 11 과 7 로 달라지는 것을 실측했다. 그래서 로컬 문서를 불러온 경로에서는 판을
  // 비교하지 않는다. 서버 스냅샷 중 어느 것을 고를지 판단하는 경로는 종전대로 판을 쓴다.
  const restoredRevision = Number(session.revision);
  const checkpointRevision = Number(checkpoint.revision);
  const revisionIsAtOrAhead = options.ignoreRevision === true || (
    Number.isFinite(restoredRevision)
    && Number.isFinite(checkpointRevision)
    && restoredRevision >= checkpointRevision
  );
  return String(registration.jobId || '').trim() === String(jobId || '').trim()
    && productIdMatches
    && revisionIsAtOrAhead
    && ['workspaceId', 'productKey', 'runId', 'inputFingerprint'].every(field => (
      String(session[field] || '').trim()
      === String(field === 'workspaceId' ? checkpoint.projectId : checkpoint[field] || '').trim()
    ));
}

function factoryRuntimeControlServerSnapshotMatchesCheckpoint(snapshot = {}, checkpoint = {}, jobId = '', options = {}) {
  const assets = snapshot?.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  const factory = assets?.factory && typeof assets.factory === 'object' ? assets.factory : {};
  const productKey = String(factoryCurrentProductKey(factory) || '').trim();
  const productNo = String(factoryCafe24TargetInfo(factory)?.productNo || '').trim();
  const rawRevision = snapshot?.workspaceRevision?.counter
    ?? assets?.workspaceRevision?.counter
    ?? factory.workspaceRevision?.counter;
  const revision = Number(rawRevision);
  // 저장된 문서가 판 번호를 안 달고 있는 경우가 있다. 없는 값을 낡은 것으로 치면
  // 신원이 완벽히 같은 스냅샷도 영영 실리지 않아, 탭을 새로 연 작업이 통째로 막힌다.
  // null 을 Number 에 넣으면 0 이 되어 "가장 낡은 판"으로 둔갑하므로 따로 걸러낸다.
  const revisionUnreadable = rawRevision === null
    || rawRevision === undefined
    || !Number.isFinite(revision);
  return factoryRuntimeControlProjectionMatchesCheckpoint({
    session: {
      workspaceId: String(factory.workspace?.id || factory.currentProjectId || assets?.currentProjectId || '').trim(),
      productId: productNo ? `cafe24:${productNo}` : (productKey ? `factory:${productKey}` : ''),
      productKey,
      runId: String(factoryCurrentWorkflowRunId(factory) || '').trim(),
      inputFingerprint: String(factoryCurrentInputImageFingerprint(factory) || '').trim(),
      revision,
    },
    // Cafe24 에 올린 뒤에는 이 제품의 신원이 factory:키 에서 cafe24:번호 로 바뀐다.
    // 등록 대상 번호를 함께 주지 않으면 그 승격을 알아볼 수 없어, 한 번 등록한 제품은
    // 자기 저장본으로 다시 열 수 없게 된다.
    registration: {
      jobId: String(factory.goalRun?.jobId || factory.batchJobId || '').trim(),
      productId: productNo ? `cafe24:${productNo}` : '',
    },
  }, checkpoint, jobId, { ignoreRevision: revisionUnreadable || options.ignoreRevision === true });
}

async function factoryRuntimeControlSaveProductCheckpoint(payload = {}, status = '', stageKey = '') {
  const productAuthorityScope = getCurrentDocumentWorkspaceScope(
    factoryRuntimeControlAdoptProductProject(payload.jobId),
  );
  // 상세페이지 빌드처럼 오래 도는 단계 직후에는 잠금이 잠시 draft 로 되돌아가 있을 수 있다.
  // 첫 시도 실패로 작업을 막아버리면 그때까지 만든 컷과 상세페이지를 통째로 잃는다.
  const authorityAcceptable = value => (
    ['editing', 'offline-edit'].includes(value?.mode) && value?.scopeId === productAuthorityScope
  );
  let productAuthority = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    productAuthority = await ensureWorkspaceEditAuthority(productAuthorityScope, {
      force: true,
      confirmedTakeover: true,
    });
    if (authorityAcceptable(productAuthority)) break;
    await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
  }
  if (!authorityAcceptable(productAuthority)) {
    throw factoryRuntimeBatchCommandError('factory_product_workspace_authority_unavailable');
  }
  // 저장 직전에 다른 저장이 끼어들면 서버가 낡은 판이라며 409 로 되돌린다. 그러면 상세페이지까지
  // 다 만들어 놓고 마지막 저장에서 작업이 막힌다. 편집권을 다시 잡아 최신 판으로 한 번 더 시도한다.
  let saved = await saveCurrentProject({ retainProjectAuthority: true });
  if (saved !== true) {
    const rebased = await ensureWorkspaceEditAuthority(productAuthorityScope, {
      force: true,
      confirmedTakeover: true,
    });
    if (authorityAcceptable(rebased)) {
      saved = await saveCurrentProject({ retainProjectAuthority: true });
    }
  }
  if (saved !== true) {
    const detail = String(state.error || '').trim();
    throw factoryRuntimeBatchCommandError(`factory_product_checkpoint_save_failed${detail ? `: ${detail}` : ''}`);
  }
  // 판 번호를 읽기 전에 서버 문서를 먼저 밀어 넣는다. 이걸 빼면 체크포인트가 아직
  // 저장되지 않은 판을 적는다. 실측: 문서는 판 35 로 저장됐는데 1.3초 뒤 기록된
  // 체크포인트는 60 이었고, 그 작업은 다시 열 때마다 낡은 문서 취급을 받아 막혔다.
  if (typeof saveLastWorkNow === 'function') await saveLastWorkNow({ sync: false });
  const projection = await factoryRuntimeControlProjection();
  return Object.freeze({
    projection,
    checkpoint: factoryRuntimeControlCheckpointFromProjection(payload, projection, status, stageKey),
  });
}

const FACTORY_ARCHIVE_FOLDER_FAILURE = '저장 폴더 권한이 없습니다.';

async function factoryRuntimeControlClearSkippedArchiveFailure() {
  const batchWorker = typeof classicRuntimeIsBatchWorker === 'function'
    && classicRuntimeIsBatchWorker();
  if (!batchWorker) return false;
  const stage = factoryRuntimeReadFactory()?.stages?.export;
  if (String(stage?.status || '') !== 'error') return false;
  if (!String(stage?.message || '').includes(FACTORY_ARCHIVE_FOLDER_FAILURE)) return false;
  await factoryRuntimeUpdateOwnedFactory(
    'factory/archive:clearSkippedArchiveFailure',
    'factory-assets',
    draft => {
      const target = draft.stages?.export;
      if (!target) return false;
      target.status = 'done';
      target.message = '디스크 보관 건너뜀 · 로컬 보관 유지';
      return true;
    },
  );
  await saveLastWorkNow({ sync: false });
  return true;
}

async function factoryRuntimeControlRestoreProductCheckpoint(payload = {}) {
  const jobId = String(payload.jobId || '').trim();
  const checkpoint = factoryRuntimeControlValidateProductCheckpoint(payload.checkpoint, jobId);
  if (state.projectBusy) {
    throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_busy');
  }
  // 서버에서 실어 오는 경로는 "지금 열려 있는" 작업공간의 문서를 읽는다. 먼저 이 작업으로
  // 옮기지 않으면 다른 제품의 문서를 읽고 신원이 다르다며 복원이 영영 실패한다.
  factoryRuntimeControlAdoptProductProject(jobId);
  const canHydrateServerCheckpoint = typeof hydrateServerLastWorkSnapshot === 'function';
  // 복원한 뒤의 확인은 방금 실어 온 그 문서를 다시 보는 것이다. 판 번호는 창이 문서를
  // 열 때마다 새로 매기므로(실측 96 → 33) 여기서 비교하면 작업이 영영 막힌다.
  const RESTORED_IDENTITY_ONLY = Object.freeze({ ignoreRevision: true });
  const hydrateServerCheckpoint = async () => {
    let rejected = false;
    const requestHydration = () => hydrateServerLastWorkSnapshot({
      force: true,
      forceRevisionRestore: true,
      render: false,
      // 화면에 남아 있던 다른 제품이 아니라, 불러올 이 작업의 범위를 명시한다.
      documentScopeId: getCurrentDocumentWorkspaceScope(checkpoint.projectId),
    }, {
      validateSnapshot: snapshot => {
        // 같은 작업의 낡은 스냅샷을 고르면 만들어 둔 결과를 잃는다. 판이 달려 있으면
        // 그대로 비교하고, 아예 없는 문서만 신원으로 판단한다.
        const valid = factoryRuntimeControlServerSnapshotMatchesCheckpoint(snapshot, checkpoint, jobId);
        rejected = !valid;
        return valid;
      },
    });
    let hydrated = await requestHydration();
    // 앱이 켜지며 다른 제품을 불러오는 중이면 첫 요청은 그 작업이 끝나기만 기다렸다가
    // 그냥 거짓을 돌려준다. 실측: 그 사이 화면은 단색으로 바뀌고 R3 복원은 실패했다.
    // 한 번 더 요청해야 이 작업이 실제로 실린다.
    if (hydrated !== true && !rejected) hydrated = await requestHydration();
    return { hydrated, rejected };
  };
  const restored = await loadProjectRecord(checkpoint.projectId, { startupRestore: true, checkpointRestore: true });
  let hydratedServerCheckpoint = false;
  let restoredOntoCheckpoint = false;
  let projection;
  if (!restored) {
    if (!canHydrateServerCheckpoint) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_failed');
    }
    const hydration = await hydrateServerCheckpoint();
    hydratedServerCheckpoint = hydration.hydrated;
    if (hydration.rejected) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_mismatch');
    }
    projection = await factoryRuntimeControlProjection();
    // 어느 스냅샷을 실을지는 위에서 판까지 따져 이미 골랐다. 실어 놓은 뒤의 판 번호는
    // 이 창이 문서를 새로 열며 매긴 값이라 체크포인트의 판과 비교할 수 없다.
    const alreadyOnCheckpoint = factoryRuntimeControlProjectionMatchesCheckpoint(
      projection,
      checkpoint,
      jobId,
      RESTORED_IDENTITY_ONLY,
    );
    restoredOntoCheckpoint = alreadyOnCheckpoint;
    // "실어 올 것이 없다"는 응답은 이미 그 문서를 열고 있을 때도 온다. 그때까지 실패로
    // 세면, 제대로 열려 있는 작업이 복원 실패로 막힌다.
    if (hydratedServerCheckpoint !== true && !alreadyOnCheckpoint) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_hydration_failed');
    }
    if (!alreadyOnCheckpoint) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_mismatch');
    }
  }
  projection ||= await factoryRuntimeControlProjection();
  if (!factoryRuntimeControlProjectionMatchesCheckpoint(projection, checkpoint, jobId, {
    allowStaleProductBeforeHydration: canHydrateServerCheckpoint,
    // loadProjectRecord 는 참/거짓이 아니라 불러온 기록을 돌려준다. === true 로 비교하면
    // 문서를 제대로 불러오고도 판 비교가 켜져, 새 탭에서 그 작업이 영영 막힌다.
    // 방금 이 체크포인트 위로 문서를 세워 놓고, 바로 다음 줄에서 판으로 다시 거절하면
    // 복원은 성공해 놓고도 실패로 끝난다. 실측: RP 를 제대로 실어 놓고 판 59 와 비교해
    // 막혔다.
    ignoreRevision: Boolean(restored)
      || hydratedServerCheckpoint === true
      || restoredOntoCheckpoint,
  })) {
    throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_mismatch');
  }
  const productAuthorityScope = getCurrentDocumentWorkspaceScope(checkpoint.projectId);
  const productAuthority = await ensureWorkspaceEditAuthority(productAuthorityScope, {
    force: true,
    confirmedTakeover: true,
  });
  if (!['editing', 'offline-edit'].includes(productAuthority?.mode) || productAuthority.scopeId !== productAuthorityScope) {
    throw factoryRuntimeBatchCommandError('factory_product_workspace_authority_unavailable');
  }
  // 로컬 기록으로 이미 이 체크포인트 위에 서 있으면 서버에서 더 실어 올 것이 없다.
  // 실측: 그 상태에서 하이드레이션을 돌리자 판 214 로 맞아 있던 문서가 판 28 짜리로
  // 바뀌어, 멀쩡히 복원된 작업이 불일치로 죽었다.
  // 되돌림(2026-08-28): 여기서 '후보가 실려 있을 때만 건너뛴다'로 좁혔더니, 후보가 0건인
  // 작업에서 하이드레이션이 다시 돌아 이미 열려 있던 작업물을 낡은 서버본으로 덮었다.
  // 위 실측(판 214 -> 28)이 말하는 위험이 그대로 재현된다. 데이터 보존이 우선이므로
  // 신원만 맞으면 건너뛰는 원래 가드로 되돌린다.
  const settledOnCheckpoint = factoryRuntimeControlProjectionMatchesCheckpoint(
    projection,
    checkpoint,
    jobId,
    RESTORED_IDENTITY_ONLY,
  );
  if (canHydrateServerCheckpoint && !hydratedServerCheckpoint && !settledOnCheckpoint) {
    const hydration = await hydrateServerCheckpoint();
    if (hydration.rejected) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_mismatch');
    }
    projection = await factoryRuntimeControlProjection();
    const onCheckpoint = factoryRuntimeControlProjectionMatchesCheckpoint(
      projection,
      checkpoint,
      jobId,
      RESTORED_IDENTITY_ONLY,
    );
    // 로컬 기록을 이미 제대로 불러왔으면 서버가 실어 올 것이 없다고 답한다. 그 "바꿀 것
    // 없음" 을 실패로 세면, 멀쩡히 열려 있는 작업이 복원 실패로 죽는다.
    if (hydration.hydrated !== true && !onCheckpoint) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_hydration_failed');
    }
    if (!onCheckpoint) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_mismatch');
    }
  }
  if (payload.requiredValues?.optionMode === 'none') {
    await factoryRuntimeControlRestoreRequiredValues(payload);
    if (factoryRuntimeReadFactory().automation?.optionMode !== 'none') {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_option_mode_restore_failed');
    }
  }
  await factoryRuntimeUpdateOwnedFactory(
    'factory/sections:guide:apply-sections',
    'detail-document',
    draft => factoryApplySelectedAssetsToSections(draft),
  );
  await saveLastWorkNow({ sync: false });
  projection = await factoryRuntimeControlProjection();
  if (!factoryRuntimeControlProjectionMatchesCheckpoint(projection, checkpoint, jobId, RESTORED_IDENTITY_ONLY)) {
    throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_mismatch');
  }
  // 워커에는 폴더 선택창에 답할 사람이 없어 디스크 보관은 건너뛴다. 그 전에 남은 옛
  // 실패 표시를 그대로 두면, 다 만들어 둔 제품이 매번 검수 대기로 되돌아온다.
  if (typeof factoryRuntimeControlClearSkippedArchiveFailure === 'function'
    && await factoryRuntimeControlClearSkippedArchiveFailure()) {
    // 정리하기 전에 뜬 판을 그대로 쓰면, 관제탑에는 방금 지운 실패가 그대로 보고된다.
    projection = await factoryRuntimeControlProjection();
  }
  if (!factoryRuntimeControlProvidedColorOptionsMatch(factoryRuntimeReadFactory(), payload)) {
    await factoryRuntimeUpdateOwnedFactory(
      'factory/control:prepareProduct',
      'factory',
      draft => factoryRuntimeControlApplyProvidedColorOptions(draft, payload),
    );
    await saveLastWorkNow({ sync: false });
    projection = await factoryRuntimeControlProjection();
    if (!factoryRuntimeControlProjectionMatchesCheckpoint(projection, checkpoint, jobId, RESTORED_IDENTITY_ONLY)) {
      throw factoryRuntimeBatchCommandError('factory_product_checkpoint_restore_mismatch');
    }
  }
  const restoredProgress = projection?.progress && typeof projection.progress === 'object'
    ? projection.progress
    : {};
  const restoredProgressStatus = String(restoredProgress.status || '').trim();
  const restoredStatus = restoredProgressStatus === 'failed'
    ? 'blocked'
    : ['waiting_manual', 'completed', 'blocked', 'manual'].includes(restoredProgressStatus)
      ? (restoredProgressStatus === 'manual' ? 'waiting_manual' : restoredProgressStatus)
      : checkpoint.status;
  const restoredProgressStageKey = String(restoredProgress.stageKey || '').trim();
  const restoredProgressStage = (projection.stages || []).find(stage => (
    String(stage?.key || '').trim() === restoredProgressStageKey
    || String(stage?.factoryStageId || '').trim() === restoredProgressStageKey
  ))?.key || checkpoint.stageKey;
  const restoredOptionlessStage = restoredProgressStage === 'option_color'
    && payload.requiredValues?.optionMode === 'none';
  const restoredWaitingStage = restoredOptionlessStage
    ? factoryRuntimeControlWaitingStage(projection, payload)
    : null;
  const restoredStageKey = restoredWaitingStage?.key || (restoredOptionlessStage ? '' : restoredProgressStage);
  const normalizedRestoredStatus = restoredWaitingStage ? 'waiting_manual' : restoredStatus;
  const restoredMessage = String(restoredProgress.message || '').trim() || (
    normalizedRestoredStatus === 'completed'
      ? '완료 제품을 다시 열었습니다 · Cafe24 사전점검 및 일회 승인 대기'
      : normalizedRestoredStatus === 'waiting_manual'
        ? '제품 체크포인트 복원 완료 · A컷 선택을 이어가세요.'
        : '제품 체크포인트 복원 완료 · 차단 사유를 확인하세요.'
  );
  return Object.freeze({
    schema: 'factory-product-run-receipt:v1',
    jobId,
    status: normalizedRestoredStatus,
    stageKey: restoredStageKey,
    message: restoredMessage,
    projection,
    checkpoint: factoryRuntimeControlCheckpointFromProjection(
      payload,
      projection,
      normalizedRestoredStatus,
      restoredStageKey,
    ),
  });
}

async function factoryRuntimeControlPrepareProduct(payload = {}) {
  const jobId = String(payload.jobId || '').trim();
  const productName = String(payload.productName || '').trim();
  const sourceKind = String(payload.source?.kind || '').trim();
  const adoptHydratedWorkfile = payload.adoptHydratedWorkfile === true;
  if (!jobId || !productName || !['manual', 'sinhwa-db', 'workfile'].includes(sourceKind)) {
    throw factoryRuntimeBatchCommandError('factory_product_payload_invalid');
  }
  if (adoptHydratedWorkfile) {
    const before = await factoryRuntimeControlProjection();
    const session = before.session || {};
    const source = payload.source || {};
    const identityPairs = [
      ['workspaceId', source.workspaceId],
      ['productId', source.productId],
      ['productKey', source.productKey],
      ['runId', source.runId],
      ['inputFingerprint', source.inputFingerprint],
      ['revision', payload.hydratedRevision],
    ];
    if (
      sourceKind !== 'workfile'
      || payload.startFresh !== false
      || identityPairs.some(([key, expected]) => session[key] !== expected)
    ) {
      throw factoryRuntimeBatchCommandError('factory_workfile_fork_identity_mismatch');
    }
    const protectedStages = JSON.stringify(before.stages || []);
    const protectedOutputs = JSON.stringify(before.outputs || []);
    const protectedInputs = JSON.stringify(before.inputs || []);
    const requiredValues = payload.requiredValues && typeof payload.requiredValues === 'object'
      ? factoryRuntimeDetachedValue(payload.requiredValues)
      : {};
    const checkpointProjectId = factoryRuntimeControlCheckpointProjectId(jobId);
    state.currentProjectId = checkpointProjectId;
    state.currentProjectName = productName;
    state.currentProjectCreatedAt = Date.now();
    state.workIdentity = null;
    const authorityScope = getCurrentDocumentWorkspaceScope(checkpointProjectId);
    const authority = await ensureWorkspaceEditAuthority(authorityScope, {
      force: true,
      confirmedTakeover: true,
    });
    if (!['editing', 'offline-edit'].includes(authority?.mode) || authority.scopeId !== authorityScope) {
      throw factoryRuntimeBatchCommandError('factory_product_workspace_authority_unavailable');
    }
    await factoryRuntimeUpdateOwnedFactory(
      'factory/control:prepareProduct',
      'factory',
      draft => {
        draft.workspace = draft.workspace && typeof draft.workspace === 'object' ? draft.workspace : {};
        draft.workIdentity = null;
        draft.workspace.id = checkpointProjectId;
        draft.currentProjectId = checkpointProjectId;
        draft.currentProjectName = productName;
        draft.batchJobId = jobId;
        draft.goalRun = draft.goalRun && typeof draft.goalRun === 'object' ? draft.goalRun : {};
        draft.goalRun.jobId = jobId;
        draft.goalRun.mode = factoryRuntimeControlExecutionMode(payload);
        draft.goalRun.decisionMode = payload.mode;
        draft.goalRun.decisionModes = factoryRuntimeDetachedValue(payload.decisionModes || {});
        draft.goalRun.failureReason = '';
        draft.product = draft.product && typeof draft.product === 'object' ? draft.product : {};
        for (const field of ['finalDb', 'confirmedDb', 'requirementsSnapshot']) {
          draft.product[field] = { ...(draft.product[field] || {}), ...requiredValues };
        }
        state.productInfoManualValues = { ...(state.productInfoManualValues || {}), ...requiredValues };
        return true;
      },
    );
    const adoptedIdentity = ensureActiveWorkIdentity({
      factorySnapshot: factoryRuntimeDetachedValue(factoryRuntimeReadFactory()),
      forceNew: true,
    });
    if (adoptedIdentity) {
      await factoryRuntimeUpdateOwnedFactory(
        'factory/runtime:sealWorkIdentity',
        'factory',
        draft => {
          draft.workIdentity = cloneData(adoptedIdentity);
          return adoptedIdentity.instanceId;
        },
      );
    }
    await saveLastWorkNow({ sync: false });
    const after = await factoryRuntimeControlProjection();
    if (
      JSON.stringify(after.stages || []) !== protectedStages
      || JSON.stringify(after.outputs || []) !== protectedOutputs
      || (!Object.keys(requiredValues).length && JSON.stringify(after.inputs || []) !== protectedInputs)
    ) {
      throw factoryRuntimeBatchCommandError('factory_workfile_fork_protected_state_reduced');
    }
    return;
  }
  if (payload.startFresh === true) {
    const draftScope = getCurrentLastWorkWorkspaceScope();
    const authority = await ensureWorkspaceEditAuthority(draftScope, { force: true });
    if (!['editing', 'offline-edit'].includes(authority?.mode) || authority.scopeId !== draftScope) {
      throw factoryRuntimeBatchCommandError('factory_product_workspace_authority_unavailable');
    }
    try {
      await resetActiveWorkspaceDocumentCore();
    } finally {
      if (typeof completeWorkspaceBlankResetBoundary === 'function') {
        completeWorkspaceBlankResetBoundary();
      }
    }
  }
  const current = factoryRuntimeReadFactory();
  if (payload.startFresh !== true && String(current.goalRun?.jobId || '').trim() !== jobId) {
    throw factoryRuntimeBatchCommandError('stale_factory_product_job');
  }
  if (payload.imageModel) {
    state.modelConfig = normalizeModelConfig({ ...state.modelConfig, imageModel: payload.imageModel });
    saveModelConfig(state.modelConfig);
  }
  const checkpointProjectId = factoryRuntimeControlCheckpointProjectId(jobId);
  const sameCheckpointProject = String(state.currentProjectId || '').trim() === checkpointProjectId;
  state.currentProjectId = checkpointProjectId;
  state.currentProjectName = productName;
  state.currentProjectCreatedAt = sameCheckpointProject
    ? Number(state.currentProjectCreatedAt || 0) || Date.now()
    : Date.now();
  const productAuthorityScope = getCurrentDocumentWorkspaceScope(checkpointProjectId);
  const productAuthority = await ensureWorkspaceEditAuthority(productAuthorityScope, {
    force: true,
    confirmedTakeover: true,
  });
  if (!['editing', 'offline-edit'].includes(productAuthority?.mode) || productAuthority.scopeId !== productAuthorityScope) {
    throw factoryRuntimeBatchCommandError('factory_product_workspace_authority_unavailable');
  }
  if (payload.startFresh !== true && typeof hydrateServerLastWorkSnapshot === 'function') {
    await hydrateServerLastWorkSnapshot({
      force: true,
      forceRevisionRestore: true,
      render: false,
    });
    if (String(factoryRuntimeReadFactory().goalRun?.jobId || '').trim() !== jobId) {
      throw factoryRuntimeBatchCommandError('stale_factory_product_job');
    }
  }
  const images = Array.isArray(payload.inputImages)
    ? payload.inputImages.map(factoryRuntimeControlProductImage)
    : [];
  const firstBase = images.find(image => image.role === 'base');
  if (sourceKind === 'manual' && !firstBase) {
    throw factoryRuntimeBatchCommandError('factory_product_base_image_required');
  }
  if (payload.startFresh !== true) {
    await factoryRuntimeUpdateOwnedFactory(
      'factory/control:prepareProduct',
      'factory',
      draft => {
        draft.goalRun = draft.goalRun && typeof draft.goalRun === 'object' ? draft.goalRun : {};
        draft.goalRun.mode = factoryRuntimeControlExecutionMode(payload);
        draft.goalRun.decisionMode = payload.mode;
        draft.goalRun.decisionModes = factoryRuntimeDetachedValue(payload.decisionModes || {});
        draft.product = draft.product && typeof draft.product === 'object' ? draft.product : {};
        draft.product.candidateAutoApply = sourceKind === 'sinhwa-db' || payload.mode === 'auto';
        if (firstBase) factoryApplyProductImagePayload(firstBase, { factory: draft, syncState: true });
        factoryRuntimeControlApplyProvidedColorOptions(draft, payload);
        return true;
      },
    );
    return;
  }
  const requiredValues = payload.requiredValues && typeof payload.requiredValues === 'object'
    ? factoryRuntimeDetachedValue(payload.requiredValues)
    : {};
  const extraBaseImages = images.filter(image => image.role === 'base' && image !== firstBase);
  const colorImages = images.filter(image => image.role === 'color-option');
  const usage = String(requiredValues.usage || requiredValues.category || '일상용').trim();
  const stock = /^\d{1,9}$/.test(String(requiredValues.stock || '').trim())
    ? String(requiredValues.stock).trim()
    : '99';
  const optionMode = ['provided', 'none'].includes(requiredValues.optionMode)
    ? requiredValues.optionMode
    : (colorImages.length ? 'provided' : 'none');
  await factoryRuntimeUpdateOwnedFactory(
    'factory/control:prepareProduct',
    'factory',
    draft => {
      draft.workspace = draft.workspace && typeof draft.workspace === 'object' ? draft.workspace : {};
      draft.workspace.id = `batch:${jobId}`;
      draft.workspace.name = productName;
      draft.currentProjectId = draft.workspace.id;
      draft.currentProjectName = productName;
      // 화면 맨 위의 제품명도 새 제품으로 바꾼다. 여기를 안 바꾸면 앞 제품 이름이 그대로
      // 남아, 작업 신원 검사가 '서로 다른 제품이 섞였다'(WORK_IDENTITY_PRODUCT_CONFLICT)로
      // 작업파일 저장을 막는다 — 실측 2026-08-29: 한 워커 세션에서 직접 입력 제품을 둘째로
      // 돌리자 곧바로 factory_product_workfile_save_failed 로 죽었다. 첫 제품은 멀쩡했다.
      draft.productName = productName;
      draft.batchJobId = jobId;
      draft.goalRun = draft.goalRun && typeof draft.goalRun === 'object' ? draft.goalRun : {};
      draft.goalRun.jobId = jobId;
      draft.goalRun.mode = factoryRuntimeControlExecutionMode(payload);
      draft.goalRun.decisionMode = payload.mode;
      draft.goalRun.decisionModes = factoryRuntimeDetachedValue(payload.decisionModes || {});
      draft.goalRun.failureReason = '';
      draft.product = draft.product && typeof draft.product === 'object' ? draft.product : {};
      factorySetCurrentProductIdentity(productName, {
        factory: draft,
        productKey: productName,
        rotateWorkIdentity: payload.startFresh === true,
        syncDom: false,
        forceDom: false,
      });
      draft.product.jcode = Number.isInteger(Number(payload.jcode)) && Number(payload.jcode) > 0
        ? Number(payload.jcode)
        : null;
      draft.product.candidateAutoApply = sourceKind === 'sinhwa-db' || payload.mode === 'auto';
      if (sourceKind === 'manual') {
        const manualDb = {
          ...requiredValues,
          ...Object.fromEntries(
            // 관제탑의 widthMm/depthMm 을 신화사 DB 이름(width_mm/depth_mm)으로 바꿔 준다.
            // 이 이름이라야 사이즈이미지 단계가 값을 본다(factoryCollectDbSizeFacts).
            [['widthMm', 'width_mm'], ['depthMm', 'depth_mm']]
              .map(([from, to]) => [to, String((requiredValues || {})[from] ?? '').trim()])
              .filter(([, value]) => value),
          ),
          usage,
          stock,
          quantity: stock,
          product_name: productName,
          jname: productName,
          ...(draft.product.jcode ? { jcode: draft.product.jcode } : {}),
        };
        draft.product.finalDb = factoryRuntimeDetachedValue(manualDb);
        draft.product.confirmedDb = factoryRuntimeDetachedValue(manualDb);
        draft.product.requirementsSnapshot = factoryRuntimeDetachedValue(manualDb);
        draft.product.analysis = factoryRuntimeDetachedValue(manualDb);
        draft.stages = draft.stages && typeof draft.stages === 'object' ? draft.stages : {};
        draft.stages.db = draft.stages.db && typeof draft.stages.db === 'object' ? draft.stages.db : {};
        draft.stages.db.status = 'done';
        draft.stages.db.message = '직접 입력 필수값 적용 완료';
        state.analysis = factoryRuntimeDetachedValue(manualDb);
        state.productInfoManualValues = factoryRuntimeDetachedValue(requiredValues);
      }
      if (firstBase) factoryApplyProductImagePayload(firstBase, { factory: draft, syncState: true });
      const imageRecord = (image, role) => {
        const fingerprint = factoryImagePayloadFingerprint(image.base64);
        return {
          id: uid(role === 'base' ? 'factory_input' : 'factory_color'),
          name: image.name,
          colorName: image.colorName,
          color: image.colorName,
          base64: image.base64,
          mime: image.mime,
          preview: image.preview,
          dataUrl: image.preview,
          inputImageFingerprint: fingerprint,
          sourceImageKey: fingerprint,
          productImageKey: fingerprint,
          productKey: factoryCurrentProductKey(draft),
          currentRunId: factoryCurrentWorkflowRunId(draft),
          uploadedAt: Date.now(),
        };
      };
      draft.product.inputImages = [
        ...(Array.isArray(draft.product.inputImages) ? draft.product.inputImages : []),
        ...extraBaseImages.map(image => imageRecord(image, 'base')),
      ];
      draft.product.colorImages = colorImages.map(image => imageRecord(image, 'color'));
      factoryRuntimeControlApplyProvidedColorOptions(draft, payload);
      draft.automation = draft.automation && typeof draft.automation === 'object' ? draft.automation : {};
      draft.automation.optionMode = optionMode;
      draft.automation.optionSourceSummary = optionMode === 'provided'
        ? { count: factoryRuntimeControlProvidedColorOptionValues(payload).length, groupCount: colorImages.length ? 1 : 0, source: '생산관제 입력', updatedAt: Date.now() }
        : { count: 0, groupCount: 0, source: '생산관제 입력', updatedAt: Date.now() };
      draft.automation.activeTab = 'automation';
      draft.automation.activeTaskId = 'goal-loop';
      factoryLog(
        `생산관제 후보 생성 자동 · 단계별 선택 정책 연결: ${productName}`,
        'info',
        draft,
      );
      return true;
    },
  );
  await saveLastWorkNow({ sync: false });
  const workfileBaseName = String(
    payload.workfileName || `${productName}.kuasangse`,
  ).trim().replace(/\.kuasangse$/i, '');
  const canExportWorkfile = typeof exportCurrentProjectFile === 'function';
  const savedWorkfile = canExportWorkfile
    ? await exportCurrentProjectFile({
      name: workfileBaseName || productName,
      downloadOnly: true,
      skipBrowserDownload: true,
    })
    : true;
  if (!savedWorkfile) {
    throw factoryRuntimeBatchCommandError('factory_product_workfile_save_failed');
  }
  const savedWorkfileReceipt = typeof window !== 'undefined'
    ? window.__KUASANGSE_LAST_WORKFILE_RECEIPT__
    : null;
  await factoryRuntimeUpdateOwnedFactory(
    'factory/control:workfileCreated',
    'factory',
    draft => {
      draft.workspace = draft.workspace && typeof draft.workspace === 'object' ? draft.workspace : {};
      draft.workspace.workfileName = String(
        savedWorkfileReceipt?.fileName || `${workfileBaseName || productName}.kuasangse`,
      ).trim();
      draft.workspace.workfileSource = String(
        savedWorkfileReceipt?.source || (canExportWorkfile ? 'authoritative-store' : 'runtime-only'),
      ).trim();
      draft.workspace.workfileSha256 = String(savedWorkfileReceipt?.sha256 || '').trim();
      draft.workspace.workfileBytes = Number(savedWorkfileReceipt?.bytes || 0);
      return true;
    },
  );
  await saveLastWorkNow({ sync: false });
}

async function factoryRuntimeControlRestoreRequiredValues(payload = {}) {
  const requiredValues = payload.requiredValues && typeof payload.requiredValues === 'object'
    ? factoryRuntimeDetachedValue(payload.requiredValues)
    : {};
  if (!Object.keys(requiredValues).length) return;
  const optionMode = ['provided', 'none'].includes(requiredValues.optionMode)
    ? requiredValues.optionMode
    : '';
  const productName = String(payload.productName || '').trim();
  const stock = /^\d{1,9}$/.test(String(requiredValues.stock || '').trim())
    ? String(requiredValues.stock).trim()
    : '99';
  const authoritative = {
    ...requiredValues,
    ...{
    // 사이즈이미지 단계는 confirmedDb 의 width_mm / depth_mm 를 읽는다. 관제탑 투입값은
    // widthMm / depthMm 라 이름이 달라 그대로는 안 보인다 — 실측 2026-08-28, 직접 입력한
    // 제품이 2단계에서 '가로/세로 DB 사이즈값을 먼저 채워주세요' 로 전부 멈췄다.
    // 이 함수는 테스트가 파일에서 잘라내 단독 실행하므로 바깥 헬퍼를 쓰지 않는다.
    ...Object.fromEntries(
      [['widthMm', 'width_mm'], ['depthMm', 'depth_mm']]
        .map(([from, to]) => [to, String((requiredValues || {})[from] ?? '').trim()])
        .filter(([, value]) => value),
    ),
  },
    product_name: productName,
    jname: productName,
    stock,
    quantity: stock,
  };
  await factoryRuntimeUpdateOwnedFactory(
    'factory/control:prepareProduct',
    'factory',
    draft => {
      draft.product = draft.product && typeof draft.product === 'object' ? draft.product : {};
      draft.product.finalDb = factoryRuntimeDetachedValue({
        ...(draft.product.finalDb || {}),
        ...authoritative,
      });
      // 사이즈 사실 수집은 sourceType==='final' 행을 걸러 낸다. finalDb 에만 써 두면
      // 체크포인트로 다시 열 때마다 가로·세로가 사라져 같은 자리에서 또 멈춘다.
      draft.product.confirmedDb = factoryRuntimeDetachedValue({
        ...(draft.product.confirmedDb || {}),
        ...authoritative,
      });
      draft.product.requirementsSnapshot = factoryRuntimeDetachedValue({
        ...(draft.product.requirementsSnapshot || {}),
        ...authoritative,
      });
      state.productInfoManualValues = factoryRuntimeDetachedValue({
        ...(state.productInfoManualValues || {}),
        ...authoritative,
      });
      if (optionMode) {
        draft.automation = draft.automation && typeof draft.automation === 'object' ? draft.automation : {};
        draft.automation.optionMode = optionMode;
        if (optionMode === 'none' && draft.activeStage === 'options') {
          draft.activeStage = '';
          draft.stages = draft.stages && typeof draft.stages === 'object' ? draft.stages : {};
          draft.stages.options = { ...(draft.stages.options || {}), status: 'idle', message: '' };
          draft.goalRun = draft.goalRun && typeof draft.goalRun === 'object' ? draft.goalRun : {};
          draft.goalRun.status = 'manual';
          draft.goalRun.failureReason = '';
        }
        if (optionMode === 'provided') factoryRuntimeControlApplyProvidedColorOptions(draft, payload);
      }
      return true;
    },
  );
}

function factoryRuntimeControlCompetitorSnapshot() {
  const factory = factoryRuntimeReadFactory();
  const compPage = factoryRuntimeControlCompPage(factory);
  const market = compPage.marketScrape && typeof compPage.marketScrape === 'object'
    ? compPage.marketScrape
    : {};
  const candidates = typeof compMarketAllCandidateResults === 'function'
    ? compMarketAllCandidateResults(market)
    : (Array.isArray(market.results) ? market.results : []);
  return {
    candidates,
    selectedIds: Array.isArray(market.selectedIds) ? market.selectedIds.map(String).filter(Boolean) : [],
    detailImages: Array.isArray(market.scrapedImages) ? market.scrapedImages : [],
    analysis: compPage.analysisResult || state.compPage?.analysisResult || null,
  };
}

async function factoryRuntimeControlEnsureAutoReferences(payload = {}) {
  if (payload.mode !== 'auto') return;
  let factory = factoryRuntimeReadFactory();
  const product = factory.product || {};
  // 사람이 「Cafe24 대상 떼기」를 눌렀으면 다시 붙이지 않는다. 그러지 않으면 떼자마자
  // 다음 실행에서 같은 상품을 또 골라, 버튼을 눌러도 아무것도 달라지지 않는다
  // — 실측 2026-08-29: 530번(투톤반달파우치)이 떼어도 계속 되붙었다.
  const autoMatchDeclined = product.cafe24AutoMatchDeclined === true;
  if (!autoMatchDeclined && !product.selectedDbCandidateKey && !product.selectedCafe24CandidateKey) {
    await factoryRunDbCandidatesForSelection({ preserveManualFields: true });
    await factoryRuntimeControlRestoreRequiredValues(payload);
    factory = factoryRuntimeReadFactory();
  }

  let competitor = factoryRuntimeControlCompetitorSnapshot();
  // 후보 검색은 본컴을 먼저 쓴다. VM 후보검색은 AHK 브리지(127.0.0.1:3011)를 거치는데
  // 그 브리지가 응답하지 않으면 autoconnect 가 제품마다 2분씩 기다렸다가 실패하고,
  // 그때서야 본컴으로 넘어갔다 — 실측 2026-08-29: 제품 하나당 순수 대기 2분.
  // 본컴이 실패할 때만 VM 을 예비로 쓴다. 순서만 바꾼 것이고 VM 을 버린 것이 아니다.
  //
  // 상세수집(analyze-vm)은 이 순서와 다르다. 그쪽은 공유폴더로 VM 과 주고받아
  // AHK 브리지를 타지 않고 정상 동작하므로, VM 을 먼저 쓴다. 두 경로를 같은 것으로
  // 보고 함께 뒤집으면 잘 되던 상세수집까지 본컴으로 끌어내리게 된다.
  const collectAttempts = [];
  if (!competitor.candidates.length) {
    for (const action of ['start-local', 'start-vm']) {
      try {
        await factoryRuntimeCompetitorMarketAction({ type: 'quick-action', action, skipConfirm: true });
      } catch (error) {
        collectAttempts.push(`${action === 'start-vm' ? 'VM' : '본컴'} 수집 실패: ${error?.message || error}`);
        continue;
      }
      competitor = factoryRuntimeControlCompetitorSnapshot();
      if (competitor.candidates.length) break;
      collectAttempts.push(`${action === 'start-vm' ? 'VM' : '본컴'} 수집 결과 0건`);
    }
  }
  if (!competitor.candidates.length) {
    const detail = collectAttempts.length ? ` (${collectAttempts.join(' / ')})` : '';
    throw factoryRuntimeBatchCommandError(`경쟁사 후보 수집 결과가 없어 상세수집을 진행할 수 없습니다.${detail}`);
  }
  if (!competitor.selectedIds.length) {
    const firstId = typeof compMarketResultId === 'function'
      ? compMarketResultId(competitor.candidates[0], 0)
      : String(competitor.candidates[0]?.id || competitor.candidates[0]?.product_id || '').trim();
    if (!firstId) throw factoryRuntimeBatchCommandError('경쟁사 후보 식별값을 확인할 수 없습니다.');
    await factoryRuntimeCompetitorMarketAction({ type: 'toggle-candidate', candidateId: firstId });
    competitor = factoryRuntimeControlCompetitorSnapshot();
  }
  // 후보 수집과 같은 이유로 상세수집도 VM 경로 하나에만 묶여 있었다. VM 워커가 죽어 있으면
  // 본컴 상세수집(화면의 「본컴 상세수집」 버튼과 같은 경로)이 멀쩡해도 쓰이지 않는다.
  const detailAttempts = [];
  if (!competitor.detailImages.length) {
    for (const action of ['analyze-vm', 'detail-local']) {
      try {
        await factoryRuntimeCompetitorMarketAction({ type: 'quick-action', action, skipConfirm: true });
      } catch (error) {
        detailAttempts.push(`${action === 'analyze-vm' ? 'VM' : '본컴'} 상세수집 실패: ${error?.message || error}`);
        continue;
      }
      competitor = factoryRuntimeControlCompetitorSnapshot();
      if (competitor.detailImages.length) break;
      detailAttempts.push(`${action === 'analyze-vm' ? 'VM' : '본컴'} 상세수집 이미지 0장`);
    }
  }
  if (!competitor.analysis && competitor.detailImages.length) {
    await factoryRuntimeCompetitorMarketAction({ type: 'analyze-images', mode: 'all' });
    competitor = factoryRuntimeControlCompetitorSnapshot();
  }
  if (!competitor.analysis || !competitor.detailImages.length) {
    const detail = detailAttempts.length ? ` (${detailAttempts.join(' / ')})` : '';
    throw factoryRuntimeBatchCommandError(`경쟁사 상세수집 또는 이미지 분석이 완료되지 않았습니다.${detail}`);
  }
  state.competitorData = factoryRuntimeDetachedValue(competitor.analysis);
  void saveLastWorkNow({ sync: false });
}

function factoryRuntimeControlNeedsDetailRebuild(factory = factoryRuntimeReadFactory()) {
  const detailAssets = typeof factoryUsableAssetsForStage === 'function'
    ? factoryUsableAssetsForStage('detail', factory)
    : (factory.assets || []).filter(asset => asset?.stageId === 'detail' && !asset?.rejected);
  return !detailAssets.some(asset => (
    asset?.metadata?.productionControl === true
    && Number(asset?.metadata?.sectionCount || 0) === 14
    && asset?.metadata?.competitorAnalysisReady === true
    && asset?.metadata?.selectedCutSection === 'material_tech'
  ));
}

async function factoryRuntimeControlRunProduct(payload = {}) {
  if (payload?.schema !== 'factory-product-run-command:v1') {
    throw factoryRuntimeBatchCommandError('factory_product_command_version_unsupported');
  }
  if (payload.restoreOnly === true) {
    return factoryRuntimeControlRestoreProductCheckpoint(payload);
  }
  // 저장해 둔 지점이 있는데 지금 다른 제품을 들고 있으면 이 작업부터 연다. 열지 않고
  // 진행하면 화면에 남아 있던 다른 제품의 내용이 이 작업의 문서로 저장된다.
  if (payload.checkpoint && typeof payload.checkpoint === 'object') {
    const opened = await factoryRuntimeControlProjection();
    const targetJobId = String(payload.jobId || '').trim();
    if (String(opened?.registration?.jobId || '').trim() !== targetJobId) {
      await factoryRuntimeControlRestoreProductCheckpoint(payload);
    }
  }
  await factoryRuntimeControlPrepareProduct(payload);
  const before = await factoryRuntimeControlProjection();
  const missingRequired = (before.inputs || []).flatMap(input => (
    Array.isArray(input?.missing) ? input.missing : []
  ));
  if (payload.adoptHydratedWorkfile === true && missingRequired.length) {
    const stageKey = 'required_fields';
    const message = `필수값 수동 확인 필요 · ${[...new Set(missingRequired)].join(', ')}`;
    const saved = await factoryRuntimeControlSaveProductCheckpoint(payload, 'waiting_manual', stageKey);
    return Object.freeze({
      schema: 'factory-product-run-receipt:v1',
      jobId: String(payload.jobId || '').trim(),
      status: 'waiting_manual',
      stageKey,
      message,
      projection: saved.projection,
      checkpoint: saved.checkpoint,
    });
  }
  await factoryRuntimeControlEnsureAutoReferences(payload);
  const expectedStageKey = String(payload.expectedStageKey || '').trim();
  if (expectedStageKey) {
    const expected = (before.stages || []).find(stage => stage.key === expectedStageKey);
    // 후보가 비어 복원 직후처럼 고를 것이 없을 때만 관제탑이 다시 만들라고 표시해 준다.
    // 표식 없이 '후보가 비어 보이면 통과' 로 두면, 방금 고른 컷이 아직 반영되는 중인
    // 찰나에 실행이 들어와 그 단계를 통째로 다시 만들며 선택을 지운다.
    const regenerateStage = payload.regenerateStage === true;
    if (!expected || (!regenerateStage && !(expected.selectedIds || []).length)) {
      throw factoryRuntimeBatchCommandError('factory_decision_required');
    }
  }
  // 상세페이지 자산이 없으면 수동 진행에서도 반드시 만들어야 한다. 모드로만 막으면 A컷을 모두
  // 고른 뒤에도 detail-asset 이 빈 채로 '완료' 로 보고되어 Cafe24 등록이 영구히 막힌다.
  let success;
  try {
    success = await factoryRunGoalLoop({
      forceDetail: factoryRuntimeControlNeedsDetailRebuild(),
    });
  } catch (error) {
    // 여기서 그냥 던지면 방금 만든 후보와 상세페이지가 체크포인트에 남지 않아 통째로 사라지고,
    // 다시 살릴 때 아무것도 없는 이른 시점으로 되돌아간다. 만든 것부터 남기고 원인을 올린다.
    try {
      await factoryRuntimeControlSaveProductCheckpoint(payload, 'blocked', expectedStageKey);
    } catch (checkpointError) {
      void checkpointError;
    }
    throw error;
  }
  const resultProjection = await factoryRuntimeControlProjection();
  const waitingStage = factoryRuntimeControlWaitingStage(resultProjection, payload);
  const goalRun = factoryRuntimeReadFactory().goalRun || {};
  const status = waitingStage
    ? 'waiting_manual'
    : success
      ? 'completed'
      : 'blocked';
  const message = waitingStage
    ? `${waitingStage.label || waitingStage.key} 결과를 선택하면 다음 단계가 자동으로 시작됩니다.`
    : success
      ? '조립공장 생성 완료 · Cafe24 사전점검 및 일회 승인 대기'
      : String(goalRun.failureReason || goalRun.nextAction || '조립공장 실행 확인 필요').trim();
  const saved = await factoryRuntimeControlSaveProductCheckpoint(
    payload,
    status,
    waitingStage?.key || '',
  );
  return Object.freeze({
    schema: 'factory-product-run-receipt:v1',
    jobId: String(payload.jobId || '').trim(),
    status,
    stageKey: waitingStage?.key || '',
    message,
    projection: saved.projection,
    checkpoint: saved.checkpoint,
  });
}

const FACTORY_CAFE24_FIELD_MAP = Object.freeze({
  salePrice: { fieldId: 'sale_price', label: '판매가' },
  supplyPrice: { fieldId: 'purchase_price', label: '공급가 / 원가' },
  displayStatus: { fieldId: 'display_status', label: '진열상태' },
  sellingStatus: { fieldId: 'selling_status', label: '판매상태' },
});

function factoryRuntimeControlCafe24Values(payload = {}) {
  const source = payload?.cafe24 && typeof payload.cafe24 === 'object' ? payload.cafe24 : {};
  const values = [];
  for (const [key, field] of Object.entries(FACTORY_CAFE24_FIELD_MAP)) {
    const raw = String(source[key] ?? '').trim();
    if (raw) values.push({ ...field, value: raw });
  }
  return values;
}

async function factoryRuntimeControlApplyCafe24Category(payload = {}) {
  // 분류는 글자 한 줄이 아니라 등록 행이다. 글자로 넣으면 등록 직전 점검이 분류를
  // 읽지 못해 category_id 로 막힌다.
  const source = payload?.cafe24 && typeof payload.cafe24 === 'object' ? payload.cafe24 : {};
  const categoryId = String(source.categoryId ?? '').trim();
  if (!categoryId) return '';
  await factoryRuntimeBridgeAction(
    'factory/fields:commitField',
    undefined,
    draft => {
      const product = draft.product && typeof draft.product === 'object' ? draft.product : (draft.product = {});
      product.finalDb = product.finalDb && typeof product.finalDb === 'object' ? product.finalDb : {};
      product.finalDb.category = [{
        category_no: categoryId,
        display_group: '1',
        recommend: 'F',
        new: 'F',
      }];
      return 'category';
    },
    { render: false, forceSave: true },
  );
  return categoryId;
}

async function factoryRuntimeControlApplyCafe24RegistrationMode(payload = {}) {
  // 스토어에 이미 같은 제품이 있으면 조립공장은 기본적으로 그 상품을 고치려 한다.
  // 새 상품으로 올리라고 지시받았으면 그 뜻을 따라야, 살아 있는 상품을 덮어쓰지 않는다.
  const source = payload?.cafe24 && typeof payload.cafe24 === 'object' ? payload.cafe24 : {};
  const mode = String(source.registrationMode ?? '').trim();
  if (!['create', 'update'].includes(mode)) return '';
  // openMarketSync 는 cafe24 조정자의 범위다. 필드 확정 명령으로 쓰면 경로가 거절된다.
  await factoryRuntimeBridgeAction(
    'factory/final-registration:apply-basic-info',
    undefined,
    draft => {
      const sync = factoryEnsureOpenMarketSync(draft);
      sync.cafe24RegistrationMode = mode;
      sync.cafe24RegistrationModeUserTouched = true;
      return 'cafe24RegistrationMode';
    },
    { render: false, forceSave: true },
  );
  // 고치겠다고 한 상품이 있으면 그 상품으로 못박는다. 비워 두면 조립공장이 후보 중에서
  // 고르는데, 그것이 사람이 생각한 상품과 같다는 보장이 없다. finalDb.product_no 는
  // factoryCafe24TargetCandidate 가 후보보다 먼저 보는 자리다.
  const targetProductNo = String(source.targetProductNo ?? '').trim();
  if (mode === 'update' && /^\d+$/.test(targetProductNo)) {
    await factoryRuntimeBridgeAction(
      'factory/final-registration:apply-basic-info',
      undefined,
      draft => {
        if (!draft.product.finalDb || typeof draft.product.finalDb !== 'object') draft.product.finalDb = {};
        draft.product.finalDb.product_no = targetProductNo;
        return 'product_no';
      },
      { render: false, forceSave: true },
    );
  }
  return mode;
}

async function factoryRuntimeControlRegisterCafe24(payload = {}) {
  const jobId = String(payload.jobId || '').trim();
  if (!jobId) throw factoryRuntimeBatchCommandError('factory_product_payload_invalid');
  // 지금 다른 제품을 물고 있으면 저장해 둔 지점으로 이 작업부터 연다. 열지 않고 등록하면
  // 화면에 남아 있던 다른 제품의 값이 스토어로 나간다.
  const current = await factoryRuntimeControlProjection();
  const onTarget = String(current?.registration?.jobId || '').trim() === jobId;
  if (!onTarget && payload.checkpoint && typeof payload.checkpoint === 'object') {
    await factoryRuntimeControlRestoreProductCheckpoint({ ...payload, jobId });
  }
  factoryRuntimeControlAdoptProductProject(jobId);
  if (typeof factoryCommitAutomationWizardFieldValue !== 'function'
    || typeof factoryRuntimeBridgeAction !== 'function') {
    throw factoryRuntimeBatchCommandError('factory_cafe24_capability_unavailable');
  }
  // 관제탑이 지정한 등록 대상 값을 먼저 확정한다. 이것을 넣지 않으면 등록 화면이 없는
  // 배치에서 분류·판매가가 비어 등록이 막힌다.
  await factoryRuntimeControlApplyCafe24Category(payload);
  await factoryRuntimeControlApplyCafe24RegistrationMode(payload);
  for (const field of factoryRuntimeControlCafe24Values(payload)) {
    // 진열·판매 상태는 openMarketSync 에 적힌다. 필드 확정 명령은 그 범위를 쓸 수 없어
    // FACTORY_COMMAND_PATH_REJECTED 로 등록이 통째로 멈춘다. 실측: 방울수저집 등록이
    // openMarketSync.cafe24Display 에서 거절됐다. 최종등록 명령은 두 범위를 다 가진다.
    await factoryRuntimeBridgeAction(
      'factory/final-registration:apply-basic-info',
      undefined,
      draft => {
        factoryCommitAutomationWizardFieldValue(field.fieldId, field.value, field.label, false, draft);
        return field.fieldId;
      },
      { render: false, forceSave: true },
    );
  }
  if (typeof factoryRunFinalRegistration !== 'function') {
    throw factoryRuntimeBatchCommandError('factory_cafe24_capability_unavailable');
  }
  // 워커에는 확인창을 눌러 줄 사람이 없다. 사람의 승인은 관제탑에서 등록을 지시하는
  // 그 순간에 이미 끝났다. 이걸 빼면 확인창이 뜬 채로 멈춰 등록이 영영 끝나지 않는다.
  // 실측: 방울수저집 등록이 확인창 앞에서 멈추고 거절로 되돌아왔다.
  const registered = await factoryRunFinalRegistration({
    headless: true,
    render: false,
    skipConfirm: true,
    batch: true,
  });
  const projection = await factoryRuntimeControlProjection();
  const factory = factoryRuntimeReadFactory();
  const productNo = String(
    factory?.product?.finalRegistration?.productNo
    || factory?.product?.finalDb?.product_no
    || '',
  ).trim();
  if (registered !== true) {
    // 실패 사유는 등록이 남긴 영수증이 정답이다. 사전점검 목록을 먼저 읽으면 이미 지나간
    // 항목을 사유로 적어, 사람이 엉뚱한 곳을 고치게 된다.
    const receipt = factory?.product?.cafe24RegistrationReceipt || {};
    // 등록이 중단되는 대부분의 길목은 finalRegistrationStatus 에 이유를 적고 돌아선다.
    // 그것을 읽지 않으면 "왜 거절인지" 를 아무도 알 수 없다.
    const runStatus = String(factory?.openMarketSync?.finalRegistrationStatus || '').trim();
    const reason = String(
      receipt.error
      || factory?.product?.finalRegistration?.message
      || runStatus
      || factoryRuntimeControlCafe24BlockReason(projection)
      || 'factory_cafe24_registration_declined',
    ).trim();
    // 상품번호가 남았다면 스토어에는 이미 만들어졌다는 뜻이다. 이걸 숨기면 다시 눌러
    // 같은 상품을 하나 더 만든다.
    // 이번 실행이 실제로 만든 번호일 때만 알린다. 스토어에 원래 있던 상품 번호까지
    // "이미 생성됨" 으로 적으면, 만들지도 않은 것을 만들었다고 보고하게 된다.
    const createdNo = String(factory?.product?.finalRegistration?.productNo || receipt.productNo || '').trim();
    throw factoryRuntimeBatchCommandError(
      `factory_cafe24_registration_declined: ${reason}${createdNo ? ` · 스토어에 상품 ${createdNo} 이(가) 이미 생성됨` : ''}`,
    );
  }
  const saved = await factoryRuntimeControlSaveProductCheckpoint(payload, 'completed', 'cafe24');
  return Object.freeze({
    schema: 'factory-cafe24-registration-receipt:v1',
    jobId,
    productNo,
    registeredAt: new Date().toISOString(),
    projection: saved.projection,
    checkpoint: saved.checkpoint,
  });
}

function factoryRuntimeControlCafe24BlockReason(projection = {}) {
  const registration = projection?.registration && typeof projection.registration === 'object'
    ? projection.registration
    : {};
  const blockers = Array.isArray(registration.blockers) ? registration.blockers : [];
  return blockers.length ? `등록 차단: ${blockers.join(', ')}` : '';
}

/**
 * 관제탑에서 프롬프트를 적어 새 컷을 만들라고 지시한 것을 수행한다.
 *
 * 있는 후보 중에서만 고르게 하면 마음에 드는 것이 없을 때 길이 막힌다.
 * 조립공장에는 이미 사람이 적은 프롬프트로 컷을 만드는 길이 있다 —
 * factory.stages.<단계>.prompt 에 줄 단위로 적으면 그 줄마다 한 컷을 만든다
 * (app-core-06.js 의 presets 분기). 그 길을 관제탑에서도 쓸 수 있게 연결한다.
 */
async function factoryRuntimeControlComposeCut(payload = {}) {
  const jobId = String(payload.jobId || '').trim();
  const stageKey = String(payload.stageKey || '').trim();
  const prompt = String(payload.prompt || '').trim();
  if (!jobId || !stageKey || !prompt) throw factoryRuntimeBatchCommandError('factory_product_payload_invalid');
  const STAGE_TO_RUNNER = Object.freeze({
    representative: 'hero',
    size: 'size',
    general: 'cuts',
  });
  // 섹션은 단계 전체가 아니라 그 섹션 하나만 다시 만든다.
  const sectionMatch = stageKey.match(/^sections:(.+)$/);
  const runnerStageId = STAGE_TO_RUNNER[stageKey] || '';
  if (!runnerStageId && !sectionMatch) throw factoryRuntimeBatchCommandError('factory_control_command_unsupported');

  const current = await factoryRuntimeControlProjection();
  const onTarget = String(current?.registration?.jobId || '').trim() === jobId;
  if (!onTarget && payload.checkpoint && typeof payload.checkpoint === 'object') {
    await factoryRuntimeControlRestoreProductCheckpoint({ ...payload, jobId });
  }
  const adoptedProjectId = factoryRuntimeControlAdoptProductProject(jobId);
  // 보관함에 새 그림을 쓰려면 이 작업의 편집권이 있어야 한다. 없으면
  // "archive mutation requires the current edit authority" 로 생성이 실패한다
  // (실측 2026-08-27: hero 80% 에서 컷 4 생성 실패).
  if (typeof ensureWorkspaceEditAuthority === 'function' && adoptedProjectId) {
    const authority = await ensureWorkspaceEditAuthority(`project:${adoptedProjectId}`);
    if (!['editing', 'offline-edit'].includes(authority?.mode)) {
      throw factoryRuntimeBatchCommandError('factory_workspace_edit_authority_missing');
    }
  }

  if (sectionMatch) {
    const sectionId = sectionMatch[1];
    if (typeof regenerateSection !== 'function') {
      throw factoryRuntimeBatchCommandError('factory_control_command_unsupported');
    }
    // 섹션은 조립공장이 자기 기준으로 다시 만든다. 적어 준 프롬프트는 그 섹션의
    // 생성 기준으로 남겨 둔다 — 범위를 가진 명령으로 쓴다.
    await factoryRuntimeBridgeAction(
      'factory/runtime:updateFromInputs',
      undefined,
      draft => {
        factorySetStagePromptForCurrentWork(draft, 'sections', prompt);
        return 'sectionPrompt';
      },
      { render: false, forceSave: true },
    );
    await regenerateSection(sectionId);
    return Object.freeze({ schema: 'factory-compose-cut:v1', jobId, stageKey, started: true });
  }

  // 단계 프롬프트는 stages.<단계>.prompt 에 적힌다. 그 범위를 가진 명령으로 써야 한다.
  // factory/fields:commitField 는 product-db 조정자라 stages 를 못 써서
  // FACTORY_COMMAND_PATH_REJECTED 로 막힌다(실측 2026-08-26).
  await factoryRuntimeBridgeAction(
    'factory/runtime:updateFromInputs',
    undefined,
    draft => {
      factorySetStagePromptForCurrentWork(draft, runnerStageId, prompt);
      return 'stagePrompt';
    },
    { render: false, forceSave: true },
  );
  // 생성 실행은 조립공장이 이미 쓰는 정식 명령으로 돈다. 새 이름을 만들면
  // "undeclared factory store command" 로 막힌다(실측 2026-08-26).
  if (typeof factoryRuntimeWithOperationLease !== 'function'
    || typeof factoryHandleRunStageButton !== 'function') {
    throw factoryRuntimeBatchCommandError('factory_control_command_unsupported');
  }
  await factoryRuntimeWithOperationLease('factory/assets:runFactoryStage', undefined, operation => (
    factoryHandleRunStageButton({
      dataset: { factoryRunStage: runnerStageId },
      disabled: false,
    }, {
      operationToken: operation.operationToken,
      operationSignal: operation.operationSignal,
    })
  ));
  return Object.freeze({ schema: 'factory-compose-cut:v1', jobId, stageKey, started: true });
}

/**
 * 막힌 작업을 화면에서 되살린다.
 *
 * 화면에 이 길이 없어서, 신규 제품이 엉뚱한 기존 Cafe24 상품에 붙어 상세페이지가 그 상품
 * 이름으로 만들어져도 사람이 빠져나올 방법이 없었다 — 실측 2026-08-29.
 * - clear-cafe24-target: 잘못 붙은 대상을 뗀다. 섹션·이미지는 건드리지 않는다.
 * - regenerate-sections: 섹션을 다시 만든다. 실패하면 원래 있던 섹션은 그대로 둔다.
 */
async function factoryRuntimeControlRecoverProduct(payload = {}) {
  const jobId = String(payload.jobId || '').trim();
  const action = String(payload.action || '').trim();
  if (!jobId || !action) throw factoryRuntimeBatchCommandError('factory_product_payload_invalid');

  const current = await factoryRuntimeControlProjection();
  const onTarget = String(current?.registration?.jobId || '').trim() === jobId;
  if (!onTarget && payload.checkpoint && typeof payload.checkpoint === 'object') {
    await factoryRuntimeControlRestoreProductCheckpoint({ ...payload, jobId });
  }
  const adoptedProjectId = factoryRuntimeControlAdoptProductProject(jobId);
  // 편집권은 보관함에 새로 쓰는 일에만 필요하다. 대상 떼기는 고른 후보를 지우는 것뿐이라
  // 여기서 편집권을 요구하면 정작 막힌 작업을 풀 수 없다 — 실측 2026-08-29:
  // factory_product_workspace_authority_unavailable 로 떼기 자체가 거절됐다.
  if (action !== 'clear-cafe24-target'
    && typeof ensureWorkspaceEditAuthority === 'function' && adoptedProjectId) {
    const authority = await ensureWorkspaceEditAuthority(`project:${adoptedProjectId}`);
    if (!['editing', 'offline-edit'].includes(authority?.mode)) {
      throw factoryRuntimeBatchCommandError('factory_workspace_edit_authority_missing');
    }
  }

  if (action === 'clear-cafe24-target') {
    if (typeof factoryClearCafe24CandidateSelection !== 'function') {
      throw factoryRuntimeBatchCommandError('factory_control_command_unsupported');
    }
    // 이 제품 전용 헬퍼를 쓴다. 대상 관련 값만 지우고 분석값·섹션은 건드리지 않는다 —
    // 직접 product 를 헤집으면 작업 기준이 흔들려 분석값까지 사라진다(실측).
    await factoryClearCafe24CandidateSelection();
    // 뗐다는 사실을 남긴다. 없으면 다음 실행의 자동 매칭이 같은 상품을 또 붙인다.
    await factoryRuntimeBridgeAction(
      'factory/db:clearCafe24CandidateSelection',
      null,
      draft => {
        draft.product = draft.product && typeof draft.product === 'object' ? draft.product : {};
        draft.product.cafe24AutoMatchDeclined = true;
        return true;
      },
    );
    const after = await factoryRuntimeControlProjection();
    return Object.freeze({
      schema: 'factory-product-recovery:v1',
      jobId,
      action,
      message: 'Cafe24 대상을 뗐습니다. 이 제품 기준으로 섹션을 다시 만들어 주세요.',
      projection: after,
    });
  }

  if (action === 'regenerate-sections') {
    if (typeof generateAllSections !== 'function') {
      throw factoryRuntimeBatchCommandError('factory_control_command_unsupported');
    }
    const ok = await generateAllSections();
    const after = await factoryRuntimeControlProjection();
    return Object.freeze({
      schema: 'factory-product-recovery:v1',
      jobId,
      action,
      message: ok
        ? '섹션을 이 제품 기준으로 다시 만들었습니다.'
        : '일부 섹션을 다시 만들지 못했습니다. 원래 있던 섹션은 그대로 두었습니다.',
      projection: after,
    });
  }

  if (action === 'unlock-sections') {
    // 잠근 섹션은 「섹션 다시 만들기」가 일부러 보존하고 개별 재생성도 거부한다. 그래서
    // 잠긴 채로 남의 상품명에 오염되면 몇 번을 다시 만들어도 그대로다 — 실측 2026-08-29:
    // specifications 하나 때문에 재생성 네 번이 헛돌았다. 푸는 길이 앱 화면에만 있어
    // 관제탑에서 일하는 사람은 빠져나올 수 없었다.
    const locks = state.sectionLocks && typeof state.sectionLocks === 'object' ? state.sectionLocks : {};
    const unlocked = Object.keys(locks).filter(key => locks[key]);
    if (!unlocked.length) {
      const after = await factoryRuntimeControlProjection();
      return Object.freeze({
        schema: 'factory-product-recovery:v1',
        jobId,
        action,
        message: '잠긴 섹션이 없습니다.',
        projection: after,
      });
    }
    await factoryRuntimeBridgeAction(
      'factory/sections:unlock',
      null,
      () => {
        state.sectionLocks = {};
        return true;
      },
      { render: false, forceSave: true },
    );
    if (typeof savePersistentState === 'function') await savePersistentState({ force: true });
    const after = await factoryRuntimeControlProjection();
    return Object.freeze({
      schema: 'factory-product-recovery:v1',
      jobId,
      action,
      message: `잠긴 섹션 ${unlocked.length}개를 풀었습니다: ${unlocked.slice(0, 6).join(', ')}. 이제 섹션 다시 만들기가 이 섹션들도 새로 만듭니다.`,
      projection: after,
    });
  }

  throw factoryRuntimeBatchCommandError('factory_control_command_unsupported');
}

async function factoryRuntimeControlCommand(value = {}) {
  if (value?.capabilityVersion !== 'factory-control-command:v1') {
    throw factoryRuntimeBatchCommandError('factory_control_command_version_unsupported');
  }
  if (value.command === 'getFactoryProjection') return factoryRuntimeControlProjection();
  if (value.command === 'selectFactoryACut') return factoryRuntimeControlSelectACut(value.payload || {});
  if (value.command === 'runFactoryProduct') return factoryRuntimeControlRunProduct(value.payload || {});
  if (value.command === 'registerFactoryCafe24') return factoryRuntimeControlRegisterCafe24(value.payload || {});
  if (value.command === 'composeFactoryCut') return factoryRuntimeControlComposeCut(value.payload || {});
  if (value.command === 'recoverFactoryProduct') return factoryRuntimeControlRecoverProduct(value.payload || {});
  throw factoryRuntimeBatchCommandError('factory_control_command_unsupported');
}

const CLASSIC_RUNTIME_REQUEST_EVENT = 'kuasangse:classic-runtime-request';
const CLASSIC_RUNTIME_RESPONSE_EVENT = 'kuasangse:classic-runtime-response';

function publishClassicRuntimeResponse(requestId, ok, value = null, error = null) {
  window.dispatchEvent(new CustomEvent(CLASSIC_RUNTIME_RESPONSE_EVENT, {
    detail: Object.freeze({ requestId, ok, value, error }),
  }));
}

async function handleClassicRuntimeRequest(event) {
  const request = event?.detail;
  if (!request || typeof request.requestId !== 'string' || typeof request.command !== 'string') return;
  try {
    if (request.command === 'menu-install') {
      await installRuntimeMenuModules(request.payload);
      publishClassicRuntimeResponse(
        request.requestId,
        true,
        Object.freeze({ command: request.command }),
      );
      return;
    }
    if (request.command === 'hydrate') {
      if (typeof hydrateClassicRuntime !== 'function') {
        throw new Error('classic runtime hydrate endpoint is unavailable');
      }
      const result = await hydrateClassicRuntime(request.payload);
      classicRuntimeHydrationReady = true;
      publishClassicRuntimeResponse(request.requestId, true, result);
      return;
    }
    if (request.command === 'workspace-reload') {
      if (typeof reloadAcceptedWorkspace !== 'function') {
        throw new Error('classic workspace reload endpoint is unavailable');
      }
      const result = await reloadAcceptedWorkspace(request.payload);
      publishClassicRuntimeResponse(request.requestId, true, result);
      return;
    }
    if (request.command === 'factory-cafe24-command') {
      if (!factoryRuntimePublishTab || typeof factoryRuntimePublishTab.invoke !== 'function') {
        throw new Error('registered factory/publish capability is unavailable');
      }
      const result = await factoryRuntimePublishTab.invoke('runGuideAction', request.payload);
      publishClassicRuntimeResponse(request.requestId, true, result);
      return;
    }
    if (request.command === 'factory-control-command') {
      const result = await factoryRuntimeControlCommand(request.payload);
      publishClassicRuntimeResponse(request.requestId, true, result);
      return;
    }
    if (request.command === 'render') {
      const result = await renderClassicRuntimeAfterHydration(request.payload);
      publishClassicRuntimeResponse(
        request.requestId,
        true,
        result,
      );
      return;
    }
    throw new Error(`unsupported classic runtime command: ${request.command}`);
  } catch (error) {
    console.error(`Classic runtime command failed: ${request.command}`, error);
    publishClassicRuntimeResponse(
      request.requestId,
      false,
      null,
      String(error?.message || error || 'classic runtime request failed'),
    );
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener(CLASSIC_RUNTIME_REQUEST_EVENT, handleClassicRuntimeRequest);
}

async function renderClassicRuntimeAfterHydration(options = {}) {
  if (!classicRuntimeHydrationReady) throw new Error('classic runtime hydration is not ready');
  if (options?.mode === 'batch-worker') {
    classicRuntimeBatchWorkerMode = true;
    classicRuntimeHydrationActive = false;
    classicRuntimeInitialRenderComplete = true;
    return Object.freeze({ command: 'render', rendered: false, skipped: true, mode: 'batch-worker' });
  }
  if (classicRuntimeInitialRenderComplete) {
    return Object.freeze({ command: 'render', rendered: false });
  }
  classicRuntimeHydrationActive = false;
  classicRuntimeInitialRenderComplete = true;
  await render();
  return Object.freeze({ command: 'render', rendered: true });
}

const render = function render() {
  // 누른 것을 기준으로 화면 위치를 지키는 장치를 여기서 건다.
  // 예전에는 renderPreservingMainScroll 안에서만 걸었는데, 후보 픽처럼
  // 그 함수를 거치지 않고 곧장 render()·탭 패치로 가는 경로에서는 아예 설치되지 않았다.
  if (typeof installRenderScrollAnchorCapture === 'function') installRenderScrollAnchorCapture();
  if (classicRuntimeHydrationActive || classicRuntimeBatchWorkerMode) return;
  if (shouldDeferFactoryWizardFullRender()) return;
  if (state.step !== 'factory' && typeof factoryRemoveCompetitorPreviewPortal === 'function') {
    factoryRemoveCompetitorPreviewPortal();
  }
  const menu = runtimeMenuModules.get(state.step) || null;
  if (shellRuntimeComposition
    && shellRuntimeComposition.routeController.currentRoute() !== state.step) {
    return shellRuntimeComposition.routeController.navigate(
      state.step,
      runtimeShellNavigationSnapshot({ bypassGate: true }),
    ).catch(error => {
      state.error = String(error?.message || error);
      return renderShellFrame({
        menu,
        activeMenuHtml: renderActiveRuntimeMenu(menu),
      });
    });
  }
  return renderShellFrame({
    menu,
    activeMenuHtml: renderActiveRuntimeMenu(menu),
  });
  // 늦게 도착한 다시 그리기로 누른 카드가 밀렸으면 여기서 한 번 되민다.
  if (typeof applyPendingRenderScrollAnchorAfterRender === 'function') applyPendingRenderScrollAnchorAfterRender();
};

function getCurrentStepLabel() {
  const labels = {
    upload: '이미지 업로드',
    analyzing: 'AI 분석',
    sections: '섹션 설정',
    generating: '자동 생성',
    preview: '미리보기',
    imagecuts: '이미지컷 생성',
    optionsorter: '옵션 분류기',
    factory: '조립공장',
    automation: '자동화',
    modelsettings: '모델 설정',
    competitor: '경쟁사 분석',
    reports: '작업 리포트',
    manual: '상세페이지 자동화 설명서',
  };
  return labels[state.step] || '작업 화면';
}

function setUiNotice(message, type = 'warn') {
  state.uiNotice = message ? { message, type } : null;
}

function renderUiNotice() {
  if (!state.uiNotice?.message) return '';
  const icon = state.uiNotice.type === 'warn' ? 'info' : 'check_circle';
  return `<div class="app-notice ${state.uiNotice.type === 'warn' ? 'warn' : ''}">
    <span class="material-icons-outlined">${icon}</span>
    <span style="flex:1">${escapeHtml(state.uiNotice.message)}</span>
    <button class="btn-sm" id="closeUiNotice" title="안내 닫기" style="padding:2px 8px;min-height:26px">닫기</button>
  </div>`;
}

function renderMobileStepBanner() {
  return `<div class="mobile-step-banner">
    <span class="material-icons-outlined" style="font-size:16px;color:var(--primary-h)">near_me</span>
    <span class="mobile-step-copy">현재 화면: <b>${escapeHtml(getCurrentStepLabel())}</b></span>
  </div>`;
}

function disabledAttr(isDisabled, reason) {
  return isDisabled ? `disabled title="${escAttr(reason || '현재 조건에서는 사용할 수 없습니다')}" aria-disabled="true"` : '';
}

function getNavGateInfo(step) {
  if (step === 'analyzing') {
    return { redirect: 'analyzing', blocked: false, note: isProductAnalysisRunning() ? '현재 제품 이미지 분석이 진행 중입니다.' : 'AI 분석 종합 화면으로 이동합니다.' };
  }
  if (step === 'generating') {
    if (Object.keys(state.sectionContents || {}).length > 0) {
      return { redirect: 'preview', blocked: false, note: '이미 생성된 섹션이 있어 미리보기로 이동했습니다. 다시 만들려면 섹션 설정에서 생성 버튼을 눌러주세요.' };
    }
    if (!state.analysis) return { redirect: 'upload', blocked: true, reason: '자동 생성은 제품 이미지 분석 후 사용할 수 있습니다.' };
    return { redirect: 'sections', blocked: true, reason: '자동 생성을 시작하려면 섹션 설정에서 원하는 섹션을 확인한 뒤 생성 버튼을 눌러주세요.' };
  }
  return { redirect: step, blocked: false, reason: '', note: '' };
}

function getAiRepairDefaultModel() {
  const current = getImageModel();
  if (isAiRepairModel(current)) return current;
  return IMAGE_MODELS.find(m => m.id === 'gpt-image-1')?.id
    || IMAGE_MODELS.find(m => m.id === 'gpt-image-1.5')?.id
    || IMAGE_MODELS.find(m => isAiRepairModel(m.id))?.id
    || 'gpt-image-1';
}

function isAiRepairModel(modelId) {
  return String(modelId || '').startsWith('gpt-image');
}

function renderAiRepairModal() {
  const repair = state.aiRepair || {};
  const section = SECTIONS.find(s => s.id === repair.sectionId);
  const img = repair.sectionId ? state.sectionImages[repair.sectionId] : null;
  const models = IMAGE_MODELS.filter(m => isAiRepairModel(m.id));
  const selectedModel = repair.model || getAiRepairDefaultModel();
  const hasOpenAIKey = !!getRuntimeOpenAIKey();
  const mode = repair.mode || 'spot';
  if (!section || !img) return '';

  return `<div class="modal-overlay repair-overlay" id="aiRepairOverlay">
    <div class="modal repair-modal" onclick="event.stopPropagation()">
      <div class="repair-head">
        <span class="material-icons-outlined" style="font-size:26px;color:var(--ok)">auto_fix_high</span>
        <div style="flex:1">
          <div class="repair-title">2. AI 스팟 / 부분 수정</div>
          <div class="repair-sub">${section.n}. ${escapeHtml(section.name)} 이미지에서 고치고 싶은 영역만 칠한 뒤, 복구하거나 원하는 장식/소품으로 바꿉니다.</div>
        </div>
        <button class="btn-sm" id="closeAiRepair" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 창을 닫을 수 없습니다.')}>닫기</button>
      </div>
      <div class="repair-body">
        <div class="repair-canvas-panel">
          <div class="repair-stage" id="repairStage">
            <img id="repairSourceImage" src="${escapeHtml(img)}" alt="repair source">
            <canvas id="repairMaskCanvas"></canvas>
            ${repair.busy ? `<div class="repair-loading"><span class="spinner" style="width:18px;height:18px;margin-right:8px"></span>선택 영역만 자연스럽게 수정 중...</div>` : ''}
          </div>
        </div>
        <aside class="repair-side">
          <div class="repair-tip">
            <strong style="color:var(--text)">사용법</strong><br>
            사진 위에서 바꾸고 싶은 부분만 칠하세요. 예: 나비 장식만 칠하고 “꽃 장식으로 바꿔줘”라고 입력하면, 나머지 영역은 최대한 그대로 보존합니다.
          </div>

          <div class="input-group" style="margin-bottom:0">
            <label class="label">수정 방식</label>
            <select class="select" id="repairMode" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 수정 방식을 바꿀 수 없습니다.')}>
              <option value="spot" ${mode === 'spot' ? 'selected' : ''}>스팟 복구: 지우고 자연스럽게 메우기</option>
              <option value="replace" ${mode === 'replace' ? 'selected' : ''}>부분 교체: 코멘트대로 바꾸기</option>
            </select>
          </div>

          <div class="input-group" style="margin-bottom:0">
            <label class="label">수정 코멘트</label>
            <textarea class="textarea" id="repairPrompt" rows="4" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 코멘트를 바꿀 수 없습니다.')} placeholder="예: 나비 장식을 작은 흰색 꽃 장식으로 자연스럽게 바꿔줘">${escapeHtml(repair.prompt || '')}</textarea>
          </div>

          <div class="input-group" style="margin-bottom:0">
            <label class="label">AI 편집 모델</label>
            <select class="select" id="repairModel" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 모델을 바꿀 수 없습니다.')}>
              ${models.map(m => `<option value="${escapeHtml(m.id)}" ${selectedModel === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
            </select>
            <div style="font-size:11px;color:var(--text-m);margin-top:6px">정밀 마스크 편집은 OpenAI 이미지 편집 API로 처리합니다. 기존 Vertex 전체 이미지 생성 설정은 그대로 둡니다.</div>
          </div>

          <div class="range-row">
            <label><span>브러시 크기</span><b>${repair.brushSize || 48}px</b></label>
            <input type="range" id="repairBrushSize" min="8" max="180" value="${repair.brushSize || 48}" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 브러시 크기를 바꿀 수 없습니다.')}>
          </div>

          <div class="repair-actions">
            <button class="btn-sm" id="repairUndoMask" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 마스크를 되돌릴 수 없습니다.')}>마스크 되돌리기</button>
            <button class="btn-sm" id="repairClearMask" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 마스크를 지울 수 없습니다.')}>마스크 지우기</button>
            ${canUndoAiRepair(repair.sectionId) ? `<button class="btn-sm" id="repairUndoLastEdit" style="color:var(--warn)" ${disabledAttr(repair.busy, 'AI 수정 작업 중에는 결과를 되돌릴 수 없습니다.')}>수정 결과 되돌리기</button>` : ''}
          </div>

          ${!hasOpenAIKey ? `<div class="repair-error">OpenAI API 키가 있어야 부분 수정이 가능합니다. 모델 설정에서 OpenAI 키를 먼저 저장해주세요.</div>` : ''}
          ${repair.error ? `<div class="repair-error">${escapeHtml(repair.error)}</div>` : ''}

          <button class="btn-primary" id="runAiRepair" style="margin-top:auto" ${disabledAttr(repair.busy || !hasOpenAIKey, repair.busy ? '이미 선택 영역을 AI로 수정 중입니다.' : 'OpenAI API 키가 있어야 부분 수정이 가능합니다.')}>
            <span class="material-icons-outlined" style="font-size:18px">auto_fix_high</span>
            선택 영역만 AI로 수정
          </button>
          <div class="repair-mini">
            <span>수정 전 이미지는 되돌리기 기록에 보존됩니다.</span>
            <span>mask edit</span>
          </div>
        </aside>
      </div>
    </div>
  </div>`;
}

function getSectionPromptTrace(sectionId) {
  const section = getSectionDefinition(sectionId);
  const content = state.sectionContents?.[sectionId] || {};
  const image = state.sectionImages?.[sectionId] || '';
  const currentVariantId = state.promptTraceModal?.variantId || state.currentSectionVariantIds?.[sectionId];
  const variant = (state.sectionVariants?.[sectionId] || []).find(v => v.id === currentVariantId && (!image || v.image === image));
  if (variant?.content?.prompt_trace) return { trace: variant.content.prompt_trace, source: '선택된 이미지 시안 기록', variant };
  if (content.prompt_trace) return { trace: content.prompt_trace, source: '현재 섹션 생성 기록', variant: null };
  if (!section) return { trace: null, source: '', variant: null };
  const mode = getSectionGenerationModeInfo(content.generation_mode || sectionId);
  const basis = getSectionBasisModeInfo(content.generation_basis || sectionId);
  const contentPrompt = buildSectionPromptInstructions(sectionId, state.sectionInstructions?.[sectionId] || '');
  const imagePrompt = mode.id === 'text_only' ? '' : buildSectionImagePrompt(section, content, mode.id);
  const clone = cloneData(content || {});
  if (!clone.generation_basis) clone.generation_basis = basis.id;
  if (!clone.generation_basis_label) clone.generation_basis_label = basis.label;
  attachSectionPromptTrace(section, clone, {
    trigger: 'reconstructed',
    contentPrompt,
    imagePrompt,
    imageApiPrompt: imagePrompt ? buildImageApiPromptEnvelope(imagePrompt) : null,
    compRef: basis.id === 'image_analysis' ? '' : (state.competitorData ? JSON.stringify(state.competitorData).substring(0, 1000) : ''),
    reconstructed: true,
  });
  return { trace: clone.prompt_trace, source: '현재 설정으로 재구성', variant: null };
}

function promptTraceToText(trace, sourceLabel = '') {
  if (!trace) return '';
  return [
    `섹션: ${trace.sectionName || trace.sectionId || ''}`,
    `기록 출처: ${sourceLabel}`,
    `생성 기준: ${trace.basisLabel || trace.basisId || ''}`,
    `생성 방식: ${trace.modeLabel || trace.modeId || ''}`,
    `LLM: ${trace.llmProviderLabel || ''} ${trace.llmModelLabel || trace.llmModelId || ''}`,
    `이미지 모델: ${trace.imageModelLabel || trace.imageModelId || '이미지 생성 없음'}`,
    `이미지 크기: ${trace.imageRequestedSize || ''}`,
    `원본 이미지 입력: ${trace.sourceImageNote || (trace.sourceImageUsed ? '사용함' : '미사용')}`,
    '',
    '[제품 분석/입력 컨텍스트]',
    trace.productAnalysisSummary || '',
    trace.competitorContext ? `\n[경쟁사/참고 컨텍스트]\n${trace.competitorContext}` : '',
    '',
    '[콘텐츠 생성 프롬프트]',
    trace.contentGenerationPrompt || '',
    '',
    '[이미지 섹션 프롬프트]',
    trace.imageSectionPrompt || '',
    '',
    '[이미지 API 최종 프롬프트]',
    trace.imageApiFinalPrompt || '',
  ].filter(part => part !== null && part !== undefined).join('\n');
}

function renderPromptTraceModal() {
  const sectionId = state.promptTraceModal?.sectionId;
  const section = SECTIONS.find(s => s.id === sectionId);
  const { trace, source } = getSectionPromptTrace(sectionId);
  const image = state.sectionImages?.[sectionId] || '';
  const createdAt = trace?.createdAt
    ? new Date(trace.createdAt).toLocaleString('ko-KR')
    : '생성 시각 기록 없음';
  return `<div class="modal-overlay" id="promptTraceOverlay" style="align-items:flex-start;overflow:auto;padding:24px 12px">
    <div class="modal prompt-trace-modal" onclick="event.stopPropagation()">
      <div class="prompt-trace-head">
        <div>
          <div class="prompt-trace-title">
            <span class="material-icons-outlined" style="font-size:19px;color:var(--primary-h)">receipt_long</span>
            이미지 생성 인과관계 프롬프트
          </div>
          <div class="prompt-trace-sub">${escapeHtml(section ? `${section.n}. ${section.name}` : sectionId || '')} · ${escapeHtml(source || '')}${trace?.reconstructed ? ' · 현재 설정으로 재구성됨' : ''}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn-sm" data-copy-prompt-trace="${escAttr(sectionId || '')}">
            <span class="material-icons-outlined" style="font-size:14px">content_copy</span>전체 복사
          </button>
          <button class="btn-sm" data-close-prompt-trace>
            <span class="material-icons-outlined" style="font-size:14px">close</span>닫기
          </button>
        </div>
      </div>
      <div class="prompt-trace-body">
        ${image ? `<img src="${escAttr(image)}" alt="${escAttr(section?.name || '생성 이미지')}" style="max-width:100%;max-height:260px;object-fit:contain;background:#050711;border:1px solid var(--border);border-radius:12px;margin:0 auto;display:block">` : ''}
        <div class="prompt-trace-meta">
          <div class="prompt-trace-chip"><b>생성 기준</b>${escapeHtml(trace?.basisLabel || trace?.basisId || '기록 없음')}</div>
          <div class="prompt-trace-chip"><b>생성 방식</b>${escapeHtml(trace?.modeLabel || trace?.modeId || '기록 없음')}</div>
          <div class="prompt-trace-chip"><b>LLM</b>${escapeHtml(`${trace?.llmProviderLabel || ''} ${trace?.llmModelLabel || trace?.llmModelId || ''}`.trim() || '기록 없음')}</div>
          <div class="prompt-trace-chip"><b>이미지 모델</b>${escapeHtml(trace?.imageModelLabel || trace?.imageModelId || '이미지 생성 없음')}</div>
          <div class="prompt-trace-chip"><b>원본 이미지 입력</b>${escapeHtml(trace?.sourceImageNote || (trace?.sourceImageUsed ? '사용함' : '미사용'))}</div>
          <div class="prompt-trace-chip"><b>생성 시각</b>${escapeHtml(createdAt)}</div>
        </div>
        ${trace?.reconstructed ? `<div class="app-notice warn" style="margin:0">
          <span class="material-icons-outlined">info</span>
          <span>이 이미지는 생성 당시 프롬프트 기록이 없어서 현재 저장된 분석값과 설정으로 재구성했습니다. 새로 생성하는 이미지부터는 실제 생성 당시 프롬프트가 그대로 저장됩니다.</span>
        </div>` : ''}
        <div class="prompt-trace-section">
          <h3><span class="material-icons-outlined" style="font-size:15px">dataset</span>제품 분석/입력 컨텍스트</h3>
          <pre class="prompt-trace-pre">${escapeHtml(trace?.productAnalysisSummary || '기록 없음')}</pre>
        </div>
        ${trace?.competitorContext ? `<div class="prompt-trace-section">
          <h3><span class="material-icons-outlined" style="font-size:15px">manage_search</span>경쟁사/참고 컨텍스트</h3>
          <pre class="prompt-trace-pre">${escapeHtml(trace.competitorContext)}</pre>
        </div>` : ''}
        <div class="prompt-trace-section">
          <h3><span class="material-icons-outlined" style="font-size:15px">psychology</span>콘텐츠 생성 프롬프트</h3>
          ${trace?.contentGenerationPrompt ? `<pre class="prompt-trace-pre">${escapeHtml(trace.contentGenerationPrompt)}</pre>` : '<div class="prompt-trace-empty">콘텐츠 생성 프롬프트 기록이 없습니다.</div>'}
        </div>
        <div class="prompt-trace-section">
          <h3><span class="material-icons-outlined" style="font-size:15px">image</span>이미지 섹션 프롬프트</h3>
          ${trace?.imageSectionPrompt ? `<pre class="prompt-trace-pre">${escapeHtml(trace.imageSectionPrompt)}</pre>` : '<div class="prompt-trace-empty">이미지 생성 없이 텍스트/레이아웃만 생성된 섹션입니다.</div>'}
        </div>
        <div class="prompt-trace-section">
          <h3><span class="material-icons-outlined" style="font-size:15px">terminal</span>이미지 API 최종 프롬프트</h3>
          ${trace?.imageApiFinalPrompt ? `<pre class="prompt-trace-pre">${escapeHtml(trace.imageApiFinalPrompt)}</pre>` : '<div class="prompt-trace-empty">이미지 API로 전송된 프롬프트 기록이 없습니다.</div>'}
        </div>
      </div>
    </div>
  </div>`;
}

function renderApiModal() {
  const hasSaved = !!(state.apiKey || state.backendBaseUrl);
  return `<div class="modal-overlay" id="apiModal">
    <div class="modal">
      <h2>🔑 Gemini 연결 설정</h2>
      <p style="margin-bottom:12px">권장: Vertex 백엔드 URL을 입력하면 API 키 없이 Vertex AI 과금 경로로 호출됩니다.</p>
      ${hasSaved ? '<p style="margin-top:-6px;margin-bottom:12px;font-size:12px;color:var(--ok)">✅ 저장된 Gemini 연결 설정이 있습니다.</p>' : ''}
      <div class="input-group">
        <label class="label">Vertex Backend URL (권장)</label>
        <input type="text" class="input" id="backendUrlInput" value="${state.backendBaseUrl || ''}" placeholder="http://localhost:5000" style="font-family:monospace;font-size:13px">
      </div>
      <div class="input-group">
        <label class="label">Gemini API Key (선택, Direct 호출용)</label>
        <div style="position:relative">
          <input type="password" class="input" id="apiKeyInput" value="${state.apiKey}" placeholder="AIza..." style="padding-right:40px;font-family:monospace;font-size:13px">
          <span class="material-icons-outlined" id="toggleKeyVis" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;color:var(--text-m)">visibility</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-primary" id="saveApiKey">
          <span class="material-icons-outlined" style="font-size:18px">save</span>
          저장 후 시작
        </button>
        ${hasSaved ? '<button class="btn-sm" id="skipApiModal" style="padding:12px 20px">기존 설정으로 계속</button>' : ''}
      </div>
    </div>
  </div>`;
}

function renderSidebar() {
  const items = [
    {icon:'upload_file',label:'이미지 업로드',step:'upload',always:true},
    {icon:'analytics',label:'AI 분석',step:'analyzing',always:true},
    {icon:'manage_search',label:'경쟁사 분석',step:'competitor',always:true},
    {icon:'dashboard_customize',label:'섹션 설정',step:'sections',need:'analysis'},
    {icon:'auto_fix_high',label:'자동 생성',step:'generating',need:'analysis'},
    {icon:'preview',label:'미리보기',step:'preview',need:'preview'},
    {icon:'auto_awesome',label:'이미지컷 생성',step:'imagecuts',always:true},
    {icon:'style',label:'옵션 분류기',step:'optionsorter',always:true},
    {icon:'precision_manufacturing',label:'조립공장',step:'factory',always:true},
    {icon:'cloud_sync',label:'자동화',step:'automation',always:true},
    {icon:'tune',label:'모델 설정',step:'modelsettings',always:true},
    {icon:'summarize',label:'작업 리포트',step:'reports',always:true},
    {icon:'menu_book',label:'상세페이지 자동화 설명서',step:'manual',always:true,bottom:true},
  ];
  const cfg = state.modelConfig;
  const prov = LLM_PROVIDERS[cfg.llmProvider];
  const mdl = prov?.models.find(m => m.id === cfg.llmModel);
  const imgMdl = IMAGE_MODELS.find(m => m.id === cfg.imageModel);
  const llmInfo = getCurrentLlmRunInfo();
  const imageInfo = getCurrentImageRunInfo();
  const apiStatusItems = getNumberedApiStatusItems();
  const apiStatusMap = new Map(apiStatusItems.map(item => [item.key, item]));

  return `<aside class="sidebar">
    <div class="logo">
      <span class="logo-icon">✦</span>
      <div><span class="logo-text">상세페이지</span><br><span class="logo-sub">자동 생성기</span></div>
    </div>
    <nav class="nav">
      ${items.map(it => {
        const active = state.step === it.step;
        const gate = getNavGateInfo(it.step);
        const navTitle = gate.blocked ? `${it.label} · ${gate.reason}` : it.label;
        return `<button class="nav-item ${active?'active':''} ${gate.blocked?'blocked':''}" data-nav="${it.step}" title="${escAttr(navTitle)}" aria-label="${escAttr(navTitle)}" ${it.bottom ? 'style="margin-top:auto"' : ''}>
          <span class="material-icons-outlined" style="font-size:20px" aria-hidden="true">${it.icon}</span>
          <span class="nav-label">${it.label}</span>
          ${renderNavApiBadges(it.step, apiStatusMap)}
        </button>`;
      }).join('')}
    </nav>
    <!-- 현재 모델 표시 -->
    <div class="sidebar-model-status">
      <div class="sidebar-model-card" data-compact-label="LLM" tabindex="0" role="status" title="${escAttr(`분석 LLM · ${llmInfo.providerLabel} · ${mdl?.label || cfg.llmModel} · ${llmInfo.route}`)}">
        <div style="font-weight:800;color:var(--text-d)">분석 LLM</div>
        <div style="color:${cfg.llmProvider==='gpt_oauth'?'var(--ok)':(cfg.llmProvider==='openai'?'#10a37f':'var(--primary-h)')};font-weight:900;word-break:keep-all">${escapeHtml(llmInfo.providerLabel)} · ${escapeHtml(mdl?.label||cfg.llmModel)}</div>
        <div style="font-family:Consolas,monospace;color:var(--text-m)">${escapeHtml(cfg.llmModel)}</div>
        <div style="color:var(--text-m)">${escapeHtml(llmInfo.route)}</div>
      </div>
      <div class="sidebar-model-card" data-compact-label="IMG" tabindex="0" role="status" title="${escAttr(`이미지 모델 · ${imageInfo.providerLabel} · ${imgMdl?.label || cfg.imageModel} · ${imageInfo.route}`)}">
        <div style="font-weight:800;color:var(--text-d)">이미지 모델</div>
        <div style="color:var(--orange);font-weight:900">${escapeHtml(imageInfo.providerLabel)} · ${escapeHtml(imgMdl?.label||cfg.imageModel)}</div>
        <div style="font-family:Consolas,monospace;color:var(--text-m)">${escapeHtml(cfg.imageModel)}</div>
        <div style="color:var(--text-m)">${escapeHtml(imageInfo.route)}</div>
      </div>
    </div>
    <div class="sidebar-api-actions">
      <button class="btn-sm" id="changeApiKey" title="API 키 변경" aria-label="API 키 변경">
        <span class="material-icons-outlined" style="font-size:14px">key</span><span class="sidebar-api-label">API 키 변경</span>
      </button>
    </div>
  </aside>`;
}

function renderError() {
  const message = formatAppErrorMessage(state.error);
  return `<div class="error-bar">
    <span class="material-icons-outlined" style="font-size:18px">error_outline</span>
    <span style="flex:1">${escapeHtml(message)}</span>
    <span class="material-icons-outlined" style="font-size:18px;cursor:pointer" id="closeError">close</span>
  </div>`;
}

function shouldRenderStorageWarning() {
  const message = String(state.storageWarning || '');
  if (!message) return false;
  const competitorOnly = message.startsWith('경쟁사 분석의 임시 업로드·근거 이미지');
  return !competitorOnly || state.step === 'competitor';
}

function renderStorageWarning() {
  return `<div class="error-bar" style="background:rgba(245,158,11,.10);border-color:rgba(245,158,11,.34);color:var(--warn)">
    <span class="material-icons-outlined" style="font-size:18px">sd_storage</span>
    <span style="flex:1">${escapeHtml(state.storageWarning)}</span>
    <span class="material-icons-outlined" style="font-size:18px;cursor:pointer" id="closeStorageWarning">close</span>
  </div>`;
}

function factoryRecoverStaleRunningStages(factory = null) {
  const target = factory || state.factory;
  const detail = target?.stages?.detail;
  if (!detail || detail.status !== 'running') return;
  const updatedAt = Number(detail.updatedAt || 0);
  const ageMs = updatedAt ? Date.now() - updatedAt : 0;
  const batchRunning = state.sectionBatchRun?.status === 'running';
  const goalRunning = !!target.goalRun?.running;
  if (ageMs > 12000 && !batchRunning && !goalRunning) {
    detail.status = 'blocked';
    detail.message = '상세 생성 진행 로그가 끊겨 다시 실행이 필요합니다. 상세 섹션을 다시 생성해주세요.';
    detail.updatedAt = Date.now();
    if (target.goalRun && /상세페이지 섹션 생성 중/.test(String(target.goalRun.currentStage || ''))) {
      target.goalRun.currentStage = '상세페이지 다시 생성 필요';
      target.goalRun.failureReason = detail.message;
    }
  }
}

function factoryCurrentDetailSectionsComplete() {
  const sections = typeof orderedSections === 'function' ? orderedSections() : [];
  if (!sections.length) return false;
  const currentScope = typeof sectionWorkScopeMeta === 'function' ? sectionWorkScopeMeta() : null;
  return sections.every(section => {
    if (!section?.id) return true;
    const content = state.sectionContents?.[section.id];
    if (!content) return false;
    return typeof sectionContentBelongsToCurrentWork === 'function'
      ? sectionContentBelongsToCurrentWork(section.id, content, currentScope)
      : true;
  });
}

function factoryClearResolvedDetailFailureReason(factory = null) {
  const target = factory || state.factory;
  const detail = target?.stages?.detail;
  const goal = target?.goalRun;
  if (!detail || !goal) return;
  const batchDone = state.sectionBatchRun?.status === 'done';
  const detailDone = detail.status === 'done';
  const complete = detailDone || (batchDone && factoryCurrentDetailSectionsComplete());
  if (!complete) return;
  const reason = String(goal.failureReason || '');
  const stage = String(goal.currentStage || '');
  const detailMessage = String(detail.message || '');
  const hasStaleDetailFailure = /상세|섹션|진행 로그|다시 생성|생성 실패/.test(`${reason} ${stage} ${detailMessage}`);
  if (!hasStaleDetailFailure) return;
  if (detail.status !== 'done') {
    detail.status = 'done';
    detail.message = detail.message || '상세페이지 섹션 생성 완료';
    detail.updatedAt = Date.now();
  }
  goal.failureReason = '';
  if (/상세페이지 다시 생성 필요|상세페이지 생성 실패|상세페이지 섹션 생성 중/.test(stage)) {
    goal.currentStage = '상세페이지 생성 완료';
  }
}

function factoryCurrentProductImageReferencePayload(factory = state.factory) {
  const product = factory?.product || {};
  const statePreview = state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__' ? state.imagePreview : '';
  const productPreview = product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__' ? product.imagePreview : '';
  if (state.imageBase64) {
    return {
      base64: typeof imageBase64Only === 'function' ? imageBase64Only(state.imageBase64) : state.imageBase64,
      mime: state.imageMime || product.imageMime || 'image/png',
      preview: statePreview || '',
      name: state.imageName || product.imageName || product.inputImages?.[0]?.name || '제품사진',
      source: 'app-current',
    };
  }
  if (product.imageBase64) {
    return {
      base64: typeof imageBase64Only === 'function' ? imageBase64Only(product.imageBase64) : product.imageBase64,
      mime: product.imageMime || state.imageMime || 'image/png',
      preview: productPreview || '',
      name: product.imageName || product.inputImages?.[0]?.name || state.imageName || '제품사진',
      source: 'factory-product',
    };
  }
  if (statePreview) {
    const payload = factoryImagePayloadFromSrc(statePreview, {
      mime: state.imageMime || product.imageMime || 'image/png',
      name: state.imageName || product.imageName || '제품사진',
      source: 'app-preview',
    });
    if (payload?.base64 || payload?.preview) return payload;
  }
  if (productPreview) {
    const payload = factoryImagePayloadFromSrc(productPreview, {
      mime: product.imageMime || state.imageMime || 'image/png',
      name: product.imageName || product.inputImages?.[0]?.name || '제품사진',
      source: 'factory-preview',
    });
    if (payload?.base64 || payload?.preview) return payload;
  }
  return null;
}

function factoryCurrentProductImageReferenceKey(factory = state.factory) {
  const product = factory?.product || {};
  const explicit = [
    product.lockedInputImageFingerprint,
    product.currentUploadImageFingerprint,
    product.inputImageFingerprint,
    product.sourceImageKey,
    product.productImageKey,
    ...(Array.isArray(product.inputImages) ? product.inputImages : []).map(img =>
      img?.inputImageFingerprint || img?.sourceImageKey || img?.productImageKey || ''
    ),
  ].map(value => String(value || '').trim()).find(Boolean);
  const payload = factoryCurrentProductImageReferencePayload(factory);
  const payloadKey = payload?.base64
    ? factoryImagePayloadFingerprint(payload.base64)
    : factoryImagePayloadFingerprint(payload?.preview || '');
  return payloadKey || explicit || '';
}

function factoryImageRecordFingerprint(record = {}) {
  if (!record || typeof record !== 'object') return '';
  const explicit = [
    record.inputImageFingerprint,
    record.sourceImageKey,
    record.inputImageKey,
    record.productImageKey,
    record.metadata?.inputImageFingerprint,
    record.metadata?.sourceImageKey,
    record.metadata?.inputImageKey,
    record.metadata?.productImageKey,
  ].map(value => String(value || '').trim()).find(Boolean);
  if (explicit) return explicit;
  const src = record.base64 || record.preview || record.dataUrl || record.image || '';
  return factoryImagePayloadFingerprint(src);
}

function factoryImageRecordReferencesCurrentProduct(record = {}) {
  if (!record || typeof record !== 'object') return false;
  return ['current-product-image', 'app-current', 'factory-current-product'].includes(String(record.imageRef || record.sourceRef || record.currentImageRef || '').trim());
}

function factoryResolveCurrentProductImageReference(record = {}, factory = state.factory) {
  if (!factoryImageRecordReferencesCurrentProduct(record)) return null;
  const payload = factoryCurrentProductImageReferencePayload(factory);
  if (!payload) return null;
  const mime = payload.mime || record.mime || record.mimeType || 'image/png';
  const base64 = payload.base64 || '';
  return {
    ...payload,
    mime,
    preview: payload.preview || (base64 ? `data:${mime};base64,${base64}` : ''),
    inputImageFingerprint: factoryCurrentProductImageReferenceKey(factory),
  };
}

function factoryCompactImageRecordToCurrentReference(record = {}, currentKey = '', options = {}) {
  if (!record || typeof record !== 'object') return { record, changed: false };
  const key = String(currentKey || '').trim();
  if (!key) return { record, changed: false };
  const recordKey = factoryImageRecordFingerprint(record);
  const hasInline = !!(record.base64 || record.preview || record.dataUrl || record.image);
  if (!hasInline && !factoryImageRecordReferencesCurrentProduct(record)) return { record, changed: false };
  if (recordKey && recordKey !== key) return { record, changed: false };
  const next = { ...record };
  const hadInline = hasInline;
  delete next.base64;
  delete next.preview;
  delete next.dataUrl;
  delete next.image;
  next.hasImage = true;
  next.hasImageData = true;
  next.imageRef = 'current-product-image';
  next.sourceRef = 'current-product-image';
  next.inputImageFingerprint = key;
  next.sourceImageKey = key;
  next.productImageKey = key;
  if (options.keepStoredMarker === true) next.preview = '__stored_in_indexeddb__';
  return { record: next, changed: hadInline || record.imageRef !== next.imageRef || record.sourceRef !== next.sourceRef };
}

function compactCurrentProductMirrorImages(factory = state.factory) {
  if (!factory || typeof factory !== 'object') return false;
  const product = factory.product && typeof factory.product === 'object' ? factory.product : null;
  if (!product) return false;
  const stateKey = state.imageBase64 ? factoryImagePayloadFingerprint(state.imageBase64) : '';
  const currentKey = stateKey || factoryCurrentProductImageReferenceKey(factory);
  if (!currentKey) return false;
  let changed = false;

  if (Array.isArray(product.inputImages)) {
    product.inputImages = product.inputImages.map(img => {
      const result = factoryCompactImageRecordToCurrentReference(img, currentKey, { keepStoredMarker: true });
      if (result.changed) changed = true;
      return result.record;
    });
  }

  const productImageKey = factoryImagePayloadFingerprint(product.imageBase64 || product.imagePreview || '');
  if (stateKey && productImageKey && productImageKey === stateKey && (product.imageBase64 || product.imagePreview)) {
    product.hasImage = true;
    product.imageRef = 'current-product-image';
    product.imageBase64 = '';
    product.imagePreview = '__stored_in_indexeddb__';
    product.lockedInputImageFingerprint = product.lockedInputImageFingerprint || currentKey;
    product.inputImageFingerprint = product.inputImageFingerprint || currentKey;
    product.sourceImageKey = product.sourceImageKey || currentKey;
    product.productImageKey = product.productImageKey || currentKey;
    changed = true;
  }

  if (Array.isArray(state.analysisImages)) {
    state.analysisImages = state.analysisImages.map(img => {
      const result = factoryCompactImageRecordToCurrentReference(img, currentKey, { keepStoredMarker: true });
      if (result.changed) changed = true;
      return result.record;
    });
  }
  return changed;
}

function compactCurrentCutsMirrorPreviews(cuts = state.cuts) {
  if (!cuts || typeof cuts !== 'object') return false;
  if (typeof cutImageFingerprint !== 'function') return false;
  let changed = false;
  const clearDuplicatedPreview = (baseKey, previewKey) => {
    if (!cuts[baseKey] || !cuts[previewKey] || !String(cuts[previewKey]).startsWith('data:image/')) return;
    const baseFingerprint = cutImageFingerprint(cuts[baseKey]);
    const previewFingerprint = cutImageFingerprint(cuts[previewKey]);
    if (!baseFingerprint || !previewFingerprint || baseFingerprint !== previewFingerprint) return;
    cuts[previewKey] = null;
    changed = true;
  };
  clearDuplicatedPreview('sourceBase64', 'sourcePreview');
  clearDuplicatedPreview('workImageBase64', 'workImagePreview');
  if (cuts.sourceBase64) cuts.hasSourceImage = true;
  if (cuts.workImageBase64) cuts.hasWorkImage = true;
  return changed;
}

function factoryPromptAssetImageUrl(asset = {}) {
  const image = displayableImageSrc(asset?.image || asset?.dataUrl || asset?.result || '');
  if (image) return image;
  const archiveId = String(asset?.archiveId || asset?.localArchive?.archiveId || asset?.metadata?.localArchiveId || '').trim();
  return archiveId ? factoryRuntimeArchiveImageUrl({ archiveId }) : '';
}

function factoryFindPromptAssetForCompact(prompt = {}, stageId = 'cuts', factory = state.factory) {
  const label = factoryNormalizeIdentityText(prompt?.label || prompt?.title || '');
  const promptId = String(prompt?.id || prompt?.promptId || '').trim();
  const assets = Array.isArray(factory?.assets) ? factory.assets : [];
  return assets.find(asset => {
    if (!asset) return false;
    if (asset.rejected && !asset.used) return false;
    if (asset.currentProductHidden && !asset.used) return false;
    if (String(asset.stageId || '') !== String(stageId || 'cuts')) return false;
    const image = factoryPromptAssetImageUrl(asset);
    if (!image) return false;
    const assetPromptId = String(asset.promptId || asset.metadata?.promptId || asset.sourceMap?.promptId || '').trim();
    if (promptId && assetPromptId && promptId === assetPromptId) return true;
    const assetLabel = factoryNormalizeIdentityText(asset.title || asset.label || '');
    return !!label && !!assetLabel && label === assetLabel;
  }) || null;
}

function compactCurrentCutPromptInlineResults(factory = state.factory, cuts = state.cuts) {
  if (!cuts || typeof cuts !== 'object') return false;
  let changed = false;
  const compactList = (list = [], stageId = 'cuts') => (Array.isArray(list) ? list : []).map(prompt => {
    if (!prompt || typeof prompt !== 'object') return prompt;
    const result = String(prompt.result || '');
    if (!result.startsWith('data:image/')) return prompt;
    const asset = factoryFindPromptAssetForCompact(prompt, stageId, factory);
    const image = factoryPromptAssetImageUrl(asset);
    if (!image) return prompt;
    changed = true;
    return {
      ...prompt,
      result: image,
      hasResult: true,
      imagePersistence: 'local-archive-url',
      resultAssetId: asset.id || prompt.resultAssetId || '',
      archiveId: asset.archiveId || asset.localArchive?.archiveId || asset.metadata?.localArchiveId || prompt.archiveId || '',
    };
  });
  cuts.prompts = compactList(cuts.prompts, 'cuts');
  cuts.sizePrompts = compactList(cuts.sizePrompts, 'size');
  return changed;
}

function factoryIdentityInputFocused() {
  const id = document.activeElement?.id || '';
  return id === 'factoryProductName' || id === 'factoryNaturalHint' || id === 'factoryGuideProductName' || id === 'factoryGuideNaturalHint';
}

function factoryImagePayloadFromSrc(src = '', fallback = {}) {
  const preview = displayableImageSrc(src);
  if (!preview) return null;
  const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(String(preview || ''));
  return {
    base64: match ? match[2] : '',
    mime: fallback.mime || (match ? match[1] : '') || 'image/png',
    preview,
    name: fallback.name || '제품사진',
    source: fallback.source || 'unknown',
  };
}

function factoryImagePayloadFromBase64(base64 = '', mime = 'image/png', fallback = {}) {
  const raw = String(base64 || '').trim();
  if (!raw) return null;
  const cleanBase64 = typeof imageBase64Only === 'function' ? imageBase64Only(raw) : raw;
  const safeMime = typeof inferImageMimeFromBase64 === 'function'
    ? inferImageMimeFromBase64(cleanBase64, mime || fallback.mime || 'image/png')
    : (mime || fallback.mime || 'image/png');
  return {
    base64: cleanBase64,
    mime: safeMime,
    preview: fallback.preview && fallback.preview !== '__stored_in_indexeddb__'
      ? fallback.preview
      : `data:${safeMime};base64,${cleanBase64}`,
    name: fallback.name || '제품사진',
    source: fallback.source || 'unknown',
  };
}

function factoryImagePayloadFromCurrentVisual(base64 = '', mime = 'image/png', preview = '', fallback = {}) {
  const basePayload = factoryImagePayloadFromBase64(base64, mime, {
    ...fallback,
    preview,
  });
  const previewPayload = factoryImagePayloadFromSrc(preview, {
    ...fallback,
    mime: mime || fallback.mime || 'image/png',
    source: fallback.source || 'visual-preview',
  });
  if (!previewPayload?.base64) return basePayload || previewPayload;
  if (!basePayload?.base64) return previewPayload;
  const previewKey = factoryImagePayloadFingerprint(previewPayload.base64);
  const baseKey = factoryImagePayloadFingerprint(basePayload.base64);
  return previewKey && baseKey && previewKey !== baseKey ? previewPayload : basePayload;
}

function factoryCurrentVisualImageFingerprint(base64 = '', mime = 'image/png', preview = '') {
  const payload = factoryImagePayloadFromCurrentVisual(base64, mime, preview);
  const fingerprint = factoryImagePayloadFingerprint(payload?.base64 || payload?.preview || '');
  return factoryImageFingerprintLooksUsable(fingerprint) ? fingerprint : '';
}

function factoryLockedInputImageCandidateRows(factory = factoryRuntimeReadFactory(), options = {}) {
  const product = factory?.product || {};
  const includeAppState = options.includeAppState !== false;
  const rows = [];
  (Array.isArray(product.inputImages) ? product.inputImages : []).forEach((img, index) => {
    rows.push({
      base64: img?.base64 || '',
      mime: img?.mime || product.imageMime || 'image/png',
      preview: img?.preview || img?.dataUrl || img?.image || '',
      name: img?.name || product.imageName || '제품사진',
      source: index === 0 ? 'factory-input' : 'factory-input-extra',
      inputImageFingerprint: img?.inputImageFingerprint || img?.sourceImageKey || img?.productImageKey || '',
      uploadedAt: img?.uploadedAt || null,
    });
  });
  rows.push({
    base64: product.imageBase64 || '',
    mime: product.imageMime || product.lockedInputImageMime || 'image/png',
    preview: product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__' ? product.imagePreview : '',
    name: product.imageName || product.lockedInputImageName || product.inputImages?.[0]?.name || '제품사진',
    source: 'factory-product',
    inputImageFingerprint: product.lockedInputImageFingerprint || '',
    uploadedAt: product.lockedInputImageSetAt || null,
  });
  if (includeAppState) {
    rows.push({
      base64: state.imageBase64 || '',
      mime: state.imageMime || product.imageMime || 'image/png',
      preview: state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__' ? state.imagePreview : '',
      name: state.imageName || state.analysisImages?.[0]?.name || product.imageName || '제품사진',
      source: 'app-current',
      inputImageFingerprint: '',
      uploadedAt: null,
    });
  }
  return rows;
}

function factoryLockedInputPayloadFromRow(row = {}, expectedKey = '') {
  const expected = String(expectedKey || '').trim();
  const basePayload = factoryImagePayloadFromBase64(row.base64, row.mime || 'image/png', {
    name: row.name || '제품사진',
    source: row.source || 'factory-locked-input',
  });
  if (basePayload?.base64) {
    const baseKey = factoryImagePayloadFingerprint(basePayload.base64);
    if (!expected || !baseKey || baseKey === expected) {
      const previewPayload = factoryImagePayloadFromSrc(row.preview, {
        mime: basePayload.mime,
        name: basePayload.name,
        source: `${row.source || 'factory-locked-input'}-preview`,
      });
      const previewKey = previewPayload?.base64 ? factoryImagePayloadFingerprint(previewPayload.base64) : '';
      return {
        ...basePayload,
        preview: previewKey && baseKey && previewKey === baseKey
          ? previewPayload.preview
          : `data:${basePayload.mime || 'image/png'};base64,${basePayload.base64}`,
        inputImageFingerprint: baseKey || expected,
        lockedInput: true,
        uploadedAt: row.uploadedAt || null,
      };
    }
  }
  const previewPayload = factoryImagePayloadFromSrc(row.preview, {
    mime: row.mime || 'image/png',
    name: row.name || '제품사진',
    source: row.source || 'factory-locked-input-preview',
  });
  if (previewPayload?.base64) {
    const previewKey = factoryImagePayloadFingerprint(previewPayload.base64);
    if (!expected || !previewKey || previewKey === expected) {
      return {
        ...previewPayload,
        inputImageFingerprint: previewKey || expected,
        lockedInput: true,
        uploadedAt: row.uploadedAt || null,
      };
    }
  }
  return null;
}

function factoryLockedInputImageFingerprint(factory = factoryRuntimeReadFactory(), options = {}) {
  const product = factory?.product || {};
  const analysisImageKeys = Array.isArray(options.analysisImages)
    ? options.analysisImages.map(img => img?.inputImageFingerprint || img?.sourceImageKey || img?.productImageKey || '')
    : [];
  const explicit = [
    product.lockedInputImageFingerprint,
    product.currentUploadImageFingerprint,
    product.inputImageFingerprint,
    ...(Array.isArray(product.inputImages) ? product.inputImages : []).map(img =>
      img?.inputImageFingerprint || img?.sourceImageKey || img?.productImageKey || ''
    ),
    ...analysisImageKeys,
  ].map(value => String(value || '').trim()).find(Boolean);
  if (explicit) return explicit;
  const rows = factoryLockedInputImageCandidateRows(factory, options);
  for (const row of rows) {
    const payload = factoryLockedInputPayloadFromRow(row, '');
    const key = payload?.inputImageFingerprint || factoryImagePayloadFingerprint(payload?.base64 || payload?.preview || '');
    if (key) return key;
  }
  return '';
}

function factoryLockedInputImagePayload(factory = factoryRuntimeReadFactory(), options = {}) {
  const expectedKey = factoryLockedInputImageFingerprint(factory, options);
  if (!expectedKey) return null;
  const rows = factoryLockedInputImageCandidateRows(factory, options);
  for (const row of rows) {
    const payload = factoryLockedInputPayloadFromRow(row, expectedKey);
    if (payload?.base64) {
      return {
        ...payload,
        inputImageFingerprint: expectedKey,
        source: payload.source || row.source || 'factory-locked-input',
      };
    }
  }
  return null;
}

function factoryStampLockedInputImage(factory, payload = {}, meta = {}) {
  if (!factory?.product || !payload) return '';
  const product = factory.product;
  const cleanBase64 = typeof imageBase64Only === 'function' ? imageBase64Only(payload.base64 || '') : String(payload.base64 || '');
  if (!cleanBase64) return '';
  const mime = typeof inferImageMimeFromBase64 === 'function'
    ? inferImageMimeFromBase64(cleanBase64, payload.mime || product.imageMime || 'image/png')
    : (payload.mime || product.imageMime || 'image/png');
  const preview = payload.preview && payload.preview !== '__stored_in_indexeddb__'
    ? payload.preview
    : `data:${mime};base64,${cleanBase64}`;
  const fingerprint = factoryImagePayloadFingerprint(cleanBase64);
  if (!fingerprint) return '';
  const inputId = meta.id || product.inputImages?.[0]?.id || uid('factory_input');
  const name = meta.name || payload.name || product.imageName || product.inputImages?.[0]?.name || '제품사진';
  const setAt = Number.isFinite(Number(meta.setAt)) ? Number(meta.setAt) : Date.now();
  const identityMeta = typeof factoryCurrentProductIdentityMeta === 'function'
    ? factoryCurrentProductIdentityMeta(factory, [meta.productName, payload.productName, product.productName, product.userProductName])
    : { productName: product.productName || state.productName || '', productIdentityKey: '' };
  const productKey = factoryNormalizeIdentityText(
    meta.productKey ||
    payload.productKey ||
    identityMeta.productIdentityKey ||
    product.productKey ||
    product.productIdentityKey ||
    identityMeta.productName ||
    ''
  );
  const previousFingerprint = String(product.lockedInputImageFingerprint || product.inputImageFingerprint || '').trim();
  const fingerprintChanged = !!(previousFingerprint && fingerprint && previousFingerprint !== fingerprint);
  let currentRunId = String(
    meta.currentRunId ||
    meta.generationRunId ||
    product.currentRunId ||
    factory?.automation?.currentRunId ||
    factory?.goalRun?.currentRunId ||
    (typeof factoryCurrentWorkflowRunId === 'function' ? factoryCurrentWorkflowRunId(factory) : '') ||
    ''
  ).trim();
  // 기본 이미지가 바뀌면 이전 작업 통로와 섞이지 않도록 새 run identity를 발급한다.
  if (
    (fingerprintChanged || !currentRunId) &&
    meta.preserveWorkflowRun !== true &&
    typeof factoryStartNewWorkflowRun === 'function'
  ) {
    currentRunId = factoryStartNewWorkflowRun(factory) || currentRunId;
  }
  if (fingerprintChanged) {
    // 이전 기본이미지 기반 생성물은 previousAssets로 밀어 현재 후보 목록에 안 보이게 한다.
    const movedIds = new Set();
    (factory.assets || []).forEach(asset => {
      if (!asset) return;
      const assetKey = typeof factoryAssetInputImageKey === 'function'
        ? factoryAssetInputImageKey(asset)
        : String(asset.inputImageFingerprint || asset.metadata?.inputImageFingerprint || '').trim();
      if (!assetKey || assetKey === fingerprint) return;
      asset.used = false;
      if (typeof factoryRememberPreviousAsset === 'function') {
        factoryRememberPreviousAsset(asset, '기본 이미지가 바뀌어 이전 생성 결과를 분리했습니다.', factory);
        movedIds.add(asset.id);
      } else {
        asset.currentProductHidden = true;
        asset.metadata = {
          ...(asset.metadata || {}),
          staleProductImageKey: assetKey,
          hiddenReason: '기본 이미지 변경으로 분리된 이전 생성 결과',
        };
      }
    });
    if (movedIds.size) {
      factory.assets = (factory.assets || []).filter(asset => !movedIds.has(asset?.id));
    }
    // 단계 선택/프롬프트 진행 상태도 새 이미지 기준으로 초기화 (DB 확정값은 유지 가능하나 후보 자동 확정은 해제)
    product.candidateReviewStatus = '';
    product.pendingDbCandidates = [];
    product.pendingCafe24Candidates = [];
    if (factory.stages && typeof factory.stages === 'object') {
      Object.keys(factory.stages).forEach(stageId => {
        const stage = factory.stages[stageId];
        if (!stage || typeof stage !== 'object') return;
        stage.selectedAssetIds = [];
        stage.status = stageId === 'db' ? (product.confirmedDb ? 'done' : 'idle') : 'idle';
        stage.message = fingerprintChanged ? '기본 이미지 변경 · 새 작업 통로' : (stage.message || '');
        stage.latestGenerationRunId = currentRunId;
        stage.currentRunId = currentRunId;
      });
    }
    if (meta.deferPeerState !== true) markWorkspaceDocumentDirty();
  }
  product.imageBase64 = cleanBase64;
  product.imageMime = mime;
  product.imagePreview = preview;
  product.imageName = name;
  product.hasImage = true;
  if (identityMeta.productName && meta.syncProductIdentity !== false) {
    if (typeof factorySetCurrentProductIdentity === 'function') {
      factorySetCurrentProductIdentity(identityMeta.productName, {
        factory,
        productKey,
        syncDom: false,
        setSearchQuery: false,
        syncFinal: false,
      });
    } else {
      product.productName = identityMeta.productName;
      product.userProductName = identityMeta.productName;
    }
  }
  product.inputImageFingerprint = fingerprint;
  product.currentUploadImageFingerprint = fingerprint;
  product.productKey = productKey;
  product.productIdentityKey = productKey;
  product.currentRunId = currentRunId;
  product.lockedInputImageFingerprint = fingerprint;
  product.lockedInputImageName = name;
  product.lockedInputImageMime = mime;
  product.lockedInputImageSetAt = setAt;
  product.inputImages = [{
    id: inputId,
    name,
    base64: cleanBase64,
    mime,
    preview,
    inputImageFingerprint: fingerprint,
    sourceImageKey: fingerprint,
    productImageKey: fingerprint,
    productKey,
    factoryProductKey: productKey,
    scopeProductKey: productKey,
    currentRunId,
    generationRunId: currentRunId,
    lockedInput: true,
    uploadedAt: setAt,
  }];
  return fingerprint;
}

function factoryRepairProductImagePayloadDrift(factory = {}) {
  const product = factory?.product;
  if (!product || typeof product !== 'object') return false;
  const repaired = factoryImagePayloadFromCurrentVisual(product.imageBase64, product.imageMime || 'image/png', product.imagePreview, {
    name: product.imageName || product.inputImages?.[0]?.name || '제품사진',
    source: 'factory-repair',
  });
  if (!repaired?.base64) return false;
  const oldKey = factoryImagePayloadFingerprint(product.imageBase64 || '');
  const newKey = factoryImagePayloadFingerprint(repaired.base64);
  if (!oldKey || oldKey === newKey) return false;
  const productKey = typeof factoryCurrentProductKey === 'function'
    ? factoryCurrentProductKey(factory)
    : String(product.productKey || product.productIdentityKey || '').trim();
  const currentRunId = String(
    product.currentRunId ||
    factory?.automation?.currentRunId ||
    factory?.goalRun?.currentRunId ||
    (typeof factoryCurrentWorkflowRunId === 'function' ? factoryCurrentWorkflowRunId(factory) : '') ||
    ''
  ).trim();
  product.imageBase64 = repaired.base64;
  product.imageMime = repaired.mime || product.imageMime || 'image/png';
  product.imagePreview = repaired.preview || `data:${product.imageMime};base64,${product.imageBase64}`;
  product.inputImageFingerprint = newKey;
  product.currentUploadImageFingerprint = newKey;
  product.productKey = product.productKey || productKey;
  product.productIdentityKey = product.productIdentityKey || productKey;
  product.currentRunId = product.currentRunId || currentRunId;
  if (!product.lockedInputImageFingerprint || product.lockedInputImageFingerprint === oldKey) {
    product.lockedInputImageFingerprint = newKey;
    product.lockedInputImageName = product.lockedInputImageName || repaired.name || product.imageName || '제품사진';
    product.lockedInputImageMime = product.imageMime;
    product.lockedInputImageSetAt = product.lockedInputImageSetAt || Date.now();
  }
  if (!Array.isArray(product.inputImages)) product.inputImages = [];
  const first = product.inputImages[0] && typeof product.inputImages[0] === 'object'
    ? product.inputImages[0]
    : { id: uid('factory_input'), name: repaired.name || '제품사진' };
  product.inputImages[0] = {
    ...first,
    base64: product.imageBase64,
    mime: product.imageMime,
    preview: product.imagePreview,
    name: first.name || repaired.name || '제품사진',
    inputImageFingerprint: newKey,
    sourceImageKey: newKey,
    productImageKey: newKey,
    productKey,
    factoryProductKey: productKey,
    scopeProductKey: productKey,
    currentRunId,
    generationRunId: currentRunId,
    lockedInput: true,
  };
  (factory.assets || []).forEach(asset => {
    if (!asset || !['hero', 'size', 'cuts'].includes(String(asset.stageId || ''))) return;
    if (asset.metadata?.visualValidation) {
      asset.metadata = { ...asset.metadata };
      delete asset.metadata.visualValidation;
    }
  });
  return true;
}

function factoryExplicitIdentityFromText(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const labeled = /(?:제품명|상품명|product\s*name)\s*[:：]\s*([^\n\r.。]+)/i.exec(raw);
  if (labeled?.[1]) return labeled[1].trim();
  const detailDone = /상세페이지\s*HTML\s*생성\s*완료\s*[:：]\s*(.+?)\s*(?:상세페이지|상세\s*페이지|HTML|html|$)/i.exec(raw);
  if (detailDone?.[1]) return detailDone[1].trim();
  const detailTitle = /^(.+?)\s*(?:상세페이지|상세\s*페이지)(?:\s|$|HTML|html)/i.exec(raw);
  if (detailTitle?.[1]) return detailTitle[1].trim();
  return '';
}

function factoryExplicitAssetIdentityKey(asset = {}) {
  const meta = asset?.metadata || {};
  const source = asset?.sourceMap || {};
  const explicitName = [
    meta.productName,
    meta.product_name,
    meta.productTitle,
    meta.product_title,
    meta.itemName,
    meta.item_name,
    source.productName,
    source.product_name,
    factoryExplicitIdentityFromText(asset?.prompt),
    factoryExplicitIdentityFromText(meta.prompt),
    factoryExplicitIdentityFromText(meta.promptText),
    factoryExplicitIdentityFromText(source.prompt),
    factoryExplicitIdentityFromText(asset?.title),
  ].map(value => String(value || '').trim()).find(Boolean);
  return factoryNormalizeIdentityText(explicitName);
}

function factoryAssetCompatibleWithCurrentProduct(asset = {}, identityKey = '') {
  if (!identityKey) return true;
  const explicitKey = factoryExplicitAssetIdentityKey(asset);
  if (!explicitKey) {
    const source = asset?.sourceMap || {};
    if (source.factoryProductInput === true && asset?.title) {
      return factoryIdentityKeysCompatible(asset.title, identityKey);
    }
    return false;
  }
  return factoryIdentityKeysCompatible(explicitKey, identityKey);
}

function factoryImagePayloadFingerprint(value = '') {
  let text = String(value || '');
  if (!text || text === '__stored_in_indexeddb__') return '';
  const dataUrl = /^data:image\/[^;,]+;base64,(.+)$/i.exec(text);
  if (dataUrl?.[1]) text = dataUrl[1];
  if (!text) return '';
  return `${text.length}:${text.slice(0, 72)}:${text.slice(-72)}`;
}

function factoryImageFingerprintLooksUsable(fingerprint = '') {
  const text = String(fingerprint || '').trim();
  const match = /^(\d+):/.exec(text);
  if (!match) return false;
  const byteishLength = Number(match[1] || 0);
  return byteishLength >= 256;
}

var factoryVisualValidationJobs = factoryVisualValidationJobs || new Map();
if (!(factoryVisualValidationJobs instanceof Map)) factoryVisualValidationJobs = new Map();
var factoryVisualValidationReported = factoryVisualValidationReported || new Map();
if (!(factoryVisualValidationReported instanceof Map)) factoryVisualValidationReported = new Map();
var factoryVisualValidationSignatureCache = factoryVisualValidationSignatureCache || new Map();
if (!(factoryVisualValidationSignatureCache instanceof Map)) factoryVisualValidationSignatureCache = new Map();
var factoryVisualValidationRenderTimer = factoryVisualValidationRenderTimer || null;
var factoryVisualValidationPromises = factoryVisualValidationPromises || new Map();
if (!(factoryVisualValidationPromises instanceof Map)) factoryVisualValidationPromises = new Map();
var factoryVisualValidationRenderBatches = factoryVisualValidationRenderBatches || new Map();
if (!(factoryVisualValidationRenderBatches instanceof Map)) factoryVisualValidationRenderBatches = new Map();
var factoryVisualValidationActiveOperationToken = String(factoryVisualValidationActiveOperationToken || '');

function factoryBeginVisualValidationRenderBatch() {
  const previousToken = factoryVisualValidationActiveOperationToken;
  const token = uid('visual-validation-operation');
  if (factoryVisualValidationRenderTimer) {
    clearTimeout(factoryVisualValidationRenderTimer);
    factoryVisualValidationRenderTimer = null;
  }
  factoryVisualValidationRenderBatches.set(token, { token, dirty: false });
  factoryVisualValidationActiveOperationToken = token;
  return { token, previousToken };
}

function factoryEndVisualValidationRenderBatch(context) {
  const token = String(context?.token || '');
  const batch = factoryVisualValidationRenderBatches.get(token) || null;
  if (factoryVisualValidationActiveOperationToken === token) {
    factoryVisualValidationActiveOperationToken = String(context?.previousToken || '');
  }
  factoryVisualValidationRenderBatches.delete(token);
  return batch?.dirty === true;
}

async function factoryWaitForVisualValidationOperation(operationToken = '') {
  const token = String(operationToken || '');
  if (!token) return;
  while (true) {
    const pending = [...factoryVisualValidationPromises.values()]
      .filter(record => record?.operationToken === token && record.promise)
      .map(record => record.promise);
    if (!pending.length) return;
    await Promise.allSettled(pending);
  }
}

function factoryPrimeCurrentAssetVisualValidation(factory = factoryRuntimeReadFactory()) {
  (Array.isArray(factory?.assets) ? factory.assets : []).forEach(asset => {
    factoryAssetVisualValidationState(asset, factory);
  });
}

function factoryVisualValidationJobActive(jobKey = '') {
  const startedAt = Number(factoryVisualValidationJobs.get(jobKey)) || 0;
  if (!startedAt) return false;
  if (Date.now() - startedAt > 8000) {
    factoryVisualValidationJobs.delete(jobKey);
    return false;
  }
  return true;
}

function factoryVisualValidationLogOnce(jobKey = '', message = '', type = 'info', stageId = '', factory) {
  const key = String(jobKey || '').trim();
  if (!key || !message) return;
  const now = Date.now();
  factoryVisualValidationReported.forEach((reportedAt, reportedKey) => {
    if (now - Number(reportedAt || 0) > 300000) factoryVisualValidationReported.delete(reportedKey);
  });
  if (factoryVisualValidationReported.has(key)) return;
  factoryVisualValidationReported.set(key, now);
  if (!factory || typeof factory !== 'object') return;
  factory.logStageId = factoryNormalizeStageScope(stageId) || '';
  factoryLog(message, type, factory);
}

function factoryScheduleVisualValidationRender(operationToken = '') {
  if (typeof render !== 'function') return;
  if (factoryVisualValidationRenderTimer) {
    clearTimeout(factoryVisualValidationRenderTimer);
    factoryVisualValidationRenderTimer = null;
  }
  const renderBatch = factoryVisualValidationRenderBatches.get(operationToken);
  if (renderBatch) {
    renderBatch.dirty = true;
    return;
  }
  if (state.projectBusy && state.workfileRestoreState) return;
  factoryVisualValidationRenderTimer = setTimeout(() => {
    factoryVisualValidationRenderTimer = null;
    try {
      render();
      clearRuntimeDegraded('visual-validation-render');
    } catch (error) {
      reportRuntimeDegradedOnce(
        'visual-validation-render',
        '이미지 검수 화면 갱신 저하 · 현재 작업 데이터는 유지됩니다',
        error,
      );
    }
  }, 180);
}

function factoryImageDataUrlFromBase64(base64 = '', mime = 'image/png') {
  const raw = String(base64 || '');
  if (!raw || raw === '__stored_in_indexeddb__') return '';
  if (/^data:image\//i.test(raw)) return raw;
  return `data:${mime || 'image/png'};base64,${raw}`;
}

function factoryComputeImageColorSignature(src = '') {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => finish({ ok: false, reason: '색상 검수 시간 초과' }), 2500);
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const imageSrc = String(src || '');
    if (!imageSrc || !/^data:image\//i.test(imageSrc)) {
      finish({ ok: false, reason: '이미지 원본 없음' });
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const maxSide = 64;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1));
        const width = Math.max(1, Math.round((img.naturalWidth || img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.naturalHeight || img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          finish({ ok: false, reason: '캔버스 생성 실패' });
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height).data;
        const buckets = Array.from({ length: 12 }, () => ({
          weight: 0,
          pixels: 0,
          satSum: 0,
          deltaSum: 0,
        }));
        let saturated = 0;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 24) continue;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const delta = max - min;
          const light = (max + min) / 2;
          const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * light - 1) || 1);
          total += 1;
          if (sat < 0.20 || light < 0.12 || light > 0.94) continue;
          let hue = 0;
          if (delta) {
            if (max === r) hue = ((g - b) / delta) % 6;
            else if (max === g) hue = (b - r) / delta + 2;
            else hue = (r - g) / delta + 4;
            hue *= 60;
            if (hue < 0) hue += 360;
          }
          const bucket = Math.max(0, Math.min(11, Math.floor(((hue + 15) % 360) / 30)));
          const weight = sat * (0.55 + Math.min(0.45, delta));
          buckets[bucket].weight += weight;
          buckets[bucket].pixels += 1;
          buckets[bucket].satSum += sat;
          buckets[bucket].deltaSum += delta;
          saturated += 1;
        }
        const ranked = buckets
          .map((item, bucket) => ({
            bucket,
            weight: item.weight,
            pixels: item.pixels,
            avgSat: item.pixels ? item.satSum / item.pixels : 0,
            avgDelta: item.pixels ? item.deltaSum / item.pixels : 0,
          }))
          .filter(item => item.weight > 0)
          .sort((a, b) => b.weight - a.weight);
        finish({
          ok: true,
          total,
          saturated,
          ratio: total ? saturated / total : 0,
          buckets: ranked.slice(0, 5),
          dominantBucket: ranked[0]?.bucket ?? null,
        });
      } catch(e) {
        finish({ ok: false, reason: e.message || String(e) });
      }
    };
    img.onerror = () => finish({ ok: false, reason: '이미지 로드 실패' });
    img.src = imageSrc;
  });
}

function factoryCachedImageColorSignature(src = '') {
  const cacheKey = factoryImagePayloadFingerprint(src);
  if (!cacheKey) return factoryComputeImageColorSignature(src);
  const cached = factoryVisualValidationSignatureCache.get(cacheKey);
  if (cached) return cached;
  const signature = factoryComputeImageColorSignature(src);
  factoryVisualValidationSignatureCache.set(cacheKey, signature);
  while (factoryVisualValidationSignatureCache.size > 64) {
    const oldestKey = factoryVisualValidationSignatureCache.keys().next().value;
    factoryVisualValidationSignatureCache.delete(oldestKey);
  }
  return signature;
}

function factoryColorBucketDistance(a, b) {
  const left = Number(a);
  const right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 99;
  const d = Math.abs(left - right);
  return Math.min(d, 12 - d);
}

function factoryHueBucketFamily(bucket) {
  const value = Number(bucket);
  if (!Number.isFinite(value)) return '';
  if (value === 0 || value === 1) return 'red';
  if (value === 2) return 'orange';
  if (value === 3) return 'yellow';
  if (value === 4 || value === 5) return 'green';
  if (value === 6) return 'cyan';
  if (value === 7 || value === 8) return 'blue';
  if (value === 9 || value === 10 || value === 11) return 'purple';
  return '';
}

function factoryStrongColorBuckets(signature = {}) {
  const buckets = Array.isArray(signature.buckets) ? signature.buckets : [];
  const strong = buckets.filter(item =>
    (item.avgSat || 0) >= 0.28 &&
    (item.avgDelta || 0) >= 0.24
  );
  return (strong.length ? strong : buckets).slice(0, 3);
}

function factoryColorFamilyProfile(signature = {}) {
  const buckets = Array.isArray(signature.buckets) ? signature.buckets : [];
  const rows = buckets
    .map(item => ({
      family: factoryHueBucketFamily(item.bucket),
      bucket: Number(item.bucket),
      weight: Number(item.weight) || 0,
      pixels: Number(item.pixels) || 0,
      avgSat: Number(item.avgSat) || 0,
      avgDelta: Number(item.avgDelta) || 0,
    }))
    .filter(item => {
      if (!item.family || item.weight <= 0 || item.pixels <= 0) return false;
      const coolFamily = ['purple', 'blue', 'cyan', 'green'].includes(item.family);
      const softWarmBackground =
        ['red', 'orange', 'yellow'].includes(item.family) &&
        item.bucket !== 0 &&
        item.avgDelta < 0.30 &&
        item.avgSat < 0.62;
      if (softWarmBackground) return false;
      return item.avgSat >= (coolFamily ? 0.12 : 0.18) &&
        item.avgDelta >= (coolFamily ? 0.08 : 0.14);
    });
  const totals = {};
  let totalWeight = 0;
  rows.forEach(item => {
    totals[item.family] = (totals[item.family] || 0) + item.weight;
    totalWeight += item.weight;
  });
  const ranked = Object.entries(totals)
    .map(([family, weight]) => ({
      family,
      weight,
      ratio: totalWeight ? weight / totalWeight : 0,
    }))
    .sort((a, b) => b.weight - a.weight);
  const strongFamilies = ranked
    .filter(item => item.ratio >= 0.12 || item.family === ranked[0]?.family)
    .map(item => item.family);
  const productFamilies = ranked
    .filter(item => {
      if (['orange', 'yellow'].includes(item.family)) return false;
      const minRatio = ['purple', 'blue', 'cyan', 'green'].includes(item.family) ? 0.015 : 0.025;
      return item.ratio >= minRatio;
    })
    .map(item => item.family);
  return {
    ranked,
    familySet: new Set(strongFamilies),
    productFamilySet: new Set(productFamilies),
    ratioOf(family) {
      const hit = ranked.find(item => item.family === family);
      return hit ? hit.ratio : 0;
    },
  };
}

const FACTORY_VISUAL_VALIDATION_VERSION = 10;

function factoryColorSignaturesCompatible(sourceSig = {}, assetSig = {}) {
  if (!sourceSig?.ok || !assetSig?.ok) return { ok: false, reason: '현재 원본 색상 검수 실패' };
  const sourceTop = factoryStrongColorBuckets(sourceSig);
  const assetTop = factoryStrongColorBuckets(assetSig);
  const sourceFamilies = new Set(sourceTop.map(item => factoryHueBucketFamily(item.bucket)).filter(Boolean));
  const assetFamilies = new Set(assetTop.map(item => factoryHueBucketFamily(item.bucket)).filter(Boolean));
  if (!sourceFamilies.size || !assetFamilies.size) {
    return { ok: false, reason: '현재 원본/결과 주요 색상군 확인 실패' };
  }
  const sourceProfile = factoryColorFamilyProfile(sourceSig);
  const assetProfile = factoryColorFamilyProfile(assetSig);
  const sourceProductFamilies = [...sourceProfile.productFamilySet];
  const assetProfileFamilies = assetProfile.familySet;
  const sourcePrimary = sourceProfile.ranked[0];
  if (
    sourcePrimary?.family &&
    sourcePrimary.ratio >= 0.55 &&
    assetProfile.ratioOf(sourcePrimary.family) < 0.12
  ) {
    return {
      ok: false,
      reason: `원본 대표 제품색(${sourcePrimary.family})이 결과에 부족함`,
    };
  }
  if (sourceProductFamilies.length) {
    const productColorMatched = sourceProductFamilies.some(family => assetProfileFamilies.has(family));
    if (!productColorMatched) {
      return {
        ok: false,
        reason: `제품색(${sourceProductFamilies.join(',')})이 결과 주요 색상에 없음`,
      };
    }
  }
  const sourceHasCoolProduct = ['purple', 'blue', 'cyan', 'green'].some(family => sourceProfile.productFamilySet.has(family));
  const sourceHasWarmProduct = ['red', 'orange'].some(family => sourceProfile.productFamilySet.has(family));
  const assetRedOrangeRatio = assetProfile.ratioOf('red') + assetProfile.ratioOf('orange');
  const sourceCoolRatio = ['purple', 'blue', 'cyan', 'green'].reduce((sum, family) => sum + sourceProfile.ratioOf(family), 0);
  const sourceWarmRatio = sourceProfile.ratioOf('red') + sourceProfile.ratioOf('orange');
  const assetCoolRatio = ['purple', 'blue', 'cyan', 'green'].reduce((sum, family) => sum + assetProfile.ratioOf(family), 0);
  if (
    (sourceHasCoolProduct || sourceCoolRatio >= 0.025) &&
    !sourceHasWarmProduct &&
    sourceWarmRatio < 0.18 &&
    assetRedOrangeRatio >= Math.max(0.18, assetCoolRatio * 1.8)
  ) {
    return {
      ok: false,
      reason: '현재 원본은 보라/차가운 계열인데 결과가 빨강/주황 계열로 치우침',
    };
  }
  const sourceCompareFamilies = sourceProfile.productFamilySet.size
    ? sourceProfile.productFamilySet
    : sourceFamilies;
  const assetCompareFamilies = assetProfile.productFamilySet.size
    ? assetProfile.productFamilySet
    : assetFamilies;
  const matched = [...sourceCompareFamilies].some(family => assetCompareFamilies.has(family));
  return matched
    ? { ok: true, reason: '주요 색상 일치' }
    : {
      ok: false,
      reason: `원본 제품색(${[...sourceCompareFamilies].join(',') || sourceTop.map(item => item.bucket).join(',')})과 결과 제품색(${[...assetCompareFamilies].join(',') || assetTop.map(item => item.bucket).join(',')}) 불일치`,
    };
}

function factoryCurrentProductImageDataUrl(factory = factoryRuntimeReadFactory()) {
  const payload = typeof factoryLockedInputImagePayload === 'function'
    ? factoryLockedInputImagePayload(factory)
    : null;
  if (payload?.base64) return factoryImageDataUrlFromBase64(payload.base64, payload.mime || 'image/png');
  if (payload?.preview && payload.preview !== '__stored_in_indexeddb__') return payload.preview;
  return '';
}

function factoryAssetVisualValidationState(asset = {}, factory = factoryRuntimeReadFactory(), options = {}) {
  const stageId = String(asset?.stageId || '');
  if (!['hero', 'size', 'cuts'].includes(stageId)) return { status: 'skip', ok: true };
  if (options.skipVisualValidation === true) return { status: 'skip', ok: true };
  const assetImage = factoryAssetDisplayImage(asset);
  const sourceImage = factoryCurrentProductImageDataUrl(factory);
  const sourceKey = options.currentInputKey || factoryCurrentInputImageFingerprint(factory);
  const assetKey = factoryImagePayloadFingerprint(assetImage);
  if (!assetImage || !assetKey) return { status: 'skip', ok: true };
  if (!sourceImage || !sourceKey) {
    const hasCurrentProductImage = typeof factoryHasDeclaredProductImage === 'function'
      ? factoryHasDeclaredProductImage(factory)
      : false;
    return hasCurrentProductImage
      ? { status: 'pending', ok: true, advisory: true, reason: '현재 원본 이미지 복구 대기' }
      : { status: 'skip', ok: true };
  }
  if (sourceKey === assetKey) {
    asset.metadata = {
      ...cloneData(asset.metadata || {}),
      visualValidation: {
        version: FACTORY_VISUAL_VALIDATION_VERSION,
        sourceKey,
        assetKey,
        status: 'ok',
        reason: '현재 원본 이미지와 동일',
        updatedAt: Date.now(),
      },
    };
    return { status: 'ok', ok: true };
  }
  const meta = asset.metadata?.visualValidation || {};
  const validationJobKey = `${asset.id || ''}|${sourceKey}|${assetKey}`;
  if (meta.version === FACTORY_VISUAL_VALIDATION_VERSION && meta.sourceKey === sourceKey && meta.assetKey === assetKey) {
    if (meta.status === 'ok') return { status: 'ok', ok: true };
    if (meta.status === 'mismatch') return { status: 'mismatch', ok: true, advisory: true, reason: meta.reason || '현재 원본과 색상 차이 있음' };
    if (meta.status === 'pending' && factoryVisualValidationJobActive(validationJobKey)) {
      return { status: 'pending', ok: true, advisory: true, reason: '현재 원본 색상 검수 중' };
    }
  }
  factoryScheduleAssetVisualValidation(asset, factory, { sourceImage, sourceKey, assetImage, assetKey });
  return { status: 'pending', ok: true, advisory: true, reason: '현재 원본 색상 검수 중' };
}

function factoryRefreshStageAfterVisualValidation(stageId = '', factory) {
  const normalizedStage = String(stageId || '');
  if (!['hero', 'size', 'cuts'].includes(normalizedStage)) return;
  const stage = factory?.stages?.[normalizedStage] || {};
  const rawStatus = String(stage.status || '').toLowerCase();
  if (!['running', 'done', 'idle', 'error'].includes(rawStatus)) return;
  const currentInputKey = factoryCurrentInputImageFingerprint(factory);
  const latestRunId = factoryStageLatestGenerationRunId(normalizedStage, factory);
  const relevantAssets = factoryAssetsForStage(normalizedStage, factory).filter(asset => {
    if (!factoryAssetHasDisplayImage(asset)) return false;
    if (latestRunId && factoryAssetGenerationRunId(asset) !== latestRunId) return false;
    if (currentInputKey && factoryAssetInputImageKey(asset) && factoryAssetInputImageKey(asset) !== currentInputKey) return false;
    return true;
  });
  if (!relevantAssets.length) return;
  const pending = relevantAssets.some(asset => asset.metadata?.visualValidation?.version === FACTORY_VISUAL_VALIDATION_VERSION && asset.metadata.visualValidation.status === 'pending');
  if (pending) return;
  const usableCount = factoryUsableAssetsForStage(normalizedStage, factory).length;
  if (usableCount > 0) {
    if (typeof factorySetStageStatus === 'function') {
      factorySetStageStatus(normalizedStage, 'done', `${usableCount}개 후보 표시 완료`, factory);
    } else if (factory.stages?.[normalizedStage]) {
      factory.stages[normalizedStage].status = 'done';
      factory.stages[normalizedStage].message = `${usableCount}개 후보 표시 완료`;
      factory.stages[normalizedStage].updatedAt = Date.now();
    }
    return;
  }
}

function factoryScheduleAssetVisualValidation(asset = {}, factory = factoryRuntimeReadFactory(), payload = {}) {
  if (!asset?.id || !payload.sourceImage || !payload.assetImage || !payload.sourceKey || !payload.assetKey) return;
  const assetId = String(asset.id);
  const jobKey = `${assetId}|${payload.sourceKey}|${payload.assetKey}`;
  const operationToken = factoryVisualValidationActiveOperationToken;
  const existingRecord = factoryVisualValidationPromises.get(jobKey);
  if (factoryVisualValidationJobActive(jobKey)) {
    if (existingRecord && operationToken) existingRecord.operationToken = operationToken;
    return existingRecord?.promise;
  }
  factoryVisualValidationJobs.set(jobKey, Date.now());
  asset.metadata = {
    ...cloneData(asset.metadata || {}),
    visualValidation: {
      version: FACTORY_VISUAL_VALIDATION_VERSION,
      sourceKey: payload.sourceKey,
      assetKey: payload.assetKey,
      status: 'pending',
      updatedAt: Date.now(),
    },
  };
  const validationRecord = { operationToken, promise: null };
  const validationPromise = Promise.all([
    factoryCachedImageColorSignature(payload.sourceImage),
    factoryCachedImageColorSignature(payload.assetImage),
  ]).then(([sourceSig, assetSig]) => {
    const receipt = factoryRuntimeUpdateOwnedFactory(
      'factory/runtime:completeVisualValidation',
      'factory-assets',
      liveFactory => {
        const liveAsset = (liveFactory.assets || []).find(item => item.id === assetId);
        if (!liveAsset) return false;
        const result = factoryColorSignaturesCompatible(sourceSig, assetSig);
        liveAsset.metadata = {
          ...cloneData(liveAsset.metadata || {}),
          visualValidation: {
            version: FACTORY_VISUAL_VALIDATION_VERSION,
            sourceKey: payload.sourceKey,
            assetKey: payload.assetKey,
            status: result.ok ? 'ok' : 'mismatch',
            reason: result.reason || '',
            sourceDominant: sourceSig?.dominantBucket ?? null,
            assetDominant: assetSig?.dominantBucket ?? null,
            updatedAt: Date.now(),
          },
        };
        if (!result.ok) {
          liveAsset.currentProductHidden = false;
          const stageLabel = typeof factoryStageLabel === 'function' ? factoryStageLabel(liveAsset.stageId) : liveAsset.stageId || '이미지';
          const title = String(liveAsset.title || liveAsset.id || '후보').trim().slice(0, 80);
          const reason = String(result.reason || '원본과 색상 차이 확인').trim().slice(0, 100);
          factoryVisualValidationLogOnce(
            jobKey,
            `색상 검수 완료 · ${stageLabel} · ${title} · ${reason} · 현재 작업 후보로 유지했습니다.`,
            'warn',
            liveAsset.stageId,
            liveFactory,
          );
        } else if (liveAsset.currentProductHidden) {
          liveAsset.currentProductHidden = false;
        }
        if (liveAsset.stageId && liveFactory.stages?.[liveAsset.stageId]?.status === 'running') {
          const visibleCount = typeof factoryUsableAssetsForStage === 'function'
            ? factoryUsableAssetsForStage(liveAsset.stageId, liveFactory).length
            : 1;
          if (visibleCount > 0) {
            liveFactory.stages[liveAsset.stageId].status = 'done';
            liveFactory.stages[liveAsset.stageId].message = `${visibleCount}개 후보 표시 완료`;
            liveFactory.stages[liveAsset.stageId].updatedAt = Date.now();
          }
        }
        factoryRefreshStageAfterVisualValidation(liveAsset.stageId, liveFactory);
        return true;
      },
    );
    if (!receipt.result) return;
    if (!validationRecord.operationToken && typeof scheduleSessionAssetSaveIfChanged === 'function') {
      scheduleSessionAssetSaveIfChanged();
    }
    factoryScheduleVisualValidationRender(validationRecord.operationToken);
  }).catch(() => {
    const receipt = factoryRuntimeUpdateOwnedFactory(
      'factory/runtime:completeVisualValidation',
      'factory-assets',
      liveFactory => {
        const liveAsset = (liveFactory.assets || []).find(item => item.id === assetId);
        if (!liveAsset) return false;
        liveAsset.metadata = {
          ...cloneData(liveAsset.metadata || {}),
          visualValidation: {
            version: FACTORY_VISUAL_VALIDATION_VERSION,
            sourceKey: payload.sourceKey,
            assetKey: payload.assetKey,
            status: 'check_failed',
            reason: '현재 원본 색상 검수 실패 - 후보 유지',
            updatedAt: Date.now(),
          },
        };
        liveAsset.currentProductHidden = false;
        const stageLabel = typeof factoryStageLabel === 'function' ? factoryStageLabel(liveAsset.stageId) : liveAsset.stageId || '이미지';
        const title = String(liveAsset.title || liveAsset.id || '후보').trim().slice(0, 80);
        factoryVisualValidationLogOnce(
          jobKey,
          `색상 검수 확인 실패 · ${stageLabel} · ${title} · 후보는 현재 작업 기준으로 유지했습니다.`,
          'warn',
          liveAsset.stageId,
          liveFactory,
        );
        factoryRefreshStageAfterVisualValidation(liveAsset.stageId, liveFactory);
        return true;
      },
    );
    if (!receipt.result) return;
    if (!validationRecord.operationToken && typeof scheduleSessionAssetSaveIfChanged === 'function') {
      scheduleSessionAssetSaveIfChanged();
    }
    factoryScheduleVisualValidationRender(validationRecord.operationToken);
  }).finally(() => {
    factoryVisualValidationJobs.delete(jobKey);
    if (factoryVisualValidationPromises.get(jobKey) === validationRecord) {
      factoryVisualValidationPromises.delete(jobKey);
    }
  });
  validationRecord.promise = validationPromise;
  factoryVisualValidationPromises.set(jobKey, validationRecord);
  return validationPromise;
}

function factoryHasDeclaredProductImage(factory = factoryRuntimeReadFactory()) {
  const product = factory?.product || {};
  return !!(
    product.imageBase64 ||
    (product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__') ||
    state.imageBase64 ||
    (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__') ||
    (Array.isArray(product.inputImages) && product.inputImages.some(img => img?.base64 || (img?.preview && img.preview !== '__stored_in_indexeddb__')))
  );
}

function factoryCurrentInputImageFingerprint(factory = factoryRuntimeReadFactory(), options = {}) {
  if (options.includeDerived !== true && typeof factoryLockedInputImageFingerprint === 'function') {
    const lockedKey = factoryLockedInputImageFingerprint(factory, {
      ...options,
      analysisImages: state.analysisImages,
    });
    if (lockedKey) return lockedKey;
  }
  const product = factory?.product || {};
  const includeDerived = options.includeDerived === true;
  const cuts = includeDerived ? (state.cuts || {}) : {};
  const productInputRows = Array.isArray(product.inputImages) ? product.inputImages : [];
  const productPreview = product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__' ? product.imagePreview : '';
  const appPreview = state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__' ? state.imagePreview : '';
  const hasStoredProductInput = productInputRows.some(img =>
    img?.hasImage &&
    !img?.base64 &&
    !(img?.preview && img.preview !== '__stored_in_indexeddb__') &&
    !img?.dataUrl &&
    !img?.image
  );
  const hasAppCurrentImage = !!(
    state.imageBase64 ||
    appPreview
  );
  const rows = [
    hasAppCurrentImage ? factoryCurrentVisualImageFingerprint(state.imageBase64, state.imageMime || 'image/png', appPreview) : '',
    productPreview ? factoryCurrentVisualImageFingerprint(product.imageBase64, product.imageMime || productInputRows[0]?.mime || 'image/png', productPreview) : '',
    ...productInputRows.map(img => factoryCurrentVisualImageFingerprint(img?.base64, img?.mime || product.imageMime || 'image/png', img?.preview || img?.dataUrl || img?.image)),
    (!productPreview && !hasAppCurrentImage && !hasStoredProductInput)
      ? factoryCurrentVisualImageFingerprint(product.imageBase64, product.imageMime || productInputRows[0]?.mime || 'image/png', '')
      : '',
    ...(includeDerived ? [
      factoryCurrentVisualImageFingerprint(cuts.workImageBase64, cuts.workImageMime || 'image/png', cuts.workImagePreview),
      factoryCurrentVisualImageFingerprint(cuts.sourceBase64, cuts.sourceMime || 'image/png', cuts.sourcePreview),
    ] : []),
  ];
  for (const row of rows) {
    const key = String(row || '').trim();
    if (key) return key;
  }
  return '';
}

function factoryAssetInputImageKey(asset = {}) {
  const meta = asset?.metadata || {};
  const source = asset?.sourceMap || {};
  return [
    asset?.inputImageFingerprint,
    meta.inputImageFingerprint,
    source.inputImageFingerprint,
    meta.inputImageKey,
    meta.sourceImageKey,
    meta.productImageKey,
    source.inputImageKey,
    source.sourceImageKey,
    source.productImageKey,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function factoryStageLatestGenerationRunId(stageId = '', factory = factoryRuntimeReadFactory()) {
  return String(factory?.stages?.[stageId]?.latestGenerationRunId || '').trim();
}

function factoryAssetGenerationRunId(asset = {}) {
  return [
    asset?.currentRunId,
    asset?.generationRunId,
    asset?.metadata?.currentRunId,
    asset?.metadata?.generationRunId,
    asset?.sourceMap?.currentRunId,
    asset?.sourceMap?.generationRunId,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function factoryCompletedAssetsForCurrentStageRun(stageId, factory = factoryRuntimeReadFactory()) {
  const stage = factory?.stages?.[stageId] || {};
  const latestRunId = factoryStageLatestGenerationRunId(stageId, factory);
  const completedItemCount = Math.max(0, Number(stage.completedItemCount) || 0);
  if (String(stage.status || '').trim().toLowerCase() !== 'done' || !latestRunId || completedItemCount < 1) return [];
  return factoryAssetsForStage(stageId, factory).filter(asset =>
    asset?.currentProductHidden !== true &&
    factoryAssetGenerationRunId(asset) === latestRunId &&
    factoryAssetHasDisplayImage(asset)
  );
}

function factoryCurrentProductKey(factory = factoryRuntimeReadFactory()) {
  const product = factory?.product || {};
  const productNameKey = factoryNormalizeIdentityText(product.userProductName || product.productName || '');
  const explicitKey = [
    product.currentProductKey,
    product.productKey,
    product.productIdentityKey,
    product.lockedProductKey,
  ].map(value => factoryNormalizeIdentityText(value || '')).find(key =>
    key && (!productNameKey || factoryIdentityKeysCompatible(key, productNameKey))
  );
  if (explicitKey) return explicitKey;
  const identityKey = factoryIdentityKey(factory) ||
    factoryCurrentProductIdentityMeta(factory).productIdentityKey ||
    factoryNormalizeIdentityText(factory?.product?.productName || state.productName || '');
  return factoryNormalizeIdentityText(identityKey);
}

function factoryCurrentStageRunId(stageId = '', factory = factoryRuntimeReadFactory()) {
  const stage = factory?.stages?.[stageId] || {};
  return String(
    stage.currentRunId ||
    stage.latestGenerationRunId ||
    factory?.archive?.stageRunIds?.[stageId] ||
    factory?.product?.currentRunId ||
    factory?.product?.generationRunId ||
    factory?.automation?.currentRunId ||
    factory?.goalRun?.currentRunId ||
    factory?.archive?.localRunId ||
    ''
  ).trim();
}

function factoryCurrentWorkflowRunId(factory = factoryRuntimeReadFactory()) {
  return String(
    factory?.automation?.currentRunId ||
    factory?.goalRun?.currentRunId ||
    factory?.product?.currentRunId ||
    factory?.product?.generationRunId ||
    factory?.archive?.localRunId ||
    ''
  ).trim();
}

function factoryStartNewWorkflowRun(factory) {
  if (!factory || typeof factory !== 'object') return '';
  factory.automation = factory.automation && typeof factory.automation === 'object' ? factory.automation : {};
  factory.goalRun = factory.goalRun && typeof factory.goalRun === 'object' ? factory.goalRun : {};
  factory.product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  factory.openMarketSync = factory.openMarketSync && typeof factory.openMarketSync === 'object'
    ? factory.openMarketSync
    : {};
  const runId = uid('factory_work_run');
  factory.automation.currentRunId = runId;
  factory.automation.currentRunStartedAt = Date.now();
  factory.goalRun.currentRunId = runId;
  factory.product.currentRunId = runId;
  factory.product.generationRunId = runId;
  factory.openMarketSync.cafe24RegistrationMode = 'create';
  factory.openMarketSync.cafe24RegistrationModeUserTouched = false;
  return runId;
}

function factoryCurrentJobKey(stageId = '', factory = factoryRuntimeReadFactory(), overrides = {}) {
  const normalizedStage = factoryNormalizeStageScope(stageId) || String(stageId || '').trim();
  const workspaceId = String(
    overrides.workspaceId ||
    overrides.currentProjectId ||
    factoryCurrentWorkspaceId(factory) ||
    ''
  ).trim();
  const productKey = factoryNormalizeIdentityText(
    overrides.productKey ||
    overrides.productIdentityKey ||
    factoryCurrentProductKey(factory)
  );
  const inputImageFingerprint = String(
    overrides.inputImageFingerprint ||
    overrides.inputImageKey ||
    overrides.sourceImageKey ||
    overrides.productImageKey ||
    factoryCurrentInputImageFingerprint(factory) ||
    ''
  ).trim();
  const currentRunId = String(
    overrides.currentRunId ||
    overrides.generationRunId ||
    factoryCurrentStageRunId(normalizedStage, factory) ||
    factoryCurrentWorkflowRunId(factory) ||
    factory?.product?.currentRunId ||
    factory?.product?.generationRunId ||
    ''
  ).trim();
  return {
    workspaceId,
    currentRunId,
    productKey,
    inputImageFingerprint,
    stageId: normalizedStage,
  };
}

function factoryAssetProductKey(asset = {}) {
  return factoryNormalizeIdentityText([
    asset?.productKey,
    asset?.metadata?.productKey,
    asset?.sourceMap?.productKey,
    asset?.metadata?.productIdentityKey,
    asset?.sourceMap?.productIdentityKey,
    asset?.metadata?.productName ? factoryNormalizeIdentityText(asset.metadata.productName) : '',
    asset?.sourceMap?.productName ? factoryNormalizeIdentityText(asset.sourceMap.productName) : '',
  ].map(value => String(value || '').trim()).find(Boolean) || '');
}

function factoryAssetCurrentRunId(asset = {}) {
  return [
    asset?.currentRunId,
    asset?.generationRunId,
    asset?.metadata?.currentRunId,
    asset?.metadata?.generationRunId,
    asset?.sourceMap?.currentRunId,
    asset?.sourceMap?.generationRunId,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function factoryAssetInputFingerprint(asset = {}) {
  return [
    asset?.inputImageFingerprint,
    asset?.metadata?.inputImageFingerprint,
    asset?.sourceMap?.inputImageFingerprint,
    asset?.metadata?.inputImageKey,
    asset?.sourceMap?.inputImageKey,
    asset?.metadata?.sourceImageKey,
    asset?.sourceMap?.sourceImageKey,
    asset?.metadata?.productImageKey,
    asset?.sourceMap?.productImageKey,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function factoryAssetJobKey(asset = {}) {
  return {
    workspaceId: factoryAssetWorkspaceId(asset),
    currentRunId: factoryAssetCurrentRunId(asset),
    productKey: factoryAssetProductKey(asset),
    inputImageFingerprint: factoryAssetInputFingerprint(asset),
    stageId: factoryNormalizeStageScope(asset?.stageId || asset?.metadata?.stageId || asset?.sourceMap?.stageId || asset?.sourceMap?.importedStageId || '') || String(asset?.stageId || '').trim(),
  };
}

function factoryJobProductKeysCompatible(actualKey = '', expectedKey = '') {
  const actual = factoryNormalizeIdentityText(actualKey);
  const expected = factoryNormalizeIdentityText(expectedKey);
  if (!actual || !expected) return false;
  return actual === expected;
}

function factoryJobKeyMismatch(actual = {}, expected = {}, options = {}) {
  const mismatches = [];
  const actualRunId = String(actual.currentRunId || '').trim();
  const expectedRunId = String(expected.currentRunId || '').trim();
  const actualWorkspaceId = String(actual.workspaceId || '').trim();
  const expectedWorkspaceId = String(expected.workspaceId || '').trim();
  const actualProductKey = factoryNormalizeIdentityText(actual.productKey || '');
  const expectedProductKey = factoryNormalizeIdentityText(expected.productKey || '');
  const actualInput = String(actual.inputImageFingerprint || '').trim();
  const expectedInput = String(expected.inputImageFingerprint || '').trim();
  const actualStage = factoryNormalizeStageScope(actual.stageId || '') || String(actual.stageId || '').trim();
  const expectedStage = factoryNormalizeStageScope(expected.stageId || '') || String(expected.stageId || '').trim();
  const requireRunId = options.requireRunId !== false;
  const strictRunId = options.strictRunId !== false;
  const allowMissingActualFields = options.allowMissingActualFields !== false;

  if (expectedWorkspaceId && actualWorkspaceId && actualWorkspaceId !== expectedWorkspaceId) mismatches.push('workspaceId');
  if (requireRunId && expectedRunId && !actualRunId) mismatches.push('currentRunId');
  else if (strictRunId && expectedRunId && actualRunId && expectedRunId !== actualRunId) mismatches.push('currentRunId');
  if (expectedProductKey && actualProductKey && !factoryJobProductKeysCompatible(actualProductKey, expectedProductKey)) mismatches.push('productKey');
  if (expectedInput && actualInput && actualInput !== expectedInput) mismatches.push('inputImageFingerprint');
  if (expectedStage && actualStage && actualStage !== expectedStage) mismatches.push('stageId');
  if (!allowMissingActualFields) {
    if (!actualWorkspaceId && expectedWorkspaceId) mismatches.push('workspaceId');
    if (!actualProductKey && expectedProductKey) mismatches.push('productKey');
    if (!actualInput && expectedInput) mismatches.push('inputImageFingerprint');
    if (!actualStage && expectedStage) mismatches.push('stageId');
  }
  return mismatches;
}

function factoryAssetMatchesCurrentJob(asset = {}, stageId = '', factory = factoryRuntimeReadFactory(), overrides = {}) {
  const targetStage = factoryNormalizeStageScope(stageId || asset?.stageId || '') || String(stageId || asset?.stageId || '').trim();
  const isScopedStage = ['hero', 'size', 'cuts', 'detail', 'options'].includes(targetStage);
  if (!isScopedStage) {
    return { ok: true, mismatches: [], actual: factoryAssetJobKey(asset), expected: factoryCurrentJobKey(targetStage, factory, overrides) };
  }
  const strictScope = overrides.strictScope === true || overrides.strictRunId === true || overrides.enforceCurrentJob === true;
  const expected = factoryCurrentJobKey(targetStage, factory, overrides);
  const actual = factoryAssetJobKey({ ...asset, stageId: asset?.stageId || targetStage });
  const missingExpected = [];
  if (strictScope) {
    if (!expected.workspaceId) missingExpected.push('workspaceId');
    if (!expected.currentRunId) missingExpected.push('currentRunId');
    if (!expected.productKey) missingExpected.push('productKey');
    if (!expected.inputImageFingerprint) missingExpected.push('inputImageFingerprint');
    if (!expected.stageId) missingExpected.push('stageId');
  }
  if ((overrides.requireExpectedRunId === true || overrides.strictRunId === true) && !expected.currentRunId) missingExpected.push('currentRunId');
  if (overrides.requireExpectedWorkspaceId === true && !expected.workspaceId) missingExpected.push('workspaceId');
  if (overrides.requireExpectedProductKey === true && !expected.productKey) missingExpected.push('productKey');
  if (overrides.requireExpectedInputFingerprint === true && !expected.inputImageFingerprint) missingExpected.push('inputImageFingerprint');
  if (overrides.requireExpectedStageId === true && !expected.stageId) missingExpected.push('stageId');
  if (missingExpected.length) {
    return { ok: false, mismatches: missingExpected, actual, expected, missingExpected: true };
  }
  const allowMissingActualFields = overrides.allowMissingActualFields !== undefined
    ? overrides.allowMissingActualFields
    : !strictScope;
  const mismatches = factoryJobKeyMismatch(actual, expected, {
    ...overrides,
    allowMissingActualFields,
    strictRunId: overrides.strictRunId ?? true,
  });
  return { ok: !mismatches.length, mismatches, actual, expected };
}

function factoryPreviousAssetsForStage(stageId = '', factory = factoryRuntimeReadFactory()) {
  const normalizedStage = factoryNormalizeStageScope(stageId) || String(stageId || '').trim();
  return (Array.isArray(factory.previousAssets) ? factory.previousAssets : [])
    .filter(asset =>
      !asset?.rejected &&
      !factoryAssetLooksLocalFallbackCandidate(asset) &&
      (!normalizedStage || String(asset?.stageId || '') === normalizedStage)
    );
}

function factoryAssetSupersededRunId(asset = {}) {
  return [
    asset?.supersededByGenerationRunId,
    asset?.metadata?.supersededByGenerationRunId,
    asset?.sourceMap?.supersededByGenerationRunId,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function factoryAssetCompatibleWithLatestStageRun(asset = {}, factory = factoryRuntimeReadFactory(), options = {}) {
  const stageId = String(asset?.stageId || '');
  if (!['hero', 'size', 'cuts', 'detail'].includes(stageId)) return true;
  const latestRunId = typeof options.latestRunId === 'string'
    ? options.latestRunId
    : factoryStageLatestGenerationRunId(stageId, factory);
  if (!latestRunId) return true;
  if (options.strictLatestRun !== true) return true;
  return factoryAssetGenerationRunId(asset) === latestRunId;
}

function factoryAssetCompatibleWithCurrentInputImage(asset = {}, factory = factoryRuntimeReadFactory(), options = {}) {
  const stageId = String(asset?.stageId || '');
  if (!['hero', 'size', 'cuts', 'detail'].includes(stageId)) return true;
  const currentKey = typeof options.currentInputKey === 'string'
    ? options.currentInputKey
    : factoryCurrentInputImageFingerprint(factory);
  const assetKey = factoryAssetInputImageKey(asset);
  if (!currentKey) {
    const hasCurrentProductImage = typeof options.hasDeclaredProductImage === 'boolean'
      ? options.hasDeclaredProductImage
      : factoryHasDeclaredProductImage(factory);
    if (!hasCurrentProductImage) return true;
    return false;
  }
  if (!assetKey) return false;
  return assetKey === currentKey;
}

function factoryFindAvailableProductImage(factory = factoryRuntimeReadFactory(), options = {}) {
  const includeCurrent = options.includeCurrent !== false;
  const requireBase64 = options.requireBase64 === true;
  const allowDerived = options.allowDerived === true;
  const product = factory?.product || {};
  const productName = String(product.productName || state.productName || '').trim();
  const identityKey = factoryNormalizeIdentityText(productName);
  const pick = payload => {
    if (!payload?.preview && payload?.base64) {
      payload.preview = `data:${payload.mime || 'image/png'};base64,${payload.base64}`;
    }
    if (!payload?.preview) return null;
    if (requireBase64 && !payload.base64) return null;
    return payload;
  };

  if (includeCurrent) {
    const productPreview = product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__' ? product.imagePreview : '';
    const hasStoredProductInput = Array.isArray(product.inputImages) && product.inputImages.some(img =>
      img?.hasImage &&
      !img?.base64 &&
      !(img?.preview && img.preview !== '__stored_in_indexeddb__') &&
      !img?.dataUrl &&
      !img?.image
    );
    if (productPreview) {
      const currentFactory = factoryImagePayloadFromCurrentVisual(product.imageBase64, product.imageMime, productPreview, {
        preview: productPreview,
        name: product.imageName || product.inputImages?.[0]?.name || '제품사진',
        source: 'factory',
      });
      const pickedFactory = pick(currentFactory);
      if (pickedFactory) return pickedFactory;
    }

    const firstCurrentInput = Array.isArray(product.inputImages)
      ? product.inputImages.find(img => img?.base64 || (img?.preview && img.preview !== '__stored_in_indexeddb__') || img?.dataUrl || img?.image)
      : null;
    const currentInputPayload = firstCurrentInput
      ? factoryImagePayloadFromCurrentVisual(firstCurrentInput.base64, firstCurrentInput.mime || product.imageMime || 'image/png', firstCurrentInput.preview || firstCurrentInput.dataUrl || firstCurrentInput.image, {
        preview: firstCurrentInput.preview || firstCurrentInput.dataUrl || firstCurrentInput.image,
        name: firstCurrentInput.name || product.imageName || '제품사진',
        source: 'factory-input',
      })
      : null;
    const pickedInput = pick(currentInputPayload);
    if (pickedInput) return pickedInput;

    const currentApp = factoryImagePayloadFromCurrentVisual(state.imageBase64, state.imageMime, state.imagePreview, {
      preview: state.imagePreview,
      name: state.imageName || '제품사진',
      source: 'app',
    });
    const pickedApp = pick(currentApp);
    if (pickedApp) return pickedApp;

    if (!productPreview && !hasStoredProductInput) {
      const currentFactory = factoryImagePayloadFromCurrentVisual(product.imageBase64, product.imageMime, '', {
        name: product.imageName || product.inputImages?.[0]?.name || '제품사진',
        source: 'factory',
      });
      const pickedFactory = pick(currentFactory);
      if (pickedFactory) return pickedFactory;
    }
  }

  const analysisImage = (Array.isArray(state.analysisImages) ? state.analysisImages : []).find(img =>
    factoryImageRecordCompatibleWithCurrentProduct(img, identityKey) &&
    (img?.base64 || displayableImageSrc(img?.preview || img?.dataUrl || img?.image))
  );
  if (analysisImage) {
    const payload = factoryImagePayloadFromCurrentVisual(analysisImage.base64, analysisImage.mime, analysisImage.preview || analysisImage.dataUrl || analysisImage.image, {
      preview: analysisImage.preview || analysisImage.dataUrl || analysisImage.image,
      name: analysisImage.name || '제품사진',
      source: 'analysis',
    });
    const picked = pick(payload);
    if (picked) return picked;
  }

  const market = state.compPage?.marketScrape || {};
  const marketPayload = factoryImagePayloadFromCurrentVisual(market.imageBase64, market.imageMime, market.imagePreview, {
    preview: market.imagePreview,
    name: market.imageName || '제품사진',
    source: 'market',
  });
  const pickedMarket = pick(marketPayload);
  if (pickedMarket) return pickedMarket;

  if (allowDerived) {
    const cuts = state.cuts || {};
    const cutImageRows = [
      { base64: cuts.workImageBase64, mime: cuts.workImageMime, preview: cuts.workImagePreview, name: '이미지컷 작업 이미지', source: 'cuts-work' },
      { base64: cuts.sourceBase64, mime: cuts.sourceMime, preview: cuts.sourcePreview, name: '이미지컷 샘플 이미지', source: 'cuts-source' },
    ];
    for (const row of cutImageRows) {
      const payload = factoryImagePayloadFromCurrentVisual(row.base64, row.mime, row.preview, {
        preview: row.preview,
        name: row.name,
        source: row.source,
      });
      const picked = pick(payload);
      if (picked) return picked;
    }
  }

  if (factoryHasDeclaredProductImage(factory)) return null;

  const stageOrder = ['input', 'hero', 'cuts', 'size', 'options', 'detail'];
  const stageAssets = stageOrder.flatMap(stageId => [
    ...factorySelectedAssets(stageId, factory),
    ...factoryAssetsForStage(stageId, factory),
  ]);
  const seenAssetIds = new Set();
  for (const asset of stageAssets) {
    if (!asset || seenAssetIds.has(asset.id)) continue;
    seenAssetIds.add(asset.id);
    if (!factoryAssetCompatibleWithCurrentProduct(asset, identityKey)) continue;
    const payload = factoryImagePayloadFromSrc(factoryAssetDisplayImage(asset), {
      mime: asset.mime || asset.metadata?.mime || 'image/png',
      name: asset.title || `${factoryStageLabel(asset.stageId || 'hero')} 결과`,
      source: `asset:${asset.stageId || ''}`,
    });
    const picked = pick(payload);
    if (picked) return picked;
  }
  return null;
}

function factoryProductPreview(factory = factoryRuntimeReadFactory()) {
  const lockedPayload = typeof factoryLockedInputImagePayload === 'function'
    ? factoryLockedInputImagePayload(factory)
    : null;
  if (lockedPayload?.preview && lockedPayload.preview !== '__stored_in_indexeddb__') return lockedPayload.preview;
  if (lockedPayload?.base64) return `data:${lockedPayload.mime || 'image/png'};base64,${lockedPayload.base64}`;
  const payload = typeof currentProductImagePayload === 'function'
    ? currentProductImagePayload({ allowDerived: false, prefer: 'app' })
    : null;
  if (payload?.preview && payload.preview !== '__stored_in_indexeddb__') return payload.preview;
  if (payload?.base64) return `data:${payload.mime || 'image/png'};base64,${payload.base64}`;
  const productInputs = Array.isArray(factory.product?.inputImages) ? factory.product.inputImages : [];
  const firstInput = productInputs.find(img => img?.base64 || (img?.preview && img.preview !== '__stored_in_indexeddb__'));
  if (firstInput?.preview && firstInput.preview !== '__stored_in_indexeddb__') return firstInput.preview;
  if (firstInput?.base64) return `data:${firstInput.mime || factory.product.imageMime || 'image/png'};base64,${firstInput.base64}`;
  if (factory.product.imagePreview && factory.product.imagePreview !== '__stored_in_indexeddb__') return factory.product.imagePreview;
  if (factory.product.imageBase64) return `data:${factory.product.imageMime || 'image/png'};base64,${factory.product.imageBase64}`;
  if (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__') return state.imagePreview;
  if (state.analysisImages?.[0]) return analysisImageSrc(state.analysisImages[0]);
  const recovered = factoryFindAvailableProductImage(factory, { includeCurrent: false });
  if (recovered?.preview) return recovered.preview;
  return '';
}

function currentProductImagePayload(options = {}) {
  const hasDirectAppImage = !!(
    state.imageBase64 ||
    (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__')
  );
  const preferApp = options.prefer === 'app' || (options.prefer !== 'factory' && hasDirectAppImage);
  const factoryRoot = options.factory || factoryRuntimeReadFactory();
  const factory = factoryRoot.product || {};
  let factoryInputHydrationPending = false;
  const fromApp = () => {
    const identityKey = factoryNormalizeIdentityText(factory.productName || state.productName || '');
    if (state.imageBase64 || (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__')) {
      const payload = factoryImagePayloadFromCurrentVisual(state.imageBase64, state.imageMime || 'image/png', state.imagePreview, {
        name: state.analysisImages?.[0]?.name || state.imageName || '제품사진',
        source: 'app',
      });
      if (payload?.base64) return payload;
      const mime = typeof inferImageMimeFromBase64 === 'function'
        ? inferImageMimeFromBase64(state.imageBase64, state.imageMime || 'image/png')
        : (state.imageMime || 'image/png');
      const base64 = typeof imageBase64Only === 'function' ? imageBase64Only(state.imageBase64) : state.imageBase64;
      return {
        base64,
        mime,
        preview: (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__')
          ? state.imagePreview
          : `data:${mime};base64,${base64}`,
        name: state.analysisImages?.[0]?.name || state.imageName || '제품사진',
      };
    }
    const analysisImage = (state.analysisImages || []).find(img =>
      factoryImageRecordCompatibleWithCurrentProduct(img, identityKey) &&
      (img?.base64 || img?.preview || img?.dataUrl || img?.image)
    );
    if (analysisImage?.base64) {
      const payload = factoryImagePayloadFromCurrentVisual(analysisImage.base64, analysisImage.mime || 'image/png', analysisImage.preview || analysisImage.dataUrl || analysisImage.image, {
        name: analysisImage.name || '제품사진',
        source: 'analysis',
      });
      if (payload?.base64) return payload;
      const mime = typeof inferImageMimeFromBase64 === 'function'
        ? inferImageMimeFromBase64(analysisImage.base64, analysisImage.mime || 'image/png')
        : (analysisImage.mime || 'image/png');
      const base64 = typeof imageBase64Only === 'function' ? imageBase64Only(analysisImage.base64) : analysisImage.base64;
      return {
        base64,
        mime,
        preview: analysisImage.preview || `data:${mime};base64,${base64}`,
        name: analysisImage.name || '제품사진',
      };
    }
    return null;
  };
  const fromFactory = () => {
    const factoryPreview = factory.imagePreview && factory.imagePreview !== '__stored_in_indexeddb__' ? factory.imagePreview : '';
    const hasAppCurrentImage = !!(
      state.imageBase64 ||
      (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__')
    );
    if (factoryPreview) {
      const factoryVisual = factoryImagePayloadFromCurrentVisual(factory.imageBase64, factory.imageMime || 'image/png', factoryPreview, {
        preview: factoryPreview,
        name: factory.imageName || factory.inputImages?.[0]?.name || '제품사진',
        source: 'factory',
      });
      if (factoryVisual?.base64) return factoryVisual;
    }

    const firstInput = Array.isArray(factory.inputImages)
      ? factory.inputImages.find(img => img?.base64 || (img?.preview && img.preview !== '__stored_in_indexeddb__'))
      : null;
    const hasStoredFactoryInput = Array.isArray(factory.inputImages) && factory.inputImages.some(img =>
      img?.hasImage &&
      !img?.base64 &&
      !(img?.preview && img.preview !== '__stored_in_indexeddb__') &&
      !img?.dataUrl &&
      !img?.image
    );
    factoryInputHydrationPending = hasStoredFactoryInput || factory.imagePreview === '__stored_in_indexeddb__';
    const rawBase64 = firstInput?.base64 || '';
    const rawPreview = (firstInput?.preview && firstInput.preview !== '__stored_in_indexeddb__')
      ? firstInput.preview
      : '';
    const payload = factoryImagePayloadFromCurrentVisual(rawBase64, firstInput?.mime || factory.imageMime || 'image/png', rawPreview, {
      preview: rawPreview,
      name: firstInput?.name || factory.imageName || '제품사진',
      source: firstInput ? 'factory-input' : 'factory',
    });
    if (payload?.base64) return payload;
    if (!factoryPreview && !hasAppCurrentImage && !hasStoredFactoryInput) {
      const factoryBase = factoryImagePayloadFromCurrentVisual(factory.imageBase64, factory.imageMime || 'image/png', '', {
        name: factory.imageName || firstInput?.name || '제품사진',
        source: 'factory',
      });
      if (factoryBase?.base64) return factoryBase;
    }
    return null;
  };
  const fromCuts = () => {
    if (options.allowDerived !== true) return null;
    const c = state.cuts || {};
    const candidates = [
      { base64: c.workImageBase64, mime: c.workImageMime, preview: c.workImagePreview, name: '이미지컷 작업 이미지' },
      { base64: c.sourceBase64, mime: c.sourceMime, preview: c.sourcePreview, name: '이미지컷 샘플 이미지' },
    ];
    for (const item of candidates) {
      const payload = factoryImagePayloadFromCurrentVisual(item.base64, item.mime || 'image/png', item.preview, {
        name: item.name,
        source: 'cuts',
      });
      if (payload?.base64) return payload;
    }
    return null;
  };
  const allowAssetFallback = options.allowAssetFallback === true;
  const fromAvailableAssets = () => allowAssetFallback ? factoryFindAvailableProductImage(factoryRoot, {
    includeCurrent: false,
    requireBase64: true,
    allowDerived: options.allowDerived === true,
  }) : null;
  if (preferApp) return fromApp() || fromFactory() || fromCuts() || fromAvailableAssets();
  const factoryPayload = fromFactory();
  if (factoryPayload) return factoryPayload;
  if (factoryInputHydrationPending) return null;
  return fromApp() || fromCuts() || fromAvailableAssets();
}

function syncProductImageAcrossWorkspaces(options = {}) {
  if (!options.factory) {
    const receipt = factoryRuntimeUpdateOwnedFactory(
      'factory/runtime:syncProductImageAcrossWorkspaces',
      'factory-assets',
      draft => syncProductImageAcrossWorkspaces({ ...options, factory: draft, save: false }),
    );
    const changed = receipt.result === true;
    const committedFactory = receipt.snapshot?.factory || null;
    const committedProduct = committedFactory?.product || null;
    if (
      changed &&
      options.preserveFactoryAssets !== true &&
      options.archiveInput !== false &&
      committedProduct?.lockedInputImageFingerprint &&
      committedProduct?.imageBase64 &&
      typeof factoryArchiveCurrentInputImage === 'function'
    ) {
      factoryArchiveCurrentInputImage({
        base64: committedProduct.imageBase64,
        mime: committedProduct.imageMime || 'image/png',
        preview: committedProduct.imagePreview || '',
        name: committedProduct.imageName || '제품사진',
        inputImageFingerprint: committedProduct.lockedInputImageFingerprint,
        uploadedAt: committedProduct.lockedInputImageSetAt || Date.now(),
      }, { reason: 'sync-product-image' }).catch(() => {});
    }
    if (changed && options.save === true && typeof saveLastWorkNow === 'function') {
      saveLastWorkNow({ sync: false });
    }
    return changed;
  }
  const payload = currentProductImagePayload(options);
  if (!payload?.base64) return false;
  const preserveFactoryAssets = options.preserveFactoryAssets === true;
  const payloadBase64 = typeof imageBase64Only === 'function' ? imageBase64Only(payload.base64) : payload.base64;
  const payloadMime = typeof inferImageMimeFromBase64 === 'function'
    ? inferImageMimeFromBase64(payloadBase64, payload.mime || 'image/png')
    : (payload.mime || 'image/png');
  const payloadPreview = payload.preview && payload.preview !== '__stored_in_indexeddb__'
    ? payload.preview
    : `data:${payloadMime};base64,${payloadBase64}`;
  const payloadKey = factoryImagePayloadFingerprint(payloadBase64);
  const payloadSource = String(payload.source || '').trim();
  const shouldLockFactoryInput = options.lockInput === true ||
    /^(app|app-current|factory|factory-input|factory-product|factory-upload|current-upload|local-archive-input|stored-product-candidate)$/i.test(payloadSource);
  let changed = false;
  if (options.syncState !== false) {
    const stateKey = factoryImagePayloadFingerprint(state.imageBase64 || '');
    if (!state.imageBase64 || (payloadKey && stateKey && stateKey !== payloadKey)) {
      state.imageBase64 = payloadBase64;
      state.imageMime = payloadMime || state.imageMime || 'image/png';
      state.imagePreview = payloadPreview;
      changed = true;
    } else if (!state.imagePreview || state.imagePreview === '__stored_in_indexeddb__') {
      state.imagePreview = `data:${state.imageMime || payloadMime || 'image/png'};base64,${state.imageBase64}`;
      changed = true;
    }
    if (state.imageBase64 && typeof inferImageMimeFromBase64 === 'function') {
      const actualStateMime = inferImageMimeFromBase64(state.imageBase64, state.imageMime || payloadMime || 'image/png');
      if (actualStateMime && actualStateMime !== state.imageMime) {
        state.imageMime = actualStateMime;
        changed = true;
      }
    }
    const previousAnalysisImages = Array.isArray(state.analysisImages) ? state.analysisImages : [];
    const currentAnalysisImage = {
      base64: payloadBase64,
      mime: payloadMime || state.imageMime || 'image/png',
      preview: payloadPreview,
      name: payload.name || '제품사진',
    };
    const sameAnalysisImages = previousAnalysisImages.filter(img => {
      const imgKey = factoryImagePayloadFingerprint(img?.base64 || img?.preview || img?.dataUrl || img?.image || '');
      return imgKey && payloadKey && imgKey === payloadKey;
    });
    state.analysisImages = [currentAnalysisImage, ...sameAnalysisImages.filter(img => img?.base64 !== payloadBase64)].slice(0, 3);
    if (previousAnalysisImages.length !== state.analysisImages.length || previousAnalysisImages[0]?.base64 !== payloadBase64) {
      changed = true;
    }
  }
  const factory = options.factory;
  const factoryKey = factoryImagePayloadFingerprint(factory.product.imageBase64 || '');
  if (!factory.product.imageBase64 || (payloadKey && factoryKey && factoryKey !== payloadKey)) {
    factory.product.imageBase64 = payloadBase64;
    factory.product.imageMime = payloadMime || 'image/png';
    factory.product.imagePreview = payloadPreview;
    factory.product.inputImages = [{
      id: uid('factory_input'),
      name: payload.name || '제품사진',
      base64: payloadBase64,
      mime: factory.product.imageMime,
      preview: factory.product.imagePreview,
      inputImageFingerprint: payloadKey,
      sourceImageKey: payloadKey,
      productImageKey: payloadKey,
      currentRunId: factory.product.currentRunId || factory.automation?.currentRunId || factory.goalRun?.currentRunId || '',
      productKey: typeof factoryCurrentProductKey === 'function' ? factoryCurrentProductKey(factory) : '',
      hasImage: true,
      source: payloadSource || 'current-product-image',
    }];
    if (!preserveFactoryAssets) {
      const movedAssetIds = new Set();
      (factory.assets || []).forEach(asset => {
        if (!asset || !['hero', 'size', 'cuts'].includes(String(asset.stageId || ''))) return;
        const assetSourceKey = typeof factoryAssetInputImageKey === 'function' ? factoryAssetInputImageKey(asset) : '';
        if (!payloadKey || !assetSourceKey || assetSourceKey !== payloadKey) {
          asset.used = false;
          if (typeof factoryRememberPreviousAsset === 'function') {
            factoryRememberPreviousAsset(asset, '현재 시작 이미지와 다른 이전 생성 결과', factory);
            movedAssetIds.add(asset.id);
          } else {
            asset.currentProductHidden = true;
            asset.metadata = {
              ...cloneData(asset.metadata || {}),
              staleProductImageKey: assetSourceKey || 'missing',
              hiddenReason: '현재 시작 이미지와 다른 이전 생성 결과',
            };
          }
        }
        if (asset.metadata?.visualValidation) {
          asset.metadata = { ...asset.metadata };
          delete asset.metadata.visualValidation;
        }
      });
      if (movedAssetIds.size) {
        factory.assets = (factory.assets || []).filter(asset => !movedAssetIds.has(asset?.id));
      }
    }
    changed = true;
  } else if (!factory.product.imagePreview || factory.product.imagePreview === '__stored_in_indexeddb__') {
    factory.product.imagePreview = payload.preview || `data:${factory.product.imageMime || payload.mime || 'image/png'};base64,${factory.product.imageBase64}`;
    changed = true;
  }
  if (shouldLockFactoryInput && payloadKey && typeof factoryStampLockedInputImage === 'function') {
    const previousLock = factory.product.lockedInputImageFingerprint || '';
    const stampedKey = factoryStampLockedInputImage(factory, {
      ...payload,
      base64: payloadBase64,
      mime: payloadMime || payload.mime || 'image/png',
      preview: payloadPreview,
      name: payload.name || factory.product.imageName || '제품사진',
    }, {
      name: payload.name || factory.product.imageName || '제품사진',
      setAt: factory.product.lockedInputImageSetAt || Date.now(),
    });
    if (stampedKey && stampedKey !== previousLock) changed = true;
    if (stampedKey && !preserveFactoryAssets && !options.factory
        && options.archiveInput !== false && typeof factoryArchiveCurrentInputImage === 'function') {
      factoryArchiveCurrentInputImage({
        base64: payloadBase64,
        mime: payloadMime || payload.mime || 'image/png',
        preview: payloadPreview,
        name: payload.name || factory.product.imageName || '제품사진',
        inputImageFingerprint: stampedKey,
        uploadedAt: factory.product.lockedInputImageSetAt || Date.now(),
      }, { reason: 'sync-product-image' }).catch(() => {});
    }
  }
  if (factory.product.imageBase64 && typeof inferImageMimeFromBase64 === 'function') {
    const actualFactoryMime = inferImageMimeFromBase64(factory.product.imageBase64, factory.product.imageMime || payloadMime || 'image/png');
    if (actualFactoryMime && actualFactoryMime !== factory.product.imageMime) {
      factory.product.imageMime = actualFactoryMime;
      changed = true;
    }
  }
  if (options.syncState !== false && typeof ensureCompMarketScrapeState === 'function') {
    try {
      const market = ensureCompMarketScrapeState();
      if (market && (!market.imageBase64 || market.defaultImageSeeded === true)) {
        market.imageBase64 = payload.base64;
        market.imageMime = payload.mime || 'image/png';
        market.imageName = payload.name || '제품사진';
        market.imagePreview = payload.preview || `data:${market.imageMime};base64,${payload.base64}`;
        market.defaultImageSeeded = true;
        changed = true;
      }
    } catch(e) {}
  }
  if (changed && options.save === true && typeof saveLastWorkNow === 'function') saveLastWorkNow({ sync: false });
  return changed;
}

function factoryStageStatusClass(status) {
  if (status === 'done') return 'done';
  if (status === 'running') return 'running';
  if (status === 'review') return '';
  if (status === 'blocked' || status === 'error') return 'blocked';
  return '';
}

function factoryNormalizeStageScope(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'hero' || raw === 'representative' || raw === 'main') return 'hero';
  if (raw === 'size' || raw === 'sizecut') return 'size';
  if (raw === 'options' || raw === 'option' || raw === 'color' || raw === 'coloroptions') return 'options';
  if (raw === 'cuts' || raw === 'cut' || raw === 'imagecuts' || raw === 'imagecut') return 'cuts';
  if (/대표\s*이미지|대표컷|목록용/.test(raw)) return 'hero';
  if (/사이즈\s*(이미지|컷|안내)|크기\s*(가이드|이미지)/.test(raw)) return 'size';
  if (/색상\s*(옵션|이미지|컷)|옵션\s*(이미지|컷)/.test(raw)) return 'options';
  if (/이미지\s*컷|자동화\s*컷|automation[_-]?custom/.test(raw)) return 'cuts';
  return '';
}

function factoryAssetDeclaredStageScopes(asset = {}) {
  const sourceMap = asset?.sourceMap || {};
  const metadata = asset?.metadata || {};
  return [
    sourceMap.importedStageId,
    sourceMap.sourceStageId,
    sourceMap.inputStageId,
    sourceMap.originalStageId,
    sourceMap.factoryStageId,
    metadata.importedStageId,
    metadata.sourceStageId,
    metadata.inputStageId,
    metadata.originalStageId,
    metadata.factoryStageId,
  ].map(factoryNormalizeStageScope).filter(Boolean);
}

function factoryAssetTitleStageScope(asset = {}) {
  const text = `${asset?.title || ''}\n${asset?.prompt || ''}\n${asset?.metadata?.source || ''}`;
  if (/대표\s*이미지\s*지시|대표\s*이미지|대표컷|목록용/.test(text)) return 'hero';
  if (/사이즈\s*(안내컷|이미지|컷)|DB\s*(규격|사이즈)/.test(text)) return 'size';
  if (/이미지\s*컷|자동화\s*컷/.test(text)) return 'cuts';
  return '';
}

function factoryAssetMatchesStageSourcePolicy(asset = {}, stageId = '') {
  const targetStage = String(stageId || asset?.stageId || '').trim();
  if (!['hero', 'size', 'cuts'].includes(targetStage)) return true;
  const declared = factoryAssetDeclaredStageScopes(asset);
  if (declared.some(scope => scope && scope !== targetStage)) return false;
  if (declared.some(Boolean)) return true;
  const titleScope = factoryAssetTitleStageScope(asset);
  if (titleScope && titleScope !== targetStage) return false;
  return true;
}

function factoryAssetLooksLocalFallbackCandidate(asset = {}) {
  const stageId = String(asset?.stageId || asset?.metadata?.stageId || asset?.sourceMap?.stageId || asset?.sourceMap?.importedStageId || '');
  if (!['hero', 'size', 'cuts'].includes(stageId)) return false;
  const metadata = asset?.metadata || {};
  const sourceMap = asset?.sourceMap || {};
  if (
    metadata.currentProductFallback === true ||
    metadata.localFallbackCandidate === true ||
    metadata.localFallbackRejected === true ||
    sourceMap.fallback === true ||
    sourceMap.localFallbackCandidate === true
  ) {
    return true;
  }
  const text = [
    asset?.title,
    asset?.warning,
    metadata.source,
    metadata.warning,
    metadata.fallbackReason,
    metadata.hiddenReason,
    sourceMap.fallbackReason,
  ].filter(Boolean).join('\n');
  return /대체컷|로컬\s*(?:대체|안전후보|사이즈컷|생성)|현재\s*제품(?:\s*원본)?\s*안전후보|이미지\s*API\s*실패로\s*현재\s*제품\s*사진\s*기준\s*로컬|AI\s*생성\s*실패로\s*로컬/.test(text);
}

function factoryAssetLooksWrongStageKind(asset = {}, stageId = '') {
  const targetStage = String(stageId || asset?.stageId || asset?.metadata?.stageId || asset?.sourceMap?.stageId || '').trim();
  if (targetStage !== 'cuts') return false;
  const metadata = asset?.metadata && typeof asset.metadata === 'object' ? asset.metadata : {};
  const sourceMap = asset?.sourceMap && typeof asset.sourceMap === 'object' ? asset.sourceMap : {};
  const text = [
    asset?.title,
    asset?.assetKind,
    asset?.category,
    asset?.categoryLabel,
    metadata.assetKind,
    metadata.category,
    metadata.categoryLabel,
    metadata.stageLabel,
    metadata.source,
    sourceMap.assetKind,
    sourceMap.category,
  ].filter(Boolean).join('\n');
  return /대표\s*이미지|대표컷|목록용|hero-images|\bhero\b/i.test(text);
}

function factoryAssetsForStage(stageId, factory = factoryRuntimeReadFactory()) {
  return (factory.assets || []).filter(asset =>
    asset.stageId === stageId &&
    !asset.rejected &&
    !factoryAssetLooksLocalFallbackCandidate(asset) &&
    !factoryAssetLooksWrongStageKind(asset, stageId) &&
    factoryAssetMatchesStageSourcePolicy(asset, stageId)
  );
}

function factoryAssetHasDisplayImage(asset) {
  return !!factoryAssetDisplayImage(asset);
}

function factoryAssetHasCurrentProductPayload(asset, factory = factoryRuntimeReadFactory(), options = {}) {
  const stageId = String(asset?.stageId || '');
  if (factoryAssetLooksLocalFallbackCandidate(asset)) return false;
  if (factoryAssetLooksWrongStageKind(asset, stageId)) return false;
  if (asset?.currentProductHidden === true) {
    if (['hero', 'size', 'cuts', 'detail', 'options'].includes(stageId) && factoryCurrentStageRunId(stageId, factory)) {
      const hiddenJob = factoryAssetMatchesCurrentJob(asset, stageId, factory, {
        strictScope: true,
        strictRunId: true,
        requireExpectedProductKey: true,
        requireExpectedInputFingerprint: true,
        requireExpectedRunId: true,
        requireExpectedStageId: true,
      });
      if (!hiddenJob.ok) return false;
      asset.currentProductHidden = false;
    } else {
      return false;
    }
  }
  if (['hero', 'size', 'cuts', 'detail', 'options'].includes(stageId) && factoryCurrentStageRunId(stageId, factory)) {
    const job = factoryAssetMatchesCurrentJob(asset, stageId, factory, {
      strictScope: true,
      strictRunId: true,
      requireExpectedProductKey: true,
      requireExpectedInputFingerprint: true,
      requireExpectedRunId: true,
      requireExpectedStageId: true,
    });
    if (!job.ok) return false;
  }
  const identityKey = options.identityKey || factoryIdentityKey(factory) || factoryNormalizeIdentityText(factory?.product?.productName || state.productName || '');
  if (!factoryAssetCompatibleWithCurrentProduct(asset, identityKey)) return false;
  if (!factoryAssetCompatibleWithCurrentInputImage(asset, factory, options)) return false;
  if (!factoryAssetCompatibleWithLatestStageRun(asset, factory, options)) return false;
  factoryAssetVisualValidationState(asset, factory, options);
  if (options.allowHtml !== false && asset?.html) return true;
  return factoryAssetHasDisplayImage(asset);
}

function factoryUsableAssetsForStage(stageId, factory = factoryRuntimeReadFactory()) {
  const identityKey = factoryIdentityKey(factory) || factoryNormalizeIdentityText(factory?.product?.productName || state.productName || '');
  const currentInputKey = factoryCurrentInputImageFingerprint(factory);
  const hasDeclaredProductImage = factoryHasDeclaredProductImage(factory);
  const latestRunId = factoryStageLatestGenerationRunId(stageId, factory);
  const baseOptions = {
    allowHtml: stageId === 'detail',
    identityKey,
    currentInputKey,
    hasDeclaredProductImage,
    strictScope: true,
    strictRunId: true,
    requireExpectedProductKey: true,
    requireExpectedInputFingerprint: true,
    requireExpectedRunId: true,
    requireExpectedStageId: true,
  };
  const baseAssets = factoryAssetsForStage(stageId, factory).filter(asset => factoryAssetHasCurrentProductPayload(asset, factory, baseOptions));
  if (!latestRunId) return baseAssets.filter(asset => !factoryAssetSupersededRunId(asset));
  const latestAssets = baseAssets.filter(asset => factoryAssetGenerationRunId(asset) === latestRunId);
  if (latestAssets.length) return latestAssets;
  const activeFallback = baseAssets.filter(asset => !factoryAssetSupersededRunId(asset));
  return activeFallback.length ? activeFallback : baseAssets;
}

function factorySelectedAssets(stageId, factory = factoryRuntimeReadFactory()) {
  return factoryAssetsForStage(stageId, factory).filter(asset => asset.used);
}

function factorySelectedUsableAssets(stageId, factory = factoryRuntimeReadFactory()) {
  return factoryUsableAssetsForStage(stageId, factory).filter(asset => asset.used);
}

function factoryLoadDbFieldPresets() {
  try {
    const raw = localStorage.getItem(FACTORY_DB_PRESET_STORAGE_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    return [];
  }
}

function factorySaveDbFieldPresets(presets) {
  try { localStorage.setItem(FACTORY_DB_PRESET_STORAGE_KEY, JSON.stringify(Array.isArray(presets) ? presets : [])); } catch(e) {}
}

function factoryDbNormalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-()[\]{}.:/\\|·,]+/g, '');
}

function factoryDbFieldDef(fieldId) {
  return FACTORY_DB_FIELD_DEFS.find(def => def.id === fieldId) || null;
}

function factoryIsOptionKey(key) {
  const normalized = factoryDbNormalizeKey(key);
  return /(option|variant|color|colour|옵션|품목|색상|색깔)/i.test(String(key || '')) || ['option','options','variants','color','colors','색상','옵션'].some(token => normalized.includes(factoryDbNormalizeKey(token)));
}

function factoryIsOptionConfigKey(key) {
  const raw = String(key || '');
  const normalized = factoryDbNormalizeKey(raw);
  if (!normalized) return false;
  return [
    'hasoption',
    'optiontype',
    'optionlisttype',
    'optiondisplaytype',
    'requiredoption',
    'selectonebyoption',
    'useadditionaloption',
    'additionaloptions',
    'useattachedfileoption',
    'attachedfileoption',
    'variantcode',
    'customvariantcode',
    'productcode',
    'productno',
    'valueno',
    'optioncolor',
    'optionimagefile',
    'optionlinkimage',
    'display',
    'selling',
    'displaysoldout',
    'displayorder',
    'additionalamount',
    'supplyprice',
    'price',
    'quantity',
    'safetyinventory',
    'useinventory',
    'importantinventory',
    'inventorycontroltype',
    'inventory',
    'shopno',
    'optioncode',
    'optionpresetcode',
    'optionpresetname',
    'image',
    'status',
  ].some(token => normalized.endsWith(token) || normalized === token);
}

function factoryIsSizeKey(key) {
  const normalized = factoryDbNormalizeKey(key);
  return ['size','dimensions','dimension','spec','specification','width','height','depth','length','가로','세로','높이','길이','폭','너비','규격','크기','사이즈'].some(token => normalized.includes(factoryDbNormalizeKey(token)));
}

function factoryMatchDbFieldId(key) {
  const normalized = factoryDbNormalizeKey(key);
  if (!normalized) return '';
  if (factoryIsOptionConfigKey(key)) return '';
  if (factoryIsOptionKey(key)) {
    if (['optioncount','optionscount','variantcount','colorcount','옵션수','색상수'].some(token => normalized.includes(factoryDbNormalizeKey(token)))) return 'option_count';
    return 'option_values';
  }
  if (factoryIsSizeKey(key)) return 'size';
  const entries = FACTORY_DB_FIELD_DEFS.map(def => ({
    def,
    aliases: [def.id, def.label, ...(def.aliases || [])].map(factoryDbNormalizeKey).filter(Boolean),
  }));
  for (const entry of entries) {
    if (entry.aliases.some(alias => normalized === alias)) return entry.def.id;
  }
  const ranked = entries
    .flatMap(entry => entry.aliases.map(alias => ({ id: entry.def.id, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const item of ranked) {
    if (item.alias.length >= 4 && (normalized.includes(item.alias) || item.alias.includes(normalized))) return item.id;
  }
  for (const def of FACTORY_DB_FIELD_DEFS) {
    const aliases = [def.id, def.label, ...(def.aliases || [])].map(factoryDbNormalizeKey);
    if (aliases.some(alias => alias && alias.length >= 3 && normalized.endsWith(alias))) return def.id;
  }
  return '';
}

function factoryCleanOptionValue(value) {
  const cleaned = String(value ?? '')
    .replace(/^[\s"'`[\]{}()]+|[\s"'`[\]{}()]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length > 80) return '';
  if (/^(색상|색깔|옵션|옵션명|옵션값|필수|선택|사용|true|false|null|undefined|none|없음)$/i.test(cleaned)) return '';
  if (/옵션을 선택|선택해 주세요|선택해주세요/.test(cleaned)) return '';
  return cleaned;
}

