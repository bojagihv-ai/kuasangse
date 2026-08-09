const SOURCE_KEYS = Object.freeze([
  'base64',
  'imageBase64',
  'dataUrl',
  'dataURL',
  'imageUrl',
  'imageURL',
  'previewUrl',
  'thumbnailUrl',
  'url',
  'src',
  'imagePreview',
  'preview',
]);

export const STORED_IMAGE_MARKER = '__stored_in_indexeddb__';

export function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function list(value) {
  return Array.isArray(value) ? value : [];
}

export function text(value) {
  return String(value ?? '').trim();
}

export function binaryText(value) {
  const normalized = text(value);
  return normalized === STORED_IMAGE_MARKER ? '' : normalized;
}

export function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function boundedValue(value) {
  if (!hasValue(value)) return null;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return serialized.length <= 100000 ? serialized : serialized.slice(0, 100000);
}

export function firstValue(sources, aliases) {
  for (const source of sources) {
    const values = record(source.value);
    for (const alias of aliases) {
      if (hasValue(values[alias])) {
        return { value: values[alias], sourceType: source.sourceType };
      }
    }
  }
  return { value: null, sourceType: null };
}

export function firstSizeRecord(factoryProduct) {
  for (const value of Object.values(record(factoryProduct.dbSizeManualByScope))) {
    if (Object.keys(record(value)).length) return record(value);
  }
  return {};
}

export function positiveInteger(...values) {
  for (const value of values) {
    const candidate = Number(value);
    if (Number.isInteger(candidate) && candidate > 0) return candidate;
  }
  return null;
}

export function revisionNumber(root, factory) {
  const values = [
    record(record(root.persistence).revision).counter,
    record(factory.workspaceRevision).counter,
    factory.workspaceRevision,
  ];
  for (const value of values) {
    const candidate = Number(value);
    if (Number.isInteger(candidate) && candidate >= 0) return candidate;
  }
  return 0;
}

export function safeKey(value, fallback) {
  const normalized = text(value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 250);
  return normalized || fallback;
}

export function mimeFromSource(source, fallback = '') {
  const match = text(source).match(/^data:([^;,]+)[;,]/i);
  return text(match?.[1] || fallback || 'image/png').toLowerCase();
}

export function filenameFor(source, fallback, mimeType) {
  const explicit = text(
    source.name
    || source.fileName
    || source.filename
    || source.originalFilename,
  );
  if (explicit) return explicit.slice(0, 240);
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/webp'
      ? 'webp'
      : 'png';
  return `${fallback}.${extension}`;
}

export function binarySource(source) {
  const embeddedImage = binaryText(source.image);
  if (embeddedImage) return embeddedImage;
  for (const key of SOURCE_KEYS) {
    const value = binaryText(source[key]);
    if (value) {
      if (key.toLowerCase().includes('base64') && !value.startsWith('data:')) {
        return `data:${text(source.mime || source.imageMime || 'image/png')};base64,${value}`;
      }
      return value;
    }
  }
  const sourceMap = record(source.sourceMap);
  for (const key of SOURCE_KEYS) {
    const value = binaryText(sourceMap[key]);
    if (value) return value;
  }
  const archiveId = text(source.archiveId || sourceMap.localArchiveId);
  return archiveId
    ? `/api/local-archive/assets/${encodeURIComponent(archiveId)}/image`
    : '';
}

export function localImageSource(source) {
  const normalized = text(source);
  if (!/^https?:\/\//i.test(normalized)) return normalized;
  return `/api/image-proxy?raw=1&url=${encodeURIComponent(normalized)}`;
}

export function selectedIds(stages) {
  return new Set(
    Object.values(record(stages))
      .flatMap(stage => list(record(stage).selectedAssetIds))
      .map(text)
      .filter(Boolean),
  );
}

const ROLE_BY_STAGE = Object.freeze({
  hero: 'hero', size: 'size', options: 'color-option', cuts: 'feature',
  sections: 'section', detail: 'stitched-detail', export: 'stitched-detail', competitor: 'competitor-image',
});

export function roleForStage(stage) { return ROLE_BY_STAGE[stage] || 'feature'; }

function canonicalAssetIdentity(asset, source, mimeType) {
  return JSON.stringify({
    phase: text(asset.phase),
    stage: text(asset.stage),
    role: text(asset.role),
    displayName: text(asset.displayName),
    selectionState: text(asset.selectionState),
    source: text(source),
    mimeType: mimeFromSource(source, mimeType),
    metadata: Object.fromEntries(
      Object.entries(record(asset.metadata)).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      )),
    ),
  });
}

