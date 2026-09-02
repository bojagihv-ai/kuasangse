// '다른 이름으로 저장' 을 취소하면 아무 일도 없어야 한다.
//
// 사장님 원칙: "컷·필수값·VM 선정·확정값은 사라지지 않는다. 사라지는 건 오직 '새 작업' 을
// 눌렀을 때뿐. F5·Ctrl+F5 를 눌러도 붙잡고 있어야 한다."
//
// 사고(2026-09-02, 묶음 G3): exportCurrentProjectFile(saveAs) 가 파일 고르기 창을 띄우기
// **전에** startNewProjectDraft() 를 불렀다. 그래서 Chrome(showSaveFilePicker) 에서 창을
// 취소해도 이미 저장 ID 가 비고, 초안 scope 가 돌아가고, 편집권이 새 scope 로 옮겨가고,
// 되살리기 사본(state.snapshots)이 비워진 채 복구 저장소에 기록됐다. 취소했는데 '… 복사본'
// 초안으로 갈라져 있고, 그 뒤 F5 를 누르면 원래 작업파일이 아니라 갈라진 초안이 되살아났다.
//
// 이 검증은 실제 Chrome 에서:
//   1. project: 작업을 세우고 작업파일(OPFS 실물 핸들)에 한 번 저장한다.
//   2. showSaveFilePicker 가 AbortError 를 던지게 한 뒤 실제 '다른 이름으로 저장' 버튼을 누른다.
//   3. 저장 ID·이름·초안 scope·편집권·되살리기 사본이 그대로인지 본다.
//   4. 그 뒤 자동저장(saveLastWorkNow)이 원래 project: scope 로 가고, '현재 상태 저장' 이
//      파일 창을 다시 묻지 않고 원래 파일에 쓰는지 본다.
//   5. Ctrl+F5(캐시 무시 재적재) 뒤에도 원래 작업·원래 파일 핸들인지 본다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_URL
  || process.env.KUASANGSE_BACKEND_BASE
  || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'save-as-cancel-keeps-original-v1.json');

const READY = '!!(window.state && window.render && window.factoryState && window.exportCurrentProjectFile)';

async function waitAppReady(cdp) {
  await waitFor(cdp, READY, 60000);
  await evaluate(cdp, `(async () => { await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__); return true; })()`);
  await waitFor(cdp, `(() => typeof classicRuntimeInitialRenderComplete !== 'undefined' && classicRuntimeInitialRenderComplete === true)()`, 60000);
}

