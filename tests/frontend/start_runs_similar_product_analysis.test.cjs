'use strict';

// 계약: **조립공장 시작 버튼이 첫 화면 AI 분석의 "유사 제품 분석" 도 같이 돌린다 - 화면은 옮기지 않고.**
//
// 주인님 2026-09-06: "이 첫번째 화면의 ai분석도 ... 조립공장의 시작 버튼을 눌렀을때 분석 시작하도록 해줘"
// 2026-09-07 확인: 빠진 유사 제품 분석만 채우고 섹션 화면으로 이동하지 않는다.
//
// 첫 화면 startAnalysis 는 이미지 판독 → DB 매칭 → 유사 제품 분석 → 섹션 화면 이동.
// 시작 버튼은 앞의 둘은 이미 했지만 유사 제품 분석(state.competitorData)이 빠져 있었다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

function harness({ competitorData = null, productName = '팔각자개상자', llm } = {}) {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const fn = sourceSlice(source, 'async function factoryEnsureSimilarProductAnalysisForOneClick(', '\nasync function factoryRunCurrentProductImageAnalysisOnly(');
  const logs = [];
  const analysisLogs = [];
  let saves = 0;
  let renders = 0;
  const state = {
    step: 'factory',
    productName,
    analysis: { product_name: productName, category: '주얼리·소품 보관함' },
    competitorData,
  };
  const context = vm.createContext({
    state,
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => 'tok', isOperationCurrent: () => true }),
    factoryRuntimeStaleActionError: name => Object.assign(new Error(name), { code: 'STALE_FACTORY_RUNTIME_ACTION' }),
    cleanDbSearchTerm: value => String(value || '').trim(),
    getAnalysisMatchSettings: () => ({ imageInferenceEngine: 'gemini' }),
    getAnalysisEngineClient: () => llm,
    getLLMClient: () => llm,
    pushAnalysisLog: (message, detail) => analysisLogs.push([message, detail]),
    factoryLog: (message, tone) => logs.push([message, tone]),
    saveLastWorkNow: () => { saves += 1; },
    render: () => { renders += 1; },
    Array,
  });
  vm.runInContext(`${fn}\nthis.run = factoryEnsureSimilarProductAnalysisForOneClick;`, context);
  return {
    state, logs, analysisLogs,
    saves: () => saves, renders: () => renders,
    run: options => context.run({ factory: { product: { productName } }, operationToken: 'tok', ...options }),
  };
}

test('유사 제품 분석이 없으면 첫 화면과 같은 LLM 경로로 채우고, 화면(step)은 옮기지 않는다', async () => {
  const calls = [];
  const fixture = { similar_products: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], recommended_approach: '고급스러운 전통 공예 강조' };
  const h = harness({ llm: { async searchSimilarProducts(name, category) { calls.push([name, category]); return fixture; } } });
  const result = await h.run();
  assert.deepEqual(calls, [['팔각자개상자', '주얼리·소품 보관함']]);
  assert.equal(h.state.competitorData, fixture, 'state.competitorData 에 그대로 기록한다');
  assert.equal(h.state.step, 'factory', '첫 화면 startAnalysis 처럼 sections 로 옮기면 안 된다');
  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.ok(h.logs.some(([m, tone]) => /유사 제품 분석 완료: 3개/.test(m) && tone === 'ok'));
  assert.ok(h.analysisLogs.some(([m]) => m === '유사 제품 분석 완료'));
  assert.equal(h.saves(), 1);
  assert.equal(h.renders(), 1);
});

test('이미 기록된 유사 제품 분석이 있으면 LLM 을 다시 부르지 않는다', async () => {
  let calls = 0;
  const existing = { similar_products: [{ name: 'X' }] };
  const h = harness({ competitorData: existing, llm: { async searchSimilarProducts() { calls += 1; return {}; } } });
  const result = await h.run();
  assert.equal(calls, 0);
  assert.equal(result.reused, true);
  assert.equal(h.state.competitorData, existing);
});

test('LLM 이 실패해도 나머지 실행을 막지 않고, 실패를 로그에 남긴다', async () => {
  const h = harness({ llm: { async searchSimilarProducts() { throw new Error('quota exceeded'); } } });
  const result = await h.run();
  assert.equal(result.ok, true, '첫 화면에서도 건너뛰는 항목 - 시작 실행 전체를 실패로 칠하지 않는다');
  assert.equal(result.skipped, true);
  assert.match(result.reason, /quota exceeded/);
  assert.equal(h.state.competitorData, null);
  assert.equal(h.state.step, 'factory');
  assert.ok(h.logs.some(([m, tone]) => /유사 제품 분석 실패: quota exceeded/.test(m) && tone === 'warn'));
});

test('제품명이 없으면 LLM 을 부르지 않고 건너뛴다', async () => {
  let calls = 0;
  const h = harness({ productName: '', llm: { async searchSimilarProducts() { calls += 1; return {}; } } });
  h.state.analysis = {};
  const result = await h.run({ factory: { product: {} } });
  assert.equal(calls, 0);
  assert.equal(result.skipped, true);
});

test('시작 버튼의 "현재 이미지 AI 분석" 작업이 이미지 분석 뒤에 유사 제품 분석을 이어서 돌린다', () => {
  const source = fs.readFileSync(CORE_06, 'utf8');
  const task = sourceSlice(source, "startTask('현재 이미지 AI 분석', async () => {", "startTask('DB 후보 수집'");
  assert.match(task, /await factoryEnsureCurrentProductImageAnalysisForOneClick\(\{ factory, operationToken \}\);/);
  assert.match(task, /await factoryEnsureSimilarProductAnalysisForOneClick\(\{ factory, operationToken \}\);/);
  assert.match(task, /return analysisResult;/, '이미지 분석 결과가 시작 실행의 판정에 그대로 쓰여야 한다');
  // 단독 "현재 이미지 AI 분석" 버튼은 건드리지 않는다 - 주인님이 고른 건 시작 버튼이다.
  const standalone = sourceSlice(source, 'async function factoryRunCurrentProductImageAnalysisOnly(', '\nasync function factoryYieldToPaint(');
  assert.doesNotMatch(standalone, /factoryEnsureSimilarProductAnalysisForOneClick/);
});
