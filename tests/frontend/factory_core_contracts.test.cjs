const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { openBrowserContractHarness } = require('./browser_contract_harness.cjs');

let browser;

before(async () => {
  browser = await openBrowserContractHarness();
  await waitForBrowserAppReady(browser);
}, { timeout: 60000 });

after(async () => {
  await browser?.close();
});

async function reopenBrowserContractHarness() {
  await browser?.close();
  browser = await openBrowserContractHarness();
  await waitForBrowserAppReady(browser);
  return browser;
}

async function waitForBrowserAppReady(targetBrowser) {
  return targetBrowser.call(async () => {
    await Promise.resolve(window.__KUASANGSE_BOOTSTRAP_PROMISE__).catch(() => {});
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      if (window.__KUASANGSE_APP_LOADER__?.ready === true && document.querySelector('#app > .app')) {
        await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__).catch(() => {});
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`factory core app readiness timed out: ${window.__KUASANGSE_LOADER_BOOTSTRAP__?.status || 'unknown'}`);
  });
}

async function withFreshAuthorityBrowser({ scopeId, mode = 'editing', viewport = null }, scenario) {
  const isolatedBrowser = await reopenBrowserContractHarness();
  if (viewport) await isolatedBrowser.setViewport(viewport.width, viewport.height);
  try {
    return await isolatedBrowser.call(async input => {
      const lockKey = '__KUASANGSE_WORKSPACE_LOCK__';
      const fixtureKey = '__KUASANGSE_FACTORY_CORE_AUTHORITY_FIXTURE__';
      const originalLock = window[lockKey];
      const originalFixtureDescriptor = Object.getOwnPropertyDescriptor(window, fixtureKey);
      const sessionId = `factory-core-${Math.random().toString(36).slice(2)}`;
      let authority = Object.freeze({
        mode: input.mode,
        state: input.mode === 'editing' ? 'leased' : 'readonly',
        scopeId: input.scopeId,
        ownerId: 'factory-core isolated fixture',
        sessionId,
        leaseId: `lease-${input.scopeId}`,
        fencingToken: 9001,
        revision: 0,
        expiresAt: Date.now() + 60000,
        reasonCode: input.mode === 'editing' ? '' : 'LEASE_HELD',
        reason: input.mode === 'editing' ? '' : '다른 창에서 이 작업을 편집 중입니다.',
      });
      const update = patch => {
        authority = Object.freeze({ ...authority, ...patch });
        return authority;
      };
      const lock = Object.freeze({
        snapshot: () => authority,
        acquire: async ({ scopeId: nextScopeId = authority.scopeId, ownerId = authority.ownerId } = {}) => update({
          mode: 'editing', state: 'leased', scopeId: nextScopeId, ownerId,
          leaseId: `lease-${nextScopeId}`, fencingToken: authority.fencingToken + 1,
          expiresAt: Date.now() + 60000, reasonCode: '', reason: '',
        }),
        heartbeat: async () => authority,
        observeRevision: revision => update({ revision: Math.max(authority.revision, Number(revision) || 0) }),
        openReadOnly: reason => update({
          mode: 'readonly', state: 'readonly', reasonCode: 'USER_READ_ONLY',
          reason: reason || '읽기 전용 테스트 fixture',
        }),
        refresh: async () => authority,
        release: async () => update({ mode: 'released', state: 'released', reasonCode: 'RELEASED' }),
        runMutation: operation => Promise.resolve().then(operation),
        subscribe(listener) {
          listener(authority);
          return () => {};
        },
        takeover: async () => update({ mode: 'editing', state: 'leased', reasonCode: '', reason: '' }),
      });
      Object.defineProperty(window, fixtureKey, {
        configurable: true,
        value: Object.freeze({
          snapshot: () => authority,
          setMode(nextMode, reasonCode = nextMode === 'editing' ? '' : 'LEASE_HELD') {
            return update({
              mode: nextMode,
              state: nextMode === 'editing' ? 'leased' : 'readonly',
              reasonCode,
              reason: nextMode === 'editing' ? '' : '다른 창에서 이 작업을 편집 중입니다.',
            });
          },
        }),
      });
      window[lockKey] = lock;
      try {
        const run = new Function(`return (${input.scenarioSource})`)();
        return await run();
      } finally {
        window[lockKey] = originalLock;
        if (originalFixtureDescriptor) Object.defineProperty(window, fixtureKey, originalFixtureDescriptor);
        else delete window[fixtureKey];
      }
    }, {
      scopeId,
      mode,
      scenarioSource: scenario.toString(),
    });
  } finally {
    await reopenBrowserContractHarness();
  }
}

test('상품 식별 문자열은 공백과 대소문자를 제거하고 빈 값은 거부한다', async () => {
  // Given: 공백과 영문 대소문자가 섞인 상품명 및 빈 식별자를 준비한다.
  // When: 실제 상품 식별자 정규화/호환 함수를 호출한다.
  const result = await browser.call(() => ({
    normalized: factoryNormalizeIdentityText('  Solra 나비 수저집  '),
    compatible: factoryIdentityKeysCompatible('솔라 나비수저집', '나비수저집'),
    emptyCompatible: factoryIdentityKeysCompatible('', '나비수저집'),
  }));
  // Then: 같은 상품은 동일 기준으로 인식하고 빈 기준은 섞이지 않아야 한다.
  assert.deepEqual(result, {
    normalized: 'solra나비수저집',
    compatible: true,
    emptyCompatible: false,
  });
});

test('경쟁사 상세 이미지 추출은 별도 소유 스코프 없이도 실행된다', async () => {
  // Given: 상세수집 결과와 후보가 아직 비어 있는 초기 상태다.
  // When: 실제 상세 이미지 추출 함수를 기본 인자로 호출한다.
  const result = await browser.call(() => compMarketExtractDetailImages([], []));
  // Then: 소유 스코프 변수를 찾다가 중단되지 않고 빈 결과를 반환한다.
  assert.deepEqual(result, []);
});

test('경쟁사 상세 이미지 추출은 scraped_data 객체 키를 후보 ID로 보존한다', async () => {
  // Given: Jepum 상세수집 API가 후보 ID를 객체 키로만 돌려주는 실제 응답 모양이다.
  const result = await browser.call(() => {
    const scope = {
      currentRunId: 'run-detail-1',
      productKey: '방울수저집',
      inputImageFingerprint: 'image-detail-1',
      stageId: 'competitors',
    };
    const candidate = {
      id: 'coupang_205067249',
      title: '방울수저집',
      platform: 'coupang',
      product_url: 'https://www.coupang.com/vp/products/205067249',
      ...scope,
    };
    const images = compMarketExtractDetailImages({
      scraped_data: {
        coupang_205067249: {
          title: '방울수저집',
          platform: 'coupang',
          screenshot_urls: [
            '/api/v1/detail-captures/job-1/screenshots/coupang_205067249/0',
          ],
          ...scope,
        },
      },
    }, [candidate], scope);
    return images.map(image => ({
      candidateId: image.candidateId,
      productUrl: image.productUrl,
      title: image.title,
    }));
  });
  // Then: 이미지가 선택 후보에 귀속되어 후속 작업 필터를 통과할 수 있어야 한다.
  assert.deepEqual(result, [{
    candidateId: 'coupang_205067249',
    productUrl: 'https://www.coupang.com/vp/products/205067249',
    title: '방울수저집',
  }]);
});

test('기본 VM 스크린샷이 있으면 게스트 보조 경로를 중복 이미지로 추가하지 않는다', async () => {
  const result = await browser.call(() => compMarketExtractDetailImages({
    scraped_data: {
      auction_B853119262: {
        title: '옥션 상세',
        platform: 'auction',
        product_url: 'http://itempage3.auction.co.kr/DetailView.aspx?itemno=B853119262',
        screenshots: ['/api/vm-detail-capture/vm_candidate_test/artifacts/0'],
        vm_guest_screenshot_sources: [
          'C:\\\\JepumScraper\\\\data\\\\detail_pages\\\\auction_B853119262\\\\detail.jpg',
          '/api/v1/detail-captures/api_test/screenshots/auction_B853119262/0',
        ],
      },
    },
  }, []));
  assert.equal(result.length, 1);
  assert.equal(new URL(result[0].src).pathname, '/api/vm-detail-capture/vm_candidate_test/artifacts/0');
});

test('VM 브리지 결과의 product-key 스크린샷이 선택 작업 이미지로 유지된다', async () => {
  const result = await browser.call(() => {
    const scope = {
      currentRunId: 'factory_work_run_test',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'image-test',
      stageId: 'competitors',
    };
    const candidate = {
      id: 'coupang_8206910987',
      title: '전통 모시 꽃 자수 파우치',
      platform: 'coupang',
      product_url: 'https://www.coupang.com/vp/products/8206910987?itemId=23544410069',
      ...scope,
    };
    const jobId = 'vm_candidate_bridge_fixture';
    const detail = {
      currentRunId: scope.currentRunId,
      productKey: scope.productKey,
      inputImageFingerprint: scope.inputImageFingerprint,
      stageId: scope.stageId,
      scraped_data: {
        coupang_8206910987: {
          title: candidate.title,
          platform: candidate.platform,
          product_url: candidate.product_url,
          currentRunId: scope.currentRunId,
          productKey: scope.productKey,
          inputImageFingerprint: scope.inputImageFingerprint,
          stageId: scope.stageId,
          screenshots: [`/api/vm-detail-capture/${jobId}/artifacts/0`],
          screenshot_paths: [`/api/vm-detail-capture/${jobId}/artifacts/0`],
          screenshot_urls: [`/api/vm-detail-capture/${jobId}/artifacts/0`],
        },
      },
    };
    const operation = {
      selectedIds: [candidate.id],
      acceptedCandidateIds: [candidate.id],
      selectedUrls: [candidate.product_url],
      scope,
    };
    const extracted = compMarketExtractDetailImages(detail, [candidate], scope);
    const stamped = compMarketStampDetailImagesForOperation(extracted, operation, [jobId]);
    const scoped = compMarketFilterScrapedImagesForCurrentWork(stamped, scope, {
      selectedIds: [candidate.id],
      results: [candidate],
    });
    return {
      extracted: extracted.length,
      stamped: stamped.length,
      scoped: scoped.length,
      src: scoped[0]?.src || '',
      candidateId: scoped[0]?.candidateId || '',
    };
  });
  assert.deepEqual(result, {
    extracted: 1,
    stamped: 1,
    scoped: 1,
    src: `${process.env.KUASANGSE_BACKEND_BASE || 'http://127.0.0.1:5050'}/api/vm-detail-capture/vm_candidate_bridge_fixture/artifacts/0`,
    candidateId: 'coupang_8206910987',
  });
});

test('VM 상세 응답에 작업 스탬프가 없어도 선택 작업 스코프를 먼저 입혀 이미지를 유지한다', async () => {
  const result = await browser.call(() => {
    const scope = {
      currentRunId: 'factory_work_run_scope_order',
      productKey: '모시꽃수파우치',
      inputImageFingerprint: 'image-scope-order',
      stageId: 'competitors',
    };
    const candidate = {
      id: 'coupang_scope_order',
      title: '전통 모시 꽃 자수 파우치',
      platform: 'coupang',
      product_url: 'https://www.coupang.com/vp/products/scope-order',
    };
    const detail = {
      status: 'success',
      scraped_data: {
        coupang_scope_order: {
          title: candidate.title,
          platform: candidate.platform,
          product_url: candidate.product_url,
          screenshots: ['/api/vm-detail-capture/vm_scope_order/artifacts/0'],
        },
      },
    };
    const operation = {
      selectedIds: [candidate.id],
      acceptedCandidateIds: [candidate.id],
      selectedUrls: [candidate.product_url],
      scope,
    };
    const extracted = compMarketExtractDetailImages(detail, [candidate]);
    const prepared = compMarketStampAndFilterDetailImagesForOperation(
      extracted,
      operation,
      scope,
      { selectedIds: [candidate.id], results: [candidate] },
      ['vm_scope_order'],
    );
    const scoped = prepared.scopedImages;
    return {
      extracted: extracted.length,
      stamped: prepared.operationImages.length,
      scoped: scoped.length,
      src: scoped[0]?.src || '',
    };
  });
  assert.deepEqual(result, {
    extracted: 1,
    stamped: 1,
    scoped: 1,
    src: `${process.env.KUASANGSE_BACKEND_BASE || 'http://127.0.0.1:5050'}/api/vm-detail-capture/vm_scope_order/artifacts/0`,
  });
});

test('명시적으로 선택한 VM 후보는 DB 확정명이 바뀌어도 선택 목록에서 유지된다', async () => {
  const result = await browser.call(() => {
    const scope = {
      currentRunId: 'factory_work_run_candidate_selection',
      productKey: '투톤파우치대',
      inputImageFingerprint: 'image-candidate-selection',
      stageId: 'competitors',
    };
    const candidate = {
      id: 'coupang_candidate_selection',
      title: '모시꽃수파우치',
      platform: 'coupang',
      product_url: 'https://www.coupang.com/vp/products/candidate-selection',
      currentRunId: scope.currentRunId,
      productKey: '모시꽃수파우치',
      inputImageFingerprint: scope.inputImageFingerprint,
      stageId: scope.stageId,
      workProductName: '모시꽃수파우치',
    };
    return {
      selected: compMarketCandidateVisibleForCurrentWork(
        candidate,
        scope,
        new Set([candidate.id]),
        0,
      ),
      unselected: compMarketCandidateVisibleForCurrentWork(candidate, scope, new Set(), 0),
    };
  });
  assert.deepEqual(result, { selected: true, unselected: false });
});

test('작업 상태 병합은 네 가지 작업 식별값 중 하나만 달라도 차단한다', async () => {
  // Given: 의미 있는 작업이 담긴 동일 상태 두 개를 만든다.
  // When: workspace/run/product/fingerprint를 각각 하나씩 바꿔 병합 가능성을 검사한다.
  const result = await browser.call(() => {
    const base = {
      workspace: { id: 'workspace-a' },
      automation: { currentRunId: 'run-a' },
      product: {
        productName: '나비수저집',
        productKey: '나비수저집',
        inputImageFingerprint: 'image-a',
      },
      assets: [{ id: 'asset-a' }],
    };
    const changed = (field, value) => {
      const copy = structuredClone(base);
      if (field === 'workspaceId') copy.workspace.id = value;
      if (field === 'currentRunId') copy.automation.currentRunId = value;
      if (field === 'productKey') copy.product.productKey = value;
      if (field === 'inputImageFingerprint') copy.product.inputImageFingerprint = value;
      return copy;
    };
    return {
      same: factoryStatesCompatibleForMerge(base, structuredClone(base)),
      workspace: factoryStatesCompatibleForMerge(base, changed('workspaceId', 'workspace-b')),
      run: factoryStatesCompatibleForMerge(base, changed('currentRunId', 'run-b')),
      product: factoryStatesCompatibleForMerge(base, changed('productKey', '다른상품')),
      image: factoryStatesCompatibleForMerge(base, changed('inputImageFingerprint', 'image-b')),
    };
  });
  // Then: 완전 동일한 상태만 병합되고 나머지는 모두 차단되어야 한다.
  assert.deepEqual(result, { same: true, workspace: false, run: false, product: false, image: false });
});

test('서버 강제 복원은 최신 Cafe24 영수증을 유지하고 로컬에서는 이미지만 보충한다', async () => {
  // Given: 서버에는 신규 등록 #2995가, 더 늦게 저장된 브라우저 복제본에는 예전 #643이 남아 있다.
  const result = await browser.call(() => {
    const shared = {
      workspace: { id: 'project-pouch' },
      automation: { currentRunId: 'run-pouch' },
      product: {
        productName: '모시바둑파우치',
        productKey: '모시바둑파우치',
        inputImageFingerprint: 'image-pouch',
      },
    };
    const authoritativeServer = {
      ...structuredClone(shared),
      lastSavedAt: 100,
      product: {
        ...shared.product,
        selectedCafe24CandidateKey: '2995',
        confirmedCafe24ProductKey: '2995',
        cafe24DraftProductKey: '2995',
        imagePreview: '__stored_in_indexeddb__',
      },
      assets: [{ id: 'hero-1', stageId: 'hero', hasImage: true }],
    };
    const staleBrowserReplica = {
      ...structuredClone(shared),
      lastSavedAt: 200,
      product: {
        ...shared.product,
        selectedCafe24CandidateKey: '643',
        confirmedCafe24ProductKey: '643',
        cafe24DraftProductKey: '643',
        imageBase64: 'local-image-payload',
        imagePreview: 'data:image/png;base64,bG9jYWwtaW1hZ2U=',
      },
      assets: [{
        id: 'hero-1',
        stageId: 'hero',
        hasImage: true,
        image: 'data:image/png;base64,bG9jYWwtaGVybw==',
      }],
    };

    const merged = mergeFactoryStoredImages(
      authoritativeServer,
      staleBrowserReplica,
      { keepLatestFactory: true, mediaOnly: true },
    );
    return {
      selected: merged.product.selectedCafe24CandidateKey,
      confirmed: merged.product.confirmedCafe24ProductKey,
      draft: merged.product.cafe24DraftProductKey,
      imageBase64: merged.product.imageBase64,
    };
  });

  // Then: 업무 상태는 #2995를 유지하고 이미지 페이로드만 브라우저 저장본에서 복구한다.
  assert.deepEqual(result, {
    selected: '2995',
    confirmed: '2995',
    draft: '2995',
    imageBase64: 'local-image-payload',
  });
});

