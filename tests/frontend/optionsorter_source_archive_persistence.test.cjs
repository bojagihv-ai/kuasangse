const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const persistenceSource = fs.readFileSync(path.join(root, 'src', 'app-core-02.js'), 'utf8');
const optionSource = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'src', 'app-core-03.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function loadFactoryOptionLabelRestorer() {
  const generic = sourceSlice(
    persistenceSource,
    'function optionSorterSlotNameIsGeneric',
    'function optionSorterDurableProgress',
  );
  const restore = sourceSlice(
    persistenceSource,
    'function restoreOptionSorterLabelsFromFactory',
    'function normalizeOptionSorterState',
  );
  return new Function(`${generic}\n${restore}; return restoreOptionSorterLabelsFromFactory;`)();
}

test('lightweight option state keeps local archive references after inline image compaction', () => {
  const body = sourceSlice(
    persistenceSource,
    'function stripOptionSorterImages(',
    'function buildLightweightSessionPayload(',
  );
  const stripOptionSorterImages = new Function(`${body}; return stripOptionSorterImages;`)();
  const compact = stripOptionSorterImages({
    images: [{
      id: 'source-1',
      name: '핑크',
      mime: 'image/png',
      base64: 'heavy-inline',
      preview: 'data:image/png;base64,heavy-inline',
      archiveId: 'archive-source-1',
      imageUrl: '/api/local-archive/assets/archive-source-1/image',
      imagePersistence: 'local-archive-url',
      sourceType: 'option-sorter-source-upload',
      localArchive: { archiveId: 'archive-source-1', saved: true },
    }],
  });

  assert.deepEqual(compact.images, [{
    id: 'source-1',
    name: '핑크',
    mime: 'image/png',
    hasImageData: true,
    archiveId: 'archive-source-1',
    imageUrl: '/api/local-archive/assets/archive-source-1/image',
    imagePersistence: 'local-archive-url',
    sourceType: 'option-sorter-source-upload',
    localArchive: { archiveId: 'archive-source-1', saved: true },
  }]);
});

