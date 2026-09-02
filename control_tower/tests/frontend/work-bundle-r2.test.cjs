const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const MODULE = path.resolve(
  __dirname,
  '..',
  '..',
  'frontend',
  'src',
  'production-workbench.mjs',
);
const CONTROL_TOWER_HTML = path.resolve(__dirname, '..', '..', 'frontend', 'control-tower.html');

async function workbench() {
  return import(`${pathToFileURL(MODULE).href}?r2=${Date.now()}-${Math.random()}`);
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = '';
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.parentElement = null;
    this.textContent = '';
  }

  append(...children) {
    children.forEach((child) => {
      child.parentElement = this;
      this.children.push(child);
    });
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  replaceWith(replacement) {
    const index = this.parentElement?.children.indexOf(this) ?? -1;
    if (index < 0) return;
    replacement.parentElement = this.parentElement;
    this.parentElement.children[index] = replacement;
    this.parentElement = null;
  }
}

function projection(productKey = 'product-a', cursor = '7') {
  return {
    schema: 'factory-control-projection:v1',
    capabilityVersion: 'factory-control-command:v1',
    connected: true,
    cursor,
    sequence: Number(cursor),
    session: {
      productId: `factory:${productKey}`,
      productKey,
      runId: `run:${productKey}`,
      inputFingerprint: `sha256:${productKey}`,
      revision: 3,
    },
    stages: [{
      key: 'representative',
      selectedId: '',
      candidates: [{
        id: `candidate:${productKey}`,
        assetId: `asset:${productKey}`,
      }],
    }],
    registration: { jobId: `job:${productKey}` },
  };
}

function bundle(productKey = 'product-a') {
  return {
    id: `bundle:${productKey}`,
    bundleKey: `kuasangse:${productKey}`,
    assets: [{
      id: `asset:${productKey}`,
      storedAssetId: `stored:${productKey}`,
      assetKey: `output:hero:${productKey}`,
      phase: 'output',
      role: 'hero',
      factoryStageKey: 'representative',
    }],
  };
}

test('selection uses projection cursor 7 while SSE resume independently keeps BFF event 900', async () => {
  const { buildCompositeSelectionPayload, factoryEventsUrl } = await workbench();
  const value = buildCompositeSelectionPayload({
    projection: projection('product-a', '7'),
    command: { candidateId: 'candidate:product-a' },
    workBundle: bundle('product-a'),
    jobId: 'job:product-a',
    decisionMode: 'manual',
    policySnapshot: {},
    judgementOptions: {},
  });

  assert.equal(value.expectedProjectionCursor, '7');
  assert.equal(Object.hasOwn(value, 'expectedEventId'), false);
  assert.equal(factoryEventsUrl('900'), '/api/factory/events?cursor=900');
});

test('bundle target requires the current product and never falls back to the first summary', async () => {
  const { resolveWorkBundleTarget } = await workbench();
  const summaries = [
    { id: 'bundle-a', bundleKey: 'kuasangse:product-a' },
    { id: 'bundle-b', bundleKey: 'kuasangse:product-b' },
  ];

  assert.throws(
    () => resolveWorkBundleTarget(summaries, { productKey: '' }),
    error => error.code === 'work_bundle_target_required',
  );
  assert.throws(
    () => resolveWorkBundleTarget(summaries, {
      productKey: 'product-b',
      requestedId: 'bundle-a',
    }),
    error => error.code === 'decision_target_required',
  );
  assert.equal(
    resolveWorkBundleTarget(summaries, { productKey: 'product-b' }).id,
    'bundle-b',
  );
});

