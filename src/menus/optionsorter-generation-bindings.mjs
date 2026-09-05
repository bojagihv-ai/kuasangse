// 사진을 드래그로 배정/해제한 직후 **생성 버튼의 잠금만** 자리에서 고친다.
//
// 왜 여기 있나: 이 파일이 optGenerateOptions 를 소유한다(아래 onclick 바인딩).
// 드래그 처리는 화면 떨림을 막으려고 다시 그리지 않고 자리에서 고치는데,
// 생성 버튼만 그 손질에서 빠져 있었다. 그래서 마지막 사진을 슬롯에 넣어도
// 버튼은 "미배정 사진 1장을 ... 배정해주세요" 라고 말한 채 잠겨 있었다
// (실측 2026-09-04, 회귀 FULL-08: 매칭 13/13 · 미배정 0 인데 10초 뒤에도 잠김).
// 슬롯 순서 드래그는 requestRender() 를 부르지만 사진 드래그는 안 부른다 - 그 차이였다.
//
// 다른 사유(생성 중 · 색상이미지 안씀 · 원본 복원 중)로 잠긴 것은 건드리지 않는다.
// '미배정' 사유로 잠긴 경우에만 손대서, 다른 잠금을 함부로 풀지 않는다.
export function syncOptionGenerateLock(byId, optionSorter) {
  const button = byId?.('optGenerateOptions');
  if (!button) return;
  const unassigned = (optionSorter?.pool || []).length;
  const lockedForUnassigned = /미배정 사진/.test(button.title || '');
  if (unassigned > 0) {
    if (!button.disabled || lockedForUnassigned) {
      button.disabled = true;
      button.title = `미배정 사진 ${unassigned}장을 옵션 이름 슬롯에 먼저 배정해주세요.`;
    }
  } else if (lockedForUnassigned) {
    button.disabled = false;
    button.title = '';
  }
}

