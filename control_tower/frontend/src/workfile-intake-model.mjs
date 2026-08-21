import { resolveWorkfileIdentity } from './workfile-identity-model.mjs?actualB=1';

const FIELD_LABELS = Object.freeze({
  product_name: '상품명',
  representative_image: '대표 입력 이미지',
  category_usage: '분류·사용용도',
  width_mm: '가로',
  depth_mm: '세로·깊이',
  height_mm: '높이',
  dimensions: '규격·사이즈',
  product_weight_g: '제품 무게',
  material: '소재',
  origin: '원산지',
  sale_price: '판매가',
  supply_price: '공급가',
  recommended_use: '사용용도',
  target_customer: '대상 고객',
  detail_page_hint: '상세페이지 힌트',
  image_work_hint: '이미지 작업 힌트',
  color_options: '색상 옵션',
});

const STAGE_LABELS = Object.freeze({
  hero: '대표 이미지',
  size: '사이즈컷',
  options: '옵션·색상컷',
  cuts: '일반 이미지컷',
  sections: '상세페이지 섹션',
  detail: '최종 상세페이지',
  export: '내보내기 결과',
});

const STAGE_ORDER = Object.freeze([
  'hero',
  'size',
  'options',
  'cuts',
  'sections',
  'detail',
  'export',
]);

export class WorkfileIntakeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WorkfileIntakeError';
    this.code = code;
  }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function hasValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function firstValue(sources, keys) {
  for (const source of sources) {
    const values = record(source.value);
    for (const key of keys) {
      if (hasValue(values[key])) {
        return {
          value: values[key],
          source: source.label,
        };
      }
    }
  }
  return { value: '', source: '' };
}

function firstSizeRecord(factoryProduct) {
  for (const value of Object.values(record(factoryProduct.dbSizeManualByScope))) {
    if (Object.keys(record(value)).length) return record(value);
  }
  return {};
}

function fieldAliases(key) {
  const aliases = {
    product_name: ['product_name', 'productName', 'jname'],
    representative_image: ['representative_image', 'imageName', 'main_image'],
    category_usage: ['category_usage', 'category', 'categoryName', 'use_cases'],
    width_mm: ['width_mm', 'width', 'product_width'],
    depth_mm: ['depth_mm', 'depth', 'product_depth'],
    height_mm: ['height_mm', 'height', 'product_height'],
    dimensions: ['dimensions', 'size', 'jsize'],
    product_weight_g: ['product_weight_g', 'product_weight', 'weight'],
    material: ['material', 'materials'],
    origin: ['origin', 'originCountry', 'country_of_origin'],
    sale_price: ['sale_price', 'retail_price', 'price'],
    recommended_use: ['recommended_use', 'use_cases'],
    target_customer: ['target_customer', 'target_audience'],
    detail_page_hint: ['detail_page_hint', 'naturalHint'],
    color_options: ['color_options', 'colors'],
  };
  return aliases[key] || [key];
}

function requiredFields(payload, factoryProduct, inputImages) {
  const settings = record(payload.productInfoFieldSettings);
  const sources = [
    { label: '작업파일 직접 입력', value: payload.productInfoManualValues },
    { label: '신화사 DB 확정값', value: factoryProduct.finalDb },
    { label: '신화사 DB 후보값', value: factoryProduct.confirmedDb },
    { label: '신화사 DB 사용자값', value: factoryProduct.dbCustomFields },
    { label: '사이즈 수동 확인값', value: firstSizeRecord(factoryProduct) },
    { label: 'Cafe24 편집값', value: factoryProduct.cafe24MainDraft },
    { label: 'AI 제품 분석값', value: payload.analysis },
    { label: '제품 기본값', value: factoryProduct },
  ];
  return Object.entries(settings)
    .filter(([, setting]) => record(setting).active === true && record(setting).required === true)
    .map(([key]) => {
      let found = firstValue(sources, fieldAliases(key));
      if (key === 'representative_image' && inputImages.length) {
        found = { value: inputImages[0].name, source: '입력 이미지' };
      }
      return Object.freeze({
        key,
        label: FIELD_LABELS[key] || key,
        value: Array.isArray(found.value) ? found.value.map(text).filter(Boolean).join(', ') : text(found.value),
        source: found.source,
        status: hasValue(found.value) ? 'confirmed' : 'missing',
      });
    });
}

