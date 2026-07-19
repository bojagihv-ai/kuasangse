function factoryOptionTextFromCafe24String(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!/option|value|text|색상|색깔/i.test(raw)) return '';
  const jsonish = raw.match(/["']?(?:option_text|optionText|display_value|displayValue|value_name|valueName|text|color|color_name|색상|색깔)["']?\s*[:=]\s*["']?([^;"'}\]\r\n]+)/i);
  if (jsonish) return factoryCleanOptionValue(jsonish[1]);
  const cafe24Console = raw.match(/(?:^|[;,{]\s*)(?:option_text|optionText|display_value|displayValue|value_name|valueName|text|color|color_name|색상|색깔)\s*=\s*([^;}\]\r\n]+)/i);
  if (cafe24Console) return factoryCleanOptionValue(cafe24Console[1]);
  return '';
}

function factorySplitOptionText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  const cafe24OptionText = factoryOptionTextFromCafe24String(raw);
  if (cafe24OptionText) return [cafe24OptionText];
  if (/^[\[{]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      return factoryExtractOptionValuesFromValue(parsed);
    } catch(e) {}
  }
  const primary = raw.split(/[,/|·;、\n\r]+/).map(factoryCleanOptionValue).filter(Boolean);
  if (primary.length > 1) return primary;
  const numbered = [...raw.matchAll(/(?:^|\s)(\d{1,2}\s*[가-힣A-Za-z][^\s,/|·;、]{0,18})/g)]
    .map(match => factoryCleanOptionValue(match[1]))
    .filter(Boolean);
  if (numbered.length > 1) return numbered;
  return primary;
}

function factoryDedupeOptionValues(values) {
  const out = [];
  const seen = new Set();
  values.forEach(value => {
    const cleaned = factoryCleanOptionValue(value);
    if (!cleaned) return;
    const key = factoryDbNormalizeKey(cleaned);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  });
  return out;
}

function factoryCleanRealOptionValue(value, options = {}) {
  const cafe24OptionText = factoryOptionTextFromCafe24String(value);
  const cleaned = factoryCleanOptionValue(cafe24OptionText || value);
  if (!cleaned) return '';
  if (/^(미분류|분류\s*없음|없음|선택\s*안\s*함|선택\s*없음|옵션\s*없음|해당\s*없음|미선택)$/i.test(cleaned)) return '';
  if (/^(T|F|Y|N|C|S|A|B|O|P|D|R|M)$/i.test(cleaned)) return '';
  if (/^(true|false|null|undefined)$/i.test(cleaned)) return '';
  if (!options.allowNumeric && /^-?\d+(\.\d+)?$/.test(cleaned.replace(/,/g, ''))) return '';
  if (/^P[0-9A-Z]{6,}$/i.test(cleaned)) return '';
  if (/^[A-Z]\d{6,}$/i.test(cleaned)) return '';
  if (/^[A-Z]0{4,}$/i.test(cleaned)) return '';
  return cleaned;
}

function factoryCleanOptionLabel(value) {
  const cleaned = String(value ?? '')
    .replace(/^[\s"'`[\]{}()]+|[\s"'`[\]{}()]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^(true|false|null|undefined)$/i.test(cleaned)) return '';
  return cleaned.slice(0, 40);
}

function factoryDedupeRealOptionValues(values, options = {}) {
  return factoryDedupeOptionValues(values.map(value => factoryCleanRealOptionValue(value, options)).filter(Boolean));
}

function factoryCafe24NormalizeVariantOptions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'object') return [value];
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (/^[\[{]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      return factoryCafe24NormalizeVariantOptions(parsed);
    } catch(e) {}
  }
  return [{ value: raw }];
}

function factoryExtractCafe24OptionGroupValues(group) {
  if (!group || typeof group !== 'object') return [];
  const optionValue = group.option_value ?? group.optionValue ?? group.option_values ?? group.optionValues ?? group.values ?? group.value;
  if (Array.isArray(optionValue)) {
    return factoryDedupeRealOptionValues(optionValue.flatMap(item => {
      if (item && typeof item === 'object') {
        return [
          item.option_text,
          item.optionText,
          item.text,
          item.display_value,
          item.displayValue,
          item.value_name,
          item.valueName,
          item.value,
          item.name,
        ];
      }
      return [item];
    }), { allowNumeric: true });
  }
  if (optionValue && typeof optionValue === 'object') {
    return factoryDedupeRealOptionValues([
      optionValue.option_text,
      optionValue.optionText,
      optionValue.text,
      optionValue.display_value,
      optionValue.displayValue,
      optionValue.value_name,
      optionValue.valueName,
      optionValue.value,
      optionValue.name,
    ], { allowNumeric: true });
  }
  return factoryDedupeRealOptionValues(
    factoryExtractOptionValuesFromValue(optionValue ?? group.option_text ?? group.optionText ?? group.text ?? group.value, '', 0, { allowNumeric: true }),
    { allowNumeric: true }
  );
}

function factoryExtractCafe24OptionGroups(data, sourceLabel, sourceType = 'cafe24') {
  if (!data || typeof data !== 'object') return [];
  const parsedRaw = parseCafe24Raw(data.rawProduct || data);
  const raw = data.raw || (parsedRaw && typeof parsedRaw === 'object' && Object.keys(parsedRaw).length ? parsedRaw : data);
  const officialGroups = factoryCafe24OfficialOptionGroups(raw);
  if (officialGroups.length) {
    return officialGroups.map(group => ({
      sourceLabel,
      sourceType,
      label: factoryCleanOptionLabel(group.option_name || group.optionName || group.name || '옵션'),
      values: factoryExtractCafe24OptionGroupValues(group),
      cafe24Official: true,
    })).filter(group => group.label && group.values.length);
  }
  const roots = [raw.options, raw.product_options, raw.option].filter(Boolean);
  const groups = [];
  const pushGroup = group => {
    if (!group || typeof group !== 'object') return;
    const label = factoryCleanOptionLabel(group.option_name || group.optionName || group.name || group.label || group.group_name || group.groupName || '옵션');
    const values = factoryExtractCafe24OptionGroupValues(group);
    if (label && values.length) groups.push({ sourceLabel, sourceType, label, values, cafe24Official: true });
  };
  roots.forEach(root => {
    if (!root || typeof root !== 'object') return;
    if (Array.isArray(root)) root.forEach(pushGroup);
    else if (Array.isArray(root.options)) root.options.forEach(pushGroup);
    else if (Array.isArray(root.option)) root.option.forEach(pushGroup);
    else if (root.option_value || root.optionValue || root.option_name || root.optionName) pushGroup(root);
  });
  if (groups.length) return groups;

  const variantMap = new Map();
  const variants = Array.isArray(raw.variants) ? raw.variants : (Array.isArray(data.variants) ? data.variants : []);
  variants.forEach(variant => {
    factoryCafe24NormalizeVariantOptions(variant?.options ?? variant?.option).forEach(opt => {
      if (!opt || typeof opt !== 'object') return;
      const label = factoryCleanOptionLabel(opt.name || opt.option_name || opt.optionName || opt.label || '옵션');
      const value = factoryCleanRealOptionValue(opt.value || opt.option_text || opt.optionText || opt.text, { allowNumeric: true });
      if (!label || !value) return;
      if (!variantMap.has(label)) variantMap.set(label, []);
      variantMap.get(label).push(value);
    });
  });
  return [...variantMap.entries()].map(([label, values]) => ({
    sourceLabel,
    sourceType,
    label,
    values: factoryDedupeRealOptionValues(values, { allowNumeric: true }),
    cafe24VariantFallback: true,
  })).filter(group => group.values.length);
}

function factoryExtractOptionValuesFromValue(value, path = '', depth = 0, options = {}) {
  if (value === null || value === undefined || depth > 7) return [];
  if (factoryIsOptionConfigKey(path)) return [];
  if (typeof value === 'string' || typeof value === 'number') return factoryDedupeRealOptionValues(factorySplitOptionText(value), options);
  if (typeof value === 'boolean') return [];
  if (Array.isArray(value)) {
    return factoryDedupeRealOptionValues(value.flatMap((item, index) => factoryExtractOptionValuesFromValue(item, `${path}[${index}]`, depth + 1, options)), options);
  }
  if (typeof value !== 'object') return [];

  const optionish = factoryIsOptionKey(path);
  const keys = Object.keys(value);
  const hasExplicitValueKey = keys.some(key => /^(option_?value|value|values|text|option_?text|display_?value|color|color_?name|색상|색깔)$/i.test(key));
  const preferredKeys = ['option_value','optionValue','option_text','optionText','display_value','displayValue','value','values','text','color','color_name','colorName','색상','색깔','item_name','itemName'];
  const values = [];

  preferredKeys.forEach(key => {
    if (value[key] !== undefined) values.push(...factoryExtractOptionValuesFromValue(value[key], `${path}.${key}`, depth + 1, options));
  });
  if (optionish && !hasExplicitValueKey) {
    ['name','label','title'].forEach(key => {
      if (value[key] !== undefined) values.push(...factoryExtractOptionValuesFromValue(value[key], `${path}.${key}`, depth + 1, options));
    });
  }
  Object.entries(value).forEach(([key, child]) => {
    const nextPath = path ? `${path}.${key}` : key;
    if (factoryIsOptionConfigKey(nextPath)) return;
    if (factoryIsOptionKey(nextPath) || (optionish && child && typeof child === 'object')) {
      values.push(...factoryExtractOptionValuesFromValue(child, nextPath, depth + 1, options));
    }
  });
  return factoryDedupeRealOptionValues(values, options);
}

function factoryOptionGroupLabel(path, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const direct = value.option_name || value.optionName || value.group_name || value.groupName || value.name;
    if (direct && factoryCleanOptionValue(direct)) return factoryCleanOptionValue(direct);
  }
  if (/색상|색깔|color|colour/i.test(path)) return '색상';
  if (/사이즈|size/i.test(path)) return '사이즈';
  const last = String(path || '옵션').split(/[.[\]]+/).filter(Boolean).slice(-1)[0] || '옵션';
  return last.replace(/_/g, ' ');
}

function factoryExtractOptionGroupsFromData(data, sourceLabel, sourceType, path = '', groups = [], depth = 0) {
  if (data === null || data === undefined || depth > 6) return groups;
  if (factoryIsOptionKey(path)) {
    const values = factoryExtractOptionValuesFromValue(data, path);
    if (values.length) groups.push({ sourceLabel, sourceType, label: factoryOptionGroupLabel(path, data), values });
  }
  if (Array.isArray(data)) {
    data.slice(0, 80).forEach((item, index) => factoryExtractOptionGroupsFromData(item, sourceLabel, sourceType, `${path}[${index + 1}]`, groups, depth + 1));
    return groups;
  }
  if (typeof data === 'object') {
    Object.entries(data).forEach(([key, child]) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (factoryIsOptionConfigKey(nextPath)) return;
      if (factoryIsOptionKey(nextPath) || (child && typeof child === 'object')) {
        factoryExtractOptionGroupsFromData(child, sourceLabel, sourceType, nextPath, groups, depth + 1);
      }
    });
  }
  return groups;
}

