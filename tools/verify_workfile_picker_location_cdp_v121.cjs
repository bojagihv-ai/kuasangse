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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9521';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const REPORT_PATH = path.join(OUT_DIR, 'workfile-picker-location-v121.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'workfile-picker-location-v121.png');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.exportCurrentProjectFile && window.openFactoryProjectFilePicker)', 60000);

    const proof = await evaluate(cdp, `(async () => {
      const calls = { save: [], open: [], writeBytes: 0, closed: false };
      const fakeHandle = {
        name: '위치기억검증.kuasangse',
        async createWritable() {
          return {
            async write(blob) { calls.writeBytes = Number(blob?.size || 0); },
            async close() { calls.closed = true; },
          };
        },
      };
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async options => {
          calls.save.push({
            id: options.id,
            suggestedName: options.suggestedName,
            startInName: typeof options.startIn === 'string' ? options.startIn : (options.startIn?.name || ''),
            typeExtensions: options.types?.[0]?.accept?.['application/json'] || [],
          });
          return fakeHandle;
        },
      });
      Object.defineProperty(window, 'showOpenFilePicker', {
        configurable: true,
        value: async options => {
          calls.open.push({
            id: options.id,
            startInName: typeof options.startIn === 'string' ? options.startIn : (options.startIn?.name || ''),
            startInMatchesSavedHandle: options.startIn === fakeHandle,
            multiple: options.multiple,
            typeExtensions: options.types?.[0]?.accept?.['application/json'] || [],
          });
          throw new DOMException('verification cancel', 'AbortError');
        },
      });

      window.state.currentProjectId = 'project_picker_location_v121';
      window.state.currentProjectName = '위치기억검증';
      window.state.currentProjectCreatedAt = Date.now();
      window.state.productName = '위치기억검증';
      window.state.workspaceDocumentDirty = true;
      if (typeof window.normalizeFactoryState === 'function') {
        window.state.factory = window.normalizeFactoryState(window.state.factory || {});
        window.state.factory.product.productName = '위치기억검증';
        window.state.factory.product.userProductName = '위치기억검증';
      }
      window.render();
      const exported = await window.exportCurrentProjectFile({ name: '위치기억검증' });
      await window.openFactoryProjectFilePicker();
      window.render();
      await new Promise(resolve => setTimeout(resolve, 200));

      const title = document.querySelector('.db-workfile-name');
      const row = document.querySelector('.top-command-row');
      const titleRect = title?.getBoundingClientRect();
      const rowRect = row?.getBoundingClientRect();
      return {
        calls,
        exportedFormat: exported?.format || '',
        locationLabel: window.factoryProjectFileLocationLabel?.() || '',
        rowText: row?.innerText || '',
        titleText: title?.innerText || '',
        titleFontSize: title ? getComputedStyle(title).fontSize : '',
        titleCenterX: titleRect ? Math.round(titleRect.left + titleRect.width / 2) : null,
        rowCenterX: rowRect ? Math.round(rowRect.left + rowRect.width / 2) : null,
      };
    })()`);

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));

    assertChecks([
      { ok: proof.calls.save.length === 1, message: '저장 위치 선택기가 정확히 한 번 호출되지 않았습니다.' },
      { ok: proof.calls.open.length === 1, message: '불러오기 위치 선택기가 정확히 한 번 호출되지 않았습니다.' },
      { ok: proof.calls.save[0]?.id === proof.calls.open[0]?.id, message: '저장과 불러오기 선택기 ID가 달라 같은 위치를 공유하지 못합니다.' },
      { ok: proof.calls.open[0]?.startInMatchesSavedHandle === true, message: '불러오기가 최근 저장 파일 핸들을 시작 위치로 사용하지 않았습니다.' },
      { ok: proof.calls.writeBytes > 0 && proof.calls.closed, message: '선택한 로컬 파일 핸들에 작업파일 쓰기가 완료되지 않았습니다.' },
      { ok: proof.calls.save[0]?.typeExtensions?.includes('.kuasangse'), message: '저장 선택기에 .kuasangse 형식이 없습니다.' },
      { ok: proof.calls.open[0]?.typeExtensions?.includes('.kuasangse'), message: '불러오기 선택기에 .kuasangse 형식이 없습니다.' },
      { ok: proof.locationLabel === '위치기억검증.kuasangse', message: '최근 로컬 파일 표시가 저장한 파일명으로 갱신되지 않았습니다.' },
      { ok: proof.titleText === '위치기억검증.kuasangse', message: '현재 작업파일 제목이 올바르게 표시되지 않았습니다.' },
      { ok: Number.parseFloat(proof.titleFontSize) >= 28, message: `현재 작업파일 제목이 충분히 크지 않습니다: ${proof.titleFontSize}` },
      { ok: proof.rowText.includes('최근 로컬 파일 위치기억검증.kuasangse'), message: '상단에 최근 로컬 파일 표시가 보이지 않습니다.' },
    ]);

    const report = { ok: true, proof, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, reportPath: REPORT_PATH, screenshot: SCREENSHOT_PATH, proof }, null, 2));
  } finally {
    cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
