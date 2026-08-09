const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_ID = 'src/domains/cafe24/category-requirements.mjs';
const MODULE_PATH = path.join(ROOT, MODULE_ID);
const CATALOG_PATH = '/api/invoke/cafe24_control_tower/cafe24-catalog';
const CATEGORY_TEMPLATE = '/api/v2/admin/categories/{category_no}';

const identity = Object.freeze({
  contractType: 'work-order',
  contractVersion: '1.0.0',
  capabilityVersion: '1.0.0',
  commandId: 'category-command-001',
  batchId: 'batch-001',
  productId: 'product-001',
  productKey: 'product-key-001',
  stageId: 'required_fields',
  attempt: 1,
  issuedAt: '2026-07-31T00:00:00Z',
  deadlineAt: '2026-07-31T00:05:00Z',
  workspaceId: 'workspace-001',
  currentRunId: 'run-001',
  inputImageFingerprint: `sha256:${'a'.repeat(64)}`,
  expectedWorkfileRevision: 7,
  operationToken: 'operation-001',
  idempotencyKey: 'category-command-001',
});

function command(overrides = {}) {
  return {
    ...identity,
    operation: {
      capability: 'cafe24/category-requirements:v1',
      parameters: {
        mallId: 'mall-a',
        categoryNo: '24',
        expectedSchemaVersion: '2026-07-01',
      },
    },
    evidenceRefs: ['manual://task-8'],
    ...overrides,
  };
}

const digest = async value => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;

function catalog({
  endpoints = [{
    method: 'GET',
    pathTemplate: CATEGORY_TEMPLATE,
    schemaVersion: '2026-07-01',
    authoritative: true,
  }],
} = {}) {
  return {
    catalogVersion: 'catalog-v1',
    catalogDigest: 'sha256:catalog',
    endpoints,
  };
}

async function load() {
  return import(pathToFileURL(MODULE_PATH).href);
}

async function createHarness({ catalogValue = catalog(), providerValue } = {}) {
  const calls = [];
  const { createCafe24CategoryRequirementsCapability } = await load();
  const capability = createCafe24CategoryRequirementsCapability({
    getCurrentIdentity: () => identity,
    digest,
    async catalogTransport(request) {
      calls.push({ channel: 'catalog', ...request });
      return catalogValue;
    },
    async transport(request) {
      calls.push({ channel: 'cafe24', ...request });
      return providerValue;
    },
  });
  return { calls, capability };
}

test('category capability는 authoritative 응답을 출처 digest가 있는 resolved 결과로 만든다', async () => {
  const providerValue = {
    categoryNo: '24',
    schemaVersion: '2026-07-01',
    authoritative: true,
    requirements: [
      {
        fieldId: 'salePrice',
        required: true,
        authority: 'cafe24-category-schema',
        evidenceRefs: ['cafe24://categories/24/salePrice'],
      },
      {
        fieldId: 'optionName',
        required: true,
        authority: 'cafe24-category-schema',
        evidenceRefs: ['cafe24://categories/24/optionName'],
      },
    ],
    unsupportedFields: [],
  };
  const { calls, capability } = await createHarness({ providerValue });

  const result = await capability.resolve(command());

  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.requiredFields.map(field => field.fieldId), ['salePrice', 'optionName']);
  assert.deepEqual(result.unsupportedFields, []);
  assert.equal(result.categoryNo, '24');
  assert.equal(result.catalogVersion, 'catalog-v1');
  assert.equal(result.catalogDigest, 'sha256:catalog');
  assert.equal(result.source.endpoint, '/api/v2/admin/categories/24');
  assert.match(result.source.evidenceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(calls.map(call => [call.channel, call.method, call.path]), [
    ['catalog', 'POST', CATALOG_PATH],
    ['cafe24', 'GET', '/api/v2/admin/categories/24'],
  ]);
});

