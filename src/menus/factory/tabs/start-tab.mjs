import { createFactoryTabContract, FACTORY_TAB_CONTRACT_VERSION } from '../factory-tab-contract.mjs';

const RUNTIME_FIELDS = Object.freeze([
  'getSnapshot', 'assertMutable', 'getOperationToken', 'isOperationCurrent',
  'reportError', 'actions', 'renderHelpers',
]);
const ACTION_NAMES = Object.freeze({
  runDb: ['runDb', 'runDbCompetitorHeroCutsFlow'],
  focusProductPanel: ['focusProductPanel', 'focusProduct'],
  setProductName: ['setProductName', 'updateProductName', 'setCurrentProductIdentity'],
  setNaturalHint: ['setNaturalHint', 'updateNaturalHint'],
  setStartCount: ['setStartCount', 'updateStartCount'],
  confirmTask: ['confirmTask', 'confirmAutomationTask'],
  skipTask: ['skipTask', 'skipAutomationTask'],
  setProductImage: ['setProductImage', 'uploadProductImage', 'factorySetProductImage'],
  promoteStoredProductImage: ['promoteStoredProductImage', 'promoteStoredProductCandidate'],
});

function ownRuntime(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('start tab capabilities must be an object');
  }
  const runtime = {};
  for (const name of RUNTIME_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    if (!descriptor || descriptor.get || descriptor.set) {
      throw new TypeError(`start tab capability ${name} must be an own data field`);
    }
    runtime[name] = descriptor.value;
  }
  return runtime;
}

