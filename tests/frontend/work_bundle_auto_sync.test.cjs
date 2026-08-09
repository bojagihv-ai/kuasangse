const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function loadModule() {
  const modulePath = path.resolve(__dirname, '../../src/modules/work-bundle-auto-sync.mjs');
  return import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);
}

function fixture() {
  return {
    format: 'kuasangse.factory.project',
    version: 1,
    workspaceId: 'workspace-mosi-1',
    exportedAt: 1777777777777,
    persistence: { revision: { counter: 4 } },
    summary: {
      productName: '모시바둑파우치',
      sections: 1,
    },
    project: {
      id: 'workspace-mosi-1',
      name: '모시바둑파우치',
      payload: {
        productInfoFieldSettings: {
          product_name: { active: true, required: true },
          dimensions: { active: true, required: true },
          recommended_use: { active: true, required: true },
        },
        productInfoManualValues: {
          recommended_use: '여름 소품 보관',
        },
        sectionImages: {
          feature: 'data:image/png;base64,aGVsbG8=',
        },
        currentSectionVariantIds: {
          feature: 'variant-feature-1',
        },
        assetPayload: {
          factory: {
            product: {
              productName: '모시바둑파우치',
              finalDb: {
                jcode: 930,
                product_name: '모시바둑파우치',
                dimensions: '가로 18cm × 세로 12cm',
                source: '신화사DB API Hub',
              },
              inputImages: [
                {
                  id: 'input-red',
                  name: '1. 빨강',
                  colorName: '빨강',
                  mime: 'image/png',
                  base64: 'data:image/png;base64,aGVsbG8=',
                },
              ],
            },
            stages: {
              db: {
                targetCount: 1,
              },
              hero: {
                selectedAssetIds: ['hero-1'],
                targetCount: 2,
              },
            },
            goalRun: {
              targets: {
                hero: 4,
                size: 1,
                options: 1,
                cuts: 4,
                detail: 1,
              },
            },
            assets: [
              {
                id: 'hero-1',
                stageId: 'hero',
                title: '대표 이미지 후보 1',
                mime: 'image/png',
                imageUrl: '/api/local-archive/assets/hero-1/image',
              },
            ],
          },
        },
      },
    },
  };
}

test('자산관 동기화 출처를 실시간 작업·저장 작업파일 불러옴·직접 저장으로 구분한다', async () => {
  const { resolveWorkBundleSourceScheme } = await loadModule();

  assert.equal(resolveWorkBundleSourceScheme(), 'live-sync');
  assert.equal(resolveWorkBundleSourceScheme({ fileHandle: { name: '현재작업.kuasangse' } }), 'workfile-handle');
  assert.equal(resolveWorkBundleSourceScheme({ sourceScheme: 'loaded-workfile' }), 'loaded-workfile');
  assert.equal(resolveWorkBundleSourceScheme({ sourceScheme: 'browser-download' }), 'browser-download');
});

test('완성된 작업파일을 불러오면 저장본 출처로 전체 자산 대조를 예약한다', () => {
  const runtime = fs.readFileSync(
    path.resolve(__dirname, '../../src/app-core-03.js'),
    'utf8',
  );
  const importCompleted = runtime.indexOf("state.workfileRestoreState = 'completed';");
  const loadedWorkfileSync = runtime.indexOf(
    "void requestCurrentWorkBundleLiveSync('저장 작업파일 불러오기 최종 대조'",
  );

  assert.ok(importCompleted >= 0);
  assert.ok(loadedWorkfileSync > importCompleted);
  assert.match(
    runtime.slice(loadedWorkfileSync, loadedWorkfileSync + 320),
    /fullReconcile: true[\s\S]*sourceScheme: 'loaded-workfile'/,
  );
});

test('프로그램이 열려 있는 동안 현재 작업 묶음 활동을 백엔드로 보낸다', () => {
  const runtime = fs.readFileSync(
    path.resolve(__dirname, '../../src/app-core-03.js'),
    'utf8',
  );

  assert.match(runtime, /createWorkBundleActivityHeartbeat/);
  assert.match(runtime, /work-bundles\/activity/);
  assert.match(runtime, /intervalMs:\s*5000/);
  assert.match(runtime, /currentWorkBundleActivityHeartbeat\(\)\.then/);
});

test('작업파일을 제품 독립 입력·출력 묶음과 업로드 목록으로 분류한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();

  const plan = buildWorkBundleSyncPlan(fixture(), {
    workfileName: '모시바둑파우치.kuasangse',
    sourceLocator: 'workfile-handle://workspace-mosi-1/모시바둑파우치.kuasangse',
  });

  assert.equal(plan.manifest.bundleKey, 'kuasangse:workspace-mosi-1');
  assert.equal(plan.manifest.sourceSystem, 'sinhwa');
  assert.equal(plan.manifest.detectedJcode, 930);
  assert.equal(plan.manifest.productName, '모시바둑파우치');
  assert.equal(plan.manifest.sourcePath, 'workfile-handle://workspace-mosi-1/모시바둑파우치.kuasangse');
  assert.equal(plan.manifest.assets.length, 3);
  assert.deepEqual(
    plan.manifest.assets.map((asset) => [asset.phase, asset.stage, asset.selectionState]),
    [
      ['input', 'product', 'candidate'],
      ['output', 'hero', 'selected'],
      ['output', 'sections', 'selected'],
    ],
  );
  assert.equal(plan.uploads.length, 3);
  assert.equal(JSON.stringify(plan.manifest).includes('data:image'), false);
  assert.equal(JSON.stringify(plan.manifest).includes('aGVsbG8='), false);
});

