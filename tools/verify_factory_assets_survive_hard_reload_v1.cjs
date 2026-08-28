// 절대 원칙 검증: Ctrl+F5(강제 새로고침)를 눌러도 작업 중인 생성물이 날아가면 안 된다.
//
// docs/VERIFICATION_INVARIANTS.md: "새 작업, 명시적 초기화, 삭제, 교체를 사용자가 실행한
// 경우에만 해당 범위를 비운다. Ctrl+F5·재연결·코드 수정은 기존 자료를 비우는 동작이 아니다."
//
// 기존 SAVE-04 는 옵션 분류기 이미지만 확인했고, 조립공장 생성물(factory.assets)은
// 아무도 보지 않았다. 2026-08-28 강제 새로고침 한 번에 대표이미지·이미지컷·VM 후보가
// 전부 0이 된 사고가 그 구멍에서 나왔다.
//
// 이 검증은 생성물을 심어 저장한 뒤 캐시를 무시하고 다시 읽어, 단계별 자산 수와
// 입력 이미지 지문이 그대로인지 본다. 지문이 흔들리면 factoryStampLockedInputImage 가
// "기본 이미지가 바뀌었다"고 보고 생성물을 previousAssets 로 밀어내기 때문이다.
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
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');

const STAGES = ['hero', 'size', 'cuts', 'options', 'detail'];

