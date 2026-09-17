'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.resolve(__dirname, 'qa-production-workbench-server.cjs');

// 1x1 PNG. 사진 계약(data:image/...;base64 · sha256)만 보면 되니 진짜 사진일 필요는 없다.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function waitForHttp(url, timeoutMs = 15_000) {
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

function stopProcess(child) {
  if (!child || child.killed) return;
  try { child.kill(); } catch { /* 이미 끝났다 */ }
}

/**
 * 2026-09-17 셋째 조각: 「제품 넣기」. QA 서버는 정책 스냅샷은 내주지만 작업 투입(POST /api/factory/jobs)은
 * 없어 가로챈다 — 본문이 옛 대량 투입과 같은 manual-product-intake 계약인지가 검사의 핵심이다.
 */
async function openIntake(t, { apiPort, frontendPort, queued }) {
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, CONTROL_TOWER_QA_API_PORT: String(apiPort), CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const external = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!/^(?:127\.0\.0\.1|localhost)$/u.test(url.hostname)) external.push(request.url());
  });
  await page.route('**/api/factory/jobs', async route => {
    const request = route.request();
    if (request.method() !== 'POST') { await route.fallback(); return; }
    const body = JSON.parse(request.postData() || '{}');
    queued.push({ csrf: request.headers()['x-control-tower-csrf'], body });
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({
      accepted: true, job: { jobId: 'factory-job-qa-new', productName: body.productName, status: 'queued' },
    }) });
  });
  await page.route('**/api/pdp/sources?*', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      sources: [{ jcode: 965, productName: '가보정보자기', category: '선물포장', detailPageCount: 0, imageCount: 0 }],
    }) });
  });
  await page.goto(
    `http://127.0.0.1:${frontendPort}/workbench.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=browser`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForSelector('#wb-queue .wb-row');
  await page.locator('#wb-btn-intake').click();
  await page.waitForSelector('#wb-intake form.wb-intake-form');
  return { page, errors, external };
}

async function addPhotos(page, names) {
  await page.locator('#wb-intake-files').setInputFiles(names.map(name => ({ name, mimeType: 'image/png', buffer: PNG_1x1 })));
  await page.waitForFunction(count => document.querySelectorAll('#wb-intake-photos .wb-photo').length === count, names.length);
}

test('제품 넣기: 사진·이름·값·정책으로 옛 대량 투입과 같은 본문을 줄에 세운다', { timeout: 60_000 }, async t => {
  const queued = [];
  const { page, errors, external } = await openIntake(t, { apiPort: 19572, frontendPort: 19592, queued });
  page.on('dialog', dialog => void dialog.accept());
  const form = page.locator('#wb-intake form.wb-intake-form');
  // 세우기 전엔 빈 흠을 말로 막는다 — 요청은 나가지 않는다.
  await form.locator('button[data-action="queue-product"]').click();
  assert.match(await page.locator('#wb-intake-problems').innerText(), /제품명이 비었습니다/u);
  assert.equal(queued.length, 0);

  await addPhotos(page, ['color-1.png', 'color-2.png']);
  // 두 번째 사진을 색상옵션으로 바꾸고 색상명을 적는다.
  await form.locator('select[name="photo-role-1"]').selectOption('color-option');
  await form.locator('input[name="photo-color-1"]').fill('연분홍');
  await form.locator('input[name="productName"]').fill('작업대 시험 보자기');
  await form.locator('input[name="detailHint"]').fill('시험 투입');
  await form.locator('input[name="category"]').fill('선물포장');
  await form.locator('input[name="material"]').fill('면');
  await form.locator('input[name="originCountry"]').fill('대한민국');
  await form.locator('input[name="size"]').fill('55x55cm');
  await form.locator('input[name="salePrice"]').fill('9,900원');
  await form.locator('input[name="stock"]').fill('10');
  await form.locator('input[name="usage"]').fill('선물포장');
  await form.locator('input[name="cafe24CategoryId"]').fill('84');
  await form.locator('select[name="preset"]').selectOption('representative_manual');
  await form.locator('select[name="imageModel"]').selectOption('gemini-3.1-flash-image');
  await form.locator('button[data-action="queue-product"]').click();
  await page.waitForFunction(() => /줄에 세웠습니다/u.test(document.querySelector('#wb-status')?.textContent || '')
    && document.getElementById('wb-intake').hidden);

  assert.equal(queued.length, 1);
  assert.ok(queued[0].csrf, 'CSRF 없이 투입했다');
  const body = queued[0].body;
  assert.equal(body.contractType, 'manual-product-intake');
  assert.equal(body.contractVersion, '1.0.0');
  assert.match(body.batchId, /^wb-/u);
  assert.equal(body.productName, '작업대 시험 보자기');
  assert.equal(body.detailHint, '시험 투입');
  assert.equal(body.workfileName, '작업대 시험 보자기.kuasangse');
  assert.deepEqual(body.source, { kind: 'manual' });
  assert.equal(body.imageModel, 'gemini-3.1-flash-image');
  assert.equal(body.cafe24ApprovalMode, 'existing_one_time_target_gate');
  assert.deepEqual(body.cafe24Registration, { registrationMode: 'create' });
  // 정책은 잠긴 스냅샷이고, 대표컷만 사람이다. 잠겼으니 mode 는 auto.
  assert.equal(body.mode, 'auto');
  assert.equal(body.policySnapshot.locked, true);
  assert.equal(body.policySnapshot.preset, 'representative_manual');
  assert.equal(body.policySnapshot.productId, '작업대 시험 보자기');
  // 값: 돈은 숫자만, 진열·판매는 기본 F, 옵션은 색상 사진이 있으니 provided, 크기에서 mm 를 읽는다.
  assert.equal(body.requiredValues.salePrice, '9900');
  assert.equal(body.requiredValues.stock, '10');
  assert.equal(body.requiredValues.cafe24CategoryId, '84');
  assert.equal(body.requiredValues.displayStatus, 'F');
  assert.equal(body.requiredValues.sellingStatus, 'F');
  assert.equal(body.requiredValues.optionMode, 'provided');
  assert.equal(body.requiredValues.widthMm, '550');
  assert.equal(body.category, '선물포장');
  // 사진: 기본 1 + 색상옵션 1, data URL 과 sha256.
  assert.equal(body.inputImages.length, 2);
  assert.deepEqual(body.inputImages.map(image => image.role), ['base', 'color-option']);
  assert.equal(body.inputImages[1].colorName, '연분홍');
  for (const image of body.inputImages) {
    assert.match(image.dataUrl, /^data:image\/png;base64,/u);
    assert.match(image.sha256, /^[a-f0-9]{64}$/u);
    assert.ok(image.name && image.fileName);
  }
  // 세운 뒤엔 접히고 폼이 비며, 새 작업이 줄에서 펼쳐진다.
  assert.equal(await page.locator('#wb-intake').isHidden(), true);
  assert.equal(await page.locator('#wb-intake-photos .wb-photo').count(), 0);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
});

