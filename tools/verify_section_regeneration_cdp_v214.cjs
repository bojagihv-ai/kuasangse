const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  currentSourceBuildId,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9514';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'section-regeneration-v214.json');
const RUNNING_PATH = path.join(OUT_DIR, 'section-regeneration-running-v214.png');
const SUCCESS_PATH = path.join(OUT_DIR, 'section-regeneration-success-v214.png');
const FAILURE_PATH = path.join(OUT_DIR, 'section-regeneration-failure-v214.png');

function svgData(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720">
  <rect width="960" height="720" fill="#f8fafc"/>
  <rect x="110" y="110" width="740" height="500" rx="42" fill="${color}"/>
  <text x="480" y="382" text-anchor="middle" font-family="Arial" font-size="52" font-weight="700" fill="#fff">${label}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function capture(cdp, filePath) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
}

async function clickRegenerate(cdp, sectionId) {
  const result = await evaluate(cdp, `(() => {
    const authorityBefore = window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null;
    const section = document.querySelector('[data-section-id="${sectionId}"]');
    const button = section?.querySelector('button[data-generate-section="${sectionId}"]');
    if (!button) return {
      missing: true,
      step: window.state?.step || '',
      visibleSections: Array.from(document.querySelectorAll('[data-section-id]')).map(node => node.dataset.sectionId),
      contentIds: Object.keys(window.state?.sectionContents || {}),
      hiddenSectionIds: window.state?.hiddenSectionIds || [],
      recoveredMode: !!window.state?.previewRecoveredDetailMode,
    };
    section.scrollIntoView({ block: 'center' });
    button.click();
    const authorityAfter = window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null;
    return {
      buttonText: String(button.textContent || '').trim(),
      disabled: !!button.disabled,
      projectId: window.state?.currentProjectId || '',
      authorityBefore,
      authorityAfter,
    };
  })()`);
  if (result?.missing) throw new Error(`${sectionId} 다시 생성 버튼을 찾지 못했습니다: ${JSON.stringify(result)}`);
  return result;
}

async function resolveSection(cdp, sectionId) {
  await evaluate(cdp, `(() => {
    const pending = window.__sectionRegenV214?.pending?.['${sectionId}'];
    if (!pending) throw new Error('${sectionId} LLM 대기 요청이 없습니다.');
    pending.resolve();
    return true;
  })()`);
}

