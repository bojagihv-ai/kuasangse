const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  assertChecks,
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9635';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence', 'optionsorter-result-restore-v461');
const RESULT_PATH = path.join(OUT_DIR, 'result.json');
const SCREENSHOT_PATH = path.join(OUT_DIR, 'after-f5-result-restore.png');
const EXPECTED_BUILD_ID = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'src', 'runtime-manifest.json'), 'utf8'),
).buildId;
const ARCHIVE_IDS = Object.freeze({
  direct: 'ac41ff6b9bf5fdbd',
  linked: '153faa9f6969931a',
});
const ARCHIVE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XfXvWQAAAABJRU5ErkJggg==',
  'base64',
);

async function startArchiveFixtureServer() {
  const paths = new Set(Object.values(ARCHIVE_IDS)
    .map(archiveId => `/api/local-archive/assets/${archiveId}/image`));
  const server = http.createServer((request, response) => {
    if (!paths.has(new URL(request.url, 'http://127.0.0.1').pathname)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'image/png',
      'Content-Length': ARCHIVE_PNG.length,
    });
    response.end(ARCHIVE_PNG);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const archiveServer = await startArchiveFixtureServer();
  const seed = String(Date.now());
  const projectId = `project_option_result_v461_${seed}`;
  const projectName = `옵션결과복원검증${seed}`;
  const directImageUrl = `${archiveServer.baseUrl}/api/local-archive/assets/${ARCHIVE_IDS.direct}/image`;
  const linkedImageUrl = `${archiveServer.baseUrl}/api/local-archive/assets/${ARCHIVE_IDS.linked}/image`;
  const archiveFixture = [
    { archiveId: ARCHIVE_IDS.direct, assetId: 'fixture-direct-asset', optionResultId: 'archive-direct', imageUrl: directImageUrl },
    { archiveId: ARCHIVE_IDS.linked, assetId: 'fixture-linked-asset', optionResultId: 'archive-linked', imageUrl: linkedImageUrl },
  ];
  let runtime = null;
  let cdp = null;
  try {
    runtime = await ensureCdp(CDP_URL);
    const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
    if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.opened;
    await cdp.send('Page.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.__optionResultQaErrors = [];
        window.addEventListener('error', event => window.__optionResultQaErrors.push(String(event.error?.stack || event.message || event.error || 'error')));
        window.addEventListener('unhandledrejection', event => window.__optionResultQaErrors.push(String(event.reason?.stack || event.reason || 'unhandledrejection')));
      })()`,
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const projectId = ${JSON.stringify(projectId)};
        const archiveFixture = ${JSON.stringify(archiveFixture)};
        const nativeFetch = window.fetch.bind(window);
        window.__optionResultQaArchiveQueries = [];
        window.fetch = (input, init) => {
          const requestUrl = new URL(typeof input === 'string' ? input : input.url, window.location.href);
          if (requestUrl.pathname === '/api/local-archive/assets' && requestUrl.searchParams.get('stageId') === 'options') {
            window.__optionResultQaArchiveQueries.push(requestUrl.search);
            if (requestUrl.searchParams.get('workspaceId') === projectId) {
              return Promise.resolve(new Response(JSON.stringify({ ok: true, count: 0, assets: [] }), { headers: { 'content-type': 'application/json' } }));
            }
            if (!requestUrl.searchParams.has('workspaceId')
              && requestUrl.searchParams.get('productKey')
              && sessionStorage.getItem('option-result-qa-restore') === '1') {
              return Promise.resolve(new Response(JSON.stringify({ ok: true, count: archiveFixture.length, assets: archiveFixture }), { headers: { 'content-type': 'application/json' } }));
            }
          }
          return nativeFetch(input, init);
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
      '!!(window.state && window.render && window.defaultOptionSorterState && window.normalizeOptionSorterState && window.factoryState && window.factoryOptionSorterResultDisplayImage)',
      60000,
    );

    const beforeF5 = await evaluate(cdp, `(async () => {
      const state = window.state;
      const projectId = ${JSON.stringify(projectId)};
      const projectName = ${JSON.stringify(projectName)};
      const directImageUrl = ${JSON.stringify(directImageUrl)};
      const linkedImageUrl = ${JSON.stringify(linkedImageUrl)};
      state.currentProjectId = projectId;
      state.currentProjectName = projectName;
      state.currentProjectCreatedAt = Date.now();
      state.productName = projectName;
      state.step = 'optionsorter';
      state.optionSorter = window.normalizeOptionSorterState({
        ...window.defaultOptionSorterState(),
        subStep: 'sort',
        optionResults: [
          {
            id: 'archive-direct',
            order: 1,
            optionName: '보관 URL 직접 복원',
            optionNames: ['빨강', '노랑'],
            image: null,
            hasImage: true,
            batchLabel: '이전 생성안 보존',
            createdAt: Date.now(),
          },
          {
            id: 'archive-linked',
            order: 2,
            optionName: '조립공장 보관 자산 복원',
            optionNames: ['파랑', '초록'],
            image: null,
            hasImage: true,
            batchLabel: '이전 생성안 보존',
            createdAt: Date.now(),
          },
        ],
      });
      const factory = window.factoryState();
      factory.assets = [];
      factory.previousAssets = [];
      window.factoryStampWorkspaceIdentity?.(factory, {
        projectId,
        projectName,
        createdAt: state.currentProjectCreatedAt,
      });
      const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
      let authority = await lock.acquire({
        scopeId: 'project:' + projectId,
        ownerId: 'option result archive reload v461',
      });
      if (authority.mode !== 'editing') {
        authority = await lock.takeover({
          confirmed: true,
          scopeId: 'project:' + projectId,
          ownerId: 'option result archive reload v461',
        });
      }
      if (authority.mode !== 'editing') throw new Error('option result regression authority acquisition failed');
      await window.render();
      await new Promise(resolve => setTimeout(resolve, 300));
      for (const result of state.optionSorter.optionResults) {
        result.archiveId = '';
        result.imageUrl = '';
        result.resultAssetId = '';
      }
      const archiveResponses = await Promise.all([directImageUrl, linkedImageUrl].map(async url => {
        const response = await fetch(url, { cache: 'no-store' });
        return { ok: response.ok, type: response.headers.get('content-type') || '' };
      }));
      await window.saveLastWorkNow({ force: true, deep: true });
      await new Promise(resolve => setTimeout(resolve, 700));
      return {
        archiveLinksBeforeReload: state.optionSorter.optionResults.map(result => ({
          archiveId: result.archiveId || '',
          imageUrl: result.imageUrl || '',
          resultAssetId: result.resultAssetId || '',
        })),
        archiveResponses,
      };
    })()`);
    fs.writeFileSync(path.join(OUT_DIR, 'before-f5.json'), JSON.stringify(beforeF5, null, 2));

    await evaluate(cdp, "sessionStorage.setItem('option-result-qa-restore', '1')");
    await cdp.send('Page.navigate', { url: APP_URL });
    await waitFor(cdp, '!!(window.state && window.render && window.factoryOptionSorterResultDisplayImage)', 60000);
    await waitFor(
      cdp,
      `(() => {
        const state = window.state;
        const images = [...document.querySelectorAll('.opt-option-result img')];
        return state.currentProjectId === ${JSON.stringify(projectId)}
          && state.step === 'optionsorter'
          && state.optionSorter.optionResults.length === 2
          && images.length === 2;
      })()`,
      60000,
    );
    await evaluate(cdp, "document.querySelector('.opt-option-results')?.scrollIntoView({ block: 'center' })");
    await waitFor(cdp, "[...document.querySelectorAll('.opt-option-result img')].every(image => image.naturalWidth > 0 && image.naturalHeight > 0)", 30000);
    const afterF5 = await evaluate(cdp, `(() => {
      const state = window.state;
      const results = state.optionSorter.optionResults || [];
      const images = [...document.querySelectorAll('.opt-option-result img')];
      return {
        buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
        projectId: state.currentProjectId || '',
        resultCount: results.length,
        inlineImages: results.map(result => result.image || ''),
        archiveLinks: results.map(result => ({
          archiveId: result.archiveId || '',
          imageUrl: result.imageUrl || '',
          resultAssetId: result.resultAssetId || '',
        })),
        resolvedImages: results.map(result => window.factoryOptionSorterResultDisplayImage(result)),
        imageSizes: images.map(image => ({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })),
        placeholderVisible: document.body.innerText.includes('글자/레이아웃만'),
        archiveQueries: window.__optionResultQaArchiveQueries || [],
        errors: window.__optionResultQaErrors || [],
      };
    })()`);
    await evaluate(cdp, `(async () => {
      await Promise.all([...document.querySelectorAll('.opt-option-result img')]
        .map(image => image.decode?.().catch(() => undefined)));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));

    const download = await evaluate(cdp, `(() => {
      let downloadHref = '';
      const originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function captureDownload() { downloadHref = this.href; };
      try { window.optDownloadOptionResult('archive-linked'); }
      finally { HTMLAnchorElement.prototype.click = originalClick; }
      return { downloadHref };
    })()`);
    const checks = [
      { ok: beforeF5.archiveResponses.every(item => item.ok && item.type.includes('image/png')), message: `보관 PNG 응답 실패: ${JSON.stringify(beforeF5)}` },
      { ok: beforeF5.archiveLinksBeforeReload.every(link => !link.archiveId && !link.imageUrl && !link.resultAssetId), message: `누락된 보관 연결 재현 실패: ${JSON.stringify(beforeF5)}` },
      { ok: afterF5.buildId === EXPECTED_BUILD_ID, message: `최신 빌드가 아닙니다: ${afterF5.buildId}` },
      { ok: afterF5.projectId === projectId && afterF5.resultCount === 2, message: `F5 뒤 결과 작업 범위 복원 실패: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.inlineImages.every(image => !image), message: `축약된 inline 이미지 재현 실패: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.archiveLinks.map(link => link.archiveId).sort().join(',') === Object.values(ARCHIVE_IDS).sort().join(',') && afterF5.archiveLinks.every(link => link.imageUrl && link.resultAssetId), message: `F5 뒤 보관 결과 연결 복원 실패: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.resolvedImages.every(Boolean) && afterF5.imageSizes.every(image => image.width > 0 && image.height > 0), message: `F5 뒤 보관 결과 PNG 표시 실패: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.placeholderVisible === false, message: `보관 결과에 글자/레이아웃 placeholder가 남았습니다: ${JSON.stringify(afterF5)}` },
      { ok: afterF5.archiveQueries.some(query => query.includes('workspaceId=')) && afterF5.archiveQueries.some(query => query.includes('productKey=') && !query.includes('workspaceId=')), message: `작업 ID 변경 시 제품 키 재조회가 실행되지 않았습니다: ${JSON.stringify(afterF5.archiveQueries)}` },
      { ok: download.downloadHref.endsWith(`/api/local-archive/assets/${ARCHIVE_IDS.linked}/image`), message: `다운로드 보관 URL 실패: ${JSON.stringify(download)}` },
      { ok: afterF5.errors.length === 0, message: `브라우저 런타임 오류: ${afterF5.errors.join(' | ')}` },
    ];
    const result = { ok: checks.every(check => check.ok), url: APP_URL, beforeF5, afterF5, download, screenshot: SCREENSHOT_PATH };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ...result, resultPath: RESULT_PATH }, null, 2));
    assertChecks(checks);
  } finally {
    if (cdp) await cdp.close();
    if (runtime) await runtime.cleanup();
    await archiveServer.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
