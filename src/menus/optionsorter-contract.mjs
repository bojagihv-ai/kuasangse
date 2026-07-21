import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

export const OPTION_SORTER_RENDER_HELPERS = Object.freeze([
  'ensureOptionSorterDefaults', 'optMissingImagePayloadCount', 'renderOptionSorterSourceStrip',
  'renderOptionSorterAssignmentWorkspace', 'renderOptionImageGeneratorPanel',
  'optRenderImageOrPlaceholder', 'renderOptionSorterImagePreviewModal', 'disabledAttr', 'escapeHtml',
]);

export function createOptionSorterCommands(dependencies) {
  const {
    assertMutable, mutateOptions, persistOptions, loadVisionColors, applyVisionColors,
    requestRender, operationStamp, isCurrent,
  } = dependencies;
  return {
    addSlot: {
      capability: 'options:write',
      execute(value = {}) {
        assertMutable();
        const slot = {
          id: String(value.id || 'slot-' + Date.now()),
          name: String(value.name || '').trim() || '새 옵션',
          imgIds: Array.isArray(value.imgIds) ? [...value.imgIds] : [],
        };
        mutateOptions({ type: 'add-slot', slot });
        persistOptions({ reason: 'add-slot', slotId: slot.id });
        requestRender();
        return slot;
      },
    },
    setSubStep: {
      capability: 'options:write',
      execute(value) {
        assertMutable();
        const subStep = value === 'sort' ? 'sort' : 'input';
        mutateOptions({ type: 'set-sub-step', subStep });
        persistOptions({ reason: 'set-sub-step', subStep });
        requestRender();
        return subStep;
      },
    },
    refreshVisionColors: {
      capability: 'options:write',
      async execute(value) {
        assertMutable();
        const operation = operationStamp();
        const result = await loadVisionColors(value);
        if (!isCurrent(operation)) return { ignored: true, reason: 'stale-operation' };
        applyVisionColors(result);
        persistOptions({ reason: 'vision-colors' });
        requestRender();
        return result;
      },
    },
  };
}

export function createOptionSorterContract(dependencies) {
  const { getSnapshot, commands, render, refresh, bind, onEnter, onLeave } = dependencies;
  return createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'optionsorter',
    routes: ['optionsorter'],
    ownedSlices: ['options'],
    capabilities: ['options:read', 'options:write'],
    persistence: { reads: ['options'], writes: ['options'] },
    select(root = {}) {
      const snapshot = getSnapshot() || {};
      return { optionSorter: root.optionSorter || snapshot.optionSorter || {} };
    },
    commands,
    render,
    refresh,
    bind,
    onEnter,
    onLeave,
  });
}
