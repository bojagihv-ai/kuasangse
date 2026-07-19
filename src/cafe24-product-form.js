function factoryEnableCafe24CoreDbFields(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  if (!factory.product.dbFieldSettings || typeof factory.product.dbFieldSettings !== 'object') factory.product.dbFieldSettings = {};
  let enabledCount = 0;
  FACTORY_CAFE24_AUTO_DB_FIELD_IDS.forEach(fieldId => {
    const value = factoryCafe24DbFieldValue(fieldId, factory);
    if (!String(value ?? '').trim()) return;
    const setting = factoryDbFieldSetting(factory, fieldId, false);
    if (setting.enabled !== true) enabledCount += 1;
    setting.enabled = true;
  });
  return enabledCount;
}

function factoryIsTechnicalRawDbField(field = {}) {
  const text = [
    field.id,
    field.label,
    field.sourceKey,
    field.sourceLabel,
  ].map(value => String(value || '')).join(' ');
  return /\braw[._]/i.test(text) ||
    /\brawproduct\b/i.test(text) ||
    /^custom_cafe24api/i.test(String(field.id || '')) ||
    /^custom_cafe24.*raw/i.test(String(field.id || ''));
}

function factoryDbCustomFieldList(factory = factoryRuntimeReadFactory()) {
  return (factory.product.dbCustomFields || [])
    .filter(field => field && field.id && field.label)
    .filter(field => !factoryIsTechnicalRawDbField(field));
}

function factoryBuildDbReviewModel(factory = factoryRuntimeReadFactory()) {
  const rows = factoryDbSourceRows(factory);
  const settings = factory.product.dbFieldSettings || {};
  const canonical = FACTORY_DB_FIELD_DEFS.map(def => {
    const setting = { ...(settings[def.id] || {}) };
    if (setting.enabled === undefined) setting.enabled = def.required === true;
    const sourceValue = factoryDeriveDbFieldValue(def.id, rows, factory);
    const ignoreManual = factoryIgnoreStaleCafe24OptionManual(factory, def.id);
    const manualValue = ignoreManual ? '' : (setting.manualValue || '');
    const value = String(manualValue || sourceValue || '').trim();
    return { ...def, custom: false, enabled: setting.enabled !== false, manualValue, sourceValue, value, sourceRows: factoryUniqueSourceValues(rows, def.id).slice(0, 5) };
  });
  const custom = factoryDbCustomFieldList(factory).map(field => {
    const setting = { ...(settings[field.id] || {}) };
    if (setting.enabled === undefined) setting.enabled = field.enabled !== false;
    const value = String(setting.manualValue || field.manualValue || '').trim();
    return { id: field.id, label: field.label, required: false, custom: true, enabled: setting.enabled !== false, manualValue: setting.manualValue || field.manualValue || '', sourceValue: field.sourceValue || '', value, sourceRows: [], sourceKey: field.sourceKey || '', sourceLabel: field.sourceLabel || '', sourceValueRaw: field.sourceValue || '' };
  });
  const fields = [...canonical, ...custom];
  const finalDb = {};
  fields.forEach(field => {
    if (field.enabled && field.value) finalDb[field.id] = field.value;
  });
  const missing = fields.filter(field => field.enabled && !field.value);
  return { rows, fields, finalDb, missing };
}

function factoryManualSizeValueFromCurrentState(factory = factoryRuntimeReadFactory(), keys = []) {
  const product = factory?.product || {};
  const settings = product.dbFieldSettings && typeof product.dbFieldSettings === 'object' ? product.dbFieldSettings : {};
  const manualValues = state?.productInfoManualValues && typeof state.productInfoManualValues === 'object' ? state.productInfoManualValues : {};
  for (const key of keys) {
    const settingValue = String(settings?.[key]?.manualValue || '').trim();
    if (settingValue) return settingValue;
    const manualValue = String(manualValues?.[key] || '').trim();
    if (manualValue) return manualValue;
  }
  return '';
}

function factoryMergeManualSizeFieldsIntoFinalDb(factory = factoryRuntimeReadFactory(), finalDb = {}) {
  const size = factoryManualSizeValueFromCurrentState(factory, ['size', 'dimensions']);
  const width = factoryManualSizeValueFromCurrentState(factory, ['width_mm']);
  const depth = factoryManualSizeValueFromCurrentState(factory, ['depth_mm']);
  const height = factoryManualSizeValueFromCurrentState(factory, ['height_mm']);
  const weight = factoryManualSizeValueFromCurrentState(factory, ['weight', 'product_weight_g', 'product_weight']);
  const sizeSummary = size || [width ? `가로 ${width}` : '', depth ? `세로 ${depth}` : ''].filter(Boolean).join(' x ');
  if (sizeSummary) {
    finalDb.size = sizeSummary;
    finalDb.dimensions = sizeSummary;
  }
  if (width) finalDb.width_mm = width;
  if (depth) finalDb.depth_mm = depth;
  if (height) finalDb.height_mm = height;
  if (weight) {
    finalDb.weight = weight;
    finalDb.product_weight = weight;
    finalDb.product_weight_g = weight;
  }
  return finalDb;
}

function factoryClearDefaultWeightFromFinalDb(factory = factoryRuntimeReadFactory(), finalDb = {}) {
  const manualWeight = factoryManualSizeValueFromCurrentState(factory, ['weight', 'product_weight_g', 'product_weight']);
  if (manualWeight) return finalDb;
  const canDetectDefault = typeof factoryDbSizeIsCafe24DefaultWeight === 'function';
  if (!canDetectDefault) return finalDb;
  const source = 'Cafe24 선택 상품 product_weight';
  const hasDefaultWeight = ['weight', 'product_weight', 'product_weight_g']
    .some(key => finalDb[key] && factoryDbSizeIsCafe24DefaultWeight({ value: finalDb[key], source, key, sourceType: 'cafe24' }));
  if (!hasDefaultWeight) return finalDb;
  delete finalDb.weight;
  delete finalDb.product_weight;
  delete finalDb.product_weight_g;
  return finalDb;
}

function factoryUpdateFinalDbFromFields(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const reviewedFields = factory.automation?.fieldReview && typeof factory.automation.fieldReview === 'object'
    ? factory.automation.fieldReview
    : {};
  Object.entries(reviewedFields).forEach(([fieldId, review]) => {
    const value = String(review?.value || '').trim();
    if (!value) return;
    if (typeof factoryFieldReviewMatchesCurrentWork !== 'function' || !factoryFieldReviewMatchesCurrentWork(review, factory)) return;
    const setting = factoryDbFieldSetting(factory, fieldId, true);
    if (setting.manualTouched === true || String(setting.manualValue || '').trim()) return;
    setting.manualValue = value;
    setting.manualTouched = true;
    setting.enabled = true;
  });
  const model = factoryBuildDbReviewModel(factory);
  const finalRegistration = factory.product?.cafe24FinalRegistration || {};
  const finalRegistrationName = String(finalRegistration.productName || finalRegistration.product_name || '').trim();
  const protectedProductName = [
        finalRegistrationName,
        typeof factoryFinalRegistrationAuthoritativeProductName === 'function'
          ? factoryFinalRegistrationAuthoritativeProductName(factory, [model.finalDb.product_name])
          : '',
        factory.product?.userProductName,
        factory.product?.productName,
        state?.productName,
        model.finalDb.product_name,
      ].map(value => String(value || '').trim()).find(Boolean);
  if (protectedProductName) model.finalDb.product_name = protectedProductName;
  const finalRegistrationSalePrice = String(finalRegistration.price || finalRegistration.salePrice || finalRegistration.sale_price || '').trim();
  const finalRegistrationRetailPrice = String(finalRegistration.retailPrice || finalRegistration.consumerPrice || finalRegistration.consumer_price || finalRegistration.retail_price || '').trim();
  const finalRegistrationSupplyPrice = String(finalRegistration.supplyPrice || finalRegistration.purchasePrice || finalRegistration.purchase_price || finalRegistration.supply_price || '').trim();
  if (finalRegistrationSalePrice) model.finalDb.sale_price = finalRegistrationSalePrice;
  if (finalRegistrationRetailPrice) model.finalDb.consumer_price = finalRegistrationRetailPrice;
  if (finalRegistrationSupplyPrice) model.finalDb.purchase_price = finalRegistrationSupplyPrice;
  factoryClearDefaultWeightFromFinalDb(factory, model.finalDb);
  factoryMergeManualSizeFieldsIntoFinalDb(factory, model.finalDb);
  factory.product.finalDb = model.finalDb;
  return model;
}

function factoryPresetSnapshot(factory = factoryRuntimeReadFactory()) {
  const model = factoryBuildDbReviewModel(factory);
  const enabled = {};
  model.fields.forEach(field => { enabled[field.id] = field.enabled; });
  return {
    enabled,
    customFields: factoryDbCustomFieldList(factory).map(field => ({
      id: field.id,
      label: field.label,
      enabled: field.enabled !== false,
      sourceKey: field.sourceKey || '',
      sourceLabel: field.sourceLabel || '',
    })),
  };
}

function renderFactoryApiBadges(apiKeys = []) {
  const apiStatusItems = getNumberedApiStatusItems();
  const apiMap = new Map(apiStatusItems.map(item => [item.key, item]));
  return `<span class="factory-api-badges">
    ${uniqueApiKeys(apiKeys).filter(key => apiMap.has(key)).map(key => renderApiNumberBadge(apiMap.get(key), 'factory-api-badge')).join('')}
  </span>`;
}

function renderFactoryDrop(stageId, label, hint, selectedAssets = []) {
  const asset = selectedAssets[0] || null;
  return `<div class="factory-drop" data-factory-drop="${escAttr(stageId)}" role="button" tabindex="0" title="자산 카드를 드래그하거나 클릭해서 로컬 이미지를 이 공정 입력으로 사용합니다.">
    ${asset?.image ? `<img src="${escAttr(asset.image)}" alt="${escAttr(label)} 입력">` : `
      <div class="factory-drop-empty">
        <span class="material-icons-outlined">add_photo_alternate</span>
        <b>${escapeHtml(label)}</b>
        <span>${escapeHtml(hint)} 클릭하면 로컬 이미지도 불러옵니다.</span>
      </div>
    `}
  </div>
  <input type="file" id="factoryStageFile_${escAttr(stageId)}" data-factory-stage-file="${escAttr(stageId)}" accept="image/*" multiple style="display:none">`;
}

function renderFactoryStageBridgeInfo(def, stage) {
  if (['hero', 'size', 'cuts'].includes(def.id)) {
    const cutPrompts = Array.isArray(state.cuts?.prompts) ? state.cuts.prompts : [];
    const resultCount = cutPrompts.filter(item => item.result).length;
    const sizeFacts = def.id === 'size' ? factoryExtractDbFacts() : [];
    const automationSummary = def.id === 'cuts' && typeof factoryAutomationCustomCutPromptSummary === 'function'
      ? factoryAutomationCustomCutPromptSummary()
      : null;
    return `<div class="factory-small">
      기존 이미지컷 생성 엔진 연결됨 · ${automationSummary
        ? `자동화 커스텀 프롬프트 ${automationSummary.count}개${automationSummary.preview ? ` (${escapeHtml(automationSummary.preview)})` : ''}`
        : `이미지컷 탭 프롬프트 ${cutPrompts.length}개`} · 결과 ${resultCount}개
      ${def.id === 'size' ? ` · DB 규격 ${sizeFacts.length ? `${sizeFacts.length}개 감지` : '없음'}` : ''}
    </div>`;
  }
  if (def.id === 'options') {
    const os = state.optionSorter || {};
    const imageCount = Array.isArray(os.images) ? os.images.length : 0;
    const resultCount = Array.isArray(os.optionResults) ? os.optionResults.filter(result => result?.image).length : 0;
    const plan = factoryDbOptionPlanForOptionSorter();
    const layout = typeof getOptionImagePairs === 'function' && typeof optGetSelectedLayoutPattern === 'function'
      ? optGetSelectedLayoutPattern(os, Math.max(1, getOptionImagePairs(os).length || imageCount || 1)).selectedLabel
      : '';
    return `<div class="factory-small">
      기존 옵션 분류기 하네스 연결됨 · 사진 ${imageCount}장 · 결과 ${resultCount}장${layout ? ` · 배치 ${escapeHtml(layout)}` : ''}
      · DB 옵션 ${plan.values.length ? `${escapeHtml(plan.optionName || '옵션')} ${plan.values.length}개` : '없음'}
    </div>`;
  }
  return '';
}

function renderFactoryStageBridgeActions(def) {
  if (['hero', 'size', 'cuts'].includes(def.id)) {
    const importLabel = def.id === 'cuts' ? '자동화 프롬프트 가져오기' : '프롬프트 가져오기';
    return `
      <button class="btn-sm" data-factory-edit-in-imagecuts="${escAttr(def.id)}"><span class="material-icons-outlined" style="font-size:14px">edit_note</span>이미지컷 탭에서 편집</button>
      <button class="btn-sm" data-factory-import-cut-prompts="${escAttr(def.id)}"><span class="material-icons-outlined" style="font-size:14px">keyboard_return</span>${importLabel}</button>
      <button class="btn-sm" data-factory-sync-cut-results="${escAttr(def.id)}"><span class="material-icons-outlined" style="font-size:14px">download_done</span>컷 결과 가져오기</button>
    `;
  }
  if (def.id === 'options') {
    return `
      <button class="btn-sm" data-factory-sync-db-options title="확정 DB와 Cafe24/신화사DB 옵션값을 옵션분류기 슬롯명과 색상옵션 생성 단계에 반영합니다."><span class="material-icons-outlined" style="font-size:14px">sync_alt</span>DB 옵션 슬롯 반영</button>
      <button class="btn-sm" data-factory-open-optionsorter><span class="material-icons-outlined" style="font-size:14px">style</span>옵션분류기에서 편집</button>
      <button class="btn-sm" data-factory-sync-option-results><span class="material-icons-outlined" style="font-size:14px">download_done</span>옵션표 결과 가져오기</button>
    `;
  }
  return '';
}

function renderFactoryDbFieldCard(field) {
  const missing = field.enabled && !field.value;
  const sourceLabel = field.manualValue ? '직접' : (field.sourceRows?.[0]?.sourceLabel || (field.sourceValue ? '후보값' : '값 없음'));
  return `<div class="factory-db-field-card ${missing ? 'missing' : ''} ${field.enabled ? '' : 'disabled'}">
    <div class="factory-db-field-top">
      <label class="factory-db-field-label" title="${escAttr(field.label)}">
        <input class="factory-db-check" type="checkbox" data-factory-db-enable="${escAttr(field.id)}" ${field.enabled ? 'checked' : ''}>
        <span>${escapeHtml(field.label)}</span>
      </label>
      <span style="display:flex;gap:4px;align-items:center">
        ${field.required ? '<span class="factory-db-required">필수</span>' : ''}
        <span class="factory-db-source">${escapeHtml(sourceLabel)}</span>
      </span>
    </div>
    <textarea class="factory-db-value ${missing ? 'missing' : ''}" data-factory-db-manual="${escAttr(field.id)}" placeholder="${field.enabled ? '값을 입력하세요' : '사용 안 함'}">${escapeHtml(field.manualValue || field.sourceValue || '')}</textarea>
    <div class="factory-db-hint">${missing ? '완성 DB에 비어 있습니다. 직접 입력하거나 아래 후보값을 선택하세요.' : (field.manualValue ? '직접 입력값이 우선 사용됩니다.' : '후보값이 자동 반영됩니다.')}</div>
    ${field.sourceRows?.length ? `<div class="factory-db-source-list">
      ${field.sourceRows.map(row => `<button class="factory-db-source-btn" data-factory-db-use-source="${escAttr(field.id)}" data-factory-db-raw-id="${escAttr(row.id)}" type="button" title="${escAttr(row.key)}">${escapeHtml(row.sourceLabel)}</button>`).join('')}
    </div>` : ''}
    ${field.custom ? `<div style="margin-top:6px"><button class="btn-sm" data-factory-db-remove-custom="${escAttr(field.id)}" type="button">커스텀 제거</button></div>` : ''}
  </div>`;
}

function renderFactoryDbReview(factory) {
  const model = factoryBuildDbReviewModel(factory);
  const presets = factoryLoadDbFieldPresets();
  const finalCount = Object.keys(model.finalDb).length;
  const rawRows = factoryRowsForRawDisplay(model.rows).filter(row => row.sourceType !== 'cafe24').slice(0, 180);
  return `<div class="factory-db-review">
    <div class="factory-db-review-head">
      <div>
        <h4>완성 DB 필드 검수</h4>
        <p>완성 DB는 신화사DB, Cafe24, 직접 입력값만 사용합니다. AI 분석명/추론 사이즈/추론 옵션은 여기에 자동 반영하지 않습니다.</p>
      </div>
      <div class="factory-toolbar">
        <select class="input" id="factoryDbPresetSelect" style="min-width:160px">
          <option value="">프리셋 선택</option>
          ${presets.map(preset => `<option value="${escAttr(preset.id)}" ${preset.id === factory.product.dbFieldPresetId ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('')}
        </select>
        <button class="btn-sm" id="factoryApplyDbPreset" type="button" title="선택한 완성 DB 필드 프리셋을 적용해 상세페이지에 쓸 항목과 필수 여부를 바꿉니다.">프리셋 적용</button>
        <button class="btn-sm" id="factorySaveDbPreset" type="button" title="현재 체크한 완성 DB 항목 구성을 이름 있는 프리셋으로 저장합니다.">프리셋 저장</button>
        <button class="btn-sm" id="factoryApplyFinalDb" type="button" title="현재 완성 DB 체크/입력값을 확정 DB에 반영해 이미지 생성, 섹션 설정, 상세페이지 자동화에서 쓰게 합니다.">완성 DB에 반영</button>
      </div>
    </div>
    <div class="factory-small" style="margin-bottom:8px">
      완성 DB ${finalCount}개 필드 · 누락 ${model.missing.length}개
      ${model.missing.length ? `<span style="color:#fecaca;font-weight:900">(${model.missing.map(field => field.label).join(', ')})</span>` : '<span style="color:var(--ok);font-weight:900">필수값 채워짐</span>'}
    </div>
    <div class="factory-db-field-grid">
      ${model.fields.map(renderFactoryDbFieldCard).join('')}
    </div>
    <details class="factory-db-raw">
      <summary>신화사DB / 직접 입력 자료 필드 보기 (${rawRows.length}개 · Cafe24는 아래 상품 입력판에서만 수정)</summary>
      <div class="factory-db-raw-table">
        ${rawRows.length ? rawRows.map(row => `<div class="factory-db-raw-row">
          <b>${escapeHtml(row.sourceLabel)}</b>
          <code title="${escAttr(row.key)}">${escapeHtml(factoryDisplayFieldLabel(row.key))}</code>
          <span class="factory-db-raw-value" title="${escAttr(row.value)}">${escapeHtml(row.value)}</span>
          ${row.fieldId
            ? `<button class="btn-sm" data-factory-db-use-source="${escAttr(row.fieldId)}" data-factory-db-raw-id="${escAttr(row.id)}" type="button">값 채우기</button>`
            : `<button class="btn-sm" data-factory-db-add-raw="${escAttr(row.id)}" type="button">필드 추가</button>`}
        </div>`).join('') : `<div class="factory-db-raw-row"><span>DB 자료 필드가 아직 없습니다. 제품/DB 확보를 먼저 실행해주세요.</span></div>`}
      </div>
    </details>
  </div>`;
}

function factoryBuildSourcePanelModel(factory, sourceType, sections) {
  const rows = factoryDbSourceRows(factory, { types: [sourceType], includeManual: false });
  const optionGroups = factoryExtractOptionGroups(factory, { types: [sourceType], includeManual: false });
  const optionValues = sourceType === 'cafe24'
    ? factoryDedupeRealOptionValues(optionGroups.flatMap(group => group.values), { allowNumeric: true })
    : factoryDedupeOptionValues(optionGroups.flatMap(group => group.values));
  const raw = sourceType === 'cafe24' ? factoryCafe24RawForForm(factory) : {};
  const modeledSections = sections.map(section => ({
    ...section,
    fields: section.fields.map(field => {
      let value = '';
      if (sourceType === 'cafe24') value = factoryCafe24FormFieldValue(field, factory, rows, optionGroups, optionValues);
      else if (field.id === 'option_values') value = optionValues.join(', ');
      else if (field.id === 'option_count') value = optionValues.length ? String(optionValues.length) : '';
      else if (field.id === 'size') value = factoryDeriveSizeValue(rows);
      else value = factorySourceRowsValueByAliases(rows, [field.id, ...(field.aliases || [])]);
      if (sourceType === 'cafe24' && Array.isArray(field.selectOptions)) {
        const directRawValue = field.apiField && raw && Object.prototype.hasOwnProperty.call(raw, field.apiField)
          ? raw[field.apiField]
          : (raw && Object.prototype.hasOwnProperty.call(raw, field.id) ? raw[field.id] : '');
        value = factoryCafe24SelectOptionValue(directRawValue, field.selectOptions) ||
          factoryCafe24SelectOptionValue(value, field.selectOptions) ||
          value;
      }
      const setting = factory.product.dbFieldSettings?.[field.dbFieldId || field.id];
      if (setting && (setting.manualTouched || String(setting.manualValue || '').trim() !== '')) value = setting.manualValue || '';
      return { ...field, value: String(value || '').trim() };
    }),
  }));
  return { rows, optionGroups, optionValues, sections: modeledSections };
}

function factoryCafe24SetFieldHidden(fieldKey = '', hidden = true) {
  const key = String(fieldKey || '').trim();
  if (!key) return;
  const factory = factoryRuntimeReadFactory();
  const view = factoryCafe24FieldViewState(factory);
  const set = new Set(view.hiddenFieldIds);
  if (hidden) set.add(key);
  else set.delete(key);
  view.hiddenFieldIds = [...set];
  view.activePresetId = '';
  const field = factoryCafe24FormFieldsFlat().find(item => factoryCafe24FieldUiKey(item) === key);
  factoryLog(`${field?.label || key} 입력칸을 ${hidden ? '사용 안 함으로 숨겼습니다' : '다시 표시합니다'}. Cafe24 원본/동기화 연결은 유지됩니다.`, 'ok');
  factorySaveCafe24FieldViewStorage(view);
  saveLastWorkNow();
  refreshFactoryCafe24SourcePanel({ keepPanelAnchor: true });
}

function factoryCafe24ResetFieldView() {
  const view = factoryCafe24FieldViewState(factoryRuntimeReadFactory());
  view.hiddenFieldIds = [];
  view.activePresetId = '';
  factoryLog('Cafe24 입력판 숨김 구성을 초기화했습니다.', 'ok');
  factorySaveCafe24FieldViewStorage(view);
  saveLastWorkNow();
  refreshFactoryCafe24SourcePanel();
}

function factoryCafe24SaveDefaultFieldView() {
  const view = factoryCafe24FieldViewState(factoryRuntimeReadFactory());
  view.defaultSavedAt = Date.now();
  view.activePresetId = '';
  factorySaveCafe24FieldViewStorage(view);
  factoryLog(`Cafe24 입력판 기본설정 저장: 사용 안 함 ${view.hiddenFieldIds.length}개`, 'ok');
  saveLastWorkNow();
  refreshFactoryCafe24SourcePanel({ keepPanelAnchor: true });
}

function factoryCafe24HideEmptyFields() {
  const factory = factoryRuntimeReadFactory();
  const baseSections = factoryCafe24VisibleSections(FACTORY_CAFE24_FIELD_SECTIONS);
  const baseModel = factoryBuildSourcePanelModel(factory, 'cafe24', baseSections);
  const keys = factoryCafe24EmptyVisibleFieldKeys(baseModel, factory);
  if (!keys.length) {
    factoryLog('사용 안 함으로 숨길 미기입 Cafe24 입력칸이 없습니다.', 'ok');
    refreshFactoryCafe24SourcePanel({ keepPanelAnchor: true });
    return;
  }
  const view = factoryCafe24FieldViewState(factory);
  view.hiddenFieldIds = [...new Set([...(view.hiddenFieldIds || []), ...keys])];
  view.activePresetId = '';
  factorySaveCafe24FieldViewStorage(view);
  factoryLog(`미기입 Cafe24 입력칸 ${keys.length}개를 사용 안 함으로 숨겼습니다. Cafe24 원본/동기화 연결은 유지됩니다.`, 'ok');
  saveLastWorkNow();
  refreshFactoryCafe24SourcePanel({ keepPanelAnchor: true });
}

function factoryCafe24SaveFieldViewPreset() {
  const factory = factoryRuntimeReadFactory();
  const view = factoryCafe24FieldViewState(factory);
  const defaultName = view.activePresetId
    ? (view.presets.find(preset => preset.id === view.activePresetId)?.name || 'Cafe24 입력판 프리셋')
    : `Cafe24 입력판 ${view.presets.length + 1}`;
  const rawName = prompt('현재 Cafe24 입력판 숨김 구성을 프리셋으로 저장합니다. 프리셋 이름을 입력해주세요.', defaultName);
  const name = String(rawName || '').trim();
  if (!name) return;
  const existing = view.presets.find(preset => preset.name === name);
  const preset = {
    id: existing?.id || uid('cafe24_field_preset'),
    name,
    hiddenFieldIds: [...new Set(view.hiddenFieldIds)],
    savedAt: Date.now(),
  };
  view.presets = [
    ...view.presets.filter(item => item.id !== preset.id && item.name !== name),
    preset,
  ].slice(-30);
  view.activePresetId = preset.id;
  factoryLog(`Cafe24 입력판 프리셋 저장: ${name}`, 'ok');
  factorySaveCafe24FieldViewStorage(view);
  saveLastWorkNow();
  refreshFactoryCafe24SourcePanel();
}

function factoryCafe24ApplyFieldViewPreset(presetId = '') {
  const factory = factoryRuntimeReadFactory();
  const view = factoryCafe24FieldViewState(factory);
  const id = String(presetId || view.activePresetId || '').trim();
  const preset = view.presets.find(item => item.id === id);
  if (!preset) return;
  view.hiddenFieldIds = [...new Set(preset.hiddenFieldIds || [])];
  view.activePresetId = preset.id;
  factoryLog(`Cafe24 입력판 프리셋 적용: ${preset.name}`, 'ok');
  factorySaveCafe24FieldViewStorage(view);
  saveLastWorkNow();
  refreshFactoryCafe24SourcePanel();
}

function factoryCafe24DeleteFieldViewPreset(presetId = '') {
  const factory = factoryRuntimeReadFactory();
  const view = factoryCafe24FieldViewState(factory);
  const id = String(presetId || view.activePresetId || '').trim();
  const preset = view.presets.find(item => item.id === id);
  if (!preset) return;
  if (!confirm(`Cafe24 입력판 프리셋 "${preset.name}"을 삭제할까요?`)) return;
  view.presets = view.presets.filter(item => item.id !== id);
  if (view.activePresetId === id) view.activePresetId = '';
  factoryLog(`Cafe24 입력판 프리셋 삭제: ${preset.name}`, 'ok');
  factorySaveCafe24FieldViewStorage(view);
  saveLastWorkNow();
  refreshFactoryCafe24SourcePanel();
}

function factoryCafe24RawForForm(factory = factoryRuntimeReadFactory()) {
  const candidate = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply }) || {};
  const raw = parseCafe24Raw(candidate);
  return raw && typeof raw === 'object' && Object.keys(raw).length ? raw : (candidate.raw || candidate.rawProduct || candidate || {});
}

function factoryCafe24FlagText(value, trueLabel = '사용함', falseLabel = '사용안함') {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^(T|Y|true|1)$/i.test(raw)) return trueLabel;
  if (/^(F|N|false|0)$/i.test(raw)) return falseLabel;
  return raw;
}

function factoryCafe24CodeText(value, labels = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const label = labels[raw] || labels[raw.toUpperCase()] || '';
  return label || raw;
}

function factoryCafe24SelectOptionValue(value, options = []) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const codeInParen = /\(([A-Z0-9_-]+)\)\s*$/i.exec(raw)?.[1] || '';
  const normalizedRaw = factoryDbNormalizeKey(raw);
  const normalizedCode = factoryDbNormalizeKey(codeInParen);
  const hit = options.find(option => {
    const optionValue = String(option.value ?? '').trim();
    const optionLabel = String(option.label ?? '').trim();
    return factoryDbNormalizeKey(optionValue) === normalizedRaw ||
      (normalizedCode && factoryDbNormalizeKey(optionValue) === normalizedCode) ||
      factoryDbNormalizeKey(optionLabel) === normalizedRaw ||
      factoryDbNormalizeKey(`${optionLabel}(${optionValue})`) === normalizedRaw ||
      factoryDbNormalizeKey(`${optionLabel} (${optionValue})`) === normalizedRaw;
  });
  return hit ? String(hit.value) : (codeInParen || raw);
}

function factoryCafe24SelectLabel(item = {}) {
  const label = String(item.label ?? item.name ?? item.value ?? '').trim();
  const value = String(item.value ?? '').trim();
  if (!value || !label || factoryDbNormalizeKey(label) === factoryDbNormalizeKey(value)) return label || value;
  return label.replace(new RegExp(`\\s*\\(${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*$`, 'i'), '').trim() || label;
}

function factoryCafe24ReferenceSelectLabel(item = {}) {
  const code = String(item.code ?? item.value ?? item.id ?? '').trim();
  const name = String(item.label ?? item.name ?? code).trim();
  if (!code || !name || factoryDbNormalizeKey(name) === factoryDbNormalizeKey(code)) return name || code;
  return name.replace(new RegExp(`\\s*\\(${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*$`, 'i'), '').trim() || name;
}

function factoryCafe24CurrentSelectLabel(value, options = [], fallback = '현재 Cafe24 값') {
  const selected = factoryCafe24SelectOptionValue(value, options);
  const hit = options.find(option => String(option.value ?? '').trim() === String(selected).trim());
  if (hit) return `${fallback}: ${factoryCafe24SelectLabel(hit)}`;
  const raw = String(selected || value || '').trim();
  return raw ? `${fallback}: ${raw}` : fallback;
}

function factoryCafe24CurrentReferenceLabel(field = {}, value = '', factory = factoryRuntimeReadFactory(), fallback = '현재 Cafe24 값') {
  const selected = factoryCafe24ReferenceSelectedValue(field, value, factory);
  const list = factoryCafe24ReferenceList(field.referenceType, factory);
  const hit = list.find(item => String(item.code) === String(selected));
  if (hit) return `${fallback}: ${factoryCafe24ReferenceSelectLabel(hit)}`;
  const raw = String(selected || value || '').trim();
  return raw ? `${fallback}: ${raw}` : fallback;
}

function factoryCafe24CategoryText(raw = {}) {
  const categorySource = raw.category ?? raw.categories ?? raw.product_category ?? raw.category_list ?? [];
  let categories = Array.isArray(categorySource) ? categorySource : [];
  if (!categories.length && typeof categorySource === 'string') {
    const trimmed = categorySource.trim();
    if (/^[\[{]/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        categories = Array.isArray(parsed) ? parsed : [parsed];
      } catch(e) {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  if (!categories.length && categorySource && typeof categorySource === 'object') categories = [categorySource];
  if (!categories.length) return '';
  return categories.map(item => {
    if (!item || typeof item !== 'object') return factoryFormatDbValue(item);
    const no = item.category_no || item.categoryNo || item.no || '';
    const name = item.category_name || item.name || '';
    const flags = [
      item.recommend === 'T' ? '추천' : '',
      item.new === 'T' ? '신상품' : '',
    ].filter(Boolean).join('/');
    return [name || (no ? `분류번호 ${no}` : ''), flags].filter(Boolean).join(' · ');
  }).filter(Boolean).join(', ');
}

function factoryParseCafe24CategorySource(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') {
    const nested = value.category ?? value.categories ?? value.product_category ?? value.category_list;
    if (nested !== undefined) return factoryParseCafe24CategorySource(nested);
    return [value];
  }
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (/^[\[{]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      return factoryParseCafe24CategorySource(parsed);
    } catch(e) {}
  }
  const parseFlaggedPart = (part, match) => ({
    category_no: match[1],
    recommend: /recommend\s*[:=]?\s*(F|N|false|0)\b/i.test(part) ? 'F' : (/추천|recommend\s*[:=]?\s*(T|Y|true|1)?\b/i.test(part) ? 'T' : 'F'),
    new: /new\s*[:=]?\s*(F|N|false|0)\b/i.test(part) ? 'F' : (/신상품|new\s*[:=]?\s*(T|Y|true|1)?\b/i.test(part) ? 'T' : 'F'),
  });
  const parts = raw.split(/[,;\n\r]+/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    const partMatches = parts.flatMap(part =>
      [...part.matchAll(/(?:category_no|분류번호|카테고리|#)?\s*[:#]?\s*(\d{1,8})/gi)].map(match => parseFlaggedPart(part, match))
    );
    if (partMatches.length) return partMatches;
  }
  const matches = [...raw.matchAll(/(?:category_no|분류번호|카테고리|#)?\s*[:#]?\s*(\d{1,8})/gi)]
    .map(match => parseFlaggedPart(raw, match));
  if (matches.length) return matches;
  return parts
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => ({ category_no: part, recommend: 'F', new: 'F' }));
}

function factoryCafe24CategoryRows(value, factory = factoryRuntimeReadFactory()) {
  const refs = factoryCafe24ReferenceList('categories', factory);
  const refByCode = new Map(refs.map(item => [String(item.code), item]));
  const rows = factoryParseCafe24CategorySource(value).map((item, index) => {
    const source = item && typeof item === 'object' ? item : { category_no: item };
    const categoryNo = String(source.category_no ?? source.categoryNo ?? source.no ?? source.code ?? source.id ?? '').trim();
    const ref = refByCode.get(categoryNo);
    return {
      id: `category_${index + 1}`,
      category_no: categoryNo,
      category_name: String(source.category_name || source.name || ref?.name || '').trim(),
      display_group: String(source.display_group ?? source.displayGroup ?? source.display_group_no ?? source.displayGroupNo ?? 1).trim() || '1',
      recommend: /^T$/i.test(String(source.recommend ?? source.recommended ?? 'F')) ? 'T' : 'F',
      new: /^T$/i.test(String(source.new ?? source.is_new ?? 'F')) ? 'T' : 'F',
    };
  }).filter(row => row.category_no || row.category_name);
  return rows.length ? rows : [{ id: 'category_1', category_no: '', category_name: '', recommend: 'F', new: 'F' }];
}

function factoryCafe24CategoryLabel(row = {}, factory = factoryRuntimeReadFactory()) {
  const refs = factoryCafe24ReferenceList('categories', factory);
  const ref = refs.find(item => String(item.code) === String(row.category_no));
  const name = row.category_name || ref?.name || ref?.label || '';
  const code = row.category_no || '';
  return [name || (code ? `분류번호 ${code}` : ''), code && name ? `#${code}` : ''].filter(Boolean).join(' ');
}

function factoryCafe24JsonText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return '';
    return value.map((item, index) => {
      if (item === null || item === undefined) return '';
      if (['string','number','boolean'].includes(typeof item)) return String(item);
      if (typeof item === 'object') {
        const name = item.name || item.label || item.group_name || item.member_group_name || item.category_name || item.text || item.value || '';
        const code = item.code || item.id || item.no || item.group_no || item.category_no || '';
        return [name || (code ? `항목 ${index + 1}` : ''), code ? `(${code})` : ''].filter(Boolean).join(' ');
      }
      return '';
    }).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    const name = value.name || value.label || value.text || value.value || value.category_name || value.group_name || '';
    const code = value.code || value.id || value.no || value.category_no || value.group_no || '';
    if (name || code) return [name || '항목', code ? `(${code})` : ''].filter(Boolean).join(' ');
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
      .slice(0, 6)
      .map(([k, v]) => `${factoryDisplayFieldLabel(k)}: ${factoryFormatDbValue(v)}`);
    return entries.join(' / ');
  }
  return factoryFormatDbValue(value);
}

function factoryCafe24PointsAmountText(value) {
  if (value === undefined || value === null || value === '') return '';
  const rows = factoryCafe24PointsAmountRows(value).filter(row => row.payment_method || row.points_rate || row.points_amount);
  return rows.map(item => {
    if (item === null || item === undefined) return '';
    if (typeof item !== 'object') return String(item).trim();
    const rate = item.points_rate ?? item.pointsRate ?? item.rate ?? item.percent ?? '';
    const amount = item.points_amount ?? item.pointsAmount ?? item.amount ?? item.point ?? '';
    const payment = item.payment_method ?? item.paymentMethod ?? item.payment_type ?? item.paymentType ?? '';
    const parts = [
      payment ? `${factoryDisplayFieldLabel(payment)}` : '',
      rate !== '' ? `적립률 ${rate}` : '',
      amount !== '' ? `적립금 ${amount}` : '',
    ].filter(Boolean);
    return parts.join(' · ');
  }).map(text => text.trim()).filter(Boolean).join('\n');
}

function factoryCafe24PointsAmountRows(value) {
  const parsed = factoryCafe24JsonPayload(value);
  const source = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object'
      ? [parsed]
      : String(value || '').split(/[\n;]+/));
  const rows = source.map((item, index) => {
    if (item === null || item === undefined) return null;
    if (typeof item === 'object') {
      const paymentMethod = String(item.payment_method || item.paymentMethod || item.payment_type || item.paymentType || item.method || '').trim();
      const pointsRate = String(item.points_rate || item.pointsRate || item.rate || item.percent || '').trim();
      const pointsAmount = String(item.points_amount || item.pointsAmount || item.amount || item.point || '').trim();
      if (!paymentMethod && !pointsRate && !pointsAmount) return null;
      return { key: `point_${index + 1}`, payment_method: paymentMethod, points_rate: pointsRate, points_amount: pointsAmount };
    }
    const raw = String(item || '').trim();
    if (!raw) return null;
    const labelSplit = raw.match(/^([^:：=|]{1,28})\s*[:：=|]\s*(.+)$/);
    const paymentFromLabel = labelSplit && !/적립|point|amount|rate|금액|비율/i.test(labelSplit[1])
      ? labelSplit[1].trim()
      : '';
    const targetText = labelSplit ? labelSplit[2] : raw;
    const payment = /(?:결제수단|payment|method)\s*[:=]?\s*([^,\/|]+)/i.exec(raw)?.[1]?.trim() || paymentFromLabel;
    const rate = /(\d+(?:\.\d+)?)\s*%/.exec(raw)?.[0] || /(?:적립률|rate)\s*[:=]?\s*([0-9.]+%?)/i.exec(raw)?.[1] || '';
    const amount = /(?:적립금|금액|amount|point)\s*[:=]?\s*([0-9,]+(?:\.\d+)?)/i.exec(raw)?.[1] ||
      (/%/.test(targetText) ? '' : /([0-9,]+(?:\.\d+)?)\s*(?:원|KRW)?/i.exec(targetText)?.[1] || '');
    return {
      key: `point_${index + 1}`,
      payment_method: payment,
      points_rate: rate,
      points_amount: amount.replace(/,/g, ''),
    };
  }).filter(Boolean);
  return rows.length ? rows : [{ key: 'point_1', payment_method: '', points_rate: '', points_amount: '' }];
}

function factoryCafe24PointsAmountPayload(value) {
  if (value === undefined || value === null) return [];
  return factoryCafe24PointsAmountRows(value)
    .map(row => {
      const payload = {};
      if (row.payment_method) payload.payment_method = row.payment_method;
      if (row.points_rate) payload.points_rate = row.points_rate;
      if (row.points_amount) payload.points_amount = String(row.points_amount).replace(/,/g, '');
      return payload;
    })
    .filter(row => Object.keys(row).length);
}

function factoryCafe24AdditionalInfoText(value) {
  if (!Array.isArray(value)) return factoryCafe24JsonText(value);
  return value.map((item, index) => {
    const name = String(item?.name || item?.label || item?.key || `추가정보 ${index + 1}`).trim();
    const rawValue = String(item?.value ?? '').trim();
    return `${name}: ${rawValue || '미입력'}`;
  }).filter(Boolean).join('\n');
}

function factoryCafe24DateInputValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const hit = value.date || value.value || value.start_date || value.start || value.release_date || value.made_date || '';
    return factoryCafe24DateInputValue(hit);
  }
  const raw = String(value || '').trim();
  const match = /(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/.exec(raw);
  if (!match) return '';
  const y = match[1];
  const m = String(match[2]).padStart(2, '0');
  const d = String(match[3]).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function factoryCafe24PeriodObject(value) {
  const parsed = factoryCafe24JsonPayload(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      start_date: factoryCafe24DateInputValue(parsed.start_date || parsed.start || parsed.from || parsed.begin_date || parsed.startDate),
      end_date: factoryCafe24DateInputValue(parsed.end_date || parsed.end || parsed.to || parsed.finish_date || parsed.endDate),
    };
  }
  const raw = String(value || '').trim();
  if (!raw || /설정\s*안\s*함|미사용|없음/i.test(raw)) return { start_date: '', end_date: '' };
  const matches = raw.match(/\d{4}[-./년\s]*\d{1,2}[-./월\s]*\d{1,2}/g) || [];
  return {
    start_date: factoryCafe24DateInputValue(matches[0] || raw),
    end_date: factoryCafe24DateInputValue(matches[1] || ''),
  };
}

