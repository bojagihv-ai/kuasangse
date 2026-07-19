const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';

async function callInPage(cdp, fn, arg) {
  return evaluate(cdp, `(${fn.toString()})(${JSON.stringify(arg)})`);
}

(async () => {
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = (cdpRuntime.targets || []).find(item => item.type === 'page') || cdpRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const bustUrl = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}verifyBust=${Date.now()}`;
  await cdp.send('Page.navigate', { url: bustUrl });
  await waitFor(cdp, `typeof renderImageCuts === 'function' && typeof factoryClearRestoredImageGenerationRuntime === 'function'`, 30000);

  const result = await callInPage(cdp, async () => {
    if (typeof hydratePersistentSessionAssets === 'function') {
      await hydratePersistentSessionAssets().catch(() => {});
    }
    const factory = factoryState();
    if (!factory.stages || typeof factory.stages !== 'object') factory.stages = {};
    factory.stages.size = {
      ...(factory.stages.size || {}),
      status: 'running',
      message: '기존 사이즈컷 전용 엔진으로 3개 생성 중',
      currentRunId: 'stale_size_run_v89',
      latestGenerationRunId: 'stale_size_run_v89',
      generationRunId: 'stale_size_run_v89',
      runStartedAt: Date.now() - 1000,
      runHeartbeatAt: Date.now() - 1000,
      expectedItemCount: 3,
      completedItemCount: 0,
    };
    state.cuts.sizeRunBusy = false;
    state.cuts.runBusy = false;
    state.cuts.sizePrompts = normalizeCutPrompts(state.cuts.sizePrompts, { count: 3, clearGenerating: true });
    state.cuts.prompts = normalizeCutPrompts(state.cuts.prompts, { count: 4, clearGenerating: true });
    const before = {
      status: factory.stages.size.status,
      message: factory.stages.size.message,
      sizeRunBusy: state.cuts.sizeRunBusy,
      promptGenerating: state.cuts.sizePrompts.filter(item => item?.generating).length,
    };
    const html = renderImageCuts();
    const afterStage = factory.stages.size;
    return {
      before,
      after: {
        status: afterStage.status,
        message: afterStage.message,
        runStartedAt: afterStage.runStartedAt,
        sizeRunBusy: state.cuts.sizeRunBusy,
        runBusy: state.cuts.runBusy,
        promptGenerating: state.cuts.sizePrompts.filter(item => item?.generating).length,
      },
      htmlHasGeneratingCopy: /기존 사이즈컷 전용 엔진으로 3개 생성 중/.test(html),
      htmlHasResetCopy: /생성 중 표시를 정리했습니다/.test(html),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  assertChecks([
    { ok: result.before.status === 'running', message: '검증 전 running 상태를 만들지 못했습니다.' },
    { ok: result.after.status !== 'running', message: `이미지컷 화면에서 stale running 잠금이 풀리지 않았습니다: ${result.after.status}` },
    { ok: result.after.sizeRunBusy === false && result.after.runBusy === false, message: '이미지컷/사이즈컷 busy 플래그가 남았습니다.' },
    { ok: result.after.promptGenerating === 0, message: `생성 중 프롬프트가 남았습니다: ${result.after.promptGenerating}` },
    { ok: !result.htmlHasGeneratingCopy, message: '렌더 HTML에 이전 생성 중 문구가 그대로 남았습니다.' },
  ]);
  cdp.close();
  if (cdpRuntime.cleanup) await cdpRuntime.cleanup();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
