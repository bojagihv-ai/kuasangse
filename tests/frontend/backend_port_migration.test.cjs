const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const NEW_ORIGIN = 'http://127.0.0.1:43030';

const source = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

test('original backend defaults migrate detail and production control together', () => {
  // Given: the two launch/config surfaces and production control page defaults.
  const launcher = source('launcher.ps1');
  const config = source('control_tower/backend/config.py');
  const tower = source('control_tower/frontend/control-tower.html');

  // When/Then: all new sessions choose the one permanently assigned backend origin.
  assert.match(launcher, /\[int\]\$BackendPort = 43030/);
  assert.match(config, /DEFAULT_FACTORY_BACKEND_URL: Final = "http:\/\/127\.0\.0\.1:43030"/);
  assert.match(tower, /const FACTORY_BACKEND = localOrigin\("factoryBackend", "http:\/\/127\.0\.0\.1:43030"\)/);
});

test('stale 5050 and 41026 detail preferences are migrated at the shared load boundary', () => {
  // Given: an existing browser profile whose saved backend still names a retired loopback runtime port.
  const core = source('src/app-core-02.js');
  const start = core.indexOf('function loadBackendUrl()');
  const end = core.indexOf('\nfunction defaultServerAutomationApiBase()', start);
  const values = new Map([['gemini_backend_url', 'http://127.0.0.1:41026']]);
  const localStorage = {
    getItem: key => values.get(key) || '',
    setItem: (key, value) => values.set(key, value),
  };

  // When: the real shared preference boundary loads the stale value.
  const loadBackendUrl = new Function('localStorage', `${core.slice(start, end)}\nreturn loadBackendUrl;`)(localStorage);

  // Then: runtime and persisted preference move to 43030 without rewriting saved data URLs.
  assert.equal(loadBackendUrl(), NEW_ORIGIN);
  assert.equal(values.get('gemini_backend_url'), NEW_ORIGIN);

  values.set('gemini_backend_url', 'http://localhost:5050/');
  assert.equal(loadBackendUrl(), NEW_ORIGIN);
  assert.equal(values.get('gemini_backend_url'), NEW_ORIGIN);

  const loader = source('src/app-loader.js');
  const loaderStart = loader.indexOf('function workspaceAuthorityServerBases()');
  const loaderEnd = loader.indexOf('\n  async function readManifest()', loaderStart);
  const workspaceAuthorityServerBases = new Function(
    'localStorage',
    'location',
    `${loader.slice(loaderStart, loaderEnd)}\nreturn workspaceAuthorityServerBases;`,
  )(localStorage, { origin: 'http://127.0.0.1:8081' });
  assert.deepEqual(workspaceAuthorityServerBases(), [NEW_ORIGIN, 'http://127.0.0.1:8081']);

  values.set('gemini_backend_url', 'https://custom.example.test:41026/api');
  assert.equal(loadBackendUrl(), 'https://custom.example.test:41026/api');
});

test('server last-work adapter migrates only legacy loopback preferences', () => {
  // Given: the shared persistence adapter and three saved browser preferences.
  const adapter = source('src/modules/persistence/server-last-work-adapter.mjs');
  const start = adapter.indexOf('function defaultBases(root)');
  const end = adapter.indexOf('\nfunction compactServerPersistenceEnvelope(', start);
  assert.ok(start >= 0 && end > start);
  const defaultBases = new Function(`${adapter.slice(start, end)}\nreturn defaultBases;`)();
  const root = configured => ({
    location: { origin: 'http://127.0.0.1:8081' },
    localStorage: { getItem: () => configured },
  });

  // When/Then: only the retired loopback origins migrate; an explicit custom origin remains first.
  assert.deepEqual(defaultBases(root('http://127.0.0.1:41026')), [NEW_ORIGIN, 'http://127.0.0.1:8081']);
  assert.deepEqual(defaultBases(root('http://localhost:5050/')), [NEW_ORIGIN, 'http://127.0.0.1:8081']);
  assert.deepEqual(defaultBases(root('https://custom.example.test:41026/api/')), [
    'https://custom.example.test:41026/api',
    'http://127.0.0.1:8081',
    NEW_ORIGIN,
  ]);
});

