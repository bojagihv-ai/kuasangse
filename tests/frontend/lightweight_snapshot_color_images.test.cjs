'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(path.resolve(ROOT, 'src/app-core-03.js'), 'utf8');

/**
 * 실측 2026-09-03: 관제탑에서 사진 다섯 장(기본 1 + 색상 4)을 투입하자 저장본이 125.6MB 가
 * 되고 제품이 곧바로 factory_product_workfile_save_failed 로 차단됐다. 색상 사진이
 * base64·preview·dataUrl 세 벌로 60MB, 그 전체가 통짜 사본과 가벼운 사본 두 벌이었다.
 * 가벼운 사본은 가벼워야 한다.
 */
function loadStripper() {
  // 파일 전체는 브라우저 전역을 요구한다. 필요한 함수 둘만 떼어 돌린다.
  const start = SOURCE.indexOf('function stripFactoryImages');
  assert.ok(start > 0, 'stripFactoryImages 를 찾지 못했다');
  const end = SOURCE.indexOf('function stripFactoryCandidateRawJson');
  assert.ok(end > start, 'stripFactoryImages 의 끝을 찾지 못했다');
  const context = {
    factoryReferencedAssetIds: () => new Set(),
    factoryRecentAssetIdsByStage: () => new Set(),
    stripFactoryCandidateRawJson: value => value,
  };
  vm.createContext(context);
  vm.runInContext(`${SOURCE.slice(start, end)}\nglobalThis.__strip = stripFactoryImages;`, context);
  return context.__strip;
}

function imageRecord(name, colorName) {
  const payload = 'A'.repeat(4096);
  return {
    id: `factory_color_${name}`,
    name,
    colorName,
    color: colorName,
    mime: 'image/jpeg',
    base64: payload,
    preview: `data:image/jpeg;base64,${payload}`,
    dataUrl: `data:image/jpeg;base64,${payload}`,
    inputImageFingerprint: `fp-${name}`,
    productKey: '방울수저집',
    uploadedAt: 1_700_000_000_000,
  };
}

test('가벼운 사본은 색상 사진의 실제 데이터를 들고 가지 않는다', () => {
  const strip = loadStripper();
  const light = strip({
    product: {
      productName: '방울수저집',
      colorImages: [imageRecord('a.jpg', '남색'), imageRecord('b.jpg', '자주')],
    },
  });
  const [first] = light.product.colorImages;
  assert.equal(light.product.colorImages.length, 2);
  assert.equal(first.base64, null);
  assert.equal(first.dataUrl, null);
  assert.equal(first.preview, '__stored_in_indexeddb__');
  assert.equal(first.hasImage, true);
  const size = JSON.stringify(light).length;
  assert.ok(size < 2000, `가벼운 사본이 여전히 무겁다: ${size}자`);
});

test('색상과 신원은 남긴다 — 무엇이 어느 색이었는지 잃으면 안 된다', () => {
  const strip = loadStripper();
  const light = strip({ product: { colorImages: [imageRecord('a.jpg', '남색')] } });
  const [first] = light.product.colorImages;
  assert.equal(first.colorName, '남색');
  assert.equal(first.color, '남색');
  assert.equal(first.name, 'a.jpg');
  assert.equal(first.id, 'factory_color_a.jpg');
  assert.equal(first.inputImageFingerprint, 'fp-a.jpg');
  assert.equal(first.productKey, '방울수저집');
});

test('색상 사진이 없어도 터지지 않는다', () => {
  const strip = loadStripper();
  assert.equal(strip({ product: { productName: '색상 없음' } }).product.colorImages.length, 0);
  assert.equal(strip({}).product, undefined);
});
