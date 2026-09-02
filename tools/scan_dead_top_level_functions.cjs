'use strict';
// 어디서도 부르지 않는 최상위 함수 목록을 만든다.
//
// 왜: 2026-09-02 전체 점검(#28)에서 "최상위 함수 75개가 어디서도 불리지 않는다" 는 지적이 나왔다.
// 지우는 것은 언제나 무언가를 깨뜨릴 수 있으므로, 사람 눈이 아니라 스캐너로 목록을 다시 만들고
// 문자열·data-*-action 간접 호출까지 참조로 세어 살아 있는 것을 죽었다고 하지 않는다.
//
// 참조로 세는 것(하나라도 있으면 살아 있다):
//   - 런타임 클래식 스크립트(manifest.scripts)의 식별자 토큰과 문자열/템플릿 안의 이름
//   - ESM 모듈(src/**/*.mjs)·로더·HTML 진입점(app.html 등)·backend/*.py 안의 이름
// 참조로 세지 않는 것(따로 보고만 한다): tests/, tools/ — 죽은 함수를 못박는 검사는 옮기거나 지운다.
//
// 사용: node tools/scan_dead_top_level_functions.cjs [--json]
const fs = require('node:fs');
const path = require('node:path');
const { tokenize, topLevelFunctionDeclarations } = require('./lib/js_token_scan.cjs');

const ROOT = path.resolve(__dirname, '..');

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'runtime-manifest.json'), 'utf8'));
}

function walk(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'output', '__pycache__', 'venv', 'venv311', '.local'].includes(entry.name)) continue;
      walk(full, predicate, out);
    } else if (predicate(full)) out.push(full);
  }
  return out;
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function countWord(text, name) {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`, 'g');
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function scanDeadTopLevelFunctions(root = ROOT) {
  const manifest = readManifest();
  const classicFiles = manifest.scripts.map(file => path.join(root, file));
  const classic = classicFiles.map(file => {
    const source = fs.readFileSync(file, 'utf8');
    const tokens = tokenize(source);
    return { file, rel: relative(file), source, tokens, declarations: topLevelFunctionDeclarations(tokens) };
  });

  // 선언 위치(파일·토큰 인덱스)를 알아야 자기 선언을 참조로 세지 않는다.
  const declared = new Map();
  for (const entry of classic) {
    for (const decl of entry.declarations) {
      if (!declared.has(decl.name)) declared.set(decl.name, []);
      declared.get(decl.name).push({ file: entry.rel, line: decl.line, nameIndex: decl.nameIndex });
    }
  }

  const references = new Map();
  const bump = (name, where) => {
    if (!declared.has(name)) return;
    if (!references.has(name)) references.set(name, new Map());
    const byFile = references.get(name);
    byFile.set(where, (byFile.get(where) || 0) + 1);
  };

  // 1) 클래식 스크립트: 식별자 토큰 + 문자열/템플릿 본문
  for (const entry of classic) {
    const selfDeclarationIndexes = new Set(entry.declarations.map(decl => decl.nameIndex));
    entry.tokens.forEach((token, index) => {
      if (token.type === 'ident') {
        if (selfDeclarationIndexes.has(index)) return;
        bump(token.value, entry.rel);
      } else if (token.type === 'string' || token.type === 'template') {
        for (const name of declared.keys()) {
          if (token.value.length >= name.length && token.value.includes(name) && countWord(token.value, name)) {
            bump(name, `${entry.rel} (문자열)`);
          }
        }
      }
    });
  }

  // 2) ESM 모듈·로더·HTML·backend: 이름이 글자로 나오면 참조
  const classicSet = new Set(classicFiles.map(file => path.resolve(file)));
  const otherFiles = [
    ...walk(path.join(root, 'src'), file => /\.(mjs|js)$/.test(file) && !classicSet.has(path.resolve(file))),
    ...walk(root, file => /\.html$/.test(file) && path.dirname(file) === root),
    ...walk(path.join(root, 'backend'), file => /\.py$/.test(file) && !/[\\/]tests[\\/]/.test(file)),
  ];
  const declaredNames = [...declared.keys()];
  for (const file of otherFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of declaredNames) {
      if (!text.includes(name)) continue;
      const count = countWord(text, name);
      if (count) bump(name, relative(file));
    }
  }

  // 3) tests/tools 참조는 살아 있음의 근거가 아니다. 보고용으로만 모은다.
  const testFiles = [
    ...walk(path.join(root, 'tests'), file => /\.(cjs|mjs|js)$/.test(file)),
    ...walk(path.join(root, 'tools'), file => /\.(cjs|mjs|js)$/.test(file) && path.basename(file) !== path.basename(__filename)),
  ];
  const testReferences = new Map();
  for (const file of testFiles) {
    const text = fs.readFileSync(file, 'utf8');
    for (const name of declaredNames) {
      if (!text.includes(name) || !countWord(text, name)) continue;
      if (!testReferences.has(name)) testReferences.set(name, []);
      testReferences.get(name).push(relative(file));
    }
  }

  const dead = [];
  for (const [name, sites] of declared) {
    if (references.has(name)) continue;
    for (const site of sites) {
      dead.push({ name, file: site.file, line: site.line, tests: testReferences.get(name) || [] });
    }
  }
  dead.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { dead, declaredCount: declared.size, references, testReferences };
}

if (require.main === module) {
  const result = scanDeadTopLevelFunctions();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result.dead, null, 2));
  } else {
    const byFile = new Map();
    for (const item of result.dead) {
      if (!byFile.has(item.file)) byFile.set(item.file, []);
      byFile.get(item.file).push(item);
    }
    for (const [file, items] of byFile) {
      console.log(`${file} (${items.length})`);
      for (const item of items) {
        console.log(`  ${String(item.line).padStart(6)}  ${item.name}${item.tests.length ? `  ← tests/tools: ${item.tests.join(', ')}` : ''}`);
      }
    }
    console.log(`\n최상위 함수 ${result.declaredCount}개 중 어디서도 부르지 않는 것 ${result.dead.length}개`);
  }
}

module.exports = { scanDeadTopLevelFunctions, countWord };
