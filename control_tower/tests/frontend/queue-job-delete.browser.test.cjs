'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.resolve(__dirname, 'qa-production-workbench-server.cjs');

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

async function openQueue(t, { apiPort, frontendPort }) {
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, CONTROL_TOWER_QA_API_PORT: String(apiPort), CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=browser`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-queue').click();
  await page.waitForSelector('#product-list .operator-job-row');
  return page;
}

/**
 * 실측 2026-09-04: "작업큐 삭제기능좀 넣어줘. 그리고 명목상으로만 삭제가 아니라
 * 실제 기록상으로 지워지게 해줘." 서버 쪽(remove_product_job)이 저장 파일에서 실제로
 * 없애는 것은 백엔드 테스트가 증명한다. 여기서는 그 API 를 화면이 정확히 부르고,
 * 되돌릴 수 없다고 한 번 더 묻고, 취소하면 아무 일도 안 일어나는지를 증명한다.
 */
test('작업 지우기는 되돌릴 수 없다고 확인부터 하고, 확인해야만 지워진다', { timeout: 60_000 }, async t => {
  const page = await openQueue(t, { apiPort: 19464, frontendPort: 19484 });

  let confirmMessage = null;
  page.on('dialog', dialog => { confirmMessage = dialog.message(); void dialog.accept(); });

  // 화면은 2초마다 /api/factory/state 로 큐 전체를 다시 받는다. 이 QA 서버는 삭제를
  // 모르니, 그 응답에서도 지운 작업을 걸러야 진짜 서버처럼 동작한다 — 안 걸러도 화면은
  // 맞게 지우지만(즉시 사라짐), 다음 폴링에 죽었다 살아난 것처럼 보이는 건 이 흉내낸
  // 서버의 한계지 화면의 결함이 아니다.
  let deleted = false;
  const deleteCalls = [];
  await page.route('**/api/factory/jobs/job-qa-3102', async route => {
    const request = route.request();
    deleteCalls.push({ method: request.method(), url: request.url(), headers: request.headers() });
    if (request.method() !== 'DELETE') {
      await route.fallback();
      return;
    }
    deleted = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        jobId: 'job-qa-3102',
        productName: '긴 한글 제품명 검증용 미니 데스크 오거나이저 B',
        removed: true,
      }),
    });
  });
  await page.route('**/api/factory/state*', async route => {
    if (!deleted) {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.jobs)) body.jobs = body.jobs.filter(job => job.jobId !== 'job-qa-3102');
    await route.fulfill({ response, body: JSON.stringify(body) });
  });

  const row = page.locator('#product-list .operator-job-row[data-job-id="job-qa-3102"]');
  await row.locator('[data-action="delete-factory-job"]').click();

  await page.waitForFunction(() => !document.querySelector('#product-list .operator-job-row[data-job-id="job-qa-3102"]'));

  assert.match(confirmMessage || '', /긴 한글 제품명 검증용 미니 데스크 오거나이저 B/u);
  assert.match(confirmMessage || '', /되돌릴 수 없고/u);
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].method, 'DELETE');
  assert.match(deleteCalls[0].url, /\/api\/factory\/jobs\/job-qa-3102$/u);
  assert.ok(deleteCalls[0].headers['x-control-tower-csrf'], 'CSRF 헤더 없이 삭제 요청을 보냈다');

  assert.match(await page.locator('#live-status').innerText(), /긴 한글 제품명 검증용 미니 데스크 오거나이저 B.*지웠습니다/su);
});

test('취소하면 아무 요청도 나가지 않고 작업이 그대로 남는다', { timeout: 60_000 }, async t => {
  const page = await openQueue(t, { apiPort: 19465, frontendPort: 19485 });

  page.on('dialog', dialog => void dialog.dismiss());
  let requested = false;
  await page.route('**/api/factory/jobs/job-qa-3102', async route => {
    if (route.request().method() === 'DELETE') requested = true;
    await route.fallback();
  });

  const row = page.locator('#product-list .operator-job-row[data-job-id="job-qa-3102"]');
  await row.locator('[data-action="delete-factory-job"]').click();
  await page.waitForTimeout(300);

  assert.equal(requested, false, '취소했는데 삭제 요청이 나갔다');
  assert.equal(await row.count(), 1, '취소했는데 행이 사라졌다');
});

test('지금 조립공장이 붙잡은 작업에는 지우기 버튼이 아예 없다', { timeout: 60_000 }, async t => {
  const page = await openQueue(t, { apiPort: 19466, frontendPort: 19486 });
  const currentRow = page.locator('#product-list .operator-job-row[data-current="true"]');
  await currentRow.waitFor({ state: 'visible' });
  assert.equal(await currentRow.locator('[data-action="delete-factory-job"]').count(), 0);
});
