const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SOURCE_PATH = path.resolve(__dirname, '../../src/app-core-02.js');
const HYDRATION_SOURCE_PATH = path.resolve(__dirname, '../../src/app-core-06.js');

function loadRecoveryFunction(storageValue, currentScope) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const start = source.indexOf('function loadOptionSorterLiveRecovery');
  const end = source.indexOf('\nfunction saveOptionSorterLiveRecovery', start);
  assert.ok(start >= 0 && end > start, 'live recovery loader source must be present');
  const loaderSource = source.slice(start, end);
  return new Function(
    'OPTION_SORTER_LIVE_RECOVERY_KEY',
    'workspaceSessionGetItem',
    'getCurrentLastWorkWorkspaceScope',
    `${loaderSource}; return loadOptionSorterLiveRecovery;`,
  )(
    'pdp_option_sorter_live_v1',
    () => storageValue,
    () => currentScope,
  );
}

function applyRecoveryFunction(storageValue, currentScope) {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const loadStart = source.indexOf('function loadOptionSorterLiveRecovery');
  const loadEnd = source.indexOf('\nfunction saveOptionSorterLiveRecovery', loadStart);
  const genericStart = source.indexOf('function optionSorterSlotNameIsGeneric');
  const genericEnd = source.indexOf('\nfunction optionSorterDurableProgress', genericStart);
  const mergeStart = source.indexOf('function mergeOptionSorterStoredImages');
  const mergeEnd = source.indexOf('\nfunction recoverStaleSessionInlineImages', mergeStart);
  const applyStart = source.indexOf('function applyOptionSorterLiveRecovery');
  const applyEnd = source.indexOf('\nfunction buildLightweightSessionPayload', applyStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'live recovery loader source must be present');
  assert.ok(genericStart >= 0 && genericEnd > genericStart, 'slot-name classifier source must be present');
  assert.ok(mergeStart >= 0 && mergeEnd > mergeStart, 'option sorter merge source must be present');
  assert.ok(applyStart >= 0 && applyEnd > applyStart, 'live recovery applier source must be present');
  return new Function(
    'OPTION_SORTER_LIVE_RECOVERY_KEY',
    'workspaceSessionGetItem',
    'getCurrentLastWorkWorkspaceScope',
    'normalizeOptionSorterState',
    'state',
    `${source.slice(genericStart, genericEnd)}\n${source.slice(mergeStart, mergeEnd)}\n${source.slice(loadStart, loadEnd)}\n${source.slice(applyStart, applyEnd)}; return applyOptionSorterLiveRecovery;`,
  )(
    'pdp_option_sorter_live_v1',
    () => storageValue,
    () => currentScope,
    value => value,
    { optionSorter: {} },
  );
}

function loadCompMarketMerger() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const start = source.indexOf('function mergeSameWorkDerivedValue');
  const end = source.indexOf('\nfunction recoverStaleSessionInlineImages', start);
  assert.ok(start >= 0 && end > start, 'competitor A+B merge source must be present');
  return new Function(`${source.slice(start, end)}; return mergeCompMarketStoredState;`)();
}

function loadOptionLabelRestoreNeed() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const start = source.indexOf('function lastWorkOptionLabelsRestoreNeeded');
  const end = source.indexOf('\nfunction optionSorterDurableProgress', start);
  assert.ok(start >= 0 && end > start, 'server option-label restore guard must be present');
  return new Function(`${source.slice(start, end)}; return lastWorkOptionLabelsRestoreNeeded;`)();
}

test('같은 프로젝트의 다른 snapshot scope에서도 색상명·사진 매칭 복구값을 적용할 수 있다', () => {
  const recovery = JSON.stringify({
    version: 1,
    workspaceScope: 'draft:tab-a',
    projectId: 'project-options-123',
    optionSorter: {
      slots: [{ name: '1.빨강', imgIds: ['img-1'] }],
    },
  });
  const loadRecovery = loadRecoveryFunction(recovery, 'draft:tab-b');

  const loaded = loadRecovery('draft:tab-b', { projectId: 'project-options-123' });

  assert.equal(loaded.optionSorter.slots[0].name, '1.빨강');
  assert.deepEqual(loaded.optionSorter.slots[0].imgIds, ['img-1']);
});

test('다른 프로젝트의 복구값은 현재 옵션 분류기를 오염시키지 않는다', () => {
  const recovery = JSON.stringify({
    version: 1,
    workspaceScope: 'draft:tab-a',
    projectId: 'project-options-123',
    optionSorter: { slots: [{ name: '1.빨강' }] },
  });
  const loadRecovery = loadRecoveryFunction(recovery, 'draft:tab-b');

  assert.equal(loadRecovery('draft:tab-b', { projectId: 'project-other-456' }), null);
});

