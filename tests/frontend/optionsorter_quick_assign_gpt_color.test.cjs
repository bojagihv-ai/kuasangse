const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SLOT_BINDINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'menus', 'optionsorter-slot-bindings.mjs'),
  'utf8',
);
const OPTION_BINDINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'menus', 'optionsorter-bindings.mjs'),
  'utf8',
);
const GENERATION_BINDINGS = fs.readFileSync(
  path.join(ROOT, 'src', 'menus', 'optionsorter-generation-bindings.mjs'),
  'utf8',
);
const OPTION_VIEW = fs.readFileSync(
  path.join(ROOT, 'src', 'menus', 'optionsorter-view.mjs'),
  'utf8',
);
const APP_CORE_02 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
const APP_CORE_06 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-06.js'), 'utf8');

function extractFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `${name} must exist`);
  const asyncStart = source.lastIndexOf('async ', functionStart);
  const start = asyncStart >= 0 && source.slice(asyncStart + 6, functionStart) === ''
    ? asyncStart
    : functionStart;
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1;
    if (source[index] === ')') paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  assert.notEqual(paramsEnd, -1, `${name} parameter list must terminate`);
  const bodyStart = source.indexOf('{', paramsEnd);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function makeClassList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    toggle(value, force) {
      if (force === true) values.add(value);
      else if (force === false) values.delete(value);
      else if (values.has(value)) values.delete(value);
      else values.add(value);
    },
    contains: value => values.has(value),
  };
}

