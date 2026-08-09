'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');

function currentProductImagePayloadSource() {
  const start = CORE.indexOf('function currentProductImagePayload(');
  const end = CORE.indexOf('\nfunction syncProductImageAcrossWorkspaces(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return CORE.slice(start, end);
}

function createContext(factoryProduct) {
  const context = vm.createContext({
    state: {
      imageBase64: 'red-stale-app-image',
      imageMime: 'image/png',
      imagePreview: 'data:image/png;base64,red-stale-app-image',
      imageName: '이전 작업 이미지',
      analysisImages: [],
      cuts: {},
    },
    factoryRuntimeReadFactory: () => ({ product: factoryProduct }),
    factoryNormalizeIdentityText: value => String(value || '').trim().toLowerCase(),
    factoryImageRecordCompatibleWithCurrentProduct: () => true,
    factoryImagePayloadFromCurrentVisual: (base64, mime, preview, metadata = {}) => base64
      ? { base64, mime, preview, ...metadata }
      : null,
    inferImageMimeFromBase64: (_base64, mime) => mime,
    imageBase64Only: value => value,
    factoryFindAvailableProductImage: () => null,
  });
  vm.runInContext(
    `${currentProductImagePayloadSource()}\nthis.currentProductImagePayload = currentProductImagePayload;`,
    context,
  );
  return context;
}

test('factory 입력이 IndexedDB hydration 중이면 이전 작업의 app 이미지를 대신 채택하지 않는다', () => {
  const context = createContext({
    productName: '현재 상품',
    imageBase64: '',
    imagePreview: '__stored_in_indexeddb__',
    inputImages: [{
      name: '현재 작업 원본',
      hasImage: true,
      base64: '',
      preview: '__stored_in_indexeddb__',
    }],
  });

  const result = context.currentProductImagePayload({
    prefer: 'factory',
    factory: { product: context.factoryRuntimeReadFactory().product },
  });

  assert.equal(result, null);
});

test('factory 입력 hydration이 끝나면 현재 작업 원본을 정상 반환한다', () => {
  const context = createContext({
    productName: '현재 상품',
    inputImages: [{
      name: '현재 작업 원본',
      hasImage: true,
      base64: 'blue-current-factory-image',
      preview: 'data:image/png;base64,blue-current-factory-image',
      mime: 'image/png',
    }],
  });

  const result = context.currentProductImagePayload({
    prefer: 'factory',
    factory: { product: context.factoryRuntimeReadFactory().product },
  });

  assert.equal(result.base64, 'blue-current-factory-image');
  assert.equal(result.source, 'factory-input');
});
