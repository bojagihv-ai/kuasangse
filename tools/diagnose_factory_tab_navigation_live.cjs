const {
  connectCdp,
  evaluate,
  fetchJson,
} = require('./factory_cdp_test_utils.cjs');

const CDP_URL = process.env.KUASANGSE_CDP_URL || 'http://127.0.0.1:9229';
const APP_URL = process.env.KUASANGSE_APP_URL || 'http://127.0.0.1:8081/app.html';

async function main() {
  const targets = await fetchJson(`${CDP_URL}/json`);
  const target = targets.find(item => item.type === 'page' && item.url === APP_URL);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`정상 앱 CDP target을 찾지 못했습니다: ${APP_URL}`);
  }

  const cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('DOMDebugger.enable').catch(() => {});

  try {
    const before = await evaluate(cdp, `(() => {
      const root = document.querySelector('#factoryAutomationWizard');
      const container = root?.closest('.container');
      const button = document.querySelector('[data-factory-auto-tab="start"]');
      const rect = button?.getBoundingClientRect?.();
      const hit = rect
        ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : null;
      const authority = typeof currentWorkspaceAuthority === 'function'
        ? currentWorkspaceAuthority()
        : null;
      return {
        activeTab: factoryRuntimeReadFactory().automation?.activeTab || '',
        activeButton: document.querySelector('[data-factory-auto-tab].active')?.dataset.factoryAutoTab || '',
        authority: authority ? {
          mode: authority.mode || '',
          scopeId: authority.scopeId || '',
          ownerId: authority.ownerId || '',
          sessionId: authority.sessionId || '',
        } : null,
        readOnly: typeof workspaceAuthorityIsReadOnly === 'function'
          ? workspaceAuthorityIsReadOnly()
          : null,
        containerInert: !!container?.inert,
        containerInertAttribute: container?.hasAttribute?.('inert') || false,
        rootConnected: !!root?.isConnected,
        buttonConnected: !!button?.isConnected,
        buttonDisabled: !!button?.disabled,
        buttonRect: rect ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        } : null,
        hitTag: hit?.tagName || '',
        hitTab: hit?.closest?.('[data-factory-auto-tab]')?.dataset?.factoryAutoTab || '',
        stateError: typeof state === 'object' && state ? state.error || '' : '',
      };
    })()`);

    const rootObject = await cdp.send('Runtime.evaluate', {
      expression: `document.querySelector('#factoryAutomationWizard')?.closest('.container') || null`,
      returnByValue: false,
    });
    const listeners = rootObject.result?.objectId
      ? await cdp.send('DOMDebugger.getEventListeners', { objectId: rootObject.result.objectId })
      : { listeners: [] };

    const directClick = await evaluate(cdp, `(async () => {
      const button = document.querySelector('[data-factory-auto-tab="start"]');
      if (!button) return { clicked: false };
      button.click();
      await new Promise(resolve => setTimeout(resolve, 750));
      return {
        clicked: true,
        activeTab: factoryRuntimeReadFactory().automation?.activeTab || '',
        activeButton: document.querySelector('[data-factory-auto-tab].active')?.dataset.factoryAutoTab || '',
        stateError: typeof state === 'object' && state ? state.error || '' : '',
      };
    })()`);

    let directInvoke;
    try {
      directInvoke = await evaluate(cdp, `(async () => {
        const menu = runtimeMenuModules.get('factory');
        try {
          const result = await menu.invoke('selectTab', 'factory/start');
          await new Promise(resolve => setTimeout(resolve, 400));
          return {
            ok: true,
            result: result?.value || result || null,
            activeTab: factoryRuntimeReadFactory().automation?.activeTab || '',
            stateError: state.error || '',
          };
        } catch (error) {
          return {
            ok: false,
            name: error?.name || '',
            code: error?.code || '',
            message: error?.message || String(error),
            activeTab: factoryRuntimeReadFactory().automation?.activeTab || '',
            stateError: state.error || '',
          };
        }
      })()`);
    } catch (error) {
      directInvoke = { transportError: error.message };
    }

    process.stdout.write(`${JSON.stringify({
      target: { id: target.id, title: target.title, url: target.url },
      before,
      rootListeners: (listeners.listeners || []).map(listener => ({
        type: listener.type,
        useCapture: listener.useCapture,
        passive: listener.passive,
        scriptId: listener.scriptId,
        lineNumber: listener.lineNumber,
        columnNumber: listener.columnNumber,
      })),
      directClick,
      directInvoke,
    }, null, 2)}\n`);
  } finally {
    await cdp.close();
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
