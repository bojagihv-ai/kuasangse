'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const CORE = fs.readFileSync(path.join(ROOT, 'src', 'app-core-05.js'), 'utf8');
const CORE_BATCH = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
const PAYLOADS = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-payloads.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'src', 'cafe24-sync.js'), 'utf8');

function sourceFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  const start = functionStart >= 6 && source.slice(functionStart - 6, functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  assert.notEqual(start, -1, `missing ${name}`);
  // 매개변수 기본값에 `options = {}` 같은 중괄호가 있으면, '첫 ) 뒤의 첫 {' 를 찾는
  // 방식은 본문이 아니라 기본값의 중괄호를 잡아 함수를 반토막으로 잘라낸다.
  // 실제로 그렇게 깨졌다: 087da29 가 시그니처에 `options = {}` 를 추가하자
  // factoryCafe24CurrentScopedDetailHtml 추출이 'Unexpected end of input' 로 실패했다.
  // 앱 코드는 멀쩡했고 이 추출기만 취약했다. 괄호 짝을 세어 매개변수 끝을 정확히 찾는다.
  const paramsOpen = source.indexOf('(', functionStart);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsOpen; index < source.length; index += 1) {
    if (source[index] === '(') parenDepth += 1;
    else if (source[index] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { paramsEnd = index; break; }
    }
  }
  assert.notEqual(paramsEnd, -1, `unterminated params for ${name}`);
  const open = source.indexOf('{', paramsEnd);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

function compile(source, name, globals) {
  const context = vm.createContext({ Promise, TypeError, encodeURIComponent, ...globals });
  vm.runInContext(`${sourceFunction(source, name)}\nthis.target = ${name};`, context);
  return context.target;
}

test('생산관제 Cafe24 등록은 기존 상품의 모든 옵션 재고를 99로 강제 검증한다', () => {
  const batchRegistration = sourceFunction(CORE_BATCH, 'factoryRuntimeRunBatchCafe24Registration');
  const finalRegistration = sourceFunction(CORE, 'factoryRunFinalRegistration');

  assert.match(batchRegistration, /forceInventoryQuantity:\s*'99'/);
  assert.match(batchRegistration, /openMarketSync\?\.finalRegistrationStatus/);
  assert.match(batchRegistration, /factory_cafe24_registration_failed: \$\{failureReason\}/);
  assert.match(batchRegistration, /cafe24RegistrationMode = resumesCreatedProduct \|\| revisesPublishedProduct \? 'update' : 'create'/);
  assert.match(batchRegistration, /cafe24RegistrationModeUserTouched = true/);
  assert.match(finalRegistration, /factoryCafe24CreatePostSyncPlan\(factory, \{ forceInventory, forceInventoryQuantity \}\)/);
  assert.match(finalRegistration, /\['images', 'category', 'options'\]/);
  assert.match(finalRegistration, /requiredKeys:\s*requiredPresentationKeys/);
  assert.match(finalRegistration, /forceInventoryQuantity,/);
});

test('생산관제 Cafe24 등록 바인딩은 게시 계약 idempotency가 바뀌면 이전 검증 영수증을 재사용하지 않는다', () => {
  const context = vm.createContext({ JSON, Object, String, Number, Array });
  vm.runInContext(`${sourceFunction(CORE_BATCH, 'factoryRuntimeBatchCafe24Binding')}
${sourceFunction(CORE_BATCH, 'factoryRuntimeBatchCafe24BindingMatches')}
this.matches = factoryRuntimeBatchCafe24BindingMatches;`, context);
  const base = {
    productId: 'cafe24:3011',
    productKey: '방울수저집',
    categoryId: '107',
    htmlDigest: 'sha:detail',
    imageDigests: ['sha:hero', 'sha:material'],
    expectedWorkfileRevision: 22,
    expectedRunId: 'run-1',
    expectedInputFingerprint: 'fingerprint-1',
  };

  assert.equal(context.matches(
    { ...base, idempotencyKey: 'cafe24-stage:v2:old-composer' },
    { ...base, idempotencyKey: 'cafe24-stage:v6:current-composer' },
  ), false);
  assert.match(CORE_BATCH, /cafe24-stage:v6:/);
  assert.match(CORE_BATCH, /factoryProjectFileImageFingerprint\([\s\S]*preflight\.imageDigests/);
});

test('로컬 보관 대표이미지를 inline으로 복원해도 생산관제 이미지 지문은 하나로 유지한다', () => {
  const references = compile(CORE_BATCH, 'factoryRuntimeBatchImageReferences', {});
  const factory = {
    assets: [
      {
        id: 'hero-link',
        type: 'image',
        used: true,
        image: '/api/local-archive/assets/hero-archive/image',
        metadata: { localArchiveId: 'hero-archive' },
      },
      {
        id: 'hero-inline',
        type: 'image',
        used: true,
        image: 'data:image/jpeg;base64,SELECTED_HERO',
        metadata: { localArchiveId: 'hero-archive' },
      },
      {
        id: 'size-link',
        type: 'image',
        used: true,
        image: '/api/local-archive/assets/size-archive/image',
        metadata: { localArchiveId: 'size-archive' },
      },
    ],
  };

  assert.deepEqual(Array.from(references(factory)), [
    'local-archive:hero-archive',
    'local-archive:size-archive',
  ]);
});

test('신규 등록 응답에 상품번호가 없으면 로컬 캐시가 아닌 Cafe24 최신 상품을 확인한다', () => {
  const createRegistration = sourceFunction(SYNC, 'factoryCreateCafe24ProductFromFinalDb');
  assert.match(createRegistration, /created = await factoryFindLiveCafe24ProductByExactName\(/);
  assert.doesNotMatch(createRegistration, /created = await factoryFindLatestCafe24ProductByName\(/);
});

test('생산관제는 본체 생성 후 실패한 신규 상품을 찾아 새 상품을 더 만들지 않고 이어서 수정한다', async () => {
  const batch = {
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    categoryId: '107',
    htmlDigest: 'sha:full-detail',
    imageDigests: ['sha:hero'],
    expectedWorkfileRevision: 19,
    expectedRunId: 'run-1',
    expectedInputFingerprint: 'fingerprint-1',
    idempotencyKey: 'cafe24-stage:v2:current-binding',
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  };
  const factory = {
    automation: { currentRunId: 'run-1' },
    product: {
      currentProductKey: '방울수저집',
      inputImageFingerprint: 'fingerprint-1',
      cafe24ApiStatus: 'Cafe24 새 상품 #2994 본체 생성 후 후속 동기화 실패: options',
      cafe24LastSaveVerification: { productNo: '2994' },
      cafe24BatchControlBinding: { productId: 'cafe24:2994' },
      finalDb: { product_no: '2994' },
    },
    openMarketSync: {},
  };
  let targetProductNo = '2994';
  let liveLookups = 0;
  let registrationMode = '';
  const run = compile(CORE_BATCH, 'factoryRuntimeRunBatchCafe24Registration', {
    CAFE24_CONTROL_API: { defaultMallId: '1' },
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    factoryRuntimeReadViewSnapshot: () => ({ factory }),
    factoryCafe24TargetInfo: () => ({ productNo: targetProductNo }),
    factoryFindLiveCafe24ProductByExactName: async () => {
      liveLookups += 1;
      return { product_no: '3011', product_name: '방울수저집' };
    },
    parseCafe24Raw: value => value,
    factoryAttachCafe24ProductAsCurrentTarget: product => {
      targetProductNo = String(product.product_no);
      return { productNo: targetProductNo, productName: product.product_name };
    },
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => ({ revision: 19 }) }),
    factoryRuntimeBridgeAction: async (_command, context, mutate) => ({
      value: await mutate(factory),
      operationToken: context.operationToken,
    }),
    factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ counter: 19 }),
    factoryRuntimeBatchCafe24BindingMatches: () => true,
    factoryCurrentProductKey: () => '방울수저집',
    factoryCurrentWorkflowRunId: () => 'run-1',
    factoryCurrentInputImageFingerprint: () => 'fingerprint-1',
    factoryEnsureCurrentDetailHtmlAsset: () => ({ html: 'full-detail' }),
    factoryRuntimeSha256Text: async value => `sha:${value}`,
    factoryRuntimeBatchImageReferences: () => ['hero'],
    factoryEnsureOpenMarketSync: draft => draft.openMarketSync,
    factoryRuntimeBatchCafe24Binding: value => value,
    factoryApplyFinalCafe24StatusToDb() {},
    factoryRunFinalRegistration: async () => {
      registrationMode = factory.openMarketSync.cafe24RegistrationMode;
      factory.product.cafe24BatchControlBinding = { idempotencyKey: 'cafe24-stage:v1:stale-binding' };
      return true;
    },
    factoryRuntimeVerifiedCafe24Readback: async () => {
      assert.equal(factory.product.cafe24BatchControlBinding.idempotencyKey, batch.idempotencyKey);
      return { externalProductNo: targetProductNo };
    },
  });

  const result = await run({ batchControl: batch });

  assert.equal(liveLookups, 1);
  assert.equal(targetProductNo, '3011');
  assert.equal(registrationMode, 'update');
  assert.equal(result.externalProductNo, '3011');
});

