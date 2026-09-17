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

/**
 * 2026-09-17 둘째 조각: 펼친 행에서 사람이 하는 일 셋 — 컷 고르기(손·GPT·Claude) · 값 채우기 · Cafe24 승인.
 * QA 서버에는 예약·값·Cafe24 관문 API 가 없어 요청을 가로채 본문을 검사한다(진짜 서버 계약은 routes 테스트가 본다).
 */
async function interceptJson(page, pattern, method, calls, reply) {
  await page.route(pattern, async route => {
    const request = route.request();
    if (request.method() !== method) { await route.fallback(); return; }
    calls.push({ url: request.url(), csrf: request.headers()['x-control-tower-csrf'], body: JSON.parse(request.postData() || '{}') });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(typeof reply === 'function' ? reply(calls.at(-1).body) : reply) });
  });
}

test('컷 고르기: 후보를 눌러 확정하면 그 작업·단계·컷 하나를 예약 API 로 보낸다', { timeout: 60_000 }, async t => {
  const calls = [];
  const { page, external, errors } = await openWorkbench(t, {
    apiPort: 19568, frontendPort: 19588,
    beforeNavigate: candidate => interceptJson(candidate, '**/api/factory/jobs/selections', 'POST', calls, body => ({
      results: body.selections.map(entry => ({ ...entry, status: 'reserved', autoResume: true })), reserved: 1,
    })),
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  await row.locator('.wb-row-head').click();
  const stage = row.locator('.wb-stage').first();
  // 인박스가 가리킨 단계(섹션, 후보 5)가 앞에 온다. 아직 안 고른 최종 상세(후보 3)도 같이 펼친다.
  assert.equal(await stage.getAttribute('data-stage-key'), 'sections');
  assert.equal(await stage.locator('.wb-cut').count(), 5);
  assert.equal(await row.locator('.wb-stage').count(), 2);
  const confirmButton = stage.locator('button[data-action="select-candidate"]');
  assert.equal(await confirmButton.isDisabled(), true, '컷을 고르기 전엔 확정할 수 없어야 한다');
  await stage.locator('.wb-cut[data-candidate-id="sections-b"]').click();
  assert.equal(await stage.locator('.wb-cut[data-candidate-id="sections-b"]').getAttribute('aria-checked'), 'true');
  await stage.locator('button[data-action="select-candidate"]').click();
  await page.waitForFunction(() => /예약했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].csrf, 'CSRF 헤더 없이 예약을 보냈다');
  assert.deepEqual(calls[0].body, {
    mode: 'manual',
    selections: [{ jobId: 'factory-job-qa-2994', stageKey: 'sections', candidateId: 'sections-b' }],
    autoResume: true,
  });
  // 후보 그림은 관제탑·조립공장 주소로만 간다.
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
});

test('컷 고르기: Claude로 고르기는 provider 를 실어 자동 예약을 부르고 영수증을 보인다', { timeout: 60_000 }, async t => {
  const calls = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19569, frontendPort: 19589,
    beforeNavigate: candidate => interceptJson(candidate, '**/api/factory/jobs/selections', 'POST', calls, {
      results: [{
        jobId: 'factory-job-qa-2994', stageKey: 'sections', candidateId: 'sections-c', status: 'reserved', autoResume: true,
        decisionReceipt: { provider: 'claude-oauth', model: 'claude-haiku-4-5', costUsd: 0.0201, reason: '제품이 가장 잘 보이는 정면 컷' },
      }],
      reserved: 1,
    }),
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  await row.locator('.wb-row-head').click();
  await row.locator('.wb-stage').first().locator('button[data-action="judge-claude-oauth"]').click();
  await page.waitForSelector('.wb-receipt[data-provider="claude-oauth"]');
  assert.deepEqual(calls[0].body, {
    mode: 'auto',
    jobIds: ['factory-job-qa-2994'],
    judgementOptions: { model: 'latestModel', reasoningEffort: 'medium', serviceTier: 'standard', preset: 'fast_single', provider: 'claude-oauth' },
    autoResume: true,
  });
  const receipt = await page.locator('.wb-receipt[data-provider="claude-oauth"]').innerText();
  assert.match(receipt, /Claude · claude-haiku-4-5 · \$0\.020 · 고른 컷 sections-c/u);
  assert.match(receipt, /정면 컷/u);
  assert.match(await page.locator('#wb-status').innerText(), /Claude 가 컷을 예약했습니다/u);
  // GPT 버튼도 같은 자리에 있다 — 둘 다 되고 손으로도 된다.
  assert.equal(await row.locator('button[data-action="judge-gpt-oauth"]').count(), 2);
});

test('값 채우기: 빈 칸이 앞에 오고, 신화DB 에서 가져온 값과 손으로 친 값 중 바뀐 칸만 저장한다', { timeout: 60_000 }, async t => {
  const saves = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19570, frontendPort: 19590,
    beforeNavigate: async candidate => {
      // 이 fixture 엔 빈 필수값이 없다. 목록 응답에서 소재를 비워 "값 채우기" 차례를 만든다.
      await candidate.route('**/api/factory/jobs', async route => {
        if (route.request().method() !== 'GET') { await route.fallback(); return; }
        const response = await route.fetch();
        const body = await response.json();
        body.jobs = body.jobs.map(job => job.jobId === 'factory-job-qa-2994'
          ? { ...job, missingRequiredValues: ['material'], requiredValues: { ...(job.requiredValues || {}), material: '' } }
          : job);
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
      await candidate.route('**/api/pdp/sources?*', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          sources: [{ jcode: 965, productName: '가보정보자기', category: '선물포장', detailPageCount: 0, imageCount: 0 }],
        }) });
      });
      await interceptJson(candidate, '**/api/factory/jobs/factory-job-qa-2994/values', 'POST', saves, { accepted: true, job: {} });
    },
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  assert.equal(await row.getAttribute('data-kind'), 'values');
  await row.locator('.wb-row-head').click();
  const form = row.locator('form.wb-values');
  assert.equal(await form.locator('.wb-field').first().getAttribute('data-key'), 'material');
  assert.equal(await form.locator('.wb-field').first().getAttribute('data-missing'), 'true');
  await form.locator('input[name="wb-source-query"]').fill('가보정');
  await form.locator('button[data-action="search-sources"]').click();
  await form.locator('button[data-action="import-source"]').first().click();
  assert.equal(await form.locator('input[name="category"]').inputValue(), '선물포장');
  assert.equal(await form.locator('.wb-field[data-key="category"]').getAttribute('data-prefilled'), 'true');
  await form.locator('input[name="material"]').fill('면');
  await form.locator('button[data-action="save-values"]').click();
  await page.waitForFunction(() => /저장했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(saves.length, 1);
  assert.ok(saves[0].csrf);
  assert.equal(saves[0].body.material, '면');
  assert.equal(saves[0].body.category, '선물포장');
  assert.equal(saves[0].body.productName, '가보정보자기');
  // 안 바뀐 칸은 보내지 않는다.
  assert.equal('salePrice' in saves[0].body, false, JSON.stringify(saves[0].body));
});

