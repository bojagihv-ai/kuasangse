import { createAnalysisMenuController } from './analysis-controller.mjs';
import { bindAnalysisPanelEvents } from './analysis-panel-bindings.mjs';

export function createAnalysisMenu(capabilities = {}) {
  return createAnalysisMenuController(capabilities);
}

Object.defineProperty(createAnalysisMenu, 'bindAnalysisPanelEvents', { value: bindAnalysisPanelEvents });
