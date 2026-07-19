export function renderCompetitorPlanView(view, helpers) {
  const {
    ensureCurrentProductAnalysisForGeneration,
    hasCurrentProductAnalysisForGeneration,
    orderedSections,
    getSectionGenerationModeInfo,
    sectionBasisDisplayInfo,
    getSectionBasisModeInfo,
    getSectionBasisDetail,
    sectionBasisOptionLabel,
    renderPlanInstructionReadable,
    renderPlanImprovementBridge,
    productAnalysisGenerationBlockReason,
    disabledAttr,
    escAttr,
    escapeHtml,
    SECTION_BASIS_MODES,
    SECTION_GENERATION_MODES,
  } = helpers;
  const cp = view.compPage;
    const plan = cp.sectionPlan || {};
    const recs = plan.recommended_sections || [];
    const edits = cp.planEdits || {};
    if (typeof ensureCurrentProductAnalysisForGeneration === 'function') ensureCurrentProductAnalysisForGeneration({ save: false });
    const hasAnalysis = typeof hasCurrentProductAnalysisForGeneration === 'function'
      ? hasCurrentProductAnalysisForGeneration()
      : !!view.analysis;
    const genStatus = cp.sectionStatus || {}; // {sectionId: 'loading'|'done'|'error'}
    return `<div class="fade-in">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <button class="btn-sm" data-comp-back="report" style="gap:6px"><span class="material-icons-outlined" style="font-size:14px">arrow_back</span>분석 결과로</button>
        <h1 class="page-title" style="margin:0">📐 섹션 플랜</h1>
      </div>
      ${renderCompetitorFlowNav('plan')}
      ${plan.strategy_summary?`<div class="comp-strategy-card">
        <div class="comp-card-title">🎯 전략 요약</div>
        <p class="comp-strategy-text">${escapeHtml(plan.strategy_summary)}</p>
        ${(plan.key_differentiators||[]).length>0?`<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">${plan.key_differentiators.map(d=>`<span class="comp-tag comp-tag-primary">${escapeHtml(d)}</span>`).join('')}</div>`:''}
      </div>`:''}

      <div class="comp-section-list">
        ${orderedSections().map(s => {
          const rec = recs.find(r=>r.section_id===s.id) || {};
          const ed = edits[s.id] || {};
          const enabled = ed.enabled !== undefined ? ed.enabled : (rec.enabled !== false);
          const instructions = ed.instructions !== undefined ? ed.instructions : (rec.recommended_instructions || '');
          const st = genStatus[s.id];
          const doneContent = view.sectionContents[s.id];
          const modeInfo = getSectionGenerationModeInfo(s.id);
          const basisInfo = typeof sectionBasisDisplayInfo === 'function' ? sectionBasisDisplayInfo(s.id) : getSectionBasisModeInfo(s.id);
          return `<div class="comp-section-card ${enabled?'':'comp-section-disabled'}">
            <div class="comp-plan-head">
              <label class="comp-toggle-wrap">
                <input type="checkbox" class="comp-plan-toggle" data-sid="${s.id}" ${enabled?'checked':''}>
                <span class="comp-toggle-slider"></span>
              </label>
              <span style="font-size:18px">${s.icon||'📄'}</span>
              <div class="comp-plan-title">${s.n}. ${s.name}</div>
              <div class="comp-plan-actions">
                ${!hasAnalysis ? '' :
                  st === 'loading'
                    ? `<span class="status-chip busy"><span class="spinner" style="width:13px;height:13px;border-width:2px"></span> 생성 중</span>`
                    : st === 'error'
                      ? `<button class="btn-sm" data-comp-gen-section="${s.id}" style="background:rgba(229,62,62,.15);color:#e53e3e;border-color:#e53e3e">재시도</button>`
                      : doneContent
                        ? `<span class="status-chip ok"><span class="material-icons-outlined" style="font-size:14px">check_circle</span> 완료</span>
                           <button class="btn-sm" data-comp-gen-section="${s.id}"><span class="material-icons-outlined" style="font-size:14px">play_arrow</span>다시 생성</button>`
                        : `<button class="btn-sm" data-comp-gen-section="${s.id}"><span class="material-icons-outlined" style="font-size:14px">play_arrow</span>생성</button>`
                }
                <span class="section-mode-label" title="이 섹션을 만들 때 어떤 지시를 우선 볼지 선택합니다."><span class="material-icons-outlined" style="font-size:14px">rule</span>기준</span>
                <select class="section-basis-select" data-section-basis="${s.id}" title="${escAttr(getSectionBasisDetail(s.id))}" >
                  ${SECTION_BASIS_MODES.map(m => `<option value="${m.id}" ${basisInfo.id === m.id ? 'selected' : ''}>${escapeHtml(typeof sectionBasisOptionLabel === 'function' ? sectionBasisOptionLabel(m, s.id) : m.label)}</option>`).join('')}
                </select>
                <span class="section-mode-label" title="이 섹션의 이미지 생성 방식을 선택합니다."><span class="material-icons-outlined" style="font-size:14px">tune</span>방식</span>
                <select class="section-mode-select" data-section-mode="${s.id}" title="${escAttr(modeInfo.desc)}" >
                  ${SECTION_GENERATION_MODES.map(m => `<option value="${m.id}" ${modeInfo.id === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="section-source-pill" style="margin-bottom:10px" title="${escAttr(modeInfo.desc)}">
              <span class="material-icons-outlined" style="font-size:13px">image</span>
              이미지 생성 방식: <strong>${escapeHtml(modeInfo.label)}</strong>
            </div>
            <div class="section-source-pill" style="margin-bottom:10px" title="${escAttr(getSectionBasisDetail(s.id))}">
              <span class="material-icons-outlined" style="font-size:13px">rule</span>
              생성 기준: <strong>${escapeHtml(basisInfo.label)}</strong>
            </div>
            ${renderPlanInstructionReadable(instructions, enabled)}
            ${renderPlanImprovementBridge(s.id, rec, instructions, enabled)}
            <details class="comp-plan-edit" open>
              <summary><span class="material-icons-outlined" style="font-size:14px">edit_note</span> 위 내용을 반영한 최종 프롬프트 (편집 가능)</summary>
              <textarea class="comp-plan-input" data-sid="${s.id}" rows="4"
                placeholder="경쟁사 분석, 개선사항, 우리 제품 반영 내용을 합친 최종 생성 프롬프트를 입력하세요..."
                style="${!enabled?'opacity:0.4;':''}">${escapeHtml(instructions)}</textarea>
            </details>
          </div>`;
        }).join('')}
      </div>

      <div style="display:flex;gap:12px;position:sticky;bottom:0;background:linear-gradient(180deg,rgba(15,15,19,.82),var(--bg) 28%);padding:16px 0;z-index:2">
        <button class="btn" id="compApplyGenerate" style="flex:1;justify-content:center;font-size:15px"
          ${!hasAnalysis ? disabledAttr(true, typeof productAnalysisGenerationBlockReason === 'function' ? productAnalysisGenerationBlockReason() : '먼저 제품 이미지를 분석해주세요 (AI 분석 탭)') : ''}>
          <span class="material-icons-outlined">rocket_launch</span> 자동 생성 바로 시작
        </button>
        <button class="btn-secondary" id="compApplySections" style="flex:1;justify-content:center;font-size:15px">
          <span class="material-icons-outlined">dashboard_customize</span> 섹션 설정으로 이동
        </button>
      </div>
    </div>`;
}
