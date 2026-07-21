const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function sourceBetween(source, startMarkers, endMarker) {
  const start = startMarkers.map(marker => source.indexOf(marker)).find(index => index >= 0) ?? -1;
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable before ${endMarker}`);
  return source.slice(start, end);
}

test('startup hydration switches authority once and continues only in the restored workspace scope', async () => {
  const core06 = read('src/app-core-06.js');
  const hydrationSource = sourceBetween(
    core06,
    ['async function runClassicRuntimeHydration'],
    'function hydrateClassicRuntime',
  );
  const context = vm.createContext({ setTimeout });
  vm.runInContext(`
    const state = { currentProjectId: 'old-project', factory: {} };
    let currentScope = 'project:old-project';
    const authorityCalls = [];
    const hydratedScopes = [];
    const installClassicRuntimeLifecycle = () => {};
    const hasGeminiConnection = () => false;
    const getCurrentLastWorkWorkspaceScope = () => currentScope;
    const ensureWorkspaceEditAuthority = async scope => { authorityCalls.push(scope); return { mode: 'editing', scopeId: scope }; };
    const markSessionAssetFingerprintSaved = () => {};
    const loadCutsArchiveFolderStatus = async () => {};
    const refreshWorkspaceLists = async () => {};
    const hydratePersistentSessionAssets = async () => {
      state.currentProjectId = '';
      currentScope = 'draft:new-work';
    };
    const hydrateServerLastWorkSnapshot = async () => { hydratedScopes.push(currentScope); };
    const factoryRestoreCurrentWorkfileLocalArchive = null;
    const hydrateLastProductImageBackup = null;
    const factoryRuntimeReadFactory = () => ({ product: {} });
    const disposeClassicRuntimeLifecycle = () => {};
    ${hydrationSource}
    globalThis.runHydration = () => runClassicRuntimeHydration({ schema: 'classic', version: 1 });
    globalThis.readAuthorityCalls = () => JSON.stringify(authorityCalls);
    globalThis.readHydratedScopes = () => JSON.stringify(hydratedScopes);
  `, context);

  const result = await context.runHydration();
  assert.deepEqual({ ...result }, { schema: 'classic', version: 1, hydrated: true, stale: false });
  assert.deepEqual(JSON.parse(context.readAuthorityCalls()), ['project:old-project', 'draft:new-work']);
  assert.deepEqual(JSON.parse(context.readHydratedScopes()), ['draft:new-work']);
});
test('current last-work scope uses the canonical factory workspace instead of a stale state mirror', () => {
  const core02 = read('src/app-core-02.js');
  const selectorSource = sourceBetween(
    core02,
    ['function getCurrentLastWorkWorkspaceScope'],
    'function rotateLastWorkDraftScope',
  );
  const context = vm.createContext({});
  vm.runInContext(`
    const state = { currentProjectId: '', factory: { workspace: { id: 'stale-project' } } };
    let canonicalFactory = { workspace: { id: 'canonical-project' } };
    const factoryRuntimeReadFactory = () => canonicalFactory;
    const getStoredLastWorkDraftScope = () => 'draft:new-work';
    const workspacePersistenceApi = () => ({
      normalizeProjectScope: id => 'project:' + id,
      normalizeWorkspaceScope: id => id,
    });
    ${selectorSource}
    globalThis.readScope = () => getCurrentLastWorkWorkspaceScope();
    globalThis.useDraft = () => { canonicalFactory = { workspace: { id: '' } }; };
  `, context);

  assert.equal(context.readScope(), 'project:canonical-project');
  vm.runInContext('useDraft()', context);
  assert.equal(context.readScope(), 'draft:new-work');
});
