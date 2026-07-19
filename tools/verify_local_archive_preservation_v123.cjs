const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API_ROOT = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const ARCHIVE_ROUTE = path.resolve('backend/routes/api_archive.py');
const MAINTENANCE_SERVICE = path.resolve('backend/services/maintenance.py');
const BACKEND_ENV_EXAMPLE = path.resolve('backend/.env.example');
const AUTH_SESSION_ID = `archive-preservation-${process.pid}-${Date.now()}`;
const authorities = new Map();

function projectScope(workspaceId) {
  const value = String(workspaceId || '').trim();
  return value.startsWith('project:') ? value : `project:${value}`;
}

async function acquireAuthority(workspaceId) {
  const scopeId = projectScope(workspaceId);
  if (authorities.has(scopeId)) return authorities.get(scopeId);
  const body = {
    workspaceId: scopeId,
    ownerId: 'Local archive preservation regression',
    sessionId: AUTH_SESSION_ID,
    ttlMs: 120_000,
  };
  let response = await fetch(`${API_ROOT}/api/workspace-lock/acquire`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    response = await fetch(`${API_ROOT}/api/workspace-lock/takeover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, confirmed: true }),
    });
  }
  const authority = await response.json();
  assert(response.ok && authority.granted === true, `편집권 취득 실패: HTTP ${response.status}`);
  authorities.set(scopeId, authority);
  return authority;
}

async function releaseAuthorities() {
  for (const authority of authorities.values()) {
    await fetch(`${API_ROOT}/api/workspace-lock/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: authority.scopeId,
        leaseId: authority.leaseId,
        fencingToken: authority.fencingToken,
      }),
    });
  }
}

function trackedPayloadSnapshot(record) {
  const files = record?.files && typeof record.files === 'object' ? record.files : {};
  const entries = new Map();
  for (const filePath of [files.imagePath, files.htmlPath, files.contentPath].filter(Boolean)) {
    assert(fs.existsSync(filePath), `보존 검증 원본 파일이 없습니다: ${filePath}`);
    const bytes = fs.readFileSync(filePath);
    entries.set(path.resolve(filePath), `${bytes.length}:${crypto.createHash('sha256').update(bytes).digest('hex')}`);
  }
  assert(entries.size > 0, '보존 검증에 사용할 실제 이미지/HTML/콘텐츠 파일이 없습니다.');
  return entries;
}

function assertTrackedPayloadsEqual(before, after) {
  assert.deepStrictEqual([...after.entries()].sort(), [...before.entries()].sort(),
    '중복 저장 검증 중 기존 이미지/HTML/콘텐츠 원본이 삭제되거나 변경되었습니다.');
}

function assertNoArchiveDeletePath() {
  const source = fs.readFileSync(ARCHIVE_ROUTE, 'utf8');
  const start = source.indexOf('def save_local_archive_asset');
  const end = source.indexOf('# ── MarketPlus', start);
  const routeSource = source.slice(start, end > start ? end : undefined);
  assert(!/shutil\.rmtree|\.unlink\(|os\.remove\(/.test(routeSource),
    '로컬 아카이브 저장 경로에 파일/폴더 삭제 호출이 남아 있습니다.');
}

function assertAutomaticImageDeletionDisabled() {
  const source = fs.readFileSync(MAINTENANCE_SERVICE, 'utf8');
  assert(/os\.getenv\("KUASANGSE_MAINTENANCE",\s*"0"\),\s*False/.test(source),
    '생성 이미지 유지관리 삭제가 기본 활성화되어 있습니다.');
  const envExample = fs.readFileSync(BACKEND_ENV_EXAMPLE, 'utf8');
  assert(/^KUASANGSE_MAINTENANCE=0$/m.test(envExample),
    'backend/.env.example이 자동 이미지 삭제를 명시적으로 비활성화하지 않았습니다.');
}

async function postLastWork(snapshot) {
  const authority = await acquireAuthority(snapshot.workspaceId || snapshot.workspaceScope?.id);
  const response = await fetch(`${API_ROOT}/api/last-work`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshot,
      force: true,
      workspaceId: authority.scopeId,
      leaseId: authority.leaseId,
      fencingToken: authority.fencingToken,
      expectedRevision: authority.revision,
      revision: Number(authority.revision) + 1,
    }),
  });
  const result = await response.json().catch(() => ({}));
  assert(response.ok, `last-work 저장 실패: HTTP ${response.status} ${result.error || ''}`);
  assert(result.ok && result.accepted === true, 'last-work 저장 요청이 수락되지 않았습니다.');
  authority.revision = result.revision;
  return result;
}

