const EMPTY_OBJECT = Object.freeze({});

function helper(helpers, name) {
  const candidate = helpers?.[name];
  return typeof candidate === 'function' ? candidate : null;
}

function call(helpers, name, fallback, ...args) {
  const fn = helper(helpers, name);
  return fn ? fn(...args) : fallback;
}

function text(value) {
  return String(value ?? '');
}

function escapeHtml(value) {
  return text(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function disabledAttr(disabled, reason = '') {
  return disabled ? `disabled title="${escapeAttr(reason)}"` : '';
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : EMPTY_OBJECT;
}

function factoryFromView(view) {
  return objectOrEmpty(view?.factory || view);
}

function detailFromView(view) {
  return objectOrEmpty(view?.detailDocument || view?.detail || view);
}

function countsFromView(view, factory, helpers) {
  const provided = view?.factoryAutomation?.counts || view?.automation?.counts || view?.counts;
  if (provided && typeof provided === 'object' && !Array.isArray(provided)) return provided;
  const computed = call(helpers, 'factoryAutomationCounts', null, factory);
  return computed && typeof computed === 'object' && !Array.isArray(computed) ? computed : EMPTY_OBJECT;
}

function tasksFromView(view, factory, counts, helpers) {
  const provided = view?.factoryAutomation?.tasks || view?.automation?.tasks || view?.tasks;
  if (Array.isArray(provided)) return provided;
  const computed = call(helpers, 'factoryAutomationWizardTasks', [], factory, counts);
  return Array.isArray(computed) ? computed : [];
}

function settingsFrom(factory, helpers) {
  const fallback = {
    targetLabel: '카페24 등록 후 오픈마켓까지',
    displayLabel: '진열함',
    sellingLabel: '판매함',
    includeOpenMarket: false,
  };
  const value = call(helpers, 'factoryFinalRegistrationSettings', fallback, factory);
  return value && typeof value === 'object' ? value : fallback;
}

function statusCard(helpers, title, value, description, done) {
  return call(
    helpers,
    'renderFactoryAutomationStatusCard',
    `<div class="factory-automation-status-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(value)}</span><small>${escapeHtml(description)}</small></div>`,
    title,
    value,
    description,
    !!done,
  );
}

function checklist(helpers, tasks, tab) {
  return call(helpers, 'renderFactoryAutomationTaskChecklist', '', tasks, tab);
}

function finalPanel(helpers, factory, baseDraft, renderCache, cafe24Model) {
  const render = helper(helpers, 'renderFactoryFinalRegistrationPanel');
  if (!render) return '<div class="factory-small" style="color:var(--warn)">최종 등록 패널을 렌더할 수 없습니다.</div>';
  return render(factory, baseDraft, { renderCache, cafe24Model });
}

export function renderPublishFactoryTab(view, helpers = {}) {
  const factory = factoryFromView(view);
  const detail = detailFromView(view);
  const counts = countsFromView(view, factory, helpers);
  const tasks = tasksFromView(view, factory, counts, helpers);
  const openMarket = objectOrEmpty(factory.openMarketSync);
  const selectedChannels = Array.isArray(openMarket.selectedChannels) ? openMarket.selectedChannels.length : 0;
  const selectedChannelText = selectedChannels ? `${selectedChannels}개 채널 선택됨` : '선택된 마켓 채널 없음';
  const renderCache = view?.renderCache || view?.factoryRenderCache || null;
  const baseDraft = renderCache
    ? call(helpers, 'factoryRenderCacheBaseDraft', EMPTY_OBJECT, factory, renderCache)
    : call(helpers, 'factoryOpenMarketBuildBaseDraft', EMPTY_OBJECT, factory, { renderCache });
  const finalSettings = settingsFrom(factory, helpers);
  const cafe24Model = call(
    helpers,
    'factoryRenderCacheFinalCafe24Model',
    call(helpers, 'factoryFinalRegistrationCafe24Model', {
      canRun: false,
      label: 'Cafe24 확인 필요',
      reason: 'Cafe24 등록 모델을 아직 만들 수 없습니다.',
    }, factory, { renderCache }),
    factory,
    renderCache,
  ) || { canRun: false, label: 'Cafe24 확인 필요', reason: 'Cafe24 등록 모델을 아직 만들 수 없습니다.' };
  const requiredSections = call(helpers, 'orderedSections', [],);
  const requiredSectionIds = Array.isArray(requiredSections) ? requiredSections.map(section => section?.id).filter(Boolean) : [];
  const requiredSectionTotal = requiredSectionIds.length || Number(counts.totalSections) || Number(counts.generatedSections) || 0;
  const sectionContents = objectOrEmpty(detail.sectionContents || view?.sectionContents);
  const sectionImages = objectOrEmpty(detail.sectionImages || view?.sectionImages);
  const requiredGeneratedCount = requiredSectionIds.length
    ? requiredSectionIds.filter(id => !!(sectionContents[id] || sectionImages[id])).length
    : Number(counts.generatedSections) || 0;
  const partialSections = requiredSectionTotal ? requiredGeneratedCount > 0 && requiredGeneratedCount < requiredSectionTotal : false;
  const detailReadyCount = Number(counts.detailAssets) || requiredGeneratedCount || Number(counts.generatedSections) || 0;
  const detailStatusText = requiredSectionTotal
    ? `${requiredGeneratedCount}/${requiredSectionTotal}개 생성됨`
    : counts.detailAssets
      ? `${counts.detailAssets}개 자산`
      : `${counts.detailPlacementCount || 0}개 배치`;
  const openMarketReady = finalSettings.includeOpenMarket ? selectedChannels > 0 : true;
  const ready = detailReadyCount && openMarketReady && (counts.cafe24Selected || counts.confirmedDb) && cafe24Model.canRun;
  const readyLabel = ready ? (partialSections ? '경고 확인 후 가능' : '실행 가능') : '확인 필요';
  const readyHelp = partialSections
    ? '남은 섹션이 있어 실행 시 확인창에서 계속 진행할지 묻습니다.'
    : (cafe24Model.reason || '아래 최종 등록 실행 버튼으로 진행합니다.');
  const pieces = [
    { label: '상세페이지 조각', ok: !!detailReadyCount && !partialSections, text: partialSections ? `${detailStatusText} · 남은 섹션 있음` : detailStatusText },
    { label: 'Cafe24/DB 기준', ok: !!(counts.cafe24Selected || counts.confirmedDb), text: counts.cafe24Selected ? 'Cafe24 선택됨' : counts.confirmedDb ? 'DB 확정됨' : '대기' },
    { label: '등록 범위', ok: true, text: finalSettings.targetLabel },
    { label: 'Cafe24 상태', ok: true, text: `진열 ${finalSettings.displayLabel} · 판매 ${finalSettings.sellingLabel}` },
    { label: '마켓 채널', ok: openMarketReady, text: finalSettings.includeOpenMarket ? selectedChannelText : '오픈마켓 진행 안 함' },
    { label: '실행 조건', ok: !!cafe24Model.canRun, text: cafe24Model.reason || cafe24Model.label },
  ];
  const escape = helper(helpers, 'escapeHtml') || escapeHtml;
  const disable = helper(helpers, 'disabledAttr') || disabledAttr;
  return `<div class="factory-automation-grid">
    <div class="factory-automation-panel">
      <h4>7. 전송</h4>
      <p>최종 조각을 확인하고, Cafe24 등록 범위와 진열/판매 상태를 정한 뒤 마지막 버튼만 직접 누릅니다.</p>
      <div class="factory-automation-status-grid">
        ${statusCard(helpers, '상세페이지 조각', detailStatusText, partialSections ? '남은 섹션이 있어 최종 실행 시 확인창이 뜹니다.' : counts.generatedSections ? '현재 미리보기 섹션 생성 결과 기준입니다.' : '상세페이지 결과 또는 섹션 배치가 있어야 합니다.', detailReadyCount && !partialSections)}
        ${statusCard(helpers, 'Cafe24 상품/DB', counts.cafe24Selected ? 'Cafe24 선택됨' : counts.confirmedDb ? 'DB 확정됨' : '대기', '상품 등록/수정 기준입니다.', counts.cafe24Selected || counts.confirmedDb)}
        ${statusCard(helpers, '마켓 채널', finalSettings.includeOpenMarket ? `${selectedChannels}개` : '진행 안 함', '카페24만 등록을 고르면 마켓 채널은 필수가 아닙니다.', openMarketReady)}
        ${statusCard(helpers, '최종 등록 준비', readyLabel, readyHelp, ready)}
      </div>
      <div class="factory-automation-actions">
        <button class="btn-primary" data-factory-guide-action="focus-final-registration" ${disable(!detailReadyCount || !(counts.cafe24Selected || counts.confirmedDb), '상세페이지 조각과 Cafe24/DB 기준을 먼저 확인해주세요.')}>최종 등록 설정으로 이동</button>
        <button class="btn-sm" data-factory-guide-action="focus-stage-log">실행 상태 보기</button>
      </div>
      ${checklist(helpers, tasks, 'publish')}
    </div>
    <div class="factory-automation-panel">
      <h4>최종 등록 체크</h4>
      <p>아래 항목이 초록이면 바로 최종 등록 실행까지 갈 수 있습니다.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;margin-top:10px">
        ${pieces.map(piece => `<div style="border:1px solid ${piece.ok ? 'rgba(34,197,94,.38)' : 'rgba(245,158,11,.46)'};background:${piece.ok ? 'rgba(34,197,94,.08)' : 'rgba(245,158,11,.08)'};border-radius:10px;padding:9px 10px">
          <div style="font-size:11px;color:${piece.ok ? 'var(--ok)' : 'var(--warn)'};font-weight:950">${piece.ok ? '확인됨' : '확인 필요'} · ${escape(piece.label)}</div>
          <div style="font-size:13px;color:var(--text);font-weight:900;line-height:1.35;margin-top:4px">${escape(piece.text || '-')}</div>
        </div>`).join('')}
      </div>
      <div class="factory-stage-actions" style="margin-top:12px">
        <button class="btn-primary" data-factory-guide-action="focus-final-registration" ${disable(!ready, cafe24Model.reason || '최종 등록 조건을 확인해주세요.')}>최종 등록 설정으로 이동</button>
        <button class="btn-sm" data-factory-guide-action="focus-materials">DB 입력판 확인</button>
      </div>
    </div>
    <div class="factory-automation-panel" style="grid-column:1 / -1" id="factoryPublishInlineFinalPanel">
      <h4>최종 등록 실행</h4>
      <p>여기서 등록 범위와 Cafe24 진열/판매 상태를 정한 뒤 최종 등록을 실행합니다.</p>
      ${finalPanel(helpers, factory, baseDraft, renderCache, cafe24Model)}
    </div>
  </div>`;
}
