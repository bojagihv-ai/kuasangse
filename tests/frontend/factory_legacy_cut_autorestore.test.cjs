'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CORE = fs.readFileSync(
  path.join(__dirname, '../../src/app-core-06.js'),
  'utf8',
);

function extractRestoreCurrentWorkfileArchive() {
  const start = CORE.indexOf('async function factoryRestoreCurrentWorkfileLocalArchive(');
  const end = CORE.indexOf('\nasync function factoryRestoreLocalArchiveToCurrentWork(', start);
  assert.notEqual(start, -1, 'restore helper source marker is present');
  assert.notEqual(end, -1, 'restore helper end marker is present');
  return CORE.slice(start, end);
}

test('동일 상품·동일 원본의 이전 이미지컷은 현재 작업에 stage scope가 없어도 자동 복원 대상으로 남는다', async () => {
  const factory = {
    workspace: { id: 'project:current' },
    product: {
      productName: '모시꽃수파우치',
      inputImageFingerprint: 'same-input',
      imageBase64: 'CURRENT_IMAGE',
    },
    archive: {
      localAssets: [{
        archiveId: 'legacy-cut-1',
        workspaceId: 'draft:lastwork_previous',
        productKey: '모시꽃수파우치',
        inputImageFingerprint: 'same-input',
        stageId: 'cuts',
        currentRunId: 'factory_cuts_run_previous',
        imageUrl: '/api/local-archive/assets/legacy-cut-1/image',
      }],
      stageRunIds: {},
    },
  };
  const observed = { restoreCalls: 0 };
  const context = vm.createContext({
    factoryRuntimeReadFactory: () => factory,
    factoryCurrentWorkfileArchiveIdentity: () => ({
      workspaceId: 'project:current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-input',
    }),
    factoryFindAvailableProductImage: () => ({ base64: 'CURRENT_IMAGE' }),
    factoryBootstrapCurrentWorkfileArchive: async () => ({ ok: true }),
    factoryRefreshLocalArchiveAssets: async () => ({ ok: true }),
    factoryEnsureSourceImagePart: async () => null,
    factoryCurrentWorkfileArchiveScopes: () => [],
    factoryRestoreLocalArchiveToCurrentWork: async () => {
      observed.restoreCalls += 1;
      return { ok: true, restored: 1, total: 1 };
    },
  });
  vm.runInContext(`${extractRestoreCurrentWorkfileArchive()}
    this.restore = factoryRestoreCurrentWorkfileLocalArchive;`, context);

  const result = await context.restore({ silent: true });

  assert.equal(result.ok, true);
  assert.equal(observed.restoreCalls, 1);
});

test('입력 원본 복구 뒤에도 작업파일 보관 이미지 자동 복원을 재시도한다', () => {
  const start = CORE.indexOf('async function continueClassicRuntimeHydrationInBackground(');
  const end = CORE.indexOf('\nasync function runClassicRuntimeHydration(', start);
  assert.notEqual(start, -1, 'background hydration source marker is present');
  assert.notEqual(end, -1, 'background hydration end marker is present');
  const source = CORE.slice(start, end);
  const backup = source.indexOf('hydrateLastProductImageBackup');
  assert.notEqual(backup, -1, 'product image backup hydration is present');
  assert.notEqual(
    source.indexOf('factoryRestoreCurrentWorkfileLocalArchive', backup),
    -1,
    'archive restore is retried after the product image backup restores the input fingerprint',
  );
});
