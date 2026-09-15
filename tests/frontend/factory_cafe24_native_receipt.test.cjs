'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const vm = require('node:vm');
const { functionSource, readSourceLf } = require('./source_slice_utils.cjs');
const { ROOT, JOB, WORKSPACE, RUN, savedFactory, runtime } = require('./factory_cafe24_native_receipt_fixture.cjs');
const workbench = () => import(pathToFileURL(path.join(ROOT, 'control_tower/frontend/src/production-workbench.mjs')).href);

test('saved verified native receipt exposes 3024 readback as history, not current approval', async () => {
  const app = runtime(); // Given
  const before = structuredClone(app.data.factory);
  const projection = await app.project(); // When
  const { cafe24RegistrationSummary, buildWorkfilePublicationLedger } = await workbench();
  const summary = cafe24RegistrationSummary(projection.registration, projection.session);
  assert.equal(summary.registered, true); // Then
  assert.equal(summary.historical, true);
  assert.equal(summary.currentVerified, false);
  assert.equal(summary.productNo, '3024');
  assert.equal(summary.representativeImageCount, 4);
  assert.equal(summary.detailImageCount, 14);
  assert.deepEqual(summary.optionValues, ['자주', '빨강']);
  assert.equal(summary.variantCount, 2);
  assert.equal(summary.inventoryByOption.자주.quantity, '99');
  assert.equal(summary.inventoryByOption.빨강.quantity, '99');
  assert.equal(projection.registration.status, 'approval_required');
  assert.equal(projection.registration.approvalTokenState, 'missing');
  assert.equal(projection.registration.remoteReadbackDigest, '');
  assert.equal(buildWorkfilePublicationLedger(projection).publications.length, 1);
  assert.deepEqual(app.data.factory, before);
});

for (const [name, alter] of [
  ['failed', f => { f.product.cafe24RegistrationReceipt.status = 'failed'; }],
  ['mismatch', f => { f.product.cafe24RegistrationReceipt.comparisons[0].matched = false; }],
  ['empty comparisons', f => { f.product.cafe24RegistrationReceipt.comparisons = []; }],
  ['foreign job', f => { f.goalRun.jobId = 'foreign'; f.batchJobId = 'foreign'; }],
  ['foreign workspace', f => { f.product.cafe24PublicationReceipt.projectId = 'batch:foreign'; }],
  ['foreign target', f => { f.product.finalDb.product_no = '3025'; }],
  ['unbound run', f => { f.goalRun.currentRunId = 'foreign'; }],
  ['later run', f => { f.goalRun.startedAt = 1788613362000; }],
]) {
  test(`native ${name} cannot become verified registration history`, async () => {
    const f = savedFactory(); alter(f); // Given
    const projection = await runtime(f).project(); // When
    const { cafe24RegistrationSummary } = await workbench();
    assert.equal(cafe24RegistrationSummary(projection.registration, projection.session).registered, false); // Then
    assert.equal(projection.registration.approvalTokenState, 'missing');
  });
}

test('source receipt metadata binds the owned factory identity before any remote write', () => {
  const { context, data } = runtime(); // Given
  const source = readSourceLf(path.join(ROOT, 'src/app-core-05.js'));
  vm.runInContext(functionSource(source, 'factoryCafe24BuildRegistrationReceiptPreflight'), context);
  const receipt = context.factoryCafe24BuildRegistrationReceiptPreflight(data.factory, { // When
    mode: 'update', productNo: '3024', basicInfo: { productName: '전통 꽃자수 파우치' }, settings: {},
    identity: { jobId: 'forged' },
  });
  assert.equal(receipt.identity.jobId, JOB); // Then
  assert.equal(receipt.identity.workspaceId, WORKSPACE);
  assert.equal(receipt.identity.runId, RUN);
  assert.equal(receipt.identity.productKey, '전통꽃자수파우치');
  assert.equal(receipt.identity.inputFingerprint, 'fixture-input-fingerprint');
  assert.equal(receipt.identity.targetProductNo, '3024');
  assert.equal(Object.isFrozen(receipt.identity), true);
});

test('save/reload and edited current preflight retain historical readback without consuming approval', async () => {
  const app = runtime(); // Given
  const initial = await app.project();
  const { preserveCurrentProductProjection, buildWorkfilePublicationLedger } = await workbench();
  app.data.factory = JSON.parse(JSON.stringify(app.data.factory));
  app.context.factoryRuntimeInspectBatchCafe24Registration = async () => ({ status: 'blocked', reason: 'new_edit_needs_review' });
  const after = preserveCurrentProductProjection(initial, await app.project()); // When
  const history = buildWorkfilePublicationLedger(after);
  assert.equal(history.publication.productNo, '3024'); // Then
  assert.equal(history.publications.length, 1);
  assert.equal(history.publication.currentVerified, false);
  assert.equal(after.registration.status, 'blocked');
  assert.ok(after.registration.blockers.includes('new_edit_needs_review'));
  assert.equal(after.registration.approvalTokenState, 'missing');
});

