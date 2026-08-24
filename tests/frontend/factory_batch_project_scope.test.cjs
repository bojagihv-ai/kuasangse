'use strict';

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

function loadAdopter(currentProjectId) {
  const core = source('src/app-core-03.js');
  const helpers = sourceSlice(
    core,
    'function factoryRuntimeControlCheckpointProjectId',
    'function factoryRuntimeControlValidateProductCheckpoint',
  );
  const context = { state: { currentProjectId } };
  vm.createContext(context);
  vm.runInContext(`${helpers}
contextAdopt = factoryRuntimeControlAdoptProductProject;`, context);
  return context;
}

test('배치 저장은 작업파일 컨텍스트가 비어도 이 작업의 문서 scope 를 요구한다', () => {
  const context = loadAdopter('');
  const scope = context.contextAdopt('factory-job-abc');
  assert.equal(scope, 'batch:factory-job-abc');
  assert.equal(context.state.currentProjectId, 'batch:factory-job-abc');
});

test('앞 작업의 프로젝트가 남아 있으면 이 작업의 것으로 교체한다', () => {
  // 병렬 보드에서 다른 작업을 거친 뒤 돌아오면 남의 문서 scope 로 권한을 요구해 저장이 막힌다.
  const context = loadAdopter('batch:factory-job-previous');
  const scope = context.contextAdopt('factory-job-current');
  assert.equal(scope, 'batch:factory-job-current');
  assert.equal(context.state.currentProjectId, 'batch:factory-job-current');
});

test('draft scope 에 머물러 있어도 이 작업의 문서 scope 로 되돌린다', () => {
  const context = loadAdopter('draft:lastwork_mt4ansp0_z09ogy');
  assert.equal(context.contextAdopt('factory-job-current'), 'batch:factory-job-current');
});

test('이미 이 작업의 프로젝트면 그대로 둔다', () => {
  const context = loadAdopter('batch:factory-job-same');
  assert.equal(context.contextAdopt('factory-job-same'), 'batch:factory-job-same');
  assert.equal(context.state.currentProjectId, 'batch:factory-job-same');
});

test('jobId 가 없으면 현재 프로젝트를 건드리지 않는다', () => {
  const context = loadAdopter('batch:factory-job-keep');
  assert.equal(context.contextAdopt(''), 'batch:factory-job-keep');
  assert.equal(context.state.currentProjectId, 'batch:factory-job-keep');
});

test('배치 체크포인트 저장은 항상 확정 헬퍼로 문서 scope 를 계산한다', () => {
  const core = source('src/app-core-03.js');
  const save = sourceSlice(
    core,
    'async function factoryRuntimeControlSaveProductCheckpoint',
    'async function factoryRuntimeControlRestoreProductCheckpoint',
  );
  assert.match(save, /factoryRuntimeControlAdoptProductProject\(payload\.jobId\)/);
  // 비어 있을 때만 채우는 조건부로 되돌아가면 남은 프로젝트 때문에 저장이 다시 막힌다.
  assert.doesNotMatch(save, /!String\(state\.currentProjectId/);
});
