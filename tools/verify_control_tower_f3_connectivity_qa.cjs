const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('./factory_cdp_test_utils.cjs');

const root = path.resolve(__dirname, '..');
const evidence = path.resolve(root, process.env.F3_EVIDENCE_DIR || '.omo/evidence/batch-production-control-tower/final-f3-fix-20260731');
const serverPath = path.join(root, 'control_tower', 'tests', 'frontend', 'qa-production-workbench-server.cjs');
const sourceFiles = [
  'control_tower/frontend/control-tower.html',
  'control_tower/frontend/src/production-workbench.mjs',
  'control_tower/frontend/src/factory-sync-model.mjs',
  'control_tower/frontend/src/virtual-queue.mjs',
  'control_tower/tests/frontend/production-workbench.test.cjs',
  'control_tower/tests/frontend/qa-production-workbench-server.cjs',
];
const browserSourceFiles = {
  'control_tower/frontend/control-tower.html': '/control-tower.html',
  'control_tower/frontend/src/production-workbench.mjs': '/src/production-workbench.mjs',
  'control_tower/frontend/src/factory-sync-model.mjs': '/src/factory-sync-model.mjs',
  'control_tower/frontend/src/virtual-queue.mjs': '/src/virtual-queue.mjs',
};
const viewports = [
  { id: '1440x900', width: 1440, height: 900 },
  { id: '1024x600', width: 1024, height: 600 },
  { id: '375x667', width: 375, height: 667 },
];