test('Cafe24 승인: 열려 있는 제품은 네 단계를 한 번에 밟고, 열려 있지 않은 제품은 먼저 연다', { timeout: 60_000 }, async t => {
  const gate = { preview: [], approve: [], confirm: [], publish: [] };
  const opens = [];
  const dialogs = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19571, frontendPort: 19591,
    beforeNavigate: async candidate => {
      candidate.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.accept(); });
      await interceptJson(candidate, '**/api/cafe24/staging-preview', 'POST', gate.preview, body => ({
        approvalRequestId: 'req-qa-1', payloadDigest: 'sha256:qa-payload', payload: body,
      }));
      await interceptJson(candidate, '**/api/cafe24/approve', 'POST', gate.approve, { approvalToken: 'tok-qa-1' });
      await interceptJson(candidate, '**/api/cafe24/confirm', 'POST', gate.confirm, { confirmationNonce: 'nonce-qa-1' });
      await interceptJson(candidate, '**/api/cafe24/publish', 'POST', gate.publish, {
        status: 'staged_verified', publicationReceipt: { receiptId: 'receipt-qa-1' },
      });
      await interceptJson(candidate, '**/api/factory/jobs/job-qa-3/resume', 'POST', opens, { accepted: true, job: {} });
    },
  });
  // 조립공장이 지금 연 제품(2994)은 승인만 남았다 — 컷 고르기 아래에 관문이 같이 붙는다.
  const live = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  await live.locator('.wb-row-head').click();
  await live.locator('button[data-action="cafe24-publish"]').click();
  await page.waitForFunction(() => /Cafe24 에 등록했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /실제로 등록합니다/u);
  assert.equal(gate.preview.length, 1);
  const preview = gate.preview[0].body;
  assert.equal(preview.productId, 'cafe24:2994');
  assert.equal(preview.categoryId, '71');
  assert.equal(preview.htmlDigest, 'sha256:qa-html');
  assert.equal(preview.imageDigests.length, 4);
  assert.equal(preview.expectedRunId, 'run-qa-13');
  assert.equal(preview.expectedInputFingerprint, 'sha256:qa-input');
  assert.deepEqual([preview.selling, preview.display, preview.market_sync], ['F', 'F', 'F']);
  assert.equal(gate.approve[0].body.approvalRequestId, 'req-qa-1');
  assert.equal(gate.approve[0].body.approved, true);
  assert.equal(gate.approve[0].body.payloadDigest, 'sha256:qa-payload');
  assert.equal(gate.approve[0].body.expectedRunId, 'run-qa-13');
  assert.equal(gate.confirm[0].body.approvalToken, 'tok-qa-1');
  assert.equal(gate.confirm[0].body.confirmed, true);
  assert.equal(gate.publish[0].body.jobId, 'factory-job-qa-2994');
  assert.equal(gate.publish[0].body.approvalToken, 'tok-qa-1');
  assert.equal(gate.publish[0].body.confirmationNonce, 'nonce-qa-1');
  for (const call of [gate.preview[0], gate.approve[0], gate.confirm[0], gate.publish[0]]) assert.ok(call.csrf, 'CSRF 없이 관문을 밟았다');
  assert.deepEqual(await live.locator('.wb-gate li').evaluateAll(nodes => nodes.map(n => n.dataset.state)), ['done', 'done', 'done', 'done']);

  // 생산은 끝났지만 열려 있지 않은 제품(job-qa-3)은 승인 대신 "열기" 부터.
  const idle = page.locator('#wb-queue .wb-row[data-job-id="job-qa-3"]');
  await idle.locator('.wb-row-head').click();
  assert.equal(await idle.locator('button[data-action="cafe24-publish"]').count(), 0);
  await idle.locator('button[data-action="open-in-factory"]').click();
  await page.waitForFunction(() => /여는 중/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(opens.length, 1);
  assert.equal(opens[0].body.restoreOnly, true);
});
