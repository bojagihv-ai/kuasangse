'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const FRONTEND = path.resolve(__dirname, '../../frontend');

/**
 * 실측 2026-09-16: 커밋 3780cf6 이 control-tower.html 에 바깥 CDN 폰트
 * (cdn.jsdelivr.net/gh/orioncactus/pretendard) 를 넣었다. 이 화면은 127.0.0.1 에서만 도는
 * 작업 도구다. 인터넷이 끊기면 글자가 늦게 뜨고, workfile-tabs 검사의 "externalRequests 는
 * 비어 있어야 한다" 계약이 3건 깨졌다. 바깥 출처는 들어오지 않는다.
 */
const FILES = ['control-tower.html', 'src/bulk-intake.css'];

test('화면 자원은 바깥 출처에서 받아오지 않는다', () => {
  for (const relative of FILES) {
    const file = path.join(FRONTEND, relative);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    // 주석은 설명을 위해 도메인을 적을 수 있으므로 빼고 본다.
    const withoutComments = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = [...withoutComments.matchAll(/\b(?:href|src)\s*=\s*["']https?:\/\/([^"'/]+)/gi)]
      .map(match => match[1])
      .filter(host => !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host));
    const cssHits = [...withoutComments.matchAll(/url\(\s*["']?https?:\/\/([^"')]+)/gi)]
      .map(match => match[1].split('/')[0])
      .filter(host => !/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host));
    assert.deepEqual([...hits, ...cssHits], [], `${relative} 가 바깥 출처를 부른다`);
  }
});

test('폰트 계열은 대체 글꼴까지 명시한다 — CDN 이 없어도 글자가 깨지지 않는다', () => {
  const css = fs.readFileSync(path.join(FRONTEND, 'src', 'bulk-intake.css'), 'utf8');
  const declaration = css.match(/--font-family-sans:\s*([^;]+);/u);
  assert.ok(declaration, '--font-family-sans 선언을 찾지 못했다');
  assert.match(declaration[1], /sans-serif\s*$/u, '마지막 대체 글꼴이 없다');
});
