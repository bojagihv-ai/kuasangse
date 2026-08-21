import { bindNativeOptionImageDrag } from './optionsorter-native-drag.mjs';

export function bindOptionSorterSlots(context) {
  const {
    byId, queryAll, optionSorter, requestRender, createSortable, currentStep, sortable,
    getSlotNamePresets, saveSlotNamePreset,
    optDeleteSlot, optDownloadSlot, optFocusSlotNameByIndex, optScheduleSave,
    optSwapOptionPairOrder, saveLastWorkNow, syncOptFromDOM, syncOptSlotsFromDOM,
    uid, reportWarning,
  } = context;

  const refreshAssignmentIndicators = () => {
    const os = optionSorter();
    const assignedIds = new Set(os.slots.flatMap(slot => slot.imgIds || []));
    const assigned = assignedIds.size;
    const headerStatus = byId('optHeaderAssignmentStatus');
    if (headerStatus) headerStatus.textContent = `이미지를 드래그해서 슬롯에 배정 · ${assigned}/${os.images.length}장 배정됨`;
    const autoNameButton = byId('optAutoNameColors');
    if (autoNameButton && !os.optionVisionColorBusy) {
      autoNameButton.disabled = assigned === 0;
      autoNameButton.title = assigned === 0 ? '사진을 슬롯에 먼저 배정해주세요.' : '';
    }
    const sourceStatus = byId('optSourceMatchStatus');
    if (sourceStatus) sourceStatus.textContent = `총 ${os.images.length}장 · 매칭 ${assigned}장`;
    const matchStatus = byId('optAssignmentMatchStatus');
    if (matchStatus) {
      matchStatus.textContent = `${assigned}/${os.images.length}장 매칭`;
      matchStatus.classList.toggle('warn', os.pool.length > 0);
      matchStatus.classList.toggle('ok', os.pool.length === 0);
    }
    const poolWrap = byId('optPoolWrap');
    if (poolWrap) poolWrap.style.opacity = os.pool.length === 0 ? '.55' : '1';
    const poolStatus = byId('optPoolStatus');
    if (poolStatus) {
      poolStatus.textContent = os.pool.length > 0 ? `${os.pool.length}장` : '없음';
      poolStatus.style.color = os.pool.length > 0 ? 'var(--warn)' : 'var(--ok)';
    }
    queryAll('[data-opt-source-card]').forEach(card => {
      const matched = assignedIds.has(card.dataset.optSourceCard);
      card.classList.toggle('assigned', matched);
      const stateLabel = card.querySelector?.('.opt-source-state');
      if (stateLabel) stateLabel.textContent = matched ? '매칭됨' : '미배정';
    });
    os.slots.forEach(slot => {
      const slotList = byId('optSlotList_' + slot.id);
      slotList?.classList?.toggle('is-empty', slot.imgIds.length === 0);
      const slotCount = queryAll(`[data-opt-slot-count="${slot.id}"]`)[0];
      if (slotCount) slotCount.textContent = `${slot.imgIds.length}장`;
    });
  };

  const presetSelect = byId('optSlotPresetSelect');
  const presetName = byId('optSlotPresetName');
  if (presetSelect) presetSelect.onchange = () => {
    const preset = getSlotNamePresets().find(item => item.id === presetSelect.value);
    if (preset && presetName) presetName.value = preset.name;
  };

  const optSaveSlotPreset = byId('optSaveSlotPreset');
  if (optSaveSlotPreset) optSaveSlotPreset.onclick = () => {
    const name = String(presetName?.value || '').trim();
    if (!name) {
      presetName?.focus?.();
      reportWarning('프리셋 이름을 입력해주세요.');
      return;
    }
    const os = optionSorter();
    const preset = saveSlotNamePreset({
      id: presetSelect?.value || '',
      name,
      slotNames: os.slots.map((slot, index) => String(slot.name || '').trim() || `${index + 1}번`),
    });
    os.optionSlotPresetId = preset.id;
    os.optionSlotPresetNotice = `"${preset.name}" 프리셋을 ${preset.slotNames.length}개 슬롯명으로 저장했습니다.`;
    requestRender();
  };

  const optLoadSlotPreset = byId('optLoadSlotPreset');
  if (optLoadSlotPreset) optLoadSlotPreset.onclick = () => {
    const preset = getSlotNamePresets().find(item => item.id === presetSelect?.value);
    if (!preset) {
      reportWarning('불러올 슬롯 이름 프리셋을 선택해주세요.');
      return;
    }
    const os = optionSorter();
    preset.slotNames.forEach((name, index) => {
      if (os.slots[index]) {
        os.slots[index].name = name;
        return;
      }
      os.slots.push({ id: uid('slot'), name, imgIds: [] });
    });
    os.optionSlotPresetId = preset.id;
    os.optionSlotPresetNotice = `"${preset.name}" 프리셋을 불러왔습니다. 기존 이미지 배정은 유지했습니다.`;
    optScheduleSave();
    requestRender();
  };

  // 슬롯 추가 (입력화면)
  const optAddSlotInput = byId('optAddSlotInput');
  if (optAddSlotInput) optAddSlotInput.onclick = () => {
    const os = optionSorter();
    const n = os.slots.length + 1;
    os.slots.push({ id: 'slot_' + Date.now(), name: n + '번', imgIds: [] });
    optScheduleSave();
    requestRender();
    optFocusSlotNameByIndex(os.slots.length - 1);
  };

  // 입력화면 슬롯 이름 수정
  queryAll('.opt-slot-name-inp').forEach((inp, idx) => {
    inp.oninput = () => {
      const slot = optionSorter().slots.find(s => s.id === inp.dataset.slotName);
      if (slot) slot.name = inp.value;
      optScheduleSave();
    };
    inp.onfocus = () => inp.select();
    inp.onblur = () => { saveLastWorkNow(); };
    inp.onkeydown = e => {
      if (e.key !== 'Enter' && e.key !== 'Tab') return;
      e.preventDefault();
      const inputs = [...queryAll('.opt-slot-name-inp')];
      const next = inputs[idx + (e.key === 'Tab' && e.shiftKey ? -1 : 1)];
      if (next) {
        next.focus();
        next.select();
      } else {
        const goSort = byId('optGoSort');
        const addSlot = byId('optAddSlotInput');
        (goSort && !goSort.disabled ? goSort : addSlot)?.focus();
      }
    };
    inp.ondragstart = e => e.stopPropagation();
    inp.onclick = e => e.stopPropagation();
  });

  // 입력화면 슬롯 삭제
  queryAll('[data-slot-del-input]').forEach(btn => { btn.onclick = e => { e.stopPropagation(); optDeleteSlot(btn.dataset.slotDelInput); }; });

  const optOpenStoredOptionResults = byId('optOpenStoredOptionResults');
  if (optOpenStoredOptionResults) optOpenStoredOptionResults.onclick = () => {
    const os = optionSorter(); if (!Array.isArray(os.optionResults) || !os.optionResults.length) return;
    os.subStep = 'sort'; os.subStepUpdatedAt = Date.now(); optScheduleSave(); requestRender();
    byId('optStoredOptionResults')?.scrollIntoView?.({ block: 'start' });
  };

  // 분류 시작 버튼
  const optGoSort = byId('optGoSort');
  if (optGoSort) optGoSort.onclick = () => {
    const os = optionSorter();
    // 아직 배정 안 된 이미지만 pool에 추가 (기존 슬롯 배정 유지)
    const assignedIds = new Set(os.slots.flatMap(s => s.imgIds));
    const newPool = os.images.filter(i => !assignedIds.has(i.id) && !os.pool.includes(i.id)).map(i => i.id);
    os.pool = [...os.pool, ...newPool].filter(id => os.images.some(im => im.id === id));
    os.slots.forEach(s => { s.imgIds = s.imgIds.filter(id => os.images.some(im => im.id === id)); });
    os.subStep = 'sort'; os.subStepUpdatedAt = Date.now(); optScheduleSave(); requestRender();
  };

  // 분류 화면: 슬롯 추가
  const optAddSlot = byId('optAddSlot');
  if (optAddSlot) optAddSlot.onclick = () => {
    const os = optionSorter();
    const n = os.slots.length + 1;
    os.slots.push({ id: 'slot_' + Date.now(), name: n + '번', imgIds: [] });
    optScheduleSave();
    requestRender();
  };

  // 분류 화면: 슬롯 삭제
  queryAll('[data-slot-del]').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); optDeleteSlot(btn.dataset.slotDel); };
  });

  // 분류 화면: 이미지 변경 (입력으로 돌아가기)
  const optBackInput = byId('optBackInput');
  if (optBackInput) optBackInput.onclick = () => { const os = optionSorter(); os.subStep = 'input'; os.subStepUpdatedAt = Date.now(); optScheduleSave(); requestRender(); };

  // 전체 다운로드
  const optDlAll = byId('optDlAll');
  if (optDlAll) optDlAll.onclick = () => optDownloadSlot('__all__');

  // 슬롯별 다운로드
  queryAll('[data-opt-dl-slot]').forEach(btn => {
    btn.onclick = () => optDownloadSlot(btn.dataset.optDlSlot);
  });

  queryAll('[data-opt-quick-assign]').forEach(card => {
    card.ondblclick = event => {
      event.preventDefault();
      event.stopPropagation();
      if (card.parentElement?.id !== 'optPoolList') return;
      const os = optionSorter();
      const imageId = card.dataset.optQuickAssign;
      const targetSlot = os.slots.find(slot => slot.imgIds.length === 0);
      if (!targetSlot) {
        reportWarning('비어 있는 옵션 슬롯이 없습니다. 슬롯을 추가하거나 기존 슬롯으로 드래그해주세요.');
        return;
      }
      os.pool = os.pool.filter(id => id !== imageId);
      os.slots.forEach(slot => {
        slot.imgIds = slot.imgIds.filter(id => id !== imageId);
      });
      targetSlot.imgIds.push(imageId);
      byId('optSlotList_' + targetSlot.id)?.appendChild(card);
      refreshAssignmentIndicators();
      optScheduleSave(80);
    };
  });

  // SortableJS — 분류 화면에서만 초기화
  if (currentStep() === 'optionsorter' && optionSorter().subStep === 'sort' && sortable) {
    const os = optionSorter();
    const sharedGroup = { name: 'opt-imgs', pull: true, put: true };
    const onImgEnd = () => {
      syncOptFromDOM();
      refreshAssignmentIndicators();
    };
    const imageSortableOptions = {
      group: sharedGroup,
      animation: 80,
      emptyInsertThreshold: 24,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: onImgEnd,
    };

    // 미배정 풀
    const poolList = byId('optPoolList');
    if (poolList) {
      createSortable(poolList, { ...imageSortableOptions });
    }
    // 각 슬롯 리스트
    os.slots.forEach(slot => {
      const el = byId('optSlotList_' + slot.id);
      if (el) createSortable(el, { ...imageSortableOptions });
    });
    // 슬롯 그리드 자체 재정렬
    const slotGrid = byId('optSlotGrid');
    if (slotGrid) {
      createSortable(slotGrid, { handle: '.opt-slot-handle', animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', onEnd() { syncOptSlotsFromDOM(); requestRender(); } });
    }
    const mapRows = [...queryAll('[data-opt-map-row-index]')];
    if (mapRows.length) {
      let mapOrderBefore = [];
      let mapRowOffsets = [];
      const mapGroup = { name: 'opt-map-pairs', pull: true, put: true };
      mapRows.forEach(row => {
        createSortable(row, {
          group: mapGroup,
          handle: '.opt-map-drag-handle',
          animation: 150,
          ghostClass: 'sortable-ghost',
          chosenClass: 'sortable-chosen',
          onStart() {
            mapOrderBefore = [...queryAll('[data-opt-map-pair-key]')].map(card => card.dataset.optMapPairKey);
            let offset = 0;
            mapRowOffsets = mapRows.map(item => {
              const current = offset;
              offset += item.children.length;
              return current;
            });
          },
          onEnd(event) {
            const fromIndex = (mapRowOffsets[mapRows.indexOf(event.from)] || 0) + event.oldIndex;
            const toIndex = (mapRowOffsets[mapRows.indexOf(event.to)] || 0) + event.newIndex;
            const firstKey = mapOrderBefore[fromIndex];
            const secondKey = mapOrderBefore[toIndex];
            if (firstKey && secondKey) optSwapOptionPairOrder(firstKey, secondKey, optionSorter());
            requestRender();
          },
        });
      });
    }
  } else if (!sortable && queryAll('[data-opt-quick-assign]').length) {
    bindNativeOptionImageDrag({
      cards: queryAll('[data-opt-quick-assign]'),
      optionSorter,
      optScheduleSave,
      refreshAssignmentIndicators,
    });
  }
}