function helper(renderHelpers, name, fallback) {
  const value = renderHelpers?.[name];
  return typeof value === 'function' ? value : fallback;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function textHelper(helpers) { return helper(helpers, 'escapeHtml', escapeHtml); }
function attrHelper(helpers) {
  return helper(helpers, 'escapeAttr', helper(helpers, 'escAttr', escapeHtml));
}

function productImage(product = {}) {
  const input = Array.isArray(product.inputImages)
    ? product.inputImages.find(item => item?.preview || item?.base64 || item?.dataUrl)
    : null;
  const preview = product.imagePreview && product.imagePreview !== '__stored_in_indexeddb__'
    ? product.imagePreview : (input?.preview || input?.dataUrl || '');
  if (preview) return String(preview);
  if (product.imageBase64) return `data:${product.imageMime || 'image/png'};base64,${product.imageBase64}`;
  if (input?.base64) return `data:${input.mime || product.imageMime || 'image/png'};base64,${input.base64}`;
  return '';
}

function storedProductImage(factory = {}) {
  const product = factory.product || {};
  const candidate = product.storedProductCandidate || product.storedProductImage
    || factory.storedProductCandidate || null;
  if (!candidate || typeof candidate !== 'object') return null;
  const src = candidate.src || candidate.preview || candidate.dataUrl || '';
  return src ? { ...candidate, src: String(src) } : null;
}

function countsFor(factory = {}) {
  const product = factory.product || {};
  const assets = Array.isArray(factory.assets) ? factory.assets : [];
  const stageCount = stage => assets.filter(asset => String(asset?.stageId || '') === stage).length;
  const candidates = name => Array.isArray(product[name]) ? product[name].length : 0;
  const preview = productImage(product);
  const stored = preview ? null : storedProductImage(factory);
  const competitors = Array.isArray(product.competitors) ? product.competitors.length : 0;
  return {
    hasImage: !!preview || !!stored?.src,
    hasProductImagePayload: !!preview,
    stored,
    hasName: !!String(product.productName || product.userProductName || '').trim(),
    heroAssets: stageCount('hero'),
    cutAssets: stageCount('cuts'),
    competitorCandidates: competitors,
    competitors,
    dbCandidates: candidates('pendingDbCandidates') + candidates('dbCandidates'),
    cafe24Candidates: candidates('pendingCafe24Candidates') + candidates('cafe24Candidates'),
  };
}

function defaultTasks(counts) {
  return [
    { id: 'start-input', title: '제품 사진과 제품명 확인', desc: counts.hasImage && counts.hasName ? '시작 입력이 준비됐습니다.' : '제품 이미지와 제품명을 먼저 넣어주세요.', action: 'focus-product-panel', done: counts.hasImage && counts.hasName },
    { id: 'db-select', title: '신화사DB/Cafe24 후보 선택', desc: counts.dbCandidates + counts.cafe24Candidates ? '수집된 후보 중 맞는 상품을 선택하세요.' : '시작 버튼으로 DB 후보 수집을 진행하세요.', action: 'go-tab:db', done: counts.dbCandidates + counts.cafe24Candidates > 0 },
    { id: 'asset-picks', title: '대표이미지와 이미지컷 확인', desc: counts.heroAssets + counts.cutAssets ? '생성된 이미지를 확인하고 필요한 컷을 선택하세요.' : '대표이미지와 이미지컷 생성 결과를 기다립니다.', action: 'go-tab:assets', done: counts.heroAssets + counts.cutAssets > 0 },
  ];
}

function tasksFor(factory, counts) {
  const tasks = factory.automation?.tasks;
  if (!Array.isArray(tasks)) return defaultTasks(counts);
  return tasks.filter(task => !task?.tab || task.tab === 'start').map(task => ({
    id: String(task.id || ''), title: String(task.title || ''), desc: String(task.desc || task.description || ''),
    action: String(task.action || 'focus-product-panel'), done: task.displayStatus === 'done' || task.done === true,
    skipped: task.skipped === true,
  })).filter(task => task.id && task.title);
}

function renderImage(src, alt, helpers, attr) {
  const rendered = helper(helpers, 'renderFactoryLightImage', () => '')(src, alt, 'data-factory-light-priority="1"');
  return rendered || `<img src="${attr(src)}" alt="${attr(alt)}" data-factory-light-priority="1" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;background:#fff">`;
}

function renderProductDrop(factory, counts, helpers) {
  const attr = attrHelper(helpers);
  const text = textHelper(helpers);
  const preview = productImage(factory.product || {});
  const stored = counts.stored;
  const title = preview ? '이미지 교체 버튼을 누르거나 드래그해서 다른 입력 슬롯으로 보냅니다.' : '클릭하거나 드래그해서 0단계 자료로 등록합니다.';
  const imageBody = preview
    ? `${renderImage(preview, '제품 입력 이미지', helpers, attr)}<button class="btn-sm" type="button" data-factory-open-product-file="guide" style="position:absolute;right:10px;top:10px;z-index:4;background:rgba(10,12,20,.86);border-color:rgba(255,255,255,.18)">이미지 교체</button>`
    : stored?.src
      ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,7,12,.78);padding:10px">${renderImage(stored.src, '보관된 대표이미지', helpers, attr)}</div><div style="position:absolute;left:10px;right:10px;bottom:10px;z-index:2;display:flex;align-items:flex-end;justify-content:space-between;gap:8px;flex-wrap:wrap"><div style="min-width:180px;max-width:100%;border:1px solid rgba(245,158,11,.38);background:rgba(20,14,4,.88);border-radius:10px;padding:8px 10px;color:var(--warn);font-size:11px;line-height:1.45"><b style="display:block;color:#fbbf24;font-size:12px">기본이미지 보관본을 복구합니다</b>현재 작업 보관본을 기본 원본으로 고정해 다음 생성 단계에 연결합니다.</div><button class="btn-sm" type="button" data-factory-guide-action="promote-stored-product-image">기본이미지로 고정</button></div>`
      : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:180px;color:var(--text-m)"><span class="material-icons-outlined" style="font-size:42px;color:var(--primary)">add_photo_alternate</span><span>제품 사진을 클릭하거나 드래그해 넣어주세요.</span><span class="factory-small">JPG, PNG, WEBP · 제품 원본 이미지</span></div>`;
  return `<div class="factory-drop factory-automation-drop" id="factoryGuideProductDrop" tabindex="0" data-factory-has-image="${preview ? '1' : '0'}" data-factory-stored-product-candidate="${stored?.src ? '1' : '0'}" data-factory-needs-input-archive-restore="${counts.hasProductImagePayload ? '0' : '1'}" title="${attr(title)}">${imageBody}<input type="file" id="factoryGuideProductFile" accept="image/*" style="display:none"></div>`;
}

