import {
  binarySource,
  filenameFor,
  hasValue,
  list,
  localImageSource,
  mimeFromSource,
  pushAsset,
  record,
  safeKey,
  text,
} from './work-bundle-foundation.mjs';

export function addInputAssets(plan, payload, factoryProduct) {
  const explicit = list(factoryProduct.inputImages);
  const backup = record(record(payload.productImageBackup).primary);
  const candidates = explicit.length
    ? explicit
    : Object.keys(backup).length
      ? [backup]
      : hasValue(factoryProduct.imageBase64) || hasValue(factoryProduct.imagePreview)
        ? [{
            id: 'product-primary',
            name: factoryProduct.imageName,
            imageBase64: factoryProduct.imageBase64,
            imagePreview: factoryProduct.imagePreview,
            mime: factoryProduct.imageMime,
          }]
        : hasValue(payload.imageBase64) || hasValue(payload.imagePreview)
          ? [{
              id: 'product-primary',
              name: '기본 이미지 1',
              imageBase64: payload.imageBase64,
              imagePreview: payload.imagePreview,
              mime: payload.imageMime,
            }]
          : [];
  candidates.forEach((value, index) => {
    const image = record(value); const colorName = text(image.colorName || image.color);
    const role = text(image.role) || (colorName ? 'color-option' : 'base'); const identity = safeKey(image.id, String(index)); const assetKey = `input:${identity}`.slice(0, 320);
    const source = binarySource(image) || (index === 0
      ? binarySource(factoryProduct) || binarySource(backup)
      : '');
    if (!source) {
      if (image.hasImage === true) {
        plan.missingRequiredAssetKeys.push(assetKey);
        plan.missingImageSources.push(Object.freeze({
          assetKey,
          reason: '원본 저장파일에 복원 locator 없음',
        }));
      }
      return;
    }
    const mimeType = mimeFromSource(
      source,
      text(image.mime || image.imageMime || backup.mime || backup.imageMime),
    );
    const displayName = text(image.name || image.fileName)
      || (colorName ? `${index + 1}. ${colorName}` : `기본 이미지 ${index + 1}`);
    pushAsset(
      plan,
      {
        assetKey,
        phase: 'input',
        stage: 'product',
        role,
        displayName,
        sourceLocator: `project.payload.assetPayload.factory.product.inputImages[${index}]`,
        selectionState: 'candidate',
        sortOrder: index,
        metadata: {
          colorName,
          mimeType,
          sourceKind: 'kuasangse-workfile',
        },
      },
      source,
      filenameFor(image, `input-${index + 1}`, mimeType),
      mimeType,
    );
  });
}

export function addOptionInputAssets(plan, values) {
  list(values).forEach((value, index) => {
    const image = record(value);
    const source = binarySource(image);
    const mimeType = mimeFromSource(source, text(image.mime || image.imageMime));
    const identity = safeKey(image.id, String(index));
    const assetKey = `input:option:${identity}`.slice(0, 320);
    pushAsset(
      plan,
      {
        assetKey,
        phase: 'input',
        stage: 'options',
        role: 'color-option',
        displayName: text(image.name || image.title) || `${index + 1}. 색상 옵션`,
        sourceLocator: `project.payload.optionSorter.images[${index}]`,
        selectionState: 'candidate',
        sortOrder: 100 + index,
        metadata: {
          colorName: text(image.colorName || image.color),
          mimeType,
          sourceKind: 'option-sorter-input',
        },
      },
      source,
      filenameFor(image, `option-input-${index + 1}`, mimeType),
      mimeType,
    );
    if (!source) plan.missingRequiredAssetKeys.push(assetKey);
  });
}

