'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SYNC = path.join(ROOT, 'src', 'cafe24-sync.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reviewIdentity(scopeKey = 'workspace-a::product-a::candidate-review') {
  return {
    reviewProductScopeKey: scopeKey,
    reviewProductIdentityKey: `${scopeKey.replace('::candidate-review', '')}::run-a::image-a::candidate-review`,
  };
}

function makeCandidate(type, key, name, scopeKey) {
  const review = reviewIdentity(scopeKey);
  return type === 'cafe24'
    ? {
      product_no: key,
      product_name: name,
      raw: { product_no: key, product_name: name },
      ...review,
    }
    : {
      jcode: key,
      product_name: name,
      ...review,
    };
}

function createHarness(type, options = {}) {
  const source = fs.readFileSync(SYNC, 'utf8');
  const applyStart = source.indexOf('async function factoryApplyDbCandidateFromReview(');
  const helperStart = source.indexOf('function factoryCaptureCandidateReviewRequestIdentity(');
  const end = source.indexOf('\nfunction factoryConfirmNoDbCandidate', applyStart);
  assert.notEqual(applyStart, -1, 'missing candidate apply functions');
  assert.notEqual(end, -1, 'missing candidate apply function end');
  const executable = `${source.slice(helperStart >= 0 ? helperStart : applyStart, end)}\nthis.applyDb = factoryApplyDbCandidateFromReview;\nthis.applyCafe24 = factoryApplyCafe24CandidateFromReview;`;

  const scope = 'workspace-a::product-a::candidate-review';
  const first = makeCandidate(type, type === 'cafe24' ? 'cafe-a' : 'db-a', type === 'cafe24' ? '방울수저집 청홍' : '신화 A', scope);
  const second = makeCandidate(type, type === 'cafe24' ? 'cafe-b' : 'db-b', type === 'cafe24' ? '나비수저집 부채집...' : '신화 B', scope);
  let currentScopeKey = scope;
  let snapshot = {
    workspace: { id: 'workspace-a' },
    product: {
      productName: '상품 A',
      currentRunId: 'run-a',
      inputImageFingerprint: 'image-a',
      ...(type === 'cafe24'
        ? { pendingCafe24Candidates: [first, second], cafe24Candidates: [] }
        : { pendingDbCandidates: [first, second], dbCandidates: [] }),
      selectedDbCandidateKey: '',
      selectedCafe24CandidateKey: '',
      dbCandidateResolution: '',
      cafe24CandidateResolution: '',
      confirmedDb: null,
      dbLocked: false,
      finalDb: {},
    },
  };
  let activeLease = options.activeLease !== false;
  let activeLeaseKey = activeLease ? 'factory/runDb' : '';
  const immediateSelection = options.immediateSelection !== false;
  const queued = [];
  const commits = [];
  const savedFactories = [];
  let renderCount = 0;
  let cafeDetailFetches = 0;
  let resolveCafeDetail = null;
  const cafeDetailPromise = options.deferCafeDetail
    ? new Promise(resolve => { resolveCafeDetail = resolve; })
    : Promise.resolve(null);
  let sinhwaDetailFetches = 0;
  let resolveSinhwaDetail = null;
  const sinhwaDetailPromise = options.deferSinhwaDetail
    ? new Promise(resolve => { resolveSinhwaDetail = resolve; })
    : Promise.resolve(null);
  let resolveSave = null;
  const savePromise = options.deferSave
    ? new Promise(resolve => { resolveSave = resolve; })
    : Promise.resolve([]);
  let revision = 0;
  let bridgeCalls = 0;
  let operationLeaseCalls = 0;

  const keyFor = candidate => type === 'cafe24'
    ? String(candidate?.product_no || candidate?.raw?.product_no || candidate?.product_code || candidate?.product_name || '').trim()
    : String(candidate?.jcode || candidate?.id || candidate?.product_name || candidate?.jname || '').trim();
  const scopeFor = factory => currentScopeKey || String(factory?.product?.reviewProductScopeKey || '').trim();
  const commit = mutator => {
    const startingRevision = revision;
    const draft = clone(snapshot);
    let result;
    try {
      result = mutator(draft);
    } catch (error) {
      return Promise.reject(error);
    }
    const finish = value => {
      if (options.rejectStaleAsync && revision !== startingRevision) {
        throw new Error(`STALE_FACTORY_STORE_REVISION: expected ${startingRevision}, current ${revision}`);
      }
      snapshot = draft;
      revision += 1;
      commits.push(value);
      return { snapshot: { factory: draft }, result: value, assignments: [] };
    };
    return result && typeof result.then === 'function'
      ? Promise.resolve(result).then(finish)
      : Promise.resolve(finish(result));
  };

  const context = vm.createContext({
    console,
    state: { productName: '상품 A' },
    CAFE24_CONTROL_API: { defaultMallId: 'mall-a' },
    factoryRuntimeReadFactory: () => snapshot,
    factoryRuntimeHasForeignOperationLease: operationKey => immediateSelection
      && activeLease
      && activeLeaseKey !== operationKey,
    factoryRuntimeBridgeAction: options.bridgeAvailable === false
      ? undefined
      : function factoryRuntimeBridgeAction(_actionName, _operationContext, execute, bridgeOptions = {}) {
        bridgeCalls += 1;
        return commit(execute).then(receipt => {
          if (bridgeOptions.render !== false) renderCount += 1;
          return {
            operationToken: null,
            value: receipt.result,
            assignments: receipt.assignments || [],
          };
        });
      },
    factoryRuntimeWithOperationLease(operationKey, operationContext, execute) {
      operationLeaseCalls += 1;
      const queueWhenBusy = operationContext?.queueWhenBusy === true;
      if (activeLease) {
        const duplicateLease = activeLeaseKey === operationKey
          || queued.some(item => item.kind === 'lease' && item.operationKey === operationKey);
        if (!queueWhenBusy || duplicateLease) return false;
        return new Promise((resolve, reject) => queued.push({
          kind: 'lease', operationKey, execute, resolve, reject,
        }));
      }
      activeLease = true;
      activeLeaseKey = operationKey;
      try {
        return Promise.resolve(execute({ operationToken: null, operationSignal: null }))
          .finally(() => {
            activeLease = false;
            activeLeaseKey = '';
          });
      } catch (error) {
        activeLease = false;
        activeLeaseKey = '';
        throw error;
      }
    },
    factoryRuntimeUpdateOwnedFactory(commandName, owner, mutator) {
      assert.equal(owner, 'cafe24');
      if (activeLease) {
        return new Promise((resolve, reject) => queued.push({ commandName, mutator, resolve, reject }));
      }
      return commit(mutator);
    },
    factoryRuntimeUpdateOwnedFactoryDuringLease(commandName, owner, mutator) {
      assert.equal(owner, 'cafe24');
      return commit(mutator);
    },
    factoryCaptureLockedProductName: factory => factory.product.productName,
    factoryCandidateReviewScopeKey: () => scopeFor(snapshot),
    factoryCandidateReviewScopeKeyFromCandidate: candidate => String(candidate?.reviewProductScopeKey || '').trim(),
    factoryCandidateReviewIdentityKey: factory => `${scopeFor(factory).replace('::candidate-review', '')}::run-a::image-a::candidate-review`,
    factoryCandidateReviewCanApply: (candidate, factory) => {
      const candidateScope = String(candidate?.reviewProductScopeKey || '').trim();
      return !candidateScope || candidateScope === scopeFor(factory);
    },
    factoryBlockCandidateReviewSelection(factory, sourceLabel) {
      factory.product.candidateReviewStatus = `${sourceLabel} 후보 선택 확인이 필요합니다.`;
      return false;
    },
    factorySinhwaCandidateKey: keyFor,
    factoryCafe24CandidateKey: keyFor,
    factoryCafe24CandidateProductNo: candidate => String(candidate?.product_no || candidate?.raw?.product_no || '').trim(),
    cafe24ProductKey: keyFor,
    parseCafe24Raw: candidate => candidate?.raw || candidate || {},
    factoryCandidateName: candidate => candidate?.product_name || '',
    cloneData: clone,
    fetchSinhwaProductDetail: async () => {
      sinhwaDetailFetches += 1;
      return sinhwaDetailPromise;
    },
    normalizeSinhwaDbMatch: candidate => ({ ...candidate }),
    fetchCafe24ProductFullByNo: async () => {
      cafeDetailFetches += 1;
      return cafeDetailPromise;
    },
    normalizeCafe24ProductCandidate: detail => ({ ...detail }),
    factoryMergeCafe24CandidateData: (current, incoming) => ({ ...incoming, ...current }),
    factoryResetCafe24DraftsForProduct() {},
    factoryDedupeSinhwaCandidates: values => values,
    factoryMergeCafe24Candidates: (_existing, incoming) => incoming,
    factoryClearProductScopedDbManualFields() {},
    applySinhwaDbMatch() {},
    factoryUpdateFinalDbFromFields() {},
    factoryRestoreLockedProductName() {},
    factorySyncAutomationOptionModeFromDbSources() {},
    factoryEnableCafe24CoreDbFields: () => 0,
    factoryAutofillRequiredFieldsFromSelectedProduct: () => 0,
    factoryUpdateCandidateReviewStageStatus() {},
    factoryScheduleSizeCutAfterCandidateConfirm() {},
    factorySetStageStatus() {},
    factoryLog() {},
    saveLastWorkNow: saveOptions => {
      savedFactories.push(clone(saveOptions?.factory || null));
      return savePromise;
    },
    render() {
      renderCount += 1;
    },
  });
  vm.runInContext(executable, context);

  return {
    first,
    second,
    snapshot: () => snapshot,
    commits,
    apply(index, applyOptions = {}) {
      return type === 'cafe24'
        ? context.applyCafe24(index, applyOptions)
        : context.applyDb(index, applyOptions);
    },
    reorder() {
      const listKey = type === 'cafe24' ? 'pendingCafe24Candidates' : 'pendingDbCandidates';
      snapshot = { ...snapshot, product: { ...snapshot.product, [listKey]: [second, first] } };
    },
    removeFirst() {
      const listKey = type === 'cafe24' ? 'pendingCafe24Candidates' : 'pendingDbCandidates';
      snapshot = { ...snapshot, product: { ...snapshot.product, [listKey]: [second] } };
    },
    switchScope() {
      currentScopeKey = 'workspace-b::product-b::candidate-review';
      snapshot = { ...snapshot, workspace: { id: 'workspace-b' } };
    },
    async drain() {
      activeLease = false;
      activeLeaseKey = '';
      const item = queued.shift();
      assert.ok(item, 'candidate apply should be queued while the one-click lease is active');
      try {
        if (item.kind === 'lease') {
          activeLease = true;
          activeLeaseKey = item.operationKey;
          item.resolve(await item.execute({ operationToken: null, operationSignal: null }));
          activeLease = false;
          activeLeaseKey = '';
        } else {
          item.resolve(await commit(item.mutator));
        }
      } catch (error) {
        activeLease = false;
        activeLeaseKey = '';
        item.reject(error);
      }
      await Promise.resolve();
    },
    resolveCafeDetail(value = null) {
      resolveCafeDetail?.(value);
    },
    resolveSinhwaDetail(value = null) {
      resolveSinhwaDetail?.(value);
    },
    advanceBackground() {
      snapshot = {
        ...snapshot,
        automation: {
          ...(snapshot.automation || {}),
          backgroundHeartbeatAt: Date.now(),
        },
      };
      revision += 1;
    },
    resolveSave() {
      resolveSave?.([]);
    },
    renderCount: () => renderCount,
    cafeDetailFetches: () => cafeDetailFetches,
    sinhwaDetailFetches: () => sinhwaDetailFetches,
    savedFactories: () => savedFactories,
    bridgeCalls: () => bridgeCalls,
    operationLeaseCalls: () => operationLeaseCalls,
  };
}

