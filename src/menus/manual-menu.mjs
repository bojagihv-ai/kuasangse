import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

export function createManualMenu({ getWorkflowSteps, escapeHtml, navigate }) {
  const readWorkflowSteps = requireFunction(getWorkflowSteps, 'getWorkflowSteps');
  const escape = requireFunction(escapeHtml, 'escapeHtml');
  const navigateTo = typeof navigate === 'function' ? navigate : () => false;
  const activeDisposers = new Set();

  return createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'manual',
    routes: ['manual'],
    ownedSlices: ['manualUi'],
    capabilities: [],
    select(rootState = {}) {
      return rootState.manualUi || {};
    },
    commands: {},
    render() {
      const steps = readWorkflowSteps();
      return `<div class="fade-in">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap;margin-bottom:18px">
      <div>
        <h1 class="page-title" style="margin-bottom:6px">상세페이지 자동화 설명서</h1>
        <p class="page-desc">헷갈리는 자동화 흐름을 작업 기준서처럼 다시 확인하는 화면입니다. 첫 설명은 제품 분석·DB 매칭 단계입니다.</p>
      </div>
      <button class="btn-sm" data-nav="analyzing" style="padding:8px 12px">
        <span class="material-icons-outlined" style="font-size:15px">analytics</span>
        제품 분석 화면으로
      </button>
    </div>

    <div class="analysis-box" style="margin-bottom:18px">
      <div style="font-size:18px;font-weight:900;margin-bottom:6px">이미지 분석 메뉴의 실제 의미</div>
      <div style="font-size:13px;color:var(--text-d);line-height:1.7">
        이 메뉴는 사진만 분석하는 화면이 아니라, <b style="color:var(--text)">제품 사진을 LLM이 해석하고, 이미지 단서/직접 입력명/자연어 힌트로 신화사DB·Cafe24 같은 자료원을 검색한 뒤, 상세페이지 생성에 쓸 오른쪽 기준 데이터를 만드는 준비 단계</b>입니다.
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:12px">
      ${steps.map(step => `<section class="analysis-box" style="margin-bottom:0">
        <div style="display:grid;grid-template-columns:42px minmax(0,1fr);gap:12px;align-items:start">
          <div style="width:42px;height:42px;border-radius:12px;background:var(--primary);color:#fff;font-size:18px;font-weight:900;display:flex;align-items:center;justify-content:center">${step.n}</div>
          <div style="min-width:0">
            <div style="font-size:16px;font-weight:900;color:var(--text);margin-bottom:4px">${escape(step.title)}</div>
            <div style="font-size:12px;color:var(--primary-h);font-weight:800;margin-bottom:8px">${escape(step.short)}</div>
            <div style="font-size:13px;color:var(--text-d);line-height:1.75;word-break:keep-all">${escape(step.detail)}</div>
            <div style="margin-top:10px;border:1px solid var(--border);border-radius:10px;background:var(--bg);padding:10px">
              <div style="font-size:11px;color:var(--text-m);margin-bottom:4px">결과로 남는 것</div>
              <div style="font-size:12px;font-weight:800;color:var(--text);line-height:1.55">${escape(step.output)}</div>
            </div>
          </div>
        </div>
      </section>`).join('')}
    </div>

    <div class="analysis-box" style="margin-top:18px;background:rgba(245,158,11,.07);border-color:rgba(245,158,11,.28)">
      <div style="font-size:15px;font-weight:900;color:var(--warn);margin-bottom:8px">작업자가 기억할 핵심</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px">
        ${[
          ['이미지 유사검색 아님', '현재 신화사 DB 매칭은 사진을 DB 이미지와 비교하지 않습니다. 제품명 텍스트 검색입니다.'],
          ['제품명 직접 입력이 중요', '제품명이 정확하면 DB 후보가 좋아집니다. 직접 입력명은 AI 추론명보다 우선됩니다.'],
          ['DB는 확정값', '규격, 색상, 재고, 원가 같은 값은 LLM 추정보다 DB 값을 더 믿어야 합니다.'],
          ['옵션 사진은 다음 단계', '색상옵션과 옵션 사진은 DB 매칭 후 별도 버튼으로 불러와 옵션 분류기에 적용합니다.'],
        ].map(([title, body]) => `<div style="border:1px solid rgba(245,158,11,.22);border-radius:10px;background:rgba(5,7,17,.42);padding:10px">
          <div style="font-size:12px;font-weight:900;color:var(--text);margin-bottom:5px">${escape(title)}</div>
          <div style="font-size:12px;color:var(--text-d);line-height:1.55">${escape(body)}</div>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
    },
    bind(root) {
      const button = root?.querySelector?.('[data-nav]');
      if (!button) return () => {};
      const previous = button.onclick;
      const handler = event => {
        event?.preventDefault?.();
        navigateTo(button.dataset.nav);
      };
      button.onclick = handler;
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (button.onclick === handler) button.onclick = previous || null;
        activeDisposers.delete(dispose);
      };
      activeDisposers.add(dispose);
      return dispose;
    },
    onEnter() {},
    onLeave() {
      for (const dispose of [...activeDisposers].reverse()) dispose();
    },
    persistence: { reads: [], writes: [] },
  });
}