// 저장 ID·이름·초안 scope·편집권·되살리기 사본·파일 핸들 scope — 취소 뒤 하나도 흔들리면 안 되는 것들.
const READ_IDENTITY = `(async () => {
  const state = window.__kuasangseState || window.state;
  const lock = window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || {};
  const persistence = window.workspacePersistenceApi();
  let bootstrap = {};
  try { bootstrap = JSON.parse(persistence.readRecoveryValue('pdp_last_work_bootstrap_v1') || '{}'); } catch (_) {}
  let handleName = '';
  try { handleName = String((await loadFactoryProjectFileHandle())?.name || ''); } catch (_) {}
  return {
    projectId: String(state.currentProjectId || ''),
    projectName: String(state.currentProjectName || ''),
    workIdentityScope: String(state.workIdentity?.workspaceId || ''),
    draftScope: getCurrentLastWorkWorkspaceScope(),
    lockScope: String(lock.scopeId || ''),
    lockMode: String(lock.mode || ''),
    handleScope: factoryProjectFileHandleScope(),
    handleName,
    snapshotIds: (state.snapshots || []).map(s => String(s.id || '')),
    bootstrapScope: String(bootstrap.workspaceScope?.id || bootstrap.workspaceScope || ''),
    bootstrapProjectId: String(bootstrap.currentProjectId || ''),
    productName: String(state.productName || ''),
    workfileSaveState: String(state.workfileSaveState || ''),
    error: String(state.error || ''),
    uiNotice: String(state.uiNotice?.message || state.uiNotice || ''),
  };
})()`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = cdpRuntime.targets.find(t => t.type === 'page') || cdpRuntime.targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('gemini_backend_url', ${JSON.stringify(BACKEND_BASE)}); } catch (_) {}`,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitAppReady(cdp);

  const seed = Date.now().toString(36);
  const projectId = `project_save_as_cancel_${seed}`;
  const projectName = `취소검증${seed}`;
  const fileName = `원본작업${seed}.kuasangse`;
  const productKey = projectName.replace(/\s+/g, '').toLowerCase();

  // 1. project: 작업을 세우고 실제 파일 핸들(OPFS)에 한 번 저장한다.
  const saved = await evaluate(cdp, `(async () => {
    const projectId = ${JSON.stringify(projectId)};
    const projectName = ${JSON.stringify(projectName)};
    const fileName = ${JSON.stringify(fileName)};
    const productKey = ${JSON.stringify(productKey)};
    const runId = 'run_' + projectId;
    const state = window.__kuasangseState || window.state;
    state.currentProjectId = projectId;
    state.currentProjectName = projectName;
    state.currentProjectCreatedAt = Date.now();
    state.step = 'factory';
    state.productName = projectName;
    const factory = window.factoryState();
    window.factoryStampWorkspaceIdentity?.(factory, { projectId, projectName, createdAt: state.currentProjectCreatedAt });
    factory.product.productName = projectName;
    factory.product.userProductName = projectName;
    factory.product.productKey = productKey;
    factory.product.productIdentityKey = productKey;
    factory.product.currentRunId = runId;
    factory.product.generationRunId = runId;
    factory.automation.currentRunId = runId;
    const branchScope = window.getCurrentLastWorkWorkspaceScope();
    const authority = await window.ensureWorkspaceEditAuthority(branchScope, { force: true });
    if (!['editing', 'offline-edit'].includes(authority?.mode) || authority?.scopeId !== branchScope) {
      throw new Error('branch authority acquisition failed: ' + JSON.stringify(authority));
    }
    window.render();
    await new Promise(resolve => setTimeout(resolve, 300));
    await window.saveLastWorkNow({ force: true, deep: true });

    // OPFS 실물 핸들: createWritable/getFile/queryPermission 이 있고 IndexedDB 에 저장된다.
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(fileName, { create: true });
    window.__G3_PICKER_CALLS__ = [];
    window.showSaveFilePicker = async (options) => {
      window.__G3_PICKER_CALLS__.push({ suggestedName: String(options?.suggestedName || '') });
      return handle;
    };
    const bundle = await window.exportCurrentProjectFile({ name: state.currentProjectName, saveAs: false });
    const receipt = window.__KUASANGSE_LAST_WORKFILE_RECEIPT__ || null;
    return {
      bundleOk: !!bundle,
      receipt: receipt ? { fileName: receipt.fileName, source: receipt.source, workspaceId: receipt.workspaceId } : null,
      pickerCalls: window.__G3_PICKER_CALLS__.length,
      error: String(state.error || ''),
    };
  })()`, true, 120000);

  // 되살리기 사본이 있는 상태여야 '비워졌는지' 를 볼 수 있다.
  const before = await evaluate(cdp, `(async () => {
    const state = window.__kuasangseState || window.state;
    state.snapshots = [{ id: 'g3_probe_snapshot', name: '취소 전 되살리기 사본', createdAt: Date.now() }];
    return ${READ_IDENTITY};
  })()`);

  // 2. 파일 창에서 '취소'. 실제 버튼 → 이벤트 → exportCurrentProjectFile(saveAs) 경로 그대로.
  const cancelled = await evaluate(cdp, `(async () => {
    const state = window.__kuasangseState || window.state;
    window.__G3_PICKER_CALLS__ = [];
    window.showSaveFilePicker = async (options) => {
      window.__G3_PICKER_CALLS__.push({ suggestedName: String(options?.suggestedName || '') });
      throw new DOMException('The user aborted a request.', 'AbortError');
    };
    const original = window.exportCurrentProjectFile;
    let pending = null;
    window.exportCurrentProjectFile = (...args) => { pending = original(...args); return pending; };
    try {
      const button = document.getElementById('saveProjectFileAsBtn');
      if (button) button.click();
      else document.dispatchEvent(new CustomEvent('kuasangse:workfile-action', { detail: { action: 'save-as' } }));
      const deadline = Date.now() + 20000;
      while (!pending && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      if (!pending) throw new Error("'다른 이름으로 저장' 버튼이 exportCurrentProjectFile 을 부르지 않았습니다.");
      const result = await pending;
      await new Promise(r => setTimeout(r, 800));
      return {
        buttonFound: !!button,
        result,
        pickerCalls: window.__G3_PICKER_CALLS__,
        identity: await ${READ_IDENTITY},
      };
    } finally {
      window.exportCurrentProjectFile = original;
    }
  })()`, true, 120000);

  // 4. 취소 뒤 자동저장과 '현재 상태 저장' 이 원래 작업·원래 파일로 가는지.
  const afterSave = await evaluate(cdp, `(async () => {
    const state = window.__kuasangseState || window.state;
    const projectId = ${JSON.stringify(projectId)};
    state.factory = state.factory || {};
    await window.saveLastWorkNow({ force: true, deep: true });
    await new Promise(r => setTimeout(r, 1200));
    const server = await fetch(${JSON.stringify(BACKEND_BASE)} + '/api/last-work?workspaceId=' + encodeURIComponent('project:' + projectId), { cache: 'no-store' })
      .then(r => r.json()).catch(() => ({}));
    window.__G3_PICKER_CALLS__ = [];
    const bundle = await window.exportCurrentProjectFile({ name: state.currentProjectName, saveAs: false });
    const receipt = window.__KUASANGSE_LAST_WORKFILE_RECEIPT__ || null;
    let fileWorkspaceId = '';
    let fileProjectName = '';
    try {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(${JSON.stringify(fileName)});
      const parsed = JSON.parse(await (await handle.getFile()).text());
      fileWorkspaceId = String(parsed.workspaceId || '');
      fileProjectName = String(parsed.project?.name || '');
    } catch (_) {}
    return {
      serverScope: String(server.workspaceId || ''),
      serverProjectId: String(server.snapshot?.assets?.currentProjectId || server.snapshot?.lightweight?.currentProjectId || ''),
      bundleOk: !!bundle,
      pickerCalls: window.__G3_PICKER_CALLS__.length,
      receipt: receipt ? { fileName: receipt.fileName, source: receipt.source, workspaceId: receipt.workspaceId } : null,
      fileWorkspaceId,
      fileProjectName,
      error: String(state.error || ''),
      identity: await ${READ_IDENTITY},
    };
  })()`, true, 120000);

  // 5. Ctrl+F5.
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitAppReady(cdp);
  await evaluate(cdp, `(async () => { await new Promise(r => setTimeout(r, 1500)); return true; })()`);
  const reloaded = await evaluate(cdp, READ_IDENTITY, true, 60000);

  cdp.close();
  await cdpRuntime.cleanup?.();

  const evidence = { seed, projectId, projectName, fileName, saved, before, cancelled, afterSave, reloaded };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence, null, 2));

  const originalScope = `project:${projectId}`;
  const same = (a, b, key) => a[key] === b[key];
  const c = cancelled.identity;
  assertChecks([
    { ok: saved.bundleOk && saved.receipt?.source === 'workfile-handle' && saved.receipt?.fileName === fileName, message: `검증 준비 실패: 원본 작업파일 저장이 안 됐습니다 ${JSON.stringify(saved)}` },
    { ok: before.projectId === projectId && before.handleScope === originalScope && before.handleName === fileName && before.snapshotIds.includes('g3_probe_snapshot'), message: `검증 준비 실패: 취소 전 상태가 기대와 다릅니다 ${JSON.stringify(before)}` },
    { ok: cancelled.result === null && cancelled.pickerCalls.length === 1, message: `파일 창이 한 번 열리고 취소로 끝나야 합니다: ${JSON.stringify({ result: cancelled.result, pickerCalls: cancelled.pickerCalls })}` },
    { ok: same(before, c, 'projectId') && same(before, c, 'projectName'), message: `취소했는데 저장 ID/이름이 바뀌었습니다: ${before.projectId}/${before.projectName} -> ${c.projectId}/${c.projectName}` },
    { ok: same(before, c, 'draftScope'), message: `취소했는데 초안 scope 가 돌아갔습니다: ${before.draftScope} -> ${c.draftScope}` },
    { ok: same(before, c, 'lockScope') && c.lockMode === before.lockMode, message: `취소했는데 편집권이 다른 scope 로 옮겨갔습니다: ${before.lockScope}(${before.lockMode}) -> ${c.lockScope}(${c.lockMode})` },
    { ok: same(before, c, 'workIdentityScope'), message: `취소했는데 workIdentity 가 바뀌었습니다: ${before.workIdentityScope} -> ${c.workIdentityScope}` },
    { ok: c.snapshotIds.includes('g3_probe_snapshot'), message: `취소했는데 되살리기 사본이 비워졌습니다: ${JSON.stringify(c.snapshotIds)}` },
    { ok: c.handleScope === originalScope && c.handleName === fileName, message: `취소했는데 작업파일 핸들 scope 가 바뀌었습니다: ${JSON.stringify({ scope: c.handleScope, name: c.handleName })}` },
    { ok: c.workfileSaveState === '' && !c.error, message: `취소가 오류로 표시됐습니다: ${JSON.stringify({ state: c.workfileSaveState, error: c.error })}` },
    { ok: afterSave.serverScope === originalScope, message: `취소 뒤 자동저장이 원래 project: scope 로 가지 않았습니다: ${JSON.stringify(afterSave)}` },
    { ok: afterSave.bundleOk && afterSave.pickerCalls === 0 && afterSave.receipt?.fileName === fileName && afterSave.receipt?.source === 'workfile-handle', message: `취소 뒤 '현재 상태 저장' 이 원래 파일로 가지 않았습니다(파일 창 ${afterSave.pickerCalls}회): ${JSON.stringify(afterSave.receipt)} ${afterSave.error}` },
    // 작업파일 번들은 범위 접두어 없이 **작업 ID** 를 담는다(factoryWorkspaceIdentityFromSource().id).
    // 그래서 'project:' 를 붙인 scope 와 그대로 비교하면 제품이 맞아도 실패한다.
    { ok: (afterSave.fileWorkspaceId === projectId || afterSave.fileWorkspaceId === originalScope)
        // 작업 이름은 첫 저장 때 고른 파일명으로 바뀐다(아래 250행 주석과 같은 이유).
        // projectName 은 제품명이라 여기 쓰면 안 된다.
        && afterSave.fileProjectName === before.projectName, message: `원래 파일에 다른 작업이 쓰였습니다: ${JSON.stringify({ workspaceId: afterSave.fileWorkspaceId, name: afterSave.fileProjectName })}` },
    { ok: afterSave.identity.bootstrapProjectId === projectId && afterSave.identity.bootstrapScope === before.draftScope, message: `취소 뒤 즉시 복원 포인터가 원래 작업을 가리키지 않습니다: ${JSON.stringify(afterSave.identity)}` },
    // 첫 저장 때 작업 이름은 고른 파일명(원본작업…)으로 바뀐다. 그러니 '취소 전' 값과 비교한다.
    { ok: reloaded.projectId === projectId && reloaded.projectName === before.projectName && reloaded.productName === projectName, message: `Ctrl+F5 뒤 원래 작업이 아닙니다: ${JSON.stringify(reloaded)}` },
    { ok: reloaded.draftScope === before.draftScope, message: `Ctrl+F5 뒤 초안 scope 가 달라졌습니다: ${before.draftScope} -> ${reloaded.draftScope}` },
    { ok: reloaded.handleScope === originalScope && reloaded.handleName === fileName, message: `Ctrl+F5 뒤 원래 작업파일 핸들을 잃었습니다: ${JSON.stringify({ scope: reloaded.handleScope, name: reloaded.handleName })}` },
  ]);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err.stack || err.message || String(err)); process.exit(1); });
