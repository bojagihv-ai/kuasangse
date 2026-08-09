export function renderCompetitorReportView(view, helpers) {
  const {
    renderCompetitorFlowNav,
    compMarketAnalysisMatchesSelectedImages,
    ensureCompMarketScrapeState,
    renderCompetitorLlmPill,
    renderCompetitorStylePresetCard,
    renderCompetitorEvidenceCard,
    sectionWorkScopeMeta,
    sectionWorkScopeMatches,
    disabledAttr,
    escapeHtml,
  } = helpers;
  const cp = view.compPage;
    const r = cp.analysisResult || {};
    const analysisProductScope = r.analysisProductScope || null;
    const previousViewOnly = !!cp.previousAnalysisViewOnly
      || (!!cp.analysisResult && !compMarketAnalysisMatchesSelectedImages(ensureCompMarketScrapeState(), cp.analysisResult))
      || (!!cp.analysisResult && (
        !analysisProductScope ||
        !sectionWorkScopeMatches(analysisProductScope, sectionWorkScopeMeta())
      ));
    const sections = r.sections_found || [];
    const typeLabel = {header:'헤더',hook:'훅',features:'핵심특징',specs:'스펙',scenarios:'사용시나리오',comparison:'비교우위',material:'소재/기술',certification:'인증',review:'리뷰',size_color:'사이즈/컬러',promotion:'프로모션',shipping:'배송',faq:'FAQ',brand_story:'브랜드스토리',cta:'CTA',other:'기타'};

    const ps = r.page_score || {};
    const total = typeof ps.total === 'number' ? ps.total : null;

    const scoreColor = s => s >= 8 ? '#48bb78' : s >= 6 ? '#f6ad55' : s >= 4 ? '#fc8181' : '#e53e3e';
    const gradeBg = g => ({S:'#6366f1',A:'#48bb78',B:'#38b2ac',C:'#f6ad55',D:'#fc8181',F:'#e53e3e'}[g]||'#666');
    const renderStars = (score, size=15) => {
      let h = '';
      for (let i = 1; i <= 5; i++) {
        const v = score/2;
        h += v >= i ? `<span style="color:#f6ad55;font-size:${size}px">★</span>`
           : v >= i-.5 ? `<span style="color:#f6ad55;font-size:${size}px;opacity:.6">★</span>`
           : `<span style="color:#444;font-size:${size}px">☆</span>`;
      }
      return h;
    };

    return `<div class="fade-in">
      ${renderCompetitorFlowNav('report')}
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap">
        <button class="btn-sm" data-comp-back="input" style="gap:6px"><span class="material-icons-outlined" style="font-size:14px">arrow_back</span>다시 입력</button>
        <h1 class="page-title" style="margin:0">🔍 경쟁사 분석 결과</h1>
        <div style="flex:1"></div>
        ${cp.sectionPlan
          ? `<button class="btn-sm" data-comp-flow-target="plan" ${previousViewOnly ? disabledAttr(true, '이전 결과 보기용 리포트입니다. 현재 선택 이미지 기준으로 다시 분석해야 섹션 플랜을 쓸 수 있습니다.') : ''} style="background:var(--primary);color:#fff;border-color:var(--primary)"><span class="material-icons-outlined" style="font-size:14px">dashboard_customize</span>섹션 플랜으로</button>`
          : `<button class="btn-sm" data-comp-flow-generate="1" ${previousViewOnly ? disabledAttr(true, '이전 결과 보기용 리포트입니다. 현재 선택 이미지 기준으로 다시 분석해야 섹션 플랜을 생성할 수 있습니다.') : ''} style="background:var(--primary);color:#fff;border-color:var(--primary)"><span class="material-icons-outlined" style="font-size:14px">auto_fix_high</span>섹션 플랜 생성</button>`}
      </div>
      <p class="page-desc" style="margin-bottom:16px">${r.page_title ? `"${escapeHtml(r.page_title)}" 분석 완료 · ` : ''}섹션 ${sections.length}개 발견</p>
      ${previousViewOnly ? `<div class="comp-card" style="margin-bottom:14px;border-color:rgba(245,158,11,.55);background:rgba(245,158,11,.08)">
        <div style="font-size:13px;font-weight:900;color:var(--warn);margin-bottom:4px">이전 경쟁사 분석 결과 보기</div>
        <div style="font-size:12px;color:var(--text);line-height:1.55">이 리포트는 보존된 이전 결과입니다. 현재 선택 이미지와 기준이 달라 기본 섹션 플랜 생성에는 쓰지 않습니다. 현재 선택 이미지 기준으로 쓰려면 다시 분석해주세요.</div>
      </div>` : ''}
      ${renderCompetitorLlmPill(false)}
      ${renderCompetitorStylePresetCard(r)}

      ${total !== null ? `
      <!-- ── 총점 헤더 ── -->
      <div style="background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(99,102,241,.05));border:1px solid rgba(99,102,241,.3);border-radius:12px;padding:16px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:14px">
          <div style="text-align:center">
            <div style="font-size:48px;font-weight:900;color:${scoreColor(total)};line-height:1">${total.toFixed(1)}</div>
            <div style="font-size:11px;color:var(--text-m)">/10점</div>
            <div style="margin-top:4px">${renderStars(total, 16)}</div>
          </div>
          <div style="flex:1">
            ${ps.grade ? `<span style="display:inline-block;background:${gradeBg(ps.grade)};color:#fff;font-size:18px;font-weight:900;padding:3px 14px;border-radius:20px;margin-bottom:8px">${escapeHtml(ps.grade)}등급</span>` : ''}
            ${ps.verdict ? `<p style="font-size:13px;color:var(--text);line-height:1.6;margin:0;font-style:italic">"${escapeHtml(ps.verdict)}"</p>` : ''}
          </div>
        </div>

        <!-- 항목별 바 요약 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px">
          ${(ps.criteria||[]).map(c=>`
            <div style="display:flex;align-items:center;gap:6px;font-size:11px">
              <span style="font-size:13px">${escapeHtml(c.icon || '')}</span>
              <span style="color:var(--text-m);min-width:80px;font-size:11px">${escapeHtml(c.name || '')}</span>
              <div style="flex:1;height:4px;background:#333;border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${(c.score||0)*10}%;background:${scoreColor(c.score||0)};border-radius:2px"></div>
              </div>
              <span style="font-weight:700;color:${scoreColor(c.score||0)};min-width:20px;text-align:right">${c.score||0}</span>
            </div>`).join('')}
        </div>

        <!-- 최우선 개선사항 -->
        ${(ps.top_priorities||[]).length > 0 ? `
        <div style="margin-top:14px;padding:12px;background:rgba(229,62,62,.1);border:1px solid rgba(229,62,62,.25);border-radius:8px">
          <div style="font-size:12px;font-weight:700;color:#fc8181;margin-bottom:8px">🚨 지금 당장 고쳐야 할 것</div>
          ${ps.top_priorities.map(p=>`<div style="font-size:12px;color:var(--text);line-height:1.6;margin-bottom:4px">${escapeHtml(p)}</div>`).join('')}
        </div>` : ''}
      </div>

      <!-- ── 항목별 상세 카드 ── -->
      <div style="margin-bottom:16px">
        <div style="font-size:15px;font-weight:900;color:var(--text);margin-bottom:6px;display:flex;align-items:center;gap:7px">
          <span>📋</span><span>타사 상세페이지 진단</span>
        </div>
        <div style="font-size:12px;color:var(--text-m);line-height:1.6;margin-bottom:10px">
          아래 점수와 문제점은 업로드한 경쟁사/타사 상세페이지 기준입니다. 우리 제품 이미지는 근거 이미지로 대체 표시하지 않습니다.
        </div>
        ${renderCompetitorLlmPill(false)}
        <div class="comp-analysis-list">
          ${(ps.criteria||[]).map((c, idx) => {
            const sc = c.score || 0;
            const col = scoreColor(sc);
            return `<div class="comp-analysis-card" style="border-left-color:${col}">
              <div class="comp-analysis-grid">
                <div class="comp-analysis-main">
                  <div class="comp-analysis-head">
                    <span class="comp-analysis-icon">${escapeHtml(c.icon || '📌')}</span>
                    <span class="comp-analysis-title">${escapeHtml(c.name || '')}</span>
                    <div class="comp-analysis-score">
                      ${renderStars(sc, 12)}
                      <span class="comp-score-num" style="color:${col}">${sc}</span>
                      <span class="comp-score-denom">/10</span>
                    </div>
                  </div>
                  ${c.current_state ? `<div class="comp-current-state"><b style="color:var(--text);font-size:11px;margin-right:4px">현황</b>${escapeHtml(c.current_state)}</div>` : ''}
                  ${(c.issues||[]).length > 0 ? `<div class="comp-issue-list">${c.issues.map(i=>`<span class="comp-issue-chip"><span>×</span>${escapeHtml(i)}</span>`).join('')}</div>` : ''}
                  ${c.to_perfect ? `<div class="comp-to-perfect">
                    <strong>💡 이 타사 페이지가 10점 받으려면</strong>${escapeHtml(c.to_perfect)}
                  </div>` : ''}
                </div>
                ${renderCompetitorEvidenceCard(c, idx)}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="comp-card" style="margin-bottom:16px">
        <div class="comp-card-title">📋 전체 전략 요약</div>
        <p style="color:var(--text-m);line-height:1.7;font-size:14px">${escapeHtml(r.overall_strategy || '-')}</p>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div class="comp-card">
          <div class="comp-card-title">✅ 강점</div>
          ${(r.strengths||[]).map(s=>`<div class="comp-tag comp-tag-green">${escapeHtml(s)}</div>`).join('')||'<span style="color:var(--text-m);font-size:13px">없음</span>'}
        </div>
        <div class="comp-card">
          <div class="comp-card-title">⚠️ 약점</div>
          ${(r.weaknesses||[]).map(s=>`<div class="comp-tag comp-tag-red">${escapeHtml(s)}</div>`).join('')||'<span style="color:var(--text-m);font-size:13px">없음</span>'}
        </div>
      </div>

      ${(r.selling_strategies||[]).length>0?`<div class="comp-card" style="margin-bottom:16px">
        <div class="comp-card-title">💡 판매 전략</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${(r.selling_strategies||[]).map(s=>`<span class="comp-tag">${escapeHtml(s)}</span>`).join('')}</div>
      </div>`:''}

      <div class="comp-card" style="margin-bottom:20px">
        <div class="comp-card-title">🗂 발견된 섹션 (${sections.length}개)</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${sections.map(s=>`<div style="display:flex;gap:10px;padding:8px;background:var(--bg);border-radius:6px;font-size:13px">
            <span style="background:var(--primary);color:#fff;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;white-space:nowrap">${escapeHtml(typeLabel[s.type] || s.type || '기타')}</span>
            <div><div style="font-weight:600;color:var(--text)">${escapeHtml(s.headline || '-')}</div><div style="color:var(--text-m);margin-top:2px">${escapeHtml(s.body_summary || '')}</div></div>
          </div>`).join('')}
        </div>
      </div>

      ${cp.sectionPlan
        ? `<div style="display:flex;gap:10px">
            <button class="btn" id="compViewPlan" ${previousViewOnly ? disabledAttr(true, '이전 결과 보기용 리포트입니다. 현재 기준으로 다시 분석해야 섹션 플랜을 열 수 있습니다.') : ''} style="flex:1;justify-content:center;font-size:15px;padding:13px">
              <span class="material-icons-outlined">dashboard_customize</span> 섹션 플랜 보기 →
            </button>
            <button class="btn-secondary" id="compGenPlan" ${previousViewOnly ? disabledAttr(true, '이전 결과 보기용 리포트입니다. 현재 기준으로 다시 분석해야 플랜을 다시 만들 수 있습니다.') : ''} style="padding:13px 16px" title="플랜 다시 생성">
              <span class="material-icons-outlined">refresh</span>
            </button>
          </div>`
        : `<button class="btn" id="compGenPlan" ${previousViewOnly ? disabledAttr(true, '이전 결과 보기용 리포트입니다. 현재 기준으로 다시 분석해야 섹션 플랜을 만들 수 있습니다.') : ''} style="width:100%;justify-content:center;font-size:16px;padding:14px">
            <span class="material-icons-outlined">auto_fix_high</span> 이 분석으로 15개 섹션 플랜 생성 →
          </button>`}
    </div>`;
}