test('같은 작업 복원은 비어 있는 서버 필드가 현재 확정 상태를 덮어쓰지 않는다', async () => {
  // Given: 같은 작업의 현재 화면에는 DB/Cafe24 선택과 필수값이 있고, 복원 payload에는 후보 목록만 있다.
  const result = await browser.call(() => {
    const current = {
      workspace: { id: 'project-pouch' },
      automation: { currentRunId: 'run-pouch' },
      product: {
        productName: '모시꽃수파우치',
        productKey: '모시꽃수파우치',
        inputImageFingerprint: 'image-pouch',
        selectedDbCandidateKey: 'db-2589',
        selectedCafe24CandidateKey: 'cafe-619',
        dbCandidateResolution: 'selected',
        cafe24CandidateResolution: 'selected',
        confirmedDb: { product_name: '모시꽃수파우치', jcode: '2589' },
        confirmedCafe24ProductKey: '619',
        cafe24DraftProductKey: '619',
        finalDb: { product_name: '모시꽃수파우치', size: '가로21cm*세로14cm' },
        dbFieldSettings: { size: { manualValue: '가로21cm*세로14cm', manualTouched: true } },
        dbCandidates: [{ jcode: '2589' }],
        cafe24Candidates: [{ product_no: '619' }],
      },
    };
    const incoming = {
      workspace: { id: 'project-pouch' },
      automation: { currentRunId: 'run-pouch' },
      product: {
        productName: '모시꽃수파우치',
        productKey: '모시꽃수파우치',
        inputImageFingerprint: 'image-pouch',
        dbCandidates: [{ jcode: '2071' }],
        cafe24Candidates: [{ product_no: '620' }],
      },
    };
    const restored = factoryPreserveProgressForSameWork(incoming, current);
    return {
      selectedDb: restored.product.selectedDbCandidateKey,
      selectedCafe24: restored.product.selectedCafe24CandidateKey,
      dbResolution: restored.product.dbCandidateResolution,
      cafeResolution: restored.product.cafe24CandidateResolution,
      confirmedDb: restored.product.confirmedDb?.jcode,
      confirmedCafe24: restored.product.confirmedCafe24ProductKey,
      finalSize: restored.product.finalDb?.size,
      manualSize: restored.product.dbFieldSettings?.size?.manualValue,
      dbCount: restored.product.dbCandidates.length,
      cafeCount: restored.product.cafe24Candidates.length,
    };
  });

  // Then: 복원 결과는 현재 확정 상태를 보존하면서 새 후보도 잃지 않아야 한다.
  assert.deepEqual(result, {
    selectedDb: 'db-2589',
    selectedCafe24: 'cafe-619',
    dbResolution: 'selected',
    cafeResolution: 'selected',
    confirmedDb: '2589',
    confirmedCafe24: '619',
    finalSize: '가로21cm*세로14cm',
    manualSize: '가로21cm*세로14cm',
    dbCount: 2,
    cafeCount: 2,
  });
});

test('현재 작업 키 비교는 불일치 필드 이름을 정확히 반환한다', async () => {
  // Given: 현재 작업의 완전한 다섯 식별값을 준비한다.
  // When: 실제 작업 키 비교 함수에 각 필드가 다른 후보를 넣는다.
  const result = await browser.call(() => {
    const expected = {
      workspaceId: 'workspace-a', currentRunId: 'run-a', productKey: '나비수저집',
      inputImageFingerprint: 'image-a', stageId: 'hero',
    };
    const mismatch = (field, value) => factoryJobKeyMismatch(
      { ...expected, [field]: value }, expected, { allowMissingActualFields: false }
    );
    return {
      exact: factoryJobKeyMismatch(expected, expected, { allowMissingActualFields: false }),
      workspace: mismatch('workspaceId', 'workspace-b'),
      run: mismatch('currentRunId', 'run-b'),
      product: mismatch('productKey', '다른상품'),
      image: mismatch('inputImageFingerprint', 'image-b'),
      stage: mismatch('stageId', 'size'),
    };
  });
  // Then: 정상 후보는 통과하고 바뀐 필드만 정확히 지목해야 한다.
  assert.deepEqual(result, {
    exact: [], workspace: ['workspaceId'], run: ['currentRunId'], product: ['productKey'],
    image: ['inputImageFingerprint'], stage: ['stageId'],
  });
});

test('엄격한 현재 후보 검사는 식별값 누락과 타 작업 자산을 모두 거부한다', async () => {
  // Given: 현재 hero 작업의 완전한 기대 식별값과 동일한 자산을 준비한다.
  // When: 정상 자산, 이미지 지문이 다른 자산, 식별값이 빈 자산을 검사한다.
  const result = await browser.call(() => {
    const scope = {
      strictScope: true, workspaceId: 'workspace-a', currentRunId: 'run-a',
      productKey: '나비수저집', inputImageFingerprint: 'image-a', stageId: 'hero',
    };
    const asset = { ...scope, strictScope: undefined };
    return {
      exact: factoryAssetMatchesCurrentJob(asset, 'hero', {}, scope),
      wrongImage: factoryAssetMatchesCurrentJob({ ...asset, inputImageFingerprint: 'image-b' }, 'hero', {}, scope),
      missing: factoryAssetMatchesCurrentJob({ stageId: 'hero' }, 'hero', {}, scope),
    };
  });
  // Then: 정확히 일치한 자산만 현재 후보로 인정되어야 한다.
  assert.equal(result.exact.ok, true);
  assert.deepEqual(result.wrongImage.mismatches, ['inputImageFingerprint']);
  assert.equal(result.missing.ok, false);
  assert.deepEqual(result.missing.mismatches.sort(), [
    'currentRunId', 'inputImageFingerprint', 'productKey', 'workspaceId',
  ]);
});

test('단계 별칭은 대표/사이즈/색상옵션/이미지컷으로만 정규화한다', async () => {
  // Given: 실제 UI와 저장 데이터에서 들어오는 단계 별칭과 잘못된 값을 준비한다.
  // When: 실제 단계 정규화 함수를 호출한다.
  const result = await browser.call(() => [
    factoryNormalizeStageScope('대표 이미지'),
    factoryNormalizeStageScope('sizecut'),
    factoryNormalizeStageScope('색상 옵션 컷'),
    factoryNormalizeStageScope('imagecuts'),
    factoryNormalizeStageScope('unknown-stage'),
    factoryNormalizeStageScope(''),
  ]);
  // Then: 허용된 네 단계만 반환하고 알 수 없는 값은 빈 값이어야 한다.
  assert.deepEqual(result, ['hero', 'size', 'options', 'cuts', '', '']);
});

test('옵션 배열 입력은 3,3,3,3과 격자식을 실제 행 배열로 계산한다', async () => {
  // Given: 직접 행 배열, 격자, 격자+추가칸, 잘못된 문자열을 준비한다.
  // When: 실제 옵션표 배열 파서를 호출한다.
  const result = await browser.call(() => ({
    rows: optParseLayoutPatternInput('3,3,3,3', 12),
    grid: optParseLayoutPatternInput('3x4', 12),
    plus: optParseLayoutPatternInput('2x2+3', 7),
    invalid: optParseLayoutPatternInput('잘못된값', 5),
    blank: optParseLayoutPatternInput('', 5),
    capped: optNormalizeRowPattern('20,20', 30),
  }));
  // Then: UI 미리보기와 생성 배열이 같은 행 패턴을 사용해야 한다.
  assert.deepEqual(result.rows.pattern, [3, 3, 3, 3]);
  assert.deepEqual(result.grid.pattern, [4, 4, 4]);
  assert.deepEqual(result.plus.pattern, [2, 2, 3]);
  assert.deepEqual(result.invalid.pattern, [5]);
  assert.equal(result.blank, null);
  assert.deepEqual(result.capped, [20, 10]);
});

test('작업파일 이미지 판별은 인라인/참조/무효 값을 구분하고 경로별 단계를 찾는다', async () => {
  // Given: 데이터 URL, 로컬 참조, 긴 base64, 일반 문자열과 작업파일 경로를 준비한다.
  // When: 실제 작업파일 이미지 및 단계 판별 함수를 호출한다.
  const result = await browser.call(() => ({
    dataUrl: factoryProjectFileImageValueKind('data:image/png;base64,AAAA', 'imagePreview'),
    reference: factoryProjectFileImageValueKind('/static/generated/a.png', 'imagePreview'),
    base64: factoryProjectFileImageValueKind('A'.repeat(100), 'imageBase64'),
    invalid: factoryProjectFileImageValueKind('짧은 일반 텍스트', 'title'),
    optionStage: factoryProjectFileExpectedStageForPath('assetPayload.optionSorter.optionResults[0].image'),
    detailStage: factoryProjectFileExpectedStageForPath('assetPayload.sectionImages.header'),
    cutStage: factoryProjectFileExpectedStageForPath('assetPayload.cuts.results[0].image'),
    inputStage: factoryProjectFileExpectedStageForPath('assetPayload.factory.product.inputImages[0].base64'),
  }));
  // Then: 실제 이미지와 해당 단계만 매니페스트 대상으로 분류되어야 한다.
  assert.deepEqual(result, {
    dataUrl: 'inline-data-url', reference: 'reference', base64: 'inline-base64', invalid: '',
    optionStage: 'options', detailStage: 'detail', cutStage: 'cuts', inputStage: 'input',
  });
});

test('작업파일 manifest는 이미지 로드 실패 진단 URL을 현재 이미지로 세지 않는다', async () => {
  // Given: 실제 후보 이미지와 같은 URL을 로드 실패 진단 필드에도 기록한 현재 작업 자산을 준비한다.
  const paths = await browser.call(() => {
    const identity = { id: 'workspace-manifest-diagnostic', name: '진단 URL 제외 검증' };
    const scope = {
      workspaceId: identity.id,
      currentRunId: 'run-manifest-diagnostic',
      productKey: '진단url제외검증',
      inputImageFingerprint: 'fingerprint-manifest-diagnostic',
      stageId: 'hero',
    };
    const imageUrl = '/api/local-archive/assets/current-image/image';
    const payload = {
      currentProjectId: identity.id,
      assetPayload: {
        factory: {
          workspace: { id: identity.id },
          product: {
            productName: identity.name,
            productKey: scope.productKey,
            currentRunId: scope.currentRunId,
            inputImageFingerprint: scope.inputImageFingerprint,
          },
          automation: { currentRunId: scope.currentRunId },
          stages: { hero: { latestGenerationRunId: scope.currentRunId } },
          assets: [{
            id: 'asset-manifest-diagnostic',
            ...scope,
            imageUrl,
            imageLoadFailed: true,
            imageLoadFailedSrc: imageUrl,
            metadata: { ...scope, imageUrl, imageLoadFailed: true, imageLoadFailedSrc: imageUrl },
          }],
        },
      },
    };
    return factoryProjectFileBuildManifest(payload, identity).images.entries.map(entry => entry.path);
  });
  // Then: 복원 대상 imageUrl만 남고 런타임 진단 필드는 manifest 이미지 경로에서 빠져야 한다.
  assert.ok(paths.includes('assetPayload.factory.assets[0].imageUrl'));
  assert.ok(paths.includes('assetPayload.factory.assets[0].metadata.imageUrl'));
  assert.equal(paths.some(path => path.endsWith('.imageLoadFailedSrc')), false, paths.join('\n'));
});

test('이전 작업파일 manifest의 imageLoadFailedSrc 항목은 진단 전용으로 호환해 불러온다', async () => {
  // Given: 과거 저장기가 imageLoadFailedSrc를 이미지 entry로 넣은 v249 호환 bundle을 만든다.
  const result = await browser.call(() => {
    const projectId = 'workspace-legacy-diagnostic-manifest';
    const identity = { id: projectId, name: '구형 진단 manifest 호환' };
    const scope = {
      workspaceId: projectId,
      currentRunId: 'run-legacy-diagnostic-manifest',
      productKey: '구형진단manifest호환',
      inputImageFingerprint: 'fingerprint-legacy-diagnostic-manifest',
      stageId: 'hero',
    };
    const imageUrl = '/api/local-archive/assets/legacy-current/image';
    const payload = {
      currentProjectId: projectId,
      currentProjectName: identity.name,
      assetPayload: {
        factory: {
          workspace: { id: projectId },
          product: {
            productName: identity.name,
            productKey: scope.productKey,
            currentRunId: scope.currentRunId,
            inputImageFingerprint: scope.inputImageFingerprint,
          },
          automation: { currentRunId: scope.currentRunId },
          stages: { hero: { latestGenerationRunId: scope.currentRunId } },
          assets: [{
            id: 'asset-legacy-diagnostic-manifest',
            ...scope,
            imageUrl,
            imageLoadFailed: true,
            imageLoadFailedSrc: imageUrl,
            metadata: { ...scope, imageUrl, imageLoadFailed: true, imageLoadFailedSrc: imageUrl },
          }],
        },
      },
    };
    const currentManifest = factoryProjectFileBuildManifest(payload, identity);
    const imageEntry = currentManifest.images.entries.find(entry => entry.path.endsWith('.imageUrl'));
    const diagnosticEntries = [
      'assetPayload.factory.assets[0].imageLoadFailedSrc',
      'assetPayload.factory.assets[0].metadata.imageLoadFailedSrc',
    ].map(path => ({ ...imageEntry, path }));
    const legacyManifest = structuredClone(currentManifest);
    legacyManifest.images.entries.push(...diagnosticEntries);
    legacyManifest.images.total = legacyManifest.images.entries.length;
    legacyManifest.images.references += diagnosticEntries.length;
    payload.projectFileManifest = structuredClone(legacyManifest);
    const validation = validateFactoryProjectFileBundle({
      format: 'kuasangse.factory.project',
      version: 1,
      manifest: legacyManifest,
      workspaceId: projectId,
      currentProjectId: projectId,
      project: { id: projectId, name: identity.name, payload },
    });
    return {
      projectId: validation.projectId,
      preparedPaths: validation.manifest.images.entries.map(entry => entry.path),
    };
  });
  // Then: 파일은 열리되 새로 준비한 manifest에는 진단 경로가 남지 않아야 한다.
  assert.equal(result.projectId, 'workspace-legacy-diagnostic-manifest');
  assert.equal(result.preparedPaths.some(path => path.endsWith('.imageLoadFailedSrc')), false);
});

test('작업파일 복원은 과거 진단만 제거하고 실제 현재 실패 로그는 보존한다', async () => {
  // Given: 예전 이미지/색상/로컬 보관/OAuth 진단과 현재 실패로 확정된 로그를 함께 준비한다.
  const result = await browser.call(() => {
    const imageUrl = '/api/local-archive/assets/missing-original/image';
    const factory = {
      assets: [{
        id: 'asset-retry-on-import',
        imageUrl,
        imageLoadFailed: true,
        imageLoadFailedSrc: imageUrl,
        metadata: {
          imageUrl,
          imageLoadFailed: true,
          imageLoadFailedAt: 123,
          imageLoadFailedSrc: imageUrl,
          imageLoadFailedReason: '예전 브라우저 실패',
        },
      }],
      logs: [
        { message: '대표이미지: 이미지 원본을 표시할 수 없어 기본 후보에서 분리했습니다.', type: 'warn' },
        { message: '현재 작업키가 맞는 생성 결과 1개는 색상 차이가 있어도 기본 후보에 유지했습니다.', type: 'warn' },
        { message: '자동 로컬 보관 대기/실패: Failed to fetch', type: 'warn' },
        { message: 'Cafe24 OAuth 자동 점검: Cafe24 OAuth access 토큰이 만료되어 재연결이 필요합니다.', type: 'warn' },
        { message: 'Cafe24 OAuth 재연결 필요: 저장된 인증 상태를 확인해주세요.', type: 'warn' },
        { message: 'Cafe24 OAuth 상태 확인 실패: API Hub 응답 오류', type: 'error' },
        { message: '오래 멈춘 생성 표시 1개를 정리했습니다. 생성 요청이 타임아웃 기준을 넘겼습니다.', type: 'warn' },
        { message: '생성 중 표시 1개를 정리했습니다. 응답 제한 시간을 넘긴 실행 잠금을 풀었습니다.', type: 'warn' },
        { message: '오래 멈춘 생성 표시 1개를 정리했습니다. 현재 복구 실패가 남아 있습니다.', type: 'warn', activeDiagnostic: true },
        { message: '현재 fallback까지 실패한 이미지', type: 'warn', activeDiagnostic: true },
        { message: '사용자가 확인해야 할 실제 생성 실패', type: 'error' },
      ],
      archive: {
        localAssetsError: 'Failed to fetch',
        localStatus: '로컬 보관 목록 실패: Failed to fetch',
      },
    };
    factoryRetireProjectFileTransientDiagnostics(factory);
    const currentToken = factoryImageStageRunKey('hero', 'current-recovery-failure');
    const activeFactory = {
      stages: { hero: { status: 'error', currentRunId: 'current-recovery-failure' } },
      logs: [{
        message: '생성 중 표시 1개를 정리했습니다. 응답 제한 뒤 현재 복구 실패가 남아 있습니다.',
        type: 'warn',
        activeDiagnostic: true,
      }],
    };
    factoryActiveImageStageRunKeys.add(currentToken);
    let activeVisibleMessages = [];
    try {
      factoryRetireProjectFileTransientDiagnostics(activeFactory);
      activeVisibleMessages = factoryVisibleFactoryLogs(activeFactory).map(log => log.message);
    } finally {
      factoryActiveImageStageRunKeys.delete(currentToken);
    }
    return {
      asset: factory.assets[0],
      messages: factory.logs.map(log => log.message),
      activeMessages: activeFactory.logs.map(log => log.message),
      activeVisibleMessages,
      archive: factory.archive,
    };
  });
  // Then: 다시 로드할 수 있는 URL의 예전 flag/임시 로그만 없애고 관계없는 실패는 남겨야 한다.
  assert.equal(result.asset.imageLoadFailed, undefined);
  assert.equal(result.asset.imageLoadFailedSrc, undefined);
  assert.equal(result.asset.metadata.imageLoadFailedAt, undefined);
  assert.deepEqual(result.messages, [
    'Cafe24 OAuth 상태 확인 실패: API Hub 응답 오류',
    '현재 fallback까지 실패한 이미지',
    '사용자가 확인해야 할 실제 생성 실패',
  ]);
  assert.deepEqual(result.activeMessages, [
    '생성 중 표시 1개를 정리했습니다. 응답 제한 뒤 현재 복구 실패가 남아 있습니다.',
  ]);
  assert.deepEqual(result.activeVisibleMessages, result.activeMessages);
  assert.equal(result.archive.localAssetsError, '');
  assert.equal(result.archive.localStatus, '');
});

