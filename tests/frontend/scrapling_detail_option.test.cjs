'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('Scrapling 상세수집은 기존 VM 기본값과 분리된 선택 버튼이다', () => {
  const view = read('src', 'app-core-05.js');
  const runtime = read('src', 'app-core-06.js');
  const modularView = read('src', 'menus', 'factory', 'tabs', 'competitor-tab-candidates.mjs');
  const modularRuntime = read('src', 'app-core-03.js');

  assert.match(view, /data-comp-market-quick-action="detail-scrapling"/);
  assert.match(view, /B안\s*·\s*Scrapling 상세수집/);
  assert.match(modularView, /data-comp-market-quick-action="detail-scrapling"/);
  assert.match(modularView, /B안\s*·\s*Scrapling 상세수집/);
  assert.match(modularRuntime, /quickAction === 'detail-scrapling'/);
  assert.match(modularRuntime, /runCompMarketScraplingDetailCapture\(receipt\.value/);
  assert.match(runtime, /if \(action === 'detail-scrapling'\)/);
  assert.match(runtime, /runCompMarketScraplingDetailCapture/);
  assert.match(runtime, /\/api\/scrapling\/detail-capture/);
  assert.match(runtime, /runCompMarketScrape\('vm'\)/, '기본 VM 후보수집 경로는 유지되어야 한다');
});

test('Scrapling 결과는 현재 상세이미지 파이프라인에 병합된다', () => {
  const runtime = read('src', 'app-core-06.js');
  const wrapperStart = runtime.indexOf('async function runCompMarketScraplingDetailCapture');
  const captureStart = runtime.indexOf('async function runCompMarketDetailCapture(productIds', wrapperStart);
  const captureEnd = runtime.indexOf('\nasync function ', captureStart + 20);
  assert.notEqual(wrapperStart, -1, 'Scrapling 상세수집 함수가 없다');
  const wrapper = runtime.slice(wrapperStart, captureStart);
  const body = runtime.slice(captureStart, captureEnd === -1 ? runtime.length : captureEnd);

  assert.match(wrapper, /runtime:\s*'scrapling'/);
  assert.match(wrapper, /captureRuntime:\s*'scrapling'/);
  assert.match(body, /compMarketExtractDetailImages/);
  assert.match(body, /compMarketMergeScrapedImages/);
  assert.match(body, /\/api\/scrapling\/detail-capture/);
});
