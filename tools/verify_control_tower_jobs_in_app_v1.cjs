// 계약: **관제탑(생산관제) 작업이 앱 화면에 보이고, 눌러서 복사본으로 불러오면 그 작업이 이 탭의 새 작업파일이 된다.**
//
// 주인님 2026-09-06: "생산관제에서 작업중인 작업파일 리스트도 상세페이지 프로그램에서 리스트가 보이고
// 어떤것이든 불러올수있어야하는데 ... 지금은 두 프로그램이 완전 단절된것같아"
//
// 실제 앱(CDP)에서 본다. 관제탑 API(/api/factory/jobs)와 앱 백엔드의 관제탑 문서(/api/last-work?workspaceId=project:batch:…)만
// 가짜로 응답한다. 가짜 문서는 이 페이지의 실제 작업파일 내보내기(buildFactoryProjectFileBundle)로 만들어
// 실제 워커 문서와 같은 모양(lightweight + assets + persistenceEnvelope, snapshotRef '$')으로 감싼다.
//   1) "관제탑 새로고침" 을 누르면 작업 3개가 상태 말과 함께 보인다 (사람 선택 대기 / 막힘 / 완료)
//   2) "복사본으로 불러오기" 를 누르면 새 작업파일(towercopy_…)이 열리고, 대표이미지 3장이 새 id 로 다시 찍혀 보인다
//   3) 관제탑 원본 범위(project:batch:…)는 읽기만 한다(문서 GET 1회, 쓰기 없음)
const fs = require('fs');
const path = require('path');
const {
  assertChecks, connectCdp, ensureCdp, evaluate, factoryCdpFixtureReadyExpression, waitFor,
} = require('./factory_cdp_test_utils.cjs');

const APP_URL = process.env.KUASANGSE_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9365';
const OUT_DIR = path.join(process.cwd(), 'output', 'debug-evidence');
const RESULT_PATH = path.join(OUT_DIR, 'control-tower-jobs-in-app-v1.json');

