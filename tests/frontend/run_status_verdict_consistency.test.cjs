'use strict';

// 계약: **같은 실행(goal)을 그리는 세 자리는 같은 판정을 내리고, 진행률과 '완료' 는 실행 자신이 말한다.**
//
// 2026-08-31 주인님: "진행되는 와중에 진행상황이 뻘겋게되면서 실패라고 나왔거든?
//                    그러다 마저 진행되면서 다시 뻘건테두리가 없어졌는데 왜이러는거지?"
//
// 그날 자동화 패널(renderFactoryAutomationRunStatus)만 고쳤다(커밋 2a95015):
// 판정 인자를 로그 한 줄이 아니라 String(goal.currentStage || '') 로.
// 그런데 같은 goal 을 그리는 자리가 두 곳 더 있었다.
//   - renderFactoryProductActionStatus (app-core-05)   : 제품 탭 위의 실행 상태 카드
//   - factoryPatchGoalRunStatusInPlace  (app-core-06)   : 두 카드를 제자리에서 갱신하는 패처
// 둘 다 여전히 `goal.currentStage || dbStage.message || latestLog.message` 를 판정에 넣었다.
// 그래서 같은 순간에 자동화 패널은 "최근 진행상황", 제품 카드는 "조립공장 실행 실패" 였다.
// 화면이 자기 자신과 다르게 말하면 사람은 어느 쪽도 믿지 못한다.
//
// 진행률도 같은 문제였다. factoryGoalRunDisplayProgress 가 문구에
// /완료|검색 완료|수집 완료|확보/ 가 있으면 100% 를 만들고 알약에 '완료' 를 찍었다.
// 실제 도달 경로: 단독 VM 후보 수집이 52% 에서 '경쟁사 후보 확보' 로 끝난다.
// 로그 한 줄에 '검색 완료' 만 들어와도 40% 짜리 실행이 '완료' 로 보였다.
// 진행률은 goal.progress 만, 실패는 goal.failureReason/currentStage 만 말한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

// 판정·진행률 함수와 제품 카드 렌더러 (app-core-05)
const judgedAndProductCard = sourceSlice(CORE_05, 'function factoryGoalRunNeedsAttention(', 'function renderFactoryProductPanel(');
// 자동화 패널 렌더러 (app-core-05)
const automationCard = sourceSlice(CORE_05, 'function renderFactoryAutomationRunStatus(', 'function renderFactoryAutomationCurrentTask(');
// 제자리 패처 (app-core-06)
const patcher = sourceSlice(CORE_06, 'function factoryPatchGoalRunStatusInPlace(', 'function factorySetGoalRunProgress(');

// 가짜 DOM: 패처가 만지는 만큼만 흉내 낸다. 판정 결과(제목·알약·진행률·failed 클래스)를 읽기 위해서다.
function fakeStatusNode(kind) {
  const children = {};
  const make = (extra = {}) => ({ textContent: '', innerHTML: '', style: {}, dataset: {}, ...extra });
  const barClasses = new Set();
  children['[data-factory-goal-title]'] = make();
  children['[data-factory-goal-stage]'] = make();
  children['[data-factory-goal-helper]'] = make();
  children['[data-factory-goal-failure]'] = make();
  children['[data-factory-goal-pill]'] = make();
  const bar = make({
    style: { setProperty(name, value) { this[name] = value; } },
    parentElement: { classList: { toggle(name, on) { if (on) barClasses.add(name); else barClasses.delete(name); }, has: name => barClasses.has(name) } },
  });
  children['[data-factory-goal-progress-bar]'] = bar;
  return {
    dataset: { factoryGoalStatus: kind },
    style: {},
    querySelector: selector => children[selector] || null,
    read() {
      return {
        title: children['[data-factory-goal-title]'].textContent,
        pill: children['[data-factory-goal-pill]'].textContent,
        progress: bar.style['--p'],
        failed: barClasses.has('failed'),
      };
    },
  };
}

