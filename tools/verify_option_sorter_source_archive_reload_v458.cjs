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
const BACKEND_BASE = process.env.KUASANGSE_BACKEND_BASE
  || process.env.KUASANGSE_BACKEND_URL
  || 'http://127.0.0.1:5050';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence', 'optionsorter-source-restore-v458');
const FIXTURE_PATH = path.join(OUT_DIR, 'option-source-v458.svg');
const RESULT_PATH = path.join(OUT_DIR, 'result.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'after-f5-restore.png');
const EXPECTED_BUILD_ID = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'src', 'runtime-manifest.json'), 'utf8'),
).buildId;

function writeFixture() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(FIXTURE_PATH, `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="480">
    <rect width="720" height="480" fill="#fff7fb"/>
    <rect x="120" y="80" width="480" height="320" rx="36" fill="#ec4899"/>
    <text x="360" y="255" text-anchor="middle" font-family="Arial" font-size="42" fill="#ffffff">OPTION SOURCE V458</text>
  </svg>`);
}

async function main() {
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('gemini_backend_url', ${JSON.stringify(BACKEND_BASE)}); } catch (_) {}`,
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__optionSourceQaErrors = [];
        window.addEventListener('error', event => window.__optionSourceQaErrors.push(String(event.error?.stack || event.message || event.error || 'error')));
        window.addEventListener('unhandledrejection', event => window.__optionSourceQaErrors.push(String(event.reason?.stack || event.reason || 'unhandledrejection')));
        const originalError = console.error.bind(console);
        console.error = (...args) => {
          window.__optionSourceQaErrors.push(args.map(value => String(value?.stack || value)).join(' '));
          originalError(...args);
        };
      })()`,
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 820,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(
      cdp,
      '!!(window.state && window.render && window.defaultOptionSorterState && window.normalizeOptionSorterState && window.optRestoreSourceImagesFromLocalArchive)',
      60000,
    );
    await waitFor(
      cdp,
      `typeof classicRuntimeHydrationReady !== 'undefined'
        && classicRuntimeHydrationReady === true
        && typeof classicRuntimeInitialRenderComplete !== 'undefined'
        && classicRuntimeInitialRenderComplete === true
        && (typeof classicRuntimeDeferredHydrationPromise === 'undefined'
          || classicRuntimeDeferredHydrationPromise === null)`,
      60000,
    );

    const seed = String(Date.now());
    const projectId = `project_option_source_v458_${seed}`;
    const projectName = `옵션원본복원검증${seed}`;
    const runId = `run_option_source_v458_${seed}`;
    const productKey = projectName.replace(/\s+/g, '').toLowerCase();
    const inputImageFingerprint = `fingerprint_option_source_v458_${seed}`;
    await evaluate(cdp, `(async () => {
      const state = window.state;
      const projectId = ${JSON.stringify(projectId)};
      const projectName = ${JSON.stringify(projectName)};
      const runId = ${JSON.stringify(runId)};
      const productKey = ${JSON.stringify(productKey)};
      const inputImageFingerprint = ${JSON.stringify(inputImageFingerprint)};
      state.currentProjectId = projectId;
      state.currentProjectName = projectName;
      state.currentProjectCreatedAt = Date.now();
      state.productName = projectName;
      state.step = 'optionsorter';
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        subStep: 'input',
        images: [],
        pool: [],
      });
      const factory = window.factoryState();
      window.factoryStampWorkspaceIdentity?.(factory, {
        projectId,
        projectName,
        createdAt: state.currentProjectCreatedAt,
      });
      factory.product.productName = projectName;
      factory.product.userProductName = projectName;
      factory.product.productKey = productKey;
      factory.product.productIdentityKey = productKey;
      factory.product.currentRunId = runId;
      factory.product.generationRunId = runId;
      factory.product.inputImageFingerprint = inputImageFingerprint;
      factory.product.lockedInputImageFingerprint = inputImageFingerprint;
      factory.automation.currentRunId = runId;
      const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
      let authority = await lock.acquire({
        scopeId: 'project:' + projectId,
        ownerId: 'option source archive reload v458',
      });
      if (authority.mode !== 'editing') {
        authority = await lock.takeover({
          confirmed: true,
          scopeId: 'project:' + projectId,
          ownerId: 'option source archive reload v458',
        });
      }
      if (authority.mode !== 'editing') throw new Error('option source regression authority acquisition failed');
      window.render();
      return true;
    })()`);
    await waitFor(cdp, '!!document.getElementById("optFileInput")', 10000);
    const doc = await cdp.send('DOM.getDocument', { depth: 1 });
    const fileInput = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '#optFileInput',
    });
    if (!fileInput.nodeId) throw new Error('Option source file input not found');
    await cdp.send('DOM.setFileInputFiles', { files: [FIXTURE_PATH], nodeId: fileInput.nodeId });
    await evaluate(cdp, `(() => {
      const input = document.getElementById('optFileInput');
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input.files.length;
    })()`);
    await waitFor(
      cdp,
      `(() => {
        const image = window.state.optionSorter.images[0];
        return window.state.optionSorter.images.length === 1
          && !!image?.archiveId
          && image.archiveStatus === 'saved'
          && document.querySelector('.opt-img-thumb img')?.naturalWidth > 0;
      })()`,
      60000,
    );

    const beforeF5 = await evaluate(cdp, `(async () => {
      const state = window.state;
      const projectId = ${JSON.stringify(projectId)};
      const image = state.optionSorter.images[0];
      const archives = await fetch(
        ${JSON.stringify(`${BACKEND_BASE}/api/local-archive/assets?limit=20&workspaceId=`)}
          + encodeURIComponent(projectId)
          + '&stageId=options',
        { cache: 'no-store' },
      ).then(response => response.json());
      const sourceRows = (archives.assets || []).filter(row =>
        (row.sourceType || row.metadata?.sourceType || row.sourceMap?.sourceType || row.reason) === 'option-sorter-source-upload'
      );
      const proof = {
        archiveId: image.archiveId || '',
        imageUrl: image.imageUrl || '',
        archiveStatus: image.archiveStatus || '',
        sourceRows: sourceRows.length,
        sourceRowArchiveIds: sourceRows.map(row => row.archiveId || ''),
      };
      // Drain the upload-triggered persistence before writing the explicit empty reload fixture.
      await window.saveLastWorkNow({ force: true, deep: true });
      state.optionSorter.images = [];
      state.optionSorter.pool = [];
      state.optionSorter.slots = window.defaultOptionSorterState().slots;
      state.optionSorter.optionSourceArchiveStatus = '';
      await window.saveLastWorkNow({ force: true, deep: true });
      await new Promise(resolve => setTimeout(resolve, 800));
      const server = await fetch(
        ${JSON.stringify(`${BACKEND_BASE}/api/last-work?workspaceId=`)} + encodeURIComponent('project:' + projectId),
        { cache: 'no-store' },
      ).then(response => response.json());
      proof.serverImagesAfterForcedEmpty = server.snapshot?.assets?.optionSorter?.images?.length || 0;
      return proof;
    })()`);

    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.optRestoreSourceImagesFromLocalArchive)', 60000);
    try {
      await waitFor(
        cdp,
        `(() => {
          const state = window.state;
          const image = state?.optionSorter?.images?.[0];
          return state?.currentProjectId === ${JSON.stringify(projectId)}
            && state?.step === 'optionsorter'
            && state.optionSorter.images.length === 1
            && !!image?.archiveId
            && image.imagePersistence === 'local-archive-url';
        })()`,
        60000,
      );
      await evaluate(cdp, `(() => {
        document.querySelector('.opt-img-thumb')?.scrollIntoView({ block: 'center' });
        return true;
      })()`);
      await waitFor(cdp, "document.querySelector('.opt-img-thumb img')?.naturalWidth > 0", 30000);
    } catch (error) {
      const diagnostic = await evaluate(cdp, `(async () => {
        const state = window.state || {};
        const identity = window.factoryLocalArchiveIdentity?.('options') || {};
        const base = (window.factoryBackendBaseUrl?.() || state.backendBaseUrl || 'http://127.0.0.1:5050').replace(/\\/+$/, '');
        const query = new URLSearchParams({
          limit: '20',
          workspaceId: identity.workspaceId || '',
          stageId: 'options',
        });
        if (identity.productKey) query.set('productKey', identity.productKey);
        const response = await fetch(base + '/api/local-archive/assets?' + query.toString(), { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        return {
          buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
          projectId: state.currentProjectId || '',
          projectName: state.currentProjectName || '',
          step: state.step || '',
          imageCount: state.optionSorter?.images?.length || 0,
          poolCount: state.optionSorter?.pool?.length || 0,
          status: state.optionSorter?.optionSourceArchiveStatus || '',
          identity,
          archiveStatus: response.status,
          archiveRows: (data.assets || []).map(row => ({
            archiveId: row.archiveId || '',
            workspaceId: row.workspaceId || '',
            productKey: row.productKey || '',
            inputImageFingerprint: row.inputImageFingerprint || '',
            sourceType: row.sourceType || row.metadata?.sourceType || row.sourceMap?.sourceType || row.reason || '',
          })),
          errors: window.__optionSourceQaErrors || [],
        };
      })()`);
      fs.writeFileSync(
        path.join(OUT_DIR, 'reload-timeout-diagnostic.json'),
        JSON.stringify({ message: error.message, beforeF5, diagnostic }, null, 2),
      );
      throw error;
    }
    const afterF5 = await evaluate(cdp, `(() => {
      const state = window.state;
      const image = state.optionSorter.images[0] || {};
      const thumb = document.querySelector('.opt-img-thumb img');
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        projectId: state.currentProjectId || '',
        projectName: state.currentProjectName || '',
        imageCount: state.optionSorter.images.length,
        poolCount: state.optionSorter.pool.length,
        archiveId: image.archiveId || '',
        imageUrl: image.imageUrl || '',
        imagePersistence: image.imagePersistence || '',
        sourceType: image.sourceType || '',
        status: state.optionSorter.optionSourceArchiveStatus || '',
        thumbNaturalWidth: thumb?.naturalWidth || 0,
        thumbNaturalHeight: thumb?.naturalHeight || 0,
        uiText: /(?:로컬 보관본에서 옵션 원본 1장을 복원했습니다|옵션 원본 1장이 로컬 보관되어 있습니다)/.test(document.body.innerText),
        restoreWarningVisible: document.body.innerText.includes('저장된 이미지 복원에 실패했습니다.'),
        errors: window.__optionSourceQaErrors || [],
      };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(shot.data, 'base64'));
    const checks = [
      { ok: beforeF5.archiveStatus === 'saved' && !!beforeF5.archiveId, message: `업로드 즉시 보관 실패: ${JSON.stringify(beforeF5)}` },
      { ok: beforeF5.sourceRows === 1 && beforeF5.sourceRowArchiveIds.includes(beforeF5.archiveId), message: `원본 전용 archive 레코드 불일치: ${JSON.stringify(beforeF5)}` },
      { ok: beforeF5.serverImagesAfterForcedEmpty === 0, message: `빈 초안 재현 실패: ${JSON.stringify(beforeF5)}` },
      { ok: afterF5.buildId === EXPECTED_BUILD_ID, message: `최신 빌드가 아닙니다: ${afterF5.buildId}` },
      { ok: afterF5.projectId === projectId && afterF5.projectName === projectName, message: `작업 범위가 바뀌었습니다: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.imageCount === 1 && afterF5.poolCount === 1, message: `F5 뒤 원본 목록 복원 실패: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.archiveId === beforeF5.archiveId && afterF5.imagePersistence === 'local-archive-url', message: `F5 뒤 archive 참조 불일치: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.sourceType === 'option-sorter-source-upload' && afterF5.uiText, message: `원본 복원 상태 UI 불일치: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.thumbNaturalWidth > 0 && afterF5.thumbNaturalHeight > 0, message: `F5 뒤 썸네일 로드 실패: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.restoreWarningVisible === false, message: `복원 성공 뒤 오래된 실패 경고가 남았습니다: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.errors.length === 0, message: `브라우저 런타임 오류: ${afterF5.errors.join(' | ')}` },
    ];
    const result = {
      ok: checks.every(check => check.ok),
      url: APP_URL,
      beforeF5,
      afterF5,
      screenshot: SCREENSHOT_PATH,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    if (cdp) await cdp.close();
    await runtime.cleanup();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
