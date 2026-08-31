import {
  advanceManualSelectionCursor,
  BOARD_STAGES,
  boardRowSignature,
  buildBatchSelectionRequest,
  candidatePresentation,
  describeBlocked,
  describeParallelHeadroom,
  describeResultError,
  groupResultCuts,
  durationLabel,
  projectProductionBoard,
  summarizeBatchSelection,
  PRODUCT_VALUE_LABELS,
} from './production-board-model.mjs?parallelBoard=40';

// 이벤트가 몰아칠 때 다시 읽기를 모으는 시간. 사람 눈에는 즉시로 보이면서
// 한 번에 수백 건이 와도 요청은 한 번만 나간다.
const EVENT_REFRESH_COALESCE_MS = 250;

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
  // 옵션 없는 제품의 옵션·색상 칸. 점만 찍으면 고장인지 아직인지 알 수 없다.
  skipped: '—',
});

const CELL_TITLES = Object.freeze({
  skipped: '옵션 없는 제품이라 이 단계는 건너뜁니다',
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
  const factoryBackend = String(runtime.factoryBackend || '').replace(/\/+$/, '');
  const factoryApp = String(runtime.factoryApp || '').replace(/\/+$/, '');
  const loadJobs = fetchJobs || (() => apiRequest('/api/factory/jobs'));

  let jobs = [];
  let openCell = { jobId: '', stageKey: '' };
  let statusLine = { copy: '병렬 생산 보드를 불러오는 중입니다.', tone: '' };
  // busy 는 보드 전체의 버튼을 한꺼번에 잠근다. 그래서 이 깃발이 한 번 걸린 채 남으면
  // 「다시 시도」·「작업 재개」·「Cafe24 등록」이 모두 죽고, 화면은 아무 말도 하지 않는다.
  // 실측 2026-08-31: 카드가 "다음: 다시 시도 누르기" 라고 적어 둔 바로 그 버튼이 잠겨
  // 있어 몇 번을 눌러도 요청이 나가지 않았다. 새로고침해야만 풀렸다.
  // 원인은 깃발을 세운 뒤 try 밖에서 render()/setStatus() 를 부른 것이었다. 그 사이에서
  // 예외가 한 번 나면 finally 가 없으니 깃발이 영원히 걸린다. 아래 일곱 군데 모두
  // busy = true 다음 줄이 곧바로 try 여야 하고, 내리는 일은 finally 에만 있어야 한다.
  let busy = false;
  let autoResume = true;
  let connected = null;
  // 워커가 살아 있는지는 '붙어 있다' 가 아니라 '방금 말했다' 로 안다. 렌더러가 막히면
  // 연결은 그대로인데 상태 보고만 끊긴다. 그 사이 화면은 "실행 중" 만 보여 준다.
  // 실측 2026-08-26: 워커가 10분 넘게 죽어 있었는데 보드는 계속 진행 중이라고 했다.
  let workerHeartbeatAt = '';
  let openResults = '';
  let openCafe24Values = '';
  let openProductValues = '';
  // 고른 이미지는 저장 전까지 여기에 담아 둔다. 새로 그려도 사라지지 않아야 한다.
  const imageDrafts = new Map();
  const resultCache = new Map();
  // 확대창에 넘길 후보 묶음. dataset 에 담기엔 커서 노드 키로 따로 보관한다.
  const zoomPayloads = new Map();
  // 새로 그릴 때마다 img 를 새로 만들면 브라우저가 그림을 다시 받아 화면이 깜빡인다.
  // 같은 자리·같은 주소면 만들어 둔 노드를 그대로 다시 쓴다.
  const thumbNodes = new Map();
  // 보관함을 아직 받는 중인 작업. 칸에 "불러오는 중" 이라고 적어 준다.
  let pendingResultJobs = new Set();
  // 마지막으로 그린 표의 요약. 같으면 다시 그리지 않는다.
  let lastBoardSignature = '';
  // 마지막으로 그린 표. 버튼 처리에서 그 행의 원본 값을 다시 찾아야 할 때 쓴다.
  let lastBoard = null;
  // 바뀌지 않은 행은 만들어 둔 것을 그대로 다시 쓴다. 매번 새로 만들면 누르는 순간
  // 손 밑의 버튼이 다른 노드로 갈아 끼워져 mousedown 과 mouseup 이 서로 다른 노드에
  // 떨어지고, 브라우저는 click 을 아예 만들지 않는다. 그것이 "눌러도 반응이 없다" 다.
  const rowNodes = new Map();
  // 어떤 프롬프트로 만든 컷인지는 눌러야 알 수 있었다. 이제 카드마다 펼쳐 본다.
  // 프롬프트는 폴링에 싣지 않는다 — 누를 때만 그 컷의 보관함에서 받아 온다.
  const promptCache = new Map();
  // 캐시는 키가 그대로여도 값이 '받는 중' → '받음' 으로 바뀐다. 키만 서명에 넣으면
  // 그 변화가 안 잡혀 화면이 영영 '가져오는 중' 에 머문다.
  let promptCacheVersion = 0;
  const openPrompts = new Set();
  const PROMPT_ALWAYS_KEY = 'controlTower.promptAlwaysOpen';
  // 새 컷 만들기 칸이 열려 있는 곳. "작업:단계" 로 기억한다.
  let openCompose = '';
  let promptAlwaysOpen = (() => {
    try { return localStorage.getItem(PROMPT_ALWAYS_KEY) === '1'; } catch { return false; }
  })();
  // 그래도 그 행 자체가 바뀌는 순간에 손이 눌려 있으면 같은 일이 생긴다. 누르고 있는
  // 동안에는 그 행만 그대로 두고, 손을 뗀 뒤에 갱신한다. 다른 행은 평소대로 갱신된다.
  let heldJobId = '';
  let deferredRender = false;
  let stopped = false;
  let loaded = false;
  let eventSource = null;
  // 지금까지 화면에 반영된 이벤트 자리. 스트림은 이 다음부터 듣는다.
  let eventCursor = '0';
  let eventRefreshTimer = null;

  const grid = element('div', 'board-grid');
  grid.addEventListener('pointerdown', event => {
    const holder = event.target instanceof Element ? event.target.closest('[data-job-id]') : null;
    heldJobId = holder ? String(holder.dataset.jobId || '') : '';
  });
  const releaseHeldRow = () => {
    if (!heldJobId) return;
    heldJobId = '';
    if (!deferredRender) return;
    deferredRender = false;
    // click 은 이미 제 버튼에서 끝났다. 이제 미뤄 둔 갱신을 반영한다.
    setTimeout(() => render(), 0);
  };
  grid.addEventListener('pointerup', releaseHeldRow);
  grid.addEventListener('pointercancel', releaseHeldRow);
  // 버튼 밖에서 손을 떼면 grid 는 pointerup 을 못 받는다. 창 전체에서도 풀어 준다.
  globalThis.addEventListener?.('pointerup', releaseHeldRow);
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

  // 조립공장이 마지막으로 말한 지 이만큼 지나면, 붙어 있어도 응답이 없는 것으로 본다.
  // 평소 보고 간격은 10초 안쪽이라 2분이면 느린 것과 멎은 것이 갈린다.
  const WORKER_SILENCE_WARN_MS = 2 * 60 * 1000;

  function workerSilenceMs() {
    if (!workerHeartbeatAt) return 0;
    const beat = Date.parse(workerHeartbeatAt);
    if (!Number.isFinite(beat)) return 0;
    return Math.max(0, Date.now() - beat);
  }

  function renderConnection() {
    if (connected === false) {
      connection.hidden = false;
      connection.dataset.tone = 'error';
      connection.textContent = '조립공장이 연결되지 않았습니다 · 상세페이지 AI 자동화를 실행하면 멈춘 작업이 다시 흐릅니다.';
      renderWorkerFrontendHint();
      return;
    }
    const silence = workerSilenceMs();
    if (silence >= WORKER_SILENCE_WARN_MS) {
      connection.hidden = false;
      connection.dataset.tone = 'warning';
      connection.textContent = `조립공장이 ${durationLabel(silence)}째 응답이 없습니다 · `
        + '큰 상세페이지를 올리는 중일 수 있습니다. 이대로 계속되면 작업자 창을 닫았다가 다시 열어 주세요.';
      return;
    }
    connection.hidden = true;
  }

  /**
   * 조립공장 화면 서버(8081)가 내려가 있으면 워커는 영영 붙지 못한다. 그때 "연결되지
   * 않았습니다" 만 보이면, 사람은 자동화를 다시 실행해 보다가 원인을 못 찾는다.
   * 실측 2026-08-25: 8081 이 죽어 워커 탭이 ERR_CONNECTION_REFUSED 였는데 화면에는
   * 그 사실이 어디에도 없었다. 서버가 살아 있는지 눌러 보고 사실대로 덧붙인다.
   */
  function renderWorkerFrontendHint() {
    const base = 'http://127.0.0.1:8081/app.html';
    fetch(base, { method: 'GET', cache: 'no-store', mode: 'no-cors' })
      .then(() => {
        if (connection.hidden) return;
        connection.textContent = '조립공장이 연결되지 않았습니다 · 조립공장 화면은 떠 있습니다. '
          + '작업자 창을 열어 두었는지 확인해 주세요: ' + base;
      })
      .catch(() => {
        if (connection.hidden) return;
        connection.textContent = '조립공장 화면 서버(8081)가 내려가 있습니다 · '
          + '바탕화면 "생산관제" 를 다시 실행하면 함께 올라옵니다.';
      });
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
    const resume = button('board-action', '선택 끝난 작업 일괄 재개', { action: 'resume' });
    const clear = button('board-action ghost', '예약 모두 지우기', { action: 'clear' });
    auto.disabled = busy || pickable === 0;
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
    toolbar.replaceChildren(auto, resume, clear, toggle, hint);
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
  { name: 'registrationMode', label: '등록 방식', placeholder: '',
    options: [['', '조립공장 판단에 맡김'], ['create', '새 상품으로 등록'], ['update', '기존 상품 수정']] },
  // 고칠 상품을 사람이 못박을 수 있어야 한다. 비워 두면 조립공장이 후보에서 고르는데,
  // 그것이 사람이 생각한 상품과 같다는 보장이 없다.
  { name: 'targetProductNo', label: '수정할 상품번호', placeholder: '기존 상품 수정일 때만 · 예: 3011' },
  { name: 'categoryId', label: '상품분류 번호', placeholder: '비우면 스토어 값을 씁니다' },
  { name: 'salePrice', label: '판매가', placeholder: '예: 2700' },
  { name: 'supplyPrice', label: '공급가', placeholder: '예: 500' },
  { name: 'displayStatus', label: '진열 (T/F)', placeholder: 'F = 진열 안 함' },
  { name: 'sellingStatus', label: '판매 (T/F)', placeholder: 'F = 판매 안 함' },
]);

  const REQUIRED_VALUE_ORDER = Object.freeze([
    // 가로·세로가 없으면 사이즈이미지 단계에서 막히므로, 여기서도 채울 수 있어야 한다.
    'category', 'material', 'originCountry', 'size', 'widthMm', 'depthMm',
    'salePrice', 'stock', 'usage', 'optionMode',
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
    // 저장하지 않고 그냥 덮는 길도 있어야 한다. 저장 버튼 하나만 두면 구경만 하고
    // 싶어도 저장을 눌러야 하는 것처럼 읽힌다.
    head.append(button('board-action ghost', '닫기', { action: 'panel-close', panel: 'values' }));
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
      button('board-action ghost', '닫기', { action: 'panel-close', panel: 'cafe24' }),
    );
    form.append(title);
    const grid = element('div', 'board-cafe24-fields');
    let modeSelect = null;
    let targetInput = null;
    for (const field of CAFE24_VALUE_FIELDS) {
      const label = element('label', 'board-cafe24-field');
      label.append(element('span', 'board-cafe24-field-label', field.label));
      if (field.options) {
        const select = document.createElement('select');
        select.name = field.name;
        for (const option of field.options) {
          const node = document.createElement('option');
          node.value = option[0];
          node.textContent = option[1];
          select.append(node);
        }
        select.value = String(row.cafe24Values?.[field.name] || '');
        label.append(select);
        if (field.name === 'registrationMode') modeSelect = select;
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.name = field.name;
        input.placeholder = field.placeholder;
        input.value = String(row.cafe24Values?.[field.name] || '');
        label.append(input);
        if (field.name === 'targetProductNo') targetInput = input;
      }
      grid.append(label);
    }
    // 새 상품으로 올리기로 했으면 고칠 상품번호는 뜻이 없다. 남아 있는 값을 그대로 보내면
    // 서로 어긋난 지시가 되어 거절당한다. 화면에서 먼저 막고, 무엇이 잠겼는지 보여 준다.
    const syncTargetAvailability = () => {
      if (!targetInput || !modeSelect) return;
      const creating = modeSelect.value === 'create';
      targetInput.disabled = creating;
      if (creating) targetInput.value = '';
      targetInput.placeholder = creating
        ? '새 상품으로 올릴 때는 쓰지 않습니다'
        : '기존 상품 수정일 때만 · 예: 3011';
    };
    if (modeSelect) modeSelect.addEventListener('change', syncTargetAvailability);
    syncTargetAvailability();
    // 상품번호는 숫자만 받는다. 화면에서 안 막으면 글자를 넣고 등록을 눌러야 비로소
    // 서버가 거절하고, 그때 뜨는 건 사람이 못 읽는 코드다. 여기서 먼저 걸러 낸다.
    if (targetInput) {
      targetInput.inputMode = 'numeric';
      targetInput.autocomplete = 'off';
      targetInput.pattern = '[0-9]*';
      targetInput.title = '상품번호는 숫자만 넣습니다';
      targetInput.addEventListener('input', () => {
        const digits = targetInput.value.replace(/[^0-9]/g, '');
        if (digits !== targetInput.value) targetInput.value = digits;
      });
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

  // 상세페이지 섹션의 정식 차례와 이름. 원본은 src/app-core-01.js 의 SECTIONS 이고,
  // 관제탑은 그 모듈을 읽을 수 없어 같은 차례를 여기에 옮겨 둔다. id 가 어긋나면
  // 아래 목록에 없는 섹션은 뒤로 밀려 나오되 사라지지는 않는다.
  const SECTION_CATALOGUE = Object.freeze([
    { id: 'header', label: '헤더 (Header)' },
    { id: 'hook', label: '훅 (Hook)' },
    { id: 'key_features', label: '핵심 특징 (Key Features)' },
    { id: 'specifications', label: '상세 스펙 (Specifications)' },
    { id: 'use_scenarios', label: '사용 시나리오 (Use Scenarios)' },
    { id: 'competitive_edge', label: '비교 우위 (Competitive Edge)' },
    { id: 'material_tech', label: '소재/기술 (Material & Tech)' },
    { id: 'certifications', label: '인증/수상 (Certifications)' },
    { id: 'reviews', label: '리뷰/후기 (Reviews)' },
    { id: 'size_color', label: '색상옵션' },
    { id: 'promotion', label: '프로모션 (Promotion)' },
    { id: 'shipping', label: '배송/포장 (Shipping)' },
    { id: 'faq', label: 'FAQ (자주 묻는 질문)' },
    { id: 'brand_story', label: '브랜드 스토리' },
    { id: 'cta_footer', label: 'CTA 푸터 (Footer)' },
  ]);
  const SECTION_ORDER = new Map(SECTION_CATALOGUE.map((item, index) => [item.id, index]));
  const SECTION_LABELS = new Map(SECTION_CATALOGUE.map(item => [item.id, item.label]));

  function sectionLabel(sectionId) {
    const known = SECTION_LABELS.get(sectionId);
    if (known) return known;
    // 모르는 값을 그대로 뱉으면 factory_detail_… 같은 원시 식별자가 제목이 된다.
    // 사람이 읽을 수 없는 글자는 화면에 내보내지 않는다.
    const raw = String(sectionId || '').trim();
    return raw && !/^factory_[a-z]+_/i.test(raw) ? raw : '기타 섹션';
  }

  /** 섹션 단계의 후보를 섹션별로 묶어 정식 차례대로 돌려준다. */
  function groupSectionCandidates(cell) {
    const groups = new Map();
    for (const candidate of cell.candidates) {
      const sectionId = candidate.sectionId || '기타';
      if (!groups.has(sectionId)) groups.set(sectionId, []);
      groups.get(sectionId).push(candidate);
    }
    const selected = new Set([...(cell.selectedIds || []), cell.selectedId].filter(Boolean));
    return [...groups.entries()]
      .map(([sectionId, candidates]) => ({
        sectionId,
        label: sectionLabel(sectionId),
        candidates,
        selectedId: candidates.find(candidate => selected.has(candidate.id))?.id || '',
      }))
      .sort((left, right) => {
        const a = SECTION_ORDER.has(left.sectionId) ? SECTION_ORDER.get(left.sectionId) : 999;
        const b = SECTION_ORDER.has(right.sectionId) ? SECTION_ORDER.get(right.sectionId) : 999;
        return a - b || left.sectionId.localeCompare(right.sectionId);
      });
  }

  /**
   * 카드에 적을 이름. 조립공장이 붙인 이름에 영문 섹션 id 가 그대로 남아 있는
   * 경우가 있다("섹션 이미지 size_color"). 사람이 읽는 이름으로 바꿔 준다.
   */
  function readableCandidateLabel(candidate, index) {
    const raw = String(candidate.label || '').trim();
    const sectionId = String(candidate.sectionId || '').trim();
    if (!raw) return sectionId ? sectionLabel(sectionId) : `시안 ${index + 1}`;
    if (sectionId && SECTION_LABELS.has(sectionId) && raw.includes(sectionId)) {
      return raw.split(sectionId).join(SECTION_LABELS.get(sectionId)).replace(/\s+/g, ' ').trim();
    }
    return raw;
  }

  // 상세페이지 변형의 본문. 그림이 없는 후보라 문서를 그대로 그려 보여 준다.
  const documentCache = new Map();
  let documentCacheVersion = 0;

  /**
   * 문서 안의 그림 주소를 관제탑에서도 열리는 주소로 바꾼다.
   *
   * 본문은 조립공장 쪽에서 만들어져 두 가지 주소를 섞어 쓴다 —
   * 보관함 API 경로(/api/local-archive/...)는 조립공장 백엔드가, 나머지 상대경로는
   * 조립공장 화면 서버가 내준다. 관제탑은 둘 다 다른 오리진이라 그대로 두면 깨진다.
   * 스크립트는 막고(sandbox) 주소만 손본다.
   */
  function embeddableDocument(html) {
    const body = String(html || '');
    if (!body) return '';
    const rewritten = body.replace(
      /(\s(?:src|href)\s*=\s*)(["'])(?!https?:|data:|#|mailto:)([^"']*)\2/gi,
      (whole, prefix, quote, url) => {
        const target = String(url || '').trim();
        if (!target) return whole;
        const origin = target.startsWith('/api/') ? factoryBackend : factoryApp;
        if (!origin) return whole;
        const joined = target.startsWith('/') ? `${origin}${target}` : `${origin}/${target}`;
        return `${prefix}${quote}${joined}${quote}`;
      },
    );
    // 문서가 스스로 스크립트를 돌리거나 창을 옮기지 못하게 한다. 보기만 하는 자리다.
    return `<!doctype html><meta charset="utf-8"><base target="_blank">${rewritten}`;
  }

  /**
   * 최종 문서 변형의 요약("섹션 14개 · 8월 28일 10:26")에서 섹션 수만 뽑는다.
   * 숫자를 못 찾으면 null — 그때는 비교를 하지 않는다.
   */
  function candidateSectionCount(candidate) {
    const matched = /섹션\s*(\d+)\s*개/.exec(String(candidate?.summary || ''));
    return matched ? Number(matched[1]) : null;
  }

  /** 그 변형의 본문을 보관함에서 받아 온다. 한 번 받으면 기억한다. */
  async function loadCandidateDocument(candidate) {
    const key = String(candidate.id || '');
    const archiveId = String(candidate.documentArchiveId || '').trim();
    if (!key || documentCache.has(key)) return;
    if (!archiveId) {
      documentCache.set(key, { html: '', note: '이 변형은 본문이 보관되기 전에 만들어져 미리보기가 없습니다.' });
      documentCacheVersion += 1;
      render();
      return;
    }
    documentCache.set(key, { loading: true });
    documentCacheVersion += 1;
    try {
      const body = await apiRequest(`/api/factory/archive-document/${encodeURIComponent(archiveId)}`);
      documentCache.set(key, {
        html: embeddableDocument(body?.html),
        note: String(body?.note || '').trim(),
      });
    } catch (error) {
      documentCache.set(key, { html: '', note: `본문을 가져오지 못했습니다 · ${String(error?.message || error)}` });
    }
    documentCacheVersion += 1;
    render();
  }

  /** 그 컷의 보관함 주소에서 만든 프롬프트를 받아 온다. 한 번 받으면 기억한다. */
  async function loadCandidatePrompt(candidate) {
    const key = String(candidate.id || '');
    if (!key || promptCache.has(key)) return;
    // 보관 주소는 그림에서만 캐던 탓에, 그림이 없는 문서 변형은 프롬프트가 있어도
    // 늘 "기록 없음" 이 나왔다. 문서는 자기 보관 id 를 따로 들고 있으니 그것도 본다.
    const source = String(candidate.thumbnailUrl || '');
    const archiveId = (source.match(/\/local-archive\/assets\/([^/?#]+)\//) || [])[1]
      || String(candidate.documentArchiveId || '').trim();
    if (!archiveId) {
      promptCache.set(key, { prompt: '', note: '이 컷은 보관함 기록이 없어 프롬프트를 찾을 수 없습니다.' });
      promptCacheVersion += 1;
      render();
      return;
    }
    promptCache.set(key, { loading: true });
    promptCacheVersion += 1;
    try {
      // 조립공장 백엔드는 다른 오리진이라 fetch 가 막힌다. 관제탑이 같은 보관함을
      // 디스크로 읽어 내주므로 그쪽에 묻는다. 실측 2026-08-26: 5050 직접 호출은
      // Failed to fetch 였다.
      const body = await apiRequest(`/api/factory/archive-prompt/${encodeURIComponent(archiveId)}`);
      promptCache.set(key, {
        prompt: String(body?.prompt || '').trim(),
        note: String(body?.note || '').trim(),
      });
      promptCacheVersion += 1;
    } catch (error) {
      promptCache.set(key, { prompt: '', note: `프롬프트를 가져오지 못했습니다 · ${String(error?.message || error)}` });
      promptCacheVersion += 1;
    }
    render();
  }

  function renderCandidatePrompt(candidate) {
    const box = element('div', 'board-candidate-prompt');
    const entry = promptCache.get(String(candidate.id || ''));
    if (!entry || entry.loading) {
      box.append(element('span', 'board-candidate-meta', '프롬프트를 가져오는 중입니다.'));
      return box;
    }
    if (entry.prompt) box.append(element('p', '', entry.prompt));
    else box.append(element('span', 'board-candidate-meta', entry.note || '프롬프트가 없습니다.'));
    return box;
  }

  /** 프롬프트를 늘 펼쳐 둘지 접어 둘지는 사람마다 다르다. 고른 것을 기억한다. */
  function promptAlwaysToggle() {
    const toggle = button(
      'board-action ghost',
      promptAlwaysOpen ? '프롬프트 항상 펼침 · 켜짐' : '프롬프트 항상 펼침 · 꺼짐',
      { action: 'prompt-always' },
    );
    toggle.dataset.on = promptAlwaysOpen ? 'true' : 'false';
    return toggle;
  }

  /**
   * 후보 줄 맨 오른쪽의 '＋ 새 컷 만들기'.
   * 있는 것 중에서만 고르게 하면 마음에 드는 것이 없을 때 길이 막힌다.
   * 프롬프트를 적어 그 자리에서 새로 만들 수 있어야 한다.
   */
  function renderComposeSlot(row, cell) {
    const key = `${row.jobId}:${cell.stageKey}`;
    const slot = element('div', 'board-compose-slot');
    if (openCompose !== key) {
      const open = button('board-compose-open', '＋', {
        action: 'compose-open',
        jobId: row.jobId,
        stageKey: cell.stageKey,
      });
      open.title = `${cell.stageLabel} 새 컷 만들기`;
      open.disabled = busy;
      slot.append(open);
      slot.append(element('span', 'board-candidate-meta', '새 컷 만들기'));
      return slot;
    }
    const form = element('form', 'board-compose-form');
    form.dataset.jobId = row.jobId;
    form.dataset.stageKey = cell.stageKey;
    form.addEventListener('submit', event => event.preventDefault());
    form.append(element('strong', '', `${cell.stageLabel} 새 컷 만들기`));
    const label = element('label', 'board-cafe24-field');
    label.append(element('span', 'board-cafe24-field-label', '프롬프트'));
    const input = document.createElement('textarea');
    input.name = 'prompt';
    input.rows = 4;
    input.placeholder = '예: 밝은 회백색 스튜디오 배경, 제품 중앙 정렬, 넉넉한 여백';
    label.append(input);
    form.append(label);
    const actions = element('div', 'board-row-actions');
    const submit = button('board-mini-action', '이 프롬프트로 만들기', {
      action: 'compose-submit',
      jobId: row.jobId,
      stageKey: cell.stageKey,
    });
    submit.disabled = busy;
    actions.append(submit);
    actions.append(button('board-action ghost', '닫기', { action: 'compose-open', jobId: row.jobId, stageKey: cell.stageKey }));
    form.append(actions);
    slot.append(form);
    return slot;
  }

  function renderCandidateOption(row, cell, candidate, { index, total, picked, fallbackThumbUrl = '', bestSectionCount = null }) {
    const option = button('board-candidate', '', {
      action: 'pick',
      jobId: row.jobId,
      stageKey: cell.stageKey,
      candidateId: candidate.id,
    });
    option.disabled = busy;
    if (candidate.id === cell.reservedCandidateId) option.dataset.reserved = 'true';
    if (picked) option.dataset.picked = 'true';
    // 무엇으로 보여 줄지는 모델이 한 번에 정한다. 여기서 조건을 줄줄이 걸러 내려가면
    // 칸이 빠진 옛 기록이 어느 갈래에도 걸리지 않아 원시 id 가 그대로 뜬다.
    const presentation = candidatePresentation(candidate, cell.stageKey);
    if (presentation === 'image' && candidate.thumbnailUrl) {
      const image = document.createElement('img');
      image.src = assetUrl ? assetUrl(candidate.thumbnailUrl) : candidate.thumbnailUrl;
      image.alt = `${cell.stageLabel} 후보 ${candidate.id}`;
      image.loading = 'lazy';
      // 작은 그림으로는 고를 수 없다. 그림을 누르면 크게 본다. 카드의 나머지를
      // 누르면 그 컷을 고른다 — 보는 것과 고르는 것을 갈라 놓는다.
      image.dataset.zoomSrc = candidate.thumbnailUrl;
      image.dataset.zoomLabel = `${row.productName} · ${cell.stageLabel}`;
      option.append(image);
    } else if (presentation === 'document') {
      // 상세페이지 변형은 그림이 아니라 문서다. 보관함에 남은 본문을 그대로 그려
      // 무엇을 고르는지 눈으로 보게 한다. 문서가 없던 시절 변형은 글로만 알려 준다.
      void loadCandidateDocument(candidate);
      const entry = documentCache.get(String(candidate.id || ''));
      const frame = element('div', 'board-candidate-doc');
      if (entry?.html) {
        const view = document.createElement('iframe');
        view.className = 'board-candidate-doc-view';
        view.setAttribute('sandbox', '');
        view.setAttribute('loading', 'lazy');
        view.setAttribute('tabindex', '-1');
        view.setAttribute('aria-hidden', 'true');
        view.srcdoc = entry.html;
        frame.append(view);
      } else {
        frame.dataset.state = entry?.loading ? 'loading' : 'empty';
        frame.append(element('span', '', entry?.loading ? '본문 불러오는 중' : (entry?.note || '미리보기 없음')));
      }
      option.append(frame);
      const note = element('div', 'board-candidate-note');
      note.dataset.kind = 'html';
      note.append(element('strong', '', candidate.summary || '상세페이지 HTML'));
      option.append(note);
    } else if (fallbackThumbUrl) {
      // 이 변형의 그림이 곧 지금 섹션 그림이다. 이미 받아 둔 것을 그대로 쓴다.
      // 문서(상세페이지) 변형보다 뒤에 둔다 — 상세 변형에 섹션 그림을 붙이면
      // 그 변형과 아무 상관 없는 그림을 보고 고르게 된다.
      const image = document.createElement('img');
      image.src = assetUrl ? assetUrl(fallbackThumbUrl) : fallbackThumbUrl;
      image.alt = `${cell.stageLabel} 후보`;
      image.loading = 'lazy';
      image.dataset.zoomSrc = fallbackThumbUrl;
      image.dataset.zoomLabel = `${row.productName} · ${cell.stageLabel}`;
      option.append(image);
    } else {
      // 변형끼리 무엇이 다른지를 대신 보여 준다. 제목은 변형마다 똑같고 패널 머리글에도
      // 이미 있어 넣지 않는다 — 여러 장이 같은 글자로 채워지면 되레 구분이 가려진다.
      const note = element('div', 'board-candidate-note');
      if (candidate.summary) note.append(element('strong', '', candidate.summary));
      else note.append(element('strong', '', readableCandidateLabel(candidate, index)));
      note.append(element('span', '', '문구 정보 없음'));
      option.append(note);
    }
    // 사람이 읽는 이름은 "변형 2/4" 다. 원시 식별자는 눈으로 구분되지 않는다.
    option.append(element('span', 'board-candidate-label', total > 1 ? `변형 ${index + 1}/${total}` : '변형 1'));
    if (picked) {
      const mark = element('span', 'board-candidate-meta', '선택컷');
      mark.dataset.tone = 'picked';
      option.append(mark);
    }
    // 최종 문서 변형은 담긴 섹션 수가 천차만별이다. 가장 빈 것이 골라져 있어도 화면이
    // 아무 말을 안 해서, 거의 빈 상세페이지가 등록될 뻔했다 - 실측 2026-08-31:
    // 섹션 1개(8월 22일)짜리가 선택된 채였고 옆에 섹션 14개(8월 28일)가 있었다.
    const sectionCount = candidateSectionCount(candidate);
    if (sectionCount !== null && bestSectionCount !== null && bestSectionCount > 0) {
      if (sectionCount < bestSectionCount) {
        const warn = element('span', 'board-candidate-meta',
          `섹션 ${sectionCount}개 · 가장 많은 변형보다 ${bestSectionCount - sectionCount}개 적습니다`);
        warn.dataset.tone = 'warn';
        option.append(warn);
      } else if (total > 1) {
        const best = element('span', 'board-candidate-meta', `섹션 ${sectionCount}개 · 가장 많음`);
        best.dataset.tone = 'ok';
        option.append(best);
      }
    }
    // 카드 안에 이미 적은 글을 밑에 또 적으면 같은 문장이 두 번 나온다.
    // 그림이 있는 컷만 여기서 이름을 덧붙인다.
    else if (candidate.thumbnailUrl && candidate.label) {
      option.append(element('span', 'board-candidate-meta', readableCandidateLabel(candidate, index)));
    }
    else if (candidate.thumbnailUrl && candidate.model) {
      option.append(element('span', 'board-candidate-meta', candidate.model));
    }
    option.title = candidate.id;
    const wrap = element('div', 'board-candidate-slot');
    wrap.append(option);
    // 카드 자체는 '고르기' 버튼이라 그 안에 또 버튼을 넣을 수 없다. 밖에 붙인다.
    const promptOpen = promptAlwaysOpen || openPrompts.has(String(candidate.id || ''));
    const toggle = button('board-prompt-toggle', promptOpen ? '프롬프트 접기' : '프롬프트 보기', {
      action: 'prompt-toggle',
      candidateId: candidate.id,
    });
    wrap.append(toggle);
    if (promptOpen) {
      if (!promptCache.has(String(candidate.id || ''))) void loadCandidatePrompt(candidate);
      wrap.append(renderCandidatePrompt(candidate));
    }
    return wrap;
  }

  /**
   * 보관함 파일 이름을 사람이 읽는 이름으로 줄인다.
   * "091019_차분한_대표_이미지_generated_hero_1_m" 은 앞이 시각이고 뒤가 기계용 꼬리다.
   * 그대로 두면 칸 안에서 네 줄로 접혀 무엇인지 알아볼 수 없다. 가운데만 남긴다.
   */
  function readableAssetName(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const withoutStamp = raw.replace(/^\d{6,}_/, '');
    const withoutTail = withoutStamp.replace(/_(generated|factory|section|archive)_[\w-]*$/i, '');
    const cleaned = withoutTail.replace(/_+/g, ' ').trim();
    return cleaned || raw;
  }

  /** 재개가 막힌 이유를 사람 말로 옮긴다. 모르는 코드는 그대로 보여 준다. */
  const RESUME_REASONS = Object.freeze({
    factory_worker_build_not_admitted: '조립공장 화면이 낡음 (작업자 창을 새로 열어 주세요)',
    factory_session_missing: '조립공장이 붙어 있지 않음',
    factory_product_job_busy: '조립공장이 이 작업을 물고 있음',
    factory_product_job_not_found: '작업을 찾을 수 없음',
    factory_product_decision_required: '먼저 컷을 골라야 함',
  });

  function renderCandidateStrip(row, cell) {
    const strip = element('div', 'board-candidate-strip');
    strip.dataset.jobId = row.jobId;
    strip.dataset.stageKey = cell.stageKey;
    const title = element('div', 'board-candidate-heading');
    title.append(
      element('strong', '', `${row.productName} · ${cell.stageLabel}`),
      element('span', 'factory-pill', `${cell.candidateCount}개 후보`),
    );
    // 라벨만으로는 "최종" 이 무엇의 최종인지, "섹션 14개" 가 무슨 뜻인지 알 수 없다 -
    // 실측 2026-08-31: 조작자가 "최종이라는게 뭐며 섹션 1개 2개 13개 14개가 뭘 말하는건지"
    // 라고 물었다. 고르는 자리에서 바로 답해 준다.
    const stageHint = BOARD_STAGES.find(stage => stage.key === cell.stageKey)?.hint;
    if (stageHint) title.append(element('span', 'board-candidate-meta', stageHint));
    // 고른 컷은 바로 적용되지 않는다. 그 사실을 안 적으면 "눌렀는데 아무 일도 없다" 가 된다.
    title.append(element('span', 'board-candidate-meta',
      '고르면 예약됩니다. 「다시 시도」를 눌러야 조립공장이 반영합니다.'));
    // 섹션 단계는 여러 섹션의 변형이 한 칸에 함께 온다. 한 줄로 쏟으면 52개가 원시
    // 식별자만 달고 늘어서서 사람이 무엇을 고르는지 알 수 없다. 섹션마다 나눠 놓는다.
    if (cell.stageKey === 'sections' && cell.candidates.some(candidate => candidate.sectionId)) {
      const groups = groupSectionCandidates(cell);
      title.append(element('span', 'factory-pill', `${groups.length}개 섹션`));
      const stitch = button('board-action ghost', '이어붙여 보기', {
        action: 'stitch-sections',
        jobId: row.jobId,
      });
      stitch.disabled = busy;
      title.append(stitch);
      title.append(promptAlwaysToggle());
      title.append(button('board-action ghost', '닫기', { action: 'panel-close', panel: 'cell' }));
      strip.append(title);
      // 섹션마다 '지금 이렇게 생겼다' 를 왼쪽 기둥으로 붙인다. 변형 낱개에는 그림이
      // 없어서, 이것 없이는 화면이 통째로 "미리보기 없음" 벽이 된다. 제목과 변형은
      // 그림 오른쪽을 채워, 그림 옆이 텅 비지 않게 한다.
      const entry = resultCache.get(row.jobId);
      const shots = entry && !entry.error && Array.isArray(entry.assets)
        ? sectionShotsById(entry.assets)
        : new Map();
      for (const group of groups) {
        const block = element('div', 'board-section-group');
        const shot = shots.get(group.sectionId);
        // 지금 쓰는 컷은 카드로 이미 보이고 '지금 쓰는 컷' 이라고 적혀 있다.
        // 왼쪽에 같은 그림을 한 번 더 두면 서로 다른 안이 둘인 것처럼 읽힌다.
        // 실측 2026-08-26: 헤더의 왼쪽 기준 그림과 변형 1/3 카드가 같은 그림이었다.
        // 고른 변형이 없어서 카드에 그림이 하나도 없을 때만 기준 그림을 둔다.
        const anyCardHasImage = !!group.selectedId || group.candidates.length === 1;
        if (shot && !anyCardHasImage) {
          const preview = document.createElement('img');
          preview.className = 'board-section-preview';
          preview.alt = `${group.label} 현재 이미지`;
          preview.decoding = 'async';
          preview.loading = 'lazy';
          preview.src = assetUrl
            ? assetUrl(shot.asset.thumbnailReference || shot.asset.contentReference)
            : (shot.asset.thumbnailReference || shot.asset.contentReference);
          preview.dataset.zoomSrc = shot.asset.contentReference || shot.asset.thumbnailReference;
          preview.dataset.zoomLabel = `${row.productName} · ${group.label}`;
          block.append(preview);
        }
        const copy = element('div', 'board-section-copy');
        const heading = element('div', 'board-section-group-heading');
        heading.append(element('strong', '', group.label));
        heading.append(element('span', 'board-candidate-meta',
          group.candidates.length > 1 ? `${group.candidates.length}개 변형` : '변형 1개'));
        // '아직 안 고름' 은 지금 고를 차례일 때만 뜻이 있다. 끝난 단계에 붙이면
        // 이미 쓰이고 있는 섹션을 미완성처럼 읽게 만든다.
        if (!group.selectedId && cell.pickable) {
          heading.append(element('span', 'factory-pill', '선택 대기'));
        }
        copy.append(heading);
        const groupOptions = element('div', 'board-candidate-options');
        // 변형이 하나뿐이고 고를 차례도 아니면, 그 하나가 지금 쓰이는 컷이다.
        const soleInUse = !group.selectedId && !cell.pickable && group.candidates.length === 1;
        for (const [index, candidate] of group.candidates.entries()) {
          // 지금 이 섹션에 실제로 쓰이는 그림은 '고른 변형' 하나뿐이다.
          // imageRef 가 current-section-image 라는 말은 "만들 당시 현재였다" 는 뜻이지
          // "지금도 이 그림이다" 가 아니다. 그것을 현재 그림으로 읽어 모든 변형에
          // 같은 그림을 붙이면, 서로 다른 안이 똑같아 보인다. 빈 칸보다 나쁘다.
          // 실측 2026-08-26: 인증/수상 3개 변형이 전부 같은 그림으로 떴다.
          const usesCurrent = candidate.id === group.selectedId || soleInUse;
          groupOptions.append(renderCandidateOption(row, cell, candidate, {
            index,
            total: group.candidates.length,
            picked: candidate.id === group.selectedId || soleInUse,
            fallbackThumbUrl: usesCurrent && shot
              ? (shot.asset.thumbnailReference || shot.asset.contentReference)
              : '',
          }));
        }
        groupOptions.append(renderComposeSlot(row, { ...cell, stageKey: `sections:${group.sectionId}`, stageLabel: group.label }));
        copy.append(groupOptions);
        block.append(copy);
        strip.append(block);
      }
      if (cell.reservedCandidateId) {
        const cancel = button('board-action ghost', '이 작업 예약 취소', { action: 'clear-one', jobId: row.jobId });
        cancel.disabled = busy;
        strip.append(cancel);
      }
      return strip;
    }
    title.append(promptAlwaysToggle());
    title.append(button('board-action ghost', '닫기', { action: 'panel-close', panel: 'cell' }));
    strip.append(title);
    const options = element('div', 'board-candidate-options');
    // 최종 문서 변형끼리 분량을 견줄 수 있게 가장 많은 섹션 수를 미리 구한다.
    const sectionCounts = cell.candidates
      .map(candidateSectionCount)
      .filter(value => typeof value === 'number');
    const bestSectionCount = sectionCounts.length ? Math.max(...sectionCounts) : null;
    for (const [index, candidate] of cell.candidates.entries()) {
      options.append(renderCandidateOption(row, cell, candidate, {
        index,
        total: cell.candidates.length,
        picked: candidate.id === cell.selectedId,
        bestSectionCount,
      }));
    }
    options.append(renderComposeSlot(row, cell));
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
    title.append(button('board-action ghost', '닫기', { action: 'panel-close', panel: 'results' }));
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
        const label = element('span', 'board-candidate-label', readableAssetName(cut.displayName));
        // 원래 파일 이름은 보관함에서 찾을 때 필요하다. 지우지 않고 손 올렸을 때 보인다.
        label.title = cut.displayName;
        card.append(image, label);
        options.append(card);
      }
      strip.append(options);
    }
    return strip;
  }

  /**
   * 확대창에 넘길 후보 묶음을 만든다.
   * 조립공장이 준 후보에 그림이 없으면(섹션이 그렇다) 보관함의 그 단계 자산으로 채운다.
   * 다만 보관함 자산의 키는 조립공장이 아는 후보 번호가 아니므로, 그때는 보기만 하고
   * 고르지는 못하게 한다. 엉뚱한 번호를 보내 잘못 고르게 만드느니 못 고르는 편이 낫다.
   */
  function buildZoomPayload(row, cell) {
    const label = `${row.productName} · ${cell.stageLabel}`;
    const source = cell.selectedContentUrl || cell.selectedThumbnailUrl;
    const live = (cell.candidates || [])
      .filter(candidate => candidate && candidate.thumbnailUrl)
      .map(candidate => ({
        id: candidate.id,
        thumbnailUrl: candidate.thumbnailUrl,
        contentUrl: candidate.contentUrl || candidate.thumbnailUrl,
      }));
    if (live.length) {
      return {
        source,
        label,
        jobId: row.jobId,
        stageKey: cell.stageKey,
        candidates: live,
        startIndex: Math.max(0, (cell.selectedIndex || 1) - 1),
        canPick: cell.pickable || cell.changeable,
      };
    }
    const entry = resultCache.get(String(row.jobId));
    const archived = entry && !entry.error && Array.isArray(entry.assets)
      ? entry.assets.map(record)
      : [];
    const shots = archived
      .filter(asset => String(asset.phase || '') === 'output'
        && String(asset.stage || '') === cell.stageKey)
      .map(asset => ({
        id: '',
        thumbnailUrl: String(asset.thumbnailReference || ''),
        contentUrl: String(asset.contentReference || asset.thumbnailReference || ''),
      }))
      .filter(shot => shot.contentUrl || shot.thumbnailUrl);
    return {
      source,
      label,
      jobId: row.jobId,
      stageKey: cell.stageKey,
      candidates: shots,
      startIndex: 0,
      canPick: false,
    };
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
    if (row.nextAction?.kind === 'resume' && row.status !== 'blocked') {
      // "다음: 작업 재개" 라고 적어 놓고 그 행에 누를 곳이 없으면, 사람은 위쪽 일괄 버튼을
      // 찾아 헤매거나 아무것도 못 한다. 그 행에서 바로 이어갈 수 있어야 한다.
      const resume = button('board-mini-action board-action-primary', '작업 재개', {
        action: 'retry',
        jobId: row.jobId,
      });
      resume.disabled = busy;
      rowActions.append(resume);
    }
    if ((row.status === 'completed' || row.cafe24Declined) && !row.cafe24Registered) {
      // 조립공장에는 등록 화면이 없다. 분류·공급가·진열은 이 작업의 투입값을 그대로 싣는다.
      // 투입값이 없는 작업은 바로 지시하지 않고 여기서 값을 받는다. 등록값이 없어 차단된
      // 작업도 원문 코드 대신 이 입력으로 풀 수 있어야 한다.
      const register = button('board-mini-action board-action-primary', 'Cafe24 등록', {
        action: 'cafe24',
        jobId: row.jobId,
      });
      register.disabled = busy;
      rowActions.append(register);
      // 분류·공급가는 원래 필수가 아니다. 스토어에 이미 있는 제품은 조립공장이 원격에서
      // 읽어 온다. 값을 굳이 지정하고 싶을 때만 여는 보조 수단으로 둔다.
      const values = button('board-mini-action ghost', 'Cafe24 값 지정', {
        action: 'cafe24-values',
        jobId: row.jobId,
      });
      values.disabled = busy;
      rowActions.append(values);
    }
    // 되살리기는 Cafe24 등록 버튼과 조건이 달라야 한다. 등록이 막혀 blocked 가 된 순간
    // 이 버튼들이 같이 사라지면, 정작 필요할 때 없다 — 실측 2026-08-29에 그렇게 사라졌다.
    // 만들기가 끝난 뒤(완료·차단 어느 쪽이든)에는 늘 보이게 둔다.
    // 등록이 막혀 있으면 작업 상태가 무엇이든 푸는 길이 있어야 한다. 예전에는 완료/차단일 때만
    // 보여서, "내 선택 대기" 인 동안에는 차단 사유를 읽고도 누를 곳이 없었다 - 실측 2026-08-31.
    if ((row.status === 'completed' || row.status === 'blocked' || row.registrationBlocked)
      && !row.cafe24Registered) {
      const detach = button('board-mini-action ghost', 'Cafe24 대상 떼기', {
        action: 'recover-clear-target',
        jobId: row.jobId,
      });
      detach.title = '이 작업에 잘못 붙은 기존 Cafe24 상품을 뗍니다. 섹션과 컷은 그대로 둡니다.';
      detach.disabled = busy;
      rowActions.append(detach);
      const resection = button('board-mini-action ghost', '섹션 다시 만들기', {
        action: 'recover-sections',
        jobId: row.jobId,
      });
      resection.title = '상세페이지 섹션을 이 제품 기준으로 다시 만듭니다. 실패해도 원래 있던 섹션은 그대로 둡니다.';
      resection.disabled = busy;
      rowActions.append(resection);
      // 잠근 섹션은 다시 만들기가 일부러 보존하고 개별 재생성도 거부한다. 그래서 잠긴 채로
      // 잘못된 내용이 들어 있으면 몇 번을 다시 만들어도 그대로인데, 푸는 길이 앱 화면에만
      // 있어 관제탑에서 일하는 사람은 빠져나올 수 없었다 — 실측 2026-08-29.
      const unlock = button('board-mini-action ghost', '섹션 잠금 풀기', {
        action: 'recover-unlock',
        jobId: row.jobId,
      });
      unlock.title = '잠긴 섹션을 풉니다. 잠긴 섹션은 「섹션 다시 만들기」가 건너뛰므로, 먼저 풀어야 새로 만들어집니다.';
      unlock.disabled = busy;
      rowActions.append(unlock);
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
      // 고를 것이 있는 칸도, 이미 고른 칸도 눌러야 한다. 사람이 마음을 바꾸는 것이 정상이다.
      const openable = cell.pickable || cell.changeable;
      const node = openable
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
        const thumbKey = `${row.jobId}:${cell.stageKey}`;
        const wanted = assetUrl ? assetUrl(cell.selectedThumbnailUrl) : cell.selectedThumbnailUrl;
        const cached = thumbNodes.get(thumbKey);
        const reuse = cached && cached.dataset.thumbSrc === wanted;
        const thumb = reuse ? cached : document.createElement('img');
        if (!reuse) {
          thumb.className = 'board-cell-thumb';
          thumb.dataset.thumbSrc = wanted;
          thumb.src = wanted;
          thumb.alt = `${cell.stageLabel} 고른 컷`;
          // 표가 자주 다시 그려지는 화면에서 지연 로딩은 계속 처음으로 되돌아간다. 바로 받는다.
          thumb.loading = 'eager';
          thumb.decoding = 'async';
          thumbNodes.set(thumbKey, thumb);
        }
        if (!reuse) {
          // 받아오는 동안 빈 상자가 그대로 보이면 깨진 것처럼 읽힌다. 글자로 알린다.
          thumb.dataset.loading = 'true';
          // 여기서 render() 를 부르면 표를 다시 그리며 img 가 떨어졌다 붙고, 지연 로딩이
          // 처음으로 되돌아가 영영 끝나지 않는다. 실측: 27장이 하나도 안 실렸다.
          // 다 받은 칸의 표시는 그 자리에서 지운다.
          thumb.addEventListener('load', () => {
            delete thumb.dataset.loading;
            const holder = thumb.parentElement;
            const label = holder ? holder.querySelector('.board-cell-loading') : null;
            if (label) label.remove();
          }, { once: true });
          // 정말 못 받아오면 빈 상자 대신 원래의 상태 표시로 돌아간다.
          thumb.addEventListener('error', () => {
            thumbNodes.delete(thumbKey);
            const holder = thumb.parentElement;
            thumb.remove();
            if (holder && !holder.querySelector('.board-cell-glyph')) {
              holder.prepend(element('span', 'board-cell-glyph', CELL_GLYPHS[cell.state] || '·'));
            }
          }, { once: true });
        }
        // 작은 그림으로는 무엇을 골랐는지 판단할 수 없다. 눌러서 크게 보고, 후보가
        // 여럿이면 그 자리에서 넘겨 가며 비교한 뒤 고른다.
        thumb.dataset.zoomSrc = cell.selectedContentUrl || cell.selectedThumbnailUrl;
        thumb.dataset.zoomLabel = `${row.productName} · ${cell.stageLabel}`;
        const zoomKey = `${row.jobId}:${cell.stageKey}`;
        node.dataset.zoomCell = zoomKey;
        zoomPayloads.set(zoomKey, buildZoomPayload(row, cell));
        node.append(thumb);
      } else if (cell.selectedIsDocument) {
        // 문서를 골랐다. 그림이 없는 게 정상이니 그렇게 말한다. 점만 찍으면 덜 온 것처럼 읽힌다.
        node.append(element('span', 'board-cell-glyph', '📄'));
        node.append(element('span', 'board-cell-loading', '문서'));
      } else {
        node.append(element('span', 'board-cell-glyph', CELL_GLYPHS[cell.state] || '·'));
      }
      // 표 머리글은 스크롤로 사라진다. 어느 칸이 어느 컷인지 칸 자신이 말해야 한다.
      node.append(element('span', 'board-cell-stage-name', cell.stageLabel));
      if (cell.state === 'skipped') node.append(element('span', 'board-cell-loading', '옵션 없음'));
      // 그림이 늦게 오는 이유를 사람이 알 수 있어야 한다. 빈 상자만 두면 고장으로 읽힌다.
      const thumbPending = node.querySelector('.board-cell-thumb[data-loading="true"]');
      // 건너뛴 칸과 문서를 고른 칸에는 올 그림이 없다.
      // '불러오는 중' 을 붙이면 영영 기다리는 것처럼 읽힌다.
      if (cell.state !== 'skipped' && !cell.selectedIsDocument
        && (thumbPending || (!cell.selectedThumbnailUrl && pendingResultJobs.has(String(row.jobId))))) {
        node.append(element('span', 'board-cell-loading', '불러오는 중'));
      }
      // 몇 개 중 몇 번째를 골랐는지 칸에 적는다. "고름" 만으로는 무엇을 골랐는지 알 수 없다.
      if (cell.selectedIndex && cell.candidateCount > 1) {
        node.append(element('span', 'board-cell-choice', `${cell.selectedIndex}/${cell.candidateCount}`));
      }
      if (cell.pickable) node.append(element('span', 'board-cell-pick-hint', '고르기'));
      else if (cell.changeable) node.append(element('span', 'board-cell-pick-hint', '바꾸기'));
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

  /**
   * 표를 다시 그릴 이유가 있는지 한 줄로 요약한다.
   * 바뀐 것이 없는데도 매번 전부 새로 그리면 행이 눈앞에서 갈아 끼워지고, 그 순간
   * 누른 클릭이 사라진 노드로 떨어져 "버튼이 안 눌린다" 가 된다. 실측 2026-08-25:
   * "다시 시도" 를 눌러도 아무 반응이 없다는 신고가 있었고, 이벤트 계측 결과 클릭은
   * 버튼에 닿고 있었다. 문제는 그 사이 표가 통째로 다시 그려진 것이었다.
   */
  const STABLE_SUMMARY_KEYS = Object.freeze([
    'total', 'queued', 'running', 'waiting', 'blocked', 'completed',
    'reserved', 'resumable', 'autoResuming', 'pickableCells',
  ]);

  function stableSummarySignature(summary) {
    return STABLE_SUMMARY_KEYS.map(key => summary?.[key] ?? 0);
  }

  const rowSignature = row => boardRowSignature(row, {
    busy,
    connected,
    resultsOpen: openResults === row.jobId,
    // 프롬프트와 상세 본문은 나중에 도착한다. 도착을 서명에 넣지 않으면 행 노드를
    // 그대로 재사용해서, 받아 놓고도 화면은 "없음" 인 채로 남는다.
    promptCacheVersion,
    documentCacheVersion,
    openPrompts: [...openPrompts].sort().join('|'),
    promptAlwaysOpen,
    openCompose,
  });

  function boardSignature(board) {
    return JSON.stringify([
      busy, connected, openResults, openCafe24Values, openProductValues,
      openCell.jobId, openCell.stageKey, statusLine.copy, statusLine.tone,
      // 펼친 프롬프트와 새 컷 만들기 칸도 화면 모양을 바꾼다. 서명에 없으면
      // 눌러도 표가 다시 그려지지 않아 아무 일도 일어나지 않는다.
      promptAlwaysOpen, openCompose, [...openPrompts].sort().join('|'),
      promptCacheVersion,
      // 본문을 받아 오면 빈 칸이 미리보기로 바뀐다. 서명에 없으면 받아 놓고도 안 그린다.
      documentCacheVersion,
      // 총 기계/대기 시간은 새로고침마다 흘러간다. 이것까지 서명에 넣으면 아무 일이
      // 없어도 매번 표를 통째로 다시 그리고, 그 순간 손 밑의 버튼이 갈아 끼워진다.
      // 실측 2026-08-26: "Cafe24 값 지정" 을 눌렀는데 아무 것도 열리지 않았다.
      // 흘러가는 값은 서명에서 빼고, 아래에서 표를 건드리지 않고 따로 갱신한다.
      stableSummarySignature(board.summary),
      board.rows.map(row => [
        row.jobId, row.status, row.productName, row.message, row.percent,
        row.stepLabel, row.nextAction?.copy || '',
        row.cells.map(cell => [
          cell.stageKey, cell.state, cell.candidateCount,
          cell.selectedIndex, cell.selectedThumbnailUrl, cell.pickable, cell.changeable,
        ]),
      ]),
    ]);
  }

  function render() {
    const board = projectProductionBoard(jobs, { results: archivedResults() });
    const signature = boardSignature(board);
    lastBoard = board;
    if (signature === lastBoardSignature && grid.childElementCount) {
      renderConnection();
      // 표를 다시 그리지 않아도 흘러가는 시간은 계속 보여 줘야 한다.
      renderSummary(board.summary);
      renderStatus();
      return board;
    }
    lastBoardSignature = signature;
    lastBoard = board;
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
    const liveJobIds = new Set(board.rows.map(row => row.jobId));
    for (const jobId of [...rowNodes.keys()]) {
      if (!liveJobIds.has(jobId)) rowNodes.delete(jobId);
    }
    for (const row of board.rows) {
      const signature = rowSignature(row);
      const cached = rowNodes.get(row.jobId);
      const stale = !cached || cached.signature !== signature;
      // 지금 누르고 있는 행이면 갈아 끼우지 않는다. 손을 뗀 뒤에 다시 그린다.
      if (stale && cached && heldJobId && heldJobId === row.jobId) {
        deferredRender = true;
        nodes.push(cached.node);
        if (openResults === row.jobId) nodes.push(renderResultStrip(row));
        if (openCafe24Values === row.jobId) nodes.push(renderCafe24ValueForm(row));
        if (openProductValues === row.jobId) nodes.push(renderProductValueForm(row));
        if (openCell.jobId === row.jobId) {
          const openStage = row.cells.find(item => item.stageKey === openCell.stageKey);
          if (openStage && openStage.candidates.length) nodes.push(renderCandidateStrip(row, openStage));
        }
        continue;
      }
      const node = stale ? renderRow(row) : cached.node;
      if (stale) rowNodes.set(row.jobId, { node, signature });
      nodes.push(node);
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
      // 지금까지의 이벤트는 이 응답에 이미 반영돼 있다. 이 자리를 기억해 두었다가
      // 이벤트 스트림을 그 다음부터 듣는다 — 처음부터 들으면 이력을 통째로 되받는다.
      if (state && state.eventCursor !== undefined) eventCursor = String(state.eventCursor || '0');
      if (state && typeof state.capturedAt === 'string') workerHeartbeatAt = state.capturedAt;
      void fillMissingProgress();
      loaded = true;
      if (statusLine.tone === 'error' || statusLine.tone === '') statusLine = { copy: '', tone: '' };
      render();
    } catch (error) {
      setStatus(`생산 보드를 불러오지 못했습니다 · ${String(error?.code || error?.message || error)}`, 'error');
      render();
    }
  }

  /** 적어 준 프롬프트로 그 단계의 컷을 새로 만들라고 지시한다. */
  const RECOVERY_COPY = Object.freeze({
    // 여기서 하는 일은 '지시'까지다. 실제로 됐는지는 조립공장이 보고해야 알 수 있으므로
    // 끝난 것처럼 말하지 않는다 — 실측 2026-08-29: '뗐습니다' 라고 해 놓고 워커는 거절했다.
    'clear-cafe24-target': {
      running: '잘못 붙은 Cafe24 대상을 떼는 중입니다.',
      done: 'Cafe24 대상 떼기를 조립공장에 지시했습니다. 이 줄의 상태가 바뀌면 끝난 것입니다.',
    },
    'regenerate-sections': {
      running: '섹션을 이 제품 기준으로 다시 만드는 중입니다. 몇 분 걸립니다.',
      done: '섹션 다시 만들기를 조립공장에 지시했습니다. 이 줄의 상태가 바뀌면 끝난 것입니다.',
    },
    'unlock-sections': {
      running: '잠긴 섹션을 푸는 중입니다.',
      done: '섹션 잠금 풀기를 조립공장에 지시했습니다. 푼 뒤에 「섹션 다시 만들기」를 눌러야 새로 만들어집니다.',
    },
  });

  async function recoverJob(jobId, action) {
    const copy = RECOVERY_COPY[action] || { running: '되살리는 중입니다.', done: '지시했습니다.' };
    busy = true;
    try {
      setStatus(copy.running, '');
      render();
      await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/recover`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setStatus(copy.done, 'ok');
    } catch (error) {
      setStatus(`되살리기 실패 · ${String(error?.code || error?.message || error)}`, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function composeCut(jobId, stageKey, prompt) {
    busy = true;
    try {
      setStatus('적어 주신 프롬프트로 새 컷을 만드는 중입니다. 끝나면 후보에 나타납니다.', '');
      render();
      await apiRequest(`/api/factory/jobs/${encodeURIComponent(jobId)}/compose-cut`, {
        method: 'POST',
        body: JSON.stringify({ stageKey, prompt }),
      });
      openCompose = '';
      setStatus('새 컷 만들기를 조립공장에 지시했습니다.', 'ok');
    } catch (error) {
      setStatus(`새 컷 만들기 실패 · ${String(error?.code || error?.message || error)}`, 'error');
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function submitBatch(body) {
    const current = { ...openCell };
    let receipt = null;
    busy = true;
    try {
      render();
      receipt = await apiRequest('/api/factory/jobs/selections', {
        method: 'POST',
        body: JSON.stringify({ ...body, autoResume }),
      });
      const summary = summarizeBatchSelection(receipt);
      setStatus(summary.copy, summary.tone);
    } catch (error) {
      setStatus(`일괄 선택 실패 · ${String(error?.code || error?.message || error)}`, 'error');
    } finally {
      busy = false;
      await refresh();
      if (body.mode === 'manual' && body.selections?.length === 1) {
        openCell = advanceManualSelectionCursor({
          board: lastBoard,
          current,
          selection: body.selections[0],
          receipt,
        });
        render();
      }
    }
  }

  async function clearReservations(jobIds) {
    busy = true;
    try {
      render();
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
    try {
      render();
      const response = await apiRequest('/api/factory/jobs/resume', {
        method: 'POST',
        body: JSON.stringify(jobIds ? { jobIds } : {}),
      });
      const resumed = Number(response?.resumed || 0);
      const failed = Number(response?.failed || 0);
      // 몇 건이 막혔는지만 알려 주면 사람이 다음에 무엇을 해야 할지 모른다. 서버는
      // 작업마다 사유를 돌려준다. 실측 2026-08-26: 사유가
      // factory_worker_build_not_admitted 였는데 화면에는 어디에도 없었다.
      const reasons = [...new Set(
        (Array.isArray(response?.results) ? response.results : [])
          .map(item => String(item?.reason || '').trim())
          .filter(Boolean),
      )];
      const reasonCopy = reasons.length
        ? ` · 사유 ${reasons.map(code => RESUME_REASONS[code] || code).join(', ')}`
        : '';
      setStatus(
        resumed || failed
          ? `${[resumed && `${resumed}건 다음 단계로 진행`, failed && `${failed}건은 아직 진행할 수 없음`]
            .filter(Boolean).join(' · ')}${reasonCopy}`
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
    try {
      render();
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
    try {
      render();
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
    // 진행 스냅샷이 있어도 보관함은 읽어야 한다. 섹션처럼 스냅샷에 그림이 없는 단계는
    // 보관함에만 이미지가 있어서, 스냅샷이 있다는 이유로 건너뛰면 그 칸은 영영 체크표시뿐이다.
    const pending = jobs
      .filter(job => !resultCache.has(String(job.jobId)))
      .slice(0, 8);
    if (!pending.length) return;
    // 한 건씩 순서대로 받으면 건당 수백 KB 라 그림이 2~3장씩 뒤늦게 뜬다. 나란히 받는다.
    pendingResultJobs = new Set(pending.map(job => String(job.jobId)));
    render();
    await Promise.all(pending.map(job => loadResults(String(job.jobId), { quiet: true })));
    pendingResultJobs = new Set();
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

  // 컷은 작게 보면 무엇을 골랐는지 판단할 수 없다. 누르면 그 자리에서 크게 보고,
  // 후보가 여럿이면 넘겨 가며 비교한 뒤 그 자리에서 고른다. 크게 보기와 고르기가
  // 따로 놀면 52컷짜리 섹션은 사람이 실제로 고를 수 없다.
  function openZoom({ source, label, jobId = '', stageKey = '', candidates = [], startIndex = 0, canPick = false }) {
    closeZoom();
    const shots = candidates.length
      ? candidates
      : [{ id: '', thumbnailUrl: source, contentUrl: source }];
    let index = Math.max(0, Math.min(startIndex, shots.length - 1));

    const layer = element('div', 'board-zoom-layer');
    layer.dataset.boardZoom = 'true';
    const frame = element('div', 'board-zoom-frame');
    const image = document.createElement('img');
    image.className = 'board-zoom-image';
    image.alt = label;
    // 크게 보는 그림은 원본이라 큰 것이 많다. 메인 스레드에서 풀면 화면 전체가 멎는다.
    // 실측: 섹션 원본(879x1789)을 띄우자 화면 캡처가 30초 넘게 응답하지 않았다.
    image.decoding = 'async';
    image.loading = 'eager';
    frame.append(image);
    const caption = element('p', 'board-zoom-label', label);
    frame.append(caption);

    const controls = element('div', 'board-zoom-controls');
    const prev = button('board-zoom-close', '← 이전', { action: 'zoom-prev' });
    const next = button('board-zoom-close', '다음 →', { action: 'zoom-next' });
    const pick = button('board-zoom-close board-zoom-pick', '이 컷으로 선택', { action: 'zoom-pick' });
    const close = button('board-zoom-close', '닫기', { action: 'zoom-close' });
    if (shots.length > 1) controls.append(prev, next);
    if (canPick && jobId && stageKey) controls.append(pick);
    controls.append(close);
    frame.append(controls);
    layer.append(frame);

    const paint = () => {
      const shot = shots[index] || {};
      const href = shot.contentUrl || shot.thumbnailUrl || source;
      image.src = assetUrl ? assetUrl(href) : href;
      caption.textContent = shots.length > 1
        ? `${label} · ${index + 1}/${shots.length}`
        : label;
      pick.dataset.candidateId = shot.id || '';
      pick.disabled = busy || !shot.id;
    };
    const step = delta => {
      index = (index + delta + shots.length) % shots.length;
      paint();
    };
    layer.dataset.jobId = jobId;
    layer.dataset.stageKey = stageKey;
    // 확대창은 body 에 붙는다. 보드의 클릭 처리기는 보드 안쪽에만 걸려 있어서, 여기 버튼은
    // 이 리스너가 직접 처리해야 한다. 이걸 빼면 닫기와 선택이 눌러도 아무 반응이 없다.
    layer.addEventListener('click', event => {
      const hit = event.target instanceof Element ? event.target.closest('[data-action]') : null;
      const hitAction = hit ? hit.dataset.action : '';
      if (hitAction === 'zoom-prev') { step(-1); return; }
      if (hitAction === 'zoom-next') { step(1); return; }
      if (hitAction === 'zoom-close') { closeZoom(); return; }
      if (hitAction === 'zoom-pick') {
        const candidateId = hit.dataset.candidateId || '';
        if (!candidateId || !jobId || !stageKey) return;
        void submitBatch({
          mode: 'manual',
          selections: [{ jobId, stageKey, candidateId }],
        });
        closeZoom();
        return;
      }
      // 바깥을 눌러도 닫힌다. 크게 본 뒤 원래 화면으로 돌아가는 길을 막지 않는다.
      if (event.target === layer) closeZoom();
    });
    // 키는 초점이 있는 곳으로만 간다. 확대창 안을 누르지 않았거나 초점이 다른 데로
    // 새면 창에 건 keydown 은 영영 안 온다. 실측 2026-08-26: 그림을 눌러 연 확대창은
    // ESC 로 닫히지 않았다. 문서에서 받아 확대창이 떠 있을 때만 처리한다.
    const onZoomKey = event => {
      if (!layer.isConnected) { document.removeEventListener('keydown', onZoomKey, true); return; }
      if (event.key === 'ArrowLeft') { step(-1); event.preventDefault(); }
      if (event.key === 'ArrowRight') { step(1); event.preventDefault(); }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        document.removeEventListener('keydown', onZoomKey, true);
        closeZoom();
      }
    };
    document.addEventListener('keydown', onZoomKey, true);
    paint();
    document.body.append(layer);
    close.focus();
  }

  /**
   * 섹션마다 지금 쓰이는 이미지를 보관함에서 찾는다.
   * 보관함에는 두 종류가 섞여 있다. "섹션 header" 처럼 섹션 이름을 그대로 단 현재본과,
   * "015144_헤더_(Header)_섹션_결과_..." 처럼 시각이 앞에 붙은 지난 회차본이다.
   * 현재본이 있으면 그것을 쓰고, 없을 때만 지난 회차 중 가장 늦은 것을 쓴다.
   */
  function sectionShotsById(assets) {
    const squash = value => String(value || '').replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();
    const current = new Map();
    const fallback = new Map();
    for (const asset of assets) {
      if (asset.factoryStageKey !== 'sections') continue;
      const name = String(asset.displayName || '').trim();
      const direct = name.match(/^섹션\s+([a-z_]+)$/);
      if (direct && SECTION_LABELS.has(direct[1])) {
        current.set(direct[1], asset);
        continue;
      }
      const squashed = squash(name);
      const hit = SECTION_CATALOGUE.find(item => squashed.includes(squash(item.label)));
      if (!hit) continue;
      const stamp = name.match(/^(\d+)/)?.[1] || '';
      const seen = fallback.get(hit.id);
      if (!seen || stamp >= seen.stamp) fallback.set(hit.id, { asset, stamp });
    }
    const shots = new Map();
    for (const item of SECTION_CATALOGUE) {
      const asset = current.get(item.id) || fallback.get(item.id)?.asset;
      if (asset) shots.set(item.id, { asset, label: item.label });
    }
    return shots;
  }

  /** 이어붙이기용. 정식 차례대로 늘어놓는다. */
  function latestSectionShots(assets) {
    return [...sectionShotsById(assets).values()];
  }

  /** 섹션을 낱장으로 보면 이어졌을 때 어떻게 읽히는지 알 수 없다. 차례대로 이어 붙인다. */
  function openStitchedDetail(row) {
    const entry = resultCache.get(row.jobId);
    const assets = entry && !entry.error && Array.isArray(entry.assets) ? entry.assets : [];
    const shots = latestSectionShots(assets);
    closeZoom();
    const layer = element('div', 'board-zoom-layer');
    layer.dataset.boardZoom = 'true';
    const sheet = element('div', 'board-stitch-sheet');
    const head = element('div', 'board-stitch-head');
    head.append(element('strong', '', `${row.productName} · 이어진 상세페이지`));
    head.append(element('span', 'board-candidate-meta',
      shots.length ? `${shots.length}개 섹션` : '보관함에 섹션 이미지가 없습니다'));
    const close = button('board-action ghost', '닫기', { action: 'zoom-close' });
    head.append(close);
    sheet.append(head);
    const strip = element('div', 'board-stitch-strip');
    for (const shot of shots) {
      const block = element('figure', 'board-stitch-block');
      const image = document.createElement('img');
      image.className = 'board-stitch-image';
      image.alt = shot.label;
      image.decoding = 'async';
      image.loading = 'lazy';
      image.src = assetUrl ? assetUrl(shot.asset.contentReference) : shot.asset.contentReference;
      block.append(image);
      block.append(element('figcaption', 'board-stitch-caption', shot.label));
      strip.append(block);
    }
    if (!shots.length) {
      strip.append(element('p', 'status-message',
        '이 작업의 보관함에서 섹션 이미지를 찾지 못했습니다. 고른 컷 보기를 한 번 연 뒤 다시 눌러 주세요.'));
    }
    sheet.append(strip);
    layer.append(sheet);
    layer.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === layer || target?.closest('[data-action="zoom-close"]')) {
        event.preventDefault();
        event.stopPropagation();
        closeZoom();
      }
    });
    document.body.append(layer);
  }

  function closeZoom() {
    document.querySelectorAll('[data-board-zoom="true"]').forEach(node => node.remove());
  }

  function onClick(event) {
    const zoomTarget = event.target instanceof Element
      ? event.target.closest('[data-zoom-src]')
      : null;
    if (zoomTarget) {
      event.preventDefault();
      event.stopPropagation();
      const cellNode = zoomTarget.closest('[data-zoom-cell]');
      const payload = cellNode ? zoomPayloads.get(cellNode.dataset.zoomCell) : null;
      // 후보 패널에서 그림을 눌러 크게 보면 고르는 길이 사라져 있었다. 닫고 카드로
      // 돌아가 다시 눌러야 했다 — 크게 보고 그 자리에서 고르라고 만든 창인데 정작
      // 거기서 못 골랐다. 카드가 이미 들고 있는 작업·단계·후보 번호를 그대로 물려준다.
      const pickNode = zoomTarget.closest('[data-action="pick"]');
      openZoom(payload || (pickNode && pickNode.dataset.candidateId
        ? {
          source: zoomTarget.dataset.zoomSrc,
          label: zoomTarget.dataset.zoomLabel || '',
          jobId: pickNode.dataset.jobId || '',
          stageKey: pickNode.dataset.stageKey || '',
          candidates: [{
            id: pickNode.dataset.candidateId,
            thumbnailUrl: zoomTarget.dataset.zoomSrc,
            contentUrl: zoomTarget.dataset.zoomSrc,
          }],
          startIndex: 0,
          canPick: !pickNode.disabled,
        }
        : {
          source: zoomTarget.dataset.zoomSrc,
          label: zoomTarget.dataset.zoomLabel || '',
        }));
      return;
    }
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (target && target.dataset.action === 'zoom-close') {
      closeZoom();
      return;
    }
    if (!target) return;
    if (busy) {
      // 처리 중이라고 눌린 것을 조용히 버리면, 사람은 버튼이 고장 난 줄 안다. 실측:
      // "다시 시도" 를 눌러도 아무 반응이 없다는 신고가 있었고 원인이 이것이었다.
      setStatus('앞선 요청을 처리하는 중입니다. 끝나면 다시 눌러 주세요.', 'warning');
      return;
    }
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
      if (!Object.keys(values).length) {
        setStatus('지정할 값을 하나 이상 넣어 주세요.', 'warning');
        render();
        return;
      }
      openCafe24Values = '';
      void registerCafe24(target.dataset.jobId, values);
      return;
    }
    if (action === 'stitch-sections') {
      const jobId = target.dataset.jobId;
      const row = lastBoard?.rows.find(item => item.jobId === jobId);
      if (!row) return;
      // 보관함을 아직 안 받았으면 먼저 받아 온다. 빈 창을 띄우면 고장으로 읽힌다.
      if (!resultCache.has(jobId)) {
        setStatus('보관함에서 섹션 이미지를 가져오는 중입니다.', '');
        void loadResults(jobId, { quiet: true }).then(() => openStitchedDetail(row));
        return;
      }
      openStitchedDetail(row);
      return;
    }
    if (action === 'prompt-toggle') {
      const id = String(target.dataset.candidateId || '');
      if (openPrompts.has(id)) openPrompts.delete(id);
      else openPrompts.add(id);
      render();
      return;
    }
    if (action === 'prompt-always') {
      promptAlwaysOpen = !promptAlwaysOpen;
      try { localStorage.setItem(PROMPT_ALWAYS_KEY, promptAlwaysOpen ? '1' : '0'); } catch { /* 저장 못 해도 이번 세션은 유지된다 */ }
      render();
      return;
    }
    if (action === 'compose-submit') {
      const form = target.closest('form');
      const prompt = String(form?.elements?.prompt?.value || '').trim();
      if (!prompt) {
        setStatus('어떤 컷을 원하는지 프롬프트를 적어 주세요.', 'warning');
        return;
      }
      void composeCut(target.dataset.jobId, target.dataset.stageKey, prompt);
      return;
    }
    if (action === 'recover-clear-target') {
      void recoverJob(target.dataset.jobId, 'clear-cafe24-target');
      return;
    }
    if (action === 'recover-sections') {
      void recoverJob(target.dataset.jobId, 'regenerate-sections');
      return;
    }
    if (action === 'recover-unlock') {
      void recoverJob(target.dataset.jobId, 'unlock-sections');
      return;
    }
    if (action === 'compose-open') {
      const key = `${target.dataset.jobId}:${target.dataset.stageKey}`;
      openCompose = openCompose === key ? '' : key;
      render();
      return;
    }
    if (action === 'panel-close') {
      const kind = target.dataset.panel;
      if (kind === 'cell') openCell = { jobId: '', stageKey: '' };
      else if (kind === 'results') openResults = '';
      else if (kind === 'cafe24') openCafe24Values = '';
      else if (kind === 'values') openProductValues = '';
      render();
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
      // 섹션 칸은 묶음마다 지금 쓰는 그림을 옆에 붙인다. 그 그림은 보관함에 있으므로
      // 칸을 여는 순간 함께 받아 온다. 안 그러면 처음 열 때만 그림이 없다.
      if (openCell.jobId && openCell.stageKey === 'sections' && !resultCache.has(openCell.jobId)) {
        void loadResults(openCell.jobId, { quiet: true });
      }
      render();
      return;
    }
    if (action === 'zoom-pick') {
      const layer = target.closest('[data-board-zoom="true"]');
      const candidateId = target.dataset.candidateId || '';
      if (layer && candidateId) {
        void submitBatch({
          mode: 'manual',
          selections: [{
            jobId: layer.dataset.jobId,
            stageKey: layer.dataset.stageKey,
            candidateId,
          }],
        });
        closeZoom();
      }
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
      return;
    }
    if (action === 'auto') {
      const board = projectProductionBoard(jobs);
      const body = buildBatchSelectionRequest(board, { mode: 'auto' });
      if (!body.jobIds.length) {
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
      // cursor=0 으로 붙으면 관제탑이 쌓아 둔 이벤트를 전부 되돌려준다. 실측 2026-08-28:
      // 화면을 열 때마다 4초 동안 1,300건(초당 350건)이 쏟아져 크롬의 호스트당 연결이
      // 바닥나고, 그 사이 사람이 누른 투입 요청은 소켓을 못 얻어 그대로 멎었다.
      // 방금 읽은 자리부터 듣는다 — 그 앞은 이미 화면에 들어와 있다.
      eventSource = new EventSourceImpl(
        `${apiOrigin()}/api/factory/events?cursor=${encodeURIComponent(eventCursor || '0')}`,
        { withCredentials: true },
      );
    } catch {
      eventSource = null;
      return;
    }
    for (const type of BOARD_EVENT_TYPES) eventSource.addEventListener(type, scheduleEventRefresh);
  }

  /**
   * 이벤트가 몰아쳐도 다시 읽기는 한 번만 한다.
   *
   * 한 건마다 refresh 를 부르면 요청 수가 이벤트 수만큼 늘어난다. 사람이 보는 결과는
   * 어차피 마지막 한 번과 같으므로, 짧게 모아서 한 번만 읽는다.
   */
  function scheduleEventRefresh() {
    if (eventRefreshTimer) return;
    eventRefreshTimer = setTimeout(() => {
      eventRefreshTimer = null;
      void refresh();
    }, EVENT_REFRESH_COALESCE_MS);
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
  // 펼친 패널은 ESC 로도 닫는다. 닫는 길이 마우스뿐이면 답답하다.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    // 확대창이 열려 있으면 그쪽 ESC 가 먼저다.
    if (document.querySelector('[data-board-zoom="true"]')) return;
    if (!openCell.jobId && !openResults && !openCafe24Values && !openProductValues) return;
    openCell = { jobId: '', stageKey: '' };
    openResults = '';
    openCafe24Values = '';
    openProductValues = '';
    render();
  });
  window.addEventListener('control-tower:job-created', refresh);
  void refresh().then(connectEvents);

  return () => {
    stopped = true;
    if (eventRefreshTimer) { clearTimeout(eventRefreshTimer); eventRefreshTimer = null; }
    eventSource?.close?.();
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    window.removeEventListener('control-tower:job-created', refresh);
  };
}

if (globalThis.controlTowerRuntime && document.getElementById('production-board')) {
  mountProductionBoard(globalThis.controlTowerRuntime);
}