test('현재 페이지 이미지 생성 토큰은 세션과 작업파일 저장본에 직렬화하지 않는다', async () => {
  // Given: 현재 브라우저 세션 토큰이 prompt와 metadata에 기록된 실행 중 상태를 준비한다.
  const result = await browser.call(() => {
    const cuts = {
      runBusy: true,
      prompts: [{
        id: 'runtime-token-prompt',
        generating: true,
        generationPageSessionId: 'page-session-secret',
        metadata: { generationPageSessionId: 'page-session-secret', keep: 'yes' },
      }],
      sizePrompts: [],
    };
    const sessionCopy = stripCutsRuntimeFlags(structuredClone(cuts));
    const workfileCopy = stripCutsImages(structuredClone(cuts));
    return { sessionCopy, workfileCopy };
  });

  // Then: 실행 토큰과 generating flag는 사라지고 일반 metadata만 유지되어야 한다.
  for (const copy of [result.sessionCopy, result.workfileCopy]) {
    assert.equal(copy.runBusy, false);
    assert.equal(copy.prompts[0].generating, false);
    assert.equal(copy.prompts[0].generationPageSessionId, undefined);
    assert.equal(copy.prompts[0].metadata.generationPageSessionId, undefined);
    assert.equal(copy.prompts[0].metadata.keep, 'yes');
  }
});

test('로컬 보관 이미지 404는 fallback도 실패해도 자산을 훼손하지 않고 재연결 대상으로 남긴다', async () => {
  // Given: 원본 URL은 실패하지만 현재 제품 이미지 fallback은 있는 대표 후보를 준비한다.
  const result = await browser.call(() => {
    const stateBackup = structuredClone(state);
    const factoryBackup = structuredClone(factoryRuntimeReadFactory());
    try {
      const originalSrc = 'http://127.0.0.1:5050/api/local-archive/assets/missing-original/image';
      const fallbackSrc = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      state.imagePreview = fallbackSrc;
      state.imageBase64 = '';
      factoryRuntimeReplaceFactorySnapshot(normalizeFactoryState({
        product: { imagePreview: fallbackSrc },
        assets: [{ id: 'asset-fallback-contract', stageId: 'hero', title: '대표 fallback 계약', imageUrl: originalSrc }],
        logs: [],
      }), { reason: 'factory-core-fallback-contract-setup' });
      const img = document.createElement('img');
      img.dataset.factoryAssetImg = 'asset-fallback-contract';
      img.src = originalSrc;
      factoryHandleRenderedImageError(img);
      const afterOriginalFailure = {
        src: img.src,
        attempted: img.dataset.factoryAssetFallbackAttempted || '',
        failed: !!factoryRuntimeReadFactory().assets[0].imageLoadFailed,
        logs: factoryRuntimeReadFactory().logs.length,
      };
      factoryHandleRenderedImageError(img);
      const afterFallbackFailure = {
        failed: !!factoryRuntimeReadFactory().assets[0].imageLoadFailed,
        failedSrc: factoryRuntimeReadFactory().assets[0].imageLoadFailedSrc || '',
        activeDiagnostic: factoryRuntimeReadFactory().logs[0]?.activeDiagnostic === true,
        retryDeferred: img.dataset.factoryAssetRetryDeferred || '',
        title: img.title,
      };
      return { fallbackSrc, afterOriginalFailure, afterFallbackFailure };
    } finally {
      if (window.__factoryAssetImageFailRenderTimer) {
        clearTimeout(window.__factoryAssetImageFailRenderTimer);
        window.__factoryAssetImageFailRenderTimer = null;
      }
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
      factoryRuntimeReplaceFactorySnapshot(factoryBackup, { reason: 'factory-core-fallback-contract-restore' });
    }
  });
  // Then: 첫 실패는 fallback으로 해결되고, fallback 실패도 일시적인 보관 서버 단절로 취급한다.
  assert.match(result.afterOriginalFailure.src, /^data:image\/(?:gif|png);base64,R0lGODlhAQAB/);
  assert.equal(result.afterOriginalFailure.attempted, '1');
  assert.equal(result.afterOriginalFailure.failed, false);
  assert.equal(result.afterOriginalFailure.logs, 0);
  assert.equal(result.afterFallbackFailure.failed, false);
  assert.equal(result.afterFallbackFailure.failedSrc, '');
  assert.equal(result.afterFallbackFailure.activeDiagnostic, false);
  assert.equal(result.afterFallbackFailure.retryDeferred, '1');
  assert.match(result.afterFallbackFailure.title, /다시 연결.*재시도/);
});

test('작업파일 가져오기 후 설정 동기화는 완료된 세션 커밋을 다시 실행하지 않는다', async () => {
  // Given: 가져온 payload의 설정값을 localStorage 등 보조 저장소에 반영하는 경로를 준비한다.
  const persistentSaveCalls = await browser.call(() => {
    const originals = {
      saveFixedDetailImages: window.saveFixedDetailImages,
      saveSectionInstructions: window.saveSectionInstructions,
      saveSectionGenerationModes: window.saveSectionGenerationModes,
      saveSectionBasisModes: window.saveSectionBasisModes,
      saveSectionAssembly: window.saveSectionAssembly,
      saveModelConfig: window.saveModelConfig,
      saveLayoutTemplate: window.saveLayoutTemplate,
      saveActiveBrandPresetId: window.saveActiveBrandPresetId,
      saveCompAnalysis: window.saveCompAnalysis,
      savePersistentState: window.savePersistentState,
    };
    let calls = 0;
    try {
      window.saveFixedDetailImages = () => {};
      window.saveSectionInstructions = () => {};
      window.saveSectionGenerationModes = () => {};
      window.saveSectionBasisModes = () => {};
      window.saveSectionAssembly = () => {};
      window.saveModelConfig = () => {};
      window.saveLayoutTemplate = () => {};
      window.saveActiveBrandPresetId = () => {};
      window.saveCompAnalysis = () => {};
      window.savePersistentState = () => { calls += 1; };
      persistAppliedWorkspacePayloadSideEffects({ skipPersistentState: true });
      return calls;
    } finally {
      Object.entries(originals).forEach(([name, value]) => { window[name] = value; });
    }
  });
  // Then: 이미 끝난 import 커밋과 별개의 session/server 저장은 발생하지 않아야 한다.
  assert.equal(persistentSaveCalls, 0);
});

test('편집권을 반납하거나 읽기 전용이 된 같은 작업은 백그라운드 저장이 다시 acquire하지 않는다', async () => {
  // Given: 사용자가 같은 작업의 편집권을 이미 반납한 상태다.
  const result = await browser.call(async () => {
    const originalWorkspaceLockApi = window.workspaceLockApi;
    let acquireCalls = 0;
    try {
      window.workspaceLockApi = () => ({
        snapshot: () => ({ mode: 'released', scopeId: 'project:alpha', reasonCode: 'RELEASED' }),
        acquire: async () => {
          acquireCalls += 1;
          return { mode: 'editing', scopeId: 'project:alpha' };
        },
      });
      const authority = await ensureWorkspaceEditAuthority('project:alpha');
      return { acquireCalls, mode: authority?.mode || '' };
    } finally {
      window.workspaceLockApi = originalWorkspaceLockApi;
    }
  });

  // Then: 자동 저장은 명시적 반납을 뒤집지 않는다.
  assert.equal(result.acquireCalls, 0);
  assert.equal(result.mode, 'released');
});

test('공장 복구 스냅샷은 현재 탭 브랜치 권위 뒤에만 쓰고 읽기 전용은 조용히 건너뛴다', async () => {
  // Given: 현재 탭 브랜치 권위를 확인 중인 시작 상태와 복구 저장소를 준비한다.
  const result = await browser.call(async () => {
    const stateBackup = structuredClone(state);
    const originalWorkspaceLockApi = window.workspaceLockApi;
    const originalWorkspacePersistenceApi = window.workspacePersistenceApi;
    const originalWarn = console.warn;
    const writes = [];
    const warnings = [];
    let authority = null;
    let failWrite = false;
    try {
      state.currentProjectId = 'factory-recovery-contract';
      const branchScopeId = getCurrentLastWorkWorkspaceScope();
      authority = { mode: 'acquiring', scopeId: branchScopeId };
      pendingFactoryLastSnapshotRecoveryWrite = null;
      window.workspaceLockApi = () => ({
        snapshot: () => authority,
        acquire: async () => authority,
      });
      window.workspacePersistenceApi = () => ({
        normalizeProjectScope: value => `project:${String(value || '').replace(/^project:/, '')}`,
        normalizeWorkspaceScope: value => value,
        writeRecoveryValue: async (key, value) => {
          writes.push({ key, value });
          if (failWrite) throw new Error('post-authority storage failure');
          return true;
        },
      });
      console.warn = (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' '));

      await workspaceSessionSetItem(FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, 'queued');
      const writesBeforeAuthority = writes.length;
      authority = { mode: 'editing', scopeId: branchScopeId };
      await ensureWorkspaceEditAuthority(branchScopeId);
      await Promise.resolve();
      const writesAfterAuthority = writes.length;

      authority = { mode: 'readonly', scopeId: branchScopeId };
      await workspaceSessionSetItem(FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, 'readonly');
      const writesAfterReadonly = writes.length;

      authority = { mode: 'editing', scopeId: branchScopeId };
      failWrite = true;
      await workspaceSessionSetItem(FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, 'failure').catch(() => {});
      await Promise.resolve();
      return { writesBeforeAuthority, writesAfterAuthority, writesAfterReadonly, warnings };
    } finally {
      pendingFactoryLastSnapshotRecoveryWrite = null;
      window.workspaceLockApi = originalWorkspaceLockApi;
      window.workspacePersistenceApi = originalWorkspacePersistenceApi;
      console.warn = originalWarn;
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
    }
  });

  // Then: 권한 전/읽기 전용 쓰기는 없고, 권한 뒤 실제 저장 실패만 경고해야 한다.
  assert.equal(result.writesBeforeAuthority, 0);
  assert.equal(result.writesAfterAuthority, 1);
  assert.equal(result.writesAfterReadonly, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Workspace recovery write failed \(factory_last_snapshot_v1\).*post-authority storage failure/);
});

test('공장 복구 스냅샷의 앞선 동일 권위 revision은 한 번만 관찰하고 최신값을 재시도한다', async () => {
  const result = await browser.call(async () => {
    const stateBackup = structuredClone(state);
    const originalWorkspaceLockApi = window.workspaceLockApi;
    const originalWorkspacePersistenceApi = window.workspacePersistenceApi;
    const originalWarn = console.warn;
    const writes = [];
    const observed = [];
    const warnings = [];
    let authority = {
      mode: 'editing',
      scopeId: 'project:factory-recovery-reconcile',
      leaseId: 'lease-reconcile',
      fencingToken: 17,
      revision: 3,
    };
    let attempts = 0;
    try {
      state.currentProjectId = 'factory-recovery-reconcile';
      window.workspaceLockApi = () => ({
        snapshot: () => authority,
        observeRevision(revision, fencingToken) {
          observed.push({ revision, fencingToken });
          authority = {
            ...authority,
            revision: Math.max(authority.revision, Number(revision) || 0),
          };
          return authority;
        },
      });
      window.workspacePersistenceApi = () => ({
        writeRecoveryValue: async (key, value) => {
          attempts += 1;
          writes.push({ key, value, attempt: attempts });
          if (attempts === 1) {
            const error = new Error('replica is ahead');
            error.code = 'STALE_REVISION';
            error.current = {
              scopeId: 'project:factory-recovery-reconcile',
              leaseId: 'lease-reconcile',
              fencingToken: 17,
              revision: 9,
            };
            throw error;
          }
          return true;
        },
      });
      console.warn = (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' '));

      const saved = await writeWorkspaceRecoveryValue(FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, 'latest');
      return { saved, writes, observed, warnings, authority };
    } finally {
      window.workspaceLockApi = originalWorkspaceLockApi;
      window.workspacePersistenceApi = originalWorkspacePersistenceApi;
      console.warn = originalWarn;
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
    }
  });

  assert.equal(result.saved, true);
  assert.deepEqual(result.writes, [
    { key: 'factory_last_snapshot_v1', value: 'latest', attempt: 1 },
    { key: 'factory_last_snapshot_v1', value: 'latest', attempt: 2 },
  ]);
  assert.deepEqual(result.observed, [{ revision: 9, fencingToken: 17 }]);
  assert.equal(result.authority.revision, 9);
  assert.deepEqual(result.warnings, []);
});

test('공장 복구 스냅샷은 revision 관찰 사이 권위가 바뀌면 다른 작업으로 재시도하지 않는다', async () => {
  // Given: A 권위와 일치하는 stale conflict가 발생하지만 revision 관찰 중 B 권위로 전환된다.
  const appCoreSource = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../src/app-core-02.js'),
    'utf8',
  );
  const helperStart = appCoreSource.indexOf('function factoryLastSnapshotRecoveryRevisionConflict');
  const helperEnd = appCoreSource.indexOf('\nfunction workspaceSessionSetItem', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helperSource = appCoreSource.slice(helperStart, helperEnd);
  const result = await browser.call(async input => {
    const originalWorkspaceLockApi = window.workspaceLockApi;
    const originalWorkspacePersistenceApi = window.workspacePersistenceApi;
    const originalRevisionConflict = window.factoryLastSnapshotRecoveryRevisionConflict;
    const originalWriteWorkspaceRecoveryValue = window.writeWorkspaceRecoveryValue;
    const originalWarn = console.warn;
    const writes = [];
    const warnings = [];
    let authority = {
      mode: 'editing',
      scopeId: 'project:factory-recovery-authority-a',
      leaseId: 'lease-authority-a',
      fencingToken: 31,
      revision: 4,
    };
    try {
      const sourceHelpers = new Function(`${input.helperSource}\nreturn {
        factoryLastSnapshotRecoveryRevisionConflict,
        writeWorkspaceRecoveryValue,
      };`)();
      window.factoryLastSnapshotRecoveryRevisionConflict = sourceHelpers.factoryLastSnapshotRecoveryRevisionConflict;
      window.writeWorkspaceRecoveryValue = sourceHelpers.writeWorkspaceRecoveryValue;
      window.workspaceLockApi = () => ({
        snapshot: () => authority,
        async observeRevision(revision) {
          Object.assign(authority, {
            mode: 'editing',
            scopeId: 'project:factory-recovery-authority-b',
            leaseId: 'lease-authority-b',
            fencingToken: 32,
            revision,
          });
          await Promise.resolve();
          return authority;
        },
      });
      window.workspacePersistenceApi = () => ({
        writeRecoveryValue: async (key, value) => {
          writes.push({ key, value, scopeId: authority.scopeId });
          const error = new Error('authority changed while reconciling');
          error.code = 'STALE_REVISION';
          error.current = {
            scopeId: 'project:factory-recovery-authority-a',
            leaseId: 'lease-authority-a',
            fencingToken: 31,
            revision: 9,
          };
          throw error;
        },
      });
      console.warn = (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' '));

      // When: A 복구 스냅샷 저장이 stale revision을 관찰하는 동안 B가 현재 권위가 된다.
      const saved = await writeWorkspaceRecoveryValue(
        FACTORY_LAST_SNAPSHOT_RECOVERY_KEY,
        'authority-a-snapshot',
      ).then(() => true, () => false);
      await Promise.resolve();
      return { saved, writes, warnings };
    } finally {
      window.workspaceLockApi = originalWorkspaceLockApi;
      window.workspacePersistenceApi = originalWorkspacePersistenceApi;
      window.factoryLastSnapshotRecoveryRevisionConflict = originalRevisionConflict;
      window.writeWorkspaceRecoveryValue = originalWriteWorkspaceRecoveryValue;
      console.warn = originalWarn;
    }
  }, { helperSource });

  // Then: A 스냅샷은 B 권위로 발행되지 않고 원래 충돌로 실패한다.
  assert.equal(result.saved, false);
  assert.deepEqual(result.writes, [{
    key: 'factory_last_snapshot_v1',
    value: 'authority-a-snapshot',
    scopeId: 'project:factory-recovery-authority-a',
  }]);
  assert.deepEqual(result.warnings, [
    'Workspace recovery write failed (factory_last_snapshot_v1): authority changed while reconciling',
  ]);
});

