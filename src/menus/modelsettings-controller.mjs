function withoutEmbeddedCredentials(config) {
  const copy = { ...(config || {}) };
  delete copy.openaiKey;
  delete copy.apiKey;
  delete copy.geminiKey;
  return copy;
}

export function createModelSettingsController(config) {
  const {
    providers,
    imageModels,
    normalizeConfig,
    assertMutable,
    updatePreferences,
    savePreferences,
    saveCredentials,
    loadVertexConfig,
    saveVertexConfig,
    updateVertexConfig,
    requestRender,
    getOperationToken,
    readSnapshot,
    invokeCapability,
  } = config;
  let active = false;
  let lifecycleGeneration = 0;

  function currentConfig() {
    return normalizeConfig(readSnapshot()?.modelConfig);
  }

  function updateModelConfig(patch) {
    const modelConfig = normalizeConfig({ ...currentConfig(), ...(patch || {}) });
    updatePreferences({ modelConfig });
    savePreferences({ modelConfig: withoutEmbeddedCredentials(modelConfig) });
    requestRender();
    return modelConfig;
  }

  function operationStamp() {
    return { generation: lifecycleGeneration, token: getOperationToken() };
  }

  function operationIsCurrent(stamp) {
    return active
      && stamp.generation === lifecycleGeneration
      && stamp.token === getOperationToken();
  }

  const commands = {
    selectProvider: {
      capability: 'settings:write',
      execute(providerId) {
        assertMutable();
        const provider = providers[String(providerId || '')];
        if (!provider) throw new Error('unknown model provider');
        const preferredOpenAI = providerId === 'openai'
          ? provider.models?.find(model => model.id === 'gpt-5.4-nano')
          : null;
        const llmModel = preferredOpenAI?.id || provider.models?.[0]?.id || '';
        return updateModelConfig({ llmProvider: providerId, llmModel });
      },
    },
    selectModel: {
      capability: 'settings:write',
      execute({ provider, modelId } = {}) {
        assertMutable();
        const providerId = String(provider || currentConfig().llmProvider || '');
        const allowed = providers[providerId]?.models || [];
        if (!allowed.some(model => model.id === modelId)) {
          throw new Error('선택한 프로바이더의 모델만 선택할 수 있습니다.');
        }
        return updateModelConfig({ llmProvider: providerId, llmModel: modelId });
      },
    },
    selectImageModel: {
      capability: 'settings:write',
      execute(modelId) {
        assertMutable();
        if (!imageModels.some(model => model.id === modelId)) throw new Error('unknown image model');
        return updateModelConfig({ imageModel: modelId });
      },
    },
    // ── 사용량 한도 폴백 ───────────────────────────────────────
    // 기본 실행 provider 는 그대로 두고, 한도로 막혔을 때만 쓸 대체 모델을 지정한다.
    selectFallbackProvider: {
      capability: 'settings:write',
      execute(providerId) {
        assertMutable();
        const id = String(providerId || '');
        if (id === 'none') {
          return updateModelConfig({ fallbackProvider: 'none', fallbackEnabled: false, fallbackModel: '' });
        }
        const provider = providers[id];
        if (!provider) throw new Error('unknown fallback provider');
        return updateModelConfig({
          fallbackProvider: id,
          fallbackEnabled: true,
          fallbackModel: provider.models?.[0]?.id || '',
        });
      },
    },
    selectFallbackModel: {
      capability: 'settings:write',
      execute(modelId) {
        assertMutable();
        const providerId = String(currentConfig().fallbackProvider || '');
        const allowed = providers[providerId]?.models || [];
        if (!allowed.some(model => model.id === modelId)) {
          throw new Error('선택한 폴백 프로바이더의 모델만 지정할 수 있습니다.');
        }
        return updateModelConfig({ fallbackModel: modelId, fallbackEnabled: true });
      },
    },
    setOllamaBaseUrl: {
      capability: 'settings:write',
      execute(value) {
        assertMutable();
        return updateModelConfig({ ollamaBaseUrl: String(value || '').trim() });
      },
    },
    setImageSizeMode: {
      capability: 'settings:write',
      execute(mode) {
        assertMutable();
        if (!['auto', 'custom'].includes(mode)) throw new Error('invalid image size mode');
        return updateModelConfig({ imageSizeMode: mode });
      },
    },
    saveSettings: {
      capability: 'settings:write',
      execute(input = {}) {
        assertMutable();
        const normalized = normalizeConfig(input.modelConfig || currentConfig());
        const payload = {
          modelConfig: withoutEmbeddedCredentials(normalized),
          backendBaseUrl: String(input.backendBaseUrl || '').trim(),
        };
        updatePreferences(payload);
        savePreferences(payload);
        saveCredentials({
          geminiKey: String(input.geminiKey || '').trim(),
          openaiKey: String(input.openaiKey || '').trim(),
        });
        requestRender();
        return payload;
      },
    },
    loadVertex: {
      capability: 'vertex:read',
      async execute() {
        assertMutable();
        const stamp = operationStamp();
        const value = await loadVertexConfig();
        if (!operationIsCurrent(stamp)) return { ignored: true, reason: 'stale-operation' };
        updateVertexConfig(value);
        requestRender();
        return value;
      },
    },
    saveVertex: {
      capability: 'vertex:write',
      async execute(value = {}) {
        assertMutable();
        const stamp = operationStamp();
        const saved = await saveVertexConfig(value);
        if (!operationIsCurrent(stamp)) return { ignored: true, reason: 'stale-operation' };
        if (saved?.ok !== false) updateVertexConfig(saved);
        requestRender();
        return saved;
      },
    },
    applyGptOAuthPreset: {
      capability: 'settings:write',
      execute(presetId) {
        assertMutable();
        return invokeCapability('applyGptOAuthPreset', presetId);
      },
    },
    selectGptOAuthModel: {
      capability: 'settings:write',
      execute(modelId) {
        assertMutable();
        return invokeCapability('selectGptOAuthModel', modelId);
      },
    },
    selectGptOAuthReasoning: {
      capability: 'settings:write',
      execute(reasoningEffort) {
        assertMutable();
        return invokeCapability('selectGptOAuthReasoning', reasoningEffort);
      },
    },
    selectGptOAuthServiceTier: {
      capability: 'settings:write',
      execute(serviceTier) {
        assertMutable();
        return invokeCapability('selectGptOAuthServiceTier', serviceTier);
      },
    },
    useGptOAuthAsLlm: {
      capability: 'settings:write',
      execute() {
        assertMutable();
        return invokeCapability('useGptOAuthAsLlm');
      },
    },
    refreshGptOAuthStatus: {
      capability: 'gpt-oauth:read',
      execute: () => invokeCapability('refreshGptOAuthStatus'),
    },
    probeGptOAuth: {
      capability: 'gpt-oauth:test',
      execute: () => invokeCapability('probeGptOAuth'),
    },
    openGptOAuthLogin: {
      capability: 'gpt-oauth:login',
      execute: force => invokeCapability('openGptOAuthLogin', force === true),
    },
  };

  return {
    commands,
    currentConfig,
    getBindingGeneration: () => lifecycleGeneration,
    isBindingCurrent: generation => active && lifecycleGeneration === generation,
    onEnter() {
      active = true;
      lifecycleGeneration += 1;
    },
    onLeave() {
      active = false;
      lifecycleGeneration += 1;
    },
  };
}
