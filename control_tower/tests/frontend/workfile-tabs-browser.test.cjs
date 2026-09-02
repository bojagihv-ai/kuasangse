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

test('Stage 1 save status stays visible in the active in-place workbench', { timeout: 60_000 }, async t => {
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
  const externalMutationRequests = [];
  page.on('request', request => {
    const parsed = new URL(request.url());
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      externalMutationRequests.push({ method: request.method(), url: request.url() });
    }
    if (parsed.pathname.startsWith('/api/')) {
      mutationRequests.push({ method: request.method(), path: parsed.pathname, body: request.postDataJSON() });
    }
  });
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=browser`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#product-list .operator-job-row:nth-child(1)');
  await page.locator('#product-list .operator-job-row').nth(0).focus();
  await page.locator('#product-list .operator-job-row').nth(0).press('Enter');
  await page.locator('#operator-assembly-steps [data-assembly-step="start"]').click();

  const stageBody = page.locator('#operator-assembly-body');
  const before = {
    productName: await stageBody.getByLabel('제품명', { exact: true }).inputValue(),
    sourceKind: await stageBody.getByLabel('입력 출처').inputValue(),
  };
  const detailHint = 'task19-b1-detail-hint-red-green-marker';
  await stageBody.getByLabel('상세페이지 제작 힌트').fill(detailHint);
  const successMessage = '투입값 저장했습니다. 이 작업을 재개하면 채운 값으로 진행합니다.';
  const beforeSave = await page.evaluate(message => ({
    matchingStatusNodeCount: [...document.querySelectorAll('.status-message')]
      .filter(node => node.textContent.trim() === message).length,
    boardStatusParent: document.querySelector('#production-board > .status-message')?.parentElement?.id || '',
    gridParent: document.querySelector('.board-grid')?.parentElement?.id || '',
    gridInActiveWorkbench: document.querySelector('#operator-assembly-body')?.contains(document.querySelector('.board-grid')) || false,
  }), successMessage);
  const requestPromise = page.waitForRequest(
    request => request.method() === 'POST' && request.url().endsWith('/api/factory/jobs/factory-job-qa-2994/values'),
  );
  const responsePromise = page.waitForResponse(
    response => response.request().method() === 'POST' && response.url().endsWith('/api/factory/jobs/factory-job-qa-2994/values'),
  );
  await stageBody.getByRole('button', { name: '이 투입값으로 저장' }).click();
  const request = await requestPromise;
  const response = await responsePromise;
  const payload = request.postDataJSON();
  fs.writeFileSync(path.join(EVIDENCE, payload.detailHint ? 'b1-payload-green.json' : 'b1-payload-red.json'), JSON.stringify({
    scenario: 'Stage 1 detailHint textarea -> existing product-values-submit',
    url,
    before,
    payload,
    mutationRequests,
    externalMutationRequests,
    externalWrite: false,
  }, null, 2));
  assert.deepEqual(payload, {
    productName: before.productName,
    detailHint,
    sourceKind: before.sourceKind,
  });
  assert.deepEqual(mutationRequests, [{
    method: 'POST',
    path: '/api/factory/jobs/factory-job-qa-2994/values',
    body: payload,
  }]);
  assert.deepEqual(externalMutationRequests, []);
  const metrics = await (await page.request.get(`http://127.0.0.1:${apiPort}/__metrics`)).json();
  assert.equal(metrics.requests.filter(item => item.method === 'POST' && item.path === '/api/factory/jobs/factory-job-qa-2994/values').length, 1);
  assert.equal(response.status(), 200);
  await page.waitForFunction(message => {
    return [...document.querySelectorAll('.status-message')]
      .some(node => node.textContent === message && node.dataset.tone === 'ok');
  }, successMessage, { timeout: 5_000 });
  const afterSave = await page.evaluate(message => {
    const workbench = document.querySelector('#operator-assembly-body');
    const describe = node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const ancestors = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        ancestors.push({
          tag: parent.tagName,
          id: parent.id,
          className: parent.className,
          hidden: parent.hidden,
          ariaHidden: parent.getAttribute('aria-hidden'),
        });
      }
      return {
        text: node.textContent,
        tone: node.dataset.tone,
        inActiveWorkbench: workbench?.contains(node) || false,
        closestActiveWorkbench: node.closest('#operator-assembly-body')?.id || '',
        parentChain: ancestors,
        hidden: node.hidden,
        ariaHidden: node.getAttribute('aria-hidden'),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    };
    const matching = [...document.querySelectorAll('.status-message')]
      .filter(node => node.textContent.trim() === message)
      .map(describe);
    return {
      matchingStatusNodeCount: matching.length,
      matching,
      gridParent: document.querySelector('.board-grid')?.parentElement?.id || '',
      gridInActiveWorkbench: workbench?.contains(document.querySelector('.board-grid')) || false,
      boardStatusParent: document.querySelector('#production-board > .status-message')?.parentElement?.id || '',
    };
  }, successMessage);
  const saveStatus = afterSave.matching[0]?.text;
  const saveTone = afterSave.matching[0]?.tone;
  fs.writeFileSync(path.join(EVIDENCE, 'status-green.json'), JSON.stringify({
    scenario: 'Stage 1 save status remains visible in the active in-place workbench',
    responseStatus: response.status(),
    saveStatus,
    saveTone,
    payload,
    mutationRequests,
    externalMutationRequests,
    beforeSave,
    afterSave,
  }, null, 2));
  assert.equal(saveStatus, successMessage);
  assert.equal(saveTone, 'ok');
  assert.equal(afterSave.matchingStatusNodeCount, 1, JSON.stringify(afterSave));
  assert.equal(afterSave.matching[0]?.inActiveWorkbench, true, JSON.stringify(afterSave));
  assert.ok(afterSave.matching[0]?.box.width > 0 && afterSave.matching[0]?.box.height > 0, JSON.stringify(afterSave));
});

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
}