test('explicit bundle id loads a strictly read-only asset view without a factory session', async () => {
  const { fetchBoundWorkBundle } = await workbench();
  const requestedId = 'bundle:product-a';
  const apiRequest = async url => {
    if (url.startsWith('/api/pdp/work-bundles?')) {
      return {
        items: [
          { id: requestedId, bundleKey: 'kuasangse:product-a' },
          { id: 'bundle:product-b', bundleKey: 'kuasangse:product-b' },
        ],
        nextCursor: '',
      };
    }
    if (url.endsWith(encodeURIComponent(requestedId))) return bundle('product-a');
    throw new Error(`unexpected ${url}`);
  };

  const result = await fetchBoundWorkBundle({ apiRequest, requestedId });

  assert.equal(result.id, requestedId);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].assetKey, 'output:hero:product-a');
});

test('explicit bundle id stays read-only when an unrelated factory session is active', async () => {
  const { fetchBoundWorkBundle } = await workbench();
  const requestedId = 'bundle:product-a';
  const apiRequest = async url => {
    if (url.startsWith('/api/pdp/work-bundles?')) {
      return {
        items: [
          { id: requestedId, bundleKey: 'kuasangse:archive:product-a' },
          { id: 'bundle:live-product', bundleKey: 'kuasangse:live-workspace' },
        ],
        nextCursor: '',
      };
    }
    if (url.endsWith(encodeURIComponent(requestedId))) {
      return { ...bundle('product-a'), id: requestedId, bundleKey: 'kuasangse:archive:product-a' };
    }
    throw new Error(`unexpected ${url}`);
  };

  const result = await fetchBoundWorkBundle({
    apiRequest,
    requestedId,
    workspaceId: 'live-workspace',
    productKey: 'live-product',
  });

  assert.equal(result.id, requestedId);
  assert.equal(result.bundleKey, 'kuasangse:archive:product-a');
});

test('blank product key still binds the exact current workfile workspace bundle', async () => {
  const { resolveWorkBundleTarget } = await workbench();
  const summaries = [
    { id: 'bundle-old', bundleKey: 'kuasangse:workspace-old' },
    { id: 'bundle-current', bundleKey: 'kuasangse:workspace-current' },
  ];

  assert.equal(
    resolveWorkBundleTarget(summaries, {
      productKey: '',
      workspaceId: 'workspace-current',
    }).id,
    'bundle-current',
  );
  assert.throws(
    () => resolveWorkBundleTarget(summaries, {
      productKey: '',
      workspaceId: 'workspace-missing',
    }),
    error => error.code === 'work_bundle_target_required',
  );
});