test('공장 복구 스냅샷은 scope·lease·fence가 다르면 재시도하지 않고 실패를 한 번만 경고한다', async () => {
  const result = await browser.call(async () => {
    const stateBackup = structuredClone(state);
    const originalWorkspaceLockApi = window.workspaceLockApi;
    const originalWorkspacePersistenceApi = window.workspacePersistenceApi;
    const originalWarn = console.warn;
    const scenarios = [
      { label: 'scope', key: FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, current: { scopeId: 'project:other', leaseId: 'lease-reconcile', fencingToken: 17, revision: 9 } },
      { label: 'lease', key: FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, current: { scopeId: 'project:factory-recovery-mismatch', leaseId: 'lease-other', fencingToken: 17, revision: 9 } },
      { label: 'fence', key: FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, current: { scopeId: 'project:factory-recovery-mismatch', leaseId: 'lease-reconcile', fencingToken: 18, revision: 9 } },
      { label: 'other-key', key: 'pdp_last_work_draft_scope_v1', current: { scopeId: 'project:factory-recovery-mismatch', leaseId: 'lease-reconcile', fencingToken: 17, revision: 9 } },
    ];
    const results = [];
    try {
      state.currentProjectId = 'factory-recovery-mismatch';
      for (const scenario of scenarios) {
        let authority = {
          mode: 'editing',
          scopeId: 'project:factory-recovery-mismatch',
          leaseId: 'lease-reconcile',
          fencingToken: 17,
          revision: 3,
        };
        let writes = 0;
        let observations = 0;
        const warnings = [];
        window.workspaceLockApi = () => ({
          snapshot: () => authority,
          observeRevision: () => { observations += 1; },
        });
        window.workspacePersistenceApi = () => ({
          writeRecoveryValue: async () => {
            writes += 1;
            const error = new Error(`${scenario.label} mismatch`);
            error.code = 'STALE_REVISION';
            error.current = scenario.current;
            throw error;
          },
        });
        console.warn = (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' '));
        await writeWorkspaceRecoveryValue(scenario.key, scenario.label).catch(() => {});
        results.push({ label: scenario.label, writes, observations, warnings });
      }
      return results;
    } finally {
      window.workspaceLockApi = originalWorkspaceLockApi;
      window.workspacePersistenceApi = originalWorkspacePersistenceApi;
      console.warn = originalWarn;
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
    }
  });

  assert.deepEqual(result, [
    { label: 'scope', writes: 1, observations: 0, warnings: ['Workspace recovery write failed (factory_last_snapshot_v1): scope mismatch'] },
    { label: 'lease', writes: 1, observations: 0, warnings: ['Workspace recovery write failed (factory_last_snapshot_v1): lease mismatch'] },
    { label: 'fence', writes: 1, observations: 0, warnings: ['Workspace recovery write failed (factory_last_snapshot_v1): fence mismatch'] },
    { label: 'other-key', writes: 1, observations: 0, warnings: ['Workspace recovery write failed (pdp_last_work_draft_scope_v1): other-key mismatch'] },
  ]);
});

test('공장 복구 스냅샷의 재조정 실패는 두 번에서 멈추고 경고를 중복하지 않는다', async () => {
  const result = await browser.call(async () => {
    const stateBackup = structuredClone(state);
    const originalWorkspaceLockApi = window.workspaceLockApi;
    const originalWorkspacePersistenceApi = window.workspacePersistenceApi;
    const originalWarn = console.warn;
    const warnings = [];
    let authority = {
      mode: 'editing',
      scopeId: 'project:factory-recovery-retry-once',
      leaseId: 'lease-retry-once',
      fencingToken: 22,
      revision: 4,
    };
    let writes = 0;
    let observations = 0;
    try {
      state.currentProjectId = 'factory-recovery-retry-once';
      window.workspaceLockApi = () => ({
        snapshot: () => authority,
        observeRevision(revision) {
          observations += 1;
          authority = { ...authority, revision: Math.max(authority.revision, Number(revision) || 0) };
        },
      });
      window.workspacePersistenceApi = () => ({
        writeRecoveryValue: async () => {
          writes += 1;
          const error = new Error('still stale');
          error.code = 'STALE_REVISION';
          error.current = {
            scopeId: 'project:factory-recovery-retry-once',
            leaseId: 'lease-retry-once',
            fencingToken: 22,
            revision: writes === 1 ? 8 : 9,
          };
          throw error;
        },
      });
      console.warn = (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' '));
      await writeWorkspaceRecoveryValue(FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, 'retry-once').catch(() => {});
      return { writes, observations, warnings, authority };
    } finally {
      window.workspaceLockApi = originalWorkspaceLockApi;
      window.workspacePersistenceApi = originalWorkspacePersistenceApi;
      console.warn = originalWarn;
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
    }
  });

  assert.equal(result.writes, 2);
  assert.equal(result.observations, 1);
  assert.deepEqual(result.warnings, ['Workspace recovery write failed (factory_last_snapshot_v1): still stale']);
  assert.equal(result.authority.revision, 8);
});

test('세션 이미지 자동 저장은 같은 편집권의 앞선 replica revision을 관찰한 뒤 한 번 재시도한다', async () => {
  const result = await browser.call(async () => {
    const stateBackup = structuredClone(state);
    const originalWorkspaceLockApi = window.workspaceLockApi;
    const originalWorkspacePersistenceApi = window.workspacePersistenceApi;
    const realWorkspacePersistence = originalWorkspacePersistenceApi();
    const originalProductBackupSave = window.saveLastProductImageBackupToDbIfChanged;
    const originalWarn = console.warn;
    const warnings = [];
    const observations = [];
    let attempts = 0;
    let authority = {
      mode: 'editing',
      scopeId: 'project:session-assets-reconcile',
      leaseId: 'lease-session-assets',
      fencingToken: 41,
      revision: 6,
    };
    try {
      state.currentProjectId = 'session-assets-reconcile';
      state.storageWarning = '이미지 저장소 저장에 실패했습니다. 현재 화면은 유지되지만, 새로고침 전에 현재 작업 저장을 한 번 눌러주세요.';
      window.workspaceLockApi = () => ({
        snapshot: () => authority,
        observeRevision(revision, fencingToken) {
          observations.push({ revision, fencingToken });
          authority = {
            ...authority,
            revision: Math.max(authority.revision, Number(revision) || 0),
          };
          return authority;
        },
      });
      window.workspacePersistenceApi = () => ({
        ...realWorkspacePersistence,
        normalizeProjectScope: value => String(value || '').startsWith('project:')
          ? String(value)
          : `project:${String(value || '')}`,
        normalizeWorkspaceScope: value => String(value || ''),
        loadSessionAssets: async () => null,
        saveSessionAssets: async () => {
          attempts += 1;
          if (attempts === 1) {
            const error = new Error('replica already contains a newer revision');
            error.code = 'STALE_REVISION';
            error.current = {
              scopeId: 'project:session-assets-reconcile',
              leaseId: 'lease-session-assets',
              fencingToken: 41,
              revision: 12,
            };
            throw error;
          }
          return true;
        },
        clearRecoveryValue: async () => true,
      });
      window.saveLastProductImageBackupToDbIfChanged = async () => true;
      console.warn = (...args) => warnings.push(args.map(value => String(value?.message || value)).join(' '));

      await saveSessionAssetsToDbOnce();
      return {
        attempts,
        observations,
        warnings,
        authority,
        storageWarning: state.storageWarning,
      };
    } finally {
      window.workspaceLockApi = originalWorkspaceLockApi;
      window.workspacePersistenceApi = originalWorkspacePersistenceApi;
      window.saveLastProductImageBackupToDbIfChanged = originalProductBackupSave;
      console.warn = originalWarn;
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
    }
  });

  assert.equal(result.attempts, 2);
  assert.deepEqual(result.observations, [{ revision: 12, fencingToken: 41 }]);
  assert.equal(result.authority.revision, 12);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.storageWarning, '');
});

test('작업파일을 열면 내부 저장명보다 선택한 .kuasangse 파일명이 현재 작업파일명이 된다', async () => {
  // Given: 파일 안에는 이전 작업명이 남아 있고, 사용자는 다른 이름의 .kuasangse 파일을 선택한다.
  // When: 실제 작업파일 불러오기 경로에 선택 파일명을 전달한다.
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:workfile-name-source',
    mode: 'editing',
  }, async () => {
    const stateBackup = structuredClone(state);
    const factoryBackup = structuredClone(factoryRuntimeReadFactory());
    const factoryOperationBackup = factoryRuntimeRequireStore().getOperationToken();
    const originals = {
      flushQueuedPersistentState: window.flushQueuedPersistentState,
      persistFactoryProjectBundleLocally: window.persistFactoryProjectBundleLocally,
      validateFactoryProjectFileBundle: window.validateFactoryProjectFileBundle,
      persistAppliedWorkspacePayloadSideEffects: window.persistAppliedWorkspacePayloadSideEffects,
      refreshWorkspaceLists: window.refreshWorkspaceLists,
      refreshLoadedWorkfileArchiveAssets: window.refreshLoadedWorkfileArchiveAssets,
      requestCurrentWorkBundleLiveSync: window.requestCurrentWorkBundleLiveSync,
      settleWorkspaceScopeTransitionPersistence: window.settleWorkspaceScopeTransitionPersistence,
      render: window.render,
      setUiNotice: window.setUiNotice,
      factoryLog: window.factoryLog,
    };
    let branchPersistCalls = 0;
    let projectCommitCalls = 0;
    let persistedBranchScope = '';
    let persistedDocumentId = '';
    let priorPersistenceSettled = false;
    let branchPersistObservedSettledBoundary = false;
    try {
      await originals.settleWorkspaceScopeTransitionPersistence();
      state.currentProjectId = 'workfile-name-source';
      state.currentProjectName = '파일 내부의 이전 이름';
      state.currentProjectCreatedAt = 1710000000000;
      state.productName = '슬라브나비수저집';
      const factory = normalizeFactoryState({});
      factory.product = {
        ...(factory.product || {}),
        productName: '슬라브나비수저집',
        productKey: '슬라브나비수저집',
        currentRunId: 'workfile-name-run',
        inputImageFingerprint: 'workfile-name-image',
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: 'workfile-name-run' };
      factoryRuntimeReplaceFactorySnapshot(factory, {
        mode: 'hydrate',
        workspaceId: state.currentProjectId,
        reason: 'factory-core-workfile-import-setup',
      });
      window.settleWorkspaceScopeTransitionPersistence = async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        await originals.settleWorkspaceScopeTransitionPersistence();
        priorPersistenceSettled = true;
      };
      window.flushQueuedPersistentState = async () => {
        branchPersistCalls += 1;
        branchPersistObservedSettledBoundary = priorPersistenceSettled;
        persistedBranchScope = getCurrentLastWorkWorkspaceScope();
        persistedDocumentId = currentWorkspaceBranch(
          persistedBranchScope,
          state.currentProjectId,
        ).documentId;
        return true;
      };
      window.persistFactoryProjectBundleLocally = async () => {
        projectCommitCalls += 1;
        throw new Error('IMPORT_MUST_NOT_COMMIT_SOURCE_DOCUMENT');
      };
      window.validateFactoryProjectFileBundle = fileBundle => ({
        projectId: fileBundle.project.id,
        manifest: fileBundle.manifest,
      });
      window.persistAppliedWorkspacePayloadSideEffects = () => {};
      window.refreshWorkspaceLists = async () => {};
      window.refreshLoadedWorkfileArchiveAssets = async () => true;
      window.requestCurrentWorkBundleLiveSync = () => Promise.resolve(null);
      window.render = () => {};
      window.setUiNotice = () => {};
      window.factoryLog = () => {};

      const bundle = await buildFactoryProjectFileBundle();
      const imported = await importFactoryProjectFileBundle(bundle, {
        fileName: '진짜슬라브나비수저집.kuasangse',
        skipLeaveConfirm: true,
      });
      return {
        importedName: imported.name,
        currentProjectName: state.currentProjectName,
        workspaceName: factoryRuntimeReadFactory().workspace?.name,
        productName: factoryRuntimeReadFactory().product?.productName,
        branchPersistCalls,
        projectCommitCalls,
        persistedBranchScope,
        persistedDocumentId,
        authorityScope: currentWorkspaceAuthority()?.scopeId || '',
        priorPersistenceSettled,
        branchPersistObservedSettledBoundary,
        transitionGuardReleased: workspaceScopeTransitionState.inProgress === false,
      };
    } finally {
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
      factoryRuntimeReplaceFactorySnapshot(factoryBackup, {
        mode: 'hydrate',
        workspaceId: factoryOperationBackup.workspaceId,
        reason: 'factory-core-workfile-import-restore',
      });
      Object.entries(originals).forEach(([name, value]) => { window[name] = value; });
    }
  });
  // Then: 작업파일 이름은 선택한 파일명을 따르고, 상품 식별값은 보존해야 한다.
  assert.deepEqual(result, {
    importedName: '진짜슬라브나비수저집',
    currentProjectName: '진짜슬라브나비수저집',
    workspaceName: '진짜슬라브나비수저집',
    productName: '슬라브나비수저집',
    branchPersistCalls: 1,
    projectCommitCalls: 0,
    persistedBranchScope: result.persistedBranchScope,
    persistedDocumentId: 'workfile-name-source',
    authorityScope: result.persistedBranchScope,
    priorPersistenceSettled: true,
    branchPersistObservedSettledBoundary: true,
    transitionGuardReleased: true,
  });
  assert.match(result.persistedBranchScope, /^draft:/);
});

test('다른 세션이 같은 작업파일을 열어도 현재 탭은 독립 브랜치로 불러온다', async () => {
  // Given: 같은 문서를 다른 세션이 편집 중이어도 이 탭은 별도 PSD식 편집 브랜치를 사용한다.
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:workfile-readonly-import',
    mode: 'editing',
  }, async () => {
    const stateBackup = structuredClone(state);
    const factoryBackup = structuredClone(factoryRuntimeReadFactory());
    const factoryOperationBackup = factoryRuntimeRequireStore().getOperationToken();
    const originals = {
      flushQueuedPersistentState: window.flushQueuedPersistentState,
      markWorkspaceBlankResetBoundary: window.markWorkspaceBlankResetBoundary,
      resetLiveWorkspaceForProjectFileReplacement: window.resetLiveWorkspaceForProjectFileReplacement,
      applyWorkspacePayload: window.applyWorkspacePayload,
      validateFactoryProjectFileBundle: window.validateFactoryProjectFileBundle,
      persistFactoryProjectBundleLocally: window.persistFactoryProjectBundleLocally,
      persistAppliedWorkspacePayloadSideEffects: window.persistAppliedWorkspacePayloadSideEffects,
      refreshWorkspaceLists: window.refreshWorkspaceLists,
      refreshLoadedWorkfileArchiveAssets: window.refreshLoadedWorkfileArchiveAssets,
      requestCurrentWorkBundleLiveSync: window.requestCurrentWorkBundleLiveSync,
      render: window.render,
      setUiNotice: window.setUiNotice,
      factoryLog: window.factoryLog,
    };
    let blankResetCalls = 0;
    let liveResetCalls = 0;
    let hydrateCalls = 0;
    let projectCommitCalls = 0;
    let branchPersistCalls = 0;
    let branchScope = '';
    let branchDocumentId = '';
    try {
      state.currentProjectId = 'workfile-readonly-import';
      state.currentProjectName = '보존되어야 할 현재 작업';
      state.currentProjectCreatedAt = 1710000000000;
      state.productName = '현재 상품';
      const factory = normalizeFactoryState({});
      factory.workspace = { ...(factory.workspace || {}), id: state.currentProjectId, name: state.currentProjectName };
      factory.product = {
        ...(factory.product || {}),
        productName: '현재 상품',
        productKey: '현재상품',
        currentRunId: 'readonly-current-run',
        inputImageFingerprint: 'readonly-current-image',
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: 'readonly-current-run' };
      factoryRuntimeReplaceFactorySnapshot(factory, {
        mode: 'hydrate',
        workspaceId: state.currentProjectId,
        reason: 'factory-core-readonly-import-setup',
      });
      window.render = () => {};
      window.setUiNotice = () => {};
      window.factoryLog = () => {};
      const bundle = await buildFactoryProjectFileBundle();
      const sourceBundleBefore = JSON.stringify(bundle);

      window.validateFactoryProjectFileBundle = fileBundle => ({
        projectId: fileBundle.project.id,
        manifest: fileBundle.manifest,
      });
      window.markWorkspaceBlankResetBoundary = (...args) => {
        blankResetCalls += 1;
        return originals.markWorkspaceBlankResetBoundary(...args);
      };
      window.resetLiveWorkspaceForProjectFileReplacement = (...args) => {
        liveResetCalls += 1;
        return originals.resetLiveWorkspaceForProjectFileReplacement(...args);
      };
      window.applyWorkspacePayload = (...args) => {
        hydrateCalls += 1;
        return originals.applyWorkspacePayload(...args);
      };
      window.persistFactoryProjectBundleLocally = async () => {
        projectCommitCalls += 1;
        throw new Error('IMPORT_MUST_NOT_COMMIT_SOURCE_DOCUMENT');
      };
      window.flushQueuedPersistentState = async () => {
        branchPersistCalls += 1;
        branchScope = getCurrentLastWorkWorkspaceScope();
        branchDocumentId = currentWorkspaceBranch(branchScope, state.currentProjectId).documentId;
        return true;
      };
      window.persistAppliedWorkspacePayloadSideEffects = () => {};
      window.refreshWorkspaceLists = async () => {};
      window.refreshLoadedWorkfileArchiveAssets = async () => true;
      window.requestCurrentWorkBundleLiveSync = () => Promise.resolve(null);
      window.__KUASANGSE_FACTORY_CORE_AUTHORITY_FIXTURE__.setMode('readonly', 'LEASE_HELD');

      let collision = null;
      let imported = null;
      try {
        imported = await importFactoryProjectFileBundle(bundle, {
          fileName: '다른세션보유.kuasangse',
          skipLeaveConfirm: true,
          deferFinalRender: true,
        });
      } catch (error) {
        collision = { name: error?.name || '', message: error?.message || String(error) };
      }

      return {
        collision,
        importedName: imported?.name || '',
        blankResetCalls,
        liveResetCalls,
        hydrateCalls,
        projectCommitCalls,
        branchPersistCalls,
        branchScope,
        branchDocumentId,
        authorityMode: currentWorkspaceAuthority()?.mode || '',
        authorityScope: currentWorkspaceAuthority()?.scopeId || '',
        currentProjectId: state.currentProjectId,
        currentProjectName: state.currentProjectName,
        productName: factoryRuntimeReadFactory().product?.productName || '',
        sourceBundleUnchanged: JSON.stringify(bundle) === sourceBundleBefore,
      };
    } finally {
      window.__KUASANGSE_FACTORY_CORE_AUTHORITY_FIXTURE__.setMode('editing');
      Object.entries(originals).forEach(([name, value]) => { window[name] = value; });
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
      factoryRuntimeReplaceFactorySnapshot(factoryBackup, {
        mode: 'hydrate',
        workspaceId: factoryOperationBackup.workspaceId,
        reason: 'factory-core-readonly-import-restore',
      });
    }
  });

  // Then: 문서 소스는 건드리지 않고 이 탭의 독립 draft 브랜치에만 복구한다.
  assert.equal(result.collision, null);
  assert.equal(result.importedName, '다른세션보유');
  assert.equal(result.blankResetCalls, 1);
  assert.equal(result.liveResetCalls, 1);
  assert.equal(result.hydrateCalls, 1);
  assert.equal(result.projectCommitCalls, 0);
  assert.equal(result.branchPersistCalls, 1);
  assert.match(result.branchScope, /^draft:/);
  assert.equal(result.branchDocumentId, 'workfile-readonly-import');
  assert.equal(result.authorityMode, 'editing');
  assert.equal(result.authorityScope, result.branchScope);
  assert.equal(result.currentProjectId, 'workfile-readonly-import');
  assert.equal(result.currentProjectName, '다른세션보유');
  assert.equal(result.productName, '현재 상품');
  assert.equal(result.sourceBundleUnchanged, true);
});

