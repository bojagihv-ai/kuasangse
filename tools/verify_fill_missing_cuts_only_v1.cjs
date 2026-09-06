// 계약: **끊긴 단계의 "나머지 N개만 생성" 은 부족한 N장만 만들고, 멀쩡한 장은 그대로 둔 채 셋을 함께 보여 준다.**
//
// 실측 2026-09-06: 새로고침으로 3장 중 1장만 남았을 때 "재생성" 은 3장을 전부 다시 만들어
// 멀쩡한 1장까지 요금·시간을 다시 썼다. 사장님: "3컷 생성 안 된 거니? 하나만 뜨네".
//
// 이 검사는 실제 화면(CDP)에서 앱의 생성 흐름을 그대로 탄다(이미지 API 만 가짜):
//   1) 이미지컷 3장을 정상 생성한다 (API 3회)
//   2) 새로고침으로 끊긴 것처럼 2·3번 결과와 자산을 지우고 단계를 "3개 중 1개만 생성됨" 으로 둔다
//   3) 패널의 "나머지 2개만 생성" 버튼을 **실제로 누른다**
//   → API 는 정확히 2회만 더 불리고, 자산은 3장, 남아 있던 1장의 id 는 그대로, 셋이 같은 실행으로 함께 보인다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const TEST_BACKEND_URL = process.env.KUASANGSE_BACKEND_BASE || process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'fill-missing-cuts-only-v1.json');