test('option source upload has immediate archive and same-work restore paths', () => {
  assert.match(optionSource, /function optArchiveSourceImage\(/);
  assert.match(optionSource, /function optRestoreSourceImagesFromLocalArchive\(/);
  assert.match(optionSource, /OPTION_SORTER_SOURCE_ARCHIVE_TYPE\s*=\s*['"]option-sorter-source-upload['"]/);
  assert.match(optionSource, /factoryBackendArchiveAsset\([^,]+,\s*OPTION_SORTER_SOURCE_ARCHIVE_TYPE\)/);
  assert.match(optionSource, /value\.reason/);
  assert.match(controllerSource, /restoreArchivedSourceImages:\s*optRestoreSourceImagesFromLocalArchive/);
});

test('archived option source references clear the stale browser restore warning', () => {
  const restoreCounter = sourceSlice(
    persistenceSource,
    'function countSessionAssetRestoreRefs(',
    'function wasStorageWarningDismissed(',
  );
  assert.match(restoreCounter, /\['base64', 'preview', 'dataUrl', 'imageUrl', 'archiveId', 'localArchive'\]/);
});

test('archived option results use their local archive image for card, preview, and download', () => {
  assert.match(optionSource, /function factoryOptionSorterResultDisplayImage\(/);
  assert.match(optionSource, /const resultImage = factoryOptionSorterResultDisplayImage\(result, factory\);/);
  assert.match(optionSource, /\$\{resultImage\s*\?\s*`<img src="\$\{resultImage\}"/);
  assert.match(optionSource, /const image = factoryOptionSorterResultDisplayImage\(result\);/);
});

test('past option results reconnect to an exact local archive result ID on menu entry', () => {
  assert.match(optionSource, /function optRestoreGeneratedResultsFromLocalArchive\(/);
  assert.match(optionSource, /record\?\.optionResultId/);
  assert.match(optionSource, /result\.archiveId = archiveId/);
  assert.match(optionSource, /optRestoreGeneratedResultsFromLocalArchive\(\)/);
});

test('옵션 매칭 풀은 확대 버튼과 충분한 썸네일 크기를 제공한다', () => {
  assert.match(optionSource, /class="opt-card-preview" data-opt-preview-img=/);
  assert.match(optionSource, /class="opt-source-plus"/);
  assert.match(appHtml, /\.opt-pool-list \.opt-dc\{width:104px;height:104px/);
  assert.match(appHtml, /\.opt-card-preview\{[^}]*cursor:zoom-in/);
  assert.match(appHtml, /\.opt-source-plus\{[^}]*opacity:0/);
  assert.match(appHtml, /\.opt-card-preview\{[^}]*opacity:0/);
  assert.match(appHtml, /\.opt-source-card:hover \.opt-source-plus/);
  assert.match(appHtml, /\.opt-dc:hover \.opt-card-preview/);
});

test('옵션 보관본 복원은 메뉴 진입 중 전체 작업파일 deep save를 기다리지 않는다', () => {
  const resultStart = optionSource.indexOf('async function optRestoreGeneratedResultsFromLocalArchive');
  const sourceStart = optionSource.indexOf('async function optRestoreSourceImagesFromLocalArchive');
  const archiveHelpersStart = optionSource.indexOf('function optArchiveSupported');
  assert.ok(resultStart >= 0 && sourceStart > resultStart && archiveHelpersStart > sourceStart);
  assert.doesNotMatch(optionSource.slice(resultStart, sourceStart), /saveLastWorkNow\(\{\s*force:\s*true,\s*deep:\s*true\s*\}\)/);
  assert.doesNotMatch(optionSource.slice(sourceStart, archiveHelpersStart), /saveLastWorkNow\(\{\s*force:\s*true,\s*deep:\s*true\s*\}\)/);
});

test('옵션 이미지 미리보기는 위임된 닫기와 바깥 배경 닫기 및 detached overlay 정리를 보장한다', () => {
  const previewHandler = sourceSlice(
    optionSource,
    'function handleOptionSorterPreviewClick',
    'function bindOptionSorterPreviewDelegation',
  );
  assert.match(optionSource, /data-opt-preview-close/);
  assert.match(optionSource, /data-opt-preview-backdrop/);
  assert.match(previewHandler, /optImagePreviewOverlay.*remove/);
  assert.match(previewHandler, /event\.target === backdrop/);
});

test('같은 상품과 입력 이미지의 옵션 원본은 작업 ID가 바뀌어도 로컬 보관함에서 복원한다', async () => {
  const restoreSource = sourceSlice(
    optionSource,
    'async function optRestoreSourceImagesFromLocalArchive()',
    'function optAddImage(file)',
  );
  const requestedUrls = [];
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [],
      optionResults: [],
      pool: [],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Promise,
    encodeURIComponent,
    OPT_SOURCE_ARCHIVE_RESTORE_PROMISE: null,
    OPTION_SORTER_SOURCE_ARCHIVE_TYPE: 'option-sorter-source-upload',
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-new',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    }),
    optRestoreGeneratedResultsFromLocalArchive: async () => ({ restored: 0 }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async url => {
      requestedUrls.push(String(url));
      const exactWorkspace = String(url).includes('workspaceId=project-new');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          assets: exactWorkspace ? [] : [
            {
              archiveId: 'source-same',
              sourceType: 'option-sorter-source-upload',
              productKey: '모시꽃수파우치',
              inputImageFingerprint: 'same-image',
              savedAt: '2026-08-01T00:00:00Z',
              metadata: { optionImageId: 'source-image-same', originalName: '빨강' },
            },
            {
              archiveId: 'source-foreign',
              sourceType: 'option-sorter-source-upload',
              productKey: '모시꽃수파우치',
              inputImageFingerprint: 'different-image',
              savedAt: '2026-08-01T00:00:01Z',
            },
          ],
        }),
      };
    },
    optSourceArchiveMarker: record => record.sourceType,
    optSourceArchiveId: record => record.archiveId,
    optSyncSlotCountToImages: () => {},
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreSource}; this.restoreSources = optRestoreSourceImagesFromLocalArchive;`, context);

  const result = await context.restoreSources();

  assert.equal(requestedUrls.length, 2, '현재 workspace가 비면 같은 상품 보관본을 다시 조회해야 한다');
  assert.equal(result.restored, 1);
  assert.deepEqual(state.optionSorter.images.map(item => item.archiveId), ['source-same']);
});

test('이미 있는 archive 옵션 원본도 복원 확인 시 durable marker를 되살린다', async () => {
  const restoreSource = sourceSlice(
    optionSource,
    'async function optRestoreSourceImagesFromLocalArchive()',
    'function optAddImage(file)',
  );
  const saves = [];
  let resultRestoreCalls = 0;
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [{
        id: 'source-image-same',
        archiveId: 'source-same',
        imageUrl: '/api/local-archive/assets/source-same/image',
        imagePersistence: 'session-recent-inline',
        sourceType: 'option-sorter-source-upload',
        localArchive: { archiveId: 'source-same', saved: true },
      }],
      pool: ['source-image-same'],
      optionResults: [],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Promise,
    encodeURIComponent,
    OPT_SOURCE_ARCHIVE_RESTORE_PROMISE: null,
    OPTION_SORTER_SOURCE_ARCHIVE_TYPE: 'option-sorter-source-upload',
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    }),
    optRestoreGeneratedResultsFromLocalArchive: async () => ({ restored: resultRestoreCalls++ === 0 ? 1 : 0 }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: [{
          archiveId: 'source-same',
          sourceType: 'option-sorter-source-upload',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          metadata: { optionImageId: 'source-image-same', originalName: '빨강' },
        }],
      }),
    }),
    optSourceArchiveMarker: record => record.sourceType,
    optSourceArchiveId: record => record.archiveId || record.localArchive?.archiveId || '',
    optSyncSlotCountToImages: () => {},
    optScheduleSave: (delay, options) => saves.push({ delay, options }),
    render: () => {},
  });
  vm.runInContext(`${restoreSource}; this.restoreSources = optRestoreSourceImagesFromLocalArchive;`, context);

  const result = await context.restoreSources();

  assert.equal(result.restored, 0);
  assert.equal(state.optionSorter.images.length, 1);
  assert.equal(state.optionSorter.images[0].imagePersistence, 'local-archive-url');
  assert.deepEqual(
    JSON.parse(JSON.stringify(saves)),
    [{ delay: 120, options: { durable: true } }],
    '생성컷만 보관함에서 복원된 경우도 현재 프로젝트 복제본을 갱신해야 합니다.',
  );
});

