const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');

const API_PORT = Number(process.env.CONTROL_TOWER_QA_API_PORT || 19062);
const FRONTEND_PORT = Number(process.env.CONTROL_TOWER_QA_FRONTEND_PORT || 19082);
const JOB_COUNT = Math.min(200, Math.max(2, Number(process.env.CONTROL_TOWER_QA_JOB_COUNT || 2)));
const ACTIVE_PRODUCT_B = process.env.CONTROL_TOWER_QA_ACTIVE_PRODUCT === 'B';
const FRONTEND = path.resolve(__dirname, '../../frontend');
const requests = [];
const sseClients = new Set();
const selectionCommands = [];
const resumeCommands = [];
const rebindCommands = [];
const pendingTimers = new Set();
let eventId = 41;
let sourceSequence = 41;
let revision = 9;
let approvalIssued = false;
let productBRebound = false;
let productBResumed = false;
const workBundleId = '965fe15f-88de-4b61-9421-e1ee29eeb58f';
const automationDecisions = [];
const policySnapshots = [];
const disconnectedFactoryFixture = process.env.CONTROL_TOWER_QA_FACTORY_STATE === 'disconnected';
let requestedFixtureCount = 0;
const decisionIds = [
  'sinhwa_db_product', 'cafe24_product',
  'competitor_coupang', 'competitor_smartstore', 'competitor_gmarket',
  'competitor_auction', 'competitor_elevenst', 'required_field_candidate',
  'representative_image', 'size_image', 'option_image', 'general_image',
  'section_variant', 'final_detail',
];

const stage = (key, selectedId, count = 4) => ({
  key,
  status: selectedId ? 'completed' : 'waiting_manual',
  selectedId,
  updatedAt: '2026-07-26T10:00:00+09:00',
  candidates: Array.from({ length: count }, (_, index) => {
    const id = `${key}-${String.fromCharCode(97 + index)}`;
    return {
      id,
      assetId: `asset:${key}:${index + 1}`,
      thumbnailUrl: `/api/assets/thumbnail/${key}-${index + 1}.svg`,
      digest: `sha256:${key}-${index + 1}`,
      source: index % 2 ? 'vertex-output' : 'factory-runtime',
      model: index % 2 ? 'imagen-production' : 'composition-command',
      confidence: Number((0.91 - index * 0.04).toFixed(2)),
      rationale: `${key} 단계의 실제 QA fixture 후보 ${index + 1}`,
      receipt: {
        schema: 'gpt-judgment-receipt:v1',
        model: index % 2 ? 'imagen-production' : 'gpt-5.4',
        confidence: Number((0.91 - index * 0.04).toFixed(2)),
        rationale: '등록된 factory API fixture',
      },
    };
  }),
});

let stages = [
  stage('representative', 'representative-a', 8),
  stage('size', 'size-a', 5),
  stage('option_color', 'option_color-a', 6),
  stage('general', 'general-a', 7),
  stage('sections', '', 5),
  stage('final_detail', '', 3),
];

const roleByStage = {
  representative: 'hero',
  size: 'size',
  option_color: 'color-option-output',
  general: 'feature',
  sections: 'section',
  final_detail: 'stitched-detail',
};

const workBundle = () => ({
  id: workBundleId,
  bundleKey: 'kuasangse:방울수저집',
  workfileName: '방울수저집.kuasangse',
  version: 18,
  assets: [
    {
      id: 'asset:input:base',
      assetKey: 'input:base:1',
      phase: 'input',
      stage: 'source',
      role: 'base',
      displayName: '실제 계약 입력 이미지',
      selectionState: 'source',
      thumbnailReference: `/api/pdp/work-bundles/${workBundleId}/assets/asset%3Ainput%3Abase/thumbnail`,
      version: 1,
    },
    ...stages.flatMap(stageValue => stageValue.candidates.map((candidate, index) => ({
      id: candidate.assetId,
      storedAssetId: `stored:${candidate.assetId}`,
      assetKey: `output:${roleByStage[stageValue.key]}:${index + 1}`,
      phase: 'output',
      stage: stageValue.key,
      role: roleByStage[stageValue.key],
      factoryStageKey: stageValue.key,
      displayName: `${stageValue.key} 계약 후보 ${index + 1}`,
      sourceChecksum: candidate.digest,
      selectionState: stageValue.selectedId === candidate.id ? 'selected' : 'candidate',
      thumbnailReference: stageValue.key === 'final_detail' && index === 2
        ? '/api/assets/missing/final-detail-3.svg'
        : `/api/pdp/work-bundles/${workBundleId}/assets/${encodeURIComponent(candidate.assetId)}/thumbnail`,
      version: 1,
    }))),
  ],
});