function factoryCafe24StructuredText(apiField, value) {
  if (apiField === 'additional_information') return factoryCafe24AdditionalInfoText(value);
  if (!value || typeof value !== 'object') return factoryCafe24JsonText(value);
  if (apiField === 'product_volume') {
    const use = String(value.use_product_volume ?? value.use ?? '').trim();
    if (/^(F|N|false|0)$/i.test(use)) return '사용 안 함';
    const unit = String(value.unit || value.volume_unit || '').trim();
    return ['가로','세로','높이'].map((label, index) => {
      const key = ['width','height','length'][index];
      const v = value[key] ?? value[`product_${key}`];
      const text = String(v ?? '').trim();
      return text ? `${label}: ${text}${unit && !text.toLowerCase().includes(unit.toLowerCase()) ? unit : ''}` : '';
    }).filter(Boolean).join(' / ') || factoryCafe24JsonText(value);
  }
  if (apiField === 'expiration_date' || apiField === 'icon_show_period' || apiField === 'promotion_period') {
    const period = factoryCafe24PeriodObject(value);
    const start = period.start_date || '';
    const end = period.end_date || '';
    if (!start && !end) return '설정 안 함';
    return `시작일: ${start || '미입력'} / 종료일: ${end || '미입력'}`;
  }
  if (apiField === 'size_guide') {
    const use = String(value.use ?? value.use_size_guide ?? '').trim();
    if (/^(F|N|false|0)$/i.test(use)) return '사용 안 함';
    return value.description || value.default || factoryCafe24JsonText(value);
  }
  if (apiField === 'shipping_rates' && Array.isArray(value)) {
    return value.map((item, index) => {
      const min = String(item?.minimum_amount ?? item?.min ?? '').trim();
      const max = String(item?.maximum_amount ?? item?.max ?? '').trim();
      const fee = String(item?.shipping_fee ?? item?.fee ?? '').trim();
      const label = String(item?.description ?? item?.label ?? '').trim();
      const range = min || max ? `${min || '0'}${max ? `~${max}` : ' 이상'}` : '전체';
      return `${index + 1}. ${range} / 배송비 ${fee || '미입력'}${label ? ` / ${label}` : ''}`;
    }).join('\n');
  }
  return factoryCafe24JsonText(value);
}

function factoryCafe24ParseMaybeJson(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return cloneData(value);
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^[\[{]/.test(raw)) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  return raw;
}

function factoryCafe24StructuredValueForField(field = {}, factory = factoryRuntimeReadFactory()) {
  const setting = factory.product.dbFieldSettings?.[factoryCafe24FormFieldKey(field)];
  if (setting && (setting.manualTouched || String(setting.manualValue || '').trim() !== '')) {
    if (field.id === 'category') return factoryParseCafe24CategorySource(setting.manualValue);
    if (field.apiField === 'additional_information') return factoryCafe24AdditionalInformationPayload(setting.manualValue);
    if (field.apiField) return factoryCafe24StructuredJsonPayload(field.apiField, setting.manualValue);
    return factoryCafe24ParseMaybeJson(setting.manualValue);
  }
  const raw = factoryCafe24RawForForm(factory);
  if (field.id === 'category') return raw?.category ?? raw?.categories ?? raw?.product_category ?? raw?.category_list ?? null;
  const value = field.apiField ? raw?.[field.apiField] : undefined;
  return value !== undefined ? cloneData(value) : null;
}

const CAFE24_DEFAULT_ADDITIONAL_INFO_NAMES = new Set(['사이즈', '색상']);

function factoryCafe24NormalizeAdditionalInfoItem(item, index = 0) {
  const row = item && typeof item === 'object' ? item : {};
  return {
    key: String(row.key || row.option_key || row.code || `custom_option${index + 1}`).trim(),
    name: String(row.name || row.label || row.title || '').trim(),
    value: String(row.value ?? row.content ?? row.text ?? '').trim(),
  };
}

function factoryCafe24IsBlankDefaultAdditionalInfoRow(row = {}, index = 0) {
  const key = String(row.key || '').trim();
  const name = String(row.name || '').trim();
  const value = String(row.value ?? '').trim();
  if (!key && !name && !value) return true;
  if (!name && !value) return true;
  const isDefaultKey = /^custom_option[12]$/i.test(key) || key === `custom_option${index + 1}`;
  return isDefaultKey && CAFE24_DEFAULT_ADDITIONAL_INFO_NAMES.has(name) && !value;
}

function factoryCafe24CleanAdditionalInfoRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((item, index) => factoryCafe24NormalizeAdditionalInfoItem(item, index))
    .filter((row, index) => !factoryCafe24IsBlankDefaultAdditionalInfoRow(row, index))
    .filter(row => row.key || row.name || row.value);
}

function factoryCafe24AdditionalInfoRows(value) {
  const parsed = factoryCafe24JsonPayload(value);
  if (Array.isArray(parsed) && parsed.length) {
    const displayRows = parsed
      .map((item, index) => factoryCafe24NormalizeAdditionalInfoItem(item, index))
      .filter(row => row.key || row.name || row.value);
    if (displayRows.length) return displayRows;
  }
  const rows = factoryCafe24AdditionalInformationPayload(value)
    .map((item, index) => factoryCafe24NormalizeAdditionalInfoItem(item, index))
    .filter(row => row.key || row.name || row.value);
  return rows.length ? rows : [
    { key: 'custom_option1', name: '사이즈', value: '' },
    { key: 'custom_option2', name: '색상', value: '' },
  ];
}

function factoryCafe24ShippingRateRows(value) {
  const parsed = factoryCafe24ShippingRatesPayload(value);
  const source = Array.isArray(parsed) ? parsed : [];
  const rows = source.map((item, index) => {
    const row = item && typeof item === 'object' ? item : {};
    return {
      key: String(row.key || row.id || `rate_${index + 1}`).trim(),
      min: String(row.min || row.minimum || row.minimum_amount || row.start || row.from || '').trim(),
      max: String(row.max || row.maximum || row.maximum_amount || row.end || row.to || '').trim(),
      fee: String(row.fee || row.shipping_fee || row.price || row.amount || '').trim(),
      label: String(row.label || row.name || row.description || '').trim(),
    };
  }).filter(row => row.min || row.max || row.fee || row.label);
  return rows.length ? rows : [{ key: 'rate_1', min: '', max: '', fee: '', label: '' }];
}

function factoryCafe24MemberGroupRows(value) {
  const parsed = factoryCafe24JsonPayload(value);
  const source = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object'
      ? Object.values(parsed)
      : String(value || '').split(/[\n,;]+/));
  const rows = source.map((item, index) => {
    if (item === null || item === undefined) return null;
    if (typeof item === 'object') {
      const groupNo = String(item.group_no || item.groupNo || item.member_group_no || item.memberGroupNo || item.code || item.id || item.no || '').trim();
      const groupName = String(item.group_name || item.groupName || item.member_group_name || item.memberGroupName || item.name || item.label || item.text || item.value || '').trim();
      if (!groupNo && !groupName) return null;
      return { key: `group_${index + 1}`, group_no: groupNo, group_name: groupName };
    }
    const raw = String(item || '').trim();
    if (!raw) return null;
    const parenCode = /\(([^)]+)\)\s*$/.exec(raw)?.[1] || '';
    const leadingCode = /^#?([A-Za-z0-9_-]+)\s+(.+)$/.exec(raw);
    const onlyCode = /^[A-Za-z0-9_-]+$/.test(raw);
    return {
      key: `group_${index + 1}`,
      group_no: parenCode || (leadingCode ? leadingCode[1] : (onlyCode ? raw : '')),
      group_name: parenCode ? raw.replace(/\s*\([^)]+\)\s*$/, '').trim() : (leadingCode ? leadingCode[2].trim() : (onlyCode ? '' : raw)),
    };
  }).filter(Boolean);
  return rows.length ? rows : [{ key: 'group_1', group_no: '', group_name: '' }];
}

function factoryCafe24MemberGroupPayload(value) {
  return factoryCafe24MemberGroupRows(value)
    .map(row => String(row.group_no || row.group_name || '').trim())
    .filter(Boolean);
}

function factoryCafe24MemberIdRows(value) {
  const parsed = factoryCafe24JsonPayload(value);
  const source = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object'
      ? Object.values(parsed)
      : String(value || '').split(/[\n,;]+/));
  const rows = source.map((item, index) => {
    if (item === null || item === undefined) return null;
    if (typeof item === 'object') {
      const memberId = String(item.member_id || item.memberId || item.login_id || item.loginId || item.user_id || item.userId || item.id || item.value || '').trim();
      const memo = String(item.member_name || item.memberName || item.name || item.label || item.memo || item.text || '').trim();
      if (!memberId && !memo) return null;
      return { key: `member_${index + 1}`, member_id: memberId, memo };
    }
    const raw = String(item || '').trim();
    if (!raw) return null;
    const parts = raw.split(/\s*[:|]\s*/);
    return {
      key: `member_${index + 1}`,
      member_id: String(parts[0] || raw).trim(),
      memo: parts.length > 1 ? parts.slice(1).join(' / ').trim() : '',
    };
  }).filter(Boolean);
  return rows.length ? rows : [{ key: 'member_1', member_id: '', memo: '' }];
}

function factoryCafe24MemberIdPayload(value) {
  return factoryCafe24MemberIdRows(value)
    .map(row => String(row.member_id || '').trim())
    .filter(Boolean);
}

function renderFactoryCafe24StructuredSourceField(field, options = {}) {
  const sourceType = options.sourceType || '';
  const factory = options.factory || factoryRuntimeReadFactory();
  if (sourceType !== 'cafe24' || options.editable !== true || field.readonly) return '';
  const sendField = field.dbFieldId || field.id;
  const cafe24FieldKey = factoryCafe24FieldUiKey(field);
  const value = factoryCafe24StructuredValueForField(field, factory);
  const routeInfo = factoryCafe24FieldRouteInfo(field, sourceType);
  const compareCell = renderFactorySourceCompareCell({ ...field, value }, options.compareField, options);
  const cafeCopyValue = factorySourceReadableValue({ ...field, value }, factory);
  const compareFieldId = options.compareField?.dbFieldId || options.compareField?.id || '';
  const compareLabel = options.compareField?.label || field.label || '';
  const cafeToSinhwaAction = options.compareField ? `<div class="factory-source-cafe24-actions">
    <button class="btn-sm" type="button" title="현재 Cafe24 입력값을 오른쪽 신화사DB 비교칸/완성 DB 값으로 복사합니다. Cafe24 사이트 저장은 하지 않습니다." data-factory-copy-cafe24-to-sinhwa="${escAttr(compareFieldId)}" data-factory-copy-label="${escAttr(compareLabel)}" data-factory-copy-value="${escAttr(cafeCopyValue)}" ${disabledAttr(!compareFieldId || !cafeCopyValue, 'Cafe24 값 또는 신화사DB 대상 칸이 없습니다.')}>Cafe24 → 신화사DB</button>
  </div>` : '';
  const wrap = (body, hint = '수정하면 완성 DB와 Cafe24 저장값에 바로 반영됩니다.') => `<div class="factory-source-field ${field.required && !field.value ? 'missing' : ''}">
    <div class="factory-source-field-top">
      <div class="factory-source-field-label">${escapeHtml(field.label)}</div>
      ${routeInfo ? `<span class="factory-source-route-badge ${escAttr(routeInfo.tone)}" title="${escAttr(routeInfo.title)}">${escapeHtml(routeInfo.label)}</span>` : ''}
      ${field.required ? '<span class="factory-db-required">필수</span>' : ''}
      ${cafe24FieldKey ? `<button class="factory-field-visibility-btn" data-factory-cafe24-hide-field="${escAttr(cafe24FieldKey)}" type="button" title="이 입력칸을 사용 안 함으로 아래에 숨김">-</button>` : ''}
    </div>
    <div class="factory-cafe24-structured" data-factory-cafe24-structured-root="${escAttr(sendField)}">
      ${body}
    </div>
    ${cafeToSinhwaAction}
    ${compareCell}
    <div class="factory-source-edit-hint">${escapeHtml(hint)}</div>
  </div>`;
  if (field.id === 'category') {
    const rows = factoryCafe24CategoryRows(value, factory);
    const refs = factoryCafe24ReferenceList('categories', factory);
    const renderCategorySelect = refs.length > 0;
    return wrap(`
      ${rows.map((row, index) => {
        const current = String(row.category_no || '').trim();
        const hasCurrent = current && !refs.some(item => String(item.code) === current);
        return `<div class="factory-cafe24-category-row" data-factory-cafe24-category-row="${index}">
          <label>분류
            ${renderCategorySelect
              ? `<select data-factory-cafe24-category-field="${index}:category_no">
                  <option value="">선택 안 함</option>
                  ${hasCurrent ? `<option value="${escAttr(current)}" selected>${escapeHtml(factoryCafe24CategoryLabel(row, factory) || `현재 분류 #${current}`)}</option>` : ''}
                  ${refs.map(item => `<option value="${escAttr(item.code)}" ${String(item.code) === current ? 'selected' : ''} title="${escAttr(item.code)}">${escapeHtml(factoryCafe24ReferenceSelectLabel(item))}</option>`).join('')}
                </select>`
              : `<input data-factory-cafe24-category-field="${index}:category_no" value="${escAttr(current)}" placeholder="분류번호">`}
          </label>
          <label>추천
            <select data-factory-cafe24-category-field="${index}:recommend">
              <option value="F" ${row.recommend !== 'T' ? 'selected' : ''}>아니오</option>
              <option value="T" ${row.recommend === 'T' ? 'selected' : ''}>예</option>
            </select>
          </label>
          <label>신상품
            <select data-factory-cafe24-category-field="${index}:new">
              <option value="F" ${row.new !== 'T' ? 'selected' : ''}>아니오</option>
              <option value="T" ${row.new === 'T' ? 'selected' : ''}>예</option>
            </select>
          </label>
          <button class="btn-sm" data-factory-cafe24-category-remove="${index}" type="button">삭제</button>
        </div>`;
      }).join('')}
      <button class="btn-sm" id="factoryCafe24CategoryAdd" type="button">분류 행 추가</button>
      ${!renderCategorySelect ? '<div class="factory-source-edit-hint">분류명 선택 목록이 없으면 분류번호로만 표시합니다. 상단의 “선택 목록 불러오기”를 누르면 한글 분류명으로 고를 수 있습니다.</div>' : ''}
    `, 'Cafe24 상품 수정 화면의 분류 영역입니다. 저장 시 카테고리 상품 연결 API 또는 새 상품 등록 payload에 반영됩니다.');
  }
  if (field.id === 'additional_description') {
    const rows = factoryCafe24AdditionalInfoRows(value);
    return wrap(`
      ${rows.map((row, index) => `<div class="factory-cafe24-structured-row three" data-factory-cafe24-additional-row="${index}">
        <label>항목명<input data-factory-cafe24-additional-field="${index}:name" value="${escAttr(row.name)}" placeholder="예: 사이즈"></label>
        <label>값<input data-factory-cafe24-additional-field="${index}:value" value="${escAttr(row.value)}" placeholder="비어 있으면 미입력"></label>
        <input type="hidden" data-factory-cafe24-additional-field="${index}:key" value="${escAttr(row.key || `custom_option${index + 1}`)}">
        <button class="btn-sm" data-factory-cafe24-additional-remove="${index}" type="button">삭제</button>
      </div>`).join('')}
      <button class="btn-sm" id="factoryCafe24AdditionalAdd" type="button">추가정보 행 추가</button>
    `, 'Cafe24 상품수정 화면의 추가정보 영역입니다. 내부 키는 자동 보존하고, 화면에서는 항목명과 값만 수정합니다.');
  }
  if (field.id === 'buy_group_list' || field.id === 'exposure_group_list') {
    const rows = factoryCafe24MemberGroupRows(value);
    const labelPrefix = field.id === 'buy_group_list' ? '구매 가능' : '노출';
    return wrap(`
      ${rows.map((row, index) => `<div class="factory-cafe24-structured-row three" data-factory-cafe24-member-group-row="${escAttr(field.id)}:${index}">
        <label>회원등급 번호<input data-factory-cafe24-member-group-field="${escAttr(field.id)}:${index}:group_no" value="${escAttr(row.group_no)}" placeholder="예: 1"></label>
        <label>회원등급명<input data-factory-cafe24-member-group-field="${escAttr(field.id)}:${index}:group_name" value="${escAttr(row.group_name)}" placeholder="예: 일반회원"></label>
        <button class="btn-sm" data-factory-cafe24-member-group-remove="${escAttr(field.id)}:${index}" type="button">삭제</button>
      </div>`).join('')}
      <button class="btn-sm" data-factory-cafe24-member-group-add="${escAttr(field.id)}" type="button">${escapeHtml(labelPrefix)} 회원등급 추가</button>
    `, 'Cafe24 상품등록/수정 화면의 회원등급 선택 영역입니다. 저장 시 회원등급 번호를 배열로 전송하고, 비어 있는 행은 제외합니다.');
  }
  if (field.id === 'buy_member_id_list') {
    const rows = factoryCafe24MemberIdRows(value);
    return wrap(`
      ${rows.map((row, index) => `<div class="factory-cafe24-structured-row three" data-factory-cafe24-member-id-row="${index}">
        <label>회원 ID<input data-factory-cafe24-member-id-field="${index}:member_id" value="${escAttr(row.member_id)}" placeholder="예: customer01"></label>
        <label>메모<input data-factory-cafe24-member-id-field="${index}:memo" value="${escAttr(row.memo)}" placeholder="확인용 이름/메모"></label>
        <button class="btn-sm" data-factory-cafe24-member-id-remove="${index}" type="button">삭제</button>
      </div>`).join('')}
      <button class="btn-sm" id="factoryCafe24MemberIdAdd" type="button">회원 ID 추가</button>
    `, 'Cafe24 상품등록/수정 화면의 구매 가능 회원ID 입력 영역입니다. 저장 시 회원 ID만 배열로 전송하고, 메모는 화면 확인용으로만 사용합니다.');
  }
  if (field.id === 'points_amount') {
    const rows = factoryCafe24PointsAmountRows(value);
    return wrap(`
      ${rows.map((row, index) => `<div class="factory-cafe24-structured-row four" data-factory-cafe24-points-row="${index}">
        <label>결제수단<input data-factory-cafe24-points-field="${index}:payment_method" value="${escAttr(row.payment_method)}" placeholder="예: cash"></label>
        <label>적립률<input data-factory-cafe24-points-field="${index}:points_rate" value="${escAttr(row.points_rate)}" placeholder="예: 1%"></label>
        <label>적립금<input data-factory-cafe24-points-field="${index}:points_amount" value="${escAttr(row.points_amount)}" placeholder="예: 1000"></label>
        <button class="btn-sm" data-factory-cafe24-points-remove="${index}" type="button">삭제</button>
      </div>`).join('')}
      <button class="btn-sm" id="factoryCafe24PointsAdd" type="button">적립금 행 추가</button>
    `, 'Cafe24 상품등록/수정 화면의 적립금 지급액/비율 영역입니다. 비어 있는 행은 저장에서 제외합니다.');
  }
  if (field.id === 'made_date' || field.id === 'release_date') {
    return wrap(`
      <label>${escapeHtml(field.label)}
        <input type="date" data-factory-panel-edit="${escAttr(sendField)}" data-factory-panel-label="${escAttr(field.label)}" value="${escAttr(factoryCafe24DateInputValue(value))}">
      </label>
    `, 'Cafe24 상품등록/수정 화면의 날짜 입력칸입니다. 비워두면 저장에서 제외됩니다.');
  }
  if (field.id === 'product_volume') {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : { use_product_volume: 'F' };
    const use = String(obj.use_product_volume ?? obj.use ?? 'F').trim() || 'F';
    return wrap(`
      <div class="factory-cafe24-structured-row two">
        <label>부피 사용
          <select data-factory-cafe24-structured-field="product_volume:use_product_volume">
            <option value="F" ${/^F$/i.test(use) ? 'selected' : ''}>사용 안 함</option>
            <option value="T" ${/^T$/i.test(use) ? 'selected' : ''}>사용함</option>
          </select>
        </label>
        <label>단위/메모<input data-factory-cafe24-structured-field="product_volume:unit" value="${escAttr(obj.unit || obj.volume_unit || '')}" placeholder="예: cm"></label>
      </div>
      <div class="factory-cafe24-structured-row three">
        <label>가로<input data-factory-cafe24-structured-field="product_volume:width" value="${escAttr(obj.width ?? obj.product_width ?? '')}" placeholder="가로"></label>
        <label>세로<input data-factory-cafe24-structured-field="product_volume:height" value="${escAttr(obj.height ?? obj.product_height ?? '')}" placeholder="세로"></label>
        <label>높이<input data-factory-cafe24-structured-field="product_volume:length" value="${escAttr(obj.length ?? obj.depth ?? obj.product_length ?? '')}" placeholder="높이"></label>
      </div>
    `);
  }
  if (field.id === 'expiration_date' || field.id === 'icon_show_period' || field.id === 'promotion_period') {
    const obj = factoryCafe24PeriodObject(value);
    return wrap(`
      <div class="factory-cafe24-structured-row two">
        <label>시작일<input type="date" data-factory-cafe24-structured-field="${escAttr(field.id)}:start_date" value="${escAttr(obj.start_date || '')}"></label>
        <label>종료일<input type="date" data-factory-cafe24-structured-field="${escAttr(field.id)}:end_date" value="${escAttr(obj.end_date || '')}"></label>
      </div>
    `, '비워두면 기간을 설정하지 않은 상태로 저장합니다.');
  }
  if (field.id === 'shipping_rates') {
    const rows = factoryCafe24ShippingRateRows(value);
    return wrap(`
      ${rows.map((row, index) => `<div class="factory-cafe24-structured-row four" data-factory-cafe24-shipping-rate-row="${index}">
        <label>시작 금액<input data-factory-cafe24-shipping-rate-field="${index}:min" value="${escAttr(row.min)}" placeholder="예: 0"></label>
        <label>끝 금액<input data-factory-cafe24-shipping-rate-field="${index}:max" value="${escAttr(row.max)}" placeholder="예: 50000"></label>
        <label>배송비<input data-factory-cafe24-shipping-rate-field="${index}:fee" value="${escAttr(row.fee)}" placeholder="예: 3000"></label>
        <label>메모<input data-factory-cafe24-shipping-rate-field="${index}:label" value="${escAttr(row.label)}" placeholder="예: 기본 구간"></label>
        <button class="btn-sm" data-factory-cafe24-shipping-rate-remove="${index}" type="button">삭제</button>
      </div>`).join('')}
      <button class="btn-sm" id="factoryCafe24ShippingRateAdd" type="button">배송비 구간 추가</button>
    `, 'Cafe24 상품 수정 화면의 배송비 구간입니다. 비어 있는 행은 저장에서 제외됩니다.');
  }
  if (field.id === 'size_guide') {
    const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : { use: 'F', type: 'default', default: '', description: null };
    const use = String(obj.use ?? obj.use_size_guide ?? 'F').trim() || 'F';
    return wrap(`
      <div class="factory-cafe24-structured-row two">
        <label>사이즈 가이드
          <select data-factory-cafe24-structured-field="size_guide:use">
            <option value="F" ${/^F$/i.test(use) ? 'selected' : ''}>사용 안 함</option>
            <option value="T" ${/^T$/i.test(use) ? 'selected' : ''}>사용함</option>
          </select>
        </label>
        <label>표시 방식<input data-factory-cafe24-structured-field="size_guide:type" value="${escAttr(obj.type || 'default')}" placeholder="default"></label>
      </div>
      <label>기본값<input data-factory-cafe24-structured-field="size_guide:default" value="${escAttr(obj.default || '')}" placeholder="기본 사이즈 안내"></label>
      <label>설명<textarea data-factory-cafe24-structured-field="size_guide:description" placeholder="사이즈 가이드 설명">${escapeHtml(obj.description || '')}</textarea></label>
    `);
  }
  return '';
}

function factoryCafe24OptionLabels(groups = []) {
  return groups.map(group => group.label || '옵션').filter(Boolean).join(', ');
}

function factoryCafe24FormFieldValue(field, factory, rows, optionGroups, optionValues) {
  const raw = factoryCafe24RawForForm(factory);
  const first = (...values) => values.find(value => String(value ?? '').trim() !== '');
  switch (field.id) {
    case 'product_name': return first(raw.product_name, factorySourceRowsValueByAliases(rows, ['product_name']));
    case 'product_name_en': return first(raw.eng_product_name, raw.product_name_en);
    case 'admin_product_name': return first(raw.internal_product_name);
    case 'supplier_product_name': return first(raw.supply_product_name);
    case 'model_name': return first(raw.model_name);
    case 'product_no': return first(raw.product_no);
    case 'product_code': return first(raw.product_code);
    case 'custom_product_code': return first(raw.custom_product_code);
    case 'product_status': return first(raw.product_condition, raw.condition);
    case 'approve_status': return first(raw.approve_status);
    case 'project_no': return first(raw.project_no);
    case 'summary_description': return first(raw.summary_description);
    case 'simple_description': return first(raw.simple_description);
    case 'additional_description': return raw.additional_information !== undefined ? factoryCafe24StructuredText('additional_information', raw.additional_information) : first(raw.additional_description);
    case 'sale_price': return first(raw.price);
    case 'consumer_price': return first(raw.retail_price);
    case 'purchase_price': return first(raw.supply_price);
    case 'additional_price': return first(raw.additional_price);
    case 'margin_rate': return first(raw.margin_rate);
    case 'price_content': return first(raw.price_content);
    case 'display_status': return factoryCafe24FlagText(raw.display, '진열함', '진열안함');
    case 'selling_status': return factoryCafe24FlagText(raw.selling, '판매함', '판매안함');
    case 'tax_calculation': return factoryCafe24CodeText(raw.tax_calculation, { M: '자동계산', A: '자동계산', C: '수동계산' });
    case 'tax_rate': return first(raw.tax_rate);
    case 'stock': return first(raw.stock_quantity, raw.quantity, raw.inventory);
    case 'has_option': return factoryCafe24FlagText(raw.has_option, '옵션 사용', '옵션 사용 안 함');
    case 'option_type': return factoryCafe24CodeText(raw.option_type, { C: '조합형 옵션', T: '조합형 옵션', E: '상품연동형 옵션', F: '독립선택형 옵션' });
    case 'option_list_type': return factoryCafe24CodeText(raw.option_list_type, { C: '일체선택형', S: '분리선택형' });
    case 'option_name': return factoryCafe24OptionLabels(optionGroups);
    case 'option_values': return optionValues.join(', ');
    case 'option_count': return optionValues.length ? String(optionValues.length) : '';
    case 'select_one_by_option': return factoryCafe24FlagText(raw.select_one_by_option, '옵션별 1개 선택', '옵션별 1개 선택 아님');
    case 'set_product_type': return factoryCafe24CodeText(raw.set_product_type, { F: '세트상품 아님', T: '세트상품', C: '일반 구성상품' });
    case 'purchase_limit': return factoryCafe24FlagText(first(raw.buy_limit_by_product, raw.purchase_limit, raw.purchase_restriction), '상품별 구매제한', '제한없음');
    case 'buy_limit_type': return factoryCafe24CodeText(raw.buy_limit_type, { O: '회원/비회원 모두', M: '회원만 구매', D: '특정 회원등급' });
    case 'buy_group_list': return factoryCafe24JsonText(raw.buy_group_list);
    case 'buy_member_id_list': return factoryCafe24JsonText(raw.buy_member_id_list);
    case 'repurchase_restriction': return factoryCafe24FlagText(raw.repurchase_restriction, '재구매 제한', '제한없음');
    case 'single_purchase_restriction': return factoryCafe24FlagText(raw.single_purchase_restriction, '단독구매 제한', '제한없음');
    case 'single_purchase': return factoryCafe24FlagText(raw.single_purchase, '단독구매 전용', '다른 상품과 함께 구매 가능');
    case 'buy_unit_type': return factoryCafe24CodeText(first(raw.buy_unit_type, raw.purchase_unit_type), { O: '품목 기준', P: '상품 기준' });
    case 'buy_unit': return first(raw.buy_unit, raw.purchase_unit);
    case 'order_quantity_limit_type': return factoryCafe24CodeText(raw.order_quantity_limit_type, { O: '품목 기준', P: '상품 기준' });
    case 'min_order_quantity': return first(raw.minimum_quantity, raw.min_order_quantity);
    case 'max_order_quantity': return first(raw.maximum_quantity, raw.max_order_quantity);
    case 'points': return factoryCafe24FlagText(first(raw.points_by_product, raw.points), '개별설정', '기본설정');
    case 'points_amount': return factoryCafe24PointsAmountText(raw.points_amount) || first(raw.points_amount);
    case 'points_setting_by_payment': return factoryCafe24CodeText(raw.points_setting_by_payment, { F: '결제수단별 적립 미사용', T: '결제수단별 적립 사용', B: '기본설정 사용', C: '개별설정 사용' });
    case 'except_member_points': return factoryCafe24FlagText(raw.except_member_points, '회원 적립 제외', '회원 적립 적용');
    case 'discount_benefits': return '';
    case 'category': return factoryCafe24CategoryText(raw);
    case 'classification_code': return first(raw.classification_code);
    case 'manufacturer': return first(raw.manufacturer_code, raw.manufacturer_name, raw.manufacturer);
    case 'supplier': return first(raw.supplier_code, raw.supplier_name, raw.supplier);
    case 'brand': return first(raw.brand_code, raw.brand_name, raw.brand);
    case 'trend_code': return first(raw.trend_code);
    case 'origin': return first(raw.made_in_code, raw.origin, raw.made_in);
    case 'origin_classification': return first(raw.origin_classification);
    case 'origin_place_value': return first(raw.origin_place_value);
    case 'origin_place_code': return first(raw.origin_place_code);
    case 'origin_place_no': return first(raw.origin_place_no);
    case 'material': return first(raw.product_material, raw.material);
    case 'english_product_material': return first(raw.english_product_material);
    case 'cloth_fabric': return first(raw.cloth_fabric);
    case 'adult_certification': return factoryCafe24FlagText(raw.adult_certification, '성인 인증 사용', '성인 인증 안 함');
    case 'product_weight': return first(raw.product_weight);
    case 'product_volume': return factoryCafe24StructuredText('product_volume', raw.product_volume);
    case 'product_used_month': return first(raw.product_used_month);
    case 'made_date': return first(raw.made_date);
    case 'release_date': return first(raw.release_date);
    case 'expiration_date': return factoryCafe24StructuredText('expiration_date', raw.expiration_date);
    case 'country_hscode': return first(raw.country_hscode);
    case 'clearance_category_code': return first(raw.clearance_category_code);
    case 'clearance_category_kor': return first(raw.clearance_category_kor);
    case 'clearance_category_eng': return first(raw.clearance_category_eng);
    case 'tax_type': {
      const tax = first(raw.tax_type, raw.taxation);
      if (/^A$/i.test(String(tax || ''))) return `과세(${tax})`;
      if (/^B$/i.test(String(tax || ''))) return `면세(${tax})`;
      return tax || '';
    }
    case 'product_tax_type_text': return first(raw.product_tax_type_text);
    case 'main_image': return first(raw.detail_image);
    case 'list_image': return first(raw.list_image);
    case 'list_icon': return factoryCafe24JsonText(raw.list_icon);
    case 'small_image': return first(raw.small_image);
    case 'tiny_image': return first(raw.tiny_image);
    case 'image_upload_type': return first(raw.image_upload_type);
    case 'detail_html_pc': return first(raw.description);
    case 'detail_html_mobile': return first(raw.mobile_description);
    case 'translated_description': return first(raw.translated_description);
    case 'translated_additional_description': return first(raw.translated_additional_description);
    case 'separated_mobile_description': return factoryCafe24FlagText(raw.separated_mobile_description, '별도등록', '공통사용');
    case 'payment_info': return first(raw.payment_info);
    case 'payment_info_by_product': return factoryCafe24FlagText(raw.payment_info_by_product, '개별설정', '기본설정');
    case 'shipping_info_by_product': return factoryCafe24FlagText(raw.shipping_info_by_product, '개별설정', '기본설정');
    case 'shipping_info': return first(raw.shipping_info);
    case 'product_shipping_type': return first(raw.product_shipping_type);
    case 'shipping_method': return first(raw.shipping_method);
    case 'shipping_scope': return first(raw.shipping_scope);
    case 'shipping_calculation': return first(raw.shipping_calculation);
    case 'prepaid_shipping_fee': return first(raw.prepaid_shipping_fee);
    case 'shipping_place_code': return first(raw.shipping_place_code);
    case 'shipping_area': return first(raw.shipping_area);
    case 'shipping_area_name': return first(raw.shipping_area_name);
    case 'shipping_period': return first(raw.shipping_period);
    case 'shipping_fee_type': {
      const shipping = first(raw.shipping_fee_type, raw.shipping_type);
      if (/^C$/i.test(String(shipping || ''))) return `기본 배송비 설정(${shipping})`;
      return shipping || '';
    }
    case 'shipping_fee': return first(raw.shipping_fee);
    case 'shipping_fee_by_product': return first(raw.shipping_fee_by_product);
    case 'shipping_rates': return factoryCafe24StructuredText('shipping_rates', raw.shipping_rates);
    case 'return_exchange_info': return first(raw.exchange_info, raw.return_exchange_info);
    case 'exchange_info_by_product': return factoryCafe24FlagText(raw.exchange_info_by_product, '개별설정', '기본설정');
    case 'service_info': return first(raw.service_info);
    case 'service_info_by_product': return factoryCafe24FlagText(raw.service_info_by_product, '개별설정', '기본설정');
    case 'hscode': return first(raw.hscode);
    case 'sold_out': return factoryCafe24FlagText(raw.sold_out, '품절 처리', '품절 아님');
    case 'soldout_message': return first(raw.soldout_message);
    case 'icon': return Array.isArray(raw.icon) ? raw.icon.join(', ') : first(raw.icon);
    case 'icon_show_period': return factoryCafe24StructuredText('icon_show_period', raw.icon_show_period);
    case 'promotion_period': return factoryCafe24StructuredText('promotion_period', raw.promotion_period);
    case 'use_naverpay': return factoryCafe24FlagText(raw.use_naverpay, '사용함', '사용안함');
    case 'naverpay_type': return first(raw.naverpay_type);
    case 'use_kakaopay': return factoryCafe24FlagText(raw.use_kakaopay, '사용함', '사용안함');
    case 'kakaopay_type': return first(raw.kakaopay_type);
    case 'market_sync': return factoryCafe24FlagText(raw.market_sync, '연동함', '연동안함');
    case 'exposure_limit_type': return factoryCafe24CodeText(raw.exposure_limit_type, { A: '모든 회원 노출', M: '회원등급별 노출', G: '특정 회원그룹 노출' });
    case 'exposure_group_list': return factoryCafe24JsonText(raw.exposure_group_list);
    case 'main_display': return factoryCafe24JsonText(raw.main);
    case 'relational_product': return factoryCafe24JsonText(raw.relational_product);
    case 'size_guide': return factoryCafe24StructuredText('size_guide', raw.size_guide);
    case 'memo': return first(raw.memo, raw.admin_memo);
    case 'search_keywords': {
      const tags = raw.product_tag || raw.search_keywords || raw.keyword;
      return Array.isArray(tags) ? tags.join(', ') : String(tags || '');
    }
    default:
      return factorySourceRowsValueByAliases(rows, [field.id, ...(field.aliases || [])]);
  }
}

