'use strict';

// 계약: **신화사DB 추가검색은 Cafe24 추가검색과 같다 - 보이는 후보는 지우지 않고, 같은 jcode/상품명은 빼고, 새 후보만 맨 위에.**
//
// 주인님 2026-09-06: "신화사db 중에 사실 저게 있거든? 그래서 카페24 추가검색하는 것처럼 추가검색하려고 했는데 그런 버튼이 없네?"
// 이전 DB 경로(factoryCollectProductCandidatesForReview)는 pendingDbCandidates 를 통째로 비우고 다시 채운다 -
// 그래서 사람이 보던 후보가 사라졌다. 추가검색은 그 길을 타지 않는다.
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

const A = { jcode: 101, id: 101, product_name: '크리스탈 보자기 A', score: 90 };
const B = { jcode: 102, id: 102, product_name: '크리스탈 보자기 B', score: 80 };
const C = { jcode: 103, id: 103, product_name: '크리스탈 보자기 C', score: 70 };

function keyHarness() {
  const sync = read('src/cafe24-sync.js');
  const dedupe = sourceSlice(sync, 'function factoryDedupeSinhwaCandidates(', '\nfunction factoryDedupeCafe24Candidates(');
  const keys = sourceSlice(sync, '// 신화사DB 추가검색용 비교 키', '\nasync function factorySearchSinhwaReviewCandidates(');
  const context = vm.createContext({
    Set, JSON,
    factorySinhwaCandidateKey: candidate => String(candidate?.jcode || candidate?.id || candidate?.product_name || candidate?.jname || '').trim(),
    factoryCandidateName: candidate => candidate?.product_name || candidate?.jname || candidate?.jcode || '신화사DB 후보',
    uniqueApiKeys: values => [...new Set(values)],
    normalizeTextForScore: value => String(value || '').toLowerCase().replace(/\s+/g, ''),
  });
  vm.runInContext(`${dedupe}\n${keys}\nthis.filterNew = factoryFilterNewSinhwaCandidates; this.compareKeys = factorySinhwaCandidateCompareKeys;`, context);
  return context;
}

// vm 안에서 만든 배열은 프로토타입이 달라 strict deepEqual 이 거짓 실패한다 - 값만 꺼낸다.
const plain = value => JSON.parse(JSON.stringify(value));

test('같은 jcode 나 같은 상품명은 기존 후보로 보고 뺀다 - 새 것만 남긴다', () => {
  const h = keyHarness();
  const out = h.filterNew([A, B, C], [A]);
  assert.deepEqual(plain(out.map(c => c.jcode)), [102, 103]);
  // jcode 는 다르지만 상품명이 같은 것도 기존 후보다
  const sameName = { jcode: 999, id: 999, product_name: '크리스탈 보자기 A' };
  assert.deepEqual(plain(h.filterNew([sameName, B], [A]).map(c => c.jcode)), [102]);
  // 새 목록 안의 중복도 한 번만
  assert.deepEqual(plain(h.filterNew([B, { ...B }, C], []).map(c => c.jcode)), [102, 103]);
  assert.ok(Array.from(h.compareKeys(A)).includes('jcode:101'));
  assert.ok(Array.from(h.compareKeys(A)).some(key => key.startsWith('name:')));
});

function collectHarness({ found = [A, B, C] } = {}) {
  const sync = read('src/cafe24-sync.js');
  const dedupe = sourceSlice(sync, 'function factoryDedupeSinhwaCandidates(', '\nfunction factoryDedupeCafe24Candidates(');
  const keys = sourceSlice(sync, '// 신화사DB 추가검색용 비교 키', '\nasync function factorySearchSinhwaReviewCandidates(');
  const collect = sourceSlice(sync, 'async function factoryCollectAdditionalSinhwaCandidatesForReview(', '\nasync function factoryRunSinhwaCandidateAdditionalSearch(');
  const logs = [];
  const searchCalls = [];
  const factory = {
    product: { productName: '크리스탈 보자기', pendingDbCandidates: [A], dbCandidates: [], pendingCafe24Candidates: [{ product_no: 7 }], cafe24Candidates: [] },
    automation: {},
  };
  const context = vm.createContext({
    Set, JSON, Date, Promise, setTimeout,
    factorySinhwaCandidateKey: candidate => String(candidate?.jcode || candidate?.id || candidate?.product_name || candidate?.jname || '').trim(),
    factoryCandidateName: candidate => candidate?.product_name || candidate?.jname || candidate?.jcode || '신화사DB 후보',
    uniqueApiKeys: values => [...new Set(values)],
    normalizeTextForScore: value => String(value || '').toLowerCase().replace(/\s+/g, ''),
    factoryCandidateSearchTerms: () => ['크리스탈 보자기'],
    factoryLog: (message, tone) => logs.push([message, tone]),
    factoryUpdateFinalDbFromFields: () => {},
    factorySearchSinhwaReviewCandidates: async (terms, limit) => { searchCalls.push([terms, limit]); return found; },
    factorySlimReviewCandidateList: (list, type, limit) => list.slice(0, limit).map(item => ({ ...item, reviewProductScopeKey: 'scope' })),
    factoryUpdateCandidateReviewStageStatus: () => {},
  });
  vm.runInContext(`${dedupe}\n${keys}\n${collect}\nthis.collect = factoryCollectAdditionalSinhwaCandidatesForReview;`, context);
  return { context, factory, logs, searchCalls };
}