test('세션 저장 성공은 이전 세션 실패 경고만 해제하고 다른 실패는 유지한다', async () => {
  // Given/When: 정확한 세션 저장 실패와 관계없는 현재 실패를 각각 해제 함수에 전달한다.
  const result = await browser.call(() => {
    const warningBackup = state.storageWarning;
    const dismissBackup = state.storageWarningDismissKey;
    try {
      state.storageWarning = '세션 저장에 실패했습니다. 현재 작업 저장을 눌러 안전하게 보존해주세요.';
      state.storageWarningDismissKey = 'old-session-failure';
      const cleared = clearResolvedSessionPersistenceWarning();
      const afterSuccess = { warning: state.storageWarning, dismissKey: state.storageWarningDismissKey };
      state.storageWarning = '현재 이미지 fallback까지 실패했습니다.';
      const preserved = clearResolvedSessionPersistenceWarning();
      return { cleared, afterSuccess, preserved, currentWarning: state.storageWarning };
    } finally {
      state.storageWarning = warningBackup;
      state.storageWarningDismissKey = dismissBackup;
    }
  });
  // Then: 이미 해결된 저장 경고만 사라지고 진짜 현재 실패는 그대로여야 한다.
  assert.equal(result.cleared, true);
  assert.deepEqual(result.afterSuccess, { warning: '', dismissKey: '' });
  assert.equal(result.preserved, false);
  assert.equal(result.currentWarning, '현재 이미지 fallback까지 실패했습니다.');
});

test('새 작업의 저장 선택은 현재 작업을 보존한 뒤 전환을 계속한다', async () => {
  // Given: 저장되지 않은 현재 작업과 실제 저장 확인 모달을 준비한다.
  const result = await browser.call(async () => {
    const stateBackup = {
      currentProjectId: state.currentProjectId,
      currentProjectName: state.currentProjectName,
      productName: state.productName,
      workspaceDocumentDirty: state.workspaceDocumentDirty,
      error: state.error,
    };
    const originals = {
      factoryUpdateFromInputs: window.factoryUpdateFromInputs,
      saveCurrentProject: window.saveCurrentProject,
      exportCurrentProjectFile: window.exportCurrentProjectFile,
      render: window.render,
    };
    let projectSaveCalls = 0;
    let fileSaveCalls = 0;
    let exportedName = '';
    try {
      state.currentProjectId = 'save-before-new-work';
      state.currentProjectName = '저장 후 새 작업 검증';
      state.productName = '저장 후 새 작업 검증 상품';
      state.workspaceDocumentDirty = true;
      state.error = '';
      window.factoryUpdateFromInputs = () => {};
      window.saveCurrentProject = async () => { projectSaveCalls += 1; };
      window.exportCurrentProjectFile = async options => {
        fileSaveCalls += 1;
        exportedName = String(options?.name || '');
      };
      window.render = () => {};

      // When: 새 작업 전 저장 여부에서 실제 `저장` 버튼을 누른다.
      const confirmation = window.confirmSaveBeforeLeavingWorkspace('새 작업');
      const saveButton = document.querySelector('#workspaceDocumentModal [data-choice="save"]');
      if (!saveButton) throw new Error('새 작업 저장 확인 버튼을 찾지 못했습니다.');
      saveButton.click();
      const outcome = await confirmation;

      return {
        outcome,
        projectSaveCalls,
        fileSaveCalls,
        exportedName,
        error: state.error || '',
        modalRemaining: !!document.getElementById('workspaceDocumentModal'),
      };
    } finally {
      Object.assign(state, stateBackup);
      Object.entries(originals).forEach(([name, value]) => { window[name] = value; });
      document.getElementById('workspaceDocumentModal')?.remove();
      render();
    }
  });

  // Then: 작업본과 파일이 각각 한 번 저장되고 새 작업 전환이 계속 가능해야 한다.
  assert.deepEqual(result, {
    outcome: 'continue',
    projectSaveCalls: 1,
    fileSaveCalls: 1,
    exportedName: '저장 후 새 작업 검증',
    error: '',
    modalRemaining: false,
  });
});

