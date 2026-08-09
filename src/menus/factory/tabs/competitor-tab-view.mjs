import { renderCompetitorAnalysisSummary } from './competitor-tab-analysis.mjs';
import {
  renderCandidateSourceSwitcher,
  renderCandidateTargetControls,
  renderCompetitorCandidatePicker,
} from './competitor-tab-candidates.mjs';
import { renderScrapedImagePicker } from './competitor-tab-images.mjs';
import { candidateSource, createCompetitorTabView } from './competitor-tab-model.mjs';

export function renderCompetitorFactoryTab(snapshot, helpers) {
  const model = createCompetitorTabView(snapshot);
  const { factory, market, counts, tasks } = model;
  const auto = factory.automation || {};
  const showFullPanel = Boolean(auto.competitorPanelOpen);
  const fullPanel = showFullPanel
    ? helpers.renderCompMarketScrapePanel(model.snapshot, market, { includePreviewModal: false })
    : '';
  const vmFallback = market.vmFallback?.active === true ? market.vmFallback : null;
  const sourceLabel = vmFallback
    ? '보조수집'
    : candidateSource(market.candidateView || market.collectMode) === 'local' ? '본컴' : 'VM';
  const loading = Boolean(market.loading);
  const loadingReason = loading ? 'VM 후보 수집 또는 상세수집이 진행 중입니다.' : '';
  const imagePicker = renderScrapedImagePicker(model, helpers, true);
  const fallbackWarning = vmFallback
    ? `<div data-factory-vm-fallback-warning class="factory-guide-note warn" style="margin-top:10px;border:1px solid rgba(245,158,11,.58);background:rgba(245,158,11,.10);padding:11px;border-radius:9px;overflow-wrap:anywhere">
        <div style="font-size:12px;font-weight:950;color:var(--warn)">VM 후보수집을 끝까지 시도한 뒤 최후 보조수집으로 전환했습니다.</div>
        <div style="font-size:11px;margin-top:5px;color:var(--text)">사유: ${helpers.escapeHtml(vmFallback.reason || 'VM 후보 0건')}</div>
        <div style="font-size:11px;margin-top:3px;color:var(--text-m)">출처: ${helpers.escapeHtml(vmFallback.source || '오픈마켓 Chrome 보조수집')} · 현재 카드는 VM 결과가 아니라 보조수집 결과입니다.</div>
      </div>`
    : '';
  return `<div data-factory-competitor-tab style="min-width:0;max-width:100%;overflow-wrap:anywhere">
    <div class="factory-automation-grid" style="min-width:0;max-width:100%">
      <div class="factory-automation-panel" style="min-width:0;max-width:100%;overflow-wrap:anywhere">
        <div style="min-width:0;overflow-wrap:anywhere"><h4 style="margin:0">4. 경쟁사</h4><p style="margin:6px 0 0;overflow-wrap:anywhere">후보를 수집할 실행 환경을 먼저 선택하세요. 선택한 경로만 실행하며 다른 경로로 자동 전환하지 않습니다.</p></div>
        <div data-comp-market-collection-choice style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:8px;margin-top:10px;min-width:0">
          <button class="btn-sm" type="button" data-factory-guide-action="rerun-vm-competitors" ${helpers.disabledAttr(loading, loadingReason)} style="min-height:44px;background:${market.collectMode === 'vm' ? 'var(--primary)' : 'var(--bg-input)'};border-color:var(--primary);color:${market.collectMode === 'vm' ? '#fff' : 'var(--text)'};font-weight:950">${loading && market.collectMode === 'vm' ? 'VM에서 수집 중...' : 'VM에서 수집'}</button>
          <button class="btn-sm" type="button" data-factory-guide-action="rerun-local-competitors" ${helpers.disabledAttr(loading, loadingReason)} style="min-height:44px;background:${market.collectMode === 'local' ? 'var(--primary)' : 'var(--bg-input)'};border-color:var(--primary);color:${market.collectMode === 'local' ? '#fff' : 'var(--text)'};font-weight:950">${loading && market.collectMode === 'local' ? 'Windows Chrome에서 수집 중...' : '내 Windows Chrome에서 수집'}</button>
        </div>
        ${helpers.renderFactoryAutomationVmSearchInfo(factory, 'info', market)}
        ${fallbackWarning}
        ${renderCandidateTargetControls(model, helpers)}
        ${renderCandidateSourceSwitcher(model)}
        ${helpers.renderFactoryAutomationTaskChecklist(tasks, 'competitor')}
      </div>
      <div class="factory-automation-panel" id="factoryCompetitorStatusPanel" style="min-width:0;max-width:100%;overflow-wrap:anywhere">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;min-width:0"><h4 style="margin:0">현재 상태</h4><span style="font-size:11px;color:var(--text-m)">위에서 수집 경로를 선택하세요.</span></div>
        <div class="factory-automation-status-grid" style="min-width:0">
          ${helpers.renderFactoryAutomationStatusCard(`${sourceLabel} 후보`, `${counts.competitorCandidates || counts.competitors}건`, `${sourceLabel} 검색 결과 후보입니다.`, (counts.competitorCandidates || counts.competitors) > 0)}
          ${helpers.renderFactoryAutomationStatusCard('선택 후보', `${counts.selectedCompetitors}건`, '상세페이지 수집 대상입니다.', counts.selectedCompetitors > 0)}
          ${helpers.renderFactoryAutomationStatusCard('상세 이미지', `${counts.scrapedImages}장`, '분석 이미지 목록에 표시됩니다.', counts.scrapedImages > 0)}
          ${helpers.renderFactoryAutomationStatusCard('분석 선택', `${counts.selectedAnalysisImages}장`, '선택 이미지 분석 버튼으로 넘깁니다.', counts.selectedAnalysisImages > 0 || counts.competitorAnalysisReady)}
        </div>
      </div>
    </div>
    ${renderCompetitorAnalysisSummary(model, helpers)}
    ${renderCompetitorCandidatePicker(model, helpers, imagePicker)}
    <div id="factoryCompetitorVmPanel" class="factory-automation-panel" style="margin-top:12px;border-color:rgba(99,102,241,.24);background:rgba(99,102,241,.035);min-width:0;max-width:100%;overflow-wrap:anywhere">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;min-width:0"><div style="min-width:0"><h4 style="margin:0">전체 경쟁사 수집판</h4><p style="margin:5px 0 0;overflow-wrap:anywhere">${showFullPanel ? '전체 수집판을 펼쳤습니다. 화면이 무거우면 접어두고 위 선택판을 사용하세요.' : '렉을 줄이기 위해 기본은 접어둡니다. 후보 수집, 선택, VM 상세수집은 위 선택판에서 바로 할 수 있습니다.'}</p></div><div class="factory-automation-actions" style="margin:0;min-width:0;flex-wrap:wrap"><button class="btn-sm" type="button" data-factory-guide-action="toggle-competitor-panel">${showFullPanel ? '전체 수집판 접기' : '전체 수집판 펼치기'}</button><button class="btn-sm" type="button" data-factory-guide-action="open-competitor">경쟁사 메뉴로 열기</button></div></div>
      ${showFullPanel ? `<div style="margin-top:12px;min-width:0;max-width:100%;overflow-wrap:anywhere">${fullPanel}</div>` : ''}
    </div>
  </div>`;
}
