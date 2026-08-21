// 사용량 한도 폴백 설정 섹션.
// 기본 실행 provider 는 그대로 두고, 한도로 거절될 때만 쓸 대체 모델을 지정한다.
// 로컬 Ollama 모델은 이미지 판독(vision)이 실측으로 확인된 것만 노출한다.

function renderFallbackModelCards(models, selectedId) {
  return models.map(model => `
    <div class="model-card ${selectedId === model.id ? 'selected-green' : ''}" data-pick-fallback-model="${model.id}">
      <div class="mc-name">${model.label}</div>
      <div class="mc-desc">${model.desc || ''}</div>
      <div class="mc-id">${model.id}</div>
    </div>`).join('');
}

export function renderFallbackSection(cfg, providers) {
  const primaryLabel = providers[cfg.llmProvider]?.label || cfg.llmProvider;
  const fallbackModels = providers[cfg.fallbackProvider]?.models || [];
  return `
    <div class="settings-section">
      <h3><span class="material-icons-outlined" style="font-size:18px;color:var(--warn)">swap_horiz</span> 사용량 한도 폴백</h3>
      <p style="font-size:12px;color:var(--text-m);margin-bottom:12px">
        기본 모델(<b>${primaryLabel}</b>)이 <b>사용량 한도</b>로 거절될 때만 아래 모델로 자동 전환해 한 번 더 시도합니다.
        전환되면 진행 로그에 어떤 모델로 넘어갔는지 남습니다.
        한도 외의 오류(키 없음·네트워크 등)는 전환하지 않고 그대로 실패로 보고합니다.
      </p>

      <div class="provider-tabs">
        <div class="provider-tab ${cfg.fallbackProvider === 'none' ? 'active-gemini' : ''}" data-pick-fallback-provider="none">
          <div class="pt-icon" style="color:var(--text-m)">—</div>
          <div class="pt-label">사용 안 함</div>
          <div class="pt-sub">한도 시 그대로 실패 보고</div>
        </div>
        <div class="provider-tab ${cfg.fallbackProvider === 'openai' ? 'active-openai' : ''}" data-pick-fallback-provider="openai">
          <div class="pt-icon" style="color:#10a37f">◆</div>
          <div class="pt-label">OpenAI API</div>
          <div class="pt-sub">충전 잔액 사용 · 유료</div>
        </div>
        <div class="provider-tab ${cfg.fallbackProvider === 'ollama' ? 'active-gemini' : ''}" data-pick-fallback-provider="ollama">
          <div class="pt-icon" style="color:#f59e0b">▣</div>
          <div class="pt-label">로컬 Ollama</div>
          <div class="pt-sub">무료 · 내 PC에서 실행</div>
        </div>
      </div>

      ${cfg.fallbackProvider !== 'none' ? `
      <p style="font-size:12px;color:var(--text-m);margin:10px 0">폴백 모델 선택 (이미지 판독이 되는 모델만 표시)</p>
      <div class="model-list">${renderFallbackModelCards(fallbackModels, cfg.fallbackModel)}</div>
      ` : ''}

      ${cfg.fallbackProvider === 'ollama' ? `
      <div class="input-group" style="margin-top:10px">
        <label class="label">Ollama 서버 주소</label>
        <input type="text" class="input" id="ollamaBaseUrlInput" value="${cfg.ollamaBaseUrl || ''}"
               placeholder="http://127.0.0.1:11434" style="font-family:monospace;font-size:13px">
      </div>
      <div style="font-size:11px;color:var(--text-m);margin-top:6px">
        로컬 모델은 이미지 <b>판독</b>만 가능하고 이미지 <b>생성</b>은 지원하지 않습니다.
        경쟁사 전체 분석은 27B급에서 3분 이상 걸릴 수 있고, Gemma4 e4b 는 더 빠른 대신 판독이 일반론으로 흐를 수 있습니다.
      </div>
      ` : ''}

      ${cfg.fallbackProvider === 'openai' ? `
      <div style="font-size:11px;color:var(--text-m);margin-top:8px">
        위 <b>LLM 프로바이더 → OpenAI ChatGPT</b>에 입력한 API Key를 그대로 사용합니다.
        키가 없으면 폴백이 실행되지 않고 그 사실을 한도 사유와 함께 보고합니다.
      </div>
      ` : ''}
    </div>`;
}
