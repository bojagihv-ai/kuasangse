const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

function optionSorterWithStoredResults() {
  return {
    subStep: 'input',
    images: [{ id: 'red', name: '1.빨강' }],
    slots: [{ id: 'slot-1', name: '1.빨강', imgIds: ['red'] }],
    optionResults: [
      { id: 'sheet-1', resultKind: 'option' },
      { id: 'group-1', resultKind: 'color-group-shot' },
    ],
  };
}

test('입력 단계에서 보관된 옵션표와 단체컷 미리보기를 바로 렌더한다', async () => {
  const { renderOptionSorterView } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-view.mjs')).href}?stored-results=${Date.now()}`,
  );
  const markup = renderOptionSorterView({ optionSorter: optionSorterWithStoredResults() }, {
    ensureOptionSorterDefaults: () => {},
    optMissingImagePayloadCount: () => 0,
    renderOptionSorterSourceStrip: () => '',
    renderOptionSorterAssignmentWorkspace: () => '',
    renderOptionImageGeneratorPanel: () => '',
    renderOptionSorterImagePreviewModal: () => '',
    optRenderImageOrPlaceholder: (result, attrs) => `<img data-test-stored-result-image="${result.id}" ${attrs}>`,
    disabledAttr: disabled => disabled ? 'disabled' : '',
    escapeHtml: value => String(value || ''),
  });

  assert.match(markup, /id="optOpenStoredOptionResults"/);
  assert.match(markup, /보관된 생성컷 2장/);
  assert.match(markup, /옵션표 1장 · 단체컷 1장/);
  assert.match(markup, /id="optStoredOptionResultsPreview"/);
  assert.equal((markup.match(/data-opt-stored-result-preview=/g) || []).length, 2);
  assert.match(markup, /object-fit:cover/);
  assert.match(markup, /data-test-stored-result-image="sheet-1"/);
  assert.match(markup, /data-test-stored-result-image="group-1"/);
});

test('보관된 생성컷 보기로 이동해도 이미지, 슬롯, 결과를 지우지 않는다', async () => {
  const { bindOptionSorterSlots } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-slot-bindings.mjs')).href}?stored-results=${Date.now()}`,
  );
  const optionSorter = optionSorterWithStoredResults();
  const openResults = {};
  const storedResults = { scrollIntoView: options => calls.push(['scroll', options.block]) };
  const calls = [];
  let rendered = false;
  bindOptionSorterSlots({
    byId: id => {
      if (id === 'optOpenStoredOptionResults') return openResults;
      if (id === 'optStoredOptionResults' && rendered) return storedResults;
      return null;
    },
    queryAll: () => [],
    optionSorter: () => optionSorter,
    requestRender: () => { rendered = true; calls.push('render'); },
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
    reportWarning: () => {},
  });

  assert.equal(typeof openResults.onclick, 'function');
  const before = JSON.stringify({
    images: optionSorter.images,
    slots: optionSorter.slots,
    optionResults: optionSorter.optionResults,
  });
  openResults.onclick();

  assert.equal(optionSorter.subStep, 'sort');
  assert.ok(optionSorter.subStepUpdatedAt > 0);
  assert.equal(JSON.stringify({
    images: optionSorter.images,
    slots: optionSorter.slots,
    optionResults: optionSorter.optionResults,
  }), before);
  assert.deepEqual(calls, ['save', 'render', ['scroll', 'start']]);
});

test('옵션분류기 경로는 보관 생성컷 복원을 기다린 뒤 더 완전한 현재 상태를 렌더한다', async () => {
  const { createOptionSorterMenu } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'menus', 'optionsorter-controller.mjs')).href}?archive-before-route=${Date.now()}`,
  );
  const { createRouteController } = await import(
    `${pathToFileURL(path.join(ROOT, 'src', 'shell', 'route-controller.mjs')).href}?archive-before-route=${Date.now()}`,
  );
  const stale = optionSorterWithStoredResults();
  stale.optionResults = stale.optionResults.filter(result => result.resultKind !== 'color-group-shot');
  let current = { optionSorter: stale };
  let restoreCalls = 0;
  let renderedSnapshot = null;
  const renderHelpers = Object.fromEntries([
    'ensureOptionSorterDefaults', 'optMissingImagePayloadCount', 'renderOptionSorterSourceStrip',
    'renderOptionSorterAssignmentWorkspace', 'renderOptionImageGeneratorPanel',
    'optRenderImageOrPlaceholder', 'renderOptionSorterImagePreviewModal', 'disabledAttr', 'escapeHtml',
  ].map(name => [name, () => '']));
  const menu = createOptionSorterMenu({
    getSnapshot: () => current,
    assertMutable() {}, mutateOptions() {}, persistOptions() {}, getSlotNamePresets: () => [],
    saveSlotNamePreset: value => value, loadVisionColors: async () => ({}), applyVisionColors() {},
    async restoreArchivedSourceImages() {
      restoreCalls += 1;
      current = { optionSorter: optionSorterWithStoredResults() };
    },
    requestRender() {}, getOperationToken: () => 'workspace:archive:1', reportError() {},
    bindHelpers: {}, renderHelpers,
  });
  const controller = createRouteController({
    registry: { getByRoute: route => route === 'optionsorter' ? menu : null },
    renderLifecycle: {
      activate: async ({ snapshot }) => { renderedSnapshot = snapshot; return { activated: true }; },
      currentRoute: () => null,
      captureOperation: () => ({}),
      isCurrent: () => true,
      dispose() {},
    },
  });

  await controller.navigate('optionsorter', { workspaceId: 'project:current', optionSorter: stale });

  assert.equal(restoreCalls, 1);
  assert.equal(renderedSnapshot.optionSorter.optionResults.length, 2);
  assert.ok(renderedSnapshot.optionSorter.optionResults.some(result => result.resultKind === 'color-group-shot'));
});
