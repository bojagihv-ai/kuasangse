const FIELD_KEYS = Object.freeze({
  sale_price: 'salePrice',
  purchase_price: 'supplyPrice',
  stock: 'stock',
  size: 'size',
  width_mm: 'widthMm',
  depth_mm: 'depthMm',
  weight: 'weight',
  material: 'material',
  usage: 'usage',
});

const text = value => typeof value === 'string' ? value.trim() : '';
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function normalizeProductSourceSelection(value) {
  const source = record(value);
  const kind = ['sinhwa-db', 'direct'].includes(source.kind) ? source.kind : 'manual';
  if (kind === 'manual') return { kind: 'manual' };
  const selectionId = text(source.selectionId);
  if (!selectionId || (kind === 'sinhwa-db' && (!/^\d+$/.test(selectionId) || Number(selectionId) < 1))) return { kind: 'manual' };
  return {
    kind,
    selectionId,
    label: text(source.label),
    thumbnail: text(source.thumbnail),
    confirmedAt: Number.isFinite(Number(source.confirmedAt)) ? Number(source.confirmedAt) : 0,
  };
}

export function sourcePayload(value) {
  const source = normalizeProductSourceSelection(value);
  return source.kind === 'manual'
    ? source
    : { kind: source.kind, selectionId: source.selectionId };
}

export function beginProductSourceRequest(product, kind, query) {
  if (product.queued || product.queueRequest) return null;
  if (!['sinhwa', 'cafe24'].includes(kind)) throw new TypeError('unknown product source');
  const request = Object.freeze({ kind, query: text(query), productName: text(product.productName) });
  product.sourceLookup ||= {};
  product.sourceLookup[kind] = { request, status: 'loading', candidates: [], error: '' };
  return request;
}

export function finishProductSourceRequest(product, request, candidates, error = '', activeProduct = product) {
  if (product.queued || product.queueRequest) return false;
  const lookup = record(product.sourceLookup)[request.kind];
  if (activeProduct !== product || lookup?.request !== request || text(product.productName) !== request.productName) return false;
  lookup.status = error ? 'error' : 'done';
  lookup.candidates = error ? [] : (Array.isArray(candidates) ? candidates : []);
  lookup.error = text(error);
  return true;
}

export function beginProductSourceSelection(product, kind, selectionId) {
  if (product.queued || product.queueRequest) return null;
  const request = Object.freeze({ kind, selectionId: text(selectionId), productName: text(product.productName) });
  product.sourceSelectionRequest = request;
  return request;
}

export function cancelProductSourceRequests(product) {
  if (product.queued || product.queueRequest) return;
  for (const lookup of Object.values(record(product.sourceLookup))) {
    if (!lookup || typeof lookup !== 'object' || !['loading', 'selecting'].includes(lookup.status)) continue;
    lookup.request = null;
    lookup.status = 'idle';
  }
  delete product.sourceSelectionRequest;
}

export function finishProductSourceSelection(product, request, result, confirmedAt = Date.now(), activeProduct = product) {
  if (product.queued || product.queueRequest) return false;
  if (activeProduct !== product || product.sourceSelectionRequest !== request || text(product.productName) !== request.productName) return false;
  delete product.sourceSelectionRequest;
  applySelectedProductSource(product, result, confirmedAt);
  return true;
}

export function applySelectedProductSource(product, resultValue, confirmedAt = Date.now()) {
  if (product.queued || product.queueRequest) return 0;
  const result = record(resultValue);
  const source = normalizeProductSourceSelection({ ...record(result.source), label: result.label,
    thumbnail: result.thumbnail, confirmedAt });
  if (source.kind === 'manual') throw new TypeError('selected product source required');
  product.sourceSelection = source;
  product.requiredValues ||= {};
  product.sourceFields ||= {};
  let changed = 0;
  for (const [fieldId, key] of Object.entries(FIELD_KEYS)) {
    const value = text(record(result.values)[fieldId]);
    if (!value || text(product.requiredValues[key])) continue;
    product.requiredValues[key] = value;
    product.sourceFields[fieldId] = { source: source.label || source.kind, confirmedAt };
    changed += 1;
  }
  return changed;
}

export function setProductFieldDraft(product, fieldId, value) {
  if (product.queued || product.queueRequest) return;
  product.fieldDrafts ||= {};
  product.fieldDrafts[fieldId] = String(value ?? '');
}

export function commitProductField(product, fieldId, value, confirmedAt = Date.now()) {
  if (product.queued || product.queueRequest) return false;
  const key = fieldId === 'product_name' ? 'productName' : FIELD_KEYS[fieldId];
  if (!key) return false;
  const next = text(value);
  if (key === 'productName') product.productName = next;
  else {
    product.requiredValues ||= {};
    product.requiredValues[key] = next;
  }
  product.sourceFields ||= {};
  product.sourceFields[fieldId] = { source: '직접 입력', confirmedAt };
  if (product.fieldDrafts) delete product.fieldDrafts[fieldId];
  return true;
}

export function buildProductFieldSummary(definitionsValue, product) {
  const definitions = Array.isArray(definitionsValue) ? definitionsValue : [];
  const values = record(product.requiredValues);
  const drafts = record(product.fieldDrafts);
  const sources = record(product.sourceFields);
  const fields = definitions.map(definition => {
    const field = record(definition);
    const key = field.id === 'product_name' ? 'productName' : FIELD_KEYS[field.id];
    const value = key === 'productName' ? text(product.productName) : text(values[key]);
    const hasDraft = Object.hasOwn(drafts, field.id);
    return {
      ...field,
      value,
      source: text(record(sources[field.id]).source) || (value ? '직접 입력' : ''),
      status: value ? 'done' : (field.required ? 'missing' : 'wait'),
      ...(hasDraft ? { hasDraft: true, draftValue: String(drafts[field.id] ?? '') } : {}),
    };
  });
  const missingRegister = fields.filter(field => field.group === '상품등록 필수' && field.required && field.status !== 'done');
  const missingGenerate = fields.filter(field => field.group === '생성 필수' && field.required && field.status !== 'done');
  return {
    fields,
    missingRegister,
    missingGenerate,
    autoDone: fields.filter(field => field.status === 'done' && field.source !== '직접 입력'),
    sizeReady: ['width_mm', 'depth_mm'].every(id => fields.find(field => field.id === id)?.status === 'done'),
  };
}
