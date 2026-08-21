const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const SERVER = path.resolve(__dirname, 'qa-production-workbench-server.cjs');
const EVIDENCE = process.env.WORKFILE_TABS_EVIDENCE_DIR
  || path.resolve(ROOT, '.omo/evidence/batch-production-control-tower/task-16/final-verification/batch-workfile-tabs-gui-20260820/browser');
const FIXTURES = process.env.WORKFILE_TABS_FIXTURE_DIR
  || path.resolve(ROOT, '.omo/evidence/batch-production-control-tower/task-16/final-verification/batch-workfile-tabs-gui-20260820/fixtures');
const ACTUAL_B_FIXTURE = process.env.WORKFILE_TABS_ACTUAL_B_FIXTURE
  || path.resolve(ROOT, '.omo/evidence/batch-production-control-tower/task-16/final-verification/batch-workfile-tabs-gui-20260820/retry-3/fixtures/실제-B-중첩-구조.kuasangse');

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
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
}

test('격리 브라우저에서 다중 작업 탭·보기 전환·A컷 다음 단계·반응형 도달성을 검증한다', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const apiPort = 19362;
  const frontendPort = 19382;
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mutationRequests = [];
  page.on('request', request => {
    const parsed = new URL(request.url());
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && parsed.pathname.startsWith('/api/')) {
      mutationRequests.push({ method: request.method(), path: parsed.pathname, body: request.postDataJSON() });
    }
  });
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=browser`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#workfile-job-tabs .workfile-job-tab:nth-child(2)');
  mutationRequests.length = 0;

  const tabs = page.locator('#workfile-job-tabs .workfile-job-tab');
  assert.equal(await tabs.count(), 2);
  assert.equal(await page.locator('#operator-queue-total').innerText(), '2건');
  await page.waitForSelector('#product-list .operator-job-row:nth-child(2)', { state: 'attached' });
  assert.equal(await page.locator('#product-list .operator-job-row').count(), 2);
  assert.match(await page.locator('#workfile-job-tabpanel').innerText(), /연결이 필요/u);
  const unlinkedActions = {
    reselectEnabled: await page.locator('#workfile-job-tabpanel [data-action="reselect-workfile"]').isEnabled(),
    resumeEnabled: await page.locator('#workfile-job-tabpanel [data-action="resume-factory-job"]').isEnabled(),
    candidateWorkbenchEnabled: await page.locator('#workfile-job-tabpanel [data-action="open-active-candidates"]').isEnabled(),
  };
  assert.deepEqual(unlinkedActions, {
    reselectEnabled: true,
    resumeEnabled: false,
    candidateWorkbenchEnabled: false,
  });

  await tabs.nth(1).focus();
  await tabs.nth(1).press('Enter');
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  const focusReadback = await page.evaluate(() => {
    const active = document.activeElement;
    const panel = document.querySelector('#workfile-job-tabpanel');
    const style = getComputedStyle(active);
    return {
      activeId: active.id,
      role: active.getAttribute('role'),
      selected: active.getAttribute('aria-selected'),
      controls: active.getAttribute('aria-controls'),
      panelId: panel.id,
      panelLabelledBy: panel.getAttribute('aria-labelledby'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  });
  assert.equal(focusReadback.role, 'tab');
  assert.equal(focusReadback.selected, 'true');
  assert.equal(focusReadback.controls, focusReadback.panelId);
  assert.equal(focusReadback.panelLabelledBy, focusReadback.activeId);
  assert.notEqual(focusReadback.outlineStyle, 'none');
  assert.notEqual(focusReadback.outlineWidth, '0px');
  await page.screenshot({ path: path.join(EVIDENCE, 'keyboard-focus.png') });
  await tabs.nth(0).focus();
  await tabs.nth(0).press('Space');
  assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
  await tabs.nth(0).press('End');
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  await tabs.nth(1).press('ArrowLeft');
  assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
  await tabs.nth(0).press('ArrowRight');
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  await tabs.nth(1).press('Home');
  assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
  await page.locator('#menu-tab-queue').click();
  const queueRows = page.locator('#product-list .operator-job-row');
  await queueRows.nth(1).click();
  await queueRows.nth(0).focus();
  await queueRows.nth(0).press('Enter');
  await queueRows.nth(1).focus();
  await queueRows.nth(1).press('Enter');
  await tabs.nth(0).click();
  const viewOnlyMutationRequests = [...mutationRequests];
  assert.deepEqual(viewOnlyMutationRequests, []);

  await page.setInputFiles('#workfile-input', path.join(FIXTURES, '방울수저집-A.kuasangse'));
  await page.waitForFunction(() => document.querySelector('#workfile-job-tabs .workfile-job-tab[data-link-state="linked"]'));
  assert.match(await page.locator('#workfile-file-name').innerText(), /방울수저집-A\.kuasangse/u);
  await page.setInputFiles('#workfile-input', path.join(FIXTURES, '긴-한글-B.kuasangse'));
  await page.waitForFunction(() => document.querySelectorAll('#workfile-job-tabs .workfile-job-tab').length === 3);
  assert.match(await page.locator('#workfile-job-tabpanel').innerText(), /정확히 일치하는 작업 식별값이 없어 연결이 필요/u);
  const koreanCopyReadback = `${await page.locator('#workfile-job-tabs').innerText()} ${await page.locator('#workfile-job-tabpanel').innerText()}`;
  assert.doesNotMatch(koreanCopyReadback, /\bunlinked\b|exact identity/u);
  assert.deepEqual(mutationRequests, []);

  await tabs.nth(0).click();
  await page.locator('#menu-tab-production-acut').click();
  await page.locator('#stage-subnav [data-stage-key="sections"]').click();
  await page.waitForSelector('#a-cut-contact-sheet .a-cut-candidate[data-candidate-id="sections-a"]');
  await page.locator('#a-cut-contact-sheet .a-cut-candidate[data-candidate-id="sections-a"] [data-action="select-a-cut-direct"]').click();
  await page.waitForTimeout(1_500);
  const selectionMetrics = await (await page.request.get(`http://127.0.0.1:${apiPort}/__metrics`)).json();
  assert.equal(
    await page.locator('#a-cut-contact-sheet .recent-a-cut-summary').count(),
    1,
    `selection=${JSON.stringify(selectionMetrics.selectionCommands)} status=${await page.locator('#live-status').innerText()}`,
  );
  assert.equal(await page.locator('#a-cut-contact-sheet .a-cut-contact-sheet').getAttribute('data-stage-key'), 'final_detail');
  assert.equal(await page.locator('#a-cut-contact-sheet .recent-a-cut-summary').count(), 1);
  await page.waitForTimeout(1_000);
  const brokenCount = await page.locator('#a-cut-contact-sheet [data-broken="true"]').count();
  assert.equal(
    brokenCount,
    1,
    `candidateImages=${JSON.stringify(await page.locator('#a-cut-contact-sheet img').evaluateAll(images => images.map(image => image.src)))}`,
  );
  const brokenImageText = await page.locator('#a-cut-contact-sheet [data-broken="true"]').innerText();
  assert.equal(brokenImageText, '이미지 불러오기 실패');
  const candidateActionLayout = await page.locator('#a-cut-contact-sheet .a-cut-candidate-actions button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { text: button.innerText, width: rect.width, height: rect.height, wordBreak: getComputedStyle(button).wordBreak };
  }));
  assert.ok(candidateActionLayout.every(button => button.width >= 100 && button.height <= 52 && button.wordBreak === 'keep-all'));
  await page.screenshot({ path: path.join(EVIDENCE, 'broken-image.png') });
  const resumeStatus = await page.locator('#live-status').innerText();
  assert.match(resumeStatus, /재개 요청 접수 · 저장된 작업 상태 확인 중/u);
  assert.doesNotMatch(resumeStatus, /재개 완료/u);

  const viewportResults = [];
  const menuKeys = ['overview', 'queue', 'input-source', 'competitors', 'production-acut', 'automation', 'cafe24', 'audit-sync'];
  for (const viewport of [
    { width: 1280, height: 720, name: 'desktop' },
    { width: 1024, height: 600, name: 'low-height' },
    { width: 375, height: 667, name: 'narrow' },
  ]) {
    await page.setViewportSize(viewport);
    const menuReachable = [];
    for (const key of menuKeys) {
      await page.locator(`#menu-tab-${key}`).click();
      menuReachable.push(await page.locator(`[data-menu-panel="${key}"]`).isVisible());
    }
    await page.locator('#menu-tab-production-acut').click();
    await page.evaluate(() => { document.querySelector('main.page').scrollTop = 0; });
    await page.screenshot({ path: path.join(EVIDENCE, `${viewport.name}-top.png`) });
    await page.evaluate(() => {
      const root = document.querySelector('main.page');
      root.scrollTop = root.scrollHeight;
    });
    await page.screenshot({ path: path.join(EVIDENCE, `${viewport.name}-bottom.png`) });
    viewportResults.push(await page.evaluate(({ width, height, name, menuReachable }) => {
      const root = document.querySelector('main.page');
      return {
        name,
        width,
        height,
        rootScrollable: root.scrollHeight > root.clientHeight,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        menuReachable,
        tabStripOverflowX: getComputedStyle(document.querySelector('#workfile-job-tabs')).overflowX,
      };
    }, { ...viewport, menuReachable }));
  }
  assert.ok(viewportResults.every(result => result.menuReachable.every(Boolean)));
  assert.ok(viewportResults.every(result => result.rootScrollable));
  assert.ok(viewportResults.every(result => !result.horizontalOverflow));

  const metrics = await (await page.request.get(`http://127.0.0.1:${apiPort}/__metrics`)).json();
  assert.equal(metrics.selectionCommands.length, 1);
  assert.deepEqual(metrics.resumeCommands, [{
    imageModel: 'api-hub-openai-image',
    expectedCheckpointRevision: 10,
    expectedCheckpointRunId: 'run-qa-13',
  }]);
  const resumeMutation = mutationRequests.find(request => request.path.endsWith('/resume'));
  assert.ok(mutationRequests.some(request => request.path.endsWith('/select')));
  assert.ok(resumeMutation);
  assert.deepEqual(resumeMutation.body, {
    imageModel: 'api-hub-openai-image',
    expectedCheckpointRevision: 10,
    expectedCheckpointRunId: 'run-qa-13',
  });
  fs.writeFileSync(path.join(EVIDENCE, 'readback.json'), JSON.stringify({
    url,
    title: await page.title(),
    tabCount: await page.locator('#workfile-job-tabs .workfile-job-tab').count(),
    queueTotal: await page.locator('#operator-queue-total').innerText(),
    unlinkedActions,
    koreanCopyReadback,
    viewOnlyMutationRequests,
    mutationRequests,
    focusReadback,
    selectionCommandCount: metrics.selectionCommands.length,
    nextStage: await page.locator('#a-cut-contact-sheet .a-cut-contact-sheet').getAttribute('data-stage-key'),
    brokenImageFallback: { count: brokenCount, text: brokenImageText },
    candidateActionLayout,
    viewportResults,
  }, null, 2));
});

