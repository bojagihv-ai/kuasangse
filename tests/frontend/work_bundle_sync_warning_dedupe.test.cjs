'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const APP_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const CAFE24_SYNC_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.search(new RegExp(`function ${name}\\(`));
  assert.notEqual(start, -1, `${name} not found`);
  const signatureStart = source.indexOf('(', start);
  let signatureDepth = 0;
  let bodyStart = -1;
  for (let index = signatureStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') signatureDepth += 1;
    if (char === ')') signatureDepth -= 1;
    if (signatureDepth === 0) {
      bodyStart = source.indexOf('{', index);
      break;
    }
  }
  assert.ok(bodyStart >= 0, `${name} body start not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body not closed`);
}

test('같은 작업의 같은 신화사 자산관 오류는 한 번만 기록하고 성공 시 다시 기록한다', () => {
  const snippets = [
    'createWorkBundleSyncWarningDedupe',
  ].map(name => extractFunction(APP_SOURCE, name));
  const context = vm.createContext({});
  vm.runInContext(`${snippets.join('\n')}\nthis.createDedupe = createWorkBundleSyncWarningDedupe;`, context);
  const dedupe = context.createDedupe();

  assert.equal(dedupe.shouldRecord('kuasangse:work-1', '401'), true);
  assert.equal(dedupe.shouldRecord('kuasangse:work-1', '401'), false);
  assert.equal(dedupe.shouldRecord('kuasangse:work-1', 'timeout'), true);
  dedupe.clear('kuasangse:work-1');
  assert.equal(dedupe.shouldRecord('kuasangse:work-1', '401'), true);
});

test('Cafe24 후보 축약은 공식 옵션과 품목을 보존한다', () => {
  const snippet = extractFunction(CAFE24_SYNC_SOURCE, 'factorySlimCafe24ReviewRaw');
  const context = vm.createContext({
    factorySlimReviewText: value => String(value ?? ''),
  });
  vm.runInContext(`${snippet}\nthis.slim = factorySlimCafe24ReviewRaw;`, context);
  const raw = {
    product_no: '3000',
    product_name: '모시꽃수파우치',
    option: { options: [{ name: '색상', values: [{ name: '빨강' }] }] },
    options: [{ name: '색상', values: [{ name: '빨강' }] }],
    variants: [{ variant_code: 'P0000ETI', options: [{ name: '색상', value: '빨강' }], quantity: 99 }],
    images: [{ image_url: 'https://example.test/a.jpg' }],
  };
  const slim = context.slim(raw);
  assert.deepEqual(slim.option, raw.option);
  assert.deepEqual(slim.options, raw.options);
  assert.deepEqual(slim.variants, raw.variants);
  assert.equal(slim.product_no, '3000');
});

test('저장된 동일 신화사 자산관 경고는 복원 시 한 건으로 압축한다', () => {
  const snippet = extractFunction(APP_SOURCE, 'factoryNormalizePersistedFactoryLogs');
  const context = vm.createContext({});
  vm.runInContext(`${snippet}\nthis.normalizeLogs = factoryNormalizePersistedFactoryLogs;`, context);
  const duplicate = { type: 'warn', message: '로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다: 401', stageId: 'db' };
  const logs = context.normalizeLogs([
    duplicate,
    { ...duplicate, currentRunId: 'different-run', stageId: 'export' },
    { type: 'info', message: '다른 로그' },
  ]);
  assert.equal(logs.length, 2);
  assert.equal(logs.filter(log => log.message === duplicate.message).length, 1);
});

test('이미 normalized된 작업도 새로고침 복원에서 동일 자산관 경고를 한 건으로 압축한다', () => {
  const snippets = [
    'factoryNormalizationIdentityKey',
    'factoryAlreadyNormalized',
    'factoryNormalizePersistedFactoryLogs',
    'normalizeFactoryState',
  ].map(name => extractFunction(APP_SOURCE, name));
  const context = vm.createContext({
    FACTORY_NORMALIZED_STATE_MARKER: '__factoryNormalizedStateV2',
    FACTORY_NORMALIZED_IDENTITY_MARKER: '__factoryNormalizedIdentityKeyV2',
    factoryNormalizeIdentityText: value => String(value || '').trim().toLowerCase(),
  });
  vm.runInContext(`${snippets.join('\n')}\nthis.normalize = normalizeFactoryState;`, context);
  const duplicate = { type: 'warn', message: '로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다: 401' };
  const saved = {
    product: { productName: '모시꽃수파우치' },
    logs: [duplicate, { ...duplicate, stageId: 'export' }, { type: 'info', message: '다른 로그' }],
    __factoryNormalizedStateV2: true,
    __factoryNormalizedIdentityKeyV2: '모시꽃수파우치',
  };

  const restored = context.normalize(saved);
  assert.equal(restored.logs.filter(log => log.message === duplicate.message).length, 1);
  assert.equal(restored.logs.some(log => log.message === '다른 로그'), true);
});
