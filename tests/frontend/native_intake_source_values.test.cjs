const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');
function definition(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}

test('initial intake and original factory share required-field definitions and selected-source value rules', () => {
  const core = read('app-core-05.js');
  const sync = read('cafe24-sync.js');
  const context = vm.createContext({});
  for (const name of ['factoryAutoFieldTextValue', 'factoryAutoFieldWithUnit', 'factoryInferUsageFromSelectedProductText', 'factorySelectedProductFieldValues']) {
    vm.runInContext(definition(sync, name), context);
  }
  vm.runInContext(definition(core, 'factoryAutomationFieldReviewDefinitions'), context);
  const fields = context.factoryAutomationFieldReviewDefinitions();
  assert.deepEqual(Array.from(fields, item => item.id), ['product_name', 'sale_price', 'purchase_price', 'stock', 'size', 'width_mm', 'depth_mm', 'weight', 'material', 'usage']);
  assert.match(definition(core, 'factoryAutomationFieldReviewItems'), /factoryAutomationFieldReviewDefinitions\(\)/);
  assert.match(definition(sync, 'factoryAutofillRequiredFieldsFromSelectedProduct'), /factorySelectedProductFieldValues\(/);
  const values = context.factorySelectedProductFieldValues({ productName: '입력 제품', selectedText: '입력 제품',
    confirmedDb: { sale_price: 2000, purchase_price: 1000, stock_qty: 99, size: '15x8cm', spec: { width_mm: 150, depth_mm: 80 }, material_summary: '색동원단', recommended_use: '동전 보관' } });
  assert.equal(values.product_name, '입력 제품');
  assert.equal(values.sale_price, '2000');
  assert.equal(values.width_mm, '150');
  assert.equal(values.depth_mm, '80');
  assert.equal(values.material, '색동원단');
  assert.equal(values.usage, '동전 보관');
  assert.equal(values.weight, '', 'missing weight must not use another open job');
  const cafe = context.factorySelectedProductFieldValues({ productName: '다른 입력', selectedText: '다른 입력',
    cafe24Raw: { price: '5000', product_material: '면', product_weight: '13' },
    cafe24Value: key => key === 'size' ? '20x10cm' : '' });
  assert.equal(cafe.sale_price, '5000');
  assert.equal(cafe.size, '20x10cm');
  assert.equal(cafe.weight, '13g');
  assert.equal(cafe.usage, '');
});