function statusCard(label, value, detail, done, text) {
  return `<div class="factory-automation-status-card ${done ? 'done' : 'warn'}"><span>${text(label)}</span><strong>${text(String(value))}</strong><span>${text(detail)}</span></div>`;
}

function renderTask(task, helpers) {
  const text = textHelper(helpers);
  const done = task.done || task.skipped;
  const label = task.skipped ? '넘김' : (done ? '완료' : '대기');
  return `<div class="factory-automation-step ${done ? 'done' : 'warn'}"><span class="material-icons-outlined">${task.skipped ? 'skip_next' : done ? 'check_circle' : 'schedule'}</span><div><div class="factory-automation-step-title">${text(task.title)}</div><div class="factory-automation-step-desc">${text(task.skipped ? `넘김 처리됨 · ${task.desc}` : task.desc)}</div></div><div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;justify-content:flex-end"><span class="factory-pill">${label}</span><button class="btn-sm" type="button" data-factory-guide-action="${text(task.action)}">${text(done ? '열기' : '진행')}</button>${done ? '' : `<button class="btn-sm" type="button" data-factory-confirm-task="${text(task.id)}">직접 완료 표시</button><button class="btn-sm" type="button" data-factory-skip-task="${text(task.id)}">이번 작업 건너뛰기</button>`}</div></div>`;
}

