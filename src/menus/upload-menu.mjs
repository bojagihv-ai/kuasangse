import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

const RENDER_HELPER_NAMES = Object.freeze([
  "renderFactoryLightImage",
  "analysisImageSrc",
  "disabledAttr",
  "escapeHtml"
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createUploadMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  const startAnalysis = requiredFunction(actions, 'startAnalysis');
  const uploadActionNames = Object.freeze([
    'uploadFiles', 'updateProductName', 'saveProductName',
    'clearAnalysisImages', 'removeAnalysisImage',
  ]);
  const uploadActions = Object.fromEntries(
    uploadActionNames.map(name => [name, typeof actions[name] === 'function' ? actions[name] : () => undefined]),
  );
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);


  let active = false;
  let generation = 0;
  let contract;
  const activeDisposers = new Set();

  function runCommand(action, value) {
    const operationToken = getOperationToken();
    const context = Object.freeze({
      operationToken,
      isCurrent: () => getOperationToken() === operationToken,
    });
    const result = action(value, context);
    if (!result || typeof result.then !== 'function') return result;
    return Promise.resolve(result).then(output => {
      if (!context.isCurrent()) throw new Error('STALE_MENU_OPERATION');
      return output;
    });
  }

  const commands = {
    startAnalysis: {
      capability: 'product-analysis:write',
      execute(value) {
        assertMutable();
        return runCommand(startAnalysis, value);
      },
    },
  };

  function invoke(name, value) {
    try {
      const result = contract.invoke(name, value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  }

  function invokeUploadAction(name, value) {
    try {
      assertMutable();
      const result = runCommand(uploadActions[name], value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    }
  }

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'upload',
    routes: ['upload'],
    ownedSlices: ['product-analysis'],
    capabilities: ['product-analysis:read', 'product-analysis:write'],
    persistence: { reads: ['product-analysis'], writes: ['product-analysis'] },
    select() {
      return getSnapshot() || {};
    },
    commands,
    render(view) {
      return renderUploadView(view, renderHelpers);
    },
    bind(root) {
      const bindings = [];
      const bindProperty = (node, property, handler) => {
        if (!node) return;
        const previous = node[property];
        node[property] = handler;
        bindings.push(() => { if (node[property] === handler) node[property] = previous || null; });
      };
      const uploadArea = root?.querySelector?.('#uploadArea');
      const fileInput = root?.querySelector?.('#fileInput');
      bindProperty(uploadArea, 'onclick', () => fileInput?.click?.());
      bindProperty(uploadArea, 'ondragover', event => event?.preventDefault?.());
      bindProperty(uploadArea, 'ondrop', event => {
        event?.preventDefault?.();
        invokeUploadAction('uploadFiles', event?.dataTransfer?.files);
      });
      fileInput?.setAttribute?.('multiple', '');
      bindProperty(fileInput, 'onchange', event => {
        if (event?.target?.files?.length) invokeUploadAction('uploadFiles', event.target.files);
      });
      const nameInput = root?.querySelector?.('#productNameInput');
      bindProperty(nameInput, 'oninput', event => invokeUploadAction('updateProductName', event?.target?.value || ''));
      bindProperty(nameInput, 'onchange', () => invokeUploadAction('saveProductName'));
      bindProperty(root?.querySelector?.('#clearAnalysisImages'), 'onclick', () => invokeUploadAction('clearAnalysisImages'));
      for (const node of root?.querySelectorAll?.('[data-remove-analysis-img]') || []) {
        bindProperty(node, 'onclick', event => {
          event?.stopPropagation?.();
          invokeUploadAction('removeAnalysisImage', Number(node.dataset.removeAnalysisImg));
        });
      }
      const addMoreInput = root?.querySelector?.('#addMoreFileInput');
      const addMoreButton = root?.querySelector?.('#addMoreImgBtn');
      bindProperty(addMoreButton, 'onclick', event => {
        if (event?.target === addMoreButton || event?.target?.tagName !== 'INPUT') addMoreInput?.click?.();
      });
      bindProperty(addMoreInput, 'onchange', event => invokeUploadAction('uploadFiles', event?.target?.files));
      bindProperty(root?.querySelector?.('#startAnalysis'), 'onclick', event => {
        event?.preventDefault?.();
        invoke('startAnalysis');
      });
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of bindings.splice(0).reverse()) dispose();
        activeDisposers.delete(dispose);
      };
      activeDisposers.add(dispose);
      return dispose;
    },
    onEnter() {
      active = true;
      generation += 1;
      void active;
      void generation;
      void getOperationToken();
    },
    onLeave() {
      for (const dispose of [...activeDisposers].reverse()) dispose();
      active = false;
      generation += 1;
    },
  });

  return contract;
}