function factoryCafe24FieldRouteInfo(field = {}, sourceType = '') {
  if (sourceType !== 'cafe24') return null;
  if (field.readonly || FACTORY_CAFE24_INPUT_HIDDEN_IDS.has(field.id)) {
    return { label: '읽기전용', tone: 'readonly', title: 'Cafe24가 계산하거나 전용 영역에서 관리하는 값입니다.' };
  }
  const routeKey = factoryDbNormalizeKey(field.apiField || field.id || '');
  const isDedicated = FACTORY_CAFE24_DEDICATED_API_FIELDS.has(field.id) ||
    FACTORY_CAFE24_DEDICATED_API_FIELDS.has(field.apiField) ||
    FACTORY_CAFE24_DEDICATED_API_FIELDS.has(routeKey);
  if (isDedicated) {
    if (/category|분류/i.test(`${field.id} ${field.apiField || ''}`)) {
      return { label: '카테고리 API', tone: 'dedicated', title: '상품 기본 저장과 별도로 카테고리 연결 API로 동기화합니다.' };
    }
    if (/image|icon|이미지|아이콘/i.test(`${field.id} ${field.apiField || ''}`)) {
      return { label: '이미지 API', tone: 'dedicated', title: '상품 기본 저장과 별도로 이미지/아이콘 API로 동기화합니다.' };
    }
    if (/^(has_option|option_type|option_list_type|select_one_by_option)$/i.test(`${field.id}`) ||
      /^(has_option|option_type|option_list_type|select_one_by_option)$/i.test(`${field.apiField || ''}`)) {
      return { label: '옵션 설정 API', tone: 'dedicated', title: '옵션 사용 여부/구성/표시 방식은 Cafe24 옵션 설정 API로 동기화합니다.' };
    }
    if (/option|variant|inventory|stock|옵션|품목|재고/i.test(`${field.id} ${field.apiField || ''}`)) {
      return { label: '옵션 API', tone: 'dedicated', title: '상품 기본 저장과 별도로 옵션/품목/재고 API로 동기화합니다.' };
    }
    if (/tag|keyword|product_tag|검색|태그|키워드/i.test(`${field.id} ${field.apiField || ''}`)) {
      return { label: '태그 API', tone: 'dedicated', title: '상품 기본 저장과 별도로 상품 태그 API로 동기화합니다.' };
    }
    if (/seo|meta|search_engine|검색엔진/i.test(`${field.id} ${field.apiField || ''}`)) {
      return { label: 'SEO API', tone: 'dedicated', title: '상품 기본 저장과 별도로 검색엔진 SEO API로 동기화합니다.' };
    }
    return { label: '전용 API', tone: 'dedicated', title: '상품 기본 저장과 별도 전용 API로 동기화합니다.' };
  }
  const apiField = factoryCafe24CanonicalUpdateField(field.apiField || field.id || '');
  if (apiField) return { label: '상품 저장', tone: 'product', title: 'Cafe24 상품 기본정보 저장 payload에 포함됩니다.' };
  return { label: '저장 제외', tone: 'readonly', title: '현재 상품 기본 저장 payload에서는 제외됩니다.' };
}

function renderFactoryCafe24FieldViewControls(factory = factoryRuntimeReadFactory(), baseModel = null) {
  const view = factoryCafe24FieldViewState(factory);
  const baseKeys = new Set((baseModel?.sections || []).flatMap(section => section.fields.map(field => factoryCafe24FieldUiKey(field)).filter(Boolean)));
  const hiddenCount = view.hiddenFieldIds.filter(key => baseKeys.has(key)).length;
  const totalCount = baseKeys.size || (baseModel?.sections || []).reduce((sum, section) => sum + section.fields.length, 0);
  const visibleCount = Math.max(0, totalCount - hiddenCount);
  const emptyVisibleCount = factoryCafe24EmptyVisibleFieldKeys(baseModel, factory).length;
  const defaultSavedText = view.defaultSavedAt ? ` · 기본 저장 ${new Date(view.defaultSavedAt).toLocaleString()}` : '';
  return `<div class="factory-cafe24-field-view">
    <div class="factory-cafe24-field-view-head">
      <div>
        <div class="factory-cafe24-field-view-title">Cafe24 입력칸 표시 구성</div>
        <div class="factory-cafe24-field-view-sub">- 버튼은 화면에서만 숨깁니다. 숨긴 칸도 Cafe24 원본값과 동기화 연결은 유지됩니다. 현재 구성은 다음 제품에도 자동 적용됩니다. 현재 표시 ${visibleCount}개 · 미기입 ${emptyVisibleCount}개 · 사용 안 함 ${hiddenCount}개${escapeHtml(defaultSavedText)}</div>
      </div>
      <div class="factory-cafe24-field-view-actions">
        <select id="factoryCafe24FieldPresetSelect" title="저장된 Cafe24 입력판 프리셋">
          <option value="">프리셋 선택</option>
          ${view.presets.map(preset => `<option value="${escAttr(preset.id)}" ${preset.id === view.activePresetId ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`).join('')}
        </select>
        <button class="btn-sm" id="factoryCafe24ApplyFieldPreset" type="button" title="선택한 프리셋의 입력칸 표시/숨김 구성을 현재 Cafe24 입력판에 적용합니다." ${disabledAttr(!view.activePresetId, '적용할 프리셋을 선택해주세요.')}><span class="material-icons-outlined" style="font-size:14px">done</span>프리셋 적용</button>
        <button class="btn-sm" id="factoryCafe24HideEmptyFields" type="button" title="현재 화면에 보이는 미기입 Cafe24 입력칸을 한 번에 사용 안 함 영역으로 보냅니다. 값과 동기화 연결은 유지됩니다." ${disabledAttr(!emptyVisibleCount, '현재 표시된 미기입 입력칸이 없습니다.')}><span class="material-icons-outlined" style="font-size:14px">playlist_remove</span>미기입 전체 사용 안 함</button>
        <button class="btn-sm" id="factoryCafe24SaveDefaultFieldView" type="button" title="현재 Cafe24 입력판 표시 구성을 기본값으로 저장해 다음 상품에도 자동 적용합니다."><span class="material-icons-outlined" style="font-size:14px">save</span>기본설정 저장</button>
        <button class="btn-sm" id="factoryCafe24SaveFieldPreset" type="button" title="현재 Cafe24 입력판 표시 구성을 이름 있는 프리셋으로 저장합니다."><span class="material-icons-outlined" style="font-size:14px">bookmark_add</span>현재 구성 프리셋 저장</button>
        <button class="btn-sm" id="factoryCafe24DeleteFieldPreset" type="button" title="선택한 Cafe24 입력판 표시 프리셋을 삭제합니다. 기본설정은 별도로 유지됩니다." ${disabledAttr(!view.activePresetId, '삭제할 프리셋을 선택해주세요.')}><span class="material-icons-outlined" style="font-size:14px">delete</span>프리셋 삭제</button>
        <button class="btn-sm" id="factoryCafe24ResetHiddenFields" type="button" title="사용 안 함으로 숨긴 Cafe24 입력칸을 모두 다시 화면에 표시합니다." ${disabledAttr(!hiddenCount, '숨긴 입력칸이 없습니다.')}><span class="material-icons-outlined" style="font-size:14px">restart_alt</span>전체 표시</button>
      </div>
    </div>
  </div>`;
}

function factorySourcePanelState(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const product = factory.product || {};
  const current = product.sourcePanelState && typeof product.sourcePanelState === 'object' ? product.sourcePanelState : {};
  product.sourcePanelState = {
    cafe24Collapsed: !!current.cafe24Collapsed,
    sinhwaCollapsed: !!current.sinhwaCollapsed,
    cafe24CollapsedSections: Array.isArray(current.cafe24CollapsedSections) ? current.cafe24CollapsedSections.filter(Boolean) : [],
    sinhwaCollapsedSections: Array.isArray(current.sinhwaCollapsedSections) ? current.sinhwaCollapsedSections.filter(Boolean) : [],
  };
  return product.sourcePanelState;
}

function factorySourcePanelSectionKey(sourceType, title) {
  return `${sourceType || 'source'}_${factoryDbNormalizeKey(title || 'section') || 'section'}`;
}

function factorySourcePanelSectionList(sourceType) {
  const sections = sourceType === 'cafe24' ? FACTORY_CAFE24_FIELD_SECTIONS : FACTORY_SINHWA_FIELD_SECTIONS;
  return (sections || []).map(section => factorySourcePanelSectionKey(sourceType, section.title));
}

function factorySourcePanelCollapsedSectionKey(sourceType) {
  return sourceType === 'cafe24' ? 'cafe24CollapsedSections' : 'sinhwaCollapsedSections';
}

function factorySetSourcePanelCollapsed(sourceType, collapsed) {
  const factory = factoryRuntimeReadFactory();
  const panelState = factorySourcePanelState(factory);
  if (sourceType === 'cafe24') panelState.cafe24Collapsed = !!collapsed;
  else panelState.sinhwaCollapsed = !!collapsed;
  factoryLog(`${sourceType === 'cafe24' ? 'Cafe24 입력판' : '신화사DB 자료판'}을 ${collapsed ? '접었습니다' : '펼쳤습니다'}.`, 'ok');
  saveLastWorkNow();
  renderPreservingMainScroll();
}

function factorySetAllSourcePanelsCollapsed(collapsed, options = {}) {
  if (!options.factory) {
    const receipt = factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:set-source-panels-collapsed',
      'cafe24',
      draft => factorySetAllSourcePanelsCollapsed(collapsed, { ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) renderPreservingMainScroll();
    return receipt.result;
  }
  const factory = options.factory;
  const panelState = factorySourcePanelState(factory);
  panelState.cafe24Collapsed = !!collapsed;
  panelState.sinhwaCollapsed = !!collapsed;
  factoryLog(`Cafe24/신화사DB 입력판을 모두 ${collapsed ? '접었습니다' : '펼쳤습니다'}.`, 'ok', factory);
  return true;
}

function factoryToggleSourcePanelSection(sourceType, sectionKey) {
  if (!sectionKey) return;
  const panelState = factorySourcePanelState(factoryRuntimeReadFactory());
  const listKey = factorySourcePanelCollapsedSectionKey(sourceType);
  const set = new Set(panelState[listKey] || []);
  if (set.has(sectionKey)) set.delete(sectionKey);
  else set.add(sectionKey);
  panelState[listKey] = [...set];
  saveLastWorkNow();
  renderPreservingMainScroll();
}

function factorySetSourcePanelSectionsCollapsed(sourceType, collapsed) {
  const panelState = factorySourcePanelState(factoryRuntimeReadFactory());
  const listKey = factorySourcePanelCollapsedSectionKey(sourceType);
  panelState[listKey] = collapsed ? factorySourcePanelSectionList(sourceType) : [];
  factoryLog(`${sourceType === 'cafe24' ? 'Cafe24' : '신화사DB'} 섹션을 모두 ${collapsed ? '접었습니다' : '펼쳤습니다'}.`, 'ok');
  saveLastWorkNow();
  renderPreservingMainScroll();
}

function factoryDbInputSnapshotList(factory = factoryRuntimeReadFactory()) {
  const list = factory.product && Array.isArray(factory.product.dbInputSnapshots) ? factory.product.dbInputSnapshots : [];
  return list.filter(item => item && typeof item === 'object').slice(0, 30);
}

function factoryDbInputSnapshotLabel(snapshot) {
  const name = String(snapshot?.productName || '이름 없음').trim();
  const productNo = snapshot?.productNo ? `#${snapshot.productNo}` : '상품번호 없음';
  const count = Number(snapshot?.cafe24SaveFieldCount || 0);
  const time = snapshot?.savedAt ? new Date(snapshot.savedAt).toLocaleString() : '시간 없음';
  return `${name} · ${productNo} · Cafe24 변경 ${count}개 · ${time}`;
}

function factoryBuildDbInputSnapshot(factory = factoryRuntimeReadFactory(), options = {}) {
  if (!options.skipFlush && typeof factoryFlushDbInputPanelDomValues === 'function') factoryFlushDbInputPanelDomValues({ factory });
  if (typeof factoryUpdateFromInputs === 'function') factoryUpdateFromInputs(factory);
  try {
    if (typeof factoryUpdateFinalDbFromFields === 'function') factoryUpdateFinalDbFromFields(factory);
  } catch(e) {}
  let productNo = '';
  try {
    productNo = factoryCafe24TargetInfo(factory).productNo || '';
  } catch(e) {}
  let saveDiff = null;
  try {
    saveDiff = factoryCafe24SaveDiffModel(factory);
  } catch(e) {}
  const product = factory.product || {};
  return {
    id: uid('db_snapshot'),
    savedAt: Date.now(),
    productName: product.productName || state.productName || '',
    productNo,
    selectedDbCandidateKey: product.selectedDbCandidateKey || '',
    selectedCafe24CandidateKey: product.selectedCafe24CandidateKey || '',
    cafe24DraftProductKey: product.cafe24DraftProductKey || '',
    dbFieldSettings: cloneData(product.dbFieldSettings || {}),
    finalDb: cloneData(product.finalDb || {}),
    confirmedDb: cloneData(product.confirmedDb || {}),
    cafe24SaveFieldCount: saveDiff?.fieldNames?.length || 0,
    cafe24PayloadFields: Array.isArray(saveDiff?.fieldNames) ? saveDiff.fieldNames.slice() : [],
  };
}

function factoryFlushDbInputPanelDomValues(options = {}) {
  if (typeof document === 'undefined') return;
  if (!options.factory) {
    const receipt = factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:flush-db-input-panel',
      'cafe24',
      draft => factoryFlushDbInputPanelDomValues({ ...options, factory: draft }),
    );
    if (receipt.result > 0) {
      if (typeof factoryRefreshCafe24PrimaryActionButtons === 'function') factoryRefreshCafe24PrimaryActionButtons();
      if (typeof factoryRefreshCafe24DedicatedActionButtons === 'function') factoryRefreshCafe24DedicatedActionButtons();
      if (typeof scheduleLastWorkSave === 'function') scheduleLastWorkSave();
    }
    return receipt.result;
  }
  const factory = options.factory;
  const committedPanelFields = new Set();
  let changedCount = 0;
  const commitValue = (fieldId, value) => {
    const key = String(fieldId || '').trim();
    if (!key || typeof factorySetDbFieldManualValue !== 'function') return;
    const nextValue = value === null || value === undefined ? '' : String(value);
    const setting = factory.product?.dbFieldSettings?.[key];
    if (!setting && !nextValue.trim()) return key;
    const sameValue = setting && String(setting.manualValue ?? '') === nextValue;
    const sameEnabled = setting && setting.enabled === true;
    if (setting?.manualTouched === true && sameValue && sameEnabled) return key;
    const changed = factorySetDbFieldManualValue(key, nextValue, { enabled: true, deferFinalize: true, factory });
    if (changed) changedCount += 1;
    return key;
  };
  document.querySelectorAll('[data-factory-panel-edit]').forEach(input => {
    const key = commitValue(input.dataset.factoryPanelEdit, input.value);
    if (key) committedPanelFields.add(key);
  });
  document.querySelectorAll('[data-factory-sinhwa-edit]').forEach(input => {
    const key = String(input.dataset.factorySinhwaEdit || '').trim();
    if (committedPanelFields.has(key)) return;
    commitValue(input.dataset.factorySinhwaEdit, input.value);
  });
  const structuredRoots = new Map();
  document.querySelectorAll('[data-factory-cafe24-structured-field]').forEach(input => {
    const [root, key] = String(input.dataset.factoryCafe24StructuredField || '').split(':');
    if (!root || !key) return;
    const next = structuredRoots.get(root) || {};
    next[key] = input.value;
    structuredRoots.set(root, next);
  });
  structuredRoots.forEach((value, root) => {
    commitValue(root, JSON.stringify(value));
  });
  if (changedCount > 0) {
    try {
      if (typeof factoryUpdateFinalDbFromFields === 'function') factoryUpdateFinalDbFromFields(factory);
    } catch(e) {}
  }
  return changedCount;
}

async function factorySaveCurrentDbInputSnapshot(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:save-db-input-snapshot',
      'cafe24',
      draft => factorySaveCurrentDbInputSnapshot({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (receipt.result?.shouldSendCafe24) {
      setTimeout(async () => {
        try {
          await factorySaveCafe24ProductFromFinalDb({
            skipConfirm: options.skipCafe24Confirm !== false,
            deferInitialSave: true,
          });
        } catch (error) {
          console.error('Cafe24 DB 입력판 백그라운드 전송 실패', error);
        }
      }, 0);
    }
    if (options.askCollapse && confirm('DB 입력판을 저장했습니다. Cafe24/신화사DB 긴 입력판을 전체 최소화할까요?')) {
      factorySetAllSourcePanelsCollapsed(true, { render: false });
    }
    if (options.render !== false) renderPreservingMainScroll();
    return;
  }
  const factory = options.factory;
  if (typeof factoryFlushDbInputPanelDomValues === 'function') factoryFlushDbInputPanelDomValues({ factory });
  const snapshot = factoryBuildDbInputSnapshot(factory, { skipFlush: true });
  const list = factoryDbInputSnapshotList(factory).filter(item => item.id !== snapshot.id);
  factory.product.dbInputSnapshots = [snapshot, ...list].slice(0, 30);
  factory.product.dbInputSavedAt = snapshot.savedAt;
  factoryLog(`DB 입력판 저장 완료: ${factoryDbInputSnapshotLabel(snapshot)}`, 'ok', factory);

  const shouldSendCafe24 = !!options.forceSync || (factory.product.cafe24AutoSendOnSave !== false && options.autoSync !== false);
  if (shouldSendCafe24) {
    factory.product.cafe24ApiStatus = 'Cafe24 전송 준비 중: 화면은 바로 풀고, 저장 작업은 백그라운드에서 진행합니다.';
    factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  }
  return { snapshot, shouldSendCafe24 };
}

function factoryLoadDbInputSnapshot(snapshotId, options = {}) {
  if (!options.factory) {
    const transaction = factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:load-db-input-snapshot',
      'cafe24',
      draft => factoryLoadDbInputSnapshot(snapshotId, { ...options, factory: draft, render: false }),
    );
    return Promise.resolve(transaction).then(receipt => {
      saveLastWorkNow({ sync: false });
      if (options.render !== false) renderPreservingMainScroll();
      return receipt.result;
    });
  }
  const factory = options.factory;
  const snapshot = factoryDbInputSnapshotList(factory).find(item => item.id === snapshotId);
  if (!snapshot) return false;
  factory.product.dbFieldSettings = cloneData(snapshot.dbFieldSettings || {});
  factory.product.finalDb = cloneData(snapshot.finalDb || {});
  factory.product.confirmedDb = cloneData(snapshot.confirmedDb || {});
  factory.product.selectedDbCandidateKey = snapshot.selectedDbCandidateKey || factory.product.selectedDbCandidateKey || '';
  factory.product.selectedCafe24CandidateKey = snapshot.selectedCafe24CandidateKey || factory.product.selectedCafe24CandidateKey || '';
  factory.product.cafe24DraftProductKey = snapshot.cafe24DraftProductKey || factory.product.cafe24DraftProductKey || '';
  factoryLog(`저장된 DB 입력판을 불러왔습니다: ${factoryDbInputSnapshotLabel(snapshot)}`, 'ok', factory);
  return true;
}

function factoryDeleteDbInputSnapshot(snapshotId, options = {}) {
  if (!options.factory) {
    const transaction = factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:delete-db-input-snapshot',
      'cafe24',
      draft => factoryDeleteDbInputSnapshot(snapshotId, { ...options, factory: draft, render: false }),
    );
    return Promise.resolve(transaction).then(receipt => {
      saveLastWorkNow({ sync: false });
      if (options.render !== false) renderPreservingMainScroll();
      return receipt.result;
    });
  }
  const factory = options.factory;
  factory.product.dbInputSnapshots = factoryDbInputSnapshotList(factory).filter(item => item.id !== snapshotId);
  factoryLog('저장된 DB 입력판 항목을 삭제했습니다.', 'ok', factory);
  return true;
}