test('생산관제 체크포인트 복원 뒤 mismatch 영수증의 #3011은 신규 생성하지 않고 update로 이어간다', async () => {
  const batch = {
    productId: 'cafe24:3011',
    productKey: '방울수저집',
    categoryId: '107',
    htmlDigest: 'sha:full-detail',
    imageDigests: ['sha:hero'],
    expectedWorkfileRevision: 1,
    expectedRunId: 'run-1',
    expectedInputFingerprint: 'fingerprint-1',
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  };
  const factory = {
    automation: { currentRunId: 'run-1' },
    product: {
      currentProductKey: '방울수저집',
      inputImageFingerprint: 'fingerprint-1',
      cafe24BatchControlBinding: batch,
      cafe24RegistrationReceipt: { status: 'mismatch', mode: 'update', productNo: '3011' },
      finalDb: { product_no: '3011' },
    },
    openMarketSync: {},
  };
  let registrationMode = '';
  const run = compile(CORE_BATCH, 'factoryRuntimeRunBatchCafe24Registration', {
    CAFE24_CONTROL_API: { defaultMallId: '1' },
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    factoryRuntimeReadViewSnapshot: () => ({ factory }),
    factoryCafe24TargetInfo: () => ({ productNo: '3011' }),
    factoryRuntimeRequireStore: () => ({ getOperationToken: () => ({ revision: 1 }) }),
    factoryRuntimeBridgeAction: async (_command, context, mutate) => ({
      value: await mutate(factory),
      operationToken: context.operationToken,
    }),
    factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ counter: 10 }),
    factoryRuntimeBatchCafe24BindingMatches: () => true,
    factoryCurrentProductKey: () => '방울수저집',
    factoryCurrentWorkflowRunId: () => 'run-1',
    factoryCurrentInputImageFingerprint: () => 'fingerprint-1',
    factoryEnsureCurrentDetailHtmlAsset: () => ({ html: 'full-detail' }),
    factoryRuntimeSha256Text: async value => `sha:${value}`,
    factoryRuntimeBatchImageReferences: () => ['hero'],
    factoryEnsureOpenMarketSync: draft => draft.openMarketSync,
    factoryRuntimeBatchCafe24Binding: value => value,
    factoryApplyFinalCafe24StatusToDb() {},
    factoryRunFinalRegistration: async () => {
      registrationMode = factory.openMarketSync.cafe24RegistrationMode;
      return true;
    },
    factoryRuntimeVerifiedCafe24Readback: async () => ({ externalProductNo: '3011' }),
  });

  await run({ batchControl: batch });

  assert.equal(registrationMode, 'update');
});

test('생산관제 최종 read-back은 update 영수증에 한해 승인 대상과 같은 #3011을 허용한다', async () => {
  const batch = {
    productId: 'cafe24:3011',
    productKey: '방울수저집',
    categoryId: '107',
    htmlDigest: 'sha:detail',
    imageDigests: ['sha:hero'],
    expectedWorkfileRevision: 1,
    expectedRunId: 'run-1',
    expectedInputFingerprint: 'fingerprint-1',
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  };
  const factory = {
    product: {
      cafe24BatchControlBinding: batch,
      cafe24RegistrationReceipt: { status: 'verified', mode: 'update', productNo: '3011' },
    },
  };
  const verify = compile(CORE_BATCH, 'factoryRuntimeVerifiedCafe24Readback', {
    CAFE24_CONTROL_API: { defaultMallId: '1' },
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    factoryRuntimeReadViewSnapshot: () => ({ factory }),
    factoryRuntimeBatchCafe24BindingMatches: () => true,
    factoryCafe24TargetInfo: () => ({ productNo: '3011', mallId: '1' }),
    fetchCafe24ProductFullByNo: async () => ({ raw: {
      product_no: '3011',
      product_code: 'P0000ELV',
      product_name: '방울수저집',
      display: 'F',
      selling: 'F',
      market_sync: 'F',
      description: 'detail',
      detail_image: 'hero',
      category: [{ category_no: '107' }],
    } }),
    parseCafe24Raw: value => value.raw,
    factoryRuntimeSha256Text: async value => `sha:${value}`,
    factoryCafe24CategoryNoSet: () => new Set(['107']),
  });

  const result = await verify(batch);

  assert.equal(result.status, 'staged_verified');
  assert.equal(result.externalProductNo, '3011');
});

test('생산관제 Cafe24 카테고리는 부분 생성 복구 뒤 finalDb category 배열의 선택을 유지한다', () => {
  const selection = compile(CORE_BATCH, 'factoryRuntimeCafe24CategorySelection', {});

  const result = selection({
    product: {
      finalDb: {
        category: [{ category_no: '107', display_group: '1', recommend: 'F', new: 'F' }],
      },
      cafe24ReferenceLists: {
        categories: [{ code: '107', name: '수저집' }],
      },
    },
  });

  assert.equal(result.categoryId, '107');
  assert.equal(result.categoryLabel, '수저집');
});

test('생산관제 체크포인트는 같은 작업의 참고 #2994에서 update 대상 #3011로 전환된 복원을 허용한다', () => {
  const matches = compile(CORE_BATCH, 'factoryRuntimeControlProjectionMatchesCheckpoint', {});
  const checkpoint = {
    projectId: 'batch:factory-job-1',
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    runId: 'run-1',
    inputFingerprint: 'fingerprint-1',
    revision: 4,
  };
  const projection = {
    session: {
      workspaceId: 'batch:factory-job-1',
      productId: 'cafe24:3011',
      productKey: '방울수저집',
      runId: 'run-1',
      inputFingerprint: 'fingerprint-1',
      // 판은 체크포인트와 같거나 더 나아간 것까지 같은 작업으로 받아들인다.
      revision: 5,
    },
    registration: {
      jobId: 'factory-job-1',
      productId: 'cafe24:3011',
      mode: 'update',
    },
  };

  assert.equal(matches(projection, checkpoint, 'factory-job-1'), true);
  assert.equal(matches({
    ...projection,
    registration: { ...projection.registration, mode: 'create' },
  }, checkpoint, 'factory-job-1'), false);
});