function factoryLooksLikeAiAnalysisObject(data) {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data);
  const hasAiShape = ['ai_product_name','visual_clues','key_features','image_analysis','cafe24_candidates','db_candidates','similar_products'].some(key => keys.includes(key));
  const hasDbIdentity = ['jcode','product_code','product_no','상품코드','상품번호'].some(key => data[key] !== undefined && data[key] !== null && data[key] !== '');
  return hasAiShape && !hasDbIdentity;
}

function factoryFormatDbValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const simple = value.map(item => factoryFormatDbValue(item)).filter(Boolean);
    return simple.length ? simple.join(', ') : '';
  }
  if (typeof value === 'object') {
    const preferred = ['name','product_name','label','value','text','color','option_name','price','sale_price','consumer_price','manufacturer','maker'];
    const hit = preferred.map(key => value[key]).find(v => v !== undefined && v !== null && factoryFormatDbValue(v));
    if (hit !== undefined) return factoryFormatDbValue(hit);
    try { return JSON.stringify(value); } catch(e) { return String(value); }
  }
  return String(value);
}

function factoryFlattenDbRows(value, sourceLabel, sourceType, path = '', rows = [], depth = 0) {
  if (value === null || value === undefined || depth > 4) return rows;
  if (Array.isArray(value)) {
    if (!value.length) return rows;
    const primitive = value.every(item => item === null || ['string','number','boolean'].includes(typeof item));
    if (primitive) {
      rows.push({
        id: `raw_${rows.length}`,
        sourceLabel,
        sourceType,
        key: path || sourceLabel,
        value: factoryFormatDbValue(value),
        fieldId: factoryMatchDbFieldId(path),
      });
      return rows;
    }
    value.slice(0, 20).forEach((item, index) => factoryFlattenDbRows(item, sourceLabel, sourceType, `${path}[${index + 1}]`, rows, depth + 1));
    return rows;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (child && typeof child === 'object' && !Array.isArray(child)) {
        const formatted = factoryFormatDbValue(child);
        if (formatted && formatted.length < 180) {
          rows.push({ id: `raw_${rows.length}`, sourceLabel, sourceType, key: nextPath, value: formatted, fieldId: factoryMatchDbFieldId(nextPath) });
        }
        factoryFlattenDbRows(child, sourceLabel, sourceType, nextPath, rows, depth + 1);
      } else {
        const formatted = factoryFormatDbValue(child);
        if (formatted) rows.push({ id: `raw_${rows.length}`, sourceLabel, sourceType, key: nextPath, value: formatted, fieldId: factoryMatchDbFieldId(nextPath) });
      }
    });
    return rows;
  }
  const formatted = factoryFormatDbValue(value);
  if (formatted) rows.push({ id: `raw_${rows.length}`, sourceLabel, sourceType, key: path || sourceLabel, value: formatted, fieldId: factoryMatchDbFieldId(path || sourceLabel) });
  return rows;
}

