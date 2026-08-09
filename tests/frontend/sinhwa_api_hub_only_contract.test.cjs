'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE = path.join(ROOT, 'src', 'app-core-02.js');

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} 정의가 필요합니다.`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} 함수 시그니처 경계가 필요합니다.`);
  const braceStart = source.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} 본문 경계를 찾지 못했습니다.`);
}

function createApiHubOnlyContext() {
  const calls = [];
  const context = vm.createContext({
    SINHWA_DB_API: { endpoints: { search: 'search-endpoint', detail: 'detail-endpoint' } },
    asSinhwaProductArray: body => Array.isArray(body?.products) ? body.products : [],
    fetchSinhwaPdpBackend: async () => {
      calls.push('pdp-search');
      throw new Error('authentication_failed');
    },
    fetchSinhwaPdpProductContext: async () => {
      calls.push('pdp-detail');
      throw new Error('authentication_failed');
    },
    invokeSinhwaDbEndpoint: async (endpointId, payload) => {
      calls.push(`${endpointId}:${JSON.stringify(payload)}`);
      if (endpointId === 'search-endpoint') return { products: [{ jcode: 501, jname: '복주머니대' }] };
      return { jcode: 501, jname: '복주머니대' };
    },
    flattenSinhwaPdpProductContext: value => value,
    enrichSinhwaProductDetailWithUsage: async value => value,
    console: { warn: () => {} },
  });
  const source = fs.readFileSync(CORE, 'utf8');
  vm.runInContext(`${extractFunction(source, 'searchSinhwaProducts')}\n${extractFunction(source, 'fetchSinhwaProductDetail')}\nglobalThis.runSearch = searchSinhwaProducts;\nglobalThis.runDetail = fetchSinhwaProductDetail;`, context);
  return { calls, context };
}

test('공장 신화사 후보 수집의 API Hub 전용 모드는 PDP 인증 실패와 무관하게 API Hub 검색을 사용한다', async () => {
  const { calls, context } = createApiHubOnlyContext();

  const products = await context.runSearch('복주머니대', { apiHubOnly: true });

  assert.equal(JSON.stringify(products), JSON.stringify([{ jcode: 501, jname: '복주머니대' }]));
  assert.deepEqual(calls, [
    'search-endpoint:{"query":{"q":"복주머니대","limit_each":8}}',
  ]);
});

test('공장 신화사 후보 보강의 API Hub 전용 모드는 PDP 인증 실패와 무관하게 API Hub 상세를 사용한다', async () => {
  const { calls, context } = createApiHubOnlyContext();

  const detail = await context.runDetail(501, { apiHubOnly: true });

  assert.equal(JSON.stringify(detail), JSON.stringify({ jcode: 501, jname: '복주머니대' }));
  assert.deepEqual(calls, [
    'detail-endpoint:{"pathParams":{"jcode":"501"},"query":{"include_raw":false}}',
  ]);
});
