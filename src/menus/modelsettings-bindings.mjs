function eventNodes(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

function eventNode(root, selector) {
  return root?.querySelector?.(selector) || null;
}

function delegatedTarget(root, event, selector) {
  const target = event?.target?.closest?.(selector);
  if (!target) return null;
  return typeof root?.contains !== 'function' || root.contains(target) ? target : null;
}

function listen(disposers, node, type, listener) {
  if (!node?.addEventListener) return;
  node.addEventListener(type, listener);
  disposers.push(() => node.removeEventListener?.(type, listener));
}

export function bindModelSettingsEvents({ root, contract, controller, config }) {
  const {
    readSnapshot,
    normalizeConfig,
    requestRender,
    schedule,
    alertUser,
    reportError,
  } = config;
  const disposers = [];
  const bindingGeneration = controller.getBindingGeneration();
  const listenWhileCurrent = (node, type, listener) => {
    listen(disposers, node, type, event => {
      if (!controller.isBindingCurrent(bindingGeneration)) return;
      listener(event);
    });
  };
  const showTemporary = (selector, message = '') => {
    const node = eventNode(root, selector);
    if (!node) return;
    if (message) node.textContent = message;
    node.style.display = 'inline';
    schedule(() => { node.style.display = 'none'; }, 2500);
  };

  for (const node of eventNodes(root, '[data-pick-provider]')) {
    listen(disposers, node, 'click', () => contract.invoke('selectProvider', node.dataset.pickProvider));
  }
  for (const node of eventNodes(root, '[data-pick-model]')) {
    listen(disposers, node, 'click', () => {
      const provider = readSnapshot()?.modelConfig?.llmProvider || controller.currentConfig().llmProvider;
      try {
        contract.invoke('selectModel', { provider, modelId: node.dataset.pickModel });
      } catch (error) {
        reportError?.(error);
        requestRender();
      }
    });
  }
  for (const node of eventNodes(root, '[data-pick-imgmodel]')) {
    listen(disposers, node, 'click', () => contract.invoke('selectImageModel', node.dataset.pickImgmodel));
  }
  // 사용량 한도 폴백 지정
  for (const node of eventNodes(root, '[data-pick-fallback-provider]')) {
    listen(disposers, node, 'click', () => {
      try {
        contract.invoke('selectFallbackProvider', node.dataset.pickFallbackProvider);
      } catch (error) {
        reportError?.(error);
        requestRender();
      }
    });
  }
  for (const node of eventNodes(root, '[data-pick-fallback-model]')) {
    listen(disposers, node, 'click', () => {
      try {
        contract.invoke('selectFallbackModel', node.dataset.pickFallbackModel);
      } catch (error) {
        reportError?.(error);
        requestRender();
      }
    });
  }
  const ollamaInput = eventNode(root, '#ollamaBaseUrlInput');
  if (ollamaInput) {
    listen(disposers, ollamaInput, 'change', () => {
      try {
        contract.invoke('setOllamaBaseUrl', ollamaInput.value);
      } catch (error) {
        reportError?.(error);
        requestRender();
      }
    });
  }

  const toggleSecret = (buttonSelector, inputSelector) => {
    const button = eventNode(root, buttonSelector);
    listen(disposers, button, 'click', () => {
      const input = eventNode(root, inputSelector);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      button.textContent = input.type === 'password' ? 'visibility' : 'visibility_off';
    });
  };
  toggleSecret('#toggleGeminiKey', '#geminiKeyInput');
  toggleSecret('#toggleOpenAIKey', '#openaiKeyInput');

  listen(disposers, eventNode(root, '#imgSizeModeAuto'), 'click', () => contract.invoke('setImageSizeMode', 'auto'));
  listen(disposers, eventNode(root, '#imgSizeModeCustom'), 'click', () => contract.invoke('setImageSizeMode', 'custom'));

  listen(disposers, eventNode(root, '#saveModelSettings'), 'click', () => {
    const snapshot = readSnapshot() || {};
    const widthInput = eventNode(root, '#imgWidthInput');
    const heightInput = eventNode(root, '#imgHeightInput');
    const imageWidth = Number.parseInt(widthInput?.value || '', 10);
    const imageHeight = Number.parseInt(heightInput?.value || '', 10);
    const modelConfig = normalizeConfig({
      ...(snapshot.modelConfig || {}),
      ...(Number.isFinite(imageWidth) && imageWidth >= 64 && imageWidth <= 4096 ? { imageWidth } : {}),
      imageHeight: !heightInput?.value?.trim()
        ? null
        : Math.max(64, Math.min(4096, Number.isFinite(imageHeight) ? imageHeight : 64)),
    });
    contract.invoke('saveSettings', {
      modelConfig,
      backendBaseUrl: eventNode(root, '#geminiBackendInput')?.value || snapshot.backendBaseUrl || '',
      geminiKey: eventNode(root, '#geminiKeyInput')?.value || '',
      openaiKey: eventNode(root, '#openaiKeyInput')?.value || '',
    });
    showTemporary('#modelSaveMsg');
  });

  listen(disposers, eventNode(root, '#loadVertexConfigBtn'), 'click', () => {
    contract.invoke('loadVertex').catch(error => {
      showTemporary('#vertexErrMsg', `불러오기 실패: ${error?.message || error}`);
    });
  });
  listen(disposers, eventNode(root, '#saveVertexConfigBtn'), 'click', () => {
    const project = String(eventNode(root, '#vertexProjectInput')?.value || '').trim();
    const location = eventNode(root, '#vertexLocationInput')?.value || 'us-central1';
    if (!project) {
      alertUser('Project ID를 입력하세요');
      return;
    }
    contract.invoke('saveVertex', { project, location })
      .then(result => {
        if (!result?.ignored && result?.ok !== false) showTemporary('#vertexSaveMsg');
      })
      .catch(error => {
        showTemporary('#vertexErrMsg', `저장 실패: ${error?.message || error}`);
      });
  });

  listenWhileCurrent(root, 'click', event => {
    const preset = delegatedTarget(root, event, '[data-gpt-oauth-preset]');
    if (preset) return void contract.invoke('applyGptOAuthPreset', preset.dataset.gptOauthPreset);
    if (delegatedTarget(root, event, '[id$="useGptOAuthAsLlmBtn"]')) {
      return void contract.invoke('useGptOAuthAsLlm', eventNode(root, '[id$="gptOAuthModelSelect"]')?.value || '');
    }
    if (delegatedTarget(root, event, '[id$="probeGptOAuthBtn"]')) return void contract.invoke('probeGptOAuth');
    if (delegatedTarget(root, event, '[id$="refreshClaudeOAuthStatusBtn"]')) return void contract.invoke('refreshClaudeOAuthStatus');
    if (delegatedTarget(root, event, '[id$="openClaudeOAuthLoginBtn"]')) return void contract.invoke('openClaudeOAuthLogin', false);
    if (delegatedTarget(root, event, '[id$="forceClaudeOAuthLoginBtn"]')) return void contract.invoke('openClaudeOAuthLogin', true);
    const effortNode = delegatedTarget(root, event, '[data-pick-claude-effort]');
    if (effortNode) return void contract.invoke('selectClaudeOAuthEffort', effortNode.dataset.pickClaudeEffort);
    if (delegatedTarget(root, event, '[id$="refreshGptOAuthStatusBtn"]')) return void contract.invoke('refreshGptOAuthStatus');
    if (delegatedTarget(root, event, '[id$="openGptOAuthLoginBtn"]')) return void contract.invoke('openGptOAuthLogin', false);
    if (delegatedTarget(root, event, '[id$="forceGptOAuthLoginBtn"]')) return void contract.invoke('openGptOAuthLogin', true);
  });
  listenWhileCurrent(root, 'change', event => {
    const model = delegatedTarget(root, event, '[id$="gptOAuthModelSelect"]');
    if (model) return void contract.invoke('selectGptOAuthModel', model.value);
    const reasoning = delegatedTarget(root, event, '[id$="gptOAuthReasoningSelect"]');
    if (reasoning) return void contract.invoke('selectGptOAuthReasoning', reasoning.value);
    const serviceTier = delegatedTarget(root, event, '[id$="gptOAuthServiceTierSelect"]');
    if (serviceTier) return void contract.invoke('selectGptOAuthServiceTier', serviceTier.value);
  });

  return () => {
    while (disposers.length) disposers.pop()();
  };
}
