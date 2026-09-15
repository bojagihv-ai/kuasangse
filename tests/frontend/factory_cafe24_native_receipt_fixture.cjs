'use strict';

const path = require('node:path');
const vm = require('node:vm');
const { functionSource, readSourceLf } = require('./source_slice_utils.cjs');

const ROOT = path.resolve(__dirname, '../..');
const JOB = 'factory-job-be6f0ea339d847bfb0c0467241158b05';
const WORKSPACE = `batch:${JOB}`;
const RUN = 'factory_work_run_mtnwfrlx_hxpgsm';

// Saved project: fab290f9c67ab1cf2136f9a55cf5413ef3b97bc97fb90f0d16042cf49642a2ea.
// Only registration evidence is retained; input images and unrelated state are omitted.
function savedFactory() {
  const inventory = { 자주: { quantity: '99', useInventory: 'T' }, 빨강: { quantity: '99', useInventory: 'T' } };
  return {
    workspace: { id: WORKSPACE, workfileName: '전통 꽃자수 파우치.kuasangse' },
    currentProjectId: WORKSPACE,
    batchJobId: JOB,
    goalRun: { jobId: JOB, currentRunId: RUN, startedAt: 1788613193771, running: false },
    automation: { currentRunId: RUN },
    openMarketSync: { cafe24RegistrationMode: 'update' },
    product: {
      currentProductKey: '전통꽃자수파우치', inputImageFingerprint: 'fixture-input-fingerprint',
      finalDb: { product_no: '3024', category: [{ category_no: '107' }] },
      cafe24RegistrationReceipt: {
        schema: 'kuasangse.cafe24-registration-receipt', version: 1, status: 'verified',
        capturedAt: 1788613316267, verifiedAt: 1788613361577, mode: 'update', productNo: '3024',
        productName: '전통 꽃자수 파우치', price: '4000', display: 'F', selling: 'F',
        representativeImageCount: 4, detailImageCount: 14, optionName: '색상',
        optionValues: ['자주', '빨강'], variantCount: 2, inventoryByOption: structuredClone(inventory),
        comparisons: ['상품명', '판매가', '소비자가', '공급가', '진열 상태', '판매 상태',
          '대표이미지', '상세이미지', '옵션값', '품목 수', '옵션별 재고', '필수값/사이즈', '기본/필수값 payload']
          .map(label => ({ label, matched: true })),
        mismatches: [],
        readback: { productName: '전통 꽃자수 파우치', price: '4000.00', display: 'F', selling: 'F',
          representativeImageCount: 4, detailImageCount: 14, optionValues: ['자주', '빨강'],
          variantCount: 2, inventoryByOption: structuredClone(inventory) },
      },
      cafe24PublicationReceipt: {
        schema: 'kuasangse.cafe24-publication-receipt', version: 1,
        projectId: WORKSPACE, productNo: '3024', productName: '전통 꽃자수 파우치',
        productCode: 'P0000EMI', mallId: 'bojagi1928', registeredAt: 1788613361703,
        sourceWorkfileName: '전통 꽃자수 파우치.kuasangse', variantCount: 0,
      },
    },
  };
}

function runtime(factory = savedFactory()) {
  const data = { factory };
  const context = vm.createContext({
    state: { currentProjectId: WORKSPACE },
    factoryRuntimeReadViewSnapshot: () => data,
    factoryCurrentProductKey: value => value.product.currentProductKey,
    factoryCurrentWorkflowRunId: value => value.automation.currentRunId,
    factoryCurrentInputImageFingerprint: value => value.product.inputImageFingerprint,
    factoryCafe24TargetInfo: value => ({ productNo: value.product.finalDb.product_no, mallId: 'bojagi1928' }),
    factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ scopeId: `project:${WORKSPACE}`, counter: 219 }),
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => ({ revision: 219, fence: 1 }) }),
    factoryControlPreflightCache: { read: (_key, load) => load() },
    factoryRuntimeInspectBatchCafe24Registration: async () => ({ status: 'ready',
      htmlDigest: 'edited-html', imageDigests: ['edited-image'], expectedWorkfileRevision: 219,
      optionValues: ['현재 편집 옵션'], variantCount: 1, inventoryQuantity: '7' }),
    factoryControlAssetStage: (_factory, key) => ({ key, candidates: [], selectedIds: [] }),
    factoryControlSectionStage: () => ({ key: 'sections', candidates: [], selectedIds: [] }),
    factoryProjectFileImageFingerprint: value => value,
    factoryControlProjectionSequence: 0,
    factoryControlInputGroups: () => [], factoryControlProgress: () => ({ stageKey: 'cafe24', status: 'completed' }),
    factoryRuntimeDetachedValue: value => structuredClone(value),
    fetch: () => { throw new Error('test_network_forbidden'); },
  });
  const core = readSourceLf(path.join(ROOT, 'src/app-core-03.js'));
  for (const name of ['factoryRuntimeBatchCafe24Binding', 'factoryRuntimeBatchCafe24BindingMatches', 'factoryRuntimeControlProjection']) {
    vm.runInContext(functionSource(core, name), context, { filename: `app-core-03.js#${name}` });
  }
  return { context, data, project: () => context.factoryRuntimeControlProjection() };
}

module.exports = { ROOT, JOB, WORKSPACE, RUN, savedFactory, runtime };
