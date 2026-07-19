export const COMPETITOR_MARKET_SITES = Object.freeze([
  Object.freeze({ id: 'coupang', label: '쿠팡' }),
  Object.freeze({ id: 'naver', label: '스마트스토어' }),
  Object.freeze({ id: 'gmarket', label: 'G마켓' }),
  Object.freeze({ id: 'auction', label: '옥션' }),
  Object.freeze({ id: 'elevenst', label: '11번가' }),
]);

const DEFAULT_MARKET_TARGET = 4;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rows(value) {
  return Array.isArray(value) ? value : [];
}

function stableKey(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function candidateSource(value) {
  return String(value || '').toLowerCase() === 'local' ? 'local' : 'vm';
}

export function candidateId(item, index = 0) {
  const source = record(item);
  const direct = source.id || source.product_id || source.productId || source.product_no
    || source.no || source.url || source.product_url || source.link;
  if (direct) return String(direct);
  const fingerprint = [
    source.platform || source.site || source.mall,
    source.title || source.name || source.product_name,
    source.price || source.sale_price || source.price_text,
    source.thumbnail_url || source.thumbnail || source.image_url || source.imageUrl || source.main_image,
  ].map(value => String(value || '').trim()).filter(Boolean).join('|');
  return fingerprint ? `market_${stableKey(fingerprint)}` : `market_${index}`;
}

export function scrapedImageId(image, index = 0) {
  const source = record(image);
  const sourceId = String(source.id || source.key || '').trim();
  const owner = String(source.candidateId || source.productUrl || source.product_url
    || source.detailUrl || source.detail_url || source.sourcePath || source.src || source.url || '').trim();
  const captureIndex = Number.isFinite(Number(source.captureIndex)) ? Number(source.captureIndex) : '';
  if (sourceId && owner) return `detail:${sourceId}:${owner}:${captureIndex}`;
  const fallback = sourceId || source.src || source.url || source.sourcePath;
  return String(fallback || `detail_image_${index}`);
}

export function marketSiteLabel(value) {
  const normalized = String(value || '').toLowerCase();
  const site = COMPETITOR_MARKET_SITES.find(item => item.id === normalized || normalized.includes(item.id));
  if (site) return site.label;
  if (normalized.includes('smart') || normalized.includes('naver')) return '스마트스토어';
  if (normalized.includes('11')) return '11번가';
  return String(value || '기타');
}

export function targetForSite(market, siteId) {
  const numeric = Number(record(market).marketTargets?.[siteId]);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(20, Math.round(numeric))) : DEFAULT_MARKET_TARGET;
}

export function sourceCandidates(market, source) {
  const data = record(market);
  const selectedSource = candidateSource(source);
  const storedRows = data[`${selectedSource}Results`];
  if (Array.isArray(storedRows)) return storedRows;
  return data.collectMode === selectedSource ? rows(data.results) : [];
}

function activeCandidateRows(market) {
  const data = record(market);
  const active = candidateSource(data.candidateView || data.collectMode);
  const direct = sourceCandidates(data, active);
  const grouped = record(data[`${active}GroupedResults`] || data.groupedResults);
  const output = [];
  const seen = new Set();
  const append = (item, siteId, index) => {
    if (!item || typeof item !== 'object') return;
    const normalized = siteId && !item.platform && !item.site && !item.mall
      ? { ...item, platform: siteId }
      : item;
    const key = candidateId(normalized, index);
    if (seen.has(key)) return;
    seen.add(key);
    output.push(normalized);
  };
  direct.forEach((item, index) => append(item, '', index));
  for (const [siteId, items] of Object.entries(grouped)) {
    rows(items).forEach((item, index) => append(item, siteId, index));
  }
  return Object.freeze(output);
}

function detailImageGroups(market) {
  const data = record(market);
  const seen = new Set();
  const images = rows(data.scrapedImages).filter((image, index) => {
    const key = scrapedImageId(image, index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const operation = record(data.detailOperation);
  if (!operation.id) {
    return Object.freeze({ operation: null, currentImages: Object.freeze([]), previousImages: Object.freeze(images) });
  }
  const operationId = String(operation.id);
  const currentImages = images.filter(image => String(image?.detailOperationId || '') === operationId);
  const previousImages = images.filter(image => String(image?.detailOperationId || '') !== operationId);
  return Object.freeze({ operation, currentImages: Object.freeze(currentImages), previousImages: Object.freeze(previousImages) });
}

function currentAnalysisMatches(competitors, compPage, market, analysisResult) {
  const explicit = competitors.analysisMatchesSelection ?? compPage.analysisMatchesSelection
    ?? market.analysisMatchesSelection;
  if (typeof explicit === 'boolean') return explicit;
  const currentKey = market.selectedImageSignature?.key || compPage.analysisImageSelection?.key || '';
  if (!currentKey) return true;
  return String(analysisResult?.compMarketImageSelection?.key || '') === String(currentKey);
}

export function createCompetitorTabView(snapshot) {
  const source = record(snapshot);
  const factory = record(source.factory);
  const competitors = record(source.competitors);
  const compPage = record(competitors.compPage || source.compPage || competitors);
  const market = record(compPage.marketScrape || competitors.marketScrape || competitors.market);
  const candidates = activeCandidateRows(market);
  const detailImages = detailImageGroups(market);
  const analysisResult = record(compPage.analysisResult || competitors.analysisResult);
  const selectedIds = rows(market.selectedIds);
  const selectedImageIds = rows(market.selectedImageIds);
  const suppliedCounts = record(factory.automationCounts || factory.automation?.counts || competitors.counts);
  const counts = Object.freeze({
    competitorCandidates: Number(suppliedCounts.competitorCandidates ?? candidates.length),
    competitors: Number(suppliedCounts.competitors ?? candidates.length),
    selectedCompetitors: Number(suppliedCounts.selectedCompetitors ?? selectedIds.length),
    scrapedImages: Number(suppliedCounts.scrapedImages ?? rows(market.scrapedImages).length),
    selectedAnalysisImages: Number(suppliedCounts.selectedAnalysisImages ?? selectedImageIds.length),
    competitorAnalysisReady: Boolean(suppliedCounts.competitorAnalysisReady ?? Object.keys(analysisResult).length),
  });
  const tasks = rows(factory.automation?.tasks || factory.tasks || competitors.tasks);
  return Object.freeze({
    snapshot: source,
    factory,
    competitors,
    compPage,
    market,
    candidates,
    detailImages,
    analysisResult: Object.keys(analysisResult).length ? analysisResult : null,
    analysisMatchesSelection: currentAnalysisMatches(competitors, compPage, market, analysisResult),
    counts,
    tasks: Object.freeze(tasks.slice()),
  });
}