function svgData(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#f8fafc"/><rect x="80" y="80" width="480" height="320" rx="32" fill="${color}"/>
  <text x="320" y="255" text-anchor="middle" font-family="Arial" font-size="40" font-weight="700" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// 앱 코드보다 먼저 심는다: 관제탑 목록과 관제탑 문서만 가짜로, 나머지는 실제 백엔드.
const INJECT = `(() => {
  if (window.__towerV1) return;
  const st = { jobsCalls: 0, docCalls: 0, docWrites: 0, jobs: null, document: null, scope: '' };
  window.__towerV1 = st;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String((input && input.url) || input || '');
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (method === 'GET' && /\\/api\\/factory\\/jobs(?:\\?|$)/.test(url) && st.jobs) {
      st.jobsCalls += 1;
      return new Response(JSON.stringify({ jobs: st.jobs, total: st.jobs.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (st.scope && url.indexOf('/api/last-work') !== -1 && url.indexOf(encodeURIComponent(st.scope)) !== -1) {
      if (method !== 'GET') { st.docWrites += 1; }
      else if (st.document) {
        st.docCalls += 1;
        return new Response(JSON.stringify({ ok: true, hasSnapshot: true, snapshot: st.document, workspaceId: st.scope, revision: 3, savedAt: st.document.savedAt }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return nativeFetch(input, init);
  };
})();`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const runtime = await ensureCdp(CDP_URL);
  const target = (runtime.targets || []).find(item => item.type === 'page') || runtime.targets?.[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('CDP page target not found');
  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });

  const seed = String(Date.now());
  await cdp.send('Page.navigate', { url: `${APP_URL}?towerJobs=v1&seed=${seed}` });
  await waitFor(cdp, `${factoryCdpFixtureReadyExpression()} && !!window.__towerV1 && typeof factoryTowerJobsRefresh === 'function' && typeof buildFactoryProjectFileBundle === 'function'`, 60000);

  const inputImage = svgData('input', '#0ea5e9');
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  // 1) 실제 작업 하나를 만든다(제품 + 대표이미지 3장) → 그것을 "관제탑 워커가 저장한 문서" 모양으로 감싼다.
  const fixture = await evaluate(cdp, `(async () => {
    const inputImage = ${JSON.stringify(inputImage)};
    const productName = '관제탑검사용_${seed}';
    const base64 = inputImage.replace(/^data:image\\/[^;,]+;base64,/i, '');
    const productKey = typeof factoryNormalizeIdentityText === 'function' ? factoryNormalizeIdentityText(productName) : productName;
    const fp = typeof factoryImagePayloadFingerprint === 'function' ? factoryImagePayloadFingerprint(base64) : 'tower_fp';
    const runId = 'factory_work_run_tower_${seed}';
    state.step = 'factory';
    state.productName = productName;
    state.imageBase64 = base64; state.imageMime = 'image/svg+xml'; state.imagePreview = inputImage; state.imageName = 'tower-input.svg';
    const factory = cloneData(factoryRuntimeReadFactory());
    const workspaceId = getCurrentLastWorkWorkspaceScope?.() || '';
    factory.product = { ...(factory.product || {}), productName, userProductName: productName, productKey, productIdentityKey: productKey, currentRunId: runId, generationRunId: runId, inputImageFingerprint: fp, lockedInputImageFingerprint: fp, imageBase64: base64, imageMime: 'image/svg+xml', imagePreview: inputImage, imageName: 'tower-input.svg' };
    factory.automation = { ...(factory.automation || {}), activeTab: 'assets' };
    factory.stages = { ...(factory.stages || {}), hero: { ...((factory.stages || {}).hero || {}), status: 'done', message: '3개 후보 표시 완료', targetCount: 3, expectedItemCount: 3, completedItemCount: 3, currentRunId: runId, latestGenerationRunId: runId } };
    factory.archive = { ...(factory.archive || {}), stageRunIds: { hero: runId } };
    factory.assets = [0, 1, 2].map(index => ({
      id: 'tower_hero_' + index, stageId: 'hero', title: '대표이미지 ' + (index + 1), hasImage: true, used: false, rejected: false,
      image: 'data:image/png;base64,' + ${JSON.stringify(PNG)}, imageUrl: 'data:image/png;base64,' + ${JSON.stringify(PNG)},
      workspaceId, productKey, inputImageFingerprint: fp, currentRunId: runId, generationRunId: runId,
      metadata: { workspaceId, productKey, productIdentityKey: productKey, productName, inputImageFingerprint: fp, currentRunId: runId, generationRunId: runId, stageId: 'hero' },
    }));
    factoryRuntimeReplaceFactorySnapshot(factory, { reason: 'tower-fixture', mode: 'hydrate' });
    render();
    const bundle = await buildFactoryProjectFileBundle({ name: productName });
    const payload = bundle.project.payload;
    const jobId = 'factory-job-test${seed}';
    const batchId = 'batch:' + jobId;
    const scope = 'project:' + batchId;
    const rebind = target => {
      if (!target || typeof target !== 'object') return;
      target.currentProjectId = batchId; target.currentProjectName = productName;
      target.workspaceScope = { id: scope };
      delete target.workspaceRevision; delete target.workspaceBranch; delete target.workIdentity;
      const f = target.factory;
      if (!f) return;
      f.workspace = { ...(f.workspace || {}), id: batchId, name: productName, workfileName: productName + '.kuasangse' };
      f.currentProjectId = batchId; delete f.workIdentity;
      (f.assets || []).forEach(a => { a.workspaceId = batchId; if (a.metadata) a.metadata.workspaceId = batchId; });
    };
    const lightweight = cloneData(payload); delete lightweight.assetPayload; delete lightweight.projectFileManifest;
    const assets = cloneData(payload.assetPayload || {});
    rebind(lightweight); rebind(assets);
    const now = Date.now();
    const document = {
      id: 'current', workspaceId: scope, workspaceScope: { id: scope }, savedAt: now, reason: 'manual-now',
      origin: location.origin, href: location.href, userAgent: navigator.userAgent,
      lightweight, assets, productImageBackup: payload.productImageBackup || null,
      persistenceEnvelope: { schema: 'kuasangse.workspace', version: 2, scopeId: scope, snapshotRef: '$', savedAt: now, metadata: { revision: { counter: 3, scopeId: scope, updatedAt: now, writerId: 'tower-test' } } },
    };
    window.__towerV1.scope = scope;
    window.__towerV1.document = document;
    window.__towerV1.jobs = [
      { schema: 'factory-product-job:v1', jobId, productName, status: 'waiting_manual', stageKey: 'representative', message: '5개 후보 표시 완료', imageCount: 1, workfileName: productName + '.kuasangse', checkpointAvailable: true, dispatched: false },
      { schema: 'factory-product-job:v1', jobId: 'factory-job-blocked${seed}', productName: '막힌 검사 작업', status: 'blocked', stageKey: 'final_detail', message: '상세페이지 단계 실패/검수 필요', imageCount: 1, checkpointAvailable: true },
      { schema: 'factory-product-job:v1', jobId: 'factory-job-done${seed}', productName: '끝난 검사 작업', status: 'completed', stageKey: 'cafe24', message: '등록 완료', imageCount: 1, checkpointAvailable: true },
    ];
    // 작업파일 가져오기의 "이전 작업 저장?" 물음은 저장 안 함으로 답한다 (검사).
    promptWorkspaceDocumentChoice = async () => 'skip';
    window.confirm = () => true;
    return { productName, jobId, scope, beforeProjectId: state.currentProjectId, heroAssets: (assets.factory?.assets || []).length, docBytes: JSON.stringify(document).length };
  })()`);

  // 2) 관제탑 새로고침 버튼을 실제로 누른다 → 목록이 보인다.
  //    부팅 때 목록 새로고침이 이미 관제탑을 읽고 있을 수 있다(진짜 관제탑이 켜져 있으면 진짜 목록).
  //    그 조회가 끝난 뒤에 눌러야 가짜 목록이 들어온다.
  await waitFor(cdp, `!!document.querySelector('[data-factory-tower-jobs-refresh]')`, 15000);
  await waitFor(cdp, `!(state.factoryTowerJobs && state.factoryTowerJobs.loading)`, 20000);
  await evaluate(cdp, `(() => { const b = document.querySelector('[data-factory-tower-jobs-refresh]'); b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
  try {
    await waitFor(cdp, `Number(state.factoryTowerJobs?.fetchedAt || 0) > 0 && !state.factoryTowerJobs.loading && (state.factoryTowerJobs.items || []).some(job => job.jobId === ${JSON.stringify('factory-job-test' + seed)})`, 20000);
  } catch (error) {
    const diagnostic = await evaluate(cdp, `(() => ({
      tower: state.factoryTowerJobs || null,
      stub: { jobsCalls: window.__towerV1?.jobsCalls, hasJobs: !!window.__towerV1?.jobs },
      refreshType: typeof factoryTowerJobsRefresh,
      button: !!document.querySelector('[data-factory-tower-jobs-refresh]'),
      buttonHasHandler: typeof document.querySelector('[data-factory-tower-jobs-refresh]')?.onclick === 'function',
      step: state.step,
    }))()`);
    throw new Error(`${error.message}\n진단=${JSON.stringify(diagnostic).slice(0, 1200)}`);
  }
  const listed = await evaluate(cdp, `(() => {
    const card = document.querySelector('[data-factory-tower-jobs]');
    const text = card ? card.innerText : '';
    return {
      jobsCalls: window.__towerV1.jobsCalls,
      count: (state.factoryTowerJobs.items || []).length,
      error: state.factoryTowerJobs.error || '',
      hasWaiting: text.includes('사람 선택 대기'), hasBlocked: text.includes('막힘 · 확인 필요'), hasDone: text.includes('완료'),
      showsName: text.includes(${JSON.stringify('관제탑검사용_' + seed)}),
      loadButton: !!card?.querySelector('[data-factory-tower-job-load="' + ${JSON.stringify('factory-job-test' + seed)} + '"]'),
      text: text.slice(0, 400),
    };
  })()`);

  // 3) "복사본으로 불러오기" 를 실제로 누른다 → 새 작업파일이 열린다.
  await evaluate(cdp, `(() => { const b = document.querySelector('[data-factory-tower-job-load="' + ${JSON.stringify('factory-job-test' + seed)} + '"]'); b.scrollIntoView({ block: 'center' }); b.click(); return true; })()`);
  await waitFor(cdp, `/^towercopy/.test(String(state.currentProjectId || '')) && state.workfileRestoreState !== 'loading' && state.workfileRestoreState !== 'validating' && !state.factoryTowerJobs.loadingJobId`, 60000);
  await new Promise(resolve => setTimeout(resolve, 800));
  const loaded = await evaluate(cdp, `(async () => {
    const factory = factoryRuntimeReadFactory();
    const hero = typeof factoryUsableAssetsForStage === 'function' ? factoryUsableAssetsForStage('hero', factory) : [];
    await refreshWorkspaceLists(false);
    return {
      projectId: state.currentProjectId,
      projectName: state.currentProjectName,
      restoreState: state.workfileRestoreState,
      restoreMessage: state.workfileRestoreMessage || '',
      error: state.error || '',
      origin: factory.automation?.controlTowerOrigin || null,
      factoryWorkspaceId: factory.workspace?.id,
      productName: factory.product?.productName,
      heroCount: hero.length,
      heroWorkspaceIds: [...new Set((factory.assets || []).filter(a => a.stageId === 'hero').map(a => a.workspaceId))],
      // 파일 불러오기와 같은 규칙: 저장 전에는 "현재 작업파일" 카드로 보인다(batch: 숨김 필터에 걸리지 않는다).
      inProjectList: (state.projects || []).some(p => p.id === state.currentProjectId)
        || (typeof factoryRecentWorkfileProjects === 'function' && factoryRecentWorkfileProjects(4).some(p => p.id === state.currentProjectId)),
      towerStillListed: (state.factoryTowerJobs.items || []).length,
      docCalls: window.__towerV1.docCalls, docWrites: window.__towerV1.docWrites,
      panelText: (document.querySelector('#factoryAutomationAssetChooser_hero') || {}).innerText?.slice(0, 200) || '',
    };
  })()`);

  fs.writeFileSync(RESULT_PATH, JSON.stringify({ fixture, listed, loaded }, null, 2), 'utf8');
  const jobId = `factory-job-test${seed}`;
  assertChecks([
    { ok: fixture.heroAssets === 3, message: `전제 불성립 - 가짜 관제탑 문서에 대표이미지 3장이 있어야 합니다: ${JSON.stringify(fixture)}` },
    { ok: listed.jobsCalls >= 1 && listed.count === 3 && !listed.error, message: `관제탑 새로고침이 작업 3개를 읽어야 합니다: ${JSON.stringify(listed)}` },
    { ok: listed.showsName && listed.hasWaiting && listed.hasBlocked && listed.hasDone && listed.loadButton,
      message: `목록에 작업 이름·상태 말("사람 선택 대기"/"막힘 · 확인 필요"/"완료")·불러오기 버튼이 보여야 합니다: ${JSON.stringify(listed)}` },
    { ok: /^towercopy/.test(String(loaded.projectId || '')) && loaded.projectId !== fixture.beforeProjectId,
      message: `복사본이 새 작업파일(towercopy_…)로 열려야 합니다: ${JSON.stringify(loaded)}` },
    { ok: /\(관제탑 복사본\)/.test(String(loaded.projectName || '')) && String(loaded.productName || '') === fixture.productName,
      message: `이름은 "<제품명> (관제탑 복사본)", 제품은 그대로여야 합니다: ${JSON.stringify(loaded)}` },
    { ok: loaded.origin?.jobId === jobId && loaded.origin?.scopeId === fixture.scope,
      message: `어느 관제탑 작업에서 왔는지(automation.controlTowerOrigin) 남아야 합니다: ${JSON.stringify(loaded.origin)}` },
    { ok: loaded.heroCount === 3 && loaded.heroWorkspaceIds.length === 1 && loaded.heroWorkspaceIds[0] === loaded.factoryWorkspaceId && loaded.factoryWorkspaceId === loaded.projectId,
      message: `대표이미지 3장이 새 작업 id 로 다시 찍혀 보여야 합니다(옛 batch: 표식이 남으면 "이전 작업" 으로 숨는다): ${JSON.stringify({ heroCount: loaded.heroCount, ids: loaded.heroWorkspaceIds, ws: loaded.factoryWorkspaceId, project: loaded.projectId })}` },
    { ok: loaded.inProjectList === true, message: `복사본이 작업 목록에 보여야 합니다(batch: 숨김 필터에 걸리면 안 된다): ${JSON.stringify({ projectId: loaded.projectId })}` },
    { ok: loaded.docCalls === 1 && loaded.docWrites === 0, message: `관제탑 원본 문서는 읽기 1회, 쓰기 0회여야 합니다: ${JSON.stringify({ docCalls: loaded.docCalls, docWrites: loaded.docWrites })}` },
    { ok: !loaded.error, message: `불러오기 뒤 오류가 남으면 안 됩니다: ${JSON.stringify({ error: loaded.error, restore: loaded.restoreMessage })}` },
  ]);
  console.log(`[PASS] 관제탑 작업 ${listed.count}개 표시 · "${fixture.productName}" 복사본 → ${loaded.projectId} · 대표이미지 ${loaded.heroCount}장 새 id 로 · 원본 읽기 ${loaded.docCalls}회/쓰기 ${loaded.docWrites}회 - 증거 ${RESULT_PATH}`);
  return cdp;
}

let openCdp = null;
main()
  .then(cdp => { openCdp = cdp; })
  .catch(error => { console.error(`[FAIL] ${error?.message || error}`); process.exitCode = 1; })
  .finally(() => { try { openCdp?.close?.(); } catch (_) {} process.exit(process.exitCode || 0); });
