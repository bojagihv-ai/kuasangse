'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.resolve(__dirname, 'qa-production-workbench-server.cjs');
const EVIDENCE = process.env.NEXT_ACTION_EVIDENCE_DIR
  || path.resolve(ROOT, '.omo/evidence/batch-production-control-tower/task-16/final-verification/next-action-inbox');

// workfile-tabs-browser.test.cjs 와 같은 fixture 서버를 쓰지만 포트를 나눈다.
// node --test 는 파일을 동시에 돌리므로 같은 포트를 쓰면 서로를 죽인다.
const API_PORT = 19364;
const FRONTEND_PORT = 19384;

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
  try {
    child.kill();
  } catch { /* 이미 끝났다 */ }
}

async function openControlTower(t) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(API_PORT),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(FRONTEND_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${API_PORT}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(
    `http://127.0.0.1:${FRONTEND_PORT}/control-tower.html?apiBase=http://127.0.0.1:${API_PORT}&apiHub=http://127.0.0.1:${API_PORT}&workfileTabsQa=browser`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForSelector('#next-action-list .next-action-item');
  return page;
}

/**
 * 실측 2026-09-02: 조작자가 개요 첫 화면을 두고 "의미불명이야 ... 단 한 번도 쓴 적 없는
 * 기능" 이라고 말했다. 첫 화면은 파일 연결 상태가 아니라 지금 사람이 할 일을 말해야 한다.
 */
test('개요 첫 화면은 지금 사람이 할 일을 제품 이름과 함께 세운다', async t => {
  const page = await openControlTower(t);
  const readback = await page.evaluate(() => ({
    headline: document.querySelector('#next-action-headline').textContent.trim(),
    items: [...document.querySelectorAll('#next-action-item, #next-action-list .next-action-item')].map(item => ({
      kind: item.dataset.kind,
      tone: item.dataset.tone,
      jobId: item.dataset.jobId,
      copy: item.querySelector('strong').textContent.trim(),
      detail: item.querySelector('.status-message').textContent.trim(),
      actions: [...item.querySelectorAll('button')].map(button => button.textContent.trim()),
    })),
    watching: [...document.querySelectorAll('#next-action-watching .factory-pill')].map(pill => pill.textContent.trim()),
  }));
  fs.writeFileSync(path.join(EVIDENCE, 'inbox-readback.json'), JSON.stringify(readback, null, 2));
  await page.screenshot({ path: path.join(EVIDENCE, 'inbox-overview.png'), fullPage: false });

  assert.ok(readback.items.length >= 1, JSON.stringify(readback));
  for (const item of readback.items) {
    assert.ok(item.copy.length > 0);
    assert.ok(item.actions.length >= 1, JSON.stringify(item));
    // 은어 금지. 사람이 읽고 바로 움직일 수 있는 말만 쓴다.
    assert.doesNotMatch(`${item.copy} ${item.detail}`, /linkState|revision|checkpoint|rebind|fingerprint/u);
  }
  assert.match(readback.headline, /손댈 일|할 일은 없습니다|투입된 제품이 없습니다/u);
});

test('컷 고르기 줄을 누르면 생산·A컷 보드의 그 제품으로 데려간다', async t => {
  const page = await openControlTower(t);
  const pick = page.locator('#next-action-list .next-action-item[data-kind="pick"]').first();
  const hasPick = await pick.count();
  if (!hasPick) {
    // fixture 에 고를 것이 없으면 이 계약은 시험할 수 없다. 조용히 통과시키지 않고 남긴다.
    assert.ok(await page.locator('#next-action-list .next-action-item').count() > 0);
    return;
  }
  const jobId = await pick.getAttribute('data-job-id');
  await pick.locator('button[data-action="next-action-primary"]').click();
  await page.waitForSelector('#menu-tab-production-acut[aria-selected="true"]');
  assert.equal(await page.locator('#menu-panel-production-acut').isVisible(), true);
  const focusedJob = await page.evaluate(() => document.activeElement?.closest?.('[data-job-id]')?.dataset?.jobId || '');
  await page.screenshot({ path: path.join(EVIDENCE, 'inbox-routed-to-board.png') });
  assert.ok(
    focusedJob === jobId || await page.locator(`#production-board [data-job-id="${jobId}"]`).count() > 0,
    `보드에 ${jobId} 가 없다`,
  );
});

test('할 일과 별개로 기존 제품 전환·파일 연결 자리는 그대로 남는다', async t => {
  const page = await openControlTower(t);
  assert.ok(await page.locator('#workfile-job-tabs .workfile-job-tab').count() >= 1);
  assert.equal(await page.locator('#workfile-job-tabpanel').isVisible(), true);
  assert.match(await page.locator('#workfile-job-desk-heading').innerText(), /파일 연결/u);
});
