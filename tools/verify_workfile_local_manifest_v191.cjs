const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const API_ROOT = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';

function imageDataUrl(color) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="41" height="29"><rect width="41" height="29" fill="' + color + '"/></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.text();
  let data = {};
  try {
    data = body ? JSON.parse(body) : {};
  } catch (_) {
    data = { raw: body };
  }
  return { response, data };
}

async function saveAsset(scope, title, color) {
  const payload = {
    reason: 'verify-workfile-local-manifest-v191',
    asset: {
      id: scope.stageId + '-' + crypto.randomUUID(),
      title,
      type: 'image',
      image: imageDataUrl(color),
      workspaceId: scope.workspaceId,
      productName: scope.productName,
      productKey: scope.productKey,
      currentRunId: scope.currentRunId,
      inputImageFingerprint: scope.inputImageFingerprint,
      stageId: scope.stageId,
      metadata: { ...scope },
      sourceMap: { ...scope },
    },
  };
  const result = await fetchJson(API_ROOT + '/api/local-archive/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(result.response.status, 200, '아카이브 저장 실패: HTTP ' + result.response.status + ' ' + (result.data.error || result.data.raw || ''));
  assert.equal(result.data.ok, true, '아카이브 저장 응답 실패: ' + (result.data.error || JSON.stringify(result.data)));
  return result.data.archive;
}

function manifestUrl(scope) {
  const query = new URLSearchParams({
    productKey: scope.productKey,
    currentRunId: scope.currentRunId,
    inputImageFingerprint: scope.inputImageFingerprint,
    stageId: scope.stageId,
  });
  return API_ROOT + '/api/local-archive/workfiles/' + encodeURIComponent(scope.workspaceId) + '/manifest?' + query.toString();
}

async function main() {
  const nonce = Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  const baseScope = {
    workspaceId: 'workfile-manifest-v191-' + nonce,
    productName: '작업파일원본보존-' + nonce,
    productKey: 'workfile-manifest-product-' + nonce,
    currentRunId: 'workfile-manifest-run-' + nonce,
    inputImageFingerprint: 'workfile-manifest-fingerprint-' + nonce,
    stageId: 'hero',
  };
  const foreignScope = {
    ...baseScope,
    currentRunId: 'workfile-manifest-foreign-run-' + nonce,
  };

  const currentArchive = await saveAsset(baseScope, '현재 작업파일 대표이미지', '#2563eb');
  const foreignArchive = await saveAsset(foreignScope, '다른 실행 대표이미지', '#dc2626');

  assert.match(
    String(currentArchive.folder || ''),
    /[\\\\/]workfiles[\\\\/]/,
    '현재 작업파일 이미지가 전용 폴더가 아닌 곳에 저장됐습니다: ' + (currentArchive.folder || ''),
  );

  const manifest = await fetchJson(manifestUrl(baseScope));
  assert.equal(manifest.response.status, 200, '작업파일 매니페스트 조회 실패: HTTP ' + manifest.response.status + ' ' + (manifest.data.error || manifest.data.raw || ''));
  assert.equal(manifest.data.ok, true, '작업파일 매니페스트 응답 실패: ' + (manifest.data.error || JSON.stringify(manifest.data)));
  assert.equal(manifest.data.workspaceId, baseScope.workspaceId, '매니페스트 작업파일 ID가 다릅니다.');
  assert.match(String(manifest.data.manifestPath || ''), /[\\\\/]workfiles[\\\\/]/, '매니페스트가 작업파일 전용 로컬 폴더에 없습니다.');

  const assets = Array.isArray(manifest.data.assets) ? manifest.data.assets : [];
  assert(assets.some(asset => asset.archiveId === currentArchive.archiveId), '현재 작업파일의 현재 실행 이미지가 매니페스트에 없습니다.');
  assert(!assets.some(asset => asset.archiveId === foreignArchive.archiveId), '다른 currentRunId 이미지가 현재 작업파일 매니페스트 응답에 섞였습니다.');
  assert(
    assets.every(asset =>
      asset.workspaceId === baseScope.workspaceId &&
      asset.productKey === baseScope.productKey &&
      asset.currentRunId === baseScope.currentRunId &&
      asset.inputImageFingerprint === baseScope.inputImageFingerprint &&
      asset.stageId === baseScope.stageId),
    '작업파일 매니페스트 응답에 5중 범위가 다른 자산이 섞였습니다.',
  );

  console.log(JSON.stringify({
    ok: true,
    workspaceId: baseScope.workspaceId,
    currentArchiveId: currentArchive.archiveId,
    foreignArchiveId: foreignArchive.archiveId,
    manifestPath: manifest.data.manifestPath,
    assetCount: assets.length,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