function renderStart(snapshot, helpers) {
  const factory = snapshot?.factory || {};
  const product = factory.product || {};
  const counts = countsFor(factory);
  const text = textHelper(helpers);
  const attr = attrHelper(helpers);
  const productName = String(product.productName || product.userProductName || '');
  const naturalHint = String(product.naturalHint || '');
  const tasks = tasksFor(factory, counts);
  const candidateCount = counts.dbCandidates + counts.cafe24Candidates;
  const cards = [
    ['제품 이미지', counts.hasProductImagePayload ? '원본 고정됨' : counts.stored ? '보관본 복구 가능' : '대기', counts.hasProductImagePayload ? '모든 생성 입력으로 사용됩니다.' : counts.stored ? '현재 작업 보관본을 기본 원본으로 고정해 생성에 연결합니다.' : '제품 이미지를 넣어주세요.', counts.hasImage],
    ['제품명', counts.hasName ? productName : '미입력', counts.hasName ? 'DB/Cafe24/VM 검색어로 사용됩니다.' : '제품명을 입력해야 수집이 시작됩니다.', counts.hasName],
    ['확보된 대표이미지', counts.heroAssets ? `${counts.heroAssets}개` : counts.stored ? '보관본 1개' : '0개', counts.heroAssets ? '이미 만들어져 보관함에 남아 있는 대표이미지입니다.' : '이미 만들어져 보관함에 남아 있는 대표이미지입니다.', counts.heroAssets > 0 || !!counts.stored],
    ['확보된 이미지컷', `${counts.cutAssets}개`, '이미 만들어져 보관함에 남아 있는 이미지컷입니다.', counts.cutAssets > 0],
    ['확보된 VM 후보', `${counts.competitorCandidates}건`, '이미 수집된 경쟁사 후보입니다. 상세수집은 선택 뒤 진행합니다.', counts.competitorCandidates > 0],
    ['확보된 DB 후보', `${candidateCount}건`, '이미 수집된 DB/Cafe24 후보입니다.', candidateCount > 0],
  ];
  return `<div class="factory-automation-grid" data-factory-tab="start"><div class="factory-automation-panel"><h4>1. 시작</h4><p>제품 이미지와 제품명을 넣고 시작하면 대표이미지 생성, 이미지컷 생성, VM 후보수집, DB 후보수집을 동시에 돌립니다. 화면은 바로 DB 확정으로 넘어갑니다.</p>${renderProductDrop(factory, counts, helpers)}<div class="factory-input-row"><div><label class="label">제품명</label><input class="input" id="factoryGuideProductName" value="${attr(productName)}" placeholder="예: 크리스탈보자기"></div><div><label class="label">자연어 힌트</label><input class="input" id="factoryGuideNaturalHint" value="${attr(naturalHint)}" placeholder="예: 색동, 지갑형, 선물용"></div></div><div class="factory-automation-actions"><button class="btn-primary" type="button" data-factory-guide-action="run-db"><span class="material-icons-outlined" style="font-size:16px">rocket_launch</span>DB/경쟁사 수집 및 대표/이미지컷 생성</button><button class="btn-sm" type="button" data-factory-guide-action="focus-product-panel">기존 입력판으로 이동</button></div></div><div class="factory-automation-panel"><h4>이미 확보된 자료</h4><div class="factory-automation-status-grid">${cards.map(card => statusCard(...card, text)).join('')}</div><h4 style="margin-top:14px">이번 시작 버튼으로 실행할 수량</h4><p>기존 결과가 있으면 0으로 두고 건너뛸 수 있습니다. 이미지컷은 4로 두면 1번 프롬프트부터 4번 프롬프트까지만 생성합니다.</p><div class="factory-automation-status-grid">${[['hero', '대표이미지 생성 수', 4, '대표이미지 프롬프트 앞에서부터 생성'], ['cuts', '이미지컷 생성 수', 4, '이미지컷 프롬프트 앞에서부터 생성'], ['competitors', 'VM 후보 수집 수', 3, '사이트별 Top 후보 수집']].map(([key, label, max, detail]) => `<label class="factory-automation-status-card" style="display:block"><span>${text(label)}</span><input class="input" type="number" min="0" max="${max}" data-factory-start-count="${key}" value="${attr(factory.automation?.startRunCounts?.[key] ?? max)}" style="margin-top:7px;min-height:34px"><span>${text(detail)} · 0이면 이번 실행에서 건너뜁니다. 최대 ${max}.</span></label>`).join('')}</div>${candidateCount ? `<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)"><h4>이번 시작에서 확보된 같은상품 후보</h4><p>1번 시작으로 수집된 신화사DB/Cafe24 후보입니다. 사진과 상품명을 확인한 뒤 맞는 상품을 확정하세요.</p></div>` : ''}<div class="factory-automation-step-list">${tasks.map(task => renderTask(task, helpers)).join('')}</div></div></div>`;
}