test('추가검색은 보이는 후보를 지우지 않고 새 후보(B, C)를 맨 위에 붙이며, "이번 추가검색" 표식을 단다', async () => {
  const h = collectHarness();
  const result = await h.context.collect({ factory: h.factory });
  assert.deepEqual(plain(h.searchCalls), [[['크리스탈 보자기'], 40]]);
  assert.deepEqual(plain(h.factory.product.pendingDbCandidates.map(c => c.jcode)), [102, 103, 101], '새 후보 먼저, 기존 후보(A)는 그대로 뒤에');
  assert.equal(h.factory.product.pendingDbCandidates[0].factory_recent_append, true);
  assert.equal(h.factory.product.pendingDbCandidates[0].factory_append_label, '이번 추가검색');
  assert.equal(h.factory.product.pendingDbCandidates[2].factory_recent_append, undefined, '기존 후보에는 표식을 달지 않는다');
  assert.deepEqual(plain(h.factory.product.pendingCafe24Candidates), [{ product_no: 7 }], 'Cafe24 후보는 건드리지 않는다');
  assert.equal(result.addedCount, 2);
  assert.equal(result.totalCount, 3);
  assert.match(h.factory.product.candidateReviewStatus, /신화사DB 추가검색 완료: 기존 후보 1건 제외, 새 후보 2건/);
  assert.equal(h.factory.automation.candidateSearchProgress.kind, 'append-sinhwa');
  assert.equal(h.factory.automation.candidateSearchProgress.running, false);
  assert.equal(h.factory.product.sinhwaDbProgramStatus, null);
});

test('새 후보가 없으면 그렇다고 말하고 기존 후보는 그대로 둔다', async () => {
  const h = collectHarness({ found: [A] });
  const result = await h.context.collect({ factory: h.factory });
  assert.equal(result.addedCount, 0);
  assert.deepEqual(plain(h.factory.product.pendingDbCandidates.map(c => c.jcode)), [101]);
  assert.match(h.factory.product.candidateReviewStatus, /다른 새 후보를 찾지 못했습니다/);
});

test('버튼 → 브리지 → 실행 함수 → 정책이 Cafe24 추가검색과 나란히 연결돼 있다', () => {
  const tab = read('src/menus/factory/tabs/db-tab.mjs');
  const core03 = read('src/app-core-03.js');
  const core05 = read('src/app-core-05.js');
  const sync = read('src/cafe24-sync.js');
  assert.match(tab, /'append-db-query': 'appendDbQuery'/);
  assert.match(tab, /data-factory-guide-action="append-db-query"\$\{busyAttr\}>\$\{escape\(appendDbLabel\)\}/, 'DB 탭에 버튼이 있다');
  assert.match(tab, /기존 후보 제외 신화사DB 추가검색/);
  assert.match(tab, /\['rerun-db-query', 'rerun-cafe24-query', 'append-cafe24-query', 'append-db-query'\]\.includes\(guide\) \? readQuery\(\)/, '검색어 칸의 값을 같이 보낸다');
  assert.match(core03, /appendDbQuery\(value, operationContext\) \{[\s\S]{0,600}factoryRunSinhwaCandidateAdditionalSearch\(\{ operationToken: receipt\.operationToken \}\)/);
  assert.match(core03, /'factory\/sinhwa:collect-additional-db-candidates',\s*'factory\/sinhwa:run-candidate-additional-search',\s*\], 'cafe24', candidateCollectionWorkflow\)/);
  assert.match(sync, /factoryRuntimeUpdateOwnedFactory\(\s*'factory\/sinhwa:run-candidate-additional-search',\s*'cafe24'/);
  assert.match(sync, /factoryRuntimeUpdateOwnedFactory\(\s*'factory\/sinhwa:collect-additional-db-candidates',\s*'cafe24'/);
  // 신화사DB 후보 카드에도 "이번 추가검색" 표식이 보인다
  const meta = sourceSlice(core05, 'function factoryCandidateMetaItems(', '\nfunction factoryCandidateName(');
  assert.match(meta, /return \[\n\s*candidate\?\.factory_recent_append \? \(candidate\.factory_append_label \|\| '이번 추가검색'\) : '',\n\s*candidate\?\.jcode/);
});
