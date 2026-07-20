import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';
import { resolveModelSettingsCapabilities } from './modelsettings-config.mjs';
import { createModelSettingsController } from './modelsettings-controller.mjs';
import { bindModelSettingsEvents } from './modelsettings-bindings.mjs';
import { renderModelSettingsView } from './modelsettings-view.mjs';

export function createModelSettingsMenu(capabilities = {}) {
  const config = resolveModelSettingsCapabilities(capabilities);
  const controller = createModelSettingsController(config);
  let contract;

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'modelsettings',
    routes: ['modelsettings'],
    ownedSlices: ['appPreferences'],
    capabilities: ['settings:write', 'vertex:read', 'vertex:write', 'gpt-oauth:read', 'gpt-oauth:test', 'gpt-oauth:login'],
    select(rootState = {}) {
      const preferences = rootState.appPreferences || rootState;
      return {
        modelConfig: preferences.modelConfig || rootState.modelConfig || {},
        backendBaseUrl: preferences.backendBaseUrl ?? rootState.backendBaseUrl ?? '',
        apiKey: rootState.apiKey || '',
        vertexConfig: preferences.vertexConfig || rootState.vertexConfig || null,
      };
    },
    commands: controller.commands,
    render(view) {
      return renderModelSettingsView(view, config);
    },
    bind(root) {
      return bindModelSettingsEvents({ root, contract, controller, config });
    },
    onEnter: controller.onEnter,
    onLeave: controller.onLeave,
    persistence: { reads: ['appPreferences'], writes: ['appPreferences'] },
  });

  return contract;
}
