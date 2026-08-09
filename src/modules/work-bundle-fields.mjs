import {
  boundedValue,
  firstSizeRecord,
  firstValue,
  hasValue,
  list,
  positiveInteger,
  record,
  text,
} from './work-bundle-foundation.mjs';

const FIELD_LABELS = Object.freeze({
  product_name: '제품명',
  dimensions: '규격·사이즈',
  width_mm: '가로',
  depth_mm: '세로·깊이',
  height_mm: '높이',
  product_weight_g: '제품 무게',
  material: '소재',
  origin: '원산지',
  sale_price: '판매가',
  supply_price: '공급가',
  recommended_use: '사용용도',
  target_customer: '대상 고객',
  detail_page_hint: '상세페이지 자연어 힌트',
  image_work_hint: '이미지 작업 힌트',
  color_options: '색상 옵션',
});

const FIELD_ALIASES = Object.freeze({
  product_name: ['product_name', 'productName', 'jname', 'name'],
  dimensions: ['dimensions', 'size', 'jsize'],
  width_mm: ['width_mm', 'width', 'product_width'],
  depth_mm: ['depth_mm', 'depth', 'product_depth'],
  height_mm: ['height_mm', 'height', 'product_height'],
  product_weight_g: ['product_weight_g', 'product_weight', 'weight'],
  material: ['material', 'materials'],
  origin: ['origin', 'originCountry', 'country_of_origin'],
  sale_price: ['sale_price', 'retail_price', 'price'],
  supply_price: ['supply_price', 'purchase_price', 'cost'],
  recommended_use: ['recommended_use', 'use_cases', 'usage'],
  target_customer: ['target_customer', 'target_audience'],
  detail_page_hint: ['detail_page_hint', 'naturalHint', 'natural_hint'],
  image_work_hint: ['image_work_hint', 'imageHint', 'image_hint'],
  color_options: ['color_options', 'colors', 'options'],
});

export function fieldRows(payload, factoryProduct, productName) {
  const settings = record(payload.productInfoFieldSettings);
  const sources = [
    { sourceType: 'manual', value: payload.productInfoManualValues },
    { sourceType: 'sinhwa-final', value: factoryProduct.finalDb },
    { sourceType: 'sinhwa-candidate', value: factoryProduct.confirmedDb },
    { sourceType: 'pdp-custom', value: factoryProduct.dbCustomFields },
    { sourceType: 'size-confirmed', value: firstSizeRecord(factoryProduct) },
    { sourceType: 'cafe24-draft', value: factoryProduct.cafe24MainDraft },
    { sourceType: 'ai-analysis', value: payload.analysis },
    { sourceType: 'product', value: factoryProduct },
  ];
  const fields = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const setting = record(settings[key]);
    const found = key === 'product_name'
      ? { value: productName, sourceType: productName ? 'project' : null }
      : firstValue(sources, FIELD_ALIASES[key] || [key]);
    const value = boundedValue(found.value);
    if (value === null && setting.active !== true && setting.required !== true) continue;
    fields.push(Object.freeze({
      phase: 'input',
      fieldKey: key,
      value,
      valueType: Array.isArray(found.value)
        ? 'list'
        : typeof found.value === 'number'
          ? 'number'
          : 'text',
      state: value === null ? 'missing' : 'confirmed',
      sourceType: found.sourceType || (setting.required === true ? 'required' : 'unknown'),
      sortOrder: fields.length,
      label,
    }));
  }
  const sectionContents = record(
    Object.keys(record(payload.sectionContents)).length
      ? payload.sectionContents
      : record(payload.assetPayload).sectionContents,
  );
  for (const [sectionId, value] of Object.entries(sectionContents)) {
    const serialized = boundedValue(value);
    if (serialized === null) continue;
    fields.push(Object.freeze({
      phase: 'output',
      fieldKey: `section.${sectionId}`.slice(0, 160),
      value: serialized,
      valueType: typeof value === 'string' ? 'text' : 'json',
      state: 'candidate',
      sourceType: 'section-content',
      sortOrder: fields.length,
    }));
  }
  return Object.freeze(fields.map(({ label: _label, ...field }) => field));
}

export function assetTargetRows(payload, factory, summary) {
  const stages = record(factory.stages);
  const goalTargets = record(record(factory.goalRun).targets);
  const optionInputCount = list(record(payload.optionSorter).images).length;
  const sectionContents = record(
    Object.keys(record(payload.sectionContents)).length
      ? payload.sectionContents
      : record(payload.assetPayload).sectionContents,
  );
  const targets = [
    ['input', 'base', 1],
    ['input', 'option_inputs', positiveInteger(optionInputCount)],
    ['output', 'hero', positiveInteger(goalTargets.hero, record(stages.hero).targetCount)],
    ['output', 'size', positiveInteger(goalTargets.size, record(stages.size).targetCount)],
    ['output', 'options', positiveInteger(goalTargets.options, record(stages.options).targetCount)],
    ['output', 'cuts', positiveInteger(goalTargets.cuts, record(stages.cuts).targetCount)],
    [
      'output',
      'sections',
      positiveInteger(
        summary.sections,
        list(payload.sectionOrder).length,
        Object.keys(sectionContents).length,
      ),
    ],
    ['output', 'detail', positiveInteger(goalTargets.detail, record(stages.detail).targetCount)],
  ];
  return Object.freeze(
    targets
      .filter((entry) => entry[2] !== null)
      .map(([phase, key, value], index) => Object.freeze({
        phase,
        fieldKey: `asset_target.${key}`,
        value: String(value),
        valueType: 'number',
        state: 'confirmed',
        sourceType: 'workfile-goal',
        sortOrder: 9000 + index,
      })),
  );
}

export function sourceIdentity(factoryProduct, payload) {
  const finalDb = record(factoryProduct.finalDb);
  const confirmedDb = record(factoryProduct.confirmedDb);
  const sinhwaJcode = positiveInteger(
    finalDb.jcode,
    confirmedDb.jcode,
    factoryProduct.selectedDbCandidateKey,
  );
  const manualJcode = positiveInteger(record(payload.productInfoManualValues).jcode);
  const cafe24ProductNo = text(
    factoryProduct.confirmedCafe24ProductNo
    || factoryProduct.confirmedCafe24ProductKey
    || record(factoryProduct.cafe24Product).product_no
    || record(factoryProduct.cafe24MainDraft).product_no,
  ) || null;
  if (sinhwaJcode !== null) {
    return {
      sourceSystem: 'sinhwa',
      detectedJcode: sinhwaJcode,
      cafe24ProductNo,
    };
  }
  if (cafe24ProductNo !== null) {
    return {
      sourceSystem: 'cafe24',
      detectedJcode: manualJcode,
      cafe24ProductNo,
    };
  }
  if (manualJcode !== null) {
    return {
      sourceSystem: 'manual',
      detectedJcode: manualJcode,
      cafe24ProductNo: null,
    };
  }
  return {
    sourceSystem: 'unlinked',
    detectedJcode: null,
    cafe24ProductNo: null,
  };
}
