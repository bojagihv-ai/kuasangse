'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/src/bulk-intake.mjs'),
  'utf8',
);

/**
 * 실측 2026-09-16: 화면이 뜨는 순간 Cafe24 관리자 API 로
 * POST /api/invoke/cafe24_control_tower/console-products
 * (GET /api/v2/admin/categories?limit=100&offset=0 · "생산관제 입력용 Cafe24 분류 조회")
 * 가 나갔다. 입력 화면을 열지 않아도, 제품이 하나도 없어도 나갔다.
 * workfile-tabs 검사 3건이 "이 화면은 바깥으로 아무것도 내보내지 않는다" 로 이것을 잡아냈다.
 */

test('마운트에서 Cafe24 분류를 부르지 않는다', () => {
  const tail = SOURCE.slice(SOURCE.indexOf('void restoreWorkingState();'));
  assert.doesNotMatch(
    tail.slice(0, 600),
    /void refreshCategories\(\);/u,
    '마운트에서 분류를 불러 화면을 켜자마자 Cafe24 를 친다',
  );
});

test('분류 칸을 그릴 때 한 번만 불러온다', () => {
  const picker = SOURCE.slice(SOURCE.indexOf('function renderCategoryField'));
  assert.match(picker.slice(0, 300), /ensureCategories\(\);/u, '분류 칸이 목록을 요청하지 않는다');
  const guard = SOURCE.slice(SOURCE.indexOf('function ensureCategories'));
  assert.match(guard.slice(0, 260), /if \(categoriesRequested\) return;/u, '여러 번 요청될 수 있다');
  assert.match(guard.slice(0, 260), /categoriesRequested = true;/u);
});

test('사람이 누르는 다시 불러오기는 그대로 남는다', () => {
  assert.match(SOURCE, /refresh\.addEventListener\('click', \(\) => void refreshCategories\(\)\);/u);
});
