'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-06.js'), 'utf8');
const start = source.indexOf('async function continueClassicRuntimeHydrationInBackground(');
const hydration = source.slice(start, source.indexOf('async function runClassicRuntimeHydration(', start));

test('배치 작업자 새로고침은 연결된 작업파일만 보완하며 보관함 후보를 재발급하지 않는다', async () => {
  for (const projectId of ['batch:factory-job-refresh', '', 'regression:isolated-test', 'user-other-work']) {
    const calls = [];
    const factory = { workspace: { id: projectId }, product: {}, assets: [{ id: 'selected-cut' }] };
    const context = vm.createContext({
      state: { currentProjectId: projectId, step: 'factory' },
      classicRuntimeIsBatchWorker: () => true,
      getCurrentLastWorkWorkspaceScope: () => 'draft:worker-refresh',
      getCurrentDocumentWorkspaceScope: () => projectId ? `project:${projectId}` : '',
      hydratePersistentSessionAssets: async () => calls.push('session'),
      hydrateServerLastWorkSnapshot: async options => {
        assert.notEqual(options.force, true, '저장된 작업이 현재 입력을 강제로 덮어쓰면 안 된다');
        calls.push('server');
      },
      factoryRestoreCurrentWorkfileLocalArchive: async () => {
        calls.push('archive-reissue');
        factory.assets = [{ id: 'new-id-for-old-cut' }];
      },
      factoryRuntimeReadFactory: () => factory,
      hydrateLastProductImageBackup: async () => calls.push('image-backup'),
      showImageRestoreWarningIfNeeded: () => false,
    });
    vm.runInContext(hydration, context);
    const identity = { scopeId: 'draft:worker-refresh', projectId };
    assert.equal(await context.continueClassicRuntimeHydrationInBackground({
      initialHydrationIdentity: identity,
      initialAuthority: null,
      readHydrationIdentity: () => identity,
      hydrationIdentityIsCurrent: () => true,
    }), true);
    assert.deepEqual(calls, projectId === 'batch:factory-job-refresh'
      ? ['session', 'server', 'image-backup'] : ['session', 'image-backup'], projectId);
    assert.deepEqual(factory.assets, [{ id: 'selected-cut' }]);
  }
});
