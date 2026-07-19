import { buildCafe24SyncPlan } from './sync.mjs';

export function buildCafe24PublishPreview(input = {}) {
  const plan = buildCafe24SyncPlan(input);
  const fields = Object.entries(plan.product).map(([field, value]) => Object.freeze({
    field,
    value,
    displayValue: typeof value === 'object' ? JSON.stringify(value) : String(value),
  }));
  return Object.freeze({
    title: plan.mode === 'update' ? 'Cafe24 기존 상품 수정 미리보기' : 'Cafe24 새 상품 등록 미리보기',
    mode: plan.mode,
    productNo: plan.productNo,
    fieldCount: fields.length,
    fields: Object.freeze(fields),
    preflight: plan.preflight,
  });
}