test('재로드 복구는 현재 snapshot의 기본 슬롯명이 아닌 저장된 색상명·사진 매칭을 우선한다', () => {
  const recovery = JSON.stringify({
    version: 1,
    workspaceScope: 'draft:tab-a',
    projectId: 'project-options-123',
    optionSorter: {
      slots: [{ name: '1.빨강', imgIds: ['img-1'] }],
      images: [{ id: 'img-1', preview: 'data:image/png;base64,stored' }],
    },
  });
  const applyRecovery = applyRecoveryFunction(recovery, 'draft:tab-a');
  const target = {
    currentProjectId: 'project-options-123',
    optionSorter: {
      slots: [{ name: '1번', imgIds: [] }],
      images: [{ id: 'img-1', imageUrl: '/archive/img-1' }],
    },
  };

  assert.equal(applyRecovery(target), true);
  assert.equal(target.optionSorter.slots[0].name, '1.빨강');
  assert.deepEqual(target.optionSorter.slots[0].imgIds, ['img-1']);
});

test('부분 옵션 복구본은 원본·배정·생성 결과를 현재 A보다 줄이지 않는다', () => {
  const images = Array.from({ length: 15 }, (_, index) => ({
    id: `img-${index + 1}`,
    archiveId: `archive-${index + 1}`,
  }));
  const slots = images.map((image, index) => ({
    id: `slot_${index + 1}`,
    name: `${index + 1}.색상`,
    imgIds: [image.id],
  }));
  const optionResults = Array.from({ length: 5 }, (_, index) => ({
    id: `result-${index + 1}`,
    archiveId: `result-archive-${index + 1}`,
    imageUrl: `/api/local-archive/assets/result-archive-${index + 1}/image`,
    resultAssetId: `result-asset-${index + 1}`,
    imagePersistence: 'local-archive-url',
    hasImage: true,
  }));
  const recovery = JSON.stringify({
    version: 1,
    workspaceScope: 'draft:tab-a',
    projectId: 'project-options-123',
    optionSorter: {
      images: images.slice(0, 4),
      slots: slots.slice(0, 4).map((slot, index) => ({ ...slot, name: `${index + 1}번`, imgIds: [] })),
      optionResults: optionResults.slice(0, 4).map(result => ({
        ...result,
        archiveId: '',
        resultAssetId: '',
        imagePersistence: '',
      })),
      optionGenLogs: [{ message: '부분 복구본' }],
    },
  });
  const applyRecovery = applyRecoveryFunction(recovery, 'draft:tab-a');
  const target = {
    currentProjectId: 'project-options-123',
    optionSorter: {
      images,
      slots,
      pool: [],
      optionResults,
      optionGenLogs: [{ message: '기존 분류 완료' }],
    },
  };

  assert.equal(applyRecovery(target), true);
  assert.equal(target.optionSorter.images.length, 15);
  assert.equal(target.optionSorter.slots.length, 15);
  assert.equal(target.optionSorter.slots.filter(slot => slot.imgIds.length).length, 15);
  assert.equal(target.optionSorter.slots[0].name, '1.색상');
  assert.equal(target.optionSorter.optionResults.length, 5);
  assert.equal(target.optionSorter.optionResults[0].archiveId, 'result-archive-1');
  assert.equal(target.optionSorter.optionResults[0].resultAssetId, 'result-asset-1');
  assert.equal(target.optionSorter.optionResults[0].imagePersistence, 'local-archive-url');
  assert.deepEqual(target.optionSorter.optionGenLogs.map(log => log.message), ['부분 복구본', '기존 분류 완료']);
});

test('부분 경쟁사 복구본은 후보·선택·상세 이미지·로그를 현재 A보다 줄이지 않는다', () => {
  const merge = loadCompMarketMerger();
  const candidates = Array.from({ length: 14 }, (_, index) => ({
    id: `candidate-${index + 1}`,
    platform: index % 2 ? 'gmarket' : 'coupang',
  }));
  const detailImages = Array.from({ length: 6 }, (_, index) => ({
    id: `detail-${index + 1}`,
    src: `https://example.test/detail-${index + 1}.jpg`,
  }));
  const current = {
    results: candidates,
    vmResults: candidates,
    groupedResults: { vm: candidates },
    vmGroupedResults: { vm: candidates },
    selectedIds: ['candidate-2', 'candidate-7'],
    scrapedImages: detailImages,
    selectedImageIds: ['detail-2'],
    detailResults: { status: 'done', count: 6 },
    logs: [{ message: '기존 분석 완료' }],
  };
  const incoming = {
    results: candidates.slice(0, 4),
    vmResults: candidates.slice(0, 4),
    groupedResults: { vm: candidates.slice(0, 4) },
    vmGroupedResults: { vm: candidates.slice(0, 4) },
    selectedIds: [],
    scrapedImages: detailImages.slice(0, 2),
    selectedImageIds: [],
    detailResults: null,
    logs: [{ message: '부분 복구본' }],
  };

  const merged = merge(current, incoming);

  assert.equal(merged.results.length, 14);
  assert.equal(merged.vmResults.length, 14);
  assert.equal(merged.groupedResults.vm.length, 14);
  assert.deepEqual(merged.selectedIds, ['candidate-2', 'candidate-7']);
  assert.equal(merged.scrapedImages.length, 6);
  assert.deepEqual(merged.selectedImageIds, ['detail-2']);
  assert.deepEqual(merged.detailResults, { status: 'done', count: 6 });
  assert.deepEqual(merged.logs.map(log => log.message), ['부분 복구본', '기존 분석 완료']);
});