async function readSectionState(cdp, sectionId) {
  return evaluate(cdp, `(() => {
    const section = document.querySelector('[data-section-id="${sectionId}"]');
    const button = section?.querySelector('button[data-generate-section="${sectionId}"]');
    const variants = window.state.sectionVariants?.['${sectionId}'] || [];
    const currentId = window.state.currentSectionVariantIds?.['${sectionId}'] || '';
    const current = variants.find(item => item.id === currentId) || null;
    const content = window.state.sectionContents?.['${sectionId}'] || null;
    return {
      status: window.state.sectionGenerating?.['${sectionId}'] || '',
      buttonText: String(button?.textContent || '').trim(),
      buttonDisabled: !!button?.disabled,
      variantCount: variants.length,
      imageVariantCount: variants.filter(item => !!window.sectionVariantImageForDisplay?.('${sectionId}', item)).length,
      currentId,
      currentImage: window.state.sectionImages?.['${sectionId}'] || '',
      currentHeadline: content?.headline || '',
      currentBelongsToWork: typeof window.sectionContentBelongsToCurrentWork === 'function'
        ? window.sectionContentBelongsToCurrentWork('${sectionId}', content || {})
        : false,
      currentVariantHeadline: current?.content?.headline || '',
      error: window.state.error || '',
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sourceBuild = currentSourceBuildId();
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);

  try {
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 980,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `${APP_URL}?verifyBust=${Date.now()}` });
    await waitFor(cdp, '!!(window.state && window.render && window.regenerateSection && window.factoryState)', 60000);

    const inputImage = svgData('INPUT', '#334155');
    const oldImages = {
      header: [svgData('HEADER A', '#475569'), svgData('HEADER B', '#64748b')],
      key_features: [svgData('FEATURE A', '#7c3aed'), svgData('FEATURE B', '#8b5cf6')],
      hook: [svgData('HOOK A', '#0369a1'), svgData('HOOK B', '#0284c7')],
    };
    const generatedImages = {
      header: svgData('HEADER NEW', '#16a34a'),
      key_features: svgData('FEATURE NEW', '#22c55e'),
      hook: svgData('HOOK FAIL', '#dc2626'),
    };

    const setup = await evaluate(cdp, `(() => {
      const inputImage = ${JSON.stringify(inputImage)};
      const oldImages = ${JSON.stringify(oldImages)};
      const generatedImages = ${JSON.stringify(generatedImages)};
      const productName = '섹션재생성검증상품';
      const workspaceId = 'project_section_regeneration_v214';
      const runId = 'run_section_regeneration_v214';
      const imageBase64 = inputImage.split(',')[1];
      const factory = window.factoryState();
      const productKey = window.factoryNormalizeIdentityText(productName);
      const fingerprint = window.factoryImagePayloadFingerprint(imageBase64);
      const originalWorkspaceLock = window.__KUASANGSE_WORKSPACE_LOCK__;
      const stableDraftAuthority = Object.freeze({
        ...(originalWorkspaceLock?.snapshot?.() || {}),
        mode: 'offline-edit',
        scopeId: 'draft:section-regeneration-v214',
        fencingToken: 0,
        reasonCode: 'TEST_DRAFT',
      });
      window.__KUASANGSE_WORKSPACE_LOCK__ = Object.freeze({
        ...(originalWorkspaceLock || {}),
        snapshot: () => stableDraftAuthority,
        acquire: async () => stableDraftAuthority,
        release: async () => stableDraftAuthority,
      });

      factory.workspaceId = workspaceId;
      factory.currentProjectId = '';
      factory.workspace = { ...(factory.workspace || {}), id: '' };
      factory.product = {
        ...(factory.product || {}),
        userProductName: productName,
        productName,
        productKey,
        productIdentityKey: productKey,
        currentRunId: runId,
        inputImageFingerprint: fingerprint,
        lockedInputImageFingerprint: fingerprint,
        imageBase64,
        imageMime: 'image/svg+xml',
        imagePreview: inputImage,
      };
      // 이 검증은 섹션 후보 보존 계약만 다룬다. 저장된 프로젝트 ID를 직접 주입하면
      // 실제 프로젝트 열기 흐름의 편집권 획득을 건너뛰므로 로컬 초안 scope를 유지한다.
      window.state.currentProjectId = '';
      window.state.currentProjectName = productName;
      window.state.productName = productName;
      window.state.imageBase64 = imageBase64;
      window.state.imageMime = 'image/svg+xml';
      window.state.imagePreview = inputImage;
      window.state.analysis = {
        product_name: productName,
        category: '회귀검증',
        mood: '정돈된 실용성',
        key_features: ['헤더와 핵심 특징 재생성'],
      };
      window.attachCurrentAnalysisImageIdentity?.(window.state.analysis);
      window.state.sectionWorkScope = window.sectionWorkScopeMeta();
      window.state.sectionContents = {};
      window.state.sectionImages = {};
      window.state.sectionVariants = {};
      window.state.currentSectionVariantIds = {};
      window.state.sectionGenerationModes = {
        ...(window.state.sectionGenerationModes || {}),
        header: 'full_image',
        key_features: 'full_image',
        hook: 'full_image',
      };
      window.state.sectionBasisModes = {
        ...(window.state.sectionBasisModes || {}),
        header: 'combined',
        key_features: 'combined',
        hook: 'combined',
      };
      window.state.sectionOrder = window.orderedSections().map(section => section.id);
      window.state.hiddenSectionIds = [];
      window.state.skipSections = [];
      window.state.customSections = [];
      window.state.previewRecoveredDetailMode = false;
      window.state.sectionLocks = {};
      window.state.sectionGenerating = {};
      window.state.error = '';

      const makeContent = (sectionId, label) => {
        const content = {
          headline: label,
          subheadline: sectionId + ' 기존 후보',
          body_text: '기존 결과 보존 검증',
          bullets: ['기존 후보'],
          color_scheme: { background: '#ffffff', text_primary: '#111827', text_secondary: '#4b5563' },
          font_suggestion: { headline_size: '36px', body_size: '16px' },
          generation_mode: 'full_image',
          generation_basis: 'combined',
        };
        window.stampSectionContentWorkScope?.(content, sectionId, 'seed');
        return content;
      };

      ['header', 'key_features', 'hook'].forEach(sectionId => {
        const first = makeContent(sectionId, sectionId + ' 기존 A');
        const second = makeContent(sectionId, sectionId + ' 기존 B');
        window.state.sectionVariants[sectionId] = [];
        const firstVariant = window.rememberSectionVariant(sectionId, first, oldImages[sectionId][0], 'baseline', '기존 A');
        const secondVariant = window.rememberSectionVariant(sectionId, second, oldImages[sectionId][1], 'baseline', '기존 B');
        window.state.sectionContents[sectionId] = second;
        window.state.sectionImages[sectionId] = oldImages[sectionId][1];
        window.state.currentSectionVariantIds[sectionId] = secondVariant.id;
      });

      window.__sectionRegenV214 = {
        calls: [],
        imageCalls: [],
        pending: {},
        generatedImages,
        failImageFor: '',
      };
      window.ensureCurrentProductAnalysisForGeneration = () => true;
      window.hasImageConnection = () => true;
      window.syncFixedSectionPlacementImage = () => null;
      window.getLLMClient = () => ({
        generateSectionContent: section => {
          window.__sectionRegenV214.calls.push(section.id);
          return new Promise(resolve => {
            window.__sectionRegenV214.pending[section.id] = {
              resolve: () => resolve({
                headline: section.id + ' 새 결과 ' + window.__sectionRegenV214.calls.length,
                subheadline: '새 후보 생성 완료',
                body_text: '현재 작업 범위에만 저장되는 새 결과',
                bullets: ['새 후보'],
                color_scheme: { background: '#ffffff', text_primary: '#111827', text_secondary: '#4b5563' },
                font_suggestion: { headline_size: '36px', body_size: '16px' },
              }),
            };
          });
        },
      });
      window.generateWithSelectedImageModel = async prompt => {
        const sectionId = ['header', 'key_features', 'hook'].find(id => String(prompt || '').includes(id))
          || window.__sectionRegenV214.calls[window.__sectionRegenV214.calls.length - 1];
        window.__sectionRegenV214.imageCalls.push(sectionId);
        if (window.__sectionRegenV214.failImageFor === sectionId) throw new Error(sectionId + ' 이미지 API 검증 실패');
        return window.__sectionRegenV214.generatedImages[sectionId];
      };
      window.state.step = 'sections';
      window.render();
      return {
        build: window.__KUASANGSE_APP_BUILD_ID__ || '',
        productKey,
        fingerprint,
        initialCounts: Object.fromEntries(['header', 'key_features', 'hook'].map(id => [id, (window.state.sectionVariants[id] || []).length])),
      };
    })()`);

    const runningStates = {};
    const successStates = {};

    // 헤더와 핵심 특징은 실제 버튼을 눌러 기존 2개 후보에 새 후보를 하나씩 추가한다.
    for (const sectionId of ['header', 'key_features']) {
      const clickState = await clickRegenerate(cdp, sectionId);
      await waitFor(cdp, `window.__sectionRegenV214?.calls?.includes('${sectionId}')`, 5000);
      runningStates[sectionId] = await readSectionState(cdp, sectionId);
      if (sectionId === 'header') await capture(cdp, RUNNING_PATH);
      await resolveSection(cdp, sectionId);
      try {
        await waitFor(cdp, `window.state?.sectionContents?.['${sectionId}']?.headline?.startsWith('${sectionId} 새 결과')`, 15000);
      } catch (error) {
        const diagnostics = await evaluate(cdp, `(() => ({
          sectionId: '${sectionId}',
          calls: window.__sectionRegenV214?.calls || [],
          imageCalls: window.__sectionRegenV214?.imageCalls || [],
          pendingIds: Object.keys(window.__sectionRegenV214?.pending || {}),
          generating: window.state?.sectionGenerating?.['${sectionId}'] || '',
          error: window.state?.error || '',
          content: window.state?.sectionContents?.['${sectionId}'] || null,
          imagePresent: !!window.state?.sectionImages?.['${sectionId}'],
          currentVariantId: window.state?.currentSectionVariantIds?.['${sectionId}'] || '',
          variantCount: (window.state?.sectionVariants?.['${sectionId}'] || []).length,
          runtimeErrors: window.__sectionRegenV214?.runtimeErrors || [],
          clickState: ${JSON.stringify(clickState)},
          projectId: window.state?.currentProjectId || '',
          workspaceScope: typeof window.getCurrentLastWorkWorkspaceScope === 'function'
            ? window.getCurrentLastWorkWorkspaceScope()
            : '',
          authority: window.__KUASANGSE_WORKSPACE_LOCK__?.snapshot?.() || null,
          recentLogs: (window.factoryState?.()?.automation?.logs || []).slice(-12),
        }))()`);
        throw new Error(`${error.message}\nDETAIL-03 diagnostics: ${JSON.stringify(diagnostics)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      successStates[sectionId] = await readSectionState(cdp, sectionId);
    }

    await evaluate(cdp, `(() => {
      document.querySelector('[data-section-id="header"]')?.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await capture(cdp, SUCCESS_PATH);

    await evaluate(cdp, `(() => {
      window.__sectionRegenV214.failImageFor = 'hook';
      window.state.error = '';
      window.render();
      return true;
    })()`);
    const hookBefore = await readSectionState(cdp, 'hook');
    await clickRegenerate(cdp, 'hook');
    await waitFor(cdp, "window.__sectionRegenV214?.calls?.includes('hook')", 5000);
    const hookRunning = await readSectionState(cdp, 'hook');
    await resolveSection(cdp, 'hook');
    await waitFor(
      cdp,
      `window.state?.sectionGenerating?.hook === 'error'
        || window.state?.sectionContents?.hook?.headline?.startsWith('hook 새 결과')`,
      15000,
    );
    const hookAfter = await readSectionState(cdp, 'hook');

    await evaluate(cdp, `(() => {
      document.querySelector('[data-section-id="hook"]')?.scrollIntoView({ block: 'center' });
      return true;
    })()`);
    await capture(cdp, FAILURE_PATH);

    const proof = await evaluate(cdp, `(() => ({
      calls: window.__sectionRegenV214.calls,
      imageCalls: window.__sectionRegenV214.imageCalls,
      runtimeErrors: window.__sectionRegenV214.runtimeErrors || [],
      identity: {
        workspaceId: window.factoryState().workspaceId,
        currentRunId: window.factoryState().product.currentRunId,
        productKey: window.factoryState().product.productKey,
        inputImageFingerprint: window.factoryState().product.inputImageFingerprint,
      },
    }))()`);

    const result = {
      ok: false,
      sourceBuild,
      setup,
      runningStates,
      successStates,
      hook: { before: hookBefore, running: hookRunning, after: hookAfter },
      proof,
      screenshots: [RUNNING_PATH, SUCCESS_PATH, FAILURE_PATH],
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));

    assertChecks([
      { ok: setup.build === sourceBuild, message: `실행 빌드가 현재 소스와 다릅니다: ${setup.build} / ${sourceBuild}` },
      ...['header', 'key_features'].flatMap(sectionId => [
        { ok: runningStates[sectionId].status === 'loading', message: `${sectionId} 클릭 직후 loading 상태가 아닙니다: ${runningStates[sectionId].status}` },
        { ok: runningStates[sectionId].buttonDisabled, message: `${sectionId} 생성 중 버튼이 비활성화되지 않았습니다.` },
        { ok: /생성 중/.test(runningStates[sectionId].buttonText), message: `${sectionId} 버튼에 생성 중 표시가 없습니다: ${runningStates[sectionId].buttonText}` },
        { ok: successStates[sectionId].status === 'done', message: `${sectionId} 완료 상태가 아닙니다: ${successStates[sectionId].status}` },
        { ok: successStates[sectionId].variantCount >= setup.initialCounts[sectionId] + 1, message: `${sectionId} 새 후보가 추가되지 않았습니다: ${setup.initialCounts[sectionId]} -> ${successStates[sectionId].variantCount}` },
        { ok: successStates[sectionId].imageVariantCount >= setup.initialCounts[sectionId] + 1, message: `${sectionId} 새 이미지 후보가 추가되지 않았습니다: ${setup.initialCounts[sectionId]} -> ${successStates[sectionId].imageVariantCount}` },
        { ok: successStates[sectionId].currentBelongsToWork, message: `${sectionId} 새 결과의 현재 작업 범위 표식이 맞지 않습니다.` },
        { ok: successStates[sectionId].currentVariantHeadline === successStates[sectionId].currentHeadline, message: `${sectionId} 새 후보가 현재 선택 결과가 아닙니다.` },
      ]),
      { ok: hookRunning.status === 'loading' && hookRunning.buttonDisabled, message: '인접 Hook 실패 경로도 생성 중 상태를 표시하지 않았습니다.' },
      { ok: hookAfter.status === 'error', message: `Hook 이미지 실패 상태가 error가 아닙니다: ${hookAfter.status}` },
      { ok: /이미지 API 검증 실패/.test(hookAfter.error), message: `Hook 이미지 실패 원인이 화면 상태에 없습니다: ${hookAfter.error}` },
      { ok: hookAfter.variantCount === hookBefore.variantCount, message: `Hook 실패 후 후보 수가 바뀌었습니다: ${hookBefore.variantCount} -> ${hookAfter.variantCount}` },
      { ok: hookAfter.currentId === hookBefore.currentId, message: 'Hook 실패 후 현재 선택 후보가 바뀌었습니다.' },
      { ok: hookAfter.currentImage === hookBefore.currentImage, message: 'Hook 실패 후 기존 이미지가 바뀌었습니다.' },
      { ok: hookAfter.currentHeadline === hookBefore.currentHeadline, message: 'Hook 실패 후 기존 콘텐츠가 바뀌었습니다.' },
      { ok: proof.calls.join(',') === 'header,key_features,hook', message: `재생성 호출 범위가 다릅니다: ${proof.calls.join(',')}` },
      { ok: proof.imageCalls.join(',') === 'header,key_features,hook', message: `이미지 호출 범위가 다릅니다: ${proof.imageCalls.join(',')}` },
      { ok: proof.identity.workspaceId === 'project_section_regeneration_v214', message: `workspaceId가 바뀌었습니다: ${proof.identity.workspaceId}` },
      { ok: proof.identity.currentRunId === 'run_section_regeneration_v214', message: `currentRunId가 바뀌었습니다: ${proof.identity.currentRunId}` },
      { ok: proof.identity.productKey === setup.productKey, message: `productKey가 바뀌었습니다: ${proof.identity.productKey}` },
      { ok: proof.identity.inputImageFingerprint === setup.fingerprint, message: 'inputImageFingerprint가 바뀌었습니다.' },
    ]);

    result.ok = true;
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
