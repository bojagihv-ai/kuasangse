'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE_01 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-01.js'), 'utf8');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test('고위험 degraded 오류는 한국어 상태와 로그를 한 번만 남기고 성공 뒤 재허용한다', () => {
  const reported = new Map();
  const notices = [];
  const logs = [];
  const warnings = [];
  const state = { uiNotice: null, runtimeDegradedStatus: null };
  const context = vm.createContext({
    state,
    runtimeDegradedWarningDedupe: {
      shouldRecord(key, message) {
        if (reported.get(key) === message) return false;
        reported.set(key, message);
        return true;
      },
      clear(key) { reported.delete(key); },
    },
    setUiNotice(message, type) {
      state.uiNotice = message ? { message, type } : null;
      notices.push({ message, type });
    },
    factoryLog(message, type) { logs.push({ message, type }); },
    console: { warn(...args) { warnings.push(args); } },
    Date,
    String,
  });
  vm.runInContext([
    extractFunction(CORE_03, 'reportRuntimeDegradedOnce'),
    extractFunction(CORE_03, 'clearRuntimeDegraded'),
    'this.report = reportRuntimeDegradedOnce;',
    'this.clear = clearRuntimeDegraded;',
  ].join('\n'), context);

  assert.equal(context.report('workfile-warm-load', '작업파일 자동 연결 저하', new Error('read failed')), true);
  assert.equal(context.report('workfile-warm-load', '작업파일 자동 연결 저하', new Error('read failed')), false);
  assert.equal(notices.length, 1);
  assert.equal(logs.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(state.runtimeDegradedStatus.message, /작업파일 자동 연결 저하/);

  context.clear('workfile-warm-load');
  assert.equal(state.runtimeDegradedStatus, null);
  assert.equal(state.uiNotice, null);
  assert.equal(context.report('workfile-warm-load', '작업파일 자동 연결 저하', new Error('read failed')), true);

  assert.match(CORE_01, /reportRuntimeDegradedOnce\(\s*'gpt-oauth-options'/);
  assert.match(CORE_03, /reportRuntimeDegradedOnce\(\s*'workfile-warm-load'/);
  assert.match(CORE_03, /reportRuntimeDegradedOnce\(\s*'visual-validation-render'/);
});
