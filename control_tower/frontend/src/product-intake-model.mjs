export class ProductIntakeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProductIntakeError';
    this.code = code;
  }
}

const text = value => String(value ?? '').trim();

export function buildDbSnapshotRequest({ jcode, batchId, requestedBy }) {
  const normalizedJcode = Number(jcode);
  if (!Number.isInteger(normalizedJcode) || normalizedJcode < 1) {
    throw new ProductIntakeError('product_target_required');
  }
  const normalizedBatchId = text(batchId);
  if (!normalizedBatchId) throw new ProductIntakeError('batch_id_required');
  return {
    jcode: normalizedJcode,
    idempotencyKey: `ui-${normalizedBatchId}-${normalizedJcode}`,
    requestedBy: text(requestedBy) || 'operator',
    source: { kind: 'db-selection', selectionId: String(normalizedJcode) },
  };
}

export function buildPdpJobRequest({ inputSnapshotId, idempotencyKey, actor = 'operator', correlationId = '' }) {
  const snapshotId = text(inputSnapshotId);
  const key = text(idempotencyKey);
  if (!snapshotId) throw new ProductIntakeError('input_snapshot_required');
  if (!key) throw new ProductIntakeError('idempotency_key_required');
  return {
    inputSnapshotId: snapshotId,
    idempotencyKey: key,
    actor: text(actor) || 'operator',
    ...(text(correlationId) ? { correlationId: text(correlationId) } : {}),
  };
}

export function createManualManifest({
  jcode,
  productName,
  category = '',
  requiredValues = {},
  baseImages,
  colorImages = [],
}) {
  const rawJcode = text(jcode);
  const normalizedJcode = rawJcode ? Number(rawJcode) : null;
  if (normalizedJcode !== null && (!Number.isInteger(normalizedJcode) || normalizedJcode < 1)) {
    throw new ProductIntakeError('jcode_required');
  }
  if (!text(productName)) throw new ProductIntakeError('product_name_required');
  if (!Array.isArray(baseImages) || baseImages.length === 0) {
    throw new ProductIntakeError('base_image_required');
  }
  const inputImages = [...baseImages, ...colorImages].map((image, index) => ({
    role: index < baseImages.length ? 'base' : 'color-option',
    ordinal: index < baseImages.length ? index + 1 : index - baseImages.length + 1,
    name: text(image.name) || text(image.fileName),
    fileName: text(image.fileName),
    colorName: index < baseImages.length ? null : text(image.colorName),
    sha256: text(image.sha256),
    dataUrl: text(image.dataUrl),
  }));
  if (inputImages.some(image => !image.name || !image.fileName || !image.sha256)) {
    throw new ProductIntakeError('image_metadata_required');
  }
  if (inputImages.some(image => image.role === 'color-option' && !image.colorName)) {
    throw new ProductIntakeError('color_name_required');
  }
  if (inputImages.some(image => !image.dataUrl.startsWith('data:image/') || !image.dataUrl.includes(';base64,'))) {
    throw new ProductIntakeError('image_payload_required');
  }
  return {
    contractType: 'manual-product-intake',
    contractVersion: '1.0.0',
    jcode: normalizedJcode,
    productName: text(productName),
    category: text(category),
    requiredValues: Object.fromEntries(
      Object.entries(requiredValues)
        .map(([key, value]) => [key, text(value)])
        .filter(([, value]) => value),
    ),
    inputImages,
  };
}