function factoryIsMetaSourceRow(row = {}) {
  const key = String(row.key || '').trim();
  const normalized = factoryDbNormalizeKey(key);
  if (!normalized) return false;
  if (/^(source|connector_id|matched_at|match_query|match_score|local_match_score|gpt_similarity_score|gpt_decision|gpt_reason|gpt_rank|index)$/i.test(key)) return true;
  if (/^(source|connectorid|matchedat|matchquery|matchscore|localmatchscore|gptsimilarityscore|gptdecision|gptreason|gptrank|index)$/.test(normalized)) return true;
  if (/^(raw|rawProduct)(\.|$)/i.test(key)) return true;
  return false;
}

function factoryIsCafe24InputSafeRow(row = {}) {
  if (!row || row.sourceType !== 'cafe24') return true;
  if (factoryIsMetaSourceRow(row)) return false;
  if (row.fieldId === 'option_values' && !factoryCleanRealOptionValue(row.value)) return false;
  if (factoryIsOptionConfigKey(row.key) && !factoryMatchDbFieldId(row.key)) return false;
  return true;
}

function factoryIsCafe24FormRawRow(row = {}) {
  if (!row || row.sourceType !== 'cafe24') return true;
  if (!factoryIsCafe24InputSafeRow(row)) return false;
  if (!row.fieldId) return false;
  const sourceKey = String(row.key || '').trim();
  if (/[.[\]]/.test(sourceKey)) return false;
  const normalizedField = factoryDbNormalizeKey(row.fieldId);
  const normalizedKey = factoryDbNormalizeKey(sourceKey);
  const displayBlock = new Set(['listicon','main','relationalproduct','variants','options','option','optionvalues','optioncount','productno','productcode','shopno','mallid']);
  if (displayBlock.has(normalizedField) || displayBlock.has(normalizedKey)) return false;
  if (factoryIsTechnicalRawDbField({ sourceKey: row.key, sourceLabel: row.sourceLabel, id: row.fieldId })) return false;
  return true;
}