test('옵션 미배정 이미지를 더블클릭하면 다음 빈 슬롯으로 즉시 배정하고 전체 재렌더하지 않는다', async () => {
  const { bindOptionSorterSlots } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-slot-bindings.mjs')).href}?quick=${Date.now()}`
  );
  const os = {
    images: [{ id: 'red' }, { id: 'blue' }],
    pool: ['red', 'blue'],
    subStep: 'sort',
    slots: [
      { id: 'slot-1', name: '1번', imgIds: [] },
      { id: 'slot-2', name: '2번', imgIds: [] },
    ],
  };
  const poolList = { id: 'optPoolList' };
  const slotOneList = {
    id: 'optSlotList_slot-1',
    classList: makeClassList(),
    appended: [],
    appendChild(node) {
      this.appended.push(node);
      node.parentElement = this;
    },
  };
  const slotTwoList = {
    id: 'optSlotList_slot-2',
    classList: makeClassList(),
    appendChild() {},
  };
  const card = {
    dataset: { imgId: 'red', optQuickAssign: 'red' },
    parentElement: poolList,
    classList: makeClassList(),
  };
  const calls = [];
  const nodes = {
    optPoolList: poolList,
    'optSlotList_slot-1': slotOneList,
    'optSlotList_slot-2': slotTwoList,
  };

  bindOptionSorterSlots({
    byId: id => nodes[id] || null,
    queryAll: selector => selector === '[data-opt-quick-assign]' ? [card] : [],
    optionSorter: () => os,
    requestRender: () => calls.push('render'),
    createSortable: () => null,
    currentStep: () => 'optionsorter',
    sortable: null,
    getSlotNamePresets: () => [],
    saveSlotNamePreset: value => value,
    optDeleteSlot: () => {},
    optDownloadSlot: () => {},
    optFocusSlotNameByIndex: () => {},
    optScheduleSave: () => calls.push('save'),
    optSwapOptionPairOrder: () => {},
    saveLastWorkNow: () => calls.push('save-now'),
    syncOptFromDOM: () => {},
    syncOptSlotsFromDOM: () => {},
    uid: prefix => `${prefix}-1`,
    reportWarning: message => calls.push(['warning', message]),
  });

  assert.equal(typeof card.ondblclick, 'function', '미배정 카드에 더블클릭 핸들러가 필요합니다.');
  card.ondblclick({ preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(os.pool, ['blue']);
  assert.deepEqual(os.slots[0].imgIds, ['red']);
  assert.deepEqual(os.slots[1].imgIds, []);
  assert.deepEqual(slotOneList.appended, [card]);
  assert.equal(calls.includes('save'), true, '빠른 배치 상태는 작업파일 저장 큐에 들어가야 합니다.');
  assert.equal(calls.includes('render'), false, '빠른 배치는 전체 옵션분류기 재렌더를 유발하면 안 됩니다.');
});

test('F5 당시 슬롯 안에 있던 카드도 미배정 풀로 되돌린 뒤 더블클릭할 수 있다', async () => {
  const { bindOptionSorterSlots } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-slot-bindings.mjs')).href}?reverse=${Date.now()}`
  );
  const os = {
    images: [{ id: 'red' }],
    pool: [],
    subStep: 'sort',
    slots: [{ id: 'slot-1', name: '1번', imgIds: ['red'] }],
  };
  const poolList = { id: 'optPoolList' };
  const slotList = {
    id: 'optSlotList_slot-1',
    classList: makeClassList(),
    appendChild(node) {
      node.parentElement = this;
    },
  };
  const card = {
    dataset: { imgId: 'red', optQuickAssign: 'red' },
    parentElement: slotList,
    classList: makeClassList(),
  };

  bindOptionSorterSlots({
    byId: id => ({ optPoolList: poolList, 'optSlotList_slot-1': slotList }[id] || null),
    queryAll: selector => selector === '[data-opt-quick-assign]' ? [card] : [],
    optionSorter: () => os,
    requestRender: () => assert.fail('역드래그 뒤 빠른 배치는 전체 재렌더하면 안 됩니다.'),
    createSortable: () => null,
    currentStep: () => 'optionsorter',
    sortable: null,
    getSlotNamePresets: () => [],
    saveSlotNamePreset: value => value,
    optDeleteSlot: () => {},
    optDownloadSlot: () => {},
    optFocusSlotNameByIndex: () => {},
    optScheduleSave: () => {},
    optSwapOptionPairOrder: () => {},
    saveLastWorkNow: () => {},
    syncOptFromDOM: () => {},
    syncOptSlotsFromDOM: () => {},
    uid: prefix => `${prefix}-1`,
    reportWarning: message => assert.fail(message),
  });

  assert.equal(typeof card.ondblclick, 'function', '슬롯에서 시작한 카드도 더블클릭 핸들러를 가져야 합니다.');
  os.slots[0].imgIds = [];
  os.pool = ['red'];
  card.parentElement = poolList;
  card.ondblclick({ preventDefault() {}, stopPropagation() {} });

  assert.deepEqual(os.pool, []);
  assert.deepEqual(os.slots[0].imgIds, ['red']);
  assert.equal(card.parentElement, slotList);
});

