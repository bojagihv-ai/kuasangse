export function renderCompetitorAnalysisSummary(model, helpers) {
  const result = model.analysisResult;
  if (!result || !model.analysisMatchesSelection) return '';
  const pageTitle = result.page_title || result.title || '경쟁사 상세페이지';
  const score = result.page_score?.total ?? result.score ?? '';
  const grade = result.page_score?.grade || '';
  const verdict = result.page_score?.verdict || result.overall_strategy || '';
  const sectionCount = Array.isArray(result.sections_found)
    ? result.sections_found.length
    : Number(result.total_sections_count || 0);
  const analyzedAt = result.analyzedAt
    ? new Date(result.analyzedAt).toLocaleString('ko-KR')
    : '';
  const { escapeHtml, renderFactoryAutomationStatusCard } = helpers;
  return `<div class="factory-automation-panel" style="margin-top:12px;border-color:rgba(34,197,94,.45);background:rgba(16,185,129,.055);min-width:0;overflow-wrap:anywhere">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;min-width:0">
      <div style="min-width:0;overflow-wrap:anywhere">
        <h4 style="margin:0;color:var(--ok)">경쟁사 분석 결과 확보</h4>
        <p style="margin:5px 0 0;overflow-wrap:anywhere">${escapeHtml(pageTitle)}</p>
      </div>
      <div class="factory-automation-actions" style="margin:0;min-width:0;flex-wrap:wrap">
        <button class="btn-primary" type="button" data-factory-guide-action="open-competitor-report">경쟁사 리포트 열기</button>
        <button class="btn-sm" type="button" data-factory-guide-action="go-tab:sections">섹션 생성으로 이동</button>
      </div>
    </div>
    <div class="factory-automation-status-grid" style="margin-top:10px;min-width:0">
      ${renderFactoryAutomationStatusCard('분석 점수', score !== '' ? `${score}${grade ? ` · ${grade}` : ''}` : '확인됨', verdict || '경쟁사 이미지 분석 결과가 저장됐습니다.', true)}
      ${renderFactoryAutomationStatusCard('감지 섹션', `${sectionCount}개`, '상세페이지 구성 요소를 섹션 생성 기준으로 활용합니다.', sectionCount > 0)}
      ${renderFactoryAutomationStatusCard('분석 시각', analyzedAt || '저장됨', result.analyzeModel?.modelLabel || result.llm_auth_mode || 'GPT OAuth', true)}
    </div>
  </div>`;
}
