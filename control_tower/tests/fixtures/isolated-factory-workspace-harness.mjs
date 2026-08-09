import { createFactoryStore } from '../../../src/modules/factory-store.mjs';

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

export function createIsolatedFactoryWorkspaceHarness(options = {}) {
  const workspaceName = requiredText(options.workspaceId, 'workspaceId');
  const workspaceId = `fixture:${workspaceName}`;
  const productKey = requiredText(options.productKey, 'productKey');
  const productName = requiredText(options.productName, 'productName');
  const runId = requiredText(options.runId, 'runId');
  const inputFingerprint = requiredText(options.inputFingerprint, 'inputFingerprint');
  if (!Array.isArray(options.candidates) || options.candidates.length < 2) {
    throw new TypeError('at least two candidates are required');
  }
  const assets = options.candidates.map(candidate => ({
    id: requiredText(candidate.id, 'candidate.id'),
    stageKey: requiredText(candidate.stageKey, 'candidate.stageKey'),
    thumbnailUrl: requiredText(candidate.thumbnailUrl, 'candidate.thumbnailUrl'),
    digest: requiredText(candidate.digest, 'candidate.digest'),
    productKey,
    runId,
    inputFingerprint,
  }));
  const store = createFactoryStore({
    workspaceId,
    revision: 0,
    initialSnapshot: {
      factory: {
        workspace: { id: workspaceId, name: productName },
        product: { productKey, productName, runId, inputFingerprint },
        assets,
      },
    },
  });
  return Object.freeze({
    schema: 'factory-workspace-integration-harness:v1',
    store,
    dispose: () => store.dispose(),
  });
}
