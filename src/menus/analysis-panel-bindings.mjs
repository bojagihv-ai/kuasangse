const BRAND_PRESET_FIELDS = Object.freeze([
  ['#brandPresetName', 'name'],
  ['#brandPresetTone', 'tone'],
  ['#brandPresetKeywords', 'requiredKeywords'],
  ['#brandPresetBanned', 'bannedPhrases'],
  ['#brandPresetHeadlineFont', 'headlineFont'],
  ['#brandPresetBodyFont', 'bodyFont'],
  ['#brandPresetAccent', 'accentColor'],
  ['#brandPresetBackground', 'backgroundColor'],
  ['#brandPresetImageDirectives', 'imageDirectives'],
  ['#brandPresetGlobalInstruction', 'globalInstruction'],
]);

const ANALYSIS_PANEL_BUTTONS = Object.freeze([
  ['#analysisLogToggle', 'toggleAnalysisLog'],
  ['#toggleRawJson', 'toggleRawJson'],
  ['#newBrandPresetBtn', 'createBrandPreset'],
  ['#saveBrandPresetBtn', 'saveBrandPreset'],
  ['#deleteBrandPresetBtn', 'deleteBrandPreset'],
]);

const analysisPanelBindings = new WeakMap();

function panelNode(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function panelListen(disposers, root, selector, type, listener) {
  const node = panelNode(root, selector);
  if (!node?.addEventListener) return;
  node.addEventListener(type, listener);
  disposers.push(() => node.removeEventListener?.(type, listener));
}

/**
 * Bind the analysis/log and brand-preset controls that are rendered inside the
 * sections view. The owner remains this analysis module, while the caller
 * supplies the route-fenced action dispatcher.
 */
export function bindAnalysisPanelEvents(root, dispatch, normalizeColor = value => value) {
  if (typeof dispatch !== 'function') throw new TypeError('analysis panel dispatch must be a function');
  if (!root || typeof root.querySelector !== 'function') return () => {};
  analysisPanelBindings.get(root)?.();

  const disposers = [];
  const call = (name, value) => dispatch(name, value);
  for (const [selector, action] of ANALYSIS_PANEL_BUTTONS) {
    panelListen(disposers, root, selector, 'click', event => {
      event?.preventDefault?.();
      call(action);
    });
  }
  panelListen(disposers, root, '#brandPresetSelect', 'change', event => {
    call('selectBrandPreset', event?.target?.value || '');
  });
  panelListen(disposers, root, '#layoutTemplateSelect', 'change', event => {
    call('selectLayoutTemplate', event?.target?.value || '');
  });
  for (const [selector, field] of BRAND_PRESET_FIELDS) {
    panelListen(disposers, root, selector, 'input', event => {
      call('updateBrandPresetDraft', { field, value: event?.target?.value || '' });
    });
  }

  const bindColorPair = (field, textSelector, pickerSelector) => {
    panelListen(disposers, root, pickerSelector, 'input', event => {
      const value = event?.target?.value || '';
      const textInput = panelNode(root, textSelector);
      if (textInput) textInput.value = value;
      call('updateBrandPresetDraft', { field, value });
    });
    panelListen(disposers, root, textSelector, 'blur', event => {
      const value = String(event?.target?.value || '');
      const normalized = normalizeColor(value);
      if (!normalized) return;
      const picker = panelNode(root, pickerSelector);
      if (picker) picker.value = normalized;
      if (event?.target) event.target.value = normalized;
      call('updateBrandPresetDraft', { field, value: normalized });
    });
  };
  bindColorPair('accentColor', '#brandPresetAccent', '#brandPresetAccentPicker');
  bindColorPair('backgroundColor', '#brandPresetBackground', '#brandPresetBackgroundPicker');

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    while (disposers.length) disposers.pop()();
    if (analysisPanelBindings.get(root) === dispose) analysisPanelBindings.delete(root);
  };
  analysisPanelBindings.set(root, dispose);
  return dispose;
}
