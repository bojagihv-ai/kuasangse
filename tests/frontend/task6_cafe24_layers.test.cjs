const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const DOMAIN = path.join(ROOT, 'src', 'domains', 'cafe24');

function read(name) {
  return fs.readFileSync(path.join(DOMAIN, name), 'utf8');
}

async function load(name) {
  return import(pathToFileURL(path.join(DOMAIN, name)).href);
}

test('Cafe24 ESM은 fields→options→payload→api→sync→ui 단방향 import만 사용한다', () => {
  const expectedImports = {
    'fields.mjs': [],
    'options.mjs': ['./fields.mjs'],
    'payload.mjs': ['./fields.mjs', './options.mjs'],
    'api.mjs': ['./payload.mjs'],
    'sync.mjs': ['./payload.mjs'],
    'ui.mjs': ['./sync.mjs'],
  };
  for (const [file, expected] of Object.entries(expectedImports)) {
    const imports = [...read(file).matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1]);
    assert.deepEqual(imports, expected, file);
    assert.doesNotMatch(
      read(file),
      /\b(?:window|document|localStorage|sessionStorage|factoryState|state|fetch)\s*(?=\?*\.|\(|\[)/,
      file,
    );
  }
});

test('Cafe24 로컬 payload 흐름은 필드·옵션을 정규화하고 위험 상세 HTML을 전송값에서 제거한다', async () => {
  const { buildCafe24ProductPayload, preflightCafe24ProductPayload } = await load('payload.mjs');
  const product = buildCafe24ProductPayload({
    fields: {
      productName: '슬라브나비수저집',
      sale_price: '4,000',
      display_status: true,
      selling_status: false,
      description: '<p>설명</p><img src="data:image/png;base64,AAAA">',
      cultural_tax_deduction: 'T',
    },
    options: {
      option_name: '색상',
      option_values: ['빨강', '빨강', '파랑'],
    },
  });
  assert.equal(product.product_name, '슬라브나비수저집');
  assert.equal(product.price, '4000');
  assert.equal(product.display, 'T');
  assert.equal(product.selling, 'F');
  assert.equal(product.description, undefined);
  assert.equal(product.cultural_tax_deduction, undefined);
  assert.deepEqual(product.options[0].option_value.map(row => row.option_text), ['빨강', '파랑']);
  assert.equal(preflightCafe24ProductPayload(product).ok, true);
});

test('Cafe24 API 계층은 실제 transport 직전에 주입된 payload guard를 적용한다', async () => {
  const { createCafe24ApiClient } = await load('api.mjs');
  let captured;
  const client = createCafe24ApiClient({
    async transport(request) {
      captured = request;
      return { ok: true };
    },
  });
  await client.request({
    method: 'PUT',
    path: '/api/v2/admin/products/2534',
    body: {
      product: {
        product_name: '안전한 이름',
        description: '<img src="data:image/png;base64,AAAA">',
        product_volume: '1x2x3',
      },
    },
  });
  assert.equal(captured.body.product.product_name, '안전한 이름');
  assert.equal(captured.body.product.description, undefined);
  assert.equal(captured.body.product.product_volume, undefined);
});

test('Cafe24 preflight는 활성 태그·이벤트 속성·위험 URL을 상세 HTML에서 차단한다', async () => {
  const { preflightCafe24DetailHtml, sanitizeCafe24ProductPayload } = await load('payload.mjs');
  const unsafe = '<p>안전한 문장</p><img src=https://example.com/a.png onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">열기</a>';
  const preflight = preflightCafe24DetailHtml(unsafe);
  assert.equal(preflight.ok, false);
  assert.equal(preflight.hasEventAttributes, true);
  const sanitized = sanitizeCafe24ProductPayload({ description: unsafe }, { safeDetailHtml: '<p>대체 설명</p>' });
  assert.equal(sanitized.product.description, '<p>대체 설명</p>');
  assert.equal(preflightCafe24DetailHtml(sanitized.product.description).ok, true);
});

test('Cafe24 preflight는 안전한 상세페이지 style을 보존하고 위험 CSS URL은 차단한다', async () => {
  const { preflightCafe24DetailHtml, sanitizeCafe24ProductPayload } = await load('payload.mjs');
  const safe = '<meta charset="UTF-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="https://fonts.googleapis.com/css2"><style>.detail{color:#333;background:#fff}</style><section class="detail">방울수저집</section>';
  const safePreflight = preflightCafe24DetailHtml(safe);
  assert.equal(safePreflight.ok, true);
  assert.equal(safePreflight.hasActiveTags, false);
  assert.equal(sanitizeCafe24ProductPayload({ description: safe }).product.description, safe);

  const unsafe = '<style>.detail{background-image:url(javascript:alert(1))}</style><section>설명</section>';
  const unsafePreflight = preflightCafe24DetailHtml(unsafe);
  assert.equal(unsafePreflight.ok, false);
  assert.equal(unsafePreflight.hasUnsafeUrls, true);

  const refresh = preflightCafe24DetailHtml('<meta http-equiv="refresh" content="0;url=https://example.com">');
  assert.equal(refresh.ok, false);
  assert.equal(refresh.hasActiveTags, true);
});

test('Cafe24 sync 계층은 작업공간이 바뀐 뒤 늦게 도착한 응답을 승인하지 않는다', async () => {
  const { createCafe24ApiClient } = await load('api.mjs');
  const { createCafe24SyncService } = await load('sync.mjs');
  let release;
  let token = 'workspace-a:fence-1';
  const client = createCafe24ApiClient({
    transport: () => new Promise(resolve => { release = resolve; }),
  });
  const sync = createCafe24SyncService({
    client,
    getOperationToken: () => token,
  });
  const pending = sync.execute({
    productNo: '2534',
    fields: { product_name: '슬라브나비수저집', price: '4000' },
  });
  token = 'workspace-b:fence-2';
  release({ ok: true });
  await assert.rejects(pending, /STALE_CAFE24_OPERATION/);
});

test('classic Cafe24 API는 늦게 정의되는 payload 함수를 역참조하지 않고 ESM guard를 주입받는다', () => {
  const api = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-api.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  assert.doesNotMatch(api, /factoryCafe24DetailPayloadPreflight/);
  assert.doesNotMatch(api, /factoryCafe24SanitizeDetailHtmlPayload/);
  assert.match(api, /function installCafe24ConsolePayloadGuard/);
  assert.match(app, /createCafe24Domain/);
  assert.match(app, /installCafe24ConsolePayloadGuard\(cafe24Domain\.payloadGuard\)/);
});
