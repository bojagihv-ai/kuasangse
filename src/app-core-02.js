
function formatDbDimensions(spec = {}) {
  const parts = [];
  if (spec.width_mm) parts.push(`가로 ${spec.width_mm}mm`);
  if (spec.depth_mm) parts.push(`세로 ${spec.depth_mm}mm`);
  if (spec.height_mm) parts.push(`높이 ${spec.height_mm}mm`);
  return parts.join(' x ');
}

function absoluteSinhwaMediaUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${SINHWA_DB_API.directBase}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function formatDbMatchDetail(match) {
  if (!match) return '';
  const parts = [];
  if (match.jcode) parts.push(`#${match.jcode}`);
  if (match.dimensions) parts.push(match.dimensions);
  if (match.color) parts.push(`색상 ${match.color}`);
  if (match.product_weight_g) parts.push(`제품 ${match.product_weight_g}g`);
  if (Number.isFinite(Number(match.purchase_price))) parts.push(`원가 ${Number(match.purchase_price).toLocaleString('ko-KR')}`);
  if (Number.isFinite(Number(match.stock_qty))) parts.push(`재고 ${Number(match.stock_qty).toLocaleString('ko-KR')}`);
  return parts.filter(Boolean).join(' · ');
}

function formatDbPrice(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('ko-KR') : '';
}

function normalizeDbOptionImageUrl(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return absoluteSinhwaMediaUrl(raw);
  return absoluteSinhwaMediaUrl(
    raw.url ||
    raw.image_url ||
    raw.imageUrl ||
    raw.thumb_url ||
    raw.thumbUrl ||
    raw.file_path ||
    raw.filePath ||
    raw.path ||
    raw.src ||
    ''
  );
}

function dbOptionText(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map(v => dbOptionText(v)).filter(Boolean).join(', ');
      if (joined) return joined;
    } else if (value && typeof value === 'object') {
      const text = dbOptionText(value.value, value.label, value.name, value.text);
      if (text) return text;
    } else {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
  }
  return '';
}

function dbOptionSortValue(item, fallback = 9999) {
  const candidates = [
    item?.sort_order,
    item?.sortOrder,
    item?.display_order,
    item?.displayOrder,
    item?.raw?.display_order,
    item?.raw?.displayOrder,
    item?.raw?.value_no,
  ];
  const found = candidates.find(v => Number.isFinite(Number(v)));
  if (found !== undefined) return Number(found);
  const label = dbOptionText(item?.option_value, item?.optionValue, item?.display_name, item?.displayName, item?.color_label, item?.colorLabel, item?.normalized_value, item?.normalizedValue);
  const prefix = /^\s*(\d+)/.exec(label);
  return prefix ? Number(prefix[1]) : fallback;
}

function normalizeDbColorOption(raw, sourceLabel, index = 0, fallback = {}) {
  const product = raw?.product || fallback.product || {};
  const rawOptions = Array.isArray(raw?.raw?.options) ? raw.raw.options : [];
  const rawOptionValues = rawOptions.map(opt => dbOptionText(opt?.value)).filter(Boolean);
  const label = dbOptionText(
    raw?.option_value,
    raw?.optionValue,
    raw?.display_name,
    raw?.displayName,
    raw?.normalized_value,
    raw?.normalizedValue,
    raw?.color_label,
    raw?.colorLabel,
    raw?.name,
    raw?.label,
    rawOptionValues,
    fallback.color_label,
    product.jname,
    fallback.product_name
  );
  const image = raw?.primary_image || raw?.primaryImage || raw?.image || (Array.isArray(raw?.images) ? raw.images[0] : null);
  const imageUrl = normalizeDbOptionImageUrl(
    raw?.image_url ||
    raw?.imageUrl ||
    raw?.raw?.image ||
    raw?.raw?.option_image_file ||
    raw?.raw?.option_link_image ||
    image
  );
  const jcode = raw?.jcode ?? raw?.mapped_jcode ?? raw?.productCode ?? product?.jcode ?? fallback.jcode ?? '';
  const stock = raw?.quantity ?? raw?.stock_qty ?? raw?.jhavep_qty ?? product?.jhavep_qty ?? product?.jhavep ?? null;
  return {
    id: `dbopt_${String(sourceLabel || 'db').replace(/\W+/g, '')}_${jcode || raw?.id || index}_${index}`,
    source: sourceLabel || '신화사 DB',
    optionName: label || `${index + 1}번 옵션`,
    colorLabel: dbOptionText(raw?.color_label, raw?.colorLabel, raw?.normalized_value, raw?.normalizedValue, label),
    normalizedValue: dbOptionText(raw?.normalized_value, raw?.normalizedValue, raw?.display_name, raw?.displayName, label),
    productName: dbOptionText(raw?.external_product_name, raw?.externalProductName, raw?.display_name, raw?.displayName, product?.jname, fallback.product_name),
    jcode: String(jcode || ''),
    groupId: raw?.group_id ?? fallback.group_id ?? '',
    groupItemId: raw?.group_item_id ?? raw?.id ?? '',
    variantCode: raw?.variant_code || raw?.variantCode || '',
    imageUrl,
    hasImage: !!imageUrl,
    stockQty: Number.isFinite(Number(stock)) ? Number(stock) : null,
    sortOrder: dbOptionSortValue(raw, index + 1),
    rawType: raw?.option_type || raw?.status || '',
  };
}

function dbOptionDedupLabel(value) {
  return String(value || '')
    .replace(/^\s*\d+\s*[-._번호]?\s*/i, '')
    .trim() || String(value || '').trim();
}

function dbOptionHasOrderPrefix(value) {
  return /^\s*\d+/.test(String(value || ''));
}

function dedupeDbColorOptions(options) {
  const seen = new Map();
  options.forEach((option, index) => {
    if (!option?.optionName) return;
    const key = normalizeTextForScore(`${option.jcode || ''}|${dbOptionDedupLabel(option.optionName)}`) || `${index}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, option);
      return;
    }
    seen.set(key, {
      ...prev,
      optionName: dbOptionHasOrderPrefix(prev.optionName) ? prev.optionName : (dbOptionHasOrderPrefix(option.optionName) ? option.optionName : prev.optionName),
      imageUrl: prev.imageUrl || option.imageUrl,
      hasImage: !!(prev.imageUrl || option.imageUrl),
      source: prev.source === option.source ? prev.source : `${prev.source}, ${option.source}`,
      stockQty: Number.isFinite(Number(prev.stockQty)) ? prev.stockQty : option.stockQty,
    });
  });
  return [...seen.values()].sort((a, b) => (a.sortOrder || 9999) - (b.sortOrder || 9999) || String(a.optionName).localeCompare(String(b.optionName), 'ko'));
}

function extractDbColorOptionsFromGroup(group, fallbackMatch = null) {
  if (!group || typeof group !== 'object') return [];
  const options = [];
  const base = {
    group_id: group.id,
    product_name: group.group_name || group.base_name || fallbackMatch?.product_name || '',
    jcode: fallbackMatch?.jcode || group.representative_jcode || '',
  };
  (Array.isArray(group.items) ? group.items : []).forEach((item, index) => {
    options.push(normalizeDbColorOption({
      ...item,
      option_value: item.color_label || item.colorLabel || item.display_name || item.displayName,
    }, '신화사 제품그룹', index, base));
  });
  (Array.isArray(group.external_options) ? group.external_options : []).forEach((item, index) => {
    options.push(normalizeDbColorOption(item, 'Cafe24 색상옵션', index + 100, base));
  });
  (Array.isArray(group.virtual_options) ? group.virtual_options : []).forEach((item, index) => {
    options.push(normalizeDbColorOption(item, 'Cafe24 품목옵션', index + 200, base));
  });
  return dedupeDbColorOptions(options);
}

function extractDbColorOptionsFromMatch(match) {
  if (!match || typeof match !== 'object') return [];
  const options = [];
  const images = Array.isArray(match.images) ? match.images : [];
  const imageGroups = new Map();
  images.forEach((img, index) => {
    const label = dbOptionText(img.color_label, img.colorLabel, img.caption, match.color, match.product_name);
    const key = normalizeTextForScore(label || `image_${index}`);
    const list = imageGroups.get(key) || [];
    list.push(img);
    imageGroups.set(key, list);
  });
  if (imageGroups.size) {
    [...imageGroups.entries()].forEach(([, list], index) => {
      const img = list.find(item => item.is_primary) || list[0];
      options.push(normalizeDbColorOption({
        ...img,
        option_value: img.color_label || img.caption || match.color,
        display_name: img.color_label || match.product_name,
        product: { jname: match.product_name, jcode: match.jcode },
        images: list,
        sort_order: img.sort_order || index + 1,
      }, '신화사 DB 이미지', index, match));
    });
  }
  const colors = Array.isArray(match.colors) ? match.colors : String(match.color || '').split(',');
  colors.map(v => String(v || '').trim()).filter(Boolean).forEach((color, index) => {
    if (options.some(opt => normalizeTextForScore(opt.optionName) === normalizeTextForScore(color))) return;
    options.push(normalizeDbColorOption({
      option_value: color,
      color_label: color,
      product: { jname: match.product_name, jcode: match.jcode },
      sort_order: index + 1,
    }, '신화사 DB 색상값', index, match));
  });
  return dedupeDbColorOptions(options);
}

async function fetchSinhwaPdpProductContext(jcode) {
  if (!jcode) return null;
  return fetchSinhwaPdpBackend(`products/${encodeURIComponent(jcode)}/context`);
}

function flattenSinhwaPdpProductContext(context) {
  const catalog = context?.product?.catalog || {};
  const product = catalog.product || {};
  return {
    ...product,
    jcode: product.jcode || catalog.jcode,
    jname: product.name || product.jname || '',
    jname2: product.secondaryName || product.jname2 || '',
    jsize: product.size || product.jsize || '',
    stock_status: product.status || product.stock_status || '',
    spec: catalog.spec || {},
    usage_profile: catalog.usage || null,
    images: Array.isArray(catalog.images) ? catalog.images : [],
    detail_pages: Array.isArray(catalog.detailPages) ? catalog.detailPages : [],
    pdp_fields: context.fields || null,
    pdp_assets: context.assets || null,
    pdp_sections: context.sections || null,
    pdp_compositions: context.compositions || null,
    pdp_runs: context.runs || null,
    pdp_events: context.events || null,
  };
}

async function fetchSinhwaProductGroupByJcode(jcode) {
  if (!jcode) return null;
  try {
    const context = await fetchSinhwaPdpProductContext(jcode);
    const product = flattenSinhwaPdpProductContext(context);
    return { product, images: product.images, assets: product.pdp_assets?.items || [] };
  } catch(e) {
    console.warn('DB product group lookup failed.', e);
    return null;
  }
}

function getImageProxyBackendBases() {
  const bases = [
    state.backendBaseUrl,
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5050',
  ].map(value => String(value || '').trim().replace(/\/+$/, '')).filter(Boolean);
  return [...new Set(bases)];
}

async function fetchImageDataUrlViaProxy(url, originalError = null) {
  const failures = [];
  for (const base of getImageProxyBackendBases()) {
    try {
      const res = await fetch(`${base}/api/image-proxy?url=${encodeURIComponent(url)}`, {
        headers: { 'Accept': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error || !data.dataUrl) throw new Error(data.error || `프록시 HTTP ${res.status}`);
      return data.dataUrl;
    } catch(e) {
      failures.push(`${base}: ${e?.message || e}`);
    }
  }
  throw new Error(`이미지 fetch 실패${originalError ? `: ${originalError.message || originalError}` : ''}${failures.length ? ` / 프록시 실패: ${failures.slice(0, 2).join(' / ')}` : ''}`);
}

async function fetchImageDataUrl(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'Accept': 'image/*,*/*' } });
    if (!res.ok) throw new Error(`이미지 HTTP ${res.status}`);
  } catch(e) {
    return await fetchImageDataUrlViaProxy(url, e);
  }
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function currentDbMatchForOptions() {
  return state.analysis?.db_match || state.analysis?.db_product || state.analysis?.dbProduct || null;
}

async function loadDbColorOptionsForCurrentProduct(options = {}) {
  const applyAfterLoad = options.apply === true;
  const current = currentDbMatchForOptions();
  const jcode = String(current?.jcode || current?.id || '').trim();
  if (!jcode) {
    state.dbColorOptionsError = '먼저 신화사 DB 상품을 매칭해주세요.';
    savePersistentState();
    render();
    return [];
  }
  state.dbColorOptionsBusy = true;
  state.dbColorOptionsError = '';
  render();
  try {
    const group = await fetchSinhwaProductGroupByJcode(jcode);
    let optionList = extractDbColorOptionsFromGroup(group, current);
    if (!optionList.length) optionList = extractDbColorOptionsFromMatch(current);
    state.dbColorOptions = optionList;
    state.dbColorOptionsLastJcode = jcode;
    state.dbColorOptionsLoadedAt = Date.now();
    state.dbColorOptionsError = optionList.length
      ? ''
      : 'DB에서 색상옵션을 찾지 못했습니다. 신화사 DB 그룹/옵션 연결을 먼저 확인해주세요.';
    pushAnalysisLog('DB 색상옵션 불러오기 완료', `${optionList.length}개 옵션 · 사진 ${optionList.filter(opt => opt.hasImage).length}개`, 32);
    savePersistentState();
    if (applyAfterLoad && optionList.length) await applyDbColorOptionsToOptionSorter({ skipConfirm: true });
    return optionList;
  } catch(e) {
    const msg = e?.message || String(e);
    state.dbColorOptionsError = `색상옵션 불러오기 실패: ${msg}`;
    pushAnalysisLog('DB 색상옵션 불러오기 실패', msg, 32);
    return [];
  } finally {
    state.dbColorOptionsBusy = false;
    savePersistentState();
    render();
  }
}

async function applyDbColorOptionsToOptionSorter(options = {}) {
  const currentOptions = Array.isArray(state.dbColorOptions) ? state.dbColorOptions : [];
  if (!currentOptions.length) {
    await loadDbColorOptionsForCurrentProduct({ apply: true });
    return;
  }
  const os = state.optionSorter;
  const hasExisting = (os.images || []).length || (os.slots || []).some(slot => (slot.imgIds || []).length);
  if (!options.skipConfirm && hasExisting) {
    const ok = confirm('현재 옵션 분류기의 사진/슬롯을 DB 색상옵션으로 교체할까요?\n기존 옵션 분류기 내용은 현재 작업 저장본에는 남지만, 화면에서는 DB 옵션으로 바뀝니다.');
    if (!ok) return;
  }
  state.dbColorOptionsBusy = true;
  render();
  const importedImages = [];
  const slots = [];
  const logs = [];
  for (let i = 0; i < currentOptions.length; i += 1) {
    const option = currentOptions[i];
    let imgId = null;
    if (option.imageUrl) {
      try {
        const preview = await fetchImageDataUrl(option.imageUrl);
        const [, meta = '', base64 = ''] = /^data:([^;]+);base64,(.*)$/.exec(preview) || [];
        imgId = `dbimg_${String(option.jcode || 'opt')}_${i}_${Date.now().toString(36)}`;
        importedImages.push({
          id: imgId,
          name: option.optionName || `${i + 1}번 옵션`,
          base64,
          mime: meta || 'image/jpeg',
          preview,
          colorHint: null,
          source: '신화사 DB 색상옵션',
          dbOption: {
            optionName: option.optionName,
            jcode: option.jcode,
            source: option.source,
            imageUrl: option.imageUrl,
          },
        });
      } catch(e) {
        logs.push(`${option.optionName}: 사진을 불러오지 못했습니다 (${e.message || e})`);
      }
    }
    slots.push({
      id: `slot_db_${String(option.jcode || 'opt')}_${i}_${Date.now().toString(36)}`,
      name: option.optionName || `${i + 1}번 옵션`,
      imgIds: imgId ? [imgId] : [],
    });
  }
  for (const img of importedImages) {
    try {
      img.colorHint = await optInferImageColorHint(optImageSrc(img));
    } catch(e) {
      img.colorHint = { id:'unknown', label:'색상 미확인', confidence:0, hex:'' };
    }
  }
  os.images = importedImages;
  os.slots = slots.length ? slots : defaultOptionSorterState().slots;
  os.pool = [];
  os.previewImageId = null;
  os.previewResultId = null;
  os.optionResults = [];
  os.subStep = 'input';
  os.subStepUpdatedAt = Date.now();
  os.optionGenLogs = [
    `DB 색상옵션 ${currentOptions.length}개를 슬롯명으로 적용했습니다.`,
    importedImages.length ? `사진 ${importedImages.length}장을 옵션 이미지로 불러왔습니다.` : 'DB 옵션명만 적용했습니다. 사진은 직접 업로드하거나 DB 사진 연결을 확인하세요.',
    ...logs.slice(0, 6),
  ];
  state.step = 'optionsorter';
  state.dbColorOptionsBusy = false;
  saveLastWorkNow();
  render();
}

function hasProductValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).length > 0;
  if (value && typeof value === 'object') return Object.values(value).some(v => hasProductValue(v));
  return String(value ?? '').trim() !== '';
}

function firstProductValue(...values) {
  for (const value of values) {
    if (hasProductValue(value)) return value;
  }
  return '';
}

function productInfoAnalysisMatch(a = state.analysis || {}) {
  return a?.db_match || a?.sinhwa_match || a?.db_product || a?.matched_product || null;
}

function productInfoDbMatch(db = {}, a = state.analysis || {}) {
  return db?.match || productInfoAnalysisMatch(a) || {};
}

function productInfoSpec(db = {}, a = state.analysis || {}) {
  const match = productInfoDbMatch(db, a);
  return match?.spec || {};
}

function productInfoObjectValue(source, aliases = []) {
  if (!source || typeof source !== 'object') return '';
  for (const alias of aliases) {
    if (hasProductValue(source[alias])) return source[alias];
  }
  const nestedKeys = ['raw', 'rawProduct', 'product', 'product_detail', 'detail', 'data'];
  for (const key of nestedKeys) {
    const nested = source[key];
    if (!nested || typeof nested !== 'object' || nested === source) continue;
    const value = productInfoObjectValue(nested, aliases);
    if (hasProductValue(value)) return value;
  }
  return '';
}

function productInfoCafe24Match(a = state.analysis || {}) {
  const factory = (typeof factoryRuntimeReadFactory === 'function') ? factoryRuntimeReadFactory() : null;
  const factoryTarget = (typeof factoryCafe24TargetCandidate === 'function' && factory)
    ? factoryCafe24TargetCandidate(factory, { allowFallback: !!factory?.product?.candidateAutoApply })
    : null;
  return a?.cafe24_match ||
    a?.cafe24_product ||
    a?.cafe24_selected ||
    factoryTarget ||
    (Array.isArray(a?.cafe24_candidates) ? a.cafe24_candidates.find(item => item && typeof item === 'object') : null) ||
    null;
}

function productInfoCafe24Raw(a = state.analysis || {}) {
  const match = productInfoCafe24Match(a);
  if (!match || typeof match !== 'object') return {};
  if (typeof parseCafe24Raw === 'function') {
    const raw = parseCafe24Raw(match);
    if (raw && typeof raw === 'object' && Object.keys(raw).length) return raw;
  }
  return productInfoObjectValue(match, ['raw']) || match;
}

function productInfoCafe24Value(a = state.analysis || {}, aliases = []) {
  const sources = [
    a,
    productInfoCafe24Match(a),
    productInfoCafe24Raw(a),
    a?.cafe24_match?.raw,
    a?.cafe24_match?.rawProduct,
  ].filter(source => source && typeof source === 'object');
  for (const source of sources) {
    const value = productInfoObjectValue(source, aliases);
    if (hasProductValue(value)) return value;
  }
  return '';
}

function productInfoCafe24FlagText(displayValue, sellingValue) {
  const toText = (value, trueLabel, falseLabel) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (/^(T|Y|true|1)$/i.test(raw)) return trueLabel;
    if (/^(F|N|false|0)$/i.test(raw)) return falseLabel;
    return raw;
  };
  const display = toText(displayValue, '진열함', '진열 안 함');
  const selling = toText(sellingValue, '판매함', '판매 안 함');
  return [display, selling].filter(Boolean).join(' / ');
}

function productInfoWithUnit(value, unit) {
  if (!hasProductValue(value)) return '';
  const text = String(value).trim();
  if (!unit || new RegExp(`${unit}\\b`, 'i').test(text)) return text;
  return `${text}${unit}`;
}

function productInfoSizeText(db = {}, a = state.analysis || {}, product = {}) {
  const match = productInfoDbMatch(db, a);
  const spec = productInfoSpec(db, a);
  const width = firstProductValue(spec.width_mm, match.width_mm, a.width_mm);
  const depth = firstProductValue(spec.depth_mm, match.depth_mm, a.depth_mm);
  const height = firstProductValue(spec.height_mm, match.height_mm, a.height_mm);
  const parts = [];
  if (width) parts.push(`가로 ${productInfoWithUnit(width, 'mm')}`);
  if (depth) parts.push(`세로 ${productInfoWithUnit(depth, 'mm')}`);
  if (height) parts.push(`높이 ${productInfoWithUnit(height, 'mm')}`);
  return firstProductValue(match.dimensions, match.size, a.dimensions, a.size_estimate, product.size, parts.join(' / '));
}

function latestDbSyncInfo() {
  const factory = (typeof factoryRuntimeReadFactory === 'function') ? factoryRuntimeReadFactory() : null;
  const info = state.analysis?.factory_sync_status
    || factory?.product?.lastDbSyncStatus
    || state.lastDbSyncStatus
    || null;
  if (!info || typeof info !== 'object') return null;
  const syncedAt = info.synced_at || info.syncedAt || info.at || state.analysis?.factory_imported_at || factory?.product?.lastSyncedAt;
  return { ...info, syncedAt };
}

function formatLatestDbSyncTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderLatestDbSyncStatusInline() {
  const info = latestDbSyncInfo();
  if (!info?.syncedAt) {
    return `<span class="api-badge" title="조립공장, Cafe24, 신화사DB에서 아직 공통 동기화 기록을 찾지 못했습니다.">DB 동기화 기록 없음</span>`;
  }
  const source = info.source || '조립공장 최신값';
  const bits = [
    info.product_name || info.productName || '',
    info.db_jcode ? `신화사 #${info.db_jcode}` : '',
    info.cafe24_product_no ? `Cafe24 #${info.cafe24_product_no}` : '',
  ].filter(Boolean).join(' · ');
  const title = `${source}${bits ? ` · ${bits}` : ''}`;
  return `<span class="api-badge" title="${escAttr(title)}">DB 동기화 ${escapeHtml(formatLatestDbSyncTime(info.syncedAt))}</span>`;
}

function formatWorkfileSaveTime(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime()) || !Number(value)) return '';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function renderWorkfileSaveStatus() {
  if (state.workfileRestoreState === 'loading') {
    return '<span class="workfile-save-status saving" id="workfileSaveStatus" role="status">작업파일 읽는 중...</span>';
  }
  if (state.workfileRestoreState === 'validating') {
    return '<span class="workfile-save-status saving" id="workfileSaveStatus" role="status">작업 범위 검증 중...</span>';
  }
  if (state.workfileRestoreState === 'error') {
    const message = state.workfileRestoreMessage || '불러오기 실패';
    return `<span class="workfile-save-status error" id="workfileSaveStatus" role="status" title="${escAttr(message)}">불러오기 실패 · 기존 작업 유지</span>`;
  }
  if (state.workfileRestoreState === 'completed') {
    const durationMs = Number(state.workfileRestoreDurationMs || 0);
    const durationLabel = durationMs > 0 ? ` · ${(durationMs / 1000).toFixed(durationMs < 1000 ? 2 : 1)}초` : '';
    return `<span class="workfile-save-status saved" id="workfileSaveStatus" role="status">불러오기 완료${durationLabel}</span>`;
  }
  if (state.workfileSaveState === 'saving') {
    const savingLabel = state.workfileSaveMode === 'save-as' ? '다른 이름으로 저장 중...' : '현재 상태 저장 중...';
    return `<span class="workfile-save-status saving" id="workfileSaveStatus" role="status">${savingLabel}</span>`;
  }
  if (state.workfileSaveState === 'error') {
    return '<span class="workfile-save-status error" id="workfileSaveStatus" role="status">저장 실패</span>';
  }
  const savedAt = formatWorkfileSaveTime(state.workfileLastSavedAt);
  const durationMs = Number(state.workfileLastSaveDurationMs || 0);
  const durationLabel = durationMs > 0 ? ` · ${(durationMs / 1000).toFixed(durationMs < 1000 ? 2 : 1)}초` : '';
  return `<span class="workfile-save-status ${savedAt ? 'saved' : ''}" id="workfileSaveStatus" role="status">${savedAt ? `저장 완료${durationLabel} · 마지막 저장: ${escapeHtml(savedAt)}` : '저장 전'}</span>`;
}

// 성능 표시는 안전 · 주의 · 경고 세 단계다.
// 예전에는 두 단계뿐이었고 자동저장이 1초를 1밀리초라도 넘으면 곧바로 빨간불이 켜졌다.
// 실제로는 아무 문제 없는 구간인데 경고가 뜨니, 놀라서 확인해 보면 "아무 일 아닙니다"
// 였다. 그런 표시는 곧 신뢰를 잃고, 정말 느려졌을 때도 무시하게 된다.
const RUNTIME_PERFORMANCE_BANDS = {
  render: { warn: 150, bad: 400 },
  persistence: { warn: 2000, bad: 5000 },
};

function runtimePerformanceBandLevel(value, band) {
  if (value > band.bad) return 'bad';
  if (value > band.warn) return 'warn';
  return 'ok';
}

function runtimePerformanceDurationText(ms) {
  const value = Math.max(0, Math.round(Number(ms) || 0));
  // 1초를 넘으면 밀리초보다 초가 읽기 쉽다.
  return value >= 1000 ? `${(value / 1000).toFixed(1)}초` : `${value}ms`;
}

function runtimePerformanceBudgetModel(renderMs, persistenceMs) {
  const measuredRenderMs = Math.max(0, Math.round(Number(renderMs) || 0));
  const measuredPersistenceMs = Math.max(0, Math.round(Number(persistenceMs) || 0));
  const renderLevel = runtimePerformanceBandLevel(measuredRenderMs, RUNTIME_PERFORMANCE_BANDS.render);
  const persistenceLevel = runtimePerformanceBandLevel(measuredPersistenceMs, RUNTIME_PERFORMANCE_BANDS.persistence);
  const levels = [renderLevel, persistenceLevel];
  const level = levels.includes('bad') ? 'bad' : (levels.includes('warn') ? 'warn' : 'ok');
  const slow = [];
  if (renderLevel !== 'ok') slow.push('render');
  if (persistenceLevel !== 'ok') slow.push('persistence');
  return {
    renderMs: measuredRenderMs,
    persistenceMs: measuredPersistenceMs,
    measured: measuredRenderMs > 0 || measuredPersistenceMs > 0,
    level,
    renderLevel,
    persistenceLevel,
    // 빨간불은 '정말 느릴 때' 만 켠다.
    overBudget: level === 'bad',
    slow,
  };
}

function renderRuntimePerformanceStatus() {
  const dataset = typeof document !== 'undefined' ? document.documentElement?.dataset : null;
  const model = runtimePerformanceBudgetModel(
    state.runtimeRenderLastMs || dataset?.kuasangseRenderLastMs,
    state.runtimePersistenceLastMs || dataset?.kuasangsePersistenceLastMs,
  );
  if (!model.measured) {
    return '<span class="workfile-save-status" id="runtimePerformanceStatus" role="status">성능 계측 대기</span>';
  }
  const headline = { ok: '속도 정상', warn: '조금 느려짐', bad: '많이 느림' }[model.level];
  const tone = { ok: 'saved', warn: 'warn', bad: 'error' }[model.level];
  const label = `${headline} · 화면 그리기 ${runtimePerformanceDurationText(model.renderMs)}`
    + ` · 자동저장 ${runtimePerformanceDurationText(model.persistenceMs)}`;
  const hint = '화면 그리기가 0.15초·0.4초를, 자동저장이 2초·5초를 넘으면 각각 주의(주황)·경고(빨강)로 바뀝니다.';
  return `<span class="workfile-save-status ${tone}" id="runtimePerformanceStatus" role="status" data-performance-level="${model.level}" data-performance-over-budget="${model.overBudget ? '1' : '0'}" title="${escAttr(hint)}">${escapeHtml(label)}</span>`;
}

function renderWorkfileBuildLabel() {
  const buildId = String(window.__KUASANGSE_APP_BUILD_ID__ || '개발').trim();
  const shortBuild = buildId.match(/v\d+$/i)?.[0] || buildId;
  return `<span class="workfile-build-label" id="workfileBuildLabel" title="${escAttr(buildId)}">빌드 ${escapeHtml(shortBuild)}</span>`;
}

function renderProjectSafetyBackupStatus() {
  const status = String(state.projectSafetyBackupState || '');
  if (!status) return '';
  const labels = {
    exporting: '안전 백업 만드는 중...',
    restoring: '안전 백업 복원 중...',
    completed: state.projectSafetyBackupMessage || '안전 백업 완료',
    error: state.projectSafetyBackupMessage || '안전 백업 실패',
  };
  return `<span class="workfile-save-status ${status === 'error' ? 'error' : (status === 'completed' ? 'saved' : 'saving')}" id="projectSafetyBackupStatus" role="status">${escapeHtml(labels[status] || status)}</span>`;
}

let workBundleSyncStatusLabel = '자산관 사진: 확인 전';

function renderGlobalDbSyncStatusStrip() {
  if (typeof window !== 'undefined') {
    window.__KUASANGSE_WORKFILE_ACTIONS__ = {
      blank: () => startBlankWorkDraft(),
      saveCurrent: () => exportCurrentProjectFile({ name: state.currentProjectName || deriveProjectName(), saveAs: false }),
      saveAs: () => exportCurrentProjectFile({ name: state.currentProjectName || deriveProjectName(), saveAs: true }),
      importFile: () => openFactoryProjectFilePicker(),
      importFileDirect: () => openFactoryProjectFileInput({ direct: true }),
    };
  }
  const authorityReadOnly = workspaceDocumentAuthorityIsReadOnly();
  const currentFactory = typeof factoryRuntimeReadFactory === 'function'
    ? factoryRuntimeReadFactory()
    : state.factory;
  const projectName = state.currentProjectName
    || currentFactory?.product?.productName
    || currentFactory?.product?.userProductName
    || state.productName
    || state.analysis?.product_name
  || state.analysis?.product_name_en
  || '새 작업';
  const cleanProjectName = String(projectName || '새 작업').replace(/\.kuasangse$/i, '').trim() || '새 작업';
  const workfileNameTailStart = cleanProjectName.lastIndexOf(' ');
  const workfileNamePrefix = workfileNameTailStart >= 0 ? cleanProjectName.slice(0, workfileNameTailStart + 1) : '';
  const workfileNameTail = workfileNamePrefix ? cleanProjectName.slice(workfileNameTailStart + 1) : cleanProjectName;
  const workfileNameTailClass = workfileNamePrefix ? 'db-workfile-name-tail' : 'db-workfile-name-tail db-workfile-name-tail-wrap';
  const fileDisplayName = `${cleanProjectName}.kuasangse`;
  const currentStatus = typeof workspaceDocumentStatusLabel === 'function'
    ? workspaceDocumentStatusLabel()
    : (state.currentProjectId ? '저장됨' : '초안');
  const activeStepLabel = typeof getCurrentStepLabel === 'function' ? getCurrentStepLabel() : '작업 화면';
  const info = latestDbSyncInfo();
  // 이 배지는 '조립공장에서 확정한 값을 AI 분석 화면으로 넘긴 기록' 이다.
  // 조립공장에서 고른 신화사DB 후보와는 다른 것인데, 예전에는 둘 다 그냥 'DB' 라고만
  // 불러서 오해를 샀다. DB 후보를 골라 둔 채로 '제품정보 DB: 연결 기록 없음' 을 보면
  // 고른 것이 날아간 줄 알게 된다. 무엇에 대한 기록인지 이름에 드러낸다.
  const syncLabel = info?.syncedAt && typeof formatLatestDbSyncTime === 'function'
    ? `AI 분석에 넘김: ${formatLatestDbSyncTime(info.syncedAt)}`
    : 'AI 분석에 아직 안 넘김';
  const summary = info?.summary || [
    info?.product_name || info?.productName || '',
    info?.db_jcode ? `신화사 #${info.db_jcode}` : '',
    info?.cafe24_product_no ? `Cafe24 #${info.cafe24_product_no}` : '',
  ].filter(Boolean).join(' · ');
  const locationLabel = typeof factoryProjectFileLocationLabel === 'function'
    ? factoryProjectFileLocationLabel()
    : '';
  return `<div class="db-workfile-strip" aria-label="제품정보 DB·자산관 사진과 작업파일">
    <div class="db-workfile-current">
      <div class="db-workfile-kicker">현재 작업파일</div>
      <div class="db-workfile-name" title="${escAttr(fileDisplayName)}"><span class="db-workfile-name-base">${escapeHtml(workfileNamePrefix)}<span class="${workfileNameTailClass}">${escapeHtml(workfileNameTail)}&#8288;<span class="db-workfile-name-ext">.kuasangse</span></span></span></div>
      <div class="db-workfile-current-step">현재 화면 ${escapeHtml(activeStepLabel)}</div>
    </div>
    <div class="db-workfile-title">
      <div class="db-workfile-sync" title="조립공장에서 확정한 값을 AI 분석 화면으로 넘긴 기록입니다. 조립공장에서 고른 신화사DB 후보와는 다릅니다.">
        ${escapeHtml(syncLabel)}${summary ? ` <span>${escapeHtml(summary)}</span>` : ''}
        <span id="workBundleSyncStatus">${escapeHtml(workBundleSyncStatusLabel)}</span>
      </div>
      <div class="db-workfile-meta">
        <span class="${state.workspaceDocumentDirty ? 'dirty' : ''}">${escapeHtml(currentStatus)}</span>
        <span>${locationLabel ? `최근 로컬 파일 ${escapeHtml(locationLabel)}` : '저장 시 로컬 위치 선택'}</span>
        ${state.currentProjectId ? `<span>ID ${escapeHtml(state.currentProjectId)}</span>` : ''}
      </div>
    </div>
    <div class="db-workfile-actions">
      <button class="btn-sm" id="blankWorkBtn" type="button" title="미저장 시 저장 여부를 묻고, 화면을 완전히 비워 새 작업을 시작합니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'blank'}}))">새 작업</button>
      ${renderWorkfileSaveStatus()}
      ${renderWorkfileBuildLabel()}
      ${renderRuntimePerformanceStatus()}
      <button class="btn-sm primary" id="saveCurrentProjectFileBtn" type="button" title="현재 작업파일에 바로 덮어씁니다. 처음 저장할 때만 위치를 선택합니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'save-current'}}))" ${authorityReadOnly ? 'disabled aria-disabled="true"' : ''}>현재 상태 저장</button>
      <button class="btn-sm" id="saveProjectFileAsBtn" type="button" title="새 이름과 로컬 저장 위치를 선택해 별도 작업파일로 저장합니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'save-as'}}))">다른 이름으로 저장</button>
      <button class="btn-sm" id="importProjectFileBtn" type="button" title="최근 작업파일 위치에서 .kuasangse 파일을 불러옵니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'import'}}))">작업파일 불러오기</button>
      <button class="btn-sm" id="importProjectFileDirectBtn" type="button" title="Windows 파일창 대신 표준 파일 선택으로 .kuasangse를 직접 불러옵니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'import-direct'}}))">작업파일 직접 선택</button>
      <button class="btn-sm" id="exportProjectSafetyBackupBtn" type="button" title="현재 작업파일, 이 작업의 로컬 보관 이미지, IndexedDB 복원 manifest를 SHA-256 체크섬과 함께 한 파일로 내려받습니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'export-safety-backup'}}))" ${state.projectBusy ? 'disabled aria-disabled="true"' : ''}>안전 백업</button>
      <button class="btn-sm" id="restoreProjectSafetyBackupBtn" type="button" title="안전 백업의 체크섬을 먼저 검증한 뒤 작업파일, 로컬 보관 이미지, 브라우저 복원 상태를 복원합니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'restore-safety-backup'}}))" ${state.projectBusy ? 'disabled aria-disabled="true"' : ''}>백업 복원</button>
      ${renderProjectSafetyBackupStatus()}
      <button class="btn-sm" id="syncSinhwaAssetsBtn" type="button" title="로컬 원본은 그대로 두고 현재 입력·생성 사진을 신화사 자산관과 즉시 다시 대조합니다." onclick="document.dispatchEvent(new CustomEvent('kuasangse:workfile-action',{detail:{action:'sync-assets'}}))">자산관 사진 다시 대조</button>
    </div>
  </div>`;
}

const PRODUCT_INFO_FIELD_CATALOG = [
  { id:'product_name', group:'기본', label:'상품명', source:'공통', defaultActive:true, defaultRequired:true,
    get:(product, db, a) => {
      const match = productInfoDbMatch(db, a);
      return firstProductValue(product.productName, match.product_name, match.jname, match.name, a.product_name);
    } },
  { id:'representative_image', group:'기본', label:'대표 이미지', source:'업로드', defaultActive:true, defaultRequired:true,
    get:(product) => product.image ? `${product.imageCount || 1}장` : '' },
  { id:'category_usage', group:'기본', label:'카테고리/용도', source:'이미지 분석/Cafe24', defaultActive:true, defaultRequired:true,
    get:(product, db, a) => product.category || a.category || a.product_category || a.usage || a.use_case },
  { id:'width_mm', group:'규격', label:'가로', source:'신화사DB', defaultActive:true, defaultRequired:true,
    get:(product, db, a) => productInfoWithUnit(firstProductValue(productInfoSpec(db, a).width_mm, productInfoDbMatch(db, a).width_mm, a.width_mm), 'mm') },
  { id:'depth_mm', group:'규격', label:'세로', source:'신화사DB', defaultActive:true, defaultRequired:true,
    get:(product, db, a) => productInfoWithUnit(firstProductValue(productInfoSpec(db, a).depth_mm, productInfoDbMatch(db, a).depth_mm, a.depth_mm), 'mm') },
  { id:'height_mm', group:'규격', label:'높이', source:'신화사DB', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => productInfoWithUnit(firstProductValue(productInfoSpec(db, a).height_mm, productInfoDbMatch(db, a).height_mm, a.height_mm), 'mm') },
  { id:'dimensions', group:'규격', label:'규격 전체 문장', source:'신화사DB/분석', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => productInfoSizeText(db, a, product) },
  { id:'product_weight_g', group:'규격', label:'제품 무게', source:'신화사DB', defaultActive:true, defaultRequired:false,
    get:(product, db, a) => productInfoWithUnit(firstProductValue(productInfoDbMatch(db, a).product_weight_g, productInfoSpec(db, a).product_weight_g, a.product_weight_g), 'g') },
  { id:'package_weight_g', group:'규격', label:'포장 무게', source:'신화사DB', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => productInfoWithUnit(firstProductValue(productInfoDbMatch(db, a).package_weight_g, productInfoSpec(db, a).package_weight_g, a.package_weight_g), 'g') },
  { id:'shipping_weight_g', group:'규격', label:'배송 무게', source:'신화사DB/Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => productInfoWithUnit(firstProductValue(productInfoDbMatch(db, a).shipping_weight_g, productInfoSpec(db, a).shipping_weight_g, a.shipping_weight_g), 'g') },
  { id:'color_options', group:'색상/구성', label:'색상/옵션', source:'신화사DB/Cafe24', defaultActive:true, defaultRequired:true,
    get:(product, db, a) => {
      const match = productInfoDbMatch(db, a);
      return firstProductValue(match.color, match.colors, product.colors, a.colors, a.color, a.option_colors);
    } },
  { id:'material', group:'색상/구성', label:'소재/재질', source:'신화사DB/이미지 분석', defaultActive:true, defaultRequired:true,
    get:(product, db, a) => db?.match?.material_summary || db?.match?.spec?.material_summary || a.material || a.materials || a.fabric,
    resolve:(product, db, a) => {
      const candidates = [
        ['신화사DB material_summary', db?.match?.material_summary],
        ['신화사DB spec.material_summary', db?.match?.spec?.material_summary],
        ['이미지 분석 material', a.material],
        ['이미지 분석 materials', a.materials],
        ['이미지 분석 fabric', a.fabric],
      ];
      const found = candidates.find(([, value]) => hasProductValue(value));
      return found ? { source: found[0], value: found[1] } : { source:'신화사DB/이미지 분석', value:'' };
    } },
  { id:'packaging', group:'색상/구성', label:'구성/포장', source:'신화사DB/사입자료', defaultActive:true, defaultRequired:true,
    get:(product, db, a) => db?.match?.packaging_summary || db?.match?.spec?.packaging_summary || a.packaging || a.components || a.composition },
  { id:'component_count', group:'색상/구성', label:'구성품 수량', source:'Cafe24/사입자료', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.component_count || a.quantity_per_set || a.bundle_count },
  { id:'jcode', group:'신화사 DB', label:'신화사 상품코드', source:'신화사DB', defaultActive:true, defaultRequired:false,
    get:(product, db) => db?.match?.jcode ? `#${db.match.jcode}` : '' },
  { id:'jname2', group:'신화사 DB', label:'신화사 보조명', source:'신화사DB', defaultActive:false, defaultRequired:false,
    get:(product, db) => db?.match?.jname2 || '' },
  { id:'stock_qty', group:'운영', label:'재고', source:'신화사DB/Cafe24', defaultActive:true, defaultRequired:false,
    get:(product, db, a) => Number.isFinite(Number(db?.match?.stock_qty)) ? Number(db.match.stock_qty).toLocaleString('ko-KR') : (Number.isFinite(Number(a.stock_qty || a.quantity)) ? Number(a.stock_qty || a.quantity).toLocaleString('ko-KR') : '') },
  { id:'purchase_price', group:'운영', label:'원가', source:'신화사DB/사입자료', defaultActive:true, defaultRequired:false,
    get:(product, db) => formatDbPrice(db?.match?.purchase_price) },
  { id:'sale_price', group:'운영', label:'판매가', source:'신화사DB/Cafe24', defaultActive:true, defaultRequired:false,
    get:(product, db, a) => formatDbPrice(db?.match?.sale_price || a.sale_price || a.price || productInfoCafe24Value(a, ['sale_price', 'price'])) },
  { id:'retail_price', group:'Cafe24', label:'소비자가', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => formatDbPrice(a.retail_price || a.consumer_price || a.market_price || productInfoCafe24Value(a, ['retail_price', 'consumer_price', 'market_price'])) },
  { id:'supply_price', group:'Cafe24', label:'공급가', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => formatDbPrice(a.supply_price || a.supplier_price || productInfoCafe24Value(a, ['supply_price', 'supplier_price', 'purchase_price'])) },
  { id:'cafe24_product_no', group:'Cafe24', label:'Cafe24 상품번호', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.product_no || a.cafe24_product_no || productInfoCafe24Value(a, ['product_no', 'cafe24_product_no']) },
  { id:'cafe24_product_code', group:'Cafe24', label:'Cafe24 상품코드', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.product_code || a.cafe24_product_code || a.custom_product_code || productInfoCafe24Value(a, ['product_code', 'cafe24_product_code', 'custom_product_code']) },
  { id:'display_status', group:'Cafe24', label:'진열/판매 상태', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => productInfoCafe24FlagText(
      a.display || a.display_status || productInfoCafe24Value(a, ['display', 'display_status']),
      a.selling || a.selling_status || productInfoCafe24Value(a, ['selling', 'selling_status'])
    ) || a.display_status || a.selling_status },
  { id:'manufacturer', group:'Cafe24', label:'제조사', source:'Cafe24/사입자료', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.manufacturer || a.maker || productInfoCafe24Value(a, ['manufacturer_name', 'manufacturer', 'maker', 'manufacturer_code']) },
  { id:'supplier', group:'Cafe24', label:'공급사/거래처', source:'Cafe24/사입자료', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.supplier || a.vendor || a.vendor_name || productInfoCafe24Value(a, ['supplier_name', 'supplier', 'supplier_code', 'vendor', 'vendor_name']) },
  { id:'brand', group:'Cafe24', label:'브랜드', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.brand || a.brand_name || productInfoCafe24Value(a, ['brand_name', 'brand', 'brand_code']) },
  { id:'origin', group:'Cafe24', label:'원산지', source:'Cafe24/사입자료', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.origin || a.made_in || a.country_of_origin || productInfoCafe24Value(a, ['origin', 'made_in', 'made_in_code', 'origin_place_value', 'country_of_origin']) },
  { id:'tax_type', group:'Cafe24', label:'과세 구분', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.tax_type || a.taxation || productInfoCafe24Value(a, ['tax_type', 'taxation', 'tax_calculation', 'tax_amount']) },
  { id:'shipping_fee_type', group:'Cafe24', label:'배송비 타입', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.shipping_fee_type || a.shipping_type || productInfoCafe24Value(a, ['shipping_fee_type', 'shipping_type', 'shipping_method']) },
  { id:'cafe24_summary', group:'Cafe24', label:'상품 요약 설명', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.summary_description || a.simple_description || a.product_summary || productInfoCafe24Value(a, ['summary_description', 'simple_description', 'product_summary']) },
  { id:'cafe24_keywords', group:'Cafe24', label:'검색/노출 키워드', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.search_keywords || a.keyword || a.tags || a.product_tag || productInfoCafe24Value(a, ['search_keywords', 'keyword', 'tags', 'product_tag']) },
  { id:'cafe24_notice', group:'Cafe24', label:'상품 고시 정보', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.product_notice || a.detail_notice || a.notice_info || productInfoCafe24Value(a, ['product_notice', 'detail_notice', 'notice_info']) },
  { id:'cafe24_certification', group:'Cafe24', label:'인증/KC 정보', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.certification || a.kc_certification || a.safety_certification || productInfoCafe24Value(a, ['certification', 'kc_certification', 'safety_certification']) },
  { id:'model_name', group:'Cafe24', label:'모델명', source:'Cafe24/사입자료', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => db?.match?.model_name || a.model_name || a.model },
  { id:'barcode', group:'Cafe24', label:'바코드/SKU', source:'Cafe24/신화사DB', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => db?.match?.barcode || db?.match?.sku || a.barcode || a.sku },
  { id:'option_name', group:'옵션', label:'옵션명', source:'Cafe24/옵션분류', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.option_name || a.option_names },
  { id:'option_value', group:'옵션', label:'옵션값', source:'Cafe24/옵션분류', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.option_value || a.option_values || a.variants },
  { id:'variant_code', group:'옵션', label:'품목/옵션 코드', source:'Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.variant_code || a.item_code },
  { id:'supplier_order_name', group:'사입/사쵸박사', label:'사입처 주문명', source:'사입/사쵸박사', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.supplier_order_name || a.purchase_name || a.order_name },
  { id:'purchase_site', group:'사입/사쵸박사', label:'매입처/구매처', source:'사입/사쵸박사', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.purchase_site || a.buying_site || a.source_shop },
  { id:'inbound_memo', group:'사입/사쵸박사', label:'입고/검수 메모', source:'사입/사쵸박사', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.inbound_memo || a.inspect_memo || a.memo },
  { id:'storage_location', group:'사입/사쵸박사', label:'보관 위치', source:'사입/사쵸박사/신화사DB', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => db?.match?.storage_location || db?.match?.location || a.storage_location || a.warehouse_location },
  { id:'purchase_url', group:'사입/사쵸박사', label:'매입 링크/원문', source:'사입/사쵸박사', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.purchase_url || a.source_url || a.supplier_url },
  { id:'procurement_status', group:'사입/사쵸박사', label:'사입/입고 상태', source:'사입/사쵸박사', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.procurement_status || a.inbound_status || a.purchase_status },
  { id:'care_notice', group:'상세페이지', label:'취급/주의사항', source:'상세페이지', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.care_notice || a.warning || a.precautions },
  { id:'usage_place', group:'상세페이지', label:'사용처', source:'신화사DB/Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.usage_place || a.place_of_use || a.usage_location || a.use_place },
  { id:'recommended_use', group:'상세페이지', label:'용도', source:'신화사DB/Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.recommended_use || a.usage_purpose || a.purpose || a.use_purpose || a.use_scenario || a.scenes },
  { id:'target_customer', group:'상세페이지', label:'타깃 고객', source:'이미지/경쟁사 분석', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.target_customer || a.target || a.customer },
  { id:'season_event', group:'상세페이지', label:'시즌/행사', source:'신화사DB/Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.season_event || a.event_season || a.occasion || a.season },
  { id:'image_keywords', group:'상세페이지', label:'이미지 키워드', source:'신화사DB/Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.image_keywords || a.visual_keywords || a.image_keyword || a.keywords_for_image },
  { id:'image_work_hint', group:'상세페이지', label:'이미지 작업 힌트', source:'신화사DB/Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.image_work_hint || a.image_hint || a.visual_direction || a.photo_direction },
  { id:'detail_page_hint', group:'상세페이지', label:'상세페이지/설명 힌트', source:'신화사DB/Cafe24', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.detail_page_hint || a.description_hint || a.detail_hint || a.copy_hint },
  { id:'selling_point', group:'상세페이지', label:'핵심 판매 포인트', source:'이미지/경쟁사 분석', defaultActive:false, defaultRequired:false,
    get:(product, db, a) => a.selling_point || a.unique_selling_point || a.marketing_point },
];

function normalizeProductInfoFieldSettings(raw = null) {
  const settings = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  PRODUCT_INFO_FIELD_CATALOG.forEach(field => {
    const saved = source[field.id] || {};
    const active = saved.active !== undefined ? !!saved.active : !!field.defaultActive;
    const required = saved.required !== undefined ? !!saved.required : !!field.defaultRequired;
    settings[field.id] = { active, required: active ? required : false };
  });
  return settings;
}

function productInfoFieldSetting(fieldId) {
  if (!state.productInfoFieldSettings) state.productInfoFieldSettings = normalizeProductInfoFieldSettings();
  if (!state.productInfoFieldSettings[fieldId]) {
    const field = PRODUCT_INFO_FIELD_CATALOG.find(item => item.id === fieldId);
    state.productInfoFieldSettings[fieldId] = {
      active: !!field?.defaultActive,
      required: !!field?.defaultRequired,
    };
  }
  return state.productInfoFieldSettings[fieldId];
}

function normalizeProductInfoManualValues(raw = null) {
  const values = {};
  const source = raw && typeof raw === 'object' ? raw : {};
  Object.entries(source).forEach(([key, value]) => {
    const text = productInfoValueText(value);
    if (text) values[key] = text;
  });
  return values;
}

function productInfoFieldResolved(field, product, db) {
  const manual = state.productInfoManualValues?.[field.id];
  if (hasProductValue(manual)) return { value: manual, source: '직접 입력' };
  const a = state.analysis || {};
  try {
    if (field.resolve) {
      const resolved = field.resolve(product, db, a) || {};
      return {
        value: resolved.value ?? '',
        source: resolved.source || field.source,
      };
    }
    return { value: field.get ? field.get(product, db, a) : '', source: field.source };
  } catch(e) {
    return { value: '', source: field.source };
  }
}

function productInfoFieldValue(field, product, db) {
  return productInfoFieldResolved(field, product, db).value;
}

function productInfoValueText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => hasProductValue(v))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
      .join(' / ');
  }
  return String(value ?? '').trim();
}

function getConfiguredProductInfoRows(product, db, options = {}) {
  return PRODUCT_INFO_FIELD_CATALOG.map(field => {
    const setting = productInfoFieldSetting(field.id);
    const manualText = productInfoValueText(state.productInfoManualValues?.[field.id] || '');
    const resolved = productInfoFieldResolved(field, product, db);
    const value = resolved.value;
    const text = productInfoValueText(value);
    return {
      ...field,
      value,
      text,
      ok: hasProductValue(value),
      active: !!setting.active,
      required: !!setting.required,
      source: resolved.source || (manualText ? '직접 입력' : field.source),
      originalSource: field.source,
      manualValue: manualText,
    };
  }).filter(row => options.includeInactive || row.active);
}

function setProductInfoFieldSetting(fieldId, patch = {}) {
  const settings = normalizeProductInfoFieldSettings(state.productInfoFieldSettings || {});
  const current = settings[fieldId];
  if (!current) return;
  const next = { ...current, ...patch };
  if (!next.active) next.required = false;
  if (next.required) next.active = true;
  settings[fieldId] = next;
  state.productInfoFieldSettings = settings;
  savePersistentState();
  render();
}

function resetProductInfoFieldSettings() {
  state.productInfoFieldSettings = normalizeProductInfoFieldSettings();
  state.productInfoOptionsOpen = true;
  savePersistentState();
  render();
}

function setProductInfoManualValue(fieldId, value) {
  const text = productInfoValueText(value);
  state.productInfoManualValues = normalizeProductInfoManualValues(state.productInfoManualValues || {});
  if (text) state.productInfoManualValues[fieldId] = text;
  else delete state.productInfoManualValues[fieldId];
  setProductInfoFieldSetting(fieldId, { active: true });
}

function clearProductInfoManualValue(fieldId) {
  state.productInfoManualValues = normalizeProductInfoManualValues(state.productInfoManualValues || {});
  delete state.productInfoManualValues[fieldId];
  savePersistentState();
  render();
}

function normalizeSinhwaDbCandidate(product, query, score = null, index = 0) {
  const spec = product?.spec || {};
  const dimensions = formatDbDimensions(spec) || product?.jsize || product?.dimensions || '';
  const images = Array.isArray(product?.images) ? product.images : [];
  const firstImage = images[0] || null;
  return {
    jcode: product?.jcode ?? product?.code ?? product?.id ?? '',
    id: product?.id ?? '',
    product_name: normalizeDbName(product),
    jname: product?.jname || '',
    jname2: product?.jname2 || '',
    score: Number.isFinite(Number(score)) ? Number(score) : scoreSinhwaProductCandidate(product, [query], index),
    match_query: query || '',
    dimensions,
    color: product?.color_label || product?.color || '',
    stock_qty: product?.jhavep_qty ?? product?.jhavep ?? null,
    purchase_price: product?.jip_price_amount ?? product?.jip_price ?? null,
    sale_price: product?.jop_price_amount ?? product?.jop_price ?? null,
    image: absoluteSinhwaMediaUrl(product?.image || product?.image_url || product?.thumb_url || product?.thumb || firstImage?.thumb_url || firstImage?.thumb_path || firstImage?.url || firstImage?.file_path || ''),
    images: images.slice(0, 4).map(img => ({
      id: img.id,
      color_label: img.color_label || '',
      url: absoluteSinhwaMediaUrl(img.url || img.file_path),
      thumb_url: absoluteSinhwaMediaUrl(img.thumb_url || img.thumb_path || img.url || img.file_path),
    })),
  };
}

function sinhwaUsageListText(value) {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return Object.values(value).map(v => String(v || '').trim()).filter(Boolean).join(', ');
  return String(value || '').trim();
}

function normalizeSinhwaUsageProfile(rawProfile = null) {
  const profile = rawProfile && typeof rawProfile === 'object' ? rawProfile : {};
  const usagePlace = sinhwaUsageListText(profile.usage_places || profile.usagePlaces || profile.usage_place);
  const purpose = sinhwaUsageListText(profile.purposes || profile.recommended_use || profile.usage_purpose || profile.purpose);
  const targetCustomer = sinhwaUsageListText(profile.target_customers || profile.target_customer);
  const seasonEvent = sinhwaUsageListText(profile.season_events || profile.season_event || profile.occasion);
  const styleKeywords = sinhwaUsageListText(profile.style_keywords || profile.image_keywords || profile.visual_keywords);
  return {
    usage_profile: Object.keys(profile).length ? profile : null,
    usage_place: usagePlace,
    recommended_use: purpose,
    usage_purpose: purpose,
    target_customer: targetCustomer,
    season_event: seasonEvent,
    image_keywords: styleKeywords,
    image_work_hint: String(profile.image_prompt_notes || profile.image_work_hint || '').trim(),
    detail_page_hint: String(profile.detail_page_notes || profile.detail_page_hint || '').trim(),
  };
}

async function fetchSinhwaUsageProfile(jcode) {
  if (!jcode) return null;
  try {
    const context = await fetchSinhwaPdpProductContext(jcode);
    const usage = context?.product?.catalog?.usage;
    if (usage && typeof usage === 'object') return usage;
  } catch(e) {
    console.warn('Sinhwa PDP usage profile failed.', e);
  }
  return null;
}

async function enrichSinhwaProductDetailWithUsage(detail, jcode, options = {}) {
  const source = detail && typeof detail === 'object' ? { ...detail } : {};
  const code = jcode || source.jcode || source.id || source.product?.jcode;
  if (!code || source.usage_profile || options.apiHubOnly) return source;
  const usageProfile = await fetchSinhwaUsageProfile(code);
  if (!usageProfile) return source;
  source.usage_profile = usageProfile;
  return source;
}

function dbCandidateKey(product) {
  return String(product?.jcode || product?.id || normalizeDbName(product));
}

async function findSinhwaDbCandidateMatches(terms, options = {}) {
  const allCandidates = [];
  let usedQuery = terms[0] || '';
  const collectMultiple = options.collectMultiple !== false;
  const searchResults = await Promise.allSettled(terms.map(term =>
    searchSinhwaProducts(term, { apiHubOnly: options.apiHubOnly === true })
  ));
  let firstSuccessfulQuery = '';
  const failures = [];
  for (let index = 0; index < searchResults.length; index += 1) {
    const term = terms[index];
    const result = searchResults[index];
    if (result.status === 'rejected') {
      failures.push(result.reason);
      continue;
    }
    const products = result.value;
    if (products.length) {
      if (!firstSuccessfulQuery) firstSuccessfulQuery = term;
      allCandidates.push(...products);
      if (!collectMultiple) break;
    }
  }
  if (firstSuccessfulQuery) usedQuery = firstSuccessfulQuery;
  const deduped = [];
  const seen = new Set();
  allCandidates.slice(0, collectMultiple ? 40 : allCandidates.length).forEach(product => {
    const key = dbCandidateKey(product);
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(product);
  });
  if (!deduped.length && failures.length === searchResults.length) throw failures[0];
  if (!deduped.length) throw new Error(`신화사 DB에서 "${terms[0]}" 후보를 찾지 못했습니다.`);
  const termInfo = options.termInfo || { terms, nameTerms: terms, clueTerms: [] };
  const ranked = deduped
    .map((product, index) => ({
      product,
      index,
      score: options.imageWeighted
        ? scoreImageWeightedSinhwaCandidate(product, termInfo, index)
        : scoreSinhwaProductCandidate(product, terms, index),
    }))
    .sort((a, b) => b.score - a.score);
  return { usedQuery, ranked };
}

function normalizeSinhwaDbMatch(product, detail, query, candidates = []) {
  const source = detail || product || {};
  const spec = source.spec || product?.spec || {};
  const usage = normalizeSinhwaUsageProfile(source.usage_profile || product?.usage_profile || null);
  const groups = Array.isArray(source.groups) ? source.groups : [];
  const images = Array.isArray(source.images) ? source.images : [];
  const colors = [
    source.color_label,
    source.color,
    ...groups.map(g => g.color_label),
    ...images.map(img => img.color_label),
  ].filter(Boolean);
  const dimensions = formatDbDimensions(spec);
  const uniqueColors = [...new Set(colors.map(String))];
  return {
    source: '신화사DB API Hub',
    connector_id: SINHWA_DB_API.connectorId,
    matched_at: Date.now(),
    match_query: query,
    match_score: scoreSinhwaProductCandidate(source, [query], 0),
    jcode: source.jcode ?? product?.jcode ?? '',
    id: source.id ?? product?.id ?? '',
    product_name: normalizeDbName(source) || normalizeDbName(product),
    jname: source.jname || product?.jname || '',
    jname2: source.jname2 || product?.jname2 || '',
    size: dimensions || source.jsize || product?.jsize || '',
    dimensions,
    color: uniqueColors.join(', '),
    colors: uniqueColors,
    stock_qty: source.jhavep_qty ?? source.jhavep ?? product?.jhavep ?? null,
    stock_status: source.stock_status || product?.stock_status || '',
    purchase_price: source.jip_price_amount ?? source.jip_price ?? product?.jip_price ?? null,
    sale_price: source.jop_price_amount ?? source.jop_price ?? product?.jop_price ?? null,
    product_weight_g: spec.product_weight_g ?? null,
    package_weight_g: spec.package_weight_g ?? null,
    shipping_weight_g: spec.shipping_weight_g ?? null,
    material_summary: spec.material_summary || '',
    packaging_summary: spec.packaging_summary || '',
    usage_profile: usage.usage_profile,
    usage_place: usage.usage_place || '',
    recommended_use: usage.recommended_use || '',
    usage_purpose: usage.usage_purpose || '',
    target_customer: usage.target_customer || '',
    season_event: usage.season_event || '',
    image_keywords: usage.image_keywords || '',
    image_work_hint: usage.image_work_hint || '',
    detail_page_hint: usage.detail_page_hint || '',
    spec: {
      width_mm: spec.width_mm ?? null,
      depth_mm: spec.depth_mm ?? null,
      height_mm: spec.height_mm ?? null,
      product_weight_g: spec.product_weight_g ?? null,
      package_weight_g: spec.package_weight_g ?? null,
      shipping_weight_g: spec.shipping_weight_g ?? null,
      material_summary: spec.material_summary || '',
      packaging_summary: spec.packaging_summary || '',
      source: spec.source || '',
      updated_at: spec.updated_at || '',
    },
    images: images.slice(0, 5).map(img => ({
      id: img.id,
      color_label: img.color_label || '',
      caption: img.caption || '',
      url: absoluteSinhwaMediaUrl(img.url || img.file_path),
      thumb_url: absoluteSinhwaMediaUrl(img.thumb_url || img.thumb_path || img.url || img.file_path),
      is_primary: !!img.is_primary,
    })),
    candidates: candidates.slice(0, 5).map((p, idx) => ({
      ...normalizeSinhwaDbCandidate(p, query, scoreSinhwaProductCandidate(p, [query], idx), idx),
    })),
  };
}

async function searchSinhwaProducts(query, options = {}) {
  if (!options.apiHubOnly) {
    try {
      const pdpPage = await fetchSinhwaPdpBackend('products/search', { q: query, limit: 8 });
      const pdpProducts = asSinhwaProductArray(pdpPage);
      if (pdpProducts.length) return pdpProducts;
    } catch(e) {
      console.warn('PDP backend search failed; trying API Hub.', e);
    }
  }
  try {
    const body = await invokeSinhwaDbEndpoint(SINHWA_DB_API.endpoints.search, {
      query: { q: query, limit_each: 8 },
    });
    const products = asSinhwaProductArray(body);
    if (products.length || options.apiHubOnly) return products;
  } catch(e) {
    if (options.apiHubOnly) throw e;
    console.warn('API Hub DB search failed; trying direct DB hub.', e);
  }
  throw new Error(`신화사 DB에서 "${query}" 후보를 찾지 못했습니다.`);
}

async function fetchSinhwaProductDetail(jcode, options = {}) {
  if (!jcode) return null;
  let detail = null;
  if (!options.apiHubOnly) {
    try {
      detail = flattenSinhwaPdpProductContext(await fetchSinhwaPdpProductContext(jcode));
      return await enrichSinhwaProductDetailWithUsage(detail, jcode, options);
    } catch(e) {
      console.warn('PDP backend detail failed; trying API Hub.', e);
    }
  }
  try {
    detail = await invokeSinhwaDbEndpoint(SINHWA_DB_API.endpoints.detail, {
      pathParams: { jcode: String(jcode) },
      query: { include_raw: false },
    });
      return await enrichSinhwaProductDetailWithUsage(detail, jcode, options);
  } catch(e) {
    if (options.apiHubOnly) throw e;
    console.warn('API Hub DB detail failed; trying direct DB hub.', e);
  }
  throw new Error(`신화사 DB에서 상품코드 ${jcode}를 찾지 못했습니다.`);
}

function applySinhwaDbMatch(match) {
  if (!match) return;
  state.analysis = state.analysis || {};
  state.analysis.db_match = match;
  state.analysis.db_product = match;
  state.analysis.db_facts = formatDbMatchDetail(match);
  state.analysis.db_matched_at = match.matched_at;
  if (match.usage_place) state.analysis.usage_place = match.usage_place;
  if (match.recommended_use || match.usage_purpose) {
    state.analysis.recommended_use = match.recommended_use || match.usage_purpose;
    state.analysis.usage_purpose = match.usage_purpose || match.recommended_use;
  }
  if (match.target_customer) state.analysis.target_customer = match.target_customer;
  if (match.season_event) state.analysis.season_event = match.season_event;
  if (match.image_keywords) state.analysis.image_keywords = match.image_keywords;
  if (match.image_work_hint) state.analysis.image_work_hint = match.image_work_hint;
  if (match.detail_page_hint) state.analysis.detail_page_hint = match.detail_page_hint;
  if (!state.productName && match.product_name) state.productName = match.product_name;
  state.dbMatchCandidates = match.candidates || [];
  state.dbMatchLastQuery = match.match_query || '';
  state.dbMatchSelectionOpen = false;
  const nextJcode = String(match.jcode || match.id || '');
  if (state.dbColorOptionsLastJcode && state.dbColorOptionsLastJcode !== nextJcode) {
    state.dbColorOptions = [];
    state.dbColorOptionsError = '';
    state.dbColorOptionsLoadedAt = null;
  }
  if (!state.dbColorOptionsLastJcode || state.dbColorOptionsLastJcode !== nextJcode) {
    state.dbColorOptionsLastJcode = '';
  }
}

async function applySinhwaDbCandidateByCode(jcode) {
  const code = String(jcode || '').trim();
  if (!code) return null;
  const candidate = (state.dbMatchCandidates || []).find(item => String(item.jcode || item.id || '') === code) || { jcode: code };
  state.dbMatchBusy = true;
  state.dbMatchError = '';
  state.dbMatchLastQuery = candidate.match_query || state.dbMatchLastQuery || '';
  render();
  try {
    const detail = await fetchSinhwaProductDetail(candidate.jcode || candidate.id || code);
    const match = normalizeSinhwaDbMatch(candidate, detail, state.dbMatchLastQuery || candidate.product_name || code, state.dbMatchCandidates || []);
    applySinhwaDbMatch(match);
    const run = getActiveAnalysisRun();
    if (run?.sources) run.sources.db = true;
    pushAnalysisLog('신화사 DB 후보 선택 완료', `${match.product_name || '제품'} #${match.jcode || '-'} · ${formatDbMatchDetail(match)}`, 30);
    savePersistentState();
    return match;
  } catch(e) {
    const msg = e?.message || String(e);
    state.dbMatchError = `DB 후보 적용 실패: ${msg}`;
    pushAnalysisLog('신화사 DB 후보 적용 실패', msg, 30);
    return null;
  } finally {
    state.dbMatchBusy = false;
    render();
  }
}

async function refreshCurrentSinhwaDbMatch() {
  const current = state.analysis?.db_match || state.analysis?.db_product || null;
  const jcode = String(current?.jcode || current?.id || '').trim();
  if (!jcode) {
    state.dbMatchError = '먼저 DB 상품을 매칭해야 최신값을 새로고침할 수 있습니다.';
    savePersistentState();
    render();
    return null;
  }
  state.dbMatchBusy = true;
  state.dbMatchError = '';
  pushAnalysisLog('신화사 DB 최신값 새로고침 중...', `상품코드 #${jcode}의 상세값을 다시 불러옵니다.`, 30);
  render();
  try {
    const detail = await fetchSinhwaProductDetail(jcode);
    const candidate = {
      ...current,
      jcode,
      product_name: current.product_name || current.jname || state.productName || '',
      match_query: current.match_query || state.dbMatchLastQuery || state.productName || '',
    };
    const match = normalizeSinhwaDbMatch(candidate, detail, candidate.match_query || candidate.product_name || jcode, state.dbMatchCandidates || current.candidates || []);
    match.match_score = current.match_score || match.match_score || 0;
    applySinhwaDbMatch(match);
    pushAnalysisLog('신화사 DB 최신값 반영 완료', `${match.product_name || '제품'} #${match.jcode || '-'} · ${formatDbMatchDetail(match)}`, 34);
    savePersistentState();
    return match;
  } catch(e) {
    const msg = e?.message || String(e);
    state.dbMatchError = `DB 최신값 새로고침 실패: ${msg}`;
    pushAnalysisLog('신화사 DB 최신값 새로고침 실패', msg, 34);
    return null;
  } finally {
    state.dbMatchBusy = false;
    render();
  }
}

function runtimeOperationContextIsCurrent(context = null) {
  return !context || typeof context.isCurrent !== 'function' || context.isCurrent();
}

function assertRuntimeOperationContextCurrent(context = null) {
  if (!runtimeOperationContextIsCurrent(context)) throw new Error('STALE_MENU_OPERATION');
}

async function matchCurrentProductToSinhwaDb(options = {}) {
  const operationContext = options.operationContext || null;
  const renderUpdates = options.renderUpdates !== false;
  const manual = options.manual === true;
  const autoApply = options.autoApply !== false && !manual;
  const termInfo = collectProductSearchTermInfo({ includeVisualClues: true, limit: 12, settings: options.settings || state.analysisMatchSettings });
  const terms = termInfo.terms;
  if (!terms.length) {
    state.dbMatchError = '검색할 제품명이 없습니다. 제품명을 입력하거나 이미지 분석을 먼저 실행해주세요.';
    if (renderUpdates) { savePersistentState(); render(); }
    return null;
  }
  state.dbMatchBusy = true;
  state.dbMatchError = '';
  state.dbMatchLastQuery = terms[0];
  const dbSearchLogMessage = manual ? '신화사 DB 후보 검색 중...' : '신화사 DB 매칭 중...';
  const dbSearchDetail = `검색어: ${terms.join(' / ')} · API Hub ${SINHWA_DB_API.connectorId}`;
  pushAnalysisLog(dbSearchLogMessage, dbSearchDetail, 27);
  if (renderUpdates) render();
  try {
    const { usedQuery, ranked, detail } = await runWithAnalysisPhaseProgress({
      displayMessage: manual ? '신화사 DB 후보 검색 중' : '신화사 DB 매칭 중',
      logMessage: dbSearchLogMessage,
      detail: dbSearchDetail,
      start: 27,
      end: autoApply ? 42 : 30,
      expectedMs: 35000,
      operationContext,
    }, async () => {
      const found = await findSinhwaDbCandidateMatches(terms, {
        termInfo,
        imageWeighted: true,
        collectMultiple: true,
      });
      if (!autoApply) return { ...found, detail: null };
      const bestProduct = found.ranked[0]?.product;
      const productDetail = await fetchSinhwaProductDetail(bestProduct?.jcode);
      return { ...found, detail: productDetail };
    });
    assertRuntimeOperationContextCurrent(operationContext);
    state.dbMatchCandidates = ranked.slice(0, 8).map(item => normalizeSinhwaDbCandidate(item.product, usedQuery, item.score, item.index));
    state.dbMatchLastQuery = usedQuery;
    if (!autoApply) {
      state.dbMatchSelectionOpen = true;
      state.dbMatchError = '';
      pushAnalysisLog('신화사 DB 후보 검색 완료', `${state.dbMatchCandidates.length}개 후보를 찾았습니다. 목록에서 실제 제품을 선택해주세요.`, 30);
      return null;
    }
    const best = ranked[0]?.product;
    const match = normalizeSinhwaDbMatch(best, detail, usedQuery, ranked.map(item => item.product));
    match.match_score = ranked[0]?.score || match.match_score || 0;
    applySinhwaDbMatch(match);
    const run = getActiveAnalysisRun();
    if (run?.sources) run.sources.db = true;
    state.dbMatchError = '';
    pushAnalysisLog('신화사 DB 매칭 완료', `${match.product_name || '제품'} #${match.jcode || '-'} · ${formatDbMatchDetail(match)}`, 30);
    return match;
  } catch(e) {
    if (!runtimeOperationContextIsCurrent(operationContext)) return null;
    const msg = e?.message || String(e);
    state.dbMatchError = `DB 매칭 실패: ${msg}`;
    pushAnalysisLog('신화사 DB 매칭 실패', msg, 30);
    return null;
  } finally {
    if (!runtimeOperationContextIsCurrent(operationContext)) return;
    state.dbMatchBusy = false;
    savePersistentState();
    if (renderUpdates) render();
  }
}

function getActiveAnalysisRun() {
  const runs = Array.isArray(state.analysisRuns) ? state.analysisRuns : [];
  return runs.find(run => run.id === state.currentAnalysisRunId) || runs.find(run => run.status === 'running') || null;
}

function appendAnalysisLogToRun(run, message, detail = '', progress = null) {
  if (!run) return;
  run.logs = Array.isArray(run.logs) ? run.logs : [];
  const nextProgress = Number.isFinite(progress)
    ? Math.max(Number(run.progress || state.progress || 0) || 0, Number(progress))
    : run.progress;
  run.logs.push({
    ts: Date.now(),
    message: String(message || ''),
    detail: String(detail || ''),
    progress: Number.isFinite(nextProgress) ? nextProgress : run.progress,
  });
  if (Number.isFinite(nextProgress)) run.progress = nextProgress;
  run.lastUpdatedAt = Date.now();
  state.progress = Number.isFinite(nextProgress) ? nextProgress : state.progress;
  state.progressMsg = String(message || state.progressMsg || '');
}

function isProductAnalysisRunning() {
  return state.step === 'analyzing' && !!getActiveAnalysisRun()?.status && getActiveAnalysisRun().status === 'running';
}

function pushAnalysisLog(message, detail = '', progress = null) {
  const run = getActiveAnalysisRun();
  if (!run) return;
  appendAnalysisLogToRun(run, message, detail, progress);
  savePersistentState();
}

let analysisPhaseProgressTicker = null;
let analysisPhaseProgressSaveAt = 0;

function stopAnalysisPhaseProgressTicker(token = '') {
  if (!analysisPhaseProgressTicker) return;
  if (token && analysisPhaseProgressTicker.token !== token) return;
  clearInterval(analysisPhaseProgressTicker.timer);
  analysisPhaseProgressTicker = null;
}

function patchAnalysisPhaseProgressInPlace() {
  if (typeof document === 'undefined') return false;
  const root = document.querySelector('[data-analysis-progress-status]');
  if (!root) return state.step !== 'analyzing';
  const active = getActiveAnalysisRun();
  if (!active || active.status !== 'running') return false;
  const progress = Math.max(0, Math.min(100, Math.round(Number(active.progress ?? state.progress ?? 0) || 0)));
  const latestLog = Array.isArray(active.logs) && active.logs.length ? active.logs[active.logs.length - 1] : null;
  const message = state.progressMsg || latestLog?.message || '제품 이미지 분석 중...';
  const lastUpdatedAt = active.lastUpdatedAt || latestLog?.ts || active.startedAt;
  const elapsedSec = lastUpdatedAt ? Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000)) : 0;
  const messageNode = root.querySelector('[data-analysis-progress-message]');
  const progressBar = root.querySelector('[data-analysis-progress-bar]');
  const elapsedNode = root.querySelector('[data-analysis-progress-elapsed]');
  if (!messageNode || !progressBar || !elapsedNode) return false;
  messageNode.textContent = message;
  progressBar.style.width = `${progress}%`;
  progressBar.textContent = `${progress}%`;
  elapsedNode.textContent = `마지막 진행 갱신 ${elapsedSec}초 전`;
  const logList = root.querySelector('[data-analysis-progress-logs]');
  if (logList && typeof renderAnalysisRunLogs === 'function') logList.innerHTML = renderAnalysisRunLogs(active);
  return true;
}

function startAnalysisPhaseProgress(options = {}) {
  const run = getActiveAnalysisRun();
  if (!run || run.status !== 'running') return () => {};
  stopAnalysisPhaseProgressTicker();
  const token = uid('analysis_phase');
  const startedAt = Date.now();
  const start = Math.max(Number(run.progress || state.progress || 0) || 0, Number(options.start ?? run.progress ?? 0) || 0);
  const end = Math.max(start, Math.min(99, Number(options.end ?? start) || start));
  const expectedMs = Math.max(8000, Number(options.expectedMs || 90000));
  const tickMs = Math.max(1000, Number(options.tickMs || 2000));
  const displayMessage = String(options.displayMessage || options.logMessage || state.progressMsg || '분석 진행 중');
  const logMessage = String(options.logMessage || displayMessage);
  const baseDetail = String(options.detail || '');
  const update = () => {
    if (!runtimeOperationContextIsCurrent(options.operationContext || null)) {
      stopAnalysisPhaseProgressTicker(token);
      return;
    }
    const active = getActiveAnalysisRun();
    if (!active || active.id !== run.id || active.status !== 'running') {
      stopAnalysisPhaseProgressTicker(token);
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    const ratio = Math.min(0.96, elapsedMs / expectedMs);
    const next = Math.max(
      Number(active.progress || state.progress || 0) || 0,
      Math.min(end, Math.round(start + (end - start) * ratio))
    );
    active.progress = next;
    active.lastUpdatedAt = Date.now();
    active.livePhase = {
      message: displayMessage,
      logMessage,
      startedAt,
      expectedMs,
      min: start,
      max: end,
      progress: next,
      elapsedMs,
    };
    state.progress = next;
    state.progressMsg = `${displayMessage} · ${Math.floor(elapsedMs / 1000)}초 경과`;
    const latest = Array.isArray(active.logs) ? active.logs[active.logs.length - 1] : null;
    if (latest && latest.message === logMessage) {
      latest.progress = next;
      latest.detail = [
        baseDetail || latest.detail || '',
        `진행 중: ${Math.floor(elapsedMs / 1000)}초 경과 · 단계 범위 ${start}-${end}%`,
      ].filter(Boolean).join('\n');
    }
    if (Date.now() - analysisPhaseProgressSaveAt > 15000) {
      analysisPhaseProgressSaveAt = Date.now();
      savePersistentState();
    }
    const patched = typeof patchAnalysisPhaseProgressInPlace === 'function'
      && patchAnalysisPhaseProgressInPlace();
    if (!patched) render();
  };
  analysisPhaseProgressTicker = { token, runId: run.id, timer: setInterval(update, tickMs) };
  update();
  return () => stopAnalysisPhaseProgressTicker(token);
}

async function runWithAnalysisPhaseProgress(options, task) {
  const stop = startAnalysisPhaseProgress(options);
  try {
    return await task();
  } finally {
    stop();
  }
}

function beginProductAnalysisRun(options = {}) {
  stopAnalysisPhaseProgressTicker();
  const llmInfo = options.llmInfo || getCurrentLlmRunInfo();
  const combination = getAnalysisCombinationInfo();
  const run = {
    id: uid('analysis_run'),
    kind: 'product_image',
    title: '제품 이미지 분석',
    status: 'running',
    startedAt: Date.now(),
    endedAt: null,
    lastUpdatedAt: Date.now(),
    progress: 10,
    llm: llmInfo,
    imageModel: null,
    combination: {
      id: combination.id,
      title: combination.title,
      desc: combination.desc,
      sources: combination.selectedSources.map(src => src.title),
      missing: combination.missingSources.map(src => src.missing),
    },
    sources: {
      image: !!state.imageBase64,
      imageCount: Math.max(1, state.analysisImages?.length || (state.imageBase64 ? 1 : 0)),
      db: !!(state.analysis?.db_match || state.analysis?.db_product || state.analysis?.dbProduct || state.analysis?.db_facts || state.competitorData?.db_match),
      competitor: !!state.compPage?.analysisResult,
      competitorTips: (loadCompetitorTipBank().tips || []).length,
    },
    logs: [],
    resultSummary: '',
  };
  state.analysisRuns = [run, ...(state.analysisRuns || []).filter(item => item.id !== run.id)].slice(0, 30);
  state.currentAnalysisRunId = run.id;
  pushAnalysisLog('분석 준비 중...', renderModelRunLine(llmInfo), 10);
  return run;
}

function finishProductAnalysisRun(status, summary = '') {
  const run = getActiveAnalysisRun();
  if (!run) return;
  stopAnalysisPhaseProgressTicker();
  run.status = status;
  run.endedAt = Date.now();
  run.lastUpdatedAt = run.endedAt;
  run.progress = status === 'done' ? 100 : run.progress;
  run.resultSummary = summary || run.resultSummary || '';
  if (status === 'done') {
    pushAnalysisLog('분석 완료', summary || '제품 이미지 분석 결과가 섹션 설정에 반영되었습니다.', 100);
  } else if (status === 'error') {
    pushAnalysisLog('분석 실패', summary || '분석 중 오류가 발생했습니다.', run.progress || state.progress || 0);
  }
  savePersistentState();
}

function factoryProductAnalysisForGeneration(factory = null) {
  if (typeof factoryRuntimeReadFactory !== 'function') return null;
  try { factory = factory || factoryRuntimeReadFactory(); } catch(e) { factory = null; }
  const candidates = [
    factory?.product?.analysis,
    factory?.product?.lastAnalysis,
    factory?.product?.productAnalysis,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    if (typeof analysisMatchesCurrentImageInput === 'function' && !analysisMatchesCurrentImageInput(candidate)) continue;
    return candidate;
  }
  return null;
}

function restoreFactoryInputImageForGeneration(factory = null) {
  if (state.imageBase64) return true;
  if (typeof factoryLockedInputImagePayload !== 'function' || typeof factoryRuntimeReadFactory !== 'function') return false;
  let payload = null;
  try { payload = factoryLockedInputImagePayload(factory || factoryRuntimeReadFactory()); } catch(e) { payload = null; }
  const base64 = typeof imageBase64Only === 'function'
    ? imageBase64Only(payload?.base64 || '')
    : String(payload?.base64 || '');
  if (!base64) return false;
  const mime = payload?.mime || payload?.mimeType || state.imageMime || 'image/png';
  state.imageBase64 = base64;
  state.imageMime = mime;
  state.imagePreview = payload?.preview && payload.preview !== '__stored_in_indexeddb__'
    ? payload.preview
    : `data:${mime};base64,${base64}`;
  if (!Array.isArray(state.analysisImages)) state.analysisImages = [];
  if (!state.analysisImages.some(img => img?.base64 === base64)) {
    state.analysisImages.unshift({
      base64,
      mime,
      preview: state.imagePreview,
      name: payload?.name || '현재 작업 제품 이미지',
      inputImageFingerprint: payload?.inputImageFingerprint || '',
      source: payload?.source || 'factory-locked-input',
    });
    state.analysisImages = state.analysisImages.slice(0, 5);
  }
  return true;
}

function ensureCurrentProductAnalysisForGeneration(options = {}) {
  const factory = options.factory || null;
  const currentOk = state.analysis && (
    typeof analysisMatchesCurrentImageInput !== 'function' ||
    analysisMatchesCurrentImageInput(state.analysis)
  );
  if (currentOk) {
    restoreFactoryInputImageForGeneration(factory);
    return true;
  }
  const factoryAnalysis = factoryProductAnalysisForGeneration(factory);
  if (!factoryAnalysis) return false;
  state.analysis = typeof cloneData === 'function' ? cloneData(factoryAnalysis) : { ...factoryAnalysis };
  if (typeof attachCurrentAnalysisImageIdentity === 'function') state.analysis = attachCurrentAnalysisImageIdentity(state.analysis);
  state.analysisTimestamp = state.analysisTimestamp || new Date().toISOString();
  restoreFactoryInputImageForGeneration(factory);
  if (options.save !== false && typeof savePersistentState === 'function') savePersistentState();
  return true;
}

function hasCurrentProductAnalysisForGeneration() {
  return !!(
    (state.analysis && (typeof analysisMatchesCurrentImageInput !== 'function' || analysisMatchesCurrentImageInput(state.analysis))) ||
    factoryProductAnalysisForGeneration()
  );
}

function productAnalysisGenerationBlockReason(sectionId = '') {
  if (sectionId && state.sectionLocks?.[sectionId]) return '잠금 해제 후 생성할 수 있습니다.';
  if (hasCurrentProductAnalysisForGeneration()) return '';
  const hasFactory = typeof factoryRuntimeReadFactory === 'function' && !!factoryRuntimeReadFactory()?.product?.analysis;
  if (hasFactory) return '현재 제품 이미지와 맞지 않는 이전 분석값이라 생성에 쓰지 않습니다. AI 분석 탭에서 현재 이미지 기준으로 다시 분석해주세요.';
  return '현재 작업의 제품 분석값이 없습니다. AI 분석 탭에서 제품 이미지를 먼저 분석해주세요.';
}

function stopActiveAnalysisRun(summary = '사용자가 분석을 중단했습니다.') {
  const run = getActiveAnalysisRun();
  stopAnalysisPhaseProgressTicker();
  if (run?.status === 'running') {
    appendAnalysisLogToRun(run, '분석 중단', summary, run.progress || state.progress || 0);
    run.status = 'error';
    run.endedAt = Date.now();
    run.lastUpdatedAt = run.endedAt;
    run.resultSummary = summary;
  }
  state.dbMatchBusy = false;
  state.progress = 0;
  state.progressMsg = '';
  state.error = summary;
  savePersistentState();
  render();
}

function expireStaleAnalysisRunIfNeeded(run) {
  if (!run || run.status !== 'running') return false;
  const lastUpdatedAt = Number(run.lastUpdatedAt || run.startedAt || 0);
  if (!lastUpdatedAt || Date.now() - lastUpdatedAt < ANALYSIS_RUN_STALE_MS) return false;
  stopAnalysisPhaseProgressTicker();
  appendAnalysisLogToRun(run, '분석 대기시간 초과', '마지막 진행 기록 이후 응답이 없어 자동으로 진행 상태를 해제했습니다. 같은 작업을 다시 실행할 수 있습니다.', run.progress || state.progress || 0);
  run.status = 'error';
  run.endedAt = Date.now();
  run.lastUpdatedAt = run.endedAt;
  run.resultSummary = '진행 상태가 오래 갱신되지 않아 자동 해제됨';
  state.dbMatchBusy = false;
  state.progress = 0;
  state.progressMsg = '';
  state.error = '분석 진행 상태가 오래 갱신되지 않아 해제했습니다. API Hub/DB 상태를 확인한 뒤 다시 실행해주세요.';
  savePersistentState();
  return true;
}

async function generateWithSelectedImageModel(prompt, productImageBase64, mimeType, extraImages = [], options = {}) {
  const imageModel = getImageModel();
  if (!hasImageConnection(imageModel)) return null;
  const client = createImageClient(imageModel);
  const normalize = typeof normalizeImagePayloadForApi === 'function'
    ? normalizeImagePayloadForApi
    : ((base64, mime) => ({ base64, mime: mime || 'image/png' }));
  const primary = productImageBase64 ? normalize(productImageBase64, mimeType || 'image/png') : { base64: '', mime: mimeType || 'image/png' };
  const refs = (extraImages || [])
    .map(img => img?.base64 ? normalize(img.base64, img.mime || img.mimeType || 'image/png') : null)
    .filter(img => img?.base64);
  return client.generateImage(prompt, primary.base64, primary.mime, imageModel, refs, options);
}

function cssFontFamily(value, fallback = "'Pretendard','Noto Sans KR',sans-serif") {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  // Prevent style-break/injection while allowing Korean/space/comma font names.
  const cleaned = raw.replace(/[<>`\\]/g, '').replace(/;/g, '').trim();
  if (!cleaned) return fallback;
  if (cleaned.includes(',') || /^['"].*['"]$/.test(cleaned)) return cleaned;
  return `'${cleaned}'`;
}

const STORAGE_KEYS = {
  sectionInstructions: 'section_instructions',
  imageDirectives: 'image_directives',
  brandPresets: 'brand_presets_v1',
  activeBrandPresetId: 'active_brand_preset_id',
  layoutTemplate: 'layout_template_v1',
  sectionGenerationModes: 'section_generation_modes_v1',
  sectionBasisModes: 'section_basis_modes_v1',
  sectionAssembly: 'section_assembly_v1',
  competitorTipBank: 'competitor_tip_bank_v1',
  optionStyleSamples: 'option_style_samples_v1',
  optionSlotNamePresets: 'option_slot_name_presets_v1',
  cafe24FieldView: 'factory_cafe24_field_view_v1',
  factoryLastSnapshot: 'factory_last_snapshot_v1',
  fixedDetailImages: 'fixed_detail_images_v1',
};

const FIXED_DETAIL_IMAGE_SLOTS = [
  {
    id: 'brand',
    label: '상단 브랜드 이미지',
    shortLabel: '브랜드',
    positionLabel: '상단 고정',
    desc: '모든 상세페이지 맨 위에 붙는 공통 브랜드 배너입니다.',
  },
  {
    id: 'package',
    label: '하단 포장 관련 안내',
    shortLabel: '포장 안내',
    positionLabel: '하단 고정',
    desc: '상세페이지 본문 아래에 붙는 포장/발송 공통 안내입니다.',
  },
  {
    id: 'return',
    label: '하단 반품 관련 안내',
    shortLabel: '반품 안내',
    positionLabel: '하단 고정',
    desc: '상세페이지 맨 아래에 붙는 반품/교환 공통 안내입니다.',
  },
];

function normalizeFixedDetailImages(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const normalized = {};
  for (const slot of FIXED_DETAIL_IMAGE_SLOTS) {
    const item = source[slot.id];
    if (!item) {
      normalized[slot.id] = null;
      continue;
    }
    if (typeof item === 'string') {
      normalized[slot.id] = {
        dataUrl: item,
        name: `${slot.shortLabel}.png`,
        updatedAt: Date.now(),
      };
      continue;
    }
    const dataUrl = item.dataUrl || item.image || item.preview || '';
    normalized[slot.id] = dataUrl ? {
      dataUrl,
      name: String(item.name || `${slot.shortLabel}.png`).slice(0, 120),
      mime: item.mime || '',
      updatedAt: Number(item.updatedAt || Date.now()),
    } : null;
  }
  return normalized;
}

function loadFixedDetailImages() {
  try {
    return normalizeFixedDetailImages(JSON.parse(workspaceSessionGetItem(STORAGE_KEYS.fixedDetailImages) || '{}'));
  } catch (e) {
    return normalizeFixedDetailImages();
  }
}

function saveFixedDetailImages(images) {
  try {
    workspaceSessionSetItem(STORAGE_KEYS.fixedDetailImages, JSON.stringify(normalizeFixedDetailImages(images)));
    return true;
  } catch (e) {
    console.warn('fixed detail image save failed:', e);
    return false;
  }
}

function stripFixedDetailImagesForSession(images = {}) {
  const normalized = normalizeFixedDetailImages(images);
  const compact = {};
  for (const slot of FIXED_DETAIL_IMAGE_SLOTS) {
    const item = normalized[slot.id];
    compact[slot.id] = item ? {
      name: item.name || '',
      mime: item.mime || '',
      updatedAt: item.updatedAt || null,
      hasImage: !!item.dataUrl,
    } : null;
  }
  return compact;
}

function mergeFixedDetailImages(...sources) {
  const merged = normalizeFixedDetailImages();
  for (const source of sources) {
    const normalized = normalizeFixedDetailImages(source || {});
    for (const slot of FIXED_DETAIL_IMAGE_SLOTS) {
      if (normalized[slot.id]?.dataUrl) merged[slot.id] = normalized[slot.id];
    }
  }
  return merged;
}

const SECTION_GENERATION_MODES = [
  {
    id: 'mixed',
    label: '이미지 생성 + 글자 따로',
    shortLabel: '이미지+글자 따로',
    desc: '상품 이미지는 생성하고, 문구는 앱에서 편집 가능한 텍스트로 얹습니다.',
    prompt: 'Generation mode: separate image plus editable text. Create editable Korean copy separately from the image. The image should not contain Korean copy unless explicitly requested; leave clean visual space for the app to place text.'
  },
  {
    id: 'full_image',
    label: '이미지+글자 전체 생성',
    shortLabel: '전체 이미지형',
    desc: '상품, 배경, 문구까지 한 장의 완성 상세페이지 이미지로 생성합니다.',
    prompt: 'Generation mode: full image including text. The generated image should work as a complete ecommerce section, including layout, product, concise Korean copy, and visual hierarchy. Put the key Korean copy inside the image itself. Keep text concise and legible.'
  },
  {
    id: 'text_only',
    label: '글자/레이아웃만',
    shortLabel: '글자만',
    desc: '카피와 레이아웃만 만들고 이미지 생성은 건너뜁니다.',
    prompt: 'Generation mode: text focused. Do not depend on a generated image. Make the Korean headline, body copy, bullets, and layout notes strong enough on their own.'
  }
];

function normalizeSectionGenerationModes(value) {
  const allowed = new Set(SECTION_GENERATION_MODES.map(m => m.id));
  const result = {};
  if (value && typeof value === 'object') {
    for (const [sectionId, modeId] of Object.entries(value)) {
      if (allowed.has(modeId)) result[sectionId] = modeId;
    }
  }
  return result;
}

function loadSectionGenerationModes() {
  return normalizeSectionGenerationModes(loadJson(STORAGE_KEYS.sectionGenerationModes, {}));
}

function saveSectionGenerationModes(modes) {
  saveJson(STORAGE_KEYS.sectionGenerationModes, normalizeSectionGenerationModes(modes));
}

function getSectionGenerationMode(sectionId) {
  const modeId = state?.sectionGenerationModes?.[sectionId] || 'mixed';
  return SECTION_GENERATION_MODES.some(m => m.id === modeId) ? modeId : 'mixed';
}

function getSectionGenerationModeInfo(sectionIdOrMode) {
  const modeId = SECTION_GENERATION_MODES.some(m => m.id === sectionIdOrMode)
    ? sectionIdOrMode
    : getSectionGenerationMode(sectionIdOrMode);
  return SECTION_GENERATION_MODES.find(m => m.id === modeId) || SECTION_GENERATION_MODES[0];
}

const SECTION_BASIS_MODES = [
  {
    id: 'current',
    label: '현재 지시문',
    shortLabel: '현재 지시문',
    desc: '섹션 입력창, 누적 팁, 직접 수정한 최종 프롬프트를 기준으로 생성합니다.',
    prompt: 'Generation basis: current section instructions. Use the visible section instructions as the main brief.'
  },
  {
    id: 'competitor_plan',
    label: '경쟁사 분석플랜',
    shortLabel: '경쟁사 플랜',
    desc: '경쟁사 분석에서 만든 섹션별 최종 프롬프트를 우선 기준으로 생성합니다.',
    prompt: 'Generation basis: competitor analysis plan. Use the competitor analysis plan instructions as the primary brief, but adapt them to our product without copying the competitor product.'
  },
  {
    id: 'image_analysis',
    label: 'AI 분석 + DB 확정값',
    shortLabel: '분석/DB',
    desc: 'AI 이미지 판독, 신화사DB 확정값, Cafe24 동기화 값을 기준으로 생성합니다. 경쟁사 플랜은 제외합니다.',
    prompt: 'Generation basis: confirmed product analysis, Sinhwa DB match, Cafe24 synced fields, and original product image. Treat confirmed DB/Cafe24 values as higher priority than visual guesses and ignore competitor plan copy.'
  },
  {
    id: 'combined',
    label: '총합버전',
    shortLabel: '총합',
    desc: 'AI 이미지 분석, DB/Cafe24 확정값, 경쟁사 분석/플랜, 현재 지시문을 종합해서 생성합니다.',
    prompt: 'Generation basis: integrated total version. Combine current user instructions, confirmed product analysis, Sinhwa DB/Cafe24 facts, original product image, and competitor analysis strategy. DB/original image facts are truth; competitor analysis is used only for structure, persuasion, and improvement ideas.'
  }
];

function normalizeSectionBasisModes(value) {
  const allowed = new Set(SECTION_BASIS_MODES.map(m => m.id));
  const result = {};
  if (value && typeof value === 'object') {
    for (const [sectionId, modeId] of Object.entries(value)) {
      if (allowed.has(modeId)) result[sectionId] = modeId;
    }
  }
  return result;
}

function loadSectionBasisModes() {
  return normalizeSectionBasisModes(loadJson(STORAGE_KEYS.sectionBasisModes, {}));
}

function saveSectionBasisModes(modes) {
  saveJson(STORAGE_KEYS.sectionBasisModes, normalizeSectionBasisModes(modes));
}

function getSectionBasisMode(sectionId) {
  const modeId = state?.sectionBasisModes?.[sectionId] || 'current';
  return SECTION_BASIS_MODES.some(m => m.id === modeId) ? modeId : 'current';
}

function getSectionBasisModeInfo(sectionIdOrMode) {
  const modeId = SECTION_BASIS_MODES.some(m => m.id === sectionIdOrMode)
    ? sectionIdOrMode
    : getSectionBasisMode(sectionIdOrMode);
  return SECTION_BASIS_MODES.find(m => m.id === modeId) || SECTION_BASIS_MODES[0];
}

const SECTION_ASSEMBLY_SOURCES = [
  {
    id: 'image_analysis',
    label: 'AI 분석 + DB 확정값',
    shortLabel: '분석/DB',
    desc: '제품 이미지 판독, DB 확정값, Cafe24 값처럼 우리 상품의 사실값을 씁니다.',
  },
  {
    id: 'competitor_plan',
    label: '경쟁사 분석플랜',
    shortLabel: '경쟁사 플랜',
    desc: '경쟁사 분석에서 만든 섹션 전략과 개선 포인트를 씁니다.',
  },
  {
    id: 'current',
    label: '현재 지시문',
    shortLabel: '현재 지시문',
    desc: '아래 입력창에 직접 쓴 요구사항을 최종 지시로 씁니다.',
  },
];

const SECTION_ASSEMBLY_CUT_USAGES = [
  { id: 'none', label: '이미지컷 사용 안 함', shortLabel: '안 씀', desc: '이 섹션은 기본 제품 이미지와 선택한 소스만 봅니다.' },
  { id: 'prompt', label: '프롬프트에 녹이기', shortLabel: '프롬프트 반영', desc: '선택한 이미지컷의 컨셉/프롬프트를 이 섹션 생성 지시에 섞습니다.' },
  { id: 'section', label: '섹션 이미지로 배치', shortLabel: '섹션 배치', desc: '선택한 이미지컷을 이 섹션의 고정 이미지로 배치합니다.' },
  { id: 'both', label: '프롬프트 + 섹션 배치', shortLabel: '둘 다', desc: '선택한 이미지컷을 생성 지시에 섞고 섹션 이미지로도 배치합니다.' },
  { id: 'auto', label: 'AI가 어울릴 때만', shortLabel: 'AI 판단', desc: '선택한 컷을 참고 후보로 넘기되, 어울릴 때만 섹션에 녹입니다.' },
];

const SECTION_ASSEMBLY_PLACEMENT_FIXED_SECTIONS = new Set(['specifications', 'size_color']);

function defaultSectionAssemblySources(basisId = 'current') {
  if (basisId === 'combined') {
    return {
      image_analysis: true,
      competitor_plan: true,
      current: true,
    };
  }
  return {
    image_analysis: basisId === 'image_analysis',
    competitor_plan: basisId === 'competitor_plan',
    current: basisId === 'current',
  };
}

function normalizeSectionAssemblySources(value = null) {
  const raw = value && typeof value === 'object' ? value : {};
  const next = {};
  SECTION_ASSEMBLY_SOURCES.forEach(source => {
    next[source.id] = !!raw[source.id];
  });
  if (!Object.values(next).some(Boolean)) next.current = true;
  return next;
}

function normalizeSectionAssemblyItem(item = {}) {
  const source = item && typeof item === 'object' ? item : {};
  const cutUsage = SECTION_ASSEMBLY_CUT_USAGES.some(usage => usage.id === source.cutUsage)
    ? source.cutUsage
    : 'none';
  return {
    sources: normalizeSectionAssemblySources(source.sources || source.sourceMix),
    cutUsage,
    cutAssetKey: String(source.cutAssetKey || source.cutId || '').trim(),
    note: String(source.note || '').slice(0, 1000),
    updatedAt: Number(source.updatedAt || 0) || 0,
  };
}

function normalizeSectionAssembly(value) {
  const result = {};
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([sectionId, item]) => {
      if (!sectionId) return;
      result[sectionId] = normalizeSectionAssemblyItem(item);
    });
  }
  return result;
}

function loadSectionAssembly() {
  return normalizeSectionAssembly(loadJson(STORAGE_KEYS.sectionAssembly, {}));
}

function saveSectionAssembly(assembly) {
  saveJson(STORAGE_KEYS.sectionAssembly, normalizeSectionAssembly(assembly));
}

function getSectionAssembly(sectionId) {
  const saved = state?.sectionAssembly?.[sectionId];
  if (saved) return normalizeSectionAssemblyItem(saved);
  return normalizeSectionAssemblyItem({
    sources: defaultSectionAssemblySources(getSectionBasisMode(sectionId)),
  });
}

function sectionAssemblySelectedSourceIds(sectionId) {
  const assembly = getSectionAssembly(sectionId);
  return SECTION_ASSEMBLY_SOURCES
    .map(source => source.id)
    .filter(id => assembly.sources?.[id]);
}

function hasCustomSectionAssembly(sectionId) {
  const saved = state?.sectionAssembly?.[sectionId];
  if (!saved) return false;
  const assembly = normalizeSectionAssemblyItem(saved);
  const basisId = getSectionBasisMode(sectionId);
  const defaultSources = defaultSectionAssemblySources(basisId);
  const sourceChanged = SECTION_ASSEMBLY_SOURCES.some(source => !!assembly.sources[source.id] !== !!defaultSources[source.id]);
  return sourceChanged || assembly.cutUsage !== 'none' || !!assembly.cutAssetKey || !!assembly.note.trim();
}

function sectionAssemblyCutUsageInfo(cutUsage) {
  return SECTION_ASSEMBLY_CUT_USAGES.find(usage => usage.id === cutUsage) || SECTION_ASSEMBLY_CUT_USAGES[0];
}

function sectionAssemblySourceSummary(sectionId) {
  const selected = sectionAssemblySelectedSourceIds(sectionId);
  return selected
    .map(id => {
      if (id === 'competitor_plan' && typeof sectionCompetitorPlanMissing === 'function' && sectionCompetitorPlanMissing(sectionId)) {
        return '경쟁사 플랜 생성 필요';
      }
      return SECTION_ASSEMBLY_SOURCES.find(source => source.id === id)?.shortLabel || id;
    })
    .join(' + ') || '현재 지시문';
}

function sectionAssemblyCanPlaceCutInSection(sectionId) {
  return !SECTION_ASSEMBLY_PLACEMENT_FIXED_SECTIONS.has(sectionId);
}

const LAYOUT_TEMPLATES = [
  { id: 'classic', label: 'Classic', desc: 'Centered hero sections with a familiar shopping-mall rhythm.' },
  { id: 'split', label: 'Split', desc: 'Alternating image/text blocks for faster scanning.' },
  { id: 'spotlight', label: 'Spotlight', desc: 'Bold headline-first layout with stronger visual emphasis.' },
  { id: 'minimal', label: 'Minimal', desc: 'Clean information-forward layout with restrained styling.' },
];

const WORKSPACE_DB = {
  name: 'pdp_workspace_v1',
  version: 4,
  projects: 'projects',
  snapshots: 'snapshots',
  sessionAssets: 'sessionAssets',
  appSettings: 'appSettings',
};

function workspacePersistenceApi() {
  const installed = window.__KUASANGSE_WORKSPACE_PERSISTENCE__;
  if (!installed) throw new Error('Workspace persistence orchestrator is not ready');
  return installed;
}

function workspaceSessionGetItem(key) {
  return workspacePersistenceApi().readRecoveryValue(key);
}

function validateIncomingWorkspaceBoundary(snapshot, options = {}) {
  const api = workspacePersistenceApi();
  const result = api.validateSnapshotIdentity(snapshot);
  if (!result.ok) {
    if (typeof state !== 'undefined') {
      state.storageWarning = `서로 다른 작업파일·제품명·기본이미지가 섞인 복원본을 차단했습니다. (${result.code})`;
      state.storageWarningDismissKey = `work-identity:${result.code}`;
    }
    return result;
  }
  const activeIdentity = typeof state !== 'undefined' ? state.workIdentity : null;
  if (activeIdentity && options.replaceWorkspace !== true) {
    const sameInstance = !result.identity || api.workIdentitiesMatch(activeIdentity, result.identity);
    const sameProduct = !result.productKey || !activeIdentity.initialProductKey
      || lastWorkIdentityKeysCompatible(result.productKey, activeIdentity.initialProductKey);
    const sameImage = !result.inputImageFingerprint || !activeIdentity.initialInputImageFingerprint
      || result.inputImageFingerprint === activeIdentity.initialInputImageFingerprint;
    if (!sameInstance || !sameProduct || !sameImage) {
      const conflict = Object.freeze({
        ok: false,
        code: !sameInstance
          ? 'WORK_IDENTITY_INSTANCE_CONFLICT'
          : (!sameProduct ? 'WORK_IDENTITY_PRODUCT_BINDING_CONFLICT' : 'WORK_IDENTITY_IMAGE_BINDING_CONFLICT'),
        identity: null,
      });
      state.storageWarning = `현재 탭과 다른 작업의 복원본을 차단했습니다. (${conflict.code})`;
      state.storageWarningDismissKey = `work-identity:${conflict.code}`;
      return conflict;
    }
  }
  return result;
}

const FACTORY_LAST_SNAPSHOT_RECOVERY_KEY = 'factory_last_snapshot_v1';

function factoryLastSnapshotRecoveryRevisionConflict(error, key = '') {
  if (String(key || '') === 'pdp_last_work_draft_scope_v1') return null;
  if (error?.code !== 'STALE_REVISION') return null;
  const lock = workspaceLockApi();
  const authority = lock?.snapshot?.() || null;
  const current = error?.current;
  if (!authority || !current || typeof current !== 'object') return null;
  const currentRevision = Number(current.revision);
  const authorityRevision = Number(authority.revision);
  if (String(current.scopeId || '') !== String(authority.scopeId || '')
    || String(current.leaseId || '') !== String(authority.leaseId || '')
    || Number(current.fencingToken) !== Number(authority.fencingToken)
    || !Number.isSafeInteger(currentRevision)
    || !Number.isSafeInteger(authorityRevision)
    || currentRevision <= authorityRevision
    || typeof lock.observeRevision !== 'function') return null;
  return {
    lock,
    authority: {
      scopeId: String(authority.scopeId || ''),
      leaseId: String(authority.leaseId || ''),
      fencingToken: Number(authority.fencingToken),
    },
    revision: currentRevision,
  };
}

async function reconcileMatchingWorkspaceReplicaRevision(error, key = '') {
  const conflict = factoryLastSnapshotRecoveryRevisionConflict(error, key);
  if (!conflict) return false;
  try {
    await Promise.resolve(conflict.lock.observeRevision(
      conflict.revision,
      conflict.authority.fencingToken,
    ));
  } catch (_) {
    return false;
  }
  const retryAuthority = conflict.lock.snapshot?.() || null;
  const retryRevision = Number(retryAuthority?.revision);
  return !!retryAuthority
    && String(retryAuthority.scopeId || '') === conflict.authority.scopeId
    && String(retryAuthority.leaseId || '') === conflict.authority.leaseId
    && Number(retryAuthority.fencingToken) === conflict.authority.fencingToken
    && Number.isSafeInteger(retryRevision)
    && retryRevision >= conflict.revision;
}

function writeWorkspaceRecoveryValue(key, value) {
  const pending = workspacePersistenceApi().writeRecoveryValue(key, value);
  const reconciled = pending.catch(async error => {
    if (!(await reconcileMatchingWorkspaceReplicaRevision(error, key))) throw error;
    return workspacePersistenceApi().writeRecoveryValue(key, value);
  });
  reconciled.catch(error => console.warn(`Workspace recovery write failed (${key}):`, error));
  return reconciled;
}

function workspaceSessionSetItem(key, value) {
  if (key === FACTORY_LAST_SNAPSHOT_RECOVERY_KEY) {
    return queueFactoryLastSnapshotRecoveryWrite(value);
  }
  return writeWorkspaceRecoveryValue(key, value);
}

function workspaceSessionRemoveItem(key) {
  const pending = workspacePersistenceApi().clearRecoveryValue(key);
  pending.catch(error => console.warn(`Workspace recovery clear failed (${key}):`, error));
  return pending;
}

function loadWorkspaceSessionJson(key, fallback) {
  try {
    const raw = workspaceSessionGetItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function workspaceArchiveFetch(url, options = {}) {
  return workspacePersistenceApi().fetchArchiveResource(url, options);
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function normalizeOptionSlotNamePresets(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((item, index) => {
    const name = String(item?.name || '').trim().slice(0, 40);
    const slotNames = (Array.isArray(item?.slotNames) ? item.slotNames : [])
      .slice(0, 30)
      .map((slotName, slotIndex) => String(slotName || '').trim().slice(0, 40) || `${slotIndex + 1}번`);
    const id = String(item?.id || '').trim() || `option-slot-preset-${index + 1}`;
    if (!name || !slotNames.length || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name, slotNames, updatedAt: Number(item?.updatedAt || 0) || 0 }];
  }).slice(0, 30);
}

function getOptionSlotNamePresets() {
  return normalizeOptionSlotNamePresets(loadJson(STORAGE_KEYS.optionSlotNamePresets, []));
}

function saveOptionSlotNamePreset(value = {}) {
  const name = String(value.name || '').trim().slice(0, 40);
  const slotNames = (Array.isArray(value.slotNames) ? value.slotNames : [])
    .slice(0, 30)
    .map((slotName, index) => String(slotName || '').trim().slice(0, 40) || `${index + 1}번`);
  if (!name || !slotNames.length) throw new Error('프리셋 이름과 슬롯 이름이 필요합니다.');
  const presets = getOptionSlotNamePresets();
  const existing = presets.find(item => item.id === value.id || item.name === name);
  const preset = {
    id: existing?.id || String(value.id || '').trim() || uid('option-slot-preset'),
    name,
    slotNames,
    updatedAt: Date.now(),
  };
  saveJson(STORAGE_KEYS.optionSlotNamePresets, [
    preset,
    ...presets.filter(item => item.id !== preset.id && item.name !== preset.name),
  ].slice(0, 30));
  return preset;
}

function mainScrollElement() {
  const candidates = [
    document.querySelector('.app'),
    document.querySelector('main.main'),
    document.querySelector('.main'),
    document.scrollingElement,
    document.documentElement,
    document.body,
  ].filter(Boolean);
  const scrollable = candidates.find(el => {
    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    const overflowY = `${style?.overflowY || ''} ${style?.overflow || ''}`;
    return el.scrollHeight > el.clientHeight + 2 && /auto|scroll|overlay/i.test(overflowY);
  });
  return scrollable || document.scrollingElement || document.documentElement;
}

function restoreMainScrollPosition(top, left) {
  const el = mainScrollElement();
  if (!el) {
    window.scrollTo(left, top);
    return;
  }
  // 이미 맞는 위치에 다시 쓰지 않는다. 같은 값이라도 반복해서 쓰면
  // 배치가 끝나기 전 값으로 잘렸다가 되튀는 일이 생긴다.
  if (Math.abs(el.scrollTop - top) > 1) el.scrollTop = top;
  if (Math.abs(el.scrollLeft - left) > 1) el.scrollLeft = left;
}

// 누른 것을 기준으로 삼기 위해, 클릭 직전의 화면 위치를 기억해 둔다.
let renderScrollAnchorNodes = null;
let renderScrollAnchorAt = 0;

function installRenderScrollAnchorCapture() {
  if (installRenderScrollAnchorCapture.installed) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  installRenderScrollAnchorCapture.installed = true;
  const remember = event => {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const pressed = target.closest('button, a, input, select, textarea, label, [role="button"]') || target;
    // 누른 버튼은 다시 그릴 때 다른 버튼으로 교체될 수 있다('이 신화사DB 맞음' → '확정됨').
    // 그때를 대비해 그것을 담고 있는 카드도 함께 기억한다.
    const container = typeof pressed.closest === 'function'
      ? pressed.closest('.factory-candidate-card, .factory-candidate-panel, .factory-card, section')
      : null;
    renderScrollAnchorNodes = [pressed, container || pressed.parentElement]
      .filter(node => node && typeof node.getBoundingClientRect === 'function');
    renderScrollAnchorAt = Date.now();
  };
  // pointerdown 만 듣던 때는 키보드로 누른 버튼과 element.click() 을 놓쳤다.
  // click 은 캡처 단계에서 듣기 때문에 앱의 위임 처리기보다 먼저 도착한다.
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('click', event => {
    remember(event);
    // 누른 뒤의 다시 그리기는 경로가 여럿이고 비동기다. 어떤 것은
    // renderPreservingMainScroll 을 거치지 않고 곧장 render() 나 탭 패치를 부른다.
    // 그래서 렌더 함수가 아니라 '누른 순간' 에 매달아 두고, 화면이 자리잡을 때까지
    // 몇 번 확인하며 되민다. 이미 제자리면 아무것도 쓰지 않으므로 떨림이 생기지 않는다.
    scheduleRenderScrollAnchorCorrection();
  }, true);
  // 사람이 스스로 스크롤하면 우리 보정이 방해가 된다. 그때는 즉시 그만둔다.
  const cancel = () => { renderScrollAnchorCorrectionToken += 1; };
  document.addEventListener('wheel', cancel, { capture: true, passive: true });
  document.addEventListener('touchmove', cancel, { capture: true, passive: true });
  document.addEventListener('keydown', event => {
    if (/^(Arrow|Page|Home|End)/.test(String(event.key || ''))) cancel();
  }, true);
}

// 다시 그리기 직전에, 기준으로 쓸 요소와 그 화면 높이를 확정한다.
function captureRenderScrollAnchors() {
  const anchors = [];
  const push = node => {
    if (!node || node === document.body || node === document.documentElement) return;
    if (!node.isConnected || typeof node.getBoundingClientRect !== 'function') return;
    if (anchors.some(entry => entry.node === node)) return;
    anchors.push({ node, top: node.getBoundingClientRect().top });
  };
  // 값을 입력하는 중이라면 그 칸이 가장 정확한 기준이다.
  push(document.activeElement);
  if (renderScrollAnchorNodes && Date.now() - renderScrollAnchorAt < 2000) {
    renderScrollAnchorNodes.forEach(push);
  }
  return anchors;
}

// 누른 뒤 화면이 자리잡을 때까지 몇 번 확인하며 되민다.
// 고정된 숫자를 반복해서 쓰던 예전 방식은 배치 중간값에 잘려 떨림을 만들었다.
// 여기서는 '기준이 움직인 만큼' 만 쓰고, 안 움직였으면 아무것도 쓰지 않아 수렴한다.
let renderScrollAnchorCorrectionToken = 0;

// 다시 그리기는 비동기이고, 작업파일이 커지거나 서버가 느리면 **한참 뒤에** 한 번 더 온다.
// 예전에는 클릭 후 400ms 까지만 확인해서, 그 뒤에 도착한 렌더에 카드가 밀려도 손을 못 썼다.
// 실측: 회귀 PERF-04 가 단독 실행에서는 늘 통과하는데(4/4) 전체 실행에서만 실패했다
// (카드 top 210 -> 608). 145개 스텝이 보관·상태 폴더를 공유해 뒤로 갈수록 렌더가 늦어진다.
//
// 그렇다고 시간을 늘려 계속 훑으면 안 된다. 그렇게 했다가 DB-10(실제 포인터 클릭 검사)이
// 3/3 결정적으로 깨졌다 — 보정이 스크롤을 움직이는 사이 다음 클릭 좌표가 어긋난 것이다.
// 그래서 시계가 아니라 **렌더에 매단다.** 렌더가 없으면 아무것도 건드리지 않는다.
const RENDER_SCROLL_ANCHOR_SETTLE_MS = 2500;
let renderScrollAnchorPending = null;

function scheduleRenderScrollAnchorCorrection() {
  const anchors = captureRenderScrollAnchors();
  if (!anchors.length) return;
  renderScrollAnchorCorrectionToken += 1;
  const token = renderScrollAnchorCorrectionToken;
  // 렌더를 거치지 않는 즉시 반영 경로를 위해 짧게 몇 번은 그대로 확인한다.
  const attempt = () => {
    if (token !== renderScrollAnchorCorrectionToken) return;
    applyRenderScrollAnchors(anchors);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(attempt);
  [60, 180, 400].forEach(delay => setTimeout(attempt, delay));
  // 그 뒤에 오는 늦은 렌더는 render() 가 끝날 때 한 번만 되민다.
  renderScrollAnchorPending = { anchors, token, deadline: Date.now() + RENDER_SCROLL_ANCHOR_SETTLE_MS };
}

// render() 끝에서 부른다. 늦게 도착한 다시 그리기로 카드가 밀렸으면 그때 한 번 되민다.
// 렌더가 일어나지 않았으면 호출 자체가 없으므로 스크롤을 건드릴 일도 없다.
function applyPendingRenderScrollAnchorAfterRender() {
  const pending = renderScrollAnchorPending;
  if (!pending) return;
  if (pending.token !== renderScrollAnchorCorrectionToken || Date.now() > pending.deadline) {
    renderScrollAnchorPending = null;
    return;
  }
  const apply = () => {
    if (!renderScrollAnchorPending || pending.token !== renderScrollAnchorCorrectionToken) return;
    applyRenderScrollAnchors(pending.anchors);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
  else apply();
}

// 기준이 살아남았으면, 그것이 화면에서 움직인 만큼만 스크롤을 되민다.
// 반환값은 '기준을 찾아 처리했는가' 다. 호출부(renderPreservingMainScroll)가 그 의미로 쓰므로
// 바꾸면 안 된다. 실제로 되밀었는지는 stats.moved 로 따로 알린다.
function applyRenderScrollAnchors(anchors, stats = null) {
  if (!anchors || !anchors.length) return false;
  const el = mainScrollElement();
  if (!el) return false;
  for (const entry of anchors) {
    if (!entry.node.isConnected) continue;
    const delta = entry.node.getBoundingClientRect().top - entry.top;
    if (!Number.isFinite(delta)) continue;
    if (Math.abs(delta) > 1) {
      el.scrollTop += delta;
      if (stats) stats.moved = true;
    }
    return true;
  }
  return false;
}

function renderPreservingMainScroll() {
  if (typeof shouldDeferFactoryWizardFullRender === 'function' && shouldDeferFactoryWizardFullRender()) return;
  installRenderScrollAnchorCapture();
  const before = mainScrollElement();
  const top = before ? before.scrollTop : window.scrollY;
  const left = before ? before.scrollLeft : window.scrollX;
  // 스크롤 숫자만 지키면 부족하다. 동작을 누르면 진행 안내가 뜨고 목록이 접혀
  // 페이지가 짧아지는데, 그러면 브라우저가 스크롤을 끝으로 잘라내면서 화면이 위로 올라간다.
  // (실측: 최대 3074 -> 1595, 누른 카드가 화면 210 -> 608 로 밀림)
  // 그래서 '방금 누른 것' 을 기준으로 잡고, 그것이 제자리에 있도록 되민다.
  const anchors = captureRenderScrollAnchors();
  render();
  if (applyRenderScrollAnchors(anchors)) return;
  // patchAppHtml 은 morphChildren 으로 제자리 갱신하므로 노드가 살아남는다.
  // 그래서 브라우저 스크롤 앵커링이 위치를 잡아 준다. 예전에는 앵커링을 끄고
  // 80ms 동안 네 번 되돌렸는데, 배치가 끝나기 전 위치로 잘렸다가 되튀기를
  // 반복해 화면이 위아래로 떨렸다. 이제 한 번만, 그것도 실제로 어긋났을 때만 쓴다.
  restoreMainScrollPosition(top, left);
}

function cloneData(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCss(value) {
  const text = String(value ?? '');
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(text);
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\]/g, '\\]');
}

function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return '';
  const hex = match[1];
  const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
  return `#${full.toLowerCase()}`;
}

function colorInputValue(value, fallback = '#000000') {
  return normalizeHexColor(value) || fallback;
}

function nl2br(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function summarizeText(value, limit = 90) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function loadImageDirectives() {
  return loadJson(STORAGE_KEYS.imageDirectives, []);
}

function createEmptyBrandPreset() {
  return {
    id: '',
    name: '',
    tone: '',
    requiredKeywords: '',
    bannedPhrases: '',
    headlineFont: 'Pretendard',
    bodyFont: 'Pretendard',
    accentColor: '#b56d3a',
    backgroundColor: '',
    imageDirectives: '',
    globalInstruction: '',
  };
}

function normalizeBrandPreset(preset) {
  const next = { ...createEmptyBrandPreset(), ...(preset || {}) };
  next.name = String(next.name || '').trim();
  next.tone = String(next.tone || '').trim();
  next.requiredKeywords = String(next.requiredKeywords || '').trim();
  next.bannedPhrases = String(next.bannedPhrases || '').trim();
  next.headlineFont = String(next.headlineFont || '').trim() || 'Pretendard';
  next.bodyFont = String(next.bodyFont || '').trim() || next.headlineFont || 'Pretendard';
  next.accentColor = String(next.accentColor || '').trim() || '#b56d3a';
  next.backgroundColor = String(next.backgroundColor || '').trim();
  next.imageDirectives = String(next.imageDirectives || '').trim();
  next.globalInstruction = String(next.globalInstruction || '').trim();
  return next;
}

function compactListText(value, separator = '\n') {
  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === 'object' ? JSON.stringify(item) : String(item || '').trim())
      .filter(Boolean)
      .join(separator);
  }
  if (value && typeof value === 'object') {
    return Object.values(value)
      .map(item => typeof item === 'object' ? JSON.stringify(item) : String(item || '').trim())
      .filter(Boolean)
      .join(separator);
  }
  return String(value || '').trim();
}

function pickObjectValue(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value) && value.length) return value;
    if (value && typeof value === 'object' && Object.keys(value).length) return value;
    if (String(value || '').trim()) return value;
  }
  return '';
}

function normalizeCompetitorStylePreset(rawPreset, analysisResult = null) {
  const source = rawPreset
    || analysisResult?.style_preset
    || analysisResult?.visual_style_preset
    || analysisResult?.brand_preset
    || {};
  const palette = Array.isArray(analysisResult?.color_palette) ? analysisResult.color_palette : [];
  if (!source || typeof source !== 'object') {
    const colorsOnly = [...new Set(palette.map(normalizeHexColor).filter(Boolean))];
    return { hasAny: colorsOnly.length > 0, colorPalette: colorsOnly };
  }
  const colorPalette = [...new Set([
    ...palette,
    ...(Array.isArray(source.color_palette) ? source.color_palette : []),
    pickObjectValue(source, ['accentColor', 'accent_color', 'highlight_color', 'primary_color']),
    pickObjectValue(source, ['backgroundColor', 'background_color', 'base_color']),
    pickObjectValue(source, ['textColor', 'text_color']),
  ].map(normalizeHexColor).filter(Boolean))];
  const accentColor = normalizeHexColor(pickObjectValue(source, ['accentColor', 'accent_color', 'highlight_color', 'primary_color'])) || colorPalette[0] || '';
  const backgroundColor = normalizeHexColor(pickObjectValue(source, ['backgroundColor', 'background_color', 'base_color'])) || colorPalette[1] || '';
  const textColor = normalizeHexColor(pickObjectValue(source, ['textColor', 'text_color'])) || colorPalette[2] || '';
  const preset = {
    hasAny: false,
    name: compactListText(pickObjectValue(source, ['name', 'preset_name', 'presetName', 'title'])) || '타사 상세페이지 스타일 프리셋',
    tone: compactListText(pickObjectValue(source, ['tone', 'tone_manner', 'toneAndManner', 'tone_mood', 'copy_tone']), ' / '),
    requiredKeywords: compactListText(pickObjectValue(source, ['requiredKeywords', 'required_keywords', 'keywords', 'must_keywords']), '\n'),
    bannedPhrases: compactListText(pickObjectValue(source, ['bannedPhrases', 'banned_phrases', 'avoid_phrases', 'avoidExpressions']), '\n'),
    headlineFont: compactListText(pickObjectValue(source, ['headlineFont', 'headline_font', 'headline_font_style', 'title_font_style']), ' / '),
    bodyFont: compactListText(pickObjectValue(source, ['bodyFont', 'body_font', 'body_font_style', 'text_font_style']), ' / '),
    accentColor,
    backgroundColor,
    textColor,
    colorPalette,
    imageDirectives: compactListText(pickObjectValue(source, ['imageDirectives', 'image_direction', 'image_directives', 'visual_direction', 'photo_direction']), '\n'),
    layoutStyle: compactListText(pickObjectValue(source, ['layoutStyle', 'layout_style', 'composition', 'layout_direction']), '\n'),
    visualMood: compactListText(pickObjectValue(source, ['visualMood', 'visual_mood', 'mood', 'style_keywords']), ' / '),
    globalInstruction: compactListText(pickObjectValue(source, ['globalInstruction', 'global_instruction', 'preset_instruction', 'overall_instruction']), '\n'),
    confidence: compactListText(pickObjectValue(source, ['confidence', 'confidence_level']), ' / '),
    extractedFrom: analysisResult?.page_title || analysisResult?.title || '',
  };
  preset.hasAny = [
    preset.tone,
    preset.requiredKeywords,
    preset.bannedPhrases,
    preset.headlineFont,
    preset.bodyFont,
    preset.accentColor,
    preset.backgroundColor,
    preset.textColor,
    preset.imageDirectives,
    preset.layoutStyle,
    preset.visualMood,
    preset.globalInstruction,
  ].some(Boolean) || preset.colorPalette.length > 0;
  return preset;
}

function competitorStyleToBrandPreset(analysisResult) {
  const style = normalizeCompetitorStylePreset(null, analysisResult);
  if (!style.hasAny) return null;
  const nameBase = style.extractedFrom ? summarizeText(style.extractedFrom, 28) : '타사 상세페이지';
  const globalItems = [
    style.globalInstruction,
    style.layoutStyle ? `레이아웃 방향: ${style.layoutStyle}` : '',
    style.visualMood ? `시각 무드: ${style.visualMood}` : '',
    '주의: 타사 제품명/효능/가격/인증 문구를 복제하지 말고, 우리 제품 데이터와 원본 이미지에 맞게 재해석합니다.',
  ].filter(Boolean);
  return normalizeBrandPreset({
    ...createEmptyBrandPreset(),
    name: style.name && style.name !== '타사 상세페이지 스타일 프리셋' ? style.name : `타사 스타일: ${nameBase}`,
    tone: style.tone,
    requiredKeywords: style.requiredKeywords,
    bannedPhrases: style.bannedPhrases,
    headlineFont: style.headlineFont || 'Pretendard',
    bodyFont: style.bodyFont || style.headlineFont || 'Pretendard',
    accentColor: style.accentColor || '#b56d3a',
    backgroundColor: style.backgroundColor,
    imageDirectives: style.imageDirectives,
    globalInstruction: globalItems.join('\n'),
  });
}

function loadBrandPresets() {
  return loadJson(STORAGE_KEYS.brandPresets, []).map(normalizeBrandPreset);
}

function saveBrandPresets(presets) {
  saveJson(STORAGE_KEYS.brandPresets, (presets || []).map(normalizeBrandPreset));
}

function loadActiveBrandPresetId() {
  try { return localStorage.getItem(STORAGE_KEYS.activeBrandPresetId) || ''; } catch (e) { return ''; }
}

function saveActiveBrandPresetId(id) {
  try { localStorage.setItem(STORAGE_KEYS.activeBrandPresetId, id || ''); } catch (e) {}
}

function loadLayoutTemplate() {
  try {
    const id = localStorage.getItem(STORAGE_KEYS.layoutTemplate) || 'classic';
    return LAYOUT_TEMPLATES.some(t => t.id === id) ? id : 'classic';
  } catch (e) {
    return 'classic';
  }
}

function saveLayoutTemplate(id) {
  try { localStorage.setItem(STORAGE_KEYS.layoutTemplate, id); } catch (e) {}
}

async function workspaceGet(storeName, key) {
  if (storeName === WORKSPACE_DB.sessionAssets) return workspaceGetSessionAssets();
  if (storeName === WORKSPACE_DB.appSettings) return workspacePersistenceApi().loadPreference(key);
  if (storeName === WORKSPACE_DB.projects) return workspacePersistenceApi().loadProject(key);
  if (storeName === WORKSPACE_DB.snapshots) return workspacePersistenceApi().loadSnapshot(key);
  throw new Error(`Unsupported workspace record type: ${storeName}`);
}

async function workspaceGetAll(storeName) {
  if (storeName === WORKSPACE_DB.projects) return workspacePersistenceApi().listProjects();
  if (storeName === WORKSPACE_DB.snapshots) return workspacePersistenceApi().listSnapshots();
  throw new Error(`Unsupported workspace list type: ${storeName}`);
}

async function workspacePut(storeName, value) {
  if (storeName === WORKSPACE_DB.sessionAssets) return workspacePersistenceApi().saveSessionAssets(
    value?.scopeId || value?.workspaceScope?.id || value?.workspaceRevision?.scopeId || value?.currentProjectId || currentSessionAssetScope(),
    value,
  );
  if (storeName === WORKSPACE_DB.appSettings) return workspacePersistenceApi().savePreference(value);
  if (storeName === WORKSPACE_DB.projects) return workspacePersistenceApi().updateProject(value);
  if (storeName === WORKSPACE_DB.snapshots) return workspacePersistenceApi().saveSnapshot(value);
  throw new Error(`Unsupported workspace record type: ${storeName}`);
}

async function workspaceDelete(storeName, key) {
  if (storeName === WORKSPACE_DB.sessionAssets) return workspacePersistenceApi().clearSessionAssets(currentSessionAssetScope());
  if (storeName === WORKSPACE_DB.appSettings) return workspacePersistenceApi().clearPreference(key);
  if (storeName === WORKSPACE_DB.projects) return workspacePersistenceApi().removeProject(key);
  if (storeName === WORKSPACE_DB.snapshots) return workspacePersistenceApi().removeSnapshot(key);
  throw new Error(`Unsupported workspace record type: ${storeName}`);
}

async function workspacePutMany(entries) {
  return Promise.all((entries || []).map(entry => workspacePut(entry.storeName, entry.value)));
}

function currentSessionAssetScope() {
  return getCurrentLastWorkWorkspaceScope();
}

function currentSessionAssetId() {
  return workspacePersistenceApi().sessionAssetId(currentSessionAssetScope());
}

async function workspaceGetSessionAssets(scopeId = currentSessionAssetScope()) {
  return workspacePersistenceApi().loadSessionAssets(scopeId);
}

async function workspacePutSessionAssets(payload) {
  return workspacePersistenceApi().saveSessionAssets(currentSessionAssetScope(), payload);
}

const SESSION_ASSET_ID = 'current';
const LAST_PRODUCT_IMAGE_BACKUP_ID = 'lastProductImageBackup';
const IMAGE_STORED_MARKER = '__stored_in_indexeddb__';
const STORAGE_WARNING_DISMISSED_SESSION_KEY = 'pdp_dismissed_storage_warning_key';
const LAST_WORK_DRAFT_SCOPE_STORAGE_KEY = 'pdp_last_work_draft_scope_v1';
let lastWorkDraftScopeCache = '';
let lastWorkDraftScopePersistencePromise = Promise.resolve(true);
const LAST_WORK_BOOTSTRAP_STORAGE_KEY = 'pdp_last_work_bootstrap_v1';
const pendingLastWorkBootstrapWrites = new Set();
let sessionAssetSaveTimer = null;
let lastWorkSaveTimer = null;
let optionSorterLiveSaveTimer = null;
let optionSorterLiveSaveQueued = false;
let lastLightweightSessionPayload = null;
let sessionAssetsHydrated = false;
let pendingSessionAssetSaveAfterHydrate = false;
let sessionAssetSavePromise = null;
let sessionAssetSaveRequestedAgain = false;
let lastSessionAssetFingerprint = '';
let lastLocalSessionJson = null;
let lastWorkSyncingVisibleInputs = false;
let persistentStateSaving = false;
let persistentStateSavePromise = null;
let persistentStateSaveRetryTimer = null;
const workspaceScopeTransitionState = {
  inProgress: false,
  persistentSaveQueued: false,
};
const SERVER_LAST_WORK_RETRY_BASE_MS = 15_000;
const SERVER_LAST_WORK_RETRY_MAX_MS = 60_000;
let serverLastWorkSaveTimer = null;
let serverLastWorkSavePromise = null;
let serverLastWorkSaveRequestedAgain = false;
let serverLastWorkForceSaveRequested = false;
let serverLastWorkFactorySnapshotRequested = null;
let serverLastWorkFailureCount = 0;
let serverLastWorkRetryAfter = 0;
let serverLastWorkHydrated = false;
let serverLastWorkHydrating = false;
let serverLastWorkLastSavedAt = 0;
let serverLastWorkHydrationPromise = null;
let workspaceBlankResetToken = 0;
let workspaceBackgroundHydrationIntentToken = 0;
let workspaceBlankResetInProgress = false;
let lastVisibleInputSyncAt = 0;
let factoryLastSnapshotSaveTimer = null;
let factoryLastSnapshotSavePending = false;
let pendingFactoryLastSnapshotRecoveryWrite = null;
let lastCafe24FieldViewPersistedJson = '';
let lastProductImageBackupFingerprint = '';
let lastProductImageBackupSavePromise = null;
const LAST_WORK_INPUT_CHECKPOINT_KEY = 'pdp_last_input_checkpoint_v1';
const LAST_WORK_INPUT_IDLE_MS = 1400;
let lastInteractiveInputAt = 0;
let lastInteractiveInputMeta = null;
let lastWorkInputCheckpointTimer = null;
let lastWorkPageLeaveFlushInProgress = false;

function captureWorkspaceBackgroundHydrationIntent() {
  return workspaceBackgroundHydrationIntentToken;
}

function workspaceBackgroundHydrationIntentIsCurrent(intentToken) {
  return intentToken === workspaceBackgroundHydrationIntentToken;
}

function invalidateWorkspaceBackgroundHydration() {
  workspaceBackgroundHydrationIntentToken += 1;
  return workspaceBackgroundHydrationIntentToken;
}

function lastWorkTruncateText(value, limit = 1000) {
  const text = String(value ?? '');
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function lastWorkInputTargetMeta(target, eventType = 'input') {
  if (!target || typeof target !== 'object') return null;
  const tag = String(target.tagName || '').toLowerCase();
  const type = String(target.type || '').toLowerCase();
  const isSecret = type === 'password' || /token|secret|password|apikey|api_key/i.test(`${target.id || ''} ${target.name || ''}`);
  let value = '';
  if (!isSecret && 'value' in target && type !== 'file') {
    value = lastWorkTruncateText(target.value, 1200);
  }
  return {
    eventType,
    tag,
    type,
    id: String(target.id || '').slice(0, 120),
    name: String(target.name || '').slice(0, 120),
    fieldKey: String(target.dataset?.factoryWizardField || target.dataset?.factoryDbField || target.dataset?.factoryField || target.dataset?.factorySizeManual || '').slice(0, 160),
    value,
    checked: typeof target.checked === 'boolean' ? target.checked : undefined,
    at: Date.now(),
  };
}

function lastWorkIsInteractiveInputWindow(maxAge = LAST_WORK_INPUT_IDLE_MS) {
  return Date.now() - lastInteractiveInputAt < maxAge;
}

function lastWorkInputCheckpointPayload(reason = 'input') {
  const factory = (
    typeof factoryRuntimeReadCommittedFactory === 'function'
      ? factoryRuntimeReadCommittedFactory()
      : state.factory
  ) || {};
  const product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  const automation = factory.automation && typeof factory.automation === 'object' ? factory.automation : {};
  const checkpointScope = {
    workInstanceId: String(
      state.workIdentity?.instanceId || factory.workIdentity?.instanceId ||
      (typeof getCurrentLastWorkWorkspaceScope === 'function' ? getCurrentLastWorkWorkspaceScope() : '') || ''
    ).trim(),
    workspaceId: String(state.currentProjectId || factory.workspace?.id || '').trim(),
    productKey: String(
      (typeof factoryCurrentProductKey === 'function' && factoryCurrentProductKey(factory)) ||
      product.productKey || product.productIdentityKey || ''
    ).trim(),
    currentRunId: String(
      (typeof factoryCurrentWorkflowRunId === 'function' && factoryCurrentWorkflowRunId(factory)) ||
      product.currentRunId || automation.currentRunId || factory.goalRun?.currentRunId || ''
    ).trim(),
    inputImageFingerprint: String(
      (typeof factoryCurrentInputImageFingerprint === 'function' && factoryCurrentInputImageFingerprint(factory)) ||
      product.inputImageFingerprint || ''
    ).trim(),
    stageId: 'db-size',
  };
  return {
    savedAt: Date.now(),
    reason,
    step: state.step || '',
    productName: state.productName || product.productName || '',
    currentProjectId: state.currentProjectId || '',
    currentProjectName: state.currentProjectName || '',
    checkpointScope,
    factory: {
      activeStage: factory.activeStage || '',
      product: {
        productName: product.productName || '',
        naturalHint: product.naturalHint || '',
        selectedDbCandidateKey: product.selectedDbCandidateKey || '',
        selectedCafe24CandidateKey: product.selectedCafe24CandidateKey || '',
        cafe24DraftProductKey: product.cafe24DraftProductKey || '',
        dbFieldSettings: product.dbFieldSettings && typeof product.dbFieldSettings === 'object'
          ? product.dbFieldSettings
          : {},
        finalDb: product.finalDb && typeof product.finalDb === 'object'
          ? product.finalDb
          : {},
      },
      automation: {
        activeTab: automation.activeTab || '',
        activeTaskId: automation.activeTaskId || '',
        dbSearchQuery: automation.dbSearchQuery || '',
        optionMode: automation.optionMode || '',
        fieldDrafts: automation.fieldDrafts && typeof automation.fieldDrafts === 'object'
          ? automation.fieldDrafts
          : {},
        sizeFieldDrafts: automation.sizeFieldDrafts && typeof automation.sizeFieldDrafts === 'object'
          ? automation.sizeFieldDrafts
          : {},
      },
    },
    productInfoManualValues: state.productInfoManualValues && typeof state.productInfoManualValues === 'object'
      ? state.productInfoManualValues
      : {},
    lastInput: lastInteractiveInputMeta,
  };
}

function saveLastWorkInputCheckpoint(reason = 'input') {
  if (lastWorkInputCheckpointTimer) {
    clearTimeout(lastWorkInputCheckpointTimer);
    lastWorkInputCheckpointTimer = null;
  }
  try {
    void workspaceSessionSetItem(
      LAST_WORK_INPUT_CHECKPOINT_KEY,
      JSON.stringify(lastWorkInputCheckpointPayload(reason)),
    );
  } catch(e) {}
}

function scheduleLastWorkInputCheckpointSave(delay = 700) {
  const wait = Math.max(120, Math.min(Number(delay) || 700, 1200));
  if (lastWorkInputCheckpointTimer) clearTimeout(lastWorkInputCheckpointTimer);
  lastWorkInputCheckpointTimer = setTimeout(() => saveLastWorkInputCheckpoint('input-idle'), wait);
}

function markLastWorkInteractiveInput(target, eventType = 'input') {
  lastInteractiveInputAt = Date.now();
  lastInteractiveInputMeta = lastWorkInputTargetMeta(target, eventType);
  scheduleLastWorkInputCheckpointSave(eventType === 'change' ? 160 : 700);
}

let pendingStartupStorageWarning = null;

function setStorageWarningOnce(message, dismissKey = '') {
  const nextMessage = String(message || '');
  const nextKey = String(dismissKey || '');
  if (!factoryAppStateReady) {
    if (pendingStartupStorageWarning?.message === nextMessage
      && String(pendingStartupStorageWarning.dismissKey || '') === nextKey) return false;
    pendingStartupStorageWarning = { message: nextMessage, dismissKey: nextKey };
    return true;
  }
  if (state.storageWarning === nextMessage && String(state.storageWarningDismissKey || '') === nextKey) return false;
  state.storageWarning = nextMessage;
  state.storageWarningDismissKey = nextKey;
  return true;
}

function consumeStartupStorageWarning() {
  const pending = pendingStartupStorageWarning;
  pendingStartupStorageWarning = null;
  return pending;
}

function productImageBackupItem(source, data = {}) {
  if (!data || typeof data !== 'object') return null;
  const preview = String(data.preview || data.imagePreview || '').trim();
  const previewPart = /^data:([^;]+);base64,(.*)$/i.exec(preview);
  const base64 = String(data.base64 || data.imageBase64 || previewPart?.[2] || '').trim();
  if (!base64 && !displayableImageSrc(preview)) return null;
  const mime = String(data.mime || data.imageMime || '').trim() || previewPart?.[1] || 'image/png';
  return {
    source,
    base64,
    mime,
    preview: preview && preview !== '__stored_in_indexeddb__'
      ? preview
      : (base64 ? `data:${mime};base64,${base64}` : ''),
    name: String(data.name || data.imageName || data.fileName || '제품사진').slice(0, 160),
    defaultImageSeeded: data.defaultImageSeeded === true,
    updatedAt: Number(data.updatedAt || data.savedAt || Date.now()) || Date.now(),
  };
}

function compactProductImageBackupItem(item) {
  const normalized = productImageBackupItem(item?.source || 'backup', item);
  if (!normalized?.base64) return null;
  return {
    source: normalized.source || 'backup',
    base64: normalized.base64,
    mime: normalized.mime || 'image/png',
    name: normalized.name || '제품사진',
    defaultImageSeeded: normalized.defaultImageSeeded === true,
    updatedAt: normalized.updatedAt || Date.now(),
  };
}

function lastProductImageBackupStorageId(scopeId = getCurrentLastWorkWorkspaceScope()) {
  const scope = workspacePersistenceApi().normalizeWorkspaceScope(scopeId);
  return `${LAST_PRODUCT_IMAGE_BACKUP_ID}:${scope}`;
}

function productImageBackupWorkspaceScopeId(payload = {}) {
  const scope = payload?.workspaceScope?.id || payload?.workspaceScope || '';
  if (!scope) return '';
  try {
    return workspacePersistenceApi().normalizeWorkspaceScope(scope);
  } catch (_) {
    return '';
  }
}

function productImageBackupMatchesCurrentWorkspace(payload = {}, scopeId = getCurrentLastWorkWorkspaceScope()) {
  return productImageBackupWorkspaceScopeId(payload)
    === workspacePersistenceApi().normalizeWorkspaceScope(scopeId);
}

function currentBranchDocumentMigrationBoundary(scopeId = getCurrentLastWorkWorkspaceScope()) {
  const branchScopeId = workspacePersistenceApi().normalizeWorkspaceScope(scopeId);
  if (!branchScopeId.startsWith('draft:')) return null;
  const documentScopeId = getCurrentDocumentWorkspaceScope();
  if (!documentScopeId) return null;
  const branch = currentWorkspaceBranch(
    branchScopeId,
    documentScopeId.replace(/^project:/i, ''),
  );
  if (branch.scopeId !== branchScopeId || branch.documentScopeId !== documentScopeId) return null;
  return Object.freeze({ branchScopeId, documentScopeId, branch });
}

function productImageBackupStorageId(payload = {}, scopeId = getCurrentLastWorkWorkspaceScope()) {
  const id = String(payload?.id || '').trim();
  return id && id !== LAST_PRODUCT_IMAGE_BACKUP_ID
    ? id
    : lastProductImageBackupStorageId(scopeId);
}

function compactProductImageBackupPayload(payload = currentProductImageBackupPayload()) {
  if (!payload?.primary) return null;
  const primary = compactProductImageBackupItem(payload.primary);
  if (!primary) return null;
  const workspaceScope = productImageBackupWorkspaceScopeId(payload) || getCurrentLastWorkWorkspaceScope();
  return {
    id: productImageBackupStorageId(payload, workspaceScope),
    workspaceScope: { id: workspacePersistenceApi().normalizeWorkspaceScope(workspaceScope) },
    savedAt: Number(payload.savedAt || Date.now()) || Date.now(),
    productName: payload.productName || '',
    primary,
    sources: ['app', 'analysis', 'factory', 'market']
      .filter(key => !!payload[key])
      .map(key => ({
        source: key,
        hasImageData: !!(payload[key]?.base64 || payload[key]?.preview),
        name: payload[key]?.name || '',
        mime: payload[key]?.mime || '',
        updatedAt: payload[key]?.updatedAt || null,
      })),
  };
}

function productImageBackupReferencePayload(payload = currentProductImageBackupPayload()) {
  if (!payload?.primary) return null;
  const primary = productImageBackupItem(payload.primary?.source || 'backup', payload.primary);
  if (!primary) return null;
  const workspaceScope = productImageBackupWorkspaceScopeId(payload) || getCurrentLastWorkWorkspaceScope();
  const id = productImageBackupStorageId(payload, workspaceScope);
  return {
    id,
    workspaceScope: { id: workspacePersistenceApi().normalizeWorkspaceScope(workspaceScope) },
    savedAt: Number(payload.savedAt || Date.now()) || Date.now(),
    productName: payload.productName || '',
    hasImageData: !!primary.base64,
    primary: {
      source: primary.source || 'backup',
      mime: primary.mime || 'image/png',
      name: primary.name || '제품사진',
      base64Length: String(primary.base64 || '').length,
      preview: primary.base64 ? IMAGE_STORED_MARKER : '',
      updatedAt: primary.updatedAt || Date.now(),
    },
    storage: 'appSettings',
  };
}

function currentProductImageBackupPayload() {
  const factoryProduct = state.factory?.product || {};
  const market = state.compPage?.marketScrape || {};
  const analysisImage = (Array.isArray(state.analysisImages) ? state.analysisImages : []).find(img => img?.base64 || img?.preview || img?.dataUrl || img?.image);
  const appItem = productImageBackupItem('app', {
    base64: state.imageBase64,
    mime: state.imageMime,
    preview: state.imagePreview,
    name: state.imageName || analysisImage?.name || '제품사진',
  });
  const analysisItem = productImageBackupItem('analysis', analysisImage ? {
    base64: analysisImage.base64,
    mime: analysisImage.mime,
    preview: analysisImage.preview || analysisImage.dataUrl || analysisImage.image,
    name: analysisImage.name || '제품사진',
  } : null);
  const factoryItem = productImageBackupItem('factory', {
    base64: factoryProduct.imageBase64,
    mime: factoryProduct.imageMime,
    preview: factoryProduct.imagePreview,
    name: factoryProduct.imageName || factoryProduct.inputImages?.[0]?.name || '제품사진',
  });
  const marketItem = productImageBackupItem('market', {
    base64: market.imageBase64,
    mime: market.imageMime,
    preview: market.imagePreview,
    name: market.imageName || '제품사진',
    defaultImageSeeded: market.defaultImageSeeded === true,
  });
  const candidates = [factoryItem, appItem, analysisItem, marketItem && marketItem.defaultImageSeeded ? marketItem : null].filter(Boolean);
  const primary = candidates[0] || null;
  if (!primary) return null;
  const workspaceScope = getCurrentLastWorkWorkspaceScope();
  return {
    id: lastProductImageBackupStorageId(workspaceScope),
    workspaceScope: { id: workspacePersistenceApi().normalizeWorkspaceScope(workspaceScope) },
    savedAt: Date.now(),
    productName: state.productName || factoryProduct.productName || market.productName || '',
    primary,
    app: appItem,
    analysis: analysisItem,
    factory: factoryItem,
    market: marketItem,
  };
}

function productImageBackupFingerprint(payload = currentProductImageBackupPayload()) {
  if (!payload?.primary) return '';
  const item = payload.primary;
  return JSON.stringify({
    id: payload.id || '',
    workspaceScope: productImageBackupWorkspaceScopeId(payload),
    source: item.source || '',
    name: item.name || '',
    mime: item.mime || '',
    base64Len: String(item.base64 || '').length,
    base64Head: String(item.base64 || '').slice(0, 48),
    base64Tail: String(item.base64 || '').slice(-48),
    previewHead: String(item.preview || '').slice(0, 80),
  });
}

function productImageBackupConflictsWithCurrentWork(payload = {}, factory = factoryRuntimeReadFactory()) {
  const backupName = String(payload?.productName || '').trim();
  if (!backupName) return false;
  const currentName = String(factory?.product?.productName || state.productName || '').trim();
  if (!currentName) return false;
  return !lastWorkIdentityKeysCompatible(backupName, currentName);
}

function applyProductImageBackupPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object') return false;
  if (workspaceBlankResetInProgress && options.force !== true) return false;
  const ownsFactorySnapshot = !options.factory;
  const factory = options.factory || normalizeFactoryState(cloneData(factoryRuntimeReadFactory()));
  const finish = changed => {
    changed = restoreCutsSourceFromCurrentProductImage(state.cuts, factory) || changed;
    if (ownsFactorySnapshot && changed) {
      factoryRuntimeReplaceFactorySnapshot(factory, {
        mode: 'hydrate',
        reason: 'product-image-backup-restore',
        takeoverAuthority: options.takeoverAuthority,
      });
    }
    return changed;
  };
  if (options.force !== true && productImageBackupConflictsWithCurrentWork(payload, factory)) {
    state.storageWarning = '현재 제품과 다른 이미지 백업이 감지되어 복구하지 않았습니다. 현재 제품 사진을 유지합니다.';
    state.storageWarningDismissKey = `foreign-image-backup:${state.productName || factory?.product?.productName || 'current'}:${payload.productName || 'backup'}`;
    return false;
  }
  const primary = payload.factory || payload.app || payload.analysis || (payload.primary?.source === 'market' ? null : payload.primary) || payload.market || null;
  const item = productImageBackupItem(primary?.source || 'backup', primary);
  if (!item?.base64) return false;
  // 이미지 백업은 이 작업의 기본 이미지를 되살리기 위한 것이다. 작업이 이미 잠가 둔 지문과
  // 다른 사진이면 되살릴 대상이 아니라 남의 사진이고, 그대로 밀어 넣으면 기본 이미지가
  // 바뀐 것으로 판단해 새 run 이 발급되면서 그 지문으로 만들어 둔 생성물이 전부 이전
  // 자산으로 밀려난다. force 는 제품 신원 검사를 건너뛰라는 뜻이지, 다른 사진으로
  // 바꿔치우라는 뜻이 아니다. 실측: 방울수저집 복원에서 잠긴 지문이 190196(JPEG) 에서
  // 6508820(다른 PNG) 으로 바뀌고 자산 30장이 previousAssets 로 밀려났다.
  const lockedInputImageFingerprint = String(
    factory?.product?.lockedInputImageFingerprint || factory?.product?.inputImageFingerprint || ''
  ).trim();
  if (lockedInputImageFingerprint && typeof factoryImagePayloadFingerprint === 'function') {
    const backupBase64 = typeof imageBase64Only === 'function' ? imageBase64Only(item.base64) : item.base64;
    const backupFingerprint = factoryImagePayloadFingerprint(backupBase64);
    if (backupFingerprint && backupFingerprint !== lockedInputImageFingerprint) return false;
  }
  const force = options.force === true;
  const restoreInline = options.restoreInline === true;
  let changed = false;
  if (!restoreInline) {
    const imageName = item.name || state.imageName || '제품사진';
    const imageMime = item.mime || state.imageMime || 'image/png';
    if (!state.imagePreview) {
      state.imagePreview = IMAGE_STORED_MARKER;
      changed = true;
    }
    if (!state.imageMime) {
      state.imageMime = imageMime;
      changed = true;
    }
    if (!state.imageName) {
      state.imageName = imageName;
      changed = true;
    }
    if (!Array.isArray(state.analysisImages)) state.analysisImages = [];
    if (!state.analysisImages.some(img => img?.restoredFrom === 'lastProductImageBackup' || img?.name === imageName)) {
      state.analysisImages.unshift({
        mime: imageMime,
        name: imageName,
        preview: IMAGE_STORED_MARKER,
        hasImageData: true,
        restoredFrom: 'lastProductImageBackup',
      });
      state.analysisImages = state.analysisImages.slice(0, 5);
      changed = true;
    }
    try {
      if (!factory.product.imagePreview) {
        factory.product.imagePreview = IMAGE_STORED_MARKER;
        changed = true;
      }
      if (!factory.product.imageMime) {
        factory.product.imageMime = imageMime;
        changed = true;
      }
      if (!factory.product.imageName) {
        factory.product.imageName = imageName;
        changed = true;
      }
      factory.product.hasImage = true;
      if (!(Array.isArray(factory.product.inputImages) && factory.product.inputImages.length)) {
        factory.product.inputImages = [{
          id: uid('factory_input_restore'),
          name: imageName,
          mime: imageMime,
          preview: IMAGE_STORED_MARKER,
          hasImage: true,
          restoredFrom: 'lastProductImageBackup',
        }];
        changed = true;
      }
    } catch(e) {}
    try {
      if (options.syncMarket !== false && typeof ensureCompMarketScrapeState === 'function') {
        const market = ensureCompMarketScrapeState();
        if (!market.imagePreview || market.imagePreview === IMAGE_STORED_MARKER || market.defaultImageSeeded === true) {
          market.imageMime = imageMime;
          market.imagePreview = IMAGE_STORED_MARKER;
          market.imageName = imageName;
          market.hasImage = true;
          market.defaultImageSeeded = item.source !== 'market' || item.defaultImageSeeded === true;
          changed = true;
        }
      }
    } catch(e) {}
    if (payload.productName && !state.productName) {
      if (typeof factorySetCurrentProductIdentity === 'function') {
        factorySetCurrentProductIdentity(payload.productName, { factory, syncDom: false, setSearchQuery: false, syncFinal: false });
      } else {
        state.productName = payload.productName;
      }
      changed = true;
    }
    return finish(changed);
  }
  if (force || !state.imageBase64 || !state.imagePreview || state.imagePreview === '__stored_in_indexeddb__') {
    state.imageBase64 = item.base64;
    state.imageMime = item.mime || 'image/png';
    state.imagePreview = item.preview || `data:${state.imageMime};base64,${item.base64}`;
    state.imageName = item.name || state.imageName || '제품사진';
    changed = true;
  }
  if (!Array.isArray(state.analysisImages)) state.analysisImages = [];
  const restoredBackupImage = state.analysisImages.find(img => img?.base64 === item.base64) || {
      base64: item.base64,
      mime: item.mime || 'image/png',
      preview: item.preview || `data:${item.mime || 'image/png'};base64,${item.base64}`,
      name: item.name || '제품사진',
      restoredFrom: 'lastProductImageBackup',
    };
  const staleBackupShells = state.analysisImages.filter(img => (
    img?.restoredFrom === 'lastProductImageBackup'
    && img?.base64 !== item.base64
  ));
  if (!state.analysisImages.includes(restoredBackupImage) || staleBackupShells.length) {
    state.analysisImages = [
      restoredBackupImage,
      ...state.analysisImages.filter(img => (
        img !== restoredBackupImage
        && img?.restoredFrom !== 'lastProductImageBackup'
        && img?.base64 !== item.base64
      )),
    ].slice(0, 5);
    changed = true;
  }
  try {
    if (force || !factory.product.imageBase64 || !factory.product.imagePreview || factory.product.imagePreview === '__stored_in_indexeddb__') {
      factory.product.imageBase64 = item.base64;
      factory.product.imageMime = item.mime || 'image/png';
      factory.product.imagePreview = item.preview || `data:${factory.product.imageMime};base64,${item.base64}`;
      factory.product.imageName = item.name || '제품사진';
      factory.product.inputImages = [{
        id: uid('factory_input_restore'),
        name: item.name || '제품사진',
        base64: item.base64,
        mime: factory.product.imageMime,
        preview: factory.product.imagePreview,
        restoredFrom: 'lastProductImageBackup',
      }];
      changed = true;
    }
  } catch(e) {}
  try {
    if (options.syncMarket !== false && typeof ensureCompMarketScrapeState === 'function') {
      const market = ensureCompMarketScrapeState();
      if (force || !market.imageBase64 || !market.imagePreview || market.imagePreview === '__stored_in_indexeddb__' || market.defaultImageSeeded === true) {
        market.imageBase64 = item.base64;
        market.imageMime = item.mime || 'image/png';
        market.imagePreview = item.preview || `data:${market.imageMime};base64,${item.base64}`;
        market.imageName = item.name || '제품사진';
        market.defaultImageSeeded = item.source !== 'market' || item.defaultImageSeeded === true;
        changed = true;
      }
    }
  } catch(e) {}
  if (payload.productName && !state.productName) {
    if (typeof factorySetCurrentProductIdentity === 'function') {
      factorySetCurrentProductIdentity(payload.productName, { factory, syncDom: false, setSearchQuery: false, syncFinal: false });
    } else {
      state.productName = payload.productName;
    }
    changed = true;
  }
  return finish(changed);
}

async function saveLastProductImageBackupToDbIfChanged() {
  if (workspaceBlankResetInProgress) return false;
  const previousSave = lastProductImageBackupSavePromise;
  const pendingSave = (previousSave ? previousSave.catch(() => false) : Promise.resolve()).then(async () => {
    if (workspaceBlankResetInProgress) return false;
    const payload = compactProductImageBackupPayload();
    if (!payload?.primary) return false;
    const fingerprint = productImageBackupFingerprint(payload);
    if (fingerprint && fingerprint === lastProductImageBackupFingerprint) return false;
    await workspacePut(WORKSPACE_DB.appSettings, payload);
    lastProductImageBackupFingerprint = fingerprint;
    return true;
  });
  lastProductImageBackupSavePromise = pendingSave;
  try {
    return await pendingSave;
  } finally {
    if (lastProductImageBackupSavePromise === pendingSave) lastProductImageBackupSavePromise = null;
  }
}

async function migrateDocumentProductImageBackupToCurrentBranch(workspaceScope) {
  const boundary = currentBranchDocumentMigrationBoundary(workspaceScope);
  if (!boundary) return null;
  const source = await workspaceGet(
    WORKSPACE_DB.appSettings,
    lastProductImageBackupStorageId(boundary.documentScopeId),
  );
  if (!source || !productImageBackupMatchesCurrentWorkspace(source, boundary.documentScopeId)) return null;
  if (productImageBackupConflictsWithCurrentWork(source)) return null;
  const migrated = {
    ...cloneData(source),
    id: lastProductImageBackupStorageId(boundary.branchScopeId),
    workspaceScope: { id: boundary.branchScopeId },
    migratedFromDocumentScope: boundary.documentScopeId,
    migratedAt: Date.now(),
  };
  try {
    await workspacePut(WORKSPACE_DB.appSettings, migrated);
  } catch (error) {
    console.warn('Document image backup branch copy failed:', error);
  }
  return migrated;
}

async function hydrateLastProductImageBackup(options = {}) {
  const requestIsCurrent = () => typeof options.isCurrent !== 'function' || options.isCurrent() !== false;
  try {
    if (!requestIsCurrent()) return false;
    const workspaceScope = String(options.expectedWorkspaceScope || getCurrentLastWorkWorkspaceScope()).trim();
    if (!workspaceHydrationScopeIsCurrent(workspaceScope, options.workspaceResetToken, requestIsCurrent)) return false;
    let payload = await workspaceGet(
      WORKSPACE_DB.appSettings,
      lastProductImageBackupStorageId(workspaceScope),
    );
    if (!payload && options.allowDocumentMigration !== false) {
      payload = await migrateDocumentProductImageBackupToCurrentBranch(workspaceScope);
    }
    const currentFactory = !payload && typeof factoryRuntimeReadFactory === 'function'
      ? factoryRuntimeReadFactory()
      : null;
    const projectName = String(
      options.expectedProjectName
      || state?.currentProjectName
      || currentFactory?.currentProjectName
      || currentFactory?.workspace?.name
      || '',
    ).trim();
    let projectId = workspaceScope.startsWith('project:')
      ? workspaceScope.slice('project:'.length)
      : String(
        options.expectedProjectId
        || state?.currentProjectId
        || currentFactory?.workspace?.id
        || currentFactory?.currentProjectId
        || '',
      ).replace(/^project:/i, '').trim();
    if (!payload && !projectId && workspaceScope.startsWith('draft:') && projectName) {
      const matchingProjects = (await workspaceGetAll(WORKSPACE_DB.projects).catch(() => []))
        .filter(project => {
          const projectBackup = project?.payload?.productImageBackup
            || project?.payload?.assetPayload?.productImageBackup;
          return String(project?.name || '').trim() === projectName
            && projectBackup?.storage === WORKSPACE_DB.appSettings
            && projectBackup.id;
        });
      if (matchingProjects.length === 1) {
        projectId = String(matchingProjects[0].id || '').replace(/^project:/i, '').trim();
      }
    }
    if (!payload && projectId) {
      const projectRecord = await workspaceGet(WORKSPACE_DB.projects, projectId);
      const projectBackup = projectRecord?.payload?.productImageBackup;
      if (projectBackup?.storage === WORKSPACE_DB.appSettings && projectBackup.id) {
        payload = await workspaceGet(WORKSPACE_DB.appSettings, projectBackup.id);
        if (payload) {
          payload = {
            ...payload,
            workspaceScope: { id: workspaceScope },
          };
        }
      }
    }
    if (!workspaceHydrationScopeIsCurrent(workspaceScope, options.workspaceResetToken, requestIsCurrent)) return false;
    const matchesWorkspace = !!payload && productImageBackupMatchesCurrentWorkspace(payload, workspaceScope);
    if (!matchesWorkspace) return false;
    const changed = applyProductImageBackupPayload(payload, options);
    if (payload) lastProductImageBackupFingerprint = productImageBackupFingerprint(payload);
    return changed;
  } catch(e) {
    console.warn('Last product image backup hydrate failed:', e);
    return false;
  }
}

const LOCAL_SESSION_MAX_CHARS = 900000;
const LOCAL_SESSION_LARGE_STRING_CHARS = 180000;
const LOCAL_SESSION_HUGE_TEXT_CHARS = 260000;
const LOCAL_SESSION_ARRAY_LIMITS = [
  { pattern: /analysisRuns/i, limit: 20 },
  { pattern: /logs/i, limit: 80 },
  { pattern: /dbCandidates|cafe24Candidates|pendingDbCandidates|pendingCafe24Candidates/i, limit: 80 },
  { pattern: /assets/i, limit: 140 },
];

function localSessionArrayLimit(path) {
  const value = String(path || '');
  const found = LOCAL_SESSION_ARRAY_LIMITS.find(item => item.pattern.test(value));
  return found ? found.limit : 0;
}

function isImageLikeLocalSessionKey(key = '') {
  return /base64|preview|dataUrl|data_url|image|thumbnail|thumb|canvas|blob|mask/i.test(String(key || ''));
}

function isLikelyLargeBinaryString(value = '') {
  const text = String(value || '');
  if (/^data:image\//i.test(text)) return true;
  if (/^blob:/i.test(text)) return true;
  if (text.length < LOCAL_SESSION_LARGE_STRING_CHARS) return false;
  const sample = text.slice(0, 4096);
  return /^[A-Za-z0-9+/=_-]+$/.test(sample) && !/\s/.test(sample);
}

function localSessionStoredMarker(value, marker = '__stored_in_indexeddb__') {
  return value ? marker : value;
}

function scrubLocalSessionValue(value, path = '', seen = new WeakSet()) {
  if (value == null) return value;
  const key = String(path || '').split('.').pop() || '';
  if (typeof value === 'string') {
    if (isLikelyLargeBinaryString(value) || (isImageLikeLocalSessionKey(key) && value.length > 2048)) {
      return localSessionStoredMarker(value);
    }
    if (value.length > LOCAL_SESSION_HUGE_TEXT_CHARS) {
      return value.slice(0, LOCAL_SESSION_HUGE_TEXT_CHARS) + '\n\n[localStorage 용량 보호로 이후 긴 텍스트는 IndexedDB/마지막 작업 저장소에서 복원됩니다.]';
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    const limit = localSessionArrayLimit(path);
    const source = limit > 0 ? value.slice(-limit) : value;
    return source.map((item, index) => scrubLocalSessionValue(item, `${path}[${index}]`, seen));
  }
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childValue === undefined || typeof childValue === 'function') continue;
    result[childKey] = scrubLocalSessionValue(childValue, path ? `${path}.${childKey}` : childKey, seen);
  }
  return result;
}

function compactFactoryForLocalSession(factory = {}) {
  const copy = typeof stripFactoryImages === 'function'
    ? stripFactoryImages(factory || {})
    : cloneData(factory || {});
  const product = copy.product && typeof copy.product === 'object' ? copy.product : {};
  ['dbCandidates', 'cafe24Candidates', 'pendingDbCandidates', 'pendingCafe24Candidates'].forEach(key => {
    if (Array.isArray(product[key])) product[key] = product[key].slice(0, 80);
  });
  if (Array.isArray(copy.logs)) copy.logs = copy.logs.slice(-80);
  if (Array.isArray(copy.assets)) copy.assets = copy.assets.slice(-140).map(asset => ({
    ...asset,
    image: null,
    hasImage: !!(asset?.hasImage || asset?.image),
  }));
  if (copy.goalRun) copy.goalRun = { ...copy.goalRun, running: false, stopRequested: false };
  return scrubLocalSessionValue(copy, 'factory');
}

function compactCutsForLocalSession(cuts = {}) {
  const copy = typeof stripCutsImages === 'function'
    ? stripCutsImages(cuts || {})
    : cloneData(cuts || {});
  const keepLightResult = p => {
    const value = typeof displayableImageSrc === 'function'
      ? displayableImageSrc(p?.result)
      : String(p?.result || '').trim();
    if (!value) return null;
    return /^data:image\//i.test(value) && value.length > 180000 ? null : value;
  };
  if (Array.isArray(copy.prompts)) {
    copy.prompts = copy.prompts.map(p => ({ ...p, result: keepLightResult(p), generating: false }));
  }
  if (Array.isArray(copy.sizePrompts)) {
    copy.sizePrompts = copy.sizePrompts.map(p => ({ ...p, result: keepLightResult(p), generating: false }));
  }
  return scrubLocalSessionValue(copy, 'cuts');
}

function buildCompactLocalSessionPayload(payload = {}) {
  const compact = {
    ...payload,
    analysisRuns: Array.isArray(payload.analysisRuns) ? payload.analysisRuns.slice(-20) : [],
    dbMatchCandidates: Array.isArray(payload.dbMatchCandidates) ? payload.dbMatchCandidates.slice(0, 80) : [],
    analysisImages: stripAnalysisImages(payload.analysisImages || []),
    sectionImages: stripSectionImages(payload.sectionImages || {}),
    sectionVariants: stripVariantImages(payload.sectionVariants || {}),
    detailImageBlocks: stripDetailBlockImages(payload.detailImageBlocks || []),
    aiRepairUndoStack: stripAiRepairUndoImages(payload.aiRepairUndoStack || {}),
    aiRepair: stripAiRepairDraft(payload.aiRepair || {}),
    cuts: compactCutsForLocalSession(payload.cuts || {}),
    compPage: stripCompPageImages(payload.compPage || {}),
    optionSorter: stripOptionSorterImages(payload.optionSorter || {}),
    factory: compactFactoryForLocalSession(payload.factory || {}),
    fixedDetailImages: stripFixedDetailImagesForSession(payload.fixedDetailImages || loadFixedDetailImages()),
  };
  return scrubLocalSessionValue(compact, 'session');
}

function buildMinimalLocalSessionPayload(payload = {}) {
  const factory = compactFactoryForLocalSession(payload.factory || {});
  const cuts = compactCutsForLocalSession(payload.cuts || {});
  return scrubLocalSessionValue({
    step: payload.step || 'upload',
    storageMode: 'indexeddb-first',
    storageNote: '대용량 이미지와 생성 결과는 IndexedDB/마지막 작업 저장소에서 복원합니다.',
    savedAt: payload.savedAt || Date.now(),
    productName: payload.productName || factory?.product?.productName || '',
    imagePreview: payload.imagePreview ? '__stored_in_indexeddb__' : null,
    imageMime: payload.imageMime || '',
    analysisTimestamp: payload.analysisTimestamp || null,
    currentProjectId: payload.currentProjectId || '',
    currentProjectName: payload.currentProjectName || '',
    currentProjectCreatedAt: payload.currentProjectCreatedAt || null,
    workIdentity: payload.workIdentity || null,
    inputImageFingerprint: payload.inputImageFingerprint || '',
    workspaceScope: payload.workspaceScope || null,
    workspaceRevision: payload.workspaceRevision || null,
    dbMatchCandidates: Array.isArray(payload.dbMatchCandidates) ? payload.dbMatchCandidates.slice(0, 80) : [],
    dbMatchLastQuery: payload.dbMatchLastQuery || '',
    dbMatchSelectionOpen: !!payload.dbMatchSelectionOpen,
    dbColorOptions: Array.isArray(payload.dbColorOptions) ? payload.dbColorOptions.slice(0, 80) : [],
    dbColorOptionsLastJcode: payload.dbColorOptionsLastJcode || '',
    dbColorOptionsLoadedAt: payload.dbColorOptionsLoadedAt || null,
    productInfoManualValues: payload.productInfoManualValues || {},
    sectionGenerationModes: payload.sectionGenerationModes || {},
    sectionBasisModes: payload.sectionBasisModes || {},
    sectionAssembly: payload.sectionAssembly || {},
    sectionOrder: Array.isArray(payload.sectionOrder) ? payload.sectionOrder : null,
    hiddenSectionIds: Array.isArray(payload.hiddenSectionIds) ? payload.hiddenSectionIds : [],
    customSections: Array.isArray(payload.customSections) ? payload.customSections : [],
    cuts,
    optionSorter: stripOptionSorterImages(payload.optionSorter || {}),
    factory,
    compPage: stripCompPageImages(payload.compPage || {}),
    fixedDetailImages: stripFixedDetailImagesForSession(payload.fixedDetailImages || loadFixedDetailImages()),
  }, 'minimalSession');
}

function buildEmergencyLocalSessionPayload(payload = {}) {
  const factory = payload.factory && typeof payload.factory === 'object' ? payload.factory : {};
  const product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  const stages = factory.stages && typeof factory.stages === 'object' ? factory.stages : {};
  const cuts = compactCutsForLocalSession(payload.cuts || {});
  const compPage = typeof stripCompPageImages === 'function'
    ? stripCompPageImages(payload.compPage || {})
    : {};
  const marketScrape = compPage.marketScrape || factory.competitors?.compPage?.marketScrape || null;
  const compactCandidate = value => {
    if (Array.isArray(value)) return value.slice(0, 80);
    if (value && typeof value === 'object') return value;
    return value;
  };
  const criticalProduct = {
    dbCandidates: compactCandidate(product.dbCandidates),
    pendingDbCandidates: compactCandidate(product.pendingDbCandidates),
    cafe24Candidates: compactCandidate(product.cafe24Candidates),
    pendingCafe24Candidates: compactCandidate(product.pendingCafe24Candidates),
    selectedDbCandidateKey: product.selectedDbCandidateKey || '',
    selectedCafe24CandidateKey: product.selectedCafe24CandidateKey || '',
    dbCandidateResolution: product.dbCandidateResolution || '',
    cafe24CandidateResolution: product.cafe24CandidateResolution || '',
    confirmedCafe24ProductKey: product.confirmedCafe24ProductKey || '',
    cafe24DraftProductKey: product.cafe24DraftProductKey || '',
  };
  const stageShell = {};
  Object.entries(stages).forEach(([stageId, stage]) => {
    if (!stage || typeof stage !== 'object') return;
    stageShell[stageId] = {
      targetCount: stage.targetCount,
      prompt: stage.prompt,
      status: stage.status === 'running' ? 'idle' : stage.status,
      resultNote: stage.resultNote || '',
    };
  });
  return scrubLocalSessionValue({
    step: payload.step || 'factory',
    storageMode: 'server-last-work-first',
    storageNote: '브라우저 저장 공간 보호를 위해 핵심 복구값만 저장했습니다. 전체 이미지/생성 결과는 IndexedDB와 마지막 작업 저장소에서 복원합니다.',
    savedAt: payload.savedAt || Date.now(),
    productName: payload.productName || product.productName || '',
    currentProjectId: payload.currentProjectId || '',
    currentProjectName: payload.currentProjectName || '',
    currentProjectCreatedAt: payload.currentProjectCreatedAt || null,
    workIdentity: payload.workIdentity || null,
    inputImageFingerprint: payload.inputImageFingerprint || '',
    workspaceScope: payload.workspaceScope || null,
    workspaceRevision: payload.workspaceRevision || null,
    dbMatchCandidates: Array.isArray(payload.dbMatchCandidates) ? payload.dbMatchCandidates.slice(0, 80) : [],
    dbMatchLastQuery: payload.dbMatchLastQuery || '',
    dbMatchSelectionOpen: !!payload.dbMatchSelectionOpen,
    dbColorOptions: Array.isArray(payload.dbColorOptions) ? payload.dbColorOptions.slice(0, 80) : [],
    dbColorOptionsLastJcode: payload.dbColorOptionsLastJcode || '',
    dbColorOptionsLoadedAt: payload.dbColorOptionsLoadedAt || null,
    productInfoManualValues: payload.productInfoManualValues || {},
    compPage: marketScrape ? { marketScrape } : {},
    sectionGenerationModes: payload.sectionGenerationModes || {},
    sectionBasisModes: payload.sectionBasisModes || {},
    sectionAssembly: payload.sectionAssembly || {},
    sectionOrder: Array.isArray(payload.sectionOrder) ? payload.sectionOrder : null,
    hiddenSectionIds: Array.isArray(payload.hiddenSectionIds) ? payload.hiddenSectionIds : [],
    customSections: Array.isArray(payload.customSections) ? payload.customSections : [],
    optionSorter: stripOptionSorterImages(payload.optionSorter || {}),
    cuts: {
      prompts: Array.isArray(cuts.prompts) ? cuts.prompts.map(p => ({ id: p.id, label: p.label, prompt: p.prompt, promptUpdatedAt: p.promptUpdatedAt || 0 })) : [],
      sizePrompts: Array.isArray(cuts.sizePrompts) ? cuts.sizePrompts.map(p => ({ id: p.id, label: p.label, prompt: p.prompt, promptUpdatedAt: p.promptUpdatedAt || 0 })) : [],
    },
    factory: {
      product: {
        productName: product.productName || payload.productName || '',
        naturalHint: product.naturalHint || '',
        category: product.category || '',
        dbProductName: product.dbProductName || '',
        confirmedDbName: product.confirmedDbName || '',
        confirmedDbId: product.confirmedDbId || '',
        confirmedCafe24ProductNo: product.confirmedCafe24ProductNo || '',
        confirmedCafe24ProductCode: product.confirmedCafe24ProductCode || '',
        dbLocked: !!product.dbLocked,
        sourcePanelState: product.sourcePanelState || null,
        cafe24FieldView: product.cafe24FieldView || null,
        cafe24AutoSendOnSave: product.cafe24AutoSendOnSave !== false,
        dbInputSavedAt: product.dbInputSavedAt || null,
        ...criticalProduct,
      },
      competitors: marketScrape ? { compPage: { marketScrape } } : undefined,
      stages: stageShell,
      activeStage: factory.activeStage || 'db',
      openMarketSync: {
        mode: factory.openMarketSync?.mode || 'cafe24_marketplus',
        selectedChannels: Array.isArray(factory.openMarketSync?.selectedChannels) ? factory.openMarketSync.selectedChannels : undefined,
        marketPlusStatus: factory.openMarketSync?.marketPlusStatus || null,
        marketPlusAction: factory.openMarketSync?.marketPlusAction || null,
        marketPlusCafe24LinkageStatus: factory.openMarketSync?.marketPlusCafe24LinkageStatus || null,
        dryRuns: factory.openMarketSync?.dryRuns || {},
        browserAutomation: factory.openMarketSync?.browserAutomation || null,
        browserSnapshot: factory.openMarketSync?.browserSnapshot || null,
        status: factory.openMarketSync?.status || '',
        lastCheckedAt: factory.openMarketSync?.lastCheckedAt || null,
        lastDraftedAt: factory.openMarketSync?.lastDraftedAt || null,
        lastDryRunAt: factory.openMarketSync?.lastDryRunAt || null,
        lastBrowserCheckedAt: factory.openMarketSync?.lastBrowserCheckedAt || null,
        lastBrowserSnapshotAt: factory.openMarketSync?.lastBrowserSnapshotAt || null,
        lastMarketPlusStartedAt: factory.openMarketSync?.lastMarketPlusStartedAt || null,
        lastMarketPlusCafe24LinkageCheckedAt: factory.openMarketSync?.lastMarketPlusCafe24LinkageCheckedAt || null,
      },
      cafe24FieldView: factory.cafe24FieldView || null,
      lastSavedAt: factory.lastSavedAt || null,
    },
  }, 'emergencySession');
}

function prepareLocalSessionPayload(payload = {}) {
  const prepared = scrubLocalSessionValue(payload, 'session');
  try {
    if (JSON.stringify(prepared).length <= LOCAL_SESSION_MAX_CHARS) return prepared;
  } catch(e) {}
  const compact = buildCompactLocalSessionPayload(prepared);
  try {
    if (JSON.stringify(compact).length <= LOCAL_SESSION_MAX_CHARS) return compact;
  } catch(e) {}
  return buildMinimalLocalSessionPayload(compact);
}

function selectLocalSessionPayload(payload = {}) {
  let attempt = scrubLocalSessionValue(payload, 'session');
  let fallbackIndex = -1;
  const fallbackBuilders = [
    () => buildCompactLocalSessionPayload(payload),
    () => buildMinimalLocalSessionPayload(payload),
    () => buildEmergencyLocalSessionPayload(payload),
  ];
  let lastError = null;
  const seenJson = new Set();
  while (true) {
    let json = '';
    try {
      json = JSON.stringify(attempt);
      if (json && !seenJson.has(json)) {
        seenJson.add(json);
        const isLastFallback = fallbackIndex === fallbackBuilders.length - 1;
        if (json.length <= LOCAL_SESSION_MAX_CHARS || isLastFallback) {
          return { ok: true, payload: attempt, size: json.length, json };
        }
      }
    } catch(e) {
      lastError = e;
    }
    fallbackIndex += 1;
    const buildNext = fallbackBuilders[fallbackIndex];
    if (!buildNext) break;
    attempt = buildNext();
  }
  return { ok: false, error: lastError };
}

function readLegacyLocalStorageText(key, maxChars = LOCAL_SESSION_MAX_CHARS) {
  try {
    const raw = workspaceSessionGetItem(key);
    if (!raw) return null;
    if (raw.length > maxChars || isLikelyLargeBinaryString(raw)) {
      workspaceSessionRemoveItem(key);
      return null;
    }
    return raw;
  } catch(e) {
    return null;
  }
}

function readLegacyLocalStorageJson(key, fallback, maxChars = LOCAL_SESSION_MAX_CHARS) {
  try {
    const raw = workspaceSessionGetItem(key);
    if (!raw) return fallback;
    if (raw.length > maxChars) {
      workspaceSessionRemoveItem(key);
      return fallback;
    }
    return JSON.parse(raw);
  } catch(e) {
    return fallback;
  }
}

function prepareFactorySnapshotForLocalStorage(factory = {}) {
  const compact = compactFactoryForLocalSession(factory);
  try {
    if (JSON.stringify(compact).length <= LOCAL_SESSION_MAX_CHARS) return compact;
  } catch(e) {}
  return buildMinimalLocalSessionPayload({ step: 'factory', factory: compact }).factory || compact;
}

function stripImageItem(image) {
  if (!image) return image;
  const copy = { ...image };
  if (copy.base64 || copy.preview || copy.dataUrl || copy.result) copy.hasImageData = true;
  delete copy.base64;
  delete copy.preview;
  delete copy.dataUrl;
  delete copy.result;
  return copy;
}

function stripAnalysisImages(images = []) {
  return (Array.isArray(images) ? images : []).map(stripImageItem);
}

function runtimeExternalImageSrc(src) {
  const value = String(src || '').trim();
  if (!value || value === IMAGE_STORED_MARKER) return '';
  if (/^data:image\//i.test(value)) return '';
  if (isLikelyLargeBinaryString(value)) return '';
  return /^(blob:|https?:\/\/|\/api\/local-archive\/)/i.test(value) ? value : '';
}

function stripRuntimeImageItem(image) {
  if (!image || typeof image !== 'object') return image;
  const copy = { ...image };
  const preview = runtimeExternalImageSrc(copy.preview || copy.dataUrl || copy.image || copy.src);
  copy.hasImageData = !!(copy.base64 || copy.preview || copy.dataUrl || copy.image || copy.result || copy.hasImageData || copy.hasImage);
  delete copy.base64;
  delete copy.dataUrl;
  delete copy.image;
  delete copy.result;
  if (preview) copy.preview = preview;
  else if (copy.hasImageData) copy.preview = IMAGE_STORED_MARKER;
  else delete copy.preview;
  return copy;
}

function stripRuntimeAnalysisImages(images = []) {
  return (Array.isArray(images) ? images : []).map(stripRuntimeImageItem);
}

function stripRuntimeSectionImages(sectionImages = {}) {
  const result = {};
  for (const [sectionId, image] of Object.entries(sectionImages || {})) {
    const src = runtimeExternalImageSrc(image);
    result[sectionId] = src || (image ? IMAGE_STORED_MARKER : null);
  }
  return result;
}

function mergeRuntimeSectionImages(currentImages = {}, incomingImages = {}, options = {}) {
  const preserveInlineImages = options.preserveInlineImages === true;
  const result = preserveInlineImages
    ? { ...(incomingImages || {}) }
    : stripRuntimeSectionImages(incomingImages);
  for (const [sectionId, image] of Object.entries(result)) {
    if (image !== IMAGE_STORED_MARKER) continue;
    const currentImage = preserveInlineImages
      ? displayableImageSrc(currentImages?.[sectionId])
      : runtimeExternalImageSrc(currentImages?.[sectionId]);
    if (currentImage) result[sectionId] = currentImage;
  }
  return result;
}

function stripRuntimeDetailBlockImages(blocks = []) {
  return (Array.isArray(blocks) ? blocks : []).map(block => {
    const copy = { ...block };
    const src = runtimeExternalImageSrc(copy.dataUrl || copy.image || copy.preview);
    if (copy.dataUrl || copy.image || copy.preview || copy.hasDataUrl) copy.hasDataUrl = true;
    delete copy.image;
    delete copy.preview;
    copy.dataUrl = src || null;
    return copy;
  });
}

function stripRuntimeVariantImages(sectionVariants = {}) {
  const result = {};
  for (const [sectionId, variants] of Object.entries(sectionVariants || {})) {
    result[sectionId] = (Array.isArray(variants) ? variants : []).map(variant => {
      const image = runtimeExternalImageSrc(variant?.image || variant?.preview || variant?.dataUrl);
      return {
        ...variant,
        hasImage: !!(image || variant?.image || variant?.preview || variant?.dataUrl || variant?.hasImage),
        image: image || null,
      };
    });
  }
  return result;
}

function stripRuntimeAssetsForApply(assets = {}) {
  const copy = { ...(assets || {}) };
  copy.imagePreview = runtimeExternalImageSrc(copy.imagePreview) || (copy.imagePreview ? IMAGE_STORED_MARKER : null);
  copy.imageBase64 = null;
  if (Array.isArray(copy.analysisImages)) copy.analysisImages = stripRuntimeAnalysisImages(copy.analysisImages);
  if (copy.sectionImages && typeof copy.sectionImages === 'object') copy.sectionImages = stripRuntimeSectionImages(copy.sectionImages);
  if (Array.isArray(copy.detailImageBlocks)) copy.detailImageBlocks = stripRuntimeDetailBlockImages(copy.detailImageBlocks);
  if (copy.sectionVariants && typeof copy.sectionVariants === 'object') copy.sectionVariants = stripRuntimeVariantImages(copy.sectionVariants);
  if (copy.aiRepairUndoStack && typeof copy.aiRepairUndoStack === 'object') copy.aiRepairUndoStack = stripAiRepairUndoImages(copy.aiRepairUndoStack);
  if (copy.aiRepair && typeof copy.aiRepair === 'object') copy.aiRepair = stripAiRepairDraft(copy.aiRepair);
  if (copy.cuts && typeof copy.cuts === 'object') {
    copy.cuts = stripCutsImages(copy.cuts, {
      preserveRecentResults: true,
      generalResultLimit: 16,
      sizeResultLimit: 8,
    });
  }
  if (copy.compPage && typeof copy.compPage === 'object') copy.compPage = stripCompPageImages(copy.compPage);
  if (copy.optionSorter && typeof copy.optionSorter === 'object') copy.optionSorter = stripOptionSorterImages(copy.optionSorter);
  if (copy.factory && typeof copy.factory === 'object' && typeof stripFactoryImages === 'function') copy.factory = stripFactoryImages(copy.factory);
  return copy;
}

function stripSectionImages(sectionImages = {}) {
  const result = {};
  for (const [sectionId, image] of Object.entries(sectionImages || {})) {
    result[sectionId] = image ? '__stored_in_indexeddb__' : null;
  }
  return result;
}

function isDisplayableImageSrc(src) {
  const value = String(src || '').trim();
  if (!value || value === '__stored_in_indexeddb__') return false;
  if (/^data:image\/[^;,]+;base64,/i.test(value)) return imageDataUrlHasUsablePayload(value);
  return /^(data:image\/|blob:|https?:\/\/|\/api\/local-archive\/)/i.test(value);
}

function displayableImageSrc(src) {
  const value = isDisplayableImageSrc(src) ? String(src || '').trim() : '';
  if (/^\/api\/local-archive\//i.test(value)
    && typeof factoryRuntimeArchiveImageUrl === 'function') {
    return factoryRuntimeArchiveImageUrl({ imageUrl: value });
  }
  return value;
}

function imageDataUrlHasUsablePayload(src) {
  const info = dataUrlBase64Info(src);
  if (!info?.payload) return false;
  const payload = info.payload;
  if (payload.length < 32 || payload.length % 4 === 1) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;
  const head = payload.slice(0, 32);
  if (/^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR)/i.test(head)) return true;
  return /^image\/svg\+xml/i.test(info.mime || '');
}

function dataUrlBase64Info(src) {
  const match = String(src || '').match(/^data:(image\/[^;,]+);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const payload = String(match[2] || '').replace(/\s+/g, '');
  if (!payload) return null;
  return { mime: match[1], payload };
}

function estimateBase64ByteLength(payload) {
  const clean = String(payload || '').replace(/\s+/g, '');
  if (!clean) return 0;
  const padding = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function readPngSizeFromBase64(payload) {
  try {
    const head = atob(String(payload || '').slice(0, 96));
    if (head.length < 24) return null;
    if (head.charCodeAt(0) !== 137 || head.slice(1, 4) !== 'PNG') return null;
    const u32 = index => (
      ((head.charCodeAt(index) & 255) * 16777216)
      + ((head.charCodeAt(index + 1) & 255) << 16)
      + ((head.charCodeAt(index + 2) & 255) << 8)
      + (head.charCodeAt(index + 3) & 255)
    );
    const width = u32(16);
    const height = u32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch(e) {
    return null;
  }
}

function imageSrcResolutionScore(src) {
  const value = displayableImageSrc(src);
  if (!value) return 0;
  const data = dataUrlBase64Info(value);
  if (!data) return 1;
  const bytes = estimateBase64ByteLength(data.payload);
  const size = readPngSizeFromBase64(data.payload);
  const byteScore = Math.min(4, bytes / 250000);
  if (!size) return Math.max(1, byteScore);
  const areaScore = Math.min(12, (size.width * size.height) / 160000);
  return Math.round((areaScore + byteScore) * 10) / 10;
}

function sectionImagesQualityScore(sectionImages = {}) {
  return Object.values(sectionImages || {})
    .reduce((sum, image) => sum + imageSrcResolutionScore(image), 0);
}

function snapshotSectionImagesQualityScore(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const assets = snapshot.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  return sectionImagesQualityScore(assets.sectionImages || {});
}

function sectionContentLooksUsable(content) {
  if (!content || typeof content !== 'object') return false;
  const textKeys = ['headline', 'subheadline', 'body_text', 'cta_text', 'layout_suggestion'];
  if (textKeys.some(key => String(content[key] || '').trim())) return true;
  if (Array.isArray(content.extra_elements) && content.extra_elements.some(item => String(item || '').trim())) return true;
  if (content.color_scheme && typeof content.color_scheme === 'object') return true;
  if (content.font_suggestion && typeof content.font_suggestion === 'object') return true;
  return false;
}

function sectionContentsHasUsableEntries(contents = {}) {
  return Object.values(contents || {}).some(sectionContentLooksUsable);
}

function buildSectionContentsFromStoredVariants(sectionVariants = {}, currentIds = {}) {
  const restored = {};
  Object.entries(sectionVariants || {}).forEach(([sectionId, variants]) => {
    const list = Array.isArray(variants) ? variants : [];
    if (!list.length) return;
    const selectedId = String(currentIds?.[sectionId] || '');
    const selected = selectedId
      ? list.find(variant => String(variant?.id || '') === selectedId && sectionContentLooksUsable(variant?.content))
      : null;
    const fallback = list.find(variant => sectionContentLooksUsable(variant?.content));
    const chosen = selected || fallback;
    if (chosen?.content) restored[sectionId] = cloneData(chosen.content);
  });
  return restored;
}

function restoreSectionContentsFromStoredVariants(target = {}) {
  if (!target || typeof target !== 'object') return false;
  const restored = buildSectionContentsFromStoredVariants(target.sectionVariants || {}, target.currentSectionVariantIds || {});
  if (!Object.keys(restored).length) return false;
  const current = target.sectionContents && typeof target.sectionContents === 'object' ? target.sectionContents : {};
  let changed = false;
  const merged = { ...current };
  Object.entries(restored).forEach(([sectionId, content]) => {
    if (sectionContentLooksUsable(merged[sectionId])) return;
    merged[sectionId] = content;
    changed = true;
  });
  if (changed) target.sectionContents = merged;
  return changed;
}

function normalizedRestoreProductKey(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (typeof factoryNormalizeIdentityText === 'function') return factoryNormalizeIdentityText(raw);
  return raw.toLowerCase().replace(/\s+/g, '').slice(0, 180);
}

function restoreKeysCompatible(a = '', b = '') {
  const keyA = normalizedRestoreProductKey(a);
  const keyB = normalizedRestoreProductKey(b);
  if (!keyA || !keyB) return true;
  if (typeof factoryIdentityKeysCompatible === 'function') return factoryIdentityKeysCompatible(keyA, keyB);
  return keyA === keyB || keyA.includes(keyB) || keyB.includes(keyA);
}

function restoreImageFromFactoryAsset(asset = {}) {
  if (!asset || typeof asset !== 'object') return '';
  if (typeof factoryAssetDisplayImage === 'function') {
    try {
      const image = displayableImageSrc(factoryAssetDisplayImage(asset));
      if (image) return image;
    } catch(e) {}
  }
  return displayableImageSrc(
    asset.image ||
    asset.dataUrl ||
    asset.result ||
    asset.metadata?.image ||
    asset.metadata?.dataUrl ||
    asset.metadata?.result ||
    ''
  );
}

function restoreAssetProductKey(asset = {}) {
  return normalizedRestoreProductKey([
    asset.productKey,
    asset.productIdentityKey,
    asset.metadata?.productKey,
    asset.metadata?.productIdentityKey,
    asset.sourceMap?.productKey,
    asset.sourceMap?.productIdentityKey,
    asset.metadata?.productName,
    asset.sourceMap?.productName,
  ].map(value => String(value || '').trim()).find(Boolean) || '');
}

function restoreAssetInputImageKey(asset = {}) {
  return [
    asset.inputImageFingerprint,
    asset.inputImageKey,
    asset.sourceImageKey,
    asset.productImageKey,
    asset.metadata?.inputImageFingerprint,
    asset.metadata?.inputImageKey,
    asset.metadata?.sourceImageKey,
    asset.metadata?.productImageKey,
    asset.sourceMap?.inputImageFingerprint,
    asset.sourceMap?.inputImageKey,
    asset.sourceMap?.sourceImageKey,
    asset.sourceMap?.productImageKey,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function restoreTargetProductKey(target = {}) {
  const factory = target.factory || {};
  const product = factory.product || {};
  return normalizedRestoreProductKey(
    product.productKey ||
    product.productIdentityKey ||
    product.userProductName ||
    product.productName ||
    target.productName ||
    target.analysis?.product_name ||
    target.analysis?.name ||
    ''
  );
}

function restoreTargetInputImageKey(target = {}) {
  const factory = target.factory || {};
  const product = factory.product || {};
  const input = Array.isArray(product.inputImages) ? (product.inputImages[0] || {}) : {};
  const analysisImage = Array.isArray(target.analysisImages) ? (target.analysisImages[0] || {}) : {};
  return [
    product.lockedInputImageFingerprint,
    product.inputImageFingerprint,
    product.sourceImageKey,
    product.productImageKey,
    input.inputImageFingerprint,
    input.sourceImageKey,
    input.productImageKey,
    analysisImage.inputImageFingerprint,
    analysisImage.sourceImageKey,
    analysisImage.productImageKey,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function factoryAssetLooksLikeLocalFallbackForRestore(asset = {}) {
  const text = [
    asset.title,
    asset.prompt,
    asset.metadata?.source,
    asset.metadata?.fallbackReason,
    asset.sourceMap?.fallbackReason,
  ].map(value => String(value || '')).join('\n');
  return /대체컷|로컬\s*(?:대체|안전후보|사이즈컷|생성)|이미지\s*API\s*실패/.test(text);
}

function findRestorableCurrentSizeFactoryAsset(target = {}) {
  const factory = target.factory || {};
  const targetProductKey = restoreTargetProductKey(target);
  const targetInputKey = restoreTargetInputImageKey(target);
  const assets = Array.isArray(factory.assets) ? factory.assets : [];
  const candidates = assets
    .map(asset => ({ asset, image: restoreImageFromFactoryAsset(asset) }))
    .filter(item => item.asset && String(item.asset.stageId || '') === 'size')
    .filter(item => !item.asset.rejected && !item.asset.currentProductHidden)
    .filter(item => !factoryAssetLooksLikeLocalFallbackForRestore(item.asset))
    .filter(item => !!item.image)
    .filter(item => {
      const assetProductKey = restoreAssetProductKey(item.asset);
      if (targetProductKey && assetProductKey && !restoreKeysCompatible(assetProductKey, targetProductKey)) return false;
      const assetInputKey = restoreAssetInputImageKey(item.asset);
      if (targetInputKey && assetInputKey && assetInputKey !== targetInputKey) return false;
      return true;
    })
    .sort((a, b) => {
      const usedDelta = Number(!!b.asset.used) - Number(!!a.asset.used);
      if (usedDelta) return usedDelta;
      const at = Number(a.asset.updatedAt || a.asset.completedAt || a.asset.createdAt || 0) || 0;
      const bt = Number(b.asset.updatedAt || b.asset.completedAt || b.asset.createdAt || 0) || 0;
      return bt - at;
    });
  return candidates[0] || null;
}

function restoreSpecificationSizeImageFromFactory(target = {}) {
  if (!target || typeof target !== 'object') return false;
  const currentImage = displayableImageSrc(target.sectionImages?.specifications || '');
  if (currentImage) return false;
  const candidate = findRestorableCurrentSizeFactoryAsset(target);
  if (!candidate?.image || !candidate.asset?.id) return false;
  if (!target.sectionImages || typeof target.sectionImages !== 'object') target.sectionImages = {};
  if (!target.cuts || typeof target.cuts !== 'object') target.cuts = {};
  if (!target.cuts.placement || typeof target.cuts.placement !== 'object') target.cuts.placement = {};
  target.sectionImages.specifications = candidate.image;
  target.cuts.placement.specifications = `factory:${candidate.asset.id}`;
  const content = target.sectionContents?.specifications;
  if (content && typeof content === 'object') {
    content.placed_asset_source = '사이즈컷';
    content.placed_asset_label = candidate.asset.title || '사이즈컷';
    content.placed_asset_key = `factory:${candidate.asset.id}`;
  }
  return true;
}

function stripCutsImages(cuts = {}, options = {}) {
  const copy = { ...(cuts || {}) };
  const preserveRecentResults = options.preserveRecentResults === true;
  const generalLimit = Math.max(0, Number(options.generalResultLimit ?? 16) || 0);
  const sizeLimit = Math.max(0, Number(options.sizeResultLimit ?? 8) || 0);
  copy.hasSourceImage = !!(copy.sourceBase64 || copy.sourcePreview);
  copy.hasWorkImage = !!(copy.workImageBase64 || copy.workImagePreview);
  stripCutsRuntimeFlags(copy);
  // preserveRecentResults 는 '최근 생성 결과' 보존 여부다.
  // 원본/작업 입력 이미지는 그와 무관한 관심사라 dropInputImages 로 따로 통제한다.
  // 직렬화 경로만 true 를 넘긴다. 런타임 state 대입 경로는 이미지를 그대로 유지해야 한다.
  const dropInputImages = options.dropInputImages === true || !preserveRecentResults;
  if (dropInputImages) {
    delete copy.sourceBase64;
    delete copy.sourcePreview;
    delete copy.workImageBase64;
    delete copy.workImagePreview;
  }
  const keepResultIndexes = (list, limit) => {
    const keep = new Set();
    if (!preserveRecentResults || !limit) return keep;
    (Array.isArray(list) ? list : [])
      .map((item, index) => ({ item, index }))
      .filter(row => !!row.item?.result)
      .sort((a, b) => {
        const at = Number(a.item.completedAt || a.item.updatedAt || a.item.generationStartedAt || 0) || 0;
        const bt = Number(b.item.completedAt || b.item.updatedAt || b.item.generationStartedAt || 0) || 0;
        return (bt - at) || (a.index - b.index);
      })
      .slice(0, limit)
      .forEach(row => keep.add(row.index));
    return keep;
  };
  const archiveUrlFromPrompt = p => {
    const raw = String(
      p?.imageUrl ||
      p?.resultImageUrl ||
      p?.thumbnailUrl ||
      p?.metadata?.imageUrl ||
      p?.metadata?.resultImageUrl ||
      ''
    ).trim();
    if (raw) {
      if (/^(https?:\/\/|data:image\/|\/api\/local-archive\/)/i.test(raw)) {
        if (/^\/api\/local-archive\//i.test(raw) && typeof factoryRuntimeArchiveImageUrl === 'function') {
          return factoryRuntimeArchiveImageUrl({ imageUrl: raw });
        }
        return raw;
      }
    }
    const archiveId = String(
      p?.archiveId ||
      p?.localArchiveId ||
      p?.metadata?.localArchiveId ||
      p?.metadata?.sourceArchiveId ||
      ''
    ).trim();
    if (!archiveId) return '';
    if (typeof factoryRuntimeArchiveImageUrl === 'function') {
      return factoryRuntimeArchiveImageUrl({ archiveId });
    }
    return `/api/local-archive/assets/${encodeURIComponent(archiveId)}/image`;
  };
  const compactPromptResult = (p, keepInline) => {
    const archived = archiveUrlFromPrompt(p);
    if (archived) return archived;
    const value = typeof displayableImageSrc === 'function'
      ? displayableImageSrc(p?.result)
      : String(p?.result || '').trim();
    if (!value) return null;
    const isHeavyData = /^data:image\//i.test(value) && value.length > 180000;
    if (!isHeavyData || keepInline) return value;
    return null;
  };
  const promptKeep = keepResultIndexes(copy.prompts, generalLimit);
  copy.prompts = (Array.isArray(copy.prompts) ? copy.prompts : []).map((p, index) => {
    const keepResult = promptKeep.has(index);
    const result = compactPromptResult(p, keepResult);
    return {
      ...p,
      hasResult: !!p.result,
      result,
      imagePersistence: result && result !== p.result
        ? 'local-archive-url'
        : (keepResult ? 'session-recent-inline' : p.imagePersistence),
      generating: false,
    };
  });
  const sizeKeep = keepResultIndexes(copy.sizePrompts, sizeLimit);
  copy.sizePrompts = (Array.isArray(copy.sizePrompts) ? copy.sizePrompts : []).map((p, index) => {
    const keepResult = sizeKeep.has(index);
    const result = compactPromptResult(p, keepResult);
    return {
      ...p,
      hasResult: !!p.result,
      result,
      imagePersistence: result && result !== p.result
        ? 'local-archive-url'
        : (keepResult ? 'session-recent-inline' : p.imagePersistence),
      generating: false,
    };
  });
  if (copy.sizeCutResultCache && typeof copy.sizeCutResultCache === 'object') {
    copy.sizeCutResultCache = typeof compactSizeCutResultCache === 'function'
      ? compactSizeCutResultCache(copy.sizeCutResultCache)
      : {};
    Object.keys(copy.sizeCutResultCache).forEach(key => {
      if (copy.sizeCutResultCache[key]?.result) {
        copy.sizeCutResultCache[key] = {
          ...copy.sizeCutResultCache[key],
          hasResult: true,
          result: null,
        };
      }
    });
  }
  return copy;
}

function stripCutsRuntimeFlags(cuts = {}) {
  if (!cuts || typeof cuts !== 'object') return cuts;
  cuts.runBusy = false;
  cuts.sizeRunBusy = false;
  cuts.localArchiveSaving = false;
  cuts.workDriveRunning = false;
  const stripPromptRuntime = prompt => {
    const next = { ...(prompt || {}), generating: false };
    delete next.generationPageSessionId;
    if (next.metadata && typeof next.metadata === 'object') {
      next.metadata = { ...next.metadata };
      delete next.metadata.generationPageSessionId;
    }
    return next;
  };
  if (Array.isArray(cuts.prompts)) {
    cuts.prompts = cuts.prompts.map(stripPromptRuntime);
  }
  if (Array.isArray(cuts.sizePrompts)) {
    cuts.sizePrompts = cuts.sizePrompts.map(stripPromptRuntime);
  }
  return cuts;
}

function stripAiRepairDraft(repair = {}) {
  const copy = { ...(repair || {}) };
  copy.open = false;
  copy.busy = false;
  if (copy.maskDataUrl) copy.hasMaskDataUrl = true;
  delete copy.maskDataUrl;
  delete copy.error;
  return copy;
}

function stripDetailBlockImages(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map(block => {
    const copy = { ...block };
    if (copy.dataUrl) copy.hasDataUrl = true;
    delete copy.dataUrl;
    return copy;
  });
}

function stripVariantImages(sectionVariants = {}) {
  const result = {};
  for (const [sectionId, variants] of Object.entries(sectionVariants || {})) {
    result[sectionId] = (Array.isArray(variants) ? variants : []).map(variant => {
      // 보관함 주소는 그림이 아니라 그림을 가리키는 한 줄이다. 무게가 없는데도
      // 함께 버리고 있었다. 그래서 다시 열면 변형마다 "미리보기 없음" 이 됐다.
      // 실제 바이트(data:)만 떼어내고 주소는 남긴다.
      const kept = typeof runtimeExternalImageSrc === 'function'
        ? runtimeExternalImageSrc(variant?.image || variant?.preview || variant?.dataUrl)
        : '';
      return {
        ...variant,
        hasImage: !!variant.image || !!variant.hasImage,
        image: kept || null,
      };
    });
  }
  return result;
}

function stripAiRepairUndoImages(undoStack = {}) {
  const result = {};
  for (const [sectionId, stack] of Object.entries(undoStack || {})) {
    result[sectionId] = (Array.isArray(stack) ? stack : []).map(item => ({
      ...item,
      hasImage: !!item.image || !!item.hasImage,
      image: null,
    }));
  }
  return result;
}

function sanitizeCompMarketScrapeForPersistence(marketScrape) {
  const copy = marketScrape && typeof marketScrape === 'object' ? { ...marketScrape } : null;
  if (!copy || typeof copy !== 'object') return copy || null;
  const compactInlineImage = (value, key = '') => {
    if (typeof value === 'string') {
      const field = String(key).toLowerCase();
      const isInline = /^data:image\//i.test(value)
        || /base64|dataurl/.test(field)
        || (/(image|thumbnail|preview)$/.test(field) && value.length > 4096 && !/^https?:\/\//i.test(value));
      if (isInline) return field === 'src' ? IMAGE_STORED_MARKER : '';
      return value;
    }
    if (Array.isArray(value)) return value.map(item => compactInlineImage(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, compactInlineImage(item, field)]));
    }
    return value;
  };
  const compactRows = rows => (Array.isArray(rows) ? rows.slice(0, 80) : []).map(row => compactInlineImage(row));
  for (const key of ['results', 'localResults', 'vmResults', 'vmLocalResults']) {
    if (Array.isArray(copy[key])) copy[key] = compactRows(copy[key]);
  }
  for (const key of ['groupedResults', 'localGroupedResults', 'vmGroupedResults', 'vmLocalGroupedResults']) {
    if (copy[key] && typeof copy[key] === 'object') {
      copy[key] = Object.fromEntries(Object.entries(copy[key]).map(([siteId, rows]) => [siteId, compactRows(rows)]));
    }
  }
  copy.imageBase64 = '';
  copy.imagePreview = '';
  if (Array.isArray(copy.searchRuns)) {
    copy.searchRuns = copy.searchRuns.slice(-20);
  }
  if (copy.loading) {
    const hasResults = Array.isArray(copy.results) && copy.results.length > 0;
    copy.status = hasResults
      ? '이전 경쟁사 후보 수집 결과를 복원했습니다. 상세페이지 수집/분석은 선택 후 다시 실행해주세요.'
      : '이전 경쟁사 수집 진행 표시는 새로고침으로 정리했습니다. 필요하면 다시 실행해주세요.';
    copy.phase = copy.error ? 'error' : (hasResults ? 'done' : 'idle');
  }
  copy.loading = false;
  if (Array.isArray(copy.scrapedImages)) {
    copy.scrapedImages = copy.scrapedImages.slice(0, 80).map(image => ({
      ...compactInlineImage(image),
      hasImageData: !!(image?.src || image?.base64 || image?.image),
      src: image?.src && /^data:image\//i.test(String(image.src)) ? IMAGE_STORED_MARKER : image?.src,
      base64: '',
    }));
  }
  if (Array.isArray(copy.selectedIds)) copy.selectedIds = copy.selectedIds.slice(0, 80);
  if (Array.isArray(copy.selectedImageIds)) copy.selectedImageIds = copy.selectedImageIds.slice(0, 80);
  if (copy.detailResults && typeof copy.detailResults === 'object') {
    copy.detailResults = {
      job_id: copy.detailResults.job_id || copy.detailResults.id || copy.detailJobId || '',
      status: copy.detailResults.status || copy.phase || '',
      savedAt: copy.detailResults.savedAt || copy.lastUpdatedAt || null,
      hasRawDetailResults: true,
    };
  }
  return copy;
}

function stripCompPageImages(compPage = {}) {
  const copy = { ...(compPage || {}) };
  copy.hasUploadedImages = Array.isArray(copy.uploadedImages) && copy.uploadedImages.length > 0;
  copy.hasEvidenceImages = Array.isArray(copy.evidenceImages) && copy.evidenceImages.length > 0;
  copy.uploadedImages = [];
  copy.evidenceImages = [];
  if (copy.marketScrape) {
    copy.marketScrape = sanitizeCompMarketScrapeForPersistence(copy.marketScrape);
    copy.marketScrape.hasImage = !!(copy.marketScrape.imageBase64 || copy.marketScrape.imagePreview);
    copy.marketScrape.imageBase64 = null;
    copy.marketScrape.imagePreview = null;
  }
  return copy;
}

function stripOptionSorterImages(optionSorter = {}, options = {}) {
  const copy = { ...(optionSorter || {}) };
  const preserveRecentResults = options.preserveRecentResults === true;
  const imageLimit = Math.max(0, Number(options.imageLimit ?? 24) || 0);
  const resultLimit = Math.max(0, Number(options.resultLimit ?? 24) || 0);
  const keepRecentIndexes = (list, limit, hasPayload) => {
    const keep = new Set();
    if (!preserveRecentResults || !limit) return keep;
    (Array.isArray(list) ? list : [])
      .map((item, index) => ({ item, index }))
      .filter(row => hasPayload(row.item))
      .sort((a, b) => {
        const at = Number(a.item.updatedAt || a.item.createdAt || a.item.savedAt || 0) || 0;
        const bt = Number(b.item.updatedAt || b.item.createdAt || b.item.savedAt || 0) || 0;
        return (bt - at) || (a.index - b.index);
      })
      .slice(0, limit)
      .forEach(row => keep.add(row.index));
    return keep;
  };
  const imageKeep = keepRecentIndexes(copy.images, imageLimit, image => !!(image?.base64 || image?.preview || image?.dataUrl));
  copy.images = (Array.isArray(copy.images) ? copy.images : []).map((image, index) => {
    const keepImage = imageKeep.has(index);
    return keepImage
      ? { ...image, imagePersistence: 'session-recent-inline' }
      : {
          id: image.id,
          name: image.name,
          mime: image.mime,
          ...(image.createdAt ? { createdAt: image.createdAt } : {}),
          hasImageData: !!(
            image.base64 ||
            image.preview ||
            image.dataUrl ||
            image.imageUrl ||
            image.archiveId ||
            image.localArchive?.archiveId ||
            image.hasImageData
          ),
          archiveId: image.archiveId || image.localArchive?.archiveId || '',
          imageUrl: image.imageUrl || image.localArchive?.imageUrl || '',
          imagePersistence: image.imagePersistence || (image.archiveId || image.localArchive?.archiveId ? 'local-archive-url' : ''),
          sourceType: image.sourceType || '',
          localArchive: image.localArchive && typeof image.localArchive === 'object'
            ? { ...image.localArchive }
            : null,
        };
  });
  const resultKeep = keepRecentIndexes(copy.optionResults, resultLimit, result => !!(result?.image || (Array.isArray(result?.splitImages) && result.splitImages.some(item => item?.image))));
  copy.optionResults = (Array.isArray(copy.optionResults) ? copy.optionResults : []).map((result, index) => {
    const keepResult = resultKeep.has(index);
    return {
      ...result,
      hasImage: !!(result.image || result.hasImage),
      image: keepResult ? result.image : null,
      imagePersistence: keepResult ? 'session-recent-inline' : result.imagePersistence,
      splitImages: Array.isArray(result.splitImages)
        ? result.splitImages.map(item => ({
            ...item,
            hasImage: !!(item.image || item.hasImage),
            image: keepResult ? item.image : null,
          }))
        : [],
    };
  });
  if (copy.styleSample && typeof copy.styleSample === 'object') {
    copy.styleSample = {
      ...copy.styleSample,
      hasImage: !!copy.styleSample.image,
      image: null,
    };
  }
  if (copy.styleSample?.imageData) delete copy.styleSample.imageData;
  if (copy.styleSample?.base64) delete copy.styleSample.base64;
  copy.optionGenRunning = false;
  return copy;
}

const OPTION_SORTER_LIVE_RECOVERY_KEY = 'pdp_option_sorter_live_v1';

function loadOptionSorterLiveRecovery(scopeId = getCurrentLastWorkWorkspaceScope(), options = {}) {
  try {
    const raw = workspaceSessionGetItem(OPTION_SORTER_LIVE_RECOVERY_KEY);
    if (!raw) return null;
    const recovery = JSON.parse(raw);
    if (!recovery || typeof recovery !== 'object') return null;
    const expectedScope = String(scopeId || '').trim();
    const recoveryScope = String(recovery.workspaceScope || '').trim();
    const normalizeProjectId = value => String(value || '').trim().replace(/^project:/i, '');
    const expectedProjectId = normalizeProjectId(options.projectId);
    const recoveryProjectId = normalizeProjectId(recovery.projectId);
    const sameScope = recoveryScope === expectedScope;
    const sameProject = !!expectedProjectId && expectedProjectId === recoveryProjectId;
    if (!sameScope && !sameProject) return null;
    if (!recovery.optionSorter || typeof recovery.optionSorter !== 'object') return null;
    return recovery;
  } catch (_) {
    return null;
  }
}

function saveOptionSorterLiveRecovery() {
  if (!serverLastWorkHydrated || serverLastWorkHydrating) {
    optionSorterLiveSaveQueued = true;
    return Promise.resolve(false);
  }
  const scopeId = getCurrentLastWorkWorkspaceScope();
  const recovery = {
    version: 1,
    workspaceScope: scopeId,
    projectId: String(state.currentProjectId || ''),
    savedAt: Date.now(),
    optionSorter: stripOptionSorterImages(state.optionSorter),
  };
  return Promise.resolve(
    workspaceSessionSetItem(OPTION_SORTER_LIVE_RECOVERY_KEY, JSON.stringify(recovery)),
  ).then(() => true).catch(error => {
    console.warn('Option sorter live recovery save failed:', error);
    return false;
  });
}

function flushOptionSorterLiveRecoverySave() {
  if (!optionSorterLiveSaveQueued || !serverLastWorkHydrated || serverLastWorkHydrating) {
    return Promise.resolve(false);
  }
  optionSorterLiveSaveQueued = false;
  return saveOptionSorterLiveRecovery().then(saved => (
    saved && saveServerLastWorkSnapshot('option-sorter-live', { force: true })
  ));
}

function applyOptionSorterLiveRecovery(target = state, options = {}) {
  const scopeId = String(options.scopeId || getCurrentLastWorkWorkspaceScope());
  const projectId = String(options.projectId || target?.currentProjectId || '').trim();
  const recovery = loadOptionSorterLiveRecovery(scopeId, { projectId });
  if (!recovery) return false;
  const currentOptionSorter = target.optionSorter || {};
  const mergedOptionSorter = mergeOptionSorterStoredImages(currentOptionSorter, recovery.optionSorter);
  target.optionSorter = normalizeOptionSorterState({
    ...mergedOptionSorter,
    optionGenRunning: false,
  });
  return true;
}

function buildLightweightSessionPayload(payload) {
  return sanitizeLastWorkPayloadProductScope({
    ...payload,
    imagePreview: payload.imagePreview ? '__stored_in_indexeddb__' : null,
    imageBase64: null,
    analysisImages: stripAnalysisImages(payload.analysisImages),
    sectionImages: stripSectionImages(payload.sectionImages),
    sectionVariants: stripVariantImages(payload.sectionVariants),
    detailImageBlocks: stripDetailBlockImages(payload.detailImageBlocks),
    aiRepairUndoStack: stripAiRepairUndoImages(payload.aiRepairUndoStack),
    aiRepair: stripAiRepairDraft(payload.aiRepair),
    cuts: stripCutsImages(payload.cuts, {
      preserveRecentResults: true,
      dropInputImages: true,
      generalResultLimit: 16,
      sizeResultLimit: 8,
    }),
    compPage: stripCompPageImages(payload.compPage),
    optionSorter: stripOptionSorterImages(payload.optionSorter),
    factory: stripFactoryImages(payload.factory),
    fixedDetailImages: stripFixedDetailImagesForSession(payload.fixedDetailImages || loadFixedDetailImages()),
  }, {
    targetName: payload?.factory?.product?.productName || payload?.productName || '',
  });
}

const LAST_WORK_GENERATED_IMAGE_STAGES = ['hero', 'size', 'cuts'];

function lastWorkNormalizeIdentityText(value = '') {
  if (typeof factoryNormalizeIdentityText === 'function') return factoryNormalizeIdentityText(value);
  return String(value || '').toLowerCase().replace(/[\s_\-()[\]{}.:/\\|·,]+/g, '');
}

function lastWorkIdentityKeysCompatible(a = '', b = '') {
  const keyA = lastWorkNormalizeIdentityText(a);
  const keyB = lastWorkNormalizeIdentityText(b);
  if (!keyA || !keyB) return true;
  if (typeof factoryIdentityKeysCompatible === 'function') return factoryIdentityKeysCompatible(keyA, keyB);
  return keyA === keyB || keyA.includes(keyB) || keyB.includes(keyA);
}

function lastWorkPayloadProductName(payload = {}) {
  const product = payload?.factory?.product || {};
  return [
    product.productName,
    payload.productName,
    product.confirmedDb?.product_name,
    product.confirmedDb?.jname,
    product.finalDb?.product_name,
    product.finalDb?.jname,
  ].map(value => String(value || '').trim()).find(Boolean) || '';
}

function lastWorkPromptText(row = {}) {
  return String(row?.prompt || row?.text || row?.instruction || row?.memo || '').trim();
}

function lastWorkPromptProductName(text = '') {
  const raw = String(text || '');
  const match = /(?:제품명|상품명)\s*[:：]\s*([^\n\r,;|]+)/i.exec(raw);
  return String(match?.[1] || '').replace(/\s+(?:가로|세로|무게|소재|옵션).*$/i, '').trim();
}

function lastWorkPromptConflictsWithProduct(text = '', targetKey = '', staleKeys = []) {
  const raw = String(text || '');
  if (!raw || !targetKey) return false;
  const explicitName = lastWorkPromptProductName(raw);
  if (explicitName && !lastWorkIdentityKeysCompatible(explicitName, targetKey)) return true;
  const normalized = lastWorkNormalizeIdentityText(raw);
  return staleKeys.some(key => key && normalized.includes(key) && !lastWorkIdentityKeysCompatible(key, targetKey));
}

function lastWorkClearCutsScope(cuts = {}) {
  if (!cuts || typeof cuts !== 'object') return false;
  let changed = false;
  const clearKeys = [
    'prompts', 'sizePrompts', 'results', 'sizeResults',
    'sourceBase64', 'sourceMime', 'sourcePreview',
    'workImageBase64', 'workImageMime', 'workImagePreview',
    'factoryStageId', 'sizeFactoryStageId', 'factoryGenerationRunId', 'sizeFactoryGenerationRunId',
    'sizeSourceDecision', 'sizeSourceDecisionLabel',
  ];
  clearKeys.forEach(key => {
    if (cuts[key] !== undefined && cuts[key] !== null && !(Array.isArray(cuts[key]) && cuts[key].length === 0)) {
      cuts[key] = Array.isArray(cuts[key]) ? [] : (typeof cuts[key] === 'string' ? '' : null);
      changed = true;
    }
  });
  cuts.promptsUpdatedAt = Date.now();
  cuts.sizePromptsUpdatedAt = Date.now();
  cuts.__productScopeCleared = true;
  return changed;
}

function lastWorkClearGeneratedFactoryScope(factory = {}, targetName = '') {
  if (!factory || typeof factory !== 'object') return false;
  let changed = false;
  if (Array.isArray(factory.assets)) {
    factory.assets.forEach(asset => {
      if (!asset || !LAST_WORK_GENERATED_IMAGE_STAGES.includes(String(asset.stageId || ''))) return;
      if (asset.rejected && asset.metadata?.rejectedReason) return;
      asset.rejected = true;
      asset.used = false;
      asset.metadata = {
        ...(asset.metadata || {}),
        rejectedReason: `${targetName || '현재 제품'} 기준과 섞인 이전 생성 후보라 자동 분리됨`,
        rejectedAt: Date.now(),
      };
      changed = true;
    });
  }
  LAST_WORK_GENERATED_IMAGE_STAGES.forEach(stageId => {
    const stage = factory.stages?.[stageId];
    if (!stage || typeof stage !== 'object') return;
    if (Array.isArray(stage.selectedAssetIds) && stage.selectedAssetIds.length) {
      stage.selectedAssetIds = [];
      changed = true;
    }
    if (stage.status === 'done' || stage.status === 'error' || stage.status === 'running') {
      stage.status = 'idle';
      stage.message = '이전 상품 생성 후보를 분리했습니다. 현재 제품으로 다시 생성해주세요.';
      stage.latestGenerationRunId = '';
      stage.runStartedAt = null;
      stage.updatedAt = Date.now();
      changed = true;
    }
  });
  return changed;
}

function lastWorkFilterProductCandidates(product = {}, targetKey = '') {
  if (!product || typeof product !== 'object' || !targetKey || typeof factoryObjectConflictsWithIdentity !== 'function') return false;
  let changed = false;
  ['dbCandidates', 'pendingDbCandidates', 'cafe24Candidates', 'pendingCafe24Candidates'].forEach(key => {
    if (!Array.isArray(product[key])) return;
    const filtered = product[key].filter(item => !factoryObjectConflictsWithIdentity(item, targetKey));
    if (filtered.length !== product[key].length) {
      product[key] = filtered;
      changed = true;
    }
  });
  return changed;
}

function sanitizeLastWorkPayloadProductScope(payload = {}, options = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const out = options.mutate ? payload : cloneData(payload);
  const targetName = String(options.targetName || lastWorkPayloadProductName(out) || '').trim();
  const targetKey = lastWorkNormalizeIdentityText(targetName);
  if (!targetKey) return out;
  let changed = false;
  const payloadProductName = lastWorkPayloadProductName(out);
  const payloadProductKey = lastWorkNormalizeIdentityText(payloadProductName);
  const staleKeys = [];
  if (payloadProductKey && !lastWorkIdentityKeysCompatible(payloadProductKey, targetKey)) staleKeys.push(payloadProductKey);

  const cuts = out.cuts && typeof out.cuts === 'object' ? out.cuts : null;
  const cutPromptRows = cuts
    ? [...(Array.isArray(cuts.prompts) ? cuts.prompts : []), ...(Array.isArray(cuts.sizePrompts) ? cuts.sizePrompts : [])]
    : [];
  const promptDrift = cutPromptRows.some(row => lastWorkPromptConflictsWithProduct(lastWorkPromptText(row), targetKey, staleKeys));
  const productDrift = !!staleKeys.length;
  const hasGeneratedScopeDrift = productDrift || promptDrift;

  if (productDrift && typeof out.productName === 'string' && out.productName !== targetName) {
    out.productName = targetName;
    changed = true;
  }
  if (cuts && hasGeneratedScopeDrift) {
    changed = lastWorkClearCutsScope(cuts) || changed;
  }
  if (out.factory && typeof out.factory === 'object') {
    const product = out.factory.product && typeof out.factory.product === 'object' ? out.factory.product : {};
    if (targetName && product.productName !== targetName) {
      product.productName = targetName;
      out.factory.product = product;
      changed = true;
    }
    changed = lastWorkFilterProductCandidates(product, targetKey) || changed;
    if (hasGeneratedScopeDrift) {
      changed = lastWorkClearGeneratedFactoryScope(out.factory, targetName) || changed;
    }
  }
  if (Array.isArray(out.dbMatchCandidates) && typeof factoryObjectConflictsWithIdentity === 'function') {
    const filtered = out.dbMatchCandidates.filter(item => !factoryObjectConflictsWithIdentity(item, targetKey));
    if (filtered.length !== out.dbMatchCandidates.length) {
      out.dbMatchCandidates = filtered;
      changed = true;
    }
  }
  if (changed) {
    try {
      Object.defineProperty(out, '__productScopeCleaned', { value: true, enumerable: false, configurable: true });
    } catch(e) {
      out.__productScopeCleaned = true;
    }
  }
  return out;
}

function persistedCutResultCount(cuts = {}) {
  const rows = [
    ...(Array.isArray(cuts?.prompts) ? cuts.prompts : []),
    ...(Array.isArray(cuts?.sizePrompts) ? cuts.sizePrompts : []),
    ...(Array.isArray(cuts?.results) ? cuts.results : []),
  ];
  return rows.filter(row => (
    displayableImageSrc(row?.result)
    || displayableImageSrc(row?.imageUrl)
    || displayableImageSrc(row?.resultImageUrl)
    || row?.hasResult === true
  )).length;
}

function lastWorkHydrationTargetName(rawAssets = {}, rawLightweight = null, currentTargetName = '', currentHasProductWork = false) {
  const incomingName = lastWorkPayloadProductName(rawAssets) || lastWorkPayloadProductName(rawLightweight || {});
  const currentName = String(currentTargetName || '').trim();
  return incomingName || (currentHasProductWork ? currentName : '') || currentName;
}

function normalizeCafe24FieldViewForLastWork(value = {}, fallback = {}) {
  if (typeof factoryNormalizeCafe24FieldView === 'function') {
    return factoryNormalizeCafe24FieldView(value, fallback);
  }
  const source = value && typeof value === 'object' ? value : {};
  const backup = fallback && typeof fallback === 'object' ? fallback : {};
  const hiddenFieldIds = Array.isArray(source.hiddenFieldIds)
    ? source.hiddenFieldIds
    : (Array.isArray(backup.hiddenFieldIds) ? backup.hiddenFieldIds : []);
  const presets = Array.isArray(source.presets) && source.presets.length
    ? source.presets
    : (Array.isArray(backup.presets) ? backup.presets : []);
  return {
    hiddenFieldIds: [...new Set(hiddenFieldIds.map(item => String(item || '').trim()).filter(Boolean))],
    presets: presets.filter(item => item && typeof item === 'object'),
    activePresetId: String(source.activePresetId || backup.activePresetId || ''),
    defaultSavedAt: Number(source.defaultSavedAt || backup.defaultSavedAt) || null,
  };
}

function cafe24FieldViewLastWorkScore(view = {}) {
  if (!view || typeof view !== 'object') return 0;
  let score = 0;
  if (Array.isArray(view.hiddenFieldIds) && view.hiddenFieldIds.length) score += Math.min(12, view.hiddenFieldIds.length);
  if (Array.isArray(view.presets) && view.presets.length) score += Math.min(20, view.presets.length * 5);
  if (String(view.activePresetId || '').trim()) score += 2;
  if (Number(view.defaultSavedAt)) score += 1;
  return score;
}

function getCafe24FieldViewStorageSnapshot() {
  try {
    if (typeof factoryLoadCafe24FieldViewStorage === 'function') {
      return factoryLoadCafe24FieldViewStorage();
    }
    return normalizeCafe24FieldViewForLastWork(loadJson(STORAGE_KEYS.cafe24FieldView, {}));
  } catch(e) {
    return normalizeCafe24FieldViewForLastWork({});
  }
}

function buildRecoveredCafe24FieldViewFromFactory(factory = {}) {
  const product = factory?.product && typeof factory.product === 'object' ? factory.product : {};
  const settings = product.dbFieldSettings && typeof product.dbFieldSettings === 'object' ? product.dbFieldSettings : {};
  const validKeys = new Set();
  try {
    if (typeof factoryCafe24FormFieldsFlat === 'function' && typeof factoryCafe24FieldUiKey === 'function') {
      factoryCafe24FormFieldsFlat().forEach(field => {
        const key = factoryCafe24FieldUiKey(field);
        if (key) validKeys.add(key);
      });
    }
  } catch(e) {}
  const hiddenFieldIds = Object.entries(settings)
    .filter(([, setting]) => setting && typeof setting === 'object' && setting.enabled === false)
    .map(([key]) => String(key || '').trim())
    .filter(Boolean)
    .filter(key => !validKeys.size || validKeys.has(key));
  if (!hiddenFieldIds.length) return normalizeCafe24FieldViewForLastWork({});
  const savedAt = Number(factory.lastSavedAt || product.lastSavedAt || Date.now()) || Date.now();
  const preset = {
    id: 'recovered_default',
    name: '복구된 기본 프리셋',
    hiddenFieldIds,
    savedAt,
  };
  return normalizeCafe24FieldViewForLastWork({
    hiddenFieldIds,
    presets: [preset],
    activePresetId: preset.id,
    defaultSavedAt: savedAt,
  });
}

function resolveCafe24FieldViewForLastWork(factory = {}, extraView = null) {
  const explicitCandidates = [
    extraView,
    factory?.cafe24FieldView,
    getCafe24FieldViewStorageSnapshot(),
  ].map(item => normalizeCafe24FieldViewForLastWork(item));
  let best = explicitCandidates[0] || normalizeCafe24FieldViewForLastWork({});
  explicitCandidates.slice(1).forEach(candidate => {
    if (cafe24FieldViewLastWorkScore(candidate) > cafe24FieldViewLastWorkScore(best)) best = candidate;
  });
  if (cafe24FieldViewLastWorkScore(best) <= 0) {
    best = buildRecoveredCafe24FieldViewFromFactory(factory);
  }
  let merged = best;
  explicitCandidates.forEach(candidate => {
    merged = normalizeCafe24FieldViewForLastWork(merged, candidate);
  });
  return merged;
}

function persistCafe24FieldViewForLastWork(view = {}) {
  const normalized = normalizeCafe24FieldViewForLastWork(view);
  try {
    const nextJson = JSON.stringify(normalized);
    if (nextJson !== lastCafe24FieldViewPersistedJson) {
      localStorage.setItem(STORAGE_KEYS.cafe24FieldView, nextJson);
      lastCafe24FieldViewPersistedJson = nextJson;
    }
  } catch(e) {}
  return normalized;
}

function restoreCafe24FieldViewFromLastWork(assets = {}) {
  const factory = assets?.factory && typeof assets.factory === 'object' ? assets.factory : (state.factory || {});
  const restored = resolveCafe24FieldViewForLastWork(factory, assets?.cafe24FieldViewStorage || assets?.cafe24FieldView);
  if (cafe24FieldViewLastWorkScore(restored) <= 0) return null;
  return persistCafe24FieldViewForLastWork(restored);
}

function currentSessionAssetsPayload(options = {}) {
  const includeImages = options.includeImages !== false;
  const documentSnapshot = options.documentSnapshot === true;
  const runtimeScopeId = workspacePersistenceApi().normalizeWorkspaceScope(
    options.scopeId || getCurrentLastWorkWorkspaceScope(),
  );
  const projectId = String(options.projectId ?? state.currentProjectId ?? '').replace(/^project:/i, '').trim();
  const documentScopeId = getCurrentDocumentWorkspaceScope(projectId);
  const persistenceScopeId = documentSnapshot && documentScopeId
    ? documentScopeId
    : runtimeScopeId;
  const preserveSelectedFactoryImages = options.preserveSelectedFactoryImages === true;
  const preserveRecentWorkingImages = options.preserveRecentWorkingImages === true;
  const preserveInlineSectionImages = includeImages || options.preserveSectionImages === true || preserveRecentWorkingImages;
  const compPageSnapshot = options.compPageSnapshot && typeof options.compPageSnapshot === 'object'
    ? options.compPageSnapshot
    : (state.compPage || {});
  const canonicalFactory = options.factorySnapshot
    || (typeof factoryRuntimeReadCommittedFactory === 'function'
      ? factoryRuntimeReadCommittedFactory()
      : state.factory)
    || {};
  const factorySnapshot = includeImages
    ? cloneData(canonicalFactory)
    : stripFactoryImages(canonicalFactory, {
        preserveReferencedImages: preserveSelectedFactoryImages || preserveRecentWorkingImages,
        preserveRecentImages: preserveRecentWorkingImages,
      });
  const cafe24FieldViewStorage = getCafe24FieldViewStorageSnapshot();
  if (factorySnapshot && typeof factorySnapshot === 'object') {
    factorySnapshot.cafe24FieldView = resolveCafe24FieldViewForLastWork(factorySnapshot, cafe24FieldViewStorage);
  }
  const inputImageFingerprint = currentWorkspaceInputImageFingerprint(factorySnapshot);
  const workIdentity = ensureActiveWorkIdentity({
    factorySnapshot,
    inputImageFingerprint,
    scopeId: persistenceScopeId,
  });
  return {
    id: SESSION_ASSET_ID,
    currentProjectId: projectId,
    workspaceScope: { id: persistenceScopeId },
    workspaceRevision: currentWorkspaceRevision(persistenceScopeId),
    workspaceBranch: documentSnapshot ? null : currentWorkspaceBranch(runtimeScopeId, projectId),
    workIdentity: cloneData(workIdentity),
    inputImageFingerprint,
    step: state.step || 'upload',
    productName: state.productName || '',
    analysis: cloneData(state.analysis || null),
    competitorData: cloneData(state.competitorData || null),
    analysisTimestamp: state.analysisTimestamp || null,
    analysisRuns: cloneData(state.analysisRuns || []),
    currentAnalysisRunId: state.currentAnalysisRunId || '',
    dbMatchCandidates: cloneData(state.dbMatchCandidates || []),
    dbMatchLastQuery: state.dbMatchLastQuery || '',
    dbMatchSelectionOpen: !!state.dbMatchSelectionOpen,
    dbColorOptions: cloneData(state.dbColorOptions || []),
    dbColorOptionsLastJcode: state.dbColorOptionsLastJcode || '',
    dbColorOptionsLoadedAt: state.dbColorOptionsLoadedAt || null,
    productInfoManualValues: cloneData(state.productInfoManualValues || {}),
    imagePreview: includeImages ? (state.imagePreview || null) : (state.imagePreview ? IMAGE_STORED_MARKER : null),
    imageBase64: includeImages ? (state.imageBase64 || null) : null,
    productImageBackup: includeImages ? compactProductImageBackupPayload() : productImageBackupReferencePayload(),
    analysisImages: includeImages ? cloneData(state.analysisImages || []) : stripAnalysisImages(state.analysisImages || []),
    sectionContents: cloneData(state.sectionContents || {}),
    sectionLocks: cloneData(state.sectionLocks || {}),
    sectionInstructionSources: cloneData(state.sectionInstructionSources || {}),
    sectionGenerationModes: cloneData(state.sectionGenerationModes || {}),
    sectionBasisModes: cloneData(state.sectionBasisModes || {}),
    sectionAssembly: cloneData(state.sectionAssembly || {}),
    sectionBatchBasisMode: state.sectionBatchBasisMode || 'keep',
    sectionBatchGenerationMode: state.sectionBatchGenerationMode || 'keep',
    sectionGenerationMeta: cloneData(state.sectionGenerationMeta || {}),
    sectionOrder: Array.isArray(state.sectionOrder) ? cloneData(state.sectionOrder) : null,
    hiddenSectionIds: Array.isArray(state.hiddenSectionIds) ? cloneData(state.hiddenSectionIds) : [],
    customSections: Array.isArray(state.customSections) ? cloneData(state.customSections) : [],
    sectionImages: preserveInlineSectionImages ? cloneData(state.sectionImages || {}) : stripSectionImages(state.sectionImages || {}),
    detailImageBlocks: preserveInlineSectionImages ? cloneData(state.detailImageBlocks || []) : stripDetailBlockImages(state.detailImageBlocks || []),
    fixedDetailImages: includeImages
      ? cloneData(state.fixedDetailImages || loadFixedDetailImages())
      : stripFixedDetailImagesForSession(state.fixedDetailImages || loadFixedDetailImages()),
    sectionVariants: preserveInlineSectionImages ? cloneData(state.sectionVariants || {}) : stripVariantImages(state.sectionVariants || {}),
    currentSectionVariantIds: cloneData(state.currentSectionVariantIds || {}),
    sectionTipHelperApplied: cloneData(state.sectionTipHelperApplied || {}),
    sectionVariantEvaluations: cloneData(state.sectionVariantEvaluations || {}),
    aiRepairUndoStack: includeImages ? cloneData(state.aiRepairUndoStack || {}) : stripAiRepairUndoImages(state.aiRepairUndoStack || {}),
    aiRepair: includeImages ? cloneData(state.aiRepair || {}) : stripAiRepairDraft(state.aiRepair || {}),
    cuts: includeImages ? stripCutsRuntimeFlags(cloneData(state.cuts || {})) : stripCutsImages(state.cuts || {}, {
      preserveRecentResults: preserveRecentWorkingImages,
      dropInputImages: true,
    }),
    compPage: {
      ...stripCompPageImages(compPageSnapshot),
      uploadedImages: includeImages ? cloneData(compPageSnapshot.uploadedImages || []) : [],
      evidenceImages: includeImages ? cloneData(compPageSnapshot.evidenceImages || []) : [],
    },
    optionSorter: includeImages ? cloneData(state.optionSorter || {}) : stripOptionSorterImages(state.optionSorter || {}, {
      preserveRecentResults: preserveRecentWorkingImages,
    }),
    factory: factorySnapshot,
    cafe24FieldViewStorage: cloneData(factorySnapshot?.cafe24FieldView || cafe24FieldViewStorage || {}),
    imagePersistence: {
      mode: includeImages ? 'inline' : (preserveInlineSectionImages ? 'section-inline' : 'lightweight'),
      savedAt: Date.now(),
    },
    savedAt: Date.now(),
  };
}

function getServerLastWorkBases() {
  const bases = [
    state?.backendBaseUrl,
    loadBackendUrl?.(),
    'http://127.0.0.1:5050',
  ].filter(v => typeof v === 'string' && v.trim())
    .map(v => String(v).trim().replace(/\/+$/, ''))
    .map(base => base.replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://127.0.0.1'));
  return [...new Set(bases)];
}

function getStoredLastWorkDraftScope() {
  if (lastWorkDraftScopeCache) return lastWorkDraftScopeCache;
  try {
    const existing = String(workspaceSessionGetItem(LAST_WORK_DRAFT_SCOPE_STORAGE_KEY) || '').trim();
    if (existing) {
      lastWorkDraftScopeCache = existing;
      return existing;
    }
    const created = `draft:${uid('lastwork')}`;
    lastWorkDraftScopeCache = created;
    lastWorkDraftScopePersistencePromise = Promise.resolve(
      workspaceSessionSetItem(LAST_WORK_DRAFT_SCOPE_STORAGE_KEY, created),
    );
    return created;
  } catch (e) {
    lastWorkDraftScopeCache = `draft:memory-${uid('lastwork')}`;
    return lastWorkDraftScopeCache;
  }
}

function getCurrentLastWorkWorkspaceScope() {
  return workspacePersistenceApi().normalizeWorkspaceScope(getStoredLastWorkDraftScope());
}

function getCurrentDocumentWorkspaceScope(projectId = '') {
  const id = String(projectId || '').replace(/^project:/i, '').trim();
  if (id) return workspacePersistenceApi().normalizeProjectScope(id);
  let factory = null;
  try {
    if (typeof factoryRuntimeReadFactory === 'function') factory = factoryRuntimeReadFactory();
  } catch (_) {}
  const restoredId = String(
    factory?.workspace?.id || factory?.currentProjectId || '',
  ).replace(/^project:/i, '').trim();
  // ★ 생산관제(다량생산) 워커가 만든 batch: 문서를 **사람 세션의 문서로 삼지 않는다.**
  //   이 한 줄이 없어서, 배치 문서가 한 번 실려 오면 그 뒤로 저장도 복원도 전부
  //   그 배치 문서 범위로 나갔다. 그래서 조립공장에서 일하다 새로고침하면
  //   8/29 배치 워커가 남긴 값(수저집 파우치 · 12500.00 · 9930 · 1.00g · 면 100% · 생활)이
  //   통째로 되살아났다. 사람이 만든 작업파일이 아닌데도.
  //   (실측 2026-08-30: backend/.local/pdp-last-work-scoped/ff2f7f1d....json,
  //    workspaceId = project:batch:factory-job-d9881fb8...)
  //   워커 자신이 돌 때(classicRuntimeBatchWorkerMode)는 그 문서가 제 작업이므로 그대로 쓴다.
  //   시작 복원에도 같은 규칙이 이미 있다(app-core-03.js 의 batch: 필터).
  const isBatchDocument = /^batch:/i.test(restoredId);
  // ★ typeof 로는 못 막는다. classicRuntimeBatchWorkerMode 는 **뒤에 오는 파일에서 let 으로**
  //   선언되므로, 부팅 초반(복원 중)에는 선언 전 접근이 되어 typeof 조차 ReferenceError 를 던진다.
  //   그 예외가 복원 경로를 끊어 강제 새로고침에서 생성물 10개가 통째로 사라졌다
  //   (실측 2026-08-30, 일일 회귀 SAVE-26). var 나 undeclared 였다면 안 났을 함정이다.
  let batchWorkerMode = false;
  try { batchWorkerMode = classicRuntimeBatchWorkerMode === true; } catch (_) { batchWorkerMode = false; }
  if (isBatchDocument && !batchWorkerMode) return '';
  return restoredId && !/^draft:/i.test(restoredId)
    ? workspacePersistenceApi().normalizeProjectScope(restoredId)
    : '';
}

function currentWorkspaceBranch(scopeId = getCurrentLastWorkWorkspaceScope(), projectId = '') {
  const branchScope = workspacePersistenceApi().normalizeWorkspaceScope(scopeId);
  const documentScope = getCurrentDocumentWorkspaceScope(projectId);
  return workspacePersistenceApi().createWorkBranch({
    branchId: branchScope.replace(/^draft:/i, ''),
    scopeId: branchScope,
    documentId: documentScope.replace(/^project:/i, ''),
    documentScopeId: documentScope,
  });
}

function bindWorkspaceSnapshotToCurrentBranch(snapshot = {}, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const branchScope = String(options.branchScope || getCurrentLastWorkWorkspaceScope()).trim();
  const existingScope = lastWorkSnapshotWorkspaceScope(snapshot);
  // 다른 초안을 이 가지에 함부로 붙이지 않는다. 탭 두 개가 동시에 살아 있을 때
  // 서로의 내용이 섞이는 것을 막는 규칙이다.
  // 다만 **주인을 잃은 초안**(탭이 죽어 심장박동이 끊긴 것)을 되살릴 때는 예외다.
  // 그 판단은 호출자가 하고(adoptPreviousDraftSessionAssets), 여기서는 명시적으로 받는다.
  if (existingScope.startsWith('draft:') && existingScope !== branchScope
    && options.adoptOrphanDraft !== true) return null;
  const factory = snapshot.factory && typeof snapshot.factory === 'object' ? snapshot.factory : {};
  const projectId = String(
    options.projectId
      || snapshot.currentProjectId
      || snapshot.assetPayload?.currentProjectId
      || factory.currentProjectId
      || factory.workspace?.id
      || '',
  ).replace(/^project:/i, '').trim();
  const branch = currentWorkspaceBranch(branchScope, projectId);
  snapshot.scopeId = branchScope;
  snapshot.workspaceScope = { id: branchScope };
  snapshot.workspaceRevision = snapshot.workspaceRevision?.scopeId === branchScope
    ? snapshot.workspaceRevision
    : (currentWorkspaceRevision(branchScope) || null);
  snapshot.workspaceBranch = branch;
  if (snapshot.assetPayload && typeof snapshot.assetPayload === 'object') {
    snapshot.assetPayload.scopeId = branchScope;
    snapshot.assetPayload.workspaceScope = { id: branchScope };
    snapshot.assetPayload.workspaceRevision = snapshot.assetPayload.workspaceRevision?.scopeId === branchScope
      ? snapshot.assetPayload.workspaceRevision
      : (currentWorkspaceRevision(branchScope) || null);
    snapshot.assetPayload.workspaceBranch = branch;
  }
  return snapshot;
}

function resolveRestoredCandidateReviewWorkspaceId(restoredCandidateWorkspaceId = '', currentProjectId = '') {
  const projectId = String(currentProjectId || '').trim();
  if (projectId) return projectId;
  const restoredWorkspaceId = String(restoredCandidateWorkspaceId || '').trim();
  if (restoredWorkspaceId && !/^(?:draft|lastwork)(?:[:_-]|$)/i.test(restoredWorkspaceId)) {
    return restoredWorkspaceId;
  }
  const currentDraftWorkspaceId = String(getStoredLastWorkDraftScope() || '').trim();
  return currentDraftWorkspaceId || restoredWorkspaceId;
}

function restoreLastWorkProjectIdentityFromAssets(assets = {}) {
  if (String(state.currentProjectId || '').trim()) return false;
  const factory = assets?.factory && typeof assets.factory === 'object' ? assets.factory : {};
  const workspace = factory.workspace && typeof factory.workspace === 'object' ? factory.workspace : {};
  const projectId = String(
    assets.currentProjectId || factory.currentProjectId || workspace.id || '',
  ).trim();
  if (!projectId) return false;
  const projectScope = workspacePersistenceApi().normalizeProjectScope(projectId);
  const incomingScope = lastWorkSnapshotWorkspaceScope(assets);
  const activeBranchScope = getCurrentLastWorkWorkspaceScope();
  const branch = assets.workspaceBranch && typeof assets.workspaceBranch === 'object'
    ? assets.workspaceBranch
    : null;
  if (incomingScope && incomingScope !== activeBranchScope && incomingScope !== projectScope) return false;
  if (branch && (
    String(branch.scopeId || '') !== activeBranchScope
    || String(branch.documentScopeId || '') !== projectScope
  )) return false;
  state.currentProjectId = projectId;
  state.currentProjectName = String(
    assets.currentProjectName || factory.currentProjectName || workspace.name || '',
  ).trim();
  state.currentProjectCreatedAt = assets.currentProjectCreatedAt || workspace.createdAt || null;
  return true;
}

function lastWorkFactoryHasSelfConsistentCurrentAssets(assets = {}) {
  const factory = assets?.factory && typeof assets.factory === 'object' ? assets.factory : null;
  if (!factory) return false;
  const product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  const workspaceId = String(factory.workspace?.id || factory.currentProjectId || '').trim();
  const productKey = String(
    product.productKey || product.productIdentityKey || product.productName || '',
  ).trim();
  const inputImageFingerprint = String(
    product.lockedInputImageFingerprint ||
    product.currentUploadImageFingerprint ||
    product.inputImageFingerprint ||
    '',
  ).trim();
  const currentAssets = (Array.isArray(factory.assets) ? factory.assets : []).filter(asset =>
    asset &&
    !asset.rejected &&
    LAST_WORK_GENERATED_IMAGE_STAGES.includes(String(asset.stageId || ''))
  );
  if (!workspaceId || !productKey || !inputImageFingerprint || !currentAssets.length) return false;
  return currentAssets.every(asset => {
    const stageId = String(asset.stageId || '').trim();
    const stage = factory.stages?.[stageId] || {};
    const expectedRunId = String(
      stage.latestGenerationRunId ||
      stage.currentRunId ||
      product.currentRunId ||
      factory.automation?.currentRunId ||
      factory.goalRun?.currentRunId ||
      '',
    ).trim();
    const assetWorkspaceId = String(
      asset.workspaceId ||
      asset.currentProjectId ||
      asset.metadata?.workspaceId ||
      asset.sourceMap?.workspaceId ||
      '',
    ).trim();
    const assetRunId = String(
      asset.currentRunId ||
      asset.generationRunId ||
      asset.metadata?.currentRunId ||
      asset.sourceMap?.currentRunId ||
      '',
    ).trim();
    const assetProductKey = String(
      asset.productKey ||
      asset.metadata?.productKey ||
      asset.sourceMap?.productKey ||
      asset.metadata?.productIdentityKey ||
      '',
    ).trim();
    const assetInputFingerprint = String(
      asset.inputImageFingerprint ||
      asset.metadata?.inputImageFingerprint ||
      asset.sourceMap?.inputImageFingerprint ||
      '',
    ).trim();
    const hasImageReference = !!(
      asset.image ||
      asset.dataUrl ||
      asset.result ||
      asset.imageUrl ||
      asset.archiveId ||
      asset.localArchive?.archiveId ||
      asset.metadata?.localArchiveId
    );
    return !!(
      hasImageReference &&
      expectedRunId &&
      assetWorkspaceId === workspaceId &&
      assetRunId === expectedRunId &&
      lastWorkIdentityKeysCompatible(assetProductKey, productKey) &&
      assetInputFingerprint === inputImageFingerprint
    );
  });
}

function repairRestoredDraftFactoryAssetWorkspaceScope(factory = {}) {
  const targetWorkspaceId = String(
    factory?.workspace?.id ||
    factory?.currentProjectId ||
    (typeof state !== 'undefined' ? state?.currentProjectId : '') ||
    (typeof getCurrentLastWorkWorkspaceScope === 'function' ? getCurrentLastWorkWorkspaceScope() : '') ||
    '',
  ).trim();
  const currentAssets = (Array.isArray(factory.assets) ? factory.assets : []).filter(asset =>
    asset &&
    !asset.rejected &&
    LAST_WORK_GENERATED_IMAGE_STAGES.includes(String(asset.stageId || ''))
  );
  const sourceWorkspaceIds = [...new Set(currentAssets.map(asset => String(
    asset.workspaceId ||
    asset.currentProjectId ||
    asset.metadata?.workspaceId ||
    asset.sourceMap?.workspaceId ||
    '',
  ).trim()).filter(id => id && id !== targetWorkspaceId))];
  if (!/^draft:lastwork_/i.test(targetWorkspaceId)) return false;
  if (sourceWorkspaceIds.length !== 1 || !/^draft:lastwork_/i.test(sourceWorkspaceIds[0])) return false;
  const sourceWorkspaceId = sourceWorkspaceIds[0];
  const selfConsistent = lastWorkFactoryHasSelfConsistentCurrentAssets({
    factory: {
      ...factory,
      currentProjectId: sourceWorkspaceId,
      workspace: {
        ...(factory.workspace || {}),
        id: sourceWorkspaceId,
      },
    },
  });
  if (!selfConsistent) return false;
  if (typeof factoryStampFactoryItemsWorkspaceIdentity !== 'function') return false;
  factoryStampFactoryItemsWorkspaceIdentity(factory, targetWorkspaceId, {
    previousWorkspaceId: sourceWorkspaceId,
  });
  return true;
}

function rotateLastWorkDraftScope() {
  const next = `draft:${uid('lastwork')}`;
  lastWorkDraftScopeCache = next;
  try {
    lastWorkDraftScopePersistencePromise = Promise.resolve(
      workspaceSessionSetItem(LAST_WORK_DRAFT_SCOPE_STORAGE_KEY, next),
    );
  } catch (error) {
    lastWorkDraftScopePersistencePromise = Promise.reject(error);
  }
  return next;
}

async function settleLastWorkDraftScopePersistence(expectedScope = lastWorkDraftScopeCache) {
  await lastWorkDraftScopePersistencePromise;
  const persistedScope = String(workspaceSessionGetItem(LAST_WORK_DRAFT_SCOPE_STORAGE_KEY) || '').trim();
  if (persistedScope !== expectedScope) {
    throw new Error('새 작업의 브라우저 초안 경계를 저장하지 못했습니다. 새로고침하지 말고 다시 시도해주세요.');
  }
  return expectedScope;
}

function lastWorkSnapshotWorkspaceScope(snapshot = {}) {
  const scope = snapshot?.workspaceScope;
  return String(
    (scope && typeof scope === 'object' ? scope.id : scope) ||
    snapshot?.workspaceId ||
    ''
  ).trim();
}

function lastWorkSnapshotMatchesCurrentWorkspace(snapshot = {}) {
  const incomingScope = lastWorkSnapshotWorkspaceScope(snapshot);
  const activeScope = getCurrentLastWorkWorkspaceScope();
  if (!incomingScope || !activeScope) return false;
  if (incomingScope === activeScope) return true;

  const boundary = currentBranchDocumentMigrationBoundary(activeScope);
  if (!boundary || incomingScope !== boundary.documentScopeId) return false;
  const validation = workspacePersistenceApi().validateSnapshotIdentity(snapshot);
  if (!validation.ok) return false;
  const snapshotDocumentScope = validation.documentScopeId
    || (incomingScope.startsWith('project:') ? incomingScope : '');
  return snapshotDocumentScope === boundary.documentScopeId;
}

function lastWorkSnapshotMatchesWorkspaceScope(snapshot = {}, expectedScopeId = '') {
  const incomingScope = lastWorkSnapshotWorkspaceScope(snapshot);
  const expectedScope = String(expectedScopeId || '').trim();
  return !!incomingScope && !!expectedScope && incomingScope === expectedScope;
}

function lastWorkSnapshotMatchesTakeoverWorkspace(snapshot = {}, takeoverAuthority = null) {
  const takeoverIdentity = workspaceTakeoverHydrationAuthority.assert(takeoverAuthority);
  const incomingScope = lastWorkSnapshotWorkspaceScope(snapshot);
  if (!incomingScope) return false;
  if (incomingScope === takeoverIdentity.scopeId) return true;
  const validation = workspacePersistenceApi().validateSnapshotIdentity(snapshot);
  return validation.ok
    && validation.documentScopeId === takeoverIdentity.scopeId
    && validation.branch?.scopeId === incomingScope;
}

function workspaceHydrationScopeIsCurrent(
  scopeId,
  resetToken,
  requestIsCurrent = null,
  takeoverAuthority = null,
) {
  const expectedScope = String(scopeId || '').trim();
  if (!expectedScope) return false;
  if (takeoverAuthority) {
    const takeoverIdentity = workspaceTakeoverHydrationAuthority.assert(takeoverAuthority);
    if (expectedScope !== takeoverIdentity.scopeId) return false;
  } else if (expectedScope !== String(getCurrentLastWorkWorkspaceScope() || '').trim()) {
    return false;
  }
  if (resetToken !== undefined && resetToken !== workspaceBlankResetToken) return false;
  return typeof requestIsCurrent !== 'function' || requestIsCurrent() !== false;
}

function workspaceLockApi() {
  return typeof window !== 'undefined' ? window.__KUASANGSE_WORKSPACE_LOCK__ || null : null;
}

function currentWorkspaceAuthority() {
  return workspaceLockApi()?.snapshot?.() || null;
}

function projectAuthorityCoversCurrentBranch(scopeId, authority = currentWorkspaceAuthority()) {
  const branchScope = String(scopeId || '').trim();
  const authorityScope = String(authority?.scopeId || '').trim();
  if (!branchScope.startsWith('draft:') || !authorityScope.startsWith('project:')) return false;
  try {
    const branch = currentWorkspaceBranch(branchScope, state?.currentProjectId || '');
    return branch?.scopeId === branchScope && branch?.documentScopeId === authorityScope;
  } catch (_) {
    return false;
  }
}

const workspaceTakeoverHydrationAuthority = (() => {
  const issuedIdentities = new WeakMap();
  const activeAuthorities = new WeakSet();
  const readIdentity = value => {
    const identity = Object.freeze({
      scopeId: String(value?.scopeId || '').trim(),
      sessionId: String(value?.sessionId || '').trim(),
      leaseId: String(value?.leaseId || '').trim(),
      fencingToken: Number(value?.fencingToken),
      revision: Number(value?.revision),
    });
    if (!identity.scopeId || !identity.sessionId || !identity.leaseId
      || !Number.isInteger(identity.fencingToken) || identity.fencingToken <= 0
      || !Number.isInteger(identity.revision) || identity.revision < 0) {
      throw new Error('INVALID_TAKEOVER_HYDRATION_AUTHORITY');
    }
    return identity;
  };
  const create = accepted => {
    const identity = readIdentity(accepted);
    const authority = Object.freeze({
      identity,
      close: () => { activeAuthorities.delete(authority); },
    });
    issuedIdentities.set(authority, identity);
    activeAuthorities.add(authority);
    return authority;
  };
  const assert = authority => {
    if ((typeof authority !== 'object' && typeof authority !== 'function') || authority === null) {
      throw new Error('INVALID_TAKEOVER_HYDRATION_AUTHORITY');
    }
    const identity = issuedIdentities.get(authority);
    if (!identity) throw new Error('INVALID_TAKEOVER_HYDRATION_AUTHORITY');
    if (!activeAuthorities.has(authority)) throw new Error('STALE_TAKEOVER_HYDRATION_AUTHORITY');
    const current = currentWorkspaceAuthority();
    let observed;
    try {
      observed = readIdentity(current);
    } catch (error) {
      throw new Error('STALE_TAKEOVER_HYDRATION_AUTHORITY');
    }
    const matches = current?.mode === 'acquiring'
      && Object.keys(identity).every(field => identity[field] === observed[field]);
    if (!matches) throw new Error('STALE_TAKEOVER_HYDRATION_AUTHORITY');
    return identity;
  };
  return Object.freeze({ create, assert });
})();

function factoryLastSnapshotRecoveryWriteDecision(scopeId, authority, currentScopeId) {
  const targetScope = String(scopeId || '').trim();
  const activeScope = String(currentScopeId || '').trim();
  const authorityScope = String(authority?.scopeId || '').trim();
  const authorityMode = String(authority?.mode || '').trim();
  if (!targetScope || targetScope !== activeScope) return 'discard';
  if (authorityScope === targetScope && authorityMode === 'editing') return 'publish';
  if (authorityMode === 'editing' && projectAuthorityCoversCurrentBranch(targetScope, authority)) {
    return 'publish';
  }
  if (authorityScope === targetScope && authorityMode === 'offline-edit' && targetScope.startsWith('draft:')) {
    return 'publish';
  }
  if (authorityScope === targetScope && authorityMode === 'readonly') return 'discard';
  return 'defer';
}

function queueFactoryLastSnapshotRecoveryWrite(value) {
  const scopeId = getCurrentLastWorkWorkspaceScope();
  const decision = factoryLastSnapshotRecoveryWriteDecision(scopeId, currentWorkspaceAuthority(), scopeId);
  if (decision === 'publish') {
    pendingFactoryLastSnapshotRecoveryWrite = null;
    return writeWorkspaceRecoveryValue(FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, value);
  }
  if (decision === 'discard') {
    pendingFactoryLastSnapshotRecoveryWrite = null;
    return Promise.resolve(false);
  }
  pendingFactoryLastSnapshotRecoveryWrite = { scopeId, value };
  return Promise.resolve(false);
}

function flushPendingFactoryLastSnapshotRecoveryWrite(scopeId, authority = currentWorkspaceAuthority()) {
  const pending = pendingFactoryLastSnapshotRecoveryWrite;
  if (!pending) return false;
  const currentScopeId = getCurrentLastWorkWorkspaceScope();
  const decision = factoryLastSnapshotRecoveryWriteDecision(pending.scopeId, authority, currentScopeId);
  if (decision === 'defer') return false;
  pendingFactoryLastSnapshotRecoveryWrite = null;
  if (decision !== 'publish' || pending.scopeId !== scopeId) return false;
  writeWorkspaceRecoveryValue(FACTORY_LAST_SNAPSHOT_RECOVERY_KEY, pending.value);
  return true;
}

function workspaceAuthorityIsReadOnly() {
  const authority = currentWorkspaceAuthority();
  const currentScopeId = getCurrentLastWorkWorkspaceScope();
  const targetsCurrentWorkspace = authority?.scopeId === currentScopeId;
  if (!targetsCurrentWorkspace || !String(authority?.scopeId || '').startsWith('project:')) return false;
  return authority.mode !== 'editing';
}

function workspaceDocumentAuthorityIsReadOnly() {
  const authority = currentWorkspaceAuthority();
  const currentScopeId = getCurrentLastWorkWorkspaceScope();
  const targetsCurrentDocument = authority?.scopeId === currentScopeId
    || projectAuthorityCoversCurrentBranch(currentScopeId, authority);
  if (!targetsCurrentDocument || !String(authority?.scopeId || '').startsWith('project:')) return false;
  return authority.mode !== 'editing';
}

function workspaceAuthorityOwnerLabel() {
  const project = String(
    state.currentProjectName || state.factory?.product?.productName || '이 브라우저 창',
  ).trim();
  const sessionId = String(currentWorkspaceAuthority()?.sessionId || '').trim();
  const suffix = sessionId ? sessionId.slice(-4).toUpperCase() : 'LOCAL';
  return `${project} · 창 ${suffix}`;
}

async function ensureWorkspaceEditAuthority(scopeId = getCurrentLastWorkWorkspaceScope(), options = {}) {
  const lock = workspaceLockApi();
  if (!lock) return null;
  const scope = workspacePersistenceApi().normalizeWorkspaceScope(scopeId);
  const current = lock.snapshot();
  if (options.force !== true
    && ['editing', 'readonly', 'acquiring'].includes(current?.mode)
    && projectAuthorityCoversCurrentBranch(scope, current)) {
    flushPendingFactoryLastSnapshotRecoveryWrite(scope, current);
    return current;
  }
  if (current.scopeId === scope && ['released', 'readonly'].includes(current.mode)
    && options.force !== true) {
    flushPendingFactoryLastSnapshotRecoveryWrite(scope, current);
    return current;
  }
  if (current.scopeId === scope && ['editing', 'offline-edit'].includes(current.mode) && options.force !== true) {
    flushPendingFactoryLastSnapshotRecoveryWrite(scope, current);
    return current;
  }
  if (current.mode === 'editing' && current.scopeId && current.scopeId !== scope) {
    await lock.release();
  }
  const acquired = await lock.acquire({
    scopeId: scope,
    ownerId: workspaceAuthorityOwnerLabel(),
    confirmedTakeover: options.confirmedTakeover === true,
  });
  flushPendingFactoryLastSnapshotRecoveryWrite(scope, acquired);
  return acquired;
}

function workspaceRevisionApi() {
  return typeof window !== 'undefined' ? window.__KUASANGSE_WORKSPACE_REVISION__ || null : null;
}

function workspaceSnapshotRevision(snapshot = {}) {
  return snapshot?.workspaceRevision
    || snapshot?.assets?.workspaceRevision
    || snapshot?.lightweight?.workspaceRevision
    || snapshot?.factory?.workspaceRevision
    || null;
}

function currentWorkspaceRevision(scopeId = getCurrentLastWorkWorkspaceScope()) {
  const api = workspaceRevisionApi();
  const persisted = api?.current?.(scopeId) || null;
  const live = typeof factoryAppStateReady !== 'undefined' && factoryAppStateReady === true
    ? (state?.workspaceRevision || state?.factory?.workspaceRevision || null)
    : null;
  if (!live || live.scopeId !== scopeId) return persisted;
  if (!persisted || api?.compare?.(live, persisted) > 0) return live;
  return persisted;
}

function workspaceRevisionAllowsSnapshot(snapshot = {}, options = {}) {
  const api = workspaceRevisionApi();
  if (!api) return true;
  const scopeId = String(options.scopeId || lastWorkSnapshotWorkspaceScope(snapshot) || '').trim();
  if (!scopeId) return false;
  const candidate = workspaceSnapshotRevision(snapshot);
  const current = api.current(scopeId);
  if (!candidate) return !current;
  return api.shouldApply(candidate, scopeId, { allowEqual: options.allowEqual === true });
}

function observeWorkspaceRevisionSnapshot(snapshot = {}, scopeId = lastWorkSnapshotWorkspaceScope(snapshot)) {
  const revision = workspaceSnapshotRevision(snapshot);
  if (!revision || !scopeId) return null;
  return workspaceRevisionApi()?.observe?.(revision, scopeId) || revision;
}

function nextCurrentWorkspaceRevision(scopeId = getCurrentLastWorkWorkspaceScope()) {
  const revision = workspaceRevisionApi()?.next?.(scopeId) || null;
  return revision;
}

function commitCurrentWorkspaceRevision(revision) {
  if (!revision) return null;
  const committed = workspaceRevisionApi()?.observe?.(revision, revision.scopeId) || revision;
  state.workspaceRevision = committed;
  return committed;
}

function scopedServerLastWorkPath(path = '/api/last-work') {
  const separator = String(path || '').includes('?') ? '&' : '?';
  return `${path}${separator}workspaceId=${encodeURIComponent(getCurrentLastWorkWorkspaceScope())}`;
}

function lastWorkBootstrapWorkspaceKind(options = {}, projectId = '') {
  const requested = String(options.workspaceKind || '').trim();
  if (requested) return requested;
  if (projectId) return 'project';
  if (workspaceBlankResetInProgress || options.allowBlankResetCheckpoint === true) return 'blank-reset';
  try {
    const factory = typeof factoryRuntimeReadFactory === 'function'
      ? factoryRuntimeReadFactory()
      : state?.factory;
    const product = factory?.product && typeof factory.product === 'object' ? factory.product : {};
    const hasVisibleImage = !!(
      state?.imageBase64
      || (state?.imagePreview && state.imagePreview !== IMAGE_STORED_MARKER)
      || product.imageBase64
      || (product.imagePreview && product.imagePreview !== IMAGE_STORED_MARKER)
      || product.hasImage
    );
    return (String(state?.productName || product.productName || '').trim() || hasVisibleImage)
      ? 'content-draft'
      : 'legacy-draft';
  } catch (_) {
    return 'legacy-draft';
  }
}

function saveLastWorkBootstrap(options = {}) {
  const documentFence = options.documentFence || null;
  if (documentFence && !workspaceDocumentFenceIsCurrent(documentFence)) {
    return options.awaitWrite === true
      ? Promise.reject(new Error('현재 작업 포인터가 변경되어 bootstrap 저장을 중지했습니다.'))
      : null;
  }
  const scopeId = String(options.scopeId || getCurrentLastWorkWorkspaceScope()).trim();
  const projectId = String(options.currentProjectId ?? state.currentProjectId ?? '').replace(/^project:/i, '').trim();
  const bootstrap = {
    workspaceScope: { id: scopeId },
    workspaceRevision: currentWorkspaceRevision(scopeId),
    workspaceBranch: scopeId.startsWith('draft:') ? currentWorkspaceBranch(scopeId, projectId) : null,
    workspaceKind: lastWorkBootstrapWorkspaceKind(options, projectId),
    currentProjectId: projectId,
    currentProjectName: options.currentProjectName ?? state.currentProjectName ?? '',
    currentProjectCreatedAt: options.currentProjectCreatedAt ?? state.currentProjectCreatedAt ?? null,
    step: options.step || state.step || 'upload',
    savedAt: Date.now(),
  };
  const pending = Promise.resolve().then(async () => {
    if (documentFence && !workspaceDocumentFenceIsCurrent(documentFence)) return null;
    await workspaceSessionSetItem(LAST_WORK_BOOTSTRAP_STORAGE_KEY, JSON.stringify(bootstrap));
    if (documentFence && !workspaceDocumentFenceIsCurrent(documentFence)) return null;
    return bootstrap;
  }).catch(error => {
    console.warn('현재 작업 bootstrap 저장 실패:', error);
    return null;
  });
  pendingLastWorkBootstrapWrites.add(pending);
  void pending.finally(() => pendingLastWorkBootstrapWrites.delete(pending));
  if (options.awaitWrite === true) {
    return pending.then(saved => {
      if (!saved) throw new Error(options.errorMessage || '현재 작업 포인터를 저장하지 못했습니다. 새로고침하지 말고 다시 시도해주세요.');
      const persisted = loadLastWorkBootstrap();
      if (lastWorkSnapshotWorkspaceScope(persisted) !== bootstrap.workspaceScope.id) {
        throw new Error(options.errorMessage || '현재 작업 포인터를 검증하지 못했습니다. 새로고침하지 말고 다시 시도해주세요.');
      }
      return saved;
    });
  }
  return bootstrap;
}

async function settleLastWorkBootstrapWrites() {
  while (pendingLastWorkBootstrapWrites.size) {
    await Promise.allSettled([...pendingLastWorkBootstrapWrites]);
  }
}

function loadLastWorkBootstrap() {
  try {
    const saved = JSON.parse(workspaceSessionGetItem(LAST_WORK_BOOTSTRAP_STORAGE_KEY) || 'null');
    const workspaceScope = lastWorkSnapshotWorkspaceScope(saved);
    if (!workspaceScope) return null;
    const normalized = { ...saved, workspaceScope: { id: workspaceScope } };
    if (!workspaceRevisionAllowsSnapshot(normalized, { scopeId: workspaceScope, allowEqual: true })) return null;
    return normalized;
  } catch (e) {
    return null;
  }
}

const LAST_WORK_REQUIRED_FIELD_ALIASES = Object.freeze({
  size: ['size', 'dimensions', 'dimension', 'jsize'],
  width_mm: ['width_mm', 'width', 'product_width'],
  depth_mm: ['depth_mm', 'depth', 'product_depth', 'height', 'product_height'],
  weight: ['weight', 'product_weight', 'gross_weight'],
  material: ['material'],
  usage: ['usage', 'use_case', 'purpose'],
});

function lastWorkRequiredFieldText(entry) {
  if (typeof entry === 'string' || typeof entry === 'number') return String(entry).trim();
  if (!entry || typeof entry !== 'object') return '';
  for (const key of ['manualValue', 'value', 'confirmedValue', 'text']) {
    const value = entry[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}

function lastWorkRequiredFieldValue(factory = {}, manualValues = {}, fieldId = '') {
  const aliases = LAST_WORK_REQUIRED_FIELD_ALIASES[fieldId] || [fieldId];
  const product = factory?.product && typeof factory.product === 'object' ? factory.product : {};
  const sources = [
    product.dbFieldSettings,
    factory?.automation?.fieldReview,
    manualValues,
    factory?.productInfoManualValues,
    product.manualValues,
  ];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const alias of aliases) {
      const value = lastWorkRequiredFieldText(source[alias]);
      if (value) return value;
    }
  }
  return '';
}

function lastWorkRequiredFieldRestoreNeeded(snapshot = {}, currentFactory = {}, currentManualValues = {}) {
  const assets = snapshot?.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  const incomingFactory = assets?.factory && typeof assets.factory === 'object' ? assets.factory : {};
  return Object.keys(LAST_WORK_REQUIRED_FIELD_ALIASES).some(fieldId => {
    const incomingValue = lastWorkRequiredFieldValue(incomingFactory, assets?.productInfoManualValues || {}, fieldId);
    const currentValue = lastWorkRequiredFieldValue(currentFactory, currentManualValues, fieldId);
    return !!incomingValue && !currentValue;
  });
}

function lastWorkOptionLabelsRestoreNeeded(snapshot = {}, currentOptionSorter = {}) {
  const assets = snapshot?.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  const rawValues = assets?.factory?.product?.finalDb?.option_values;
  const labels = (Array.isArray(rawValues)
    ? rawValues
    : (typeof rawValues === 'string' ? rawValues.split(/[,;\n]+/) : []))
    .map(value => String(value || '').trim())
    .filter(Boolean);
  if (!labels.length) return false;
  const slots = Array.isArray(currentOptionSorter?.slots) ? currentOptionSorter.slots : [];
  if (!slots.length) return true;
  const allGenericNames = slots.every(slot => optionSorterSlotNameIsGeneric(slot?.name));
  const allCanonicalNames = slots.length === labels.length
    && slots.every((slot, index) => String(slot?.name || '').trim() === labels[index]);
  return allGenericNames && !allCanonicalNames;
}

function optionSorterSlotNameIsGeneric(value = '') {
  return /^\d+(?:\s*번)?$/.test(String(value || '').trim());
}

function optionSorterDurableProgress(optionSorter = {}) {
  const slots = Array.isArray(optionSorter?.slots) ? optionSorter.slots : [];
  const optionResults = Array.isArray(optionSorter?.optionResults) ? optionSorter.optionResults : [];
  return {
    slots: slots.length,
    namedSlots: slots.filter(slot => !optionSorterSlotNameIsGeneric(slot?.name)).length,
    slotImageAssignments: new Set(slots.flatMap(slot => Array.isArray(slot?.imgIds) ? slot.imgIds : []).map(String).filter(Boolean)).size,
    images: Array.isArray(optionSorter?.images) ? optionSorter.images.length : 0,
    optionResults: optionResults.length,
    displayableOptionResults: optionResults.filter(result => result?.image || result?.imageUrl || result?.archiveId || result?.resultAssetId || (Array.isArray(result?.splitImages) && result.splitImages.some(item => item?.image || item?.imageUrl || item?.archiveId))).length,
  };
}

function optionSorterSnapshotIsMoreComplete(current, incoming) {
  const currentProgress = optionSorterDurableProgress(current);
  const incomingProgress = optionSorterDurableProgress(incoming);
  const keys = Object.keys(currentProgress);
  return keys.every(key => currentProgress[key] >= incomingProgress[key])
    && keys.some(key => currentProgress[key] > incomingProgress[key]);
}

function lastWorkCompMarketScore(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const assets = snapshot.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  const compPage = assets.compPage && typeof assets.compPage === 'object' ? assets.compPage : {};
  const market = compPage.marketScrape && typeof compPage.marketScrape === 'object'
    ? compPage.marketScrape
    : {};
  const groupedCount = groups => Object.values(groups && typeof groups === 'object' ? groups : {})
    .reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0);
  const candidateCount = Math.max(
    Array.isArray(market.vmResults) ? market.vmResults.length : 0,
    Array.isArray(market.results) ? market.results.length : 0,
    Array.isArray(market.localResults) ? market.localResults.length : 0,
    groupedCount(market.groupedResults),
    groupedCount(market.vmGroupedResults),
    groupedCount(market.localGroupedResults),
  );
  const selectedCount = Array.isArray(market.selectedIds) ? market.selectedIds.length : 0;
  const selectedImageCount = Array.isArray(market.selectedImageIds) ? market.selectedImageIds.length : 0;
  const scrapedImageCount = Array.isArray(market.scrapedImages) ? market.scrapedImages.length : 0;
  const detailCount = market.detailResults && typeof market.detailResults === 'object'
    ? Object.keys(market.detailResults).length
    : 0;
  const hasAnalysis = compPage.analysisResult && typeof compPage.analysisResult === 'object'
    && Object.keys(compPage.analysisResult).length > 0;
  const hasSectionPlan = compPage.sectionPlan && typeof compPage.sectionPlan === 'object'
    && Object.keys(compPage.sectionPlan).length > 0;
  return candidateCount
    + selectedCount * 2
    + selectedImageCount * 2
    + scrapedImageCount
    + detailCount
    + (hasAnalysis ? 10 : 0)
    + (hasSectionPlan ? 4 : 0);
}

function lastWorkSnapshotScore(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const lightweight = snapshot.lightweight && typeof snapshot.lightweight === 'object' ? snapshot.lightweight : {};
  const assets = snapshot.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  const factory = assets.factory && typeof assets.factory === 'object' ? assets.factory : {};
  const product = factory.product && typeof factory.product === 'object' ? factory.product : {};
  let score = 0;
  if (String(lightweight.productName || assets.productName || product.productName || '').trim()) score += 3;
  if (assets.imagePreview || assets.imageBase64 || product.imagePreview || product.imageBase64) score += 3;
  if (Array.isArray(assets.analysisImages)) score += Math.min(5, assets.analysisImages.length);
  if (Array.isArray(product.inputImages)) score += Math.min(5, product.inputImages.length);
  const sectionContents = assets.sectionContents && typeof assets.sectionContents === 'object'
    ? assets.sectionContents
    : (lightweight.sectionContents && typeof lightweight.sectionContents === 'object' ? lightweight.sectionContents : {});
  const sectionContentCount = Object.values(sectionContents).filter(sectionContentLooksUsable).length;
  score += Math.min(20, sectionContentCount);
  const sectionImages = assets.sectionImages && typeof assets.sectionImages === 'object' ? assets.sectionImages : {};
  const sectionImageCount = Object.values(sectionImages).filter(value => displayableImageSrc(value)).length;
  const sectionImageMarkerCount = Object.values(sectionImages).filter(value => value === IMAGE_STORED_MARKER || value === '__stored_in_indexeddb__').length;
  score += Math.min(20, sectionImageCount * 3);
  score += Math.min(6, sectionImageMarkerCount);
  score += Math.min(90, Math.round(sectionImagesQualityScore(sectionImages)));
  if (Array.isArray(assets.detailImageBlocks)) {
    score += Math.min(10, assets.detailImageBlocks.filter(block => displayableImageSrc(block?.dataUrl)).length * 2);
  }
  if (assets.sectionVariants && typeof assets.sectionVariants === 'object') {
    score += Math.min(10, Object.values(assets.sectionVariants).filter(list => Array.isArray(list) && list.some(variant => sectionContentLooksUsable(variant?.content))).length);
  }
  if (product.confirmedDb && typeof product.confirmedDb === 'object' && Object.keys(product.confirmedDb).length) score += 4;
  if (product.finalDb && typeof product.finalDb === 'object' && Object.keys(product.finalDb).length) score += 3;
  if (product.cafe24Product && typeof product.cafe24Product === 'object' && Object.keys(product.cafe24Product).length) score += 4;
  if (Array.isArray(product.dbCandidates)) score += Math.min(5, product.dbCandidates.length);
  if (Array.isArray(product.cafe24Candidates)) score += Math.min(5, product.cafe24Candidates.length);
  const cafe24FieldView = assets.cafe24FieldViewStorage || factory.cafe24FieldView || {};
  if (Array.isArray(cafe24FieldView.hiddenFieldIds)) score += Math.min(4, cafe24FieldView.hiddenFieldIds.length);
  if (Array.isArray(cafe24FieldView.presets)) score += Math.min(6, cafe24FieldView.presets.length * 2);
  if (Number(cafe24FieldView.defaultSavedAt)) score += 1;
  const cuts = assets.cuts && typeof assets.cuts === 'object' ? assets.cuts : {};
  if (Array.isArray(cuts.prompts)) score += Math.min(6, cuts.prompts.length);
  if (Array.isArray(cuts.results)) score += Math.min(8, cuts.results.length);
  score += Math.min(12, persistedCutResultCount(cuts) * 2);
  const compPage = assets.compPage && typeof assets.compPage === 'object' ? assets.compPage : {};
  if (compPage.analysisResult && typeof compPage.analysisResult === 'object') score += 10;
  if (compPage.sectionPlan && typeof compPage.sectionPlan === 'object') score += 4;
  if (Array.isArray(compPage.analyzeLogs)) score += Math.min(4, compPage.analyzeLogs.length);
  const marketScrape = compPage.marketScrape && typeof compPage.marketScrape === 'object' ? compPage.marketScrape : {};
  if (Array.isArray(marketScrape.scrapedImages)) score += Math.min(6, marketScrape.scrapedImages.length);
  if (Array.isArray(marketScrape.selectedImageIds)) score += Math.min(4, marketScrape.selectedImageIds.length);
  const optionSorter = assets.optionSorter && typeof assets.optionSorter === 'object' ? assets.optionSorter : {};
  if (Array.isArray(optionSorter.images)) score += Math.min(8, optionSorter.images.length);
  if (Array.isArray(optionSorter.optionResults)) score += Math.min(8, optionSorter.optionResults.length);
  return score;
}

function getCurrentLastWorkScore() {
  const committedFactory = typeof factoryRuntimeReadCommittedFactory === 'function'
    ? factoryRuntimeReadCommittedFactory()
    : state?.factory || {};
  return lastWorkSnapshotScore({
    lightweight: lastLightweightSessionPayload || loadWorkspaceSessionJson('pdp_session', {}),
    assets: {
      productName: state?.productName || '',
      imagePreview: state?.imagePreview || '',
      imageBase64: state?.imageBase64 || '',
      analysisImages: state?.analysisImages || [],
      sectionContents: state?.sectionContents || {},
      sectionImages: state?.sectionImages || {},
      detailImageBlocks: state?.detailImageBlocks || [],
      sectionVariants: state?.sectionVariants || {},
      factory: committedFactory,
      cafe24FieldViewStorage: getCafe24FieldViewStorageSnapshot(),
      cuts: state?.cuts || {},
      optionSorter: state?.optionSorter || {},
    },
  });
}

function getCurrentLastWorkSavedAt() {
  const stamps = [
    serverLastWorkLastSavedAt,
    state?.factory?.lastSavedAt,
    lastLightweightSessionPayload?.savedAt,
  ];
  try {
    const raw = workspaceSessionGetItem('pdp_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      stamps.push(parsed?.savedAt, parsed?.factory?.lastSavedAt);
    }
  } catch(e) {}
  return Math.max(0, ...stamps.map(v => Number(v) || 0));
}

function lastWorkCompAnalysisTime(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return 0;
  const assets = snapshot.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  const lightweight = snapshot.lightweight && typeof snapshot.lightweight === 'object'
    ? snapshot.lightweight
    : null;
  const pages = [assets?.compPage, lightweight?.compPage].filter(page => page && typeof page === 'object');
  return Math.max(0, ...pages.map(page => Number(page.analysisResult?.analyzedAt || page.savedAt || 0) || 0));
}

function getCurrentCompAnalysisTime() {
  return Number(state?.compPage?.analysisResult?.analyzedAt || 0) || 0;
}

/**
 * 보관함(local-archive) 쓰기가 아직 날아가는 중인가.
 *
 * FACTORY_LOCAL_ARCHIVE_PENDING 은 뒤에 오는 파일에서 const 로 선언된다.
 * let/const 는 선언 전 접근이면 typeof 조차 ReferenceError 를 던지므로(TDZ)
 * 반드시 try/catch 로 감싼다 - 2026-08-30 에 이걸로 부팅 복원이 끊겨 생성물 10개를 잃었다.
 */
function factoryArchiveWritesInFlight() {
  try { return FACTORY_LOCAL_ARCHIVE_PENDING.size > 0; } catch (_) { return false; }
}

const DEFERRED_BRANCH_RESTORE_INTERVAL_MS = 400;
const DEFERRED_BRANCH_RESTORE_MAX_WAIT_MS = 20000;
let deferredBranchAuthorityRestoreTimer = null;

/** 보관함 쓰기가 끝나면 그때 이 탭의 브랜치 권한을 되돌린다. 건너뛰는 것이 아니라 미루는 것이다. */
function scheduleDeferredBranchAuthorityRestore(branchScope, documentFence) {
  if (deferredBranchAuthorityRestoreTimer) return;
  const startedAt = Date.now();
  const attempt = async () => {
    deferredBranchAuthorityRestoreTimer = null;
    const waitedTooLong = Date.now() - startedAt >= DEFERRED_BRANCH_RESTORE_MAX_WAIT_MS;
    if (!waitedTooLong && factoryArchiveWritesInFlight()) {
      deferredBranchAuthorityRestoreTimer = setTimeout(attempt, DEFERRED_BRANCH_RESTORE_INTERVAL_MS);
      return;
    }
    // 그 사이 다른 작업으로 옮겨갔으면 되돌릴 것이 없다.
    if (!workspaceDocumentFenceIsCurrent(documentFence)) return;
    if (getCurrentLastWorkWorkspaceScope() !== branchScope) return;
    try {
      await ensureWorkspaceEditAuthority(branchScope, { force: true });
    } catch (error) {
      console.warn('Deferred tab branch authority restore failed:', error);
    }
  };
  deferredBranchAuthorityRestoreTimer = setTimeout(attempt, DEFERRED_BRANCH_RESTORE_INTERVAL_MS);
}

// ── 저장 전(draft:) 작업의 복구용 사본 ────────────────────────────
// 정상 저장(/api/last-work)은 편집권을 검증하고 draft 는 통과할 수 없다.
// 이 사본은 그 검증을 거치지 않으므로 **읽기 전용 참고본**으로만 쓴다(자동 복원 금지).
const DRAFT_RECOVERY_MIN_INTERVAL_MS = 20000;
let draftRecoveryLastSentAt = 0;
let draftRecoverySending = false;

function saveDraftRecoverySnapshot(scopeId, reason = '') {
  if (!String(scopeId || '').startsWith('draft:')) return false;
  if (draftRecoverySending) return false;
  const now = Date.now();
  // 자동저장은 자주 돈다. 매번 보내면 디스크와 네트워크를 먹는다.
  if (now - draftRecoveryLastSentAt < DRAFT_RECOVERY_MIN_INTERVAL_MS) return false;
  let snapshot = null;
  try {
    snapshot = buildServerLastWorkSnapshot(reason || 'draft-recovery');
  } catch (error) {
    console.warn('draft recovery snapshot build failed:', error);
    return false;
  }
  if (!snapshot || typeof snapshot !== 'object') return false;
  draftRecoverySending = true;
  draftRecoveryLastSentAt = now;
  const body = JSON.stringify({
    scopeId,
    reason: String(reason || ''),
    productName: String(state?.productName || snapshot?.productName || ''),
    snapshot,
  });
  fetch(`${kuasangseBackendBaseUrl()}/api/draft-recovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  }).then(response => {
    // 실패해도 사용자의 일을 막지 않는다. 이건 그물이지 저장이 아니다.
    if (!response.ok) console.warn(`draft recovery save rejected: HTTP ${response.status}`);
  }).catch(error => {
    console.warn('draft recovery save failed:', error);
  }).finally(() => {
    draftRecoverySending = false;
  });
  return true;
}

function buildServerLastWorkSnapshot(reason = 'auto', options) {
  options = options || {};
  const documentScope = getCurrentDocumentWorkspaceScope();
  const workspaceScope = documentScope || getCurrentLastWorkWorkspaceScope();
  const documentSnapshot = !!documentScope;
  const canonicalFactory = options.factorySnapshot
    || (typeof factoryRuntimeReadCommittedFactory === 'function'
      ? factoryRuntimeReadCommittedFactory()
      : state.factory)
    || {};
  const targetName = canonicalFactory.product?.productName || state.productName || '';
  const assets = sanitizeLastWorkPayloadProductScope(currentSessionAssetsPayload({
    includeImages: false,
    preserveSelectedFactoryImages: true,
    preserveRecentWorkingImages: true,
    preserveSectionImages: true,
    factorySnapshot: canonicalFactory,
    scopeId: workspaceScope,
    documentSnapshot,
  }), {
    targetName,
  });
  const lightweight = sanitizeLastWorkPayloadProductScope(buildLightweightSessionPayload({
    step: state.step,
    currentProjectId: state.currentProjectId,
    currentProjectName: state.currentProjectName,
    currentProjectCreatedAt: state.currentProjectCreatedAt,
    workspaceScope: { id: workspaceScope },
    workspaceRevision: currentWorkspaceRevision(workspaceScope),
    workspaceBranch: documentSnapshot ? null : currentWorkspaceBranch(workspaceScope, state.currentProjectId),
    analysis: state.analysis,
    competitorData: state.competitorData,
    sectionContents: state.sectionContents,
    imagePreview: state.imagePreview,
    imageMime: state.imageMime,
    analysisImages: state.analysisImages,
    productName: state.productName,
    analysisTimestamp: state.analysisTimestamp,
    sectionVariants: state.sectionVariants,
    currentSectionVariantIds: state.currentSectionVariantIds,
    sectionGenerationModes: state.sectionGenerationModes,
    sectionBasisModes: state.sectionBasisModes,
    sectionAssembly: state.sectionAssembly,
    sectionOrder: state.sectionOrder,
    hiddenSectionIds: state.hiddenSectionIds,
    customSections: state.customSections,
    cuts: state.cuts,
    optionSorter: state.optionSorter,
    factory: canonicalFactory,
    compPage: state.compPage,
  }), {
    targetName,
  });
  lastLightweightSessionPayload = lightweight;
  const savedAt = Date.now();
  return {
    id: 'current',
    workspaceId: workspaceScope,
    workspaceScope: { id: workspaceScope },
    workspaceRevision: currentWorkspaceRevision(workspaceScope),
    workspaceBranch: documentSnapshot ? null : currentWorkspaceBranch(workspaceScope, state.currentProjectId),
    savedAt,
    reason,
    origin: location.origin,
    href: location.href,
    userAgent: navigator.userAgent,
    lightweight,
    assets,
    productImageBackup: compactProductImageBackupPayload(),
  };
}

function workspaceCommitMetadata(scopeId, prefix, revision = currentWorkspaceRevision(scopeId)) {
  const authority = currentWorkspaceAuthority();
  const managed = String(scopeId).startsWith('project:') && authority?.scopeId === scopeId;
  const usableRevision = managed
    ? {
      scopeId,
      counter: (Number(authority.revision) || 0) + 1,
      updatedAt: Date.now(),
      writerId: String(authority.sessionId || 'classic-runtime'),
    }
    : (revision && Number(revision.counter) > 0
      ? revision
      : { scopeId, counter: 1, updatedAt: Date.now(), writerId: 'classic-runtime' });
  return workspacePersistenceApi().createMetadata({
    scopeId,
    revision: usableRevision,
    fencingToken: managed ? authority.fencingToken : '',
    leaseId: managed ? authority.leaseId : '',
    operationId: uid(prefix || 'workspace-save'),
  });
}

function serverLastWorkFailureDelayMs(failureCount = 1) {
  const exponent = Math.max(0, Math.floor(Number(failureCount) || 1) - 1);
  return Math.min(SERVER_LAST_WORK_RETRY_MAX_MS, SERVER_LAST_WORK_RETRY_BASE_MS * (2 ** exponent));
}

async function saveServerLastWorkSnapshot(reason = 'auto', options = {}) {
  const documentFence = captureWorkspaceDocumentFence(options);
  const activeBranchScope = documentFence.scopeId;
  if (!workspaceDocumentFenceIsCurrent(documentFence)) return false;
  if (workspaceScopeTransitionState.inProgress) return false;
  const forceRequested = options.force === true;
  if (!serverLastWorkHydrated && !forceRequested) return false;
  const retryWait = Math.max(0, serverLastWorkRetryAfter - Date.now());
  if (!forceRequested && retryWait > 0) {
    scheduleServerLastWorkSave(reason, retryWait);
    return false;
  }
  if (serverLastWorkSavePromise) {
    serverLastWorkSaveRequestedAgain = true;
    if (forceRequested) serverLastWorkForceSaveRequested = true;
    if (options.factorySnapshot) {
      serverLastWorkFactorySnapshotRequested = options.factorySnapshot;
    }
    return serverLastWorkSavePromise;
  }
  serverLastWorkForceSaveRequested = forceRequested;
  serverLastWorkFactorySnapshotRequested = options.factorySnapshot || null;
  let restoreBranchAuthority = false;
  serverLastWorkSavePromise = (async () => {
    do {
      serverLastWorkSaveRequestedAgain = false;
      const forceSave = serverLastWorkForceSaveRequested;
      serverLastWorkForceSaveRequested = false;
      const requestedFactorySnapshot = serverLastWorkFactorySnapshotRequested;
      serverLastWorkFactorySnapshotRequested = null;
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return false;
      const documentScopeId = getCurrentDocumentWorkspaceScope();
      const scopeId = documentScopeId || documentFence.scopeId;
      restoreBranchAuthority = restoreBranchAuthority
        || (scopeId !== activeBranchScope && activeBranchScope.startsWith('draft:'));
      if (!scopeId.startsWith('project:')) {
        // 저장 버튼을 누르기 전(draft:) 작업은 정상 저장 경로를 탈 수 없다 -
        // 서버의 편집권(lease) 검증이 project: 스코프에만 걸려 있어 통과 자체가 불가능하다.
        // 그렇다고 여기서 그냥 돌아서면 사본이 브라우저 안에 딱 하나만 남는다.
        // 실측 2026-08-31: 주인님이 DB/Cafe24 확정을 잃었을 때 되살릴 사본이 하나도 없었다.
        // 그래서 편집권을 거치지 않는 **복구용 사본**을 따로 남긴다.
        // 자동으로 복원하지 않는다 - 사람이 되살리기를 누를 때만 쓰는 참고본이다.
        serverLastWorkFailureCount = 0;
        serverLastWorkRetryAfter = 0;
        saveDraftRecoverySnapshot(scopeId, reason);
        return false;
      }
      const authority = await ensureWorkspaceEditAuthority(scopeId);
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return false;
      if (documentScopeId && getCurrentDocumentWorkspaceScope() !== documentScopeId) return false;
      if (scopeId.startsWith('project:') && authority?.mode !== 'editing') {
        throw new Error('현재 작업의 편집권이 없어 서버 저장을 중지했습니다.');
      }
      const snapshot = buildServerLastWorkSnapshot(reason, {
        factorySnapshot: requestedFactorySnapshot || options.factorySnapshot,
      });
      const sessionAssets = await sessionAssetsForAuthoritativeCommit();
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return false;
      const score = lastWorkSnapshotScore(snapshot);
      if (score <= 1 && serverLastWorkLastSavedAt && !forceSave) return;
      const contentVersion = Number(state.contentVersion || 0);
      const result = await workspacePersistenceApi().commit({
        scopeId,
        snapshot,
        metadata: workspaceCommitMetadata(scopeId, 'server-last-work', workspaceSnapshotRevision(snapshot)),
        rebaseRevision: true,
        replicas: ['server'],
        context: {
          server: { bases: getServerLastWorkBases(), force: forceSave },
          indexeddb: { sessionAssets },
        },
        isCurrent: () => workspaceDocumentFenceIsCurrent(documentFence)
          && (!documentScopeId || getCurrentDocumentWorkspaceScope() === documentScopeId)
          && Number(state.contentVersion || 0) === contentVersion,
      });
      if (result.stale) return false;
      if (!result.accepted) throw new Error(result.failures?.[0]?.message || '권위 저장소 저장 실패');
      if (result.partial) throw new Error(result.failures?.[0]?.message || '서버 복제본 저장 실패');
      serverLastWorkFailureCount = 0;
      serverLastWorkRetryAfter = 0;
      if (result.protectedNoOp) continue;
      if (result.clean) {
        serverLastWorkLastSavedAt = Number(snapshot.savedAt) || Date.now();
      }
    } while (serverLastWorkSaveRequestedAgain);
  })().catch(e => {
    serverLastWorkFailureCount += 1;
    const retryDelay = serverLastWorkFailureDelayMs(serverLastWorkFailureCount);
    serverLastWorkRetryAfter = Date.now() + retryDelay;
    serverLastWorkSaveRequestedAgain = false;
    serverLastWorkForceSaveRequested = false;
    serverLastWorkFactorySnapshotRequested = null;
    console.warn(`Server last-work save failed; retrying after ${Math.round(retryDelay / 1000)}s:`, e);
    scheduleServerLastWorkSave(reason, retryDelay, options);
    return false;
  }).finally(async () => {
    try {
      if (restoreBranchAuthority
        && workspaceDocumentFenceIsCurrent(documentFence)
        && getCurrentLastWorkWorkspaceScope() === activeBranchScope) {
        // 보관함 쓰기가 날아가는 중이면 편집권을 지금 되돌리지 않는다.
        //
        // 실측 2026-08-31 (백엔드 접속 로그): 788행 release 200 -> 789행 assets 409.
        // 저장이 끝날 때마다 여기서 프로젝트 편집권을 놓고 브랜치 권한으로 돌아가는데,
        // 생성 구간에는 저장이 잦아 8초에 15번 놨다 잡는다. 그 틈에 이미 떠난
        // POST /api/local-archive/assets 가 닿으면 서버 lease 가 이미 없어 409 가 된다
        // (화면 문구: "새 생성 실패: 컷 1 생성 실패: ... archive mutation rejected by server (409)").
        // 되돌리기를 건너뛰는 게 아니라 **미룬다** - 쓰기가 끝나면 그때 되돌린다.
        if (factoryArchiveWritesInFlight()) {
          scheduleDeferredBranchAuthorityRestore(activeBranchScope, documentFence);
        } else {
          await ensureWorkspaceEditAuthority(activeBranchScope, { force: true });
        }
      }
    } catch (error) {
      console.warn('Server last-work save could not restore this tab branch:', error);
    } finally {
      serverLastWorkSavePromise = null;
    }
  });
  return serverLastWorkSavePromise;
}

function scheduleServerLastWorkSave(reason = 'auto', delay = 3200, options) {
  if (workspaceScopeTransitionState.inProgress) return;
  if (!serverLastWorkHydrated) return;
  if (serverLastWorkHydrating) return;
  const serverSaveOptions = options && typeof options === 'object' ? options : {};
  if (serverLastWorkSaveTimer) clearTimeout(serverLastWorkSaveTimer);
  const cooldownDelay = Math.max(0, serverLastWorkRetryAfter - Date.now());
  const scheduledDelay = Math.max(Math.max(0, Number(delay) || 0), cooldownDelay);
  serverLastWorkSaveTimer = setTimeout(() => {
    serverLastWorkSaveTimer = null;
    saveServerLastWorkSnapshot(reason, serverSaveOptions).catch(() => {});
  }, scheduledDelay);
}

function persistRecoveredAuxiliaryLastWorkKeys(assets = {}) {
  const scopedAssets = sanitizeLastWorkPayloadProductScope(assets, {
    mutate: true,
    targetName: state.factory?.product?.productName || state.productName || lastWorkPayloadProductName(assets),
  });
  const restoredCafe24FieldView = restoreCafe24FieldViewFromLastWork(scopedAssets);
  try {
    if (state.factory && typeof saveFactoryLastSnapshot === 'function') {
      saveFactoryLastSnapshot(state.factory);
    }
  } catch(e) {}
  const cuts = state.cuts || scopedAssets.cuts || {};
  const promptKey = typeof CUTS_PROMPTS_STORAGE_KEY !== 'undefined' ? CUTS_PROMPTS_STORAGE_KEY : 'cuts_prompts';
  const promptBackupKey = typeof CUTS_PROMPTS_BACKUP_KEY !== 'undefined' ? CUTS_PROMPTS_BACKUP_KEY : 'cuts_prompts_live_backup';
  const promptUpdatedKey = typeof CUTS_PROMPTS_UPDATED_AT_KEY !== 'undefined' ? CUTS_PROMPTS_UPDATED_AT_KEY : 'cuts_prompts_updated_at';
  const sizePromptKey = typeof SIZE_CUTS_PROMPTS_STORAGE_KEY !== 'undefined' ? SIZE_CUTS_PROMPTS_STORAGE_KEY : 'cuts_size_prompts';
  const sizePromptUpdatedKey = typeof SIZE_CUTS_PROMPTS_UPDATED_AT_KEY !== 'undefined' ? SIZE_CUTS_PROMPTS_UPDATED_AT_KEY : 'cuts_size_prompts_updated_at';
  if (scopedAssets.__productScopeCleaned || cuts.__productScopeCleared) {
    try { localStorage.removeItem(promptKey); } catch(e) {}
    try { localStorage.removeItem(promptBackupKey); } catch(e) {}
    try { localStorage.removeItem(promptUpdatedKey); } catch(e) {}
    try { localStorage.removeItem(sizePromptKey); } catch(e) {}
    try { localStorage.removeItem(sizePromptUpdatedKey); } catch(e) {}
    return;
  }
  if (Array.isArray(cuts.prompts) && cuts.prompts.length) {
    const updatedAt = Number(cuts.promptsUpdatedAt || Date.now());
    const toSave = cuts.prompts.map(p => ({
      id: p.id,
      label: p.label,
      prompt: p.prompt,
      promptUpdatedAt: Number(p.promptUpdatedAt || 0) || 0,
      result: null,
      generating: false,
    }));
    try { localStorage.setItem(promptKey, JSON.stringify(toSave)); } catch(e) {}
    try { localStorage.setItem(promptBackupKey, JSON.stringify({ updatedAt, prompts: toSave })); } catch(e) {}
    try { localStorage.setItem(promptUpdatedKey, String(updatedAt)); } catch(e) {}
  }
  if (Array.isArray(cuts.sizePrompts) && cuts.sizePrompts.length) {
    const updatedAt = Number(cuts.sizePromptsUpdatedAt || Date.now());
    const toSave = cuts.sizePrompts.map(p => ({
      id: p.id,
      label: p.label,
      prompt: p.prompt,
      promptUpdatedAt: Number(p.promptUpdatedAt || 0) || 0,
      result: null,
      generating: false,
    }));
    try { localStorage.setItem(sizePromptKey, JSON.stringify(toSave)); } catch(e) {}
    try { localStorage.setItem(sizePromptUpdatedKey, String(updatedAt)); } catch(e) {}
  }
}

function applyServerLastWorkSnapshot(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  // 부르는 쪽이 범위를 못박은 복원에서는 이 탭이 지금 무엇을 열고 있든 그 범위로 본다.
  // 갓 켠 탭의 활성 범위는 draft: 이라, 프로젝트 저장본과는 영영 맞지 않는다.
  const expectedWorkspaceScopeId = String(options.expectedWorkspaceScopeId || '').trim();
  // 못박은 범위의 저장본을 일부러 불러오는 복원은, 이 탭이 지금 붙들고 있는 작업을
  // 그 작업으로 갈아끼우는 것이 목적이다. 탭 작업 인스턴스가 다르다는 이유로 막으면
  // 완성된 다른 제품은 영영 다시 열리지 않는다.
  const replaceWorkspace = options.replaceWorkspace === true || !!expectedWorkspaceScopeId;
  const matchesWorkspace = options.takeoverAuthority
    ? lastWorkSnapshotMatchesTakeoverWorkspace(snapshot, options.takeoverAuthority)
    : expectedWorkspaceScopeId
      ? lastWorkSnapshotMatchesWorkspaceScope(snapshot, expectedWorkspaceScopeId)
      : lastWorkSnapshotMatchesCurrentWorkspace(snapshot);
  if (!matchesWorkspace) return false;
  if (options.forceRevisionRestore !== true
    && !workspaceRevisionAllowsSnapshot(snapshot, { allowEqual: true })) return false;
  const rawAssets = snapshot.assets && typeof snapshot.assets === 'object' ? snapshot.assets : snapshot;
  const rawLightweight = snapshot.lightweight && typeof snapshot.lightweight === 'object' ? snapshot.lightweight : null;
  const boundaryOptions = replaceWorkspace ? { ...options, replaceWorkspace: true } : options;
  const assetBoundary = validateIncomingWorkspaceBoundary(rawAssets, boundaryOptions);
  if (!assetBoundary.ok) return false;
  const lightweightBoundary = rawLightweight
    ? validateIncomingWorkspaceBoundary(rawLightweight, boundaryOptions)
    : null;
  if (lightweightBoundary && !lightweightBoundary.ok) return false;
  if (assetBoundary.identity && lightweightBoundary?.identity
    && !workspacePersistenceApi().workIdentitiesMatch(assetBoundary.identity, lightweightBoundary.identity)) {
    state.storageWarning = '서버의 본문과 이미지 저장본이 서로 다른 작업으로 확인되어 복원을 차단했습니다.';
    state.storageWarningDismissKey = 'work-identity:server-replica-conflict';
    return false;
  }
  const currentTargetName = state.factory?.product?.productName || state.productName || '';
  const currentHasProductWork = !!(
    currentTargetName ||
    state.imageBase64 ||
    (state.imagePreview && state.imagePreview !== IMAGE_STORED_MARKER) ||
    state.factory?.product?.imageBase64 ||
    (state.factory?.product?.imagePreview && state.factory.product.imagePreview !== IMAGE_STORED_MARKER) ||
    state.factory?.product?.hasImage
  );
  const targetName = lastWorkHydrationTargetName(
    rawAssets,
    rawLightweight,
    currentTargetName,
    currentHasProductWork,
  );
  const assets = rawAssets
    ? sanitizeLastWorkPayloadProductScope(rawAssets, { targetName })
    : null;
  const lightweight = rawLightweight
    ? sanitizeLastWorkPayloadProductScope(rawLightweight, { targetName })
    : null;
  const lightweightCompPage = lightweight?.compPage && typeof lightweight.compPage === 'object'
    ? lightweight.compPage
    : null;
  let changed = false;
  if (lightweight) {
    try {
      lastLightweightSessionPayload = prepareLocalSessionPayload(lightweight);
    } catch(e) {}
  }
  if (assets) {
    const preserveScopedInlineImages = snapshotHasInlineImagePayload(assets);
    changed = applySessionAssetsPayload(assets, {
      preserveInlineImages: preserveScopedInlineImages,
      allowScopedInlineImages: preserveScopedInlineImages,
      targetName,
      forceProductRestore: true,
      // 위에서 이 저장본이 못박은 범위의 것임을 이미 확인했다. 갓 켠 탭의 활성 범위가
      // draft: 라는 이유로 여기서 다시 거르면 다른 작업의 저장본은 영영 실리지 않는다.
      forceWorkspaceRestore: !!expectedWorkspaceScopeId,
      replaceWorkspace,
      forceRevisionRestore: options.forceRevisionRestore === true,
      allowEqualRevision: true,
      takeoverAuthority: options.takeoverAuthority,
    }) || changed;
    if (options.persistReplica !== false && sessionAssetsHydrated && snapshotHasInlineImagePayload(assets)) {
      // 복제본 저장은 곁다리다. 이 탭이 다른 작업에 묶여 있으면 payload 를 만드는 순간
      // 예외를 던지는데, 그 예외가 복원 전체를 무너뜨린다. 실측: 방울수저집 복원이
      // WORK_IDENTITY_IMAGE_BINDING_CONFLICT 로 죽고 문서가 엉뚱한 run 으로 바뀌었다.
      try {
        workspacePutSessionAssets(currentSessionAssetsPayload({ includeImages: false })).catch(() => {});
      } catch (_) {}
    }
  }
  if (snapshot.productImageBackup) {
    changed = applyProductImageBackupPayload(snapshot.productImageBackup, {
      restoreInline: true,
      takeoverAuthority: options.takeoverAuthority,
    }) || changed;
    if (options.persistReplica !== false) saveLastProductImageBackupToDbIfChanged().catch(() => {});
  }
  const assetsHasCompAnalysis = !!(assets?.compPage?.analysisResult || assets?.compPage?.sectionPlan);
  if (!assetsHasCompAnalysis && (lightweightCompPage?.analysisResult || lightweightCompPage?.sectionPlan)) {
    const incomingAnalysisAt = Number(
      lightweightCompPage.analysisResult?.analyzedAt
      || lightweightCompPage.savedAt
      || lightweight?.savedAt
      || snapshot.savedAt
      || 0
    ) || 0;
    const currentAnalysisAt = getCurrentCompAnalysisTime();
    if (!state.compPage?.analysisResult || incomingAnalysisAt >= currentAnalysisAt) {
      const restored = applyCompAnalysisSnapshot(
        lightweightCompPage,
        lightweightCompPage.subStep || state.compPage?.subStep || 'report',
      );
      changed = restored || changed;
    }
  }
  if (lightweight && !changed) {
    changed = applySessionAssetsPayload(lightweight, {
      preserveInlineImages: snapshotHasInlineImagePayload(lightweight),
      allowScopedInlineImages: snapshotHasInlineImagePayload(lightweight),
      targetName,
      forceProductRestore: true,
      forceWorkspaceRestore: !!expectedWorkspaceScopeId,
      replaceWorkspace,
      forceRevisionRestore: options.forceRevisionRestore === true,
      allowEqualRevision: true,
      takeoverAuthority: options.takeoverAuthority,
    }) || changed;
  }
  if (options.persistReplica !== false && assets) persistRecoveredAuxiliaryLastWorkKeys(assets);
  if (lightweight?.step && (options.forceStep || !state.step || state.step === 'upload')) {
    state.step = lightweight.step === 'analyzing' || lightweight.step === 'generating' ? 'sections' : lightweight.step;
    changed = true;
  }
  if (Number(snapshot.savedAt)) serverLastWorkLastSavedAt = Number(snapshot.savedAt);
  const acceptedRevision = observeWorkspaceRevisionSnapshot(snapshot);
  if (acceptedRevision) state.workspaceRevision = acceptedRevision;
  return changed;
}

async function hydrateServerLastWorkSnapshot(options = {}, validation = {}) {
  const requestIsCurrent = () => typeof options.isCurrent !== 'function' || options.isCurrent() !== false;
  const initialRequestIsCurrent = requestIsCurrent();
  if (serverLastWorkHydrated && !options.force && options.projectFallback !== true) {
    return false;
  }
  if (serverLastWorkHydrating && serverLastWorkHydrationPromise) {
    await serverLastWorkHydrationPromise;
    if (!options.takeoverSync) return false;
  }
  let resolveHydration;
  const hydrationCompletion = new Promise(resolve => {
    resolveHydration = resolve;
  });
  serverLastWorkHydrationPromise = hydrationCompletion;
  const hydrateToken = workspaceBlankResetToken;
  const requestedScopeId = getCurrentLastWorkWorkspaceScope();
  serverLastWorkHydrating = true;
  let shouldResaveAfterHydrate = false;
  let takeoverIdentity = null;
  let previousStateSnapshot = null;
  let previousFactorySnapshot = null;
  let applyStarted = false;
  try {
    if (!initialRequestIsCurrent) return false;
    takeoverIdentity = options.takeoverAuthority
      ? workspaceTakeoverHydrationAuthority.assert(options.takeoverAuthority)
      : null;
    const hydrateScopeId = String(takeoverIdentity?.scopeId || requestedScopeId).trim();
    // 다른 작업의 저장본을 일부러 불러오는 복원에서는, 화면에 남아 있던 문서가 아니라
    // 불러올 작업의 범위를 써야 한다. 이걸 빼면 R3 저장본을 확인해 놓고 화면에 있던
    // 단색 문서를 도로 실어 오는 일이 생긴다.
    const documentScopeId = !takeoverIdentity
      ? (String(options.documentScopeId || '').trim() || getCurrentDocumentWorkspaceScope())
      : '';
    const restoreScopeId = documentScopeId || hydrateScopeId;
    const crossScopeRestore = restoreScopeId !== hydrateScopeId;
    if (!restoreScopeId) return false;
    if (!workspaceHydrationScopeIsCurrent(
      hydrateScopeId,
      hydrateToken,
      requestIsCurrent,
      options.takeoverAuthority,
    )) return false;
    previousStateSnapshot = takeoverIdentity ? cloneData(state) : null;
    previousFactorySnapshot = takeoverIdentity ? factoryRuntimeReadFactory() : null;
    const restored = await workspacePersistenceApi().restore({
      scopeId: restoreScopeId,
      sources: ['server'],
    });
    if (!workspaceHydrationScopeIsCurrent(
      hydrateScopeId,
      hydrateToken,
      requestIsCurrent,
      options.takeoverAuthority,
    )) return false;
    if (takeoverIdentity) workspaceTakeoverHydrationAuthority.assert(options.takeoverAuthority);
    const trustedRevision = workspaceSnapshotRevision(restored?.snapshot) || (
      restored?.revision && typeof restored.revision === 'object' ? restored.revision : null
    );
    let snapshot = restored?.snapshot && trustedRevision
      ? { ...restored.snapshot, workspaceRevision: trustedRevision }
      : restored?.snapshot;
    if (!snapshot) {
      if (options.takeoverSync && Number(options.minimumRevision) > 0) {
        throw new Error('인계받은 저장 리비전의 승인본을 찾지 못했습니다.');
      }
      return options.takeoverSync === true;
    }
    if (!lastWorkSnapshotMatchesWorkspaceScope(snapshot, restoreScopeId)
      || !workspaceHydrationScopeIsCurrent(
        hydrateScopeId,
        hydrateToken,
        requestIsCurrent,
        options.takeoverAuthority,
      )) {
      if (takeoverIdentity) throw new Error('STALE_TAKEOVER_HYDRATION_SCOPE');
      return false;
    }
    const snapshotAssets = snapshot.assets && typeof snapshot.assets === 'object'
      ? snapshot.assets
      : snapshot;
    if (snapshotAssets?.productImageBackup
      && typeof hydrateWorkspacePayloadImageBackup === 'function') {
      const hydratedAssets = await hydrateWorkspacePayloadImageBackup(snapshotAssets);
      if (hydratedAssets !== snapshotAssets) {
        snapshot = snapshot.assets && typeof snapshot.assets === 'object'
          ? { ...snapshot, assets: hydratedAssets }
          : hydratedAssets;
      }
    }
    if (!workspaceHydrationScopeIsCurrent(
      hydrateScopeId,
      hydrateToken,
      requestIsCurrent,
      options.takeoverAuthority,
    )) return false;
    if (options.takeoverSync) {
      const restoredRevision = Number(workspaceSnapshotRevision(snapshot)?.counter) || 0;
      const minimumRevision = takeoverIdentity?.revision ?? (Number(options.minimumRevision) || 0);
      if (restoredRevision < minimumRevision) {
        throw new Error(`승인본 리비전이 부족합니다. 필요 ${minimumRevision}, 확인 ${restoredRevision}`);
      }
    }
    const serverScore = lastWorkSnapshotScore(snapshot);
    const currentScore = getCurrentLastWorkScore();
    const serverSavedAt = Number(snapshot.savedAt || 0);
    const currentSavedAt = getCurrentLastWorkSavedAt();
    const serverCompAnalysisAt = lastWorkCompAnalysisTime(snapshot);
    const currentCompAnalysisAt = getCurrentCompAnalysisTime();
    const serverSectionImageQuality = snapshotSectionImagesQualityScore(snapshot);
    const currentSectionImageQuality = sectionImagesQualityScore(state.sectionImages || {});
    const serverHasBetterSectionImages = serverSectionImageQuality > currentSectionImageQuality + 8;
    const serverHasInlineOptionImages = (snapshot.assets?.optionSorter?.images || []).some(image =>
      hasInlineImagePayload(image, ['base64', 'preview', 'dataUrl'])
    );
    const currentNeedsOptionImageRestore = (state.optionSorter?.images || []).some(image =>
      image?.hasImageData && !hasInlineImagePayload(image, ['base64', 'preview', 'dataUrl'])
    );
    const serverAssetPayload = snapshot.assets && typeof snapshot.assets === 'object'
      ? snapshot.assets
      : snapshot;
    const serverCompMarketScore = lastWorkCompMarketScore(serverAssetPayload);
    const currentCompMarketScore = lastWorkCompMarketScore({ compPage: state.compPage });
    const serverHasBetterCompMarket = serverCompMarketScore > currentCompMarketScore;
    const currentStateOutranksServer = currentScore > serverScore
      || optionSorterSnapshotIsMoreComplete(state.optionSorter, serverAssetPayload.optionSorter);
    const serverHasBetterOptionSorter = optionSorterSnapshotIsMoreComplete(
      serverAssetPayload.optionSorter,
      state.optionSorter,
    );
    const serverHasCanonicalOptionLabels = lastWorkOptionLabelsRestoreNeeded(snapshot, state.optionSorter);
    const serverHasBetterCutResults = persistedCutResultCount(serverAssetPayload.cuts)
      > persistedCutResultCount(state.cuts);
    const serverHasRequiredFieldRestore = lastWorkRequiredFieldRestoreNeeded(
      snapshot,
      factoryRuntimeReadFactory(),
      state.productInfoManualValues || {},
    );
    const serverRepairsCurrentAssetScope =
      lastWorkFactoryHasSelfConsistentCurrentAssets(serverAssetPayload) &&
      !lastWorkFactoryHasSelfConsistentCurrentAssets({ factory: factoryRuntimeReadFactory() });
    const shouldApply = !!options.force
      || serverRepairsCurrentAssetScope
      || serverHasRequiredFieldRestore
      || serverScore > currentScore
      || serverHasBetterSectionImages
      || serverHasBetterCutResults
      || serverHasBetterOptionSorter
      || serverHasBetterCompMarket
      || serverHasCanonicalOptionLabels
      || (serverHasInlineOptionImages && currentNeedsOptionImageRestore)
      || (serverSavedAt > currentSavedAt + 1000 && serverScore >= currentScore)
      || (serverCompAnalysisAt > currentCompAnalysisAt + 1000);
    if (!shouldApply) {
      shouldResaveAfterHydrate = options.takeoverSync !== true
        && !crossScopeRestore
        && currentStateOutranksServer;
      return false;
    }
    if (!workspaceHydrationScopeIsCurrent(
      hydrateScopeId,
      hydrateToken,
      requestIsCurrent,
      options.takeoverAuthority,
    )) return false;
    if (typeof validation.validateSnapshot === 'function' && validation.validateSnapshot(snapshot) !== true) {
      return false;
    }
    applyStarted = true;
    const changed = applyServerLastWorkSnapshot(snapshot, {
      forceStep: options.forceStep,
      forceRevisionRestore: options.forceRevisionRestore === true,
      // 위에서 이 범위의 저장본임을 이미 확인했다. 갓 켠 탭이 아직 아무것도 열지 않았다는
      // 이유로 적용을 거르면, 다른 작업의 저장본은 영영 실리지 않는다.
      ...(String(options.documentScopeId || '').trim()
        ? { expectedWorkspaceScopeId: restoreScopeId }
        : {}),
      persistReplica: options.takeoverSync !== true,
      takeoverAuthority: options.takeoverAuthority,
    });
    if (changed) {
      if (String(state.storageWarning || '').includes('현재 제품과 다른 이미지 백업')) {
        state.storageWarning = '';
        state.storageWarningDismissKey = '';
      }
      if (!options.takeoverSync && serverCompAnalysisAt > currentCompAnalysisAt + 1000 && state.compPage?.analysisResult) {
        saveCompAnalysis(state.compPage.analysisResult, state.compPage.sectionPlan, state.compPage.planEdits);
      }
      // 복원된 last-work는 저장된 문서 상태로 본다 (새 작업 시 불필요 저장 강요 방지)
      if (typeof markWorkspaceDocumentClean === 'function') markWorkspaceDocumentClean();
      shouldResaveAfterHydrate = options.takeoverSync !== true && !crossScopeRestore;
      if (!options.takeoverSync) {
        if (sessionAssetsHydrated) {
          scheduleSessionAssetSaveIfChanged();
        } else {
          pendingSessionAssetSaveAfterHydrate = snapshotHasInlineImagePayload(snapshot);
        }
      }
      if (options.render !== false) render();
      return true;
    }
    return options.takeoverSync === true;
  } catch(e) {
    if (applyStarted && previousStateSnapshot) {
      for (const key of Object.keys(state)) {
        if (!Object.hasOwn(previousStateSnapshot, key)) delete state[key];
      }
      Object.assign(state, previousStateSnapshot);
    }
    if (applyStarted && takeoverIdentity && previousFactorySnapshot
      && factoryRuntimeReadFactory() !== previousFactorySnapshot) {
      factoryRuntimeReplaceFactorySnapshot(previousFactorySnapshot, {
        mode: 'hydrate',
        reason: 'takeover-hydrate-rollback',
        takeoverAuthority: options.takeoverAuthority,
      });
    }
    console.warn('Server last-work hydrate failed:', e);
    if (options.takeoverSync) throw e;
    return false;
  } finally {
    const shouldFlushPersistentStateAfterHydrate = options.takeoverSync !== true
      && workspaceScopeTransitionState.persistentSaveQueued;
    if (options.takeoverSync === true) {
      // A queued save belongs to the pre-takeover branch. The accepted server
      // snapshot replaces that branch state, so replaying it would release the
      // newly acquired project lease and reacquire the stale draft scope.
      workspaceScopeTransitionState.persistentSaveQueued = false;
    }
    serverLastWorkHydrated = true;
    serverLastWorkHydrating = false;
    resolveHydration();
    if (serverLastWorkHydrationPromise === hydrationCompletion) {
      serverLastWorkHydrationPromise = null;
    }
    if (shouldFlushPersistentStateAfterHydrate || shouldResaveAfterHydrate) {
      workspaceScopeTransitionState.persistentSaveQueued = false;
      setTimeout(() => savePersistentState({
        server: shouldResaveAfterHydrate,
        force: shouldResaveAfterHydrate,
      }), 0);
    }
  }
}

async function refreshCompetitorAnalysisFromServer(options = {}) {
  try {
    const restored = await workspacePersistenceApi().restore({
      scopeId: getCurrentLastWorkWorkspaceScope(),
      sources: ['server'],
    });
    const snapshot = restored?.snapshot;
    const assets = snapshot?.assets && typeof snapshot.assets === 'object'
      ? snapshot.assets
      : (snapshot?.lightweight && typeof snapshot.lightweight === 'object' ? snapshot.lightweight : snapshot);
    const assetComp = assets?.compPage && typeof assets.compPage === 'object' ? assets.compPage : null;
    const lightweightComp = snapshot?.lightweight?.compPage && typeof snapshot.lightweight.compPage === 'object'
      ? snapshot.lightweight.compPage
      : null;
    const savedComp = assetComp?.analysisResult || assetComp?.sectionPlan
      ? assetComp
      : (lightweightComp?.analysisResult || lightweightComp?.sectionPlan ? lightweightComp : assetComp || lightweightComp);
    if (!snapshot || !lastWorkSnapshotMatchesCurrentWorkspace(snapshot) || !savedComp?.analysisResult) return false;
    state.compPage = state.compPage || {};
    const currentMarketForSelection = state.compPage.marketScrape && typeof state.compPage.marketScrape === 'object'
      ? state.compPage.marketScrape
      : null;
    const pendingSelection = state.compPage.pendingAnalysisImageSelection || null;
    const currentSelection = (!pendingSelection?.key && typeof compMarketCurrentSelectedImageSignature === 'function')
      ? compMarketCurrentSelectedImageSignature(currentMarketForSelection, 'selected')
      : null;
    const requiredSelection = pendingSelection?.key ? pendingSelection : currentSelection;
    const savedSelection = savedComp.analysisImageSelection || savedComp.analysisResult?.compMarketImageSelection || null;
    const selectionMismatch = !!(
      requiredSelection?.key
      && (!savedSelection?.key || savedSelection.key !== requiredSelection.key)
    );
    const currentMarketBeforeApply = state.compPage.marketScrape && typeof state.compPage.marketScrape === 'object'
      ? {
        selectedImageIds: Array.isArray(state.compPage.marketScrape.selectedImageIds) ? [...state.compPage.marketScrape.selectedImageIds] : [],
        selectedIds: Array.isArray(state.compPage.marketScrape.selectedIds) ? [...state.compPage.marketScrape.selectedIds] : [],
        previewImageId: state.compPage.marketScrape.previewImageId || '',
        lastUpdatedAt: state.compPage.marketScrape.lastUpdatedAt || 0,
      }
      : null;
    const beforeAt = Number(state.compPage.analysisResult?.analyzedAt || 0) || 0;
    const incomingAt = Number(savedComp.analysisResult?.analyzedAt || savedComp.savedAt || snapshot?.savedAt || 0) || 0;
    if (state.compPage.analysisResult && incomingAt && beforeAt && incomingAt < beforeAt - 1000 && !options.force) return false;
    const applied = applyCompAnalysisSnapshot(savedComp, options.targetSubStep || state.compPage.subStep || 'input');
    if (!applied) return false;
    if (selectionMismatch && currentMarketBeforeApply && state.compPage.marketScrape) {
      state.compPage.marketScrape.selectedImageIds = [...currentMarketBeforeApply.selectedImageIds];
      state.compPage.marketScrape.selectedIds = [...currentMarketBeforeApply.selectedIds];
      state.compPage.marketScrape.previewImageId = currentMarketBeforeApply.previewImageId;
      state.compPage.marketScrape.lastUpdatedAt = Math.max(
        Number(state.compPage.marketScrape.lastUpdatedAt || 0) || 0,
        Number(currentMarketBeforeApply.lastUpdatedAt || 0) || 0,
        Date.now()
      );
    } else if (currentMarketBeforeApply?.selectedImageIds?.length && state.compPage.marketScrape) {
      state.compPage.marketScrape.selectedImageIds = currentMarketBeforeApply.selectedImageIds;
      state.compPage.marketScrape.previewImageId = currentMarketBeforeApply.previewImageId;
      state.compPage.marketScrape.lastUpdatedAt = Math.max(
        Number(state.compPage.marketScrape.lastUpdatedAt || 0) || 0,
        Number(currentMarketBeforeApply.lastUpdatedAt || 0) || 0,
        Date.now()
      );
    }
    if (currentMarketBeforeApply?.selectedIds?.length && state.compPage.marketScrape) {
      state.compPage.marketScrape.selectedIds = currentMarketBeforeApply.selectedIds;
    }
    state.compPage.previousAnalysisViewOnly = selectionMismatch || !!state.compPage.previousAnalysisViewOnly;
    if (selectionMismatch) state.error = '';
    state.compPage.analyzeProgress = 100;
    state.compPage.analyzeStage = 'done';
    state.compPage.analyzeMsg = '경쟁사 분석 완료';
    state.compPage.analyzeDetail = '서버에 저장된 완료 결과를 화면으로 가져왔습니다.';
    try {
      const market = ensureCompMarketScrapeState();
      market.loading = false;
      market.status = '경쟁사 분석 완료 결과를 화면에 표시했습니다.';
      market.phase = 'analyze-done';
      market.lastUpdatedAt = Date.now();
      if (typeof compMarketLog === 'function') compMarketLog(market.status, 'ok');
      if (typeof compMarketSave === 'function') compMarketSave();
    } catch(_) {}
    saveCompAnalysis(state.compPage.analysisResult, state.compPage.sectionPlan, state.compPage.planEdits);
    if (options.render !== false) render();
    return true;
  } catch(e) {
    console.warn('Competitor analysis server refresh failed:', e);
    return false;
  }
}

async function saveSessionAssetsToDb() {
  if (sessionAssetSavePromise) {
    sessionAssetSaveRequestedAgain = true;
    return sessionAssetSavePromise;
  }
  sessionAssetSavePromise = (async () => {
    do {
      sessionAssetSaveRequestedAgain = false;
      await saveSessionAssetsToDbOnce();
    } while (sessionAssetSaveRequestedAgain);
  })().finally(() => {
    sessionAssetSavePromise = null;
  });
  return sessionAssetSavePromise;
}

async function saveSessionAssetsToDbOnce(reconcileAttempted = false) {
  let clearedWarning = false;
  try {
    await saveLastProductImageBackupToDbIfChanged().catch(e => console.warn('Last product image backup save failed:', e));
    const payload = currentSessionAssetsPayload({
      includeImages: false,
      preserveSelectedFactoryImages: true,
      preserveRecentWorkingImages: true,
    });
    const existing = await workspaceGetSessionAssets().catch(() => null);
    const revisionApi = workspaceRevisionApi();
    const existingRevision = workspaceSnapshotRevision(existing);
    const payloadRevision = workspaceSnapshotRevision(payload);
    if (existingRevision && (!payloadRevision || revisionApi?.compare?.(existingRevision, payloadRevision) > 0)) {
      return;
    }
    if (existing?.savedAt && payload.savedAt && Number(existing.savedAt) > Number(payload.savedAt)) {
      return;
    }
    if (existing?.factory && payload.factory && typeof mergeFactoryStoredImages === 'function') {
      payload.factory = stripFactoryImages(mergeFactoryStoredImages(payload.factory, existing.factory), {
        preserveReferencedImages: true,
        preserveRecentImages: true,
      });
    }
    await workspacePutSessionAssets(payload);
    markSessionAssetFingerprintSaved();
    await Promise.all([
      workspaceSessionRemoveItem('pdp_session_img'),
      workspaceSessionRemoveItem('pdp_session_imgs'),
      workspaceSessionRemoveItem('pdp_detail_image_blocks'),
    ]);
    if (lastLightweightSessionPayload) {
      try {
        lastLightweightSessionPayload = prepareLocalSessionPayload(lastLightweightSessionPayload);
      } catch(e) {
        console.warn('Session metadata retry failed:', e);
        const changed = setStorageWarningOnce('이미지는 IndexedDB에 저장됐지만 세션 정보 저장 공간이 부족합니다. 현재 작업 저장을 눌러 안전하게 보존해주세요.');
        if (changed && typeof render === 'function') render();
        return;
      }
    }
    if (state.storageWarning && state.storageWarning.includes('이미지 저장')) {
      state.storageWarning = '';
      clearedWarning = true;
    }
    if (state.storageWarning && state.storageWarning.includes('세션 저장')) {
      state.storageWarning = '';
      clearedWarning = true;
    }
  } catch(e) {
    if (!reconcileAttempted && await reconcileMatchingWorkspaceReplicaRevision(e)) {
      return saveSessionAssetsToDbOnce(true);
    }
    console.warn('Session asset save failed:', e);
    const changed = setStorageWarningOnce('이미지 저장소 저장에 실패했습니다. 현재 화면은 유지되지만, 새로고침 전에 현재 작업 저장을 한 번 눌러주세요.');
    if (changed && typeof render === 'function') render();
    return;
  }
  if (clearedWarning && typeof render === 'function') render();
}

function scheduleSessionAssetSave() {
  if (!sessionAssetsHydrated) {
    pendingSessionAssetSaveAfterHydrate = true;
    return;
  }
  if (sessionAssetSaveTimer) clearTimeout(sessionAssetSaveTimer);
  sessionAssetSaveTimer = setTimeout(() => {
    sessionAssetSaveTimer = null;
    saveSessionAssetsToDb().catch(() => {});
  }, 1500);
}

function sessionAssetSaveFingerprint() {
  const valueLength = value => {
    if (!value || value === IMAGE_STORED_MARKER) return 0;
    return typeof value === 'string' ? value.length : 0;
  };
  const imageStamp = item => {
    if (!item || typeof item !== 'object') return ['', false, 0, ''];
    const rawLength = [
      item.base64,
      item.imageBase64,
      item.preview,
      item.imagePreview,
      item.dataUrl,
      item.image,
      item.result,
    ].reduce((sum, value) => sum + valueLength(value), 0);
    return [
      item?.id || item?.name || item?.label || '',
      !!(rawLength || item?.hasImageData || item?.hasImage || item?.hasResult),
      rawLength,
      item?.updatedAt || item?.createdAt || item?.savedAt || item?.sourceId || '',
    ];
  };
  const mapImageList = list => (Array.isArray(list) ? list : []).map(item => [
    ...imageStamp(item),
  ]);
  const mapResultList = list => (Array.isArray(list) ? list : []).map(item => [
    ...imageStamp(item),
  ]);
  const factory = typeof factoryRuntimeReadCommittedFactory === 'function'
    ? factoryRuntimeReadCommittedFactory()
    : (state.factory || {});
  const candidateKeys = (list, kind) => (Array.isArray(list) ? list : []).map(item => {
    if (kind === 'cafe24') {
      return String(item?.product_no || item?.raw?.product_no || item?.product_code || item?.product_name || '').trim();
    }
    return String(item?.jcode || item?.id || item?.product_name || item?.jname || '').trim();
  });
  const optionResultKeys = (list) => (Array.isArray(list) ? list : []).map(item => [
    String(item?.optionResultId || item?.resultId || item?.id || item?.archiveId || item?.title || '').trim(),
    !!(item?.image || item?.imageUrl || item?.archiveId || item?.resultAssetId || item?.hasImage),
  ]);
  const market = state.compPage?.marketScrape && typeof state.compPage.marketScrape === 'object'
    ? state.compPage.marketScrape
    : {};
  const marketCandidateKeys = [
    ...(Array.isArray(market.results) ? market.results : []),
    ...(Array.isArray(market.vmResults) ? market.vmResults : []),
    ...(Array.isArray(market.localResults) ? market.localResults : []),
  ].map(item => String(item?.id || item?.candidateId || item?.productUrl || item?.url || item?.title || '').trim())
    .filter(Boolean)
    .sort();
  return JSON.stringify({
    productIdentity: {
      productName: String(state.productName || factory.product?.productName || '').trim(),
      currentProjectId: String(state.currentProjectId || factory.currentProjectId || factory.workspace?.id || '').trim(),
      currentProjectName: String(state.currentProjectName || factory.currentProjectName || factory.workspace?.name || '').trim(),
      step: String(state.step || '').trim(),
    },
    imagePreview: valueLength(state.imagePreview),
    imageBase64: valueLength(state.imageBase64),
    analysisImages: mapImageList(state.analysisImages),
    sectionImages: Object.keys(state.sectionImages || {}).filter(key => !!state.sectionImages[key]).sort(),
    detailImageBlocks: mapImageList(state.detailImageBlocks),
    sectionVariants: Object.fromEntries(Object.entries(state.sectionVariants || {}).map(([key, list]) => [key, mapImageList(list)])),
    aiRepairUndoStack: Object.fromEntries(Object.entries(state.aiRepairUndoStack || {}).map(([key, list]) => [key, mapImageList(list)])),
    cuts: {
      source: imageStamp({ base64: state.cuts?.sourceBase64, preview: state.cuts?.sourcePreview, hasImage: state.cuts?.hasSourceImage, name: 'cuts-source' }),
      work: imageStamp({ base64: state.cuts?.workImageBase64, preview: state.cuts?.workImagePreview, hasImage: state.cuts?.hasWorkImage, name: 'cuts-work' }),
      prompts: mapResultList(state.cuts?.prompts),
      sizePrompts: mapResultList(state.cuts?.sizePrompts),
    },
    optionSorter: {
      images: mapImageList(state.optionSorter?.images),
      results: mapImageList(state.optionSorter?.optionResults),
      resultKeys: optionResultKeys(state.optionSorter?.optionResults),
      slots: (Array.isArray(state.optionSorter?.slots) ? state.optionSorter.slots : []).map(slot => [
        String(slot?.id || '').trim(),
        String(slot?.name || '').trim(),
        (Array.isArray(slot?.imgIds) ? slot.imgIds : []).map(String).sort(),
      ]),
      sample: imageStamp(state.optionSorter?.styleSample || {}),
    },
    factory: {
      product: imageStamp(factory.product || {}),
      inputImages: mapImageList(factory.product?.inputImages),
      assets: mapImageList(factory.assets),
      candidateReview: {
        selectedDbCandidateKey: String(factory.product?.selectedDbCandidateKey || ''),
        selectedCafe24CandidateKey: String(factory.product?.selectedCafe24CandidateKey || ''),
        dbCandidateResolution: String(factory.product?.dbCandidateResolution || ''),
        cafe24CandidateResolution: String(factory.product?.cafe24CandidateResolution || ''),
        confirmedCafe24ProductKey: String(factory.product?.confirmedCafe24ProductKey || ''),
        dbCandidates: candidateKeys(factory.product?.dbCandidates, 'db'),
        pendingDbCandidates: candidateKeys(factory.product?.pendingDbCandidates, 'db'),
        cafe24Candidates: candidateKeys(factory.product?.cafe24Candidates, 'cafe24'),
        pendingCafe24Candidates: candidateKeys(factory.product?.pendingCafe24Candidates, 'cafe24'),
      },
    },
    compPage: {
      uploaded: mapImageList(state.compPage?.uploadedImages),
      evidence: mapImageList(state.compPage?.evidenceImages),
      market: {
        candidateKeys: marketCandidateKeys,
        selectedIds: (Array.isArray(market.selectedIds) ? market.selectedIds : []).map(String).sort(),
        selectedImageIds: (Array.isArray(market.selectedImageIds) ? market.selectedImageIds : []).map(String).sort(),
        detailKeys: Object.keys(market.detailResults && typeof market.detailResults === 'object' ? market.detailResults : {}).sort(),
      },
      analysis: {
        updatedAt: String(state.compPage?.analysisUpdatedAt || state.compPage?.analyzedAt || '').trim(),
        hasResult: !!(state.compPage?.analysisResult && typeof state.compPage.analysisResult === 'object' && Object.keys(state.compPage.analysisResult).length),
        hasSectionPlan: !!(state.compPage?.sectionPlan && typeof state.compPage.sectionPlan === 'object' && Object.keys(state.compPage.sectionPlan).length),
      },
    },
  });
}

function markSessionAssetFingerprintSaved() {
  try { lastSessionAssetFingerprint = sessionAssetSaveFingerprint(); } catch(e) {}
}

function scheduleSessionAssetSaveIfChanged() {
  let nextFingerprint = '';
  try { nextFingerprint = sessionAssetSaveFingerprint(); } catch(e) {}
  if (nextFingerprint && nextFingerprint === lastSessionAssetFingerprint) return;
  scheduleSessionAssetSave();
}

function saveSessionAssetsToDbIfChanged() {
  let nextFingerprint = '';
  try { nextFingerprint = sessionAssetSaveFingerprint(); } catch(e) {}
  if (nextFingerprint && nextFingerprint === lastSessionAssetFingerprint) return Promise.resolve(false);
  return saveSessionAssetsToDb();
}

async function sessionAssetsForAuthoritativeCommit() {
  const currentFingerprint = (() => {
    try { return sessionAssetSaveFingerprint(); } catch(e) { return ''; }
  })();
  const existing = await workspaceGetSessionAssets().catch(() => null);
  if (existing && currentFingerprint && currentFingerprint === lastSessionAssetFingerprint) {
    return existing;
  }
  const payload = currentSessionAssetsPayload({
    includeImages: false,
    preserveSelectedFactoryImages: true,
    preserveRecentWorkingImages: true,
  });
  if (existing?.factory && payload.factory && typeof mergeFactoryStoredImages === 'function') {
    payload.factory = stripFactoryImages(mergeFactoryStoredImages(payload.factory, existing.factory), {
      preserveReferencedImages: true,
      preserveRecentImages: true,
    });
  }
  return payload;
}

function markPendingSessionAssetSaveIfChanged() {
  let nextFingerprint = '';
  try { nextFingerprint = sessionAssetSaveFingerprint(); } catch(e) {}
  pendingSessionAssetSaveAfterHydrate = !nextFingerprint || nextFingerprint !== lastSessionAssetFingerprint;
}

function syncVisibleLastWorkInputs(options = {}) {
  if (workspaceBlankResetInProgress || lastWorkSyncingVisibleInputs) return;
  const deep = options.deep === true;
  lastWorkSyncingVisibleInputs = true;
  try {
    try {
      if (typeof syncCutPromptsFromDom === 'function' && document.querySelector('[data-cut-prompt],[data-size-cut-prompt]')) {
        syncCutPromptsFromDom({ save: false });
      }
    } catch(e) {}
    try {
      if (typeof factoryUpdateFromInputs === 'function' && document.querySelector('#factoryProductName,#factoryNaturalHint,[data-factory-stage-target],[data-factory-stage-prompt],[data-factory-goal-target],#factoryGoalMaxLoops,#factoryGoalMode')) {
        factoryUpdateFromInputs();
      }
    } catch(e) {}
    if (deep) {
      try {
        if (typeof syncOptFromDOM === 'function' && document.getElementById('optPoolList')) syncOptFromDOM();
      } catch(e) {}
      try {
        if (typeof syncOptSlotsFromDOM === 'function' && document.getElementById('optSlotGrid')) syncOptSlotsFromDOM();
      } catch(e) {}
    }
  } finally {
    lastVisibleInputSyncAt = Date.now();
    lastWorkSyncingVisibleInputs = false;
  }
}

function syncVisibleLastWorkInputsIfStale(maxAge = 900, options = {}) {
  if (lastWorkSyncingVisibleInputs) return;
  if (Date.now() - lastVisibleInputSyncAt < maxAge) return;
  syncVisibleLastWorkInputs(options);
}

function scheduleFactoryLastSnapshotSave(delay = 1200) {
  if (!state.factory || typeof saveFactoryLastSnapshot !== 'function') return;
  factoryLastSnapshotSavePending = true;
  if (factoryLastSnapshotSaveTimer) clearTimeout(factoryLastSnapshotSaveTimer);
  factoryLastSnapshotSaveTimer = setTimeout(() => {
    factoryLastSnapshotSaveTimer = null;
    flushFactoryLastSnapshotSave();
  }, delay);
}

function flushFactoryLastSnapshotSave() {
  if (factoryLastSnapshotSaveTimer) {
    clearTimeout(factoryLastSnapshotSaveTimer);
    factoryLastSnapshotSaveTimer = null;
  }
  if (!factoryLastSnapshotSavePending || typeof saveFactoryLastSnapshot !== 'function') return;
  factoryLastSnapshotSavePending = false;
  const factorySnapshot = typeof factoryRuntimeReadCommittedFactory === 'function'
    ? factoryRuntimeReadCommittedFactory()
    : state.factory;
  if (!factorySnapshot) return;
  try { saveFactoryLastSnapshot(factorySnapshot); } catch(e) {}
}

function scheduleLastWorkSave(delay = 1600, options = {}) {
  const wait = Math.max(120, Number(delay) || 1600);
  const captureScheduledFactory = () => {
    const activeFactory = typeof factoryRuntimeReadFactory === 'function'
      ? factoryRuntimeReadFactory()
      : null;
    const committedFactory = typeof factoryRuntimeReadCommittedFactory === 'function'
      ? factoryRuntimeReadCommittedFactory()
      : activeFactory;
    return activeFactory && activeFactory !== committedFactory
      ? (typeof factoryRuntimeDetachedValue === 'function'
          ? factoryRuntimeDetachedValue(activeFactory)
          : cloneData(activeFactory))
      : null;
  };
  const saveScheduledFactory = scheduledFactory => {
    if (!scheduledFactory) return false;
    saveLastWorkNow({
      factory: scheduledFactory,
      sync: false,
    });
    return true;
  };
  if (options.optionSorterOnly === true) {
    if (optionSorterLiveSaveTimer) clearTimeout(optionSorterLiveSaveTimer);
    optionSorterLiveSaveTimer = setTimeout(() => {
      optionSorterLiveSaveTimer = null;
      const serverOptions = options.durable === true ? { force: true } : undefined;
      Promise.resolve(saveOptionSorterLiveRecovery()).then(saved => (
        saved && saveServerLastWorkSnapshot('option-sorter-live', serverOptions)
      ));
    }, wait);
    return;
  }
  if (options.force !== true && (options.lightweight === true || lastWorkIsInteractiveInputWindow())) {
    scheduleLastWorkInputCheckpointSave(Math.min(wait, 900));
    if (lastWorkSaveTimer) clearTimeout(lastWorkSaveTimer);
    lastWorkSaveTimer = setTimeout(() => {
      lastWorkSaveTimer = null;
      if (saveScheduledFactory(captureScheduledFactory())) return;
      syncVisibleLastWorkInputs({ deep: false });
      savePersistentState();
    }, Math.max(wait, LAST_WORK_INPUT_IDLE_MS + 120));
    return;
  }
  const scheduledFactory = captureScheduledFactory();
  if (lastWorkSyncingVisibleInputs) return;
  if (lastWorkSaveTimer) clearTimeout(lastWorkSaveTimer);
  lastWorkSaveTimer = setTimeout(() => {
    lastWorkSaveTimer = null;
    if (saveScheduledFactory(scheduledFactory)) return;
    syncVisibleLastWorkInputs({ deep: false });
    savePersistentState();
  }, wait);
}

async function settleWorkspaceScopeTransitionPersistence() {
  const cancelDeferredWrites = () => {
    for (const timer of [
      lastWorkSaveTimer,
      sessionAssetSaveTimer,
      serverLastWorkSaveTimer,
      lastWorkInputCheckpointTimer,
      factoryLastSnapshotSaveTimer,
      persistentStateSaveRetryTimer,
    ]) if (timer) clearTimeout(timer);
    lastWorkSaveTimer = null;
    sessionAssetSaveTimer = null;
    serverLastWorkSaveTimer = null;
    lastWorkInputCheckpointTimer = null;
    factoryLastSnapshotSaveTimer = null;
    persistentStateSaveRetryTimer = null;
    factoryLastSnapshotSavePending = false;
    workspaceScopeTransitionState.persistentSaveQueued = false;
    serverLastWorkSaveRequestedAgain = false;
    serverLastWorkForceSaveRequested = false;
    serverLastWorkFactorySnapshotRequested = null;
    serverLastWorkFailureCount = 0;
    serverLastWorkRetryAfter = 0;
  };
  cancelDeferredWrites();
  const activeWrites = [
    persistentStateSavePromise,
    serverLastWorkSavePromise,
    sessionAssetSavePromise,
    lastProductImageBackupSavePromise,
  ].filter(Boolean);
  if (activeWrites.length) await Promise.allSettled(activeWrites);
  cancelDeferredWrites();
}

function markWorkspaceBlankResetBoundary() {
  workspaceBlankResetToken += 1;
  invalidateWorkspaceBackgroundHydration();
  workspaceBlankResetInProgress = true;
  sessionAssetsHydrated = true;
  pendingSessionAssetSaveAfterHydrate = false;
  serverLastWorkHydrated = true;
  serverLastWorkHydrating = false;
  lastLightweightSessionPayload = null;
  lastLocalSessionJson = null;
  lastSessionAssetFingerprint = '';
  if (optionSorterLiveSaveTimer) {
    clearTimeout(optionSorterLiveSaveTimer);
    optionSorterLiveSaveTimer = null;
  }
  if (lastWorkSaveTimer) {
    clearTimeout(lastWorkSaveTimer);
    lastWorkSaveTimer = null;
  }
  if (sessionAssetSaveTimer) {
    clearTimeout(sessionAssetSaveTimer);
    sessionAssetSaveTimer = null;
  }
  if (serverLastWorkSaveTimer) {
    clearTimeout(serverLastWorkSaveTimer);
    serverLastWorkSaveTimer = null;
  }
  if (lastWorkInputCheckpointTimer) {
    clearTimeout(lastWorkInputCheckpointTimer);
    lastWorkInputCheckpointTimer = null;
  }
  if (factoryLastSnapshotSaveTimer) {
    clearTimeout(factoryLastSnapshotSaveTimer);
    factoryLastSnapshotSaveTimer = null;
  }
  factoryLastSnapshotSavePending = false;
  pendingFactoryLastSnapshotRecoveryWrite = null;
  if (persistentStateSaveRetryTimer) {
    clearTimeout(persistentStateSaveRetryTimer);
    persistentStateSaveRetryTimer = null;
  }
  workspaceScopeTransitionState.persistentSaveQueued = false;
  serverLastWorkSaveRequestedAgain = false;
  serverLastWorkForceSaveRequested = false;
  serverLastWorkFactorySnapshotRequested = null;
  serverLastWorkFailureCount = 0;
  serverLastWorkRetryAfter = 0;
}

function completeWorkspaceBlankResetBoundary() {
  workspaceBlankResetInProgress = false;
}

function captureWorkspaceDocumentFence(options = {}) {
  const resetToken = Number(options.expectedWorkspaceResetToken);
  return Object.freeze({
    scopeId: String(options.expectedWorkspaceScope || getCurrentLastWorkWorkspaceScope()).trim(),
    resetToken: Number.isFinite(resetToken) ? resetToken : workspaceBlankResetToken,
    allowBlankResetCheckpoint: options.allowBlankResetCheckpoint === true,
  });
}

function workspaceDocumentFenceIsCurrent(fence) {
  if (!fence?.scopeId) return false;
  if (workspaceBlankResetToken !== fence.resetToken) return false;
  if (workspaceBlankResetInProgress) {
    if (fence.allowBlankResetCheckpoint !== true) return false;
    const activeBlankScope = lastWorkDraftScopeCache
      ? workspacePersistenceApi().normalizeWorkspaceScope(lastWorkDraftScopeCache)
      : '';
    return activeBlankScope === fence.scopeId;
  }
  return getCurrentLastWorkWorkspaceScope() === fence.scopeId;
}

function saveLastWorkNow(options = {}) {
  const blankCheckpoint = options.allowBlankResetCheckpoint === true;
  const documentFence = captureWorkspaceDocumentFence(options);
  if (!workspaceDocumentFenceIsCurrent(documentFence)) return Promise.resolve([]);
  if (!options.factory && typeof factoryRuntimeReadFactory === 'function') {
    const activeFactory = factoryRuntimeReadFactory();
    const committedFactory = typeof factoryRuntimeReadCommittedFactory === 'function'
      ? factoryRuntimeReadCommittedFactory()
      : activeFactory;
    if (activeFactory && activeFactory !== committedFactory) {
      options = {
        ...options,
        factory: typeof factoryRuntimeDetachedValue === 'function'
          ? factoryRuntimeDetachedValue(activeFactory)
          : cloneData(activeFactory),
        sync: false,
      };
    }
  }
  if (options.interactive === true) {
    saveLastWorkInputCheckpoint('interactive-now');
    return;
  }
  if (lastWorkSaveTimer) {
    clearTimeout(lastWorkSaveTimer);
    lastWorkSaveTimer = null;
  }
  if (!options.factory && options.sync !== false && !lastWorkSyncingVisibleInputs) {
    syncVisibleLastWorkInputs({ deep: options.deep === true });
  }
  const pending = [];
  let persistenceBoundary = Promise.resolve(true);
  let detachedFactory = null;
  if (options.persistent !== false) {
    detachedFactory = options.factory
      ? (typeof factoryRuntimeDetachedValue === 'function'
          ? factoryRuntimeDetachedValue(options.factory)
          : cloneData(options.factory))
      : null;
    const persistenceOptions = {
      skipVisibleSync: options.skipVisibleSync === true || options.sync === false || !!options.factory,
      deferWarningRender: options.deferWarningRender === true || !!options.factory,
      factory: detachedFactory,
      skipSessionAssetSave: options.skipSessionAssetSave === true || blankCheckpoint,
      allowBlankResetCheckpoint: blankCheckpoint,
      expectedWorkspaceScope: documentFence.scopeId,
      expectedWorkspaceResetToken: documentFence.resetToken,
    };
    const persistedImmediately = savePersistentState(persistenceOptions);
    if (persistedImmediately === false) {
      persistenceBoundary = flushQueuedPersistentState(persistenceOptions);
    } else {
      persistenceBoundary = Promise.resolve(persistedImmediately).then(saved => (
        saved === true ? true : flushQueuedPersistentState(persistenceOptions)
      ));
    }
    pending.push(persistenceBoundary);
  } else {
    saveLastWorkBootstrap({ documentFence });
    if (state.factory && typeof saveFactoryLastSnapshot === 'function') saveFactoryLastSnapshot(state.factory);
  }
  if (!blankCheckpoint) {
    flushFactoryLastSnapshotSave();
    pending.push(saveLastProductImageBackupToDbIfChanged().catch(() => false));
  }
  let assetBoundary = persistenceBoundary;
  if (!blankCheckpoint && sessionAssetsHydrated) {
    assetBoundary = persistenceBoundary.then(() => saveSessionAssetsToDbIfChanged()).catch(() => false);
    pending.push(assetBoundary);
  } else {
    markPendingSessionAssetSaveIfChanged();
  }
  if (options.server !== false) {
    const serverSaveOptions = { force: options.force === true };
    if (detachedFactory) serverSaveOptions.factorySnapshot = detachedFactory;
    pending.push(assetBoundary.then(() => saveServerLastWorkSnapshot('manual-now', serverSaveOptions)).catch(() => false));
  }
  return Promise.allSettled(pending);
}

function flushLastWorkBeforeLeave() {
  if (lastWorkPageLeaveFlushInProgress) return;
  lastWorkPageLeaveFlushInProgress = true;
  try {
    if (!lastWorkSyncingVisibleInputs) syncVisibleLastWorkInputs({ deep: false });
    saveLastWorkInputCheckpoint('page-leave-input');
    // 이 탭은 이제 떠난다. 심장박동을 지워, 다음 탭이 곧바로 이 초안을 이어받게 한다.
    // 지우지 않으면 다음 탭은 최대 60초를 '아직 살아 있나 보다' 하고 기다린다.
    if (draftHeartbeatTimer) { clearInterval(draftHeartbeatTimer); draftHeartbeatTimer = null; }
    clearDraftHeartbeat(getCurrentLastWorkWorkspaceScope());
    if (lastWorkSaveTimer) {
      clearTimeout(lastWorkSaveTimer);
      lastWorkSaveTimer = null;
    }
    if (sessionAssetSaveTimer) {
      clearTimeout(sessionAssetSaveTimer);
      sessionAssetSaveTimer = null;
    }
    if (serverLastWorkSaveTimer) {
      clearTimeout(serverLastWorkSaveTimer);
      serverLastWorkSaveTimer = null;
    }
    if (factoryLastSnapshotSaveTimer) {
      clearTimeout(factoryLastSnapshotSaveTimer);
      factoryLastSnapshotSaveTimer = null;
    }
  } catch(e) {}
}

async function flushLastWorkBeforeRuntimeReload() {
  if (lastWorkPageLeaveFlushInProgress) return false;
  lastWorkPageLeaveFlushInProgress = true;
  try {
    if (!lastWorkSyncingVisibleInputs) syncVisibleLastWorkInputs({ deep: false });
    saveLastWorkInputCheckpoint('runtime-reload');
    if (lastWorkSaveTimer) {
      clearTimeout(lastWorkSaveTimer);
      lastWorkSaveTimer = null;
    }
    if (sessionAssetSaveTimer) {
      clearTimeout(sessionAssetSaveTimer);
      sessionAssetSaveTimer = null;
    }
    if (serverLastWorkSaveTimer) {
      clearTimeout(serverLastWorkSaveTimer);
      serverLastWorkSaveTimer = null;
    }
    if (factoryLastSnapshotSaveTimer) {
      clearTimeout(factoryLastSnapshotSaveTimer);
      factoryLastSnapshotSaveTimer = null;
    }
    const results = await saveLastWorkNow({ force: true, deep: false });
    await settleLastWorkBootstrapWrites();
    await settleWorkspaceScopeTransitionPersistence();
    const localSave = Array.isArray(results) ? results[0] : null;
    if (!localSave || localSave.status !== 'fulfilled' || localSave.value !== true) {
      throw new Error('현재 작업 저장 결과를 확인하지 못했습니다.');
    }
    return true;
  } finally {
    lastWorkPageLeaveFlushInProgress = false;
  }
}

if (typeof window !== 'undefined') window.flushLastWorkBeforeRuntimeReload = flushLastWorkBeforeRuntimeReload;

function resetLastWorkBeforeLeaveFlush() {
  lastWorkPageLeaveFlushInProgress = false;
}

function hasRestoredImagePayloadValue(value) {
  if (!value) return false;
  if (typeof value !== 'string') return true;
  const normalized = value.trim();
  return !!normalized && normalized !== IMAGE_STORED_MARKER;
}

function hasInlineImagePayload(item, keys = ['base64', 'preview', 'dataUrl', 'image', 'result']) {
  if (!item || typeof item !== 'object') return false;
  return keys.some(key => hasRestoredImagePayloadValue(item[key]));
}

function snapshotHasInlineImagePayload(value) {
  if (typeof value === 'string') return value.startsWith('data:image/') || (value.length > 10000 && /^[A-Za-z0-9+/=\r\n]+$/.test(value.slice(0, 120)));
  if (Array.isArray(value)) return value.some(snapshotHasInlineImagePayload);
  if (value && typeof value === 'object') return Object.values(value).some(snapshotHasInlineImagePayload);
  return false;
}

function countSessionAssetRestoreRefs() {
  let count = 0;
  const activeStep = String(state.step || 'upload');
  const contentStep = ['sections', 'generating', 'preview'].includes(activeStep);
  const canonicalFactory = typeof factoryRuntimeReadFactory === 'function'
    ? factoryRuntimeReadFactory()
    : (state.factory || {});
  const currentProductImagePayload = [
    state.imageBase64,
    state.imagePreview,
    canonicalFactory.product?.imageBase64,
    canonicalFactory.product?.imagePreview,
    canonicalFactory.product?.imageUrl,
  ]
    .find(hasRestoredImagePayloadValue) || '';
  const currentProductImageFingerprint = typeof factoryImagePayloadFingerprint === 'function'
    ? factoryImagePayloadFingerprint(currentProductImagePayload)
    : '';
  if (Array.isArray(state.analysisImages)) {
    const missingAnalysisImages = state.analysisImages.filter(img => (
      img?.hasImageData && !hasInlineImagePayload(img, ['base64', 'preview'])
    ));
    count += missingAnalysisImages.filter(img => {
      const referenceFingerprint = String(img.inputImageFingerprint || '').trim();
      if (!referenceFingerprint) {
        return !currentProductImageFingerprint || missingAnalysisImages.length !== 1;
      }
      return referenceFingerprint !== currentProductImageFingerprint;
    }).length;
  }
  if (contentStep) {
    if (Array.isArray(state.detailImageBlocks)) {
      count += state.detailImageBlocks.filter(block => block?.hasDataUrl && !block.dataUrl).length;
    }
    for (const [sectionId, variants] of Object.entries(state.sectionVariants || {})) {
      if (!Array.isArray(variants) || hasRestoredImagePayloadValue(state.sectionImages?.[sectionId])) continue;
      const currentId = String(state.currentSectionVariantIds?.[sectionId] || '');
      const current = currentId
        ? variants.filter(item => String(item?.id || item?.variantId || '') === currentId)
        : variants.slice(0, 1);
      count += current.filter(item => item?.hasImage && !item.image).length;
    }
  }
  if (activeStep === 'preview') {
    for (const stack of Object.values(state.aiRepairUndoStack || {})) {
      if (Array.isArray(stack)) count += stack.filter(item => item?.hasImage && !item.image).length;
    }
    if (state.aiRepair?.hasMaskDataUrl && !state.aiRepair.maskDataUrl) count += 1;
  }
  if (activeStep === 'imagecuts') {
    if (state.cuts?.hasSourceImage && !hasInlineImagePayload(state.cuts, ['sourceBase64', 'sourcePreview'])) count += 1;
    if (state.cuts?.hasWorkImage && !hasInlineImagePayload(state.cuts, ['workImageBase64', 'workImagePreview'])) count += 1;
  }
  if (activeStep === 'competitor') {
    if (state.compPage?.hasUploadedImages && !(state.compPage.uploadedImages || []).length) count += 1;
    if (state.compPage?.hasEvidenceImages && !(state.compPage.evidenceImages || []).length) count += 1;
  }
  if (activeStep === 'optionsorter') {
    const optionSorter = state.optionSorter || {};
    if (Array.isArray(optionSorter.images)) {
      count += optionSorter.images.filter(img => img?.hasImageData && !hasInlineImagePayload(
        img,
        ['base64', 'preview', 'dataUrl', 'imageUrl', 'archiveId', 'localArchive'],
      )).length;
    }
    if (Array.isArray(optionSorter.optionResults)) {
      count += optionSorter.optionResults.filter(result => result?.hasImage && !hasInlineImagePayload(
        result,
        ['image', 'imageUrl', 'archiveId', 'localArchive', 'archive', 'preview', 'dataUrl', 'result'],
      )).length;
    }
    if (optionSorter.styleSample?.hasImage && !optionSorter.styleSample.image) count += 1;
  }
  if (activeStep === 'factory') {
    const factory = canonicalFactory;
    const hasCurrentProductImage = hasInlineImagePayload(state, ['imageBase64', 'imagePreview'])
      || hasInlineImagePayload(factory.product, ['imageBase64', 'imagePreview', 'imageUrl']);
    if (factory.product?.hasImage && !hasCurrentProductImage) count += 1;
    if (Array.isArray(factory.product?.inputImages)) {
      const missingProductInputs = factory.product.inputImages.filter(img => (
        img?.hasImage && !hasInlineImagePayload(img, ['base64', 'preview', 'image', 'imageUrl', 'dataUrl'])
      ));
      count += missingProductInputs.filter(img => {
        const referenceFingerprint = String(img.inputImageFingerprint || '').trim();
        if (!referenceFingerprint) {
          return !currentProductImageFingerprint || missingProductInputs.length !== 1;
        }
        return referenceFingerprint !== currentProductImageFingerprint;
      }).length;
    }
    if (Array.isArray(factory.assets)) {
      count += factory.assets.filter(asset => (
        asset?.hasImage
        && asset.archived !== true
        && asset.rejected !== true
        && !hasInlineImagePayload(asset, ['image', 'imageUrl', 'preview', 'base64', 'dataUrl', 'result', 'archiveId'])
      )).length;
    }
  }
  return count;
}

function wasStorageWarningDismissed(key) {
  if (!key) return false;
  try { return sessionStorage.getItem(STORAGE_WARNING_DISMISSED_SESSION_KEY) === key; } catch(e) { return false; }
}

function dismissCurrentStorageWarning() {
  if (state.storageWarningDismissKey && String(state.storageWarning || '').includes('저장된 이미지 복원')) {
    try { sessionStorage.setItem(STORAGE_WARNING_DISMISSED_SESSION_KEY, state.storageWarningDismissKey); } catch(e) {}
  }
  state.storageWarning = '';
  state.storageWarningDismissKey = '';
}

function showImageRestoreWarningIfNeeded() {
  const missingCount = countSessionAssetRestoreRefs();
  if (!missingCount) {
    if (!String(state.storageWarning || '').includes('저장된 이미지 복원')) return false;
    state.storageWarning = '';
    state.storageWarningDismissKey = '';
    return true;
  }
  const key = `image-restore:${state.currentProjectId || state.analysisTimestamp || 'session'}:${state.step || ''}:${missingCount}`;
  if (wasStorageWarningDismissed(key)) return false;
  const factory = state.step === 'factory' && typeof factoryRuntimeReadFactory === 'function'
    ? factoryRuntimeReadFactory()
    : null;
  const restoredOutputCount = Array.isArray(factory?.assets)
    ? factory.assets.filter(asset => (
      asset?.hasImage
      && asset.archived !== true
      && asset.rejected !== true
      && hasInlineImagePayload(asset, ['image', 'imageUrl', 'preview', 'base64', 'dataUrl', 'result', 'archiveId'])
    )).length
    : 0;
  const recoveryGuide = restoredOutputCount
    ? ' 원본이 필요한 재생성만 다시 업로드해주세요.'
    : ' 저장된 작업이 있다면 작업공간에서 다시 불러오거나 원본을 다시 업로드해주세요.';
  state.storageWarning = restoredOutputCount
    ? `저장된 이미지 복원: 대표·생성 결과 ${restoredOutputCount}개를 로컬 보관함에서 정상 복원했습니다. 다만 ${missingCount}개 이미지 원본은 현재 브라우저 저장소에서 읽지 못했습니다.${recoveryGuide}`
    : `저장된 이미지 복원에 실패했습니다. ${missingCount}개 이미지 원본을 현재 브라우저 저장소에서 읽지 못했습니다.${recoveryGuide}`;
  state.storageWarningDismissKey = key;
  return true;
}

function mergeOptionSorterStoredImages(current = {}, incoming = {}) {
  const mergeRows = (currentRows, incomingRows, keyOf) => {
    const currentByKey = new Map((Array.isArray(currentRows) ? currentRows : []).map((row, index) => [keyOf(row, index), row]));
    const incomingKeys = new Set();
    const rows = (Array.isArray(incomingRows) ? incomingRows : []).map((row, index) => {
      const key = keyOf(row, index);
      const stored = currentByKey.get(key);
      incomingKeys.add(key);
      return stored && row && typeof row === 'object' ? { ...stored, ...row } : row;
    });
    currentByKey.forEach((row, key) => {
      if (!incomingKeys.has(key)) rows.push(row);
    });
    return rows;
  };
  const imageKey = (image, index) => String(image?.archiveId || image?.localArchive?.archiveId || image?.id || `image-${index}`);
  const resultKey = (result, index) => String(result?.id || result?.archiveId || result?.createdAt || `result-${index}`);
  const logKey = (log, index) => String(log?.id || `${log?.time || ''}:${log?.message || ''}` || `log-${index}`);
  const incomingDeletedArchiveIds = new Set(Array.isArray(incoming.optionSourceDeletedArchiveIds) ? incoming.optionSourceDeletedArchiveIds.map(String) : []);
  const incomingClearedAt = Number(incoming.optionSourceClearedAt || 0) || 0;
  const currentClearedAt = Number(current.optionSourceClearedAt || 0) || 0;
  const sourceExplicitlyCleared = incomingClearedAt > currentClearedAt && !(Array.isArray(incoming.images) && incoming.images.length);
  const currentImagesByKey = new Map((Array.isArray(current.images) ? current.images : []).map((image, index) => [imageKey(image, index), image]));
  const mergedImages = sourceExplicitlyCleared
    ? []
    : mergeRows(current.images, incoming.images, imageKey)
      .map((image, index) => {
        const stored = currentImagesByKey.get(imageKey(image, index)) || {};
        return {
          ...stored,
          ...image,
          id: stored?.id || image?.id || `image-${index}`,
          base64: image?.base64 || stored?.base64 || '',
          preview: image?.preview || stored?.preview || '',
          dataUrl: image?.dataUrl || stored?.dataUrl || '',
          imageUrl: image?.imageUrl || stored?.imageUrl || '',
          imagePersistence: image?.imagePersistence || stored?.imagePersistence
            || ((image?.archiveId || image?.localArchive?.archiveId || stored?.archiveId || stored?.localArchive?.archiveId)
              ? 'local-archive-url'
              : ''),
        };
      })
      .filter(image => {
        const archiveId = String(image?.archiveId || image?.localArchive?.archiveId || '');
        return !archiveId || !incomingDeletedArchiveIds.has(archiveId);
      });
  const canonicalImageIds = new Map(mergedImages.map((image, index) => [imageKey(image, index), String(image?.id || '')]));
  const imageIdAliases = new Map();
  [current.images, incoming.images].forEach(images => (Array.isArray(images) ? images : []).forEach((image, index) => {
    const id = String(image?.id || '').trim();
    const canonicalId = canonicalImageIds.get(imageKey(image, index));
    if (id && canonicalId) imageIdAliases.set(id, canonicalId);
  }));
  const canonicalizeImageIds = ids => Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map(id => imageIdAliases.get(String(id)) || String(id))
    .filter(Boolean)));
  const currentSlotRows = Array.isArray(current.slots) ? current.slots : [];
  const currentSlots = new Map(currentSlotRows.map((slot, index) => [String(slot?.id || `slot_${index + 1}`), slot]));
  const matchedCurrentSlotIds = new Set();
  const mergedSlots = (incoming.slots || []).map((slot, index) => {
    const id = String(slot?.id || `slot_${index + 1}`);
    const incomingName = String(slot?.name || '').trim();
    const genericIncomingName = !incomingName || optionSorterSlotNameIsGeneric(incomingName);
    const exactStored = currentSlots.get(id);
    const positionalStored = exactStored ? null : currentSlotRows[index];
    const positionalPlaceholder = !String(positionalStored?.name || '').trim()
      || optionSorterSlotNameIsGeneric(positionalStored?.name);
    const matchedStored = exactStored || (positionalStored && (positionalPlaceholder || genericIncomingName) ? positionalStored : null);
    const stored = matchedStored || {};
    if (matchedStored) matchedCurrentSlotIds.add(String(matchedStored?.id || `slot_${index + 1}`));
    const storedName = String(stored?.name || '').trim();
    const keepStoredIdentity = !exactStored && matchedStored
      && !optionSorterSlotNameIsGeneric(storedName) && genericIncomingName;
    return {
      ...stored,
      ...slot,
      id: keepStoredIdentity ? String(stored?.id || `slot_${index + 1}`) : id,
      name: genericIncomingName && storedName && !optionSorterSlotNameIsGeneric(storedName) ? storedName : (incomingName || storedName),
      imgIds: canonicalizeImageIds([...(stored?.imgIds || []), ...(slot?.imgIds || [])]),
    };
  });
  if (!sourceExplicitlyCleared) {
    currentSlots.forEach((slot, id) => {
      if (!matchedCurrentSlotIds.has(id)) mergedSlots.push(slot);
    });
  }
  const currentResultsByKey = new Map((Array.isArray(current.optionResults) ? current.optionResults : []).map((result, index) => [resultKey(result, index), result]));
  const optionResults = mergeRows(current.optionResults, incoming.optionResults, resultKey).map((result, index) => {
    const stored = currentResultsByKey.get(resultKey(result, index)) || {};
    const storedSplitImages = Array.isArray(stored.splitImages) ? stored.splitImages : [];
    return {
      ...stored,
      ...result,
      image: result?.image || stored?.image || null,
      imageUrl: result?.imageUrl || stored?.imageUrl || '',
      archiveId: result?.archiveId || stored?.archiveId || '',
      resultAssetId: result?.resultAssetId || stored?.resultAssetId || '',
      imagePersistence: result?.imagePersistence || stored?.imagePersistence || '',
      hasImage: result?.hasImage === true || stored?.hasImage === true,
      splitImages: Array.isArray(result?.splitImages) && result.splitImages.length
        ? result.splitImages.map((item, splitIndex) => ({
          ...(storedSplitImages[splitIndex] || {}),
          ...item,
          image: item?.image || storedSplitImages[splitIndex]?.image || null,
        }))
        : storedSplitImages,
    };
  });
  const currentSubStepUpdatedAt = Math.max(0, Number(current.subStepUpdatedAt || 0) || 0);
  const incomingSubStepUpdatedAt = Math.max(0, Number(incoming.subStepUpdatedAt || 0) || 0);
  const currentSubStep = current.subStep === 'sort' ? 'sort' : 'input';
  const incomingSubStep = incoming.subStep === 'sort' ? 'sort' : 'input';
  const hasMappedWork = value => (
    (Array.isArray(value?.optionResults) && value.optionResults.length > 0)
    || (Array.isArray(value?.slots) && value.slots.some(slot => Array.isArray(slot?.imgIds) && slot.imgIds.length > 0))
  );
  const subStep = incomingSubStepUpdatedAt > currentSubStepUpdatedAt
    ? incomingSubStep
    : (currentSubStepUpdatedAt > incomingSubStepUpdatedAt
      ? currentSubStep
      : ((currentSubStep === 'sort' || incomingSubStep === 'sort' || hasMappedWork(current) || hasMappedWork(incoming)) ? 'sort' : 'input'));
  return {
    ...current,
    ...incoming,
    images: mergedImages,
    slots: mergedSlots,
    pool: sourceExplicitlyCleared ? [] : canonicalizeImageIds([...(incoming.pool || []), ...(current.pool || [])])
      .filter(id => mergedImages.some(image => String(image?.id || '') === id)),
    optionResults,
    optionLastGeneratedResultIds: Array.from(new Set([...(incoming.optionLastGeneratedResultIds || []), ...(current.optionLastGeneratedResultIds || [])]))
      .filter(id => optionResults.some(result => String(result?.id || '') === String(id))),
    optionGenLogs: mergeRows(current.optionGenLogs, incoming.optionGenLogs, logKey),
    subStep,
    subStepUpdatedAt: Math.max(currentSubStepUpdatedAt, incomingSubStepUpdatedAt),
    optionSourceDeletedArchiveIds: Array.from(new Set([
      ...(current.optionSourceDeletedArchiveIds || []),
      ...(incoming.optionSourceDeletedArchiveIds || []),
    ])),
  };
}

function mergeSameWorkDerivedValue(current, incoming) {
  const hasValue = value => (
    Array.isArray(value) ? value.length > 0
      : value && typeof value === 'object' ? Object.keys(value).length > 0
        : typeof value === 'string' ? !!value.trim()
          : value !== null && value !== undefined
  );
  if (!hasValue(incoming)) return current;
  if (!hasValue(current)) return incoming;
  if (Array.isArray(current) && Array.isArray(incoming)) {
    return incoming
      .map((value, index) => mergeSameWorkDerivedValue(current[index], value))
      .concat(current.slice(incoming.length));
  }
  if (
    current && incoming
    && typeof current === 'object' && typeof incoming === 'object'
    && !Array.isArray(current) && !Array.isArray(incoming)
  ) {
    return Object.fromEntries(Array.from(new Set([
      ...Object.keys(current),
      ...Object.keys(incoming),
    ])).map(key => [key, mergeSameWorkDerivedValue(current[key], incoming[key])]));
  }
  return incoming;
}

function mergeCompMarketStoredState(current = {}, incoming = {}) {
  const mergeRows = (currentRows, incomingRows, keyOf) => {
    const storedRows = Array.isArray(currentRows) ? currentRows : [];
    const incomingRowsList = Array.isArray(incomingRows) ? incomingRows : [];
    const storedByKey = new Map(storedRows.map((row, index) => [keyOf(row, index), row]));
    const seen = new Set();
    const merged = [];
    incomingRowsList.forEach((row, index) => {
      const key = keyOf(row, index);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(mergeSameWorkDerivedValue(storedByKey.get(key), row));
    });
    storedRows.forEach((row, index) => {
      const key = keyOf(row, index);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(row);
    });
    return merged;
  };
  const candidateKey = (row, index) => String(
    row?.id
    || row?.product_id
    || row?.product_no
    || row?.product_url
    || row?.url
    || row?.link
    || [row?.platform || row?.site, row?.title || row?.name, row?.price].map(value => String(value || '').trim()).filter(Boolean).join(':')
    || `candidate-${index}`
  );
  const imageKey = (row, index) => String(row?.id || row?.src || row?.url || row?.sourcePath || `image-${index}`);
  const logKey = (row, index) => String(row?.id || `${row?.time || ''}:${row?.message || ''}` || `log-${index}`);
  const mergeGrouped = (currentGroups, incomingGroups) => Object.fromEntries(
    Array.from(new Set([
      ...Object.keys(currentGroups && typeof currentGroups === 'object' ? currentGroups : {}),
      ...Object.keys(incomingGroups && typeof incomingGroups === 'object' ? incomingGroups : {}),
    ])).map(siteId => [siteId, mergeRows(currentGroups?.[siteId], incomingGroups?.[siteId], candidateKey)])
  );
  const currentSelectionVersion = Math.max(0, Number(current.detailSelectionVersion || 0) || 0);
  const incomingSelectionVersion = Math.max(0, Number(incoming.detailSelectionVersion || 0) || 0);
  const incomingSelectionIsNewer = incomingSelectionVersion > currentSelectionVersion;
  const mergedSelection = key => incomingSelectionIsNewer
    ? Array.from(new Set(incoming[key] || []))
    : Array.from(new Set([...(incoming[key] || []), ...(current[key] || [])]));
  return {
    ...current,
    ...incoming,
    results: Array.isArray(current.results) && Array.isArray(incoming.results)
      ? mergeRows(current.results, incoming.results, candidateKey)
      : mergeSameWorkDerivedValue(current.results, incoming.results),
    vmResults: mergeRows(current.vmResults, incoming.vmResults, candidateKey),
    localResults: mergeRows(current.localResults, incoming.localResults, candidateKey),
    groupedResults: mergeGrouped(current.groupedResults, incoming.groupedResults),
    vmGroupedResults: mergeGrouped(current.vmGroupedResults, incoming.vmGroupedResults),
    localGroupedResults: mergeGrouped(current.localGroupedResults, incoming.localGroupedResults),
    selectedIds: mergedSelection('selectedIds'),
    scrapedImages: mergeRows(current.scrapedImages, incoming.scrapedImages, imageKey),
    selectedImageIds: mergedSelection('selectedImageIds'),
    detailSelectionVersion: Math.max(currentSelectionVersion, incomingSelectionVersion),
    detailResults: incoming.detailResults && typeof incoming.detailResults === 'object'
      ? mergeSameWorkDerivedValue(current.detailResults || {}, incoming.detailResults)
      : (current.detailResults || incoming.detailResults || null),
    logs: mergeRows(current.logs, incoming.logs, logKey),
  };
}

function recoverStaleSessionInlineImages(assets = {}) {
  if (!lastWorkSnapshotMatchesCurrentWorkspace(assets)) return false;
  const storedImages = assets?.optionSorter?.images || [];
  const currentImages = state.optionSorter?.images || [];
  if (!storedImages.length || !currentImages.length) return false;
  const currentById = new Map(currentImages.map(image => [String(image?.id || ''), image]));
  const hasPayload = image => hasInlineImagePayload(image, ['base64', 'preview', 'dataUrl']);
  const canRecover = storedImages.some(image => {
    const current = currentById.get(String(image?.id || ''));
    return current && !hasPayload(current) && hasPayload(image);
  });
  if (!canRecover) return false;
  state.optionSorter = normalizeOptionSorterState({
    ...mergeOptionSorterStoredImages(assets.optionSorter, state.optionSorter || {}),
    optionGenRunning: false,
  });
  return true;
}

function restoreCutsSourceFromCurrentProductImage(cuts = state.cuts, factory = {}) {
  if (!cuts || typeof cuts !== 'object') return false;
  const usableValue = value => {
    const normalized = String(value || '').trim();
    return normalized && normalized !== IMAGE_STORED_MARKER ? normalized : '';
  };
  if (usableValue(cuts.sourceBase64) || usableValue(cuts.sourcePreview)) return false;
  const resultRows = [
    ...(Array.isArray(cuts.prompts) ? cuts.prompts : []),
    ...(Array.isArray(cuts.sizePrompts) ? cuts.sizePrompts : []),
  ];
  const hasPersistedResult = resultRows.some(row => (
    usableValue(row?.result) ||
    usableValue(row?.imageUrl) ||
    row?.hasResult === true
  ));
  if (!hasPersistedResult) return false;
  const analysisImage = (Array.isArray(state.analysisImages) ? state.analysisImages : [])
    .find(image => usableValue(image?.base64) || /^data:image\/[^;,]+;base64,/i.test(usableValue(image?.preview)));
  const candidates = [
    {
      base64: state.imageBase64,
      preview: state.imagePreview,
      mime: state.imageMime,
    },
    {
      base64: factory?.product?.imageBase64,
      preview: factory?.product?.imagePreview,
      mime: factory?.product?.imageMime,
    },
    analysisImage,
  ];
  let source = null;
  for (const candidate of candidates) {
    const rawBase64 = usableValue(candidate?.base64);
    const rawPreview = usableValue(candidate?.preview);
    const dataUrlMatch = /^data:(image\/[^;,]+);base64,(.+)$/i.exec(rawBase64 || rawPreview);
    const base64 = String(dataUrlMatch?.[2] || rawBase64 || '').replace(/\s+/g, '');
    if (!base64) continue;
    source = {
      base64,
      mime: String(candidate?.mime || dataUrlMatch?.[1] || 'image/png').trim() || 'image/png',
    };
    break;
  }
  if (!source) return false;
  const preview = `data:${source.mime};base64,${source.base64}`;
  cuts.sourceBase64 = source.base64;
  cuts.sourceMime = source.mime;
  cuts.sourcePreview = preview;
  cuts.hasSourceImage = true;
  const sizeStage = cuts.sizeFactoryStageId === 'size' || cuts.factoryStageId === 'size';
  const hasExplicitWorkImage = !!(usableValue(cuts.workImageBase64) || usableValue(cuts.workImagePreview));
  if (sizeStage && !hasExplicitWorkImage) {
    cuts.workImageBase64 = source.base64;
    cuts.workImageMime = source.mime;
    cuts.workImagePreview = preview;
    cuts.hasWorkImage = true;
  }
  return true;
}

function workspaceImagePayloadFingerprint(payload = {}) {
  if (!payload || typeof payload !== 'object') return '';
  try {
    if (typeof factoryCurrentVisualImageFingerprint === 'function') {
      return factoryCurrentVisualImageFingerprint(
        payload.base64 || '',
        payload.mime || payload.mimeType || 'image/png',
        payload.preview || payload.dataUrl || payload.image || '',
      );
    }
  } catch (_) {}
  return '';
}

function workspaceValidatedImageStatePayload({ direct = {}, images = [] } = {}, expectedFingerprint = '') {
  const expected = String(expectedFingerprint || '').trim();
  const rows = [direct, ...(Array.isArray(images) ? images : [])]
    .filter(row => row && typeof row === 'object');
  if (!expected) {
    return {
      payload: rows[0] || null,
      images: Array.isArray(images) ? images : [],
      blocked: false,
    };
  }
  const fingerprinted = rows
    .map(row => ({ row, fingerprint: workspaceImagePayloadFingerprint(row) }))
    .filter(item => item.fingerprint);
  const matching = fingerprinted.find(item => item.fingerprint === expected)?.row || null;
  const marker = rows.find(row => (
    !workspaceImagePayloadFingerprint(row)
    && (row.preview === IMAGE_STORED_MARKER || row.preview === '__stored_in_indexeddb__')
  )) || null;
  const validatedImages = (Array.isArray(images) ? images : []).filter(row => {
    const fingerprint = workspaceImagePayloadFingerprint(row);
    return !fingerprint || fingerprint === expected;
  });
  return {
    payload: matching || marker,
    images: validatedImages,
    blocked: fingerprinted.length > 0 && !matching,
  };
}

function applySessionAssetsPayload(assets, options = {}) {
  if (!assets || typeof assets !== 'object') return false;
  const identityBoundary = validateIncomingWorkspaceBoundary(assets, options);
  if (!identityBoundary.ok) return false;
  if (identityBoundary.identity
    && (options.replaceWorkspace === true || !state.workIdentity)) {
    state.workIdentity = cloneData(identityBoundary.identity);
  }
  if (workspaceBlankResetInProgress && options.forceProductRestore !== true) return false;
  const matchesWorkspace = options.takeoverAuthority
    ? lastWorkSnapshotMatchesTakeoverWorkspace(assets, options.takeoverAuthority)
    : lastWorkSnapshotMatchesCurrentWorkspace(assets);
  if (options.forceWorkspaceRestore !== true && !matchesWorkspace) return false;
  const preserveCurrentWork = options.replaceWorkspace !== true && matchesWorkspace;
  const hasRestoreValue = value => (
    Array.isArray(value) ? value.length > 0
      : value && typeof value === 'object' ? Object.keys(value).length > 0
        : typeof value === 'string' ? !!value.trim()
          : value !== null && value !== undefined
  );
  const restoreIncomingValue = (incoming, current) => {
    if (!preserveCurrentWork || !hasRestoreValue(current)) return incoming;
    if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)
      && current && typeof current === 'object' && !Array.isArray(current)) {
      return { ...incoming, ...current };
    }
    return current;
  };
  if (options.forceRevisionRestore !== true
    && !workspaceRevisionAllowsSnapshot(assets, { allowEqual: options.allowEqualRevision === true })) return false;
  restoreLastWorkProjectIdentityFromAssets(assets);
  const preserveInlineImages = options.preserveInlineImages === true && (
    assets.imagePersistence?.mode === 'inline' || options.allowScopedInlineImages === true
  );
  let preserveRestoredFactoryAssetScope = options.forceProductRestore === true
    && lastWorkFactoryHasSelfConsistentCurrentAssets(assets);
  assets = preserveInlineImages
    ? (options.payloadAlreadyCloned === true ? assets : cloneData(assets))
    : stripRuntimeAssetsForApply(assets);
  const currentFactorySnapshot = factoryRuntimeReadFactory();
  const rawIncomingFactory = assets.factory && typeof assets.factory === 'object'
    ? assets.factory
    : null;
  const forceIncomingFactory = options.forceProductRestore === true && !!rawIncomingFactory;
  const productScopeTargetName = String(
    options.targetName ||
    (preserveInlineImages ? lastWorkPayloadProductName(assets) : '') ||
    rawIncomingFactory?.product?.productName ||
    currentFactorySnapshot?.product?.productName ||
    state.productName ||
    lastWorkPayloadProductName(assets) ||
    ''
  ).trim();
  assets = sanitizeLastWorkPayloadProductScope(assets, {
    targetName: productScopeTargetName,
    mutate: true,
  });
  const useIncomingFactory = (forceIncomingFactory || preserveInlineImages || preserveRestoredFactoryAssetScope)
    && assets.factory && typeof assets.factory === 'object';
  const factoryForHydration = useIncomingFactory && typeof factoryPreserveProgressForSameWork === 'function'
    ? factoryPreserveProgressForSameWork(assets.factory, currentFactorySnapshot)
    : (useIncomingFactory ? assets.factory : currentFactorySnapshot);
  let workingFactory = normalizeFactoryState(cloneData(factoryForHydration));
  let changed = !!assets.__productScopeCleaned;
  const incomingInputImageFingerprint = String(
    assets.inputImageFingerprint
      || assets.workIdentity?.initialInputImageFingerprint
      || workingFactory?.product?.lockedInputImageFingerprint
      || workingFactory?.product?.inputImageFingerprint
      || ''
  ).trim();
  const validatedIncomingImage = workspaceValidatedImageStatePayload({
    direct: {
      base64: assets.imageBase64 || '',
      mime: assets.imageMime || workingFactory?.product?.imageMime || 'image/png',
      preview: assets.imagePreview || '',
      name: assets.imageName || workingFactory?.product?.imageName || '제품사진',
    },
    images: Array.isArray(assets.analysisImages) ? assets.analysisImages : [],
  }, incomingInputImageFingerprint);
  if (validatedIncomingImage.blocked) {
    state.storageWarning = '작업 지문과 다른 입력 이미지 복구본을 차단했습니다. 현재 작업의 기본 이미지를 다시 선택해주세요.';
    state.storageWarningDismissKey = `foreign-input-image:${incomingInputImageFingerprint}`;
  }
  const incomingFactoryForIdentity = assets.factory && typeof assets.factory === 'object'
    ? assets.factory
    : { product: { productName: assets.productName || '' } };
  const currentFactoryForIdentity = {
    ...currentFactorySnapshot,
    product: {
      ...(currentFactorySnapshot.product || {}),
      productName: (currentFactorySnapshot.product?.productName || state.productName || ''),
    },
  };
  const incomingKey = typeof factoryIdentityKey === 'function' ? factoryIdentityKey(incomingFactoryForIdentity) : '';
  const currentKey = typeof factoryIdentityKey === 'function' ? factoryIdentityKey(currentFactoryForIdentity) : '';
  const currentHasProductWork = !!(
    currentKey ||
    state.imageBase64 ||
    (state.imagePreview && state.imagePreview !== '__stored_in_indexeddb__') ||
    (typeof factoryProductHasImage === 'function' && factoryProductHasImage(workingFactory.product || {}))
  );
  const blockForeignProductRestore = !options.forceProductRestore && !!(incomingKey && currentHasProductWork && (!currentKey || currentKey !== incomingKey));
  if (blockForeignProductRestore) {
    state.storageWarning = '서로 다른 상품의 마지막 작업 저장본이 감지되어 DB/내용 복원을 건너뛰고 현재 제품 사진 작업을 유지했습니다.';
    state.storageWarningDismissKey = `foreign-last-work:${currentKey || 'image-only'}:${incomingKey}`;
    return false;
  }
  if (assets.analysis && typeof assets.analysis === 'object') {
    state.analysis = cloneData(restoreIncomingValue(assets.analysis, state.analysis));
    changed = true;
  }
  if (assets.competitorData !== undefined) {
    state.competitorData = cloneData(restoreIncomingValue(assets.competitorData || null, state.competitorData));
    changed = true;
  }
  if (typeof assets.productName === 'string' && assets.productName) {
    if (typeof factorySetCurrentProductIdentity === 'function') {
      factorySetCurrentProductIdentity(assets.productName, { factory: workingFactory, syncDom: false, setSearchQuery: false, syncFinal: false });
    } else {
      state.productName = assets.productName;
    }
    changed = true;
  }
  if (assets.analysisTimestamp) {
    state.analysisTimestamp = assets.analysisTimestamp;
    changed = true;
  }
  if (Array.isArray(assets.analysisRuns)) {
    state.analysisRuns = cloneData(restoreIncomingValue(assets.analysisRuns, state.analysisRuns));
    changed = true;
  }
  if (typeof assets.currentAnalysisRunId === 'string') {
    state.currentAnalysisRunId = assets.currentAnalysisRunId;
    changed = true;
  }
  if (Array.isArray(assets.dbMatchCandidates)) {
    const targetKey = typeof factoryNormalizeIdentityText === 'function'
      ? factoryNormalizeIdentityText(workingFactory.product?.productName || state.productName || '')
      : '';
    state.dbMatchCandidates = cloneData(assets.dbMatchCandidates)
      .filter(item => !(targetKey && typeof factoryObjectConflictsWithIdentity === 'function' && factoryObjectConflictsWithIdentity(item, targetKey)));
    changed = true;
  }
  if (typeof assets.dbMatchLastQuery === 'string') {
    state.dbMatchLastQuery = assets.dbMatchLastQuery;
    changed = true;
  }
  if (assets.dbMatchSelectionOpen !== undefined) {
    state.dbMatchSelectionOpen = !!assets.dbMatchSelectionOpen;
    changed = true;
  }
  if (Array.isArray(assets.dbColorOptions)) {
    state.dbColorOptions = cloneData(assets.dbColorOptions);
    changed = true;
  }
  if (typeof assets.dbColorOptionsLastJcode === 'string') {
    state.dbColorOptionsLastJcode = assets.dbColorOptionsLastJcode;
    changed = true;
  }
  if (assets.dbColorOptionsLoadedAt !== undefined) {
    state.dbColorOptionsLoadedAt = Number.isFinite(assets.dbColorOptionsLoadedAt) ? assets.dbColorOptionsLoadedAt : null;
    changed = true;
  }
  if (assets.productInfoManualValues && typeof assets.productInfoManualValues === 'object') {
    state.productInfoManualValues = normalizeProductInfoManualValues(
      restoreIncomingValue(assets.productInfoManualValues, state.productInfoManualValues),
    );
    changed = true;
  }
  // Factory work does not require an analysis object. During startup the
  // authority fence can make the synchronous tab-session read temporarily
  // unavailable, so the scoped IndexedDB assets become the restore source.
  // Keep their factory route instead of leaving the otherwise-restored work
  // stranded on the default upload screen.
  if (assets.step && state.step === 'upload' && (state.analysis || assets.step === 'factory')) {
    state.step = assets.step === 'analyzing' || assets.step === 'generating' ? 'sections' : assets.step;
    changed = true;
  }
  if (validatedIncomingImage.payload?.preview
    && state.imagePreview !== validatedIncomingImage.payload.preview
    && !(state.imageBase64 && validatedIncomingImage.payload.preview === IMAGE_STORED_MARKER)) {
    state.imagePreview = validatedIncomingImage.payload.preview;
    changed = true;
  }
  if (validatedIncomingImage.payload?.base64 && state.imageBase64 !== validatedIncomingImage.payload.base64) {
    state.imageBase64 = validatedIncomingImage.payload.base64;
    changed = true;
  }
  if (validatedIncomingImage.blocked && !validatedIncomingImage.payload?.base64) {
    state.imageBase64 = null;
    state.imagePreview = assets.imagePreview === IMAGE_STORED_MARKER ? IMAGE_STORED_MARKER : null;
    state.imageMime = '';
    changed = true;
  }
  if (assets.productImageBackup) {
    changed = applyProductImageBackupPayload(assets.productImageBackup, {
      restoreInline: true,
      force: options.forceProductRestore === true,
      factory: workingFactory,
      syncMarket: false,
    }) || changed;
  }
  if (assets.sectionContents && typeof assets.sectionContents === 'object') {
    state.sectionContents = cloneData(restoreIncomingValue(assets.sectionContents, state.sectionContents));
    changed = true;
  }
  if (assets.sectionInstructionSources && typeof assets.sectionInstructionSources === 'object') {
    state.sectionInstructionSources = cloneData(restoreIncomingValue(assets.sectionInstructionSources, state.sectionInstructionSources));
    changed = true;
  }
  if (assets.sectionGenerationModes && typeof assets.sectionGenerationModes === 'object') {
    state.sectionGenerationModes = typeof normalizeSectionGenerationModes === 'function'
      ? normalizeSectionGenerationModes(assets.sectionGenerationModes)
      : cloneData(assets.sectionGenerationModes);
    changed = true;
  }
  if (assets.sectionBasisModes && typeof assets.sectionBasisModes === 'object') {
    state.sectionBasisModes = typeof normalizeSectionBasisModes === 'function'
      ? normalizeSectionBasisModes(assets.sectionBasisModes)
      : cloneData(assets.sectionBasisModes);
    changed = true;
  }
  if (assets.sectionAssembly && typeof assets.sectionAssembly === 'object') {
    state.sectionAssembly = typeof normalizeSectionAssembly === 'function'
      ? normalizeSectionAssembly(assets.sectionAssembly)
      : cloneData(assets.sectionAssembly);
    changed = true;
  }
  if (typeof assets.sectionBatchBasisMode === 'string') {
    state.sectionBatchBasisMode = assets.sectionBatchBasisMode || state.sectionBatchBasisMode || 'keep';
    changed = true;
  }
  if (typeof assets.sectionBatchGenerationMode === 'string') {
    state.sectionBatchGenerationMode = assets.sectionBatchGenerationMode || state.sectionBatchGenerationMode || 'keep';
    changed = true;
  }
  if (assets.sectionGenerationMeta && typeof assets.sectionGenerationMeta === 'object') {
    state.sectionGenerationMeta = cloneData(restoreIncomingValue(assets.sectionGenerationMeta, state.sectionGenerationMeta));
    changed = true;
  }
  if (Array.isArray(assets.sectionOrder) && assets.sectionOrder.length) {
    state.sectionOrder = cloneData(assets.sectionOrder).filter(Boolean);
    changed = true;
  }
  if (Array.isArray(assets.hiddenSectionIds)) {
    state.hiddenSectionIds = cloneData(restoreIncomingValue(assets.hiddenSectionIds, state.hiddenSectionIds)).filter(Boolean);
    changed = true;
  }
  if (Array.isArray(assets.customSections)) {
    state.customSections = cloneData(restoreIncomingValue(assets.customSections, state.customSections));
    changed = true;
  }
  if (Array.isArray(assets.analysisImages)) {
    const validatedAnalysisImages = restoreIncomingValue(validatedIncomingImage.images || [], state.analysisImages);
    state.analysisImages = preserveInlineImages
      ? cloneData(validatedAnalysisImages)
      : stripRuntimeAnalysisImages(validatedAnalysisImages);
    if (state.analysisImages.length > 0) {
      state.imagePreview = (preserveInlineImages ? displayableImageSrc(state.analysisImages[0].preview) : runtimeExternalImageSrc(state.analysisImages[0].preview)) || state.imagePreview;
      state.imageMime = state.analysisImages[0].mime || state.imageMime;
    }
    changed = true;
  }
  if (assets.sectionImages && typeof assets.sectionImages === 'object') {
    const incomingSectionImages = restoreIncomingValue(assets.sectionImages, state.sectionImages);
    state.sectionImages = mergeRuntimeSectionImages(state.sectionImages, incomingSectionImages, {
      preserveInlineImages,
    });
    changed = true;
  }
  if (Array.isArray(assets.detailImageBlocks)) {
    const incomingDetailBlocks = restoreIncomingValue(assets.detailImageBlocks, state.detailImageBlocks);
    state.detailImageBlocks = preserveInlineImages
      ? cloneData(incomingDetailBlocks)
      : stripRuntimeDetailBlockImages(incomingDetailBlocks);
    changed = true;
  }
  if (assets.sectionVariants && typeof assets.sectionVariants === 'object') {
    const incomingSectionVariants = restoreIncomingValue(assets.sectionVariants, state.sectionVariants);
    state.sectionVariants = preserveInlineImages
      ? cloneData(incomingSectionVariants)
      : stripRuntimeVariantImages(incomingSectionVariants);
    changed = true;
  }
  if (assets.currentSectionVariantIds && typeof assets.currentSectionVariantIds === 'object') {
    state.currentSectionVariantIds = cloneData(restoreIncomingValue(assets.currentSectionVariantIds, state.currentSectionVariantIds));
    changed = true;
  }
  if (assets.sectionTipHelperApplied && typeof assets.sectionTipHelperApplied === 'object') {
    state.sectionTipHelperApplied = cloneData(restoreIncomingValue(assets.sectionTipHelperApplied, state.sectionTipHelperApplied));
    changed = true;
  }
  if (assets.sectionVariantEvaluations && typeof assets.sectionVariantEvaluations === 'object') {
    state.sectionVariantEvaluations = cloneData(restoreIncomingValue(assets.sectionVariantEvaluations, state.sectionVariantEvaluations));
    changed = true;
  }
  changed = restoreSectionContentsFromStoredVariants(state) || changed;
  if (assets.aiRepairUndoStack && typeof assets.aiRepairUndoStack === 'object') {
    state.aiRepairUndoStack = restoreIncomingValue(assets.aiRepairUndoStack, state.aiRepairUndoStack);
    changed = true;
  }
  if (assets.aiRepair && typeof assets.aiRepair === 'object') {
    state.aiRepair = { ...(state.aiRepair || {}), ...assets.aiRepair, open: false, busy: false, error: '' };
    changed = true;
  }
  if (assets.cuts && typeof assets.cuts === 'object') {
    const replaceWorkspace = options.replaceWorkspace === true;
    const currentCuts = state.cuts || {};
    const currentPrompts = Array.isArray(currentCuts.prompts) ? currentCuts.prompts : [];
    const incomingPrompts = Array.isArray(assets.cuts.prompts) ? assets.cuts.prompts : [];
    const currentPromptStamp = Number(currentCuts.promptsUpdatedAt || loadCutPromptsUpdatedAt() || 0);
    const incomingPromptStamp = Number(assets.cuts.promptsUpdatedAt || 0);
    const backupPromptState = replaceWorkspace
      ? { prompts: [], updatedAt: 0 }
      : loadBestCutPromptState({ prompts: incomingPrompts, promptsUpdatedAt: incomingPromptStamp });
    const mergedPromptState = chooseBestCutPromptState(replaceWorkspace
      ? [{ prompts: incomingPrompts, updatedAt: incomingPromptStamp }]
      : [
          { prompts: currentPrompts, updatedAt: currentPromptStamp },
          { prompts: incomingPrompts, updatedAt: incomingPromptStamp },
          backupPromptState,
        ]);
    const mergedPrompts = mergedPromptState.prompts.length ? mergedPromptState.prompts : currentPrompts;
    state.cuts = {
      ...currentCuts,
      ...(preserveInlineImages
        ? stripCutsRuntimeFlags(cloneData(assets.cuts || {}))
        : stripCutsImages(assets.cuts, {
            preserveRecentResults: true,
            generalResultLimit: 16,
            sizeResultLimit: 8,
          })),
      workDriveRunning: false,
      localArchiveSaving: false,
      promptsUpdatedAt: Math.max(currentPromptStamp, incomingPromptStamp, Number(mergedPromptState.updatedAt || 0)),
      prompts: (mergedPrompts.length ? mergedPrompts : incomingPrompts)
        .map(p => ({ ...p, generating: false })),
    };
    changed = true;
    changed = restoreCutsSourceFromCurrentProductImage(state.cuts, workingFactory) || changed;
  }
  if (assets.compPage && typeof assets.compPage === 'object') {
    const incomingAnalysisAt = Number(assets.compPage.analysisResult?.analyzedAt || assets.compPage.savedAt || assets.savedAt || 0) || 0;
    const currentAnalysisAt = getCurrentCompAnalysisTime();
    const hasIncomingDerivedCompState = !!(
      assets.compPage.analysisResult
      || (assets.compPage.sectionPlan && Object.keys(assets.compPage.sectionPlan).length)
      || (assets.compPage.planEdits && Object.keys(assets.compPage.planEdits).length)
    );
    if (hasIncomingDerivedCompState && (!state.compPage.analysisResult || incomingAnalysisAt >= currentAnalysisAt)) {
      applyCompAnalysisSnapshot(assets.compPage, assets.compPage.subStep || state.compPage.subStep || 'report');
      changed = true;
    }
    if (Array.isArray(assets.compPage.uploadedImages)) {
      state.compPage.uploadedImages = restoreIncomingValue(assets.compPage.uploadedImages, state.compPage.uploadedImages);
      changed = true;
    }
    if (Array.isArray(assets.compPage.evidenceImages)) {
      state.compPage.evidenceImages = restoreIncomingValue(assets.compPage.evidenceImages, state.compPage.evidenceImages);
      changed = true;
    }
    if (assets.compPage.marketScrape && typeof assets.compPage.marketScrape === 'object') {
      const currentMarket = state.compPage.marketScrape || {};
      const incomingMarket = sanitizeCompMarketScrapeForPersistence(assets.compPage.marketScrape);
      state.compPage.marketScrape = mergeCompMarketStoredState(currentMarket, incomingMarket);
      changed = true;
    }
  }
  const factoryCompetitorMarket = assets.factory?.competitors?.compPage?.marketScrape;
  if (factoryCompetitorMarket && typeof factoryCompetitorMarket === 'object') {
    const currentMarket = state.compPage.marketScrape || {};
    const incomingMarket = sanitizeCompMarketScrapeForPersistence(factoryCompetitorMarket);
    state.compPage.marketScrape = mergeCompMarketStoredState(currentMarket, incomingMarket);
    changed = true;
  }
  if (assets.optionSorter && typeof assets.optionSorter === 'object') {
    state.optionSorter = normalizeOptionSorterState({
      ...mergeOptionSorterStoredImages(state.optionSorter || {}, assets.optionSorter),
      optionGenRunning: false,
    });
    changed = true;
  }
  if (assets.factory && typeof assets.factory === 'object') {
    if (!preserveInlineImages) {
      workingFactory = forceIncomingFactory
        ? mergeFactoryStoredImages(workingFactory, currentFactorySnapshot, {
            keepLatestFactory: true,
            mediaOnly: true,
          })
        : mergeFactoryStoredImages(workingFactory, assets.factory);
    }
    const restoredCandidateWorkspaceId = factoryWorkspaceIdentityFromSource(workingFactory).id;
    const restoredWorkspaceId = resolveRestoredCandidateReviewWorkspaceId(
      restoredCandidateWorkspaceId,
      state.currentProjectId,
    );
    if (restoredWorkspaceId && typeof factoryRecoverRestoredReviewCandidateWorkspaceScope === 'function') {
      const migratedCandidateCount = factoryRecoverRestoredReviewCandidateWorkspaceScope(
        workingFactory,
        restoredCandidateWorkspaceId,
        restoredWorkspaceId,
        { productName: state.productName || workingFactory.product?.productName || '' }
      );
      changed = migratedCandidateCount > 0 || changed;
    }
    changed = true;
  }
  const restoredOptionSorter = restoreOptionSorterLabelsFromFactory(state.optionSorter || {}, workingFactory);
  if (restoredOptionSorter !== state.optionSorter) {
    state.optionSorter = normalizeOptionSorterState(restoredOptionSorter);
    changed = true;
  }
  const repairedRestoredDraftAssetScope = repairRestoredDraftFactoryAssetWorkspaceScope(workingFactory);
  preserveRestoredFactoryAssetScope = preserveRestoredFactoryAssetScope || repairedRestoredDraftAssetScope;
  changed = repairedRestoredDraftAssetScope || changed;
  changed = restoreSpecificationSizeImageFromFactory({ ...state, factory: workingFactory }) || changed;
  changed = repairRestoredSessionIdentityDrift('asset-payload', workingFactory) || changed;
  // 실어 온 작업의 기본 이미지는 이미지 저장소로 빠져 있어 본문에 바이트가 없을 수 있다.
  // 그 상태로 화면 쪽 이미지를 기준으로 맞추면 지문이 다르다고 판단해 새 run 을 발급하고,
  // 그 지문으로 만들어 둔 생성물 전량을 이전 자산으로 밀어낸다. 실측: 방울수저집 복원에서
  // 잠긴 지문이 190196(JPEG) 에서 6508820(다른 PNG) 으로 바뀌고 자산 30장이 밀려났다.
  const restoredProductScope = workingFactory?.product || {};
  const restoredHasInlineInputImage = !!(
    restoredProductScope.imageBase64
    || (restoredProductScope.imagePreview && restoredProductScope.imagePreview !== IMAGE_STORED_MARKER)
    || (Array.isArray(restoredProductScope.inputImages) && restoredProductScope.inputImages.some(image =>
      image?.base64 || (image?.preview && image.preview !== IMAGE_STORED_MARKER)))
  );
  const restoredInputImageAwaitingBytes = options.forceProductRestore === true
    && !!String(restoredProductScope.lockedInputImageFingerprint || '').trim()
    && !restoredHasInlineInputImage;
  if (!preserveRestoredFactoryAssetScope && !restoredInputImageAwaitingBytes
    && typeof syncProductImageAcrossWorkspaces === 'function') {
    changed = syncProductImageAcrossWorkspaces({
      preserveFactoryAssets: options.forceProductRestore === true && preserveInlineImages,
      // 다른 제품의 저장본을 일부러 실어 오는 복원에서는, 탭에 남아 있던 화면 이미지가
      // 아니라 실어 온 그 작업의 기본 이미지가 기준이다. 화면 이미지를 기준으로 삼으면
      // 지문이 다르다고 판단해 새 run 을 발급하고, 만들어 둔 생성물을 전부 이전 자산으로
      // 밀어낸다. 실측: 방울수저집 복원에서 자산 30장이 previousAssets 로 밀리고
      // 잠긴 지문이 190196(JPEG) 에서 6508820(다른 PNG) 으로 바뀌었다.
      prefer: options.forceProductRestore === true ? 'factory' : options.prefer,
      factory: workingFactory,
    }) || changed;
  }
  factoryRuntimeReplaceFactorySnapshot(workingFactory, {
    mode: 'hydrate',
    reason: 'session-assets-payload',
    workspaceId: state.currentProjectId,
    takeoverAuthority: options.takeoverAuthority,
    normalized: true,
    restorePayload: assets,
  });
  const acceptedRevision = observeWorkspaceRevisionSnapshot(assets);
  if (acceptedRevision) {
    state.workspaceRevision = acceptedRevision;
  }
  return changed;
}

function repairRestoredSessionIdentityDrift(reason = 'restore', factory) {
  if (typeof state === 'undefined' || !state) return false;
  const factoryProduct = factory?.product || {};
  const stateName = String(state.productName || factoryProduct.userProductName || '').trim();
  const factoryName = String(factoryProduct.productName || '').trim();
  const stateKey = typeof factoryNormalizeIdentityText === 'function'
    ? factoryNormalizeIdentityText(stateName)
    : stateName.replace(/\s+/g, '').toLowerCase();
  const factoryKey = typeof factoryNormalizeIdentityText === 'function'
    ? factoryNormalizeIdentityText(factoryName)
    : factoryName.replace(/\s+/g, '').toLowerCase();
  const targetName = stateName || factoryName;
  const targetKey = typeof factoryNormalizeIdentityText === 'function'
    ? factoryNormalizeIdentityText(targetName)
    : targetName.replace(/\s+/g, '').toLowerCase();
  if (!targetKey) return false;
  let changed = false;

  if (stateKey && factoryKey && stateKey !== factoryKey) {
    factoryProduct.productName = stateName;
    factoryProduct.userProductName = stateName;
    factoryProduct.confirmedDb = null;
    factoryProduct.finalDb = null;
    factoryProduct.selectedDbCandidateKey = '';
    factoryProduct.selectedCafe24CandidateKey = '';
    factoryProduct.dbCandidateResolution = '';
    factoryProduct.cafe24CandidateResolution = '';
    factoryProduct.cafe24DraftProductKey = '';
    factoryProduct.confirmedCafe24ProductKey = '';
    factoryProduct.dbLocked = false;
    if (factoryProduct.dbFieldSettings && typeof factoryProduct.dbFieldSettings === 'object') {
      factoryProductScopedFieldIdsForRepair().forEach(fieldId => {
        if (factoryProduct.dbFieldSettings[fieldId]) delete factoryProduct.dbFieldSettings[fieldId];
      });
    }
    changed = true;
  } else if (!stateName && factoryName && state.productName !== factoryName) {
    state.productName = factoryName;
    changed = true;
  }

  if (Array.isArray(state.dbMatchCandidates) && typeof factoryObjectConflictsWithIdentity === 'function') {
    const filtered = state.dbMatchCandidates.filter(item => !factoryObjectConflictsWithIdentity(item, targetKey));
    if (filtered.length !== state.dbMatchCandidates.length) {
      state.dbMatchCandidates = filtered;
      state.dbMatchSelectionOpen = filtered.length > 0 ? state.dbMatchSelectionOpen : false;
      changed = true;
    }
  }

  const manualValues = state.productInfoManualValues && typeof state.productInfoManualValues === 'object'
    ? state.productInfoManualValues
    : {};
  const manualProductKey = typeof factoryNormalizeIdentityText === 'function'
    ? factoryNormalizeIdentityText(manualValues.product_name || '')
    : String(manualValues.product_name || '').replace(/\s+/g, '').toLowerCase();
  if (manualProductKey && manualProductKey !== targetKey) {
    factoryProductScopedFieldIdsForRepair().forEach(fieldId => {
      if (manualValues[fieldId]) {
        delete manualValues[fieldId];
        changed = true;
      }
    });
    delete manualValues.product_name;
  }

  if (state.compPage?.marketScrape && typeof state.compPage.marketScrape === 'object') {
    const market = state.compPage.marketScrape;
    const marketKey = typeof factoryNormalizeIdentityText === 'function'
      ? factoryNormalizeIdentityText(market.productName || '')
      : String(market.productName || '').replace(/\s+/g, '').toLowerCase();
    const marketMatchesTarget = typeof factoryIdentityKeysCompatible === 'function'
      ? factoryIdentityKeysCompatible(marketKey, targetKey)
      : marketKey === targetKey;
    if (marketKey && !marketMatchesTarget) {
      state.compPage.marketScrape = null;
      changed = true;
    }
  }

  if (changed && !state.storageWarning) {
    state.storageWarning = `${targetName} 작업과 맞지 않는 이전 상품 데이터가 감지되어 자동으로 분리했습니다.`;
    state.storageWarningDismissKey = `identity-repair:${reason}:${targetKey}`;
  }
  return changed;
}

// 초안 범위는 **탭마다 새로 만들어진다**(draft:lastwork_...). 탭 저장소에만 적히기 때문에
// 탭을 닫으면 새 탭은 앞 탭이 저장한 내용을 영영 못 찾는다.
// 실측 2026-08-30: 그렇게 주인을 잃은 초안이 IndexedDB 에 **1,369개** 쌓여 있었다.
// 주인님 규칙은 "새 작업 누르기 전에는 아무것도 안 날아간다" 이므로, 번호를 잃어도 내용은 찾아준다.
// 번호 규칙 자체는 건드리지 않는다(탭을 여러 개 써도 안 섞이는 설계다).
// 대신 **마지막으로 쓴 초안 번호를 오래 남는 곳에 적어 두고**, 새 탭이 빈손일 때만 이어받는다.
const LAST_DRAFT_SCOPE_PREFERENCE_ID = 'lastDraftWorkspaceScope';
// 살아 있는 탭이 자기 초안 번호에 찍는 심장박동. 이것이 끊긴 초안만 '주인을 잃었다' 고 본다.
// 저장 계층을 타지 않고 localStorage 에 직접 쓴다 — 권위가 필요한 데이터가 아니라
// **탭이 아직 살아 있는가** 하는 휘발성 신호이고, 탭 사이에서 보여야 하기 때문이다.
const DRAFT_HEARTBEAT_KEY_PREFIX = 'kuasangse_draft_beat_v1:';
const DRAFT_HEARTBEAT_INTERVAL_MS = 15000;
const DRAFT_ORPHAN_AFTER_MS = 60000;
let draftHeartbeatTimer = null;

function writeDraftHeartbeat(scopeId) {
  const scope = String(scopeId || '').trim();
  if (!scope.startsWith('draft:')) return;
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${DRAFT_HEARTBEAT_KEY_PREFIX}${scope}`, String(Date.now()));
  } catch (_) {}
}

function readDraftHeartbeatAge(scopeId) {
  const scope = String(scopeId || '').trim();
  if (!scope.startsWith('draft:')) return Infinity;
  try {
    if (typeof localStorage === 'undefined') return Infinity;
    const raw = Number(localStorage.getItem(`${DRAFT_HEARTBEAT_KEY_PREFIX}${scope}`) || 0);
    if (!Number.isFinite(raw) || raw <= 0) return Infinity;
    return Date.now() - raw;
  } catch (_) {
    return Infinity;
  }
}

function clearDraftHeartbeat(scopeId) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(`${DRAFT_HEARTBEAT_KEY_PREFIX}${String(scopeId || '').trim()}`);
  } catch (_) {}
}

function startDraftHeartbeat(scopeId) {
  writeDraftHeartbeat(scopeId);
  if (draftHeartbeatTimer) return;
  try {
    draftHeartbeatTimer = setInterval(() => writeDraftHeartbeat(getCurrentLastWorkWorkspaceScope()), DRAFT_HEARTBEAT_INTERVAL_MS);
  } catch (_) {}
}

async function rememberLastDraftWorkspaceScope(scopeId) {
  const scope = String(scopeId || '').trim();
  if (!scope.startsWith('draft:')) return false;
  try {
    await workspacePersistenceApi().savePreference({
      id: LAST_DRAFT_SCOPE_PREFERENCE_ID,
      scopeId: scope,
      savedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.warn('마지막 초안 번호를 적어 두지 못했습니다:', error);
    return false;
  }
}

async function readLastDraftWorkspaceScope() {
  try {
    const record = await workspacePersistenceApi().loadPreference(LAST_DRAFT_SCOPE_PREFERENCE_ID);
    return String(record?.scopeId || '').trim();
  } catch (_) {
    return '';
  }
}

// 새 탭이 빈손일 때, 직전 초안의 내용을 **현재 가지로 옮겨** 온다.
// 작업파일용 migrateDocumentSessionAssetsToCurrentBranch 와 같은 절차를 그대로 따른다:
// 읽고 → 현재 가지에 묶고 → 신원 검증을 통과해야만 저장한다.
async function adoptPreviousDraftSessionAssets(branchScopeId, options = {}) {
  const branchScope = String(branchScopeId || '').trim();
  if (!branchScope.startsWith('draft:')) return null;
  const requestIsCurrent = () => typeof options.isCurrent !== 'function' || options.isCurrent() !== false;
  if (!requestIsCurrent()) return null;
  const previousScope = await readLastDraftWorkspaceScope();
  if (!previousScope || previousScope === branchScope) return null;
  if (!requestIsCurrent()) return null;
  const source = await workspacePersistenceApi().loadDraftSessionAssetsForRecovery(previousScope);
  if (!source || !requestIsCurrent()) return null;
  // 그 탭이 아직 살아 있으면 손대지 않는다. 살아 있는 탭의 초안을 가져오면 내용이 갈린다.
  const beatAge = readDraftHeartbeatAge(previousScope);
  if (beatAge < DRAFT_ORPHAN_AFTER_MS) return null;
  const adopted = bindWorkspaceSnapshotToCurrentBranch(cloneData(source), {
    branchScope,
    projectId: '',
    adoptOrphanDraft: true,
  });
  if (!adopted) return null;
  delete adopted.persistenceAuthority;
  const validation = workspacePersistenceApi().validateSnapshotIdentity(adopted);
  if (!validation.ok) return null;
  if (!requestIsCurrent() || getCurrentLastWorkWorkspaceScope() !== branchScope) return null;
  try {
    await ensureWorkspaceEditAuthority(branchScope);
    if (!requestIsCurrent() || getCurrentLastWorkWorkspaceScope() !== branchScope) return null;
    await workspacePersistenceApi().saveSessionAssets(branchScope, adopted);
  } catch (error) {
    console.warn('직전 초안 이어받기 저장 실패:', error);
  }
  clearDraftHeartbeat(previousScope);
  const name = String(adopted?.factory?.product?.productName || adopted?.productName || '').trim();
  console.info(`이전 탭에서 저장하지 않은 작업을 이어받았습니다${name ? `: ${name}` : ''}`);
  return adopted;
}

async function migrateDocumentSessionAssetsToCurrentBranch(branchScopeId, options = {}) {
  const boundary = currentBranchDocumentMigrationBoundary(branchScopeId);
  if (!boundary) return null;
  const requestIsCurrent = () => typeof options.isCurrent !== 'function' || options.isCurrent() !== false;
  if (!requestIsCurrent()) return null;
  const source = await workspacePersistenceApi()
    .loadDocumentSessionAssetsForBranchMigration(boundary.documentScopeId);
  if (!source || !requestIsCurrent()) return null;
  const sourceValidation = workspacePersistenceApi().validateSnapshotIdentity(source);
  const sourceDocumentScope = sourceValidation.documentScopeId || sourceValidation.scopeId || '';
  if (!sourceValidation.ok || sourceDocumentScope !== boundary.documentScopeId) return null;

  const migrated = bindWorkspaceSnapshotToCurrentBranch(cloneData(source), {
    branchScope: boundary.branchScopeId,
    projectId: boundary.branch.documentId,
  });
  if (!migrated) return null;
  delete migrated.persistenceAuthority;
  const migratedValidation = workspacePersistenceApi().validateSnapshotIdentity(migrated);
  if (!migratedValidation.ok
    || !workspacePersistenceApi().workBranchesMatch(migratedValidation.branch, boundary.branch)) {
    return null;
  }
  if (!requestIsCurrent() || getCurrentLastWorkWorkspaceScope() !== boundary.branchScopeId) return null;
  try {
    await ensureWorkspaceEditAuthority(boundary.branchScopeId);
    if (!requestIsCurrent() || getCurrentLastWorkWorkspaceScope() !== boundary.branchScopeId) return null;
    await workspacePersistenceApi().saveSessionAssets(boundary.branchScopeId, migrated);
  } catch (error) {
    console.warn('Document session assets branch copy failed:', error);
  }
  return migrated;
}

async function hydratePersistentSessionAssets(options = {}) {
  const wasSessionAssetsHydrated = !!sessionAssetsHydrated;
  const hydrateToken = workspaceBlankResetToken;
  const hydrateScopeId = getCurrentLastWorkWorkspaceScope();
  const requestIsCurrent = () => typeof options.isCurrent !== 'function' || options.isCurrent() !== false;
  const hydrationIsCurrent = () => workspaceHydrationScopeIsCurrent(
    hydrateScopeId,
    hydrateToken,
    requestIsCurrent,
  );
  const suppressHydrationRender = (() => {
    try {
      const href = typeof window !== 'undefined' ? window.location?.href : '';
      return !!href && new URL(href).searchParams.get('batchWorker') === '1';
    } catch (_) {
      return false;
    }
  })();
  let shouldRenderAfterHydrate = false;
  try {
    if (!hydrationIsCurrent()) return false;
    let assets;
    try {
      assets = await workspaceGetSessionAssets(hydrateScopeId);
    } catch (_) {
      await new Promise(resolve => setTimeout(resolve, 50));
      assets = await workspaceGetSessionAssets(hydrateScopeId);
    }
    if (!assets) {
      assets = await migrateDocumentSessionAssetsToCurrentBranch(hydrateScopeId, {
        isCurrent: requestIsCurrent,
      });
    }
    if (!assets) {
      // 작업파일도 아니고 이 탭의 초안도 없다면, 직전 탭이 남긴 초안을 이어받는다.
      // 저장을 한 번도 안 누른 작업이 탭과 함께 사라지던 자리다.
      assets = await adoptPreviousDraftSessionAssets(hydrateScopeId, { isCurrent: requestIsCurrent });
    }
    if (hydrateScopeId.startsWith('draft:')) {
      startDraftHeartbeat(hydrateScopeId);
      void rememberLastDraftWorkspaceScope(hydrateScopeId);
    }
    if (assets?.productImageBackup && typeof hydrateWorkspacePayloadImageBackup === 'function') {
      assets = await hydrateWorkspacePayloadImageBackup(assets);
    }
    if (assets && !assets.productImageBackup?.primary?.base64
      && typeof hydrateWorkspacePayloadImageBackup === 'function') {
      const projectId = hydrateScopeId.startsWith('project:')
        ? hydrateScopeId.slice('project:'.length)
        : String(assets.currentProjectId || state.currentProjectId || '').trim();
      const project = projectId
        ? await workspaceGet(WORKSPACE_DB.projects, projectId).catch(() => null)
        : null;
      const projectPayload = project?.payload
        ? await hydrateWorkspacePayloadImageBackup(project.payload)
        : null;
      if (projectPayload?.productImageBackup?.primary?.base64) {
        assets = { ...assets, productImageBackup: projectPayload.productImageBackup };
      }
    }
    if (!hydrationIsCurrent()) return false;
    if (assets && !lastWorkSnapshotMatchesWorkspaceScope(assets, hydrateScopeId)) return false;
    const hasProductWork = !assets || !!(
      lastWorkPayloadProductName(assets) ||
      assets.currentProjectId ||
      assets.imageBase64 ||
      assets.imagePreview ||
      (Array.isArray(assets.analysisImages) && assets.analysisImages.some(image => image?.base64 || image?.preview || image?.hasImageData)) ||
      assets.factory?.product?.imageBase64 ||
      assets.factory?.product?.imagePreview ||
      assets.factory?.product?.hasImage ||
      (Array.isArray(assets.factory?.product?.inputImages) && assets.factory.product.inputImages.some(image => image?.base64 || image?.preview || image?.hasImage))
    );
    let changed = assets
      ? applySessionAssetsPayload(assets, {
        preserveInlineImages: true,
        allowScopedInlineImages: true,
        allowEqualRevision: true,
      })
      : (hasProductWork ? await hydrateLastProductImageBackup({
        workspaceResetToken: hydrateToken,
        expectedWorkspaceScope: hydrateScopeId,
        restoreInline: true,
        isCurrent: requestIsCurrent,
      }) : false);
    if (assets && !changed && snapshotHasInlineImagePayload(assets)) {
      changed = recoverStaleSessionInlineImages(assets);
    }
    if (!hydrationIsCurrent()) return false;
    const backupChanged = assets && hasProductWork
      ? await hydrateLastProductImageBackup({
        workspaceResetToken: hydrateToken,
        expectedWorkspaceScope: hydrateScopeId,
        restoreInline: true,
        force: true,
        isCurrent: requestIsCurrent,
      })
      : false;
    if (!hydrationIsCurrent()) return false;
    markSessionAssetFingerprintSaved();
    if (!suppressHydrationRender && (changed || backupChanged)) render();
    else if (typeof scheduleCompetitorEvidenceCanvasPaint === 'function') scheduleCompetitorEvidenceCanvasPaint();
    else if (typeof paintCompetitorEvidenceCanvases === 'function') paintCompetitorEvidenceCanvases();
    shouldRenderAfterHydrate = true;
  } catch(e) {
    if (!hydrationIsCurrent()) return false;
    console.warn('Session asset hydrate failed:', e);
    const backupChanged = await hydrateLastProductImageBackup({
      workspaceResetToken: hydrateToken,
      expectedWorkspaceScope: hydrateScopeId,
      restoreInline: true,
      isCurrent: requestIsCurrent,
    }).catch(() => false);
    if (!hydrationIsCurrent()) return false;
    if (!suppressHydrationRender && (backupChanged || (state.step !== 'upload' && showImageRestoreWarningIfNeeded()))) {
      render();
    }
    shouldRenderAfterHydrate = true;
  } finally {
    if (hydrationIsCurrent()) {
      sessionAssetsHydrated = true;
      if (!wasSessionAssetsHydrated) {
        if (typeof window !== 'undefined') {
          window.__KUASANGSE_SESSION_ASSETS_HYDRATED__ = true;
          document.dispatchEvent(new CustomEvent('kuasangse:session-assets-hydrated'));
        }
      }
      if (hydrationIsCurrent()) {
        try {
          if (typeof factoryClearRestoredImageGenerationRuntime === 'function') {
            shouldRenderAfterHydrate = factoryClearRestoredImageGenerationRuntime({
              save: false,
              log: false,
            }) || shouldRenderAfterHydrate;
          }
          if (typeof factoryClearRestoredCandidateRuntime === 'function') {
            shouldRenderAfterHydrate = factoryClearRestoredCandidateRuntime({
              save: false,
              log: false,
            }) || shouldRenderAfterHydrate;
          }
        } catch(e) {
          console.warn('Post-hydrate runtime cleanup failed:', e);
        }
        if (!suppressHydrationRender && state.step !== 'upload' && showImageRestoreWarningIfNeeded()) {
          shouldRenderAfterHydrate = true;
        }
        if (pendingSessionAssetSaveAfterHydrate) {
          pendingSessionAssetSaveAfterHydrate = false;
          scheduleSessionAssetSave();
        }
        if (!suppressHydrationRender && !wasSessionAssetsHydrated && shouldRenderAfterHydrate) {
          setTimeout(() => {
            try { render(); } catch(e) {}
          }, 0);
        }
      }
    }
    if (!hydrationIsCurrent() && pendingSessionAssetSaveAfterHydrate) {
      // A newer workspace/input owns the live state now. The stale restore must
      // not apply its payload, but it must not hold the newer input behind the
      // cancelled hydration either.
      sessionAssetsHydrated = true;
      pendingSessionAssetSaveAfterHydrate = false;
      scheduleSessionAssetSave();
    }
  }
}

// ════════════════════════════════════════════════════════════════
// PERSISTENT STORAGE (works on file:// too)
// ════════════════════════════════════════════════════════════════
function expireCookie(name) {
  try { document.cookie = `${name}=;max-age=0;path=/;SameSite=Lax`; } catch(e) {}
}

function saveKey(key) {
  try { localStorage.setItem('gemini_api_key', key); } catch(e) {}
  expireCookie('gemini_api_key');
}
function loadKey() {
  let k = '';
  try { k = localStorage.getItem('gemini_api_key') || ''; } catch(e) {}
  if (!k) {
    try {
      const m = document.cookie.match(/gemini_api_key=([^;]+)/);
      if (m) {
        k = decodeURIComponent(m[1]);
        if (k) localStorage.setItem('gemini_api_key', k);
        expireCookie('gemini_api_key');
      }
    } catch(e) {}
  }
  return k;
}

function saveBackendUrl(url) {
  try { localStorage.setItem('gemini_backend_url', url || ''); } catch(e) {}
}

function loadBackendUrl() {
  try {
    const stored = localStorage.getItem('gemini_backend_url') || '';
    // 4000은 sachyosangse API (pdp 전용) — GeminiClient backendUrl로 쓰면 안 됨, 5050으로 리셋
    if (!stored || stored.includes(':4000')) {
      localStorage.setItem('gemini_backend_url', 'http://127.0.0.1:5050');
      return 'http://127.0.0.1:5050';
    }
    return stored;
  } catch(e) { return 'http://127.0.0.1:5050'; }
}

function defaultServerAutomationApiBase() {
  return 'http://127.0.0.1:4000/v1';
}

function normalizeServerAutomationApiBase(url) {
  let base = (url || '').trim();
  if (!base) return defaultServerAutomationApiBase();
  base = base.replace(/\/+$/, '');
  if (!/\/v1$/i.test(base)) base += '/v1';
  return base;
}

function loadServerAutomationApiBase() {
  try {
    const stored = localStorage.getItem('server_auto_api_base') || '';
    // migrate: if stored value points to wrong port (5050), reset to default
    if (stored.includes(':5050')) {
      localStorage.removeItem('server_auto_api_base');
      return defaultServerAutomationApiBase();
    }
    return normalizeServerAutomationApiBase(stored);
  } catch(e) {
    return 'http://127.0.0.1:4000/v1';
  }
}

const SERVER_DRAFT_CUT_COUNT = 10;
const SERVER_DRAFT_CUTS_KEY = 'server_cuts_draft';
const SERVER_DRAFT_CUTS_BACKUP_KEY = 'server_cuts_draft_backup';
const SERVER_DRAFT_CUTS_HISTORY_KEY = 'server_cuts_draft_history';

function blankDraftCuts() {
  return Array.from({ length: SERVER_DRAFT_CUT_COUNT }, () => ({ label: '', prompt: '' }));
}

function normalizeDraftCuts(cuts) {
  let source = cuts;
  if (source && !Array.isArray(source) && typeof source === 'object') {
    source = Array.isArray(source.cuts) ? source.cuts : source.prompts;
  }
  if (!Array.isArray(source)) return blankDraftCuts();
  const arr = source.slice(0, SERVER_DRAFT_CUT_COUNT).map((item, index) => ({
    label: String(item?.label || item?.name || (item?.prompt ? `컷 ${index + 1}` : '') || ''),
    prompt: String(item?.prompt || ''),
  }));
  while (arr.length < SERVER_DRAFT_CUT_COUNT) arr.push({ label: '', prompt: '' });
  return arr;
}

function countDraftCutPrompts(cuts) {
  return normalizeDraftCuts(cuts).filter(item => String(item?.prompt || '').trim()).length;
}

function draftCutsSignature(cuts) {
  return normalizeDraftCuts(cuts)
    .map(item => `${String(item.label || '').trim()}::${String(item.prompt || '').trim()}`)
    .join('\n');
}

function parseDraftCutsStorageValue(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeDraftCuts(parsed);
    if (Array.isArray(parsed?.cuts)) return normalizeDraftCuts(parsed.cuts);
    if (Array.isArray(parsed?.prompts)) return normalizeDraftCuts(parsed.prompts);
    return null;
  } catch(e) {
    return null;
  }
}

function readDraftCutStorage(key) {
  try {
    return parseDraftCutsStorageValue(localStorage.getItem(key));
  } catch(e) {
    return null;
  }
}

function readLatestDraftCutHistory(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const entries = Array.isArray(parsed) ? parsed : [];
    return entries
      .map(entry => parseDraftCutsStorageValue(JSON.stringify(entry)))
      .filter(Boolean)
      .sort((a, b) => countDraftCutPrompts(b) - countDraftCutPrompts(a))[0] || null;
  } catch(e) {
    return null;
  }
}

function mergeDraftCutCandidates(baseCuts, candidates = []) {
  const merged = normalizeDraftCuts(baseCuts);
  candidates
    .map(normalizeDraftCuts)
    .sort((a, b) => countDraftCutPrompts(b) - countDraftCutPrompts(a))
    .forEach(candidate => {
      candidate.forEach((item, index) => {
        const prompt = String(item?.prompt || '').trim();
        if (!prompt) return;
        const currentPrompt = String(merged[index]?.prompt || '').trim();
        if (currentPrompt) return;
        merged[index] = {
          label: String(item?.label || '').trim() || merged[index]?.label || `컷 ${index + 1}`,
          prompt: item.prompt,
        };
      });
    });
  return merged;
}

function loadDraftCuts() {
  const primary = readDraftCutStorage(SERVER_DRAFT_CUTS_KEY);
  const candidates = [
    readDraftCutStorage(SERVER_DRAFT_CUTS_BACKUP_KEY),
    readLatestDraftCutHistory(SERVER_DRAFT_CUTS_HISTORY_KEY),
    readDraftCutStorage('cuts_prompts_live_backup'),
    readLatestDraftCutHistory('cuts_prompts_history'),
  ].filter(Boolean);
  const merged = mergeDraftCutCandidates(primary || blankDraftCuts(), candidates);
  if (countDraftCutPrompts(merged) > countDraftCutPrompts(primary || [])) {
    saveDraftCuts(merged);
  }
  return merged;
}

function saveDraftCuts(cuts) {
  const normalized = normalizeDraftCuts(cuts);
  try { localStorage.setItem(SERVER_DRAFT_CUTS_KEY, JSON.stringify(normalized)); } catch(e) {}
  try {
    localStorage.setItem(SERVER_DRAFT_CUTS_BACKUP_KEY, JSON.stringify({ updatedAt: Date.now(), cuts: normalized }));
  } catch(e) {}
  if (!countDraftCutPrompts(normalized)) return;
  try {
    const raw = localStorage.getItem(SERVER_DRAFT_CUTS_HISTORY_KEY);
    const history = Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [];
    const sig = draftCutsSignature(normalized);
    const latestSig = history.length ? draftCutsSignature(history[0]?.cuts || history[0]?.prompts || history[0]) : '';
    if (sig !== latestSig) {
      history.unshift({ updatedAt: Date.now(), cuts: normalized });
      localStorage.setItem(SERVER_DRAFT_CUTS_HISTORY_KEY, JSON.stringify(history.slice(0, 30)));
    }
  } catch(e) {}
}

function saveServerAutomationApiBase(url) {
  const normalized = normalizeServerAutomationApiBase(url);
  try { localStorage.setItem('server_auto_api_base', normalized); } catch(e) {}
  return normalized;
}

function assertServerAutomationApiBaseAllowed(base) {
  const isHttpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
  if (isHttpsPage && /^http:\/\//i.test(base)) {
    throw new Error('HTTPS 페이지에서는 http:// 자동화 API 호출이 차단됩니다. https:// 엔드포인트를 사용하거나 localhost 앱(start.bat)으로 실행하세요.');
  }
}

// 경쟁사 분석 결과 저장/불러오기
function buildCompAnalysisSnapshot(
  analysisResult = state.compPage.analysisResult,
  sectionPlan = state.compPage.sectionPlan,
  planEdits = state.compPage.planEdits
) {
  const cp = state.compPage || {};
  const scope = sectionWorkScopeMeta();
  return {
    subStep: cp.subStep || 'input',
    mode: cp.mode || 'images',
    sectionWorkScope: scope,
    analysisResult: analysisResult || null,
    sectionPlan: sectionPlan || null,
    planEdits: cloneData(planEdits || {}),
    uploadedImages: cloneData(cp.uploadedImages || []),
    evidenceImages: cloneData(cp.evidenceImages || []),
    htmlText: cp.htmlText || '',
    urlInput: cp.urlInput || '',
    scraperBase: cp.scraperBase || 'http://127.0.0.1:5001',
    scraperImportInfo: cloneData(cp.scraperImportInfo || null),
    marketScrape: sanitizeCompMarketScrapeForPersistence(cp.marketScrape || null),
    analyzeMsg: cp.analyzeMsg || '',
    analyzeProgress: cp.analyzeProgress || 0,
    analyzeStage: cp.analyzeStage || '',
    analyzeDetail: cp.analyzeDetail || '',
    analyzeLogs: cloneData(cp.analyzeLogs || []),
    analyzeModel: cloneData(cp.analyzeModel || null),
    analyzeElapsedSec: cp.analyzeElapsedSec || 0,
    analysisImageSelection: cloneData(cp.analysisImageSelection || analysisResult?.compMarketImageSelection || null),
    savedAt: Date.now(),
  };
}

function compImagePersistenceWarningMessage() {
  return '경쟁사 분석의 임시 업로드·근거 이미지는 브라우저 임시 저장에서 제외됩니다. 분석 텍스트·로그와 조립공장 생성 결과는 작업파일에 포함됩니다.';
}

function stripCompSnapshotImages(snapshot) {
  const copy = { ...(snapshot || {}) };
  copy.hasUploadedImages = Array.isArray(copy.uploadedImages) && copy.uploadedImages.length > 0;
  copy.hasEvidenceImages = Array.isArray(copy.evidenceImages) && copy.evidenceImages.length > 0;
  copy.uploadedImages = [];
  copy.evidenceImages = [];
  if (copy.marketScrape) {
    copy.marketScrape = sanitizeCompMarketScrapeForPersistence(copy.marketScrape);
    copy.marketScrape.hasImage = !!(copy.marketScrape.imageBase64 || copy.marketScrape.imagePreview);
    copy.marketScrape.imageBase64 = '';
    copy.marketScrape.imagePreview = '';
  }
  copy.imagePersistenceWarning = compImagePersistenceWarningMessage();
  return copy;
}

function applyCompAnalysisSnapshot(saved, targetSubStep = null, options = {}) {
  if (!saved || !state?.compPage) return false;
  const currentScope = sectionWorkScopeMeta();
  const workspaceScopeMatches = !currentScope.scopeKey || sectionWorkScopeMatches(saved.sectionWorkScope, currentScope);
  const analysisProductScope = saved.analysisResult?.analysisProductScope || null;
  const analysisScopeMatches = !saved.analysisResult || (
    !!analysisProductScope && sectionWorkScopeMatches(analysisProductScope, currentScope)
  );
  const scopeMatches = workspaceScopeMatches && analysisScopeMatches;
  if (!scopeMatches && options.allowScopeMismatch !== true) return false;
  const cp = state.compPage;
  const preserveCurrent = options.replaceWorkspace !== true;
  const nonEmpty = value => (
    Array.isArray(value) ? value.length > 0
      : value && typeof value === 'object' ? Object.keys(value).length > 0
        : typeof value === 'number' ? value !== 0
          : typeof value === 'string' ? !!value.trim()
            : !!value
  );
  const keepCurrent = (incoming, current) => (
    preserveCurrent && !nonEmpty(incoming) && nonEmpty(current) ? current : incoming
  );
  cp.sectionWorkScope = keepCurrent(saved.sectionWorkScope, cp.sectionWorkScope) || currentScope;
  const preserveDerived = (incoming, current) => (
    preserveCurrent ? mergeSameWorkDerivedValue(current, incoming) : incoming
  );
  cp.analysisResult = preserveDerived(saved.analysisResult, cp.analysisResult) || null;
  cp.sectionPlan = preserveDerived(saved.sectionPlan, cp.sectionPlan) || null;
  cp.planEdits = preserveDerived(saved.planEdits, cp.planEdits) || {};
  cp.mode = keepCurrent(saved.mode, cp.mode) || 'images';
  if (Array.isArray(saved.uploadedImages)) {
    cp.uploadedImages = keepCurrent(saved.uploadedImages, cp.uploadedImages) || [];
  } else if (!Array.isArray(cp.uploadedImages)) {
    cp.uploadedImages = [];
  }
  if (Array.isArray(saved.evidenceImages)) {
    cp.evidenceImages = keepCurrent(saved.evidenceImages, cp.evidenceImages) || [];
  } else if (!Array.isArray(cp.evidenceImages)) {
    cp.evidenceImages = [];
  }
  cp.htmlText = keepCurrent(saved.htmlText, cp.htmlText) || '';
  cp.urlInput = keepCurrent(saved.urlInput, cp.urlInput) || '';
  cp.scraperBase = keepCurrent(saved.scraperBase, cp.scraperBase) || 'http://127.0.0.1:5001';
  cp.scraperImportInfo = keepCurrent(saved.scraperImportInfo, cp.scraperImportInfo) || null;
  cp.marketScrape = mergeCompMarketStoredState(
    cp.marketScrape || {},
    sanitizeCompMarketScrapeForPersistence(saved.marketScrape || null) || {},
  );
  cp.analyzeMsg = keepCurrent(saved.analyzeMsg, cp.analyzeMsg) || '';
  cp.analyzeProgress = keepCurrent(saved.analyzeProgress, cp.analyzeProgress) || 0;
  cp.analyzeStage = keepCurrent(saved.analyzeStage, cp.analyzeStage) || '';
  cp.analyzeDetail = keepCurrent(saved.analyzeDetail, cp.analyzeDetail) || '';
  cp.analyzeLogs = keepCurrent(Array.isArray(saved.analyzeLogs) ? saved.analyzeLogs : [], cp.analyzeLogs) || [];
  cp.analyzeModel = keepCurrent(saved.analyzeModel || saved.analysisResult?.analyzeModel, cp.analyzeModel) || null;
  cp.analyzeElapsedSec = keepCurrent(saved.analyzeElapsedSec, cp.analyzeElapsedSec) || 0;
  cp.analysisImageSelection = keepCurrent(saved.analysisImageSelection || saved.analysisResult?.compMarketImageSelection, cp.analysisImageSelection) || null;
  cp.previousAnalysisViewOnly = !scopeMatches;
  cp.subStep = targetSubStep || keepCurrent(saved.subStep, cp.subStep) || 'input';
  if (saved.imagePersistenceWarning) state.storageWarning = compImagePersistenceWarningMessage();
  return true;
}

function saveCompAnalysis(analysisResult, sectionPlan, planEdits, options = {}) {
  const hasPlanEdits = !!(planEdits && typeof planEdits === 'object' && Object.keys(planEdits).length);
  if (!analysisResult && !sectionPlan && !hasPlanEdits) {
    try {
      if (options.skipPersistentState !== true && typeof savePersistentState === 'function') savePersistentState();
    } catch(_) {}
    return false;
  }
  if (state.compPage && typeof state.compPage === 'object') {
    state.compPage.sectionWorkScope = sectionWorkScopeMeta();
  }
  const snapshot = buildCompAnalysisSnapshot(analysisResult, sectionPlan, planEdits);
  try {
    if (analysisResult || sectionPlan) accumulateCompetitorTips(analysisResult, sectionPlan);
  } catch(e) {
    console.warn('Competitor tip accumulation failed:', e);
  }
  try {
    workspaceSessionSetItem('comp_analysis', JSON.stringify(snapshot));
  } catch(e) {
    try {
      workspaceSessionSetItem('comp_analysis', JSON.stringify(stripCompSnapshotImages(snapshot)));
    } catch(_) {}
  }
  try {
    if (options.skipPersistentState !== true && typeof savePersistentState === 'function') savePersistentState();
  } catch(_) {}
}
function loadCompAnalysis() {
  try {
    const raw = workspaceSessionGetItem('comp_analysis');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

const SECTION_HELPER_BLOCK_START = '--- 섹션 이미지 도우미 누적 팁 시작 ---';
const SECTION_HELPER_BLOCK_END = '--- 섹션 이미지 도우미 누적 팁 끝 ---';

function safeSectionLiveState() {
  try {
    return typeof state !== 'undefined' ? state : null;
  } catch(e) {
    return null;
  }
}

function normalizeSectionScopeKeyPart(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (typeof factoryNormalizeIdentityText === 'function') return factoryNormalizeIdentityText(text);
  return text.toLowerCase().replace(/\s+/g, '').slice(0, 180);
}

function sectionWorkScopeMeta(source = null) {
  const live = source || safeSectionLiveState();
  let factory = live?.factory || {};
  if (!source && typeof factoryRuntimeReadFactory === 'function') {
    try {
      factory = factoryRuntimeReadFactory();
    } catch(e) {}
  }
  const product = factory?.product || {};
  let productName = String(
    product.userProductName ||
    product.productName ||
    live?.productName ||
    live?.analysis?.product_name ||
    live?.analysis?.name ||
    ''
  ).trim();
  let productKey = '';
  let inputImageFingerprint = '';
  if (!source && typeof factoryCurrentProductKey === 'function') {
    try { productKey = factoryCurrentProductKey(factory); } catch(e) { productKey = ''; }
  }
  if (!productKey) {
    productKey = normalizeSectionScopeKeyPart(
      product.productKey ||
      product.productIdentityKey ||
      product.identityKey ||
      productName
    );
  }
  if (!source && typeof factoryCurrentInputImageFingerprint === 'function') {
    try { inputImageFingerprint = factoryCurrentInputImageFingerprint(factory); } catch(e) { inputImageFingerprint = ''; }
  }
  if (!inputImageFingerprint) {
    const firstInput = Array.isArray(product.inputImages) ? (product.inputImages[0] || {}) : {};
    const firstAnalysisImage = Array.isArray(live?.analysisImages) ? (live.analysisImages[0] || {}) : {};
    inputImageFingerprint = String(
      product.lockedInputImageFingerprint ||
      product.inputImageFingerprint ||
      product.sourceImageKey ||
      product.productImageKey ||
      firstInput.inputImageFingerprint ||
      firstInput.sourceImageKey ||
      firstInput.productImageKey ||
      firstAnalysisImage.inputImageFingerprint ||
      firstAnalysisImage.sourceImageKey ||
      firstAnalysisImage.productImageKey ||
      ''
    ).trim();
  }
  if (!inputImageFingerprint && typeof factoryImagePayloadFingerprint === 'function') {
    try {
      inputImageFingerprint = factoryImagePayloadFingerprint(
        live?.imageBase64 ||
        product.imageBase64 ||
        (Array.isArray(product.inputImages) ? product.inputImages.find(img => img?.base64)?.base64 : '') ||
        ''
      );
    } catch(e) {
      inputImageFingerprint = '';
    }
  }
  let currentRunId = String(
    product.currentRunId ||
    product.generationRunId ||
    factory?.automation?.currentRunId ||
    factory?.goalRun?.currentRunId ||
    ''
  ).trim();
  if (!currentRunId && !source && typeof factoryCurrentWorkflowRunId === 'function') {
    try { currentRunId = factoryCurrentWorkflowRunId(factory); } catch(e) { currentRunId = ''; }
  }
  const scopeKey = productKey || inputImageFingerprint
    ? `${currentRunId || 'no_run'}::${productKey || 'no_product'}::${inputImageFingerprint || 'no_image'}`
    : '';
  return {
    scopeKey,
    currentRunId,
    productKey,
    inputImageFingerprint,
    productName,
  };
}

function sectionWorkScopeMatches(record = {}, current = sectionWorkScopeMeta()) {
  return !!(record?.scopeKey && current?.scopeKey && record.scopeKey === current.scopeKey);
}

function sectionWorkScopeMatchesForDetailTransfer(record = {}, current = sectionWorkScopeMeta()) {
  const recordRunId = String(record?.currentRunId || record?.generationRunId || '').trim();
  const currentRunId = String(current?.currentRunId || '').trim();
  const recordFingerprint = String(record?.inputImageFingerprint || '').trim();
  const currentFingerprint = String(current?.inputImageFingerprint || '').trim();
  const recordProductKey = normalizeSectionScopeKeyPart(record?.productKey || '');
  const currentProductKey = normalizeSectionScopeKeyPart(current?.productKey || '');
  const productKeyMatches = !!(recordProductKey && currentProductKey && recordProductKey === currentProductKey);
  if (!recordRunId || !currentRunId || recordRunId !== currentRunId) {
    return {
      ok: false,
      blocked: true,
      reason: !recordRunId ? 'current-run-missing' : 'current-run-changed',
      productKeyWarning: !productKeyMatches,
      message: '미리보기 섹션의 작업 실행 ID가 현재 조립공장 실행과 달라 전송하지 않습니다. 현재 실행 기준으로 섹션을 다시 생성해주세요.',
    };
  }
  if (!productKeyMatches) {
    return {
      ok: false,
      blocked: true,
      reason: 'product-key-changed',
      productKeyWarning: true,
      message: '미리보기 섹션의 상품 기준이 현재 작업파일 상품과 달라 전송하지 않습니다. 현재 상품 기준으로 섹션을 다시 생성해주세요.',
    };
  }
  if (!recordFingerprint || !currentFingerprint || recordFingerprint !== currentFingerprint) {
    return {
      ok: false,
      blocked: true,
      reason: !recordFingerprint || !currentFingerprint ? 'input-image-missing' : 'input-image-changed',
      productKeyWarning: false,
      message: '미리보기 섹션의 입력 이미지 원본이 현재 상품 이미지와 달라 전송하지 않습니다. 현재 이미지 기준으로 섹션을 다시 생성해주세요.',
    };
  }
  return {
    ok: true,
    blocked: false,
    reason: '',
    productKeyWarning: false,
    message: '',
  };
}

function sectionWorkScopeFromContent(content = {}, fallback = {}) {
  const source = content && typeof content === 'object' ? content : {};
  const embedded = source.__sectionWorkScope || source.sectionWorkScope || source.workScope || {};
  const meta = fallback && typeof fallback === 'object' ? fallback : {};
  const productKey = normalizeSectionScopeKeyPart(
    embedded.productKey ||
    source.__productKey ||
    source.productKey ||
    meta.productKey ||
    ''
  );
  const inputImageFingerprint = String(
    embedded.inputImageFingerprint ||
    source.__inputImageFingerprint ||
    source.inputImageFingerprint ||
    meta.inputImageFingerprint ||
    ''
  ).trim();
  const currentRunId = String(
    embedded.currentRunId ||
    source.__currentRunId ||
    source.currentRunId ||
    source.generationRunId ||
    meta.currentRunId ||
    meta.generationRunId ||
    ''
  ).trim();
  const scopeKey = String(embedded.scopeKey || meta.scopeKey || (
    productKey || inputImageFingerprint
      ? `${currentRunId || 'no_run'}::${productKey || 'no_product'}::${inputImageFingerprint || 'no_image'}`
      : ''
  )).trim();
  return {
    scopeKey,
    currentRunId,
    productKey,
    inputImageFingerprint,
    productName: String(embedded.productName || source.__productName || meta.productName || '').trim(),
  };
}

function stampSectionContentWorkScope(content = {}, sectionId = '', trigger = '') {
  if (!content || typeof content !== 'object') return content;
  const scope = sectionWorkScopeMeta();
  content.__sectionWorkScope = {
    ...scope,
    sectionId: String(sectionId || ''),
    trigger: String(trigger || ''),
    stampedAt: Date.now(),
  };
  return content;
}

function sectionContentBelongsToCurrentWork(sectionId = '', content = {}, fallbackScope = null) {
  const current = fallbackScope || sectionWorkScopeMeta();
  const meta = state.sectionGenerationMeta?.[sectionId] || {};
  const record = sectionWorkScopeFromContent(content, meta);
  if (!record.scopeKey && !record.productKey && !record.inputImageFingerprint) {
    return false;
  }
  const transfer = sectionWorkScopeMatchesForDetailTransfer(record, current);
  return !!transfer.ok;
}

function sectionScopeKeysCompatible(a = '', b = '') {
  const keyA = normalizeSectionScopeKeyPart(a);
  const keyB = normalizeSectionScopeKeyPart(b);
  if (!keyA || !keyB) return true;
  if (typeof factoryIdentityKeysCompatible === 'function') return factoryIdentityKeysCompatible(keyA, keyB);
  return keyA === keyB || keyA.includes(keyB) || keyB.includes(keyA);
}

function sectionWorkHasAnyOutput() {
  const live = safeSectionLiveState();
  if (!live) return false;
  return !!(
    live.analysis ||
    live.competitorData ||
    live.compPage?.analysisResult ||
    live.compPage?.sectionPlan ||
    Object.keys(live.compPage?.planEdits || {}).length ||
    Object.keys(live.sectionInstructions || {}).length ||
    Object.keys(live.sectionContents || {}).length ||
    Object.keys(live.sectionImages || {}).length ||
    Object.keys(live.sectionGenerationMeta || {}).length ||
    Object.keys(live.sectionVariants || {}).length ||
    Object.keys(live.currentSectionVariantIds || {}).length ||
    Object.keys(live.sectionTipHelperApplied || {}).length
  );
}

function clearSectionWorkForScopeChange(reason = '') {
  const live = safeSectionLiveState();
  if (!live) return;
  if (typeof factoryPreserveCurrentDetailHtmlBeforeSectionReset === 'function') {
    factoryPreserveCurrentDetailHtmlBeforeSectionReset(reason || '상품/입력 이미지 기준 변경');
  }
  live.sectionInstructions = {};
  live.sectionContents = {};
  live.sectionImages = {};
  live.sectionInstructionSources = {};
  live.sectionGenerationMeta = {};
  live.sectionVariants = {};
  live.currentSectionVariantIds = {};
  live.sectionTipHelperApplied = {};
  live.sectionVariantEvaluations = {};
  live.sectionLocks = {};
  live.analysis = null;
  live.competitorData = null;
  live.analysisTimestamp = null;
  if (live.compPage && typeof live.compPage === 'object') {
    live.compPage.analysisResult = null;
    live.compPage.sectionPlan = null;
    live.compPage.planEdits = {};
    live.compPage.analysisImageSelection = null;
    live.compPage.sectionWorkScope = null;
    live.compPage.analyzeProgress = 0;
    live.compPage.analyzeStage = '현재 작업 기준 재분석 필요';
    live.compPage.analyzeMsg = '이전 상품 분석 결과를 현재 작업에서 분리했습니다.';
    live.compPage.analyzeDetail = '현재 제품 이미지 기준으로 다시 분석해야 섹션 플랜을 사용할 수 있습니다.';
  }
  live.promptTraceModal = { open: false, sectionId: null, variantId: null };
  if (reason) {
    live.uiNotice = {
      type: 'warn',
      message: reason,
    };
  }
  saveSectionInstructions(live.sectionInstructions);
}

function sectionAnalysisOrPlanStaleForScope(current = sectionWorkScopeMeta()) {
  const live = safeSectionLiveState();
  if (!live || !current.scopeKey) return false;
  const analysisName = String(live.analysis?.product_name || live.analysis?.name || '').trim();
  if (analysisName && current.productKey && !sectionScopeKeysCompatible(analysisName, current.productKey)) return true;
  const cp = live.compPage || {};
  const hasCompPlan = !!(cp.analysisResult || cp.sectionPlan || Object.keys(cp.planEdits || {}).length);
  if (hasCompPlan && !sectionWorkScopeMatches(cp.sectionWorkScope, current)) return true;
  return false;
}

function ensureSectionWorkScopeCurrent(options = {}) {
  const live = safeSectionLiveState();
  if (!live) return sectionWorkScopeMeta();
  const current = sectionWorkScopeMeta();
  if (!current.scopeKey) return current;
  const previous = live.sectionWorkScope && typeof live.sectionWorkScope === 'object'
    ? live.sectionWorkScope
    : {};
  if (!previous.scopeKey) {
    const hadLegacyOutput = sectionWorkHasAnyOutput();
    live.sectionWorkScope = current;
    if (hadLegacyOutput && options.adoptLegacy !== true) {
      clearSectionWorkForScopeChange('이전 상품의 섹션 지시문/이미지/도우미 기록은 현재 작업과 섞지 않도록 분리했습니다.');
    }
    if (options.save !== false && typeof savePersistentState === 'function') {
      try { savePersistentState(); } catch(e) {}
    }
    return current;
  }
  if (previous.scopeKey !== current.scopeKey) {
    live.sectionWorkScope = current;
    clearSectionWorkForScopeChange('현재 제품/입력 이미지가 바뀌어 이전 섹션 프롬프트와 도우미 팁을 현재 작업에서 제외했습니다.');
    if (options.save !== false && typeof savePersistentState === 'function') {
      try { savePersistentState(); } catch(e) {}
    }
    return current;
  }
  if (sectionAnalysisOrPlanStaleForScope(current)) {
    live.sectionWorkScope = current;
    clearSectionWorkForScopeChange('현재 제품과 다른 분석/경쟁사 플랜을 발견해 섹션 생성 기준에서 제외했습니다.');
    if (options.save !== false && typeof savePersistentState === 'function') {
      try { savePersistentState(); } catch(e) {}
    }
  }
  return current;
}

function loadCompetitorTipBank() {
  const parsed = loadJson(STORAGE_KEYS.competitorTipBank, { tips: [], updatedAt: null });
  const tips = Array.isArray(parsed?.tips) ? parsed.tips : [];
  return { tips, updatedAt: parsed?.updatedAt || null };
}

function saveCompetitorTipBank(bank) {
  const tips = Array.isArray(bank?.tips) ? bank.tips.slice(0, 180) : [];
  saveJson(STORAGE_KEYS.competitorTipBank, { tips, updatedAt: Date.now() });
}

function normalizeTipText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\-•·\s]+/, '')
    .trim();
}

function makeTipKey(text, sectionIds = [], scopeKey = '') {
  return `${scopeKey || 'legacy'}::${normalizeTipText(text).toLowerCase()}::${[...sectionIds].sort().join(',')}`.slice(0, 320);
}

function inferTipSectionIds(text = '', criteriaName = '') {
  const haystack = `${criteriaName} ${text}`;
  const ids = [];
  for (const [sectionId, hints] of Object.entries(COMP_SECTION_IMPROVEMENT_HINTS || {})) {
    if ((hints || []).some(h => haystack.includes(h))) ids.push(sectionId);
  }
  return ids;
}

function addCompetitorTipCandidate(map, tip, fallbackScope = null) {
  const text = normalizeTipText(tip?.text);
  if (!text || text.length < 8) return;
  const sectionIds = Array.isArray(tip.sectionIds) ? [...new Set(tip.sectionIds.filter(Boolean))] : [];
  const scope = tip?.scopeKey ? tip : (fallbackScope || {});
  const key = makeTipKey(text, sectionIds, scope.scopeKey || '');
  const existing = map.get(key);
  if (existing) {
    existing.count = (existing.count || 1) + 1;
    existing.lastSeenAt = Date.now();
    if (tip.sourceTitle && !existing.sourceTitle) existing.sourceTitle = tip.sourceTitle;
    return;
  }
  map.set(key, {
    id: tip.id || uid('comp_tip'),
    text,
    sectionIds,
    category: tip.category || '',
    sourceType: tip.sourceType || 'competitor_analysis',
    sourceTitle: tip.sourceTitle || '',
    modelLabel: tip.modelLabel || state.compPage?.analyzeModel?.modelLabel || '',
    scopeKey: scope.scopeKey || '',
    productKey: scope.productKey || '',
    inputImageFingerprint: scope.inputImageFingerprint || '',
    productName: scope.productName || '',
    createdAt: tip.createdAt || Date.now(),
    lastSeenAt: tip.lastSeenAt || Date.now(),
    count: Number(tip.count || 1),
  });
}

function extractCompetitorTips(analysisResult, sectionPlan) {
  const tips = [];
  const pageTitle = analysisResult?.page_title || analysisResult?.title || '경쟁사 상세페이지';
  const modelLabel = analysisResult?.analyzeModel?.modelLabel || state.compPage?.analyzeModel?.modelLabel || '';
  (analysisResult?.page_score?.criteria || []).forEach(criteria => {
    const text = normalizeTipText(criteria?.to_perfect || '');
    if (!text) return;
    tips.push({
      text,
      sectionIds: inferTipSectionIds(text, criteria?.name || ''),
      category: criteria?.name || '',
      sourceType: 'score_to_perfect',
      sourceTitle: pageTitle,
      modelLabel,
    });
  });
  (sectionPlan?.recommended_sections || []).forEach(rec => {
    const sectionId = rec?.section_id;
    const sourceTitle = `${pageTitle} · 섹션 플랜`;
    if (rec?.improvement_suggestions) {
      tips.push({
        text: rec.improvement_suggestions,
        sectionIds: sectionId ? [sectionId] : [],
        category: '섹션 개선 포인트',
        sourceType: 'section_plan_improvement',
        sourceTitle,
        modelLabel,
      });
    }
    if (rec?.competitor_reference && rec?.recommended_instructions) {
      tips.push({
        text: `경쟁사에서 본 점: ${rec.competitor_reference}. 우리 섹션 반영: ${splitPlanInstructionItems(rec.recommended_instructions, 2).join(' ')}`,
        sectionIds: sectionId ? [sectionId] : [],
        category: '섹션 반영 방식',
        sourceType: 'section_plan_reflection',
        sourceTitle,
        modelLabel,
      });
    }
  });
  (analysisResult?.selling_strategies || []).forEach(text => {
    tips.push({
      text,
      sectionIds: inferTipSectionIds(text, '판매 전략'),
      category: '판매 전략',
      sourceType: 'selling_strategy',
      sourceTitle: pageTitle,
      modelLabel,
    });
  });
  (analysisResult?.detail_page_trends || []).forEach(text => {
    tips.push({
      text,
      sectionIds: inferTipSectionIds(text, '상세페이지 트렌드'),
      category: '상세페이지 트렌드',
      sourceType: 'detail_page_trend',
      sourceTitle: pageTitle,
      modelLabel,
    });
  });
  return tips;
}

function accumulateCompetitorTips(analysisResult, sectionPlan) {
  const candidates = extractCompetitorTips(analysisResult, sectionPlan);
  if (!candidates.length) return loadCompetitorTipBank();
  const currentScope = sectionWorkScopeMeta();
  const bank = loadCompetitorTipBank();
  const map = new Map();
  (bank.tips || []).forEach(tip => addCompetitorTipCandidate(map, tip, null));
  candidates.forEach(tip => addCompetitorTipCandidate(map, tip, currentScope));
  const tips = [...map.values()].sort((a, b) => {
    const scoreA = (a.count || 1) * 10000000000000 + (a.lastSeenAt || a.createdAt || 0);
    const scoreB = (b.count || 1) * 10000000000000 + (b.lastSeenAt || b.createdAt || 0);
    return scoreB - scoreA;
  }).slice(0, 180);
  const next = { tips, updatedAt: Date.now() };
  saveCompetitorTipBank(next);
  return next;
}

function currentScopedCompetitorTips() {
  const currentScope = sectionWorkScopeMeta();
  if (!currentScope.scopeKey) return [];
  return (loadCompetitorTipBank().tips || []).filter(tip => sectionWorkScopeMatches(tip, currentScope));
}

function getSectionHelperTips(sectionId, limit = 4) {
  const tips = currentScopedCompetitorTips();
  const sectionSpecific = tips
    .filter(tip => Array.isArray(tip.sectionIds) && tip.sectionIds.includes(sectionId))
    .map(tip => ({ ...tip, _score: 2 }));
  const globalTips = tips
    .filter(tip => !Array.isArray(tip.sectionIds) || tip.sectionIds.length === 0)
    .map(tip => ({ ...tip, _score: 1 }));
  return [...sectionSpecific, ...globalTips]
    .sort((a, b) => (b._score - a._score) || ((b.count || 1) - (a.count || 1)) || ((b.lastSeenAt || 0) - (a.lastSeenAt || 0)))
    .slice(0, limit);
}

function getCompetitorTipMemoryPrompt(limit = 12) {
  const tips = currentScopedCompetitorTips().slice(0, limit);
  if (!tips.length) return '';
  return tips.map((tip, idx) => {
    const sections = tip.sectionIds?.length ? ` / 관련 섹션: ${tip.sectionIds.join(', ')}` : '';
    return `${idx + 1}. ${tip.text}${sections}`;
  }).join('\n');
}

function stripSectionHelperBlock(text = '') {
  const raw = String(text || '');
  const pattern = new RegExp(`\\n?${SECTION_HELPER_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${SECTION_HELPER_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
  return raw.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildSectionHelperBlock(sectionId, tips) {
  const section = SECTIONS.find(s => s.id === sectionId);
  const lines = (tips || []).map((tip, idx) => `${idx + 1}. ${tip.text}`).join('\n');
  return `${SECTION_HELPER_BLOCK_START}
대상 섹션: ${section?.name || sectionId}
아래는 지금까지 경쟁사 상세페이지 분석에서 누적된 섹션 이미지/구성 팁입니다. 제품 원본 형태 보존을 우선하면서, 콘텐츠 구성과 이미지 연출에 반영하세요.
${lines}
${SECTION_HELPER_BLOCK_END}`;
}

function getAppliedSectionHelperBlock(sectionId) {
  const currentScope = sectionWorkScopeMeta();
  const source = safeSectionLiveState()?.sectionInstructionSources?.[sectionId];
  if (!sectionWorkScopeMatches(source, currentScope)) return '';
  const text = String(state.sectionInstructions?.[sectionId] || '');
  const start = text.indexOf(SECTION_HELPER_BLOCK_START);
  const end = text.indexOf(SECTION_HELPER_BLOCK_END);
  if (start < 0 || end < start) return '';
  return text.slice(start, end + SECTION_HELPER_BLOCK_END.length);
}

function applySectionImageHelperTips(sectionId) {
  ensureSectionWorkScopeCurrent({ save: false });
  const tips = getSectionHelperTips(sectionId, 5);
  if (!tips.length) return;
  const current = String(state.sectionInstructions?.[sectionId] || '');
  const cleaned = stripSectionHelperBlock(current);
  const block = buildSectionHelperBlock(sectionId, tips);
  const next = [cleaned, block].filter(Boolean).join('\n\n');
  setSectionInstructionValue(sectionId, next, 'competitor_tip_bank', {
    source: '누적 경쟁사 팁',
    detail: `${tips.length}개 팁을 섹션 이미지 도우미로 적용`,
    tipIds: tips.map(t => t.id),
  });
  if (!state.sectionTipHelperApplied) state.sectionTipHelperApplied = {};
  state.sectionTipHelperApplied[sectionId] = {
    tipIds: tips.map(t => t.id),
    ...sectionWorkScopeMeta(),
    appliedAt: Date.now(),
  };
  savePersistentState();
}

function applyAllSectionImageHelperTips() {
  SECTIONS.forEach(section => {
    if (getSectionHelperTips(section.id, 1).length) applySectionImageHelperTips(section.id);
  });
  render();
}

function renderCompetitorTipBankSummary() {
  const allTips = loadCompetitorTipBank().tips || [];
  const tips = currentScopedCompetitorTips();
  if (!tips.length) return `<div class="section-helper-card">
    <div class="section-helper-head">
      <div class="section-helper-title">
        <span class="material-icons-outlined" style="font-size:16px">tips_and_updates</span>
        섹션 이미지 도우미
      </div>
      <span class="section-helper-count">누적 팁 0개</span>
    </div>
    <div class="section-helper-empty">현재 제품/입력 이미지 기준 경쟁사 팁이 아직 없습니다. 이전 작업 팁 ${Math.max(0, allTips.length - tips.length)}개는 현재 후보와 섞지 않습니다.</div>
  </div>`;
  const sectionMatched = tips.filter(t => Array.isArray(t.sectionIds) && t.sectionIds.length).length;
  return `<div class="section-helper-card">
    <div class="section-helper-head">
      <div class="section-helper-title">
        <span class="material-icons-outlined" style="font-size:16px">tips_and_updates</span>
        섹션 이미지 도우미
      </div>
      <span class="section-helper-count">누적 팁 ${tips.length}개 · 섹션 매칭 ${sectionMatched}개</span>
    </div>
    <div class="section-helper-muted">경쟁사 분석에서 얻은 개선 포인트를 섹션별 이미지/카피 생성 프롬프트에 반영합니다. 제품 원본 형태 보존이 항상 우선입니다.</div>
    <div class="section-helper-actions">
      <button class="btn-sm" data-apply-all-section-helpers>
        <span class="material-icons-outlined" style="font-size:14px">done_all</span>
        모든 섹션에 팁 적용
      </button>
    </div>
  </div>`;
}

function renderSectionImageHelper(sectionId) {
  const tips = getSectionHelperTips(sectionId, 3);
  if (!tips.length) return '';
  const applied = state.sectionTipHelperApplied?.[sectionId];
  const currentScope = sectionWorkScopeMeta();
  const appliedInScope = sectionWorkScopeMatches(applied, currentScope);
  const appliedCount = appliedInScope && Array.isArray(applied?.tipIds) ? applied.tipIds.length : 0;
  const appliedAt = applied?.appliedAt ? new Date(applied.appliedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="section-helper-card">
    <div class="section-helper-head">
      <div class="section-helper-title">
        <span class="material-icons-outlined" style="font-size:16px">auto_awesome</span>
        섹션 이미지 도우미
      </div>
      <span class="section-helper-count">${tips.length}개 추천</span>
    </div>
    <div class="section-helper-list">
      ${tips.map((tip, idx) => `<div class="section-helper-item">
        <b>${idx + 1}</b>${escapeHtml(summarizeText(tip.text, 150))}
      </div>`).join('')}
    </div>
    <div class="section-helper-actions">
      <button class="btn-sm" data-apply-section-helper="${sectionId}" onclick="event.stopPropagation()">
        <span class="material-icons-outlined" style="font-size:14px">add_task</span>
        ${appliedCount ? '팁 다시 적용' : '팁 적용'}
      </button>
      ${appliedCount ? `<span class="section-helper-muted">적용됨 ${appliedCount}개${appliedAt ? ` · ${escapeHtml(appliedAt)}` : ''}</span>` : ''}
    </div>
  </div>`;
}

// 섹션별 지시사항 저장/불러오기
function saveSectionInstructions(instructions) {
  const scope = sectionWorkScopeMeta();
  saveJson(STORAGE_KEYS.sectionInstructions, {
    version: 2,
    ...scope,
    instructions: instructions || {},
    updatedAt: Date.now(),
  });
}
function loadSectionInstructions(scopeSource = null) {
  const parsed = loadJson(STORAGE_KEYS.sectionInstructions, {});
  const currentScope = sectionWorkScopeMeta(scopeSource);
  if (parsed?.version === 2 || parsed?.instructions) {
    if (sectionWorkScopeMatches(parsed, currentScope)) return parsed.instructions || {};
    return {};
  }
  return {};
}

// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// SECTION ORDER HELPER
// ════════════════════════════════════════════════════════════════
function normalizeCustomSections(customSections = []) {
  if (!Array.isArray(customSections)) return [];
  return customSections
    .filter(item => item && typeof item === 'object')
    .map((item, index) => {
      const id = String(item.id || '').trim() || uid('custom_section');
      const name = String(item.name || item.label || `추가 이미지 섹션 ${index + 1}`).trim();
      return {
        n: item.n || `+${index + 1}`,
        id,
        name,
        purpose: item.purpose || '사용자가 이미지컷/자동화 결과를 직접 배치하는 추가 상세페이지 섹션.',
        desc: item.desc || '추가 이미지/컷 고정 배치',
        icon: item.icon || '🧩',
        custom: true,
      };
    });
}

function allSectionDefinitions() {
  return [...SECTIONS, ...normalizeCustomSections(state?.customSections || [])];
}

function optionColorSectionDisabled() {
  try {
    return (state?.optionSorter?.optionColorImageUsage || 'use') === 'none';
  } catch(e) {
    return false;
  }
}

function autoExcludedSectionIds() {
  return optionColorSectionDisabled() ? new Set(['size_color']) : new Set();
}

function orderedSections(options = {}) {
  const allSections = allSectionDefinitions();
  const hidden = new Set(Array.isArray(state?.hiddenSectionIds) ? state.hiddenSectionIds : []);
  const autoExcluded = autoExcludedSectionIds();
  const order = state?.sectionOrder;
  const indexed = new Map(allSections.map(s => [s.id, s]));
  const result = [];
  if (Array.isArray(order) && order.length) {
    order.forEach(id => {
      const section = indexed.get(id);
      if (section) result.push(section);
    });
  }
  for (const s of allSections) {
    if (!result.some(item => item.id === s.id)) result.push(s);
  }
  return result.filter(s =>
    (options.includeHidden || !hidden.has(s.id)) &&
    (options.includeAutoExcluded || !autoExcluded.has(s.id))
  );
}

function getSectionDefinition(sectionId) {
  return allSectionDefinitions().find(section => section.id === sectionId) || SECTIONS.find(section => section.id === sectionId) || null;
}

function addCustomDetailSection(name = '') {
  const nextName = String(name || '').trim() || `추가 이미지 섹션 ${normalizeCustomSections(state.customSections).length + 1}`;
  const section = {
    id: uid('custom_section'),
    n: `+${normalizeCustomSections(state.customSections).length + 1}`,
    name: nextName,
    purpose: '이미지컷/자동화 결과를 상세페이지 사이에 직접 삽입하는 사용자 추가 섹션.',
    desc: '사용자 추가 이미지 섹션',
    icon: '🧩',
    custom: true,
  };
  state.customSections = [...normalizeCustomSections(state.customSections), section];
  state.sectionOrder = [...(Array.isArray(state.sectionOrder) ? state.sectionOrder : SECTIONS.map(s => s.id)), section.id];
  if (Array.isArray(state.hiddenSectionIds)) {
    state.hiddenSectionIds = state.hiddenSectionIds.filter(id => id !== section.id);
  }
  return section;
}

function hideDetailSection(sectionId) {
  if (!sectionId) return;
  state.hiddenSectionIds = Array.from(new Set([...(state.hiddenSectionIds || []), sectionId]));
}

function restoreDetailSections() {
  state.hiddenSectionIds = [];
}

const TONE_PRESETS = [
  {
    id: 'emotional',
    label: '감성적인',
    tone: '따뜻하고 감성적인 선물 제안 톤',
    instruction: '전체 상세페이지를 감성적인 선물 스토리 중심으로 재구성한다. 사용 장면, 받는 사람의 기분, 정성스러운 느낌을 강조한다.'
  },
  {
    id: 'persuasive',
    label: '설득력 있는',
    tone: '구매 이유를 분명히 제시하는 설득형 톤',
    instruction: '각 섹션마다 왜 지금 구매해야 하는지, 어떤 불편을 해결하는지, 어떤 장점이 있는지 명확하게 보여준다.'
  },
  {
    id: 'technical',
    label: '전문 기술 강조',
    tone: '정확한 정보와 품질 근거를 강조하는 전문가 톤',
    instruction: '소재, 규격, 마감, 내구성, 사용성 같은 검증 가능한 정보를 중심으로 차분하고 신뢰감 있게 작성한다.'
  },
  {
    id: 'mz',
    label: '트렌디 MZ',
    tone: '가볍고 세련된 라이프스타일 톤',
    instruction: '짧고 감각적인 문장으로 일상 활용, 사진발, 취향 표현, 선물 센스를 강조한다. 과장된 유행어는 피한다.'
  },
  {
    id: 'homeshopping',
    label: '홈쇼핑 스타일',
    tone: '즉시 구매를 유도하는 활기 있는 홈쇼핑 톤',
    instruction: '혜택, 구성, 활용도, 선물 가치, 지금 선택해야 하는 이유를 리듬감 있게 강조한다. 단, 확인되지 않은 할인/수량은 만들지 않는다.'
  }
];

function editorSnapshot(label = '편집') {
  return {
    label,
    time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    sectionOrder: cloneData(state.sectionOrder || []),
    previewLayerEdits: cloneData(state.previewLayerEdits || {}),
    sectionInstructions: cloneData(state.sectionInstructions || {}),
    sectionInstructionSources: cloneData(state.sectionInstructionSources || {}),
    sectionGenerationModes: cloneData(state.sectionGenerationModes || {}),
    sectionBasisModes: cloneData(state.sectionBasisModes || {}),
    sectionAssembly: cloneData(state.sectionAssembly || {}),
    sectionBatchBasisMode: state.sectionBatchBasisMode || 'keep',
    sectionBatchGenerationMode: state.sectionBatchGenerationMode || 'keep',
    sectionGenerationMeta: cloneData(state.sectionGenerationMeta || {}),
    activeBrandPresetId: state.activeBrandPresetId || '',
    brandPresets: cloneData(state.brandPresets || []),
  };
}

function pushEditorHistory(label) {
  if (!state.editorHistory) state.editorHistory = { undo: [], redo: [] };
  state.editorHistory.undo.push(editorSnapshot(label));
  if (state.editorHistory.undo.length > 60) state.editorHistory.undo.shift();
  state.editorHistory.redo = [];
}

function restoreEditorSnapshot(snapshot) {
  if (!snapshot) return;
  state.sectionOrder = Array.isArray(snapshot.sectionOrder) && snapshot.sectionOrder.length ? snapshot.sectionOrder : SECTIONS.map(s => s.id);
  state.previewLayerEdits = snapshot.previewLayerEdits || {};
  state.sectionInstructions = snapshot.sectionInstructions || {};
  state.sectionInstructionSources = snapshot.sectionInstructionSources || {};
  state.sectionGenerationModes = normalizeSectionGenerationModes(snapshot.sectionGenerationModes || state.sectionGenerationModes);
  state.sectionBasisModes = normalizeSectionBasisModes(snapshot.sectionBasisModes || state.sectionBasisModes);
  state.sectionAssembly = normalizeSectionAssembly(snapshot.sectionAssembly || state.sectionAssembly);
  state.sectionBatchBasisMode = snapshot.sectionBatchBasisMode || state.sectionBatchBasisMode || 'keep';
  state.sectionBatchGenerationMode = snapshot.sectionBatchGenerationMode || state.sectionBatchGenerationMode || 'keep';
  state.sectionGenerationMeta = snapshot.sectionGenerationMeta || {};
  state.brandPresets = snapshot.brandPresets || state.brandPresets || [];
  state.activeBrandPresetId = snapshot.activeBrandPresetId || '';
  saveSectionInstructions(state.sectionInstructions);
  saveSectionGenerationModes(state.sectionGenerationModes);
  saveSectionBasisModes(state.sectionBasisModes);
  saveSectionAssembly(state.sectionAssembly);
  saveBrandPresets(state.brandPresets);
  localStorage.setItem(STORAGE_KEYS.activeBrandPresetId, state.activeBrandPresetId || '');
  savePersistentState();
}

function undoEditorChange() {
  const history = state.editorHistory;
  if (!history?.undo?.length) return;
  history.redo.push(editorSnapshot('다시 실행 대기'));
  const snapshot = history.undo.pop();
  restoreEditorSnapshot(snapshot);
  render();
}

function redoEditorChange() {
  const history = state.editorHistory;
  if (!history?.redo?.length) return;
  history.undo.push(editorSnapshot('되돌리기 대기'));
  const snapshot = history.redo.pop();
  restoreEditorSnapshot(snapshot);
  render();
}

function applyTonePreset(presetId) {
  const preset = TONE_PRESETS.find(p => p.id === presetId);
  if (!preset) return;
  pushEditorHistory(`톤 적용 전: ${preset.label}`);
  const id = `tone_${preset.id}`;
  const existing = (state.brandPresets || []).find(p => p.id === id);
  const nextPreset = normalizeBrandPreset({
    ...(existing || createEmptyBrandPreset()),
    id,
    name: `톤: ${preset.label}`,
    tone: preset.tone,
    globalInstruction: preset.instruction,
  });
  state.brandPresets = [
    nextPreset,
    ...(state.brandPresets || []).filter(p => p.id !== id)
  ];
  state.activeBrandPresetId = id;
  saveBrandPresets(state.brandPresets);
  localStorage.setItem(STORAGE_KEYS.activeBrandPresetId, id);
  state.progressMsg = `${preset.label} 톤을 적용했습니다. 전체 재생성 또는 섹션 재생성을 누르면 문구에 반영됩니다.`;
  savePersistentState();
  render();
}

// SESSION PERSISTENCE (analysis + generated content)
// ════════════════════════════════════════════════════════════════
const SESSION_PERSISTENCE_FAILURE_WARNINGS = new Set([
  '세션 저장에 실패했습니다. 현재 작업 저장을 눌러 안전하게 보존해주세요.',
  '세션 저장 공간이 부족합니다. 큰 이미지는 IndexedDB에 저장을 시도 중이지만, 현재 작업 저장도 함께 눌러두는 편이 안전합니다.',
]);

function clearResolvedSessionPersistenceWarning() {
  if (!SESSION_PERSISTENCE_FAILURE_WARNINGS.has(String(state.storageWarning || ''))) return false;
  state.storageWarning = '';
  state.storageWarningDismissKey = '';
  return true;
}

function savePersistentState(options = {}) {
  const documentFence = captureWorkspaceDocumentFence(options);
  if (!workspaceDocumentFenceIsCurrent(documentFence)) {
    return false;
  }
  if (!serverLastWorkHydrated || serverLastWorkHydrating) {
    workspaceScopeTransitionState.persistentSaveQueued = true;
    return false;
  }
  if (workspaceScopeTransitionState.inProgress) {
    workspaceScopeTransitionState.persistentSaveQueued = true;
    return false;
  }
  if (persistentStateSaving) {
    workspaceScopeTransitionState.persistentSaveQueued = true;
    return false;
  }
  persistentStateSaving = true;
  const persistenceStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let payload = null;
  let workspaceRevision = null;
  const finishPersistentStateSave = () => {
    const persistenceEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    state.runtimePersistenceLastMs = Math.max(0, Math.round(persistenceEndedAt - persistenceStartedAt));
    if (typeof document !== 'undefined' && document.documentElement?.dataset) {
      document.documentElement.dataset.kuasangsePersistenceLastMs = String(state.runtimePersistenceLastMs);
      document.documentElement.dataset.kuasangsePersistenceEndedAt = new Date().toISOString();
    }
    persistentStateSaving = false;
    persistentStateSavePromise = null;
    if (!workspaceDocumentFenceIsCurrent(documentFence)) {
      const shouldRetryCurrentDocument = workspaceScopeTransitionState.persistentSaveQueued
        && !workspaceBlankResetInProgress;
      workspaceScopeTransitionState.persistentSaveQueued = false;
      if (shouldRetryCurrentDocument) {
        if (persistentStateSaveRetryTimer) clearTimeout(persistentStateSaveRetryTimer);
        persistentStateSaveRetryTimer = setTimeout(() => {
          persistentStateSaveRetryTimer = null;
          savePersistentState();
        }, 0);
      }
      return;
    }
    if (workspaceScopeTransitionState.persistentSaveQueued && !serverLastWorkHydrating) {
      workspaceScopeTransitionState.persistentSaveQueued = false;
      if (persistentStateSaveRetryTimer) clearTimeout(persistentStateSaveRetryTimer);
      persistentStateSaveRetryTimer = setTimeout(() => {
        persistentStateSaveRetryTimer = null;
        savePersistentState(options);
      }, 250);
    } else {
      workspaceScopeTransitionState.persistentSaveQueued = false;
    }
  };
  let persistenceCompletion = null;
  try {
    if (options.skipVisibleSync !== true && !options.factory) syncVisibleLastWorkInputsIfStale();
    let factorySnapshot = options.factory || factoryRuntimeReadCommittedFactory();
    try {
      if (typeof factoryEnsureCurrentDetailHtmlAsset === 'function' && !options.factory) {
        const detailReceipt = factoryRuntimeUpdateOwnedFactory(
          'factory/runtime:preserveDetailHtml',
          'factory-assets',
          factory => factoryEnsureCurrentDetailHtmlAsset(factory),
        );
        factorySnapshot = detailReceipt.snapshot.factory;
      }
    } catch(e) {
      console.warn('Detail preview preserve before session save failed:', e);
    }
    if (factorySnapshot && typeof factorySnapshot === 'object') {
      const cafe24FieldView = resolveCafe24FieldViewForLastWork(factorySnapshot);
      persistCafe24FieldViewForLastWork(cafe24FieldView);
      if (!options.factory) {
        const metadataReceipt = factoryRuntimeUpdateOwnedFactory(
          'factory/runtime:saveSnapshotMetadata',
          'factory',
          factory => {
            factory.cafe24FieldView = cloneData(cafe24FieldView);
            factory.lastSavedAt = Date.now();
            return { lastSavedAt: factory.lastSavedAt };
          },
        );
        factorySnapshot = metadataReceipt.snapshot.factory;
      }
      scheduleFactoryLastSnapshotSave();
    }
    if (!workspaceDocumentFenceIsCurrent(documentFence)) {
      persistenceCompletion = Promise.resolve(false).finally(finishPersistentStateSave);
      persistentStateSavePromise = persistenceCompletion;
      return persistenceCompletion;
    }
    const inputImageFingerprint = currentWorkspaceInputImageFingerprint(factorySnapshot);
    const workIdentity = ensureActiveWorkIdentity({ factorySnapshot, inputImageFingerprint });
    const scopeId = documentFence.scopeId;
    payload = {
      step: state.step,
      analysis: state.analysis,
      competitorData: state.competitorData,
      sectionContents: state.sectionContents,
      imagePreview: state.imagePreview,
      imageMime: state.imageMime,
      analysisImages: state.analysisImages,
      productName: state.productName,
      modelConfig: state.modelConfig,
      analysisTimestamp: state.analysisTimestamp,
      currentProjectId: state.currentProjectId,
      currentProjectName: state.currentProjectName,
      currentProjectCreatedAt: state.currentProjectCreatedAt,
      workIdentity: cloneData(workIdentity),
      inputImageFingerprint,
      workspaceScope: { id: scopeId },
      workspaceBranch: currentWorkspaceBranch(scopeId, state.currentProjectId),
      workspaceRevision,
      workfileLastSavedAt: state.workfileLastSavedAt,
      sectionWorkScope: state.sectionWorkScope || sectionWorkScopeMeta(),
      sectionLocks: state.sectionLocks,
      sectionInstructionSources: state.sectionInstructionSources,
      sectionGenerationModes: state.sectionGenerationModes,
      sectionBasisModes: state.sectionBasisModes,
      sectionAssembly: state.sectionAssembly,
      sectionBatchBasisMode: state.sectionBatchBasisMode || 'keep',
      sectionBatchGenerationMode: state.sectionBatchGenerationMode || 'keep',
      sectionGenerationMeta: state.sectionGenerationMeta,
      sectionVariants: state.sectionVariants,
      currentSectionVariantIds: state.currentSectionVariantIds,
      sectionTipHelperApplied: state.sectionTipHelperApplied,
      sectionVariantEvaluations: state.sectionVariantEvaluations,
      analysisRuns: state.analysisRuns,
      currentAnalysisRunId: state.currentAnalysisRunId,
      analysisCompareMode: state.analysisCompareMode,
      analysisMatchSettings: state.analysisMatchSettings,
      dbMatchCandidates: state.dbMatchCandidates,
      dbMatchError: state.dbMatchError,
      dbMatchLastQuery: state.dbMatchLastQuery,
      dbMatchSelectionOpen: state.dbMatchSelectionOpen,
      dbColorOptions: state.dbColorOptions,
      dbColorOptionsError: state.dbColorOptionsError,
      dbColorOptionsLastJcode: state.dbColorOptionsLastJcode,
      dbColorOptionsLoadedAt: state.dbColorOptionsLoadedAt,
      productInfoFieldSettings: state.productInfoFieldSettings,
      productInfoOptionsOpen: state.productInfoOptionsOpen,
      productInfoManualValues: state.productInfoManualValues,
      aiRepairUndoStack: state.aiRepairUndoStack,
      manualSectionEdits: state.manualSectionEdits,
      previewLayerEdits: state.previewLayerEdits,
      detailImageBlocks: state.detailImageBlocks,
      fixedDetailImages: state.fixedDetailImages,
      aiRepair: {
        ...(state.aiRepair || {}),
        open: false,
        busy: false,
        error: '',
      },
      cuts: state.cuts,
      imageDirectiveInput: state.imageDirectiveInput,
      brandPresetDraft: state.brandPresetDraft,
      layoutTemplate: state.layoutTemplate,
      activeBrandPresetId: state.activeBrandPresetId,
      optionSorter: state.optionSorter,
      factory: factorySnapshot,
      contentVersion: state.contentVersion,
      qaVersion: state.qaVersion,
      sectionOrder: state.sectionOrder,
      hiddenSectionIds: state.hiddenSectionIds,
      customSections: state.customSections,
      compPage: state.compPage,
    };
    const lightweight = buildLightweightSessionPayload(payload);
    const result = selectLocalSessionPayload(lightweight);
    if (!result.ok) throw result.error || new Error('localStorage session save failed');
    lastLightweightSessionPayload = result.payload;
    if (!workspaceDocumentFenceIsCurrent(documentFence)) {
      persistenceCompletion = Promise.resolve(false).finally(finishPersistentStateSave);
      persistentStateSavePromise = persistenceCompletion;
      return persistenceCompletion;
    }
    const contentVersion = Number(state.contentVersion || 0);
    persistenceCompletion = ensureWorkspaceEditAuthority(scopeId).then(async authority => {
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return null;
      if (scopeId.startsWith('project:') && authority?.mode !== 'editing') {
        throw new Error('현재 작업의 편집권이 없어 자동 저장을 중지했습니다.');
      }
      await saveLastProductImageBackupToDbIfChanged();
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return null;
      const sessionAssets = await sessionAssetsForAuthoritativeCommit();
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return null;
      workspaceRevision = nextCurrentWorkspaceRevision(scopeId);
      const metadata = workspaceCommitMetadata(scopeId, 'session-save', workspaceRevision);
      workspaceRevision = metadata.revision;
      payload.workspaceRevision = workspaceRevision;
      result.payload.workspaceRevision = workspaceRevision;
      const serverSnapshot = buildServerLastWorkSnapshot('session-save', { factorySnapshot });
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return null;
      return workspacePersistenceApi().commit({
        scopeId,
        snapshot: result.payload,
        metadata,
        rebaseRevision: true,
        replicas: ['session'],
        context: {
          server: { bases: getServerLastWorkBases(), serverSnapshot },
          indexeddb: { sessionAssets },
        },
        isCurrent: () => workspaceDocumentFenceIsCurrent(documentFence)
          && Number(state.contentVersion || 0) === contentVersion,
      });
    }).then(commitResult => {
      if (!commitResult || commitResult.stale) {
        return false;
      }
      if (!commitResult.accepted || commitResult.partial) {
        throw new Error(commitResult.failures?.[0]?.message || '세션 저장 경계 실패');
      }
      if (commitResult.protectedNoOp) {
        const warningCleared = clearResolvedSessionPersistenceWarning();
        if (warningCleared && options.deferWarningRender !== true && !state.projectBusy && typeof render === 'function') render();
        return true;
      }
      if (!commitResult.clean) {
        return false;
      }
      if (!workspaceDocumentFenceIsCurrent(documentFence)) return false;
      commitCurrentWorkspaceRevision(commitResult.envelope.metadata.revision);
      saveLastWorkBootstrap({ documentFence });
      lastLocalSessionJson = result.json;
      markSessionAssetFingerprintSaved();
      const warningCleared = clearResolvedSessionPersistenceWarning();
      if (warningCleared && options.deferWarningRender !== true && !state.projectBusy && typeof render === 'function') render();
      if (options.skipSessionAssetSave !== true) scheduleSessionAssetSaveIfChanged();
      if (options.allowBlankResetCheckpoint !== true && options.server !== false) {
        scheduleServerLastWorkSave('persistent-state', 3200, {
          factorySnapshot,
          force: options.force === true,
        });
      }
      return true;
    }).catch(error => {
      console.warn('Session persistence commit failed:', error);
      state.storageWarning = '세션 저장에 실패했습니다. 현재 작업 저장을 눌러 안전하게 보존해주세요.';
      return false;
    }).finally(finishPersistentStateSave);
  } catch(e) {
    console.warn('Session metadata save failed:', e);
    state.storageWarning = '세션 저장 공간이 부족합니다. 큰 이미지는 IndexedDB에 저장을 시도 중이지만, 현재 작업 저장도 함께 눌러두는 편이 안전합니다.';
    persistenceCompletion = Promise.resolve(false).finally(finishPersistentStateSave);
  }
  persistentStateSavePromise = persistenceCompletion;
  return persistenceCompletion;
}

async function flushQueuedPersistentState(options = {}, retryCount = 0) {
  const inFlight = persistentStateSavePromise;
  if (inFlight) await Promise.resolve(inFlight).catch(() => false);
  const hydration = serverLastWorkHydrationPromise;
  if (hydration) await Promise.resolve(hydration).catch(() => false);
  const deferredHydration = typeof classicRuntimeDeferredHydrationPromise === 'undefined'
    ? null
    : classicRuntimeDeferredHydrationPromise;
  if (
    typeof serverLastWorkHydrated === 'boolean'
    && !serverLastWorkHydrated
    && deferredHydration
  ) {
    await Promise.resolve(deferredHydration).catch(() => false);
  }
  const saveStartedDuringHydration = persistentStateSavePromise;
  if (saveStartedDuringHydration && saveStartedDuringHydration !== inFlight) {
    await Promise.resolve(saveStartedDuringHydration).catch(() => false);
  }
  if (persistentStateSaveRetryTimer) {
    clearTimeout(persistentStateSaveRetryTimer);
    persistentStateSaveRetryTimer = null;
  }
  workspaceScopeTransitionState.persistentSaveQueued = false;
  const saved = savePersistentState(options);
  const completed = saved === false
    ? false
    : await Promise.resolve(saved).then(result => result === true, () => false);
  if (completed) return true;
  if (retryCount >= 2) return false;
  return flushQueuedPersistentState(options, retryCount + 1);
}

function loadPersistentSession() {
  try {
    const bootstrap = loadLastWorkBootstrap();
    const validateStartupCandidate = candidate => {
      if (!candidate || typeof candidate !== 'object') return null;
      const result = workspacePersistenceApi().validateSnapshotIdentity(candidate);
      if (result.ok) {
        const bound = bindWorkspaceSnapshotToCurrentBranch(candidate);
        if (bound) return bound;
        setStorageWarningOnce('다른 탭 편집본이 현재 탭 복원 경계로 들어오는 것을 차단했습니다.');
        return null;
      }
      setStorageWarningOnce(`서로 다른 작업파일·제품명·기본이미지가 섞인 복원본을 차단했습니다. (${result.code})`);
      return null;
    };
    const validatedBootstrap = validateStartupCandidate(bootstrap);
    const raw = workspaceSessionGetItem('pdp_session');
    if (!raw) {
      if (validatedBootstrap) return validatedBootstrap;
      const factorySnapshot = loadFactoryLastSnapshot();
      return factorySnapshot
        ? validateStartupCandidate({ step: 'factory', factory: factorySnapshot })
        : null;
    }
    if (raw.length > LOCAL_SESSION_MAX_CHARS * 3) {
      try { workspaceSessionRemoveItem('pdp_session'); } catch(e) {}
      try { workspaceSessionRemoveItem('pdp_session_img'); } catch(e) {}
      try { workspaceSessionRemoveItem('pdp_session_imgs'); } catch(e) {}
      try { workspaceSessionRemoveItem('pdp_detail_image_blocks'); } catch(e) {}
      setStorageWarningOnce('브라우저에 남아 있던 오래된 대용량 세션 저장값을 정리했습니다. 마지막 작업 저장소에서 현재 작업 복원을 계속 시도합니다.');
      const factorySnapshot = loadFactoryLastSnapshot();
      return factorySnapshot
        ? validateStartupCandidate({ step: 'factory', factory: factorySnapshot })
        : null;
    }
    let s = JSON.parse(raw);
    const identityValidation = workspacePersistenceApi().validateSnapshotIdentity(s);
    if (!identityValidation.ok) {
      setStorageWarningOnce(`서로 다른 작업파일·제품명·기본이미지가 섞인 탭 복원본을 차단했습니다. (${identityValidation.code})`);
      try { workspaceSessionRemoveItem('pdp_session'); } catch(e) {}
      return validatedBootstrap;
    }
    s = bindWorkspaceSnapshotToCurrentBranch(s);
    if (!s) {
      setStorageWarningOnce('다른 탭의 편집 브랜치가 현재 탭으로 섞이는 것을 차단했습니다.');
      try { workspaceSessionRemoveItem('pdp_session'); } catch(e) {}
      return validatedBootstrap;
    }
    let savedWorkspaceScope = s.workspaceScope && typeof s.workspaceScope === 'object'
      ? String(s.workspaceScope.id || '').trim()
      : String(s.workspaceScope || s.workspaceId || '').trim();
    if (!savedWorkspaceScope) {
      savedWorkspaceScope = String(workspaceSnapshotRevision(s)?.scopeId || '').trim();
      if (savedWorkspaceScope) s.workspaceScope = { id: savedWorkspaceScope };
    }
    if (!savedWorkspaceScope && s.currentProjectId) {
      savedWorkspaceScope = `project:${String(s.currentProjectId).trim()}`;
      s.workspaceScope = { id: savedWorkspaceScope };
    }
    if (!savedWorkspaceScope) {
      if (validatedBootstrap) return validatedBootstrap;
      setStorageWarningOnce('작업파일 경계가 없는 이전 임시 복원본은 현재 작업에 적용하지 않았습니다. 저장한 작업파일을 불러오면 그 파일 상태만 복원합니다.');
      return null;
    }
    if (!workspaceRevisionAllowsSnapshot(s, { scopeId: savedWorkspaceScope, allowEqual: true })) {
      return validatedBootstrap || null;
    }
    observeWorkspaceRevisionSnapshot(s, savedWorkspaceScope);
    if (validatedBootstrap && lastWorkSnapshotWorkspaceScope(validatedBootstrap) !== savedWorkspaceScope) return validatedBootstrap;
    // 과도기 step → 안전한 step으로 정규화
    if (s.step === 'analyzing') s.step = 'sections';
    if (s.step === 'generating') s.step = Object.keys(s.sectionContents||{}).length > 0 ? 'preview' : 'sections';
    if (s.imagePreview === '__stored_in_indexeddb__') s.imagePreview = null;
    if (Array.isArray(s.analysisImages)) {
      s.analysisImages = s.analysisImages.filter(img => img && (img.base64 || img.hasImageData || img.name));
    } else {
      s.analysisImages = [];
    }
    s.imageBase64 = null;
    s.sectionImages = stripRuntimeSectionImages(readLegacyLocalStorageJson('pdp_session_imgs', {}, 260000));
    s.currentProjectId = s.currentProjectId || '';
    s.currentProjectName = s.currentProjectName || '';
    s.currentProjectCreatedAt = s.currentProjectCreatedAt || null;
    s.sectionLocks = s.sectionLocks || {};
    s.sectionInstructionSources = s.sectionInstructionSources || {};
    s.sectionGenerationModes = normalizeSectionGenerationModes(s.sectionGenerationModes || loadSectionGenerationModes());
    s.sectionBasisModes = normalizeSectionBasisModes(s.sectionBasisModes || loadSectionBasisModes());
    s.sectionBatchBasisMode = s.sectionBatchBasisMode || 'keep';
    s.sectionBatchGenerationMode = s.sectionBatchGenerationMode || 'keep';
    s.sectionGenerationMeta = s.sectionGenerationMeta || {};
    s.sectionVariants = s.sectionVariants || {};
    s.currentSectionVariantIds = s.currentSectionVariantIds || {};
    restoreSectionContentsFromStoredVariants(s);
    s.sectionTipHelperApplied = s.sectionTipHelperApplied || {};
    s.sectionVariantEvaluations = s.sectionVariantEvaluations || {};
    s.analysisRuns = Array.isArray(s.analysisRuns) ? s.analysisRuns : [];
    s.currentAnalysisRunId = s.currentAnalysisRunId || '';
    s.analysisCompareMode = s.analysisCompareMode || 'image';
    s.analysisMatchSettings = normalizeAnalysisMatchSettings(s.analysisMatchSettings);
    s.dbMatchCandidates = Array.isArray(s.dbMatchCandidates) ? s.dbMatchCandidates : [];
    s.dbMatchError = s.dbMatchError || '';
    s.dbMatchLastQuery = s.dbMatchLastQuery || '';
    s.dbMatchSelectionOpen = !!s.dbMatchSelectionOpen;
    s.dbColorOptions = Array.isArray(s.dbColorOptions) ? s.dbColorOptions : [];
    s.dbColorOptionsError = s.dbColorOptionsError || '';
    s.dbColorOptionsLastJcode = s.dbColorOptionsLastJcode || '';
    s.dbColorOptionsLoadedAt = Number.isFinite(s.dbColorOptionsLoadedAt) ? s.dbColorOptionsLoadedAt : null;
    s.productInfoFieldSettings = normalizeProductInfoFieldSettings(s.productInfoFieldSettings);
    s.productInfoOptionsOpen = !!s.productInfoOptionsOpen;
    s.productInfoManualValues = normalizeProductInfoManualValues(s.productInfoManualValues);
    s.aiRepairUndoStack = s.aiRepairUndoStack || {};
    s.manualSectionEdits = s.manualSectionEdits || {};
    s.previewLayerEdits = s.previewLayerEdits || {};
    s.aiRepair = s.aiRepair || null;
    s.cuts = s.cuts || null;
    s.imageDirectiveInput = typeof s.imageDirectiveInput === 'string' ? s.imageDirectiveInput : '';
    s.brandPresetDraft = s.brandPresetDraft || null;
    s.fixedDetailImages = mergeFixedDetailImages(loadFixedDetailImages(), s.fixedDetailImages);
    s.detailImageBlocks = stripRuntimeDetailBlockImages(readLegacyLocalStorageJson('pdp_detail_image_blocks', s.detailImageBlocks || [], 260000));
    s.layoutTemplate = LAYOUT_TEMPLATES.some(t => t.id === s.layoutTemplate) ? s.layoutTemplate : loadLayoutTemplate();
    s.activeBrandPresetId = typeof s.activeBrandPresetId === 'string' ? s.activeBrandPresetId : loadActiveBrandPresetId();
    s.optionSorter = normalizeOptionSorterState(s.optionSorter);
    applyOptionSorterLiveRecovery(s, { scopeId: savedWorkspaceScope });
    s.factory = normalizeFactoryState(s.factory);
    if (typeof stripFactoryImages === 'function') s.factory = normalizeFactoryState(stripFactoryImages(s.factory));
    s.optionSorter = normalizeOptionSorterState(restoreOptionSorterLabelsFromFactory(s.optionSorter, s.factory));
    s.factory.cafe24FieldView = resolveCafe24FieldViewForLastWork(s.factory);
    persistCafe24FieldViewForLastWork(s.factory.cafe24FieldView);
    restoreSpecificationSizeImageFromFactory(s);
    s.sectionImages = stripRuntimeSectionImages(s.sectionImages);
    s.detailImageBlocks = stripRuntimeDetailBlockImages(s.detailImageBlocks);
    s.sectionVariants = stripRuntimeVariantImages(s.sectionVariants);
    s.cuts = s.cuts ? stripCutsImages(s.cuts, {
      preserveRecentResults: true,
      generalResultLimit: 16,
      sizeResultLimit: 8,
    }) : s.cuts;
    const factoryProduct = s.factory?.product || {};
    const factoryProductName = String(factoryProduct.userProductName || factoryProduct.productName || '').trim();
    const factoryProductKey = typeof factoryNormalizeIdentityText === 'function'
      ? factoryNormalizeIdentityText(factoryProductName)
      : factoryProductName.replace(/\s+/g, '').toLowerCase();
    const sessionProductKey = typeof factoryNormalizeIdentityText === 'function'
      ? factoryNormalizeIdentityText(s.productName || '')
      : String(s.productName || '').replace(/\s+/g, '').toLowerCase();
    const factoryHasLockedCurrentWork = !!(
      factoryProduct.cafe24FinalRegistration?.productName ||
      factoryProduct.lockedInputImageFingerprint ||
      factoryProduct.inputImageFingerprint ||
      factoryProduct.selectedDbCandidateKey ||
      factoryProduct.selectedCafe24CandidateKey ||
      factoryProduct.confirmedDb ||
      factoryProduct.finalDb ||
      (Array.isArray(s.factory?.assets) && s.factory.assets.length)
    );
    if (factoryProductName && !sessionProductKey) {
      s.productName = factoryProductName;
    } else if (!String(s.productName || '').trim() && factoryProductName) {
      s.productName = factoryProductName;
    }
    if (Array.isArray(s.dbMatchCandidates) && typeof factoryObjectConflictsWithIdentity === 'function') {
      s.dbMatchCandidates = s.dbMatchCandidates.filter(item => !factoryObjectConflictsWithIdentity(item, factoryProductKey));
    }
    sanitizeLastWorkPayloadProductScope(s, {
      mutate: true,
      targetName: s.factory?.product?.productName || s.productName || factoryProductName,
    });
    const restoredCandidateWorkspaceId = factoryWorkspaceIdentityFromSource(s.factory).id;
    const restoredWorkspaceId = resolveRestoredCandidateReviewWorkspaceId(
      restoredCandidateWorkspaceId,
      s.currentProjectId,
    );
    if (restoredWorkspaceId && typeof factoryRecoverRestoredReviewCandidateWorkspaceScope === 'function') {
      factoryRecoverRestoredReviewCandidateWorkspaceScope(
        s.factory,
        restoredCandidateWorkspaceId,
        restoredWorkspaceId,
        { productName: s.productName || factoryProductName }
      );
    }
    const sessionHasVisibleProductImage = !!(
      s.imageBase64 ||
      (s.imagePreview && s.imagePreview !== '__stored_in_indexeddb__') ||
      (Array.isArray(s.analysisImages) && s.analysisImages.some(img =>
        img?.base64 ||
        (typeof runtimeExternalImageSrc === 'function' && runtimeExternalImageSrc(img?.preview || img?.dataUrl || img?.image))
      ))
    );
    if (!sessionHasVisibleProductImage && typeof factoryProductHasImage === 'function' && factoryProductHasImage(factoryProduct)) {
      const productPreview = runtimeExternalImageSrc(factoryProduct.imagePreview);
      s.imagePreview = productPreview || IMAGE_STORED_MARKER;
      s.imageMime = factoryProduct.imageMime || s.imageMime || 'image/png';
    }
    s.contentVersion = Number.isFinite(s.contentVersion) ? s.contentVersion : 0;
    s.qaVersion = Number.isFinite(s.qaVersion) ? s.qaVersion : 0;
    s.sectionOrder = Array.isArray(s.sectionOrder) && s.sectionOrder.length > 0 ? s.sectionOrder : null;
    s.hiddenSectionIds = Array.isArray(s.hiddenSectionIds) ? s.hiddenSectionIds.filter(Boolean) : [];
    s.customSections = normalizeCustomSections(s.customSections || []);
    s.compPage = s.compPage || null;
    return s;
  } catch(e) {
    console.warn('Persistent session load failed:', e);
    return null;
  }
}
async function clearPersistentSession() {
  const recoveryClears = [
    workspaceSessionRemoveItem(LAST_WORK_BOOTSTRAP_STORAGE_KEY),
    workspaceSessionRemoveItem('pdp_session'),
    workspaceSessionRemoveItem('pdp_session_img'),
    workspaceSessionRemoveItem('pdp_session_imgs'),
    workspaceSessionRemoveItem('pdp_detail_image_blocks'),
    workspaceSessionRemoveItem(OPTION_SORTER_LIVE_RECOVERY_KEY),
    workspaceSessionRemoveItem(STORAGE_KEYS.factoryLastSnapshot),
    workspaceSessionRemoveItem(LAST_WORK_INPUT_CHECKPOINT_KEY),
    workspaceSessionRemoveItem('fixed_detail_images_v1'),
    workspaceSessionRemoveItem('comp_analysis'),
    workspaceSessionRemoveItem('kuasangse.projectFileLocationLabel.v1'),
    workspaceSessionRemoveItem('cuts_size_results_cache_v1'),
    workspaceSessionRemoveItem('factory_wizard_field_drafts_v1'),
    workspaceSessionRemoveItem('kuasangse_comp_market_candidate_snapshot_v1'),
    workspaceSessionRemoveItem('kuasangse_comp_market_image_selection_v1'),
  ];
  if (sessionAssetSavePromise) {
    await sessionAssetSavePromise.catch(() => false);
  }
  if (lastProductImageBackupSavePromise) {
    await lastProductImageBackupSavePromise.catch(() => false);
  }
  await Promise.allSettled([
    ...recoveryClears,
    workspaceDelete(WORKSPACE_DB.sessionAssets, currentSessionAssetId()),
    workspaceDelete(WORKSPACE_DB.appSettings, lastProductImageBackupStorageId()),
  ]);
  lastProductImageBackupFingerprint = '';
}

function defaultOptionSorterState() {
  return {
    slots: Array.from({length: 10}, (_, i) => ({
      id: 'slot_' + (i + 1),
      name: (i + 1) + '번',
      imgIds: [],
    })),
    pool: [],
    images: [],
    previewImageId: null,
    previewResultId: null,
    styleSampleResultId: null,
    styleSampleLibraryId: null,
    styleSample: null,
    optionColorImageUsage: 'use',
    optionGroupShotSelectionMode: 'all',
    optionGroupShotSelectedImageIds: [],
    optionGroupShotTargetCount: 1,
    optionGroupShotPrompt: '',
    optionGroupShotRunning: false,
    optionGroupShotProgress: 0,
    optionGroupShotLastResultId: null,
    optionGroupShotLastError: '',
    optionImageMode: 'ready',
    optionOutputLayout: 'all',
    optionSheetCols: 2,
    optionSheetRows: 2,
    optionSheetLayoutMode: 'auto',
    optionSheetLayoutUserSet: false,
    optionSheetRowPattern: '',
    optionPairOrder: [],
    optionSheetPixelMode: 'auto',
    optionSheetPixelPreset: 'auto',
    optionSheetWidth: 1246,
    optionSheetHeight: 1366,
    optionSheetMethod: 'locked_canvas',
    optionContentMode: 'full_image',
    optionArchiveEnabled: false,
    optionArchiveFolderName: '',
    optionArchiveStatus: '',
    optionArchiveLastSavedAt: '',
    optionArchiveSavedCount: 0,
    optionSlotPresetId: '',
    optionSlotPresetNotice: '',
    optionTonePresetId: 'default-clean',
    optionTone: '하나의 옵션표처럼 통일: 모든 칸은 같은 크기, 같은 흰색/밝은 회백색 배경, 같은 제품 확대율, 같은 여백, 같은 하단 라벨 폭/높이/폰트/위치. 모든 제품은 세로 정면 직립 구도.',
    optionExtraPrompt: '',
    optionGenRunning: false,
    optionGenProgress: 0,
    optionColorHintBusy: false,
    optionVisionColorBusy: false,
    optionAutoColorNameStatus: '',
    optionGenLogs: [],
    optionResults: [],
    optionLastGeneratedResultIds: [],
    subStepUpdatedAt: 0,
    subStep: 'input',
  };
}

function clampOptionSheetCount(value, fallback = 2) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(30, n)) : fallback;
}

function clampOptionSheetPixels(value, fallback = 1246) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(320, Math.min(4096, n)) : fallback;
}

function optScaleOptionSheetSize(width, height, maxSide = 4096, options = {}) {
  const targetMaxSide = clampOptionSheetPixels(maxSide, 4096);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 1246, height: 1366 };
  }
  const currentMaxSide = Math.max(width, height);
  const scale = options.allowUpscale ? targetMaxSide / currentMaxSide : Math.min(1, targetMaxSide / currentMaxSide);
  return {
    width: clampOptionSheetPixels(Math.round(width * scale), 1246),
    height: clampOptionSheetPixels(Math.round(height * scale), 1366),
  };
}

function optScaleOptionSheetAutoSize(width, height) {
  return optScaleOptionSheetSize(width, height, 4096, { allowUpscale: false });
}

function optNormalizeRowPattern(value, maxCells = 30) {
  const text = Array.isArray(value) ? value.join(',') : String(value || '');
  const nums = text
    .split(/[,\s/|+]+/)
    .map(v => Number.parseInt(v, 10))
    .filter(v => Number.isFinite(v) && v > 0)
    .map(v => Math.min(30, v));
  const result = [];
  let total = 0;
  nums.forEach(v => {
    if (total >= maxCells) return;
    const next = Math.min(v, maxCells - total);
    if (next > 0) {
      result.push(next);
      total += next;
    }
  });
  return result;
}

function optRowPatternKey(pattern = []) {
  return (pattern || []).filter(v => Number.isFinite(Number(v)) && Number(v) > 0).map(v => String(Number(v))).join(',');
}

function optPatternCellCount(pattern = []) {
  return (pattern || []).reduce((sum, v) => sum + (Number.parseInt(v, 10) || 0), 0);
}

function optCompactPatternForCount(pattern = [], count = 0) {
  const total = Math.max(0, Number.parseInt(count, 10) || 0);
  const out = [];
  let remaining = total;
  for (const raw of pattern || []) {
    if (remaining <= 0) break;
    const rowCap = Math.max(1, Number.parseInt(raw, 10) || 1);
    const used = Math.min(rowCap, remaining);
    if (used > 0) out.push(used);
    remaining -= used;
  }
  if (remaining > 0) out.push(remaining);
  return out.length ? out : [1];
}

function optGridPattern(rows, cols) {
  const r = clampOptionSheetCount(rows, 2);
  const c = clampOptionSheetCount(cols, 2);
  return Array.from({ length: r }, () => c);
}

function optBalancedRows(total, rowCount) {
  const n = Math.max(1, Number.parseInt(total, 10) || 1);
  const rows = Math.max(1, Math.min(n, Number.parseInt(rowCount, 10) || 1));
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, idx) => base + (idx < extra ? 1 : 0)).filter(Boolean);
}

function optRowsByMaxCols(total, maxCols) {
  const n = Math.max(1, Number.parseInt(total, 10) || 1);
  const cols = Math.max(1, Number.parseInt(maxCols, 10) || 1);
  const out = [];
  let remaining = n;
  while (remaining > 0) {
    const used = Math.min(cols, remaining);
    out.push(used);
    remaining -= used;
  }
  return out;
}

function optBuildAutoLayoutPattern(total) {
  const count = Math.max(1, Number.parseInt(total, 10) || 1);
  const perSheet = Math.min(count, 12);
  const maxCols = perSheet <= 2 ? perSheet : (perSheet <= 6 ? 3 : 4);
  const rowCount = Math.max(1, Math.ceil(perSheet / Math.max(1, maxCols)));
  return optBalancedRows(perSheet, rowCount);
}

function optParseLayoutPatternInput(value, fallbackCount = 1) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const gridPlusMatch = raw.match(/^(\d+)\s*[*xX×]\s*(\d+)\s*\+\s*(\d+)$/);
  if (gridPlusMatch) {
    const rows = clampOptionSheetCount(gridPlusMatch[1], 1);
    const cols = clampOptionSheetCount(gridPlusMatch[2], 1);
    const extra = clampOptionSheetCount(gridPlusMatch[3], 1);
    const pattern = optNormalizeRowPattern([...optGridPattern(rows, cols), extra], 30);
    return {
      mode: 'rows',
      rows: pattern.length,
      cols: Math.max(...pattern),
      pattern,
      label: `${rows}x${cols}+${extra}`,
    };
  }
  const gridMatch = raw.match(/^(\d+)\s*[*xX×]\s*(\d+)$/);
  if (gridMatch) {
    const rows = clampOptionSheetCount(gridMatch[1], 1);
    const cols = clampOptionSheetCount(gridMatch[2], 1);
    return {
      mode: 'grid',
      rows,
      cols,
      pattern: optGridPattern(rows, cols),
      label: `${rows}x${cols}`,
    };
  }
  const pattern = optNormalizeRowPattern(raw, 30);
  if (pattern.length) {
    return {
      mode: 'rows',
      rows: pattern.length,
      cols: Math.max(...pattern),
      pattern,
      label: pattern.join(','),
    };
  }
  const n = Math.max(1, Number.parseInt(fallbackCount, 10) || 1);
  return {
    mode: 'rows',
    rows: 1,
    cols: n,
    pattern: [n],
    label: String(n),
  };
}

function optGetSelectedLayoutPattern(os = state.optionSorter, pairCount = 0) {
  ensureOptionSorterDefaults(os);
  const total = Math.max(0, Number.parseInt(pairCount, 10) || 0);
  if (!os.optionSheetLayoutUserSet || os.optionSheetLayoutMode === 'auto') {
    const pattern = optBuildAutoLayoutPattern(total || 1);
    return {
      mode: 'auto',
      selectedRows: pattern.length,
      selectedCols: Math.max(...pattern),
      selectedPattern: pattern,
      capacity: optPatternCellCount(pattern),
      selectedLabel: `자동 ${pattern.length}행 · ${pattern.join('/')}칸`,
    };
  }
  if (os.optionSheetLayoutMode === 'rows') {
    const pattern = optNormalizeRowPattern(os.optionSheetRowPattern, 30);
    if (pattern.length) {
      return {
        mode: 'rows',
        selectedRows: pattern.length,
        selectedCols: Math.max(...pattern),
        selectedPattern: pattern,
        capacity: optPatternCellCount(pattern),
        selectedLabel: pattern.join(','),
      };
    }
  }
  const grid = optGetOptionSheetGrid(os);
  const selectedPattern = optGridPattern(grid.rows, grid.cols);
  return {
    mode: 'grid',
    selectedRows: grid.rows,
    selectedCols: grid.cols,
    selectedPattern,
    capacity: optPatternCellCount(selectedPattern),
    selectedLabel: `${grid.rows}x${grid.cols}`,
  };
}

function optBuildOptionLayoutCandidates(count) {
  const n = Math.max(0, Number.parseInt(count, 10) || 0);
  if (n <= 0) return [];
  const candidates = [];
  const add = (id, title, pattern, desc = '', allowSplit = false) => {
    const clean = optNormalizeRowPattern(pattern, 30);
    const total = optPatternCellCount(clean);
    if (!clean.length || (!allowSplit && total < n)) return;
    const key = optRowPatternKey(clean);
    if (candidates.some(item => item.key === key)) return;
    const splitDesc = allowSplit && total < n ? `${Math.ceil(n / Math.max(1, total))}장으로 분할` : desc;
    candidates.push({
      id,
      title,
      pattern: clean,
      key,
      rows: clean.length,
      cols: Math.max(...clean),
      capacity: total,
      desc: splitDesc,
    });
  };
  if (n <= 10) {
    add('one-row', `1행 ${n}칸`, [n], '가로로 한 줄');
    for (let rows = 2; rows <= Math.min(4, n); rows += 1) {
      add(`balanced-${rows}`, `${rows}행 균등`, optBalancedRows(n, rows), '남는 칸 없이 행별 자동 분배');
    }
    [[2, 2], [3, 3]].forEach(([rows, cols]) => {
      const capacity = rows * cols;
      if (capacity < n) {
        add(`split-${rows}x${cols}`, `${rows}행 ${cols}칸씩`, optGridPattern(rows, cols), '', true);
      }
    });
    const squareCols = Math.ceil(Math.sqrt(n));
    add('near-square', '정사각형에 가깝게', optRowsByMaxCols(n, squareCols), '가로/세로 균형형');
    [2, 3, 4, 5].forEach(cols => add(`max-${cols}`, `행당 ${cols}칸`, optRowsByMaxCols(n, cols), `각 행 최대 ${cols}칸`));
  }
  return candidates.slice(0, 10);
}

function optRenderPatternPreview(pattern = []) {
  const clean = optNormalizeRowPattern(pattern, 30);
  if (!clean.length) return '';
  const cols = Math.max(...clean);
  return `<div class="opt-layout-mini ${cols > 12 || clean.length > 8 ? 'compact' : ''}" style="--opt-layout-cols:${cols}">
    ${clean.map(rowCount => `<div class="opt-layout-mini-row" style="grid-template-columns:repeat(${cols},1fr)">
      ${Array.from({ length: cols }, (_, idx) => `<span class="${idx < rowCount ? 'filled' : 'empty'}"></span>`).join('')}
    </div>`).join('')}
  </div>`;
}

function optLayoutSummaryFromSheets(sheets = []) {
  if (!sheets.length) return '옵션표 0장';
  return sheets.map(sheet => `${sheet.index}장:${(sheet.rowPattern || []).join('/') || sheet.pairs.length}`).join(' · ');
}

function restoreOptionSorterLabelsFromFactory(optionSorter = {}, factory = {}) {
  const slots = Array.isArray(optionSorter?.slots) ? optionSorter.slots : [];
  const rawValues = factory?.product?.finalDb?.option_values;
  const labels = (Array.isArray(rawValues)
    ? rawValues
    : (typeof rawValues === 'string' ? rawValues.split(/[,;\n]+/) : []))
    .map(value => String(value || '').trim())
    .filter(Boolean);
  const allGenericNames = slots.every(slot => optionSorterSlotNameIsGeneric(slot?.name));
  const allCanonicalNames = slots.every((slot, index) => String(slot?.name || '').trim() === labels[index]);
  if (!labels.length || labels.length !== slots.length || (!allGenericNames && !allCanonicalNames)) {
    return optionSorter;
  }
  const images = Array.isArray(optionSorter?.images) ? optionSorter.images : [];
  const restoreOrdinalAssignments = images.length === slots.length
    && slots.every(slot => !(Array.isArray(slot?.imgIds) && slot.imgIds.length))
    && images.every(image => String(image?.id || '').trim());
  const assignedIds = restoreOrdinalAssignments
    ? new Set(images.map(image => String(image.id)))
    : null;
  return {
    ...optionSorter,
    slots: slots.map((slot, index) => ({
      ...slot,
      name: allGenericNames ? labels[index] : slot.name,
      imgIds: restoreOrdinalAssignments ? [String(images[index].id)] : slot.imgIds,
    })),
    ...(restoreOrdinalAssignments ? {
      pool: (Array.isArray(optionSorter.pool) ? optionSorter.pool : [])
        .filter(id => !assignedIds.has(String(id))),
      optionSlotSource: 'db',
      subStep: 'sort',
    } : {}),
  };
}

function normalizeOptionSorterState(saved) {
  const base = defaultOptionSorterState();
  const source = saved && typeof saved === 'object' ? saved : {};
  const images = Array.isArray(source.images)
    ? source.images.map(image => {
      const archiveId = image?.archiveId || image?.localArchive?.archiveId;
      return archiveId
        ? { ...image, imagePersistence: 'local-archive-url' }
        : image;
    })
    : [];
  const imageIds = new Set(images.map(img => img?.id).filter(Boolean));
  const slots = Array.isArray(source.slots) && source.slots.length
    ? source.slots.map((slot, idx) => ({
      id: slot?.id || ('slot_' + (idx + 1)),
      name: String(slot?.name || ((idx + 1) + '번')),
      imgIds: (Array.isArray(slot?.imgIds) ? slot.imgIds : []).filter(id => imageIds.has(id)),
    }))
    : base.slots;
  const assigned = new Set(slots.flatMap(slot => slot.imgIds));
  const pool = Array.isArray(source.pool)
    ? source.pool.filter(id => imageIds.has(id) && !assigned.has(id))
    : [];
  for (const id of imageIds) {
    if (!assigned.has(id) && !pool.includes(id)) pool.push(id);
  }
  const optionResults = Array.isArray(source.optionResults) ? source.optionResults.map(r => ({ ...r, generating: false })) : [];
  const subStepUpdatedAt = Math.max(0, Number(source.subStepUpdatedAt || 0) || 0);
  const hasMappedWork = optionResults.length > 0 || slots.some(slot => slot.imgIds.length > 0);
  const styleSample = source.styleSample && typeof source.styleSample === 'object' && source.styleSample.image
    ? {
      ...source.styleSample,
      id: source.styleSample.id || uid('sample'),
      name: String(source.styleSample.name || '옵션표 샘플'),
      image: source.styleSample.image,
    }
    : null;
  const optionSheetLayoutUserSet = typeof source.optionSheetLayoutUserSet === 'boolean'
    ? source.optionSheetLayoutUserSet
    : false;
  const optionSheetLayoutMode = optionSheetLayoutUserSet
    ? (source.optionSheetLayoutMode === 'rows' ? 'rows' : 'grid')
    : 'auto';
  const normalized = {
    ...base,
    ...source,
    slots,
    pool,
    images,
    previewImageId: imageIds.has(source.previewImageId) ? source.previewImageId : null,
    previewResultId: optionResults.some(r => r?.id === source.previewResultId) ? source.previewResultId : null,
    styleSampleResultId: optionResults.some(r => r?.id === source.styleSampleResultId) ? source.styleSampleResultId : (styleSample?.sourceResultId || null),
    styleSampleLibraryId: typeof source.styleSampleLibraryId === 'string' ? source.styleSampleLibraryId : (styleSample?.libraryId || null),
    styleSample,
    optionColorImageUsage: source.optionColorImageUsage === 'none' ? 'none' : 'use',
    optionGroupShotSelectionMode: source.optionGroupShotSelectionMode === 'custom' ? 'custom' : 'all',
    optionGroupShotSelectedImageIds: Array.isArray(source.optionGroupShotSelectedImageIds)
      ? source.optionGroupShotSelectedImageIds.filter(id => imageIds.has(id))
      : [],
    optionGroupShotTargetCount: 1,
    optionGroupShotPrompt: typeof source.optionGroupShotPrompt === 'string' ? source.optionGroupShotPrompt : '',
    optionGroupShotRunning: false,
    optionGroupShotProgress: Number.isFinite(Number(source.optionGroupShotProgress))
      ? Math.max(0, Math.min(100, Number(source.optionGroupShotProgress)))
      : 0,
    optionGroupShotLastResultId: optionResults.some(result => result?.id === source.optionGroupShotLastResultId)
      ? source.optionGroupShotLastResultId
      : null,
    optionGroupShotLastError: typeof source.optionGroupShotLastError === 'string' ? source.optionGroupShotLastError : '',
    optionImageMode: ['ready', 'raw'].includes(source.optionImageMode) ? source.optionImageMode : base.optionImageMode,
    optionOutputLayout: ['all', 'pairs'].includes(source.optionOutputLayout) ? source.optionOutputLayout : base.optionOutputLayout,
    optionSheetCols: clampOptionSheetCount(source.optionSheetCols, source.optionOutputLayout === 'pairs' ? 2 : base.optionSheetCols),
    optionSheetRows: clampOptionSheetCount(source.optionSheetRows, source.optionOutputLayout === 'pairs' ? 1 : base.optionSheetRows),
    optionSheetLayoutMode,
    optionSheetLayoutUserSet,
    optionSheetRowPattern: typeof source.optionSheetRowPattern === 'string' ? source.optionSheetRowPattern : base.optionSheetRowPattern,
    optionPairOrder: Array.isArray(source.optionPairOrder) ? source.optionPairOrder.filter(key => typeof key === 'string') : [],
    optionSheetPixelMode: source.optionSheetPixelMode === 'custom' ? 'custom' : base.optionSheetPixelMode,
    optionSheetPixelPreset: ['auto', 'custom', '2k', '4k'].includes(source.optionSheetPixelPreset) ? source.optionSheetPixelPreset : (source.optionSheetPixelMode === 'custom' ? 'custom' : base.optionSheetPixelPreset),
    optionSheetWidth: clampOptionSheetPixels(source.optionSheetWidth, base.optionSheetWidth),
    optionSheetHeight: clampOptionSheetPixels(source.optionSheetHeight, base.optionSheetHeight),
    optionSheetMethod: ['ai_sheet', 'locked_canvas'].includes(source.optionSheetMethod) ? source.optionSheetMethod : base.optionSheetMethod,
    optionContentMode: ['full_image', 'mixed', 'text_only'].includes(source.optionContentMode) ? source.optionContentMode : base.optionContentMode,
    optionArchiveEnabled: !!source.optionArchiveEnabled,
    optionArchiveFolderName: typeof source.optionArchiveFolderName === 'string' ? source.optionArchiveFolderName : '',
    optionArchiveStatus: typeof source.optionArchiveStatus === 'string' ? source.optionArchiveStatus : '',
    optionArchiveLastSavedAt: typeof source.optionArchiveLastSavedAt === 'string' ? source.optionArchiveLastSavedAt : '',
    optionArchiveSavedCount: Number.isFinite(Number(source.optionArchiveSavedCount)) ? Number(source.optionArchiveSavedCount) : 0,
    optionTonePresetId: typeof source.optionTonePresetId === 'string' ? source.optionTonePresetId : '',
    optionTone: typeof source.optionTone === 'string' && source.optionTone.trim() ? source.optionTone : base.optionTone,
    optionExtraPrompt: typeof source.optionExtraPrompt === 'string' ? source.optionExtraPrompt : '',
    optionGenRunning: false,
    optionGenProgress: Number.isFinite(source.optionGenProgress) ? source.optionGenProgress : 0,
    optionColorHintBusy: false,
    optionVisionColorBusy: false,
    optionAutoColorNameStatus: typeof source.optionAutoColorNameStatus === 'string' ? source.optionAutoColorNameStatus : '',
    optionGenLogs: Array.isArray(source.optionGenLogs) ? source.optionGenLogs : [],
    optionResults,
    optionLastGeneratedResultIds: Array.isArray(source.optionLastGeneratedResultIds)
      ? source.optionLastGeneratedResultIds.filter(id => optionResults.some(result => result?.id === id))
      : [],
    subStepUpdatedAt,
    subStep: source.subStep === 'sort' || (!subStepUpdatedAt && hasMappedWork) ? 'sort' : 'input',
  };
  optSyncSlotCountToImages(normalized);
  return normalized;
}

// ════════════════════════════════════════════════════════════════
// DETAIL PAGE FACTORY — conveyor orchestration
// ════════════════════════════════════════════════════════════════
const FACTORY_ARCHIVE_SETTING_ID = 'factoryArchiveDirectory';
const FACTORY_STAGE_DEFS = [
  {
    id: 'db',
    no: 0,
    label: '제품/DB',
    shortLabel: 'DB',
    icon: 'database_search',
    desc: '제품 사진과 이름으로 이미지 판독, 신화사/Cafe24 후보, 경쟁사 최소 3개를 확보합니다.',
    apiKeys: ['api-hub', 'gpt-oauth', 'gemini', 'sinhwa-db', 'cafe24-control', 'competitor-monitor'],
  },
  {
    id: 'hero',
    no: 1,
    label: '대표이미지',
    shortLabel: '대표',
    icon: 'image',
    desc: '차분한 대표 이미지, 모던한 대표 이미지, 고급스러운 대표 이미지를 후보로 생성합니다.',
    apiKeys: ['detail-automation', 'gpt-oauth', 'gemini', 'openai'],
  },
  {
    id: 'size',
    no: 2,
    label: '사이즈이미지',
    shortLabel: '사이즈',
    icon: 'straighten',
    desc: '확정 DB의 실제 가로/세로/무게/재질만 사용합니다. 값이 없으면 수동 입력 대기로 멈춥니다.',
    apiKeys: ['detail-automation', 'gpt-oauth', 'gemini', 'openai', 'sinhwa-db', 'cafe24-control'],
  },
  {
    id: 'options',
    no: 3,
    label: '색상옵션',
    shortLabel: '옵션',
    icon: 'view_module',
    desc: '기존 옵션 분류기 하네스의 오와열, 픽셀, 샘플, 연속성, 색상충돌 규칙을 그대로 호출합니다.',
    apiKeys: ['gpt-oauth', 'gemini', 'openai', 'sinhwa-db'],
  },
  {
    id: 'cuts',
    no: 4,
    label: '이미지컷',
    shortLabel: '컷',
    icon: 'auto_awesome',
    desc: '대표이미지나 제품 사진을 입력으로 받아 지정 프롬프트별 이미지컷을 생성합니다.',
    apiKeys: ['detail-automation', 'gpt-oauth', 'gemini', 'openai'],
  },
  {
    id: 'detail',
    no: 5,
    label: '상세페이지',
    shortLabel: '상세',
    icon: 'article',
    desc: 'DB 기준, 경쟁사 기준, 혼합 기준 중 선택하고 사용 체크된 이미지를 섹션에 고정 삽입합니다.',
    apiKeys: ['detail-automation', 'gpt-oauth', 'gemini', 'openai', 'competitor-monitor'],
  },
  {
    id: 'export',
    no: 6,
    label: '저장/내보내기',
    shortLabel: '저장',
    icon: 'archive',
    desc: 'D드라이브 선택 폴더 아래 세션 폴더에 이미지, 프롬프트, DB, source-map 기록을 저장합니다.',
    apiKeys: ['google-drive', 'detail-automation'],
  },
];

const FACTORY_HERO_PRESETS = [
  { id: 'calm', label: '차분한 대표 이미지', prompt: '차분하고 정돈된 대표 상품 이미지. 밝은 회백색 스튜디오 배경, 제품 전체가 보이는 중앙 정렬, 넉넉한 여백, 얕고 부드러운 그림자. 텍스트/카드/프레임 없이 쇼핑몰 메인 이미지처럼 안정적인 구도.' },
  { id: 'modern', label: '모던한 대표 이미지', prompt: '모던한 대표 상품 이미지. 제품을 3/4 각도로 더 크게 배치하고, 무광 스톤 또는 아크릴 받침 위에 올린 듯한 선명한 스튜디오 장면. 좌우 중 한쪽에 비대칭 여백, 깨끗한 조명, 텍스트/카드/프레임 금지.' },
  { id: 'premium', label: '고급스러운 대표 이미지', prompt: '고급스러운 대표 상품 이미지. 어두운 차콜 또는 깊은 중성 배경에 은은한 스포트라이트와 반사감, 제품 소재감이 살아나는 프리미엄 카탈로그 분위기. 제품 원형과 색상은 바꾸지 말고 장면의 조명과 배경만 고급스럽게 차별화.' },
];

const FACTORY_CUT_PRESETS = [
  { id: 'detail', label: '디테일 컷', prompt: '제품의 소재와 디테일이 보이는 근접 이미지컷. 원본 제품 형태와 색상은 유지.' },
  { id: 'lifestyle', label: '사용 장면 컷', prompt: '실제 사용 상황을 상상할 수 있는 자연스러운 이미지컷. 제품이 주인공이고 배경은 보조.' },
  { id: 'clean', label: '정갈한 컷', prompt: '상세페이지 중간에 넣기 좋은 정갈한 제품 컷. 배경은 깨끗하고 정보 전달을 방해하지 않음.' },
];

const FACTORY_DB_PRESET_STORAGE_KEY = 'factory_db_field_presets';
const FACTORY_DB_FIELD_DEFS = [
  { id: 'product_name', label: '상품명', required: true, aliases: ['상품명','제품명','product_name','productName','product_nm','productNameKor','mall_product_name','상품명(관리용)','한국어쇼핑몰상품명'] },
  { id: 'cafe24_product_no', label: 'Cafe24 상품번호', required: false, aliases: ['Cafe24상품번호','카페24상품번호','product_no','productNo','cafe24_product_no'] },
  { id: 'product_code', label: '상품코드', required: true, aliases: ['상품코드','product_code','cafe24_product_code','custom_product_code','code','jcode','품번'] },
  { id: 'option_count', label: '옵션수', required: true, aliases: ['옵션수','색상수','option_count','optionCount','options_count','variant_count','color_count','option_value_count'] },
  { id: 'option_name', label: '옵션명', required: false, aliases: ['옵션명','옵션 그룹명','option_name','optionName','option_names','option_group_name'] },
  { id: 'option_values', label: '옵션 구성', required: true, aliases: ['옵션','옵션값','옵션명','옵션구성','색상옵션','색상','전체색상','color','colors','color_options','options','variants','option_values','optionValue','option_value','product_options','variant_options'] },
  { id: 'size', label: '사이즈', required: true, aliases: ['사이즈','규격','크기','size','dimensions','dimension','spec','specification','가로','세로','높이','폭','너비','width','height','depth','length'] },
  { id: 'sale_price', label: '판매가', required: true, aliases: ['판매가','판매가격','판매금액','price','sale_price','selling_price','sell_price','mall_price'] },
  { id: 'consumer_price', label: '소비자가', required: true, aliases: ['소비자가','정가','시중가','consumer_price','list_price','market_price','retail_price','compare_at_price'] },
  { id: 'manufacturer', label: '제조사', required: true, aliases: ['제조사','제조원','manufacturer','maker','brand','vendor','공급사','supplier'] },
  { id: 'category', label: '카테고리', required: false, aliases: ['카테고리','분류','category','categories','category_name','display_category'] },
  { id: 'product_name_en', label: '영문 상품명', required: false, aliases: ['영문상품명','영문 상품명','english_product_name','product_name_en','productNameEn'] },
  { id: 'admin_product_name', label: '상품명(관리용)', required: false, aliases: ['상품명관리용','상품명(관리용)','admin_product_name','internal_product_name'] },
  { id: 'supplier_product_name', label: '공급사 상품명', required: false, aliases: ['공급사상품명','supplier_product_name','vendor_product_name'] },
  { id: 'model_name', label: '모델명', required: false, aliases: ['모델명','model_name','model'] },
  { id: 'product_status', label: '상품상태', required: false, aliases: ['상품상태','product_status','condition','상품상태값'] },
  { id: 'display_status', label: '진열상태', required: false, aliases: ['진열상태','display_status','display','display_status_text'] },
  { id: 'selling_status', label: '판매상태', required: false, aliases: ['판매상태','selling_status','selling','selling_status_text'] },
  { id: 'summary_description', label: '상품 요약설명', required: false, aliases: ['상품요약설명','summary_description','product_summary','summary'] },
  { id: 'simple_description', label: '상품 간략설명', required: false, aliases: ['상품간략설명','simple_description','brief_description','short_description'] },
  { id: 'additional_description', label: '상품 추가설명', required: false, aliases: ['상품추가설명','additional_description','extra_description'] },
  { id: 'purchase_price', label: '원가/공급가', required: false, aliases: ['원가','공급가','매입가','cost','supply_price','purchase_price','wholesale_price'] },
  { id: 'stock', label: '재고', required: false, aliases: ['재고','재고수량','stock','quantity','qty','inventory','stock_quantity'] },
  { id: 'material', label: '소재', required: false, aliases: ['소재','재질','material','fabric','texture'] },
  { id: 'weight', label: '무게', required: false, aliases: ['무게','중량','weight'] },
  { id: 'brand', label: '브랜드', required: false, aliases: ['브랜드','brand','brand_name'] },
  { id: 'supplier', label: '공급사', required: false, aliases: ['공급사','거래처','supplier','vendor','vendor_name'] },
  { id: 'origin', label: '원산지', required: false, aliases: ['원산지','origin','made_in','country_of_origin'] },
  { id: 'tax_type', label: '과세 구분', required: false, aliases: ['과세구분','tax_type','taxation'] },
  { id: 'purchase_limit', label: '구매제한', required: false, aliases: ['구매제한','purchase_limit','purchase_restriction'] },
  { id: 'single_purchase', label: '단독구매 설정', required: false, aliases: ['단독구매','단독구매설정','single_purchase','individual_purchase'] },
  { id: 'purchase_unit', label: '구매 주문단위', required: false, aliases: ['구매주문단위','구매단위','purchase_unit','order_unit'] },
  { id: 'min_order_quantity', label: '최소 주문수량', required: false, aliases: ['최소주문수량','min_order_quantity','minimum_quantity','min_quantity'] },
  { id: 'max_order_quantity', label: '최대 주문수량', required: false, aliases: ['최대주문수량','max_order_quantity','maximum_quantity','max_quantity'] },
  { id: 'points', label: '적립금', required: false, aliases: ['적립금','points','mileage','reward_points'] },
  { id: 'discount_benefits', label: '할인혜택', required: false, aliases: ['할인혜택','discount_benefits','discounts','benefits'] },
  { id: 'search_keywords', label: '검색 키워드', required: false, aliases: ['검색키워드','키워드','search_keywords','keywords','tags','product_tag'] },
  { id: 'shipping_fee_type', label: '배송비 설정', required: false, aliases: ['배송비','배송비설정','shipping_fee_type','shipping_type'] },
  { id: 'mall_product_name_ko', label: '한국어 쇼핑몰 상품명', required: false, aliases: ['한국어쇼핑몰상품명','mall_product_name_ko','product_name_ko','product_name'] },
  { id: 'product_subtitle', label: '상품 부제목', required: false, aliases: ['상품부제목','subtitle','sub_title','product_subtitle'] },
  { id: 'hscode', label: 'HS 코드', required: false, aliases: ['hscode','hs_code','HS코드'] },
  { id: 'classification_code', label: '자체 분류코드', required: false, aliases: ['classification_code','category_code','분류코드'] },
  { id: 'adult_certification', label: '성인인증', required: false, aliases: ['adult_certification','adult_only','성인인증','성인상품'] },
  { id: 'display_group', label: '진열 영역', required: false, aliases: ['display_group','main_display','display_group_code','진열영역'] },
  { id: 'main_image', label: '대표 이미지', required: false, aliases: ['main_image','detail_image','list_image','small_image','tiny_image','대표이미지','상품이미지'] },
  { id: 'additional_images', label: '추가 이미지', required: false, aliases: ['additional_images','images','product_images','추가이미지'] },
  { id: 'detail_html_pc', label: 'PC 상세설명 HTML', required: false, aliases: ['detail_html_pc','detail_description','description','pc_description','PC상세설명'] },
  { id: 'detail_html_mobile', label: '모바일 상세설명 HTML', required: false, aliases: ['detail_html_mobile','mobile_description','mobile_detail','모바일상세설명'] },
  { id: 'seo_title', label: 'SEO 제목', required: false, aliases: ['seo_title','meta_title','검색엔진제목'] },
  { id: 'seo_description', label: 'SEO 설명', required: false, aliases: ['seo_description','meta_description','검색엔진설명'] },
  { id: 'seo_keywords', label: 'SEO 키워드', required: false, aliases: ['seo_keywords','meta_keywords','검색엔진키워드'] },
  { id: 'option_enabled', label: '옵션 사용', required: false, aliases: ['option_enabled','has_option','use_option','옵션사용'] },
  { id: 'option_required', label: '옵션 필수 여부', required: false, aliases: ['option_required','required_option','옵션필수'] },
  { id: 'option_display_type', label: '옵션 표시방식', required: false, aliases: ['option_display_type','option_type','옵션표시방식'] },
  { id: 'option_price', label: '옵션 추가금액', required: false, aliases: ['option_price','variant_price','additional_price','옵션추가금액'] },
  { id: 'variant_stock', label: '품목별 재고', required: false, aliases: ['variant_stock','variant_quantity','item_stock','품목별재고'] },
  { id: 'inventory_tracking', label: '재고관리 사용', required: false, aliases: ['inventory_tracking','use_inventory','stock_tracking','재고관리'] },
  { id: 'safety_stock', label: '안전재고', required: false, aliases: ['safety_stock','safe_stock','안전재고'] },
  { id: 'stock_display', label: '재고표시', required: false, aliases: ['stock_display','display_stock','재고표시'] },
  { id: 'price_excluding_tax', label: '공급가/세전가', required: false, aliases: ['price_excluding_tax','tax_excluded_price','세전가'] },
  { id: 'price_by_shop', label: '쇼핑몰별 판매가', required: false, aliases: ['price_by_shop','multi_shop_price','shop_prices','쇼핑몰별판매가'] },
  { id: 'currency', label: '통화', required: false, aliases: ['currency','currency_code','통화'] },
  { id: 'exchange_rate', label: '환율', required: false, aliases: ['exchange_rate','exchange','환율'] },
  { id: 'payment_info', label: '결제 안내', required: false, aliases: ['payment_info','payment_guide','결제안내'] },
  { id: 'shipping_method', label: '배송방법', required: false, aliases: ['shipping_method','delivery_method','배송방법'] },
  { id: 'shipping_area', label: '배송지역', required: false, aliases: ['shipping_area','delivery_area','배송지역'] },
  { id: 'shipping_period', label: '배송기간', required: false, aliases: ['shipping_period','delivery_period','배송기간'] },
  { id: 'shipping_fee', label: '배송비', required: false, aliases: ['shipping_fee','delivery_fee','배송비'] },
  { id: 'shipping_weight', label: '배송 무게', required: false, aliases: ['shipping_weight','shipping_weight_g','delivery_weight','배송무게'] },
  { id: 'shipping_package', label: '포장 정보', required: false, aliases: ['shipping_package','package_info','packaging','포장정보'] },
  { id: 'return_exchange_info', label: '교환/반품 안내', required: false, aliases: ['return_exchange_info','exchange_info','return_info','교환반품안내'] },
  { id: 'refund_info', label: '환불 안내', required: false, aliases: ['refund_info','환불안내'] },
  { id: 'service_info', label: '서비스 문의 안내', required: false, aliases: ['service_info','as_info','customer_service','서비스문의'] },
  { id: 'product_notice', label: '상품 고시정보', required: false, aliases: ['product_notice','notice_info','detail_notice','상품고시정보'] },
  { id: 'certification', label: '인증/KC 정보', required: false, aliases: ['certification','kc_certification','safety_certification','인증정보','KC정보'] },
  { id: 'icon_setting', label: '아이콘 설정', required: false, aliases: ['icon_setting','icon','product_icon','아이콘설정'] },
  { id: 'promotion_label', label: '프로모션 문구', required: false, aliases: ['promotion_label','promotion_text','프로모션문구'] },
  { id: 'memo', label: '관리 메모', required: false, aliases: ['memo','admin_memo','internal_memo','관리메모'] },
];

