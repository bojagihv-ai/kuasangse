import {
  COMPETITOR_MARKET_SITES,
  candidateId,
  candidateSource,
  marketSiteLabel,
  sourceCandidates,
  targetForSite,
} from './competitor-tab-model.mjs';

export function renderCandidateTargetControls(model, helpers) {
  const { market } = model;
  const { escapeHtml, escAttr } = helpers;
  const totalTarget = Math.max(1, Math.min(100, Number(market.totalTarget || 20) || 20));
  const marketTotal = COMPETITOR_MARKET_SITES.reduce((sum, site) => sum + targetForSite(market, site.id), 0);
  const message = marketTotal === totalTarget
    ? `시장별 합계 ${marketTotal}건이 총 목표와 일치합니다.`
    : `시장별 합계 ${marketTotal}건과 총 목표 ${totalTarget}건이 다릅니다. 각 목표는 마켓별 달성 기준으로 따로 적용됩니다.`;
  return `<div data-factory-candidate-target-controls style="margin-top:12px;border:1px solid rgba(99,102,241,.35);border-radius:10px;background:rgba(99,102,241,.06);padding:10px;min-width:0;overflow-wrap:anywhere">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px;min-width:0">
      <div style="font-size:12px;font-weight:950;color:var(--text)">후보 달성 목표</div>
      <div style="font-size:11px;color:${marketTotal === totalTarget ? 'var(--ok)' : 'var(--warn)'};overflow-wrap:anywhere">${escapeHtml(message)}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(118px,100%),1fr));gap:8px;min-width:0">
      <label style="display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-m);font-weight:800;min-width:0">총 목표
        <input type="number" min="1" max="100" value="${escAttr(totalTarget)}" data-factory-comp-market-total-target aria-label="총 후보 목표" style="width:100%;box-sizing:border-box;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:7px;color:var(--text);font-weight:900;min-width:0">
      </label>
      ${COMPETITOR_MARKET_SITES.map(site => `<label style="display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-m);font-weight:800;min-width:0">${escapeHtml(site.label)}
        <input type="number" min="1" max="20" value="${escAttr(targetForSite(market, site.id))}" data-factory-comp-market-target="${escAttr(site.id)}" aria-label="${escAttr(site.label)} 후보 목표" style="width:100%;box-sizing:border-box;padding:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:7px;color:var(--text);font-weight:900;min-width:0">
      </label>`).join('')}
    </div>
    <div style="font-size:10px;color:var(--text-m);margin-top:7px;overflow-wrap:anywhere">수집은 이 목표를 달성할 때까지 진행하고, 못 채운 마켓은 부족 건수와 원인을 표시합니다.</div>
  </div>`;
}

export function renderCandidateSourceSwitcher(model) {
  const { market } = model;
  const vmCount = sourceCandidates(market, 'vm').length;
  const localCount = sourceCandidates(market, 'local').length;
  const active = candidateSource(market.candidateView || market.collectMode);
  const button = (source, label, count) => `<button class="btn-sm" type="button" data-comp-market-source-view="${source}" style="${active === source ? 'background:var(--primary);border-color:var(--primary);color:#fff' : ''}">${label} 후보 보기 · ${count}건</button>`;
  return `<div data-comp-market-source-switcher style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px;min-width:0;overflow-wrap:anywhere">
    <span style="font-size:11px;color:var(--text-m);font-weight:900">후보 보기</span>
    ${button('vm', 'VM', vmCount)}
    ${button('local', '본컴', localCount)}
    <span style="font-size:10px;color:var(--text-m)">현재 ${active === 'vm' ? 'VM 후보' : '본컴 후보'} 표시</span>
  </div>`;
}

function candidateScore(item) {
  const values = [item?.view_count, item?.views, item?.review_count, item?.likes,
    item?.wish_count, item?.sold_count, item?.sales_count, item?.purchase_count,
    item?.similarity_score, item?.score, item?.match_score, item?.local_score];
  const found = values.map(Number).find(Number.isFinite);
  return found ?? 0;
}

