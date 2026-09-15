const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-03.js'), 'utf8');
const start = source.indexOf('async function exportCurrentProjectFile(');
const exporter = source.slice(start, source.indexOf('\nfunction parseFactoryProjectFileBundle(', start));

test('skipped startup export stores bytes but only explicit export requests a download', async () => {
  for (const skipBrowserDownload of [true, false]) {
    const bundle = { workspaceId: 'batch:job-a', project: { name: '제품', payload: {
      factory: { assets: [{ id: 'selected', image: 'data:image/png;base64,eA==', selected: true }] },
    } }, persistence: { revision: 7 } };
    const state = { currentProjectId: 'batch:job-a', currentProjectName: '제품' };
    const notices = [], downloads = [], commits = [];
    const context = vm.createContext({ state, Blob, performance, window: {},
      workspaceScopeTransitionState: {}, settleWorkspaceScopeTransitionPersistence: async () => {},
      factoryRuntimeReadCommittedFactory: () => ({}), factoryWorkspaceIdentityFromSource: () => ({ id: 'batch:job-a' }),
      getCurrentLastWorkWorkspaceScope: () => 'project:batch:job-a', render() {},
      factorySanitizeProjectFileName: name => name, deriveProjectName: () => '제품',
      factoryProjectNameFromFileName: () => '제품', factoryEnsureCurrentProjectIdentityForFile: () => ({ id: 'batch:job-a' }),
      ensureWorkspaceEditAuthority: async () => ({ mode: 'editing' }), factoryProjectFileHandleScope: () => 'project:batch:job-a',
      selectFactoryProjectFileSaveHandle: () => { throw new Error('save_picker_forbidden'); },
      buildFactoryProjectFileBundle: async () => bundle,
      prepareFactoryProjectBundlePersistence: () => ({ projectId: 'batch:job-a', scopeId: 'project:batch:job-a' }),
      buildFactoryProjectPersistenceServerSnapshot: () => ({}),
      workspacePersistenceApi: () => ({ createMetadata: x => x,
        commit: async command => { commits.push(command); return { accepted: true, clean: true }; } }),
      URL: { createObjectURL: () => 'blob:test-only', revokeObjectURL() {} },
      document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) },
      setTimeout() {}, markWorkspaceDocumentClean() {}, setUiNotice: message => notices.push(message),
      factoryRuntimeSha256Text: async value => createHash('sha256').update(value).digest('hex'),
      requestCurrentWorkBundleLiveSync() {}, refreshWorkspaceLists: async () => {}, savePersistentState: async () => {},
    });
    vm.runInContext(exporter, context);
    assert.equal(await context.exportCurrentProjectFile({ downloadOnly: true, skipBrowserDownload }), bundle);
    const receipt = context.window.__KUASANGSE_LAST_WORKFILE_RECEIPT__;
    assert.equal(receipt.source, skipBrowserDownload ? 'authoritative-store' : 'browser-download-requested');
    assert.equal(downloads.length, skipBrowserDownload ? 0 : 1);
    assert.equal(commits[0].replicas.length, 0);
    const bytes = await commits[0].context.workfile.value.text();
    assert.deepEqual(JSON.parse(bytes), bundle);
    assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.match(notices.at(-1), skipBrowserDownload ? /권위 저장소/ : /다운로드 요청.*디스크 저장 미확인/);
  }
});
