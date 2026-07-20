export function renderImageCutsSourceView(state, helpers) {
  const {
    c,
    factoryLockedStage,
    hasGenerationInput,
    hasSrc,
    hasWorkImage,
    imageConnectionReady,
    lockedProductMissing,
    sessionImageHydrationPending,
    sourcePanelSub,
    sourcePanelTitle,
    sourcePreviewForDisplay,
    styleReferenceEnabled,
    styleReferenceMessage,
    styleReferenceUsable,
    workPreviewForDisplay,
  } = state;
  const {
    disabledAttr,
    escapeHtml,
    hasDriveService,
    renderFactoryLightImage,
  } = helpers;

  return `${sessionImageHydrationPending ? `<div class="notice info" style="margin-bottom:16px">
      저장된 이미지 후보를 브라우저 보관함에서 복구 중입니다. 복구가 끝나기 전에는 후보 없음으로 확정하지 않습니다.
    </div>` : ''}

    <!-- 이미지 업로드 영역: 샘플 + 작업 -->
    <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
      <!-- 샘플 이미지 -->
      <div style="flex:1;min-width:200px">
        <p style="font-size:12px;font-weight:600;color:var(--text-m);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">📌 ${sourcePanelTitle} <span style="color:var(--text-m);font-weight:400">${sourcePanelSub}</span></p>
        <div class="source-upload" id="cutsUploadArea" style="min-height:140px">
          ${hasSrc
            ? `${typeof renderFactoryLightImage === 'function' ? renderFactoryLightImage(sourcePreviewForDisplay, sourcePanelTitle, 'style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain"') : `<img src="${sourcePreviewForDisplay}" loading="lazy" decoding="async" style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain">`}
               ${!factoryLockedStage ? `<button type="button" data-clear-cut-source style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center" title="샘플 해제">×</button>` : ''}`
            : `<span class="material-icons-outlined" style="font-size:36px;color:var(--primary);display:block;margin-bottom:6px">add_photo_alternate</span>
               <p style="font-size:14px;font-weight:500">${factoryLockedStage ? '현재 제품 원본 대기' : '샘플 이미지 업로드'}</p>
               <p style="font-size:11px;color:var(--text-m);margin-top:3px">${factoryLockedStage ? '조립공장 제품 사진을 다시 올려주세요' : '선택 사항 · 클릭 또는 드래그&amp;드롭'}</p>
               ${factoryLockedStage ? `<div style="margin-top:10px;display:flex;gap:6px;justify-content:center;flex-wrap:wrap">
                 <button type="button" class="btn-sm" data-cuts-pick-current-product>제품 사진 넣기</button>
                 <button type="button" class="btn-sm" data-cuts-go-factory-start>1단계로 이동</button>
               </div>` : ''}`
          }
          <input type="file" id="cutsFileInput" accept="image/*" style="display:none">
        </div>
        <div class="factory-small" style="margin-top:6px;line-height:1.45">${escapeHtml(styleReferenceMessage)}</div>
      </div>

      <!-- 작업 이미지 -->
      <div style="flex:1;min-width:200px">
        <p style="font-size:12px;font-weight:600;color:var(--text-m);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">🔧 작업 이미지 <span style="color:var(--text-m);font-weight:400">${factoryLockedStage ? '(대표/이미지컷 단계에서는 추가 전송 안 함)' : '(처리할 제품)'}</span></p>
        <div class="source-upload" id="cutsWorkUploadArea" style="min-height:140px;border-color:${hasWorkImage ? 'var(--primary)' : 'var(--border)'}">
          ${hasWorkImage
            ? `${typeof renderFactoryLightImage === 'function' ? renderFactoryLightImage(workPreviewForDisplay, '작업 이미지', 'style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain"') : `<img src="${workPreviewForDisplay}" loading="lazy" decoding="async" style="max-height:160px;max-width:100%;border-radius:8px;object-fit:contain">`}
               <button type="button" data-clear-cut-work style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center" title="작업 이미지 해제">×</button>`
            : `<span class="material-icons-outlined" style="font-size:36px;color:#f59e0b;display:block;margin-bottom:6px">build_circle</span>
               <p style="font-size:14px;font-weight:500">작업 이미지 업로드</p>
                <p style="font-size:11px;color:var(--text-m);margin-top:3px">${factoryLockedStage ? '현재 단계에서는 왼쪽 현재 제품 원본만 사용' : '작업 이미지만으로도 생성 가능'}</p>`
          }
          <input type="file" id="cutsWorkFileInput" accept="image/*" style="display:none">
        </div>
        ${factoryLockedStage ? `<div class="factory-small" style="margin-top:6px;line-height:1.45">대표/이미지컷 생성 요청에는 오른쪽 작업 이미지를 섞지 않습니다. 현재 제품 원본 1장만 기준으로 사용합니다.</div>` : ''}
        <!-- 작업 이미지 Drive 자동화 -->
        <div style="margin-top:8px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:10px 12px">
          <p style="font-size:11px;font-weight:600;color:var(--text-m);margin-bottom:6px">☁️ Drive 작업 이미지 자동화</p>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
            <input id="cutsWorkFolderInput" class="input" placeholder="Drive 폴더 ID" value="${c.workDriveFolderId}" style="font-size:11px;flex:1;padding:5px 8px">
            <button class="btn-sm" id="cutsWorkFolderSaveBtn" style="font-size:11px;white-space:nowrap">저장</button>
          </div>
          ${c.workDriveFolderName ? `<p style="font-size:10px;color:var(--primary);margin-bottom:6px">📁 ${c.workDriveFolderName}</p>` : ''}
          <button class="btn-sm" id="cutsWorkDriveRunBtn"
            style="font-size:11px;width:100%;justify-content:center;${c.workDriveFolderId && hasDriveService() ? '' : 'opacity:.5'}"
            ${disabledAttr(c.workDriveRunning || !c.workDriveFolderId || !hasDriveService(), c.workDriveRunning ? 'Drive 작업 이미지를 처리 중입니다.' : (!c.workDriveFolderId ? 'Drive 폴더 ID를 먼저 저장해주세요.' : 'Drive 연결 후 사용할 수 있습니다.'))}>
            ${c.workDriveRunning
              ? '<span class="material-icons-outlined" style="font-size:13px;animation:spin 1s linear infinite">sync</span> 처리 중...'
              : '<span class="material-icons-outlined" style="font-size:13px">play_arrow</span> Drive 작업 이미지 일괄 처리'}
          </button>
        </div>
      </div>
    </div>

    <div style="border:1px solid rgba(99,102,241,.26);background:rgba(99,102,241,.055);border-radius:10px;padding:10px 12px;margin:-8px 0 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div style="min-width:220px">
        <div style="font-size:12px;font-weight:900;color:var(--text)">샘플 참조 방식</div>
        <div class="factory-small" style="line-height:1.45">${escapeHtml(styleReferenceMessage)}</div>
      </div>
      <label style="display:flex;align-items:center;gap:7px;font-size:12px;font-weight:850;color:${styleReferenceUsable ? 'var(--text)' : 'var(--text-m)'}">
        <input type="checkbox" id="cutsStyleReferenceToggle" ${styleReferenceEnabled ? 'checked' : ''} ${styleReferenceUsable ? '' : 'disabled'} style="accent-color:var(--primary)">
        샘플을 배경/구도 참조로 사용
      </label>
      ${!factoryLockedStage && hasSrc ? `<button type="button" class="btn-sm" id="cutsClearSourceInline">샘플 없이 생성</button>` : ''}
    </div>

    ${lockedProductMissing ? `<div class="app-notice danger" style="margin-bottom:16px;align-items:flex-start">
      <span class="material-icons-outlined">report</span>
      <span style="display:block">
        <b>현재 제품 원본이 비어 있어 생성하지 않습니다.</b><br>
        대표이미지/이미지컷은 지금 작업의 제품 사진 1장만 기준으로 생성합니다. 원본이 없으면 이전 작업 후보를 끌어오지 않고 여기서 멈춥니다.
        <span style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="btn-sm" data-cuts-pick-current-product>제품 사진 넣기</button>
          <button type="button" class="btn-sm" data-cuts-go-factory-start>제품 사진/이름 확인으로 이동</button>
        </span>
      </span>
    </div>` : !hasGenerationInput ? `<div class="app-notice warn" style="margin-bottom:16px">
      <span class="material-icons-outlined">info</span>
      <span>이미지컷 생성 버튼은 샘플 이미지나 작업 이미지 중 하나가 있어야 활성화됩니다. 샘플 없이 가려면 오른쪽 <b>작업 이미지</b>만 넣어도 됩니다.</span>
    </div>` : ''}
    ${hasGenerationInput && !imageConnectionReady ? `<div class="app-notice warn" style="margin-bottom:16px">
      <span class="material-icons-outlined">info</span>
      <span>이미지 생성 모델 연결이 아직 준비되지 않았습니다. 모델 설정/API 연결을 확인하면 생성 버튼이 활성화됩니다.</span>
    </div>` : ''}`;
}
