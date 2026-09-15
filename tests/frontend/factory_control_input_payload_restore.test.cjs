'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../src/app-core-03.js'), 'utf8');

function restoreContext(optionImages) {
  const start = source.indexOf('function factoryRuntimeControlRestoreInputPayloads(');
  const end = source.indexOf('\nfunction factoryRuntimeControlProvidedColorOptionValues(', start);
  assert.ok(start >= 0 && end > start, 'same-job resume must restore matched input payloads');
  const context = vm.createContext({
    state: { optionSorter: { images: optionImages } },
    factoryImagePayloadFingerprint: value => `fingerprint:${value}`,
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.restore = factoryRuntimeControlRestoreInputPayloads;`, context);
  return context;
}

test('resume restores exact input bytes without changing color IDs, slots, or selected outputs', () => {
  const placeholder = { id: 'color-purple', inputImageFingerprint: 'fingerprint:cHVycGxl', base64: null, preview: '__stored_in_indexeddb__' };
  const sorterImage = { ...placeholder, name: '자주', factoryColorImageId: placeholder.id };
  const factory = { product: { colorImages: [placeholder], inputImages: [] }, assets: [{ id: 'selected-hero', used: true }] };
  const context = restoreContext([sorterImage]);
  const inputs = [{ role: 'color-option', base64: 'cHVycGxl', mime: 'image/png', preview: 'data:image/png;base64,cHVycGxl' }];
  context.restore(factory, inputs);
  assert.equal(placeholder.base64, 'cHVycGxl');
  assert.equal(sorterImage.preview, inputs[0].preview);
  assert.equal(sorterImage.id, 'color-purple');
  assert.equal(sorterImage.name, '자주');
  assert.deepEqual(factory.assets, [{ id: 'selected-hero', used: true }]);
  assert.equal(factory.product.colorImages.length, 1);
});

test('resume preserves usable images and never fills unmatched records by name or position', () => {
  const usable = { id: 'a', sourceImageKey: 'fingerprint:cHVycGxl', base64: 'original-bytes', preview: 'data:image/png;base64,original-bytes' };
  const foreign = { id: 'b', name: '자주', sourceImageKey: 'other-work', preview: '__stored_in_indexeddb__' };
  const unknown = { id: 'c', name: '자주', preview: '__stored_in_indexeddb__' };
  const before = structuredClone([usable, foreign, unknown]);
  const context = restoreContext([foreign]);
  context.restore({ product: { colorImages: [usable, unknown] } }, [{ role: 'color-option', base64: 'cHVycGxl', mime: 'image/png', preview: 'data:image/png;base64,cHVycGxl' }]);
  assert.deepEqual([usable, foreign, unknown], before);
});
