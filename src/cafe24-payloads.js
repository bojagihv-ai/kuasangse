function factoryCafe24CandidateKey(candidate) {
  const raw = parseCafe24Raw(candidate);
  return String(candidate?.product_no || raw.product_no || candidate?.product_code || raw.product_code || candidate?.product_name || raw.product_name || '').trim();
}

function factoryCafe24CurrentProductKey(factory = factoryRuntimeReadFactory()) {
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  return target ? factoryCafe24CandidateKey(target) : '';
}

function factoryCafe24DraftMatchesCurrentProduct(factory = factoryRuntimeReadFactory()) {
  const currentKey = factoryCafe24CurrentProductKey(factory);
  if (!currentKey) return true;
  const draftKey = String(factory.product.cafe24DraftProductKey || '').trim();
  return !!draftKey && draftKey === currentKey;
}

const FACTORY_CAFE24_PRODUCT_SCOPED_OPTION_FIELDS = new Set([
  'option_name',
  'option_values',
  'option_count',
  'has_option',
  'option_type',
  'option_list_type',
  'select_one_by_option',
]);

function factoryIgnoreStaleCafe24OptionManual(factory = factoryRuntimeReadFactory(), fieldId = '') {
  return FACTORY_CAFE24_PRODUCT_SCOPED_OPTION_FIELDS.has(fieldId) && !factoryCafe24DraftMatchesCurrentProduct(factory);
}

function factoryResetCafe24DraftsForProduct(factory, productKey = '') {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const currentKey = String(productKey || factoryCafe24CurrentProductKey(factory) || '').trim();
  if (!currentKey) return;
  if (factory.product.cafe24DraftProductKey === currentKey) return;
  factory.product.cafe24DraftProductKey = currentKey;
  factory.product.cafe24OptionGroupsDraft = [];
  factory.product.cafe24OptionExtrasDraft = {};
  factory.product.cafe24VariantEdits = {};
  factory.product.cafe24RelationDraft = {};
  factory.product.cafe24MemoDraft = {};
  factory.product.cafe24MainDraft = {};
  factory.product.cafe24PromotionDraft = {};
  factory.product.cafe24SeoDraft = {};
  factory.product.cafe24TagsDraft = {};
  ['option_name', 'option_values', 'option_count', 'has_option', 'option_type', 'option_list_type', 'select_one_by_option'].forEach(fieldId => {
    if (factory.product.dbFieldSettings?.[fieldId]?.manualTouched) {
      const { [fieldId]: _removedField, ...remainingFieldSettings } = factory.product.dbFieldSettings;
      factory.product.dbFieldSettings = remainingFieldSettings;
    }
  });
}

function factoryHasCafe24OptionPayload(raw = {}) {
  if (!raw || typeof raw !== 'object') return false;
  const optionRoot = raw.options || raw.product_options || raw.option;
  if (optionRoot && typeof optionRoot === 'object') {
    if (Array.isArray(optionRoot) && optionRoot.length) return true;
    if (Array.isArray(optionRoot.options) && optionRoot.options.length) return true;
    if (Array.isArray(optionRoot.option) && optionRoot.option.length) return true;
    if (optionRoot.option_value || optionRoot.optionValue || optionRoot.option_name || optionRoot.optionName) return true;
  }
  return Array.isArray(raw.variants) && raw.variants.some(variant => Array.isArray(variant?.options) && variant.options.length);
}