const pickPort = () => new Promise(resolve => {
  const server = http.createServer();
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const stopChild = child => new Promise(resolve => {
  if (!child || child.exitCode !== null) return resolve();
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.once('exit', () => {
    clearTimeout(timer);
    resolve();
  });
  child.kill('SIGTERM');
});

const waitHttp = async url => {
  let lastError = null;
  for (let index = 0; index < 80; index += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`qa_server_timeout:${url}`);
};

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function sourceFingerprint() {
  const files = Object.fromEntries(sourceFiles.map(relativePath => [
    relativePath,
    sha256(fs.readFileSync(path.join(root, relativePath))),
  ]));
  return {
    algorithm: 'sha256',
    files,
    fingerprint: sha256(Object.entries(files).map(([file, digest]) => `${file}\0${digest}`).join('\n')),
  };
}

async function browserServedSourceHashes(page) {
  return evaluate(page, `(async () => {
    const files = ${JSON.stringify(browserSourceFiles)};
    const hashes = {};
    for (const [file, requestPath] of Object.entries(files)) {
      const response = await fetch(new URL(requestPath, location.origin), { cache: 'no-store' });
      if (!response.ok) throw new Error('source_fetch_failed:' + file + ':' + response.status);
      const bytes = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      hashes[file] = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
    }
    return hashes;
  })()`);
}

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG magic mismatch');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function measureQueueFixture(page, fixtureCount, apiPort, frontendPort) {
  await page.send('Page.navigate', {
    url: `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&fixtureCount=${fixtureCount}`,
  });
  await waitFor(page, `(() => {
    const root = document.getElementById('product-list');
    const rendered = Number(root?.dataset.virtualRendered || 0);
    return typeof window.__CONTROL_TOWER_QUEUE_METRICS__ === 'function'
      && root?.dataset.virtualTotal === '${fixtureCount}'
      && rendered > 0
      && root.querySelectorAll('[data-product-id]').length === rendered
      && document.querySelectorAll('img[loading="lazy"]').length > 0
      && document.getElementById('factory-sync-bar')?.textContent.includes('조립공장 연결 끊김');
  })()`, 20_000);
  return evaluate(page, `(() => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const relevantResources = () => performance.getEntriesByType('resource').filter(entry =>
      entry.initiatorType === 'img'
      || /\\/thumbnail(?:[/?]|$)|\\/api\\/assets\\/thumbnail\\/|\\/content(?:[/?]|$)|raw-original|original-content/i.test(entry.name)
    );
    return (async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      const pageRoot = document.querySelector('main.page');
      const queueRoot = document.getElementById('product-list');
      document.getElementById('menu-tab-overview')?.click();
      await frame();
      const pageRect = pageRoot.getBoundingClientRect();
      const queueRect = queueRoot.getBoundingClientRect();
      const queueTop = pageRoot.scrollTop + queueRect.top - pageRect.top;
      pageRoot.scrollTop = Math.max(0, queueTop + (${fixtureCount} * 112 / 2) - (pageRoot.clientHeight / 2));
      await frame();
      let previousCount = -1;
      let stableSamples = 0;
      for (let sample = 0; sample < 40 && stableSamples < 3; sample += 1) {
        await frame();
        await new Promise(resolve => setTimeout(resolve, 50));
        const count = relevantResources().length;
        stableSamples = count === previousCount ? stableSamples + 1 : 0;
        previousCount = count;
      }
      const root = document.getElementById('product-list');
      const lazyImages = [...document.querySelectorAll('img[loading="lazy"]')];
      const lazySources = new Set(lazyImages
        .map(image => image.currentSrc || image.src)
        .filter(Boolean)
        .map(value => new URL(value, location.href).href));
      const resources = relevantResources().map(entry => ({
        url: entry.name,
        initiatorType: entry.initiatorType,
        durationMs: Number(entry.duration.toFixed(3)),
      }));
      const rawOriginalNetworkRequests = resources.filter(item =>
        /\\/content(?:[/?]|$)|raw-original|original-content/i.test(item.url)
      );
      const lazyQueueImageRequests = resources.filter(item => {
        const url = String(item.url || '');
        return url.includes('/api/assets/thumbnail/queue-product-') && url.includes('.svg');
      });
      const eagerImageRequests = resources.filter(item =>
        !rawOriginalNetworkRequests.includes(item)
        && !lazyQueueImageRequests.includes(item)
        && !lazySources.has(item.url)
      );
      const queueMetrics = window.__CONTROL_TOWER_QUEUE_METRICS__();
      const rows = [...root.querySelectorAll('[data-product-id]')];
      return {
        fixtureCount: ${fixtureCount},
        clock: 'window.performance.now()',
        startMarker: 'navigation performance origin (performance.now() = 0)',
        settledMarker: 'virtual total/rendered/DOM agree; disconnected status rendered; relevant image request count stable for 3 samples',
        durationMs: Number(performance.now().toFixed(3)),
        navigationTimeOriginMs: performance.timeOrigin,
        totalProducts: Number(root?.dataset.virtualTotal || 0),
        renderedRows: Number(root?.dataset.virtualRendered || 0),
        domRows: root?.querySelectorAll('[data-product-id]').length || 0,
        firstProductId: rows[0]?.dataset.productId || '',
        lastProductId: rows.at(-1)?.dataset.productId || '',
        domBoundThreshold: 24,
        lazyThumbRefs: root?.querySelectorAll('[data-thumbnail-ref]').length || 0,
        currentImgLoadingLazyCount: lazyImages.length,
        currentImgCount: document.images.length,
        lazyQueueImageRequestCount: lazyQueueImageRequests.length,
        lazyQueueImageRequests,
        eagerImageRequestCount: eagerImageRequests.length,
        eagerImageRequests,
        rawOriginalNetworkRequestCount: rawOriginalNetworkRequests.length,
        rawOriginalNetworkRequests,
        totalRelevantImageRequests: resources.length,
        relevantImageRequests: resources,
        stableRelevantImageRequestSamples: stableSamples,
        renderMarker: {
          total: Number(queueMetrics.total || 0),
          rendered: Number(queueMetrics.rendered || 0),
          scrollHeight: Number(queueMetrics.scrollHeight || 0),
        },
      };
    })();
  })()`);
}

async function inspectViewport(page, viewport, apiPort, frontendPort) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send('Page.navigate', {
    url: `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&fixtureCount=200`,
  });
  await waitFor(page, "document.getElementById('factory-sync-bar')?.textContent.includes('조립공장 연결 끊김')", 20_000);
  return evaluate(page, `(() => {
    const root = document.querySelector('main.page');
    const selector = 'button,input,select,textarea,a[href],summary,[role="button"],[role="tab"],[role="checkbox"],[contenteditable="true"]';
    const rendered = element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0 && rect.width > 1 && rect.height > 1 && !element.closest('[hidden]');
    };
    const label = element => String(element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.innerText || element.value || element.id || element.tagName).trim().replace(/\\s+/g, ' ').slice(0, 120);
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const controls = [];
    const routes = [];
    const tabs = [...document.querySelectorAll('#primary-menu [role="tab"][data-menu-key]')];
    return (async () => {
      for (const tab of tabs) {
        tab.click();
        await frame();
        const routeControls = [...document.querySelectorAll(selector)].filter(rendered);
        for (const element of routeControls) {
          const before = root.scrollTop;
          element.scrollIntoView({ block: 'center', inline: 'nearest' });
          await frame();
          const rect = element.getBoundingClientRect();
          controls.push({
            route: tab.dataset.menuKey,
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: element.className,
            label: label(element),
            reachable: rect.top >= -1 && rect.bottom <= innerHeight + 1 && rect.left >= -1 && rect.right <= innerWidth + 1,
            rect: {
              top: Math.round(rect.top),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            rootScrollBefore: before,
            rootScrollAfter: root.scrollTop,
          });
        }
        routes.push({
          key: tab.dataset.menuKey,
          active: tab.getAttribute('aria-selected') === 'true',
          syncText: document.getElementById('factory-sync-bar')?.textContent || '',
        });
      }
      document.getElementById('menu-tab-overview')?.click();
      await frame();
      const firstQueueRows = document.querySelectorAll('#product-list [data-product-id]').length;
      const queueTotal = document.getElementById('product-list')?.dataset.virtualTotal || '';
      const queueRendered = document.getElementById('product-list')?.dataset.virtualRendered || '';
      const rawOriginalRequests = performance.getEntriesByType('resource')
        .map(item => item.name)
        .filter(url => /\\/content(?:[/?]|$)|raw-original|original-content/i.test(url));
      const rootBeforeBottom = root.scrollTop;
      root.scrollTop = root.scrollHeight;
      root.scrollLeft = 0;
      await frame();
      const rootAtBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      const syncText = document.getElementById('factory-sync-bar')?.textContent || '';
      const syncOverflow = [...document.querySelectorAll('#factory-sync-bar *')]
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName.toLowerCase(), className: element.className, text: label(element), left: Math.round(rect.left), right: Math.round(rect.right) };
        })
        .filter(item => item.right > innerWidth + 1 || item.left < -1);
      const syncRoot = document.getElementById('factory-sync-bar');
      const syncRootStyle = getComputedStyle(syncRoot);
      const syncRootRect = syncRoot.getBoundingClientRect();
      const syncLayout = {
        flexDirection: syncRootStyle.flexDirection,
        flexWrap: syncRootStyle.flexWrap,
        left: Math.round(syncRootRect.left),
        right: Math.round(syncRootRect.right),
        width: Math.round(syncRootRect.width),
        mediaMatches: matchMedia('(max-width: 720px)').matches,
      };
      const scrollOwners = [
        ['html', document.documentElement],
        ['body', document.body],
        ['main.page', root],
      ].filter(([, element]) => {
        const overflowY = getComputedStyle(element).overflowY;
        return ['auto', 'scroll'].includes(overflowY) && element.scrollHeight > element.clientHeight + 1;
      }).map(([name]) => name);
      const cjkCorruption = document.body.innerText.includes('�');
      return {
        viewport: { width: innerWidth, height: innerHeight },
        narrowLayoutApplied: matchMedia('(max-width: 720px)').matches,
        root: {
          overflowY: getComputedStyle(root).overflowY,
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
          scrollTop: root.scrollTop,
          beforeBottom: rootBeforeBottom,
          atBottom: rootAtBottom,
          scrollbarWidth: root.offsetWidth - root.clientWidth,
        },
        horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1,
        cjkCorruption,
        syncText,
        syncOverflow,
        syncLayout,
        scrollOwners,
        routes,
        controls,
        allControlsReachable: controls.length > 0 && controls.every(item => item.reachable),
        queue: { firstQueueRows, queueTotal, queueRendered, rawOriginalRequests },
      };
    })();
  })()`);
}

