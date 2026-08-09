const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CORE = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-02.js'), 'utf8');

function requiredFieldRestoreHelper() {
  const start = CORE.indexOf('const LAST_WORK_REQUIRED_FIELD_ALIASES');
  const end = CORE.indexOf('function lastWorkSnapshotScore(', start + 1);
  assert.notEqual(start, -1, 'required-field restore helpers are missing');
  assert.notEqual(end, -1, 'required-field restore helpers must precede snapshot scoring');
  const context = {};
  vm.runInNewContext(`${CORE.slice(start, end)}\nthis.restoreNeeded = lastWorkRequiredFieldRestoreNeeded;`, context);
  return context.restoreNeeded;
}

test('server restore is selected when required values exist only in the saved snapshot', () => {
  const restoreNeeded = requiredFieldRestoreHelper();
  const incoming = {
    assets: {
      factory: {
        product: {
          dbFieldSettings: {
            size: { manualValue: '가로21cm*세로14cm' },
            width_mm: { manualValue: '21cm' },
            depth_mm: { manualValue: '14cm' },
            weight: { manualValue: '1.00g' },
            material: { manualValue: '모시' },
            usage: { manualValue: '화장품용파우치,작은소품보관용' },
          },
        },
      },
    },
  };
  const emptyCurrent = { product: { dbFieldSettings: {} } };
  assert.equal(restoreNeeded(incoming, emptyCurrent, {}), true);
});

test('server restore is not forced when every required value is already present', () => {
  const restoreNeeded = requiredFieldRestoreHelper();
  const factory = {
    product: {
      dbFieldSettings: {
        size: { manualValue: '가로21cm*세로14cm' },
        width_mm: { manualValue: '21cm' },
        depth_mm: { manualValue: '14cm' },
        weight: { manualValue: '1.00g' },
        material: { manualValue: '모시' },
        usage: { manualValue: '화장품용파우치,작은소품보관용' },
      },
    },
  };
  assert.equal(restoreNeeded({ assets: { factory } }, factory, {}), false);
});
