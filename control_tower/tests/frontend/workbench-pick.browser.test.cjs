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
 * 2026-09-17 넷째 조각: 「생성컷 보기」로 확 펼쳐서 A컷을 내가 고르거나, 자동 토글을 켜서 판정자에게 맡긴다.
 * 자동 예약 API 는 QA 서버에 없어 가로챈다. 한 단계·같은 후보 수에는 한 번만 부르는지(새로고침 뒤에도)가 핵심.
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (beforeNavigate) await beforeNavigate(page, context);
  const url = `http://127.0.0.1:${frontendPort}/workbench.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=browser`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#wb-queue .wb-row');
  return { page, context, errors, url };
}

function interceptSelections(page, calls) {
  return page.route('**/api/factory/jobs/selections', async route => {
    const request = route.request();
    if (request.method() !== 'POST') { await route.fallback(); return; }
    const body = JSON.parse(request.postData() || '{}');
    calls.push({ csrf: request.headers()['x-control-tower-csrf'], body });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      results: [{
        jobId: 'factory-job-qa-2994', stageKey: 'sections', candidateId: 'sections-c', status: 'reserved', autoResume: true,
        decisionReceipt: { provider: body.judgementOptions?.provider || 'gpt-oauth', model: 'judge-model', costUsd: 0.01, reason: '자동 고르기 시험' },
      }],
      reserved: 1,
    }) });
  });
}

