'use strict';

// 계약: **관제탑(생산관제) 작업이 상세페이지 앱에서 보이고, 어떤 것이든 복사본으로 불러올 수 있다.**
//
// 주인님 2026-09-06: "생산관제에서 작업중인(아직 A컷 선택 안 해서 멈춰 있는) 작업파일 리스트도
// 상세페이지 프로그램에서 보이고 어떤 것이든 불러올 수 있어야 하는데 ... 두 프로그램이 완전 단절된 것 같아"
//
// 실측 2026-09-07: 관제탑 API 는 41009(포트 관리국 "생산관제 API"), 워커 문서는 앱 백엔드 범위
// `project:batch:<jobId>` 에 남는다. 관제탑 코드는 건드리지 않고 읽기만 한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function summaryHarness() {
  const core = read('src/app-core-06.js');
  const fn = sourceSlice(core, 'function factoryTowerJobSummary(', '\nasync function factoryTowerJobsRefresh(');
  const context = vm.createContext({});
  vm.runInContext(`${fn}\nthis.summary = factoryTowerJobSummary;`, context);
  return job => { const s = context.summary(job); return { label: s.label, tone: s.tone, waiting: s.waiting, stageLabel: s.stageLabel, message: s.message }; };
}

test('관제탑 상태값을 사람 말로 옮긴다 - 선택 대기가 맨 먼저 눈에 띄어야 한다', () => {
  const summary = summaryHarness();
  assert.deepEqual(summary({ status: 'waiting_manual', stageKey: 'representative', message: '5개 후보 표시 완료' }),
    { label: '사람 선택 대기', tone: 'warn', waiting: true, stageLabel: '대표이미지', message: '5개 후보 표시 완료' });
  assert.deepEqual(summary({ status: 'blocked', stageKey: 'final_detail', message: '' }).label, '막힘 · 확인 필요');
  assert.equal(summary({ status: 'completed', stageKey: 'cafe24' }).tone, 'ok');
  assert.equal(summary({ status: 'running' }).label, '진행 중');
  assert.equal(summary({ status: 'blocked', pendingSelection: { stageKey: 'hero' } }).waiting, true, 'pendingSelection 이 있으면 상태와 무관하게 선택 대기');
  assert.equal(summary({ status: 'something_new' }).label, 'something_new', '모르는 상태는 숨기지 않고 그대로 보여 준다');
});

function copyHarness() {
  const core = read('src/app-core-06.js');
  const fn = sourceSlice(core, 'function factoryTowerJobCopyPayload(', '\nasync function factoryLoadTowerJobCopy(');
  const context = vm.createContext({
    cloneData: value => structuredClone(value),
    uid: prefix => `${prefix}_x1`,
    Date,
    // 실제 projectWorkspaceSnapshotForDocument 는 workspacePersistenceApi 를 쓴다. 여기서는 같은 결과만 흉내 낸다.
    projectWorkspaceSnapshotForDocument: (snapshot, projectId) => {
      const bind = target => {
        if (!target || typeof target !== 'object') return;
        target.currentProjectId = projectId;
        target.workspaceScope = { id: `project:${projectId}` };
        target.workspaceRevision = null;
        delete target.workspaceBranch;
      };
      bind(snapshot); bind(snapshot.assetPayload);
      return snapshot;
    },
    factoryProjectFileBuildManifest: (payload, identity) => ({ schema: 'kuasangse.factory.project.manifest', version: 1, identity: { workspaceId: identity.id } }),
    // 실제 함수는 assets·previousAssets·보관함·경쟁사 항목의 workspaceId 를 다시 찍는다. 여기서는 자산만 흉내 낸다.
    factoryStampFactoryItemsWorkspaceIdentity: (factory, workspaceId, options = {}) => {
      (factory.assets || []).forEach(item => {
        if (options.force || item.workspaceId === options.previousWorkspaceId) {
          item.workspaceId = workspaceId;
          if (item.metadata) item.metadata.workspaceId = workspaceId;
        }
      });
    },
    factoryTowerJobDocumentScope: jobId => `project:batch:${jobId}`,
    KUASANGSE_PROJECT_FILE_FORMAT: 'kuasangse.factory.project',
    KUASANGSE_PROJECT_FILE_VERSION: 1,
  });
  vm.runInContext(`${fn}\nthis.copyPayload = factoryTowerJobCopyPayload; this.copyBundle = factoryTowerJobCopyBundle;`, context);
  return context;
}

