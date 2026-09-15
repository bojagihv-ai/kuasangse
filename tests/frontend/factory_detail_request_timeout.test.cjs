const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function loadHelper() {
  const core = source('src/app-core-06.js');
  const helper = sourceSlice(
    core,
    'function factoryRunBoundedSectionRequest(',
    'async function generateAllSections(',
  );
  const context = vm.createContext({ Promise, setTimeout, clearTimeout });
  vm.runInContext(`${helper}\nthis.runBounded = factoryRunBoundedSectionRequest;`, context);
  return context.runBounded;
}

test('상세페이지 외부 요청은 응답이 멈춰도 제한시간 뒤 retryable timeout으로 끝난다', async () => {
  const runBounded = loadHelper();
  await assert.rejects(
    runBounded('헤더 텍스트', () => new Promise(() => {}), { timeoutMs: 10 }),
    error => error?.code === 'factory_section_request_timeout',
  );
});

test('상세페이지 외부 요청은 작업 취소 신호를 기다리지 않고 즉시 끝낸다', async () => {
  const runBounded = loadHelper();
  const controller = new AbortController();
  const work = runBounded('헤더 이미지', () => new Promise(() => {}), {
    timeoutMs: 10_000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    work,
    error => error?.code === 'factory_section_request_cancelled',
  );
});

