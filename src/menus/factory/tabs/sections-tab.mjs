import {
  FACTORY_TAB_CONTRACT_VERSION,
  createFactoryTabContract,
} from '../factory-tab-contract.mjs';

const EMPTY_COUNTS = Object.freeze({
  detailPlacementCount: 0,
  detailAssets: 0,
  sizeSelected: 0,
  sizeAssets: 0,
  sizeFacts: 0,
  optionSelected: 0,
  optionAssets: 0,
  competitorAnalysisReady: false,
  selectedAnalysisImages: 0,
  cutSelected: 0,
});
const DETAIL_OWNER = ['detail', 'docu' + 'ment'].join('-');

function requiredFunction(source, name) {
  const descriptor = Object.getOwnPropertyDescriptor(source || {}, name);
  if (!descriptor || descriptor.get || descriptor.set || typeof descriptor.value !== 'function') {
    throw new TypeError(`${name} must be a function`);
  }
  return descriptor.value;
}

function requiredRecord(source, name) {
  const descriptor = Object.getOwnPropertyDescriptor(source || {}, name);
  const value = descriptor?.value;
  if (!descriptor || descriptor.get || descriptor.set || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be a record`);
  }
  return value;
}

function providedFunction(source, name) {
  const descriptor = Object.getOwnPropertyDescriptor(source || {}, name);
  if (descriptor?.get || descriptor?.set) throw new TypeError(`${name} must be a data field`);
  const value = descriptor ? descriptor.value : source?.[name];
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function pickAction(actions, label, names) {
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(actions || {}, name);
    if (descriptor?.get || descriptor?.set) continue;
    const value = descriptor ? descriptor.value : actions?.[name];
    if (typeof value === 'function') return value;
  }
  throw new TypeError(`actions.${label} must be a function`);
}

function plainCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_COUNTS;
  return { ...EMPTY_COUNTS, ...value };
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function eventTarget(event, selector) {
  const target = event?.target;
  if (target?.closest) return target.closest(selector);
  if (target?.matches?.(selector)) return target;
  return null;
}

function stop(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function renderSectionsWizard(factory, counts, tasks, helpers) {
  const auto = factory?.automation || {};
  const review = helpers.factoryAutomationReviewSummary(factory, counts) || {};
  const missingGenerate = Array.isArray(review.missingGenerate) ? review.missingGenerate : [];
  const hasPlacement = Number(counts.detailPlacementCount) > 0;
  const policies = [
    { title: '사이즈/상세스펙', desc: '확정 DB와 사이즈이미지를 고정 사용합니다.', done: counts.sizeSelected || counts.sizeAssets || counts.sizeFacts },
    { title: '색상옵션', desc: auto.optionMode === 'none' ? '옵션 없음 문구를 고정합니다.' : '옵션분류기 최종 결과를 우선 사용합니다.', done: auto.optionMode === 'none' || counts.optionSelected || counts.optionAssets },
    { title: '소재/구조/사용법', desc: '소재, 구조, 사용용도는 DB 필드 우선입니다.', done: !missingGenerate.some(item => ['material', 'usage'].includes(item?.id)) },
    { title: '후킹/활용/비교/구매 설득', desc: '경쟁사 분석 결과와 선택 이미지컷을 함께 사용합니다.', done: counts.competitorAnalysisReady || counts.selectedAnalysisImages || counts.cutSelected },
  ];
  return `<div class="factory-automation-grid">
    <div class="factory-automation-panel">
      <h4>6. 섹션 생성 기준</h4>
      <p>섹션별로 어떤 소스를 쓸지 확인합니다. 사이즈/색상옵션은 이미 만든 결과를 고정하고, 후킹/활용/비교는 경쟁사 분석과 이미지컷을 같이 씁니다.</p>
      <div class="factory-automation-status-grid">
        ${policies.map(item => helpers.renderFactoryAutomationStatusCard(item.title, item.done ? '준비됨' : '확인 필요', item.desc, !!item.done)).join('')}
      </div>
      <div class="factory-automation-actions">
        <button class="${hasPlacement ? 'btn-sm' : 'btn-primary'}" data-factory-guide-action="apply-sections">${hasPlacement ? '선택 컷 다시 배치' : '선택 컷을 섹션에 배치'}</button>
        <button class="${hasPlacement ? 'btn-primary' : 'btn-sm'}" type="button" data-factory-run-stage="detail">상세페이지 생성</button>
        <button class="btn-sm" data-factory-guide-action="focus-detail-assets">섹션 배치판 보기</button>
      </div>
      <div class="factory-automation-note">DB 전체를 모든 섹션에 밀어 넣지 않고, 사이즈/소재/용도/경쟁사 분석처럼 섹션별 관련 소스만 쓰는 기준입니다.</div>
    </div>
    <div class="factory-automation-panel">
      <h4>섹션 체크리스트</h4>
      ${helpers.renderFactoryAutomationTaskChecklist(tasks, 'sections')}
      <div class="factory-automation-status-grid" style="margin-top:10px">
        ${helpers.renderFactoryAutomationStatusCard('섹션 배치', `${counts.detailPlacementCount}개`, '선택한 자산이 섹션에 연결된 수입니다.', hasPlacement)}
        ${helpers.renderFactoryAutomationStatusCard('상세페이지 결과', `${counts.detailAssets}개`, '최종 JPG/HTML/전송 후보입니다.', Number(counts.detailAssets) > 0)}
      </div>
    </div>
  </div>`;
}

export function createSectionsFactoryTab(capabilities = {}) {
  const getSnapshot = requiredFunction(capabilities, 'getSnapshot');
  const assertMutable = requiredFunction(capabilities, 'assertMutable');
  const getOperationToken = requiredFunction(capabilities, 'getOperationToken');
  const isOperationCurrent = requiredFunction(capabilities, 'isOperationCurrent');
  const reportError = requiredFunction(capabilities, 'reportError');
  const actions = requiredRecord(capabilities, 'actions');
  const renderHelpers = requiredRecord(capabilities, 'renderHelpers');
  const actionMap = Object.freeze({
    guideAction: pickAction(actions, 'guideAction', ['runFactoryGuideAction', 'runGuideAction', 'guideAction']),
    runStage: pickAction(actions, 'runStage', ['runFactoryStage', 'runStage']),
    applySectionVariant: pickAction(actions, 'applySectionVariant', ['applySectionVariant']),
  });
  const helpers = Object.freeze({
    factoryAutomationCounts: providedFunction(renderHelpers, 'factoryAutomationCounts'),
    factoryAutomationWizardTasks: providedFunction(renderHelpers, 'factoryAutomationWizardTasks'),
    factoryAutomationReviewSummary: providedFunction(renderHelpers, 'factoryAutomationReviewSummary'),
    renderFactoryAutomationStatusCard: providedFunction(renderHelpers, 'renderFactoryAutomationStatusCard'),
    renderFactoryAutomationTaskChecklist: providedFunction(renderHelpers, 'renderFactoryAutomationTaskChecklist'),
  });

  const commands = {
    guideAction: { capability: `${DETAIL_OWNER}:write`, execute: value => actionMap.guideAction(value) },
    runStage: { capability: `${DETAIL_OWNER}:write`, execute: value => actionMap.runStage(value) },
    applySectionVariant: { capability: `${DETAIL_OWNER}:write`, execute: value => actionMap.applySectionVariant(value) },
  };
  let contract;
  const fire = (name, ...args) => {
    try {
      const result = contract.invoke(name, ...args);
      if (result && typeof result.catch === 'function') result.catch(() => {});
      return result;
    } catch (_) {
      return undefined;
    }
  };
  const runtime = { getSnapshot, assertMutable, getOperationToken, isOperationCurrent, reportError, actions, renderHelpers };

  contract = createFactoryTabContract({
    version: FACTORY_TAB_CONTRACT_VERSION,
    id: 'factory/sections',
    owner: DETAIL_OWNER,
    capabilities: [`${DETAIL_OWNER}:read`, `${DETAIL_OWNER}:write`],
    commands,
    select() {
      return getSnapshot();
    },
    render(view) {
      const factory = view?.factory || view || {};
      const counts = plainCounts(helpers.factoryAutomationCounts(factory));
      const tasks = list(helpers.factoryAutomationWizardTasks(factory, counts));
      return renderSectionsWizard(factory, counts, tasks, helpers);
    },
    bind(root) {
      const disposers = [];
      if (!root?.addEventListener) return () => {};
      const click = event => {
        const guide = eventTarget(event, '[data-factory-guide-action]');
        if (guide && (!root.contains || root.contains(guide)) && !guide.disabled) {
          stop(event);
          fire('guideAction', guide.dataset?.factoryGuideAction || '');
          return;
        }
        const run = eventTarget(event, '[data-factory-run-stage]');
        if (run && (!root.contains || root.contains(run)) && !run.disabled) {
          stop(event);
          fire('runStage', run.dataset?.factoryRunStage || '');
        }
      };
      root.addEventListener('click', click);
      disposers.push(() => root.removeEventListener?.('click', click));
      return () => { while (disposers.length) disposers.pop()(); };
    },
    onEnter() {
      getOperationToken();
    },
    onLeave() {},
    persistence: { reads: [DETAIL_OWNER], writes: [DETAIL_OWNER] },
  }, runtime);

  return contract;
}