const products = count => Array.from({ length: count }, (_, index) => ({
  productId: `product-${index + 1}`,
  productKey: `fixture-product-${index + 1}`,
  progress: {
    stageKey: index % 3 === 0 ? 'sections' : 'representative',
    stageLabel: index % 3 === 0 ? '섹션 생성' : '대표 이미지',
    percent: (index * 7) % 101,
    elapsedMs: index * 900,
    mode: index % 4 === 0 ? 'manual' : 'auto',
    status: index % 17 === 0 ? 'blocked' : 'running',
  },
}));

const projectionA = fixtureCount => ({
  schema: 'factory-control-projection:v1',
  capabilityVersion: 'factory-control-command:v1',
  cursor: String(sourceSequence),
  sequence: sourceSequence,
  connected: !disconnectedFactoryFixture,
  status: disconnectedFactoryFixture ? 'blocked' : 'connected',
  blockReason: disconnectedFactoryFixture ? 'factory_heartbeat_timeout' : '',
  capturedAt: new Date().toISOString(),
  session: {
    workspaceId: 'qa:factory-session',
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    runId: 'run-qa-13',
    inputFingerprint: 'sha256:qa-input',
    revision,
    workfileName: '방울수저집.kuasangse',
  },
  inputs: [
    {
      key: 'product',
      count: 1,
      missing: [],
      items: [{ productName: '방울수저집', dbSelectedId: 'db:2994', cafe24SelectedId: 'cafe24:2994', source: 'sinhwa-db' }],
    },
    {
      key: 'requirements',
      count: 11,
      missing: [],
      items: [{ snapshotDigest: 'sha256:requirements', immutable: true }],
    },
    {
      key: 'source_images',
      count: 7,
      missing: [],
      items: [
        { id: 'base-1', name: '기본 정면', color: '', thumbnailUrl: '/api/assets/thumbnail/base-1.svg' },
        { id: 'color-1', name: '아이보리', color: '아이보리', thumbnailUrl: '/api/assets/thumbnail/color-1.svg' },
      ],
    },
    {
      key: 'strategy',
      count: 1,
      missing: [],
      items: [{ goalMode: 'auto', stageOverrides: { representative: 'manual' } }],
    },
  ],
  stages,
  progress: {
    stageKey: 'sections',
    stageLabel: '섹션 생성',
    percent: 84,
    elapsedMs: 128400,
    mode: 'auto',
    status: 'running',
    message: 'A컷 확정 event를 기다리며 다음 단계 실행 중',
  },
  registration: {
    status: 'approval_required',
    blockers: [],
    jobId: 'factory-job-qa-2994',
    batchId: 'batch-qa-13',
    productId: 'cafe24:2994',
    productKey: '방울수저집',
    categoryId: '71',
    htmlDigest: 'sha256:qa-html',
    imageDigests: ['sha256:hero', 'sha256:size', 'sha256:option', 'sha256:general'],
    selling: 'F',
    display: 'F',
    market_sync: 'F',
    idempotencyKey: `cafe24-stage:qa:방울수저집:sha256:qa-html`,
    approvalTokenState: approvalIssued ? 'issued' : 'missing',
    remoteReadbackDigest: '',
    publicationReceipt: null,
  },
  receipts: [],
  products: fixtureCount ? products(fixtureCount) : [],
});