function serverDocument(jobId = 'factory-job-abc') {
  const scope = `project:batch:${jobId}`;
  const factory = {
    workspace: { id: `batch:${jobId}`, name: '슬라브 겹보', createdAt: 1, workfileName: '슬라브 겹보.kuasangse', workfileSha256: 'deadbeef' },
    currentProjectId: `batch:${jobId}`,
    workIdentity: { schema: 'kuasangse.work-identity.v1', workspaceId: scope },
    product: { productName: '슬라브 겹보', productKey: '슬라브겹보', inputImageFingerprint: 'fp1', currentRunId: 'run1' },
    automation: { activeTab: 'assets' },
    assets: [{ id: 'a1', stageId: 'hero', workspaceId: `batch:${jobId}`, productKey: '슬라브겹보', inputImageFingerprint: 'fp1' }],
    stages: { hero: { status: 'done' } },
  };
  return {
    id: 'current', workspaceId: scope, workspaceScope: { id: scope }, savedAt: 5, reason: 'manual-now', href: 'x', origin: 'o', userAgent: 'ua',
    workspaceBranch: { schema: 'kuasangse.work-branch.v1', branchId: 'b1', scopeId: scope },
    lightweight: { currentProjectId: `batch:${jobId}`, currentProjectName: '슬라브 겹보', workspaceScope: { id: scope }, analysis: { product_name: '슬라브 겹보' }, cuts: { prompts: [{ label: 'p1' }] }, factory: structuredClone(factory) },
    assets: { currentProjectId: `batch:${jobId}`, workspaceScope: { id: scope }, workIdentity: { schema: 'kuasangse.work-identity.v1', workspaceId: scope }, cuts: { prompts: [{ label: 'p1', result: 'data:image/png;base64,AAA' }] }, factory },
    productImageBackup: { primary: { base64: 'QUJD', mime: 'image/png' } },
  };
}

test('서버 문서(lightweight+assets)를 새 id 의 작업파일 payload 로 다시 묶는다 - 옛 범위 표식이 하나도 남지 않는다', () => {
  const h = copyHarness();
  const doc = serverDocument('factory-job-abc');
  const before = JSON.stringify(doc);
  const copy = h.copyPayload(doc, { id: 'towercopy_1', name: '슬라브 겹보 (관제탑 복사본)', createdAt: 99, origin: { kind: 'control-tower-job', jobId: 'factory-job-abc' } });
  const p = copy.payload;
  assert.equal(JSON.stringify(doc), before, '원본 문서는 건드리지 않는다');
  assert.equal(p.currentProjectId, 'towercopy_1');
  assert.equal(p.currentProjectName, '슬라브 겹보 (관제탑 복사본)');
  assert.equal(p.assetPayload.currentProjectId, 'towercopy_1');
  assert.equal(p.workspaceScope.id, 'project:towercopy_1');
  assert.equal(p.assetPayload.workspaceScope.id, 'project:towercopy_1');
  assert.equal(p.factory.workspace.id, 'towercopy_1');
  assert.equal(p.assetPayload.factory.workspace.id, 'towercopy_1');
  assert.equal(p.factory.currentProjectId, 'towercopy_1');
  assert.equal(p.assetPayload.factory.currentProjectId, 'towercopy_1');
  for (const target of [p, p.assetPayload, p.factory, p.assetPayload.factory]) {
    assert.equal('workIdentity' in target, false, '옛 작업 신원은 지운다 - 불러올 때 새로 봉인된다');
  }
  assert.equal('workspaceBranch' in p, false);
  assert.equal('workspaceBranch' in p.assetPayload, false);
  assert.equal('workfileName' in p.assetPayload.factory.workspace, false, '관제탑이 넣어 준 원본 파일 표식은 복사본의 것이 아니다');
  assert.equal(p.assetPayload.factory.automation.controlTowerOrigin.jobId, 'factory-job-abc', '어디서 왔는지는 남긴다');
  assert.equal(p.assetPayload.factory.assets[0].workspaceId, 'towercopy_1', '자산 workspaceId 도 복사본을 만들 때 새 id 로 찍는다 - 늦으면 "이전 작업" 으로 밀린다');
  assert.equal(p.assetPayload.factory.assets[0].metadata?.workspaceId ?? 'towercopy_1', 'towercopy_1');
  assert.equal(p.assetPayload.cuts.prompts[0].result, 'data:image/png;base64,AAA', '무거운 자산(assets)이 assetPayload 로 실린다');
  assert.equal(p.productImageBackup.primary.base64, 'QUJD');
  // 서버 전용 필드는 payload 에 섞이지 않는다
  for (const key of ['href', 'origin', 'userAgent', 'reason', 'id']) assert.equal(key in p, false, `${key} 는 서버 문서의 껍데기다`);
});