test('서버 보호본 병합 전 로컬 #2994는 첫 복원 검사에서만 #3011 체크포인트와 이어진다', () => {
  const matches = compile(CORE_BATCH, 'factoryRuntimeControlProjectionMatchesCheckpoint', {});
  const checkpoint = {
    projectId: 'batch:factory-job-1',
    productId: 'cafe24:3011',
    productKey: '방울수저집',
    runId: 'run-1',
    inputFingerprint: 'fingerprint-1',
    revision: 4,
  };
  const staleLocalProjection = {
    session: {
      workspaceId: checkpoint.projectId,
      productId: 'cafe24:2994',
      productKey: checkpoint.productKey,
      runId: checkpoint.runId,
      inputFingerprint: checkpoint.inputFingerprint,
      revision: 4,
    },
    registration: {
      jobId: 'factory-job-1',
      productId: 'cafe24:2994',
      mode: 'create',
    },
  };

  assert.equal(matches(staleLocalProjection, checkpoint, 'factory-job-1'), false);
  assert.equal(matches(staleLocalProjection, checkpoint, 'factory-job-1', {
    allowStaleProductBeforeHydration: true,
  }), true);
});

test('생산관제 체크포인트는 리비전을 확인할 수 없으면 복원을 거절한다', () => {
  // 무인 등록 경로라 판이 체크포인트보다 앞선지 확인할 수 없으면 fail-closed 가 맞다.
  // 서버 저장본에 workspaceRevision 이 없을 때 이 경우가 나온다
  // (factoryRuntimeControlServerSnapshotMatchesCheckpoint 의 Number(undefined) → NaN).
  const matches = compile(CORE_BATCH, 'factoryRuntimeControlProjectionMatchesCheckpoint', {});
  const base = {
    projectId: 'batch:factory-job-1',
    productId: 'cafe24:3011',
    productKey: '방울수저집',
    runId: 'run-1',
    inputFingerprint: 'fingerprint-1',
  };
  const session = revision => ({
    workspaceId: base.projectId,
    productId: base.productId,
    productKey: base.productKey,
    runId: base.runId,
    inputFingerprint: base.inputFingerprint,
    ...(revision === undefined ? {} : { revision }),
  });
  const registration = { jobId: 'factory-job-1', productId: base.productId, mode: 'update' };

  assert.equal(matches({ session: session(4), registration }, { ...base, revision: 4 }, 'factory-job-1'), true);
  assert.equal(matches({ session: session(5), registration }, { ...base, revision: 4 }, 'factory-job-1'), true, '판이 앞서면 같은 작업이다');
  assert.equal(matches({ session: session(3), registration }, { ...base, revision: 4 }, 'factory-job-1'), false, '판이 뒤처지면 복원하면 안 된다');
  assert.equal(matches({ session: session(undefined), registration }, { ...base, revision: 4 }, 'factory-job-1'), false, '판의 리비전을 모르면 거절한다');
  assert.equal(matches({ session: session(4), registration }, { ...base }, 'factory-job-1'), false, '체크포인트 리비전을 모르면 거절한다');
});

test('Cafe24 사전점검은 복구된 update 대상 #3011을 승인 대상으로 고정한다', async () => {
  const factory = {
    automation: { currentRunId: 'run-1', optionMode: 'provided' },
    product: {
      currentProductKey: '방울수저집',
      inputImageFingerprint: 'fingerprint-1',
      cafe24BatchControlBinding: {
        productId: 'cafe24:2994',
        productKey: '방울수저집',
        categoryId: '107',
        htmlDigest: 'sha:detail',
        imageDigests: ['sha:hero'],
        idempotencyKey: 'cafe24-stage:v6:current-composer',
        expectedWorkfileRevision: 1,
        expectedRunId: 'run-1',
        expectedInputFingerprint: 'fingerprint-1',
      },
      cafe24OptionGroupsDraft: [{ name: '색상', values: ['초록', '노랑'] }],
    },
  };
  const inspect = compile(CORE_BATCH, 'factoryRuntimeInspectBatchCafe24Registration', {
    factoryRuntimeReadViewSnapshot: () => ({ factory }),
    factoryCurrentProductKey: () => '방울수저집',
    factoryCurrentWorkflowRunId: () => 'run-1',
    factoryCurrentInputImageFingerprint: () => 'fingerprint-1',
    factoryCafe24TargetInfo: () => ({ productNo: '3011' }),
    factoryRuntimeAuthoritativeWorkspaceRevision: () => ({ counter: 10 }),
    factoryRuntimeResolveCafe24Category: async () => ({ categoryId: '107', categoryLabel: '기타공예용품' }),
    factoryCafe24CurrentScopedDetailHtml: () => ({ html: 'detail' }),
    factoryRuntimeSha256Text: async value => `sha:${value}`,
    factoryRuntimeBatchImageReferences: () => ['hero'],
  });

  const result = await inspect();

  assert.equal(result.productId, 'cafe24:3011');
  assert.equal(result.expectedWorkfileRevision, 1);
});

test('생산관제 신규 등록은 참고 상품번호와 다른 Cafe24 생성 결과를 read-back한다', async () => {
  const batch = {
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    categoryId: '107',
    htmlDigest: 'html-digest',
    imageDigests: ['image-digest'],
    expectedWorkfileRevision: 19,
    expectedRunId: 'run-1',
    expectedInputFingerprint: 'fingerprint-1',
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  };
  const factory = {
    product: {
      cafe24RegistrationReceipt: { status: 'verified', mode: 'create', productNo: '4120' },
    },
  };
  const context = vm.createContext({
    factoryRuntimeReadViewSnapshot: () => ({ factory }),
    factoryCafe24TargetInfo: () => ({
      productNo: factory.product.cafe24RegistrationReceipt.productNo,
      mallId: '1',
    }),
    fetchCafe24ProductFullByNo: async productNo => ({
      raw: {
        product_no: productNo,
        product_code: 'P0000NEW',
        product_name: '방울수저집',
        display: 'F',
        selling: 'F',
        market_sync: 'F',
        description: '<main>상세</main>',
        detail_image: 'https://img.example/hero.jpg',
      },
    }),
    parseCafe24Raw: value => value.raw,
    factoryRuntimeSha256Text: async value => `sha:${String(value)}`,
    factoryCafe24CategoryNoSet: () => new Set(['107']),
    factoryRuntimeBatchCommandError: code => Object.assign(new Error(code), { code }),
    CAFE24_CONTROL_API: { defaultMallId: '1' },
  });
  vm.runInContext(`${sourceFunction(CORE_BATCH, 'factoryRuntimeBatchCafe24Binding')}
${sourceFunction(CORE_BATCH, 'factoryRuntimeBatchCafe24BindingMatches')}
${sourceFunction(CORE_BATCH, 'factoryRuntimeVerifiedCafe24Readback')}
this.bind = factoryRuntimeBatchCafe24Binding;
this.readback = factoryRuntimeVerifiedCafe24Readback;`, context);
  factory.product.cafe24BatchControlBinding = context.bind(batch);

  const result = await context.readback(batch);
  assert.equal(result.externalProductNo, '4120');

  factory.product.cafe24RegistrationReceipt = { status: 'verified', mode: 'create', productNo: '2994' };
  await assert.rejects(
    context.readback(batch),
    error => error.code === 'factory_cafe24_target_mismatch',
  );
});