const projectionB = fixtureCount => ({
  schema: 'factory-control-projection:v1',
  capabilityVersion: 'factory-control-command:v1',
  cursor: String(sourceSequence),
  sequence: sourceSequence,
  connected: true,
  status: productBResumed ? 'connected' : 'blocked',
  blockReason: productBResumed ? '' : 'approved_workfile_required',
  capturedAt: new Date().toISOString(),
  session: {
    workspaceId: 'qa:other-workspace',
    productId: 'cafe24:3102',
    productKey: '미니 데스크 오거나이저 B',
    runId: productBRebound ? 'run-b-87' : 'run-b-old',
    inputFingerprint: 'sha256:other-input',
    revision: productBRebound ? 87 : 20,
    workfileName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817.kuasangse',
  },
  inputs: [{ key: 'requirements', count: 3, missing: ['recommended_use'], items: [] }],
  stages: [stage('option_color', '', 2), stage('final_detail', '', 2)],
  progress: {
    stageKey: 'option_color',
    stageLabel: '옵션·색상',
    percent: productBResumed ? 52 : 48,
    elapsedMs: 22400,
    mode: 'manual',
    status: productBResumed ? 'running' : 'blocked',
    message: productBResumed ? '승인된 작업파일로 생산 재개됨' : '승인된 작업파일 연결 필요',
  },
  registration: {
    status: productBResumed ? 'approval_required' : 'blocked',
    blockers: productBResumed ? [] : ['approved_workfile_required'],
    jobId: 'job-qa-3102',
    batchId: 'batch-qa-13',
    productId: 'cafe24:3102',
    productKey: '미니 데스크 오거나이저 B',
    categoryId: '71',
    htmlDigest: 'sha256:b-html',
    imageDigests: [],
    selling: 'F',
    display: 'F',
    market_sync: 'F',
  },
  receipts: [],
  products: fixtureCount ? products(fixtureCount) : [],
});

const projection = fixtureCount => ACTIVE_PRODUCT_B ? projectionB(fixtureCount) : projectionA(fixtureCount);

const json = (response, status, payload, extra = {}) => {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': `http://127.0.0.1:${FRONTEND_PORT}`,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, X-Control-Tower-CSRF, X-Control-Tower-Session',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    ...extra,
  });
  response.end(status === 204 ? '' : JSON.stringify(payload));
};

const body = request => new Promise(resolve => {
  let value = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { value += chunk; });
  request.on('end', () => {
    try {
      resolve(value ? JSON.parse(value) : {});
    } catch {
      resolve({});
    }
  });
});