test('Cafe24 lease fallback keeps the request-time product when bridge support is unavailable', async () => {
  const harness = createHarness('cafe24', { immediateSelection: false, bridgeAvailable: false });
  const result = harness.apply(0);
  harness.reorder();
  await harness.drain();

  assert.equal(await result, true);
  assert.equal(harness.snapshot().product.selectedCafe24CandidateKey, 'cafe-a');
  assert.equal(harness.snapshot().product.cafe24Candidates[0].product_name, '방울수저집 청홍');
  assert.equal(harness.snapshot().product.cafe24Candidates.some(candidate => candidate.product_no === 'cafe-b'), true);
});

test('Cafe24 candidate is rendered and durably saved before the optional detail lookup finishes', async () => {
  const harness = createHarness('cafe24', { activeLease: false, deferCafeDetail: true, deferSave: true });
  const result = harness.apply(0);

  await new Promise(resolve => setImmediate(resolve));
  const selectedBeforeDetail = harness.snapshot().product.selectedCafe24CandidateKey;
  assert.ok(harness.renderCount() > 0, 'the selected state must render before persistence or detail lookup can delay it');
  assert.equal(harness.cafeDetailFetches(), 0, 'the detail lookup must wait until the selected state is durably saved');
  assert.equal(
    harness.savedFactories()[0]?.product?.selectedCafe24CandidateKey,
    'cafe-a',
    'persistence must receive the exact committed selection snapshot instead of a racing global snapshot',
  );
  harness.resolveSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.cafeDetailFetches(), 1);
  harness.resolveCafeDetail(null);
  assert.equal(await result, true);

  assert.equal(
    selectedBeforeDetail,
    'cafe-a',
    'the Cafe24 confirmation must persist immediately instead of looking unresponsive while detail lookup waits',
  );
});

