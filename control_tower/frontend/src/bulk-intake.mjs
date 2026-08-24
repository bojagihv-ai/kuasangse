import {
  buildBulkPlan,
  buildProductPayload,
  groupImageFiles,
  parseIntakeCsv,
  summarizeBulkIntake,
} from './bulk-intake-model.mjs?bulkIntake=2';

const DEFAULT_FIELDS = Object.freeze([
  { key: 'category', label: '분류', placeholder: '주방', group: 'product' },
  { key: 'material', label: '소재', placeholder: '면 100%', group: 'product' },
  { key: 'originCountry', label: '원산지', placeholder: '대한민국', group: 'product' },
  { key: 'size', label: '크기', placeholder: '45cm', group: 'product' },
  { key: 'usage', label: '용도', placeholder: '생활', group: 'product' },
  // 여기서 고른 값이 Cafe24 등록까지 그대로 간다. 비워 두면 등록할 때 다시 고르면 된다.
  { key: 'cafe24CategoryId', label: '제품분류 번호', placeholder: '119', group: 'cafe24' },
  { key: 'salePrice', label: '판매가', placeholder: '12000', group: 'cafe24' },
  { key: 'supplyPrice', label: '공급가', placeholder: '500', group: 'cafe24' },
  { key: 'displayStatus', label: '진열', placeholder: '진열안함', group: 'cafe24' },
  { key: 'sellingStatus', label: '판매', placeholder: '판매안함', group: 'cafe24' },
]);

const ISSUE_LABELS = Object.freeze({
  image_missing: '이미지 없음',
  product_name_missing: '제품명 비어 있음',
  base_image_missing: '기본 이미지 없음',
  color_name_missing: '옵션 사진에 색상명 없음',
  category_missing: '분류 비어 있음',
  sale_price_missing: '판매가 비어 있음',
});

const thumbUrls = new WeakMap();

/** 고른 파일의 미리보기 주소를 한 번만 만든다. */
function thumbUrl(image) {
  const file = image?.file;
  if (!file) return '';
  if (!thumbUrls.has(file)) thumbUrls.set(file, URL.createObjectURL(file));
  return thumbUrls.get(file);
}

/** 썸네일을 누르면 원본 크기로 띄운다. */
function openLightbox(url, caption) {
  const overlay = element('div', 'bulk-lightbox');
  const image = document.createElement('img');
  image.src = url;
  image.alt = caption;
  const label = element('p', 'bulk-lightbox-caption', caption);
  const close = element('button', 'board-action ghost', '닫기');
  close.type = 'button';
  overlay.append(image, label, close);
  const dismiss = () => overlay.remove();
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target === close) dismiss();
  });
  document.body.append(overlay);
}

const SKIP_LABELS = Object.freeze({
  unsupported_type: '이미지 파일이 아님',
  product_name_missing: '제품명을 읽을 수 없음',
});

function element(tag, className = '', textContent = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent) node.textContent = textContent;
  return node;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

