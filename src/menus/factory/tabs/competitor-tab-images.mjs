import { marketSiteLabel, scrapedImageId } from './competitor-tab-model.mjs';

function renderPreviewModal(image, market, helpers) {
  if (!image) return '';
  const { escapeHtml, escAttr, renderFactoryLightImage } = helpers;
  const title = image.title || image.name || '경쟁사 상세페이지 이미지';
  const originalUrl = image.productUrl || image.product_url || image.detailUrl || image.detail_url || image.pageUrl || image.page_url || '';
  const imageSrc = image.src || image.url || '';
  const canOpenImage = imageSrc && !/^data:image\//i.test(String(imageSrc));
  return `<div style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:56px 16px 16px;overflow:auto" role="dialog" aria-modal="true" aria-label="상세페이지 이미지 크게보기">
    <button class="btn-sm" id="compMarketCloseImagePreviewFixed" type="button" aria-label="상세페이지 이미지 크게보기 닫기" style="position:fixed;top:14px;right:14px;z-index:10001;background:rgba(17,24,39,.96);border-color:rgba(255,255,255,.28);color:#fff;padding:9px 12px;font-size:13px;font-weight:950">닫기</button>
    <div style="inline-size:96vw;max-inline-size:1180px;block-size:92vh;max-block-size:860px;background:var(--bg-card);border:1px solid rgba(255,255,255,.18);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;min-width:0">
      <div style="display:flex;align-items:center;gap:10px;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);min-height:48px;flex-wrap:wrap;min-width:0">
        <div style="min-width:0;overflow-wrap:anywhere"><div style="font-size:14px;font-weight:950;color:var(--text);overflow-wrap:anywhere">${escapeHtml(title)}</div><div style="font-size:11px;color:var(--text-m);margin-top:2px">${escapeHtml(marketSiteLabel(image.platform || image.site || ''))}</div></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;min-width:0">
          ${originalUrl ? `<a class="btn-sm" href="${escAttr(originalUrl)}" target="_blank" rel="noopener" style="text-decoration:none;overflow-wrap:anywhere">원본 링크</a>` : ''}
          ${canOpenImage ? `<a class="btn-sm" href="${escAttr(imageSrc)}" target="_blank" rel="noopener" style="text-decoration:none;overflow-wrap:anywhere">이미지 새 창</a>` : ''}
          <button class="btn-sm" id="compMarketCloseImagePreview" type="button">닫기</button>
        </div>
      </div>
      <div style="flex:1;min-height:0;overflow:auto;background:#05060a;display:flex;align-items:flex-start;justify-content:center;padding:16px">
        ${imageSrc ? renderFactoryLightImage(imageSrc, title, 'style="max-width:100%;height:auto;object-fit:contain;border-radius:6px;background:#fff"') : '<div style="color:var(--text-m);padding:40px">표시할 이미지가 없습니다.</div>'}
      </div>
    </div>
  </div>`;
}