function factoryRowsForDbSourceUse(rows = []) {
  return rows.filter(factoryIsCafe24InputSafeRow);
}

function factoryRowsForRawDisplay(rows = []) {
  return rows.filter(row => {
    if (row.sourceType === 'cafe24' && !factoryIsCafe24FormRawRow(row)) return false;
    if (!factoryIsCafe24InputSafeRow(row)) return false;
    return true;
  });
}

function factoryDbSourceObjects(factory = factoryRuntimeReadFactory(), options = {}) {
  const analysis = factory.product.analysis || state.analysis || {};
  const includeAnalysis = options.includeAnalysis === true;
  const includeManual = options.includeManual !== false;
  const includeAllCafe24Candidates = options.includeAllCafe24Candidates === true;
  const types = Array.isArray(options.types) ? new Set(options.types) : null;
  const sources = [];
  const addSource = source => {
    if (!source?.data || typeof source.data !== 'object') return;
    if (types && !types.has(source.type)) return;
    sources.push(source);
  };
  const cafe24SourceData = item => {
    const raw = parseCafe24Raw(item);
    return raw && typeof raw === 'object' && Object.keys(raw).length ? raw : item;
  };
  if (factory.product.confirmedDb && Object.keys(factory.product.confirmedDb || {}).length) {
    if (factoryLooksLikeAiAnalysisObject(factory.product.confirmedDb)) {
      const dbOnly = factory.product.confirmedDb.db_match || factory.product.confirmedDb.sinhwa_match || factory.product.confirmedDb.db_product || factory.product.confirmedDb.matched_product;
      if (dbOnly && typeof dbOnly === 'object') addSource({ label: '신화사DB 확정', type: 'sinhwa', data: dbOnly });
    } else {
      addSource({ label: '신화사DB 확정', type: 'sinhwa', data: factory.product.confirmedDb });
    }
  }
  (factory.product.dbCandidates || state.dbMatchCandidates || analysis.db_candidates || []).slice(0, 12).forEach((item, index) => {
    if (item && typeof item === 'object') addSource({ label: `신화사DB 후보 ${index + 1}`, type: 'sinhwa', data: item });
  });
  const cafe24Candidates = (factory.product.cafe24Candidates || analysis.cafe24_candidates || []).filter(item => item && typeof item === 'object');
  if (includeAllCafe24Candidates) {
    cafe24Candidates.slice(0, 24).forEach((item, index) => addSource({ label: `Cafe24 후보 ${index + 1}`, type: 'cafe24', data: cafe24SourceData(item) }));
  } else {
    const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply }) ||
      (factory.product.candidateAutoApply ? cafe24Candidates[0] : null);
    if (target) addSource({ label: 'Cafe24 API 상품', type: 'cafe24', data: cafe24SourceData(target) });
  }
  if (includeAnalysis && analysis && Object.keys(analysis || {}).length) addSource({ label: 'AI 분석', type: 'analysis', data: analysis });
  if (includeManual && state.productInfoManualValues && Object.keys(state.productInfoManualValues || {}).length) {
    addSource({ label: '직접 입력 정보', type: 'manual', data: state.productInfoManualValues });
  }
  return sources;
}

