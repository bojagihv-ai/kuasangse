const assert = require('assert');

const API_BASE = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const WORKSPACE_SCOPE = process.env.KUASANGSE_WORKSPACE_SCOPE || 'project:project_mrm2jesp_6sr4ib';

async function loadSnapshot() {
  const response = await fetch(`${API_BASE}/api/last-work?workspaceId=${encodeURIComponent(WORKSPACE_SCOPE)}`);
  const body = await response.json();
  assert(response.ok && body?.hasSnapshot && body?.snapshot, `현재 작업 조회 실패: ${JSON.stringify(body)}`);
  return body.snapshot;
}

function protectedIdentity(snapshot) {
  const product = snapshot?.assets?.factory?.product || {};
  return {
    productKey: product.productKey,
    currentRunId: product.currentRunId,
    inputImageFingerprint: product.inputImageFingerprint || product.lockedInputImageFingerprint,
  };
}

function minimalSnapshot(snapshot, options = {}) {
  const factory = snapshot?.assets?.factory || {};
  const identity = protectedIdentity(snapshot);
  const sectionImages = snapshot?.assets?.sectionImages || {};
  const sectionContents = snapshot?.assets?.sectionContents || {};
  const sectionIds = Object.keys(sectionImages);
  const keptIds = options.dropSections ? sectionIds.slice(0, 1) : sectionIds;
  return {
    id: 'current',
    savedAt: Date.now(),
    workspaceId: WORKSPACE_SCOPE,
    assets: {
      sectionImages: Object.fromEntries(keptIds.map(id => [id, sectionImages[id]])),
      sectionContents: Object.fromEntries(keptIds.map(id => [id, sectionContents[id]])),
      factory: {
        product: options.incompleteIdentity ? {} : {
          ...identity,
          productKey: options.productKey || identity.productKey,
        },
        assets: (factory.assets || []).map(asset => ({
          id: asset.id,
          stageId: asset.stageId,
          rejected: !!asset.rejected,
        })),
      },
    },
  };
}

async function attemptDestructiveSave(snapshot, options) {
  const response = await fetch(`${API_BASE}/api/last-work?workspaceId=${encodeURIComponent(WORKSPACE_SCOPE)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: WORKSPACE_SCOPE,
      snapshot: minimalSnapshot(snapshot, options),
      force: true,
    }),
  });
  const body = await response.json();
  assert(response.ok && body?.ok, `손실 저장 검증 요청 실패: ${JSON.stringify(body)}`);
  assert.strictEqual(body.accepted, false, `손실 저장이 거부되지 않았습니다: ${JSON.stringify(body)}`);
  assert.strictEqual(body.keptExisting, true, `기존 작업 보존 응답이 아닙니다: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  const before = await loadSnapshot();
  const beforeIdentity = protectedIdentity(before);
  assert.strictEqual(Object.keys(before.assets?.sectionImages || {}).length, 15, '검증 시작 전 섹션 이미지가 15개가 아닙니다.');
  assert.strictEqual(Object.keys(before.assets?.sectionContents || {}).length, 15, '검증 시작 전 섹션 콘텐츠가 15개가 아닙니다.');

  const sectionDrop = await attemptDestructiveSave(before, { dropSections: true });
  const identityDrift = await attemptDestructiveSave(before, {
    productKey: `${beforeIdentity.productKey}-잘못된-등록명`,
  });
  const incompleteBootstrap = await attemptDestructiveSave(before, {
    dropSections: true,
    incompleteIdentity: true,
  });

  const after = await loadSnapshot();
  const afterIdentity = protectedIdentity(after);
  const result = {
    ok: true,
    sectionDropRejected: sectionDrop.accepted === false,
    identityDriftRejected: identityDrift.accepted === false,
    incompleteBootstrapRejected: incompleteBootstrap.accepted === false,
    productKeyPreserved: afterIdentity.productKey,
    currentRunIdPreserved: afterIdentity.currentRunId,
    inputImageFingerprintPreserved: afterIdentity.inputImageFingerprint,
    sectionImagesPreserved: Object.keys(after.assets?.sectionImages || {}).length,
    sectionContentsPreserved: Object.keys(after.assets?.sectionContents || {}).length,
  };
  assert.deepStrictEqual(afterIdentity, beforeIdentity, '손실 저장 시도 후 현재 작업 기준이 바뀌었습니다.');
  assert.strictEqual(result.sectionImagesPreserved, 15, '손실 저장 시도 후 섹션 이미지가 줄었습니다.');
  assert.strictEqual(result.sectionContentsPreserved, 15, '손실 저장 시도 후 섹션 콘텐츠가 줄었습니다.');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