function buildContext(factory) {
  const nodes = [fakeStatusNode('product'), fakeStatusNode('automation')];
  const context = {
    String, RegExp, Math, Number, Boolean, Array, Object, Date, Set,
    console,
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    factoryNormalizeStoppedGoalRun: () => false,
    factoryVisibleFactoryLogs: f => (Array.isArray(f.logs) ? f.logs : []),
    factoryVisibleRunLogText: value => String(value || ''),
    factoryGoalVisibleLogText: value => String(value || ''),
    factoryLiveEllipsisMarkup: () => '',
    factoryReconcilePersistedStageState: f => f,
    ensureCompMarketScrapeState: () => ({}),
    factoryLogProcessLabel: () => '공정',
    renderFactoryManualInterventionPrompt: () => '',
    renderFactoryStageRailBody: () => '',
    factoryStageRailRenderSignature: () => '',
    factoryPatchCandidateCollectionStatusInPlace: () => false,
    factoryGoalLogItemsHtml: () => '',
    factoryGoalProgressClamp: value => Math.max(0, Math.min(100, Math.round(Number(value || 0) || 0))),
    factoryRuntimeReadFactory: () => factory,
    CSS: undefined,
    document: {
      querySelectorAll: selector => (selector === '[data-factory-goal-status]' ? nodes : []),
    },
  };
  vm.createContext(context);
  vm.runInContext([
    judgedAndProductCard,
    automationCard,
    patcher,
    'globalThis.__product = renderFactoryProductActionStatus;',
    'globalThis.__automation = renderFactoryAutomationRunStatus;',
    'globalThis.__patch = factoryPatchGoalRunStatusInPlace;',
    'globalThis.__progress = factoryGoalRunDisplayProgress;',
    'globalThis.__pill = factoryGoalRunPillText;',
  ].join('\n'), context);
  return { context, nodes };
}

function readCard(html) {
  const title = /data-factory-goal-title[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
  const pill = /data-factory-goal-pill>([^<]*)</.exec(html)?.[1] ?? '';
  const progress = /data-factory-goal-progress-bar style="--p:([^"]*)"/.exec(html)?.[1] ?? '';
  const failed = /class="factory-progress failed/.test(html);
  return { title, pill, progress, failed };
}

// 세 자리를 같은 factory 로 실제 실행해 판정을 모은다.
function verdicts(factory) {
  const { context, nodes } = buildContext(factory);
  const product = readCard(context.__product(factory));
  const automation = readCard(context.__automation(factory, {}));
  context.__patch(factory);
  const patchedProduct = nodes[0].read();
  const patchedAutomation = nodes[1].read();
  return { product, automation, patchedProduct, patchedAutomation };
}

const FAILED_TITLES = /실패/;

test('실행이 멀쩡한데 최근 로그 한 줄이 오류면, 세 자리 모두 실패라 하지 않는다', () => {
  // 단계 사이(currentStage 비어 있음)에 마지막 로그가 하필 오류였던 순간.
  const factory = {
    goalRun: { running: false, currentStage: '', progress: 40, failureReason: '' },
    stages: { db: { status: 'running', message: '신화사DB 후보 조회 실패: 상세 조회 실패' } },
    logs: [{ type: 'error', message: '신화사DB 후보 적용 실패: 상세 조회 실패', time: '10:00' }],
  };
  const v = verdicts(factory);
  for (const [name, card] of Object.entries(v)) {
    assert.doesNotMatch(card.title, FAILED_TITLES, `${name}: 로그 한 줄이 판정을 대신했습니다 - 제목 "${card.title}"`);
    assert.doesNotMatch(card.pill, /실패/, `${name}: 알약이 "${card.pill}"`);
    assert.equal(card.failed, false, `${name}: 진행 막대가 failed 로 칠해졌습니다`);
  }
});

test('진짜 실패(goal.failureReason)는 세 자리 모두 실패라 한다', () => {
  const factory = {
    goalRun: { running: false, currentStage: '새 생성 실패: 이미지 API 실패', progress: 70, failureReason: '이미지 API 실패' },
    stages: { db: { status: 'done', message: '후보 1건 확정' } },
    logs: [{ type: 'ok', message: '후보 1건 확정', time: '10:00' }],
  };
  const v = verdicts(factory);
  for (const [name, card] of Object.entries(v)) {
    assert.match(card.title, FAILED_TITLES, `${name}: 진짜 실패를 놓쳤습니다 - 제목 "${card.title}"`);
    assert.match(card.pill, /^실패 · 70%$/, `${name}: 알약이 "${card.pill}"`);
    assert.equal(card.failed, true, `${name}: 진행 막대가 failed 가 아닙니다`);
  }
});

