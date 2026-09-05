'use strict';
// `typeof X` 로 막았다고 믿었는데 실제로는 못 막는 자리를 찾는다.
//
// 무슨 함정인가:
//   번들은 runtime-manifest.json 의 순서대로 파일을 이어 붙여 **하나의 클래식 스크립트**가 된다.
//   그래서 뒤 파일의 최상위 `let`/`const` 는 앞 파일 코드가 실행될 때 아직 초기화 전(TDZ)이다.
//   보통 `typeof X === 'undefined'` 는 선언조차 없는 이름도 안전하게 검사해 주지만,
//   **TDZ 에 있는 let/const 는 typeof 조차 ReferenceError 를 던진다.**
//   그러니 typeof 로 감싸 둔 사람은 막았다고 믿고, 실제로는 예외가 그대로 터진다.
//
// 실제로 무슨 일이 있었나 (2026-08-30, 일일 회귀 SAVE-26):
//   app-core-02.js 의 복원 경로가 app-core-03.js 에서 `let` 으로 선언된
//   classicRuntimeBatchWorkerMode 를 typeof 로 확인했다. 부팅 초반 복원 중에 그 한 줄이
//   ReferenceError 를 던져 복원이 통째로 끊겼고, 강제 새로고침에서 생성물 10개가 사라졌다.
//   var 나 미선언이었다면 나지 않았을 함정이다.
//
// 그래서 사람이 아니라 기계가 본다. 새로 들어오는 같은 실수를 회귀가 잡는다.
//
// 사용: node tools/scan_tdz_typeof_traps.cjs [--json]
const fs = require('node:fs');
const path = require('node:path');
const { tokenize, topLevelBindingDeclarations } = require('./lib/js_token_scan.cjs');

const ROOT = path.resolve(__dirname, '..');

function runtimeScripts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8'));
  const scripts = Array.isArray(manifest.scripts) ? manifest.scripts : [];
  return scripts.map(entry => String(entry).replace(/^\.?\//, ''));
}

// 번들 순서에서 각 파일이 몇 번째인지, 그리고 그 파일의 최상위 let/const/class 이름들.
function collect() {
  const files = runtimeScripts();
  const perFile = [];
  for (let order = 0; order < files.length; order += 1) {
    const relative = files[order];
    const full = path.join(ROOT, relative);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, 'utf8');
    const tokens = tokenize(source);
    const lexical = topLevelBindingDeclarations(tokens)
      .filter(entry => entry.kind === 'let' || entry.kind === 'const' || entry.kind === 'class');
    perFile.push({ order, relative, source, tokens, lexical });
  }
  return perFile;
}

// `typeof NAME` 형태의 참조 위치. 괄호 하나까지는 허용한다: typeof (NAME)
//
// depth 를 함께 본다. 중괄호 깊이 0 에서 하는 typeof 는 파일이 실려 들어오는 **그 순간**
// 실행되므로 뒤 파일의 let/const 를 건드리면 무조건 터진다 - 앱이 아예 안 뜬다.
// 함수 몸통 안(depth > 0)에 있는 것은 그 함수가 불릴 때 터진다 - 대개 부팅 뒤라 늦게,
// 그리고 조용히 터진다. 2026-08-30 복원 사고가 그 종류였다.
function typeofReferences(tokens) {
  const found = [];
  let depth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === 'punct') {
      if (token.value === '{') depth += 1;
      else if (token.value === '}') depth -= 1;
    }
    if (token.type !== 'keyword' || token.value !== 'typeof') continue;
    let next = tokens[k + 1];
    if (next?.type === 'punct' && next.value === '(') next = tokens[k + 2];
    if (next?.type !== 'ident') continue;
    found.push({ name: next.value, line: next.line, index: k, immediate: depth === 0 });
  }
  return found;
}

function scan() {
  const perFile = collect();

  // 이름 -> 그 이름을 최상위 렉시컬 바인딩으로 선언한 파일들
  const declaredIn = new Map();
  for (const file of perFile) {
    for (const entry of file.lexical) {
      if (!declaredIn.has(entry.name)) declaredIn.set(entry.name, []);
      declaredIn.get(entry.name).push({ order: file.order, relative: file.relative, kind: entry.kind, line: entry.line, index: entry.index });
    }
  }

  const traps = [];
  for (const file of perFile) {
    for (const reference of typeofReferences(file.tokens)) {
      const declarations = declaredIn.get(reference.name);
      if (!declarations) continue;
      // 참조보다 **뒤에** 선언된 것이 하나라도 있으면 TDZ 다.
      // 같은 파일 안에서도 선언보다 앞에서 typeof 하면 같은 함정이다.
      const later = declarations.filter(declaration => (
        declaration.order > file.order
        || (declaration.order === file.order && declaration.index > reference.index)
      ));
      if (!later.length) continue;
      // 이미 선언이 앞에 있는 경우(다른 파일에서 먼저 선언)라면 안전하다.
      const earlier = declarations.filter(declaration => (
        declaration.order < file.order
        || (declaration.order === file.order && declaration.index < reference.index)
      ));
      if (earlier.length) continue;
      traps.push({
        name: reference.name,
        usedIn: file.relative,
        usedAtLine: reference.line,
        declaredIn: later[0].relative,
        declaredAtLine: later[0].line,
        kind: later[0].kind,
        immediate: reference.immediate === true,
      });
    }
  }
  return {
    fileCount: perFile.length,
    traps,
    // 파일이 실리는 순간 터지는 것. 여기는 단 한 건도 허용하지 않는다.
    immediate: traps.filter(trap => trap.immediate),
  };
}

if (require.main === module) {
  const result = scan();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (!result.traps.length) {
    console.log(`런타임 스크립트 ${result.fileCount}개 · typeof 로 못 막는 TDZ 참조 0건`);
  } else {
    for (const trap of result.traps) {
      console.log(`${trap.immediate ? '[즉시] ' : '        '}${trap.usedIn}:${trap.usedAtLine}  typeof ${trap.name}`
        + `  ← ${trap.declaredIn}:${trap.declaredAtLine} 에서 ${trap.kind} 으로 선언 (뒤에 온다)`);
    }
    console.log(`\ntypeof 로 못 막는 TDZ 참조 ${result.traps.length}건`
      + ` (그중 파일 실릴 때 바로 터지는 것 ${result.immediate.length}건)`);
    console.log('typeof 는 TDZ 를 막지 못합니다. try/catch 로 감싸거나, 선언을 앞 파일로 옮기거나, var 로 바꾸세요.');
    process.exitCode = 1;
  }
}

module.exports = { scan, typeofReferences };