export function createStartFactoryTab(capabilities = {}) {
  const runtime = ownRuntime(capabilities);
  const { getSnapshot, reportError, actions, renderHelpers } = runtime;
  const action = (name, value) => {
    const candidates = ACTION_NAMES[name] || [name];
    const target = candidates.map(candidate => actions?.[candidate]).find(item => typeof item === 'function');
    if (!target) throw new Error(`missing injected factory action: ${candidates[0]}`);
    const token = runtime.getOperationToken();
    const context = Object.freeze({ operationToken: token, isCurrent: () => runtime.isOperationCurrent(token) });
    return target(value, context);
  };
  const commands = {
    runDb: { capability: 'factory:write', execute: value => action('runDb', value) },
    focusProductPanel: { capability: 'factory:read', execute: value => action('focusProductPanel', value) },
    setProductName: { capability: 'factory:write', execute: value => action('setProductName', String(value ?? '')) },
    setNaturalHint: { capability: 'factory:write', execute: value => action('setNaturalHint', String(value ?? '')) },
    setStartCount: { capability: 'factory:write', execute: value => action('setStartCount', value) },
    confirmTask: { capability: 'factory:write', execute: value => action('confirmTask', String(value ?? '')) },
    skipTask: { capability: 'factory:write', execute: value => action('skipTask', String(value ?? '')) },
    setProductImage: { capability: 'factory:write', execute: value => action('setProductImage', value) },
    promoteStoredProductImage: { capability: 'factory:write', execute: value => action('promoteStoredProductImage', value) },
  };
  let contract;
  const invokeFromEvent = (name, value) => {
    try {
      const result = contract.invoke(name, value);
      if (result && typeof result.catch === 'function') result.catch(reportError);
    } catch (error) { reportError(error); }
  };
  contract = createFactoryTabContract({
    version: FACTORY_TAB_CONTRACT_VERSION, id: 'factory/start', owner: 'factory',
    capabilities: ['factory:read', 'factory:write'], commands,
    select: () => getSnapshot(), render: view => renderStart(view, renderHelpers),
    bind(root) {
      const disposers = [];
      const listen = (type, listener) => {
        if (!root?.addEventListener) return;
        root.addEventListener(type, listener); disposers.push(() => root.removeEventListener?.(type, listener));
      };
      const closest = (event, selector) => {
        const target = event?.target;
        if (target?.matches?.(selector)) return target;
        return target?.closest?.(selector) || null;
      };
      const valueFrom = (selector, event) => {
        const target = event?.target;
        const direct = /^(INPUT|TEXTAREA|SELECT)$/.test(String(target?.tagName || '')) ? target?.value : '';
        return direct || root?.querySelector?.(selector)?.value || '';
      };
      listen('click', event => {
        const guide = closest(event, '[data-factory-guide-action]');
        const confirm = closest(event, '[data-factory-confirm-task]');
        const skip = closest(event, '[data-factory-skip-task]');
        const openFile = closest(event, '[data-factory-open-product-file]');
        if (guide) {
          event.preventDefault?.();
          const actionName = guide.dataset?.factoryGuideAction;
          if (actionName === 'run-db') invokeFromEvent('runDb', { productName: valueFrom('#factoryGuideProductName', event), naturalHint: valueFrom('#factoryGuideNaturalHint', event) });
          else if (actionName === 'focus-product-panel') invokeFromEvent('focusProductPanel');
          else if (actionName === 'promote-stored-product-image') invokeFromEvent('promoteStoredProductImage');
          return;
        }
        if (confirm) { event.preventDefault?.(); invokeFromEvent('confirmTask', confirm.dataset?.factoryConfirmTask); return; }
        if (skip) { event.preventDefault?.(); invokeFromEvent('skipTask', skip.dataset?.factorySkipTask); return; }
        if (openFile) { event.preventDefault?.(); root?.querySelector?.('#factoryGuideProductFile')?.click?.(); return; }
        const productDrop = closest(event, '#factoryGuideProductDrop');
        if (productDrop) { event.preventDefault?.(); root?.querySelector?.('#factoryGuideProductFile')?.click?.(); }
      });
      listen('input', event => {
        const target = event?.target;
        if (target?.id === 'factoryGuideProductName') invokeFromEvent('setProductName', target.value);
        else if (target?.id === 'factoryGuideNaturalHint') invokeFromEvent('setNaturalHint', target.value);
        else if (target?.dataset?.factoryStartCount) invokeFromEvent('setStartCount', { key: target.dataset.factoryStartCount, value: target.value });
      });
      listen('change', event => {
        const target = event?.target;
        if (target?.id !== 'factoryGuideProductFile') return;
        const file = target.files?.[0];
        if (file) invokeFromEvent('setProductImage', file);
        if (target) target.value = '';
      });
      listen('dragover', event => { if (closest(event, '#factoryGuideProductDrop')) event.preventDefault?.(); });
      listen('drop', event => {
        if (!closest(event, '#factoryGuideProductDrop')) return;
        event.preventDefault?.();
        const file = event.dataTransfer?.files?.[0];
        if (file) invokeFromEvent('setProductImage', file);
      });
      return () => { while (disposers.length) disposers.pop()(); };
    },
    onEnter() {}, onLeave() {}, persistence: { reads: ['factory'], writes: ['factory'] },
  }, runtime);
  return contract;
}
