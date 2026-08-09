const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  fetchJson,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'new-work-multitab-reload-isolation-v371.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'new-work-multitab-reload-isolation-v371.png');
const EXPECTED_BUILD_ID = currentSourceBuildId(process.cwd());
const TEST_INPUT_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADUlEQVR4nGP8z8DwnwEIAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

async function openPage() {
  const target = await fetchJson(`${CDP_URL}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, `(() =>
    window.__KUASANGSE_APP_BUILD_ID__ === ${JSON.stringify(EXPECTED_BUILD_ID)}
    && typeof resetActiveWorkspaceDocumentCore === 'function'
    && typeof savePersistentState === 'function'
    && !!window.__KUASANGSE_WORKSPACE_PERSISTENCE__
  )()`, 60000);
  await waitFor(cdp, `(() =>
    typeof sessionAssetsHydrated !== 'undefined' && sessionAssetsHydrated === true
    && typeof serverLastWorkHydrating !== 'undefined' && serverLastWorkHydrating === false
    && typeof persistentStateSaving !== 'undefined' && persistentStateSaving === false
  )()`, 60000);
  return { cdp, target };
}

async function typeNewWorkProduct(cdp, productName) {
  return evaluate(cdp, `(async () => {
    await resetActiveWorkspaceDocumentCore();
    completeWorkspaceBlankResetBoundary();
    window.state.step = 'factory';
    render();
    await new Promise(resolve => setTimeout(resolve, 100));
    const input = document.getElementById('factoryProductName')
      || document.getElementById('factoryGuideProductName');
    if (!input) throw new Error('new-work product input not found');
    input.focus();
    input.value = ${JSON.stringify(productName)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    await new Promise(resolve => setTimeout(resolve, 2200));
    if (persistentStateSavePromise) await persistentStateSavePromise;
    const tabSession = JSON.parse(sessionStorage.getItem('pdp_session') || '{}');
    return {
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      productName: window.state?.productName || '',
      factoryProductName: window.state?.factory?.product?.productName || '',
      workspaceScope: getCurrentLastWorkWorkspaceScope(),
      tabSessionProductName: tabSession.productName || tabSession.factory?.product?.productName || '',
      tabSessionScope: tabSession.workspaceScope?.id || '',
      storageWarning: window.state?.storageWarning || '',
    };
  })()`);
}

async function resetAndInspectBlankDocument(cdp, previousProductName) {
  return evaluate(cdp, `(async () => {
    const previousScope = getCurrentLastWorkWorkspaceScope();
    const previousBootstrap = JSON.parse(workspaceSessionGetItem('pdp_last_work_bootstrap_v1') || '{}');
    await resetActiveWorkspaceDocumentCore();
    const workspaceScope = getCurrentLastWorkWorkspaceScope();
    const bootstrap = JSON.parse(workspaceSessionGetItem('pdp_last_work_bootstrap_v1') || '{}');
    const tabSession = JSON.parse(workspaceSessionGetItem('pdp_session') || '{}');
    const previousProductPaths = [];
    const findPreviousProduct = (value, path = '$') => {
      if (previousProductPaths.length >= 20 || value == null) return;
      if (typeof value === 'string') {
        if (value.includes(${JSON.stringify(previousProductName)})) previousProductPaths.push(path);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => findPreviousProduct(item, path + '[' + index + ']'));
        return;
      }
      if (typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => findPreviousProduct(item, path + '.' + key));
      }
    };
    findPreviousProduct(tabSession);
    const result = {
      previousScope,
      previousBootstrapScope: previousBootstrap.workspaceScope?.id || '',
      workspaceScope,
      bootstrapScope: bootstrap.workspaceScope?.id || '',
      bootstrapProductName: bootstrap.currentProjectName || '',
      bootstrapProductId: bootstrap.currentProjectId || '',
      tabSessionScope: tabSession.workspaceScope?.id || '',
      tabSessionProductName: tabSession.productName || tabSession.factory?.product?.productName || '',
      tabSessionContainsPreviousProduct: JSON.stringify(tabSession).includes(${JSON.stringify(previousProductName)}),
      previousProductPaths,
      storageWarning: window.state?.storageWarning || '',
    };
    completeWorkspaceBlankResetBoundary();
    return result;
  })()`);
}

async function createProjectBundle(cdp, projectName, productName) {
  return evaluate(cdp, `(async () => {
    await resetActiveWorkspaceDocumentCore();
    completeWorkspaceBlankResetBoundary();
    window.state.step = 'factory';
    render();
    await new Promise(resolve => setTimeout(resolve, 100));
    const input = document.getElementById('factoryProductName')
      || document.getElementById('factoryGuideProductName');
    if (!input) throw new Error('project bundle product input not found');
    input.focus();
    input.value = ${JSON.stringify(productName)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    const inputBase64 = ${JSON.stringify(TEST_INPUT_PNG_BASE64)};
    const inputPreview = 'data:image/png;base64,' + inputBase64;
    window.state.imageBase64 = inputBase64;
    window.state.imageMime = 'image/png';
    window.state.imagePreview = inputPreview;
    window.state.imageName = 'psd-branch-regression-input.png';
    const factory = factoryState();
    factory.product.productName = ${JSON.stringify(productName)};
    factoryStampLockedInputImage(factory, {
      base64: inputBase64,
      mime: 'image/png',
      preview: inputPreview,
      name: 'psd-branch-regression-input.png',
    }, { id: 'psd_branch_regression_input' });
    saveLastWorkNow();
    await new Promise(resolve => setTimeout(resolve, 2200));
    if (persistentStateSavePromise) await persistentStateSavePromise;
    try {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    } catch (_) {
      try { window.showSaveFilePicker = undefined; } catch (_) {}
    }
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clickWithoutDownload() {
      if (String(this.download || '').endsWith('.kuasangse')) return;
      return nativeAnchorClick.call(this);
    };
    let bundle;
    try {
      bundle = await exportCurrentProjectFile({ name: ${JSON.stringify(projectName)} });
    } finally {
      HTMLAnchorElement.prototype.click = nativeAnchorClick;
    }
    if (!bundle) throw new Error(window.state?.error || 'initial project save returned no bundle');
    return JSON.stringify(bundle);
  })()`);
}

async function importProjectBundle(cdp, bundleText, fileName) {
  return evaluate(cdp, `(async () => {
    const beforeScope = getCurrentLastWorkWorkspaceScope();
    const bundle = parseFactoryProjectFileBundle(${JSON.stringify(bundleText)});
    let imported;
    try {
      imported = await importFactoryProjectFileBundle(bundle, {
        fileName: ${JSON.stringify(fileName)},
        skipLeaveConfirm: true,
      });
    } catch (error) {
      throw new Error(JSON.stringify({
        message: error?.message || String(error),
        details: error?.details || null,
        beforeScope,
        currentScope: getCurrentLastWorkWorkspaceScope(),
        authority: currentWorkspaceAuthority(),
        projectId: window.state?.currentProjectId || '',
        workfileRestoreState: window.state?.workfileRestoreState || '',
        workfileRestoreMessage: window.state?.workfileRestoreMessage || '',
      }));
    }
    if (!imported) throw new Error('project bundle import returned no result');
    if (persistentStateSavePromise) await persistentStateSavePromise;
    const branch = currentWorkspaceBranch(getCurrentLastWorkWorkspaceScope(), window.state.currentProjectId);
    return {
      beforeScope,
      workspaceScope: getCurrentLastWorkWorkspaceScope(),
      projectId: window.state.currentProjectId || '',
      projectName: window.state.currentProjectName || '',
      productName: window.state.productName || '',
      factoryProductName: factoryRuntimeReadCommittedFactory()?.product?.productName || '',
      branch,
      authority: currentWorkspaceAuthority(),
      inert: !!document.getElementById('app')?.inert || !!document.body?.inert,
    };
  })()`);
}

async function editCurrentBranchProduct(cdp, productName) {
  return evaluate(cdp, `(async () => {
    window.state.step = 'factory';
    render();
    await new Promise(resolve => setTimeout(resolve, 100));
    const input = document.getElementById('factoryProductName')
      || document.getElementById('factoryGuideProductName');
    if (!input) throw new Error('branch product input not found');
    input.focus();
    input.value = ${JSON.stringify(productName)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    await new Promise(resolve => setTimeout(resolve, 2200));
    if (persistentStateSavePromise) await persistentStateSavePromise;
    const branch = currentWorkspaceBranch(getCurrentLastWorkWorkspaceScope(), window.state.currentProjectId);
    return {
      workspaceScope: getCurrentLastWorkWorkspaceScope(),
      projectId: window.state.currentProjectId || '',
      productName: window.state.productName || '',
      factoryProductName: factoryRuntimeReadCommittedFactory()?.product?.productName || '',
      branch,
    };
  })()`);
}

async function reloadAndInspectBranch(cdp) {
  const previousTimeOrigin = await evaluate(cdp, 'performance.timeOrigin');
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, `(() =>
    performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}
    && window.__KUASANGSE_APP_BUILD_ID__ === ${JSON.stringify(EXPECTED_BUILD_ID)}
    && typeof getCurrentLastWorkWorkspaceScope === 'function'
    && typeof currentWorkspaceBranch === 'function'
    && typeof factoryRuntimeReadCommittedFactory === 'function'
    && typeof sessionAssetsHydrated !== 'undefined' && sessionAssetsHydrated === true
    && typeof serverLastWorkHydrating !== 'undefined' && serverLastWorkHydrating === false
    && typeof persistentStateSaving !== 'undefined' && persistentStateSaving === false
  )()`, 60000);
  return evaluate(cdp, `(() => ({
    workspaceScope: getCurrentLastWorkWorkspaceScope(),
    projectId: window.state?.currentProjectId || '',
    projectName: window.state?.currentProjectName || '',
    productName: window.state?.productName || '',
    factoryProductName: factoryRuntimeReadCommittedFactory()?.product?.productName || '',
    branch: currentWorkspaceBranch(getCurrentLastWorkWorkspaceScope(), window.state?.currentProjectId || ''),
    authority: currentWorkspaceAuthority(),
    inert: !!document.getElementById('app')?.inert || !!document.body?.inert,
  }))()`);
}

async function saveCurrentBranchAsDocument(cdp, projectName) {
  return evaluate(cdp, `(async () => {
    const branchScopeBefore = getCurrentLastWorkWorkspaceScope();
    try {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    } catch (_) {
      try { window.showSaveFilePicker = undefined; } catch (_) {}
    }
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function clickWithoutDownload() {
      if (String(this.download || '').endsWith('.kuasangse')) return;
      return nativeAnchorClick.call(this);
    };
    let bundle;
    try {
      bundle = await exportCurrentProjectFile({ name: ${JSON.stringify(projectName)} });
    } finally {
      HTMLAnchorElement.prototype.click = nativeAnchorClick;
    }
    if (!bundle) throw new Error(window.state?.error || 'current branch save returned no bundle');
    if (persistentStateSavePromise) await persistentStateSavePromise;
    return {
      bundleText: JSON.stringify(bundle),
      branchScopeBefore,
      branchScopeAfter: getCurrentLastWorkWorkspaceScope(),
      projectId: window.state.currentProjectId || '',
      productName: window.state.productName || '',
      factoryProductName: factoryRuntimeReadCommittedFactory()?.product?.productName || '',
      authority: currentWorkspaceAuthority(),
      workfileSaveState: window.state.workfileSaveState || '',
      error: window.state.error || '',
    };
  })()`, true, 120000);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const pages = [];
  const newProduct = `새작업회귀${Date.now()}`;
  const previousProduct = `이전작업회귀${Date.now()}`;
  const oldProduct = '방울수저집';
  const psdProjectName = `PSD문서분기회귀${Date.now()}`;
  const psdBaselineProduct = `PSD기준상품${Date.now()}`;
  const psdBranchAProduct = `PSD-A수정${Date.now()}`;
  const psdBranchBProduct = `PSD-B수정${Date.now()}`;
  try {
    pages.push(await openPage(), await openPage(), await openPage());
    const previousA = await typeNewWorkProduct(pages[0].cdp, previousProduct);
    const blankA = await resetAndInspectBlankDocument(pages[0].cdp, previousProduct);
    assert.notEqual(blankA.workspaceScope, previousA.workspaceScope);
    assert.equal(blankA.bootstrapScope, blankA.workspaceScope);
    assert.equal(blankA.bootstrapProductName, '');
    assert.equal(blankA.bootstrapProductId, '');
    assert.equal(blankA.tabSessionScope, blankA.workspaceScope);
    assert.equal(blankA.tabSessionProductName, '');
    assert.equal(blankA.tabSessionContainsPreviousProduct, false, JSON.stringify(blankA));
    assert.equal(blankA.storageWarning, '');

    await pages[0].cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(pages[0].cdp, `(() =>
      window.__KUASANGSE_APP_BUILD_ID__ === ${JSON.stringify(EXPECTED_BUILD_ID)}
      && document.readyState === 'complete'
      && !!document.getElementById('app')
    )()`, 60000);
    const reloadedBlankA = await evaluate(pages[0].cdp, `(() => {
      const parseRecovery = key => {
        const parsed = JSON.parse(sessionStorage.getItem(key) || '{}');
        return parsed?.schema === 'kuasangse.recovery.v1'
          ? JSON.parse(parsed.value || '{}')
          : parsed;
      };
      const tabSession = parseRecovery('pdp_session');
      const bootstrap = parseRecovery('pdp_last_work_bootstrap_v1');
      const bodyText = document.body?.innerText || '';
      return {
        productName: tabSession.productName || '',
        factoryProductName: tabSession.factory?.product?.productName || '',
        workspaceScope: tabSession.workspaceScope?.id || '',
        bootstrapScope: bootstrap.workspaceScope?.id || '',
        bodyHasPreviousProduct: bodyText.includes(${JSON.stringify(previousProduct)}),
        storageWarningVisible: bodyText.includes('서로 다른 작업파일·제품명·기본이미지가 섞인'),
      };
    })()`);
    assert.equal(reloadedBlankA.productName, '');
    assert.equal(reloadedBlankA.factoryProductName, '');
    assert.equal(reloadedBlankA.workspaceScope, blankA.workspaceScope);
    assert.equal(reloadedBlankA.bootstrapScope, blankA.workspaceScope);
    assert.equal(reloadedBlankA.bodyHasPreviousProduct, false);
    assert.equal(reloadedBlankA.storageWarningVisible, false);

    const savedA = await typeNewWorkProduct(pages[1].cdp, newProduct);
    const savedB = await typeNewWorkProduct(pages[2].cdp, oldProduct);

    await pages[1].cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(pages[1].cdp, `(() =>
      window.__KUASANGSE_APP_BUILD_ID__ === ${JSON.stringify(EXPECTED_BUILD_ID)}
      && document.readyState === 'complete'
      && !!document.getElementById('app')
    )()`, 60000);
    try {
      await waitFor(
        pages[1].cdp,
        `(() => {
          const parsed = JSON.parse(sessionStorage.getItem('pdp_session') || '{}');
          const tabSession = parsed?.schema === 'kuasangse.recovery.v1'
            ? JSON.parse(parsed.value || '{}')
            : parsed;
          return (tabSession.productName || tabSession.factory?.product?.productName || '') === ${JSON.stringify(newProduct)};
        })()`,
        10000,
      );
      await waitFor(
        pages[1].cdp,
        `(() => {
          const bodyText = document.body?.innerText || '';
          return bodyText.includes(${JSON.stringify(newProduct)})
            && !bodyText.includes('상세페이지 자동 생성기 로딩 중');
        })()`,
        60000,
      );
    } catch (error) {
      const reloadDebug = await evaluate(pages[1].cdp, `(() => {
        const parsed = JSON.parse(sessionStorage.getItem('pdp_session') || '{}');
        const tabSession = parsed?.schema === 'kuasangse.recovery.v1'
          ? JSON.parse(parsed.value || '{}')
          : parsed;
        return {
          productName: tabSession.productName || '',
          factoryProductName: tabSession.factory?.product?.productName || '',
          workspaceScope: tabSession.workspaceScope?.id || '',
          tabSessionProductName: tabSession.productName || tabSession.factory?.product?.productName || '',
          tabSessionScope: tabSession.workspaceScope?.id || '',
          bodyText: document.body?.innerText || '',
        };
      })()`);
      throw new Error(`new-work tab did not restore its own product: ${JSON.stringify({ savedA, savedB, reloadDebug })}`, {
        cause: error,
      });
    }
    const restoredA = await evaluate(pages[1].cdp, `(() => {
      const bodyText = document.body?.innerText || '';
      const parsed = JSON.parse(sessionStorage.getItem('pdp_session') || '{}');
      const tabSession = parsed?.schema === 'kuasangse.recovery.v1'
        ? JSON.parse(parsed.value || '{}')
        : parsed;
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        productName: tabSession.productName || '',
        factoryProductName: tabSession.factory?.product?.productName || '',
        workspaceScope: tabSession.workspaceScope?.id || '',
        bodyHasNewProduct: bodyText.includes(${JSON.stringify(newProduct)}),
        bodyHasOldProductAsCurrentTitle: bodyText.includes(${JSON.stringify(`${oldProduct}.kuasangse`)}),
        storageWarningVisible: bodyText.includes('서로 다른 작업파일·제품명·기본이미지가 섞인'),
      };
    })()`);
    const screenshot = await pages[1].cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    assert.equal(savedA.buildId, EXPECTED_BUILD_ID);
    assert.equal(savedA.productName, newProduct);
    assert.equal(savedA.factoryProductName, newProduct);
    assert.equal(savedA.tabSessionProductName, newProduct);
    assert.equal(savedA.tabSessionScope, savedA.workspaceScope);
    assert.equal(savedB.productName, oldProduct);
    assert.notEqual(savedA.workspaceScope, savedB.workspaceScope);
    assert.equal(restoredA.productName, newProduct);
    assert.equal(restoredA.factoryProductName, newProduct);
    assert.equal(restoredA.workspaceScope, savedA.workspaceScope);
    assert.equal(restoredA.bodyHasNewProduct, true);
    assert.equal(restoredA.bodyHasOldProductAsCurrentTitle, false);
    assert.equal(restoredA.storageWarningVisible, false);

    const sourceBundleText = await createProjectBundle(pages[0].cdp, psdProjectName, psdBaselineProduct);
    const psdFileName = `${psdProjectName}.kuasangse`;
    const openedDocumentA = await importProjectBundle(pages[1].cdp, sourceBundleText, psdFileName);
    const openedDocumentB = await importProjectBundle(pages[2].cdp, sourceBundleText, psdFileName);
    assert.equal(openedDocumentA.projectId, openedDocumentB.projectId);
    assert.equal(openedDocumentA.productName, psdBaselineProduct);
    assert.equal(openedDocumentB.productName, psdBaselineProduct);
    assert.notEqual(openedDocumentA.workspaceScope, openedDocumentB.workspaceScope);
    assert.equal(openedDocumentA.branch.documentId, openedDocumentA.projectId);
    assert.equal(openedDocumentB.branch.documentId, openedDocumentB.projectId);
    assert.equal(openedDocumentA.branch.documentScopeId, `project:${openedDocumentA.projectId}`);
    assert.equal(openedDocumentB.branch.documentScopeId, `project:${openedDocumentB.projectId}`);
    assert.equal(openedDocumentA.authority.scopeId, openedDocumentA.workspaceScope);
    assert.equal(openedDocumentB.authority.scopeId, openedDocumentB.workspaceScope);
    assert.ok(['editing', 'offline-edit'].includes(openedDocumentA.authority.mode));
    assert.ok(['editing', 'offline-edit'].includes(openedDocumentB.authority.mode));
    assert.equal(openedDocumentA.inert, false);
    assert.equal(openedDocumentB.inert, false);

    const editedDocumentA = await editCurrentBranchProduct(pages[1].cdp, psdBranchAProduct);
    const editedDocumentB = await editCurrentBranchProduct(pages[2].cdp, psdBranchBProduct);
    assert.equal(editedDocumentA.workspaceScope, openedDocumentA.workspaceScope);
    assert.equal(editedDocumentB.workspaceScope, openedDocumentB.workspaceScope);

    const reloadedDocumentA = await reloadAndInspectBranch(pages[1].cdp);
    const reloadedDocumentB = await reloadAndInspectBranch(pages[2].cdp);
    assert.equal(reloadedDocumentA.productName, psdBranchAProduct);
    assert.equal(reloadedDocumentB.productName, psdBranchBProduct);
    assert.equal(reloadedDocumentA.workspaceScope, openedDocumentA.workspaceScope);
    assert.equal(reloadedDocumentB.workspaceScope, openedDocumentB.workspaceScope);
    assert.equal(reloadedDocumentA.projectId, openedDocumentA.projectId);
    assert.equal(reloadedDocumentB.projectId, openedDocumentB.projectId);
    assert.equal(reloadedDocumentA.authority.scopeId, openedDocumentA.workspaceScope);
    assert.equal(reloadedDocumentB.authority.scopeId, openedDocumentB.workspaceScope);
    assert.equal(reloadedDocumentA.inert, false);
    assert.equal(reloadedDocumentB.inert, false);

    const committedDocumentA = await saveCurrentBranchAsDocument(pages[1].cdp, psdProjectName);
    assert.equal(committedDocumentA.workfileSaveState, 'saved');
    assert.equal(committedDocumentA.error, '');
    assert.equal(committedDocumentA.productName, psdBranchAProduct);
    assert.equal(committedDocumentA.branchScopeAfter, committedDocumentA.branchScopeBefore);
    assert.equal(committedDocumentA.branchScopeAfter, openedDocumentA.workspaceScope);
    assert.equal(committedDocumentA.authority.scopeId, openedDocumentA.workspaceScope);
    assert.ok(['editing', 'offline-edit'].includes(committedDocumentA.authority.mode));

    const siblingAfterDocumentSave = await reloadAndInspectBranch(pages[2].cdp);
    assert.equal(siblingAfterDocumentSave.productName, psdBranchBProduct);
    assert.equal(siblingAfterDocumentSave.workspaceScope, openedDocumentB.workspaceScope);
    assert.equal(siblingAfterDocumentSave.projectId, openedDocumentB.projectId);

    const freshOpenAfterSave = await importProjectBundle(
      pages[0].cdp,
      committedDocumentA.bundleText,
      psdFileName,
    );
    assert.equal(freshOpenAfterSave.productName, psdBranchAProduct);
    assert.equal(freshOpenAfterSave.projectId, openedDocumentA.projectId);
    assert.equal(freshOpenAfterSave.authority.scopeId, freshOpenAfterSave.workspaceScope);
    assert.notEqual(freshOpenAfterSave.workspaceScope, openedDocumentA.workspaceScope);
    assert.notEqual(freshOpenAfterSave.workspaceScope, openedDocumentB.workspaceScope);

    const reopenedSibling = await importProjectBundle(
      pages[2].cdp,
      committedDocumentA.bundleText,
      psdFileName,
    );
    assert.equal(reopenedSibling.productName, psdBranchAProduct);
    assert.equal(reopenedSibling.projectId, openedDocumentA.projectId);
    assert.equal(reopenedSibling.authority.scopeId, reopenedSibling.workspaceScope);
    assert.notEqual(reopenedSibling.workspaceScope, openedDocumentB.workspaceScope);

    const siblingBlankAfterNewWork = await resetAndInspectBlankDocument(pages[2].cdp, psdBranchAProduct);
    assert.equal(siblingBlankAfterNewWork.tabSessionProductName, '');
    assert.equal(siblingBlankAfterNewWork.tabSessionContainsPreviousProduct, false);
    assert.notEqual(siblingBlankAfterNewWork.workspaceScope, reopenedSibling.workspaceScope);
    const siblingBlankAfterReload = await reloadAndInspectBranch(pages[2].cdp);
    assert.equal(siblingBlankAfterReload.productName, '');
    assert.equal(siblingBlankAfterReload.projectId, '');
    assert.equal(siblingBlankAfterReload.workspaceScope, siblingBlankAfterNewWork.workspaceScope);

    const committedBranchStillOpen = await reloadAndInspectBranch(pages[1].cdp);
    assert.equal(committedBranchStillOpen.productName, psdBranchAProduct);
    assert.equal(committedBranchStillOpen.projectId, openedDocumentA.projectId);
    assert.equal(committedBranchStillOpen.workspaceScope, openedDocumentA.workspaceScope);

    const result = {
      ok: true,
      newProduct,
      previousProduct,
      oldProduct,
      previousA,
      blankA,
      reloadedBlankA,
      savedA,
      savedB,
      restoredA,
      psdDocument: {
        projectName: psdProjectName,
        baselineProduct: psdBaselineProduct,
        branchAProduct: psdBranchAProduct,
        branchBProduct: psdBranchBProduct,
        openedDocumentA,
        openedDocumentB,
        editedDocumentA,
        editedDocumentB,
        reloadedDocumentA,
        reloadedDocumentB,
        committedDocumentA: {
          ...committedDocumentA,
          bundleText: `[${committedDocumentA.bundleText.length} chars]`,
        },
        siblingAfterDocumentSave,
        freshOpenAfterSave,
        reopenedSibling,
        siblingBlankAfterNewWork,
        siblingBlankAfterReload,
        committedBranchStillOpen,
      },
      screenshot: SCREENSHOT_PATH,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, resultPath: RESULT_PATH }, null, 2));
  } finally {
    for (const page of pages) {
      try { await fetch(`${CDP_URL}/json/close/${page.target.id}`); } catch (_) {}
      try { page.cdp.close(); } catch (_) {}
    }
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