test('final_detail 후보는 정확히 매칭된 work-bundle 이미지로 미리보기와 확대를 연다', { timeout: 60_000 }, async t => {
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
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=final-detail-preview`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#product-list .operator-job-row').first().press('Enter');
  await page.locator('#operator-assembly-steps [data-assembly-step="sections"]').press('Enter');

  const finalStrip = page.locator('#operator-assembly-body .board-candidate-strip[data-stage-key="final_detail"]');
  assert.equal(await finalStrip.getAttribute('data-job-id'), 'factory-job-qa-2994');
  const finalCard = finalStrip.locator('.board-candidate').first();
  const finalImage = finalCard.locator('img');
  await finalImage.waitFor({ state: 'visible' });
  const expected = `/api/pdp/work-bundles/${encodeURIComponent('965fe15f-88de-4b61-9421-e1ee29eeb58f')}/assets/${encodeURIComponent('asset:final_detail:1')}/thumbnail`;
  await page.waitForFunction(pathname => document
    .querySelector('#operator-assembly-body .board-candidate-strip[data-stage-key="final_detail"] .board-candidate img')
    ?.getAttribute('src')?.endsWith(pathname), expected);
  const readback = await finalImage.evaluate(image => ({
    src: image.getAttribute('src'),
    zoomSrc: image.getAttribute('data-zoom-src'),
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }));
  assert.ok(readback.src.endsWith(expected), JSON.stringify(readback));
  assert.equal(readback.zoomSrc, expected);
  assert.ok(readback.complete && readback.naturalWidth > 0 && readback.naturalHeight > 0, JSON.stringify(readback));

  await finalImage.click();
  assert.equal(await page.locator('[data-board-zoom="true"]').count(), 1);
});

test('legacy final_detail 후보가 자산 identity 없이 남아도 같은 작업의 보관 출력은 읽기 전용으로 미리본다', { timeout: 60_000 }, async t => {
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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) mutationRequests.push(request.url());
  });
  await page.route('**/api/factory/jobs', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const finalDetail = payload.jobs
      ?.find(job => job.jobId === 'factory-job-qa-2994')
      ?.progress?.stages?.find(stage => stage.key === 'final_detail');
    if (finalDetail) {
      finalDetail.candidates = finalDetail.candidates.map((candidate, index) => ({
        ...candidate,
        id: `legacy-final-detail-${index + 1}`,
        assetId: '',
        thumbnailUrl: '',
      }));
    }
    await route.fulfill({ response, json: payload });
  });
  await page.route('**/api/factory/events**', route => route.abort());
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=final-detail-storyboard`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#product-list .operator-job-row').first().press('Enter');
  await page.locator('#operator-assembly-steps [data-assembly-step="sections"]').press('Enter');

  const finalStrip = page.locator('#operator-assembly-body .board-candidate-strip[data-stage-key="final_detail"]');
  const storyboard = finalStrip.locator('[data-final-detail-storyboard="true"]');
  await storyboard.locator('img').first().waitFor({ state: 'visible' });
  const preview = await storyboard.locator('img').first().evaluate(image => ({
    src: image.getAttribute('src'),
    zoomSrc: image.getAttribute('data-zoom-src'),
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
  }));
  const candidate = finalStrip.locator('button.board-candidate').first();
  const expected = `/api/pdp/work-bundles/${encodeURIComponent('965fe15f-88de-4b61-9421-e1ee29eeb58f')}/assets/${encodeURIComponent('asset:final_detail:1')}/thumbnail`;
  const readback = {
    storyboardCount: await storyboard.count(),
    heading: await storyboard.locator('strong').first().textContent(),
    readOnlyBadge: await storyboard.getByText('읽기 전용', { exact: true }).count(),
    candidateImageCount: await finalStrip.locator('button.board-candidate img').count(),
    candidateDisabled: await candidate.isDisabled(),
    preview,
  };
  fs.writeFileSync(path.join(EVIDENCE, 'final-detail-storyboard-readback.json'), JSON.stringify({
    scenario: 'same-job canonical final_detail output stays read-only when legacy candidate identity is absent',
    url,
    readback,
    mutationRequests,
  }, null, 2));
  assert.equal(readback.heading, '최종 상세 보관 결과 미리보기');
  assert.equal(readback.readOnlyBadge, 1);
  assert.equal(readback.candidateImageCount, 0, JSON.stringify(readback));
  assert.equal(readback.candidateDisabled, true, JSON.stringify(readback));
  assert.ok(readback.preview.src.endsWith(expected), JSON.stringify(readback));
  assert.equal(readback.preview.zoomSrc, expected);
  assert.ok(readback.preview.complete && readback.preview.naturalWidth > 0 && readback.preview.naturalHeight > 0, JSON.stringify(readback));

  await storyboard.locator('img').first().click();
  assert.equal(await page.locator('[data-board-zoom="true"]').count(), 1);
  assert.equal(await page.locator('[data-board-zoom="true"] [data-action="zoom-pick"]').count(), 0);
  await page.locator('[data-board-zoom="true"] [data-action="zoom-close"]').press('Enter');
  assert.equal(await page.locator('[data-board-zoom="true"]').count(), 0);
  assert.deepEqual(mutationRequests, []);
});