test('제품 넣기: 직접 정하기는 결정 지점 15개를 하나씩 보내고, 신화DB 잇기는 jcode 를 묶는다', { timeout: 60_000 }, async t => {
  const queued = [];
  const { page } = await openIntake(t, { apiPort: 19573, frontendPort: 19593, queued });
  page.on('dialog', dialog => void dialog.accept());
  const form = page.locator('#wb-intake form.wb-intake-form');
  await addPhotos(page, ['main.png']);
  await form.locator('input[name="wb-intake-source-query"]').fill('가보정');
  await form.locator('button[data-action="search-intake-sources"]').click();
  await form.locator('button[data-action="pick-source"]').first().click();
  assert.equal(await form.locator('input[name="productName"]').inputValue(), '가보정보자기');
  assert.equal(await form.locator('input[name="category"]').inputValue(), '선물포장');
  assert.match(await page.locator('#wb-intake-source').innerText(), /J965/u);
  await form.locator('select[name="preset"]').selectOption('custom');
  assert.equal(await page.locator('#wb-intake-matrix .wb-matrix-row').count(), 15);
  await page.locator('#wb-intake-matrix input[name="decision-representative_image"][value="manual"]').check();
  await page.locator('#wb-intake-matrix input[name="decision-final_detail"][value="manual"]').check();
  await form.locator('select[name="registrationMode"]').selectOption('update');
  await form.locator('input[name="targetProductNo"]').fill('530');
  await form.locator('button[data-action="queue-product"]').click();
  await page.waitForFunction(() => /줄에 세웠습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  const body = queued[0].body;
  assert.deepEqual(body.source, { kind: 'sinhwa-db', selectionId: '965' });
  assert.equal(body.jcode, 965);
  assert.equal(body.policySnapshot.preset, 'custom');
  // 서버 스냅샷(policy.py build_policy_snapshot)과 QA 픽스처 모두 resolved 에 결정별 모드를 둔다.
  assert.equal(body.policySnapshot.resolved.representative_image, 'manual');
  assert.equal(body.policySnapshot.resolved.final_detail, 'manual');
  assert.equal(body.policySnapshot.resolved.size_image, 'auto');
  assert.equal(body.policySnapshot.effectiveSources.representative_image, 'product');
  assert.deepEqual(body.cafe24Registration, { registrationMode: 'update', targetProductNo: '530' });
  assert.equal(body.requiredValues.optionMode, 'none');
});
