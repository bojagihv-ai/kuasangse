import {
  BOARD_STAGES,
  buildBatchSelectionRequest,
  describeBlocked,
  describeParallelHeadroom,
  describeResultError,
  groupResultCuts,
  durationLabel,
  projectProductionBoard,
  summarizeBatchSelection,
  PRODUCT_VALUE_LABELS,
} from './production-board-model.mjs?parallelBoard=9';

const BOARD_EVENT_TYPES = Object.freeze([
  'factory.snapshot',
  'factory.product.queued',
  'factory.product.updated',
  'factory.product.checkpoint.rebound',
  'factory.a_cut.selected',
  'factory.stage.updated',
  'factory.worker.failed',
  'factory.session.disconnected',
]);

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function element(tag, className = '', textContent = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}

function button(className, label, dataset = {}) {
  const node = element('button', className, label);
  node.type = 'button';
  for (const [key, value] of Object.entries(dataset)) node.dataset[key] = String(value);
  return node;
}

const CELL_GLYPHS = Object.freeze({
  selected: '✓',
  reserved: '◆',
  awaiting: '●',
  running: '▶',
  empty: '·',
});

const CELL_TITLES = Object.freeze({
  selected: '선택 완료',
  reserved: '선택 예약됨 · 조립공장이 이 작업을 다시 열면 적용됩니다',
  awaiting: '컷 선택 대기 · 눌러서 후보를 확인하세요',
  running: '진행 중',
  empty: '아직 도달하지 않음',
});