test('격리 B 작업파일은 명시적 rebind read-back 뒤 새 checkpoint로만 resume한다', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const apiPort = 19562;
  const frontendPort = 19582;
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
      CONTROL_TOWER_QA_ACTIVE_PRODUCT: 'B',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mutations = [];
  page.on('request', request => {
    const parsed = new URL(request.url());
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && parsed.pathname.startsWith('/api/')) {
      mutations.push({ method: request.method(), path: parsed.pathname, body: request.postDataJSON() });
    }
  });
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=b-rebind`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#workfile-job-tabs .workfile-job-tab[data-tab-key="job:job-qa-3102"]');
  mutations.length = 0;

  const fixture = ACTUAL_B_FIXTURE;
  const expectedSha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(fixture)).digest('hex');
  const bTab = page.locator('#workfile-job-tabs .workfile-job-tab[data-tab-key="job:job-qa-3102"]');
  await bTab.click();
  assert.equal(await bTab.getAttribute('aria-selected'), 'true');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#workfile-job-tabpanel [data-action="reselect-workfile"]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);
  await page.waitForFunction(() => document.querySelector('[data-tab-key="job:job-qa-3102"]')?.dataset.linkState === 'target_rebind_required');
  assert.equal(await page.locator('#workfile-job-tabpanel [data-action="rebind-workfile"]').isEnabled(), true);
  const explicitAssociationText = await page.locator('#workfile-job-tabpanel [data-action="rebind-workfile"]').innerText();
  assert.match(explicitAssociationText, /선택한 .*B 작업에 이 파일 연결 승인/u);
  await page.setViewportSize({ width: 375, height: 667 });
  const explicitTargetNarrow = await page.locator('#workfile-job-tabpanel [data-action="rebind-workfile"]').evaluate(button => {
    const rect = button.getBoundingClientRect();
    return {
      buttonLeft: rect.left,
      buttonRight: rect.right,
      viewportWidth: document.documentElement.clientWidth,
      rootHorizontalOverflow: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1,
      wordBreak: getComputedStyle(button).wordBreak,
    };
  });
  assert.equal(explicitTargetNarrow.rootHorizontalOverflow, false);
  assert.equal(explicitTargetNarrow.wordBreak, 'keep-all');
  assert.ok(explicitTargetNarrow.buttonLeft >= 0 && explicitTargetNarrow.buttonRight <= explicitTargetNarrow.viewportWidth);
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.deepEqual(mutations, []);
  const preApprovalMutationRequests = [...mutations];
  await page.screenshot({ path: path.join(EVIDENCE, 'b-rebind-before.png') });

  await page.locator('#workfile-job-tabpanel [data-action="rebind-workfile"]').click();
  await page.waitForFunction(() => document.querySelector('#live-status')?.textContent.includes('연결 요청 접수'));
  const rebindTransient = await page.locator('#live-status').innerText();
  assert.match(rebindTransient, /연결 요청 접수 · 저장 완료 확인 대기/u);
  assert.doesNotMatch(rebindTransient, /연결 완료/u);
  await page.waitForFunction(() => document.querySelector('[data-tab-key="job:job-qa-3102"]')?.dataset.linkState === 'linked');
  assert.match(await page.locator('#workfile-job-tabpanel').innerText(), /현재 checkpoint와 승인 작업파일이 일치/u);
  const reboundQueueRow = page.locator('#product-list .operator-job-row[data-job-id="job-qa-3102"]');
  await page.waitForFunction(() => {
    const row = document.querySelector('#product-list .operator-job-row[data-job-id="job-qa-3102"]');
    return row?.textContent.includes('승인 파일 연결 완료 · 작업 재개 대기');
  });
  assert.doesNotMatch(await reboundQueueRow.innerText(), /승인된 작업파일 연결 필요/u);
  const reboundQueueText = await reboundQueueRow.innerText();
  assert.equal(await page.locator('#workfile-job-tabpanel [data-action="resume-factory-job"]').isEnabled(), true);
  await page.screenshot({ path: path.join(EVIDENCE, 'b-rebind-linked.png') });

  const rebindMetrics = await (await page.request.get(`http://127.0.0.1:${apiPort}/__metrics`)).json();
  assert.equal(rebindMetrics.rebindCommands.length, 1);
  assert.ok(rebindMetrics.factoryStateRequests >= 2);
  assert.ok(rebindMetrics.factoryJobsRequests >= 2);
  assert.deepEqual(rebindMetrics.rebindCommands[0], {
    fileName: '실제-B-중첩-구조.kuasangse',
    expectedSha256,
    expectedWorkspaceId: 'qa:other-workspace',
    expectedProductId: 'cafe24:3102',
    expectedProductKey: '미니 데스크 오거나이저 B',
    expectedRunId: 'run-b-87',
    expectedInputFingerprint: 'sha256:other-input',
    expectedWorkfileRevision: 20,
    expectedHydratedWorkfileRevision: 87,
    expectedCheckpointRevision: 20,
    expectedCheckpointRunId: 'run-b-old',
    idempotencyKey: `workfile-rebind:job-qa-3102:20:87:${expectedSha256}`,
    workfileTextLength: fs.readFileSync(fixture, 'utf8').length,
    workfileTextSha256: expectedSha256,
  });
  const rebindMutation = mutations.find(request => request.path.endsWith('/workfile-rebind'));
  assert.equal(rebindMutation.body.workfileText, fs.readFileSync(fixture, 'utf8'));

  await page.locator('#workfile-job-tabpanel [data-action="resume-factory-job"]').click();
  await page.waitForFunction(() => document.querySelector('#live-status')?.textContent.includes('재개 요청 접수'));
  const resumeTransient = await page.locator('#live-status').innerText();
  assert.match(resumeTransient, /재개 요청 접수 · 저장된 작업 상태 확인 중/u);
  assert.doesNotMatch(resumeTransient, /재개 완료/u);
  await page.waitForFunction(() => document.querySelector('[data-tab-key="job:job-qa-3102"]')?.dataset.status === 'running');
  assert.equal(await bTab.getAttribute('data-status'), 'running');
  await page.screenshot({ path: path.join(EVIDENCE, 'b-resume-running.png') });

  const metrics = await (await page.request.get(`http://127.0.0.1:${apiPort}/__metrics`)).json();
  assert.deepEqual(metrics.resumeCommands, [{
    imageModel: 'api-hub-openai-image',
    expectedCheckpointRevision: 87,
    expectedCheckpointRunId: 'run-b-87',
  }]);
  assert.deepEqual(mutations.map(request => request.path), [
    '/api/factory/jobs/job-qa-3102/workfile-rebind',
    '/api/factory/jobs/job-qa-3102/resume',
  ]);
  fs.writeFileSync(path.join(EVIDENCE, 'b-chain-readback.json'), JSON.stringify({
    url,
    explicitAssociationText,
    explicitTargetNarrow,
    preApprovalMutationRequests,
    rebindTransient,
    reboundQueueText,
    persistedReadbacks: {
      factoryStateRequests: rebindMetrics.factoryStateRequests,
      factoryJobsRequests: rebindMetrics.factoryJobsRequests,
    },
    resumeTransient,
    finalTabStatus: await bTab.getAttribute('data-status'),
    rebindPayload: rebindMetrics.rebindCommands[0],
    resumePayload: metrics.resumeCommands[0],
    mutationPaths: mutations.map(request => request.path),
  }, null, 2));
});