test('옵션 이미지 드래그 종료는 DOM 상태만 저장하고 Sortable 전체를 재생성하지 않는다', async () => {
  const { bindOptionSorterSlots } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-slot-bindings.mjs')).href}?drag=${Date.now()}`
  );
  const os = {
    images: [{ id: 'red' }],
    pool: ['red'],
    subStep: 'sort',
    slots: [{ id: 'slot-1', name: '1번', imgIds: [] }],
  };
  const poolList = { id: 'optPoolList' };
  const slotList = { id: 'optSlotList_slot-1' };
  const sortableOptions = [];
  const calls = [];

  bindOptionSorterSlots({
    byId: id => ({ optPoolList: poolList, 'optSlotList_slot-1': slotList }[id] || null),
    queryAll: () => [],
    optionSorter: () => os,
    requestRender: () => calls.push('render'),
    createSortable: (node, options) => {
      sortableOptions.push([node.id, options]);
      return {};
    },
    currentStep: () => 'optionsorter',
    sortable: { create() {} },
    getSlotNamePresets: () => [],
    saveSlotNamePreset: value => value,
    optDeleteSlot: () => {},
    optDownloadSlot: () => {},
    optFocusSlotNameByIndex: () => {},
    optScheduleSave: () => {},
    optSwapOptionPairOrder: () => {},
    saveLastWorkNow: () => {},
    syncOptFromDOM: () => calls.push('sync'),
    syncOptSlotsFromDOM: () => {},
    uid: prefix => `${prefix}-1`,
    reportWarning: () => {},
  });

  const poolOptions = sortableOptions.find(([id]) => id === 'optPoolList')?.[1];
  assert.equal(typeof poolOptions?.onEnd, 'function');
  poolOptions.onEnd();
  assert.deepEqual(calls, ['sync'], '드래그 종료는 저장 동기화만 하고 전체 재렌더를 하지 않아야 합니다.');
  assert.notEqual(poolOptions.forceFallback, true, 'desktop native drag보다 느린 강제 fallback을 사용하면 안 됩니다.');
  assert.equal(poolOptions.emptyInsertThreshold, 24, '빈 슬롯의 드롭 판정 영역을 넉넉하게 유지해야 합니다.');
  assert.equal(poolOptions.animation, 80, '드롭 애니메이션이 다음 입력을 오래 막으면 안 됩니다.');
});

test('Sortable 런타임이 없어도 옵션 이미지는 포인터 드래그로 빈 슬롯에 배정된다', async () => {
  const { bindOptionSorterSlots } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-slot-bindings.mjs')).href}?native=${Date.now()}`
  );
  const os = {
    images: [{ id: 'red' }],
    pool: ['red'],
    subStep: 'sort',
    slots: [{ id: 'slot-1', name: '1번', imgIds: [] }],
  };
  const poolList = { id: 'optPoolList' };
  const slotList = {
    id: 'optSlotList_slot-1',
    dataset: { slotId: 'slot-1' },
    classList: makeClassList(),
    appendChild(node) { node.parentElement = this; },
  };
  const card = {
    dataset: { imgId: 'red', optQuickAssign: 'red' },
    parentElement: poolList,
    classList: makeClassList(),
    setPointerCapture() {},
  };
  const calls = [];
  const previousDocument = global.document;
  global.document = {
    elementFromPoint() {
      return { closest: selector => selector.includes('.opt-slot-list') ? slotList : null };
    },
  };
  try {
    bindOptionSorterSlots({
      byId: id => ({ optPoolList: poolList, 'optSlotList_slot-1': slotList }[id] || null),
      queryAll: selector => selector === '[data-opt-quick-assign]' ? [card] : [],
      optionSorter: () => os,
      requestRender: () => calls.push('render'),
      createSortable: () => null,
      currentStep: () => 'optionsorter',
      sortable: null,
      getSlotNamePresets: () => [],
      saveSlotNamePreset: value => value,
      optDeleteSlot: () => {},
      optDownloadSlot: () => {},
      optFocusSlotNameByIndex: () => {},
      optScheduleSave: () => calls.push('save'),
      optSwapOptionPairOrder: () => {},
      saveLastWorkNow: () => {},
      syncOptFromDOM: () => {},
      syncOptSlotsFromDOM: () => {},
      uid: prefix => `${prefix}-1`,
      reportWarning: message => assert.fail(message),
    });

    assert.equal(typeof card.onpointerdown, 'function', 'Sortable 부재 시 포인터 시작 핸들러가 필요합니다.');
    card.onpointerdown({ button: 0, pointerId: 1, clientX: 0, clientY: 0, target: card });
    card.onpointermove({ pointerId: 1, clientX: 20, clientY: 20, preventDefault() {}, target: card });
    card.onpointerup({ pointerId: 1, clientX: 20, clientY: 20, target: card });

    assert.deepEqual(os.pool, []);
    assert.deepEqual(os.slots[0].imgIds, ['red']);
    assert.equal(card.parentElement, slotList);
    assert.equal(calls.includes('save'), true, '포인터 드래그 배정도 lightweight 저장을 예약해야 합니다.');
    assert.equal(calls.includes('render'), false, '포인터 드래그 배정은 전체 재렌더를 유발하면 안 됩니다.');
  } finally {
    global.document = previousDocument;
  }
});

