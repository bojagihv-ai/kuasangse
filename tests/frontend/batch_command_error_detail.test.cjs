'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.resolve(ROOT, 'src/app-core-03.js'), 'utf8');

/**
 * 실측 2026-09-03: 관제탑에 투입한 제품이 곧바로 차단됐는데 화면에는
 * factory_product_workfile_save_failed 라는 낱말만 남았다. 왜 실패했는지는 조립공장
 * 화면의 빨간 띠에만 있어, 사람이 두 화면을 오가며 맞춰야 했다.
 */
test('차단 사유는 코드만이 아니라 실제 문장을 함께 싣는다', () => {
  const start = SOURCE.indexOf('function factoryRuntimeBatchCommandError');
  assert.ok(start > 0, '오류 생성 함수를 찾지 못했다');
  const factory = SOURCE.slice(start, start + 900);
  assert.match(factory, /function factoryRuntimeBatchCommandError\(code, detail = ''\)/u);
  assert.match(factory, /error\.detail = reason/u);
  assert.match(factory, /\$\{code\}: \$\{reason\}/u);
});

test('작업파일 저장 실패는 화면에 뜬 그 문장을 그대로 올려 보낸다', () => {
  const marker = "'factory_product_workfile_save_failed',";
  const at = SOURCE.indexOf(marker);
  assert.ok(at > 0, '저장 실패 지점을 찾지 못했다');
  const site = SOURCE.slice(at, at + 300);
  assert.match(site, /state\.error/u);
  assert.match(site, /작업파일 내보내기 실패/u);
});
