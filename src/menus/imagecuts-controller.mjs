function one(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function all(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

function listen(disposers, node, type, listener) {
  if (!node?.addEventListener) return;
  node.addEventListener(type, listener);
  disposers.push(() => node.removeEventListener?.(type, listener));
}

export function createImageCutsController({
  defaultPromptCount,
  getSnapshot,
  invoke,
  promptUser,
}) {
  function bind(root) {
    const disposers = [];
    const sourceInput = one(root, '#cutsFileInput');
    const sourceArea = one(root, '#cutsUploadArea');
    listen(disposers, sourceArea, 'click', event => {
      if (event?.target?.closest?.('button,input,textarea,select,a,label,[contenteditable=true]')) return;
      sourceInput?.click?.();
    });
    listen(disposers, sourceArea, 'dragover', event => event.preventDefault());
    listen(disposers, sourceArea, 'drop', event => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file?.type?.startsWith('image/')) invoke('loadSource', file);
    });
    listen(disposers, sourceInput, 'change', event => {
      const file = event.target?.files?.[0];
      if (file) invoke('loadSource', file);
    });
    for (const node of all(root, '[data-cuts-pick-current-product]')) listen(disposers, node, 'click', event => {
      event.preventDefault();
      event.stopPropagation();
      sourceInput?.click?.();
    });
    for (const node of all(root, '[data-cuts-go-factory-start]')) listen(disposers, node, 'click', event => {
      event.preventDefault();
      event.stopPropagation();
      invoke('goFactoryStart');
    });
    for (const node of all(root, '[data-clear-cut-source]')) listen(disposers, node, 'click', event => {
      event.stopPropagation();
      invoke('clearSource');
    });

    const workInput = one(root, '#cutsWorkFileInput');
    const workArea = one(root, '#cutsWorkUploadArea');
    listen(disposers, workArea, 'click', () => workInput?.click?.());
    listen(disposers, workArea, 'dragover', event => event.preventDefault());
    listen(disposers, workArea, 'drop', event => {
      event.preventDefault();
      const file = event.dataTransfer?.files?.[0];
      if (file?.type?.startsWith('image/')) invoke('loadWorkImage', file);
    });
    listen(disposers, workInput, 'change', event => {
      const file = event.target?.files?.[0];
      if (file) invoke('loadWorkImage', file);
    });
    for (const node of all(root, '[data-clear-cut-work]')) listen(disposers, node, 'click', event => {
      event.stopPropagation();
      invoke('clearWorkImage');
    });

    const styleToggle = one(root, '#cutsStyleReferenceToggle');
    listen(disposers, styleToggle, 'change', () => invoke('setStyleReference', !!styleToggle.checked));
    listen(disposers, one(root, '#cutsClearSourceInline'), 'click', () => invoke('clearSource'));
    listen(disposers, one(root, '#cutsWorkFolderSaveBtn'), 'click', () => {
      invoke('saveWorkFolder', one(root, '#cutsWorkFolderInput')?.value || '');
    });

    const buttonCommands = [
      ['#cutsWorkDriveRunBtn', 'runWorkDrive'],
      ['#chooseCutsArchiveFolderBtn', 'chooseArchive'],
      ['#saveAllCutsLocalBtn', 'archiveAll'],
      ['#downloadAllCutsBtn', 'downloadAll'],
      ['#saveCutsSessionNowBtn', 'saveSession'],
      ['#recoverCutsPromptsBtn', 'recoverPrompts'],
      ['#resetCutsGenerationStateBtn', 'resetGeneration'],
      ['#genAllCutsBtn', 'generateAllCuts'],
      ['#genAllSizeCutsBtn', 'generateAllSizeCuts'],
      ['#clearAllCutsBtn', 'clearCutResults'],
      ['#clearAllSizeCutsBtn', 'clearSizeResults'],
      ['#applyPlacementBtn', 'applyPlacement'],
    ];
    for (const [selector, command] of buttonCommands) {
      listen(disposers, one(root, selector), 'click', () => invoke(command));
    }

    for (const node of all(root, '[data-cut-slot-delta]')) listen(disposers, node, 'click', () => {
      const cuts = getSnapshot()?.cuts || {};
      const current = cuts.promptSlotCount || cuts.prompts?.length || defaultPromptCount;
      invoke('setCutSlotCount', current + (Number.parseInt(node.dataset.cutSlotDelta, 10) || 0));
    });
    for (const node of all(root, '[data-size-cut-slot-delta]')) listen(disposers, node, 'click', () => {
      const cuts = getSnapshot()?.cuts || {};
      const current = cuts.sizePromptSlotCount || cuts.sizePrompts?.length || defaultPromptCount;
      invoke('setSizeSlotCount', current + (Number.parseInt(node.dataset.sizeCutSlotDelta, 10) || 0));
    });

    const bindPrompt = (selector, kind, dataKey) => {
      for (const node of all(root, selector)) {
        const save = event => invoke('setPrompt', {
          kind,
          index: Number.parseInt(node.dataset[dataKey], 10),
          value: event.target?.value || '',
        });
        listen(disposers, node, 'input', save);
        listen(disposers, node, 'change', save);
        listen(disposers, node, 'blur', save);
      }
    };
    bindPrompt('[data-cut-prompt]', 'cut', 'cutPrompt');
    bindPrompt('[data-size-cut-prompt]', 'size', 'sizeCutPrompt');

    for (const node of all(root, '[data-gen-cut]')) {
      listen(disposers, node, 'click', () => invoke('generateCut', Number(node.dataset.genCut)));
    }
    for (const node of all(root, '[data-gen-size-cut]')) {
      listen(disposers, node, 'click', () => invoke('generateSizeCut', Number(node.dataset.genSizeCut)));
    }

    const bindRename = (selector, kind, dataKey) => {
      for (const node of all(root, selector)) listen(disposers, node, 'click', () => {
        const index = Number(node.dataset[dataKey]);
        const cuts = getSnapshot()?.cuts || {};
        const rows = kind === 'size' ? cuts.sizePrompts : cuts.prompts;
        const current = rows?.[index]?.label || (kind === 'size' ? '사이즈컷 ' + (index + 1) : '컷 ' + (index + 1));
        const label = promptUser((kind === 'size' ? '사이즈컷' : '컷') + ' 이름을 입력하세요:', current);
        if (String(label || '').trim()) invoke('renamePrompt', { kind, index, label });
      });
    };
    bindRename('[data-rename-cut]', 'cut', 'renameCut');
    bindRename('[data-rename-size-cut]', 'size', 'renameSizeCut');

    for (const node of all(root, '[data-place-section]')) listen(disposers, node, 'change', event => {
      invoke('setPlacement', { sectionId: node.dataset.placeSection, value: event.target?.value || '' });
    });

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      while (disposers.length) disposers.pop()();
    };
  }

  return Object.freeze({ bind });
}
