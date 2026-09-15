export const AUTOMATION_DECISIONS = Object.freeze({
  sinhwa_db_product: '신화사 DB 제품 후보',
  cafe24_product: 'Cafe24 제품 후보',
  competitor_product: '경쟁사 선택',
  competitor_coupang: '경쟁사 · 쿠팡',
  competitor_smartstore: '경쟁사 · 스마트스토어',
  competitor_gmarket: '경쟁사 · G마켓',
  competitor_auction: '경쟁사 · 옥션',
  competitor_elevenst: '경쟁사 · 11번가',
  required_field_candidate: '필수값 후보·충돌',
  representative_image: '대표이미지 A컷',
  size_image: '사이즈이미지 A컷',
  option_image: '색상옵션 A컷',
  general_image: '이미지컷 A컷',
  section_variant: '섹션 변형 A컷',
  final_detail: '최종 상세페이지 A컷',
});

export function resolveInputPolicy(registry, request) {
  const ids = registry?.decisionPointIds;
  const base = registry?.presets?.[request.preset === 'custom' ? 'full_auto' : request.preset];
  if (!Array.isArray(ids) || !ids.length || !base) throw new Error('공정 설정을 불러오지 못했습니다. 설정 다시 읽기를 눌러 주세요.');
  const resolved = { ...base };
  for (const source of [request.batchOverride, request.productOverride, request.stageOverride]) {
    for (const [key, mode] of Object.entries(source || {})) {
      if (!ids.includes(key) || !['auto', 'manual'].includes(mode)) throw new Error('저장된 공정 설정을 확인해 주세요.');
      resolved[key] = mode;
    }
  }
  if (Object.keys(resolved).length !== ids.length || ids.some(id => !['auto', 'manual'].includes(resolved[id]))) {
    throw new Error('공정 설정 목록과 실행 규격이 다릅니다.');
  }
  return resolved;
}

export function setInputDecision(source, decision, mode, ids) {
  const next = { ...source };
  const targets = decision === 'competitor_product' ? ids.filter(id => id.startsWith('competitor_')) : [decision];
  for (const id of targets) {
    if (mode) next[id] = mode;
    else delete next[id];
  }
  return next;
}

export function assertInputPolicySnapshot(snapshot, request, expected) {
  if (snapshot?.locked !== true || snapshot.batchId !== request.batchId || snapshot.productId !== request.productId
    || Object.keys(snapshot.resolved || {}).length !== Object.keys(expected).length
    || Object.entries(expected).some(([id, mode]) => snapshot.resolved[id] !== mode)) {
    throw new Error('화면의 공정 설정과 잠긴 실행 설정이 달라 작업큐에 추가하지 않았습니다.');
  }
}

export function inputPolicySummary(resolved, format = 'full') {
  const manual = Object.entries(resolved).filter(([, mode]) => mode === 'manual').map(([id]) => AUTOMATION_DECISIONS[id] || id);
  if (format === 'row' && manual.length) return `직접 선택 ${manual.length}항목 · AI 판단 ${Object.values(resolved).filter(mode => mode === 'auto').length}항목`;
  return manual.length ? `직접 선택: ${manual.join(' · ')}` : '전 공정 AI 판단';
}

export function renderInputPolicyGrid({ registry, overrides, resolved, product = false, disabled = false, onChange }) {
  const root = document.createElement('div');
  root.className = 'bulk-policy-grid';
  const markets = document.createElement('details');
  markets.className = 'bulk-policy-markets';
  const summary = document.createElement('summary');
  summary.textContent = '경쟁사 마켓별 설정';
  markets.append(summary);
  for (const id of registry.decisionPointIds) {
    const label = document.createElement('label');
    label.className = 'bulk-policy-field';
    const title = document.createElement('span');
    title.textContent = AUTOMATION_DECISIONS[id] || id;
    const select = document.createElement('select');
    select.dataset[product ? 'productDecision' : 'commonDecision'] = id;
    select.setAttribute('aria-label', `${product ? '이 제품' : '공통'} ${title.textContent}`);
    select.append(new Option(product ? '공통 따르기' : '기본 방식 따르기', ''), new Option('AI 판단', 'auto'), new Option('직접 선택', 'manual'));
    select.value = overrides[id] || '';
    select.disabled = disabled;
    const effective = document.createElement('small');
    effective.textContent = `적용: ${resolved[id] === 'manual' ? '직접 선택' : 'AI 판단'}`;
    select.addEventListener('change', () => onChange(id, select.value));
    label.append(title, select, effective);
    if (id.startsWith('competitor_') && id !== 'competitor_product') markets.append(label);
    else root.append(label);
  }
  root.append(markets);
  return root;
}
