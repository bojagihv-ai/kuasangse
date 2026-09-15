const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

async function load() {
  return import(`${pathToFileURL(path.join(ROOT, 'src/menus/factory/tabs/fields-tab-render.mjs')).href}?native-intake=${Date.now()}-${Math.random()}`);
}

function summary() {
  return {
    missingRegister: [{ id: 'size' }],
    missingGenerate: [],
    autoDone: [{ label: '가로' }],
    fields: [
      { id: 'width', label: '가로', group: '상품등록 필수', required: true, status: 'done', value: '100mm', source: '직접 확인' },
      { id: 'size', label: '사이즈/규격', group: '상품등록 필수', required: true, status: 'missing', value: '10cm', draftValue: '12cm', hasDraft: true },
      { id: 'options', label: '옵션 여부', group: '생성 필수', readonly: true, status: 'pending', value: '' },
    ],
  };
}

test('original fields tab embeds the exact reusable required-fields panel with its labels and states', async () => {
  const { renderFactoryRequiredFieldsPanel, renderFieldsFactoryTab } = await load();
  const data = summary();
  const panel = renderFactoryRequiredFieldsPanel(data);
  const original = renderFieldsFactoryTab({ factory: { automation: {} }, summary: data });

  assert.ok(original.includes(panel));
  assert.match(panel, /상품등록 필수/);
  assert.match(panel, /생성 필수/);
  assert.match(panel, /✓ 확인됨/);
  assert.match(panel, /값 수정/);
  assert.match(panel, /수정 적용/);
  assert.match(panel, /옵션 없음\/있음 여부를 선택하세요/);
  assert.match(panel, /data-factory-guide-action="focus-missing-field-source"/);
});

test('reusable required-fields panel escapes a custom id and can omit the source link for an inline intake form', async () => {
  const { renderFactoryRequiredFieldsPanel } = await load();
  const panel = renderFactoryRequiredFieldsPanel(summary(), {}, {
    panelId: 'native-intake "<required>',
    showSourceLink: false,
  });

  assert.match(panel, /id="native-intake &quot;&lt;required&gt;"/);
  assert.doesNotMatch(panel, /focus-missing-field-source/);
});
