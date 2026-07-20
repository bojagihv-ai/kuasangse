export function bindOptionSorterSlots(context) {
  const {
    byId, queryAll, optionSorter, requestRender, createSortable, currentStep, sortable,
    optDeleteSlot, optDownloadSlot, optFocusSlotNameByIndex, optScheduleSave,
    optSwapOptionPairOrder, saveLastWorkNow, syncOptFromDOM, syncOptSlotsFromDOM,
  } = context;

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
  queryAll('[data-slot-del-input]').forEach(btn => {
    btn.onclick = e => { e.stopPropagation(); optDeleteSlot(btn.dataset.slotDelInput); };
  });

  // 분류 시작 버튼
  const optGoSort = byId('optGoSort');
  if (optGoSort) optGoSort.onclick = () => {
    const os = optionSorter();
    // 아직 배정 안 된 이미지만 pool에 추가 (기존 슬롯 배정 유지)
    const assignedIds = new Set(os.slots.flatMap(s => s.imgIds));
    const newPool = os.images.filter(i => !assignedIds.has(i.id) && !os.pool.includes(i.id)).map(i => i.id);
    os.pool = [...os.pool, ...newPool].filter(id => os.images.some(im => im.id === id));
    os.slots.forEach(s => { s.imgIds = s.imgIds.filter(id => os.images.some(im => im.id === id)); });
    os.subStep = 'sort';
    optScheduleSave();
    requestRender();
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
  if (optBackInput) optBackInput.onclick = () => { optionSorter().subStep = 'input'; optScheduleSave(); requestRender(); };

  // 전체 다운로드
  const optDlAll = byId('optDlAll');
  if (optDlAll) optDlAll.onclick = () => optDownloadSlot('__all__');

  // 슬롯별 다운로드
  queryAll('[data-opt-dl-slot]').forEach(btn => {
    btn.onclick = () => optDownloadSlot(btn.dataset.optDlSlot);
  });

  // SortableJS — 분류 화면에서만 초기화
  if (currentStep() === 'optionsorter' && optionSorter().subStep === 'sort' && sortable) {
    const os = optionSorter();
    const sharedGroup = { name: 'opt-imgs', pull: true, put: true };
    const onImgEnd = () => { syncOptFromDOM(); requestRender(); };

    // 미배정 풀
    const poolList = byId('optPoolList');
    if (poolList) {
      createSortable(poolList, { group: sharedGroup, animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', onEnd: onImgEnd });
    }
    // 각 슬롯 리스트
    os.slots.forEach(slot => {
      const el = byId('optSlotList_' + slot.id);
      if (el) createSortable(el, { group: sharedGroup, animation: 150, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', onEnd: onImgEnd });
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
  }
}
