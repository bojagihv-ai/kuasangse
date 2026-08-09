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
  const mergeStart = source.indexOf('function mergeOptionSorterStoredImages');
  const mergeEnd = source.indexOf('\nfunction recoverStaleSessionInlineImages', mergeStart);
  const applyStart = source.indexOf('function applyOptionSorterLiveRecovery');
  const applyEnd = source.indexOf('\nfunction buildLightweightSessionPayload', applyStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'live recovery loader source must be present');
  assert.ok(mergeStart >= 0 && mergeEnd > mergeStart, 'option sorter merge source must be present');
  assert.ok(applyStart >= 0 && applyEnd > applyStart, 'live recovery applier source must be present');
  return new Function(
    'OPTION_SORTER_LIVE_RECOVERY_KEY',
    'workspaceSessionGetItem',
    'getCurrentLastWorkWorkspaceScope',
    'normalizeOptionSorterState',
    'state',
    `${source.slice(mergeStart, mergeEnd)}\n${source.slice(loadStart, loadEnd)}\n${source.slice(applyStart, applyEnd)}; return applyOptionSorterLiveRecovery;`,
  )(
    'pdp_option_sorter_live_v1',
    () => storageValue,
    () => currentScope,
    value => value,
    { optionSorter: {} },
  );
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