test('옵션분류기 이벤트 정리는 더블클릭 핸들러까지 포함한다', () => {
  assert.match(OPTION_BINDINGS, /['"]ondblclick['"]/);
});

test('옵션분류기 최초 렌더 refresh도 메뉴 바인딩을 설치한다', async () => {
  const { createOptionSorterMenu } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-controller.mjs')).href}?initial-refresh=${Date.now()}`
  );
  const uploadZone = { onclick: null, ondragover: null, ondragleave: null, ondrop: null };
  const fileInput = { onchange: null, click() {} };
  const root = {
    querySelector(selector) {
      return { '#optUploadZone': uploadZone, '#optFileInput': fileInput }[selector] || null;
    },
    querySelectorAll() { return []; },
  };
  const renderHelpers = Object.fromEntries([
    'ensureOptionSorterDefaults', 'optMissingImagePayloadCount', 'renderOptionSorterSourceStrip',
    'renderOptionSorterAssignmentWorkspace', 'renderOptionImageGeneratorPanel',
    'optRenderImageOrPlaceholder', 'renderOptionSorterImagePreviewModal', 'disabledAttr', 'escapeHtml',
  ].map(name => [name, () => '']));
  const menu = createOptionSorterMenu({
    getSnapshot: () => ({ optionSorter: { images: [], pool: [], slots: [], subStep: 'input' } }),
    assertMutable() {}, mutateOptions() {}, persistOptions() {}, getSlotNamePresets: () => [],
    saveSlotNamePreset: value => value, loadVisionColors: async () => ({}), applyVisionColors() {},
    restoreArchivedSourceImages: async () => ({ restored: 0 }), requestRender() {},
    getOperationToken: () => 'workspace:a:fence:1', reportError() {},
    bindHelpers: { getCurrentStep: () => 'optionsorter', getSortable: () => null },
    renderHelpers,
  });

  menu.onEnter();
  menu.refresh(root);
  assert.equal(typeof uploadZone.onclick, 'function');
  assert.equal(typeof fileInput.onchange, 'function');
});

test('옵션 배정 저장 예약은 즉시 전체 factory snapshot을 복제하지 않는다', () => {
  const scheduleCalls = [];
  const sandbox = {
    scheduleLastWorkSave(delay, options) {
      scheduleCalls.push({ delay, options });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(APP_CORE_06, 'optScheduleSave'), sandbox);
  sandbox.optScheduleSave(320);
  assert.deepEqual(
    JSON.parse(JSON.stringify(scheduleCalls)),
    [{ delay: 320, options: { lightweight: true, optionSorterOnly: true } }],
    '옵션 드래그 저장은 전체 작업이 아닌 옵션 상태 전용 lightweight 경로로 예약되어야 합니다.',
  );
});

test('옵션 전용 저장은 factory 복제나 전체 세션 commit 없이 같은 작업 서버 저장본도 갱신한다', async () => {
  const timers = [];
  let cloneCalls = 0;
  let recoveryCalls = 0;
  const serverSaveCalls = [];
  const sandbox = {
    Math,
    Number,
    Promise,
    LAST_WORK_INPUT_IDLE_MS: 1400,
    lastWorkSaveTimer: null,
    optionSorterLiveSaveTimer: null,
    lastWorkSyncingVisibleInputs: false,
    factoryRuntimeReadFactory: () => ({ id: 'active' }),
    factoryRuntimeReadCommittedFactory: () => ({ id: 'committed' }),
    factoryRuntimeDetachedValue(value) {
      cloneCalls += 1;
      return { ...value };
    },
    cloneData(value) {
      cloneCalls += 1;
      return { ...value };
    },
    clearTimeout() {},
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    lastWorkIsInteractiveInputWindow: () => false,
    saveLastWorkNow() {},
    syncVisibleLastWorkInputs() {},
    savePersistentState() {
      assert.fail('옵션 배정 때문에 전체 세션 commit을 실행하면 안 됩니다.');
    },
    saveOptionSorterLiveRecovery() {
      recoveryCalls += 1;
      return Promise.resolve(true);
    },
    saveServerLastWorkSnapshot(reason) {
      serverSaveCalls.push(reason);
      return Promise.resolve(true);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(APP_CORE_02, 'scheduleLastWorkSave'), sandbox);
  sandbox.scheduleLastWorkSave(700, { lightweight: true, optionSorterOnly: true });
  assert.equal(cloneCalls, 0, '사용자 입력 이벤트 중에는 factory 전체 복제가 없어야 합니다.');
  assert.equal(timers.length, 1);
  timers[0].callback();
  await Promise.resolve();
  assert.equal(cloneCalls, 0, '옵션 전용 저장 타이머에서도 factory snapshot을 복제하면 안 됩니다.');
  assert.equal(recoveryCalls, 1, '현재 작업 scope에 묶인 옵션 전용 복구값만 저장해야 합니다.');
  assert.deepEqual(
    serverSaveCalls,
    ['option-sorter-live'],
    '새 탭과 재시작에서도 배정·생성컷이 남도록 같은 작업 서버 저장본을 갱신해야 합니다.',
  );
});

test('로컬 보관본 복원용 옵션 저장은 현재 작업의 durable project replica를 강제 갱신한다', async () => {
  const timers = [];
  const serverSaveCalls = [];
  const sandbox = {
    Math,
    Number,
    Promise,
    LAST_WORK_INPUT_IDLE_MS: 1400,
    lastWorkSaveTimer: null,
    optionSorterLiveSaveTimer: null,
    lastWorkSyncingVisibleInputs: false,
    factoryRuntimeReadFactory: () => ({ id: 'active' }),
    factoryRuntimeReadCommittedFactory: () => ({ id: 'committed' }),
    factoryRuntimeDetachedValue: value => value,
    cloneData: value => value,
    clearTimeout() {},
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    lastWorkIsInteractiveInputWindow: () => false,
    saveLastWorkNow() {},
    syncVisibleLastWorkInputs() {},
    saveOptionSorterLiveRecovery: () => Promise.resolve(true),
    saveServerLastWorkSnapshot(reason, options) {
      serverSaveCalls.push({ reason, options });
      return Promise.resolve(true);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(APP_CORE_02, 'scheduleLastWorkSave'), sandbox);

  sandbox.scheduleLastWorkSave(120, { lightweight: true, optionSorterOnly: true, durable: true });
  timers[0].callback();
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(JSON.parse(JSON.stringify(serverSaveCalls)), [{
    reason: 'option-sorter-live',
    options: { force: true },
  }], 'archive 복원은 초안 탭이어도 현재 프로젝트의 durable replica를 강제 갱신해야 합니다.');
});

test('hydration 중 큐에 남은 옵션 보관본 복구도 완료 뒤 durable project replica를 갱신한다', async () => {
  const serverSaveCalls = [];
  const sandbox = {
    Promise,
    optionSorterLiveSaveQueued: true,
    serverLastWorkHydrated: true,
    serverLastWorkHydrating: false,
    saveOptionSorterLiveRecovery: () => Promise.resolve(true),
    saveServerLastWorkSnapshot(reason, options) {
      serverSaveCalls.push({ reason, options });
      return Promise.resolve(true);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(APP_CORE_02, 'flushOptionSorterLiveRecoverySave'), sandbox);

  await sandbox.flushOptionSorterLiveRecoverySave();

  assert.equal(sandbox.optionSorterLiveSaveQueued, false);
  assert.deepEqual(JSON.parse(JSON.stringify(serverSaveCalls)), [{
    reason: 'option-sorter-live',
    options: { force: true },
  }], 'hydration 전에 복원된 15개 매칭과 생성컷은 큐를 비운 뒤에도 프로젝트 서버 저장본까지 이어져야 합니다.');
});

test('얇은 서버 저장본보다 풍부한 옵션 상태는 hydration 뒤 force 저장으로 서버도 복구한다', () => {
  const hydrateSource = extractFunction(APP_CORE_02, 'hydrateServerLastWorkSnapshot');
  const persistentSource = extractFunction(APP_CORE_02, 'savePersistentState');

  assert.match(
    hydrateSource,
    /savePersistentState\(\{\s*server:\s*shouldResaveAfterHydrate,\s*force:\s*shouldResaveAfterHydrate,\s*\}\)/,
    '화면이 서버보다 풍부하면 hydration 종료 저장이 같은 프로젝트 replica를 강제로 갱신해야 합니다.',
  );
  assert.match(
    persistentSource,
    /scheduleServerLastWorkSave\(\s*['"]persistent-state['"],\s*3200,\s*\{\s*factorySnapshot,\s*force:\s*options\.force\s*===\s*true,\s*\}\s*\)/,
    'hydration의 force 의도는 예약된 서버 저장까지 그대로 전달되어야 합니다.',
  );
});

test('옵션 배정 복구값은 현재 프로젝트에만 적용되고 새 작업에서 함께 삭제된다', () => {
  assert.match(APP_CORE_02, /OPTION_SORTER_LIVE_RECOVERY_KEY\s*=\s*['"]pdp_option_sorter_live_v1['"]/);
  assert.match(APP_CORE_02, /function saveOptionSorterLiveRecovery\(/);
  assert.match(APP_CORE_02, /function applyOptionSorterLiveRecovery\(/);
  assert.match(
    extractFunction(APP_CORE_02, 'loadOptionSorterLiveRecovery'),
    /sameScope\s*=|sameProject\s*=/,
    '복구 범위는 snapshot scope와 프로젝트 ID를 함께 확인해야 합니다.',
  );
  assert.doesNotMatch(
    extractFunction(APP_CORE_02, 'applyOptionSorterLiveRecovery'),
    /savedAt\s*[<>]/,
    '같은 작업 scope의 최신 옵션 배정은 부팅 중 갱신되는 공장 savedAt과 비교해 버리면 안 됩니다.',
  );
  assert.match(APP_CORE_02, /workspaceSessionRemoveItem\(OPTION_SORTER_LIVE_RECOVERY_KEY\)/);
  assert.match(APP_CORE_06, /applyOptionSorterLiveRecovery\(\)/);
  assert.ok(
    APP_CORE_06.lastIndexOf('factoryRestoreCurrentWorkfileLocalArchive')
      < APP_CORE_06.lastIndexOf('applyOptionSorterLiveRecovery()'),
    '옵션 배정 복구는 서버·로컬 보관본 복원이 모두 끝난 뒤 마지막으로 적용해야 합니다.',
  );
  assert.doesNotMatch(
    extractFunction(APP_CORE_06, 'runClassicRuntimeHydration'),
    /await\s+factoryRestoreCurrentWorkfileLocalArchive/,
    '느린 로컬 자산 대조 때문에 첫 화면과 옵션 상호작용을 막으면 안 됩니다.',
  );
  assert.doesNotMatch(
    extractFunction(APP_CORE_06, 'runClassicRuntimeHydration'),
    /await\s+(?:hydratePersistentSessionAssets|hydrateServerLastWorkSnapshot)/,
    '대용량 IndexedDB·서버 복원 체인이 첫 화면 렌더를 막으면 안 됩니다.',
  );
  assert.match(
    APP_CORE_06,
    /async function continueClassicRuntimeHydrationInBackground\(/,
    '기존 복원 순서는 별도 백그라운드 체인에서 유지해야 합니다.',
  );
});

test('옵션 원본 보관 완료는 UI 스레드에서 전체 자산관 묶음 생성을 시작하지 않는다', () => {
  const archiveFunction = extractFunction(APP_CORE_06, 'optArchiveSourceImage');
  assert.doesNotMatch(
    archiveFunction,
    /requestCurrentWorkBundleLiveSync/,
    '옵션 원본은 이미 로컬 보관됐으므로 연속 배정 중 전체 작업 묶음 대조를 다시 만들면 안 됩니다.',
  );
});

test('GPT OAuth 이미지 payload를 전달하고 슬롯명을 1.자주 형식으로 저장한다', async () => {
  assert.match(OPTION_VIEW, /id="optAutoNameColors"/);
  assert.match(GENERATION_BINDINGS, /optAutoNameColors/);

  const oauthCalls = [];
  const sandbox = {
    state: { optionSorter: null },
    GeminiAPI: class GeminiAPI {},
    OpenAIAPI: class OpenAIAPI {},
    GptOAuthAPI: class GptOAuthAPI {
      async _exec(prompt, options) {
        oauthCalls.push({ prompt, options });
        return '{"dominant_product_color_id":"burgundy","dominant_product_color_label":"자주","confidence":0.99}';
      }
    },
    optImageDataPart() {
      return { mime: 'image/png', base64: 'fixture-base64' };
    },
    getLLMClient() {
      return new sandbox.GptOAuthAPI();
    },
    getCurrentLlmRunInfo() {
      return { modelId: 'gpt-oauth-test', modelLabel: 'GPT OAuth Test' };
    },
    optBuildVisionColorPrompt() {
      return '색상 판정 프롬프트';
    },
    optParseLooseJson(text) {
      return JSON.parse(text);
    },
    optNormalizeVisionColorHint(data, modelInfo) {
      return { id: data.dominant_product_color_id, label: data.dominant_product_color_label, confidence: data.confidence, modelInfo };
    },
    optAppendLogs() {},
    optGetAuthoritativeColorHint(img) {
      return img?.colorVisionHint || null;
    },
    optIsUsableColorHint(hint) {
      return !!(
        hint?.id
        && hint.id !== 'unknown'
        && Number.isFinite(Number(hint.confidence))
        && Number(hint.confidence) >= 0.35
      );
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFunction(APP_CORE_06, 'optInferImageVisionColorHint'), sandbox);
  vm.runInContext(extractFunction(APP_CORE_06, 'optApplyNumberedVisionColorSlotNames'), sandbox);
  const hint = await sandbox.optInferImageVisionColorHint({ id: 'red', name: 'red.png' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(hint)),
    {
      id: 'burgundy',
      label: '자주',
      confidence: 0.99,
      modelInfo: { modelId: 'gpt-oauth-test', modelLabel: 'GPT OAuth Test' },
    },
  );
  assert.equal(oauthCalls.length, 1);
  assert.equal(oauthCalls[0].prompt, '색상 판정 프롬프트');
  assert.deepEqual(
    JSON.parse(JSON.stringify(oauthCalls[0].options)),
    {
      imageBase64: 'fixture-base64',
      mimeType: 'image/png',
      purpose: '옵션색상판정',
      timeoutMs: 120000,
      jsonOnly: true,
    },
  );
  const os = {
    images: [
      { id: 'red', colorVisionHint: { id: 'burgundy', label: '자주', confidence: 0.99 } },
      { id: 'blue', colorVisionHint: { id: 'blue', label: '파랑', confidence: 0.99 } },
    ],
    slots: [
      { id: 'slot-1', name: '1번', imgIds: ['red'] },
      { id: 'slot-2', name: '2번', imgIds: ['blue'] },
    ],
    optionAutoColorNameStatus: '',
  };
  const renamed = sandbox.optApplyNumberedVisionColorSlotNames(os);
  assert.equal(renamed, 2);
  assert.deepEqual(
    Array.from(os.slots, slot => slot.name),
    ['1.자주', '2.파랑'],
  );
});
