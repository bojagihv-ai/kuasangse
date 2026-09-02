'use strict';
// 왜 이 파일이 있는가: 이 저장소는 파서 의존성(acorn 등)을 두지 않는다(node_modules 2개).
// 그런데 "어디서도 부르지 않는 함수", "선언보다 앞에서 실행되는 let/const 참조(TDZ)" 같은
// 계약은 정규식으로 보면 문자열·주석·정규식 리터럴에 속는다. 그래서 최소한의 토크나이저를 둔다.
//
// 목표는 문법 완전성이 아니라 다음 세 가지를 틀리지 않는 것이다.
//   1) 문자열/템플릿/정규식/주석 안의 글자를 코드로 보지 않는다.
//   2) 중괄호 깊이를 정확히 세서 "최상위" 를 안다(템플릿 `${}` 는 깊이에 섞지 않는다).
//   3) 식별자와 키워드를 구분한다.
// 2026-09-02 실측: app-core 6개(92,754줄)와 번들(dist/app-runtime.bundle.js)을 1초 안에 훑는다.

const KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield', 'null', 'true', 'false', 'undefined', 'get', 'set',
]);

// 앞 토큰이 이것들이면 다음 `/` 는 나눗셈이 아니라 정규식이다.
const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'instanceof', 'new', 'delete', 'void', 'throw', 'else', 'do',
  'await', 'yield',
]);

function isIdentStart(ch) {
  return /[A-Za-z_$ -￿]/.test(ch);
}

function isIdentPart(ch) {
  return /[A-Za-z0-9_$ -￿]/.test(ch);
}

function tokenize(source) {
  const src = String(source);
  const tokens = [];
  const length = src.length;
  let i = 0;
  let line = 1;
  // 템플릿 `${` 로 코드 모드에 들어갈 때의 중괄호 깊이를 쌓는다.
  // 같은 깊이에서 `}` 를 만나면 템플릿 문자열로 되돌아간다.
  const templateStack = [];
  let braceDepth = 0;

  const push = (type, value, start) => {
    tokens.push({ type, value, start, end: i, line });
  };

  const lastSignificant = () => tokens[tokens.length - 1] || null;

  const regexAllowed = () => {
    const prev = lastSignificant();
    if (!prev) return true;
    if (prev.type === 'keyword') return REGEX_AFTER_KEYWORD.has(prev.value);
    if (prev.type === 'punct') return !(prev.value === ')' || prev.value === ']');
    if (prev.type === 'template-close' || prev.type === 'template-open') return true;
    return false;
  };

  const scanTemplate = () => {
    // 현재 i 는 템플릿 문자열 본문의 시작(백틱 다음 또는 `}` 다음).
    const start = i;
    let value = '';
    while (i < length) {
      const ch = src[i];
      if (ch === '\\') { value += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') {
        push('template', value, start);
        i += 1;
        return;
      }
      if (ch === '$' && src[i + 1] === '{') {
        push('template', value, start);
        i += 2;
        push('template-open', '${', i - 2);
        templateStack.push(braceDepth);
        return;
      }
      if (ch === '\n') line += 1;
      value += ch;
      i += 1;
    }
    push('template', value, start);
  };

  while (i < length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '\n') { line += 1; i += 1; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v' || ch === ' ' || ch === '﻿') { i += 1; continue; }
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? length : end + 2;
      for (let k = i; k < stop; k += 1) if (src[k] === '\n') line += 1;
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      let value = '';
      i += 1;
      while (i < length && src[i] !== ch) {
        if (src[i] === '\\') { value += src.slice(i, i + 2); i += 2; continue; }
        if (src[i] === '\n') { line += 1; }
        value += src[i];
        i += 1;
      }
      i += 1;
      push('string', value, start);
      continue;
    }
    if (ch === '`') {
      i += 1;
      scanTemplate();
      continue;
    }
    if (isIdentStart(ch)) {
      const start = i;
      while (i < length && isIdentPart(src[i])) i += 1;
      const value = src.slice(start, i);
      push(KEYWORDS.has(value) ? 'keyword' : 'ident', value, start);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next || ''))) {
      const start = i;
      while (i < length && /[0-9A-Za-z_.]/.test(src[i])) i += 1;
      push('number', src.slice(start, i), start);
      continue;
    }
    if (ch === '/' && regexAllowed()) {
      const start = i;
      i += 1;
      let inClass = false;
      while (i < length) {
        const c = src[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '\n') break;
        if (inClass) { if (c === ']') inClass = false; i += 1; continue; }
        if (c === '[') { inClass = true; i += 1; continue; }
        if (c === '/') { i += 1; break; }
        i += 1;
      }
      while (i < length && /[a-z]/.test(src[i])) i += 1;
      push('regex', src.slice(start, i), start);
      continue;
    }
    if (ch === '{') {
      braceDepth += 1;
      push('punct', '{', i);
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (templateStack.length && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        push('template-close', '}', i);
        i += 1;
        scanTemplate();
        continue;
      }
      braceDepth -= 1;
      push('punct', '}', i);
      i += 1;
      continue;
    }
    // 여러 글자 구두점. 긴 것부터 맞춘다.
    const three = src.slice(i, i + 4);
    const multi = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=',
      '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>']
      .find(op => three.startsWith(op));
    if (multi) {
      push('punct', multi, i);
      i += multi.length;
      continue;
    }
    push('punct', ch, i);
    i += 1;
  }
  return tokens;
}

