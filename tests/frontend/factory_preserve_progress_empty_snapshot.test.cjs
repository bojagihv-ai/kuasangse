'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const CORE = fs.readFileSync(path.resolve(__dirname, '../../src/app-core-03.js'), 'utf8');

function loadPreserver() {
  const start = CORE.indexOf('function factoryMergeIdentityScope');
  const end = CORE.indexOf('function factoryHasMeaningfulWork', start);
  assert.ok(start >= 0 && end > start, 'factory preservation helper boundary is required');
  const context = vm.createContext({
    cloneData: value => JSON.parse(JSON.stringify(value)),
    normalizeFactoryState: value => value,
    factoryNormalizeIdentityText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    factoryIdentityKey: factory => String(factory?.product?.productKey || factory?.product?.productName || '').trim(),
    factoryHasMeaningfulWork: factory => {
      const product = factory?.product || {};
      return !!(
        String(product.productName || '').trim()
        || Object.keys(product.dbFieldSettings || {}).length
        || (Array.isArray(product.dbCandidates) && product.dbCandidates.length)
        || (Array.isArray(factory.assets) && factory.assets.length)
      );
    },
    factorySinhwaCandidateKey: candidate => candidate?.jcode || candidate?.id || '',
    factoryCafe24CandidateKey: candidate => candidate?.product_no || candidate?.id || '',
  });
  vm.runInContext(`${CORE.slice(start, end)}\nthis.preserve = factoryPreserveProgressForSameWork;`, context);
  return context.preserve;
}

test('빈 incoming factory는 같은 작업의 후보·필수값·진행률을 낮추지 않는다', () => {
  const preserve = loadPreserver();
  const current = {
    workspace: { id: 'project-pouch' },
    product: {
      productName: '모시꽃수파우치',
      productKey: '모시꽃수파우치',
      dbFieldSettings: { size: { manualValue: '가로21cm*세로14cm' } },
      dbCandidates: [{ jcode: '2589' }],
      cafe24Candidates: [{ product_no: '619' }],
    },
    stages: { db: { status: 'done' } },
    automation: { parallelProgress: { vm: { progress: 100 } } },
  };
  const restored = preserve({}, current);
  assert.deepEqual(restored, current);
  assert.deepEqual(current.product.dbCandidates, [{ jcode: '2589' }]);
});

test('identity 없는 부분 incoming은 현재 작업에 병합되고 다른 상품은 보존하지 않는다', () => {
  const preserve = loadPreserver();
  const current = {
    workspace: { id: 'project-pouch' },
    product: {
      productName: '모시꽃수파우치',
      productKey: '모시꽃수파우치',
      dbCandidates: [{ jcode: '2589' }],
      dbFieldSettings: { size: { manualValue: '가로21cm*세로14cm' } },
    },
    stages: { db: { status: 'done' } },
  };
  const partial = preserve({ product: { dbFieldSettings: { material: { manualValue: '모시' } } } }, current);
  assert.equal(partial.product.dbCandidates[0].jcode, '2589');
  assert.equal(partial.product.dbFieldSettings.size.manualValue, '가로21cm*세로14cm');
  assert.equal(partial.product.dbFieldSettings.material.manualValue, '모시');
  assert.equal(partial.stages.db.status, 'done');

  const foreign = preserve({ product: { productName: '다른상품', productKey: '다른상품' } }, current);
  assert.equal(foreign.product.productName, '다른상품');
  assert.equal(foreign.product.dbCandidates, undefined);
});

test('같은 작업 복원은 현재 수동 판매가를 오래된 양수 판매가로 바꾸지 않는다', () => {
  const preserve = loadPreserver();
  const current = {
    workspace: { id: 'project-pouch' },
    product: {
      productName: '모시꽃수파우치',
      productKey: '모시꽃수파우치',
      cafe24FinalRegistration: { price: '5000', salePrice: '5000' },
      finalDb: { sale_price: '5000' },
      dbFieldSettings: {
        sale_price: { manualValue: '5000', manualTouched: true },
      },
    },
  };
  const incoming = {
    workspace: { id: 'project-pouch' },
    product: {
      productName: '모시꽃수파우치',
      productKey: '모시꽃수파우치',
      cafe24FinalRegistration: { price: '4900', salePrice: '4900' },
      finalDb: { sale_price: '4900' },
      dbFieldSettings: {
        sale_price: { manualValue: '4900', manualTouched: false },
      },
    },
  };

  const restored = preserve(incoming, current);

  assert.equal(restored.product.dbFieldSettings.sale_price.manualValue, '5000');
  assert.equal(restored.product.finalDb.sale_price, '5000');
  assert.equal(restored.product.cafe24FinalRegistration.price, '5000');
  assert.equal(restored.product.cafe24FinalRegistration.salePrice, '5000');
});