function inputImages(payload, factoryProduct) {
  const factoryImages = list(factoryProduct.inputImages);
  const fallbackPrimary = record(record(payload.productImageBackup).primary);
  const candidates = factoryImages.length
    ? factoryImages
    : hasValue(fallbackPrimary.name) || hasValue(fallbackPrimary.base64)
      ? [fallbackPrimary]
      : hasValue(factoryProduct.imageName) || factoryProduct.hasImage === true
        ? [{ name: factoryProduct.imageName, mime: factoryProduct.imageMime }]
        : [];
  const seen = new Set();
  return candidates.flatMap((image, index) => {
    const source = record(image);
    const name = text(source.name || source.fileName) || `입력 이미지 ${index + 1}`;
    const colorName = text(source.colorName || source.color);
    const role = text(source.role) || (colorName ? 'color-option' : 'base');
    const identity = text(source.id) || `${role}:${name}:${colorName}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [Object.freeze({
      id: identity,
      role,
      name,
      colorName,
      mime: text(source.mime || source.imageMime),
      available: source.hasImage !== false,
    })];
  });
}

function selectedAssetIds(stages) {
  return new Set(
    Object.values(record(stages))
      .flatMap(stage => list(record(stage).selectedAssetIds))
      .map(text)
      .filter(Boolean),
  );
}

function outputStages(payload, factory) {
  const stages = record(factory.stages);
  const selectedIds = selectedAssetIds(stages);
  const assets = list(factory.assets).map(asset => {
    const source = record(asset);
    return Object.freeze({
      id: text(source.id),
      stageKey: text(source.stageId),
      sectionId: text(source.sectionId || source.placedSectionId),
      title: text(source.title || source.name) || '이름 없는 결과',
      mime: text(source.mime),
      selected: selectedIds.has(text(source.id)),
      previewUrl: text(source.thumbnailUrl || source.imageUrl),
      archived: source.archived === true,
      rejected: source.rejected === true,
    });
  }).filter(asset => asset.id && !asset.archived);
  const sectionImages = Object.entries(record(payload.sectionImages))
    .filter(([, value]) => hasValue(value));
  const selectedSections = Object.entries(record(payload.currentSectionVariantIds))
    .filter(([, value]) => hasValue(value));
  const stageRows = STAGE_ORDER.flatMap(key => {
    if (key === 'sections') {
      if (!sectionImages.length && !selectedSections.length) return [];
      return [Object.freeze({
        key,
        label: STAGE_LABELS[key],
        status: selectedSections.length ? 'completed' : 'waiting_manual',
        candidateCount: sectionImages.length,
        selectedCount: selectedSections.length,
        assets: Object.freeze(sectionImages.map(([sectionId]) => Object.freeze({
          id: `section:${sectionId}`,
          stageKey: 'sections',
          sectionId,
          title: `${sectionId} 섹션`,
          mime: 'image',
          selected: hasValue(record(payload.currentSectionVariantIds)[sectionId]),
          previewUrl: '',
          archived: false,
          rejected: false,
        }))),
      })];
    }
    const stageAssets = assets.filter(asset => asset.stageKey === key);
    const stage = record(stages[key]);
    if (!stageAssets.length && !Object.keys(stage).length) return [];
    return [Object.freeze({
      key,
      label: STAGE_LABELS[key] || key,
      status: text(stage.status) || (stageAssets.length ? 'ready' : 'empty'),
      candidateCount: stageAssets.length,
      selectedCount: stageAssets.filter(asset => asset.selected).length,
      assets: Object.freeze(stageAssets),
    })];
  });
  return {
    assets: Object.freeze(assets),
    stages: Object.freeze(stageRows),
    selectedIds,
  };
}

function numericJcode(...values) {
  for (const value of values) {
    const normalized = Number(value);
    if (Number.isInteger(normalized) && normalized > 0) return normalized;
  }
  return null;
}

export function classifyKuasangseWorkfile(value) {
  const root = record(value);
  if (root.format !== 'kuasangse.factory.project' || Number(root.version) !== 1) {
    throw new WorkfileIntakeError('workfile_format_invalid');
  }
  const project = record(root.project);
  const identity = resolveWorkfileIdentity(root);
  const payload = record(project.payload);
  const assetPayload = record(payload.assetPayload);
  const factory = record(Object.keys(record(payload.factory)).length ? payload.factory : assetPayload.factory);
  const factoryProduct = record(factory.product);
  const images = inputImages(payload, factoryProduct);
  const fields = requiredFields(payload, factoryProduct, images);
  const outputs = outputStages(payload, factory);
  const summary = record(root.summary);
  const resultReport = record(root.resultReport);
  const reportStatus = record(resultReport.status);
  const reportWorkfile = record(resultReport.workfile);
  const reportCafe24 = record(resultReport.cafe24);
  const embeddedReceipt = record(factoryProduct.cafe24PublicationReceipt);
  const publication = Object.freeze({
    schema: text(resultReport.schema),
    registered: reportCafe24.registered === true || text(reportStatus.code) === 'cafe24_registered',
    status: text(reportStatus.label || reportStatus.code),
    productNo: text(reportCafe24.productNo || embeddedReceipt.productNo),
    productCode: text(reportCafe24.productCode || embeddedReceipt.productCode),
    productName: text(reportCafe24.productName || embeddedReceipt.productName),
    mallId: text(reportCafe24.mallId || embeddedReceipt.mallId),
    sourceWorkfileName: text(
      reportCafe24.sourceWorkfileName || reportWorkfile.name || embeddedReceipt.sourceWorkfileName,
    ),
    registrationMode: text(reportCafe24.registrationMode || embeddedReceipt.registrationMode),
    registeredAt: Number(reportCafe24.registeredAt || embeddedReceipt.registeredAt || 0),
    adminUrl: text(reportCafe24.adminUrl || embeddedReceipt.adminUrl),
    storefrontUrl: text(reportCafe24.storefrontUrl || embeddedReceipt.storefrontUrl),
    optionGroupCount: Number(reportCafe24.optionGroupCount || embeddedReceipt.optionGroupCount || 0),
    optionValueCount: Number(reportCafe24.optionValueCount || embeddedReceipt.optionValueCount || 0),
    variantCount: Number(reportCafe24.variantCount || embeddedReceipt.variantCount || 0),
  });
  const jcode = numericJcode(
    record(factoryProduct.finalDb).jcode,
    record(factoryProduct.confirmedDb).jcode,
    factoryProduct.selectedDbCandidateKey,
    record(payload.productInfoManualValues).jcode,
  );
  const sectionCount = Math.max(
    Number(summary.sections || 0),
    list(payload.sectionOrder).length,
    Object.keys(record(payload.sectionImages)).length,
  );
  const warnings = [];
  const missingFieldCount = fields.filter(field => field.status === 'missing').length;
  if (missingFieldCount) warnings.push(`필수값 ${missingFieldCount}개가 비어 있습니다.`);
  if (!images.length) warnings.push('기본 입력 이미지를 찾지 못했습니다.');
  if (!jcode) warnings.push('연결할 신화사 품번을 찾지 못했습니다.');
  if (identity.conflicts.length) warnings.push('작업 신원 값이 서로 달라 자동 연결할 수 없습니다.');
  const unresolvedStages = outputs.stages.filter(
    stage => stage.candidateCount > 0 && stage.selectedCount === 0,
  );
  if (unresolvedStages.length) {
    warnings.push(`${unresolvedStages.map(stage => stage.label).join(', ')} A컷 선택이 필요합니다.`);
  }

  return Object.freeze({
    identity,
    file: Object.freeze({
      format: root.format,
      version: Number(root.version),
      exportedAt: text(root.exportedAt),
      workspaceId: identity.workspaceId,
      revision: identity.revision,
    }),
    product: Object.freeze({
      name: text(summary.productName || project.name || payload.productName || factoryProduct.productName) || '제품명 미확인',
      jcode,
      productKey: identity.productKey,
      runId: identity.runId,
      naturalHint: text(factoryProduct.naturalHint),
    }),
    inputs: Object.freeze({
      requiredFields: Object.freeze(fields),
      confirmedFieldCount: fields.length - missingFieldCount,
      missingFieldCount,
      images: Object.freeze(images),
      competitorCount: list(factoryProduct.competitors).length || list(payload.competitorData).length,
      analysisReady: Object.keys(record(payload.analysis)).length > 0,
    }),
    outputs: Object.freeze({
      stages: outputs.stages,
      totalAssetCount: outputs.assets.length,
      selectedAssetCount: outputs.selectedIds.size,
      sectionCount,
      selectedSectionCount: Object.values(record(payload.currentSectionVariantIds)).filter(hasValue).length,
      finalDetailReady: ['completed', 'ready'].includes(text(record(record(factory.stages).detail).status))
        || list(payload.detailImageBlocks).length > 0
        || Object.keys(record(payload.sectionAssembly)).length > 0,
    }),
    publication,
    warnings: Object.freeze(warnings),
  });
}