test('fallback 억제 표식이 붙은 부분 경쟁사 복구본도 현재 A를 비우지 않는다', () => {
  const merge = loadCompMarketMerger();
  const current = {
    results: [{ id: 'candidate-1' }, { id: 'candidate-2' }],
    selectedIds: ['candidate-2'],
    scrapedImages: [{ id: 'detail-1', src: 'https://example.test/detail-1.jpg' }],
    selectedImageIds: ['detail-1'],
    detailResults: { status: 'done', extracted: ['상세 내용'] },
    logs: [{ message: '기존 상세 수집 완료' }],
  };
  const incoming = {
    suppressFactoryCompetitorFallback: true,
    results: [],
    selectedIds: [],
    scrapedImages: [],
    selectedImageIds: [],
    detailResults: null,
    logs: [{ message: '부분 복구본' }],
  };

  const merged = merge(current, incoming);

  assert.equal(merged.results.length, 2);
  assert.deepEqual(merged.selectedIds, ['candidate-2']);
  assert.equal(merged.scrapedImages.length, 1);
  assert.deepEqual(merged.selectedImageIds, ['detail-1']);
  assert.deepEqual(merged.detailResults, { status: 'done', extracted: ['상세 내용'] });
  assert.deepEqual(merged.logs.map(log => log.message), ['부분 복구본', '기존 상세 수집 완료']);
});

test('더 새로운 사용자의 후보 선택 해제는 기존 선택을 되살리지 않는다', () => {
  const merge = loadCompMarketMerger();
  const current = {
    results: [{ id: 'candidate-1', title: '기존 후보' }],
    selectedIds: ['candidate-1'],
    selectedImageIds: ['detail-1'],
    detailSelectionVersion: 4,
    detailResults: { status: 'done', body: '기존 상세' },
  };
  const incoming = {
    results: [{ id: 'candidate-1' }],
    selectedIds: [],
    selectedImageIds: [],
    detailSelectionVersion: 5,
    detailResults: { status: 'done' },
  };

  const merged = merge(current, incoming);

  assert.deepEqual(merged.selectedIds, []);
  assert.deepEqual(merged.selectedImageIds, []);
  assert.equal(merged.detailSelectionVersion, 5);
  assert.equal(merged.results[0].title, '기존 후보');
  assert.equal(merged.detailResults.body, '기존 상세');
});

test('서버 snapshot 복원 직후 live-save 타이머보다 옵션 복구를 먼저 적용한다', () => {
  const source = fs.readFileSync(HYDRATION_SOURCE_PATH, 'utf8');
  const hydrateIndex = source.indexOf('await hydrateServerLastWorkSnapshot({');
  const restoreIndex = source.indexOf('factoryRestoreCurrentWorkfileLocalArchive', hydrateIndex);
  const applyIndex = source.indexOf('applyOptionSorterLiveRecovery()', hydrateIndex);

  assert.ok(hydrateIndex >= 0, 'server snapshot hydration must be present');
  assert.ok(restoreIndex > hydrateIndex, 'factory restore must follow server snapshot hydration');
  assert.ok(applyIndex > hydrateIndex && applyIndex < restoreIndex,
    'option recovery must run before later async hydration can fire a stale save');
});

test('같은 작업의 정식 DB 색상값은 기본 슬롯 hydration을 복원 대상으로 승격한다', () => {
  const needsRestore = loadOptionLabelRestoreNeed();
  const snapshot = {
    assets: {
      factory: {
        product: {
          finalDb: { option_values: '1.빨강, 2.연핑' },
        },
      },
    },
  };

  assert.equal(needsRestore(snapshot, {
    slots: [{ name: '1', imgIds: [] }, { name: '2', imgIds: [] }],
  }), true);
  assert.equal(needsRestore(snapshot, {
    slots: [{ name: '1.빨강', imgIds: [] }, { name: '2.연핑', imgIds: [] }],
  }), false);
});