function factoryDbSourceRows(factory = factoryRuntimeReadFactory(), options = {}) {
  const rows = [];
  factoryDbSourceObjects(factory, options).forEach(source => {
    factoryFlattenDbRows(source.data, source.label, source.type, '', rows, 0);
  });
  return rows.map((row, index) => ({ ...row, id: `raw_${index}` }));
}

function factoryUniqueSourceValues(rows, fieldId) {
  const values = [];
  const seen = new Set();
  factoryRowsForDbSourceUse(rows).filter(row => row.fieldId === fieldId).forEach(row => {
    const key = factoryDbNormalizeKey(`${row.sourceLabel}:${row.value}`);
    if (!row.value || seen.has(key)) return;
    seen.add(key);
    values.push(row);
  });
  return values;
}

function factorySourceRowsValueByAliases(rows, aliases = []) {
  const normalizedAliases = aliases.map(factoryDbNormalizeKey).filter(Boolean);
  const rowKeyParts = row => String(row.key || '').split(/[.[\]]+/).filter(Boolean).map(factoryDbNormalizeKey);
  let row = rows.find(item => {
    const parts = rowKeyParts(item);
    return normalizedAliases.some(alias => parts.some(part => part === alias));
  });
  if (!row) {
    row = rows.find(item => {
      const key = factoryDbNormalizeKey(item.key);
      return normalizedAliases.some(alias => alias.length >= 3 && (key.endsWith(alias) || key.includes(alias)));
    });
  }
  return row?.value || '';
}

