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

/**
 * 2026-09-17: 관제탑 앞면을 세 자리(제품 넣기 · 줄 · 진단)로 깎는 첫 조각.
 * 같은 QA 서버(작업 3건: 선택 대기 1 · 막힘 1 · 완료 1)로 옛 화면과 같은 사실을 보여주는지 본다.
 */
async function openWorkbench(t, { apiPort, frontendPort, beforeNavigate } = {}) {
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
  const external = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!/^(?:127\.0\.0\.1|localhost)$/u.test(url.hostname)) external.push(request.url());
  });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (beforeNavigate) await beforeNavigate(page);
  await page.goto(
    `http://127.0.0.1:${frontendPort}/workbench.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=browser`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForSelector('#wb-queue .wb-row');
  return { page, external, errors };
}

test('줄은 작업 세 건을 상태 한 단어와 함께 세우고, 바깥 출처는 부르지 않는다', { timeout: 60_000 }, async t => {
  const { page, external, errors } = await openWorkbench(t, { apiPort: 19564, frontendPort: 19584 });
  const rows = await page.$$eval('#wb-queue .wb-row', nodes => nodes.map(node => ({
    jobId: node.dataset.jobId,
    state: node.dataset.state,
    label: node.querySelector('.wb-state').textContent.trim(),
    name: node.querySelector('.wb-name b').textContent.trim(),
    strip: [...node.querySelectorAll('.wb-strip i')].map(i => i.dataset.s),
    button: node.querySelector('button[data-action="primary"]').textContent.trim(),
  })));
  assert.equal(rows.length, 3, JSON.stringify(rows));
  const byId = Object.fromEntries(rows.map(row => [row.jobId, row]));
  assert.equal(byId['factory-job-qa-2994'].state, 'mine');
  assert.equal(byId['factory-job-qa-2994'].label, '내 차례');
  assert.equal(byId['job-qa-3102'].state, 'blocked');
  assert.equal(byId['job-qa-3102'].label, '막힘');
  assert.equal(byId['job-qa-3102'].button, '다시 시작');
  // job-qa-3 은 생산은 끝났지만 Cafe24 승인이 남아 있다 — 아직 사람 차례다.
  assert.equal(byId['job-qa-3'].state, 'mine');
  assert.equal(byId['job-qa-3'].label, '내 차례');
  // 급한 것이 위로. 순서는 next-action-model 의 ACTION_ORDER(연결 → 막힘 → 값 → 컷 → Cafe24)를
  // 그대로 따른다 — 막힌 작업이 컷 고르기보다 먼저다(개요 "내 차례" 와 같은 순서).
  assert.deepEqual(rows.map(row => row.state), ['blocked', 'mine', 'mine']);
  for (const row of rows) assert.equal(row.strip.length, 7, `7단계 띠가 아니다: ${row.jobId}`);
  // 머리글은 인박스 그대로: 막힘 1 + 컷 고르기 1 + Cafe24 승인 1 = 손댈 일 3건. 등록까지 끝난 건 없다.
  assert.equal(await page.locator('#wb-count-mine').innerText(), '3');
  assert.equal(await page.locator('#wb-count-done').innerText(), '0');
  assert.match(await page.locator('#wb-headline').innerText(), /손댈 일 3건/u);
  assert.deepEqual(external, [], '바깥 출처를 불렀다');
  assert.deepEqual(errors, []);
});

test('보기 필터는 이름대로 걸러 주고 전부는 전부를 보인다', { timeout: 60_000 }, async t => {
  const { page } = await openWorkbench(t, { apiPort: 19565, frontendPort: 19585 });
  await page.locator('[data-queue-filter="blocked"]').click();
  assert.equal(await page.locator('#wb-queue .wb-row').count(), 1);
  assert.equal(await page.locator('#wb-queue .wb-row').first().getAttribute('data-state'), 'blocked');
  await page.locator('[data-queue-filter="done"]').click();
  // 등록까지 끝난 작업은 이 fixture 에 없다 — 빈 보기는 말로 알린다.
  assert.equal(await page.locator('#wb-queue .wb-row').count(), 0);
  assert.match(await page.locator('#wb-queue .wb-empty').innerText(), /해당하는 제품이 없습니다/u);
  await page.locator('[data-queue-filter="all"]').click();
  assert.equal(await page.locator('#wb-queue .wb-row').count(), 3);
});

test('막힌 행의 다시 시작은 그 작업 하나를 재개 API 로 보낸다', { timeout: 60_000 }, async t => {
  const resumeBodies = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19566, frontendPort: 19586,
    beforeNavigate: async candidate => {
      await candidate.route('**/api/factory/jobs/resume', async route => {
        resumeBodies.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resumed: 1, failed: 0, results: [] }) });
      });
    },
  });
  await page.locator('#wb-queue .wb-row[data-job-id="job-qa-3102"] button[data-action="primary"]').click();
  await page.waitForFunction(() => /다시 시작했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.deepEqual(resumeBodies, [{ jobIds: ['job-qa-3102'] }]);
});

test('작업 지우기는 확인부터 하고, 확인해야만 지우며, 줄에서 사라진다', { timeout: 60_000 }, async t => {
  let confirmMessage = null;
  let deleted = false;
  const deleteCalls = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19567, frontendPort: 19587,
    beforeNavigate: async candidate => {
      candidate.on('dialog', dialog => { confirmMessage = dialog.message(); void dialog.accept(); });
      await candidate.route('**/api/factory/jobs/job-qa-3102', async route => {
        const request = route.request();
        if (request.method() !== 'DELETE') { await route.fallback(); return; }
        deleteCalls.push({ csrf: request.headers()['x-control-tower-csrf'] });
        deleted = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: true, jobId: 'job-qa-3102', productName: '지운 제품', removed: true }) });
      });
      // 2초 폴링이 지운 작업을 되살리지 않게, 목록 응답에서도 걸러 준다(진짜 서버는 실제로 지운다).
      await candidate.route('**/api/factory/jobs', async route => {
        if (!deleted || route.request().method() !== 'GET') { await route.fallback(); return; }
        const response = await route.fetch();
        const body = await response.json();
        if (Array.isArray(body.jobs)) body.jobs = body.jobs.filter(job => job.jobId !== 'job-qa-3102');
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
    },
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="job-qa-3102"]');
  await row.locator('.wb-row-head').click();
  await row.locator('button[data-action="delete-factory-job"]').click();
  await page.waitForFunction(() => !document.querySelector('#wb-queue .wb-row[data-job-id="job-qa-3102"]'));
  assert.match(confirmMessage || '', /되돌릴 수 없고/u);
  assert.equal(deleteCalls.length, 1);
  assert.ok(deleteCalls[0].csrf, 'CSRF 헤더 없이 삭제 요청을 보냈다');
  assert.match(await page.locator('#wb-status').innerText(), /지운 제품.*지웠습니다/su);
});
