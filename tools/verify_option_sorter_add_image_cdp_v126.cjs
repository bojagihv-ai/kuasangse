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
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9633';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const FIXTURE_PATH = path.join(OUT_DIR, 'option-sorter-upload-fixture-v126.svg');
const SCREENSHOT_PATHS = {
  mobile: path.join(OUT_DIR, 'option-sorter-add-image-v126-375.png'),
  mobilePool: path.join(OUT_DIR, 'option-sorter-add-image-v126-375-pool.png'),
  tablet: path.join(OUT_DIR, 'option-sorter-add-image-v126-768.png'),
  tabletPool: path.join(OUT_DIR, 'option-sorter-add-image-v126-768-pool.png'),
  desktop: path.join(OUT_DIR, 'option-sorter-add-image-v126-1280.png'),
  desktopPool: path.join(OUT_DIR, 'option-sorter-add-image-v126-1280-pool.png'),
};
const RESULT_PATH = path.join(OUT_DIR, 'option-sorter-add-image-v126-result.json');

function writeFixture() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480" viewBox="0 0 720 480">
  <rect width="720" height="480" fill="#13131a"/>
  <rect x="110" y="90" width="500" height="300" rx="24" fill="#6366f1"/>
  <text x="360" y="255" text-anchor="middle" font-family="Arial" font-size="34" fill="#fff">OPTION V126</text>
