const fs = require('node:fs');
const path = require('node:path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9656';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'option-group-shot-v483-result.json');
const SCREENSHOTS = {
  optionSelected: path.join(OUT_DIR, 'option-group-shot-v483-option-selected-1280.png'),
  optionGenerated: path.join(OUT_DIR, 'option-group-shot-v483-option-generated-1280.png'),
  optionMobile: path.join(OUT_DIR, 'option-group-shot-v483-option-mobile-375.png'),
  optionMobileBottom: path.join(OUT_DIR, 'option-group-shot-v483-option-mobile-bottom-375.png'),
  factoryDesktop: path.join(OUT_DIR, 'option-group-shot-v483-factory-1280.png'),
  factoryTablet: path.join(OUT_DIR, 'option-group-shot-v483-factory-768.png'),
};

async function capture(cdp, filePath) {
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'));
}

async function scrollGroupPanelIntoView(cdp, context) {
  return evaluate(cdp, `(() => {
    const panel = document.querySelector('[data-opt-group-shot-panel="${context}"]');
    const root = document.querySelector('.app');
    if (!panel) return false;
    if (root) {
      const rootRect = root.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const contentTop = panelRect.top - rootRect.top + root.scrollTop;
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      root.scrollTo({ top: Math.min(maxScrollTop, Math.max(0, contentTop - 72)), behavior: 'auto' });
    } else {
      panel.scrollIntoView({ block: 'start', inline: 'nearest' });
    }
    return true;
  })()`);
}

