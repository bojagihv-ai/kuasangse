const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const core2 = fs.readFileSync(path.join(root, 'src/app-core-02.js'), 'utf8');
const core3 = fs.readFileSync(path.join(root, 'src/app-core-03.js'), 'utf8');
const core5 = fs.readFileSync(path.join(root, 'src/app-core-05.js'), 'utf8');
const cut = (source, start, end) => {
  const at = source.indexOf(start), until = source.indexOf(end, at);
  assert.ok(at >= 0 && until > at);
  return source.slice(at, until);
};
function runtime(documentScope = 'project:batch:document-a', initialState = {}, responseScope = documentScope) {
  const requests = [], applications = [], draftScope = 'draft:active-tab';
  let savedScope = '';
  const state = { ...initialState };
  const returnedSnapshot = { workspaceScope: { id: responseScope || draftScope } };
  const context = vm.createContext({ state,
    getCurrentDocumentWorkspaceScope: () => documentScope,
    getCurrentLastWorkWorkspaceScope: () => draftScope,
    saveDraftRecoverySnapshot: scope => { savedScope = scope; return true; },
    render: () => {}, kuasangseBackendBaseUrl: () => 'http://offline.invalid',
    fetch: async url => { requests.push(new URL(url)); return { ok: true, json: async () => ({ ok: true, entries: [], snapshot: returnedSnapshot }) }; },
    applyServerLastWorkSnapshot: (snapshot, options) => {
      applications.push({ snapshot, options });
      return snapshot.workspaceScope.id === options.expectedWorkspaceScopeId;
    },
  });
  vm.runInContext(cut(core2, 'function saveRejectedWorkRecoverySnapshot(', '\nfunction saveDraftRecoverySnapshot(')
    + cut(core3, 'function draftRecoveryState()', '\nfunction handleDraftRecoveryClick(')
    + cut(core5, 'function renderDraftRecoveryPanel()', '\nfunction renderWorkspacePanel('), context);
  return { context, requests, applications, returnedSnapshot, savedScope: () => savedScope, draftScope, state };
}
for (const documentScope of ['project:batch:document-a', 'project:batch:document-b', '']) {
  test(`recovery list and restore match the writer scope: ${documentScope || 'unsaved draft'}`, async () => {
    const r = runtime(documentScope);
    r.context.saveRejectedWorkRecoverySnapshot('test');
    await r.context.loadDraftRecoveryList();
    await r.context.restoreDraftRecoveryEntry(1);
    const expected = documentScope || r.draftScope;
    assert.equal(r.savedScope(), expected);
    assert.deepEqual(r.requests.map(url => url.searchParams.get('scopeId')), [expected, expected]);
    assert.equal(r.applications[0].options.expectedWorkspaceScopeId, expected);
    assert.strictEqual(r.applications[0].snapshot, r.returnedSnapshot, 'UI must not relabel or replace snapshot identity');
    assert.equal(r.state.draftRecovery.error, '');
  });
}
test('saved-project missing-image warning exposes the existing recovery action with an image label', () => {
  const r = runtime(undefined, { storageWarning: '저장된 이미지 복원에 실패했습니다. 2개 이미지 원본을 현재 브라우저 저장소에서 읽지 못했습니다.' });
  const html = r.context.renderDraftRecoveryPanel();
  assert.match(html, /data-draft-recovery-action="list"/);
  assert.match(html, /이미지 원본 복구본 보기/);
  assert.doesNotMatch(html, /저장 안 한 이 작업/);
});
test('normally saved projects keep recovery UI hidden, including unrelated warnings', () => {
  for (const storageWarning of ['', '다른 작업 경고']) assert.equal(runtime(undefined, { storageWarning }).context.renderDraftRecoveryPanel(), '');
});
test('refused-save and already-opened project recovery remain visible', () => {
  assert.match(runtime(undefined, { storageWarningDismissKey: 'protected-save-refused' }).context.renderDraftRecoveryPanel(), /저장이 보류된 이 작업의 복구본/);
  assert.match(runtime(undefined, { draftRecovery: { opened: true, entries: [] } }).context.renderDraftRecoveryPanel(), /data-draft-recovery-action="list"/);
});
test('unsaved drafts keep the existing recovery action and label', () => {
  assert.match(runtime('').context.renderDraftRecoveryPanel(), /저장 안 한 이 작업의 복구본/);
});
test('a foreign response remains foreign and reaches the scope rejection boundary unchanged', async () => {
  const r = runtime('project:batch:document-a', {}, 'project:batch:document-b');
  await r.context.restoreDraftRecoveryEntry(1);
  assert.equal(r.applications[0].options.expectedWorkspaceScopeId, 'project:batch:document-a');
  assert.equal(r.applications[0].snapshot.workspaceScope.id, 'project:batch:document-b');
  assert.match(r.state.draftRecovery.error, /지금 작업 범위와 맞지 않아/);
});
