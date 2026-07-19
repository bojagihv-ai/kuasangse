const fs = require('fs');
const path = require('path');

const API_BASE = process.env.KUASANGSE_BACKEND_URL || 'http://127.0.0.1:5050';
const TARGET_SCOPE = process.env.KUASANGSE_REPAIR_TARGET || 'project:project_mrm2jesp_6sr4ib';
const SOURCE_FILE = process.env.KUASANGSE_REPAIR_SOURCE || path.join(
  process.cwd(),
  'backend',
  '.local',
  'pdp-last-work-scoped',
  '28f7940b4c6582b247b2d7d8ed2b27ffb16d9c06c602902c50912934f2e16466.bak.json'
);
const APPLY = process.argv.includes('--apply');
const OUT_PATH = path.join(process.cwd(), 'output', 'debug-evidence', 'factory-registration-current-work-repair-v225.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value || '').trim();
}

function fingerprintOf(product = {}) {
  return text(product.lockedInputImageFingerprint || product.inputImageFingerprint);
}

function assetValue(asset = {}, key) {
  return text(asset[key] || asset.metadata?.[key]);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadTarget() {
  const url = `${API_BASE}/api/last-work?workspaceId=${encodeURIComponent(TARGET_SCOPE)}`;
  const response = await fetch(url);
  assert(response.ok, `현재 작업 조회 실패: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.hasSnapshot && body.snapshot, '현재 작업 스냅샷이 없습니다.');
  return body.snapshot;
}

function repairFactory(targetFactory, sourceFactory, context) {
  const product = targetFactory.product || (targetFactory.product = {});
  const sourceProduct = sourceFactory.product || {};
  product.productName = context.productName;
  product.userProductName = context.productName;
  product.productKey = context.productKey;
  product.currentProductKey = context.productKey;
  product.productIdentityKey = context.productKey;
  product.cafe24FinalRegistration = {
    ...(product.cafe24FinalRegistration || {}),
    productName: context.registrationName,
    product_name: context.registrationName,
  };
  product.finalDb = {
    ...(sourceProduct.finalDb || {}),
    ...(product.finalDb || {}),
    product_name: context.registrationName,
  };

  // 같은 작업 실행과 입력 지문을 가진 수동 입력값만 현재 작업 범위로 승격한다.
  const mergedSettings = clone(product.dbFieldSettings || {});
  Object.entries(sourceProduct.dbFieldSettings || {}).forEach(([fieldId, sourceSetting]) => {
    const currentSetting = mergedSettings[fieldId];
    const currentHasValue = currentSetting?.manualTouched && text(currentSetting.manualValue);
    const sourceHasValue = sourceSetting?.manualTouched && text(sourceSetting.manualValue);
    if (!currentHasValue && sourceHasValue) mergedSettings[fieldId] = clone(sourceSetting);
  });
  Object.entries(mergedSettings).forEach(([fieldId, setting]) => {
    if (!setting || typeof setting !== 'object' || !setting.manualTouched || !text(setting.manualValue)) return;
    setting.workspaceId = context.workspaceId;
    setting.productKey = context.productKey;
    setting.currentRunId = context.currentRunId;
    setting.inputImageFingerprint = context.inputImageFingerprint;
    setting.stageId = `field:${fieldId}`;
  });
  product.dbFieldSettings = mergedSettings;

  const sourceAssetsById = new Map((sourceFactory.assets || []).map(asset => [asset.id, asset]));
  let restoredAssets = 0;
  (targetFactory.assets || []).forEach(asset => {
    const reason = text(asset.metadata?.rejectedReason || asset.rejectedReason);
    const exactScope = assetValue(asset, 'workspaceId') === context.workspaceId
      && assetValue(asset, 'productKey') === context.productKey
      && assetValue(asset, 'inputImageFingerprint') === context.inputImageFingerprint;
    if (!asset.rejected || !exactScope || !reason.includes(context.registrationName)) return;
    const sourceAsset = sourceAssetsById.get(asset.id);
    assert(sourceAsset, `복구 원본에 없는 격리 이미지입니다: ${asset.id}`);
    asset.rejected = false;
    asset.used = !!sourceAsset.used;
    if (asset.metadata && typeof asset.metadata === 'object') {
      delete asset.metadata.rejectedReason;
      delete asset.metadata.rejectedAt;
    }
    delete asset.rejectedReason;
    restoredAssets += 1;
  });

  const targetAssetIds = new Set((targetFactory.assets || []).map(asset => asset.id));
  ['hero', 'size', 'cuts', 'options'].forEach(stageId => {
    const sourceStage = sourceFactory.stages?.[stageId];
    const targetStage = targetFactory.stages?.[stageId];
    if (!sourceStage || !targetStage) return;
    const selectedAssetIds = (sourceStage.selectedAssetIds || []).filter(id => targetAssetIds.has(id));
    if (!selectedAssetIds.length) return;
    targetStage.selectedAssetIds = selectedAssetIds;
    targetStage.status = 'done';
    targetStage.message = sourceStage.message || '손상 전 현재 작업 선택을 복원했습니다.';
    targetStage.latestGenerationRunId = sourceStage.latestGenerationRunId || targetStage.latestGenerationRunId || '';
  });

  targetFactory.currentProjectId = context.workspaceId;
  if (targetFactory.workspace) targetFactory.workspace.id = context.workspaceId;
  return { restoredAssets };
}

function repairSections(target, source) {
  const sourceSectionImages = source?.assets?.sectionImages || {};
  const sourceSectionContents = source?.assets?.sectionContents || {};
  assert(Object.keys(sourceSectionImages).length === 15, '복구 원본의 섹션 이미지가 15개가 아닙니다.');
  assert(Object.keys(sourceSectionContents).length === 15, '복구 원본의 섹션 콘텐츠가 15개가 아닙니다.');
  target.assets.sectionImages = clone(sourceSectionImages);
  target.assets.sectionContents = clone(sourceSectionContents);
  if (target.lightweight && source.lightweight) {
    target.lightweight.sectionImages = clone(source.lightweight.sectionImages || {});
    target.lightweight.sectionContents = clone(source.lightweight.sectionContents || sourceSectionContents);
  }
}

async function main() {
  assert(fs.existsSync(SOURCE_FILE), `복구 원본을 찾지 못했습니다: ${SOURCE_FILE}`);
  const target = await loadTarget();
  const source = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  const targetFactory = target?.assets?.factory;
  const sourceFactory = source?.assets?.factory;
  assert(targetFactory?.product && sourceFactory?.product, '복구할 조립공장 상태가 없습니다.');

  const targetProduct = targetFactory.product;
  const sourceProduct = sourceFactory.product;
  const sourceProductName = text(sourceProduct.productName || source.productName);
  const sourceProductKey = text(sourceProduct.productKey || sourceProduct.productIdentityKey || sourceProductName);
  const registrationName = text(
    targetProduct.finalDb?.product_name
      || targetProduct.cafe24FinalRegistration?.product_name
      || targetProduct.cafe24FinalRegistration?.productName
  );
  const targetWorkspaceId = text(targetFactory.workspace?.id || targetFactory.currentProjectId).replace(/^project:/, '');
  const context = {
    workspaceId: targetWorkspaceId,
    productName: sourceProductName,
    productKey: sourceProductKey,
    registrationName,
    currentRunId: text(targetProduct.currentRunId),
    inputImageFingerprint: fingerprintOf(targetProduct),
  };

  // 다른 작업을 합치지 않도록 부모 작업의 핵심 범위를 모두 확인한다.
  assert(
    [registrationName, sourceProductName].includes(text(targetProduct.productName)),
    '현재 제품명이 Cafe24 등록명 손상 상태 또는 이미 복구된 제품 기준과 다릅니다.'
  );
  assert(
    sourceProductName && sourceProductKey
      && (sourceProductKey !== text(targetProduct.productKey) || text(targetProduct.productName) === sourceProductName),
    '손상 전 제품 기준을 확정할 수 없습니다.'
  );
  assert(text(sourceProduct.currentRunId) === context.currentRunId, '손상 전 스냅샷의 currentRunId가 다릅니다.');
  assert(fingerprintOf(sourceProduct) === context.inputImageFingerprint, '손상 전 스냅샷의 inputImageFingerprint가 다릅니다.');
  assert(text(sourceProduct.cafe24FinalRegistration?.productName) === sourceProductName, '손상 전 스냅샷의 등록명이 제품 기준과 다릅니다.');

  const repaired = clone(target);
  repaired.productName = sourceProductName;
  repaired.savedAt = Date.now();
  if (repaired.assets) repaired.assets.productName = sourceProductName;
  const assetRepair = repairFactory(repaired.assets.factory, sourceFactory, context);
  if (repaired.lightweight?.factory) repairFactory(repaired.lightweight.factory, sourceFactory, context);
  repairSections(repaired, source);

  // 후보는 후보 자체 currentRunId가 현재 실행과 달라 복구하지 않는다.
  const sourceCandidates = [
    ...(sourceProduct.dbCandidates || []),
    ...(sourceProduct.cafe24Candidates || []),
  ];
  const candidateRunMatches = sourceCandidates.filter(candidate => {
    const identity = text(candidate.reviewProductIdentityKey);
    return identity.includes(`::${context.currentRunId}::`);
  });
  assert(candidateRunMatches.length === 0, '현재 실행과 일치하는 후보가 발견됐습니다. 별도 후보 복구 판단이 필요합니다.');
  repaired.assets.factory.product.dbCandidates = [];
  repaired.assets.factory.product.pendingDbCandidates = [];
  repaired.assets.factory.product.cafe24Candidates = [];
  repaired.assets.factory.product.pendingCafe24Candidates = [];
  const summary = {
    applied: APPLY,
    targetScope: TARGET_SCOPE,
    sourceFile: SOURCE_FILE,
    before: {
      productName: targetProduct.productName,
      productKey: targetProduct.productKey,
      registrationName,
      assets: targetFactory.assets?.length || 0,
      activeAssets: targetFactory.assets?.filter(asset => !asset.rejected).length || 0,
      rejectedAssets: targetFactory.assets?.filter(asset => asset.rejected).length || 0,
      finalDbFields: Object.keys(targetProduct.finalDb || {}).length,
      sectionImages: Object.keys(target.assets?.sectionImages || {}).length,
      sectionContents: Object.keys(target.assets?.sectionContents || {}).length,
    },
    source: {
      sectionImages: Object.keys(source.assets?.sectionImages || {}).length,
      sectionContents: Object.keys(source.assets?.sectionContents || {}).length,
    },
    after: {
      productName: repaired.assets.factory.product.productName,
      productKey: repaired.assets.factory.product.productKey,
      registrationName: repaired.assets.factory.product.cafe24FinalRegistration?.productName,
      assets: repaired.assets.factory.assets?.length || 0,
      activeAssets: repaired.assets.factory.assets?.filter(asset => !asset.rejected).length || 0,
      rejectedAssets: repaired.assets.factory.assets?.filter(asset => asset.rejected).length || 0,
      finalDbFields: Object.keys(repaired.assets.factory.product.finalDb || {}).length,
      restoredAssets: assetRepair.restoredAssets,
      dbCandidates: repaired.assets.factory.product.dbCandidates?.length || 0,
      cafe24Candidates: repaired.assets.factory.product.cafe24Candidates?.length || 0,
      sectionImages: Object.keys(repaired.assets?.sectionImages || {}).length,
      sectionContents: Object.keys(repaired.assets?.sectionContents || {}).length,
    },
    guard: {
      currentRunIdMatched: true,
      inputImageFingerprintMatched: true,
      foreignCandidateCountSkipped: sourceCandidates.length,
    },
  };

  if (APPLY) {
    const response = await fetch(`${API_BASE}/api/last-work?workspaceId=${encodeURIComponent(TARGET_SCOPE)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: TARGET_SCOPE, snapshot: repaired, force: true, repair: true }),
    });
    const result = await response.json();
    assert(response.ok && result?.ok && result?.accepted, `복구 저장 실패: ${JSON.stringify(result)}`);
    summary.saveResult = {
      accepted: result.accepted,
      workspaceId: result.workspaceId,
      savedAt: result.savedAt,
      backupCreated: !!result.backupPath,
    };
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
