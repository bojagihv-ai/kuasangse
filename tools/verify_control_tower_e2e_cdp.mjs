import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { connectCdp, ensureCdp, evaluate, waitFor } = require('./factory_cdp_test_utils.cjs');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const python = join(root, 'backend', 'venv311', 'Scripts', 'python.exe');
const parseArgs = () => {
  const values = process.argv.slice(2);
  return Object.fromEntries(values.filter(value => value.startsWith('--')).map(value => {
    const index = values.indexOf(value);
    return [value.slice(2), values[index + 1]?.startsWith('--') || values[index + 1] === undefined ? true : values[index + 1]];
  }));
};
const args = parseArgs();
const fixturePath = resolve(root, String(args.fixture || 'control_tower/fixtures/two-product-mixed-manual/manifest.json'));
const evidence = resolve(root, String(args.evidence || '.omo/evidence/batch-production-control-tower/task-15/final-f3'));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const driverPath = fileURLToPath(import.meta.url);
const fail = message => { throw new Error(message); };
const checkFixture = value => {
  const products = Array.isArray(value.products) ? value.products : [];
  if (value.schema !== 'control-tower-two-product-mixed-manual:v1' || value.externalWrite !== false || products.length !== 2) fail('fixture_invalid');
  const summary = products.map(product => ({ productId: product.productId, representative: product.policy?.representative }));
  if (JSON.stringify(summary) !== JSON.stringify([{ productId: 'task15-product-a', representative: 'manual' }, { productId: 'task15-product-b', representative: 'auto' }])) fail('fixture_product_policy_invalid');
  const contract = value.evidence || {};
  return {
    products: summary,
    externalWrite: false,
    workerAuthority: contract.workerAuthority,
    staleIdentityFields: contract.staleIdentityFields,
    strictIdentityFields: contract.strictIdentityFields,
    browserControlAudit: contract.browserControlAudit,
  };
};
if (args['inspect-fixture']) {
  process.stdout.write(`${JSON.stringify(checkFixture(fixture))}\n`);
  process.exit(0);
}

const listen = server => new Promise(resolveListen => server.listen(0, '127.0.0.1', () => resolveListen(server.address().port)));
const stop = target => new Promise(resolveStop => target?.close?.(() => resolveStop()));
const json = async request => new Promise(resolveBody => { let raw = ''; request.on('data', part => { raw += part; }); request.on('end', () => { try { resolveBody(raw ? JSON.parse(raw) : {}); } catch { resolveBody({}); } }); });
const reply = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(body)); };
const identity = product => ({ productId: product.productId, productKey: product.productKey, runId: product.runId, inputFingerprint: product.inputFingerprint, revision: product.revision });
const authorityJob = (product, checkpoint) => ({
  ...identity(product),
  orderId: `task15-order-${product.productId}`,
  status: 'queued',
  checkpoint,
  eventSequence: 0,
  checkpointIdentity: structuredClone(product.checkpointIdentity),
});

const initialAuthorityState = manifest => {
  const [a, b] = manifest.products;
  return {
    schema: 'task15-durable-authority:v1',
    jobs: {
      [a.productId]: authorityJob(a, 'representative'),
      [b.productId]: authorityJob(b, 'cafe24_staging'),
    },
    active: '',
    reviewVersion: 7,
    decisions: [],
    writes: 0,
  };
};