function stableAssetSuffix(canonicalIdentity) {
  return `${tinyHash(`asset-a\u001f${canonicalIdentity}`)}${tinyHash(`asset-b\u001f${canonicalIdentity}`)}`;
}

function collisionAssetKey(baseAssetKey, suffix) {
  return `${baseAssetKey.slice(0, 320 - suffix.length - 1)}:${suffix}`;
}

function assignCollisionKeys(plan, baseAssetKey, group) {
  for (const entry of group) plan.assetKeys.delete(entry.assignedKey);
  const sorted = [...group].sort((left, right) => (
    left.canonicalIdentity < right.canonicalIdentity
      ? -1
      : left.canonicalIdentity > right.canonicalIdentity
        ? 1
        : 0
  ));
  const suffixGroups = new Map();
  for (const entry of sorted) {
    const suffix = stableAssetSuffix(entry.canonicalIdentity);
    const values = suffixGroups.get(suffix) || [];
    values.push(entry);
    suffixGroups.set(suffix, values);
  }
  for (const [suffix, values] of suffixGroups) {
    values.forEach((entry, index) => {
      const uniqueSuffix = values.length === 1 ? suffix : `${suffix}-${index + 1}`;
      entry.assignedKey = collisionAssetKey(baseAssetKey, uniqueSuffix);
      plan.assetKeys.add(entry.assignedKey);
      plan.assets[entry.assetIndex] = Object.freeze({
        ...entry.asset,
        assetKey: entry.assignedKey,
      });
      if (entry.uploadIndex !== null) {
        plan.uploads[entry.uploadIndex] = Object.freeze({
          ...entry.upload,
          assetKey: entry.assignedKey,
        });
      }
    });
  }
  plan.assetKeyCollisions.set(baseAssetKey, Object.freeze({
    baseAssetKey,
    assetKeys: Object.freeze(sorted.map(entry => entry.assignedKey).sort()),
  }));
}

export function pushAsset(plan, asset, source, filename, mimeType) {
  const sourceKey = source
    ? [
      asset.phase,
      asset.stage,
      asset.role,
      asset.displayName || '',
      asset.selectionState,
      asset.metadata?.sourceAssetId || '',
      source,
    ].join('\u001f')
    : '';
  if (sourceKey && plan.assetSourceKeys.has(sourceKey)) return;
  const baseAssetKey = asset.assetKey; const canonicalIdentity = canonicalAssetIdentity(asset, source, mimeType);
  const group = plan.assetKeyGroups.get(baseAssetKey) || [];
  if (group.some(entry => entry.canonicalIdentity === canonicalIdentity)) return;
  if (sourceKey) plan.assetSourceKeys.add(sourceKey);
  const upload = source
    ? {
        assetKey: baseAssetKey,
        source,
        filename,
        mimeType: mimeFromSource(source, mimeType),
      }
    : null;
  const entry = {
    asset,
    upload,
    canonicalIdentity,
    assignedKey: baseAssetKey,
    assetIndex: plan.assets.length,
    uploadIndex: upload ? plan.uploads.length : null,
  };
  group.push(entry);
  plan.assetKeyGroups.set(baseAssetKey, group);
  plan.assetKeys.add(baseAssetKey);
  plan.assets.push(Object.freeze(asset));
  if (upload) plan.uploads.push(Object.freeze(upload));
  if (group.length > 1) assignCollisionKeys(plan, baseAssetKey, group);
}

export function tinyHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