</svg>`;
  fs.writeFileSync(FIXTURE_PATH, svg);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeFixture();
  const runtime = await ensureCdp(CDP_URL);
  let cdp = null;
  try {
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.defaultOptionSorterState && window.normalizeOptionSorterState && window.hydratePersistentSessionAssets && window.hydrateServerLastWorkSnapshot)', 60000);
    await evaluate(cdp, `(async () => {
      await window.hydratePersistentSessionAssets().catch(() => false);
      await window.hydrateServerLastWorkSnapshot().catch(() => false);
      await new Promise(resolve => setTimeout(resolve, 500));
      return true;
    })()`);

    await evaluate(cdp, `(() => {
      window.scheduleLastWorkSave = () => {};
      window.saveLastWorkNow = () => {};
      const base = window.defaultOptionSorterState();
      window.state.step = 'optionsorter';
      window.state.optionSorter = window.normalizeOptionSorterState({
        ...base,
        subStep: 'sort',
        images: [],
        pool: [],
        previewImageId: null,
      });
      window.render();
      window.__optionSorterUploadProof = { inputClickCount: 0 };
      const input = document.getElementById('optFileInput');
      input?.addEventListener('click', () => { window.__optionSorterUploadProof.inputClickCount += 1; });
      document.getElementById('optAddImagesBtn')?.click();
      return true;
    })()`);
    await waitFor(cdp, '!!document.getElementById("optAddImagesBtn") && !!document.getElementById("optFileInput")', 10000);

    const doc = await cdp.send('DOM.getDocument', { depth: 1 });
    const selected = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#optFileInput',
    });
    if (!selected.nodeId) throw new Error('Option sorter file input not found');
    await cdp.send('DOM.setFileInputFiles', { files: [FIXTURE_PATH], nodeId: selected.nodeId });
    await evaluate(cdp, `(() => {
      const input = document.getElementById('optFileInput');
      if (!input?.files?.length) return false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(cdp, `window.state.optionSorter.images.length === 1 &&
      window.state.optionSorter.pool.length === 1 &&
      document.querySelectorAll('#optPoolList [data-img-id]').length === 1 &&
      document.body.innerText.includes('0/1장 배정됨')`, 15000);

    const firstInputReset = await evaluate(cdp, `document.getElementById('optFileInput')?.value === ''`);
    const refreshedDoc = await cdp.send('DOM.getDocument', { depth: 1 });
    const refreshedInput = await cdp.send('DOM.querySelector', {
      nodeId: refreshedDoc.root.nodeId,
      selector: '#optFileInput',
    });
    await cdp.send('DOM.setFileInputFiles', { files: [FIXTURE_PATH], nodeId: refreshedInput.nodeId });
    await evaluate(cdp, `(() => {
      const input = document.getElementById('optFileInput');
      if (!input?.files?.length) return false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await waitFor(cdp, `window.state.optionSorter.images.length === 2 &&
      window.state.optionSorter.pool.length === 2 &&
      document.querySelectorAll('#optPoolList [data-img-id]').length === 2 &&
      document.body.innerText.includes('0/2장 배정됨')`, 15000);

    const proof = await evaluate(cdp, `(async () => {
      const os = window.state.optionSorter;
      const button = document.getElementById('optAddImagesBtn');
      const input = document.getElementById('optFileInput');
      const images = os.images || [];
      const poolCards = [...document.querySelectorAll('#optPoolList [data-img-id]')];
      const bundle = await window.buildFactoryProjectFileBundle({ name: '옵션이미지검증' });
      const savedImages = bundle?.project?.payload?.assetPayload?.optionSorter?.images || [];
      return {
        subStep: os.subStep,
        buttonVisible: !!button && getComputedStyle(button).display !== 'none',
        buttonText: button?.innerText?.replace(/\\s+/g, ' ').trim() || '',
        inputMultiple: !!input?.multiple,
        inputAccept: input?.accept || '',
        firstInputReset: ${firstInputReset ? 'true' : 'false'},
        secondInputReset: input?.value === '',
        inputClickCount: window.__optionSorterUploadProof?.inputClickCount || 0,
        imageCount: os.images.length,
        poolCount: os.pool.length,
        slotCount: os.slots.length,
        imageNames: images.map(image => image.name || ''),
        allImagesHavePayload: images.every(image => !!(image.base64 && image.preview)),
        workfileImageCount: savedImages.length,
        workfileAllImagesHavePayload: savedImages.every(image => !!(image.base64 && image.preview)),
        poolCardIds: poolCards.map(card => card.dataset.imgId || ''),
        visibleCountText: [...document.querySelectorAll('p')]
          .map(item => item.textContent || '')
          .find(text => text.includes('장 배정됨')) || '',
      };
    })()`);

    const checks = [
      { ok: proof.subStep === 'sort', message: '정렬 화면 상태가 유지되지 않았습니다.' },
      { ok: proof.buttonVisible && proof.buttonText.includes('이미지 추가'), message: '정렬 화면에 이미지 추가 버튼이 보이지 않습니다.' },
      { ok: proof.inputClickCount === 1, message: '이미지 추가 버튼이 파일 입력을 열지 않았습니다.' },
      { ok: proof.inputMultiple && proof.inputAccept.includes('image/'), message: '이미지 파일 다중 선택 입력이 아닙니다.' },
      { ok: proof.firstInputReset && proof.secondInputReset, message: '같은 파일을 다시 선택할 수 있도록 파일 입력이 초기화되지 않았습니다.' },
      { ok: proof.imageCount === 2 && proof.poolCount === 2, message: '두 번 추가한 이미지가 옵션 분류기와 미배정 풀에 반영되지 않았습니다.' },
      { ok: proof.allImagesHavePayload && proof.imageNames.every(name => name === 'option-sorter-upload-fixture-v126'), message: '추가한 이미지의 원본 데이터나 이름이 보존되지 않았습니다.' },
      { ok: proof.workfileImageCount === 2 && proof.workfileAllImagesHavePayload, message: '추가한 이미지가 작업파일 묶음에 원본 데이터와 함께 포함되지 않았습니다.' },
      { ok: proof.poolCardIds.length === 2 && proof.poolCardIds.every(Boolean), message: '추가한 이미지 카드 2장이 미배정 목록에 렌더링되지 않았습니다.' },
    ];

    for (const [key, width] of [['mobile', 375], ['tablet', 768], ['desktop', 1280]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 820,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(cdp, `(() => {
        window.scrollTo(0, 0);
        const main = document.querySelector('.main');
        if (main) main.scrollTop = 0;
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(SCREENSHOT_PATHS[key], Buffer.from(shot.data, 'base64'));
      await evaluate(cdp, `(() => {
        const main = document.querySelector('.main');
        const pool = document.getElementById('optPoolList');
        if (!main || !pool) return false;
        const mainRect = main.getBoundingClientRect();
        const poolRect = pool.getBoundingClientRect();
        main.scrollTop += poolRect.top - mainRect.top - 120;
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 100));
      const poolShot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(SCREENSHOT_PATHS[`${key}Pool`], Buffer.from(poolShot.data, 'base64'));
    }
    const result = { ok: checks.every(check => check.ok), proof, screenshots: SCREENSHOT_PATHS };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    if (cdp) cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
