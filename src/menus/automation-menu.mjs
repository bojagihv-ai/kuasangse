import {
  createAutomationContract,
  resolveAutomationCapabilities,
} from './automation-contract.mjs';
import { createAutomationController } from './automation-controller.mjs';
import { bindAutomationEvents } from './automation-bindings.mjs';
import { renderAutomationView } from './automation-view.mjs';

export function createAutomationMenu(capabilities = {}) {
  const config = resolveAutomationCapabilities(capabilities);
  const controller = createAutomationController(config);
  let contract;

  contract = createAutomationContract({
    getSnapshot: config.getSnapshot,
    commands: controller.commands,
    render: view => renderAutomationView(view, config),
    bind: root => bindAutomationEvents({ root, contract, controller, config }),
    onEnter: controller.onEnter,
    onLeave: controller.onLeave,
  });
  controller.attachContract(contract);

  return contract;
}
