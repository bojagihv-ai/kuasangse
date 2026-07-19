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
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'factory-selected-field-transfer-v219.png');
const RESULT_PATH = path.join(OUT_DIR, 'factory-selected-field-transfer-v219.json');

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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.factoryState && window.render)', 60000);

    const proof = await evaluate(cdp, `(async () => {
      // 현재 작업 범위와 확정된 두 외부 대상을 준비한다.
      const seed = String(Date.now());
      const projectId = 'selected_transfer_v219_' + seed;
      const productName = '선택전송검증상품' + seed;
      const runId = 'selected_transfer_run_v219_' + seed;
      const imageFingerprint = 'selected_transfer_image_v219_' + seed;
      window.state.step = 'factory';
      window.state.currentProjectId = projectId;
      window.state.currentProjectName = productName;
      window.state.currentProjectCreatedAt = Date.now();
      window.state.productName = productName;
      window.state.factory = window.normalizeFactoryState({});
      const factory = window.factoryState();
      window.factoryStampWorkspaceIdentity(factory, { projectId, projectName: productName, createdAt: window.state.currentProjectCreatedAt });
      factory.product.productName = productName;
      factory.product.userProductName = productName;
      factory.product.currentRunId = runId;
      factory.product.generationRunId = runId;
      factory.product.inputImageFingerprint = imageFingerprint;
      factory.product.lockedInputImageFingerprint = imageFingerprint;
      factory.automation.currentRunId = runId;
      factory.goalRun.currentRunId = runId;
      factory.automation.activeTab = 'fields';
      factory.product.dbCandidates = [{ jcode: 2482, product_name: productName }];
      factory.product.selectedDbCandidateKey = window.factorySinhwaCandidateKey(factory.product.dbCandidates[0]);
      factory.product.confirmedDb = { jcode: 2482, product_name: productName };
      factory.product.cafe24Candidates = [{ product_no: '2534', product_code: 'P0000DTM', product_name: productName, mall_id: 'sinhwasa' }];
      factory.product.selectedCafe24CandidateKey = window.factoryCafe24CandidateKey(factory.product.cafe24Candidates[0]);

      // 선택 전송 후보가 되는 실제 필드값을 현재 작업 범위에 확정한다.
      window.factoryCommitAutomationWizardFieldValue('sale_price', '12000', '판매가', false);
      window.factoryCommitAutomationWizardFieldValue('width_mm', '4.8cm', '가로', false);
      window.factoryCommitAutomationWizardFieldValue('material', '폴리 100%', '소재', false);
      window.factoryCommitAutomationWizardFieldValue('usage', '선물 포장, 답례품', '사용용도', false);

      // Cafe24는 판매가만 선택했을 때 price 외 상품명·상세 HTML이 섞이지 않아야 한다.
      const cafePayload = window.factoryFilterCafe24SelectedFieldPayload({
        product_name: productName,
        price: '12000',
        description: '<img src="foreign">',
        product_material: '폴리 100%',
      }, ['sale_price']);

      // 신화사DB는 선택한 안전 필드만 spec/usage 계약으로 나뉘어야 한다.
      const sinhwaPayload = window.factoryBuildSinhwaSelectedFieldPayloads([
        { id: 'width_mm', value: '4.8cm' },
        { id: 'usage', value: '선물 포장, 답례품' },
        { id: 'sale_price', value: '12000' },
      ]);

      // 외부 데이터는 건드리지 않고 네트워크 경계만 모의해 실제 버튼 함수의 payload를 검사한다.
      const originalConfirm = window.confirm;
      const originalPutSinhwaDirect = window.putSinhwaDirect;
      const originalFetchSinhwaDirect = window.fetchSinhwaDirect;
      const originalCallCafe24Console = window.callCafe24Console;
      const originalWaitForCafe24ProductEcho = window.factoryWaitForCafe24ProductEcho;
      const sinhwaCalls = [];
      const cafe24Calls = [];
      window.confirm = () => true;
      window.putSinhwaDirect = async (requestPath, body) => {
        sinhwaCalls.push({ method: 'PUT', path: requestPath, body });
        return { ...body };
      };
      window.fetchSinhwaDirect = async requestPath => {
        sinhwaCalls.push({ method: 'GET', path: requestPath });
        if (/cost-profile/.test(requestPath)) return { spec: { width_mm: 48 } };
        if (/usage-profile/.test(requestPath)) return { purposes: ['선물 포장', '답례품'] };
        return {};
      };
      const sinhwaMockResult = await window.factorySendSelectedFieldsToSinhwa([
        { id: 'width_mm', label: '가로', value: '4.8cm', sinhwa: true },
        { id: 'usage', label: '사용용도', value: '선물 포장, 답례품', sinhwa: true },
      ]);

      window.callCafe24Console = async (method, requestPath, payload) => {
        cafe24Calls.push({ method, path: requestPath, payload });
        return {};
      };
      window.factoryWaitForCafe24ProductEcho = async (productNo, mallId, expected) => ({
        detail: { product_no: productNo, mall_id: mallId, ...expected },
        verification: { checked: Object.keys(expected).length, matched: Object.keys(expected).length, missing: [], mismatches: [] },
        attempts: 1,
      });
      const currentCafe24Product = window.factoryState().product;
      const explicitCafe24Key = currentCafe24Product.selectedCafe24CandidateKey;
      currentCafe24Product.selectedCafe24CandidateKey = '';
      currentCafe24Product.confirmedCafe24ProductKey = '';
      currentCafe24Product.finalDb = { ...(currentCafe24Product.finalDb || {}), product_no: '9999' };
      const cafe24NoTargetResult = await window.factorySaveCafe24ProductFromFinalDb({
        selectedFieldIds: ['sale_price'],
        applyFinalRegistrationSettings: false,
        skipConfirm: true,
        forceName: productName + '_선택밖',
      });
      window.factoryState().product.selectedCafe24CandidateKey = explicitCafe24Key;
      const cafe24MockResult = await window.factorySaveCafe24ProductFromFinalDb({
        selectedFieldIds: ['sale_price'],
        applyFinalRegistrationSettings: false,
        skipConfirm: true,
        forceName: productName + '_선택밖',
      });
      window.confirm = originalConfirm;
      window.putSinhwaDirect = originalPutSinhwaDirect;
      window.fetchSinhwaDirect = originalFetchSinhwaDirect;
      window.callCafe24Console = originalCallCafe24Console;
      window.factoryWaitForCafe24ProductEcho = originalWaitForCafe24ProductEcho;

      const selectionResult = window.factorySetFieldTransferSelection(['sale_price', 'width_mm', 'usage']);
      const selectedBeforeScopeChange = window.factoryFieldTransferState(window.factoryState()).selectedFieldIds.slice();
      const savedTransferScope = { ...window.factoryFieldTransferState(window.factoryState()).scope };
      const currentTransferScope = window.factoryFieldTransferScope(window.factoryState());

      // workspaceId 하나만 달라져도 이전 체크 선택을 사용할 수 없어야 한다.
      window.state.currentProjectId = projectId + '_foreign';
      const selectedAfterScopeChange = window.factoryFieldTransferState(window.factoryState()).selectedFieldIds.slice();

      // 현재 작업 범위로 돌아온 뒤 실제 필수값 화면에 전송 UI가 보이는지 확인한다.
      window.state.currentProjectId = projectId;
      window.factorySetFieldTransferSelection(['sale_price', 'width_mm', 'usage']);
      window.render();
      const panel = document.querySelector('[data-factory-field-transfer-panel]');
      panel?.scrollIntoView({ block: 'center', behavior: 'auto' });
      let scrollParent = panel?.parentElement;
      while (scrollParent) {
        const style = getComputedStyle(scrollParent);
        if (scrollParent.scrollHeight > scrollParent.clientHeight && /(auto|scroll)/.test(style.overflowY)) {
          scrollParent.scrollTop = Math.max(0, panel.offsetTop - Math.round(scrollParent.clientHeight * 0.2));
        }
        scrollParent = scrollParent.parentElement;
      }
      const rect = panel?.getBoundingClientRect();
      const sinhwaButton = panel?.querySelector('[data-factory-field-transfer-target="sinhwa"]');
      const cafe24Button = panel?.querySelector('[data-factory-field-transfer-target="cafe24"]');
      const checked = Array.from(panel?.querySelectorAll('[data-factory-field-transfer-id]:checked') || []).map(input => input.value);
      return {
        cafePayload,
        sinhwaPayload,
        sinhwaMockResult,
        sinhwaCalls,
        cafe24NoTargetResult: !!cafe24NoTargetResult,
        cafe24MockResult: !!cafe24MockResult,
        cafe24Calls,
        selectedBeforeScopeChange,
        selectedAfterScopeChange,
        selectionResult,
        savedTransferScope,
        currentTransferScope,
        panelRect: rect ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
        panelVisible: !!rect && rect.width > 0 && rect.height > 0,
        panelText: String(panel?.textContent || '').replace(/\\s+/g, ' ').trim(),
        checked,
        sinhwaButtonText: String(sinhwaButton?.textContent || '').replace(/\\s+/g, ' ').trim(),
        cafe24ButtonText: String(cafe24Button?.textContent || '').replace(/\\s+/g, ' ').trim(),
      };
    })()`);

    assertChecks([
      { ok: JSON.stringify(proof.cafePayload) === JSON.stringify({ price: '12000' }), message: `Cafe24 선택 밖 필드가 payload에 섞였습니다: ${JSON.stringify(proof.cafePayload)}` },
      { ok: JSON.stringify(proof.sinhwaPayload?.spec) === JSON.stringify({ width_mm: 48 }), message: `신화사DB spec payload가 정확하지 않습니다: ${JSON.stringify(proof.sinhwaPayload?.spec)}` },
      { ok: JSON.stringify(proof.sinhwaPayload?.usage) === JSON.stringify({ purposes: ['선물 포장', '답례품'] }), message: `신화사DB usage payload가 정확하지 않습니다: ${JSON.stringify(proof.sinhwaPayload?.usage)}` },
      { ok: proof.sinhwaPayload?.unsupported?.includes('sale_price'), message: '신화사DB 안전 쓰기 계약에 없는 판매가가 제외되지 않았습니다.' },
      { ok: proof.sinhwaMockResult === true, message: '신화사DB 선택 전송 모의 실행이 재조회 일치로 완료되지 않았습니다.' },
      { ok: proof.sinhwaCalls.filter(call => call.method === 'PUT').length === 2, message: `신화사DB 선택 전송 PUT 경로 수가 다릅니다: ${JSON.stringify(proof.sinhwaCalls)}` },
      { ok: JSON.stringify(proof.sinhwaCalls.find(call => /\/spec$/.test(call.path))?.body) === JSON.stringify({ width_mm: 48 }), message: `신화사DB spec 실제 호출 payload가 다릅니다: ${JSON.stringify(proof.sinhwaCalls)}` },
      { ok: JSON.stringify(proof.sinhwaCalls.find(call => /usage-profile$/.test(call.path) && call.method === 'PUT')?.body) === JSON.stringify({ purposes: ['선물 포장', '답례품'] }), message: `신화사DB usage 실제 호출 payload가 다릅니다: ${JSON.stringify(proof.sinhwaCalls)}` },
      { ok: proof.cafe24MockResult, message: 'Cafe24 선택 전송 모의 실행이 완료되지 않았습니다.' },
      { ok: proof.cafe24NoTargetResult === false, message: '명시적으로 확정한 Cafe24 후보 없이 finalDb product_no로 선택 전송이 실행됐습니다.' },
      { ok: proof.cafe24Calls.length === 1, message: `Cafe24 PUT 호출 수가 다릅니다: ${JSON.stringify(proof.cafe24Calls)}` },
      { ok: JSON.stringify(proof.cafe24Calls[0]?.payload?.body?.product) === JSON.stringify({ price: '12000' }), message: `Cafe24 실제 PUT body에 선택 밖 필드가 섞였습니다: ${JSON.stringify(proof.cafe24Calls[0]?.payload?.body?.product)}` },
      { ok: proof.selectedBeforeScopeChange.length === 3, message: '현재 작업의 선택 전송 항목이 저장되지 않았습니다.' },
      { ok: proof.selectedAfterScopeChange.length === 0, message: `다른 실행의 선택 항목이 재사용됐습니다: ${proof.selectedAfterScopeChange.join(', ')}` },
      { ok: proof.panelVisible, message: '필수값 화면의 선택 전송 패널이 실제 화면에 보이지 않습니다.' },
      { ok: proof.checked.length === 3, message: `화면 체크 상태가 현재 작업 선택과 다릅니다: ${proof.checked.join(', ')}` },
      { ok: /신화사DB로 전송/.test(proof.sinhwaButtonText), message: `신화사DB 전송 버튼 문구가 없습니다: ${proof.sinhwaButtonText}` },
      { ok: /Cafe24로 전송/.test(proof.cafe24ButtonText), message: `Cafe24 전송 버튼 문구가 없습니다: ${proof.cafe24ButtonText}` },
      { ok: /선택한 값만 외부로 전송/.test(proof.panelText), message: '선택 전송의 명시적 범위 설명이 화면에 없습니다.' },
    ]);

    await new Promise(resolve => setTimeout(resolve, 350));
    const captureState = await evaluate(cdp, `(async () => {
      const current = window.factoryState();
      window.factorySetFieldTransferSelection(['sale_price', 'width_mm', 'usage']);
      window.render();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const fieldsTab = document.querySelector('[data-factory-auto-tab="fields"]');
      fieldsTab?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const panel = document.querySelector('[data-factory-field-transfer-panel]');
      panel?.scrollIntoView({ block: 'center', behavior: 'auto' });
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (panel) {
        Object.assign(panel.style, {
          position: 'fixed',
          zIndex: '2147483000',
          top: '150px',
          left: '260px',
          width: '720px',
          maxHeight: '820px',
          overflowY: 'auto',
          boxSizing: 'border-box',
          background: '#11121a',
          boxShadow: '0 18px 60px rgba(0,0,0,.72)',
        });
      }
      const rect = panel?.getBoundingClientRect();
      return rect ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    })()`);
    if (!captureState) throw new Error('선택 전송 패널 DOM 노드를 찾지 못했습니다.');
    await new Promise(resolve => setTimeout(resolve, 150));
    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
    fs.writeFileSync(RESULT_PATH, JSON.stringify({ proof, captureState, screenshot: SCREENSHOT_PATH }, null, 2));
    console.log(`FACTORY_SELECTED_FIELD_TRANSFER_V219_PASS screenshot=${SCREENSHOT_PATH} result=${RESULT_PATH}`);
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
