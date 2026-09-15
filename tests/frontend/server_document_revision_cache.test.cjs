const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('서버 승인 판은 초안 권한 복귀 뒤에도 유지하고 거절된 판은 반영하지 않는다', async () => {
  const { createWorkspaceRevisionCoordinator } = await import('../../src/modules/workspace-revision.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-02.js'), 'utf8');
  const start = source.indexOf('async function saveServerLastWorkSnapshot(');
  const end = source.indexOf('\nfunction scheduleServerLastWorkSave(', start);
  assert.ok(start >= 0 && end > start);
  for (const outcome of ['clean', 'partial', 'protected']) {
    const values = new Map();
    const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
    const revisions = createWorkspaceRevisionCoordinator({ localStorage: storage, sessionStorage: storage });
    const scopeId = 'project:batch:job-test';
    revisions.observe({ scopeId, counter: 118 });
    const context = vm.createContext({
      state: { contentVersion: 1 },
      captureWorkspaceDocumentFence: () => ({ scopeId: 'draft:test' }),
      workspaceDocumentFenceIsCurrent: () => true,
      workspaceScopeTransitionState: { inProgress: false },
      serverLastWorkHydrated: true, serverLastWorkRetryAfter: 0, serverLastWorkSavePromise: null,
      serverLastWorkSaveRequestedAgain: false, serverLastWorkForceSaveRequested: false,
      serverLastWorkFactorySnapshotRequested: null, serverLastWorkLastSavedAt: 0, serverLastWorkFailureCount: 0,
      getCurrentDocumentWorkspaceScope: () => scopeId,
      getCurrentLastWorkWorkspaceScope: () => 'draft:test',
      ensureWorkspaceEditAuthority: async scope => ({ scopeId: scope, mode: 'editing' }),
      buildServerLastWorkSnapshot: () => ({ savedAt: 7 }),
      sessionAssetsForAuthoritativeCommit: async () => ({}), lastWorkSnapshotScore: () => 10,
      workspaceCommitMetadata: () => ({}), workspaceSnapshotRevision: () => null,
      getServerLastWorkBases: () => [],
      workspacePersistenceApi: () => ({ commit: async () => ({
        accepted: true, clean: outcome === 'clean', partial: outcome === 'partial', protectedNoOp: outcome === 'protected',
        envelope: { metadata: { revision: { scopeId, counter: 123 } } },
      }) }),
      observeWorkspaceRevisionSnapshot: snapshot => revisions.observe(snapshot.workspaceRevision),
      factoryArchiveWritesInFlight: () => false,
      scheduleServerLastWorkSave: () => {}, serverLastWorkFailureDelayMs: () => 15000,
      warnProtectedSaveRefused: () => {}, saveRejectedWorkRecoverySnapshot: () => {},
      console: { warn() {} },
    });
    vm.runInContext(source.slice(start, end), context);
    await context.saveServerLastWorkSnapshot('test', { force: true });
    assert.equal(revisions.current(scopeId).counter, outcome === 'clean' ? 123 : 118, outcome);
  }
});