// 토큰 인덱스 `openIndex` 의 여는 괄호에 맞는 닫는 괄호 인덱스. 템플릿 괄호는 punct 가 아니라 섞이지 않는다.
function matchingClose(tokens, openIndex) {
  const open = tokens[openIndex].value;
  const close = open === '{' ? '}' : open === '(' ? ')' : ']';
  let depth = 0;
  for (let k = openIndex; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type !== 'punct') continue;
    if (token.value === open) depth += 1;
    else if (token.value === close) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

// 최상위(중괄호 깊이 0) 함수 선언 목록. { name, index(function 키워드), bodyStart, bodyEnd, line }
function topLevelFunctionDeclarations(tokens) {
  const result = [];
  let depth = 0;
  let parenDepth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === 'punct') {
      if (token.value === '{') depth += 1;
      else if (token.value === '}') depth -= 1;
      else if (token.value === '(') parenDepth += 1;
      else if (token.value === ')') parenDepth -= 1;
      continue;
    }
    if (depth !== 0 || parenDepth !== 0) continue;
    if (token.type !== 'keyword' || token.value !== 'function') continue;
    // `export default function`, `async function` 도 선언이다. `= function` / `(function` 은 식이다.
    const prev = tokens[k - 1];
    if (prev && prev.type === 'punct' && prev.value !== ';' && prev.value !== '}') continue;
    let nameIndex = k + 1;
    if (tokens[nameIndex]?.type === 'punct' && tokens[nameIndex].value === '*') nameIndex += 1;
    const nameToken = tokens[nameIndex];
    if (!nameToken || nameToken.type !== 'ident') continue;
    let paren = nameIndex + 1;
    if (tokens[paren]?.value !== '(') continue;
    const parenClose = matchingClose(tokens, paren);
    if (parenClose < 0) continue;
    const bodyStart = parenClose + 1;
    if (tokens[bodyStart]?.value !== '{') continue;
    const bodyEnd = matchingClose(tokens, bodyStart);
    if (bodyEnd < 0) continue;
    result.push({
      name: nameToken.value,
      index: k,
      nameIndex,
      paramsStart: paren,
      paramsEnd: parenClose,
      bodyStart,
      bodyEnd,
      line: token.line,
      async: prev?.type === 'keyword' && prev.value === 'async',
    });
    k = bodyEnd;
    depth = 0;
  }
  return result;
}

