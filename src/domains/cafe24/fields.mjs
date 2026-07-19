export const CAFE24_PRODUCT_FIELD_ORDER = Object.freeze([
  'product_name',
  'price',
  'retail_price',
  'supply_price',
  'display',
  'selling',
  'description',
  'mobile_description',
  'separated_mobile_description',
  'summary_description',
  'search_keywords',
  'manufacturer_code',
  'supplier_code',
  'brand_code',
  'origin_code',
  'weight',
]);

const FIELD_ALIASES = Object.freeze({
  product_name: ['product_name', 'name', 'productName'],
  price: ['price', 'sale_price', 'selling_price'],
  retail_price: ['retail_price', 'consumer_price'],
  supply_price: ['supply_price', 'purchase_price'],
  display: ['display', 'display_status'],
  selling: ['selling', 'selling_status'],
  description: ['description', 'detail_html'],
  mobile_description: ['mobile_description'],
  separated_mobile_description: ['separated_mobile_description'],
  summary_description: ['summary_description', 'summary'],
  search_keywords: ['search_keywords', 'keywords'],
  manufacturer_code: ['manufacturer_code'],
  supplier_code: ['supplier_code'],
  brand_code: ['brand_code'],
  origin_code: ['origin_code'],
  weight: ['weight'],
});

const MONEY_FIELDS = new Set(['price', 'retail_price', 'supply_price']);
const FLAG_FIELDS = new Set(['display', 'selling', 'separated_mobile_description']);

function firstDefined(record, aliases) {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function normalizeFlag(value) {
  if (value === true) return 'T';
  if (value === false) return 'F';
  const text = String(value ?? '').trim().toUpperCase();
  if (['T', 'TRUE', 'Y', 'YES', '1', '사용', '진열함', '판매함'].includes(text)) return 'T';
  if (['F', 'FALSE', 'N', 'NO', '0', '미사용', '진열안함', '판매안함'].includes(text)) return 'F';
  return '';
}

function normalizeMoney(value) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return '';
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? String(Math.round(amount * 100) / 100) : '';
}

export function normalizeCafe24FieldId(value = '') {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

export function normalizeCafe24ProductFields(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {};
  for (const field of CAFE24_PRODUCT_FIELD_ORDER) {
    const raw = firstDefined(source, FIELD_ALIASES[field] || [field]);
    if (raw === undefined || raw === null) continue;
    const value = MONEY_FIELDS.has(field)
      ? normalizeMoney(raw)
      : FLAG_FIELDS.has(field)
        ? normalizeFlag(raw)
        : String(raw).trim();
    if (value !== '') result[field] = value;
  }
  return result;
}

export function cafe24FieldEntries(input = {}) {
  const normalized = normalizeCafe24ProductFields(input);
  return CAFE24_PRODUCT_FIELD_ORDER
    .filter(field => Object.prototype.hasOwnProperty.call(normalized, field))
    .map(field => Object.freeze({ field, value: normalized[field] }));
}
