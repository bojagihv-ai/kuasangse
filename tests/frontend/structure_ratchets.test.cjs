'use strict';

// 계약: **구조 부채가 더 늘지 않는다.** 지금 있는 것을 한꺼번에 지우지는 않는다.
//
// 주인님 2026-09-02: "제일중요한건 그거야 한곳을 고친다고 다른쪽을 망가뜨리지않는것"
//
// 전수 진단은 두 가지를 지적했다:
//   #28 어디서도 부르지 않는 최상위 함수 75개
//   #29 typeof 로 막았다고 믿지만 실제로는 못 막는 TDZ 참조
//
// 75개를 한꺼번에 지우는 것은 사장님 제1원칙과 정면으로 부딪힌다. 잘 도는 앱에서
// 얻는 것(용량 몇 KB)에 비해 잃을 수 있는 것(간접 호출 한 줄을 놓쳐 기능이 죽는 것)이
// 훨씬 크다. 실제로 스캐너도 문자열·data-*-action 간접 호출을 세지만 완벽하진 않다.
//
// 그래서 지우는 대신 **래칫**을 건다. 지금 숫자를 천장으로 박아 두면
//   - 새 죽은 함수·새 TDZ 함정이 들어오는 순간 회귀가 잡고,
//   - 하나씩 정리할 때마다 천장을 내리면 되돌아가지 못한다.
// 잘 도는 것을 건드리지 않으면서 나빠지는 것만 막는 방법이다.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { scan: scanTdz } = require('../../tools/scan_tdz_typeof_traps.cjs');

// ── 천장. 정리하면 내린다. 올리지 말 것 ──────────────────────────────
const DEAD_FUNCTION_CEILING = 75;   // 2026-09-02 기준
const TDZ_TRAP_CEILING = 38;        // 2026-09-02 기준

test('파일이 실리는 순간 터지는 TDZ 참조는 단 한 건도 없다', () => {
  // 여기는 래칫이 아니라 0 이다. 중괄호 깊이 0 에서 뒤 파일의 let/const 를 typeof 하면
  // 그 파일이 실려 들어오는 그 순간 ReferenceError 가 나고 **앱이 아예 안 뜬다.**
  const result = scanTdz();
  const detail = result.immediate
    .map(trap => `${trap.usedIn}:${trap.usedAtLine} typeof ${trap.name} ← ${trap.declaredIn}:${trap.declaredAtLine}`)
    .join('\n');
  assert.equal(result.immediate.length, 0,
    `파일이 실리는 순간 터지는 TDZ 참조가 있습니다 - 앱이 안 뜹니다:\n${detail}`);
});

test('typeof 로 못 막는 TDZ 참조가 더 늘지 않는다', () => {
  // typeof 는 TDZ 를 막지 못한다. 2026-08-30 에 이 한 줄이 복원 경로를 끊어
  // 강제 새로고침에서 생성물 10개가 사라졌다(일일 회귀 SAVE-26).
  const result = scanTdz();
  const detail = result.traps
    .map(trap => `  ${trap.usedIn}:${trap.usedAtLine} typeof ${trap.name} ← ${trap.declaredIn}:${trap.declaredAtLine} (${trap.kind})`)
    .join('\n');
  assert.ok(result.traps.length <= TDZ_TRAP_CEILING,
    `typeof 로 못 막는 TDZ 참조가 ${result.traps.length}건으로 늘었습니다 (천장 ${TDZ_TRAP_CEILING}).\n`
    + 'typeof 대신 try/catch 로 감싸거나, 선언을 앞 파일로 옮기거나, var 로 바꾸세요.\n'
    + detail);
  if (result.traps.length < TDZ_TRAP_CEILING) {
    console.log(`[알림] TDZ 참조가 ${result.traps.length}건으로 줄었습니다 - 천장을 ${result.traps.length} 으로 내려주세요.`);
  }
});

