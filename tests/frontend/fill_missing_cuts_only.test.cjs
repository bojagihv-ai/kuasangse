'use strict';

// 계약: **"나머지 N개만 생성" 은 결과가 없는 슬롯만 만들고, 멀쩡한 것은 건드리지 않는다.**
//
// 실측 2026-09-06: 새로고침으로 사이즈컷 3장 중 1장만 남았다. "재생성" 은 3장을 전부 다시
// 만들어 멀쩡한 1장까지 요금과 시간을 다시 쓴다. 그래서 끊긴 단계에 "나머지 N개만 생성" 을 붙였다.
//
// 경로: 패널 버튼(data-factory-run-only-missing="1") → assets-tab-bind 가 { stageId, onlyMissing }
//       → 브리지 runFactoryStage → factoryHandleRunStageButton → factoryRunStage → 단계 실행기
//       → generateAllCuts / generateAllSizeCuts 의 targets 필터.
// 실제 생성 흐름은 tools/verify_fill_missing_cuts_only_v1.cjs (FILL-MISSING-01) 가 크롬에서 본다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const MISSING_FILTER = /\.filter\(item => !onlyMissing \|\| !item\.p\?\.result \|\| item\.p\?\.staleResult === true\)/;

test('두 생성 루프 모두 onlyMissing 이면 결과 없는(또는 낡은) 슬롯만 고른다', () => {
  const core = read('src/app-core-06.js');
  const cuts = sourceSlice(core, 'async function generateAllCuts(', '\nconst SIZE_CUTS_RESULT_CACHE_KEY');
  const size = sourceSlice(core, 'async function generateAllSizeCuts(', '\nfunction cutPromptMeaningfulScore(');
  assert.match(cuts, MISSING_FILTER, '이미지컷 루프');
  assert.match(size, MISSING_FILTER, '사이즈컷 루프');
  assert.match(cuts, /부족한 이미지컷이 없습니다/);
  assert.match(size, /부족한 사이즈컷이 없습니다/);
});

test('단계 실행기는 부족분을 채울 때 실행 번호를 이어 쓰고 결과 있는 슬롯을 건드리지 않는다', () => {
  const core = read('src/app-core-06.js');
  const runner = sourceSlice(core, 'async function factoryGenerateImageCutsBackedStage(', '\nasync function factoryRunStage(');
  // 새 번호를 발급하면 화면이 "최신 실행" 만 앞세워 멀쩡한 1장이 "이전 생성" 으로 밀려난다.
  assert.match(runner, /const resumedRunId = onlyMissing\s*\?[\s\S]{0,200}latestGenerationRunId/);
  assert.match(runner, /const generationRunId = resumedRunId \|\| uid\(/);
  assert.match(runner, /const willGenerate = !!hasPrompt && \(!onlyMissing \|\| !cut\.result \|\| cut\.staleResult === true\)/);
  assert.match(runner, /generateAllSizeCuts\(\{[^}]*onlyMissing \}\)/);
  assert.match(runner, /generateAllCuts\(\{[^}]*onlyMissing \}\)/);
  assert.match(runner, /if \(onlyMissing && target === 0\)/, '부족분이 없으면 생성 루프를 돌리지 않는다');
});

test('버튼 → 브리지 → 실행기까지 onlyMissing 이 끊기지 않고 전달된다', () => {
  const core03 = read('src/app-core-03.js');
  const core05 = read('src/app-core-05.js');
  const core06 = read('src/app-core-06.js');
  // assert.match 는 실패 시 파일 전체(1MB)를 쏟아내므로 ok 로 검사한다.
  const bridge = sourceSlice(core03, 'runFactoryStage(stageId, operationContext) {', 'addFactoryStageInputFiles(stageId, files, operationContext) {');
  assert.ok(/const request = stageId && typeof stageId === 'object' \? stageId : \{ stageId \};/.test(bridge), '브리지가 { stageId, onlyMissing } 객체를 받아야 한다');
  assert.ok(/factoryRunOnlyMissing: request\.onlyMissing === true \? '1' : ''/.test(bridge), '브리지가 dataset.factoryRunOnlyMissing 으로 넘겨야 한다');
  assert.ok(/const onlyMissing = options\.onlyMissing === true \|\| btn\?\.dataset\?\.factoryRunOnlyMissing === '1'/.test(core06), 'factoryHandleRunStageButton 이 버튼 속성을 읽어야 한다');
  assert.ok(/await factoryRunStage\(stageId, \{[\s\S]{0,160}onlyMissing: options\.onlyMissing === true,/.test(core06), 'factoryRunPreparedStageButton 이 factoryRunStage 로 넘겨야 한다');
  assert.ok(/onlyMissing: options\.onlyMissing === true,\s*\};\s*if \(stageId === 'hero'\) return factoryGenerateImageCutsBackedStage/.test(core06), 'factoryRunStage 가 단계 실행기로 넘겨야 한다');
  // 버튼은 끊긴 단계(interruptedNote)에서만 그려지고, N = 기대 개수 - 보이는 개수.
  const button = sourceSlice(core05, '${interruptedNote && countStages.includes(stageId)', '컨베이어 카드로 이동');
  assert.match(button, /data-factory-run-stage="\$\{escAttr\(stageId\)\}" data-factory-run-only-missing="1"/);
  assert.match(button, /나머지 \$\{escapeHtml\(String\(Math\.max\(1, Number\(stage\.expectedItemCount\) - assets\.length\)\)\)\}개만 생성/);
});

test('assets 탭 클릭 바인딩: 부족분 버튼은 { stageId, onlyMissing } 로, 보통 버튼은 문자열로 보낸다', async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/assets-tab-bind.mjs')).href);
  const fired = [];
  let clickHandler = null;
  const root = {
    addEventListener(type, handler) { if (type === 'click') clickHandler = handler; },
    removeEventListener() {},
  };
  mod.bindAssetsTab(root, (name, ...args) => fired.push([name, ...args]));
  assert.equal(typeof clickHandler, 'function');

  const fakeEvent = dataset => ({
    preventDefault() {}, stopPropagation() {},
    target: { closest: selector => (selector === '[data-factory-run-stage]' ? { dataset } : null) },
  });
  clickHandler(fakeEvent({ factoryRunStage: 'cuts', factoryRunOnlyMissing: '1' }));
  clickHandler(fakeEvent({ factoryRunStage: 'size' }));
  assert.deepEqual(fired, [
    ['runStage', { stageId: 'cuts', onlyMissing: true }],
    ['runStage', 'size'],
  ]);
});