function pngDataUrl(seed) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#123"/><text x="120" y="98" fill="#fff" font-size="28" text-anchor="middle">${seed}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function readState(cdp) {
  return evaluate(cdp, `(() => {
    const f = factoryRuntimeReadFactory() || {};
    const assets = Array.isArray(f.assets) ? f.assets : [];
    const byStage = {};
    for (const a of assets) {
      const s = String(a && a.stageId || 'unknown');
      byStage[s] = (byStage[s] || 0) + 1;
    }
    return {
      total: assets.length,
      byStage,
      previousAssets: Array.isArray(f.previousAssets) ? f.previousAssets.length : 0,
      lockedFingerprint: String(f.product && f.product.lockedInputImageFingerprint || ''),
      currentFingerprint: typeof factoryCurrentInputImageFingerprint === 'function'
        ? String(factoryCurrentInputImageFingerprint(f) || '') : '',
      productName: String(f.product && (f.product.userProductName || f.product.productName) || ''),
      scope: typeof getCurrentLastWorkWorkspaceScope === 'function' ? getCurrentLastWorkWorkspaceScope() : '',
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cdpRuntime = await ensureCdp(CDP_URL);
  const target = cdpRuntime.targets.find(t => t.type === 'page') || cdpRuntime.targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('gemini_backend_url', ${JSON.stringify(BACKEND_BASE)}); } catch (_) {}`,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);
  await evaluate(cdp, `(async () => { await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__); return true; })()`);
  await waitFor(cdp, `(() => typeof classicRuntimeInitialRenderComplete !== 'undefined' && classicRuntimeInitialRenderComplete === true)()`, 60000);

  const seed = Date.now().toString(36);
  const inputImage = pngDataUrl(`input-${seed}`);
  const assets = STAGES.flatMap((stageId, si) => (
    Array.from({ length: 2 }, (_, i) => ({
      id: `asset_${stageId}_${i}_${seed}`,
      stageId,
      used: true,
      image: pngDataUrl(`${stageId}-${i}`),
      createdAt: Date.now() - (si * 1000) - i,
      metadata: { createdAt: Date.now() - (si * 1000) - i },
    }))
  ));

  // 생성물을 심고 입력 이미지를 잠근 뒤 저장까지 끝낸다.
  const seeded = await evaluate(cdp, `(async () => {
    const payloadBase64 = ${JSON.stringify(inputImage)}.split(',')[1];
    // 명령 정책상 자산은 factory-assets, 제품 정보는 factory 소유로 나눠 쓴다.
    await Promise.resolve(factoryRuntimeUpdateOwnedFactory('factory/runtime:updateFromInputs', 'factory', draft => {
      draft.product = draft.product || {};
      draft.product.productName = '새로고침보존검증';
      draft.product.userProductName = '새로고침보존검증';
      draft.product.imageBase64 = payloadBase64;
      draft.product.imageMime = 'image/svg+xml';
      draft.product.imagePreview = ${JSON.stringify(inputImage)};
      draft.product.imageName = '검증입력';
      // factoryStampLockedInputImage 는 automation.currentRunId 까지 써서 이 명령의
      // 허용 경로를 벗어난다. 검증에 필요한 것은 지문이므로 같은 계산식으로 직접 넣는다.
      const fp = typeof factoryImagePayloadFingerprint === 'function'
        ? factoryImagePayloadFingerprint(payloadBase64) : '';
      draft.product.lockedInputImageFingerprint = fp;
      draft.product.inputImageFingerprint = fp;
      draft.product.lockedInputImageMime = 'image/svg+xml';
      draft.product.lockedInputImageName = '검증입력';
      draft.product.lockedInputImageSetAt = Date.now();
      draft.product.inputImages = [{ id: 'input_' + ${JSON.stringify(seed)}, name: '검증입력',
        base64: payloadBase64, mime: 'image/svg+xml', preview: ${JSON.stringify(inputImage)},
        hasImage: true, inputImageFingerprint: fp }];
      return true;
    }));
    await Promise.resolve(factoryRuntimeUpdateOwnedFactory('factory/runtime:registerAsset', 'factory-assets', draft => {
      draft.assets = ${JSON.stringify(assets)};
      return true;
    }));
    await saveLastWorkNow({ sync: true });
    await new Promise(r => setTimeout(r, 900));
    return true;
  })()`, true, 120000);
  if (seeded !== true) throw new Error('asset seeding failed');

  const before = await readState(cdp);

  // Ctrl+F5 와 같은 캐시 무시 재적재.
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(cdp, '!!(window.state && window.render && window.factoryState)', 60000);
  await evaluate(cdp, `(async () => { await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__); return true; })()`);
  await waitFor(cdp, `(() => typeof classicRuntimeInitialRenderComplete !== 'undefined' && classicRuntimeInitialRenderComplete === true)()`, 60000);
  await evaluate(cdp, `(async () => { await new Promise(r => setTimeout(r, 1500)); return true; })()`);

  const after = await readState(cdp);

  const missingStages = STAGES.filter(stageId => (after.byStage[stageId] || 0) < (before.byStage[stageId] || 0));
  const evidence = { seed, before, after, missingStages };
  fs.writeFileSync(path.join(OUT_DIR, 'factory-assets-survive-hard-reload-v1.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));

  assertChecks([
    { ok: before.total > 0, message: `검증 준비 실패: 심은 자산이 없습니다 ${JSON.stringify(before)}` },
    {
      ok: after.total >= before.total,
      message: `강제 새로고침이 조립공장 생성물을 잃었습니다: ${before.total}개 -> ${after.total}개`,
    },
    {
      ok: missingStages.length === 0,
      message: `강제 새로고침 후 단계별 생성물이 줄었습니다: ${missingStages.join(', ')} (${JSON.stringify(before.byStage)} -> ${JSON.stringify(after.byStage)})`,
    },
    {
      ok: after.previousAssets <= before.previousAssets,
      message: `강제 새로고침이 생성물을 previousAssets 로 밀어냈습니다: ${before.previousAssets} -> ${after.previousAssets}`,
    },
    {
      ok: !!after.lockedFingerprint && after.lockedFingerprint === before.lockedFingerprint,
      message: `강제 새로고침 후 입력 이미지 지문이 바뀌었습니다. 이 값이 흔들리면 생성물이 '기본 이미지가 바뀌었다'로 분리됩니다: ${before.lockedFingerprint} -> ${after.lockedFingerprint}`,
    },
  ]);
  await cdpRuntime.cleanup?.();
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