function factoryCafe24AdditionalInfoValue(raw = {}, labels = []) {
  const rows = Array.isArray(raw.additional_information) ? raw.additional_information : [];
  const wanted = labels.map(factoryDbNormalizeKey).filter(Boolean);
  for (const row of rows) {
    const name = factoryDbNormalizeKey(row?.name || row?.key || '');
    if (!name || !wanted.some(label => name.includes(label) || label.includes(name))) continue;
    const value = String(row?.value ?? '').trim();
    if (value) return value;
  }
  return '';
}

function factoryCafe24DbFieldValue(fieldId, factory = factoryRuntimeReadFactory()) {
  const raw = factoryCafe24RawForForm(factory);
  if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) return '';
  const optionGroups = factoryExtractCafe24OptionGroups(raw, 'Cafe24 API 상품', 'cafe24');
  const optionValues = factoryDedupeRealOptionValues(optionGroups.flatMap(group => group.values || []), { allowNumeric: true });
  const firstOption = optionGroups[0] || null;
  const first = (...values) => values.map(value => {
    if (Array.isArray(value)) return value.filter(v => String(v ?? '').trim()).join(', ');
    if (value && typeof value === 'object') return '';
    return String(value ?? '').trim();
  }).find(Boolean) || '';
  const variantQuantity = (() => {
    const variants = Array.isArray(raw.variants) ? raw.variants : [];
    if (!variants.length) return '';
    const sum = variants.reduce((total, item) => {
      const qty = Number(String(item?.quantity ?? '').replace(/,/g, ''));
      return Number.isFinite(qty) ? total + qty : total;
    }, 0);
    return Number.isFinite(sum) ? String(sum) : '';
  })();
  const realSize = first(
    factoryCafe24AdditionalInfoValue(raw, ['사이즈', '규격', '크기']),
    raw.product_size,
    raw.size,
    raw.dimensions,
    raw.dimension
  );
  const map = {
    product_name: first(raw.product_name),
    cafe24_product_no: first(raw.product_no),
    product_code: first(raw.product_code, raw.custom_product_code),
    option_count: optionValues.length ? String(optionValues.length) : '',
    option_name: first(firstOption?.label, raw.option_name),
    option_values: optionValues.join(', '),
    size: realSize,
    sale_price: first(raw.price),
    consumer_price: first(raw.retail_price),
    purchase_price: first(raw.supply_price),
    stock: variantQuantity,
    material: first(raw.product_material, factoryCafe24AdditionalInfoValue(raw, ['소재', '재질'])),
    weight: first(raw.product_weight),
    brand: first(raw.brand_code),
    supplier: first(raw.supplier_code),
    manufacturer: first(raw.manufacturer_code),
    origin: first(raw.made_in_code, raw.origin_place_value),
    tax_type: first(raw.tax_type),
    purchase_limit: first(raw.buy_limit_by_product),
    single_purchase: first(raw.single_purchase),
    purchase_unit: first(raw.buy_unit),
    min_order_quantity: first(raw.minimum_quantity),
    max_order_quantity: first(raw.maximum_quantity),
    points: first(raw.points_by_product, raw.points_amount),
    search_keywords: Array.isArray(raw.product_tag) ? raw.product_tag.join(', ') : first(raw.product_tag),
    shipping_fee_type: first(raw.shipping_fee_type),
    display_status: first(raw.display),
    selling_status: first(raw.selling),
    mall_product_name_ko: first(raw.product_name),
    product_name_en: first(raw.eng_product_name),
    admin_product_name: first(raw.internal_product_name),
    supplier_product_name: first(raw.supply_product_name),
    model_name: first(raw.model_name),
    product_status: first(raw.product_condition),
    summary_description: first(raw.summary_description),
    simple_description: first(raw.simple_description),
    additional_description: factoryCafe24AdditionalInformationPayload(raw.additional_information).map(item => `${item.name}: ${item.value}`).filter(Boolean).join('\n'),
    hscode: first(raw.hscode),
    classification_code: first(raw.classification_code),
    adult_certification: first(raw.adult_certification),
    display_group: raw.main ? factoryCafe24JsonText(raw.main) : '',
    main_image: first(raw.detail_image, raw.list_image, raw.small_image, raw.tiny_image),
    additional_images: Array.isArray(raw.additional_image) ? raw.additional_image.join(', ') : '',
    detail_html_pc: first(raw.description),
    detail_html_mobile: first(raw.mobile_description),
    option_enabled: first(raw.has_option),
    option_display_type: first(raw.option_list_type, raw.option_type),
    variant_stock: variantQuantity,
    inventory_tracking: Array.isArray(raw.variants) && raw.variants.some(item => String(item?.use_inventory || '').trim() === 'T') ? 'T' : '',
    safety_stock: Array.isArray(raw.variants) ? first(...raw.variants.map(item => item?.safety_inventory)) : '',
    price_excluding_tax: first(raw.price_excluding_tax),
    payment_info: first(raw.payment_info),
    shipping_method: first(raw.shipping_method),
    shipping_area: first(raw.shipping_area),
    shipping_period: first(raw.shipping_period),
    shipping_fee: first(raw.shipping_fee),
    shipping_weight: first(raw.product_weight),
    return_exchange_info: first(raw.exchange_info),
    refund_info: first(raw.exchange_info),
    service_info: first(raw.service_info),
    icon_setting: Array.isArray(raw.icon) ? raw.icon.join(', ') : first(raw.icon),
    memo: first(raw.memo, raw.admin_memo),
  };
  return map[fieldId] || '';
}

