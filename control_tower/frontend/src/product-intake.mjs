import {
  buildDbSnapshotRequest,
  buildPdpJobRequest,
  createManualManifest,
  ProductIntakeError,
} from './product-intake-model.mjs';
import { resolveWorkfileIdentity } from './workfile-identity-model.mjs';
// 크기 한 줄에서 가로·세로를 읽는 규칙은 대량 투입과 한 곳에서 나눠 쓴다.
import { readSizePair, resolveSizePair } from './bulk-intake-model.mjs?bulkIntake=10';

export {
  buildDbSnapshotRequest,
  buildPdpJobRequest,
  createManualManifest,
  ProductIntakeError,
} from './product-intake-model.mjs';

const text = value => String(value ?? '').trim();

const workfileNameFor = value => {
  const safeName = text(value)
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '상세페이지 작업';
  return `${safeName}.kuasangse`;
};

const escapeHtml = value => text(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const digestFile = async file => {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
};

const dataUrlFile = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(text(reader.result));
  reader.onerror = () => reject(reader.error || new Error('image_payload_required'));
  reader.readAsDataURL(file);
});

const errorMessage = code => ({
  base_image_required: '기본 이미지를 1장 이상 선택해 주세요.',
  batch_id_required: '생산 묶음 이름을 입력해 주세요.',
  color_name_required: '색상 옵션 이미지마다 색상명을 입력해 주세요.',
  image_metadata_required: '각 이미지의 이름과 이미지 확인 상태를 확인해 주세요.',
  image_payload_required: '선택한 이미지 원본을 읽지 못했습니다. 파일을 다시 선택해 주세요.',
  source_images_missing: '이 원장 제품에는 등록된 이미지가 없습니다. 아래 “신규·미등록 제품 입력”으로 이미지를 직접 넣어 주세요.',
  product_name_required: '상품명을 입력해 주세요.',
  product_target_required: '신화사 DB 검색 결과에서 대상 제품을 먼저 선택해 주세요.',
}[code] || code);

