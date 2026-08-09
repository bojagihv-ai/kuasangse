const DEFAULT_BASE_URL = 'http://127.0.0.1:8200/api/pdp-assets/v1';
const SERVICE_KEY_HEADER = 'X-PDP-Control-Service-Key';

export class PdpApiError extends Error {
  constructor(code, { status = null, details = null, cause } = {}) {
    const message = code === 'backend_boundary_required' ? 'backend boundary required' : code;
    super(message, { cause });
    this.name = 'PdpApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function object(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PdpApiError('invalid_response', { details: { path } });
  }
  return value;
}

function required(value, key, type, path) {
  if (!(key in value) || typeof value[key] !== type) {
    throw new PdpApiError('invalid_response', { details: { path: `${path}.${key}` } });
  }
}

function validateProduct(raw) {
  const value = object(raw, '$');
  const catalog = object(value.catalog, '$.catalog');
  object(value.workspace, '$.workspace');
  required(catalog, 'jcode', 'number', '$.catalog');
  if (!Number.isInteger(catalog.jcode)) {
    throw new PdpApiError('invalid_response', { details: { path: '$.catalog.jcode' } });
  }
  return value;
}

function validateFields(raw) {
  const value = object(raw, '$');
  required(value, 'jcode', 'number', '$');
  required(value, 'version', 'number', '$');
  if (!Array.isArray(value.fields)) {
    throw new PdpApiError('invalid_response', { details: { path: '$.fields' } });
  }
  return value;
}

function validateAssets(raw) {
  const value = object(raw, '$');
  required(value, 'workspaceVersion', 'number', '$');
  if (!Array.isArray(value.items)) {
    throw new PdpApiError('invalid_response', { details: { path: '$.items' } });
  }
  if (!('currentACutLinkId' in value)) {
    throw new PdpApiError('invalid_response', { details: { path: '$.currentACutLinkId' } });
  }
  return value;
}

function validatePage(raw, itemFields) {
  const value = object(raw, '$');
  if (!Array.isArray(value.items)) {
    throw new PdpApiError('invalid_response', { details: { path: '$.items' } });
  }
  for (const [index, item] of value.items.entries()) {
    const parsed = object(item, `$.items[${index}]`);
    for (const [key, type] of itemFields) required(parsed, key, type, `$.items[${index}]`);
  }
  return value;
}

function validateSection(raw) {
  return validatePage({ items: [raw] }, [
    ['id', 'string'],
    ['sectionKey', 'string'],
    ['sectionType', 'string'],
    ['version', 'number'],
  ]).items[0];
}

function validateComposition(raw) {
  return validatePage({ items: [raw] }, [
    ['id', 'string'],
    ['name', 'string'],
    ['version', 'number'],
  ]).items[0];
}

function validateJcode(jcode) {
  if (!Number.isInteger(jcode) || jcode <= 0) {
    throw new PdpApiError('invalid_request', { details: { path: '$.jcode' } });
  }
}

function validateCommand(command) {
  const value = object(command, '$');
  if (typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim()) {
    throw new PdpApiError('invalid_request', { details: { path: '$.idempotencyKey' } });
  }
  object(value.payload, '$.payload');
  return value;
}

function query(options = {}) {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.includePayload !== undefined) params.set('includePayload', String(options.includePayload));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function createPdpApiClient({
  baseUrl = DEFAULT_BASE_URL,
  serviceKey,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof globalThis.window !== 'undefined') {
    throw new PdpApiError('backend_boundary_required');
  }
  if (typeof serviceKey !== 'string' || !serviceKey.trim()) {
    throw new PdpApiError('service_key_missing');
  }
  if (typeof fetchImpl !== 'function') {
    throw new PdpApiError('fetch_unavailable');
  }
  const root = new URL(baseUrl);
  if (!/^https?:$/.test(root.protocol)) throw new PdpApiError('base_url_invalid');

  async function request(method, endpoint, { body, headers = {}, validate = object, signal } = {}) {
    let response;
    try {
      response = await fetchImpl(new URL(endpoint.replace(/^\//, ''), `${root.href.replace(/\/?$/, '/')}`), {
        method,
        headers: {
          Accept: 'application/json',
          [SERVICE_KEY_HEADER]: serviceKey,
          ...(body === undefined || body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      throw new PdpApiError('network_error', { cause });
    }
    let raw;
    try {
      raw = await response.json();
    } catch (cause) {
      throw new PdpApiError('invalid_response', { status: response.status, cause });
    }
    if (!response.ok) {
      const envelope = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const details = envelope.error !== null && typeof envelope.error === 'object' ? envelope.error : null;
      const code = typeof details?.code === 'string' ? details.code : 'request_failed';
      throw new PdpApiError(code, { status: response.status, details });
    }
    return validate(raw, '$');
  }

  const productPath = jcode => {
    validateJcode(jcode);
    return `products/${jcode}`;
  };
  const page = (jcode, collection, options, fields) => request(
    'GET',
    `${productPath(jcode)}/${collection}${query(options)}`,
    { validate: raw => validatePage(raw, fields) },
  );

  return Object.freeze({
    getProduct: jcode => request('GET', productPath(jcode), { validate: validateProduct }),
    getFields: jcode => request('GET', `${productPath(jcode)}/fields`, { validate: validateFields }),
    getAssets: jcode => request('GET', `${productPath(jcode)}/assets`, { validate: validateAssets }),
    getSections: (jcode, options) => page(jcode, 'sections', options, [['id', 'string'], ['version', 'number']]),
    getCompositions: (jcode, options) => page(jcode, 'compositions', options, [['id', 'string'], ['version', 'number']]),
    getRuns: (jcode, options) => page(jcode, 'runs', options, [['id', 'string'], ['version', 'number']]),
    getEvents: (jcode, options) => page(jcode, 'events', options, [['id', 'string'], ['eventType', 'string']]),
    saveField(jcode, command) {
      const value = validateCommand(command);
      return request('PATCH', `${productPath(jcode)}/fields`, {
        body: value.payload,
        headers: {
          'Idempotency-Key': value.idempotencyKey,
          ...(value.expectedVersion === undefined ? {} : { 'If-Match': String(value.expectedVersion) }),
        },
      });
    },
    uploadAsset(jcode, command) {
      const value = object(command, '$');
      if (!(value.body instanceof FormData)) throw new PdpApiError('invalid_request');
      return request('POST', `${productPath(jcode)}/assets`, {
        body: value.body,
        headers: value.idempotencyKey ? { 'Idempotency-Key': value.idempotencyKey } : {},
      });
    },
    saveSection(jcode, command) {
      const value = validateCommand(command);
      return request('POST', `${productPath(jcode)}/sections`, {
        body: value.payload,
        headers: { 'Idempotency-Key': value.idempotencyKey },
        validate: validateSection,
      });
    },
    saveComposition(jcode, command) {
      const value = validateCommand(command);
      return request('POST', `${productPath(jcode)}/compositions`, {
        body: value.payload,
        headers: { 'Idempotency-Key': value.idempotencyKey },
        validate: validateComposition,
      });
    },
  });
}
