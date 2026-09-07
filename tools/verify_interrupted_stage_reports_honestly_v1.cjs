// 계약: **끊긴 생성은 화면에 "N개 중 M개만 생성됨" 으로 뜬다 - "완료" 가 아니라.**
//
// 실측 2026-09-06: 사이즈컷 3장 생성 중 번들이 바뀌어 새로고침 → 1장만 남았는데
// 색상 검수가 끝나며 단계가 "1개 후보 표시 완료 · 완료" 로 굳었다. 사장님은 "3컷 생성 안 된 거니?
// 하나만 뜨네" 라고 물어야 했다. 화면이 먼저 말했어야 한다.
//
// 이 검사는 실제 화면(CDP)에서 세 경우를 본다.
//   (1) 새로고침으로 끊긴 실행: stage 'running' · 기대 3 · 남은 그림 1 · 이 화면에 실행 없음
//       → 검수 완료 경로가 'review' + "3개 중 1개만 생성됨" 으로 적고, 그 문장이 화면에 보인다.
//   (2) 다 만든 실행: 기대 3 · 그림 3 → 예전처럼 'done' "3개 후보 표시 완료".
//   (3) 이 화면에서 아직 도는 실행(단계 실행 키 있음): 검수 완료 경로가 상태를 건드리지 않는다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'interrupted-stage-reports-honestly-v1.json');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function runCase(cdp, { key, productName, runId, fingerprint, assetCount, expected, keepRunAlive }) {
  return evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
    setAppState({ step: 'factory', productName: ${JSON.stringify(productName)} });
    const factory = cloneFactory(readFactory());
    const workspaceId = getCurrentLastWorkWorkspaceScope?.() || '';
    factory.automation = { ...(factory.automation || {}), activeTab: 'assets' };
    factory.product = {
      ...factory.product,
      productName: ${JSON.stringify(productName)},
      userProductName: ${JSON.stringify(productName)},
      productKey: ${JSON.stringify(productName)},
      productIdentityKey: ${JSON.stringify(productName)},
      currentRunId: ${JSON.stringify(runId)},
      generationRunId: ${JSON.stringify(runId)},
      inputImageFingerprint: ${JSON.stringify(fingerprint)},
      lockedInputImageFingerprint: ${JSON.stringify(fingerprint)},
    };
    factory.stages = {
      ...(factory.stages || {}),
      size: {
        ...((factory.stages || {}).size || {}),
        status: 'running',
        message: '사이즈컷 2/3 생성 중 · 사이즈컷 2 응답 대기',
        targetCount: ${expected},
        expectedItemCount: ${expected},
        completedItemCount: ${assetCount},
        currentRunId: ${JSON.stringify(runId)},
        latestGenerationRunId: ${JSON.stringify(runId)},
        generationRunId: ${JSON.stringify(runId)},
      },
    };
    factory.archive = { ...(factory.archive || {}), stageRunIds: { size: ${JSON.stringify(runId)} } };
    factory.assets = Array.from({ length: ${assetCount} }, (_, index) => ({
      id: 'honest_size_' + ${JSON.stringify(key)} + '_' + index,
      stageId: 'size',
      title: '사이즈 안내컷 ' + (index + 1),
      hasImage: true, used: false, rejected: false,
      image: 'data:image/png;base64,' + ${JSON.stringify(PNG)},
      imageUrl: 'data:image/png;base64,' + ${JSON.stringify(PNG)},
      workspaceId,
      productKey: ${JSON.stringify(productName)},
      inputImageFingerprint: ${JSON.stringify(fingerprint)},
      currentRunId: ${JSON.stringify(runId)},
      generationRunId: ${JSON.stringify(runId)},
      metadata: {
        workspaceId,
        productKey: ${JSON.stringify(productName)},
        productIdentityKey: ${JSON.stringify(productName)},
        productName: ${JSON.stringify(productName)},
        inputImageFingerprint: ${JSON.stringify(fingerprint)},
        currentRunId: ${JSON.stringify(runId)},
        generationRunId: ${JSON.stringify(runId)},
        stageId: 'size',
      },
    }));
    replaceFactory(factory, { mode: 'hydrate' });

    // (3) 이 화면에서 도는 실행을 흉내 낸다 - 전체 생성 루프가 켜 두는 단계 실행 키.
    if (${keepRunAlive ? 'true' : 'false'}) factoryMarkImageStageRunActive('size', ${JSON.stringify(runId)});
    let refreshError = '';
    try {
      // 색상 검수가 끝날 때 도는 바로 그 경로. 소유 draft 안에서 부른다.
      factoryRuntimeUpdateOwnedFactory('factory/runtime:setStageStatus', 'factory-assets', draft => {
        factoryRefreshStageAfterVisualValidation('size', draft);
        return true;
      });
    } catch (error) {
      refreshError = String(error?.message || error);
    } finally {
      if (${keepRunAlive ? 'true' : 'false'}) factoryMarkImageStageRunInactive('size', ${JSON.stringify(runId)});
    }
    renderApp();
    await new Promise(resolve => setTimeout(resolve, 400));

    const live = readFactory();
    const stage = live.stages?.size || {};
    const text = document.body.innerText || '';
    return {
      refreshError,
      status: String(stage.status || ''),
      message: String(stage.message || ''),
      usableCount: typeof factoryUsableAssetsForStage === 'function' ? factoryUsableAssetsForStage('size', live).length : -1,
      messageOnScreen: !!stage.message && text.includes(String(stage.message)),
      busyProbe: typeof window.kuasangseImageGenerationBusy === 'function' ? window.kuasangseImageGenerationBusy() : null,
    };
  }`);
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1365, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  const seed = String(Date.now());
  await cdp.send('Page.navigate', { url: `${APP_URL}?honestStage=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof factoryRefreshStageAfterVisualValidation === 'function'
    && typeof factoryMarkImageStageRunActive === 'function'`, 60000);

  const results = {};
  const cases = [
    { key: 'cut', label: '새로고침으로 끊긴 실행(기대 3 · 그림 1)', assetCount: 1, expected: 3, keepRunAlive: false },
    { key: 'full', label: '다 만든 실행(기대 3 · 그림 3)', assetCount: 3, expected: 3, keepRunAlive: false },
    { key: 'alive', label: '이 화면에서 아직 도는 실행(기대 3 · 그림 1)', assetCount: 1, expected: 3, keepRunAlive: true },
  ];
  for (const testCase of cases) {
    results[testCase.key] = {
      label: testCase.label,
      ...(await runCase(cdp, {
        ...testCase,
        productName: `솔직표시_${testCase.key}_${seed}`,
        runId: `factory_work_run_${seed}_${testCase.key}`,
        fingerprint: `4595956:${seed}_${testCase.key}`,
      })),
    };
  }
  fs.writeFileSync(RESULT_PATH, JSON.stringify(results, null, 2), 'utf8');

  const cut = results.cut;
  const full = results.full;
  const alive = results.alive;
  assertChecks([
    { ok: !cut.refreshError && !full.refreshError && !alive.refreshError,
      message: `검수 완료 경로가 오류를 냈습니다: ${JSON.stringify({ cut: cut.refreshError, full: full.refreshError, alive: alive.refreshError })}` },
    { ok: cut.usableCount === 1, message: `끊긴 실행: 남은 그림 1장이 보여야 하는데 ${cut.usableCount}장입니다: ${JSON.stringify(cut)}` },
    { ok: cut.status === 'review', message: `끊긴 실행: 상태가 'review' 여야 하는데 '${cut.status}' 입니다. '완료' 로 굳히면 빠진 2장이 숨습니다: ${JSON.stringify(cut)}` },
    { ok: /3개 중 1개만 생성됨/.test(cut.message) && /나머지 2개/.test(cut.message),
      message: `끊긴 실행: 문구가 "3개 중 1개만 생성됨 · 나머지 2개..." 여야 합니다: ${JSON.stringify(cut)}` },
    { ok: cut.messageOnScreen === true, message: `끊긴 실행: 그 문장이 실제 화면에 보이지 않습니다: ${JSON.stringify(cut)}` },
    { ok: full.status === 'done' && full.message === '3개 후보 표시 완료',
      message: `다 만든 실행은 예전처럼 완료여야 합니다: ${JSON.stringify(full)}` },
    { ok: alive.status === 'running', message: `이 화면에서 도는 실행은 검수 완료가 상태를 건드리면 안 됩니다(루프가 정한다): ${JSON.stringify(alive)}` },
    { ok: cut.busyProbe === false && alive.busyProbe === false,
      message: `실행 키를 되돌린 뒤에는 로더용 바쁨 판정이 false 여야 합니다: ${JSON.stringify({ cut: cut.busyProbe, alive: alive.busyProbe })}` },
  ]);
  console.log(`[PASS] 끊긴 생성이 화면에 솔직하게 뜸 - 끊김 "${cut.message}" · 완성 "${full.message}" · 진행 중 '${alive.status}' 유지 - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
