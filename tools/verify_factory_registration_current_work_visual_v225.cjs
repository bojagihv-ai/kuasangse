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
const BACKEND_URL = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9811';
const WORKSPACE_SCOPE = process.env.KUASANGSE_WORKSPACE_SCOPE || 'project:project_mrm2jesp_6sr4ib';
const VERIFY_CTRL_F5 = process.env.KUASANGSE_VERIFY_CTRL_F5 === '1';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const ASSETS_SCREENSHOT = path.join(OUT_DIR, 'factory-registration-current-work-assets-v225.png');
const REGISTRATION_SCREENSHOT = path.join(OUT_DIR, 'factory-registration-current-work-send-v225.png');
const SECTIONS_SCREENSHOT = path.join(OUT_DIR, 'factory-registration-current-work-sections-v227.png');
const CTRL_F5_SCREENSHOT = path.join(OUT_DIR, 'factory-registration-current-work-ctrl-f5-v227.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-registration-current-work-visual-v225.json');

async function capture(cdp, targetPath) {
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(targetPath, Buffer.from(screenshot.data, 'base64'));
}

async function showTab(cdp, tabId, selector, targetPath) {
  await evaluate(cdp, `(() => {
    const factory = window.factoryState();
    factory.automation = factory.automation || {};
    factory.automation.activeTab = ${JSON.stringify(tabId)};
    window.render();
  })()`);
  await waitFor(cdp, `!!document.querySelector(${JSON.stringify(selector)})`, 30000);
  await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'start', inline: 'nearest' })`);
  await evaluate(cdp, 'new Promise(resolve => setTimeout(resolve, 1200))');
  await capture(cdp, targetPath);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  let proof = null;

  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?registrationCurrentWork=v226` });
    await waitFor(cdp, '!!(window.__kuasangseState && window.applyWorkspacePayload && window.applySessionAssetsPayload && window.factoryState)', 60000);
    proof = await evaluate(cdp, `(async () => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init = {}) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        if (method !== 'GET' && url.includes('/api/last-work')) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, accepted: true, blockedByVisualTest: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        return nativeFetch(input, init);
      };
      const response = await fetch(${JSON.stringify(`${BACKEND_URL}/api/last-work?workspaceId=${encodeURIComponent(WORKSPACE_SCOPE)}`)});
      const body = await response.json();
      if (!response.ok || !body?.hasSnapshot || !body.snapshot) throw new Error('현재 작업 스냅샷 조회 실패');
      const snapshot = body.snapshot;
      const projectId = String(snapshot.workspaceId || snapshot.assets?.currentProjectId || '').replace(/^project:/, '');
      window.applyWorkspacePayload(snapshot.lightweight, {
        projectId,
        createdAt: snapshot.savedAt || Date.now(),
        skipPersistence: true,
        skipSideEffects: true,
        replaceWorkspace: true,
      });
      const applied = window.applySessionAssetsPayload(snapshot.assets, {
        preserveInlineImages: true,
        allowScopedInlineImages: true,
      });
      window.__kuasangseState.step = 'factory';
      const factory = window.factoryState();
      factory.automation = factory.automation || {};
      factory.automation.activeTab = 'assets';
      if (${VERIFY_CTRL_F5} && typeof window.savePersistentState === 'function') {
        window.savePersistentState({ skipVisibleSync: true });
      }
      window.render();
      const product = factory.product || {};
      const assets = factory.assets || [];
      const activeAssets = assets.filter(asset => !asset.rejected);
      const stageCounts = Object.fromEntries(['hero', 'size', 'cuts', 'options', 'detail'].map(stageId => [
        stageId,
        activeAssets.filter(asset => asset.stageId === stageId).length,
      ]));
      const selectedCounts = Object.fromEntries(['hero', 'size', 'cuts', 'options'].map(stageId => [
        stageId,
        factory.stages?.[stageId]?.selectedAssetIds?.length || 0,
      ]));
      return {
        applied,
        productName: product.productName,
        productKey: product.productKey,
        registrationProductName: product.cafe24FinalRegistration?.productName,
        currentRunId: product.currentRunId,
        inputImageFingerprint: product.inputImageFingerprint || product.lockedInputImageFingerprint,
        totalAssets: assets.length,
        activeAssets: activeAssets.length,
        rejectedAssets: assets.filter(asset => asset.rejected).length,
        stageCounts,
        selectedCounts,
        usage: product.dbFieldSettings?.usage?.manualValue || '',
        sectionImages: Object.keys(window.__kuasangseState?.sectionImages || {}).length,
        sectionContents: Object.keys(window.__kuasangseState?.sectionContents || {}).length,
      };
    })()`);

    await showTab(cdp, 'assets', '#factoryStageCard_hero', ASSETS_SCREENSHOT);
    const assetsDom = await evaluate(cdp, `(() => ({
      assetCards: document.querySelectorAll('[data-factory-asset-id]').length,
      visibleLoadedImages: [...document.images].filter(img => img.getBoundingClientRect().height > 0 && img.complete && img.naturalWidth > 0).length,
      brokenImages: [...document.images].filter(img => img.getBoundingClientRect().height > 0 && img.complete && img.naturalWidth === 0).length,
      bodyHasProductName: document.body.innerText.includes('슬라브나비수저집'),
    }))()`);
    proof.assetsDom = assetsDom;

    await showTab(cdp, 'send', '[data-factory-final-registration]', REGISTRATION_SCREENSHOT);
    proof.registrationDom = await evaluate(cdp, `(() => ({
      panelVisible: !!document.querySelector('[data-factory-final-registration]'),
      productNameInput: document.querySelector('[data-factory-final-basic-field="product_name"]')?.value || '',
      bodyHasRegistrationName: document.body.innerText.includes('슬라브나비수저집테스트'),
    }))()`);

    await evaluate(cdp, `(() => { window.__kuasangseState.step = 'preview'; window.render(); })()`);
    await waitFor(cdp, '!!document.querySelector(".preview-builder")', 30000);
    await evaluate(cdp, 'document.querySelector(".preview-builder")?.scrollIntoView({ block: "start" }); new Promise(resolve => setTimeout(resolve, 1800))');
    await capture(cdp, SECTIONS_SCREENSHOT);
    proof.sectionsDom = await evaluate(cdp, `(() => ({
      renderedSections: document.querySelectorAll('[data-preview-section]').length,
      outlineItems: document.querySelectorAll('[data-outline-section-id]').length,
      loadedSectionImages: [...document.querySelectorAll('[data-preview-section] img')].filter(img => img.complete && img.naturalWidth > 0).length,
      brokenSectionImages: [...document.querySelectorAll('[data-preview-section] img')].filter(img => img.complete && img.naturalWidth === 0).length,
    }))()`);

    if (VERIFY_CTRL_F5) {
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor(cdp, '!!(window.__kuasangseState && window.render && window.factoryState)', 60000);
      await waitFor(cdp, 'Object.keys(window.__kuasangseState.sectionImages || {}).length === 15 && Object.keys(window.__kuasangseState.sectionContents || {}).length === 15', 90000);
      await evaluate(cdp, `(() => { window.__kuasangseState.step = 'preview'; window.render(); })()`);
      await waitFor(cdp, 'document.querySelectorAll("[data-preview-section]").length === 15', 30000);
      await evaluate(cdp, 'new Promise(resolve => setTimeout(resolve, 1800))');
      proof.ctrlF5 = await evaluate(cdp, `(() => ({
        productName: window.factoryState()?.product?.productName || '',
        productKey: window.factoryState()?.product?.productKey || '',
        sectionImages: Object.keys(window.__kuasangseState.sectionImages || {}).length,
        sectionContents: Object.keys(window.__kuasangseState.sectionContents || {}).length,
        renderedSections: document.querySelectorAll('[data-preview-section]').length,
        loadedSectionImages: [...document.querySelectorAll('[data-preview-section] img')].filter(img => img.complete && img.naturalWidth > 0).length,
        brokenSectionImages: [...document.querySelectorAll('[data-preview-section] img')].filter(img => img.complete && img.naturalWidth === 0).length,
      }))()`);
      await capture(cdp, CTRL_F5_SCREENSHOT);
    }
  } finally {
    try { cdp.close(); } catch (_) {}
    await runtime.cleanup?.();
  }

  const checks = [
    { ok: proof?.applied === true, message: '현재 작업 저장본이 화면에 적용되지 않았습니다.' },
    { ok: proof?.productName === '슬라브나비수저집' && proof?.productKey === '슬라브나비수저집', message: `현재 작업 제품 기준이 다릅니다: ${JSON.stringify(proof)}` },
    { ok: proof?.registrationProductName === '슬라브나비수저집테스트', message: `Cafe24 등록용 상품명이 보존되지 않았습니다: ${JSON.stringify(proof)}` },
    { ok: proof?.totalAssets === 15 && proof?.activeAssets === 15 && proof?.rejectedAssets === 0, message: `복원 이미지 수가 다릅니다: ${JSON.stringify(proof)}` },
    { ok: ['hero', 'size', 'cuts', 'options'].every(stageId => proof?.selectedCounts?.[stageId] === 1), message: `단계별 선택 이미지가 복원되지 않았습니다: ${JSON.stringify(proof?.selectedCounts)}` },
    { ok: proof?.usage === '수저포장,부채집으로도활용가능', message: `사용용도가 복원되지 않았습니다: ${JSON.stringify(proof?.usage)}` },
    { ok: proof?.sectionImages === 15 && proof?.sectionContents === 15, message: `저장본의 상세페이지 15개 섹션이 복원되지 않았습니다: ${JSON.stringify(proof)}` },
    { ok: proof?.assetsDom?.assetCards > 0 && proof?.assetsDom?.visibleLoadedImages > 0 && proof?.assetsDom?.brokenImages === 0, message: `이미지 후보 화면이 비었거나 깨졌습니다: ${JSON.stringify(proof?.assetsDom)}` },
    { ok: proof?.registrationDom?.panelVisible && proof?.registrationDom?.productNameInput === '슬라브나비수저집테스트', message: `최종 등록 화면 상품명이 다릅니다: ${JSON.stringify(proof?.registrationDom)}` },
    { ok: proof?.sectionsDom?.renderedSections === 15 && proof?.sectionsDom?.outlineItems === 15 && proof?.sectionsDom?.loadedSectionImages >= 15 && proof?.sectionsDom?.brokenSectionImages === 0, message: `상세페이지 미리보기 15개 섹션이 화면에 정상 렌더링되지 않았습니다: ${JSON.stringify(proof?.sectionsDom)}` },
    ...(VERIFY_CTRL_F5 ? [{ ok: proof?.ctrlF5?.productName === '슬라브나비수저집' && proof?.ctrlF5?.productKey === '슬라브나비수저집' && proof?.ctrlF5?.sectionImages === 15 && proof?.ctrlF5?.sectionContents === 15 && proof?.ctrlF5?.renderedSections === 15 && proof?.ctrlF5?.loadedSectionImages > 0 && proof?.ctrlF5?.brokenSectionImages === 0, message: `캐시 무시 새로고침 후 상세페이지 섹션이 보존되지 않았습니다: ${JSON.stringify(proof?.ctrlF5)}` }] : []),
  ];
  const failures = checks.filter(check => !check.ok).map(check => check.message);
  const result = {
    ok: failures.length === 0,
    proof,
    checks,
    failures,
    screenshots: [ASSETS_SCREENSHOT, REGISTRATION_SCREENSHOT, SECTIONS_SCREENSHOT, ...(VERIFY_CTRL_F5 ? [CTRL_F5_SCREENSHOT] : [])],
  };
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  assertChecks(checks);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
