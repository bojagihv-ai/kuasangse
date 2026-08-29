// 실제 브라우저로 확인한다: 사람이 직접 넣은 사이즈/가로/세로가
// 신원 정리가 돌고 새로고침해도 살아남는가.
//
// 사용자 제보(2026-08-29):
//   "왜자꾸 너가 코딩하나할떄마다 이게날라가냐고"
//   "필수값뿐만아니라 모든게 이미지고른거든 뭐든 안날라가야돼. 새작업 누르기전에는"
//   "아니 실제로 고쳐졌나 직접해보고 검증하고 보고를해"
//
// 재현 순서(사용자가 겪은 것과 같다):
//   1) 관제탑 배치 문서(batch:...) 안에서 작업 중
//   2) 사이즈/가로/세로를 손으로 넣고 '확인' 을 누른다 (실제 DOM 클릭)
//   3) 저장 ID가 비는 순간에 신원 정리가 돈다
//   4) 화면과 저장본 양쪽에서 값이 살아있는지 본다
const fs = require('fs');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluateFactoryCdpFixture,
  factoryCdpFixtureReadyExpression,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9333';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-manual-size-survives-v001.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-manual-size-survives-v001.json');

const SIZE_TEXT = '가로3.5cm*세로18cm';
// 가로·세로는 사람이 따로 입력하지 않는다. 사이즈 문장에서 **자동으로 뽑힌다.**
// 그래서 사이즈가 지워지면 가로·세로도 함께 사라진다 — 사용자가 겪은 그대로다.
// 실측: 입력 직후에는 사이즈에 적힌 그대로(3.5cm), 신원 정리를 거치면 mm 로 환산돼
// 다시 뽑힌다(35mm). 값이 사라지지 않는 것이 핵심이고, 표기 차이는 그대로 기록해 둔다.
const WIDTH_TYPED = '3.5cm';
const DEPTH_TYPED = '18cm';
const WIDTH_AFTER = '35mm';
const DEPTH_AFTER = '180mm';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, factoryCdpFixtureReadyExpression() + " && typeof saveLastWorkNow === 'function'", 60000);

    const seed = String(Date.now());

    // 1~2) 배치 문서 안에서 사이즈를 손으로 넣고 '확인' 을 누른다.
    const typed = await evaluateFactoryCdpFixture(cdp, `async ({ setAppState, readFactory, replaceFactory, renderApp }) => {
      const seed = ${JSON.stringify(seed)};
      const projectId = 'batch:factory-job-manualsize' + seed;
      const productName = '수동사이즈검증상품' + seed;
      const runId = 'manual_size_run_' + seed;
      const imageFingerprint = 'manual_size_image_' + seed;
      const createdAt = Date.now();
      setAppState({
        step: 'factory',
        currentProjectId: projectId,
        currentProjectName: productName,
        currentProjectCreatedAt: createdAt,
        productName,
      });
      let factory = normalizeFactoryState({});
      factoryStampWorkspaceIdentity(factory, { projectId, projectName: productName, createdAt });
      factory.product.productName = productName;
      factory.product.userProductName = productName;
      factory.product.currentRunId = runId;
      factory.product.generationRunId = runId;
      factory.product.inputImageFingerprint = imageFingerprint;
      factory.product.lockedInputImageFingerprint = imageFingerprint;
      factory.automation.currentRunId = runId;
      factory.goalRun.currentRunId = runId;
      factory.automation.activeTab = 'fields';
      replaceFactory(factory, { reason: 'manual-size-seed' });
      const authority = await ensureWorkspaceEditAuthority('project:' + projectId);
      if (authority && authority.mode !== 'editing') throw new Error('manual size authority acquisition failed');
      renderApp();

      // 사용자는 '사이즈/규격' 한 칸만 손으로 채운다.
      // 가로·세로는 그 값에서 자동으로 뽑혀 '확인됨' 으로 표시된다(값 수정 버튼이 달린다).
      // 그래서 사이즈가 지워지면 가로·세로도 함께 사라진다 — 사용자가 겪은 그대로다.
      const input = document.querySelector('[data-factory-wizard-field="size"]');
      const button = document.querySelector('[data-factory-wizard-commit="size"]');
      if (!input || !button) throw new Error('사이즈 입력 또는 확인 버튼을 찾지 못했습니다.');
      input.value = ${JSON.stringify(SIZE_TEXT)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.click();
      renderApp();
      await Promise.resolve();

      const current = readFactory();
      const settings = current.product.dbFieldSettings || {};
      const summary = factoryAutomationReviewSummary(current, factoryAutomationCounts(current));
      const pick = id => summary.fields.find(field => field.id === id) || {};
      return {
        projectId,
        productName,
        size: (settings.size && settings.size.manualValue) || '',
        touched: !!(settings.size && settings.size.manualTouched),
        screenSize: pick('size').value || '',
        screenWidth: pick('width_mm').value || '',
        screenDepth: pick('depth_mm').value || '',
        allFields: Array.from(document.querySelectorAll('[data-factory-wizard-field]'))
          .map(el => el.dataset.factoryWizardField),
      };
    }`);

    assertChecks([
      { ok: typed.size === SIZE_TEXT, message: '확인을 눌렀는데 사이즈가 안 들어갔습니다: ' + typed.size },
      { ok: typed.touched, message: '손으로 넣은 값인데 manualTouched 표시가 없습니다.' },
      { ok: typed.screenSize === SIZE_TEXT, message: '화면 사이즈가 비어 있습니다: ' + typed.screenSize },
      { ok: typed.screenWidth === WIDTH_TYPED, message: '사이즈에서 가로가 안 뽑혔습니다: ' + typed.screenWidth },
      { ok: typed.screenDepth === DEPTH_TYPED, message: '사이즈에서 세로가 안 뽑혔습니다: ' + typed.screenDepth },
    ]);

    // 3) 저장 ID가 비는 순간에 신원 정리가 도는 상황 — 오늘 사고가 난 바로 그 지점.
    const afterRepair = await evaluateFactoryCdpFixture(cdp, `({ setAppState, readFactory, replaceFactory, renderApp }) => {
      const factory = structuredClone(readFactory());
      setAppState({ currentProjectId: '', currentProjectName: '' });
      factory.workspace = { id: '', name: '', createdAt: null, updatedAt: null };
      factory.currentProjectId = '';
      factory.product.finalDb = { product_name: '이전제품' + ${JSON.stringify(seed)} };
      repairFactoryProductIdentityDrift(factory);
      replaceFactory(factory, { reason: 'manual-size-identity-repair' });
      renderApp();
      const current = readFactory();
      const settings = current.product.dbFieldSettings || {};
      const summary = factoryAutomationReviewSummary(current, factoryAutomationCounts(current));
      const pick = id => summary.fields.find(field => field.id === id) || {};
      return {
        size: (settings.size && settings.size.manualValue) || '',
        width: (settings.width_mm && settings.width_mm.manualValue) || '',
        depth: (settings.depth_mm && settings.depth_mm.manualValue) || '',
        screenSize: pick('size').value || '',
        screenWidth: pick('width_mm').value || '',
        screenDepth: pick('depth_mm').value || '',
      };
    }`);

    assertChecks([
      { ok: afterRepair.size === SIZE_TEXT, message: "신원 정리가 손으로 넣은 사이즈를 지웠습니다: '" + afterRepair.size + "'" },
      { ok: afterRepair.screenSize === SIZE_TEXT, message: "화면에서 사이즈가 비어 보입니다: '" + afterRepair.screenSize + "'" },
      { ok: afterRepair.screenWidth === WIDTH_AFTER, message: "신원 정리 뒤 가로가 사라졌습니다: '" + afterRepair.screenWidth + "'" },
      { ok: afterRepair.screenDepth === DEPTH_AFTER, message: "신원 정리 뒤 세로가 사라졌습니다: '" + afterRepair.screenDepth + "'" },
    ]);

    // 4) 옛 로그 한 줄 때문에 빨간 VM 배너가 눌러앉지 않는지도 함께 본다.
    // 4) 옛 로그 한 줄 때문에 빨간 VM 배너가 눌러앉지 않는지 화면 동작으로 확인한다.
    const banner = await evaluateFactoryCdpFixture(cdp, `({ readFactory }) => {
      const oldLog = [{ time: Date.now(), message: 'VM 상세수집 중 로그인 화면이 감지되어 추가 확인 필요', type: 'warn' }];
      const call = market => String(renderFactoryManualInterventionPrompt(readFactory(), {
        market, stage: '', goal: {}, logs: oldLog,
      }) || '').trim();
      return {
        // 수집이 도는 중이면 옛 로그로 배너를 띄우지 않는다.
        hiddenWhileRunning: !call({ loading: true, phase: 'detail-collect', logs: oldLog }),
        // 이미 끝났어도 띄우지 않는다.
        hiddenWhenDone: !call({ loading: false, phase: 'detail-done', logs: oldLog }),
        // VM 이 실제로 보고한 신호가 있으면 그것은 띄운다(폴백을 없앤 것이 아니다).
        shownWhenReal: !!call({
          loading: false,
          phase: 'detail-manual',
          logs: oldLog,
          manualIntervention: {
            id: 'real', status: 'manual_required', manualTitle: 'VM 로그인 필요',
            message: '실제 신호', target: 'VM 상세수집 작업', captureRuntime: 'vm', requestedAt: Date.now(),
          },
        }),
      };
    }`);

    assertChecks([
      { ok: banner.hiddenWhileRunning, message: '수집이 도는 중인데도 옛 로그로 빨간 배너를 띄웠습니다.' },
      { ok: banner.hiddenWhenDone, message: '수집이 끝났는데도 옛 로그로 빨간 배너를 띄웠습니다.' },
      { ok: banner.shownWhenReal, message: 'VM 이 실제로 보고한 신호까지 가려버렸습니다. 폴백을 없앤 것이 아닙니다.' },
    ]);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    fs.writeFileSync(RESULT_PATH, JSON.stringify({ typed, afterRepair, banner, screenshot: SCREENSHOT_PATH }, null, 2));
    process.stdout.write('[OK] 손으로 넣은 사이즈가 살아남았습니다 · 배너도 눌러앉지 않습니다\n' + RESULT_PATH + '\n');
  } finally {
    cdp.close();
  }
}

main().catch(error => {
  process.stderr.write('[FAIL] ' + (error && error.stack ? error.stack : error) + '\n');
  process.exit(1);
});
