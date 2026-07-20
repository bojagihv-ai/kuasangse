import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

const REQUIRED_CAPABILITIES = Object.freeze([
  'getSnapshot', 'assertMutable', 'updateAutomation', 'persistAutomation',
  'refreshServer', 'applyServerSnapshot', 'pollServerStatus', 'applyServerStatus',
  'connectDrive', 'setFolder', 'saveProfile', 'runMode', 'applyRunResult',
  'setModeEnabled', 'refreshOutput', 'applyOutputResult', 'openOutputPreview',
  'startAutomation', 'stopAutomation', 'runOnce', 'resetProcessed', 'requestRender',
  'getOperationToken', 'setIntervalFn', 'clearIntervalFn', 'formatServerDriveMessage',
  'renderModeEditor', 'renderPlacementPanel', 'makeDefaultProfile', 'disabledAttr',
  'escapeHtml', 'escapeAttr',
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return source[name];
}

export function resolveAutomationCapabilities(capabilities = {}) {
  const resolved = Object.fromEntries(
    REQUIRED_CAPABILITIES.map(name => [name, requiredFunction(capabilities, name)]),
  );
  return {
    ...resolved,
    extractFolderId: typeof capabilities.extractFolderId === 'function'
      ? capabilities.extractFolderId
      : value => String(value || '').trim(),
    parsePositiveInt: typeof capabilities.parsePositiveInt === 'function'
      ? capabilities.parsePositiveInt
      : (value, fallback, min, max) => Math.max(min, Math.min(max, Number.parseInt(value, 10) || fallback)),
    getDraftCuts: typeof capabilities.getDraftCuts === 'function' ? capabilities.getDraftCuts : () => [],
    updateDraftCut: typeof capabilities.updateDraftCut === 'function' ? capabilities.updateDraftCut : () => {},
    recoverDraftCuts: typeof capabilities.recoverDraftCuts === 'function' ? capabilities.recoverDraftCuts : () => {},
    reportError: typeof capabilities.reportError === 'function' ? capabilities.reportError : () => {},
  };
}

export function createAutomationContract({ getSnapshot, commands, render, bind, onEnter, onLeave }) {
  return createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'automation',
    routes: ['automation'],
    ownedSlices: ['automation'],
    capabilities: ['automation:read', 'automation:write'],
    select(root = {}) {
      const snapshot = getSnapshot() || {};
      return {
        automation: root.automation || root.auto || snapshot.automation || {},
        savedClientId: root.savedClientId || root.auto?.gdClientId || snapshot.savedClientId || '',
        logs: root.logs || root.autoLogs || snapshot.logs || [],
      };
    },
    commands,
    render,
    bind,
    onEnter,
    onLeave,
    persistence: { reads: ['automation'], writes: ['automation'] },
  });
}
