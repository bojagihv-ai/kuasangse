'use strict';

// 계약: 자산관에 올릴 때 **원본 사진을 끝까지 찾아본다.**
//
// 2026-08-30 주인님 화면에 뜬 경고:
//   "로컬 작업파일은 저장됐지만 신화사 자산관 동기화는 보류됐습니다:
//    work_bundle_required_assets_missing:1:input:factory_input_restore_mtfuqc4h_bb6itp"
//
// 무슨 일인가:
//   사진을 백업에서 되살리면 inputImages 에는 '__stored_in_indexeddb__' 표식만 남고
//   실제 바이트는 IndexedDB 에 있다(상태를 가볍게 하려고 일부러 그렇게 한다).
//   그런데 자산관 업로드 계획을 세울 때 그 표식은 원본으로 쳐주지 않으므로
//   "필수 자산 없음" 으로 판정되고, 그 순간 **아예 올리려는 시도조차 하지 않는다.**
//   계획이 남기는 사유도 그대로다 — '원본 저장파일에 복원 locator 없음'.
//
// 되돌아갈 길은 원래 둘이었다:
//   1. 로컬 자산관에서 현재 입력 이미지를 찾는다 (withCurrentInputArchiveForWorkBundle)
//   2. payload.productImageBackup.primary 로 되돌아간다 (work-bundle-input-assets.mjs)
//   1번이 실패하면 2번으로 가야 하는데, 그 백업도 표식만 들고 있어 함께 막혀 있었다.
//   그래서 업로드 직전에 백업을 실제 바이트로 채워 준다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_03 = fs.readFileSync(path.join(ROOT, 'src/app-core-03.js'), 'utf8');
const INPUT_ASSETS = fs.readFileSync(path.join(ROOT, 'src/modules/work-bundle-input-assets.mjs'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('업로드 전에 백업 원본을 채운다', () => {
  assert.match(CORE_03, /async function withHydratedImageBackupForWorkBundle\(bundle\)/);
  const fn = sourceSlice(CORE_03, 'async function withHydratedImageBackupForWorkBundle(bundle)', '\nasync function scheduleCurrentWorkBundleSync(');
  assert.match(fn, /hydrateWorkspacePayloadImageBackup\(payload\)/);
  // 이미 원본이 있으면 건드리지 않는다. 매번 IndexedDB 를 뒤지면 저장이 느려진다.
  assert.match(fn, /if \(existing && existing !== '__stored_in_indexeddb__'\) return bundle;/);
  // 채우지 못했으면 원래 것을 그대로 돌려준다.
  assert.match(fn, /if \(!filled \|\| filled === '__stored_in_indexeddb__'\) return bundle;/);
});

test('원본 꾸러미를 함부로 바꾸지 않는다', () => {
  // 저장에 쓰는 꾸러미를 그 자리에서 고치면 다른 곳에 번진다. 바뀔 때만 복사한다.
  const fn = sourceSlice(CORE_03, 'async function withHydratedImageBackupForWorkBundle(bundle)', '\nasync function scheduleCurrentWorkBundleSync(');
  assert.match(fn, /structuredClone\(bundle\)/);
  const cloneAt = fn.indexOf('structuredClone(bundle)');
  const assignAt = fn.indexOf('next.project.payload = hydrated;');
  assert.ok(cloneAt >= 0 && assignAt > cloneAt, '복사보다 대입이 먼저면 원본을 건드립니다.');
});

test('로컬 자산관 → 백업 순서로 시도한다', () => {
  const schedule = sourceSlice(CORE_03, 'async function scheduleCurrentWorkBundleSync(', 'const fileName = String(options.fileName');
  const archiveAt = schedule.indexOf('withCurrentInputArchiveForWorkBundle(scopedBundle)');
  const backupAt = schedule.indexOf('withHydratedImageBackupForWorkBundle(archiveRecovered)');
  assert.ok(archiveAt >= 0, '로컬 자산관에서 찾는 단계가 사라졌습니다.');
  assert.ok(backupAt > archiveAt, '백업 되돌아가기가 자산관 시도보다 먼저면 순서가 뒤집힙니다.');
});

test('계획에 백업으로 되돌아가는 길이 아직 있다', () => {
  // 이 길이 사라지면 위에서 백업을 채워도 소용이 없다.
  assert.match(INPUT_ASSETS, /const backup = record\(record\(payload\.productImageBackup\)\.primary\);/);
  assert.match(INPUT_ASSETS, /binarySource\(factoryProduct\) \|\| binarySource\(backup\)/);
});

test('못 찾으면 사유를 남긴다', () => {
  // 조용히 넘어가면 "왜 자산관에 안 올라가지" 를 또 며칠 헤맨다.
  assert.match(INPUT_ASSETS, /원본 저장파일에 복원 locator 없음/);
  assert.match(INPUT_ASSETS, /plan\.missingRequiredAssetKeys\.push\(assetKey\);/);
});