function renderUploadView(view, helpers) {
  const {
    renderFactoryLightImage,
    analysisImageSrc,
    disabledAttr,
    escapeHtml,
  } = helpers;
  return `<div class="fade-in">
    <h1 class="page-title">상세페이지 자동 생성</h1>
    <p class="page-desc">제품 이미지를 업로드하면 AI가 분석하여 15개 섹션의 상세페이지를 자동으로 생성합니다.</p>

    ${view.analysisImages.length > 0 ? `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:13px;font-weight:600">분석 이미지 (${view.analysisImages.length}/5) <span style="color:var(--text-d);font-weight:400">— 첫 번째가 대표 이미지</span></span>
        <button class="btn-sm" id="clearAnalysisImages" style="color:var(--err)">전체 삭제</button>
      </div>
      <div class="analysis-imgs-row" id="analysisImgsRow">
        ${view.analysisImages.map((img, i) => `
          <div class="analysis-img-thumb ${i===0?'primary':''}">
            ${renderFactoryLightImage(analysisImageSrc(img), `제품 이미지 ${i + 1}`)}
            <button class="remove-img" data-remove-analysis-img="${i}" title="삭제">✕</button>
          </div>`).join('')}
        ${view.analysisImages.length < 5 ? `
          <div class="analysis-img-thumb" id="addMoreImgBtn" style="border-style:dashed;display:flex;align-items:center;justify-content:center;color:var(--text-d);font-size:24px;cursor:pointer" title="이미지 추가">
            +<input type="file" id="addMoreFileInput" accept="image/*" multiple style="display:none">
          </div>` : ''}
      </div>
    </div>` : `
    <div class="upload-area ${view.imagePreview?'has-image':''}" id="uploadArea">
      ${view.imagePreview
        ? renderFactoryLightImage(view.imagePreview, 'preview', 'class="preview-img"')
        : `<div style="display:flex;flex-direction:column;align-items:center">
            <span class="material-icons-outlined" style="font-size:48px;color:var(--primary);margin-bottom:12px">cloud_upload</span>
            <p style="font-size:16px;font-weight:500">클릭 또는 드래그하여 이미지 업로드</p>
            <p style="font-size:13px;color:var(--text-m);margin-top:6px">JPG, PNG, WEBP 지원 · 최대 5장 동시 분석 가능</p>
          </div>`
      }
      <input type="file" id="fileInput" accept="image/*" multiple style="display:none">
    </div>`}
    <button class="btn-primary" id="startAnalysis" style="margin-bottom:8px" ${disabledAttr(!view.imagePreview && view.analysisImages.length===0, '분석할 제품 이미지를 먼저 업로드해주세요.')}>
      <span class="material-icons-outlined" style="font-size:20px">auto_fix_high</span>
      AI 분석 시작 ${view.analysisImages.length > 1 ? `(${view.analysisImages.length}장)` : ''}
    </button>

    <div class="input-group">
      <label class="label">제품명 (선택사항)</label>
      <input type="text" class="input" id="productNameInput" value="${escapeHtml(view.productName)}" placeholder="AI가 자동 감지하지만, 직접 입력하면 더 정확합니다">
    </div>

    <div class="feature-grid">
      <div class="feature-card"><div class="mi material-icons-outlined">visibility</div><h4>이미지 분석</h4><p>Gemini AI가 제품 특징을 자동 분석</p></div>
      <div class="feature-card"><div class="mi material-icons-outlined">search</div><h4>경쟁 분석</h4><p>유사 제품의 상세페이지 참조 검색</p></div>
      <div class="feature-card"><div class="mi material-icons-outlined">dashboard</div><h4>15섹션 자동생성</h4><p>헤더부터 CTA까지 풀 상세페이지</p></div>
      <div class="feature-card"><div class="mi material-icons-outlined">image</div><h4>이미지 생성</h4><p>각 섹션에 맞는 이미지 AI 생성</p></div>
    </div>
  </div>`;
}
