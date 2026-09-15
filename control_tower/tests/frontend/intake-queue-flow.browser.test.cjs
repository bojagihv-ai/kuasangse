const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.resolve(__dirname, 'qa-production-workbench-server.cjs');

function waitForHttp(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(url, response => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else if (Date.now() < deadline) setTimeout(probe, 100);
        else reject(new Error(`qa_server_status_${response.statusCode}`));
      });
      request.on('error', error => {
        if (Date.now() < deadline) setTimeout(probe, 100);
        else reject(error);
      });
    };
    probe();
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

async function storedInputFingerprint(page) {
  return page.evaluate(async () => {
    const read = request => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await read(indexedDB.open('control-tower-bulk-intake', 1));
    const tx = db.transaction(['state', 'blobs'], 'readonly');
    const [state, keys, values] = await Promise.all([
      read(tx.objectStore('state').get('current')),
      read(tx.objectStore('blobs').getAllKeys()), read(tx.objectStore('blobs').getAll()),
    ]);
    db.close();
    const blobs = new Map(keys.map((key, index) => [key, values[index]]));
    return Promise.all(state.products.map(async product => ({
      name: product.productName, values: product.requiredValues, inheritDefaults: product.inheritDefaults,
      images: await Promise.all(product.images.map(async image => ({
        name: image.fileName, role: image.role, color: image.colorName,
        sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blobs.get(image.blobId).arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      }))),
    })));
  });
}