test('captured receipt identity survives a new run but rejects a foreign job and remote target', async () => {
  const f = savedFactory(); // Given
  f.product.cafe24RegistrationReceipt.identity = { jobId: JOB, workspaceId: WORKSPACE,
    productKey: '전통꽃자수파우치', runId: RUN, inputFingerprint: 'registered-input', targetProductNo: '3024' };
  f.automation.currentRunId = 'edited-run';
  f.goalRun.currentRunId = 'edited-run';
  const { cafe24RegistrationSummary } = await workbench();
  const projected = await runtime(f).project(); // When
  const summary = cafe24RegistrationSummary(projected.registration, projected.session);
  assert.equal(summary.registered, true); // Then
  assert.equal(summary.currentVerified, false);
  assert.equal(summary.runId, RUN);
  for (const key of ['jobId', 'workspaceId', 'productKey', 'targetProductNo']) {
    const foreign = structuredClone(f);
    foreign.product.cafe24RegistrationReceipt.identity[key] = 'foreign';
    const next = await runtime(foreign).project();
    assert.equal(cafe24RegistrationSummary(next.registration, next.session).registered, false, key);
  }
  const foreignProjection = structuredClone(projected);
  foreignProjection.registration.jobId = 'foreign';
  assert.equal(cafe24RegistrationSummary(foreignProjection.registration, foreignProjection.session).registered, false);
});

test('a matching legacy binding cannot promote a native publication into a consumed approval', async () => {
  const f = savedFactory(); // Given
  f.product.cafe24BatchControlBinding = {
    productId: 'cafe24:3024', productKey: '전통꽃자수파우치', categoryId: '107',
    htmlDigest: 'edited-html', imageDigests: ['edited-image'],
    idempotencyKey: `cafe24-stage:v6:${WORKSPACE}:전통꽃자수파우치:edited-html:edited-image`,
    expectedWorkfileRevision: 219, expectedRunId: RUN, expectedInputFingerprint: 'fixture-input-fingerprint',
  };
  const projection = await runtime(f).project(); // When
  assert.equal(projection.registration.approvalTokenState, 'missing'); // Then
  assert.equal(projection.registration.status, 'approval_required');
  assert.equal(projection.registration.publicationReceipt.schema, 'factory-cafe24-native-registration-history:v1');
});

test('newer native readback replaces the visible receipt without losing its earlier history', async () => {
  const app = runtime(); // Given
  const before = await app.project();
  const receipt = app.data.factory.product.cafe24RegistrationReceipt;
  receipt.verifiedAt += 2000;
  receipt.detailImageCount = 15;
  receipt.readback.detailImageCount = 15;
  app.data.factory.product.cafe24PublicationReceipt.registeredAt += 2000;
  const { preserveCurrentProductProjection, buildWorkfilePublicationLedger } = await workbench();
  const merged = preserveCurrentProductProjection(before, await app.project()); // When
  const ledger = buildWorkfilePublicationLedger(merged);
  assert.equal(ledger.publication.detailImageCount, 15); // Then
  assert.equal(ledger.publications.length, 2);
  assert.equal(merged.registration.approvalTokenState, 'missing');
});

test('newer publication readback upgrades only the visible receipt and preserves the old failure record', () => {
  const source = readSourceLf(path.join(ROOT, 'src/app-core-05.js'));
  const context = vm.createContext({});
  vm.runInContext(functionSource(source, 'factoryCafe24ReceiptForDisplay'), context);
  const factory = {
    openMarketSync: { finalRegistrationUpdatedAt: 200 },
    product: {
      finalDb: { product_no: '3027' },
      cafe24RegistrationReceipt: {
        status: 'failed',
        capturedAt: 100,
        verifiedAt: 150,
        mode: 'create',
        productNo: '3027',
        comparisons: [{ label: '상세이미지', matched: true }],
        mismatches: [],
      },
      cafe24PublicationReceipt: {
        schema: 'kuasangse.cafe24-publication-receipt',
        productNo: '3027',
        registrationMode: 'update',
        registeredAt: 300,
      },
    },
  };
  const before = structuredClone(factory.product.cafe24RegistrationReceipt);
  const visible = context.factoryCafe24ReceiptForDisplay(factory);
  assert.equal(visible.status, 'verified');
  assert.equal(visible.mode, 'update');
  assert.equal(visible.verifiedAt, 300);
  assert.equal(visible.error, '');
  assert.deepEqual(factory.product.cafe24RegistrationReceipt, before);
});