export function addCompetitorAssets(plan, factoryProduct) {
  list(factoryProduct.competitors).forEach((value, index) => {
    const competitor = record(value);
    const source = localImageSource(
      binarySource(competitor) || text(competitor.thumbnail_url || competitor.image_url),
    );
    if (!source) return;
    const mimeType = mimeFromSource(source, text(competitor.mime));
    const identity = safeKey(competitor.id, String(index));
    pushAsset(
      plan,
      {
        assetKey: `output:competitor:${identity}`.slice(0, 320),
        phase: 'output',
        stage: 'competitor',
        role: 'competitor-image',
        displayName: text(competitor.title || competitor.name)
          || `경쟁사 자료 ${index + 1}`,
        sourceLocator: `project.payload.assetPayload.factory.product.competitors[${index}]`,
        selectionState: 'candidate',
        sortOrder: 1000 + index,
        metadata: {
          sourceUrl: text(competitor.productUrl || competitor.detailUrl || competitor.url),
          sourceKind: 'competitor',
        },
      },
      source,
      filenameFor(competitor, `competitor-${index + 1}`, mimeType),
      mimeType,
    );
  });
}

function competitorDetailSource(value) {
  const source = text(value);
  if (!/^https?:\/\//i.test(source)) return source;
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    return localImageSource(source);
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (
    loopback
    && /^\/api\/vm-detail-capture\/[^/]+\/artifacts\/\d+$/i.test(parsed.pathname)
  ) {
    return `${parsed.pathname}${parsed.search}`;
  }
  if (loopback && parsed.pathname === '/api/local_image') {
    return `/api/local-archive/source-image?source=${encodeURIComponent(source)}`;
  }
  return localImageSource(source);
}

export function addCompetitorDetailAssets(plan, compPage, sourceLocator) {
  const marketScrape = record(record(compPage).marketScrape);
  const selectedImageIds = new Set(
    list(marketScrape.selectedImageIds).map(text).filter(Boolean),
  );
  list(marketScrape.scrapedImages).forEach((value, index) => {
    const image = record(value);
    const source = competitorDetailSource(
      binarySource(image) || text(image.imageUrl || image.image_url || image.url),
    );
    if (!source) return;
    const imageId = text(image.id || image.imageId || image.assetId);
    const identity = safeKey(imageId, String(index));
    const mimeType = mimeFromSource(
      source,
      text(image.mime || image.contentType || image.imageMime),
    );
    pushAsset(
      plan,
      {
        assetKey: `output:competitor-detail:${identity}`.slice(0, 320),
        phase: 'output',
        stage: 'competitor',
        role: 'competitor-page',
        displayName: text(image.title || image.name)
          || `경쟁사 상세페이지 ${index + 1}`,
        sourceLocator: `${sourceLocator}[${index}]`,
        selectionState: selectedImageIds.has(imageId || String(index))
          ? 'selected'
          : 'candidate',
        sortOrder: 1200 + index,
        metadata: {
          sourceUrl: text(
            image.productUrl
            || image.product_url
            || image.detailUrl
            || image.detail_url,
          ),
          candidateId: text(image.candidateId || image.candidate_id),
          platform: text(image.platform),
          detailJobId: text(image.detailJobId || image.detail_job_id),
          sourceKind: 'competitor-detail',
        },
      },
      source,
      filenameFor(image, `competitor-detail-${index + 1}`, mimeType),
      mimeType,
    );
  });
}

export function addCafe24CandidateAssets(plan, factoryProduct) {
  list(factoryProduct.cafe24Candidates).forEach((value, index) => {
    const candidate = record(value);
    const source = localImageSource(
      binarySource(candidate) || text(candidate.thumbnail_url || candidate.image_url),
    );
    if (!source) return;
    const productNo = text(candidate.product_no || candidate.productNo);
    const identity = safeKey(productNo, String(index));
    const mimeType = mimeFromSource(source, text(candidate.mime));
    pushAsset(
      plan,
      {
        assetKey: `input:cafe24:${identity}`.slice(0, 320),
        phase: 'input',
        stage: 'cafe24',
        role: 'cafe24-candidate-image',
        displayName: text(candidate.product_name || candidate.productName || candidate.name)
          || `Cafe24 후보 ${index + 1}`,
        sourceLocator: `project.payload.assetPayload.factory.product.cafe24Candidates[${index}]`,
        selectionState: productNo && productNo === text(factoryProduct.selectedCafe24CandidateKey)
          ? 'selected'
          : 'candidate',
        sortOrder: 500 + index,
        metadata: {
          productNo,
          sourceKind: 'cafe24-candidate',
        },
      },
      source,
      filenameFor(candidate, `cafe24-${identity}`, mimeType),
      mimeType,
    );
  });
}