test('복구 locator가 없는 저장 표식과 로컬 절대경로뿐인 후보는 업로드 목록에서 제외된다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const payload = value.project.payload;
  const factory = payload.assetPayload.factory;
  payload.sectionImages = {
    feature: '__stored_in_indexeddb__',
  };
  factory.product.competitors = [{
    id: 'market-1',
    title: '경쟁사 후보 1',
    local_thumbnail_path: 'C:\\outside\\market-1.jpg',
  }];
  factory.product.cafe24Candidates = [{
    product_no: 3000,
    product_name: 'Cafe24 후보 3000',
  }];

  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '저장표식-현재동작.kuasangse',
  });

  assert.equal(plan.manifest.assets.some((asset) => asset.assetKey === 'output:sections:feature'), false);
  assert.equal(plan.uploads.some((upload) => upload.assetKey === 'output:sections:feature'), false);
  assert.equal(plan.manifest.assets.some((asset) => asset.assetKey === 'input:competitor:market-1'), false);
  assert.equal(plan.manifest.assets.some((asset) => asset.assetKey === 'input:cafe24:3000'), false);
});

test('다른 작업의 section locator와 metadata-only 기본 입력은 렌더하지 않고 이유를 남긴다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const payload = value.project.payload;
  const factory = payload.assetPayload.factory;
  payload.sectionImages = { specifications: '__stored_in_indexeddb__' };
  payload.assetPayload.sectionImages = {
    specifications: 'http://127.0.0.1:5050/api/local-archive/assets/d7f2cc536c9b4e95/image',
  };
  factory.archive = {
    localAssets: [{
      archiveId: 'd7f2cc536c9b4e95',
      workspaceId: 'project_msecdey5_sc2kl1',
      currentRunId: 'factory_size_run_msecj2yx_b21e4f',
      stageId: 'size',
      sectionId: '',
    }],
  };
  const input = factory.product.inputImages[0];
  delete input.base64;
  input.hasImage = true;
  factory.product.imageBase64 = 'aGVsbG8=';
  factory.product.imageMime = 'image/png';

  const plan = buildWorkBundleSyncPlan(value, { workfileName: '잘못된-locator.kuasangse' });

  assert.equal(plan.manifest.assets.some(asset => asset.assetKey === 'output:sections:specifications'), false);
  assert.deepEqual(plan.excludedImageSources, [{
    assetKey: 'output:sections:specifications',
    reason: '원본 저장파일의 잘못된 locator라 제외',
  }]);
  assert.equal(plan.missingImageSources.length, 0);
  assert.ok(plan.manifest.assets.some(asset => asset.assetKey === 'input:input-red'));
  assert.equal(plan.uploads.find(upload => upload.assetKey === 'input:input-red')?.source, 'data:image/png;base64,aGVsbG8=');
});

test('저장 작업파일의 복구 가능한 이미지 전체만 BFF 업로드 자산으로 투영한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const payload = value.project.payload;
  const factory = payload.assetPayload.factory;
  payload.sectionImages = {
    feature: '__stored_in_indexeddb__',
    missing: '__stored_in_indexeddb__',
  };
  factory.archive = {
    localAssets: [{
      archiveId: 'section-feature-archive',
      assetId: 'section-feature-asset',
      stageId: 'section_feature',
      sectionId: 'feature',
      imageUrl: '/api/local-archive/assets/section-feature-archive/image',
    }],
  };
  factory.product.competitors = [{
    id: 'market-1',
    title: '경쟁사 후보 1',
    thumbnail_url: 'https://example.test/market-1.jpg',
  }];
  factory.product.cafe24Candidates = [{
    product_no: 3000,
    product_name: 'Cafe24 후보 3000',
    image: 'https://example.test/cafe24-3000.jpg',
  }];
  factory.assets.push({
    id: 'detail-html-only',
    stageId: 'detail',
    title: 'HTML 전용 상세 결과',
    html: '<section>상세 본문</section>',
    hasImage: false,
  });

  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '복구가능-이미지-전체.kuasangse',
  });
  const assetKeys = plan.manifest.assets.map((asset) => asset.assetKey);
  const uploadKeys = plan.uploads.map((upload) => upload.assetKey);

  assert.ok(assetKeys.includes('output:competitor:market-1'));
  assert.ok(assetKeys.includes('input:cafe24:3000'));
  assert.ok(assetKeys.includes('output:sections:feature'));
  assert.equal(assetKeys.includes('output:sections:missing'), false);
  assert.equal(assetKeys.includes('output:detail-html-only'), false);
  assert.deepEqual(
    uploadKeys.filter((key) => (
      key === 'output:competitor:market-1'
      || key === 'input:cafe24:3000'
      || key === 'output:sections:feature'
    )).sort(),
    [
      'input:cafe24:3000',
      'output:competitor:market-1',
      'output:sections:feature',
    ],
  );
});

