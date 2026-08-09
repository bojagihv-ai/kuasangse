const DEFAULT_ROW_HEIGHT = 112;
const FIXTURE_STAGES = Object.freeze([
  ["representative", "대표 이미지"],
  ["size", "사이즈 이미지"],
  ["option_color", "옵션·색상"],
  ["general", "일반 이미지"],
  ["sections", "섹션 변형"],
  ["final_detail", "최종 상세페이지"],
]);

function thumbnailOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : '';
  } catch {
    return '';
  }
}

export function createQueueModel(count, options = {}) {
  const safeCount = Math.max(0, Math.min(2000, Number.parseInt(String(count), 10) || 0));
  const thumbnailBase = thumbnailOrigin(options.thumbnailBase);
  return Array.from({ length: safeCount }, (_, index) => {
    const [stageKey, stageLabel] = FIXTURE_STAGES[index % FIXTURE_STAGES.length];
    const status = index === safeCount - 1 ? "completed" : index % 17 === 0 ? "blocked" : "running";
    const mode = index % 7 === 0 ? "manual" : "auto";
    return {
      productId: `product-${String(index + 1).padStart(3, "0")}`,
      productKey: `fixture-product-${String(index + 1).padStart(3, "0")}`,
      title: `제품 ${index + 1}`,
      state: status,
      progress: {
        stageKey,
        stageLabel,
        percent: status === "completed" ? 100 : Math.min(96, 12 + (index % 80)),
        elapsedMs: (index + 1) * 1_000,
        mode,
        status,
      },
      thumbnailRef: thumbnailBase
        ? `${thumbnailBase}/api/assets/thumbnail/queue-product-${index + 1}.svg`
        : `pdp://thumbnail/product-${index + 1}`,
    };
  });
}

function visibleWindow(total, scrollTop, viewportHeight, rowHeight, overscan) {
  if (total === 0) return { first: 0, last: 0 };
  const windowSize = Math.max(1, Math.ceil(viewportHeight / rowHeight) + (overscan * 2));
  const maxFirst = Math.max(0, total - windowSize);
  const first = Math.min(maxFirst, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  const last = Math.min(total, Math.max(first + 1, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan));
  return { first, last };
}

export function getQueueScrollTop(pageScrollTop, queueOffsetTop, total, rowHeight = DEFAULT_ROW_HEIGHT) {
  const logicalHeight = Math.max(0, Number(total) || 0) * rowHeight;
  const relativeScrollTop = Math.max(0, (Number(pageScrollTop) || 0) - (Number(queueOffsetTop) || 0));
  return Math.min(logicalHeight, relativeScrollTop);
}

export function renderVirtualQueue(root, items, options = {}) {
  if (!root) return { rendered: 0, total: items.length };
  const rowHeight = options.rowHeight || DEFAULT_ROW_HEIGHT;
  const overscan = options.overscan ?? 4;
  const scrollTop = options.scrollTop || 0;
  const viewportHeight = options.viewportHeight || 720;
  const { first, last } = visibleWindow(items.length, scrollTop, viewportHeight, rowHeight, overscan);
  root.classList.add("virtual-queue");
  root.style.rowGap = "0px";
  root.dataset.virtualTotal = String(items.length);
  root.dataset.virtualRendered = String(last - first);
  root.replaceChildren();
  const top = document.createElement("div");
  top.className = "virtual-spacer";
  top.style.blockSize = `${first * rowHeight}px`;
  root.append(top);
  for (const item of items.slice(first, last)) {
    const row = document.createElement("article");
    row.className = "factory-card review-card virtual-row";
    row.dataset.productId = item.productId;
    row.dataset.productKey = item.productKey;
    row.dataset.state = item.progress.status;
    row.dataset.progressPercent = String(item.progress.percent);
    row.style.blockSize = `${rowHeight}px`;
    row.style.boxSizing = "border-box";
    row.style.marginBlock = "0px";
    const stateLabel = item.progress.status === "completed"
      ? "완료"
      : item.progress.status === "blocked"
        ? "차단"
        : item.progress.mode === "manual"
          ? "수동 진행"
          : "자동 진행";
    const elapsedSeconds = Math.floor(item.progress.elapsedMs / 1_000);
    const thumbnail = /^https?:\/\//.test(item.thumbnailRef)
      ? `<img class="lazy-thumb" src="${item.thumbnailRef}" alt="${item.title} 썸네일" loading="lazy" decoding="async" data-thumbnail-ref="${item.thumbnailRef}">`
      : `<span class="lazy-thumb" data-thumbnail-ref="${item.thumbnailRef}" aria-label="지연 썸네일"></span>`;
    row.innerHTML = `<div class="status-row"><h3>${item.title}</h3><span class="factory-pill queue-state">${stateLabel}</span></div><p class="card-copy">${item.progress.stageLabel} · ${item.progress.percent}% · ${elapsedSeconds}초 · ${item.productKey}</p><div class="progress-track" role="progressbar" aria-label="${item.progress.stageLabel}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${item.progress.percent}"><div class="progress-value" style="inline-size:${item.progress.percent}%"></div></div><div class="button-row">${thumbnail}<span class="status-message" data-stage-key="${item.progress.stageKey}">${item.progress.status}</span></div>`;
    root.append(row);
  }
  const bottom = document.createElement("div");
  bottom.className = "virtual-spacer";
  bottom.style.blockSize = `${Math.max(0, (items.length - last) * rowHeight)}px`;
  root.append(bottom);
  return { rendered: last - first, total: items.length, first, last };
}