export function bindOptionSorterGeneration(context) {
  const {
    byId, queryAll, optionSorter, requestRender, applyOptionGenerationPipeline,
    detectOptionTonePresetId, ensureDefaultSectionPlacements,
    factorySendOptionSorterResultsToFactory, getOptionGenerationPipeline,
    getOptionToneDisplayName, getOptionTonePreset, optAppendLogs, optClearStyleSample,
    optClearGroupShotImages, optDeleteStyleSampleFromLibrary, optGenerateOptionGroupShot,
    optGenerateOptionImages, optRefreshVisionColorHints, optSelectAllGroupShotImages,
    optSetGroupShotImageSelected, optOpenImagePreview,
    optScheduleSave, optSetStyleSample, optSetStyleSampleFromLibrary,
    optSetStyleSampleFromResult, readImageFileAsDataUrl, saveLastWorkNow, uid,
  } = context;

  queryAll('[data-opt-pipeline]').forEach(btn => {
    btn.onclick = () => {
      const pipelineId = btn.dataset.optPipeline || 'local_canvas';
      applyOptionGenerationPipeline(optionSorter(), pipelineId);
      const pipeline = getOptionGenerationPipeline(optionSorter());
      optAppendLogs(optionSorter(), `실제 생성 방식 선택: ${pipeline.name}`);
      optScheduleSave();
      requestRender();
    };
  });
  queryAll('[data-opt-sheet-method]').forEach(btn => {
    btn.onclick = () => {
      optionSorter().optionSheetMethod = btn.dataset.optSheetMethod || 'ai_sheet';
      optScheduleSave();
      requestRender();
    };
  });
  queryAll('[data-opt-content-mode]').forEach(btn => {
    btn.onclick = () => {
      optionSorter().optionContentMode = btn.dataset.optContentMode || 'full_image';
      optScheduleSave();
      requestRender();
    };
  });
  queryAll('[data-opt-tone-preset]').forEach(btn => {
    btn.onclick = () => {
      const preset = getOptionTonePreset(btn.dataset.optTonePreset);
      optionSorter().optionTonePresetId = preset.id;
      optionSorter().optionTone = preset.tone;
      optionSorter().optionGenLogs = [
        ...(optionSorter().optionGenLogs || []),
        `톤앤매너 프리셋 적용: ${preset.name}`,
      ].slice(-18);
      optScheduleSave();
      requestRender();
    };
  });
  const optOptionTone = byId('optOptionTone');
  if (optOptionTone) {
    optOptionTone.oninput = () => {
      optionSorter().optionTone = optOptionTone.value;
      optionSorter().optionTonePresetId = detectOptionTonePresetId(optOptionTone.value);
      optScheduleSave();
    };
    optOptionTone.onblur = () => { saveLastWorkNow(); requestRender(); };
  }
  const optOptionExtraPrompt = byId('optOptionExtraPrompt');
  if (optOptionExtraPrompt) {
    optOptionExtraPrompt.oninput = () => {
      optionSorter().optionExtraPrompt = optOptionExtraPrompt.value;
      optScheduleSave();
    };
    optOptionExtraPrompt.onblur = () => { saveLastWorkNow(); requestRender(); };
  }
  queryAll('[data-opt-group-shot-image]').forEach(btn => {
    btn.onclick = event => {
      event.stopPropagation();
      const selected = btn.dataset.optGroupShotSelected !== 'true';
      optSetGroupShotImageSelected(btn.dataset.optGroupShotImage, selected, optionSorter());
      optScheduleSave();
      saveLastWorkNow();
      requestRender();
    };
  });
  queryAll('[data-opt-group-shot-select-all]').forEach(btn => {
    btn.onclick = event => {
      event.stopPropagation();
      optSelectAllGroupShotImages(optionSorter());
      optScheduleSave();
      saveLastWorkNow();
      requestRender();
    };
  });
  queryAll('[data-opt-group-shot-clear]').forEach(btn => {
    btn.onclick = event => {
      event.stopPropagation();
      optClearGroupShotImages(optionSorter());
      optScheduleSave();
      saveLastWorkNow();
      requestRender();
    };
  });
  const optGroupShotPrompt = byId('optGroupShotPrompt');
  if (optGroupShotPrompt) {
    optGroupShotPrompt.oninput = () => {
      optionSorter().optionGroupShotPrompt = optGroupShotPrompt.value;
      optScheduleSave();
    };
    optGroupShotPrompt.onblur = () => saveLastWorkNow();
  }
  const optGenerateGroupShot = byId('optGenerateGroupShot');
  if (optGenerateGroupShot) {
    optGenerateGroupShot.onclick = () => optGenerateOptionGroupShot({ source: 'optionsorter' });
  }
  const optGenerateOptions = byId('optGenerateOptions');
  if (optGenerateOptions) optGenerateOptions.onclick = () => optGenerateOptionImages();
  queryAll('[data-opt-send-factory-result]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      factorySendOptionSorterResultsToFactory([btn.dataset.optSendFactoryResult]);
    };
  });
  const optSendCurrentOptionResults = byId('optSendCurrentOptionResultsToFactory');
  if (optSendCurrentOptionResults) optSendCurrentOptionResults.onclick = () => {
    const resultIds = String(optSendCurrentOptionResults.dataset.optSendCurrentResults || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);
    factorySendOptionSorterResultsToFactory(resultIds);
  };
  const optVisionColorCheck = byId('optVisionColorCheck');
  if (optVisionColorCheck) optVisionColorCheck.onclick = () => optRefreshVisionColorHints().catch(e => {
    optAppendLogs(optionSorter(), `AI 비전 색상 판정 실패: ${e.message || e}`);
    optionSorter().optionVisionColorBusy = false;
    optScheduleSave();
    requestRender();
  });
  const optAutoNameColors = byId('optAutoNameColors');
  if (optAutoNameColors) optAutoNameColors.onclick = () => optRefreshVisionColorHints({
    applySlotNames: true,
    requireGptOAuth: true,
  }).catch(e => {
    optionSorter().optionAutoColorNameStatus = `색상명 자동 생성 실패: ${e.message || e}`;
    optAppendLogs(optionSorter(), optionSorter().optionAutoColorNameStatus);
    optionSorter().optionVisionColorBusy = false;
    optScheduleSave();
    requestRender();
  });
  queryAll('[data-opt-preview-result]').forEach(el => {
    el.onclick = e => {
      e.stopPropagation();
      const resultId = el.dataset.optPreviewResult || '';
      if (typeof optOpenImagePreview === 'function') {
        optOpenImagePreview(null, resultId);
        return;
      }
      optionSorter().previewResultId = resultId;
      optionSorter().previewImageId = null;
      requestRender();
    };
  });
  queryAll('[data-opt-set-style-sample]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const ok = optSetStyleSampleFromResult(btn.dataset.optSetStyleSample, optionSorter());
      if (!ok) optAppendLogs(optionSorter(), '샘플 지정 실패: 이미지가 있는 생성 결과를 선택해주세요.');
      saveLastWorkNow();
      requestRender();
    };
  });
  queryAll('[data-opt-load-style-sample]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const ok = optSetStyleSampleFromLibrary(btn.dataset.optLoadStyleSample, optionSorter());
      if (!ok) optAppendLogs(optionSorter(), '샘플 불러오기 실패: 보관함 샘플을 찾을 수 없습니다.');
      saveLastWorkNow();
      requestRender();
    };
  });
  queryAll('[data-opt-delete-style-sample]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      optDeleteStyleSampleFromLibrary(btn.dataset.optDeleteStyleSample, optionSorter());
      saveLastWorkNow();
      requestRender();
    };
  });
  const optClearStyleSampleBtn = byId('optClearStyleSample');
  if (optClearStyleSampleBtn) optClearStyleSampleBtn.onclick = e => {
    e.stopPropagation();
    optClearStyleSample(optionSorter());
    saveLastWorkNow();
    requestRender();
  };
  const optUploadStyleSampleBtn = byId('optUploadStyleSample');
  const optStyleSampleFileInput = byId('optStyleSampleFileInput');
  if (optUploadStyleSampleBtn && optStyleSampleFileInput) {
    optUploadStyleSampleBtn.onclick = e => {
      e.stopPropagation();
      optStyleSampleFileInput.click();
    };
    optStyleSampleFileInput.onchange = async () => {
      const file = optStyleSampleFileInput.files && optStyleSampleFileInput.files[0];
      optStyleSampleFileInput.value = '';
      if (!file) return;
      try {
        const dataUrl = await readImageFileAsDataUrl(file);
        const ok = optSetStyleSample({
          id: uid('sample'),
          sourceResultId: '',
          name: `업로드 샘플 · ${String(file.name || '옵션 디자인').slice(0, 48)}`,
          image: dataUrl,
          tonePresetName: getOptionToneDisplayName(optionSorter()),
          pipelineName: '외부 참고 디자인',
          modelLabel: 'user-upload',
          sourceName: file.name || 'uploaded-style-sample',
          createdAt: new Date().toISOString(),
        }, optionSorter(), { saveToLibrary: true });
        if (!ok) optAppendLogs(optionSorter(), '샘플 업로드 실패: 이미지 형식을 확인해주세요.');
        else ensureDefaultSectionPlacements({ forceOption: true });
      } catch (err) {
        optAppendLogs(optionSorter(), `샘플 업로드 실패: ${err.message || err}`);
      }
      saveLastWorkNow();
      requestRender();
    };
  }
}