test('생성 옵션컷 복원은 hydration이 교체한 현재 sorter에 기록한다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  const staleSorter = { optionResults: [] };
  const currentSorter = { optionResults: [] };
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: staleSorter,
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({ workspaceId: 'project-current', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image' }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => {
      state.optionSorter = currentSorter;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          assets: [{
            archiveId: 'generated-current',
            optionResultId: 'result-current',
            assetKind: 'option',
            title: '전체 옵션표',
            currentRunId: 'run-current',
            savedAt: '2026-08-01T00:00:00Z',
          }],
        }),
      };
    },
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'run-current' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.equal(result.added, 1);
  assert.deepEqual(state.optionSorter.optionResults.map(item => item.id), ['result-current']);
});

test('그룹컷만 반환된 작업 조회는 입력 지문 보관본의 옵션 결과 4장과 그룹컷을 함께 복원한다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [{ archiveId: 'source-1' }],
      optionResults: [],
    },
  };
  let requestCount = 0;
  const historicResult = (id, archiveId, savedAt, assetKind = 'option') => ({
    archiveId,
    optionResultId: id,
    assetKind,
    title: id,
    workspaceId: 'historic-work',
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'same-image',
    currentRunId: 'historic-run',
    savedAt,
  });
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => {
      requestCount += 1;
      const assets = requestCount < 3
        ? [{
          archiveId: `group-only-${requestCount}`,
          optionResultId: `or_group_only_${requestCount}`,
          assetKind: 'hero',
          workspaceId: 'project-current',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          currentRunId: 'current-run',
        }]
        : [
          { archiveId: 'source-1', workspaceId: 'historic-work', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image' },
          historicResult('result-1', 'result-archive-1', '2026-08-01T00:00:01Z'),
          historicResult('result-2', 'result-archive-2', '2026-08-01T00:00:02Z'),
          historicResult('result-3', 'result-archive-3', '2026-08-01T00:00:03Z'),
          historicResult('result-4', 'result-archive-4', '2026-08-01T00:00:04Z'),
          historicResult('or_group_historic', 'group-archive', '2026-08-01T00:00:05Z', 'hero'),
        ];
      return { ok: true, status: 200, json: async () => ({ ok: true, assets }) };
    },
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'current-run' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryIdentityKeysCompatible: (left, right) => String(left || '') === String(right || ''),
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.equal(requestCount, 3, 'group-only workspace/product responses must fall through to fingerprint lookup');
  assert.equal(result.added, 5);
  assert.deepEqual(
    state.optionSorter.optionResults.map(item => item.id),
    ['result-1', 'result-2', 'result-3', 'result-4', 'or_group_historic'],
  );
});