function svgData(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#f8fafc"/><rect x="80" y="80" width="480" height="320" rx="32" fill="${color}"/>
  <text x="320" y="255" text-anchor="middle" font-family="Arial" font-size="40" font-weight="700" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// 앱 코드보다 먼저 심는다: 이미지 API 만 가짜로 응답하고 횟수를 센다.
const INJECT = `(() => {
  if (window.__fillMissingV1) return;
  const state = { imageCalls: 0 };
  window.__fillMissingV1 = state;
  const nativeFetch = window.fetch.bind(window);
  const result = ${JSON.stringify(svgData('generated', '#22c55e'))};
  window.fetch = async (input, init) => {
    const url = String((input && input.url) || input || '');
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'POST' && url.indexOf('/api/gemini/generate-content') !== -1) {
      state.imageCalls += 1;
      const seq = state.imageCalls;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/svg+xml', data: result.slice(result.indexOf(',') + 1) + '' } }] } }],
        usageMetadata: { promptTokenCount: 0, candidatesTokenCount: seq },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return nativeFetch(input, init);
  };
})();`;

const STAGE_SNAPSHOT = `(() => {
  const factory = factoryRuntimeRequireStore().getSnapshot()?.factory || {};
  const stage = factory.stages?.cuts || {};
  const assets = (factory.assets || []).filter(asset => asset?.stageId === 'cuts' && !asset.rejected);
  const panel = document.querySelector('#factoryAutomationAssetChooser_cuts');
  const text = panel?.innerText || '';
  const usable = /선택 가능 이미지\\s*(\\d+)개/.exec(text);
  return {
    status: String(stage.status || ''),
    message: String(stage.message || ''),
    expected: Number(stage.expectedItemCount || 0),
    completed: Number(stage.completedItemCount || 0),
    imageCalls: Number(window.__fillMissingV1?.imageCalls || 0),
    assetIds: assets.map(asset => asset.id),
    assetTitles: assets.map(asset => String(asset.title || '')),
    assetRunIds: assets.map(asset => String(asset.generationRunId || asset.currentRunId || asset.metadata?.generationRunId || '')),
    usableCount: typeof factoryUsableAssetsForStage === 'function' ? factoryUsableAssetsForStage('cuts', factoryRuntimeReadFactory()).length : -1,
    panelUsable: usable ? Number(usable[1]) : -1,
    panelOlderRun: /이전 생성\\s*\\d+개/.test(text),
    panelIncomplete: /생성 미완료/.test(text),
    missingButton: panel?.querySelector('[data-factory-run-only-missing="1"]')?.innerText || '',
    prompts: (state.cuts?.prompts || []).map(p => ({ label: p?.label || '', hasResult: !!p?.result, generating: !!p?.generating, error: p?.error || '' })),
  };
})()`;

async function waitStageSettled(cdp, label) {
  await waitFor(cdp, `(() => {
    const stage = factoryRuntimeRequireStore().getSnapshot()?.factory?.stages?.cuts || {};
    const prompts = state.cuts?.prompts || [];
    return stage.status !== 'running' && stage.status !== 'idle' && !prompts.some(p => p?.generating);
  })()`, 90000).catch(error => { throw new Error(`${label}: 단계가 끝나지 않았습니다 - ${error.message}`); });
  return evaluate(cdp, STAGE_SNAPSHOT);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  const seed = String(Date.now());
  await cdp.send('Page.navigate', { url: `${APP_URL}?fillMissing=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()} && !!window.__fillMissingV1 && typeof factoryHandleRunStageButton === 'function'`, 60000);

  // 생성이 되는 최소 상태 (verify_factory_generation_status_cdp_v119 의 준비 절차를 따른다).
  const inputImage = svgData('input', '#0ea5e9');
  const workspaceId = `fill_missing_ws_${seed}`;
  const seeded = await evaluate(cdp, `(async () => {
    const inputImage = ${JSON.stringify(inputImage)};
    const productName = '부족분만생성_${seed}';
    const workspaceId = ${JSON.stringify(workspaceId)};
    const base64 = inputImage.replace(/^data:image\\/[^;,]+;base64,/i, '');
    const productKey = window.factoryNormalizeIdentityText ? window.factoryNormalizeIdentityText(productName) : productName;
    const fp = window.factoryImagePayloadFingerprint ? window.factoryImagePayloadFingerprint(base64) : 'fill_missing_fp';
    const runId = 'fill_missing_seed_run_${seed}';
    window.hasImageConnection = () => true;
    window.state.backendBaseUrl = ${JSON.stringify(TEST_BACKEND_URL)};
    window.state.modelConfig = { ...(window.state.modelConfig || {}), imageModel: 'gemini-3.1-flash-image' };
    window.state.step = 'factory';
    window.state.currentProjectId = workspaceId;
    window.state.currentProjectName = productName;
    window.state.currentProjectCreatedAt = Date.now();
    window.state.productName = productName;
    window.state.imageBase64 = base64;
    window.state.imageMime = 'image/svg+xml';
    window.state.imagePreview = inputImage;
    window.state.imageName = 'fill-missing-input.svg';
    const factory = window.factoryState();
    if (typeof window.factoryStampWorkspaceIdentity === 'function') {
      window.factoryStampWorkspaceIdentity(factory, { projectId: workspaceId, projectName: productName, createdAt: window.state.currentProjectCreatedAt });
    }
    factory.product = factory.product || {};
    Object.assign(factory.product, {
      productName, userProductName: productName, cafe24ReferenceAutoTried: true,
      currentRunId: runId, generationRunId: runId,
      lockedInputImageFingerprint: fp, inputImageFingerprint: fp,
      imageBase64: base64, imageMime: 'image/svg+xml', imagePreview: inputImage, imageName: 'fill-missing-input.svg',
      inputImages: [{ id: 'fill_missing_input', name: 'fill-missing-input.svg', base64, mime: 'image/svg+xml', preview: inputImage, hasImage: true, inputImageFingerprint: fp, sourceImageKey: fp, productImageKey: fp, productKey, currentRunId: runId }],
    });
    factory.automation = factory.automation || {};
    factory.automation.currentRunId = runId;
    factory.automation.activeTab = 'assets';
    factory.stages = factory.stages || {};
    factory.stages.cuts = { ...(factory.stages.cuts || {}), status: 'idle', message: '', targetCount: 3, selectedAssetIds: [] };
    factory.assets = [];
    factory.previousAssets = [];
    window.state.cuts = window.state.cuts || {};
    window.state.cuts.prompts = [];
    window.state.cuts.sizePrompts = [];
    window.state.cuts.runBusy = false;
    window.state.cuts.sizeRunBusy = false;
    window.state.factory = window.normalizeFactoryState ? window.normalizeFactoryState(factory) : factory;
    const authority = await window.ensureWorkspaceEditAuthority('project:' + workspaceId, { force: true });
    if (authority.mode !== 'editing') throw new Error('편집권 확보 실패: ' + JSON.stringify(authority));
    window.render();
    return { ok: true };
  })()`);

  await waitFor(cdp, `!!document.querySelector('#factoryAutomationAssetChooser_cuts [data-factory-run-stage="cuts"]')`, 15000);

  // 1) 정상 생성 3장
  await evaluate(cdp, `(() => { const panel = document.querySelector('#factoryAutomationAssetChooser_cuts'); panel.scrollIntoView({ block: 'center' }); panel.querySelector('[data-factory-run-stage="cuts"]').click(); return true; })()`);
  await waitFor(cdp, `(factoryRuntimeRequireStore().getSnapshot()?.factory?.stages?.cuts?.status === 'running')`, 15000);
  const full = await waitStageSettled(cdp, '1) 정상 생성');

  // 2) 새로고침으로 끊긴 것처럼: 2·3번 결과·자산을 지우고 단계를 "3개 중 1개만 생성됨" 으로 둔다.
  const cut = await evaluate(cdp, `(async () => {
    const keepTitle = String(state.cuts.prompts[0]?.label || '');
    // 자산과 단계를 함께 바꾸므로 명령 경로 정책 대신 스냅샷 통째 교체(검사 픽스처와 같은 길)를 쓴다.
    const draft = cloneData(factoryRuntimeReadFactory());
    const cutsAssets = (draft.assets || []).filter(asset => asset?.stageId === 'cuts');
    const keep = cutsAssets.find(asset => String(asset.title || '') === keepTitle) || cutsAssets[0];
    draft.assets = (draft.assets || []).filter(asset => asset?.stageId !== 'cuts' || asset === keep);
    draft.stages.cuts = {
      ...(draft.stages.cuts || {}),
      status: 'review',
      message: '3개 중 1개만 생성됨 · 나머지 2개는 만들어지지 않았습니다. 다시 생성해주세요.',
      expectedItemCount: 3,
      completedItemCount: 1,
    };
    factoryRuntimeReplaceFactorySnapshot(draft, { reason: 'fill-missing-test', mode: 'hydrate' });
    state.cuts.prompts.forEach((p, index) => {
      if (!p || String(p.label || '') === keepTitle) return;
      p.result = null; p.staleResult = false; p.staleResultReason = ''; p.generating = false; p.error = '';
      delete p.completedAt; delete p.generationStartedAt;
    });
    window.render();
    await new Promise(resolve => setTimeout(resolve, 500));
    return ${STAGE_SNAPSHOT};
  })()`);

  // 3) "나머지 2개만 생성" 을 실제로 누른다.
  await evaluate(cdp, `(() => {
    const panel = document.querySelector('#factoryAutomationAssetChooser_cuts');
    const button = panel?.querySelector('[data-factory-run-only-missing="1"]');
    if (!button) throw new Error('나머지 N개만 생성 버튼이 없습니다: ' + (panel?.innerText || '').slice(0, 300));
    panel.scrollIntoView({ block: 'center' });
    button.click();
    return true;
  })()`);
  await waitFor(cdp, `(factoryRuntimeRequireStore().getSnapshot()?.factory?.stages?.cuts?.status === 'running')`, 15000);
  const filled = await waitStageSettled(cdp, '3) 부족분 생성');

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ seeded, full, cut, filled }, null, 2), 'utf8');

  const keptId = cut.assetIds[0];
  assertChecks([
    { ok: full.imageCalls === 3 && full.assetIds.length === 3,
      message: `전제 불성립 - 정상 생성이 3장이어야 합니다: ${JSON.stringify(full)}` },
    { ok: cut.assetIds.length === 1 && cut.panelIncomplete && /나머지 2개만 생성/.test(cut.missingButton),
      message: `전제 불성립 - 끊긴 상태가 화면에 "생성 미완료" + "나머지 2개만 생성" 으로 보여야 합니다: ${JSON.stringify(cut)}` },
    { ok: filled.imageCalls - full.imageCalls === 2,
      message: `이미지 API 를 정확히 2번만 더 불러야 합니다(멀쩡한 1장은 다시 만들지 않는다). 실제 ${filled.imageCalls - full.imageCalls}번: ${JSON.stringify(filled)}` },
    { ok: filled.assetIds.length === 3 && filled.assetIds.includes(keptId),
      message: `자산이 3장이고 남아 있던 1장(${keptId})이 그대로여야 합니다: ${JSON.stringify(filled)}` },
    { ok: new Set(filled.assetRunIds).size === 1,
      message: `셋이 같은 실행 번호를 가져야 함께 보입니다(새 번호를 발급하면 1장이 "이전 생성" 으로 밀린다): ${JSON.stringify(filled.assetRunIds)}` },
    { ok: filled.usableCount === 3 && filled.panelUsable === 3 && !filled.panelOlderRun,
      message: `화면에 3장이 함께 보여야 합니다("이전 생성" 없이): ${JSON.stringify(filled)}` },
    { ok: filled.status === 'done' && /3개 후보 표시 완료/.test(filled.message),
      message: `채운 뒤 단계는 "3개 후보 표시 완료 · done" 이어야 합니다: ${JSON.stringify({ status: filled.status, message: filled.message })}` },
  ]);
  console.log(`[PASS] 나머지 2개만 생성 - API ${filled.imageCalls - full.imageCalls}회 추가 · 자산 ${filled.assetIds.length}장 · 남은 1장(${keptId}) 유지 · "${filled.message}" - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