test('selected-only intake preserves ready A and reconciles lost C without a new key after reload', { timeout: 60_000 }, async t => {
  const apiPort = Number(process.env.CONTROL_TOWER_QA_API_PORT);
  const frontendPort = Number(process.env.CONTROL_TOWER_QA_FRONTEND_PORT);
  assert.ok(apiPort && frontendPort, 'use allocated isolated QA ports');
  const server = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, CONTROL_TOWER_QA_JOB_COUNT: '0' }, stdio: 'ignore', windowsHide: true });
  console.log(JSON.stringify({ fixturePid: server.pid, apiPort, frontendPort }));
  t.after(async () => {
    await stopProcess(server);
    console.log(JSON.stringify({ fixturePid: server.pid, exitCode: server.exitCode, signalCode: server.signalCode }));
  });
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    console.log(JSON.stringify({ browserClosed: !browser.isConnected() }));
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => console.error(JSON.stringify({ pageError: error.message })));
  page.on('response', response => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith('/api/automation/policy') || pathname === '/api/invoke/cafe24_control_tower/console-products') {
      console.log(JSON.stringify({ fixtureUrl: response.url(), status: response.status() }));
    }
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([`http://127.0.0.1:${apiPort}`, `http://127.0.0.1:${frontendPort}`].includes(url.origin)) return route.continue();
    console.log(JSON.stringify({ blockedNonFixtureRequest: url.origin + url.pathname }));
    return route.abort();
  });
  const requests = [], created = new Map();
  const readQueueState = () => page.evaluate(() => ({
    rows: [0, 1, 2].map(index => {
      const card = document.querySelector(`.bulk-product-card[data-product-index="${index}"]`);
      return { index, name: card?.querySelector('.bulk-name-field input')?.value,
        images: card?.querySelector('.bulk-card-summary')?.textContent,
        issues: card?.querySelector('.bulk-card-verdict')?.textContent,
        state: card?.dataset.state, checked: card?.querySelector('[data-common-target]')?.checked };
    }),
    buttons: ['bulk-queue-submit-selected', 'bulk-queue-submit'].map(id => {
      const button = document.getElementById(id);
      return { id, text: button?.textContent, disabled: button?.disabled };
    }),
    hint: document.querySelector('#bulk-intake > .board-toolbar-hint')?.textContent,
    editorImages: [...document.querySelectorAll('#bulk-selected-editor .bulk-zone-base .bulk-thumb img')]
      .map(image => ({ complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })),
    status: document.getElementById('bulk-intake-status')?.textContent,
  }));
  let loseC = true;
  await page.route('**/api/factory/jobs', async route => {
    if (route.request().method() !== 'POST') {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jobs: [...created.values()].map(value => value.job) }) });
    }
    const payload = route.request().postDataJSON();
    requests.push(payload);
    let item = created.get(payload.idempotencyKey);
    if (item) assert.deepEqual(payload, item.payload, 'same key must carry the same request');
    else {
      item = { payload, job: { jobId: `fixture-${created.size + 1}`, productName: payload.productName, batchId: payload.batchId, status: 'queued' } };
      created.set(payload.idempotencyKey, item);
    }
    if (payload.productName === '검증C' && loseC) {
      loseC = false;
      return route.fulfill({ contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ accepted: true, job: item.job }) });
  });
  await page.goto(`http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&factoryBackend=http://127.0.0.1:${apiPort}&factoryApp=http://127.0.0.1:${frontendPort}`, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-input-source').click();
  const hint = page.locator('#bulk-intake > .board-toolbar-hint');
  assert.equal(await page.locator('#bulk-queue-submit-selected').innerText(), '선택한 제품 추가');
  assert.equal(await page.locator('#bulk-queue-submit').innerText(), '입력 완료 제품 모두 추가');
  assert.equal(await page.locator('#bulk-queue-submit-selected').isDisabled(), true);
  assert.equal(await page.locator('#bulk-queue-submit').isDisabled(), true);
  assert.match(await hint.innerText(), /^선택한 0개 중 0개 추가 가능 · 전체 0개 추가 가능/u);
  assert.equal(await hint.innerText(), '선택한 0개 중 0개 추가 가능 · 전체 0개 추가 가능.');
  for (const name of ['검증A', '검증B', '검증C']) {
    await page.locator('#bulk-new-product-name').fill(name);
    await page.locator('#bulk-add-product').press('Enter');
    if (name === '검증A') {
      await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'));
      await page.waitForFunction(() => {
        const image = document.querySelector('#bulk-selected-editor .bulk-zone-base .bulk-thumb img');
        return image?.complete && image.naturalWidth > 0;
      });
      console.log(JSON.stringify({ checkpoint: 'a-image-ready', ...await readQueueState() }));
      await page.locator('#bulk-selected-editor [data-product-field="size"]').fill('15x8cm');
    }
  }
  console.log(JSON.stringify({ checkpoint: 'before-initial-wait', ...await readQueueState() }));
  await page.waitForFunction(() => {
    const button = document.getElementById('bulk-queue-submit');
    return document.querySelectorAll('.bulk-product-card').length === 3
      && button?.textContent === '입력 완료 제품 모두 추가' && !button.disabled
      && document.querySelector('#bulk-intake > .board-toolbar-hint')?.textContent.startsWith('선택한 0개 중 0개 추가 가능 · 전체 1개 추가 가능');
  });
  const initial = await readQueueState();
  console.log(JSON.stringify({ checkpoint: 'a-only-eligible', ...initial }));
  assert.deepEqual(initial.rows.map(row => row.name), ['검증A', '검증B', '검증C']);
  assert.deepEqual(initial.rows.map(row => row.images), ['사진 1장', '사진 0장', '사진 0장']);
  assert.deepEqual(initial.rows.map(row => row.checked), [false, false, false]);
  assert.equal(initial.buttons[1].disabled, false);
  assert.match(initial.hint, /^선택한 0개 중 0개 추가 가능 · 전체 1개 추가 가능\. 2개는 필수 정보가 빠져 제외됩니다\. 제품 옆 안내를 확인해주세요\.$/u);
  const selected = page.locator('#bulk-queue-submit-selected');
  assert.equal(await selected.count(), 1, 'missing visible selected-only submit; all-ready submission cannot preserve A');
  await page.evaluate(async () => {
    const read = request => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await read(indexedDB.open('control-tower-bulk-intake', 1));
    const deadline = Date.now() + 10_000;
    try {
      while (Date.now() < deadline) {
        const state = await read(db.transaction('state', 'readonly').objectStore('state').get('current'));
        if (state?.products?.length === 3 && state.products[0].images.length === 1
          && state.products[0].requiredValues?.size === '15x8cm') return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('bulk intake state did not persist three products and A image/size');
    } finally { db.close(); }
  });
  const before = await storedInputFingerprint(page);
  console.log(JSON.stringify({ checkpoint: 'stored-before-selection', fingerprint: before }));
  assert.equal(await selected.isDisabled(), true);
  await page.locator('[data-common-target="1"]').check();
  await page.locator('[data-common-target="2"]').check();
  await page.waitForFunction(() => {
    const button = document.getElementById('bulk-queue-submit-selected');
    return button?.textContent === '선택한 제품 추가' && button.disabled
      && document.querySelector('#bulk-intake > .board-toolbar-hint')?.textContent.startsWith('선택한 2개 중 0개 추가 가능 · 전체 1개 추가 가능');
  });
  assert.equal(requests.length, 0);
  assert.deepEqual(await storedInputFingerprint(page), before, 'selection alone never applies common values');
  assert.equal(await selected.innerText(), '선택한 제품 추가');
  assert.match(await hint.innerText(), /^선택한 2개 중 0개 추가 가능 · 전체 1개 추가 가능\. 2개는 필수 정보가 빠져 제외됩니다\. 제품 옆 안내를 확인해주세요\.$/u);
  assert.equal(await page.locator('#bulk-queue-submit').isEnabled(), true);
  assert.equal(await selected.isDisabled(), true);
  assert.equal(await selected.isVisible(), true);
  assert.equal(await page.locator('[data-common-target="0"]').isChecked(), false);
  assert.equal(await page.locator('[data-common-target="1"]').isChecked(), true);
  assert.equal(await page.locator('[data-common-target="2"]').isChecked(), true);
  assert.equal(requests.length, 0);
  assert.equal(await page.locator('#bulk-queue-confirm').isHidden(), true);
  console.log(JSON.stringify({ checkpoint: 'mixed-2-0', ...await readQueueState(), posts: requests.length, confirmHidden: true }));
  await page.locator('[data-edit-product="1"]').press('Enter');
  await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'));
  await page.waitForFunction(() => {
    const image = document.querySelector('#bulk-selected-editor .bulk-zone-base .bulk-thumb img');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.locator('#bulk-selected-editor [data-product-field="size"]').fill('15x8cm');
  await page.waitForFunction(() => {
    const button = document.getElementById('bulk-queue-submit-selected');
    return button?.textContent === '선택한 제품 추가' && !button.disabled
      && document.querySelector('#bulk-intake > .board-toolbar-hint')?.textContent.startsWith('선택한 2개 중 1개 추가 가능 · 전체 2개 추가 가능');
  });
  assert.equal(await selected.innerText(), '선택한 제품 추가');
  assert.match(await hint.innerText(), /^선택한 2개 중 1개 추가 가능 · 전체 2개 추가 가능\. 1개는 필수 정보가 빠져 제외됩니다\. 제품 옆 안내를 확인해주세요\.$/u);
  assert.equal(await page.locator('#bulk-queue-submit').isEnabled(), true);
  assert.equal(await selected.isEnabled(), true);
  assert.equal(await selected.isVisible(), true);
  console.log(JSON.stringify({ checkpoint: 'mixed-2-1', ...await readQueueState(), posts: requests.length }));
  await selected.press('Enter');
  await page.locator('#bulk-queue-confirm').waitFor({ state: 'visible' });
  const mixedPreview = await page.locator('#bulk-queue-confirm .bulk-confirm-list li > span:first-child').allTextContents();
  assert.deepEqual(mixedPreview, ['검증B']);
  assert.equal(requests.length, 0);
  console.log(JSON.stringify({ checkpoint: 'mixed-b-only-preview', names: mixedPreview, posts: requests.length }));
  await page.locator('[data-edit-product="2"]').press('Enter');
  await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'));
  await page.waitForFunction(() => {
    const image = document.querySelector('#bulk-selected-editor .bulk-zone-base .bulk-thumb img');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.locator('#bulk-selected-editor [data-product-field="size"]').fill('15x8cm');
  await page.waitForFunction(() => {
    const button = document.getElementById('bulk-queue-submit-selected');
    return button?.textContent === '선택한 제품 추가' && !button.disabled
      && document.querySelector('#bulk-intake > .board-toolbar-hint')?.textContent.startsWith('선택한 2개 중 2개 추가 가능 · 전체 3개 추가 가능');
  });
  assert.equal(await selected.innerText(), '선택한 제품 추가');
  assert.match(await hint.innerText(), /^선택한 2개 중 2개 추가 가능 · 전체 3개 추가 가능/u);
  assert.match(await hint.innerText(), /추가 정보는 조립공장에서 입력할 수 있습니다\.$/u);
  assert.equal(await page.locator('#bulk-queue-submit').isEnabled(), true);
  assert.equal(await selected.isEnabled(), true);
  assert.equal(await selected.isVisible(), true);
  console.log(JSON.stringify({ checkpoint: 'mixed-2-2', ...await readQueueState(), posts: requests.length }));
  await selected.press('Enter');
  assert.equal(requests.length, 0);
  assert.deepEqual(await page.locator('#bulk-queue-confirm .bulk-confirm-list li > span:first-child').allTextContents(), ['검증B', '검증C']);
  await page.locator('[data-common-target="2"]').uncheck();
  assert.equal(await page.locator('#bulk-queue-confirm').isHidden(), true);
  const models = await page.locator('#bulk-image-model-select option').evaluateAll(nodes => nodes.map(node => node.value));
  const originalModel = await page.locator('#bulk-image-model-select').inputValue();
  await selected.press('Enter');
  await page.locator('#bulk-image-model-select').selectOption(models.find(value => value !== originalModel));
  assert.equal(await page.locator('#bulk-queue-confirm').isHidden(), true);
  await selected.press('Enter');
  assert.equal(requests.length, 0);
  assert.deepEqual(await page.locator('#bulk-queue-confirm .bulk-confirm-list li > span:first-child').allTextContents(), ['검증B']);
  await page.locator('[data-common-target="2"]').check();
  await selected.press('Enter');
  const metrics = [];
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 375 });
    await selected.scrollIntoViewIfNeeded();
    const metric = await page.evaluate(() => {
      const scroll = document.scrollingElement;
      const hintNode = document.querySelector('#bulk-intake > .board-toolbar-hint');
      const tokenStart = hintNode.textContent.indexOf('정보는');
      const tokenRange = document.createRange();
      tokenRange.setStart(hintNode.firstChild, tokenStart);
      tokenRange.setEnd(hintNode.firstChild, tokenStart + '정보는'.length);
      return { width: innerWidth, clientWidth: scroll.clientWidth, scrollWidth: scroll.scrollWidth,
        scrollMax: scroll.scrollHeight - scroll.clientHeight,
        hintWordBreak: getComputedStyle(hintNode).wordBreak,
        hintTokenTops: [...tokenRange.getClientRects()].map(rect => rect.top),
        hint: document.querySelector('#bulk-intake > .board-toolbar-hint').textContent,
        controls: ['bulk-queue-submit-selected', 'bulk-queue-submit'].map(id => {
          const node = document.getElementById(id), rect = node.getBoundingClientRect();
          return { id, text: node.textContent, left: rect.left, right: rect.right, width: rect.width, height: rect.height, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
        }) };
    });
    assert.ok(metric.scrollMax > 0);
    assert.ok(metric.scrollWidth <= metric.clientWidth + 1);
    assert.deepEqual([metric.hintWordBreak, new Set(metric.hintTokenTops).size], ['keep-all', 1], `${width}px: 정보는 must stay on one rendered line`);
    assert.match(metric.hint, /^선택한 2개 중 2개 추가 가능 · 전체 3개 추가 가능/u);
    assert.equal(await hint.isVisible(), true);
    for (const control of metric.controls) {
      assert.ok(control.left >= 0 && control.right <= width + 1);
      assert.ok(control.height > 0 && control.scrollWidth <= control.clientWidth + 1);
    }
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    assert.ok(await page.evaluate(() => document.scrollingElement.scrollTop > 0));
    await selected.scrollIntoViewIfNeeded();
    if (process.env.CONTROL_TOWER_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.CONTROL_TOWER_EVIDENCE_DIR, `styled-selected-queue-${width}.png`) });
    metrics.push(metric);
  }
  console.log(JSON.stringify({ viewports: metrics }));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#bulk-queue-confirm-submit').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => document.querySelector('#bulk-intake-status')?.textContent.includes('수락 결과'));
  assert.deepEqual(requests.map(value => value.productName), ['검증B', '검증C']);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('#menu-tab-input-source').click();
  await page.waitForFunction(() => document.querySelectorAll('.bulk-product-card').length === 3);
  await selected.press('Enter');
  await page.locator('#bulk-queue-confirm-submit').press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.bulk-product-card[data-state="queued"]').length === 2);
  assert.deepEqual(requests.map(value => value.productName), ['검증B', '검증C', '검증C']);
  console.log(JSON.stringify({ retryKeys: requests.map(value => value.idempotencyKey), created: created.size }));
  assert.equal(requests[1].idempotencyKey, requests[2].idempotencyKey);
  assert.equal(created.size, 2, 'lost response must not create C twice');
  await page.locator('#menu-tab-input-source').click();
  const after = await storedInputFingerprint(page);
  assert.deepEqual(after[0], before[0]);
  assert.equal(await page.locator('.bulk-product-card[data-product-index="0"]').getAttribute('data-state') === 'queued', false);
  console.log(JSON.stringify({ selectedNames: requests.map(value => value.productName), keys: requests.map(value => value.idempotencyKey), created: created.size, aPreserved: true }));
  console.log(JSON.stringify({ checkpoint: 'after-reload-and-retry', ...await readQueueState(), aBefore: before[0], aAfter: after[0] }));
});