function renderCandidateCard(item, index, selectedIds, helpers) {
  const { escapeHtml, escAttr } = helpers;
  const id = candidateId(item, index);
  const selected = selectedIds.has(id);
  const thumbnail = item?.thumbnail_url || item?.thumbnail || item?.image_url || item?.imageUrl || item?.main_image || '';
  const title = item?.title || item?.name || item?.product_name || '제목 없음';
  const platform = item?.platform || item?.site || item?.mall || '';
  const price = item?.price || item?.sale_price || item?.price_text || '';
  const score = candidateScore(item);
  const tier = item?.match_tier || item?.tier || item?.rank_label || '';
  const url = item?.product_url || item?.url || item?.link || item?.detail_url || '';
  const runtime = String(item?._search_runtime || item?.search_runtime || item?.capture_runtime || '').toLowerCase();
  const assisted = Boolean(item?._assisted_fallback_for_vm || item?.assistedFallbackForVm || runtime.includes('assisted'));
  const runtimeLabel = String(item?.sourceLabel || item?.source_label || '').trim()
    || (assisted ? '보조수집' : runtime === 'vm' ? 'VM 결과' : runtime === 'local' ? '본컴 결과' : '');
  return `<div class="comp-market-result-card" style="border:1px solid ${selected ? 'rgba(16,185,129,.72)' : 'var(--border)'};border-radius:10px;background:${selected ? 'rgba(16,185,129,.09)' : 'var(--bg)'};padding:10px;display:grid;grid-template-columns:minmax(56px,72px) minmax(0,1fr);gap:10px;min-width:0;max-width:100%;overflow-wrap:anywhere;box-shadow:${selected ? '0 0 0 2px rgba(16,185,129,.12)' : 'none'}">
    <div style="inline-size:100%;aspect-ratio:1;border-radius:8px;background:#080a12;border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center;min-width:0">
      ${thumbnail ? `<img src="${escAttr(thumbnail)}" alt="${escAttr(title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">` : '<span class="material-icons-outlined" style="font-size:24px;color:var(--text-m)">image_not_supported</span>'}
    </div>
    <div style="min-width:0;overflow-wrap:anywhere">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:5px;min-width:0">
        ${selected ? '<span class="comp-tag" style="font-size:10px;background:rgba(16,185,129,.18);border-color:rgba(16,185,129,.5);color:var(--ok)">상세페이지 수집 대상</span>' : ''}
        <span class="comp-tag comp-tag-primary" style="font-size:10px">${escapeHtml(marketSiteLabel(platform))}</span>
        ${runtimeLabel ? `<span class="comp-tag" style="font-size:10px;color:${assisted ? 'var(--warn)' : 'var(--text-m)'}">${escapeHtml(runtimeLabel)}</span>` : ''}
        ${score ? `<span class="comp-tag" style="font-size:10px">점수 ${escapeHtml(String(Math.round(score * 10) / 10))}</span>` : ''}
        ${tier ? `<span class="comp-tag" style="font-size:10px">${escapeHtml(tier)}</span>` : ''}
      </div>
      <div title="${escAttr(title)}" style="font-size:12px;font-weight:900;color:var(--text);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(title)}</div>
      ${price ? `<div style="font-size:11px;color:var(--warn);font-weight:800;margin-top:4px;overflow-wrap:anywhere">${escapeHtml(String(price))}</div>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;min-width:0">
        ${url ? `<button class="btn-sm" data-comp-market-use-url-id="${escAttr(id)}" type="button" style="font-size:11px;padding:5px 7px">URL 입력</button>` : ''}
        ${url ? `<a class="btn-sm" href="${escAttr(url)}" target="_blank" rel="noopener" style="font-size:11px;padding:5px 7px;text-decoration:none;overflow-wrap:anywhere"><span class="material-icons-outlined" style="font-size:13px">open_in_new</span>원본 확인</a>` : ''}
        <button class="btn-sm" data-comp-market-toggle-result="${escAttr(id)}" type="button" style="font-size:12px;padding:7px 10px;background:${selected ? 'rgba(16,185,129,.18)' : 'var(--primary)'};border-color:${selected ? 'rgba(16,185,129,.55)' : 'var(--primary)'};color:${selected ? 'var(--ok)' : '#fff'};font-weight:900">${selected ? '선택됨 - 해제' : '이 후보 선택'}</button>
      </div>
    </div>
  </div>`;
}

export function renderCompetitorCandidatePicker(model, helpers, imagePickerHtml) {
  const { candidates, market, factory } = model;
  const { disabledAttr, escapeHtml, renderFactoryAutomationVmSearchInfo } = helpers;
  const selectedIds = new Set(Array.isArray(market.selectedIds) ? market.selectedIds.map(String) : []);
  const selectedCount = selectedIds.size;
  const imageCount = Array.isArray(market.scrapedImages) ? market.scrapedImages.length : 0;
  const loadingReason = market.loading ? 'JepumScraper 작업이 진행 중입니다.' : '';
  if (!candidates.length) {
    return `<div class="factory-automation-panel" id="factoryCompetitorPickerPanel" style="margin-top:12px;border-color:rgba(245,158,11,.44);background:rgba(245,158,11,.045);min-width:0;max-width:100%;overflow-wrap:anywhere">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;min-width:0">
        <div style="min-width:0;overflow-wrap:anywhere"><h4 style="margin:0">경쟁사 후보 선택</h4><p style="margin:5px 0 0;overflow-wrap:anywhere">아직 위 단계창에 표시할 후보가 없습니다. VM 또는 본컴 수집을 실행한 뒤, search_id가 남아 있으면 다시 읽을 수 있습니다.</p></div>
        <div class="factory-automation-actions" style="margin:0;min-width:0;flex-wrap:wrap">
          <button class="btn-sm" type="button" data-factory-guide-action="rerun-vm-competitors" ${disabledAttr(Boolean(market.loading), loadingReason)} style="background:var(--primary);border-color:var(--primary);color:#fff">VM 후보 수집</button>
          <button class="btn-sm" type="button" data-factory-guide-action="rerun-local-competitors" ${disabledAttr(Boolean(market.loading), loadingReason)}>본컴 후보 수집</button>
          <button class="btn-sm" type="button" data-comp-market-quick-action="reload" ${disabledAttr(Boolean(market.loading), loadingReason)}>${market.searchId ? '후보 다시 읽기' : '최근 VM 후보 불러오기'}</button>
        </div>
      </div>
      ${renderFactoryAutomationVmSearchInfo(factory, 'warn', market)}
      <div class="factory-guide-note warn" style="margin-top:10px;overflow-wrap:anywhere">${imageCount ? `후보 카드는 0건이지만 이미 수집된 상세페이지 이미지 ${imageCount}장은 아래에서 분석 선택할 수 있습니다.` : '후보가 0건이면 선택할 카드가 없습니다. 먼저 VM 후보 수집을 실행하거나 아래 수집판의 검색어/사이트 설정을 확인해주세요.'}</div>
      ${imagePickerHtml}
    </div>`;
  }
  const activeLabel = candidateSource(market.candidateView || market.collectMode) === 'local' ? '본컴' : 'VM';
  const previewLimit = Math.min(40, Math.max(12, Number(market.topN || 3) * 5));
  const previewRows = candidates.slice(0, previewLimit);
  const summary = Object.entries(candidates.reduce((result, item) => {
    const site = String(item?.platform || item?.site || item?.mall || 'etc').toLowerCase();
    result[site] = (result[site] || 0) + 1;
    return result;
  }, {})).map(([site, count]) => `${marketSiteLabel(site)} ${count}건`).join(' · ');
  const detailReason = market.loading ? '작업 진행 중입니다.' : selectedCount ? '' : '상세페이지를 수집할 후보를 먼저 선택하세요.';
  return `<div class="factory-automation-panel" id="factoryCompetitorPickerPanel" style="margin-top:12px;border-color:rgba(16,185,129,.45);background:rgba(16,185,129,.035);min-width:0;max-width:100%;overflow-wrap:anywhere">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;min-width:0">
      <div style="min-width:0"><h4 style="margin:0">경쟁사 후보 선택</h4><p style="margin:5px 0 0;overflow-wrap:anywhere">${activeLabel} 후보 ${candidates.length}건 중 상세페이지를 수집할 상품을 선택하세요. 선택하면 아래 버튼에서 VM 또는 본컴 상세수집 방식을 고를 수 있습니다.</p></div>
      <div class="factory-automation-actions" style="margin:0;min-width:0;flex-wrap:wrap">
        <button class="btn-sm" type="button" data-factory-guide-action="rerun-vm-competitors" ${disabledAttr(Boolean(market.loading), loadingReason)}>${market.loading ? '재수집 중' : 'VM 후보 다시 수집'}</button>
        <button class="btn-sm" type="button" data-comp-market-quick-action="select-all" ${disabledAttr(Boolean(market.loading), loadingReason)}>후보 전체 선택</button>
        <button class="btn-sm" type="button" data-comp-market-quick-action="clear-selection" ${disabledAttr(Boolean(market.loading || !selectedCount), market.loading ? loadingReason : '선택된 후보가 없습니다.')}>선택 해제</button>
        <button class="btn-sm" type="button" data-comp-market-quick-action="detail-vm" ${disabledAttr(Boolean(detailReason), detailReason)} style="background:var(--primary);border-color:var(--primary);color:#fff">선택 ${selectedCount}건 VM 상세수집</button>
        <button class="btn-sm" type="button" data-comp-market-quick-action="detail-local" ${disabledAttr(Boolean(detailReason), detailReason)}>선택 ${selectedCount}건 본컴 상세수집</button>
        <button class="btn-sm" type="button" data-comp-market-quick-action="analyze-vm" ${disabledAttr(Boolean(detailReason), detailReason)}>VM 수집 후 분석</button>
      </div>
    </div>
    ${renderFactoryAutomationVmSearchInfo(factory, 'info', market)}
    <div class="factory-small" style="margin-bottom:8px;overflow-wrap:anywhere">후보 ${candidates.length}건 · 선택 ${selectedCount}건 · 상세 이미지 ${imageCount}장${summary ? ` · ${escapeHtml(summary)}` : ''}${candidates.length > previewRows.length ? ` · 아래 ${previewRows.length}건 우선 표시 / 전체 수집판에 ${candidates.length - previewRows.length}건 더 있음` : ''}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:10px;min-width:0;max-width:100%">${previewRows.map((item, index) => renderCandidateCard(item, index, selectedIds, helpers)).join('')}</div>
    ${imagePickerHtml}
  </div>`;
}