test('최종 등록은 stale Cafe24 후보가 같은 값이라고 해도 입력한 판매가를 실제 payload에 강제한다', async () => {
  const sent = [];
  const save = compile(SYNC, 'factorySaveCafe24ProductFromFinalDb', {
    CAFE24_CONTROL_API: { defaultMallId: '1' },
    confirm: () => true,
    parseCafe24Raw: target => target?.raw || {},
    factoryUpdateFinalDbFromFields: () => ({ finalDb: { sale_price: '5000' }, fields: [] }),
    factoryApplyFinalCafe24StatusToDb() {},
    factoryCafe24TargetCandidate: () => ({ product_no: '3000', mall_id: '1', raw: { price: '5000' } }),
    factoryNormalizeCafe24ProductPayloadForSave: value => ({ ...value }),
    // Simulates onlyChanged filtering against a stale candidate cache that still says 5000.
    factoryBuildCafe24UpdatePayload: () => ({ product_name: '모시꽃수파우치' }),
    factoryApplyFinalCafe24StatusToProduct() {},
    factoryCafe24MoneyText: value => String(value).replace(/,/g, ''),
    factoryCafe24PositiveMoneyText: value => Number(String(value).replace(/,/g, '')) > 0 ? String(value).replace(/,/g, '') : '',
    factoryCafe24SkippedUpdateFields: () => [],
    factoryCafe24PayloadSummary: () => '',
    factoryLog() {},
    factoryCafe24ControlPlanFromBody: () => null,
    factoryCafe24SaveVerificationRecord: value => value,
    factoryMergeCafe24Candidates: value => value || [],
    normalizeCafe24ProductCandidate: () => ({}),
    factoryRememberCafe24SyncResult() {},
    factoryCafe24FieldLabelByApiField: value => value,
  });
  const factory = { product: { cafe24Candidates: [], candidateAutoApply: false } };

  await save({
    factory,
    applyFinalRegistrationSettings: true,
    forceName: '모시꽃수파우치',
    forceSalePrice: '5000',
    confirm: () => true,
    callCafe24Console: async (_method, _path, request) => {
      sent.push(request.body.product);
      return {};
    },
    waitForProductEcho: async (_productNo, _mallId, product) => ({
      detail: { raw: product },
      verification: { checked: Object.keys(product).length, matched: Object.keys(product).length, missing: [], mismatches: [] },
      attempts: 1,
    }),
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].price, '5000', 'stale cache must not remove the user-confirmed final sale price');
});

test('14/15 부분 상세 등록도 현재 작업 상세 이미지를 안전 설명 fallback에 포함한다', () => {
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({ html: '', source: 'section-preview-incomplete', blocked: true }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    buildExportHtml: () => '<section>텍스트만 있는 부분 상세</section>',
    factoryCafe24StripDetailAdminLabels: value => value,
    factoryCafe24DetailHtmlPreflight: () => ({ ok: true }),
    factoryCafe24DetailForeignProductCheck: () => ({ ok: true }),
    factoryCafe24BuildMarketSafeDetailHtml: () => '<main>안전 상세 설명</main>',
    factoryRegistrationDetailImageRefs: () => [{
      src: 'http://127.0.0.1:5050/api/local-archive/assets/current-detail/image',
      label: '현재 상세 이미지',
    }],
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });
  const factory = { product: {}, assets: [], stages: {} };
  const result = ensure(factory);

  assert.match(result.html, /<img\b/i, 'partial fallback must retain a current-work detail image');
  assert.match(result.html, /current-detail\/image/);
  assert.match(result.asset?.html || '', /<img\b/i, 'the persisted detail asset must retain the same current-work image');
});

test('현재 섹션 HTML이 텍스트만 있어도 등록 전 현재 작업 상세 이미지를 함께 보존한다', () => {
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<main>현재 섹션 텍스트만 있는 상세</main>',
      source: 'current-section-export',
    }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 15, total: 15 }),
    factoryRegistrationDetailImageRefs: () => [{
      src: 'http://127.0.0.1:5050/api/local-archive/assets/current-detail/image',
      label: '현재 상세 이미지',
    }],
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });
  const result = ensure({ product: {}, assets: [], stages: {} });

  assert.match(result.html, /<img\b/i, 'complete text-only export must not discard current-work detail images');
  assert.match(result.asset?.html || '', /current-detail\/image/);
});

test('복원된 미리보기 이미지가 줄어도 같은 작업의 14장 상세 보존본과 선택 A컷을 등록 대상으로 합친다', () => {
  const imageHtml = (count, inline = false, offset = 0) => Array.from(
    { length: count },
    (_, index) => `<img src="${inline ? `data:image/png;base64,QUJD${index + offset}` : `https://cdn.example/detail-${index + offset + 1}.jpg`}" alt="섹션 ${index + offset + 1}">`,
  ).join('');
  const partialHtml = `<main>방울수저집${imageHtml(2)}</main>`;
  const completeHtml = `<main>방울수저집${imageHtml(6, true)}<img src="data:image/png;base64,OLD_MATERIAL" alt="소재/기술 (Material &amp; Tech)">${imageHtml(7, true, 7)}</main>`;
  const scopedDetail = compile(PAYLOADS, 'factoryCafe24CurrentScopedDetailHtml', {
    state: { productName: '방울수저집', analysis: {}, sectionContents: {}, sectionImages: {} },
    factoryCurrentPreviewSectionStatus: () => ({
      requiredSections: Array.from({ length: 14 }, (_, index) => ({ id: `section-${index + 1}` })),
      requiredIds: Array.from({ length: 14 }, (_, index) => `section-${index + 1}`),
      generatedIds: Array.from({ length: 14 }, (_, index) => `section-${index + 1}`),
      generated: 14,
      total: 14,
      complete: true,
    }),
    sectionWorkScopeMeta: () => ({ currentRunId: 'detail-run' }),
    factoryCafe24ResolveSectionScopeCheck: () => ({ ok: true }),
    buildExportHtml: () => partialHtml,
    factoryCafe24StripDetailAdminLabels: value => String(value || ''),
    factoryCafe24DetailHtmlPreflight: html => ({
      ok: !String(html).includes('data:image/'),
      hasInlineImage: String(html).includes('data:image/'),
      hasAdminLabels: false,
      hasLightPlaceholder: false,
    }),
    factoryCafe24DetailForeignProductCheck: () => ({ ok: true }),
    factoryNormalizeIdentityText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    factoryAssetHasCurrentProductPayload: () => true,
    factoryAssetDisplayImage: asset => asset.image || '',
    escAttr: value => String(value),
    SECTIONS: [{ id: 'material_tech', name: '소재/기술 (Material & Tech)' }],
  });
  const factory = {
    product: { productName: '방울수저집', finalDb: { product_name: '방울수저집' } },
    assets: [
      { id: 'partial-newer', stageId: 'detail', type: 'html', used: true, createdAt: 200, html: partialHtml, metadata: { sectionCount: 14 } },
      { id: 'complete-preserved', stageId: 'detail', type: 'html', used: true, createdAt: 100, html: completeHtml, metadata: { sectionCount: 14 } },
      { id: 'selected-material', stageId: 'cuts', used: true, rejected: false, placedSectionId: 'material_tech', image: 'http://127.0.0.1:5050/api/local-archive/assets/selected-material/image' },
    ],
    detailPlacement: { 'selected-material': 'material_tech' },
  };

  const result = scopedDetail(factory);

  assert.equal(result.source, 'detail-asset-richer-current');
  assert.equal(result.asset.id, 'complete-preserved');
  assert.equal(Array.from(result.html.matchAll(/<img\b/gi)).length, 14);
  assert.match(result.html, /https:\/\/cdn\.example\/detail-1\.jpg/, '현재 섹션 이미지는 14장 보존본의 같은 섹션에 합성되어야 한다');
  assert.match(result.html, /local-archive\/assets\/selected-material\/image/, '명시적으로 선택한 A컷은 부분 미리보기에 없어도 보존본보다 우선해야 한다');
  assert.doesNotMatch(result.html, /OLD_MATERIAL/);
});