test('Task 20 필수값 붙여넣기 미리보기는 저장 없이 빈 칸만 채운다', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  // 이 파일이 이미 쓰는 격리 QA 포트를 순차 테스트에서 재사용한다.
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
  const browser = await chromium.launch({ headless: process.env.CONTROL_TOWER_QA_HEADED !== '1' });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mutations = [];
  const externalMutationRequests = [];
  page.on('request', request => {
    const parsed = new URL(request.url());
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      externalMutationRequests.push({ method: request.method(), url: request.url() });
    }
    if (parsed.pathname.startsWith('/api/')) {
      mutations.push({ method: request.method(), path: parsed.pathname });
    }
  });
  await page.goto(
    `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=task20`,
    { waitUntil: 'networkidle' },
  );
  await page.locator('#product-list .operator-job-row').first().press('Enter');
  await page.locator('#operator-assembly-steps [data-assembly-step="required"]').press('Enter');
  const stageBody = page.locator('#operator-assembly-body');
  const paste = stageBody.getByLabel('필수값 붙여넣기');
  assert.equal(await paste.count(), 1);
  await stageBody.getByRole('button', { name: '붙여넣기 확인' }).press('Enter');
  assert.equal(await stageBody.locator('[data-required-paste-row]').count(), 0);
  assert.equal(await stageBody.getByRole('button', { name: '인식한 값 적용' }).isDisabled(), true);
  await paste.fill([
    '공급가/원가: 500',
    '가로\t200',
    '소재: 덮어쓰면 안 됨',
    '공급가/원가: 700',
    '없는 필드: 값',
    '형식 오류',
  ].join('\n'));
  await stageBody.getByRole('button', { name: '붙여넣기 확인' }).press('Enter');
  const initialStatuses = await stageBody.locator('[data-required-paste-row]').evaluateAll(rows => rows.map(row => row.dataset.status));
  assert.deepEqual(initialStatuses, [
    'recognized', 'recognized', 'locked', 'duplicate', 'unknown', 'malformed',
  ]);
  await page.setViewportSize({ width: 768, height: 600 });
  await stageBody.scrollIntoViewIfNeeded();
  const requiredPreviewGeometry = await page.evaluate(() => {
    const box = node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const overlaps = (first, second) => first.left < second.right && second.left < first.right
      && first.top < second.bottom && second.top < first.bottom;
    const rows = [...document.querySelectorAll('[data-required-paste-row]')]
      .filter(row => row.getClientRects().length > 0);
    const children = rows.flatMap(row => [...row.children]
      .filter(child => child.getClientRects().length > 0)
      .map(child => ({
        text: child.textContent.trim(),
        box: box(child),
        fits: child.scrollWidth <= child.clientWidth + 1 && child.scrollHeight <= child.clientHeight + 1,
      })));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      operatorGridColumns: getComputedStyle(document.querySelector('.operator-console-grid')).gridTemplateColumns.split(' ').length,
      rowCount: rows.length,
      statuses: rows.map(row => row.dataset.status),
      unknownCount: rows.filter(row => row.dataset.status === 'unknown').length,
      childTextFits: children.every(child => child.fits),
      childOverlap: children.some((first, index) => children.slice(index + 1).some(second => overlaps(first.box, second.box))),
      children,
      horizontalOverflow: document.querySelector('main.page').scrollWidth > document.querySelector('main.page').clientWidth + 1,
    };
  });
  await page.screenshot({ path: path.join(EVIDENCE, `${process.env.WORKFILE_TABS_EVIDENCE_PHASE || 'after'}-768.png`), fullPage: true });
  fs.writeFileSync(path.join(EVIDENCE, `${process.env.WORKFILE_TABS_EVIDENCE_PHASE || 'after'}-768.json`), JSON.stringify(requiredPreviewGeometry, null, 2));
  assert.equal(requiredPreviewGeometry.operatorGridColumns, 1, '768px operator console must stack to one column');
  assert.equal(requiredPreviewGeometry.rowCount, 6);
  assert.equal(requiredPreviewGeometry.unknownCount, 1);
  assert.equal(requiredPreviewGeometry.childOverlap, false, '768px CJK preview text boxes must not overlap');
  assert.equal(requiredPreviewGeometry.childTextFits, true, '768px CJK preview text must fit its visible boxes');
  assert.equal(requiredPreviewGeometry.horizontalOverflow, false);
  assert.equal(await stageBody.getByRole('button', { name: '인식한 값 적용' }).isEnabled(), true);
  await stageBody.getByRole('button', { name: '인식한 값 적용' }).press('Enter');
  assert.equal(await stageBody.locator('[name="supplyPrice"]').inputValue(), '500');
  assert.equal(await stageBody.locator('[name="widthMm"]').inputValue(), '200');
  assert.equal(await stageBody.locator('[name="material"]').inputValue(), '면');
  assert.deepEqual(mutations, []);
  await stageBody.locator('[name="optionMode"]').selectOption('');
  await paste.fill('옵션 여부: 옵션 있음\n옵션 여부: 지원 안 함');
  await stageBody.getByRole('button', { name: '붙여넣기 확인' }).press('Enter');
  assert.deepEqual(await stageBody.locator('[data-required-paste-row]').evaluateAll(rows => rows.map(row => row.dataset.status)), ['recognized', 'malformed']);
  await stageBody.getByRole('button', { name: '인식한 값 적용' }).press('Enter');
  assert.equal(await stageBody.locator('[name="optionMode"]').inputValue(), 'provided');
  await paste.fill('세로/길이: 150');
  await stageBody.getByRole('button', { name: '붙여넣기 확인' }).press('Enter');
  await paste.fill('세로/길이: 160');
  const textareaChangedDisablesApply = await stageBody.getByRole('button', { name: '인식한 값 적용' }).isDisabled();
  assert.equal(textareaChangedDisablesApply, true);
  assert.equal(await stageBody.locator('[data-required-paste-row]').count(), 0);
  await stageBody.getByRole('button', { name: '붙여넣기 확인' }).press('Enter');
  await stageBody.locator('[name="depthMm"]').fill('직접 입력 140');
  await stageBody.getByRole('button', { name: '인식한 값 적용' }).press('Enter');
  assert.equal(await stageBody.locator('[name="depthMm"]').inputValue(), '직접 입력 140');
  await paste.fill(Array.from({ length: 30 }, (_, index) => `긴 한글 미인식 필드 ${index + 1}: 값`).join('\n'));
  await stageBody.getByRole('button', { name: '붙여넣기 확인' }).press('Enter');
  assert.equal(await stageBody.locator('[data-required-paste-row]').count(), 30);
  assert.equal(await stageBody.getByRole('button', { name: '인식한 값 적용' }).isDisabled(), true);
  const viewports = [];
  for (const viewport of [
    { width: 1280, height: 720, name: '1280' },
    { width: 768, height: 600, name: '768' },
    { width: 375, height: 667, name: '375' },
  ]) {
    await page.setViewportSize(viewport);
    await stageBody.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE, `task20-${viewport.name}.png`), fullPage: true });
    viewports.push(await page.evaluate(viewportValue => {
      const root = document.querySelector('main.page');
      const panel = document.querySelector('#operator-assembly-body .board-intake-panel');
      const controls = [...panel.querySelectorAll('textarea, button, input, select')].filter(control => control.getClientRects().length > 0);
      root.scrollTop = root.scrollHeight;
      return {
        ...viewportValue,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        allControlsReachable: controls.every(control => {
          const rect = control.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= root.clientWidth + 1;
        }),
        reachedBottom: root.scrollTop + root.clientHeight >= root.scrollHeight - 1,
        columns: getComputedStyle(panel.querySelector('.board-cafe24-fields')).gridTemplateColumns.split(' ').length,
        operatorGridColumns: getComputedStyle(document.querySelector('.operator-console-grid')).gridTemplateColumns.split(' ').length,
        buttonHeights: controls.filter(control => control.tagName === 'BUTTON').map(control => control.getBoundingClientRect().height),
        requiredPasteGeometry: viewportValue.width === 768 ? (() => {
          const children = [...panel.querySelectorAll('[data-required-paste-row]')]
            .filter(row => row.getClientRects().length > 0)
            .flatMap(row => [...row.children].filter(child => child.getClientRects().length > 0).map(child => {
              const rect = child.getBoundingClientRect();
              return {
                text: child.textContent.trim(),
                box: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
                fits: child.scrollWidth <= child.clientWidth + 1 && child.scrollHeight <= child.clientHeight + 1,
              };
            }));
          const overlaps = (first, second) => first.left < second.right && second.left < first.right
            && first.top < second.bottom && second.top < first.bottom;
          return {
            rowCount: panel.querySelectorAll('[data-required-paste-row]').length,
            childTextFits: children.every(child => child.fits),
            childOverlap: children.some((first, index) => children.slice(index + 1).some(second => overlaps(first.box, second.box))),
          };
        })() : null,
      };
    }, viewport));
  }
  assert.ok(viewports.every(viewport => !viewport.horizontalOverflow && viewport.allControlsReachable && viewport.reachedBottom));
  assert.ok(viewports.every(viewport => viewport.buttonHeights.every(height => height >= 44)));
  assert.deepEqual(viewports.map(viewport => viewport.operatorGridColumns), [2, 1, 1]);
  assert.deepEqual(viewports[1].requiredPasteGeometry, {
    rowCount: 30,
    childTextFits: true,
    childOverlap: false,
  });
  assert.equal(viewports.at(-1).columns, 1);
  const pasteReadback = {
    initialStatuses,
    supplyPrice: await stageBody.locator('[name="supplyPrice"]').inputValue(),
    widthMm: await stageBody.locator('[name="widthMm"]').inputValue(),
    material: await stageBody.locator('[name="material"]').inputValue(),
    stalePreview: {
      textareaChangedDisablesApply,
      userTypedDepthPreserved: await stageBody.locator('[name="depthMm"]').inputValue(),
    },
    optionMode: await stageBody.locator('[name="optionMode"]').inputValue(),
    mutations: [...mutations],
  };
  assert.deepEqual(pasteReadback.mutations, []);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#menu-tab-production-acut').press('Enter');
  await page.locator('#stage-subnav [data-stage-key="sections"]').press('Enter');
  const candidate = page.locator('#a-cut-contact-sheet .a-cut-candidate').first();
  const zoomTrigger = candidate.locator('.work-bundle-image-trigger');
  await zoomTrigger.focus();
  await zoomTrigger.press('Enter');
  const dialog = page.locator('#work-bundle-image-dialog');
  assert.equal(await dialog.evaluate(node => node.open), true);
  await page.screenshot({ path: path.join(EVIDENCE, 'task20-candidate-zoom.png'), fullPage: true });
  await dialog.getByRole('button', { name: '닫기' }).press('Enter');
  assert.equal(await dialog.evaluate(node => node.open), false);
  const select = candidate.locator('[data-action="select-a-cut-direct"]');
  await select.focus();
  assert.equal(await select.evaluate(node => document.activeElement === node), true);
  await select.press('Enter');
  await page.waitForFunction(() => document.querySelector('#a-cut-contact-sheet .recent-a-cut-summary'));
  const candidateReadback = {
    keyboardFocused: true,
    zoomOpened: true,
    zoomClosed: true,
    selectedSummary: await page.locator('#a-cut-contact-sheet .recent-a-cut-summary').count(),
    localMutations: mutations.slice(pasteReadback.mutations.length),
  };
  assert.deepEqual(externalMutationRequests, []);
  fs.writeFileSync(path.join(EVIDENCE, 'task20-paste-readback.json'), JSON.stringify({
    pasteReadback,
    viewports,
    candidateReadback,
    externalMutationRequests,
  }, null, 2));
});

