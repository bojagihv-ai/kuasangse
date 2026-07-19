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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9645';
const EVIDENCE_DIR = path.resolve(__dirname, '..', 'output', 'debug-evidence');
const OPTION_SORTER_SCREENSHOT_PATH = path.join(EVIDENCE_DIR, 'option-sorter-send-controls-v189.png');
const SCREENSHOT_PATH = path.join(EVIDENCE_DIR, 'option-sorter-send-factory-v189.png');

async function main() {
  const runtime = await ensureCdp(CDP_URL);
  let cdp = null;
  try {
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);

    const prepared = await evaluate(cdp, `(() => {
      window.scheduleLastWorkSave = () => {};
      window.saveLastWorkNow = () => {};
      const state = window.state;
      const factory = window.factoryState();
      const scope = {
        workspaceId: 'option-send-workspace-v189',
        currentRunId: 'option_send_run_v189',
        productKey: '옵션전송현재작업테스트',
        inputImageFingerprint: 'option-send-input-v189',
        stageId: 'options',
      };
      const image = index => 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="260"><rect width="360" height="260" fill="#ffffff"/><text x="180" y="135" text-anchor="middle">option sheet ' + index + '</text></svg>');
      const results = [1, 2, 3].map(index => ({
        id: 'option_send_result_v189_' + index,
        image: image(index),
        hasImage: true,
        optionName: '현재 생성 옵션표 ' + index,
        batchLabel: '현재 생성안',
        prompt: 'verification',
        factoryScope: { ...scope },
      }));
      state.step = 'optionsorter';
      state.currentProjectId = scope.workspaceId;
      state.productName = scope.productKey;
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionColorImageUsage: 'use',
        subStep: 'sort',
        optionResults: results,
        optionLastGeneratedResultIds: results.map(result => result.id),
      });
      factory.workspace = { ...(factory.workspace || {}), id: scope.workspaceId };
      factory.product = {
        ...(factory.product || {}),
        productName: scope.productKey,
        userProductName: scope.productKey,
        currentProductKey: scope.productKey,
        productKey: scope.productKey,
        lockedProductKey: scope.productKey,
        lockedInputImageFingerprint: scope.inputImageFingerprint,
        currentRunId: scope.currentRunId,
        generationRunId: scope.currentRunId,
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: scope.currentRunId, activeTab: 'assets' };
      factory.goalRun = { ...(factory.goalRun || {}), currentRunId: scope.currentRunId };
      factory.stages = factory.stages || {};
      factory.stages.options = {
        ...(factory.stages.options || {}),
        currentRunId: scope.currentRunId,
        latestGenerationRunId: scope.currentRunId,
        selectedAssetIds: [],
        status: 'idle',
      };
      factory.assets = [];
      factory.previousAssets = [];
      document.activeElement?.blur?.();
      factory.automation.fieldCommitInProgress = false;
      window.render();
      const optionPanel = document.querySelector('.opt-option-gen-panel');
      const resultScopes = state.optionSorter.optionResults.map(result => ({
        id: result.id,
        factoryScope: result.factoryScope || null,
        match: window.factoryOptionSorterResultMatchesCurrentJob(result, factory),
      }));
      return {
        step: state.step,
        optionPanelExists: !!optionPanel,
        optionResultCount: state.optionSorter.optionResults.length,
        optionLastGeneratedResultIds: state.optionSorter.optionLastGeneratedResultIds,
        currentScope: window.factoryOptionResultCurrentScope(factory),
        resultScopes,
        sendButtonExists: !!document.getElementById('optSendCurrentOptionResultsToFactory'),
        resultSendButtonCount: document.querySelectorAll('[data-opt-send-factory-result]').length,
      };
    })()`);

    assertChecks([
      { ok: prepared.sendButtonExists, message: `현재 생성안 전체 전송 버튼이 없습니다: ${JSON.stringify(prepared)}` },
      { ok: prepared.resultSendButtonCount === 3, message: `결과별 전송 버튼 3개가 없습니다: ${JSON.stringify(prepared)}` },
    ]);

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    await evaluate(cdp, `(() => {
      const button = document.getElementById('optSendCurrentOptionResultsToFactory');
      const main = button?.closest?.('main.main');
      if (button && main) {
        const mainRect = main.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        main.scrollTo({ top: Math.max(0, buttonRect.top - mainRect.top + main.scrollTop - 80), behavior: 'auto' });
      }
      return !!button;
    })()`);
    const optionSorterScreenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OPTION_SORTER_SCREENSHOT_PATH, Buffer.from(optionSorterScreenshot.data, 'base64'));

    await evaluate(cdp, 'document.getElementById("optSendCurrentOptionResultsToFactory").click()');
    await waitFor(cdp, 'window.state.step === "factory" && window.factoryUsableAssetsForStage("options", window.factoryState()).length === 3', 30000);
    const proof = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const assets = window.factoryUsableAssetsForStage('options', factory);
      const scope = window.factoryCurrentJobKey('options', factory);
      return {
        step: window.state.step,
        currentAssetCount: assets.length,
        cardCount: document.querySelectorAll('#factoryAutomationAssetChooser_options [data-factory-asset-id]').length,
        stageStatus: factory.stages?.options?.status || '',
        stageMessage: factory.stages?.options?.message || '',
        assetScopes: assets.map(asset => ({
          currentRunId: asset.currentRunId,
          productKey: asset.productKey,
          inputImageFingerprint: asset.inputImageFingerprint,
          stageId: asset.stageId,
          sourceResultId: asset.sourceMap?.optionResultId || '',
        })),
        scope,
      };
    })()`);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const captureTarget = await evaluate(cdp, `(() => {
      const target = document.querySelector('#factoryAutomationAssetChooser_options');
      const main = target?.closest?.('main.main');
      const candidate = target?.querySelector('[data-factory-asset-id]') || target;
      if (target && main) {
        const mainRect = main.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const stickyHeight = Math.max(84, Math.round(document.querySelector('.top-command-row')?.getBoundingClientRect().height || 0) + 12);
        const contentTop = targetRect.top - mainRect.top + main.scrollTop;
        const maxScrollTop = Math.max(0, main.scrollHeight - main.clientHeight);
        main.scrollTo({ top: Math.min(maxScrollTop, Math.max(0, contentTop - stickyHeight)), behavior: 'auto' });
      }
      const candidateRect = candidate?.getBoundingClientRect();
      return {
        hasTarget: !!target,
        hasCandidate: !!candidate,
        candidateInViewport: !!candidateRect && candidateRect.top >= 0 && candidateRect.bottom <= window.innerHeight,
        candidateRect: candidateRect ? { top: candidateRect.top, bottom: candidateRect.bottom, height: candidateRect.height } : null,
        viewportHeight: window.innerHeight,
      };
    })()`);
    await new Promise(resolve => setTimeout(resolve, 140));
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    const legacyPrepared = await evaluate(cdp, `(() => {
      const state = window.state;
      const factory = window.factoryState();
      const scope = window.factoryOptionResultCurrentScope(factory);
      const image = index => 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="260"><rect width="360" height="260" fill="#ffffff"/><text x="180" y="135" text-anchor="middle">legacy option ' + index + '</text></svg>');
      const currentUnscoped = {
        id: 'option_send_legacy_unscoped_v189',
        image: image(1),
        hasImage: true,
        optionName: '명시 전송 확인용 옵션표',
        batchLabel: '이전 생성안',
        prompt: 'legacy verification',
      };
      const mismatched = {
        id: 'option_send_legacy_previous_v189',
        image: image(2),
        hasImage: true,
        optionName: '이전 작업 옵션표',
        batchLabel: '이전 생성안',
        prompt: 'previous verification',
        factoryScope: { ...scope, currentRunId: 'other_option_run_v189' },
      };
      state.step = 'optionsorter';
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        optionColorImageUsage: 'use',
        subStep: 'sort',
        optionResults: [currentUnscoped, mismatched],
        optionLastGeneratedResultIds: [currentUnscoped.id],
      });
      factory.assets = [];
      factory.previousAssets = [];
      document.activeElement?.blur?.();
      factory.automation.fieldCommitInProgress = false;
      window.render();
      const bulkButton = document.getElementById('optSendCurrentOptionResultsToFactory');
      const currentButton = document.querySelector('[data-opt-send-factory-result="option_send_legacy_unscoped_v189"]');
      const previousButton = document.querySelector('[data-opt-send-factory-result="option_send_legacy_previous_v189"]');
      return {
        currentButtonDisabled: !!currentButton && currentButton.disabled,
        previousButtonDisabled: !!previousButton && previousButton.disabled,
        bulkButtonDisabled: !!bulkButton && bulkButton.disabled,
      };
    })()`);
    assertChecks([
      { ok: legacyPrepared.currentButtonDisabled, message: `범위 미기록 옵션표 전송 버튼이 차단되지 않았습니다: ${JSON.stringify(legacyPrepared)}` },
      { ok: legacyPrepared.previousButtonDisabled, message: `이전 작업 옵션표 전송 버튼이 차단되지 않았습니다: ${JSON.stringify(legacyPrepared)}` },
      { ok: legacyPrepared.bulkButtonDisabled, message: `범위 미기록 옵션표 일괄 전송 버튼이 차단되지 않았습니다: ${JSON.stringify(legacyPrepared)}` },
    ]);
    const legacySend = await evaluate(cdp, 'window.factorySendOptionSorterResultsToFactory(["option_send_legacy_unscoped_v189", "option_send_legacy_previous_v189"])');
    const legacyProof = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const assets = window.factoryUsableAssetsForStage('options', factory);
      const bound = window.state.optionSorter.optionResults.find(result => result.id === 'option_send_legacy_unscoped_v189');
      return {
        assetResultIds: assets.map(asset => asset.sourceMap?.optionResultId || ''),
        boundScope: bound?.factoryScope || null,
        previousInCurrentAssets: assets.some(asset => asset.sourceMap?.optionResultId === 'option_send_legacy_previous_v189'),
      };
    })()`);

    const checks = [
      { ok: proof.step === 'factory', message: `전송 후 조립공장으로 이동하지 않았습니다: ${JSON.stringify(proof)}` },
      { ok: proof.currentAssetCount === 3, message: `현재 범위 옵션 후보가 3장이 아닙니다: ${JSON.stringify(proof)}` },
      { ok: proof.cardCount === 3, message: `조립공장 후보 카드 3장이 화면에 보이지 않습니다: ${JSON.stringify(proof)}` },
      { ok: captureTarget.hasTarget && captureTarget.hasCandidate, message: `후보 카드 화면 위치를 찾지 못했습니다: ${JSON.stringify(captureTarget)}` },
      { ok: captureTarget.candidateInViewport, message: `후보 카드가 캡처 뷰포트 안에 들어오지 않았습니다: ${JSON.stringify(captureTarget)}` },
      { ok: proof.stageStatus === 'done' && /3개/.test(proof.stageMessage), message: `옵션 단계 완료 상태가 아닙니다: ${JSON.stringify(proof)}` },
      { ok: proof.assetScopes.every(asset => asset.currentRunId === proof.scope.currentRunId && asset.productKey === proof.scope.productKey && asset.inputImageFingerprint === proof.scope.inputImageFingerprint && asset.stageId === proof.scope.stageId), message: `현재 범위 키가 다른 옵션 후보가 섞였습니다: ${JSON.stringify(proof)}` },
      { ok: !legacySend?.ok && legacyProof.assetResultIds.length === 0, message: `범위 미기록 또는 이전 작업 옵션표가 현재 후보에 섞였습니다: ${JSON.stringify({ legacySend, legacyProof })}` },
      { ok: !legacyProof.boundScope && !legacyProof.previousInCurrentAssets, message: `범위 미기록 결과가 현재 작업 범위로 덮어써졌거나 이전 결과가 섞였습니다: ${JSON.stringify(legacyProof)}` },
    ];
    console.log(JSON.stringify({
      ok: checks.every(check => check.ok),
      prepared,
      proof,
      captureTarget,
      legacyPrepared,
      legacyProof,
      optionSorterScreenshotPath: OPTION_SORTER_SCREENSHOT_PATH,
      screenshotPath: SCREENSHOT_PATH,
    }, null, 2));
    assertChecks(checks);
  } finally {
    if (cdp) cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