test('현재 미리보기가 14장이면 선택 A컷을 같은 섹션 이미지보다 우선한다', () => {
  const currentHtml = `<main>방울수저집<img src="data:image/png;base64,OLD_MATERIAL" alt="소재/기술 (Material &amp; Tech)">${Array.from(
    { length: 13 },
    (_, index) => `<img src="https://cdn.example/detail-${index + 1}.jpg" alt="섹션 ${index + 1}">`,
  ).join('')}</main>`;
  const scopedDetail = compile(PAYLOADS, 'factoryCafe24CurrentScopedDetailHtml', {
    state: { productName: '방울수저집', analysis: {}, sectionContents: {}, sectionImages: {} },
    factoryCurrentPreviewSectionStatus: () => ({
      requiredSections: Array.from({ length: 14 }, (_, index) => ({ id: `section-${index + 1}` })),
      requiredIds: Array.from({ length: 14 }, (_, index) => `section-${index + 1}`),
      generatedIds: Array.from({ length: 14 }, (_, index) => `section-${index + 1}`),
      generated: 14,
      total: 14,
      complete: true,
    }),
    sectionWorkScopeMeta: () => ({ currentRunId: 'detail-run' }),
    factoryCafe24ResolveSectionScopeCheck: () => ({ ok: true }),
    buildExportHtml: () => currentHtml,
    factoryCafe24StripDetailAdminLabels: value => String(value || ''),
    factoryCafe24DetailHtmlPreflight: () => ({ ok: true, hasAdminLabels: false, hasLightPlaceholder: false }),
    factoryCafe24DetailForeignProductCheck: () => ({ ok: true }),
    factoryNormalizeIdentityText: value => String(value || '').replace(/\s+/g, '').toLowerCase(),
    factoryAssetHasCurrentProductPayload: () => true,
    factoryAssetDisplayImage: asset => asset.image || '',
    escAttr: value => String(value),
    SECTIONS: [{ id: 'material_tech', name: '소재/기술 (Material & Tech)' }],
  });
  const factory = {
    product: { productName: '방울수저집', finalDb: { product_name: '방울수저집' } },
    assets: [{
      id: 'selected-material',
      stageId: 'cuts',
      used: true,
      rejected: false,
      placedSectionId: 'material_tech',
      image: 'http://127.0.0.1:5050/api/local-archive/assets/selected-material/image',
    }],
    detailPlacement: { 'selected-material': 'material_tech' },
  };

  const result = scopedDetail(factory);

  assert.equal(result.source, 'current-section-export');
  assert.match(result.html, /local-archive\/assets\/selected-material\/image/);
  assert.doesNotMatch(result.html, /OLD_MATERIAL/);
});

test('큰 로컬 상세 이미지는 등록용 경량 키로 보존해 전송 직전에 원본으로 확장한다', () => {
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({ html: '<main>현재 상세</main>', source: 'current-section-export' }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 15, total: 15 }),
    factoryRegistrationDetailImageRefs: () => [{
      src: '',
      transferSrc: 'data:image/png;base64,LARGE_CURRENT_DETAIL',
      storedLarge: true,
      label: '현재 상세 이미지',
    }],
    factoryRememberLightImage: () => 'current_detail_large',
    factoryLightImagePlaceholder: () => 'data:image/svg+xml,placeholder',
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });

  const result = ensure({ product: {}, assets: [], stages: {} });

  assert.match(result.html, /data-factory-light-image-key="current_detail_large"/);
  assert.doesNotMatch(result.html, /LARGE_CURRENT_DETAIL/);
});

test('상세 등록 직전에는 큰 현재 작업 이미지 원본도 요청한다', () => {
  assert.match(
    CORE,
    /factoryRegistrationDetailImageRefs\(factory, \{ includeTransferSrc: true \}\)/,
  );
});

test('최종 등록은 현재 작업의 보관된 상세 섹션 이미지를 먼저 복원한다', async () => {
  const prepareCalls = [];
  const run = compile(CORE, 'factoryRunFinalRegistration', {
    window: {},
    factoryUpdateFromInputs() {},
    factoryApplyFinalRegistrationBasicInfoInputs() {},
    factoryEnsureOpenMarketSync: () => ({}),
    factoryClearFinalRegistrationStaleResult() {},
    factoryApplyFinalCafe24StatusToDb() {},
    factoryUpdateFinalDbFromFields() {},
    factoryPrepareFinalRegistrationLocalAssets: async options => { prepareCalls.push(options); },
    factoryFinalRegistrationSettings: () => ({}),
    factoryFinalRegistrationDetailModel: () => ({ canProceed: false, reason: 'stop after asset preparation' }),
    factoryFinalRegistrationCafe24Model: () => ({}),
    factoryFinalRegistrationBasicInfoModel: () => ({}),
    factoryUpdateFinalRegistrationStatus() {},
  });

  await run({ factory: { product: {} }, skipConfirm: true });

  assert.equal(prepareCalls.length, 1);
  assert.equal(prepareCalls[0].restoreCurrentWork, true, 'final registration must restore current-work section archives before detail HTML is built');
});

test('최종 등록 준비는 marker로 남은 상세 섹션 이미지를 같은 상품·원본 보관본에서 복구한다', async () => {
  const recoverCalls = [];
  const prepare = compile(CORE, 'factoryPrepareFinalRegistrationLocalAssets', {
    state: {},
    factoryUpdateFinalRegistrationStatus() {},
    factoryRefreshLocalArchiveAssets: async () => ({ ok: true }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    factoryRegistrationDetailImageRefs: () => [{ src: 'http://archive/current-section/image' }],
    factoryRecoverPreviewSectionsFromLocalArchive: async options => {
      recoverCalls.push(options);
      return { ok: true, restored: 13, total: 13 };
    },
    factoryHydrateCafe24ImagesFromLocalArchive: async () => ({ ok: true, hydrated: 0, alreadyReady: true }),
  });

  await prepare({ factory: { product: {}, archive: {} }, render: false });

  assert.equal(recoverCalls.length, 1);
  assert.equal(recoverCalls[0].render, false);
  assert.equal(recoverCalls[0].persist, false);
});


test('14장 미리보기 중 한 장만 들어간 전송 HTML은 나머지 현재 작업 이미지를 버리지 않는다', () => {
  const refs = Array.from({ length: 14 }, (_, index) => ({
    src: `http://127.0.0.1:5050/api/local-archive/assets/section-${index + 1}/image`,
    label: `상세 섹션 ${index + 1}`,
  }));
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<main><img src="http://127.0.0.1:5050/api/local-archive/assets/section-4/image"></main>',
      source: 'current-section-export',
      sectionCount: 14,
    }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    factoryRegistrationDetailImageRefs: () => refs,
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치3',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });

  const result = ensure({ product: {}, assets: [], stages: {} });
  const imageSources = Array.from(result.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi), match => match[1]);

  assert.equal(imageSources.length, 14, `expected all 14 preview images, got ${imageSources.length}`);
  assert.equal(new Set(imageSources).size, 14, 'current preview images must be preserved without duplicates');
  assert.equal(Array.from(result.asset.html.matchAll(/<img\b/gi)).length, 14, 'persisted transfer asset must keep all 14 images');
});

