const crypto = require('crypto');
const fs = require('fs');

function digest(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function storageFingerprint(snapshot = {}) {
  const entries = Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right));
  const raw = JSON.stringify(entries);
  return { count: entries.length, length: raw.length, sha256: digest(raw) };
}

function buildStartupSeed(seedValue = Date.now()) {
  const seed = String(seedValue);
  const projectId = `project_startup_restore_target_v223_${seed}`;
  const projectScope = `project:${projectId}`;
  const productName = `시작복원 후보검증 수저집 ${seed}`;
  const productKey = productName.replace(/\s+/g, '').toLowerCase();
  const draftWorkspaceId = `draft:lastwork_startup_restore_v223_${seed}`;
  const foreignWorkspaceId = `project_startup_restore_foreign_v223_${seed}`;
  const runId = `startup-restore-run-v223-${seed}`;
  const fingerprint = `startup-restore-image-v223-${seed}`;
  const scope = workspaceId => `${workspaceId}::${productKey}::candidate-review`;
  const identity = workspaceId => `${workspaceId}::${runId}::${productKey}::${fingerprint}::candidate-review`;
  const candidate = (kind, workspaceId) => kind === 'db'
    ? { jcode: `DB-${workspaceId}`, jname: workspaceId, product_name: workspaceId, match_query: productName, reviewProductName: productName, reviewProductScopeKey: scope(workspaceId), reviewProductIdentityKey: identity(workspaceId) }
    : { product_no: `C24-${workspaceId}`, product_code: `C24-${workspaceId}`, product_name: workspaceId, match_query: productName, reviewProductName: productName, reviewProductScopeKey: scope(workspaceId), reviewProductIdentityKey: identity(workspaceId) };
  const db = [candidate('db', draftWorkspaceId), candidate('db', foreignWorkspaceId)];
  const cafe24 = [candidate('cafe24', draftWorkspaceId), candidate('cafe24', foreignWorkspaceId)];
  const factory = {
    workspace: { id: projectId, name: productName, createdAt: 1735689600000 },
    currentProjectId: projectId,
    currentProjectName: productName,
    product: {
      productName, userProductName: productName, productKey, productIdentityKey: productKey,
      currentRunId: runId, generationRunId: runId, inputImageFingerprint: fingerprint,
      lockedInputImageFingerprint: fingerprint,
      pendingDbCandidates: db, dbCandidates: db,
      pendingCafe24Candidates: cafe24, cafe24Candidates: cafe24,
    },
    automation: { activeTab: 'db' }, assets: [], stages: {},
  };
  const session = {
    step: 'factory', currentProjectId: projectId, currentProjectName: productName,
    currentProjectCreatedAt: 1735689600000, workspaceScope: { id: projectScope },
    productName, analysisImages: [], factory,
  };
  const bootstrap = {
    workspaceScope: { id: projectScope }, currentProjectId: projectId,
    currentProjectName: productName, currentProjectCreatedAt: 1735689600000,
    step: 'factory', savedAt: Number(seedValue) || Date.now(),
  };
  return {
    projectId, projectScope, productName, productKey, draftWorkspaceId, foreignWorkspaceId,
    runId, fingerprint, currentScope: scope(projectId), currentIdentity: identity(projectId),
    foreignScope: scope(foreignWorkspaceId), foreignIdentity: identity(foreignWorkspaceId),
    storage: {
      pdp_session: JSON.stringify(session),
      pdp_last_work_bootstrap_v1: JSON.stringify(bootstrap),
      pdp_last_work_draft_scope_v1: draftWorkspaceId,
      kuasangse_workspace_revisions_v1: JSON.stringify({ [`db05:${seed}`]: { counter: 41, writerId: `db05-${seed}` } }),
    },
  };
}

