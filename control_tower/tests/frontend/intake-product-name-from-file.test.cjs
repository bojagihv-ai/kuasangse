'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const MODEL_URL = new URL(`file://${path.resolve(ROOT, 'control_tower/frontend/src/bulk-intake-model.mjs').split(String.fromCharCode(92)).join('/')}`).href;
const INTAKE_SOURCE = fs.readFileSync(path.resolve(ROOT, 'control_tower/frontend/src/bulk-intake.mjs'), 'utf8');

/**
 * 실측 2026-09-03: 사진을 고르고 그대로 투입했더니 작업 큐에 IMG_5968 이라는 제품이 생겼다.
 * 제품명 칸은 있지만 기본값이 파일 이름이라, 손대지 않으면 그대로 흘러가 작업파일 이름과
 * Cafe24 등록 이름까지 그 이름이 된다.
 */
test('카메라·메신저 파일 이름은 제품명으로 새어 나간 것으로 본다', async () => {
  const { looksLikeCameraFileName } = await import(MODEL_URL);
  const leakedNames = [
    'IMG_5968', 'img_5968.jpg', 'DSC01234', 'DSC_0123', 'P1010203',
    'Screenshot_20260903_143020', 'KakaoTalk_20260903_1430', '스크린샷 2026-09-03', 'received_1725340000',
  ];
  for (const leaked of leakedNames) {
    assert.equal(looksLikeCameraFileName(leaked), true, leaked);
  }
});

test('사람이 지은 이름은 건드리지 않는다', async () => {
  const { looksLikeCameraFileName } = await import(MODEL_URL);
  for (const real of ['방울수저집', '슬라브 겹보 55x55 R3', '낙지발노리개', '모시보자기 2호', 'IMG 전용 파우치', '자수 미니 파우치']) {
    assert.equal(looksLikeCameraFileName(real), false, real);
  }
});

test('파일 이름 제품명은 알려 주되 투입을 막지는 않는다', async () => {
  const { BLOCKING_ISSUES } = await import(MODEL_URL);
  // 정말 그 이름으로 쓰려는 사람도 있다. 흠으로 보여 주기만 한다.
  assert.equal(BLOCKING_ISSUES.has('product_name_from_file'), false);
  assert.equal(BLOCKING_ISSUES.has('product_name_missing'), true);
});

test('화면은 그 흠을 사람 말로 부른다', () => {
  assert.match(INTAKE_SOURCE, /product_name_from_file: '제품명이 사진 파일 이름 그대로입니다'/u);
});