test('Cafe24 CDN으로 바뀐 기존 섹션은 alt로 중복을 막고 누락 이미지는 body 안에 보강한다', () => {
  const refs = Array.from({ length: 14 }, (_, index) => ({
    src: `http://127.0.0.1:5050/api/local-archive/assets/section-${index + 1}/image`,
    label: `상세 섹션 ${index + 1}`,
  }));
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<!doctype html><html><body><main><img src="https://cdn.example/section-4.jpg" alt="상세 섹션 4"></main></body></html>',
      source: 'current-section-export',
      sectionCount: 14,
    }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 15 }),
    factoryRegistrationDetailImageRefs: () => refs,
    escAttr: value => String(value),
    factoryCurrentStageRunId: () => 'detail_run',
    deriveProjectName: () => '모시꽃수파우치3',
    uid: () => 'detail_asset',
    factoryRegisterAsset: (_stage, html) => ({ id: 'detail_asset', html }),
  });

  const result = ensure({ product: {}, assets: [], stages: {} });
  const imageTags = Array.from(result.html.matchAll(/<img\b/gi));

  assert.equal(imageTags.length, 14, `expected one existing CDN image plus 13 missing images, got ${imageTags.length}`);
  assert.equal(Array.from(result.html.matchAll(/alt="상세 섹션 4"/g)).length, 1, 'the existing CDN section must not be duplicated');
  assert.doesNotMatch(result.html, /<\/html>\s*<div/i, 'missing image markup must stay inside the HTML document');
  assert.match(result.html, /<\/div><\/body><\/html>$/i, 'missing image markup must be inserted before the closing body tag');
});

test('같은 섹션 이미지 후보가 여러 개여도 이미 배치된 14개 섹션 뒤에 중복 추가하지 않는다', () => {
  const materialLabel = '소재/기술';
  const html = `<html><body>${Array.from({ length: 14 }, (_, index) => (
    `<img src="https://cdn.example/section-${index + 1}.jpg" alt="${index === 6 ? materialLabel : `상세 섹션 ${index + 1}`}">`
  )).join('')}</body></html>`;
  const ensure = compile(CORE, 'factoryEnsureCurrentDetailHtmlAsset', {
    state: { analysis: {}, sectionContents: {}, sectionImages: {}, detailImageBlocks: [] },
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html,
      source: 'detail-asset-richer-current',
      sectionCount: 14,
    }),
    factoryCurrentPreviewSectionStatus: () => ({ generated: 14, total: 14 }),
    factoryRegistrationDetailImageRefs: () => [
      { src: 'http://127.0.0.1:5050/api/local-archive/assets/material-a/image', label: materialLabel },
      { src: 'data:image/png;base64,SAME_MATERIAL_A', label: materialLabel },
    ],
    orderedSections: () => [{ id: 'material_tech', name: materialLabel }],
    escAttr: value => String(value),
  });

  const result = ensure({ product: {}, assets: [], stages: {} });

  assert.equal(Array.from(result.html.matchAll(/<img\b/gi)).length, 14);
  assert.equal(Array.from(result.html.matchAll(/alt="소재\/기술"/g)).length, 1);
  assert.doesNotMatch(result.html, /material-a|SAME_MATERIAL_A/, '이미 배치된 섹션은 등록 직전 뒤에 다시 붙지 않아야 한다');
});

test('신규 최종 등록은 14개 생성 섹션 중 한 장만 확보되면 외부 상품 생성 전에 중단한다', async () => {
  const createCalls = [];
  const statuses = [];
  const sync = {};
  const run = compile(CORE, 'factoryRunFinalRegistration', {
    window: {},
    document: { getElementById: id => id === 'factoryCafe24InventoryAll' ? { value: '99' } : null },
    setTimeout: callback => { callback(); return 1; },
    FACTORY_PAGE_SESSION_ID: 'test-session',
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image' }],
    factoryUpdateFromInputs() {},
    factoryApplyFinalRegistrationBasicInfoInputs() {},
    factoryEnsureOpenMarketSync: () => sync,
    factoryClearFinalRegistrationStaleResult() {},
    factoryApplyFinalCafe24StatusToDb() {},
    factoryUpdateFinalDbFromFields() {},
    factoryFinalRegistrationSettings: () => ({ includeOpenMarket: false, targetLabel: '카페24만 등록', displayLabel: '진열안함', sellingLabel: '판매안함' }),
    factoryFinalRegistrationDetailModel: () => ({ canProceed: true, ok: false, generated: 14, total: 15, label: '14/15개 섹션 생성' }),
    factoryFinalRegistrationCafe24Model: () => ({ canRun: true, mode: 'create', label: '새 상품' }),
    factoryFinalRegistrationBasicInfoModel: () => ({ productName: '모시꽃수파우치3', salePrice: '4688' }),
    factoryOpenMarketSelectedChannels: () => [],
    factoryOpenMarketLog() {},
    factoryCafe24TargetInfo: () => ({}),
    factoryHydrateCafe24ImagesFromLocalArchive: async () => ({ ok: true }),
    factoryCafe24ImagePayload: () => ({ detail_image: 'data:image/jpeg;base64,hero' }),
    factoryEnsureCurrentDetailHtmlAsset: () => ({
      html: '<main><img src="http://127.0.0.1:5050/api/local-archive/assets/only-one/image"></main>',
      source: 'partial-safe-fallback',
      partialFallback: true,
      sectionCount: 14,
    }),
    factoryCafe24DetailImageSrcValues: html => Array.from(String(html).matchAll(/<img\b[^>]*\bsrc=/gi)),
    factoryUpdateFinalRegistrationStatus(message) { statuses.push(String(message)); },
    factoryPatchFinalRegistrationStatusInPlace() {},
    factoryCreateCafe24ProductFromFinalDb: async options => { createCalls.push(options); return {}; },
    factoryRecordFinalRegistrationHistory: async () => ({}),
  });

  const result = await run({ factory: { product: {} }, skipConfirm: true, skipLocalAssetPrepare: true });

  assert.equal(result, false, 'incomplete detail image transfer must fail closed');
  assert.equal(createCalls.length, 0, 'a partial one-image detail must never create a Cafe24 product');
  assert.match(statuses.join(' | '), /상세 이미지 1\/14장/, 'the operator must see the exact missing-image count');
});

