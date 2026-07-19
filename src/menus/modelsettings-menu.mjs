import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

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

function withoutEmbeddedCredentials(config) {
  const copy = { ...(config || {}) };
  delete copy.openaiKey;
  delete copy.apiKey;
  delete copy.geminiKey;
  return copy;
}

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

export function createModelSettingsMenu(capabilities = {}) {
  const providers = requiredRecord(capabilities, 'providers');
  const imageModels = capabilities.imageModels;
  if (!Array.isArray(imageModels)) throw new TypeError('imageModels must be an array');

  const normalizeConfig = requiredFunction(capabilities, 'normalizeConfig');
  const getImageProvider = requiredFunction(capabilities, 'getImageProvider');
  const getRuntimeOpenAIKey = requiredFunction(capabilities, 'getRuntimeOpenAIKey');
  const renderGptOAuthPanel = requiredFunction(capabilities, 'renderGptOAuthPanel');
  const disabledAttr = requiredFunction(capabilities, 'disabledAttr');
  const isGptOAuthConnected = requiredFunction(capabilities, 'isGptOAuthConnected');
  const getReasoningLabel = requiredFunction(capabilities, 'getReasoningLabel');
  const getServiceTierLabel = requiredFunction(capabilities, 'getServiceTierLabel');
  const escapeHtml = requiredFunction(capabilities, 'escapeHtml');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const updatePreferences = requiredFunction(capabilities, 'updatePreferences');
  const savePreferences = requiredFunction(capabilities, 'savePreferences');
  const saveCredentials = requiredFunction(capabilities, 'saveCredentials');
  const loadVertexConfig = requiredFunction(capabilities, 'loadVertexConfig');
  const saveVertexConfig = requiredFunction(capabilities, 'saveVertexConfig');
  const updateVertexConfig = requiredFunction(capabilities, 'updateVertexConfig');
  const requestRender = requiredFunction(capabilities, 'requestRender');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const readSnapshot = typeof capabilities.getSnapshot === 'function'
    ? capabilities.getSnapshot
    : () => ({});
  const schedule = typeof capabilities.schedule === 'function'
    ? capabilities.schedule
    : callback => callback();
  const alertUser = typeof capabilities.alertUser === 'function'
    ? capabilities.alertUser
    : () => {};

  let active = false;
  let lifecycleGeneration = 0;
  let contract;

  function currentConfig() {
    return normalizeConfig(readSnapshot()?.modelConfig);
  }

  function updateModelConfig(patch) {
    const modelConfig = normalizeConfig({ ...currentConfig(), ...(patch || {}) });
    updatePreferences({ modelConfig });
    requestRender();
    return modelConfig;
  }

  function requireMutable() {
    assertMutable();
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
        requireMutable();
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
        requireMutable();
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
        requireMutable();
        if (!imageModels.some(model => model.id === modelId)) throw new Error('unknown image model');
        return updateModelConfig({ imageModel: modelId });
      },
    },
    setImageSizeMode: {
      capability: 'settings:write',
      execute(mode) {
        requireMutable();
        if (!['auto', 'custom'].includes(mode)) throw new Error('invalid image size mode');
        return updateModelConfig({ imageSizeMode: mode });
      },
    },
    saveSettings: {
      capability: 'settings:write',
      execute(input = {}) {
        requireMutable();
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
        requireMutable();
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
        requireMutable();
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
        requireMutable();
        return requiredFunction(capabilities, 'applyGptOAuthPreset')(presetId);
      },
    },
    selectGptOAuthModel: {
      capability: 'settings:write',
      execute(modelId) {
        requireMutable();
        return requiredFunction(capabilities, 'selectGptOAuthModel')(modelId);
      },
    },
    selectGptOAuthReasoning: {
      capability: 'settings:write',
      execute(reasoningEffort) {
        requireMutable();
        return requiredFunction(capabilities, 'selectGptOAuthReasoning')(reasoningEffort);
      },
    },
    selectGptOAuthServiceTier: {
      capability: 'settings:write',
      execute(serviceTier) {
        requireMutable();
        return requiredFunction(capabilities, 'selectGptOAuthServiceTier')(serviceTier);
      },
    },
    useGptOAuthAsLlm: {
      capability: 'settings:write',
      execute() {
        requireMutable();
        return requiredFunction(capabilities, 'useGptOAuthAsLlm')();
      },
    },
    refreshGptOAuthStatus: {
      capability: 'gpt-oauth:read',
      execute: () => requiredFunction(capabilities, 'refreshGptOAuthStatus')(),
    },
    probeGptOAuth: {
      capability: 'gpt-oauth:test',
      execute: () => requiredFunction(capabilities, 'probeGptOAuth')(),
    },
    openGptOAuthLogin: {
      capability: 'gpt-oauth:login',
      execute: force => requiredFunction(capabilities, 'openGptOAuthLogin')(force === true),
    },
  };

  function listen(disposers, node, type, listener) {
    if (!node?.addEventListener) return;
    node.addEventListener(type, listener);
    disposers.push(() => node.removeEventListener?.(type, listener));
  }

  function showTemporary(root, selector, message = '') {
    const node = eventNode(root, selector);
    if (!node) return;
    if (message) node.textContent = message;
    node.style.display = 'inline';
    schedule(() => { node.style.display = 'none'; }, 2500);
  }

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
    commands,
    render(view) {
      return renderModelSettingsView(view, {
        providers,
        imageModels,
        normalizeConfig,
        getImageProvider,
        getRuntimeOpenAIKey,
        renderGptOAuthPanel,
        disabledAttr,
        isGptOAuthConnected,
        getReasoningLabel,
        getServiceTierLabel,
        escapeHtml,
      });
    },
    bind(root) {
      const disposers = [];
      const bindingGeneration = lifecycleGeneration;
      const listenWhileCurrent = (node, type, listener) => {
        listen(disposers, node, type, event => {
          if (!active || lifecycleGeneration !== bindingGeneration) return;
          listener(event);
        });
      };
      for (const node of eventNodes(root, '[data-pick-provider]')) {
        listen(disposers, node, 'click', () => contract.invoke('selectProvider', node.dataset.pickProvider));
      }
      for (const node of eventNodes(root, '[data-pick-model]')) {
        listen(disposers, node, 'click', () => {
          const provider = readSnapshot()?.modelConfig?.llmProvider || currentConfig().llmProvider;
          try {
            contract.invoke('selectModel', { provider, modelId: node.dataset.pickModel });
          } catch (error) {
            capabilities.reportError?.(error);
            requestRender();
          }
        });
      }
      for (const node of eventNodes(root, '[data-pick-imgmodel]')) {
        listen(disposers, node, 'click', () => contract.invoke('selectImageModel', node.dataset.pickImgmodel));
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
        showTemporary(root, '#modelSaveMsg');
      });

      listen(disposers, eventNode(root, '#loadVertexConfigBtn'), 'click', () => {
        contract.invoke('loadVertex').catch(error => {
          showTemporary(root, '#vertexErrMsg', `불러오기 실패: ${error?.message || error}`);
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
            if (!result?.ignored && result?.ok !== false) showTemporary(root, '#vertexSaveMsg');
          })
          .catch(error => {
            showTemporary(root, '#vertexErrMsg', `저장 실패: ${error?.message || error}`);
          });
      });

      listenWhileCurrent(root, 'click', event => {
        const preset = delegatedTarget(root, event, '[data-gpt-oauth-preset]');
        if (preset) return void contract.invoke('applyGptOAuthPreset', preset.dataset.gptOauthPreset);
        if (delegatedTarget(root, event, '[id$="useGptOAuthAsLlmBtn"]')) {
          return void contract.invoke('useGptOAuthAsLlm', eventNode(root, '[id$="gptOAuthModelSelect"]')?.value || '');
        }
        if (delegatedTarget(root, event, '[id$="probeGptOAuthBtn"]')) return void contract.invoke('probeGptOAuth');
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
    },
    onEnter() {
      active = true;
      lifecycleGeneration += 1;
    },
    onLeave() {
      active = false;
      lifecycleGeneration += 1;
    },
    persistence: { reads: ['appPreferences'], writes: ['appPreferences'] },
  });

  return contract;
}