function factoryCafe24OfficialOptionGroups(raw = {}) {
  if (!raw || typeof raw !== 'object') return [];
  const direct = Array.isArray(raw.options) ? raw.options : [];
  const wrapped = Array.isArray(raw.option?.options) ? raw.option.options : [];
  const productWrapped = Array.isArray(raw.product_options?.options) ? raw.product_options.options : [];
  const groups = [...wrapped, ...productWrapped, ...direct].filter(group =>
    group &&
    typeof group === 'object' &&
    (group.option_name || group.optionName || group.name) &&
    (Array.isArray(group.option_value) || Array.isArray(group.optionValue) || Array.isArray(group.values))
  );
  const seen = new Set();
  return groups.filter(group => {
    const label = factoryCleanOptionLabel(group.option_name || group.optionName || group.name || '옵션');
    const values = factoryExtractCafe24OptionGroupValues(group);
    const key = `${factoryDbNormalizeKey(label)}:${values.map(factoryDbNormalizeKey).join('|')}`;
    if (!label || !values.length || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function factoryHasCafe24OfficialOptions(raw = {}) {
  return factoryCafe24OfficialOptionGroups(raw).length > 0;
}

function factoryMergeCafe24CandidateData(current, incoming) {
  const currentRaw = parseCafe24Raw(current) || {};
  const incomingRaw = parseCafe24Raw(incoming) || {};
  const mergedRaw = { ...incomingRaw, ...currentRaw };
  if (factoryHasCafe24OfficialOptions(incomingRaw)) {
    if (incomingRaw.option) mergedRaw.option = incomingRaw.option;
    const officialGroups = factoryCafe24OfficialOptionGroups(incomingRaw);
    if (officialGroups.length) mergedRaw.options = officialGroups;
    if (incomingRaw.has_option !== undefined) mergedRaw.has_option = incomingRaw.has_option;
    if (incomingRaw.option_type !== undefined) mergedRaw.option_type = incomingRaw.option_type;
    if (incomingRaw.option_list_type !== undefined) mergedRaw.option_list_type = incomingRaw.option_list_type;
    if (incomingRaw.select_one_by_option !== undefined) mergedRaw.select_one_by_option = incomingRaw.select_one_by_option;
  }
  if (Array.isArray(incomingRaw.variants) && incomingRaw.variants.length) mergedRaw.variants = incomingRaw.variants;
  ['options', 'product_options', 'option', 'variants'].forEach(key => {
    if (!factoryHasCafe24OptionPayload({ [key]: mergedRaw[key] }) && factoryHasCafe24OptionPayload({ [key]: incomingRaw[key] })) {
      mergedRaw[key] = incomingRaw[key];
    }
  });
  if (!factoryHasCafe24OptionPayload(mergedRaw) && factoryHasCafe24OptionPayload(incomingRaw)) {
    if (incomingRaw.options !== undefined) mergedRaw.options = incomingRaw.options;
    if (incomingRaw.variants !== undefined) mergedRaw.variants = incomingRaw.variants;
  }
  return {
    ...incoming,
    ...current,
    product_no: current?.product_no || incoming?.product_no || mergedRaw.product_no || '',
    product_code: current?.product_code || incoming?.product_code || mergedRaw.product_code || '',
    product_name: current?.product_name || incoming?.product_name || mergedRaw.product_name || '',
    raw: mergedRaw,
    rawProduct: { ...(incoming?.rawProduct || {}), ...(current?.rawProduct || {}), ...mergedRaw },
  };
}

function factoryMergeCafe24Candidates(existing = [], incoming = []) {
  const out = [];
  const indexByKey = new Map();
  [...incoming, ...existing].forEach(candidate => {
    if (!candidate || typeof candidate !== 'object') return;
    const key = factoryCafe24CandidateKey(candidate) || JSON.stringify(candidate).slice(0, 80);
    if (indexByKey.has(key)) {
      const index = indexByKey.get(key);
      out[index] = factoryMergeCafe24CandidateData(out[index], candidate);
      return;
    }
    indexByKey.set(key, out.length);
    out.push(candidate);
  });
  return out.slice(0, 80);
}

function factoryCafe24TargetCandidate(factory = factoryRuntimeReadFactory(), options = {}) {
  const allowFallback = options.allowFallback !== false;
  const finalDb = factory.product.finalDb || {};
  const candidates = factory.product.cafe24Candidates || [];
  const selectedKey = factory.product.selectedCafe24CandidateKey || factory.product.confirmedCafe24ProductKey || '';
  const selected = selectedKey ? candidates.find(candidate => {
    const raw = parseCafe24Raw(candidate);
    const keys = [
      factoryCafe24CandidateKey(candidate),
      cafe24ProductKey(candidate),
      candidate?.product_no,
      raw.product_no,
      candidate?.product_code,
      raw.product_code,
    ].map(value => String(value || '').trim()).filter(Boolean);
    return keys.includes(String(selectedKey).trim());
  }) : null;
  if (options.preferSelected === true && selected) return selected;
  const targetNo = finalDb.product_no || finalDb.cafe24_product_no || factory.product.confirmedDb?.product_no || factory.product.confirmedDb?.cafe24_product_no || '';
  if (targetNo) {
    const found = candidates.find(candidate => String(candidate.product_no || parseCafe24Raw(candidate).product_no || '') === String(targetNo));
    if (found) return found;
    return {
      product_no: String(targetNo).trim(),
      product_code: finalDb.product_code || finalDb.cafe24_product_code || '',
      product_name: (typeof factoryAuthoritativeProductName === 'function'
        ? factoryAuthoritativeProductName(factory, [finalDb.product_name, finalDb.cafe24_product_name, factory.product.productName, state.productName])
        : String(finalDb.product_name || finalDb.cafe24_product_name || factory.product.productName || state.productName || '').trim()),
      mall_id: finalDb.mall_id || CAFE24_CONTROL_API.defaultMallId,
      source: 'current-final-db',
      raw: {
        product_no: String(targetNo).trim(),
        product_code: finalDb.product_code || finalDb.cafe24_product_code || '',
        product_name: finalDb.product_name || finalDb.cafe24_product_name || factory.product.productName || state.productName || '',
        mall_id: finalDb.mall_id || CAFE24_CONTROL_API.defaultMallId,
      },
    };
  }
  if (selected) return selected;
  if (!allowFallback) return null;
  return candidates.find(candidate => candidate?.product_no || parseCafe24Raw(candidate).product_no) || null;
}

function factoryCafe24QueryTerms(factory = factoryRuntimeReadFactory()) {
  const finalDb = factory.product.finalDb || {};
  const confirmed = factory.product.confirmedDb || {};
  const candidates = factory.product.cafe24Candidates || [];
  const directName = factory.product.productName || state.productName || '';
  const terms = [
    directName,
    confirmed.product_code,
    confirmed.product_name,
    confirmed.jcode,
    ...candidates.slice(0, 3).flatMap(candidate => [candidate.product_code, candidate.product_name, parseCafe24Raw(candidate).product_code, parseCafe24Raw(candidate).product_name]),
    finalDb.product_code,
    finalDb.product_name,
    finalDb.mall_product_name_ko,
  ].map(value => String(value || '').trim()).filter(Boolean);
  return [...new Set(terms)].slice(0, 8);
}

async function factoryRefreshCafe24ApiSources(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-api-sources',
      'cafe24',
      draft => factoryRefreshCafe24ApiSources({
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
  factoryUpdateFromInputs(factory);
  factory.product.cafe24ApiStatus = 'Cafe24 상품정보를 조회하는 중입니다.';
  factoryLog('Cafe24 상품정보 새로고침 시작: 후보 검색 + 선택 상품 상세 확인', 'ok', factory);
  try {
    const [catalog, ...queryResults] = await Promise.all([
      fetchCafe24ApiCatalog().catch(e => {
        factoryLog(`Cafe24 선택목록 조회 보류: ${e.message || e}`, 'error', factory);
        return [];
      }),
      ...factoryCafe24QueryTerms(factory).map(term => fetchCafe24ProductsByQuery(term, 80)
        .then(rows => rows.map((row, index) => normalizeCafe24ProductCandidate(row, term, 0, index)))
        .catch(e => {
          factoryLog(`Cafe24 products 조회 실패 (${term}): ${e.message || e}`, 'error', factory);
          return [];
        })),
    ]);
    let incoming = queryResults.flat();
    const existingTarget = factoryCafe24TargetCandidate(factory, { allowFallback: false });
    const productNos = [...new Set([
      existingTarget?.product_no,
      ...incoming.slice(0, 3).map(candidate => candidate.product_no),
    ].filter(Boolean))].slice(0, 4);
    const detailRows = [];
    for (const productNo of productNos) {
      try {
        const detail = await fetchCafe24ProductFullByNo(productNo, existingTarget?.mall_id || CAFE24_CONTROL_API.defaultMallId);
        if (detail) detailRows.push(normalizeCafe24ProductCandidate(detail, `product_no:${productNo}`, 999, 0));
      } catch(e) {
        factoryLog(`Cafe24 상세 조회 실패 #${productNo}: ${e.message || e}`, 'error', factory);
      }
    }
    incoming = [...detailRows, ...incoming];
    const current = factory;
    current.product.cafe24ApiCatalog = catalog;
    current.product.cafe24ApiLastFetchedAt = Date.now();
    current.product.cafe24Candidates = factoryMergeCafe24Candidates(current.product.cafe24Candidates, incoming);
    const refreshedVariantCatalog = incoming
      .flatMap(candidate => {
        const raw = parseCafe24Raw(candidate) || {};
        return [raw.variants, candidate?.variants];
      })
      .find(variants => Array.isArray(variants) && variants.length > 1) || [];
    if (refreshedVariantCatalog.length) {
      current.product.cafe24VariantCatalog = refreshedVariantCatalog;
      current.product.cafe24VariantCatalogProductNo = String(existingTarget?.product_no || '').trim();
    }
    const selectedTarget = factoryCafe24TargetCandidate(current, { allowFallback: current.product.candidateAutoApply });
    const healthProductNo = selectedTarget?.product_no || parseCafe24Raw(selectedTarget).product_no || productNos[0] || '';
    if (healthProductNo) {
      try {
        current.product.cafe24EndpointHealth = await factoryProbeCafe24EndpointHealth(healthProductNo, selectedTarget?.mall_id || existingTarget?.mall_id || CAFE24_CONTROL_API.defaultMallId);
        current.product.cafe24EndpointHealthFetchedAt = Date.now();
        current.product.cafe24EndpointHealthProductNo = String(healthProductNo);
      } catch(e) {
        current.product.cafe24EndpointHealth = [{
          key: 'probe',
          label: '전용 API 상태',
          path: '',
          ok: false,
          status: '조회 실패',
          message: factoryCafe24EndpointHealthMessage(e),
          checkedAt: Date.now(),
        }];
        current.product.cafe24EndpointHealthFetchedAt = Date.now();
        current.product.cafe24EndpointHealthProductNo = String(healthProductNo);
      }
    }
    const endpointOk = (current.product.cafe24EndpointHealth || []).filter(row => row.ok && !row.warning).length;
    const endpointTotal = (current.product.cafe24EndpointHealth || []).length;
    current.product.cafe24ApiStatus = `Cafe24 상품 상세 ${incoming.length}건 반영 · 선택목록 ${catalog.length}개${endpointTotal ? ` · 전용 API ${endpointOk}/${endpointTotal} 연결` : ''}`;
    const canReflectCafe24 = !!current.product.selectedCafe24CandidateKey || !!current.product.candidateAutoApply;
    const autoEnabled = canReflectCafe24 ? factoryEnableCafe24CoreDbFields(current) : 0;
    factoryUpdateFinalDbFromFields(current);
    factoryLog(`Cafe24 상품정보 새로고침 완료: 후보 ${current.product.cafe24Candidates.length}건, 선택목록 ${catalog.length}개${autoEnabled ? `, 핵심 DB ${autoEnabled}개 자동 사용` : ''}${canReflectCafe24 ? '' : ', 후보 선택 대기'}`, 'ok', current);
    return true;
  } catch(e) {
    const current = factory;
    current.product.cafe24ApiStatus = `Cafe24 상품정보 조회 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function factoryProbeCafe24EndpointHealthFromCurrent(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:probe-endpoint-health',
      'cafe24',
      draft => factoryProbeCafe24EndpointHealthFromCurrent({
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
  factoryUpdateFromInputs(factory);
  const { target, raw, productNo, mallId } = factoryCafe24TargetInfo(factory);
  const resolvedProductNo = productNo || target?.product_no || raw?.product_no || factory.product.finalDb?.product_no || factory.product.finalDb?.cafe24_product_no || '';
  if (!resolvedProductNo) {
    factory.product.cafe24EndpointHealth = factoryCafe24EndpointProbeDefinitions('').map(row => ({
      ...row,
      ok: false,
      pending: true,
      status: '대기',
      message: 'Cafe24 상품 후보를 먼저 확정해야 합니다.',
      checkedAt: Date.now(),
    }));
    factory.product.cafe24EndpointHealthFetchedAt = Date.now();
    factory.product.cafe24EndpointHealthProductNo = '';
    factory.product.cafe24ApiStatus = '전용 API 상태 점검 대기: Cafe24 상품번호가 없습니다.';
    return false;
  }
  factory.product.cafe24ApiStatus = `전용 API 상태 점검 중: 상품 #${resolvedProductNo}`;
  try {
    const rows = await factoryProbeCafe24EndpointHealth(resolvedProductNo, mallId || CAFE24_CONTROL_API.defaultMallId);
    const current = factory;
    current.product.cafe24EndpointHealth = rows;
    current.product.cafe24EndpointHealthFetchedAt = Date.now();
    current.product.cafe24EndpointHealthProductNo = String(resolvedProductNo);
    const okCount = rows.filter(row => row.ok && !row.warning).length;
    current.product.cafe24ApiStatus = `전용 API 상태 점검 완료: ${okCount}/${rows.length} 연결`;
    factoryLog(current.product.cafe24ApiStatus, okCount === rows.length ? 'ok' : 'error', current);
    return true;
  } catch(e) {
    const current = factory;
    current.product.cafe24EndpointHealth = [{
      key: 'probe',
      label: '전용 API 상태',
      path: '',
      ok: false,
      status: '조회 실패',
      message: factoryCafe24EndpointHealthMessage(e),
      checkedAt: Date.now(),
    }];
    current.product.cafe24EndpointHealthFetchedAt = Date.now();
    current.product.cafe24EndpointHealthProductNo = String(resolvedProductNo);
    current.product.cafe24ApiStatus = `전용 API 상태 점검 실패: ${e.message || e}`;
    factoryLog(current.product.cafe24ApiStatus, 'error', current);
    return false;
  }
}

async function fetchCafe24ReferenceList(type, path, keys = []) {
  const limitMatch = /[?&]limit=(\d+)/i.exec(path);
  const limit = limitMatch ? Math.max(1, Math.min(100, Number.parseInt(limitMatch[1], 10) || 100)) : 0;
  const shouldPage = limit > 0 && /\/api\/v2\/admin\/(?:categories|manufacturers|suppliers|brands|classifications)/i.test(path);
  const allRows = [];
  const seenPageSignatures = new Set();
  const buildPagePath = offset => {
    if (!shouldPage) return path;
    const url = new URL(path, 'http://local.test');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    return `${url.pathname}${url.search}`;
  };
  const maxPages = shouldPage ? 20 : 1;
  for (let page = 0; page < maxPages; page += 1) {
    const offset = shouldPage ? page * limit : 0;
    const pagePath = buildPagePath(offset);
    const body = await callCafe24Console('GET', pagePath, { mallId: CAFE24_CONTROL_API.defaultMallId }, `Read Cafe24 ${type}${shouldPage ? ` page ${page + 1}` : ''}`);
    const rows = factoryCafe24ReferenceRowsFromBody(body, keys);
    const signature = rows.map(row => JSON.stringify(row)).join('|');
    if (!rows.length || seenPageSignatures.has(signature)) break;
    seenPageSignatures.add(signature);
    allRows.push(...rows);
    if (!shouldPage || rows.length < limit) break;
  }
  return factoryCafe24DedupeReferenceList(allRows, type);
}

async function factoryRefreshCafe24ReferenceLists(options = {}) {
  if (!options.factory) {
    const receipt = await factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-reference-lists',
      'cafe24',
      draft => factoryRefreshCafe24ReferenceLists({
        ...options,
        factory: draft,
        render: false,
      }),
    );
    saveLastWorkNow({ sync: false });
    if (options.render !== false && !factoryIdentityInputFocused()) render();
    return receipt.result;
  }
  const factory = options.factory;
  factory.product.cafe24ReferenceStatus = 'Cafe24 선택 목록을 불러오는 중입니다.';
  factoryLog('Cafe24 선택 목록 불러오기 시작: 카테고리/제조사/공급사/브랜드/배송', 'ok', factory);
  const jobs = [
    ['categories', '/api/v2/admin/categories?limit=100', ['categories', 'category']],
    ['manufacturers', '/api/v2/admin/manufacturers?limit=100', ['manufacturers', 'manufacturer']],
    ['suppliers', '/api/v2/admin/suppliers?limit=100', ['suppliers', 'supplier']],
    ['brands', '/api/v2/admin/brands?limit=100', ['brands', 'brand']],
    ['classifications', '/api/v2/admin/classifications?limit=100', ['classifications', 'classification']],
    ['trends', '/api/v2/admin/trends?limit=100', ['trends', 'trend']],
    ['shippingMethods', '/api/v2/admin/shipping', ['shipping', 'shipping_methods', 'shippingMethods']],
    ['shippingOrigins', '/api/v2/admin/shippingorigins', ['shippingorigins', 'shipping_origins', 'shippingOrigins']],
  ];
  const results = await Promise.allSettled(jobs.map(([type, path, keys]) => fetchCafe24ReferenceList(type, path, keys)));
  const current = factory;
  const lists = { ...(current.product.cafe24ReferenceLists || {}) };
  const messages = [];
  const failureLogs = [];
  results.forEach((result, index) => {
    const [type] = jobs[index];
    if (result.status === 'fulfilled') {
      lists[type] = result.value;
      messages.push(`${type} ${result.value.length}개`);
    } else {
      messages.push(`${type} 실패`);
      failureLogs.push(`Cafe24 ${type} 목록 조회 실패: ${result.reason?.message || result.reason}`);
    }
  });
  current.product.cafe24ReferenceLists = lists;
  current.product.cafe24ReferenceFetchedAt = Date.now();
  current.product.cafe24ReferenceStatus = `선택 목록 갱신: ${messages.join(' · ')}`;
  failureLogs.forEach(message => factoryLog(message, 'error', current));
  factoryLog(current.product.cafe24ReferenceStatus, 'ok', current);
  return lists;
}

function factoryTruthyCafe24Flag(value) {
  const raw = String(value || '').trim();
  if (/^(T|F|Y|N)$/i.test(raw)) return raw.toUpperCase().replace('Y', 'T').replace('N', 'F');
  if (/미진열|진열안함|미판매|판매안함|미사용|사용안함|공통사용|제한없음|기본설정|품절.*(아님|안\s*함|안함)|false|no/i.test(raw)) return 'F';
  if (/진열|판매|사용|제한함|개별설정|품절\s*(표시|처리)?|true|yes/i.test(raw)) return 'T';
  return '';
}

const CAFE24_PRODUCT_UPDATE_FIELD_ALLOWLIST = new Set([
  'product_name',
  'eng_product_name',
  'internal_product_name',
  'supply_product_name',
  'model_name',
  'custom_product_code',
  'display',
  'selling',
  'summary_description',
  'simple_description',
  'description',
  'mobile_description',
  'translated_description',
  'translated_additional_description',
  'additional_information',
  'price',
  'retail_price',
  'supply_price',
  'additional_price',
  'tax_type',
  'tax_rate',
  'tax_calculation',
  'product_condition',
  'price_content',
  'hscode',
  'country_hscode',
  'product_weight',
  'product_volume',
  'product_used_month',
  'product_material',
  'english_product_material',
  'cloth_fabric',
  'made_in_code',
  'origin_classification',
  'origin_place_value',
  'origin_place_code',
  'origin_place_no',
  'clearance_category_code',
  'clearance_category_eng',
  'clearance_category_kor',
  'classification_code',
  'adult_certification',
  'set_product_type',
  'payment_info',
  'payment_info_by_product',
  'shipping_info',
  'shipping_info_by_product',
  'product_shipping_type',
  'shipping_method',
  'shipping_area',
  'shipping_period',
  'shipping_fee_type',
  'shipping_fee',
  'shipping_fee_by_product',
  'shipping_rates',
  'shipping_scope',
  'shipping_calculation',
  'shipping_area_name',
  'shipping_place_code',
  'prepaid_shipping_fee',
  'exchange_info',
  'exchange_info_by_product',
  'service_info',
  'service_info_by_product',
  'detail_image',
  'list_image',
  'tiny_image',
  'small_image',
  'image_upload_type',
  'separated_mobile_description',
  'manufacturer_code',
  'supplier_code',
  'brand_code',
  'trend_code',
  'made_date',
  'release_date',
  'expiration_date',
  'sold_out',
  'exposure_limit_type',
  'soldout_message',
  'promotion_period',
  'buy_limit_by_product',
  'buy_limit_type',
  'buy_group_list',
  'buy_member_id_list',
  'repurchase_restriction',
  'single_purchase_restriction',
  'single_purchase',
  'buy_unit_type',
  'buy_unit',
  'order_quantity_limit_type',
  'minimum_quantity',
  'maximum_quantity',
  'points_by_product',
  'points_amount',
  'points_setting_by_payment',
  'except_member_points',
  'adult_certification',
  'naverpay_type',
  'kakaopay_type',
  'use_naverpay',
  'use_kakaopay',
  'market_sync',
  'exposure_group_list',
  'soldout_message',
  'promotion_period',
  'size_guide',
]);

const CAFE24_PRODUCT_UPDATE_FIELD_BLOCKLIST = new Set([
  'product_no',
  'product_code',
  'shop_no',
  'mall_id',
  'approve_status',
  'project_no',
  'main',
  'relational_product',
  'variant_code',
  'has_option',
  'option_type',
  'option_list_type',
  'select_one_by_option',
  'variants',
  'options',
  'option',
  'option_value',
  'option_values',
  'option_count',
  'product_tag',
  'product_tags',
  'tags',
  'created_date',
  'updated_date',
  'modified_date',
  'deleted',
  'hits',
  'like_count',
  'reviews_count',
  'seo',
  'detail_image',
  'list_image',
  'list_icon',
  'tiny_image',
  'small_image',
  'image_upload_type',
  'icon',
  'icon_show_period',
]);

const CAFE24_PRODUCT_UPDATE_FIELD_MAP = new Map([...CAFE24_PRODUCT_UPDATE_FIELD_ALLOWLIST].flatMap(field => [
  [field, field],
  [factoryDbNormalizeKey(field), field],
]));

const CAFE24_PRODUCT_UPDATE_BLOCK_NORMALIZED = new Set([...CAFE24_PRODUCT_UPDATE_FIELD_BLOCKLIST].flatMap(field => [
  field,
  factoryDbNormalizeKey(field),
]));

function factoryCafe24CanonicalUpdateField(value) {
  const raw = String(value || '').trim().replace(/^product\./i, '').split('.').pop().toLowerCase();
  if (!raw) return '';
  const normalized = factoryDbNormalizeKey(raw);
  if (CAFE24_PRODUCT_UPDATE_BLOCK_NORMALIZED.has(raw) || CAFE24_PRODUCT_UPDATE_BLOCK_NORMALIZED.has(normalized)) return '';
  return CAFE24_PRODUCT_UPDATE_FIELD_MAP.get(raw) || CAFE24_PRODUCT_UPDATE_FIELD_MAP.get(normalized) || '';
}

function factoryCafe24ApiFieldNameFromSource(field = {}) {
  const sourceKey = String(field.sourceKey || field.key || field.id || '').trim();
  const candidates = [
    sourceKey,
    sourceKey.replace(/^product\./, ''),
    sourceKey.split('.').pop(),
    String(field.id || '').replace(/^cafe24_/, ''),
    String(field.label || ''),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const apiField = factoryCafe24CanonicalUpdateField(candidate);
    if (apiField) return apiField;
  }
  return '';
}

function factoryCafe24FieldLabelByApiField(apiField) {
  const raw = String(apiField || '').trim();
  if (!raw) return '';
  const normalized = factoryDbNormalizeKey(raw);
  const field = factoryCafe24FormFieldsFlat().find(item => {
    return factoryDbNormalizeKey(item.apiField || '') === normalized ||
      factoryDbNormalizeKey(item.id || '') === normalized ||
      factoryDbNormalizeKey(item.dbFieldId || '') === normalized;
  });
  if (field?.label) return field.label;
  const ko = FACTORY_FIELD_KO_LABELS[raw] || FACTORY_FIELD_KO_LABELS[normalized] || '';
  return ko || raw;
}

function factoryCafe24PayloadSummary(product = {}, limit = 18) {
  return Object.keys(product || {})
    .map(key => factoryCafe24FieldLabelByApiField(key))
    .slice(0, limit)
    .join(', ');
}

function factoryCafe24HumanValue(value, limit = 90) {
  if (value === null || value === undefined) return '빈칸';
  if (Array.isArray(value)) {
    const simple = value
      .map(item => (item && typeof item === 'object') ? factoryCafe24HumanValue(item, 28) : String(item ?? '').trim())
      .filter(Boolean);
    if (!simple.length) return '빈칸';
    const text = simple.length > 4 ? `${simple.slice(0, 4).join(', ')} 외 ${simple.length - 4}개` : simple.join(', ');
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
  }
  if (typeof value === 'object') {
    const preferred = ['name','product_name','label','value','text','option_name','option_text','price'];
    const hit = preferred.map(key => value[key]).find(v => v !== undefined && v !== null && String(v).trim() !== '');
    if (hit !== undefined) return factoryCafe24HumanValue(hit, limit);
    const keys = Object.keys(value).filter(key => value[key] !== undefined && value[key] !== null);
    return keys.length ? `구조화 값 ${keys.length}개` : '빈칸';
  }
  const raw = String(value).trim();
  if (!raw) return '빈칸';
  const flag = factoryTruthyCafe24Flag(raw);
  const flagText = flag ? (flag === 'T' ? '사용함' : '사용안함') : raw;
  return flagText.length > limit ? `${flagText.slice(0, limit)}...` : flagText;
}

function factoryCafe24SaveDiffStatusLabel(status) {
  if (status === 'changed') return '변경';
  if (status === 'new') return '신규';
  return '동일';
}

function factoryCafe24SaveDiffModel(factory = factoryRuntimeReadFactory(), options = {}) {
  const dbModel = options.dbModel || factoryBuildDbReviewModel(factory);
  const product = options.product || factoryBuildCafe24UpdatePayload(dbModel.finalDb, dbModel.fields, factory, { onlyChanged: true });
  const target = factoryCafe24TargetCandidate(factory, { allowFallback: !!factory.product.candidateAutoApply });
  const raw = factoryCafe24RawForForm(factory);
  const productNo = target?.product_no || raw.product_no || dbModel.finalDb.product_no || dbModel.finalDb.cafe24_product_no || '';
  const coverage = factoryCafe24ProductFieldCoverage(factory);
  const fieldNames = Object.keys(product || {});
  const rows = fieldNames.map(apiField => {
    const current = raw?.[apiField];
    const currentComparable = factoryCafe24ComparableValue(current);
    const hasCurrent = raw && Object.prototype.hasOwnProperty.call(raw, apiField) && String(currentComparable || '').trim() !== '';
    const next = product[apiField];
    const same = hasCurrent && factoryCafe24ValuesRoughlyEqual(next, current);
    const status = same ? 'same' : (hasCurrent ? 'changed' : 'new');
    return {
      apiField,
      label: factoryCafe24FieldLabelByApiField(apiField),
      current,
      next,
      currentText: factoryCafe24HumanValue(current),
      nextText: factoryCafe24HumanValue(next),
      status,
    };
  });
  const changedRows = rows.filter(row => row.status === 'changed');
  const newRows = rows.filter(row => row.status === 'new');
  const sameRows = rows.filter(row => row.status === 'same');
  const skipped = [...new Set([
    ...factoryCafe24SkippedUpdateFields(dbModel.fields, dbModel.finalDb),
    ...coverage.buckets.dedicated.map(factoryCafe24CoverageLabel),
  ].filter(Boolean))];
  return {
    dbModel,
    product,
    target,
    raw,
    productNo,
    fieldNames,
    rows,
    changedRows,
    newRows,
    sameRows,
    skipped,
    coverage,
    counts: {
      total: fieldNames.length,
      changed: changedRows.length,
      newInput: newRows.length,
      same: sameRows.length,
      dedicated: coverage.buckets.dedicated.length,
    },
  };
}

function factoryCafe24StableComparableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'T' : 'F';
  if (Array.isArray(value)) {
    return `[${value.map(factoryCafe24StableComparableValue).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort((a, b) => a.localeCompare(b));
    return `{${keys.map(key => `${key}:${factoryCafe24StableComparableValue(value[key])}`).join(',')}}`;
  }
  const raw = String(value).trim();
  if (/^-?\d+\.0+$/.test(raw)) return String(Number(raw));
  const dateValue = factoryCafe24DateInputValue(raw);
  if (dateValue && /^\d{4}[-./년\s]*\d{1,2}[-./월\s]*\d{1,2}/.test(raw)) return dateValue;
  return raw.replace(/\s+/g, ' ');
}

function factoryCafe24ComparableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'T' : 'F';
  if (Array.isArray(value)) {
    if (value.every(item => item === null || ['string','number','boolean'].includes(typeof item))) {
      return value.map(factoryCafe24ComparableValue).filter(Boolean).join(',');
    }
    return factoryCafe24StableComparableValue(value);
  }
  if (typeof value === 'object') return factoryCafe24StableComparableValue(value);
  const raw = String(value).trim();
  if (/^-?\d+\.0+$/.test(raw)) return String(Number(raw));
  const dateValue = factoryCafe24DateInputValue(raw);
  if (dateValue && /^\d{4}[-./년\s]*\d{1,2}[-./월\s]*\d{1,2}/.test(raw)) return dateValue;
  return raw.replace(/\s+/g, ' ');
}

function factoryCafe24ValuesRoughlyEqual(expected, actual) {
  const left = factoryCafe24ComparableValue(expected);
  const right = factoryCafe24ComparableValue(actual);
  if (left === right) return true;
  if (/^-?\d+(\.\d+)?$/.test(left) && /^-?\d+(\.\d+)?$/.test(right)) return Number(left) === Number(right);
  const leftDate = factoryCafe24DateInputValue(left);
  const rightDate = factoryCafe24DateInputValue(right);
  if (leftDate && rightDate && leftDate === rightDate) return true;
  const leftFlag = factoryTruthyCafe24Flag(left);
  const rightFlag = factoryTruthyCafe24Flag(right);
  if (leftFlag && rightFlag && leftFlag === rightFlag) return true;
  if (Array.isArray(expected) && typeof actual === 'string') {
    const expectedParts = expected.map(factoryCafe24ComparableValue).filter(Boolean);
    const actualParts = actual.split(/[,;\n\r]+/).map(v => factoryCafe24ComparableValue(v)).filter(Boolean);
    return expectedParts.join(',') === actualParts.join(',') ||
      (expectedParts.length === actualParts.length && [...expectedParts].sort().join(',') === [...actualParts].sort().join(','));
  }
  return false;
}

function factoryVerifyCafe24ProductEcho(product = {}, raw = {}) {
  const fields = Object.keys(product || {});
  const missing = [];
  const mismatches = [];
  fields.forEach(key => {
    if (!raw || !Object.prototype.hasOwnProperty.call(raw, key)) {
      missing.push(factoryCafe24FieldLabelByApiField(key));
      return;
    }
    if (!factoryCafe24ValuesRoughlyEqual(product[key], raw[key])) {
      mismatches.push(factoryCafe24FieldLabelByApiField(key));
    }
  });
  return {
    checked: fields.length,
    matched: Math.max(0, fields.length - missing.length - mismatches.length),
    missing,
    mismatches,
  };
}

function factoryCafe24SaveVerificationRecord({ type = 'update', productNo = '', product = {}, verification = null, message = '', error = '', rollback = null } = {}) {
  const checked = verification?.checked ?? Object.keys(product || {}).length;
  const matched = verification?.matched ?? 0;
  const missing = Array.isArray(verification?.missing) ? verification.missing : [];
  const mismatches = Array.isArray(verification?.mismatches) ? verification.mismatches : [];
  const record = {
    type,
    productNo: String(productNo || ''),
    savedAt: Date.now(),
    checked,
    matched,
    missing,
    mismatches,
    fieldNames: Object.keys(product || {}),
    ok: !error && !missing.length && !mismatches.length && matched === checked,
    message: message || '',
    error: error || '',
  };
  if (rollback && typeof rollback === 'object' && rollback.fieldName) {
    record.rollback = {
      productNo: String(rollback.productNo || productNo || ''),
      mallId: String(rollback.mallId || ''),
      fieldName: String(rollback.fieldName || ''),
      originalValue: cloneData(rollback.originalValue),
      savedValue: cloneData(rollback.savedValue),
      hasOriginal: rollback.hasOriginal !== false,
      createdAt: rollback.createdAt || Date.now(),
    };
  }
  return record;
}

function factoryVerifyCafe24OptionEcho(plan = {}, detail = null) {
  if (!detail) return { matched: false, message: '재조회 결과 없음' };
  const raw = parseCafe24Raw(detail) || detail.raw || detail;
  const actualRoot = factoryCafe24ExistingOptionRoot(raw);
  const groups = factoryExtractCafe24OptionGroups(detail, 'Cafe24 재조회', 'cafe24');
  const expectedGroups = factoryCafe24CleanOptionGroupsForPayload(plan.optionGroups || [], plan.optionName, plan.optionValues || []);
  const expectedSettings = plan.optionUpdate?.body?.option || plan.optionUpdate?.body || {};
  const settingKeys = FACTORY_CAFE24_OPTION_SETTING_KEYS.filter(key => expectedSettings[key] !== undefined);
  const settingMismatches = settingKeys.filter(key => !factoryCafe24ValuesRoughlyEqual(expectedSettings[key], actualRoot[key]));
  const checkAdditional = expectedSettings.use_additional_option !== undefined || expectedSettings.additional_options !== undefined;
  const checkAttached = expectedSettings.use_attached_file_option !== undefined;
  const expectedAdditionalOptions = expectedSettings.additional_options !== undefined
    ? factoryCafe24AdditionalOptionsFromRoot({ additional_options: expectedSettings.additional_options })
    : [];
  const actualAdditionalOptions = factoryCafe24AdditionalOptionsFromRoot(actualRoot);
  const additionalFlagMatched = !checkAdditional || factoryCafe24ValuesRoughlyEqual(expectedSettings.use_additional_option || 'F', actualRoot.use_additional_option || 'F');
  const additionalRowsMatched = !checkAdditional || (
    expectedAdditionalOptions.length === actualAdditionalOptions.length &&
    expectedAdditionalOptions.every((row, index) => {
      const actual = actualAdditionalOptions[index] || {};
      return factoryDbNormalizeKey(row.name) === factoryDbNormalizeKey(actual.name) &&
        String(row.textLength || '') === String(actual.textLength || '') &&
        String(row.required || '') === String(actual.required || '');
    })
  );
  const attachedFlagMatched = !checkAttached || factoryCafe24ValuesRoughlyEqual(expectedSettings.use_attached_file_option || 'F', actualRoot.use_attached_file_option || 'F');
  const extrasMatched = additionalFlagMatched && additionalRowsMatched && attachedFlagMatched;
  const actualGroups = groups
    .map((group, index) => factoryNormalizeCafe24OptionGroup({
      key: group.key || `actual_${index + 1}`,
      name: group.label || group.name,
      values: group.values || [],
      required_option: group.required_option,
      option_display_type: group.option_display_type,
    }, index))
    .filter(group => group.name && group.values.length);
  const groupChecks = expectedGroups.map(expected => {
    const actual = actualGroups.find(group => factoryDbNormalizeKey(group.name) === factoryDbNormalizeKey(expected.name)) || null;
    const actualValues = factoryDedupeRealOptionValues(actual?.values || [], { allowNumeric: true });
    const expectedValues = factoryDedupeRealOptionValues(expected.values || [], { allowNumeric: true });
    const sameValues = expectedValues.length === actualValues.length && expectedValues.every((value, index) => value === actualValues[index]);
    return { expected, actual, expectedValues, actualValues, sameValues };
  });
  const matchedGroups = groupChecks.filter(item => item.actual && item.sameValues).length;
  const expectedCount = expectedGroups.reduce((sum, group) => sum + group.values.length, 0);
  const actualCount = actualGroups.reduce((sum, group) => sum + group.values.length, 0);
  const firstActualValues = actualGroups[0]?.values || [];
  const variants = factoryCafe24VariantRows({ product: { cafe24Candidates: [normalizeCafe24ProductCandidate(detail, 'verify', 999, 0)], selectedCafe24CandidateKey: String(detail.product_no || '') } }, firstActualValues);
  const actualByCode = new Map(variants.filter(row => row.variant_code).map(row => [row.variant_code, row]));
  const inventoryMismatches = (plan.inventoryUpdates || []).filter(item => {
    const actualRow = actualByCode.get(item.variantCode);
    if (!actualRow) return true;
    const actualInventory = factoryCafe24InventoryPayload(actualRow);
    const expectedInventory = item.body?.inventory || item.body || {};
    return Object.entries(expectedInventory).some(([key, value]) => !factoryCafe24ValuesRoughlyEqual(value, actualInventory[key]));
  });
  const inventoryMatched = !inventoryMismatches.length;
  if (!expectedGroups.length && plan.optionSettingsOnly) {
    const matchedSettings = !settingMismatches.length;
    return {
      matched: matchedSettings && inventoryMatched && extrasMatched,
      expectedCount,
      actualCount,
      expectedGroupCount: expectedGroups.length,
      actualGroupCount: actualGroups.length,
      expectedAdditionalOptionCount: expectedAdditionalOptions.length,
      actualAdditionalOptionCount: actualAdditionalOptions.length,
      variantCount: variants.length,
      inventoryChecked: (plan.inventoryUpdates || []).length,
      inventoryMismatchCount: inventoryMismatches.length,
      settingChecked: settingKeys.length,
      settingMismatchCount: settingMismatches.length,
      message: `옵션 설정 ${settingKeys.length - settingMismatches.length}/${settingKeys.length}개 · 추가입력 ${actualAdditionalOptions.length}/${expectedAdditionalOptions.length}개 · 파일첨부 ${attachedFlagMatched ? '일치' : '확인 필요'} · 재고검증 ${Math.max(0, (plan.inventoryUpdates || []).length - inventoryMismatches.length)}/${(plan.inventoryUpdates || []).length}건`,
    };
  }
  return {
    matched: !!expectedGroups.length && matchedGroups === expectedGroups.length && !settingMismatches.length && inventoryMatched && extrasMatched,
    expectedCount,
    actualCount,
    expectedGroupCount: expectedGroups.length,
    actualGroupCount: actualGroups.length,
    expectedAdditionalOptionCount: expectedAdditionalOptions.length,
    actualAdditionalOptionCount: actualAdditionalOptions.length,
    variantCount: variants.length,
    inventoryChecked: (plan.inventoryUpdates || []).length,
    inventoryMismatchCount: inventoryMismatches.length,
    settingChecked: settingKeys.length,
    settingMismatchCount: settingMismatches.length,
    message: actualGroups.length
      ? `옵션그룹 ${matchedGroups}/${expectedGroups.length}개 · 옵션값 ${actualCount}/${expectedCount}개 · 설정 ${settingKeys.length - settingMismatches.length}/${settingKeys.length}개 · 추가입력 ${actualAdditionalOptions.length}/${expectedAdditionalOptions.length}개 · 파일첨부 ${attachedFlagMatched ? '일치' : '확인 필요'} · 품목 ${variants.length}개 · 재고검증 ${Math.max(0, (plan.inventoryUpdates || []).length - inventoryMismatches.length)}/${(plan.inventoryUpdates || []).length}건`
      : 'Cafe24 재조회에서 옵션그룹을 찾지 못했습니다.',
  };
}

const FACTORY_CAFE24_SYNC_RESULT_LABELS = {
  readyAll: '준비 항목 전체 동기화',
  category: '카테고리 연결',
  options: '옵션 / 품목 / 재고',
  images: '상품 이미지',
  additionalImages: '추가 이미지',
  icons: '상품 아이콘',
  seo: '검색엔진 SEO',
  tags: '상품 태그',
  relations: '관련상품',
  memos: '관리 메모',
  mains: '메인 진열',
  postCreate: '등록 후 전용 API',
};

function factoryRememberCafe24SyncResult(factory, key, data = {}) {
  if (!factory?.product) return null;
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return null;
  const current = factory.product.cafe24SyncResults && typeof factory.product.cafe24SyncResults === 'object'
    ? factory.product.cafe24SyncResults
    : {};
  const record = {
    key: cleanKey,
    label: data.label || FACTORY_CAFE24_SYNC_RESULT_LABELS[cleanKey] || cleanKey,
    productNo: String(data.productNo || ''),
    endpoint: data.endpoint || '',
    ok: !!data.ok,
    warning: !!data.warning,
    summary: data.summary || '',
    detail: data.detail || '',
    error: data.error || '',
    syncedAt: Date.now(),
  };
  factory.product.cafe24SyncResults = {
    ...current,
    [cleanKey]: record,
  };
  return record;
}

function factoryVerifyCafe24CategoryEcho(expectedRows = [], raw = {}) {
  const expected = (Array.isArray(expectedRows) ? expectedRows : [])
    .map(row => String(row?.category_no || '').trim())
    .filter(Boolean);
  const actualRows = Array.isArray(raw?.category)
    ? raw.category
    : (Array.isArray(raw?.categories) ? raw.categories : []);
  const actual = actualRows
    .map(row => String(row?.category_no || row?.categoryNo || row || '').trim())
    .filter(Boolean);
  const missing = expected.filter(no => !actual.includes(no));
  return {
    expected: expected.length,
    actual: actual.length,
    matched: !missing.length,
    missing,
    message: missing.length
      ? `누락 분류 ${missing.join(', ')}`
      : `분류 ${actual.length}개 중 요청 ${expected.length}개 확인`,
  };
}

function factoryCafe24CategoryNoSet(raw = {}) {
  const rows = Array.isArray(raw?.category)
    ? raw.category
    : (Array.isArray(raw?.categories) ? raw.categories : []);
  return new Set(rows
    .map(row => String(row?.category_no || row?.categoryNo || row || '').trim())
    .filter(Boolean));
}

function factoryCafe24ArrayPayload(value) {
  if (Array.isArray(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (/^[\[{]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === 'object') return [parsed];
    } catch(e) {}
  }
  return raw.split(/[,;\n\r]+/).map(item => item.trim()).filter(Boolean);
}

const CAFE24_PRODUCT_ARRAY_PAYLOAD_FIELDS = new Set([
  'product_tag',
  'icon',
  'buy_group_list',
  'buy_member_id_list',
  'exposure_group_list',
]);

const CAFE24_PRODUCT_JSON_PAYLOAD_FIELDS = new Set([
  'additional_information',
  'product_volume',
  'expiration_date',
  'promotion_period',
  'shipping_rates',
  'icon_show_period',
  'size_guide',
]);

function factoryCafe24JsonPayload(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return cloneData(value);
  const raw = String(value ?? '').trim();
  if (!raw) return raw;
  if (/^[\[{]/.test(raw)) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  return value;
}

function factoryCafe24NoUseText(value) {
  return /사용\s*안\s*함|미사용|설정\s*안\s*함|없음|해당\s*없음|제외/i.test(String(value ?? '').trim());
}

function factoryCafe24NumericText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const match = /-?\d+(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/.exec(raw);
  return match ? match[0].replace(/,/g, '') : '';
}

function factoryCafe24MoneyText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const manMatch = /(-?\d+(?:\.\d+)?)\s*만\s*원?/.exec(raw);
  if (manMatch) return String(Math.round(Number(manMatch[1]) * 10000));
  return factoryCafe24NumericText(raw);
}

function factoryCafe24PositiveMoneyText(value) {
  const normalized = factoryCafe24MoneyText(value);
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? normalized : '';
}

function factoryCafe24AdditionalInfoLinePayload(line, index = 0) {
  const raw = String(line ?? '').trim();
  if (!raw) return null;
  const knownNames = [
    '상품명','제품명','사이즈','규격','크기','색상','컬러','소재','재질','구성','포장',
    '원산지','제조사','브랜드','중량','무게','용도','주의사항','관리방법',
  ];
  const explicit = raw.match(/^([^:：=|]{1,28})\s*[:：=|]\s*(.+)$/);
  if (explicit) {
    return {
      key: `custom_option${index + 1}`,
      name: explicit[1].trim(),
      value: /미입력|없음/i.test(explicit[2]) ? '' : explicit[2].trim(),
    };
  }
  for (const name of knownNames) {
    const re = new RegExp(`^${name}\\s+(.+)$`, 'i');
    const hit = raw.match(re);
    if (hit) {
      return {
        key: `custom_option${index + 1}`,
        name,
        value: /미입력|없음/i.test(hit[1]) ? '' : hit[1].trim(),
      };
    }
  }
  if (/(가로|세로|높이|폭|너비|mm|㎜|cm|㎝|\d+\s*[xX×]\s*\d+)/.test(raw)) {
    return { key: `custom_option${index + 1}`, name: '사이즈', value: raw };
  }
  return { key: `custom_option${index + 1}`, name: `추가정보 ${index + 1}`, value: raw };
}

function factoryCafe24AdditionalInformationPayload(value) {
  const parsed = factoryCafe24JsonPayload(value);
  if (Array.isArray(parsed)) return factoryCafe24CleanAdditionalInfoRows(parsed);
  if (parsed && typeof parsed === 'object') return factoryCafe24CleanAdditionalInfoRows([parsed]);
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  return factoryCafe24CleanAdditionalInfoRows(raw.split(/[\n;]+/)
    .map((line, index) => factoryCafe24AdditionalInfoLinePayload(line, index))
    .filter(Boolean));
}

function factoryCafe24MergeResolvedSizeAdditionalInformation(product = {}, finalDb = {}) {
  const size = [finalDb.size, finalDb.dimensions, finalDb.size_text, finalDb.product_size]
    .map(value => String(value ?? '').trim())
    .find(Boolean);
  if (!size) return product;
  const rows = factoryCafe24AdditionalInformationPayload(product.additional_information);
  const sizeIndex = rows.findIndex(row => /^(사이즈|규격|크기)$/i.test(String(row?.name || '').trim()));
  if (sizeIndex >= 0) {
    rows[sizeIndex] = { ...rows[sizeIndex], value: size };
  } else {
    const usedKeys = new Set(rows.map(row => String(row?.key || '').trim()).filter(Boolean));
    let keyIndex = 1;
    while (usedKeys.has(`custom_option${keyIndex}`)) keyIndex += 1;
    rows.unshift({ key: `custom_option${keyIndex}`, name: '사이즈', value: size });
  }
  product.additional_information = rows;
  return product;
}

function factoryCafe24ProductVolumePayload(value) {
  const integerVolumeValue = rawValue => {
    const numeric = factoryCafe24NumericText(rawValue);
    if (!numeric) return null;
    const number = Math.round(Number(numeric));
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const payload = { ...cloneData(value) };
    const use = String(payload.use_product_volume ?? payload.use ?? '').trim();
    const hasSize = ['width', 'height', 'length', 'product_width', 'product_height', 'product_length', 'depth']
      .some(key => String(payload[key] ?? '').trim() !== '');
    payload.use_product_volume = /^(T|Y|true|1|사용|사용함)$/i.test(use) || hasSize ? 'T' : 'F';
    if (payload.product_width !== undefined && payload.width === undefined) payload.width = payload.product_width;
    if (payload.product_height !== undefined && payload.height === undefined) payload.height = payload.product_height;
    if (payload.product_length !== undefined && payload.length === undefined) payload.length = payload.product_length;
    if (payload.depth !== undefined && payload.length === undefined) payload.length = payload.depth;
    ['width', 'height', 'length'].forEach(key => {
      if (payload[key] === undefined) return;
      const number = integerVolumeValue(payload[key]);
      if (number === null) delete payload[key];
      else payload[key] = number;
    });
    if (payload.unit !== undefined) {
      payload.unit = String(payload.unit ?? '').trim();
      if (!payload.unit) delete payload.unit;
    }
    return payload;
  }
  const raw = String(value ?? '').trim();
  if (!raw || factoryCafe24NoUseText(raw)) return { use_product_volume: 'F' };
  if (/^[\[{]/.test(raw)) {
    try { return factoryCafe24ProductVolumePayload(JSON.parse(raw)); } catch(e) {}
  }
  const unitMatch = raw.match(/(mm|㎜|cm|㎝|m|inch|in|인치)/i);
  const normalizeUnit = unit => {
    const clean = String(unit || '').trim().toLowerCase();
    if (clean === '㎜') return 'mm';
    if (clean === '㎝') return 'cm';
    if (clean === '인치') return 'inch';
    if (clean === 'in') return 'inch';
    return clean || '';
  };
  const unit = normalizeUnit(unitMatch?.[1] || '');
  const payload = { use_product_volume: 'T' };
  if (unit) payload.unit = unit;
  const setPart = (key, match) => {
    if (!match) return;
    const number = String(match[1] || '').replace(/,/g, '').trim();
    if (!number) return;
    const integer = integerVolumeValue(number);
    if (integer === null) return;
    payload[key] = integer;
    if (!payload.unit && match[2]) payload.unit = normalizeUnit(match[2]);
  };
  setPart('width', raw.match(/(?:가로|폭|너비|width|w)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|㎜|cm|㎝|m|inch|in|인치)?/i));
  setPart('height', raw.match(/(?:세로|높이아님세로|height|h)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|㎜|cm|㎝|m|inch|in|인치)?/i));
  setPart('length', raw.match(/(?:높이|두께|깊이|depth|length|d|l)\s*[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|㎜|cm|㎝|m|inch|in|인치)?/i));
  const numericParts = [...raw.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(mm|㎜|cm|㎝|m|inch|in|인치)?/gi)]
    .map(match => ({ number: String(match[1] || '').replace(/,/g, '').trim(), unit: normalizeUnit(match[2] || '') }))
    .filter(item => item.number);
  if (!payload.width && numericParts[0]) payload.width = integerVolumeValue(numericParts[0].number);
  if (!payload.height && numericParts[1]) payload.height = integerVolumeValue(numericParts[1].number);
  if (!payload.length && numericParts[2]) payload.length = integerVolumeValue(numericParts[2].number);
  if (!payload.unit) payload.unit = numericParts.find(item => item.unit)?.unit || '';
  if (!payload.unit) delete payload.unit;
  if (!payload.width && !payload.height && !payload.length) return factoryCafe24JsonPayload(value);
  return payload;
}

function factoryCafe24SizeGuidePayload(value) {
  const parsed = factoryCafe24JsonPayload(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const use = String(parsed.use ?? parsed.use_size_guide ?? '').trim();
    const description = String(parsed.description ?? parsed.desc ?? parsed.text ?? '').trim();
    const defaultText = String(parsed.default ?? parsed.default_text ?? '').trim();
    const payload = {
      use: factoryCafe24NoUseText(use || description || defaultText) && !description && !defaultText ? 'F' : (/^(F|N|false|0)$/i.test(use) ? 'F' : 'T'),
      type: String(parsed.type || parsed.guide_type || 'default').trim() || 'default',
      default: defaultText,
      description: description || null,
    };
    if (payload.use === 'F') {
      payload.default = '';
      payload.description = null;
    }
    return payload;
  }
  const raw = String(value ?? '').trim();
  if (!raw || factoryCafe24NoUseText(raw)) return { use: 'F', type: 'default', default: '', description: null };
  return { use: 'T', type: 'default', default: '', description: raw };
}

function factoryCafe24ShippingRatesPayload(value) {
  const parsed = factoryCafe24JsonPayload(value);
  const normalizeRow = (row, index) => {
    if (!row || typeof row !== 'object') return null;
    const min = String(row.min || row.minimum || row.minimum_amount || row.start || row.from || '').trim();
    const max = String(row.max || row.maximum || row.maximum_amount || row.end || row.to || '').trim();
    const fee = String(row.fee || row.shipping_fee || row.price || row.amount || '').trim();
    const label = String(row.label || row.name || row.description || '').trim();
    if (!min && !max && !fee && !label) return null;
    const payload = { key: row.key || `rate_${index + 1}` };
    if (min) payload.minimum_amount = factoryCafe24MoneyText(min) || min;
    if (max) payload.maximum_amount = factoryCafe24MoneyText(max) || max;
    if (fee) payload.shipping_fee = /무료|free/i.test(fee) ? '0' : (factoryCafe24MoneyText(fee) || fee);
    if (label) payload.description = label;
    return payload;
  };
  if (Array.isArray(parsed)) return parsed.map(normalizeRow).filter(Boolean);
  if (parsed && typeof parsed === 'object') {
    const row = normalizeRow(parsed, 0);
    return row ? [row] : [];
  }
  const raw = String(value ?? '').trim();
  if (!raw || factoryCafe24NoUseText(raw)) return [];
  return raw.split(/[\n;]+/)
    .map((line, index) => {
      const text = String(line || '').trim();
      if (!text) return null;
      const isFree = /무료|free/i.test(text);
      const moneyMatches = [...text.matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?\s*만?\s*원?|-?\d+(?:\.\d+)?\s*만\s*원?/g)]
        .map(match => factoryCafe24MoneyText(match[0]))
        .filter(Boolean);
      const payload = { key: `rate_${index + 1}`, description: text };
      const range = text.match(/(.+?)(?:~|-|부터|이상|초과)(.+?)(?:까지|미만|이하|:|：|=|배송|무료|$)/);
      if (range) {
        const min = factoryCafe24MoneyText(range[1]);
        const max = factoryCafe24MoneyText(range[2]);
        if (/이하|미만|까지/.test(text) && !/이상|초과|부터/.test(text)) {
          if (max || min) payload.maximum_amount = max || min;
        } else {
          if (min) payload.minimum_amount = min;
          if (max && max !== min) payload.maximum_amount = max;
        }
      } else if (/이상|초과|부터/.test(text) && moneyMatches[0]) {
        payload.minimum_amount = moneyMatches[0];
      } else if (/이하|미만|까지/.test(text) && moneyMatches[0]) {
        payload.maximum_amount = moneyMatches[0];
      }
      if (isFree) {
        payload.shipping_fee = '0';
      } else {
        const feeCandidates = moneyMatches.filter(num => num !== payload.minimum_amount && num !== payload.maximum_amount);
        if (feeCandidates.length) payload.shipping_fee = feeCandidates[feeCandidates.length - 1];
        else if (/기본|배송비|운임|택배비/.test(text) && moneyMatches[0]) payload.shipping_fee = moneyMatches[0];
      }
      if (!payload.minimum_amount && !payload.maximum_amount && !payload.shipping_fee && !payload.description) return null;
      return payload;
    })
    .filter(Boolean);
}

function factoryCafe24StructuredJsonParseResult(fieldName, value) {
  const raw = String(value ?? '').trim();
  const result = { payload: null, structured: false, needsReview: false, message: '' };
  const isPeriodField = fieldName === 'expiration_date' || fieldName === 'icon_show_period' || fieldName === 'promotion_period';
  if (fieldName === 'product_volume') {
    result.payload = factoryCafe24ProductVolumePayload(value);
    result.structured = !!(result.payload && typeof result.payload === 'object');
    const useVolume = result.structured && result.payload.use_product_volume !== 'F';
    const dims = ['width', 'height', 'length'].filter(key => String(result.payload?.[key] ?? '').trim() !== '');
    const missingUnit = useVolume && !String(result.payload?.unit || '').trim();
    const notEnoughDims = useVolume && dims.length < 2;
    result.needsReview = !!raw && (!result.structured || notEnoughDims || missingUnit);
    result.message = result.needsReview
      ? (missingUnit
        ? '상품부피 단위가 목표 스키마에 맞게 분리되지 않았습니다.'
        : '상품부피를 가로/세로/높이 구조로 충분히 분리하지 못했습니다.')
      : '';
    return result;
  }
  if (fieldName === 'additional_information') {
    result.payload = factoryCafe24AdditionalInformationPayload(value);
    result.structured = Array.isArray(result.payload);
    result.needsReview = !!raw && !result.payload.length;
    result.message = result.needsReview ? '추가정보 항목/값을 구조화하지 못했습니다.' : '';
    return result;
  }
  if (isPeriodField) {
    if (factoryCafe24NoUseText(raw)) {
      result.payload = { start_date: null, end_date: null };
      result.structured = true;
      return result;
    }
    const period = factoryCafe24PeriodObject(value);
    result.payload = { start_date: period.start_date || null, end_date: period.end_date || null };
    result.structured = !raw || !!(result.payload.start_date || result.payload.end_date);
    const missingPeriodSide = !!raw && result.structured && (!!result.payload.start_date !== !!result.payload.end_date);
    result.needsReview = !!raw && (!result.structured || missingPeriodSide);
    result.message = result.needsReview
      ? (missingPeriodSide ? '기간 시작일/종료일 중 한쪽이 목표 스키마에 맞게 분리되지 않았습니다.' : '기간 값을 날짜 범위로 구조화하지 못했습니다.')
      : '';
    return result;
  }
  if (fieldName === 'shipping_rates') {
    result.payload = factoryCafe24ShippingRatesPayload(value);
    result.structured = Array.isArray(result.payload);
    const hasUsableRate = Array.isArray(result.payload) && result.payload.some(row =>
      String(row?.minimum_amount ?? row?.maximum_amount ?? row?.shipping_fee ?? '').trim() !== ''
    );
    result.needsReview = !!raw && !factoryCafe24NoUseText(raw) && (!result.payload.length || !hasUsableRate);
    result.message = result.needsReview ? '배송비 구간을 금액/배송비 구조로 분리하지 못했습니다.' : '';
    return result;
  }
  if (fieldName === 'size_guide') {
    result.payload = factoryCafe24SizeGuidePayload(value);
    result.structured = !!(result.payload && typeof result.payload === 'object');
    result.needsReview = false;
    return result;
  }
  result.payload = factoryCafe24JsonPayload(value);
  result.structured = Array.isArray(result.payload) || (result.payload && typeof result.payload === 'object');
  result.needsReview = !!raw && !result.structured;
  result.message = result.needsReview ? `${fieldName} 값을 구조화하지 못했습니다.` : '';
  return result;
}

function factoryCafe24StructuredJsonPayload(fieldName, value) {
  if (fieldName === 'product_volume') {
    return factoryCafe24ProductVolumePayload(value);
  }
  if (fieldName === 'additional_information') return factoryCafe24AdditionalInformationPayload(value);
  const isPeriodField = fieldName === 'expiration_date' || fieldName === 'icon_show_period' || fieldName === 'promotion_period';
  const raw = String(value ?? '').trim();
  if (isPeriodField && factoryCafe24NoUseText(raw)) {
    return null;
  }
  if (isPeriodField) {
    const period = factoryCafe24PeriodObject(value);
    const payload = {
      start_date: period.start_date || null,
      end_date: period.end_date || null,
    };
    return payload.start_date || payload.end_date ? payload : null;
  }
  if (fieldName === 'size_guide') return factoryCafe24SizeGuidePayload(value);
  if (fieldName === 'shipping_rates') return factoryCafe24ShippingRatesPayload(value);
  return factoryCafe24JsonPayload(value);
}

function factoryCafe24WeightValueForPayload(value, sourceKey = '', finalDb = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;
  const numericMatch = /-?\d+(?:\.\d+)?/.exec(raw.replace(/,/g, ''));
  if (!numericMatch) return value;
  const numeric = Number(numericMatch[0]);
  if (!Number.isFinite(numeric)) return value;
  const context = [
    sourceKey,
    raw,
    finalDb.weight_unit,
    finalDb.product_weight_unit,
    finalDb.shipping_weight_unit,
    finalDb.unit,
    finalDb.weight,
    finalDb.product_weight,
    finalDb.shipping_weight,
    finalDb.weight_g,
    finalDb.product_weight_g,
    finalDb.shipping_weight_g,
  ].map(item => String(item || '')).join(' ');
  const rawHasKg = /\bkg\b|킬로|킬로그|kilogram/i.test(raw);
  const rawHasGram = /(?:^|[\d\s])g\b|gram|grams|그램|그람/i.test(raw);
  const contextHasGram = /(?:^|[_\s-])(g|gram|grams)(?:$|[_\s-])|weight_g|product_weight_g|shipping_weight_g|그램|그람/i.test(context);
  const contextHasKg = /\bkg\b|킬로|킬로그|kilogram/i.test(context);
  const ambiguousSmallWeightLooksGram = /^(weight|shipping_weight)$/i.test(String(sourceKey || '').trim()) &&
    !rawHasKg && !contextHasKg && !rawHasGram && !contextHasGram &&
    numeric > 0 && numeric < 1000;
  const asKg = (rawHasGram || contextHasGram || ambiguousSmallWeightLooksGram) && !rawHasKg && !contextHasKg
    ? numeric / 1000
    : numeric;
  const isCafe24WeightField = /product_weight|shipping_weight|weight_g|weight$/i.test(String(sourceKey || '').trim());
  if (isCafe24WeightField) {
    const rounded = Math.max(0.01, Number(asKg.toFixed(2)));
    return rounded.toFixed(2);
  }
  return String(Number(asKg.toFixed(6))).replace(/\.0+$/, '');
}

function factoryCafe24PayloadValue(fieldName, value) {
  const raw = String(value ?? '').trim();
  const codeInParen = /\(([A-Z0-9_-]+)\)\s*$/i.exec(raw)?.[1] || '';
  if (fieldName === 'made_date' || fieldName === 'release_date') {
    return factoryCafe24DateInputValue(value) || raw;
  }
  if (fieldName === 'buy_group_list' || fieldName === 'exposure_group_list') {
    return factoryCafe24MemberGroupPayload(value);
  }
  if (fieldName === 'buy_member_id_list') {
    return factoryCafe24MemberIdPayload(value);
  }
  if (CAFE24_PRODUCT_ARRAY_PAYLOAD_FIELDS.has(fieldName)) {
    return factoryCafe24ArrayPayload(value);
  }
  if (fieldName === 'additional_information') return factoryCafe24AdditionalInformationPayload(value);
  if (fieldName === 'points_amount') return factoryCafe24PointsAmountPayload(value);
  if (CAFE24_PRODUCT_JSON_PAYLOAD_FIELDS.has(fieldName)) return factoryCafe24StructuredJsonPayload(fieldName, value);
  if (fieldName === 'product_weight') return factoryCafe24WeightValueForPayload(value, 'product_weight');
  if (['display','selling','display_soldout','sold_out','has_option','select_one_by_option','buy_limit_by_product','repurchase_restriction','single_purchase_restriction','single_purchase','points_by_product','points_setting_by_payment','except_member_points','adult_certification','payment_info_by_product','shipping_info_by_product','shipping_fee_by_product','exchange_info_by_product','service_info_by_product','separated_mobile_description','use_naverpay','use_kakaopay','market_sync'].includes(fieldName)) {
    return factoryTruthyCafe24Flag(raw) || codeInParen || raw;
  }
  if (['product_condition','tax_type','tax_calculation','option_type','option_list_type','set_product_type','buy_unit_type','order_quantity_limit_type','shipping_fee_type','shipping_scope','shipping_calculation','prepaid_shipping_fee','product_shipping_type','naverpay_type','kakaopay_type','origin_classification','image_upload_type','buy_limit_type','exposure_limit_type'].includes(fieldName) && codeInParen) return codeInParen.toUpperCase();
  if (['shipping_method','classification_code','manufacturer_code','supplier_code','brand_code','trend_code','origin_place_code','origin_place_no','shipping_place_code'].includes(fieldName) && codeInParen) return codeInParen;
  if (/^(price|retail_price|supply_price|additional_price|additional_amount|product_weight|product_volume|shipping_fee|shipping_fee_by_product|tax_rate|buy_unit|minimum_quantity|maximum_quantity|points_amount|product_used_month|quantity|safety_inventory)$/i.test(fieldName) && /^-?\d+(\.\d+)?$/.test(raw.replace(/,/g, ''))) {
    return raw.replace(/,/g, '');
  }
  return value;
}

function factoryCafe24EmptyPayloadValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value)) return value.length === 0 || value.every(item => factoryCafe24EmptyPayloadValue(item));
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'start_date') || Object.prototype.hasOwnProperty.call(value, 'end_date')) {
      return !String(value.start_date || '').trim() && !String(value.end_date || '').trim();
    }
    const keys = Object.keys(value);
    if (!keys.length) return true;
    return keys.every(key => factoryCafe24EmptyPayloadValue(value[key]));
  }
  return false;
}

function factoryCafe24PruneEmptyProductPayload(product = {}, notes = []) {
  if (!product || typeof product !== 'object') return product;
  Object.keys(product).forEach(key => {
    if (!factoryCafe24EmptyPayloadValue(product[key])) return;
    delete product[key];
    if (Array.isArray(notes)) notes.push(`${key} 빈 값 제외`);
  });
  return product;
}

const FACTORY_CAFE24_STRICT_REFERENCE_CODE_FIELDS = new Set([
  'manufacturer_code',
  'supplier_code',
  'brand_code',
  'trend_code',
]);

function factoryCafe24StrictReferenceCodeValid(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return /^[A-Z0-9]+$/.test(text);
}

function factoryRemoveCafe24InvalidReferenceCodePayloadFields(product = {}, notes = []) {
  if (!product || typeof product !== 'object') return [];
  const removed = [];
  FACTORY_CAFE24_STRICT_REFERENCE_CODE_FIELDS.forEach(field => {
    if (!Object.prototype.hasOwnProperty.call(product, field)) return;
    const value = product[field];
    if (factoryCafe24StrictReferenceCodeValid(value)) return;
    removed.push(field);
    delete product[field];
  });
  if (removed.length && Array.isArray(notes)) {
    const labels = removed.map(field => typeof factoryCafe24FieldLabelByApiField === 'function'
      ? factoryCafe24FieldLabelByApiField(field)
      : field);
    notes.push(`${labels.join(', ')}는 Cafe24 코드 형식이 아니라 표시명으로 판단되어 전송에서 제외했습니다.`);
  }
  return removed;
}

function factoryCafe24ReferenceRowsFromBody(body, keys = []) {
  const source = unwrapApiHubBody(body);
  const candidates = [];
  keys.forEach(key => {
    candidates.push(source?.data?.response?.[key], source?.response?.[key], source?.[key], source?.data?.[key]);
  });
  candidates.push(source?.data?.response, source?.response, source?.data, source);
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') {
      if (keys.some(key => ['shipping', 'shipping_methods', 'shippingMethods'].includes(key)) && (candidate.shipping_method || candidate.shipping_type || candidate.shipping_place)) return [candidate];
      const nested = Object.values(candidate).find(Array.isArray);
      if (nested) return nested;
      if (keys.some(key => ['shipping', 'shipping_methods', 'shippingMethods'].includes(key))) return [candidate];
    }
  }
  return [];
}

function factoryCafe24NormalizeReferenceItem(item, type) {
  if (!item || typeof item !== 'object') return null;
  const pick = (...keys) => keys.map(key => item[key]).find(value => String(value ?? '').trim() !== '');
  const code = (() => {
    if (type === 'categories') return pick('category_no', 'categoryNo', 'no', 'code', 'id');
    if (type === 'manufacturers') return pick('manufacturer_code', 'manufacturerCode', 'code', 'id');
    if (type === 'suppliers') return pick('supplier_code', 'supplierCode', 'code', 'id');
    if (type === 'brands') return pick('brand_code', 'brandCode', 'code', 'id');
    if (type === 'classifications') return pick('classification_code', 'classificationCode', 'code', 'id');
    if (type === 'trends') return pick('trend_code', 'trendCode', 'code', 'id');
    if (type === 'originPlaces') return pick('origin_place_no', 'origin_place_code', 'originPlaceNo', 'originPlaceCode', 'place_no', 'place_code', 'code', 'id');
    if (type === 'shippingMethods') return pick('shipping_method', 'shipping_method_code', 'method_code', 'code', 'id', 'name');
    if (type === 'shippingOrigins') return pick('origin_code', 'shipping_origin_code', 'shipping_place_code', 'code', 'id');
    return pick('code', 'id', 'no');
  })();
  const name = (() => {
    if (type === 'categories') {
      const full = item.full_category_name;
      if (full && typeof full === 'object') return Object.values(full).filter(Boolean).join(' > ');
      const direct = pick('category_path', 'category_name', 'name', 'label');
      if (direct) return direct;
      return pick('full_category_name');
    }
    if (type === 'manufacturers') return pick('manufacturer_name', 'name', 'label');
    if (type === 'suppliers') return pick('supplier_name', 'supplier_company_name', 'name', 'label');
    if (type === 'brands') return pick('brand_name', 'name', 'label');
    if (type === 'classifications') return pick('classification_name', 'name', 'label');
    if (type === 'trends') return pick('trend_name', 'name', 'label');
    if (type === 'originPlaces') return pick('origin_place_name', 'origin_name', 'place_name', 'name', 'label');
    if (type === 'shippingMethods') return pick('shipping_method_name', 'shipping_name', 'shipping_place', 'name', 'label', 'shipping_method');
    if (type === 'shippingOrigins') return pick('origin_name', 'shipping_origin_name', 'shipping_place_name', 'name', 'label');
    return pick('name', 'label');
  })();
  if (code === undefined || code === null || String(code).trim() === '') return null;
  const cleanCode = String(code).trim();
  const overrideName = factoryCafe24ReferenceOverrideName(type, cleanCode);
  const cleanName = String(overrideName || name || cleanCode).trim();
  return {
    code: cleanCode,
    name: cleanName,
    label: cleanName,
    raw: cloneData(item),
  };
}

function factoryCafe24DedupeReferenceList(items = [], type = '') {
  const out = [];
  const seen = new Set();
  items.map(item => factoryCafe24NormalizeReferenceItem(item, type)).filter(Boolean).forEach(item => {
    const key = `${type}:${factoryDbNormalizeKey(item.code)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

const CAFE24_REFERENCE_LABEL_OVERRIDES = {
  manufacturers: {
    M0000CJP: '보자기천국',
  },
  suppliers: {
    S0000000: '자체공급',
  },
  brands: {
    B0000000: '자체브랜드',
    B00000PU: '보자기천국',
  },
  originPlaces: {
    102: '국내 > 대구광역시 > 서구',
  },
  classifications: {
    C000000A: '기본 자체분류',
  },
  trends: {
    T0000000: '기본트렌드',
  },
};

function factoryCafe24ReferenceOverrideName(type, code) {
  const key = String(code || '').trim().toUpperCase();
  if (!key) return '';
  return CAFE24_REFERENCE_LABEL_OVERRIDES[type]?.[key] || '';
}

function factoryCafe24DefaultReferenceList(type) {
  const defaults = {
    manufacturers: [
      { code: 'M0000CJP', name: '보자기천국', label: '보자기천국 (M0000CJP)', raw: { fallback: true } },
    ],
    suppliers: [
      { code: 'S0000000', name: '자체공급', label: '자체공급 (S0000000)', raw: { fallback: true } },
    ],
    brands: [
      { code: 'B00000PU', name: '보자기천국', label: '보자기천국 (B00000PU)', raw: { fallback: true } },
    ],
    classifications: [
      { code: 'C000000A', name: '기본 자체분류', label: '기본 자체분류 (C000000A)', raw: { fallback: true } },
    ],
    trends: [
      { code: 'T0000000', name: '기본트렌드', label: '기본트렌드 (T0000000)', raw: { fallback: true } },
    ],
    originPlaces: [
      { code: '102', name: '국내 > 대구광역시 > 서구', label: '국내 > 대구광역시 > 서구 (102)', raw: { fallback: true } },
    ],
    shippingMethods: [
      { code: 'C', name: '택배/등기/소포', label: '택배/등기/소포 (C)', raw: { fallback: true } },
      { code: 'D', name: '직접배송', label: '직접배송 (D)', raw: { fallback: true } },
    ],
    shippingOrigins: [
      { code: '1', name: '기본 출고지', label: '기본 출고지 (1)', raw: { fallback: true } },
    ],
  };
  return defaults[type] || [];
}

function factoryCafe24CountryLabel(code) {
  const raw = String(code || '').trim();
  if (!raw) return '';
  return CAFE24_FORM_SELECTS.originCountry.find(item => item.value === raw)?.label || raw;
}

const CAFE24_DYNAMIC_REFERENCE_FIELDS = {
  manufacturers: { codeKeys: ['manufacturer_code', 'manufacturer'], nameKeys: ['manufacturer_name'], fallback: '현재 제조사' },
  suppliers: { codeKeys: ['supplier_code', 'supplier'], nameKeys: ['supplier_name', 'supplier_company_name'], fallback: '현재 공급사' },
  brands: { codeKeys: ['brand_code', 'brand'], nameKeys: ['brand_name'], fallback: '현재 브랜드' },
  classifications: { codeKeys: ['classification_code'], nameKeys: ['classification_name'], fallback: '현재 자체분류' },
  trends: { codeKeys: ['trend_code'], nameKeys: ['trend_name'], fallback: '현재 트렌드' },
  shippingMethods: { codeKeys: ['shipping_method', 'shipping_method_code'], nameKeys: ['shipping_method_name', 'shipping_name'], fallback: '현재 배송방법' },
  shippingOrigins: { codeKeys: ['shipping_place_code', 'shipping_origin_code'], nameKeys: ['shipping_place_name', 'shipping_origin_name'], fallback: '현재 출고지' },
};

function factoryCafe24DynamicReferenceList(type, factory = factoryRuntimeReadFactory()) {
  const raw = factoryCafe24RawForForm(factory);
  if (type !== 'originPlaces') {
    const def = CAFE24_DYNAMIC_REFERENCE_FIELDS[type];
    if (!def) return [];
    const codes = def.codeKeys
      .map(key => String(raw?.[key] ?? '').trim())
      .filter(Boolean);
    const name = def.nameKeys
      .map(key => String(raw?.[key] ?? '').trim())
      .find(Boolean) || def.fallback;
    return [...new Set(codes)].map(code => ({
      code,
      name,
      label: name,
      raw: { dynamic: true, referenceType: type },
    }));
  }
  const codes = [
    raw?.origin_place_no,
    raw?.origin_place_code,
  ].map(value => String(value ?? '').trim()).filter(Boolean);
  const name = String(raw?.origin_place_value || '').trim() ||
    factoryCafe24CountryLabel(raw?.made_in_code || raw?.origin || raw?.made_in) ||
    '현재 원산지';
  return [...new Set(codes)].map(code => ({
    code,
    name,
    label: name,
    raw: { dynamic: true, made_in_code: raw?.made_in_code || '', origin_place_value: raw?.origin_place_value || '' },
  }));
}

function factoryCafe24HasExplicitReferenceList(type, factory = factoryRuntimeReadFactory()) {
  const list = factory.product.cafe24ReferenceLists?.[type];
  return Array.isArray(list) && list.length > 0;
}

function factoryCafe24ReferenceListsReady(factory = factoryRuntimeReadFactory()) {
  const lists = factory.product.cafe24ReferenceLists || {};
  return ['categories', 'manufacturers', 'suppliers', 'brands', 'classifications', 'trends', 'originPlaces', 'shippingMethods', 'shippingOrigins']
    .some(type => Array.isArray(lists[type]) && lists[type].length);
}

function factoryEnsureCafe24ReferenceLists(options = {}) {
  if (!options.factory) {
    const snapshot = factoryRuntimeReadFactory();
    if (factoryCafe24ReferenceListsReady(snapshot)) return;
    if (snapshot.product.cafe24ReferenceLoading) return;
    if (snapshot.product.cafe24ReferenceAutoTried) return;
    const transaction = factoryRuntimeUpdateOwnedFactory(
      'factory/cafe24:refresh-reference-lists',
      'cafe24',
      draft => factoryEnsureCafe24ReferenceLists({ ...options, factory: draft }),
    );
    return Promise.resolve(transaction).then(receipt => {
      saveLastWorkNow({ sync: false });
      return receipt.result;
    }).catch(error => {
      console.error('Cafe24 선택 목록 자동 불러오기 실패', error);
      return false;
    });
  }
  const factory = options.factory;
  if (factoryCafe24ReferenceListsReady(factory)) return;
  if (factory.product.cafe24ReferenceLoading) return;
  if (factory.product.cafe24ReferenceAutoTried) return;
  factory.product.cafe24ReferenceAutoTried = true;
  factory.product.cafe24ReferenceLoading = true;
  return factoryRefreshCafe24ReferenceLists({ ...options, factory, render: false })
    .catch(e => {
      factory.product.cafe24ReferenceStatus = `선택 목록 자동 불러오기 실패: ${e.message || e}`;
      factoryLog(factory.product.cafe24ReferenceStatus, 'error', factory);
      return false;
    })
    .finally(() => {
      factory.product.cafe24ReferenceLoading = false;
    });
}

function factoryCafe24ReferenceList(type, factory = factoryRuntimeReadFactory()) {
  const list = factory.product.cafe24ReferenceLists?.[type];
  const normalized = factoryCafe24DedupeReferenceList([
    ...(Array.isArray(list) ? list : []),
    ...factoryCafe24DynamicReferenceList(type, factory),
  ], type);
  return normalized.length ? normalized : factoryCafe24DefaultReferenceList(type);
}

function factoryCafe24ReferenceSelectedValue(field, value, factory = factoryRuntimeReadFactory()) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const list = factoryCafe24ReferenceList(field.referenceType, factory);
  const normalizedRaw = factoryDbNormalizeKey(raw);
  const hit = list.find(item =>
    factoryDbNormalizeKey(item.code) === normalizedRaw ||
    factoryDbNormalizeKey(item.name) === normalizedRaw ||
    factoryDbNormalizeKey(item.label) === normalizedRaw ||
    raw.includes(`(${item.code})`) ||
    (item.code && new RegExp(`(?:^|[^0-9])${String(item.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^0-9])`).test(raw))
  );
  return hit?.code || raw;
}

function factoryCafe24SkippedUpdateFields(fields = [], finalDb = {}) {
  return fields.filter(field => {
    if (!field?.custom || !field.enabled || !finalDb[field.id]) return false;
    const sourceKey = factoryDbNormalizeKey(field.sourceKey || field.id || field.label);
    return /(option|variant|품목|옵션)/i.test(sourceKey) || CAFE24_PRODUCT_UPDATE_FIELD_BLOCKLIST.has(sourceKey);
  }).map(field => field.label || field.sourceKey || field.id);
}

function factoryCafe24FormSourceContext(factory = factoryRuntimeReadFactory()) {
  const rows = factoryDbSourceRows(factory, { types: ['cafe24'], includeManual: false });
  const optionGroups = factoryExtractOptionGroups(factory, { types: ['cafe24'], includeManual: false });
  const optionValues = factoryDedupeRealOptionValues(optionGroups.flatMap(group => group.values), { allowNumeric: true });
  return { rows, optionGroups, optionValues };
}

function factoryCafe24FormFieldKey(field = {}) {
  return field.dbFieldId || field.id || field.apiField || '';
}

function factoryCafe24FormManualSetting(field = {}, factory = factoryRuntimeReadFactory()) {
  const key = factoryCafe24FormFieldKey(field);
  return key ? factory.product.dbFieldSettings?.[key] : null;
}

function factoryCafe24ResolvedFormValue(field = {}, finalDb = {}, factory = factoryRuntimeReadFactory(), context = null) {
  const key = factoryCafe24FormFieldKey(field);
  const setting = factoryCafe24FormManualSetting(field, factory);
  if (setting && (setting.manualTouched || String(setting.manualValue || '').trim() !== '')) return setting.manualValue || '';
  const keys = [key, field.id, field.dbFieldId, field.apiField].filter(Boolean);
  for (const candidateKey of keys) {
    if (finalDb[candidateKey] !== undefined && finalDb[candidateKey] !== null && String(finalDb[candidateKey]).trim() !== '') return finalDb[candidateKey];
  }
  const sourceContext = context || factoryCafe24FormSourceContext(factory);
  return factoryCafe24FormFieldValue(field, factory, sourceContext.rows, sourceContext.optionGroups, sourceContext.optionValues);
}

function factoryMergeCafe24VisibleFormPayload(product, finalDb = {}, factory = factoryRuntimeReadFactory()) {
  const context = factoryCafe24FormSourceContext(factory);
  const raw = factoryCafe24RawForForm(factory);
  factoryCafe24FormFieldsFlat().forEach(field => {
    if (!factoryCafe24FieldVisibleInInput(field)) return;
    if (!field.apiField || field.readonly) return;
    const apiField = factoryCafe24CanonicalUpdateField(field.apiField);
    if (!apiField) return;
    const setting = factoryCafe24FormManualSetting(field, factory);
    const value = factoryCafe24ResolvedFormValue(field, finalDb, factory, context);
    if (value === undefined || value === null || String(value).trim() === '') return;
    const manuallyEdited = !!(setting && setting.manualTouched);
    if (!manuallyEdited && (field.selectOptions || field.referenceType) && raw?.[apiField] !== undefined && raw?.[apiField] !== null && String(raw[apiField]).trim() !== '') {
      product[apiField] = cloneData(raw[apiField]);
      return;
    }
    if (!manuallyEdited && CAFE24_PRODUCT_JSON_PAYLOAD_FIELDS.has(apiField) && raw?.[apiField] !== undefined && raw?.[apiField] !== null) {
      if (apiField === 'additional_information') {
        const cleanAdditionalInfo = factoryCafe24AdditionalInformationPayload(raw[apiField]);
        if (cleanAdditionalInfo.length) product[apiField] = cleanAdditionalInfo;
        return;
      }
      product[apiField] = cloneData(raw[apiField]);
      return;
    }
    if (field.referenceType) {
      const selected = factoryCafe24ReferenceSelectedValue(field, value, factory);
      if (selected) {
        product[apiField] = selected;
        return;
      }
    }
    if (field.selectOptions) {
      const selected = factoryCafe24SelectOptionValue(value, field.selectOptions);
      if (selected) {
        product[apiField] = apiField === 'product_weight'
          ? factoryCafe24WeightValueForPayload(selected, field.id || field.apiField, finalDb)
          : factoryCafe24PayloadValue(apiField, selected);
        return;
      }
    }
    product[apiField] = apiField === 'product_weight'
      ? factoryCafe24WeightValueForPayload(value, field.id || field.apiField, finalDb)
      : factoryCafe24PayloadValue(apiField, value);
  });
  return product;
}

function factoryFilterCafe24ChangedProductPayload(product = {}, factory = factoryRuntimeReadFactory()) {
  const raw = factoryCafe24RawForForm(factory) || {};
  const filtered = {};
  Object.entries(product || {}).forEach(([apiField, value]) => {
    if (value === undefined || value === null || String(factoryCafe24ComparableValue(value)).trim() === '') return;
    const hasCurrent = raw && Object.prototype.hasOwnProperty.call(raw, apiField) &&
      String(factoryCafe24ComparableValue(raw[apiField]) || '').trim() !== '';
    if (!hasCurrent || !factoryCafe24ValuesRoughlyEqual(value, raw[apiField])) {
      filtered[apiField] = value;
    }
  });
  return filtered;
}

const FACTORY_CAFE24_DETAIL_HTML_MARKET_BLOCK_TOKENS = [
  'ghb',
  'gnb',
  'pigly',
  'bpigy',
  'xlel',
  'xle',
  'cnac',
  'fuck',
  'ceik',
  'ceki',
  'fcil',
  'fil',
  'dlair',
  'smel',
  'piclo',
  'panad',
  'cromil',
  'cromi',
  'emutin',
  'emox',
  'glida',
];

const FACTORY_CAFE24_DETAIL_HTML_FIELDS = ['description', 'mobile_description'];

function factoryCafe24DetailText(value) {
  return String(value ?? '').trim();
}

function factoryCafe24DetailFirstText(...values) {
  for (const value of values) {
    const text = factoryCafe24DetailText(value);
    if (text) return text;
  }
  return '';
}

function factoryCafe24DetailEscapeHtml(value) {
  return factoryCafe24DetailText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function factoryCafe24UniqueTextList(values = []) {
  return Array.from(new Set((values || []).map(value => String(value || '').trim()).filter(Boolean)));
}

function factoryCafe24DetailHasInlineBase64Image(html = '') {
  const text = String(html || '');
  return /<img\b[^>]*\bsrc\s*=\s*["']?\s*data:[^"'<>\s]*base64\s*,/i.test(text) ||
    /data:[^"'<>\s]*image\/[a-z0-9.+-]+;base64\s*,/i.test(text) ||
    /data:[^"'<>\s]*base64\s*,/i.test(text);
}

function factoryCafe24DetailHasLongBase64Text(html = '') {
  const text = String(html || '');
  return factoryCafe24DetailHasInlineBase64Image(text) ||
    /base64\s*,\s*[A-Za-z0-9+/]{200,}={0,2}/i.test(text) ||
    /[A-Za-z0-9+/]{1200,}={0,2}/.test(text);
}

function factoryCafe24DetailHasLightImagePlaceholder(html = '') {
  const text = String(html || '');
  return /data-factory-light-image-key/i.test(text) ||
    /원본은\s*메모리\s*저장소/i.test(text) ||
    /data:image\/svg\+xml[^"'>]*%EC%9B%90%EB%B3%B8%EC%9D%80/i.test(text);
}

function factoryCafe24DetailAttr(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function factoryCafe24ExpandLightImageHtmlForTransfer(html = '') {
  const text = String(html || '');
  if (!/data-factory-light-image-key/i.test(text)) return text;
  const store = (typeof window !== 'undefined' && window.__factoryLightImageStore instanceof Map)
    ? window.__factoryLightImageStore
    : (typeof factoryLightImageStore === 'function' ? factoryLightImageStore() : null);
  if (!store || typeof store.get !== 'function') return text;
  return text.replace(/<img\b[^>]*\bdata-factory-light-image-key=(["'])(.*?)\1[^>]*>/gi, match => {
    const keyMatch = /\bdata-factory-light-image-key=(["'])(.*?)\1/i.exec(match);
    const key = String(keyMatch?.[2] || '').trim();
    const original = key ? String(store.get(key) || '').trim() : '';
    if (!/^data:image\//i.test(original)) return match;
    let next = match
      .replace(/\sdata-factory-light-image-key=(["']).*?\1/ig, '')
      .replace(/\sdata-factory-light-loaded=(["']).*?\1/ig, '');
    if (/\ssrc=(["']).*?\1/i.test(next)) {
      next = next.replace(/\ssrc=(["']).*?\1/i, ` src="${factoryCafe24DetailAttr(original)}"`);
    } else {
      next = next.replace(/^<img\b/i, `<img src="${factoryCafe24DetailAttr(original)}"`);
    }
    return next;
  });
}

const FACTORY_CAFE24_DETAIL_ADMIN_LABEL_PATTERNS = [
  '헤더',
  '훅',
  '핵심\\s*특징',
  '상세\\s*스펙',
  '사용\\s*시나리오',
  '비교\\s*우위',
  '소재\\s*\\/\\s*기술',
  '소재\\s*기술',
  '인증\\s*\\/\\s*수상',
  '인증\\s*수상',
  '리뷰\\s*\\/\\s*후기',
  '리뷰\\s*후기',
  '프로모션',
  '배송\\s*\\/\\s*포장',
  '배송\\s*포장',
  'FAQ',
  '자주\\s*묻는\\s*질문',
  '브랜드\\s*스토리',
  'CTA\\s*푸터',
  '푸터',
  'Header',
  'Hook',
  'Key\\s*Features',
  'Features',
  'Specifications',
  'Use\\s*Scenarios?',
  'Competitive\\s*Edge',
  'Material\\s*&\\s*Tech',
  'Material',
  'Tech',
  'Certifications?',
  'Reviews?',
  'Promotion',
  'Shipping',
  'Brand\\s*Story',
  'Footer',
];

function factoryCafe24DetailAdminLabelBodyPattern() {
  return `(?:\\d+\\s*[.)/·-]\\s*)?(?:${FACTORY_CAFE24_DETAIL_ADMIN_LABEL_PATTERNS.join('|')})(?:\\s*\\([^)]{1,40}\\))?`;
}

function factoryCafe24StripDetailAdminLabels(html = '') {
  let text = String(html || '');
  if (!text) return '';
  const body = factoryCafe24DetailAdminLabelBodyPattern();
  const bracketed = new RegExp(`[\\[【]\\s*${body}\\s*[\\]】]`, 'gi');
  const exactHeading = new RegExp(`<h([1-6])([^>]*)>\\s*(?:${body}|[\\[【]\\s*${body}\\s*[\\]】])\\s*<\\/h\\1>`, 'gi');
  const exactParagraph = new RegExp(`<p([^>]*)>\\s*(?:[\\[【]\\s*${body}\\s*[\\]】])\\s*<\\/p>`, 'gi');
  text = text.replace(exactHeading, '');
  text = text.replace(exactParagraph, '');
  text = text.replace(bracketed, '');
  text = text.replace(/>\s+</g, '><');
  return text.trim();
}

function factoryCafe24DetailAdminLabelHits(html = '') {
  const text = String(html || '');
  if (!text) return [];
  const body = factoryCafe24DetailAdminLabelBodyPattern();
  const hits = [];
  const headingRe = new RegExp(`<h[1-6][^>]*>\\s*([\\[【]?\\s*${body}\\s*[\\]】]?)\\s*<\\/h[1-6]>`, 'gi');
  const bracketRe = new RegExp(`[\\[【]\\s*(${body})\\s*[\\]】]`, 'gi');
  for (const match of text.matchAll(headingRe)) hits.push(match[1]);
  for (const match of text.matchAll(bracketRe)) hits.push(match[1]);
  return factoryCafe24UniqueTextList(hits.map(hit => String(hit || '').replace(/<[^>]+>/g, '').trim())).slice(0, 8);
}

function factoryCafe24DetailHtmlPreflight(html = '') {
  const text = String(html || '');
  if (!text.trim()) {
    return { ok: true, issues: [], tokenHits: [], adminLabelHits: [], hasInlineImage: false, hasLongBase64: false, hasLightPlaceholder: false, hasAdminLabels: false };
  }
  const lower = text.toLowerCase();
  const hasInlineImage = factoryCafe24DetailHasInlineBase64Image(text);
  const hasLongBase64 = factoryCafe24DetailHasLongBase64Text(text);
  const hasLightPlaceholder = factoryCafe24DetailHasLightImagePlaceholder(text);
  const adminLabelHits = factoryCafe24DetailAdminLabelHits(text);
  const tokenHits = hasLongBase64
    ? factoryCafe24UniqueTextList(FACTORY_CAFE24_DETAIL_HTML_MARKET_BLOCK_TOKENS.filter(token => lower.includes(token)))
    : [];
  const issues = [];
  if (hasInlineImage) {
    issues.push('상세설명 HTML에 base64 인라인 이미지가 포함되어 있습니다.');
  }
  if (hasLightPlaceholder) {
    issues.push('상세설명 HTML에 브라우저 전용 이미지 플레이스홀더가 포함되어 있습니다.');
  }
  if (tokenHits.length) {
    issues.push(`G마켓/옥션 금칙어로 오인될 수 있는 base64 조각: ${tokenHits.slice(0, 10).join(', ')}`);
  }
  if (adminLabelHits.length) {
    issues.push(`고객 상세페이지에 작업용 섹션 라벨이 남아 있습니다: ${adminLabelHits.join(', ')}`);
  }
  return {
    ok: issues.length === 0,
    issues,
    tokenHits,
    adminLabelHits,
    hasInlineImage,
    hasLongBase64,
    hasLightPlaceholder,
    hasAdminLabels: adminLabelHits.length > 0,
  };
}

function factoryCafe24DetailPayloadPreflight(product = {}) {
  const checks = FACTORY_CAFE24_DETAIL_HTML_FIELDS
    .map(field => {
      const html = product?.[field];
      const check = factoryCafe24DetailHtmlPreflight(html);
      return { field, html: String(html || ''), check };
    })
    .filter(entry => entry.html.trim());
  const failed = checks.filter(entry => !entry.check.ok);
  return {
    ok: failed.length === 0,
    checks,
    failed,
    unsafeFields: failed.map(entry => entry.field),
    issues: factoryCafe24UniqueTextList(failed.flatMap(entry => entry.check.issues || [])),
    tokenHits: factoryCafe24UniqueTextList(failed.flatMap(entry => entry.check.tokenHits || [])),
    adminLabelHits: factoryCafe24UniqueTextList(failed.flatMap(entry => entry.check.adminLabelHits || [])),
    hasInlineImage: failed.some(entry => entry.check.hasInlineImage),
    hasLongBase64: failed.some(entry => entry.check.hasLongBase64),
    hasLightPlaceholder: failed.some(entry => entry.check.hasLightPlaceholder),
    hasAdminLabels: failed.some(entry => entry.check.hasAdminLabels),
  };
}

const FACTORY_CAFE24_DETAIL_NAME_FIELDS = [
  'productName',
  'userProductName',
  'product_name',
  'jname',
  'name',
  'title',
  'item_name',
  'product_name_ko',
  'cafe24_product_name',
  'mall_product_name_ko',
  'shop_product_name',
];

function factoryCafe24DetailNormalizeName(value = '') {
  return typeof factoryNormalizeIdentityText === 'function'
    ? factoryNormalizeIdentityText(value)
    : String(value || '').replace(/\s+/g, '').toLowerCase();
}

function factoryCafe24DetailNameVariants(value = '') {
  const text = String(value || '').trim();
  if (!text) return [];
  const withoutHiddenPrefix = text.replace(/^검증용숨김\s+/i, '').trim();
  const withoutTrailingRunStamps = text.replace(/(?:\s+\d{8,14})+$/g, '').trim();
  const withoutPrefixAndRunStamps = withoutHiddenPrefix.replace(/(?:\s+\d{8,14})+$/g, '').trim();
  const variants = [
    text,
    withoutHiddenPrefix,
    withoutTrailingRunStamps,
    withoutPrefixAndRunStamps,
    text.replace(/test$/i, ''),
    withoutPrefixAndRunStamps.replace(/test$/i, '').trim(),
  ];
  const normalizedBase = factoryCafe24DetailNormalizeName(withoutPrefixAndRunStamps || withoutTrailingRunStamps || text);
  const productLikeTail = normalizedBase.match(/[가-힣A-Za-z0-9]{0,24}(?:보자기|수저집|복주머니|동전지갑|주머니|파우치|케이스|지갑)$/i)?.[0] || '';
  if (productLikeTail) variants.push(productLikeTail);
  return Array.from(new Set(
    variants
      .map(factoryCafe24DetailNormalizeName)
      .filter(term => term && term.length >= 3)
  ));
}

function factoryCafe24DetailTermsCompatible(term = '', expectedTerms = []) {
  const normalizedTerm = factoryCafe24DetailNormalizeName(term);
  if (!normalizedTerm) return false;
  return (expectedTerms || []).some(expected => {
    const normalizedExpected = factoryCafe24DetailNormalizeName(expected);
    if (!normalizedExpected) return false;
    if (normalizedTerm === normalizedExpected) return true;
    if (normalizedTerm.length >= 4 && normalizedExpected.endsWith(normalizedTerm)) return true;
    return (normalizedExpected.length >= 5 && normalizedTerm.includes(normalizedExpected)) ||
      (normalizedTerm.length >= 5 && normalizedExpected.includes(normalizedTerm));
  });
}

function factoryCafe24CollectDetailNameTerms(value, terms = [], depth = 0) {
  if (!value || depth > 3) return terms;
  if (Array.isArray(value)) {
    value.slice(0, 80).forEach(item => factoryCafe24CollectDetailNameTerms(item, terms, depth + 1));
    return terms;
  }
  if (typeof value !== 'object') return terms;
  FACTORY_CAFE24_DETAIL_NAME_FIELDS.forEach(field => {
    factoryCafe24DetailNameVariants(value[field]).forEach(term => terms.push(term));
  });
  ['raw', 'rawProduct', 'product', 'db_match', 'sinhwa_match', 'matched_product', 'db_product'].forEach(field => {
    if (value[field] && typeof value[field] === 'object') {
      factoryCafe24CollectDetailNameTerms(value[field], terms, depth + 1);
    }
  });
  return terms;
}

function factoryCafe24CurrentDetailNameTerms(factory = factoryRuntimeReadFactory(), appState = {}) {
  const product = factory.product || {};
  const finalDb = product.finalDb || {};
  const authoritativeName = typeof factoryAuthoritativeProductName === 'function'
    ? factoryAuthoritativeProductName(factory)
    : '';
  const authoritativeValues = [
    authoritativeName,
    product.userProductName,
    product.productName,
    appState.productName,
  ];
  const authoritativeTerms = Array.from(new Set(authoritativeValues.flatMap(factoryCafe24DetailNameVariants)));
  const secondaryValues = [
    appState.analysis?.product_name,
    appState.analysis?.name,
    product.analysis?.product_name,
    product.analysis?.name,
    finalDb.product_name,
    finalDb.cafe24_product_name,
    finalDb.name,
  ];
  const secondaryTerms = secondaryValues.flatMap(factoryCafe24DetailNameVariants);
  if (!authoritativeTerms.length) return Array.from(new Set(secondaryTerms));
  return Array.from(new Set([
    ...authoritativeTerms,
    ...secondaryTerms.filter(term => factoryCafe24DetailTermsCompatible(term, authoritativeTerms)),
  ]));
}

function factoryCafe24HeadingProductLikeTerms(html = '') {
  const headings = Array.from(String(html || '').matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi))
    .map(match => String(match[1] || '').replace(/<[^>]+>/g, ' '));
  const text = headings.join(' ');
  if (!text.trim()) return [];
  const terms = [];
  const pattern = /[가-힣A-Za-z0-9]{2,}(?:보자기|수저집|복주머니|동전지갑|주머니|파우치|케이스|지갑)/g;
  let match = null;
  while ((match = pattern.exec(text))) {
    factoryCafe24DetailNameVariants(match[0]).forEach(term => terms.push(term));
  }
  return Array.from(new Set(terms));
}

function factoryCafe24DetailForeignProductCheck(html = '', factory = factoryRuntimeReadFactory(), appState = {}) {
  const product = factory.product || {};
  const expectedTerms = factoryCafe24CurrentDetailNameTerms(factory, appState);
  if (!expectedTerms.length) return { ok: true, conflicts: [], expectedTerms };
  const expectedCompatible = term => factoryCafe24DetailTermsCompatible(term, expectedTerms);
  const candidateSources = [
    product.pendingCafe24Candidates,
    product.cafe24Candidates,
    product.pendingDbCandidates,
    product.dbCandidates,
    product.selectedCafe24Candidate,
    product.selectedDbCandidate,
    product.confirmedDb,
    product.cafe24Product,
    appState.dbMatchCandidates,
    appState.cafe24Candidates,
  ];
  const candidateTerms = Array.from(new Set(
    candidateSources.flatMap(source => factoryCafe24CollectDetailNameTerms(source, []))
  ));
  const headingTerms = factoryCafe24HeadingProductLikeTerms(html);
  const foreignTerms = Array.from(new Set([...candidateTerms, ...headingTerms]))
    .filter(term => term && !expectedCompatible(term));
  if (!foreignTerms.length) return { ok: true, conflicts: [], expectedTerms };
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const normalizedHtml = factoryCafe24DetailNormalizeName(text);
  const conflicts = foreignTerms.filter(term => normalizedHtml.includes(term)).slice(0, 8);
  return { ok: conflicts.length === 0, conflicts, expectedTerms };
}

function factoryCafe24BuildMarketSafeDetailHtml(finalDb = {}, factory = factoryRuntimeReadFactory()) {
  const product = factory.product || {};
  const confirmed = product.confirmedDb || {};
  const analysis = product.analysis || {};
  const inputName = typeof factoryAuthoritativeProductName === 'function'
    ? factoryAuthoritativeProductName(factory, [
      product.userProductName,
      product.productName,
      state?.productName,
      finalDb.product_name,
      confirmed.product_name,
      analysis.product_name,
      product.name,
    ])
    : String(product.userProductName || product.productName || state?.productName || '').trim();
  const name = factoryCafe24DetailFirstText(
    inputName,
    product.userProductName,
    product.productName,
    state?.productName,
    finalDb.product_name,
    finalDb.mall_product_name_ko,
    finalDb.db_product_name,
    finalDb.name,
    confirmed.product_name,
    confirmed.name,
    analysis.product_name,
    product.name,
    '상품',
  );
  const subtitle = factoryCafe24DetailFirstText(
    finalDb.summary_description,
    finalDb.simple_description,
    finalDb.short_description,
    finalDb.usage,
    finalDb.use_case,
    analysis.category,
  );
  const width = factoryCafe24DetailFirstText(finalDb.width, finalDb.product_width, finalDb.size_width, confirmed.width, confirmed.product_width);
  const height = factoryCafe24DetailFirstText(finalDb.height, finalDb.product_height, finalDb.size_height, confirmed.height, confirmed.product_height);
  const sizeText = factoryCafe24DetailFirstText(
    finalDb.size_text,
    finalDb.size,
    finalDb.product_size,
    finalDb.dimension,
    width && height ? `가로 ${width}mm / 세로 ${height}mm` : '',
  );
  const weight = factoryCafe24DetailFirstText(finalDb.product_weight, finalDb.weight, finalDb.weight_g, confirmed.product_weight, confirmed.weight);
  const material = factoryCafe24DetailFirstText(finalDb.product_material, finalDb.material, finalDb.cloth_fabric, confirmed.product_material, confirmed.material);
  const colors = factoryCafe24DetailFirstText(finalDb.color, finalDb.colors, finalDb.option_values, finalDb.option_value, confirmed.color, confirmed.colors);
  const usage = factoryCafe24DetailFirstText(finalDb.usage, finalDb.use_case, finalDb.product_usage, confirmed.usage, confirmed.use_case);
  const chips = [
    sizeText ? `사이즈 ${sizeText}` : '',
    weight ? `무게 ${weight}` : '',
    material ? `소재 ${material}` : '',
    colors ? `옵션 ${colors}` : '',
    usage ? `용도 ${usage}` : '',
  ].filter(Boolean);
  const bodyLines = [
    subtitle,
    sizeText ? `${name}은 ${sizeText} 규격으로 준비된 상품입니다.` : '',
    material ? `${material} 소재 정보를 기준으로 상세페이지 설명에 반영합니다.` : '',
    usage ? `${usage} 용도에 맞게 사용할 수 있습니다.` : '',
  ].filter(Boolean);
  return `
<div style="max-width:860px;margin:0 auto;padding:48px 24px;font-family:'Noto Sans KR','Malgun Gothic',Arial,sans-serif;color:#222;line-height:1.7;text-align:center;background:#fff;">
  <h2 style="margin:0 0 14px;font-size:34px;font-weight:800;">${factoryCafe24DetailEscapeHtml(name)}</h2>
  ${subtitle ? `<p style="margin:0 auto 28px;max-width:680px;font-size:19px;color:#555;">${factoryCafe24DetailEscapeHtml(subtitle)}</p>` : ''}
  ${bodyLines.length ? `<div style="margin:0 auto 28px;max-width:720px;text-align:left;font-size:17px;">${bodyLines.map(line => `<p style="margin:0 0 10px;">${factoryCafe24DetailEscapeHtml(line)}</p>`).join('')}</div>` : ''}
  ${chips.length ? `<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:24px;">${chips.map(chip => `<span style="display:inline-block;padding:8px 14px;border-radius:999px;background:#f3f0ea;color:#333;font-size:14px;">${factoryCafe24DetailEscapeHtml(chip)}</span>`).join('')}</div>` : ''}
</div>`.trim();
}

function factoryCafe24SanitizeDetailHtmlPayload(product = {}, finalDb = {}, factory, options = {}) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  FACTORY_CAFE24_DETAIL_HTML_FIELDS.forEach(field => {
    if (product?.[field]) {
      product[field] = factoryCafe24StripDetailAdminLabels(product[field]);
    }
  });
  const check = factoryCafe24DetailPayloadPreflight(product);
  if (check.ok) {
    if (options.recordDetailPreflight && factory.product) {
      const hasHtml = FACTORY_CAFE24_DETAIL_HTML_FIELDS.some(field => String(product?.[field] || '').trim());
      factory.product.cafe24DetailHtmlPreflight = {
        ok: true,
        checkedAt: Date.now(),
        message: hasHtml ? 'Cafe24 상세설명 HTML 안전검사 통과' : 'Cafe24 상세설명 HTML 없음',
      };
    }
    return product;
  }
  const fallbackHtml = options.allowSafeDetailFallback === true
    ? factoryCafe24BuildMarketSafeDetailHtml(finalDb, factory)
    : '';
  if (fallbackHtml) {
    product.description = fallbackHtml;
    product.mobile_description = fallbackHtml;
    product.separated_mobile_description = 'F';
  } else {
    delete product.description;
    delete product.mobile_description;
    if (product.separated_mobile_description === 'F') delete product.separated_mobile_description;
  }
  if (options.recordDetailPreflight && factory.product) {
    factory.product.cafe24DetailHtmlPreflight = {
      ok: false,
      replaced: !!fallbackHtml,
      checkedAt: Date.now(),
      unsafeFields: check.unsafeFields,
      issues: check.issues,
      tokenHits: check.tokenHits,
      adminLabelHits: check.adminLabelHits,
      message: fallbackHtml
        ? `상세설명 HTML(${check.unsafeFields.join(', ')})에 base64 이미지 문자열이 있어 별도 허용된 안전 상세설명으로 대체했습니다.`
        : `상세설명 HTML(${check.unsafeFields.join(', ')})에 base64 이미지 문자열이 있어 대체문 없이 전송에서 제외했습니다.`,
    };
    factory.product.cafe24ApiStatus = factory.product.cafe24DetailHtmlPreflight.message;
    if (typeof factoryLog === 'function') {
      factoryLog(`${factory.product.cafe24DetailHtmlPreflight.message} ${check.issues.join(' ')}`, fallbackHtml ? 'ok' : 'error');
    }
  }
  return product;
}

function factoryCurrentPreviewSectionStatus(appState = (typeof state !== 'undefined' ? state : {})) {
  const requiredSections = typeof orderedSections === 'function' ? orderedSections() : [];
  const requiredIds = requiredSections.map(section => section.id).filter(Boolean);
  const generatedIds = requiredIds.filter(id => !!(
    appState.sectionContents?.[id] ||
    appState.sectionGenerationMeta?.[id] ||
    appState.sectionImages?.[id]
  ));
  return {
    requiredSections,
    requiredIds,
    generatedIds,
    generated: generatedIds.length,
    total: requiredIds.length,
    complete: requiredIds.length > 0 && generatedIds.length >= requiredIds.length,
  };
}

function factoryCafe24ResolveSectionScopeCheck(appState = {}, currentScope = {}, requiredIds = [], currentSectionIds = []) {
  const required = Array.isArray(requiredIds) ? requiredIds.filter(Boolean) : [];
  const current = new Set(Array.isArray(currentSectionIds) ? currentSectionIds.filter(Boolean) : []);
  const allRequiredSectionsVerified = required.length > 0 && required.every(id => current.has(id));
  if (allRequiredSectionsVerified) {
    return {
      ok: true,
      blocked: false,
      reason: '',
      productKeyWarning: false,
      message: '',
      inferredFrom: 'verified-section-contents',
    };
  }
  const sectionScopeRecords = typeof sectionWorkScopeFromContent === 'function'
    ? Array.from(current).map(sectionId => sectionWorkScopeFromContent(
        appState?.sectionContents?.[sectionId],
        appState?.sectionGenerationMeta?.[sectionId] || {},
      ))
    : [];
  const hasScopeIdentity = record => !!(
    record?.scopeKey ||
    record?.currentRunId ||
    record?.generationRunId ||
    record?.productKey ||
    record?.inputImageFingerprint
  );
  const explicitSectionScopeRecords = sectionScopeRecords.filter(hasScopeIdentity);
  const partialSectionScopeChecks = typeof sectionWorkScopeMatchesForDetailTransfer === 'function'
    ? explicitSectionScopeRecords.map(record => sectionWorkScopeMatchesForDetailTransfer(record, currentScope))
    : [];
  const failedExplicitSectionScopeCheck = partialSectionScopeChecks.find(check => !check?.ok);
  if (
    explicitSectionScopeRecords.length > 0 &&
    partialSectionScopeChecks.length === explicitSectionScopeRecords.length &&
    partialSectionScopeChecks.every(check => check?.ok)
  ) {
    return {
      ok: true,
      blocked: false,
      reason: '',
      productKeyWarning: false,
      message: '',
       inferredFrom: explicitSectionScopeRecords.length === sectionScopeRecords.length
         ? 'verified-partial-section-contents'
         : 'verified-partial-section-contents-with-legacy',
    };
  }
  if (failedExplicitSectionScopeCheck) return failedExplicitSectionScopeCheck;
  const record = appState?.sectionWorkScope || appState?.compPage?.sectionWorkScope || {};
  if (typeof sectionWorkScopeMatchesForDetailTransfer === 'function') {
    const aggregateCheck = sectionWorkScopeMatchesForDetailTransfer(record, currentScope);
    if (aggregateCheck.ok) return aggregateCheck;
    if (
      currentSectionIds.some(sectionId => !!appState?.sectionContents?.[sectionId]) &&
      explicitSectionScopeRecords.length === 0 &&
      !hasScopeIdentity(record) &&
      currentScope?.currentRunId &&
      currentScope?.productKey &&
      currentScope?.inputImageFingerprint
    ) {
      return {
        ok: true,
        blocked: false,
        reason: '',
        productKeyWarning: false,
        message: '',
        inferredFrom: 'legacy-partial-section-contents',
      };
    }
    return aggregateCheck;
  }
  return {
    ok: typeof sectionWorkScopeMatches === 'function'
      ? sectionWorkScopeMatches(record, currentScope)
      : !!(record && Object.keys(record).length),
    blocked: true,
    reason: 'section-scope-missing',
    productKeyWarning: false,
    message: '',
  };
}

function factoryCafe24CurrentScopedDetailHtml(factory = factoryRuntimeReadFactory()) {
  const appState = typeof state !== 'undefined' ? state : {};
  const assets = Array.isArray(factory.assets) ? factory.assets : [];
  const detailHtmlProductCheck = html => {
    const product = factory.product || {};
    const finalDb = product.finalDb || {};
    const candidates = [
      product.userProductName,
      product.productName,
      appState.productName,
      finalDb.product_name,
      finalDb.cafe24_product_name,
      finalDb.name,
    ]
      .map(value => typeof factoryNormalizeIdentityText === 'function'
        ? factoryNormalizeIdentityText(value)
        : String(value || '').replace(/\s+/g, '').toLowerCase())
      .filter(value => value && value.length >= 3);
    const terms = Array.from(new Set(candidates));
    if (!terms.length) return { ok: true, terms };
    const text = String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    const normalizedHtml = typeof factoryNormalizeIdentityText === 'function'
      ? factoryNormalizeIdentityText(text)
      : text.replace(/\s+/g, '').toLowerCase();
    return { ok: terms.some(term => normalizedHtml.includes(term)), terms };
  };
  let sectionExportBlocked = null;
  try {
    const previewStatus = factoryCurrentPreviewSectionStatus(appState);
    const sectionCount = previewStatus.generated;
    const currentSectionScope = typeof sectionWorkScopeMeta === 'function' ? sectionWorkScopeMeta() : {};
    const requiredSections = previewStatus.requiredSections;
    const requiredIds = previewStatus.requiredIds;
    const currentSectionIds = previewStatus.generatedIds;
    const missingPreviewSections = requiredSections.filter(section => !currentSectionIds.includes(section.id));
    const sectionScopeCheck = factoryCafe24ResolveSectionScopeCheck(
      appState,
      currentSectionScope,
      requiredIds,
      currentSectionIds
    );
    const sectionScopeOk = !!sectionScopeCheck.ok;
    if (sectionScopeOk && typeof buildExportHtml === 'function' && sectionCount) {
      const rawHtml = buildExportHtml(appState.analysis || factory.product?.analysis || {}, appState.sectionContents, appState.sectionImages || {}, appState.detailImageBlocks || []);
      const html = factoryCafe24StripDetailAdminLabels(rawHtml);
      if (html && /<[^>]+>/.test(String(html))) {
        const safeCheck = factoryCafe24DetailHtmlPreflight(html);
        if (!safeCheck.ok && safeCheck.hasAdminLabels) {
          return {
            html: '',
            source: 'detail-admin-label-blocked',
            blocked: true,
            sectionCount,
            message: `상세페이지 HTML에 작업용 라벨이 남아 있어 전송하지 않습니다: ${safeCheck.adminLabelHits.slice(0, 3).join(', ')}. 섹션 내용을 다시 확인해주세요.`,
          };
        }
        const foreignCheck = factoryCafe24DetailForeignProductCheck(html, factory, appState);
        if (!foreignCheck.ok) {
          return {
            html: '',
            source: 'detail-foreign-product-blocked',
            blocked: true,
            sectionCount,
            message: `상세페이지 HTML에 현재 상품과 다른 상품명 단서가 남아 있어 전송하지 않습니다: ${foreignCheck.conflicts.slice(0, 3).join(', ')}. 현재 상품 기준으로 섹션을 다시 생성해주세요.`,
          };
        }
          const check = detailHtmlProductCheck(html);
          const warningMessages = [
            sectionScopeCheck.productKeyWarning ? sectionScopeCheck.message : '',
            !check.ok ? '상품명 문구가 HTML에 직접 보이지 않지만 입력 이미지 원본 기준이 맞아 등록 대상으로 유지합니다.' : '',
          ].filter(Boolean);
        return {
          html: String(html),
          source: 'current-section-export',
          productCheckWarning: !!warningMessages.length,
          sectionCount,
          message: warningMessages.join(' '),
        };
      }
    }
    if (sectionCount) {
      sectionExportBlocked = {
        html: '',
        source: missingPreviewSections.length ? 'section-preview-incomplete' : 'section-scope-blocked',
        blocked: true,
        sectionCount,
        totalSections: requiredIds.length,
        message: missingPreviewSections.length
          ? `실제 미리보기에 생성된 섹션이 ${sectionCount}/${requiredIds.length}개입니다. 남은 섹션을 생성하거나 미리보기에서 직접 채워주세요.`
          : (sectionScopeCheck.message || '실제 미리보기 상세페이지를 전송 HTML로 만들 수 없습니다. 미리보기 상태를 확인해주세요.'),
      };
    }
  } catch(e) {
    sectionExportBlocked = { html: '', source: 'section-export-error', blocked: true, error: e?.message || String(e) };
  }
  const detailAssets = assets
    .filter(asset =>
      asset &&
      !asset.rejected &&
      (asset.stageId === 'detail' || asset.type === 'html' || asset.html) &&
      (typeof factoryAssetHasCurrentProductPayload !== 'function' ||
        factoryAssetHasCurrentProductPayload(asset, factory, { allowHtml: true }))
    )
    .sort((a, b) => {
      const scoreA = (a.used ? 10 : 0) + (a.stageId === 'detail' ? 5 : 0) + Number(a.createdAt || 0) / 10000000000000;
      const scoreB = (b.used ? 10 : 0) + (b.stageId === 'detail' ? 5 : 0) + Number(b.createdAt || 0) / 10000000000000;
      return scoreB - scoreA;
    });
  for (const asset of detailAssets) {
    const html = factoryCafe24StripDetailAdminLabels(asset.html || asset.content || asset.value || '');
    if (html && /<[^>]+>/.test(html)) {
      const safeCheck = factoryCafe24DetailHtmlPreflight(html);
      if (!safeCheck.ok && safeCheck.hasAdminLabels) {
        return {
          html: '',
          source: 'detail-admin-label-blocked',
          blocked: true,
          asset,
          message: `저장된 상세페이지 HTML에 작업용 라벨이 남아 있어 전송에서 제외했습니다: ${safeCheck.adminLabelHits.slice(0, 3).join(', ')}. 현재 작업 상세페이지를 다시 저장해주세요.`,
        };
      }
      if (safeCheck.hasLightPlaceholder) {
        return {
          html: '',
          source: 'detail-light-placeholder-blocked',
          blocked: true,
          asset,
          message: '저장된 상세페이지 HTML에 실제 이미지가 아닌 브라우저 전용 이미지 자리표시자가 남아 있어 전송에서 제외했습니다. 현재 작업 상세페이지를 다시 저장해주세요.',
        };
      }
      const foreignCheck = factoryCafe24DetailForeignProductCheck(html, factory, appState);
      if (!foreignCheck.ok) {
        return {
          html: '',
          source: 'detail-foreign-product-blocked',
          blocked: true,
          asset,
          message: `저장된 상세페이지 HTML에 현재 상품과 다른 상품명 단서가 남아 있어 전송에서 제외했습니다: ${foreignCheck.conflicts.slice(0, 3).join(', ')}. 현재 작업 상세페이지를 다시 저장해주세요.`,
        };
      }
      const check = detailHtmlProductCheck(html);
      if (check.ok) return { html, source: 'detail-asset', asset };
      return {
        html: '',
        source: 'detail-product-mismatch',
        blocked: true,
        message: `저장된 상세페이지 HTML이 현재 상품명 단서와 맞지 않아 전송에서 제외했습니다. 현재 미리보기 섹션을 다시 만들거나 현재 작업 상세페이지를 다시 저장해주세요. 확인 단서: ${check.terms.slice(0, 3).join(', ')}`,
      };
    }
  }
  if (sectionExportBlocked) return sectionExportBlocked;
  return { html: '', source: '' };
}

function factoryCafe24GeneratedDetailHtml(factory = factoryRuntimeReadFactory()) {
  return factoryCafe24CurrentScopedDetailHtml(factory).html || '';
}

function factoryCafe24EnsureScopedDetailHtmlPayload(product = {}, finalDb = {}, factory, options = {}) {
  if (!factory || typeof factory !== 'object') throw new TypeError('factory draft is required');
  const providedHtml = String(options.detailHtml || options.scopedDetailHtml || options.currentDetailHtml || '').trim();
  const providedSource = String(options.detailSource || options.scopedDetailSource || '').trim();
  const scoped = providedHtml
    ? { html: factoryCafe24StripDetailAdminLabels(providedHtml), source: providedSource || 'final-registration-preserved' }
    : factoryCafe24CurrentScopedDetailHtml(factory);
  if (scoped.html) {
    const html = factoryCafe24StripDetailAdminLabels(scoped.html);
    product.description = html;
    product.mobile_description = html;
    product.separated_mobile_description = 'F';
    if (options.recordDetailPreflight && factory.product) {
      factory.product.cafe24DetailHtmlScope = {
        ok: true,
        source: scoped.source || 'current',
        checkedAt: Date.now(),
        message: `현재 작업 상세설명 HTML 사용: ${scoped.source || '현재 작업'}`,
      };
    }
    return product;
  }

  if (scoped.blocked) {
    const fallbackHtml = options.allowSafeDetailFallback === true
      ? factoryCafe24BuildMarketSafeDetailHtml(finalDb, factory)
      : '';
    if (fallbackHtml) {
      product.description = fallbackHtml;
      product.mobile_description = fallbackHtml;
      product.separated_mobile_description = 'F';
    } else {
      FACTORY_CAFE24_DETAIL_HTML_FIELDS.forEach(field => {
        delete product[field];
      });
      if (product.separated_mobile_description === 'F') delete product.separated_mobile_description;
    }
    if (options.recordDetailPreflight && factory.product) {
      factory.product.cafe24DetailHtmlScope = {
        ok: !!fallbackHtml,
        blocked: true,
        replaced: !!fallbackHtml,
        source: scoped.source || 'section-blocked',
        sectionCount: scoped.sectionCount || 0,
        checkedAt: Date.now(),
        message: fallbackHtml
          ? '현재 상세페이지 섹션 출처가 현재 상품/입력 이미지 기준과 맞지 않아 현재 상품 기준 안전 상세설명으로 대체했습니다.'
          : (scoped.source === 'section-export-error'
            ? `현재 상세페이지 섹션을 HTML로 만드는 중 오류가 나서 대체문 없이 전송에서 제외했습니다: ${scoped.error || '오류'}`
            : '상세페이지 섹션 출처가 현재 상품/입력 이미지 기준과 맞지 않아 대체문 없이 전송에서 제외했습니다.'),
      };
      factory.product.cafe24ApiStatus = factory.product.cafe24DetailHtmlScope.message;
      if (typeof factoryLog === 'function') factoryLog(factory.product.cafe24DetailHtmlScope.message, fallbackHtml ? 'ok' : 'error');
    }
    return product;
  }

  const hadUnscopedHtml = FACTORY_CAFE24_DETAIL_HTML_FIELDS.some(field => String(product?.[field] || '').trim());
  if (!hadUnscopedHtml) {
    const fallbackHtml = options.allowSafeDetailFallback === true
      ? factoryCafe24BuildMarketSafeDetailHtml(finalDb, factory)
      : '';
    if (fallbackHtml) {
      product.description = fallbackHtml;
      product.mobile_description = fallbackHtml;
      product.separated_mobile_description = 'F';
      if (options.recordDetailPreflight && factory.product) {
        factory.product.cafe24DetailHtmlScope = {
          ok: true,
          replaced: true,
          source: 'safe-fallback',
          checkedAt: Date.now(),
          message: '현재 작업 상세 HTML이 없어 현재 상품 기준 안전 상세설명으로 채웠습니다.',
        };
        factory.product.cafe24ApiStatus = factory.product.cafe24DetailHtmlScope.message;
        if (typeof factoryLog === 'function') factoryLog(factory.product.cafe24DetailHtmlScope.message, 'ok');
      }
    }
    return product;
  }

  const fallbackHtml = options.allowSafeDetailFallback === true
    ? factoryCafe24BuildMarketSafeDetailHtml(finalDb, factory)
    : '';
  if (fallbackHtml) {
    product.description = fallbackHtml;
    product.mobile_description = fallbackHtml;
    product.separated_mobile_description = 'F';
  } else {
    delete product.description;
    delete product.mobile_description;
    if (product.separated_mobile_description === 'F') delete product.separated_mobile_description;
  }
  if (options.recordDetailPreflight && factory.product) {
    factory.product.cafe24DetailHtmlScope = {
      ok: !!fallbackHtml,
      replaced: !!fallbackHtml,
      checkedAt: Date.now(),
      message: fallbackHtml
        ? '상세설명 HTML 출처가 현재 상품/입력 이미지 기준과 맞지 않아 별도 허용된 안전 상세설명으로 대체했습니다.'
        : '상세설명 HTML 출처가 현재 상품/입력 이미지 기준과 맞지 않아 대체문 없이 전송에서 제외했습니다.',
    };
    factory.product.cafe24ApiStatus = factory.product.cafe24DetailHtmlScope.message;
    if (typeof factoryLog === 'function') {
      factoryLog(factory.product.cafe24DetailHtmlScope.message, fallbackHtml ? 'ok' : 'error');
    }
  }
  return product;
}

function factoryApplyCafe24CreateReferenceDefaults(product = {}) {
  if (!String(product.manufacturer_code || '').trim() || product.manufacturer_code === 'M0000000') {
    product.manufacturer_code = 'M0000CJP';
  }
  product.supplier_code ||= 'S0000000';
  if (!String(product.brand_code || '').trim() || product.brand_code === 'B0000000') {
    product.brand_code = 'B00000PU';
  }
  const hasOrigin = ['made_in_code', 'origin_classification', 'origin_place_value', 'origin_place_code', 'origin_place_no']
    .some(field => String(product[field] ?? '').trim() !== '');
  if (!hasOrigin) {
    product.origin_classification = 'F';
    product.origin_place_no = 102;
  }
  return product;
}

function factoryBuildCafe24UpdatePayload(finalDb = {}, fields = [], factory = factoryRuntimeReadFactory(), options = {}) {
  const product = {};
  const direct = [
    ['product_name', 'product_name'],
    ['mall_product_name_ko', 'product_name'],
    ['product_name_en', 'eng_product_name'],
    ['eng_product_name', 'eng_product_name'],
    ['english_product_name', 'eng_product_name'],
    ['admin_product_name', 'internal_product_name'],
    ['supplier_product_name', 'supply_product_name'],
    ['model_name', 'model_name'],
    ['custom_product_code', 'custom_product_code'],
    ['summary_description', 'summary_description'],
    ['simple_description', 'simple_description'],
    ['detail_html_pc', 'description'],
    ['detail_html_mobile', 'mobile_description'],
    ['translated_description', 'translated_description'],
    ['translated_additional_description', 'translated_additional_description'],
    ['additional_description', 'additional_information'],
    ['sale_price', 'price'],
    ['consumer_price', 'retail_price'],
    ['purchase_price', 'supply_price'],
    ['additional_price', 'additional_price'],
    ['tax_calculation', 'tax_calculation'],
    ['tax_type', 'tax_type'],
    ['tax_rate', 'tax_rate'],
    ['product_status', 'product_condition'],
    ['product_subtitle', 'price_content'],
    ['price_content', 'price_content'],
    ['hscode', 'hscode'],
    ['country_hscode', 'country_hscode'],
    ['weight', 'product_weight'],
    ['shipping_weight', 'product_weight'],
    ['product_weight', 'product_weight'],
    ['weight_g', 'product_weight'],
    ['product_weight_g', 'product_weight'],
    ['shipping_weight_g', 'product_weight'],
    ['product_volume', 'product_volume'],
    ['product_used_month', 'product_used_month'],
    ['material', 'product_material'],
    ['product_material', 'product_material'],
    ['english_material', 'english_product_material'],
    ['english_product_material', 'english_product_material'],
    ['cloth_fabric', 'cloth_fabric'],
    ['origin', 'made_in_code'],
    ['origin_classification', 'origin_classification'],
    ['origin_place_value', 'origin_place_value'],
    ['clearance_category_code', 'clearance_category_code'],
    ['clearance_category_kor', 'clearance_category_kor'],
    ['clearance_category_eng', 'clearance_category_eng'],
    ['classification_code', 'classification_code'],
    ['adult_certification', 'adult_certification'],
    ['set_product_type', 'set_product_type'],
    ['payment_info', 'payment_info'],
    ['payment_info_by_product', 'payment_info_by_product'],
    ['shipping_info', 'shipping_info'],
    ['shipping_info_by_product', 'shipping_info_by_product'],
    ['product_shipping_type', 'product_shipping_type'],
    ['shipping_method', 'shipping_method'],
    ['shipping_scope', 'shipping_scope'],
    ['shipping_calculation', 'shipping_calculation'],
    ['prepaid_shipping_fee', 'prepaid_shipping_fee'],
    ['shipping_place_code', 'shipping_place_code'],
    ['shipping_area', 'shipping_area'],
    ['shipping_period', 'shipping_period'],
    ['shipping_fee_type', 'shipping_fee_type'],
    ['shipping_fee', 'shipping_fee'],
    ['shipping_fee_by_product', 'shipping_fee_by_product'],
    ['shipping_rates', 'shipping_rates'],
    ['return_exchange_info', 'exchange_info'],
    ['refund_info', 'exchange_info'],
    ['exchange_info_by_product', 'exchange_info_by_product'],
    ['service_info', 'service_info'],
    ['service_info_by_product', 'service_info_by_product'],
    ['separated_mobile_description', 'separated_mobile_description'],
    ['purchase_limit', 'buy_limit_by_product'],
    ['buy_limit_type', 'buy_limit_type'],
    ['buy_group_list', 'buy_group_list'],
    ['buy_member_id_list', 'buy_member_id_list'],
    ['repurchase_restriction', 'repurchase_restriction'],
    ['single_purchase_restriction', 'single_purchase_restriction'],
    ['single_purchase', 'single_purchase'],
    ['buy_unit_type', 'buy_unit_type'],
    ['buy_unit', 'buy_unit'],
    ['order_quantity_limit_type', 'order_quantity_limit_type'],
    ['min_order_quantity', 'minimum_quantity'],
    ['max_order_quantity', 'maximum_quantity'],
    ['points', 'points_by_product'],
    ['points_amount', 'points_amount'],
    ['points_setting_by_payment', 'points_setting_by_payment'],
    ['except_member_points', 'except_member_points'],
    ['trend_code', 'trend_code'],
    ['made_date', 'made_date'],
    ['release_date', 'release_date'],
    ['expiration_date', 'expiration_date'],
    ['sold_out', 'sold_out'],
    ['soldout_message', 'soldout_message'],
    ['promotion_period', 'promotion_period'],
    ['use_naverpay', 'use_naverpay'],
    ['naverpay_type', 'naverpay_type'],
    ['use_kakaopay', 'use_kakaopay'],
    ['kakaopay_type', 'kakaopay_type'],
    ['market_sync', 'market_sync'],
    ['exposure_limit_type', 'exposure_limit_type'],
    ['exposure_group_list', 'exposure_group_list'],
    ['size_guide', 'size_guide'],
  ];
  direct.forEach(([from, to]) => {
    const value = finalDb[from];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      product[to] = to === 'product_weight'
        ? factoryCafe24WeightValueForPayload(value, from, finalDb)
        : factoryCafe24PayloadValue(to, value);
    }
  });
  const display = factoryTruthyCafe24Flag(finalDb.display || finalDb.display_status);
  if (display) product.display = display;
  const selling = factoryTruthyCafe24Flag(finalDb.selling || finalDb.selling_status);
  if (selling) product.selling = selling;
  factoryMergeCafe24VisibleFormPayload(product, finalDb, factory);
  if (options.includeResolvedSizeAdditionalInformation === true) {
    factoryCafe24MergeResolvedSizeAdditionalInformation(product, finalDb);
  }
  const inputProductName = typeof factoryAuthoritativeProductName === 'function'
    ? factoryAuthoritativeProductName(factory)
    : String(factory?.product?.userProductName || factory?.product?.productName || state?.productName || '').trim();
  if (inputProductName) product.product_name = inputProductName;
  fields.forEach(field => {
    if (!field?.custom || !field.enabled) return;
    const value = finalDb[field.id];
    if (value === undefined || value === null || String(value).trim() === '') return;
    const apiField = factoryCafe24ApiFieldNameFromSource(field);
    if (!apiField) return;
    product[apiField] = apiField === 'product_weight'
      ? factoryCafe24WeightValueForPayload(value, field.id || field.apiField, finalDb)
      : factoryCafe24PayloadValue(apiField, value);
  });
  if (inputProductName) product.product_name = inputProductName;
  factoryRemoveCafe24InvalidReferenceCodePayloadFields(product);
  if (options.includeCreateReferenceDefaults === true) {
    factoryApplyCafe24CreateReferenceDefaults(product);
  }
  factoryCafe24EnsureScopedDetailHtmlPayload(product, finalDb, factory, options);
  factoryCafe24SanitizeDetailHtmlPayload(product, finalDb, factory, options);
  factoryCafe24PruneEmptyProductPayload(product);
  if (!options.onlyChanged) return product;
  const filtered = factoryFilterCafe24ChangedProductPayload(product, factory);
  factoryCafe24PruneEmptyProductPayload(filtered);
  const detailPreflight = factory?.product?.cafe24DetailHtmlPreflight || {};
  if (detailPreflight.replaced) {
    FACTORY_CAFE24_DETAIL_HTML_FIELDS.forEach(field => {
      if (String(product?.[field] || '').trim()) filtered[field] = product[field];
    });
    if (product.separated_mobile_description !== undefined && product.separated_mobile_description !== null) {
      filtered.separated_mobile_description = product.separated_mobile_description;
    }
  }
  return filtered;
}

function factoryCafe24OptionValuePayload(values = []) {
  return factoryDedupeRealOptionValues(values, { allowNumeric: true }).map(value => ({ option_text: value }));
}

function factoryCafe24ExistingOptionText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    const match = /(?:^|[;\s{])option_text=([^;}]*)/i.exec(value);
    return factoryCleanRealOptionValue(match ? match[1] : value, { allowNumeric: true });
  }
  if (typeof value !== 'object') return factoryCleanRealOptionValue(value, { allowNumeric: true });
  return factoryCleanRealOptionValue(
    value.option_text || value.optionText || value.text || value.value || value.name,
    { allowNumeric: true },
  );
}

function factoryCafe24ExistingOptionRoot(raw = {}) {
  if (!raw || typeof raw !== 'object') return {};
  const roots = [raw.option, raw.product_options, raw].filter(root => root && typeof root === 'object');
  return roots.find(root =>
    Array.isArray(root.options) ||
    root.has_option !== undefined ||
    root.option_type !== undefined ||
    root.option_list_type !== undefined ||
    root.select_one_by_option !== undefined
  ) || {};
}

function factoryCafe24ExistingOptionGroup(raw = {}, optionName = '') {
  const root = factoryCafe24ExistingOptionRoot(raw);
  const groups = [
    ...(Array.isArray(root.options) ? root.options : []),
    ...(Array.isArray(raw.options) ? raw.options : []),
  ].filter(group => group && typeof group === 'object');
  if (!groups.length) return null;
  const wanted = factoryDbNormalizeKey(optionName || '');
  if (wanted) {
    const found = groups.find(group => factoryDbNormalizeKey(group.option_name || group.optionName || group.name || '') === wanted);
    if (found) return found;
  }
  return groups[0];
}

const FACTORY_CAFE24_OPTION_SETTING_KEYS = ['has_option', 'option_type', 'option_list_type', 'select_one_by_option'];
const FACTORY_CAFE24_ADDITIONAL_OPTION_LENGTHS = ['1~30', '50', '100', '200'];

function factoryCafe24OptionFlag(value, fallback = 'F') {
  const flag = factoryTruthyCafe24Flag(value);
  if (flag) return flag;
  const raw = String(value ?? '').trim().toUpperCase();
  return /^(T|F)$/.test(raw) ? raw : fallback;
}

function factoryCafe24AdditionalOptionTextLength(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '50';
  if (/^1\s*~\s*30$/.test(raw) || raw === '30') return '1~30';
  if (FACTORY_CAFE24_ADDITIONAL_OPTION_LENGTHS.includes(raw)) return raw;
  return '50';
}

function factoryNormalizeCafe24AdditionalOption(row = {}, index = 0) {
  const name = String(
    row.additional_option_name ||
    row.additionalOptionName ||
    row.name ||
    row.label ||
    ''
  ).trim();
  const length = factoryCafe24AdditionalOptionTextLength(
    row.additional_option_text_length ||
    row.additionalOptionTextLength ||
    row.textLength ||
    row.text_length ||
    row.length ||
    ''
  );
  const required = factoryCafe24OptionFlag(
    row.required_additional_option ||
    row.requiredAdditionalOption ||
    row.required ||
    row.is_required ||
    'T',
    'T'
  );
  return {
    key: row.key || row.additional_option_code || `additional_${index + 1}`,
    name,
    textLength: length,
    required,
  };
}

function factoryCafe24AdditionalOptionsFromRoot(root = {}) {
  const source = root?.additional_options ?? root?.additionalOptions ?? [];
  const rows = Array.isArray(source)
    ? source
    : (source && typeof source === 'object' ? [source] : []);
  return rows
    .map((row, index) => factoryNormalizeCafe24AdditionalOption(row, index))
    .filter(row => row.name);
}

function factoryNormalizeCafe24AttachedFileOption(row = {}, index = 0) {
  if (!row || typeof row !== 'object') return null;
  const name = String(
    row.attached_file_option_name ||
    row.attachedFileOptionName ||
    row.file_option_name ||
    row.option_name ||
    row.name ||
    row.label ||
    ''
  ).trim();
  const required = factoryCafe24OptionFlag(
    row.required_attached_file_option ||
    row.requiredAttachedFileOption ||
    row.required ||
    row.is_required ||
    'F',
    'F'
  );
  const sizeLimit = String(row.file_size_limit || row.fileSizeLimit || row.size_limit || row.max_size || '').trim();
  const extensions = String(row.file_extensions || row.fileExtensions || row.extension || row.extensions || '').trim();
  return {
    key: row.key || row.attached_file_option_code || `attached_${index + 1}`,
    name,
    required,
    sizeLimit,
    extensions,
    raw: cloneData(row),
  };
}

function factoryCafe24AttachedFileOptionsFromRoot(root = {}) {
  const source = root?.attached_file_option ?? root?.attachedFileOption;
  if (!source) return [];
  const rows = Array.isArray(source) ? source : (source && typeof source === 'object' ? [source] : []);
  return rows
    .map((row, index) => factoryNormalizeCafe24AttachedFileOption(row, index))
    .filter(Boolean);
}

function factoryCafe24OptionExtrasSource(root = {}) {
  return {
    useAdditionalOption: factoryCafe24OptionFlag(root.use_additional_option ?? root.useAdditionalOption, 'F'),
    additionalOptions: factoryCafe24AdditionalOptionsFromRoot(root),
    useAttachedFileOption: factoryCafe24OptionFlag(root.use_attached_file_option ?? root.useAttachedFileOption, 'F'),
    attachedFileOptions: factoryCafe24AttachedFileOptionsFromRoot(root),
    attachedFileOptionRaw: root.attached_file_option !== undefined ? cloneData(root.attached_file_option) : null,
  };
}

function factoryCafe24OptionExtrasTouched(factory = factoryRuntimeReadFactory()) {
  if (!factoryCafe24DraftMatchesCurrentProduct(factory)) return false;
  return !!factory.product?.cafe24OptionExtrasDraft?.touched;
}

function factoryCafe24OptionExtrasModel(factory = factoryRuntimeReadFactory(), raw = null) {
  const root = factoryCafe24ExistingOptionRoot(raw || factoryCafe24RawForForm(factory));
  const source = factoryCafe24OptionExtrasSource(root);
  const draft = factoryCafe24DraftMatchesCurrentProduct(factory) && factory.product?.cafe24OptionExtrasDraft?.touched
    ? factory.product.cafe24OptionExtrasDraft
    : null;
  if (!draft) return source;
  return {
    useAdditionalOption: factoryCafe24OptionFlag(draft.useAdditionalOption ?? source.useAdditionalOption, source.useAdditionalOption),
    additionalOptions: Array.isArray(draft.additionalOptions)
      ? draft.additionalOptions.map((row, index) => factoryNormalizeCafe24AdditionalOption(row, index)).filter(row => row.name)
      : source.additionalOptions,
    useAttachedFileOption: factoryCafe24OptionFlag(draft.useAttachedFileOption ?? source.useAttachedFileOption, source.useAttachedFileOption),
    attachedFileOptions: Array.isArray(draft.attachedFileOptions)
      ? draft.attachedFileOptions.map((row, index) => factoryNormalizeCafe24AttachedFileOption(row, index)).filter(Boolean)
      : source.attachedFileOptions,
    attachedFileOptionRaw: draft.attachedFileOptionRaw !== undefined ? cloneData(draft.attachedFileOptionRaw) : source.attachedFileOptionRaw,
  };
}

function factoryCafe24OptionExtrasPayload(factory = factoryRuntimeReadFactory(), raw = {}) {
  const root = factoryCafe24ExistingOptionRoot(raw);
  const touched = factoryCafe24OptionExtrasTouched(factory);
  const model = factoryCafe24OptionExtrasModel(factory, raw);
  const payload = {};
  if (touched || root.use_additional_option !== undefined || root.additional_options !== undefined) {
    payload.use_additional_option = model.useAdditionalOption || 'F';
    payload.additional_options = model.useAdditionalOption === 'T'
      ? model.additionalOptions.map(row => ({
        additional_option_name: row.name,
        additional_option_text_length: row.textLength || '50',
        required_additional_option: row.required || 'T',
      }))
      : [];
  }
  if (touched || root.use_attached_file_option !== undefined || root.attached_file_option !== undefined) {
    payload.use_attached_file_option = model.useAttachedFileOption || 'F';
    if (model.useAttachedFileOption === 'T') {
      if (root.attached_file_option !== undefined) {
        payload.attached_file_option = cloneData(root.attached_file_option);
      } else if (model.attachedFileOptionRaw !== undefined && model.attachedFileOptionRaw !== null) {
        payload.attached_file_option = cloneData(model.attachedFileOptionRaw);
      }
    }
  }
  return payload;
}

function factoryCafe24OptionSettingsTouched(factory = factoryRuntimeReadFactory()) {
  if (!factoryCafe24DraftMatchesCurrentProduct(factory)) return false;
  const settings = factory.product?.dbFieldSettings || {};
  return FACTORY_CAFE24_OPTION_SETTING_KEYS.some(key => !!settings[key]?.manualTouched);
}

function factoryCafe24OptionStructureTouched(factory = factoryRuntimeReadFactory()) {
  if (!factoryCafe24DraftMatchesCurrentProduct(factory)) return false;
  const settings = factory.product?.dbFieldSettings || {};
  const manualOptionTextTouched = ['option_name', 'option_values'].some(key => !!settings[key]?.manualTouched);
  const draftGroups = Array.isArray(factory.product?.cafe24OptionGroupsDraft) ? factory.product.cafe24OptionGroupsDraft : [];
  const optionSorterDraft = factoryCafe24OptionSorterDraft();
  return manualOptionTextTouched || draftGroups.length > 0 || optionSorterDraft.optionValues.length > 0;
}

function factoryCafe24VariantEditsForCurrent(factory = factoryRuntimeReadFactory()) {
  if (!factoryCafe24DraftMatchesCurrentProduct(factory)) return {};
  const edits = factory.product?.cafe24VariantEdits;
  return edits && typeof edits === 'object' ? edits : {};
}

function factoryCafe24CategoryTouched(factory = factoryRuntimeReadFactory()) {
  return !!factory.product?.dbFieldSettings?.category?.manualTouched;
}

function factoryCafe24IconTouched(factory = factoryRuntimeReadFactory()) {
  return !!factory.product?.cafe24IconDraft?.touched;
}

function factoryCafe24OptionSettingsFinalDb(factory = factoryRuntimeReadFactory(), finalDb = {}) {
  const merged = { ...(finalDb || {}) };
  if (!factoryCafe24DraftMatchesCurrentProduct(factory)) return merged;
  const settings = factory.product?.dbFieldSettings || {};
  FACTORY_CAFE24_OPTION_SETTING_KEYS.forEach(key => {
    const setting = settings[key];
    if (!setting) return;
    if (setting.manualTouched || String(setting.manualValue || '').trim() !== '') {
      merged[key] = setting.manualValue || '';
    }
  });
  return merged;
}

function factoryCafe24OptionsPayloadValueItems(values = [], existingGroup = null) {
  const existingValues = Array.isArray(existingGroup?.option_value)
    ? existingGroup.option_value
    : (Array.isArray(existingGroup?.optionValue) ? existingGroup.optionValue : []);
  const byText = new Map();
  existingValues.forEach(item => {
    const text = factoryCafe24ExistingOptionText(item);
    if (text) byText.set(factoryDbNormalizeKey(text), item);
  });
  return factoryDedupeRealOptionValues(values, { allowNumeric: true }).map(value => {
    const existing = byText.get(factoryDbNormalizeKey(value)) || {};
    const payload = {
      option_text: value,
    };
    if (existing && typeof existing === 'object') {
      ['value_no', 'option_color', 'additional_amount'].forEach(key => {
        if (existing[key] !== undefined && existing[key] !== null && String(existing[key]).trim() !== '') payload[key] = existing[key];
      });
    }
    return payload;
  });
}

function factoryCafe24OriginalOptionsPayload(groups = []) {
  return (Array.isArray(groups) ? groups : [])
    .map(group => {
      const name = String(group?.option_name || group?.optionName || group?.name || '').trim();
      const values = Array.isArray(group?.option_value)
        ? group.option_value
        : (Array.isArray(group?.optionValue) ? group.optionValue : []);
      const cleanValues = factoryDedupeRealOptionValues(
        values.map(item => factoryCafe24ExistingOptionText(item)).filter(Boolean),
        { allowNumeric: true },
      );
      return name && cleanValues.length
        ? { option_name: name, option_value: cleanValues.map(option_text => ({ option_text })) }
        : null;
    })
    .filter(Boolean);
}

function factoryCafe24OptionSetting(raw = {}, finalDb = {}, key, fallback = '', options = {}) {
  const optionRoot = factoryCafe24ExistingOptionRoot(raw);
  const preferFinalDb = options.preferFinalDb === true;
  const value = preferFinalDb
    ? (finalDb[key] ?? optionRoot[key] ?? raw[key] ?? raw.product_options?.[key] ?? fallback)
    : (optionRoot[key] ?? raw[key] ?? raw.product_options?.[key] ?? finalDb[key] ?? fallback);
  return value === undefined || value === null ? '' : value;
}

function factoryCafe24CleanOptionGroupsForPayload(groups = [], optionName = '색상', values = []) {
  const normalized = (Array.isArray(groups) ? groups : [])
    .map((group, index) => factoryNormalizeCafe24OptionGroup(group, index))
    .filter(group => group.name && group.values.length);
  if (normalized.length) return normalized;
  const cleanName = String(optionName || '').trim() || '색상';
  const cleanValues = factoryDedupeRealOptionValues(values, { allowNumeric: true });
  return cleanValues.length ? [{ key: 'group_1', name: cleanName, values: cleanValues, required_option: 'T', option_display_type: 'S' }] : [];
}

function factoryBuildCafe24OptionsUpdatePayload(factory = factoryRuntimeReadFactory(), raw = {}, finalDb = {}, optionName = '색상', values = [], groups = [], options = {}) {
  const cleanGroups = factoryCafe24CleanOptionGroupsForPayload(groups, optionName, values);
  const settingsOnly = options.settingsOnly === true;
  const preferFinalDbSettings = options.preferFinalDbSettings === true;
  const extrasTouched = factoryCafe24OptionExtrasTouched(factory);
  const extrasPayload = factoryCafe24OptionExtrasPayload(factory, raw);
  if (!cleanGroups.length && !settingsOnly && !extrasTouched) return null;
  const payload = {
    has_option: factoryCafe24PayloadValue('has_option', factoryCafe24OptionSetting(raw, finalDb, 'has_option', 'T', { preferFinalDb: preferFinalDbSettings })) || 'T',
    option_type: factoryCafe24PayloadValue('option_type', factoryCafe24OptionSetting(raw, finalDb, 'option_type', 'T', { preferFinalDb: preferFinalDbSettings })) || 'T',
    option_list_type: factoryCafe24PayloadValue('option_list_type', factoryCafe24OptionSetting(raw, finalDb, 'option_list_type', 'C', { preferFinalDb: preferFinalDbSettings })) || 'C',
    select_one_by_option: factoryCafe24PayloadValue('select_one_by_option', factoryCafe24OptionSetting(raw, finalDb, 'select_one_by_option', 'F', { preferFinalDb: preferFinalDbSettings })) || 'F',
  };
  if (cleanGroups.length) {
    payload.options = cleanGroups.map(group => {
      const existingGroup = factoryCafe24ExistingOptionGroup(raw, group.name);
      return {
        option_name: group.name,
        required_option: group.required_option || existingGroup?.required_option || 'T',
        option_display_type: group.option_display_type || existingGroup?.option_display_type || 'S',
        option_value: factoryCafe24OptionsPayloadValueItems(group.values, existingGroup),
      };
    });
  }
  Object.assign(payload, extrasPayload);
  return payload;
}

function factoryBuildCafe24ProductOptionsPayload(optionName, values = [], groups = []) {
  const cleanGroups = factoryCafe24CleanOptionGroupsForPayload(groups, optionName, values);
  return cleanGroups.map(group => {
    const cleanValues = factoryDedupeRealOptionValues(group.values || [], { allowNumeric: true });
    return {
      name: group.name,
      value: cleanValues,
      option_name: group.name,
      required_option: group.required_option || 'T',
      option_display_type: group.option_display_type || 'S',
      option_value: factoryCafe24OptionValuePayload(cleanValues),
    };
  });
}

function factoryCafe24VariantPayload(row, optionName, optionGroups = []) {
  const optionValue = String(row.option_value || '').trim();
  const variant = {};
  const pairs = Array.isArray(row.option_pairs) ? row.option_pairs.filter(item => item?.value) : [];
  if (pairs.length > 1) {
    variant.options = pairs.map((item, index) => ({
      name: item.name || optionGroups[index]?.name || `옵션${index + 1}`,
      value: item.value,
    }));
  } else if (optionValue) {
    variant.options = [{
      name: optionName || optionGroups[0]?.name || '색상',
      value: optionValue,
    }];
  }
  const display = factoryTruthyCafe24Flag(row.display);
  const selling = factoryTruthyCafe24Flag(row.selling);
  if (display) variant.display = display;
  if (selling) variant.selling = selling;
  if (row.additional_amount !== undefined && row.additional_amount !== null && String(row.additional_amount).trim() !== '') {
    variant.additional_amount = factoryCafe24PayloadValue('additional_amount', row.additional_amount);
  }
  if (row.custom_variant_code !== undefined && row.custom_variant_code !== null && String(row.custom_variant_code).trim() !== '') {
    variant.custom_variant_code = String(row.custom_variant_code).trim();
  }
  return variant;
}

function factoryCafe24VariantPayloadFromEdit(row = {}, edit = {}, optionName = '색상', optionGroups = []) {
  const variant = {};
  const has = key => Object.prototype.hasOwnProperty.call(edit || {}, key);
  if (has('option_value')) {
    const optionValue = String(row.option_value || edit.option_value || '').trim();
    if (optionValue) {
      variant.options = [{
        name: optionName || optionGroups[0]?.name || '색상',
        value: optionValue,
      }];
    }
  }
  if (has('display')) {
    const display = factoryTruthyCafe24Flag(row.display);
    if (display) variant.display = display;
  }
  if (has('selling')) {
    const selling = factoryTruthyCafe24Flag(row.selling);
    if (selling) variant.selling = selling;
  }
  if (has('additional_amount')) {
    if (String(row.additional_amount ?? '').trim() !== '') {
      variant.additional_amount = factoryCafe24PayloadValue('additional_amount', row.additional_amount);
    }
  }
  if (has('custom_variant_code')) {
    variant.custom_variant_code = String(row.custom_variant_code || '').trim();
  }
  return variant;
}

function factoryCafe24InventoryPayload(row = {}) {
  const inventory = {};
  const useInventory = factoryTruthyCafe24Flag(row.use_inventory);
  const displaySoldout = factoryTruthyCafe24Flag(row.display_soldout);
  const importantInventory = String(row.important_inventory || '').trim().toUpperCase();
  const inventoryControlType = String(row.inventory_control_type || '').trim().toUpperCase();
  if (useInventory) inventory.use_inventory = useInventory;
  if (/^[AB]$/.test(importantInventory)) inventory.important_inventory = importantInventory;
  if (/^[AB]$/.test(inventoryControlType)) inventory.inventory_control_type = inventoryControlType;
  if (displaySoldout) inventory.display_soldout = displaySoldout;
  if (row.quantity !== undefined && row.quantity !== null && String(row.quantity).trim() !== '') {
    inventory.quantity = factoryCafe24PayloadValue('quantity', row.quantity);
  }
  if (row.safety_inventory !== undefined && row.safety_inventory !== null && String(row.safety_inventory).trim() !== '') {
    inventory.safety_inventory = factoryCafe24PayloadValue('safety_inventory', row.safety_inventory);
  }
  return inventory;
}

function factoryCafe24InventoryPayloadFromEdit(row = {}, edit = {}) {
  const inventory = {};
  const has = key => Object.prototype.hasOwnProperty.call(edit || {}, key);
  if (has('use_inventory')) {
    const useInventory = factoryTruthyCafe24Flag(row.use_inventory);
    if (useInventory) inventory.use_inventory = useInventory;
  }
  if (has('important_inventory')) {
    const importantInventory = String(row.important_inventory || '').trim().toUpperCase();
    if (/^[AB]$/.test(importantInventory)) inventory.important_inventory = importantInventory;
  }
  if (has('inventory_control_type')) {
    const inventoryControlType = String(row.inventory_control_type || '').trim().toUpperCase();
    if (/^[AB]$/.test(inventoryControlType)) inventory.inventory_control_type = inventoryControlType;
  }
  if (has('display_soldout')) {
    const displaySoldout = factoryTruthyCafe24Flag(row.display_soldout);
    if (displaySoldout) inventory.display_soldout = displaySoldout;
  }
  if (has('quantity') && String(row.quantity ?? '').trim() !== '') {
    inventory.quantity = factoryCafe24PayloadValue('quantity', row.quantity);
  }
  if (has('safety_inventory') && String(row.safety_inventory ?? '').trim() !== '') {
    inventory.safety_inventory = factoryCafe24PayloadValue('safety_inventory', row.safety_inventory);
  }
  return inventory;
}

