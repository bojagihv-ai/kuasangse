const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER = path.resolve(__dirname, 'qa-production-workbench-server.cjs');
const EVIDENCE = process.env.TASK21_EVIDENCE_DIR
  || path.resolve(ROOT, '.omo/evidence/batch-production-control-tower/task-21/browser');

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
      request.on('error', error => Date.now() < deadline ? setTimeout(probe, 100) : reject(error));
    };
    probe();
  });
}

function stopProcess(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
}

async function surfaceReadback(page) {
  return page.evaluate(() => {
    const fields = Object.fromEntries([...document.querySelectorAll('#factory-sync-bar [data-field]')]
      .map(node => [node.dataset.field, node.querySelector('dd')?.textContent.trim() || '']));
    return {
      queueIds: [...document.querySelectorAll('#product-list .operator-job-row')].map(node => node.dataset.jobId).filter(Boolean).sort(),
      candidateIds: [...document.querySelectorAll('#a-cut-contact-sheet [data-candidate-id]')].map(node => node.dataset.candidateId).filter(Boolean).sort(),
      selectedIds: [...document.querySelectorAll('#a-cut-contact-sheet [data-selected="true"]')].map(node => node.dataset.candidateId).filter(Boolean).sort(),
      automationPolicy: [...document.querySelectorAll('#automation-policy-matrix [data-decision-id]')].map(node => [node.dataset.decisionId, node.textContent.trim()]),
      currentAssemblyStep: document.querySelector('#operator-assembly-body')?.dataset.stepKey || '',
      workfileIdentity: [fields['workfile-name'], fields.revision, fields['last-save']],
      truthStates: [fields['backend-truth'], fields['factory-truth'], fields['product-truth']],
    };
  });
}

test('Task 21 headed QA: Ctrl+F5 keeps current-product A+B sets and verified receipt alone reveals Cafe24 completion', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const apiPort = 19762;
  const frontendPort = 19782;
  const serverLog = fs.openSync(path.join(EVIDENCE, 'qa-server.log'), 'w');
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, CONTROL_TOWER_QA_API_PORT: String(apiPort), CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort), CONTROL_TOWER_QA_TASK19_STAGE7: '1', CONTROL_TOWER_QA_TASK21_RECEIPT: '1' },
    stdio: ['ignore', serverLog, serverLog],
  });
  t.after(() => { stopProcess(server); fs.closeSync(serverLog); });
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);

  const browser = await chromium.launch({ headless: process.env.TASK21_HEADED !== '1' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&task21=1`;
  await page.goto(url, { waitUntil: 'networkidle' });
  // 8f4569a 부터 작업 큐와 작업대는 '작업 큐' 패널에 있다. 개요에 머물면 숨어 있어 보이지 않는다.
  await page.locator('#menu-tab-queue').click();
  await page.waitForSelector('#menu-panel-queue:not([hidden])');
  await page.waitForSelector('#operator-assembly-body[data-step-key="sections"]');
  await page.locator('#operator-assembly-steps [data-assembly-step="start"]').click();
  await page.waitForSelector('#operator-assembly-body input[name]');
  const requiredBefore = await page.locator('#operator-assembly-body input[name]').evaluateAll(nodes => nodes.map(node => [node.name, node.value]));
  await page.locator('#operator-assembly-steps [data-assembly-step="sections"]').click();
  const before = { ...await surfaceReadback(page), requiredValues: requiredBefore };
  await page.screenshot({ path: path.join(EVIDENCE, 'before-ctrl-f5.png'), fullPage: true });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Page.reload', { ignoreCache: true });
  await page.locator('#menu-tab-queue').click();
  await page.waitForSelector('#menu-panel-queue:not([hidden])');
  await page.waitForSelector('#operator-assembly-body[data-step-key="sections"]');
  await page.waitForSelector('#product-list .operator-job-row[data-job-id="factory-job-qa-2994"]');
  await page.locator('#operator-assembly-steps [data-assembly-step="start"]').click();
  await page.waitForSelector('#operator-assembly-body input[name]');
  const requiredAfter = await page.locator('#operator-assembly-body input[name]').evaluateAll(nodes => nodes.map(node => [node.name, node.value]));
  await page.locator('#operator-assembly-steps [data-assembly-step="sections"]').click();
  const after = { ...await surfaceReadback(page), requiredValues: requiredAfter };
  await page.screenshot({ path: path.join(EVIDENCE, 'after-ctrl-f5.png'), fullPage: true });
  fs.writeFileSync(path.join(EVIDENCE, 'ctrl-f5-readback.json'), JSON.stringify({ before, after, exactEqual: JSON.stringify(before) === JSON.stringify(after) }, null, 2));

  assert.deepEqual(after, before);
  assert.ok(after.truthStates[0].includes('정상'));
  assert.ok(after.truthStates[1].includes('연결됨'));
  assert.ok(after.truthStates[2].includes('방울수저집'));
  assert.equal(await page.locator('#factory-registration-panel [data-field="remote-product-no"] dd').innerText(), '#2994');
  assert.equal(await page.locator('#factory-registration-panel [data-field="readback"] dd').innerText(), '등록 결과 재확인 완료');
});

test('Task 21 UI: staged_verified 문자열만 있는 fixture는 Cafe24 원격 완료를 표시하지 않는다', { timeout: 60_000 }, async t => {
  const apiPort = 19763;
  const frontendPort = 19783;
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, CONTROL_TOWER_QA_API_PORT: String(apiPort), CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort), CONTROL_TOWER_QA_TASK19_STAGE7: '1' },
    stdio: 'ignore',
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&task21=unverified`, { waitUntil: 'networkidle' });
  await page.locator('#menu-tab-cafe24').click();
  await page.waitForFunction(() => [...document.querySelectorAll('#factory-registration-panel [data-field="remote-product-no"]')]
    .some(node => getComputedStyle(node).display !== 'none' && !node.closest('[hidden]')));
  const receipt = await page.locator('#factory-registration-panel [data-field="remote-product-no"]').evaluateAll(nodes => {
    const visible = nodes.find(node => getComputedStyle(node).display !== 'none' && !node.closest('[hidden]'));
    const panel = visible?.closest('#factory-registration-panel');
    return {
      productNo: visible?.querySelector('dd')?.textContent.trim() || '',
      readback: panel?.querySelector('[data-field="readback"] dd')?.textContent.trim() || '',
      status: panel?.getAttribute('data-status') || '',
    };
  });
  assert.deepEqual(receipt, { productNo: '등록 영수증 없음', readback: '원격 read-back 대기', status: 'staged_pending_readback' });
});
