import { createCafe24PayloadGuard } from './payload.mjs';

function requiredFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function isRootProductWrite(method, path) {
  const verb = String(method || '').toUpperCase();
  const cleanPath = String(path || '').split('?')[0].replace(/\/+$/, '');
  return ['POST', 'PUT', 'PATCH'].includes(verb) && (
    cleanPath === '/api/v2/admin/products' ||
    /^\/api\/v2\/admin\/products\/[^/]+$/i.test(cleanPath)
  );
}

export function createCafe24ApiClient(options = {}) {
  const transport = requiredFunction(options.transport, 'transport');
  const payloadGuard = options.payloadGuard || createCafe24PayloadGuard();
  return Object.freeze({
    async request(request = {}) {
      const method = String(request.method || 'GET').toUpperCase();
      const path = String(request.path || '');
      let body = request.body;
      if (isRootProductWrite(method, path) && body && typeof body === 'object') {
        const root = body.product && typeof body.product === 'object' ? body.product : body;
        const sanitized = payloadGuard.sanitizeProduct(root, request.sanitizeOptions || {});
        body = body.product && typeof body.product === 'object'
          ? { ...body, product: sanitized }
          : sanitized;
      }
      return transport({ ...request, method, path, body });
    },
  });
}

export { isRootProductWrite as cafe24IsRootProductWrite };