test('신규 최종 등록은 판매가를 고정하되 전체 재고 helper로 행별 재고를 덮지 않는다', async () => {
  const createCalls = [];
  const sync = {};
  const run = compile(CORE, 'factoryRunFinalRegistration', {
    window: {},
    document: { getElementById: id => id === 'factoryCafe24InventoryAll' ? { value: '99' } : null },
    setTimeout: callback => { callback(); return 1; },
    FACTORY_PAGE_SESSION_ID: 'test-session',
    FACTORY_CAFE24_IMAGE_SLOTS: [{ key: 'detail_image' }],
    factoryUpdateFromInputs() {},
    factoryApplyFinalRegistrationBasicInfoInputs() {},
    factoryEnsureOpenMarketSync: () => sync,
    factoryClearFinalRegistrationStaleResult() {},
    factoryApplyFinalCafe24StatusToDb() {},
    factoryUpdateFinalDbFromFields() {},
    factoryFinalRegistrationSettings: () => ({ includeOpenMarket: false, targetLabel: '카페24만 등록', displayLabel: '진열안함', sellingLabel: '판매안함' }),
    factoryFinalRegistrationDetailModel: () => ({ canProceed: true, ok: true, generated: 14, total: 15, label: '14/15개 섹션 생성' }),
    factoryFinalRegistrationCafe24Model: () => ({ canRun: true, mode: 'create', label: '새 상품' }),
    factoryFinalRegistrationBasicInfoModel: () => ({ productName: '모시꽃수파우치3', salePrice: '4670' }),
    factoryOpenMarketSelectedChannels: () => [],
    factoryOpenMarketLog() {},
    factoryCafe24TargetInfo: () => ({}),
    factoryHydrateCafe24ImagesFromLocalArchive: async () => ({ ok: true }),
    factoryCafe24ImagePayload: () => ({ detail_image: 'data:image/jpeg;base64,hero' }),
    factoryEnsureCurrentDetailHtmlAsset: () => ({
      html: `<main>${Array.from({ length: 14 }, (_, index) => `<img src="https://cdn.example/detail-${index + 1}.jpg">`).join('')}</main>`,
      source: 'current-section-export',
      sectionCount: 14,
      reused: true,
    }),
    factoryUpdateFinalRegistrationStatus() {},
    factoryPatchFinalRegistrationStatusInPlace() {},
    factoryCafe24BuildRegistrationReceiptPreflight: () => ({ status: 'preflight' }),
    factoryCafe24FinalizeRegistrationReceipt: async () => ({ status: 'verified' }),
    factoryCreateCafe24ProductFromFinalDb: async options => { createCalls.push(options); return {}; },
    factoryRecordFinalRegistrationHistory: async () => ({}),
  });

  const result = await run({ factory: { product: {} }, skipConfirm: true, skipLocalAssetPrepare: true });

  assert.equal(result, true);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].forceSalePrice, '4670', 'create must not fall back to a stale cached price');
  assert.equal(createCalls[0].forceInventoryQuantity, '', 'the bulk helper must not override saved per-row inventory');
});

test('신규 등록 payload는 확정 사이즈를 Cafe24 추가정보에 병합하고 기존 행은 보존한다', () => {
  const mergeSize = compile(PAYLOADS, 'factoryCafe24MergeResolvedSizeAdditionalInformation', {
    factoryCafe24AdditionalInformationPayload: value => Array.isArray(value) ? value.map(row => ({ ...row })) : [],
  });
  const product = {
    additional_information: [
      { key: 'custom_option1', name: '사이즈', value: '' },
      { key: 'custom_option2', name: '색상', value: '15색' },
    ],
  };

  mergeSize(product, { size: '가로21cm*세로14cm' });

  assert.deepEqual(JSON.parse(JSON.stringify(product.additional_information)), [
    { key: 'custom_option1', name: '사이즈', value: '가로21cm*세로14cm' },
    { key: 'custom_option2', name: '색상', value: '15색' },
  ]);
});

test('신규 등록 builder만 확정 사이즈 추가정보 병합을 명시적으로 사용한다', () => {
  assert.match(
    PAYLOADS,
    /includeResolvedSizeAdditionalInformation[\s\S]{0,240}factoryCafe24MergeResolvedSizeAdditionalInformation/,
  );
  assert.match(
    SYNC,
    /factoryBuildCafe24UpdatePayload\(model\.finalDb, model\.fields, factory, \{[\s\S]{0,320}includeResolvedSizeAdditionalInformation:\s*true/,
  );
});

test('최종등록 패널은 undefined createModel을 실제 신규등록 미리보기로 다시 계산한다', () => {
  let previewCalls = 0;
  const resolveModel = compile(CORE, 'factoryFinalRegistrationCreateModel', {
    factoryCafe24CreatePreviewModel: () => {
      previewCalls += 1;
      return {
        product: {
          product_name: '기본값 확인 상품',
          price: '5000',
          manufacturer_code: 'M0000CJP',
          supplier_code: 'S0000000',
          brand_code: 'B00000PU',
          origin_classification: 'F',
          origin_place_no: 102,
        },
        dbModel: { finalDb: {} },
      };
    },
  });

  const result = resolveModel({ product: {} }, { createModel: undefined });

  assert.equal(previewCalls, 1);
  assert.equal(result.product.manufacturer_code, 'M0000CJP');
  assert.equal(resolveModel({ product: {} }, { createModel: null }), null, '명시적인 null은 그대로 존중한다');
});

test('신규 등록은 기본 제조·공급·브랜드와 대구 서구 원산지를 채우되 기존 DB/Cafe24 원산지를 보존한다', () => {
  const applyDefaults = compile(PAYLOADS, 'factoryApplyCafe24CreateReferenceDefaults', {});
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({}))), {
    manufacturer_code: 'M0000CJP',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    origin_classification: 'F',
    origin_place_no: 102,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({
    manufacturer_code: 'M0000000',
    supplier_code: 'S0000000',
    brand_code: 'B0000000',
  }))), {
    manufacturer_code: 'M0000CJP',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    origin_classification: 'F',
    origin_place_no: 102,
  }, 'Cafe24 미지정 기본 코드는 보자기천국 기본 코드로 교체한다');
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({
    manufacturer_code: 'M_EXISTING',
    made_in_code: 'CN',
  }))), {
    manufacturer_code: 'M_EXISTING',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    made_in_code: 'CN',
  }, '신화사DB 원산지가 있으면 국내 기본 지역을 덮어쓰지 않는다');
  assert.deepEqual(JSON.parse(JSON.stringify(applyDefaults({
    origin_classification: 'T',
    origin_place_no: 777,
  }))), {
    manufacturer_code: 'M0000CJP',
    supplier_code: 'S0000000',
    brand_code: 'B00000PU',
    origin_classification: 'T',
    origin_place_no: 777,
  }, 'Cafe24 원산지가 있으면 국내 기본 지역을 덮어쓰지 않는다');
  assert.match(PAYLOADS, /if \(options\.includeCreateReferenceDefaults === true\) \{\s*factoryApplyCafe24CreateReferenceDefaults\(product\);\s*\}/);
  assert.match(SYNC, /factoryBuildCafe24UpdatePayload\(model\.finalDb, model\.fields, factory, \{[\s\S]{0,360}includeCreateReferenceDefaults:\s*true/);
});

test('Cafe24 payload는 원산지 표시값 0을 국가코드로 보내지 않는다', () => {
  const removeInvalid = compile(PAYLOADS, 'factoryRemoveCafe24InvalidReferenceCodePayloadFields', {
    FACTORY_CAFE24_STRICT_REFERENCE_CODE_FIELDS: new Set(['made_in_code']),
    factoryCafe24StrictReferenceCodeValid: value => /^[A-Z0-9]+$/.test(String(value || '')),
    factoryCafe24FieldLabelByApiField: value => value,
  });
  const invalid = { made_in_code: '0', origin_classification: 'E', origin_place_code: '1800' };
  const valid = { made_in_code: 'CN' };

  removeInvalid(invalid);
  removeInvalid(valid);

  assert.equal(Object.hasOwn(invalid, 'made_in_code'), false);
  assert.equal(valid.made_in_code, 'CN');
});

test('Cafe24 상품 echo는 동일한 0퍼센트 적립금 표기를 일치로 판정한다', () => {
  const normalizePoints = value => (Array.isArray(value) ? value : [])
    .map(row => ({
      points_rate: String(row?.points_rate || '').replace('%', ''),
      points_unit_by_payment: String(row?.points_unit_by_payment || 'P'),
    }));
  const equal = compile(PAYLOADS, 'factoryCafe24ProductFieldValuesEqual', {
    factoryCafe24PointsAmountPayload: normalizePoints,
    factoryCafe24ValuesRoughlyEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
  });

  assert.equal(equal(
    'points_amount',
    [{ points_rate: '0.00', points_unit_by_payment: 'P' }],
    [{ points_rate: '0.00%' }],
  ), true);
});

