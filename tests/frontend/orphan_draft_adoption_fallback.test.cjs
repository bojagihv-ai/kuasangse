'use strict';

// 계약: **"새 작업" 을 누르기 전에는 마지막 작업을 놓지 않는다 - 표식이 틀려도, 탭이 강제로 죽어도.**
//
// 실측 2026-09-07 (주인님: "컴이 렉걸려서 강종했다 켜졌는데 우리 작업하던게 다 날라갔네?"):
//   어젯밤 22:37 "팔각자개상자" 작업은 IndexedDB(session-assets:draft:lastwork_mtprswcm_bz39o3)에 멀쩡히 있었다.
//   강종 뒤 크롬이 탭을 다시 열며 sessionStorage(초안 번호)를 잃었고, 새 탭이 부팅하면서
//   '마지막 초안' 표식(appSettings.lastDraftWorkspaceScope)을 **자기(빈 탭) 번호로 덮어썼다.**
//   그 다음 탭은 표식을 따라 빈 초안만 이어받았다. 내용은 남아 있는데 길을 잃은 것이다.
//
// 고친 규칙 세 가지:
//   1. 표식은 **내용이 있는** 초안만 받는다 - 빈 새 탭은 표식을 덮어쓰지 못한다.
//   2. 표식이 없거나 틀리면(빈 초안·기록 없음·놓아준 초안) 내용 있는 초안 중 **가장 최근 것**을 찾아 이어받는다.
//      단, 표식이 가리키는 탭이 살아 있으면 새 탭은 새 탭이다 (후순위 탐색도 하지 않는다).
//   3. 주인님이 "새 작업" 을 누른 초안만 놓아준다(releasedScopes) - 그 초안은 다시 되살리지 않는다. 내용은 지우지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CORE_02 = read('src/app-core-02.js');
const CORE_03 = read('src/app-core-03.js');
const ADAPTER = read('src/modules/persistence/indexeddb-adapter.mjs');
const PERSISTENCE = read('src/modules/workspace-persistence.mjs');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

const plain = value => JSON.parse(JSON.stringify(value));

function contentPredicate() {
  const fn = sourceSlice(ADAPTER, 'export function draftSessionAssetsHaveContent(', '\n}\n') + '\n}';
  const context = vm.createContext({ Object, Array, String });
  vm.runInContext(`${fn.replace('export function', 'function')}\nthis.has = draftSessionAssetsHaveContent;`, context);
  return context.has;
}

test('내용 판정: 제품명·사진 지문·제품 사진·분석·조립공장 자산 중 하나면 내용이다, 빈 탭은 아니다', () => {
  const has = contentPredicate();
  assert.equal(has(null), false);
  assert.equal(has({}), false);
  assert.equal(has({ id: 'x', step: 'factory', analysis: {} }), false, '빈 분석 객체는 내용이 아니다');
  assert.equal(has({ productName: '팔각자개상자' }), true);
  assert.equal(has({ factory: { product: { productName: '팔각자개상자' } } }), true);
  assert.equal(has({ inputImageFingerprint: '4595956:/9j/' }), true);
  assert.equal(has({ imageBase64: '__stored_in_indexeddb__' }), true);
  assert.equal(has({ productImageBackup: { primary: { base64: 'x' } } }), true);
  assert.equal(has({ analysis: { features: ['a'] } }), true);
  assert.equal(has({ factory: { assets: [{ id: 'hero' }] } }), true);
});

function chooser(heartbeatAge) {
  const fn = sourceSlice(CORE_02, 'function chooseOrphanDraftForAdoption(', '\n}\n') + '\n}';
  const context = vm.createContext({ Array, String, Number, Set, DRAFT_ORPHAN_AFTER_MS: 60000, readDraftHeartbeatAge: heartbeatAge });
  vm.runInContext(`${fn}\nthis.choose = chooseOrphanDraftForAdoption;`, context);
  return context.choose;
}