test('ordinary candidate clicks use the immediate bridge path rather than a lease round-trip', async () => {
  for (const type of ['cafe24', 'sinhwa']) {
    const harness = createHarness(type, { activeLease: false });
    const result = harness.apply(0);

    assert.equal(await result, true);
    assert.equal(harness.operationLeaseCalls(), 0, `${type} direct click must not wait behind a lease path`);
    assert.ok(harness.bridgeCalls() >= 1, `${type} direct click must commit through the immediate bridge`);
    assert.equal(
      type === 'cafe24'
        ? harness.snapshot().product.selectedCafe24CandidateKey
        : harness.snapshot().product.selectedDbCandidateKey,
      type === 'cafe24' ? 'cafe-a' : 'db-a',
    );
  }
});

test('factory tab candidate commands can retain the final runtime receipt after committing', async () => {
  for (const type of ['cafe24', 'sinhwa']) {
    const harness = createHarness(type, { activeLease: false });
    const receipt = await harness.apply(0, { returnReceipt: true });

    assert.equal(typeof receipt, 'object', `${type} must return a runtime receipt to the tab contract`);
    assert.equal(receipt.value, true);
    assert.ok(Object.hasOwn(receipt, 'operationToken'));
    assert.equal(
      type === 'cafe24'
        ? harness.snapshot().product.selectedCafe24CandidateKey
        : harness.snapshot().product.selectedDbCandidateKey,
      type === 'cafe24' ? 'cafe-a' : 'db-a',
    );
  }
});

