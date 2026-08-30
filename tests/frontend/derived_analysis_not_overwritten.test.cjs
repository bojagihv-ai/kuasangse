'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable: ${startMarker}`);
  return source.slice(start, end);
}

/**
 * 파생 분석 결과는 "지금 화면 사본에 없다" 는 이유만으로 지워지면 안 된다.
 * buildWorkspacePayload 의 펼치기는 뒤 원본이 앞을 통째로 덮으므로, state.compPage 가
 * 비어 있으면 저장된 값이 null 로 덮여 서버가 마지막 저장을 통째로 거절했다.
 * 실측 2026-08-31: 100% 까지 끝난 작업이 여기서 18회 연속 거절됐다.
 */
function buildWith({ stored, live, factory }) {
  const core02 = read('src/app-core-02.js');
  const core03 = read('src/app-core-03.js');
  const mergeSource = sourceBetween(
    core02,
    'function mergeSameWorkDerivedValue(',
    'function recoverStaleSessionInlineImages(',
  );
  const payloadSource = sourceBetween(
    core03,
    'function buildWorkspacePayload(',
    'function restoreProjectFileFactoryAssetsFromPayload(',
  );
  const context = vm.createContext({
    state: {
      currentProjectId: 'p',
      currentProjectName: 'n',
      currentProjectCreatedAt: 1,
      compPage: live,
    },
    workspacePersistenceApi: () => ({ normalizeWorkspaceScope: value => value }),
    getCurrentLastWorkWorkspaceScope: () => 'project:p',
    factoryRuntimeReadCommittedFactory: () => ({ competitors: { compPage: factory || {} } }),
    cloneData: value => structuredClone(value),
    factoryStampWorkspaceIdentity() {},
    factoryEnsureCurrentDetailHtmlAsset() {},
    currentWorkspaceInputImageFingerprint: () => '',
    ensureActiveWorkIdentity: () => ({ workspaceId: 'project:p' }),
    deriveProjectName: () => 'n',
    sectionWorkScopeMeta: () => ({}),
    normalizeAnalysisMatchSettings: () => ({}),
    normalizeProductInfoFieldSettings: () => ({}),
    loadFixedDetailImages: () => ({}),
    currentWorkspaceRevision: () => null,
    currentWorkspaceBranch: () => null,
    currentSessionAssetsPayload: () => ({}),
    buildLightweightSessionPayload: value => value,
    productImageBackupReferencePayload: () => ({}),
    Date: { now: () => 100 },
  });
  vm.runInContext(`${mergeSource}
${payloadSource}
globalThis.build = buildWorkspacePayload;`, context);
  return context.build({ scopeId: 'project:p', storedCompPage: stored }).compPage;
}

const ANALYSIS = { page_title: '전통 수저집', sections_found: ['a', 'b'] };

test('화면 사본이 비어 있어도 저장된 분석 결과를 덮어쓰지 않는다', () => {
  const compPage = buildWith({
    stored: { analysisResult: ANALYSIS, analysisInvalidatedAt: 0 },
    live: { analysisResult: null, analysisInvalidatedAt: 0 },
  });
  assert.deepEqual(compPage.analysisResult, ANALYSIS);
});

test('섹션 계획과 편집본도 같은 보호를 받는다', () => {
  const compPage = buildWith({
    stored: { sectionPlan: { sections: ['s1'] }, planEdits: { s1: '고침' }, analysisInvalidatedAt: 0 },
    live: { sectionPlan: null, planEdits: null, analysisInvalidatedAt: 0 },
  });
  assert.deepEqual(compPage.sectionPlan, { sections: ['s1'] });
  assert.deepEqual(compPage.planEdits, { s1: '고침' });
});

test('일부러 분리했다는 표시가 더 새로우면 비우는 것을 허용한다', () => {
  const compPage = buildWith({
    stored: { analysisResult: ANALYSIS, analysisInvalidatedAt: 100 },
    live: { analysisResult: null, analysisInvalidatedAt: 200 },
  });
  assert.equal(compPage.analysisResult, null);
});

test('화면 사본에 새 분석이 있으면 그것이 이긴다', () => {
  const fresh = { page_title: '새 분석' };
  const compPage = buildWith({
    stored: { analysisResult: ANALYSIS, analysisInvalidatedAt: 0 },
    live: { analysisResult: fresh, analysisInvalidatedAt: 0 },
  });
  assert.equal(compPage.analysisResult.page_title, '새 분석');
});

test('조립공장 사본이 비어도 저장된 값이 살아남는다', () => {
  const compPage = buildWith({
    stored: { analysisResult: ANALYSIS, analysisInvalidatedAt: 0 },
    factory: { analysisResult: null },
    live: { analysisResult: null, analysisInvalidatedAt: 0 },
  });
  assert.deepEqual(compPage.analysisResult, ANALYSIS);
});