async function clearLastWork(workspaceId) {
  const authority = await acquireAuthority(workspaceId);
  const response = await fetch(`${API_ROOT}/api/last-work?workspaceId=${encodeURIComponent(authority.scopeId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: authority.scopeId,
      leaseId: authority.leaseId,
      fencingToken: authority.fencingToken,
      expectedRevision: authority.revision,
      revision: Number(authority.revision) + 1,
    }),
  });
  const result = await response.json().catch(() => ({}));
  assert(response.ok && result.ok && result.cleared === true,
    `identity 검증용 last-work 정리 실패: HTTP ${response.status} ${result.error || ''}`);
  authority.revision = result.revision;
}

async function verifyLastWorkIdentityIsolation() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="37" height="23"><rect width="37" height="23" fill="#135e96"/></svg>';
  const raw = Buffer.from(svg);
  const image = `data:image/svg+xml;base64,${raw.toString('base64')}`;
  const contentHash = crypto.createHash('sha1').update(raw).digest('hex');
  const runNonce = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const baseScope = {
    workspaceId: `archive-workspace-${runNonce}-a`,
    productName: `ArchiveIdentity-${runNonce}`,
    productKey: `archive-identity-${runNonce}`,
    currentRunId: `archive-run-${runNonce}-a`,
    inputImageFingerprint: `archive-fingerprint-${runNonce}-a`,
  };
  const createdWorkspaceIds = new Set();
  const snapshot = (scope, includeSecondStage = false) => ({
    id: 'current',
    savedAt: Date.now(),
    // 이 테스트의 임시 identity가 사용자의 전역 last-work와 충돌하지 않도록
    // API가 인식하는 workspace 스코프를 snapshot 최상위에도 명시한다.
    workspaceId: scope.workspaceId,
    workspaceScope: { id: scope.workspaceId },
    assets: {
      currentProjectId: scope.workspaceId,
      productName: scope.productName,
      currentRunId: scope.currentRunId,
      sectionWorkScope: scope,
      sectionImages: { header: image },
      detailImageBlocks: includeSecondStage
        ? [{ id: 'archive-detail-v123', label: 'identity stage test', afterSectionId: 'header', dataUrl: image }]
        : [],
    },
  });
  const expected = [
    { ...baseScope, stageId: 'section_header' },
    { ...baseScope, stageId: 'detail_after_header' },
    { ...baseScope, currentRunId: `archive-run-${runNonce}-b`, stageId: 'section_header' },
    { ...baseScope, productKey: `archive-identity-${runNonce}-b`, stageId: 'section_header' },
    { ...baseScope, inputImageFingerprint: `archive-fingerprint-${runNonce}-b`, stageId: 'section_header' },
    { ...baseScope, workspaceId: `archive-workspace-${runNonce}-b`, stageId: 'section_header' },
  ];

  try {
    const baselineScope = {
      ...baseScope,
      workspaceId: `archive-workspace-${runNonce}-baseline`,
      currentRunId: `archive-run-${runNonce}-baseline`,
    };
    createdWorkspaceIds.add(baselineScope.workspaceId);
    await postLastWork({
      id: 'current',
      savedAt: Date.now(),
      workspaceId: baselineScope.workspaceId,
      workspaceScope: { id: baselineScope.workspaceId },
      assets: {
        currentProjectId: baselineScope.workspaceId,
        productName: baselineScope.productName,
        currentRunId: baselineScope.currentRunId,
        sectionWorkScope: baselineScope,
        sectionImages: {},
        detailImageBlocks: [],
      },
    });
    createdWorkspaceIds.add(baseScope.workspaceId);
    createdWorkspaceIds.add(`archive-workspace-${runNonce}-b`);
    const posts = [];
    posts.push(await postLastWork(snapshot(baseScope, true)));
    posts.push(await postLastWork(snapshot({ ...baseScope, currentRunId: `archive-run-${runNonce}-b` })));
    posts.push(await postLastWork(snapshot({ ...baseScope, productKey: `archive-identity-${runNonce}-b` })));
    posts.push(await postLastWork(snapshot({ ...baseScope, inputImageFingerprint: `archive-fingerprint-${runNonce}-b` })));
    posts.push(await postLastWork(snapshot({ ...baseScope, workspaceId: `archive-workspace-${runNonce}-b` })));
    const createdThisRun = posts.reduce((sum, result) => sum + Number(result.localArchive?.count || 0), 0);
    assert.strictEqual(createdThisRun, expected.length,
      `이번 실행의 자동 아카이브 생성 수가 다릅니다: ${createdThisRun}/${expected.length}`);

    const listResponse = await fetch(`${API_ROOT}/api/local-archive/assets?limit=5000`, { cache: 'no-store' });
    assert(listResponse.ok, `identity 검증용 아카이브 조회 실패: HTTP ${listResponse.status}`);
    const list = await listResponse.json();
    const expectedWorkspaceIds = new Set(expected.map(item => item.workspaceId));
    const matches = (list.assets || []).filter(asset =>
      asset.contentHash === contentHash && expectedWorkspaceIds.has(asset.workspaceId));
    for (const identity of expected) {
      assert(matches.some(asset =>
        asset.workspaceId === identity.workspaceId &&
        asset.currentRunId === identity.currentRunId &&
        asset.productKey === identity.productKey &&
        asset.inputImageFingerprint === identity.inputImageFingerprint &&
        asset.stageId === identity.stageId),
      `같은 이미지의 독립 identity가 보존되지 않았습니다: ${JSON.stringify(identity)}`);
    }
    assert.strictEqual(new Set(matches.map(asset => asset.folder)).size, expected.length,
      '서로 다른 identity의 같은 이미지가 동일 폴더에 덮어써졌습니다.');
    return { contentHash, runNonce, createdThisRun, preservedIdentities: expected.length };
  } finally {
    for (const workspaceId of createdWorkspaceIds) await clearLastWork(workspaceId);
  }
}

async function main() {
  assertNoArchiveDeletePath();
  assertAutomaticImageDeletionDisabled();
  if (process.argv.includes('--source-only')) {
    console.log(JSON.stringify({ ok: true, sourceOnly: true, archiveRoute: ARCHIVE_ROUTE }, null, 2));
    return;
  }

  const listResponse = await fetch(`${API_ROOT}/api/local-archive/assets?limit=100`, { cache: 'no-store' });
  assert(listResponse.ok, `로컬 아카이브 목록 조회 실패: HTTP ${listResponse.status}`);
  const list = await listResponse.json();
  const original = (list.assets || []).find(asset =>
    asset?.contentHash && asset?.files?.imagePath && fs.existsSync(asset.files.imagePath));
  assert(original, '중복 보존 검증에 사용할 기존 로컬 아카이브 이미지가 없습니다.');

  const imageBytes = fs.readFileSync(original.files.imagePath);
  const imageMime = original.files.imageMime || 'application/octet-stream';
  // index.json과 workfile manifest는 정상 저장 이력 때문에 갱신될 수 있으므로 실제 원본 파일만 채점합니다.
  const before = trackedPayloadSnapshot(original);
  const authority = await acquireAuthority(original.workspaceId);
  const saveResponse = await fetch(`${API_ROOT}/api/local-archive/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authorityWorkspaceId: authority.scopeId,
      leaseId: authority.leaseId,
      fencingToken: authority.fencingToken,
      expectedRevision: authority.revision,
      revision: authority.revision,
      asset: {
        id: original.assetId,
        title: original.title,
        type: original.type,
        stageId: original.stageId,
        workspaceId: original.workspaceId || '',
        productName: original.productName,
        productKey: original.productKey,
        currentRunId: original.currentRunId,
        inputImageFingerprint: original.inputImageFingerprint,
        image: `data:${imageMime};base64,${imageBytes.toString('base64')}`,
      },
    }),
  });
  assert(saveResponse.ok, `중복 로컬 아카이브 저장 요청 실패: HTTP ${saveResponse.status}`);
  const saved = await saveResponse.json();
  const after = trackedPayloadSnapshot(original);

  assert(saved.ok && saved.deduped === true, '동일 identity/stage/content 이미지가 중복으로 저장됐습니다.');
  assert.strictEqual(saved.archive?.archiveId, original.archiveId, '중복 요청이 기존 아카이브 레코드를 반환하지 않았습니다.');
  assertTrackedPayloadsEqual(before, after);
  const lastWorkIdentity = await verifyLastWorkIdentityIsolation();

  console.log(JSON.stringify({
    ok: true,
    archiveId: original.archiveId,
    currentRunId: original.currentRunId,
    productKey: original.productKey,
    inputImageFingerprint: original.inputImageFingerprint,
    stageId: original.stageId,
    workspaceId: original.workspaceId || '',
    archiveFilesBefore: before.size,
    archiveFilesAfter: after.size,
    lastWorkIdentity,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
}).finally(() => releaseAuthorities().catch(() => {}));
