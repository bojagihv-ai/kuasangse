function all(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

function one(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function listen(disposers, node, type, listener) {
  if (!node?.addEventListener) return;
  node.addEventListener(type, listener);
  disposers.push(() => node.removeEventListener?.(type, listener));
}

function profile(root, mode, id, enabled, config) {
  const { getSnapshot, extractFolderId, parsePositiveInt, getDraftCuts } = config;
  const previous = getSnapshot()?.automation?.serverConfig?.profiles?.[mode] || {};
  const value = {
    enabled: enabled === undefined ? !!previous.enabled : !!enabled,
    inputFolderId: extractFolderId(one(root, `#serverInput${id}`)?.value || ''),
    sourceDoneFolderId: extractFolderId(one(root, `#serverDone${id}`)?.value || ''),
    outputFolderId: extractFolderId(one(root, `#serverOutput${id}`)?.value || ''),
    pollIntervalSeconds: parsePositiveInt(one(root, `#serverPoll${id}`)?.value, 120, 30, 3600),
    maxFilesPerRun: parsePositiveInt(one(root, `#serverMax${id}`)?.value, 1, 1, 20),
    imageModel: one(root, `#serverModel${id}`)?.value || previous.imageModel || 'gemini-3.1-flash-image',
    outputImageSize: one(root, `#serverResolution${id}`)?.value || null,
  };
  if (mode === 'image-cuts') {
    value.customCuts = getDraftCuts().map(cut => ({ label: cut.label, prompt: cut.prompt }));
  }
  return { mode, profile: value };
}

export function bindAutomationEvents({ root, contract, controller, config }) {
  const {
    getSnapshot, extractFolderId, updateDraftCut, recoverDraftCuts,
  } = config;
  const { invokeAsync } = controller;
  const disposers = [];

  listen(disposers, one(root, '#serverAutoRefreshBtn'), 'click', () => {
    const base = one(root, '#serverAutoApiBase')?.value || getSnapshot()?.automation?.serverApiBase || '';
    contract.invoke('setApiBase', base);
    invokeAsync('refreshServer', base);
  });

  const bindMode = (mode, id) => {
    listen(disposers, one(root, `#serverSave${id}`), 'click', () => {
      invokeAsync('saveProfile', profile(root, mode, id, false, config));
    });
    listen(disposers, one(root, `#serverRun${id}`), 'click', () => {
      invokeAsync('runMode', profile(root, mode, id, undefined, config));
    });
    listen(disposers, one(root, `#serverAutoStart${id}`), 'click', () => {
      invokeAsync('setModeEnabled', profile(root, mode, id, true, config));
    });
    listen(disposers, one(root, `#serverAutoStop${id}`), 'click', () => {
      invokeAsync('setModeEnabled', profile(root, mode, id, false, config));
    });
    if (mode === 'image-cuts') {
      for (let index = 0; index < 10; index += 1) {
        for (const field of ['Label', 'Prompt']) {
          listen(disposers, one(root, `#serverCut${field}${id}_${index}`), 'input', event => {
            updateDraftCut(index, field.toLowerCase(), event.target.value);
          });
        }
      }
      listen(disposers, one(root, `#serverRecoverCuts${id}`), 'click', recoverDraftCuts);
    }
  };

  bindMode('image-cuts', 'ImageCuts');
  bindMode('detail-page', 'DetailPage');
  for (const node of all(root, '[data-auto-output-refresh]')) {
    listen(disposers, node, 'click', () => {
      invokeAsync('refreshOutput', node.dataset.autoOutputRefresh || 'image-cuts');
    });
  }
  for (const node of all(root, '[data-auto-output-preview]')) {
    listen(disposers, node, 'click', () => {
      const [mode, index] = String(node.dataset.autoOutputPreview || '').split(':');
      contract.invoke('openOutputPreview', { mode: mode || 'image-cuts', index: Number(index || 0) });
    });
  }
  listen(disposers, one(root, '#connectDriveBtn'), 'click', () => {
    invokeAsync('connectDrive', one(root, '#gdClientId')?.value || '');
  });
  for (const kind of ['input', 'output']) {
    const title = kind[0].toUpperCase() + kind.slice(1);
    listen(disposers, one(root, `#set${title}Folder`), 'click', () => {
      const raw = String(one(root, `#${kind}FolderId`)?.value || '').trim();
      if (raw) invokeAsync('setFolder', { kind, id: extractFolderId(raw) });
    });
  }
  const slider = one(root, '#intervalSlider');
  listen(disposers, slider, 'input', () => {
    const value = contract.invoke('setIntervalMinutes', slider.value);
    const display = one(root, '#intervalDisplay');
    if (display) display.textContent = `${value}분`;
  });
  listen(disposers, one(root, '#startAutoBtn'), 'click', () => contract.invoke('start'));
  listen(disposers, one(root, '#stopAutoBtn'), 'click', () => contract.invoke('stop'));
  listen(disposers, one(root, '#runOnceBtn'), 'click', () => contract.invoke('runOnce'));
  listen(disposers, one(root, '#resetProcessedBtn'), 'click', () => contract.invoke('resetProcessed'));

  return () => {
    while (disposers.length) disposers.pop()();
  };
}
