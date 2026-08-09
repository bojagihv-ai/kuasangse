const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const CORE_05 = path.join(ROOT, 'src', 'app-core-05.js');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function extractFunction(fileSource, functionName) {
  const start = fileSource.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `${functionName} 정의를 찾지 못했습니다.`);
  const parameterStart = fileSource.indexOf('(', start);
  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '(') parameterDepth += 1;
    if (fileSource[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parameterEnd = index;
      break;
    }
  }
  const braceStart = fileSource.indexOf('{', parameterEnd);
  let depth = 0;
  for (let index = braceStart; index < fileSource.length; index += 1) {
    if (fileSource[index] === '{') depth += 1;
    if (fileSource[index] === '}') depth -= 1;
    if (depth === 0) return fileSource.slice(start, index + 1);
  }
  throw new Error(`${functionName} 함수 경계를 찾지 못했습니다.`);
}

test('로컬 보관 대표 이미지 카드는 viewport 밖에서도 이미지 요청을 보존한다', () => {
  const renderer = extractFunction(source(CORE_05), 'renderFactoryLocalArchiveCard');

  assert.match(
    renderer,
    /renderFactoryLightImage\(imageUrl, title, 'data-factory-light-priority=.*1.*', label\)/,
    '로컬 보관 대표 이미지는 lazy 지연으로 빈 아이콘이 되지 않도록 eager 우선순위를 전달해야 합니다.',
  );
});

test('공유 이미지 렌더러는 우선순위 표식에 eager/high를 유지한다', () => {
  const renderer = extractFunction(source(CORE_05), 'renderFactoryLightImage');

  assert.match(renderer, /isPriority/);
  assert.match(renderer, /loading=\\?\"\$\{isPriority \? 'eager' : 'lazy'\}\\?\"/);
  assert.match(renderer, /fetchpriority=\\?\"\$\{isPriority \? 'high' : 'low'\}\\?\"/);
});
