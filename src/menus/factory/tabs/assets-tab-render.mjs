const EMPTY_COUNTS = Object.freeze({
  heroSelected: 0, heroAssets: 0, sizeSelected: 0, sizeAssets: 0,
  optionSelected: 0, optionAssets: 0, cutSelected: 0, cutAssets: 0,
});

function plainCounts(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...EMPTY_COUNTS, ...value }
    : EMPTY_COUNTS;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function renderFactoryAutomationAssetsWizard(factory, counts, tasks, helpers) {
  const auto = factory.automation || {};
  const items = [
    { stage: 'hero', title: '대표이미지', ready: counts.heroSelected > 0, count: `${counts.heroSelected}/${counts.heroAssets}`, desc: 'Cafe24/오픈마켓 메인 썸네일용입니다. 상세페이지 섹션에는 자동 배치하지 않습니다.', required: true },
    { stage: 'size', title: '사이즈이미지', ready: counts.sizeSelected > 0, count: `${counts.sizeSelected}/${counts.sizeAssets}`, desc: '상세스펙/사이즈 섹션에 고정 배치됩니다.', required: true },
    { stage: 'options', title: '색상옵션', ready: auto.optionMode === 'none' || counts.optionSelected > 0 || counts.optionAssets > 0, count: auto.optionMode === 'none' ? '안 씀' : `${counts.optionSelected}/${counts.optionAssets}`, desc: auto.optionMode === 'none' ? '색상옵션 섹션을 빼는 기준입니다.' : '선택한 경우 옵션 섹션에 고정 배치됩니다.', required: auto.optionMode !== 'none' },
    { stage: 'cuts', title: '이미지컷', ready: counts.cutSelected > 0, count: `${counts.cutSelected}/${counts.cutAssets}`, desc: '섹션 사이에 넣거나 프롬프트에 녹일 컷입니다.', required: true },
  ];
  const next = items.find(item => item.required && !item.ready);
  return `<div>
    <div class="factory-card" style="margin-bottom:12px;border-color:${next ? 'rgba(245,158,11,.45)' : 'rgba(34,197,94,.40)'};background:${next ? 'rgba(245,158,11,.08)' : 'rgba(16,185,129,.08)'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="min-width:240px;flex:1">
          <div style="font-size:13px;font-weight:950;color:${next ? 'var(--warn)' : 'var(--ok)'}">${next ? `다음 선택: ${next.title}` : '생성컷 선택 준비 완료'}</div>
          <div class="factory-small" style="margin-top:5px;color:var(--text)">${next ? next.desc : '대표이미지, 사이즈이미지, 이미지컷 기준 선택이 잡혔습니다. 이제 섹션 배치로 넘어가면 됩니다.'}</div>
        </div>
        <button class="btn-primary" data-factory-guide-action="${next ? `focus-asset-stage:${next.stage}` : 'go-tab:sections'}">${next ? `${next.title} 고르기` : '섹션 생성으로 이동'}</button>
      </div>
      <div class="factory-automation-status-grid" style="margin-top:10px">
        ${items.map(item => helpers.renderFactoryAutomationStatusCard(item.title, item.ready ? '선택됨' : (item.required ? '선택 필요' : '건너뜀'), `${item.count} · ${item.desc}`, !!item.ready)).join('')}
      </div>
    </div>
    <div class="factory-automation-grid">
      ${helpers.renderFactoryAutomationAssetChooser(factory, 'hero', '대표이미지', '대표/목록용으로 쓸 컷을 고릅니다.')}
      ${helpers.renderFactoryAutomationAssetChooser(factory, 'size', '사이즈이미지', '확정 DB 사이즈값으로 생성한 컷을 고릅니다.')}
      ${helpers.renderFactoryAutomationAssetChooser(factory, 'options', '색상옵션', '옵션분류기 결과 또는 옵션 없음 기준을 확인합니다.')}
      ${helpers.renderFactoryAutomationAssetChooser(factory, 'cuts', '이미지컷', '섹션 사이에 배치할 이미지컷을 고릅니다.')}
    </div>
    <div class="factory-card" style="margin-top:12px">
      ${helpers.renderFactoryAutomationTaskChecklist(tasks, 'assets')}
    </div>
  </div>`;
}

export function renderAssetsTab(factory, helpers) {
  const counts = plainCounts(helpers.factoryAutomationCounts(factory));
  const tasks = list(helpers.factoryAutomationWizardTasks(factory, counts));
  return renderFactoryAutomationAssetsWizard(factory, counts, tasks, helpers);
}
