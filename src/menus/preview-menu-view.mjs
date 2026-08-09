export function renderPreviewView(view, helpers) {
  const {
    syncFixedSectionPlacementImages,
    orderedSections,
    factoryRecoveredDetailPreviewHtml,
    renderBrandStudioPanel,
    renderToneQuickPanel,
    renderQaPanel,
    renderFixedDetailImagePanel,
    renderRecoveredDetailPreviewNotice,
    renderRecoveredDetailPreviewAside,
    renderPreviewOutline,
    renderFixedDetailImageForExport,
    cssFontFamily,
    displayableImageSrc,
    canUndoAiRepair,
    getSectionGenerationModeInfo,
    resolveSectionRenderGenerationMode,
    renderSectionVariantQuickBar,
    renderSectionVariantEvaluationPanel,
    renderPreviewEditPanel,
    renderSectionTemplate,
    renderDetailImageBlocksAfter,
    renderFactoryLightImage,
    sectionPlacementChoicesFromOptions,
    publicSectionText,
    nl2br,
    escAttr,
    escapeHtml,
  } = helpers;
  const safeColor = (value, fallback) => /^#[0-9a-f]{3,8}$/i.test(String(value || '').trim()) ? String(value).trim() : fallback;
  const safeLength = (value, fallback) => /^(?:\d+(?:\.\d+)?)(?:px|rem|em|%)$/.test(String(value || '').trim()) ? String(value).trim() : fallback;
  const safeWeight = value => /^(?:normal|bold|[1-9]00)$/.test(String(value || '').trim()) ? String(value).trim() : '700';
  const renderMissingPreviewSection = section => {
    const choices = section.id === 'size_color' ? sectionPlacementChoicesFromOptions() : [];
    const picker = section.id === 'size_color' ? `<div style="display:flex;flex-direction:column;gap:8px;min-width:240px;max-width:100%"><div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap"><span style="font-size:10px;color:var(--text-d)">로컬 이미지 또는 옵션 분류기 결과 선택</span><button class="btn-sm" type="button" data-open-image-insert="${escAttr(section.id)}:replace"><span class="material-icons-outlined" style="font-size:15px">upload</span> 로컬 이미지 추가</button></div>${choices.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">${choices.map(choice => `<button class="btn-sm" type="button" data-choose-section-placement-section="${escAttr(section.id)}" data-choose-section-placement-value="${escAttr(choice.key)}" title="${escAttr(choice.source + ' · ' + choice.label)}" style="display:flex;align-items:center;gap:7px;max-width:240px;text-align:left"><span style="width:34px;height:34px;flex:none;border:1px solid var(--border);border-radius:6px;overflow:hidden;background:var(--bg-input);display:inline-flex;align-items:center;justify-content:center"><img src="${escAttr(choice.image)}" alt="${escAttr(choice.label)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover"></span><span style="min-width:0;display:flex;flex-direction:column;line-height:1.25"><strong style="font-size:11px;color:var(--text)">${escapeHtml(choice.label || '옵션 분류기 결과')}</strong><span style="font-size:10px;color:var(--text-d)">이 이미지 선택</span></span></button>`).join('')}</div>` : '<span style="font-size:10px;color:var(--text-d);text-align:right">옵션 분류기 생성 결과가 아직 없습니다.</span>'}</div>` : '';
    return `<div class="preview-missing-section" data-jpg-ignore="true" data-preview-section="${escAttr(section.id)}" style="padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;background:rgba(255,255,255,.01);border-bottom:1px solid var(--border)"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:16px">${escapeHtml(section.icon || '')}</span><span style="font-size:13px;font-weight:600;color:var(--text-m)">${section.n}. ${escapeHtml(section.name || '')}</span></div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:auto"><span style="font-size:10px;font-weight:700;padding:2px 8px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:6px;color:var(--text-m);letter-spacing:0.5px">미생성</span>${picker}</div></div>`;
  };
  const jpgBusy = view.jpgExportBusy;
  const previewSections = orderedSections();
  const previewContentCount = previewSections.filter(s => !!view.sectionContents?.[s.id]).length;
  const generatedSectionCount = previewSections.filter(s => !!(view.sectionContents?.[s.id] || view.sectionImages?.[s.id])).length;
  const missingSectionCount = Math.max(0, previewSections.length - generatedSectionCount);
  const archiveRecovery = view.previewArchiveRecovery || null;
  const stoppedSectionRun = view.sectionBatchRun?.status === 'stopped' ? view.sectionBatchRun : null;
  const recoveredDetailPreview = factoryRecoveredDetailPreviewHtml();
  const showRecoveredDetailPreview = !!(recoveredDetailPreview && (view.previewRecoveredDetailMode || !previewContentCount));
  return `<div class="fade-in">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
      <div>
        <h1 class="page-title">상세페이지 미리보기</h1>
        <p class="page-desc">생성된 상세페이지를 확인하고 개별 섹션을 수정할 수 있습니다.</p>
      </div>
      <!-- 툴바: 2개 그룹으로 분리 및 프리미엄 스타일링 -->
      <div style="display:flex;flex-direction:column;gap:12px;align-items:flex-end;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 16px;box-shadow:var(--shadow-sm)">
        <!-- 그룹 1: 뷰 전환 + 레이어 -->
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:700;color:var(--text-d);text-transform:uppercase;letter-spacing:0.5px">뷰 & 레이어</span>
          <div style="width:1px;height:12px;background:var(--border);margin:0 4px"></div>
          <div style="display:flex;gap:2px;border:1px solid var(--border);border-radius:8px;padding:2px;background:var(--bg-input)">
            <button class="viewport-btn ${view.previewViewport==='pc'?'active':''}" id="viewportPc" data-preview-viewport="pc" title="PC 뷰 (1100px)">
              <span class="material-icons-outlined" style="font-size:14px">computer</span>PC
            </button>
            <button class="viewport-btn ${view.previewViewport==='mobile'?'active':''}" id="viewportMobile" data-preview-viewport="mobile" title="모바일 뷰 (430px)">
              <span class="material-icons-outlined" style="font-size:14px">smartphone</span>모바일
            </button>
          </div>
          <button class="btn-sm" id="toggleLayerMode" style="${view.previewLayerMode ? 'border-color:var(--primary);color:var(--primary-h);background:var(--primary-dim)' : ''}">
            <span class="material-icons-outlined" style="font-size:15px">${view.previewLayerMode ? 'edit_attributes' : 'open_with'}</span>
            ${view.previewLayerMode ? '레이어 편집 중' : '레이어 편집'}
          </button>
          <button class="btn-sm" id="editorUndoTopBtn" ${view.editorHistory?.undo?.length ? '' : 'disabled'} title="Ctrl+Z">
            <span class="material-icons-outlined" style="font-size:15px">undo</span> 되돌리기
          </button>
          <button class="btn-sm" id="editorRedoTopBtn" ${view.editorHistory?.redo?.length ? '' : 'disabled'} title="Ctrl+Y">
            <span class="material-icons-outlined" style="font-size:15px">redo</span> 다시 실행
          </button>
          <button class="btn-sm" id="runQaBtn" title="품질 검사">
            <span class="material-icons-outlined" style="font-size:15px">fact_check</span>
            ${(!view.qaReport || view.qaVersion !== view.contentVersion) ? '품질 검사' : 'QA 재검사'}
          </button>
          <button class="btn-sm" id="runAiQaBtn" title="AI 품질 검사">
            <span class="material-icons-outlined" style="font-size:15px">smart_toy</span>
            AI QA 검사
          </button>
        </div>
        <!-- 그룹 2: 내보내기 -->
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <span style="font-size:11px;font-weight:700;color:var(--text-d);text-transform:uppercase;letter-spacing:0.5px">내보내기</span>
          <div style="width:1px;height:12px;background:var(--border);margin:0 4px"></div>
          <button class="btn-sm" type="button" data-factory-open-local-archive-folder="section_header" data-factory-local-archive-scope="category" title="생성된 섹션 이미지를 보관한 로컬 폴더 열기">
            <span class="material-icons-outlined" style="font-size:15px">folder_open</span>섹션 이미지 폴더
          </button>
          <span class="factory-small" data-factory-local-archive-folder-status="section_header" aria-live="polite"></span>
          <button class="btn-sm" id="exportLayeredSVG" title="레이어드 SVG 내보내기">
            <span class="material-icons-outlined" style="font-size:15px">layers</span>SVG
          </button>
          <button class="btn-sm" id="exportPhotoshopPackage" title="Photoshop에서 실행하면 실제 PSD를 저장하는 레이어 생성팩입니다. AI 생성 이미지 안에 이미 박힌 글자는 비트맵 참고 레이어로 들어갑니다.">
            <span class="material-icons-outlined" style="font-size:15px">filter_none</span>PSD 레이어팩
          </button>
          <button class="btn-sm" id="exportJpgAll" ${jpgBusy ? 'disabled' : ''} title="JPG 전체 저장">
            <span class="material-icons-outlined" style="font-size:15px">photo_camera</span>
            ${jpgBusy === 'all' ? 'JPG 저장 중...' : '전체 JPG'}
          </button>
          <button class="btn-sm" id="exportJpgSections" ${jpgBusy ? 'disabled' : ''} title="섹션별 JPG 저장">
            <span class="material-icons-outlined" style="font-size:15px">view_stream</span>
            ${jpgBusy === 'sections' ? 'JPG 저장 중...' : '섹션별 JPG'}
          </button>
          <button class="btn-primary" id="exportHTML" style="padding:6px 14px;font-size:12px">
            <span class="material-icons-outlined" style="font-size:16px">download</span>
            HTML 내보내기
          </button>
        </div>
      </div>
    </div>

    ${renderBrandStudioPanel()}
    ${renderToneQuickPanel()}
    ${renderQaPanel()}
    ${renderFixedDetailImagePanel()}
    ${renderRecoveredDetailPreviewNotice(recoveredDetailPreview, showRecoveredDetailPreview)}
    ${stoppedSectionRun ? `<div class="app-notice warn" style="margin-bottom:16px;border-color:rgba(245,158,11,.42);background:rgba(245,158,11,.08)">
      <span class="material-icons-outlined">stop_circle</span>
      <div style="flex:1;min-width:220px">
        <strong>현재 섹션까지 생성하고 중지했습니다.</strong>
        <div style="font-size:12px;color:var(--text-m);margin-top:4px;line-height:1.55">완료된 ${generatedSectionCount}/${previewSections.length}개 섹션은 이 미리보기와 HTML/JPG 내보내기에서 바로 사용할 수 있습니다. 나머지는 섹션 설정에서 이어서 생성할 수 있습니다.</div>
      </div>
      <button class="btn-sm" id="openRemainingSectionsAfterStop" type="button">남은 섹션 확인</button>
    </div>` : ''}
    ${missingSectionCount ? `<div class="app-notice ${archiveRecovery?.tone === 'ok' ? 'ok' : 'warn'}" style="margin-bottom:16px">
      <span class="material-icons-outlined">inventory_2</span>
      <div style="flex:1;min-width:220px">
        <strong>${escapeHtml(archiveRecovery?.message || `현재 미리보기에 없는 섹션 ${missingSectionCount}개가 있습니다.`)}</strong>
        <div style="font-size:12px;color:var(--text-m);margin-top:4px;line-height:1.55">생성 이미지와 섹션 내용은 로컬 보관함에 즉시 저장됩니다. 같은 제품·원본 기준의 보관본만 버튼을 눌렀을 때 현재 작업으로 복원합니다.</div>
      </div>
      <button class="btn-sm" id="recoverPreviewArchiveSections" type="button">로컬 보관본 복구</button>
    </div>` : (archiveRecovery?.message ? `<div class="app-notice ok" style="margin-bottom:16px"><span class="material-icons-outlined">inventory_2</span><div style="flex:1"><strong>${escapeHtml(archiveRecovery.message)}</strong></div></div>` : '')}
    ${generatedSectionCount || showRecoveredDetailPreview ? '' : `<div class="app-notice warn" style="margin-bottom:16px">
      <span class="material-icons-outlined">visibility</span>
      <div style="flex:1">
        <strong>아직 생성된 섹션이 없습니다.</strong>
        <div style="font-size:12px;color:var(--text-m);margin-top:4px">미리보기 화면은 열어둡니다. 섹션 설정에서 원하는 섹션을 만들거나, 자동 생성으로 전체 섹션을 만든 뒤 이 화면에서 다시 확인할 수 있습니다.</div>
      </div>
      <button class="btn-sm" data-route-target="sections">섹션 설정으로 이동</button>
      ${view.analysis
        ? `<button class="btn-sm" data-start-generating>자동 생성 시작</button>`
        : `<button class="btn-sm" disabled title="제품 이미지 분석 자료가 있어야 자동 생성할 수 있습니다.">자동 생성 시작</button>`}
    </div>`}
    ${view.previewLayerMode ? `<div class="layer-mode-banner">
      <span class="material-icons-outlined" style="color:var(--primary-h)">touch_app</span>
      <div><strong style="color:var(--text)">직접 조작 모드</strong> · 텍스트/이미지를 클릭해 선택하고 드래그하세요. 섹션의 <strong>수정</strong> 버튼을 열면 정밀 슬라이더가 나옵니다.</div>
      <button class="btn-sm" id="resetAllLayers" style="margin-left:auto">전체 레이어 초기화</button>
    </div>` : ''}

    <div class="preview-builder">
    ${showRecoveredDetailPreview ? renderRecoveredDetailPreviewAside(recoveredDetailPreview) : renderPreviewOutline()}
    <div class="preview-viewport-${view.previewViewport}">
    <div class="preview-wrap" data-recovered-detail-preview="${showRecoveredDetailPreview ? '1' : '0'}">
      ${showRecoveredDetailPreview ? recoveredDetailPreview.html : `${renderFixedDetailImageForExport('brand')}
      ${previewSections.map(s => {
        const content = view.sectionContents[s.id];
        if (!content) return renderMissingPreviewSection(s);

        const c = content.color_scheme || {};
        const f = content.font_suggestion || {};
        const headlineFont = cssFontFamily(f.headline_font);
        const bodyFont = cssFontFamily(f.body_font || f.headline_font);
        const img = displayableImageSrc(view.sectionImages?.[s.id]);
        const isEditing = view.editingPreviewSection === s.id;
        const hasRepairUndo = canUndoAiRepair(s.id);
        const modeInfo = getSectionGenerationModeInfo(resolveSectionRenderGenerationMode(s.id, content));
        const regenerationState = view.sectionGenerating?.[s.id] || '';
        const isRegenerating = regenerationState === 'loading';
        const regenerationFailed = regenerationState === 'error';

        return `
          <div class="preview-generated-section" style="position:relative" data-preview-section="${escAttr(s.id)}">
            <div class="section-ctrl">
              <span style="font-size:16px">${escapeHtml(s.icon || '')}</span>
              <span class="name">${s.n}. ${escapeHtml(s.name || '')}</span>
              <span class="section-mode-current" title="${escAttr(modeInfo.desc)}">${escapeHtml(modeInfo.shortLabel)}</span>
              <div style="flex:1"></div>
              <button class="btn-sm" data-edit-preview="${s.id}">
                <span class="material-icons-outlined" style="font-size:16px">edit</span> 수정
              </button>
              <div class="image-tools">
                ${img ? `<button class="btn-sm" data-focus-section-image="${s.id}">
                  <span class="material-icons-outlined" style="font-size:16px">open_with</span> 위치
                </button>
                <button class="btn-sm" data-show-image-prompt="${s.id}" title="현재 이미지가 어떤 기준과 최종 프롬프트로 생성됐는지 봅니다">
                  <span class="material-icons-outlined" style="font-size:16px">receipt_long</span> 프롬프트
                </button>
                <button class="btn-sm" data-ai-repair="${s.id}">
                  <span class="material-icons-outlined" style="font-size:16px">auto_fix_high</span> 2. AI 스팟
                </button>
                ${hasRepairUndo ? `<button class="btn-sm" data-undo-ai-repair="${s.id}" style="color:var(--warn)">
                  <span class="material-icons-outlined" style="font-size:16px">undo</span> 스팟 되돌리기
                </button>` : ''}
                ` : ''}
                <button class="btn-sm" data-open-image-insert="${s.id}:replace">
                  <span class="material-icons-outlined" style="font-size:16px">image</span> ${img ? '교체' : '이미지 추가'}
                </button>
                ${img ? `<button class="btn-sm" data-delete-section-image="${s.id}" style="color:var(--err)">
                  <span class="material-icons-outlined" style="font-size:16px">delete</span> 삭제
                </button>` : ''}
                <button class="btn-sm" data-open-image-insert="${s.id}:after">
                  <span class="material-icons-outlined" style="font-size:16px">add_photo_alternate</span> 아래 사진 추가
                </button>
              </div>
              <button class="btn-sm" data-regen="${s.id}" ${isRegenerating ? 'disabled title="이 섹션을 재생성하고 있습니다."' : 'title="이 섹션을 다시 생성"'} style="min-width:96px;${regenerationFailed ? 'color:var(--err);border-color:rgba(239,68,68,.35);' : ''}">
                ${isRegenerating ? '<span class="spinner" style="width:13px;height:13px;border-width:2px"></span> 생성 중' : `<span class="material-icons-outlined" style="font-size:16px">${regenerationFailed ? 'refresh' : 'play_arrow'}</span> ${regenerationFailed ? '다시 시도' : '다시 생성'}`}
              </button>
            </div>
            ${renderSectionVariantQuickBar(s.id)}
            ${renderSectionVariantEvaluationPanel(s.id, 'compact')}
            ${isEditing ? `<div class="edit-panel"  style="display:none">
              <textarea class="textarea" data-edit-input="${escAttr(s.id)}" rows="2" placeholder="이 섹션에 대한 수정 지시사항...">${escapeHtml(view.sectionInstructions?.[s.id] || '')}</textarea>
              <button class="btn-sm" style="margin-top:8px" data-apply-edit="${s.id}">지시사항 적용 후 재생성</button>
            </div>` : ''}
            ${isEditing ? renderPreviewEditPanel(s, content) : ''}
            ${renderSectionTemplate(s, content, img, 'preview')}
            ${renderDetailImageBlocksAfter(s.id, 'preview')}
            <div style="display:none;background:${safeColor(c.background, '#FFFFFF')};padding:48px 20px;text-align:center">
              <div style="max-width:860px;margin:0 auto">
                <h2 style="font-size:${safeLength(f.headline_size, '36px')};color:${safeColor(c.text_primary, '#333')};font-weight:${safeWeight(f.headline_weight)};font-family:${headlineFont};margin-bottom:10px">
                  ${escapeHtml(publicSectionText(content.headline || content.title || '', s))}
                </h2>
                <h3 style="font-size:18px;color:${safeColor(c.text_secondary, '#666')};font-weight:400;font-family:${bodyFont};margin-bottom:20px">
                  ${escapeHtml(publicSectionText(content.subheadline || content.subtitle || '', s))}
                </h3>
          ${img ? renderFactoryLightImage(displayableImageSrc(img), s.name, 'style="max-width:100%;border-radius:12px;margin-bottom:20px"') : ''}
                <p style="font-size:${safeLength(f.body_size, '16px')};color:${safeColor(c.text_secondary, '#666')};line-height:1.8;font-family:${bodyFont};max-width:680px;margin:0 auto">
                  ${nl2br(publicSectionText(content.body_text || content.body || '', s))}
                </p>
                ${content.extra_elements?.length ? `<div style="margin-top:20px;text-align:left;max-width:600px;margin-left:auto;margin-right:auto">
                  ${content.extra_elements.map(e => publicSectionText(e, s)).filter(Boolean).map(e => `<div style="padding:8px 0;color:${safeColor(c.text_secondary, '#555')};font-size:14px;font-family:${bodyFont};border-bottom:1px solid rgba(0,0,0,.05)">• ${escapeHtml(e)}</div>`).join('')}
                </div>` : ''}
                ${content.cta_text ? `<div style="display:inline-block;margin-top:20px;padding:12px 36px;background:${safeColor(c.accent, '#6366f1')};color:#fff;border-radius:8px;font-weight:600;font-size:16px;font-family:${bodyFont}">${escapeHtml(content.cta_text)}</div>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}
      ${renderFixedDetailImageForExport('package')}
      ${renderFixedDetailImageForExport('return')}`}
    </div>
    </div>
    </div>
  </div>`;
}
