'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function read(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('영수증·보안확인은 상세수집 terminal 오류보다 먼저 사용자 확인 상태로 확정한다', () => {
  const source = read('src', 'app-core-06.js');
  const poll = sourceSlice(
    source,
    'const stateText = String(statusPayload?.status',
    'if (i % 5 === 0)',
  );

  const manualIndex = poll.indexOf("['manual_required', 'manual_wait']");
  const terminalIndex = poll.indexOf("['success', 'done', 'complete'");
  assert.ok(manualIndex >= 0, 'manual challenge check is missing');
  assert.ok(terminalIndex >= 0, 'terminal check is missing');
  assert.ok(manualIndex < terminalIndex, 'manual challenge must win over error/failed terminal state');
});

test('bridge는 worker manual challenge를 취소·보존하고 자동 재시도를 끝낸다', () => {
  const source = read('tools', 'vm_candidate_file_bridge.ps1');
  const detailLoop = sourceSlice(
    source,
    '$terminal = @(\'success\', \'partial_success\'',
    'Write-JsonAtomic -Path (Join-Path $ResultDir \'artifact_manifest.json\')',
  );

  assert.match(detailLoop, /if \(\$manualRequired\)/);
  assert.match(detailLoop, /\/cancel/);
  assert.match(detailLoop, /status = 'manual_required'/);
  assert.match(detailLoop, /manual_action_required = \$true/);
});

test('VM worker는 Naver 영수증·접속 제한에서 다른 브라우저 엔진으로 넘어가지 않는다', () => {
  const source = read(
    'output', 'vm-rebuild', 'source-stage', 'JepumScraper',
    'services', 'detail_scraper.py',
  );
  const stopRule = sourceSlice(
    source,
    'and platform_key == "naver"',
    '# G마켓/옥션:',
  );

  for (const status of ['blocked', 'captcha_blocked', 'empty_or_blocked', 'cooldown']) {
    assert.match(stopRule, new RegExp(`["']${status}["']`), `${status} must stop Naver fallbacks`);
  }
});

test('VM worker manual challenge는 시간 경과로 자동 재시도하지 않는다', () => {
  const source = read(
    'output', 'vm-rebuild', 'source-stage', 'JepumScraper', 'main.py',
  );
  const wait = sourceSlice(
    source,
    'async def _wait_for_manual_detail_action(',
    'def _api_update_search_job(',
  );
  const jobFlow = sourceSlice(
    source,
    'detail_result["capture_success"] = capture_ok',
    'download_url = ""',
  );

  assert.doesNotMatch(wait, /while remaining > 0:/);
  assert.match(wait, /return False/);
  assert.doesNotMatch(jobFlow, /cooldown_retry_result = await detail_scraper\.capture_detail_page/);
});

test('VM bootstrap은 오래된 Z 매핑보다 현재 VBOX 공유 원본을 우선한다', () => {
  const source = read('tools', 'bootstrap_jepumscraper_vm_worker.ps1');
  const sourceRoot = sourceSlice(
    source,
    'function Get-WorkerSharedSourceRoot {',
    'function Sync-WorkerSourcePatch {',
  );
  const bridge = sourceSlice(
    source,
    'function Start-CandidateBridge {',
    "New-Item -ItemType Directory -Force -Path $StateRoot",
  );

  const currentSource = sourceRoot.indexOf(
    String.raw`'\\VBOXSVR\KuasangseBootstrap\output\vm-rebuild\source-stage\JepumScraper'`,
  );
  const staleSource = sourceRoot.indexOf(
    String.raw`'Z:\output\vm-rebuild\source-stage\JepumScraper'`,
  );
  assert.ok(currentSource >= 0 && staleSource >= 0 && currentSource < staleSource);

  const currentBridge = bridge.indexOf(
    String.raw`'\\VBOXSVR\KuasangseBootstrap\tools\vm_candidate_file_bridge.ps1'`,
  );
  const staleBridge = bridge.indexOf(String.raw`'Z:\tools\vm_candidate_file_bridge.ps1'`);
  assert.ok(currentBridge >= 0 && staleBridge >= 0 && currentBridge < staleBridge);
});

test('선택 목록이 비어도 manual 대상 후보를 복원해 재수집할 수 있다', () => {
  const source = read('src', 'app-core-06.js');
  const functionSource = sourceSlice(
    source,
    'function compMarketManualRetryCandidateIds(',
    'async function compMarketResumeDetailJob(',
  );
  const sandbox = {
    compMarketResultId: item => String(item.id || item.product_id || ''),
    compMarketResolveResultById: (market, id) => (
      (market.results || []).find(item => String(item.id || item.product_id || '') === String(id)) || null
    ),
    compMarketNormalizeSite: value => String(value || '').trim().toLowerCase(),
  };
  vm.runInNewContext(
    `${functionSource}; globalThis.retryIds = compMarketManualRetryCandidateIds;`,
    sandbox,
  );

  const result = sandbox.retryIds({
    selectedIds: [],
    results: [
      {
        id: 'naver-candidate-1',
        product_id: 'naver-product-1',
        platform: 'naver',
        title: '양단호박바늘쌈',
      },
    ],
    groupedResults: {},
    manualIntervention: {
      productId: 'naver-product-1',
      platform: 'naver',
      target: '양단호박바늘쌈',
    },
  });

  assert.deepEqual(Array.from(result), ['naver-candidate-1']);
});

