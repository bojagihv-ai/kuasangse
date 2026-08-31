'use strict';

// 계약: **이전 후보의 상세이미지를 지금 후보의 것인 양 내놓지 않는다.**
//
// 2026-08-31 주인님:
//   "새로운걸 선택해서 이 후보 선택을 했는데 밑에 결과반영이 잘 안되는것같아"
//
// 화면을 보면 11번가 후보를 새로 골랐는데, 아래 이미지 분석 칸에는
// **쿠팡** 상품('놋향 밥짜유기 2인 끈 누빔 수저집')이 한 장 떠 있었다.
// 요약도 "현재 선택 1건 · 이번 수집 0장 · 복구 이미지 1장" 이었다.
//
// 실제로 반영이 안 된 게 아니었다. **이 후보로는 아직 아무것도 수집하지 않았는데**
// 화면이 그 사실을 말하지 않은 것이다:
//   const selectableImages = currentImages.length ? currentImages : previousImages;
// 이미지는 detailOperationId(상세수집 작업 번호)로 갈린다(competitor-tab-model.mjs).
// 새 후보를 고르면 이번 것은 0장이 되고, 예전 것이 그 자리에 앉는다.
//
// 고를 수 있게 두는 것은 그대로 둔다(쓸모가 있을 수 있다).
// 다만 **어디서 온 것인지 분명히 말한다.** 그대로 분석하면 예전 후보를 분석하게 된다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const IMAGES = fs.readFileSync(path.join(ROOT, 'src/menus/factory/tabs/competitor-tab-images.mjs'), 'utf8');
const MODEL = fs.readFileSync(path.join(ROOT, 'src/menus/factory/tabs/competitor-tab-model.mjs'), 'utf8');

test('이번 것과 이전 것은 상세수집 작업 번호로 갈린다', () => {
  // 이 전제가 무너지면 아래 경고가 언제 떠야 하는지 알 수 없다.
  assert.match(MODEL, /const currentImages = images\.filter\(image => String\(image\?\.detailOperationId \|\| ''\) === operationId\);/);
  assert.match(MODEL, /const previousImages = images\.filter\(image => String\(image\?\.detailOperationId \|\| ''\) !== operationId\);/);
});

test('이번 수집이 0장이면 이전 수집분임을 판정한다', () => {
  assert.match(IMAGES, /const usingPreviousAsFallback = !currentImages\.length && previousImages\.length > 0;/);
});

test('이전 수집분이면 눈에 띄게 경고한다', () => {
  assert.match(IMAGES, /data-comp-market-previous-fallback="1"/);
  assert.match(IMAGES, /이전 후보<\/b>의 수집분이라 상품과 사이트가 다를 수 있습니다/);
  assert.match(IMAGES, /후보 카드에서 상세수집을 실행해주세요/);
});

test('상태 문구가 "수집했다" 고 오해를 부르지 않는다', () => {
  // 예전에는 market.status 에 남아 있던 지난 실행 문구가 그대로 떠서
  // "선택 후보 상세페이지를 수집했고 경쟁사 이미지 1장을 찾았습니다" 처럼 보였다.
  assert.match(IMAGES, /usingPreviousAsFallback \? '이 후보로 수집한 이미지가 아직 없습니다'/);
  assert.match(IMAGES, /지금 고른 후보의 이미지가 아닙니다/);
  assert.match(IMAGES, /그대로 분석하면 예전 후보를 분석하게 됩니다/);
});

test('이전 수집분도 고를 수는 있다', () => {
  // 막지는 않는다. 예전 이미지가 쓸모 있을 수 있고, 막으면 오히려 일이 끊긴다.
  // 다만 그것이 무엇인지 알고 고르게 한다.
  assert.match(IMAGES, /const selectableImages = currentImages\.length \? currentImages : previousImages;/);
});
