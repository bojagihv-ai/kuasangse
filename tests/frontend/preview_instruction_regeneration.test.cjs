const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

test('지시문 반영 재생성 버튼이 편집 패널의 인라인 전파 차단에 막히지 않는다', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
  const start = source.indexOf('function renderPreviewEditPanel');
  const end = source.indexOf('\nfunction renderToneQuickPanel', start);
  assert.ok(start >= 0 && end > start, 'renderPreviewEditPanel source must be present');
  const panelSource = source.slice(start, end);

  assert.doesNotMatch(
    panelSource,
    /class="edit-panel"[^>]*onclick="event\.stopPropagation\(\)"/,
    'delegated preview actions cannot run when the edit panel stops click bubbling',
  );
  assert.match(panelSource, /data-apply-edit=/);
});