test('세 자리의 제목·알약·진행률이 서로 같다 (여러 상태 표본)', () => {
  const samples = [
    { goalRun: { running: true, currentStage: 'VM 경쟁사 후보 수집 중', progress: 34, failureReason: '' }, logs: [{ type: 'info', message: '경쟁사 후보 수집 시작' }] },
    { goalRun: { running: false, currentStage: '경쟁사 후보 확보', progress: 52, failureReason: '' }, logs: [{ type: 'warn', message: '경쟁사 후보 3건 수집 완료.' }] },
    { goalRun: { running: false, currentStage: 'DB/VM 후보 확인 필요', progress: 100, failureReason: '후보 0건' }, logs: [] },
    { goalRun: { running: false, currentStage: '', progress: 0, failureReason: '' }, logs: [{ type: 'error', message: 'VM 상세페이지 수집 실패: 요청 시간이 360초를 넘어 중단되었습니다.' }] },
  ];
  for (const factory of samples) {
    const v = verdicts(factory);
    // 제품 카드와 패처의 제품 노드, 자동화 카드와 패처의 자동화 노드는 문구까지 같아야 한다.
    assert.deepEqual(v.patchedProduct, v.product, `제품 카드 vs 패처(product) 불일치: ${JSON.stringify(factory.goalRun)}`);
    assert.deepEqual(v.patchedAutomation, v.automation, `자동화 카드 vs 패처(automation) 불일치: ${JSON.stringify(factory.goalRun)}`);
    // 제품 카드와 자동화 카드는 제목 문구는 달라도 알약·진행률·실패 여부는 같아야 한다.
    assert.equal(v.product.pill, v.automation.pill, `알약 불일치: ${JSON.stringify(factory.goalRun)}`);
    assert.equal(v.product.progress, v.automation.progress, `진행률 불일치: ${JSON.stringify(factory.goalRun)}`);
    assert.equal(v.product.failed, v.automation.failed, `실패 판정 불일치: ${JSON.stringify(factory.goalRun)}`);
  }
});

test("진행률과 '완료' 는 goal.progress 만 말한다 - 문구에 '완료/확보' 가 있어도 100 을 만들지 않는다", () => {
  const { context } = buildContext({ goalRun: {}, logs: [] });
  const progress = context.__progress;
  const pill = context.__pill;
  // 단독 VM 후보 수집이 실제로 끝나는 자리: 52% · '경쟁사 후보 확보'. 예전엔 여기서 100%·'완료' 가 됐다.
  assert.equal(progress({ running: false, progress: 52, currentStage: '경쟁사 후보 확보' }, '경쟁사 후보 확보'), 52);
  assert.notEqual(pill({ running: false, progress: 52, currentStage: '경쟁사 후보 확보' }, '경쟁사 후보 확보', true), '완료');
  // 로그 한 줄에 '검색 완료' 가 들어와도 40% 짜리 실행은 40% 다.
  assert.equal(progress({ running: false, progress: 40, currentStage: '' }, '6번 · 경쟁사 후보 9건 검색 완료'), 40);
  assert.notEqual(pill({ running: false, progress: 40, currentStage: '' }, '6번 · 경쟁사 후보 9건 검색 완료', true), '완료');
  // 실행 자신이 100 이라 하면 완료다.
  assert.equal(progress({ running: false, progress: 100, currentStage: '수집/생성 완료' }), 100);
  assert.equal(pill({ running: false, progress: 100, currentStage: '수집/생성 완료' }, '수집/생성 완료', true), '완료');
  // 진행 중은 숫자만.
  assert.equal(pill({ running: true, progress: 34, currentStage: 'VM 경쟁사 후보 수집 중' }, 'VM 경쟁사 후보 수집 중', true), '34%');
  // 실행이 100 이어도 실패 사유가 있으면 완료가 아니다.
  assert.equal(pill({ running: false, progress: 100, currentStage: '검수 필요', failureReason: '컷 1 생성 실패' }, '검수 필요', true), '실패 · 100%');
});

test('단독 VM 후보 수집은 실행 자신이 100 을 말한다 (문구 정규식이 대신 만들던 완료)', () => {
  // '확보' 단계를 찍는 두 자리가 standalone 이면 100, 큰 흐름의 일부면 52 를 넘긴다.
  const collector = sourceSlice(CORE_06, 'async function factoryRunVmCompetitorCollectionForSelection(', 'async function factoryRunHeroAndCutsForOneClick(');
  const secured = collector.match(/factorySetGoalRunProgress\(options\.standalone \? 100 : 52,/g) || [];
  assert.equal(secured.length, 2, "'확보' 를 찍는 두 자리가 standalone 여부로 100/52 를 갈라야 합니다.");
  assert.match(collector, /standalone: true,/, '래퍼(factory 없이 호출)가 standalone 을 표시해야 합니다.');
});
