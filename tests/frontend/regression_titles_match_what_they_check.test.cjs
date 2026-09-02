'use strict';

// 계약: **회귀 목록의 제목이 약속한 것을 그 검사가 실제로 한다.**
//
// 주인님 2026-09-02: "이미지 생성한거나 필수값고른거나 vm선택한것 등등 날라가거나했던것
//                    그것도 항상 주의해야돼"
//
// 사장님은 회귀 목록을 보고 "새로고침 유지" 라고 적힌 검사가 초록이면 안심하신다.
// 그런데 이름만 그렇고 실제로는 새로고침을 한 번도 안 하는 검사가 있었다:
//   FULL-01 'verify_factory_field_confirmation_persistence_cdp_v143.cjs'
//     제목: "필수값 확인 상태 새로고침 유지"
//     실제: Page.reload 0회 · Page.navigate 1회(최초 로드뿐) — 메모리 정합성만 본다.
// 같은 무늬로 DB-02 도 "확정 선택 새로고침 유지" 인데 이미 저장된 작업에 값을 손으로 찔러
// 넣고 명시 저장한 뒤 새로고침했다(2026-08-31 사고 — 초록불인데 실제로는 잃었다).
//
// 그래서 사람이 아니라 기계가 본다. 제목에 '새로고침/F5/복원' 이 들어 있으면
// 그 검사 파일(또는 그 파일이 require 하는 도우미)에 실제 재적재가 있어야 한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'tools/regression_manifest.cjs'), 'utf8');

// nodeFile('ID', '영역', '제목', '파일'[, 'tier'])
function manifestEntries() {
  const entries = [];
  const re = /nodeFile\(\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3\s*,\s*'([^']+)'/g;
  let match;
  while ((match = re.exec(MANIFEST))) {
    entries.push({ id: match[1], area: match[2], title: match[4], file: match[5] });
  }
  return entries;
}

// 검사 파일과 그 파일이 require 하는 같은 폴더의 도우미까지 합쳐서 본다.
// (DB-02 는 factory_candidate_confirmation_harness_utils.cjs 안에서 새로고침한다)
function sourceWithLocalRequires(relFile, depth = 0) {
  const full = path.join(ROOT, relFile);
  if (!fs.existsSync(full)) return '';
  let text = fs.readFileSync(full, 'utf8');
  if (depth >= 2) return text;
  const dir = path.dirname(relFile);
  for (const match of text.matchAll(/require\('\.\/([^']+)'\)/g)) {
    const child = path.posix.join(dir.replace(/\\/g, '/'), match[1]);
    text += `\n${sourceWithLocalRequires(child, depth + 1)}`;
  }
  return text;
}

// 주석 안의 글자는 세면 안 된다. 이 검사를 처음 쓸 때 그걸 안 걸러서,
// FULL-01 의 새로고침을 일부러 빼고 돌렸는데도 통과했다 — 주석에 'Page.reload' 라고
// 적어 둔 설명이 세어졌기 때문이다(2026-09-02, 파괴 실험으로 발견).
function stripComments(text) {
  return String(text ?? '')
    .replace(/\/\*[^]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function reloadCount(rawText) {
  const text = stripComments(rawText);
  const reloads = (text.match(/Page\.reload/g) || []).length;
  const navigates = (text.match(/Page\.navigate/g) || []).length;
  // 최초 로드 한 번은 새로고침이 아니다. 두 번째 navigate 부터가 재적재다.
  // (캐시를 끈 상태의 재-navigate 는 Ctrl+F5 와 같다)
  return reloads + Math.max(0, navigates - 1);
}

const RELOAD_PROMISE = /새로고침|Ctrl\+F5|F5|재적재/;

test('제목이 새로고침을 약속하면 실제로 재적재한다', () => {
  const offenders = [];
  for (const entry of manifestEntries()) {
    if (!RELOAD_PROMISE.test(entry.title)) continue;
    if (!entry.file.startsWith('tools/')) continue; // 소스 계약 검사는 브라우저를 안 띄운다
    const text = sourceWithLocalRequires(entry.file);
    if (!text) continue;
    if (reloadCount(text) < 1) offenders.push(`${entry.id} "${entry.title}" (${entry.file})`);
  }
  assert.deepEqual(offenders, [],
    '이 검사들은 제목이 새로고침을 약속하는데 실제로는 한 번도 재적재하지 않습니다.\n'
    + '사장님은 이 이름을 보고 안심하십니다 - 이름을 고치거나 진짜 새로고침을 넣어주세요.\n'
    + offenders.join('\n'));
});

test('제목이 "유지/보존" 을 약속하면 잃었을 때 실패할 근거가 있다', () => {
  // 최소한 무언가를 대조해야 한다. assertChecks 도 없는 검사는 무엇이든 통과한다.
  const offenders = [];
  for (const entry of manifestEntries()) {
    if (!/유지|보존|잃지/.test(entry.title)) continue;
    if (!entry.file.startsWith('tools/')) continue;
    const text = sourceWithLocalRequires(entry.file);
    if (!text) continue;
    if (!/assertChecks\(|assert\./.test(text)) offenders.push(`${entry.id} (${entry.file})`);
  }
  assert.deepEqual(offenders, [], `대조하는 곳이 없는 '유지/보존' 검사: ${offenders.join(', ')}`);
});

test('매니페스트의 모든 검사 파일이 실제로 있다', () => {
  // 파일이 없으면 러너가 그 단계를 건너뛰거나 죽는다. 목록만 보고는 알 수 없다.
  const missing = manifestEntries()
    .filter(entry => !fs.existsSync(path.join(ROOT, entry.file)))
    .map(entry => `${entry.id} -> ${entry.file}`);
  assert.deepEqual(missing, [], `매니페스트가 없는 파일을 가리킵니다: ${missing.join(', ')}`);
});

test('이 검사 자신이 무엇을 세는지 - 표본으로 확인', () => {
  // 이 검사가 허수아비가 아니라는 근거. 실제 파일로 세어 본다.
  const withRealReload = sourceWithLocalRequires('tools/verify_factory_assets_survive_hard_reload_v1.cjs');
  assert.ok(reloadCount(withRealReload) >= 1, 'SAVE-26 은 실제로 강제 새로고침을 한다');

  const viaHelper = sourceWithLocalRequires('tools/verify_factory_candidate_confirmation_reload_cdp_v185.cjs');
  assert.ok(reloadCount(viaHelper) >= 1, 'DB-02 는 도우미(harness utils) 안에서 새로고침한다 - 그것도 세어야 한다');

  // 최초 로드만 있는 파일은 0 으로 세어야 한다.
  assert.equal(reloadCount("await cdp.send('Page.navigate', { url: APP_URL });"), 0);

  // 주석에 적힌 설명은 세지 않는다 - 이걸 안 걸러서 파괴 실험이 통과했었다.
  assert.equal(reloadCount("// 예전에는 Page.reload 를 한 번도 하지 않았다"), 0);
  assert.equal(reloadCount("/* Page.reload 설명 */\nawait cdp.send('Page.navigate', { url: APP_URL });"), 0);
  // 진짜 호출은 센다.
  assert.equal(reloadCount("await cdp.send('Page.reload', { ignoreCache: true });"), 1);
});