async function openStage1Qa(t) {
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
  const mutations = [];
  const externalRequests = [];
  page.on('request', request => {
    const parsed = new URL(request.url());
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      externalRequests.push({ method: request.method(), url: request.url() });
    }
    if (request.method() === 'POST' && parsed.pathname.endsWith('/values')) {
      mutations.push({ path: parsed.pathname, body: request.postDataJSON() });
    }
  });
  await page.goto(
    `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=task19-adversarial`,
    { waitUntil: 'networkidle' },
  );
  const rows = page.locator('#product-list .operator-job-row');
  await rows.nth(0).focus();
  await rows.nth(0).press('Enter');
  await page.locator('#operator-assembly-steps [data-assembly-step="start"]').press('Enter');
  return { page, apiPort, rows, stageBody: page.locator('#operator-assembly-body'), mutations, externalRequests };
}

async function saveStage1(stageBody, hint) {
  await stageBody.getByLabel('상세페이지 제작 힌트').fill(hint);
  const response = stageBody.page().waitForResponse(item => {
    const pathname = new URL(item.url()).pathname;
    return item.request().method() === 'POST' && /^\/api\/factory\/jobs\/[^/]+\/values$/u.test(pathname);
  });
  await stageBody.getByRole('button', { name: '이 투입값으로 저장' }).press('Enter');
  return response;
}

async function canonicalStatus(page) {
  return page.evaluate(() => {
    const workbench = document.querySelector('#operator-assembly-body');
    const nodes = [...document.querySelectorAll('.operator-live-surface > .status-message')];
    return {
      count: nodes.length,
      text: nodes[0]?.textContent || '',
      tone: nodes[0]?.dataset.tone || '',
      hidden: nodes[0]?.hidden ?? true,
      owned: Boolean(nodes[0] && workbench?.contains(nodes[0])),
      box: nodes[0] ? { width: nodes[0].getBoundingClientRect().width, height: nodes[0].getBoundingClientRect().height } : { width: 0, height: 0 },
    };
  });
}

test('Stage 1 status stays scoped across A B A view switching', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const qa = await openStage1Qa(t);
  const submitted = {
    productName: 'task19-a-b-a-product',
    detailHint: 'task19-a-b-a-unique-hint',
    sourceKind: 'direct',
  };
  await qa.stageBody.getByLabel('제품명', { exact: true }).fill(submitted.productName);
  await qa.stageBody.getByLabel('입력 출처').selectOption(submitted.sourceKind);
  assert.equal((await saveStage1(qa.stageBody, submitted.detailHint)).status(), 200);
  await qa.page.waitForFunction(() => document.querySelector('.operator-live-surface > .status-message')?.dataset.tone === 'ok');
  const productAAfterSave = await canonicalStatus(qa.page);

  await qa.rows.nth(1).focus();
  await qa.rows.nth(1).press('Enter');
  await qa.page.waitForSelector('#operator-assembly-body[data-step-key="cuts"]');
  const productB = await canonicalStatus(qa.page);

  await qa.rows.nth(0).focus();
  await qa.rows.nth(0).press('Enter');
  await qa.page.waitForSelector('#operator-assembly-body[data-step-key="sections"]');
  await qa.page.locator('#operator-assembly-steps [data-assembly-step="start"]').press('Enter');
  await qa.page.waitForSelector('#operator-assembly-body[data-step-key="start"]');
  const productAReturn = await canonicalStatus(qa.page);
  const returnedValues = {
    productName: await qa.stageBody.getByLabel('제품명', { exact: true }).inputValue(),
    detailHint: await qa.stageBody.getByLabel('상세페이지 제작 힌트').inputValue(),
    sourceKind: await qa.stageBody.getByLabel('입력 출처').inputValue(),
  };

  fs.writeFileSync(path.join(EVIDENCE, 'adversarial-a-b-a.json'), JSON.stringify({ submitted, returnedValues, productAAfterSave, productB, productAReturn, mutations: qa.mutations, externalRequests: qa.externalRequests }, null, 2));
  assert.deepEqual(productAAfterSave, { count: 1, text: '투입값 저장했습니다. 이 작업을 재개하면 채운 값으로 진행합니다.', tone: 'ok', hidden: false, owned: true, box: productAAfterSave.box });
  assert.ok(productAAfterSave.box.width > 0 && productAAfterSave.box.height > 0);
  assert.equal(productB.count, 1);
  assert.equal(productB.text, '');
  assert.equal(productB.hidden, true);
  assert.equal(productAReturn.text, productAAfterSave.text);
  assert.equal(productAReturn.tone, 'ok');
  assert.equal(productAReturn.owned, true);
  assert.ok(productAReturn.box.width > 0 && productAReturn.box.height > 0);
  assert.deepEqual(returnedValues, submitted);
  assert.deepEqual(qa.externalRequests, []);
});

test('Stage 1 repeated saves keep one visible canonical status', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const qa = await openStage1Qa(t);
  assert.equal((await saveStage1(qa.stageBody, 'task19-repeat-first')).status(), 200);
  assert.equal((await saveStage1(qa.stageBody, 'task19-repeat-second')).status(), 200);
  await qa.page.waitForFunction(() => document.querySelector('.operator-live-surface > .status-message')?.dataset.tone === 'ok');
  const status = await canonicalStatus(qa.page);
  const metrics = await (await qa.page.request.get(`http://127.0.0.1:${qa.apiPort}/__metrics`)).json();
  fs.writeFileSync(path.join(EVIDENCE, 'adversarial-repeated-save.json'), JSON.stringify({ status, mutations: qa.mutations, valueSaveAttempts: metrics.valueSaveAttempts, externalRequests: qa.externalRequests }, null, 2));
  assert.equal(qa.mutations.length, 2);
  assert.equal(qa.mutations[1].path, '/api/factory/jobs/factory-job-qa-2994/values');
  assert.equal(qa.mutations[1].body.detailHint, 'task19-repeat-second');
  assert.deepEqual(metrics.valueSaveAttempts.map(item => item.status), [200, 200]);
  assert.equal(status.count, 1);
  assert.equal(status.tone, 'ok');
  assert.equal(status.owned, true);
  assert.ok(status.box.width > 0 && status.box.height > 0);
  assert.deepEqual(qa.externalRequests, []);
});

