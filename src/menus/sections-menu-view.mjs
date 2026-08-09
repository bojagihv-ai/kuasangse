import { renderSectionCards } from './sections-menu-cards-view.mjs';

export function renderSectionsView(view, helpers) {
  const {
    ensureCurrentProductAnalysisForGeneration,
    ensureSectionWorkScopeCurrent,
    syncFixedSectionPlacementImages,
    hasCurrentProductAnalysisForGeneration,
    productAnalysisGenerationBlockReason,
    orderedSections,
    displayableImageSrc,
    getSectionBasisModeInfo,
    getSectionGenerationModeInfo,
    renderBrandStudioPanel,
    renderFixedDetailImagePanel,
    renderFactoryLightImage,
    renderAnalysisLog,
    renderImageDirectivesPanel,
    renderCompetitorTipBankSummary,
    renderSectionAssemblySummaryPanel,
    renderSectionBatchRunPanel,
    getSectionAssembly,
    sectionAssemblyCutUsageInfo,
    getSectionInstructionSourceInfo,
    getSectionResultSourceInfo,
    sectionBasisDisplayInfo,
    getSectionBasisDetail,
    sectionAssemblySourceSummary,
    sectionBasisOptionLabel,
    renderSectionCompactPromptPreview,
    renderSectionCompetitorPlanNotice,
    renderSectionGeneratedImagePreview,
    renderSectionImageHelper,
    renderSectionBasisChooser,
    renderSectionBasisPromptCompare,
    renderSectionAssemblyPanel,
    renderSectionModeChooser,
    disabledAttr,
    escAttr,
    escapeHtml,
    SECTION_BASIS_MODES,
    SECTION_GENERATION_MODES,
  } = helpers;
  if (typeof ensureSectionWorkScopeCurrent === 'function') ensureSectionWorkScopeCurrent({ save: false });
  if (typeof ensureCurrentProductAnalysisForGeneration === 'function') ensureCurrentProductAnalysisForGeneration({ save: false });
  const a = view.analysis;
  const canGenerateSections = typeof hasCurrentProductAnalysisForGeneration === 'function'
    ? hasCurrentProductAnalysisForGeneration()
    : !!view.analysis;
  const generateBlockReason = typeof productAnalysisGenerationBlockReason === 'function'
    ? productAnalysisGenerationBlockReason()
    : '먼저 제품 이미지를 업로드하고 AI 분석을 완료해주세요.';
  const hiddenSectionCount = (view.hiddenSectionIds || []).length;
  const visibleSectionCount = orderedSections().length;
  const analysisPreviewImage = displayableImageSrc(view.imagePreview);
  if (!view.sectionBatchSelection || typeof view.sectionBatchSelection !== 'object') view.sectionBatchSelection = {};
  const missingBatchSections = orderedSections().filter(s => !view.sectionLocks?.[s.id] && !view.sectionContents?.[s.id]);
  const selectedBatchSections = missingBatchSections.filter(s => view.sectionBatchSelection?.[s.id]);
  const batchBasisMode = (view.sectionBatchBasisMode === 'keep' || SECTION_BASIS_MODES.some(m => m.id === view.sectionBatchBasisMode))
    ? view.sectionBatchBasisMode
    : 'keep';
  const batchGenerationMode = (view.sectionBatchGenerationMode === 'keep' || SECTION_GENERATION_MODES.some(m => m.id === view.sectionBatchGenerationMode))
    ? view.sectionBatchGenerationMode
    : 'keep';
  const batchBasisLabel = batchBasisMode === 'keep' ? '섹션별 기존 기준 유지' : getSectionBasisModeInfo(batchBasisMode).label;
  const batchGenerationLabel = batchGenerationMode === 'keep' ? '섹션별 기존 방식 유지' : getSectionGenerationModeInfo(batchGenerationMode).label;
  const sectionBatchPreview = {
    basisMode: batchBasisMode,
    basisLabel: batchBasisLabel,
    generationMode: batchGenerationMode,
    generationLabel: batchGenerationLabel,
  };
  const batchOverridesIndividualSettings = batchBasisMode !== 'keep' || batchGenerationMode !== 'keep';
  const sectionBatchRunning = view.sectionBatchRun?.status === 'running';
  return `<div class="fade-in">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
      <div>
        <h1 class="page-title">섹션별 설정</h1>
        <p class="page-desc">각 섹션에 원하는 지시사항을 입력하세요. 비워두면 AI가 자동으로 최적의 콘텐츠를 생성합니다.</p>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-sm" type="button" data-factory-open-local-archive-folder="section_header" data-factory-local-archive-scope="category">
          <span class="material-icons-outlined" style="font-size:16px">folder_open</span>섹션 이미지 폴더
        </button>
        <span class="factory-small" data-factory-local-archive-folder-status="section_header" aria-live="polite"></span>
        <button class="btn-primary" id="generateAll" ${disabledAttr(!canGenerateSections, generateBlockReason)}>
          <span class="material-icons-outlined" style="font-size:20px">rocket_launch</span>
          전체 생성 시작
        </button>
      </div>
    </div>

    ${renderBrandStudioPanel()}
    ${renderFixedDetailImagePanel()}

    ${a ? `<div class="analysis-box">
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        ${analysisPreviewImage ? renderFactoryLightImage(analysisPreviewImage, '분석 기준 이미지', 'style="width:80px;height:80px;object-fit:cover;border-radius:10px;border:1px solid var(--border)"') : ''}
        <div style="flex:1;min-width:200px">
          <h3 style="font-size:18px;font-weight:700">${escapeHtml(a.product_name || '분석된 제품')}</h3>
          <p style="font-size:13px;color:var(--text-d);margin-top:4px">${escapeHtml(a.category || '')} ${a.mood ? `| ${escapeHtml(a.mood)}` : ''}</p>
          <div style="margin-top:8px">${(a.key_features||[]).slice(0,5).map(f=>`<span class="tag">${escapeHtml(f)}</span>`).join('')}</div>
        </div>
      </div>
      ${view.competitorData ? `<div style="margin-top:16px;padding:12px 16px;background:var(--bg);border-radius:8px;font-size:13px">
        <span style="color:var(--text-m)">경쟁 분석:</span>
        <span style="color:var(--cyan)">${view.competitorData.similar_products?.length||0}개 유사 제품 분석됨</span>
        ${view.competitorData.recommended_approach ? `<br><span style="color:var(--text-d);margin-top:4px;display:block">${escapeHtml(view.competitorData.recommended_approach)}</span>` : ''}
      </div>` : ''}
    </div>` : ''}

    ${renderAnalysisLog()}

    ${!a ? `<div class="app-notice warn" style="margin-bottom:16px">
      <span class="material-icons-outlined">info</span>
      <span style="flex:1">아직 제품 이미지 분석 전입니다. 섹션 순서, 생성 방식, 기준, 지시사항은 먼저 잡아둘 수 있고, 이미지 분석이 완료되면 분석 자료가 이 화면에 자동으로 붙습니다.</span>
      <button class="btn-sm" data-route-target="upload" style="white-space:nowrap">이미지 업로드</button>
    </div>` : ''}

    <!-- 이미지 생성 지시사항 패널 -->
    ${renderImageDirectivesPanel()}
    ${renderCompetitorTipBankSummary()}
    ${renderSectionAssemblySummaryPanel()}

    <div class="drive-status-strip">
      <span class="drive-status-dot ${view.auto.driveConnected ? 'ok' : 'warn'}"></span>
      <strong>Drive 자동 저장</strong>
      <span>${view.auto.driveConnected ? 'Google Drive 연결됨' : '아직 Drive 미연결'}</span>
      <span>·</span>
      <span>${view.sectionDriveFolderId ? '저장 폴더 지정됨' : '저장 폴더 미지정'}</span>
      ${!view.auto.driveConnected ? '<span style="color:var(--warn)">아래 설정에서 Drive 연결을 누르면 생성 이미지를 자동 업로드할 수 있습니다.</span>' : ''}
    </div>

    <!-- Drive 저장 (접힘 처리) -->
    <details style="margin-bottom:16px">
      <summary style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;list-style:none;user-select:none">
        <span class="material-icons-outlined" style="font-size:16px;color:#4285f4">cloud_upload</span>
        Drive 자동 저장
        ${view.auto.driveConnected ? `<span style="font-size:11px;color:var(--ok);margin-left:auto">● 연결됨</span>` : `<span style="font-size:11px;color:var(--text-m);margin-left:auto">● 미연결</span>`}
        <span class="material-icons-outlined" style="font-size:16px;color:var(--text-m)">expand_more</span>
      </summary>
      <div style="padding:12px 14px;background:var(--bg-card);border:1px solid var(--border);border-top:none;border-radius:0 0 10px 10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <input type="text" id="sectionDriveFolderInput" value="${escAttr(view.sectionDriveFolderId || '')}" placeholder="폴더 ID 또는 URL 붙여넣기" style="flex:1;min-width:180px;padding:5px 10px;font-size:12px;font-family:monospace;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text)">
        <button class="btn-sm" id="saveSectionDriveFolder" style="flex-shrink:0">저장</button>
        ${view.auto.driveConnected
          ? `<button class="btn-sm" id="uploadAllSectionImages" style="flex-shrink:0;background:var(--accent,#b56d3a);color:#fff;border-color:transparent">전체 업로드</button>`
          : `<button class="btn-sm" id="driveConnectFromSections" style="flex-shrink:0">Drive 연결</button>`
        }
        ${view.sectionDriveFolderId ? `<span style="font-size:11px;color:var(--text-m);flex-shrink:0">이미지 생성 시 자동 업로드</span>` : ''}
      </div>
    </details>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 14px;padding:12px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px">
      <div style="font-size:12px;color:var(--text-m)">
        현재 상세페이지 섹션 <b style="color:var(--text)">${visibleSectionCount}개</b>${hiddenSectionCount ? ` · 숨김 ${hiddenSectionCount}개` : ''} · 순서는 드래그로 바꿀 수 있습니다.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-sm" id="addCustomSectionBtn"><span class="material-icons-outlined" style="font-size:14px">add</span>이미지 섹션 추가</button>
        ${hiddenSectionCount ? `<button class="btn-sm" id="restoreHiddenSectionsBtn"><span class="material-icons-outlined" style="font-size:14px">visibility</span>숨긴 섹션 복원</button>` : ''}
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px;margin:0 0 14px;padding:12px 14px;background:rgba(99,102,241,.065);border:1px solid rgba(99,102,241,.24);border-radius:12px">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="min-width:220px;flex:1 1 220px">
        <div style="font-size:13px;font-weight:950;color:var(--text);display:flex;align-items:center;gap:6px">
          <span class="material-icons-outlined" style="font-size:16px;color:var(--primary-h)">playlist_add_check</span>
          미생성 섹션 선택 일괄생성
        </div>
        <div style="font-size:12px;color:var(--text-m);line-height:1.5;margin-top:3px">
          미생성 ${missingBatchSections.length}개 · 선택 ${selectedBatchSections.length}개
        </div>
        <div style="font-size:11px;color:var(--text-d);line-height:1.5;margin-top:2px">
          생성 기준: <b style="color:var(--text)">${escapeHtml(batchBasisLabel)}</b> · 생성 방식: <b style="color:var(--text)">${escapeHtml(batchGenerationLabel)}</b> · <b style="color:var(--cyan)">동시 생성 최대 2장</b>
        </div>
      </div>
        <div style="display:flex;align-items:flex-end;justify-content:flex-end;gap:8px;flex-wrap:wrap;flex:2 1 560px">
        <label style="display:flex;flex-direction:column;gap:4px;min-width:170px;flex:1 1 190px;max-width:240px">
          <span style="font-size:11px;color:var(--text-m);font-weight:800">일괄 생성 기준</span>
          <select id="sectionBatchBasisMode" class="input" style="min-height:34px;padding:6px 10px;font-size:12px">
            <option value="keep" ${batchBasisMode === 'keep' ? 'selected' : ''}>섹션별 기존 기준 유지</option>
            ${SECTION_BASIS_MODES.map(m => `<option value="${escAttr(m.id)}" ${batchBasisMode === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;min-width:170px;flex:1 1 190px;max-width:240px">
          <span style="font-size:11px;color:var(--text-m);font-weight:800">일괄 생성 방식</span>
          <select id="sectionBatchGenerationMode" class="input" style="min-height:34px;padding:6px 10px;font-size:12px">
            <option value="keep" ${batchGenerationMode === 'keep' ? 'selected' : ''}>섹션별 기존 방식 유지</option>
            ${SECTION_GENERATION_MODES.map(m => `<option value="${escAttr(m.id)}" ${batchGenerationMode === m.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}
          </select>
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end">
          <button class="btn-sm" id="selectMissingSectionsForBatch" ${disabledAttr(!missingBatchSections.length, '생성할 미생성 섹션이 없습니다.')}>미생성 전체 선택</button>
          <button class="btn-sm" id="clearMissingSectionBatchSelection" ${disabledAttr(!selectedBatchSections.length, '선택된 섹션이 없습니다.')}>선택 해제</button>
          <button class="btn-sm" id="generateAllMissingSections" aria-label="남은 ${missingBatchSections.length}개 · ${escAttr(batchBasisLabel)} · ${escAttr(batchGenerationLabel)}" ${disabledAttr(sectionBatchRunning || !missingBatchSections.length || !canGenerateSections, sectionBatchRunning ? '섹션 일괄 생성이 이미 진행 중입니다.' : (!canGenerateSections ? generateBlockReason : '생성할 미생성 섹션이 없습니다.'))} style="background:rgba(34,197,94,.16);border-color:rgba(34,197,94,.45);color:var(--ok);font-weight:900">남은 ${missingBatchSections.length}개 전체 생성</button>
          <button class="btn-sm" id="generateSelectedMissingSections" ${disabledAttr(sectionBatchRunning || !selectedBatchSections.length || !canGenerateSections, sectionBatchRunning ? '섹션 일괄 생성이 이미 진행 중입니다.' : (!canGenerateSections ? generateBlockReason : '체크한 미생성 섹션이 없습니다.'))} style="background:var(--primary);border-color:var(--primary);color:#fff;font-weight:900">선택한 섹션 생성</button>
        </div>
      </div>
      </div>
      <div class="section-batch-plan"
        data-section-batch-plan
        data-batch-basis="${escAttr(batchBasisMode)}"
        data-batch-generation="${escAttr(batchGenerationMode)}">
        <span class="material-icons-outlined">playlist_play</span>
        <div>
          <span>실행 예정 · 남은 ${missingBatchSections.length}개</span>
          <strong>${escapeHtml(batchBasisLabel)} · ${escapeHtml(batchGenerationLabel)} · 동시 생성 최대 2장</strong>
          <small>${batchOverridesIndividualSettings
            ? '위 버튼을 누르면 각 대상 카드의 개별 설정보다 이 일괄 설정을 우선 적용합니다.'
            : '각 대상 카드에 표시된 개별 설정을 그대로 사용합니다.'}</small>
        </div>
      </div>
      ${renderSectionBatchRunPanel()}
    </div>

    ${renderSectionCards({ ...view, sectionBatchPreview }, helpers)}

    <div style="text-align:center;margin-top:32px">
      <button class="btn-primary" id="generateAll2" style="padding:16px 48px;font-size:16px" ${disabledAttr(!canGenerateSections, generateBlockReason)}>
        <span class="material-icons-outlined" style="font-size:22px">rocket_launch</span>
        ${visibleSectionCount}개 섹션 일괄 생성 시작
      </button>
    </div>
  </div>`;
}