function factoryDeriveSizeValue(rows) {
  const sizeRows = rows.filter(row => !/size_?guide|사이즈\s*가이드/i.test(String(row.key || '')));
  const direct = factorySourceRowsValueByAliases(sizeRows, ['size','dimensions','dimension','spec','specification','규격','크기','사이즈']);
  if (direct) return direct;
  const labels = [
    ['가로', ['width','가로','폭','너비']],
    ['세로', ['height','세로','길이']],
    ['높이', ['depth','height_depth','높이','두께']],
    ['길이', ['length','길이']],
  ];
  const parts = [];
  labels.forEach(([label, aliases]) => {
    const value = factorySourceRowsValueByAliases(sizeRows, aliases);
    if (value) parts.push(`${label}: ${value}`);
  });
  return parts.join(' / ');
}

function factoryExtractOptionGroups(factory = factoryRuntimeReadFactory(), options = {}) {
  const groups = [];
  const seen = new Set();
  factoryDbSourceObjects(factory, { types: options.types, includeManual: options.includeManual !== false }).forEach(source => {
    const sourceGroups = source.type === 'cafe24'
      ? factoryExtractCafe24OptionGroups(source.data, source.label, source.type)
      : factoryExtractOptionGroupsFromData(source.data, source.label, source.type);
    sourceGroups.forEach(group => {
      const values = source.type === 'cafe24' ? factoryDedupeRealOptionValues(group.values, { allowNumeric: true }) : factoryDedupeOptionValues(group.values);
      if (!values.length) return;
      const key = `${source.type}:${group.label}:${values.join('|')}`;
      if (seen.has(key)) return;
      seen.add(key);
      groups.push({ ...group, values });
    });
  });
  return groups.filter((group, index) => {
    const valueSet = new Set(group.values.map(factoryDbNormalizeKey));
    return !groups.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (other.sourceLabel !== group.sourceLabel || other.sourceType !== group.sourceType) return false;
      if (other.values.length <= group.values.length) return false;
      const otherSet = new Set(other.values.map(factoryDbNormalizeKey));
      return [...valueSet].every(value => otherSet.has(value));
    });
  });
}

