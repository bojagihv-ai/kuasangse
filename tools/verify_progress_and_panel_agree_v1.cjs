// 계약: **진행률이 "완료" 라고 세는 개수와, 화면이 실제로 보여 주는 개수가 같다.**
//
// 주인님 2026-09-06:
//   "제일 열받는부분은 위에는 대표이미지3건이라고 꽉차있고 실제론 안뜨는거"
//
// 왜 갈렸나 (실측 2026-09-06): 같은 규칙이 **세 군데에 제각각** 박혀 있었다.
//   (1) 화면 후보 필터        - app-core-05.js 의 scopeOptions
//   (2) factoryAssetHasCurrentProductPayload 안의 하드코딩
//   (3) factoryUsableAssetsForStage 의 baseOptions  <- 진행률이 세는 잣대
// (1)만 고쳤을 때 화면은 "격리 0개" 가 됐는데도 "선택 가능 0개" 였다.
// 잣대가 다르면 숫자와 화면이 서로 다른 말을 한다 - 그게 사장님을 제일 열받게 한 것이다.
//
// 그래서 기준을 한 곳(factoryWorkfileAssetScopeOptions)에 모았다.
// 이 검사는 그 둘이 **같은 수를 말하는지** 본다. 숫자만 보는 것이 아니라
// 화면에 실제로 그려진 카드 수까지 함께 본다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'progress-and-panel-agree-v1.json');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// 실행 번호가 어긋난 경우와 맞는 경우를 **둘 다** 본다.
// 어긋났을 때만 보는 검사는 "둘 다 0" 이어도 통과해 버린다.
const CASES = [
  { key: 'drift', label: '실행 번호가 어긋난 그림', sameRun: false },
  { key: 'same', label: '실행 번호가 같은 그림', sameRun: true },
];

async function measure(cdp, { productName, workRunId, assetRunId, fingerprint }) {
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
      currentRunId: ${JSON.stringify(workRunId)},
      generationRunId: ${JSON.stringify(workRunId)},
      inputImageFingerprint: ${JSON.stringify(fingerprint)},
      lockedInputImageFingerprint: ${JSON.stringify(fingerprint)},
    };
    factory.stages = {
      ...(factory.stages || {}),
      hero: { ...((factory.stages || {}).hero || {}), currentRunId: ${JSON.stringify(workRunId)}, latestGenerationRunId: ${JSON.stringify(workRunId)} },
    };
    factory.archive = { ...(factory.archive || {}), stageRunIds: { hero: ${JSON.stringify(workRunId)} } };
    factory.assets = [0, 1, 2].map(index => ({
      id: 'agree_hero_' + index,
      stageId: 'hero',
      title: '대표이미지 ' + (index + 1),
      hasImage: true, used: false, rejected: false,
      image: 'data:image/png;base64,' + ${JSON.stringify(PNG)},
      imageUrl: 'data:image/png;base64,' + ${JSON.stringify(PNG)},
      workspaceId,
      productKey: ${JSON.stringify(productName)},
      inputImageFingerprint: ${JSON.stringify(fingerprint)},
      currentRunId: ${JSON.stringify(assetRunId)},
      generationRunId: ${JSON.stringify(assetRunId)},
      metadata: {
        workspaceId,
        productKey: ${JSON.stringify(productName)},
        productIdentityKey: ${JSON.stringify(productName)},
        productName: ${JSON.stringify(productName)},
        inputImageFingerprint: ${JSON.stringify(fingerprint)},
        currentRunId: ${JSON.stringify(assetRunId)},
        generationRunId: ${JSON.stringify(assetRunId)},
        stageId: 'hero',
      },
    }));
    replaceFactory(factory, { mode: 'hydrate' });
    renderApp();
    await new Promise(resolve => setTimeout(resolve, 400));

    const live = readFactory();
    // (가) 진행률이 세는 수 - 이 함수가 "N개 후보 표시 완료" 를 만든다.
    const progressCount = typeof factoryUsableAssetsForStage === 'function'
      ? factoryUsableAssetsForStage('hero', live).length : -1;
    // (나) 화면이 말하는 수
    const text = document.body.innerText || '';
    const usable = /선택 가능 이미지\\s*(\\d+)개/.exec(text);
    const isolated = /이전 제품 격리\\s*(\\d+)개/.exec(text);
    return {
      progressCount,
      panelCount: usable ? Number(usable[1]) : -1,
      isolatedCount: isolated ? Number(isolated[1]) : 0,
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
  await cdp.send('Page.navigate', { url: `${APP_URL}?progressAgree=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof factoryUsableAssetsForStage === 'function'`, 60000);

  const results = {};
  for (const testCase of CASES) {
    const workRunId = `factory_work_run_${seed}_${testCase.key}`;
    results[testCase.key] = {
      label: testCase.label,
      ...(await measure(cdp, {
        productName: `잣대일치_${testCase.key}_${seed}`,
        workRunId,
        assetRunId: testCase.sameRun ? workRunId : `factory_hero_run_${seed}_${testCase.key}`,
        fingerprint: `4595956:${seed}_${testCase.key}`,
      })),
    };
  }

  fs.writeFileSync(RESULT_PATH, JSON.stringify(results, null, 2), 'utf8');

  const checks = [];
  for (const testCase of CASES) {
    const found = results[testCase.key];
    checks.push(
      { ok: found.progressCount === found.panelCount,
        message: `${testCase.label}: 진행률은 ${found.progressCount}개라 하고 화면은 ${found.panelCount}개입니다.`
          + ' 숫자와 화면이 다른 말을 하면 사장님은 "완료" 를 믿고 넘어갔다가 빈 화면을 봅니다:'
          + ` ${JSON.stringify(found)}` },
      { ok: found.panelCount === 3,
        message: `${testCase.label}: 같은 작업파일의 그림 3장이 보여야 하는데 ${found.panelCount}개입니다: ${JSON.stringify(found)}` },
      { ok: found.isolatedCount === 0,
        message: `${testCase.label}: 같은 작업파일인데 ${found.isolatedCount}장을 격리했습니다: ${JSON.stringify(found)}` },
    );
  }
  assertChecks(checks);
  console.log(`[PASS] 진행률과 화면이 같은 수를 말함 - ${CASES.map(c => `${c.label} ${results[c.key].progressCount}/${results[c.key].panelCount}`).join(' · ')}`
    + ` - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