test('생성컷 보기: 행 버튼이 확 펼치고, 토글을 켜면 한 번만 자동으로 맡기며 새로고침 뒤에도 다시 묻지 않는다', { timeout: 90_000 }, async t => {
  const calls = [];
  const { page, errors, url } = await openWorkbench(t, {
    apiPort: 19574, frontendPort: 19594,
    beforeNavigate: candidate => interceptSelections(candidate, calls),
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  assert.equal(await row.locator('button[data-action="primary"]').innerText(), '생성컷 보기');
  await row.locator('button[data-action="primary"]').click();
  await row.locator('.wb-pick').waitFor();
  // 확 펼쳐진 후보: 섹션 5 + 최종 3, 각 타일에 「크게」.
  assert.equal(await row.locator('.wb-stage[data-stage-key="sections"] .wb-cut').count(), 5);
  assert.equal(await row.locator('.wb-stage[data-stage-key="sections"] .wb-cut-zoom').count(), 5);
  // 토글은 꺼져 있고, 판정자 기본은 Claude.
  const toggle = row.locator('input[name="auto-pick"]');
  assert.equal(await toggle.isChecked(), false);
  assert.equal(await row.locator('select[name="auto-pick-provider"]').inputValue(), 'claude-oauth');
  assert.equal(calls.length, 0);
  await toggle.check();
  await page.waitForFunction(() => /Claude 가 컷을 예약했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].csrf);
  assert.deepEqual(calls[0].body, {
    mode: 'auto', jobIds: ['factory-job-qa-2994'],
    judgementOptions: { model: 'latestModel', reasoningEffort: 'medium', serviceTier: 'standard', preset: 'fast_single', provider: 'claude-oauth' },
    autoResume: true,
  });
  assert.match(await row.locator('.wb-auto-tag').innerText(), /자동 고르기 · Claude/u);
  assert.match(await row.locator('.wb-receipt').innerText(), /Claude · judge-model/u);
  // 2초 폴링이 두 번 지나도 같은 단계엔 다시 묻지 않는다.
  await page.waitForTimeout(4500);
  assert.equal(calls.length, 1, '같은 단계에 자동 고르기를 두 번 불렀다');
  // 새로고침해도 설정은 남고, 이미 맡긴 단계는 다시 묻지 않는다.
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#wb-queue .wb-row');
  await page.waitForTimeout(3000);
  assert.equal(calls.length, 1, '새로고침 뒤 같은 단계를 다시 물었다');
  assert.match(await page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"] .wb-auto-tag').innerText(), /Claude/u);
  assert.deepEqual(errors, []);
});

test('생성컷 보기: 크게 보기는 원본을 dialog 로 띄우고 ESC 로 닫힌다', { timeout: 60_000 }, async t => {
  const { page } = await openWorkbench(t, { apiPort: 19575, frontendPort: 19595 });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  await row.locator('button[data-action="primary"]').click();
  const cut = row.locator('.wb-cut[data-candidate-id="sections-b"]');
  await cut.locator('button[data-action="zoom-cut"]').click({ force: true });
  const dialog = page.locator('dialog.wb-lightbox[open]');
  await dialog.waitFor();
  assert.match(await dialog.locator('img').getAttribute('src'), /\/api\/assets\/thumbnail\/sections-2\.svg$/u);
  assert.match(await dialog.locator('figcaption').innerText(), /^2 · /u);
  // 크게 보기를 눌러도 컷이 골라지진 않는다.
  assert.equal(await cut.getAttribute('aria-checked'), 'false');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.wb-lightbox[open]'));
  // 컷을 누르면 골라지고 확정 버튼이 열린다.
  await cut.click();
  assert.equal(await cut.getAttribute('aria-checked'), 'true');
  assert.equal(await row.locator('.wb-stage[data-stage-key="sections"] button[data-action="select-candidate"]').isDisabled(), false);
});

test('전체 기본값을 GPT 로 두면 기다리는 컷 고르기를 GPT 에게 맡기고, 제품에서 끄면 그 제품만 내가 고른다', { timeout: 90_000 }, async t => {
  const calls = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19576, frontendPort: 19596,
    beforeNavigate: candidate => interceptSelections(candidate, calls),
  });
  await page.locator('#wb-auto-pick-default').selectOption('gpt-oauth');
  await page.waitForFunction(() => /GPT 가 컷을 예약했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.judgementOptions.provider, 'gpt-oauth');
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  assert.match(await row.locator('.wb-auto-tag').innerText(), /GPT \(전체 기본\)/u);
  // 제품에서 끄기: 전체 기본이 켜져 있어도 이 제품은 내가 고른다.
  await row.locator('button[data-action="primary"]').click();
  await row.locator('input[name="auto-pick"]').uncheck();
  await page.waitForFunction(() => /내가 고릅니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(await row.locator('.wb-auto-tag').count(), 0);
  assert.equal(await page.locator('#wb-auto-pick-default').inputValue(), 'gpt-oauth');
});

test('출처 확정: 조립공장이 못 정한 신화DB·Cafe24 매칭을 사람이 못박고, 둘 다 정해지면 이어 돌린다', { timeout: 90_000 }, async t => {
  const commands = [];
  const resumes = [];
  let dbNone = false;
  let cafe24None = false;
  const { page } = await openWorkbench(t, {
    apiPort: 19577, frontendPort: 19597,
    beforeNavigate: async candidate => {
      // 목록: 살아 있는 제품(2994)이 db 단계에서 사람 차례. 투영: 조작 자료에 후보 둘.
      // 테스트가 끝나며 문맥이 닫힌 뒤 도착한 폴링은 조용히 버린다 — 그 오류가 진짜 실패를 가린다.
      await candidate.route('**/api/factory/jobs', async route => {
        if (route.request().method() !== 'GET') { await route.fallback(); return; }
        let response;
        try { response = await route.fetch(); } catch { await route.abort().catch(() => {}); return; }
        const body = await response.json();
        body.jobs = body.jobs.map(job => job.jobId === 'factory-job-qa-2994' ? { ...job, status: 'waiting_manual', stageKey: 'db' } : job);
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
      await candidate.route('**/api/factory/state', async route => {
        let response;
        try { response = await route.fetch(); } catch { await route.abort().catch(() => {}); return; }
        const body = await response.json();
        // 탭 명령은 세션 작업공간이 batch:<jobId> 여야 만들어진다(옛 앞면과 같은 규칙). QA 세션 이름을 그 꼴로 맞춘다.
        body.session = { ...(body.session || {}), workspaceId: 'batch:factory-job-qa-2994', storeRevision: Number.isInteger(body.session?.storeRevision) ? body.session.storeRevision : 3 };
        body.inputs = [...(body.inputs || []).filter(input => input.key !== 'operator_controls'), {
          key: 'operator_controls',
          items: [{
            schema: 'factory-operator-controls:v1',
            db: {
              query: '방울수저집', dbNone, cafe24None, selectedDbCandidateKey: '', selectedCafe24CandidateKey: '',
              dbCandidates: [{ id: '976', title: '동전지갑', selected: false, identity: { candidateKey: '976' }, values: { material: '면', salePrice: '2000' } }],
              cafe24Candidates: [{ id: '570', title: '색동동전지갑', selected: false, identity: { candidateKey: '570' }, values: {} }],
            },
          }],
        }];
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
      await candidate.route('**/api/factory/jobs/factory-job-qa-2994/tab-command', async route => {
        const body = JSON.parse(route.request().postData() || '{}');
        commands.push({ csrf: route.request().headers()['x-control-tower-csrf'], body });
        if (body.action === 'confirm-no-db-candidate') dbNone = true;
        if (body.action === 'confirm-no-cafe24-candidate') cafe24None = true;
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true, orderId: `order-${commands.length}`, status: 'queued' }) });
      });
      await candidate.route('**/api/factory/jobs/factory-job-qa-2994/tab-command/*', async route => {
        const orderId = route.request().url().split('/').pop();
        const command = commands[Number(orderId.split('-')[1]) - 1].body;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          orderId, status: 'applied',
          receipt: { schema: 'factory-tab-command-receipt:v1', status: 'applied', jobId: command.jobId, tabId: command.tabId, action: command.action },
        }) });
      });
      await candidate.route('**/api/factory/jobs/resume', async route => {
        resumes.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ resumed: 1, failed: 0, results: [] }) });
      });
    },
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  assert.equal(await row.locator('button[data-action="primary"]').innerText(), '출처 확정');
  await row.locator('button[data-action="primary"]').click();
  const source = row.locator('.wb-source');
  await source.waitFor();
  assert.equal(await source.locator('.wb-stage[data-source="db"] .wb-cut').count(), 1);
  assert.match(await source.locator('.wb-stage[data-source="db"] .wb-cut-why').innerText(), /소재 면 · 판매가 2000/u);
  await source.locator('button[data-action="confirm-no-db-candidate"]').click();
  await page.waitForFunction(() => /신화사DB 후보 없음 — 조립공장에 적용했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(commands.length, 1);
  assert.ok(commands[0].csrf);
  const first = commands[0].body;
  assert.equal(first.schema, 'factory-tab-command:v1');
  assert.equal(first.tabId, 'db');
  assert.equal(first.action, 'confirm-no-db-candidate');
  assert.equal(first.value, null);
  assert.equal(first.expectedWorkspaceId, 'batch:factory-job-qa-2994');
  assert.equal(first.productKey, '방울수저집');
  assert.equal(first.expectedRunId, 'run-qa-13');
  assert.ok(Number.isInteger(first.expectedRevision));
  assert.match(first.idempotencyKey, /^wb-tab:factory-job-qa-2994:/u);
  assert.equal(resumes.length, 0, '한쪽만 정했는데 이어 돌렸다');
  await page.waitForFunction(() => document.querySelector('.wb-stage[data-source="db"]')?.dataset.decided === 'true');
  await source.locator('button[data-action="confirm-no-cafe24-candidate"]').click();
  await page.waitForFunction(() => /이어서 돌립니다|다시 시작했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(commands[1].body.action, 'confirm-no-cafe24-candidate');
  assert.deepEqual(resumes, [{ jobIds: ['factory-job-qa-2994'] }]);
});