function renderFactoryDbInputSnapshotControls(factory = factoryRuntimeReadFactory()) {
  const snapshots = factoryDbInputSnapshotList(factory);
  const selectedId = snapshots[0]?.id || '';
  const savedText = factory.product.dbInputSavedAt ? `마지막 DB 입력판 저장 ${new Date(factory.product.dbInputSavedAt).toLocaleString()}` : '아직 저장된 DB 입력판 없음';
  return `<div class="factory-db-input-save-panel">
    <div class="factory-db-input-save-head">
      <div>
        <div class="factory-cafe24-field-view-title">DB 입력판 저장 / Cafe24 전송</div>
        <div class="factory-cafe24-field-view-sub">현재 채워둔 Cafe24/신화사DB 입력값을 리스트에 보관합니다. 자동 전송을 켜두면 저장할 때 Cafe24 상품 기본 입력칸도 같이 업데이트합니다. ${escapeHtml(savedText)}</div>
      </div>
      <label class="factory-cafe24-autosync">
        <input id="factoryCafe24AutoSendOnSave" type="checkbox" ${factory.product.cafe24AutoSendOnSave !== false ? 'checked' : ''}>
        저장 시 Cafe24 자동 업데이트
      </label>
    </div>
    <div class="factory-cafe24-field-view-actions">
      <button class="btn-sm primary" id="factorySaveDbInputSnapshot" type="button" title="현재 Cafe24/신화사DB 입력값과 완성 DB 상태를 앱 안의 저장 리스트에 보관합니다."><span class="material-icons-outlined" style="font-size:14px">save_as</span>현재 기입 내역 저장</button>
      <button class="btn-sm" id="factorySendDbInputToCafe24" type="button" title="현재 입력판에서 Cafe24 상품 기본 저장 대상인 변경값만 실제 Cafe24 상품에 전송하고 재조회로 반영 여부를 확인합니다."><span class="material-icons-outlined" style="font-size:14px">cloud_upload</span>기입한 내역 Cafe24로 보내기</button>
      <button class="btn-sm" data-factory-source-collapse-all="1" type="button" title="Cafe24 입력판과 신화사DB 자료판을 모두 접어 긴 DB 영역을 줄입니다. 값과 동기화 연결은 유지됩니다."><span class="material-icons-outlined" style="font-size:14px">unfold_less</span>전체 최소화</button>
      <button class="btn-sm" data-factory-source-collapse-all="0" type="button" title="접어둔 Cafe24 입력판과 신화사DB 자료판을 모두 다시 펼칩니다."><span class="material-icons-outlined" style="font-size:14px">unfold_more</span>전체 펼치기</button>
      <button class="btn-sm" data-factory-source-panel-collapse="sinhwa" data-collapse="1" type="button" title="Cafe24 입력판은 그대로 두고 신화사DB 자료판만 접습니다."><span class="material-icons-outlined" style="font-size:14px">keyboard_double_arrow_up</span>신화사DB만 최소화</button>
    </div>
    <div class="factory-db-snapshot-list">
      <select id="factoryDbInputSnapshotSelect" ${snapshots.length ? '' : 'disabled'}>
        ${snapshots.length ? snapshots.map(item => `<option value="${escAttr(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${escapeHtml(factoryDbInputSnapshotLabel(item))}</option>`).join('') : '<option value="">저장된 입력판 없음</option>'}
      </select>
      <button class="btn-sm" id="factoryLoadDbInputSnapshot" type="button" title="선택한 저장 내역의 Cafe24/신화사DB 입력값과 완성 DB 상태를 현재 작업에 다시 불러옵니다." ${disabledAttr(!snapshots.length, '불러올 저장 내역이 없습니다.')}><span class="material-icons-outlined" style="font-size:14px">history</span>불러오기</button>
      <button class="btn-sm danger" id="factoryDeleteDbInputSnapshot" type="button" title="선택한 DB 입력판 저장 내역을 리스트에서 삭제합니다. 현재 화면 입력값은 바로 지우지 않습니다." ${disabledAttr(!snapshots.length, '삭제할 저장 내역이 없습니다.')}><span class="material-icons-outlined" style="font-size:14px">delete</span>삭제</button>
    </div>
  </div>`;
}

function renderFactoryCafe24HiddenFieldShelf(factory = factoryRuntimeReadFactory(), baseModel = null) {
  const hiddenSections = factoryCafe24UserHiddenSections(baseModel?.sections || [], factory);
  const hiddenCount = hiddenSections.reduce((sum, section) => sum + section.fields.length, 0);
  if (!hiddenCount) return '';
  return `<details class="factory-cafe24-hidden-shelf">
    <summary>사용 안 함으로 빼놓은 입력칸 ${hiddenCount}개 열기</summary>
    <div class="factory-cafe24-hidden-body">
      <div class="factory-cafe24-field-view-sub">+ 버튼을 누르면 다시 위 입력판으로 돌아옵니다. 숨겨져 있는 동안에도 Cafe24 원본/저장/동기화 계산에서는 값이 보존됩니다.</div>
      ${hiddenSections.map(section => `<div class="factory-cafe24-hidden-section">
        <h6>${escapeHtml(section.title)}</h6>
        <div class="factory-cafe24-hidden-chip-wrap">
          ${section.fields.map(field => {
            const key = factoryCafe24FieldUiKey(field);
            const routeInfo = factoryCafe24FieldRouteInfo(field, 'cafe24');
            return `<span class="factory-cafe24-hidden-chip">
              <button class="factory-field-visibility-btn add" data-factory-cafe24-show-field="${escAttr(key)}" type="button" title="다시 입력판에 표시">+</button>
              <span>${escapeHtml(field.label)}</span>
              ${routeInfo ? `<small style="color:var(--text-m)">${escapeHtml(routeInfo.label)}</small>` : ''}
              ${field.required ? `<small style="color:var(--danger)">필수</small>` : ''}
            </span>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </div>
  </details>`;
}

const FACTORY_CAFE24_SINHWA_COMPARE_FIELD_MAP = {
  product_name: 'product_name',
  category: 'category',
  sale_price: 'sale_price',
  consumer_price: 'consumer_price',
  purchase_price: 'purchase_price',
  stock: 'stock',
  option_values: 'option_values',
  option_count: 'option_count',
  manufacturer: 'manufacturer',
  supplier: 'supplier',
  brand: 'brand',
  trend_code: 'trend_code',
  classification_code: 'classification_code',
  material: 'material',
  product_weight: 'weight',
  product_volume: 'size',
};

function factoryCompareTextValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(factoryCompareTextValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => v != null && String(v).trim() !== '')
      .map(([k, v]) => `${factoryDisplayFieldLabel(k)} ${factoryCompareTextValue(v)}`)
      .filter(Boolean)
      .join(' / ');
  }
  return String(value || '').trim();
}

function factoryCompareTokens(field = {}) {
  return [
    field.dbFieldId,
    field.id,
    field.apiField,
    field.label,
    ...(field.aliases || []),
  ]
    .map(factoryDbNormalizeKey)
    .filter(token => token && token.length >= 2);
}

function factorySourceCompareScore(cafe24Field = {}, sinhwaField = {}) {
  const mappedId = FACTORY_CAFE24_SINHWA_COMPARE_FIELD_MAP[cafe24Field.id] ||
    FACTORY_CAFE24_SINHWA_COMPARE_FIELD_MAP[cafe24Field.dbFieldId] ||
    '';
  if (mappedId && (sinhwaField.id === mappedId || sinhwaField.dbFieldId === mappedId)) return 100;
  if (cafe24Field.dbFieldId && sinhwaField.dbFieldId && cafe24Field.dbFieldId === sinhwaField.dbFieldId) return 95;
  const cafeTokens = factoryCompareTokens(cafe24Field);
  const sinhwaTokens = factoryCompareTokens(sinhwaField);
  let score = 0;
  cafeTokens.forEach(token => {
    if (sinhwaTokens.includes(token)) score = Math.max(score, 70);
    else if (token.length >= 4 && sinhwaTokens.some(other => other.includes(token) || token.includes(other))) score = Math.max(score, 45);
  });
  return score;
}

function factoryCafe24SinhwaCompareMap(factory = factoryRuntimeReadFactory(), cafe24BaseModel = null) {
  const sinhwaModel = factoryBuildSourcePanelModel(factory, 'sinhwa', FACTORY_SINHWA_FIELD_SECTIONS);
  const sinhwaFields = sinhwaModel.sections.flatMap(section => section.fields || []);
  const cafe24Fields = (cafe24BaseModel?.sections || []).flatMap(section => section.fields || []);
  const map = new Map();
  cafe24Fields.forEach(field => {
    let best = null;
    let bestScore = 0;
    sinhwaFields.forEach(candidate => {
      const score = factorySourceCompareScore(field, candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    });
    if (best && bestScore >= 70) map.set(factoryCafe24FieldUiKey(field), { ...best, compareScore: bestScore });
  });
  return map;
}

function factoryCompareValueTone(cafe24Value = '', sinhwaValue = '') {
  const cafeText = factoryCompareTextValue(cafe24Value);
  const sinhwaText = factoryCompareTextValue(sinhwaValue);
  if (!sinhwaText) return { tone: 'missing', label: '신화사 미입력' };
  if (!cafeText) return { tone: 'missing', label: 'Cafe24 미입력' };
  const cafeDims = factoryCompareDimensionSignature(cafeText);
  const sinhwaDims = factoryCompareDimensionSignature(sinhwaText);
  if (cafeDims.dimKey && sinhwaDims.dimKey) {
    if (cafeDims.dimKey === sinhwaDims.dimKey) {
      if (cafeDims.unit && sinhwaDims.unit && cafeDims.unit !== sinhwaDims.unit) {
        return { tone: 'diff', label: '단위 다름' };
      }
      return { tone: 'match', label: cafeDims.unit && sinhwaDims.unit ? '일치' : '수치 일치' };
    }
    return { tone: 'diff', label: '규격 다름' };
  }
  const cafeNorm = factoryDbNormalizeKey(cafeText);
  const sinhwaNorm = factoryDbNormalizeKey(sinhwaText);
  if (cafeNorm && sinhwaNorm && cafeNorm === sinhwaNorm) return { tone: 'match', label: '일치' };
  if (cafeNorm && sinhwaNorm && (cafeNorm.includes(sinhwaNorm) || sinhwaNorm.includes(cafeNorm))) {
    return { tone: 'match', label: '맥락 일치' };
  }
  return { tone: 'diff', label: '비교 필요' };
}

function factoryCompareDimensionSignature(text = '') {
  const raw = String(text || '').trim();
  if (!raw || /사용\s*안\s*함|미사용|설정\s*안\s*함/i.test(raw)) return { key: '' };
  const payload = factoryCafe24ProductVolumePayload(raw);
  if (!payload || typeof payload !== 'object' || payload.use_product_volume === 'F') return { key: '' };
  const unit = String(payload.unit || '').toLowerCase();
  const parts = ['width', 'height', 'length']
    .map(key => String(payload[key] ?? '').replace(/,/g, '').trim())
    .filter(Boolean);
  const dimKey = parts.length ? parts.join('x') : '';
  return { key: dimKey ? `${dimKey}|${unit}` : '', dimKey, unit };
}

function factorySourceReadableValue(field = {}, factory = factoryRuntimeReadFactory()) {
  const value = field.value;
  if (field.id === 'product_volume') {
    const structured = factoryCafe24ProductVolumePayload(value);
    return structured && typeof structured === 'object'
      ? factoryCafe24StructuredText('product_volume', structured)
      : factoryCompareTextValue(value);
  }
  if (field.apiField && CAFE24_PRODUCT_JSON_PAYLOAD_FIELDS.has(field.apiField)) {
    const structured = factoryCafe24StructuredJsonPayload(field.apiField, value);
    return structured && (Array.isArray(structured) || typeof structured === 'object')
      ? factoryCafe24StructuredText(field.apiField, structured)
      : factoryCompareTextValue(value);
  }
  if (field.id === 'category') {
    const rows = factoryCafe24CategoryRows(value, factory);
    const label = rows.map(row => factoryCafe24CategoryLabel(row, factory)).filter(Boolean).join(', ');
    return label || factoryCompareTextValue(value);
  }
  if (field.referenceType) {
    const selected = factoryCafe24ReferenceSelectedValue(field, value, factory);
    const list = factoryCafe24ReferenceList(field.referenceType, factory);
    const hit = list.find(item => String(item.code) === String(selected));
    if (hit) return factoryCafe24ReferenceSelectLabel(hit);
    return factoryCompareTextValue(value);
  }
  if (Array.isArray(field.selectOptions) && field.selectOptions.length) {
    const selected = factoryCafe24SelectOptionValue(value, field.selectOptions);
    const hit = field.selectOptions.find(item => String(item.value ?? '').trim() === String(selected).trim());
    if (hit) return factoryCafe24SelectLabel(hit);
    return factoryCompareTextValue(value);
  }
  return factoryCompareTextValue(value);
}

function renderFactorySourceCompareCell(field = {}, compareField = null, options = {}) {
  if (!compareField) return '';
  const factory = options.factory || factoryRuntimeReadFactory();
  const cafe24Value = factorySourceReadableValue(field, factory);
  const value = factoryCompareTextValue(compareField.value);
  const result = factoryCompareValueTone(cafe24Value || field.value, value);
  const cafe24FieldId = field.id || field.apiField || field.dbFieldId || '';
  const sinhwaFieldId = compareField.dbFieldId || compareField.id || '';
  const compareLabel = compareField.label || field.label || '';
  return `<div class="factory-source-compare-cell ${escAttr(result.tone)}">
    <div class="factory-source-compare-head">
      <span>신화사DB</span>
      <small>${escapeHtml(compareLabel)}</small>
      <span class="factory-source-compare-badge ${escAttr(result.tone)}">${escapeHtml(result.label)}</span>
    </div>
    <textarea class="factory-source-compare-edit ${value ? '' : 'missing'}" data-factory-sinhwa-edit="${escAttr(sinhwaFieldId)}" data-factory-sinhwa-label="${escAttr(compareLabel)}" rows="${value.length > 70 ? 3 : 2}" placeholder="신화사DB 값 직접 입력">${escapeHtml(value)}</textarea>
    <div class="factory-source-compare-actions">
      <button class="btn-sm" type="button" title="신화사DB 비교값을 왼쪽 Cafe24 입력칸으로 복사합니다. 실제 Cafe24 반영은 '기입한 내역 Cafe24로 보내기'를 눌러야 합니다." data-factory-copy-sinhwa-to-cafe24="${escAttr(cafe24FieldId)}" data-factory-copy-label="${escAttr(field.label || compareLabel)}" data-factory-copy-value="${escAttr(value)}" ${disabledAttr(!cafe24FieldId || !value, '신화사DB 값 또는 Cafe24 대상 칸이 없습니다.')}>Cafe24 ← 신화사DB</button>
    </div>
  </div>`;
}

function renderFactorySourceField(field, options = {}) {
  const missing = field.required && !field.value;
  const sendField = field.dbFieldId || field.id;
  const editable = options.editable === true && sendField && !field.readonly;
  const factory = options.factory || factoryRuntimeReadFactory();
  const sourceType = options.sourceType || '';
  const referenceOptions = field.referenceType ? factoryCafe24ReferenceList(field.referenceType, factory) : [];
  const selectedReferenceValue = field.referenceType ? factoryCafe24ReferenceSelectedValue(field, field.value, factory) : '';
  const codeOptions = Array.isArray(field.selectOptions) ? field.selectOptions : [];
  const selectedCodeValue = codeOptions.length ? factoryCafe24SelectOptionValue(field.value, codeOptions) : '';
  const renderReferenceSelect = editable && field.referenceType && referenceOptions.length > 0;
  const renderCodeSelect = editable && !renderReferenceSelect && codeOptions.length;
  const hasCurrentReference = selectedReferenceValue && !referenceOptions.some(item => String(item.code) === String(selectedReferenceValue));
  const hasCurrentCode = selectedCodeValue && !codeOptions.some(item => String(item.value) === String(selectedCodeValue));
  const isLongEditable = /description|information|info|html|tag|keyword|message|period|guide|rates|icon|list/i.test(`${field.id} ${field.apiField || ''}`) || String(field.value || '').length > 110;
  const apiKeyLabel = '';
  const routeInfo = factoryCafe24FieldRouteInfo(field, sourceType);
  const structuredField = renderFactoryCafe24StructuredSourceField(field, { ...options, editable, factory, sourceType });
  if (structuredField) return structuredField;
  const cafe24FieldKey = sourceType === 'cafe24' ? factoryCafe24FieldUiKey(field) : '';
  const compareCell = sourceType === 'cafe24' ? renderFactorySourceCompareCell(field, options.compareField, options) : '';
  const compareFieldId = options.compareField?.dbFieldId || options.compareField?.id || '';
  const compareLabel = options.compareField?.label || field.label || '';
  const cafeCopyValue = sourceType === 'cafe24' ? factorySourceReadableValue(field, factory) : '';
  const cafeToSinhwaAction = sourceType === 'cafe24' && options.compareField ? `<div class="factory-source-cafe24-actions">
    <button class="btn-sm" type="button" title="현재 Cafe24 입력값을 오른쪽 신화사DB 비교칸/완성 DB 값으로 복사합니다. Cafe24 사이트 저장은 하지 않습니다." data-factory-copy-cafe24-to-sinhwa="${escAttr(compareFieldId)}" data-factory-copy-label="${escAttr(compareLabel)}" data-factory-copy-value="${escAttr(cafeCopyValue)}" ${disabledAttr(!compareFieldId || !cafeCopyValue, 'Cafe24 값 또는 신화사DB 대상 칸이 없습니다.')}>Cafe24 → 신화사DB</button>
  </div>` : '';
  return `<div class="factory-source-field ${missing ? 'missing' : ''}">
    <div class="factory-source-field-top">
      <div class="factory-source-field-label">${escapeHtml(field.label)}${apiKeyLabel}</div>
      ${routeInfo ? `<span class="factory-source-route-badge ${escAttr(routeInfo.tone)}" title="${escAttr(routeInfo.title)}">${escapeHtml(routeInfo.label)}</span>` : ''}
      ${field.required ? '<span class="factory-db-required">필수</span>' : ''}
      ${cafe24FieldKey ? `<button class="factory-field-visibility-btn" data-factory-cafe24-hide-field="${escAttr(cafe24FieldKey)}" type="button" title="이 입력칸을 사용 안 함으로 아래에 숨김">-</button>` : ''}
    </div>
    ${renderReferenceSelect
      ? `<select class="factory-source-select ${missing ? 'missing' : ''}" data-factory-panel-edit="${escAttr(sendField)}" data-factory-panel-label="${escAttr(field.label)}">
          <option value="">선택 안 함</option>
          ${hasCurrentReference ? `<option value="${escAttr(selectedReferenceValue)}" selected title="${escAttr(selectedReferenceValue)}">${escapeHtml(factoryCafe24CurrentReferenceLabel(field, field.value, factory))}</option>` : ''}
          ${referenceOptions.map(item => `<option value="${escAttr(item.code)}" ${String(item.code) === String(selectedReferenceValue) ? 'selected' : ''} title="${escAttr(item.code)}">${escapeHtml(factoryCafe24ReferenceSelectLabel(item))}</option>`).join('')}
        </select>
        <div class="factory-source-edit-hint">Cafe24 선택 목록에서 고릅니다. 저장 시 코드값으로 전송됩니다.</div>`
      : renderCodeSelect
      ? `<select class="factory-source-select ${missing ? 'missing' : ''}" data-factory-panel-edit="${escAttr(sendField)}" data-factory-panel-label="${escAttr(field.label)}">
          <option value="">선택 안 함</option>
          ${hasCurrentCode ? `<option value="${escAttr(selectedCodeValue)}" selected title="${escAttr(selectedCodeValue)}">${escapeHtml(factoryCafe24CurrentSelectLabel(field.value, codeOptions))}</option>` : ''}
          ${codeOptions.map(item => `<option value="${escAttr(item.value)}" ${String(item.value) === String(selectedCodeValue) ? 'selected' : ''} title="${escAttr(item.value)}">${escapeHtml(factoryCafe24SelectLabel(item))}</option>`).join('')}
        </select>
        <div class="factory-source-edit-hint">Cafe24 상품등록/수정 화면의 선택값입니다. 화면은 한글로 보이고 저장할 때는 내부 코드로 전송됩니다.</div>`
      : editable
      ? isLongEditable
        ? `<textarea class="factory-source-edit ${missing ? 'missing' : ''}" data-factory-panel-edit="${escAttr(sendField)}" data-factory-panel-label="${escAttr(field.label)}" rows="${String(field.value || '').length > 160 ? 4 : 3}" placeholder="${field.required ? '필수 입력값' : '비어 있으면 Cafe24 저장에서 제외'}">${escapeHtml(field.value || '')}</textarea>
          <div class="factory-source-edit-hint">수정하면 완성 DB와 Cafe24 저장값에 바로 반영됩니다. 비워두면 저장에서 제외됩니다.</div>`
        : `<input class="factory-source-input ${missing ? 'missing' : ''}" data-factory-panel-edit="${escAttr(sendField)}" data-factory-panel-label="${escAttr(field.label)}" value="${escAttr(field.value || '')}" placeholder="${field.required ? '필수 입력값' : '비어 있으면 Cafe24 저장에서 제외'}">
          <div class="factory-source-edit-hint">${field.referenceType ? 'Cafe24 선택 목록이 부족해 코드 직접 입력으로 표시합니다. 수정하면 저장 payload에는 코드값으로 전송됩니다.' : '수정하면 완성 DB와 Cafe24 저장값에 바로 반영됩니다.'}</div>`
      : `<div class="factory-source-field-value ${missing ? 'missing' : ''}">${field.value ? escapeHtml(field.value) : '미입력'}</div>`}
    ${cafeToSinhwaAction}
    ${compareCell}
    ${!editable && field.syncNote ? `<div class="factory-source-edit-hint">${escapeHtml(field.syncNote)}</div>` : ''}
    ${sourceType !== 'cafe24' && !editable && field.value && sendField ? `<div style="margin-top:6px"><button class="btn-sm" data-factory-panel-field="${escAttr(sendField)}" data-factory-panel-label="${escAttr(field.label)}" data-factory-panel-source-key="${escAttr(field.sourceKey || field.key || '')}" data-factory-panel-source-label="${escAttr(field.sourceLabel || '')}" data-factory-panel-value="${escAttr(field.value)}" type="button">완성 DB로</button></div>` : ''}
  </div>`;
}

function factoryRawRowPanelField(row) {
  const normalized = factoryDbNormalizeKey(row.key || row.id || 'field').slice(0, 64) || row.id || uid('cafe24_field');
  return {
    id: row.fieldId || `cafe24_${normalized}`,
    dbFieldId: row.fieldId || `cafe24_${normalized}`,
    label: factoryDisplayFieldLabel(row.key || row.id || 'Cafe24 상세 필드'),
    value: row.value || '',
    sourceKey: row.key || '',
    sourceLabel: row.sourceLabel || 'Cafe24 상품정보',
    required: false,
  };
}

const FACTORY_FIELD_KO_LABELS = {
  source: '출처',
  connector_id: '커넥터 ID',
  matched_at: '매칭 시각',
  match_query: '검색어',
  match_score: '매칭 점수',
  local_match_score: '로컬 점수',
  gpt_similarity_score: 'LLM 유사도 점수',
  gpt_decision: 'LLM 판정',
  gpt_reason: 'LLM 판정 이유',
  gpt_rank: 'LLM 순위',
  product_no: '상품번호',
  product_code: '상품코드',
  custom_product_code: '자체 상품코드',
  product_name: '상품명',
  eng_product_name: '영문 상품명',
  internal_product_name: '상품명(관리용)',
  supply_product_name: '공급사 상품명',
  model_name: '모델명',
  approve_status: '승인 상태',
  project_no: '프로젝트 번호',
  display: '진열상태',
  selling: '판매상태',
  price: '판매가',
  sale_price: '판매가',
  retail_price: '소비자가',
  supply_price: '공급가',
  tax_type: '과세 구분',
  tax_rate: '세율',
  summary_description: '상품 요약설명',
  simple_description: '상품 간략설명',
  description: '상세설명',
  mobile_description: '모바일 상세설명',
  additional_information: '추가 정보',
  product_tag: '상품 태그',
  product_material: '상품 소재',
  material: '소재',
  manufacturer: '제조사',
  manufacturer_code: '제조사 코드',
  supplier: '공급사',
  supplier_code: '공급사 코드',
  brand: '브랜드',
  brand_code: '브랜드 코드',
  display_status: '진열/판매 상태',
  image: '이미지',
  detail_image: '상세 이미지',
  list_image: '목록 이미지',
  small_image: '작은 이미지',
  tiny_image: '썸네일 이미지',
  options: '옵션',
  option: '옵션',
  product_options: '상품 옵션',
  option_name: '옵션명',
  option_value: '옵션값',
  option_values: '옵션값',
  variants: '품목',
  variant_code: '품목코드',
  quantity: '수량',
  stock: '재고',
  stock_quantity: '재고수량',
  shipping_method: '배송 방식',
  shipping_fee_type: '배송비 타입',
  shipping_fee: '배송비',
  shipping_scope: '배송 범위',
  shipping_area: '배송 지역',
  shipping_area_name: '배송지역명',
  shipping_period: '배송 기간',
  product_weight: '상품 무게',
  hscode: 'HS 코드',
  made_in_code: '원산지 코드',
  classification_code: '상품 분류 코드',
  adult_certification: '성인 인증',
  payment_info: '결제 안내',
  exchange_info: '교환/반품 안내',
  service_info: '서비스 안내',
  translated_description: '번역 상세설명',
  translated_additional_description: '번역 추가설명',
  buy_group_list: '구매 가능 회원등급',
  buy_member_id_list: '구매 가능 회원ID',
  exposure_group_list: '노출 회원등급',
  relational_product: '관련상품',
  main: '메인 진열 정보',
  raw: '시스템값',
  rawProduct: '상품 상세값',
  mall_id: '몰 ID',
};

function factoryDisplayFieldLabel(key) {
  const raw = String(key || '').trim();
  if (!raw) return '자료 필드';
  const parts = raw.split('.');
  const last = parts[parts.length - 1] || raw;
  const normalized = last.replace(/\[\d+\]/g, '');
  const ko = FACTORY_FIELD_KO_LABELS[normalized] || FACTORY_FIELD_KO_LABELS[factoryDbNormalizeKey(normalized)] || '';
  if (!ko || ko === raw) return raw;
  return `${ko}(${raw})`;
}

function renderFactoryOptionGroups(groups, sourceLabel) {
  if (!groups.length) return `<div class="factory-source-option-box"><div class="factory-source-missing">${escapeHtml(sourceLabel)} 옵션값 없음. 선택한 후보에 옵션 배열/품목값이 없으면 빈 값으로 유지됩니다.</div></div>`;
  return groups.map(group => `<div class="factory-source-option-box">
    <div class="factory-source-option-head">
      <div class="factory-source-option-title">${escapeHtml(group.label || '옵션')} · ${escapeHtml(group.sourceLabel)} · ${group.values.length}개</div>
      <button class="btn-sm" data-factory-panel-field="option_values" data-factory-panel-label="옵션 구성" data-factory-panel-value="${escAttr(group.values.join(', '))}" type="button">옵션 구성 반영</button>
    </div>
    <div class="factory-source-option-list">
      ${group.values.map(value => `<span class="factory-source-option-pill">${escapeHtml(value)}</span>`).join('')}
    </div>
  </div>`).join('');
}

function factoryCafe24VariantKey(variant = {}, index = 0) {
  return String(variant.variant_code || variant.variantCode || variant.item_code || variant.itemCode || variant.product_code || `row_${index + 1}`);
}

function factoryCafe24VariantOptionValue(variant = {}) {
  const options = factoryCafe24NormalizeVariantOptions(variant.options ?? variant.option);
  const firstOption = options[0] || null;
  if (firstOption && typeof firstOption === 'object') {
    return factoryCleanRealOptionValue(firstOption.value || firstOption.option_value || firstOption.optionValue || firstOption.option_text || firstOption.optionText || firstOption.text || firstOption.name);
  }
  return factoryCleanRealOptionValue(
    variant.option_value ||
    variant.optionValue ||
    variant.option_text ||
    variant.optionText ||
    variant.value ||
    variant.item_name ||
    variant.itemName ||
    ''
  );
}

function factoryCafe24VariantOptionPairs(variant = {}) {
  const options = factoryCafe24NormalizeVariantOptions(variant.options ?? variant.option);
  return options
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const name = String(item.name || item.option_name || item.optionName || item.label || `옵션${index + 1}`).trim();
        const value = factoryCleanRealOptionValue(item.value || item.option_value || item.optionValue || item.option_text || item.optionText || item.text);
        return value ? { name: name || `옵션${index + 1}`, value } : null;
      }
      const value = factoryCleanRealOptionValue(item);
      return value ? { name: `옵션${index + 1}`, value } : null;
    })
    .filter(Boolean);
}

function factoryCafe24VariantRows(factory = factoryRuntimeReadFactory(), optionValues = []) {
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target) || {};
  const sourceVariants = Array.isArray(raw.variants) ? raw.variants : (Array.isArray(target?.variants) ? target.variants : []);
  const edits = factoryCafe24DraftMatchesCurrentProduct(factory) ? (factory.product.cafe24VariantEdits || {}) : {};
  const sourceInventoryMap = typeof factoryCafe24SourceVariantInventoryMap === 'function'
    ? factoryCafe24SourceVariantInventoryMap(factory, target?.product_no || raw.product_no || '')
    : null;
  const rows = sourceVariants.map((variant, index) => {
    const key = factoryCafe24VariantKey(variant, index);
    const edit = edits[key] || {};
    const inventory = variant.inventory || variant.inventories?.[0] || {};
    const sourcePairs = factoryCafe24VariantOptionPairs(variant);
    const sourceValue = sourcePairs.length > 1
      ? sourcePairs.map(item => `${item.name}: ${item.value}`).join(' / ')
      : (factoryCafe24VariantOptionValue(variant) || optionValues[index] || '');
    const seed = sourceInventoryMap && typeof factoryCafe24SourceInventoryForRow === 'function'
      ? factoryCafe24SourceInventoryForRow({ option_value: sourceValue, option_pairs: sourcePairs }, sourceInventoryMap)
      : null;
    return {
      key,
      index,
      variant_code: variant.variant_code || variant.variantCode || variant.item_code || variant.itemCode || '',
      option_value: edit.option_value ?? sourceValue,
      option_pairs: sourcePairs.length ? sourcePairs : (sourceValue ? [{ name: '색상', value: sourceValue }] : []),
      display: edit.display ?? factoryCafe24FlagText(variant.display || raw.display || 'T', '진열함', '진열안함'),
      selling: edit.selling ?? factoryCafe24FlagText(variant.selling || raw.selling || 'T', '판매함', '판매안함'),
      use_inventory: edit.use_inventory ?? factoryCafe24FlagText(seed?.use_inventory || variant.use_inventory || inventory.use_inventory || 'T', '재고관리 사용', '재고관리 안 함'),
      important_inventory: edit.important_inventory ?? String(seed?.important_inventory || variant.important_inventory || inventory.important_inventory || 'A'),
      inventory_control_type: edit.inventory_control_type ?? String(seed?.inventory_control_type || variant.inventory_control_type || inventory.inventory_control_type || 'B'),
      display_soldout: edit.display_soldout ?? factoryCafe24FlagText(seed?.display_soldout || variant.display_soldout || inventory.display_soldout || 'T', '품절 표시함', '품절 표시 안 함'),
      additional_amount: edit.additional_amount ?? edit.price ?? String(variant.additional_amount ?? variant.additional_price ?? ''),
      quantity: edit.quantity ?? String(seed?.quantity ?? variant.quantity ?? variant.stock_quantity ?? inventory.quantity ?? inventory.stock_quantity ?? ''),
      safety_inventory: edit.safety_inventory ?? String(seed?.safety_inventory ?? variant.safety_inventory ?? inventory.safety_inventory ?? ''),
      custom_variant_code: edit.custom_variant_code ?? String(variant.custom_variant_code || ''),
      hasInventory: !!(variant.inventory || variant.inventories || variant.quantity !== undefined || variant.stock_quantity !== undefined),
    };
  });
  if (rows.length) return rows;
  return optionValues.map((value, index) => {
    const key = `new_${index + 1}`;
    const edit = edits[key] || {};
    const seed = sourceInventoryMap && typeof factoryCafe24SourceInventoryForRow === 'function'
      ? factoryCafe24SourceInventoryForRow({ option_value: value, option_pairs: value ? [{ name: '색상', value }] : [] }, sourceInventoryMap)
      : null;
    return {
      key,
      index,
      variant_code: '',
      option_value: edit.option_value ?? value,
      option_pairs: value ? [{ name: '색상', value }] : [],
      display: edit.display ?? '진열함(T)',
      selling: edit.selling ?? '판매함(T)',
      use_inventory: edit.use_inventory ?? factoryCafe24FlagText(seed?.use_inventory || 'T', '재고관리 사용', '재고관리 안 함'),
      important_inventory: edit.important_inventory ?? String(seed?.important_inventory || 'A'),
      inventory_control_type: edit.inventory_control_type ?? String(seed?.inventory_control_type || 'B'),
      display_soldout: edit.display_soldout ?? factoryCafe24FlagText(seed?.display_soldout || 'T', '품절 표시함', '품절 표시 안 함'),
      additional_amount: edit.additional_amount ?? edit.price ?? '',
      quantity: edit.quantity ?? String(seed?.quantity ?? ''),
      safety_inventory: edit.safety_inventory ?? String(seed?.safety_inventory ?? ''),
      custom_variant_code: edit.custom_variant_code ?? '',
      hasInventory: false,
    };
  });
}

function factoryNormalizeCafe24OptionGroup(group = {}, index = 0) {
  const name = String(group.name || group.label || group.option_name || group.optionName || `옵션${index + 1}`).trim() || `옵션${index + 1}`;
  const values = factoryDedupeRealOptionValues(
    Array.isArray(group.values)
      ? group.values
      : factorySplitOptionText(group.valueText || group.option_values || group.optionValues || group.option_value || ''),
    { allowNumeric: true }
  );
  return {
    key: group.key || `group_${index + 1}`,
    name,
    values,
    required_option: String(group.required_option || group.requiredOption || 'T').trim() || 'T',
    option_display_type: String(group.option_display_type || group.optionDisplayType || 'S').trim() || 'S',
  };
}

function factoryCafe24OptionGroupsFromSource(sourceModel = {}) {
  const groups = (sourceModel.optionGroups || [])
    .map((group, index) => factoryNormalizeCafe24OptionGroup({
      key: group.key || `source_${index + 1}`,
      name: group.label,
      values: group.values,
      required_option: group.required_option,
      option_display_type: group.option_display_type,
    }, index))
    .filter(group => group.name && group.values.length);
  return groups;
}

function factoryCafe24OptionGroupsDraft(factory = factoryRuntimeReadFactory()) {
  if (!factoryCafe24DraftMatchesCurrentProduct(factory)) return [];
  const draft = Array.isArray(factory.product.cafe24OptionGroupsDraft) ? factory.product.cafe24OptionGroupsDraft : [];
  return draft
    .map((group, index) => factoryNormalizeCafe24OptionGroup(group, index))
    .filter(group => group.name || group.values.length);
}

function factoryCafe24OptionGroupsForEditor(factory = factoryRuntimeReadFactory(), sourceModel = {}) {
  const draftGroups = factoryCafe24OptionGroupsDraft(factory);
  if (draftGroups.length) return draftGroups;
  const sourceGroups = factoryCafe24OptionGroupsFromSource(sourceModel);
  if (sourceGroups.length) return sourceGroups;
  return [];
}

function factoryCafe24OptionEditorModel(factory = factoryRuntimeReadFactory(), model = null) {
  const sourceModel = model || factoryBuildSourcePanelModel(factory, 'cafe24', FACTORY_CAFE24_FIELD_SECTIONS);
  const optionGroups = sourceModel.optionGroups || [];
  const firstGroup = optionGroups[0] || null;
  const allowManualOptionDraft = factoryCafe24DraftMatchesCurrentProduct(factory);
  const optionNameSetting = allowManualOptionDraft ? factory.product.dbFieldSettings?.option_name : null;
  const optionValuesSetting = allowManualOptionDraft ? factory.product.dbFieldSettings?.option_values : null;
  const manualNameTouched = !!(optionNameSetting && (optionNameSetting.manualTouched || String(optionNameSetting.manualValue || '').trim()));
  const manualValuesTouched = !!(optionValuesSetting && (optionValuesSetting.manualTouched || String(optionValuesSetting.manualValue || '').trim()));
  const sourceValues = factoryDedupeRealOptionValues(sourceModel.optionValues || firstGroup?.values || [], { allowNumeric: true });
  const optionName = String(
    (manualNameTouched ? optionNameSetting.manualValue : '') ||
    firstGroup?.label ||
    (manualValuesTouched || sourceValues.length ? '색상' : '')
  ).trim();
  const optionValues = manualValuesTouched
    ? factoryDedupeRealOptionValues(factorySplitOptionText(optionValuesSetting.manualValue), { allowNumeric: true })
    : sourceValues;
  let editGroups = factoryCafe24OptionGroupsForEditor(factory, sourceModel);
  if (!editGroups.length && (optionValues.length || manualNameTouched || manualValuesTouched)) {
    editGroups = [{ key: 'group_1', name: optionName || '색상', values: optionValues, required_option: 'T', option_display_type: 'S' }];
  }
  const hasStructuredGroups = editGroups.length > 1;
  if (editGroups.length && manualNameTouched && !hasStructuredGroups) {
    editGroups[0] = { ...editGroups[0], name: optionName || editGroups[0].name };
  }
  if (editGroups.length && manualValuesTouched && !hasStructuredGroups) {
    editGroups[0] = { ...editGroups[0], values: optionValues };
  }
  const variants = factoryCafe24VariantRows(factory, optionValues);
  return { optionName: editGroups[0]?.name || optionName, optionValues: editGroups[0]?.values || optionValues, editGroups, optionGroups, variants };
}

function factoryOptionGroupSummary(groups = []) {
  return (groups || []).map(group => ({
    name: String(group.name || group.label || '옵션').trim(),
    sourceLabel: String(group.sourceLabel || '').trim(),
    values: factoryDedupeRealOptionValues(group.values || [], { allowNumeric: true }),
  })).filter(group => group.values.length || group.name);
}

function factorySinhwaOptionCompareModel(factory = factoryRuntimeReadFactory()) {
  const groups = factoryExtractOptionGroups(factory, { types: ['sinhwa'], includeManual: false });
  const rows = factoryDbSourceRows(factory, { types: ['sinhwa'], includeManual: false });
  const confirmed = factory.product.confirmedDb || {};
  const candidate = (factory.product.dbCandidates || []).find(item => factorySinhwaCandidateKey(item) === factory.product.selectedDbCandidateKey) || confirmed || {};
  const name = String(candidate?.product_name || candidate?.jname || candidate?.jname2 || candidate?.name || candidate?.jcode || '').trim() ||
    factorySourceRowsValueByAliases(rows, ['product_name', '상품명', 'jname', 'name']) ||
    '';
  const fallbackValues = factoryDedupeOptionValues([
    ...factorySplitOptionText(factorySourceRowsValueByAliases(rows, ['option_values', '옵션값', '옵션구성', '색상', 'color', 'colors'])),
    ...factorySplitOptionText(String(confirmed.option_values || confirmed.color || confirmed.colors || '')),
  ]);
  const normalizedGroups = factoryOptionGroupSummary(groups);
  if (!normalizedGroups.length && fallbackValues.length) {
    normalizedGroups.push({ name: factorySourceRowsValueByAliases(rows, ['option_name', '옵션명']) || '옵션', sourceLabel: '신화사DB', values: fallbackValues });
  }
  return { name, groups: normalizedGroups, rows };
}

function factoryCafe24OptionCompareModel(factory = factoryRuntimeReadFactory(), optionModel = null) {
  const model = optionModel || factoryCafe24OptionEditorModel(factory);
  const raw = factoryCafe24RawForForm(factory);
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply }) || {};
  const name = String(target?.product_name || raw.product_name || target?.product_code || raw.product_code || factory.product.finalDb?.product_name || '').trim();
  return {
    name,
    productNo: raw.product_no || target.product_no || '',
    groups: factoryOptionGroupSummary(model.editGroups || model.optionGroups || []),
  };
}

function factoryOptionContextComparePayload(factory = factoryRuntimeReadFactory(), optionModel = null) {
  const cafe24 = factoryCafe24OptionCompareModel(factory, optionModel);
  const sinhwa = factorySinhwaOptionCompareModel(factory);
  return {
    product_input_name: factory.product.productName || state.productName || '',
    cafe24,
    sinhwa,
  };
}

function factoryOptionContextSignature(payload = {}) {
  const compactGroups = source => (source?.groups || [])
    .map(group => `${group.name}:${(group.values || []).join('|')}`)
    .join(' / ');
  return factoryDbNormalizeKey([
    payload.product_input_name,
    payload.cafe24?.name,
    compactGroups(payload.cafe24),
    payload.sinhwa?.name,
    compactGroups(payload.sinhwa),
  ].join('||'));
}

function factoryNormalizeOptionContextMatch(result = {}, payload = {}) {
  const rawDecision = String(result.decision || result.status || '').toLowerCase();
  const score = Math.max(0, Math.min(100, Number(result.score) || 0));
  const decision = /mismatch|different|red|불일치|다름/.test(rawDecision)
    ? 'mismatch'
    : (/match|same|green|일치|같은/.test(rawDecision) ? 'match' : 'uncertain');
  const label = decision === 'match' ? '같은 맥락' : (decision === 'mismatch' ? '불일치' : '검수 필요');
  return {
    decision,
    score,
    label: String(result.label || label).trim() || label,
    reason: String(result.reason || result.summary || '').trim(),
    nameRelation: String(result.name_relation || result.nameRelation || '').trim(),
    optionRelation: String(result.option_relation || result.optionRelation || '').trim(),
    checkedAt: Date.now(),
    signature: factoryOptionContextSignature(payload),
    model: getGptOAuthModelLabel(),
  };
}

function factoryOptionContextTone(match = null) {
  const decision = String(match?.decision || '').toLowerCase();
  if (decision === 'match') return 'match';
  if (decision === 'mismatch') return 'mismatch';
  return 'uncertain';
}

function renderFactoryOptionCompareColumn(title, source = {}, emptyText = '옵션 자료 없음') {
  const groups = source.groups || [];
  const valuesCount = groups.reduce((sum, group) => sum + (group.values?.length || 0), 0);
  return `<div class="factory-option-compare-card">
    <h6>${escapeHtml(title)}</h6>
    <div class="factory-option-compare-name">${escapeHtml(source.name || '상품명 미확정')}</div>
    <div class="factory-option-compare-meta">
      ${source.productNo ? `상품번호 #${escapeHtml(source.productNo)} · ` : ''}옵션그룹 ${groups.length}개 · 옵션값 ${valuesCount}개
    </div>
    ${groups.length ? groups.map(group => `<div class="factory-source-option-box" style="margin-top:0">
      <div class="factory-source-option-title">${escapeHtml(group.name || '옵션')} ${group.sourceLabel ? `· ${escapeHtml(group.sourceLabel)}` : ''}</div>
      <div class="factory-source-option-list" style="margin-top:6px">
        ${(group.values || []).slice(0, 40).map(value => `<span class="factory-source-option-pill">${escapeHtml(value)}</span>`).join('')}
        ${(group.values || []).length > 40 ? `<span class="factory-source-option-pill">외 ${(group.values || []).length - 40}개</span>` : ''}
      </div>
    </div>`).join('') : `<div class="factory-source-missing">${escapeHtml(emptyText)}</div>`}
  </div>`;
}

function renderFactoryOptionContextComparePanel(factory = factoryRuntimeReadFactory(), optionModel = null) {
  const payload = factoryOptionContextComparePayload(factory, optionModel);
  const match = factory.product.cafe24OptionContextMatch || null;
  const signature = factoryOptionContextSignature(payload);
  const stale = !!(match?.signature && match.signature !== signature);
  const tone = factoryOptionContextTone(match);
  const canCompare = !!((payload.cafe24.name || payload.cafe24.groups.length) && (payload.sinhwa.name || payload.sinhwa.groups.length));
  const busy = !!factory.product.cafe24OptionContextMatchBusy;
  const result = match ? `<div class="factory-option-compare-result ${stale ? 'uncertain' : tone}">
    <b>${escapeHtml(stale ? '다시 비교 필요' : (match.label || '검수 필요'))}</b>${Number.isFinite(Number(match.score)) ? ` · ${Math.round(Number(match.score))}점` : ''}${match.checkedAt ? ` · ${escapeHtml(new Date(match.checkedAt).toLocaleString())}` : ''}
    ${match.reason ? `<br>${escapeHtml(match.reason)}` : ''}
    ${match.nameRelation ? `<br>상품명: ${escapeHtml(match.nameRelation)}` : ''}
    ${match.optionRelation ? `<br>옵션: ${escapeHtml(match.optionRelation)}` : ''}
    ${match.model ? `<br><span style="color:var(--text-m)">GPT OAuth · ${escapeHtml(match.model)}</span>` : ''}
  </div>` : `<div class="factory-option-compare-result uncertain">아직 AI 매칭 전입니다. Cafe24와 신화사DB가 같은 제품 맥락인지 확인하려면 GPT OAuth AI 매칭을 눌러주세요.</div>`;
  return `<div class="factory-option-compare">
    <div class="factory-option-compare-head">
      <div>
        <div class="factory-option-compare-title">Cafe24 ↔ 신화사DB 옵션 비교</div>
        <div class="factory-option-compare-sub">상품명이 완전히 같지 않아도 핵심 제품명이 같으면 같은 맥락으로 판정합니다. 판정 결과는 검수 표시이며 Cafe24 저장값을 자동 변경하지 않습니다.</div>
      </div>
      <button class="btn-sm" id="factoryRunOptionContextMatch" type="button" ${disabledAttr(!canCompare || busy, busy ? 'GPT OAuth가 옵션 맥락을 비교 중입니다.' : 'Cafe24와 신화사DB 옵션 자료가 모두 필요합니다.')}>
        <span class="material-icons-outlined" style="font-size:14px">${busy ? 'hourglass_top' : 'psychology'}</span>${busy ? '비교 중' : 'GPT OAuth AI 매칭'}
      </button>
    </div>
    <div class="factory-option-compare-grid">
      ${renderFactoryOptionCompareColumn('Cafe24 옵션', payload.cafe24, '선택한 Cafe24 상품의 공식 옵션값이 없습니다.')}
      ${renderFactoryOptionCompareColumn('신화사DB 옵션', payload.sinhwa, '확정한 신화사DB 상품의 옵션값이 없습니다.')}
    </div>
    ${result}
  </div>`;
}

function renderFactoryCafe24VariantSelect(row, field, options = []) {
  const raw = String(row?.[field] ?? '').trim();
  const current = factoryCafe24SelectOptionValue(raw, options) || factoryTruthyCafe24Flag(raw) || raw.toUpperCase();
  const known = options.some(item => item.value === current);
  return `<select data-factory-cafe24-variant-field="${escAttr(row.key)}:${escAttr(field)}" title="화면은 한글로 보이고 저장할 때는 Cafe24 코드로 전송됩니다.">
    ${current && !known ? `<option value="${escAttr(current)}" selected title="${escAttr(current)}">현재 설정</option>` : ''}
    ${options.map(item => `<option value="${escAttr(item.value)}" ${item.value === current ? 'selected' : ''} title="${escAttr(item.value)}">${escapeHtml(factoryCafe24SelectLabel(item))}</option>`).join('')}
  </select>`;
}

function renderFactoryCafe24OptionFlagSelect(id, current, options = CAFE24_FORM_SELECTS.productFlag) {
  const value = factoryCafe24OptionFlag(current, 'F');
  return `<select class="factory-cafe24-option-input" id="${escAttr(id)}">
    ${options.map(item => `<option value="${escAttr(item.value)}" ${item.value === value ? 'selected' : ''}>${escapeHtml(factoryCafe24SelectLabel(item))}</option>`).join('')}
  </select>`;
}

function renderFactoryCafe24AdditionalOptionLengthSelect(index, current) {
  const value = factoryCafe24AdditionalOptionTextLength(current);
  return `<select class="factory-cafe24-option-input" data-factory-cafe24-additional-option-length="${index}">
    ${FACTORY_CAFE24_ADDITIONAL_OPTION_LENGTHS.map(item => `<option value="${escAttr(item)}" ${item === value ? 'selected' : ''}>${escapeHtml(item)}자</option>`).join('')}
  </select>`;
}

function renderFactoryCafe24OptionExtrasPanel(factory, raw = null) {
  const model = factoryCafe24OptionExtrasModel(factory, raw || factoryCafe24RawForForm(factory));
  const additionalRows = model.additionalOptions.length
    ? model.additionalOptions
    : [];
  const attachedRows = model.attachedFileOptions || [];
  return `<div class="factory-cafe24-option-groups">
    <div class="factory-cafe24-option-group-card">
      <div class="factory-cafe24-option-group-head">
        <div>
          <div class="factory-cafe24-option-group-title">추가 입력 옵션</div>
          <div class="factory-source-sub">고객이 주문할 때 직접 입력하는 문구칸입니다. Cafe24 공식 옵션 API의 추가입력 옵션만 사용합니다.</div>
        </div>
        <button class="btn-sm" id="factoryCafe24AdditionalOptionAdd" type="button"><span class="material-icons-outlined" style="font-size:14px">add</span>입력칸 추가</button>
      </div>
      <div class="factory-cafe24-option-grid">
        <label>추가 입력 옵션 사용여부
          ${renderFactoryCafe24OptionFlagSelect('factoryCafe24UseAdditionalOption', model.useAdditionalOption)}
        </label>
        <div class="factory-cafe24-sync-preview">
          ${model.useAdditionalOption === 'T' ? `사용함 · 입력칸 ${additionalRows.length}개` : '사용안함'}
        </div>
      </div>
      <div class="factory-cafe24-variant-table" style="margin-top:8px">
        <div class="factory-cafe24-variant-row header" style="grid-template-columns:minmax(180px,1fr) minmax(120px,.4fr) minmax(120px,.4fr) minmax(80px,.25fr);min-width:560px">
          <span>입력칸 이름</span><span>길이 제한</span><span>필수 여부</span><span>관리</span>
        </div>
        ${additionalRows.length ? additionalRows.map((row, index) => `<div class="factory-cafe24-variant-row" style="grid-template-columns:minmax(180px,1fr) minmax(120px,.4fr) minmax(120px,.4fr) minmax(80px,.25fr);min-width:560px">
          <input data-factory-cafe24-additional-option-name="${index}" value="${escAttr(row.name)}" placeholder="예: 각인 문구">
          ${renderFactoryCafe24AdditionalOptionLengthSelect(index, row.textLength)}
          <select data-factory-cafe24-additional-option-required="${index}">
            <option value="T" ${row.required === 'T' ? 'selected' : ''}>필수</option>
            <option value="F" ${row.required === 'F' ? 'selected' : ''}>선택</option>
          </select>
          <button class="btn-sm" data-factory-cafe24-additional-option-remove="${index}" type="button">삭제</button>
        </div>`).join('') : `<div class="factory-source-missing">추가 입력 옵션 칸이 없습니다. 필요하면 “입력칸 추가”를 눌러 이름/길이/필수 여부를 지정하세요.</div>`}
      </div>
    </div>
    <div class="factory-cafe24-option-group-card">
      <div class="factory-cafe24-option-group-head">
        <div>
          <div class="factory-cafe24-option-group-title">파일 첨부 옵션</div>
          <div class="factory-source-sub">Cafe24 공식 옵션 API의 파일 첨부 사용여부를 관리합니다. 선택한 상품의 세부 구조가 있으면 보존해서 전송합니다.</div>
        </div>
        <span class="factory-db-source">${attachedRows.length ? `현재 ${attachedRows.length}개` : '현재값 없음'}</span>
      </div>
      <div class="factory-cafe24-option-grid">
        <label>파일 첨부 옵션 사용여부
          ${renderFactoryCafe24OptionFlagSelect('factoryCafe24UseAttachedFileOption', model.useAttachedFileOption)}
        </label>
        <div class="factory-cafe24-sync-preview">
          ${model.useAttachedFileOption === 'T' ? '사용함' : '사용안함'}
          ${attachedRows.length ? ` · 현재 첨부 옵션 ${attachedRows.length}개 보존` : ' · 세부값 없음'}
        </div>
      </div>
    </div>
  </div>`;
}

const FACTORY_CAFE24_IMAGE_SLOTS = [
  { key: 'detail_image', label: '상세 이미지', hint: '상품 상세페이지 대표 이미지' },
  { key: 'list_image', label: '목록 이미지', hint: '분류/검색/메인 목록 이미지' },
  { key: 'tiny_image', label: '썸네일 이미지', hint: '최근 본 상품 등 작은 목록 이미지' },
  { key: 'small_image', label: '작은 이미지', hint: '상세 하단 축소 이미지' },
];

function factoryCafe24ImageDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24ImageDraft = factory.product.cafe24ImageDraft && typeof factory.product.cafe24ImageDraft === 'object'
    ? factory.product.cafe24ImageDraft
    : {};
  if (!factory.product.cafe24ImageDraft.image_upload_type) factory.product.cafe24ImageDraft.image_upload_type = 'A';
  return factory.product.cafe24ImageDraft;
}

function factoryCafe24ImageSlotValue(slotKey, factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24ImageDraft(factory);
  const item = draft[slotKey] && typeof draft[slotKey] === 'object' ? draft[slotKey] : null;
  if (item?.preview) return item.preview;
  const raw = factoryCafe24RawForForm(factory);
  const value = raw?.[slotKey] || factory.product.finalDb?.[slotKey] || '';
  return factoryCafe24ImageDisplayUrl(value, factory);
}

function factoryCafe24ImageDisplayUrl(value, factory = factoryRuntimeReadFactory()) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw) || /^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^\//.test(raw)) {
    const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
    const candidateRaw = parseCafe24Raw(target) || {};
    const mallId = target?.mall_id || candidateRaw.mall_id || CAFE24_CONTROL_API.defaultMallId;
    return `https://${mallId}.cafe24.com${raw}`;
  }
  return raw;
}

function factoryCafe24ImageSlotMeta(slotKey, factory = factoryRuntimeReadFactory()) {
  const item = factoryCafe24ImageDraft(factory)[slotKey];
  if (item && typeof item === 'object') {
    return [
      item.fileName || '로컬 이미지',
      item.size ? `${Math.round(Number(item.size) / 1024)}KB` : '',
      item.mime || '',
    ].filter(Boolean).join(' · ');
  }
  const value = factoryCafe24ImageSlotValue(slotKey, factory);
  return value ? '현재 Cafe24 URL/경로' : '미입력';
}

function factoryCafe24InlineImageParts(value) {
  const raw = String(value || '').trim();
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(raw);
  if (!match) return null;
  return {
    mime: match[1] || 'image/png',
    base64: match[2] || '',
    preview: raw,
  };
}

function factoryCafe24InlineImageFromCandidate(candidate) {
  if (!candidate) return null;
  if (typeof candidate === 'string') return factoryCafe24InlineImageParts(candidate);
  if (typeof candidate !== 'object') return null;
  if (candidate.base64) {
    const mime = candidate.mime || candidate.type || 'image/png';
    return factoryCafe24InlineImageParts(`data:${mime};base64,${candidate.base64}`);
  }
  const keys = ['image', 'dataUrl', 'preview', 'result', 'src', 'url', 'imagePreview', 'imageBase64'];
  for (const key of keys) {
    const value = candidate[key];
    const parts = key === 'imageBase64' && value
      ? factoryCafe24InlineImageParts(`data:${candidate.mime || 'image/png'};base64,${value}`)
      : factoryCafe24InlineImageParts(value);
    if (parts?.base64) return parts;
  }
  return null;
}

function factoryCafe24GeneratedMainImage(factory = factoryRuntimeReadFactory()) {
  const assets = typeof factoryUsableAssetsForStage === 'function'
    ? factoryUsableAssetsForStage('hero', factory)
    : (Array.isArray(factory.assets) ? factory.assets : []).filter(asset => (
      asset?.stageId === 'hero' &&
      (typeof factoryAssetMatchesCurrentJob !== 'function' || factoryAssetMatchesCurrentJob(asset, 'hero', factory)?.ok)
    ));
  const appState = typeof state !== 'undefined' ? state : {};
  const scoredAssets = assets
    .filter(asset => (
      asset &&
      !asset.rejected &&
      asset.stageId === 'hero' &&
      (typeof factoryAssetMatchesCurrentJob !== 'function' || factoryAssetMatchesCurrentJob(asset, 'hero', factory)?.ok) &&
      factoryCafe24InlineImageFromCandidate(asset)?.base64
    ))
    .map(asset => {
      let score = 0;
      if (asset.used) score += 30;
      if (Array.isArray(factory.stages?.hero?.selectedAssetIds) && factory.stages.hero.selectedAssetIds.includes(asset.id)) score += 25;
      if (asset.stageId === 'hero') score += 20;
      if (/대표|hero|main/i.test(`${asset.title || ''} ${asset.metadata?.source || ''}`)) score += 10;
      return { asset, score };
    })
    .sort((a, b) => b.score - a.score || Number(b.asset.createdAt || 0) - Number(a.asset.createdAt || 0));
  for (const item of scoredAssets) {
    const parts = factoryCafe24InlineImageFromCandidate(item.asset);
    if (parts?.base64) return { ...parts, source: item.asset.title || '조립공장 대표이미지' };
  }

  const sectionHeader = factoryCafe24InlineImageFromCandidate(appState.sectionImages?.header);
  if (sectionHeader?.base64) return { ...sectionHeader, source: '상세페이지 헤더 이미지' };

  const product = factory.product || {};
  const productCandidates = [
    product.imagePreview,
    product.imageBase64 ? `data:${product.imageMime || 'image/png'};base64,${product.imageBase64}` : '',
    ...(Array.isArray(product.inputImages) ? product.inputImages : []),
    appState.imagePreview,
    appState.imageBase64 ? `data:image/png;base64,${appState.imageBase64}` : '',
    ...(Array.isArray(appState.analysisImages) ? appState.analysisImages : []),
  ];
  for (const candidate of productCandidates) {
    const parts = factoryCafe24InlineImageFromCandidate(candidate);
    if (parts?.base64) return { ...parts, source: '제품/분석 대표 이미지' };
  }
  return null;
}

function factoryCafe24ImagePayload(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24ImageDraft(factory);
  const image = {
    image_upload_type: String(draft.image_upload_type || 'A').trim().toUpperCase() === 'B' ? 'B' : 'A',
  };
  let manualCount = 0;
  FACTORY_CAFE24_IMAGE_SLOTS.forEach(slot => {
    const item = draft[slot.key];
    if (item?.base64) {
      image[slot.key] = item.base64;
      manualCount += 1;
    }
  });
  if (!manualCount) {
    const fallback = factoryCafe24GeneratedMainImage(factory);
    if (fallback?.base64) {
      FACTORY_CAFE24_IMAGE_SLOTS.forEach(slot => {
        image[slot.key] = fallback.base64;
      });
    }
  }
  return image;
}

function factoryCafe24ImagePayloadSummary(payload = {}) {
  const slots = FACTORY_CAFE24_IMAGE_SLOTS
    .filter(slot => payload[slot.key])
    .map(slot => slot.label)
    .join(', ');
  return `${slots || '업로드 이미지 없음'} · 등록 방식 ${payload.image_upload_type === 'B' ? '개별 이미지(B)' : '대표 이미지(A)'}`;
}

function factoryCafe24AdditionalImageDrafts(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24ImageDraft(factory);
  draft.additional_images = Array.isArray(draft.additional_images)
    ? draft.additional_images.filter(item => item && typeof item === 'object')
    : [];
  return draft.additional_images;
}

function factoryCafe24ExistingAdditionalImages(factory = factoryRuntimeReadFactory()) {
  const raw = factoryCafe24RawForForm(factory);
  const values = Array.isArray(raw?.additional_image)
    ? raw.additional_image
    : (Array.isArray(raw?.additional_images) ? raw.additional_images : (raw?.additional_image ? [raw.additional_image] : []));
  return values
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.url || item.path || item.image || item.src || item.additional_image || '';
      return '';
    })
    .map(value => factoryCafe24ImageDisplayUrl(value, factory))
    .filter(Boolean)
    .slice(0, 20);
}

