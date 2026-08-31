// 계약(실측): **stages.cuts.targetCount 에 0이 박혀 있어도 이미지컷 실행 수량이 살아난다.**
//
// 주인님 2026-08-31: "이미지컷이 원래없었나? 보통은 처음에 맨처음 생성돌릴떄
//                     이미지컷도 같이 생성하지않어?"
//
// 소스 계약은 tests/frontend/imagecut_zero_ratchet.test.cjs 가 본다. 여기서는 실제 브라우저에
// 앱을 띄우고 그 함수들을 **직접 호출해서** 숫자가 어떻게 나오는지 잰다.
// 고치기 전에는 targetCount=0 이면 cutMax 가 0이 되어 시작탭에 4를 넣어도 실행 수량이 0이었다.
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'imagecut-zero-ratchet-released-v1.json');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.navigate', { url: `${APP_URL}?imagecutRatchet=v1&t=${Date.now()}` });
  await waitFor(cdp, `typeof factoryImageCutPresetListForStage === 'function'
    && typeof factoryAutomationStartRunCountForExecution === 'function'
    && typeof factoryRuntimeReadFactory === 'function'`, 60000);
  await new Promise(resolve => setTimeout(resolve, 800));

  const measured = await evaluate(cdp, `(() => {
    // 시작 실행 전 상태를 흉내낸다: startRunActive 꺼짐, oneClick 한도 없음.
    const probe = (targetCount, startCount) => {
      const factory = JSON.parse(JSON.stringify(factoryRuntimeReadFactory()));
      factory.stages = factory.stages || {};
      factory.stages.cuts = { ...(factory.stages.cuts || {}), targetCount, prompt: '' };
      factory.automation = { ...(factory.automation || {}), startRunActive: false, startRunCounts: { cuts: startCount } };
      const cutMax = factoryImageCutPresetListForStage('cuts', factory).length;
      const requested = factoryAutomationStartRunCountForExecution('cuts', cutMax, cutMax, factory);
      return { targetCount, startCount, cutMax, requested };
    };
    return {
      zeroTargetStart4: probe(0, 4),   // 래칫이 걸렸던 경우
      zeroTargetStart2: probe(0, 2),   // 주인님 화면의 값
      twoTargetStart2:  probe(2, 2),   // 정상
      fourTargetStart0: probe(4, 0),   // 사용자가 이번엔 0을 고른 경우 - 건너뛰어야 정상
    };
  })()`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify(measured, null, 2), 'utf8');
  const { zeroTargetStart4, zeroTargetStart2, twoTargetStart2, fourTargetStart0 } = measured;

  const checks = [
    { ok: zeroTargetStart4.requested > 0,
      message: `targetCount=0 인 작업에서 시작탭 4를 넣어도 실행 수량이 0입니다(래칫 그대로): ${JSON.stringify(zeroTargetStart4)}` },
    { ok: zeroTargetStart4.requested === 4,
      message: `시작탭에 넣은 4가 그대로 실행되지 않습니다: ${JSON.stringify(zeroTargetStart4)}` },
    { ok: zeroTargetStart2.requested === 2,
      message: `targetCount=0 · 시작탭 2 인데 실행 수량이 2가 아닙니다: ${JSON.stringify(zeroTargetStart2)}` },
    { ok: twoTargetStart2.requested === 2,
      message: `정상 경우가 깨졌습니다: ${JSON.stringify(twoTargetStart2)}` },
    // 래칫을 푼다고 "0을 골라도 생성된다" 가 되면 그건 다른 사고다.
    { ok: fourTargetStart0.requested === 0,
      message: `사용자가 이번 실행 수량으로 0을 골랐는데 생성하려 합니다: ${JSON.stringify(fourTargetStart0)}` },
  ];
  assertChecks(checks);
  console.log(`[PASS] targetCount=0 이어도 시작탭 값이 살아난다 (4->${zeroTargetStart4.requested}, 2->${zeroTargetStart2.requested}), 0 선택은 여전히 건너뜀 - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
