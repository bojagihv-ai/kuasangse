import { renderCompetitorReportView } from './competitor-menu-report-view.mjs';
import { renderCompetitorPlanView } from './competitor-menu-plan-view.mjs';

export function renderCompetitorStepView(view, helpers) {
  const {
    getCurrentLlmRunInfo,
    formatElapsedSeconds,
    renderCompetitorFlowNav,
    renderCompetitorAnalyzeLogItems,
    renderCompetitorLlmPill,
    compMarketAnalysisMatchesSelectedImages,
    renderCompetitorStylePresetCard,
    renderCompetitorEvidenceCard,
    ensureCurrentProductAnalysisForGeneration,
    hasCurrentProductAnalysisForGeneration,
    orderedSections,
    getSectionGenerationModeInfo,
    sectionBasisDisplayInfo,
    getSectionBasisModeInfo,
    getSectionBasisDetail,
    sectionBasisOptionLabel,
    renderPlanInstructionReadable,
    renderPlanImprovementBridge,
    productAnalysisGenerationBlockReason,
    loadCompAnalysis,
    ensureCompMarketScrapeState,
    compMarketSavedAnalysisMatchesSelectedImages,
    renderCompMarketScrapePanel,
    renderFactoryLightImage,
    disabledAttr,
    escAttr,
    escapeHtml,
    SECTION_BASIS_MODES,
    SECTION_GENERATION_MODES,
  } = helpers;
  const cp = view.compPage;
  const backendBase = (cp.scraperBase || 'http://127.0.0.1:5001').replace(/\/+$/, '');
  const hasBackend = cp.backendOk === true;

  if (cp.subStep === 'analyzing') {
    const progress = Math.max(0, Math.min(100, Number(cp.analyzeProgress || 8)));
    const model = cp.analyzeModel || getCurrentLlmRunInfo();
    const elapsed = cp.analyzeStartedAt
      ? (cp.analyzeElapsedSec || Math.floor((Date.now() - cp.analyzeStartedAt) / 1000))
      : 0;
    const logs = Array.isArray(cp.analyzeLogs) ? cp.analyzeLogs : [];
    return `<div class="fade-in" data-comp-analyze-root style="padding:32px 20px">
      <div style="max-width:760px;margin:0 auto;text-align:center">
        ${renderCompetitorFlowNav('report')}
        <div class="spinner-lg" style="margin:0 auto 22px"></div>
        <h2 style="font-size:22px;margin-bottom:8px">경쟁사 분석 진행 중</h2>
        <p data-comp-analyze-msg style="font-size:16px;color:var(--text);font-weight:700;margin-bottom:6px">${escapeHtml(cp.analyzeMsg || '경쟁사 페이지 분석 중...')}</p>
        <p data-comp-analyze-detail style="font-size:12px;color:var(--text-m);line-height:1.6;margin-bottom:18px;${cp.analyzeDetail ? '' : 'display:none'}">${escapeHtml(cp.analyzeDetail || '')}</p>
        <div data-comp-analyze-detail-spacer style="height:8px;${cp.analyzeDetail ? 'display:none' : ''}"></div>
        <div class="progress-outer" style="max-width:560px;margin:0 auto 18px">
          <div class="progress-inner" data-comp-analyze-progress style="width:${progress}%">${progress}%</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;text-align:left;margin-bottom:14px">
          <div style="border:1px solid var(--border);border-radius:12px;background:var(--bg-card);padding:12px">
            <div style="font-size:11px;color:var(--text-m);margin-bottom:5px">현재 작업</div>
            <div data-comp-analyze-stage style="font-size:14px;font-weight:800;color:var(--text)">${escapeHtml(cp.analyzeStage || '경쟁사 분석')}</div>
          </div>
          <div style="border:1px solid var(--border);border-radius:12px;background:var(--bg-card);padding:12px">
            <div style="font-size:11px;color:var(--text-m);margin-bottom:5px">사용 LLM</div>
            <div style="font-size:14px;font-weight:800;color:${model.providerId === 'openai' ? '#10a37f' : 'var(--primary-h)'}">${escapeHtml(model.modelLabel)}</div>
            <div style="font-size:11px;color:var(--text-m);margin-top:3px">${escapeHtml(model.providerLabel)} · ${escapeHtml(model.route)} · ${escapeHtml(model.modelId)}</div>
          </div>
          <div style="border:1px solid var(--border);border-radius:12px;background:var(--bg-card);padding:12px">
            <div style="font-size:11px;color:var(--text-m);margin-bottom:5px">경과 시간</div>
            <div data-comp-analyze-elapsed style="font-size:14px;font-weight:800;color:var(--text)">${formatElapsedSeconds(elapsed)}</div>
          </div>
        </div>
        <div style="border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.025);padding:12px;text-align:left">
          <div style="font-size:12px;font-weight:900;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span class="material-icons-outlined" style="font-size:15px;color:var(--primary-h)">receipt_long</span>
            실시간 작업 로그
          </div>
          <div data-comp-analyze-logs style="display:flex;flex-direction:column;gap:7px;max-height:210px;overflow:auto">
            ${renderCompetitorAnalyzeLogItems(logs)}
          </div>
        </div>
      </div>
    </div>`;
  }

  if (cp.subStep === 'report') return renderCompetitorReportView(view, helpers);

  if (cp.subStep === 'plan') return renderCompetitorPlanView(view, helpers);

  // subStep === 'input'
  const imgs = cp.uploadedImages || [];
  const savedComp = loadCompAnalysis();
  const hasSaved = !!(savedComp?.analysisResult);
  const marketForSavedComp = ensureCompMarketScrapeState();
  const savedMatchesSelectedImages = hasSaved ? compMarketSavedAnalysisMatchesSelectedImages(savedComp, marketForSavedComp) : true;
  const savedIsStaleForSelection = hasSaved && !savedMatchesSelectedImages;
  const savedAt = hasSaved ? new Date(savedComp.savedAt).toLocaleString('ko-KR', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
  const savedTitle = hasSaved ? (savedComp.analysisResult.page_title || '경쟁사 페이지') : '';
  const hasSavedPlan = !!(savedComp?.sectionPlan);
  const savedTot = hasSaved ? savedComp.analysisResult.page_score?.total : null;
  const savedScoreHtml = savedTot != null
    ? `<span style="font-weight:900;color:${savedTot>=8?'#48bb78':savedTot>=6?'#f6ad55':'#fc8181'};margin-left:6px">${savedTot.toFixed(1)}점</span>`
    : '';

  return `<div class="fade-in">
    <h1 class="page-title">🔍 경쟁사 상세페이지 분석</h1>
    <p class="page-desc">경쟁사 페이지를 분석해 맞춤 섹션 플랜을 제안합니다.</p>
    ${renderCompetitorFlowNav('input')}
    ${renderCompMarketScrapePanel()}

    ${hasSaved ? `<div class="comp-card" style="margin-bottom:20px;border-color:${savedIsStaleForSelection ? 'rgba(245,158,11,.55)' : 'var(--primary)'};background:${savedIsStaleForSelection ? 'rgba(245,158,11,.08)' : 'rgba(99,102,241,.06)'}">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:18px">🕐</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${savedIsStaleForSelection ? '이전 저장 결과: ' : '마지막 저장: '}${escapeHtml(savedTitle)}${savedScoreHtml}</div>
          <div style="font-size:11px;color:${savedIsStaleForSelection ? 'var(--warn)' : 'var(--text-m)'};margin-top:2px">${savedIsStaleForSelection ? '현재 선택 이미지와 맞지 않아 기본 생성 기준에서는 제외합니다. 그래도 이전 결과로 열어볼 수 있습니다.' : `${savedAt} 저장 · 섹션 ${(savedComp.analysisResult.sections_found||[]).length}개 발견${hasSavedPlan?' · 15개 플랜 있음':''}`}</div>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="btn-sm" id="compLoadReport">${savedIsStaleForSelection ? '이전 결과 보기' : '분석 결과 보기'}</button>
          ${hasSavedPlan ? `<button class="btn-sm" id="compLoadPlan" ${disabledAttr(savedIsStaleForSelection, '현재 선택 이미지와 다른 이전 섹션 플랜입니다.')} style="background:var(--primary);color:#fff;border-color:var(--primary)">섹션 플랜 바로가기</button>` : ''}
        </div>
      </div>
    </div>` : ''}

    <div style="display:flex;gap:0;margin-bottom:20px;border:1px solid var(--border);border-radius:8px;overflow:hidden">
      ${[['images','🖼 이미지 스크린샷'],['html','📄 HTML 파일'],['url','🔗 URL']].map(([m,l])=>`
        <button class="comp-mode-tab ${cp.mode===m?'active':''}" data-comp-mode="${m}" style="flex:1">${l}</button>
      `).join('')}
    </div>

    ${cp.mode === 'images' ? `
      <div class="comp-drop-zone" id="compDropZone">
        <span class="material-icons-outlined" style="font-size:40px;color:var(--primary);margin-bottom:8px">add_photo_alternate</span>
        <p style="font-weight:500">클릭 또는 드래그하여 스크린샷 업로드</p>
        <p style="font-size:12px;color:var(--text-m);margin-top:4px">JPG, PNG, WEBP · 최대 10장</p>
        <input type="file" id="compImageInput" accept="image/*" multiple style="display:none">
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card)">
        <button class="btn-sm" id="loadLatestJepumDetail" ${disabledAttr(cp.scraperImportLoading, 'JepumScraper 상세페이지 이미지를 불러오는 중입니다.')} style="gap:6px">
          <span class="material-icons-outlined" style="font-size:16px">history</span>
          ${cp.scraperImportLoading ? '최근 5건 불러오는 중...' : '최근 상세페이지 5건 불러오기'}
        </button>
        <button class="btn-sm" id="openJepumDetailFolder" ${disabledAttr(cp.scraperImportLoading, 'JepumScraper 상세페이지 이미지를 불러오는 중입니다.')} style="gap:6px">
          <span class="material-icons-outlined" style="font-size:16px">folder_open</span>
          이미지 전체 목록 보기
        </button>
        <div style="min-width:220px;flex:1;font-size:12px;line-height:1.5;color:${cp.scraperImportError ? 'var(--err)' : 'var(--text-m)'}">
          ${cp.scraperImportError
            ? escapeHtml(cp.scraperImportError)
            : cp.scraperImportInfo
              ? escapeHtml(cp.scraperImportInfo.message || `${cp.scraperImportInfo.count || 0}장 불러옴`)
              : '최근 5건은 바로 불러오고, 전체 목록은 폴더를 열어 직접 선택할 수 있습니다.'}
        </div>
      </div>
      ${imgs.length>0?`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
        ${imgs.map((img,i)=>`<div style="position:relative">
          <button type="button" data-comp-preview-img="${i}" title="원본 크게 보기" style="padding:0;border:none;background:none;cursor:zoom-in;display:block">
              ${renderFactoryLightImage(`data:${img.mime || 'image/jpeg'};base64,${img.base64 || ''}`, img.name || `상세페이지 이미지 ${i + 1}`, 'style="width:100px;height:70px;object-fit:cover;border-radius:6px;border:1px solid var(--border);display:block"')}
          </button>
          <button data-comp-remove-img="${i}" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#e53e3e;color:#fff;border:none;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center">✕</button>
        </div>`).join('')}
      </div>`:''}
    ` : cp.mode === 'html' ? `
      <div style="margin-bottom:12px">
        <label style="font-size:13px;color:var(--text-m);display:block;margin-bottom:6px">HTML 파일 업로드</label>
        <input type="file" id="compHtmlInput" accept=".html,.htm" class="comp-file-input">
      </div>
      <div>
        <label style="font-size:13px;color:var(--text-m);display:block;margin-bottom:6px">또는 HTML 텍스트 직접 붙여넣기</label>
        <textarea id="compHtmlText" rows="8" style="width:100%;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:12px;font-family:monospace;resize:vertical"
          placeholder="경쟁사 페이지 소스 붙여넣기 (Ctrl+U → 전체 복사)...">${escapeHtml(cp.htmlText || '')}</textarea>
      </div>
    ` : `
      <div>
        <label style="font-size:13px;color:var(--text-m);display:block;margin-bottom:6px">경쟁사 상세페이지 URL</label>
        <input type="url" id="compUrlInput" value="${escAttr(cp.urlInput || '')}"
          style="width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;margin-bottom:10px"
          placeholder="https://smartstore.naver.com/...">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <input type="text" id="compScraperBase" value="${escAttr(cp.scraperBase || 'http://127.0.0.1:5001')}"
            style="flex:1;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:7px;color:var(--text-m);font-size:12px;font-family:monospace"
            placeholder="http://127.0.0.1:5001">
          <button id="compPingBtn" class="btn-sm" style="white-space:nowrap">연결 확인</button>
        </div>
        <div style="padding:8px 10px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text-m)">
          ${cp.backendOk === true
            ? `<span style="color:#48bb78">● 백엔드 연결됨</span> — 더보기/펼쳐보기 버튼 자동 클릭 후 스크린샷 캡처`
            : cp.backendOk === false
              ? `<span style="color:#e53e3e">● 백엔드 미연결</span> — Flask 백엔드를 시작하세요: <code>cd backend && python app.py</code>`
              : `<span style="color:#ccc">● 미확인</span> — 위 "연결 확인" 버튼을 누르거나 분석을 바로 시작하세요`}
        </div>
      </div>
    `}

    <button class="btn" id="compStartAnalyze" style="width:100%;justify-content:center;margin-top:20px;font-size:15px;padding:14px">
      <span class="material-icons-outlined">search</span> 분석 시작
    </button>
  </div>`;
}