function factoryCafe24AdditionalImagesPayload(factory = factoryRuntimeReadFactory()) {
  return factoryCafe24AdditionalImageDrafts(factory)
    .map(item => String(item.base64 || '').trim())
    .filter(Boolean)
    .slice(0, 20);
}

function factoryCafe24AdditionalImageSummary(factory = factoryRuntimeReadFactory()) {
  const existing = factoryCafe24ExistingAdditionalImages(factory).length;
  const draft = factoryCafe24AdditionalImagesPayload(factory).length;
  return `기존 ${existing}장 · 업로드 준비 ${draft}장 · 최대 20장`;
}

function renderFactoryCafe24AdditionalImagePanel(factory = factoryRuntimeReadFactory(), productNo = '') {
  const existingImages = factoryCafe24ExistingAdditionalImages(factory);
  const draftImages = factoryCafe24AdditionalImageDrafts(factory);
  const payload = factoryCafe24AdditionalImagesPayload(factory);
  const endpointBlockedReason = factoryCafe24EndpointDisabledReason(factory, 'additionalImages', '추가 이미지 API', productNo);
  const disabledReason = endpointBlockedReason || (!productNo
    ? '먼저 Cafe24 상품 후보를 확정해야 합니다.'
    : (!payload.length ? '업로드할 추가 이미지 파일을 먼저 선택해주세요.' : ''));
  return `<div class="factory-cafe24-additional-strip">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 추가 이미지</div>
        <div class="factory-source-sub">상품 상세 하단의 추가 이미지 영역입니다. Cafe24 공식 최대 20장 규칙에 맞춰 별도 additionalimages API로 동기화합니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryAddCafe24AdditionalImages" type="button"><span class="material-icons-outlined" style="font-size:14px">add_photo_alternate</span>로컬 추가</button>
        <button class="btn-sm" id="factoryAddProductToCafe24Additional" type="button"><span class="material-icons-outlined" style="font-size:14px">content_copy</span>제품사진 추가</button>
        <button class="btn-sm" id="factoryClearCafe24AdditionalImages" type="button"><span class="material-icons-outlined" style="font-size:14px">backspace</span>준비 이미지 비우기</button>
        <button class="btn-sm" id="factoryCreateCafe24AdditionalImages" type="button" ${disabledAttr(!!disabledReason, disabledReason)}><span class="material-icons-outlined" style="font-size:14px">add_link</span>추가 이미지 등록</button>
        <button class="btn-sm" id="factoryUpdateCafe24AdditionalImages" type="button" ${disabledAttr(!!disabledReason, disabledReason)}><span class="material-icons-outlined" style="font-size:14px">published_with_changes</span>추가 이미지 교체</button>
      </div>
      <input type="file" accept="image/*" multiple id="factoryCafe24AdditionalFile" style="display:none">
    </div>
    <div class="factory-cafe24-sync-preview">${escapeHtml(factoryCafe24AdditionalImageSummary(factory))}</div>
    ${endpointBlockedReason ? `<div class="factory-source-missing">${escapeHtml(endpointBlockedReason)} 상태 점검에서 실패한 경로는 전체 동기화에서도 자동 제외됩니다.</div>` : ''}
    ${existingImages.length ? `<div>
      <div class="factory-source-sub" style="margin-bottom:6px">현재 Cafe24 추가 이미지</div>
      <div class="factory-cafe24-additional-grid">
        ${existingImages.map((src, index) => `<div class="factory-cafe24-additional-card">
          <div class="factory-cafe24-additional-thumb"><img src="${escAttr(src)}" alt="기존 추가 이미지 ${index + 1}"></div>
          <div class="factory-cafe24-additional-name">기존 ${index + 1}</div>
        </div>`).join('')}
      </div>
    </div>` : `<div class="factory-source-missing">현재 Cafe24 추가 이미지가 비어 있습니다.</div>`}
    <div>
      <div class="factory-source-sub" style="margin-bottom:6px">업로드 준비 이미지</div>
      ${draftImages.length ? `<div class="factory-cafe24-additional-grid">
        ${draftImages.map((item, index) => `<div class="factory-cafe24-additional-card">
          <div class="factory-cafe24-additional-thumb"><img src="${escAttr(item.preview || `data:${item.mime || 'image/png'};base64,${item.base64 || ''}`)}" alt="업로드 준비 ${index + 1}"></div>
          <div class="factory-cafe24-additional-name" title="${escAttr(item.fileName || '')}">${escapeHtml(item.fileName || `추가 이미지 ${index + 1}`)}</div>
          <button class="btn-sm" data-factory-cafe24-additional-image-remove="${index}" type="button">제거</button>
        </div>`).join('')}
      </div>` : `<div class="factory-cafe24-image-empty">아직 업로드 준비 이미지가 없습니다. 로컬 파일을 여러 장 선택하거나 제품사진을 추가하세요.</div>`}
    </div>
  </div>`;
}

function factoryCafe24IconDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24IconDraft = factory.product.cafe24IconDraft && typeof factory.product.cafe24IconDraft === 'object'
    ? factory.product.cafe24IconDraft
    : {};
  const draft = factory.product.cafe24IconDraft;
  if (!Array.isArray(draft.iconCatalog)) draft.iconCatalog = [];
  if (!Array.isArray(draft.selectedCodes)) draft.selectedCodes = [];
  if (!draft.use_show_date) draft.use_show_date = '';
  if (!draft.show_start_date) draft.show_start_date = '';
  if (!draft.show_end_date) draft.show_end_date = '';
  return draft;
}

function factoryCafe24ProductIconsRaw(factory = factoryRuntimeReadFactory()) {
  const raw = factoryCafe24RawForForm(factory);
  const icons = raw?.product_icons || raw?.icons || null;
  return icons && typeof icons === 'object' && !Array.isArray(icons) ? icons : null;
}

function factoryCafe24CurrentIconCodes(factory = factoryRuntimeReadFactory()) {
  const rawIcons = factoryCafe24ProductIconsRaw(factory);
  const imageList = Array.isArray(rawIcons?.image_list) ? rawIcons.image_list : [];
  return imageList.map(item => String(item.code || '').trim()).filter(Boolean);
}

function factoryCafe24SelectedIconCodes(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24IconDraft(factory);
  if (draft.touched) return draft.selectedCodes.filter(Boolean);
  return factoryCafe24CurrentIconCodes(factory);
}

function factoryCafe24IconPeriod(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24IconDraft(factory);
  const rawIcons = factoryCafe24ProductIconsRaw(factory) || {};
  const use = draft.touched ? draft.use_show_date : (rawIcons.use_show_date || 'F');
  const start = draft.touched ? draft.show_start_date : rawIcons.show_start_date;
  const end = draft.touched ? draft.show_end_date : rawIcons.show_end_date;
  return {
    use_show_date: /^T$/i.test(String(use || '')) ? 'T' : 'F',
    show_start_date: String(start || '').slice(0, 16),
    show_end_date: String(end || '').slice(0, 16),
  };
}

function factoryCafe24IconPayload(factory = factoryRuntimeReadFactory()) {
  const period = factoryCafe24IconPeriod(factory);
  const selectedCodes = factoryCafe24SelectedIconCodes(factory).slice(0, 5);
  return {
    use_show_date: period.use_show_date,
    show_start_date: period.show_start_date || null,
    show_end_date: period.show_end_date || null,
    image_list: selectedCodes.map(code => ({ code })),
  };
}

function renderFactoryCafe24IconPanel(factory = factoryRuntimeReadFactory(), productNo = '') {
  const draft = factoryCafe24IconDraft(factory);
  const catalog = draft.iconCatalog || [];
  const selected = new Set(factoryCafe24SelectedIconCodes(factory));
  const currentCodes = factoryCafe24CurrentIconCodes(factory);
  const period = factoryCafe24IconPeriod(factory);
  const payload = factoryCafe24IconPayload(factory);
  const canSync = !!productNo && factoryCafe24IconTouched(factory) && payload.image_list.length > 0;
  return `<div class="factory-cafe24-additional-strip">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 상품 아이콘</div>
        <div class="factory-source-sub">상품명 옆에 붙는 아이콘입니다. 전체 아이콘 목록을 불러온 뒤 최대 5개까지 선택해 상품 아이콘 API로 동기화합니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryRefreshCafe24Icons" type="button"><span class="material-icons-outlined" style="font-size:14px">sync</span>아이콘 목록 불러오기</button>
        <button class="btn-sm" id="factorySyncCafe24Icons" type="button" ${disabledAttr(!canSync, !productNo ? '먼저 Cafe24 상품 후보를 확정해야 합니다.' : '아이콘을 직접 선택/수정한 뒤 동기화할 수 있습니다.')}>
          <span class="material-icons-outlined" style="font-size:14px">workspace_premium</span>아이콘 동기화
        </button>
      </div>
    </div>
    <div class="factory-cafe24-option-grid">
      <label>표시기간 사용
        <select class="factory-cafe24-option-input" id="factoryCafe24IconUseShowDate">
          <option value="F" ${period.use_show_date !== 'T' ? 'selected' : ''}>사용 안 함</option>
          <option value="T" ${period.use_show_date === 'T' ? 'selected' : ''}>사용함</option>
        </select>
      </label>
      <div class="factory-cafe24-option-grid" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:0">
        <label>시작일시<input class="factory-cafe24-option-input" type="datetime-local" id="factoryCafe24IconStart" value="${escAttr(period.show_start_date)}"></label>
        <label>종료일시<input class="factory-cafe24-option-input" type="datetime-local" id="factoryCafe24IconEnd" value="${escAttr(period.show_end_date)}"></label>
      </div>
    </div>
    <div class="factory-cafe24-sync-preview">
      현재 상품 아이콘 ${currentCodes.length}개 · 선택 ${payload.image_list.length}개 · ${factoryCafe24IconTouched(factory) ? '수정됨' : '현재값 표시 중'} · ${draft.iconFetchedAt ? `마지막 목록 ${escapeHtml(new Date(draft.iconFetchedAt).toLocaleString())}` : '아이콘 목록 미불러옴'}
    </div>
    ${catalog.length ? `<div class="factory-cafe24-icon-grid">
      ${catalog.map(icon => {
        const checked = selected.has(icon.code);
        return `<label class="factory-cafe24-icon-card ${checked ? 'selected' : ''}" title="${escAttr(icon.code)}">
          <input type="checkbox" data-factory-cafe24-icon-code="${escAttr(icon.code)}" ${checked ? 'checked' : ''}>
          <div class="factory-cafe24-icon-thumb">${icon.path ? `<img src="${escAttr(icon.path)}" alt="${escAttr(icon.code)}">` : `<span class="factory-cafe24-image-empty">${escapeHtml(icon.code)}</span>`}</div>
          <div class="factory-cafe24-icon-code">${escapeHtml(icon.code)}</div>
        </label>`;
      }).join('')}
    </div>` : `<div class="factory-cafe24-image-empty">아이콘 목록을 아직 불러오지 않았습니다. Cafe24 API에서 아이콘 목록을 가져와야 체크 선택이 가능합니다.</div>`}
  </div>`;
}

function factoryCafe24TargetInfo(factory = factoryRuntimeReadFactory()) {
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target) || {};
  const finalDb = factory.product.finalDb || {};
  const productNo = target?.product_no || raw.product_no || finalDb.product_no || finalDb.cafe24_product_no || '';
  const mallId = target?.mall_id || raw.mall_id || finalDb.mall_id || CAFE24_CONTROL_API.defaultMallId;
  return { target, raw, productNo: String(productNo || '').trim(), mallId };
}

function factoryCafe24RelationRowsFromValue(value) {
  if (!value) return [];
  let source = value;
  if (typeof source === 'string') {
    const raw = source.trim();
    if (!raw) return [];
    if (/^[\[{]/.test(raw)) {
      try { source = JSON.parse(raw); } catch(e) { source = raw; }
    }
    if (typeof source === 'string') {
      return source.split(/[,;\n\r]+/).map((part, index) => {
        const productNo = String(part || '').trim().replace(/^#/, '');
        return productNo ? { key: `relation_${index + 1}`, product_no: productNo, product_name: '', interrelated: 'F' } : null;
      }).filter(Boolean);
    }
  }
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const nested = source.relational_product || source.relational_products || source.products || source.product || source.items || source.list;
    if (nested !== undefined) return factoryCafe24RelationRowsFromValue(nested);
    source = [source];
  }
  if (!Array.isArray(source)) return [];
  return source.map((item, index) => {
    const row = item && typeof item === 'object' ? item : { product_no: item };
    const productNo = String(row.product_no || row.productNo || row.no || row.id || row.value || '').trim().replace(/^#/, '');
    const productName = String(row.product_name || row.name || row.label || '').trim();
    const interrelated = /^T$/i.test(String(row.interrelated || row.relation || row.related || row.bidirectional || 'F')) ? 'T' : 'F';
    return productNo || productName ? { key: `relation_${index + 1}`, product_no: productNo, product_name: productName, interrelated } : null;
  }).filter(Boolean);
}

function factoryCafe24RelationDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24RelationDraft = factory.product.cafe24RelationDraft && typeof factory.product.cafe24RelationDraft === 'object'
    ? factory.product.cafe24RelationDraft
    : {};
  const draft = factory.product.cafe24RelationDraft;
  if (!Array.isArray(draft.rows)) {
    const { raw } = factoryCafe24TargetInfo(factory);
    draft.rows = factoryCafe24RelationRowsFromValue(raw.relational_product || raw.relational_products);
  }
  if (!draft.rows.length) draft.rows = [{ key: 'relation_1', product_no: '', product_name: '', interrelated: 'F' }];
  return draft;
}

function factoryCafe24RelationPayload(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24RelationDraft(factory);
  const rows = (draft.rows || [])
    .map(row => ({
      product_no: String(row.product_no || '').trim().replace(/^#/, ''),
      product_name: String(row.product_name || '').trim(),
      interrelated: /^T$/i.test(String(row.interrelated || 'F')) ? 'T' : 'F',
    }))
    .filter(row => row.product_no);
  if (!draft.touched) return { rows, payload: null };
  return {
    rows,
    payload: { relational_product: rows.map(row => ({ product_no: row.product_no, interrelated: row.interrelated })) },
  };
}

function factoryCafe24MemoRowsFromBody(body) {
  const source = unwrapApiHubBody(body);
  const candidates = [
    source?.data?.response?.memos,
    source?.response?.memos,
    source?.memos,
    source?.data?.memos,
  ];
  const rows = candidates.find(Array.isArray) || [];
  return rows.map((item, index) => ({
    memo_no: String(item?.memo_no || item?.memoNo || item?.no || '').trim(),
    author_id: String(item?.author_id || item?.authorId || '').trim(),
    memo: String(item?.memo || item?.content || '').trim(),
    created_date: String(item?.created_date || item?.createdDate || '').trim(),
    key: `memo_${index + 1}`,
  }));
}

function factoryCafe24MemoDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24MemoDraft = factory.product.cafe24MemoDraft && typeof factory.product.cafe24MemoDraft === 'object'
    ? factory.product.cafe24MemoDraft
    : {};
  const draft = factory.product.cafe24MemoDraft;
  if (!Array.isArray(draft.memos)) draft.memos = [];
  if (draft.memoNo === undefined) draft.memoNo = '';
  if (draft.authorId === undefined) draft.authorId = draft.memos[0]?.author_id || '';
  if (draft.memo === undefined) draft.memo = draft.memos[0]?.memo || '';
  return draft;
}

function factoryCafe24MemoPayload(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24MemoDraft(factory);
  if (!draft.touched) return null;
  const memo = String(draft.memo || '').trim();
  const authorId = String(draft.authorId || '').trim();
  if (!memo || !authorId) return null;
  return { author_id: authorId, memo };
}

function factoryCafe24MainDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24MainDraft = factory.product.cafe24MainDraft && typeof factory.product.cafe24MainDraft === 'object'
    ? factory.product.cafe24MainDraft
    : {};
  const draft = factory.product.cafe24MainDraft;
  if (draft.displayGroup === undefined) {
    const { raw } = factoryCafe24TargetInfo(factory);
    draft.displayGroup = String(raw?.main?.display_group || raw?.display_group || '').trim();
  }
  if (!draft.displayGroup) draft.displayGroup = '';
  if (!Array.isArray(draft.products)) draft.products = [];
  if (!draft.fixedSort) draft.fixedSort = 'F';
  if (draft.fixProductNo === undefined) draft.fixProductNo = '';
  return draft;
}

function factoryCafe24MainPayload(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24MainDraft(factory);
  const { productNo } = factoryCafe24TargetInfo(factory);
  const displayGroup = String(draft.displayGroup || '').trim();
  if (!draft.touched || !productNo || !displayGroup) return null;
  const payload = { product_no: productNo };
  if (/^T$/i.test(String(draft.fixedSort || ''))) payload.fix_product_no = String(draft.fixProductNo || productNo).trim() || productNo;
  return { displayGroup, payload };
}

function factoryCafe24PromotionDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24PromotionDraft = factory.product.cafe24PromotionDraft && typeof factory.product.cafe24PromotionDraft === 'object'
    ? factory.product.cafe24PromotionDraft
    : {};
  const draft = factory.product.cafe24PromotionDraft;
  if (!Array.isArray(draft.benefits)) draft.benefits = [];
  if (!Array.isArray(draft.coupons)) draft.coupons = [];
  return draft;
}

function factoryCafe24PromotionItemLabel(item = {}, type = '') {
  const no = item.benefit_no || item.coupon_no || item.no || item.id || item._factory_key || '';
  const name = item.benefit_name || item.coupon_name || item.name || item.title || item.display_name || '';
  const status = item.display || item.use_flag || item.available || item.status || '';
  const dates = [item.start_date || item.issue_start_date || '', item.end_date || item.issue_end_date || ''].filter(Boolean).join(' ~ ');
  return [no ? `#${no}` : type, name || '이름 없음', status ? factoryCafe24FlagText(status, '사용함', '사용안함') : '', dates].filter(Boolean).join(' · ');
}