test('Stage 1 failed save replaces success with a visible error and recovers', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const qa = await openStage1Qa(t);
  assert.equal((await saveStage1(qa.stageBody, 'task19-failure-before')).status(), 200);
  await qa.page.request.post(`http://127.0.0.1:${qa.apiPort}/__qa/fail-next-values`);
  assert.equal((await saveStage1(qa.stageBody, 'task19-failure-injected')).status(), 500);
  await qa.page.waitForFunction(() => document.querySelector('.operator-live-surface > .status-message')?.dataset.tone === 'error');
  const failed = await canonicalStatus(qa.page);
  const afterFailure = await (await qa.page.request.get(`http://127.0.0.1:${qa.apiPort}/__metrics`)).json();
  assert.equal((await saveStage1(qa.stageBody, 'task19-failure-recovered')).status(), 200);
  await qa.page.waitForFunction(() => document.querySelector('.operator-live-surface > .status-message')?.dataset.tone === 'ok');
  const recovered = await canonicalStatus(qa.page);
  const afterRecovery = await (await qa.page.request.get(`http://127.0.0.1:${qa.apiPort}/__metrics`)).json();
  fs.writeFileSync(path.join(EVIDENCE, 'adversarial-http-failure.json'), JSON.stringify({ failed, recovered, attemptsAfterFailure: afterFailure.valueSaveAttempts, attemptsAfterRecovery: afterRecovery.valueSaveAttempts, failNextValues: afterRecovery.failNextValues, mutations: qa.mutations, externalRequests: qa.externalRequests }, null, 2));
  assert.equal(failed.count, 1);
  assert.equal(failed.tone, 'error');
  assert.equal(failed.owned, true);
  assert.match(failed.text, /^투입값 저장 실패/u);
  assert.doesNotMatch(failed.text, /저장했습니다/u);
  assert.deepEqual(afterFailure.valueSaveAttempts.map(item => item.status), [200, 500]);
  assert.equal(qa.mutations[1].path, '/api/factory/jobs/factory-job-qa-2994/values');
  assert.equal(qa.mutations[1].body.detailHint, 'task19-failure-injected');
  assert.equal(recovered.count, 1);
  assert.equal(recovered.tone, 'ok');
  assert.equal(recovered.owned, true);
  assert.deepEqual(afterRecovery.valueSaveAttempts.map(item => item.status), [200, 500, 200]);
  assert.equal(afterRecovery.failNextValues, false);
  assert.deepEqual(qa.externalRequests, []);
});