test('다른 이름으로 저장하면 선택한 실제 파일명이 저장본과 현재 작업파일명이 된다', async () => {
  // Given: 기존 작업명과 다른 이름을 파일 선택창에서 지정한다.
  // When: 실제 다른 이름으로 저장 경로를 실행한다.
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:workfile-name-save-as',
    mode: 'editing',
  }, async () => {
    const stateBackup = structuredClone(state);
    const factoryBackup = structuredClone(factoryRuntimeReadFactory());
    const factoryOperationBackup = factoryRuntimeRequireStore().getOperationToken();
    const lock = window.__KUASANGSE_WORKSPACE_LOCK__;
    const authorityBackup = lock.snapshot();
    const originals = {
      fetch: window.fetch,
      workspacePersistenceApi,
      showSaveFilePicker: window.showSaveFilePicker,
      rememberFactoryProjectFileHandle: window.rememberFactoryProjectFileHandle,
      refreshWorkspaceLists: window.refreshWorkspaceLists,
      savePersistentState: window.savePersistentState,
      render: window.render,
      setUiNotice: window.setUiNotice,
      factoryLog: window.factoryLog,
    };
    let savedBundle = null;
      let committedServerSnapshot = null;
      let committedServerForce = false;
      let committedServerRepair = false;
    let restoringAuthority = false;
    try {
      state.currentProjectId = 'workfile-name-save-as';
      state.currentProjectName = '기존 작업파일명';
      state.currentProjectCreatedAt = 1710000000000;
      state.productName = '슬라브나비수저집';
      const factory = normalizeFactoryState({});
      factory.product = {
        ...(factory.product || {}),
        productName: '슬라브나비수저집',
        productKey: '슬라브나비수저집',
        currentRunId: 'workfile-name-save-as-run',
        inputImageFingerprint: 'workfile-name-save-as-image',
      };
      factory.automation = { ...(factory.automation || {}), currentRunId: 'workfile-name-save-as-run' };
      factoryRuntimeReplaceFactorySnapshot(factory, {
        mode: 'hydrate',
        workspaceId: state.currentProjectId,
        reason: 'factory-core-save-as-setup',
      });
      window.fetch = async (input, init = {}) => {
        const url = String(input?.url || input || '');
        if (!url.includes('/api/workspace-lock/')) {
          return new Response(JSON.stringify({ ok: true, items: [], workfiles: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const path = url.split('/api/workspace-lock/')[1]?.split('?')[0] || '';
        const body = init.body ? JSON.parse(init.body) : {};
        const scopeId = String(body.workspaceId || authorityBackup.scopeId || '');
        const original = restoringAuthority && scopeId === authorityBackup.scopeId;
        const granted = original ? authorityBackup.mode === 'editing' : true;
        const payload = {
          granted,
          state: granted ? 'leased' : 'readonly',
          scopeId,
          leaseId: original ? authorityBackup.leaseId : `test-lease-${scopeId}`,
          fencingToken: original ? authorityBackup.fencingToken : 701,
          ownerId: original ? authorityBackup.ownerId : String(body.ownerId || 'factory contract test'),
          sessionId: original ? authorityBackup.sessionId : String(body.sessionId || 'factory-contract-session'),
          revision: original ? authorityBackup.revision : 0,
          expiresAt: Date.now() + 30000,
        };
        return new Response(JSON.stringify(payload), {
          status: granted || ['heartbeat', 'release'].includes(path) ? 200 : 409,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      window.showSaveFilePicker = async () => ({
        name: '진짜슬라브나비수저집.kuasangse',
        getFile: async () => new Blob([savedBundle ? JSON.stringify(savedBundle) : '']),
        createWritable: async () => ({
          write: async blob => { savedBundle = JSON.parse(await blob.text()); },
          close: async () => {},
        }),
      });
      window.rememberFactoryProjectFileHandle = async () => {};
      window.refreshWorkspaceLists = async () => {};
      window.savePersistentState = () => {};
      window.render = () => {};
      window.setUiNotice = () => {};
      window.factoryLog = () => {};
      const basePersistence = window.__KUASANGSE_WORKSPACE_PERSISTENCE__;
      const memoryPersistence = Object.freeze({
        ...basePersistence,
        chooseProjectFileForSave: options => window.showSaveFilePicker(options),
        async commit(command) {
          committedServerSnapshot = command.context?.server?.serverSnapshot || null;
          committedServerForce = command.context?.server?.force === true;
          committedServerRepair = command.context?.server?.repair === true;
          const handle = command.context?.workfile?.handle;
          const value = command.context?.workfile?.value;
          if (handle && value) {
            const writable = await handle.createWritable();
            await writable.write(value);
            await writable.close();
          }
          return Object.freeze({
            accepted: true,
            clean: true,
            envelope: Object.freeze({ metadata: command.metadata }),
            failures: Object.freeze([]),
          });
        },
      });
      workspacePersistenceApi = () => memoryPersistence;

      await exportCurrentProjectFile({ name: state.currentProjectName, saveAs: true });
      return {
        currentProjectName: state.currentProjectName,
        workspaceName: factoryRuntimeReadFactory().workspace?.name,
        savedProjectName: savedBundle?.project?.name,
        savedPayloadName: savedBundle?.project?.payload?.currentProjectName,
        productName: factoryRuntimeReadFactory().product?.productName,
        serverSnapshotReason: committedServerSnapshot?.reason,
        serverSnapshotProductName: committedServerSnapshot?.assets?.productName,
        serverForce: committedServerForce,
        serverRepair: committedServerRepair,
      };
    } finally {
      await lock.release();
      restoringAuthority = true;
      if (authorityBackup.scopeId) {
        const restoredAuthority = await lock.acquire({
          scopeId: authorityBackup.scopeId,
          ownerId: authorityBackup.ownerId,
        });
        if (
          restoredAuthority?.scopeId !== authorityBackup.scopeId
          || restoredAuthority?.mode !== authorityBackup.mode
        ) {
          throw new Error(`workspace authority restore failed: ${JSON.stringify(restoredAuthority)}`);
        }
      }
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
      factoryRuntimeReplaceFactorySnapshot(factoryBackup, {
        mode: 'hydrate',
        workspaceId: factoryOperationBackup.workspaceId,
        reason: 'factory-core-save-as-restore',
      });
      workspacePersistenceApi = originals.workspacePersistenceApi;
      Object.entries(originals).forEach(([name, value]) => {
        if (name !== 'workspacePersistenceApi') window[name] = value;
      });
      render();
    }
  });
  // Then: 실제 저장 파일명이 작업파일 메타데이터와 화면 상태의 단일 기준이어야 한다.
  assert.deepEqual(result, {
    currentProjectName: '진짜슬라브나비수저집',
    workspaceName: '진짜슬라브나비수저집',
    savedProjectName: '진짜슬라브나비수저집',
    savedPayloadName: '진짜슬라브나비수저집',
    productName: '슬라브나비수저집',
    serverSnapshotReason: 'workfile-save',
    serverSnapshotProductName: '슬라브나비수저집',
    serverForce: true,
    serverRepair: true,
  });
});

test('상세 섹션 전송은 실행ID·상품키·입력이미지가 모두 같을 때만 허용한다', async () => {
  // Given: 현재 섹션 작업의 실행ID, 상품키, 입력 이미지 지문을 준비한다.
  // When: 같은 범위와 각 필드가 다른 범위를 실제 전송 검사 함수로 비교한다.
  const result = await browser.call(() => {
    const current = { currentRunId: 'run-a', productKey: '나비수저집', inputImageFingerprint: 'image-a' };
    return {
      exact: sectionWorkScopeMatchesForDetailTransfer({ ...current }, current),
      run: sectionWorkScopeMatchesForDetailTransfer({ ...current, currentRunId: 'run-b' }, current),
      product: sectionWorkScopeMatchesForDetailTransfer({ ...current, productKey: '다른상품' }, current),
      image: sectionWorkScopeMatchesForDetailTransfer({ ...current, inputImageFingerprint: 'image-b' }, current),
      empty: sectionWorkScopeMatchesForDetailTransfer({}, current),
    };
  });
  // Then: 완전 일치만 통과하고 실패 원인이 구체적으로 남아야 한다.
  assert.equal(result.exact.ok, true);
  assert.equal(result.run.reason, 'current-run-changed');
  assert.equal(result.product.reason, 'product-key-changed');
  assert.equal(result.image.reason, 'input-image-changed');
  assert.equal(result.empty.reason, 'current-run-missing');
});

test('15개 개별 섹션이 현재 작업과 일치하면 최상위 범위 메타가 없어도 Cafe24 전송을 허용한다', async () => {
  // Given: 복구본처럼 각 섹션은 현재 작업과 일치하지만 중복 최상위 sectionWorkScope는 없는 상태를 만든다.
  // When: 전체 15개 일치, 14개만 일치, 오래된 최상위 메타가 남은 경우를 전송 범위 검사로 판정한다.
  const result = await browser.call(() => {
    const current = { currentRunId: 'run-a', productKey: '나비수저집', inputImageFingerprint: 'image-a' };
    const requiredIds = Array.from({ length: 15 }, (_, index) => `section-${index + 1}`);
    return {
      restored: factoryCafe24ResolveSectionScopeCheck({}, current, requiredIds, [...requiredIds]),
      partial: factoryCafe24ResolveSectionScopeCheck({}, current, requiredIds, requiredIds.slice(0, 14)),
      staleAggregate: factoryCafe24ResolveSectionScopeCheck({
        sectionWorkScope: { ...current, currentRunId: 'run-old' },
      }, current, requiredIds, [...requiredIds]),
    };
  });
  // Then: 모든 개별 섹션을 엄격히 통과한 복구본만 중복 최상위 메타 없이도 허용되어야 한다.
  assert.equal(result.restored.ok, true);
  assert.equal(result.restored.inferredFrom, 'verified-section-contents');
  assert.equal(result.partial.ok, false);
  assert.equal(result.partial.reason, 'current-run-missing');
  assert.equal(result.staleAggregate.ok, true);
  assert.equal(result.staleAggregate.inferredFrom, 'verified-section-contents');
});

test('범위 메타가 없는 동일 작업의 부분 섹션은 등록 확인창을 열 수 있다', async () => {
  const result = await browser.call(() => {
    const current = { currentRunId: 'legacy-run', productKey: '레거시상품', inputImageFingerprint: 'legacy-image' };
    const requiredIds = Array.from({ length: 15 }, (_, index) => `section-${index + 1}`);
    const legacyContents = Object.fromEntries(requiredIds.slice(0, 14).map(id => [id, { headline: id }]));
    const mixedContents = {
      ...legacyContents,
      'section-1': { headline: 'section-1', __sectionWorkScope: { ...current, sectionId: 'section-1' } },
    };
    const staleContents = {
      ...legacyContents,
      'section-1': { headline: 'section-1', __sectionWorkScope: { ...current, currentRunId: 'old-run', sectionId: 'section-1' } },
    };
    return {
      legacy: factoryCafe24ResolveSectionScopeCheck({ sectionContents: legacyContents }, current, requiredIds, requiredIds.slice(0, 14)),
      mixed: factoryCafe24ResolveSectionScopeCheck({ sectionContents: mixedContents }, current, requiredIds, requiredIds.slice(0, 14)),
      stale: factoryCafe24ResolveSectionScopeCheck({ sectionContents: staleContents }, current, requiredIds, requiredIds.slice(0, 14)),
    };
  });
  assert.equal(result.legacy.ok, true);
  assert.equal(result.legacy.inferredFrom, 'legacy-partial-section-contents');
  assert.equal(result.mixed.ok, true);
  assert.equal(result.mixed.inferredFrom, 'verified-partial-section-contents-with-legacy');
  assert.equal(result.stale.ok, false);
  assert.equal(result.stale.reason, 'current-run-changed');
});

test('최종등록은 실제 미리보기에 생성된 15개 섹션을 scope 메타와 무관하게 15/15로 판단한다', async () => {
  const result = await browser.call(() => {
    const requiredIds = orderedSections().map(section => section.id).filter(Boolean);
    const original = {
      sectionContents: state.sectionContents,
      sectionImages: state.sectionImages,
      sectionGenerationMeta: state.sectionGenerationMeta,
      scopedDetail: window.factoryCafe24CurrentScopedDetailHtml,
      belongs: window.sectionContentBelongsToCurrentWork,
      buildExportHtml: window.buildExportHtml,
    };
    const factory = {
      assets: [],
      product: {
        userProductName: '미리보기기준상품',
        finalDb: { product_name: '미리보기기준상품' },
      },
    };
    try {
      state.sectionContents = Object.fromEntries(requiredIds.map((id, index) => [
        id,
        {
          headline: index === 0 ? '미리보기기준상품' : `${index + 1}번 섹션`,
          body_text: '현재 미리보기에 표시되는 섹션',
        },
      ]));
      state.sectionImages = Object.fromEntries(requiredIds.map(id => [id, `https://example.invalid/${id}.png`]));
      state.sectionGenerationMeta = {};
      window.sectionContentBelongsToCurrentWork = (id) => !requiredIds.slice(-2).includes(id);
      window.buildExportHtml = () => '<main><section>미리보기기준상품</section></main>';

      window.factoryCafe24CurrentScopedDetailHtml = () => ({
        html: '<main><section>미리보기기준상품</section></main>',
        source: 'current-section-export',
        sectionCount: requiredIds.length,
      });
      const detailModel = factoryFinalRegistrationDetailModel(factory);

      window.factoryCafe24CurrentScopedDetailHtml = original.scopedDetail;
      const scopedDetail = factoryCafe24CurrentScopedDetailHtml(factory);
      return {
        total: requiredIds.length,
        detailGenerated: detailModel.generated,
        detailLabel: detailModel.label,
        detailOk: detailModel.ok,
        detailCanProceed: detailModel.canProceed,
        scopedSource: scopedDetail.source,
        scopedBlocked: !!scopedDetail.blocked,
        scopedSectionCount: scopedDetail.sectionCount,
      };
    } finally {
      state.sectionContents = original.sectionContents;
      state.sectionImages = original.sectionImages;
      state.sectionGenerationMeta = original.sectionGenerationMeta;
      window.factoryCafe24CurrentScopedDetailHtml = original.scopedDetail;
      window.sectionContentBelongsToCurrentWork = original.belongs;
      window.buildExportHtml = original.buildExportHtml;
    }
  });

  assert.deepEqual(result, {
    total: 15,
    detailGenerated: 15,
    detailLabel: '15/15개 섹션 생성',
    detailOk: true,
    detailCanProceed: true,
    scopedSource: 'current-section-export',
    scopedBlocked: false,
    scopedSectionCount: 15,
  });
});

test('생성 메타와 섹션 이미지가 있는 13/15 미리보기는 최종 게이트도 13/15로 판단한다', async () => {
  const result = await browser.call(() => {
    const requiredIds = orderedSections().map(section => section.id).filter(Boolean);
    const scope = {
      currentRunId: 'partial-image-meta-run',
      productKey: '이미지메타부분상품',
      inputImageFingerprint: 'partial-image-meta-image',
    };
    const original = {
      sectionContents: state.sectionContents,
      sectionImages: state.sectionImages,
      sectionGenerationMeta: state.sectionGenerationMeta,
      sectionWorkScope: state.sectionWorkScope,
      buildExportHtml: window.buildExportHtml,
      factoryRuntimeReadFactory: window.factoryRuntimeReadFactory,
    };
    const factory = {
      assets: [],
      product: {
        userProductName: '이미지메타부분상품',
        finalDb: { product_name: '이미지메타부분상품' },
        currentRunId: scope.currentRunId,
        lockedInputImageFingerprint: scope.inputImageFingerprint,
      },
    };
    try {
      state.sectionContents = Object.fromEntries(requiredIds.slice(0, 2).map((id, index) => [
        id,
        { headline: index === 0 ? '이미지메타부분상품' : `${index + 1}번 섹션`, body_text: '현재 미리보기 섹션' },
      ]));
      state.sectionImages = Object.fromEntries(requiredIds.slice(0, 13).map(id => [id, `https://example.invalid/${id}.png`]));
      state.sectionGenerationMeta = Object.fromEntries(requiredIds.slice(0, 13).map(id => [id, { ...scope, sectionId: id }]));
      state.sectionWorkScope = { ...scope };
      window.factoryRuntimeReadFactory = () => factory;

      const status = factoryCurrentPreviewSectionStatus(state);
      const exportHtml = original.buildExportHtml({ product_name: '이미지메타부분상품' }, state.sectionContents, state.sectionImages, []);
      window.buildExportHtml = () => '<main><section>이미지메타부분상품</section></main>';
      const scoped = factoryCafe24CurrentScopedDetailHtml(factory);
      const detailModel = factoryFinalRegistrationDetailModel(factory);
      return {
        generated: status.generated,
        generatedIds: status.generatedIds.length,
        imageOnlyRendered: exportHtml.includes(`${requiredIds[2]}.png`),
        detailGenerated: detailModel.generated,
        detailLabel: detailModel.label,
        canProceed: detailModel.canProceed,
        scopedSource: scoped.source,
        scopedBlocked: !!scoped.blocked,
        scopedSectionCount: scoped.sectionCount,
      };
    } finally {
      state.sectionContents = original.sectionContents;
      state.sectionImages = original.sectionImages;
      state.sectionGenerationMeta = original.sectionGenerationMeta;
      state.sectionWorkScope = original.sectionWorkScope;
      window.buildExportHtml = original.buildExportHtml;
      window.factoryRuntimeReadFactory = original.factoryRuntimeReadFactory;
    }
  });

  assert.deepEqual(result, {
    generated: 13,
    generatedIds: 13,
    imageOnlyRendered: true,
    detailGenerated: 13,
    detailLabel: '13/15개 섹션 생성',
    canProceed: true,
    scopedSource: 'current-section-export',
    scopedBlocked: false,
    scopedSectionCount: 13,
  });
});

test('동일 작업 범위의 14/15 미리보기는 확인창 후 최종 진행할 수 있다', async () => {
  const result = await browser.call(async () => {
    const requiredIds = orderedSections().map(section => section.id).filter(Boolean);
    const scope = {
      currentRunId: 'partial-preview-run',
      productKey: '부분미리보기상품',
      inputImageFingerprint: 'partial-preview-image',
    };
    const original = {
      sectionContents: state.sectionContents,
      sectionImages: state.sectionImages,
      sectionGenerationMeta: state.sectionGenerationMeta,
      sectionWorkScope: state.sectionWorkScope,
      buildExportHtml: window.buildExportHtml,
      factoryRuntimeReadFactory: window.factoryRuntimeReadFactory,
    };
    const factory = {
      assets: [],
      product: {
        userProductName: '부분미리보기상품',
        finalDb: { product_name: '부분미리보기상품' },
        currentRunId: scope.currentRunId,
        lockedInputImageFingerprint: scope.inputImageFingerprint,
      },
    };
    try {
      state.sectionContents = Object.fromEntries(requiredIds.slice(0, -1).map((id, index) => [
        id,
        {
          headline: index === 0 ? '부분미리보기상품' : `${index + 1}번 섹션`,
          body_text: '현재 미리보기에 표시되는 섹션',
        },
      ]));
      state.sectionImages = Object.fromEntries(requiredIds.slice(0, -1).map(id => [id, `https://example.invalid/${id}.png`]));
      state.sectionGenerationMeta = {};
      state.sectionWorkScope = { ...scope };
      window.factoryRuntimeReadFactory = () => factory;
      window.buildExportHtml = () => '<main><section>부분미리보기상품</section></main>';

      const scoped = factoryCafe24CurrentScopedDetailHtml(factory);
      const detailModel = factoryFinalRegistrationDetailModel(factory);
      const confirmationPromise = factoryPromptFinalRegistrationConfirmation([
        '상세페이지 섹션이 남아있습니다.',
        `${detailModel.label} 상태입니다. 그래도 진행하시겠습니까?`,
      ]);
      const dialog = document.getElementById('factoryFinalRegistrationConfirmDialog');
      const confirmationText = dialog?.textContent || '';
      dialog?.querySelector('[data-factory-final-registration-confirm="confirm"]')?.click();
      const confirmed = await confirmationPromise;
      return {
        generated: detailModel.generated,
        total: detailModel.total,
        label: detailModel.label,
        ok: detailModel.ok,
        canProceed: detailModel.canProceed,
        warning: detailModel.warning,
        confirmationText,
        confirmed,
        dialogRemoved: !document.getElementById('factoryFinalRegistrationConfirmDialog'),
        scopedSource: scoped.source,
        scopedBlocked: !!scoped.blocked,
        scopedSectionCount: scoped.sectionCount,
      };
    } finally {
      state.sectionContents = original.sectionContents;
      state.sectionImages = original.sectionImages;
      state.sectionGenerationMeta = original.sectionGenerationMeta;
      state.sectionWorkScope = original.sectionWorkScope;
      window.buildExportHtml = original.buildExportHtml;
      window.factoryRuntimeReadFactory = original.factoryRuntimeReadFactory;
    }
  });

  const { confirmationText, ...resultWithoutConfirmationText } = result;
  assert.deepEqual(resultWithoutConfirmationText, {
    generated: 14,
    total: 15,
    label: '14/15개 섹션 생성',
    ok: false,
    canProceed: true,
    warning: '상세페이지 섹션이 남아있습니다: 14/15개 섹션 생성',
    confirmed: true,
    dialogRemoved: true,
    scopedSource: 'current-section-export',
    scopedBlocked: false,
    scopedSectionCount: 14,
  });
  assert.match(confirmationText, /14\/15개 섹션 생성 상태입니다\. 그래도 진행하시겠습니까\?/);
});

test('1/15 미리보기라도 확인창 후 최종 등록을 시도할 수 있다', async () => {
  const result = await browser.call(() => {
    const requiredIds = orderedSections().map(section => section.id).filter(Boolean);
    const scope = {
      currentRunId: 'single-preview-run',
      productKey: '단일미리보기상품',
      inputImageFingerprint: 'single-preview-image',
    };
    const original = {
      sectionContents: state.sectionContents,
      sectionImages: state.sectionImages,
      sectionGenerationMeta: state.sectionGenerationMeta,
      sectionWorkScope: state.sectionWorkScope,
      buildExportHtml: window.buildExportHtml,
      factoryRuntimeReadFactory: window.factoryRuntimeReadFactory,
    };
    const factory = {
      assets: [],
      product: {
        userProductName: '단일미리보기상품',
        finalDb: { product_name: '단일미리보기상품' },
        currentRunId: scope.currentRunId,
        lockedInputImageFingerprint: scope.inputImageFingerprint,
      },
    };
    try {
      state.sectionContents = {
        [requiredIds[0]]: { headline: '단일미리보기상품', body_text: '현재 미리보기 섹션' },
      };
      state.sectionImages = { [requiredIds[0]]: 'https://example.invalid/single.png' };
      state.sectionGenerationMeta = { [requiredIds[0]]: { ...scope, sectionId: requiredIds[0] } };
      state.sectionWorkScope = { ...scope };
      window.factoryRuntimeReadFactory = () => factory;
      window.buildExportHtml = () => '';

      const detailModel = factoryFinalRegistrationDetailModel(factory);
      return {
        generated: detailModel.generated,
        label: detailModel.label,
        ok: detailModel.ok,
        canProceed: detailModel.canProceed,
        warning: detailModel.warning,
        reason: detailModel.reason,
      };
    } finally {
      state.sectionContents = original.sectionContents;
      state.sectionImages = original.sectionImages;
      state.sectionGenerationMeta = original.sectionGenerationMeta;
      state.sectionWorkScope = original.sectionWorkScope;
      window.buildExportHtml = original.buildExportHtml;
      window.factoryRuntimeReadFactory = original.factoryRuntimeReadFactory;
    }
  });

  assert.deepEqual(result, {
    generated: 1,
    label: '1/15개 섹션 생성',
    ok: false,
    canProceed: true,
    warning: '상세페이지 섹션이 남아있습니다: 1/15개 섹션 생성 실제 미리보기에 생성된 섹션이 1/15개입니다. 남은 섹션을 생성하거나 미리보기에서 직접 채워주세요.',
    reason: '',
  });
});

test('최상위 범위가 복구되지 않은 14/15 미리보기도 개별 섹션 범위가 맞으면 등록 확인창을 연다', async () => {
  const result = await browser.call(async () => {
    const requiredIds = orderedSections().map(section => section.id).filter(Boolean);
    const scope = {
      currentRunId: 'partial-individual-scope-run',
      productKey: '부분개별범위상품',
      inputImageFingerprint: 'partial-individual-scope-image',
    };
    const original = {
      sectionContents: state.sectionContents,
      sectionImages: state.sectionImages,
      sectionGenerationMeta: state.sectionGenerationMeta,
      sectionWorkScope: state.sectionWorkScope,
      buildExportHtml: window.buildExportHtml,
      factoryRuntimeReadFactory: window.factoryRuntimeReadFactory,
    };
    const factory = {
      assets: [],
      product: {
        userProductName: '부분개별범위상품',
        finalDb: { product_name: '부분개별범위상품' },
        currentRunId: scope.currentRunId,
        lockedInputImageFingerprint: scope.inputImageFingerprint,
      },
    };
    try {
      state.sectionContents = Object.fromEntries(requiredIds.slice(0, -1).map((id, index) => [
        id,
        {
          headline: index === 0 ? '부분개별범위상품' : `${index + 1}번 섹션`,
          body_text: '개별 범위가 확인된 현재 미리보기 섹션',
          __sectionWorkScope: { ...scope, sectionId: id },
        },
      ]));
      state.sectionImages = Object.fromEntries(requiredIds.slice(0, -1).map(id => [id, `https://example.invalid/${id}.png`]));
      state.sectionGenerationMeta = {};
      state.sectionWorkScope = {};
      window.factoryRuntimeReadFactory = () => factory;
      window.buildExportHtml = () => '<main><section>부분개별범위상품</section></main>';

      const scoped = factoryCafe24CurrentScopedDetailHtml(factory);
      const detailModel = factoryFinalRegistrationDetailModel(factory);
      return {
        generated: detailModel.generated,
        total: detailModel.total,
        canProceed: detailModel.canProceed,
        scopedSource: scoped.source,
        scopedBlocked: !!scoped.blocked,
        scopedSectionCount: scoped.sectionCount,
      };
    } finally {
      state.sectionContents = original.sectionContents;
      state.sectionImages = original.sectionImages;
      state.sectionGenerationMeta = original.sectionGenerationMeta;
      state.sectionWorkScope = original.sectionWorkScope;
      window.buildExportHtml = original.buildExportHtml;
      window.factoryRuntimeReadFactory = original.factoryRuntimeReadFactory;
    }
  });

  assert.deepEqual(result, {
    generated: 14,
    total: 15,
    canProceed: true,
    scopedSource: 'current-section-export',
    scopedBlocked: false,
    scopedSectionCount: 14,
  });
});

test('고객 섹션 문구에서는 작업용 라벨만 제거하고 실제 문구는 보존한다', async () => {
  // Given: 한글/영문 작업 라벨과 실제 고객 문구가 섞인 텍스트를 준비한다.
  // When: 실제 고객 노출 문구 정리 함수를 호출한다.
  const result = await browser.call(() => ({
    prefixedKo: publicSectionText('[헤더] 나비수저집'),
    prefixedEn: publicSectionText('[Header] 나비수저집'),
    standalone: publicSectionText('Header'),
    multiline: publicSectionText('헤더\n매일 쓰기 좋은 수저집'),
    customerText: publicSectionText('오늘 주문하면 내일 출고됩니다.'),
  }));
  // Then: [헤더]/[Header]는 사라지고 고객에게 필요한 문구만 남아야 한다.
  assert.deepEqual(result, {
    prefixedKo: '나비수저집', prefixedEn: '나비수저집', standalone: '',
    multiline: '매일 쓰기 좋은 수저집', customerText: '오늘 주문하면 내일 출고됩니다.',
  });
});

test('DB/Cafe24 후보의 상품 범위 키가 다르면 현재 제품 후보에서 제외한다', async () => {
  // Given: 현재 상품과 동일한 후보, 다른 상품 후보, 비어 있는 후보를 준비한다.
  // When: 실제 후보 식별 충돌 함수를 호출한다.
  const result = await browser.call(() => ({
    same: factoryObjectConflictsWithIdentity({ sourceMap: { productKey: '나비수저집' } }, '나비수저집'),
    other: factoryObjectConflictsWithIdentity({ sourceMap: { productKey: '다른상품' } }, '나비수저집'),
    empty: factoryObjectConflictsWithIdentity({}, '나비수저집'),
    structured: factoryReviewCandidateProductKey({ reviewProductScopeKey: 'run-a::나비수저집::candidate-review' }),
  }));
  // Then: 다른 상품만 충돌로 판정하고 구조화된 현재 상품 키를 정확히 읽어야 한다.
  assert.deepEqual(result, { same: false, other: true, empty: false, structured: '나비수저집' });
});

test('작업파일 표시명이 제품명과 달라도 생성 이미지와 선택 상태를 격리하지 않는다', async () => {
  // Given: 사용자가 이름을 바꿔 저장한 작업파일 안에 현재 제품의 완성 이미지와 선택 상태가 있다.
  const result = await browser.call(() => {
    const makePayload = productName => ({
      currentProjectName: '7월 Cafe24 등록용 최종본',
      productName,
      cuts: {
        prompts: [{ prompt: `제품명: ${productName}\n상세페이지 이미지컷` }],
        results: [{ id: 'cut-result-current' }],
      },
      factory: {
        product: { productName },
        assets: [
          { id: 'hero-current', stageId: 'hero', used: true, rejected: false, metadata: {} },
          { id: 'size-current', stageId: 'size', used: true, rejected: false, metadata: {} },
          { id: 'cut-current', stageId: 'cuts', used: true, rejected: false, metadata: {} },
        ],
        stages: {
          hero: { status: 'done', selectedAssetIds: ['hero-current'] },
          size: { status: 'done', selectedAssetIds: ['size-current'] },
          cuts: { status: 'done', selectedAssetIds: ['cut-current'] },
        },
      },
    });
    const renamedWorkfile = sanitizeLastWorkPayloadProductScope(makePayload('슬라브나비수저집'), {
      targetName: '슬라브나비수저집',
    });
    const otherProduct = sanitizeLastWorkPayloadProductScope(makePayload('이전빨간상품'), {
      targetName: '슬라브나비수저집',
    });
    const snapshot = payload => ({
      currentProjectName: payload.currentProjectName,
      rejected: payload.factory.assets.map(asset => !!asset.rejected),
      used: payload.factory.assets.map(asset => !!asset.used),
      heroStatus: payload.factory.stages.hero.status,
      heroSelected: payload.factory.stages.hero.selectedAssetIds,
      sizeSelected: payload.factory.stages.size.selectedAssetIds,
      cutsSelected: payload.factory.stages.cuts.selectedAssetIds,
      cutResultCount: payload.cuts.results?.length || 0,
    });
    return {
      renamedWorkfile: snapshot(renamedWorkfile),
      otherProduct: snapshot(otherProduct),
    };
  });

  // Then: 표시명 차이는 보존하고, 실제 제품 identity가 바뀐 경우에만 생성물을 격리한다.
  assert.deepEqual(result.renamedWorkfile, {
    currentProjectName: '7월 Cafe24 등록용 최종본',
    rejected: [false, false, false],
    used: [true, true, true],
    heroStatus: 'done',
    heroSelected: ['hero-current'],
    sizeSelected: ['size-current'],
    cutsSelected: ['cut-current'],
    cutResultCount: 1,
  });
  assert.deepEqual(result.otherProduct, {
    currentProjectName: '7월 Cafe24 등록용 최종본',
    rejected: [true, true, true],
    used: [false, false, false],
    heroStatus: 'idle',
    heroSelected: [],
    sizeSelected: [],
    cutsSelected: [],
    cutResultCount: 0,
  });
});

test('같은 작업파일의 서버 저장본은 브라우저에 남은 오래된 제품명보다 저장본 제품명을 우선한다', async () => {
  // Given: 브라우저에는 Cafe24 전송명이 잘못 현재 제품명으로 남았지만, 같은 workspace 서버 저장본은 정상 제품명을 가진다.
  const result = await browser.call(() => ({
    helperExists: typeof lastWorkHydrationTargetName === 'function',
    incomingWins: typeof lastWorkHydrationTargetName === 'function'
      ? lastWorkHydrationTargetName(
          { factory: { product: { productName: '슬라브나비수저집' } } },
          { factory: { product: { productName: '슬라브나비수저집' } } },
          '슬라브나비수저집테스트',
          true,
        )
      : '',
    currentFallback: typeof lastWorkHydrationTargetName === 'function'
      ? lastWorkHydrationTargetName({}, null, '슬라브나비수저집', true)
      : '',
  }));

  // Then: 같은 workspace에서 읽은 저장본 identity가 복원 기준이며, 저장본에 이름이 없을 때만 현재 이름을 사용한다.
  assert.deepEqual(result, {
    helperExists: true,
    incomingWins: '슬라브나비수저집',
    currentFallback: '슬라브나비수저집',
  });
});

test('작업파일의 IndexedDB 표식은 이미 복원된 상세 이미지 URL을 덮지 않는다', async () => {
  // Given: 서버 정상본에서 복원한 로컬 아카이브 URL 위로 작업파일의 IndexedDB 표식이 뒤늦게 들어온다.
  const result = await browser.call(() => ({
    helperExists: typeof mergeRuntimeSectionImages === 'function',
    merged: typeof mergeRuntimeSectionImages === 'function'
      ? mergeRuntimeSectionImages(
          {
            header: 'http://127.0.0.1:5050/api/local-archive/assets/header/image',
            specifications: 'http://127.0.0.1:5050/api/local-archive/assets/spec-old/image',
          },
          {
            header: '__stored_in_indexeddb__',
            specifications: 'http://127.0.0.1:5050/api/local-archive/assets/spec-new/image',
            removed: null,
          },
        )
      : {},
  }));

  // Then: 표식만 실제 URL을 보존하고, 새 URL과 명시적 null은 입력값을 그대로 따른다.
  assert.deepEqual(result, {
    helperExists: true,
    merged: {
      header: 'http://127.0.0.1:5050/api/local-archive/assets/header/image',
      specifications: 'http://127.0.0.1:5050/api/local-archive/assets/spec-new/image',
      removed: null,
    },
  });
});

test('후보 확정은 사이즈이미지 생성 엔진을 예약하지 않고 생성 대기만 남긴다', async () => {
  // Given: DB/Cafe24 후보가 확정되어 실제 사이즈값과 확인 상태가 모두 있는 작업을 준비한다.
  // When: 후보 확정 뒤 호출되는 사이즈 준비 함수를 실제 브라우저 런타임에서 실행한다.
  const result = await browser.call(async () => {
    const originalFactory = structuredClone(factoryRuntimeReadFactory());
    const originals = {
      factoryHasSizeFacts: window.factoryHasSizeFacts,
      factoryAutomationSizeReviewStatus: window.factoryAutomationSizeReviewStatus,
      factoryRunStage: window.factoryRunStage,
      factorySetStageStatus: window.factorySetStageStatus,
      factoryLog: window.factoryLog,
      saveLastWorkNow: window.saveLastWorkNow,
      render: window.render,
      factoryYieldToPaint: window.factoryYieldToPaint,
    };
    const stageCalls = [];
    const statuses = [];
    const logs = [];
    try {
      const factory = normalizeFactoryState({});
      factory.automation = { ...(factory.automation || {}), sizeAutoRunRunning: false };
      factory.stages.size = { ...(factory.stages.size || {}), status: 'idle' };
      factoryRuntimeReplaceFactorySnapshot(factory, { reason: 'factory-core-size-schedule-setup' });
      window.factoryHasSizeFacts = () => true;
      window.factoryAutomationSizeReviewStatus = () => ({ confirmed: true });
      window.factoryRunStage = async stageId => {
        stageCalls.push(stageId);
        return true;
      };
      window.factorySetStageStatus = (stageId, status, message) => {
        statuses.push({ stageId, status, message });
      };
      window.factoryLog = (message, level) => {
        logs.push({ message, level });
      };
      window.saveLastWorkNow = () => {};
      window.render = () => {};
      window.factoryYieldToPaint = async () => {};

      const scheduled = factoryScheduleSizeCutAfterCandidateConfirm('신화사DB 확정');
      await new Promise(resolve => setTimeout(resolve, 40));
      return { scheduled, stageCalls, statuses, logs };
    } finally {
      factoryRuntimeReplaceFactorySnapshot(originalFactory, { reason: 'factory-core-size-schedule-restore' });
      Object.entries(originals).forEach(([name, value]) => {
        window[name] = value;
      });
    }
  });
  // Then: 후보 확정은 명시적 생성 버튼 전까지 blocked 안내만 남기고 엔진을 호출하면 안 된다.
  assert.equal(result.scheduled, false);
  assert.deepEqual(result.stageCalls, []);
  assert.equal(result.statuses.at(-1)?.stageId, 'size');
  assert.equal(result.statuses.at(-1)?.status, 'blocked');
  assert.match(result.statuses.at(-1)?.message || '', /자동 생성하지 않습니다/);
  assert.match(result.logs.at(-1)?.message || '', /사이즈이미지 생성/);
});

test('전체 자동 실행은 후보 확정 대기와 별개로 size 단계를 명시적으로 실행한다', async () => {
  // Given: 생성 엔진 대신 성공을 반환하는 stage 호출 기록기를 준비한다.
  // When: 사용자가 누른 전체 자동 실행을 실제 함수로 실행한다.
  const result = await browser.call(async () => {
    const originalFactory = structuredClone(factoryRuntimeReadFactory());
    const originals = {
      factoryRunStage: window.factoryRunStage,
      factoryLog: window.factoryLog,
      saveLastWorkNow: window.saveLastWorkNow,
      render: window.render,
    };
    const stageCalls = [];
    try {
      factoryRuntimeReplaceFactorySnapshot(normalizeFactoryState({}), { reason: 'factory-core-auto-run-setup' });
      window.factoryRunStage = async stageId => {
        stageCalls.push(stageId);
        return true;
      };
      window.factoryLog = () => {};
      window.saveLastWorkNow = () => {};
      window.render = () => {};

      await factoryRunAuto();
      return { stageCalls, goalRun: structuredClone(factoryRuntimeReadFactory().goalRun) };
    } finally {
      factoryRuntimeReplaceFactorySnapshot(originalFactory, { reason: 'factory-core-auto-run-restore' });
      Object.entries(originals).forEach(([name, value]) => {
        window[name] = value;
      });
    }
  });
  // Then: 전체 자동 실행만 DB부터 size를 포함한 순서대로 생성 엔진을 호출한다.
  assert.deepEqual(result.stageCalls, ['db', 'hero', 'size', 'options', 'cuts', 'detail', 'export']);
  assert.equal(result.goalRun.mode, 'auto');
  assert.equal(result.goalRun.running, false);
  assert.equal(result.goalRun.progress, 100);
});

test('좁은 화면에서도 사이즈 확인 완료 버튼의 실제 포인터 대상이 버튼이어야 한다', async () => {
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:size-confirm-narrow-contract',
    mode: 'editing',
    viewport: { width: 535, height: 697 },
  }, async () => {
      await Promise.resolve(window.__KUASANGSE_STARTUP_RESTORE_PROMISE__).catch(() => {});
      const stateBackup = structuredClone(state);
      const factoryBackup = structuredClone(factoryRuntimeReadFactory());
      const originals = {
        saveLastWorkNow: window.saveLastWorkNow,
        scheduleLastWorkSave: window.scheduleLastWorkSave,
        factoryLog: window.factoryLog,
      };
      try {
        state.step = 'factory';
        state.currentProjectId = 'size-confirm-narrow-contract';
        state.currentProjectName = '사이즈 확인 좁은 화면';
        state.productName = '슬라브나비수저집';
        const factory = normalizeFactoryState({});
        factory.product = {
          ...(factory.product || {}),
          productName: '슬라브나비수저집',
          userProductName: '슬라브나비수저집',
          productKey: factoryNormalizeIdentityText('슬라브나비수저집'),
          confirmedDb: {
            product_name: '슬라브나비수저집',
            dimensions: '가로 4.8cm x 세로 23cm',
            spec: { width_mm: '4.8cm', depth_mm: '23cm', product_weight_g: '4g' },
          },
        };
        factory.automation = { ...(factory.automation || {}), activeTab: 'assets' };
        factoryRuntimeReplaceFactorySnapshot(factory, {
          mode: 'hydrate',
          workspaceId: state.currentProjectId,
          reason: 'factory-core-size-pointer-setup',
        });
        window.saveLastWorkNow = () => {};
        window.scheduleLastWorkSave = () => {};
        window.factoryLog = () => {};
        await Promise.resolve(render());
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        let button = document.querySelector('[data-factory-confirm-size-image]');
        button?.scrollIntoView({ block: 'center' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        button = document.querySelector('[data-factory-confirm-size-image]');
        const pointerDownTarget = document.elementFromPoint(
          button.getBoundingClientRect().left + button.getBoundingClientRect().width / 2,
          button.getBoundingClientRect().top + button.getBoundingClientRect().height / 2,
        );
        pointerDownTarget?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        const buttonAfterBackgroundPatch = document.querySelector('[data-factory-confirm-size-image]');
        buttonAfterBackgroundPatch?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        button = buttonAfterBackgroundPatch;
        const rect = button?.getBoundingClientRect();
        const point = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
        const hit = point ? document.elementFromPoint(point.x, point.y) : null;
        const review = factoryAutomationSizeReviewStatus(factoryRuntimeReadFactory());
        return {
          buttonText: button?.textContent?.trim() || '',
          disabled: !!button?.disabled,
          requiredMissing: review.requiredMissing.map(item => item.fieldId),
          hitIsButton: hit === button,
          pointerDownIsButton: pointerDownTarget === button,
          pointerIdentityStable: button === pointerDownTarget,
        };
      } finally {
        Object.keys(state).forEach(key => { delete state[key]; });
        Object.assign(state, stateBackup);
        factoryRuntimeReplaceFactorySnapshot(factoryBackup, { reason: 'factory-core-size-pointer-restore' });
        Object.entries(originals).forEach(([name, value]) => { window[name] = value; });
        await Promise.resolve(render());
      }
  });
  assert.deepEqual(result, {
    buttonText: '이 사이즈로 확인 완료',
    disabled: false,
    requiredMissing: [],
    hitIsButton: true,
    pointerDownIsButton: true,
    pointerIdentityStable: true,
  });
});

test('문서 수준 읽기 전용 편집권은 현재 탭의 독립 브랜치 조작을 잠그지 않는다', async () => {
  const result = await browser.call(() => {
    const stateBackup = structuredClone(state);
    const lockBackup = window.__KUASANGSE_WORKSPACE_LOCK__;
    let authority = null;
    try {
      state.currentProjectId = 'authority-current-workspace';
      window.__KUASANGSE_WORKSPACE_LOCK__ = {
        snapshot: () => authority,
      };
      const currentScopeId = getCurrentLastWorkWorkspaceScope();
      authority = { scopeId: 'project:authority-other-workspace', mode: 'readonly' };
      const foreignReadonly = workspaceAuthorityIsReadOnly();
      authority = { scopeId: currentScopeId, mode: 'readonly' };
      const currentReadonly = workspaceAuthorityIsReadOnly();
      authority = { scopeId: currentScopeId, mode: 'available' };
      const currentUnavailable = workspaceAuthorityIsReadOnly();
      authority = { scopeId: currentScopeId, mode: 'editing' };
      const currentEditing = workspaceAuthorityIsReadOnly();
      return { foreignReadonly, currentReadonly, currentUnavailable, currentEditing };
    } finally {
      window.__KUASANGSE_WORKSPACE_LOCK__ = lockBackup;
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
    }
  });
  assert.deepEqual(result, {
    foreignReadonly: false,
    currentReadonly: false,
    currentUnavailable: false,
    currentEditing: false,
  });
});

test('390px에서 경쟁사·이미지컷·자동화 메뉴는 주 화면 가로 스크롤을 만들지 않는다', async () => {
  // Given: 작은 창에서 고정 최소폭이 있던 세 메뉴를 실제 렌더 상태로 준비한다.
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:responsive-route-overflow',
    mode: 'editing',
    viewport: { width: 390, height: 600 },
  }, async () => {
      const stateBackup = structuredClone(state);
      const factoryBackup = structuredClone(factoryRuntimeReadFactory());
      try {
        state.currentProjectId = 'responsive-route-overflow';
        state.currentProjectName = '반응형 메뉴 회귀';
        state.productName = '슬라브나비수저집';
        factoryRuntimeReplaceFactorySnapshot(normalizeFactoryState({}), {
          mode: 'hydrate',
          workspaceId: state.currentProjectId,
          reason: 'factory-core-responsive-routes-setup',
        });
        const overflow = {};
        for (const step of ['competitor', 'imagecuts', 'automation']) {
          state.step = step;
          await Promise.resolve(render());
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const main = document.querySelector('.main');
          overflow[step] = main.scrollWidth - main.clientWidth;
        }
        return overflow;
      } finally {
        Object.keys(state).forEach(key => { delete state[key]; });
        Object.assign(state, stateBackup);
        factoryRuntimeReplaceFactorySnapshot(factoryBackup, { reason: 'factory-core-responsive-routes-restore' });
        await Promise.resolve(render());
      }
  });
  // Then: 모든 메뉴가 오른쪽 세로 스크롤 경계 안에서 폭을 줄여야 한다.
  assert.deepEqual(result, { competitor: 0, imagecuts: 0, automation: 0 });
});

test('375px에서 미리보기·조립공장·리포트의 핵심 조작은 단일 주 스크롤 안에 남는다', async () => {
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:responsive-primary-routes',
    mode: 'editing',
    viewport: { width: 375, height: 640 },
  }, async () => {
      const stateBackup = structuredClone(state);
      const factoryBackup = structuredClone(factoryRuntimeReadFactory());
      try {
        state.currentProjectId = 'responsive-primary-routes';
        state.currentProjectName = '핵심 메뉴 반응형 회귀';
        state.productName = '모시바둑파우치';
        state.sectionContents = {};
        state.sectionImages = {};
        factoryRuntimeReplaceFactorySnapshot(normalizeFactoryState({}), {
          mode: 'hydrate',
          workspaceId: state.currentProjectId,
          reason: 'factory-core-responsive-primary-routes-setup',
        });
        const routes = {};
        for (const step of ['preview', 'factory', 'reports']) {
          state.step = step;
          await Promise.resolve(render());
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const main = document.querySelector('.main');
          routes[step] = {
            overflow: main.scrollWidth - main.clientWidth,
          };
          if (step === 'preview') {
            const recovery = document.querySelector('#recoverPreviewArchiveSections');
            const outline = document.querySelector('.preview-outline');
            const mainRight = main.getBoundingClientRect().right;
            routes.preview.recoveryVisible = !!recovery;
            routes.preview.recoveryRight = recovery
              ? Math.ceil(recovery.getBoundingClientRect().right)
              : 0;
            routes.preview.outlineOverflowY = outline
              ? getComputedStyle(outline).overflowY
              : '';
            routes.preview.offenders = [...main.querySelectorAll('*')]
              .map(element => ({
                tag: element.tagName,
                id: element.id,
                className: String(element.className || ''),
                right: Math.ceil(element.getBoundingClientRect().right),
              }))
              .filter(item => item.right > Math.ceil(mainRight) + 1)
              .slice(0, 8);
          }
          if (step === 'factory') {
            const tabs = document.querySelector('.factory-automation-tabs');
            const rail = document.querySelector('.factory-run-status-rail');
            routes.factory.tabsBeforeRail = !!tabs && (
              !rail || tabs.getBoundingClientRect().top < rail.getBoundingClientRect().top
            );
            routes.factory.tabsTop = tabs
              ? Math.ceil(tabs.getBoundingClientRect().top)
              : null;
            routes.factory.railTop = rail
              ? Math.ceil(rail.getBoundingClientRect().top)
              : null;
            routes.factory.tabsOrder = tabs ? getComputedStyle(tabs).order : null;
            routes.factory.railOrder = rail ? getComputedStyle(rail).order : null;
          }
          if (step === 'reports') {
            const actions = document.querySelector('.workfile-report-actions');
            routes.reports.actionsRight = actions
              ? Math.ceil(actions.getBoundingClientRect().right)
              : 0;
          }
        }
        return { viewportWidth: window.innerWidth, routes };
      } finally {
        Object.keys(state).forEach(key => { delete state[key]; });
        Object.assign(state, stateBackup);
        factoryRuntimeReplaceFactorySnapshot(factoryBackup, { reason: 'factory-core-responsive-primary-routes-restore' });
        await Promise.resolve(render());
      }
  });

  assert.equal(
    result.routes.preview.overflow,
    0,
    JSON.stringify(result.routes.preview.offenders),
  );
  assert.equal(result.routes.factory.overflow, 0);
  assert.equal(result.routes.reports.overflow, 0);
  assert.equal(result.routes.preview.recoveryVisible, true);
  assert.ok(result.routes.preview.recoveryRight <= result.viewportWidth);
  assert.equal(result.routes.preview.outlineOverflowY, 'visible');
  assert.equal(
    result.routes.factory.tabsBeforeRail,
    true,
    JSON.stringify(result.routes.factory),
  );
  assert.ok(result.routes.reports.actionsRight <= result.viewportWidth);
});

test('1280×620에서는 ESM DB 탭의 사이즈 생성 대기 카드와 버튼에 주 화면 스크롤로 도달한다', async () => {
  // Given: 앱 사이드바까지 포함한 좁은 데스크톱 폭과 DB 후보 확정 후의 실제 ESM 조립공장 화면을 준비한다.
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:factory-rail-layout-v186',
    mode: 'editing',
    viewport: { width: 1280, height: 620 },
  }, async () => {
      const stateBackup = structuredClone(state);
      const factoryBackup = structuredClone(factoryRuntimeReadFactory());
      try {
        const productName = '상태 레일 반응형 검증 수저집';
        state.step = 'factory';
        state.currentProjectId = 'factory-rail-layout-v186';
        state.currentProjectName = '상태 레일 반응형 검증';
        state.productName = productName;
        const factory = normalizeFactoryState({});
        factory.workspace = { ...(factory.workspace || {}), id: state.currentProjectId };
        factory.product = {
          ...(factory.product || {}),
          productName,
          userProductName: productName,
          productKey: factoryNormalizeIdentityText(productName),
          selectedDbCandidateKey: 'DB-RAIL-V186',
          dbCandidateResolution: 'selected',
          confirmedDb: { jcode: 'DB-RAIL-V186', product_name: productName },
        };
        factory.automation = { ...(factory.automation || {}), activeTab: 'db' };
        factory.stages.size = {
          ...(factory.stages.size || {}),
          status: 'blocked',
          message: '신화사DB 확정 완료. 사이즈값을 확인했습니다. 사이즈이미지를 자동 생성하지 않습니다. 생성컷 선택에서 사이즈이미지 생성을 누르거나 전체 자동 실행을 사용해주세요.',
        };
        factoryRuntimeReplaceFactorySnapshot(factory, {
          mode: 'hydrate',
          workspaceId: state.currentProjectId,
          reason: 'factory-core-rail-layout-setup',
        });
        await Promise.resolve(render());
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const waitPanel = document.querySelector('[data-factory-candidate-size-wait]');
        const runButton = waitPanel?.querySelector('[data-factory-run-stage="size"]');
        const shell = document.querySelector('.factory-automation-shell');
        const body = document.querySelector('.factory-automation-body');
        const scrollRoot = document.querySelector('.app');
        waitPanel?.scrollIntoView({ block: 'center', inline: 'nearest' });
        const waitRect = waitPanel?.getBoundingClientRect();
        return {
          shell: shell ? { width: Math.round(shell.getBoundingClientRect().width), tabCount: shell.querySelectorAll('[data-factory-auto-tab]').length } : null,
          body: body ? { width: Math.round(body.getBoundingClientRect().width), scrollWidth: body.scrollWidth } : null,
          scrollRoot: scrollRoot ? { scrollHeight: scrollRoot.scrollHeight, clientHeight: scrollRoot.clientHeight, overflowY: getComputedStyle(scrollRoot).overflowY } : null,
          wait: waitRect ? { inViewport: waitRect.top >= 0 && waitRect.bottom <= window.innerHeight, runButtonVisible: !!runButton && runButton.getBoundingClientRect().width > 0 } : null,
        };
      } finally {
        Object.keys(state).forEach(key => { delete state[key]; });
        Object.assign(state, stateBackup);
        factoryRuntimeReplaceFactorySnapshot(factoryBackup, { reason: 'factory-core-rail-layout-restore' });
        await Promise.resolve(render());
      }
  });
  // Then: ESM factory shell과 7개 탭이 렌더되고, DB 대기 동작은 메인 세로 스크롤로 실제 도달 가능해야 한다.
  assert.equal(result.shell?.tabCount, 7);
  assert.ok((result.shell?.width || 0) > 0);
  assert.ok((result.body?.width || 0) > 0);
  assert.ok((result.body?.scrollWidth || 0) <= (result.body?.width || 0) + 1);
  assert.equal(result.scrollRoot?.overflowY, 'auto');
  assert.ok((result.scrollRoot?.scrollHeight || 0) > (result.scrollRoot?.clientHeight || 0));
  assert.equal(result.wait?.inViewport, true);
  assert.equal(result.wait?.runButtonVisible, true);
});

