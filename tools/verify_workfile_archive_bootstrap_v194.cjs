const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const API_ROOT = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';

function imageDataUrl(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="${color}"/><text x="32" y="28" text-anchor="middle" fill="#fff" font-size="8">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (_) {
    data = { raw };
  }
  return { response, data };
}

async function saveAsset(scope, id, title, color) {
  const payload = {
    reason: 'verify-workfile-archive-bootstrap-v194',
    ...scope,
    asset: {
      id,
      title,
      type: 'image',
      image: imageDataUrl(id, color),
      ...scope,
      metadata: { ...scope },
      sourceMap: { ...scope },
    },
  };
  const result = await fetchJson(`${API_ROOT}/api/local-archive/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(result.response.status, 200, `아카이브 저장 실패: HTTP ${result.response.status} ${result.data.error || result.data.raw || ''}`);
  assert.equal(result.data.ok, true, `아카이브 저장 응답 실패: ${result.data.error || JSON.stringify(result.data)}`);
  return result.data.archive;
}

async function main() {
  const nonce = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const exact = {
    workspaceId: `bootstrap-workfile-${nonce}`,
    productName: `부트스트랩제품-${nonce}`,
    productKey: `bootstrap-product-${nonce}`,
    inputImageFingerprint: `bootstrap-fingerprint-${nonce}`,
  };
  const oldHeroRun = `hero-old-${nonce}`;
  const latestHeroRun = `hero-latest-${nonce}`;
  const latestSizeRun = `size-latest-${nonce}`;

  const oldHero = await saveAsset({ ...exact, currentRunId: oldHeroRun, stageId: 'hero' }, `old-hero-${nonce}`, '이전 대표이미지', '#991b1b');
  await new Promise(resolve => setTimeout(resolve, 1100));
  const latestHeroA = await saveAsset({ ...exact, currentRunId: latestHeroRun, stageId: 'hero' }, `latest-hero-a-${nonce}`, '현재 대표이미지 A', '#2563eb');
  const latestHeroB = await saveAsset({ ...exact, currentRunId: latestHeroRun, stageId: 'hero' }, `latest-hero-b-${nonce}`, '현재 대표이미지 B', '#1d4ed8');
  const latestSize = await saveAsset({ ...exact, currentRunId: latestSizeRun, stageId: 'size' }, `latest-size-${nonce}`, '현재 사이즈이미지', '#047857');

  const foreignWorkspace = await saveAsset(
    { ...exact, workspaceId: `${exact.workspaceId}-foreign`, currentRunId: `foreign-workspace-${nonce}`, stageId: 'hero' },
    `foreign-workspace-${nonce}`,
    '다른 작업파일 이미지',
    '#7c3aed',
  );
  const foreignProduct = await saveAsset(
    { ...exact, productKey: `${exact.productKey}-foreign`, currentRunId: `foreign-product-${nonce}`, stageId: 'hero' },
    `foreign-product-${nonce}`,
    '다른 제품 이미지',
    '#c2410c',
  );
  const foreignFingerprint = await saveAsset(
    { ...exact, inputImageFingerprint: `${exact.inputImageFingerprint}-foreign`, currentRunId: `foreign-fingerprint-${nonce}`, stageId: 'hero' },
    `foreign-fingerprint-${nonce}`,
    '다른 원본 이미지',
    '#a21caf',
  );

  const recovered = await fetchJson(
    `${API_ROOT}/api/local-archive/workfiles/${encodeURIComponent(exact.workspaceId)}/recover-latest`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productKey: exact.productKey,
        inputImageFingerprint: exact.inputImageFingerprint,
      }),
    },
  );
  assert.equal(recovered.response.status, 200, `작업파일 부트스트랩 실패: HTTP ${recovered.response.status} ${recovered.data.error || recovered.data.raw || ''}`);
  assert.equal(recovered.data.ok, true, `작업파일 부트스트랩 응답 실패: ${recovered.data.error || JSON.stringify(recovered.data)}`);

  const assets = Array.isArray(recovered.data.assets) ? recovered.data.assets : [];
  const scopes = recovered.data.stageScopes && typeof recovered.data.stageScopes === 'object'
    ? recovered.data.stageScopes
    : {};
  const archiveIds = new Set(assets.map(asset => asset.archiveId));
  const forbiddenIds = [oldHero, foreignWorkspace, foreignProduct, foreignFingerprint].map(asset => asset.archiveId);

  assert.equal(scopes.hero, latestHeroRun, `대표이미지 단계가 최신 run 하나로 잠기지 않았습니다: ${JSON.stringify(scopes)}`);
  assert.equal(scopes.size, latestSizeRun, `사이즈이미지 단계 run이 복원되지 않았습니다: ${JSON.stringify(scopes)}`);
  assert(archiveIds.has(latestHeroA.archiveId) && archiveIds.has(latestHeroB.archiveId), '최신 대표이미지 run의 이미지가 모두 복원되지 않았습니다.');
  assert(archiveIds.has(latestSize.archiveId), '최신 사이즈이미지가 복원되지 않았습니다.');
  assert(forbiddenIds.every(id => !archiveIds.has(id)), `이전 run 또는 다른 작업 범위 이미지가 섞였습니다: ${JSON.stringify([...archiveIds])}`);
  assert(
    assets.every(asset =>
      asset.workspaceId === exact.workspaceId &&
      asset.productKey === exact.productKey &&
      asset.inputImageFingerprint === exact.inputImageFingerprint &&
      asset.currentRunId === scopes[asset.stageId]),
    '복원 결과에 workspaceId/productKey/fingerprint/stage별 currentRunId가 다른 이미지가 섞였습니다.',
  );

  const manifestQuery = new URLSearchParams({
    productKey: exact.productKey,
    currentRunId: latestHeroRun,
    inputImageFingerprint: exact.inputImageFingerprint,
    stageId: 'hero',
  });
  const manifest = await fetchJson(
    `${API_ROOT}/api/local-archive/workfiles/${encodeURIComponent(exact.workspaceId)}/manifest?${manifestQuery}`,
  );
  assert.equal(manifest.response.status, 200, `복구 후 매니페스트 조회 실패: HTTP ${manifest.response.status}`);
  const manifestIds = new Set((manifest.data.assets || []).map(asset => asset.archiveId));
  assert(manifestIds.has(latestHeroA.archiveId) && manifestIds.has(latestHeroB.archiveId), '복구된 최신 run이 작업파일 매니페스트에 기록되지 않았습니다.');
  assert(!manifestIds.has(oldHero.archiveId), '이전 대표이미지 run이 현재 매니페스트 응답에 섞였습니다.');

  console.log(JSON.stringify({
    ok: true,
    workspaceId: exact.workspaceId,
    stageScopes: scopes,
    restoredArchiveIds: [...archiveIds],
    rejectedArchiveIds: forbiddenIds,
    manifestPath: recovered.data.manifestPath || manifest.data.manifestPath || '',
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