function factoryCleanCafe24Tag(value) {
  const cleaned = String(value ?? '')
    .replace(/^[\s"'`[\]{}()]+|[\s"'`[\]{}()]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || cleaned.length > 80) return '';
  if (/^(true|false|null|undefined)$/i.test(cleaned)) return '';
  return cleaned;
}

function factorySplitCafe24Tags(value) {
  if (Array.isArray(value)) return factoryDedupeOptionValues(value.map(factoryCleanCafe24Tag).filter(Boolean));
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  return factoryDedupeOptionValues(raw.split(/[,;、\n\r]+/).map(factoryCleanCafe24Tag).filter(Boolean));
}

function factoryCafe24TagSourceList(raw = {}) {
  const candidates = [
    raw?.tags,
    raw?.tags?.tags,
    raw?.product_tag,
    raw?.product_tags,
    raw?.search_keywords,
    raw?.keyword,
  ];
  for (const candidate of candidates) {
    const tags = factorySplitCafe24Tags(candidate);
    if (tags.length) return tags;
  }
  return [];
}

function factoryCafe24TagSourceKey(tags = []) {
  return factorySplitCafe24Tags(tags).map(tag => factoryDbNormalizeKey(tag)).join('|');
}

function factoryCafe24SeoDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24SeoDraft = factory.product.cafe24SeoDraft && typeof factory.product.cafe24SeoDraft === 'object'
    ? factory.product.cafe24SeoDraft
    : {};
  const draft = factory.product.cafe24SeoDraft;
  const raw = factoryCafe24RawForForm(factory);
  const source = raw?.seo && typeof raw.seo === 'object' ? raw.seo : {};
  const defaults = {
    metaTitle: source.meta_title || '',
    metaAuthor: source.meta_author || '',
    metaDescription: source.meta_description || '',
    metaKeywords: source.meta_keywords || '',
    metaAlt: source.meta_alt || '',
    searchEngineExposure: source.search_engine_exposure || 'T',
  };
  Object.entries(defaults).forEach(([key, value]) => {
    if (draft[key] === undefined) draft[key] = String(value ?? '');
  });
  if (draft.original === undefined) draft.original = cloneData(defaults);
  return draft;
}

function factoryCafe24SeoPayloadHasText(payload = {}) {
  return ['meta_title', 'meta_author', 'meta_description', 'meta_keywords', 'meta_alt']
    .some(key => String(payload?.[key] || '').trim() !== '');
}

function factoryCafe24SeoPayloadFromRaw(raw = {}) {
  const seo = raw?.seo || raw?.product_seo || raw?.seo_info || {};
  const rawTags = factorySplitCafe24Tags(
    seo.meta_keywords ||
    raw.meta_keywords ||
    raw.product_tag ||
    raw.product_tags ||
    raw.tags ||
    raw.search_keywords ||
    []
  );
  const rawName = String(raw.product_name || raw.eng_product_name || raw.product_name_en || '').trim();
  const rawDescription = String(raw.meta_description || raw.summary_description || raw.simple_description || raw.description_text || '').trim();
  const payload = {
    meta_title: String(seo.meta_title || raw.meta_title || rawName || '').trim(),
    meta_author: String(seo.meta_author || raw.meta_author || '').trim(),
    meta_description: String(seo.meta_description || rawDescription || '').trim(),
    meta_keywords: String(seo.meta_keywords || raw.meta_keywords || rawTags.join(',') || '').trim(),
    meta_alt: String(seo.meta_alt || raw.meta_alt || rawName || '').trim(),
    search_engine_exposure: /^F$/i.test(String(seo.search_engine_exposure || raw.search_engine_exposure || '')) ? 'F' : 'T',
  };
  return factoryCafe24SeoPayloadHasText(payload) ? payload : null;
}

function factoryCafe24SeoPayloadFromFinalDb(finalDb = {}) {
  const pick = (...keys) => keys.map(key => finalDb?.[key]).find(value => String(value ?? '').trim() !== '');
  const tags = factorySplitCafe24Tags(pick('meta_keywords', 'seo_keywords', 'search_keywords', 'product_tag', 'tags') || []);
  const payload = {
    meta_title: String(pick('meta_title', 'seo_title', 'browser_title', 'product_name') || '').trim(),
    meta_author: String(pick('meta_author', 'seo_author') || '').trim(),
    meta_description: String(pick('meta_description', 'seo_description', 'summary_description', 'simple_description') || '').trim(),
    meta_keywords: tags.join(','),
    meta_alt: String(pick('meta_alt', 'seo_alt', 'image_alt', 'product_name') || '').trim(),
    search_engine_exposure: 'T',
  };
  return factoryCafe24SeoPayloadHasText(payload) ? payload : null;
}

function factoryCafe24SeoFallbackPayload(factory = factoryRuntimeReadFactory()) {
  const finalDb = factory.product?.finalDb || {};
  const targetRaw = factoryCafe24RawForForm(factory);
  const targetPayload = factoryCafe24SeoPayloadFromRaw(targetRaw);
  if (targetPayload) return targetPayload;

  const targetNo = String(targetRaw?.product_no || factory.product?.cafe24TargetProductNo || '').trim();
  const candidates = Array.isArray(factory.product?.cafe24Candidates) ? factory.product.cafe24Candidates : [];
  const ordered = [
    ...candidates.filter(candidate => candidate?.selected || candidate?.confirmed || candidate?.applied),
    ...candidates,
  ];
  const seen = new Set();
  for (const candidate of ordered) {
    const raw = parseCafe24Raw(candidate) || candidate?.raw || candidate;
    const productNo = String(raw?.product_no || candidate?.product_no || '').trim();
    const key = productNo || JSON.stringify(raw || {}).slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    if (targetNo && productNo && targetNo === productNo) continue;
    const payload = factoryCafe24SeoPayloadFromRaw(raw);
    if (payload) return payload;
  }
  return factoryCafe24SeoPayloadFromFinalDb(finalDb);
}

function factoryCafe24SeoPayload(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24SeoDraft(factory);
  if (!factoryCafe24SeoChanged(factory)) return factoryCafe24SeoFallbackPayload(factory);
  const payload = {
    meta_title: String(draft.metaTitle || '').trim(),
    meta_author: String(draft.metaAuthor || '').trim(),
    meta_description: String(draft.metaDescription || '').trim(),
    meta_keywords: String(draft.metaKeywords || '').trim(),
    meta_alt: String(draft.metaAlt || '').trim(),
    search_engine_exposure: /^F$/i.test(String(draft.searchEngineExposure || '')) ? 'F' : 'T',
  };
  return factoryCafe24SeoPayloadHasText(payload) ? payload : null;
}

function factoryCafe24EnglishProductNameValue(factory = factoryRuntimeReadFactory()) {
  const finalDb = factory.product?.finalDb || {};
  const raw = factoryCafe24RawForForm(factory) || {};
  const dbModel = (() => {
    try { return factoryBuildDbReviewModel(factory); } catch(e) { return null; }
  })();
  const db = dbModel?.finalDb || {};
  const pick = (...values) => values
    .map(value => String(value ?? '').trim())
    .find(value => value && /[A-Za-z]/.test(value) && !/[가-힣]/.test(value));
  return pick(
    finalDb.eng_product_name,
    finalDb.product_name_en,
    finalDb.english_product_name,
    finalDb.mall_product_name_en,
    finalDb.shop2_product_name,
    db.eng_product_name,
    db.product_name_en,
    db.english_product_name,
    db.mall_product_name_en,
    db.shop2_product_name,
    raw.eng_product_name,
  ) || '';
}

function factoryCafe24EnglishShopNameSyncPlan(factory = factoryRuntimeReadFactory()) {
  const name = factoryCafe24EnglishProductNameValue(factory);
  return {
    shopNo: 2,
    shopLabel: '쇼피싱가포르',
    productName: name,
    ready: false,
    available: !!name,
    reason: name
      ? 'Cafe24 기본 상품 API에서는 eng_product_name 저장까지만 재조회 검증되었습니다. shop_no=2 상품명 직접 저장은 응답 성공처럼 보여도 재조회에 남지 않아 자동 실행하지 않습니다.'
      : '영문상품명 없음',
    summary: name
      ? `eng_product_name 저장 검증됨 · 쇼피싱가포르 행 직접 저장 미검증 · ${name.slice(0, 40)}${name.length > 40 ? '...' : ''}`
      : '영문상품명 없음',
  };
}

function factoryCafe24SeoChanged(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24SeoDraft(factory);
  if (!draft.touched) return false;
  const original = draft.original || {};
  const comparable = {
    metaTitle: String(draft.metaTitle || '').trim(),
    metaAuthor: String(draft.metaAuthor || '').trim(),
    metaDescription: String(draft.metaDescription || '').trim(),
    metaKeywords: String(draft.metaKeywords || '').trim(),
    metaAlt: String(draft.metaAlt || '').trim(),
    searchEngineExposure: /^F$/i.test(String(draft.searchEngineExposure || '')) ? 'F' : 'T',
  };
  return Object.entries(comparable).some(([key, value]) => {
    const before = key === 'searchEngineExposure'
      ? (/^F$/i.test(String(original[key] || '')) ? 'F' : 'T')
      : String(original[key] || '').trim();
    return value !== before;
  });
}

function factoryCafe24TagsDraft(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.product.cafe24TagsDraft = factory.product.cafe24TagsDraft && typeof factory.product.cafe24TagsDraft === 'object'
    ? factory.product.cafe24TagsDraft
    : {};
  const draft = factory.product.cafe24TagsDraft;
  const raw = factoryCafe24RawForForm(factory);
  const manualSetting = factory.product.dbFieldSettings?.search_keywords;
  const manualTouched = !!(manualSetting && (manualSetting.manualTouched || String(manualSetting.manualValue || '').trim()));
  const manualText = manualTouched ? String(manualSetting.manualValue || '') : '';
  const sourceTags = factoryCafe24TagSourceList(raw);
  const sourceKey = factoryCafe24TagSourceKey(sourceTags);
  const productKey = factoryCafe24CurrentProductKey(factory) || String(raw.product_no || '').trim();
  const shouldRefreshOriginal = !Array.isArray(draft.originalTags) ||
    draft.originalSourceKey !== sourceKey ||
    draft.originalProductKey !== productKey;
  if (shouldRefreshOriginal) {
    draft.originalTags = sourceTags;
    draft.originalSourceKey = sourceKey;
    draft.originalProductKey = productKey;
    if (!draft.touched) draft.tags = sourceTags;
  }
  if (!Array.isArray(draft.tags)) draft.tags = sourceTags;
  if (manualTouched && draft.manualSourceValue !== manualText) {
    const next = factorySplitCafe24Tags(manualText);
    const current = factorySplitCafe24Tags(draft.originalTags || []);
    const currentKeys = new Set(current.map(factoryDbNormalizeKey));
    const nextKeys = new Set(next.map(factoryDbNormalizeKey));
    draft.tags = next;
    draft.touched = next.some(tag => !currentKeys.has(factoryDbNormalizeKey(tag))) ||
      current.some(tag => !nextKeys.has(factoryDbNormalizeKey(tag)));
    draft.manualSourceValue = manualText;
  }
  return draft;
}

function factoryCafe24TagsPayload(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24TagsDraft(factory);
  if (!draft.touched) return null;
  const next = factorySplitCafe24Tags(draft.tags);
  const current = factorySplitCafe24Tags(draft.originalTags);
  const currentKeys = new Set(current.map(factoryDbNormalizeKey));
  const nextKeys = new Set(next.map(factoryDbNormalizeKey));
  const add = next.filter(tag => !currentKeys.has(factoryDbNormalizeKey(tag)));
  const remove = current.filter(tag => !nextKeys.has(factoryDbNormalizeKey(tag)));
  if (!add.length && !remove.length) return null;
  return {
    tags: next,
    add,
    remove,
  };
}

function renderFactoryCafe24SeoTagsPanel(factory = factoryRuntimeReadFactory(), productNo = '') {
  const seo = factoryCafe24SeoDraft(factory);
  const tagDraft = factoryCafe24TagsDraft(factory);
  const seoPlan = factoryCafe24SeoPayload(factory);
  const tagPlan = factoryCafe24TagsPayload(factory);
  const tagText = factorySplitCafe24Tags(tagDraft.tags).join('\n');
  return `<div class="factory-cafe24-additional-strip">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 검색엔진 / 태그</div>
        <div class="factory-source-sub">Cafe24 상품 수정 화면의 검색엔진 최적화와 검색 태그를 전용 API로 따로 관리합니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryRefreshCafe24SeoTags" type="button" ${disabledAttr(!productNo, 'Cafe24 상품번호를 먼저 확정해주세요.')}><span class="material-icons-outlined" style="font-size:14px">manage_search</span>SEO/태그 불러오기</button>
        <button class="btn-sm" id="factorySyncCafe24Seo" type="button" ${disabledAttr(!productNo || !seoPlan, !productNo ? 'Cafe24 상품번호를 먼저 확정해주세요.' : 'SEO 값을 수정하면 저장할 수 있습니다.')}><span class="material-icons-outlined" style="font-size:14px">travel_explore</span>SEO 저장</button>
        <button class="btn-sm" id="factorySyncCafe24Tags" type="button" ${disabledAttr(!productNo || !tagPlan, !productNo ? 'Cafe24 상품번호를 먼저 확정해주세요.' : '태그 값을 수정하면 저장할 수 있습니다.')}><span class="material-icons-outlined" style="font-size:14px">sell</span>태그 동기화</button>
      </div>
    </div>
    <div class="factory-cafe24-option-grid">
      <label>브라우저 제목(meta_title)<input class="factory-cafe24-option-input" id="factoryCafe24SeoTitle" value="${escAttr(seo.metaTitle || '')}" placeholder="검색 결과/브라우저 제목"></label>
      <label>작성자(meta_author)<input class="factory-cafe24-option-input" id="factoryCafe24SeoAuthor" value="${escAttr(seo.metaAuthor || '')}" placeholder="제조/등록자"></label>
      <label>검색 노출
        <select class="factory-cafe24-option-input" id="factoryCafe24SeoExposure">
          <option value="T" ${seo.searchEngineExposure !== 'F' ? 'selected' : ''}>노출함</option>
          <option value="F" ${seo.searchEngineExposure === 'F' ? 'selected' : ''}>노출안함</option>
        </select>
      </label>
      <label>이미지 대체문구(meta_alt)<input class="factory-cafe24-option-input" id="factoryCafe24SeoAlt" value="${escAttr(seo.metaAlt || '')}" placeholder="이미지 alt 텍스트"></label>
    </div>
    <div class="factory-cafe24-option-grid">
      <label>검색 설명(meta_description)
        <textarea class="factory-cafe24-option-input" id="factoryCafe24SeoDescription" rows="3" placeholder="검색 결과에 보일 상품 설명">${escapeHtml(seo.metaDescription || '')}</textarea>
      </label>
      <label>검색 키워드(meta_keywords)
        <textarea class="factory-cafe24-option-input" id="factoryCafe24SeoKeywords" rows="3" placeholder="쉼표 또는 줄바꿈으로 구분">${escapeHtml(seo.metaKeywords || '')}</textarea>
      </label>
      <label>상품 태그(tags)
        <textarea class="factory-cafe24-option-input" id="factoryCafe24Tags" rows="5" placeholder="한 줄에 하나씩 입력">${escapeHtml(tagText)}</textarea>
      </label>
    </div>
    <div class="factory-cafe24-sync-preview">
      ${productNo ? `상품 #${escapeHtml(productNo)} · ` : '상품번호 대기 · '}
      SEO ${seo.touched ? '저장 준비됨' : '원본 유지'} · 태그 ${factorySplitCafe24Tags(tagDraft.tags).length}개${tagPlan ? ` · 추가 ${tagPlan.add.length}개 · 삭제 ${tagPlan.remove.length}개` : ''}
    </div>
  </div>`;
}

function renderFactoryCafe24RelationPanel(factory = factoryRuntimeReadFactory(), productNo = '') {
  const draft = factoryCafe24RelationDraft(factory);
  const plan = factoryCafe24RelationPayload(factory);
  const canSync = !!productNo && draft.touched;
  return `<div class="factory-cafe24-additional-strip">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 관련상품</div>
        <div class="factory-source-sub">관련상품은 상품 기본 저장과 섞지 않고, 관련상품 값만 별도로 Cafe24에 보냅니다. 상품번호를 한 줄씩 넣으면 됩니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryCafe24RelationAdd" type="button"><span class="material-icons-outlined" style="font-size:14px">add</span>관련상품 행 추가</button>
        <button class="btn-sm" id="factorySyncCafe24Relations" type="button" ${disabledAttr(!canSync, !productNo ? '먼저 Cafe24 상품을 확정해야 합니다.' : '관련상품 값을 수정하면 저장할 수 있습니다.')}>
          <span class="material-icons-outlined" style="font-size:14px">link</span>관련상품 저장
        </button>
      </div>
    </div>
    <div class="factory-cafe24-structured">
      ${draft.rows.map((row, index) => `<div class="factory-cafe24-structured-row four" data-factory-cafe24-relation-row="${index}">
        <label>관련 상품번호<input data-factory-cafe24-relation-field="${index}:product_no" value="${escAttr(row.product_no || '')}" placeholder="예: 2966"></label>
        <label>상품명 메모<input data-factory-cafe24-relation-field="${index}:product_name" value="${escAttr(row.product_name || '')}" placeholder="확인용 메모"></label>
        <label>상호 관련
          <select data-factory-cafe24-relation-field="${index}:interrelated">
            <option value="F" ${row.interrelated !== 'T' ? 'selected' : ''}>아니오</option>
            <option value="T" ${row.interrelated === 'T' ? 'selected' : ''}>예</option>
          </select>
        </label>
        <button class="btn-sm" data-factory-cafe24-relation-remove="${index}" type="button">삭제</button>
      </div>`).join('')}
    </div>
    <div class="factory-cafe24-sync-preview">
      ${productNo ? `동기화 대상 상품 #${escapeHtml(productNo)} · ` : '상품번호 대기 · '}
      관련상품 ${plan.rows.length}개${draft.touched ? ' · 저장 준비됨' : ' · 아직 수정 안 함'}
    </div>
  </div>`;
}

function renderFactoryCafe24PromotionPanel(factory = factoryRuntimeReadFactory(), productNo = '') {
  const draft = factoryCafe24PromotionDraft(factory);
  const benefitCount = draft.benefits.length;
  const couponCount = draft.coupons.length;
  const raw = factoryCafe24RawForForm(factory);
  const productBenefitFields = [
    raw.points_by_product ? `적립금 개별설정: ${factoryCafe24FlagText(raw.points_by_product, '개별설정', '기본설정')}` : '',
    raw.points_amount ? `적립금 지급액/비율: ${factoryCafe24PointsAmountText(raw.points_amount) || factoryCafe24JsonText(raw.points_amount)}` : '',
    raw.price_content ? `판매가 대체문구: ${raw.price_content}` : '',
    raw.promotion_period ? `프로모션 기간: ${factoryFormatDbValue(raw.promotion_period)}` : '',
  ].filter(Boolean);
  return `<div class="factory-cafe24-additional-strip">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 할인혜택 / 쿠폰 확인</div>
        <div class="factory-source-sub">Cafe24 상품 수정 화면의 할인혜택 영역입니다. 현재 Control Tower 카탈로그에는 혜택/쿠폰 조회 API만 있어 목록과 상품 저장 가능 필드를 분리해 보여줍니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryRefreshCafe24Promotions" type="button"><span class="material-icons-outlined" style="font-size:14px">local_offer</span>혜택/쿠폰 목록 불러오기</button>
      </div>
    </div>
    <div class="factory-cafe24-sync-preview">
      ${productNo ? `상품 #${escapeHtml(productNo)} · ` : '상품번호 대기 · '}
      혜택 ${benefitCount}개 · 쿠폰 ${couponCount}개${draft.fetchedAt ? ` · 마지막 ${escapeHtml(new Date(draft.fetchedAt).toLocaleString())}` : ''}
      <br>상품별로 실제 저장 가능한 혜택성 필드는 적립금/판매가대체문구/프로모션기간 등 위 상품 입력판에서 저장합니다.
    </div>
    ${productBenefitFields.length ? `<div class="factory-source-option-list">${productBenefitFields.map(item => `<span class="factory-source-option-pill">${escapeHtml(item)}</span>`).join('')}</div>` : `<div class="factory-cafe24-image-empty">현재 상품 상세에 별도 혜택성 값이 없습니다.</div>`}
    <div class="factory-cafe24-option-grid">
      <div>
        <div class="factory-source-sub" style="margin-bottom:6px">혜택 목록</div>
        <div class="factory-source-option-list">
          ${benefitCount ? draft.benefits.slice(0, 16).map(item => `<span class="factory-source-option-pill" title="${escAttr(factoryFormatDbValue(item))}">${escapeHtml(factoryCafe24PromotionItemLabel(item, '혜택'))}</span>`).join('') : '<span class="factory-source-missing">조회된 혜택이 없습니다.</span>'}
        </div>
      </div>
      <div>
        <div class="factory-source-sub" style="margin-bottom:6px">쿠폰 목록</div>
        <div class="factory-source-option-list">
          ${couponCount ? draft.coupons.slice(0, 16).map(item => `<span class="factory-source-option-pill" title="${escAttr(factoryFormatDbValue(item))}">${escapeHtml(factoryCafe24PromotionItemLabel(item, '쿠폰'))}</span>`).join('') : '<span class="factory-source-missing">조회된 쿠폰이 없습니다.</span>'}
        </div>
      </div>
    </div>
    <div class="factory-source-edit-hint">혜택/쿠폰을 상품에 직접 연결하는 쓰기 경로가 API 카탈로그에 추가되면 이 패널에서 바로 전용 동기화 단계로 승격할 수 있게 분리해두었습니다.</div>
  </div>`;
}

function renderFactoryCafe24MemoPanel(factory = factoryRuntimeReadFactory(), productNo = '') {
  const draft = factoryCafe24MemoDraft(factory);
  const payload = factoryCafe24MemoPayload(factory);
  const selectedMemo = draft.memos.find(item => String(item.memo_no) === String(draft.memoNo));
  const canCreate = !!productNo && !!payload;
  const canUpdate = canCreate && !!draft.memoNo;
  const canDelete = !!productNo && !!draft.memoNo;
  return `<div class="factory-cafe24-additional-strip">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 관리 메모</div>
        <div class="factory-source-sub">관리자 상품 메모입니다. 상품 기본 저장과 별도로 product memos API로 불러오고 저장합니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryRefreshCafe24Memos" type="button" ${disabledAttr(!productNo, '먼저 Cafe24 상품을 확정해야 합니다.')}><span class="material-icons-outlined" style="font-size:14px">refresh</span>메모 불러오기</button>
        <button class="btn-sm" id="factoryCreateCafe24Memo" type="button" ${disabledAttr(!canCreate, !productNo ? '먼저 Cafe24 상품을 확정해야 합니다.' : '작성자 ID와 메모를 입력해주세요.')}><span class="material-icons-outlined" style="font-size:14px">note_add</span>새 메모 저장</button>
        <button class="btn-sm" id="factoryUpdateCafe24Memo" type="button" ${disabledAttr(!canUpdate, '수정할 기존 메모를 선택하고 작성자 ID/메모를 입력해주세요.')}><span class="material-icons-outlined" style="font-size:14px">edit_note</span>선택 메모 수정</button>
        <button class="btn-sm danger" id="factoryDeleteCafe24Memo" type="button" ${disabledAttr(!canDelete, '삭제할 기존 메모를 선택해주세요.')}><span class="material-icons-outlined" style="font-size:14px">delete</span>선택 메모 삭제</button>
      </div>
    </div>
    <div class="factory-cafe24-option-grid">
      <label>기존 메모 선택
        <select class="factory-cafe24-option-input" id="factoryCafe24MemoNo">
          <option value="">새 메모</option>
          ${draft.memos.map(item => `<option value="${escAttr(item.memo_no)}" ${String(item.memo_no) === String(draft.memoNo) ? 'selected' : ''}>${escapeHtml(item.memo_no ? `#${item.memo_no}` : '메모')} ${escapeHtml(item.author_id || '')}</option>`).join('')}
        </select>
      </label>
      <label>작성자 ID<input class="factory-cafe24-option-input" id="factoryCafe24MemoAuthor" value="${escAttr(draft.authorId || selectedMemo?.author_id || '')}" placeholder="예: admin"></label>
    </div>
    <label class="factory-cafe24-memo-editor">메모 내용
      <textarea class="factory-cafe24-option-input" id="factoryCafe24MemoText" rows="5" placeholder="관리자 상품 메모">${escapeHtml(draft.memo || selectedMemo?.memo || '')}</textarea>
    </label>
    <div class="factory-cafe24-sync-preview">
      ${productNo ? `상품 #${escapeHtml(productNo)} · ` : '상품번호 대기 · '}
      불러온 메모 ${draft.memos.length}개${draft.fetchedAt ? ` · 마지막 ${escapeHtml(new Date(draft.fetchedAt).toLocaleString())}` : ''}
    </div>
    ${draft.memos.length ? `<div class="factory-source-option-list">
      ${draft.memos.slice(0, 8).map(item => `<span class="factory-source-option-pill" title="${escAttr(item.memo || '')}">#${escapeHtml(item.memo_no || '-')} ${escapeHtml(item.author_id || '')}</span>`).join('')}
    </div>` : `<div class="factory-cafe24-image-empty">아직 불러온 메모가 없습니다. 메모가 없으면 빈 상태가 정상입니다.</div>`}
  </div>`;
}

function renderFactoryCafe24MainDisplayPanel(factory = factoryRuntimeReadFactory(), productNo = '') {
  const draft = factoryCafe24MainDraft(factory);
  const payload = factoryCafe24MainPayload(factory);
  const canRead = !!draft.displayGroup;
  const canSync = !!payload;
  return `<div class="factory-cafe24-additional-strip">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 메인 진열</div>
        <div class="factory-source-sub">메인분류에 상품을 올리는 영역입니다. Mains products API로 상품 기본 저장과 분리합니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryRefreshCafe24MainProducts" type="button" ${disabledAttr(!canRead, '메인 진열 번호를 입력해주세요.')}><span class="material-icons-outlined" style="font-size:14px">refresh</span>진열 목록 확인</button>
        <button class="btn-sm" id="factorySyncCafe24MainProduct" type="button" ${disabledAttr(!canSync, !productNo ? '먼저 Cafe24 상품을 확정해야 합니다.' : '메인 진열 번호를 입력하고 수정해주세요.')}><span class="material-icons-outlined" style="font-size:14px">view_carousel</span>메인 진열 저장</button>
        <button class="btn-sm danger" id="factoryDeleteCafe24MainProduct" type="button" ${disabledAttr(!productNo || !draft.displayGroup, '상품번호와 메인 진열 번호가 필요합니다.')}><span class="material-icons-outlined" style="font-size:14px">remove_circle</span>진열에서 제거</button>
      </div>
    </div>
    <div class="factory-cafe24-option-grid">
      <label>메인 진열 번호<input class="factory-cafe24-option-input" id="factoryCafe24MainDisplayGroup" value="${escAttr(draft.displayGroup || '')}" placeholder="예: 2"></label>
      <label>고정 진열
        <select class="factory-cafe24-option-input" id="factoryCafe24MainFixedSort">
          <option value="F" ${draft.fixedSort !== 'T' ? 'selected' : ''}>고정 안 함</option>
          <option value="T" ${draft.fixedSort === 'T' ? 'selected' : ''}>고정함</option>
        </select>
      </label>
      <label>고정 기준 상품번호<input class="factory-cafe24-option-input" id="factoryCafe24MainFixProductNo" value="${escAttr(draft.fixProductNo || '')}" placeholder="비우면 현재 상품"></label>
    </div>
    <div class="factory-cafe24-sync-preview">
      ${productNo ? `현재 상품 #${escapeHtml(productNo)} · ` : '상품번호 대기 · '}
      메인 진열 ${escapeHtml(draft.displayGroup || '미입력')} ${draft.products.length ? `· 조회 ${draft.products.length}개` : ''}
    </div>
    ${draft.products.length ? `<div class="factory-source-option-list">
      ${draft.products.slice(0, 12).map(item => {
        const no = String(item.product_no || '').trim();
        const selected = productNo && no === String(productNo);
        return `<span class="factory-source-option-pill ${selected ? 'match' : ''}" title="${escAttr(item.product_name || '')}">#${escapeHtml(no || '-')} ${escapeHtml(item.product_name || '')}</span>`;
      }).join('')}
    </div>` : `<div class="factory-cafe24-image-empty">아직 메인 진열 목록을 불러오지 않았습니다.</div>`}
  </div>`;
}

function renderFactoryCafe24DedicatedApiPanels(factory = factoryRuntimeReadFactory()) {
  const { productNo } = factoryCafe24TargetInfo(factory);
  return `<div class="factory-source-section">
    <h5>전용 API 입력판</h5>
    <div class="factory-cafe24-dedicated-grid">
      ${renderFactoryCafe24SeoTagsPanel(factory, productNo)}
      ${renderFactoryCafe24RelationPanel(factory, productNo)}
      ${renderFactoryCafe24PromotionPanel(factory, productNo)}
      ${renderFactoryCafe24MemoPanel(factory, productNo)}
      ${renderFactoryCafe24MainDisplayPanel(factory, productNo)}
    </div>
  </div>`;
}

function renderFactoryCafe24ImageSyncPanel(factory = factoryRuntimeReadFactory()) {
  const draft = factoryCafe24ImageDraft(factory);
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target) || {};
  const productNo = target?.product_no || raw.product_no || factory.product.finalDb?.product_no || factory.product.finalDb?.cafe24_product_no || '';
  const payload = factoryCafe24ImagePayload(factory);
  const hasUploadImage = FACTORY_CAFE24_IMAGE_SLOTS.some(slot => payload[slot.key]);
  return `<div class="factory-cafe24-image-editor">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 상품 이미지 업로드</div>
        <div class="factory-source-sub">상품 기본정보 저장과 분리해서 Cafe24 이미지 API로 상세/목록/썸네일/작은 이미지를 올립니다.</div>
      </div>
      <div class="factory-toolbar">
        <button class="btn-sm" id="factoryClearCafe24Images" type="button"><span class="material-icons-outlined" style="font-size:14px">backspace</span>이미지 슬롯 비우기</button>
        <button class="btn-sm" id="factorySyncCafe24Images" type="button" ${disabledAttr(!productNo || !hasUploadImage, !productNo ? '먼저 Cafe24 상품 후보를 확정해야 합니다.' : '업로드할 이미지 파일을 먼저 선택해주세요.')}>
          <span class="material-icons-outlined" style="font-size:14px">image</span>Cafe24 이미지 업로드
        </button>
      </div>
    </div>
    <div class="factory-cafe24-option-grid">
      <label>이미지 등록 방식
        <select class="factory-cafe24-option-input" id="factoryCafe24ImageUploadType">
          <option value="A" ${draft.image_upload_type !== 'B' ? 'selected' : ''}>대표 이미지로 등록 · 상세 이미지를 다른 이미지에도 반영</option>
          <option value="B" ${draft.image_upload_type === 'B' ? 'selected' : ''}>개별 이미지로 등록 · 슬롯별 이미지를 각각 사용</option>
        </select>
      </label>
      <div class="factory-cafe24-sync-preview">
        ${productNo ? `동기화 대상 상품번호 #${escapeHtml(productNo)}` : 'Cafe24 상품번호가 없어 실제 업로드는 대기합니다.'}<br>
        ${escapeHtml(factoryCafe24ImagePayloadSummary(payload))}
      </div>
    </div>
    <div class="factory-cafe24-image-grid">
      ${FACTORY_CAFE24_IMAGE_SLOTS.map(slot => {
        const src = factoryCafe24ImageSlotValue(slot.key, factory);
        const hasSrc = !!src;
        return `<div class="factory-cafe24-image-slot">
          <div class="factory-cafe24-image-title">
            <span>${escapeHtml(slot.label)}</span>
            <span>${draft[slot.key]?.base64 ? '업로드 준비' : (hasSrc ? '현재값 있음' : '미입력')}</span>
          </div>
          <div class="factory-cafe24-image-thumb">
            ${hasSrc ? `<img src="${escAttr(src)}" alt="${escAttr(slot.label)}">` : `<div class="factory-cafe24-image-empty">${escapeHtml(slot.hint)}<br>로컬 파일이나 제품 입력사진을 넣으세요.</div>`}
          </div>
          <div class="factory-source-sub">${escapeHtml(factoryCafe24ImageSlotMeta(slot.key, factory))}</div>
          <div class="factory-cafe24-image-actions">
            <button class="btn-sm" data-factory-cafe24-image-choose="${escAttr(slot.key)}" type="button">로컬 파일</button>
            <button class="btn-sm" data-factory-cafe24-image-product="${escAttr(slot.key)}" type="button">제품사진 사용</button>
            <button class="btn-sm" data-factory-cafe24-image-clear="${escAttr(slot.key)}" type="button">비우기</button>
          </div>
          <input type="file" accept="image/*" data-factory-cafe24-image-file="${escAttr(slot.key)}" style="display:none">
        </div>`;
      }).join('')}
    </div>
    ${renderFactoryCafe24AdditionalImagePanel(factory, productNo)}
    ${renderFactoryCafe24IconPanel(factory, productNo)}
  </div>`;
}

function renderFactoryCafe24OptionEditor(factory, model) {
  const optionModel = factoryCafe24OptionEditorModel(factory, model);
  const raw = parseCafe24Raw(factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply })) || {};
  const syncPlan = factoryBuildCafe24OptionSyncPlan(factory, factory.product.finalDb || {}, optionModel);
  const productNo = syncPlan.productNo || '';
  const optionGroupCount = syncPlan.optionGroupCount || optionModel.editGroups.length || (optionModel.optionValues.length ? 1 : 0);
  const optionValueTotal = syncPlan.optionValueTotal || optionModel.editGroups.reduce((sum, group) => sum + group.values.length, 0) || optionModel.optionValues.length;
  const extraSummary = syncPlan.optionExtras
    ? `추가 입력 ${syncPlan.optionExtras.useAdditionalOption === 'T' ? `${syncPlan.optionExtras.additionalOptions.length}개` : '사용안함'} · 파일 첨부 ${syncPlan.optionExtras.useAttachedFileOption === 'T' ? '사용함' : '사용안함'}`
    : '추가 옵션 대기';
  const displayOptions = [{ value: 'T', label: '진열함' }, { value: 'F', label: '진열안함' }];
  const sellingOptions = [{ value: 'T', label: '판매함' }, { value: 'F', label: '판매안함' }];
  const soldoutOptions = [{ value: 'F', label: '품절 표시 안 함' }, { value: 'T', label: '품절 표시함' }];
  const useInventoryOptions = CAFE24_FORM_SELECTS.useInventory;
  const importantInventoryOptions = CAFE24_FORM_SELECTS.importantInventory;
  const inventoryControlOptions = CAFE24_FORM_SELECTS.inventoryControlType;
  const currentProductKey = factoryCafe24CurrentProductKey(factory);
  const draftActive = !!currentProductKey && factory.product.cafe24DraftProductKey === currentProductKey && (
    (factory.product.cafe24OptionGroupsDraft || []).length ||
    Object.keys(factory.product.cafe24VariantEdits || {}).length
  );
  const canSyncOptions = !!productNo && syncPlan.hasChanges;
  const sourceLabel = draftActive
    ? '현재 상품 수동 수정값'
    : (optionModel.optionGroups.some(group => group.cafe24Official) ? 'Cafe24 공식 옵션 API' : 'Cafe24 품목 API fallback');
  return `<div class="factory-cafe24-option-editor">
    <div class="factory-source-option-head">
      <div>
        <div class="factory-source-option-title">Cafe24 옵션 입력 / 품목 / 재고</div>
        <div class="factory-source-option-kicker">선택한 Cafe24 상품번호의 공식 옵션 API 값을 먼저 사용합니다. 다른 상품의 이전 편집값은 자동으로 분리됩니다.</div>
      </div>
      <div class="factory-toolbar">
        <span class="factory-db-source">${escapeHtml(sourceLabel)}</span>
        <button class="btn-sm" id="factoryRefreshCafe24Options" type="button" ${disabledAttr(!productNo, 'Cafe24 상품번호를 먼저 확정해주세요.')}><span class="material-icons-outlined" style="font-size:14px">cloud_sync</span>Cafe24 옵션 새로고침</button>
        <button class="btn-sm" id="factoryCafe24OptionGroupAdd" type="button"><span class="material-icons-outlined" style="font-size:14px">add</span>옵션그룹 추가</button>
        <button class="btn-sm" id="factorySyncCafe24Options" type="button" ${disabledAttr(!canSyncOptions, !productNo ? 'Cafe24 상품번호를 먼저 확정해주세요.' : '수정한 옵션/품목/재고 값이 있을 때만 동기화합니다.')}><span class="material-icons-outlined" style="font-size:14px">sync_alt</span>옵션/품목 동기화</button>
      </div>
    </div>
    ${renderFactoryOptionContextComparePanel(factory, optionModel)}
    <div class="factory-cafe24-option-grid">
      <label>옵션명
        <input class="factory-cafe24-option-input" id="factoryCafe24OptionName" value="${escAttr(optionModel.optionName)}" placeholder="예: 색상">
      </label>
      <label>옵션값
        <textarea class="factory-cafe24-option-input" id="factoryCafe24OptionValues" rows="4" placeholder="한 줄에 하나 또는 쉼표로 구분">${escapeHtml(optionModel.optionValues.join('\n'))}</textarea>
      </label>
    </div>
    <div class="factory-cafe24-option-groups">
      ${optionModel.editGroups.length ? optionModel.editGroups.map((group, index) => `<div class="factory-cafe24-option-group-card">
        <div class="factory-cafe24-option-group-head">
          <div class="factory-cafe24-option-group-title">옵션 ${index + 1} · ${escapeHtml(group.name)} · 값 ${group.values.length}개</div>
          <div class="factory-toolbar">
            <span class="factory-db-source">${escapeHtml(sourceLabel)}</span>
            ${optionModel.editGroups.length > 1 ? `<button class="btn-sm" data-factory-cafe24-option-group-remove="${index}" type="button">그룹 삭제</button>` : ''}
          </div>
        </div>
        <div class="factory-cafe24-option-group-fields">
          <label>옵션명
            <input class="factory-cafe24-option-input" data-factory-cafe24-option-group-name="${index}" value="${escAttr(group.name)}" placeholder="예: 색상">
          </label>
          <label>옵션값
            <textarea class="factory-cafe24-option-input" data-factory-cafe24-option-group-values="${index}" rows="3" placeholder="한 줄에 하나씩 입력">${escapeHtml(group.values.join('\n'))}</textarea>
          </label>
        </div>
      </div>`).join('') : `<div class="factory-source-missing">이 상품은 Cafe24 공식 옵션 API 기준 옵션그룹이 없습니다. 옵션을 새로 쓰려면 “옵션그룹 추가”를 눌러 직접 구성하세요.</div>`}
    </div>
    <div class="factory-source-option-list" style="margin-top:8px">
      ${optionModel.editGroups.some(group => group.values.length)
        ? optionModel.editGroups.map(group => group.values.map(value => `<span class="factory-source-option-pill">${escapeHtml(group.name)}: ${escapeHtml(value)}</span>`).join('')).join('')
        : '<span class="factory-source-missing">옵션값이 없습니다. Cafe24 상품을 확정했는데도 비어 있으면 “Cafe24 옵션 새로고침”을 눌러 공식 옵션 API를 다시 읽어주세요.</span>'}
    </div>
    ${renderFactoryCafe24OptionExtrasPanel(factory, raw)}
    <div class="factory-cafe24-variant-table">
      <div class="factory-cafe24-variant-row header">
        <span>품목</span><span>옵션값</span><span>진열</span><span>판매</span><span>재고관리</span><span>중요재고</span><span>차감기준</span><span>품절표시</span><span>재고</span><span>안전재고</span><span>추가금액</span><span>자체품목코드</span>
      </div>
      ${optionModel.variants.length ? optionModel.variants.map(row => `<div class="factory-cafe24-variant-row">
        <span class="factory-cafe24-variant-code" title="${escAttr(row.variant_code ? 'Cafe24 품목코드는 저장할 때 내부 기준으로만 사용됩니다.' : '새 품목')}">${escapeHtml(row.variant_code ? `기존 품목 ${row.index + 1}` : `새 품목 ${row.index + 1}`)}</span>
        <input data-factory-cafe24-variant-field="${escAttr(row.key)}:option_value" value="${escAttr(row.option_value)}" placeholder="옵션값">
        ${renderFactoryCafe24VariantSelect(row, 'display', displayOptions)}
        ${renderFactoryCafe24VariantSelect(row, 'selling', sellingOptions)}
        ${renderFactoryCafe24VariantSelect(row, 'use_inventory', useInventoryOptions)}
        ${renderFactoryCafe24VariantSelect(row, 'important_inventory', importantInventoryOptions)}
        ${renderFactoryCafe24VariantSelect(row, 'inventory_control_type', inventoryControlOptions)}
        ${renderFactoryCafe24VariantSelect(row, 'display_soldout', soldoutOptions)}
        <input data-factory-cafe24-variant-field="${escAttr(row.key)}:quantity" value="${escAttr(row.quantity)}" placeholder="재고">
        <input data-factory-cafe24-variant-field="${escAttr(row.key)}:safety_inventory" value="${escAttr(row.safety_inventory)}" placeholder="안전재고">
        <input data-factory-cafe24-variant-field="${escAttr(row.key)}:additional_amount" value="${escAttr(row.additional_amount)}" placeholder="추가금액">
        <input data-factory-cafe24-variant-field="${escAttr(row.key)}:custom_variant_code" value="${escAttr(row.custom_variant_code)}" placeholder="자체품목코드">
      </div>`).join('') : `<div class="factory-source-missing">품목이 없습니다. 새 상품 등록 시 옵션값으로 생성 요청 payload를 만들 수 있습니다.</div>`}
    </div>
    <div class="factory-cafe24-sync-preview">
      ${productNo ? `동기화 대상 상품번호 #${escapeHtml(productNo)} · ` : '아직 확정된 Cafe24 상품번호가 없습니다. '}
      옵션그룹 ${optionGroupCount}개 · 옵션값 ${optionValueTotal}개 · 품목 수정 ${syncPlan.variantUpdates.length}건 · 재고 수정 ${syncPlan.inventoryUpdates.length}건
      <br>옵션 구조: ${syncPlan.optionUpdate ? `수정분 준비됨 (${escapeHtml(syncPlan.optionUpdate.path)})` : '현재값 표시 중 · 수정 전에는 전송 안 함'} · ${escapeHtml(extraSummary)} · 품목/재고: Cafe24 내부 품목 기준으로만 전송
      ${syncPlan.warnings.length ? `<br><span style="color:#fbbf24">${escapeHtml(syncPlan.warnings.join(' / '))}</span>` : ''}
    </div>
  </div>`;
}

function renderFactoryCafe24LastSaveVerification(verification) {
  if (!verification || typeof verification !== 'object') return '';
  const missing = Array.isArray(verification.missing) ? verification.missing : [];
  const mismatches = Array.isArray(verification.mismatches) ? verification.mismatches : [];
  const ok = verification.ok !== undefined ? !!verification.ok : (!verification.error && !missing.length && !mismatches.length);
  const tone = verification.error ? 'error' : (ok ? '' : 'warn');
  const checked = Number(verification.checked) || 0;
  const matched = Number(verification.matched) || 0;
  const when = verification.savedAt ? new Date(verification.savedAt).toLocaleString() : '';
  const typeLabel = verification.type === 'single-field-verify'
    ? '1필드 왕복 검증'
    : verification.type === 'single-field-rollback'
    ? '1필드 되돌리기 재조회'
    : verification.type === 'create'
    ? '새 상품 등록 재조회'
    : '마지막 저장 재조회';
  const rollback = verification.rollback && typeof verification.rollback === 'object' ? verification.rollback : null;
  const rollbackFieldLabel = rollback?.fieldName ? factoryCafe24FieldLabelByApiField(rollback.fieldName) : '';
  const rollbackLine = rollback && verification.type === 'single-field-verify'
    ? `되돌리기 가능: ${rollbackFieldLabel || rollback.fieldName} · 현재 테스트값 "${factoryCafe24HumanValue(rollback.savedValue, 120)}" → 원래값 "${factoryCafe24HumanValue(rollback.originalValue, 120)}"`
    : '';
  const rollbackAction = rollback && verification.type === 'single-field-verify' && rollback.fieldName && rollback.hasOriginal !== false
    ? `<div class="factory-cafe24-verify-actions"><button class="btn-sm danger" id="factoryRollbackCafe24SingleField" type="button"><span class="material-icons-outlined" style="font-size:14px">undo</span>원래값으로 되돌리기</button></div>`
    : '';
  const fieldText = Array.isArray(verification.fieldNames) && verification.fieldNames.length
    ? ` · ${verification.fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 4).join(', ')}${verification.fieldNames.length > 4 ? ' 외' : ''}`
    : '';
  const issues = [
    missing.length ? `응답 누락: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' 외' : ''}` : '',
    mismatches.length ? `값 확인 필요: ${mismatches.slice(0, 6).join(', ')}${mismatches.length > 6 ? ' 외' : ''}` : '',
    verification.message || '',
  ].filter(Boolean).join(' · ');
  return `<div class="factory-cafe24-verify-card ${tone}">
    <div class="factory-cafe24-verify-title">${escapeHtml(typeLabel)} ${ok ? '반영완료' : '확인 필요'}</div>
    <div class="factory-cafe24-verify-body">
      ${verification.productNo ? `상품 #${escapeHtml(verification.productNo)} · ` : ''}${matched}/${checked}개 일치${fieldText ? escapeHtml(fieldText) : ''}${when ? ` · ${escapeHtml(when)}` : ''}
      ${issues ? `<br>${escapeHtml(issues)}` : ''}
      ${rollbackLine ? `<br>${escapeHtml(rollbackLine)}` : ''}
    </div>
    ${rollbackAction}
  </div>`;
}

function renderFactoryCafe24SavePreview(factory) {
  const diff = factoryCafe24SaveDiffModel(factory);
  const importantRows = [...diff.changedRows, ...diff.newRows].slice(0, 12);
  const fallbackRows = !importantRows.length ? diff.rows.slice(0, 6) : [];
  const displayRows = importantRows.length ? importantRows : fallbackRows;
  const singleVerifyRow = diff.fieldNames.length === 1 ? diff.rows.find(row => row.apiField === diff.fieldNames[0]) : null;
  const singleVerifyNotice = diff.productNo && diff.fieldNames.length === 1 && singleVerifyRow
    ? `<div class="factory-cafe24-save-note">1필드 왕복 검증 대상: ${escapeHtml(singleVerifyRow.label)} · 현재값 "${escapeHtml(singleVerifyRow.currentText)}" → 저장값 "${escapeHtml(singleVerifyRow.nextText)}"</div>`
    : diff.productNo && diff.fieldNames.length > 1
    ? `<div class="factory-cafe24-save-note">1필드 왕복 검증은 정확히 1개 변경일 때만 실행됩니다. 현재 ${diff.fieldNames.length}개 변경이 있어 기본 저장만 가능합니다.</div>`
    : '';
  const emptyMessage = diff.productNo
    ? '현재 기존 Cafe24 상품의 기본 입력칸에서 변경된 값이 없습니다. 옵션/품목/재고, 카테고리, 이미지, 태그, SEO는 아래 전용 API 버튼에서 따로 저장합니다.'
    : '저장 대상 Cafe24 상품번호가 없습니다. 먼저 Cafe24 후보를 확정하거나 새 상품 등록 미리보기를 확인해주세요.';
  return `<div class="factory-cafe24-save-panel" data-factory-cafe24-save-preview>
    <div class="factory-cafe24-save-head">
      <div>
        <div class="factory-cafe24-save-title">Cafe24 저장 변경점</div>
        <div class="factory-cafe24-save-sub">${diff.productNo ? `기존 상품 #${escapeHtml(diff.productNo)} 수정 기준` : '새 상품 등록 또는 후보 확정 대기'} · 옵션/이미지/아이콘은 전용 API에서 따로 저장합니다.</div>
      </div>
      <span class="factory-db-source">전송 ${diff.counts.total}개</span>
    </div>
    <div class="factory-cafe24-save-stats">
      <div class="factory-cafe24-save-stat"><b>${diff.counts.changed}</b><span>현재값에서 변경</span></div>
      <div class="factory-cafe24-save-stat"><b>${diff.counts.newInput}</b><span>빈칸에 신규 입력</span></div>
      <div class="factory-cafe24-save-stat"><b>${diff.counts.same}</b><span>현재값과 동일</span></div>
      <div class="factory-cafe24-save-stat"><b>${diff.counts.dedicated}</b><span>전용 API 제외</span></div>
    </div>
    ${singleVerifyNotice}
    ${displayRows.length ? `<div class="factory-cafe24-change-list">
      <div class="factory-cafe24-change-row header">
        <span>입력칸</span><span>현재 Cafe24 값</span><span>저장할 값</span><span>상태</span>
      </div>
      ${displayRows.map(row => `<div class="factory-cafe24-change-row">
        <span class="factory-cafe24-change-label" title="${escAttr(row.apiField)}">${escapeHtml(row.label)}</span>
        <span class="factory-cafe24-change-value">${escapeHtml(row.currentText)}</span>
        <span class="factory-cafe24-change-value">${escapeHtml(row.nextText)}</span>
        <span class="factory-cafe24-change-status ${escAttr(row.status)}">${escapeHtml(factoryCafe24SaveDiffStatusLabel(row.status))}</span>
      </div>`).join('')}
      ${diff.rows.length > displayRows.length ? `<div class="factory-cafe24-save-sub">그 외 ${diff.rows.length - displayRows.length}개 필드는 저장 버튼 전 확인창에 요약됩니다.</div>` : ''}
    </div>` : `<div class="factory-source-missing">${escapeHtml(emptyMessage)}</div>`}
    ${diff.skipped.length ? `<div class="factory-cafe24-save-note">상품 기본정보 저장에서 제외됨: ${escapeHtml(diff.skipped.slice(0, 12).join(', '))}${diff.skipped.length > 12 ? ` 외 ${diff.skipped.length - 12}개` : ''}</div>` : ''}
    ${renderFactoryCafe24LastSaveVerification(factory.product.cafe24LastSaveVerification)}
  </div>`;
}

function factoryCafe24CreatePreviewModel(factory = factoryRuntimeReadFactory()) {
  const dbModel = factoryBuildDbReviewModel(factory);
  const product = factoryBuildCafe24UpdatePayload(dbModel.finalDb, dbModel.fields, factory);
  factoryAttachCafe24OptionsToProductPayload(product, factory, dbModel.finalDb);
  factoryAttachCafe24CategoryToProductPayload(product, factory);
  const optionPlan = factoryBuildCafe24OptionSyncPlan(factory, dbModel.finalDb);
  const postCreatePlan = factoryCafe24CreatePostSyncPlan(factory);
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = factoryCafe24RawForForm(factory);
  const productNo = target?.product_no || raw?.product_no || dbModel.finalDb.product_no || dbModel.finalDb.cafe24_product_no || '';
  const fieldNames = Object.keys(product || {});
  const requiredMissing = [];
  if (!String(product.product_name || '').trim()) requiredMissing.push('상품명');
  if (!String(product.price || '').trim()) requiredMissing.push('판매가');
  const categoryRows = Array.isArray(product.category) ? product.category : [];
  const optionValues = factoryDedupeRealOptionValues(optionPlan.optionValues || [], { allowNumeric: true });
  const optionSettingSummary = [
    product.has_option ? `사용: ${factoryCafe24SelectLabel({ value: product.has_option, label: CAFE24_FORM_SELECTS.hasOption.find(item => item.value === product.has_option)?.label || product.has_option })}` : '',
    product.option_type ? `구성: ${factoryCafe24SelectLabel({ value: product.option_type, label: CAFE24_FORM_SELECTS.optionType.find(item => item.value === product.option_type)?.label || product.option_type })}` : '',
    product.option_list_type ? `표시: ${factoryCafe24SelectLabel({ value: product.option_list_type, label: CAFE24_FORM_SELECTS.optionListType.find(item => item.value === product.option_list_type)?.label || product.option_list_type })}` : '',
    product.select_one_by_option ? `1개 선택: ${factoryCafe24SelectLabel({ value: product.select_one_by_option, label: CAFE24_FORM_SELECTS.selectOneByOption.find(item => item.value === product.select_one_by_option)?.label || product.select_one_by_option })}` : '',
  ].filter(Boolean).join(' / ');
  const rows = [
    { label: '상품명', value: product.product_name, required: true },
    { label: '판매가', value: product.price, required: true },
    { label: '소비자가', value: product.retail_price },
    { label: '공급가 / 원가', value: product.supply_price },
    {
      label: '카테고리',
      value: categoryRows.length
        ? `${categoryRows.length}개 선택됨`
        : '',
      required: false,
    },
    {
      label: '옵션',
      value: optionValues.length
        ? `${optionPlan.optionName || '옵션'} ${optionValues.length}개: ${optionValues.slice(0, 8).join(', ')}${optionValues.length > 8 ? ` 외 ${optionValues.length - 8}개` : ''}`
        : '',
    },
    {
      label: '옵션 설정',
      value: optionPlan.optionSettingsTouched || optionValues.length || optionSettingSummary ? optionSettingSummary : '',
    },
    {
      label: '추가 입력 옵션',
      value: product.use_additional_option === 'T'
        ? `${(product.additional_options || []).length}개`
        : '',
    },
    {
      label: '파일 첨부 옵션',
      value: product.use_attached_file_option === 'T' ? '사용함' : '',
    },
    {
      label: '등록 후 전용 API',
      value: postCreatePlan.readyActions.length
        ? postCreatePlan.readyActions.map(action => `${action.label} ${action.summary}`).join(', ')
        : '',
    },
  ];
  return {
    dbModel,
    product,
    productNo,
    fieldNames,
    requiredMissing,
    optionPlan,
    postCreatePlan,
    categoryRows,
    rows,
  };
}

function renderFactoryCafe24CreatePreview(factory) {
  const model = factoryCafe24CreatePreviewModel(factory);
  const blockedByExistingProduct = !!model.productNo;
  const ready = !blockedByExistingProduct && !model.requiredMissing.length && model.fieldNames.length > 0;
  const fieldSummary = model.fieldNames
    .slice(0, 12)
    .map(key => factoryCafe24FieldLabelByApiField(key))
    .filter(Boolean)
    .join(', ');
  const visibleRows = model.rows.filter(row => row.required || String(row.value || '').trim());
  return `<div class="factory-cafe24-save-panel ${ready ? '' : 'warn'}" data-factory-cafe24-create-preview>
    <div class="factory-cafe24-save-head">
      <div>
        <div class="factory-cafe24-save-title">Cafe24 새 상품 등록 미리보기</div>
        <div class="factory-cafe24-save-sub">
          새 상품 등록 버튼이 전송할 값입니다. 상품 기본값은 등록 payload에 넣고, 이미지/SEO/태그/메모/진열은 등록 성공 후 전용 API로 이어서 보냅니다.
          ${model.productNo ? `<br>현재 기존 상품 #${escapeHtml(model.productNo)}이 선택되어 있습니다. 복제 등록이 아니라 수정하려면 'Cafe24 기본 저장' 또는 전용 동기화 버튼을 사용하세요.` : ''}
        </div>
      </div>
      <span class="factory-db-source">${ready ? '등록 가능' : (blockedByExistingProduct ? '기존 상품 선택됨' : '필수값 대기')}</span>
    </div>
    <div class="factory-cafe24-save-stats">
      <div class="factory-cafe24-save-stat"><b>${model.fieldNames.length}</b><span>상품 기본 입력값</span></div>
      <div class="factory-cafe24-save-stat"><b>${model.optionPlan.optionValueTotal || 0}</b><span>옵션값</span></div>
      <div class="factory-cafe24-save-stat"><b>${model.categoryRows.length}</b><span>카테고리</span></div>
      <div class="factory-cafe24-save-stat"><b>${model.postCreatePlan.readyActions.length}</b><span>등록 후 전용 API</span></div>
    </div>
    ${model.requiredMissing.length
      ? `<div class="factory-cafe24-save-note">새 상품 등록 필수값 누락: ${escapeHtml(model.requiredMissing.join(', '))}. 아래 Cafe24 상품 입력판에서 먼저 채워주세요.</div>`
      : ''}
    ${blockedByExistingProduct
      ? `<div class="factory-cafe24-save-note">현재 기존 Cafe24 상품 #${escapeHtml(model.productNo)}이 선택되어 있어 새 상품 등록은 잠갔습니다. 이 상품을 수정하려면 'Cafe24 기본 저장' 또는 아래 전용 동기화 버튼을 사용하세요.</div>`
      : ''}
    <div class="factory-cafe24-change-list">
      <div class="factory-cafe24-change-row header">
        <span>입력 항목</span><span>등록할 값</span><span>확인</span><span>상태</span>
      </div>
      ${visibleRows.map(row => {
        const empty = !String(row.value || '').trim();
        return `<div class="factory-cafe24-change-row">
          <span class="factory-cafe24-change-label">${escapeHtml(row.label)}</span>
          <span class="factory-cafe24-change-value">${escapeHtml(factoryCafe24HumanValue(row.value, 120))}</span>
          <span class="factory-cafe24-change-value">${row.required ? '필수' : '선택'}</span>
          <span class="factory-cafe24-change-status ${empty ? 'changed' : 'new'}">${empty ? '대기' : '준비'}</span>
        </div>`;
      }).join('')}
    </div>
    ${fieldSummary
      ? `<div class="factory-cafe24-save-sub">등록 기본 필드: ${escapeHtml(fieldSummary)}${model.fieldNames.length > 12 ? ` 외 ${model.fieldNames.length - 12}개` : ''}</div>`
      : `<div class="factory-source-missing">등록할 기본 필드가 없습니다. 상품명/판매가부터 채워주세요.</div>`}
  </div>`;
}

function renderFactoryCafe24CoverageCard(title, items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const tone = options.tone || '';
  const emptyText = options.emptyText || '없음';
  const max = Number.isFinite(options.max) ? options.max : 10;
  const summaryOnly = options.summaryOnly === true;
  return `<div class="factory-cafe24-coverage-card ${escAttr(tone)}">
    <div class="factory-cafe24-coverage-name">${escapeHtml(title)}</div>
    <div class="factory-cafe24-coverage-count">${list.length}</div>
    ${summaryOnly
      ? `<div class="factory-cafe24-coverage-chiprow"><span class="factory-cafe24-coverage-chip">${list.length ? '배정 완료' : escapeHtml(emptyText)}</span></div>`
      : `<div class="factory-cafe24-coverage-chiprow">
        ${list.length
          ? list.slice(0, max).map(key => `<span class="factory-cafe24-coverage-chip" title="${escAttr(key)}">${escapeHtml(factoryCafe24CoverageLabel(key))}</span>`).join('')
          : `<span class="factory-cafe24-coverage-chip">${escapeHtml(emptyText)}</span>`}
        ${list.length > max ? `<span class="factory-cafe24-coverage-chip">외 ${list.length - max}개</span>` : ''}
      </div>`}
  </div>`;
}

function renderFactoryCafe24CoveragePanel(factory) {
  const coverage = factoryCafe24ProductFieldCoverage(factory);
  const unknownTone = coverage.buckets.unknown.length ? 'error' : '';
  return `<div class="factory-cafe24-coverage" data-factory-cafe24-coverage>
    <div class="factory-cafe24-coverage-head">
      <div>
        <div class="factory-cafe24-coverage-title">Cafe24 API 필드 배정 점검</div>
        <div class="factory-cafe24-coverage-sub">
          원본 상품 필드 ${coverage.total}개 중 ${coverage.covered}개를 입력판/전용 API/읽기전용으로 배정했습니다.
          값 자체는 여기서 덤프하지 않고, 실제 수정은 아래 한글 입력칸과 전용 패널에서 합니다.
        </div>
      </div>
      <span class="factory-db-source">입력칸 ${coverage.visibleFieldCount}개</span>
    </div>
    <div class="factory-cafe24-coverage-grid">
      ${renderFactoryCafe24CoverageCard('상품등록/수정 입력칸', coverage.buckets.form, { summaryOnly: true })}
      ${renderFactoryCafe24CoverageCard('전용 API로 분리', coverage.buckets.dedicated, { tone: 'warn', summaryOnly: true })}
      ${renderFactoryCafe24CoverageCard('Cafe24 읽기전용/시스템', coverage.buckets.readonly, { summaryOnly: true })}
      ${renderFactoryCafe24CoverageCard('아직 미분류', coverage.buckets.unknown, { tone: unknownTone, emptyText: '미분류 없음', summaryOnly: true })}
    </div>
    ${coverage.buckets.unknown.length
      ? `<div class="factory-source-missing">미분류 ${coverage.buckets.unknown.length}개가 남았습니다. 시스템 코드값을 화면에 덤프하지 않고, 다음 보강 때 관리자 입력칸/전용 API 중 어디에 둘지만 정리합니다.</div>`
      : `<div class="factory-source-sub">선택 상품 API 필드가 모두 배정되어 있습니다. 시스템 코드값은 입력판에 직접 노출하지 않습니다.</div>`}
  </div>`;
}

function factoryCafe24VisibleTechnicalLeaks(factory = factoryRuntimeReadFactory()) {
  const visibleSections = factoryCafe24VisibleSections(FACTORY_CAFE24_FIELD_SECTIONS);
  const model = factoryBuildSourcePanelModel(factory, 'cafe24', visibleSections);
  const leaks = [];
  model.sections.forEach(section => {
    section.fields.forEach(field => {
      const value = String(field.value || '').trim();
      if (!value) return;
      if (field.selectOptions) {
        const selected = factoryCafe24SelectOptionValue(value, field.selectOptions);
        const known = field.selectOptions.some(option => String(option.value ?? '').trim() === String(selected).trim());
        if (selected && !known) leaks.push(`${field.label}: 알 수 없는 선택값 ${selected}`);
        return;
      }
      if (field.referenceType) {
        const selected = factoryCafe24ReferenceSelectedValue(field, value, factory);
        const refs = factoryCafe24ReferenceList(field.referenceType, factory);
        const known = refs.some(item => String(item.code) === String(selected));
        if (selected && !known && !factoryCafe24HasExplicitReferenceList(field.referenceType, factory)) return;
        if (selected && !known) leaks.push(`${field.label}: 선택 목록에 없는 값 ${selected}`);
        return;
      }
      const idText = `${field.id || ''} ${field.dbFieldId || ''} ${field.apiField || ''}`;
      if (/^(raw|source|connector|matched|match_|gpt_)/i.test(idText)) {
        leaks.push(field.label);
        return;
      }
      if (/^[\[{]/.test(value) && !/additional|information|shipping_rates|size_guide|product_volume|expiration/i.test(idText)) {
        leaks.push(field.label);
        return;
      }
      if (/^(T|F|Y|N|C|S|A|B|O|P|D|R|M)$/i.test(value) && !/코드|HS|분류|원산지|통관/i.test(field.label || '')) {
        leaks.push(field.label);
      }
    });
  });
  const optionModel = factoryCafe24OptionEditorModel(factory, model);
  optionModel.editGroups.forEach(group => {
    (group.values || []).forEach(value => {
      const cleaned = factoryCleanRealOptionValue(value);
      if (!cleaned || cleaned !== value) leaks.push(`옵션값:${value}`);
    });
  });
  return [...new Set(leaks)].slice(0, 20);
}

function factoryCafe24InputRouteAudit(factory = factoryRuntimeReadFactory()) {
  const visibleSections = factoryCafe24VisibleSections(FACTORY_CAFE24_FIELD_SECTIONS);
  const visibleFields = visibleSections.flatMap(section => section.fields.map(field => ({ ...field, sectionTitle: section.title })));
  const result = {
    total: visibleFields.length,
    product: 0,
    dedicated: 0,
    none: [],
  };
  visibleFields.forEach(field => {
    const route = factoryCafe24FieldRouteInfo(field, 'cafe24');
    if (route.tone === 'product') result.product += 1;
    else if (route.tone === 'dedicated') result.dedicated += 1;
    else result.none.push({
      id: field.id || '',
      apiField: field.apiField || '',
      label: field.label || field.id || '',
      sectionTitle: field.sectionTitle || '',
    });
  });
  return result;
}

function renderFactoryCafe24AdminGuard(factory) {
  const visibleSections = factoryCafe24VisibleSections(FACTORY_CAFE24_FIELD_SECTIONS);
  const visibleFields = visibleSections.flatMap(section => section.fields);
  const routeAudit = factoryCafe24InputRouteAudit(factory);
  const optionModel = factoryCafe24OptionEditorModel(factory, factoryBuildSourcePanelModel(factory, 'cafe24', visibleSections));
  const optionValueTotal = optionModel.editGroups.reduce((sum, group) => sum + (group.values || []).length, 0);
  const coverage = factoryCafe24ProductFieldCoverage(factory);
  const leaks = factoryCafe24VisibleTechnicalLeaks(factory);
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target);
  const productNo = target?.product_no || raw.product_no || '';
  const referenceReady = factoryCafe24ReferenceListsReady(factory);
  const referenceLoading = !!factory.product.cafe24ReferenceLoading;
  const referenceMessage = !referenceReady
    ? (referenceLoading
      ? '한글 선택목록을 불러오는 중입니다. 목록이 도착하면 카테고리/제조사/공급사/브랜드 코드가 한글명으로 다시 표시됩니다.'
      : '한글 선택목록이 아직 없습니다. 기본 코드값은 한글 라벨로 임시 표시하고, 카테고리는 목록을 불러온 뒤 검수합니다.')
    : '';
  return `<div class="factory-cafe24-admin-guard ${leaks.length ? 'warn' : ''}">
    <div class="factory-cafe24-admin-guard-head">
      <div>
        <div class="factory-cafe24-admin-guard-title">Cafe24 관리자 입력판 기준</div>
        <div class="factory-cafe24-admin-guard-sub">
          상품등록/수정 화면에서 직접 채우는 칸만 아래에 표시합니다. 옵션, 품목/재고, 이미지, 아이콘, 카테고리는 전용 API 패널에서 따로 동기화합니다.
        </div>
      </div>
      <span class="factory-db-source">${productNo ? `상품 #${escapeHtml(productNo)}` : '상품번호 대기'}</span>
    </div>
    <div class="factory-cafe24-admin-guard-grid">
      <div class="factory-cafe24-admin-guard-chip"><b>${visibleFields.length}</b><span>관리자 입력칸</span></div>
      <div class="factory-cafe24-admin-guard-chip"><b>${routeAudit.product}</b><span>상품 기본 저장</span></div>
      <div class="factory-cafe24-admin-guard-chip"><b>${routeAudit.dedicated}</b><span>전용 저장칸</span></div>
      <div class="factory-cafe24-admin-guard-chip ${routeAudit.none.length ? 'warn' : ''}"><b>${routeAudit.none.length}</b><span>저장 경로 없음</span></div>
      <div class="factory-cafe24-admin-guard-chip"><b>${optionValueTotal}</b><span>공식 옵션값</span></div>
      <div class="factory-cafe24-admin-guard-chip"><b>${coverage.buckets.dedicated.length}</b><span>전용 API 분리</span></div>
      <div class="factory-cafe24-admin-guard-chip ${coverage.buckets.unknown.length ? 'warn' : ''}"><b>${coverage.buckets.unknown.length}</b><span>미분류 시스템값</span></div>
      <div class="factory-cafe24-admin-guard-chip"><b>${referenceReady ? '완료' : '대기'}</b><span>한글 선택목록</span></div>
    </div>
    ${routeAudit.none.length
      ? `<div class="factory-cafe24-admin-guard-alert">저장 경로가 아직 없는 입력칸: ${escapeHtml(routeAudit.none.map(row => `${row.sectionTitle} / ${row.label}`).slice(0, 8).join(', '))}${routeAudit.none.length > 8 ? ` 외 ${routeAudit.none.length - 8}개` : ''}</div>`
      : ''}
    ${referenceMessage ? `<div class="factory-source-sub">${escapeHtml(referenceMessage)}</div>` : ''}
    ${leaks.length
      ? `<div class="factory-cafe24-admin-guard-alert">입력판에 기술값처럼 보이는 항목이 남아 있습니다: ${escapeHtml(leaks.join(', '))}</div>`
      : `<div class="factory-source-sub">옵션값은 공식 옵션 API의 텍스트만 사용 중입니다. T/F/C/S 같은 설정값과 품목코드는 옵션값 목록에 섞지 않습니다.</div>`}
  </div>`;
}

function renderFactoryCafe24RouteCard(title, endpoint, summary, ready) {
  return `<div class="factory-cafe24-route-card ${ready ? 'ready' : 'wait'}">
    <div class="factory-cafe24-route-name">${escapeHtml(title)}</div>
    <div class="factory-cafe24-route-endpoint">${escapeHtml(endpoint)}</div>
    <div class="factory-cafe24-route-summary">${escapeHtml(summary)}</div>
  </div>`;
}

function renderFactoryCafe24SyncResultCard(record) {
  if (!record || typeof record !== 'object') return '';
  const tone = record.error ? 'error' : (record.ok ? '' : 'warn');
  const badge = record.error ? '오류' : (record.ok ? '재조회 확인' : '확인 필요');
  const when = record.syncedAt ? new Date(record.syncedAt).toLocaleString() : '';
  const body = [
    record.productNo ? `상품 #${record.productNo}` : '',
    record.summary || '',
    record.detail || '',
    record.error ? `오류: ${record.error}` : '',
    record.endpoint ? `경로: ${record.endpoint}` : '',
    when ? `시각: ${when}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="factory-cafe24-sync-result-card ${tone}">
    <div class="factory-cafe24-sync-result-head">
      <div class="factory-cafe24-sync-result-name">${escapeHtml(record.label || record.key || '동기화')}</div>
      <span class="factory-cafe24-sync-result-badge">${escapeHtml(badge)}</span>
    </div>
    <div class="factory-cafe24-sync-result-body">${escapeHtml(body || '아직 기록 없음')}</div>
  </div>`;
}

