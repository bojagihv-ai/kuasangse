export function renderOptionSorterView(view, helpers) {
  const {
    ensureOptionSorterDefaults, optMissingImagePayloadCount, renderOptionSorterSourceStrip,
    renderOptionSorterAssignmentWorkspace, renderOptionImageGeneratorPanel,
    optRenderImageOrPlaceholder, renderOptionSorterImagePreviewModal, disabledAttr, escapeHtml,
  } = helpers;
  const os = view.optionSorter;
  ensureOptionSorterDefaults(os);
  const missingPayloadCount = optMissingImagePayloadCount(os);

  // ── 정렬 화면 ──────────────────────────────────────────────────
  if (os.subStep === 'sort') {
    const assigned = os.slots.reduce((s, sl) => s + sl.imgIds.length, 0);
    const total = os.images.length;
    return `<div class="fade-in">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div>
          <h1 class="page-title" style="margin-bottom:2px">옵션 분류기</h1>
          <p style="font-size:12px;color:var(--text-m)">이미지를 드래그해서 슬롯에 배정 · ${assigned}/${total}장 배정됨${missingPayloadCount ? ` · ${missingPayloadCount}장 원본 복원 중` : ''}</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-sm" id="optAddImagesBtn" ${disabledAttr(total >= 30, '옵션 이미지는 최대 30장까지 추가할 수 있습니다.')}>
            <span class="material-icons-outlined" style="font-size:15px">add_photo_alternate</span> 이미지 추가
          </button>
          <input type="file" id="optFileInput" accept="image/*" multiple style="display:none">
          <button class="btn-sm" id="optAddSlot">+ 슬롯 추가</button>
          <button class="btn-sm" id="optBackInput">← 이미지 변경</button>
          <button class="btn-primary" id="optDlAll" style="padding:6px 16px;font-size:13px">
            <span class="material-icons-outlined" style="font-size:15px">download</span> 전체 다운로드
          </button>
        </div>
      </div>

      ${renderOptionSorterSourceStrip(os)}
      ${renderOptionSorterAssignmentWorkspace(os)}
      ${renderOptionImageGeneratorPanel(os)}
    </div>`;
  }

  // ── 업로드 화면 ────────────────────────────────────────────────
  return `<div class="fade-in">
    <h1 class="page-title">옵션 분류기</h1>
    <p class="page-desc">이미지를 업로드한 후 슬롯에 마우스로 드래그해서 원하는 옵션에 직접 배정하세요. 슬롯 이름도 자유롭게 변경할 수 있습니다.</p>

    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h2 style="font-size:15px;font-weight:700">제품 이미지 업로드</h2>
        <span style="font-size:12px;color:var(--text-m)">${os.images.length}장 / 최대 30장</span>
      </div>

      ${os.images.length < 30 ? `
      <div class="opt-upload-zone" id="optUploadZone">
        <span class="material-icons-outlined" style="font-size:36px;color:var(--primary);display:block;margin-bottom:8px">add_photo_alternate</span>
        <div style="font-size:14px;font-weight:500">클릭 또는 드래그하여 이미지 추가</div>
        <div style="font-size:12px;color:var(--text-m);margin-top:4px">JPG · PNG · WEBP · 최대 30장</div>
        <input type="file" id="optFileInput" accept="image/*" multiple style="display:none">
      </div>` : `<div style="font-size:12px;color:var(--text-m);text-align:center;padding:10px">최대 30장 업로드됨</div>`}

      ${os.images.length > 0 ? `
      <div style="margin-top:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:12px;color:var(--text-m)">${os.images.length}장 준비됨${missingPayloadCount ? ` · ${missingPayloadCount}장 원본 복원 중` : ''}</span>
          <button class="btn-sm" id="optClearImages" style="color:var(--err)">전체 삭제</button>
        </div>
        <div class="opt-img-preview-row">
          ${os.images.map(img => `
            <div class="opt-img-thumb" role="button" tabindex="0" data-opt-preview-img="${img.id}" aria-label="${escapeHtml(img.name)} 크게 보기" title="${escapeHtml(img.name)} 크게 보기">
              ${optRenderImageOrPlaceholder(img, `alt="${escapeHtml(img.name)}" loading="lazy"`, '이미지 복원 중')}
              <span class="opt-img-zoom-hint">확대</span>
              <button class="rm" data-opt-remove-img="${img.id}" title="삭제">✕</button>
            </div>`).join('')}
        </div>
      </div>` : ''}
    </div>

    <!-- 슬롯 미리보기 + 이름 변경 -->
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:20px;margin-bottom:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h2 style="font-size:15px;font-weight:700">슬롯 이름 미리 설정 (선택)</h2>
        <button class="btn-sm" id="optAddSlotInput">+ 슬롯 추가</button>
      </div>
      <p style="font-size:12px;color:var(--text-m);margin-bottom:12px">기본 ${os.slots.length}개 슬롯 · 이름 클릭하여 수정 · 분류 화면에서도 변경 가능</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${os.slots.map((slot, idx) => `
          <div style="display:flex;align-items:center;gap:5px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:5px 10px">
            <span style="font-size:11px;color:var(--text-m)">${idx+1}</span>
            <input class="opt-slot-name-inp" data-slot-name="${slot.id}"
              value="${escapeHtml(slot.name)}" placeholder="이름"
              style="width:64px;font-size:12px;font-weight:600">
            <button class="opt-slot-del" data-slot-del-input="${slot.id}" title="슬롯 삭제">✕</button>
          </div>`).join('')}
      </div>
    </div>

    <button class="btn-primary" id="optGoSort"
      style="width:100%;padding:14px;font-size:15px;font-weight:700;border-radius:12px;gap:8px"
      ${disabledAttr(os.images.length === 0, '분류할 제품 이미지를 먼저 업로드해주세요.')}>
      <span class="material-icons-outlined" style="font-size:20px">style</span>
      분류 시작 · ${os.images.length}장 / ${os.slots.length}개 슬롯
    </button>
    ${os.images.length === 0 ? `<p style="text-align:center;font-size:12px;color:var(--text-m);margin-top:8px">이미지를 먼저 업로드해주세요</p>` : ''}
    ${renderOptionSorterImagePreviewModal(os)}
  </div>`;
}