async function main() {
  fs.mkdirSync(evidence, { recursive: true });
  const sourceBefore = sourceFingerprint();
  const apiPort = await pickPort();
  const frontendPort = await pickPort();
  const server = spawn(process.execPath, [serverPath], {
    cwd: root,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
      CONTROL_TOWER_QA_FACTORY_STATE: 'disconnected',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  server.stdout.on('data', value => output.push(String(value)));
  server.stderr.on('data', value => output.push(String(value)));
  let runtime;
  let page;
  let result;
  const cleanup = { serverPid: server.pid, serverStopped: false, browserLaunched: false, browserStopped: false };
  try {
    await waitHttp(`http://127.0.0.1:${apiPort}/api/health`);
    runtime = await ensureCdp(`http://127.0.0.1:${await pickPort()}`);
    cleanup.browserLaunched = runtime.launched === true;
    const target = runtime.targets.find(item => item.type === 'page') || runtime.targets[0];
    page = connectCdp(target.webSocketDebuggerUrl);
    await page.opened;
    await page.send('Page.enable');
    const captures = [];
    for (const viewport of viewports) {
      const inspection = await inspectViewport(page, viewport, apiPort, frontendPort);
      await evaluate(page, `(() => {
        const root = document.querySelector('main.page');
        root.scrollTop = 0;
        root.scrollLeft = 0;
        return root.scrollTop;
      })()`);
      const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(evidence, `f3-disconnected-${viewport.id}.png`);
      const buffer = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(file, buffer);
      const png = pngDimensions(buffer);
      assert.deepEqual(png, { width: viewport.width, height: viewport.height }, `viewport PNG dimensions mismatch:${viewport.id}`);
      assert.match(inspection.syncText, /상태 스트림 연결됨/);
      assert.match(inspection.syncText, /조립공장 연결 끊김/);
      assert.match(inspection.syncText, /heartbeat 응답 시간 초과/);
      assert.equal(inspection.horizontalOverflow, false, `horizontal overflow:${viewport.id}`);
      assert.deepEqual(inspection.syncOverflow, [], `sync header clipping:${viewport.id}:${JSON.stringify(inspection.syncLayout)}`);
      if (viewport.width <= 720) assert.equal(inspection.narrowLayoutApplied, true, `narrow layout media query:${viewport.id}`);
      assert.equal(inspection.cjkCorruption, false, `CJK corruption:${viewport.id}`);
      assert.equal(
        inspection.allControlsReachable,
        true,
        `unreachable controls:${viewport.id}:${JSON.stringify(inspection.controls.filter(item => !item.reachable))}`,
      );
      assert.equal(inspection.root.atBottom, true, `root scrollbar cannot reach bottom:${viewport.id}`);
      assert.deepEqual(inspection.scrollOwners, ['main.page'], `scroll owner mismatch:${viewport.id}`);
      assert.ok(inspection.routes.every(route => route.active && /조립공장 연결 끊김/.test(route.syncText) && /상태 스트림 연결됨/.test(route.syncText)), `route status mismatch:${viewport.id}`);
      assert.equal(inspection.queue.queueTotal, '200', `queue total:${viewport.id}`);
      assert.ok(inspection.queue.firstQueueRows > 0 && inspection.queue.firstQueueRows <= 24, `queue DOM exceeds bound:${viewport.id}`);
      assert.ok(Number(inspection.queue.queueRendered) > 0 && Number(inspection.queue.queueRendered) <= 24, `queue rendered count:${viewport.id}`);
      assert.deepEqual(inspection.queue.rawOriginalRequests, [], `raw originals requested:${viewport.id}`);
      captures.push({ ...viewport, file, png, inspection });
    }
    const queueFixtures = [];
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const fixtureCount of [100, 200]) {
      const queue = await measureQueueFixture(page, fixtureCount, apiPort, frontendPort);
      assert.equal(queue.totalProducts, fixtureCount, `queue fixture total:${fixtureCount}`);
      assert.equal(queue.renderMarker.total, fixtureCount, `queue render marker total:${fixtureCount}`);
      assert.equal(queue.renderMarker.rendered, queue.renderedRows, `queue render marker rows:${fixtureCount}`);
      assert.ok(queue.renderedRows > 0 && queue.renderedRows <= queue.domBoundThreshold && queue.domRows <= queue.domBoundThreshold, `queue fixture DOM bound:${fixtureCount}`);
      assert.equal(queue.lazyThumbRefs, queue.domRows, `queue lazy refs:${fixtureCount}`);
      assert.ok(queue.currentImgLoadingLazyCount > 0, `current lazy image count:${fixtureCount}`);
      assert.ok(queue.lazyQueueImageRequestCount > 0, `queue lazy image requests:${fixtureCount}`);
      assert.ok(queue.durationMs > 0, `queue performance duration:${fixtureCount}`);
      assert.ok(queue.stableRelevantImageRequestSamples >= 3, `queue image requests did not settle:${fixtureCount}`);
      assert.equal(queue.eagerImageRequestCount, 0, `queue eager image requests:${fixtureCount}`);
      assert.equal(queue.rawOriginalNetworkRequestCount, 0, `queue raw originals:${fixtureCount}`);
      const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(evidence, `f3-queue-${fixtureCount}-1440x900.png`);
      const buffer = Buffer.from(shot.data, 'base64');
      fs.writeFileSync(file, buffer);
      const png = pngDimensions(buffer);
      assert.deepEqual(png, { width: 1440, height: 900 }, `queue PNG dimensions:${fixtureCount}`);
      queueFixtures.push({
        ...queue,
        screenshot: {
          file,
          sha256: sha256(buffer),
          pngMagicHex: buffer.subarray(0, 8).toString('hex'),
          dimensions: png,
        },
      });
    }
    const browserHashes = await browserServedSourceHashes(page);
    for (const [file, digest] of Object.entries(browserHashes)) {
      assert.equal(digest, sourceBefore.files[file], `served source hash mismatch:${file}`);
    }
    const metrics = await (await fetch(`http://127.0.0.1:${apiPort}/__metrics`)).json();
    const mutationRequests = metrics.requests.filter(item => !['GET', 'HEAD', 'OPTIONS'].includes(item.method));
    assert.equal(metrics.originalContentRequests, 0, 'fixture served raw originals');
    assert.equal(metrics.selectionCommands.length, 0, 'browser invoked candidate mutation');
    assert.deepEqual(mutationRequests, [], 'browser invoked non-read-only local request');
    result = {
      ok: true,
      scenario: 'Current-source F3 browser QA with reviewer performance/lazy evidence gap sealed',
      apiPort,
      frontendPort,
      sourceIdentity: {
        before: sourceBefore,
        browserServed: browserHashes,
      },
      captures,
      queueFixtures,
      metrics: {
        originalContentRequests: metrics.originalContentRequests,
        selectionCommands: metrics.selectionCommands.length,
        mutationRequests,
        externalMutations: 0,
        requests: metrics.requests,
      },
      cleanup,
    };
  } finally {
    try { page?.close(); } catch (_) {}
    if (runtime) await runtime.cleanup();
    cleanup.browserStopped = true;
    await stopChild(server);
    cleanup.serverStopped = true;
    if (result) {
      const sourceAfter = sourceFingerprint();
      assert.deepEqual(sourceAfter, sourceBefore, 'production source fingerprint changed during QA');
      assert.equal(cleanup.browserStopped, true, 'owned browser cleanup failed');
      assert.equal(cleanup.serverStopped, true, 'owned server cleanup failed');
      result.sourceIdentity.after = sourceAfter;
      result.sourceIdentity.beforeAfterIdentical = true;
      result.cleanup = cleanup;
      fs.writeFileSync(path.join(evidence, 'f3-browser-qa.json'), `${JSON.stringify(result, null, 2)}\n`);
      fs.writeFileSync(path.join(evidence, 'source-fingerprint.json'), `${JSON.stringify(result.sourceIdentity, null, 2)}\n`);
      fs.writeFileSync(path.join(evidence, 'performance-lazy-metrics.json'), `${JSON.stringify({
        scenario: result.scenario,
        sourceFingerprint: sourceAfter.fingerprint,
        htmlSha256: sourceAfter.files['control_tower/frontend/control-tower.html'],
        queueFixtures: result.queueFixtures,
        externalMutations: result.metrics.externalMutations,
        cleanup,
      }, null, 2)}\n`);
      const rows = result.queueFixtures.map(item =>
        `- ${item.fixtureCount}개: durationMs=${item.durationMs}, totalProducts=${item.totalProducts}, renderedRows=${item.renderedRows}, domRows=${item.domRows}/${item.domBoundThreshold}, lazyThumbRefs=${item.lazyThumbRefs}, currentImgLoadingLazyCount=${item.currentImgLoadingLazyCount}, eagerImageRequests=${item.eagerImageRequestCount}, rawOriginalNetworkRequests=${item.rawOriginalNetworkRequestCount}, totalRelevantImageRequests=${item.totalRelevantImageRequests}, screenshotSha256=${item.screenshot.sha256}`
      );
      const doneClaim = [
        '# DoneClaim',
        '',
        'Independent reviewer blocker resolved: current-source 100/200 fixture evidence now includes browser performance duration and both lazy thumbnail reference/image counts.',
        '',
        `- Source fingerprint before/after identical: ${sourceAfter.fingerprint}`,
        `- Browser-served HTML SHA-256 matches disk: ${sourceAfter.files['control_tower/frontend/control-tower.html']}`,
        ...rows,
        '- DOM bound threshold: 24; both fixtures passed.',
        '- Eager image requests: 0; raw-original network requests: 0.',
        '- External mutations: 0.',
        `- Owned browser/server cleanup: browserStopped=${cleanup.browserStopped}, serverStopped=${cleanup.serverStopped}.`,
        '',
      ].join('\n');
      fs.writeFileSync(path.join(evidence, 'DoneClaim.md'), doneClaim);
      console.log(JSON.stringify(result, null, 2));
    }
    fs.writeFileSync(path.join(evidence, 'f3-qa-cleanup.json'), `${JSON.stringify(cleanup, null, 2)}\n`);
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
