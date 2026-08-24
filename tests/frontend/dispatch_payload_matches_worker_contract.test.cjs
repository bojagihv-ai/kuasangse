'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function workerAllowedKeys() {
  const contract = source('src/modules/batch-control-product-contract.mjs');
  const at = contract.indexOf('const PRODUCT_RUN_KEYS = Object.freeze([');
  assert.notEqual(at, -1, 'PRODUCT_RUN_KEYS 를 찾지 못했습니다');
  const block = contract.slice(at, contract.indexOf(']);', at));
  return new Set([...block.matchAll(/'([^']+)'/g)].map(match => match[1]));
}

function towerDispatchKeys() {
  const sync = source('control_tower/backend/factory_sync.py');
  const at = sync.indexOf('"name": PRODUCT_RUN_COMMAND,');
  assert.notEqual(at, -1, '제품 실행 주문 발행부를 찾지 못했습니다');
  const block = sync.slice(at, at + 1400);
  return new Set([...block.matchAll(/"([A-Za-z][A-Za-z0-9]*)":/g)].map(match => match[1]));
}

function towerRuntimePayloadKeys() {
  const sync = source('control_tower/backend/factory_sync.py');
  const at = sync.indexOf('runtime_payload = {');
  assert.notEqual(at, -1, 'runtime_payload 구성을 찾지 못했습니다');
  const block = sync.slice(at, sync.indexOf('}', sync.indexOf('for key in (', at)) + 1);
  return new Set([...block.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map(match => match[1]));
}

test('관제탑이 보내는 실행 payload 키는 워커 계약이 모두 허용한다', () => {
  // 허용 목록에 없는 키가 하나라도 섞이면 워커가 payload 전체를 거절한다. 그러면
  // 관제탑은 이유도 모른 채 그 작업을 붙들고, 모든 제품 실행이 조용히 멈춘다.
  const allowed = workerAllowedKeys();
  const ignored = new Set(['kind', 'version', 'name', 'payload', 'command']);
  const sent = [...towerDispatchKeys()].filter(key => !ignored.has(key));

  const unknown = sent.filter(key => !allowed.has(key));
  assert.deepEqual(unknown, [], `워커가 모르는 키를 보냅니다: ${unknown.join(', ')}`);
});

test('작업 payload 에서 옮겨 싣는 키도 워커 계약 안에 있다', () => {
  const allowed = workerAllowedKeys();
  const carried = [...towerRuntimePayloadKeys()];
  const unknown = carried.filter(key => !allowed.has(key));
  assert.deepEqual(unknown, [], `워커가 모르는 키를 옮겨 싣습니다: ${unknown.join(', ')}`);
});

test('다시 만들라는 표식은 계약에 등록돼 있다', () => {
  assert.ok(workerAllowedKeys().has('regenerateStage'));
});

function namedKeySet(text, marker) {
  const at = text.indexOf(marker);
  assert.notEqual(at, -1, `${marker} 를 찾지 못했습니다`);
  const block = text.slice(at, text.indexOf(')', text.indexOf('(', at + marker.length)) + 1);
  return new Set([...block.matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map(match => match[1]));
}

test('관제탑이 받는 투입값 키를 워커도 모두 안다', () => {
  // 최상위 키만 맞춰선 부족하다. requiredValues 안에 워커가 모르는 키가 하나 있어도
  // payload 전체가 거절되고, 모든 제품 실행이 조용히 멈춘다.
  const sync = source('control_tower/backend/factory_sync.py');
  const towerKeys = new Set([
    ...namedKeySet(sync, 'PRODUCT_REQUIRED_VALUE_KEYS = frozenset'),
    ...namedKeySet(sync, 'PRODUCT_OPTIONAL_VALUE_KEYS = frozenset'),
  ]);

  const contract = source('src/modules/batch-control-product-contract.mjs');
  const at = contract.indexOf('const PRODUCT_REQUIRED_VALUE_KEYS = Object.freeze([');
  assert.notEqual(at, -1);
  const block = contract.slice(at, contract.indexOf(']);', at));
  const workerKeys = new Set([...block.matchAll(/'([^']+)'/g)].map(match => match[1]));

  const unknown = [...towerKeys].filter(key => !workerKeys.has(key));
  assert.deepEqual(unknown, [], `워커가 모르는 투입값 키입니다: ${unknown.join(', ')}`);
});
