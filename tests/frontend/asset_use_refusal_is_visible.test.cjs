'use strict';

// 회귀: 대표이미지 '사용' 버튼이 먹통처럼 보이던 문제.
//
// 사용자 제보(2026-08-29): "대표이미지 선택이 안되는데? 먹통이야 왜이래"
//   화면은 '선택 가능 이미지 4개' 라고 하는데 눌러도 아무 일이 없었다.
//
// 클릭이 말없이 삼켜지는 자리가 둘 있었다:
//   1) factoryToggleAssetUse 의 신원 게이트 (app-core-06.js)
//      — 진행 로그에 한 줄만 남겨서 사람이 놓친다.
//   2) factoryRuntimeBridgeAction 의 '오래된 작업' 판정 (app-core-03.js:11374)
//      — 예외만 던지고 끝난다. 화면에는 아무것도 안 뜬다.
//      이 판정의 면제 목록에는 Cafe24 후보 선택 3개뿐이고 이미지 사용은 없다.
//
// 계약: 거부하려면 **왜 거부하는지 화면에 말해야 한다.**
//       고장인지 규칙인지 사람이 구분할 수 있어야 한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정 자체가 검사 대상이므로 실물을 싣는다.
function loadToggle({ hasPayload = false, completedSizeRun = false } = {}) {
  const source = sourceSlice(CORE_06, 'function factoryToggleAssetUse(', 'function factoryToggleAssetReject(');
  const notices = [];
  const logs = [];
  const context = vm.createContext({
    factoryAssetHasCurrentProductPayload: () => hasPayload,
    factoryAssetIsCompletedCurrentSizeRun: () => completedSizeRun,
    factoryLog: (message, level) => { logs.push({ message: String(message), level }); },
    setUiNotice: (message, level) => { notices.push({ message: String(message), level }); },
    uniqueApiKeys: values => Array.from(new Set(values)),
    saveLastWorkNow() {},
    scheduleSessionAssetSaveIfChanged: undefined,
    requestCurrentWorkBundleLiveSync: undefined,
    render() {},
  });
  vm.runInContext(`${source}\nthis.toggle = factoryToggleAssetUse;`, context);
  return { toggle: context.toggle, notices, logs };
}

function heroFactory() {
  return {
    assets: [{ id: 'hero-1', title: '한 대표 이미지', stageId: 'hero', used: false }],
    stages: { hero: { selectedAssetIds: [] } },
  };
}

test('쓸 수 없는 이미지는 이유를 화면에 말한다', () => {
  // 예전에는 진행 로그 한 줄뿐이라 버튼이 죽은 것처럼 보였다.
  const h = loadToggle({ hasPayload: false, completedSizeRun: false });
  const factory = heroFactory();
  h.toggle('hero-1', factory, { save: false, saveAssets: false, render: false });

  assert.equal(factory.assets[0].used, false, '쓸 수 없는 이미지를 선택 상태로 만들면 안 됩니다.');
  assert.equal(h.notices.length, 1, '화면에 아무 말도 없으면 사람은 고장으로 받아들입니다.');
  assert.match(h.notices[0].message, /사용할 수 없습니다/);
  assert.match(h.notices[0].message, /현재 제품 작업의 것이 아닙니다/, '왜 안 되는지가 빠졌습니다.');
  assert.equal(h.notices[0].level, 'error');
});

test('쓸 수 있는 이미지는 그대로 선택된다', () => {
  const h = loadToggle({ hasPayload: true });
  const factory = heroFactory();
  assert.equal(h.toggle('hero-1', factory, { save: false, saveAssets: false, render: false }), true);
  assert.equal(factory.assets[0].used, true);
  assert.deepEqual(factory.stages.hero.selectedAssetIds, ['hero-1']);
  assert.equal(h.notices.length, 0, '정상 선택에 경고를 띄우면 안 됩니다.');
});

test('이미 선택된 것을 해제할 때는 게이트를 통과한다', () => {
  // 해제는 신원과 무관하다. 여기서 막으면 잘못 고른 것을 되돌릴 수 없다.
  const h = loadToggle({ hasPayload: false });
  const factory = heroFactory();
  factory.assets[0].used = true;
  assert.equal(h.toggle('hero-1', factory, { save: false, saveAssets: false, render: false }), true);
  assert.equal(factory.assets[0].used, false);
  assert.equal(h.notices.length, 0);
});

test('진행 중인 작업 때문에 막히면 그것도 화면에 말한다', () => {
  // factoryRuntimeBridgeAction 은 '오래된 작업' 이면 예외만 던지고 끝난다(11374행).
  // 그 예외를 삼키지 말고, 왜 안 됐는지 알린 뒤 다시 던져야 한다.
  const bridge = sourceSlice(CORE_03, 'toggleFactoryAssetUse(assetId, operationContext) {', 'selectFactoryACut');
  assert.match(bridge, /try \{/);
  assert.match(bridge, /setUiNotice\(/, '막혔는데 화면이 조용하면 먹통으로 보입니다.');
  assert.match(bridge, /다른 작업이 진행 중이라/);
  assert.match(bridge, /throw error;/, '알린 뒤에는 원래 오류를 그대로 올려야 상위에서 진단됩니다.');
});

test('오래된 작업 판정의 면제 목록은 늘리지 않는다', () => {
  // 면제를 늘리면 진행 중인 작업의 결과를 엉뚱한 상태에 반영할 수 있다.
  // 이미지 사용은 면제가 아니라 '이유를 말하고 거부' 로 다룬다.
  const exempt = sourceSlice(CORE_03, 'const reuseActiveOneClickDraft', '].includes(actionName);');
  assert.doesNotMatch(exempt, /factory\/assets:/, '이미지 계열을 면제 목록에 넣으면 안 됩니다.');
  assert.match(exempt, /factory\/cafe24:apply-db-candidate/);
});
