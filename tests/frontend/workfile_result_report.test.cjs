const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadReportRuntime() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'workfile-result-report.js'), 'utf8');
  const context = vm.createContext({ console });
  vm.runInContext(source, context);
  return context;
}

test('작업파일 리포트는 조립공장이 멈춘 다음 단계를 표시한다', () => {
  const runtime = loadReportRuntime();
  const report = runtime.buildFactoryWorkfileResultReport({
    payload: {
      step: 'factory',
      factory: {
        activeStage: 'size',
        stages: {
          db: { status: 'done' },
          hero: { status: 'done' },
          size: { status: 'idle' },
        },
        automation: { activeTab: 'fields' },
        product: { productName: '부분 작업' },
      },
    },
    identity: { id: 'project-partial', name: '부분 작업' },
    summary: { sections: 3 },
    generatedAt: 100,
  });

  assert.equal(report.status.code, 'factory_in_progress');
  assert.equal(report.factory.lastCompletedStage.number, 2);
  assert.equal(report.factory.stoppedAtStage.number, 3);
  assert.equal(report.workfile.name, '부분 작업.kuasangse');
});

test('Cafe24 등록 완료 작업파일은 상품번호·링크·옵션 결과를 보존한다', () => {
  const runtime = loadReportRuntime();
  const report = runtime.buildFactoryWorkfileResultReport({
    payload: {
      step: 'factory',
      factory: {
        stages: {
          db: { status: 'done' },
          hero: { status: 'done' },
          size: { status: 'done' },
          options: { status: 'done' },
          cuts: { status: 'done' },
          detail: { status: 'done' },
        },
        openMarketSync: {
          finalRegistrationStatus: '최종 등록 완료: Cafe24까지만 처리했습니다.',
          finalRegistrationUpdatedAt: 200,
          cafe24RegistrationMode: 'create',
        },
        product: {
          productName: '모시바둑파우치',
          finalDb: {
            product_no: 2996,
            product_code: 'P0000ELG',
            display_status: 'F',
            selling_status: 'F',
          },
          cafe24OptionGroupsDraft: [{
            name: '색상',
            values: ['빨강', '꽃핑', '연핑'],
          }],
          cafe24Variants: [{}, {}, {}],
        },
      },
    },
    identity: { id: 'project-2996', name: '카페24 등록본' },
    summary: { sections: 15 },
    defaultMallId: 'bojagi1928',
    generatedAt: 300,
  });

  assert.equal(report.status.code, 'cafe24_registered');
  assert.equal(report.factory.stoppedAtStage.number, 7);
  assert.equal(report.cafe24.productNo, '2996');
  assert.equal(report.cafe24.optionValueCount, 3);
  assert.equal(report.cafe24.variantCount, 3);
  assert.match(report.cafe24.adminUrl, /product_no=2996$/);
  assert.match(report.cafe24.storefrontUrl, /product_no=2996$/);
});

test('Cafe24 발행 영수증은 실제 등록에 사용한 작업파일명을 고정한다', () => {
  const runtime = loadReportRuntime();
  const factory = { product: {} };
  const receipt = runtime.factoryApplyCafe24PublicationReceipt(factory, {
    productName: '모시바둑파우치',
    productNo: '2996',
    projectName: '등록 당시 작업',
    registeredAt: 400,
    cafe24Display: 'F',
    cafe24Selling: 'F',
  }, {
    mallId: 'bojagi1928',
    sourceWorkfileName: '등록 당시 작업.kuasangse',
  });

  assert.equal(factory.product.cafe24PublicationReceipt, receipt);
  assert.equal(receipt.sourceWorkfileName, '등록 당시 작업.kuasangse');
  assert.equal(receipt.productNo, '2996');
  assert.match(receipt.adminUrl, /ProductRegister\?product_no=2996$/);
});
