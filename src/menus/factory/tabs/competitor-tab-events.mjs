const CLICK_SELECTORS = Object.freeze([
  '[data-factory-guide-action]',
  '[data-comp-market-quick-action]',
  '[data-comp-market-toggle-result]',
  '[data-comp-market-source-view]',
  '[data-comp-market-use-url-id]',
  '[data-comp-market-toggle-image]',
  '[data-comp-market-preview-image]',
  '#compMarketCloseImagePreview',
  '#compMarketCloseImagePreviewFixed',
  '#compMarketAnalyzeSelectedImages',
  '#compMarketAnalyzeAllImages',
]);

function closestInside(root, target, selector) {
  if (!target || typeof target.closest !== 'function') return null;
  const node = target.closest(selector);
  if (!node) return null;
  return typeof root.contains !== 'function' || root.contains(node) ? node : null;
}

function isDisabled(node) {
  return Boolean(node?.disabled || node?.getAttribute?.('aria-disabled') === 'true');
}

function settle(result) {
  if (result && typeof result.catch === 'function') result.catch(() => undefined);
}

function stopEvent(event) {
  event.preventDefault?.();
  event.stopPropagation?.();
}

function marketPayload(node) {
  if (node.dataset?.compMarketQuickAction) {
    return { type: 'quick-action', action: String(node.dataset.compMarketQuickAction) };
  }
  if (node.dataset?.compMarketToggleResult) {
    return { type: 'toggle-candidate', candidateId: String(node.dataset.compMarketToggleResult) };
  }
  if (node.dataset?.compMarketSourceView) {
    return { type: 'source-view', source: String(node.dataset.compMarketSourceView) };
  }
  if (node.dataset?.compMarketUseUrlId) {
    return { type: 'use-candidate-url', candidateId: String(node.dataset.compMarketUseUrlId) };
  }
  if (node.dataset?.compMarketToggleImage) {
    return { type: 'toggle-image', imageId: String(node.dataset.compMarketToggleImage) };
  }
  if (node.dataset?.compMarketPreviewImage) {
    return { type: 'preview-image', imageId: String(node.dataset.compMarketPreviewImage) };
  }
  if (node.id === 'compMarketCloseImagePreview' || node.id === 'compMarketCloseImagePreviewFixed') {
    return { type: 'close-image-preview' };
  }
  if (node.id === 'compMarketAnalyzeSelectedImages') return { type: 'analyze-images', mode: 'selected' };
  if (node.id === 'compMarketAnalyzeAllImages') return { type: 'analyze-images', mode: 'all' };
  return null;
}

function clickHandler(root, invoke) {
  return event => {
    const guideNode = closestInside(root, event.target, '[data-factory-guide-action]');
    if (guideNode && !isDisabled(guideNode)) {
      stopEvent(event);
      settle(invoke('guideAction', String(guideNode.dataset?.factoryGuideAction || '')));
      return;
    }
    const node = CLICK_SELECTORS.slice(1)
      .map(selector => closestInside(root, event.target, selector))
      .find(Boolean);
    if (!node || isDisabled(node)) return;
    const payload = marketPayload(node);
    if (!payload) return;
    stopEvent(event);
    settle(invoke('marketAction', Object.freeze(payload)));
  };
}

function targetHandler(root, invoke) {
  return event => {
    const totalInput = closestInside(root, event.target, '[data-factory-comp-market-total-target]');
    const siteInput = closestInside(root, event.target, '[data-factory-comp-market-target]');
    const input = totalInput || siteInput;
    if (!input || isDisabled(input)) return;
    const payload = Object.freeze({
      type: 'candidate-target',
      scope: totalInput ? 'total' : 'site',
      siteId: siteInput ? String(siteInput.dataset?.factoryCompMarketTarget || '') : '',
      value: String(input.value ?? ''),
      commit: event.type === 'change',
    });
    settle(invoke('marketAction', payload));
  };
}

export function bindCompetitorTabEvents(root, invoke) {
  if (!root || typeof root.addEventListener !== 'function' || typeof root.removeEventListener !== 'function') {
    throw new TypeError('factory competitor root must support event listeners');
  }
  const listeners = [
    ['click', clickHandler(root, invoke)],
    ['input', targetHandler(root, invoke)],
    ['change', targetHandler(root, invoke)],
  ];
  for (const [type, listener] of listeners) root.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of listeners) root.removeEventListener(type, listener);
  };
}