function renderFactoryCafe24SyncResultPanel(factory = factoryRuntimeReadFactory()) {
  const results = factory.product.cafe24SyncResults && typeof factory.product.cafe24SyncResults === 'object'
    ? factory.product.cafe24SyncResults
    : {};
  const ordered = ['product', 'readyAll', 'postCreate', 'category', 'options', 'images', 'additionalImages', 'icons', 'seo', 'tags', 'relations', 'memos', 'mains']
    .map(key => results[key])
    .filter(Boolean);
  if (!ordered.length) return `<div class="factory-source-sub" style="margin-top:8px">전용 API 동기화 기록은 아직 없습니다. 옵션/이미지/카테고리 동기화를 실행하면 재조회 결과가 여기에 남습니다.</div>`;
  return `<div class="factory-cafe24-sync-result-grid">
    ${ordered.map(renderFactoryCafe24SyncResultCard).join('')}
  </div>`;
}

function factoryCafe24ReadySyncPlan(factory = factoryRuntimeReadFactory(), options = {}) {
  const dbModel = options.dbModel || factoryBuildDbReviewModel(factory);
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target);
  const productNo = target?.product_no || raw.product_no || dbModel.finalDb.product_no || dbModel.finalDb.cafe24_product_no || '';
  const productPayload = options.productPayload || factoryBuildCafe24UpdatePayload(dbModel.finalDb, dbModel.fields, factory, { onlyChanged: true });
  const optionModel = options.optionModel || factoryCafe24OptionEditorModel(factory);
  const optionPlan = factoryBuildCafe24OptionSyncPlan(factory, dbModel.finalDb, optionModel);
  const categoryRows = factorySelectedCafe24CategoryRows(factory, dbModel.finalDb);
  const imagePayload = factoryCafe24ImagePayload(factory);
  const imageSlotCount = FACTORY_CAFE24_IMAGE_SLOTS.filter(slot => imagePayload[slot.key]).length;
  const additionalCount = factoryCafe24AdditionalImagesPayload(factory).length;
  const additionalImagesBlockedReason = factoryCafe24EndpointDisabledReason(factory, 'additionalImages', '추가 이미지 API', productNo);
  const iconCount = factoryCafe24IconPayload(factory).image_list.length;
  const categoryTouched = factoryCafe24CategoryTouched(factory);
  const iconTouched = factoryCafe24IconTouched(factory);
  const seoPlan = factoryCafe24SeoPayload(factory);
  const tagPlan = factoryCafe24TagsPayload(factory);
  const relationPlan = factoryCafe24RelationPayload(factory);
  const memoPlan = factoryCafe24MemoPayload(factory);
  const mainPlan = factoryCafe24MainPayload(factory);
  const englishShopNamePlan = factoryCafe24EnglishShopNameSyncPlan(factory);
  const actions = [
    {
      key: 'product',
      label: '상품 기본정보',
      ready: !!productNo && Object.keys(productPayload).length > 0,
      summary: `${Object.keys(productPayload).length}개 필드`,
    },
    {
      key: 'category',
      label: '카테고리 연결',
      ready: !!productNo && categoryRows.length > 0,
      summary: categoryTouched ? `${categoryRows.length}개 분류 · 직접 수정` : `${categoryRows.length}개 분류 · 원본/DB 기준`,
    },
    {
      key: 'options',
      label: '옵션/품목/재고',
      ready: !!productNo && optionPlan.hasChanges,
      summary: optionPlan.optionSettingsOnly
        ? `옵션 설정/부가옵션 · 추가입력 ${optionPlan.optionExtras?.additionalOptions?.length || 0}개`
        : `옵션값 ${optionPlan.optionValueTotal || 0}개 · 추가입력 ${optionPlan.optionExtras?.additionalOptions?.length || 0}개 · 품목 ${optionPlan.variantUpdates.length}건`,
    },
    {
      key: 'images',
      label: '상품 이미지',
      ready: !!productNo && imageSlotCount > 0,
      summary: `${imageSlotCount}개 슬롯`,
    },
    {
      key: 'additionalImages',
      label: '추가 이미지',
      ready: !!productNo && additionalCount > 0 && !additionalImagesBlockedReason,
      summary: additionalImagesBlockedReason ? `${additionalCount}장 · API 점검 실패` : `${additionalCount}장`,
    },
    {
      key: 'icons',
      label: '상품 아이콘',
      ready: !!productNo && iconTouched && iconCount > 0,
      summary: `${iconCount}개`,
    },
    {
      key: 'seo',
      label: '검색엔진 SEO',
      ready: !!productNo && !!seoPlan,
      summary: seoPlan ? '수정값 준비됨' : '대기',
    },
    {
      key: 'englishShopName',
      label: '영문 쇼핑몰 상품명',
      ready: !!productNo && englishShopNamePlan.ready,
      summary: englishShopNamePlan.available ? `shop_no ${englishShopNamePlan.shopNo} · ${englishShopNamePlan.summary}` : '영문상품명 없음',
    },
    {
      key: 'tags',
      label: '상품 태그',
      ready: !!productNo && !!tagPlan && (tagPlan.add.length > 0 || tagPlan.remove.length > 0),
      summary: tagPlan ? `추가 ${tagPlan.add.length}개 · 삭제 ${tagPlan.remove.length}개` : '대기',
    },
    {
      key: 'relations',
      label: '관련상품',
      ready: !!productNo && !!relationPlan.payload && relationPlan.rows.length > 0,
      summary: `${relationPlan.rows.length}개`,
    },
    {
      key: 'memos',
      label: '관리 메모',
      ready: !!productNo && !!memoPlan,
      summary: memoPlan ? '작성자/메모 입력됨' : '대기',
    },
    {
      key: 'mains',
      label: '메인 진열',
      ready: !!productNo && !!mainPlan,
      summary: mainPlan ? `진열 #${mainPlan.displayGroup}` : '대기',
    },
  ];
  const readyActions = actions.filter(action => action.ready);
  const blockers = [];
  if (!productNo) blockers.push('Cafe24 상품번호가 없어 기존 상품 동기화를 실행할 수 없습니다.');
  if (productNo && !readyActions.length) blockers.push('동기화할 값이 아직 준비되지 않았습니다.');
  if (additionalImagesBlockedReason && additionalCount > 0) blockers.push(additionalImagesBlockedReason);
  return {
    productNo,
    actions,
    readyActions,
    blockers,
    productPayload,
    optionPlan,
    categoryRows,
    imageSlotCount,
    additionalCount,
    additionalImagesBlockedReason,
    iconCount,
    seoPlan,
    englishShopNamePlan,
    tagPlan,
    relationPlan,
    memoPlan,
    mainPlan,
  };
}

