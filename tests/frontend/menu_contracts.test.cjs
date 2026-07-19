const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');

function moduleUrl(relativePath) {
  const file = path.join(ROOT, ...relativePath.split('/'));
  return `${pathToFileURL(file).href}?test=${Date.now()}-${Math.random()}`;
}

function validDefinition(overrides = {}) {
  return {
    version: 'menu:v1',
    id: 'upload',
    routes: ['upload'],
    ownedSlices: ['productAnalysis'],
    capabilities: ['product:read'],
    select: state => state.productAnalysis,
    commands: {
      refresh: {
        capability: 'product:read',
        execute: value => `refresh:${value}`,
      },
    },
    render: () => '<section>upload</section>',
    bind: () => () => {},
    onEnter: () => {},
    onLeave: () => {},
    persistence: { reads: [], writes: [] },
    ...overrides,
  };
}

test('menu:v1 계약은 필수 필드와 lifecycle disposer를 강제한다', async () => {
  const {
    MENU_CONTRACT_VERSION,
    createMenuContract,
  } = await import(moduleUrl('src/modules/menu-contracts.mjs'));

  assert.equal(MENU_CONTRACT_VERSION, 'menu:v1');
  const contract = createMenuContract(validDefinition());
  assert.equal(contract.invoke('refresh', 'now'), 'refresh:now');
  assert.equal(typeof contract.bind(), 'function');
  assert.equal(Object.isFrozen(contract), true);
  assert.equal(Object.isFrozen(contract.routes), true);

  const missingCommands = validDefinition();
  delete missingCommands.commands;
  assert.throws(() => createMenuContract(missingCommands), /commands/);

  const invalidBind = createMenuContract(validDefinition({ bind: () => undefined }));
  assert.throws(() => invalidBind.bind(), /disposer/);
  assert.throws(() => contract.invoke('missing'), /undeclared command/);
});

test('menu:v1 계약은 선언하지 않은 capability와 중복 ID/route를 거부한다', async () => {
  const {
    createMenuContract,
    createMenuContractRegistry,
  } = await import(moduleUrl('src/modules/menu-contracts.mjs'));

  assert.throws(() => createMenuContract(validDefinition({
    commands: {
      mutatePeer: { capability: 'peer:write', execute: () => {} },
    },
  })), /undeclared capability/);

  const upload = createMenuContract(validDefinition());
  const duplicateId = createMenuContract(validDefinition({ routes: ['upload-copy'] }));
  assert.throws(() => createMenuContractRegistry([upload, duplicateId]), /duplicate menu id/);

  const duplicateRoute = createMenuContract(validDefinition({
    id: 'upload-copy',
    routes: ['upload'],
  }));
  assert.throws(() => createMenuContractRegistry([upload, duplicateRoute]), /duplicate route/);
});

test('menu:v1 명령은 own-key record만 사용하며 상속된 명령을 실행하지 않는다', async () => {
  const { createMenuContract } = await import(moduleUrl('src/modules/menu-contracts.mjs'));
  Object.defineProperty(Object.prototype, 'inheritedCommand', {
    configurable: true,
    value: {
      capability: 'product:read',
      execute: () => 'prototype-command-executed',
    },
  });

  try {
    const contract = createMenuContract(validDefinition({ capabilities: [], commands: {} }));
    assert.throws(
      () => contract.invoke('inheritedCommand'),
      /undeclared command/,
      'an inherited command key must never be invokable',
    );
    assert.equal(
      Object.getPrototypeOf(contract.commands),
      null,
      'command records must use null-prototype own-key semantics',
    );
  } finally {
    delete Object.prototype.inheritedCommand;
  }
});

test('menu:v1 registry는 factory가 검증한 완전한 contract만 허용한다', async () => {
  const {
    MENU_REQUIRED_FIELDS,
    createMenuContract,
    createMenuContractRegistry,
  } = await import(moduleUrl('src/modules/menu-contracts.mjs'));
  const contract = createMenuContract(validDefinition());

  assert.doesNotThrow(() => createMenuContractRegistry([contract]));
  assert.throws(
    () => createMenuContractRegistry([{ version: 'menu:v1', id: 'fake', routes: ['fake'] }]),
    /invalid menu contract/,
  );

  for (const field of [...MENU_REQUIRED_FIELDS, 'capabilities']) {
    const incomplete = { ...contract };
    delete incomplete[field];
    assert.throws(
      () => createMenuContractRegistry([incomplete]),
      /invalid menu contract/,
      `registry must reject an unverified contract missing ${field}`,
    );
  }

  assert.throws(
    () => createMenuContractRegistry([{ ...contract }]),
    /invalid menu contract/,
    'a shape-compatible plain object must not impersonate a validated contract',
  );
});

test('module registry는 12 sidebar와 7 factory-tab target descriptor를 완전하고 유일한 순서로 선언한다', async () => {
  const {
    FACTORY_TAB_MODULE_DESCRIPTORS,
    SIDEBAR_MODULE_DESCRIPTORS,
    TARGET_MODULE_DESCRIPTORS,
    createModuleRegistry,
  } = await import(moduleUrl('src/modules/module-registry.mjs'));

  assert.equal(SIDEBAR_MODULE_DESCRIPTORS.length, 12);
  assert.equal(FACTORY_TAB_MODULE_DESCRIPTORS.length, 7);
  assert.equal(TARGET_MODULE_DESCRIPTORS.length, 19);
  assert.deepEqual(SIDEBAR_MODULE_DESCRIPTORS.map(item => item.id), [
    'upload', 'analyzing', 'competitor', 'sections', 'generating', 'preview',
    'imagecuts', 'optionsorter', 'factory', 'automation', 'modelsettings', 'manual',
  ]);
  assert.deepEqual(FACTORY_TAB_MODULE_DESCRIPTORS.map(item => item.id), [
    'factory/start', 'factory/db', 'factory/fields', 'factory/competitor',
    'factory/assets', 'factory/sections', 'factory/publish',
  ]);

  const registry = createModuleRegistry(TARGET_MODULE_DESCRIPTORS);
  assert.equal(registry.size, 19);
  assert.equal(registry.get('factory/publish').owner, 'cafe24');
  assert.equal(Object.isFrozen(registry.list()), true);

  const duplicateOrder = {
    ...TARGET_MODULE_DESCRIPTORS[0],
    id: 'upload-copy',
    implementation: 'src/menus/upload-copy-menu.mjs',
    gate: 'MENU-UPLOAD-COPY',
  };
  assert.throws(
    () => createModuleRegistry([...TARGET_MODULE_DESCRIPTORS, duplicateOrder]),
    /duplicate sidebar order/,
  );

  const source = fs.readFileSync(path.join(ROOT, 'src', 'modules', 'module-registry.mjs'), 'utf8');
  assert.doesNotMatch(source, /\bimport\s*\(/, 'Task 2 registry must not import not-yet-implemented menu modules');
});