test('bulk intake submit shows the created product in the overview queue', { timeout: 60_000 }, async t => {
  const apiPort = Number(process.env.CONTROL_TOWER_QA_API_PORT || 19462);
  const frontendPort = Number(process.env.CONTROL_TOWER_QA_FRONTEND_PORT || 19482);
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
      CONTROL_TOWER_QA_JOB_COUNT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  console.log(JSON.stringify({ queuedPolicyFixturePid: server.pid, apiPort, frontendPort }));
  t.after(async () => { await stopProcess(server); console.log(JSON.stringify({ queuedPolicyFixtureStopped: server.pid, signal: server.signalCode })); });
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);

  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); console.log(JSON.stringify({ queuedPolicyBrowserClosed: !browser.isConnected() })); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/*', route => [apiPort, frontendPort].some(port => new URL(route.request().url()).origin === `http://127.0.0.1:${port}`) ? route.continue() : route.abort());
  let createdJob = null;
  let createCount = 0;
  let rejectNextQueue = true;
  let releaseQueue;
  const queueAllowed = new Promise(resolve => { releaseQueue = resolve; });
  let mismatchNextPolicy = true;
  await page.route('**/api/automation/policy/snapshot', async route => {
    const response = await route.fetch();
    const snapshot = await response.json();
    if (mismatchNextPolicy) {
      snapshot.resolved.size_image = 'auto';
      mismatchNextPolicy = false;
    }
    await route.fulfill({ response, body: JSON.stringify(snapshot) });
  });
  await page.route('**/api/invoke/cafe24_control_tower/console-products', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, response: { body: { data: { response: { categories: [{ category_no: 84, category_name: '지갑', full_category_name: { 1: '잡화', 2: '지갑' } }] } } } } }),
  }));
  await page.route('**/api/factory/jobs', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      if (rejectNextQueue) {
        rejectNextQueue = false;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      createCount += 1;
      assert.equal(payload.productName, '입력 검증 지갑');
      assert.equal(payload.requiredValues.cafe24CategoryId, '84');
      assert.equal(payload.policySnapshot.preset, 'all_images_manual');
      assert.equal(payload.policySnapshot.resolved.required_field_candidate, 'manual');
      assert.equal(payload.policySnapshot.resolved.representative_image, 'auto');
      assert.equal(payload.policySnapshot.resolved.size_image, 'manual');
      assert.equal(payload.policySnapshot.resolved.option_image, 'manual');
      await queueAllowed;
      createdJob = {
        schema: 'factory-product-job:v1',
        jobId: 'factory-job-intake-queue-1',
        batchId: payload.batchId,
        sourceKind: 'direct',
        productName: payload.productName,
        workfileName: `${payload.productName}.kuasangse`,
        mode: payload.mode || 'auto',
        status: 'queued',
        stageKey: 'representative',
        message: '생산 대기',
        imageCount: Array.isArray(payload.inputImages) ? payload.inputImages.length : 0,
        progress: { stageKey: 'representative', stages: [] },
        checkpointAvailable: false,
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true, status: 'queued', job: createdJob }),
      });
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    const jobs = createdJob ? [...body.jobs, createdJob] : body.jobs;
    await route.fulfill({
      response,
      body: JSON.stringify({ ...body, jobs, total: jobs.length }),
    });
  });

  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&factoryBackend=http://127.0.0.1:${apiPort}&factoryApp=http://127.0.0.1:${frontendPort}&intakeQueueFlow=browser`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-input-source').click();
  await page.locator('#go-batch-intake').click();
  await page.waitForFunction(() => document.getElementById('menu-tab-queue')?.getAttribute('aria-selected') === 'true');
  assert.equal(await page.locator('#operator-console-shell').isVisible(), true);
  await page.locator('#menu-tab-input-source').click();
  await page.locator('#bulk-automation-preset-select').selectOption('all_images_manual');
  await page.locator('[data-common-decision="required_field_candidate"]').selectOption('manual');
  await page.waitForTimeout(650);
  await page.reload();
  await page.locator('#menu-tab-input-source').click();
  await page.waitForFunction(() => !document.querySelector('#bulk-automation-preset-select')?.disabled);
  assert.equal(await page.locator('#bulk-automation-preset-select').inputValue(), 'all_images_manual', '제품을 넣기 전에 정한 공통 정책도 복원해야 한다');
  assert.equal(await page.locator('[data-common-decision="required_field_candidate"]').inputValue(), 'manual');
  await page.locator('#bulk-new-product-name').fill('입력 검증 지갑');
  await page.locator('#bulk-add-product').press('Enter');
  await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'));
  await page.waitForFunction(() => document.querySelector('#bulk-category-0 option[value="84"]'));
  await page.locator('[data-focus-key="category-search:0"]').fill('지갑');
  await page.locator('#bulk-category-0').selectOption('84');
  await page.locator('[data-product-field="material"]').fill('슬라브');
  await page.locator('[data-product-field="originCountry"]').fill('국산');
  await page.locator('[data-product-field="size"]').fill('15x8cm');
  await page.locator('[data-product-field="salePrice"]').fill('2000');
  await page.locator('[data-product-field="stock"]').fill('99');
  await page.locator('[data-product-field="usage"]').fill('동전보관용');
  await page.locator('#bulk-automation-preset-select').selectOption('all_images_manual');
  assert.equal(await page.locator('#batch-policy').inputValue(), 'full_auto', '숨은 메뉴의 기본값은 실제 입력 화면과 달라도 된다');
  await page.locator('[data-common-decision="required_field_candidate"]').selectOption('manual');
  await page.locator('.bulk-product-policy > summary').press('Enter');
  await page.locator('[data-product-decision="representative_image"]').selectOption('auto');
  const submit = page.locator('#bulk-queue-submit');
  await submit.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = document.querySelector('#bulk-queue-submit');
    return Boolean(button && !button.disabled);
  });

  // 2026-09-03 부터 첫 클릭은 확인 화면을 연다 — 무엇으로 진행되는지 보지 못한 채
  // 곧바로 큐에 들어가던 것을 고쳤다("자동 수동 선택하는것도 나 한번도 인식하지못했어").
  assert.equal(await submit.innerText(), '입력 완료 제품 모두 추가');
  assert.match(await page.locator('#bulk-intake > .board-toolbar-hint').innerText(), /^선택한 0개 중 0개 추가 가능 · 전체 1개 추가 가능\.$/u);
  await submit.click();
  assert.equal(createCount, 0, '첫 클릭은 추가 전 확인만 해야 한다');
  const confirmBox = page.locator('#bulk-intake .bulk-confirm-box');
  await confirmBox.waitFor({ state: 'visible' });
  assert.match(await confirmBox.innerText(), /작업큐에 추가할 제품 1개 · 마지막 확인/u);
  assert.match(await confirmBox.innerText(), /이미지 생성 모델/u);
  assert.match(await confirmBox.innerText(), /자동화 방식/u);
  assert.match(await confirmBox.innerText(), /직접 선택: 필수값 후보·충돌 · 사이즈이미지 A컷 · 색상옵션 A컷 · 이미지컷 A컷/u);
  await page.locator('.bulk-plan .bulk-name-field input').fill('입력 검증 지갑 변경');
  await submit.press('Enter');
  assert.equal(createCount, 0, '편집 직후 클릭도 전송하지 않고 최신 입력으로 재확인해야 한다');
  assert.match(await confirmBox.innerText(), /입력 검증 지갑 변경/u);
  if (process.env.CONTROL_TOWER_EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.CONTROL_TOWER_EVIDENCE_DIR, 'queue-confirm-edited-fixture.png') });
  }
  await page.locator('.bulk-plan .bulk-name-field input').fill('입력 검증 지갑');
  await page.waitForFunction(() => document.querySelector('#bulk-queue-confirm')?.hidden === true);
  assert.equal(createCount, 0, '지연된 재계산도 확인을 무효화하며 자동 전송하지 않아야 한다');
  await submit.press('Enter');
  assert.equal(createCount, 0);
  assert.match(await confirmBox.innerText(), /입력 검증 지갑/u);
  await page.locator('#bulk-queue-confirm-submit').press('Enter');
  await page.waitForFunction(() => document.querySelector('#bulk-intake-status')?.textContent.includes('화면의 공정 설정과 잠긴 실행 설정이 달라'));
  assert.equal(createCount, 0, '서버 확정 설정이 화면과 다르면 작업을 생성하면 안 된다');
  assert.equal(await submit.isEnabled(), true, '설정 오류 후 입력을 수정하거나 재시도할 수 있어야 한다');
  await submit.press('Enter');
  await page.locator('#bulk-queue-confirm-submit').press('Enter');
  await page.waitForFunction(() => document.querySelector('#bulk-intake-status')?.textContent.includes('작업큐의 수락 결과를 확인하지 못했습니다'));
  assert.equal(createCount, 0);
  assert.equal(await page.locator('.bulk-product-card[data-state="queued"]').count(), 0);
  assert.equal(await page.locator('#bulk-selected-editor [data-product-field="material"]').isEnabled(), false, 'unknown receipt holds the exact input until same-key confirmation');
  assert.equal(await page.locator('.bulk-thumb img').count(), 1);
  await submit.press('Enter');
  await page.locator('#bulk-queue-confirm-submit').press('Enter');
  await page.waitForFunction(() => document.querySelector('#bulk-queue-submit')?.disabled);
  assert.equal(await page.locator('#bulk-queue-submit-selected').isDisabled(), true);
  const lockedDuringSubmit = await page.locator('#bulk-intake').evaluate(root =>
    ['#bulk-new-product-name', '#bulk-add-product', '#bulk-image-model-select', '[data-product-field="material"]', '.bulk-zone-base input[type=file]']
      .every(selector => root.querySelector(selector)?.disabled === true));
  if (process.env.CONTROL_TOWER_EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.CONTROL_TOWER_EVIDENCE_DIR, 'queue-busy-fixture.png') });
  }
  releaseQueue();
  assert.equal(lockedDuringSubmit, true, '큐 추가 응답을 기다리는 동안 입력을 바꿔 이전 스냅샷으로 덮어쓰면 안 된다');
  await page.waitForFunction(() => document.getElementById('menu-tab-queue')?.getAttribute('aria-selected') === 'true');
  await page.waitForSelector('#product-list .operator-job-row[data-job-id="factory-job-intake-queue-1"]');
  const row = page.locator('#product-list .operator-job-row[data-job-id="factory-job-intake-queue-1"]');
  assert.equal(await row.isVisible(), true);
  assert.equal(await row.getAttribute('data-just-created'), 'true');
  if (process.env.CONTROL_TOWER_EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(process.env.CONTROL_TOWER_EVIDENCE_DIR, 'queue-added-fixture.png') });
  }
  await page.locator('#menu-tab-input-source').click();
  assert.equal(await page.locator('.bulk-product-card[data-state="queued"]').count(), 1);
  assert.equal(await page.locator('#bulk-selected-editor[data-state="queued"] .bulk-thumb img').count(), 1);
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await page.locator('#bulk-queue-submit-selected').isDisabled(), true);
  assert.match(await page.locator('#bulk-intake > .board-toolbar-hint').innerText(), /^선택한 0개 중 0개 추가 가능 · 전체 0개 추가 가능\.$/u);
  await page.waitForTimeout(650);
  await page.reload();
  await page.locator('#menu-tab-input-source').click();
  await page.locator('.bulk-product-card[data-state="queued"]').waitFor();
  assert.equal(await page.locator('.bulk-plan .bulk-name-field input').inputValue(), '입력 검증 지갑');
  assert.equal(await page.locator('#bulk-category-0').inputValue(), '84');
  assert.equal(await page.locator('.bulk-thumb img').count(), 1);
  assert.equal(await submit.isDisabled(), true);
  assert.equal(createCount, 1);
  await page.locator('#bulk-automation-preset-select').selectOption('full_auto');
  const decisionCount = await page.locator('[data-product-decision]').count();
  assert.equal(await page.locator('.bulk-policy-row-summary').innerText(), `직접 선택 4항목 · AI 판단 ${decisionCount - 4}항목`, '큐에 들어간 제품은 이후 공통 설정 변경에도 확정 설정을 유지한다');
  await page.locator('.bulk-product-policy > summary').press('Enter');
  assert.equal(await page.locator('[data-product-decision="representative_image"]').inputValue(), 'auto');
  assert.equal(await page.locator('[data-product-decision="representative_image"]').isDisabled(), true);
  const lockedSize = await page.locator('[data-product-decision="size_image"]').evaluate(select => ({
    override: select.value, effective: select.closest('.bulk-policy-field').querySelector('small').textContent, disabled: select.disabled,
  }));
  console.log(JSON.stringify({ queuedPolicySummary: await page.locator('.bulk-policy-row-summary').innerText(), decisionCount, lockedSize, createCount }));
  assert.deepEqual(lockedSize, { override: '', effective: '적용: 직접 선택', disabled: true });
  await page.setViewportSize({ width: 375, height: 500 });
  const mobileNameHeight = await page.locator('.bulk-base-cell .bulk-shot-name').evaluate(node => node.getBoundingClientRect().height);
  assert.ok(mobileNameHeight <= 44, `기본사진 파일명이 빈 세로 공간을 차지하면 안 된다: ${mobileNameHeight}`);
});