test('후순위 탐색: 내용 있는 초안 중 가장 최근 것 - 자기 자신·놓아준 것·살아 있는 탭은 제외', () => {
  const alive = new Set(['draft:lastwork_alive']);
  const choose = chooser(scope => (alive.has(scope) ? 5000 : Infinity));
  const candidates = [
    { scopeId: 'draft:lastwork_old', savedAt: 100, hasContent: true },
    { scopeId: 'draft:lastwork_new', savedAt: 300, hasContent: true },
    { scopeId: 'draft:lastwork_newest_empty', savedAt: 400, hasContent: false },
    { scopeId: 'draft:lastwork_alive', savedAt: 500, hasContent: true },
    { scopeId: 'draft:lastwork_released', savedAt: 600, hasContent: true },
    { scopeId: 'draft:lastwork_me', savedAt: 700, hasContent: true },
    { scopeId: 'project:project_x', savedAt: 800, hasContent: true },
  ];
  const chosen = choose(candidates, { branchScope: 'draft:lastwork_me', releasedScopes: ['draft:lastwork_released'] });
  assert.equal(chosen && chosen.scopeId, 'draft:lastwork_new');
  assert.equal(choose([], {}), null);
  assert.equal(choose(candidates.filter(c => c.hasContent === false), {}), null, '빈 초안만 있으면 이어받을 것이 없다');
  // 실측 사고 그대로: 표식이 빈 탭을 가리켜 후보에서 빠져도, 어젯밤 작업(가장 최근 내용)이 뽑힌다
  const crash = [
    { scopeId: 'draft:lastwork_mtplrtwc_220ncp', savedAt: 1788687038000, hasContent: true, productName: 'QA-테스트-파우치' },
    { scopeId: 'draft:lastwork_mtprswcm_bz39o3', savedAt: 1788701838000, hasContent: true, productName: '팔각자개상자' },
    { scopeId: 'draft:lastwork_mtqhsr7r_2tg99x', savedAt: 1788740313000, hasContent: false },
  ];
  assert.equal(plain(choose(crash, { branchScope: 'draft:lastwork_mtqhshr1_0f39ba', releasedScopes: [] })).productName, '팔각자개상자');
});