const thumbnail = (response, label) => {
  const safe = String(label).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="#222235"/><stop offset="1" stop-color="#3b3b5c"/></linearGradient></defs><rect width="320" height="240" rx="16" fill="url(#g)"/><path d="M72 174h176l-39-104H111z" fill="#818cf8" opacity=".82"/><circle cx="160" cy="115" r="35" fill="#c7d2fe" opacity=".6"/><text x="160" y="218" text-anchor="middle" fill="#f4f4f5" font-size="15" font-family="sans-serif">${safe}</text></svg>`;
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'no-store',
  });
  response.end(svg);
};

const eventPayload = (type, payload) => ({
  schema: 'factory-control-sse:v1',
  eventId: String(++eventId),
  type,
  ...payload,
});

const sendEvent = event => {
  const block = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const response of sseClients) response.write(block);
};

const fakePreview = payload => {
  const canonical = {
    batchId: payload.batchId,
    productId: payload.productId,
    productKey: payload.productKey,
    categoryId: payload.categoryId,
    htmlDigest: payload.htmlDigest,
    imageDigests: payload.imageDigests,
    expectedWorkfileRevision: payload.expectedWorkfileRevision,
    expectedRunId: payload.expectedRunId,
    expectedInputFingerprint: payload.expectedInputFingerprint,
    selling: 'F',
    display: 'F',
    market_sync: 'F',
    idempotencyKey: payload.idempotencyKey,
  };
  const payloadDigest = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  return {
    payload: canonical,
    payloadDigest,
    idempotencyKey: canonical.idempotencyKey,
    approvalRequestId: 'approval-request-qa',
    approvalTarget: {
      productId: canonical.productId,
      productKey: canonical.productKey,
      categoryId: canonical.categoryId,
      htmlDigest: canonical.htmlDigest,
      imageDigests: canonical.imageDigests,
      payloadDigest,
      idempotencyKey: canonical.idempotencyKey,
      expectedWorkfileRevision: canonical.expectedWorkfileRevision,
      expectedRunId: canonical.expectedRunId,
      expectedInputFingerprint: canonical.expectedInputFingerprint,
    },
    approvalRequired: true,
    externalWrite: false,
  };
};

const api = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${API_PORT}`);
  requests.push({ method: request.method, path: url.pathname, query: url.search });
  if (request.method === 'OPTIONS') return json(response, 204, {});
  if (url.pathname === '/api/health') {
    return json(response, 200, {
      service: 'batch-production-control',
      displayName: '생산관제',
      status: 'ready',
      version: 'factory-sync-qa',
      schemaVersion: '1',
      listen: { host: '127.0.0.1', port: API_PORT },
      links: { factoryFrontend: 'QA factory API', factoryBackend: 'QA in-memory bridge', apiHub: 'QA no external write' },
    });
  }
  if (url.pathname === '/api/session') {
    return json(response, 200, { session: 'ready', sessionId: 'qa-session', csrfToken: 'qa-csrf' });
  }
  if (url.pathname === '/api/playbooks/gpt-oauth/status') return json(response, 200, {
    connectorId: 'chatgpt_login_oauth',
    mode: 'chatgpt-login-oauth',
    authMode: 'chatgpt',
    chatGptLoginReady: true,
  });
  if (url.pathname === '/api/llm/options') return json(response, 200, {
    latestModel: 'gpt-5.6-sol',
    modelOptions: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-luna' }],
    reasoningOptions: ['low', 'medium', 'high', 'xhigh'].map(id => ({ id })),
    serviceTierOptions: ['standard', 'fast', 'flex'].map(id => ({ id })),
  });
  if (url.pathname === '/api/automation/policy' && request.method === 'GET') {
    return json(response, 200, {
      schema: 'automation-policy-registry:v1',
      defaultPreset: 'full_auto',
      decisionPointIds: decisionIds,
      competitorMarkets: ['coupang', 'smartstore', 'gmarket', 'auction', 'elevenst'],
      presets: {
        full_auto: Object.fromEntries(decisionIds.map(id => [id, 'auto'])),
      },
      precedence: ['stage', 'product', 'batch', 'batch_preset', 'auto_default'],
    });
  }
  if (url.pathname === '/api/automation/policy/snapshot' && request.method === 'POST') {
    const payload = await body(request);
    const snapshot = {
      schema: 'automation-policy-snapshot:v2',
      snapshotVersion: 2,
      snapshotId: `policy:qa:${policySnapshots.length + 1}`,
      batchId: payload.batchId,
      productId: payload.productId,
      preset: payload.preset || 'full_auto',
      resolved: Object.fromEntries(decisionIds.map(id => [
        id,
        payload.stageOverride?.[id]
          || payload.productOverride?.[id]
          || payload.batchOverride?.[id]
          || 'auto',
      ])),
      effectiveSources: Object.fromEntries(decisionIds.map(id => [
        id,
        payload.stageOverride?.[id]
          ? 'stage'
          : payload.productOverride?.[id]
            ? 'product'
            : payload.batchOverride?.[id]
              ? 'batch'
              : 'batch_preset',
      ])),
      locked: true,
    };
    policySnapshots.push(snapshot);
    return json(response, 201, snapshot);
  }
  if (url.pathname === '/api/automation/decisions' && request.method === 'POST') {
    const payload = await body(request);
    const selected = payload.candidates?.[1]?.candidateId || payload.candidates?.[0]?.candidateId || null;
    const receipt = {
      schema: 'gpt-judgment-receipt:v1',
      receiptId: `judgment:qa:${automationDecisions.length + 1}`,
      decisionType: payload.decisionType,
      decisionMethod: 'gpt_oauth_single_review',
      selectedCandidateId: selected,
      model: payload.judgementOptions?.model === 'latestModel' ? 'gpt-5.6-sol' : payload.judgementOptions?.model,
      reasoningEffort: payload.judgementOptions?.reasoningEffort,
      serviceTier: payload.judgementOptions?.serviceTier,
      preset: payload.judgementOptions?.preset,
      confidence: 0.94,
      threshold: { confidence: 0.75 },
      rationale: 'QA registered OAuth decision bridge selected the strongest referenced candidate.',
      holdReason: '',
      policySnapshotId: payload.policySnapshot?.snapshotId,
      productId: payload.identity?.productId,
      productKey: payload.identity?.productKey,
      runId: payload.identity?.runId,
      inputFingerprint: payload.identity?.inputFingerprint,
      revision: payload.identity?.revision,
      eventId: payload.identity?.eventId,
      persistence: { decisionId: `pdp-decision-qa-${automationDecisions.length + 1}` },
    };
    automationDecisions.push({ payload, receipt });
    return json(response, 200, {
      status: selected ? 'selected' : 'manual_required',
      candidateId: selected,
      reason: selected ? 'judgement_thresholds_passed' : 'candidate_empty',
      receipt,
    });
  }
  if (url.pathname === '/api/factory/state') {
    const fixtureCount = Math.min(200, Math.max(0, Number(url.searchParams.get('fixtureCount') || 0)));
    requestedFixtureCount = fixtureCount;
    return json(response, 200, projection(fixtureCount));
  }
  if (url.pathname === '/api/factory/jobs' && request.method === 'GET') {
    const jobs = [
      {
        schema: 'factory-product-job:v1',
        jobId: 'factory-job-qa-2994',
        batchId: 'batch-qa-13',
        sourceKind: 'sinhwa-db',
        productName: '방울수저집',
        workfileName: '방울수저집.kuasangse',
        jcode: '2994',
        mode: 'manual',
        status: 'waiting_manual',
        stageKey: 'sections',
        message: '섹션 A컷 선택 대기',
        decisionStatus: 'waiting_manual',
        imageCount: 7,
        attempts: 1,
        checkpointAvailable: true,
      },
      {
        schema: 'factory-product-job:v1',
        jobId: 'job-qa-3102',
        batchId: 'batch-qa-13',
        sourceKind: 'direct',
        productName: '긴 한글 제품명 검증용 미니 데스크 오거나이저 B',
        workfileName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817.kuasangse',
        jcode: '3102',
        mode: 'auto',
        status: productBResumed ? 'running' : 'blocked',
        stageKey: productBResumed ? 'final_detail' : 'option_color',
        message: productBResumed
          ? '승인된 작업파일로 생산 재개됨'
          : productBRebound
            ? '승인 파일 연결 완료 · 작업 재개 대기'
            : '승인된 작업파일 연결 필요',
        decisionStatus: productBResumed ? 'running' : productBRebound ? 'resume_required' : 'blocked',
        imageCount: 11,
        attempts: 2,
        checkpointAvailable: true,
      },
    ];
    for (let index = 3; index <= JOB_COUNT; index += 1) {
      jobs.push({
        schema: 'factory-product-job:v1',
        jobId: `job-qa-${index}`,
        batchId: 'batch-qa-13',
        sourceKind: index % 2 ? 'sinhwa-db' : 'direct',
        productName: `대량 생산 제품 ${String(index).padStart(3, '0')}`,
        workfileName: `대량 생산 제품 ${String(index).padStart(3, '0')}.kuasangse`,
        jcode: String(3000 + index),
        mode: index % 3 ? 'auto' : 'manual',
        status: index % 5 ? 'queued' : 'completed',
        stageKey: index % 5 ? 'representative' : 'final_detail',
        message: index % 5 ? '생산 대기' : '생산 완료',
        decisionStatus: index % 5 ? 'queued' : 'completed',
        imageCount: index % 12,
        attempts: 0,
        checkpointAvailable: index % 5 === 0,
      });
    }
    return json(response, 200, {
      jobs,
      total: jobs.length,
    });
  }
  if (url.pathname === '/api/pdp/work-bundles' && request.method === 'GET') {
    const bundle = workBundle();
    return json(response, 200, {
      items: [{
        id: bundle.id,
        bundleKey: bundle.bundleKey,
        workfileName: bundle.workfileName,
        inputAssetCount: 1,
        outputAssetCount: bundle.assets.length - 1,
        version: bundle.version,
      }],
      nextCursor: '',
    });
  }
  if (url.pathname === `/api/pdp/work-bundles/${workBundleId}` && request.method === 'GET') {
    return json(response, 200, workBundle());
  }
  if (
    url.pathname.startsWith(`/api/pdp/work-bundles/${workBundleId}/assets/`)
    && url.pathname.endsWith('/thumbnail')
  ) {
    if (decodeURIComponent(url.pathname).includes('asset:final_detail:3')) {
      return json(response, 404, { error: { code: 'qa_broken_thumbnail' } });
    }
    return thumbnail(response, decodeURIComponent(url.pathname.split('/').at(-2)));
  }
  if (url.pathname === '/api/factory/events') {
    response.writeHead(200, {
      'Access-Control-Allow-Origin': `http://127.0.0.1:${FRONTEND_PORT}`,
      'Access-Control-Allow-Credentials': 'true',
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
    });
    const snapshot = eventPayload('factory.snapshot', { projection: projection(requestedFixtureCount) });
    response.write(`id: ${snapshot.eventId}\nevent: ${snapshot.type}\ndata: ${JSON.stringify(snapshot)}\n\n`);
    sseClients.add(response);
    request.on('close', () => sseClients.delete(response));
    return;
  }
  if (url.pathname === '/api/factory/refresh' && request.method === 'POST') {
    return json(response, 202, { accepted: true, order: { command: { kind: 'factory-control', name: 'getFactoryProjection' } } });
  }
  if (url.pathname === '/api/factory/jobs/job-qa-3102/workfile-rebind' && request.method === 'POST') {
    const payload = await body(request);
    const workfileText = String(payload.workfileText || '');
    const workfileTextSha256 = crypto.createHash('sha256').update(workfileText).digest('hex');
    rebindCommands.push({
      ...payload,
      workfileText: undefined,
      workfileTextLength: workfileText.length,
      workfileTextSha256,
    });
    const valid = payload.expectedWorkspaceId === 'qa:other-workspace'
      && payload.expectedProductId === 'cafe24:3102'
      && payload.expectedProductKey === '미니 데스크 오거나이저 B'
      && payload.expectedRunId === 'run-b-87'
      && payload.expectedInputFingerprint === 'sha256:other-input'
      && payload.expectedWorkfileRevision === 20
      && payload.expectedHydratedWorkfileRevision === 87
      && payload.expectedCheckpointRevision === 20
      && payload.expectedCheckpointRunId === 'run-b-old'
      && workfileText.trim().length > 0
      && /^[a-f0-9]{64}$/u.test(String(payload.expectedSha256 || ''))
      && payload.expectedSha256 === workfileTextSha256;
    if (!valid) return json(response, 409, { error: { code: 'factory_workfile_rebind_identity_mismatch' } });
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      productBRebound = true;
      sourceSequence += 1;
      sendEvent(eventPayload('factory.product.checkpoint.rebound', {
        receipt: {
          schema: 'factory-product-checkpoint-rebind-receipt:v1',
          jobId: 'job-qa-3102',
          oldRevision: 20,
          oldRunId: 'run-b-old',
          newRevision: 87,
          newRunId: 'run-b-87',
        },
        job: {
          jobId: 'job-qa-3102',
          productName: '긴 한글 제품명 검증용 미니 데스크 오거나이저 B',
          workfileName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817.kuasangse',
          mode: 'manual',
          status: 'blocked',
          stageKey: 'option_color',
          message: '승인 파일 연결 완료 · 작업 재개 대기',
          decisionStatus: 'resume_required',
          checkpointAvailable: true,
        },
      }));
    }, 350);
    pendingTimers.add(timer);
    return json(response, 202, {
      accepted: true,
      status: 'queued',
      job: { jobId: 'job-qa-3102', status: 'blocked', stageKey: 'option_color', checkpointAvailable: true },
    });
  }
  if (url.pathname === '/api/factory/jobs/job-qa-3102/resume' && request.method === 'POST') {
    const payload = await body(request);
    resumeCommands.push(payload);
    if (!productBRebound || payload.expectedCheckpointRevision !== 87 || payload.expectedCheckpointRunId !== 'run-b-87') {
      return json(response, 409, { error: { code: 'factory_product_checkpoint_stale' } });
    }
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      productBResumed = true;
      sourceSequence += 1;
      sendEvent(eventPayload('factory.product.updated', {
        projection: projection(0),
        job: {
          jobId: 'job-qa-3102',
          productName: '긴 한글 제품명 검증용 미니 데스크 오거나이저 B',
          workfileName: '수동 A컷 검증 미니 데스크 오거나이저 B 20260817.kuasangse',
          mode: 'manual',
          status: 'running',
          stageKey: 'final_detail',
          checkpointAvailable: true,
        },
      }));
    }, 350);
    pendingTimers.add(timer);
    return json(response, 202, {
      accepted: true,
      status: 'queued',
      job: { jobId: 'job-qa-3102', status: 'blocked', stageKey: 'option_color', checkpointAvailable: true },
    });
  }
  if (url.pathname === '/api/factory/jobs/factory-job-qa-2994/resume' && request.method === 'POST') {
    const payload = await body(request);
    resumeCommands.push(payload);
    if (
      payload.expectedCheckpointRevision !== revision
      || payload.expectedCheckpointRunId !== 'run-qa-13'
    ) {
      return json(response, 409, { error: { code: 'factory_product_checkpoint_stale' } });
    }
    return json(response, 202, {
      accepted: true,
      status: 'queued',
      job: {
        jobId: 'factory-job-qa-2994',
        productName: '방울수저집',
        workfileName: '방울수저집.kuasangse',
        mode: 'manual',
        status: 'waiting_manual',
        stageKey: 'final_detail',
        checkpointAvailable: true,
      },
    });
  }
  if (
    (url.pathname === '/api/factory/a-cuts/select'
      || url.pathname === '/api/factory/jobs/factory-job-qa-2994/select')
    && request.method === 'POST'
  ) {
    const payload = await body(request);
    selectionCommands.push(payload);
    if (
      payload.productId !== 'cafe24:2994'
      || payload.productKey !== '방울수저집'
      || payload.expectedRunId !== 'run-qa-13'
      || payload.expectedInputFingerprint !== 'sha256:qa-input'
      || payload.expectedRevision !== revision
      || payload.expectedProjectionCursor !== String(sourceSequence)
      || Object.hasOwn(payload, 'expectedEventId')
    ) {
      return json(response, 409, { error: { code: 'stale_run_fingerprint' } });
    }
    const targetStage = stages.find(item => item.key === payload.stageKey);
    const targetCandidate = payload.decisionMode === 'auto'
      ? targetStage?.candidates[0]
      : targetStage?.candidates.find(candidate => candidate.id === payload.candidateId);
    if (!targetCandidate) {
      return json(response, 422, { error: { code: 'factory_a_cut_candidate_missing' } });
    }
    payload.candidateId = targetCandidate.id;
    const decisionReceipt = {
      schema: 'gpt-judgment-receipt:v1',
      decisionType: payload.stageKey,
      decisionMethod: payload.decisionMode === 'auto'
        ? 'deterministic_single_candidate'
        : 'manual_explicit_selection',
      selectedCandidateId: targetCandidate.id,
      selectedAssetId: targetCandidate.assetId,
      candidateAssetMap: { [targetCandidate.id]: targetCandidate.assetId },
      model: payload.decisionMode === 'auto' ? 'deterministic' : 'manual',
      reasoningEffort: payload.decisionMode === 'auto' ? 'low' : 'none',
      serviceTier: payload.judgementOptions?.serviceTier || 'standard',
      preset: payload.judgementOptions?.preset || 'manual',
      confidence: 1,
      rationale: 'QA fixture composite decision receipt',
      persistence: { decisionId: `pdp-decision-${selectionCommands.length}` },
    };
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      revision += 1;
      sourceSequence += 1;
      stages = stages.map(item => item.key === payload.stageKey
        ? { ...item, selectedId: payload.candidateId, status: 'completed', updatedAt: new Date().toISOString() }
        : item);
      const receipt = {
        schema: 'factory-a-cut-receipt:v1',
        receiptId: `factory-a-cut:qa:${payload.stageKey}:${revision}`,
        productId: payload.productId,
        productKey: payload.productKey,
        stageKey: payload.stageKey,
        candidateId: payload.candidateId,
        runId: payload.expectedRunId,
        inputFingerprint: payload.expectedInputFingerprint,
        revision,
        idempotencyKey: payload.idempotencyKey,
        selectedAt: new Date().toISOString(),
      };
      sendEvent(eventPayload('factory.a_cut.selected', { receipt, projection: projection(0) }));
    }, 700);
    pendingTimers.add(timer);
    return json(response, 202, {
      accepted: true,
      status: 'factory_queued',
      selectionStatus: 'saving',
      pdpReceipt: decisionReceipt.persistence,
      decisionReceipt,
      order: {
        command: { kind: 'factory-control', version: 'factory-control-command:v1', name: 'selectFactoryACut' },
      },
    });
  }
  if (url.pathname === '/api/assets/thumbnail/final_detail-3.svg') {
    return json(response, 404, { error: { code: 'qa_broken_thumbnail' } });
  }
  if (url.pathname.startsWith('/api/assets/thumbnail/')) return thumbnail(response, path.basename(url.pathname, '.svg'));
  if (url.pathname.includes('/content')) return json(response, 500, { error: 'original_content_must_not_be_requested' });
  if (url.pathname === '/api/cafe24/preflight' && request.method === 'POST') {
    return json(response, 200, {
      schema: 'factory-cafe24-preflight:v1',
      status: 'ready',
      reason: '',
      productId: 'cafe24:2994',
      productKey: '방울수저집',
      htmlDigest: 'sha256:qa-html',
      imageDigests: ['sha256:hero', 'sha256:size', 'sha256:option', 'sha256:general'],
      expectedWorkfileRevision: revision,
      expectedRunId: 'run-qa-13',
      expectedInputFingerprint: 'sha256:qa-input',
    });
  }
  if (url.pathname === '/api/cafe24/staging-preview' && request.method === 'POST') {
    const payload = await body(request);
    return json(response, 200, fakePreview(payload));
  }
  if (url.pathname === '/api/cafe24/approve' && request.method === 'POST') {
    const payload = await body(request);
    if (payload.approvalRequestId !== 'approval-request-qa' || payload.approved !== true) {
      return json(response, 409, { error: { code: 'approval_binding_mismatch' } });
    }
    approvalIssued = true;
    return json(response, 200, {
      approvalRequestId: 'approval-request-qa',
      approvalToken: 'qa-memory-only-token',
      payloadDigest: payload.payloadDigest,
      idempotencyKey: payload.idempotencyKey,
    });
  }
  if (url.pathname === '/api/cafe24/publish' && request.method === 'POST') {
    return json(response, 200, {
      status: 'staged_verified',
      externalWrite: false,
      publicationReceipt: {
        receiptId: 'qa-publication-receipt',
        status: 'staged_verified',
        remoteReadbackDigest: 'sha256:qa-readback',
      },
    });
  }
  if (url.pathname === '/api/pdp/sources') {
    const query = String(url.searchParams.get('q') || '').trim();
    if (query === '없음') return json(response, 200, { sources: [] });
    return json(response, 200, {
      sources: [1, 2, 3, 4, 5].map(jcode => ({
        jcode,
        productName: '목구절',
        category: jcode === 3 ? '주방' : '생활',
        imageCount: jcode + 2,
        detailPageCount: 1,
      })),
    });
  }
  if (url.pathname === '/api/pdp/readiness') {
    const jcode = String(url.searchParams.get('jcode') || '');
    if (jcode === '5') return json(response, 503, { error: { code: 'readiness_unavailable' } });
    if (jcode === '3') {
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        json(response, 200, { ready: true, missingFields: [], warnings: [] });
      }, 200);
      pendingTimers.add(timer);
      return;
    }
    return json(response, 200, { ready: true, missingFields: [], warnings: [] });
  }
  if (url.pathname === '/api/pdp/capabilities') return json(response, 200, { capabilityVersion: 'qa-1' });
  if (url.pathname === '/api/input-snapshots' && request.method === 'POST') {
    return json(response, 201, { id: 'snapshot-qa-2994', readiness: 'ready', replayed: false });
  }
  if (url.pathname === '/api/jobs' && request.method === 'POST') {
    return json(response, 201, { jobId: 'job-qa-2994', status: 'ready', version: 1 });
  }
  if (url.pathname === '/__metrics') {
    return json(response, 200, {
      requests,
      factoryStateRequests: requests.filter(item => item.path === '/api/factory/state').length,
      factoryJobsRequests: requests.filter(item => item.path === '/api/factory/jobs').length,
      sseConnections: requests.filter(item => item.path === '/api/factory/events').length,
      selectionCommands,
      resumeCommands,
      rebindCommands,
      originalContentRequests: requests.filter(item => item.path.includes('/content')).length,
      thumbnailRequests: requests.filter(item => item.path.includes('/thumbnail/')).length,
      activeSseClients: sseClients.size,
      revision,
      selectedRepresentativeId: stages.find(item => item.key === 'representative').selectedId,
      automationDecisionCount: automationDecisions.length,
      automationDecisions,
      policySnapshotCount: policySnapshots.length,
      policySnapshots,
    });
  }
  return json(response, 404, { error: { code: 'not_found' } });
});

const types = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
};
const frontend = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${FRONTEND_PORT}`);
  const relative = url.pathname === '/' ? 'control-tower.html' : url.pathname.replace(/^\/+/, '');
  const file = path.resolve(FRONTEND, relative);
  if (!file.startsWith(FRONTEND) || !fs.existsSync(file)) {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(response);
});

api.listen(API_PORT, '127.0.0.1');
frontend.listen(FRONTEND_PORT, '127.0.0.1');
console.log(JSON.stringify({
  ready: true,
  pid: process.pid,
  apiPort: API_PORT,
  frontendPort: FRONTEND_PORT,
  externalWrite: false,
}));

const close = () => {
  for (const timer of pendingTimers) clearTimeout(timer);
  for (const response of sseClients) response.end();
  api.close();
  frontend.close();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
