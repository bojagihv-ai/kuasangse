export function renderImageCutsResultsView(state, helpers) {
  const {
    anyGenerating,
    anyResult,
    c,
    cutBlockReason,
    maxPromptCount,
    promptCount,
    resultCount,
    sizeResultCount,
    totalResultCount,
  } = state;
  const {
    cutGeneratingHelperText,
    cutsVisibleLogText,
    disabledAttr,
    escapeAttr,
    escapeHtml,
    factoryCutPromptPreviewSrc,
    renderCutsRunLogPanel,
    renderDetailSectionPlacementPanel,
    renderFactoryCutPromptPreviewImage,
    renderSizeCutsPanel,
  } = helpers;
  const escAttr = escapeAttr;

  return `${renderCutsRunLogPanel(c)}

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:4px 0 14px">
      <div style="font-size:13px;color:var(--text-m)">
        이미지컷 지시칸 <strong style="color:var(--text);font-size:16px">${promptCount}개</strong>
        <span style="font-size:11px;color:var(--text-m);margin-left:6px">기본 4개 · 최대 ${maxPromptCount}개</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-sm" data-cut-slot-delta="-1" ${disabledAttr(promptCount <= 1 || anyGenerating, anyGenerating ? '생성 중에는 지시칸 수를 바꿀 수 없습니다.' : '최소 1칸은 유지됩니다.')}>
          <span class="material-icons-outlined" style="font-size:16px">remove</span>
          칸 줄이기
        </button>
        <button class="btn-sm" data-cut-slot-delta="1" ${disabledAttr(promptCount >= maxPromptCount || anyGenerating, anyGenerating ? '생성 중에는 지시칸 수를 바꿀 수 없습니다.' : `최대 ${maxPromptCount}칸까지 가능합니다.`)}>
          <span class="material-icons-outlined" style="font-size:16px">add</span>
          칸 추가
        </button>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:12px 14px">
      <div style="min-width:220px">
        <div style="font-size:12px;font-weight:800;color:var(--text)">생성 결과 보관</div>
        <div style="font-size:11px;color:var(--text-m);line-height:1.5">
          현재 결과 ${totalResultCount}장<span style="color:var(--text-d)"> (이미지컷 ${resultCount} · 사이즈컷 ${sizeResultCount})</span> · 로컬 폴더: <strong style="color:var(--text)">${escapeHtml(c.localArchiveFolderName || '아직 선택 안 함')}</strong>
          ${c.localArchiveStatus ? `<br>${escapeHtml(c.localArchiveStatus)}` : ''}
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-sm" type="button" data-factory-open-local-archive-folder="cuts" data-factory-local-archive-scope="category">
          <span class="material-icons-outlined" style="font-size:16px">folder_open</span>
          이미지컷 보관 폴더 열기
        </button>
        <span class="factory-small" data-factory-local-archive-folder-status="cuts" aria-live="polite"></span>
        <button class="btn-sm" type="button" data-factory-open-local-archive-folder="size" data-factory-local-archive-scope="category">
          <span class="material-icons-outlined" style="font-size:16px">folder_open</span>
          사이즈컷 보관 폴더 열기
        </button>
        <span class="factory-small" data-factory-local-archive-folder-status="size" aria-live="polite"></span>
        <button class="btn-sm" id="chooseCutsArchiveFolderBtn">
          <span class="material-icons-outlined" style="font-size:16px">folder_open</span>
          로컬 저장 폴더 선택
        </button>
        <button class="btn-sm" id="saveAllCutsLocalBtn" ${disabledAttr(!totalResultCount || c.localArchiveSaving, c.localArchiveSaving ? '이미 저장 중입니다.' : '저장할 생성 이미지가 없습니다.')}>
          <span class="material-icons-outlined" style="font-size:16px">${c.localArchiveSaving ? 'hourglass_empty' : 'download'}</span>
          생성 이미지 일괄저장
        </button>
        <button class="btn-sm" id="downloadAllCutsBtn" ${disabledAttr(!totalResultCount || c.localArchiveSaving, c.localArchiveSaving ? '이미 저장 중입니다.' : '저장할 생성 이미지가 없습니다.')}>
          <span class="material-icons-outlined" style="font-size:16px">file_download</span>
          다운로드로 저장
        </button>
        <button class="btn-sm" id="saveCutsSessionNowBtn">
          <span class="material-icons-outlined" style="font-size:16px">save</span>
          현재 작업 즉시 저장
        </button>
        <button class="btn-sm" id="recoverCutsPromptsBtn">
          <span class="material-icons-outlined" style="font-size:16px">history</span>
          프롬프트 복구
        </button>
        ${(anyGenerating || c.runBusy || c.sizeRunBusy) ? `<button class="btn-sm danger" id="resetCutsGenerationStateBtn">
          <span class="material-icons-outlined" style="font-size:16px">restart_alt</span>
          생성 상태 초기화
        </button>` : ''}
      </div>
    </div>

    <!-- 이미지컷 카드 -->
    <div class="cuts-grid">
      ${c.prompts.map((p, i) => `
        <div class="cut-card ${factoryCutPromptPreviewSrc(p, 'cuts') ? 'has-result' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="cut-label">
              ${p.label}
              ${(p.archiveId
                || p.localArchiveId
                || p.localArchive?.archiveId
                || p.metadata?.localArchiveId
                || factoryCutPromptPreviewSrc(p, 'cuts').includes('/api/local-archive/'))
                ? '<span class="factory-pill" style="margin-left:6px;color:var(--ok);border-color:color-mix(in srgb, var(--ok) 55%, transparent)">로컬</span>'
                : ''}
            </span>
            <div style="display:flex;gap:6px">
              <button class="btn-sm" data-rename-cut="${i}">✏️ 이름변경</button>
              ${factoryCutPromptPreviewSrc(p, 'cuts') ? `<a class="btn-sm" href="${escAttr(factoryCutPromptPreviewSrc(p, 'cuts'))}" download="cut${i+1}.png">⬇️ 저장</a>` : ''}
            </div>
          </div>

          <!-- 미리보기 -->
          <div class="cut-preview">
            ${p.generating
              ? `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--text-m);font-size:12px;text-align:center"><div class="cut-spinner"></div><span>${escapeHtml(cutGeneratingHelperText(p, `컷 ${i + 1}`))}</span></div>`
              : factoryCutPromptPreviewSrc(p, 'cuts')
                ? renderFactoryCutPromptPreviewImage(p, 'cuts', i, `cut${i + 1}`)
                : `<span style="color:var(--text-m);font-size:12px">생성 전</span>`
            }
          </div>

          <!-- 프롬프트 입력 -->
          <textarea class="textarea" data-cut-prompt="${i}" rows="3"
            placeholder="예) 흰 배경에 제품을 중앙 배치, 그림자 없이 깔끔하게&#10;예) 라이프스타일 감성, 카페 테이블 위에 놓인 모습&#10;예) 다크톤 럭셔리, 검은 배경 골드 조명"
            style="font-size:12px">${escapeHtml(p.prompt || '')}</textarea>
          ${p.warning ? `<div class="app-notice warn" style="padding:8px 10px;font-size:12px;margin-top:8px">${escapeHtml(cutsVisibleLogText(p.warning))}</div>` : ''}
          ${p.error ? `<div class="app-notice danger" style="padding:8px 10px;font-size:12px;margin-top:8px">${escapeHtml(cutsVisibleLogText(p.error))}</div>` : ''}

          <!-- 개별 생성 버튼 -->
          <button class="btn-primary" data-gen-cut="${i}"
            style="font-size:13px;padding:9px 16px;justify-content:center"
            ${cutBlockReason ? `title="${escAttr(cutBlockReason)}"` : ''}
            ${disabledAttr(p.generating || !!c.runBusy || !!cutBlockReason, p.generating || c.runBusy ? '이미 생성 중입니다.' : cutBlockReason)}>
            <span class="material-icons-outlined" style="font-size:16px">${p.generating ? 'hourglass_empty' : 'auto_fix_high'}</span>
            ${p.generating ? '생성 중...' : '이 컷 생성'}
          </button>
        </div>
      `).join('')}
    </div>

    <!-- 전체 생성 버튼 -->
    <div style="display:flex;gap:10px;margin-bottom:32px">
      <button class="btn-primary" id="genAllCutsBtn"
        style="padding:14px 32px;font-size:15px"
        ${cutBlockReason ? `title="${escAttr(cutBlockReason)}"` : ''}
        ${disabledAttr(anyGenerating || !!cutBlockReason, anyGenerating ? '이미 생성 중입니다.' : cutBlockReason)}>
        <span class="material-icons-outlined" style="font-size:20px">auto_fix_high</span>
        ${promptCount}개 컷 전체 생성
      </button>
      ${anyResult ? `<button class="btn-sm" id="clearAllCutsBtn" style="padding:12px 20px">
        <span class="material-icons-outlined" style="font-size:16px">delete_sweep</span>
        결과 초기화
      </button>` : ''}
    </div>

    ${renderSizeCutsPanel(c, { cutBlockReason })}

    ${renderDetailSectionPlacementPanel({
      title: '📌 상세페이지 섹션에 배치',
      desc: '이미지컷, 사이즈컷, 색상옵션 최종픽, 조립공장/자동화 결과를 원하는 섹션에 바로 꽂습니다.',
      emptyText: '이미지컷/사이즈컷/색상옵션 결과가 생기면 여기서 섹션에 배치할 수 있습니다.'
    })}`;
}