test('정상 fixture history의 Stage6 결과 썸네일은 모두 로드된다', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const apiPort = 19762;
  const frontendPort = 19782;
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
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=stage6-history`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#product-list .operator-job-row').first().focus();
  await page.locator('#product-list .operator-job-row').first().press('Enter');
  await page.locator('#operator-assembly-steps [data-assembly-step="sections"]').press('Enter');
  const history = await page.request.get(`http://127.0.0.1:${apiPort}/api/factory/jobs/factory-job-qa-2994/history`);
  assert.equal(history.status(), 200);
  assert.ok(Array.isArray((await history.json()).workBundle?.assets));
  const malformedHistory = await new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port: apiPort, path: '/api/factory/jobs/%ZZ/history' }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(responseBody) }));
    });
    request.on('error', reject);
  });
  assert.equal(malformedHistory.status, 200);
  assert.deepEqual(malformedHistory.body, {
    workBundle: { id: '', bundleKey: '', workfileName: '', version: 0, assets: [] },
    history: [],
  });
  const healthAfterMalformedHistory = await page.request.get(`http://127.0.0.1:${apiPort}/api/health`);
  assert.equal(healthAfterMalformedHistory.status(), 200);
  await page.waitForSelector('#operator-assembly-body > .operator-live-surface[data-surface="sections"]');
  await page.waitForSelector('#operator-assembly-body > .operator-live-surface[data-surface="sections"] .board-result-strip img');
  const readback = await page.evaluate(() => {
    const surface = document.querySelector('#operator-assembly-body > .operator-live-surface[data-surface="sections"]');
    const strip = surface.querySelector('.board-result-strip');
    return {
      text: strip.innerText,
      images: [...strip.querySelectorAll('img')].map(image => ({
        src: image.getAttribute('src'), complete: image.complete, naturalWidth: image.naturalWidth,
      })),
      brokenCount: surface.querySelectorAll('[data-broken="true"]').length,
      finalDetail: [...surface.querySelectorAll('img[src*="final_detail-3.svg"]')].map(image => ({
        complete: image.complete, naturalWidth: image.naturalWidth,
      })),
    };
  });
  assert.ok(readback.images.length > 0, JSON.stringify(readback));
  assert.doesNotMatch(readback.text, /불러오지 못했습니다/u);
  assert.ok(readback.images.every(image => image.complete && image.naturalWidth > 0), JSON.stringify(readback));
  assert.equal(readback.brokenCount, 0, JSON.stringify(readback));
  assert.equal(readback.finalDetail.length, 1, JSON.stringify(readback));
  assert.ok(readback.finalDetail[0].complete && readback.finalDetail[0].naturalWidth > 0, JSON.stringify(readback));
  await page.screenshot({ path: path.join(EVIDENCE, 'normal-stage6-result-strip.png') });
  fs.writeFileSync(path.join(EVIDENCE, 'normal-stage6-result-strip.json'), JSON.stringify({
    url,
    historyStatus: history.status(),
    malformedHistory,
    healthAfterMalformedHistory: healthAfterMalformedHistory.status(),
    readback,
  }, null, 2));
});

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
      CONTROL_TOWER_QA_BROKEN_THUMBNAIL: '1',
      CONTROL_TOWER_QA_TASK19_STAGE7: '1',
      CONTROL_TOWER_QA_TASK21_RECEIPT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const mutationRequests = [];
  const externalMutationRequests = [];
  page.on('request', request => {
    const parsed = new URL(request.url());
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) return;
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      externalMutationRequests.push({ method: request.method(), url: request.url() });
    }
    if (parsed.pathname.startsWith('/api/')) {
      mutationRequests.push({ method: request.method(), path: parsed.pathname, body: request.postDataJSON() });
    }
  });
  const url = `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=browser`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#workfile-job-tabs .workfile-job-tab:nth-child(3)');
  mutationRequests.length = 0;

  const tabs = page.locator('#workfile-job-tabs .workfile-job-tab');
  assert.equal(await tabs.count(), 3);
  assert.equal(await page.locator('#operator-queue-total').innerText(), '3건');
  await page.waitForSelector('#product-list .operator-job-row:nth-child(3)', { state: 'attached' });
  assert.equal(await page.locator('#product-list .operator-job-row').count(), 3);
  const workbenchSteps = page.locator('#operator-assembly-steps [data-assembly-step]');
  assert.equal(await workbenchSteps.count(), 7);
  // Task 21 fixture는 staged_verified remote read-back 영수증이 있어야 전송 완료로 보인다.
  assert.deepEqual(await workbenchSteps.allTextContents(), [
    '01시작완료',
    '02DB 확정완료',
    '03필수값완료',
    '04경쟁사완료',
    '05생성컷 선택완료',
    '06섹션 생성선택 필요 · 8',
    '07전송완료',
  ]);
  assert.equal(await page.locator('#menu-tab-overview').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#operator-assembly-body').getAttribute('data-step-key'), 'sections');
  let competitorReadback = null;
  for (let index = 0; index < 7; index += 1) {
    await workbenchSteps.nth(index).click();
    assert.equal(await page.locator('#menu-tab-overview').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#product-list .operator-job-row').count(), 3);
    assert.equal(await page.locator('#operator-assembly-body').getAttribute('data-step-key'), [
      'start', 'db', 'required', 'competitors', 'cuts', 'sections', 'send',
    ][index]);
    if (index === 3) {
      const cards = page.locator('#operator-assembly-body .review-candidate');
      await cards.first().waitFor({ state: 'visible' });
      await cards.last().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll('#operator-assembly-body .review-candidate img')]
        .every(image => image.complete && image.naturalWidth > 0));
      competitorReadback = {
        cards: await cards.count(),
        selected: await page.locator('#operator-assembly-body .review-candidate[data-preview="true"]').count(),
        analyzed: await cards.filter({ hasText: '분석 완료' }).count(),
        imagesLoaded: await cards.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)),
      };
    }
  }
  assert.deepEqual(competitorReadback, { cards: 2, selected: 1, analyzed: 1, imagesLoaded: true });
  assert.deepEqual(mutationRequests, []);
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
  assert.equal(await tabs.nth(2).getAttribute('aria-selected'), 'true');
  await tabs.nth(2).press('ArrowLeft');
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
  await tabs.nth(1).press('ArrowRight');
  assert.equal(await tabs.nth(2).getAttribute('aria-selected'), 'true');
  await tabs.nth(2).press('Home');
  assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true');
  await page.locator('#menu-tab-overview').click();
  const filterReadback = {};
  for (const [filter, count] of [['all', 3], ['selection', 1], ['blocked', 1], ['running', 0], ['completed', 1]]) {
    const button = page.locator(`[data-queue-filter="${filter}"]`);
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#product-list .operator-job-row').count(), count);
    filterReadback[filter] = {
      count,
      total: await page.locator('#operator-queue-total').innerText(),
      empty: await page.locator('#product-list .operator-empty-state').count(),
    };
  }
  assert.equal(filterReadback.running.empty, 1);
  await page.locator('[data-queue-filter="all"]').click();
  const queueRows = page.locator('#product-list .operator-job-row');
  const canonicalCafe24Actions = [
    'cafe24-preflight',
    'cafe24-preview',
    'cafe24-approve',
    'confirm-cafe24-target',
    'cafe24-execute',
  ];
  const expectedLiveRegistrationActions = canonicalCafe24Actions;
  await queueRows.nth(0).focus();
  await queueRows.nth(0).press('Enter');
  await page.locator('#operator-assembly-steps [data-assembly-step="send"]').click();
  const liveRegistrationActions = await page.locator('#operator-assembly-body .registration-actions [data-action]').evaluateAll(
    controls => controls.map(control => control.dataset.action),
  );
  const liveRegistrationReadback = {
    actions: liveRegistrationActions,
    confirmEnabled: !(await page.locator('#operator-assembly-body [data-action="confirm-cafe24-target"]').isDisabled()),
    reconcileExpected: false,
  };
  assert.equal(liveRegistrationReadback.confirmEnabled, true);
  await queueRows.nth(1).click();
  assert.equal(await page.locator('#operator-assembly-body').getAttribute('data-step-key'), 'cuts');
  assert.ok(await page.locator('#operator-assembly-body .board-candidate-strip').count() >= 1);
  await queueRows.nth(2).focus();
  await queueRows.nth(2).press('Enter');
  assert.equal(await page.locator('#operator-assembly-body').getAttribute('data-step-key'), 'send');
  const historicalSendReadback = {
    copy: await page.locator('#operator-assembly-body').innerText(),
    product: await page.locator('#operator-assembly-body [data-field="product-key"] dd').innerText(),
    stock: await page.locator('#operator-assembly-body [data-field="variant-inventory"] dd').innerText(),
    actions: await page.locator('#operator-assembly-body .registration-actions [data-action]').evaluateAll(
      controls => controls.map(control => control.dataset.action),
    ),
    allActionsDisabled: await page.locator('#operator-assembly-body .registration-actions [data-action]:not(:disabled)').count() === 0,
    controls: await page.locator('#operator-assembly-body .registration-actions button').evaluateAll(
      controls => controls.map(control => ({ label: control.textContent.trim(), disabled: control.disabled, action: control.dataset.action || '' })),
    ),
    confirmDisabled: await page.locator('#operator-assembly-body .registration-confirm input').isDisabled(),
    safeDefaults: await page.locator('#operator-assembly-body [data-field="safe-defaults"] dd').innerText(),
    unknownProductCode: await page.locator('#operator-assembly-body [data-field="remote-product-code"] dd').innerText(),
  };
  assert.deepEqual(historicalSendReadback.actions, []);
  assert.equal(await page.locator('#operator-assembly-body .board-cafe24-values').count(), 0);
  assert.match(historicalSendReadback.copy, /Cafe24 등록/u);
  assert.match(historicalSendReadback.copy, /현재 등록 대상이 아니어서 읽기 전용/u);
  assert.deepEqual(historicalSendReadback.controls, [
    { label: '사전점검', disabled: true, action: '' },
    { label: '승인 대상 만들기', disabled: true, action: '' },
    { label: '일회 승인', disabled: true, action: '' },
    { label: 'Cafe24 등록 실행', disabled: true, action: '' },
    { label: '등록 결과 재확인 · 재등록 없음', disabled: true, action: '' },
  ]);
  assert.equal(historicalSendReadback.confirmDisabled, true);
  assert.equal(historicalSendReadback.safeDefaults, '원격 영수증 확인 전');
  assert.equal(historicalSendReadback.unknownProductCode, '미확인');
  await page.screenshot({ path: path.join(EVIDENCE, 'b2-historical-stage7.png') });
  const historicalMutationsBeforeActivation = [...mutationRequests];
  for (const control of await page.locator('#operator-assembly-body .registration-actions button').all()) {
    await control.focus();
    await control.press('Enter');
  }
  const historicalConfirm = page.locator('#operator-assembly-body .registration-confirm input');
  await historicalConfirm.focus();
  await historicalConfirm.press('Space');
  const historicalMetrics = await (await page.request.get(`http://127.0.0.1:${apiPort}/__metrics`)).json();
  const historicalActivationReadback = {
    mutationRequests: mutationRequests.slice(historicalMutationsBeforeActivation.length),
    externalMutationRequests,
    confirmChecked: await historicalConfirm.isChecked(),
    metricMutations: historicalMetrics.requests.filter(request => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)),
  };
  fs.writeFileSync(path.join(EVIDENCE, 'b2-browser-readback.json'), JSON.stringify({
    scenario: 'historical Stage7 shared canonical readOnly panel',
    liveRegistrationReadback,
    historicalSendReadback,
    historicalActivationReadback,
  }, null, 2));
  assert.deepEqual(historicalActivationReadback.mutationRequests, []);
  assert.deepEqual(historicalActivationReadback.externalMutationRequests, []);
  assert.equal(historicalActivationReadback.confirmChecked, false);
  assert.deepEqual(historicalActivationReadback.metricMutations, []);
  await queueRows.nth(0).focus();
  await queueRows.nth(0).press('Enter');
  assert.equal(await page.locator('#operator-assembly-body').getAttribute('data-step-key'), 'sections');
  assert.equal(await page.locator('#menu-tab-overview').getAttribute('aria-selected'), 'true');
  await page.locator('#operator-assembly-steps [data-assembly-step="start"]').click();
  assert.equal(await page.locator('#operator-assembly-body .board-intake-panel').count(), 1);
  const stageBody = page.locator('#operator-assembly-body');
  const startReadback = {
    productName: await stageBody.getByLabel('제품명', { exact: true }).count(),
    detailHint: await stageBody.getByLabel('상세페이지 제작 힌트').count(),
    sourceChoice: await stageBody.getByLabel('입력 출처').count(),
    baseImages: await stageBody.getByLabel(/기본 이미지 고르기/u).count(),
    colorImages: await stageBody.getByLabel(/색상 옵션 이미지 고르기/u).count(),
  };
  const editedDetailHint = 'task19-detail-hint-red-green-marker';
  await stageBody.getByLabel('상세페이지 제작 힌트').fill(editedDetailHint);
  const detailHintRequestPromise = page.waitForRequest(
    request => request.method() === 'POST' && request.url().endsWith('/api/factory/jobs/factory-job-qa-2994/values'),
  );
  await stageBody.getByRole('button', { name: '이 투입값으로 저장' }).click();
  await detailHintRequestPromise;
  const detailHintRequest = [...mutationRequests].reverse().find(request => request.path === '/api/factory/jobs/factory-job-qa-2994/values');
  assert.deepEqual({
    detailHint: detailHintRequest?.body?.detailHint,
    liveRegistrationActions,
    historicalProduct: historicalSendReadback.product,
    historicalStock: historicalSendReadback.stock,
    historicalRegistrationActions: historicalSendReadback.actions,
    historicalActionsDisabled: historicalSendReadback.allActionsDisabled,
  }, {
    detailHint: editedDetailHint,
    liveRegistrationActions: expectedLiveRegistrationActions,
    historicalProduct: '매우 긴 한글 제품명 검증용 전통 수공예 프리미엄 보자기 포장 세트 삼십 자 이상',
    historicalStock: '해당 없음',
    historicalRegistrationActions: [],
    historicalActionsDisabled: true,
  });
  await page.locator('#operator-assembly-steps [data-assembly-step="required"]').click();
  const requiredReadback = {
    stepKey: await page.locator('#operator-assembly-body').getAttribute('data-step-key'),
    material: await stageBody.getByLabel('소재').count(),
    origin: await stageBody.getByLabel('원산지').count(),
    detailHint: await stageBody.getByLabel('상세페이지 제작 힌트').count(),
    sourceChoice: await stageBody.getByLabel('입력 출처').count(),
  };
  assert.deepEqual(startReadback, {
    productName: 1,
    detailHint: 1,
    sourceChoice: 1,
    baseImages: 1,
    colorImages: 1,
  });
  assert.deepEqual(requiredReadback, {
    stepKey: 'required',
    material: 1,
    origin: 1,
    detailHint: 0,
    sourceChoice: 0,
  });
  await queueRows.nth(1).focus();
  await queueRows.nth(1).press('Enter');
  await tabs.nth(0).click();
  const viewOnlyMutationRequests = mutationRequests.filter(request => request.path !== '/api/factory/jobs/factory-job-qa-2994/values');
  assert.deepEqual(viewOnlyMutationRequests, []);

  await page.setInputFiles('#workfile-input', path.join(FIXTURES, '방울수저집-A.kuasangse'));
  await page.waitForFunction(() => document.querySelector('#workfile-job-tabs .workfile-job-tab[data-link-state="linked"]'));
  assert.match(await page.locator('#workfile-file-name').innerText(), /방울수저집-A\.kuasangse/u);
  await page.setInputFiles('#workfile-input', path.join(FIXTURES, '긴-한글-B.kuasangse'));
  await page.waitForFunction(() => document.querySelectorAll('#workfile-job-tabs .workfile-job-tab').length === 4);
  assert.match(await page.locator('#workfile-job-tabpanel').innerText(), /정확히 일치하는 작업 식별값이 없어 연결이 필요/u);
  const koreanCopyReadback = `${await page.locator('#workfile-job-tabs').innerText()} ${await page.locator('#workfile-job-tabpanel').innerText()}`;
  assert.doesNotMatch(koreanCopyReadback, /\bunlinked\b|exact identity/u);
  assert.deepEqual(mutationRequests.filter(request => request.path !== '/api/factory/jobs/factory-job-qa-2994/values'), []);

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
    { width: 768, height: 600, name: 'tablet' },
    { width: 375, height: 667, name: 'narrow' },
  ]) {
    await page.setViewportSize(viewport);
    const menuReachable = [];
    const menuControlCounts = {};
    const unreachableControlCounts = {};
    for (const key of menuKeys) {
      await page.locator(`#menu-tab-${key}`).click();
      menuReachable.push(await page.locator(`[data-menu-panel="${key}"]`).isVisible());
      const controlReachability = await page.locator(`[data-menu-panel="${key}"]`).evaluate(panel => {
        const root = document.querySelector('main.page');
        const controls = [...panel.querySelectorAll('button, input, select, textarea, a[href], summary')]
          .filter(control => control.getClientRects().length > 0);
        const unreachable = controls.filter(control => {
          if (control.closest('.workfile-job-tabs')) return false;
          const rect = control.getBoundingClientRect();
          const top = rect.top + root.scrollTop;
          const bottom = rect.bottom + root.scrollTop;
          return rect.left < -1 || rect.right > root.clientWidth + 1 || top < -1 || bottom > root.scrollHeight + 1;
        });
        return { total: controls.length, unreachable: unreachable.length };
      });
      menuControlCounts[key] = controlReachability.total;
      unreachableControlCounts[key] = controlReachability.unreachable;
    }
    await page.locator('#menu-tab-overview').click();
    await page.evaluate(() => { document.querySelector('main.page').scrollTop = 0; });
    await page.screenshot({ path: path.join(EVIDENCE, `${viewport.name}-top.png`) });
    const viewportResult = await page.evaluate(({ width, height, name, menuReachable, menuControlCounts, unreachableControlCounts }) => {
      const root = document.querySelector('main.page');
      const consoleGrid = document.querySelector('.operator-console-grid');
      const nestedVerticalScroll = [...document.querySelectorAll(
        '.operator-queue-list, .operator-current-work, .workfile-job-desk, .menu-panel',
      )].filter(element => ['auto', 'scroll'].includes(getComputedStyle(element).overflowY));
      const queuePanel = document.querySelector('.operator-queue-panel').getBoundingClientRect();
      const queueHeading = document.querySelector('#queue-heading').getBoundingClientRect();
      const currentWork = document.querySelector('#overview-stage-summary').getBoundingClientRect();
      return {
        name,
        width,
        height,
        rootScrollable: root.scrollHeight > root.clientHeight,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        menuReachable,
        menuControlCounts,
        unreachableControlCounts,
        tabStripOverflowX: getComputedStyle(document.querySelector('#workfile-job-tabs')).overflowX,
        nestedVerticalScrollCount: nestedVerticalScroll.length,
        operatorGridColumns: getComputedStyle(consoleGrid).gridTemplateColumns.split(' ').length,
        queuePanelRect: { top: queuePanel.top, bottom: queuePanel.bottom },
        queueHeadingRect: { top: queueHeading.top, bottom: queueHeading.bottom },
        currentWorkRect: { top: currentWork.top, bottom: currentWork.bottom },
        firstViewport: queueHeading.bottom > 0 && queueHeading.top < height
          && currentWork.bottom > 0 && currentWork.top < height,
      };
    }, { ...viewport, menuReachable, menuControlCounts, unreachableControlCounts });
    await page.locator('#overview-stage-summary').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE, `${viewport.name}-workbench.png`) });
    await page.evaluate(() => {
      const root = document.querySelector('main.page');
      root.scrollTop = root.scrollHeight;
    });
    await page.screenshot({ path: path.join(EVIDENCE, `${viewport.name}-bottom.png`) });
    viewportResults.push(viewportResult);
  }
  assert.ok(viewportResults.every(result => result.menuReachable.every(Boolean)));
  assert.ok(
    viewportResults.every(result => Object.values(result.unreachableControlCounts).every(count => count === 0)),
    JSON.stringify(viewportResults),
  );
  assert.ok(viewportResults.every(result => result.rootScrollable));
  assert.ok(viewportResults.every(result => !result.horizontalOverflow));
  assert.ok(viewportResults.every(result => result.nestedVerticalScrollCount === 0));
  assert.equal(viewportResults[0].operatorGridColumns, 2);
  assert.equal(viewportResults[1].operatorGridColumns, 1);
  assert.equal(viewportResults[2].operatorGridColumns, 1);
  assert.ok(
    viewportResults[2].queuePanelRect.top < viewportResults[2].currentWorkRect.top,
    `375px visual order must be queue before current work: ${JSON.stringify(viewportResults[2])}`,
  );
  assert.equal(viewportResults[0].firstViewport, true, JSON.stringify(viewportResults));

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
    filterReadback,
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

