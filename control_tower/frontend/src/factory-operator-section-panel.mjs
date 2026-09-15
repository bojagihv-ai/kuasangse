import { operatorElement as el, operatorField as field, operatorAction as action, operatorImage as image } from './factory-operator-controls.mjs?operator=3';

export function renderFactorySectionControls(root, ctx, controls) {
  const sections = controls.sections || [];
  const options = controls.options || {};
  const panel = el('details', '', 'operator-section-settings');
  panel.append(el('summary', `섹션 구성·입력 편집 · ${sections.length}개 공정`));
  panel.append(el('p', '기존 조립공장의 섹션 순서와 기준을 사용합니다. 변경 저장과 이미지 생성은 별도 버튼입니다.', 'status-message'));
  for (const [index, section] of sections.entries()) {
    const card = el('details', '', 'operator-section-editor');
    card.dataset.sectionId = section.id;
    card.append(el('summary', `${String(index + 1).padStart(2, '0')} ${section.label || section.id} · ${section.enabled === false ? '사용 안 함' : '사용'}`));
    const bar = el('div', '', 'button-row');
    bar.append(action(ctx, section.enabled === false ? '섹션 사용' : '섹션 사용 안 함', 'sections', 'setSectionEnabled', { sectionId: section.id, enabled: section.enabled === false }));
    for (const [offset, label] of [[-1, '위로'], [1, '아래로']]) {
      const button = action(ctx, label, 'sections', 'updateSectionOrder', () => {
        const ids = sections.map(item => item.id);
        [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
        return ids;
      });
      button.disabled ||= index + offset < 0 || index + offset >= sections.length;
      bar.append(button);
    }
    card.append(bar);
    if (section.thumbnailUrl) card.append(image(ctx, { ...section, title: section.label }));
    const fields = el('div', '', 'operator-inline-fields');
    for (const [key, label, choices, command, valueKey] of [
      ['basisMode', '생성 기준', options.basisModes, 'setSectionBasisMode', 'basisId'],
      ['generationMode', '생성 방식', options.generationModes, 'setSectionGenerationMode', 'modeId'],
    ]) {
      if (!choices?.length) continue;
      const input = field(ctx, `${section.id}:${key}`, label, section[key], choices);
      input.wrapper.append(action(ctx, `${label} 저장`, 'sections', command, () => ({ sectionId: section.id, [valueKey]: input.control.value })));
      fields.append(input.wrapper);
    }
    card.append(fields);
    const instruction = field(ctx, `${section.id}:instruction`, '섹션 지시문', section.instruction, null, true);
    instruction.wrapper.append(action(ctx, '지시문 저장', 'sections', 'updateSectionInstruction', () => ({ sectionId: section.id, value: instruction.control.value })));
    card.append(instruction.wrapper);
    const assembly = section.assembly || {};
    const sources = el('div', '', 'button-row');
    for (const source of options.assemblySources || []) {
      const selected = assembly.sources?.[source.id] === true;
      const button = action(ctx, `${selected ? '포함' : '제외'} · ${source.label || source.name || source.id}`, 'sections', 'updateSectionAssemblySource', {
        sectionId: section.id, sourceId: source.id, selected: !selected,
      });
      button.setAttribute('aria-pressed', String(selected));
      sources.append(button);
    }
    card.append(el('h4', '기준 자료와 이미지컷 배치'), sources);
    const placement = el('div', '', 'operator-inline-fields');
    if (options.cutUsages?.length) {
      const use = field(ctx, `${section.id}:cutUsage`, '이미지컷 사용 방식', assembly.cutUsage, options.cutUsages);
      use.wrapper.append(action(ctx, '사용 방식 저장', 'sections', 'updateSectionAssemblyCutUsage', () => ({ sectionId: section.id, cutUsage: use.control.value })));
      placement.append(use.wrapper);
    }
    if (options.cutCandidates?.length) {
      const cut = field(ctx, `${section.id}:cut`, '배치할 이미지컷', assembly.cutAssetKey, [{ id: '', label: '선택 안 함' }, ...options.cutCandidates]);
      cut.wrapper.append(action(ctx, '배치 컷 저장', 'sections', 'updateSectionAssemblyCut', () => ({ sectionId: section.id, cutAssetKey: cut.control.value })));
      placement.append(cut.wrapper);
    }
    const note = field(ctx, `${section.id}:note`, '배치 지시', assembly.note, null, true);
    note.wrapper.append(action(ctx, '배치 지시 저장', 'sections', 'updateSectionAssemblyNote', () => ({ sectionId: section.id, note: note.control.value })));
    placement.append(note.wrapper);
    card.append(placement);
    const content = el('details');
    content.append(el('summary', '상세 문구 직접 수정'));
    const edits = new Map();
    for (const [key, label] of [
      ['headline', '제목'], ['subheadline', '보조 제목'], ['body_text', '본문'],
      ['cta_text', '행동 유도 문구'], ['layout_suggestion', '구성 지시'], ['extra_elements', '추가 요소 · 한 줄씩'],
    ]) {
      const current = section.content?.[key];
      const input = field(ctx, `${section.id}:content:${key}`, label, Array.isArray(current) ? current.join('\n') : current, null, true);
      edits.set(key, input.control);
      content.append(input.wrapper);
    }
    content.append(action(ctx, '상세 문구 저장', 'sections', 'saveManualSection', () => ({
      sectionId: section.id, content: Object.fromEntries([...edits].map(([key, control]) => [key, control.value])),
    })));
    card.append(content, action(ctx, '이 섹션 생성', 'sections', 'generateSection', { sectionId: section.id }));
    panel.append(card);
  }
  root.append(panel);
}