test('읽기 전용 탭도 생성컷은 표시용으로 복원하고 저장하지 않는다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  let scheduledSaves = 0;
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: { optionResults: [] },
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => true,
    factoryLocalArchiveIdentity: () => ({ workspaceId: 'project-current', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image' }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: [{
          archiveId: 'generated-current',
          optionResultId: 'result-current',
          assetKind: 'option',
          title: '전체 옵션표',
          currentRunId: 'run-current',
          savedAt: '2026-08-01T00:00:00Z',
        }],
      }),
    }),
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'run-current' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => { scheduledSaves += 1; },
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.equal(result.added, 1);
  assert.deepEqual(state.optionSorter.optionResults.map(item => item.id), ['result-current']);
  assert.equal(scheduledSaves, 0);
});

test('같은 입력 원본 보관함의 최신 생성컷은 새 실행 ID에도 복원한다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [{ archiveId: 'source-same-input' }],
      optionResults: [],
    },
  };
  const historicalAssets = [
    {
      archiveId: 'source-same-input',
      sourceType: 'option-sorter-source-upload',
      workspaceId: 'project-historical',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    },
    ...['1', '2', '3', '4'].map(order => ({
      archiveId: `result-archive-${order}`,
      optionResultId: `result-${order}`,
      assetKind: 'option',
      title: `생성컷 ${order}`,
      workspaceId: 'project-historical',
      currentRunId: 'run-historical',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
      savedAt: `2026-08-0${order}T00:00:00Z`,
    })),
  ];
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async url => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: String(url).includes('workspaceId=project-current') ? [] : historicalAssets,
      }),
    }),
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'run-current' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.equal(result.added, 4);
  assert.deepEqual(state.optionSorter.optionResults.map(item => item.id), ['result-1', 'result-2', 'result-3', 'result-4']);
});

test('입력 원본 카드가 hydration에서 빠져도 기존 옵션표 보관본으로 단체컷을 보존 복원한다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [],
      optionResults: ['1', '2', '3', '4'].map(order => ({
        id: `result-${order}`,
        archiveId: `result-archive-${order}`,
        resultKind: 'option',
      })),
      optionGroupShotLastResultId: null,
    },
  };
  const historicalAssets = [
    ...['1', '2', '3', '4'].map(order => ({
      archiveId: `result-archive-${order}`,
      optionResultId: `result-${order}`,
      assetKind: 'option',
      title: `생성컷 ${order}`,
      workspaceId: 'project-historical',
      currentRunId: 'run-latest-options',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: '',
      savedAt: `2026-08-0${order}T00:00:00Z`,
    })),
    {
      archiveId: 'group-shot-archive',
      optionResultId: 'or_group_historical',
      assetKind: 'hero',
      title: '색상 단체컷 · 대표이미지 후보',
      workspaceId: 'project-historical',
      currentRunId: 'run-earlier-group-shot',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
      savedAt: '2026-08-01T00:00:00Z',
    },
  ];
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async url => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: String(url).includes('workspaceId=project-current') ? [] : historicalAssets,
      }),
    }),
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'run-current' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.equal(result.added, 1);
  assert.deepEqual(state.optionSorter.optionResults.map(item => item.id).sort(), [
    'or_group_historical', 'result-1', 'result-2', 'result-3', 'result-4',
  ]);
  assert.equal(state.optionSorter.optionResults.find(item => item.id === 'or_group_historical').resultKind, 'color-group-shot');
  assert.equal(state.optionSorter.optionGroupShotLastResultId, 'or_group_historical');
});