export function mountProductionBoard(runtime, {
  root = document.getElementById('production-board'),
  EventSourceImpl = globalThis.EventSource,
  fetchJobs,
} = {}) {
  if (!root || !runtime) return () => {};
  const { apiRequest, assetUrl } = runtime;
  const loadJobs = fetchJobs || (() => apiRequest('/api/factory/jobs'));

  let jobs = [];
  let openCell = { jobId: '', stageKey: '' };
  let statusLine = { copy: '병렬 생산 보드를 불러오는 중입니다.', tone: '' };
  let busy = false;
  let autoResume = true;
  let connected = null;
  let openResults = '';
  let openCafe24Values = '';
  let openProductValues = '';
  // 고른 이미지는 저장 전까지 여기에 담아 둔다. 새로 그려도 사라지지 않아야 한다.
  const imageDrafts = new Map();
  const resultCache = new Map();
  let stopped = false;
  let loaded = false;
  let eventSource = null;

  const grid = element('div', 'board-grid');
  const summaryBar = element('div', 'board-summary');
  const headroom = element('p', 'board-headroom');
  const connection = element('p', 'board-connection');
  connection.hidden = true;
  const toolbar = element('div', 'board-toolbar');
  const statusNode = element('p', 'status-message');
  const heading = element('div', 'section-heading');
  const headingCopy = element('div');
  headingCopy.append(
    element('p', 'eyebrow', 'PARALLEL PRODUCTION BOARD'),
    element('h2', '', '병렬 생산 보드'),
  );
  heading.append(
    headingCopy,
    element(
      'p',
      'section-copy',
      '작업을 한 표에 나란히 놓고 몇 단계까지 갔는지와 멈춘 지점을 함께 봅니다. 멈춘 칸에서 쓸 컷을 고르면 조립공장이 그 작업을 다시 열 때 자동으로 적용됩니다.',
    ),
  );
  root.replaceChildren(heading, connection, summaryBar, headroom, toolbar, statusNode, grid);

  function setStatus(copy, tone = '') {
    statusLine = { copy, tone };
    renderStatus();
  }

  function renderStatus() {
    statusNode.textContent = statusLine.copy;
    statusNode.dataset.tone = statusLine.tone;
    statusNode.hidden = !statusLine.copy;
  }

  function archivedResults() {
    const results = {};
    for (const [jobId, entry] of resultCache) {
      if (entry && !entry.error) results[jobId] = entry.assets;
    }
    return results;
  }

  function renderConnection() {
    connection.hidden = connected !== false;
    connection.dataset.tone = 'error';
    connection.textContent = '조립공장이 연결되지 않았습니다 · 상세페이지 AI 자동화를 실행하면 멈춘 작업이 다시 흐릅니다.';
  }

  function renderSummary(summary) {
    const entries = [
      ['전체', summary.total],
      ['대기', summary.queued],
      ['진행 중', summary.running],
      ['컷 선택 대기', summary.waiting],
      ['선택 예약', summary.reserved],
      ['차단', summary.blocked],
      ['완료', summary.completed],
    ];
    const measured = describeParallelHeadroom(summary);
    headroom.textContent = measured.copy;
    headroom.dataset.tone = measured.tone;
    summaryBar.replaceChildren(
      ...entries.map(([label, value]) => {
        const cell = element('div', 'board-summary-cell');
        cell.append(element('span', 'board-summary-label', label), element('strong', 'board-summary-value', String(value)));
        return cell;
      }),
    );
  }

  function renderToolbar(board) {
    const pickable = board.summary.pickableCells;
    const auto = button('board-action primary', 'AI 자동선택 일괄 적용', { action: 'auto' });
    const first = button('board-action', '첫 후보로 일괄 예약', { action: 'first' });
    const resume = button('board-action', '선택 끝난 작업 일괄 재개', { action: 'resume' });
    const clear = button('board-action ghost', '예약 모두 지우기', { action: 'clear' });
    auto.disabled = busy || pickable === 0;
    first.disabled = busy || pickable === 0;
    resume.disabled = busy || board.summary.resumable === 0;
    clear.disabled = busy || board.summary.reserved === 0;
    const toggle = element('label', 'board-toggle');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = autoResume;
    checkbox.dataset.action = 'toggle-auto-resume';
    toggle.append(checkbox, element('span', '', '선택 후 자동으로 다음 단계 진행'));
    const hint = element(
      'span',
      'board-toolbar-hint',
      pickable
        ? `${pickable}개 작업이 컷 선택을 기다립니다.`
        : board.summary.resumable
          ? `${board.summary.resumable}개 작업이 다음 단계 진행을 기다립니다.`
          : '지금 선택을 기다리는 작업이 없습니다.',
    );
    toolbar.replaceChildren(auto, first, resume, clear, toggle, hint);
  }

  function renderHeaderRow() {
    const header = element('div', 'board-row board-row-header');
    header.append(element('div', 'board-cell board-cell-product', '제품'));
    header.append(element('div', 'board-cell board-cell-status', '상태'));
    for (const stage of BOARD_STAGES) {
      header.append(element('div', 'board-cell board-cell-stage', stage.label));
    }
    header.append(element('div', 'board-cell board-cell-progress', '진행'));
    return header;
  }

  const CAFE24_VALUE_FIELDS = Object.freeze([
  { name: 'categoryId', label: '상품분류 번호', placeholder: '예: 119', required: true },
  { name: 'salePrice', label: '판매가', placeholder: '예: 2700' },
  { name: 'supplyPrice', label: '공급가', placeholder: '예: 500' },
  { name: 'displayStatus', label: '진열 (T/F)', placeholder: 'F = 진열 안 함' },
  { name: 'sellingStatus', label: '판매 (T/F)', placeholder: 'F = 판매 안 함' },
]);

  const REQUIRED_VALUE_ORDER = Object.freeze([
    'category', 'material', 'originCountry', 'size', 'salePrice', 'stock', 'usage', 'optionMode',
  ]);

  async function fileToImage(file, role, ordinal) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
      reader.readAsDataURL(file);
    });
    const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return {
      role,
      ordinal,
      name: file.name.replace(/\.[^.]+$/, ''),
      fileName: file.name,
      colorName: role === 'color-option' ? '' : null,
      sha256: [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''),
      dataUrl,
    };
  }

  const IMAGE_GROUPS = Object.freeze([
    Object.freeze({ role: 'base', key: 'base', title: '기본 이미지', hint: '최소 1장' }),
    Object.freeze({ role: 'color-option', key: 'color', title: '색상 옵션 이미지', hint: '이미지마다 색상명을 붙입니다' }),
  ]);

  function renderProductValueForm(row) {
    // 투입값 한 곳에서 필수값 · 기본 이미지 · 색상 옵션 이미지를 모두 다룬다. 입력·소스
    // 화면으로 되돌아가지 않아도 되게 하는 것이 이 패널의 목적이다.
    const draft = imageDrafts.get(row.jobId) || { base: [], color: [] };
    const panel = element('form', 'board-intake-panel');
    panel.dataset.jobId = row.jobId;
    panel.addEventListener('submit', event => event.preventDefault());

    const head = element('div', 'board-candidate-heading');
    head.append(element('strong', '', row.productName + ' · 투입값'));
    const missingCount = row.missingRequiredValues.length;
    const badge = element('span', 'factory-pill', missingCount ? '비어 있음 ' + missingCount + '개' : '모두 채워짐');
    badge.dataset.tone = missingCount ? 'attention' : 'ok';
    head.append(badge);
    panel.append(head);

    const values = element('section', 'board-intake-group');
    values.append(element('p', 'board-intake-group-title', '필수값'));
    const grid = element('div', 'board-cafe24-fields');
    const missing = new Set(row.missingRequiredValues);
    for (const key of REQUIRED_VALUE_ORDER) {
      const label = element('label', 'board-cafe24-field');
      const name = element('span', 'board-cafe24-field-label', PRODUCT_VALUE_LABELS[key] || key);
      if (missing.has(key)) name.dataset.tone = 'attention';
      label.append(name);
      if (key === 'optionMode') {
        const select = document.createElement('select');
        select.name = key;
        for (const option of [['', '고르세요'], ['provided', '옵션 있음'], ['none', '옵션 없음']]) {
          const node = document.createElement('option');
          node.value = option[0];
          node.textContent = option[1];
          select.append(node);
        }
        select.value = String(row.requiredValues?.[key] || '');
        label.append(select);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.name = key;
        input.value = String(row.requiredValues?.[key] || '');
        label.append(input);
      }
      grid.append(label);
    }
    values.append(grid);
    panel.append(values);

    const uploaded = row.inputImageSummary || [];
    for (const spec of IMAGE_GROUPS) {
      const group = element('section', 'board-intake-group');
      const title = element('p', 'board-intake-group-title', spec.title);
      title.append(element('span', 'board-intake-group-hint', spec.hint));
      group.append(title);

      const already = uploaded.filter(image => image.role === spec.role);
      if (already.length) {
        const shelf = element('div', 'board-intake-shelf');
        for (const image of already) {
          const chip = element('div', 'board-intake-chip');
          chip.append(element('span', 'board-intake-chip-name', image.fileName || image.name));
          if (spec.role === 'color-option') {
            const color = element('span', 'board-intake-chip-color', image.colorName || '색상명 없음');
            if (!image.colorName) color.dataset.tone = 'attention';
            chip.append(color);
          }
          shelf.append(chip);
        }
        group.append(shelf);
      } else {
        group.append(element('p', 'board-intake-empty', '올린 이미지 없음'));
      }

      const picked = draft[spec.key];
      if (picked.length) {
        const shelf = element('div', 'board-intake-shelf');
        picked.forEach((image, index) => {
          const card = element('div', 'board-intake-card');
          const thumb = document.createElement('img');
          thumb.className = 'board-intake-thumb';
          thumb.src = image.dataUrl;
          thumb.alt = image.fileName;
          card.append(thumb);
          card.append(element('span', 'board-intake-chip-name', image.fileName));
          if (spec.role === 'color-option') {
            const colorInput = document.createElement('input');
            colorInput.type = 'text';
            colorInput.className = 'board-intake-color';
            colorInput.placeholder = '색상명 *';
            colorInput.value = image.colorName || '';
            colorInput.addEventListener('input', event => {
              picked[index].colorName = event.target.value;
            });
            card.append(colorInput);
          }
          shelf.append(card);
        });
        group.append(shelf);
      }

      const pick = document.createElement('input');
      pick.type = 'file';
      pick.accept = 'image/jpeg,image/png,image/webp';
      pick.multiple = true;
      pick.className = 'board-intake-file';
      pick.addEventListener('change', async event => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          const added = await Promise.all(files.map((file, index) => fileToImage(file, spec.role, index + 1)));
          const next = imageDrafts.get(row.jobId) || { base: [], color: [] };
          next[spec.key] = [...next[spec.key], ...added];
          imageDrafts.set(row.jobId, next);
          render();
        } catch (error) {
          setStatus('이미지를 읽지 못했습니다 · ' + String(error?.message || error), 'error');
          render();
        }
      });
      const pickLabel = element('label', 'board-intake-pick', spec.title + ' 고르기');
      pickLabel.append(pick);
      group.append(pickLabel);
      panel.append(group);
    }

    const actions = element('div', 'button-row');
    const submit = button('board-mini-action board-action-primary', '이 투입값으로 저장', {
      action: 'product-values-submit',
      jobId: row.jobId,
    });
    submit.disabled = busy;
    actions.append(submit);
    if (draft.base.length || draft.color.length) {
      const clear = button('board-mini-action ghost', '고른 이미지 비우기', {
        action: 'product-images-clear',
        jobId: row.jobId,
      });
      clear.disabled = busy;
      actions.append(clear);
    }
    panel.append(actions);
    return panel;
  }

  function renderCafe24ValueForm(row) {
    // 이 값들은 조립공장에 등록 화면이 없어 관제탑에서만 지정할 수 있다. 비어 있는 채로
    // 지시하면 등록이 "차단: category_id" 로 끝난다.
    const form = document.createElement('form');
    form.className = 'board-cafe24-values';
    form.dataset.jobId = row.jobId;
    form.addEventListener('submit', event => event.preventDefault());
    const title = element('div', 'board-candidate-heading');
    title.append(
      element('strong', '', `${row.productName} · Cafe24 등록값`),
      element('span', 'factory-pill', '투입값 없음'),
    );
    form.append(title);
    const grid = element('div', 'board-cafe24-fields');
    for (const field of CAFE24_VALUE_FIELDS) {
      const label = element('label', 'board-cafe24-field');
      label.append(element('span', 'board-cafe24-field-label', field.label));
      const input = document.createElement('input');
      input.type = 'text';
      input.name = field.name;
      input.placeholder = field.placeholder;
      input.value = String(row.cafe24Values?.[field.name] || '');
      if (field.required) input.required = true;
      label.append(input);
      grid.append(label);
    }
    form.append(grid);
    const submit = button('board-mini-action', '이 값으로 Cafe24 등록', {
      action: 'cafe24-values-submit',
      jobId: row.jobId,
    });
    submit.disabled = busy;
    form.append(submit);
    return form;
  }

  function renderCandidateStrip(row, cell) {
    const strip = element('div', 'board-candidate-strip');
    strip.dataset.jobId = row.jobId;
    strip.dataset.stageKey = cell.stageKey;
    const title = element('div', 'board-candidate-heading');
    title.append(
      element('strong', '', `${row.productName} · ${cell.stageLabel}`),
      element('span', 'factory-pill', `${cell.candidateCount}개 후보`),
    );
    strip.append(title);
    const options = element('div', 'board-candidate-options');
    for (const candidate of cell.candidates) {
      const option = button('board-candidate', '', {
        action: 'pick',
        jobId: row.jobId,
        stageKey: cell.stageKey,
        candidateId: candidate.id,
      });
      option.disabled = busy;
      if (candidate.id === cell.reservedCandidateId) option.dataset.reserved = 'true';
      if (candidate.thumbnailUrl) {
        const image = document.createElement('img');
        image.src = assetUrl ? assetUrl(candidate.thumbnailUrl) : candidate.thumbnailUrl;
        image.alt = `${cell.stageLabel} 후보 ${candidate.id}`;
        image.loading = 'lazy';
        option.append(image);
      } else {
        option.append(element('span', 'board-candidate-placeholder', '미리보기 없음'));
      }
      const label = element('span', 'board-candidate-label', candidate.id);
      option.append(label);
      if (candidate.model) option.append(element('span', 'board-candidate-meta', candidate.model));
      options.append(option);
    }
    strip.append(options);
    if (cell.reservedCandidateId) {
      const cancel = button('board-action ghost', '이 작업 예약 취소', { action: 'clear-one', jobId: row.jobId });
      cancel.disabled = busy;
      strip.append(cancel);
    }
    return strip;
  }

  function renderResultStrip(row) {
    const strip = element('div', 'board-result-strip');
    strip.dataset.jobId = row.jobId;
    const entry = resultCache.get(row.jobId);
    const title = element('div', 'board-candidate-heading');
    title.append(element('strong', '', `${row.productName} · 고른 컷`));
    strip.append(title);
    if (!entry) {
      strip.append(element('p', 'status-message', '고른 컷을 불러오는 중입니다.'));
      return strip;
    }
    if (entry.error) {
      strip.append(element('p', 'status-message', describeResultError(entry.error)));
      return strip;
    }
    const grouped = groupResultCuts(entry.assets);
    title.append(element('span', 'factory-pill', `${grouped.total}컷`));
    if (!grouped.total) {
      strip.append(element('p', 'factory-empty-state', '아직 확정된 컷이 없습니다.'));
      return strip;
    }
    for (const group of grouped.groups) {
      const heading = element('div', 'board-result-stage');
      heading.append(element('strong', '', group.stageLabel));
      heading.append(element(
        'span',
        'board-product-meta',
        group.hidden ? `${group.total}컷 중 ${group.cuts.length}컷 · 나머지 ${group.hidden}컷은 보관함에` : `${group.total}컷`,
      ));
      strip.append(heading);
      const options = element('div', 'board-candidate-options');
      for (const cut of group.cuts) {
        const card = element('div', 'board-candidate');
        const image = document.createElement('img');
        image.src = assetUrl ? assetUrl(cut.thumbnailReference) : cut.thumbnailReference;
        image.alt = `${group.stageLabel} 고른 컷 ${cut.displayName}`;
        image.loading = 'lazy';
        card.append(image, element('span', 'board-candidate-label', cut.displayName));
        options.append(card);
      }
      strip.append(options);
    }
    return strip;
  }

  function renderRow(row) {
    const line = element('div', 'board-row');
    line.dataset.jobId = row.jobId;
    line.dataset.status = row.status;

    const product = element('div', 'board-cell board-cell-product');
    product.append(element('span', 'board-order', String(row.order).padStart(2, '0')));
    const productCopy = element('div', 'board-product-copy');
    productCopy.append(element('strong', '', row.productName));
    // 파일·진행방식·장수를 한 줄에 이어 붙이면 성격이 다른 사실이 같은 글씨로 뭉쳐 읽기 어렵다.
    // 종류마다 다른 칩으로 나눠 눈이 먼저 걸리도록 한다.
    const facts = element('div', 'board-product-facts');
    if (row.workfileName) {
      facts.append(element('span', 'board-fact board-fact-file', row.workfileName));
    }
    facts.append(element('span', 'board-fact board-fact-mode', row.mode === 'auto' ? '자동 진행' : '단계별 수동'));
    if (Number(row.imageCount) > 0) {
      facts.append(element('span', 'board-fact board-fact-count', `이미지 ${row.imageCount}장`));
    }
    productCopy.append(facts);
    const blocked = describeBlocked(row);
    if (blocked) {
      const cause = element('span', 'board-product-message', blocked.cause);
      cause.dataset.tone = 'danger';
      productCopy.append(cause);
      const action = element('span', 'board-product-action', blocked.action);
      productCopy.append(action);
    } else if (row.message) {
      const message = element('span', 'board-product-message', row.message);
      message.dataset.tone = row.status === 'completed'
        ? 'ok'
        : row.status === 'waiting_manual'
          ? 'warn'
          : 'muted';
      productCopy.append(message);
    }
    if (row.messageCode) {
      const code = element('details', 'board-product-code');
      const label = document.createElement('summary');
      label.textContent = '조립공장이 보고한 원래 코드';
      code.append(label, element('span', '', row.messageCode));
      productCopy.append(code);
    }
    const rowActions = element('div', 'board-row-actions');
    if (row.status === 'blocked') {
      const retry = button('board-mini-action', '다시 시도', { action: 'retry', jobId: row.jobId });
      retry.disabled = busy;
      rowActions.append(retry);
    }
    if (row.missingRequiredValues?.length && !row.cafe24Registered) {
      // 입력·소스 화면으로 되돌아가지 않고 이 자리에서 채운다.
      const fill = button('board-mini-action board-action-primary', '투입값 채우기', {
        action: 'product-values',
        jobId: row.jobId,
      });
      fill.disabled = busy;
      rowActions.append(fill);
    }
    if (row.nextAction?.kind === 'pick') {
      // "컷 선택 대기" 라고만 쓰여 있고 고르는 길이 안 보이면 사람이 움직일 수 없다.
      const pick = button(
        'board-mini-action board-action-primary',
        `${row.cells.find(cell => cell.stageKey === row.nextAction.stageKey)?.stageLabel || ''} 컷 고르기`,
        { action: 'open', jobId: row.jobId, stageKey: row.nextAction.stageKey },
      );
      pick.disabled = busy;
      rowActions.append(pick);
    }
    if ((row.status === 'completed' || row.cafe24Declined) && !row.cafe24Registered) {
      // 조립공장에는 등록 화면이 없다. 분류·공급가·진열은 이 작업의 투입값을 그대로 싣는다.
      // 투입값이 없는 작업은 바로 지시하지 않고 여기서 값을 받는다. 등록값이 없어 차단된
      // 작업도 원문 코드 대신 이 입력으로 풀 수 있어야 한다.
      const register = button(
        'board-mini-action board-action-primary',
        row.cafe24ValuesReady ? 'Cafe24 등록' : 'Cafe24 값 입력',
        { action: row.cafe24ValuesReady ? 'cafe24' : 'cafe24-values', jobId: row.jobId },
      );
      register.disabled = busy;
      rowActions.append(register);
    }
    const results = button(
      'board-mini-action ghost',
      openResults === row.jobId ? '고른 컷 접기' : '고른 컷 보기',
      { action: 'results', jobId: row.jobId },
    );
    rowActions.append(results);
    productCopy.append(rowActions);
    product.append(productCopy);
    line.append(product);

    const status = element('div', 'board-cell board-cell-status');
    const badge = element('span', 'board-status-badge', row.statusLabel);
    badge.dataset.tone = row.statusTone;
    status.append(badge);
    if (row.dispatched && row.status === 'queued') {
      status.append(element('span', 'board-product-meta', '워커 배정됨'));
    }
    if (row.hasReservation) status.append(element('span', 'board-product-meta', '선택 예약됨'));
    line.append(status);

    for (const cell of row.cells) {
      const node = row.cells.length && cell.pickable
        ? button('board-cell board-cell-stage board-cell-pickable', '', {
          action: 'open',
          jobId: row.jobId,
          stageKey: cell.stageKey,
        })
        : element('div', 'board-cell board-cell-stage');
      node.dataset.state = cell.state;
      node.dataset.stageLabel = cell.stageLabel;
      node.title = `${cell.stageLabel} · ${CELL_TITLES[cell.state] || ''}`;
      if (cell.selectedThumbnailUrl) {
        const thumb = document.createElement('img');
        thumb.className = 'board-cell-thumb';
        thumb.src = assetUrl ? assetUrl(cell.selectedThumbnailUrl) : cell.selectedThumbnailUrl;
        thumb.alt = `${cell.stageLabel} 고른 컷`;
        thumb.loading = 'lazy';
        node.append(thumb);
      } else {
        node.append(element('span', 'board-cell-glyph', CELL_GLYPHS[cell.state] || '·'));
      }
      // 표 머리글은 스크롤로 사라진다. 어느 칸이 어느 컷인지 칸 자신이 말해야 한다.
      node.append(element('span', 'board-cell-stage-name', cell.stageLabel));
      if (cell.pickable) node.append(element('span', 'board-cell-pick-hint', '고르기'));
      if (cell.candidateCount && cell.state !== 'selected') {
        node.append(element('span', 'board-cell-count', `${cell.candidateCount}`));
      }
      if (cell.state === 'reserved') node.append(element('span', 'board-cell-count', '예약'));
      if (openCell.jobId === row.jobId && openCell.stageKey === cell.stageKey) node.dataset.open = 'true';
      line.append(node);
    }

    const progress = element('div', 'board-cell board-cell-progress');
    if (row.nextAction?.copy) {
      const next = element('span', 'board-next-action', row.nextAction.copy);
      next.dataset.tone = row.nextAction.tone || 'neutral';
      progress.append(next);
    }
    progress.append(element('span', 'board-step-label', row.stepLabel));
    if (row.machineMs || row.waitMs) {
      const spent = element(
        'span',
        'board-product-meta',
        `기계 ${durationLabel(row.machineMs)} · 대기 ${durationLabel(row.waitMs)}`,
      );
      spent.title = '조립공장이 실제로 돈 시간과, 사람 판단을 기다린 시간';
      progress.append(spent);
    }
    const track = element('div', 'progress-track');
    const value = element('div', 'progress-value');
    value.style.inlineSize = `${row.percent}%`;
    track.append(value);
    progress.append(track);
    line.append(progress);
    return line;
  }

  function render() {
    const board = projectProductionBoard(jobs, { results: archivedResults() });
    renderConnection();
    renderSummary(board.summary);
    renderToolbar(board);
    renderStatus();
    const nodes = [renderHeaderRow()];
    if (!board.rows.length) {
      const empty = element('p', 'factory-empty-state', '아직 투입된 작업이 없습니다. 입력·소스에서 제품을 투입하면 이 표에 나란히 쌓입니다.');
      grid.replaceChildren(nodes[0], empty);
      return board;
    }
    for (const row of board.rows) {
      nodes.push(renderRow(row));
      if (openResults === row.jobId) nodes.push(renderResultStrip(row));
      if (openCafe24Values === row.jobId) nodes.push(renderCafe24ValueForm(row));
      if (openProductValues === row.jobId) nodes.push(renderProductValueForm(row));
      if (openCell.jobId !== row.jobId) continue;
      const cell = row.cells.find(item => item.stageKey === openCell.stageKey);
      if (cell && cell.candidates.length) nodes.push(renderCandidateStrip(row, cell));
    }
    grid.replaceChildren(...nodes);
    return board;
  }

  async function refresh() {
    if (stopped) return;
    try {
      const [response, state] = await Promise.all([
        loadJobs(),
        apiRequest('/api/factory/state').catch(() => null),
      ]);
      jobs = Array.isArray(response?.jobs) ? response.jobs : [];
      connected = state ? state.connected === true : connected;
      void fillMissingProgress();
      loaded = true;
      if (statusLine.tone === 'error' || statusLine.tone === '') statusLine = { copy: '', tone: '' };
      render();
    } catch (error) {
      setStatus(`생산 보드를 불러오지 못했습니다 · ${String(error?.code || error?.message || error)}`, 'error');
      render();
    }
  }

  async function submitBatch(body) {
    busy = true;
    render();
    try {
      const response = await apiRequest('/api/factory/jobs/selections', {
        method: 'POST',
        body: JSON.stringify({ ...body, autoResume }),
      });
      const summary = summarizeBatchSelection(response);
      setStatus(summary.copy, summary.tone);
    } catch (error) {
      setStatus(`일괄 선택 실패 · ${String(error?.code || error?.message || error)}`, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function clearReservations(jobIds) {
    busy = true;
    render();
    try {
      const results = await Promise.allSettled(
        jobIds.map(jobId => apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/selection/clear`, {
          method: 'POST',
          body: JSON.stringify({}),
        })),
      );
      const failed = results.filter(item => item.status === 'rejected').length;
      setStatus(
        failed ? `${jobIds.length - failed}건 예약 해제 · ${failed}건 실패` : `${jobIds.length}건 예약을 해제했습니다.`,
        failed ? 'error' : 'ok',
      );
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function resumeSelected(jobIds) {
    busy = true;
    render();
    try {
      const response = await apiRequest('/api/factory/jobs/resume', {
        method: 'POST',
        body: JSON.stringify(jobIds ? { jobIds } : {}),
      });
      const resumed = Number(response?.resumed || 0);
      const failed = Number(response?.failed || 0);
      setStatus(
        resumed || failed
          ? [resumed && `${resumed}건 다음 단계로 진행`, failed && `${failed}건은 아직 진행할 수 없음`]
            .filter(Boolean).join(' · ')
          : '진행할 작업이 없습니다.',
        failed ? 'warning' : 'ok',
      );
    } catch (error) {
      setStatus(`일괄 재개 실패 · ${String(error?.code || error?.message || error)}`, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function saveProductIntake(jobId, values, images) {
    busy = true;
    render();
    try {
      // 이미지를 먼저 올린다. 이미지가 옵션 여부를 정하므로, 값이 그 뒤에 와야
      // 사람이 고른 옵션 여부가 최종으로 남는다.
      if (images.length) {
        await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/images`, {
          method: 'POST',
          body: JSON.stringify({ inputImages: images }),
        });
      }
      if (Object.keys(values).length) {
        await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/values`, {
          method: 'POST',
          body: JSON.stringify(values),
        });
      }
      imageDrafts.delete(jobId);
      const parts = [
        Object.keys(values).length ? '투입값' : '',
        images.length ? `이미지 ${images.length}장` : '',
      ].filter(Boolean).join(' · ');
      setStatus(`${parts} 저장했습니다. 이 작업을 재개하면 채운 값으로 진행합니다.`, 'ok');
    } catch (error) {
      setStatus(`투입값 저장 실패 · ${String(error?.code || error?.message || error)}`, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function registerCafe24(jobId, values = {}) {
    busy = true;
    render();
    try {
      await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/cafe24/register`, {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setStatus('Cafe24 등록을 조립공장에 지시했습니다. 완료되면 이 줄의 상태가 바뀝니다.', 'ok');
    } catch (error) {
      setStatus(`Cafe24 등록 지시 실패 · ${String(error?.code || error?.message || error)}`, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function fillMissingProgress() {
    const pending = jobs
      .filter(job => !record(job).progress && !resultCache.has(String(job.jobId)))
      .slice(0, 8);
    for (const job of pending) await loadResults(String(job.jobId), { quiet: true });
  }

  async function loadResults(jobId, { quiet = false } = {}) {
    try {
      const response = await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/history`);
      const assets = Array.isArray(response?.workBundle?.assets) ? response.workBundle.assets : [];
      resultCache.set(jobId, { assets });
    } catch (error) {
      resultCache.set(jobId, { assets: [], error: String(error?.code || error?.message || error) });
    }
    if (!quiet || openResults) render();
    else render();
  }

  function onChange(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.dataset.action !== 'toggle-auto-resume') return;
    autoResume = target.checked === true;
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target || busy) return;
    const action = target.dataset.action;
    if (action === 'toggle-auto-resume') return;
    if (action === 'resume') {
      void resumeSelected(null);
      return;
    }
    if (action === 'retry') {
      void resumeSelected([target.dataset.jobId]);
      return;
    }
    if (action === 'cafe24') {
      void registerCafe24(target.dataset.jobId);
      return;
    }
    if (action === 'product-values') {
      openProductValues = openProductValues === target.dataset.jobId ? '' : target.dataset.jobId;
      render();
      return;
    }
    if (action === 'product-images-clear') {
      imageDrafts.delete(target.dataset.jobId);
      render();
      return;
    }
    if (action === 'product-values-submit') {
      const form = target.closest('form');
      const values = {};
      for (const input of form?.querySelectorAll('input[name], select[name]') || []) {
        const value = String(input.value || '').trim();
        if (value) values[input.name] = value;
      }
      const draft = imageDrafts.get(target.dataset.jobId) || { base: [], color: [] };
      const images = [...draft.base, ...draft.color];
      // 색상 옵션 이미지는 색상명이 짝지어져야 조립공장이 옵션표를 만들 수 있다.
      const unnamed = draft.color.filter(image => !String(image.colorName || '').trim());
      if (unnamed.length) {
        setStatus(`색상명을 넣어 주세요 · ${unnamed.map(image => image.fileName).join(', ')}`, 'warning');
        render();
        return;
      }
      if (!Object.keys(values).length && !images.length) {
        setStatus('채울 값이나 올릴 이미지를 하나 이상 넣어 주세요.', 'warning');
        render();
        return;
      }
      openProductValues = '';
      void saveProductIntake(target.dataset.jobId, values, images);
      return;
    }
    if (action === 'cafe24-values') {
      openCafe24Values = openCafe24Values === target.dataset.jobId ? '' : target.dataset.jobId;
      render();
      return;
    }
    if (action === 'cafe24-values-submit') {
      const form = target.closest('form');
      const values = {};
      for (const field of CAFE24_VALUE_FIELDS) {
        const value = String(form?.elements?.[field.name]?.value || '').trim();
        if (value) values[field.name] = value;
      }
      if (!values.categoryId) {
        setStatus('Cafe24 상품분류 번호는 반드시 넣어야 합니다.', 'warning');
        render();
        return;
      }
      openCafe24Values = '';
      void registerCafe24(target.dataset.jobId, values);
      return;
    }
    if (action === 'results') {
      const jobId = target.dataset.jobId;
      openResults = openResults === jobId ? '' : jobId;
      render();
      if (openResults && !resultCache.has(jobId)) void loadResults(jobId);
      return;
    }
    if (action === 'open') {
      const same = openCell.jobId === target.dataset.jobId && openCell.stageKey === target.dataset.stageKey;
      openCell = same ? { jobId: '', stageKey: '' } : { jobId: target.dataset.jobId, stageKey: target.dataset.stageKey };
      render();
      return;
    }
    if (action === 'pick') {
      void submitBatch({
        mode: 'manual',
        selections: [{
          jobId: target.dataset.jobId,
          stageKey: target.dataset.stageKey,
          candidateId: target.dataset.candidateId,
        }],
      });
      openCell = { jobId: '', stageKey: '' };
      return;
    }
    if (action === 'auto' || action === 'first') {
      const board = projectProductionBoard(jobs);
      const body = buildBatchSelectionRequest(board, { mode: action === 'auto' ? 'auto' : 'manual' });
      if (action === 'auto' ? !body.jobIds.length : !body.selections.length) {
        setStatus('선택할 대기 작업이 없습니다.', 'warning');
        render();
        return;
      }
      void submitBatch(body);
      return;
    }
    if (action === 'clear-one') {
      void clearReservations([target.dataset.jobId]);
      return;
    }
    if (action === 'clear') {
      const reserved = projectProductionBoard(jobs).rows.filter(row => row.hasReservation).map(row => row.jobId);
      if (reserved.length) void clearReservations(reserved);
    }
  }

  function connectEvents() {
    if (typeof EventSourceImpl !== 'function') return;
    try {
      eventSource = new EventSourceImpl(`${apiOrigin()}/api/factory/events?cursor=0`, { withCredentials: true });
    } catch {
      eventSource = null;
      return;
    }
    const onEvent = () => { void refresh(); };
    for (const type of BOARD_EVENT_TYPES) eventSource.addEventListener(type, onEvent);
  }

  function apiOrigin() {
    try {
      return new URL(assetUrl ? assetUrl('/api/factory/state') : '/api/factory/state', window.location.href).origin;
    } catch {
      return '';
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  window.addEventListener('control-tower:job-created', refresh);
  void refresh().then(connectEvents);

  return () => {
    stopped = true;
    eventSource?.close?.();
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    window.removeEventListener('control-tower:job-created', refresh);
  };
}

if (globalThis.controlTowerRuntime && document.getElementById('production-board')) {
  mountProductionBoard(globalThis.controlTowerRuntime);
}
