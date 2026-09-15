const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('제품 복원은 문서 편집권을 초안에 돌려준 뒤 같은 작업 이미지를 저장한다', async () => {
  const { createGuardedWorkspaceMutations } = await import('../../src/modules/workspace-mutations.mjs');
  const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');
  const start = source.indexOf('async function factoryRuntimeControlRestoreProductCheckpoint(');
  const end = source.indexOf('\nasync function factoryRuntimeControlPrepareProduct(', start);
  const draft = 'draft:worker-one', project = 'project:batch:job-one';
  let current = { scopeId: draft, mode: 'offline-edit' };
  const saved = new Map();
  const images = ['input-A', 'red', 'purple'];
  const authority = { snapshot: () => current, runMutation: operation => Promise.resolve().then(operation) };
  const guarded = createGuardedWorkspaceMutations({ authority, adapters: {
    indexeddb: { async putSessionAssets(scope, value, context) { context.assertAuthority(); saved.set(scope, structuredClone(value)); } },
  } });
  const factory = { product: { colorImages: [{ id: 'red', base64: '__stored_in_indexeddb__', inputImageFingerprint: 'cmVk' }] } };
  const projection = { progress: { status: 'waiting_manual' }, stages: [] };
  const context = vm.createContext({
    state: { projectBusy: false, optionSorter: { images: ['red', 'purple'] } },
    factoryRuntimeControlValidateProductCheckpoint: value => value,
    factoryRuntimeControlAdoptProductProject: () => 'batch:job-one',
    loadProjectRecord: async () => ({ id: 'batch:job-one' }),
    factoryRuntimeControlProjection: async () => projection,
    factoryRuntimeControlProjectionMatchesCheckpoint: () => true,
    getCurrentDocumentWorkspaceScope: () => project,
    getCurrentLastWorkWorkspaceScope: () => draft,
    ensureWorkspaceEditAuthority: async scopeId => (current = { scopeId, mode: scopeId.startsWith('draft:') ? 'offline-edit' : 'editing' }),
    factoryRuntimeReadFactory: () => factory,
    factoryImagePayloadFingerprint: value => value,
    factoryRuntimeUpdateOwnedFactory: async (_name, _scope, mutate) => mutate(factory),
    factoryApplySelectedAssetsToSections: () => true,
    saveLastWorkNow: async () => guarded.saveSessionAssets(draft, { images }),
    factoryRuntimeControlProvidedColorOptionsMatch: () => true,
    factoryRuntimeControlCheckpointFromProjection: () => ({ projectId: 'batch:job-one' }),
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
  });
  const imageStart = source.indexOf('function factoryRuntimeControlProductImage(');
  const imageEnd = source.indexOf('function factoryRuntimeControlProvidedColorOptionValues(', imageStart);
  vm.runInContext(source.slice(imageStart, imageEnd) + source.slice(start, end), context);
  await context.factoryRuntimeControlRestoreProductCheckpoint({ jobId: 'job-one', inputImages: [{ name: '빨강', role: 'color-option', dataUrl: 'data:image/png;base64,cmVk' }], requiredValues: { optionMode: 'provided' }, checkpoint: { projectId: 'batch:job-one' } });
  assert.deepEqual(saved.get(draft), { images });
  assert.equal(saved.has(project), false);
  assert.equal(factory.product.colorImages[0].id, 'red');
  assert.equal(factory.product.colorImages[0].base64, 'cmVk');
});