async function digestOf(file) {
  try {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

export function mountBulkIntake(runtime, { root = document.getElementById('bulk-intake') } = {}) {
  if (!root || !runtime) return () => {};
  const { apiRequest } = runtime;

  let plan = { entries: [], unmatchedCsv: [], ready: 0, blocked: 0, warned: 0 };
  let grouped = { products: [], skipped: [] };
  let csvRows = [];
  let csvErrors = [];
  let defaults = {};
  let busy = false;
  let status = { copy: '이미지 파일을 여러 개 고르면 제품별로 묶어 한 번에 투입합니다.', tone: '' };
  let progress = null;

  const heading = element('div', 'section-heading');
  const headingCopy = element('div');
  headingCopy.append(element('p', 'eyebrow', 'BULK INTAKE'), element('h2', '', '제품 일괄 투입'));
  heading.append(
    headingCopy,
    element('p', 'section-copy', '이미지를 좌라락 고르면 파일 이름으로 제품을 묶습니다. 제품별 값은 CSV 로 붙이거나 아래 기본값으로 채웁니다.'),
  );

  const pickers = element('div', 'bulk-pickers');
  const imageLabel = element('label', 'bulk-picker');
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.multiple = true;
  imageInput.accept = 'image/*';
  imageInput.id = 'bulk-image-input';
  imageLabel.append(element('span', '', '① 제품 이미지 고르기'), imageInput);

  const csvLabel = element('label', 'bulk-picker');
  const csvInput = document.createElement('input');
  csvInput.type = 'file';
  csvInput.accept = '.csv,.tsv,.txt';
  csvInput.id = 'bulk-csv-input';
  csvLabel.append(element('span', '', '② 제품 정보 CSV (선택)'), csvInput);
  pickers.append(imageLabel, csvLabel);

  const defaultsBox = element('div', 'bulk-defaults');
  for (const field of DEFAULT_FIELDS) {
    const label = element('label', 'bulk-default-field');
    // 제품 자체를 설명하는 값과 Cafe24 등록 대상 값은 성격이 다르다. 눈으로 갈리게 표시한다.
    label.dataset.group = field.group || 'product';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = field.placeholder;
    input.dataset.defaultKey = field.key;
    label.append(element('span', '', field.label), input);
    defaultsBox.append(label);
  }

  const actions = element('div', 'bulk-actions');
  const submit = element('button', 'board-action primary', '투입');
  submit.type = 'button';
  submit.dataset.action = 'submit';
  const reset = element('button', 'board-action ghost', '고른 파일 비우기');
  reset.type = 'button';
  reset.dataset.action = 'reset';
  const hint = element('span', 'board-toolbar-hint');
  actions.append(submit, reset, hint);

  const statusNode = element('p', 'status-message');
  const table = element('div', 'bulk-plan');

  root.replaceChildren(heading, pickers, defaultsBox, actions, statusNode, table);

  function setStatus(copy, tone = '') {
    status = { copy, tone };
    renderStatus();
  }

  function renderStatus() {
    statusNode.textContent = progress
      ? `${progress.done}/${progress.total} 투입 중 · ${progress.current}`
      : status.copy;
    statusNode.dataset.tone = progress ? '' : status.tone;
  }

  // 입력 중에 카드를 통째로 다시 그리면 글자를 칠 때마다 포커스가 튄다. 한 박자 뒤에 모은다.
  let planTimer = null;
  function schedulePlan() {
    if (planTimer) clearTimeout(planTimer);
    planTimer = setTimeout(() => {
      planTimer = null;
      rebuild();
    }, 350);
  }

  function rebuild() {
    defaults = Object.fromEntries(
      [...defaultsBox.querySelectorAll('[data-default-key]')].map(input => [input.dataset.defaultKey, input.value]),
    );
    plan = buildBulkPlan(grouped, csvRows, defaults);
    render();
  }

  function renderPlan() {
    const nodes = [];
    if (grouped.skipped.length) {
      nodes.push(element(
        'p',
        'bulk-note',
        `건너뛴 파일 ${grouped.skipped.length}개 · ${grouped.skipped
          .slice(0, 4)
          .map(item => `${item.fileName}(${SKIP_LABELS[item.reason] || item.reason})`)
          .join(', ')}`,
      ));
    }
    for (const error of csvErrors.slice(0, 3)) {
      nodes.push(element('p', 'bulk-note', `CSV ${error.line}행 · ${error.reason === 'product_name_column_missing' ? '제품명 열을 찾지 못했습니다' : '제품명이 비어 있습니다'}`));
    }
    if (plan.unmatchedCsv.length) {
      nodes.push(element('p', 'bulk-note', `이미지를 찾지 못한 CSV 제품 ${plan.unmatchedCsv.length}건 · ${plan.unmatchedCsv.slice(0, 4).join(', ')}`));
    }
    if (!plan.entries.length) {
      nodes.push(element('p', 'factory-empty-state', '아직 고른 이미지가 없습니다.'));
      table.replaceChildren(...nodes);
      return;
    }
    for (const [index, entry] of plan.entries.entries()) {
      const group = grouped.products[index];
      const card = element('div', 'bulk-product-card');
      card.dataset.state = entry.issues.length ? 'warn' : 'ready';

      const head = element('div', 'bulk-card-head');
      const nameLabel = element('label', 'bulk-name-field');
      nameLabel.append(element('span', '', '제품명'));
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = entry.productName;
      nameInput.placeholder = '예: 슬라브 겹보 55x55cm';
      nameInput.addEventListener('input', () => {
        if (group) group.productName = nameInput.value.trim();
        schedulePlan();
      });
      nameLabel.append(nameInput);
      head.append(nameLabel);
      const summary = element('span', 'bulk-card-summary', `사진 ${entry.images.length}장`);
      head.append(summary);
      if (entry.matchedCsv) head.append(element('span', 'bulk-card-badge', 'CSV 값 적용'));
      card.append(head);

      const shelf = element('div', 'bulk-thumb-shelf');
      for (const image of (group?.images || [])) {
        const cell = element('div', 'bulk-thumb-cell');
        const url = thumbUrl(image);
        const thumbButton = element('button', 'bulk-thumb');
        thumbButton.type = 'button';
        thumbButton.title = '눌러서 크게 보기';
        if (url) {
          const thumb = document.createElement('img');
          thumb.src = url;
          thumb.alt = image.fileName;
          thumbButton.append(thumb);
          thumbButton.addEventListener('click', () => openLightbox(url, image.fileName));
        } else {
          thumbButton.append(element('span', '', '미리보기 없음'));
        }
        cell.append(thumbButton);
        cell.append(element('span', 'bulk-thumb-name', image.fileName));

        const roleSelect = document.createElement('select');
        roleSelect.className = 'bulk-role-select';
        for (const [value, label] of [
          ['base', '기본 이미지'],
          ['base-and-color', '기본 + 색상 옵션 (같은 사진)'],
          ['color-option', '옵션(색상) 이미지'],
        ]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          if ((image.role || 'base') === value) option.selected = true;
          roleSelect.append(option);
        }
        const colorInput = document.createElement('input');
        colorInput.type = 'text';
        colorInput.className = 'bulk-color-input';
        colorInput.placeholder = '색상명 (예: 남색)';
        colorInput.value = image.colorName || '';
        colorInput.hidden = !['color-option', 'base-and-color'].includes(image.role || 'base');
        roleSelect.addEventListener('change', () => {
          image.role = roleSelect.value;
          colorInput.hidden = !['color-option', 'base-and-color'].includes(roleSelect.value);
          schedulePlan();
        });
        colorInput.addEventListener('input', () => {
          image.colorName = colorInput.value.trim();
          schedulePlan();
        });
        cell.append(roleSelect, colorInput);
        shelf.append(cell);
      }
      card.append(shelf);

      const facts = element('div', 'bulk-card-facts');
      facts.append(element('span', 'board-fact board-fact-count', `분류 ${entry.requiredValues.category || '—'}`));
      facts.append(element('span', 'board-fact board-fact-count', `판매가 ${entry.requiredValues.salePrice || '—'}`));
      const verdict = element(
        'span',
        entry.issues.length ? 'board-fact board-fact-mode' : 'board-fact board-fact-count',
        entry.issues.length ? entry.issues.map(issue => ISSUE_LABELS[issue] || issue).join(' · ') : '준비됨',
      );
      facts.append(verdict);
      card.append(facts);
      nodes.push(card);
    }
    table.replaceChildren(...nodes);
  }

  function render() {
    submit.textContent = plan.ready ? `${plan.ready}건 투입` : '투입';
    submit.disabled = busy || plan.ready === 0;
    reset.disabled = busy || (!grouped.products.length && !csvRows.length);
    hint.textContent = plan.warned
      ? `${plan.warned}건은 값이 비어 있어도 투입은 됩니다. 조립공장에서 채우게 됩니다.`
      : plan.ready
        ? '파일 이름이 제품명이 됩니다. 같은 이름_숫자 는 한 제품의 여러 장으로 묶입니다.'
        : '';
    renderStatus();
    renderPlan();
  }

  async function submitPlan() {
    const entries = plan.entries.filter(entry => !entry.issues.includes('image_missing'));
    if (!entries.length) return;
    busy = true;
    const batchId = `batch-bulk-${entries.length}-${entries[0].productName}`.slice(0, 60);
    const imageModel = document.getElementById('image-model-select')?.value || '';
    const results = [];
    progress = { done: 0, total: entries.length, current: entries[0].productName };
    render();
    for (const entry of entries) {
      progress = { done: results.length, total: entries.length, current: entry.productName };
      renderStatus();
      try {
        const dataUrls = [];
        const sha256s = [];
        for (const image of entry.images) {
          dataUrls.push(await readAsDataUrl(image.file));
          sha256s.push(await digestOf(image.file));
        }
        const payload = buildProductPayload(entry, { batchId, imageModel, dataUrls, sha256s });
        await apiRequest('/api/factory/jobs', { method: 'POST', body: JSON.stringify(payload) });
        results.push({ productName: entry.productName, status: 'queued' });
      } catch (error) {
        results.push({
          productName: entry.productName,
          status: 'error',
          reason: String(error?.code || error?.message || error),
        });
      }
    }
    progress = null;
    busy = false;
    const summary = summarizeBulkIntake(results);
    const failed = results.filter(item => item.status === 'error');
    setStatus(
      failed.length
        ? `${summary.copy} · ${failed.slice(0, 3).map(item => `${item.productName}(${item.reason})`).join(', ')}`
        : summary.copy,
      summary.tone,
    );
    if (summary.queued) {
      grouped = { products: [], skipped: [] };
      imageInput.value = '';
      window.dispatchEvent(new CustomEvent('control-tower:job-created'));
    }
    rebuild();
  }

  async function onImagePick() {
    grouped = groupImageFiles([...(imageInput.files || [])]);
    setStatus(
      grouped.products.length
        ? `제품 ${grouped.products.length}건으로 묶었습니다.`
        : '이미지 파일을 찾지 못했습니다.',
      grouped.products.length ? 'ok' : 'warning',
    );
    rebuild();
  }

  async function onCsvPick() {
    const file = (csvInput.files || [])[0];
    if (!file) {
      csvRows = [];
      csvErrors = [];
      rebuild();
      return;
    }
    try {
      const parsed = parseIntakeCsv(await file.text());
      csvRows = parsed.rows;
      csvErrors = parsed.errors;
      setStatus(`CSV 제품 ${csvRows.length}건을 읽었습니다.`, csvErrors.length ? 'warning' : 'ok');
    } catch (error) {
      csvRows = [];
      csvErrors = [];
      setStatus(`CSV 를 읽지 못했습니다 · ${String(error?.message || error)}`, 'error');
    }
    rebuild();
  }

  function onClick(event) {
    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
    if (!target || busy) return;
    if (target.dataset.action === 'submit') void submitPlan();
    if (target.dataset.action === 'reset') {
      grouped = { products: [], skipped: [] };
      csvRows = [];
      csvErrors = [];
      imageInput.value = '';
      csvInput.value = '';
      setStatus('고른 파일을 비웠습니다.', '');
      rebuild();
    }
  }

  imageInput.addEventListener('change', onImagePick);
  csvInput.addEventListener('change', onCsvPick);
  defaultsBox.addEventListener('input', rebuild);
  root.addEventListener('click', onClick);
  rebuild();

  return () => {
    imageInput.removeEventListener('change', onImagePick);
    csvInput.removeEventListener('change', onCsvPick);
    defaultsBox.removeEventListener('input', rebuild);
    root.removeEventListener('click', onClick);
  };
}

if (globalThis.controlTowerRuntime && document.getElementById('bulk-intake')) {
  mountBulkIntake(globalThis.controlTowerRuntime);
}
