export function createSectionsA2Handlers({ closest, call }) {
  const onClick = event => {
    const plan = closest(event, '[data-section-generate-comp-plan]');
    if (plan) { event.preventDefault?.(); event.stopPropagation?.(); call('generateCompetitorPlan'); return true; }
    const openCompetitor = closest(event, '[data-section-open-competitor]');
    if (openCompetitor) { event.preventDefault?.(); event.stopPropagation?.(); call('openCompetitor'); return true; }
    const assemblySource = closest(event, '[data-section-assembly-source]');
    if (assemblySource) { event.stopPropagation?.(); return true; }
    const assemblyUsage = closest(event, '[data-section-assembly-cut-usage]');
    if (assemblyUsage) { event.stopPropagation?.(); return true; }
    const assemblyCut = closest(event, '[data-section-assembly-cut]');
    if (assemblyCut) { event.stopPropagation?.(); return true; }
    const assemblyNote = closest(event, '[data-section-assembly-note]');
    if (assemblyNote) { event.stopPropagation?.(); return true; }
    if (closest(event, '#autoSectionAssemblyCutsBtn')) { event.stopPropagation?.(); call('autoDistributeSectionAssemblyCuts'); return true; }
    if (closest(event, '#clearSectionAssemblyCutsBtn')) { event.stopPropagation?.(); call('clearSectionAssemblyCutUsage'); return true; }
    const helper = closest(event, '[data-apply-section-helper]');
    if (helper) { event.stopPropagation?.(); call('applySectionImageHelperTips', helper.dataset.applySectionHelper); return true; }
    if (closest(event, '[data-apply-all-section-helpers]')) { event.stopPropagation?.(); call('applyAllSectionImageHelperTips'); return true; }
    return false;
  };

  const onInput = event => {
    const assemblyNote = closest(event, '[data-section-assembly-note]');
    if (!assemblyNote) return false;
    event.stopPropagation?.();
    call('updateSectionAssemblyNote', { sectionId: assemblyNote.dataset.sectionAssemblyNote, note: assemblyNote.value || '' });
    return true;
  };

  const onChange = event => {
    const assemblySource = closest(event, '[data-section-assembly-source]');
    if (assemblySource) {
      event.stopPropagation?.();
      const [sectionId, sourceId] = String(assemblySource.dataset.sectionAssemblySource || '').split(':');
      if (sectionId && sourceId) call('updateSectionAssemblySource', { sectionId, sourceId, selected: !!assemblySource.checked });
      return true;
    }
    const assemblyUsage = closest(event, '[data-section-assembly-cut-usage]');
    if (assemblyUsage) {
      event.stopPropagation?.();
      const sectionId = String(assemblyUsage.dataset.sectionAssemblyCutUsage || '').trim();
      if (sectionId) call('updateSectionAssemblyCutUsage', { sectionId, cutUsage: assemblyUsage.value });
      return true;
    }
    const assemblyCut = closest(event, '[data-section-assembly-cut]');
    if (assemblyCut) {
      event.stopPropagation?.();
      const sectionId = String(assemblyCut.dataset.sectionAssemblyCut || '').trim();
      if (sectionId) call('updateSectionAssemblyCut', { sectionId, cutAssetKey: String(assemblyCut.value || '').trim() });
      return true;
    }
    return false;
  };

  return Object.freeze({ onClick, onInput, onChange });
}

export function bindSectionsSortable({ root, isCurrent, call, getSortable, sortableByRoot }) {
  const sortableRoot = root?.querySelector?.('#sectionSortable');
  const sortableApi = getSortable();
  if (!sortableRoot || typeof sortableApi?.create !== 'function') return;
  const sortable = sortableApi.create(sortableRoot, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onStart: () => { if (isCurrent()) call('beginSectionOrderChange'); },
    onEnd: () => {
      if (!isCurrent()) return;
      const ids = [...(sortableRoot.querySelectorAll?.('[data-section-id]') || [])]
        .map(node => String(node?.dataset?.sectionId || '').trim())
        .filter(Boolean);
      call('updateSectionOrder', ids);
    },
  });
  sortableByRoot.set(root, sortable);
}

export function bindSectionsLegacyFallback({ root, invoke }) {
  if (typeof root?.addEventListener === 'function') return [];
  const disposers = [];
  const legacySpecs = [
    ['#generateAll,#generateAll2', 'generateAll', ''],
    ['[data-route-target]', 'navigate', 'routeTarget'],
    ['[data-generate-section]', 'generateSection', 'generateSection'],
  ];
  for (const [selector, name, dataKey] of legacySpecs) {
    for (const node of root?.querySelectorAll?.(selector) || []) {
      const previous = node.onclick;
      const handler = event => { event?.preventDefault?.(); event?.stopPropagation?.(); invoke(name, dataKey ? node.dataset[dataKey] : undefined); };
      node.onclick = handler;
      disposers.push(() => { if (node.onclick === handler) node.onclick = previous || null; });
    }
  }
  return disposers;
}