test('섹션 설정: 조립공장 섹션 공정을 그대로 편집한다 — 지시문(프롬프트) 저장·기본 되돌리기·사용 끄기·생성 기준', { timeout: 90_000 }, async t => {
  const commands = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19579, frontendPort: 19599,
    beforeNavigate: async candidate => {
      await candidate.route('**/api/factory/state', async route => {
        let response;
        try { response = await route.fetch(); } catch { await route.abort().catch(() => {}); return; }
        const body = await response.json();
        body.session = { ...(body.session || {}), workspaceId: 'batch:factory-job-qa-2994', storeRevision: Number.isInteger(body.session?.storeRevision) ? body.session.storeRevision : 3 };
        body.inputs = [...(body.inputs || []).filter(input => input.key !== 'operator_controls'), {
          key: 'operator_controls',
          items: [{
            schema: 'factory-operator-controls:v1',
            sections: [
              { id: 'header', label: '헤더 (Header)', enabled: true, order: 0, basisMode: 'current', generationMode: 'mixed', instruction: '', assembly: { sources: { image_analysis: true }, cutUsage: 'auto', note: '' }, content: {} },
              { id: 'hook', label: '훅 (Hook)', enabled: true, order: 1, basisMode: 'current', generationMode: 'mixed', instruction: '기존 지시문', assembly: {}, content: { headline: '옛 제목' } },
            ],
            options: {
              basisModes: [{ id: 'current', label: '현재 지시문' }, { id: 'combined', label: '총합버전' }],
              generationModes: [{ id: 'mixed', label: '이미지 생성 + 글자 따로' }, { id: 'text_only', label: '글자/레이아웃만' }],
              assemblySources: [{ id: 'image_analysis', label: 'AI 분석 + DB 확정값' }, { id: 'competitor_plan', label: '경쟁사 분석플랜' }],
              cutUsages: [{ id: 'none', label: '이미지컷 사용 안 함' }, { id: 'auto', label: 'AI가 어울릴 때만' }],
              cutCandidates: [],
            },
          }],
        }];
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
      await candidate.route('**/api/factory/jobs/factory-job-qa-2994/tab-command', async route => {
        const body = JSON.parse(route.request().postData() || '{}');
        commands.push(body);
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true, orderId: `order-${commands.length}`, status: 'queued' }) });
      });
      await candidate.route('**/api/factory/jobs/factory-job-qa-2994/tab-command/*', async route => {
        const orderId = route.request().url().split('/').pop();
        const command = commands[Number(orderId.split('-')[1]) - 1];
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          orderId, status: 'applied',
          receipt: { schema: 'factory-tab-command-receipt:v1', status: 'applied', jobId: command.jobId, tabId: command.tabId, action: command.action },
        }) });
      });
    },
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  await row.locator('button[data-action="primary"]').click();
  const panel = row.locator('.wb-sections');
  await panel.waitFor();
  assert.match(await panel.locator('summary').first().innerText(), /섹션 설정 · 2개 공정/u);
  assert.equal(await panel.evaluate(node => node.open), false, '섹션 설정은 접혀서 시작한다');
  await panel.locator('summary').first().click();
  const header = panel.locator('.wb-section[data-section-id="header"]');
  assert.match(await header.locator('summary').first().innerText(), /01 헤더 \(Header\) · 사용 · 기준 현재 지시문 · 방식 이미지 생성 \+ 글자 따로 · 지시문 기본/u);
  await header.locator('summary').first().click();
  // 지시문(프롬프트)은 비어 있으면 기본 — 적고 저장하면 그 섹션만.
  const instruction = header.locator('textarea[name="header:instruction"]');
  assert.equal(await instruction.inputValue(), '');
  assert.match(await instruction.getAttribute('placeholder'), /조립공장 기본 지시문/u);
  await instruction.fill('밝은 배경, 제품을 정면 크게');
  await header.locator('button[data-action="save-instruction"]').click();
  await page.waitForFunction(() => /헤더 \(Header\) 지시문 — 조립공장에 적용했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(commands.length, 1);
  assert.equal(commands[0].tabId, 'sections');
  assert.equal(commands[0].action, 'updateSectionInstruction');
  assert.deepEqual(commands[0].value, { sectionId: 'header', value: '밝은 배경, 제품을 정면 크게' });
  assert.equal(commands[0].expectedWorkspaceId, 'batch:factory-job-qa-2994');
  // 이미 직접 지시문이 있는 섹션엔 「기본으로 되돌리기」가 있고, 빈 값을 보낸다.
  const hook = panel.locator('.wb-section[data-section-id="hook"]');
  await hook.locator('summary').first().click();
  await hook.locator('button[data-action="reset-instruction"]').click();
  await page.waitForFunction(() => /훅 \(Hook\) 지시문 기본 — 조립공장에 적용했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.deepEqual(commands[1].value, { sectionId: 'hook', value: '' });
  // 사용 끄기와 생성 기준 저장.
  await hook.locator('button[data-action="section-enabled"]').click();
  await page.waitForFunction(() => /훅 \(Hook\) 끄기 — 조립공장에 적용했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(commands[2].action, 'setSectionEnabled');
  assert.deepEqual(commands[2].value, { sectionId: 'hook', enabled: false });
  await hook.locator('select[name="hook:basisMode"]').selectOption('combined');
  await hook.locator('button[data-action="save-basisMode"]').click();
  await page.waitForFunction(() => /훅 \(Hook\) 생성 기준 — 조립공장에 적용했습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(commands[3].action, 'setSectionBasisMode');
  assert.deepEqual(commands[3].value, { sectionId: 'hook', basisId: 'combined' });
});

test('컷 다시 만들기: 저장된 프롬프트를 읽어 바탕으로 삼고, 새 컷은 옛 보드와 같은 compose-cut 요청으로 보낸다', { timeout: 60_000 }, async t => {
  const composes = [];
  const promptReads = [];
  const { page } = await openWorkbench(t, {
    apiPort: 19581, frontendPort: 19601,
    beforeNavigate: async candidate => {
      // 섹션 단계 첫 후보에 보관함 그림 주소를 달아 프롬프트 기록이 있는 컷으로 만든다.
      await candidate.route('**/api/factory/jobs', async route => {
        if (route.request().method() !== 'GET') { await route.fallback(); return; }
        let response;
        try { response = await route.fetch(); } catch { await route.abort().catch(() => {}); return; }
        const body = await response.json();
        body.jobs = body.jobs.map(job => {
          if (job.jobId !== 'factory-job-qa-2994') return job;
          const stages = (job.progress?.stages || []).map(stage => (stage.key === 'sections' || stage.stageKey === 'sections')
            ? { ...stage, candidates: stage.candidates.map((item, index) => index === 0 ? { ...item, thumbnailUrl: '/api/local-archive/assets/arch0001/image' } : item) }
            : stage);
          return { ...job, progress: { ...job.progress, stages } };
        });
        await route.fulfill({ response, body: JSON.stringify(body) });
      });
      await candidate.route('**/api/factory/archive-prompt/arch0001', async route => {
        promptReads.push(route.request().url());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ archiveId: 'arch0001', prompt: '밝은 회백색 배경, 제품 정면', note: '' }) });
      });
      await candidate.route('**/api/factory/jobs/factory-job-qa-2994/compose-cut', async route => {
        composes.push({ csrf: route.request().headers()['x-control-tower-csrf'], body: JSON.parse(route.request().postData() || '{}') });
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ accepted: true, orderId: 'order-compose-1' }) });
      });
    },
  });
  const row = page.locator('#wb-queue .wb-row[data-job-id="factory-job-qa-2994"]');
  await row.locator('button[data-action="primary"]').click();
  const stage = row.locator('.wb-stage[data-stage-key="sections"]');
  const first = stage.locator('.wb-cut').first();
  await first.locator('button[data-action="show-prompt"]').click();
  await page.waitForFunction(() => /밝은 회백색 배경, 제품 정면/u.test(document.querySelector('#wb-queue')?.textContent || ''));
  assert.equal(promptReads.length, 1);
  // 「이 프롬프트로 새 컷」은 폼을 채우기만 한다 — 보내는 건 사람이.
  await first.locator('button[data-action="prefill-compose"]').click();
  const textarea = stage.locator('textarea[name="compose-sections"]');
  assert.equal(await textarea.inputValue(), '밝은 회백색 배경, 제품 정면');
  assert.equal(composes.length, 0);
  await textarea.fill('밝은 회백색 배경, 제품 정면, 여백 넉넉히');
  await stage.locator('button[data-action="compose-cut"]').click();
  await page.waitForFunction(() => /새 컷을 만들라고 조립공장에 보냈습니다/u.test(document.querySelector('#wb-status')?.textContent || ''));
  assert.equal(composes.length, 1);
  assert.ok(composes[0].csrf);
  assert.deepEqual(composes[0].body, { stageKey: 'sections', prompt: '밝은 회백색 배경, 제품 정면, 여백 넉넉히' });
});