test('평평한(lightweight/assets 없는) 문서도 그대로 payload 로 쓴다', () => {
  const h = copyHarness();
  const flat = { currentProjectId: 'batch:j', factory: { workspace: { id: 'batch:j' }, product: {} }, analysis: {} };
  const copy = h.copyPayload(flat, { id: 'towercopy_2', name: 'n' });
  assert.equal(copy.payload.currentProjectId, 'towercopy_2');
  assert.equal(copy.payload.factory.workspace.id, 'towercopy_2');
  assert.equal(copy.payload.analysis !== undefined, true);
});

test('복사본 번들은 작업파일 형식·버전·manifest·출처를 갖춘다', () => {
  const h = copyHarness();
  const bundle = h.copyBundle(serverDocument('factory-job-abc'), { jobId: 'factory-job-abc', productName: '슬라브 겹보' }, { id: 'towercopy_3' });
  assert.equal(bundle.format, 'kuasangse.factory.project');
  assert.equal(bundle.version, 1);
  assert.equal(bundle.project.id, 'towercopy_3');
  assert.equal(bundle.workspaceId, 'towercopy_3');
  assert.equal(bundle.currentProjectId, 'towercopy_3');
  assert.equal(bundle.project.name, '슬라브 겹보 (관제탑 복사본)');
  assert.equal(bundle.manifest.identity.workspaceId, 'towercopy_3');
  assert.equal(bundle.project.payload.projectFileManifest.schema, bundle.manifest.schema);
  assert.deepEqual({ kind: bundle.controlTowerOrigin.kind, jobId: bundle.controlTowerOrigin.jobId, scopeId: bundle.controlTowerOrigin.scopeId },
    { kind: 'control-tower-job', jobId: 'factory-job-abc', scopeId: 'project:batch:factory-job-abc' });
});

test('화면·연결 계약: 목록 카드, 새로고침·불러오기 버튼, 목록 새로고침 때 관제탑도 읽는다(워커 탭 제외)', () => {
  const core03 = read('src/app-core-03.js');
  const core05 = read('src/app-core-05.js');
  const core06 = read('src/app-core-06.js');
  assert.match(core06, /const FACTORY_CONTROL_TOWER_BASES = Object\.freeze\(\['http:\/\/127\.0\.0\.1:41009'/, '포트 관리국의 "생산관제 API" 41009 가 첫 후보');
  assert.match(core06, /document\.querySelectorAll\('\[data-factory-tower-jobs-refresh\]'\)/);
  assert.match(core06, /document\.querySelectorAll\('\[data-factory-tower-job-load\]'\)/);
  assert.match(core06, /sources: \['server'\]/, '관제탑 문서는 서버에서만 읽는다(이 탭의 캐시가 아니다)');
  assert.match(core06, /importFactoryProjectFileBundle\(bundle, \{/, '불러오기는 기존 작업파일 가져오기 경로를 그대로 탄다');
  const panel = sourceSlice(core05, 'function renderFactoryTowerJobsCard(', '\n}\n');
  assert.match(panel, /data-factory-tower-jobs-refresh/);
  assert.match(panel, /data-factory-tower-job-load="\$\{escAttr\(jobId\)\}"/);
  assert.match(panel, /복사본으로 불러오기/);
  // 행은 [썸네일 52px][본문] 격자(.factory-recent-workfile-card)다 - 본문을 첫 칸에 넣으면 52px 로 짜부라진다 (실측 2026-09-07).
  assert.match(panel, /<article class="factory-recent-workfile-card"[^>]*>\s*<div class="factory-recent-workfile-thumb"/, '첫 칸은 썸네일');
  assert.match(panel, /class="btn-sm factory-recent-workfile-open" type="button" data-factory-tower-job-load=/, '버튼은 두 칸을 다 쓴다');
  assert.match(core05, /\$\{renderFactoryTowerJobsCard\(\)\}/, '최근 작업파일 카드 옆에 붙는다');
  const refresh = sourceSlice(core03, 'async function refreshWorkspaceLists(', '\nlet startupProjectRestoreAttempted');
  assert.match(refresh, /if \(!classicRuntimeBatchWorkerMode && typeof factoryTowerJobsRefresh === 'function'\)/);
  assert.match(refresh, /void factoryTowerJobsRefresh\(\{ render: renderAfter, quiet: true \}\)/, '목록 새로고침을 기다리게 하지 않는다');
});