test('thin identity는 유일한 원본 보관 지문으로 생성컷과 단체컷을 다시 연결한다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: { images: [{ archiveId: 'source-same-input' }], optionResults: [] },
  };
  const historicalAssets = [
    {
      archiveId: 'source-same-input',
      sourceType: 'option-sorter-source-upload',
      workspaceId: 'project-historical',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    },
    ...['1', '2', '3', '4'].map(order => ({
      archiveId: `result-archive-${order}`,
      optionResultId: `result-${order}`,
      assetKind: 'option',
      workspaceId: 'project-historical',
      currentRunId: 'run-latest-options',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
      savedAt: `2026-08-0${order}T00:00:00Z`,
    })),
    {
      archiveId: 'group-shot-archive',
      optionResultId: 'or_group_historical',
      assetKind: 'hero',
      workspaceId: 'project-historical',
      currentRunId: 'run-earlier-group-shot',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
      savedAt: '2026-08-01T00:00:00Z',
    },
  ];
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: '',
    }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async url => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: String(url).includes('workspaceId=project-current') ? [] : historicalAssets,
      }),
    }),
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'run-thin-current' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.equal(result.added, 5);
  assert.deepEqual(state.optionSorter.optionResults.map(item => item.id).sort(), [
    'or_group_historical', 'result-1', 'result-2', 'result-3', 'result-4',
  ]);
});

test('작업명 접미사와 workspace가 달라도 같은 입력 지문이면 생성컷 5장을 복원한다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [{ archiveId: 'source-same-input' }],
      optionResults: [],
    },
  };
  const historicalAssets = [
    {
      archiveId: 'source-same-input',
      sourceType: 'option-sorter-source-upload',
      workspaceId: 'project-historical',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
    },
    ...['1', '2', '3', '4'].map(order => ({
      archiveId: `result-archive-${order}`,
      optionResultId: `result-${order}`,
      assetKind: 'option',
      workspaceId: 'project-historical',
      currentRunId: 'run-latest-options',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
      savedAt: `2026-08-0${order}T00:00:00Z`,
    })),
    {
      archiveId: 'group-shot-archive',
      optionResultId: 'or_group_historical',
      assetKind: 'hero',
      workspaceId: 'project-historical',
      currentRunId: 'run-earlier-group-shot',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'same-image',
      savedAt: '2026-08-01T00:00:00Z',
    },
  ];
  const requestedUrls = [];
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '모시꽃수파우치3',
      inputImageFingerprint: 'same-image',
    }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async url => {
      requestedUrls.push(String(url));
      const text = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          assets: text.includes('inputImageFingerprint=same-image') ? historicalAssets : [],
        }),
      };
    },
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'run-current' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    factoryIdentityKeysCompatible: (a, b) => {
      const left = String(a || '').replace(/\s+/g, '').toLowerCase();
      const right = String(b || '').replace(/\s+/g, '').toLowerCase();
      return !!left && !!right && (left === right || left.includes(right) || right.includes(left));
    },
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.ok(requestedUrls.some(url => url.includes('inputImageFingerprint=same-image')));
  assert.equal(result.added, 5);
  assert.deepEqual(state.optionSorter.optionResults.map(item => item.id).sort(), [
    'or_group_historical', 'result-1', 'result-2', 'result-3', 'result-4',
  ]);
});