test('category capability는 partial과 unsupported를 추측 없이 구분한다', async () => {
  const partialHarness = await createHarness({
    providerValue: {
      categoryNo: '24',
      schemaVersion: '2026-07-01',
      authoritative: true,
      requirements: [
        {
          fieldId: 'salePrice',
          required: true,
          authority: 'cafe24-category-schema',
          evidenceRefs: ['cafe24://categories/24/salePrice'],
        },
        {
          fieldId: 'guessedMaterial',
          required: true,
          authority: 'provider-metadata',
          evidenceRefs: [],
        },
      ],
      unsupportedFields: ['certification'],
    },
  });
  const unsupportedHarness = await createHarness({
    catalogValue: catalog({ endpoints: [] }),
  });

  const partial = await partialHarness.capability.resolve(command());
  const unsupported = await unsupportedHarness.capability.resolve(command());

  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.requiredFields.map(field => field.fieldId), ['salePrice']);
  assert.deepEqual(partial.unsupportedFields, ['certification', 'guessedMaterial']);
  assert.equal(unsupported.status, 'unsupported');
  assert.deepEqual(unsupported.requiredFields, []);
  assert.deepEqual(unsupported.source, {
    endpoint: CATALOG_PATH,
    evidenceDigest: 'sha256:catalog',
  });
  assert.equal(unsupportedHarness.calls.some(call => call.channel === 'cafe24'), false);
});

test('category capability는 stale identity와 stale schema를 transport 전에 거부한다', async () => {
  const { Cafe24CategoryRequirementsError } = await load();
  const staleIdentity = await createHarness();
  const staleSchema = await createHarness();

  await assert.rejects(
    staleIdentity.capability.resolve(command({ currentRunId: 'run-stale' })),
    error => error instanceof Cafe24CategoryRequirementsError && error.code === 'stale_identity',
  );
  await assert.rejects(
    staleSchema.capability.resolve(command({
      operation: {
        capability: 'cafe24/category-requirements:v1',
        parameters: {
          mallId: 'mall-a',
          categoryNo: '24',
          expectedSchemaVersion: '2025-01-01',
        },
      },
    })),
    error => error instanceof Cafe24CategoryRequirementsError && error.code === 'stale_schema',
  );
  assert.equal(staleIdentity.calls.length, 0);
  assert.deepEqual(staleSchema.calls.map(call => call.channel), ['catalog']);
});

test('category capability는 catalog가 광고한 GET category endpoint만 호출한다', async () => {
  const { Cafe24CategoryRequirementsError } = await load();
  const unadvertised = await createHarness({
    catalogValue: catalog({
      endpoints: [{
        method: 'POST',
        pathTemplate: CATEGORY_TEMPLATE,
        schemaVersion: '2026-07-01',
        authoritative: true,
      }],
    }),
  });

  await assert.rejects(
    unadvertised.capability.resolve(command()),
    error => error instanceof Cafe24CategoryRequirementsError && error.code === 'endpoint_unadvertised',
  );
  assert.deepEqual(unadvertised.calls.map(call => call.channel), ['catalog']);
});

test('category capability는 manifest와 runtime registry에서 정확히 한 번 발견된다', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/runtime-manifest.json'), 'utf8'));
  const ids = await import(pathToFileURL(path.join(ROOT, 'src/modules/runtime-module-ids.mjs')).href);
  const domain = await import(pathToFileURL(path.join(ROOT, 'src/domains/cafe24/index.mjs')).href);
  const source = fs.readFileSync(MODULE_PATH, 'utf8');

  assert.equal(manifest.modules.filter(id => id === MODULE_ID).length, 1);
  assert.equal(ids.KNOWN_FOUNDATION_MODULE_IDS.filter(id => id === MODULE_ID).length, 1);
  assert.equal(typeof domain.createCafe24Domain, 'function');
  assert.doesNotMatch(
    source,
    /\b(?:window|document|localStorage|sessionStorage|indexedDB|globalThis|fetch|app-core-0[1-6])\b/,
  );
});
