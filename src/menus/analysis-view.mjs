export function renderAnalyzingView(view, helpers) {
  const {
    getActiveAnalysisRun,
    expireStaleAnalysisRunIfNeeded,
    renderAnalysisHub,
    escapeHtml,
    renderModelRunLine,
    renderAnalysisRunLogs,
  } = helpers;
  const run = getActiveAnalysisRun();
  if (expireStaleAnalysisRunIfNeeded(run)) return renderAnalysisHub();
  if (!run || run.status !== 'running') return renderAnalysisHub();
  const progress = Math.max(0, Math.min(100, Math.round(Number(run.progress ?? view.progress ?? 0) || 0)));
  const latestLog = Array.isArray(run.logs) && run.logs.length ? run.logs[run.logs.length - 1] : null;
  const message = view.progressMsg || latestLog?.message || '제품 이미지 분석 중...';
  const lastUpdatedAt = run.lastUpdatedAt || latestLog?.ts || run.startedAt;
  const elapsedSec = lastUpdatedAt ? Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000)) : 0;
  return `<div data-analysis-progress-status style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:46vh">
    <div class="spinner-lg"></div>
    <h2 style="font-size:22px;margin-top:24px;margin-bottom:8px">AI 분석 진행 중</h2>
    <p data-analysis-progress-message style="color:var(--text-d);margin-bottom:10px">${escapeHtml(message)}</p>
    <div style="font-size:12px;color:var(--text-m);margin-bottom:20px">${escapeHtml(renderModelRunLine(run.llm))}</div>
    <div class="progress-outer"><div data-analysis-progress-bar class="progress-inner" style="width:${progress}%">${progress}%</div></div>
    <div style="display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:12px">
      <span data-analysis-progress-elapsed style="font-size:11px;color:var(--text-m)">마지막 진행 갱신 ${elapsedSec}초 전</span>
      <button class="btn-sm" id="stopAnalysisRunBtn" style="color:var(--warn);padding:6px 10px">
        <span class="material-icons-outlined" style="font-size:14px">stop_circle</span>
        분석 중단하고 돌아가기
      </button>
    </div>
    <div class="analysis-box" style="width:min(760px,100%);margin-top:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
        <div style="font-size:15px;font-weight:900">실시간 작업 로그</div>
        <div style="font-size:12px;color:var(--text-m)">나중에 AI 분석 종합에서 다시 볼 수 있습니다.</div>
      </div>
      <div data-analysis-progress-logs>${renderAnalysisRunLogs(run)}</div>
    </div>
  </div>`;
}