function renderImageCard(image, index, context) {
  const { selectable, selected, helpers } = context;
  const { escapeHtml, escAttr, renderFactoryLightImage } = helpers;
  const id = scrapedImageId(image, index);
  const selectedImage = selected.has(id);
  const selectableImage = selectable.has(id);
  const title = image.title || image.name || `상세 이미지 ${index + 1}`;
  const site = image.platform || image.site || '';
  const originalUrl = image.productUrl || image.product_url || image.detailUrl || image.detail_url || image.pageUrl || image.page_url || '';
  return `<div style="border:1px solid ${selectedImage ? 'rgba(16,185,129,.7)' : 'var(--border)'};background:${selectedImage ? 'rgba(16,185,129,.12)' : 'rgba(0,0,0,.16)'};border-radius:10px;padding:7px;min-width:0;max-width:100%;overflow-wrap:anywhere">
    <button type="button" data-comp-market-preview-image="${escAttr(id)}" title="크게보기" style="width:100%;height:82px;border:0;padding:0;border-radius:8px;background:#070910;overflow:hidden;display:flex;align-items:center;justify-content:center;margin-bottom:6px;cursor:zoom-in;min-width:0">
      ${image.src ? renderFactoryLightImage(image.src, title, 'style="width:100%;height:100%;object-fit:cover"') : '<span class="material-icons-outlined" style="font-size:22px;color:var(--text-m)">image_not_supported</span>'}
    </button>
    <div style="font-size:11px;font-weight:900;color:var(--text);overflow:hidden;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(title)}</div>
    <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:5px;min-width:0">
      ${site ? `<span class="comp-tag" style="font-size:10px">${escapeHtml(marketSiteLabel(site))}</span>` : ''}
      <span class="comp-tag" style="font-size:10px;color:${selectableImage ? (selectedImage ? 'var(--ok)' : 'var(--text-m)') : 'var(--warn)'}">${selectableImage ? (selectedImage ? '분석 선택' : '선택 가능') : '이전 수집'}</span>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;min-width:0">
      ${selectableImage ? `<button class="btn-sm" type="button" data-comp-market-toggle-image="${escAttr(id)}" style="font-size:11px;padding:6px 8px;background:${selectedImage ? 'rgba(16,185,129,.18)' : 'rgba(99,102,241,.18)'};border-color:${selectedImage ? 'rgba(16,185,129,.55)' : 'rgba(99,102,241,.45)'};color:${selectedImage ? 'var(--ok)' : 'var(--primary-h)'}">${selectedImage ? '분석 선택 해제' : '분석 선택'}</button>` : ''}
      ${originalUrl ? `<a class="btn-sm" href="${escAttr(originalUrl)}" target="_blank" rel="noopener" style="font-size:11px;padding:6px 8px;text-decoration:none;overflow-wrap:anywhere">원본 링크</a>` : '<span class="comp-tag" style="font-size:10px;color:var(--warn);margin-top:2px">원본 링크 없음</span>'}
    </div>
  </div>`;
}