test('manual 확인 패널은 실제 재수집 후보 계산값으로 버튼을 활성화한다', () => {
  const source = read('src', 'app-core-05.js');
  const compactPanel = sourceSlice(
    source,
    'function renderFactoryManualInterventionPrompt(',
    'function renderFactoryAutomationRunStatus(',
  );
  const fullPanel = sourceSlice(
    source,
    'function renderCompMarketManualInterventionPanel(',
    'function renderCompMarketRunningPanel(',
  );

  assert.match(
    compactPanel,
    /compMarketManualRetryAvailable\(market\)/,
  );
  assert.match(
    fullPanel,
    /compMarketManualRetryAvailable\(market\)/,
  );
});

test('저장된 generic manual 상태는 최근 VM 작업에서 정확한 후보를 복원한 뒤 그 후보만 재수집한다', async () => {
  const source = read('src', 'app-core-06.js');
  const functionSource = sourceSlice(
    source,
    'function compMarketManualRetryCandidateIds(',
    'async function reloadCompMarketDetailImagesFromCurrentJob(',
  );
  const market = {
    selectedIds: [],
    results: [
      {
        id: 'coupang-candidate-1',
        product_id: 'coupang-product-1',
        platform: 'coupang',
        title: '다른 후보',
      },
      {
        id: 'naver-candidate-1',
        product_id: 'naver_25854764348',
        platform: 'naver',
        title: '수공예 호박 바늘쌈 바늘꽂이 바늘방석',
      },
    ],
    groupedResults: {},
    detailJobId: 'vm_candidate_manual',
    detailOperation: { jobIds: ['vm_candidate_manual'] },
    status: '사용자 확인 필요 · VM 상세수집 일시정지',
    manualIntervention: null,
  };
  const captures = [];
  const sandbox = {
    compMarketResultId: item => String(item.id || item.product_id || ''),
    compMarketResolveResultById: (state, id) => (
      (state.results || []).find(item => String(item.id || item.product_id || '') === String(id)) || null
    ),
    compMarketNormalizeSite: value => String(value || '').trim().toLowerCase(),
    ensureCompMarketScrapeState: () => market,
    compMarketCurrentWorkScope: () => ({
      productKey: '양단호박바늘쌈',
      inputImageFingerprint: 'input-1',
      stageId: 'competitors',
    }),
    compMarketRecoverDetailBridgePayload: async (_state, _scope, options) => {
      assert.equal(options.preferManual, true);
      return {
        jobId: 'vm_candidate_manual',
        payload: {
          manual_intervention: {
            platform: 'naver',
            product_id: 'naver_25854764348',
            target: '수공예 호박 바늘쌈 바늘꽂이 바늘방석',
          },
        },
      };
    },
    compMarketRememberManualIntervention: (state, payload) => {
      const manual = payload.manual_intervention;
      state.manualIntervention = {
        platform: manual.platform,
        productId: manual.product_id,
        target: manual.target,
      };
    },
    compMarketSetStatus: () => {},
    compMarketLog: () => {},
    compMarketSave: () => {},
    render: () => {},
    runCompMarketDetailCapture: async (ids, options) => {
      captures.push({ ids: Array.from(ids), options: { ...options } });
      return { ok: true };
    },
  };
  vm.runInNewContext(
    `${functionSource}; globalThis.resumeDetailJob = compMarketResumeDetailJob;`,
    sandbox,
  );

  await sandbox.resumeDetailJob();

  assert.deepEqual(captures, [{
    ids: ['naver-candidate-1'],
    options: {
      runtime: 'vm',
      selectionMode: 'subset',
      reuseVmSearchSession: false,
    },
  }]);
});

test('최근 VM 작업 복원은 완료 이미지 작업보다 사용자 확인 작업을 우선할 수 있다', async () => {
  const source = read('src', 'app-core-06.js');
  const functionSource = sourceSlice(
    source,
    'async function compMarketRecoverDetailBridgePayload(',
    'async function recoverCompMarketDetailImagesFromHistory(',
  );
  const sandbox = {
    URLSearchParams,
    compMarketDetailBridgeJobIds: () => [
      'vm_candidate_a11aa1',
      'vm_candidate_c01e7e',
    ],
    compMarketCurrentWorkScope: () => ({}),
    compMarketFetchVmCandidateBridge: async path => {
      if (path.startsWith('/api/vm-detail-captures/recent?')) return { jobs: [] };
      if (path.includes('vm_candidate_c01e7e')) {
        return { status: 'success', images: [{ src: '/completed.jpg' }] };
      }
      return {
        status: 'manual_required',
        manual_action_required: true,
        manual_items: [{ product_id: 'naver_25854764348', platform: 'naver' }],
      };
    },
    compMarketExtractDetailImages: payload => Array.isArray(payload.images) ? payload.images : [],
    compMarketDetailJobInfo: payload => ({
      manual: !!(payload.manual_action_required || payload.status === 'manual_required'),
    }),
  };
  vm.runInNewContext(
    `${functionSource}; globalThis.recoverBridge = compMarketRecoverDetailBridgePayload;`,
    sandbox,
  );

  const recovered = await sandbox.recoverBridge({}, {}, { preferManual: true });

  assert.equal(recovered.jobId, 'vm_candidate_a11aa1');
  assert.equal(recovered.payload.status, 'manual_required');
});