test('수집한 경쟁사 상세페이지 이미지를 선택 상태와 함께 Output 자산으로 보존한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  value.project.payload.compPage = {
    marketScrape: {
      selectedImageIds: ['detail-page-2'],
      scrapedImages: [
        {
          id: 'detail-page-1',
          title: '경쟁사 상세페이지 1',
          src: '/api/vm-detail-capture/job-1/artifacts/0',
          candidateId: 'market-candidate-1',
          platform: 'elevenst',
        },
        {
          id: 'detail-page-2',
          title: '경쟁사 상세페이지 2',
          src: 'https://example.test/competitor-detail-2.jpg',
          candidateId: 'market-candidate-2',
          platform: 'gmarket',
        },
        {
          id: 'detail-page-3',
          title: '경쟁사 상세페이지 3',
          src: 'http://127.0.0.1:5050/api/vm-detail-capture/job-2/artifacts/1',
          candidateId: 'market-candidate-3',
          platform: 'coupang',
        },
        {
          id: 'detail-page-4',
          title: '경쟁사 상세페이지 4',
          src: 'http://127.0.0.1:5012/api/local_image?path=C%3A%5CJepumScraper%5Cdata%5Cdetail-pages%5Cdetail-4.jpg',
          candidateId: 'market-candidate-4',
          platform: 'elevenst',
        },
      ],
    },
  };

  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '경쟁사-상세페이지.kuasangse',
  });
  const assets = plan.manifest.assets.filter((asset) => asset.role === 'competitor-page');
  const uploads = plan.uploads.filter((upload) => (
    upload.assetKey.startsWith('output:competitor-detail:')
  ));

  assert.deepEqual(
    assets.map((asset) => ({
      assetKey: asset.assetKey,
      phase: asset.phase,
      stage: asset.stage,
      selectionState: asset.selectionState,
    })),
    [
      {
        assetKey: 'output:competitor-detail:detail-page-1',
        phase: 'output',
        stage: 'competitor',
        selectionState: 'candidate',
      },
      {
        assetKey: 'output:competitor-detail:detail-page-2',
        phase: 'output',
        stage: 'competitor',
        selectionState: 'selected',
      },
      {
        assetKey: 'output:competitor-detail:detail-page-3',
        phase: 'output',
        stage: 'competitor',
        selectionState: 'candidate',
      },
      {
        assetKey: 'output:competitor-detail:detail-page-4',
        phase: 'output',
        stage: 'competitor',
        selectionState: 'candidate',
      },
    ],
  );
  assert.deepEqual(uploads.map((upload) => upload.source), [
    '/api/vm-detail-capture/job-1/artifacts/0',
    '/api/image-proxy?raw=1&url=https%3A%2F%2Fexample.test%2Fcompetitor-detail-2.jpg',
    '/api/vm-detail-capture/job-2/artifacts/1',
    '/api/local-archive/source-image?source=http%3A%2F%2F127.0.0.1%3A5012%2Fapi%2Flocal_image%3Fpath%3DC%253A%255CJepumScraper%255Cdata%255Cdetail-pages%255Cdetail-4.jpg',
  ]);
});

test('경쟁사 후보 이미지는 사용자 입력이 아니라 수집 결과 자산으로 분류한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  value.project.payload.assetPayload.factory.product.competitors = [
    {
      id: 'competitor-1',
      title: '경쟁사 후보 1',
      image_url: 'data:image/png;base64,AQID',
    },
  ];

  const plan = await buildWorkBundleSyncPlan(value);
  const competitor = plan.manifest.assets.find((asset) => asset.role === 'competitor-image');

  assert.equal(competitor?.phase, 'output');
  assert.match(competitor?.assetKey || '', /^output:competitor:/);
});

test('Cafe24 snake_case 이미지 URL 후보만 있어도 Input 자산으로 보존한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  value.project.payload.assetPayload.factory.product.cafe24Candidates = [
    {
      product_no: 3001,
      product_name: '대표 URL 후보',
      image_url: 'https://example.test/cafe24-3001.jpg',
    },
    {
      product_no: 3002,
      product_name: '썸네일 URL 후보',
      thumbnail_url: 'https://example.test/cafe24-3002.jpg',
    },
    {
      product_no: 3003,
      product_name: '메타데이터 전용 후보',
    },
  ];

  const plan = buildWorkBundleSyncPlan(value, { workfileName: 'Cafe24 URL 필드.kuasangse' });
  const cafe24Assets = plan.manifest.assets.filter((asset) => asset.stage === 'cafe24');
  const cafe24Uploads = plan.uploads.filter((upload) => upload.assetKey.startsWith('input:cafe24:'));

  assert.deepEqual(cafe24Assets.map((asset) => asset.assetKey), [
    'input:cafe24:3001',
    'input:cafe24:3002',
  ]);
  assert.deepEqual(cafe24Uploads.map((upload) => upload.source), [
    '/api/image-proxy?raw=1&url=https%3A%2F%2Fexample.test%2Fcafe24-3001.jpg',
    '/api/image-proxy?raw=1&url=https%3A%2F%2Fexample.test%2Fcafe24-3002.jpg',
  ]);
});