test('three pasted product rows remain editable and survive reload with one shared editor', { timeout: 60_000 }, async t => {
  const apiPort = Number(process.env.CONTROL_TOWER_QA_API_PORT || 19462);
  const frontendPort = Number(process.env.CONTROL_TOWER_QA_FRONTEND_PORT || 19482);
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, CONTROL_TOWER_QA_API_PORT: String(apiPort), CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  console.log(JSON.stringify({ cancelKeepFixturePid: server.pid, apiPort, frontendPort }));
  t.after(async () => { await stopProcess(server); console.log(JSON.stringify({ cancelKeepFixtureStopped: server.pid, signal: server.signalCode })); });
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); console.log(JSON.stringify({ cancelKeepBrowserClosed: !browser.isConnected() })); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.route('**/*', route => [apiPort, frontendPort].some(port => new URL(route.request().url()).origin === `http://127.0.0.1:${port}`) ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&factoryBackend=http://127.0.0.1:${apiPort}&factoryApp=http://127.0.0.1:${frontendPort}`, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-input-source').click();
  await page.locator('#bulk-product-rows').fill('검증 카드지갑\n검증 보자기\n검증 수저집');
  await page.locator('#bulk-add-rows').press('Enter');
  assert.equal(await page.locator('.bulk-product-card').count(), 3);
  assert.equal(await page.locator('#bulk-selected-editor').count(), 1);
  await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'));
  await page.locator('.bulk-zones > .bulk-zone:not(.bulk-zone-base) input[type=file]').setInputFiles(path.join(ROOT, 'output/restore-input-check.png'));
  await page.locator('.bulk-color-input').fill('검증 빨강');
  await page.locator('[data-focus-key="product-name:1"]').fill('수정한 보자기');
  await page.waitForTimeout(500);
  await page.locator('[data-edit-product="1"]').press('Enter');
  assert.match(await page.locator('#bulk-selected-editor h3').innerText(), /수정한 보자기/);
  await page.locator('#bulk-selected-editor [data-product-field="material"]').fill('면');
  await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/restore-input-drop-check.png'));
  await page.locator('[data-edit-product="2"]').press('Enter');
  await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/restore-input-natural-check.png'));
  await page.waitForTimeout(1000);
  const before = await storedInputFingerprint(page);
  assert.deepEqual(before.map(product => product.images.length), [2, 1, 1]);
  assert.deepEqual(before[0].images.map(image => image.role), ['base', 'color-option']);
  assert.equal(before[0].images[1].color, '검증 빨강');
  assert.equal(new Set(before.flatMap(product => product.images.map(image => image.sha256))).size, 4);
  await page.reload();
  await page.locator('#menu-tab-input-source').click();
  await page.locator('[data-focus-key="product-name:2"]').waitFor();
  assert.deepEqual(await page.locator('.bulk-plan .bulk-name-field input').evaluateAll(nodes => nodes.map(node => node.value)), ['검증 카드지갑', '수정한 보자기', '검증 수저집']);
  assert.deepEqual(await storedInputFingerprint(page), before);
  await page.locator('[data-edit-product="1"]').press('Enter');
  assert.equal(await page.locator('#bulk-selected-editor [data-product-field="material"]').inputValue(), '면');
  await page.setViewportSize({ width: 375, height: 500 });
  assert.equal(await page.locator('#bulk-queue-submit').isVisible(), true);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(overflow, false);
  await page.getByRole('button', { name: '검증 수저집 입력 취소', exact: true }).press('Enter');
  assert.equal(await page.locator('.bulk-product-card').count(), 3);
  await page.getByRole('button', { name: '검증 수저집 입력 유지', exact: true }).press('Enter');
  assert.equal(await page.locator('.bulk-product-card').count(), 3);
  await page.getByRole('button', { name: '검증 수저집 입력 취소', exact: true }).press('Enter');
  await page.getByRole('button', { name: '검증 수저집 입력 취소 확인', exact: true }).press('Enter');
  assert.equal(await page.locator('.bulk-product-card').count(), 2);
  console.log(JSON.stringify({ cancelKeepPreservedRows: 3, confirmedCancelRows: 2, reloadFingerprintPreserved: true, before }));
});