function factoryOptionValuesFromRows(rows, factory = factoryRuntimeReadFactory()) {
  const cafe24Groups = factoryExtractOptionGroups(factory, { types: ['cafe24'], includeManual: false });
  const cafe24Values = factoryDedupeRealOptionValues(cafe24Groups.flatMap(group => group.values || []), { allowNumeric: true });
  if (cafe24Values.length) return cafe24Values.slice(0, 120);
  const rowValues = rows
    .filter(row => row.sourceType !== 'cafe24' && (factoryIsOptionKey(row.key) || row.fieldId === 'option_values'))
    .flatMap(row => factoryExtractOptionValuesFromValue(row.value, row.key));
  const sourceTypes = [...new Set(rows.map(row => row.sourceType).filter(Boolean))];
  const groups = factoryExtractOptionGroups(factory, { types: sourceTypes.length ? sourceTypes : undefined });
  return factoryDedupeRealOptionValues([...rowValues, ...groups.flatMap(group => group.values)], { allowNumeric: true }).slice(0, 120);
}

function factoryDeriveDbFieldValue(fieldId, rows, factory = factoryRuntimeReadFactory()) {
  if (fieldId === 'option_values') {
    const values = factoryOptionValuesFromRows(rows, factory);
    return values.join(', ');
  }
  if (fieldId === 'option_count') {
    const optionValues = factoryDeriveDbFieldValue('option_values', rows, factory);
    const count = optionValues ? factoryDedupeRealOptionValues(factorySplitOptionText(optionValues), { allowNumeric: true }).length : 0;
    return count ? String(count) : '';
  }
  if (fieldId === 'size') {
    return factoryDeriveSizeValue(rows) || factoryCafe24DbFieldValue(fieldId, factory);
  }
  const cafe24Value = factoryCafe24DbFieldValue(fieldId, factory);
  if (cafe24Value) return cafe24Value;
  const direct = factoryUniqueSourceValues(rows, fieldId)[0]?.value || '';
  if (direct) return direct;
  const def = factoryDbFieldDef(fieldId);
  const aliasValue = factorySourceRowsValueByAliases(rows, [fieldId, ...(def?.aliases || [])]);
  if (aliasValue) return aliasValue;
  if (fieldId === 'product_name') return factory.product.confirmedDb?.product_name || factory.product.confirmedDb?.jname || factory.product.productName || state.productName || '';
  return '';
}