test('30개 긴 이름 큐가 필터와 단일 루트 스크롤을 유지한다', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const apiPort = 19662;
  const frontendPort = 19682;
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
      CONTROL_TOWER_QA_JOB_COUNT: '30',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(
    `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=bulk30`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(() => document.querySelectorAll('#product-list .operator-job-row').length === 30);
  const filterCounts = {};
  for (const [filter, expected] of [['all', 30], ['selection', 1], ['blocked', 1], ['running', 21], ['completed', 7]]) {
    await page.locator(`[data-queue-filter="${filter}"]`).click();
    filterCounts[filter] = await page.locator('#product-list .operator-job-row').count();
    assert.equal(filterCounts[filter], expected);
  }
  await page.locator('[data-queue-filter="all"]').click();
  assert.match(await page.locator('#product-list .operator-job-row').nth(2).innerText(), /매우 긴 한글 제품명/u);
  const viewportMetrics = [];
  for (const viewport of [
    { width: 1280, height: 720, name: 'bulk-30-desktop' },
    { width: 768, height: 600, name: 'bulk-30-tablet' },
    { width: 375, height: 667, name: 'bulk-30-narrow' },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { document.querySelector('main.page').scrollTop = 0; });
    await page.screenshot({ path: path.join(EVIDENCE, `${viewport.name}-top.png`) });
    await page.evaluate(() => { const root = document.querySelector('main.page'); root.scrollTop = root.scrollHeight; });
    await page.screenshot({ path: path.join(EVIDENCE, `${viewport.name}-bottom.png`) });
    viewportMetrics.push(await page.evaluate(({ name, width }) => {
      const root = document.querySelector('main.page');
      return {
        name,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        operatorGridColumns: getComputedStyle(document.querySelector('.operator-console-grid')).gridTemplateColumns.split(' ').length,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: width,
      };
    }, viewport));
  }
  assert.ok(viewportMetrics.every(item => !item.horizontalOverflow && item.documentWidth <= item.viewportWidth + 1));
  assert.deepEqual(viewportMetrics.map(item => item.operatorGridColumns), [2, 1, 1]);
  fs.writeFileSync(path.join(EVIDENCE, 'bulk-30.json'), JSON.stringify({ filterCounts, viewportMetrics }, null, 2));
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
  await page.locator('#menu-tab-overview').click();
  await page.screenshot({ path: path.join(EVIDENCE, 'bulk-200.png'), fullPage: true });
  fs.writeFileSync(path.join(EVIDENCE, 'bulk-200.json'), JSON.stringify({
    renderMs,
    queueRows: await page.locator('#product-list .operator-job-row').count(),
    workfileTabs: await page.locator('#workfile-job-tabs .workfile-job-tab').count(),
    renderedCandidates: await page.locator('#a-cut-contact-sheet .a-cut-candidate').count(),
    rootHorizontalOverflow: await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1),
  }, null, 2));
});

