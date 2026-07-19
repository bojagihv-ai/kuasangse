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
    ? helpers.renderCompMarketScrapePanel(model.snapshot, market)
    : '';
  const sourceLabel = candidateSource(market.candidateView || market.collectMode) === 'local' ? '본컴' : 'VM';
  const loading = Boolean(market.loading);
  const loadingReason = loading ? 'VM 후보 수집 또는 상세수집이 진행 중입니다.' : '';
  const imagePicker = renderScrapedImagePicker(model, helpers, !showFullPanel);
  return `<div data-factory-competitor-tab style="min-width:0;max-width:100%;overflow-wrap:anywhere">
    <div class="factory-automation-grid" style="min-width:0;max-width:100%">
      <div class="factory-automation-panel" style="min-width:0;max-width:100%;overflow-wrap:anywhere">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;min-width:0">
          <div style="min-width:0;overflow-wrap:anywhere"><h4 style="margin:0">4. 경쟁사</h4><p style="margin:6px 0 0;overflow-wrap:anywhere">후보 수집은 기본 VM입니다. VM이 준비 중이면 본컴 수집으로 바로 후보를 모을 수 있고, 고른 후보는 본컴 또는 VM에서 상세페이지를 읽을 수 있습니다.</p></div>
          <div class="factory-automation-actions" style="margin:0;min-width:0;flex-wrap:wrap">
            <button class="btn-sm" type="button" data-factory-guide-action="rerun-vm-competitors" ${helpers.disabledAttr(loading, loadingReason)} style="background:var(--primary);border-color:var(--primary);color:#fff">${loading ? 'VM 후보 수집 중...' : 'VM 후보 다시 수집'}</button>
            <button class="btn-sm" type="button" data-factory-guide-action="rerun-local-competitors" ${helpers.disabledAttr(loading, loadingReason)}>${loading ? '수집 작업 중...' : '본컴 후보 수집'}</button>
          </div>
        </div>
        ${helpers.renderFactoryAutomationVmSearchInfo(factory, 'info', market)}
        ${renderCandidateTargetControls(model, helpers)}
        ${renderCandidateSourceSwitcher(model)}
        ${helpers.renderFactoryAutomationTaskChecklist(tasks, 'competitor')}
      </div>
      <div class="factory-automation-panel" style="min-width:0;max-width:100%;overflow-wrap:anywhere">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;min-width:0"><h4 style="margin:0">현재 상태</h4><button class="btn-sm" type="button" data-factory-guide-action="rerun-vm-competitors" ${helpers.disabledAttr(loading, loadingReason)}>${loading ? '재수집 중' : '후보 다시 수집'}</button></div>
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