test('DB lease fallback keeps the request-time jcode when bridge support is unavailable', async () => {
  const harness = createHarness('sinhwa', { immediateSelection: false, bridgeAvailable: false });
  const result = harness.apply(0);
  harness.reorder();
  await harness.drain();

  assert.equal(await result, true);
  assert.equal(harness.snapshot().product.selectedDbCandidateKey, 'db-a');
  assert.equal(harness.snapshot().product.dbCandidates[0].jcode, 'db-a');
  assert.equal(harness.snapshot().product.dbCandidates.some(candidate => candidate.jcode === 'db-b'), true);
});

test('candidate confirmation commits visibly while an unrelated long-running lease is active', async () => {
  for (const type of ['cafe24', 'sinhwa']) {
    const harness = createHarness(type);
    const result = harness.apply(0);

    await new Promise(resolve => setImmediate(resolve));
    assert.equal(
      type === 'cafe24'
        ? harness.snapshot().product.selectedCafe24CandidateKey
        : harness.snapshot().product.selectedDbCandidateKey,
      type === 'cafe24' ? 'cafe-a' : 'db-a',
      `${type} selection must not hide behind an unrelated factory lease`,
    );
    assert.ok(harness.renderCount() > 0, `${type} selection must render immediately`);
    assert.equal(await result, true);
  }
});

test('DB candidate selection commits immediately and survives a background revision during detail lookup', async () => {
  const harness = createHarness('sinhwa', {
    activeLease: false,
    deferSinhwaDetail: true,
    rejectStaleAsync: true,
  });
  const result = harness.apply(0);

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(
    harness.snapshot().product.selectedDbCandidateKey,
    'db-a',
    'the visible DB selection must commit before the optional detail request can be delayed',
  );
  assert.ok(harness.renderCount() > 0, 'the selected button state must render immediately');
  assert.equal(harness.sinhwaDetailFetches(), 1);

  harness.advanceBackground();
  harness.resolveSinhwaDetail(null);

  assert.equal(await result, true);
  assert.equal(harness.snapshot().product.selectedDbCandidateKey, 'db-a');
  assert.equal(harness.snapshot().product.dbLocked, true);
});

