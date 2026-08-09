import {
  FACTORY_TAB_CONTRACT_VERSION,
  createFactoryTabContract,
} from '../factory-tab-contract.mjs';
import { bindCompetitorTabEvents } from './competitor-tab-events.mjs';
import { renderCompetitorFactoryTab } from './competitor-tab-view.mjs';

const RENDER_HELPERS = Object.freeze([
  'escapeHtml',
  'escAttr',
  'disabledAttr',
  'renderFactoryAutomationVmSearchInfo',
  'renderFactoryAutomationTaskChecklist',
  'renderFactoryAutomationStatusCard',
  'renderFactoryLightImage',
  'renderCompetitorAnalyzeLogItems',
  'renderCompMarketScrapePanel',
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(`${name} must be a function`);
  return source[name];
}

function runtimeCapabilities(capabilities, actions, renderHelpers) {
  return {
    getSnapshot: requiredFunction(capabilities, 'getSnapshot'),
    assertMutable: requiredFunction(capabilities, 'assertMutable'),
    getOperationToken: requiredFunction(capabilities, 'getOperationToken'),
    isOperationCurrent: requiredFunction(capabilities, 'isOperationCurrent'),
    reportError: requiredFunction(capabilities, 'reportError'),
    actions,
    renderHelpers,
  };
}

export function createCompetitorFactoryTab(capabilities = {}) {
  const actions = capabilities.actions || {};
  const renderHelpers = capabilities.renderHelpers || {};
  const runGuideAction = requiredFunction(actions, 'runGuideAction');
  const runMarketAction = requiredFunction(actions, 'runMarketAction');
  for (const name of RENDER_HELPERS) requiredFunction(renderHelpers, name);
  const runtime = runtimeCapabilities(capabilities, actions, renderHelpers);
  let contract;
  contract = createFactoryTabContract({
    version: FACTORY_TAB_CONTRACT_VERSION,
    id: 'factory/competitor',
    owner: 'competitors',
    capabilities: ['competitors:read', 'competitors:write'],
    commands: {
      guideAction: {
        capability: 'competitors:write',
        execute(action) {
          return runGuideAction(String(action || ''));
        },
      },
      marketAction: {
        capability: 'competitors:write',
        execute(payload) {
          return runMarketAction(payload);
        },
      },
    },
    select() {
      return runtime.getSnapshot();
    },
    render(snapshot) {
      return renderCompetitorFactoryTab(snapshot, renderHelpers);
    },
    bind(root) {
      return bindCompetitorTabEvents(root, (name, value) => {
        try {
          const result = contract.invoke(name, value);
          if (result && typeof result.catch === 'function') {
            return result.catch(error => {
              runtime.reportError(error);
              return undefined;
            });
          }
          return result;
        } catch (error) {
          runtime.reportError(error);
          return undefined;
        }
      });
    },
    onEnter() {},
    onLeave() {},
    persistence: { reads: ['competitors'], writes: ['competitors'] },
  }, runtime);
  return contract;
}
