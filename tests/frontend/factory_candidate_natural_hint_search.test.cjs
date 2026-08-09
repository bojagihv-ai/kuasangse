'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');

function sourceSlice(startMarker, endMarker) {
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return SOURCE.slice(start, end);
}

test('DB/Cafe24 후보 검색은 제품명 뒤에 자연어 힌트 표현을 하나씩 분리해 사용한다', () => {
  const candidateSource = sourceSlice(
    'function factoryAddSearchTerm(',
    'function factoryDedupeSinhwaCandidates(',
  );
  const context = vm.createContext({
    state: { productName: '' },
    factoryRuntimeReadFactory: () => ({ product: {} }),
    cleanDbSearchTerm: value => String(value || '').trim().replace(/\s+/g, ' '),
    normalizeTextForScore: value => String(value || '').trim().toLowerCase(),
  });
  vm.runInContext(
    `${candidateSource}\nthis.searchTerms = factoryCandidateSearchTerms;`,
    context,
  );

  const terms = Array.from(context.searchTerms({
    product: {
      productName: '호박바늘꽂이',
      naturalHint: '바늘쌈, 바늘꽃 / 재봉 바늘 보관\n호박 핀쿠션',
    },
  }));

  assert.equal(terms[0], '호박바늘꽂이');
  for (const expression of ['바늘쌈', '바늘꽃', '재봉 바늘 보관', '호박 핀쿠션']) {
    assert.ok(terms.includes(expression), `개별 자연어 검색어 누락: ${expression}`);
  }
  assert.equal(new Set(terms).size, terms.length, '동일 검색어를 중복 호출하면 안 됩니다.');
});

test('Cafe24 직접 후보 검색은 앞의 세 개가 아니라 준비된 모든 검색어를 조회한다', async () => {
  const directSource = sourceSlice(
    'async function factorySearchCafe24DirectReviewCandidates(',
    'async function factorySearchCafe24ReviewCandidates(',
  );
  const calls = [];
  const context = vm.createContext({
    cleanDbSearchTerm: value => String(value || '').trim(),
    fetchCafe24ProductsByQuery: async term => {
      calls.push(term);
      return [];
    },
    normalizeCafe24ProductCandidate: row => row,
    scoreCafe24ProductCandidate: () => 0,
    factoryCandidateScore: () => 0,
    factoryDedupeCafe24Candidates: rows => rows,
    factorySlimReviewCandidateList: rows => rows,
  });
  vm.runInContext(
    `${directSource}\nthis.searchDirect = factorySearchCafe24DirectReviewCandidates;`,
    context,
  );

  await context.searchDirect(
    ['호박바늘꽂이', '바늘쌈', '바늘꽃', '재봉 바늘 보관', '호박 핀쿠션'],
    24,
  );

  assert.deepEqual(calls, [
    '호박바늘꽂이',
    '바늘쌈',
    '바늘꽃',
    '재봉 바늘 보관',
    '호박 핀쿠션',
  ]);
});

test('Cafe24 직접 후보 검색은 자연어 검색어를 병렬 호출한다', async () => {
  const directSource = sourceSlice(
    'async function factorySearchCafe24DirectReviewCandidates(',
    'async function factorySearchCafe24ReviewCandidates(',
  );
  let active = 0;
  let maxActive = 0;
  const releases = [];
  const context = vm.createContext({
    cleanDbSearchTerm: value => String(value || '').trim(),
    fetchCafe24ProductsByQuery: term => new Promise(resolve => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      releases.push(() => {
        active -= 1;
        resolve([{ product_name: term }]);
      });
    }),
    normalizeCafe24ProductCandidate: row => row,
    scoreCafe24ProductCandidate: () => 50,
    factoryCandidateScore: () => 50,
    factoryDedupeCafe24Candidates: rows => rows,
    factorySlimReviewCandidateList: rows => rows,
  });
  vm.runInContext(
    `${directSource}\nthis.searchDirect = factorySearchCafe24DirectReviewCandidates;`,
    context,
  );

  const pending = context.searchDirect(['호박바늘꽂이', '바늘쌈', '바늘꽃'], 24);
  await Promise.resolve();
  assert.equal(maxActive, 3);
  releases.forEach(release => release());
  await pending;
});
