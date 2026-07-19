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
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-usage-ctrl-f5-persistence-v218.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1365,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.render && window.saveLastWorkNow)', 60000);

    const seed = String(Date.now());
    const proofBeforeReload = await evaluate(cdp, `(async () => {
      const projectId = 'usage_ctrl_f5_persistence_v218_' + ${JSON.stringify(seed)};
      const productName = '사용용도복원검증상품' + ${JSON.stringify(seed)};
      const runId = 'usage_ctrl_f5_run_v218_' + ${JSON.stringify(seed)};
      const imageFingerprint = 'usage_ctrl_f5_image_v218_' + ${JSON.stringify(seed)};
      window.state.step = 'factory';
      window.state.currentProjectId = projectId;
      window.state.currentProjectName = productName;
      window.state.currentProjectCreatedAt = Date.now();
      window.state.productName = productName;
      window.state.factory = window.normalizeFactoryState({});
      const factory = window.factoryState();
      window.factoryStampWorkspaceIdentity(factory, { projectId, projectName: productName, createdAt: window.state.currentProjectCreatedAt });
      factory.product.productName = productName;
      factory.product.userProductName = productName;
      factory.product.currentRunId = runId;
      factory.product.generationRunId = runId;
      factory.product.inputImageFingerprint = imageFingerprint;
      factory.product.lockedInputImageFingerprint = imageFingerprint;
      factory.automation.currentRunId = runId;
      factory.goalRun.currentRunId = runId;
      factory.automation.activeTab = 'fields';
      const authority = await window.ensureWorkspaceEditAuthority('project:' + projectId);
      if (authority?.mode !== 'editing') throw new Error('usage persistence authority acquisition failed');
      window.render();

      const input = document.querySelector('[data-factory-wizard-field="usage"]');
      const button = document.querySelector('[data-factory-wizard-commit="usage"]');
      if (!input || !button) throw new Error('사용용도 입력 또는 확인 버튼을 찾지 못했습니다.');
      input.value = '선물 포장, 답례품';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();

      // v218 이전에 확인한 값은 수동 설정에 scope가 없을 수 있다.
      // 같은 작업 범위의 확인 기록이 정확히 일치할 때만 scope를 이행한다.
      const usageSetting = factory.product.dbFieldSettings.usage;
      delete usageSetting.workspaceId;
      delete usageSetting.productKey;
      delete usageSetting.currentRunId;
      delete usageSetting.inputImageFingerprint;
      delete usageSetting.stageId;

      // 같은 작업파일의 이전 DB 후보만 오래된 제품명을 가진 상황을 재현한다.
      // 후보/원격 데이터는 분리하되, 사용자가 직접 확정한 값은 보존되어야 한다.
      factory.product.finalDb = { product_name: '이전제품후보' + ${JSON.stringify(seed)} };
      window.repairFactoryProductIdentityDrift(factory);
      const summary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
      const usage = summary.fields.find(field => field.id === 'usage') || {};
      const saveResults = await window.saveLastWorkNow({ force: true, deep: true });
      const scopeId = window.getCurrentLastWorkWorkspaceScope();
      const localSession = JSON.parse(localStorage.getItem('pdp_session') || '{}');
      const indexedEnvelope = await window.workspaceGet('sessionAssets', 'workspace-envelope:' + scopeId);
      const serverRecord = await fetch('http://127.0.0.1:5050/api/last-work?workspaceId=' + encodeURIComponent(scopeId), { cache: 'no-store' }).then(response => response.json());
      return {
        projectId,
        productName,
        imageFingerprint,
        usageStatus: usage.status || '',
        usageValue: usage.value || '',
        manualValue: factory.product.dbFieldSettings?.usage?.manualValue || '',
        scopeMigrated: !!factory.product.dbFieldSettings?.usage?.workspaceId,
        finalDb: factory.product.finalDb,
        saveResults: saveResults.map(item => ({ status: item.status, value: item.value, reason: String(item.reason || '') })),
        storedUsage: {
          local: localSession.factory?.product?.dbFieldSettings?.usage?.manualValue || '',
          indexed: indexedEnvelope?.workspaceEnvelope?.snapshot?.factory?.product?.dbFieldSettings?.usage?.manualValue || '',
          serverLightweight: serverRecord.snapshot?.lightweight?.factory?.product?.dbFieldSettings?.usage?.manualValue || '',
          serverAssets: serverRecord.snapshot?.assets?.factory?.product?.dbFieldSettings?.usage?.manualValue || '',
          revision: serverRecord.revision || 0,
        },
      };
    })()`);

    assertChecks([
      { ok: proofBeforeReload.usageStatus === 'done', message: `이전 DB 후보 분리 후 사용용도 완료 상태가 사라졌습니다: ${proofBeforeReload.usageStatus}` },
      { ok: proofBeforeReload.usageValue === '선물 포장, 답례품', message: `이전 DB 후보 분리 후 사용용도 값이 사라졌습니다: ${proofBeforeReload.usageValue}` },
      { ok: proofBeforeReload.manualValue === '선물 포장, 답례품', message: `이전 DB 후보 분리 후 직접 확정값이 삭제됐습니다: ${proofBeforeReload.manualValue}` },
      { ok: proofBeforeReload.scopeMigrated, message: '기존 작업파일의 동일 범위 확인 기록에서 수동값 scope를 이행하지 못했습니다.' },
      { ok: proofBeforeReload.finalDb === null, message: '이전 제품의 finalDb가 현재 작업에 남았습니다.' },
    ]);

    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.render)', 60000);
    await waitFor(cdp, `window.state.currentProjectId === ${JSON.stringify(proofBeforeReload.projectId)}`, 15000);
    const proofAfterReload = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      factory.automation.activeTab = 'fields';
      window.render();
      const summary = window.factoryAutomationReviewSummary(factory, window.factoryAutomationCounts(factory));
      const usage = summary.fields.find(field => field.id === 'usage') || {};
      const inputs = Array.from(document.querySelectorAll('[data-factory-wizard-field="usage"]'));
      const input = inputs.find(item => item.closest('.factory-automation-panel')) || inputs[0];
      const row = input?.closest('.factory-automation-status-card') || input?.parentElement;
      row?.scrollIntoView({ block: 'center', behavior: 'auto' });
      const rect = row?.getBoundingClientRect();
      return {
        projectId: window.state.currentProjectId,
        usageStatus: usage.status || '',
        usageValue: usage.value || '',
        manualValue: factory.product.dbFieldSettings?.usage?.manualValue || '',
        inputValue: input?.value || '',
        cardText: String(row?.textContent || '').trim(),
        inputVisible: !!rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight,
      };
    })()`);

    await new Promise(resolve => setTimeout(resolve, 350));

    await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      .then(result => fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(result.data, 'base64')));
    assertChecks([
      { ok: proofBeforeReload.saveResults?.[0]?.value === true, message: `최신 세션 저장이 durable commit되지 않았습니다: ${JSON.stringify(proofBeforeReload.saveResults)}` },
      { ok: proofBeforeReload.storedUsage?.local === '선물 포장, 답례품', message: `Ctrl+F5 직전 로컬 저장값이 비었습니다: ${JSON.stringify(proofBeforeReload.storedUsage)}` },
      { ok: proofAfterReload.projectId === proofBeforeReload.projectId, message: `Ctrl+F5 뒤 다른 작업파일이 복원됐습니다: ${proofAfterReload.projectId}` },
      { ok: proofAfterReload.usageStatus === 'done', message: `Ctrl+F5 뒤 사용용도 완료 상태가 사라졌습니다: ${proofAfterReload.usageStatus}` },
      { ok: proofAfterReload.usageValue === '선물 포장, 답례품', message: `Ctrl+F5 뒤 사용용도 값이 사라졌습니다: ${proofAfterReload.usageValue}` },
      { ok: proofAfterReload.manualValue === '선물 포장, 답례품', message: `Ctrl+F5 뒤 작업파일 직접 확정값이 유실됐습니다: ${proofAfterReload.manualValue}` },
      { ok: proofAfterReload.inputValue === '선물 포장, 답례품', message: `Ctrl+F5 뒤 화면 입력값이 비었습니다: ${proofAfterReload.inputValue}` },
      { ok: proofAfterReload.inputVisible && proofAfterReload.cardText.includes('사용용도'), message: 'Ctrl+F5 뒤 사용용도 확인 카드가 화면에 보이지 않습니다.' },
    ]);
    console.log(JSON.stringify({ proofBeforeReload, proofAfterReload, screenshot: SCREENSHOT_PATH }, null, 2));
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