function startupSeedScript(seed, origins = {}) {
  const appOrigin = String(origins.appOrigin || 'http://127.0.0.1:8081');
  const backendOrigin = String(origins.backendOrigin || 'http://127.0.0.1:5050');
  const apiHubOrigin = 'http://127.0.0.1:4321';
  return `(() => {
    const entries = ${JSON.stringify(seed.storage)};
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    localStorage.removeItem('factory_last_snapshot_v1');
    const nativeFetch = window.fetch.bind(window);
    const allowed = new Set(${JSON.stringify([
      `POST ${backendOrigin}/api/workspace-lock/acquire`,
      `POST ${backendOrigin}/api/last-work`,
      `POST ${backendOrigin}/api/cafe24-control/start`,
      `POST ${apiHubOrigin}/api/invoke/cafe24_control_tower/refresh-token`,
      `POST ${apiHubOrigin}/api/invoke/cafe24_control_tower/setup-status`,
    ])});
    const probe = { requests: [], mutations: [], unexpected: [], authorityExpected: null };
    Object.defineProperty(globalThis, '__DB05_NETWORK_PROBE__', { value: probe, configurable: true });
    window.fetch = async (input, init = {}) => {
      const request = input instanceof Request ? input : null;
      const url = new URL(typeof input === 'string' ? input : request?.url, location.href);
      const method = String(init.method || request?.method || 'GET').toUpperCase();
      const bodyText = typeof init.body === 'string' ? init.body : (request ? await request.clone().text() : '');
      const body = (() => { try { return JSON.parse(bodyText || '{}'); } catch (_) { return {}; } })();
      const record = { method, origin: url.origin, path: url.pathname };
      const signature = [method, url.origin + url.pathname].join(' ');
      probe.requests.push(record);
      const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
      if (method === 'GET' || method === 'HEAD') return nativeFetch(input, init);
      if (!allowed.has(signature)) {
        probe.unexpected.push(record);
        return json({ ok: false, blockedByHarness: true, code: 'DB05_UNEXPECTED_MUTATION' }, 409);
      }
      probe.mutations.push(record);
      if (url.pathname === '/api/workspace-lock/acquire') {
        probe.authorityExpected = { mode: 'editing', scopeId: body.workspaceId || ${JSON.stringify(seed.projectScope)}, leaseId: ${JSON.stringify(`db05-lease-${seed.projectId}`)}, fencingToken: 7, ownerId: body.ownerId || 'DB05', sessionId: body.sessionId || 'db05-session', revision: 0 };
        return json({ ok: true, granted: true, state: 'editing', code: 'LEASE_GRANTED', ...probe.authorityExpected, expiresAt: Date.now() + 120000 });
      }
      if (url.pathname === '/api/last-work') {
        const revision = probe.mutations.filter(item => item.path === '/api/last-work').length;
        if (probe.authorityExpected) probe.authorityExpected.revision = revision;
        return json({ ok: true, accepted: true, workspaceId: ${JSON.stringify(seed.projectScope)}, revision });
      }
      return json({ ok: false, blockedByHarness: true, expectedMutation: true });
    };
  })()`;
}

async function readBackendFingerprint(base, scope = '') {
  const suffix = scope ? `?workspaceId=${encodeURIComponent(scope)}` : '';
  const response = await fetch(`${base}/api/last-work${suffix}`, { cache: 'no-store' });
  const raw = await response.text();
  const payload = JSON.parse(raw || '{}');
  return { status: response.status, hasSnapshot: payload.hasSnapshot === true, workspaceId: payload.workspaceId || '', revision: Number(payload.revision || 0), bodyLength: raw.length, sha256: digest(raw), path: payload.path || '', fileExists: payload.path ? fs.existsSync(payload.path) : false };
}

function same(left, right, keys) {
  return keys.every(key => left?.[key] === right?.[key]);
}

function mutationSignatures(expected) {
  return [
    `POST ${expected.backendOrigin}/api/workspace-lock/acquire`,
    ...Array.from({ length: 4 }, () => `POST ${expected.backendOrigin}/api/last-work`),
    `POST ${expected.backendOrigin}/api/cafe24-control/start`,
    'POST http://127.0.0.1:4321/api/invoke/cafe24_control_tower/refresh-token',
    'POST http://127.0.0.1:4321/api/invoke/cafe24_control_tower/setup-status',
  ].sort();
}

function check(code, ok, message) {
  return Object.freeze({ code, ok: ok === true, message });
}

