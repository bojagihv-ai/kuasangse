import { buildCafe24ProductPayload, preflightCafe24ProductPayload } from './payload.mjs';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

export function buildCafe24SyncPlan(input = {}) {
  const productNo = String(input.productNo || input.product_no || '').trim();
  const product = buildCafe24ProductPayload(input);
  const preflight = preflightCafe24ProductPayload(product);
  return Object.freeze({
    mode: productNo ? 'update' : 'create',
    productNo,
    method: productNo ? 'PUT' : 'POST',
    path: productNo ? `/api/v2/admin/products/${encodeURIComponent(productNo)}` : '/api/v2/admin/products',
    product,
    preflight,
  });
}

export function createCafe24SyncService(options = {}) {
  const request = requiredFunction(options.client?.request, 'client.request').bind(options.client);
  const getOperationToken = requiredFunction(options.getOperationToken, 'getOperationToken');
  return Object.freeze({
    preview: buildCafe24SyncPlan,
    async execute(input = {}) {
      const operationToken = getOperationToken();
      const plan = buildCafe24SyncPlan(input);
      if (!plan.preflight.ok) throw new Error('CAFE24_PAYLOAD_PREFLIGHT_FAILED');
      if (getOperationToken() !== operationToken) throw new Error('STALE_CAFE24_OPERATION');
      const response = await request({
        method: plan.method,
        path: plan.path,
        body: { product: plan.product },
      });
      if (getOperationToken() !== operationToken) throw new Error('STALE_CAFE24_OPERATION');
      return Object.freeze({ plan, response });
    },
  });
}