export function renderScrapedImagePicker(model, helpers, includePreviewModal) {
  const { market, compPage, detailImages } = model;
  const images = Array.isArray(market.scrapedImages) ? market.scrapedImages : [];
  if (!images.length) return '';
  const currentImages = detailImages.currentImages;
  const previousImages = detailImages.previousImages;
  const selectableImages = currentImages.length ? currentImages : previousImages;
  const historicalImages = currentImages.length ? previousImages : [];
  // ★ 이번 선택 후보로 수집한 이미지가 없으면 **이전 수집분**이 그 자리에 앉는다.
  //   주인님 2026-08-31: 11번가 후보를 새로 골랐는데 아래에는 예전 쿠팡 상품 이미지가 떠서
  //   "결과 반영이 잘 안 되는 것 같다" 고 하셨다. 실제로 반영이 안 된 게 아니라,
  //   **이 후보로는 아직 아무것도 수집하지 않았는데** 화면이 그 사실을 말하지 않은 것이다.
  //   이미지는 detailOperationId(상세수집 작업 번호)로 갈린다(competitor-tab-model.mjs).
  //   고를 수 있게 두는 것은 그대로 두되, 어디서 온 것인지는 분명히 말한다.
  const usingPreviousAsFallback = !currentImages.length && previousImages.length > 0;
  const displayedImages = market.showPreviousDetailImages
    ? [...selectableImages, ...historicalImages]
    : selectableImages;
  const previewRows = displayedImages.slice(0, 6);
  const selected = new Set(Array.isArray(market.selectedImageIds) ? market.selectedImageIds.map(String) : []);
  const selectable = new Set(selectableImages.map((image, index) => scrapedImageId(image, index)));
  const selectedCount = selectableImages.filter((image, index) => selected.has(scrapedImageId(image, index))).length;
  const previewId = String(market.previewImageId || '');
  const previewImage = includePreviewModal
    ? images.find((image, index) => scrapedImageId(image, index) === previewId) || null
    : null;
  const analyzing = compPage.subStep === 'analyzing' || Boolean(compPage.pendingAnalysisImageSelection?.key);
  const stale = Boolean(model.analysisResult && !model.analysisMatchesSelection);
  const analysisResult = !analyzing && !stale ? model.analysisResult : null;
  const resultTitle = analysisResult ? analysisResult.page_title || analysisResult.title || '경쟁사 상세페이지' : '';
  const resultScore = analysisResult ? analysisResult.page_score?.total ?? analysisResult.score ?? '' : '';
  const resultGrade = analysisResult ? analysisResult.page_score?.grade || '' : '';
  const resultSections = analysisResult && Array.isArray(analysisResult.sections_found) ? analysisResult.sections_found.length : 0;
  const statusTitle = analyzing ? '현재 선택 이미지 분석 중입니다'
    : stale ? '현재 선택 이미지 기준 분석이 필요합니다'
    : analysisResult ? '분석 결과가 준비됐습니다'
    : usingPreviousAsFallback ? '이 후보로 수집한 이미지가 아직 없습니다'
    : selectedCount ? '분석할 이미지가 선택됐습니다'
    : '분석할 이미지를 선택해주세요';
  const statusBody = analyzing ? (compPage.analyzeMsg || market.status || `선택 이미지 ${selectedCount}장을 분석 중입니다.`) : stale ? `이전 분석 결과는 현재 선택 이미지 ${selectedCount}장과 맞지 않아 기본 후보에서 분리했습니다.` : analysisResult ? `${resultTitle}${resultScore !== '' ? ` · ${resultScore}${resultGrade ? `점 ${resultGrade}` : '점'}` : ''} · 섹션 ${resultSections}개` : usingPreviousAsFallback
      ? `아래 ${previousImages.length}장은 **이전에 고른 후보**로 수집한 이미지입니다. 지금 고른 후보의 이미지가 아닙니다.`
      : (compPage.analyzeMsg || market.status || (selectedCount ? `선택 ${selectedCount}장을 분석할 수 있습니다.` : '아래 이미지에서 분석 선택을 눌러주세요.'));
  const statusDetail = analyzing ? (compPage.analyzeDetail || '이미지를 변환하거나 GPT 분석 결과를 기다리는 중입니다.') : stale ? '선택 이미지 분석을 다시 실행해야 리포트 열기와 섹션 플랜 생성으로 넘어갈 수 있습니다.' : analysisResult ? '아래 버튼으로 바로 리포트를 열 수 있습니다. 필요하면 같은 자리에서 다시 분석할 수도 있습니다.' : usingPreviousAsFallback
      ? '지금 고른 후보의 상세페이지를 쓰려면 아래 후보 카드에서 상세수집을 먼저 실행해주세요. 그대로 분석하면 예전 후보를 분석하게 됩니다.'
      : (compPage.analyzeDetail || '선택 후 버튼을 누르면 이 박스에서 진행상황과 결과가 바로 바뀝니다.');
  const statusBorder = analysisResult ? 'rgba(34,197,94,.55)' : stale || !selectedCount ? 'rgba(245,158,11,.55)' : 'rgba(99,102,241,.5)';
  const statusBg = analysisResult ? 'rgba(16,185,129,.12)' : stale || !selectedCount ? 'rgba(245,158,11,.10)' : 'rgba(99,102,241,.10)';
  const buttonLabel = analyzing ? '분석 진행 중...' : market.loading ? '분석 준비 중...' : analysisResult ? '선택 이미지 다시 분석' : stale ? '현재 선택 이미지 다시 분석' : '선택 이미지 분석';
  const { disabledAttr, escapeHtml, renderCompetitorAnalyzeLogItems } = helpers;
  const currentSummary = detailImages.operation ? `현재 선택 ${detailImages.operation.selectedIds?.length || 0}건 · 이번 수집 ${currentImages.length}장` : '현재 선택 수집 결과 없음';
  const previousSummary = currentImages.length
    ? (previousImages.length ? ` · 이전 수집 ${previousImages.length}장` : '')
    : ` · 복구 이미지 ${previousImages.length}장`;
  return `<div id="factoryCompetitorImagePicker" class="factory-automation-panel" style="margin-top:12px;border-color:rgba(34,197,94,.36);background:rgba(16,185,129,.045);min-width:0;max-width:100%;overflow-wrap:anywhere">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;min-width:0">
      <div style="min-width:0"><h4 style="margin:0">상세페이지 이미지 분석 선택</h4><p style="margin:5px 0 0;overflow-wrap:anywhere">수집 이미지 ${images.length}장 중 분석할 이미지를 고르세요. 후보 목록이 비어 있어도 이 이미지는 바로 선택할 수 있습니다.</p></div>
      <div class="factory-automation-actions" style="margin:0;min-width:0;flex-wrap:wrap">
        <button class="btn-sm" type="button" data-comp-market-quick-action="select-all-images">이미지 전체 선택</button>
        <button class="btn-sm" type="button" data-comp-market-quick-action="clear-images" ${disabledAttr(!selectedCount, '선택된 이미지가 없습니다.')}>선택 해제</button>
        <button class="btn-sm" type="button" id="compMarketAnalyzeSelectedImages" ${disabledAttr(Boolean(market.loading || analyzing || !selectedCount), market.loading || analyzing ? '현재 선택 이미지 분석이 진행 중입니다.' : '분석할 이미지를 먼저 선택하세요.')} style="background:var(--primary);border-color:var(--primary);color:#fff">${buttonLabel}</button>
        <button class="btn-sm" type="button" id="compMarketAnalyzeAllImages">전체 분석</button>
        ${historicalImages.length ? `<button class="btn-sm" type="button" data-comp-market-quick-action="toggle-history-images">${market.showPreviousDetailImages ? '이전 수집 결과 닫기' : `이전 수집 결과 보기 (${historicalImages.length})`}</button>` : ''}
      </div>
    </div>
    <div class="factory-small" style="margin-bottom:8px;overflow-wrap:anywhere">${escapeHtml(currentSummary)}${escapeHtml(previousSummary)} · 분석 선택 ${selectedCount}장${displayedImages.length > previewRows.length ? ` · 아래에는 ${previewRows.length}장만 표시, 전체는 수집판 펼치기에서 확인` : ''}</div>
    <div style="border:1px solid ${statusBorder};background:${statusBg};border-radius:10px;padding:10px 12px;margin-bottom:10px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;min-width:0;overflow-wrap:anywhere">
      <div style="min-width:0;flex:1;overflow-wrap:anywhere"><div data-comp-market-analysis-status-title style="font-size:13px;font-weight:950;color:${analysisResult ? 'var(--ok)' : 'var(--text)'}">${escapeHtml(statusTitle)}</div><div data-comp-market-analysis-status-body style="font-size:12px;color:var(--text);font-weight:800;margin-top:3px;overflow-wrap:anywhere">${escapeHtml(statusBody)}</div><div data-comp-market-analysis-status-detail style="font-size:11px;color:var(--text-m);line-height:1.45;margin-top:3px;overflow-wrap:anywhere">${escapeHtml(statusDetail)}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;min-width:0">${analysisResult ? '<button class="btn-sm" type="button" data-factory-guide-action="open-competitor-report" style="background:var(--primary);border-color:var(--primary);color:#fff">경쟁사 리포트 열기</button><button class="btn-sm" type="button" data-factory-guide-action="go-tab:sections">섹션 생성으로 이동</button>' : ''}${!analysisResult && !analyzing ? '<button class="btn-sm" type="button" data-factory-guide-action="refresh-competitor-analysis">완료 결과 다시 가져오기</button>' : ''}</div>
    </div>
    ${analyzing ? `<div style="border:1px solid rgba(99,102,241,.30);background:rgba(0,0,0,.16);border-radius:10px;padding:9px 10px;margin:-2px 0 10px"><div data-comp-market-analysis-logs style="display:flex;flex-direction:column;gap:6px;max-height:156px;overflow:auto">${renderCompetitorAnalyzeLogItems(Array.isArray(compPage.analyzeLogs) ? compPage.analyzeLogs : [])}</div></div>` : ''}
    ${renderPreviewModal(previewImage, market, helpers)}
    ${!displayedImages.length ? '<div class="factory-guide-note warn" style="margin-bottom:10px;overflow-wrap:anywhere">현재 선택 후보의 상세이미지가 아직 없습니다. 최근 VM 상세이미지 불러오기를 실행해주세요.</div>' : ''}
    ${usingPreviousAsFallback ? `<div class="factory-guide-note warn" data-comp-market-previous-fallback="1" style="margin-bottom:10px;overflow-wrap:anywhere">지금 고른 후보로 수집한 상세이미지가 <b>0장</b>입니다. 아래 ${previousImages.length}장은 <b>이전 후보</b>의 수집분이라 상품과 사이트가 다를 수 있습니다. 이 후보의 이미지를 쓰려면 후보 카드에서 상세수집을 실행해주세요.</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(132px,100%),1fr));gap:8px;min-width:0;max-width:100%">${previewRows.map((image, index) => renderImageCard(image, index, { selectable, selected, helpers })).join('')}</div>
  </div>`;
}
