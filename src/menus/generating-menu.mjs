import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

const RENDER_HELPER_NAMES = Object.freeze([
  "orderedSections",
  "escapeHtml"
]);

function requiredFunction(source, name) {
  if (typeof source?.[name] !== 'function') throw new TypeError(name + ' must be a function');
  return source[name];
}

export function createGeneratingMenu(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = capabilities.actions || {};
  const stopAfterCurrent = requiredFunction(actions, 'stopAfterCurrent');
  const renderHelpers = capabilities.renderHelpers || {};
  for (const name of RENDER_HELPER_NAMES) requiredFunction(renderHelpers, name);


  let active = false;
  let generation = 0;
  let contract;
  const activeDisposers = new Set();
  const bindingByRoot = new WeakMap();

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
    stopAfterCurrent: {
      capability: 'detail-document:write',
      execute(value) {
        assertMutable();
        return runCommand(stopAfterCurrent, value);
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

  contract = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'generating',
    routes: ['generating'],
    ownedSlices: ['detail-document'],
    capabilities: ['detail-document:read', 'detail-document:write'],
    persistence: { reads: ['detail-document'], writes: ['detail-document'] },
    select() {
      return getSnapshot() || {};
    },
    commands,
    render(view) {
      return renderGeneratingView(view, renderHelpers);
    },
    bind(root) {
      bindingByRoot.get(root)?.dispose?.();
      const bindings = [];
      const bindProperty = (node, property, handler) => {
        if (!node) return;
        const previous = node[property];
        node[property] = handler;
        bindings.push(() => { if (node[property] === handler) node[property] = previous || null; });
      };
      bindProperty(root?.querySelector?.('#stopAfterCurrentSection'), 'onclick', event => {
        event?.preventDefault?.();
        invoke('stopAfterCurrent');
      });
      for (const node of root?.querySelectorAll?.('[data-route-target]') || []) {
        bindProperty(node, 'onclick', event => {
          event?.preventDefault?.();
          invoke('navigate', node.dataset.routeTarget);
        });
      }
      for (const node of root?.querySelectorAll?.('[data-generate-section]') || []) {
        bindProperty(node, 'onclick', event => {
          event?.preventDefault?.();
          event?.stopPropagation?.();
          invoke('generateSection', node.dataset.generateSection);
        });
      }
      for (const node of root?.querySelectorAll?.('[data-preview-viewport]') || []) {
        bindProperty(node, 'onclick', event => {
          event?.preventDefault?.();
          invoke('setViewport', node.dataset.previewViewport);
        });
      }
      for (const node of root?.querySelectorAll?.('[data-start-generating]') || []) {
        bindProperty(node, 'onclick', event => {
          event?.preventDefault?.();
          invoke('startGenerating');
        });
      }
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of bindings.splice(0).reverse()) dispose();
        activeDisposers.delete(dispose);
        if (bindingByRoot.get(root)?.dispose === dispose) bindingByRoot.delete(root);
      };
      activeDisposers.add(dispose);
      bindingByRoot.set(root, { dispose });
      return dispose;
    },
    refresh(root) {
      if (!active) return;
      bindingByRoot.get(root)?.dispose?.();
      contract.bind(root);
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

function renderGeneratingView(view, helpers) {
  const {
    orderedSections,
    escapeHtml,
  } = helpers;
  const currentSections = orderedSections();
  const icons = currentSections.map(s=>s.icon);
  const doneCount = Object.keys(view.sectionContents).length;
  const run = view.sectionBatchRun && typeof view.sectionBatchRun === 'object' ? view.sectionBatchRun : {};
  const stopRequested = !!run.stopRequested;
  const currentSectionName = run.currentSectionName || '현재 섹션';
  return `<div data-section-batch-progress-status style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:70vh">
    <div class="spinner-lg"></div>
    <h2 style="font-size:24px;margin-top:32px;margin-bottom:8px">상세페이지 생성 중</h2>
    <p data-section-batch-progress-message style="color:var(--text-d);margin-bottom:24px;text-align:center">${view.progressMsg}</p>
    <div class="progress-outer"><div data-section-batch-progress-bar class="progress-inner" style="width:${view.progress}%">${view.progress}%</div></div>
    <p style="font-size:12px;color:var(--text-m);margin-top:16px">${currentSections.length}개 섹션 × (콘텐츠 + 이미지) 생성 중 — Gemini API 호출</p>
    <div class="gen-icons">
      ${icons.map((ic,i) => `<div class="gen-icon ${i<doneCount?'done':''}">${ic}</div>`).join('')}
    </div>
    <div style="width:min(520px,100%);margin-top:22px;padding:14px;border:1px solid ${stopRequested ? 'rgba(245,158,11,.48)' : 'var(--border)'};border-radius:12px;background:${stopRequested ? 'rgba(245,158,11,.08)' : 'var(--bg-card)'};display:flex;flex-direction:column;align-items:center;gap:9px;text-align:center">
      <button class="btn-sm" id="stopAfterCurrentSection" type="button" ${stopRequested ? 'disabled title="현재 섹션을 저장한 뒤 자동으로 중지합니다."' : 'title="현재 섹션의 텍스트와 이미지 저장을 마친 뒤 중지합니다."'} style="padding:10px 16px;border-color:rgba(245,158,11,.58);color:var(--warn);font-weight:950">
        <span class="material-icons-outlined" style="font-size:18px">${stopRequested ? 'hourglass_top' : 'stop_circle'}</span>
        ${stopRequested ? `${escapeHtml(currentSectionName)} 마무리 중` : '현재 섹션까지만 생성'}
      </button>
      <div style="font-size:12px;color:${stopRequested ? 'var(--warn)' : 'var(--text-m)'};line-height:1.55">
        ${stopRequested
          ? `${escapeHtml(currentSectionName)}의 텍스트와 이미지 저장이 끝나면 미리보기로 이동합니다.`
          : '누르면 지금 생성 중인 섹션을 끝까지 저장하고, 다음 섹션은 시작하지 않습니다.'}
      </div>
    </div>
  </div>`;
}