/**
 * 실측 2026-09-03: 사진을 고르고 그대로 투입했더니 작업 큐에 IMG_5968 이라는 제품이
 * 생겼고, 그 이름 그대로 경쟁사(마사지건·니트모자 등)까지 검색됐다. 확인 화면이
 * 이걸 미리 말해 줘야 한다.
 */
test('제품명이 사진 파일 이름 그대로면 확인 화면이 경쟁사 검색 경고를 보여준다', { timeout: 60_000 }, async t => {
  const apiPort = Number(process.env.CONTROL_TOWER_QA_API_PORT || 19463);
  const frontendPort = Number(process.env.CONTROL_TOWER_QA_FRONTEND_PORT || 19483);
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
      CONTROL_TOWER_QA_JOB_COUNT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);

  // 저장소를 건드리지 않고, 카메라가 붙이는 이름을 흉내 낸 임시 사본을 하나 만든다.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kuasangse-camera-name-'));
  const cameraNamedFile = path.join(tempDir, 'IMG_5968.png');
  fs.copyFileSync(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'), cameraNamedFile);
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&intakeQueueFlow=camera-name`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-input-source').click();
  await page.locator('.bulk-batch-tools > summary').click();
  await page.locator('#bulk-image-input').setInputFiles(cameraNamedFile);
  await page.locator('.bulk-common-fields > summary').click();
  await page.locator('[data-common-target="0"]').check();
  await page.locator('[data-common-key="category"]').fill('주머니');
  await page.locator('[data-common-key="material"]').fill('슬라브');
  await page.locator('[data-common-key="originCountry"]').fill('중국');
  await page.locator('[data-common-key="size"]').fill('50x200');
  await page.locator('[data-common-key="salePrice"]').fill('2000');
  await page.locator('[data-common-key="stock"]').fill('99');
  await page.locator('[data-common-key="usage"]').fill('수저집');
  await page.locator('#bulk-common-apply').press('Enter');

  // 카드 자체가 흠으로 알려 준다.
  await page.waitForSelector('.bulk-product-card .bulk-card-verdict');
  assert.match(await page.locator('.bulk-product-card .bulk-card-verdict').innerText(), /제품명이 사진 파일 이름 그대로입니다/u);

  const submit = page.locator('#bulk-queue-submit');
  await page.waitForFunction(() => {
    const button = document.querySelector('#bulk-queue-submit');
    return Boolean(button && !button.disabled);
  });
  await submit.click();
  const confirmBox = page.locator('#bulk-intake .bulk-confirm-box');
  await confirmBox.waitFor({ state: 'visible' });
  const confirmText = await confirmBox.innerText();
  assert.match(confirmText, /IMG_5968/u);
  assert.match(confirmText, /그 이름으로 경쟁사도 검색됩니다/u);
  assert.match(confirmText, /파일명 그대로/u);
});

test('compact row policy summaries retain full controls and keep row actions together', { timeout: 60_000 }, async t => {
  const apiPort = Number(process.env.CONTROL_TOWER_QA_API_PORT);
  const frontendPort = Number(process.env.CONTROL_TOWER_QA_FRONTEND_PORT);
  assert.ok(apiPort && frontendPort, 'use permanently allocated isolated QA ports');
  const server = spawn(process.execPath, [SERVER], { cwd: ROOT, env: { ...process.env, CONTROL_TOWER_QA_JOB_COUNT: '0' }, stdio: 'ignore', windowsHide: true });
  console.log(JSON.stringify({ rowDensityFixturePid: server.pid, apiPort, frontendPort }));
  t.after(async () => { await stopProcess(server); console.log(JSON.stringify({ rowDensityFixtureStopped: server.pid, signal: server.signalCode })); });
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); console.log(JSON.stringify({ rowDensityBrowserClosed: !browser.isConnected() })); });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.route('**/*', route => [apiPort, frontendPort].some(port => new URL(route.request().url()).origin === `http://127.0.0.1:${port}`) ? route.continue() : route.abort());
  const { AUTOMATION_DECISIONS } = await import('../../frontend/src/automation-policy-model.mjs');
  const ids = Object.keys(AUTOMATION_DECISIONS);
  const manualIds = ids.filter(id => id.startsWith('competitor_') || ['sinhwa_db_product', 'cafe24_product', 'required_field_candidate', 'representative_image'].includes(id));
  const names = ['색동동전지갑 행밀도 A', '카드지갑 로컬입력 행밀도 B', '색동동전지갑 로컬입력 행밀도 C'];
  await page.goto(`http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&factoryBackend=http://127.0.0.1:${apiPort}&factoryApp=http://127.0.0.1:${frontendPort}`, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-input-source').press('Enter');
  for (let index = 0; index < names.length; index++) {
    await page.locator('#bulk-new-product-name').fill(names[index]);
    await page.locator('#bulk-add-product').press('Enter');
    if (index < 2) await page.locator('.bulk-zone-base input[type=file]').setInputFiles(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'));
    if (index === 0) {
      await page.locator('[data-product-field="size"]').fill('15x8cm');
      await page.locator('[data-product-field="salePrice"]').fill('2000');
      await page.locator('.bulk-product-extra > summary').press('Enter');
      await page.locator('[data-product-field="category"]').fill('지갑');
    } else {
      if (!(await page.locator('.bulk-product-policy').evaluate(node => node.open))) await page.locator('.bulk-product-policy > summary').press('Enter');
      for (const id of ['sinhwa_db_product', 'cafe24_product', 'competitor_product', 'required_field_candidate', 'representative_image']) {
        await page.locator(`[data-product-decision="${id}"]`).selectOption('manual');
      }
      await page.locator(`[data-common-target="${index}"]`).check();
    }
  }
  const compact = `직접 선택 ${manualIds.length}항목 · AI 판단 ${ids.length - manualIds.length}항목`;
  await page.waitForFunction(expected => document.querySelector('.bulk-product-card[data-product-index="2"] .bulk-policy-row-summary')?.textContent === expected, compact);
  assert.deepEqual(await page.locator('.bulk-policy-row-summary').allTextContents(), ['전 공정 AI 판단', compact, compact]);
  await page.locator('[data-edit-product="1"]').press('Enter');
  const readPolicyFields = () => page.locator('#bulk-selected-editor .bulk-policy-field').evaluateAll(fields => fields.map(field => ({
    id: field.querySelector('select').dataset.productDecision, label: field.querySelector('span').textContent,
    value: field.querySelector('select').value, effective: field.querySelector('small').textContent,
  })));
  const policyFields = await readPolicyFields();
  assert.deepEqual(policyFields.map(field => field.id).sort(), [...ids].sort());
  for (const field of policyFields) {
    assert.equal(field.label, AUTOMATION_DECISIONS[field.id]);
    assert.equal(field.value, manualIds.includes(field.id) ? 'manual' : '');
    assert.equal(field.effective, `적용: ${manualIds.includes(field.id) ? '직접 선택' : 'AI 판단'}`);
  }
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 720 });
    await page.locator('.bulk-product-card[data-product-index="2"]').scrollIntoViewIfNeeded();
    const rows = await page.locator('.bulk-product-card').evaluateAll(cards => cards.map(card => {
      const summary = card.querySelector('.bulk-policy-row-summary');
      return { name: card.querySelector('.bulk-name-field input').value, height: card.getBoundingClientRect().height,
        summary: summary.textContent, summaryHeight: summary.getBoundingClientRect().height,
        trailingEdge: card.querySelector('.bulk-card-head').getBoundingClientRect().right,
        issues: card.querySelector('.bulk-card-verdict').textContent,
        actions: [...card.querySelectorAll('.bulk-card-head .bulk-mini-action')].filter(button => !button.hidden).map(button => {
          const rect = button.getBoundingClientRect();
          return { text: button.textContent, x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height };
        }) };
    }));
    console.log(JSON.stringify({ rowDensityWidth: width, rows }));
    if (process.env.CONTROL_TOWER_EVIDENCE_DIR) await page.locator('.bulk-product-card[data-product-index="2"]').screenshot({ path: path.join(process.env.CONTROL_TOWER_EVIDENCE_DIR, `row-density-C-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    for (const row of rows) {
      for (const action of row.actions) assert.ok(action.x >= 0 && action.right <= width && action.height > 0);
      assert.ok(Math.abs(row.actions[0].y - row.actions[1].y) < 1, `${width}px ${row.name}: edit and cancel split across lines`);
      assert.ok(Math.abs(row.actions.at(-1).right - row.trailingEdge) < 1, `${width}px ${row.name}: actions must align to the trailing edge`);
    }
  }
  await page.setViewportSize({ width: 375, height: 500 });
  await page.getByRole('button', { name: `${names[1]} 입력 취소`, exact: true }).press('Enter');
  assert.equal(await page.locator('.bulk-product-card').count(), 3);
  assert.equal(await page.locator('.bulk-product-card[data-product-index="1"] .bulk-row-actions button:visible').count(), 3);
  await page.getByRole('button', { name: `${names[1]} 입력 유지`, exact: true }).press('Enter');
  assert.equal(await page.locator('.bulk-product-card').count(), 3);
  assert.deepEqual(await readPolicyFields(), policyFields);
  await page.locator('.bulk-product-policy > summary').press('Enter');
  await page.locator('.bulk-product-policy > summary').press('Enter');
  await page.locator('.bulk-product-policy .bulk-policy-markets > summary').press('Enter');
  assert.equal(await page.locator('[data-product-decision="competitor_elevenst"]').isVisible(), true);
  await page.locator('[data-product-field="size"]').fill('15x8cm');
  await page.waitForFunction(() => !document.querySelector('#bulk-queue-submit-selected').disabled);
  await page.locator('#bulk-queue-submit-selected').press('Enter');
  await page.locator('#bulk-queue-confirm').waitFor({ state: 'visible' });
  const fullSummary = await page.locator('.bulk-policy-confirm-summary').innerText();
  assert.equal(fullSummary, `직접 선택: ${manualIds.map(id => AUTOMATION_DECISIONS[id]).join(' · ')}`);
  console.log(JSON.stringify({ compact, fullSummary, policyFields, cancelKeepPreserved: true }));
});
