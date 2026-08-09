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
    getSectionPromptResolutionInfo,
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
        ${orderedSections({ includeHidden: true, includeAutoExcluded: true }).map(s => {
          const rec = recs.find(r=>r.section_id===s.id) || {};
          const ed = edits[s.id] || {};
          const enabled = ed.enabled !== undefined ? ed.enabled : (rec.enabled !== false);
          const instructions = ed.instructions !== undefined ? ed.instructions : (rec.recommended_instructions || '');
          const st = genStatus[s.id];
          const doneContent = view.sectionContents[s.id];
          const modeInfo = getSectionGenerationModeInfo(s.id);
          const basisInfo = typeof sectionBasisDisplayInfo === 'function' ? sectionBasisDisplayInfo(s.id) : getSectionBasisModeInfo(s.id);
          const promptInfo = typeof getSectionPromptResolutionInfo === 'function'
            ? getSectionPromptResolutionInfo(s.id)
            : {
                version: 'section-prompt-v2',
                providerVersion: 'section-content-provider-v1',
                providerLabel: '생성 API',
                basisId: basisInfo.id,
                basisLabel: basisInfo.label,
                modeId: modeInfo.id,
                modeLabel: modeInfo.label,
                requestInputs: instructions,
                resolvedPrompt: instructions,
                competitorStatus: '프롬프트 조립 상태를 확인할 수 없습니다.',
                sources: [],
              };
          const generationBlockReason = !enabled
            ? '이 섹션을 활성화해야 개별 생성할 수 있습니다.'
            : (!hasAnalysis
                ? (typeof productAnalysisGenerationBlockReason === 'function'
                    ? productAnalysisGenerationBlockReason(s.id)
                    : '현재 제품 분석이 필요합니다.')
                : '');
          const generationButtonAttrs = `${generationBlockReason ? `data-block-reason="${escAttr(generationBlockReason)}" ` : ''}${disabledAttr(!!generationBlockReason, generationBlockReason)}`;
          const generationButton = st === 'error'
            ? `<button class="btn-sm comp-section-retry" data-comp-gen-section="${s.id}" ${generationButtonAttrs}>재시도</button>`
            : doneContent
              ? `<span class="status-chip ok"><span class="material-icons-outlined" style="font-size:14px">check_circle</span> 완료</span>
                 <button class="btn-sm" data-comp-gen-section="${s.id}" ${generationButtonAttrs}><span class="material-icons-outlined" style="font-size:14px">play_arrow</span>다시 생성</button>`
              : `<button class="btn-sm" data-comp-gen-section="${s.id}" ${generationButtonAttrs}><span class="material-icons-outlined" style="font-size:14px">play_arrow</span>생성</button>`;
          return `<div class="comp-section-card ${enabled?'':'comp-section-disabled'}">
            <div class="comp-plan-head">
              <label class="comp-toggle-wrap">
                <input type="checkbox" class="comp-plan-toggle" data-sid="${s.id}" ${enabled?'checked':''}>
                <span class="comp-toggle-slider"></span>
              </label>
              <span style="font-size:18px">${s.icon||'📄'}</span>
              <div class="comp-plan-title">${s.n}. ${s.name}</div>
              <div class="comp-plan-actions">
                ${st === 'loading'
                  ? `<span class="status-chip busy"><span class="spinner" style="width:13px;height:13px;border-width:2px"></span> 생성 중</span>`
                  : generationButton}
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
            <div class="comp-prompt-contract" data-prompt-pipeline-version="${escAttr(promptInfo.version)}" data-provider-prompt-version="${escAttr(promptInfo.providerVersion)}" data-prompt-basis="${escAttr(promptInfo.basisId)}">
              <div class="comp-prompt-contract-head">
                <div>
                  <span class="material-icons-outlined">account_tree</span>
                  <strong>최종 provider prompt 조립</strong>
                </div>
                <div class="comp-prompt-contract-badges">
                  <span>${escapeHtml(promptInfo.version)}</span>
                  <span>${escapeHtml(promptInfo.providerVersion)}</span>
                  <span>${escapeHtml(promptInfo.providerLabel)}</span>
                  <span>${escapeHtml(promptInfo.basisLabel)}</span>
                  <span>${escapeHtml(promptInfo.modeLabel)}</span>
                </div>
              </div>
              <div class="comp-prompt-source-flow" aria-label="생성 요청 입력 조립 소스">
                ${(promptInfo.sources || []).map(source => `<span class="comp-prompt-source ${source.active ? 'active' : 'inactive'}" data-prompt-source="${escAttr(source.id)}" data-active="${source.active ? 'true' : 'false'}">${escapeHtml(source.label)}</span>`).join('<span class="comp-prompt-plus" aria-hidden="true">+</span>')}
                <span class="comp-prompt-arrow" aria-hidden="true">→</span>
                <strong>${escapeHtml(promptInfo.providerLabel)}</strong>
              </div>
              <div class="comp-prompt-competitor-status">
                <span class="material-icons-outlined">manage_search</span>
                ${escapeHtml(promptInfo.competitorStatus)}
              </div>
              <details class="comp-prompt-resolved">
                <summary>가변 요청 입력 보기</summary>
                <pre>${escapeHtml(promptInfo.requestInputs || '현재 생성에 전달할 가변 요청 입력이 없습니다.')}</pre>
              </details>
              <details class="comp-prompt-resolved">
                <summary>실제 provider 최종 prompt 보기</summary>
                <pre>${escapeHtml(promptInfo.resolvedPrompt || '현재 생성에 전달할 요청 입력이 없습니다.')}</pre>
              </details>
            </div>
            <details class="comp-plan-edit" open>
              <summary><span class="material-icons-outlined" style="font-size:14px">edit_note</span> 경쟁사 섹션 플랜 원문 (편집 가능)</summary>
              <textarea class="comp-plan-input" data-sid="${s.id}" rows="4"
                placeholder="경쟁사 분석에서 이 섹션에 반영할 구조·개선 지시를 입력하세요. 실제 최종 프롬프트는 위 조립 패널에서 확인합니다."
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