test('같은 base ID의 서로 다른 복구 이미지는 순서와 무관한 고유 ID와 충돌 기록을 갖는다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const build = (competitors) => {
    const value = fixture();
    value.project.payload.assetPayload.factory.product.competitors = competitors;
    return buildWorkBundleSyncPlan(value, { workfileName: '충돌 후보.kuasangse' });
  };
  const firstCandidate = {
    id: 'same-market-id',
    title: '서로 다른 후보 A',
    thumbnail_url: 'https://example.test/market-a.jpg',
  };
  const secondCandidate = {
    id: 'same-market-id',
    title: '서로 다른 후보 B',
    thumbnail_url: 'https://example.test/market-b.jpg',
  };

  const forward = build([firstCandidate, secondCandidate]);
  const reverse = build([secondCandidate, firstCandidate]);
  const keys = (plan) => plan.manifest.assets
    .filter((asset) => asset.stage === 'competitor')
    .map((asset) => asset.assetKey)
    .sort();

  assert.equal(keys(forward).length, 2);
  assert.equal(new Set(keys(forward)).size, 2);
  assert.deepEqual(keys(forward), keys(reverse));
  assert.deepEqual(
    forward.assetKeyCollisions,
    [{
      baseAssetKey: 'output:competitor:same-market-id',
      assetKeys: keys(forward),
    }],
  );
  assert.deepEqual(
    forward.uploads
      .filter((upload) => upload.assetKey.startsWith('output:competitor:same-market-id'))
      .map((upload) => upload.assetKey)
      .sort(),
    keys(forward),
  );
});

test('작업파일에 설정한 이미지 목표 수량을 자산관 비교용 필드로 보존한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  value.summary.sections = 15;

  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '목표수량.kuasangse',
  });
  const targets = Object.fromEntries(
    plan.manifest.fields
      .filter((field) => field.fieldKey.startsWith('asset_target.'))
      .map((field) => [field.fieldKey, field.value]),
  );

  assert.deepEqual(targets, {
    'asset_target.base': '1',
    'asset_target.hero': '4',
    'asset_target.size': '1',
    'asset_target.options': '1',
    'asset_target.cuts': '4',
    'asset_target.sections': '15',
    'asset_target.detail': '1',
  });
  assert.match(plan.idempotencyKey, /:plan-v5$/);
});

test('같은 생성 결과가 작업파일의 두 목록에 있어도 자산관에는 한 번만 동기화한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const factory = value.project.payload.assetPayload.factory;
  factory.assets.push({
    id: 'factory-cut-1',
    stageId: 'cuts',
    title: '동일한 디테일 컷',
    mime: 'image/png',
    imageUrl: '/api/local-archive/assets/cut-1/image',
  });
  value.project.payload.cuts = {
    prompts: [{
      id: 'cuts-list-1',
      title: '동일한 디테일 컷',
      mime: 'image/png',
      result: '/api/local-archive/assets/cut-1/image',
    }],
  };

  const plan = buildWorkBundleSyncPlan(value, { workfileName: '중복 컷.kuasangse' });
  const cutAssets = plan.manifest.assets.filter((asset) => asset.stage === 'cuts');
  const cutUploads = plan.uploads.filter((upload) => upload.source === '/api/local-archive/assets/cut-1/image');

  assert.equal(cutAssets.length, 1);
  assert.equal(cutUploads.length, 1);
});

test('같은 파일을 가리켜도 factory.assets의 서로 다른 후보 ID는 모두 보존한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const factory = value.project.payload.assetPayload.factory;
  factory.assets.push(
    {
      id: 'factory-hero-candidate-a',
      stageId: 'hero',
      title: '동일 원본 대표 후보',
      mime: 'image/png',
      imageUrl: '/api/local-archive/assets/shared-hero/image',
    },
    {
      id: 'factory-hero-candidate-b',
      stageId: 'hero',
      title: '동일 원본 대표 후보',
      mime: 'image/png',
      imageUrl: '/api/local-archive/assets/shared-hero/image',
    },
  );
  factory.stages.hero.selectedAssetIds = [
    'factory-hero-candidate-a',
    'factory-hero-candidate-b',
  ];

  const plan = buildWorkBundleSyncPlan(value, { workfileName: '서로 다른 대표 후보.kuasangse' });
  const candidateKeys = new Set([
    'output:factory-hero-candidate-a',
    'output:factory-hero-candidate-b',
  ]);
  const candidates = plan.manifest.assets.filter((asset) => candidateKeys.has(asset.assetKey));
  const uploads = plan.uploads.filter((upload) => (
    upload.source === '/api/local-archive/assets/shared-hero/image'
  ));

  assert.deepEqual(candidates.map((asset) => asset.assetKey).sort(), [...candidateKeys].sort());
  assert.deepEqual(candidates.map((asset) => asset.selectionState), ['selected', 'selected']);
  assert.equal(uploads.length, 2);
});

