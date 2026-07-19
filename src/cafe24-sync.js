function factoryBuildCafe24OptionSyncPlan(factory = factoryRuntimeReadFactory(), finalDb = factory.product?.finalDb || {}, optionModel = null) {
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target);
  const optionFinalDb = factoryCafe24OptionSettingsFinalDb(factory, finalDb);
  const productNo = target?.product_no || raw.product_no || optionFinalDb.product_no || optionFinalDb.cafe24_product_no || '';
  const mallId = target?.mall_id || raw.mall_id || CAFE24_CONTROL_API.defaultMallId;
  const model = optionModel || factoryCafe24OptionEditorModel(factory);
  const optionName = String(model.optionName || optionFinalDb.option_name || '색상').trim() || '색상';
  const optionValues = factoryDedupeRealOptionValues(model.optionValues || [], { allowNumeric: true });
  const optionGroups = factoryCafe24CleanOptionGroupsForPayload(model.editGroups || [], optionName, optionValues);
  const optionValueTotal = optionGroups.reduce((sum, group) => sum + group.values.length, 0);
  const rows = model.variants || factoryCafe24VariantRows(factory, optionValues);
  const productOptions = factoryBuildCafe24ProductOptionsPayload(optionName, optionValues, optionGroups);
  const optionSettingsTouched = factoryCafe24OptionSettingsTouched(factory);
  const optionStructureTouched = factoryCafe24OptionStructureTouched(factory);
  const optionExtras = factoryCafe24OptionExtrasModel(factory, raw);
  const optionExtrasTouched = factoryCafe24OptionExtrasTouched(factory);
  const variantEdits = factoryCafe24VariantEditsForCurrent(factory);
  const optionHasChanges = optionStructureTouched || optionSettingsTouched || optionExtrasTouched || Object.keys(variantEdits).length > 0;
  const optionPayload = productNo && (optionStructureTouched || optionSettingsTouched || optionExtrasTouched)
    ? factoryBuildCafe24OptionsUpdatePayload(factory, raw, optionFinalDb, optionName, optionValues, optionGroups, {
      settingsOnly: !optionStructureTouched,
      preferFinalDbSettings: optionSettingsTouched,
    })
    : null;
  const existingOptionRoot = factoryCafe24ExistingOptionRoot(raw);
  const existingOptionGroups = Array.isArray(existingOptionRoot.options) ? existingOptionRoot.options : [];
  const existingHasOption = String(existingOptionRoot.has_option || raw.has_option || '').trim().toUpperCase() === 'T';
  const shouldCreateOptionStructure = !!optionPayload && optionStructureTouched && (!existingHasOption || !existingOptionGroups.length);
  const optionUpdateBody = optionPayload ? cloneData(optionPayload) : null;
  if (
    optionUpdateBody &&
    !shouldCreateOptionStructure &&
    Array.isArray(optionUpdateBody.options) &&
    optionUpdateBody.options.length &&
    existingOptionGroups.length
  ) {
    const originalOptions = factoryCafe24OriginalOptionsPayload(existingOptionGroups);
    if (originalOptions.length) optionUpdateBody.original_options = originalOptions;
  }
  const optionUpdate = productNo && optionPayload ? {
    method: shouldCreateOptionStructure ? 'POST' : 'PUT',
    path: `/api/v2/admin/products/${encodeURIComponent(productNo)}/options`,
    body: optionUpdateBody,
  } : null;
  const warnings = [];
  const hasOptionFlag = factoryCafe24PayloadValue('has_option', factoryCafe24OptionSetting(raw, optionFinalDb, 'has_option', 'F')) || 'F';
  const variantUpdates = rows
    .filter(row => row.variant_code && variantEdits[row.key])
    .map(row => ({
      variantCode: row.variant_code,
      path: productNo ? `/api/v2/admin/products/${encodeURIComponent(productNo)}/variants/${encodeURIComponent(row.variant_code)}` : '',
      body: { variant: factoryCafe24VariantPayloadFromEdit(row, variantEdits[row.key], optionName, optionGroups) },
      row,
    }))
    .filter(item => Object.keys(item.body.variant || {}).length);
  const inventoryUpdates = rows
    .filter(row => row.variant_code && variantEdits[row.key])
    .map(row => ({
      variantCode: row.variant_code,
      path: productNo ? `/api/v2/admin/products/${encodeURIComponent(productNo)}/variants/${encodeURIComponent(row.variant_code)}/inventories` : '',
      body: factoryCafe24InventoryPayloadFromEdit(row, variantEdits[row.key]),
      row,
    }))
    .filter(item => Object.keys(item.body || {}).length);
  const sourceInventoryMap = factoryCafe24SourceVariantInventoryMap(factory, productNo);
  const editedVariantKeys = new Set(Object.keys(variantEdits || {}));
  const shouldSyncAutoInventory = optionHasChanges;
  const autoInventoryUpdates = shouldSyncAutoInventory ? rows
    .filter(row => row.variant_code && !editedVariantKeys.has(row.key))
    .map(row => {
      const seed = factoryCafe24SourceInventoryForRow(row, sourceInventoryMap);
      const inventory = factoryCafe24AutoInventoryPayload(row, seed);
      return {
        variantCode: row.variant_code,
        path: productNo ? `/api/v2/admin/products/${encodeURIComponent(productNo)}/variants/${encodeURIComponent(row.variant_code)}/inventories` : '',
        body: inventory,
        row,
        autoSeed: !!seed,
      };
    })
    .filter(item => Object.keys(item.body || {}).length)
    : [];
  const mergedInventoryUpdates = [...inventoryUpdates, ...autoInventoryUpdates];
  const missingCodes = rows.filter(row => !row.variant_code).length;
  if (!productNo) warnings.push('상품번호가 없어 기존 상품 옵션/품목 동기화는 대기합니다. 새 상품 등록 payload에는 옵션을 포함할 수 있습니다.');
  if (!optionValueTotal && hasOptionFlag === 'T' && !optionSettingsTouched && !optionExtrasTouched) warnings.push('옵션 사용 상품인데 옵션값이 없습니다.');
  if (!optionValueTotal && hasOptionFlag === 'T' && optionSettingsTouched) warnings.push('옵션 설정값만 동기화합니다. 옵션값 목록은 비어 있습니다.');
  if (optionExtras.useAdditionalOption === 'T' && !optionExtras.additionalOptions.length) warnings.push('추가 입력 옵션을 사용함으로 설정했지만 입력칸이 없습니다.');
  if (missingCodes) warnings.push(`품목코드 없는 행 ${missingCodes}개는 기존 품목 수정에서 제외됩니다.`);
  if (rows.length && optionValueTotal && rows.length !== optionValueTotal) warnings.push(`옵션값 ${optionValueTotal}개와 품목 ${rows.length}개 수가 다릅니다. 기존 품목 수정은 품목코드 기준으로만 실행됩니다.`);
  return {
    productNo,
    mallId,
    optionName,
    optionValues,
    optionGroups,
    optionGroupCount: optionGroups.length,
    optionValueTotal,
    optionStructureTouched,
    optionSettingsTouched,
    optionExtras,
    optionExtrasTouched,
    variantEditsTouched: Object.keys(variantEdits).length > 0,
    hasExplicitChanges: optionHasChanges,
    hasChanges: optionHasChanges && !!(optionUpdate || variantUpdates.length || mergedInventoryUpdates.length),
    optionSettingsOnly: !!(optionUpdate && !optionStructureTouched),
    productOptions,
    optionUpdate,
    variantUpdates,
    inventoryUpdates: mergedInventoryUpdates,
    autoInventorySeedCount: autoInventoryUpdates.filter(item => item.autoSeed).length,
    warnings,
  };
}

function factoryAttachCafe24OptionsToProductPayload(product, factory = factoryRuntimeReadFactory(), finalDb = factory.product.finalDb || {}) {
  const optionFinalDb = factoryCafe24OptionSettingsFinalDb(factory, finalDb);
  const plan = factoryBuildCafe24OptionSyncPlan(factory, optionFinalDb);
  const optionBody = plan.optionUpdate?.body?.option || plan.optionUpdate?.body ||
    factoryBuildCafe24OptionsUpdatePayload(factory, {}, optionFinalDb, plan.optionName, plan.optionValues, plan.optionGroups, {
      settingsOnly: plan.optionSettingsTouched,
      preferFinalDbSettings: plan.optionSettingsTouched,
    }) ||
    {};
  if (!plan.productOptions.length && !plan.optionSettingsTouched && !plan.optionExtrasTouched) return product;
  product.has_option = factoryCafe24PayloadValue('has_option', optionBody.has_option || product.has_option || optionFinalDb?.has_option || 'T') || 'T';
  product.option_type = factoryCafe24PayloadValue('option_type', optionBody.option_type || product.option_type || optionFinalDb?.option_type || 'T') || 'T';
  product.option_list_type = factoryCafe24PayloadValue('option_list_type', optionBody.option_list_type || product.option_list_type || optionFinalDb?.option_list_type || 'C') || 'C';
  product.select_one_by_option = factoryCafe24PayloadValue('select_one_by_option', optionBody.select_one_by_option || product.select_one_by_option || optionFinalDb?.select_one_by_option || 'F') || 'F';
  if (plan.productOptions.length) product.options = plan.productOptions;
  ['use_additional_option', 'additional_options', 'use_attached_file_option', 'attached_file_option'].forEach(key => {
    if (optionBody[key] !== undefined) product[key] = cloneData(optionBody[key]);
  });
  return product;
}

function factoryCafe24VariantNormalizedOptionKey(rowOrVariant = {}) {
  const pairs = Array.isArray(rowOrVariant.option_pairs) && rowOrVariant.option_pairs.length
    ? rowOrVariant.option_pairs
    : (typeof factoryCafe24VariantOptionPairs === 'function' ? factoryCafe24VariantOptionPairs(rowOrVariant) : []);
  const text = pairs.length
    ? pairs.map(item => item?.value || item?.option_text || item?.text || '').filter(Boolean).join('|')
    : (
      rowOrVariant.option_value ||
      rowOrVariant.option_text ||
      (typeof factoryCafe24VariantOptionValue === 'function' ? factoryCafe24VariantOptionValue(rowOrVariant) : '') ||
      ''
    );
  return factoryDbNormalizeKey(text);
}

function factoryCafe24CandidateProductNo(candidate = {}) {
  const raw = parseCafe24Raw(candidate) || {};
  return String(candidate.product_no || raw.product_no || candidate.productNo || raw.productNo || '').trim();
}

function factoryCafe24SourceVariantInventoryMap(factory = factoryRuntimeReadFactory(), targetProductNo = '') {
  const map = new Map();
  const selectedKey = factory.product?.selectedCafe24CandidateKey;
  const candidates = Array.isArray(factory.product?.cafe24Candidates) ? factory.product.cafe24Candidates : [];
  const ordered = [
    ...candidates.filter(candidate => selectedKey && factoryCafe24CandidateKey(candidate) === selectedKey),
    ...candidates.filter(candidate => !selectedKey || factoryCafe24CandidateKey(candidate) !== selectedKey),
  ];
  ordered.forEach(candidate => {
    const candidateNo = factoryCafe24CandidateProductNo(candidate);
    if (targetProductNo && candidateNo && String(candidateNo) === String(targetProductNo)) return;
    const raw = parseCafe24Raw(candidate) || candidate.raw || {};
    const variants = Array.isArray(raw.variants) ? raw.variants : (Array.isArray(candidate.variants) ? candidate.variants : []);
    variants.forEach((variant, index) => {
      const key = factoryCafe24VariantNormalizedOptionKey(variant);
      if (!key || map.has(key)) return;
      const inventory = variant.inventory || variant.inventories?.[0] || {};
      map.set(key, {
        variant,
        inventory,
        quantity: variant.quantity ?? variant.stock_quantity ?? inventory.quantity ?? inventory.stock_quantity,
        safety_inventory: variant.safety_inventory ?? inventory.safety_inventory,
        use_inventory: variant.use_inventory ?? inventory.use_inventory,
        important_inventory: variant.important_inventory ?? inventory.important_inventory,
        inventory_control_type: variant.inventory_control_type ?? inventory.inventory_control_type,
        display_soldout: variant.display_soldout ?? inventory.display_soldout,
        index,
      });
    });
  });
  return map;
}

function factoryCafe24SourceInventoryForRow(row = {}, sourceInventoryMap = new Map()) {
  const key = factoryCafe24VariantNormalizedOptionKey(row);
  if (key && sourceInventoryMap.has(key)) return sourceInventoryMap.get(key);
  return null;
}

function factoryCafe24AutoInventoryPayload(row = {}, seed = null) {
  const pick = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  const inventory = {};
  inventory.display_soldout = 'T';
  const useInventory = factoryTruthyCafe24Flag(pick(seed?.use_inventory, row.use_inventory, 'T')) || 'T';
  inventory.use_inventory = useInventory;
  const important = String(pick(seed?.important_inventory, row.important_inventory, 'A')).trim();
  if (important) inventory.important_inventory = important;
  const control = String(pick(seed?.inventory_control_type, row.inventory_control_type, 'B')).trim();
  if (control) inventory.inventory_control_type = control;
  const quantity = pick(seed?.quantity, row.quantity);
  if (quantity !== undefined && quantity !== null && String(quantity).trim() !== '') {
    inventory.quantity = factoryCafe24PayloadValue('quantity', quantity);
  }
  const safety = pick(seed?.safety_inventory, row.safety_inventory);
  if (safety !== undefined && safety !== null && String(safety).trim() !== '') {
    inventory.safety_inventory = factoryCafe24PayloadValue('safety_inventory', safety);
  }
  return inventory;
}

function factoryCafe24HasUsableCategoryValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return String(value ?? '').trim() !== '';
}

function factoryCafe24RawCategoryValue(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const candidates = [
    raw.category,
    raw.categories,
    raw.product_category,
    raw.category_list,
    raw.category_detail,
    raw.category_no,
    raw.categoryNo,
  ];
  return candidates.find(factoryCafe24HasUsableCategoryValue) || null;
}

function factoryCafe24CategoryFallbackValue(factory = factoryRuntimeReadFactory(), finalDb = {}) {
  const explicit = [
    finalDb.category,
    finalDb.categories,
    finalDb.category_rows,
    finalDb.category_no,
    finalDb.categoryNo,
  ].find(factoryCafe24HasUsableCategoryValue);
  if (explicit !== undefined && explicit !== null) return explicit;

  const currentRaw = factoryCafe24RawForForm(factory);
  const currentValue = factoryCafe24RawCategoryValue(currentRaw);
  if (factoryCafe24HasUsableCategoryValue(currentValue)) return currentValue;

  const currentNo = String(currentRaw?.product_no || factory.product?.cafe24TargetProductNo || '').trim();
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
    if (currentNo && productNo && productNo === currentNo) continue;
    const value = factoryCafe24RawCategoryValue(raw);
    if (factoryCafe24HasUsableCategoryValue(value)) return value;
  }

  return factoryCafe24FormFieldValue({ id: 'category' }, factory, factoryDbSourceRows(factory, { types: ['cafe24'], includeManual: false }), [], []);
}

function factorySelectedCafe24CategoryRows(factory = factoryRuntimeReadFactory(), finalDb = factory.product?.finalDb || {}) {
  const setting = factory.product.dbFieldSettings?.category;
  let rawValue = setting && (setting.manualTouched || setting.manualValue) ? setting.manualValue : null;
  if (rawValue === null || rawValue === undefined || rawValue === '') rawValue = finalDb.category;
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    rawValue = factoryCafe24CategoryFallbackValue(factory, finalDb);
  }
  const hasRawValue = Array.isArray(rawValue)
    ? rawValue.length > 0
    : (rawValue && typeof rawValue === 'object' ? Object.keys(rawValue).length > 0 : String(rawValue ?? '').trim() !== '');
  if (!hasRawValue) return [];
  const refs = factoryCafe24ReferenceList('categories', factory);
  const rows = factoryCafe24CategoryRows(rawValue, factory).map(row => {
    const normalized = factoryDbNormalizeKey(row.category_no || row.category_name);
    const hit = refs.find(item =>
      factoryDbNormalizeKey(item.code) === normalized ||
      factoryDbNormalizeKey(item.name) === normalized ||
      factoryDbNormalizeKey(item.label) === normalized ||
      String(row.category_no || row.category_name || '').includes(`(${item.code})`)
    );
    const number = /\b(\d{1,8})\b/.exec(String(row.category_no || row.category_name || ''))?.[1] || '';
    return {
      category_no: hit?.code || row.category_no || number || '',
      display_group: String(row.display_group ?? row.displayGroup ?? row.display_group_no ?? row.displayGroupNo ?? 1).trim() || '1',
      recommend: row.recommend === 'T' ? 'T' : 'F',
      new: row.new === 'T' ? 'T' : 'F',
    };
  }).filter(row => row.category_no);
  const seen = new Set();
  return rows.filter(row => {
    const key = String(row.category_no);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function factorySelectedCafe24CategoryNo(factory = factoryRuntimeReadFactory(), finalDb = factory.product?.finalDb || {}) {
  return factorySelectedCafe24CategoryRows(factory, finalDb)[0]?.category_no || '';
}

function factoryAttachCafe24CategoryToProductPayload(product, factory = factoryRuntimeReadFactory()) {
  const rows = factorySelectedCafe24CategoryRows(factory, factory.product.finalDb || {});
  if (rows.length) product.category = rows.map(row => ({
    category_no: row.category_no,
    display_group: row.display_group || '1',
    recommend: row.recommend === 'T' ? 'T' : 'F',
    new: row.new === 'T' ? 'T' : 'F',
  }));
  return product;
}

function factoryParseDataImageUrl(value) {
  const raw = String(value || '');
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(raw);
  if (!match) return null;
  return {
    mime: match[1] || 'image/png',
    base64: match[2] || '',
    preview: raw,
  };
}

function factoryCafe24CaptureOperationToken() {
  try {
    return typeof factoryRuntimeRequireStore === 'function'
      ? factoryRuntimeRequireStore().getOperationToken()
      : null;
  } catch (_) {
    return null;
  }
}

function factoryCafe24RunOwnedDraftMutation(command, options = {}, mutate) {
  if (typeof mutate !== 'function') throw new TypeError('Cafe24 draft mutator is required');
  if (options.operationToken && !factoryRuntimeIsOperationCurrent(options.operationToken)) return false;
  const owner = options.owner || 'cafe24';
  const transaction = factoryRuntimeUpdateOwnedFactory(command, owner, draft => mutate(draft));
  const finish = receipt => {
    if (typeof options.afterCommit === 'function') options.afterCommit(receipt.result);
    if (options.saveMode === 'schedule') scheduleLastWorkSave();
    else saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  };
  return transaction && typeof transaction.then === 'function'
    ? Promise.resolve(transaction).then(finish)
    : finish(transaction);
}

function factorySetCafe24ImageDraftSlot(slotKey, data, options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-image-draft',
      options,
      draft => factorySetCafe24ImageDraftSlot(slotKey, data, { ...options, factory: draft, render: false }),
    );
  }
  if (!FACTORY_CAFE24_IMAGE_SLOTS.some(slot => slot.key === slotKey)) return false;
  const factory = options.factory;
  const draft = factoryCafe24ImageDraft(factory);
  draft[slotKey] = {
    ...data,
    updatedAt: Date.now(),
  };
  factory.product.cafe24ImageDraft = draft;
  if (options.message) factoryLog(options.message, 'ok', factory);
  return true;
}

function factorySetCafe24ImageDraftFile(slotKey, file) {
  if (!file?.type?.startsWith('image/')) {
    factoryLog('Cafe24 이미지 슬롯에는 이미지 파일만 넣을 수 있습니다.', 'error');
    render();
    return;
  }
  const operationToken = factoryCafe24CaptureOperationToken();
  const reader = new FileReader();
  reader.onload = e => {
    const parsed = factoryParseDataImageUrl(e.target.result);
    if (!parsed?.base64) {
      factoryLog('이미지 파일을 base64로 읽지 못했습니다.', 'error');
      render();
      return;
    }
    const slot = FACTORY_CAFE24_IMAGE_SLOTS.find(item => item.key === slotKey);
    factorySetCafe24ImageDraftSlot(slotKey, {
      ...parsed,
      fileName: file.name || `${slotKey}.png`,
      size: file.size || 0,
      source: 'local-file',
    }, {
      operationToken,
      message: `${slot?.label || slotKey} 슬롯에 로컬 이미지를 불러왔습니다.`,
    });
  };
  reader.readAsDataURL(file);
}

function factoryUseProductImageForCafe24Slot(slotKey) {
  const parsed = factoryParseDataImageUrl(factoryProductPreview(factoryRuntimeReadFactory()));
  if (!parsed?.base64) {
    factoryLog('제품 입력사진이 data 이미지가 아니라 Cafe24 업로드 슬롯으로 복사할 수 없습니다. 로컬 파일로 다시 불러와주세요.', 'error');
    render();
    return false;
  }
  const slot = FACTORY_CAFE24_IMAGE_SLOTS.find(item => item.key === slotKey);
  factorySetCafe24ImageDraftSlot(slotKey, {
    ...parsed,
    fileName: `${slot?.label || slotKey}_제품사진.png`,
    size: Math.round(parsed.base64.length * 0.75),
    source: 'product-input',
  });
  factoryLog(`제품 입력사진을 ${slot?.label || slotKey} 슬롯에 복사했습니다.`, 'ok');
  return true;
}

function factoryClearCafe24ImageDraftSlot(slotKey = '', options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-image-draft',
      options,
      draft => factoryClearCafe24ImageDraftSlot(slotKey, { ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  const draft = factoryCafe24ImageDraft(factory);
  if (slotKey) {
    delete draft[slotKey];
  } else {
    FACTORY_CAFE24_IMAGE_SLOTS.forEach(slot => delete draft[slot.key]);
  }
  factory.product.cafe24ImageDraft = draft;
  factoryLog(slotKey ? 'Cafe24 이미지 슬롯을 비웠습니다.' : 'Cafe24 이미지 업로드 슬롯을 모두 비웠습니다.', 'ok', factory);
  return true;
}

function factoryAddCafe24AdditionalImageDraft(data, options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-image-draft',
      options,
      draft => factoryAddCafe24AdditionalImageDraft(data, { ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  const draft = factoryCafe24ImageDraft(factory);
  const list = factoryCafe24AdditionalImageDrafts(factory);
  if (list.length >= 20) {
    factoryLog('Cafe24 추가 이미지는 최대 20장까지만 준비할 수 있습니다.', 'error');
    render();
    return false;
  }
  list.push({
    ...data,
    id: data.id || uid('cafe24_additional'),
    updatedAt: Date.now(),
  });
  draft.additional_images = list.slice(0, 20);
  factory.product.cafe24ImageDraft = draft;
  if (options.message) factoryLog(options.message, 'ok', factory);
  return true;
}

function factoryAddCafe24AdditionalImageFiles(files) {
  const selected = Array.from(files || []).filter(file => file?.type?.startsWith('image/')).slice(0, 20);
  if (!selected.length) {
    factoryLog('Cafe24 추가 이미지에는 이미지 파일만 넣을 수 있습니다.', 'error');
    render();
    return;
  }
  const operationToken = factoryCafe24CaptureOperationToken();
  selected.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const parsed = factoryParseDataImageUrl(e.target.result);
      if (!parsed?.base64) {
        factoryLog(`${file.name || '이미지'} 파일을 base64로 읽지 못했습니다.`, 'error');
        render();
        return;
      }
      factoryAddCafe24AdditionalImageDraft({
        ...parsed,
        fileName: file.name || '추가 이미지.png',
        size: file.size || 0,
        source: 'local-file',
      }, {
        operationToken,
        message: `Cafe24 추가 이미지 준비: ${file.name || '이미지'}`,
      });
    };
    reader.readAsDataURL(file);
  });
}

function factoryAddProductImageToCafe24Additional() {
  const parsed = factoryParseDataImageUrl(factoryProductPreview(factoryRuntimeReadFactory()));
  if (!parsed?.base64) {
    factoryLog('제품 입력사진이 data 이미지가 아니라 추가 이미지로 복사할 수 없습니다. 로컬 파일로 다시 불러와주세요.', 'error');
    render();
    return false;
  }
  const ok = factoryAddCafe24AdditionalImageDraft({
    ...parsed,
    fileName: '제품사진_추가이미지.png',
    size: Math.round(parsed.base64.length * 0.75),
    source: 'product-input',
  });
  if (ok) factoryLog('제품 입력사진을 Cafe24 추가 이미지 준비 목록에 넣었습니다.', 'ok');
  return ok;
}

function factoryRemoveCafe24AdditionalImageDraft(index, options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-image-draft',
      options,
      draft => factoryRemoveCafe24AdditionalImageDraft(index, { ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  const draft = factoryCafe24ImageDraft(factory);
  const list = factoryCafe24AdditionalImageDrafts(factory);
  const i = Number.parseInt(index, 10);
  if (!Number.isFinite(i) || i < 0 || i >= list.length) return false;
  list.splice(i, 1);
  draft.additional_images = list;
  factory.product.cafe24ImageDraft = draft;
  factoryLog('Cafe24 추가 이미지 준비 항목을 제거했습니다.', 'ok', factory);
  return true;
}

function factoryClearCafe24AdditionalImages(options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-image-draft',
      options,
      draft => factoryClearCafe24AdditionalImages({ ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  const draft = factoryCafe24ImageDraft(factory);
  draft.additional_images = [];
  factory.product.cafe24ImageDraft = draft;
  factoryLog('Cafe24 추가 이미지 준비 목록을 비웠습니다.', 'ok', factory);
  return true;
}

function factoryVerifyCafe24ImageEcho(payload = {}, raw = {}) {
  const checked = FACTORY_CAFE24_IMAGE_SLOTS.filter(slot => payload[slot.key]).map(slot => slot.key);
  const present = checked.filter(key => String(raw?.[key] || '').trim() !== '');
  return {
    checked: checked.length,
    present: present.length,
    missing: checked.filter(key => !present.includes(key)).map(factoryCafe24FieldLabelByApiField),
  };
}

async function factorySyncCafe24ProductImages(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-product-images',
      'cafe24',
      draft => factorySyncCafe24ProductImages({
        ...options,
        factory: draft,
        render: false,
      }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const explicitProductNo = String(options.productNo || options.cafe24ProductNo || '').trim();
  const explicitMallId = String(options.mallId || '').trim();
  const target = explicitProductNo ? null : factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = explicitProductNo ? {} : (parseCafe24Raw(target) || {});
  const productNo = explicitProductNo || target?.product_no || raw.product_no || factory.product.finalDb?.product_no || factory.product.finalDb?.cafe24_product_no || '';
  if (!productNo) {
    factoryLog('Cafe24 이미지 업로드 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  const emitProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  const payload = factoryCafe24ImagePayload(factory);
  const slotCount = FACTORY_CAFE24_IMAGE_SLOTS.filter(slot => payload[slot.key]).length;
  if (!slotCount) {
    factoryLog('Cafe24 이미지 업로드 중단: 업로드할 이미지 파일을 먼저 선택해주세요.', 'error', factory);
    return false;
  }
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}에 이미지 ${slotCount}개를 실제 업로드합니다.\n\n${factoryCafe24ImagePayloadSummary(payload)}\n\n계속할까요?`);
    if (!ok) return false;
  }
  const mallId = explicitMallId || target?.mall_id || raw.mall_id || CAFE24_CONTROL_API.defaultMallId;
  factory.product.cafe24ApiStatus = `Cafe24 이미지 업로드 중: #${productNo} · ${slotCount}개 슬롯`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  emitProgress(factory.product.cafe24ApiStatus, options.progressStart || 96, 'info');
  try {
    const body = await callCafe24Console('POST', `/api/v2/admin/products/${encodeURIComponent(productNo)}/images`, {
      mallId,
      body: payload,
      executeDirect: true,
    }, `Upload Cafe24 product images ${productNo}`);
    await factoryExecuteCafe24ControlBody(body, {
      attempts: 60,
      delayMs: 1000,
      onProgress: ({ attempt, attempts, job }) => {
        const status = String(job?.status || '대기 중');
        const start = Number(options.progressStart || 96);
        const end = Number(options.progressEnd || 98);
        const progress = Math.min(end, start + Math.round((attempt / attempts) * Math.max(1, end - start)));
        emitProgress(`Cafe24 이미지 업로드 실행 확인 ${attempt}/${attempts}: ${status}`, progress, status === 'failed' || status === 'partial' ? 'error' : 'info');
      },
    });
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 이미지 업로드 완료: #${productNo} · ${slotCount}개 슬롯`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    emitProgress(current.product.cafe24ApiStatus, options.progressEnd || 98, 'ok');
    try {
      const detail = await fetchCafe24ProductFullByNo(productNo, mallId);
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `images-saved:${productNo}`, 999, 0)]);
        const verification = factoryVerifyCafe24ImageEcho(payload, parseCafe24Raw(detail) || detail.raw || detail);
        factoryRememberCafe24SyncResult(current, 'images', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}/images`,
          ok: !verification.missing.length,
          summary: `${verification.present}/${verification.checked}개 이미지 경로 확인`,
          detail: verification.missing.length ? `누락: ${verification.missing.join(', ')}` : '',
        });
        if (!verification.missing.length) {
          factoryLog(`Cafe24 이미지 재조회 확인 완료: ${verification.present}/${verification.checked}개 이미지 경로 확인`, 'ok', current);
        } else {
          factoryLog(`Cafe24 이미지 재조회 확인 필요: ${verification.missing.join(', ')} 경로가 응답에서 비어 있습니다.`, 'error', current);
        }
      } else {
        factoryRememberCafe24SyncResult(current, 'images', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}/images`,
          ok: false,
          summary: '이미지 업로드 후 상세 재조회 결과가 비어 있습니다.',
        });
      }
    } catch(e) {
      current.product.cafe24SyncResults = current.product.cafe24SyncResults || {};
      factoryRememberCafe24SyncResult(current, 'images', {
        productNo,
        endpoint: `/api/v2/admin/products/${productNo}/images`,
        ok: false,
        summary: '이미지 업로드 후 상세 재조회 보류',
        error: e.message || String(e),
      });
      factoryLog(`이미지 업로드 후 Cafe24 상세 재조회 보류: ${e.message || e}`, 'error', current);
    }
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 이미지 업로드 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'images', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/images`,
      ok: false,
      summary: '이미지 업로드 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryCafe24AdditionalImageResponseRaw(body = {}) {
  return body?.data?.response?.additionalimage
    || body?.response?.additionalimage
    || body?.additionalimage
    || body?.data?.additionalimage
    || body?.data?.response
    || body?.response
    || body?.data
    || body
    || {};
}

function factoryVerifyCafe24AdditionalImagesEcho(expectedCount = 0, raw = {}) {
  const values = Array.isArray(raw?.additional_image)
    ? raw.additional_image
    : (Array.isArray(raw?.additional_images) ? raw.additional_images : []);
  return {
    expectedCount,
    actualCount: values.length,
    matched: values.length >= Math.min(expectedCount, 20),
  };
}

async function factorySyncCafe24AdditionalImages(mode = 'create', options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-additional-images',
      'cafe24',
      draft => factorySyncCafe24AdditionalImages(mode, {
        ...options,
        factory: draft,
        render: false,
      }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const explicitProductNo = String(options.productNo || '').trim();
  const explicitMallId = String(options.mallId || '').trim();
  const target = explicitProductNo ? null : factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = target ? (parseCafe24Raw(target) || {}) : {};
  const productNo = explicitProductNo || target?.product_no || raw.product_no || factory.product.finalDb?.product_no || factory.product.finalDb?.cafe24_product_no || '';
  if (!productNo) {
    factoryLog('Cafe24 추가 이미지 동기화 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  const endpointBlockedReason = factoryCafe24EndpointDisabledReason(factory, 'additionalImages', '추가 이미지 API', productNo);
  if (endpointBlockedReason) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 추가 이미지 동기화 중단: ${endpointBlockedReason}`;
    factoryRememberCafe24SyncResult(current, 'additionalImages', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/additionalimages`,
      ok: false,
      summary: '전용 API 상태 점검 실패로 실행하지 않음',
      error: endpointBlockedReason,
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
  const images = factoryCafe24AdditionalImagesPayload(factory);
  if (!images.length) {
    factoryLog('Cafe24 추가 이미지 동기화 중단: 업로드할 추가 이미지 파일을 먼저 선택해주세요.', 'error', factory);
    return false;
  }
  const method = mode === 'update' ? 'PUT' : 'POST';
  const actionLabel = method === 'PUT' ? '교체/업데이트' : '등록/추가';
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}의 추가 이미지 ${images.length}장을 실제 ${actionLabel}합니다.\n\n${method === 'PUT' ? '기존 추가 이미지 구성이 바뀔 수 있습니다.' : '기존 추가 이미지 뒤에 추가 등록합니다.'}\n\n계속할까요?`);
    if (!ok) return false;
  }
  const mallId = explicitMallId || target?.mall_id || raw.mall_id || CAFE24_CONTROL_API.defaultMallId;
  factory.product.cafe24ApiStatus = `Cafe24 추가 이미지 ${actionLabel} 중: #${productNo} · ${images.length}장`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const body = await callCafe24Console(method, `/api/v2/admin/products/${encodeURIComponent(productNo)}/additionalimages`, {
      mallId,
      body: { additional_image: images },
      executeDirect: true,
    }, `${method === 'PUT' ? 'Update' : 'Create'} Cafe24 product additional images ${productNo}`);
    await factoryExecuteCafe24ControlBody(body, {
      attempts: 60,
      delayMs: 1000,
      onProgress: options.onProgress,
    });
    const responseRaw = factoryCafe24AdditionalImageResponseRaw(body);
    const responseUrls = factoryCafe24AdditionalImageUrlsFromRaw(responseRaw, factory);
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 추가 이미지 ${actionLabel} 완료: #${productNo} · ${images.length}장`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    try {
      const detail = await fetchCafe24ProductFullByNo(productNo, mallId);
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `additional-images-saved:${productNo}`, 999, 0)]);
        const detailRaw = parseCafe24Raw(detail) || detail.raw || detail;
        const verification = responseUrls.length
          ? { expectedCount: images.length, actualCount: responseUrls.length, matched: responseUrls.length >= Math.min(images.length, 20) }
          : factoryVerifyCafe24AdditionalImagesEcho(images.length, detailRaw);
        factoryRememberCafe24SyncResult(current, 'additionalImages', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}/additionalimages`,
          ok: verification.matched,
          summary: `기대 ${verification.expectedCount}장 · 응답 ${verification.actualCount}장`,
          detail: `${actionLabel} 방식`,
        });
        if (verification.matched) {
          factoryLog(`Cafe24 추가 이미지 재조회 확인 완료: ${verification.actualCount}장 확인`, 'ok', current);
        } else {
          factoryLog(`Cafe24 추가 이미지 재조회 확인 필요: 기대 ${verification.expectedCount}장, 응답 ${verification.actualCount}장`, 'error', current);
        }
      } else {
        factoryRememberCafe24SyncResult(current, 'additionalImages', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}/additionalimages`,
          ok: false,
          summary: '추가 이미지 동기화 후 상세 재조회 결과가 비어 있습니다.',
          detail: `${actionLabel} 방식`,
        });
      }
    } catch(e) {
      factoryRememberCafe24SyncResult(current, 'additionalImages', {
        productNo,
        endpoint: `/api/v2/admin/products/${productNo}/additionalimages`,
        ok: false,
        summary: '추가 이미지 동기화 후 상세 재조회 보류',
        error: e.message || String(e),
      });
      factoryLog(`추가 이미지 동기화 후 Cafe24 상세 재조회 보류: ${e.message || e}`, 'error', current);
    }
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 추가 이미지 ${actionLabel} 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'additionalImages', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/additionalimages`,
      ok: false,
      summary: `추가 이미지 ${actionLabel} 실패`,
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryCafe24DetailInlineImageDataUrls(html = '') {
  const text = String(html || '');
  const matches = text.match(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/ig) || [];
  return Array.from(new Set(matches.map(item => item.trim()).filter(Boolean))).slice(0, 50);
}

function factoryCafe24DetailBase64FromDataUrl(dataUrl = '') {
  const raw = String(dataUrl || '').trim();
  const comma = raw.indexOf(',');
  return comma >= 0 ? raw.slice(comma + 1).trim() : raw;
}

function factoryCafe24AdditionalImageUrlsFromRaw(raw = {}, factory = factoryRuntimeReadFactory()) {
  const values = Array.isArray(raw?.additional_image)
    ? raw.additional_image
    : (Array.isArray(raw?.additional_images) ? raw.additional_images : (raw?.additional_image ? [raw.additional_image] : []));
  return values
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.url || item.big || item.medium || item.small || item.path || item.image || item.src || item.additional_image || '';
      return '';
    })
    .map(value => typeof factoryCafe24ImageDisplayUrl === 'function' ? factoryCafe24ImageDisplayUrl(value, factory) : String(value || '').trim())
    .filter(Boolean);
}

function factoryCafe24ReplaceDetailInlineImages(html = '', dataUrls = [], uploadedUrls = []) {
  let next = String(html || '');
  dataUrls.forEach((dataUrl, index) => {
    const url = String(uploadedUrls[index] || '').trim();
    if (!dataUrl || !url) return;
    next = next.split(dataUrl).join(url);
  });
  return next;
}

function factoryCafe24DetailImageSrcValues(html = '') {
  const text = String(html || '');
  const values = [];
  text.replace(/<img\b[^>]*\bsrc=(["'])(.*?)\1/ig, (_match, _quote, src) => {
    const value = String(src || '').trim();
    if (value) values.push(value);
    return _match;
  });
  return Array.from(new Set(values));
}

function factoryCafe24IsLocalDetailImageUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (/^data:image\//i.test(raw)) return false;
  return /\/api\/local-archive\/assets\/[^/\s]+\/image/i.test(raw) ||
    /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/local-archive\//i.test(raw);
}

function factoryCafe24ResolveLocalDetailImageUrl(url = '') {
  const raw = String(url || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = (typeof factoryBackendBaseUrl === 'function'
    ? factoryBackendBaseUrl()
    : (state.backendBaseUrl || 'http://127.0.0.1:5050')).replace(/\/+$/, '');
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

async function factoryCafe24BlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('이미지 원본 읽기 실패'));
    reader.readAsDataURL(blob);
  });
}

async function factoryCafe24HydrateLocalDetailImages(html = '', options = {}) {
  let next = String(html || '');
  const localUrls = factoryCafe24DetailImageSrcValues(next).filter(factoryCafe24IsLocalDetailImageUrl).slice(0, 20);
  if (!localUrls.length) return { html: next, replaced: 0 };
  const emitProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  let replaced = 0;
  for (let index = 0; index < localUrls.length; index += 1) {
    const original = localUrls[index];
    const url = factoryCafe24ResolveLocalDetailImageUrl(original);
    emitProgress(`상세페이지 로컬 이미지 원본 연결 ${index + 1}/${localUrls.length}`, options.progressStart || 96, 'info');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`상세페이지 로컬 이미지 원본을 읽지 못했습니다: HTTP ${res.status}`);
    const blob = await res.blob();
    const dataUrl = await factoryCafe24BlobToDataUrl(blob);
    if (!/^data:image\//i.test(dataUrl)) throw new Error('상세페이지 로컬 이미지가 이미지 원본으로 변환되지 않았습니다.');
    next = next.split(original).join(dataUrl);
    replaced += 1;
  }
  emitProgress(`상세페이지 로컬 이미지 원본 연결 완료: ${replaced}장`, options.progressStart || 96, 'ok');
  return { html: next, replaced };
}

async function factoryUploadCafe24DetailInlineImages(productNo, mallId, html = '', options = {}) {
  const id = String(productNo || '').trim();
  if (!id) throw new Error('상세페이지 이미지 업로드 중단: Cafe24 상품번호가 없습니다.');
  const dataUrls = factoryCafe24DetailInlineImageDataUrls(html);
  if (!dataUrls.length) return { html: String(html || ''), uploadedUrls: [], dataUrls: [] };
  if (dataUrls.length > 20) {
    throw new Error(`상세페이지 이미지가 ${dataUrls.length}장입니다. Cafe24 추가 이미지 API는 한 번에 최대 20장까지만 안전하게 연결합니다.`);
  }
  const emitProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  const factory = options.factory || factoryRuntimeReadFactory();
  const payloadImages = dataUrls.map(factoryCafe24DetailBase64FromDataUrl).filter(Boolean);
  emitProgress(`상세페이지 이미지 Cafe24 업로드 준비: ${payloadImages.length}장`, options.progressStart || 97, 'info');
  const body = await callCafe24Console('POST', `/api/v2/admin/products/${encodeURIComponent(id)}/additionalimages`, {
    mallId,
    body: { additional_image: payloadImages },
    executeDirect: true,
  }, `Upload Cafe24 detail section images ${id}`);
  await factoryExecuteCafe24ControlBody(body, {
    attempts: 60,
    delayMs: 1000,
    onProgress: ({ attempt, attempts, job }) => {
      const status = String(job?.status || '대기 중');
      const start = Number(options.progressStart || 97);
      const end = Number(options.progressMid || 98);
      const progress = Math.min(end, start + Math.round((attempt / attempts) * Math.max(1, end - start)));
      emitProgress(`상세페이지 이미지 업로드 실행 확인 ${attempt}/${attempts}: ${status}`, progress, status === 'failed' || status === 'partial' ? 'error' : 'info');
    },
  });
  const responseRaw = factoryCafe24AdditionalImageResponseRaw(body);
  const responseUrls = factoryCafe24AdditionalImageUrlsFromRaw(responseRaw, factory);
  const uploadedUrls = responseUrls.slice(Math.max(0, responseUrls.length - payloadImages.length));
  if (uploadedUrls.length < payloadImages.length) {
    throw new Error(`상세페이지 이미지 URL 확인 실패: 업로드 ${payloadImages.length}장, 재조회 URL ${uploadedUrls.length}장`);
  }
  const replacedHtml = factoryCafe24ReplaceDetailInlineImages(html, dataUrls, uploadedUrls);
  emitProgress(`상세페이지 이미지 URL 치환 완료: ${uploadedUrls.length}장`, options.progressMid || 98, 'ok');
  return { html: replacedHtml, uploadedUrls, dataUrls };
}

function factoryCafe24SavedDetailHtmlFromDetail(detail = {}) {
  const raw = parseCafe24Raw(detail) || detail?.raw || detail?.rawProduct || detail || {};
  return String(
    raw.description ||
    raw.mobile_description ||
    detail?.description ||
    detail?.mobile_description ||
    detail?.raw?.description ||
    detail?.raw?.mobile_description ||
    ''
  );
}

async function factoryVerifyCafe24SavedDetailHtml(productNo, mallId, options = {}) {
  const id = String(productNo || '').trim();
  const attempts = Math.max(1, Number(options.attempts || 30));
  const delayMs = Math.max(250, Number(options.delayMs || 2000));
  const emitProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  let lastDetail = null;
  let lastCheck = null;
  let lastHtml = '';
  for (let index = 0; index < attempts; index += 1) {
    lastDetail = await fetchCafe24ProductFullByNo(id, mallId);
    lastHtml = factoryCafe24SavedDetailHtmlFromDetail(lastDetail);
    lastCheck = typeof factoryCafe24DetailPayloadPreflight === 'function'
      ? factoryCafe24DetailPayloadPreflight({ description: lastHtml, mobile_description: lastHtml })
      : { ok: true, issues: [] };
    if (lastHtml.trim() && lastCheck.ok) {
      emitProgress(`Cafe24 상세페이지 재조회 확인 완료: ${index + 1}/${attempts}`, options.progressEnd || 99, 'ok');
      return { detail: lastDetail, html: lastHtml, check: lastCheck, attempts: index + 1 };
    }
    const issueText = lastHtml.trim()
      ? ((lastCheck?.issues || []).join(' ') || '상세 HTML 안전검사 미통과')
      : '상세설명 비어 있음';
    const start = Number(options.progressMid || options.progressStart || 98);
    const end = Number(options.progressEnd || 99);
    const progress = Math.min(end, start + Math.round(((index + 1) / attempts) * Math.max(1, end - start)));
    emitProgress(`Cafe24 상세페이지 재조회 대기 ${index + 1}/${attempts}: ${issueText}`, progress, 'info');
    if (index < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return { detail: lastDetail, html: lastHtml, check: lastCheck, attempts };
}

async function factoryPublishCafe24ScopedDetailHtml(productNo, options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:publish-detail-html',
      'cafe24',
      draft => factoryPublishCafe24ScopedDetailHtml(productNo, {
        ...options,
        factory: draft,
        render: false,
      }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const id = String(productNo || '').trim();
  if (!id) throw new Error('상세페이지 저장 중단: Cafe24 상품번호가 없습니다.');
  const mallId = String(options.mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  const factory = options.factory;
  const scoped = options.html
    ? { html: String(options.html || ''), source: options.source || 'provided' }
    : factoryCafe24CurrentScopedDetailHtml(factory);
  const rawHtmlBase = String(scoped?.html || '').trim();
  const rawHtml = typeof factoryCafe24ExpandLightImageHtmlForTransfer === 'function'
    ? factoryCafe24ExpandLightImageHtmlForTransfer(rawHtmlBase).trim()
    : rawHtmlBase;
  if (!rawHtml) throw new Error('상세페이지 저장 중단: 현재 작업 상세페이지 HTML이 없습니다.');
  const emitProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  const hydrated = await factoryCafe24HydrateLocalDetailImages(rawHtml, {
    onProgress: emitProgress,
    progressStart: options.progressStart || 97,
  });
  if (hydrated.replaced) {
    emitProgress(`상세페이지 로컬 이미지 ${hydrated.replaced}장을 Cafe24 업로드 대상으로 변환했습니다.`, options.progressStart || 97, 'ok');
  }
  const uploadResult = await factoryUploadCafe24DetailInlineImages(id, mallId, hydrated.html, {
    factory,
    onProgress: emitProgress,
    progressStart: options.progressStart || 97,
    progressMid: options.progressMid || 98,
  });
  const html = uploadResult.html;
  const product = {
    description: html,
    mobile_description: html,
    separated_mobile_description: 'F',
  };
  const preflight = typeof factoryCafe24DetailPayloadPreflight === 'function'
    ? factoryCafe24DetailPayloadPreflight(product)
    : { ok: true, issues: [] };
  if (!preflight.ok) {
    throw new Error(`상세페이지 HTML 안전검사 실패: ${(preflight.issues || []).join(' ') || 'base64 이미지가 남아 있습니다.'}`);
  }
  emitProgress(`Cafe24 상세페이지 HTML 저장 중: #${id}`, options.progressMid || 98, 'info');
  const body = await callCafe24Console('PUT', `/api/v2/admin/products/${encodeURIComponent(id)}`, {
    mallId,
    body: { product },
    executeDirect: html.length > 100000,
  }, `Update Cafe24 product detail HTML ${id}`);
  await factoryExecuteCafe24ControlBody(body, {
    attempts: 60,
    delayMs: 1000,
    onProgress: ({ attempt, attempts, job }) => {
      const status = String(job?.status || '대기 중');
      const start = Number(options.progressMid || 98);
      const end = Number(options.progressEnd || 99);
      const progress = Math.min(end, start + Math.round((attempt / attempts) * Math.max(1, end - start)));
      emitProgress(`상세페이지 HTML 저장 확인 ${attempt}/${attempts}: ${status}`, progress, status === 'failed' || status === 'partial' ? 'error' : 'info');
    },
  });
  const verification = await factoryVerifyCafe24SavedDetailHtml(id, mallId, {
    onProgress: emitProgress,
    progressMid: options.progressMid || 98,
    progressEnd: options.progressEnd || 99,
    attempts: options.verifyAttempts || 30,
    delayMs: options.verifyDelayMs || 2000,
  });
  const detail = verification.detail;
  const savedHtml = verification.html;
  if (!savedHtml.trim() || !verification.check?.ok) {
    throw new Error('상세페이지 HTML 저장 후 재조회에서 base64 이미지가 남았거나 상세설명이 비어 있습니다.');
  }
  const current = factory;
  current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `detail-html-saved:${id}`, 999, 0)]);
  factoryRememberCafe24SyncResult(current, 'detailHtml', {
    productNo: id,
    endpoint: `/api/v2/admin/products/${id}`,
    ok: true,
    summary: `상세 HTML 저장 완료 · 이미지 URL ${uploadResult.uploadedUrls.length}장`,
    detail: scoped.source || '현재 작업 상세페이지',
  });
  current.product.cafe24ApiStatus = `Cafe24 상세페이지 HTML 저장 완료: #${id} · 이미지 URL ${uploadResult.uploadedUrls.length}장`;
  factoryLog(current.product.cafe24ApiStatus, 'ok', current);
  emitProgress(current.product.cafe24ApiStatus, options.progressEnd || 99, 'ok');
  return { detail, uploadedUrls: uploadResult.uploadedUrls, html };
}

function factoryUpdateCafe24IconDraftFromDom(options = {}) {
  const { renderAfter = false, factory: providedFactory = null } = options;
  if (!providedFactory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-form-drafts',
      { ...options, render: renderAfter, saveMode: renderAfter ? 'now' : 'schedule' },
      draft => factoryUpdateCafe24IconDraftFromDom({ ...options, factory: draft, renderAfter: false }),
    );
  }
  const factory = providedFactory;
  const draft = factoryCafe24IconDraft(factory);
  const selected = Array.from(document.querySelectorAll('[data-factory-cafe24-icon-code]:checked'))
    .map(input => String(input.dataset.factoryCafe24IconCode || '').trim())
    .filter(Boolean);
  if (selected.length > 5) {
    factoryLog('Cafe24 상품 아이콘은 최대 5개까지만 선택할 수 있습니다. 앞의 5개만 유지합니다.', 'error', factory);
  }
  draft.selectedCodes = selected.slice(0, 5);
  draft.use_show_date = document.getElementById('factoryCafe24IconUseShowDate')?.value === 'T' ? 'T' : 'F';
  draft.show_start_date = document.getElementById('factoryCafe24IconStart')?.value || '';
  draft.show_end_date = document.getElementById('factoryCafe24IconEnd')?.value || '';
  draft.touched = true;
  factory.product.cafe24IconDraft = draft;
  return draft;
}

async function factoryRefreshCafe24Icons(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-icons',
      'cafe24',
      draft => factoryRefreshCafe24Icons({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target) || {};
  const productNo = target?.product_no || raw.product_no || factory.product.finalDb?.product_no || factory.product.finalDb?.cafe24_product_no || '';
  const mallId = target?.mall_id || raw.mall_id || CAFE24_CONTROL_API.defaultMallId;
  factory.product.cafe24ApiStatus = productNo
    ? `Cafe24 아이콘 목록과 상품 #${productNo} 아이콘을 불러오는 중입니다.`
    : 'Cafe24 아이콘 목록을 불러오는 중입니다.';
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const [catalog, productIcons] = await Promise.all([
      fetchCafe24IconCatalog(mallId),
      productNo ? fetchCafe24ProductIconsByNo(productNo, mallId).catch(e => {
        factoryLog(`Cafe24 상품 아이콘 재조회 보류: ${e.message || e}`, 'error', factory);
        return null;
      }) : Promise.resolve(null),
    ]);
    const current = factory;
    const draft = factoryCafe24IconDraft(current);
    draft.iconCatalog = catalog;
    draft.iconFetchedAt = Date.now();
    if (productIcons) {
      draft.selectedCodes = (Array.isArray(productIcons.image_list) ? productIcons.image_list : [])
        .map(item => String(item.code || '').trim())
        .filter(Boolean)
        .slice(0, 5);
      draft.use_show_date = /^T$/i.test(String(productIcons.use_show_date || '')) ? 'T' : 'F';
      draft.show_start_date = String(productIcons.show_start_date || '').slice(0, 16);
      draft.show_end_date = String(productIcons.show_end_date || '').slice(0, 16);
      draft.touched = true;
      if (productNo) {
        const detail = {
          mall_id: mallId,
          product_no: productNo,
          product_code: target?.product_code || raw.product_code || '',
          product_name: target?.product_name || raw.product_name || '',
          raw: { ...(raw || {}), product_icons: productIcons },
          rawProduct: { ...(raw || {}), product_icons: productIcons },
          product_icons: productIcons,
          source: 'Cafe24 Admin API icons',
          matched_at: Date.now(),
        };
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `icons:${productNo}`, 999, 0)]);
      }
    }
    current.product.cafe24IconDraft = draft;
    current.product.cafe24ApiStatus = `Cafe24 아이콘 목록 갱신 완료: 전체 ${catalog.length}개${productIcons ? ` · 현재 상품 ${draft.selectedCodes.length}개` : ''}`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return true;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 아이콘 목록 조회 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryVerifyCafe24IconEcho(payload = {}, rawIcons = {}) {
  const expected = (payload.image_list || []).map(item => String(item.code || '').trim()).filter(Boolean);
  const actual = (Array.isArray(rawIcons?.image_list) ? rawIcons.image_list : [])
    .map(item => String(item.code || '').trim())
    .filter(Boolean);
  const missing = expected.filter(code => !actual.includes(code));
  return {
    expected: expected.length,
    actual: actual.length,
    matched: !missing.length,
    missing,
  };
}

async function factorySyncCafe24Icons(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-icons',
      'cafe24',
      draft => factorySyncCafe24Icons({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target) || {};
  const productNo = target?.product_no || raw.product_no || factory.product.finalDb?.product_no || factory.product.finalDb?.cafe24_product_no || '';
  if (!productNo) {
    factoryLog('Cafe24 상품 아이콘 동기화 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  factoryUpdateCafe24IconDraftFromDom({ factory });
  const payload = factoryCafe24IconPayload(factory);
  if (!payload.image_list.length) {
    factoryLog('Cafe24 상품 아이콘 동기화 중단: 선택한 아이콘이 없습니다.', 'error', factory);
    return false;
  }
  const mallId = target?.mall_id || raw.mall_id || CAFE24_CONTROL_API.defaultMallId;
  const codes = payload.image_list.map(item => item.code).join(', ');
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}에 아이콘 ${payload.image_list.length}개를 실제 동기화합니다.\n\n${codes}\n\n계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 상품 아이콘 동기화 중: #${productNo} · ${codes}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const body = await callCafe24Console('PUT', `/api/v2/admin/products/${encodeURIComponent(productNo)}/icons`, {
      mallId,
      body: { icon: payload },
    }, `Update Cafe24 product icons ${productNo}`);
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 상품 아이콘 동기화 완료: #${productNo} · ${codes}`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    try {
      const detail = await fetchCafe24ProductFullByNo(productNo, mallId);
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `icons-saved:${productNo}`, 999, 0)]);
        const actualRaw = parseCafe24Raw(detail) || detail.raw || detail;
        const verification = factoryVerifyCafe24IconEcho(payload, actualRaw.product_icons || actualRaw.icons || {});
        factoryRememberCafe24SyncResult(current, 'icons', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}/icons`,
          ok: verification.matched,
          summary: `기대 ${verification.expected}개 · 응답 ${verification.actual}개`,
          detail: verification.missing.length ? `누락: ${verification.missing.join(', ')}` : codes,
        });
        if (verification.matched) {
          factoryLog(`Cafe24 상품 아이콘 재조회 확인 완료: ${verification.actual}개 확인`, 'ok', current);
        } else {
          factoryLog(`Cafe24 상품 아이콘 재조회 확인 필요: 누락 ${verification.missing.join(', ')}`, 'error', current);
        }
      } else {
        factoryRememberCafe24SyncResult(current, 'icons', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}/icons`,
          ok: false,
          summary: '상품 아이콘 동기화 후 상세 재조회 결과가 비어 있습니다.',
          detail: codes,
        });
      }
    } catch(e) {
      factoryRememberCafe24SyncResult(current, 'icons', {
        productNo,
        endpoint: `/api/v2/admin/products/${productNo}/icons`,
        ok: false,
        summary: '상품 아이콘 동기화 후 상세 재조회 보류',
        detail: codes,
        error: e.message || String(e),
      });
      factoryLog(`상품 아이콘 동기화 후 Cafe24 상세 재조회 보류: ${e.message || e}`, 'error', current);
    }
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 상품 아이콘 동기화 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'icons', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/icons`,
      ok: false,
      summary: '상품 아이콘 동기화 실패',
      detail: codes,
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryApplyCafe24RelationDraftFromDom(options = {}) {
  const { renderAfter = false, factory: providedFactory = null } = options;
  if (!providedFactory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-form-drafts',
      { ...options, render: renderAfter, saveMode: renderAfter ? 'now' : 'schedule' },
      draft => factoryApplyCafe24RelationDraftFromDom({ ...options, factory: draft, renderAfter: false }),
    );
  }
  const factory = providedFactory;
  const draft = factoryCafe24RelationDraft(factory);
  const rows = [];
  document.querySelectorAll('[data-factory-cafe24-relation-row]').forEach(rowEl => {
    const index = String(rowEl.dataset.factoryCafe24RelationRow || '');
    const row = { key: `relation_${Number(index) + 1}`, product_no: '', product_name: '', interrelated: 'F' };
    rowEl.querySelectorAll('[data-factory-cafe24-relation-field]').forEach(input => {
      const [, field] = String(input.dataset.factoryCafe24RelationField || '').split(':');
      if (!field) return;
      row[field] = input.value || '';
    });
    if (row.product_no || row.product_name) rows.push(row);
  });
  draft.rows = rows.length ? rows : [{ key: 'relation_1', product_no: '', product_name: '', interrelated: 'F' }];
  draft.touched = true;
  factory.product.cafe24RelationDraft = draft;
  return draft;
}

function factoryAddCafe24RelationRow() {
  const factory = factoryRuntimeReadFactory();
  const draft = factoryCafe24RelationDraft(factory);
  draft.rows.push({ key: `relation_${draft.rows.length + 1}`, product_no: '', product_name: '', interrelated: 'F' });
  draft.touched = true;
  saveLastWorkNow();
  render();
}

function factoryRemoveCafe24RelationRow(index) {
  const factory = factoryRuntimeReadFactory();
  const draft = factoryCafe24RelationDraft(factory);
  const removeIndex = Number(index);
  draft.rows = draft.rows.filter((_, i) => i !== removeIndex);
  if (!draft.rows.length) draft.rows = [{ key: 'relation_1', product_no: '', product_name: '', interrelated: 'F' }];
  draft.touched = true;
  saveLastWorkNow();
  render();
}

function factoryVerifyCafe24RelationEcho(expectedRows = [], raw = {}) {
  const actualRows = factoryCafe24RelationRowsFromValue(raw.relational_product || raw.relational_products);
  const expected = expectedRows.map(row => String(row.product_no || '').trim()).filter(Boolean);
  const actual = actualRows.map(row => String(row.product_no || '').trim()).filter(Boolean);
  const missing = expected.filter(no => !actual.includes(no));
  return {
    expected: expected.length,
    actual: actual.length,
    matched: !missing.length,
    missing,
    message: missing.length ? `누락 관련상품 ${missing.join(', ')}` : `관련상품 ${actual.length}개 중 요청 ${expected.length}개 확인`,
  };
}

async function factorySyncCafe24Relations(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-relations',
      'cafe24',
      draft => factorySyncCafe24Relations({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryApplyCafe24RelationDraftFromDom({ factory });
  const { target, raw, productNo, mallId } = factoryCafe24TargetInfo(factory);
  const plan = factoryCafe24RelationPayload(factory);
  if (!productNo) {
    factoryLog('관련상품 저장 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  if (!plan.rows.length) {
    factoryLog('관련상품 저장 중단: 관련 상품번호를 1개 이상 입력해주세요.', 'error', factory);
    return false;
  }
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}의 관련상품 ${plan.rows.length}개를 실제 저장합니다.\n\n${plan.rows.map(row => `#${row.product_no}`).join(', ')}\n\n계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 관련상품 저장 중: 상품 #${productNo} · ${plan.rows.length}개`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const body = await callCafe24Console('PUT', `/api/v2/admin/products/${encodeURIComponent(productNo)}`, {
      mallId,
      body: { product: plan.payload },
    }, `Update Cafe24 product relations ${productNo}`);
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 관련상품 저장 완료: 상품 #${productNo}`;
    try {
      const detail = await fetchCafe24ProductFullByNo(productNo, mallId);
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `relations-saved:${productNo}`, 999, 0)]);
        const verification = factoryVerifyCafe24RelationEcho(plan.rows, parseCafe24Raw(detail) || detail.raw || detail);
        factoryRememberCafe24SyncResult(current, 'relations', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}`,
          ok: verification.matched,
          summary: verification.message,
          detail: 'relational_product만 별도 저장',
        });
      }
    } catch(e) {
      factoryRememberCafe24SyncResult(current, 'relations', {
        productNo,
        endpoint: `/api/v2/admin/products/${productNo}`,
        ok: false,
        summary: '관련상품 저장 후 상세 재조회 보류',
        error: e.message || String(e),
      });
    }
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 관련상품 저장 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'relations', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}`,
      ok: false,
      summary: '관련상품 저장 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryRefreshCafe24Promotions(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-promotions',
      'cafe24',
      draft => factoryRefreshCafe24Promotions({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  factory.product.cafe24ApiStatus = `Cafe24 혜택/쿠폰 목록 조회 중${productNo ? `: 상품 #${productNo}` : ''}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const [benefits, coupons] = await Promise.all([
      fetchCafe24Benefits(mallId).catch(e => {
        factoryLog(`Cafe24 혜택 목록 조회 보류: ${e.message || e}`, 'error', factory);
        return [];
      }),
      fetchCafe24Coupons(mallId).catch(e => {
        factoryLog(`Cafe24 쿠폰 목록 조회 보류: ${e.message || e}`, 'error', factory);
        return [];
      }),
    ]);
    const current = factory;
    const draft = factoryCafe24PromotionDraft(current);
    draft.benefits = benefits;
    draft.coupons = coupons;
    draft.fetchedAt = Date.now();
    current.product.cafe24PromotionDraft = draft;
    current.product.cafe24ApiStatus = `Cafe24 혜택/쿠폰 목록 조회 완료: 혜택 ${benefits.length}개 · 쿠폰 ${coupons.length}개`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return { benefits, coupons };
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 혜택/쿠폰 목록 조회 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryUpdateCafe24SeoTagsDraftFromDom(options = {}) {
  const { renderAfter = false, factory: providedFactory = null } = options;
  if (!providedFactory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-form-drafts',
      { ...options, render: renderAfter, saveMode: renderAfter ? 'now' : 'schedule' },
      draft => factoryUpdateCafe24SeoTagsDraftFromDom({ ...options, factory: draft, renderAfter: false }),
    );
  }
  const factory = providedFactory;
  const seo = factoryCafe24SeoDraft(factory);
  const tags = factoryCafe24TagsDraft(factory);
  const title = document.getElementById('factoryCafe24SeoTitle');
  const author = document.getElementById('factoryCafe24SeoAuthor');
  const exposure = document.getElementById('factoryCafe24SeoExposure');
  const alt = document.getElementById('factoryCafe24SeoAlt');
  const description = document.getElementById('factoryCafe24SeoDescription');
  const keywords = document.getElementById('factoryCafe24SeoKeywords');
  const tagInput = document.getElementById('factoryCafe24Tags');
  if (title) seo.metaTitle = title.value || '';
  if (author) seo.metaAuthor = author.value || '';
  if (exposure) seo.searchEngineExposure = exposure.value === 'F' ? 'F' : 'T';
  if (alt) seo.metaAlt = alt.value || '';
  if (description) seo.metaDescription = description.value || '';
  if (keywords) seo.metaKeywords = keywords.value || '';
  if (title || author || exposure || alt || description || keywords) {
    seo.touched = true;
    if (!factoryCafe24SeoChanged(factory)) seo.touched = false;
  }
  if (tagInput) {
    tags.tags = factorySplitCafe24Tags(tagInput.value);
    const next = factorySplitCafe24Tags(tags.tags);
    const current = factorySplitCafe24Tags(tags.originalTags || []);
    const currentKeys = new Set(current.map(factoryDbNormalizeKey));
    const nextKeys = new Set(next.map(factoryDbNormalizeKey));
    tags.touched = next.some(tag => !currentKeys.has(factoryDbNormalizeKey(tag))) ||
      current.some(tag => !nextKeys.has(factoryDbNormalizeKey(tag)));
    const setting = factoryDbFieldSetting(factory, 'search_keywords', true);
    setting.manualValue = next.join('\n');
    setting.manualTouched = true;
    setting.enabled = true;
    tags.manualSourceValue = setting.manualValue;
    factoryUpdateFinalDbFromFields(factory);
  }
  factory.product.cafe24SeoDraft = seo;
  factory.product.cafe24TagsDraft = tags;
  return { seo, tags };
}

async function factoryRefreshCafe24SeoTags(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-seo-tags',
      'cafe24',
      draft => factoryRefreshCafe24SeoTags({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  if (!productNo) {
    factoryLog('SEO/태그 조회 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 SEO/태그 조회 중: 상품 #${productNo}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const [seo, tags] = await Promise.all([
      fetchCafe24ProductSeoByNo(productNo, mallId).catch(e => {
        factoryLog(`Cafe24 SEO 조회 실패: ${e.message || e}`, 'error', factory);
        return null;
      }),
      fetchCafe24ProductTagsByNo(productNo, mallId).catch(e => {
        factoryLog(`Cafe24 태그 조회 실패: ${e.message || e}`, 'error', factory);
        return [];
      }),
    ]);
    const current = factory;
    const seoDraft = factoryCafe24SeoDraft(current);
    if (seo) {
      seoDraft.metaTitle = String(seo.meta_title || '');
      seoDraft.metaAuthor = String(seo.meta_author || '');
      seoDraft.metaDescription = String(seo.meta_description || '');
      seoDraft.metaKeywords = String(seo.meta_keywords || '');
      seoDraft.metaAlt = String(seo.meta_alt || '');
      seoDraft.searchEngineExposure = /^F$/i.test(String(seo.search_engine_exposure || '')) ? 'F' : 'T';
      seoDraft.original = cloneData({
        metaTitle: seoDraft.metaTitle,
        metaAuthor: seoDraft.metaAuthor,
        metaDescription: seoDraft.metaDescription,
        metaKeywords: seoDraft.metaKeywords,
        metaAlt: seoDraft.metaAlt,
        searchEngineExposure: seoDraft.searchEngineExposure,
      });
      seoDraft.touched = false;
    }
    const tagDraft = factoryCafe24TagsDraft(current);
    tagDraft.tags = factorySplitCafe24Tags(tags);
    tagDraft.originalTags = factorySplitCafe24Tags(tags);
    tagDraft.originalSourceKey = factoryCafe24TagSourceKey(tagDraft.originalTags);
    tagDraft.originalProductKey = factoryCafe24CurrentProductKey(current) || String(productNo || '').trim();
    tagDraft.touched = false;
    tagDraft.fetchedAt = Date.now();
    current.product.cafe24SeoDraft = seoDraft;
    current.product.cafe24TagsDraft = tagDraft;
    current.product.cafe24ApiStatus = `Cafe24 SEO/태그 조회 완료: SEO ${seo ? '확인' : '없음'} · 태그 ${tagDraft.tags.length}개`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return { seo, tags: tagDraft.tags };
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 SEO/태그 조회 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryVerifyCafe24SeoEcho(expected = {}, actual = {}) {
  const fields = ['meta_title', 'meta_author', 'meta_description', 'meta_keywords', 'meta_alt', 'search_engine_exposure'];
  const mismatches = fields.filter(key => String(expected[key] ?? '').trim() !== String(actual?.[key] ?? '').trim());
  return {
    checked: fields.length,
    matched: fields.length - mismatches.length,
    ok: !mismatches.length,
    message: mismatches.length ? `SEO 값 확인 필요: ${mismatches.join(', ')}` : 'SEO 필드 재조회 일치',
  };
}

async function factorySyncCafe24Seo(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-seo',
      'cafe24',
      draft => factorySyncCafe24Seo({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateCafe24SeoTagsDraftFromDom({ factory });
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  const payload = factoryCafe24SeoPayload(factory);
  if (!productNo) {
    factoryLog('SEO 저장 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  if (!payload) {
    factoryLog('SEO 저장 중단: 수정된 SEO 값이 없습니다.', 'error', factory);
    return false;
  }
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}의 검색엔진 SEO 값을 실제 저장합니다.\n\n제목: ${payload.meta_title || '(비움)'}\n검색 노출: ${payload.search_engine_exposure === 'F' ? '노출안함' : '노출함'}\n\n계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 SEO 저장 중: 상품 #${productNo}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const body = await callCafe24Console('PUT', `/api/v2/admin/products/${encodeURIComponent(productNo)}/seo`, {
      mallId,
      body: payload,
    }, `Update Cafe24 product SEO ${productNo}`);
    await factoryExecuteCafe24ControlBody(body, { attempts: 45, delayMs: 800 });
    const current = factory;
    const seo = await fetchCafe24ProductSeoByNo(productNo, mallId).catch(() => null);
    const verification = seo ? factoryVerifyCafe24SeoEcho(payload, seo) : { ok: false, message: 'SEO 저장 후 재조회 실패' };
    const draft = factoryCafe24SeoDraft(current);
    if (seo) {
      draft.metaTitle = String(seo.meta_title || '');
      draft.metaAuthor = String(seo.meta_author || '');
      draft.metaDescription = String(seo.meta_description || '');
      draft.metaKeywords = String(seo.meta_keywords || '');
      draft.metaAlt = String(seo.meta_alt || '');
      draft.searchEngineExposure = /^F$/i.test(String(seo.search_engine_exposure || '')) ? 'F' : 'T';
      draft.original = cloneData({
        metaTitle: draft.metaTitle,
        metaAuthor: draft.metaAuthor,
        metaDescription: draft.metaDescription,
        metaKeywords: draft.metaKeywords,
        metaAlt: draft.metaAlt,
        searchEngineExposure: draft.searchEngineExposure,
      });
      draft.touched = false;
    }
    current.product.cafe24SeoDraft = draft;
    current.product.cafe24ApiStatus = `Cafe24 SEO 저장 완료: 상품 #${productNo}`;
    factoryRememberCafe24SyncResult(current, 'seo', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/seo`,
      ok: verification.ok,
      summary: verification.message,
      detail: 'Products SEO 전용 API',
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return true;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 SEO 저장 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'seo', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/seo`,
      ok: false,
      summary: 'SEO 저장 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryFetchCafe24ShopProductByNo(productNo, shopNo = 2, mallId = CAFE24_CONTROL_API.defaultMallId) {
  const body = await callCafe24Console('GET', `/api/v2/admin/products/${encodeURIComponent(productNo)}?shop_no=${encodeURIComponent(shopNo)}&embed=categories,options`, {
    mallId,
  }, `Read Cafe24 shop ${shopNo} product ${productNo}`);
  return factoryExtractCafe24ProductFromBody(body);
}

async function factoryWaitForCafe24EnglishShopNameEcho(productNo, shopNo, mallId, expectedName) {
  const targetName = String(expectedName || '').trim();
  let lastProduct = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    lastProduct = await factoryFetchCafe24ShopProductByNo(productNo, shopNo, mallId).catch(() => null);
    if (String(lastProduct?.product_name || '').trim() === targetName) {
      return { ok: true, attempts: attempt, product: lastProduct };
    }
    await sleep(700);
  }
  return { ok: false, attempts: 12, product: lastProduct };
}

async function factoryWaitForCafe24DefaultAndEnglishShopNames(productNo, mallId, defaultName, englishName) {
  const expectedDefault = String(defaultName || '').trim();
  const expectedEnglish = String(englishName || '').trim();
  let defaultProduct = null;
  let englishProduct = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    defaultProduct = await factoryFetchCafe24ShopProductByNo(productNo, 1, mallId).catch(() => null);
    englishProduct = await factoryFetchCafe24ShopProductByNo(productNo, 2, mallId).catch(() => null);
    const defaultOk = !expectedDefault || String(defaultProduct?.product_name || '').trim() === expectedDefault;
    const englishOk = String(englishProduct?.product_name || '').trim() === expectedEnglish;
    if (defaultOk && englishOk) {
      return { ok: true, attempts: attempt, defaultProduct, englishProduct };
    }
    await sleep(700);
  }
  return { ok: false, attempts: 12, defaultProduct, englishProduct };
}

async function factorySyncCafe24EnglishShopName(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-english-shop-name',
      'cafe24',
      draft => factorySyncCafe24EnglishShopName({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  const plan = factoryCafe24EnglishShopNameSyncPlan(factory);
  if (!productNo) {
    factoryLog('영문 쇼핑몰 상품명 저장 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  if (!plan.available) {
    factoryLog('영문 쇼핑몰 상품명 점검 중단: 사용할 영문상품명이 없습니다.', 'error', factory);
    return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 영문 쇼핑몰 상품명 자동 저장 보류: #${productNo} · ${plan.shopLabel}`;
  factoryLog('Cafe24 영문몰 상품명은 shop_no별 상품명 저장 API가 검증될 때까지 자동 전송하지 않습니다. 현재는 기본 상품의 eng_product_name 저장 여부만 확인합니다.', 'error', factory);
  try {
    const defaultProduct = await factoryFetchCafe24ShopProductByNo(productNo, 1, mallId).catch(() => null);
    const currentEnglish = await factoryFetchCafe24ShopProductByNo(productNo, plan.shopNo, mallId).catch(() => null);
    let translationName = '';
    try {
      const translationBody = await callCafe24Console('GET', `/api/v2/admin/translations/products?shop_no=${encodeURIComponent(plan.shopNo)}&product_no=${encodeURIComponent(productNo)}&_=${Date.now()}`, {
        mallId,
      }, `Read Cafe24 translation product ${productNo}/${plan.shopNo}`);
      const translationSource = unwrapApiHubBody(translationBody);
      const translationProduct = (Array.isArray(translationSource?.products) ? translationSource.products[0] : null)
        || translationSource?.product
        || translationSource;
      const translationRows = Array.isArray(translationProduct?.translations) ? translationProduct.translations : [];
      translationName = String(translationRows.find(row => String(row?.product_name || '').trim())?.product_name || '').trim();
    } catch(e) {
      translationName = '';
    }
    const engNameOk = String(defaultProduct?.eng_product_name || '').trim() === plan.productName;
    const shopNameOk = String(currentEnglish?.product_name || '').trim() === plan.productName || translationName === plan.productName;
    const current = factory;
    current.product.cafe24ApiStatus = shopNameOk
      ? `Cafe24 영문 쇼핑몰 상품명 반영완료: #${productNo} · ${plan.shopLabel}`
      : `Cafe24 영문 쇼핑몰 상품명 자동 저장 보류: eng_product_name ${engNameOk ? '확인됨' : '확인 필요'} · ${plan.shopLabel} 상품명 별도 API 미검증`;
    factoryRememberCafe24SyncResult(current, 'englishShopName', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo} · shop_no=${plan.shopNo} 읽기 전용 점검`,
      ok: shopNameOk,
      summary: shopNameOk ? `반영완료: ${plan.productName}` : 'shop_no별 상품명 직접 저장 경로 미검증',
      detail: `eng_product_name: ${defaultProduct?.eng_product_name || '(비어 있음)'} · ${plan.shopLabel} 상품명: ${currentEnglish?.product_name || '(재조회 없음)'} · 번역 레코드: ${translationName || '(비어 있음)'}. 기본 상품 API로는 eng_product_name 저장까지만 검증되었습니다.`,
    });
    factoryLog(current.product.cafe24ApiStatus, shopNameOk ? 'ok' : 'error', current);
    return shopNameOk;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 영문 쇼핑몰 상품명 점검 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'englishShopName', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo} · shop_no=${plan.shopNo} 읽기 전용 점검`,
      ok: false,
      summary: '영문 쇼핑몰 상품명 점검 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factorySyncCafe24Tags(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-tags',
      'cafe24',
      draft => factorySyncCafe24Tags({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateCafe24SeoTagsDraftFromDom({ factory });
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  const plan = factoryCafe24TagsPayload(factory);
  if (!productNo) {
    factoryLog('태그 동기화 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  if (!plan || (!plan.add.length && !plan.remove.length)) {
    factoryLog('태그 동기화 중단: 추가/삭제할 태그 변경점이 없습니다.', 'error', factory);
    return false;
  }
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}의 상품 태그를 실제 동기화합니다.\n\n추가: ${plan.add.length ? plan.add.join(', ') : '없음'}\n삭제: ${plan.remove.length ? plan.remove.join(', ') : '없음'}\n\n계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 태그 동기화 중: 추가 ${plan.add.length}개 · 삭제 ${plan.remove.length}개`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    if (plan.add.length) {
      await callCafe24Console('POST', `/api/v2/admin/products/${encodeURIComponent(productNo)}/tags`, {
        mallId,
        body: { tags: plan.add },
      }, `Create Cafe24 product tags ${productNo}`);
    }
    for (const tag of plan.remove) {
      await callCafe24Console('DELETE', `/api/v2/admin/products/${encodeURIComponent(productNo)}/tags/${encodeURIComponent(tag)}`, {
        mallId,
      }, `Delete Cafe24 product tag ${productNo}/${tag}`);
    }
    const current = factory;
    const tags = await fetchCafe24ProductTagsByNo(productNo, mallId).catch(() => []);
    const draft = factoryCafe24TagsDraft(current);
    draft.tags = factorySplitCafe24Tags(tags);
    draft.originalTags = factorySplitCafe24Tags(tags);
    draft.originalSourceKey = factoryCafe24TagSourceKey(draft.originalTags);
    draft.originalProductKey = factoryCafe24CurrentProductKey(current) || String(productNo || '').trim();
    draft.touched = false;
    draft.fetchedAt = Date.now();
    current.product.cafe24TagsDraft = draft;
    const nextKeys = new Set(draft.tags.map(factoryDbNormalizeKey));
    const missing = plan.tags.filter(tag => !nextKeys.has(factoryDbNormalizeKey(tag)));
    current.product.cafe24ApiStatus = `Cafe24 태그 동기화 완료: 현재 ${draft.tags.length}개`;
    factoryRememberCafe24SyncResult(current, 'tags', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/tags`,
      ok: !missing.length,
      summary: missing.length ? `재조회 누락 태그: ${missing.join(', ')}` : `태그 ${draft.tags.length}개 재조회 확인`,
      detail: `추가 ${plan.add.length}개 · 삭제 ${plan.remove.length}개`,
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return true;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 태그 동기화 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'tags', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}/tags`,
      ok: false,
      summary: '태그 동기화 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryUpdateCafe24MemoDraftFromDom({ renderAfter = false, factory: providedFactory = null } = {}) {
  const factory = providedFactory || factoryRuntimeReadFactory();
  const draft = factoryCafe24MemoDraft(factory);
  draft.memoNo = document.getElementById('factoryCafe24MemoNo')?.value || draft.memoNo || '';
  draft.authorId = document.getElementById('factoryCafe24MemoAuthor')?.value || '';
  draft.memo = document.getElementById('factoryCafe24MemoText')?.value || '';
  draft.touched = true;
  if (renderAfter) {
    saveLastWorkNow();
    render();
  } else if (!providedFactory) {
    scheduleLastWorkSave();
  }
  return draft;
}

function factorySelectCafe24MemoFromDom() {
  const factory = factoryRuntimeReadFactory();
  const draft = factoryCafe24MemoDraft(factory);
  draft.memoNo = document.getElementById('factoryCafe24MemoNo')?.value || '';
  const selected = draft.memos.find(item => String(item.memo_no) === String(draft.memoNo));
  draft.authorId = selected?.author_id || draft.authorId || '';
  draft.memo = selected?.memo || '';
  draft.touched = false;
  saveLastWorkNow();
  render();
}

async function factoryRefreshCafe24Memos(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-memos',
      'cafe24',
      draft => factoryRefreshCafe24Memos({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  if (!productNo) {
    factoryLog('Cafe24 메모 조회 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 관리 메모 조회 중: 상품 #${productNo}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const memos = await fetchCafe24ProductMemosByNo(productNo, mallId);
    const current = factory;
    const draft = factoryCafe24MemoDraft(current);
    draft.memos = memos;
    draft.fetchedAt = Date.now();
    if (!draft.touched && memos[0]) {
      draft.memoNo = memos[0].memo_no || '';
      draft.authorId = memos[0].author_id || draft.authorId || '';
      draft.memo = memos[0].memo || '';
    }
    current.product.cafe24MemoDraft = draft;
    current.product.cafe24ApiStatus = `Cafe24 관리 메모 조회 완료: ${memos.length}개`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return memos;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 관리 메모 조회 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factorySyncCafe24Memo(mode = 'create', options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-memo',
      'cafe24',
      draft => factorySyncCafe24Memo(mode, { ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateCafe24MemoDraftFromDom({ factory });
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  const draft = factoryCafe24MemoDraft(factory);
  const payload = factoryCafe24MemoPayload(factory);
  if (!productNo) {
    factoryLog('Cafe24 메모 저장 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  if (!payload) {
    factoryLog('Cafe24 메모 저장 중단: 작성자 ID와 메모 내용을 입력해주세요.', 'error', factory);
    return false;
  }
  const method = mode === 'update' ? 'PUT' : 'POST';
  if (method === 'PUT' && !draft.memoNo) {
    factoryLog('Cafe24 메모 수정 중단: 수정할 기존 메모를 선택해주세요.', 'error', factory);
    return false;
  }
  const path = method === 'PUT'
    ? `/api/v2/admin/products/${encodeURIComponent(productNo)}/memos/${encodeURIComponent(draft.memoNo)}`
    : `/api/v2/admin/products/${encodeURIComponent(productNo)}/memos`;
  const actionLabel = method === 'PUT' ? '수정' : '등록';
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}의 관리 메모를 실제 ${actionLabel}합니다.\n\n작성자: ${payload.author_id}\n메모: ${payload.memo.slice(0, 120)}\n\n계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 관리 메모 ${actionLabel} 중: 상품 #${productNo}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const body = await callCafe24Console(method, path, {
      mallId,
      body: { memo: payload },
    }, `${method === 'PUT' ? 'Update' : 'Create'} Cafe24 product memo ${productNo}`);
    const current = factory;
    const memos = await fetchCafe24ProductMemosByNo(productNo, mallId).catch(() => []);
    const currentDraft = factoryCafe24MemoDraft(current);
    currentDraft.memos = memos;
    currentDraft.fetchedAt = Date.now();
    currentDraft.touched = false;
    current.product.cafe24ApiStatus = `Cafe24 관리 메모 ${actionLabel} 완료: 상품 #${productNo}`;
    factoryRememberCafe24SyncResult(current, 'memos', {
      productNo,
      endpoint: path,
      ok: true,
      summary: `메모 ${actionLabel} 완료 · 현재 ${memos.length}개`,
      detail: payload.memo.slice(0, 80),
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 관리 메모 ${actionLabel} 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'memos', {
      productNo,
      endpoint: path,
      ok: false,
      summary: `메모 ${actionLabel} 실패`,
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryDeleteCafe24Memo(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:delete-memo',
      'cafe24',
      draft => factoryDeleteCafe24Memo({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  const draft = factoryCafe24MemoDraft(factory);
  if (!productNo || !draft.memoNo) {
    factoryLog('Cafe24 메모 삭제 중단: 상품번호와 삭제할 메모를 선택해주세요.', 'error', factory);
    return false;
  }
  const path = `/api/v2/admin/products/${encodeURIComponent(productNo)}/memos/${encodeURIComponent(draft.memoNo)}`;
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}의 메모 #${draft.memoNo}를 실제 삭제합니다.\n\n계속할까요?`);
    if (!ok) return false;
  }
  try {
    const body = await callCafe24Console('DELETE', path, { mallId }, `Delete Cafe24 product memo ${productNo}`);
    const current = factory;
    const currentDraft = factoryCafe24MemoDraft(current);
    currentDraft.memos = await fetchCafe24ProductMemosByNo(productNo, mallId).catch(() => []);
    currentDraft.memoNo = '';
    currentDraft.memo = '';
    currentDraft.touched = false;
    current.product.cafe24ApiStatus = `Cafe24 관리 메모 삭제 완료: 상품 #${productNo}`;
    factoryRememberCafe24SyncResult(current, 'memos', {
      productNo,
      endpoint: path,
      ok: true,
      summary: '메모 삭제 완료',
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 관리 메모 삭제 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'memos', {
      productNo,
      endpoint: path,
      ok: false,
      summary: '메모 삭제 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryUpdateCafe24MainDraftFromDom({ renderAfter = false, factory: providedFactory = null } = {}) {
  const factory = providedFactory || factoryRuntimeReadFactory();
  const draft = factoryCafe24MainDraft(factory);
  draft.displayGroup = document.getElementById('factoryCafe24MainDisplayGroup')?.value || '';
  draft.fixedSort = document.getElementById('factoryCafe24MainFixedSort')?.value === 'T' ? 'T' : 'F';
  draft.fixProductNo = document.getElementById('factoryCafe24MainFixProductNo')?.value || '';
  draft.touched = true;
  if (renderAfter) {
    saveLastWorkNow();
    render();
  } else if (!providedFactory) {
    scheduleLastWorkSave();
  }
  return draft;
}

async function factoryRefreshCafe24MainProducts(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-main-products',
      'cafe24',
      draft => factoryRefreshCafe24MainProducts({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateCafe24MainDraftFromDom({ factory });
  const { mallId } = factoryCafe24TargetInfo(factory);
  const draft = factoryCafe24MainDraft(factory);
  if (!draft.displayGroup) {
    factoryLog('메인 진열 조회 중단: 메인 진열 번호를 입력해주세요.', 'error', factory);
    return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 메인 진열 목록 조회 중: 진열 #${draft.displayGroup}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const products = await fetchCafe24MainProducts(draft.displayGroup, mallId);
    const current = factory;
    const currentDraft = factoryCafe24MainDraft(current);
    currentDraft.products = products;
    currentDraft.fetchedAt = Date.now();
    current.product.cafe24ApiStatus = `Cafe24 메인 진열 목록 조회 완료: ${products.length}개`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return products;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 메인 진열 목록 조회 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factorySyncCafe24MainProduct(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-main-product',
      'cafe24',
      draft => factorySyncCafe24MainProduct({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateCafe24MainDraftFromDom({ factory });
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  const plan = factoryCafe24MainPayload(factory);
  if (!productNo || !plan) {
    factoryLog('메인 진열 저장 중단: Cafe24 상품번호와 메인 진열 번호를 확인해주세요.', 'error', factory);
    return false;
  }
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 메인 진열 #${plan.displayGroup}에 상품 #${productNo}을 실제 등록/갱신합니다.\n\n계속할까요?`);
    if (!ok) return false;
  }
  const path = `/api/v2/admin/mains/${encodeURIComponent(plan.displayGroup)}/products`;
  factory.product.cafe24ApiStatus = `Cafe24 메인 진열 저장 중: 진열 #${plan.displayGroup} · 상품 #${productNo}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const body = await callCafe24Console('POST', path, {
      mallId,
      body: { product: plan.payload },
    }, `Add Cafe24 main product ${plan.displayGroup}/${productNo}`);
    const current = factory;
    const currentDraft = factoryCafe24MainDraft(current);
    currentDraft.products = await fetchCafe24MainProducts(plan.displayGroup, mallId).catch(() => currentDraft.products || []);
    currentDraft.fetchedAt = Date.now();
    current.product.cafe24ApiStatus = `Cafe24 메인 진열 저장 완료: 진열 #${plan.displayGroup} · 상품 #${productNo}`;
    const found = currentDraft.products.some(item => String(item.product_no) === String(productNo));
    factoryRememberCafe24SyncResult(current, 'mains', {
      productNo,
      endpoint: path,
      ok: found,
      summary: found ? '메인 진열 목록에서 상품 확인' : '저장 후 목록에서 상품 확인 필요',
      detail: `진열 #${plan.displayGroup}`,
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 메인 진열 저장 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'mains', {
      productNo,
      endpoint: path,
      ok: false,
      summary: '메인 진열 저장 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryDeleteCafe24MainProduct(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:delete-main-product',
      'cafe24',
      draft => factoryDeleteCafe24MainProduct({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateCafe24MainDraftFromDom({ factory });
  const { productNo, mallId } = factoryCafe24TargetInfo(factory);
  const draft = factoryCafe24MainDraft(factory);
  if (!productNo || !draft.displayGroup) {
    factoryLog('메인 진열 제거 중단: Cafe24 상품번호와 메인 진열 번호를 확인해주세요.', 'error', factory);
    return false;
  }
  const path = `/api/v2/admin/mains/${encodeURIComponent(draft.displayGroup)}/products/${encodeURIComponent(productNo)}`;
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 메인 진열 #${draft.displayGroup}에서 상품 #${productNo}을 실제 제거합니다.\n\n계속할까요?`);
    if (!ok) return false;
  }
  try {
    const body = await callCafe24Console('DELETE', path, { mallId }, `Delete Cafe24 main product ${draft.displayGroup}/${productNo}`);
    const current = factory;
    const currentDraft = factoryCafe24MainDraft(current);
    currentDraft.products = await fetchCafe24MainProducts(draft.displayGroup, mallId).catch(() => []);
    currentDraft.fetchedAt = Date.now();
    current.product.cafe24ApiStatus = `Cafe24 메인 진열 제거 완료: 진열 #${draft.displayGroup} · 상품 #${productNo}`;
    factoryRememberCafe24SyncResult(current, 'mains', {
      productNo,
      endpoint: path,
      ok: true,
      summary: '메인 진열 제거 완료',
      detail: `진열 #${draft.displayGroup}`,
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 메인 진열 제거 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'mains', {
      productNo,
      endpoint: path,
      ok: false,
      summary: '메인 진열 제거 실패',
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factorySyncCafe24CategoryLink(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-category-link',
      'cafe24',
      draft => factorySyncCafe24CategoryLink({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const model = factoryUpdateFinalDbFromFields(factory);
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target);
  const productNo = target?.product_no
    || raw.product_no
    || (selectedFieldMode ? '' : (model.finalDb.product_no || model.finalDb.cafe24_product_no || ''));
  const categoryRows = factorySelectedCafe24CategoryRows(factory, model.finalDb);
  if (!productNo) {
    factoryLog('카테고리 연결 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  if (!categoryRows.length) {
    factoryLog('카테고리 연결 중단: 카테고리를 먼저 선택해주세요.', 'error', factory);
    return false;
  }
  const categoryText = categoryRows.map(row => `#${row.category_no}${row.recommend === 'T' ? ' 추천' : ''}${row.new === 'T' ? ' 신상품' : ''}`).join(', ');
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${productNo}을 카테고리 ${categoryText}에 실제 연결합니다.\n\n계속할까요?`);
    if (!ok) return false;
  }
  const mallId = target?.mall_id || raw.mall_id || CAFE24_CONTROL_API.defaultMallId;
  factory.product.cafe24ApiStatus = `Cafe24 카테고리 연결 중: 상품 #${productNo} → ${categoryText}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const bodies = [];
    let rowsToConnect = categoryRows;
    try {
      const currentDetail = await fetchCafe24ProductFullByNo(productNo, mallId);
      const currentRaw = parseCafe24Raw(currentDetail) || currentDetail?.raw || currentDetail || {};
      const existingNos = factoryCafe24CategoryNoSet(currentRaw);
      rowsToConnect = categoryRows.filter(row => !existingNos.has(String(row.category_no || '').trim()));
      if (rowsToConnect.length !== categoryRows.length) {
        const skipped = categoryRows
          .filter(row => existingNos.has(String(row.category_no || '').trim()))
          .map(row => `#${row.category_no}`)
          .join(', ');
        factoryLog(`이미 연결된 Cafe24 카테고리는 중복 전송하지 않습니다: ${skipped}`, 'ok', factory);
      }
      if (!rowsToConnect.length) {
        const current = factory;
        const verification = factoryVerifyCafe24CategoryEcho(categoryRows, currentRaw);
        current.product.cafe24ApiStatus = `Cafe24 카테고리 재조회 확인 완료: ${verification.message}`;
        factoryRememberCafe24SyncResult(current, 'category', {
          productNo,
          endpoint: '/api/v2/admin/categories/{category_no}/products',
          ok: verification.matched,
          summary: verification.message,
          detail: categoryText,
        });
        factoryLog(current.product.cafe24ApiStatus, verification.matched ? 'ok' : 'error', current);
        return [];
      }
    } catch(e) {
      factoryLog(`카테고리 기존 연결 확인은 건너뛰고 전송을 계속합니다: ${e.message || e}`, 'error', factory);
    }
    for (const row of rowsToConnect) {
      const numericProductNo = Number(productNo);
      const productNoPayload = Number.isFinite(numericProductNo) ? numericProductNo : productNo;
      const body = await callCafe24Console('POST', `/api/v2/admin/categories/${encodeURIComponent(row.category_no)}/products`, {
        mallId,
        body: {
          product_no: [productNoPayload],
          display_group: row.display_group || '1',
          recommend: row.recommend === 'T' ? 'T' : 'F',
          new: row.new === 'T' ? 'T' : 'F',
        },
      }, `Connect Cafe24 category ${row.category_no} product ${productNo}`);
      await factoryExecuteCafe24ControlBody(body, { attempts: 45, delayMs: 800 });
      bodies.push(body);
    }
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 카테고리 연결 완료: 상품 #${productNo} → ${categoryText}`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    try {
      const detail = await fetchCafe24ProductFullByNo(productNo, mallId);
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `categories-saved:${productNo}`, 999, 0)]);
        const verification = factoryVerifyCafe24CategoryEcho(categoryRows, parseCafe24Raw(detail) || detail.raw || detail);
        factoryRememberCafe24SyncResult(current, 'category', {
          productNo,
          endpoint: '/api/v2/admin/categories/{category_no}/products',
          ok: verification.matched,
          summary: verification.message,
          detail: categoryText,
        });
        if (verification.matched) {
          factoryLog(`Cafe24 카테고리 재조회 확인 완료: ${verification.message}`, 'ok', current);
        } else {
          factoryLog(`Cafe24 카테고리 재조회 확인 필요: ${verification.message}`, 'error', current);
        }
      } else {
        factoryRememberCafe24SyncResult(current, 'category', {
          productNo,
          endpoint: '/api/v2/admin/categories/{category_no}/products',
          ok: false,
          summary: '카테고리 연결 후 상세 재조회 결과가 비어 있습니다.',
          detail: categoryText,
        });
      }
    } catch(e) {
      factoryRememberCafe24SyncResult(current, 'category', {
        productNo,
        endpoint: '/api/v2/admin/categories/{category_no}/products',
        ok: false,
        summary: '카테고리 연결 후 상세 재조회 보류',
        detail: categoryText,
        error: e.message || String(e),
      });
      factoryLog(`카테고리 연결 후 Cafe24 상세 재조회 보류: ${e.message || e}`, 'error', current);
    }
    return bodies;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 카테고리 연결 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'category', {
      productNo,
      endpoint: '/api/v2/admin/categories/{category_no}/products',
      ok: false,
      summary: '카테고리 연결 실패',
      detail: categoryText,
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factorySyncCafe24OptionsAndVariants(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:sync-options-variants',
      'cafe24',
      draft => factorySyncCafe24OptionsAndVariants({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const model = factoryUpdateFinalDbFromFields(factory);
  const plan = factoryBuildCafe24OptionSyncPlan(factory, model.finalDb);
  if (!plan.productNo) {
    factoryLog('Cafe24 옵션/품목 동기화 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  const optionActionCount = plan.optionUpdate ? 1 : 0;
  const actionCount = optionActionCount + plan.variantUpdates.length + plan.inventoryUpdates.length;
  if (!actionCount) {
    factoryLog('Cafe24 옵션/품목 동기화 중단: 동기화할 옵션 설정, 옵션값, 품목, 재고 값이 없습니다.', 'error', factory);
    return false;
  }
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24 상품 #${plan.productNo}의 옵션/품목/재고를 실제 동기화합니다.\n\n옵션 설정 ${plan.optionUpdate ? '1건' : '없음'}\n옵션그룹 ${plan.optionGroupCount}개\n옵션값 ${plan.optionValueTotal}개\n추가 입력 옵션 ${plan.optionExtras?.useAdditionalOption === 'T' ? `${plan.optionExtras.additionalOptions.length}개` : '사용안함'}\n파일 첨부 옵션 ${plan.optionExtras?.useAttachedFileOption === 'T' ? '사용함' : '사용안함'}\n품목 수정 ${plan.variantUpdates.length}건\n재고 수정 ${plan.inventoryUpdates.length}건\n\n${plan.warnings.join('\n')}\n\n계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 옵션/품목 동기화 중: #${plan.productNo} · ${actionCount}개 작업`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    if (plan.optionUpdate) {
      const optionBody = await callCafe24Console(plan.optionUpdate.method || 'PUT', plan.optionUpdate.path, {
        mallId: plan.mallId,
        body: plan.optionUpdate.body,
      }, `${plan.optionUpdate.method === 'POST' ? 'Create' : 'Update'} Cafe24 product options ${plan.productNo}`);
      await factoryExecuteCafe24ControlBody(optionBody, { attempts: 45, delayMs: 800 });
    }
    for (const [index, item] of plan.variantUpdates.entries()) {
      const stepState = factory;
      stepState.product.cafe24ApiStatus = `Cafe24 품목 수정 중: ${index + 1}/${plan.variantUpdates.length} · ${item.variantCode}`;
      factoryLog(stepState.product.cafe24ApiStatus, 'ok', stepState);
      const variantBody = await callCafe24Console('PUT', item.path, { mallId: plan.mallId, body: item.body }, `Update Cafe24 variant ${item.variantCode}`);
      await factoryExecuteCafe24ControlBody(variantBody, { attempts: 35, delayMs: 700 });
    }
    for (const [index, item] of plan.inventoryUpdates.entries()) {
      const stepState = factory;
      stepState.product.cafe24ApiStatus = `Cafe24 재고/품절표시 수정 중: ${index + 1}/${plan.inventoryUpdates.length} · ${item.variantCode}`;
      factoryLog(stepState.product.cafe24ApiStatus, 'ok', stepState);
      const inventoryBody = await callCafe24Console('PUT', item.path, {
        mallId: plan.mallId,
        body: item.body,
        executeDirect: true,
      }, `Update Cafe24 inventory ${item.variantCode}`);
      await factoryExecuteCafe24ControlBody(inventoryBody, { attempts: 35, delayMs: 700 });
    }
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 옵션/품목 실행 완료, 재조회 확인 중: 옵션그룹 ${plan.optionGroupCount}개 · 옵션값 ${plan.optionValueTotal}개 · 품목 ${plan.variantUpdates.length}건`;
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    try {
      const echo = await factoryWaitForCafe24OptionEcho(plan.productNo, plan.mallId, plan, {
        attempts: 30,
        delayMs: 1000,
      });
      const detail = echo.detail;
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `options-saved:${plan.productNo}`, 999, 0)]);
        const verification = echo.verification || factoryVerifyCafe24OptionEcho(plan, detail);
        factoryRememberCafe24SyncResult(current, 'options', {
          productNo: plan.productNo,
          endpoint: `/api/v2/admin/products/${plan.productNo}/options · variants · inventories`,
          ok: verification.matched,
          summary: verification.message,
          detail: `옵션그룹 ${verification.actualGroupCount}/${verification.expectedGroupCount}개 · 옵션값 ${verification.actualCount}/${verification.expectedCount}개 · 추가입력 ${verification.actualAdditionalOptionCount ?? 0}/${verification.expectedAdditionalOptionCount ?? 0}개 · 품목 ${verification.variantCount}개${echo.attempts > 1 ? ` · 재조회 ${echo.attempts}회` : ''}`,
        });
        if (verification.matched) {
          current.product.cafe24ApiStatus = `Cafe24 옵션/품목 반영완료: ${verification.message}`;
          factoryLog(`Cafe24 옵션/품목 재조회 확인 완료: ${verification.message}`, 'ok', current);
        } else {
          current.product.cafe24ApiStatus = `Cafe24 옵션/품목 저장 후 확인 필요: ${verification.message}`;
          factoryLog(`Cafe24 옵션/품목 재조회 확인 필요: ${verification.message}`, 'error', current);
        }
      } else {
        current.product.cafe24ApiStatus = `Cafe24 옵션/품목 저장 후 재조회 결과 없음: #${plan.productNo}`;
        factoryRememberCafe24SyncResult(current, 'options', {
          productNo: plan.productNo,
          endpoint: `/api/v2/admin/products/${plan.productNo}/options · variants · inventories`,
          ok: false,
          summary: '옵션 동기화 후 상세 재조회 결과가 비어 있습니다.',
          detail: `옵션그룹 ${plan.optionGroupCount}개 · 옵션값 ${plan.optionValueTotal}개 · 추가입력 ${plan.optionExtras?.additionalOptions?.length || 0}개 · 품목 수정 ${plan.variantUpdates.length}건 · 재고 수정 ${plan.inventoryUpdates.length}건`,
        });
      }
    } catch(e) {
      factoryRememberCafe24SyncResult(current, 'options', {
        productNo: plan.productNo,
        endpoint: `/api/v2/admin/products/${plan.productNo}/options · variants · inventories`,
        ok: false,
        summary: '옵션 동기화 후 Cafe24 재조회 보류',
        detail: `옵션그룹 ${plan.optionGroupCount}개 · 옵션값 ${plan.optionValueTotal}개 · 추가입력 ${plan.optionExtras?.additionalOptions?.length || 0}개 · 품목 수정 ${plan.variantUpdates.length}건 · 재고 수정 ${plan.inventoryUpdates.length}건`,
        error: e.message || String(e),
      });
      factoryLog(`옵션 동기화 후 Cafe24 재조회 보류: ${e.message || e}`, 'error', current);
    }
    return true;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 옵션/품목 동기화 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'options', {
      productNo: plan.productNo,
      endpoint: `/api/v2/admin/products/${plan.productNo}/options · variants · inventories`,
      ok: false,
      summary: '옵션/품목 동기화 실패',
      detail: `옵션그룹 ${plan.optionGroupCount}개 · 옵션값 ${plan.optionValueTotal}개 · 추가입력 ${plan.optionExtras?.additionalOptions?.length || 0}개 · 품목 수정 ${plan.variantUpdates.length}건 · 재고 수정 ${plan.inventoryUpdates.length}건`,
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryRunOptionContextMatch(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:run-option-context-match',
      'cafe24',
      draft => factoryRunOptionContextMatch({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const optionModel = factoryCafe24OptionEditorModel(factory);
  const payload = factoryOptionContextComparePayload(factory, optionModel);
  const canCompare = !!((payload.cafe24.name || payload.cafe24.groups.length) && (payload.sinhwa.name || payload.sinhwa.groups.length));
  if (!canCompare) {
    factoryLog('옵션 AI 매칭 중단: Cafe24와 신화사DB 옵션/상품명 자료가 모두 필요합니다.', 'error', factory);
    return false;
  }
  factory.product.cafe24OptionContextMatchBusy = true;
  factoryLog('Cafe24 ↔ 신화사DB 옵션 맥락 GPT OAuth 비교 시작', 'ok', factory);
  try {
    await refreshGptOAuthStatus({ silent: true });
    if (!isGptOAuthConnected()) {
      throw new Error('GPT OAuth 연결 상태를 확인할 수 없습니다. 모델 설정에서 상태 새로고침 또는 Chrome 로그인을 진행해주세요.');
    }
    const cfg = normalizeModelConfig(state.modelConfig);
    const client = new GptOAuthAPI(cfg.llmModel, {
      reasoningEffort: cfg.gptOAuthReasoningEffort,
      serviceTier: cfg.gptOAuthServiceTier,
    });
    const result = await client.compareCafe24SinhwaOptions(payload);
    const current = factory;
    current.product.cafe24OptionContextMatch = factoryNormalizeOptionContextMatch(result, payload);
    current.product.cafe24OptionContextMatchBusy = false;
    const label = current.product.cafe24OptionContextMatch.label || '검수 필요';
    factoryLog(`옵션 AI 매칭 완료: ${label} · ${current.product.cafe24OptionContextMatch.score}점`, current.product.cafe24OptionContextMatch.decision === 'mismatch' ? 'error' : 'ok', current);
    return current.product.cafe24OptionContextMatch;
  } catch(e) {
    const current = factory;
    current.product.cafe24OptionContextMatchBusy = false;
    current.product.cafe24OptionContextMatch = {
      decision: 'uncertain',
      score: 0,
      label: '비교 실패',
      reason: formatAppErrorMessage(e.message || String(e)),
      checkedAt: Date.now(),
      signature: factoryOptionContextSignature(payload),
      model: getGptOAuthModelLabel(),
    };
    factoryLog(`옵션 AI 매칭 실패: ${current.product.cafe24OptionContextMatch.reason}`, 'error', current);
    return false;
  }
}

function factoryCafe24ControlPlanFromBody(body) {
  const seen = new Set();
  const queue = [body];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    if (seen.has(item)) continue;
    seen.add(item);
    if (item.mode === 'plan' && item.plan && typeof item.plan === 'object') return item.plan;
    if (item.data && typeof item.data === 'object' && item.data.mode === 'plan' && item.data.plan) return item.data.plan;
    if (item.response && typeof item.response === 'object' && item.response.mode === 'plan' && item.response.plan) return item.response.plan;
    ['body', 'data', 'response', 'result'].forEach(key => {
      if (item[key] && typeof item[key] === 'object') queue.push(item[key]);
    });
  }
  return null;
}

function factoryCafe24ControlJobIdFromApproval(approved = {}) {
  const candidates = [
    approved?.jobRunId,
    approved?.job_run_id,
    approved?.job?.id,
    approved?.data?.jobRunId,
    approved?.data?.job_run_id,
    approved?.response?.jobRunId,
    approved?.response?.job_run_id,
  ];
  return String(candidates.find(value => value !== undefined && value !== null && String(value).trim()) || '').trim();
}

async function factoryExecuteCafe24ControlBody(body, options = {}) {
  const plan = factoryCafe24ControlPlanFromBody(body);
  if (!plan) return { body, plan: null, approved: null, job: null };
  const approved = await approveCafe24ControlPlan(plan, options);
  const jobRunId = factoryCafe24ControlJobIdFromApproval(approved);
  const job = await waitCafe24ControlJob(jobRunId, {
    attempts: options.attempts || 45,
    delayMs: options.delayMs || 800,
    onProgress: options.onProgress,
  });
  const status = String(job?.status || '').toLowerCase();
  if (!job || /queued|running/.test(status)) {
    throw new Error(`Control Tower 작업 완료 대기 시간이 초과되었습니다${jobRunId ? `: ${jobRunId}` : ''}`);
  }
  if (status === 'failed' || status === 'partial') {
    const jobError = typeof formatCafe24ControlJobError === 'function' ? formatCafe24ControlJobError(job) : '';
    throw new Error(`Control Tower 작업 ${status === 'partial' ? '부분 실패' : '실패'}${jobError ? `: ${jobError}` : ''}`);
  }
  return { body, plan, approved, job };
}

function factoryCafe24ControlPlanText(plan = {}) {
  const parts = [];
  if (plan.id) parts.push(`계획 ${plan.id}`);
  if (plan.status) parts.push(`상태 ${plan.status}`);
  if (plan.approval_requirement) {
    const requirement = plan.approval_requirement;
    parts.push(`승인 ${requirement?.required ? '확인 필요' : '자동'}`);
  }
  if (plan.summary) {
    if (typeof plan.summary === 'object') {
      const total = Number(plan.summary.total || 0);
      const apiOps = Number(plan.summary.api_operations || 0);
      parts.push(`요약 작업 ${total || apiOps || 0}개`);
    } else {
      parts.push(String(plan.summary));
    }
  }
  if (Array.isArray(plan.operations) && plan.operations.length) parts.push(`작업 ${plan.operations.length}개`);
  return parts.join(' · ') || 'Control Tower가 실행 계획만 생성했습니다.';
}

function factoryCafe24Delay(ms = 500) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function factoryCafe24IntegerOrNull(value) {
  const text = String(value ?? '').replace(/[^\d.-]/g, '').trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function factoryCafe24ObjectFromMaybeJson(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value ?? '').trim();
  if (!text || !/^[\[{]/.test(text)) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch(e) {
    return null;
  }
}

function factoryNormalizeCafe24ProductVolumeForSave(value) {
  const source = factoryCafe24ObjectFromMaybeJson(value);
  if (!source) return null;
  const use = String(source.use_product_volume ?? source.use ?? 'F').trim().toUpperCase();
  if (use !== 'T') return { use_product_volume: 'F' };
  const width = factoryCafe24IntegerOrNull(source.width ?? source.product_width);
  const height = factoryCafe24IntegerOrNull(source.height ?? source.product_height);
  const length = factoryCafe24IntegerOrNull(source.length ?? source.depth ?? source.product_length);
  const unit = String(source.unit || source.volume_unit || '').trim() || 'mm';
  if (width === null || height === null || length === null) return null;
  return { use_product_volume: 'T', unit, width, height, length };
}

const FACTORY_CAFE24_UNSUPPORTED_PRODUCT_PAYLOAD_FIELDS = [
  'cultural_tax_deduction',
  'price_excluding_tax',
  'product_volume',
  'product_condition',
  'product_used_month',
  'tax_type',
  'tax_calculation',
  'tax_rate',
];

function factoryRemoveCafe24UnsupportedProductPayloadFields(product = {}, notes = []) {
  if (!product || typeof product !== 'object') return [];
  const removed = FACTORY_CAFE24_UNSUPPORTED_PRODUCT_PAYLOAD_FIELDS
    .filter(field => Object.prototype.hasOwnProperty.call(product, field));
  removed.forEach(field => delete product[field]);
  if (removed.length && Array.isArray(notes)) {
    notes.push(`Cafe24가 이 몰에서 지원하지 않는 필드(${removed.map(factoryCafe24FieldLabelByApiField).join(', ')})는 전송에서 제외했습니다.`);
  }
  return removed;
}

function factoryNormalizeCafe24ProductPayloadForSave(product = {}, notes = []) {
  const next = { ...(product || {}) };
  factoryRemoveCafe24UnsupportedProductPayloadFields(next, notes);
  if (typeof factoryRemoveCafe24InvalidReferenceCodePayloadFields === 'function') {
    factoryRemoveCafe24InvalidReferenceCodePayloadFields(next, notes);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'product_volume')) {
    const normalized = factoryNormalizeCafe24ProductVolumeForSave(next.product_volume);
    if (normalized) {
      next.product_volume = normalized;
    } else {
      delete next.product_volume;
      notes.push('상품부피는 가로/세로/높이 3개 정수가 모두 있을 때만 Cafe24로 전송합니다.');
    }
  }
  const conditionalShippingFields = ['shipping_fee', 'shipping_fee_type', 'shipping_fee_by_product', 'prepaid_shipping_fee'];
  const removedShipping = conditionalShippingFields.filter(field => Object.prototype.hasOwnProperty.call(next, field));
  removedShipping.forEach(field => delete next[field]);
  if (removedShipping.length) {
    notes.push(`배송비 관련 필드(${removedShipping.map(factoryCafe24FieldLabelByApiField).join(', ')})는 Cafe24 조건부 오류를 막기 위해 기본 저장에서 제외했습니다.`);
  }
  const immutableUpdateFields = ['price_excluding_tax'];
  const removedImmutable = immutableUpdateFields.filter(field => Object.prototype.hasOwnProperty.call(next, field));
  removedImmutable.forEach(field => delete next[field]);
  if (removedImmutable.length) {
    notes.push(`Cafe24가 기존 상품에서 수정 불가로 거부하는 필드(${removedImmutable.map(factoryCafe24FieldLabelByApiField).join(', ')})는 기본 저장에서 제외했습니다.`);
  }
  return next;
}

async function factoryWaitForCafe24OptionEcho(productNo, mallId, plan, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 30));
  const delayMs = Math.max(250, Number(options.delayMs || 1000));
  let lastDetail = null;
  let lastVerification = null;
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      lastDetail = await fetchCafe24ProductFullByNo(productNo, mallId);
      lastDetail = await factoryAttachCafe24InventoryEchoes(lastDetail, mallId);
      if (lastDetail) {
        lastVerification = factoryVerifyCafe24OptionEcho(plan, lastDetail);
        if (lastVerification.matched) {
          return { detail: lastDetail, verification: lastVerification, attempts: index + 1, error: null };
        }
      }
    } catch(e) {
      lastError = e;
    }
    if (index < attempts - 1) await factoryCafe24Delay(delayMs);
  }
  return { detail: lastDetail, verification: lastVerification, attempts, error: lastError };
}

async function factoryAttachCafe24InventoryEchoes(detail, mallId = CAFE24_CONTROL_API.defaultMallId) {
  if (!detail) return detail;
  const raw = parseCafe24Raw(detail) || detail.raw || detail;
  const productNo = String(detail.product_no || raw.product_no || '').trim();
  const variants = Array.isArray(raw.variants)
    ? raw.variants
    : (Array.isArray(detail.variants) ? detail.variants : []);
  if (!productNo || !variants.length || typeof fetchCafe24VariantInventory !== 'function') return detail;
  const hydrated = [];
  for (const variant of variants) {
    const variantCode = String(variant?.variant_code || variant?.variantCode || '').trim();
    if (!variantCode) {
      hydrated.push(variant);
      continue;
    }
    try {
      const inventory = await fetchCafe24VariantInventory(productNo, variantCode, mallId);
      if (!inventory) {
        hydrated.push(variant);
        continue;
      }
      hydrated.push({
        ...variant,
        inventory,
        inventories: [inventory],
        use_inventory: inventory.use_inventory ?? variant.use_inventory,
        important_inventory: inventory.important_inventory ?? variant.important_inventory,
        inventory_control_type: inventory.inventory_control_type ?? variant.inventory_control_type,
        display_soldout: inventory.display_soldout ?? variant.display_soldout,
        quantity: inventory.quantity ?? variant.quantity,
        safety_inventory: inventory.safety_inventory ?? variant.safety_inventory,
      });
    } catch(e) {
      hydrated.push(variant);
    }
  }
  detail.raw = { ...(detail.raw || raw), variants: hydrated };
  detail.rawProduct = { ...(detail.rawProduct || {}), variants: hydrated };
  detail.variants = hydrated;
  return detail;
}

async function factoryWaitForCafe24ProductEcho(productNo, mallId, product, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 30));
  const delayMs = Math.max(250, Number(options.delayMs || 1000));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  let lastDetail = null;
  let lastVerification = null;
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    if (onProgress) {
      try { onProgress({ attempt: index + 1, attempts, phase: 'fetch' }); } catch(_) {}
    }
    try {
      lastDetail = options.full === true
        ? await fetchCafe24ProductFullByNo(productNo, mallId)
        : await fetchCafe24ProductDetailByNo(productNo, mallId);
      if (lastDetail) {
        lastVerification = factoryVerifyCafe24ProductEcho(product, parseCafe24Raw(lastDetail) || lastDetail.raw || lastDetail);
        if (onProgress) {
          try { onProgress({ attempt: index + 1, attempts, phase: 'verify', verification: lastVerification }); } catch(_) {}
        }
        if (!lastVerification.missing.length && !lastVerification.mismatches.length) {
          return { detail: lastDetail, verification: lastVerification, attempts: index + 1, error: null };
        }
      }
    } catch(e) {
      lastError = e;
    }
    if (index < attempts - 1) await factoryCafe24Delay(delayMs);
  }
  return { detail: lastDetail, verification: lastVerification, attempts, error: lastError };
}

function factoryStartCafe24SaveVerificationInBackground(params = {}) {
  const productNo = params.productNo;
  const mallId = params.mallId || CAFE24_CONTROL_API.defaultMallId;
  const product = params.product || {};
  const fieldNames = Array.isArray(params.fieldNames) ? params.fieldNames : Object.keys(product);
  const requireSingleField = params.requireSingleField === true;
  const rollback = params.rollback || null;
  const jobRunId = String(params.jobRunId || '').trim();
  const endpoint = `/api/v2/admin/products/${productNo}`;
  const operationToken = params.operationToken || factoryCafe24CaptureOperationToken();
  setTimeout(() => {
    const transaction = factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:save-product',
      { operationToken },
      async current => {
        try {
          if (jobRunId && typeof waitCafe24ControlJob === 'function') {
            const job = await waitCafe24ControlJob(jobRunId, { attempts: 35, delayMs: 800 });
            const status = String(job?.status || '').toLowerCase();
            if (!job || /queued|running/.test(status)) {
              throw new Error(`Control Tower 작업 완료 대기 시간이 초과되었습니다${jobRunId ? `: ${jobRunId}` : ''}`);
            }
            if (status === 'failed' || status === 'partial') {
              const jobError = typeof formatCafe24ControlJobError === 'function' ? formatCafe24ControlJobError(job) : '';
              throw new Error(`Control Tower 저장 ${status === 'partial' ? '부분 실패' : '실패'}${jobError ? `: ${jobError}` : ''}`);
            }
          }
          const echo = await factoryWaitForCafe24ProductEcho(productNo, mallId, product, {
            attempts: 30,
            delayMs: 1000,
          });
          const detail = echo.detail;
          if (detail) {
            current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `saved:${productNo}`, 999, 0)]);
            const verification = echo.verification || factoryVerifyCafe24ProductEcho(product, parseCafe24Raw(detail) || detail.raw || detail);
            current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
              type: requireSingleField ? 'single-field-verify' : 'update',
              productNo,
              product,
              verification,
              rollback: requireSingleField ? rollback : null,
            });
            const verified = !verification.missing.length && !verification.mismatches.length;
            factoryRememberCafe24SyncResult(current, 'product', {
              productNo,
              endpoint,
              ok: verified,
              label: requireSingleField ? 'Cafe24 1필드 저장' : 'Cafe24 상품 기본정보',
              summary: verified ? `반영완료: ${verification.matched}/${verification.checked}개 필드 일치` : `저장 후 확인 필요: ${verification.matched}/${verification.checked}개 필드 일치`,
              detail: `${fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 8).join(', ')}${jobRunId ? ` · 작업 ${jobRunId}` : ''}`,
            });
            if (verified) {
              current.product.cafe24ApiStatus = `${requireSingleField ? 'Cafe24 1필드 반영완료' : 'Cafe24 상품 기본정보 반영완료'}: #${productNo} ${verification.matched}/${verification.checked}개 필드 일치`;
              factoryLog(current.product.cafe24ApiStatus, 'ok', current);
            } else {
              const issues = [
                verification.missing.length ? `응답 누락 ${verification.missing.slice(0, 5).join(', ')}` : '',
                verification.mismatches.length ? `값 확인 필요 ${verification.mismatches.slice(0, 5).join(', ')}` : '',
              ].filter(Boolean).join(' · ');
              current.product.cafe24ApiStatus = `Cafe24 저장 후 확인 필요: #${productNo} ${issues}`;
              factoryLog(`Cafe24 저장 재조회 확인 필요: ${issues}`, 'error', current);
            }
          } else {
            current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
              type: requireSingleField ? 'single-field-verify' : 'update',
              productNo,
              product,
              verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
              message: '저장 후 상세 재조회 결과가 비어 있습니다.',
              rollback: requireSingleField ? rollback : null,
            });
            current.product.cafe24ApiStatus = `Cafe24 저장 후 재조회 결과 없음: #${productNo}`;
            factoryRememberCafe24SyncResult(current, 'product', {
              productNo,
              endpoint,
              ok: false,
              label: requireSingleField ? 'Cafe24 1필드 저장' : 'Cafe24 상품 기본정보',
              summary: '저장 후 상세 재조회 결과가 비어 있습니다.',
              detail: fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 8).join(', '),
            });
          }
        } catch(e) {
          current.product.cafe24ApiStatus = `Cafe24 저장 실패: ${e.message || e}`;
          current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
            type: requireSingleField ? 'single-field-verify' : 'update',
            productNo,
            product,
            verification: { checked: fieldNames.length, matched: 0, missing: fieldNames.map(factoryCafe24FieldLabelByApiField), mismatches: [] },
            error: e.message || String(e),
            rollback: requireSingleField ? rollback : null,
          });
          factoryRememberCafe24SyncResult(current, 'product', {
            productNo,
            endpoint,
            ok: false,
            label: requireSingleField ? 'Cafe24 1필드 저장' : 'Cafe24 상품 기본정보',
            summary: '저장 실패',
            detail: fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 8).join(', '),
            error: e.message || String(e),
          });
          factoryLog(current.product.cafe24ApiStatus, 'error', current);
        }
        return true;
      },
    );
    if (transaction && typeof transaction.then === 'function') {
      Promise.resolve(transaction).catch(error => console.error('Cafe24 저장 검증 결과 반영 실패', error));
    }
  }, 0);
}

function factoryCafe24SelectedFieldApiMap() {
  return {
    product_name: 'product_name',
    sale_price: 'price',
    consumer_price: 'retail_price',
    purchase_price: 'supply_price',
    weight: 'product_weight',
    product_weight: 'product_weight',
    product_weight_g: 'product_weight',
    material: 'product_material',
    product_material: 'product_material',
  };
}

function factoryFilterCafe24SelectedFieldPayload(product = {}, selectedFieldIds = []) {
  const apiMap = factoryCafe24SelectedFieldApiMap();
  const allowed = new Set((selectedFieldIds || []).map(fieldId => apiMap[String(fieldId || '').trim()]).filter(Boolean));
  return Object.fromEntries(Object.entries(product || {}).filter(([apiField]) => allowed.has(apiField)));
}

async function factorySaveCafe24ProductFromFinalDb(options = {}) {
  if (!options.factory) {
    if (typeof factoryFlushDbInputPanelDomValues === 'function') factoryFlushDbInputPanelDomValues();
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:save-product',
      'cafe24',
      draft => factorySaveCafe24ProductFromFinalDb({
        ...options,
        factory: draft,
        render: false,
      }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) {
      if (typeof renderPreservingMainScroll === 'function') renderPreservingMainScroll();
      else render();
    }
    return receipt.result;
  }
  const factory = options.factory;
  let model = factoryUpdateFinalDbFromFields(factory);
  const selectedFieldIds = Array.isArray(options.selectedFieldIds)
    ? Array.from(new Set(options.selectedFieldIds.map(value => String(value || '').trim()).filter(Boolean)))
    : [];
  const selectedFieldMode = selectedFieldIds.length > 0;
  if (!selectedFieldMode && options.applyFinalRegistrationSettings !== false && typeof factoryApplyFinalCafe24StatusToDb === 'function') {
    factoryApplyFinalCafe24StatusToDb(factory);
    model = factoryUpdateFinalDbFromFields(factory);
  }
  const hasExplicitSelectedTarget = !!(
    factory.product?.selectedCafe24CandidateKey
    || factory.product?.confirmedCafe24ProductKey
  );
  const target = selectedFieldMode && !hasExplicitSelectedTarget
    ? null
    : factoryCafe24TargetCandidate(factory, { allowFallback: selectedFieldMode ? false : !!factory.product.candidateAutoApply });
  const raw = parseCafe24Raw(target);
  const productNo = target?.product_no || raw.product_no || model.finalDb.product_no || model.finalDb.cafe24_product_no || '';
  const requireSingleField = options.requireSingleField === true;
  if (!productNo) {
    factoryLog('Cafe24 저장 중단: 저장 대상 product_no가 없습니다. 먼저 Cafe24 상품정보를 가져오거나 후보를 확정해주세요.', 'error', factory);
    return false;
  }
  const saveNotes = [];
  let product = factoryNormalizeCafe24ProductPayloadForSave(
    factoryBuildCafe24UpdatePayload(model.finalDb, model.fields, factory, {
      onlyChanged: true,
      recordDetailPreflight: true,
      detailHtml: options.detailHtml || options.scopedDetailHtml || options.currentDetailHtml || '',
      detailSource: options.detailSource || options.scopedDetailSource || '',
    }),
    saveNotes,
  );
  if (selectedFieldMode) {
    product = factoryFilterCafe24SelectedFieldPayload(product, selectedFieldIds);
  }
  if (options.forceName && (!selectedFieldMode || selectedFieldIds.includes('product_name'))) {
    product.product_name = String(options.forceName || '').trim();
  }
  if (!selectedFieldMode && options.applyFinalRegistrationSettings !== false && typeof factoryApplyFinalCafe24StatusToProduct === 'function') {
    factoryApplyFinalCafe24StatusToProduct(product, factory);
  }
  const fieldNames = Object.keys(product);
  if (!fieldNames.length) {
    factoryLog('Cafe24 기본 저장 중단: 수정한 상품 기본 입력칸이 없습니다. 옵션/품목/재고, 카테고리, 이미지, 태그, SEO는 전용 동기화 버튼에서 따로 저장해주세요.', 'error', factory);
    return false;
  }
  if (saveNotes.length) {
    factoryLog(`Cafe24 저장 전 자동 제외: ${saveNotes.join(' ')}`, 'error', factory);
  }
  if (requireSingleField && fieldNames.length !== 1) {
    factoryLog(`Cafe24 1필드 왕복 검증 중단: 정확히 1개 필드만 변경되어야 합니다. 현재 ${fieldNames.length}개 변경이 잡혔습니다.`, 'error', factory);
    return false;
  }
  const skipped = factoryCafe24SkippedUpdateFields(model.fields, model.finalDb);
  if (skipped.length) {
    factoryLog(`Cafe24 상품 기본 저장에서 옵션/품목 또는 읽기전용 필드 ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? ' 외' : ''}는 제외했습니다. 옵션은 전용 API 단계로 분리해야 안전합니다.`, 'error', factory);
  }
  const preview = factoryCafe24PayloadSummary(product, 18);
  const singleFieldName = requireSingleField ? fieldNames[0] : '';
  const singleFieldHasOriginal = singleFieldName ? Object.prototype.hasOwnProperty.call(raw || {}, singleFieldName) : false;
  const singleFieldRollback = singleFieldName ? {
    productNo,
    mallId: target?.mall_id || CAFE24_CONTROL_API.defaultMallId,
    fieldName: singleFieldName,
    originalValue: singleFieldHasOriginal ? raw?.[singleFieldName] : '',
    savedValue: product[singleFieldName],
    hasOriginal: singleFieldHasOriginal,
    createdAt: Date.now(),
  } : null;
  const singleFieldDetail = singleFieldName
    ? [
      `필드: ${factoryCafe24FieldLabelByApiField(singleFieldName)} (${singleFieldName})`,
      `현재값: ${singleFieldHasOriginal ? factoryCafe24HumanValue(raw?.[singleFieldName], 160) : 'Cafe24 원본에 해당 필드가 없어 자동 되돌리기 불가'}`,
      `저장값: ${factoryCafe24HumanValue(product[singleFieldName], 160)}`,
    ].join('\n')
    : '';
  const confirmTitle = requireSingleField
    ? 'Cafe24 1필드 왕복 검증'
    : selectedFieldMode
      ? '선택한 값만 Cafe24로 전송'
      : 'Cafe24 상품 기본 저장';
  if (!options.skipConfirm || requireSingleField) {
    const ok = confirm(`${confirmTitle}: 상품 #${productNo}에 ${fieldNames.length}개 필드를 실제 저장하고 재조회로 반영 여부를 확인합니다.\n\n${singleFieldDetail || preview}${fieldNames.length > 18 ? ' ...' : ''}\n\n외부 Cafe24 데이터가 실제로 변경됩니다. 계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `${requireSingleField ? 'Cafe24 1필드 왕복 검증 중' : 'Cafe24 저장 중'}: #${productNo} ${fieldNames.length}개 필드`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  const emitSaveProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  try {
    const shouldExecuteDirect = fieldNames.some(fieldName => String(product[fieldName] ?? '').length > 100000);
    if (shouldExecuteDirect) {
      factoryLog('Cafe24 저장: 상세페이지/이미지 HTML처럼 큰 값이 포함되어 변경안 저장소를 거치지 않고 직접 실행 경로를 사용합니다.', 'ok', factory);
    }
    emitSaveProgress(`Cafe24 저장 요청 전송 중: #${productNo} ${fieldNames.length}개 필드`, 30, 'info');
    const body = await callCafe24Console('PUT', `/api/v2/admin/products/${encodeURIComponent(productNo)}`, {
      mallId: target?.mall_id || CAFE24_CONTROL_API.defaultMallId,
      body: { product },
      executeDirect: shouldExecuteDirect,
    }, `Update Cafe24 product ${productNo}`);
    const current = factory;
    const plan = factoryCafe24ControlPlanFromBody(body);
    if (plan) {
      const planText = factoryCafe24ControlPlanText(plan);
      current.product.cafe24ApiStatus = `Cafe24 저장 변경안 실행 중: ${planText}`;
      current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
        type: requireSingleField ? 'single-field-verify' : 'update',
        productNo,
        product,
        verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
        message: 'Control Tower 변경안을 실행하고 완료될 때까지 기다리는 중입니다.',
        rollback: requireSingleField ? singleFieldRollback : null,
      });
      factoryLog(current.product.cafe24ApiStatus, 'ok', current);
      emitSaveProgress(`Cafe24 변경안 실행 중: ${planText}`, 45, 'info');
      await factoryExecuteCafe24ControlBody(body, { attempts: 45, delayMs: 800 });
      current.product.cafe24ApiStatus = `Cafe24 저장 실행 완료, 재조회 확인 중: #${productNo} ${fieldNames.length}개 필드`;
      factoryLog(current.product.cafe24ApiStatus, 'ok', current);
      emitSaveProgress(current.product.cafe24ApiStatus, 62, 'ok');
    }
    current.product.cafe24ApiStatus = plan
      ? `${requireSingleField ? 'Cafe24 1필드 변경안 실행 완료, 재조회 확인 중' : 'Cafe24 변경안 실행 완료, 재조회 확인 중'}: #${productNo} ${fieldNames.length}개 필드`
      : `${requireSingleField ? 'Cafe24 1필드 저장 응답 완료, 재조회 확인 중' : 'Cafe24 저장 응답 완료, 재조회 확인 중'}: #${productNo} ${fieldNames.length}개 필드`;
    current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
      type: requireSingleField ? 'single-field-verify' : 'update',
      productNo,
      product,
      verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
      message: plan ? '변경안 실행 완료, 상세 재조회 확인 중' : '저장 응답 완료, 상세 재조회 확인 중',
      rollback: requireSingleField ? singleFieldRollback : null,
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    emitSaveProgress(current.product.cafe24ApiStatus, 70, 'info');
    try {
      const echo = await factoryWaitForCafe24ProductEcho(productNo, target?.mall_id || CAFE24_CONTROL_API.defaultMallId, product, {
        attempts: 30,
        delayMs: 1000,
        onProgress: ({ attempt, attempts, phase, verification }) => {
          const shouldReport = attempt === 1 || attempt === attempts || attempt % 3 === 0 || (verification && !verification.missing.length && !verification.mismatches.length);
          if (!shouldReport || phase !== 'verify') return;
          const base = 72;
          const span = 18;
          const progress = Math.min(90, base + Math.round((attempt / attempts) * span));
          const issueText = verification
            ? ` · 일치 ${verification.matched || 0}/${verification.checked || fieldNames.length}`
            : '';
          emitSaveProgress(`Cafe24 저장 재조회 ${attempt}/${attempts}${phase === 'verify' ? ' 확인 중' : ' 요청 중'}${issueText}`, progress, 'info');
        },
      });
      const detail = echo.detail;
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `saved:${productNo}`, 999, 0)]);
        const verification = echo.verification || factoryVerifyCafe24ProductEcho(product, parseCafe24Raw(detail) || detail.raw || detail);
        current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({ type: requireSingleField ? 'single-field-verify' : 'update', productNo, product, verification, rollback: requireSingleField ? singleFieldRollback : null });
        const verified = !verification.missing.length && !verification.mismatches.length;
        factoryRememberCafe24SyncResult(current, 'product', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}`,
          ok: verified,
          label: requireSingleField ? 'Cafe24 1필드 저장' : 'Cafe24 상품 기본정보',
          summary: verified ? `반영완료: ${verification.matched}/${verification.checked}개 필드 일치` : `저장 후 확인 필요: ${verification.matched}/${verification.checked}개 필드 일치`,
          detail: `${fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 8).join(', ')}${echo.attempts > 1 ? ` · 재조회 ${echo.attempts}회` : ''}`,
        });
        if (verified) {
          current.product.cafe24ApiStatus = `${requireSingleField ? 'Cafe24 1필드 반영완료' : 'Cafe24 상품 기본정보 반영완료'}: #${productNo} ${verification.matched}/${verification.checked}개 필드 일치`;
          factoryLog(current.product.cafe24ApiStatus, 'ok', current);
          emitSaveProgress(current.product.cafe24ApiStatus, 95, 'ok');
        } else {
          const issues = [
            verification.missing.length ? `응답 누락 ${verification.missing.slice(0, 5).join(', ')}` : '',
            verification.mismatches.length ? `값 확인 필요 ${verification.mismatches.slice(0, 5).join(', ')}` : '',
          ].filter(Boolean).join(' · ');
          current.product.cafe24ApiStatus = `Cafe24 저장 후 확인 필요: #${productNo} ${issues}`;
          factoryLog(`Cafe24 저장 재조회 확인 필요: ${issues}`, 'error', current);
          emitSaveProgress(current.product.cafe24ApiStatus, 92, 'error');
        }
      } else {
        current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
          type: requireSingleField ? 'single-field-verify' : 'update',
          productNo,
          product,
          verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
          message: '저장 후 상세 재조회 결과가 비어 있습니다.',
          rollback: requireSingleField ? singleFieldRollback : null,
        });
        factoryRememberCafe24SyncResult(current, 'product', {
          productNo,
          endpoint: `/api/v2/admin/products/${productNo}`,
          ok: false,
          label: requireSingleField ? 'Cafe24 1필드 저장' : 'Cafe24 상품 기본정보',
          summary: '저장 후 상세 재조회 결과가 비어 있습니다.',
          detail: fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 8).join(', '),
        });
      }
    } catch(e) {
      current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
        type: requireSingleField ? 'single-field-verify' : 'update',
        productNo,
        product,
        verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
        error: e.message || String(e),
        rollback: requireSingleField ? singleFieldRollback : null,
      });
      factoryRememberCafe24SyncResult(current, 'product', {
        productNo,
        endpoint: `/api/v2/admin/products/${productNo}`,
        ok: false,
        label: requireSingleField ? 'Cafe24 1필드 저장' : 'Cafe24 상품 기본정보',
        summary: '저장 후 상세 재조회 보류',
        detail: fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 8).join(', '),
        error: e.message || String(e),
      });
      factoryLog(`저장 후 Cafe24 상세 재조회 보류: ${e.message || e}`, 'error', current);
    }
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 저장 실패: ${e.message || e}`;
    current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
      type: requireSingleField ? 'single-field-verify' : 'update',
      productNo,
      product,
      verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
      error: e.message || String(e),
    });
    factoryRememberCafe24SyncResult(current, 'product', {
      productNo,
      endpoint: `/api/v2/admin/products/${productNo}`,
      ok: false,
      label: requireSingleField ? 'Cafe24 1필드 저장' : 'Cafe24 상품 기본정보',
      summary: '저장 실패',
      detail: fieldNames.map(factoryCafe24FieldLabelByApiField).slice(0, 8).join(', '),
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryVerifyCafe24SingleFieldRoundTrip() {
  return factorySaveCafe24ProductFromFinalDb({ requireSingleField: true });
}

async function factoryRollbackLastCafe24SingleFieldVerification(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:rollback-single-field',
      'cafe24',
      draft => factoryRollbackLastCafe24SingleFieldVerification({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const record = factory.product?.cafe24LastSaveVerification || null;
  const rollback = record?.rollback && typeof record.rollback === 'object' ? record.rollback : null;
  const productNo = String(rollback?.productNo || record?.productNo || '').trim();
  const fieldName = String(rollback?.fieldName || '').trim();
  if (!record || record.type !== 'single-field-verify' || !rollback || !productNo || !fieldName) {
    factoryLog('Cafe24 되돌리기 중단: 되돌릴 수 있는 1필드 왕복 검증 기록이 없습니다.', 'error', factory);
    return false;
  }
  if (rollback.hasOriginal === false) {
    factoryLog('Cafe24 되돌리기 중단: 원래 Cafe24 값이 기록되지 않아 자동 복구할 수 없습니다.', 'error', factory);
    return false;
  }
  const label = factoryCafe24FieldLabelByApiField(fieldName);
  const product = { [fieldName]: cloneData(rollback.originalValue) };
  const ok = confirm(`Cafe24 1필드 검증 되돌리기: 상품 #${productNo}의 ${label} (${fieldName}) 값을 원래값으로 다시 저장합니다.\n\n현재 테스트값: ${factoryCafe24HumanValue(rollback.savedValue, 160)}\n되돌릴 원래값: ${factoryCafe24HumanValue(rollback.originalValue, 160)}\n\n외부 Cafe24 데이터가 실제로 변경됩니다. 계속할까요?`);
  if (!ok) return false;
  factory.product.cafe24ApiStatus = `Cafe24 1필드 되돌리기 중: #${productNo} ${label}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  try {
    const body = await callCafe24Console('PUT', `/api/v2/admin/products/${encodeURIComponent(productNo)}`, {
      mallId: rollback.mallId || CAFE24_CONTROL_API.defaultMallId,
      body: { product },
    }, `Rollback Cafe24 product ${productNo} ${fieldName}`);
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 1필드 되돌리기 저장 완료, 재조회 확인 중: #${productNo} ${label}`;
    current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
      type: 'single-field-rollback',
      productNo,
      product,
      verification: { checked: 1, matched: 0, missing: [], mismatches: [] },
      message: '되돌리기 응답 완료, 상세 재조회 확인 중',
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    try {
      const echo = await factoryWaitForCafe24ProductEcho(productNo, rollback.mallId || CAFE24_CONTROL_API.defaultMallId, product, {
        attempts: 30,
        delayMs: 1000,
        full: true,
      });
      const detail = echo.detail;
      if (detail) {
        current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [normalizeCafe24ProductCandidate(detail, `rollback:${productNo}`, 999, 0)]);
        const verification = echo.verification || factoryVerifyCafe24ProductEcho(product, parseCafe24Raw(detail) || detail.raw || detail);
        current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({ type: 'single-field-rollback', productNo, product, verification });
        if (!verification.missing.length && !verification.mismatches.length) {
          factoryLog(`Cafe24 1필드 되돌리기 재조회 확인 완료: ${verification.matched}/${verification.checked}개 필드 일치${echo.attempts > 1 ? ` · 재조회 ${echo.attempts}회` : ''}`, 'ok', current);
        } else {
          const issues = [
            verification.missing.length ? `응답 누락 ${verification.missing.slice(0, 5).join(', ')}` : '',
            verification.mismatches.length ? `값 확인 필요 ${verification.mismatches.slice(0, 5).join(', ')}` : '',
          ].filter(Boolean).join(' · ');
          factoryLog(`Cafe24 1필드 되돌리기 재조회 확인 필요: ${issues}`, 'error', current);
        }
      } else {
        current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
          type: 'single-field-rollback',
          productNo,
          product,
          verification: { checked: 1, matched: 0, missing: [], mismatches: [] },
          message: '되돌리기 후 상세 재조회 결과가 비어 있습니다.',
        });
      }
    } catch(e) {
      current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
        type: 'single-field-rollback',
        productNo,
        product,
        verification: { checked: 1, matched: 0, missing: [], mismatches: [] },
        error: e.message || String(e),
      });
      factoryLog(`되돌리기 후 Cafe24 상세 재조회 보류: ${e.message || e}`, 'error', current);
    }
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 1필드 되돌리기 실패: ${e.message || e}`;
    current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
      type: 'single-field-rollback',
      productNo,
      product,
      verification: { checked: 1, matched: 0, missing: [], mismatches: [] },
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryRunCafe24ReadySync(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:run-ready-sync',
      'cafe24',
      draft => factoryRunCafe24ReadySync({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const plan = factoryCafe24ReadySyncPlan(factory);
  if (!plan.productNo) {
    factoryLog('Cafe24 전체 동기화 중단: 먼저 Cafe24 후보를 확정해서 상품번호를 가져와야 합니다.', 'error', factory);
    return false;
  }
  if (!plan.readyActions.length) {
    factoryLog('Cafe24 전체 동기화 중단: 현재 준비된 동기화 항목이 없습니다.', 'error', factory);
    return false;
  }
  const summary = plan.readyActions.map(action => `- ${action.label}: ${action.summary}`).join('\n');
  const warningText = plan.optionPlan?.warnings?.length
    ? `\n\n옵션 점검:\n${plan.optionPlan.warnings.join('\n')}`
    : '';
  const ok = confirm(`Cafe24 상품 #${plan.productNo}에 준비된 항목을 실제 동기화합니다.\n\n${summary}${warningText}\n\n개별 저장 버튼과 같은 API를 순서대로 실행합니다. 계속할까요?`);
  if (!ok) return false;

  const actionMap = new Map(plan.readyActions.map(action => [action.key, action]));
  const runAction = async (key, label, runner) => {
    if (!actionMap.has(key)) return null;
    factoryLog(`Cafe24 전체 동기화 단계 시작: ${label}`, 'ok', factory);
    const result = await runner();
    if (result === false) throw new Error(`${label} 단계가 실패했거나 중단되었습니다.`);
    return result;
  };

  factory.product.cafe24ApiStatus = `Cafe24 준비 항목 전체 동기화 중: 상품 #${plan.productNo} · ${plan.readyActions.length}개 단계`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);

  try {
    const nestedOptions = { skipConfirm: true, factory, render: false };
    await runAction('product', '상품 기본정보', () => factorySaveCafe24ProductFromFinalDb(nestedOptions));
    await runAction('category', '카테고리 연결', () => factorySyncCafe24CategoryLink(nestedOptions));
    await runAction('options', '옵션/품목/재고', () => factorySyncCafe24OptionsAndVariants(nestedOptions));
    await runAction('images', '상품 이미지', () => factorySyncCafe24ProductImages(nestedOptions));
    await runAction('additionalImages', '추가 이미지', () => factorySyncCafe24AdditionalImages('create', nestedOptions));
    await runAction('icons', '상품 아이콘', () => factorySyncCafe24Icons(nestedOptions));
    await runAction('seo', '검색엔진 SEO', () => factorySyncCafe24Seo(nestedOptions));
    await runAction('englishShopName', '영문 쇼핑몰 상품명', () => factorySyncCafe24EnglishShopName(nestedOptions));
    await runAction('tags', '상품 태그', () => factorySyncCafe24Tags(nestedOptions));
    await runAction('relations', '관련상품', () => factorySyncCafe24Relations(nestedOptions));
    await runAction('memos', '관리 메모', () => factorySyncCafe24Memo(factory.product.cafe24MemoDraft?.memoNo ? 'update' : 'create', nestedOptions));
    await runAction('mains', '메인 진열', () => factorySyncCafe24MainProduct(nestedOptions));

    const current = factory;
    const completed = plan.readyActions.map(action => action.label).join(', ');
    current.product.cafe24ApiStatus = `Cafe24 준비 항목 전체 동기화 완료: ${completed}`;
    factoryRememberCafe24SyncResult(current, 'readyAll', {
      productNo: plan.productNo,
      endpoint: 'Cafe24 준비 항목 전체 동기화',
      ok: true,
      summary: `${plan.readyActions.length}개 단계 완료`,
      detail: completed,
    });
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return true;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 준비 항목 전체 동기화 실패: ${e.message || e}`;
    factoryRememberCafe24SyncResult(current, 'readyAll', {
      productNo: plan.productNo,
      endpoint: 'Cafe24 준비 항목 전체 동기화',
      ok: false,
      summary: '중간 단계 실패',
      detail: plan.readyActions.map(action => action.label).join(', '),
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryRunCafe24PostCreateSync(actions = [], options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:run-post-create-sync',
      'cafe24',
      draft => factoryRunCafe24PostCreateSync(actions, { ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const readyActions = (Array.isArray(actions) ? actions : []).filter(action => action?.ready);
  if (!readyActions.length) return true;
  const factory = options.factory;
  const targetInfo = factoryCafe24TargetInfo(factory);
  const productNo = String(options.productNo || targetInfo.productNo || '').trim();
  const mallId = String(options.mallId || targetInfo.mallId || CAFE24_CONTROL_API.defaultMallId).trim();
  if (!productNo) {
    factoryLog('Cafe24 등록 후 전용 API 동기화 중단: 새 상품번호를 아직 확인하지 못했습니다.', 'error', factory);
    return false;
  }
  const emitProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  const actionMap = new Map(readyActions.map(action => [action.key, action]));
  let finishedCount = 0;
  const total = readyActions.length;
  const progressStart = Number(options.progressStart || 96);
  const progressEnd = Number(options.progressEnd || 99);
  const progressFor = index => Math.min(progressEnd, progressStart + Math.round((index / Math.max(1, total)) * Math.max(1, progressEnd - progressStart)));
  const requiredKeys = new Set(Array.isArray(options.requiredKeys) && options.requiredKeys.length
    ? options.requiredKeys.map(key => String(key || '').trim()).filter(Boolean)
    : ['images', 'additionalImages']);
  const failures = [];
  const runAction = async (key, label, runner) => {
    if (!actionMap.has(key)) return null;
    const stepStart = progressFor(finishedCount);
    factoryLog(`Cafe24 등록 후 전용 API 단계 시작 ${finishedCount + 1}/${total}: ${label} · 상품 #${productNo}`, 'ok', factory);
    emitProgress(`Cafe24 후속 단계 ${finishedCount + 1}/${total} 시작: ${label}`, stepStart, 'info');
    try {
      const result = await runner({
        productNo,
        mallId,
        progressStart: stepStart,
        progressEnd: progressFor(finishedCount + 1),
        onProgress: emitProgress,
        factory,
        render: false,
      });
      if (result === false) throw new Error(`${label} 단계가 실패했거나 중단되었습니다.`);
      finishedCount += 1;
      emitProgress(`Cafe24 후속 단계 ${finishedCount}/${total} 완료: ${label}`, progressFor(finishedCount), 'ok');
      return result;
    } catch(e) {
      const message = e.message || String(e);
      failures.push({ key, label, message, required: requiredKeys.has(key) });
      factoryLog(`Cafe24 후속 단계 실패: ${label} · ${message}`, requiredKeys.has(key) ? 'error' : 'warn', factory);
      emitProgress(`Cafe24 후속 단계 실패: ${label} · ${message}`, progressFor(finishedCount + 1), requiredKeys.has(key) ? 'error' : 'warn');
      if (requiredKeys.has(key)) throw e;
      return false;
    }
  };
  try {
    await runAction('images', '상품 이미지', step => factorySyncCafe24ProductImages({ skipConfirm: true, ...step }));
    await runAction('additionalImages', '추가 이미지', step => factorySyncCafe24AdditionalImages('create', { skipConfirm: true, ...step }));
    await runAction('category', '카테고리 연결', step => factorySyncCafe24CategoryLink({ skipConfirm: true, ...step }));
    await runAction('options', '옵션/품목/재고', step => factorySyncCafe24OptionsAndVariants({ skipConfirm: true, ...step }));
    await runAction('icons', '상품 아이콘', step => factorySyncCafe24Icons({ skipConfirm: true, ...step }));
    await runAction('seo', '검색엔진 SEO', step => factorySyncCafe24Seo({ skipConfirm: true, ...step }));
    await runAction('englishShopName', '영문 쇼핑몰 상품명', step => factorySyncCafe24EnglishShopName({ skipConfirm: true, ...step }));
    await runAction('tags', '상품 태그', step => factorySyncCafe24Tags({ skipConfirm: true, ...step }));
    await runAction('relations', '관련상품', step => factorySyncCafe24Relations({ skipConfirm: true, ...step }));
    await runAction('memos', '관리 메모', step => factorySyncCafe24Memo(factory.product.cafe24MemoDraft?.memoNo ? 'update' : 'create', { skipConfirm: true, ...step }));
    await runAction('mains', '메인 진열', step => factorySyncCafe24MainProduct({ skipConfirm: true, ...step }));
    const current = factory;
    factoryRememberCafe24SyncResult(current, 'postCreate', {
      productNo,
      endpoint: 'Cafe24 새 상품 등록 후 전용 API',
      ok: !failures.some(item => item.required),
      summary: failures.length
        ? `필수 후속 단계 완료, 선택 단계 ${failures.length}개 확인 필요`
        : `${readyActions.length}개 후속 단계 완료`,
      detail: failures.length
        ? `완료/시도: ${readyActions.map(action => action.label).join(', ')} · 확인 필요: ${failures.map(item => item.label).join(', ')}`
        : readyActions.map(action => action.label).join(', '),
      error: failures.length ? failures.map(item => `${item.label}: ${item.message}`).join(' | ') : undefined,
    });
    current.product.cafe24ApiStatus = failures.length
      ? `Cafe24 새 상품 필수 후속 동기화 완료, 선택 단계 확인 필요: ${failures.map(item => item.label).join(', ')}`
      : `Cafe24 새 상품 등록 후 전용 API 동기화 완료: ${readyActions.map(action => action.label).join(', ')}`;
    factoryLog(current.product.cafe24ApiStatus, failures.length ? 'warn' : 'ok', current);
    return true;
  } catch(e) {
    const current = factory;
    factoryRememberCafe24SyncResult(current, 'postCreate', {
      productNo,
      endpoint: 'Cafe24 새 상품 등록 후 전용 API',
      ok: false,
      summary: '후속 전용 API 중간 단계 실패',
      detail: readyActions.map(action => action.label).join(', '),
      error: e.message || String(e),
    });
    current.product.cafe24ApiStatus = `Cafe24 새 상품 등록 후 전용 API 동기화 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factoryExtractCafe24ProductFromBody(body) {
  const seen = new Set();
  const queue = [body];
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object') continue;
    if (seen.has(item)) continue;
    seen.add(item);
    if (item.product && typeof item.product === 'object' && (item.product.product_no || item.product.product_name)) return item.product;
    if (item.product_no || item.product_name) return item;
    ['body', 'data', 'response', 'result'].forEach(key => {
      if (item[key] && typeof item[key] === 'object') queue.push(item[key]);
    });
  }
  return null;
}

async function factoryFindLatestCafe24ProductByName(productName, mallId = CAFE24_CONTROL_API.defaultMallId) {
  const name = String(productName || '').trim();
  if (!name) return null;
  try {
    const rows = await fetchCafe24ProductsByQuery(name, 120);
    const matches = rows
      .map(row => normalizeCafe24ProductCandidate(row, `created-search:${name}`, 999, 0))
      .filter(candidate => {
        const raw = parseCafe24Raw(candidate);
        return String(candidate.product_name || raw.product_name || '').trim() === name;
      })
      .sort((a, b) => Number(b.product_no || parseCafe24Raw(b).product_no || 0) - Number(a.product_no || parseCafe24Raw(a).product_no || 0));
    const selected = matches[0] || null;
    const productNo = selected?.product_no || parseCafe24Raw(selected).product_no || '';
    if (productNo) return fetchCafe24ProductFullByNo(productNo, mallId).catch(() => selected);
    if (selected) return selected;
  } catch(e) {
    factoryLog(`Cafe24 로컬 상품명 검색 실패, 실시간 조회로 재확인합니다: ${e.message || e}`, 'warn');
  }
  return factoryFindLiveCafe24ProductByExactName(name, mallId);
}

function factoryCafe24ProductsFromConsoleBody(body) {
  const root = typeof unwrapApiHubBody === 'function' ? unwrapApiHubBody(body) : body;
  const pools = [
    root?.data?.response?.products,
    root?.response?.products,
    root?.products,
    root?.data?.products,
    root?.body?.data?.response?.products,
    root?.body?.products,
  ];
  return pools.find(Array.isArray) || [];
}

async function factoryFindLiveCafe24ProductByExactName(productName, mallId = CAFE24_CONTROL_API.defaultMallId) {
  const name = String(productName || '').trim();
  if (!name) return null;
  const body = await callCafe24Console(
    'GET',
    `/api/v2/admin/products?limit=50&product_name=${encodeURIComponent(name)}`,
    { mallId },
    `Read Cafe24 product ${name}`
  );
  const rows = factoryCafe24ProductsFromConsoleBody(body);
  const matches = rows
    .map(row => normalizeCafe24ProductCandidate(row, `live-name:${name}`, 999, 0))
    .filter(candidate => {
      const raw = parseCafe24Raw(candidate);
      return String(candidate.product_name || raw.product_name || '').trim() === name;
    })
    .sort((a, b) => Number(b.product_no || parseCafe24Raw(b).product_no || 0) - Number(a.product_no || parseCafe24Raw(a).product_no || 0));
  const selected = matches[0] || null;
  const productNo = selected?.product_no || parseCafe24Raw(selected).product_no || '';
  if (!productNo) return selected;
  return fetchCafe24ProductFullByNo(productNo, mallId).catch(() => selected);
}

async function factoryUseCafe24TestProduct(productName = '방울수저집test', options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:use-test-product',
      'cafe24',
      draft => factoryUseCafe24TestProduct(productName, { ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) {
      if (typeof renderPreservingMainScroll === 'function') renderPreservingMainScroll();
      else render();
    }
    return receipt.result;
  }
  const current = options.factory;
  const name = String(productName || '방울수저집test').trim() || '방울수저집test';
  current.product.productName = name;
  current.product.cafe24ApiStatus = `Cafe24 테스트 상품 조회 중: ${name}`;
  factoryLog(current.product.cafe24ApiStatus, 'info', current);
  try {
    const product = await factoryFindLiveCafe24ProductByExactName(name, CAFE24_CONTROL_API.defaultMallId);
    const attached = factoryAttachCafe24ProductAsCurrentTarget(product, `live-test:${name}`, current);
    if (!attached?.productNo) throw new Error(`${name} 상품을 Cafe24에서 찾지 못했습니다.`);
    const next = current;
    next.product.productName = attached.productName || name;
    next.product.cafe24ApiStatus = `Cafe24 테스트 상품 적용: #${attached.productNo} ${attached.productName || name}`;
    factoryLog(next.product.cafe24ApiStatus, 'ok', next);
    return attached;
  } catch(e) {
    const failed = current;
    failed.product.cafe24ApiStatus = `Cafe24 테스트 상품 조회 실패: ${e.message || e}`;
    factoryLog(failed.product.cafe24ApiStatus, 'error', failed);
    return null;
  }
}

async function factorySetCafe24MarketSyncFlag(value = 'T', options = {}) {
  if (!options.factory) {
    if (typeof factoryFlushDbInputPanelDomValues === 'function') factoryFlushDbInputPanelDomValues();
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:set-market-sync',
      'cafe24',
      draft => factorySetCafe24MarketSyncFlag(value, { ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) {
      if (typeof renderPreservingMainScroll === 'function') renderPreservingMainScroll();
      else render();
    }
    return receipt.result;
  }
  const nextValue = String(value || 'T').trim().toUpperCase() === 'T' ? 'T' : 'F';
  const current = options.factory;
  const { target, productNo, mallId } = factoryCafe24TargetInfo(current);
  if (!productNo) {
    factoryLog('Cafe24 마켓연동값 저장 중단: 먼저 Cafe24 상품을 확정하거나 방울수저집test를 불러와야 합니다.', 'error', current);
    return false;
  }
  const productName = target?.product_name || parseCafe24Raw(target).product_name || current.product?.productName || '';
  const message = `Cafe24 상품 #${productNo}${productName ? ` ${productName}` : ''}의 market_sync 값을 ${nextValue}로 저장합니다.\n\n진열/판매 상태는 바꾸지 않고, 저장 뒤 Cafe24 재조회로 반영 여부를 확인합니다.\n계속할까요?`;
  if (typeof confirm === 'function' && !confirm(message)) return false;
  current.product.cafe24ApiStatus = `Cafe24 마켓연동값 저장 중: #${productNo} market_sync=${nextValue}`;
  factoryLog(current.product.cafe24ApiStatus, 'info', current);
  try {
    const body = await callCafe24Console('PUT', `/api/v2/admin/products/${encodeURIComponent(productNo)}`, {
      mallId,
      executeDirect: true,
      body: { product: { market_sync: nextValue } },
    }, `Update Cafe24 product market_sync ${productNo}`);
    const detail = await fetchCafe24ProductFullByNo(productNo, mallId);
    const raw = parseCafe24Raw(detail) || {};
    const echoed = String(raw.market_sync || '').trim().toUpperCase();
    const latest = current;
    if (detail) {
      latest.product.cafe24Candidates = factoryMergeCafe24Candidates(
        latest.product.cafe24Candidates,
        [normalizeCafe24ProductCandidate(detail, `market-sync:${productNo}`, 999, 0)]
      );
    }
    const responseProduct = body?.data?.response?.product || body?.response?.product || body?.product || {};
    const responseEcho = String(responseProduct.market_sync || '').trim().toUpperCase();
    latest.product.cafe24ApiStatus = echoed === nextValue
      ? `Cafe24 마켓연동값 반영완료: #${productNo} market_sync=${echoed}`
      : `Cafe24 마켓연동값 반영 실패: Cafe24 API 응답은 성공했지만 재조회 결과가 ${echoed || '값 없음'}입니다. ${responseEcho ? `응답값 ${responseEcho}. ` : ''}이 필드는 Cafe24 관리자/마켓플러스에서 직접 켜야 할 수 있습니다.`;
    factoryLog(latest.product.cafe24ApiStatus, echoed === nextValue ? 'ok' : 'error', latest);
    return echoed === nextValue;
  } catch(e) {
    const failed = current;
    failed.product.cafe24ApiStatus = `Cafe24 마켓연동값 저장 실패: ${e.message || e}`;
    factoryLog(failed.product.cafe24ApiStatus, 'error', failed);
    return false;
  }
}

function factoryAttachCafe24ProductAsCurrentTarget(product, source = 'Cafe24 상품', factory) {
  if (!product || typeof product !== 'object') return null;
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const current = factory;
  const candidate = normalizeCafe24ProductCandidate(product, source, 999, 0);
  const raw = parseCafe24Raw(candidate) || product.raw || product.rawProduct || product;
  current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [candidate]);
  const key = factoryCafe24CandidateKey(candidate) || cafe24ProductKey(candidate);
  if (key) {
    current.product.confirmedCafe24ProductKey = key;
    current.product.selectedCafe24CandidateKey = key;
  }
  const inputProductName = typeof factoryAuthoritativeProductName === 'function'
    ? factoryAuthoritativeProductName(current, [current.product.finalDb?.product_name, raw.product_name, candidate.product_name])
    : String(current.product.userProductName || current.product.productName || state.productName || current.product.finalDb?.product_name || raw.product_name || candidate.product_name || '').trim();
  current.product.finalDb = {
    ...(current.product.finalDb || {}),
    product_no: raw.product_no || candidate.product_no || current.product.finalDb?.product_no || '',
    cafe24_product_no: raw.product_no || candidate.product_no || current.product.finalDb?.cafe24_product_no || '',
    product_code: raw.product_code || candidate.product_code || current.product.finalDb?.product_code || '',
    cafe24_product_code: raw.product_code || candidate.product_code || current.product.finalDb?.cafe24_product_code || '',
    product_name: inputProductName,
    cafe24_product_name: raw.product_name || candidate.product_name || current.product.finalDb?.cafe24_product_name || '',
  };
  current.product.cafe24DraftProductKey = key || current.product.cafe24DraftProductKey || '';
  return {
    current,
    candidate,
    raw,
    key,
    productNo: raw.product_no || candidate.product_no || '',
    productName: raw.product_name || candidate.product_name || '',
  };
}

async function factoryCreateCafe24ProductFromFinalDb(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:create-product',
      'cafe24',
      draft => factoryCreateCafe24ProductFromFinalDb({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const targetInfo = factoryCafe24TargetInfo(factory);
  if (targetInfo.productNo && !options.allowSelectedSource) {
    factoryLog(`Cafe24 새 상품 등록 중단: 현재 기존 Cafe24 상품 #${targetInfo.productNo}이 선택되어 있습니다. 기존 상품은 'Cafe24 기본 저장'과 전용 동기화 버튼으로 수정해주세요.`, 'error', factory);
    return false;
  }
  let model = factoryUpdateFinalDbFromFields(factory);
  if (options.applyFinalRegistrationSettings !== false && typeof factoryApplyFinalCafe24StatusToDb === 'function') {
    factoryApplyFinalCafe24StatusToDb(factory);
    model = factoryUpdateFinalDbFromFields(factory);
  }
  const providedDetailHtml = String(options.detailHtml || options.scopedDetailHtml || options.currentDetailHtml || '').trim();
  const providedDetailSource = String(options.detailSource || options.scopedDetailSource || '').trim();
  const scopedDetailBeforeCreate = providedDetailHtml
    ? { html: providedDetailHtml, source: providedDetailSource || 'final-registration-preserved' }
    : (typeof factoryCafe24CurrentScopedDetailHtml === 'function'
      ? factoryCafe24CurrentScopedDetailHtml(factory)
      : { html: '' });
  const scopedDetailHtmlBase = String(scopedDetailBeforeCreate?.html || '').trim();
  const expandedDetailHtmlBeforeCreate = typeof factoryCafe24ExpandLightImageHtmlForTransfer === 'function'
    ? factoryCafe24ExpandLightImageHtmlForTransfer(scopedDetailHtmlBase).trim()
    : scopedDetailHtmlBase;
  const scopedDetailHtmlBeforeCreate = typeof factoryCafe24StripDetailAdminLabels === 'function'
    ? factoryCafe24StripDetailAdminLabels(expandedDetailHtmlBeforeCreate)
    : expandedDetailHtmlBeforeCreate;
  const scopedDetailPreflight = typeof factoryCafe24DetailHtmlPreflight === 'function'
    ? factoryCafe24DetailHtmlPreflight(scopedDetailHtmlBeforeCreate)
    : { ok: true, hasInlineImage: false, hasLongBase64: false };
  if (scopedDetailBeforeCreate?.blocked && options.allowSafeDetailFallback !== true) {
    const reason = scopedDetailBeforeCreate.message || '상세페이지 HTML 출처가 현재 작업 검문을 통과하지 못했습니다.';
    factory.product.cafe24ApiStatus = `Cafe24 새 상품 등록 중단: ${reason}`;
    factoryLog(factory.product.cafe24ApiStatus, 'error', factory);
    return false;
  }
  if (scopedDetailPreflight.hasLightPlaceholder && options.allowSafeDetailFallback !== true) {
    const reason = (scopedDetailPreflight.issues || []).join(' ') || '상세페이지 HTML에 브라우저 전용 이미지 자리표시자가 남아 있습니다.';
    factory.product.cafe24ApiStatus = `Cafe24 새 상품 등록 중단: ${reason}`;
    factoryLog(factory.product.cafe24ApiStatus, 'error', factory);
    return false;
  }
  const shouldPublishDetailAfterCreate = !!scopedDetailHtmlBeforeCreate;
  const product = factoryBuildCafe24UpdatePayload(model.finalDb, model.fields, factory, {
    recordDetailPreflight: true,
    allowSafeDetailFallback: options.allowSafeDetailFallback === true,
    detailHtml: scopedDetailHtmlBeforeCreate,
    detailSource: scopedDetailBeforeCreate?.source || '',
  });
  if (shouldPublishDetailAfterCreate) {
    delete product.description;
    delete product.mobile_description;
    if (product.separated_mobile_description === 'F') delete product.separated_mobile_description;
    factoryLog('Cafe24 새 상품 등록 전 상세페이지 HTML은 첫 생성 요청에서 빼고, 상품번호가 나온 뒤 별도 저장합니다.', 'info', factory);
  }
  factoryAttachCafe24OptionsToProductPayload(product, factory, model.finalDb);
  factoryAttachCafe24CategoryToProductPayload(product, factory);
  if (options.forceName) product.product_name = String(options.forceName || '').trim();
  if (options.forceHiddenTest) {
    product.display = 'F';
    product.selling = 'F';
    product.sold_out = 'T';
    product.market_sync = 'F';
  } else if (options.applyFinalRegistrationSettings !== false && typeof factoryApplyFinalCafe24StatusToProduct === 'function') {
    factoryApplyFinalCafe24StatusToProduct(product, factory);
  }
  const createNotes = [];
  if (typeof factoryNormalizeCafe24ProductPayloadForSave === 'function') {
    const normalizedProduct = factoryNormalizeCafe24ProductPayloadForSave(product, createNotes);
    Object.keys(product).forEach(key => delete product[key]);
    Object.assign(product, normalizedProduct);
  } else {
    factoryRemoveCafe24UnsupportedProductPayloadFields(product, createNotes);
  }
  if (typeof factoryCafe24PruneEmptyProductPayload === 'function') {
    factoryCafe24PruneEmptyProductPayload(product, createNotes);
  }
  if (createNotes.length) {
    factoryLog(`Cafe24 새 상품 등록 전 자동 제외: ${createNotes.join(' ')}`, 'ok', factory);
  }
  const detailScope = factory.product?.cafe24DetailHtmlScope || {};
  const hasDetailHtml = !!String(product.description || '').trim();
  if (!hasDetailHtml && !shouldPublishDetailAfterCreate && options.allowMissingDetail !== true) {
    const reason = detailScope?.message || 'Cafe24에 전송할 현재 작업 상세페이지 HTML이 없습니다.';
    factory.product.cafe24ApiStatus = `Cafe24 새 상품 등록 중단: ${reason}`;
    factoryLog(factory.product.cafe24ApiStatus, 'error', factory);
    return false;
  }
  if (detailScope?.blocked && !shouldPublishDetailAfterCreate && options.allowSafeDetailFallback !== true) {
    const reason = detailScope?.message || '상세페이지 HTML 출처가 현재 작업 검문을 통과하지 못했습니다.';
    factory.product.cafe24ApiStatus = `Cafe24 새 상품 등록 중단: ${reason}`;
    factoryLog(factory.product.cafe24ApiStatus, 'error', factory);
    return false;
  }
  if (options.avoidDuplicateByName && product.product_name) {
    try {
      const existing = await factoryFindLatestCafe24ProductByName(product.product_name, CAFE24_CONTROL_API.defaultMallId);
      const attached = factoryAttachCafe24ProductAsCurrentTarget(existing, `existing-test:${product.product_name}`, factory);
      if (attached?.productNo) {
        const current = factory;
        current.product.cafe24ApiStatus = `동일 상품명 Cafe24 상품 확인: #${attached.productNo} ${attached.productName || product.product_name}. 새로 만들지 않고 기존 상품 저장/검증으로 전환합니다.`;
        factoryLog(current.product.cafe24ApiStatus, 'ok', current);
        if (options.updateExistingOnDuplicate !== false) {
          return factorySaveCafe24ProductFromFinalDb({
            skipConfirm: !!options.skipConfirmDuplicateUpdate,
            deferInitialSave: true,
            factory,
            render: false,
          });
        }
        return existing;
      }
    } catch(e) {
      factoryLog(`동일 상품명 Cafe24 확인 보류: ${e.message || e}. 새 상품 등록 절차를 계속합니다.`, 'error', factory);
    }
  }
  const optionPlan = factoryBuildCafe24OptionSyncPlan(factory, model.finalDb);
  let postCreatePlan = factoryCafe24CreatePostSyncPlan(factory);
  const fieldNames = Object.keys(product);
  if (!product.product_name || !product.price) {
    factoryLog('Cafe24 새 상품 등록 중단: 상품명과 판매가는 필수입니다. Cafe24 상품 입력판에서 먼저 채워주세요.', 'error', factory);
    return false;
  }
  if (!fieldNames.length) {
    factoryLog('Cafe24 새 상품 등록 중단: 전송할 Cafe24 필드가 없습니다.', 'error', factory);
    return false;
  }
  const preview = factoryCafe24PayloadSummary(product, 18);
  const postCreateText = postCreatePlan.readyActions.length
    ? postCreatePlan.readyActions.map(action => `- ${action.label}: ${action.summary}`).join('\n')
    : '- 없음';
  if (!options.skipConfirm) {
    const ok = confirm(`Cafe24에 새 상품을 실제 등록합니다.\n\n상품명: ${product.product_name}\n진열: ${product.display === 'F' ? '진열안함' : '진열'}\n판매: ${product.selling === 'F' ? '판매안함' : '판매'}\n전송 필드: ${fieldNames.length}개\n옵션값: ${optionPlan.optionValueTotal || 0}개\n추가 입력 옵션: ${product.use_additional_option === 'T' ? `${(product.additional_options || []).length}개` : '사용안함'}\n파일 첨부 옵션: ${product.use_attached_file_option === 'T' ? '사용함' : '사용안함'}\n${preview}${fieldNames.length > 18 ? ' ...' : ''}\n\n등록 성공 후 전용 API 후속 동기화:\n${postCreateText}\n\n계속할까요?`);
    if (!ok) return false;
  }
  factory.product.cafe24ApiStatus = `Cafe24 새 상품 등록 중: ${product.product_name}`;
  factoryLog(factory.product.cafe24ApiStatus, 'ok', factory);
  const emitCreateProgress = (message, progress, type = 'info') => {
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(message, progress, type); } catch(_) {}
    }
  };
  try {
    emitCreateProgress(`Cafe24 새 상품 등록 요청 전송 중: ${product.product_name}`, 30, 'info');
    let createWaitTimer = null;
    const createStartedAt = Date.now();
    const stopCreateWaitTimer = () => {
      if (createWaitTimer) clearInterval(createWaitTimer);
      createWaitTimer = null;
    };
    createWaitTimer = setInterval(() => {
      const elapsedSec = Math.max(1, Math.round((Date.now() - createStartedAt) / 1000));
      const progress = Math.min(44, 30 + Math.floor(elapsedSec / 8));
      emitCreateProgress(`Cafe24 새 상품 등록 응답 대기 중: ${elapsedSec}초 경과`, progress, 'info');
    }, 10000);
    let body;
    try {
      body = await callCafe24Console('POST', '/api/v2/admin/products', {
        mallId: CAFE24_CONTROL_API.defaultMallId,
        body: product,
      }, 'Create Cafe24 product');
    } finally {
      stopCreateWaitTimer();
    }
    const plan = factoryCafe24ControlPlanFromBody(body);
    if (plan) {
      const currentPlanState = factory;
      currentPlanState.product.cafe24ApiStatus = `Cafe24 새 상품 등록 변경안 실행 중: ${factoryCafe24ControlPlanText(plan)}`;
      factoryLog(currentPlanState.product.cafe24ApiStatus, 'ok', currentPlanState);
      emitCreateProgress(currentPlanState.product.cafe24ApiStatus, 45, 'info');
      await factoryExecuteCafe24ControlBody(body, {
        attempts: 60,
        delayMs: 1000,
        onProgress: ({ attempt, attempts, job }) => {
          const status = String(job?.status || '대기 중');
          const progress = Math.min(60, 45 + Math.round((attempt / attempts) * 15));
          emitCreateProgress(`Cafe24 변경안 실행 확인 ${attempt}/${attempts}: ${status}`, progress, status === 'failed' || status === 'partial' ? 'error' : 'info');
        },
      });
      emitCreateProgress('Cafe24 새 상품 등록 변경안 실행 완료, 상품번호 확인 중입니다.', 62, 'ok');
    }
    let created = factoryExtractCafe24ProductFromBody(body);
    if (!created?.product_no) {
      emitCreateProgress('Cafe24 등록 응답에서 상품번호 확인 중입니다.', 66, 'info');
      created = await factoryFindLatestCafe24ProductByName(product.product_name, CAFE24_CONTROL_API.defaultMallId);
    }
    const current = factory;
    if (created) {
      const candidate = normalizeCafe24ProductCandidate(created, `created:${created.product_no || created.product_name || ''}`, 999, 0);
      current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [candidate]);
      const createdKey = factoryCafe24CandidateKey(candidate) || cafe24ProductKey(candidate);
      current.product.confirmedCafe24ProductKey = createdKey;
      current.product.selectedCafe24CandidateKey = createdKey;
      current.product.finalDb = {
        ...(current.product.finalDb || {}),
        product_no: created.product_no || current.product.finalDb?.product_no || '',
        cafe24_product_no: created.product_no || current.product.finalDb?.cafe24_product_no || '',
        product_code: created.product_code || current.product.finalDb?.product_code || '',
        cafe24_product_code: created.product_code || current.product.finalDb?.cafe24_product_code || '',
        product_name: String(product.product_name || created.product_name || current.product.userProductName || current.product.productName || state.productName || '').trim(),
        cafe24_product_name: created.product_name || current.product.finalDb?.cafe24_product_name || '',
      };
      current.product.cafe24ApiStatus = `Cafe24 새 상품 등록 완료: #${created.product_no || '-'} ${created.product_name || product.product_name}`;
      emitCreateProgress(current.product.cafe24ApiStatus, 70, 'ok');
      current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
        type: 'create',
        productNo: created.product_no || '',
        product,
        verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
        message: '새 상품 등록 응답 완료, 상세 재조회 확인 중',
      });
      if (created.product_no) {
        try {
          const echo = await factoryWaitForCafe24ProductEcho(created.product_no, CAFE24_CONTROL_API.defaultMallId, product, {
            attempts: 30,
            delayMs: 1000,
            full: true,
            onProgress: ({ attempt, attempts, phase, verification }) => {
              const shouldReport = attempt === 1 || attempt === attempts || attempt % 3 === 0 || (verification && !verification.missing.length && !verification.mismatches.length);
              if (!shouldReport || phase !== 'verify') return;
              const progress = Math.min(90, 72 + Math.round((attempt / attempts) * 18));
              const issueText = verification
                ? ` · 일치 ${verification.matched || 0}/${verification.checked || fieldNames.length}`
                : '';
              emitCreateProgress(`Cafe24 새 상품 재조회 ${attempt}/${attempts} 확인 중${issueText}`, progress, 'info');
            },
          });
          const detail = echo.detail;
          if (detail) {
            const detailCandidate = normalizeCafe24ProductCandidate(detail, `created-verify:${created.product_no}`, 999, 0);
            current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, [detailCandidate]);
            const detailKey = factoryCafe24CandidateKey(detailCandidate) || cafe24ProductKey(detailCandidate) || createdKey;
            current.product.selectedCafe24CandidateKey = detailKey;
            current.product.confirmedCafe24ProductKey = detailKey;
            const verification = echo.verification || factoryVerifyCafe24ProductEcho(product, parseCafe24Raw(detail) || detail.raw || detail);
            current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({ type: 'create', productNo: created.product_no, product, verification });
            if (!verification.missing.length && !verification.mismatches.length) {
              factoryLog(`Cafe24 새 상품 재조회 확인 완료: ${verification.matched}/${verification.checked}개 필드 일치${echo.attempts > 1 ? ` · 재조회 ${echo.attempts}회` : ''}`, 'ok', current);
              emitCreateProgress(`Cafe24 새 상품 재조회 확인 완료: ${verification.matched}/${verification.checked}개 필드 일치`, 95, 'ok');
            } else {
              const issues = [
                verification.missing.length ? `응답 누락 ${verification.missing.slice(0, 5).join(', ')}` : '',
                verification.mismatches.length ? `값 확인 필요 ${verification.mismatches.slice(0, 5).join(', ')}` : '',
              ].filter(Boolean).join(' · ');
              factoryLog(`Cafe24 새 상품 재조회 확인 필요: ${issues}`, 'error', current);
              emitCreateProgress(`Cafe24 새 상품 재조회 확인 필요: ${issues}`, 92, 'error');
            }
          } else {
            current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
              type: 'create',
              productNo: created.product_no,
              product,
              verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
              message: '새 상품 등록 후 상세 재조회 결과가 비어 있습니다.',
            });
          }
        } catch(e) {
          current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
            type: 'create',
            productNo: created.product_no,
            product,
            verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
            error: e.message || String(e),
          });
          factoryLog(`새 상품 등록 후 Cafe24 상세 재조회 보류: ${e.message || e}`, 'error', current);
        }
      }
      if (created.product_no && shouldPublishDetailAfterCreate) {
        const beforeDetail = factory;
        beforeDetail.product.cafe24ApiStatus = 'Cafe24 상세페이지 섹션 이미지를 URL로 변환해 상세설명에 저장합니다.';
        factoryLog(beforeDetail.product.cafe24ApiStatus, 'ok', beforeDetail);
        emitCreateProgress(beforeDetail.product.cafe24ApiStatus, 92, 'info');
        await factoryPublishCafe24ScopedDetailHtml(created.product_no, {
          mallId: CAFE24_CONTROL_API.defaultMallId,
          html: scopedDetailHtmlBeforeCreate,
          source: scopedDetailBeforeCreate?.source || 'current-section-export',
          progressStart: 92,
          progressMid: 94,
          progressEnd: 96,
          onProgress: emitCreateProgress,
          factory,
          render: false,
        });
      }
      if (created.product_no && typeof factoryCafe24CreatePostSyncPlan === 'function') {
        postCreatePlan = factoryCafe24CreatePostSyncPlan(factory);
      }
      if (created.product_no && postCreatePlan.readyActions.length) {
        const beforePost = factory;
        beforePost.product.cafe24ApiStatus = `Cafe24 새 상품 등록 완료, 전용 API 후속 동기화 시작: ${postCreatePlan.readyActions.map(action => action.label).join(', ')}`;
        factoryLog(beforePost.product.cafe24ApiStatus, 'ok', beforePost);
        emitCreateProgress(beforePost.product.cafe24ApiStatus, 96, 'info');
        const postCreateOk = await factoryRunCafe24PostCreateSync(postCreatePlan.readyActions, {
          productNo: created.product_no,
          mallId: CAFE24_CONTROL_API.defaultMallId,
          progressStart: 96,
          progressEnd: 99,
          onProgress: emitCreateProgress,
          factory,
          render: false,
        });
        if (postCreateOk === false) {
          throw new Error('Cafe24 새 상품 등록 후 대표이미지/옵션/카테고리 후속 동기화가 실패했습니다.');
        }
      }
      if (created.product_no) {
        const finalCheckNeedsDetail = shouldPublishDetailAfterCreate;
        const finalCheckNeedsImage = postCreatePlan.imageSlotCount > 0;
        if (finalCheckNeedsDetail || finalCheckNeedsImage) {
          emitCreateProgress(`Cafe24 최종 반영 재조회 중: #${created.product_no}`, 99, 'info');
          let finalIssues = [];
          let finalRaw = {};
          for (let attempt = 1; attempt <= 8; attempt += 1) {
            const finalDetail = await fetchCafe24ProductFullByNo(created.product_no, CAFE24_CONTROL_API.defaultMallId);
            finalRaw = parseCafe24Raw(finalDetail) || finalDetail?.raw || finalDetail || {};
            const finalHtml = String(finalRaw.description || finalRaw.mobile_description || '').trim();
            const finalImageValues = [finalRaw.detail_image, finalRaw.list_image, finalRaw.small_image, finalRaw.tiny_image];
            const finalHasImage = finalImageValues.some(value => String(value || '').trim() !== '');
            finalIssues = [
              finalCheckNeedsDetail && !finalHtml ? '상세페이지 HTML 비어 있음' : '',
              finalCheckNeedsImage && !finalHasImage ? '대표/목록 이미지 비어 있음' : '',
            ].filter(Boolean);
            if (!finalIssues.length) break;
            if (attempt < 8) {
              emitCreateProgress(`Cafe24 최종 반영 재조회 ${attempt}/8: ${finalIssues.join(' · ')}`, 99, 'info');
              await factoryCafe24Delay(1000);
            }
          }
          if (finalIssues.length) {
            throw new Error(`Cafe24 최종 등록 검증 실패: #${created.product_no} ${finalIssues.join(' · ')}`);
          }
          factoryLog(`Cafe24 최종 등록 검증 완료: #${created.product_no} 상세페이지/대표이미지 반영 확인`, 'ok', factory);
          emitCreateProgress(`Cafe24 최종 등록 검증 완료: #${created.product_no} 상세페이지/대표이미지 반영 확인`, 99, 'ok');
        }
      }
      if (created.product_no) {
        const finalState = factory;
        const finalCreatedDetail = await fetchCafe24ProductFullByNo(created.product_no, CAFE24_CONTROL_API.defaultMallId).catch(() => null);
        if (finalCreatedDetail) {
          const finalCandidate = normalizeCafe24ProductCandidate(finalCreatedDetail, `created-final:${created.product_no}`, 999, 0);
          finalState.product.cafe24Candidates = factoryMergeCafe24Candidates(finalState.product.cafe24Candidates, [finalCandidate]);
          const finalKey = factoryCafe24CandidateKey(finalCandidate) || cafe24ProductKey(finalCandidate);
          finalState.product.selectedCafe24CandidateKey = finalKey || String(created.product_no);
          finalState.product.confirmedCafe24ProductKey = finalState.product.selectedCafe24CandidateKey;
        }
        finalState.product.finalDb = {
          ...(finalState.product.finalDb || {}),
          product_no: created.product_no,
          cafe24_product_no: created.product_no,
          product_code: created.product_code || finalState.product.finalDb?.product_code || '',
          cafe24_product_code: created.product_code || finalState.product.finalDb?.cafe24_product_code || '',
          product_name: String(product.product_name || created.product_name || finalState.product.userProductName || finalState.product.productName || state.productName || '').trim(),
          cafe24_product_name: created.product_name || finalState.product.finalDb?.cafe24_product_name || '',
        };
        finalState.product.cafe24ApiStatus = `Cafe24 새 상품 등록 완료: #${created.product_no} ${product.product_name || created.product_name || ''}`;
      }
    } else {
      current.product.cafe24ApiStatus = 'Cafe24 새 상품 등록 완료: 응답에서 상품번호를 확인하지 못했습니다. 상품목록을 다시 불러와 확인해주세요.';
      current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
        type: 'create',
        productNo: '',
        product,
        verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
        message: '등록 응답에서 상품번호를 확인하지 못했습니다.',
      });
    }
    factoryLog(current.product.cafe24ApiStatus, 'ok', current);
    return body;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 새 상품 등록 실패: ${e.message || e}`;
    current.product.cafe24LastSaveVerification = factoryCafe24SaveVerificationRecord({
      type: 'create',
      productNo: '',
      product,
      verification: { checked: fieldNames.length, matched: 0, missing: [], mismatches: [] },
      error: e.message || String(e),
    });
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

function factorySetDbFieldManualValue(fieldId, value, options = {}) {
  if (!options.factory) {
    return factoryRuntimeUpdateOwnedFactory(
      'factory/runtime:setDbFieldManualValue',
      'product-db',
      draft => factorySetDbFieldManualValue(fieldId, value, { ...options, factory: draft }),
    ).result;
  }
  const factory = options.factory;
  const nextValue = value === null || value === undefined ? '' : String(value);
  if (FACTORY_CAFE24_PRODUCT_SCOPED_OPTION_FIELDS.has(fieldId) || fieldId === 'search_keywords') {
    factoryResetCafe24DraftsForProduct(factory);
  }
  const setting = factoryDbFieldSetting(factory, fieldId, true);
  const nextEnabled = options.enabled !== undefined ? !!options.enabled : setting.enabled;
  const sameValue = String(setting.manualValue ?? '') === nextValue;
  const sameEnabled = options.enabled === undefined || setting.enabled === nextEnabled;
  if (!options.force && setting.manualTouched === true && sameValue && sameEnabled) {
    return false;
  }
  setting.manualValue = nextValue;
  setting.manualTouched = true;
  const identityMeta = typeof factoryCurrentProductIdentityMeta === 'function'
    ? factoryCurrentProductIdentityMeta(factory, [factory.product?.productName, factory.product?.userProductName, state.productName])
    : { productIdentityKey: factoryCurrentProductKey(factory) };
  setting.workspaceId = String(state.currentProjectId || factory.workspace?.id || factory.workspaceId || '').trim();
  setting.productKey = identityMeta.productIdentityKey || '';
  setting.currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
    ? factoryCurrentWorkflowRunId(factory)
    : String(factory.automation?.currentRunId || factory.product?.currentRunId || '').trim();
  setting.inputImageFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
    ? factoryCurrentInputImageFingerprint(factory)
    : String(factory.product?.lockedInputImageFingerprint || factory.product?.inputImageFingerprint || '').trim();
  setting.stageId = `field:${fieldId}`;
  if (options.enabled !== undefined) setting.enabled = nextEnabled;
  if (options.preserveFieldReview !== true && factory.automation?.fieldReview?.[fieldId]) {
    const { [fieldId]: _removedReview, ...remainingFieldReview } = factory.automation.fieldReview;
    factory.automation.fieldReview = remainingFieldReview;
  }
  if (typeof factorySyncDbSizeManualValue === 'function' &&
    ['size', 'dimensions', 'dimension', 'jsize', 'width_mm', 'width', 'product_width', 'depth_mm', 'depth', 'product_depth', 'height', 'product_height', 'height_mm', 'thickness', 'weight', 'product_weight', 'product_weight_g'].includes(fieldId)) {
    factorySyncDbSizeManualValue(fieldId, nextValue, factory);
  }
  if (options.deferFinalize === true) return true;
  factoryUpdateFinalDbFromFields(factory);
  if (fieldId === 'search_keywords') {
    const raw = factoryCafe24RawForForm(factory);
    const sourceTags = factoryCafe24TagSourceList(raw);
    const sourceKey = factoryCafe24TagSourceKey(sourceTags);
    const productKey = factoryCafe24CurrentProductKey(factory) || String(raw.product_no || '').trim();
    const draft = factory.product.cafe24TagsDraft && typeof factory.product.cafe24TagsDraft === 'object'
      ? factory.product.cafe24TagsDraft
      : {};
    if (!Array.isArray(draft.originalTags) || draft.originalSourceKey !== sourceKey || draft.originalProductKey !== productKey) {
      draft.originalTags = sourceTags;
      draft.originalSourceKey = sourceKey;
      draft.originalProductKey = productKey;
    }
    const next = factorySplitCafe24Tags(value);
    const current = factorySplitCafe24Tags(draft.originalTags || []);
    const currentKeys = new Set(current.map(factoryDbNormalizeKey));
    const nextKeys = new Set(next.map(factoryDbNormalizeKey));
    draft.tags = next;
    draft.touched = next.some(tag => !currentKeys.has(factoryDbNormalizeKey(tag))) ||
      current.some(tag => !nextKeys.has(factoryDbNormalizeKey(tag)));
    draft.manualSourceValue = String(value || '');
    factory.product.cafe24TagsDraft = draft;
  }
  factoryRefreshCafe24PrimaryActionButtons();
  factoryRefreshCafe24DedicatedActionButtons();
  if (!providedFactory) scheduleLastWorkSave();
  return true;
}

function factoryCollectCafe24CategoryRowsFromDom() {
  return Array.from(document.querySelectorAll('[data-factory-cafe24-category-row]'))
    .map((row, index) => {
      const rowIndex = row.dataset.factoryCafe24CategoryRow || String(index);
      const read = prop => row.querySelector(`[data-factory-cafe24-category-field="${rowIndex}:${prop}"]`)?.value?.trim() || '';
      return {
        category_no: read('category_no'),
        display_group: read('display_group') || '1',
        recommend: read('recommend') === 'T' ? 'T' : 'F',
        new: read('new') === 'T' ? 'T' : 'F',
      };
    })
    .filter(item => item.category_no);
}

function factoryApplyCafe24CategoryFromDom({ renderAfter = false } = {}) {
  const rows = factoryCollectCafe24CategoryRowsFromDom();
  factorySetDbFieldManualValue('category', JSON.stringify(rows), { enabled: true });
  if (renderAfter) {
    saveLastWorkNow();
    render();
  }
}

function factoryCollectCafe24AdditionalInformationFromDom() {
  const rows = Array.from(document.querySelectorAll('[data-factory-cafe24-additional-row]'))
    .map((row, index) => {
      const rowIndex = row.dataset.factoryCafe24AdditionalRow || String(index);
      const read = prop => row.querySelector(`[data-factory-cafe24-additional-field="${rowIndex}:${prop}"]`)?.value?.trim() || '';
      return {
        key: read('key') || `custom_option${index + 1}`,
        name: read('name'),
        value: read('value'),
      };
    })
    .filter(item => item.key || item.name || item.value)
    .map((item, index) => ({
      key: item.key || `custom_option${index + 1}`,
      name: item.name || `추가정보 ${index + 1}`,
      value: item.value || '',
    }));
  return factoryCafe24CleanAdditionalInfoRows(rows);
}

function factoryApplyCafe24AdditionalInformationFromDom({ renderAfter = false } = {}) {
  const rows = factoryCollectCafe24AdditionalInformationFromDom();
  factorySetDbFieldManualValue('additional_description', JSON.stringify(rows), { enabled: true });
  if (renderAfter) {
    saveLastWorkNow();
    render();
  }
}

function factoryCollectCafe24MemberGroupsFromDom(fieldId) {
  return Array.from(document.querySelectorAll(`[data-factory-cafe24-member-group-row^="${fieldId}:"]`))
    .map((row, index) => {
      const rowIndex = String(row.dataset.factoryCafe24MemberGroupRow || `${fieldId}:${index}`).split(':')[1] || String(index);
      const read = prop => row.querySelector(`[data-factory-cafe24-member-group-field="${fieldId}:${rowIndex}:${prop}"]`)?.value?.trim() || '';
      return {
        key: `group_${index + 1}`,
        group_no: read('group_no'),
        group_name: read('group_name'),
      };
    })
    .filter(item => item.group_no || item.group_name);
}

function factoryApplyCafe24MemberGroupsFromDom(fieldId, { renderAfter = false } = {}) {
  const rows = factoryCollectCafe24MemberGroupsFromDom(fieldId);
  factorySetDbFieldManualValue(fieldId, JSON.stringify(rows), { enabled: true });
  if (renderAfter) {
    saveLastWorkNow();
    render();
  }
}

function factoryCollectCafe24MemberIdsFromDom() {
  return Array.from(document.querySelectorAll('[data-factory-cafe24-member-id-row]'))
    .map((row, index) => {
      const rowIndex = row.dataset.factoryCafe24MemberIdRow || String(index);
      const read = prop => row.querySelector(`[data-factory-cafe24-member-id-field="${rowIndex}:${prop}"]`)?.value?.trim() || '';
      return {
        key: `member_${index + 1}`,
        member_id: read('member_id'),
        memo: read('memo'),
      };
    })
    .filter(item => item.member_id || item.memo);
}

function factoryApplyCafe24MemberIdsFromDom({ renderAfter = false } = {}) {
  const rows = factoryCollectCafe24MemberIdsFromDom();
  factorySetDbFieldManualValue('buy_member_id_list', JSON.stringify(rows), { enabled: true });
  if (renderAfter) {
    saveLastWorkNow();
    render();
  }
}

function factoryCollectCafe24PointsAmountFromDom() {
  return Array.from(document.querySelectorAll('[data-factory-cafe24-points-row]'))
    .map((row, index) => {
      const rowIndex = row.dataset.factoryCafe24PointsRow || String(index);
      const read = prop => row.querySelector(`[data-factory-cafe24-points-field="${rowIndex}:${prop}"]`)?.value?.trim() || '';
      return {
        key: `point_${index + 1}`,
        payment_method: read('payment_method'),
        points_rate: read('points_rate'),
        points_amount: read('points_amount'),
      };
    })
    .filter(item => item.payment_method || item.points_rate || item.points_amount);
}

function factoryApplyCafe24PointsAmountFromDom({ renderAfter = false } = {}) {
  const rows = factoryCollectCafe24PointsAmountFromDom();
  factorySetDbFieldManualValue('points_amount', JSON.stringify(rows), { enabled: true });
  if (renderAfter) {
    saveLastWorkNow();
    render();
  }
}

function factoryCollectCafe24StructuredJsonFromDom(fieldId) {
  const values = {};
  document.querySelectorAll(`[data-factory-cafe24-structured-field^="${fieldId}:"]`).forEach(input => {
    const prop = String(input.dataset.factoryCafe24StructuredField || '').split(':')[1];
    if (!prop) return;
    values[prop] = input.value || '';
  });
  if (fieldId === 'expiration_date' || fieldId === 'icon_show_period' || fieldId === 'promotion_period') {
    return {
      start_date: values.start_date || null,
      end_date: values.end_date || null,
    };
  }
  if (fieldId === 'product_volume') {
    const payload = { use_product_volume: values.use_product_volume || 'F' };
    ['unit','width','height','length'].forEach(key => {
      const value = String(values[key] || '').trim();
      if (value) payload[key] = value;
    });
    return payload;
  }
  if (fieldId === 'size_guide') {
    return {
      use: values.use || 'F',
      type: values.type || 'default',
      default: values.default || '',
      description: values.description || null,
    };
  }
  return values;
}

function factoryApplyCafe24StructuredFieldFromDom(fieldId, { renderAfter = false } = {}) {
  const payload = factoryCollectCafe24StructuredJsonFromDom(fieldId);
  factorySetDbFieldManualValue(fieldId, JSON.stringify(payload), { enabled: true });
  if (renderAfter) {
    saveLastWorkNow();
    render();
  }
}

function factoryCollectCafe24ShippingRatesFromDom() {
  return Array.from(document.querySelectorAll('[data-factory-cafe24-shipping-rate-row]'))
    .map((row, index) => {
      const rowIndex = row.dataset.factoryCafe24ShippingRateRow || String(index);
      const read = prop => row.querySelector(`[data-factory-cafe24-shipping-rate-field="${rowIndex}:${prop}"]`)?.value?.trim() || '';
      return {
        key: `rate_${index + 1}`,
        min: read('min'),
        max: read('max'),
        fee: read('fee'),
        label: read('label'),
      };
    })
    .filter(item => item.min || item.max || item.fee || item.label);
}

function factoryApplyCafe24ShippingRatesFromDom({ renderAfter = false } = {}) {
  const rows = factoryCollectCafe24ShippingRatesFromDom();
  factorySetDbFieldManualValue('shipping_rates', JSON.stringify(rows), { enabled: true });
  if (renderAfter) {
    saveLastWorkNow();
    render();
  }
}

function factoryCollectCafe24OptionGroupDraftFromDom() {
  return Array.from(document.querySelectorAll('[data-factory-cafe24-option-group-name]'))
    .map((nameInput, index) => {
      const valuesInput = document.querySelector(`[data-factory-cafe24-option-group-values="${index}"]`);
      return factoryNormalizeCafe24OptionGroup({
        key: `group_${index + 1}`,
        name: nameInput.value || `옵션${index + 1}`,
        valueText: valuesInput?.value || '',
      }, index);
    })
    .filter(group => group.name || group.values.length);
}

function factoryStoreCafe24OptionGroupDraft(groups = [], options = {}) {
  const { renderAfter = false, factory: providedFactory = null } = options;
  if (!providedFactory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-form-drafts',
      { ...options, render: renderAfter, saveMode: renderAfter ? 'now' : 'schedule' },
      draft => factoryStoreCafe24OptionGroupDraft(groups, { ...options, factory: draft, renderAfter: false }),
    );
  }
  const factory = providedFactory;
  const normalized = (Array.isArray(groups) ? groups : [])
    .map((group, index) => factoryNormalizeCafe24OptionGroup(group, index))
    .filter(group => group.name || group.values.length);
  factory.product.cafe24DraftProductKey = factoryCafe24CurrentProductKey(factory) || factory.product.cafe24DraftProductKey || '';
  factory.product.cafe24OptionGroupsDraft = normalized;
  if (normalized[0]) {
    factorySetDbFieldManualValue('option_name', normalized[0].name, { enabled: true, factory });
    factorySetDbFieldManualValue('option_values', normalized[0].values.join('\n'), { enabled: true, factory });
  }
  return normalized;
}

function factoryApplyCafe24OptionGroupDraftFromDom({ renderAfter = false } = {}) {
  factoryStoreCafe24OptionGroupDraft(factoryCollectCafe24OptionGroupDraftFromDom(), { renderAfter });
}

function factoryCollectCafe24OptionExtrasDraftFromDom() {
  const factory = factoryRuntimeReadFactory();
  const source = factoryCafe24OptionExtrasModel(factory);
  const useAdditionalInput = document.getElementById('factoryCafe24UseAdditionalOption');
  const useAttachedInput = document.getElementById('factoryCafe24UseAttachedFileOption');
  const additionalOptions = Array.from(document.querySelectorAll('[data-factory-cafe24-additional-option-name]'))
    .map((nameInput, index) => {
      const lengthInput = document.querySelector(`[data-factory-cafe24-additional-option-length="${index}"]`);
      const requiredInput = document.querySelector(`[data-factory-cafe24-additional-option-required="${index}"]`);
      return factoryNormalizeCafe24AdditionalOption({
        key: `additional_${index + 1}`,
        additional_option_name: nameInput.value || '',
        additional_option_text_length: lengthInput?.value || '50',
        required_additional_option: requiredInput?.value || 'T',
      }, index);
    })
    .filter(row => row.name);
  return {
    touched: true,
    useAdditionalOption: factoryCafe24OptionFlag(useAdditionalInput?.value || source.useAdditionalOption, 'F'),
    additionalOptions,
    useAttachedFileOption: factoryCafe24OptionFlag(useAttachedInput?.value || source.useAttachedFileOption, 'F'),
    attachedFileOptions: source.attachedFileOptions || [],
    attachedFileOptionRaw: source.attachedFileOptionRaw !== undefined ? cloneData(source.attachedFileOptionRaw) : null,
    updatedAt: Date.now(),
  };
}

function factoryStoreCafe24OptionExtrasDraft(draft = {}, options = {}) {
  const { renderAfter = false, factory: providedFactory = null } = options;
  if (!providedFactory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:update-form-drafts',
      { ...options, render: renderAfter, saveMode: renderAfter ? 'now' : 'schedule' },
      factory => factoryStoreCafe24OptionExtrasDraft(draft, { ...options, factory, renderAfter: false }),
    );
  }
  const factory = providedFactory;
  factory.product.cafe24DraftProductKey = factoryCafe24CurrentProductKey(factory) || factory.product.cafe24DraftProductKey || '';
  factory.product.cafe24OptionExtrasDraft = {
    touched: true,
    useAdditionalOption: factoryCafe24OptionFlag(draft.useAdditionalOption, 'F'),
    additionalOptions: Array.isArray(draft.additionalOptions)
      ? draft.additionalOptions.map((row, index) => factoryNormalizeCafe24AdditionalOption(row, index)).filter(row => row.name)
      : [],
    useAttachedFileOption: factoryCafe24OptionFlag(draft.useAttachedFileOption, 'F'),
    attachedFileOptions: Array.isArray(draft.attachedFileOptions) ? draft.attachedFileOptions : [],
    attachedFileOptionRaw: draft.attachedFileOptionRaw !== undefined ? cloneData(draft.attachedFileOptionRaw) : null,
    updatedAt: Date.now(),
  };
  return factory.product.cafe24OptionExtrasDraft;
}

function factoryApplyCafe24OptionExtrasDraftFromDom({ renderAfter = false } = {}) {
  factoryStoreCafe24OptionExtrasDraft(factoryCollectCafe24OptionExtrasDraftFromDom(), { renderAfter });
}

function bindFactoryCafe24StructuredFieldEvents() {
  let cafe24PanelActionPending = false;
  document.querySelectorAll('[data-factory-source-panel="cafe24"] button').forEach(button => {
    button.addEventListener('pointerdown', () => {
      cafe24PanelActionPending = true;
      setTimeout(() => { cafe24PanelActionPending = false; }, 160);
    }, { capture: true });
  });
  const shouldRenderAfterCafe24FieldBlur = event => {
    if (cafe24PanelActionPending) return false;
    const next = event?.relatedTarget;
    return !(next && typeof next.closest === 'function' && next.closest('[data-factory-source-panel="cafe24"]'));
  };
  const categoryAddBtn = document.getElementById('factoryCafe24CategoryAdd');
  if (categoryAddBtn) {
    categoryAddBtn.onclick = () => {
      const rows = factoryCollectCafe24CategoryRowsFromDom();
      rows.push({ category_no: '', recommend: 'F', new: 'F' });
      factorySetDbFieldManualValue('category', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  }
  document.querySelectorAll('[data-factory-cafe24-category-remove]').forEach(btn => {
    btn.onclick = () => {
      const removeIndex = Number(btn.dataset.factoryCafe24CategoryRemove);
      const rows = factoryCollectCafe24CategoryRowsFromDom().filter((_, index) => index !== removeIndex);
      factorySetDbFieldManualValue('category', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  });
  document.querySelectorAll('[data-factory-cafe24-category-field]').forEach(input => {
    input.oninput = () => factoryApplyCafe24CategoryFromDom();
    input.onchange = () => {
      factoryApplyCafe24CategoryFromDom();
      saveLastWorkNow();
    };
    input.onblur = event => factoryApplyCafe24CategoryFromDom({ renderAfter: shouldRenderAfterCafe24FieldBlur(event) });
  });
  const addBtn = document.getElementById('factoryCafe24AdditionalAdd');
  if (addBtn) {
    addBtn.onclick = () => {
      const rows = factoryCollectCafe24AdditionalInformationFromDom();
      rows.push({ key: `custom_option${rows.length + 1}`, name: '', value: '' });
      factorySetDbFieldManualValue('additional_description', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  }
  document.querySelectorAll('[data-factory-cafe24-additional-remove]').forEach(btn => {
    btn.onclick = () => {
      const removeIndex = Number(btn.dataset.factoryCafe24AdditionalRemove);
      const rows = factoryCollectCafe24AdditionalInformationFromDom().filter((_, index) => index !== removeIndex);
      factorySetDbFieldManualValue('additional_description', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  });
  document.querySelectorAll('[data-factory-cafe24-additional-field]').forEach(input => {
    input.oninput = () => factoryApplyCafe24AdditionalInformationFromDom();
    input.onchange = () => {
      factoryApplyCafe24AdditionalInformationFromDom();
      saveLastWorkNow();
    };
    input.onblur = event => factoryApplyCafe24AdditionalInformationFromDom({ renderAfter: shouldRenderAfterCafe24FieldBlur(event) });
  });
  document.querySelectorAll('[data-factory-cafe24-member-group-add]').forEach(btn => {
    btn.onclick = () => {
      const fieldId = btn.dataset.factoryCafe24MemberGroupAdd;
      const rows = factoryCollectCafe24MemberGroupsFromDom(fieldId);
      rows.push({ key: `group_${rows.length + 1}`, group_no: '', group_name: '' });
      factorySetDbFieldManualValue(fieldId, JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  });
  document.querySelectorAll('[data-factory-cafe24-member-group-remove]').forEach(btn => {
    btn.onclick = () => {
      const [fieldId, rawIndex] = String(btn.dataset.factoryCafe24MemberGroupRemove || '').split(':');
      const removeIndex = Number(rawIndex);
      const rows = factoryCollectCafe24MemberGroupsFromDom(fieldId).filter((_, index) => index !== removeIndex);
      factorySetDbFieldManualValue(fieldId, JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  });
  document.querySelectorAll('[data-factory-cafe24-member-group-field]').forEach(input => {
    const fieldId = String(input.dataset.factoryCafe24MemberGroupField || '').split(':')[0];
    input.oninput = () => factoryApplyCafe24MemberGroupsFromDom(fieldId);
    input.onchange = () => {
      factoryApplyCafe24MemberGroupsFromDom(fieldId);
      saveLastWorkNow();
    };
    input.onblur = event => factoryApplyCafe24MemberGroupsFromDom(fieldId, { renderAfter: shouldRenderAfterCafe24FieldBlur(event) });
  });
  const memberIdAddBtn = document.getElementById('factoryCafe24MemberIdAdd');
  if (memberIdAddBtn) {
    memberIdAddBtn.onclick = () => {
      const rows = factoryCollectCafe24MemberIdsFromDom();
      rows.push({ key: `member_${rows.length + 1}`, member_id: '', memo: '' });
      factorySetDbFieldManualValue('buy_member_id_list', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  }
  document.querySelectorAll('[data-factory-cafe24-member-id-remove]').forEach(btn => {
    btn.onclick = () => {
      const removeIndex = Number(btn.dataset.factoryCafe24MemberIdRemove);
      const rows = factoryCollectCafe24MemberIdsFromDom().filter((_, index) => index !== removeIndex);
      factorySetDbFieldManualValue('buy_member_id_list', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  });
  document.querySelectorAll('[data-factory-cafe24-member-id-field]').forEach(input => {
    input.oninput = () => factoryApplyCafe24MemberIdsFromDom();
    input.onchange = () => {
      factoryApplyCafe24MemberIdsFromDom();
      saveLastWorkNow();
    };
    input.onblur = event => factoryApplyCafe24MemberIdsFromDom({ renderAfter: shouldRenderAfterCafe24FieldBlur(event) });
  });
  const pointsAddBtn = document.getElementById('factoryCafe24PointsAdd');
  if (pointsAddBtn) {
    pointsAddBtn.onclick = () => {
      const rows = factoryCollectCafe24PointsAmountFromDom();
      rows.push({ key: `point_${rows.length + 1}`, payment_method: '', points_rate: '', points_amount: '' });
      factorySetDbFieldManualValue('points_amount', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  }
  document.querySelectorAll('[data-factory-cafe24-points-remove]').forEach(btn => {
    btn.onclick = () => {
      const removeIndex = Number(btn.dataset.factoryCafe24PointsRemove);
      const rows = factoryCollectCafe24PointsAmountFromDom().filter((_, index) => index !== removeIndex);
      factorySetDbFieldManualValue('points_amount', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  });
  document.querySelectorAll('[data-factory-cafe24-points-field]').forEach(input => {
    input.oninput = () => factoryApplyCafe24PointsAmountFromDom();
    input.onchange = () => {
      factoryApplyCafe24PointsAmountFromDom();
      saveLastWorkNow();
    };
    input.onblur = event => factoryApplyCafe24PointsAmountFromDom({ renderAfter: shouldRenderAfterCafe24FieldBlur(event) });
  });
  const shippingRateAddBtn = document.getElementById('factoryCafe24ShippingRateAdd');
  if (shippingRateAddBtn) {
    shippingRateAddBtn.onclick = () => {
      const rows = factoryCollectCafe24ShippingRatesFromDom();
      rows.push({ key: `rate_${rows.length + 1}`, min: '', max: '', fee: '', label: '' });
      factorySetDbFieldManualValue('shipping_rates', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  }
  document.querySelectorAll('[data-factory-cafe24-shipping-rate-remove]').forEach(btn => {
    btn.onclick = () => {
      const removeIndex = Number(btn.dataset.factoryCafe24ShippingRateRemove);
      const rows = factoryCollectCafe24ShippingRatesFromDom().filter((_, index) => index !== removeIndex);
      factorySetDbFieldManualValue('shipping_rates', JSON.stringify(rows), { enabled: true });
      saveLastWorkNow();
      render();
    };
  });
  document.querySelectorAll('[data-factory-cafe24-shipping-rate-field]').forEach(input => {
    input.oninput = () => factoryApplyCafe24ShippingRatesFromDom();
    input.onchange = () => {
      factoryApplyCafe24ShippingRatesFromDom();
      saveLastWorkNow();
    };
    input.onblur = event => factoryApplyCafe24ShippingRatesFromDom({ renderAfter: shouldRenderAfterCafe24FieldBlur(event) });
  });
  document.querySelectorAll('[data-factory-cafe24-structured-field]').forEach(input => {
    const fieldId = String(input.dataset.factoryCafe24StructuredField || '').split(':')[0];
    if (!fieldId) return;
    input.oninput = () => factoryApplyCafe24StructuredFieldFromDom(fieldId);
    input.onchange = () => {
      factoryApplyCafe24StructuredFieldFromDom(fieldId);
      saveLastWorkNow();
    };
    input.onblur = event => factoryApplyCafe24StructuredFieldFromDom(fieldId, { renderAfter: shouldRenderAfterCafe24FieldBlur(event) });
  });
}

function factoryAddCustomDbFieldFromRow(row, options = {}) {
  if (!row) return false;
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/db:add-custom-field',
      { ...options, owner: 'product-db' },
      draft => factoryAddCustomDbFieldFromRow(row, { ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  if (row.sourceType === 'cafe24') {
    factoryLog('Cafe24 상세 필드는 완성 DB 커스텀 필드로 추가하지 않습니다. 위의 Cafe24 상품 입력판 한글 칸 또는 옵션/이미지 전용 패널에서 수정해주세요.', 'error', factory);
    return false;
  }
  const id = `custom_${factoryDbNormalizeKey(row.sourceLabel + '_' + row.key).slice(0, 60) || uid('db')}`;
  const existing = factory.product.dbCustomFields.find(field => field.id === id);
  if (!existing) {
    factory.product.dbCustomFields.push({
      id,
      label: row.key.split('.').slice(-1)[0] || row.key,
      sourceKey: row.key,
      sourceLabel: row.sourceLabel,
      sourceValue: row.value,
      enabled: true,
    });
  }
  const setting = factoryDbFieldSetting(factory, id, true);
  setting.enabled = true;
  setting.manualValue = row.value || setting.manualValue || '';
  factoryUpdateFinalDbFromFields(factory);
  factoryLog(`${row.sourceLabel} ${row.key} 필드를 완성 DB에 추가했습니다.`, 'ok', factory);
  return true;
}

function factoryRemoveCustomDbField(fieldId, factory = null) {
  if (!factory) {
    const receipt = factoryRuntimeUpdateOwnedFactory(
      'factory/runtime:removeCustomDbField',
      'product-db',
      draft => factoryRemoveCustomDbField(fieldId, draft),
    );
    saveLastWorkNow();
    render();
    return receipt.result;
  }
  factory.product.dbCustomFields = factory.product.dbCustomFields.filter(field => field.id !== fieldId);
  if (factory.product.dbFieldSettings) {
    const { [fieldId]: _removedField, ...remainingFieldSettings } = factory.product.dbFieldSettings;
    factory.product.dbFieldSettings = remainingFieldSettings;
  }
  factoryUpdateFinalDbFromFields(factory);
  factoryLog(`완성 DB 커스텀 필드 ${fieldId}를 제거했습니다.`, 'info', factory);
  return true;
}

function factoryApplyFinalDbToConfirmedDb(options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/db:apply-final-db',
      { ...options, owner: 'product-db' },
      draft => factoryApplyFinalDbToConfirmedDb({ ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  const model = factoryUpdateFinalDbFromFields(factory);
  factory.product.confirmedDb = {
    ...(factory.product.confirmedDb || {}),
    ...model.finalDb,
  };
  factory.product.dbLocked = true;
  factorySetStageStatus('db', model.missing.length ? 'blocked' : 'done', model.missing.length ? `완성 DB 누락 ${model.missing.length}개` : '완성 DB 필드 반영 완료', factory);
  factoryLog(`완성 DB ${Object.keys(model.finalDb).length}개 필드를 확정 DB에 반영했습니다.`, model.missing.length ? 'error' : 'ok', factory);
  return model;
}

function factorySaveCurrentDbPreset(options = {}) {
  if (!options.factory) {
    const name = prompt('DB 필드 프리셋 이름을 입력해주세요.', '상세페이지 기본 DB 필드');
    if (!name) return false;
    const presets = factoryLoadDbFieldPresets();
    return factoryCafe24RunOwnedDraftMutation(
      'factory/db:save-field-preset',
      {
        ...options,
        owner: 'product-db',
        presetName: name.trim(),
        afterCommit: preset => factorySaveDbFieldPresets([
          preset,
          ...presets.filter(item => item.name !== preset.name),
        ].slice(0, 30)),
      },
      draft => factorySaveCurrentDbPreset({ ...options, factory: draft, presetName: name.trim(), render: false }),
    );
  }
  const factory = options.factory;
  const id = `preset_${Date.now()}`;
  const preset = { id, name: options.presetName, createdAt: Date.now(), ...factoryPresetSnapshot(factory) };
  factory.product.dbFieldPresetId = id;
  factoryLog(`DB 필드 프리셋 저장: ${preset.name}`, 'ok', factory);
  return preset;
}

function factoryApplyDbPreset(presetId, options = {}) {
  if (!options.factory) {
    const preset = factoryLoadDbFieldPresets().find(item => item.id === presetId);
    if (!preset) return false;
    return factoryCafe24RunOwnedDraftMutation(
      'factory/db:apply-field-preset',
      { ...options, owner: 'product-db' },
      draft => factoryApplyDbPreset(presetId, { ...options, factory: draft, preset, render: false }),
    );
  }
  const factory = options.factory;
  const preset = options.preset;
  if (!preset) return false;
  factory.product.dbFieldPresetId = preset.id;
  factory.product.dbCustomFields = (preset.customFields || []).map(field => ({
    id: field.id,
    label: field.label,
    sourceKey: field.sourceKey || '',
    sourceLabel: field.sourceLabel || '',
    enabled: field.enabled !== false,
  }));
  const nextSettings = { ...(factory.product.dbFieldSettings || {}) };
  Object.entries(preset.enabled || {}).forEach(([fieldId, enabled]) => {
    nextSettings[fieldId] = { ...(nextSettings[fieldId] || {}), enabled: !!enabled };
  });
  factory.product.dbFieldSettings = nextSettings;
  factoryUpdateFinalDbFromFields(factory);
  factoryLog(`DB 필드 프리셋 적용: ${preset.name}`, 'ok', factory);
  return true;
}

function factoryApplyProductToApp(factory = null, options = {}) {
  if (!factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/runtime:apply-product-to-app',
      { ...options, owner: 'product-db', render: false, saveMode: 'schedule' },
      draft => factoryApplyProductToApp(draft, { ...options, render: false }),
    );
  }
  if (typeof factory !== 'object') throw new TypeError('factory draft is required');
  if (factory.product.productName) state.productName = factory.product.productName;
  const payload = typeof currentProductImagePayload === 'function'
    ? currentProductImagePayload({ prefer: 'factory', allowDerived: false, factory })
    : null;
  const imageBase64 = payload?.base64 || factory.product.imageBase64 || '';
  if (imageBase64) {
    state.imageBase64 = typeof imageBase64Only === 'function' ? imageBase64Only(imageBase64) : imageBase64;
    state.imageMime = payload?.mime || factory.product.imageMime || 'image/png';
    state.imagePreview = payload?.preview || factory.product.imagePreview || `data:${state.imageMime};base64,${state.imageBase64}`;
    state.analysisImages = [{
      base64: state.imageBase64,
      mime: state.imageMime,
      preview: state.imagePreview,
      name: '조립공장 대표 입력',
    }];
    factory.product.imageBase64 = state.imageBase64;
    factory.product.imageMime = state.imageMime;
    factory.product.imagePreview = state.imagePreview;
    factory.product.inputImages = [{
      id: factory.product.inputImages?.[0]?.id || uid('factory_input'),
      name: factory.product.inputImages?.[0]?.name || payload?.name || '제품사진',
      base64: state.imageBase64,
      mime: state.imageMime,
      preview: state.imagePreview,
    }];
  }
  if (typeof syncProductImageAcrossWorkspaces === 'function') syncProductImageAcrossWorkspaces({ prefer: 'factory', factory });
  return true;
}

async function factoryCreateCafe24HiddenTestProduct(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:create-hidden-test',
      'cafe24',
      draft => factoryCreateCafe24HiddenTestProduct({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const model = factoryUpdateFinalDbFromFields(factory);
  const baseName = String(model.finalDb.product_name || factory.product.productName || state.productName || '상품')
    .replace(/\s*test$/i, '')
    .trim() || '상품';
  const name = typeof prompt === 'function'
    ? String(prompt('Cafe24 숨김 테스트 상품명을 입력하세요. 진열안함/판매안함으로 등록됩니다.', `${baseName}test`) || '').trim()
    : `${baseName}test`;
  if (!name) return false;
  return factoryCreateCafe24ProductFromFinalDb({
    allowSelectedSource: true,
    forceHiddenTest: true,
    forceName: name,
    avoidDuplicateByName: false,
    updateExistingOnDuplicate: false,
    skipConfirm: false,
    factory,
    render: false,
  });
}

function factoryAnalysisImportText(value) {
  if (Array.isArray(value)) return value.map(factoryAnalysisImportText).filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    const preferred = [
      value.product_name,
      value.jname,
      value.name,
      value.label,
      value.title,
      value.value,
      value.text,
      value.category_name,
      value.category,
    ].map(factoryAnalysisImportText).find(Boolean);
    if (preferred) return preferred;
    return Object.entries(value)
      .filter(([, child]) => hasProductValue(child))
      .slice(0, 6)
      .map(([key, child]) => `${key}: ${factoryAnalysisImportText(child)}`)
      .filter(Boolean)
      .join(' / ');
  }
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function factoryAnalysisImportFirst(...values) {
  return values.map(factoryAnalysisImportText).find(Boolean) || '';
}

function factoryAnalysisImportDataUrlParts(preview, fallbackMime = 'image/png') {
  const text = String(preview || '');
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(text);
  if (!match) return null;
  return { mime: match[1] || fallbackMime || 'image/png', base64: match[2] || '', preview: text };
}

function factoryAnalysisImportImageRecords(factory = factoryRuntimeReadFactory()) {
  const product = factory.product || {};
  const records = [];
  const seen = new Set();
  const addRecord = (record = {}) => {
    const fromPreview = !record.base64 ? factoryAnalysisImportDataUrlParts(record.preview, record.mime) : null;
    const base64 = record.base64 || fromPreview?.base64 || '';
    const preview = record.preview && record.preview !== '__stored_in_indexeddb__'
      ? record.preview
      : (base64 ? `data:${record.mime || fromPreview?.mime || 'image/png'};base64,${base64}` : '');
    if (!base64 && !preview) return;
    const key = base64 ? `${base64.length}:${base64.slice(0, 32)}:${base64.slice(-32)}` : preview;
    if (seen.has(key)) return;
    seen.add(key);
    records.push({
      base64,
      mime: record.mime || fromPreview?.mime || product.imageMime || 'image/png',
      preview,
      name: record.name || '조립공장 최신 이미지',
    });
  };
  addRecord({
    base64: product.imageBase64,
    mime: product.imageMime,
    preview: product.imagePreview,
    name: '조립공장 대표 이미지',
  });
  (Array.isArray(product.inputImages) ? product.inputImages : []).forEach((img, index) => {
    addRecord({
      base64: img?.base64,
      mime: img?.mime || img?.mimeType || product.imageMime,
      preview: img?.preview,
      name: img?.name || `조립공장 입력 이미지 ${index + 1}`,
    });
  });
  return records.slice(0, 5);
}

function factoryAnalysisImportDimensionText(value, defaultUnit = 'mm') {
  const text = factoryAnalysisImportText(value);
  if (!text) return '';
  if (/[a-zA-Z㎜㎝]|mm|cm|미리|센티|밀리|인치/.test(text)) return text;
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return `${text}${defaultUnit}`;
  return text;
}

function factoryAnalysisImportDimensionNumber(value) {
  const text = factoryAnalysisImportText(value);
  const match = /([0-9]+(?:\.[0-9]+)?)/.exec(text);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function factoryAnalysisImportDimensions(finalDb = {}, confirmedDb = {}, rows = []) {
  const spec = confirmedDb?.spec || {};
  const sizeText = factoryAnalysisImportFirst(
    finalDb.size,
    finalDb.dimensions,
    confirmedDb.size,
    confirmedDb.dimensions,
    factorySourceRowsValueByAliases(rows, ['size', 'dimensions', 'dimension', 'spec', 'specification', '규격', '크기', '사이즈'])
  );
  const out = {
    width: factoryAnalysisImportDimensionText(spec.width_mm || finalDb.width_mm || finalDb.width || factorySourceRowsValueByAliases(rows, ['width', 'product_width', '가로', '폭', '너비'])),
    depth: factoryAnalysisImportDimensionText(spec.depth_mm || finalDb.depth_mm || finalDb.depth || finalDb.height || factorySourceRowsValueByAliases(rows, ['depth', 'height', 'product_height', '세로', '길이'])),
    height: factoryAnalysisImportDimensionText(spec.height_mm || finalDb.height_mm || factorySourceRowsValueByAliases(rows, ['height_mm', '높이', '두께', 'thickness'])),
    summary: sizeText,
  };
  const labeledPatterns = [
    ['width', /(가로|폭|너비|width|w)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:mm|cm|㎜|㎝|미리|센티)?)/i],
    ['depth', /(세로|길이|height|h|depth|d)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:mm|cm|㎜|㎝|미리|센티)?)/i],
    ['height', /(높이|두께|thickness)\s*[:：=]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:mm|cm|㎜|㎝|미리|센티)?)/i],
  ];
  labeledPatterns.forEach(([key, pattern]) => {
    if (out[key] || !sizeText) return;
    const match = pattern.exec(sizeText);
    if (match) out[key] = factoryAnalysisImportDimensionText(match[2]);
  });
  if ((!out.width || !out.depth) && sizeText) {
    const match = /([0-9]+(?:\.[0-9]+)?)\s*(mm|cm|㎜|㎝)?\s*(?:x|X|×|\*)\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|cm|㎜|㎝)?(?:\s*(?:x|X|×|\*)\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|cm|㎜|㎝)?)?/i.exec(sizeText);
    if (match) {
      const unit = match[2] || match[4] || match[6] || 'mm';
      if (!out.width) out.width = `${match[1]}${unit}`;
      if (!out.depth) out.depth = `${match[3]}${unit}`;
      if (!out.height && match[5]) out.height = `${match[5]}${unit}`;
    }
  }
  if (!out.summary) {
    out.summary = [
      out.width ? `가로 ${out.width}` : '',
      out.depth ? `세로 ${out.depth}` : '',
      out.height ? `높이 ${out.height}` : '',
    ].filter(Boolean).join(' / ');
  }
  return out;
}

function factoryBuildAnalysisDbMatchFromFactory(factory, finalDb, confirmedDb, dims, optionValues) {
  const base = confirmedDb && typeof confirmedDb === 'object' ? cloneData(confirmedDb) : {};
  const hasBase = Object.keys(base || {}).length > 0;
  const hasFinal = Object.keys(finalDb || {}).some(key => factoryAnalysisImportText(finalDb[key]));
  if (!hasBase && !hasFinal) return null;
  const match = { ...(base || {}) };
  match.source = match.source || (hasBase ? '조립공장 신화사DB 확정값' : '조립공장 완성 DB');
  match.matched_at = match.matched_at || Date.now();
  match.match_query = match.match_query || factory.product.productName || finalDb.product_name || '';
  match.product_name = factoryAnalysisImportFirst(match.product_name, match.jname, finalDb.product_name, factory.product.productName);
  match.size = factoryAnalysisImportFirst(match.size, finalDb.size, dims.summary);
  match.dimensions = factoryAnalysisImportFirst(match.dimensions, finalDb.size, dims.summary);
  match.color = factoryAnalysisImportFirst(match.color, Array.isArray(match.colors) ? match.colors.join(', ') : match.colors, optionValues.join(', '), finalDb.option_values);
  match.colors = Array.isArray(match.colors) && match.colors.length ? match.colors : optionValues;
  match.material_summary = factoryAnalysisImportFirst(match.material_summary, match.spec?.material_summary, finalDb.material);
  match.packaging_summary = factoryAnalysisImportFirst(match.packaging_summary, match.spec?.packaging_summary, finalDb.shipping_package, finalDb.packaging, finalDb.additional_description);
  match.purchase_price = match.purchase_price ?? finalDb.purchase_price ?? '';
  match.sale_price = match.sale_price ?? finalDb.sale_price ?? '';
  match.stock_qty = match.stock_qty ?? finalDb.stock ?? '';
  match.spec = {
    ...(match.spec || {}),
    width_mm: match.spec?.width_mm ?? factoryAnalysisImportDimensionNumber(dims.width),
    depth_mm: match.spec?.depth_mm ?? factoryAnalysisImportDimensionNumber(dims.depth),
    height_mm: match.spec?.height_mm ?? factoryAnalysisImportDimensionNumber(dims.height),
    material_summary: match.spec?.material_summary || factoryAnalysisImportFirst(match.material_summary, finalDb.material),
    packaging_summary: match.spec?.packaging_summary || factoryAnalysisImportFirst(match.packaging_summary, finalDb.shipping_package, finalDb.packaging),
  };
  return match;
}

function factoryApplyLatestToAnalysisHub(options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/runtime:apply-latest-to-analysis',
      { ...options, owner: 'product-db' },
      draft => factoryApplyLatestToAnalysisHub({ ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  const previousFinalDb = { ...(factory.product.finalDb || {}) };
  const model = factoryUpdateFinalDbFromFields(factory);
  const finalDb = { ...previousFinalDb, ...(model.finalDb || {}), ...(factory.product.finalDb || {}) };
  const analysisDbMatch = state.analysis && typeof state.analysis === 'object'
    ? (state.analysis.db_match || state.analysis.sinhwa_match || state.analysis.db_product || state.analysis.matched_product || null)
    : null;
  const confirmedDb = factory.product.confirmedDb && typeof factory.product.confirmedDb === 'object'
    ? cloneData(factory.product.confirmedDb)
    : (analysisDbMatch && typeof analysisDbMatch === 'object' ? cloneData(analysisDbMatch) : null);
  const rows = factoryDbSourceRows(factory);
  const cafe24Target = factoryCafe24TargetCandidate(factory, { allowFallback: true });
  const cafe24Raw = cafe24Target ? parseCafe24Raw(cafe24Target) : {};
  const cafe24Value = (...aliases) => {
    const sources = [finalDb, cafe24Target, cafe24Raw, cafe24Raw?.product, cafe24Raw?.detail, cafe24Raw?.data]
      .filter(source => source && typeof source === 'object');
    for (const source of sources) {
      const value = typeof productInfoObjectValue === 'function'
        ? productInfoObjectValue(source, aliases)
        : aliases.map(alias => source[alias]).find(value => factoryAnalysisImportText(value));
      if (factoryAnalysisImportText(value)) return value;
    }
    return '';
  };
  const cafe24ProductNo = cafe24Value('cafe24_product_no', 'product_no');
  const cafe24ProductCode = cafe24Value('cafe24_product_code', 'product_code', 'custom_product_code');
  const cafe24ProductName = cafe24Value('cafe24_product_name', 'product_name', 'mall_product_name_ko');
  const cafe24SalePrice = cafe24Value('sale_price', 'price');
  const cafe24RetailPrice = cafe24Value('retail_price', 'consumer_price', 'market_price');
  const cafe24SupplyPrice = cafe24Value('supply_price', 'supplier_price', 'purchase_price');
  const cafe24Display = cafe24Value('display', 'display_status');
  const cafe24Selling = cafe24Value('selling', 'selling_status');
  const cafe24DisplayStatus = typeof productInfoCafe24FlagText === 'function'
    ? productInfoCafe24FlagText(cafe24Display, cafe24Selling)
    : [cafe24Display, cafe24Selling].filter(Boolean).join(' / ');
  const optionPlan = typeof factoryDbOptionPlanForOptionSorter === 'function'
    ? factoryDbOptionPlanForOptionSorter(factory)
    : { values: [], optionName: '', sourceLabel: '' };
  const optionValues = factoryDedupeRealOptionValues([
    ...(optionPlan.values || []),
    ...factorySplitOptionText(finalDb.option_values || finalDb.color || finalDb.colors || ''),
    ...factorySplitOptionText(factoryCafe24DbFieldValue('option_values', factory)),
    ...factorySplitOptionText(confirmedDb?.color || (Array.isArray(confirmedDb?.colors) ? confirmedDb.colors.join(', ') : confirmedDb?.colors) || ''),
  ], { allowNumeric: true });
  const dims = factoryAnalysisImportDimensions(finalDb, confirmedDb || {}, rows);
  const productName = factoryAnalysisImportFirst(
    typeof factoryAuthoritativeProductName === 'function' ? factoryAuthoritativeProductName(factory) : '',
    factory.product.productName,
    finalDb.product_name,
    finalDb.mall_product_name_ko,
    confirmedDb?.product_name,
    confirmedDb?.jname,
    cafe24Raw.product_name,
    state.productName
  );
  const category = factoryAnalysisImportFirst(
    finalDb.category,
    factorySourceRowsValueByAliases(rows, ['category', 'categories', 'category_name', 'display_category', '분류', '카테고리']),
    cafe24Raw.category_name,
    cafe24Raw.categories
  );
  const material = factoryAnalysisImportFirst(
    finalDb.material,
    confirmedDb?.material_summary,
    confirmedDb?.spec?.material_summary,
    factoryCafe24DbFieldValue('material', factory)
  );
  const packaging = factoryAnalysisImportFirst(
    finalDb.shipping_package,
    finalDb.packaging,
    confirmedDb?.packaging_summary,
    confirmedDb?.spec?.packaging_summary,
    factorySourceRowsValueByAliases(rows, ['packaging', 'shipping_package', 'package_info', '구성', '포장'])
  );
  const usagePlace = factoryAnalysisImportFirst(
    finalDb.usage_place,
    finalDb.use_place,
    confirmedDb?.usage_place,
    confirmedDb?.use_place,
    factorySourceRowsValueByAliases(rows, ['usage_place', 'use_place', 'place_of_use', 'usage_location', '사용처'])
  );
  const usagePurpose = factoryAnalysisImportFirst(
    finalDb.recommended_use,
    finalDb.usage_purpose,
    finalDb.use_purpose,
    finalDb.purpose,
    confirmedDb?.recommended_use,
    confirmedDb?.usage_purpose,
    confirmedDb?.use_purpose,
    confirmedDb?.purpose,
    factorySourceRowsValueByAliases(rows, ['recommended_use', 'usage_purpose', 'use_purpose', 'purpose', '용도', '추천 사용 상황'])
  );
  const targetCustomer = factoryAnalysisImportFirst(
    finalDb.target_customer,
    finalDb.target,
    finalDb.customer,
    confirmedDb?.target_customer,
    confirmedDb?.target,
    confirmedDb?.customer,
    factorySourceRowsValueByAliases(rows, ['target_customer', 'target', 'customer', '대상 고객', '타깃 고객'])
  );
  const seasonEvent = factoryAnalysisImportFirst(
    finalDb.season_event,
    finalDb.event_season,
    finalDb.occasion,
    finalDb.season,
    confirmedDb?.season_event,
    confirmedDb?.event_season,
    confirmedDb?.occasion,
    confirmedDb?.season,
    factorySourceRowsValueByAliases(rows, ['season_event', 'event_season', 'occasion', 'season', '시즌/행사', '시즌', '행사'])
  );
  const imageKeywords = factoryAnalysisImportFirst(
    finalDb.image_keywords,
    finalDb.visual_keywords,
    finalDb.image_keyword,
    finalDb.keywords_for_image,
    confirmedDb?.image_keywords,
    confirmedDb?.visual_keywords,
    confirmedDb?.image_keyword,
    confirmedDb?.keywords_for_image,
    factorySourceRowsValueByAliases(rows, ['image_keywords', 'visual_keywords', 'image_keyword', 'keywords_for_image', '이미지 키워드'])
  );
  const imageWorkHint = factoryAnalysisImportFirst(
    finalDb.image_work_hint,
    finalDb.image_hint,
    finalDb.visual_direction,
    finalDb.photo_direction,
    confirmedDb?.image_work_hint,
    confirmedDb?.image_hint,
    confirmedDb?.visual_direction,
    confirmedDb?.photo_direction,
    factorySourceRowsValueByAliases(rows, ['image_work_hint', 'image_hint', 'visual_direction', 'photo_direction', '이미지 작업 힌트'])
  );
  const detailPageHint = factoryAnalysisImportFirst(
    finalDb.detail_page_hint,
    finalDb.description_hint,
    finalDb.detail_hint,
    finalDb.copy_hint,
    confirmedDb?.detail_page_hint,
    confirmedDb?.description_hint,
    confirmedDb?.detail_hint,
    confirmedDb?.copy_hint,
    factorySourceRowsValueByAliases(rows, ['detail_page_hint', 'description_hint', 'detail_hint', 'copy_hint', '상세페이지/설명 힌트', '상세페이지 힌트', '설명 힌트'])
  );
  const dbMatch = factoryBuildAnalysisDbMatchFromFactory(factory, finalDb, confirmedDb || {}, dims, optionValues);
  const dbCandidates = (factory.product.dbCandidates && factory.product.dbCandidates.length)
    ? factory.product.dbCandidates
    : ((factory.product.pendingDbCandidates && factory.product.pendingDbCandidates.length)
      ? factory.product.pendingDbCandidates
      : (dbMatch?.candidates || []));
  const images = factoryAnalysisImportImageRecords(factory);
  const syncedAt = Date.now();
  const hasImportData = !!(
    productName ||
    Object.keys(finalDb).length ||
    confirmedDb ||
    cafe24Target ||
    optionValues.length ||
    images.length
  );
  if (!hasImportData) {
    setUiNotice('조립공장에 가져올 확정 DB/Cafe24/옵션/이미지 값이 아직 없습니다.', 'warn');
    render();
    return false;
  }

  if (images.length) {
    state.analysisImages = images;
    const first = images[0];
    state.imagePreview = first.preview || (first.base64 ? `data:${first.mime || 'image/png'};base64,${first.base64}` : '');
    state.imageBase64 = first.base64 || '';
    state.imageMime = first.base64 ? (first.mime || 'image/png') : '';
  }
  if (productName) state.productName = productName;

  const importedManual = {};
  const putManual = (fieldId, value) => {
    const text = productInfoValueText(value);
    if (text) importedManual[fieldId] = text;
  };
  putManual('product_name', productName);
  putManual('category_usage', category);
  putManual('width_mm', dims.width);
  putManual('depth_mm', dims.depth);
  putManual('height_mm', dims.height);
  putManual('dimensions', dims.summary);
  putManual('color_options', optionValues.join(', ') || finalDb.option_values || confirmedDb?.color);
  putManual('material', material);
  putManual('packaging', packaging);
  putManual('product_weight_g', confirmedDb?.product_weight_g ? `${confirmedDb.product_weight_g}g` : finalDb.weight);
  putManual('stock_qty', finalDb.stock || confirmedDb?.stock_qty);
  putManual('purchase_price', finalDb.purchase_price || confirmedDb?.purchase_price);
  putManual('sale_price', finalDb.sale_price || confirmedDb?.sale_price || cafe24SalePrice);
  putManual('retail_price', finalDb.consumer_price || cafe24RetailPrice);
  putManual('supply_price', finalDb.purchase_price || cafe24SupplyPrice);
  putManual('cafe24_product_no', cafe24ProductNo);
  putManual('cafe24_product_code', cafe24ProductCode);
  putManual('display_status', cafe24DisplayStatus);
  putManual('option_name', optionPlan.optionName || finalDb.option_name || factoryCafe24DbFieldValue('option_name', factory));
  putManual('option_value', optionValues.join(', '));
  putManual('manufacturer', finalDb.manufacturer || cafe24Value('manufacturer_name', 'manufacturer', 'manufacturer_code'));
  putManual('supplier', finalDb.supplier || cafe24Value('supplier_name', 'supplier', 'supplier_code'));
  putManual('brand', finalDb.brand || cafe24Value('brand_name', 'brand', 'brand_code'));
  putManual('origin', finalDb.origin || cafe24Value('origin', 'made_in', 'made_in_code', 'origin_place_value'));
  putManual('cafe24_keywords', finalDb.search_keywords || cafe24Value('search_keywords', 'keyword', 'tags', 'product_tag'));
  putManual('cafe24_summary', finalDb.summary_description || cafe24Value('summary_description', 'simple_description', 'product_summary'));
  putManual('model_name', finalDb.model_name || cafe24Value('model_name', 'model'));
  putManual('usage_place', usagePlace);
  putManual('recommended_use', usagePurpose);
  putManual('target_customer', targetCustomer);
  putManual('season_event', seasonEvent);
  putManual('image_keywords', imageKeywords);
  putManual('image_work_hint', imageWorkHint);
  putManual('detail_page_hint', detailPageHint);

  const managedFields = [
    'product_name', 'category_usage', 'width_mm', 'depth_mm', 'height_mm', 'dimensions',
    'color_options', 'material', 'packaging', 'product_weight_g', 'stock_qty',
    'purchase_price', 'sale_price', 'retail_price', 'supply_price', 'cafe24_product_no',
    'cafe24_product_code', 'display_status', 'option_name', 'option_value', 'manufacturer', 'supplier',
    'brand', 'origin', 'cafe24_keywords', 'cafe24_summary', 'model_name',
    'usage_place', 'recommended_use', 'target_customer', 'season_event',
    'image_keywords', 'image_work_hint', 'detail_page_hint',
  ];
  const nextManual = normalizeProductInfoManualValues(state.productInfoManualValues || {});
  managedFields.forEach(fieldId => { delete nextManual[fieldId]; });
  Object.assign(nextManual, normalizeProductInfoManualValues(importedManual));
  state.productInfoManualValues = nextManual;

  const nextSettings = normalizeProductInfoFieldSettings(state.productInfoFieldSettings || {});
  Object.keys(importedManual).forEach(fieldId => {
    if (!nextSettings[fieldId]) return;
    nextSettings[fieldId] = {
      ...nextSettings[fieldId],
      active: true,
      required: nextSettings[fieldId].required,
    };
  });
  state.productInfoFieldSettings = nextSettings;

  const nextAnalysis = {
    product_name: productName,
    productName,
    category,
    product_category: category,
    width_mm: dims.width,
    depth_mm: dims.depth,
    height_mm: dims.height,
    size_estimate: dims.summary,
    dimensions: dims.summary,
    colors: optionValues,
    option_colors: optionValues,
    color: optionValues.join(', '),
    material,
    materials: material,
    packaging,
    components: packaging,
    stock_qty: finalDb.stock || confirmedDb?.stock_qty || '',
    purchase_price: finalDb.purchase_price || confirmedDb?.purchase_price || '',
    sale_price: finalDb.sale_price || confirmedDb?.sale_price || cafe24SalePrice || '',
    price: finalDb.sale_price || cafe24SalePrice || '',
    retail_price: finalDb.consumer_price || cafe24RetailPrice || '',
    supply_price: finalDb.purchase_price || cafe24SupplyPrice || '',
    cafe24_match: cafe24Target ? cloneData(cafe24Target) : null,
    cafe24_product_no: cafe24ProductNo || '',
    cafe24_product_code: cafe24ProductCode || '',
    cafe24_product_name: cafe24ProductName || '',
    display: cafe24Display || '',
    selling: cafe24Selling || '',
    display_status: cafe24DisplayStatus || '',
    manufacturer: finalDb.manufacturer || cafe24Value('manufacturer_name', 'manufacturer', 'manufacturer_code') || '',
    supplier: finalDb.supplier || cafe24Value('supplier_name', 'supplier', 'supplier_code') || '',
    brand: finalDb.brand || cafe24Value('brand_name', 'brand', 'brand_code') || '',
    origin: finalDb.origin || cafe24Value('origin', 'made_in', 'made_in_code', 'origin_place_value') || '',
    product_tag: cafe24Value('product_tag', 'search_keywords', 'keyword', 'tags') || '',
    summary_description: finalDb.summary_description || cafe24Value('summary_description', 'simple_description', 'product_summary') || '',
    usage_place: usagePlace,
    recommended_use: usagePurpose,
    usage_purpose: usagePurpose,
    target_customer: targetCustomer,
    season_event: seasonEvent,
    image_keywords: imageKeywords,
    image_work_hint: imageWorkHint,
    detail_page_hint: detailPageHint,
    cafe24_candidates: cloneData(factory.product.cafe24Candidates || []),
    db_match: dbMatch,
    db_product: dbMatch,
    db_candidates: cloneData(dbCandidates),
    factory_imported_at: syncedAt,
    factory_import_source: '조립공장 최신값',
    factory_sync_status: {
      synced_at: syncedAt,
      source: '조립공장 최신값',
      product_name: productName,
      db_jcode: dbMatch?.jcode || confirmedDb?.jcode || confirmedDb?.code || '',
      cafe24_product_no: cafe24ProductNo || '',
      cafe24_product_code: cafe24ProductCode || '',
      cafe24_product_name: cafe24ProductName || '',
      cafe24_field_count: Object.keys(cafe24Raw || {}).length,
      cafe24_fields: Object.keys(importedManual || {}).filter(key => key.startsWith('cafe24_') || ['sale_price', 'retail_price', 'supply_price', 'display_status', 'manufacturer', 'supplier', 'brand', 'origin'].includes(key)),
      fields: Object.keys(importedManual || {}),
      summary: [
        productName ? `상품명 ${productName}` : '',
        optionValues.length ? `옵션 ${optionValues.length}개` : '',
        dims.summary ? `규격 ${dims.summary}` : '',
        cafe24ProductNo ? `Cafe24 #${cafe24ProductNo}` : '',
      ].filter(Boolean).join(' · '),
    },
    factory_import_summary: [
      productName ? `상품명 ${productName}` : '',
      optionValues.length ? `옵션 ${optionValues.length}개` : '',
      dims.summary ? `규격 ${dims.summary}` : '',
      cafe24ProductNo ? `Cafe24 #${cafe24ProductNo}` : '',
    ].filter(Boolean).join(' · '),
  };
  Object.keys(nextAnalysis).forEach(key => {
    if (nextAnalysis[key] === null || nextAnalysis[key] === undefined || nextAnalysis[key] === '') delete nextAnalysis[key];
    if (Array.isArray(nextAnalysis[key]) && !nextAnalysis[key].length) delete nextAnalysis[key];
  });
  state.analysis = attachCurrentAnalysisImageIdentity(nextAnalysis);
  state.analysisTimestamp = new Date().toISOString();
  state.dbMatchBusy = false;
  state.dbMatchError = '';
  state.dbMatchCandidates = cloneData(dbCandidates);
  state.dbMatchLastQuery = dbMatch?.match_query || productName || '';
  state.dbMatchSelectionOpen = false;
  if (dbMatch) applySinhwaDbMatch(dbMatch);
  if (factory.product.cafe24Candidates?.length) {
    state.analysis.cafe24_candidates = cloneData(factory.product.cafe24Candidates);
  }
  state.analysis.factory_imported_at = state.analysis.factory_imported_at || syncedAt;
  state.analysis.factory_import_source = '조립공장 최신값';
  state.analysis.factory_sync_status = state.analysis.factory_sync_status || nextAnalysis.factory_sync_status;
  state.lastDbSyncStatus = cloneData(state.analysis.factory_sync_status);
  factory.product.lastSyncedAt = syncedAt;
  factory.product.lastDbSyncStatus = cloneData(state.analysis.factory_sync_status);
  factory.product.analysis = cloneData(state.analysis);
  factorySetStageStatus('db', dbMatch || cafe24Target || Object.keys(finalDb).length ? 'done' : factory.stages.db?.status || 'idle', 'AI 분석 화면에 최신 DB/Cafe24/옵션값을 반영했습니다.', factory);
  factoryLog('AI 분석 화면으로 조립공장 최신값을 보냈습니다.', 'ok', factory);
  setUiNotice(`조립공장 최신값을 AI 분석 화면에 반영했습니다.${optionValues.length ? ` 옵션 ${optionValues.length}개 포함.` : ''}`, 'ok');
  return true;
}

function factorySyncFromCurrentState(options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/runtime:sync-current-state',
      { ...options, owner: 'factory-assets', render: false },
      draft => factorySyncFromCurrentState({ ...options, factory: draft }),
    );
  }
  const factory = options.factory;
  if (state.productName && !factory.product.productName) factory.product.productName = state.productName;
  if (state.imageBase64 && !factory.product.imageBase64) {
    factory.product.imageBase64 = state.imageBase64;
    factory.product.imageMime = state.imageMime || 'image/png';
    factory.product.imagePreview = state.imagePreview || `data:${factory.product.imageMime};base64,${state.imageBase64}`;
  }
  if (state.analysis) factory.product.analysis = cloneData(state.analysis);
  const analysis = state.analysis || {};
  const sourceDbCandidates = state.dbMatchCandidates || analysis.db_candidates || [];
  const sourceCafe24Candidates = analysis.cafe24_candidates || [];
  if (Array.isArray(sourceDbCandidates) && sourceDbCandidates.length) {
    factory.product.dbCandidates = cloneData(sourceDbCandidates);
  }
  if (Array.isArray(sourceCafe24Candidates) && sourceCafe24Candidates.length) {
    factory.product.cafe24Candidates = cloneData(sourceCafe24Candidates);
  }
  const dbGuess = analysis.db_match || analysis.sinhwa_match || analysis.matched_product || analysis.db_product || null;
  if (dbGuess && !factory.product.confirmedDb) factory.product.confirmedDb = cloneData(dbGuess);
  if (state.compPage?.analysisResult) {
    factory.product.competitors = cloneData(state.compPage.analysisResult.competitors || state.compPage.analysisResult.similar_products || state.compPage.analysisResult.products || []);
    factory.product.competitorSource = '경쟁사 분석 탭';
  } else if (state.competitorData?.similar_products) {
    factory.product.competitors = cloneData(state.competitorData.similar_products);
    factory.product.competitorSource = '기존 경쟁사 분석';
  }
  (state.optionSorter?.optionResults || []).forEach(result => {
    if (!result.image || factory.assets.some(asset => asset.sourceMap?.optionResultId === result.id)) return;
    factoryRegisterAsset('options', result.image, {
      title: result.optionName || '옵션표 결과',
      prompt: result.prompt || result.promptText || '',
      metadata: {
        source: '옵션 분류기',
        tonePresetName: result.tonePresetName,
        modelLabel: result.modelLabel,
        batchLabel: result.batchLabel,
      },
      sourceMap: { optionResultId: result.id },
      factory,
    });
  });
  (state.cuts?.prompts || []).forEach(cut => {
    if (!cut.result || factory.assets.some(asset => asset.sourceMap?.cutId === cut.id)) return;
    factoryRegisterAsset('cuts', cut.result, {
      title: cut.label || '이미지컷',
      prompt: cut.prompt || '',
      metadata: { source: '이미지컷 생성', modelLabel: getCurrentImageRunInfo().modelLabel },
      sourceMap: { cutId: cut.id },
      factory,
    });
  });
  Object.entries(state.sectionImages || {}).forEach(([sectionId, image]) => {
    if (!image || factory.assets.some(asset => asset.sourceMap?.sectionId === sectionId)) return;
    const section = SECTIONS.find(s => s.id === sectionId);
    factoryRegisterAsset('detail', image, {
      title: section ? `${section.n}. ${section.name}` : `상세 섹션 ${sectionId}`,
      metadata: { source: '상세페이지 섹션 이미지' },
      sourceMap: { sectionId },
      factory,
    });
  });
  factoryUpdateFinalDbFromFields(factory);
  if (options.log !== false) factoryLog('현재 작업의 이미지/분석/옵션/컷/상세 결과를 조립공장으로 가져왔습니다.', 'ok', factory);
  return true;
}

function factoryAddSearchTerm(list, value) {
  const cleaned = cleanDbSearchTerm(value);
  const key = normalizeTextForScore(cleaned);
  if (!cleaned || key.length < 2 || list.some(item => normalizeTextForScore(item) === key)) return;
  list.push(cleaned);
}

function factoryAddSearchTermVariants(list, value) {
  const cleaned = cleanDbSearchTerm(value);
  if (!cleaned) return;
  const compact = cleaned.replace(/\s+/g, '');
  const spacedRules = [
    ['크리스탈보자기', '크리스탈 보자기'],
    ['색동보자기', '색동 보자기'],
    ['미니보자기', '미니 보자기'],
    ['선물보자기', '선물 보자기'],
  ];
  spacedRules.forEach(([from, to]) => {
    if (compact.includes(from)) factoryAddSearchTerm(list, cleaned.replace(from, to));
  });
  if (/크리스탈/.test(compact) && /보자기/.test(compact)) {
    factoryAddSearchTerm(list, '크리스탈 보자기');
    factoryAddSearchTerm(list, '크리스탈');
    factoryAddSearchTerm(list, '보자기');
  }
  ['보자기', '주머니', '파우치', '수저집', '지갑', '필통', '선물포장'].forEach(keyword => {
    if (compact.includes(keyword)) factoryAddSearchTerm(list, keyword);
  });
}

function factoryCandidateSearchTerms(factory = factoryRuntimeReadFactory()) {
  const terms = [];
  const manualName = cleanDbSearchTerm(factory.product.productName || '');
  const stateName = cleanDbSearchTerm(state.productName || '');
  const hint = cleanDbSearchTerm(factory.product.naturalHint || '');
  const primaryName = manualName || stateName;
  factoryAddSearchTerm(terms, primaryName);
  if (primaryName) {
    factoryAddSearchTerm(terms, primaryName.replace(/\s+/g, ''));
    factoryAddSearchTerm(terms, primaryName.replace(/\([^)]*\)/g, '').trim());
    factoryAddSearchTermVariants(terms, primaryName);
  }
  if (hint && primaryName) factoryAddSearchTerm(terms, `${primaryName} ${hint}`);
  if (hint) factoryAddSearchTermVariants(terms, hint);
  if (!primaryName && hint) factoryAddSearchTerm(terms, hint);
  return terms.slice(0, 10);
}

function factoryDedupeSinhwaCandidates(candidates = []) {
  const seen = new Set();
  const out = [];
  candidates.forEach(candidate => {
    const key = factorySinhwaCandidateKey(candidate) || JSON.stringify(candidate).slice(0, 80);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  });
  return out;
}

function factoryDedupeCafe24Candidates(candidates = []) {
  const seen = new Set();
  const out = [];
  candidates.forEach(candidate => {
    const key = factoryCafe24CandidateKey(candidate) || cafe24ProductKey(candidate) || JSON.stringify(candidate).slice(0, 80);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  });
  return out;
}

function factorySlimReviewText(value, max = 360) {
  const text = String(value ?? '').trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function factorySlimCafe24ReviewRaw(raw = {}) {
  if (!raw || typeof raw !== 'object') return {};
  const keep = {};
  [
    'mall_id',
    'product_no',
    'product_code',
    'product_name',
    'eng_product_name',
    'price',
    'retail_price',
    'supply_price',
    'display',
    'selling',
    'product_condition',
    'summary_description',
    'simple_description',
    'detail_image',
    'list_image',
    'small_image',
    'tiny_image',
    'image_url',
    'main_image',
    'category_no',
    'manufacturer_name',
    'supplier_name',
  ].forEach(key => {
    if (raw[key] === undefined || raw[key] === null) return;
    keep[key] = typeof raw[key] === 'string' ? factorySlimReviewText(raw[key], 500) : raw[key];
  });
  ['images', 'additional_images'].forEach(key => {
    if (!Array.isArray(raw[key])) return;
    keep[key] = raw[key].slice(0, 6).map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return item;
      return {
        image_url: item.image_url || item.url || item.src || item.path || '',
        detail_image: item.detail_image || '',
        list_image: item.list_image || '',
        tiny_image: item.tiny_image || '',
      };
    });
  });
  keep.__runtimeSlim = true;
  return keep;
}

function factorySlimCafe24ReviewCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const source = typeof stripFactoryCandidateRawJson === 'function'
    ? stripFactoryCandidateRawJson(candidate)
    : { ...candidate };
  const raw = parseCafe24Raw(source) || source.raw || source.rawProduct || {};
  const slimRaw = factorySlimCafe24ReviewRaw(raw);
  const out = {
    ...source,
    product_no: source.product_no || raw.product_no || '',
    product_code: source.product_code || raw.product_code || '',
    product_name: factorySlimReviewText(source.product_name || raw.product_name || '', 180),
    price: source.price ?? raw.price ?? '',
    retail_price: source.retail_price ?? raw.retail_price ?? '',
    supply_price: source.supply_price ?? raw.supply_price ?? '',
    mall_id: source.mall_id || raw.mall_id || '',
    raw: slimRaw,
    rawProduct: slimRaw,
    runtimeSlim: true,
  };
  ['description', 'mobile_description', 'translated_description', 'seo_description'].forEach(key => {
    if (typeof out[key] === 'string' && out[key].length > 500) delete out[key];
  });
  return out;
}

function factorySlimSinhwaReviewCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const out = typeof stripFactoryCandidateRawJson === 'function'
    ? stripFactoryCandidateRawJson(candidate)
    : { ...candidate };
  if (Array.isArray(out.candidates)) out.candidates = out.candidates.slice(0, 3);
  if (Array.isArray(out.images)) out.images = out.images.slice(0, 5);
  out.product_name = factorySlimReviewText(out.product_name || out.jname || '', 180);
  return out;
}

function factorySlimReviewCandidateList(candidates = [], type = 'cafe24', limit = 24) {
  const reviewProductScopeKey = factoryCandidateReviewScopeKey();
  const reviewProductIdentityKey = factoryCandidateReviewIdentityKey();
  const reviewProductName = factoryCandidateReviewProductName();
  const list = type === 'sinhwa'
    ? factoryDedupeSinhwaCandidates(candidates).map(factorySlimSinhwaReviewCandidate)
    : factoryDedupeCafe24Candidates(candidates).map(factorySlimCafe24ReviewCandidate);
  return list.slice(0, limit).map(candidate => candidate && typeof candidate === 'object'
    ? {
      ...candidate,
      reviewProductScopeKey,
      reviewProductIdentityKey,
      reviewProductName,
      reviewCollectedAt: candidate.reviewCollectedAt || Date.now(),
    }
    : candidate
  );
}

function factoryCandidateReviewScope(factory = factoryRuntimeReadFactory()) {
  const workspaceId = typeof factoryCurrentWorkspaceId === 'function'
    ? factoryCurrentWorkspaceId(factory)
    : String(state.currentProjectId || factory?.workspace?.id || factory?.currentProjectId || '').trim();
  const name = factoryCaptureLockedProductName(factory) || factory?.product?.productName || state.productName || '';
  const productKey = typeof factoryCurrentProductKey === 'function'
    ? factoryCurrentProductKey(factory)
    : (typeof factoryNormalizeIdentityText === 'function'
      ? factoryNormalizeIdentityText(name)
      : String(name || '').replace(/\s+/g, '').toLowerCase());
  return { workspaceId: String(workspaceId || '').trim(), productKey: String(productKey || '').trim() };
}

function factoryCandidateReviewScopeKey(factory = factoryRuntimeReadFactory()) {
  const scope = factoryCandidateReviewScope(factory);
  if (!scope.workspaceId || !scope.productKey) return '';
  return `${scope.workspaceId}::${scope.productKey}::candidate-review`;
}

function factoryCandidateReviewScopeKeyFromCandidate(candidate = {}) {
  const savedScopeKey = String(candidate?.reviewProductScopeKey || '').trim();
  if (savedScopeKey) return savedScopeKey;
  const strictKey = String(candidate?.reviewProductIdentityKey || '').trim();
  const parts = strictKey.split('::');
  if (parts.length === 5 && parts[4] === 'candidate-review' && parts[0] && parts[2]) {
    return `${parts[0].trim()}::${parts[2].trim()}::candidate-review`;
  }
  return '';
}

function factoryCandidateReviewCanApply(candidate = {}, factory = factoryRuntimeReadFactory()) {
  const candidateIdentityKey = String(candidate?.reviewProductIdentityKey || '').trim();
  const candidateScopeKey = factoryCandidateReviewScopeKeyFromCandidate(candidate);
  const currentScopeKey = factoryCandidateReviewScopeKey(factory);
  if (candidateScopeKey && currentScopeKey) return candidateScopeKey === currentScopeKey;
  const currentIdentityKey = factoryCandidateReviewIdentityKey(factory);
  if (candidateIdentityKey && currentIdentityKey) return candidateIdentityKey === currentIdentityKey;
  const scope = factoryCandidateReviewScope(factory);
  const legacyProductKey = typeof factoryNormalizeIdentityText === 'function'
    ? factoryNormalizeIdentityText(candidate?.reviewProductName || candidate?.reviewProductIdentityKey || candidate?.match_query || '')
    : String(candidate?.reviewProductName || candidate?.reviewProductIdentityKey || candidate?.match_query || '').replace(/\s+/g, '').toLowerCase();
  return !!scope.workspaceId && !!scope.productKey && !!legacyProductKey
    && (typeof factoryIdentityKeysCompatible === 'function'
      ? factoryIdentityKeysCompatible(legacyProductKey, scope.productKey)
      : legacyProductKey === scope.productKey);
}

function factoryCandidateReviewIdentityKey(factory = factoryRuntimeReadFactory()) {
  const scope = factoryCandidateReviewScope(factory);
  const currentRunId = typeof factoryCurrentWorkflowRunId === 'function'
    ? factoryCurrentWorkflowRunId(factory)
    : String(factory?.product?.currentRunId || factory?.automation?.currentRunId || factory?.goalRun?.currentRunId || '').trim();
  const inputImageFingerprint = typeof factoryCurrentInputImageFingerprint === 'function'
    ? factoryCurrentInputImageFingerprint(factory)
    : String(factory?.product?.inputImageFingerprint || '').trim();
  if (!scope.workspaceId || !scope.productKey || !currentRunId || !inputImageFingerprint) return '';
  return `${scope.workspaceId}::${currentRunId}::${scope.productKey}::${inputImageFingerprint}::candidate-review`;
}

function factoryCandidateReviewProductName(factory = factoryRuntimeReadFactory()) {
  return String(factoryCaptureLockedProductName(factory) || factory?.product?.productName || state.productName || '').trim();
}

function factoryBlockCandidateReviewSelection(factory, sourceLabel = '후보', options = {}) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const message = `${sourceLabel} 후보 선택을 중단했습니다: 표시된 후보의 제품 기준이 현재 작업파일과 달라 후보를 다시 수집해주세요.`;
  factory.product.candidateReviewStatus = message;
  if (typeof factorySetStageStatus === 'function') factorySetStageStatus('db', 'review', message, factory);
  factoryLog(message, 'warn', factory);
  if (!options.factory && typeof saveLastWorkNow === 'function') saveLastWorkNow();
  if (options.render !== false && typeof render === 'function') render();
  return false;
}

function factoryCaptureCandidateReviewSelection(factory = factoryRuntimeReadFactory()) {
  return {
    identityKey: factoryCandidateReviewIdentityKey(factory),
    selectedDbCandidateKey: factory.product.selectedDbCandidateKey || '',
    selectedCafe24CandidateKey: factory.product.selectedCafe24CandidateKey || '',
    dbCandidateResolution: factory.product.dbCandidateResolution || '',
    cafe24CandidateResolution: factory.product.cafe24CandidateResolution || '',
    confirmedCafe24ProductKey: factory.product.confirmedCafe24ProductKey || '',
    cafe24DraftProductKey: factory.product.cafe24DraftProductKey || '',
    confirmedDb: cloneData(factory.product.confirmedDb || null),
    dbCandidates: cloneData(factory.product.dbCandidates || []),
    cafe24Candidates: cloneData(factory.product.cafe24Candidates || []),
    dbLocked: !!factory.product.dbLocked,
  };
}

function factoryRestoreCandidateReviewSelection(factory, snapshot = null, options = {}) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  if (!snapshot || (!options.force && snapshot.identityKey !== factoryCandidateReviewIdentityKey(factory))) return false;
  let changed = false;
  if (snapshot.selectedDbCandidateKey) {
    factory.product.selectedDbCandidateKey = snapshot.selectedDbCandidateKey;
    factory.product.confirmedDb = snapshot.confirmedDb || factory.product.confirmedDb || null;
    factory.product.dbLocked = snapshot.dbLocked || !!factory.product.confirmedDb;
    factory.product.dbCandidates = factoryDedupeSinhwaCandidates([
      ...(Array.isArray(snapshot.dbCandidates) ? snapshot.dbCandidates : []),
      ...(Array.isArray(factory.product.dbCandidates) ? factory.product.dbCandidates : []),
    ]).slice(0, 12);
    changed = true;
  }
  if (['selected', 'none'].includes(snapshot.dbCandidateResolution)) {
    factory.product.dbCandidateResolution = snapshot.dbCandidateResolution;
    changed = true;
  }
  if (snapshot.selectedCafe24CandidateKey) {
    factory.product.selectedCafe24CandidateKey = snapshot.selectedCafe24CandidateKey;
    factory.product.confirmedCafe24ProductKey = snapshot.confirmedCafe24ProductKey || factory.product.confirmedCafe24ProductKey || '';
    factory.product.cafe24DraftProductKey = snapshot.cafe24DraftProductKey || factory.product.cafe24DraftProductKey || snapshot.selectedCafe24CandidateKey;
    factory.product.cafe24Candidates = factoryDedupeCafe24Candidates([
      ...(Array.isArray(snapshot.cafe24Candidates) ? snapshot.cafe24Candidates : []),
      ...(Array.isArray(factory.product.cafe24Candidates) ? factory.product.cafe24Candidates : []),
    ]).slice(0, 24);
    changed = true;
  }
  if (['selected', 'none'].includes(snapshot.cafe24CandidateResolution)) {
    factory.product.cafe24CandidateResolution = snapshot.cafe24CandidateResolution;
    changed = true;
  }
  return changed;
}

function factoryCafe24CandidateCompareKeys(candidate) {
  if (!candidate || typeof candidate !== 'object') return [];
  const raw = parseCafe24Raw(candidate);
  return uniqueApiKeys([
    factoryCafe24CandidateKey(candidate),
    cafe24ProductKey(candidate),
    candidate.product_no || raw.product_no ? `no:${candidate.product_no || raw.product_no}` : '',
    candidate.product_code || raw.product_code ? `code:${candidate.product_code || raw.product_code}` : '',
    factoryCandidateName(candidate, 'cafe24') ? `name:${normalizeTextForScore(factoryCandidateName(candidate, 'cafe24'))}` : '',
  ].map(value => String(value || '').trim()).filter(Boolean));
}

function factoryCafe24CandidateKeySet(candidates = []) {
  const keys = new Set();
  candidates.forEach(candidate => factoryCafe24CandidateCompareKeys(candidate).forEach(key => keys.add(key)));
  return keys;
}

function factoryFilterNewCafe24Candidates(incoming = [], existing = []) {
  const seen = factoryCafe24CandidateKeySet(existing);
  const out = [];
  factoryDedupeCafe24Candidates(incoming).forEach(candidate => {
    const keys = factoryCafe24CandidateCompareKeys(candidate);
    if (keys.some(key => seen.has(key))) return;
    keys.forEach(key => seen.add(key));
    out.push(candidate);
  });
  return out;
}

async function factorySearchSinhwaReviewCandidates(terms = [], limit = 20) {
  if (!terms.length) return [];
  const termInfo = { terms, manualTerms: terms, nameTerms: terms, clueTerms: [] };
  const found = await findSinhwaDbCandidateMatches(terms, {
    termInfo,
    imageWeighted: false,
    collectMultiple: true,
    apiHubOnly: true,
  });
  const normalized = factoryDedupeSinhwaCandidates(found.ranked.map(item =>
    normalizeSinhwaDbCandidate(item.product, found.usedQuery, item.score, item.index)
  )).slice(0, limit);
  const hydrated = [];
  for (const candidate of normalized.slice(0, Math.min(limit, 8))) {
    if (factoryCandidateImageUrl(candidate, 'sinhwa')) {
      hydrated.push(candidate);
      continue;
    }
    try {
      const detail = await fetchSinhwaProductDetail(candidate.jcode || candidate.id, { apiHubOnly: true });
      const match = normalizeSinhwaDbMatch(candidate, detail, candidate.match_query || found.usedQuery || terms[0], normalized);
      hydrated.push({
        ...candidate,
        ...match,
        score: candidate.score,
        match_score: candidate.match_score || candidate.score || match.match_score,
        image: match.images?.[0]?.thumb_url || match.images?.[0]?.url || candidate.image || '',
      });
    } catch(e) {
      hydrated.push(candidate);
    }
  }
  return factorySlimReviewCandidateList([...hydrated, ...normalized.slice(hydrated.length)], 'sinhwa', limit);
}

async function factorySearchCafe24DirectReviewCandidates(terms = [], limit = 24, termInfo = null) {
  const cleanTerms = terms.map(cleanDbSearchTerm).filter(Boolean);
  const fallback = [];
  const info = termInfo || {
    terms: cleanTerms,
    manualTerms: cleanTerms,
    nameTerms: cleanTerms,
    clueTerms: [],
    imageOnlyMode: false,
  };
  for (const term of cleanTerms.slice(0, 3)) {
    const rows = await fetchCafe24ProductsByQuery(term, Math.max(36, Math.min(72, limit * 2)));
    rows.forEach((row, index) => {
      const candidate = normalizeCafe24ProductCandidate(row, term, 0, index);
      const localScore = scoreCafe24ProductCandidate(candidate, info, index);
      const directRecallScore = Math.max(20, 78 - index);
      candidate.match_score = Math.max(localScore, directRecallScore);
      candidate.local_match_score = candidate.match_score;
      candidate.direct_recall = true;
      candidate.rank_warning = 'Cafe24 직접 검색 결과를 후보로 보존했습니다.';
      fallback.push(candidate);
    });
  }
  return factorySlimReviewCandidateList(factoryDedupeCafe24Candidates(fallback)
    .sort((a, b) => (factoryCandidateScore(b, 'cafe24') || 0) - (factoryCandidateScore(a, 'cafe24') || 0))
    .slice(0, limit), 'cafe24', limit);
}

async function factorySearchCafe24ReviewCandidates(terms = [], limit = 24, options = {}) {
  if (!terms.length) return [];
  const cleanTerms = terms.map(cleanDbSearchTerm).filter(Boolean);
  const settings = getAnalysisMatchSettings();
  const termInfo = {
    terms: cleanTerms,
    manualTerms: cleanTerms,
    nameTerms: cleanTerms,
    clueTerms: [],
    imageOnlyMode: false,
    candidateLimit: Math.max(limit * 2, 48),
    settings: { ...(settings || {}), naturalText: factoryRuntimeReadFactory().product?.naturalHint || '' },
  };
  let all = [];
  let meta = null;
  try {
    const found = await findCafe24CandidateMatches(termInfo);
    meta = found;
    all = found.ranked.map(item => {
      const candidate = normalizeCafe24ProductCandidate(item.product, item.query || found.usedQuery, item.score, item.index);
      candidate.match_queries = item.queries || [];
      candidate.local_match_score = item.score;
      candidate.match_score = item.score;
      return candidate;
    });
  } catch(e) {
    all = await factorySearchCafe24DirectReviewCandidates(cleanTerms, Math.max(limit, 24), termInfo);
    if (all.length) {
      factoryLog(`Cafe24 스냅샷 매칭 실패 후 직접 검색 후보 ${all.length}건을 표시합니다: ${e.message || e}`, 'warn');
    }
    if (!all.length) throw e;
  }
  all = factoryDedupeCafe24Candidates(all)
    .sort((a, b) => (factoryCandidateScore(b, 'cafe24') || 0) - (factoryCandidateScore(a, 'cafe24') || 0))
    .slice(0, Math.max(limit, 24));
  if (!all.length) {
    all = await factorySearchCafe24DirectReviewCandidates(cleanTerms, Math.max(limit, 24), termInfo);
    if (all.length) factoryLog(`Cafe24 직접 검색 후보 ${all.length}건을 복구 표시합니다.`, 'warn');
  }
  const rankEngine = normalizeAnalysisAiEngine(settings.cafe24RankEngine || 'local', true);
  if (options.blockingRerank && rankEngine !== 'local' && all.length) {
    try {
      const imageLimit = getCafe24CandidateImageAttachLimit(rankEngine);
      const imageCandidates = selectCafe24CandidatesForImagePayloads(all, imageLimit, termInfo);
      const imageFetch = await fetchCafe24CandidateImagePayloads(imageCandidates, imageLimit);
      const ranked = await rerankCafe24CandidatesWithGpt(termInfo, all, { candidateImages: imageFetch.payloads });
      all = factoryDedupeCafe24Candidates(ranked.candidates || all)
        .sort((a, b) => (factoryCandidateScore(b, 'cafe24') || 0) - (factoryCandidateScore(a, 'cafe24') || 0));
      const label = ranked.engineLabel || getAnalysisEngineRunInfo(rankEngine, settings).providerLabel || 'LLM';
      all.forEach(candidate => {
        candidate.rank_engine_label = label;
        candidate.rank_warning = ranked.warning || '';
      });
    } catch(e) {
      factoryLog(`Cafe24 후보 LLM/이미지 재정렬 실패: ${e.message || e}. 로컬 점수 후보를 유지합니다.`, 'error');
    }
  }
  all.forEach(candidate => {
    candidate.candidate_pool_count = meta?.candidatePoolCount || all.length;
    candidate.snapshot_count = meta?.snapshotCount || 0;
  });
  return factorySlimReviewCandidateList(all, 'cafe24', limit);
}

function factoryCafe24RerankKey(terms = [], candidates = []) {
  return [
    terms.map(cleanDbSearchTerm).filter(Boolean).join('|'),
    candidates.map(candidate => factoryCafe24CandidateKey(candidate)).filter(Boolean).join('|').slice(0, 400),
  ].join('::');
}

function factoryStartCafe24CandidateRerank(terms = [], candidates = [], options = {}) {
  const settings = getAnalysisMatchSettings();
  const rankEngine = normalizeAnalysisAiEngine(settings.cafe24RankEngine || 'local', true);
  if (rankEngine === 'local' || !Array.isArray(candidates) || !candidates.length) return;
  const factory = options.factory;
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const key = factoryCafe24RerankKey(terms, candidates);
  if (factory.product.cafe24RerankRunning && factory.product.cafe24RerankKey === key) return;
  const rankInfo = getAnalysisEngineRunInfo(rankEngine, settings);
  const label = rankInfo.providerLabel || 'LLM';
  factory.product.cafe24RerankRunning = true;
  factory.product.cafe24RerankKey = key;
  factory.product.cafe24ApiStatus = `Cafe24 후보 ${candidates.length}건 표시 완료 · ${label} 이미지 재점수 진행 중입니다.`;
  setTimeout(() => {
    const snapshot = factoryRuntimeReadFactory();
    if (snapshot.product.cafe24RerankKey !== key) return;
    const operationToken = factoryCafe24CaptureOperationToken();
    const transaction = factoryCafe24RunOwnedDraftMutation(
      'factory/cafe24:rerank-candidates',
      { operationToken },
      async current => {
        try {
          const termInfo = {
            terms,
            manualTerms: terms,
            nameTerms: terms,
            clueTerms: [],
            imageOnlyMode: false,
            candidateLimit: Math.max(candidates.length, 24),
            settings: { ...(settings || {}), naturalText: current.product?.naturalHint || '' },
          };
          const imageLimit = getCafe24CandidateImageAttachLimit(rankEngine);
          const imageCandidates = selectCafe24CandidatesForImagePayloads(candidates, imageLimit, termInfo);
          const imageFetch = await fetchCafe24CandidateImagePayloads(imageCandidates, imageLimit);
          const ranked = await rerankCafe24CandidatesWithGpt(termInfo, candidates, { candidateImages: imageFetch.payloads });
          if (current.product.cafe24RerankKey !== key) return;
          const hasSelectedCafe24 = !!current.product.selectedCafe24CandidateKey;
          const keepLimit = Math.max(24, candidates.length);
          const next = factorySlimReviewCandidateList(factoryDedupeCafe24Candidates(ranked.candidates || candidates)
            .sort((a, b) => (factoryCandidateScore(b, 'cafe24') || 0) - (factoryCandidateScore(a, 'cafe24') || 0))
            .slice(0, keepLimit), 'cafe24', keepLimit);
          current.product.pendingCafe24Candidates = next;
          current.product.cafe24RerankRunning = false;
          current.product.cafe24ApiStatus = `Cafe24 후보 ${next.length}건 재점수 완료: ${ranked.engineLabel || label}${ranked.warning ? ` · ${ranked.warning}` : ''}`;
          if (!hasSelectedCafe24) {
            current.product.candidateReviewStatus = `Cafe24 후보 재점수 완료: 사진과 점수를 보고 실제 상품을 선택해주세요.`;
          }
          factoryUpdateCandidateReviewStageStatus(current);
          return true;
        } catch(e) {
          if (current.product.cafe24RerankKey !== key) return;
          current.product.cafe24RerankRunning = false;
          current.product.cafe24ApiStatus = `Cafe24 후보는 표시했습니다. 이미지/LLM 재점수만 실패했습니다: ${e.message || e}`;
          if (!current.product.selectedCafe24CandidateKey) factoryLog(current.product.cafe24ApiStatus, 'error', current);
          return false;
        }
      },
    );
    if (transaction && typeof transaction.then === 'function') {
      Promise.resolve(transaction).catch(error => console.error('Cafe24 후보 재점수 결과 반영 실패', error));
    }
  }, 0);
}

function factoryUpdateCandidateReviewStageStatus(factory = factoryRuntimeReadFactory()) {
  const needDb = (factory.product.pendingDbCandidates || []).length && !factory.product.selectedDbCandidateKey && factory.product.dbCandidateResolution !== 'none';
  const needCafe24 = (factory.product.pendingCafe24Candidates || []).length && !factory.product.selectedCafe24CandidateKey && factory.product.cafe24CandidateResolution !== 'none';
  if (needDb || needCafe24) {
    const waiting = [
      needDb ? '신화사DB 후보 선택' : '',
      needCafe24 ? 'Cafe24 후보 선택' : '',
    ].filter(Boolean).join(', ');
    factorySetStageStatus('db', 'review', `${waiting} 대기 중입니다.`, factory);
    return;
  }
  const dbCount = (factory.product.dbCandidates || []).length;
  const cafe24Count = (factory.product.cafe24Candidates || []).length;
  const dbState = factory.product.dbCandidateResolution === 'none' ? '신제품' : `${dbCount}건`;
  const cafe24State = factory.product.cafe24CandidateResolution === 'none' ? '신제품' : `${cafe24Count}건`;
  factorySetStageStatus('db', 'done', `신화사DB ${dbState}, Cafe24 ${cafe24State} 후보 검토 완료`, factory);
}

function factoryResetDbContextForNewCollection(factory, options = {}) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const lockedProductName = factoryCaptureLockedProductName(factory);
  const resetDb = options.resetDb !== false;
  const resetCafe24 = options.resetCafe24 !== false;
  if (resetDb) {
    factory.product.confirmedDb = null;
    factory.product.selectedDbCandidateKey = '';
    factory.product.dbLocked = false;
    factory.product.pendingDbCandidates = [];
    factory.product.dbCandidates = [];
    factory.product.dbCandidateResolution = '';
  }
  if (resetCafe24) {
    factory.product.selectedCafe24CandidateKey = '';
    factory.product.confirmedCafe24ProductKey = '';
    factory.product.cafe24DraftProductKey = '';
    factory.product.pendingCafe24Candidates = [];
    factory.product.cafe24Candidates = [];
    factory.product.cafe24CandidateResolution = '';
    if (typeof factoryResetCafe24DraftsForProduct === 'function') {
      factoryResetCafe24DraftsForProduct(factory, '');
    }
  }
  factory.product.finalDb = {};
  factoryRestoreLockedProductName(factory, lockedProductName);
  if (resetDb && factory.product.dbFieldSettings && typeof factory.product.dbFieldSettings === 'object') {
    Object.entries(factory.product.dbFieldSettings).forEach(([fieldId, setting]) => {
      if (!setting || typeof setting !== 'object') return;
      if (fieldId === 'product_name') return;
      setting.manualValue = '';
      setting.manualTouched = false;
    });
  }
  if (resetDb && state.productInfoManualValues && typeof state.productInfoManualValues === 'object') {
    state.productInfoManualValues = lockedProductName ? { product_name: lockedProductName } : {};
  }
  factory.product.dbContextRefreshedAt = new Date().toISOString();
}

const FACTORY_PRODUCT_SCOPED_DB_FIELD_IDS = [
  'sale_price',
  'purchase_price',
  'stock',
  'quantity',
  'size',
  'dimensions',
  'width_mm',
  'depth_mm',
  'height_mm',
  'weight',
  'product_weight',
  'product_weight_g',
  'material',
  'usage',
  'use_case',
  'purpose',
  'option_name',
  'option_values',
  'option_count',
  'has_option',
  'option_type',
  'option_list_type',
  'select_one_by_option',
];

function factoryCaptureLockedProductName(factory = factoryRuntimeReadFactory()) {
  const product = factory?.product || {};
  const finalRegistration = product.cafe24FinalRegistration || {};
  return [
    finalRegistration.productName,
    finalRegistration.product_name,
    product.userProductName,
    product.productName,
    state?.productName,
    product.finalDb?.product_name,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function factoryRestoreLockedProductName(factory, productName = '') {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const name = String(productName || '').trim();
  if (!name) return false;
  if (!factory.product || typeof factory.product !== 'object') factory.product = {};
  const product = factory.product;
  product.userProductName = name;
  product.productName = name;
  if (!product.cafe24FinalRegistration || typeof product.cafe24FinalRegistration !== 'object') {
    product.cafe24FinalRegistration = {};
  }
  product.cafe24FinalRegistration.productName = name;
  product.cafe24FinalRegistration.product_name = name;
  if (!product.finalDb || typeof product.finalDb !== 'object') product.finalDb = {};
  product.finalDb.product_name = name;
  if (typeof state !== 'undefined') state.productName = name;
  if (typeof factoryDbFieldSetting === 'function') {
    const setting = factoryDbFieldSetting(factory, 'product_name', true);
    setting.enabled = true;
    setting.manualValue = name;
    setting.manualTouched = true;
    setting.autoFilled = false;
    setting.autoSource = '사용자 입력 상품명 잠금';
  } else {
    if (!product.dbFieldSettings || typeof product.dbFieldSettings !== 'object') product.dbFieldSettings = {};
    product.dbFieldSettings.product_name = {
      ...(product.dbFieldSettings.product_name || {}),
      enabled: true,
      manualValue: name,
      manualTouched: true,
      autoFilled: false,
      autoSource: '사용자 입력 상품명 잠금',
    };
  }
  if (state.productInfoManualValues && typeof state.productInfoManualValues === 'object') {
    state.productInfoManualValues.product_name = name;
  }
  return true;
}

function factoryClearProductScopedDbManualFields(factory, reason = 'product-change', options = {}) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const lockedProductName = factoryCaptureLockedProductName(factory);
  const product = factory.product || {};
  const keepDb = options.preserveDb === true;
  const keepCafe24 = options.preserveCafe24 === true;
  const savedDb = keepDb ? {
    confirmedDb: cloneData(product.confirmedDb || null),
    dbCandidates: cloneData(product.dbCandidates || []),
    pendingDbCandidates: cloneData(product.pendingDbCandidates || []),
    selectedDbCandidateKey: product.selectedDbCandidateKey || '',
    dbCandidateResolution: product.dbCandidateResolution || '',
  } : null;
  const savedCafe24 = keepCafe24 ? {
    cafe24Candidates: cloneData(product.cafe24Candidates || []),
    pendingCafe24Candidates: cloneData(product.pendingCafe24Candidates || []),
    selectedCafe24CandidateKey: product.selectedCafe24CandidateKey || '',
    confirmedCafe24ProductKey: product.confirmedCafe24ProductKey || '',
    cafe24CandidateResolution: product.cafe24CandidateResolution || '',
    cafe24DraftProductKey: product.cafe24DraftProductKey || '',
  } : null;
  if (product.dbFieldSettings && typeof product.dbFieldSettings === 'object') {
    FACTORY_PRODUCT_SCOPED_DB_FIELD_IDS.forEach(fieldId => {
      if (product.dbFieldSettings[fieldId]) {
        const { [fieldId]: _removedField, ...remainingFieldSettings } = product.dbFieldSettings;
        product.dbFieldSettings = remainingFieldSettings;
      }
    });
  }
  if (factory.automation?.fieldReview && typeof factory.automation.fieldReview === 'object') {
    FACTORY_PRODUCT_SCOPED_DB_FIELD_IDS.forEach(fieldId => {
      if (factory.automation.fieldReview[fieldId]) {
        const { [fieldId]: _removedReview, ...remainingFieldReview } = factory.automation.fieldReview;
        factory.automation.fieldReview = remainingFieldReview;
      }
    });
  }
  if (state.productInfoManualValues && typeof state.productInfoManualValues === 'object') {
    FACTORY_PRODUCT_SCOPED_DB_FIELD_IDS.forEach(fieldId => {
      if (fieldId in state.productInfoManualValues) delete state.productInfoManualValues[fieldId];
    });
  }
  if (factory.automation && typeof factory.automation === 'object') {
    factory.automation.optionMode = 'pending';
  }
  product.confirmedDb = null;
  product.dbCandidates = [];
  product.cafe24Candidates = [];
  product.pendingDbCandidates = [];
  product.pendingCafe24Candidates = [];
  product.selectedDbCandidateKey = '';
  product.selectedCafe24CandidateKey = '';
  product.confirmedCafe24ProductKey = '';
  product.dbCandidateResolution = '';
  product.cafe24CandidateResolution = '';
  product.cafe24DraftProductKey = '';
  product.finalDb = {};
  if (savedDb) {
    product.confirmedDb = savedDb.confirmedDb;
    product.dbCandidates = savedDb.dbCandidates;
    product.pendingDbCandidates = savedDb.pendingDbCandidates;
    product.selectedDbCandidateKey = savedDb.selectedDbCandidateKey;
    product.dbCandidateResolution = savedDb.dbCandidateResolution;
  }
  if (savedCafe24) {
    product.cafe24Candidates = savedCafe24.cafe24Candidates;
    product.pendingCafe24Candidates = savedCafe24.pendingCafe24Candidates;
    product.selectedCafe24CandidateKey = savedCafe24.selectedCafe24CandidateKey;
    product.confirmedCafe24ProductKey = savedCafe24.confirmedCafe24ProductKey;
    product.cafe24CandidateResolution = savedCafe24.cafe24CandidateResolution;
    product.cafe24DraftProductKey = savedCafe24.cafe24DraftProductKey;
  }
  factoryRestoreLockedProductName(factory, lockedProductName);
  product.dbContextClearReason = reason;
  product.dbContextRefreshedAt = new Date().toISOString();
}

function factoryAutoFieldTextValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const text = value.map(item => factoryAutoFieldTextValue(item)).filter(Boolean).join(', ');
      if (text) return text;
      continue;
    }
    if (value && typeof value === 'object') continue;
    const text = String(value).replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function factoryAutoFieldWithUnit(value, unit = '') {
  const text = factoryAutoFieldTextValue(value);
  if (!text) return '';
  if (!unit || /[a-zA-Z가-힣㎜㎝%]/.test(text)) return text;
  return `${text}${unit}`;
}

function factorySetSelectedProductAutoField(factory, fieldId, value, sourceLabel) {
  const text = factoryAutoFieldTextValue(value);
  if (!fieldId || !text) return false;
  if (!factory.product.dbFieldSettings || typeof factory.product.dbFieldSettings !== 'object') factory.product.dbFieldSettings = {};
  const setting = factoryDbFieldSetting(factory, fieldId, true);
  setting.manualValue = text;
  setting.manualTouched = false;
  setting.enabled = true;
  setting.autoFilled = true;
  setting.autoSource = sourceLabel || 'DB/Cafe24 선택 상품';
  setting.autoFilledAt = Date.now();
  return true;
}

function factoryInferUsageFromSelectedProductText(text) {
  const source = String(text || '');
  const uses = [];
  const add = value => {
    if (value && !uses.includes(value)) uses.push(value);
  };
  if (/선물|기프트|gift/i.test(source)) add('선물 포장');
  if (/답례|웨딩|돌잔치|행사|이벤트/.test(source)) add('답례품 포장');
  if (/보자기|포장/.test(source)) add('상품 포장');
  return uses.slice(0, 3).join(', ');
}

function factoryExtractBojagiSquareSizeFromSelectedText(text, sourceLabel = '선택 상품명') {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/보자기/.test(source)) return null;
  const formatSide = (number, unit = 'cm') => {
    const value = Number(number);
    if (!Number.isFinite(value) || value <= 0) return '';
    const clean = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
    return `${clean}${/mm|㎜|미리/i.test(unit) ? 'mm' : 'cm'}`;
  };
  const paired = source.match(/(\d+(?:\.\d+)?)\s*(cm|㎝|센치|센티|mm|㎜|미리)?\s*[xX*×]\s*(\d+(?:\.\d+)?)\s*(cm|㎝|센치|센티|mm|㎜|미리)?/);
  if (paired) {
    const left = formatSide(paired[1], paired[2] || paired[4] || 'cm');
    const right = formatSide(paired[3], paired[4] || paired[2] || 'cm');
    if (left && right) {
      return {
        size: `가로 ${left} x 세로 ${right}`,
        width: left,
        depth: right,
        source: '보자기 정사각형 사이즈 자동채움',
        notice: `보자기제품은 정사각형/정방형 상품명 기준으로 ${left} x ${right} 사이즈를 자동 반영했습니다.`,
        sourceLabel,
      };
    }
  }
  const single = source.match(/(?:^|[^\d])(\d{2,3}(?:\.\d+)?)\s*(cm|㎝|센치|센티|mm|㎜|미리)(?!\s*[xX*×])/i);
  if (!single) return null;
  const side = formatSide(single[1], single[2] || 'cm');
  if (!side) return null;
  return {
    size: `가로 ${side} x 세로 ${side}`,
    width: side,
    depth: side,
    source: '보자기 정사각형 사이즈 자동채움',
    notice: `보자기제품은 정사각형이므로 선택 상품명에서 찾은 ${side} 기준으로 가로 ${side} x 세로 ${side}로 자동 반영했습니다.`,
    sourceLabel,
  };
}

function factoryAutofillRequiredFieldsFromSelectedProduct(factory, sourceLabel = 'DB/Cafe24 선택 상품') {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const product = factory.product || {};
  const confirmedDb = product.confirmedDb && typeof product.confirmedDb === 'object' ? product.confirmedDb : {};
  const confirmedSpec = confirmedDb.spec && typeof confirmedDb.spec === 'object' ? confirmedDb.spec : {};
  const cafe24Target = typeof factoryCafe24TargetCandidate === 'function'
    ? factoryCafe24TargetCandidate(factory, { allowFallback: false })
    : null;
  const cafe24Raw = cafe24Target && typeof parseCafe24Raw === 'function' ? parseCafe24Raw(cafe24Target) : {};
  const cafe24Value = fieldId => typeof factoryCafe24DbFieldValue === 'function' ? factoryCafe24DbFieldValue(fieldId, factory) : '';
  const selectedText = [
    product.productName,
    state.productName,
    confirmedDb.product_name,
    confirmedDb.jname,
    confirmedDb.name,
    cafe24Target?.product_name,
    cafe24Raw.product_name,
    cafe24Raw.summary_description,
    cafe24Raw.simple_description,
    Array.isArray(cafe24Raw.product_tag) ? cafe24Raw.product_tag.join(' ') : cafe24Raw.product_tag,
  ].map(value => factoryAutoFieldTextValue(value)).filter(Boolean).join(' ');
  const squareHint = typeof factoryBojagiSquareSizeOptionSuggestion === 'function'
    ? factoryBojagiSquareSizeOptionSuggestion(factory)
    : null;
  const textSquareHint = factoryExtractBojagiSquareSizeFromSelectedText(selectedText, cafe24Target ? 'Cafe24 선택 상품명' : '선택 상품명');
  const square = squareHint || textSquareHint;
  const usage = factoryAutoFieldTextValue(
    confirmedDb.usage,
    confirmedDb.use_case,
    confirmedDb.purpose,
    confirmedDb.recommended_use,
    factoryInferUsageFromSelectedProductText(selectedText)
  );
  const fields = {
    product_name: factoryAutoFieldTextValue(
      typeof factoryAuthoritativeProductName === 'function' ? factoryAuthoritativeProductName(factory) : '',
      product.productName,
      state.productName,
      confirmedDb.product_name,
      confirmedDb.jname,
      cafe24Value('product_name'),
      cafe24Target?.product_name,
      cafe24Raw.product_name
    ),
    sale_price: factoryAutoFieldTextValue(cafe24Value('sale_price'), cafe24Target?.sale_price, cafe24Target?.price, cafe24Raw.price, confirmedDb.sale_price, confirmedDb.jop_price),
    purchase_price: factoryAutoFieldTextValue(cafe24Value('purchase_price'), cafe24Target?.supply_price, cafe24Raw.supply_price, confirmedDb.purchase_price, confirmedDb.jip_price),
    stock: factoryAutoFieldTextValue(cafe24Value('stock'), cafe24Raw.quantity, cafe24Raw.stock_quantity, cafe24Raw.stock, confirmedDb.stock_qty, confirmedDb.quantity),
    size: factoryAutoFieldTextValue(square?.size, cafe24Value('size'), confirmedDb.size, confirmedDb.dimensions, confirmedDb.dimension),
    width_mm: factoryAutoFieldTextValue(square?.width, confirmedSpec.width_mm, confirmedDb.width_mm, confirmedDb.width, confirmedDb.product_width),
    depth_mm: factoryAutoFieldTextValue(square?.depth, confirmedSpec.depth_mm, confirmedDb.depth_mm, confirmedDb.depth, confirmedDb.product_depth, confirmedDb.product_height),
    height_mm: factoryAutoFieldTextValue(confirmedSpec.height_mm, confirmedDb.height_mm, confirmedDb.height, confirmedDb.thickness),
    weight: factoryAutoFieldWithUnit(cafe24Value('weight') || cafe24Raw.product_weight || confirmedDb.product_weight_g || confirmedDb.weight_g || confirmedDb.product_weight, 'g'),
    material: factoryAutoFieldTextValue(cafe24Value('material'), cafe24Target?.material, cafe24Raw.product_material, confirmedDb.material_summary, confirmedDb.material, confirmedDb.fabric),
    usage,
    option_name: factoryAutoFieldTextValue(cafe24Value('option_name'), confirmedDb.option_name),
    option_values: factoryAutoFieldTextValue(cafe24Value('option_values'), confirmedDb.option_values, confirmedDb.color_options, confirmedDb.color),
    option_count: factoryAutoFieldTextValue(cafe24Value('option_count'), confirmedDb.option_count),
  };
  let count = 0;
  Object.entries(fields).forEach(([fieldId, value]) => {
    const fieldSource = ['size', 'width_mm', 'depth_mm'].includes(fieldId) && square?.source
      ? square.source
      : sourceLabel;
    if (factorySetSelectedProductAutoField(factory, fieldId, value, fieldSource)) count += 1;
  });
  factory.automation = factory.automation || {};
  if (square?.notice) {
    factory.automation.sizeAutofillNotice = square.notice;
  } else if (factory.automation.sizeAutofillNotice) {
    const { sizeAutofillNotice: _removedNotice, ...remainingAutomation } = factory.automation;
    factory.automation = remainingAutomation;
  }
  return count;
}

function factorySyncAutomationOptionModeFromDbSources(factory) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.automation = factory.automation || {};
  const product = factory.product || {};
  const selectedCafe24Key = String(product.selectedCafe24CandidateKey || product.cafe24DraftProductKey || '').trim();
  const directCafe24Candidate = selectedCafe24Key
    ? [
        ...(Array.isArray(product.pendingCafe24Candidates) ? product.pendingCafe24Candidates : []),
        ...(Array.isArray(product.cafe24Candidates) ? product.cafe24Candidates : []),
      ].find(candidate => {
        const raw = typeof parseCafe24Raw === 'function' ? parseCafe24Raw(candidate) : {};
        return [
          typeof factoryCafe24CandidateKey === 'function' ? factoryCafe24CandidateKey(candidate) : '',
          candidate?.product_no,
          candidate?.product_code,
          raw.product_no,
          raw.product_code,
        ].map(value => String(value || '').trim()).filter(Boolean).includes(selectedCafe24Key);
      })
    : null;
  const selectedCafe24Raw = typeof parseCafe24Raw === 'function'
    ? parseCafe24Raw(directCafe24Candidate || (typeof factoryCafe24TargetCandidate === 'function' ? factoryCafe24TargetCandidate(factory, { allowFallback: false }) : null))
    : null;
  const selectedCafe24Groups = selectedCafe24Raw && typeof factoryExtractCafe24OptionGroups === 'function'
    ? factoryExtractCafe24OptionGroups(selectedCafe24Raw, 'Cafe24 선택 상품', 'cafe24')
    : [];
  const sourceGroups = typeof factoryCurrentDbOptionGroups === 'function'
    ? factoryCurrentDbOptionGroups(factory)
    : (typeof factoryExtractOptionGroups === 'function'
      ? factoryExtractOptionGroups(factory, { includeManual: false }).filter(group => {
        const label = String(group.sourceLabel || '').trim();
        return !(/후보/.test(label) && !/선택|확정|API 상품/.test(label));
      })
      : []);
  const groups = selectedCafe24Groups.length ? selectedCafe24Groups : sourceGroups;
  const optionValueCount = groups.reduce((sum, group) => sum + (Array.isArray(group.values) ? group.values.length : 0), 0);
  if (groups.length && optionValueCount) {
    factory.automation.optionMode = 'provided';
    factory.automation.optionSourceSummary = {
      count: optionValueCount,
      groupCount: groups.length,
      source: groups[0]?.sourceLabel || groups[0]?.sourceType || 'DB/Cafe24',
      updatedAt: Date.now(),
    };
    return true;
  }
  if (factory.automation.optionMode !== 'none') factory.automation.optionMode = 'pending';
  factory.automation.optionSourceSummary = {
    count: 0,
    groupCount: 0,
    source: '',
    updatedAt: Date.now(),
  };
  return false;
}

function factoryScheduleSizeCutAfterCandidateConfirm(sourceLabel = 'DB 확정', factory = null, options = {}) {
  if (!factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/db:schedule-size-cut-review',
      { ...options, owner: 'factory-assets' },
      draft => factoryScheduleSizeCutAfterCandidateConfirm(sourceLabel, draft, {
        ...options,
        persist: false,
        render: false,
      }),
    );
  }
  if (typeof factory !== 'object') throw new TypeError('factory draft is required');
  factory.automation = factory.automation || {};
  const hasSize = typeof factoryHasSizeFacts === 'function' && factoryHasSizeFacts(factory);
  if (!hasSize) {
    factory.automation.lastAutoSizeRunKey = '';
    factory.automation.sizeImageDbConfirmedKey = '';
    factorySetStageStatus('size', 'blocked', `${sourceLabel} 완료. 실제 사이즈값이 없어 사이즈이미지를 생성하지 않았습니다. 필수값에서 가로/세로/규격을 채워주세요.`, factory);
    factoryLog('사이즈이미지 생성 대기: 대표/이미지컷은 유지하고, 확정 DB/Cafe24에서 실제 사이즈값만 확인합니다.', 'warn', factory);
    return false;
  }
  const review = typeof factoryAutomationSizeReviewStatus === 'function'
    ? factoryAutomationSizeReviewStatus(factory)
    : null;
  if (!review?.confirmed) {
    factory.automation.lastAutoSizeRunKey = '';
    factorySetStageStatus('size', 'blocked', `${sourceLabel} 완료. DB 사이즈값 확인이 필요합니다. 생성컷 선택에서 사이즈를 확인하고 '사이즈 확인 완료'를 눌러주세요.`, factory);
    factoryLog('사이즈이미지 생성 대기: DB 사이즈 확인 완료 후 생성 버튼을 사용할 수 있습니다.', 'warn', factory);
    if (options.persist !== false) saveLastWorkNow();
    if (options.render !== false) render();
    return false;
  }
  factory.automation.lastAutoSizeRunKey = '';
  factory.automation.sizeAutoRunRunning = false;
  factorySetStageStatus('size', 'blocked', `${sourceLabel} 완료. 사이즈값을 확인했습니다. 사이즈이미지를 자동 생성하지 않습니다. 생성컷 선택에서 '사이즈이미지 생성'을 누르거나 전체 자동 실행을 사용해주세요.`, factory);
  factoryLog(`사이즈이미지 생성 대기: ${sourceLabel} 사이즈값 확인 완료. 명시적인 생성 버튼 또는 전체 자동 실행을 기다립니다.`, 'info', factory);
  if (options.persist !== false) saveLastWorkNow();
  if (options.render !== false) render();
  return false;
}

async function factoryApplyDbCandidateFromReview(index, options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:apply-db-candidate',
      'cafe24',
      draft => factoryApplyDbCandidateFromReview(index, { ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const lockedProductName = factoryCaptureLockedProductName(factory);
  const candidates = factory.product.pendingDbCandidates || [];
  const candidate = candidates[Number(index)] || factory.product.dbCandidates?.[Number(index)] || null;
  if (!candidate) return false;
  const key = factorySinhwaCandidateKey(candidate);
  if (!factoryCandidateReviewCanApply(candidate, factory)) return factoryBlockCandidateReviewSelection(factory, '신화사DB', options);
  factory.product.candidateReviewStatus = '선택한 신화사DB 상품 상세 정보를 불러오는 중입니다.';
  try {
    const detail = await fetchSinhwaProductDetail(candidate.jcode || candidate.id || key);
    const match = normalizeSinhwaDbMatch(candidate, detail, candidate.match_query || factory.product.productName || state.productName || key, candidates);
    match.match_score = candidate.score || candidate.match_score || match.match_score || 0;
    const current = factory;
    if (!factoryCandidateReviewCanApply(candidate, current)) return factoryBlockCandidateReviewSelection(current, '신화사DB', options);
    factoryClearProductScopedDbManualFields(current, 'sinhwa-candidate-change', { preserveCafe24: true });
    current.product.confirmedDb = cloneData(match);
    current.product.selectedDbCandidateKey = factorySinhwaCandidateKey(match) || key;
    current.product.dbCandidateResolution = 'selected';
    current.product.dbCandidates = factoryDedupeSinhwaCandidates([
      match,
      ...candidates.filter(item => factorySinhwaCandidateKey(item) !== key),
    ]).slice(0, 12);
    current.product.dbLocked = true;
    applySinhwaDbMatch(match);
    current.product.dbContextRefreshedAt = new Date().toISOString();
    const autoFilled = factoryAutofillRequiredFieldsFromSelectedProduct(current, '신화사DB 선택 상품');
    factoryUpdateFinalDbFromFields(current);
    factoryRestoreLockedProductName(current, lockedProductName);
    factorySyncAutomationOptionModeFromDbSources(current);
    current.product.candidateReviewStatus = `신화사DB 확정: ${match.product_name || match.jname || key}${autoFilled ? ` · 필수값 ${autoFilled}개 반영` : ''}`;
    factoryUpdateCandidateReviewStageStatus(current);
    factoryLog(`신화사DB 후보 확정: ${match.product_name || match.jname || key}${autoFilled ? ` · 필수값 ${autoFilled}개 반영` : ''}`, 'ok', current);
    factoryScheduleSizeCutAfterCandidateConfirm('신화사DB 확정', current, { persist: false, render: false });
    return true;
  } catch(e) {
    factory.product.candidateReviewStatus = `신화사DB 후보 적용 실패: ${e.message || e}`;
    factorySetStageStatus('db', 'error', factory.product.candidateReviewStatus, factory);
    factoryLog(factory.product.candidateReviewStatus, 'error', factory);
    return false;
  }
}

async function factoryApplyCafe24CandidateFromReview(index, options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:apply-cafe24-candidate',
      'cafe24',
      draft => factoryApplyCafe24CandidateFromReview(index, { ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const lockedProductName = factoryCaptureLockedProductName(factory);
  const candidates = factory.product.pendingCafe24Candidates || [];
  const candidate = candidates[Number(index)] || factory.product.cafe24Candidates?.[Number(index)] || null;
  if (!candidate) return false;
  const raw = parseCafe24Raw(candidate);
  const productNo = candidate.product_no || raw.product_no || '';
  const key = factoryCafe24CandidateKey(candidate);
  if (!key) return false;
  if (!factoryCandidateReviewCanApply(candidate, factory)) return factoryBlockCandidateReviewSelection(factory, 'Cafe24', options);
  factory.product.candidateReviewStatus = '선택한 Cafe24 상품의 상세 입력값과 옵션을 불러오는 중입니다.';

  let selected = candidate;
  let detailError = '';
  if (productNo) {
    try {
      const detail = await fetchCafe24ProductFullByNo(productNo, candidate.mall_id || raw.mall_id || CAFE24_CONTROL_API.defaultMallId);
      if (detail) selected = factoryMergeCafe24CandidateData(candidate, normalizeCafe24ProductCandidate(detail, `product_no:${productNo}`, 999, 0));
    } catch (error) {
      detailError = error?.message || String(error || 'Cafe24 상세 조회 실패');
    }
  }
  const current = factory;
  if (!factoryCandidateReviewCanApply(candidate, current)) return factoryBlockCandidateReviewSelection(current, 'Cafe24', options);
  const selectedKey = factoryCafe24CandidateKey(selected) || key;
  factoryClearProductScopedDbManualFields(current, 'cafe24-candidate-change', { preserveDb: true });
  current.product.selectedCafe24CandidateKey = selectedKey;
  current.product.cafe24CandidateResolution = 'selected';
  factoryResetCafe24DraftsForProduct(current, selectedKey);
  current.product.confirmedCafe24ProductKey = selectedKey;
  current.product.cafe24DraftProductKey = selectedKey;
  current.product.cafe24Candidates = factoryMergeCafe24Candidates([], [
    selected,
    ...candidates.filter(item => factoryCafe24CandidateKey(item) !== key),
  ]).slice(0, 24);
  current.product.cafe24ApiStatus = detailError
    ? `Cafe24 후보 ${productNo ? `#${productNo}` : selectedKey}를 로컬 작업파일에 확정했습니다. 상세 조회는 보류: ${detailError}`
    : `Cafe24 확정 상품 ${productNo ? `#${productNo}` : selectedKey} 상세 입력값을 불러왔습니다.`;
  const autoEnabled = factoryEnableCafe24CoreDbFields(current);
  current.product.dbContextRefreshedAt = new Date().toISOString();
  const autoFilled = factoryAutofillRequiredFieldsFromSelectedProduct(current, 'Cafe24 선택 상품');
  factoryUpdateFinalDbFromFields(current);
  factoryRestoreLockedProductName(current, lockedProductName);
  factorySyncAutomationOptionModeFromDbSources(current);
  const detailNote = detailError ? ' · 상세 조회는 나중에 다시 시도할 수 있습니다' : '';
  current.product.candidateReviewStatus = `Cafe24 확정: ${factoryCandidateName(selected, 'cafe24')}${autoFilled ? ` · 필수값 ${autoFilled}개 반영` : autoEnabled ? ` · 핵심 DB ${autoEnabled}개 자동 사용` : ''}${detailNote}`;
  factoryUpdateCandidateReviewStageStatus(current);
  factoryLog(`Cafe24 후보 확정: ${factoryCandidateName(selected, 'cafe24')}${detailError ? ' · OAuth/상세 조회 없이 로컬 후보를 보존했습니다.' : ''}`, detailError ? 'warn' : 'ok', current);
  factoryScheduleSizeCutAfterCandidateConfirm('Cafe24 확정', current, { persist: false, render: false });
  return true;
}

function factoryConfirmNoDbCandidate(options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/db:confirmNoDbCandidate',
      { ...options, owner: 'product-db' },
      draft => factoryConfirmNoDbCandidate({ ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  if (typeof factory !== 'object') throw new TypeError('factory draft is required');
  const productName = factoryCaptureLockedProductName(factory) || factory.product.productName || state.productName || '현재 상품';
  factory.product.confirmedDb = null;
  factory.product.selectedDbCandidateKey = '';
  factory.product.dbCandidateResolution = 'none';
  factory.product.dbLocked = false;
  factoryRestoreLockedProductName(factory, productName);
  factoryUpdateFinalDbFromFields(factory);
  factorySyncAutomationOptionModeFromDbSources(factory);
  factory.product.candidateReviewStatus = `신화사DB 후보 없음 확정: ${productName}은(는) 신제품으로 필수값 검수 단계에 진행합니다.`;
  factoryUpdateCandidateReviewStageStatus(factory);
  factoryLog(`신화사DB 후보 없음 확정: ${productName} · 신제품 필수값 검수로 진행`, 'ok', factory);
  return true;
}

function factoryConfirmNoCafe24Candidate(options = {}) {
  if (!options.factory) {
    return factoryCafe24RunOwnedDraftMutation(
      'factory/db:confirmNoCafe24Candidate',
      { ...options, owner: 'product-db' },
      draft => factoryConfirmNoCafe24Candidate({ ...options, factory: draft, render: false }),
    );
  }
  const factory = options.factory;
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const productName = factoryCaptureLockedProductName(factory) || factory.product.productName || state.productName || '현재 상품';
  factory.product.selectedCafe24CandidateKey = '';
  factory.product.confirmedCafe24ProductKey = '';
  factory.product.cafe24DraftProductKey = '';
  factory.product.cafe24CandidateResolution = 'none';
  if (typeof factoryResetCafe24DraftsForProduct === 'function') factoryResetCafe24DraftsForProduct(factory, '');
  factoryRestoreLockedProductName(factory, productName);
  factoryUpdateFinalDbFromFields(factory);
  factorySyncAutomationOptionModeFromDbSources(factory);
  factory.product.candidateReviewStatus = `Cafe24 후보 없음 확정: ${productName}은(는) 기존 상품 수정 없이 새 상품 등록 초안으로 진행합니다.`;
  factory.product.cafe24ApiStatus = 'Cafe24 기존 상품 연결 없음: 새 상품 등록 초안입니다. 실제 등록은 전송 단계에서만 실행합니다.';
  factoryUpdateCandidateReviewStageStatus(factory);
  factoryLog(`Cafe24 후보 없음 확정: ${productName} · 새 상품 등록 초안으로 진행`, 'ok', factory);
  return true;
}

function factorySetSinhwaDbProgramIssue(product, error) {
  const raw = String(error?.message || error || '').trim();
  const detail = typeof compactCafe24ApiErrorText === 'function'
    ? compactCafe24ApiErrorText(raw)
    : raw.slice(0, 500);
  product.sinhwaDbProgramStatus = {
    state: 'offline',
    offline: true,
    starting: false,
    canStart: true,
    checkedAt: Date.now(),
    message: '신화사DB 후보가 꺼져 있어서 DB 수집을 할 수 없습니다. 신화사DB 프로그램을 실행하시겠습니까?',
    detail,
  };
  product.candidateReviewStatus = '신화사DB 후보가 꺼져 있어서 DB 수집을 할 수 없습니다. 아래 버튼으로 실행한 뒤 다시 수집할 수 있습니다.';
}

async function factoryCollectProductCandidatesForReview(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:collect-product-candidates',
      'cafe24',
      draft => factoryCollectProductCandidatesForReview({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const collectionScope = options.scope || factoryCandidateCollectionScope(factory);
  const ensureCollectionScope = () => {
    if (!factoryCandidateCollectionScopeMatches(collectionScope, factory)) {
      throw new Error('작업파일이 변경되어 이전 후보 결과를 현재 작업파일에 반영하지 않았습니다. 현재 작업파일에서 다시 수집해주세요.');
    }
  };
  const terms = factoryCandidateSearchTerms(factory);
  if (!terms.length) throw new Error('제품명 직접 입력이 필요합니다. 이미지 판독명 대신 입력한 이름으로 DB/Cafe24 후보를 수집합니다.');
  const previousSelection = factoryCaptureCandidateReviewSelection(factory);
  factoryResetDbContextForNewCollection(factory, { resetDb: true, resetCafe24: true });
  factory.product.pendingDbCandidates = [];
  factory.product.pendingCafe24Candidates = [];
  factory.product.cafe24ProgramStatus = null;
  factory.product.candidateReviewStatus = `후보 수집 검색어: ${terms.join(' / ')}`;
  factoryUpdateFinalDbFromFields(factory);
  factoryLog(`신화사DB 후보 조회 중: ${terms.join(' / ')} · API Hub 경로 · 최대 20건`, 'info', factory);
  factoryLog(`Cafe24 후보 조회 중: ${terms.join(' / ')} · API Hub 경로 · 최대 24건`, 'info', factory);

  const [sinhwaStatusResult, cafe24StatusResult, cafe24OAuthStatusResult] = await Promise.allSettled([
    typeof fetchSinhwaDbLocalStatus === 'function' ? fetchSinhwaDbLocalStatus() : Promise.resolve(null),
    typeof fetchCafe24ControlStatus === 'function' ? fetchCafe24ControlStatus() : Promise.resolve(null),
    typeof fetchCafe24OAuthStatus === 'function' ? fetchCafe24OAuthStatus(factory.product?.cafe24OAuthStatus?.mallId || CAFE24_CONTROL_API.defaultMallId) : Promise.resolve(null),
  ]);
  const sinhwaPreflightOffline = sinhwaStatusResult.status === 'fulfilled'
    && sinhwaStatusResult.value?.ok !== false
    && sinhwaStatusResult.value?.running === false;
  const cafe24PreflightOffline = cafe24StatusResult.status === 'fulfilled'
    && cafe24StatusResult.value?.ok !== false
    && cafe24StatusResult.value?.running === false;
  if (sinhwaPreflightOffline) factoryLog('신화사DB 상태 확인: 프로그램이 꺼져 있어 실행 후 후보를 다시 수집해야 합니다.', 'warn', factory);
  if (cafe24PreflightOffline) factoryLog('Cafe24 Control Tower 상태 확인: 프로그램이 꺼져 있어 실행 후 후보를 다시 수집해야 합니다.', 'warn', factory);
  const cafe24OAuthStatus = cafe24OAuthStatusResult.status === 'fulfilled' ? cafe24OAuthStatusResult.value : null;
  if (cafe24OAuthStatus) {
    factory.product.cafe24OAuthStatus = cafe24OAuthStatus;
    if (cafe24OAuthStatus.refreshed) {
      factoryLog(`Cafe24 OAuth access 토큰 자동 갱신 완료: ${cafe24OAuthStatus.mallId}`, 'ok', factory);
    } else if (cafe24OAuthStatus.needsReauth || cafe24OAuthStatus.state === 'scope_required') {
      factoryLog(`Cafe24 OAuth 확인: ${cafe24OAuthStatus.message} 후보 조회 전에 재연결이 필요합니다.`, 'warn', factory);
    } else {
      factoryLog(`Cafe24 OAuth 확인 완료: ${cafe24OAuthStatus.mallId} · ${cafe24OAuthStatus.message}`, 'ok', factory);
    }
  }
  ensureCollectionScope();

  const [dbResult, cafe24Result] = await Promise.allSettled([
    factorySearchSinhwaReviewCandidates(terms, 20),
    cafe24OAuthStatus?.needsReauth || cafe24OAuthStatus?.state === 'scope_required'
      ? Promise.reject(new Error('Cafe24 OAuth 재연결 또는 권한 확인이 필요합니다.'))
      : factorySearchCafe24ReviewCandidates(terms, 24),
  ]);
  ensureCollectionScope();
  const current = factory;
  if (dbResult.status === 'fulfilled') {
    current.product.pendingDbCandidates = factorySlimReviewCandidateList(dbResult.value, 'sinhwa', 20);
    current.product.sinhwaDbProgramStatus = null;
    factoryLog(`신화사DB 후보 조회 완료: ${current.product.pendingDbCandidates.length}건`, 'ok', current);
  } else {
    const isOffline = typeof isSinhwaDbUnavailableError === 'function'
      ? isSinhwaDbUnavailableError(dbResult.reason, sinhwaStatusResult.status === 'fulfilled' ? sinhwaStatusResult.value : null)
      : sinhwaPreflightOffline;
    const isNoCandidate = typeof isSinhwaDbNoCandidateError === 'function' && isSinhwaDbNoCandidateError(dbResult.reason);
    if (isOffline) {
      factorySetSinhwaDbProgramIssue(current.product, dbResult.reason);
      factoryLog('신화사DB 후보 조회 실패: 로컬 신화사DB 서비스가 응답하지 않습니다. 신화사DB 실행 버튼을 표시했습니다.', 'error', current);
    } else if (isNoCandidate) {
      current.product.sinhwaDbProgramStatus = null;
      factoryLog(`신화사DB 후보 조회 완료: 0건 · ${dbResult.reason?.message || dbResult.reason}`, 'warn', current);
    } else {
      factoryLog(`신화사DB 후보 조회 실패: API Hub 또는 신화사DB 응답 오류 · ${dbResult.reason?.message || dbResult.reason}`, 'error', current);
    }
  }
  if (cafe24Result.status === 'fulfilled') {
    current.product.pendingCafe24Candidates = factorySlimReviewCandidateList(cafe24Result.value, 'cafe24', 24);
    current.product.cafe24ProgramStatus = null;
    factoryLog(`Cafe24 후보 조회 완료: ${current.product.pendingCafe24Candidates.length}건`, 'ok', current);
  } else {
    const isOffline = typeof isCafe24ControlUnavailableError === 'function'
      ? isCafe24ControlUnavailableError(cafe24Result.reason, cafe24StatusResult.status === 'fulfilled' ? cafe24StatusResult.value : null)
      : cafe24PreflightOffline;
    const oauthBlocked = cafe24OAuthStatus?.needsReauth || cafe24OAuthStatus?.state === 'scope_required';
    if (oauthBlocked) {
      current.product.cafe24ProgramStatus = null;
      factoryLog('Cafe24 후보 조회 보류: OAuth 재연결/권한 확인 버튼을 먼저 진행해주세요.', 'warn', current);
    } else if (isOffline) {
      current.product.cafe24ProgramStatus = {
        state: 'offline',
        offline: true,
        starting: false,
        canStart: true,
        checkedAt: Date.now(),
        message: 'Cafe24 Control Tower가 꺼져 있어 후보를 조회할 수 없습니다. 실행 후 API Hub로 다시 수집합니다.',
        detail: compactCafe24ApiErrorText(cafe24Result.reason?.message || cafe24Result.reason),
      };
      factoryLog('Cafe24 후보 조회 실패: Control Tower가 꺼져 있습니다. 실행 버튼을 표시했습니다.', 'error', current);
    } else {
      factoryLog(`Cafe24 후보 조회 실패: Cafe24 Control Tower 또는 API Hub 응답 오류 · ${cafe24Result.reason?.message || cafe24Result.reason}`, 'error', current);
    }
  }
  const cafe24Offline = cafe24Result.status === 'rejected'
    && (cafe24PreflightOffline
      || (typeof isCafe24ControlUnavailableError === 'function'
        ? isCafe24ControlUnavailableError(cafe24Result.reason, cafe24StatusResult.status === 'fulfilled' ? cafe24StatusResult.value : null)
        : (typeof isCafe24ControlOfflineError === 'function' && isCafe24ControlOfflineError(cafe24Result.reason))));
  const cafe24OAuthBlocked = cafe24OAuthStatus?.needsReauth || cafe24OAuthStatus?.state === 'scope_required';
  if (!cafe24Offline && !cafe24OAuthBlocked && !current.product.pendingCafe24Candidates.length) {
    try {
      ensureCollectionScope();
      factoryLog(`Cafe24 후보 0건: 직접 검색 복구를 시작합니다 · ${terms.join(' / ')}`, 'warn', current);
      const directCafe24 = await factorySearchCafe24DirectReviewCandidates(terms, 24);
      ensureCollectionScope();
      if (directCafe24.length) {
        current.product.pendingCafe24Candidates = factorySlimReviewCandidateList(directCafe24, 'cafe24', 24);
        factoryLog(`Cafe24 직접 검색 복구 완료: 후보 ${directCafe24.length}건을 표시합니다.`, 'ok', current);
      }
    } catch(e) {
      factoryLog(`Cafe24 직접 검색 복구 실패: Control Tower 응답을 받지 못했습니다 · ${e.message || e}`, 'error', current);
    }
  }

  const dbCount = current.product.pendingDbCandidates.length;
  const cafeCount = current.product.pendingCafe24Candidates.length;
  ensureCollectionScope();
  const sourceNotes = [];
  const sinhwaDbOffline = sinhwaPreflightOffline || (dbResult.status === 'rejected'
    && (typeof isSinhwaDbUnavailableError === 'function'
      ? isSinhwaDbUnavailableError(dbResult.reason, sinhwaStatusResult.status === 'fulfilled' ? sinhwaStatusResult.value : null)
      : (typeof isSinhwaDbOfflineError === 'function' && isSinhwaDbOfflineError(dbResult.reason))));
  const sinhwaDbNoCandidate = dbResult.status === 'rejected' && typeof isSinhwaDbNoCandidateError === 'function' && isSinhwaDbNoCandidateError(dbResult.reason);
  if (sinhwaDbOffline) sourceNotes.push('신화사DB 실행 필요');
  else if (sinhwaDbNoCandidate) sourceNotes.push('신화사DB 후보 없음');
  else if (dbResult.status === 'rejected') sourceNotes.push('신화사DB 연결 실패');
  if (cafe24Offline) sourceNotes.push('Cafe24 Control Tower 실행 필요');
  else if (cafe24OAuthBlocked) sourceNotes.push('Cafe24 OAuth 재연결 필요');
  else if (cafe24Result.status === 'rejected' && !cafeCount) sourceNotes.push('Cafe24 후보 수집 실패');
  current.product.candidateReviewStatus = `후보 수집 완료: 신화사DB ${dbCount}건 · Cafe24 ${cafeCount}건. ${sourceNotes.length ? `${sourceNotes.join(' · ')} 상태입니다. ` : ''}${current.product.candidateAutoApply ? '자동 확정 모드입니다.' : '아래에서 실제 상품을 선택해주세요.'}`;
  if (!dbCount && !cafeCount) {
    current.product.candidateReviewStatus = `후보 조회 완료: 신화사DB 0건 · Cafe24 0건. 로그에서 각 연결 실패 여부를 확인하세요. 실제 신제품이면 각 패널에서 후보 없음으로 확정할 수 있습니다.`;
  }
  const restoredSelection = factoryRestoreCandidateReviewSelection(current, previousSelection);

  if (current.product.candidateAutoApply) {
    if (dbCount) {
      await factoryApplyDbCandidateFromReview(0, { render: false, factory: current });
      ensureCollectionScope();
    }
    if (cafeCount) {
      await factoryApplyCafe24CandidateFromReview(0, { render: false, factory: current });
      ensureCollectionScope();
    }
    current.product.candidateReviewStatus = `최상위 후보 자동 확정 완료: 신화사DB ${dbCount ? '적용' : '없음'} · Cafe24 ${cafeCount ? '적용' : '없음'}`;
  } else {
    factoryUpdateCandidateReviewStageStatus(current);
    if (restoredSelection) {
      current.product.candidateReviewStatus = `${current.product.candidateReviewStatus} 이전에 확정한 후보 선택은 유지했습니다.`;
    }
    if (cafeCount) factoryStartCafe24CandidateRerank(terms, current.product.pendingCafe24Candidates, { factory: current });
  }
  return { dbCount, cafeCount, terms };
}

async function factoryCollectCafe24CandidatesForReviewOnly(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:collect-cafe24-candidates',
      'cafe24',
      draft => factoryCollectCafe24CandidatesForReviewOnly({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const terms = factoryCandidateSearchTerms(factory);
  if (!terms.length) throw new Error('Cafe24 후보 검색에 사용할 제품명을 먼저 입력해주세요.');
  const previousSelection = factoryCaptureCandidateReviewSelection(factory);
  factoryResetDbContextForNewCollection(factory, { resetDb: false, resetCafe24: true });
  factory.product.pendingCafe24Candidates = [];
  factory.product.cafe24ProgramStatus = null;
  factory.product.candidateReviewStatus = `Cafe24 후보 검색어: ${terms.join(' / ')}`;
  factory.product.cafe24ApiStatus = `Cafe24 후보 검색 중: ${terms.join(' / ')}`;
  factoryUpdateFinalDbFromFields(factory);

  let cafe24PreflightOffline = false;
  try {
    const status = await fetchCafe24ControlStatus();
    cafe24PreflightOffline = status?.ok !== false && status?.running === false;
  } catch (_) {
    cafe24PreflightOffline = false;
  }
  let cafe24OAuthStatus = null;
  try {
    cafe24OAuthStatus = await fetchCafe24OAuthStatus(factory.product?.cafe24OAuthStatus?.mallId || CAFE24_CONTROL_API.defaultMallId);
    factory.product.cafe24OAuthStatus = cafe24OAuthStatus;
    if (cafe24OAuthStatus.needsReauth || cafe24OAuthStatus.state === 'scope_required') {
      factoryLog(`Cafe24 OAuth 확인: ${cafe24OAuthStatus.message} 후보 조회 전에 재연결이 필요합니다.`, 'warn', factory);
    }
  } catch (_) {
    cafe24OAuthStatus = null;
  }
  let candidates;
  try {
    if (cafe24PreflightOffline) throw new Error('Cafe24 Control Tower가 꺼져 있습니다.');
    if (cafe24OAuthStatus?.needsReauth || cafe24OAuthStatus?.state === 'scope_required') throw new Error('Cafe24 OAuth 재연결 또는 권한 확인이 필요합니다.');
    candidates = await factorySearchCafe24ReviewCandidates(terms, 24);
  } catch (error) {
    const current = factory;
    if (cafe24OAuthStatus?.needsReauth || cafe24OAuthStatus?.state === 'scope_required') {
      current.product.cafe24ProgramStatus = null;
      factoryLog('Cafe24 후보 조회 보류: OAuth 재연결/권한 확인 버튼을 먼저 진행해주세요.', 'warn', current);
    } else if (typeof isCafe24ControlUnavailableError === 'function'
      ? isCafe24ControlUnavailableError(error, cafe24PreflightOffline ? { ok: true, running: false } : null)
      : cafe24PreflightOffline) {
      current.product.cafe24ProgramStatus = {
        state: 'offline',
        offline: true,
        starting: false,
        canStart: true,
        checkedAt: Date.now(),
        message: 'Cafe24 Control Tower가 꺼져 있어 후보를 조회할 수 없습니다. 실행 후 API Hub로 다시 수집합니다.',
        detail: compactCafe24ApiErrorText(error?.message || error),
      };
      factoryLog('Cafe24 후보 조회 실패: Control Tower가 꺼져 있습니다. 실행 버튼을 표시했습니다.', 'error', current);
    }
    throw error;
  }
  const current = factory;
  current.product.pendingCafe24Candidates = factorySlimReviewCandidateList(candidates, 'cafe24', 24);
  const restoredSelection = factoryRestoreCandidateReviewSelection(current, previousSelection);
  const cafeCount = candidates.length;
  current.product.candidateReviewStatus = `Cafe24 후보 수집 완료: ${cafeCount}건. ${current.product.candidateAutoApply ? '자동 확정 모드입니다.' : '후보 사진과 점수를 보고 실제 상품을 선택해주세요.'}${restoredSelection ? ' 이전에 확정한 후보 선택은 유지했습니다.' : ''}`;
  current.product.cafe24ApiStatus = cafeCount
    ? `Cafe24 후보 ${cafeCount}건을 불러왔습니다. 후보를 확정하면 해당 상품의 옵션/가격/상품번호를 상세 입력판에 반영합니다.`
    : `Cafe24 후보를 찾지 못했습니다. 제품명/힌트를 바꿔 다시 검색해주세요.`;
  if (!cafeCount) {
    current.product.candidateReviewStatus = 'Cafe24 후보 0건입니다. 신제품이면 Cafe24 후보 없음으로 확정해 새 상품 등록 초안으로 진행하세요.';
  }

  if (current.product.candidateAutoApply) {
    await factoryApplyCafe24CandidateFromReview(0, { render: false, factory: current });
    current.product.candidateReviewStatus = `Cafe24 1순위 후보 자동 확정 완료: ${factoryCandidateName(current.product.cafe24Candidates?.[0], 'cafe24') || '선택 상품'}`;
  } else {
    factoryUpdateCandidateReviewStageStatus(current);
    factoryStartCafe24CandidateRerank(terms, candidates, { factory: current });
  }
  return { cafeCount, terms };
}

async function factoryCollectAdditionalCafe24CandidatesForReview(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:collect-additional-cafe24-candidates',
      'cafe24',
      draft => factoryCollectAdditionalCafe24CandidatesForReview({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  const terms = factoryCandidateSearchTerms(factory);
  if (!terms.length) throw new Error('Cafe24 추가검색에 사용할 제품명을 먼저 입력해주세요.');
  const existing = [
    ...(Array.isArray(factory.product.pendingCafe24Candidates) ? factory.product.pendingCafe24Candidates : []),
    ...(Array.isArray(factory.product.cafe24Candidates) ? factory.product.cafe24Candidates : []),
  ];
  factory.product.candidateReviewStatus = `Cafe24 추가검색 중: ${terms.join(' / ')}`;
  factory.product.cafe24ApiStatus = `기존 Cafe24 후보 ${existing.length}건을 제외하고 새 후보를 찾는 중입니다.`;
  factory.automation = factory.automation || {};
  factory.automation.candidateSearchProgress = {
    running: true,
    kind: 'append-cafe24',
    message: `Cafe24 추가검색 중입니다. 기존 후보 ${existing.length}건은 유지하고 새 후보만 찾고 있습니다.`,
    updatedAt: Date.now(),
  };
  factoryLog(`Cafe24 추가검색 진행: 검색어 ${terms.join(' / ')} · 기존 후보 ${existing.length}건 제외`, 'info', factory);
  factoryUpdateFinalDbFromFields(factory);
  try {
    const oauthStatus = await fetchCafe24OAuthStatus(factory.product?.cafe24OAuthStatus?.mallId || CAFE24_CONTROL_API.defaultMallId);
    factory.product.cafe24OAuthStatus = oauthStatus;
    if (oauthStatus.needsReauth || oauthStatus.state === 'scope_required') {
      const message = 'Cafe24 OAuth 재연결 또는 권한 확인이 필요합니다. 추가검색을 보류했습니다.';
      factory.product.candidateReviewStatus = message;
      factory.product.cafe24ApiStatus = message;
      factory.automation.candidateSearchProgress = { running: false, kind: 'append-cafe24', message, updatedAt: Date.now() };
      factoryLog(message, 'warn', factory);
      throw new Error(message);
    }
  } catch (error) {
    if (/OAuth 재연결|권한 확인/.test(String(error?.message || error))) throw error;
    factoryLog('Cafe24 OAuth 상태를 확인하지 못했습니다. 추가검색은 후보 API 응답으로 계속 확인합니다.', 'warn', factory);
  }
  await new Promise(resolve => setTimeout(resolve, 30));

  const candidates = await factorySearchCafe24ReviewCandidates(terms, 48);
  factoryLog(`Cafe24 추가검색 진행: API/스냅샷 후보 ${candidates.length}건을 받았습니다. 기존 후보와 중복을 걸러냅니다.`, 'info', factory);
  const additions = factoryFilterNewCafe24Candidates(candidates, existing);
  const addedAt = Date.now();
  const taggedAdditions = additions.map(candidate => ({
    ...candidate,
    factory_recent_append: true,
    factory_append_label: '이번 추가검색',
    factory_appended_at: addedAt,
  }));
  const current = factory;
  const basePending = Array.isArray(current.product.pendingCafe24Candidates) ? current.product.pendingCafe24Candidates : [];
  const baseSaved = Array.isArray(current.product.cafe24Candidates) ? current.product.cafe24Candidates : [];
  const visibleBase = basePending.length ? basePending : baseSaved;
  current.product.pendingCafe24Candidates = factoryDedupeCafe24Candidates([
    ...taggedAdditions,
    ...visibleBase,
  ]).map(factorySlimCafe24ReviewCandidate).slice(0, 48);
  current.product.cafe24Candidates = factoryDedupeCafe24Candidates(baseSaved).map(factorySlimCafe24ReviewCandidate).slice(0, 24);
  current.product.candidateReviewStatus = additions.length
    ? `Cafe24 추가검색 완료: 기존 후보 ${existing.length}건 제외, 새 후보 ${additions.length}건을 목록 맨 위에 추가.`
    : `Cafe24 추가검색 완료: 기존 후보 ${existing.length}건과 다른 새 후보를 찾지 못했습니다. 검색어를 더 넓게 바꿔보세요.`;
  current.product.cafe24ApiStatus = additions.length
    ? `Cafe24 새 후보 ${additions.length}건을 목록 맨 위에 추가했습니다.`
    : `새 Cafe24 후보 없음: 기존 후보와 중복되거나 검색 결과가 같습니다.`;
  current.automation = current.automation || {};
  current.automation.candidateSearchProgress = {
    running: false,
    kind: 'append-cafe24',
    message: additions.length
      ? `Cafe24 추가검색 완료: 새 후보 ${additions.length}건을 목록 맨 위에 붙였습니다.`
      : 'Cafe24 추가검색 완료: 기존 후보와 다른 새 후보가 없습니다.',
    updatedAt: Date.now(),
  };
  factoryUpdateCandidateReviewStageStatus(current);
  if (additions.length) factoryStartCafe24CandidateRerank(terms, current.product.pendingCafe24Candidates, { factory: current });
  return { addedCount: additions.length, totalCount: current.product.pendingCafe24Candidates.length, terms };
}

async function factoryRunCafe24CandidateAdditionalSearch(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:run-candidate-additional-search',
      'cafe24',
      draft => factoryRunCafe24CandidateAdditionalSearch({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateFromInputs(factory);
  factoryApplyProductToApp(factory);
  if (!cleanDbSearchTerm(factory.product.productName || state.productName || factory.product.naturalHint || '')) {
    factorySetStageStatus('db', 'blocked', 'Cafe24 추가검색 전에 제품명을 먼저 입력해주세요.', factory);
    factoryLog('Cafe24 추가검색 중단: 제품명 직접 입력이 필요합니다.', 'error', factory);
    return false;
  }
  factorySetStageStatus('db', 'running', '기존 Cafe24 후보를 제외하고 추가 후보를 수집합니다.', factory);
  factoryLog('Cafe24 추가검색 시작: 현재 화면 후보는 유지하고, 같은 상품번호/상품코드/상품명 후보는 제외합니다.', 'info', factory);
  factory.automation = factory.automation || {};
  factory.automation.candidateSearchProgress = {
    running: true,
    kind: 'append-cafe24',
    message: 'Cafe24 추가검색을 시작했습니다. 후보 목록은 유지한 채 새 후보를 찾습니다.',
    updatedAt: Date.now(),
  };
  await new Promise(resolve => setTimeout(resolve, 30));
  try {
    state.step = 'factory';
    const result = await factoryCollectAdditionalCafe24CandidatesForReview({ factory, render: false });
    const current = factory;
    factorySetStageStatus(
      'db',
      'review',
      result.addedCount
        ? `Cafe24 새 후보 ${result.addedCount}건 추가 · 후보 확인 필요`
        : 'Cafe24 추가검색 완료 · 새 후보 없음',
      current,
    );
    factoryLog(
      result.addedCount
        ? `Cafe24 추가검색 완료: 새 후보 ${result.addedCount}건을 목록 맨 위에 추가, 화면 후보 총 ${result.totalCount}건`
        : 'Cafe24 추가검색 완료: 기존 후보와 다른 새 후보를 찾지 못했습니다.',
      result.addedCount ? 'ok' : 'warn',
      current,
    );
    return true;
  } catch(e) {
    state.step = 'factory';
    const current = factory;
    current.product.candidateReviewStatus = `Cafe24 추가검색 실패: ${e.message || e}`;
    current.product.cafe24ApiStatus = current.product.candidateReviewStatus;
    current.automation = current.automation || {};
    current.automation.candidateSearchProgress = {
      running: false,
      kind: 'append-cafe24',
      message: current.product.candidateReviewStatus,
      updatedAt: Date.now(),
    };
    factorySetStageStatus('db', 'error', current.product.candidateReviewStatus, current);
    factoryLog(current.product.candidateReviewStatus, 'error', current);
    return false;
  }
}

async function factoryRunCafe24CandidateSearchOnly(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:run-candidate-search-only',
      'cafe24',
      draft => factoryRunCafe24CandidateSearchOnly({ ...options, factory: draft, render: false }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false) render();
    return receipt.result;
  }
  const factory = options.factory;
  factoryUpdateFromInputs(factory);
  factoryApplyProductToApp(factory);
  if (!cleanDbSearchTerm(factory.product.productName || state.productName || factory.product.naturalHint || '')) {
    factorySetStageStatus('db', 'blocked', 'Cafe24 후보 검색 전에 제품명을 먼저 입력해주세요.', factory);
    factoryLog('Cafe24 후보 검색 중단: 제품명 직접 입력이 필요합니다.', 'error', factory);
    return false;
  }
  factoryResetDbContextForNewCollection(factory, { resetDb: false, resetCafe24: true });
  factorySetStageStatus('db', 'running', 'Cafe24 후보를 이름과 이미지 단서 기준으로 수집합니다.', factory);
  factoryLog('Cafe24 후보 검색 시작: 직접 입력 제품명을 우선하고, 설정된 후보 판독 엔진이 있으면 이미지 재랭킹까지 적용합니다.', 'info', factory);
  try {
    state.step = 'factory';
    const result = await factoryCollectCafe24CandidatesForReviewOnly({ factory, render: false });
    const current = factory;
    factorySetStageStatus(
      'db',
      current.product.candidateAutoApply ? 'done' : 'review',
      current.product.candidateAutoApply
        ? `Cafe24 1순위 자동 확정: 후보 ${result.cafeCount}건`
        : `Cafe24 후보 확인 필요: ${result.cafeCount}건`,
      current,
    );
    factoryLog(`Cafe24 후보 검색 완료: ${result.cafeCount}건`, 'ok', current);
    return true;
  } catch(e) {
    state.step = 'factory';
    const current = factory;
    current.product.candidateReviewStatus = `Cafe24 후보 검색 실패: ${e.message || e}`;
    current.product.cafe24ApiStatus = current.product.candidateReviewStatus;
    factorySetStageStatus('db', 'error', current.product.candidateReviewStatus, current);
    factoryLog(current.product.candidateReviewStatus, 'error', current);
    return false;
  }
}