function fixtureService(manifest, statePath, eventLogPath) {
  const [a] = manifest.products;
  const loadedFromDisk = existsSync(statePath);
  const state = loadedFromDisk
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : initialAuthorityState(manifest);
  const authorityInstanceId = `${process.pid}:${Date.now()}`;
  const persist = () => writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  if (!loadedFromDisk) persist();
  const choose = () => Object.values(state.jobs)
    .find(job => job.status === 'queued' && (!state.active || state.active === job.productId));
  const handler = async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const payload = await json(request);
    const event = {
      surface: 'durable-authority',
      authorityInstanceId,
      authorityPid: process.pid,
      method: request.method,
      path: url.pathname,
      status: 0,
      body: payload,
    };
    const send = (status, body) => {
      event.status = status;
      event.response = body;
      appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`);
      reply(response, status, body);
    };
    if (url.pathname === '/__task15/state') {
      return send(200, {
        state,
        authorityInstanceId,
        authorityPid: process.pid,
        loadedFromDisk,
        durableStatePath: statePath,
      });
    }
    if (url.pathname === '/api/playbooks/gpt-oauth/status') return send(200, { connectorId: 'chatgpt_login_oauth', authMode: 'chatgpt', chatGptLoginReady: true });
    if (url.pathname === '/api/llm/options') return send(200, { latestModel: 'gpt-5.6-sol', modelOptions: [{ id: 'gpt-5.6-sol' }], reasoningOptions: [{ id: 'medium' }], serviceTierOptions: [{ id: 'standard' }] });
    if (url.pathname.endsWith('/capabilities')) return send(200, { capabilityVersion: 'fixture:v1' });
    if (url.pathname.endsWith('/jobs')) return send(200, { items: Object.values(state.jobs) });
    if (url.pathname.endsWith('/reviews')) return send(200, { items: state.jobs[a.productId].status === 'waiting_manual' ? [{ reviewId: '00000000-0000-4000-8000-000000000015', productId: a.productId, status: 'waiting_manual', version: state.reviewVersion }] : [] });
    if (url.pathname.endsWith('/work-bundles')) return send(200, { items: [], nextCursor: '' });
    if (url.pathname.endsWith('/products')) return send(200, { items: [] });
    if (url.pathname.endsWith('/workers/claim') && request.method === 'POST') {
      const job = choose();
      if (!job) return send(200, { order: null });
      state.active = job.productId;
      persist();
      return send(200, { order: { orderId: job.orderId, ...identity(job), imageIdentity: job.checkpointIdentity.imageIdentity, stageId: job.checkpoint, contractVersion: 'control-work-order:v1', capabilityVersion: 'batch-control-worker:v1' } });
    }
    const worker = url.pathname.match(/\/workers\/(task15-order-(task15-product-[ab]))\/(ack|events|complete)$/);
    if (worker && request.method === 'POST') {
      const job = state.jobs[worker[2]];
      if (payload.runId !== job.runId) return send(409, { error: { code: 'stale_run_fingerprint', field: 'runId' } });
      if (payload.inputFingerprint !== job.inputFingerprint) return send(409, { error: { code: 'stale_run_fingerprint', field: 'inputFingerprint' } });
      for (const field of ['productId', 'productKey', 'orderId', 'revision']) {
        if (payload[field] !== job[field]) {
          return send(409, { error: { code: 'stale_run_fingerprint', reason: 'identity_mismatch', field } });
        }
      }
      const expectedImage = job.checkpointIdentity.imageIdentity;
      const imageMatches = image => [
        'candidateId',
        'imageId',
        'productId',
        'productKey',
        'revision',
        'digest',
      ].every(field => image?.[field] === expectedImage[field]);
      for (const image of [payload.imageIdentity, payload.result?.imageIdentity]) {
        if (image !== undefined && !imageMatches(image)) {
          return send(409, { error: { code: 'stale_run_fingerprint', reason: 'identity_mismatch', field: 'imageIdentity' } });
        }
      }
      if (Number(payload.eventSequence) <= job.eventSequence) return send(409, { error: { code: 'stale_event_sequence', field: 'eventSequence' } });
      job.eventSequence = Number(payload.eventSequence);
      if (worker[3] === 'complete') {
        const status = payload.result?.status;
        if (status === 'waiting_manual') {
          job.status = 'waiting_manual';
          job.checkpoint = 'representative';
          state.active = '';
        }
        if (status === 'staged_verified') {
          job.status = 'staged_verified';
          job.checkpoint = 'terminal';
          job.receipt = payload.result?.receipt || {};
          state.active = '';
        }
      }
      persist();
      return send(200, { accepted: true, status: job.status, checkpoint: job.checkpoint, eventSequence: job.eventSequence });
    }
    if (url.pathname.endsWith('/reviews/00000000-0000-4000-8000-000000000015/decision') && request.method === 'POST') {
      if (request.headers['if-match'] !== String(state.reviewVersion)) return send(409, { error: { code: 'stale_version', field: 'revision' } });
      const job = state.jobs[a.productId];
      job.status = 'queued';
      job.checkpoint = 'representative';
      state.decisions.push({ receiptId: 'task15-manual-decision-a', status: 'selected', selectedCandidateId: 'a-representative-1' });
      state.reviewVersion += 1;
      persist();
      return send(200, { reviewId: '00000000-0000-4000-8000-000000000015', status: 'selected', version: state.reviewVersion, decisionReceipt: state.decisions.at(-1) });
    }
    if (url.pathname.includes('/publish') || url.pathname.includes('/publications')) {
      state.writes += 1;
      persist();
      return send(405, { error: { code: 'external_write_forbidden' } });
    }
    return send(200, { items: [], status: 'fixture_ok' });
  };
  return createServer((request, response) => void handler(request, response));
}

function frontendServer() {
  const base = join(root, 'control_tower', 'frontend');
  return createServer((request, response) => {
    const file = resolve(base, new URL(request.url, 'http://127.0.0.1').pathname === '/' ? 'control-tower.html' : `.${new URL(request.url, 'http://127.0.0.1').pathname}`);
    if (!file.startsWith(base) || !existsSync(file)) { response.writeHead(404); return response.end('not found'); }
    response.writeHead(200, { 'Content-Type': file.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(readFileSync(file));
  });
}

function startBff(port, frontPort, remotePort, label) {
  const env = { ...process.env, PYTHONPATH: root, CONTROL_TOWER_BACKEND_PORT: String(port), CONTROL_TOWER_FRONTEND_PORT: String(frontPort), CONTROL_TOWER_CORS_ORIGINS: `http://127.0.0.1:${frontPort}`, PDP_CONTROL_BASE_URL: `http://127.0.0.1:${remotePort}/api/pdp-control/v1`, PDP_ASSETS_BASE_URL: `http://127.0.0.1:${remotePort}/api/pdp-assets/v1`, PDP_CONTROL_SERVICE_KEY: 'task15-fixture-only', CONTROL_TOWER_API_HUB_URL: `http://127.0.0.1:${remotePort}`, CONTROL_TOWER_CACHE_ROOT: join(evidence, `runtime-${label}`) };
  const child = spawn(python, ['-m', 'control_tower.backend.app'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = []; child.stdout.on('data', part => output.push(String(part))); child.stderr.on('data', part => output.push(String(part)));
  return { child, output };
}
function startAuthority(port, statePath, eventLogPath) {
  const child = spawn(process.execPath, [
    driverPath,
    '--authority',
    '--authority-port',
    String(port),
    '--state',
    statePath,
    '--events',
    eventLogPath,
    '--fixture',
    fixturePath,
    '--evidence',
    evidence,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', part => output.push(String(part)));
  child.stderr.on('data', part => output.push(String(part)));
  return { child, output };
}

const stopChild = child => new Promise(resolveStop => {
  if (!child || child.exitCode !== null) {
    resolveStop();
    return;
  }
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  child.once('exit', () => {
    clearTimeout(timer);
    resolveStop();
  });
  child.kill('SIGTERM');
});

const waitHealth = async port => {
  for (let index = 0; index < 100; index += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  fail('bff_health_timeout');
};
const api = async (base, path, options = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.code || `HTTP_${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
};
const sessionHeaders = async base => { const session = await api(base, '/api/session'); return { 'Content-Type': 'application/json', 'X-Control-Tower-CSRF': session.csrfToken, 'X-Control-Tower-Session': session.sessionId }; };
const lifecycle = (base, headers, order, action, workerId, eventSequence, result = {}) => api(base, `/api/worker/${order.orderId}/${action}`, { method: 'POST', headers, body: JSON.stringify({ ...order, workerId, accepted: true, eventSequence, result }) });
const pickPort = async () => { const server = createServer(); const port = await listen(server); await stop(server); return port; };

const claim = (base, headers, workerId) => api(base, '/api/worker/claim', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    workerId,
    contractVersion: 'control-work-order:v1',
    capabilityVersion: 'batch-control-worker:v1',
  }),
});

async function workerPhase(spec) {
  const { base, headers, phase } = spec;
  if (phase === 'before-restart') {
    const orderA = (await claim(base, headers, 'task15-worker-before-restart')).order;
    await lifecycle(base, headers, orderA, 'ack', 'task15-worker-before-restart', 1);
    await lifecycle(base, headers, orderA, 'events', 'task15-worker-before-restart', 2, {
      status: 'waiting_manual',
      decisionReceipt: { receiptId: 'task15-manual-required-a' },
    });
    const aComplete = await lifecycle(base, headers, orderA, 'complete', 'task15-worker-before-restart', 3, {
      status: 'waiting_manual',
      checkpoint: 'representative',
    });
    const orderB = (await claim(base, headers, 'task15-worker-before-restart')).order;
    await lifecycle(base, headers, orderB, 'ack', 'task15-worker-before-restart', 1);
    const bProgress = await lifecycle(base, headers, orderB, 'events', 'task15-worker-before-restart', 2, {
      status: 'completed',
      checkpoint: 'cafe24_staging',
      decisionReceipt: { receiptId: 'task15-auto-b' },
    });
    return { phase, orderA, orderB, aComplete, bProgress };
  }
  if (phase === 'after-restart') {
    const orderB = (await claim(base, headers, 'task15-worker-after-restart')).order;
    const bProgress = await lifecycle(base, headers, orderB, 'events', 'task15-worker-after-restart', 3, {
      status: 'completed',
      checkpoint: 'cafe24_staging',
    });
    const bComplete = await lifecycle(base, headers, orderB, 'complete', 'task15-worker-after-restart', 4, {
      status: 'staged_verified',
      receipt: {
        receiptId: 'task15-staged-b',
        externalWrite: false,
        decisionReceipt: 'task15-auto-b',
      },
    });
    return { phase, orderB, bProgress, bComplete };
  }
  if (phase === 'resume-a') {
    const orderA = (await claim(base, headers, 'task15-worker-a-resumed')).order;
    await lifecycle(base, headers, orderA, 'ack', 'task15-worker-a-resumed', 4);
    const aComplete = await lifecycle(base, headers, orderA, 'complete', 'task15-worker-a-resumed', 5, {
      status: 'staged_verified',
      receipt: {
        receiptId: 'task15-staged-a',
        externalWrite: false,
        decisionReceipt: spec.decisionReceipt,
      },
    });
    return { phase, orderA, aComplete };
  }
  fail(`unknown_worker_phase:${phase}`);
}

async function runWorkerProcess(spec) {
  const child = spawn(process.execPath, [
    driverPath,
    '--worker',
    '--fixture',
    fixturePath,
    '--evidence',
    evidence,
  ], {
    cwd: root,
    env: { ...process.env, TASK15_WORKER_SPEC: JSON.stringify(spec) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pid = child.pid;
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', part => { stdout += String(part); });
  child.stderr.on('data', part => { stderr += String(part); });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectExit(new Error(`worker_timeout:${spec.phase}`));
    }, 30_000);
    child.once('exit', code => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
  if (exitCode !== 0) fail(`worker_failed:${spec.phase}:${stderr || stdout}`);
  const lines = stdout.trim().split(/\r?\n/);
  return { pid, exitCode, ...JSON.parse(lines.at(-1)) };
}

async function authorityMode() {
  const port = Number(args['authority-port']);
  const statePath = resolve(String(args.state));
  const eventLogPath = resolve(String(args.events));
  const server = fixtureService(fixture, statePath, eventLogPath);
  await new Promise(resolveListen => server.listen(port, '127.0.0.1', resolveListen));
  process.stdout.write(`${JSON.stringify({ ready: true, authorityPid: process.pid, port })}\n`);
  await new Promise(resolveShutdown => {
    const shutdown = () => server.close(resolveShutdown);
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });
}

async function browserProof(frontPort, bffPort, remotePort) {
  const cdpPort = await pickPort();
  const cdp = await ensureCdp(`http://127.0.0.1:${cdpPort}`);
  const target = cdp.targets.find(item => item.type === 'page');
  const page = connectCdp(target.webSocketDebuggerUrl);
  await page.opened;
  await page.send('Page.enable');
  const captures = [];
  try {
    for (const [name, width, height] of [['desktop.png', 1440, 900], ['small-height.png', 1024, 600]]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await page.send('Page.navigate', { url: `http://127.0.0.1:${frontPort}/control-tower.html?apiBase=http://127.0.0.1:${bffPort}&apiHub=http://127.0.0.1:${remotePort}&fixtureCount=2` });
      await waitFor(page, "document.querySelector('main.page') && document.getElementById('app')?.dataset.state === 'ready'", 20_000);
      const metrics = await evaluate(page, `(async () => {
        const root = document.querySelector('main.page');
        const selector = [
          'button',
          'input',
          'select',
          'textarea',
          'a[href]',
          'label[for]',
          'summary',
          '[role="button"]',
          '[role="tab"]',
          '[role="checkbox"]',
          '[contenteditable="true"]'
        ].join(',');
        const records = [];
        const menuCoverage = [];
        const seen = new Set();
        let serial = 0;
        const frame = () => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
        const rendered = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return element.getClientRects().length > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity) !== 0
            && rect.width > 1
            && rect.height > 1
            && !element.closest('[hidden]');
        };
        const visibleInRoot = element => {
          const rect = element.getBoundingClientRect();
          const rootRect = root.getBoundingClientRect();
          return rect.bottom > rootRect.top
            && rect.top < rootRect.bottom
            && rect.right > rootRect.left
            && rect.left < rootRect.right
            && rect.left >= rootRect.left - 1
            && rect.right <= rootRect.right + 1;
        };
        const keyFor = element => {
          const action = String(element.dataset.action || '').trim();
          if (action) {
            const selector = '[data-action="' + CSS.escape(action) + '"]';
            if (document.querySelectorAll(selector).length === 1) return selector;
          }
          if (!element.dataset.task15QaId) {
            serial += 1;
            element.dataset.task15QaId = String(serial);
          }
          return element.id ? '#' + element.id : '[data-task15-qa-id="' + element.dataset.task15QaId + '"]';
        };
        const labelFor = element => String(
          element.getAttribute('aria-label')
          || element.labels?.[0]?.innerText
          || element.innerText
          || element.getAttribute('name')
          || element.getAttribute('title')
          || element.value
          || ''
        ).trim().replace(/\\s+/g, ' ').slice(0, 120);
        const auditRenderedControls = async menuKey => {
          const controls = [...document.querySelectorAll(selector)].filter(rendered);
          for (const initialElement of controls) {
            let element = initialElement;
            const key = keyFor(element);
            if (seen.has(key)) continue;
            seen.add(key);
            const initiallyVisible = visibleInRoot(element);
            const rootScrollBefore = root.scrollTop;
            if (!initiallyVisible) {
              const rect = element.getBoundingClientRect();
              const rootRect = root.getBoundingClientRect();
              const target = root.scrollTop + rect.top - rootRect.top - Math.max(0, (root.clientHeight - rect.height) / 2);
              root.scrollTop = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, target));
              await frame();
              if (!element.isConnected) {
                element = document.querySelector(key) || element;
              }
            }
            const bounds = element.getBoundingClientRect();
            const reachable = visibleInRoot(element);
            records.push({
              key,
              menuKey,
              tag: element.tagName.toLowerCase(),
              type: element.getAttribute('type') || '',
              label: labelFor(element),
              disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
              initiallyVisible,
              reachable,
              rootScrollBefore,
              rootScrollAfter: root.scrollTop,
              bounds: {
                top: Math.round(bounds.top),
                right: Math.round(bounds.right),
                bottom: Math.round(bounds.bottom),
                left: Math.round(bounds.left)
              }
            });
          }
        };
        await auditRenderedControls('initial');
        const tabs = [...document.querySelectorAll('#primary-menu [role="tab"][data-menu-key]')];
        for (const tab of tabs) {
          const menuKey = tab.dataset.menuKey;
          tab.click();
          await frame();
          const panel = document.querySelector('[role="tabpanel"][data-menu-panel="' + menuKey + '"]');
          menuCoverage.push({
            menuKey,
            tabId: tab.id,
            panelId: panel?.id || '',
            activated: tab.getAttribute('aria-selected') === 'true' && Boolean(panel) && panel.hidden === false
          });
          await auditRenderedControls(menuKey);
        }
        const allDomControls = [...document.querySelectorAll(selector)];
        const nonRenderedControls = allDomControls
          .filter(element => !seen.has(keyFor(element)))
          .map(element => ({
            key: keyFor(element),
            tag: element.tagName.toLowerCase(),
            label: labelFor(element),
            excludedReason: 'not-rendered-in-any-menu-state'
          }));
        const inventoryKeys = new Set([
          ...records.map(item => item.key),
          ...nonRenderedControls.map(item => item.key)
        ]);
        const auditTab = document.getElementById('menu-tab-audit-sync');
        auditTab?.click();
        await frame();
        root.scrollTop = root.scrollHeight;
        await frame();
        const rootRect = root.getBoundingClientRect();
        const rootScrollbarWidth = root.offsetWidth - root.clientWidth;
        return {
          title: document.title,
          rootOverflowY: getComputedStyle(root).overflowY,
          rootRightEdge: Math.round(rootRect.right),
          rootScrollbarWidth,
          rootScrollbarRightEdge: Math.round(rootRect.right + rootScrollbarWidth),
          viewportRightEdge: innerWidth,
          rootScrollbarAtRight: Math.abs(rootRect.right + rootScrollbarWidth - innerWidth) <= 1,
          scrollHeight: root.scrollHeight,
          clientHeight: root.clientHeight,
          scrollTop: root.scrollTop,
          hasScrollbar: root.scrollHeight > root.clientHeight,
          auditVisible: Boolean(document.getElementById('audit-list')),
          menuCoverage,
          everyMenuActivated: menuCoverage.every(item => item.activated),
          controls: records,
          domControlCount: allDomControls.length,
          renderedControlCount: records.length,
          nonRenderedControls,
          nonRenderedControlCount: nonRenderedControls.length,
          interactiveControlInventoryComplete: allDomControls
            .every(element => inventoryKeys.has(keyFor(element))),
          allRenderedControlsReachable: records.length > 0 && records.every(item => item.reachable)
        };
      })()`);
      const image = await page.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(evidence, name), Buffer.from(image.data, 'base64'));
      captures.push({ name, width, height, ...metrics });
    }
    return captures;
  } finally {
    await page.close();
    await cdp.cleanup();
  }
}

async function run() {
  const manifest = checkFixture(fixture);
  mkdirSync(evidence, { recursive: true });
  const statePath = join(evidence, 'authority-state.json');
  const eventLogPath = join(evidence, 'events.jsonl');
  writeFileSync(statePath, `${JSON.stringify(initialAuthorityState(fixture), null, 2)}\n`);
  writeFileSync(eventLogPath, '');
  const authorityPort = await pickPort();
  const front = frontendServer();
  const frontPort = await listen(front);
  const bffPort = await pickPort();
  const taskOwnedPorts = [authorityPort, frontPort, bffPort];
  let authority = startAuthority(authorityPort, statePath, eventLogPath);
  let bff = startBff(bffPort, frontPort, authorityPort, 'one');
  const waitAuthority = async () => {
    for (let index = 0; index < 100; index += 1) {
      try {
        return await api(`http://127.0.0.1:${authorityPort}`, '/__task15/state');
      } catch (error) {
        if (!(error instanceof Error)) throw error;
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    fail('authority_health_timeout');
  };
  try {
    const authorityBeforeWork = await waitAuthority();
    await waitHealth(bffPort);
    const base = `http://127.0.0.1:${bffPort}`;
    const headers = await sessionHeaders(base);
    const [a, b] = fixture.products;
    const projection = {
      schema: 'factory-control-projection:v1',
      capabilityVersion: 'factory-control-command:v1',
      cursor: '15',
      sequence: 15,
      connected: true,
      session: {
        productId: a.productId,
        productKey: a.productKey,
        runId: a.runId,
        inputFingerprint: a.inputFingerprint,
        revision: a.revision,
      },
      inputs: [],
      stages: [],
      progress: {
        stageKey: 'representative',
        percent: 42,
        mode: 'manual',
        status: 'waiting_manual',
      },
      registration: { status: 'blocked', blockers: ['representative'] },
    };
    await api(base, '/api/factory/sync', {
      method: 'POST',
      headers,
      body: JSON.stringify({ projection }),
    });
    const workerBefore = await runWorkerProcess({
      phase: 'before-restart',
      base,
      headers,
    });
    const beforeAuthoritySnapshot = await api(
      `http://127.0.0.1:${authorityPort}`,
      '/__task15/state',
    );
    const beforeRestart = structuredClone(beforeAuthoritySnapshot.state.jobs[b.productId]);
    const firstAuthorityPid = authority.child.pid;
    const firstBffPid = bff.child.pid;

    await stopChild(bff.child);
    await stopChild(authority.child);

    authority = startAuthority(authorityPort, statePath, eventLogPath);
    const recoveredAuthoritySnapshot = await waitAuthority();
    bff = startBff(bffPort, frontPort, authorityPort, 'two');
    await waitHealth(bffPort);
    const recoveredBase = `http://127.0.0.1:${bffPort}`;
    const recoveredHeaders = await sessionHeaders(recoveredBase);
    const recovered = structuredClone(recoveredAuthoritySnapshot.state.jobs[b.productId]);
    const workerAfter = await runWorkerProcess({
      phase: 'after-restart',
      base: recoveredBase,
      headers: recoveredHeaders,
    });

    const protectionSnapshot = () => {
      const stateBytes = readFileSync(statePath);
      const stateValue = JSON.parse(stateBytes.toString('utf8'));
      const jobs = Object.fromEntries(Object.entries(stateValue.jobs).map(([productId, job]) => [
        productId,
        {
          productId: job.productId,
          productKey: job.productKey,
          orderId: job.orderId,
          revision: job.revision,
          checkpoint: job.checkpoint,
          checkpointIdentity: job.checkpointIdentity,
        },
      ]));
      return {
        stateFileSha256: createHash('sha256').update(stateBytes).digest('hex'),
        protectedCanonicalSha256: createHash('sha256').update(JSON.stringify(jobs)).digest('hex'),
        jobs,
      };
    };
    const foreignIdentity = {};
    const captureForeignIdentity = async (name, mutatedField, eventSequence, mutation) => {
      const before = protectionSnapshot();
      const requestIdentity = {
        urlOrderId: workerAfter.orderB.orderId,
        runId: workerAfter.orderB.runId,
        inputFingerprint: workerAfter.orderB.inputFingerprint,
        eventSequence,
        mutation,
      };
      try {
        await api(recoveredBase, `/api/worker/${workerAfter.orderB.orderId}/events`, {
          method: 'POST',
          headers: recoveredHeaders,
          body: JSON.stringify({
            ...workerAfter.orderB,
            ...mutation,
            workerId: 'task15-worker-after-restart',
            eventSequence,
            result: { status: 'completed' },
          }),
        });
        foreignIdentity[name] = {
          requestIdentity,
          code: 'accepted',
          status: 200,
          mutatedField,
        };
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        foreignIdentity[name] = {
          requestIdentity,
          code: error.message,
          status: error.status,
          mutatedField,
          authorityReportedField: error.body?.error?.field || '',
        };
      }
      const after = protectionSnapshot();
      const authorityEvent = readFileSync(eventLogPath, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
        .at(-1);
      Object.assign(foreignIdentity[name], {
        stateFileByteExact: before.stateFileSha256 === after.stateFileSha256,
        protectedCanonicalExact: before.protectedCanonicalSha256 === after.protectedCanonicalSha256,
        authorityStatus: authorityEvent.status,
        authorityCode: authorityEvent.response?.error?.code || '',
        authorityReason: authorityEvent.response?.error?.reason || '',
        authorityReportedField: authorityEvent.response?.error?.field || '',
        before,
        after,
      });
    };
    await captureForeignIdentity('foreignProductId', 'productId', 5, {
      productId: a.productId,
    });
    await captureForeignIdentity('foreignProductKey', 'productKey', 6, {
      productKey: a.productKey,
    });
    await captureForeignIdentity('foreignOrderId', 'orderId', 7, {
      orderId: `task15-order-${a.productId}`,
    });
    await captureForeignIdentity('foreignRevision', 'revision', 8, {
      revision: a.revision,
    });
    await captureForeignIdentity('foreignImageIdentity', 'imageIdentity', 9, {
      imageIdentity: a.checkpointIdentity.imageIdentity,
    });

    const reviewPath = '/api/pdp/reviews/00000000-0000-4000-8000-000000000015/decision';
    const reviewBody = expectedVersion => JSON.stringify({
      idempotencyKey: `task15-review-a-${expectedVersion}`,
      expectedVersion,
      decision: 'approve',
      candidateId: 'a-representative-1',
    });
    const stale = {};
    const staleDetails = {};
    const captureStale = async (name, mutatedField, request) => {
      try {
        await request();
        stale[name] = 'accepted';
        staleDetails[name] = {
          code: 'accepted',
          status: 200,
          mutatedField,
          authorityReportedField: '',
        };
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        stale[name] = error.message;
        staleDetails[name] = {
          code: error.message,
          status: error.status,
          mutatedField,
          authorityReportedField: error.body?.error?.field || '',
        };
      }
    };
    await captureStale('staleRun', 'runId', () => api(
      recoveredBase,
      `/api/worker/${workerAfter.orderB.orderId}/events`,
      {
        method: 'POST',
        headers: recoveredHeaders,
        body: JSON.stringify({
          ...workerAfter.orderB,
          runId: 'task15-stale-run',
          workerId: 'task15-worker-after-restart',
          eventSequence: 5,
          result: { status: 'completed' },
        }),
      },
    ));
    await captureStale('staleFingerprint', 'inputFingerprint', () => api(
      recoveredBase,
      `/api/worker/${workerAfter.orderB.orderId}/events`,
      {
        method: 'POST',
        headers: recoveredHeaders,
        body: JSON.stringify({
          ...workerAfter.orderB,
          inputFingerprint: 'sha256:task15-stale-fingerprint',
          workerId: 'task15-worker-after-restart',
          eventSequence: 5,
          result: { status: 'completed' },
        }),
      },
    ));
    await captureStale(
      'staleEvent',
      'eventSequence',
      () => lifecycle(
        recoveredBase,
        recoveredHeaders,
        workerAfter.orderB,
        'events',
        'task15-worker-after-restart',
        1,
        { status: 'completed' },
      ),
    );
    await captureStale('staleRevision', 'revision', () => api(recoveredBase, reviewPath, {
      method: 'POST',
      headers: recoveredHeaders,
      body: reviewBody(1),
    }));

    const reviewVersion = (await api(
      `http://127.0.0.1:${authorityPort}`,
      '/__task15/state',
    )).state.reviewVersion;
    const resolved = await api(recoveredBase, reviewPath, {
      method: 'POST',
      headers: recoveredHeaders,
      body: reviewBody(reviewVersion),
    });
    const workerResume = await runWorkerProcess({
      phase: 'resume-a',
      base: recoveredBase,
      headers: recoveredHeaders,
      decisionReceipt: resolved.decisionReceipt.receiptId,
    });
    const finalAuthoritySnapshot = await api(
      `http://127.0.0.1:${authorityPort}`,
      '/__task15/state',
    );
    await api(recoveredBase, '/api/factory/sync', {
      method: 'POST',
      headers: recoveredHeaders,
      body: JSON.stringify({
        projection: {
          ...projection,
          cursor: '16',
          sequence: 16,
          progress: {
            stageKey: 'final_detail',
            percent: 100,
            mode: 'automatic',
            status: 'completed',
          },
          registration: {
            status: 'staged_verified',
            blockers: [],
          },
        },
      }),
    });
    const screenshots = await browserProof(frontPort, bffPort, authorityPort);
    const checkpointExact = JSON.stringify(beforeRestart) === JSON.stringify(recovered);
    const restartSummary = {
      beforeRestart,
      recovered,
      exact: checkpointExact,
      durableStatePath: statePath,
      authority: {
        beforePid: firstAuthorityPid,
        afterPid: authority.child.pid,
        pidsDiffer: firstAuthorityPid !== authority.child.pid,
        beforeInstanceId: beforeAuthoritySnapshot.authorityInstanceId,
        afterInstanceId: recoveredAuthoritySnapshot.authorityInstanceId,
        instancesDiffer: beforeAuthoritySnapshot.authorityInstanceId !== recoveredAuthoritySnapshot.authorityInstanceId,
        recoveredFromDisk: recoveredAuthoritySnapshot.loadedFromDisk === true,
      },
      bff: {
        beforePid: firstBffPid,
        afterPid: bff.child.pid,
        pidsDiffer: firstBffPid !== bff.child.pid,
      },
      worker: {
        beforePid: workerBefore.pid,
        afterPid: workerAfter.pid,
        pidsDiffer: workerBefore.pid !== workerAfter.pid,
        beforeExitCode: workerBefore.exitCode,
        afterExitCode: workerAfter.exitCode,
      },
    };
    restartSummary.freshProcessRecovery = restartSummary.exact
      && restartSummary.authority.pidsDiffer
      && restartSummary.authority.instancesDiffer
      && restartSummary.authority.recoveredFromDisk
      && restartSummary.bff.pidsDiffer
      && restartSummary.worker.pidsDiffer;
    const final = Object.fromEntries(Object.entries(finalAuthoritySnapshot.state.jobs)
      .map(([key, job]) => [key, {
        status: job.status,
        checkpoint: job.checkpoint,
        receipt: job.receipt || null,
      }]));
    const result = {
      schema: 'task15-mixed-batch-e2e:v2',
      fixture: manifest,
      authority: {
        port: authorityPort,
        durableStatePath: statePath,
        restarted: true,
      },
      bff: {
        port: bffPort,
        restarted: true,
        beforePid: firstBffPid,
        afterPid: bff.child.pid,
      },
      worker: {
        aReleased: workerBefore.aComplete.status === 'waiting_manual'
          && workerBefore.orderB.productId === b.productId,
        bResumedAfterRestart: workerAfter.orderB.productId === b.productId
          && workerAfter.bComplete.status === 'staged_verified',
        aResumedAfterManualDecision: workerResume.orderA.productId === a.productId
          && workerResume.aComplete.status === 'staged_verified',
        processes: {
          beforeRestart: { pid: workerBefore.pid, exitCode: workerBefore.exitCode },
          afterRestart: { pid: workerAfter.pid, exitCode: workerAfter.exitCode },
          resumeA: { pid: workerResume.pid, exitCode: workerResume.exitCode },
        },
      },
      checkpoints: restartSummary,
      final,
      decisionReceipts: finalAuthoritySnapshot.state.decisions,
      foreignIdentity,
      stale,
      staleDetails,
      screenshots,
      externalWriteCalls: finalAuthoritySnapshot.state.writes,
      initialAuthorityLoadedFromDisk: authorityBeforeWork.loadedFromDisk,
      gptOAuthLiveProof: '.omo/evidence/batch-production-control-tower/task-15/gpt-oauth-live-structured-20260730.json',
    };
    writeFileSync(join(evidence, 'attempt-result.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(evidence, 'identity-rejection-summary.json'), `${JSON.stringify(foreignIdentity, null, 2)}\n`);
    const expectedStale = {
      staleRun: 'stale_run_fingerprint',
      staleFingerprint: 'stale_run_fingerprint',
      staleEvent: 'stale_event_sequence',
      staleRevision: 'stale_version',
    };
    const browserPassed = screenshots.every(capture => (
      capture.hasScrollbar
      && capture.rootScrollbarAtRight
      && capture.everyMenuActivated
      && capture.interactiveControlInventoryComplete
      && capture.allRenderedControlsReachable
      && capture.renderedControlCount > 0
    ));
    const identityRejections = Object.values(foreignIdentity);
    const identityPassed = identityRejections.every(rejection => (
      rejection.code === 'stale_run_fingerprint'
      && rejection.status === 409
      && rejection.authorityStatus === 409
      && rejection.authorityCode === 'stale_run_fingerprint'
      && rejection.authorityReason === 'identity_mismatch'
      && rejection.mutatedField === rejection.authorityReportedField
      && rejection.requestIdentity.runId === b.runId
      && rejection.requestIdentity.inputFingerprint === b.inputFingerprint
      && rejection.requestIdentity.eventSequence > workerAfter.bComplete.eventSequence
      && Object.keys(rejection.requestIdentity.mutation).length === 1
      && Object.hasOwn(rejection.requestIdentity.mutation, rejection.mutatedField)
      && rejection.stateFileByteExact
      && rejection.protectedCanonicalExact
    )) && new Set(identityRejections.map(rejection => (
      rejection.requestIdentity.eventSequence
    ))).size === identityRejections.length;
    if (
      !restartSummary.freshProcessRecovery
      || !result.worker.aReleased
      || !result.worker.bResumedAfterRestart
      || !result.worker.aResumedAfterManualDecision
      || result.final[a.productId].status !== 'staged_verified'
      || result.final[b.productId].status !== 'staged_verified'
      || JSON.stringify(stale) !== JSON.stringify(expectedStale)
      || staleDetails.staleRun.mutatedField !== 'runId'
      || staleDetails.staleFingerprint.mutatedField !== 'inputFingerprint'
      || staleDetails.staleEvent.mutatedField !== 'eventSequence'
      || staleDetails.staleRevision.mutatedField !== 'revision'
      || !identityPassed
      || !browserPassed
      || result.externalWriteCalls !== 0
    ) fail('task15_assertion_failed');
    writeFileSync(join(evidence, 'e2e.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(join(evidence, 'restart-summary.json'), `${JSON.stringify(restartSummary, null, 2)}\n`);
    writeFileSync(join(evidence, 'stale-summary.json'), `${JSON.stringify({ stale, staleDetails }, null, 2)}\n`);
    writeFileSync(join(evidence, 'browser-manual-qa.json'), `${JSON.stringify(screenshots, null, 2)}\n`);
    writeFileSync(join(evidence, 'worker-processes.json'), `${JSON.stringify({
      beforeRestart: workerBefore,
      afterRestart: workerAfter,
      resumeA: workerResume,
    }, null, 2)}\n`);
    writeFileSync(join(evidence, 'backend-restart.log'), [
      `BFF before PID: ${firstBffPid}`,
      ...bff.output,
      `BFF after PID: ${bff.child.pid}`,
      ...authority.output,
    ].join('\n'));
    process.stdout.write(`${JSON.stringify({ ok: true, evidence })}\n`);
  } finally {
    await stopChild(bff.child);
    await stopChild(authority.child);
    await stop(front);
    const portsReleased = await Promise.all(taskOwnedPorts.map(async port => {
      try {
        await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1_000) });
        return false;
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        return true;
      }
    }));
    writeFileSync(join(evidence, 'cleanup.json'), `${JSON.stringify({
      ownedBffStopped: true,
      ownedFrontendStopped: true,
      ownedAuthorityStopped: true,
      taskOwnedPorts,
      portsReleased,
      sharedPortsUntouched: [5050, 5062, 8081, 8082, 4321, 8200, 8787],
    }, null, 2)}\n`);
    if (!portsReleased.every(Boolean)) fail('owned_port_cleanup_failed');
  }
}

async function main() {
  if (args.authority) {
    await authorityMode();
    return;
  }
  if (args.worker) {
    const spec = JSON.parse(String(process.env.TASK15_WORKER_SPEC || '{}'));
    const result = await workerPhase(spec);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  await run();
}

void main().catch(error => {
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'failure.log'), `${error.stack || error}\n`);
  console.error(error.stack || error);
  process.exitCode = 1;
});