test('completed history keeps its exact job identity in the reload route and exposes a zoom action', async () => {
  const { factoryHistoryJobFromLocation } = await workbench();
  assert.equal(
    factoryHistoryJobFromLocation('?factoryHistoryJob=factory-job-88e6ba8fa26a41b0ae396d2be6cb160a'),
    'factory-job-88e6ba8fa26a41b0ae396d2be6cb160a',
  );
  assert.equal(factoryHistoryJobFromLocation('?factoryHistoryJob='), '');

  const source = fs.readFileSync(MODULE, 'utf8');
  const html = fs.readFileSync(CONTROL_TOWER_HTML, 'utf8');
  assert.match(source, /view-work-bundle-image/);
  assert.match(html, /id=["']work-bundle-image-dialog["']/);
});

test('base route restores its only completed job instead of showing a blank session', async () => {
  const { defaultCompletedHistoryJobId } = await workbench();
  const completedJob = {
    jobId: 'factory-job-only-completed',
    status: 'completed',
  };

  assert.equal(
    defaultCompletedHistoryJobId([completedJob], {
      hasSession: false,
      historyJobId: '',
      requestedBundleId: '',
    }),
    'factory-job-only-completed',
  );
  assert.equal(
    defaultCompletedHistoryJobId([completedJob, { jobId: 'factory-job-running', status: 'running' }], {
      hasSession: false,
      historyJobId: '',
      requestedBundleId: '',
    }),
    '',
  );
  assert.equal(
    defaultCompletedHistoryJobId([completedJob], {
      hasSession: true,
      historyJobId: '',
      requestedBundleId: '',
    }),
    '',
  );
});

test('rendered work-bundle cards expose the stable asset key for exact DOM inventory checks', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const { createWorkBundleAssetCard } = await workbench();
    const asset = {
      id: 'remote-asset-id',
      assetKey: 'output:hero:stable-workfile-id',
      role: 'hero',
      stage: 'hero',
      factoryStageKey: 'representative',
      displayName: '대표 후보',
      selectionState: 'selected',
      thumbnailReference: '/api/pdp/assets/remote-asset-id/thumbnail',
    };

    const card = createWorkBundleAssetCard(asset, value => `http://127.0.0.1:5050${value}`);
    const image = card.children[0].children[0];

    assert.equal(card.dataset.assetId, 'remote-asset-id');
    assert.equal(card.dataset.assetKey, 'output:hero:stable-workfile-id');
    assert.equal(image.tagName, 'IMG');
    assert.equal(image.src, 'http://127.0.0.1:5050/api/pdp/assets/remote-asset-id/thumbnail');
    assert.equal(image.loading, 'eager');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('work-bundle card exposes an explicit error when its thumbnail URL is empty or malformed', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  try {
    const { createWorkBundleAssetCard } = await workbench();
    const card = createWorkBundleAssetCard({
      id: 'empty-thumbnail-asset',
      assetKey: 'output:section:empty-thumbnail',
      role: 'section',
      factoryStageKey: 'sections',
      displayName: '주소 없는 섹션 이미지',
      thumbnailReference: '/api/local-archive/empty/thumbnail',
    }, () => '   ');
    const frame = card.children[0];
    const errorState = frame.children[0];

    assert.equal(errorState.tagName, 'P');
    assert.equal(errorState.textContent, '이미지 주소 없음');
    assert.equal(errorState.dataset.broken, 'true');
    assert.equal(frame.dataset.action, undefined);

    const malformed = createWorkBundleAssetCard({
      id: 'malformed-thumbnail-asset',
      assetKey: 'output:section:malformed-thumbnail',
      role: 'section',
      factoryStageKey: 'sections',
      thumbnailReference: 'malformed://thumbnail',
    }, () => { throw new TypeError('malformed thumbnail URL'); });
    assert.equal(malformed.children[0].children[0].textContent, '이미지 주소 없음');
    assert.equal(malformed.children[0].children[0].dataset.broken, 'true');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('final_detail normalization preserves canonical asset and URL identity', async () => {
  const { normalizeWorkBundle, groupWorkBundleSectionAssets } = await workbench();
  const bundle = normalizeWorkBundle({
    id: 'history-bundle',
    assets: [{
      id: 'final-detail-header-v3',
      assetKey: 'output:stitched-detail:header:v3',
      phase: 'output',
      role: 'stitched-detail',
      factoryStageKey: 'final_detail',
      displayName: '헤더 최종 선택',
      thumbnailReference: '/api/local-archive/final-detail-header-v3/thumbnail',
      contentReference: '/api/local-archive/final-detail-header-v3/content',
    }],
  });
  const [asset] = bundle.assets;
  const [group] = groupWorkBundleSectionAssets(bundle.assets);

  assert.equal(group.latest, asset);
  assert.deepEqual({
    id: asset.id,
    assetKey: asset.assetKey,
    factoryStageKey: asset.factoryStageKey,
    thumbnailReference: asset.thumbnailReference,
    contentReference: asset.contentReference,
  }, {
    id: 'final-detail-header-v3',
    assetKey: 'output:stitched-detail:header:v3',
    factoryStageKey: 'final_detail',
    thumbnailReference: '/api/local-archive/final-detail-header-v3/thumbnail',
    contentReference: '/api/local-archive/final-detail-header-v3/content',
  });
});

test('current work-bundle roles keep Korean labels in the production-control surface', () => {
  const source = fs.readFileSync(MODULE, 'utf8');

  assert.match(source, /'cafe24-candidate-image': 'Cafe24 후보'/);
  assert.match(source, /'competitor-image': '경쟁사 후보'/);
  assert.match(source, /'competitor-page': '경쟁사 상세 수집'/);
  assert.match(source, /'color-option': '옵션·색상'/);
});

test('production control cache-revised module reference resolves to the workbench API', async () => {
  const html = fs.readFileSync(CONTROL_TOWER_HTML, 'utf8');
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1].replaceAll('&amp;', '&'));
  const reference = sources.find(source => source.split('?', 1)[0].endsWith('/production-workbench.mjs'));
  assert.ok(reference);
  const [relativePath, revision] = reference.split('?');
  assert.ok(revision);
  assert.equal(new URLSearchParams(revision).get('workBundleCompleteness'), '7');

  const moduleUrl = pathToFileURL(path.resolve(path.dirname(CONTROL_TOWER_HTML), relativePath));
  moduleUrl.search = `${revision}&test=${Date.now()}`;
  const loaded = await import(moduleUrl.href);
  assert.equal(typeof loaded.mountProductionWorkbench, 'function');
});

test('late product A bundle response is fenced and cannot overwrite product B', async () => {
  const { fetchBoundWorkBundle } = await workbench();
  let releaseA;
  let currentProduct = 'product-a';
  const aDetail = new Promise(resolve => { releaseA = resolve; });
  const apiRequest = async url => {
    if (url.startsWith('/api/pdp/work-bundles?')) {
      return {
        items: [
          { id: 'bundle-a', bundleKey: 'kuasangse:product-a' },
          { id: 'bundle-b', bundleKey: 'kuasangse:product-b' },
        ],
        nextCursor: '',
      };
    }
    if (url.endsWith('/bundle-a')) return aDetail;
    if (url.endsWith('/bundle-b')) return bundle('product-b');
    throw new Error(`unexpected ${url}`);
  };

  const pendingA = fetchBoundWorkBundle({
    apiRequest,
    productKey: 'product-a',
    isCurrent: () => currentProduct === 'product-a',
  });
  currentProduct = 'product-b';
  const resultB = await fetchBoundWorkBundle({
    apiRequest,
    productKey: 'product-b',
    isCurrent: () => currentProduct === 'product-b',
  });
  releaseA(bundle('product-a'));

  await assert.rejects(pendingA, error => error.code === 'stale_work_bundle_response');
  assert.equal(resultB.bundleKey, 'kuasangse:product-b');
});

test('candidate identities resolve exact stable work-bundle thumbnail keys while ambiguity remains rejected', async () => {
  const { resolveCandidateAsset } = await workbench();
  const cases = [
    { stageKey: 'representative', candidate: { id: 'factory_hero_msiiwxzy_py6qow', assetId: 'factory_hero_msiiwxzy_py6qow' }, assetKey: 'output:factory_hero_msiiwxzy_py6qow' },
    { stageKey: 'size', candidate: { id: 'factory_size_msiiwy13_u10q4y', assetId: 'factory_size_msiiwy13_u10q4y' }, assetKey: 'output:factory_size_msiiwy13_u10q4y' },
    { stageKey: 'option_color', candidate: { id: 'factory_options_msiiwy66_dx64ed', assetId: 'factory_options_msiiwy66_dx64ed' }, assetKey: 'output:factory_options_msiiwy66_dx64ed' },
    { stageKey: 'sections', candidate: { id: 'brand_story:variant-1', sectionId: 'brand_story' }, assetKey: 'output:sections:brand_story' },
    { stageKey: 'sections', candidate: { id: 'brand_story:variant-1', assetId: 'brand_story:variant-1' }, assetKey: 'output:sections:brand_story' },
    { stageKey: 'representative', candidate: { id: 'candidate-remote', assetId: 'stored-hero-uuid' }, assetKey: 'output:unrelated', storedAssetId: 'stored-hero-uuid' },
  ];

  for (const [index, item] of cases.entries()) {
    const asset = {
      id: `remote-${index}`,
      storedAssetId: item.storedAssetId || `stored-${index}`,
      assetKey: item.assetKey,
      phase: 'output',
      role: 'hero',
      factoryStageKey: item.stageKey,
      thumbnailReference: `/api/pdp/work-bundles/396ff4c0-02f9-4ea4-b9c9-d7c964256dfa/assets/remote-${index}/thumbnail`,
    };
    const matched = resolveCandidateAsset(item.candidate, [asset], item.stageKey);
    assert.equal(matched.status, 'matched');
    assert.equal(matched.asset.assetKey, item.assetKey);
    assert.equal(matched.asset.thumbnailReference, asset.thumbnailReference);
  }

  const nearMiss = resolveCandidateAsset(cases[0].candidate, [{
    id: 'remote-hero-near-miss',
    storedAssetId: 'stored-hero-near-miss',
    assetKey: `${cases[0].assetKey}:different`,
    phase: 'output',
    role: 'hero',
    factoryStageKey: 'representative',
    thumbnailReference: '/api/pdp/work-bundles/b/assets/remote-hero-near-miss/thumbnail',
  }], 'representative');
  assert.equal(nearMiss.status, 'missing');
  assert.equal(nearMiss.asset, null);

  const ambiguous = resolveCandidateAsset(
    cases[0].candidate,
    [
      {
        id: 'remote-hero-a',
        storedAssetId: 'stored-hero-a',
        assetKey: cases[0].assetKey,
        phase: 'output',
        role: 'hero',
        factoryStageKey: 'representative',
        thumbnailReference: '/api/pdp/work-bundles/b/assets/remote-hero-a/thumbnail',
      },
      {
        id: 'remote-hero-b',
        storedAssetId: 'stored-hero-b',
        assetKey: cases[0].assetKey,
        phase: 'output',
        role: 'hero',
        factoryStageKey: 'representative',
        thumbnailReference: '/api/pdp/work-bundles/b/assets/remote-hero-b/thumbnail',
      },
    ],
    'representative',
  );
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.asset, null);
});

test('event-driven automatic scheduler invokes the composite path without a button click', async () => {
  const { createAutomaticSelectionScheduler } = await workbench();
  const calls = [];
  const schedule = createAutomaticSelectionScheduler({
    submit: async (stage, mode) => {
      calls.push([stage.key, mode]);
      return { selectionStatus: 'saving' };
    },
  });

  await schedule({
    projection: projection('product-a'),
    workBundle: bundle('product-a'),
    policySnapshot: { locked: true },
    isAutomatic: () => false,
  });
  await schedule({
    projection: projection('product-b'),
    workBundle: bundle('product-b'),
    policySnapshot: { locked: true },
    isAutomatic: () => true,
  });
  const localProjection = projection('product-c');
  localProjection.registration.jobId = 'factory-job-product-c';
  await schedule({
    projection: localProjection,
    workBundle: {},
    policySnapshot: { locked: true },
    localJob: { jobId: 'factory-job-product-c', status: 'waiting_manual' },
    isAutomatic: () => true,
  });

  assert.deepEqual(calls, [['representative', 'auto'], ['representative', 'auto']]);
});

test('work-bundle reload identity changes only for a different workspace or product', async () => {
  const { workBundleIdentityChanged } = await workbench();
  const current = { workspaceId: 'workspace-a', productKey: 'product-a' };

  assert.equal(workBundleIdentityChanged(current, { ...current }), false);
  assert.equal(
    workBundleIdentityChanged(current, { ...current, workspaceId: 'workspace-b' }),
    true,
  );
  assert.equal(
    workBundleIdentityChanged(current, { ...current, productKey: 'product-b' }),
    true,
  );
  assert.equal(
    workBundleIdentityChanged(current, {
      ...current,
      workspaceId: 'workspace-b',
      productKey: 'product-b',
    }, { requestedId: 'bundle:archive-a' }),
    false,
  );
});