test('숨은 생산관제 탭은 SSE를 닫고 다시 보이면 작업 큐와 함께 재연결한다', { timeout: 60_000 }, async t => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const apiPort = 19462;
  const frontendPort = 19482;
  const server = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: {
      ...process.env,
      CONTROL_TOWER_QA_API_PORT: String(apiPort),
      CONTROL_TOWER_QA_FRONTEND_PORT: String(frontendPort),
      CONTROL_TOWER_QA_JOB_COUNT: '4',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => stopProcess(server));
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`);
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
  await page.goto(
    `http://127.0.0.1:${frontendPort}/control-tower.html?apiBase=http://127.0.0.1:${apiPort}&apiHub=http://127.0.0.1:${apiPort}&workfileTabsQa=sse-visibility`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForFunction(() => document.querySelectorAll('#product-list .operator-job-row').length === 4);
  const waitForClients = async expected => {
    let observed = -1;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const metrics = await (await page.request.get(`http://127.0.0.1:${apiPort}/__metrics`)).json();
      observed = metrics.activeSseClients;
      if (metrics.activeSseClients === expected) return metrics;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`active_sse_clients_not_${expected}_observed_${observed}`);
  };
  const before = await waitForClients(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hidden = await waitForClients(0);
  assert.equal(await page.locator('#product-list .operator-job-row').count(), 4);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const visible = await waitForClients(1);
  assert.equal(await page.locator('#product-list .operator-job-row').count(), 4);
  fs.writeFileSync(path.join(EVIDENCE, 'sse-visibility.json'), JSON.stringify({
    before: before.activeSseClients,
    hidden: hidden.activeSseClients,
    visible: visible.activeSseClients,
    queueRows: 4,
  }, null, 2));
});
