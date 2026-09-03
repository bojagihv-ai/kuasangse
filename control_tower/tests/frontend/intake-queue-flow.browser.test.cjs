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

function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
}

test('bulk intake submit shows the created product in the overview queue', { timeout: 60_000 }, async t => {
  const apiPort = 19462;
  const frontendPort = 19482;
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

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  let createdJob = null;
  await page.route('**/api/factory/jobs', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
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

  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&intakeQueueFlow=browser`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-input-source').click();
  await page.locator('#go-batch-intake').click();
  await page.waitForFunction(() => document.getElementById('menu-tab-queue')?.getAttribute('aria-selected') === 'true');
  assert.equal(await page.locator('#operator-console-shell').isVisible(), true);
  await page.locator('#menu-tab-input-source').click();
  await page.locator('#bulk-image-input').setInputFiles(path.join(ROOT, 'output/qa_archive_autorefresh_v3.png'));
  await page.locator('[data-default-key="category"]').fill('주머니');
  await page.locator('[data-default-key="material"]').fill('슬라브');
  await page.locator('[data-default-key="originCountry"]').fill('중국');
  await page.locator('[data-default-key="size"]').fill('50x200');
  await page.locator('[data-default-key="salePrice"]').fill('2000');
  await page.locator('[data-default-key="stock"]').fill('99');
  await page.locator('[data-default-key="usage"]').fill('수저집');
  const submit = page.locator('#bulk-intake [data-action="submit"]');
  await submit.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = document.querySelector('#bulk-intake [data-action="submit"]');
    return Boolean(button && !button.disabled);
  });

  // 2026-09-03 부터 첫 클릭은 확인 화면을 연다 — 무엇으로 진행되는지 보지 못한 채
  // 곧바로 큐에 들어가던 것을 고쳤다("자동 수동 선택하는것도 나 한번도 인식하지못했어").
  assert.match(await submit.innerText(), /확인하고 1건 투입/u, 'primary action must explain that it will ask for confirmation first');
  await submit.click();
  const confirmBox = page.locator('#bulk-intake .bulk-confirm-box');
  await confirmBox.waitFor({ state: 'visible' });
  assert.match(await confirmBox.innerText(), /1건을 아래 설정으로 투입합니다/u);
  assert.match(await confirmBox.innerText(), /이미지 생성 모델/u);
  assert.match(await confirmBox.innerText(), /자동화 방식/u);
  assert.match(await submit.innerText(), /이 설정으로 투입/u);
  await submit.click();
  await page.waitForFunction(() => document.getElementById('menu-tab-queue')?.getAttribute('aria-selected') === 'true');
  await page.waitForSelector('#product-list .operator-job-row[data-job-id="factory-job-intake-queue-1"]');
  const row = page.locator('#product-list .operator-job-row[data-job-id="factory-job-intake-queue-1"]');
  assert.equal(await row.isVisible(), true);
  assert.equal(await row.getAttribute('data-just-created'), 'true');
});

/**
 * 실측 2026-09-03: 사진을 고르고 그대로 투입했더니 작업 큐에 IMG_5968 이라는 제품이
 * 생겼고, 그 이름 그대로 경쟁사(마사지건·니트모자 등)까지 검색됐다. 확인 화면이
 * 이걸 미리 말해 줘야 한다.
 */
test('제품명이 사진 파일 이름 그대로면 확인 화면이 경쟁사 검색 경고를 보여준다', { timeout: 60_000 }, async t => {
  const apiPort = 19463;
  const frontendPort = 19483;
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
  await page.locator('#bulk-image-input').setInputFiles(cameraNamedFile);
  await page.locator('[data-default-key="category"]').fill('주머니');
  await page.locator('[data-default-key="material"]').fill('슬라브');
  await page.locator('[data-default-key="originCountry"]').fill('중국');
  await page.locator('[data-default-key="size"]').fill('50x200');
  await page.locator('[data-default-key="salePrice"]').fill('2000');
  await page.locator('[data-default-key="stock"]').fill('99');
  await page.locator('[data-default-key="usage"]').fill('수저집');

  // 카드 자체가 흠으로 알려 준다.
  await page.waitForSelector('.bulk-product-card .bulk-card-verdict');
  assert.match(await page.locator('.bulk-product-card .bulk-card-verdict').innerText(), /제품명이 사진 파일 이름 그대로입니다/u);

  const submit = page.locator('#bulk-intake [data-action="submit"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('#bulk-intake [data-action="submit"]');
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