test('어디서도 부르지 않는 최상위 함수가 더 늘지 않는다', () => {
  // 스캐너를 직접 require 하면 실행까지 되므로 자식 프로세스로 --json 을 받는다.
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath,
    [path.join(__dirname, '..', '..', 'tools', 'scan_dead_top_level_functions.cjs'), '--json'],
    { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') });
  assert.equal(result.status, 0, `스캐너가 실패했습니다: ${result.stderr}`);
  const report = JSON.parse(result.stdout);
  const dead = Array.isArray(report.dead) ? report.dead : (report.deadFunctions || []);
  assert.ok(Array.isArray(dead), `스캐너 출력 형태가 바뀌었습니다: ${Object.keys(report).join(', ')}`);
  assert.ok(dead.length <= DEAD_FUNCTION_CEILING,
    `어디서도 부르지 않는 최상위 함수가 ${dead.length}개로 늘었습니다 (천장 ${DEAD_FUNCTION_CEILING}).\n`
    + '새로 만든 함수를 부르는 곳이 빠졌거나, 부르던 곳을 지우면서 함수를 남겨 두었습니다.');
  if (dead.length < DEAD_FUNCTION_CEILING) {
    console.log(`[알림] 죽은 함수가 ${dead.length}개로 줄었습니다 - 천장을 ${dead.length} 으로 내려주세요.`);
  }
});

test('이 검사 자신이 무엇을 세는지 - 실제 자리로 확인', () => {
  // 허수아비가 아니라는 근거. 2026-08-30 사고의 그 이름이 지금은 try/catch 로 막혀 있어야 한다.
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'app-core-02.js'), 'utf8');
  assert.match(source, /try \{ batchWorkerMode = classicRuntimeBatchWorkerMode === true; \} catch/,
    '2026-08-30 복원 사고 자리가 try/catch 로 막혀 있어야 합니다');

  // 그리고 스캐너가 실제로 뒤 파일 선언을 알아본다.
  const result = scanTdz();
  assert.ok(result.fileCount > 5, `런타임 스크립트를 못 읽었습니다: ${result.fileCount}개`);
  assert.ok(result.traps.length > 0,
    '이 저장소에는 알려진 TDZ 참조가 있습니다 - 0 이 나오면 스캐너가 아무것도 안 보고 있는 것입니다');
});

test('조립공장 마법사 자리고침이 살아 있는지 아닌지를 분명히 해 둔다', () => {
  // 전수 진단 #27. factoryPatchAutomationWizardTab 은 첫 줄에서
  //   typeof renderFactoryAutomationPanel !== 'function'
  // 을 보고 돌아선다. 그런데 renderFactoryAutomationPanel 은 이 저장소 어디에도 없다.
  // 패널은 이제 ESM 메뉴 모듈(src/menus/factory/factory-menu-shell.mjs 의
  // renderFactoryMenuShell)이 그린다. 즉 이 함수는 **항상 false 를 돌려주고**,
  // 부르는 쪽 네 곳은 전부 `if (!patched) render();` 로 전체 다시 그리기를 한다.
  //
  // 되살리려면 클래식 스코프에서 ESM 메뉴의 탭 마크업 파이프라인을 꺼내 써야 한다 -
  // 사장님이 매일 쓰시는 마법사를 건드리는 진짜 개조다. 잘 도는 것을 건드리지 않는다.
  // 대신 **여기 적어 둔다.** 다음 사람이 "자리고침이 돌고 있겠지" 하고 믿지 않도록.
  const fs = require('node:fs');
  const root = path.join(__dirname, '..', '..');
  const core06 = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');
  assert.match(core06, /typeof renderFactoryAutomationPanel !== 'function'/,
    '가드 문구가 바뀌었습니다 - 자리고침이 살아났다면 이 검사를 고쳐 주세요');

  // 그 이름을 실제로 만들어 두지 않았다는 사실 자체가 이 상태의 근거다.
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src', 'runtime-manifest.json'), 'utf8'));
  let definitions = 0;
  for (const entry of manifest.scripts || []) {
    const file = path.join(root, String(entry).replace(/^\.?\//, ''));
    if (!fs.existsSync(file)) continue;
    definitions += (fs.readFileSync(file, 'utf8').match(/function renderFactoryAutomationPanel\s*\(/g) || []).length;
  }
  assert.equal(definitions, 0,
    'renderFactoryAutomationPanel 이 생겼습니다 - 자리고침이 살아났으니 이 검사와 주석을 갱신해주세요');
});
