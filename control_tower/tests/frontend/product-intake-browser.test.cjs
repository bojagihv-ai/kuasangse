const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  connectCdp,
  ensureCdp,
  evaluate,
  waitFor,
} = require('../../../tools/factory_cdp_test_utils.cjs');

const QA_SERVER = path.resolve(__dirname, 'qa-production-workbench-server.cjs');
const API_PORT = 19262;
const FRONTEND_PORT = 19282;
const CDP_URL = 'http://127.0.0.1:19292';
const PAGE_URL = `http://127.0.0.1:${FRONTEND_PORT}/control-tower.html?apiBase=http://127.0.0.1:${API_PORT}&apiHub=http://127.0.0.1:${API_PORT}`;
const screenshotPath = process.env.CONTROL_TOWER_EVIDENCE_SCREENSHOT || '';

let server;
let serverOutput = '';
let browserRuntime;
let cdp;

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`QA server startup timed out: ${serverOutput}`)), 10_000);
    const onData = chunk => {
      serverOutput += chunk;
      if (!serverOutput.includes('"ready":true')) return;
      clearTimeout(timeout);
      server.stdout.off('data', onData);
      resolve();
    };
    server.stdout.on('data', onData);
    server.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function click(selector) {
  const box = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('missing selector: ' + ${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}

async function openPage() {
  await cdp.send('Page.navigate', { url: `${PAGE_URL}&cacheBust=${Date.now()}` });
  await waitFor(cdp, 'document.readyState === "complete" && !!document.querySelector("#product-search-button")');
  await waitFor(cdp, '!!document.querySelector("#menu-tab-input-source")');
  await click('#menu-tab-input-source');
  await waitFor(cdp, 'document.querySelector("#menu-tab-input-source")?.getAttribute("aria-selected") === "true" && !document.querySelector("#menu-panel-input-source")?.hidden');
}

async function search(query) {
  await click('#product-search');
  await evaluate(cdp, `(() => {
    const input = document.querySelector('#product-search');
    input.value = ${JSON.stringify(query)};
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(query)}, inputType: 'insertText' }));
  })()`);
  await click('#product-search-button');
}

async function browserErrors() {
  return evaluate(cdp, 'window.__productIntakeQaErrors || []');
}

async function captureScreenshot() {
  if (!screenshotPath) return;
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
}

test.before(async () => {
  server = spawn(process.execPath, [QA_SERVER], {
    env: { ...process.env, CONTROL_TOWER_QA_API_PORT: String(API_PORT), CONTROL_TOWER_QA_FRONTEND_PORT: String(FRONTEND_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', chunk => { serverOutput += chunk; });
  await waitForServer();
  browserRuntime = await ensureCdp(CDP_URL);
  const target = (browserRuntime.targets || []).find(item => item.type === 'page') || browserRuntime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('QA browser target is unavailable');
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__productIntakeQaErrors = [];
      window.addEventListener('error', event => window.__productIntakeQaErrors.push(String(event.message || event.error || 'error')));
      window.addEventListener('unhandledrejection', event => window.__productIntakeQaErrors.push(String(event.reason || 'unhandledrejection')));
      const nativeError = console.error.bind(console);
      console.error = (...args) => { window.__productIntakeQaErrors.push(args.map(String).join(' ')); nativeError(...args); };
    })();`,
  });
});

test.after(async () => {
  try {
    await cdp?.close();
  } finally {
    try {
      await browserRuntime?.cleanup();
    } finally {
      if (server && !server.killed) server.kill('SIGTERM');
    }
  }
});

test('Given five ledger candidates When 목구절 jcode 3 is clicked Then selection and readiness render without browser errors', async () => {
  await openPage();
  await search('목구절');
  await waitFor(cdp, 'document.querySelectorAll("#product-search-results .product-result").length === 5');
  await evaluate(cdp, `['publication-product-id', 'publication-product-key', 'publication-category', 'publication-target-status']
    .forEach(id => document.getElementById(id)?.remove())`);

  await click('#product-search-results .product-result:nth-of-type(3)');
  await waitFor(cdp, 'document.querySelector("#selected-product-summary")?.textContent?.includes("입력 준비 완료")');
  await captureScreenshot();

  const observed = await evaluate(cdp, `(() => ({
    candidates: document.querySelectorAll('#product-search-results .product-result').length,
    selected: document.querySelector('#selected-product-summary')?.textContent?.replace(/\\s+/g, ' ').trim(),
    status: document.querySelector('#intake-status')?.textContent?.trim(),
    errors: window.__productIntakeQaErrors || [],
  }))()`);
  assert.equal(observed.candidates, 5);
  assert.match(observed.selected, /목구절/);
  assert.match(observed.selected, /jcode\s*3/);
  assert.match(observed.selected, /입력 준비 완료/);
  assert.doesNotMatch(observed.status, /Cannot set properties|조회 실패/);
  assert.deepEqual(observed.errors, []);
});

test('Given an empty ledger search When search is submitted Then the no-candidate state is rendered', async () => {
  await openPage();
  await search('없음');
  await waitFor(cdp, 'document.querySelector("#product-search-results")?.textContent?.includes("검색 결과가 없습니다")');
  assert.equal(await evaluate(cdp, 'document.querySelectorAll("#product-search-results .product-result").length'), 0);
  assert.deepEqual(await browserErrors(), []);
});

test('Given a readiness 5xx When a candidate is clicked Then the selected product and readiness error summary remain visible', async () => {
  await openPage();
  await search('목구절');
  await waitFor(cdp, 'document.querySelectorAll("#product-search-results .product-result").length === 5');

  await click('#product-search-results .product-result:nth-of-type(5)');
  await waitFor(cdp, 'document.querySelector("#intake-status")?.textContent?.includes("readiness_unavailable")');

  const observed = await evaluate(cdp, `(() => ({
    selected: document.querySelector('#selected-product-summary')?.textContent?.replace(/\\s+/g, ' ').trim(),
    status: document.querySelector('#intake-status')?.textContent?.trim(),
    errors: window.__productIntakeQaErrors || [],
  }))()`);
  assert.match(observed.selected, /목구절/);
  assert.match(observed.selected, /jcode\s*5/);
  assert.match(observed.selected, /readiness_unavailable/);
  assert.doesNotMatch(observed.status, /Cannot set properties/);
  assert.deepEqual(observed.errors, []);
});

test('Given delayed readiness When candidates are clicked rapidly Then stale readiness cannot overwrite the latest selection', async () => {
  await openPage();
  await search('목구절');
  await waitFor(cdp, 'document.querySelectorAll("#product-search-results .product-result").length === 5');

  await click('#product-search-results .product-result:nth-of-type(3)');
  await click('#product-search-results .product-result:nth-of-type(4)');
  await waitFor(cdp, 'document.querySelector("#selected-product-summary")?.textContent?.includes("jcode4")');
  await new Promise(resolve => setTimeout(resolve, 300));

  const observed = await evaluate(cdp, 'document.querySelector("#selected-product-summary")?.textContent?.replace(/\\s+/g, " ").trim()');
  assert.match(observed, /jcode\s*4/);
  assert.doesNotMatch(observed, /jcode\s*3/);
  assert.deepEqual(await browserErrors(), []);
});

test('Given the optional status node is absent When a candidate is clicked Then readiness still renders without a page error', async () => {
  await openPage();
  await evaluate(cdp, 'document.querySelector("#intake-status")?.remove()');
  await search('목구절');
  await waitFor(cdp, 'document.querySelectorAll("#product-search-results .product-result").length === 5');

  await click('#product-search-results .product-result:nth-of-type(3)');
  await waitFor(cdp, 'document.querySelector("#selected-product-summary")?.textContent?.includes("입력 준비 완료")');
  assert.match(await evaluate(cdp, 'document.querySelector("#selected-product-summary")?.textContent || ""'), /jcode\s*3/);
  assert.deepEqual(await browserErrors(), []);
});

test('Given a 390x640 viewport When selection and later sections are inspected Then the main page scroll reaches both', async () => {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 640, deviceScaleFactor: 1, mobile: false });

  const observed = await evaluate(cdp, `(() => {
    document.querySelector('#selected-product-summary')?.scrollIntoView();
    const selectionVisible = document.querySelector('#selected-product-summary')?.getBoundingClientRect().top < innerHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const footerVisible = document.querySelector('footer')?.getBoundingClientRect().top < innerHeight;
    const secretMarkers = (document.body.innerText.match(/(?:qa-memory-only-token|authorization\\s*[:=]|bearer\\s+[a-z0-9._-]+)/gi) || []).length;
    return { selectionVisible, footerVisible, scrollTop: window.scrollY, scrollHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, secretMarkers };
  })()`);
  assert.equal(observed.selectionVisible, true);
  assert.equal(observed.footerVisible, true);
  assert.ok(observed.scrollTop > 0);
  assert.ok(observed.scrollHeight > observed.viewportHeight);
  assert.equal(observed.secretMarkers, 0);
  assert.deepEqual(await browserErrors(), []);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});
