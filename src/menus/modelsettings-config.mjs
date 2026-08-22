function requiredFunction(capabilities, name) {
  const value = capabilities?.[name];
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function requiredRecord(capabilities, name) {
  const value = capabilities?.[name];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

export function resolveModelSettingsCapabilities(capabilities = {}) {
  const providers = requiredRecord(capabilities, 'providers');
  const imageModels = capabilities.imageModels;
  if (!Array.isArray(imageModels)) throw new TypeError('imageModels must be an array');

  return {
    providers,
    imageModels,
    normalizeConfig: requiredFunction(capabilities, 'normalizeConfig'),
    getImageProvider: requiredFunction(capabilities, 'getImageProvider'),
    getRuntimeOpenAIKey: requiredFunction(capabilities, 'getRuntimeOpenAIKey'),
    renderGptOAuthPanel: requiredFunction(capabilities, 'renderGptOAuthPanel'),
    refreshClaudeOAuthStatus: requiredFunction(capabilities, 'refreshClaudeOAuthStatus'),
    openClaudeOAuthLogin: requiredFunction(capabilities, 'openClaudeOAuthLogin'),
    disabledAttr: requiredFunction(capabilities, 'disabledAttr'),
    isGptOAuthConnected: requiredFunction(capabilities, 'isGptOAuthConnected'),
    getReasoningLabel: requiredFunction(capabilities, 'getReasoningLabel'),
    getServiceTierLabel: requiredFunction(capabilities, 'getServiceTierLabel'),
    escapeHtml: requiredFunction(capabilities, 'escapeHtml'),
    assertMutable: requiredFunction(capabilities, 'assertMutable'),
    updatePreferences: requiredFunction(capabilities, 'updatePreferences'),
    savePreferences: requiredFunction(capabilities, 'savePreferences'),
    saveCredentials: requiredFunction(capabilities, 'saveCredentials'),
    loadVertexConfig: requiredFunction(capabilities, 'loadVertexConfig'),
    saveVertexConfig: requiredFunction(capabilities, 'saveVertexConfig'),
    updateVertexConfig: requiredFunction(capabilities, 'updateVertexConfig'),
    requestRender: requiredFunction(capabilities, 'requestRender'),
    getOperationToken: requiredFunction(capabilities, 'getOperationToken'),
    readSnapshot: typeof capabilities.getSnapshot === 'function'
      ? capabilities.getSnapshot
      : () => ({}),
    schedule: typeof capabilities.schedule === 'function'
      ? capabilities.schedule
      : callback => callback(),
    alertUser: typeof capabilities.alertUser === 'function'
      ? capabilities.alertUser
      : () => {},
    reportError(error) {
      capabilities.reportError?.(error);
    },
    invokeCapability(name, ...args) {
      return requiredFunction(capabilities, name)(...args);
    },
  };
}
