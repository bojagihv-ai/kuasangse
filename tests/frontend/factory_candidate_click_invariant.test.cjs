'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = path.join(ROOT, 'src', 'app-core-03.js');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');
const CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const CAFE24_SYNC = path.join(ROOT, 'src', 'cafe24-sync.js');
const DB_TAB = path.join(ROOT, 'src', 'menus', 'factory', 'tabs', 'db-tab.mjs');
const APP_HTML = path.join(ROOT, 'app.html');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

function clickNode(dataset) {
  return {
    dataset,
    disabled: false,
    closest(selector) {
      return /data-factory-(?:apply|confirm-no|clear)-(?:db|cafe24)-candidate/.test(selector) ? this : null;
    },
  };
}

function delegatedRoot() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    contains() { return true; },
    querySelector() { return { value: '' }; },
  };
}

test('candidate review controls have exactly one owner: the active factory DB tab', () => {
  const classic = source(CORE_06);
  const dbTab = source(DB_TAB);

  assert.doesNotMatch(classic, /function handleFactoryCandidateReviewClick\s*\(/);
  assert.doesNotMatch(classic, /function bindFactoryCandidateReviewDelegation\s*\(/);
  assert.doesNotMatch(classic, /querySelectorAll\('\[data-factory-apply-(?:db|cafe24)-candidate\]'\)[\s\S]{0,180}?\.onclick\s*=/);
  assert.doesNotMatch(classic, /querySelectorAll\('\[data-factory-confirm-no-(?:db|cafe24)-candidate\]'\)[\s\S]{0,180}?\.onclick\s*=/);

  assert.match(dbTab, /root\.addEventListener\('click', click\)/);
  assert.match(dbTab, /\[data-factory-apply-db-candidate\]/);
  assert.match(dbTab, /\[data-factory-apply-cafe24-candidate\]/);
  assert.match(dbTab, /\[data-factory-confirm-no-db-candidate\]/);
  assert.match(dbTab, /\[data-factory-confirm-no-cafe24-candidate\]/);
  assert.match(dbTab, /\[data-factory-clear-db-candidate\]/);
  assert.match(dbTab, /\[data-factory-clear-cafe24-candidate\]/);
});

test('candidate selection, no-candidate, and clear clicks each invoke exactly one command', async () => {
  const moduleUrl = pathToFileURL(DB_TAB);
  moduleUrl.searchParams.set('candidate-click-invariant', `${Date.now()}-${Math.random()}`);
  const { createDbFactoryTab } = await import(moduleUrl.href);
  const calls = [];
  const errors = [];
  const snapshot = Object.freeze({
    factory: Object.freeze({ automation: Object.freeze({ activeTab: 'db' }), product: Object.freeze({}) }),
  });
  const tab = createDbFactoryTab({
    getSnapshot: () => snapshot,
    assertMutable() {},
    getOperationToken: () => 'workspace-a:1',
    isOperationCurrent: token => token === 'workspace-a:1',
    reportError: error => errors.push(error),
    actions: {
      applyDbCandidate(value) { calls.push(['db', value]); return Promise.resolve(true); },
      applyCafe24Candidate(value) { calls.push(['cafe24', value]); return Promise.resolve(true); },
      confirmNoDbCandidate() { calls.push(['db-none']); return Promise.resolve(true); },
      confirmNoCafe24Candidate() { calls.push(['cafe24-none']); return Promise.resolve(true); },
      clearDbCandidateSelection() { calls.push(['db-clear']); return Promise.resolve(true); },
      clearCafe24CandidateSelection() { calls.push(['cafe24-clear']); return Promise.resolve(true); },
    },
    renderHelpers: {},
  });
  const root = delegatedRoot();
  const dispose = tab.bind(root);
  const listener = root.listeners.get('click');
  assert.equal(typeof listener, 'function');

  listener({ target: clickNode({ factoryApplyDbCandidate: '2' }), preventDefault() {}, stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['db', { index: 2 }]]);

  listener({ target: clickNode({ factoryApplyCafe24Candidate: '1' }), preventDefault() {}, stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['db', { index: 2 }], ['cafe24', { index: 1 }]]);

  listener({ target: clickNode({ factoryConfirmNoDbCandidate: '' }), preventDefault() {}, stopPropagation() {} });
  listener({ target: clickNode({ factoryConfirmNoCafe24Candidate: '' }), preventDefault() {}, stopPropagation() {} });
  listener({ target: clickNode({ factoryClearDbCandidate: '' }), preventDefault() {}, stopPropagation() {} });
  listener({ target: clickNode({ factoryClearCafe24Candidate: '' }), preventDefault() {}, stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [
    ['db', { index: 2 }], ['cafe24', { index: 1 }],
    ['db-none'], ['cafe24-none'], ['db-clear'], ['cafe24-clear'],
  ]);
  assert.deepEqual(errors, []);
  dispose();
  assert.equal(root.listeners.size, 0);
});

test('candidate resolution actions immediately rerender and persist the current DB tab', () => {
  const text = source(CORE_03);
  const actions = sourceSlice(
    text,
    'function factoryRuntimeDbActions()',
    '\nfunction factoryRuntimeDbHelpers()',
  );
  const actionNames = [
    'confirmNoDbCandidate',
    'confirmNoCafe24Candidate',
    'clearDbCandidateSelection',
    'clearCafe24CandidateSelection',
    'runFactoryGuideAction',
  ];
  for (let index = 0; index < actionNames.length - 1; index += 1) {
    const action = actionNames[index];
    const start = actions.indexOf(`${action}(`);
    assert.notEqual(start, -1, `missing DB runtime action: ${action}`);
    const next = actions.indexOf(`${actionNames[index + 1]}(`, start + action.length + 1);
    assert.notEqual(next, -1, `missing next DB runtime action after: ${action}`);
    const body = actions.slice(start, next);
    assert.match(body, /render:\s*true/, `${action} must rerender immediately`);
    assert.match(body, /patchTab:\s*['"]db['"]/, `${action} must patch the DB tab`);
    assert.match(body, /forceSave:\s*true/, `${action} must persist the resolution`);
  }
});

test('selected DB and Cafe24 candidate cards expose explicit clear controls', () => {
  const text = source(CORE_05);
  const renderer = sourceSlice(
    text,
    'function renderFactoryCandidateCards(',
    '\nfunction renderFactorySinhwaDbProgramPrompt(',
  );
  assert.match(renderer, /data-factory-clear-db-candidate/);
  assert.match(renderer, /data-factory-clear-cafe24-candidate/);
  assert.match(renderer, />선택 해제</);
});

test('candidate renderer never presents a button that the apply predicate will reject', () => {
  const text = source(CORE_05);
  const renderer = sourceSlice(
    text,
    'function renderFactoryCandidateReviewPanels(',
    '\nfunction renderFactoryCandidateSizeGenerationWait(',
  );
  const context = vm.createContext({
    escapeHtml: value => String(value ?? ''),
    factoryCandidateReviewCanApply: candidate => candidate.scope === 'current',
    renderFactoryCandidateCollectionStatus: (_factory, type, count) => `<status data-type="${type}" data-count="${count}"></status>`,
    renderFactorySinhwaDbProgramPrompt: () => '',
    renderFactoryCafe24ProgramPrompt: () => '',
    renderFactoryCandidateCards: candidates => candidates.map(candidate => `<button>${candidate.name}</button>`).join(''),
    renderFactoryCandidateSizeGenerationWait: () => '',
  });
  vm.runInContext(`${renderer}\nthis.renderCandidates = renderFactoryCandidateReviewPanels;`, context);
  const html = context.renderCandidates({
    product: {
      pendingDbCandidates: [
        { name: '현재 DB 후보', scope: 'current' },
        { name: '이전 DB 후보', scope: 'stale' },
      ],
      pendingCafe24Candidates: [
        { name: '현재 Cafe24 후보', scope: 'current' },
        { name: '이전 Cafe24 후보', scope: 'stale' },
      ],
    },
  });

  assert.match(html, /현재 DB 후보/);
  assert.match(html, /현재 Cafe24 후보/);
  assert.doesNotMatch(html, /이전 DB 후보/);
  assert.doesNotMatch(html, /이전 Cafe24 후보/);
  assert.match(html, /현재 작업과 다른 후보 2건/);
  assert.match(html, /data-factory-guide-action="rerun-db-query"/);
});

test('candidate request lookup keeps the same product-scope rule after run metadata advances', () => {
  const text = source(CAFE24_SYNC);
  const matcher = sourceSlice(
    text,
    'function factoryCandidateReviewRequestMatches(',
    '\nfunction factoryFindCandidateReviewByRequestIdentity(',
  );

  assert.match(matcher, /let scopeMatched = false/);
  assert.match(matcher, /scopeMatched = !candidateScopeKey \|\| candidateScopeKey === identity\.scopeKey/);
  assert.match(matcher, /if \(!scopeMatched && identity\.identityKey/);
  assert.doesNotMatch(matcher, /if \(identity\.identityKey && typeof factoryCandidateReviewIdentityKey/);
});

test('candidate review cards stay within a narrow DB panel without horizontal scrolling', () => {
  const html = source(APP_HTML);

  // 가로는 계속 클립한다(좁은 패널에서 카드가 삐져나가지 않게).
  // 세로는 visible 이어야 한다 — auto 로 두면 후보를 고를 때마다 안쪽 스크롤이
  // 맨 위로 되돌아간다(2026-08-29 실측 1061 -> 0, PERF-04).
  assert.match(html, /\.factory-candidate-list\{[^}]*overflow-x:clip;overflow-y:visible/);
  assert.match(html, /\.factory-candidate-card-top\{[^}]*grid-template-columns:24px 64px minmax\(0,1fr\)/);
  assert.match(html, /\.factory-candidate-actions\{[^}]*min-width:0/);
  assert.match(html, /\.factory-candidate-actions \.btn-sm\{[^}]*flex:1 1 120px/);
  assert.match(html, /\[data-factory-cafe24-oauth\]\{[^}]*word-break:keep-all/);
  assert.match(html, /@media\(max-width:900px\)\{[\s\S]{0,2400}?\.factory-candidate-review\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html, /@media\(max-width:480px\)\{[\s\S]{0,1200}?\.factory-candidate-card-top\{[^}]*grid-template-columns:48px minmax\(0,1fr\)/);
  assert.match(html, /@media\(max-width:480px\)\{[\s\S]{0,1400}?\.factory-candidate-text\{[^}]*grid-row:1\s*\/\s*span 2/);
  assert.match(html, /@media\(max-height:640px\)\{[\s\S]{0,1000}?\.main\{padding-bottom:152px\}/);
  assert.match(html, /@media\(max-height:640px\)\{[\s\S]{0,1000}?\.work-identity-float\{[^}]*top:calc\(var\(--token-bar-height\) \+ var\(--space-2\)\)[^}]*bottom:auto/);
  assert.match(html, /@media\(max-height:640px\)\{[\s\S]{0,1000}?\.work-identity-float\{[^}]*left:var\(--space-2\);right:auto/);
  assert.match(html, /--work-identity-short-width:190px/);
  assert.match(html, /\.work-identity-copy\{[^}]*gap:var\(--work-identity-copy-gap\)/);
});

test('identity dock exposes full workfile and product names to assistive technology', () => {
  const classic = source(CORE_06);

  assert.match(classic, /aria-label="작업파일 \$\{escAttr\(workfileName\)\}"/);
  assert.match(classic, /aria-label="제품명 \$\{escAttr\(initialProductName\)\}"/);
});