test('runtime authority fallbacks use 43030 while legacy 41026 remains migration-only', () => {
  // Given: backend authority boundaries used before full application state is available.
  const boundaries = [
    source('src/app-loader.js'),
    source('src/modules/persistence/server-last-work-adapter.mjs'),
    source('src/modules/workspace-lock-protocol.mjs'),
    source('src/modules/local-service-preflight.mjs'),
  ];

  // When/Then: each boundary knows the assigned origin and none retains 41026 as an operational fallback.
  for (const boundary of boundaries) {
    assert.match(boundary, /http:\/\/127\.0\.0\.1:43030/);
    assert.doesNotMatch(boundary, /['"]http:\/\/127\.0\.0\.1:5050['"]/);
    assert.doesNotMatch(boundary, /['"]http:\/\/127\.0\.0\.1:41026['"]/);
  }
});

test('public API and docs launchers target the assigned backend', () => {
  const launcher = source('tools/launch_public_api.ps1');
  const docs = source('tools/launch_public_api_docs.vbs');

  assert.equal(launcher.match(/\$healthUrl = "([^"]+)"/)?.[1], `${NEW_ORIGIN}/api/v1/health`);
  assert.equal(launcher.match(/--listen=([^"\s]+)/)?.[1], '127.0.0.1:43030');
  assert.deepEqual(docs.match(/http:\/\/127\.0\.0\.1:\d+\/api\/v1\/docs/g), [
    `${NEW_ORIGIN}/api/v1/docs`, `${NEW_ORIGIN}/api/v1/docs`,
  ]);
});

test('image proxy bases preserve the custom base and omit the retired fallback', () => {
  const core = source('src/app-core-02.js');
  const start = core.indexOf('function getImageProxyBackendBases()');
  const end = core.indexOf('\nasync function fetchImageDataUrlViaProxy(', start);
  assert.ok(start >= 0 && end > start);
  const load = new Function('state', `${core.slice(start, end)}\nreturn getImageProxyBackendBases;`);

  for (const [configured, expected] of [
    [' https://custom.example.test/backend/// ', ['https://custom.example.test/backend', 'http://127.0.0.1:5000', NEW_ORIGIN]],
    [' http://localhost:5050/// ', [NEW_ORIGIN, 'http://127.0.0.1:5000']],
    ['http://127.0.0.1:5050', [NEW_ORIGIN, 'http://127.0.0.1:5000']],
    ['http://localhost:41026', [NEW_ORIGIN, 'http://127.0.0.1:5000']],
    ['https://custom.example.test:5050/', ['https://custom.example.test:5050', 'http://127.0.0.1:5000', NEW_ORIGIN]],
    ['', ['http://127.0.0.1:5000', NEW_ORIGIN]],
    [`${NEW_ORIGIN}/`, [NEW_ORIGIN, 'http://127.0.0.1:5000']],
  ]) {
    assert.deepEqual(load(Object.freeze({ backendBaseUrl: configured }))(), expected);
  }
});

test('server last-work bases preserve explicit overrides and omit the retired fallback', () => {
  const core = source('src/app-core-02.js');
  const start = core.indexOf('function getServerLastWorkBases()');
  const end = core.indexOf('\nfunction getStoredLastWorkDraftScope()', start);
  assert.ok(start >= 0 && end > start);
  const load = new Function('state', 'loadBackendUrl', `${core.slice(start, end)}\nreturn getServerLastWorkBases;`);

  for (const [configured, saved, expected] of [
    [' https://custom.example.test/backend/// ', 'https://saved.example.test/api/', ['https://custom.example.test/backend', 'https://saved.example.test/api', NEW_ORIGIN]],
    ['http://localhost:5050/', 'http://127.0.0.1:5050', [NEW_ORIGIN]],
    ['http://127.0.0.1:5050', 'http://localhost:5050/', [NEW_ORIGIN]],
    ['http://localhost:41026/', 'http://127.0.0.1:41026', [NEW_ORIGIN]],
    ['https://custom.example.test:5050/', 'http://localhost:5050', ['https://custom.example.test:5050', NEW_ORIGIN]],
    ['', '', [NEW_ORIGIN]],
    ['https://custom.example.test:41026/', NEW_ORIGIN, ['https://custom.example.test:41026', NEW_ORIGIN]],
  ]) {
    assert.deepEqual(load(Object.freeze({ backendBaseUrl: configured }), () => saved)(), expected);
  }
});
