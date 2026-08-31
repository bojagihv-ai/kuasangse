'use strict';

// 계약: **이미지컷을 0으로 한 번 돌렸다고 그 뒤로 영영 안 도는 일은 없다.**
//
// 2026-08-31 주인님: "이미지컷이 원래없었나? 보통은 처음에 맨처음 생성돌릴떄
//                     이미지컷도 같이 생성하지않어?"
//
// 같이 생성하는 게 맞다. 시작 버튼은 app-core-06.js 의 factoryRunHeroAndCutsForOneClick 으로
// 대표이미지와 이미지컷을 **한 태스크**로 돌린다. 이미지컷이 빠진 적은 없고, git 이력상
// 이 흐름은 2026-08-09(1d40fcb) 이후 한 줄도 바뀌지 않았다.
//
// 진짜 결함은 래칫이었다:
//   1. 시작을 이미지컷 수 0으로 한 번 돌리면 factorySyncCutPromptsForOneClick 이
//      factory.stages.cuts.targetCount = 0 을 **영구 기록**했다.
//   2. 다음 실행에서 cutMax 는 factoryImageCutPresetListForStage('cuts') 로 구하는데,
//      그 안의 applyStartRunLimit 가 시작 실행 전(startRunActive=false, oneClickLimits 미설정)
//      이라 stage.targetCount(=0)를 상한으로 써서 프롬프트 목록을 빈 배열로 잘랐다.
//   3. requestedCutPromptCount = min(cutMax=0, startRunCounts.cuts) = 0 -> '이번 실행 수량 0' 으로 건너뜀.
//      **시작탭에 2나 4를 넣어도 소용없다.**
//   4. 그런데 조립공장 패널은 `Number(stage.targetCount) || 4` 라서 그 0을 **4로** 보여줬다.
//      사람 눈으로는 구분할 방법이 없었다.
//
// 조립공장 입력칸은 Math.max(1, ...) 로 최소 1에 잠겨 있어(app-core-05.js) 사람이 0을 넣을 길이 없다.
// 즉 0은 오직 위 1번에서만 생기는 찌꺼기다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const CORE_05 = fs.readFileSync(path.join(ROOT, 'src/app-core-05.js'), 'utf8');
const CORE_06 = fs.readFileSync(path.join(ROOT, 'src/app-core-06.js'), 'utf8');

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return text.slice(start, end);
}

test('시작 버튼은 대표이미지와 이미지컷을 한 태스크로 돌린다', () => {
  // 이 전제가 깨지면 아래 계약은 의미가 없다. 이미지컷이 시작에서 빠지면 안 된다.
  assert.match(CORE_06, /guardTaskProgress\('대표이미지·이미지컷 생성', \['hero', 'cuts'\]/);
  assert.match(CORE_06, /factoryRunHeroAndCutsForOneClick/);
});

test('이번 실행의 0을 스테이지 설정에 적어 두지 않는다', () => {
  const sync = sourceSlice(CORE_06, 'function factorySyncCutPromptsForOneClick(', 'if (!promptRows.length) return');
  assert.doesNotMatch(sync, /factory\.stages\.cuts\.targetCount = 0;/,
    '0을 적어 두면 다음 실행의 상한이 되어 이미지컷이 영영 안 돕니다.');
  assert.match(sync, /return 0;/, '이번 실행은 그대로 건너뛰어야 합니다.');
});

test('이미 0이 박혀 저장된 작업도 풀린다', () => {
  const limiter = sourceSlice(CORE_06, 'const applyStartRunLimit = rows => {', 'const defaultTarget =');
  assert.match(limiter, /if \(!active && Number\(raw\) === 0\) return list;/,
    '저장본에 남은 0을 상한으로 쓰면 고쳐도 기존 작업은 계속 막힙니다.');
  // 시작 실행 중(active)의 0은 사용자가 이번에 고른 값이므로 그대로 지켜야 한다.
  const guardAt = limiter.indexOf('if (!active && Number(raw) === 0)');
  const sliceAt = limiter.indexOf('return list.slice(0, limit);');
  assert.ok(guardAt >= 0 && sliceAt > guardAt, '가드가 slice 뒤에 있으면 먹지 않습니다.');
});

test('실행 수량 0은 여전히 이번 실행만 건너뛴다', () => {
  // 래칫을 푼다고 "0을 넣어도 생성된다" 가 되면 안 된다. 그건 다른 사고다.
  assert.match(CORE_06, /if \(cutPromptCount <= 0\) \{/);
  assert.match(CORE_06, /이번 실행 수량이 0이라 이미지컷 생성은 건너뛰고 기존 확보 이미지를 사용합니다/);
});

test('건너뛴 것을 "아직 결과가 없습니다" 라고 하지 않는다', () => {
  // 아직 안 돌린 것과 돌렸는데 건너뛴 것은 사용자에게 완전히 다른 얘기다.
  assert.match(CORE_05, /function factoryStageSkipNotice\(stage = \{\}\)/);
  assert.match(CORE_05, /if \(!\/건너뛰\|수량이 0\/\.test\(message\)\) return '';/);
  assert.match(CORE_05, /이번 실행에서 만들지 않은 것이지, 생성이 실패한 것은 아닙니다/);
  // 빈 그리드가 그 안내를 실제로 쓰는지 확인한다. 함수만 있고 안 쓰면 소용없다.
  const empty = sourceSlice(CORE_05, 'factory-stage-results empty', '</div></div>`}');
  assert.match(empty, /factoryStageSkipNotice\(stage\)/);
});

test('사람은 조립공장 생성 수에 0을 넣을 수 없다', () => {
  // 이 전제가 깨지면 "0은 찌꺼기뿐" 이라는 위 판단이 무너진다.
  assert.match(CORE_05, /factory\.stages\[stageId\]\.targetCount = Math\.max\(1, Math\.min\(30,/);
});