test('Cafe24 전송 직전 추가정보는 공식 key/value만 남겨 실제 저장되게 한다', () => {
  const normalize = compile(SYNC, 'factoryNormalizeCafe24AdditionalInformationForSave', {
    factoryCafe24AdditionalInformationPayload: value => value.map(row => ({ ...row })),
  });

  const result = normalize([
    { key: 'custom_option1', name: '사이즈', value: '가로21cm*세로14cm' },
    { key: 'custom_option2', name: '색상', value: '15색' },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { key: 'custom_option1', value: '가로21cm*세로14cm' },
    { key: 'custom_option2', value: '15색' },
  ]);
});

test('직접 Cafe24 새 상품 등록도 로컬 대표이미지를 복원하고 행별 재고를 후속 전송에 유지한다', async () => {
  const planInputs = [];
  const postInputs = [];
  const createRequests = [];
  const logs = [];
  let hydrateCalls = 0;
  const factory = {
    product: {
      finalDb: { product_name: '모시꽃수파우치9', sale_price: '5000' },
      cafe24Candidates: [],
      candidateAutoApply: false,
      cafe24ImageDraft: {},
    },
    assets: [],
    stages: {},
  };
  const create = compile(SYNC, 'factoryCreateCafe24ProductFromFinalDb', {
    CAFE24_CONTROL_API: { defaultMallId: 'bojagi1928' },
    FACTORY_CAFE24_IMAGE_SLOTS: [
      { key: 'detail_image' },
      { key: 'list_image' },
      { key: 'tiny_image' },
      { key: 'small_image' },
    ],
    document: { getElementById: id => id === 'factoryCafe24InventoryAll' ? { value: '99' } : null },
    state: { productName: '모시꽃수파우치9' },
    Date,
    setInterval: () => 1,
    clearInterval() {},
    confirm: () => true,
    factoryCafe24TargetInfo: () => ({}),
    factoryUpdateFinalDbFromFields: current => ({ finalDb: current.product.finalDb, fields: [] }),
    factoryApplyFinalCafe24StatusToDb() {},
    factoryCafe24CurrentScopedDetailHtml: () => ({
      html: '<main><img src="https://cdn.example/detail.jpg"></main>',
      source: 'current-section-export',
    }),
    factoryCafe24ExpandLightImageHtmlForTransfer: value => value,
    factoryCafe24StripDetailAdminLabels: value => value,
    factoryCafe24DetailHtmlPreflight: () => ({ ok: true, hasLightPlaceholder: false }),
    factoryBuildCafe24UpdatePayload: (_finalDb, _fields, _factory, buildOptions) => ({
      product_name: '모시꽃수파우치9',
      price: '5000',
      description: '<main><img src="https://cdn.example/detail.jpg"></main>',
      ...(buildOptions.includeCreateReferenceDefaults ? {
        manufacturer_code: 'M0000CJP',
        supplier_code: 'S0000000',
        brand_code: 'B00000PU',
        origin_classification: 'F',
        origin_place_no: 102,
      } : {}),
    }),
    factoryAttachCafe24OptionsToProductPayload() {},
    factoryAttachCafe24CategoryToProductPayload() {},
    factoryCafe24PositiveMoneyText: value => String(value || '').replace(/,/g, ''),
    factoryApplyFinalCafe24StatusToProduct() {},
    factoryNormalizeCafe24ProductPayloadForSave: value => ({ ...value }),
    factoryCafe24PruneEmptyProductPayload() {},
    factoryBuildCafe24OptionSyncPlan: (_current, _finalDb, _model, syncOptions) => {
      planInputs.push({ ...syncOptions });
      return { optionValueTotal: 15 };
    },
    factoryCafe24CreatePostSyncPlan: (_current, syncOptions) => {
      planInputs.push({ ...syncOptions });
      return {
        imageSlotCount: 4,
        readyActions: [
          { key: 'images', label: '상품 이미지', ready: true },
          { key: 'options', label: '옵션/품목/재고', ready: true },
        ],
      };
    },
    factoryHydrateCafe24ImagesFromLocalArchive: async () => {
      hydrateCalls += 1;
      return { ok: true, hydrated: 1 };
    },
    factoryCafe24ImagePayload: () => ({
      detail_image: 'data:image/jpeg;base64,hero',
      list_image: 'data:image/jpeg;base64,hero',
      tiny_image: 'data:image/jpeg;base64,hero',
      small_image: 'data:image/jpeg;base64,hero',
    }),
    factoryCafe24PayloadSummary: () => 'payload',
    factoryLog(message) { logs.push(String(message)); },
    callCafe24Console: async (_method, _path, request) => {
      createRequests.push(request.body);
      return { product: { product_no: 3003, product_code: 'P0000ELN', product_name: '모시꽃수파우치9' } };
    },
    factoryCafe24ControlPlanFromBody: () => null,
    factoryExtractCafe24ProductFromBody: body => body.product,
    normalizeCafe24ProductCandidate: value => ({ ...value, raw: value }),
    factoryMergeCafe24Candidates: (_current, incoming) => incoming,
    factoryCafe24CandidateKey: value => String(value.product_no || ''),
    cafe24ProductKey: value => String(value.product_no || ''),
    factoryPromoteCreatedCafe24ProductToUpdateTarget: () => ({ productNo: '3003' }),
    factoryCafe24SaveVerificationRecord: value => value,
    factoryWaitForCafe24ProductEcho: async () => ({
      detail: { raw: { product_no: 3003, product_name: '모시꽃수파우치9' } },
      verification: { checked: 2, matched: 2, missing: [], mismatches: [] },
      attempts: 1,
    }),
    factoryVerifyCafe24ProductEcho: () => ({ checked: 2, matched: 2, missing: [], mismatches: [] }),
    factoryPublishCafe24ScopedDetailHtml: async () => true,
    factoryRunCafe24PostCreateSync: async (_actions, options) => {
      postInputs.push({ ...options });
      return true;
    },
    fetchCafe24ProductFullByNo: async () => ({
      raw: {
        product_no: 3003,
        product_name: '모시꽃수파우치9',
        description: '<main><img src="https://cdn.example/detail.jpg"></main>',
        detail_image: '/web/product/big/3003.jpg',
      },
    }),
    parseCafe24Raw: value => value?.raw || value || {},
    factoryCafe24Delay: async () => {},
  });

  const result = await create({ factory, skipConfirm: true, render: false });

  assert.notEqual(result, false, factory.product.cafe24ApiStatus || logs.join(' | ') || 'direct create unexpectedly returned false');
  assert.equal(hydrateCalls, 1, 'the direct create button must hydrate the local representative image before creating a product');
  assert.equal(createRequests[0].manufacturer_code, 'M0000CJP');
  assert.equal(createRequests[0].supplier_code, 'S0000000');
  assert.equal(createRequests[0].brand_code, 'B00000PU');
  assert.equal(createRequests[0].origin_classification, 'F');
  assert.equal(createRequests[0].origin_place_no, 102);
  assert.equal(planInputs.every(input => input.forceInventoryQuantity === ''), true, 'direct-create plans must keep saved per-row inventory');
  assert.equal(postInputs.length, 1);
  assert.equal(postInputs[0].forceInventoryQuantity, '');
});