test('작업파일 복원에서 이전 목록으로 격리된 같은 작업 후보도 자산관 출력에 보존한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const factory = value.project.payload.assetPayload.factory;
  const fingerprint = 'input-fingerprint-current';
  factory.workspace = { id: 'workspace-mosi-1' };
  factory.product.productKey = '모시바둑파우치';
  factory.product.inputImageFingerprint = fingerprint;
  factory.assets[0] = {
    ...factory.assets[0],
    workspaceId: 'workspace-mosi-1',
    productKey: '모시바둑파우치',
    inputImageFingerprint: fingerprint,
  };
  factory.previousAssets = [
    {
      id: 'hero-stage-run-candidate',
      stageId: 'hero',
      title: '저장본의 다른 대표 후보',
      mime: 'image/png',
      imageUrl: '/api/local-archive/assets/hero-1/image',
      workspaceId: 'workspace-mosi-1',
      productKey: '모시바둑파우치',
      inputImageFingerprint: fingerprint,
      metadata: {
        isolatedOnProjectFileRestore: true,
        workspaceId: 'workspace-mosi-1',
        productKey: '모시바둑파우치',
        inputImageFingerprint: fingerprint,
      },
    },
    {
      id: 'foreign-hero-candidate',
      stageId: 'hero',
      imageUrl: '/api/local-archive/assets/foreign/image',
      workspaceId: 'workspace-other',
      productKey: '다른상품',
      inputImageFingerprint: 'foreign-fingerprint',
      metadata: { isolatedOnProjectFileRestore: true },
    },
  ];
  factory.stages.hero.selectedAssetIds.push('hero-stage-run-candidate');

  const plan = buildWorkBundleSyncPlan(value, { workfileName: '격리 후보 보존.kuasangse' });
  const heroKeys = plan.manifest.assets
    .filter((asset) => asset.role === 'hero')
    .map((asset) => asset.assetKey);

  assert.deepEqual(heroKeys, ['output:hero-1', 'output:hero-stage-run-candidate']);
  assert.equal(plan.uploads.filter((upload) => (
    upload.source === '/api/local-archive/assets/hero-1/image'
  )).length, 2);
});

test('같은 파일이라도 역할이 다르면 서로 다른 자산 기록으로 보존한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const factory = value.project.payload.assetPayload.factory;
  factory.assets.push({
    id: 'factory-hero-shared',
    stageId: 'hero',
    title: '대표 이미지 후보',
    mime: 'image/png',
    imageUrl: '/api/local-archive/assets/shared-image/image',
  });
  value.project.payload.cuts = {
    prompts: [{
      id: 'cuts-feature-shared',
      title: '기능 설명 컷',
      mime: 'image/png',
      result: '/api/local-archive/assets/shared-image/image',
    }],
  };

  const plan = buildWorkBundleSyncPlan(value, { workfileName: '역할별 공유 이미지.kuasangse' });
  const sharedAssets = plan.manifest.assets.filter((asset) => (
    asset.assetKey === 'output:factory-hero-shared'
    || asset.assetKey === 'output:cuts:cuts-feature-shared'
  ));
  const sharedUploads = plan.uploads.filter((upload) => (
    upload.source === '/api/local-archive/assets/shared-image/image'
  ));

  assert.deepEqual(
    sharedAssets.map((asset) => [asset.stage, asset.role]).sort(),
    [['cuts', 'feature'], ['hero', 'hero']],
  );
  assert.equal(sharedUploads.length, 2);
});

test('신화사 제품 근거가 없으면 작업 묶음을 미연결 상태로 둔다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  value.project.payload.assetPayload.factory.product.finalDb = {};
  value.project.payload.assetPayload.factory.product.confirmedDb = {};
  value.project.payload.productInfoManualValues.jcode = 777;

  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '신규제품.kuasangse',
    sourceLocator: 'browser-download://workspace-mosi-1/신규제품.kuasangse',
  });

  assert.equal(plan.manifest.sourceSystem, 'manual');
  assert.equal(plan.manifest.detectedJcode, 777);
});

test('원본 작업파일 객체를 바꾸지 않고 동일 입력에 안정적인 묶음 키를 만든다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const before = JSON.stringify(value);

  const first = buildWorkBundleSyncPlan(value, { workfileName: '모시바둑파우치.kuasangse' });
  const second = buildWorkBundleSyncPlan(value, { workfileName: '모시바둑파우치.kuasangse' });

  assert.equal(first.manifest.bundleKey, second.manifest.bundleKey);
  assert.equal(first.idempotencyKey, second.idempotencyKey);
  assert.equal(JSON.stringify(value), before);
});

test('같은 revision에서 자산 manifest가 진화하면 이전 저장 응답을 재생하지 않는 새 멱등 키를 만든다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const before = buildWorkBundleSyncPlan(value, { workfileName: 'manifest-evolution.kuasangse' });
  value.project.payload.assetPayload.factory.product.cafe24Candidates = [{
    product_no: 3002,
    product_name: '새 Cafe24 후보',
    image_url: 'data:image/png;base64,aGVsbG8=',
  }];

  const after = buildWorkBundleSyncPlan(value, { workfileName: 'manifest-evolution.kuasangse' });

  assert.equal(before.revision, after.revision);
  assert.equal(after.manifest.assets.length, before.manifest.assets.length + 1);
  assert.notEqual(after.idempotencyKey, before.idempotencyKey);
});