test('같은 원본 보관함이어도 다른 입력의 생성컷은 복원하지 않는다', async () => {
  const restoreResultsSource = sourceSlice(
    optionSource,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [{ archiveId: 'source-current-input' }],
      optionResults: [],
    },
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    encodeURIComponent,
    OPT_RESULT_ARCHIVE_RESTORE_PROMISE: null,
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({
      workspaceId: 'project-current',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'current-input',
    }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async url => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: String(url).includes('workspaceId=project-current') ? [] : [
          {
            archiveId: 'source-current-input',
            sourceType: 'option-sorter-source-upload',
            workspaceId: 'project-historical',
            productKey: '모시꽃수파우치',
            inputImageFingerprint: 'current-input',
          },
          {
            archiveId: 'foreign-result',
            optionResultId: 'foreign-result',
            workspaceId: 'project-historical',
            currentRunId: 'run-historical',
            productKey: '모시꽃수파우치',
            inputImageFingerprint: 'other-input',
            savedAt: '2026-08-01T00:00:00Z',
          },
        ],
      }),
    }),
    factoryOptionResultCurrentScope: () => ({ currentRunId: 'run-historical' }),
    factoryRuntimeReadFactory: () => ({}),
    factoryNormalizeIdentityText: value => String(value || '').trim(),
    factoryOptionResultScope: () => ({}),
    factoryOptionResultScopeMissingFields: () => [],
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreResultsSource}; this.restoreResults = optRestoreGeneratedResultsFromLocalArchive;`, context);

  const result = await context.restoreResults();

  assert.equal(result.added, 0);
  assert.deepEqual(state.optionSorter.optionResults, []);
});

test('옵션 원본 복원은 생성컷 복원 중 hydration이 교체한 현재 sorter에 기록한다', async () => {
  const restoreSource = sourceSlice(
    optionSource,
    'async function optRestoreSourceImagesFromLocalArchive()',
    'function optAddImage(file)',
  );
  const staleSorter = {
    images: [],
    optionResults: [],
    pool: [],
    optionSourceClearedAt: 0,
    optionSourceDeletedArchiveIds: [],
  };
  const currentSorter = {
    images: [],
    optionResults: [],
    pool: [],
    optionSourceClearedAt: 0,
    optionSourceDeletedArchiveIds: [],
  };
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: staleSorter,
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Promise,
    encodeURIComponent,
    OPT_SOURCE_ARCHIVE_RESTORE_PROMISE: null,
    OPTION_SORTER_SOURCE_ARCHIVE_TYPE: 'option-sorter-source-upload',
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({ workspaceId: 'project-current', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image' }),
    optRestoreGeneratedResultsFromLocalArchive: async () => {
      state.optionSorter = currentSorter;
      return { restored: 4 };
    },
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: [{
          archiveId: 'source-current',
          sourceType: 'option-sorter-source-upload',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          savedAt: '2026-08-01T00:00:00Z',
          metadata: { optionImageId: 'source-image-current', originalName: '빨강' },
        }],
      }),
    }),
    optSourceArchiveMarker: record => record.sourceType,
    optSourceArchiveId: record => record.archiveId,
    optSyncSlotCountToImages: () => {},
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreSource}; this.restoreSources = optRestoreSourceImagesFromLocalArchive;`, context);

  const result = await context.restoreSources();

  assert.equal(result.restored, 1);
  assert.deepEqual(state.optionSorter.images.map(item => item.archiveId), ['source-current']);
});

test('옵션 원본 복원은 생성컷 복원 중 화면 재진입에도 보관본을 한 번만 조회한다', async () => {
  const restoreSource = sourceSlice(
    optionSource,
    'async function optRestoreSourceImagesFromLocalArchive()',
    'function optAddImage(file)',
  );
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      images: [],
      optionResults: [],
      pool: [],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  };
  let resultRestoreCalls = 0;
  let archiveFetchCalls = 0;
  let reentryPromise;
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Promise,
    encodeURIComponent,
    OPT_SOURCE_ARCHIVE_RESTORE_PROMISE: null,
    OPTION_SORTER_SOURCE_ARCHIVE_TYPE: 'option-sorter-source-upload',
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({ workspaceId: 'project-current', productKey: '', inputImageFingerprint: '' }),
    optRestoreGeneratedResultsFromLocalArchive: async () => {
      resultRestoreCalls += 1;
      if (resultRestoreCalls === 1) {
        reentryPromise = context.restoreSources();
      }
      return { restored: 0 };
    },
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => {
      archiveFetchCalls += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, assets: [] }) };
    },
    optSourceArchiveMarker: record => record.sourceType,
    optSourceArchiveId: record => record.archiveId,
    optSyncSlotCountToImages: () => {},
    optScheduleSave: () => {},
    render: () => {},
  });
  vm.runInContext(`${restoreSource}; this.restoreSources = optRestoreSourceImagesFromLocalArchive;`, context);

  const result = await context.restoreSources();
  const reentryResult = await reentryPromise;

  assert.equal(result.restored, 0);
  assert.equal(reentryResult.restored, 0);
  assert.equal(archiveFetchCalls, 1);
  assert.equal(resultRestoreCalls, 2);
});