// 최상위 let/const/var/class 선언 이름. { name, kind, index, line }
function topLevelBindingDeclarations(tokens) {
  const result = [];
  let depth = 0;
  let parenDepth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type === 'punct') {
      if (token.value === '{') depth += 1;
      else if (token.value === '}') depth -= 1;
      else if (token.value === '(') parenDepth += 1;
      else if (token.value === ')') parenDepth -= 1;
      continue;
    }
    if (depth !== 0 || parenDepth !== 0 || token.type !== 'keyword') continue;
    if (token.value === 'class') {
      const nameToken = tokens[k + 1];
      if (nameToken?.type === 'ident') result.push({ name: nameToken.value, kind: 'class', index: k, line: token.line });
      continue;
    }
    if (token.value !== 'let' && token.value !== 'const' && token.value !== 'var') continue;
    for (const name of bindingPatternNames(tokens, k + 1)) {
      result.push({ name, kind: token.value, index: k, line: token.line });
    }
  }
  return result;
}

// `let a = 1, { b, c: d } = x, [e] = y;` 에서 a, b, d, e 를 뽑는다.
// 구조 분해의 키(`c`)는 바인딩이 아니므로 뺀다. 초기화 식(`= ...`)은 건너뛴다.
function bindingPatternNames(tokens, startIndex) {
  const names = [];
  let k = startIndex;
  const readPattern = () => {
    const token = tokens[k];
    if (!token) return;
    if (token.type === 'ident') { names.push(token.value); k += 1; return; }
    if (token.type !== 'punct' || (token.value !== '{' && token.value !== '[')) return;
    const close = matchingClose(tokens, k);
    const isObject = token.value === '{';
    k += 1;
    while (k < close) {
      const current = tokens[k];
      if (current.type === 'punct' && current.value === '...') { k += 1; continue; }
      if (current.type === 'punct' && current.value === ',') { k += 1; continue; }
      if (isObject) {
        const after = tokens[k + 1];
        if (after?.type === 'punct' && after.value === ':') {
          k += 2;
          readPattern();
        } else if (current.type === 'ident') {
          names.push(current.value);
          k += 1;
        } else if (current.type === 'punct' && current.value === '[') {
          // 계산된 키 [expr]: pattern
          k = matchingClose(tokens, k) + 1;
          if (tokens[k]?.value === ':') { k += 1; readPattern(); }
        } else {
          k += 1;
        }
      } else {
        readPattern();
      }
      // 기본값 `= expr` 은 다음 콤마/닫는 괄호까지 건너뛴다.
      if (tokens[k]?.type === 'punct' && tokens[k].value === '=') {
        k = skipExpression(tokens, k + 1, close);
      }
    }
    k = close + 1;
  };
  for (;;) {
    readPattern();
    if (tokens[k]?.type === 'punct' && tokens[k].value === '=') {
      k = skipExpression(tokens, k + 1);
    }
    if (tokens[k]?.type === 'punct' && tokens[k].value === ',') { k += 1; continue; }
    break;
  }
  return names;
}

// index 부터 같은 깊이의 `,` `;` 또는 limit(닫는 괄호) 직전까지 건너뛴다.
function skipExpression(tokens, index, limit = tokens.length) {
  let k = index;
  let depth = 0;
  while (k < limit) {
    const token = tokens[k];
    if (token.type === 'punct') {
      if (token.value === '(' || token.value === '[' || token.value === '{') depth += 1;
      else if (token.value === ')' || token.value === ']' || token.value === '}') {
        if (depth === 0) return k;
        depth -= 1;
      } else if (depth === 0 && (token.value === ',' || token.value === ';')) return k;
    }
    k += 1;
  }
  return k;
}

module.exports = {
  KEYWORDS,
  tokenize,
  matchingClose,
  topLevelFunctionDeclarations,
  topLevelBindingDeclarations,
  bindingPatternNames,
  skipExpression,
};
