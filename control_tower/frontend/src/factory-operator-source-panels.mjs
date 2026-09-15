import { operatorElement as el, operatorField as field, operatorAction as action, operatorImage as image } from './factory-operator-controls.mjs?operator=3';

function candidateGroup(ctx, title, rows, tab, command, valueFor) {
  const section = el('section', '', 'operator-candidate-group');
  section.append(el('h4', `${title} · ${rows.length}개`));
  const grid = el('div', '', 'operator-choice-grid');
  for (const item of rows) {
    const card = el('article', '', 'operator-choice-card');
    card.dataset.selected = String(item.selected === true);
    card.append(image(ctx, item), el('strong', item.title || item.label || item.id));
    const values = item.values || {};
    for (const [key, label] of [['material', '소재'], ['size', '사이즈'], ['salePrice', '판매가']]) {
      if (values[key] !== undefined && values[key] !== '') card.append(el('p', `${label} · ${values[key]}`, 'status-message'));
    }
    const button = action(ctx, item.selected ? '선택됨 · 해제' : '이 후보 선택', tab, command, () => valueFor(item));
    button.dataset.candidateId = item.id;
    button.setAttribute('aria-pressed', String(item.selected === true));
    if (tab === 'db' && item.selected) { button.textContent = '확정됨'; button.disabled = true; }
    card.append(button);
    grid.append(card);
  }
  if (!rows.length) grid.append(el('p', '아직 후보가 없습니다. 위에서 수집을 실행하거나 후보 없음으로 진행하세요.', 'status-message'));
  section.append(grid);
  return section;
}

export function renderFactoryDbControls(root, ctx, data) {
  const query = field(ctx, 'db-query', 'DB 검색어', data.query || ctx.job.productName);
  const source = field(ctx, 'db-source', '검색 대상', 'all', [
    { id: 'all', label: '신화사DB + Cafe24' }, { id: 'db', label: '신화사DB' }, { id: 'cafe24', label: 'Cafe24' },
  ]);
  const controls = el('div', '', 'operator-inline-fields');
  controls.append(query.wrapper, source.wrapper, action(ctx, '후보 검색', 'db', 'search', () => ({ query: query.control.value, source: source.control.value })));
  root.append(controls, el('p', '검색어는 제품명을 바꾸지 않습니다. 사진과 값을 비교해 사용할 후보를 직접 확정하세요.', 'status-message'));
  const groups = el('div', '', 'operator-source-columns');
  for (const [kind, title, rows, none] of [
    ['db', '신화사DB', data.dbCandidates || [], data.dbNone],
    ['cafe24', 'Cafe24', data.cafe24Candidates || [], data.cafe24None],
  ]) {
    const section = candidateGroup(ctx, title, rows, 'db', `apply-${kind}-candidate`, item => ({ candidateIdentity: item.identity }));
    const bar = el('div', '', 'button-row');
    bar.append(
      action(ctx, none ? '후보 없음 확정됨' : '후보 없음으로 진행', 'db', `confirm-no-${kind}-candidate`, null),
      action(ctx, '확정 해제', 'db', `clear-${kind}-candidate`, null),
    );
    section.append(bar);
    groups.append(section);
  }
  root.append(groups);
}

export function renderFactoryCompetitorControls(root, ctx, data) {
  const keyword = field(ctx, 'competitor-query', '경쟁사 검색어', data.searchKeyword || ctx.job.productName);
  const runtime = field(ctx, 'competitor-runtime', '수집 위치', 'vm', [
    { id: 'vm', label: 'VM Chrome' }, { id: 'local', label: 'Windows Chrome' },
  ]);
  const site = field(ctx, 'competitor-site', '쇼핑몰', 'all', [
    { id: 'all', label: '선택한 쇼핑몰 전체' },
    { id: 'coupang', label: '쿠팡' }, { id: 'smartstore', label: '스마트스토어' },
    { id: 'gmarket', label: 'G마켓' }, { id: 'auction', label: '옥션' }, { id: 'elevenst', label: '11번가' },
  ]);
  const fields = el('div', '', 'operator-inline-fields');
  fields.append(keyword.wrapper, runtime.wrapper, site.wrapper,
    action(ctx, '경쟁사 후보 수집', 'competitor', 'guideAction', () => ({
      action: 'rerun-with-keyword', searchKeyword: keyword.control.value, runtime: runtime.control.value,
      ...(site.control.value !== 'all' ? { site: site.control.value } : {}),
    })));
  root.append(fields, candidateGroup(ctx, '상세수집할 상품 선택', data.candidates || [], 'competitor', 'marketAction', item => ({ type: 'toggle-candidate', candidateId: item.id })));
  root.append(action(ctx, '선택한 상품 상세수집', 'competitor', 'marketAction', () => ({ type: 'quick-action', action: runtime.control.value === 'vm' ? 'detail-vm' : 'detail-local' })));
  root.append(candidateGroup(ctx, '분석할 상세 이미지 선택', data.detailImages || [], 'competitor', 'marketAction', item => ({ type: 'toggle-image', imageId: item.id })));
  root.append(action(ctx, '선택 이미지 분석', 'competitor', 'marketAction', { type: 'analyze-images', mode: 'selected' }));
}

export function renderFactoryFieldControls(root, ctx, fields) {
  const details = el('details', '', 'operator-field-details');
  const openKey = `${ctx.job.jobId}:${ctx.projection.session.runId}:fields-open`;
  details.open = ctx.controller.draft(openKey, false) === true;
  details.addEventListener('toggle', () => ctx.controller.remember(openKey, details.open));
  details.append(el('summary', '조립공장 전체 필수값 · 개별 저장'));
  const grid = el('div', '', 'required-fields-grid');
  for (const item of fields) {
    const input = field(ctx, `field:${item.fieldId}`, item.label, item.value);
    input.wrapper.append(action(ctx, '이 값 저장', 'fields', 'commitField', () => ({ fieldId: item.fieldId, label: item.label, value: input.control.value })));
    grid.append(input.wrapper);
  }
  details.append(grid);
  root.append(details);
}