test('저장 계층: 초안 목록은 draft: 만, 본문 없이 (scopeId·savedAt·productName·hasContent)', () => {
  const list = sourceSlice(ADAPTER, 'async listDraftSessionAssetsForRecovery() {', '\n    },\n');
  assert.match(list, /recordDriver\.getAll\('sessionAssets'\)/);
  assert.match(list, /scopeId\.startsWith\('draft:'\)/, '작업파일(project:)은 목록에 넣지 않는다 - 권한 검사를 우회하게 된다');
  assert.match(list, /hasContent: draftSessionAssetsHaveContent\(record\)/);
  assert.doesNotMatch(list, /record\.factory\.assets\b(?!\.length)/, '본문(자산 배열)을 통째로 돌려주지 않는다');
  assert.match(PERSISTENCE, /listDraftSessionAssetsForRecovery\(\) \{\s*return adapters\.indexeddb\.listDraftSessionAssetsForRecovery\(\);/);
  assert.match(PERSISTENCE, /draftSessionAssetsHaveContent\(record\) \{\s*return adapters\.indexeddb\.draftSessionAssetsHaveContent\(record\);/);
});

test('규칙 1: 빈 새 탭은 표식을 덮어쓰지 않는다 - 부팅은 내용이 있을 때만, 저장은 내용이 생길 때 적는다', () => {
  const hydrate = sourceSlice(CORE_02, 'async function hydratePersistentSessionAssets(', 'if (assets?.productImageBackup');
  assert.match(hydrate, /if \(assets && workspacePersistenceApi\(\)\.draftSessionAssetsHaveContent\(assets\)\) \{\s*void rememberLastDraftWorkspaceScope\(hydrateScopeId\);/);
  assert.doesNotMatch(hydrate, /startDraftHeartbeat\(hydrateScopeId\);\s*void rememberLastDraftWorkspaceScope/, '심장박동 직후 무조건 표식을 적던 옛 줄이 남아 있습니다');
  const save = sourceSlice(CORE_02, 'async function saveSessionAssetsToDbOnce(', '\nasync function ');
  assert.match(save, /await workspacePutSessionAssets\(payload\);[\s\S]{0,400}draftSessionAssetsHaveContent\(payload\)\)\s*\{\s*void rememberLastDraftWorkspaceScope\(savedScope\);/);
  const remember = sourceSlice(CORE_02, 'async function rememberLastDraftWorkspaceScope(', '\n}\n');
  assert.match(remember, /if \(scope === lastRememberedDraftScope\) return true;/, '저장할 때마다 다시 적지 않는다');
  assert.match(remember, /releasedScopes: releasedDraftScopesOf\(previous\)\.filter\(item => item !== scope\)/, '놓아준 목록을 잃지 않는다');
});

test('규칙 2: 표식이 틀리면 내용 있는 초안을 찾아 이어받는다 - 단 표식의 탭이 살아 있으면 새 탭은 새 탭이다', () => {
  const adopt = sourceSlice(CORE_02, 'async function adoptPreviousDraftSessionAssets(', '\nasync function migrateDocumentSessionAssetsToCurrentBranch(');
  const aliveGuard = adopt.indexOf("if (readDraftHeartbeatAge(pointerScope) < DRAFT_ORPHAN_AFTER_MS) return null;");
  const fallback = adopt.indexOf('listDraftSessionAssetsForRecovery()');
  assert.ok(aliveGuard >= 0 && fallback > aliveGuard, '살아 있는 탭 검사가 후순위 탐색보다 먼저여야 합니다');
  assert.match(adopt, /chooseOrphanDraftForAdoption\(candidates, \{ branchScope, releasedScopes \}\)/);
  assert.match(adopt, /!releasedScopes\.includes\(pointerScope\)/, '놓아준 초안을 가리키는 표식은 무시한다');
  assert.match(adopt, /draftSessionAssetsHaveContent\(candidate\)/, '표식이 빈 초안을 가리키면 후순위 탐색으로 간다');
  // 기존 안전장치는 그대로: 심장박동 · 명시적 이어받기 · 신원 검증 뒤 저장
  assert.match(adopt, /const beatAge = readDraftHeartbeatAge\(previousScope\);/);
  assert.match(adopt, /adoptOrphanDraft: true/);
  const validateAt = adopt.indexOf('validateSnapshotIdentity(adopted)');
  const saveAt = adopt.indexOf('saveSessionAssets(branchScope, adopted)');
  assert.ok(validateAt >= 0 && saveAt > validateAt);
});

test('규칙 3: "새 작업" 을 누른 초안만 놓아준다 - 내용은 지우지 않는다', () => {
  const reset = sourceSlice(CORE_03, 'async function resetActiveWorkspaceDocumentCore() {', '\nasync function ');
  assert.match(reset, /const releasedDraftScope = getCurrentLastWorkWorkspaceScope\(\);/);
  assert.match(reset, /void releaseDraftWorkspaceScope\(releasedDraftScope\);/);
  const rotateAt = reset.indexOf('rotateLastWorkDraftScope()');
  const capturedAt = reset.indexOf('const releasedDraftScope');
  assert.ok(capturedAt >= 0 && capturedAt < rotateAt, '번호를 바꾸기 전에 옛 번호를 잡아야 놓아줄 수 있다');
  const release = sourceSlice(CORE_02, 'async function releaseDraftWorkspaceScope(', '\n}\n');
  assert.match(release, /\.slice\(0, RELEASED_DRAFT_SCOPES_MAX\)/);
  assert.doesNotMatch(release, /removeSessionAssets|deleteSessionAssets|clearPersistentSession/, '놓아주기는 지우기가 아니다');
  // 다른 곳에서 초안 번호를 바꾸는 흐름(작업파일 열기 등)은 놓아주지 않는다 - 주인님 규칙은 "새 작업" 이다
  assert.equal((CORE_03.match(/void releaseDraftWorkspaceScope\(/g) || []).length, 1);
});