function factoryCafe24CreatePostSyncPlan(factory = factoryRuntimeReadFactory()) {
  const imagePayload = factoryCafe24ImagePayload(factory);
  const imageSlotCount = FACTORY_CAFE24_IMAGE_SLOTS.filter(slot => imagePayload[slot.key]).length;
  const additionalCount = factoryCafe24AdditionalImagesPayload(factory).length;
  const { productNo } = factoryCafe24TargetInfo(factory);
  const additionalImagesBlockedReason = factoryCafe24EndpointDisabledReason(factory, 'additionalImages', '추가 이미지 API', productNo);
  const iconPayload = factoryCafe24IconPayload(factory);
  const iconCount = iconPayload.image_list.length;
  const seoPlan = factoryCafe24SeoChanged(factory) ? factoryCafe24SeoPayload(factory) : null;
  const englishShopNamePlan = factoryCafe24EnglishShopNameSyncPlan(factory);
  const tagPlan = factoryCafe24TagsPayload(factory);
  const relationPlan = factoryCafe24RelationPayload(factory);
  const memoPlan = factoryCafe24MemoPayload(factory);
  const mainDraft = factoryCafe24MainDraft(factory);
  const dbModel = factoryBuildDbReviewModel(factory);
  const optionPlan = factoryBuildCafe24OptionSyncPlan(factory, dbModel.finalDb);
  const categoryRows = factorySelectedCafe24CategoryRows(factory, dbModel.finalDb);
  const actions = [
    {
      key: 'category',
      label: '카테고리 연결',
      ready: categoryRows.length > 0,
      summary: `${categoryRows.length}개 분류`,
    },
    {
      key: 'options',
      label: '옵션/품목/재고',
      ready: optionPlan.hasChanges || optionPlan.inventoryUpdates.length > 0,
      summary: `옵션값 ${optionPlan.optionValueTotal || 0}개 · 재고 ${optionPlan.inventoryUpdates.length || 0}건`,
    },
    {
      key: 'images',
      label: '상품 이미지',
      ready: imageSlotCount > 0,
      summary: `${imageSlotCount}개 슬롯`,
    },
    {
      key: 'additionalImages',
      label: '추가 이미지',
      ready: additionalCount > 0 && !additionalImagesBlockedReason,
      summary: additionalImagesBlockedReason ? `${additionalCount}장 · API 점검 실패` : `${additionalCount}장`,
    },
    {
      key: 'icons',
      label: '상품 아이콘',
      ready: factoryCafe24IconTouched(factory) && iconCount > 0,
      summary: `${iconCount}개`,
    },
    {
      key: 'seo',
      label: '검색엔진 SEO',
      ready: !!seoPlan,
      summary: seoPlan ? '수정값 준비됨' : '대기',
    },
    {
      key: 'englishShopName',
      label: '영문 쇼핑몰 상품명',
      ready: englishShopNamePlan.ready,
      summary: englishShopNamePlan.available ? `shop_no ${englishShopNamePlan.shopNo} · ${englishShopNamePlan.summary}` : '영문상품명 없음',
    },
    {
      key: 'tags',
      label: '상품 태그',
      ready: !!tagPlan && (tagPlan.add.length > 0 || tagPlan.remove.length > 0),
      summary: tagPlan ? `추가 ${tagPlan.add.length}개 · 삭제 ${tagPlan.remove.length}개` : '대기',
    },
    {
      key: 'relations',
      label: '관련상품',
      ready: !!relationPlan.payload && relationPlan.rows.length > 0,
      summary: `${relationPlan.rows.length}개`,
    },
    {
      key: 'memos',
      label: '관리 메모',
      ready: !!memoPlan,
      summary: memoPlan ? '작성자/메모 입력됨' : '대기',
    },
    {
      key: 'mains',
      label: '메인 진열',
      ready: !!mainDraft.touched && !!String(mainDraft.displayGroup || '').trim(),
      summary: mainDraft.touched && mainDraft.displayGroup ? `진열 #${mainDraft.displayGroup}` : '대기',
    },
  ];
  return {
    actions,
    readyActions: actions.filter(action => action.ready),
    imageSlotCount,
    additionalCount,
    iconCount,
    seoPlan,
    englishShopNamePlan,
    tagPlan,
    relationPlan,
    memoPlan,
    mainDraft,
    optionPlan,
    categoryRows,
  };
}

function renderFactoryCafe24ReadySyncPanel(factory = factoryRuntimeReadFactory(), options = {}) {
  const plan = factoryCafe24ReadySyncPlan(factory);
  const buttonId = options.buttonId || 'factorySyncCafe24ReadyAll';
  const actionText = plan.readyActions.length
    ? plan.readyActions.map(action => `${action.label} ${action.summary}`).join(' · ')
    : '준비된 동기화 항목 없음';
  const disabled = !plan.productNo || !plan.readyActions.length;
  return `<div class="factory-cafe24-admin-guard compact">
    <div>
      <b>Cafe24 준비 항목 전체 동기화</b>
      <p>개별 저장 버튼과 같은 API를 사용하되, 한 번 확인한 뒤 준비된 항목만 순서대로 실행합니다.</p>
      <div class="factory-source-sub">${escapeHtml(actionText)}</div>
      ${plan.blockers.length ? `<div class="factory-source-missing">${escapeHtml(plan.blockers.join(' '))}</div>` : ''}
    </div>
    <button class="btn-sm primary" id="${escAttr(buttonId)}" type="button" ${disabledAttr(disabled, plan.blockers.join(' '))}>
      <span class="material-icons-outlined" style="font-size:14px">sync</span>준비 항목 전체 동기화
    </button>
  </div>`;
}

function renderFactoryCafe24EndpointHealthPanel(factory = factoryRuntimeReadFactory()) {
  const rows = Array.isArray(factory.product?.cafe24EndpointHealth) ? factory.product.cafe24EndpointHealth : [];
  const productNo = factory.product?.cafe24EndpointHealthProductNo || factoryCafe24TargetInfo(factory).productNo || '';
  const checkedAt = factory.product?.cafe24EndpointHealthFetchedAt;
  if (!rows.length) {
    return `<div class="factory-cafe24-health">
      <div class="factory-cafe24-health-head">
        <div>
          <div class="factory-cafe24-health-title">전용 API 연결 상태</div>
          <div class="factory-cafe24-health-sub">이 영역은 후보 검색용이 아니라 확정된 Cafe24 상품을 저장/동기화할 때 쓰는 별도 경로 점검입니다. 후보는 위의 Cafe24 후보만 찾기로 먼저 고릅니다.</div>
        </div>
        <span class="factory-db-source">${productNo ? `상품 #${escapeHtml(productNo)}` : '상품번호 대기'}</span>
      </div>
    </div>`;
  }
  const okCount = rows.filter(row => row.ok && !row.warning).length;
  return `<div class="factory-cafe24-health" data-factory-cafe24-endpoint-health>
    <div class="factory-cafe24-health-head">
      <div>
        <div class="factory-cafe24-health-title">전용 API 연결 상태 ${okCount}/${rows.length}</div>
        <div class="factory-cafe24-health-sub">후보 검색과 별개인 저장/동기화 경로입니다. 조회는 읽기 전용이고, 실패한 경로는 저장 버튼과 전체 동기화에서 자동 제외합니다.${checkedAt ? ` 마지막 ${escapeHtml(new Date(checkedAt).toLocaleString())}` : ''}</div>
      </div>
      <span class="factory-db-source">${productNo ? `상품 #${escapeHtml(productNo)}` : '상품번호 대기'}</span>
    </div>
    <div class="factory-cafe24-health-grid">
      ${rows.map(row => {
        const cls = row.warning ? 'wait' : (row.pending ? 'wait' : (row.ok ? 'ok' : 'fail'));
        const savePath = row.savePath ? `저장: ${row.savePath}` : '';
        return `<div class="factory-cafe24-health-chip ${cls}">
          <div class="factory-cafe24-health-label">${escapeHtml(row.label || row.key || 'API')}</div>
          <div class="factory-cafe24-health-path">${escapeHtml(row.path || '상품번호 대기')}</div>
          <div class="factory-cafe24-health-message">${escapeHtml(row.status || (row.ok ? '연결됨' : '대기'))} · ${escapeHtml(row.message || '')}${savePath ? `<br>${escapeHtml(savePath)}` : ''}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderFactoryCafe24SyncRoutePanel(factory) {
  const plan = factoryCafe24ReadySyncPlan(factory);
  const dbModel = factoryBuildDbReviewModel(factory);
  const productNo = plan.productNo;
  const productPayload = plan.productPayload;
  const optionPlan = plan.optionPlan;
  const categoryRows = plan.categoryRows;
  const imageSlotCount = plan.imageSlotCount;
  const additionalCount = plan.additionalCount;
  const additionalImagesBlockedReason = plan.additionalImagesBlockedReason;
  const iconCount = plan.iconCount;
  const seoPlan = plan.seoPlan;
  const tagPlan = plan.tagPlan;
  const relationPlan = plan.relationPlan;
  const memoPlan = plan.memoPlan;
  const mainPlan = plan.mainPlan;
  const categoryTouched = factoryCafe24CategoryTouched(factory);
  const iconTouched = factoryCafe24IconTouched(factory);
  const postCreatePlan = factoryCafe24CreatePostSyncPlan(factory);
  const postCreateReady = key => postCreatePlan.readyActions.some(action => action.key === key);
  const readySync = key => plan.readyActions.some(action => action.key === key);
  const optionExtraText = `추가입력 ${optionPlan.optionExtras?.useAdditionalOption === 'T' ? `${optionPlan.optionExtras.additionalOptions.length}개` : '사용안함'} · 파일첨부 ${optionPlan.optionExtras?.useAttachedFileOption === 'T' ? '사용함' : '사용안함'}`;
  const productEndpoint = productNo ? `PUT /api/v2/admin/products/${productNo}` : 'POST /api/v2/admin/products';
  return `<div class="factory-cafe24-coverage" data-factory-cafe24-sync-routes>
    <div class="factory-cafe24-coverage-head">
      <div>
        <div class="factory-cafe24-coverage-title">Cafe24 동기화 경로</div>
        <div class="factory-cafe24-coverage-sub">상품 기본 저장과 옵션/품목/재고/이미지/아이콘/카테고리를 서로 다른 API로 분리해서 전송합니다.</div>
      </div>
      <span class="factory-db-source">${productNo ? `상품 #${escapeHtml(productNo)}` : '상품번호 대기'}</span>
    </div>
    ${renderFactoryCafe24ReadySyncPanel(factory, { buttonId: 'factorySyncCafe24ReadyAllRoute' })}
    <div class="factory-cafe24-route-grid">
      ${renderFactoryCafe24RouteCard(
        '상품 기본정보',
        productEndpoint,
        `전송 예정 ${Object.keys(productPayload).length}개 필드 · 옵션/이미지/아이콘 제외`,
        Object.keys(productPayload).length > 0
      )}
      ${renderFactoryCafe24RouteCard(
        '옵션 구조',
        productNo ? `PUT /api/v2/admin/products/${productNo}/options` : '새 상품 등록 payload options',
        `옵션그룹 ${optionPlan.optionGroupCount || 0}개 · 옵션값 ${optionPlan.optionValueTotal || 0}개 · ${optionExtraText}`,
        productNo ? !!optionPlan.optionUpdate : (optionPlan.optionValueTotal > 0 || optionPlan.optionExtrasTouched)
      )}
      ${renderFactoryCafe24RouteCard(
        '품목 / 재고',
        productNo ? `PUT /variants/{품목코드}, PUT /inventories` : '기존 상품번호 필요',
        `품목 수정 ${optionPlan.variantUpdates.length}건 · 재고 수정 ${optionPlan.inventoryUpdates.length}건`,
        !!productNo && (optionPlan.variantUpdates.length > 0 || optionPlan.inventoryUpdates.length > 0)
      )}
      ${renderFactoryCafe24RouteCard(
        '카테고리 연결',
        productNo ? `POST /api/v2/admin/categories/{분류번호}/products` : '새 상품 등록 payload category',
        `선택 분류 ${categoryRows.length}개`,
        productNo ? (!!categoryTouched && categoryRows.length > 0) : categoryRows.length > 0
      )}
      ${renderFactoryCafe24RouteCard(
        '상품 이미지',
        productNo ? `POST /api/v2/admin/products/${productNo}/images` : '등록 성공 후 POST /products/{상품번호}/images',
        `업로드 준비 슬롯 ${imageSlotCount}개`,
        productNo ? imageSlotCount > 0 : postCreateReady('images')
      )}
      ${renderFactoryCafe24RouteCard(
        '추가 이미지 / 아이콘',
        productNo ? `POST|PUT /additionalimages · PUT /icons` : '등록 성공 후 additionalimages/icons 자동 실행',
        `추가 이미지 ${additionalCount}장${additionalImagesBlockedReason ? ' · API 점검 필요' : ''} · 아이콘 ${iconCount}개`,
        productNo ? (readySync('additionalImages') || readySync('icons')) : (postCreateReady('additionalImages') || postCreateReady('icons'))
      )}
      ${renderFactoryCafe24RouteCard(
        '검색엔진 SEO',
        productNo ? `PUT /api/v2/admin/products/${productNo}/seo` : '등록 성공 후 PUT /products/{상품번호}/seo',
        seoPlan ? 'SEO 수정값 준비됨' : 'SEO 수정값 대기',
        productNo ? !!seoPlan : postCreateReady('seo')
      )}
      ${renderFactoryCafe24RouteCard(
        '상품 태그',
        productNo ? `POST|DELETE /api/v2/admin/products/${productNo}/tags` : '등록 성공 후 POST /products/{상품번호}/tags',
        tagPlan ? `추가 ${tagPlan.add.length}개 · 삭제 ${tagPlan.remove.length}개` : '태그 수정값 대기',
        productNo ? (!!tagPlan && (tagPlan.add.length > 0 || tagPlan.remove.length > 0)) : postCreateReady('tags')
      )}
      ${renderFactoryCafe24RouteCard(
        '관련상품',
        productNo ? `PUT /api/v2/admin/products/${productNo}` : '등록 성공 후 PUT /products/{상품번호}',
        `관련상품 ${relationPlan.rows.length}개 · relational_product 전용 저장`,
        productNo ? (!!relationPlan.payload && relationPlan.rows.length > 0) : postCreateReady('relations')
      )}
      ${renderFactoryCafe24RouteCard(
        '관리 메모',
        productNo ? `POST|PUT /api/v2/admin/products/${productNo}/memos` : '등록 성공 후 POST /products/{상품번호}/memos',
        memoPlan ? '작성자/메모 입력됨' : '메모 입력 대기',
        productNo ? !!memoPlan : postCreateReady('memos')
      )}
      ${renderFactoryCafe24RouteCard(
        '메인 진열',
        mainPlan ? `POST /api/v2/admin/mains/${mainPlan.displayGroup}/products` : (postCreateReady('mains') ? '등록 성공 후 POST /mains/{진열번호}/products' : '메인 진열 번호 대기'),
        mainPlan ? `진열 #${mainPlan.displayGroup}` : (postCreateReady('mains') ? '등록 후 현재 상품 연결' : '진열 번호/상품번호 필요'),
        productNo ? !!mainPlan : postCreateReady('mains')
      )}
    </div>
    ${renderFactoryCafe24SyncResultPanel(factory)}
  </div>`;
}

function renderFactorySourcePanel(factory, sourceType, title, subtitle, sections, className, options = {}) {
  const panelState = factorySourcePanelState(factory);
  const isPanelCollapsed = sourceType === 'cafe24' ? panelState.cafe24Collapsed : panelState.sinhwaCollapsed;
  const collapsedSectionSet = new Set(panelState[factorySourcePanelCollapsedSectionKey(sourceType)] || []);
  const sourceLabel = sourceType === 'cafe24' ? 'Cafe24 입력판' : '신화사DB 자료판';
  const panelCollapseLabel = sourceType === 'cafe24'
    ? (isPanelCollapsed ? 'Cafe24 전체 펼치기' : 'Cafe24 전체 최소화')
    : (isPanelCollapsed ? '신화사DB 전체 펼치기' : '신화사DB 전체 최소화');
  const sectionCollapseCount = collapsedSectionSet.size;
  const sourcePanelActions = `<div class="factory-source-panel-actions">
    <button class="btn-sm" data-factory-source-panel-collapse="${escAttr(sourceType)}" data-collapse="${isPanelCollapsed ? '0' : '1'}" type="button" title="${escAttr(sourceType === 'cafe24' ? 'Cafe24 상품 입력판 전체를 접거나 펼칩니다. 접어도 입력값과 동기화 연결은 유지됩니다.' : '신화사DB 자료판 전체를 접거나 펼칩니다. 접어도 비교값과 완성 DB 연결은 유지됩니다.')}">
      <span class="material-icons-outlined" style="font-size:14px">${isPanelCollapsed ? 'unfold_more' : 'unfold_less'}</span>${panelCollapseLabel}
    </button>
    <button class="btn-sm" data-factory-source-sections-collapse="${escAttr(sourceType)}" data-collapse="1" type="button" title="이 패널 안의 기본정보/가격/옵션 같은 세부 섹션만 모두 접습니다. 패널 제목과 전체 버튼은 남습니다." ${disabledAttr(isPanelCollapsed, '전체 패널을 먼저 펼쳐주세요.')}>섹션 모두 접기</button>
    <button class="btn-sm" data-factory-source-sections-collapse="${escAttr(sourceType)}" data-collapse="0" type="button" title="접어둔 세부 섹션을 모두 다시 펼칩니다." ${disabledAttr(isPanelCollapsed || !sectionCollapseCount, '접힌 섹션이 없습니다.')}>섹션 모두 펼치기</button>
  </div>`;
  if (isPanelCollapsed) {
    return `<div class="factory-source-panel ${className || ''}" data-factory-source-panel="${escAttr(sourceType)}">
      <div class="factory-source-head">
        <div>
          <div class="factory-source-title">${escapeHtml(title)}</div>
          <div class="factory-source-sub">${escapeHtml(subtitle)}</div>
        </div>
        <div class="factory-source-head-side">
          <span class="factory-db-source">${sourceType === 'cafe24' ? '상품등록/수정 폼' : '자료판 접힘'}</span>
          ${sourcePanelActions}
        </div>
      </div>
      <div class="factory-source-collapsed-note">${escapeHtml(sourceLabel)} 전체를 접어두었습니다. 입력값과 저장/동기화 연결은 유지됩니다.</div>
    </div>`;
  }
  const displaySections = sourceType === 'cafe24' ? factoryCafe24VisibleSections(sections) : sections;
  const baseModel = factoryBuildSourcePanelModel(factory, sourceType, displaySections);
  const model = sourceType === 'cafe24'
    ? { ...baseModel, sections: factoryCafe24UserVisibleSections(baseModel.sections, factory) }
    : baseModel;
  const rawRows = model.rows.slice(0, 140);
  const cafe24CreateModel = sourceType === 'cafe24'
    ? (Object.prototype.hasOwnProperty.call(options, 'cafe24CreateModel')
      ? options.cafe24CreateModel
      : (options.renderCache && typeof factoryRenderCacheCreateModel === 'function'
        ? factoryRenderCacheCreateModel(factory, options.renderCache)
        : factoryCafe24CreatePreviewModel(factory)))
    : null;
  const cafe24SharedDbModel = sourceType === 'cafe24'
    ? (options.dbModel || cafe24CreateModel?.dbModel || null)
    : null;
  let cafe24ChangedProductPayload = null;
  const cafe24GetChangedProductPayload = () => {
    if (!cafe24SharedDbModel) return null;
    if (!cafe24ChangedProductPayload) {
      cafe24ChangedProductPayload = factoryBuildCafe24UpdatePayload(cafe24SharedDbModel.finalDb, cafe24SharedDbModel.fields, factory, { onlyChanged: true });
    }
    return cafe24ChangedProductPayload;
  };
  const cafe24ReadyPlan = sourceType === 'cafe24'
    ? factoryCafe24ReadySyncPlan(factory, {
      dbModel: cafe24SharedDbModel,
      productPayload: cafe24GetChangedProductPayload(),
    })
    : null;
  const cafe24SaveDiff = sourceType === 'cafe24'
    ? factoryCafe24SaveDiffModel(factory, {
      dbModel: cafe24SharedDbModel,
      product: cafe24GetChangedProductPayload(),
    })
    : null;
  const cafe24SaveFieldCount = cafe24SaveDiff?.fieldNames?.length || 0;
  const cafe24CreateFieldCount = cafe24CreateModel?.fieldNames?.length || 0;
  const cafe24CreateRequiredMissing = Array.isArray(cafe24CreateModel?.requiredMissing)
    ? cafe24CreateModel.requiredMissing
    : [];
  const cafe24CompareMap = sourceType === 'cafe24' ? factoryCafe24SinhwaCompareMap(factory, baseModel) : new Map();
  const canSaveCafe24Product = sourceType === 'cafe24' && !!cafe24SaveDiff?.productNo && cafe24SaveFieldCount > 0;
  const canVerifyCafe24SingleField = canSaveCafe24Product && cafe24SaveFieldCount === 1;
  const canCreateCafe24Product = sourceType === 'cafe24' && !cafe24CreateModel?.productNo && !cafe24CreateRequiredMissing.length && cafe24CreateFieldCount > 0;
  const cafe24SaveDisabledReason = !cafe24SaveDiff?.productNo
    ? 'Cafe24 상품번호를 먼저 확정해주세요. 기존 상품 저장은 선택한 Cafe24 상품에만 전송됩니다.'
    : '수정한 상품 기본 입력칸이 없습니다. 옵션/품목/재고, 카테고리, 이미지, 태그, SEO는 전용 동기화 버튼을 사용하세요.';
  const cafe24SingleVerifyDisabledReason = !cafe24SaveDiff?.productNo
    ? 'Cafe24 상품번호를 먼저 확정해주세요.'
    : cafe24SaveFieldCount === 0
    ? '검증할 변경 필드가 없습니다. 상품 기본 입력칸 하나만 수정하면 활성화됩니다.'
    : `1필드 왕복 검증은 정확히 1개 변경일 때만 실행합니다. 현재 ${cafe24SaveFieldCount}개 변경이 잡혔습니다.`;
  const cafe24CreateDisabledReason = cafe24CreateModel?.productNo
    ? `현재 기존 Cafe24 상품 #${cafe24CreateModel.productNo}이 선택되어 있습니다. 기존 상품은 'Cafe24 기본 저장'과 전용 동기화 버튼으로 수정하고, 새 상품 등록은 Cafe24 후보가 없는 상태에서 실행하세요.`
    : cafe24CreateRequiredMissing.length
    ? `새 상품 등록 필수값 누락: ${cafe24CreateRequiredMissing.join(', ')}`
    : '새 상품으로 보낼 상품 기본 입력값이 없습니다.';
  const cafe24CreateButtonLabel = cafe24CreateModel?.productNo
    ? 'Cafe24 새 상품 등록 잠김'
    : `Cafe24 새 상품 등록${cafe24CreateFieldCount ? ` (${cafe24CreateFieldCount})` : ''}`;
  const canSyncCafe24Category = sourceType === 'cafe24' && !!cafe24ReadyPlan?.productNo && factoryCafe24CategoryTouched(factory) && factorySelectedCafe24CategoryRows(factory, factory.product.finalDb || {}).length > 0;
  const cafe24Status = sourceType === 'cafe24'
      ? `<div class="factory-toolbar">
        <button class="btn-sm" id="factoryRefreshCafe24Api" type="button" title="선택된 Cafe24 상품번호의 최신 상품정보를 Cafe24 API에서 다시 읽어와 입력판을 갱신합니다."><span class="material-icons-outlined" style="font-size:14px">cloud_sync</span>Cafe24 상품정보 다시 불러오기</button>
        <button class="btn-sm" id="factoryProbeCafe24Endpoints" type="button" title="상품 기본 저장, 옵션, 이미지, 카테고리 등 Cafe24 전용 API 경로가 현재 연결 가능한지 점검합니다."><span class="material-icons-outlined" style="font-size:14px">lan</span>전용 API 상태 점검</button>
        <button class="btn-sm" id="factoryRefreshCafe24Refs" type="button" title="카테고리, 제조사, 공급사, 브랜드, 트렌드 같은 Cafe24 선택 목록을 다시 불러옵니다."><span class="material-icons-outlined" style="font-size:14px">list_alt</span>선택 목록 불러오기</button>
        <button class="btn-sm" id="factorySyncCafe24Category" type="button" title="직접 수정한 카테고리 분류를 확정된 Cafe24 상품에 연결합니다." ${disabledAttr(!canSyncCafe24Category, !cafe24ReadyPlan?.productNo ? 'Cafe24 상품번호를 먼저 확정해주세요.' : '카테고리를 직접 수정한 뒤 연결할 수 있습니다.')}><span class="material-icons-outlined" style="font-size:14px">category</span>카테고리 연결</button>
        <button class="btn-sm" id="factoryCreateCafe24Api" type="button" title="현재 DB 입력판 값을 기준으로 Cafe24에 새 상품을 등록합니다. 기존 Cafe24 상품이 선택된 상태에서는 잠깁니다." ${disabledAttr(!canCreateCafe24Product, cafe24CreateDisabledReason)}><span class="material-icons-outlined" style="font-size:14px">add_business</span>${cafe24CreateButtonLabel}</button>
        <button class="btn-sm" id="factoryCreateCafe24HiddenTestApi" type="button" title="현재 입력판 값을 기준으로 숨김 테스트 상품을 만듭니다. 기존 Cafe24 상품을 보고 있어도 새 상품명으로 복제 등록하며, 진열안함/판매안함으로 고정합니다." ${disabledAttr(!!cafe24CreateRequiredMissing?.length || !cafe24CreateFieldCount, cafe24CreateRequiredMissing?.length ? `테스트 등록 필수값 누락: ${cafe24CreateRequiredMissing.join(', ')}` : '테스트 상품으로 보낼 입력값이 없습니다.')}><span class="material-icons-outlined" style="font-size:14px">science</span>숨김 테스트 등록</button>
        <button class="btn-sm" id="factorySaveCafe24Api" type="button" title="현재 입력판에서 변경된 Cafe24 상품 기본 필드만 실제 Cafe24 상품에 저장하고, 저장 후 재조회로 일치 여부를 확인합니다." ${disabledAttr(!canSaveCafe24Product, cafe24SaveDisabledReason)}><span class="material-icons-outlined" style="font-size:14px">cloud_upload</span>기입한 내역 Cafe24로 보내기${cafe24SaveFieldCount ? ` (${cafe24SaveFieldCount})` : ''}</button>
        <button class="btn-sm" id="factoryVerifyCafe24SingleField" type="button" title="변경 필드가 정확히 1개일 때만, 저장 전후 값을 왕복 검증해 Cafe24 반영 경로가 안전한지 확인합니다." ${disabledAttr(!canVerifyCafe24SingleField, cafe24SingleVerifyDisabledReason)}><span class="material-icons-outlined" style="font-size:14px">rule</span>1필드 왕복 검증</button>
        <button class="btn-sm primary" id="factorySyncCafe24ReadyAll" type="button" title="상품 기본 저장 외에 옵션/품목/이미지/카테고리처럼 준비된 전용 동기화 항목을 한 번에 실행합니다." ${disabledAttr(!cafe24ReadyPlan.productNo || !cafe24ReadyPlan.readyActions.length, cafe24ReadyPlan.blockers.join(' '))}><span class="material-icons-outlined" style="font-size:14px">sync</span>준비 항목 전체 동기화</button>
      </div>
      <div class="factory-source-sub" style="margin-top:6px">
        ${escapeHtml(factory.product.cafe24ApiStatus || 'Cafe24 상품정보는 아직 수동 새로고침하지 않았습니다.')}
        ${factory.product.cafe24ApiCatalog?.length ? ` · 선택목록 ${factory.product.cafe24ApiCatalog.length}개` : ''}
        ${factory.product.cafe24ApiLastFetchedAt ? ` · 마지막 ${escapeHtml(new Date(factory.product.cafe24ApiLastFetchedAt).toLocaleString())}` : ''}
        ${factory.product.cafe24ReferenceStatus ? `<br>${escapeHtml(factory.product.cafe24ReferenceStatus)}` : ''}
      </div>
      ${renderFactoryCafe24EndpointHealthPanel(factory)}
      ${renderFactoryCafe24LastSaveVerification(factory.product.cafe24LastSaveVerification)}` : '';
  const cafe24AdvancedOpen = sourceType === 'cafe24' && factory.product?.cafe24AdvancedOpen && typeof factory.product.cafe24AdvancedOpen === 'object'
    ? factory.product.cafe24AdvancedOpen
    : {};
  const cafe24PreviewOpen = !!cafe24AdvancedOpen.preview;
  const cafe24DeveloperOpen = !!cafe24AdvancedOpen.developer;
  const cafe24LazyAdvancedNote = '<div class="factory-source-collapsed-note">이 점검판은 열 때만 계산합니다. 입력판 렌더 속도를 위해 닫힌 상태에서는 내용을 만들지 않습니다.</div>';
  const sectionHtml = model.sections.map(section => {
    const sectionKey = factorySourcePanelSectionKey(sourceType, section.title);
    const sectionCollapsed = collapsedSectionSet.has(sectionKey);
    return `<div class="factory-source-section ${sectionCollapsed ? 'collapsed' : ''}" data-factory-source-section="${escAttr(sectionKey)}">
      <h5>
        <span>${escapeHtml(section.title)}</span>
        <button class="btn-sm" data-factory-source-section-toggle="${escAttr(sectionKey)}" data-source-type="${escAttr(sourceType)}" type="button" title="${escAttr(`${section.title} 섹션만 접거나 펼칩니다. 값과 동기화 상태는 유지됩니다.`)}">
          <span class="material-icons-outlined" style="font-size:14px">${sectionCollapsed ? 'unfold_more' : 'unfold_less'}</span>${sectionCollapsed ? '펼치기' : '접기'}
        </button>
      </h5>
      ${sectionCollapsed ? `<div class="factory-source-collapsed-note">${escapeHtml(section.title)} 입력칸을 접어두었습니다. 값과 Cafe24/신화사DB 동기화 상태는 보존됩니다.</div>` : `<div class="factory-source-field-grid">
        ${section.fields.map(field => renderFactorySourceField(field, {
          editable: sourceType === 'cafe24',
          factory,
          sourceType,
          compareField: sourceType === 'cafe24' ? cafe24CompareMap.get(factoryCafe24FieldUiKey(field)) : null,
        })).join('')}
      </div>
      ${sourceType === 'cafe24' && /옵션/.test(section.title) ? renderFactoryCafe24OptionEditor(factory, model) : ''}
      ${sourceType === 'cafe24' && /상세.*이미지|이미지/.test(section.title) ? renderFactoryCafe24ImageSyncPanel(factory) : ''}`}
    </div>`;
  }).join('');
  return `<div class="factory-source-panel ${className || ''}" data-factory-source-panel="${escAttr(sourceType)}">
    <div class="factory-source-head">
      <div>
        <div class="factory-source-title">${escapeHtml(title)}</div>
        <div class="factory-source-sub">${escapeHtml(subtitle)}</div>
        ${cafe24Status}
      </div>
      <div class="factory-source-head-side">
        <span class="factory-db-source">${sourceType === 'cafe24' ? '상품등록/수정 폼' : `${rawRows.length}개 자료 필드`}</span>
        ${sourcePanelActions}
      </div>
    </div>
    ${isPanelCollapsed ? `<div class="factory-source-collapsed-note">${escapeHtml(sourceLabel)} 전체를 접어두었습니다. 입력값과 저장/동기화 연결은 유지됩니다.</div>` : `${sourceType === 'cafe24' ? `${renderFactoryCafe24AdminGuard(factory)}
      ${renderFactoryDbInputSnapshotControls(factory)}
      ${renderFactoryCafe24FieldViewControls(factory, baseModel)}
      <div class="factory-cafe24-debug-note">아래는 Cafe24 상품 등록/수정 화면에서 직접 기입하는 한글 입력칸입니다. 매칭 점수, 내부 코드, 시스템값은 작업 화면에 섞지 않습니다.</div>` : ''}
    ${sectionHtml}
    ${sourceType === 'cafe24' ? renderFactoryCafe24HiddenFieldShelf(factory, baseModel) : ''}
    ${sourceType === 'cafe24' ? renderFactoryCafe24DedicatedApiPanels(factory) : ''}
    ${sourceType === 'cafe24' ? `<details class="factory-cafe24-advanced" data-factory-cafe24-advanced="preview" ${cafe24PreviewOpen ? 'open' : ''}>
      <summary>저장/등록 미리보기</summary>
      <div class="factory-cafe24-advanced-body">
        ${cafe24PreviewOpen ? `${renderFactoryCafe24SavePreview(factory)}
        ${renderFactoryCafe24CreatePreview(factory)}` : cafe24LazyAdvancedNote}
      </div>
    </details>
    <details class="factory-cafe24-advanced" data-factory-cafe24-advanced="developer" ${cafe24DeveloperOpen ? 'open' : ''}>
      <summary>개발자 전용 점검 / 동기화 경로</summary>
      <div class="factory-cafe24-advanced-body">
        ${cafe24DeveloperOpen ? `${renderFactoryCafe24CoveragePanel(factory)}
        ${renderFactoryCafe24SyncRoutePanel(factory)}` : cafe24LazyAdvancedNote}
      </div>
    </details>` : ''}
    ${sourceType !== 'cafe24' ? `<details class="factory-db-raw">
      <summary>${escapeHtml(title)} 자료 필드 보기 (${model.rows.length}개)</summary>
      <div class="factory-db-raw-table">
        ${rawRows.length ? rawRows.map(row => `<div class="factory-db-raw-row">
          <b>${escapeHtml(row.sourceLabel)}</b>
          <code title="${escAttr(row.key)}">${escapeHtml(factoryDisplayFieldLabel(row.key))}</code>
          <span class="factory-db-raw-value" title="${escAttr(row.value)}">${escapeHtml(row.value)}</span>
          ${row.fieldId
            ? `<button class="btn-sm" data-factory-db-use-source="${escAttr(row.fieldId)}" data-factory-db-raw-id="${escAttr(row.id)}" type="button" title="이 신화사DB 원자료 값을 연결된 완성 DB 입력칸에 채웁니다.">값 채우기</button>`
            : `<button class="btn-sm" data-factory-db-add-raw="${escAttr(row.id)}" type="button" title="완성 DB에 아직 연결되지 않은 신화사DB 원자료를 새 참고 필드로 추가합니다.">필드 추가</button>`}
        </div>`).join('') : `<div class="factory-db-raw-row"><span>${escapeHtml(title)} 자료값이 아직 없습니다.</span></div>`}
      </div>
    </details>` : ''}`}
  </div>`;
}

function renderFactoryCafe24SourcePanel(factory = factoryRuntimeReadFactory(), options = {}) {
  return renderFactorySourcePanel(
    factory,
    'cafe24',
    'Cafe24 상품 입력판',
    'Cafe24 상품 수정 화면에서 채울 수 있는 칸을 기준으로 봅니다. 선택한 상품 상세에 없는 값은 빨간 빈칸으로 둡니다.',
    FACTORY_CAFE24_FIELD_SECTIONS,
    'cafe24',
    options
  );
}

function refreshFactoryCafe24SourcePanel(options = {}) {
  const panel = document.querySelector('[data-factory-source-panel="cafe24"]');
  if (!panel || state.step !== 'factory') {
    renderPreservingMainScroll();
    return;
  }
  const before = mainScrollElement();
  const top = before ? before.scrollTop : window.scrollY;
  const left = before ? before.scrollLeft : window.scrollX;
  const panelTop = panel.getBoundingClientRect().top;
  const focusedId = document.activeElement?.id || '';
  panel.outerHTML = renderFactoryCafe24SourcePanel(factoryRuntimeReadFactory());
  bindEvents();
  const restore = () => {
    const nextPanel = document.querySelector('[data-factory-source-panel="cafe24"]');
    if (options.keepPanelAnchor && nextPanel) {
      const nextTop = nextPanel.getBoundingClientRect().top;
      const currentTop = before ? before.scrollTop : window.scrollY;
      restoreMainScrollPosition(currentTop + (nextTop - panelTop), left);
      return;
    }
    restoreMainScrollPosition(top, left);
  };
  restore();
  requestAnimationFrame(restore);
  if (focusedId) {
    const next = document.getElementById(focusedId);
    if (next && typeof next.focus === 'function') next.focus({ preventScroll: true });
  }
}

function renderFactoryDbSourcePanels(factory, options = {}) {
  return `<div class="factory-source-panels">
    ${renderFactoryCafe24SourcePanel(factory, options)}
    ${renderFactorySourcePanel(
      factory,
      'sinhwa',
      '신화사DB 자료판',
      '신화사DB 확정/후보에서 온 값만 따로 봅니다. Cafe24와 중복되는 값은 완성 DB 프리셋에서 켜고 끌 수 있습니다.',
      FACTORY_SINHWA_FIELD_SECTIONS,
      'sinhwa',
      options
    )}
  </div>`;
}
