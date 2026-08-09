export function bindNativeOptionImageDrag({
  cards,
  optionSorter,
  optScheduleSave,
  refreshAssignmentIndicators,
}) {
  let drag = null;
  const dropListSelector = '#optPoolList, .opt-slot-list';
  const closestDropList = node => node?.closest?.(dropListSelector) || null;
  const findDropList = event => {
    const pointed = typeof document !== 'undefined'
      ? document.elementFromPoint?.(event?.clientX, event?.clientY)
      : null;
    return closestDropList(pointed) || closestDropList(event?.target);
  };
  const clearDrag = () => {
    drag?.card?.classList?.remove?.('sortable-chosen');
    drag?.dropList?.classList?.remove?.('opt-native-drag-over');
    drag = null;
  };
  const moveImage = (card, imageId, targetList) => {
    const os = optionSorter();
    const targetSlotId = String(targetList?.dataset?.slotId || '').trim();
    const targetSlot = targetSlotId ? os.slots.find(slot => slot.id === targetSlotId) : null;
    const isPool = targetList?.id === 'optPoolList';
    if (!isPool && !targetSlot) return false;
    os.pool = os.pool.filter(id => id !== imageId);
    os.slots.forEach(slot => { slot.imgIds = slot.imgIds.filter(id => id !== imageId); });
    if (isPool) os.pool.push(imageId);
    else targetSlot.imgIds.push(imageId);
    targetList.appendChild?.(card);
    refreshAssignmentIndicators();
    optScheduleSave(80);
    return true;
  };

  cards.forEach(card => {
    card.onpointerdown = event => {
      if (event?.button !== undefined && event.button !== 0) return;
      if (event?.target?.closest?.('button,input,textarea,select,a')) return;
      drag = {
        card,
        imageId: String(card.dataset?.optQuickAssign || card.dataset?.imgId || '').trim(),
        pointerId: event?.pointerId,
        startX: Number(event?.clientX || 0),
        startY: Number(event?.clientY || 0),
        active: false,
        dropList: null,
      };
      card.setPointerCapture?.(event?.pointerId);
    };
    card.onpointermove = event => {
      if (!drag || drag.card !== card || drag.pointerId !== event?.pointerId) return;
      const distance = Math.hypot(
        Number(event?.clientX || 0) - drag.startX,
        Number(event?.clientY || 0) - drag.startY,
      );
      if (!drag.active && distance < 6) return;
      drag.active = true;
      event.preventDefault?.();
      const nextDropList = findDropList(event);
      if (drag.dropList !== nextDropList) {
        drag.dropList?.classList?.remove?.('opt-native-drag-over');
        drag.dropList = nextDropList;
        drag.dropList?.classList?.add?.('opt-native-drag-over');
      }
      card.classList?.add?.('sortable-chosen');
    };
    card.onpointerup = event => {
      if (!drag || drag.card !== card || drag.pointerId !== event?.pointerId) return;
      const activeDrag = drag.active;
      const targetList = findDropList(event) || drag.dropList;
      if (activeDrag && targetList) moveImage(card, drag.imageId, targetList);
      clearDrag();
    };
    card.onpointercancel = () => {
      if (drag?.card === card) clearDrag();
    };
  });
}