export function mountProductIntake({ apiRequest, setStatus, automation = {} }) {
  const form = document.getElementById('intake-form');
  if (!form) return;
  const dbPanel = document.getElementById('db-intake-panel');
  const manualPanel = document.getElementById('manual-intake-panel');
  const results = document.getElementById('product-search-results');
  const selectedSummary = document.getElementById('selected-product-summary');
  const imageList = document.getElementById('image-intake-list');
  const submit = document.getElementById('intake-submit');
  const state = {
    mode: 'db',
    selected: null,
    selectionVersion: 0,
    pendingWorkfileJcode: null,
    baseImages: [],
    colorImages: [],
    // 제품 사진을 등록할 때 이어서 할 작업파일도 같은 자리에서 받는다. 붙이지 않으면
    // 새 작업으로 시작한다.
    attachedWorkfile: null,
  };
  /**
   * 지금 상태로 작업을 시작할 수 있는지, 없으면 무엇이 모자란지 한 줄로 돌려준다.
   *
   * 여태 버튼은 늘 열려 있었고, 눌러야 "대상 제품을 먼저 선택해 주세요" 를 들었다.
   * 무엇을 채워야 하는지는 누르기 전에 알아야 한다.
   */
  const submitBlocker = () => {
    if (state.mode === 'db') {
      if (!state.selected) return '신화사 DB에서 제품을 먼저 검색해 고르세요.';
      if (!Array.isArray(state.selected.inputImages) || !state.selected.inputImages.length) {
        return '고른 제품의 원본 이미지를 아직 불러오지 못했습니다.';
      }
      return '';
    }
    if (!text(document.getElementById('required-product-name')?.value)) return '상품명을 입력해 주세요.';
    if (!state.baseImages.length) return '기본 이미지를 1장 이상 선택해 주세요.';
    return '';
  };

  const syncSubmitReadiness = () => {
    const blocker = submitBlocker();
    submit.disabled = !!blocker;
    submit.title = blocker || '';
    const hint = document.getElementById('intake-submit-hint');
    if (hint) {
      hint.textContent = blocker;
      hint.hidden = !blocker;
    }
  };

  const notifyWorkfileLink = detail => {
    const jcode = Number(detail.jcode);
    if (state.pendingWorkfileJcode !== jcode) return;
    state.pendingWorkfileJcode = null;
    window.dispatchEvent(new CustomEvent('control-tower:workfile-product-linked', { detail }));
  };

  const lockPolicy = async productId => {
    const batchId = text(document.getElementById('batch-id').value);
    const policyRequest = automation.snapshotRequest?.(String(productId)) || {
      batchId,
      productId: String(productId),
      preset: text(document.getElementById('batch-policy').value) || 'full_auto',
      batchOverride: { ...(automation.batchOverride || {}) },
      productOverride: { ...(automation.productOverride || {}) },
      stageOverride: { ...(automation.stageOverride || {}) },
    };
    const policySnapshot = await apiRequest('/api/automation/policy/snapshot', {
      method: 'POST',
      body: JSON.stringify(policyRequest),
    });
    automation.snapshot = policySnapshot;
    window.dispatchEvent(new CustomEvent('control-tower:policy-locked', {
      detail: { snapshotId: policySnapshot.snapshotId },
    }));
    return policySnapshot;
  };

  const setMode = mode => {
    state.mode = mode;
    dbPanel.hidden = mode !== 'db';
    manualPanel.hidden = mode !== 'manual';
    dbPanel.querySelectorAll('input, button').forEach(control => {
      control.disabled = mode !== 'db';
    });
    manualPanel.querySelectorAll('input, button').forEach(control => {
      control.disabled = mode !== 'manual';
    });
    submit.textContent = mode === 'db' ? '선택 제품으로 조립공장 작업 시작' : '직접 입력 제품으로 조립공장 작업 시작';
    syncSubmitReadiness();
    setStatus(
      'intake-status',
      mode === 'db'
        ? '신화사 DB에서 제품을 검색하고 하나를 선택해 주세요.'
        : '이미지와 필수값을 조립공장 작업 큐에 직접 넣습니다. 신화사 원장 신규 등록은 하지 않습니다.',
    );
  };

  const renderSelected = (source, readiness, readinessError = '') => {
    const missing = Array.isArray(readiness.missingFields) ? readiness.missingFields : [];
    const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
    const ready = readiness.ready === true && !readinessError;
    const readinessMessage = readinessError
      ? `준비 상태 조회 실패 · ${readinessError}`
      : ready
        ? '입력 준비 완료'
        : `누락 ${missing.join(', ') || '없음'} · 경고 ${warnings.join(', ') || '없음'}`;
    selectedSummary.innerHTML = `
      <div><span class="label">선택 제품</span><strong>${escapeHtml(source.productName)}</strong></div>
      <div><span class="label">신화사 품번</span><span class="value">${escapeHtml(source.jcode)}</span></div>
      <div><span class="label">분류</span><span>${escapeHtml(source.category || '미입력')}</span></div>
      <div><span class="label">원장 이미지</span><span>${escapeHtml(source.imageCount)}장</span></div>
      <div class="span-all"><span class="label">준비 상태</span><span class="status-message" data-tone="${ready ? 'ok' : 'error'}">${escapeHtml(readinessMessage)}</span></div>
    `;
    document.getElementById('jcode').value = String(source.jcode);
    markSelectedResult(source.jcode);
    revealSelectedSummary();
  };

  // 목록이 길면 누른 자리에서 확인 문구까지 1500px 넘게 떨어진다.
  // 눌렀는데 아무 일도 안 일어난 것처럼 보이므로 요약을 화면 안으로 데려온다.
  const revealSelectedSummary = () => {
    const rect = selectedSummary.getBoundingClientRect();
    if (rect.height <= 0) return;
    const offscreen = rect.top < 0 || rect.bottom > window.innerHeight;
    if (!offscreen) return;
    // 부드러운 스크롤은 이 화면에서 다른 렌더가 끼어들면 취소된다(실측: scrollTop 0 유지).
    // 눌렀을 때 확인이 보이는 편이 애니메이션보다 중요하므로 즉시 이동한다.
    selectedSummary.scrollIntoView({ block: 'center' });
  };

  const markSelectedResult = jcode => {
    const wanted = String(jcode);
    for (const button of results.querySelectorAll('.product-result')) {
      const picked = button.dataset.jcode === wanted;
      button.setAttribute('aria-pressed', picked ? 'true' : 'false');
      button.classList.toggle('is-picked', picked);
    }
  };

  const selectSource = async source => {
    const selectionVersion = ++state.selectionVersion;
    state.selected = source;
    setStatus('intake-status', `${source.productName} 준비 상태 확인 중…`);
    try {
      const [readiness, sourceImages] = await Promise.all([
        apiRequest(`/api/pdp/readiness?jcode=${encodeURIComponent(source.jcode)}`),
        apiRequest(`/api/pdp/products/${encodeURIComponent(source.jcode)}/source-images`),
      ]);
      if (selectionVersion !== state.selectionVersion) return;
      const inputImages = Array.isArray(sourceImages.images)
        ? sourceImages.images.map((image, index) => ({
          role: text(image.role) || 'base',
          ordinal: index + 1,
          name: text(image.name || image.fileName) || `입력 이미지 ${index + 1}`,
          fileName: text(image.fileName),
          colorName: text(image.colorName),
          sha256: text(image.sha256),
          dataUrl: text(image.dataUrl),
        }))
        : [];
      // 원장에 이미지가 한 장도 없는 제품이다. 파일 읽기가 실패한 것과는 다른 일이라
      // 같은 코드를 쓰면 "파일을 다시 선택해 주세요" 라는 엉뚱한 안내가 나간다.
      if (!inputImages.length) throw new ProductIntakeError('source_images_missing');
      state.selected = { ...source, inputImages };
      syncSubmitReadiness();
      renderSelected(source, readiness);
      setStatus('intake-status', `${source.productName} 선택 완료 · 원본 이미지 ${inputImages.length}장 준비`, readiness.ready ? 'ok' : 'error');
      notifyWorkfileLink({
        status: 'selected',
        jcode: Number(source.jcode),
        productName: source.productName,
        ready: readiness.ready === true,
      });
    } catch (error) {
      if (selectionVersion !== state.selectionVersion) return;
      // 여기만 서버 코드를 그대로 띄우고 있었다. 바로 위 errorMessage 에 사람 말이 이미 있는데
      // 쓰이지 않아 "image_payload_required" 같은 글자가 화면에 그대로 나왔다.
      const message = errorMessage(text(error.message));
      // 이미지를 못 받았으면 고른 것으로 칠 수 없다. 버튼을 열어 두면 눌러야 실패를 안다.
      state.selected = null;
      syncSubmitReadiness();
      renderSelected(source, { ready: false, missingFields: [], warnings: [] }, message);
      setStatus('intake-status', `원장 준비 상태 조회 실패: ${message}`, 'error');
      notifyWorkfileLink({
        status: 'error',
        jcode: Number(source.jcode),
        productName: source.productName,
      });
    }
  };

  const searchSources = async preferredJcode => {
    const query = text(document.getElementById('product-search').value);
    if (!query) {
      setStatus('intake-status', '상품명 또는 신화사 품번을 입력해 주세요.', 'error');
      return [];
    }
    results.innerHTML = '<p class="status-message">신화사 원장 검색 중…</p>';
    try {
      const body = await apiRequest(`/api/pdp/sources?q=${encodeURIComponent(query)}`);
      const sources = Array.isArray(body.sources) ? body.sources : [];
      results.replaceChildren();
      for (const source of sources) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'product-result';
        // 고른 것이 무엇인지는 초점이 아니라 상태로 남아야 한다.
        // 초점만으로 표시하면 다른 칸을 누르는 순간 무엇을 골랐는지 사라진다.
        button.dataset.jcode = String(source.jcode);
        button.setAttribute('aria-pressed', 'false');
        button.innerHTML = `<strong>${escapeHtml(source.productName)}</strong><span>신화사 품번 ${escapeHtml(source.jcode)} · ${escapeHtml(source.category || '분류 미입력')}</span><span>이미지 ${escapeHtml(source.imageCount)}장 · 상세 ${escapeHtml(source.detailPageCount)}건</span>`;
        button.addEventListener('click', () => void selectSource(source));
        results.append(button);
      }
      if (sources.length === 0) {
        results.innerHTML = '<p class="status-message" data-tone="error">검색 결과가 없습니다. 신규·미등록 제품 입력으로 전환해 주세요.</p>';
      }
      const preferred = Number(preferredJcode);
      const exact = Number.isInteger(preferred)
        ? sources.find(source => Number(source.jcode) === preferred)
        : null;
      if (exact) await selectSource(exact);
      else if (Number.isInteger(preferred)) notifyWorkfileLink({ status: 'not_found', jcode: preferred });
      return sources;
    } catch (error) {
      results.innerHTML = `<p class="status-message" data-tone="error">원장 검색 차단: ${escapeHtml(error.message)}</p>`;
      const preferred = Number(preferredJcode);
      if (Number.isInteger(preferred)) notifyWorkfileLink({ status: 'error', jcode: preferred });
      return [];
    }
  };

  const renderImageList = () => {
    imageList.replaceChildren();
    for (const role of ['base', 'color']) {
      const entries = role === 'base' ? state.baseImages : state.colorImages;
      for (const [index, entry] of entries.entries()) {
        const card = document.createElement('article');
        card.className = 'image-intake-card';
        const preview = URL.createObjectURL(entry.file);
        card.innerHTML = `
          <img src="${preview}" alt="" loading="lazy">
          <div class="field-stack"><label>이미지 이름<input data-field="name" value="${escapeHtml(entry.name)}" required></label></div>
          ${role === 'color' ? '<div class="field-stack"><label>색상명<input data-field="colorName" required></label></div>' : ''}
          <span class="status-message" data-tone="ok">${role === 'base' ? '기본' : '색상 옵션'} ${index + 1} · 이미지 확인 완료</span>
        `;
        card.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
          entry[input.dataset.field] = input.value;
        }));
        card.querySelector('img').addEventListener(
          'load',
          () => URL.revokeObjectURL(preview),
          { once: true },
        );
        imageList.append(card);
      }
    }
  };

  const readFiles = async (files, role) => {
    const target = role === 'base' ? state.baseImages : state.colorImages;
    target.splice(0, target.length, ...await Promise.all([...files].map(async file => ({
      file,
      fileName: file.name,
      name: file.name.replace(/\.[^.]+$/, ''),
      colorName: '',
      sha256: await digestFile(file),
      dataUrl: await dataUrlFile(file),
    }))));
    renderImageList();
    syncSubmitReadiness();
  };

  document.querySelectorAll('input[name="intake-mode"]').forEach(input => {
    input.addEventListener('change', () => setMode(input.value));
  });
  document.getElementById('product-search-button').addEventListener('click', () => void searchSources());
  document.getElementById('product-search').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void searchSources();
    }
  });
  const derivedProductId = (parsed, identity) => {
    const payload = parsed?.project?.payload || {};
    const factory = payload.factory || payload.assetPayload?.factory || {};
    const product = factory.product || {};
    const productNo = text(
      product.confirmedCafe24ProductKey
      || product.selectedCafe24CandidateKey
      || product.finalDb?.product_no,
    );
    if (/^[1-9][0-9]*$/.test(productNo)) return `cafe24:${productNo}`;
    const key = text(identity.productKey);
    return key ? `factory:${key}` : '';
  };

  const setWorkfileNotice = (copy, tone = '') => {
    const status = document.getElementById('intake-workfile-status');
    if (!status) return;
    status.textContent = copy;
    status.dataset.tone = tone;
  };

  const attachWorkfile = async file => {
    const label = document.getElementById('intake-workfile-name');
    if (!file) {
      state.attachedWorkfile = null;
      if (label) label.textContent = '선택한 파일 없음';
      setWorkfileNotice('작업파일을 붙이지 않으면 새 작업으로 시작합니다.');
      return;
    }
    if (label) label.textContent = file.name;
    setWorkfileNotice(`${file.name} 신원 확인 중…`);
    try {
      const workfileText = await file.text();
      const parsed = JSON.parse(workfileText);
      const identity = resolveWorkfileIdentity(parsed);
      // 저장된 작업파일에는 productId 가 따로 적혀 있지 않은 경우가 많다. 조립공장과
      // 같은 규칙으로 유도한다: Cafe24 에 올린 제품은 cafe24:번호, 아직 안 올린 제품은
      // factory:제품키.
      const productId = text(identity.productId) || derivedProductId(parsed, identity);
      // 신원이 하나라도 비면 조립공장이 어느 작업을 이어야 할지 알 수 없다. 그때는
      // 붙이지 않은 것으로 두고 이유를 말한다.
      const missing = ['workspaceId', 'productKey', 'runId', 'inputFingerprint']
        .filter(field => !text(identity[field]));
      if (!productId) missing.push('productId');
      if (missing.length || !Number.isInteger(identity.revision) || identity.revision < 0) {
        state.attachedWorkfile = null;
        setWorkfileNotice(`${file.name} 은 이어서 할 작업 정보가 없어 붙일 수 없습니다. 새 작업으로 시작합니다.`, 'warning');
        return;
      }
      const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(workfileText));
      const sha256 = [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      state.attachedWorkfile = {
        fileName: file.name,
        source: {
          kind: 'workfile',
          sha256,
          revision: identity.revision,
          runId: identity.runId,
          workspaceId: identity.workspaceId,
          productId,
          productKey: identity.productKey,
          inputFingerprint: identity.inputFingerprint,
        },
      };
      setWorkfileNotice(`${identity.productKey} · 저장 차수 ${identity.revision} 작업을 이어서 진행합니다.`, 'ok');
    } catch (error) {
      state.attachedWorkfile = null;
      setWorkfileNotice(`${file.name} 을 읽지 못했습니다 · ${text(error?.message || error)}`, 'error');
    }
  };

  document.getElementById('required-product-name')?.addEventListener('input', syncSubmitReadiness);
  // 크기에 '20x15' 처럼 적으면 가로·세로 칸을 채워 준다. 사람이 그 칸을 직접 건드린 뒤에는
  // 덮어쓰지 않는다 — 안 그러면 손으로 고쳐 둔 값이 다음 타자에 되돌아간다.
  for (const id of ['required-width', 'required-depth']) {
    document.getElementById(id)?.addEventListener('input', event => {
      event.target.dataset.touched = event.target.value.trim() ? 'true' : 'false';
    });
  }
  document.getElementById('required-size')?.addEventListener('input', event => {
    const pair = readSizePair(event.target.value);
    for (const [id, value] of [['required-width', pair.widthMm], ['required-depth', pair.depthMm]]) {
      if (!value) continue;
      const field = document.getElementById(id);
      if (!field || field.dataset.touched === 'true') continue;
      field.value = value;
    }
  });
  document.getElementById('base-images').addEventListener('change', event => void readFiles(event.target.files, 'base'));
  document.getElementById('color-images').addEventListener('change', event => void readFiles(event.target.files, 'color'));
  document.getElementById('intake-workfile')?.addEventListener('change', event => void attachWorkfile(event.target.files?.[0] || null));
  window.addEventListener('control-tower:workfile-classified', event => {
    const classification = event.detail?.classification;
    const jcode = Number(classification?.product?.jcode);
    if (!Number.isInteger(jcode) || jcode < 1) {
      setStatus('intake-status', '작업파일 분류는 완료됐습니다. 연결할 신화사 제품을 직접 검색해 주세요.');
      return;
    }
    const dbMode = document.getElementById('intake-mode-db');
    dbMode.checked = true;
    setMode('db');
    state.pendingWorkfileJcode = jcode;
    document.getElementById('product-search').value = String(jcode);
    setStatus('intake-status', `작업파일에서 찾은 신화사 품번 ${jcode} 자동 연결 중…`);
    void searchSources(jcode);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (state.mode === 'manual') {
        const manifest = createManualManifest({
          jcode: '',
          productName: document.getElementById('required-product-name').value,
          category: document.getElementById('required-category').value,
          requiredValues: {
            material: document.getElementById('required-material').value,
            originCountry: document.getElementById('required-origin').value,
            size: document.getElementById('required-size').value,
            // 조립공장은 사이즈이미지를 그릴 때 가로·세로를 mm 숫자 두 개로 요구한다.
            // 칸이 비었으면 크기 한 줄에서 읽어 온 값을 쓴다.
            ...resolveSizePair({
              size: document.getElementById('required-size').value,
              widthMm: document.getElementById('required-width')?.value,
              depthMm: document.getElementById('required-depth')?.value,
            }),
            salePrice: document.getElementById('required-sale-price').value,
            stock: document.getElementById('required-stock').value,
            usage: document.getElementById('required-usage').value,
            optionMode: document.getElementById('required-option-mode').value,
          },
          baseImages: state.baseImages,
          colorImages: state.colorImages,
        });
        const batchId = text(document.getElementById('batch-id').value);
        const policySnapshot = await lockPolicy(manifest.jcode || manifest.productName);
        const mode = executionMode(policySnapshot);
        setStatus('intake-status', '직접 입력 자료를 조립공장 큐에 넣는 중…');
        const queued = await apiRequest('/api/factory/jobs', {
          method: 'POST',
          body: JSON.stringify({
            ...manifest,
            batchId,
            workfileName: workfileNameFor(manifest.productName),
            imageModel: text(document.getElementById('image-model-select').value),
            mode,
            ...(state.attachedWorkfile
              ? {
                workfileName: state.attachedWorkfile.fileName,
                source: state.attachedWorkfile.source,
              }
              : { source: { kind: 'manual' } }),
            idempotencyKey: state.attachedWorkfile
              ? `factory-${batchId}-workfile-${state.attachedWorkfile.source.sha256}`
              : `factory-${batchId}-manual-${manifest.inputImages[0].sha256}`,
            policySnapshot,
            cafe24ApprovalMode: 'existing_one_time_target_gate',
          }),
        });
        const job = queued.job || {};
        setStatus('intake-status', `${manifest.productName} · 후보 생성 자동 · 단계별 선택 정책 큐 등록 완료`, 'ok');
        window.dispatchEvent(new CustomEvent('control-tower:job-created', {
          detail: { jobId: job.jobId, factoryJobId: job.jobId },
        }));
        return;
      }
      if (!state.selected) throw new ProductIntakeError('product_target_required');
      setStatus('intake-status', '선택한 신화사 DB 자료를 조립공장 입력으로 준비하는 중…');
      const snapshot = await apiRequest('/api/input-snapshots', {
        method: 'POST',
        body: JSON.stringify(buildDbSnapshotRequest({
          jcode: state.selected.jcode,
          batchId: document.getElementById('batch-id').value,
          requestedBy: 'operator',
        })),
      });
      const policySnapshot = await lockPolicy(state.selected.jcode);
      const job = await apiRequest('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(buildPdpJobRequest({
          inputSnapshotId: snapshot.id,
          idempotencyKey: `job-${snapshot.id}`,
          actor: 'operator',
        })),
      });
      const queued = await apiRequest('/api/factory/jobs', {
        method: 'POST',
        body: JSON.stringify({
          batchId: text(document.getElementById('batch-id').value),
          workfileName: workfileNameFor(state.selected.productName),
          idempotencyKey: `factory-${snapshot.id}`,
          imageModel: text(document.getElementById('image-model-select').value),
          mode: executionMode(policySnapshot),
          source: { kind: 'sinhwa-db', selectionId: String(state.selected.jcode) },
          jcode: Number(state.selected.jcode),
          productName: state.selected.productName,
          requiredValues: { category: state.selected.category || '' },
          inputImages: Array.isArray(state.selected.inputImages) ? state.selected.inputImages : [],
          pdpJobId: job.jobId,
          policySnapshot,
          cafe24ApprovalMode: 'existing_one_time_target_gate',
        }),
      });
      const factoryJob = queued.job || {};
      setStatus('intake-status', `${state.selected.productName} · 신화사 DB 자료 준비 및 조립공장 작업 등록 완료`, 'ok');
      window.dispatchEvent(new CustomEvent('control-tower:job-created', {
        detail: { jobId: job.jobId, factoryJobId: factoryJob.jobId, snapshotId: snapshot.id },
      }));
    } catch (error) {
      setStatus('intake-status', errorMessage(error.code || error.message), 'error');
    }
  });

  function executionMode(policySnapshot) {
    return policySnapshot?.locked === true ? 'auto' : 'manual';
  }
  setMode('db');
}
