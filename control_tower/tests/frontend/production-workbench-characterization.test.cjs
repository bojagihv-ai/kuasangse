const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const HTML = path.resolve(__dirname, '../../frontend/control-tower.html');

test('PIN regression: static demo surface markers stay removed', () => {
  const html = fs.readFileSync(HTML, 'utf8');

  assert.doesNotMatch(html, /제품 A · 대표 이미지 검수/);
  assert.doesNotMatch(html, /제품 B · 자동 진행/);
  assert.doesNotMatch(html, /job-demo/);
  assert.doesNotMatch(html, /product-demo/);
  assert.doesNotMatch(html, /실제 SSE 연결 전에는 예시 상태로 표시됩니다/);
  assert.doesNotMatch(html, /src=["'][^"']*\/content(?:\/|["'])/);
});
