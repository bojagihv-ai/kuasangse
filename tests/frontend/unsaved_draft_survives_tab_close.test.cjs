'use strict';

// 계약: **저장을 한 번도 안 누른 작업도 탭이 죽으면 잃지 않는다.**
//
// 주인님 규칙: "새 작업 누르기 전에는 아무것도 안 날아가야 한다."
//
// 2026-08-30 실측으로 잡은 사고:
//   조립공장에 제품명을 넣고 탭을 닫은 뒤 새 탭으로 열면 그냥 사라졌다.
//   원인은 저장 실패가 아니었다 — **저장은 잘 되고 있었다.**
//   초안 범위(draft:lastwork_...)가 탭마다 새로 만들어지고 탭 저장소에만 적히기 때문에,
//   새 탭은 앞 탭이 저장한 내용을 영영 못 찾는 것이었다.
//   그렇게 주인을 잃은 초안이 IndexedDB 에 **1,369개** 쌓여 있었다. 잃어버린 작업 1,369개다.
//
// 고친 방법 (번호 규칙은 건드리지 않는다 — 탭 여러 개를 동시에 써도 안 섞이는 설계다):
//   1. 마지막으로 쓴 초안 번호를 오래 남는 곳(appSettings)에 적어 둔다.
//   2. 살아 있는 탭은 자기 초안 번호에 **심장박동**을 찍는다.
//   3. 새 탭이 빈손이면, 심장박동이 끊긴(=주인을 잃은) 초안만 이어받는다.
//      살아 있는 탭의 초안은 건드리지 않는다 — 그러면 내용이 갈린다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_02 = fs.readFileSync(path.join(ROOT, 'src/app-core-02.js'), 'utf8');
const PERSISTENCE = fs.readFileSync(path.join(ROOT, 'src/modules/workspace-persistence.mjs'), 'utf8');
const ADAPTER = fs.readFileSync(path.join(ROOT, 'src/modules/persistence/indexeddb-adapter.mjs'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('주인 잃은 초안을 읽을 수 있는 통로가 있다', () => {
  // 저장 계층이 막고 있으면 이어받기 자체가 불가능하다.
  assert.match(ADAPTER, /async getDraftSessionAssetsForRecovery\(draftScopeId\) \{/);
  assert.match(ADAPTER, /if \(!scopeId\.startsWith\('draft:'\)\) return null;/,
    '초안 전용이어야 합니다. 작업파일까지 열면 권한 검사를 우회하게 됩니다.');
  assert.match(PERSISTENCE, /loadDraftSessionAssetsForRecovery\(scopeId\)/);
});

test('마지막 초안 번호를 오래 남는 곳에 적는다', () => {
  assert.match(CORE_02, /const LAST_DRAFT_SCOPE_PREFERENCE_ID = 'lastDraftWorkspaceScope';/);
  assert.match(CORE_02, /async function rememberLastDraftWorkspaceScope\(scopeId\)/);
  // appSettings 는 탭이 아니라 브라우저에 남는다. 여기가 아니면 다음 탭이 못 찾는다.
  assert.match(CORE_02, /savePreference\(\{[\s\S]{0,120}id: LAST_DRAFT_SCOPE_PREFERENCE_ID/);
});

test('살아 있는 탭은 심장박동을 찍는다', () => {
  assert.match(CORE_02, /const DRAFT_HEARTBEAT_KEY_PREFIX = 'kuasangse_draft_beat_v1:';/);
  assert.match(CORE_02, /function writeDraftHeartbeat\(scopeId\)/);
  assert.match(CORE_02, /function startDraftHeartbeat\(scopeId\)/);
  // 탭 사이에서 보여야 하므로 localStorage 다. sessionStorage 면 아무 소용이 없다.
  assert.match(CORE_02, /localStorage\.setItem\(`\$\{DRAFT_HEARTBEAT_KEY_PREFIX\}\$\{scope\}`/);
});

test('떠날 때 자기 심장박동을 지운다', () => {
  // 안 지우면 다음 탭이 최대 60초를 '아직 살아 있나 보다' 하고 기다린다.
  const leave = sourceSlice(CORE_02, 'function flushLastWorkBeforeLeave() {', 'lastWorkPageLeaveFlushInProgress = false');
  assert.match(leave, /clearDraftHeartbeat\(getCurrentLastWorkWorkspaceScope\(\)\)/);
});

test('살아 있는 탭의 초안은 이어받지 않는다', () => {
  // 이 가드가 없으면 탭 두 개를 열었을 때 서로의 내용을 가져가 갈라진다.
  const adopt = sourceSlice(CORE_02, 'async function adoptPreviousDraftSessionAssets(', '\nasync function migrateDocumentSessionAssetsToCurrentBranch(');
  assert.match(adopt, /const beatAge = readDraftHeartbeatAge\(previousScope\);/);
  assert.match(adopt, /if \(beatAge < DRAFT_ORPHAN_AFTER_MS\) return null;/);
});

test('이어받기는 명시적으로만 허용된다', () => {
  // bindWorkspaceSnapshotToCurrentBranch 의 '남의 초안 금지' 규칙은 그대로 살아 있어야 한다.
  // 예외는 호출자가 스스로 밝힐 때만.
  const bind = sourceSlice(CORE_02, 'function bindWorkspaceSnapshotToCurrentBranch(', '\nfunction resolveRestoredCandidateReviewWorkspaceId(');
  assert.match(bind, /existingScope\.startsWith\('draft:'\) && existingScope !== branchScope/,
    '남의 초안을 막는 규칙이 사라졌습니다.');
  assert.match(bind, /options\.adoptOrphanDraft !== true/);
  const adopt = sourceSlice(CORE_02, 'async function adoptPreviousDraftSessionAssets(', '\nasync function migrateDocumentSessionAssetsToCurrentBranch(');
  assert.match(adopt, /adoptOrphanDraft: true/);
});

test('이어받은 것도 신원 검증을 통과해야 쓴다', () => {
  // 작업파일 이어받기와 같은 절차다. 읽고 → 현재 가지에 묶고 → 검증하고 → 저장.
  const adopt = sourceSlice(CORE_02, 'async function adoptPreviousDraftSessionAssets(', '\nasync function migrateDocumentSessionAssetsToCurrentBranch(');
  assert.match(adopt, /validateSnapshotIdentity\(adopted\)/);
  const validateAt = adopt.indexOf('validateSnapshotIdentity(adopted)');
  const saveAt = adopt.indexOf('saveSessionAssets(branchScope, adopted)');
  assert.ok(validateAt >= 0 && saveAt > validateAt, '검증보다 저장이 먼저면 남의 내용을 그대로 씁니다.');
});

test('빈손일 때만 이어받는다', () => {
  // 이 탭에 이미 내용이 있으면 건드리지 않는다.
  const hydrate = sourceSlice(CORE_02, 'async function hydratePersistentSessionAssets(', 'if (assets?.productImageBackup');
  const adoptAt = hydrate.indexOf('adoptPreviousDraftSessionAssets(hydrateScopeId');
  assert.ok(adoptAt >= 0, '이어받기가 부팅 경로에 연결돼 있지 않습니다.');
  const guard = hydrate.lastIndexOf('if (!assets) {', adoptAt);
  assert.ok(guard >= 0 && guard < adoptAt, '내용이 있어도 이어받으면 지금 작업을 덮습니다.');
});
