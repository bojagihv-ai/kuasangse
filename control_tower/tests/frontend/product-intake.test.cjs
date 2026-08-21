const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');
const HTML = path.join(ROOT, 'frontend', 'control-tower.html');
const MODULE = path.join(ROOT, 'frontend', 'src', 'product-intake.mjs');

test('product intake exposes DB selection and manual image entry without raw manifest editing', () => {
  const html = fs.readFileSync(HTML, 'utf8');

  for (const id of [
    'intake-mode-db',
    'intake-mode-manual',
    'product-search',
    'product-search-results',
    'selected-product-summary',
    'base-images',
    'color-images',
    'image-intake-list',
    'required-product-name',
    'required-category',
    'required-material',
    'required-origin',
    'required-size',
    'required-sale-price',
    'required-stock',
    'required-usage',
    'required-option-mode',
    'image-model-select',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} must be rendered`);
  }
  assert.doesNotMatch(html, /id=["']manifest-json["']/);
  assert.doesNotMatch(html, /id=["']manual-jcode["']/);
  assert.doesNotMatch(html, />full_auto</);
});

test('DB intake builds the exact immutable snapshot source contract', async () => {
  const moduleUrl = `${pathToFileURL(MODULE).href}?test=${Date.now()}-${Math.random()}`;
  const { buildDbSnapshotRequest } = await import(moduleUrl);

  assert.deepEqual(
    buildDbSnapshotRequest({
      jcode: 900001,
      batchId: 'batch-20260724',
      requestedBy: 'operator',
    }),
    {
      jcode: 900001,
      idempotencyKey: 'ui-batch-20260724-900001',
      requestedBy: 'operator',
      source: { kind: 'db-selection', selectionId: '900001' },
    },
  );
});

test('execution start locks automation policy for the factory queue without widening the PDP job contract', async () => {
  const source = fs.readFileSync(path.join(FRONTEND, 'src', 'product-intake.mjs'), 'utf8');
  const moduleUrl = `${pathToFileURL(MODULE).href}?job=${Date.now()}-${Math.random()}`;
  const { buildPdpJobRequest } = await import(moduleUrl);
  assert.match(source, /\/api\/automation\/policy\/snapshot/);
  assert.match(source, /policySnapshot/);
  assert.match(source, /control-tower:policy-locked/);
  assert.match(source, /cafe24ApprovalMode:\s*'existing_one_time_target_gate'/);
  assert.match(source, /imageModel:\s*text\(document\.getElementById\('image-model-select'\)\.value\)/);
  assert.match(source, /\/api\/factory\/jobs/);
  assert.deepEqual(buildPdpJobRequest({
    inputSnapshotId: 'snapshot-1',
    idempotencyKey: 'job-snapshot-1',
    actor: 'operator',
  }), {
    inputSnapshotId: 'snapshot-1',
    idempotencyKey: 'job-snapshot-1',
    actor: 'operator',
  });
});

test('manual image entries require one base image and keep color images optional', async () => {
  const moduleUrl = `${pathToFileURL(MODULE).href}?test=${Date.now()}-${Math.random()}`;
  const { createManualManifest, ProductIntakeError } = await import(moduleUrl);

  assert.throws(
    () => createManualManifest({ jcode: 900002, productName: '신제품', baseImages: [], colorImages: [] }),
    error => error instanceof ProductIntakeError && error.code === 'base_image_required',
  );

  const manifest = createManualManifest({
    jcode: '',
    productName: '신제품',
    category: '주방',
    requiredValues: {
      material: '스테인리스',
      originCountry: '대한민국',
      stock: '99',
      usage: '주방용',
      optionMode: 'none',
    },
    baseImages: [{ name: '정면', fileName: 'front.png', sha256: 'abc', dataUrl: 'data:image/png;base64,aGVsbG8=' }],
    colorImages: [],
  });

  assert.equal(manifest.inputImages.length, 1);
  assert.equal(manifest.inputImages[0].role, 'base');
  assert.equal(manifest.inputImages[0].dataUrl, 'data:image/png;base64,aGVsbG8=');
  assert.equal(manifest.jcode, null);
  assert.equal(manifest.requiredValues.material, '스테인리스');
  assert.equal(manifest.requiredValues.stock, '99');
  assert.equal(manifest.requiredValues.usage, '주방용');
  assert.equal(manifest.requiredValues.optionMode, 'none');

  assert.throws(
    () => createManualManifest({
      jcode: 900002,
      productName: '신제품',
      baseImages: [{ name: '정면', fileName: 'front.png', sha256: 'abc' }],
      colorImages: [{ name: '옵션', fileName: 'option.png', colorName: '', sha256: 'def' }],
    }),
    error => error instanceof ProductIntakeError && error.code === 'color_name_required',
  );
});