test('후보 확정 뒤 DB 탭은 사이즈 생성 대기 문구와 명시적 생성 버튼을 계속 보여준다', async () => {
  // Given: DB 후보가 확정되고 size 단계가 사용자의 명시적 실행을 기다리는 상태를 준비한다.
  // When: 실제 DB 후보 확인 패널을 렌더링한다.
  const html = await browser.call(() => {
    const originalFactory = structuredClone(factoryRuntimeReadFactory());
    try {
      const factory = normalizeFactoryState({});
      const productName = '자동 생성 차단 수저집';
      factory.product = {
        ...(factory.product || {}),
        productName,
        productKey: factoryNormalizeIdentityText(productName),
        selectedDbCandidateKey: 'DB-NO-AUTO',
        dbCandidateResolution: 'selected',
        confirmedDb: { jcode: 'DB-NO-AUTO', product_name: productName },
        candidateReviewStatus: '신화사DB 후보 확정 완료',
      };
      factory.stages.size = {
        ...(factory.stages.size || {}),
        status: 'blocked',
        message: '신화사DB 확정 완료. 사이즈값을 확인했습니다. 사이즈이미지를 자동 생성하지 않습니다. 생성컷 선택에서 사이즈이미지 생성을 누르거나 전체 자동 실행을 사용해주세요.',
      };
      return renderFactoryCandidateReviewPanels(factory);
    } finally {
      factoryRuntimeReplaceFactorySnapshot(originalFactory, { reason: 'factory-core-candidate-panels-restore' });
    }
  });
  // Then: 사용자는 DB 탭에서 대기 이유를 읽고 직접 생성 동작으로 이어갈 수 있어야 한다.
  assert.match(html, /사이즈이미지 생성 대기/);
  assert.match(html, /사이즈이미지를 자동 생성하지 않습니다/);
  assert.match(html, /data-factory-run-stage="size"/);
  assert.match(html, />사이즈이미지 생성</);
  assert.match(html, /word-break:keep-all/);
  assert.match(html, /max-width:calc\(100% - 8px\)/);
});