function buildStartupChecks(proof) {
  const backendKeys = ['status', 'hasSnapshot', 'workspaceId', 'revision', 'bodyLength', 'sha256', 'fileExists'];
  const authorityKeys = ['scopeId', 'fencingToken', 'revision', 'leaseId', 'ownerId', 'sessionId', 'mode'];
  const actualMutations = (proof.networkProbe?.mutations || []).map(item => `${item.method} ${item.origin}${item.path}`).sort();
  const expectedMutations = mutationSignatures(proof.expected);
  const authorityExpected = proof.networkProbe?.authorityExpected || {};
  return Object.freeze({
    scope: check('scope', proof.appWorkspaceId === proof.expected.projectId && proof.factoryWorkspaceId === proof.expected.projectId && proof.persistenceScope === proof.expected.projectScope && proof.currentScope === proof.expected.currentScope, `startup app/factory/store scope 불일치: ${JSON.stringify(proof)}`),
    operationToken: check('operationToken', proof.token?.version === 'factory-store:v1' && proof.token.workspaceId === proof.expected.projectId && Number.isInteger(proof.token.revision) && proof.token.revision > 0 && Number(proof.token.fence) === Number(proof.token.revision) + 1 && JSON.stringify(proof.token) === JSON.stringify(proof.settledToken), `startup operation token exact revision/fence 안정화 불일치: ${JSON.stringify({ token: proof.token, settledToken: proof.settledToken })}`),
    authority: check('authority', same(proof.authority, authorityExpected, authorityKeys) && same(proof.settledAuthority, authorityExpected, authorityKeys) && same(proof.authority, proof.settledAuthority, authorityKeys), `startup authority exact identity 불일치: ${JSON.stringify({ authority: proof.authority, settledAuthority: proof.settledAuthority, authorityExpected })}`),
    migratedIdentity: check('migratedIdentity', proof.db[0]?.scope === proof.expected.currentScope && proof.cafe24[0]?.scope === proof.expected.currentScope && proof.db[0]?.identity === proof.expected.currentIdentity && proof.cafe24[0]?.identity === proof.expected.currentIdentity, `draft 후보 project scope/identity migration 불일치: ${JSON.stringify({ db: proof.db[0], cafe24: proof.cafe24[0] })}`),
    currentEnabled: check('currentEnabled', proof.db[0]?.canApply === true && proof.cafe24[0]?.canApply === true && proof.buttons.dbDraft?.exists === true && proof.buttons.dbDraft.disabled === false && proof.buttons.cafeDraft?.exists === true && proof.buttons.cafeDraft.disabled === false, `current 후보 또는 버튼이 비활성입니다: ${JSON.stringify(proof.buttons)}`),
    foreignIdentity: check('foreignIdentity', proof.db[1]?.scope === proof.expected.foreignScope && proof.cafe24[1]?.scope === proof.expected.foreignScope && proof.db[1]?.identity === proof.expected.foreignIdentity && proof.cafe24[1]?.identity === proof.expected.foreignIdentity, `foreign 후보 scope/identity 보존 실패: ${JSON.stringify({ db: proof.db[1], cafe24: proof.cafe24[1] })}`),
    foreignDisabled: check('foreignDisabled', proof.db[1]?.canApply === false && proof.cafe24[1]?.canApply === false && proof.buttons.dbForeign?.exists === true && proof.buttons.dbForeign.disabled === true && proof.buttons.cafeForeign?.exists === true && proof.buttons.cafeForeign.disabled === true, `foreign 후보 또는 버튼이 잘못 활성화됐습니다: ${JSON.stringify(proof.buttons)}`),
    storageCleanup: check('storageCleanup', proof.cleanup?.storageRestored === true && proof.cleanup.beforeStorage?.count >= 1 && same(proof.cleanup.beforeStorage, proof.cleanup.afterStorage, ['count', 'length', 'sha256']), `localStorage/recovery/revision registry exact restore 실패: ${JSON.stringify(proof.cleanup)}`),
    lifecycleCleanup: check('lifecycleCleanup', proof.cleanup?.seedScriptRemoved === true && proof.cleanup.cdpClosed === true && proof.cleanup.runtimeCleaned === true && Array.isArray(proof.cleanup.errors) && proof.cleanup.errors.length === 0, `cleanup lifecycle 실패: ${JSON.stringify(proof.cleanup)}`),
    backendDigest: check('backendDigest', same(proof.backend.beforeTarget, proof.backend.afterTarget, backendKeys) && same(proof.backend.beforeGlobal, proof.backend.afterGlobal, backendKeys), `backend last-work GET digest가 변했습니다: ${JSON.stringify(proof.backend)}`),
    backendFiles: check('backendFiles', proof.backend.beforeTarget?.hasSnapshot === false && proof.backend.afterTarget?.hasSnapshot === false && proof.backend.afterTarget?.fileExists === false, `isolated backend/user last-work 파일이 남았습니다: ${JSON.stringify(proof.backend.afterTarget)}`),
    networkBoundary: check('networkBoundary', JSON.stringify(actualMutations) === JSON.stringify(expectedMutations) && Array.isArray(proof.networkProbe?.unexpected) && proof.networkProbe.unexpected.length === 0 && Array.isArray(proof.loadErrors) && proof.loadErrors.length === 0, `startup exact mutation signature 또는 default-deny 불일치: ${JSON.stringify({ actualMutations, expectedMutations, unexpected: proof.networkProbe?.unexpected, loadErrors: proof.loadErrors })}`),
  });
}

module.exports = { buildStartupChecks, buildStartupSeed, readBackendFingerprint, startupSeedScript, storageFingerprint };