test('입력 이미지와 생성된 모든 후보·선택·거절·보관 이미지를 빠짐없이 보관한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const payload = value.project.payload;
  const factory = payload.assetPayload.factory;
  factory.product.inputImages.push({
    id: 'input-blue',
    name: '2. 파랑',
    colorName: '파랑',
    mime: 'image/png',
    base64: 'data:image/png;base64,aGVsbG8=',
  });
  factory.assets.push(
    {
      id: 'hero-candidate',
      stageId: 'hero',
      title: '대표 이미지 후보 2',
      mime: 'image/png',
      imageUrl: 'data:image/png;base64,aGVsbG8=',
    },
    {
      id: 'hero-rejected',
      stageId: 'hero',
      title: '대표 이미지 제외본',
      mime: 'image/png',
      imageUrl: 'data:image/png;base64,aGVsbG8=',
      rejected: true,
    },
    {
      id: 'hero-archived',
      stageId: 'hero',
      title: '대표 이미지 보관본',
      mime: 'image/png',
      imageUrl: 'data:image/png;base64,aGVsbG8=',
      archived: true,
    },
  );
  payload.sectionImages.featureTwo = 'data:image/png;base64,aGVsbG8=';
  payload.fixedDetailImages = {
    sizeGuide: 'data:image/png;base64,aGVsbG8=',
  };
  payload.detailImageBlocks = [
    'data:image/png;base64,aGVsbG8=',
    'data:image/png;base64,aGVsbG8=',
  ];

  // Given: a workfile contains two inputs and generated images in every lifecycle state.
  // When: the save bridge builds the Sinhwa work-bundle manifest and upload list.
  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '모든이미지.kuasangse',
  });

  // Then: every image is represented once, with its state preserved and binary queued.
  assert.equal(plan.manifest.assets.length, 11);
  assert.equal(plan.uploads.length, 11);
  assert.deepEqual(
    plan.manifest.assets
      .filter((asset) => asset.phase === 'input')
      .map((asset) => asset.displayName),
    ['1. 빨강', '2. 파랑'],
  );
  assert.deepEqual(
    plan.manifest.assets
      .filter((asset) => asset.assetKey.startsWith('output:hero'))
      .map((asset) => asset.selectionState),
    ['selected', 'candidate', 'rejected', 'archived'],
  );
  assert.equal(JSON.stringify(plan.manifest).includes('data:image'), false);
});

test('현재 화면의 기본·색상옵션·대표·사이즈 생성 이미지를 로컬 보관 주소에서 빠짐없이 동기화한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const payload = value.project.payload;
  payload.sectionImages = {};
  payload.assetPayload.factory.product.inputImages = [];
  payload.assetPayload.factory.assets = [];
  payload.imagePreview = '/api/local-archive/assets/base-current/image';
  payload.cuts = {
    prompts: [{
      id: 'cut-current',
      label: '사용 장면 컷',
      result: '/api/local-archive/assets/cut-current/image',
    }],
    sizePrompts: [{
      id: 'size-current',
      label: '사이즈 안내컷',
      imageUrl: '/api/local-archive/assets/size-current/image',
      selected: true,
    }],
  };
  payload.optionSorter = {
    images: [{
      id: 'option-input-current',
      name: '1. 호박색',
      imageUrl: '/api/local-archive/assets/option-input-current/image',
    }],
    optionResults: [{
      id: 'option-output-current',
      title: '색상 옵션표',
      image: '/api/local-archive/assets/option-output-current/image',
    }],
  };

  // Given: 최신 화면 자산은 공장 자산 목록이 아니라 세션의 컷·옵션 상태에 저장돼 있다.
  // When: 실시간 신화사 자산관 동기화 계획을 만든다.
  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '양단호박바늘쌈.kuasangse',
  });

  // Then: 현재 화면에서 보이는 다섯 이미지가 모두 원본 업로드 대상이 된다.
  assert.deepEqual(
    plan.manifest.assets.map((asset) => [asset.phase, asset.stage, asset.displayName]),
    [
      ['input', 'product', '기본 이미지 1'],
      ['input', 'options', '1. 호박색'],
      ['output', 'cuts', '사용 장면 컷'],
      ['output', 'size', '사이즈 안내컷'],
      ['output', 'options', '색상 옵션표'],
    ],
  );
  assert.equal(plan.uploads.length, 5);
});

test('색상 옵션 입력 20장 중 원본이 없는 항목도 목록에서 숨기지 않고 전체 동기화를 보류한다', async () => {
  const { buildWorkBundleSyncPlan, synchronizeWorkBundlePlan } = await loadModule();
  const value = fixture();
  const payload = value.project.payload;
  payload.sectionImages = {};
  payload.assetPayload.factory.product.inputImages = [];
  payload.assetPayload.factory.assets = [];
  payload.optionSorter = {
    images: Array.from({ length: 20 }, (_, index) => ({
      id: `option-input-${index + 1}`,
      name: `${index + 1}. 색상 옵션`,
      imageUrl: index === 12
        ? ''
        : `/api/local-archive/assets/option-input-${index + 1}/image`,
    })),
    optionResults: [],
  };

  // Given: 화면에는 색상 옵션 입력 20장이 있지만 13번째 원본 주소만 복원되지 않았다.
  // When: 자산관 동기화 계획을 만들고 전송을 시도한다.
  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '색상옵션20장.kuasangse',
  });
  assert.equal(
    plan.manifest.fields.find((field) => (
      field.fieldKey === 'asset_target.option_inputs'
    ))?.value,
    '20',
  );
  let manifestCalls = 0;
  let assetCalls = 0;
  await assert.rejects(
    synchronizeWorkBundlePlan(plan, {
      sendManifest: async () => {
        manifestCalls += 1;
        return {};
      },
      fetcher: async () => new Response(
        new Blob(['image'], { type: 'image/png' }),
        { status: 200 },
      ),
      sendAsset: async () => {
        assetCalls += 1;
        return {};
      },
    }),
    /work_bundle_required_assets_missing/,
  );

  // Then: 20장 모두 manifest에 남고, 일부만 DB에 보내는 작업은 시작하지 않는다.
  assert.equal(
    plan.manifest.assets.filter((asset) => (
      asset.phase === 'input' && asset.role === 'color-option'
    )).length,
    20,
  );
  assert.equal(plan.missingRequiredAssetKeys.length, 1);
  assert.equal(manifestCalls, 0);
  assert.equal(assetCalls, 0);
});

