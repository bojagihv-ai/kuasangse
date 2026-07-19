export function renderSectionCards(view, helpers) {
  const {
    orderedSections,
    getSectionGenerationModeInfo,
    sectionBasisDisplayInfo,
    getSectionBasisModeInfo,
    getSectionAssembly,
    sectionAssemblyCutUsageInfo,
    getSectionInstructionSourceInfo,
    getSectionResultSourceInfo,
    getSectionBasisDetail,
    sectionAssemblySourceSummary,
    renderSectionCompactPromptPreview,
    renderSectionCompetitorPlanNotice,
    renderSectionGeneratedImagePreview,
    renderSectionImageHelper,
    renderSectionBasisChooser,
    renderSectionBasisPromptCompare,
    renderSectionAssemblyPanel,
    renderSectionModeChooser,
    productAnalysisGenerationBlockReason,
    sectionBasisOptionLabel,
    disabledAttr,
    escAttr,
    escapeHtml,
    SECTION_BASIS_MODES,
    SECTION_GENERATION_MODES,
  } = helpers;
  return `
    <div class="section-grid" id="sectionSortable">
      ${orderedSections().map(s => {
        const driveStatus = view.sectionDriveUploadStatus[s.id];
        const isLoading = view.sectionGenerating[s.id] === 'loading';
        const isError = view.sectionGenerating[s.id] === 'error';
        const isDone = view.sectionGenerating[s.id] === 'done' || !!view.sectionContents[s.id];
        const modeInfo = getSectionGenerationModeInfo(s.id);
        const basisInfo = typeof sectionBasisDisplayInfo === 'function' ? sectionBasisDisplayInfo(s.id) : getSectionBasisModeInfo(s.id);
        const assembly = getSectionAssembly(s.id);
        const assemblyUsage = sectionAssemblyCutUsageInfo(assembly.cutUsage);
        const instructionSource = getSectionInstructionSourceInfo(s.id);
        const resultSource = getSectionResultSourceInfo(s.id);
        const isBatchGeneratable = !view.sectionLocks?.[s.id] && !view.sectionContents?.[s.id];
        const isBatchSelected = !!view.sectionBatchSelection?.[s.id] && isBatchGeneratable;
        return `
        <div class="section-card" data-section-toggle="${s.id}" data-section-id="${s.id}">
          <div class="head">
            <span class="drag-handle" title="드래그하여 순서 변경">⠿</span>
            <div class="section-identity">
              <span class="icon">${s.icon}</span>
              <div class="info">
                <h4>${s.n}. ${s.name}</h4>
                <p>${s.desc}</p>
              </div>
            </div>
            <label class="section-source-pill section-batch-select"  title="${isBatchGeneratable ? '미생성 섹션 일괄생성 대상으로 선택합니다.' : (view.sectionLocks?.[s.id] ? '잠금 섹션은 선택 일괄생성에서 제외됩니다.' : '이미 생성된 섹션입니다.')}">
              <input type="checkbox" data-section-batch="${s.id}" ${isBatchSelected ? 'checked' : ''} ${!isBatchGeneratable ? 'disabled' : ''} style="accent-color:var(--primary);margin:0">
              선택
            </label>
            <div class="meta-row">
              <span class="section-source-pill" title="${escAttr(instructionSource.detail || '')}"><span class="material-icons-outlined" style="font-size:13px">info</span> 지시 출처: <strong>${escapeHtml(instructionSource.label)}</strong></span>
              <span class="section-source-pill" title="${escAttr(getSectionBasisDetail(s.id))}"><span class="material-icons-outlined" style="font-size:13px">rule</span> 생성 기준: <strong>${escapeHtml(basisInfo.shortLabel)}</strong></span>
              <span class="section-source-pill" title="섹션 조립판에서 선택한 소스와 이미지컷 사용 방식입니다."><span class="material-icons-outlined" style="font-size:13px">extension</span> 조립: <strong>${escapeHtml(sectionAssemblySourceSummary(s.id))} · ${escapeHtml(assemblyUsage.shortLabel)}</strong></span>
              <span class="section-source-pill" title="${escAttr(resultSource.detail || '')}"><span class="material-icons-outlined" style="font-size:13px">history</span> 결과: <strong>${escapeHtml(resultSource.label)}</strong></span>
              <span class="section-source-pill" title="이미지 생성 시 원본 상품의 형태, 비율, 장식, 색상 배치를 우선 보존합니다."><span class="material-icons-outlined" style="font-size:13px">verified</span> 원본 보존: <strong>우선</strong></span>
            </div>
            ${view.activeSectionEdit===s.id ? '' : `${renderSectionCompactPromptPreview(s.id)}${renderSectionCompetitorPlanNotice(s.id)}`}
            <div class="actions">
              <span class="status-chip ${isLoading ? 'busy' : (!isError && isDone) ? 'ok' : ''}" ${isError ? 'style="color:var(--err);border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08)"' : ''}>
                ${isLoading ? '<span class="spinner" style="width:13px;height:13px;border-width:2px"></span> 생성 중' : isError ? '<span class="material-icons-outlined" style="font-size:14px">error</span> 실패' : isDone ? '<span class="material-icons-outlined" style="font-size:14px">check_circle</span> 생성됨' : '대기'}
              </span>
              ${driveStatus==='uploading' ? `<span class="status-chip busy"><span class="material-icons-outlined" style="font-size:14px;animation:spin .8s linear infinite">sync</span> Drive 업로드</span>`
                : driveStatus==='done' ? `<span class="status-chip ok"><span class="material-icons-outlined" style="font-size:14px">cloud_done</span> Drive 완료</span>`
                : driveStatus==='error' ? `<span class="status-chip" style="color:var(--err);border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08)"><span class="material-icons-outlined" style="font-size:14px">cloud_off</span> Drive 실패</span>`
                : ''
              }
              <span class="section-mode-label"><span class="material-icons-outlined" style="font-size:14px">rule</span>기준</span>
              <select class="section-basis-select" data-section-basis="${s.id}" title="${escAttr(getSectionBasisDetail(s.id))}" >
                ${SECTION_BASIS_MODES.map(m => `<option value="${m.id}" ${basisInfo.id === m.id ? 'selected' : ''}>${escapeHtml(typeof sectionBasisOptionLabel === 'function' ? sectionBasisOptionLabel(m, s.id) : m.label)}</option>`).join('')}
              </select>
              <span class="section-mode-label"><span class="material-icons-outlined" style="font-size:14px">tune</span>방식</span>
              <select class="section-mode-select" data-section-mode="${s.id}" title="${escAttr(modeInfo.desc)}" >
                ${SECTION_GENERATION_MODES.map(m => `<option value="${m.id}" ${modeInfo.id === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
              </select>
              ${(() => {
                const reason = typeof productAnalysisGenerationBlockReason === 'function'
                  ? productAnalysisGenerationBlockReason(s.id)
                  : (view.sectionLocks[s.id] ? '잠금 해제 후 생성할 수 있습니다.' : '먼저 제품 이미지를 AI 분석해주세요.');
                const blocked = !!reason || isLoading;
                const blockTitle = isLoading ? `${s.name} 재생성이 진행 중입니다.` : reason;
                return `<button class="btn-sm" ${blocked ? disabledAttr(true, blockTitle) : 'title="이 섹션만 생성"'} data-generate-section="${s.id}" style="background:var(--primary);color:#fff;border-color:transparent;font-weight:800;min-width:88px;${blocked ? 'opacity:.58;cursor:not-allowed;' : 'cursor:pointer;'}">
                ${isLoading ? '<span class="spinner" style="width:13px;height:13px;border-width:2px"></span>생성 중' : `<span class="material-icons-outlined" style="font-size:15px">${isError ? 'refresh' : 'play_arrow'}</span>${isError ? '다시 시도' : isDone ? '다시 생성' : '생성'}`}
              </button>`;
              })()}
              <button class="btn-sm" data-lock-section="${s.id}"  style="${view.sectionLocks[s.id] ? 'border-color:rgba(245,158,11,.7);color:var(--warn);background:rgba(245,158,11,.12)' : ''}">
                <span class="material-icons-outlined" style="font-size:14px">${view.sectionLocks[s.id] ? 'lock' : 'lock_open'}</span>
                ${view.sectionLocks[s.id] ? '잠금 해제' : '잠금'}
              </button>
              <button class="btn-sm" data-hide-section="${s.id}"  title="이 섹션을 현재 상세페이지 구성에서 숨깁니다">
                <span class="material-icons-outlined" style="font-size:14px">remove</span>섹션
              </button>
              <span class="material-icons-outlined" style="color:var(--text-m);font-size:20px">${view.activeSectionEdit===s.id?'expand_less':'expand_more'}</span>
            </div>
          </div>
          ${renderSectionGeneratedImagePreview(s.id)}
          ${renderSectionImageHelper(s.id)}
          ${view.activeSectionEdit===s.id ? `<div class="edit-row" >
            <div style="font-size:12px;color:var(--text-m);line-height:1.6;margin-bottom:8px">
              현재 생성 기준: <b style="color:var(--text)">${escapeHtml(basisInfo.label)}</b> · ${escapeHtml(getSectionBasisDetail(s.id))}<br>
              현재 생성 방식: <b style="color:var(--text)">${escapeHtml(modeInfo.label)}</b> · ${escapeHtml(modeInfo.desc)}
            </div>
            ${renderSectionBasisChooser(s.id)}
            ${renderSectionBasisPromptCompare(s.id)}
            ${renderSectionAssemblyPanel(s.id)}
            ${renderSectionModeChooser(s.id)}
            <textarea class="textarea" data-section-input="${s.id}" rows="3" placeholder="이 섹션에 원하는 내용을 입력하세요...\n예: ${s.purpose}">${view.sectionInstructions[s.id]||''}</textarea>
          </div>` : ''}
          ${view.sectionInstructions[s.id] && view.activeSectionEdit!==s.id ? `<div class="custom-badge">✎ ${escapeHtml(instructionSource.label)} 지시사항 적용됨</div>` : ''}
        </div>
      `; }).join('')}
    </div>
  `;
}
