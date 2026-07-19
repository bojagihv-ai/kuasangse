const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const TARGET_RED = process.env.KUASANGSE_MENU_TARGET_RED === '1';
const futureTargetTest = TARGET_RED ? test : test.skip;

const TARGETS = [
  ['upload', 'src/menus/upload-menu.mjs', 'product-analysis', 'menu:v1 + product commands', 'MENU-UPLOAD'],
  ['analyzing', 'src/menus/analysis-menu.mjs', 'product-analysis', 'menu:v1 + analysis commands', 'MENU-ANALYSIS'],
  ['competitor', 'src/menus/competitor-menu.mjs', 'competitors', 'menu:v1 + competitor commands', 'MENU-COMP'],
  ['sections', 'src/menus/sections-menu.mjs', 'detail-document', 'menu:v1 + section commands', 'MENU-SECTIONS'],
  ['generating', 'src/menus/generating-menu.mjs', 'detail-document', 'menu:v1 + generation commands', 'MENU-GENERATE'],
  ['preview', 'src/menus/preview-menu.mjs', 'detail-document', 'menu:v1 + preview selectors', 'MENU-PREVIEW'],
  ['imagecuts', 'src/menus/imagecuts-menu.mjs', 'image-cuts', 'menu:v1 + cut commands', 'MENU-CUTS'],
  ['optionsorter', 'src/menus/optionsorter-menu.mjs', 'options', 'menu:v1 + option commands', 'MENU-OPTIONS'],
  ['factory', 'src/menus/factory/factory-menu.mjs', 'factory', 'menu:v1 + factory composition', 'MENU-FACTORY'],
  ['automation', 'src/menus/automation-menu.mjs', 'automation', 'menu:v1 + automation commands', 'MENU-AUTO'],
  ['modelsettings', 'src/menus/modelsettings-menu.mjs', 'app-preferences', 'menu:v1 + settings commands', 'MENU-SETTINGS'],
  ['manual', 'src/menus/manual-menu.mjs', 'manual-ui', 'menu:v1', 'MENU-MANUAL'],
  ['factory/start', 'src/menus/factory/tabs/start-tab.mjs', 'factory', 'factory-tab:v1', 'FACTORY-START'],
  ['factory/db', 'src/menus/factory/tabs/db-tab.mjs', 'product-db', 'factory-tab:v1', 'FACTORY-DB'],
  ['factory/fields', 'src/menus/factory/tabs/fields-tab.mjs', 'product-db', 'factory-tab:v1', 'FACTORY-FIELDS'],
  ['factory/competitor', 'src/menus/factory/tabs/competitor-tab.mjs', 'competitors', 'factory-tab:v1', 'FACTORY-COMP'],
  ['factory/assets', 'src/menus/factory/tabs/assets-tab.mjs', 'factory-assets', 'factory-tab:v1', 'FACTORY-ASSETS'],
  ['factory/sections', 'src/menus/factory/tabs/sections-tab.mjs', 'detail-document', 'factory-tab:v1', 'FACTORY-SECTIONS'],
  ['factory/publish', 'src/menus/factory/tabs/publish-tab.mjs', 'cafe24', 'factory-tab:v1', 'FACTORY-PUBLISH'],
].map(([id, implementation, owner, api, gate]) => ({ id, implementation, owner, api, gate }));

function absolute(relativePath) {
  return path.join(ROOT, ...relativePath.split('/'));
}

function source(relativePath) {
  return fs.readFileSync(absolute(relativePath), 'utf8');
}

test('target matrix는 12 sidebar route와 7 factory tab을 빠짐없이 한 번씩 소유한다', () => {
  assert.equal(TARGETS.length, 19);
  assert.equal(new Set(TARGETS.map(item => item.id)).size, 19);
  assert.equal(new Set(TARGETS.map(item => item.implementation)).size, 19);
  assert.equal(new Set(TARGETS.map(item => item.gate)).size, 19);
  assert.deepEqual(TARGETS.slice(0, 12).map(item => item.id), [
    'upload', 'analyzing', 'competitor', 'sections', 'generating', 'preview',
    'imagecuts', 'optionsorter', 'factory', 'automation', 'modelsettings', 'manual',
  ]);
  assert.deepEqual(TARGETS.slice(12).map(item => item.id), [
    'factory/start', 'factory/db', 'factory/fields', 'factory/competitor',
    'factory/assets', 'factory/sections', 'factory/publish',
  ]);
  assert.ok(TARGETS.every(item => item.owner && item.api && item.gate));
});