test('작업파일에 내장된 출력 원본을 만료된 로컬 보관 주소보다 먼저 업로드한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const hero = value.project.payload.assetPayload.factory.assets[0];
  hero.image = 'data:image/png;base64,bmV3LW91dHB1dA==';

  // Given: 저장된 작업파일에는 출력 원본이 있지만 예전 로컬 보관 주소도 함께 남아 있다.
  // When: 신화사 자산관 업로드 계획을 만든다.
  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '출력원본복원.kuasangse',
  });
  const upload = plan.uploads.find((item) => item.assetKey === 'output:hero-1');

  // Then: 다시 열 수 없는 보관 주소가 아니라 작업파일에 내장된 원본을 전송한다.
  assert.ok(upload);
  assert.equal(upload.source, 'data:image/png;base64,bmV3LW91dHB1dA==');
});

test('손상된 원본 한 개가 있으면 정상 원본도 보내지 않고 전체 저장을 보류한다', async () => {
  const { synchronizeWorkBundlePlan } = await loadModule();
  const sentAssetKeys = [];
  let manifestCalls = 0;
  const plan = {
    manifest: {},
    idempotencyKey: 'work-bundle:partial-upload:r1',
    missingRequiredAssetKeys: [],
    uploads: [
      {
        assetKey: 'output:missing',
        source: '/api/local-archive/assets/missing/image',
        filename: 'missing.png',
        mimeType: 'image/png',
      },
      {
        assetKey: 'output:available',
        source: 'data:image/png;base64,aGVsbG8=',
        filename: 'available.png',
        mimeType: 'image/png',
      },
    ],
  };

  // Given: 앞쪽 출력 원본은 사라졌고 뒤쪽 출력 원본은 정상이다.
  // When: 한 번에 하나씩 자산관 파일을 동기화한다.
  await assert.rejects(
    synchronizeWorkBundlePlan(plan, {
      concurrency: 1,
      backendBaseUrl: 'http://127.0.0.1:5050',
      sendManifest: async () => {
        manifestCalls += 1;
        return {
          authoritativeSaved: true,
          bundle: {
            id: 'bundle-partial',
            assets: [
              { id: 'remote-missing', assetKey: 'output:missing', version: 1 },
              { id: 'remote-available', assetKey: 'output:available', version: 1 },
            ],
          },
        };
      },
      fetcher: async (url) => (
        String(url).includes('/missing/')
          ? { ok: false, status: 404 }
          : new Response(new Blob(['hello'], { type: 'image/png' }), { status: 200 })
      ),
      sendAsset: async ({ assetKey }) => {
        sentAssetKeys.push(assetKey);
        return { storedAssetId: `stored:${assetKey}` };
      },
    }),
    /work_bundle_assets_failed/,
  );

  // Then: 기존 파일 재사용 여부를 확인하는 manifest 뒤, 원본 검사가 끝나기 전에는 어떤 파일도 보내지 않는다.
  assert.equal(manifestCalls, 1);
  assert.deepEqual(sentAssetKeys, []);
});

test('이미 저장된 자산은 선택 상태만 바뀌어도 파일을 다시 업로드하지 않는다', async () => {
  const { synchronizeWorkBundlePlan } = await loadModule();
  const sentAssetKeys = [];
  const plan = {
    manifest: {},
    idempotencyKey: 'work-bundle:selection-only:r2',
    uploads: [
      {
        assetKey: 'output:hero-1',
        source: '/api/local-archive/assets/hero-1/image',
        filename: 'hero-1.png',
        mimeType: 'image/png',
      },
    ],
  };

  const result = await synchronizeWorkBundlePlan(plan, {
    sendManifest: async () => ({
      authoritativeSaved: true,
      bundle: {
        id: 'bundle-selection',
        assets: [
          {
            id: 'remote-hero-1',
            assetKey: 'output:hero-1',
            storedAssetId: 'stored-hero-1',
            contentReference: '/api/pdp-assets/v1/assets/stored-hero-1/content',
            version: 2,
          },
        ],
      },
    }),
    fetcher: async () => {
      throw new Error('이미 저장된 원본을 다시 읽으면 안 됩니다.');
    },
    sendAsset: async ({ assetKey }) => {
      sentAssetKeys.push(assetKey);
      return {};
    },
  });

  assert.deepEqual(sentAssetKeys, []);
  assert.equal(result.uploads.length, 0);
  assert.deepEqual(result.reusedAssetKeys, ['output:hero-1']);
});

