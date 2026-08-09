import { normalizeCafe24ProductFields } from './fields.mjs';
import { buildCafe24OptionModel } from './options.mjs';

export const CAFE24_DETAIL_FIELDS = Object.freeze(['description', 'mobile_description']);
export const CAFE24_UNSUPPORTED_PRODUCT_FIELDS = Object.freeze([
  'cultural_tax_deduction',
  'price_excluding_tax',
  'product_volume',
]);

const ADMIN_LABEL_PATTERN = /(?:DB\s*확인|작업용\s*섹션|관리자\s*메모|생성\s*프롬프트)/i;
const LIGHT_PLACEHOLDER_PATTERN = /(?:__stored_in_indexeddb__|data-factory-light|factory-light-image)/i;
const INLINE_IMAGE_PATTERN = /<img\b[^>]*\bsrc\s*=\s*["']data:image\//i;
const LONG_BASE64_PATTERN = /(?:base64,|[A-Za-z0-9+/]{1200,}={0,2})/i;
const ACTIVE_TAG_PATTERN = /<\s*\/?\s*(?:script|iframe|object|embed|svg|math|base|form|input|button)\b/i;
const META_REFRESH_PATTERN = /<\s*meta\b[^>]*\bhttp-equiv\s*=\s*(?:["']\s*)?refresh\b/i;
const EVENT_ATTRIBUTE_PATTERN = /\bon[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;
const UNSAFE_URL_PATTERN = /(?:\b(?:javascript|vbscript|file|about)\s*:|\b(?:href|src|action|formaction|poster)\s*=\s*["']?\s*data\s*:\s*(?!image\/(?:png|jpe?g|gif|webp|avif);base64,)|\burl\s*\(\s*["']?\s*(?:javascript|vbscript|data)\s*:)/i;

function cloneRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

export function preflightCafe24DetailHtml(html = '') {
  const text = String(html || '');
  const issues = [];
  const hasActiveTags = ACTIVE_TAG_PATTERN.test(text) || META_REFRESH_PATTERN.test(text);
  if (INLINE_IMAGE_PATTERN.test(text)) issues.push('상세설명 HTML에 base64 인라인 이미지가 포함되어 있습니다.');
  if (LONG_BASE64_PATTERN.test(text)) issues.push('상세설명 HTML에 긴 base64 데이터가 포함되어 있습니다.');
  if (LIGHT_PLACEHOLDER_PATTERN.test(text)) issues.push('상세설명 HTML에 브라우저 전용 이미지 플레이스홀더가 포함되어 있습니다.');
  if (ADMIN_LABEL_PATTERN.test(text)) issues.push('상세설명 HTML에 작업용 관리자 문구가 포함되어 있습니다.');
  if (hasActiveTags) issues.push('상세설명 HTML에 실행 가능한 태그가 포함되어 있습니다.');
  if (EVENT_ATTRIBUTE_PATTERN.test(text)) issues.push('상세설명 HTML에 이벤트 핸들러 속성이 포함되어 있습니다.');
  if (UNSAFE_URL_PATTERN.test(text)) issues.push('상세설명 HTML에 안전하지 않은 URL이 포함되어 있습니다.');
  return Object.freeze({
    ok: issues.length === 0,
    issues: Object.freeze(issues),
    hasInlineImage: INLINE_IMAGE_PATTERN.test(text),
    hasLongBase64: LONG_BASE64_PATTERN.test(text),
    hasLightPlaceholder: LIGHT_PLACEHOLDER_PATTERN.test(text),
    hasAdminLabels: ADMIN_LABEL_PATTERN.test(text),
    hasActiveTags,
    hasEventAttributes: EVENT_ATTRIBUTE_PATTERN.test(text),
    hasUnsafeUrls: UNSAFE_URL_PATTERN.test(text),
  });
}

export function preflightCafe24ProductPayload(product = {}) {
  const checks = CAFE24_DETAIL_FIELDS
    .filter(field => String(product?.[field] || '').trim())
    .map(field => Object.freeze({ field, check: preflightCafe24DetailHtml(product[field]) }));
  const failed = checks.filter(entry => !entry.check.ok);
  return Object.freeze({
    ok: failed.length === 0,
    checks: Object.freeze(checks),
    unsafeFields: Object.freeze(failed.map(entry => entry.field)),
    issues: Object.freeze([...new Set(failed.flatMap(entry => entry.check.issues))]),
  });
}

export function sanitizeCafe24ProductPayload(product = {}, options = {}) {
  const clean = cloneRecord(product);
  const removedFields = [];
  for (const field of CAFE24_UNSUPPORTED_PRODUCT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(clean, field)) continue;
    delete clean[field];
    removedFields.push(field);
  }
  const preflight = preflightCafe24ProductPayload(clean);
  if (!preflight.ok) {
    for (const field of preflight.unsafeFields) {
      const fallback = String(options.safeDetailHtml || '').trim();
      const fallbackCheck = fallback ? preflightCafe24DetailHtml(fallback) : null;
      if (fallbackCheck?.ok) clean[field] = fallback;
      else delete clean[field];
    }
    if (!clean.description && !clean.mobile_description && clean.separated_mobile_description === 'F') {
      delete clean.separated_mobile_description;
    }
  }
  return Object.freeze({
    product: Object.freeze(clean),
    removedFields: Object.freeze(removedFields),
    preflight,
  });
}

export function buildCafe24ProductPayload(input = {}) {
  const fields = normalizeCafe24ProductFields(input.fields || input.product || input);
  const optionModel = buildCafe24OptionModel(input.options || {});
  if (optionModel.hasOption) {
    fields.has_option = 'T';
    fields.option_type = 'T';
    fields.option_list_type = 'C';
    fields.options = optionModel.groups.map(group => ({
      name: group.name,
      option_value: group.values.map(value => ({ option_text: value })),
    }));
  }
  return sanitizeCafe24ProductPayload(fields, input.sanitizeOptions).product;
}

export function createCafe24PayloadGuard() {
  return Object.freeze({
    preflightProduct: preflightCafe24ProductPayload,
    sanitizeProduct(product, options = {}) {
      return sanitizeCafe24ProductPayload(product, options).product;
    },
  });
}