test('옵션 원본 복원은 runtime draft가 비어도 같은 작업 factory DB의 색상명을 적용한다', async () => {
  const restoreSource = sourceSlice(
    optionSource,
    'async function optRestoreSourceImagesFromLocalArchive()',
    'function optAddImage(file)',
  );
  const restoreOptionSorterLabelsFromFactory = loadFactoryOptionLabelRestorer();
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    factory: { product: { finalDb: { option_values: '1.빨강' } } },
    optionSorter: {
      images: [],
      optionResults: [],
      pool: [],
      slots: [{ id: 'slot_1', name: '1', imgIds: [] }],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Promise,
    encodeURIComponent,
    OPT_SOURCE_ARCHIVE_RESTORE_PROMISE: null,
    OPTION_SORTER_SOURCE_ARCHIVE_TYPE: 'option-sorter-source-upload',
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({ workspaceId: 'project-current', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image' }),
    optRestoreGeneratedResultsFromLocalArchive: async () => ({ restored: 0 }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: [{
          archiveId: 'source-current',
          sourceType: 'option-sorter-source-upload',
          productKey: '모시꽃수파우치',
          inputImageFingerprint: 'same-image',
          savedAt: '2026-08-01T00:00:00Z',
          metadata: { optionImageId: 'source-image-current', originalName: '빨강' },
        }],
      }),
    }),
    optSourceArchiveMarker: record => record.sourceType,
    optSourceArchiveId: record => record.archiveId,
    optSyncSlotCountToImages: () => {},
    optScheduleSave: () => {},
    render: () => {},
    restoreOptionSorterLabelsFromFactory,
    factoryRuntimeReadFactory: () => ({}),
  });
  vm.runInContext(`${restoreSource}; this.restoreSources = optRestoreSourceImagesFromLocalArchive;`, context);

  await context.restoreSources();

  assert.equal(state.optionSorter.slots[0].name, '1.빨강');
});

test('같은 작업의 보관 원본이 이미 있어도 빈 배정을 복구해 매칭 화면과 저장을 되살린다', async () => {
  const restoreSource = sourceSlice(
    optionSource,
    'async function optRestoreSourceImagesFromLocalArchive()',
    'function optAddImage(file)',
  );
  const restoreOptionSorterLabelsFromFactory = loadFactoryOptionLabelRestorer();
  const saves = [];
  const state = {
    step: 'optionsorter',
    backendBaseUrl: 'http://127.0.0.1:5050',
    optionSorter: {
      subStep: 'input',
      subStepUpdatedAt: 0,
      images: [
        { id: 'red', archiveId: 'archive-red', imageUrl: '/archive-red/image' },
        { id: 'pink', archiveId: 'archive-pink', imageUrl: '/archive-pink/image' },
      ],
      pool: ['red', 'pink'],
      slots: [
        { id: 'slot_1', name: '1.빨강', imgIds: [] },
        { id: 'slot_2', name: '2.연핑', imgIds: [] },
      ],
      optionSourceClearedAt: 0,
      optionSourceDeletedArchiveIds: [],
    },
  };
  const context = vm.createContext({
    state,
    URLSearchParams,
    Date,
    Set,
    Promise,
    encodeURIComponent,
    OPT_SOURCE_ARCHIVE_RESTORE_PROMISE: null,
    OPTION_SORTER_SOURCE_ARCHIVE_TYPE: 'option-sorter-source-upload',
    workspaceAuthorityIsReadOnly: () => false,
    factoryLocalArchiveIdentity: () => ({ workspaceId: 'project-current', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image' }),
    optRestoreGeneratedResultsFromLocalArchive: async () => ({ restored: 0 }),
    factoryBackendBaseUrl: () => 'http://127.0.0.1:5050',
    workspaceArchiveFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        assets: [
          { archiveId: 'archive-red', sourceType: 'option-sorter-source-upload', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image', metadata: { optionImageId: 'red' } },
          { archiveId: 'archive-pink', sourceType: 'option-sorter-source-upload', productKey: '모시꽃수파우치', inputImageFingerprint: 'same-image', metadata: { optionImageId: 'pink' } },
        ],
      }),
    }),
    optSourceArchiveMarker: record => record.sourceType,
    optSourceArchiveId: record => record.archiveId,
    optSyncSlotCountToImages: () => {},
    optScheduleSave: (delay, options) => saves.push({ delay, options }),
    render: () => {},
    restoreOptionSorterLabelsFromFactory,
    factoryRuntimeReadFactory: () => ({ product: { finalDb: { option_values: ['1.빨강', '2.연핑'] } } }),
  });
  vm.runInContext(`${restoreSource}; this.restoreSources = optRestoreSourceImagesFromLocalArchive;`, context);

  await context.restoreSources();

  assert.deepEqual(Array.from(state.optionSorter.slots, slot => Array.from(slot.imgIds)), [['red'], ['pink']]);
  assert.equal(state.optionSorter.subStep, 'sort');
  assert.deepEqual(
    JSON.parse(JSON.stringify(saves)),
    [{ delay: 120, options: { durable: true } }],
    '로컬 보관본에서 되살린 매칭은 현재 작업의 durable session 저장을 요청해야 합니다.',
  );
});
