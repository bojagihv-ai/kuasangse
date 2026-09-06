// 계약: **같은 작업파일에서 만든 그림은 실행 번호가 달라져도 화면에서 사라지지 않는다.**
//
// 주인님 2026-09-06:
//   "대표이미지랑 이미지컷 3컷씩 생성한거아니야? 이것도 제대로 안뜨네.
//    제일 열받는부분은 위에는 대표이미지3건이라고 꽉차있고 실제론 안뜨는거"
//   "이것좀 안정적으로 뜨게할수없을까? 왜이렇게 주기적으로 망가지는지 모르겠어"
//   "뭔가 기준이 있으면 좋을것같은데 ... kuasangse 작업파일명을 기준으로 한다던가"
//
// 사장님 실제 저장본에서 확인한 값 (2026-09-06, pdp-draft-recovery):
//   자산 3장          workspaceId=draft:lastwork_mtprswcm_bz39o3
//                     productKey=팔각자개상자
//                     inputImageFingerprint=4595956:/9j/...
//                     stageId=hero
//                     currentRunId=factory_hero_run_mtpsaxux_e0y24w   <- 이것만 다름
//   제품/단계          currentRunId=factory_work_run_mtprunxk_tjmsj2
//   자산의 isolatedAt  None (격리 표시 없음 - 데이터는 멀쩡했다)
//
// 즉 작업파일·제품·입력사진·단계가 **전부 같은데** 실행 번호 하나 때문에
// 방금 만든 그림 3장이 "이전 제품 격리" 로 숨겨졌다.
// 그러면서 진행률은 "3/3 · 대표이미지 생성 완료 · 100%" 라고 말했다.
//
// 실행 번호가 갈리는 이유는 app-core-06.js:7727-7731 이
// stage.currentRunId 가 **이미 있으면 그걸 쓰고** 없을 때만 새로 만들기 때문이다.
// 누가 먼저 쓰느냐에 따라 값이 갈리니 "주기적으로" 망가진다.
//
// 기준은 사장님 말씀대로 **작업파일**로 잡는다:
//   작업파일(workspaceId) + 제품(productKey) + 입력사진(inputImageFingerprint) + 단계(stageId)
// 이 넷이 같으면 같은 작업의 그림이다. 제품이나 사진을 바꾸면 여전히 격리된다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'generated-images-survive-run-id-drift-v1.json');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

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
  const productName = `실행번호흔들림_${seed}`;
  const workRunId = `factory_work_run_${seed}`;
  const stageRunId = `factory_hero_run_${seed}`;   // 그림에 찍힌 번호. 작업 번호와 다르다.
  const fingerprint = `4595956:${seed}`;

  await cdp.send('Page.navigate', { url: `${APP_URL}?runIdDrift=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()}
    && typeof factoryRuntimeUpdateOwnedFactory === 'function'`, 60000);

  const seeded = await evaluateFactoryCdpFixture(cdp, `async ({ readFactory, cloneFactory, replaceFactory, renderApp, setAppState }) => {
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
    // 사장님 데이터와 같은 모양: 단계 기록은 **작업 번호**로 덮여 있다.
    factory.stages = {
      ...(factory.stages || {}),
      hero: { ...((factory.stages || {}).hero || {}), currentRunId: ${JSON.stringify(workRunId)}, latestGenerationRunId: ${JSON.stringify(workRunId)} },
    };
    factory.archive = { ...(factory.archive || {}), stageRunIds: { hero: ${JSON.stringify(workRunId)} } };

    // 그림 3장에는 **단계 실행 번호**가 찍혀 있다. 나머지는 전부 일치.
    factory.assets = [0, 1, 2].map(index => ({
      id: 'drift_hero_' + index,
      stageId: 'hero',
      title: '대표이미지 ' + (index + 1),
      hasImage: true,
      used: false,
      rejected: false,
      image: 'data:image/png;base64,' + ${JSON.stringify(PNG)},
      imageUrl: 'data:image/png;base64,' + ${JSON.stringify(PNG)},
      workspaceId,
      productKey: ${JSON.stringify(productName)},
      inputImageFingerprint: ${JSON.stringify(fingerprint)},
      currentRunId: ${JSON.stringify(stageRunId)},
      generationRunId: ${JSON.stringify(stageRunId)},
      metadata: {
        workspaceId,
        productKey: ${JSON.stringify(productName)},
        productIdentityKey: ${JSON.stringify(productName)},
        productName: ${JSON.stringify(productName)},
        inputImageFingerprint: ${JSON.stringify(fingerprint)},
        currentRunId: ${JSON.stringify(stageRunId)},
        generationRunId: ${JSON.stringify(stageRunId)},
        stageId: 'hero',
      },
    }));
    replaceFactory(factory, { mode: 'hydrate' });
    renderApp();
    const live = readFactory();
    return {
      workspaceId,
      assetCount: (live.assets || []).filter(a => a.stageId === 'hero').length,
      productRunId: live.product?.currentRunId || '',
      stageRunId: live.stages?.hero?.currentRunId || '',
    };
  }`);

  await new Promise(resolve => setTimeout(resolve, 1200));

  const shown = await evaluateFactoryCdpFixture(cdp, `async () => {
    const text = document.body.innerText || '';
    const isolated = /이전 제품 격리\\s*(\\d+)개/.exec(text);
    const usable = /선택 가능 이미지\\s*(\\d+)개/.exec(text);
    return {
      isolatedCount: isolated ? Number(isolated[1]) : 0,
      usableCount: usable ? Number(usable[1]) : -1,
      sawIsolationNote: /이전 제품\\/이전 입력 이미지로 만든 기록/.test(text),
      heroCardCount: document.querySelectorAll('[data-factory-asset-id^="drift_hero_"]').length,
    };
  }`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ productName, workRunId, stageRunId, seeded, shown }, null, 2), 'utf8');

  const checks = [
    { ok: seeded.assetCount === 3,
      message: `전제 불성립 - 그림 3장이 안 들어갔습니다: ${JSON.stringify(seeded)}` },
    { ok: seeded.productRunId !== '' && seeded.stageRunId !== '',
      message: `전제 불성립 - 실행 번호가 안 심어졌습니다: ${JSON.stringify(seeded)}` },

    // ── 여기가 계약이다 ─────────────────────────────────────────────
    // 작업파일·제품·입력사진·단계가 전부 같다. 실행 번호만 다르다.
    // 그것만으로 방금 만든 그림을 숨기면 안 된다.
    { ok: shown.isolatedCount === 0,
      message: `작업파일이 같은데도 그림 ${shown.isolatedCount}장을 "이전 제품" 으로 격리했습니다.`
        + ` 실행 번호만 다릅니다(작업 ${workRunId} vs 그림 ${stageRunId}).`
        + ` 진행률은 완료라고 하면서 화면은 비어 있게 됩니다: ${JSON.stringify(shown)}` },
    { ok: shown.sawIsolationNote === false,
      message: `"이전 제품/이전 입력 이미지로 만든 기록" 안내가 떴습니다 - 같은 작업파일의 그림입니다: ${JSON.stringify(shown)}` },
    { ok: shown.usableCount === 3,
      message: `선택 가능 이미지가 ${shown.usableCount}개입니다. 3장이어야 합니다: ${JSON.stringify(shown)}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] 실행 번호가 달라도(작업 ${workRunId} · 그림 ${stageRunId})`
    + ` 같은 작업파일의 그림 ${shown.usableCount}장이 화면에 남음 - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