test('200개 durable job과 후보 24개 상한을 실제 DOM에서 유지한다', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const apiPort = 19462;
  const frontendPort = 19482;
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
      CONTROL_TOWER_QA_JOB_COUNT: '200',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  const startedAt = Date.now();
  await page.goto(
    `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=bulk200`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(() => document.querySelectorAll('#product-list .operator-job-row').length === 200);
  const renderMs = Date.now() - startedAt;
  assert.equal(await page.locator('#operator-queue-total').innerText(), '200건');
  assert.equal(await page.locator('#product-list .operator-job-row').count(), 200);
  assert.equal(await page.locator('#workfile-job-tabs .workfile-job-tab').count(), 200);
  assert.ok(await page.locator('#a-cut-contact-sheet .a-cut-candidate').count() <= 24);
  assert.ok(renderMs < 10_000, `200-job render took ${renderMs}ms`);
  await page.locator('#menu-tab-queue').click();
  await page.screenshot({ path: path.join(EVIDENCE, 'bulk-200.png'), fullPage: true });
  fs.writeFileSync(path.join(EVIDENCE, 'bulk-200.json'), JSON.stringify({
    renderMs,
    queueRows: await page.locator('#product-list .operator-job-row').count(),
    workfileTabs: await page.locator('#workfile-job-tabs .workfile-job-tab').count(),
    renderedCandidates: await page.locator('#a-cut-contact-sheet .a-cut-candidate').count(),
    rootHorizontalOverflow: await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1),
  }, null, 2));
});
