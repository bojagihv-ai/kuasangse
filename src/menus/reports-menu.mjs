import { MENU_CONTRACT_VERSION, createMenuContract } from '../modules/menu-contracts.mjs';

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  return value;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateLabel(value) {
  const timestamp = number(value);
  if (!timestamp) return '저장 시각 없음';
  return new Date(timestamp).toLocaleString('ko-KR');
}

function safeUrl(value) {
  const text = String(value || '').trim();
  return /^https:\/\//.test(text) ? text : '';
}

export function createReportsMenu({
  fetchReports,
  openReportFolder,
  requestRender,
  escapeHtml,
  escapeAttr,
  resetScroll = () => {},
}) {
  const fetchReportList = requireFunction(fetchReports, 'fetchReports');
  const openFolder = requireFunction(openReportFolder, 'openReportFolder');
  const rerender = requireFunction(requestRender, 'requestRender');
  const escape = requireFunction(escapeHtml, 'escapeHtml');
  const attr = requireFunction(escapeAttr, 'escapeAttr');
  const scrollToTop = requireFunction(resetScroll, 'resetScroll');
  const viewState = {
    status: 'idle',
    payload: null,
    error: '',
    folderMessage: '',
  };
  let entered = false;
  let requestId = 0;

  function snapshot() {
    return Object.freeze({
      status: viewState.status,
      payload: viewState.payload,
      error: viewState.error,
      folderMessage: viewState.folderMessage,
    });
  }

  function notify() {
    if (entered) rerender();
  }

  async function refreshReports({ notifyStart = true, resetAfter = false } = {}) {
    const currentRequest = requestId + 1;
    requestId = currentRequest;
    viewState.status = 'loading';
    viewState.error = '';
    viewState.folderMessage = '';
    if (notifyStart) notify();
    try {
      const payload = await fetchReportList();
      if (currentRequest !== requestId) return null;
      if (!payload?.ok || !Array.isArray(payload.reports)) {
        throw new Error('작업 리포트 응답 형식이 올바르지 않습니다.');
      }
      viewState.payload = payload;
      viewState.status = 'ready';
      notify();
      if (resetAfter) scrollToTop();
      return payload;
    } catch (error) {
      if (currentRequest !== requestId) return null;
      viewState.status = 'error';
      viewState.error = String(error?.message || error);
      notify();
      throw error;
    }
  }

  async function openReportsFolder() {
    try {
      const result = await openFolder();
      viewState.folderMessage = result?.ok
        ? '작업 리포트 폴더를 열었습니다.'
        : '작업 리포트 폴더를 열지 못했습니다.';
      notify();
      return result;
    } catch (error) {
      viewState.folderMessage = String(error?.message || error);
      notify();
      throw error;
    }
  }

  function renderCafe24(cafe24) {
    if (!cafe24) return '';
    const adminUrl = safeUrl(cafe24.admin_url);
    const storefrontUrl = safeUrl(cafe24.storefront_url);
    const continuations = Array.isArray(cafe24.continuation_workfile_names)
      ? cafe24.continuation_workfile_names.filter(Boolean)
      : [];
    return `<section class="workfile-report-cafe24" aria-label="Cafe24 등록 결과">
      <div class="workfile-report-cafe24-head">
        <strong>Cafe24 #${escape(cafe24.product_no || '-')}</strong>
        <span>${escape(cafe24.product_code || '상품코드 없음')}</span>
      </div>
      <div class="workfile-report-product">${escape(cafe24.product_name || '상품명 확인 필요')}</div>
      <div class="workfile-report-facts">
        <span>${number(cafe24.option_group_count)}그룹 · ${number(cafe24.option_value_count)}값 · ${number(cafe24.variant_count)}품목</span>
        <span>진열 ${escape(cafe24.display || '-')} · 판매 ${escape(cafe24.selling || '-')}</span>
      </div>
      <dl class="workfile-report-source">
        <div><dt>등록 원본</dt><dd>${escape(cafe24.source_workfile_name || '확인 필요')}</dd></div>
        <div><dt>후속 보정</dt><dd>${escape(continuations.join(', ') || '없음')}</dd></div>
      </dl>
      <div class="workfile-report-links">
        ${adminUrl ? `<a class="btn-sm" href="${attr(adminUrl)}" target="_blank" rel="noopener">Cafe24 관리자</a>` : ''}
        ${storefrontUrl ? `<a class="btn-sm" href="${attr(storefrontUrl)}" target="_blank" rel="noopener">상품 페이지</a>` : ''}
      </div>
    </section>`;
  }

  function renderReport(report) {
    const registered = report.status_code === 'cafe24_registered';
    const stoppedStage = `${number(report.stopped_at_stage_number)}단계 ${escape(report.stopped_at_stage_label || '확인 필요')}`;
    const progress = registered
      ? '7단계 전송 완료'
      : `${stoppedStage}에서 멈춤`;
    return `<article class="workfile-report-card ${registered ? 'is-registered' : 'is-progress'}">
      <header class="workfile-report-card-head">
        <div>
          <div class="workfile-report-status">${escape(report.status_label || '상태 확인 필요')}</div>
          <h2>${escape(report.product_name || report.project_name || '제품명 미입력')}</h2>
        </div>
        <span class="workfile-report-stage">${progress}</span>
      </header>
      <div class="workfile-report-workfile">${escape(report.workfile_name || '')}</div>
      <div class="workfile-report-meta">
        <span>마지막 완료 ${number(report.last_completed_stage_number)}단계 ${escape(report.last_completed_stage_label || '-')}</span>
        <span>섹션 ${number(report.section_count)}개</span>
        <span>${escape(dateLabel(report.exported_at))}</span>
      </div>
      ${renderCafe24(report.cafe24)}
    </article>`;
  }

  function render(view = snapshot()) {
    const payload = view.payload;
    const reports = Array.isArray(payload?.reports) ? payload.reports : [];
    const loading = view.status === 'loading' || view.status === 'idle';
    return `<div class="workfile-report-page fade-in">
      <header class="workfile-report-page-head">
        <div>
          <h1 class="page-title">작업 리포트</h1>
          <p class="page-desc">작업파일별 조립공장 진행 단계와 Cafe24 등록 결과를 원본 파일 기준으로 확인합니다.</p>
        </div>
        <div class="workfile-report-actions">
          <button class="btn-sm" type="button" data-report-refresh ${loading ? 'disabled aria-disabled="true"' : ''}>
            <span class="material-icons-outlined" aria-hidden="true">refresh</span>
            ${loading ? '불러오는 중' : '새로고침'}
          </button>
          <button class="btn-sm primary" type="button" data-report-open-folder>
            <span class="material-icons-outlined" aria-hidden="true">folder_open</span>
            리포트 폴더 열기
          </button>
        </div>
      </header>
      ${view.folderMessage ? `<div class="app-notice" role="status">${escape(view.folderMessage)}</div>` : ''}
      ${view.status === 'error' ? `<div class="workfile-report-error" role="alert">
        <strong>리포트를 불러오지 못했습니다.</strong>
        <span>${escape(view.error)}</span>
        <button class="btn-sm" type="button" data-report-refresh>다시 불러오기</button>
      </div>` : ''}
      ${payload ? `<section class="workfile-report-summary" aria-label="작업 리포트 요약">
        <div><span>전체 작업파일</span><strong>${number(payload.count)}</strong></div>
        <div><span>Cafe24 등록</span><strong>${number(payload.registeredCount)}</strong></div>
        <div><span>진행/중단</span><strong>${number(payload.inProgressCount)}</strong></div>
      </section>` : ''}
      ${loading && !payload ? '<div class="analysis-box" role="status">작업파일 결과를 모으는 중입니다.</div>' : ''}
      ${view.status === 'ready' && reports.length === 0 ? '<div class="analysis-box">아직 확인할 .kuasangse 작업파일이 없습니다.</div>' : ''}
      <section class="workfile-report-list">${reports.map(renderReport).join('')}</section>
      ${payload ? `<footer class="workfile-report-footer">
        <span>리포트 폴더</span>
        <strong>${escape(payload.outputDir || '')}</strong>
        <span>갱신 ${escape(payload.generatedAt || '-')}</span>
      </footer>` : ''}
    </div>`;
  }

  const menu = createMenuContract({
    version: MENU_CONTRACT_VERSION,
    id: 'reports',
    routes: ['reports'],
    ownedSlices: ['shared'],
    capabilities: ['reports:read', 'reports:folder-open'],
    select() {
      return snapshot();
    },
    commands: {
      refresh: {
        capability: 'reports:read',
        execute: refreshReports,
      },
      openFolder: {
        capability: 'reports:folder-open',
        execute: openReportsFolder,
      },
    },
    render,
    bind(root) {
      const handler = event => {
        const refreshButton = event.target?.closest?.('[data-report-refresh]');
        if (refreshButton && root.contains(refreshButton)) {
          event.preventDefault?.();
          void menu.invoke('refresh').catch(() => {});
          return;
        }
        const folderButton = event.target?.closest?.('[data-report-open-folder]');
        if (folderButton && root.contains(folderButton)) {
          event.preventDefault?.();
          void menu.invoke('openFolder').catch(() => {});
        }
      };
      root?.addEventListener?.('click', handler);
      return () => root?.removeEventListener?.('click', handler);
    },
    onEnter() {
      entered = true;
      scrollToTop();
      void refreshReports({ notifyStart: false, resetAfter: true }).catch(() => {});
    },
    onLeave() {
      entered = false;
      requestId += 1;
    },
    persistence: { reads: [], writes: [] },
  });

  return menu;
}