function renderModelSettingsView(view = {}, capabilities) {
  const {
    providers,
    imageModels,
    normalizeConfig,
    getImageProvider,
    getRuntimeOpenAIKey,
    renderGptOAuthPanel,
    disabledAttr,
    isGptOAuthConnected,
    getReasoningLabel,
    getServiceTierLabel,
    escapeHtml: escape,
  } = capabilities;
  const cfg = normalizeConfig(view.modelConfig);
  const runtimeOpenAIKey = getRuntimeOpenAIKey();
  const gptOAuthProv = providers.gpt_oauth;
  const geminiProv = providers.gemini;
  const openaiProv = providers.openai;
  const imageProvider = getImageProvider(cfg.imageModel);
  const needsOpenAIImageCreds = imageProvider === 'openai' && cfg.llmProvider !== 'openai';
  const needsGeminiImageCreds = imageProvider === 'gemini' && cfg.llmProvider !== 'gemini';

  const renderModelCard = (m, selectedId, colorClass) => {
    const sel = m.id === selectedId;
    const priceLine = (Number(m.inputPerM) === 0 && Number(m.outputPerM) === 0)
      ? 'ChatGPT 로그인 OAuth · API Hub 브리지'
      : `in $${m.inputPerM}/M · out $${m.outputPerM}/M`;
    return `<div class="model-card ${sel ? colorClass : ''}" data-pick-model="${m.id}">
      <div class="mc-label">${m.label}</div>
      <div class="mc-id">${m.id}</div>
      <div class="mc-desc">${m.desc}</div>
      <div class="mc-price">${priceLine}</div>
      ${sel ? '<div style="margin-top:6px;font-size:11px;color:var(--ok);font-weight:700">✔ 선택됨</div>' : ''}
    </div>`;
  };

  const renderImgModelCard = (m) => {
    const sel = m.id === cfg.imageModel;
    const provider = (m.provider || (m.id.startsWith('gpt-image') ? 'openai' : 'gemini')) === 'openai' ? 'OpenAI' : 'Gemini';
    const priceLine = m.imageOut
      ? `text in $${m.inputPerM}/M · text out $${m.outputPerM}/M · image out $${m.imageOut}/image`
      : `text in $${m.inputPerM}/M · image in $${m.imageInputPerM || m.inputPerM}/M · image out $${m.outputPerM}/M`;
    return `<div class="model-card ${sel ? 'selected' : ''}" data-pick-imgmodel="${m.id}">
      <div class="mc-label">${m.label}</div>
      <div class="mc-id">${provider} · ${m.id}</div>
      <div class="mc-desc">${m.desc}</div>
      <div class="mc-price">${priceLine}</div>
      ${sel ? '<div style="margin-top:6px;font-size:11px;color:var(--ok);font-weight:700">✔ 선택됨</div>' : ''}
    </div>`;
  };

  return `<div class="fade-in">
    <h1 class="page-title">⚙️ 모델 설정</h1>
    <p class="page-desc">텍스트와 이미지는 서로 다른 공급자를 섞어 쓸 수 있습니다. LLM은 OpenAI/Gemini, 이미지는 OpenAI GPT Image/Gemini 중에서 선택하세요.</p>

    <!-- ── LLM 프로바이더 선택 ── -->
    <div class="settings-section">
      <h3><span class="material-icons-outlined" style="font-size:18px;color:var(--primary)">psychology</span> LLM 프로바이더 (텍스트/분석)</h3>

      <div class="provider-tabs">
        <div class="provider-tab ${cfg.llmProvider==='gpt_oauth' ? 'active-openai' : ''}" data-pick-provider="gpt_oauth">
          <div class="pt-icon" style="color:#22c55e">◇</div>
          <div class="pt-label">ChatGPT 로그인 OAuth</div>
          <div class="pt-sub">API Hub · Codex 로그인 세션</div>
        </div>
        <div class="provider-tab ${cfg.llmProvider==='gemini' ? 'active-gemini' : ''}" data-pick-provider="gemini">
          <div class="pt-icon" style="color:#6366f1">✦</div>
          <div class="pt-label">Google Gemini</div>
          <div class="pt-sub">Vertex Backend URL 사용 (필수)</div>
        </div>
        <div class="provider-tab ${cfg.llmProvider==='openai' ? 'active-openai' : ''}" data-pick-provider="openai">
          <div class="pt-icon" style="color:#10a37f">◆</div>
          <div class="pt-label">OpenAI ChatGPT</div>
          <div class="pt-sub">OpenAI API Key 사용</div>
        </div>
      </div>

      ${cfg.llmProvider === 'gpt_oauth' ? `
      <p style="font-size:12px;color:var(--text-m);margin-bottom:10px">GPT OAuth는 OpenAI API Key가 아니라 ChatGPT 브라우저 로그인 세션을 API Hub로 호출합니다.</p>
      <div class="model-list">
        ${gptOAuthProv.models.map(m => renderModelCard(m, cfg.llmModel, 'selected-green')).join('')}
      </div>
      ${renderGptOAuthPanel({ prefix: 'settings', marginBottom: 0 })}
      ` : ''}

      <!-- Gemini LLM 모델 목록 -->
      ${cfg.llmProvider === 'gemini' ? `
      <p style="font-size:12px;color:var(--text-m);margin-bottom:10px">Gemini 텍스트 모델 선택</p>
      <div class="model-list">
        ${geminiProv.models.map(m => renderModelCard(m, cfg.llmModel, 'selected')).join('')}
      </div>
      <div class="input-group">
        <label class="label">Vertex Backend URL (권장)</label>
        <input type="text" class="input" id="geminiBackendInput" value="${view.backendBaseUrl || ''}" placeholder="http://localhost:5000" style="font-family:monospace;font-size:13px">
      </div>
      <div style="font-size:11px;color:var(--text-m);margin-top:6px">
        Vertex 전용 모드에서는 Gemini API Key를 사용하지 않습니다.
      </div>
      ` : ''}

      ${cfg.llmProvider === 'openai' ? `
      <!-- OpenAI LLM 모델 목록 -->
      <p style="font-size:12px;color:var(--text-m);margin-bottom:10px">OpenAI 모델 선택</p>
      <div class="model-list">
        ${openaiProv.models.map(m => renderModelCard(m, cfg.llmModel, 'selected-green')).join('')}
      </div>
      <div class="input-group">
        <label class="label">OpenAI API Key</label>
        <div style="position:relative">
          <input type="password" class="input" id="openaiKeyInput" value="${runtimeOpenAIKey}" placeholder="sk-..." style="font-family:monospace;font-size:13px;padding-right:40px">
          <span class="material-icons-outlined" id="toggleOpenAIKey" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;color:var(--text-m)">visibility</span>
        </div>
      </div>
      ` : ''}
    </div>

    <!-- ── 이미지 생성 모델 ── -->
    <div class="settings-section">
      <h3><span class="material-icons-outlined" style="font-size:18px;color:var(--orange)">image</span> 이미지 생성 모델</h3>
      <p style="font-size:12px;color:var(--text-m);margin-bottom:12px">섹션 이미지와 이미지컷 생성에 사용됩니다. OpenAI 모델은 OpenAI API Key, Gemini 모델은 Vertex Backend URL 또는 Gemini API Key가 필요합니다.</p>
      <div class="model-list">
        ${imageModels.map(m => renderImgModelCard(m)).join('')}
      </div>
      ${needsGeminiImageCreds ? `
      <div class="input-group" style="margin-top:4px">
        <label class="label">이미지 생성용 Vertex Backend URL (권장)</label>
        <input type="text" class="input" id="geminiBackendInput" value="${view.backendBaseUrl || ''}" placeholder="http://localhost:5000" style="font-family:monospace;font-size:13px;margin-bottom:8px">
        <label class="label">이미지 생성용 Gemini API Key (선택)</label>
        <div style="position:relative">
          <input type="password" class="input" id="geminiKeyInput" value="${view.apiKey}" placeholder="AIza..." style="font-family:monospace;font-size:13px;padding-right:40px">
          <span class="material-icons-outlined" id="toggleGeminiKey" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;color:var(--text-m)">visibility</span>
        </div>
      </div>
      ` : ''}
      ${needsOpenAIImageCreds ? `
      <div class="input-group" style="margin-top:4px">
        <label class="label">이미지 생성용 OpenAI API Key</label>
        <div style="position:relative">
          <input type="password" class="input" id="openaiKeyInput" value="${runtimeOpenAIKey}" placeholder="sk-..." style="font-family:monospace;font-size:13px;padding-right:40px">
          <span class="material-icons-outlined" id="toggleOpenAIKey" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:18px;color:var(--text-m)">visibility</span>
        </div>
      </div>
      ` : ''}
      ${!needsGeminiImageCreds && !needsOpenAIImageCreds ? `
      <div style="font-size:11px;color:var(--text-m);margin-top:8px">
        현재 선택된 이미지 모델은 위의 LLM 설정과 같은 공급자 인증 정보를 그대로 사용합니다.
      </div>
      ` : ''}
    </div>

    <!-- ── 이미지 크기(픽셀) 설정 ── -->
    <div class="settings-section">
      <h3><span class="material-icons-outlined" style="font-size:18px;color:var(--cyan)">photo_size_select_large</span> 이미지 출력 크기</h3>
      <p style="font-size:12px;color:var(--text-m);margin-bottom:14px">
        AI가 생성한 이미지를 지정한 픽셀로 <b>정확하게</b> 출력합니다. (Canvas 리사이즈 적용)<br>
        auto 모드는 AI가 자유롭게 크기를 결정합니다.
      </p>

      <!-- 모드 토글 -->
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="provider-tab ${cfg.imageSizeMode==='auto' ? 'active-gemini' : ''}"
          id="imgSizeModeAuto" style="flex:1;padding:10px">
          <div class="pt-icon" style="font-size:16px;color:var(--text-d)">🔄</div>
          <div class="pt-label" style="font-size:13px">auto</div>
          <div class="pt-sub">AI가 크기 자동 결정</div>
        </button>
        <button class="provider-tab ${cfg.imageSizeMode==='custom' ? 'active-gemini' : ''}"
          id="imgSizeModeCustom" style="flex:1;padding:10px">
          <div class="pt-icon" style="font-size:16px;color:var(--cyan)">📐</div>
          <div class="pt-label" style="font-size:13px">custom px</div>
          <div class="pt-sub">정확한 픽셀 지정</div>
        </button>
      </div>

      <!-- 픽셀 입력 (custom 모드에서만 활성화) -->
      <div ${cfg.imageSizeMode!=='custom' ? 'title="custom px 모드를 선택하면 직접 입력할 수 있습니다."' : ''} style="display:flex;gap:12px;align-items:flex-end;${cfg.imageSizeMode!=='custom'?'opacity:.4':''}">
        <div class="input-group" style="margin-bottom:0;flex:1">
          <label class="label">가로 (W) px</label>
          <input type="number" class="input" id="imgWidthInput"
            value="${cfg.imageWidth || 860}" min="64" max="4096" step="1"
            placeholder="860" style="font-family:monospace"
            ${disabledAttr(cfg.imageSizeMode!=='custom', 'custom px 모드를 선택하면 가로 픽셀을 직접 입력할 수 있습니다.')}>
        </div>
        <div style="padding-bottom:10px;color:var(--text-m);font-size:18px">×</div>
        <div class="input-group" style="margin-bottom:0;flex:1">
          <label class="label">세로 (H) px <span style="font-weight:400;color:var(--text-m)">(비워두면 비율 유지)</span></label>
          <input type="number" class="input" id="imgHeightInput"
            value="${cfg.imageHeight || ''}" min="64" max="4096" step="1"
            placeholder="비율 유지" style="font-family:monospace"
            ${disabledAttr(cfg.imageSizeMode!=='custom', 'custom px 모드를 선택하면 세로 픽셀을 직접 입력할 수 있습니다.')}>
        </div>
      </div>

      ${cfg.imageSizeMode === 'custom' ? `
      <div style="margin-top:10px;padding:8px 12px;background:rgba(6,182,212,.08);border:1px solid rgba(6,182,212,.2);border-radius:6px;font-size:12px;color:var(--cyan)">
        📐 설정됨: ${cfg.imageWidth}px × ${cfg.imageHeight ? cfg.imageHeight+'px' : '(비율 유지)'}
        — AI 생성 후 Canvas로 정확히 리사이즈됩니다
      </div>` : `
      <div style="margin-top:10px;padding:8px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--text-m)">
        🔄 auto 모드 — AI가 자유롭게 크기를 결정합니다
      </div>`}
    </div>

    <!-- ── 저장 버튼 ── -->
    <div style="display:flex;gap:12px;align-items:center">
      <button class="btn-primary" id="saveModelSettings">
        <span class="material-icons-outlined" style="font-size:18px">save</span>
        설정 저장
      </button>
      <div id="modelSaveMsg" style="font-size:13px;color:var(--ok);display:none">✅ 저장되었습니다!</div>
    </div>

    <!-- ── Vertex AI 설정 ── -->
    <div class="settings-section" style="margin-top:24px;border-color:var(--primary)">
      <h3><span class="material-icons-outlined" style="font-size:18px;color:var(--primary)">cloud</span> Vertex AI 연결 설정 (공용)</h3>
      <p style="font-size:12px;color:var(--text-d);margin-bottom:12px">한 번 저장하면 이미지 업로드 분석 + 자동화 탭 전체에 즉시 적용됩니다. Google Cloud 계정을 바꿀 때 여기서만 수정하면 됩니다.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div class="input-group">
          <label class="label">Google Cloud Project ID</label>
          <input class="input" id="vertexProjectInput" placeholder="project-xxxxxxxx-xxxx-xxxx-xxx" style="font-family:monospace;font-size:12px" value="${view.vertexConfig?.project || ''}">
        </div>
        <div class="input-group">
          <label class="label">리전 (Location)</label>
          <select class="input" id="vertexLocationInput" style="height:38px">
            ${['us-central1','us-east1','us-west1','europe-west1','europe-west4','asia-northeast1','asia-southeast1'].map(r =>
              `<option value="${r}" ${(view.vertexConfig?.location||'us-central1')===r?'selected':''}>${r}</option>`
            ).join('')}
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-sm" id="saveVertexConfigBtn" style="background:var(--primary);color:#fff;border:none">저장 (즉시 적용)</button>
        <button class="btn-sm" id="loadVertexConfigBtn">현재 설정 불러오기</button>
        <span id="vertexSaveMsg" style="font-size:12px;color:var(--ok);display:none">✅ 저장됨</span>
        <span id="vertexErrMsg" style="font-size:12px;color:var(--err);display:none"></span>
      </div>
    </div>

    <!-- ── 현재 설정 요약 ── -->
    <div style="margin-top:24px;padding:16px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;font-size:12px;line-height:2">
      <div style="font-weight:700;margin-bottom:8px;color:var(--text-d)">현재 설정 요약</div>
      <div>LLM 프로바이더: <b style="color:${cfg.llmProvider==='gpt_oauth'?'var(--ok)':(cfg.llmProvider==='openai'?'#10a37f':'var(--primary-h)')}">${providers[cfg.llmProvider]?.label}</b></div>
      <div>LLM 모델: <code style="background:var(--bg);padding:1px 6px;border-radius:4px;font-size:11px">${cfg.llmModel}</code></div>
      ${cfg.llmProvider === 'gpt_oauth' ? `<div>GPT OAuth: <b style="color:${isGptOAuthConnected()?'var(--ok)':'var(--warn)'}">${isGptOAuthConnected()?'연결됨':'확인 필요'}</b> · 추론 ${escape(getReasoningLabel(cfg.gptOAuthReasoningEffort))} · 속도 ${escape(getServiceTierLabel(cfg.gptOAuthServiceTier))}</div>` : ''}
      <div>이미지 모델: <code style="background:var(--bg);padding:1px 6px;border-radius:4px;font-size:11px">${cfg.imageModel}</code></div>
      <div>이미지 크기: <b style="color:var(--cyan)">${cfg.imageSizeMode === 'custom' ? (cfg.imageWidth + 'px × ' + (cfg.imageHeight ? cfg.imageHeight+'px' : '비율유지')) : 'auto'}</b></div>
      <div>Vertex Backend: <span style="color:${view.backendBaseUrl?'var(--ok)':'var(--text-m)'}">${view.backendBaseUrl ? view.backendBaseUrl : '— 미설정'}</span></div>
      <div>OpenAI Key: <span style="color:${runtimeOpenAIKey?'var(--ok)':'var(--text-m)'}">${runtimeOpenAIKey ? '✅ 설정됨' : '— 미설정'}</span></div>
    </div>
  </div>`;
}
