'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULE = pathToFileURL(path.resolve(__dirname, '../../frontend/src/production-workbench.mjs')).href;

/**
 * 실측 2026-09-04: 화면 맨 위 접힘 막대 한 줄이 "생산관제 상태 응답 정상 · 조립공장 연결 끊김 ·
 * 조립공장 session이 없습니다. · 현재 제품 선택된 제품 없음 · 대기 1 · 작업 차단 확인 필요" 였다.
 * 다섯 가지 사실을 은어로 이어붙였고, 현재 제품이 없는데도 "작업 차단 확인 필요" 라고 했다.
 * DESIGN.md 8항: 코드·API 용어를 몰라도 지금 무엇이 문제이고 무엇을 하면 되는지 읽혀야 한다.
 */
async function describe(input) {
  const { describeSyncSummary } = await import(MODULE);
  return describeSyncSummary(input);
}

test('조립공장이 꺼져 있고 대기 작업이 있으면 무엇을 하면 되는지 말한다', async () => {
  const line = await describe({ connectivity: { state: 'disconnected', detail: '조립공장 session이 없습니다.' }, queuedCount: 1, jobStatus: 'blocked' });
  assert.equal(line.text, '조립공장이 연결되어 있지 않습니다 · 조립공장 창을 열면 대기 1건이 순서대로 이어집니다');
  assert.equal(line.tone, 'error');
  assert.doesNotMatch(line.text, /session|capability|응답 정상|차단 확인/);
});

test('현재 제품이 없으면 빈 session 을 작업 차단이라고 부르지 않는다', async () => {
  const line = await describe({ connectivity: { state: 'disconnected' }, hasProduct: false, jobStatus: 'blocked', queuedCount: 0 });
  assert.doesNotMatch(line.text, /차단/);
  assert.equal(line.text, '조립공장이 연결되어 있지 않습니다 · 대기 중인 작업은 없습니다');
  assert.equal(line.tone, 'warn');
});

test('연결됐고 제품이 돌고 있으면 제품과 공정만 말한다', async () => {
  const line = await describe({ connectivity: { state: 'connected' }, hasProduct: true, productLabel: '방울수저집', jobStatus: 'running', stageLabel: '섹션', percent: 62, queuedCount: 3 });
  assert.equal(line.text, '방울수저집 · 섹션 62% · 대기 3건');
  assert.equal(line.tone, 'ok');
});

test('사람 선택을 기다리는 제품은 그렇게 말하고 주의색을 쓴다', async () => {
  const line = await describe({ connectivity: { state: 'connected' }, hasProduct: true, productLabel: '전통 수저집', jobStatus: 'waiting_manual' });
  assert.equal(line.text, '전통 수저집 · A컷 선택을 기다립니다');
  assert.equal(line.tone, 'warn');
});

test('진짜 막힌 제품만 막혔다고 말한다', async () => {
  const line = await describe({ connectivity: { state: 'connected' }, hasProduct: true, productLabel: '자수 미니 파우치', jobStatus: 'blocked', queuedCount: 2 });
  assert.equal(line.text, '자수 미니 파우치 · 막힘 · 되살리기 필요 · 대기 2건');
  assert.equal(line.tone, 'error');
});

test('생산이 끝난 제품은 Cafe24 승인이 남았는지 검증까지 끝났는지 가른다', async () => {
  const pending = await describe({ connectivity: { state: 'connected' }, hasProduct: true, productLabel: '슬라브 겹보', jobStatus: 'completed' });
  assert.equal(pending.text, '슬라브 겹보 · 생산 완료 · Cafe24 승인 필요');
  assert.equal(pending.tone, 'warn');
  const done = await describe({ connectivity: { state: 'connected' }, hasProduct: true, productLabel: '슬라브 겹보', jobStatus: 'completed', registrationVerified: true });
  assert.equal(done.text, '슬라브 겹보 · Cafe24 등록 검증 완료');
  assert.equal(done.tone, 'ok');
});

test('연결됐는데 제품이 없으면 그것만 말한다', async () => {
  const line = await describe({ connectivity: { state: 'connected' }, hasProduct: false, queuedCount: 4 });
  assert.equal(line.text, '조립공장 연결됨 · 진행 중인 제품 없음 · 대기 4건');
});

test('서버 자체가 죽으면 그것이 먼저다', async () => {
  const line = await describe({ connectivity: { state: 'backend-error', detail: '상태 조회 실패 · HTTP 502' }, backendError: 'HTTP 502', hasProduct: true, productLabel: '방울수저집', jobStatus: 'running' });
  assert.equal(line.text, '생산관제 서버가 응답하지 않습니다 · HTTP 502');
  assert.equal(line.tone, 'error');
});

test('저장 공간 차단은 모델이 준 문장을 그대로 쓴다', async () => {
  const line = await describe({ connectivity: { state: 'storage-blocked', detail: '디스크가 가득 찼습니다. 이 상태에서는 화면에서 넣은 값이 저장되지 않습니다.' } });
  assert.match(line.text, /저장되지 않습니다/);
  assert.equal(line.tone, 'error');
});