test('IndexedDB 표식뿐인 기본 이미지는 작업파일에 내장된 원본으로 업로드한다', async () => {
  const { buildWorkBundleSyncPlan } = await loadModule();
  const value = fixture();
  const payload = value.project.payload;
  const input = payload.assetPayload.factory.product.inputImages[0];
  delete input.base64;
  input.preview = '__stored_in_indexeddb__';
  payload.productImageBackup = {
    primary: {
      base64: 'aGVsbG8=',
      mime: 'image/jpeg',
      filename: '수저집-원본.jpg',
    },
  };

  const plan = buildWorkBundleSyncPlan(value, {
    workfileName: '내장원본복원.kuasangse',
  });
  const upload = plan.uploads.find((item) => item.assetKey === 'input:input-red');

  assert.ok(upload);
  assert.equal(upload.source, 'data:image/jpeg;base64,aGVsbG8=');
  assert.equal(upload.mimeType, 'image/jpeg');
  assert.equal(plan.uploads.some((item) => item.source === '__stored_in_indexeddb__'), false);
});

test('factory mirror 한쪽만 원본이 복원돼도 manifest 기준 mirror의 입력 원본을 정확히 복구한다', async () => {
  const vm = require('node:vm');
  const runtime = fs.readFileSync(
    path.resolve(__dirname, '../../src/app-core-03.js'),
    'utf8',
  );
  const start = runtime.indexOf('function workBundleFactoryProducts(');
  const end = runtime.indexOf('async function scheduleCurrentWorkBundleSync(', start);
  const archiveCalls = [];
  const context = vm.createContext({
    structuredClone,
    factoryCurrentInputArchiveSourcePart: async (_stageId, factory) => {
      archiveCalls.push(factory);
      return {
        base64: 'exact-archive-image',
        mime: 'image/jpeg',
        name: '기준 원본.jpg',
      };
    },
  });
  vm.runInContext(
    `${runtime.slice(start, end)}\nthis.recover = withCurrentInputArchiveForWorkBundle;`,
    context,
  );
  const markerOnly = {
    productName: '모시꽃수파우치',
    productKey: '모시꽃수파우치',
    inputImageFingerprint: 'exact-fingerprint',
    inputImages: [{ id: 'base', hasImage: true, preview: '__stored_in_indexeddb__' }],
  };
  const bundle = {
    project: {
      payload: {
        factory: { product: markerOnly },
        assetPayload: {
          factory: {
            product: {
              ...markerOnly,
              imageBase64: 'mirror-only-image',
              imageMime: 'image/jpeg',
            },
          },
        },
      },
    },
  };

  const recovered = await context.recover(bundle);

  assert.equal(archiveCalls.length, 1);
  assert.equal(recovered.project.payload.factory.product.imageBase64, 'exact-archive-image');
  assert.equal(recovered.project.payload.assetPayload.factory.product.imageBase64, 'exact-archive-image');
});

test('로컬 작업파일 저장 성공 뒤에만 비차단 자산관 동기화를 예약한다', () => {
  const runtime = fs.readFileSync(
    path.resolve(__dirname, '../../src/app-core-03.js'),
    'utf8',
  );
  const manifest = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../src/runtime-manifest.json'),
    'utf8',
  ));
  const localSaveGate = runtime.indexOf(
    "if (!commitResult.clean) throw new Error(commitResult.failures?.[0]?.message || '작업파일 또는 필수 저장소 저장에 실패했습니다.');",
  );
  const syncCall = runtime.indexOf(
    "void requestCurrentWorkBundleLiveSync('작업파일 저장 최종 대조'",
  );

  assert.ok(localSaveGate >= 0);
  assert.ok(syncCall > localSaveGate);
  assert.match(
    runtime.slice(syncCall - 20, syncCall + 240),
    /requestCurrentWorkBundleLiveSync[\s\S]*immediate: true[\s\S]*fullReconcile: true[\s\S]*documentCommit: true/,
  );
  assert.ok(manifest.modules.includes('src/modules/work-bundle-auto-sync.mjs'));
  assert.ok(manifest.modules.includes('src/modules/work-bundle-live-sync.mjs'));
  assert.doesNotMatch(runtime, /SINHWA_PDP_SERVICE_KEY/);
});

test('로컬 이미지 저장·선택 변경·작업파일 저장이 각각 실시간 또는 최종 대조를 요청한다', () => {
  const workfileRuntime = fs.readFileSync(
    path.resolve(__dirname, '../../src/app-core-03.js'),
    'utf8',
  );
  const assetRuntime = fs.readFileSync(
    path.resolve(__dirname, '../../src/app-core-06.js'),
    'utf8',
  );

  assert.match(assetRuntime, /requestCurrentWorkBundleLiveSync\('생성 이미지 로컬 저장'\)/);
  assert.match(assetRuntime, /requestCurrentWorkBundleLiveSync\('기존 로컬 이미지 연결'\)/);
  assert.match(assetRuntime, /requestCurrentWorkBundleLiveSync\('이미지 선택 상태 변경'\)/);
  assert.match(workfileRuntime, /requestCurrentWorkBundleLiveSync\('작업파일 저장 최종 대조', \{/);
  assert.match(workfileRuntime, /fullReconcile: true/);
  assert.match(workfileRuntime, /window\.addEventListener\('online'/);
});
