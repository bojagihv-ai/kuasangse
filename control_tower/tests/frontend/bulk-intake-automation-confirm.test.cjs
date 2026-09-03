'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const INTAKE = fs.readFileSync(path.resolve(ROOT, 'control_tower/frontend/src/bulk-intake.mjs'), 'utf8');

/**
 * 실측 2026-09-03: 조작자가 사진을 넣고 "작업 큐에 투입" 을 눌렀더니, 어떤 이미지 모델로
 * 어떤 자동화 방식으로 진행되는지 한 번도 보지 못한 채 곧바로 큐에 들어갔다. 두 값은 사실
 * 화면에 없는 숨은 옛 폼(#image-model-select, #batch-policy · manual-intake-panel, hidden)
 * 에서 조용히 읽혀 왔다. "자동 수동 선택하는것도 나 한번도 인식하지못했어."
 */
test('이미지 모델과 자동화 방식은 이 화면 자체의 보이는 컨트롤에서만 읽는다', () => {
  assert.doesNotMatch(INTAKE, /getElementById\('image-model-select'\)\?\.value/u);
  assert.doesNotMatch(INTAKE, /getElementById\('batch-policy'\)\?\.value/u);
  assert.match(INTAKE, /imageModelSelect\.id = 'bulk-image-model-select';/u);
  assert.match(INTAKE, /policySelect\.id = 'bulk-automation-preset-select';/u);
  assert.match(INTAKE, /const imageModel = imageModelSelect\.value \|\| '';/u);
  assert.match(INTAKE, /preset: String\(policySelect\.value \|\| ''\)\.trim\(\) \|\| 'full_auto',/u);
});

test('자동화 방식마다 무엇을 대신 정하는지 사람 말로 설명한다', () => {
  assert.match(INTAKE, /full_auto: '대표·사이즈·색상옵션·이미지컷·섹션·최종 상세페이지까지 전부 AI가 고릅니다/u);
  assert.match(INTAKE, /custom: '자동판단 화면에서 단계별로 정한 값을 그대로 씁니다\.'/u);
});

test('첫 클릭은 확인만 하고, 진짜 투입은 두 번째 클릭에서 일어난다', () => {
  const onClick = INTAKE.slice(INTAKE.indexOf('function onClick'), INTAKE.indexOf('function onClick') + 700);
  assert.match(onClick, /if \(!confirmState\) \{/u);
  assert.match(onClick, /confirmState = \{ entries \};/u);
  assert.match(onClick, /render\(\);\s*return;/u);
  assert.match(onClick, /void submitPlan\(\);/u);
});

test('확인 화면은 판단 모델·이미지 모델·자동화 방식과 파일명 그대로인 제품을 보여준다', () => {
  const renderer = INTAKE.slice(INTAKE.indexOf('function renderConfirmBox'), INTAKE.indexOf('function render() {'));
  assert.match(renderer, /이미지 생성 모델/u);
  assert.match(renderer, /자동화 방식/u);
  assert.match(renderer, /판단 모델 \(경쟁사·색상 등 AI 판단\)/u);
  assert.match(renderer, /looksLikeCameraFileName\(entry\.productName\)/u);
  assert.match(renderer, /그 이름으로 경쟁사도 검색됩니다/u);
});

test('투입이 실제로 시작되면 확인 상태를 지운다 — 중복 투입을 막는다', () => {
  const submit = INTAKE.slice(INTAKE.indexOf('async function submitPlan'), INTAKE.indexOf('async function submitPlan') + 500);
  assert.match(submit, /confirmState = null;/u);
});
