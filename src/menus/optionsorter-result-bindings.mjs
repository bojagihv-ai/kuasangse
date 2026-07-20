export function bindOptionSorterResults(context) {
  const {
    byId, queryAll, queryOne, optionSorter, requestRender, claimArchiveStatusLoad,
    clearFixedDetailImage, clearOptionColorSectionPlacement, ensureOptionSorterDefaults,
    handleFixedDetailImageFile, optAppendLogs, optArchiveAllOptionResults,
    optArchiveOptionResult, optChooseArchiveFolder, optDownloadAllOptionResults,
    optDownloadOptionResult, optDownloadOptionResultSplits, optGetArchiveDirectoryHandle,
    optLoadArchiveFolderStatus, optScheduleSave, optUseExistingColorImagesFromResult,
    reportWarning, saveLastWorkNow,
  } = context;

  queryAll('[data-opt-download-result]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      optDownloadOptionResult(btn.dataset.optDownloadResult);
    };
  });
  queryAll('[data-opt-download-splits]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      optDownloadOptionResultSplits(btn.dataset.optDownloadSplits);
    };
  });
  queryAll('[data-opt-use-existing-colors]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const added = optUseExistingColorImagesFromResult(btn.dataset.optUseExistingColors, optionSorter());
      if (added) requestRender();
      else {
        optScheduleSave();
        requestRender();
      }
    };
  });
  queryAll('[data-opt-archive-result]').forEach(btn => {
    btn.onclick = async e => {
      e.stopPropagation();
      const os = optionSorter();
      const result = (os.optionResults || []).find(item => item.id === btn.dataset.optArchiveResult);
      if (!result) return;
      try {
        if (!(await optGetArchiveDirectoryHandle())) {
          await optChooseArchiveFolder();
          if (!(await optGetArchiveDirectoryHandle())) return;
        }
        await optArchiveOptionResult(result, { force: true });
        os.optionArchiveEnabled = true;
        optAppendLogs(os, `폴더 저장 완료: ${result.optionName || result.id}`);
        saveLastWorkNow();
        requestRender();
      } catch (archiveError) {
        os.optionArchiveStatus = `폴더 저장 실패: ${archiveError.message || archiveError}`;
        optAppendLogs(os, os.optionArchiveStatus);
        optScheduleSave();
        requestRender();
      }
    };
  });
  const optClearOptionResults = byId('optClearOptionResults');
  if (optClearOptionResults) optClearOptionResults.onclick = () => {
    const os = optionSorter();
    os.optionResults = [];
    os.previewResultId = null;
    os.optionGenLogs = [];
    os.optionGenProgress = 0;
    clearOptionColorSectionPlacement();
    optScheduleSave();
    requestRender();
  };
  const optDownloadAllOptionResultsBtn = byId('optDownloadAllOptionResults');
  if (optDownloadAllOptionResultsBtn) optDownloadAllOptionResultsBtn.onclick = () => optDownloadAllOptionResults();
  queryAll('[data-fixed-detail-pick]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const slotId = btn.dataset.fixedDetailPick;
      queryOne(`input[data-fixed-detail-file="${slotId}"]`)?.click();
    };
  });
  queryAll('[data-fixed-detail-file]').forEach(input => {
    input.onchange = async e => {
      e.stopPropagation();
      const file = input.files?.[0];
      if (file) await handleFixedDetailImageFile(input.dataset.fixedDetailFile, file);
      input.value = '';
    };
  });
  queryAll('[data-fixed-detail-clear]').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      clearFixedDetailImage(btn.dataset.fixedDetailClear);
    };
  });
  const optChooseArchiveFolderBtn = byId('optChooseArchiveFolder');
  if (optChooseArchiveFolderBtn) optChooseArchiveFolderBtn.onclick = () => optChooseArchiveFolder();
  const optToggleArchiveAutoBtn = byId('optToggleArchiveAuto');
  if (optToggleArchiveAutoBtn) optToggleArchiveAutoBtn.onclick = async () => {
    const os = optionSorter();
    ensureOptionSorterDefaults(os);
    if (!os.optionArchiveEnabled && !(await optGetArchiveDirectoryHandle())) {
      await optChooseArchiveFolder();
      if (!(await optGetArchiveDirectoryHandle())) return;
    }
    os.optionArchiveEnabled = !os.optionArchiveEnabled;
    os.optionArchiveStatus = os.optionArchiveEnabled
      ? `자동 저장 켜짐: ${os.optionArchiveFolderName || '선택한 폴더'}`
      : '자동 저장을 껐습니다. 이미 저장된 폴더 파일은 그대로 유지됩니다.';
    optAppendLogs(os, os.optionArchiveStatus);
    saveLastWorkNow();
    requestRender();
  };
  const optArchiveAllResultsBtn = byId('optArchiveAllResults');
  if (optArchiveAllResultsBtn) optArchiveAllResultsBtn.onclick = () => optArchiveAllOptionResults();
  if ((optChooseArchiveFolderBtn || optArchiveAllResultsBtn) && claimArchiveStatusLoad()) {
    optLoadArchiveFolderStatus({ render: true }).catch(e => {
      reportWarning('Option archive status load failed:', e);
    });
  }
}