test('candidate selection commits synchronously before a same-tick background progress revision', async () => {
  for (const type of ['sinhwa', 'cafe24']) {
    const harness = createHarness(type, {
      activeLease: false,
      rejectStaleAsync: true,
    });
    const result = harness.apply(0);

    harness.advanceBackground();

    assert.equal(await result, true, `${type} candidate click must not lose to a same-tick progress commit`);
    assert.equal(
      type === 'cafe24'
        ? harness.snapshot().product.selectedCafe24CandidateKey
        : harness.snapshot().product.selectedDbCandidateKey,
      type === 'cafe24' ? 'cafe-a' : 'db-a',
    );
  }
});

test('candidate review stamping uses the owned draft scope instead of a stale global snapshot', () => {
  const source = fs.readFileSync(SYNC, 'utf8');
  const start = source.indexOf('function factorySlimReviewCandidateList(');
  const end = source.indexOf('\nfunction factoryCandidateReviewScope(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const context = vm.createContext({
    factoryDedupeSinhwaCandidates: values => values,
    factoryDedupeCafe24Candidates: values => values,
    factorySlimSinhwaReviewCandidate: value => value,
    factorySlimCafe24ReviewCandidate: value => value,
    factoryRuntimeReadFactory: () => ({ workspace: { id: 'workspace-old' }, product: { productName: '이전 상품' } }),
    factoryCandidateReviewScopeKey: factory => `${factory.workspace.id}::${factory.product.productName}::candidate-review`,
    factoryCandidateReviewIdentityKey: factory => `${factory.workspace.id}::run::${factory.product.productName}::image::candidate-review`,
    factoryCandidateReviewProductName: factory => factory.product.productName,
  });
  vm.runInContext(`${source.slice(start, end)}\nthis.slim = factorySlimReviewCandidateList;`, context);

  const ownedDraft = { workspace: { id: 'workspace-current' }, product: { productName: '현재 상품' } };
  const [candidate] = context.slim([{ jcode: 'db-a' }], 'sinhwa', 20, ownedDraft);

  assert.equal(candidate.reviewProductScopeKey, 'workspace-current::현재 상품::candidate-review');
  assert.equal(candidate.reviewProductName, '현재 상품');
});

test('Cafe24 lease fallback fails closed when the requested product disappears', async () => {
  const harness = createHarness('cafe24', { immediateSelection: false, bridgeAvailable: false });
  const result = harness.apply(0);
  harness.removeFirst();
  await harness.drain();

  assert.equal(await result, false);
  assert.equal(harness.snapshot().product.selectedCafe24CandidateKey, '');
  assert.match(harness.snapshot().product.candidateReviewStatus, /확인이 필요합니다/);
});

test('Cafe24 lease fallback fails closed when the review scope changes', async () => {
  const harness = createHarness('cafe24', { immediateSelection: false, bridgeAvailable: false });
  const result = harness.apply(0);
  harness.switchScope();
  await harness.drain();

  assert.equal(await result, false);
  assert.equal(harness.snapshot().product.selectedCafe24CandidateKey, '');
  assert.match(harness.snapshot().product.candidateReviewStatus, /확인이 필요합니다/);
});

test('DB lease fallback fails closed when the requested product disappears', async () => {
  const harness = createHarness('sinhwa', { immediateSelection: false, bridgeAvailable: false });
  const result = harness.apply(0);
  harness.removeFirst();
  await harness.drain();

  assert.equal(await result, false);
  assert.equal(harness.snapshot().product.selectedDbCandidateKey, '');
  assert.match(harness.snapshot().product.candidateReviewStatus, /확인이 필요합니다/);
});

test('DB lease fallback fails closed when the review scope changes', async () => {
  const harness = createHarness('sinhwa', { immediateSelection: false, bridgeAvailable: false });
  const result = harness.apply(0);
  harness.switchScope();
  await harness.drain();

  assert.equal(await result, false);
  assert.equal(harness.snapshot().product.selectedDbCandidateKey, '');
  assert.match(harness.snapshot().product.candidateReviewStatus, /확인이 필요합니다/);
});