test('DB 후보 패널은 수집 중과 검색 결과 없음 상태를 구분하면서 후보 없음 진행 버튼을 유지한다', async () => {
  // Given: 같은 제품의 후보 수집 진행 중 상태와 실제 0건 완료 상태를 각각 준비한다.
  const views = await browser.call(() => {
    const collecting = normalizeFactoryState({});
    collecting.product.candidateReviewStatus = '후보 수집 검색어: 모시바둑파우치';
    collecting.automation.parallelProgress = {
      sinhwa: { status: 'running', progress: 45, message: '신화사DB 후보 요청 전송' },
    };

    const empty = normalizeFactoryState({});
    empty.product.candidateReviewStatus = '후보 수집 완료: 신화사DB 0건 · Cafe24 0건.';
    empty.automation.parallelProgress = {
      sinhwa: { status: 'done', progress: 100, message: '신화사DB 후보 0건', completedItemCount: 0 },
    };

    // When: 실제 후보 확인 패널 HTML을 렌더링한다.
    const stale = normalizeFactoryState({});
    stale.product.candidateReviewStatus = 'Cafe24 OAuth 재연결 필요 상태입니다.';
    stale.automation.parallelProgress = {
      sinhwa: { status: 'error', progress: 45, message: '이전 실패' },
    };
    const host = document.createElement('div');
    host.innerHTML = renderFactoryCandidateReviewPanels(stale);
    document.body.appendChild(host);
    factoryPatchCandidateCollectionStatusInPlace(collecting);
    const livePatched = {
      empty: host.querySelector('[data-factory-candidate-empty-state="sinhwa"]')?.textContent || '',
      review: host.querySelector('[data-factory-candidate-review-status]')?.textContent || '',
    };
    host.remove();

    return {
      collecting: renderFactoryCandidateReviewPanels(collecting),
      empty: renderFactoryCandidateReviewPanels(empty),
      livePatched,
    };
  });

  // Then: 진행/빈 결과가 서로 다른 상태로 보이고 신규 상품 진행 동작은 사라지지 않아야 한다.
  assert.match(views.collecting, /data-factory-candidate-collection-status="sinhwa"/);
  assert.match(views.collecting, /data-state="running"/);
  assert.match(views.collecting, /수집 중/);
  assert.match(views.empty, /data-state="empty"/);
  assert.match(views.empty, /검색 결과 없음/);
  assert.match(views.empty, /신화사DB 후보 없음으로 진행/);
  assert.match(views.empty, /data-factory-find-cafe24-inline[^>]*data-factory-guide-action="rerun-cafe24-query"/);
  assert.match(views.livePatched.empty, /후보를 수집하고 있습니다/);
  assert.match(views.livePatched.review, /후보 수집 중/);
  assert.doesNotMatch(views.livePatched.review, /OAuth 재연결 필요/);
});

test('3단계 필수값 확인 버튼은 실제 shell 렌더 뒤 현재 fields DOM에 바인딩된다', async () => {
  // Given: 실제 runtime shell에서 필수값 탭을 연 편집 가능한 작업을 준비한다.
  const result = await withFreshAuthorityBrowser({
    scopeId: 'project:factory-fields-live-binding',
    mode: 'editing',
  }, async () => {
    const stateBackup = structuredClone(state);
    const factoryBackup = structuredClone(factoryRuntimeReadFactory());
    try {
      const productName = '필수값 실바인딩 검증 수저집';
      state.step = 'factory';
      state.currentProjectId = 'factory-fields-live-binding';
      state.currentProjectName = productName;
      state.productName = productName;
      const factory = normalizeFactoryState({});
      factory.workspace = { ...(factory.workspace || {}), id: state.currentProjectId };
      factory.product = {
        ...(factory.product || {}),
        productName,
        userProductName: productName,
        productKey: factoryNormalizeIdentityText(productName),
      };
      factory.automation = { ...(factory.automation || {}), activeTab: 'fields' };
      factoryRuntimeReplaceFactorySnapshot(factory, {
        mode: 'hydrate',
        workspaceId: state.currentProjectId,
        reason: 'factory-fields-live-binding-setup',
      });
      await Promise.resolve(render());

      const runtimeDraftStateDeclared = typeof FACTORY_WIZARD_FIELD_DRAFT_STORAGE_KEY === 'string'
        && typeof factoryAutomationWizardDraftHydratedWorkKey === 'string';

      const wizard = document.getElementById('factoryAutomationWizard');
      const input = wizard?.querySelector('[data-factory-wizard-field="usage"]');
      const button = wizard?.querySelector('[data-factory-wizard-commit="usage"]');
      if (!input || !button) throw new Error('usage 필수값 입력 또는 확인 버튼이 렌더되지 않았습니다.');
      input.value = '수저 보관, 전통 선물포장 및 답례품';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      button.focus();
      button.click();
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));

      const afterIndividual = factoryRuntimeReadFactory();
      const afterIndividualWizard = document.getElementById('factoryAutomationWizard');
      const afterIndividualInput = afterIndividualWizard?.querySelector('[data-factory-wizard-field="usage"]');
      const afterIndividualCard = afterIndividualInput?.closest('.factory-automation-status-card');
      const individual = {
        reviewValue: afterIndividual.automation?.fieldReview?.usage?.value || '',
        draftExists: !!afterIndividual.automation?.fieldDrafts?.usage,
        cardText: String(afterIndividualCard?.textContent || ''),
        inputReadonly: !!afterIndividualInput?.readOnly,
      };

      const requiredValues = {
        size: '가로 4.8cm x 세로 23cm',
        width_mm: '4.8cm',
        depth_mm: '23cm',
        material: '폴리에스테르 원단',
      };
      for (const [fieldId, value] of Object.entries(requiredValues)) {
        const field = afterIndividualWizard?.querySelector(`[data-factory-wizard-field="${fieldId}"]`);
        if (!field) throw new Error(`${fieldId} 필수값 입력이 렌더되지 않았습니다.`);
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const commitAll = afterIndividualWizard?.querySelector('[data-factory-wizard-commit-all]');
      if (!commitAll) throw new Error('입력값 확인 적용 버튼이 렌더되지 않았습니다.');
      commitAll.focus();
      commitAll.click();
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));

      const current = factoryRuntimeReadFactory();
      const currentWizard = document.getElementById('factoryAutomationWizard');
      const currentInput = currentWizard?.querySelector('[data-factory-wizard-field="usage"]');
      return {
        runtimeDraftStateDeclared,
        individual,
        activeTab: current.automation?.activeTab || '',
        reviews: Object.fromEntries(
          ['size', 'width_mm', 'depth_mm', 'material', 'usage'].map(fieldId => [
            fieldId,
            current.automation?.fieldReview?.[fieldId]?.value || '',
          ]),
        ),
        allRequiredReadonly: ['size', 'width_mm', 'depth_mm', 'material', 'usage'].every(fieldId => (
          currentWizard?.querySelector(`[data-factory-wizard-field="${fieldId}"]`)?.readOnly === true
        )),
        sizeButtonDisabled: !!currentWizard?.querySelector('[data-factory-guide-action="run-size-now"]')?.disabled,
        fieldCount: currentWizard?.querySelectorAll('[data-factory-wizard-field]').length || 0,
        wizardText: String(currentWizard?.textContent || '').slice(0, 500),
      };
    } finally {
      Object.keys(state).forEach(key => { delete state[key]; });
      Object.assign(state, stateBackup);
      factoryRuntimeReplaceFactorySnapshot(factoryBackup, { reason: 'factory-fields-live-binding-restore' });
      await Promise.resolve(render());
    }
  });

  // Then: 클릭은 draft를 확정값으로 옮기고 현재 DOM을 확인 완료 상태로 다시 그려야 한다.
  assert.equal(result.runtimeDraftStateDeclared, true);
  assert.equal(result.individual.reviewValue, '수저 보관, 전통 선물포장 및 답례품');
  assert.equal(result.individual.draftExists, false);
  assert.match(result.individual.cardText, /✓ 확인됨/, JSON.stringify(result));
  assert.equal(result.individual.inputReadonly, true);
  assert.equal(result.activeTab, 'fields');
  assert.deepEqual(result.reviews, {
    size: '가로 4.8cm x 세로 23cm',
    width_mm: '4.8cm',
    depth_mm: '23cm',
    material: '폴리에스테르 원단',
    usage: '수저 보관, 전통 선물포장 및 답례품',
  });
  assert.equal(result.allRequiredReadonly, true, JSON.stringify(result));
  assert.equal(result.sizeButtonDisabled, false, JSON.stringify(result));
});