test('TARGET-MODULE-REGISTRY: 19개 경계는 구현을 위조하지 않고 owner/API/gate target descriptor를 제공한다', async () => {
  const registryPath = absolute('src/modules/module-registry.mjs');
  assert.equal(fs.existsSync(registryPath), true, 'missing module registry foundation');
  const registryUrl = `${pathToFileURL(registryPath).href}?target=${Date.now()}`;
  const { TARGET_MODULE_DESCRIPTORS } = await import(registryUrl);
  assert.deepEqual(TARGET_MODULE_DESCRIPTORS.map(item => ({
    id: item.id,
    implementation: item.implementation,
    owner: item.owner,
    api: item.api,
    gate: item.gate,
  })), TARGETS);
});

test('TARGET-MISSING-OWNERSHIP-CONTRACT: immutable store와 exhaustive registry가 19개 owner/API를 선언한다', () => {
  const required = [
    'src/modules/menu-contracts.mjs',
    'src/modules/app-store.mjs',
    'src/modules/composition-commands.mjs',
    'src/modules/module-registry.mjs',
    'src/modules/state-ownership.mjs',
  ];
  const missing = required.filter(file => !fs.existsSync(absolute(file)));
  assert.equal(missing.length, 0, `missing ownership/registry modules:\n${missing.map(file => `- ${file}`).join('\n')}`);

  const contracts = required.map(source).join('\n');
  for (const item of TARGETS) {
    assert.match(contracts, new RegExp(item.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${item.id}: registry id`);
    assert.match(contracts, new RegExp(item.owner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${item.id}: owned slice`);
    for (const token of item.api.split(/\s+\+\s+/)) {
      assert.match(contracts, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${item.id}: public API ${token}`);
    }
  }
  assert.match(contracts, /Object\.freeze|structuredClone|deepFreeze/);
  assert.match(contracts, /bind[\s\S]*dispos|onLeave/);
});

futureTargetTest('TARGET-MISSING-PERSISTENCE-GATEWAY: workspace 저장은 fencing metadata를 요구하는 단일 gateway로 모인다', () => {
  const gateway = 'src/modules/workspace-persistence.mjs';
  assert.equal(fs.existsSync(absolute(gateway)), true, `missing persistence gateway: ${gateway}`);
  const gatewaySource = [
    source(gateway),
    source('src/modules/persistence/contracts.mjs'),
  ].join('\n');

  for (const boundary of ['session', 'indexeddb', 'server', 'workfile', 'archive']) {
    assert.match(gatewaySource.toLowerCase(), new RegExp(boundary), `missing persistence boundary: ${boundary}`);
  }
  assert.match(gatewaySource, /operationId/);
  assert.match(gatewaySource, /revision/);
  assert.match(gatewaySource, /fencingToken/);
  assert.match(gatewaySource, /authoritative/i);
});

futureTargetTest('TARGET-MISSING-LOCK-CAS: server lease는 monotonic fence와 CAS 409/428을 강제한다', () => {
  const required = [
    'backend/services/workspace_lock_service.py',
    'backend/routes/api_workspace_lock.py',
  ];
  const missing = required.filter(file => !fs.existsSync(absolute(file)));
  assert.equal(missing.length, 0, `missing lock/CAS backend modules:\n${missing.map(file => `- ${file}`).join('\n')}`);

  const backend = required.map(source).join('\n').toLowerCase();
  assert.match(backend, /lease/);
  assert.match(backend, /fencing[_ ]token/);
  assert.match(backend, /compare[_ -]?and[_ -]?swap|\bcas\b/);
  assert.match(backend, /takeover/);
  assert.match(backend, /\b409\b/);
  assert.match(backend, /\b428\b/);
});

test('failing-first target는 아직 normal regression manifest에 등록하지 않는다', () => {
  const manifest = source('tools/regression_manifest.cjs');
  assert.doesNotMatch(manifest, /menu_modularization_target\.test\.cjs/);
});