async function panelLayout(cdp, context) {
  return evaluate(cdp, `(() => {
    const panel = document.querySelector('[data-opt-group-shot-panel="${context}"]');
    const root = document.querySelector('.app');
    const button = panel?.querySelector('#optGenerateGroupShot');
    if (!panel || !root || !button) return null;
    const panelRect = panel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      panelLeft: Math.round(panelRect.left),
      panelRight: Math.round(panelRect.right),
      panelWidth: Math.round(panelRect.width),
      buttonLeft: Math.round(buttonRect.left),
      buttonRight: Math.round(buttonRect.right),
      buttonVisible: buttonRect.width > 0 && buttonRect.height > 0,
      rootClientHeight: root.clientHeight,
      rootScrollHeight: root.scrollHeight,
      rootScrollable: root.scrollHeight > root.clientHeight,
      bodyOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  let cdp = null;
  try {
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', {
      url: `${APP_URL}?verifyOptionGroupShot=${Date.now()}`,
    });
    await waitFor(
      cdp,
      '!!(window.state && window.render && window.optGenerateOptionGroupShot && window.factoryState && window.factoryArchiveOptionSorterResultToWorkfile)',
      60000,
    );

    const prepared = await evaluate(cdp, `(() => {
      window.scheduleLastWorkSave = () => {};
      window.saveLastWorkNow = () => {};
      window.hasImageConnection = () => true;
      hasImageConnection = () => true;
      const colors = [
        ['진홍', '#be123c'],
        ['분홍', '#ec4899'],
        ['초록', '#15803d'],
        ['파랑', '#2563eb'],
        ['노랑', '#ca8a04'],
        ['보라', '#7e22ce'],
      ];
      const images = colors.map(([name, color], index) => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="420">'
          + '<rect width="420" height="420" fill="#f8fafc"/>'
          + '<rect x="72" y="78" width="276" height="264" rx="48" fill="' + color + '"/>'
          + '<text x="210" y="222" text-anchor="middle" font-family="Arial" font-size="34" fill="#fff">' + name + '</text>'
          + '</svg>';
        const base64 = btoa(unescape(encodeURIComponent(svg)));
        return {
          id: 'group_color_' + (index + 1),
          name: name + ' 색상용 이미지',
          mime: 'image/svg+xml',
          base64,
          preview: 'data:image/svg+xml;base64,' + base64,
          hasImageData: true,
        };
      });
      const resultSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">'
        + '<rect width="900" height="900" fill="#fffaf6"/>'
        + '<rect x="95" y="250" width="130" height="360" rx="42" fill="#be123c"/>'
        + '<rect x="240" y="210" width="130" height="400" rx="42" fill="#ec4899"/>'
        + '<rect x="385" y="175" width="130" height="435" rx="42" fill="#15803d"/>'
        + '<rect x="530" y="210" width="130" height="400" rx="42" fill="#2563eb"/>'
        + '<rect x="675" y="250" width="130" height="360" rx="42" fill="#7e22ce"/>'
        + '</svg>';
      const resultBase64 = btoa(unescape(encodeURIComponent(resultSvg)));
      const generatedImage = 'data:image/svg+xml;base64,' + resultBase64;
      window.__optionGroupShotV483 = { calls: [], generatedImage };
      window.generateWithSelectedImageModel = async (prompt, firstBase64, firstMime, extras, options) => {
        window.__optionGroupShotV483.calls.push({
          prompt,
          firstBase64Length: String(firstBase64 || '').length,
          firstMime,
          extraCount: Array.isArray(extras) ? extras.length : -1,
          purpose: options?.purpose || '',
        });
        await new Promise(resolve => setTimeout(resolve, 350));
        return generatedImage;
      };
      generateWithSelectedImageModel = window.generateWithSelectedImageModel;

      const state = window.state;
      const factory = window.factoryState();
      const workspaceId = 'group-shot-workspace-v483';
      const runId = 'group-shot-run-v483';
      const productName = '색상단체컷검증상품';
      const productKey = '색상단체컷검증상품';
      const fingerprint = 'group-shot-input-v483';
      state.step = 'optionsorter';
      state.currentProjectId = workspaceId;
      state.currentProjectName = productName;
      state.currentProjectCreatedAt = Date.now();
      state.productName = productName;
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        images,
        slots: images.map((image, index) => ({
          id: 'group_slot_' + (index + 1),
          name: image.name,
          imgIds: [image.id],
        })),
        pool: [],
        subStep: 'sort',
        optionColorImageUsage: 'use',
      });
      window.factoryStampWorkspaceIdentity?.(factory, {
        projectId: workspaceId,
        projectName: productName,
        createdAt: state.currentProjectCreatedAt,
      });
      factory.workspace = { ...(factory.workspace || {}), id: workspaceId };
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        productKey,
        currentProductKey: productKey,
        productIdentityKey: productKey,
        lockedProductKey: productKey,
        inputImageFingerprint: fingerprint,
        lockedInputImageFingerprint: fingerprint,
        currentRunId: runId,
        generationRunId: runId,
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: runId, activeTab: 'assets' };
      factory.goalRun = { ...(factory.goalRun || {}), currentRunId: runId };
      factory.stages = factory.stages || {};
      for (const stageId of ['options', 'hero']) {
        factory.stages[stageId] = {
          ...(factory.stages[stageId] || {}),
          currentRunId: runId,
          latestGenerationRunId: runId,
          selectedAssetIds: [],
          status: 'idle',
        };
      }
      factory.assets = [];
      factory.previousAssets = [];
      factory.archive = { ...(factory.archive || {}), stageRunIds: { options: runId, hero: runId }, localAssets: [] };
      window.render();
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        defaultMode: state.optionSorter.optionGroupShotSelectionMode,
        selectedCount: window.optGetGroupShotSelectedImages(state.optionSorter).length,
        sourceCardCount: document.querySelectorAll('[data-opt-group-shot-panel="optionsorter"] [data-opt-group-shot-image]').length,
        generateLabel: document.querySelector('[data-opt-group-shot-panel="optionsorter"] #optGenerateGroupShot')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      };
    })()`);

    await waitFor(
      cdp,
      'document.querySelectorAll(\'[data-opt-group-shot-panel="optionsorter"] [data-opt-group-shot-image]\').length === 6',
      15000,
    );
    Object.assign(prepared, await evaluate(cdp, `(() => ({
      sourceCardCount: document.querySelectorAll('[data-opt-group-shot-panel="optionsorter"] [data-opt-group-shot-image]').length,
      generateLabel: document.querySelector('[data-opt-group-shot-panel="optionsorter"] #optGenerateGroupShot')?.textContent?.trim() || '',
    }))()`));
    await waitFor(
      cdp,
      'typeof document.querySelector(\'[data-opt-group-shot-panel="optionsorter"] #optGroupShotPrompt\')?.oninput === \'function\'',
      5000,
    );
    await evaluate(cdp, `(() => {
      const prompt = document.querySelector('[data-opt-group-shot-panel="optionsorter"] #optGroupShotPrompt');
      if (!prompt) throw new Error('group-shot prompt missing');
      prompt.value = '앞줄과 뒷줄로 자연스럽게 배치';
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await waitFor(
      cdp,
      'window.state.optionSorter.optionGroupShotPrompt === "앞줄과 뒷줄로 자연스럽게 배치"',
      5000,
    );
    await evaluate(cdp, `(() => {
      const card = document.querySelector('[data-opt-group-shot-image="group_color_5"]');
      if (!card) throw new Error('first group-shot source card missing');
      card.click();
      return true;
    })()`);
    await waitFor(
      cdp,
      'window.optGetGroupShotSelectedImages(window.state.optionSorter).length === 5 && document.querySelector(\'[data-opt-group-shot-selected-count]\')?.textContent?.includes(\'5/6\')',
      5000,
    );
    const selection = await evaluate(cdp, `(() => {
      const prompt = document.getElementById('optGroupShotPrompt');
      return {
        stateMode: window.state.optionSorter.optionGroupShotSelectionMode,
        selectedIds: window.optGetGroupShotSelectedImages(window.state.optionSorter).map(image => image.id),
        prompt: window.state.optionSorter.optionGroupShotPrompt,
        selectedText: document.querySelector('[data-opt-group-shot-selected-count]')?.textContent?.trim() || '',
      };
    })()`);
    await scrollGroupPanelIntoView(cdp, 'optionsorter');
    await capture(cdp, SCREENSHOTS.optionSelected);

    const clickResult = await evaluate(cdp, `(() => {
      const button = document.querySelector('[data-opt-group-shot-panel="optionsorter"] #optGenerateGroupShot');
      if (!button || button.disabled) throw new Error('group-shot generate button unavailable');
      button.click();
      return true;
    })()`);
    await waitFor(
      cdp,
      'window.state.optionSorter.optionGroupShotRunning === false && window.state.optionSorter.optionResults.some(result => result?.resultKind === "color-group-shot")',
      30000,
    );
    const generated = await evaluate(cdp, `(() => {
      const os = window.state.optionSorter;
      const factory = window.factoryState();
      const result = os.optionResults.find(item => item?.resultKind === 'color-group-shot');
      const optionAsset = (factory.assets || []).find(asset => asset?.sourceMap?.optionResultId === result?.id);
      const heroAsset = (factory.assets || []).find(asset => asset?.sourceMap?.optionGroupShotResultId === result?.id);
      const panel = document.querySelector('[data-opt-group-shot-panel="optionsorter"]');
      return {
        resultCount: os.optionResults.filter(item => item?.resultKind === 'color-group-shot').length,
        result: result ? {
          id: result.id,
          sourceIds: String(result.sourceId || '').split(',').filter(Boolean),
          optionName: result.optionName || '',
          targetCount: result.generationDetails?.outputSplit?.targetCount,
          heroAssetId: result.heroAssetId || '',
          archiveId: result.archiveId || '',
          imageUrl: result.imageUrl || '',
        } : null,
        modelCalls: window.__optionGroupShotV483.calls.map(call => ({
          extraCount: call.extraCount,
          firstMime: call.firstMime,
          purpose: call.purpose,
          promptHasAllColors: /Show every selected color variant/.test(call.prompt),
          promptRejectsCollage: /not as separate cards, a contact sheet, a grid, or a collage/.test(call.prompt),
          promptHasUserDirection: /앞줄과 뒷줄로 자연스럽게 배치/.test(call.prompt),
        })),
        optionAsset: optionAsset ? {
          id: optionAsset.id,
          stageId: optionAsset.stageId,
          archiveId: optionAsset.localArchive?.archiveId || optionAsset.archiveId || '',
          imageUrl: optionAsset.imageUrl || '',
        } : null,
        heroAsset: heroAsset ? {
          id: heroAsset.id,
          stageId: heroAsset.stageId,
          used: heroAsset.used === true,
          canonicalOptionAssetId: heroAsset.sourceMap?.canonicalOptionAssetId || '',
          resultId: heroAsset.sourceMap?.optionGroupShotResultId || '',
          hasImage: !!(heroAsset.image || heroAsset.imageUrl || heroAsset.sourceMap?.imageUrl),
        } : null,
        latestVisible: !!panel?.querySelector('.opt-group-shot-latest img'),
        latestText: panel?.querySelector('.opt-group-shot-latest')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        lastError: os.optionGroupShotLastError || '',
      };
    })()`);
    await scrollGroupPanelIntoView(cdp, 'optionsorter');
    await capture(cdp, SCREENSHOTS.optionGenerated);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 760,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await scrollGroupPanelIntoView(cdp, 'optionsorter');
    const optionMobileLayout = await panelLayout(cdp, 'optionsorter');
    await capture(cdp, SCREENSHOTS.optionMobile);
    const optionMobileBottomLayout = await evaluate(cdp, `(async () => {
      const panel = document.querySelector('[data-opt-group-shot-panel="optionsorter"]');
      const prompt = panel?.querySelector('.opt-group-shot-prompt-row');
      prompt?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
      await new Promise(resolve => setTimeout(resolve, 80));
      const latest = panel?.querySelector('.opt-group-shot-latest');
      const fab = document.querySelector('.agent-fab');
      if (!panel || !prompt || !latest || !fab) return null;
      const viewportHeight = document.documentElement.clientHeight;
      const panelRect = panel.getBoundingClientRect();
      const promptRect = prompt.getBoundingClientRect();
      const latestRect = latest.getBoundingClientRect();
      const fabRect = fab.getBoundingClientRect();
      const overlaps = (a, b) => (
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      );
      return {
        promptVisible: promptRect.top >= 0 && promptRect.bottom <= viewportHeight,
        latestVisible: latestRect.top >= 0 && latestRect.bottom <= viewportHeight,
        fabOverlapsPanel: overlaps(fabRect, panelRect),
        fabRight: Math.round(fabRect.right),
        panelLeft: Math.round(panelRect.left),
        descriptionColor: getComputedStyle(panel.querySelector('.opt-group-shot-desc')).color,
        statusTextColor: getComputedStyle(panel.querySelector('.opt-group-shot-status span')).color,
      };
    })()`);
    await capture(cdp, SCREENSHOTS.optionMobileBottom);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(cdp, `(() => {
      window.state.step = 'factory';
      const factory = window.factoryState();
      factory.automation.activeTab = 'assets';
      window.render();
      return true;
    })()`);
    await waitFor(
      cdp,
      '!!document.querySelector(\'[data-opt-group-shot-panel="factory"]\') && document.querySelectorAll(\'#factoryAutomationAssetChooser_hero [data-factory-asset-id]\').length >= 1 && Array.from(document.querySelectorAll(\'#factoryAutomationAssetChooser_hero [data-factory-asset-id] img\')).some(image => image.complete && image.naturalWidth > 0)',
      15000,
    );
    await scrollGroupPanelIntoView(cdp, 'factory');
    const factoryProof = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      const heroAssets = (factory.assets || []).filter(asset => asset?.stageId === 'hero' && asset?.sourceMap?.optionGroupShotResultId);
      const panel = document.querySelector('[data-opt-group-shot-panel="factory"]');
      return {
        compactPanel: panel?.classList.contains('compact') === true,
        sourceCardCount: panel?.querySelectorAll('[data-opt-group-shot-image]').length || 0,
        selectedText: panel?.querySelector('[data-opt-group-shot-selected-count]')?.textContent?.trim() || '',
        heroAssetCount: heroAssets.length,
        heroCardCount: document.querySelectorAll('#factoryAutomationAssetChooser_hero [data-factory-asset-id]').length,
        heroTitles: heroAssets.map(asset => asset.title || ''),
      };
    })()`);
    const factoryDesktopLayout = await panelLayout(cdp, 'factory');
    await capture(cdp, SCREENSHOTS.factoryDesktop);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 768,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await scrollGroupPanelIntoView(cdp, 'factory');
    const factoryTabletLayout = await panelLayout(cdp, 'factory');
    await capture(cdp, SCREENSHOTS.factoryTablet);

    const checks = [
      { ok: prepared.defaultMode === 'all' && prepared.selectedCount === 6, message: `기본 전체 선택이 아닙니다: ${JSON.stringify(prepared)}` },
      { ok: prepared.sourceCardCount === 6 && /단체컷 1장 생성/.test(prepared.generateLabel), message: `옵션분류기 단체컷 UI가 불완전합니다: ${JSON.stringify(prepared)}` },
      { ok: selection.stateMode === 'custom' && selection.selectedIds.length === 5 && !selection.selectedIds.includes('group_color_5'), message: `일부 색상 선택이 반영되지 않았습니다: ${JSON.stringify(selection)}` },
      { ok: selection.prompt === '앞줄과 뒷줄로 자연스럽게 배치' && selection.selectedText.includes('일부 5/6장 선택'), message: `추가 지시 또는 선택 요약이 반영되지 않았습니다: ${JSON.stringify(selection)}` },
      { ok: clickResult && generated.resultCount === 1 && generated.result?.targetCount === 1 && generated.result?.sourceIds?.length === 5, message: `정확히 한 장의 일부 선택 단체컷이 생성되지 않았습니다: ${JSON.stringify(generated)}` },
      { ok: generated.modelCalls.length === 1 && generated.modelCalls[0].extraCount === 4 && generated.modelCalls[0].promptHasAllColors && generated.modelCalls[0].promptRejectsCollage && generated.modelCalls[0].promptHasUserDirection, message: `선택 5장과 기본 프롬프트가 이미지 모델 호출에 전달되지 않았습니다: ${JSON.stringify(generated.modelCalls)}` },
      { ok: generated.optionAsset?.stageId === 'options' && generated.optionAsset.archiveId && generated.optionAsset.imageUrl, message: `단체컷이 옵션 결과 로컬 아카이브에 저장되지 않았습니다: ${JSON.stringify(generated.optionAsset)}` },
      { ok: generated.heroAsset?.stageId === 'hero' && !generated.heroAsset.used && generated.heroAsset.resultId === generated.result?.id && generated.heroAsset.canonicalOptionAssetId === generated.optionAsset?.id && generated.heroAsset.hasImage, message: `대표이미지 후보 자동 연결이 불완전합니다: ${JSON.stringify(generated.heroAsset)}` },
      { ok: generated.result?.heroAssetId === generated.heroAsset?.id && generated.latestVisible && /대표이미지 후보로 추가됨 · 사용 선택 대기/.test(generated.latestText) && !generated.lastError, message: `옵션분류기 최신 결과 UI에 대표 후보 추가·선택 대기가 보이지 않습니다: ${JSON.stringify(generated)}` },
      { ok: factoryProof.compactPanel && factoryProof.sourceCardCount === 6 && factoryProof.heroAssetCount === 1 && factoryProof.heroCardCount >= 1, message: `조립공장 단체컷 UI 또는 대표 후보 카드가 없습니다: ${JSON.stringify(factoryProof)}` },
      { ok: optionMobileLayout?.buttonVisible && optionMobileLayout.rootScrollable && optionMobileLayout.bodyOverflowX <= 1 && optionMobileLayout.buttonRight <= optionMobileLayout.viewportWidth + 1, message: `375px 옵션분류기 화면에서 단체컷 조작부가 잘립니다: ${JSON.stringify(optionMobileLayout)}` },
      { ok: optionMobileBottomLayout?.promptVisible && optionMobileBottomLayout.latestVisible && !optionMobileBottomLayout.fabOverlapsPanel && optionMobileBottomLayout.fabRight <= optionMobileBottomLayout.panelLeft, message: `375px 옵션분류기 하단 입력·결과 또는 플로팅 버튼 배치가 불완전합니다: ${JSON.stringify(optionMobileBottomLayout)}` },
      { ok: factoryDesktopLayout?.buttonVisible && factoryDesktopLayout.bodyOverflowX <= 1, message: `1280px 조립공장 단체컷 조작부가 잘립니다: ${JSON.stringify(factoryDesktopLayout)}` },
      { ok: factoryTabletLayout?.buttonVisible && factoryTabletLayout.rootScrollable && factoryTabletLayout.bodyOverflowX <= 1 && factoryTabletLayout.buttonRight <= factoryTabletLayout.viewportWidth + 1, message: `768px 조립공장 화면에서 단체컷 조작부가 잘립니다: ${JSON.stringify(factoryTabletLayout)}` },
    ];
    const result = {
      ok: checks.every(check => check.ok),
      prepared,
      selection,
      generated,
      factoryProof,
      layouts: {
        optionMobile: optionMobileLayout,
        optionMobileBottom: optionMobileBottomLayout,
        factoryDesktop: factoryDesktopLayout,
        factoryTablet: factoryTabletLayout,
      },
      screenshots: SCREENSHOTS,
      failures: checks.filter(check => !check.ok).map(check => check.message),
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2), 'utf8');
    console.log(JSON.stringify({ ...result, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    if (cdp) await cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
