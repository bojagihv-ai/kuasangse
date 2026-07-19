import fs from 'node:fs';

const APP_URL = process.env.FACTORY_APP_URL || 'http://127.0.0.1:8081/app.html';
const CDP_URL = process.env.FACTORY_CDP_URL || 'http://127.0.0.1:9333';
const MODE = process.env.FACTORY_PROBE_MODE || process.argv[2] || 'state';
const EXTRA_ARGS = process.argv.slice(3);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SUMMARYLESS_MODES = new Set([
  'final-ui-compact',
  'detail-audit-compact',
  'state-size-audit',
  'cafe24-detail-readback',
  'cuts-prompt-audit',
  'post-create-plan',
]);

async function connectCdp(wsUrl) {
  if (typeof WebSocket !== 'function') {
    throw new Error('Node WebSocket이 꺼져 있습니다. node --experimental-websocket 옵션으로 실행하세요.');
  }
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP WebSocket 연결 시간 초과')), 10000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener('error', event => {
      clearTimeout(timeout);
      reject(new Error(`CDP WebSocket 연결 실패: ${event?.message || 'unknown'}`));
    }, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const parsed = JSON.parse(String(event.data || '{}'));
    if (parsed.id && pending.has(parsed.id)) {
      const { resolve, reject, timeout } = pending.get(parsed.id);
      clearTimeout(timeout);
      pending.delete(parsed.id);
      if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
      else resolve(parsed.result);
    }
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP 응답 시간 초과: ${method}`));
    }, 30000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return {
    send,
    close: () => socket.close(),
  };
}

async function getPageWebSocketUrl() {
  const list = await fetch(`${CDP_URL}/json/list`).then(res => res.json());
  let target = list.find(item => String(item.url || '').includes('/app.html'));
  if (!target) target = list.find(item => item.type === 'page');
  if (!target?.webSocketDebuggerUrl) throw new Error('Chrome page target을 찾지 못했습니다.');
  return target.webSocketDebuggerUrl;
}

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: options.awaitPromise !== false,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'Runtime.evaluate failed';
    throw new Error(text);
  }
  return result.result?.value;
}

async function ensureApp(cdp) {
  await cdp.send('Page.enable').catch(() => {});
  const location = await evaluate(cdp, 'location.href', { awaitPromise: false }).catch(() => '');
  if (!String(location || '').includes('/app.html')) {
    await cdp.send('Page.navigate', { url: APP_URL });
    await sleep(1000);
  }
  for (let i = 0; i < 30; i += 1) {
    const ready = await evaluate(cdp, 'typeof window.factoryState === "function"', { awaitPromise: false }).catch(() => false);
    if (ready) return;
    await sleep(1000);
  }
  throw new Error('앱 스크립트가 준비되지 않았습니다.');
}

async function reloadApp(cdp) {
  await cdp.send('Page.reload', { ignoreCache: true });
  await sleep(1500);
  await ensureApp(cdp);
}

async function summarize(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    const product = factory.product || {};
    const goalRun = factory.goalRun || {};
    const assets = Array.isArray(factory.assets) ? factory.assets : [];
    return {
      href: location.href,
      productName: product.productName || '',
      userProductName: product.userProductName || '',
      selectedDbCandidateKey: product.selectedDbCandidateKey || '',
      selectedCafe24CandidateKey: product.selectedCafe24CandidateKey || '',
      pendingDbCandidates: product.pendingDbCandidates?.length || 0,
      pendingCafe24Candidates: product.pendingCafe24Candidates?.length || 0,
      finalDbSize: product.finalDb?.size || product.finalDb?.dimensions || '',
      goalRun: {
        running: !!goalRun.running,
        progress: goalRun.progress || 0,
        currentStage: goalRun.currentStage || '',
        failureReason: goalRun.failureReason || '',
      },
      stages: Object.fromEntries(Object.entries(factory.stages || {}).map(([key, stage]) => [
        key,
        {
          status: stage?.status || '',
          selectedAssetId: stage?.selectedAssetId || '',
          usedAssetIds: Array.isArray(stage?.usedAssetIds) ? stage.usedAssetIds.length : 0,
          generatedSections: Array.isArray(stage?.sections) ? stage.sections.length : undefined,
        },
      ])),
      assets: assets.map(asset => ({
        id: asset.id,
        stageId: asset.stageId,
        title: asset.title || '',
        used: !!asset.used,
        saved: !!asset.localArchive?.saved || !!asset.archiveId,
        archiveId: asset.archiveId || '',
        hasImageUrl: !!asset.imageUrl,
        hasInlineImage: !!asset.imageBase64 || !!asset.dataUrl,
      })).slice(-40),
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runDbVmTimeoutProbe(cdp) {
  await evaluate(cdp, `(() => {
    window.__factoryVmCandidateTimeoutMs = 15000;
    const factory = window.factoryState();
    factory.goalRun = factory.goalRun || {};
    factory.goalRun.running = false;
    factory.product = factory.product || {};
    factory.product.productName = factory.product.productName || factory.product.userProductName || 'Codex검증 크리스탈보자기 숨김';
    factory.product.userProductName = factory.product.userProductName || factory.product.productName;
    window.render?.();
  })()`);
  await evaluate(cdp, `(() => {
    window.__codexDbVmRunDone = false;
    window.__codexDbVmRunResult = null;
    Promise.resolve(window.factoryRunDbVmCandidatesOnlyFlow?.())
      .then(result => {
        window.__codexDbVmRunDone = true;
        window.__codexDbVmRunResult = result;
      })
      .catch(error => {
        window.__codexDbVmRunDone = true;
        window.__codexDbVmRunResult = { error: String(error?.message || error) };
      });
  })()`);
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < 45000) {
    await sleep(2500);
    last = await evaluate(cdp, `(() => {
      const factory = window.factoryState();
      return {
        done: !!window.__codexDbVmRunDone,
        result: window.__codexDbVmRunResult,
        running: !!factory.goalRun?.running,
        progress: factory.goalRun?.progress || 0,
        currentStage: factory.goalRun?.currentStage || '',
        failureReason: factory.goalRun?.failureReason || '',
        logs: (factory.logs || []).slice(0, 8).map(item => item.message || item.text || ''),
      };
    })()`);
    if (last.done && !last.running) break;
  }
  return last;
}

async function runFinalUiProbe(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    factory.product = factory.product || {};
    const product = factory.product;
    const before = {
      userProductName: product.userProductName || '',
      productName: product.productName || '',
      stateProductName: window.state?.productName || '',
      finalRegistrationName: product.cafe24FinalRegistration?.productName || '',
      finalDbName: product.finalDb?.product_name || '',
    };
    const model = typeof window.factoryFinalRegistrationCafe24Model === 'function'
      ? window.factoryFinalRegistrationCafe24Model(factory)
      : null;
    const basicInfo = typeof window.factoryFinalRegistrationBasicInfoModel === 'function'
      ? window.factoryFinalRegistrationBasicInfoModel(factory)
      : null;
    const settings = typeof window.factoryFinalRegistrationSettings === 'function'
      ? window.factoryFinalRegistrationSettings(factory)
      : null;
    const detailModel = typeof window.factoryFinalRegistrationDetailModel === 'function'
      ? window.factoryFinalRegistrationDetailModel(factory)
      : null;
    const imagePayload = typeof window.factoryCafe24ImagePayload === 'function'
      ? window.factoryCafe24ImagePayload(factory)
      : {};
    const imageSlotKeys = Array.isArray(window.FACTORY_CAFE24_IMAGE_SLOTS)
      ? window.FACTORY_CAFE24_IMAGE_SLOTS.map(slot => slot.key)
      : [];
    const scopedDetail = typeof window.factoryCafe24CurrentScopedDetailHtml === 'function'
      ? window.factoryCafe24CurrentScopedDetailHtml(factory)
      : null;
    const detailSafety = typeof window.factoryCafe24DetailHtmlPreflight === 'function'
      ? window.factoryCafe24DetailHtmlPreflight(String(scopedDetail?.html || ''))
      : null;
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;';
    holder.innerHTML = typeof window.renderFactoryFinalRegistrationBasicInfoPanel === 'function'
      ? window.renderFactoryFinalRegistrationBasicInfoPanel(factory)
      : '';
    document.body.appendChild(holder);
    if (typeof window.bindEvents === 'function') window.bindEvents();
    const input = holder.querySelector('[data-factory-final-basic-field="product_name"]');
    const testValue = '__codex_blur_test__' + Date.now();
    if (input) {
      input.value = testValue;
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    }
    const afterBlur = {
      inputValue: input?.value || '',
      userProductName: product.userProductName || '',
      productName: product.productName || '',
      stateProductName: window.state?.productName || '',
      finalRegistrationName: product.cafe24FinalRegistration?.productName || '',
      finalDbName: product.finalDb?.product_name || '',
    };
    const blurApplied = [
      afterBlur.userProductName,
      afterBlur.productName,
      afterBlur.stateProductName,
      afterBlur.finalRegistrationName,
      afterBlur.finalDbName,
    ].some(value => value === testValue);
    holder.remove();
    if (blurApplied) {
      product.userProductName = before.userProductName;
      product.productName = before.productName;
      if (window.state) window.state.productName = before.stateProductName;
      product.cafe24FinalRegistration = product.cafe24FinalRegistration || {};
      product.cafe24FinalRegistration.productName = before.finalRegistrationName;
      product.finalDb = product.finalDb || {};
      product.finalDb.product_name = before.finalDbName;
      if (typeof window.saveLastWorkNow === 'function') window.saveLastWorkNow({ sync: false });
    }
    return {
      model,
      settings,
      detailModel: detailModel ? {
        canProceed: !!detailModel.canProceed,
        ok: !!detailModel.ok,
        label: detailModel.label || '',
        reason: detailModel.reason || '',
        generated: detailModel.generated || 0,
        total: detailModel.total || 0,
      } : null,
      basicInfo: basicInfo ? {
        productName: basicInfo.productName || '',
        salePrice: basicInfo.salePrice || '',
        requiredMissing: basicInfo.requiredMissing || [],
      } : null,
      imagePreflight: {
        slots: imageSlotKeys,
        readySlots: imageSlotKeys.length
          ? imageSlotKeys.filter(key => imagePayload?.[key])
          : Object.keys(imagePayload || {}).filter(key => key !== 'image_upload_type' && imagePayload?.[key]),
        readyCount: imageSlotKeys.length
          ? imageSlotKeys.filter(key => imagePayload?.[key]).length
          : Object.keys(imagePayload || {}).filter(key => key !== 'image_upload_type' && imagePayload?.[key]).length,
        payloadKeys: Object.keys(imagePayload || {}),
      },
      detailPreflight: {
        hasHtml: !!String(scopedDetail?.html || '').trim(),
        htmlLength: String(scopedDetail?.html || '').length,
        source: scopedDetail?.source || '',
        blocked: !!scopedDetail?.blocked,
        message: scopedDetail?.message || '',
        safety: detailSafety,
      },
      before,
      afterBlur,
      blurApplied,
      noteMentionsApply: /기본정보 적용/.test(holder.textContent || ''),
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runFinalUiCompactProbe(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    factory.product = factory.product || {};
    const product = factory.product;
    const model = typeof window.factoryFinalRegistrationCafe24Model === 'function'
      ? window.factoryFinalRegistrationCafe24Model(factory)
      : null;
    const basicInfo = typeof window.factoryFinalRegistrationBasicInfoModel === 'function'
      ? window.factoryFinalRegistrationBasicInfoModel(factory)
      : null;
    const settings = typeof window.factoryFinalRegistrationSettings === 'function'
      ? window.factoryFinalRegistrationSettings(factory)
      : null;
    const detailModel = typeof window.factoryFinalRegistrationDetailModel === 'function'
      ? window.factoryFinalRegistrationDetailModel(factory)
      : null;
    const imagePayload = typeof window.factoryCafe24ImagePayload === 'function'
      ? window.factoryCafe24ImagePayload(factory)
      : {};
    const imageSlotKeys = Array.isArray(window.FACTORY_CAFE24_IMAGE_SLOTS)
      ? window.FACTORY_CAFE24_IMAGE_SLOTS.map(slot => slot.key)
      : [];
    const scopedDetail = typeof window.factoryCafe24CurrentScopedDetailHtml === 'function'
      ? window.factoryCafe24CurrentScopedDetailHtml(factory)
      : null;
    const html = String(scopedDetail?.html || '');
    const detailSafety = typeof window.factoryCafe24DetailHtmlPreflight === 'function'
      ? window.factoryCafe24DetailHtmlPreflight(html)
      : null;
    const foreign = typeof window.factoryCafe24DetailForeignProductCheck === 'function'
      ? window.factoryCafe24DetailForeignProductCheck(html, factory, window.state || {})
      : null;
    const sections = typeof window.orderedSections === 'function' ? window.orderedSections() : [];
    const appState = typeof state !== 'undefined' ? state : (window.state || {});
    const currentScope = typeof window.sectionWorkScopeMeta === 'function' ? window.sectionWorkScopeMeta() : {};
    const currentSections = sections.filter(section => {
      const content = appState.sectionContents?.[section.id];
      if (!content) return false;
      return typeof window.sectionContentBelongsToCurrentWork === 'function'
        ? window.sectionContentBelongsToCurrentWork(section.id, content, currentScope)
        : true;
    });
    const readySlots = imageSlotKeys.length
      ? imageSlotKeys.filter(key => imagePayload?.[key])
      : Object.keys(imagePayload || {}).filter(key => key !== 'image_upload_type' && imagePayload?.[key]);
    const sync = factory.openMarketSync || {};
    return {
      names: {
        userProductName: product.userProductName || '',
        productName: product.productName || '',
        stateProductName: window.state?.productName || '',
        finalRegistrationName: product.cafe24FinalRegistration?.productName || product.cafe24FinalRegistration?.product_name || '',
        finalDbName: product.finalDb?.product_name || '',
      },
      settings: settings ? {
        finalTarget: settings.target || sync.finalTarget || '',
        cafe24RegistrationMode: settings.cafe24RegistrationMode || sync.cafe24RegistrationMode || '',
        cafe24Display: settings.display || sync.cafe24Display || '',
        cafe24Selling: settings.selling || sync.cafe24Selling || '',
      } : {
        finalTarget: sync.finalTarget || '',
        cafe24RegistrationMode: sync.cafe24RegistrationMode || '',
        cafe24Display: sync.cafe24Display || '',
        cafe24Selling: sync.cafe24Selling || '',
      },
      cafe24Model: model ? {
        canProceed: !!(model.canRun ?? model.canProceed),
        productNo: model.productNo || model.product_no || product.finalDb?.product_no || '',
        registrationMode: model.registrationMode || model.mode || '',
        display: model.display || model.displayStatus || model.display_status || settings?.display || sync.cafe24Display || '',
        selling: model.selling || model.sellingStatus || model.selling_status || settings?.selling || sync.cafe24Selling || '',
        message: String(model.message || model.reason || '').slice(0, 240),
      } : null,
      basicInfo: basicInfo ? {
        productName: basicInfo.productName || '',
        salePrice: basicInfo.salePrice || '',
        consumerPrice: basicInfo.consumerPrice || '',
        purchasePrice: basicInfo.purchasePrice || '',
        requiredMissing: basicInfo.requiredMissing || [],
      } : null,
      detailModel: detailModel ? {
        canProceed: !!detailModel.canProceed,
        ok: !!detailModel.ok,
        label: detailModel.label || '',
        reason: String(detailModel.reason || '').slice(0, 240),
        generated: detailModel.generated || 0,
        total: detailModel.total || 0,
      } : null,
      detailPreflight: {
        hasHtml: !!html.trim(),
        htmlLength: html.length,
        source: scopedDetail?.source || '',
        blocked: !!scopedDetail?.blocked,
        message: String(scopedDetail?.message || '').slice(0, 260),
        safety: detailSafety ? {
          ok: !!detailSafety.ok,
          hasLightPlaceholder: !!detailSafety.hasLightPlaceholder,
          imgCount: detailSafety.imgCount || 0,
          badCount: detailSafety.badCount || 0,
        } : null,
        foreign: foreign ? {
          ok: !!foreign.ok,
          conflicts: (foreign.conflicts || []).slice(0, 6),
          expectedTerms: (foreign.expectedTerms || []).slice(0, 8),
        } : null,
      },
      imagePreflight: {
        expectedSlots: imageSlotKeys.length,
        readyCount: readySlots.length,
        readySlots: readySlots.slice(0, 8),
      },
      sectionScope: {
        currentGenerated: currentSections.length,
        total: sections.length,
        missing: sections
          .filter(section => !currentSections.some(item => item.id === section.id))
          .map(section => section.id)
          .slice(0, 12),
      },
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runPostCreatePlanProbe(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    factory.product = factory.product || {};
    factory.product.productName = 'Codex후속계획검증';
    factory.product.userProductName = 'Codex후속계획검증';
    factory.product.finalDb = {
      ...(factory.product.finalDb || {}),
      product_name: 'Codex후속계획검증',
      price: '850.00',
      retail_price: '2150.00',
      supply_price: '0.00',
    };
    factory.product.cafe24SeoDraft = {
      original: {},
      touched: false,
      metaTitle: '',
      metaAuthor: '',
      metaDescription: '',
      metaKeywords: '',
      metaAlt: '',
      searchEngineExposure: 'T',
    };
    factory.product.cafe24OptionGroupsDraft = [];
    factory.product.cafe24OptionExtrasDraft = { touched: false };
    factory.product.cafe24VariantEdits = {};
    factory.product.dbFieldSettings = {
      ...(factory.product.dbFieldSettings || {}),
      option_name: { manualTouched: false, manualValue: '' },
      option_values: { manualTouched: false, manualValue: '' },
    };
    const onePixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/azK5ZkAAAAASUVORK5CYII=';
    factory.product.cafe24ImageDraft = {
      image_upload_type: 'A',
      detail_image: { base64: onePixel },
      list_image: { base64: onePixel },
      tiny_image: { base64: onePixel },
      small_image: { base64: onePixel },
      additional_images: [],
    };
    const plan = typeof window.factoryCafe24CreatePostSyncPlan === 'function'
      ? window.factoryCafe24CreatePostSyncPlan(factory)
      : null;
    const optionPlan = plan?.optionPlan || {};
    return {
      buildId: window.__KUASANGSE_APP_BUILD_ID__ || '',
      readyActions: (plan?.readyActions || []).map(action => ({
        key: action.key,
        label: action.label,
        summary: action.summary,
      })),
      imageSlotCount: plan?.imageSlotCount || 0,
      seoReady: (plan?.readyActions || []).some(action => action.key === 'seo'),
      optionsReady: (plan?.readyActions || []).some(action => action.key === 'options'),
      optionPlan: {
        hasChanges: !!optionPlan.hasChanges,
        hasExplicitChanges: !!optionPlan.hasExplicitChanges,
        optionValueTotal: optionPlan.optionValueTotal || 0,
        variantUpdates: Array.isArray(optionPlan.variantUpdates) ? optionPlan.variantUpdates.length : 0,
        inventoryUpdates: Array.isArray(optionPlan.inventoryUpdates) ? optionPlan.inventoryUpdates.length : 0,
        autoInventorySeedCount: optionPlan.autoInventorySeedCount || 0,
      },
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runDetailAuditProbe(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    const scoped = typeof window.factoryCafe24CurrentScopedDetailHtml === 'function'
      ? window.factoryCafe24CurrentScopedDetailHtml(factory)
      : { html: '' };
    const html = String(scoped?.html || '');
    const text = html
      .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
      .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const headings = Array.from(html.matchAll(/<h[1-6][^>]*>([\\s\\S]*?)<\\/h[1-6]>/gi))
      .map(match => String(match[1] || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20);
    const imgSrcCount = (html.match(/<img\\b/gi) || []).length;
    const dataUrlCount = (html.match(/data:image\\//gi) || []).length;
    const lightKeyCount = (html.match(/data-factory-light-image-key/gi) || []).length;
    const badVisibleTokens = ['[헤더', '[훅', '[상세', 'Header)]', 'Hook)]', '원본은 메모리 저장소', '크리스탈보자기', '방울수저집', '색동복주머니'];
    const tokenHits = badVisibleTokens.filter(token => text.includes(token) || html.includes(token));
    const foreign = typeof window.factoryCafe24DetailForeignProductCheck === 'function'
      ? window.factoryCafe24DetailForeignProductCheck(html, factory, window.state || {})
      : null;
    return {
      source: scoped?.source || '',
      blocked: !!scoped?.blocked,
      message: scoped?.message || '',
      htmlLength: html.length,
      textLength: text.length,
      imgSrcCount,
      dataUrlCount,
      lightKeyCount,
      tokenHits,
      foreign,
      headings,
      textPreview: text.slice(0, 700),
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runDetailAuditCompactProbe(cdp) {
  return evaluate(cdp, `(() => {
    const factory = window.factoryState?.() || {};
    const scoped = typeof window.factoryCafe24CurrentScopedDetailHtml === 'function'
      ? window.factoryCafe24CurrentScopedDetailHtml(factory)
      : { html: '' };
    const html = String(scoped?.html || '');
    const text = html
      .replace(/<script[\\s\\S]*?<\\/script>/gi, ' ')
      .replace(/<style[\\s\\S]*?<\\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const headings = Array.from(html.matchAll(/<h[1-6][^>]*>([\\s\\S]*?)<\\/h[1-6]>/gi))
      .map(match => String(match[1] || '').replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 10);
    const foreign = typeof window.factoryCafe24DetailForeignProductCheck === 'function'
      ? window.factoryCafe24DetailForeignProductCheck(html, factory, window.state || {})
      : null;
    const tokenHits = ['[헤더', '[훅', '[상세', 'Header)]', 'Hook)]', '원본은 메모리 저장소', '크리스탈보자기', '방울수저집', '색동복주머니']
      .filter(token => text.includes(token) || html.includes(token));
    return {
      source: scoped?.source || '',
      blocked: !!scoped?.blocked,
      message: String(scoped?.message || '').slice(0, 260),
      htmlLength: html.length,
      textLength: text.length,
      imgSrcCount: (html.match(/<img\\b/gi) || []).length,
      dataUrlCount: (html.match(/data:image\\//gi) || []).length,
      lightKeyCount: (html.match(/data-factory-light-image-key/gi) || []).length,
      tokenHits,
      foreign: foreign ? {
        ok: !!foreign.ok,
        conflicts: (foreign.conflicts || []).slice(0, 6),
        expectedTerms: (foreign.expectedTerms || []).slice(0, 8),
      } : null,
      headings,
      textPreview: text.slice(0, 260),
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runSectionScopeAuditProbe(cdp) {
  return evaluate(cdp, `(() => {
    const appState = typeof state !== 'undefined' ? state : (window.state || {});
    const sections = typeof window.orderedSections === 'function' ? window.orderedSections() : [];
    const current = typeof window.sectionWorkScopeMeta === 'function' ? window.sectionWorkScopeMeta() : {};
    const rows = sections.map(section => {
      const content = appState.sectionContents?.[section.id] || null;
      const meta = appState.sectionGenerationMeta?.[section.id] || {};
      const record = typeof window.sectionWorkScopeFromContent === 'function'
        ? window.sectionWorkScopeFromContent(content || {}, meta)
        : {};
      const belongs = content && typeof window.sectionContentBelongsToCurrentWork === 'function'
        ? window.sectionContentBelongsToCurrentWork(section.id, content, current)
        : !!content;
      return {
        id: section.id,
        name: section.name,
        hasContent: !!content,
        hasImage: !!appState.sectionImages?.[section.id],
        locked: !!appState.sectionLocks?.[section.id],
        belongs: !!belongs,
        basis: content?.generation_basis || meta?.basis || '',
        mode: content?.generation_mode || meta?.mode || '',
        record,
      };
    });
    return {
      current,
      total: rows.length,
      generated: rows.filter(row => row.hasContent || row.hasImage).length,
      currentGenerated: rows.filter(row => row.belongs && (row.hasContent || row.hasImage)).length,
      stale: rows.filter(row => (row.hasContent || row.hasImage) && !row.belongs),
      batchRun: appState.sectionBatchRun ? {
        status: appState.sectionBatchRun.status || '',
        progress: appState.sectionBatchRun.progress || 0,
        message: appState.sectionBatchRun.message || '',
        detail: appState.sectionBatchRun.detail || '',
        completed: appState.sectionBatchRun.completed || 0,
        failed: appState.sectionBatchRun.failed || 0,
        total: appState.sectionBatchRun.total || 0,
        logs: Array.isArray(appState.sectionBatchRun.logs)
          ? appState.sectionBatchRun.logs.slice(0, 8).map(item => ({
              type: item.type || '',
              message: item.message || '',
              detail: item.detail || '',
              progress: item.progress || 0,
            }))
          : [],
      } : null,
      rows,
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runGenerateDetailStageProbe(cdp) {
  return evaluate(cdp, `(async () => {
    if (typeof window.factoryGenerateDetailStage !== 'function') {
      return { ok: false, reason: 'factoryGenerateDetailStage-missing' };
    }
    if (window.__codexDetailStageProbe?.running) {
      return { ok: true, started: false, reason: 'already-running', probe: window.__codexDetailStageProbe };
    }
    window.__codexDetailStageProbe = {
      running: true,
      startedAt: Date.now(),
      done: false,
      result: null,
      error: '',
    };
    Promise.resolve()
      .then(() => window.factoryGenerateDetailStage())
      .then(value => {
        window.__codexDetailStageProbe.running = false;
        window.__codexDetailStageProbe.done = true;
        window.__codexDetailStageProbe.result = value;
        window.__codexDetailStageProbe.finishedAt = Date.now();
      })
      .catch(e => {
        window.__codexDetailStageProbe.running = false;
        window.__codexDetailStageProbe.done = true;
        window.__codexDetailStageProbe.error = e?.message || String(e);
        window.__codexDetailStageProbe.finishedAt = Date.now();
      });
    return { ok: true, started: true, probe: window.__codexDetailStageProbe };
  })()`);
}

async function runDetailStageStatusProbe(cdp) {
  return evaluate(cdp, `(() => {
    const appState = typeof state !== 'undefined' ? state : (window.state || {});
    const factory = window.factoryState?.() || {};
    const run = appState.sectionBatchRun || {};
    const sections = typeof window.orderedSections === 'function' ? window.orderedSections() : [];
    const current = typeof window.sectionWorkScopeMeta === 'function' ? window.sectionWorkScopeMeta() : {};
    const currentGenerated = sections.filter(section => {
      const content = appState.sectionContents?.[section.id];
      if (!content) return false;
      return typeof window.sectionContentBelongsToCurrentWork === 'function'
        ? window.sectionContentBelongsToCurrentWork(section.id, content, current)
        : true;
    }).length;
    return {
      probe: window.__codexDetailStageProbe || null,
      generateAllHasPrepLog: typeof window.generateAllSections === 'function'
        ? String(window.generateAllSections).includes('전체 섹션 생성 준비 중')
        : false,
      stageStatus: factory.stages?.detail?.status || '',
      stageMessage: factory.stages?.detail?.message || '',
      detailStageDebug: factory.product?.detailStageDebug || null,
      goalProgress: factory.goalRun?.progress || 0,
      goalStage: factory.goalRun?.currentStage || '',
      batchStatus: run.status || '',
      batchProgress: run.progress || 0,
      batchMessage: run.message || '',
      batchDetail: run.detail || '',
      batchCompleted: run.completed || 0,
      batchFailed: run.failed || 0,
      batchTotal: run.total || 0,
      currentGenerated,
      total: sections.length,
      lastLogs: Array.isArray(run.logs) ? run.logs.slice(0, 8).map(item => ({
        type: item.type || '',
        message: item.message || '',
        detail: item.detail || '',
        progress: item.progress || 0,
      })) : [],
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runGenerateAllSectionsDirectProbe(cdp) {
  return evaluate(cdp, `(() => {
    const appState = typeof state !== 'undefined' ? state : (window.state || {});
    if (typeof window.generateAllSections !== 'function') {
      return { ok: false, reason: 'generateAllSections-missing' };
    }
    if (window.__codexGenerateAllProbe?.running) {
      return { ok: true, started: false, reason: 'already-running', probe: window.__codexGenerateAllProbe };
    }
    const source = String(window.generateAllSections);
    window.__codexGenerateAllProbe = {
      running: true,
      startedAt: Date.now(),
      done: false,
      result: null,
      error: '',
      sourceStart: source.slice(0, 1800),
      constructorName: window.generateAllSections.constructor?.name || '',
      hasPrepLog: source.includes('전체 섹션 생성 준비 중'),
      preCallBatchStatus: appState.sectionBatchRun?.status || '',
      preCallBatchMessage: appState.sectionBatchRun?.message || '',
      preCallHasAnalysis: !!appState.analysis,
      preCallError: appState.error || '',
    };
    try {
      const promise = window.generateAllSections();
      window.__codexGenerateAllProbe.afterCallAt = Date.now();
      window.__codexGenerateAllProbe.afterCallBatchStatus = appState.sectionBatchRun?.status || '';
      window.__codexGenerateAllProbe.afterCallBatchMessage = appState.sectionBatchRun?.message || '';
      window.__codexGenerateAllProbe.afterCallHasAnalysis = !!appState.analysis;
      window.__codexGenerateAllProbe.afterCallError = appState.error || '';
      Promise.resolve(promise)
        .then(value => {
          window.__codexGenerateAllProbe.running = false;
          window.__codexGenerateAllProbe.done = true;
          window.__codexGenerateAllProbe.result = value;
          window.__codexGenerateAllProbe.finishBatchStatus = appState.sectionBatchRun?.status || '';
          window.__codexGenerateAllProbe.finishBatchMessage = appState.sectionBatchRun?.message || '';
          window.__codexGenerateAllProbe.finishHasAnalysis = !!appState.analysis;
          window.__codexGenerateAllProbe.finishError = appState.error || '';
          window.__codexGenerateAllProbe.finishedAt = Date.now();
        })
        .catch(e => {
          window.__codexGenerateAllProbe.running = false;
          window.__codexGenerateAllProbe.done = true;
          window.__codexGenerateAllProbe.error = e?.message || String(e);
          window.__codexGenerateAllProbe.finishBatchStatus = appState.sectionBatchRun?.status || '';
          window.__codexGenerateAllProbe.finishBatchMessage = appState.sectionBatchRun?.message || '';
          window.__codexGenerateAllProbe.finishHasAnalysis = !!appState.analysis;
          window.__codexGenerateAllProbe.finishError = appState.error || '';
          window.__codexGenerateAllProbe.finishedAt = Date.now();
        });
      return { ok: true, started: true, probe: window.__codexGenerateAllProbe };
    } catch (e) {
      window.__codexGenerateAllProbe.running = false;
      window.__codexGenerateAllProbe.done = true;
      window.__codexGenerateAllProbe.error = e?.message || String(e);
      window.__codexGenerateAllProbe.finishedAt = Date.now();
      return { ok: false, reason: 'sync-throw', probe: window.__codexGenerateAllProbe };
    }
  })()`);
}

async function runGenerateAllSectionsStatusProbe(cdp) {
  return evaluate(cdp, `(() => {
    const appState = typeof state !== 'undefined' ? state : (window.state || {});
    const run = appState.sectionBatchRun || {};
    return {
      probe: window.__codexGenerateAllProbe || null,
      batchStatus: run.status || '',
      batchProgress: run.progress || 0,
      batchMessage: run.message || '',
      batchDetail: run.detail || '',
      batchCompleted: run.completed || 0,
      batchFailed: run.failed || 0,
      batchTotal: run.total || 0,
      lastLogs: Array.isArray(run.logs) ? run.logs.slice(0, 8).map(item => ({
        type: item.type || '',
        message: item.message || '',
        detail: item.detail || '',
        progress: item.progress || 0,
      })) : [],
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runStateSizeAuditProbe(cdp) {
  return evaluate(cdp, `(() => {
    const jsonLength = value => {
      try { return JSON.stringify(value || null).length; } catch(e) { return -1; }
    };
    const topState = Object.keys(window.state || {}).map(key => ({
      key,
      bytes: jsonLength(window.state?.[key]),
    })).sort((a, b) => b.bytes - a.bytes).slice(0, 30);
    const factory = window.factoryState?.() || {};
    const topFactory = Object.keys(factory || {}).map(key => ({
      key,
      bytes: jsonLength(factory?.[key]),
    })).sort((a, b) => b.bytes - a.bytes).slice(0, 30);
    const topProduct = Object.keys(factory.product || {}).map(key => ({
      key,
      bytes: jsonLength(factory.product?.[key]),
    })).sort((a, b) => b.bytes - a.bytes).slice(0, 30);
    const topCuts = Object.keys(window.state?.cuts || {}).map(key => ({
      key,
      bytes: jsonLength(window.state.cuts?.[key]),
    })).sort((a, b) => b.bytes - a.bytes).slice(0, 30);
    const storage = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      storage.push({ key, bytes: String(localStorage.getItem(key) || '').length });
    }
    storage.sort((a, b) => b.bytes - a.bytes);
    const factoryAssets = Array.isArray(factory.assets) ? factory.assets.map(asset => ({
      id: asset.id || '',
      stageId: asset.stageId || '',
      title: asset.title || '',
      imageBytes: String(asset.image || asset.imageUrl || '').length,
      htmlBytes: String(asset.html || asset.content || '').length,
      hasInlineImage: /^data:image\\//i.test(String(asset.image || '')),
      saved: !!asset.saved,
    })).sort((a, b) => (b.imageBytes + b.htmlBytes) - (a.imageBytes + a.htmlBytes)).slice(0, 20) : [];
    return {
      topState,
      topFactory,
      topProduct,
      topCuts,
      storage: storage.slice(0, 20),
      factoryAssetCount: Array.isArray(factory.assets) ? factory.assets.length : 0,
      factoryAssets,
      sectionContentCount: Object.keys(window.state?.sectionContents || {}).length,
      sectionImageCount: Object.keys(window.state?.sectionImages || {}).length,
      heap: performance?.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      } : null,
    };
  })()`);
}

async function runAnalysisSettingsProbe(cdp) {
  return evaluate(cdp, `(() => {
    const appState = typeof state !== 'undefined' ? state : (window.state || {});
    const settings = typeof window.getAnalysisMatchSettings === 'function'
      ? window.getAnalysisMatchSettings()
      : (appState.analysisMatchSettings || {});
    const modelConfig = appState.modelConfig || {};
    const factory = window.factoryState?.() || {};
    const product = factory.product || {};
    return {
      settings,
      modelConfig: {
        llmProvider: modelConfig.llmProvider || '',
        llmModel: modelConfig.llmModel || '',
        imageModel: modelConfig.imageModel || '',
        gptOAuthReasoningEffort: modelConfig.gptOAuthReasoningEffort || '',
        gptOAuthServiceTier: modelConfig.gptOAuthServiceTier || '',
      },
      connections: {
        hasGeminiConnection: typeof window.hasGeminiConnection === 'function' ? window.hasGeminiConnection() : null,
        hasLlmConnection: typeof window.hasLlmConnection === 'function' ? window.hasLlmConnection() : null,
        isGptOAuthConnected: typeof window.isGptOAuthConnected === 'function' ? window.isGptOAuthConnected() : null,
        backendBaseUrl: appState.backendBaseUrl || '',
        hasGeminiApiKeySlot: !!appState.apiKey,
      },
      imageInput: {
        hasAnalyzableProductImage: typeof window.hasAnalyzableProductImage === 'function' ? window.hasAnalyzableProductImage() : null,
        hasStateImageBase64: !!appState.imageBase64,
        analysisImageCount: Array.isArray(appState.analysisImages) ? appState.analysisImages.length : 0,
        inputImageFingerprint: product.inputImageFingerprint || '',
        lockedInputImageFingerprint: product.lockedInputImageFingerprint || '',
      },
      analysis: {
        exists: !!appState.analysis,
        matchesCurrent: typeof window.analysisMatchesCurrentImageInput === 'function'
          ? window.analysisMatchesCurrentImageInput(appState.analysis)
          : null,
        hasUsableInference: typeof window.analysisHasUsableInference === 'function'
          ? window.analysisHasUsableInference(appState.analysis)
          : null,
        engine: appState.analysis?.image_inference_engine || '',
        model: appState.analysis?.image_inference_model || appState.analysis?.gpt_oauth_model || '',
      },
    };
  })()`);
}

async function runCandidateNameLockProbe(cdp) {
  return evaluate(cdp, `(async () => {
    const factory = window.factoryState?.() || {};
    factory.product = factory.product || {};
    const clone = value => JSON.parse(JSON.stringify(value || null));
    const work = clone(factory) || {};
    work.product = clone(factory.product) || {};
    const stateManualBefore = clone(window.state?.productInfoManualValues || {});
    const stateNameBefore = window.state?.productName || '';
    const candidate = work.product.pendingCafe24Candidates?.[0] || work.product.cafe24Candidates?.[0] || null;
    const candidateName = candidate
      ? (typeof window.factoryCandidateName === 'function'
        ? window.factoryCandidateName(candidate, 'cafe24')
        : (candidate.product_name || candidate.name || ''))
      : '';
    const lockName = '상품명잠금검증 ' + Date.now();
    try {
      if (typeof window.factorySetFinalRegistrationBasicValue === 'function') {
        window.factorySetFinalRegistrationBasicValue(work, 'product_name', lockName);
      } else {
        work.product.userProductName = lockName;
        work.product.productName = lockName;
        work.product.finalDb = { ...(work.product.finalDb || {}), product_name: lockName };
        work.product.cafe24FinalRegistration = { ...(work.product.cafe24FinalRegistration || {}), productName: lockName, product_name: lockName };
      }
      const clearResult = typeof window.factoryClearProductScopedDbManualFields === 'function'
        ? window.factoryClearProductScopedDbManualFields(work, 'codex-name-lock-probe')
        : null;
      if (typeof window.factoryUpdateFinalDbFromFields === 'function') window.factoryUpdateFinalDbFromFields(work);
      const afterClear = {
        userProductName: work.product.userProductName || '',
        productName: work.product.productName || '',
        finalRegistrationName: work.product.cafe24FinalRegistration?.productName || '',
        finalRegistrationDbName: work.product.cafe24FinalRegistration?.product_name || '',
        finalDbName: work.product.finalDb?.product_name || '',
      };
      let afterCandidateMerge = null;
      if (candidate) {
        work.product.cafe24SelectedCandidate = clone(candidate);
        work.product.selectedCafe24CandidateKey = String(candidate.product_no || candidate.id || candidate.search_id || 'codex-candidate');
        work.product.confirmedDb = { ...(work.product.confirmedDb || {}), ...clone(candidate) };
        if (typeof window.factoryUpdateFinalDbFromFields === 'function') window.factoryUpdateFinalDbFromFields(work);
        afterCandidateMerge = {
          userProductName: work.product.userProductName || '',
          productName: work.product.productName || '',
          finalRegistrationName: work.product.cafe24FinalRegistration?.productName || '',
          finalRegistrationDbName: work.product.cafe24FinalRegistration?.product_name || '',
          finalDbName: work.product.finalDb?.product_name || '',
          selectedCafe24CandidateKey: work.product.selectedCafe24CandidateKey || '',
        };
      }
      const values = [
        afterClear.userProductName,
        afterClear.productName,
        afterClear.finalRegistrationName,
        afterClear.finalRegistrationDbName,
        afterClear.finalDbName,
        ...(afterCandidateMerge ? [
          afterCandidateMerge.userProductName,
          afterCandidateMerge.productName,
          afterCandidateMerge.finalRegistrationName,
          afterCandidateMerge.finalRegistrationDbName,
          afterCandidateMerge.finalDbName,
        ] : []),
      ];
      return {
        lockName,
        candidateName,
        hasCandidate: !!candidate,
        clearResult,
        afterClear,
        afterCandidateMerge,
        passed: values.every(value => value === lockName),
      };
    } finally {
      if (window.state) {
        window.state.productName = stateNameBefore || '';
        window.state.productInfoManualValues = stateManualBefore || {};
      }
    }
  })()`);
}

async function runRestoreNameProbe(cdp) {
  const restoreName = (EXTRA_ARGS.join(' ') || process.env.FACTORY_RESTORE_NAME || '').trim();
  if (!restoreName) throw new Error('복구할 상품명이 비어 있습니다.');
  return evaluate(cdp, `(() => {
    const restoreName = ${JSON.stringify(restoreName)};
    const factory = window.factoryState?.() || {};
    factory.product = factory.product || {};
    factory.product.userProductName = restoreName;
    factory.product.productName = restoreName;
    factory.product.finalDb = factory.product.finalDb || {};
    factory.product.finalDb.product_name = restoreName;
    factory.product.cafe24FinalRegistration = factory.product.cafe24FinalRegistration || {};
    factory.product.cafe24FinalRegistration.productName = restoreName;
    factory.product.cafe24FinalRegistration.product_name = restoreName;
    if (window.state) {
      window.state.productName = restoreName;
      window.state.productInfoManualValues = window.state.productInfoManualValues || {};
      window.state.productInfoManualValues.product_name = restoreName;
    }
    window.__factoryVmCandidateTimeoutMs = undefined;
    if (factory.goalRun) {
      factory.goalRun.running = false;
      factory.goalRun.failureReason = '';
    }
    if (typeof window.factoryUpdateFinalDbFromFields === 'function') window.factoryUpdateFinalDbFromFields(factory);
    if (typeof window.saveLastWorkNow === 'function') window.saveLastWorkNow({ sync: false });
    if (typeof window.renderPreservingMainScroll === 'function') window.renderPreservingMainScroll();
    else if (typeof window.render === 'function') window.render();
    return {
      productName: factory.product.productName || '',
      userProductName: factory.product.userProductName || '',
      finalDbName: factory.product.finalDb?.product_name || '',
      finalRegistrationName: factory.product.cafe24FinalRegistration?.productName || '',
    };
  })()`);
}

async function runFinalRegistrationTest(cdp) {
  let testImageBase64 = String(process.env.FACTORY_TEST_IMAGE_BASE64 || '').trim();
  const testImagePath = String(process.env.FACTORY_TEST_IMAGE_PATH || '').trim();
  if (!testImageBase64 && testImagePath) {
    testImageBase64 = await fs.promises.readFile(testImagePath, 'base64');
  }
  const started = await evaluate(cdp, `(() => {
    const testImageBase64 = ${JSON.stringify(testImageBase64)};
    const factory = window.factoryState?.() || {};
    factory.product = factory.product || {};
    const baseName = String(factory.product.userProductName || factory.product.productName || window.state?.productName || '조립공장검증상품').trim();
    const previous = {
      userProductName: factory.product.userProductName || '',
      productName: factory.product.productName || '',
      stateProductName: window.state?.productName || '',
      finalDbProductName: factory.product.finalDb?.product_name || '',
      finalRegistrationProductName: factory.product.cafe24FinalRegistration?.productName || factory.product.cafe24FinalRegistration?.product_name || '',
    };
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const testName = '검증용숨김 ' + baseName.replace(/^검증용숨김\\s+/, '') + ' ' + stamp;
    const imageDataUrl = testImageBase64 ? 'data:image/png;base64,' + testImageBase64 : '';
    factory.product.currentRunId = 'codex-e2e-' + stamp;
    factory.product.productKey = 'codex-hidden-cafe24-' + stamp;
    factory.product.inputImageFingerprint = 'codex-image-' + stamp;
    factory.product.lockedInputImageFingerprint = factory.product.inputImageFingerprint;
    factory.product.imageBase64 = testImageBase64 || factory.product.imageBase64 || '';
    factory.product.imageMime = 'image/png';
    factory.product.imagePreview = imageDataUrl || factory.product.imagePreview || '';
    factory.product.inputImages = testImageBase64
      ? [{ base64: testImageBase64, mime: 'image/png', inputImageFingerprint: factory.product.inputImageFingerprint }]
      : (Array.isArray(factory.product.inputImages) ? factory.product.inputImages : []);
    if (testImageBase64) {
      factory.product.cafe24ImageDraft = {
        image_upload_type: 'A',
        detail_image: { base64: testImageBase64 },
        list_image: { base64: testImageBase64 },
        tiny_image: { base64: testImageBase64 },
        small_image: { base64: testImageBase64 },
        additional_images: [],
      };
    }
    const sync = typeof window.factoryEnsureOpenMarketSync === 'function'
      ? window.factoryEnsureOpenMarketSync(factory)
      : (factory.product.openMarketSync = factory.product.openMarketSync || {});
    sync.finalTarget = 'cafe24_only';
    sync.cafe24RegistrationMode = 'create';
    sync.cafe24Display = 'F';
    sync.cafe24Selling = 'F';
    if (typeof window.factorySetFinalRegistrationBasicValue === 'function') {
      window.factorySetFinalRegistrationBasicValue(factory, 'product_name', testName);
      window.factorySetFinalRegistrationBasicValue(factory, 'sale_price', '2500');
      window.factorySetFinalRegistrationBasicValue(factory, 'consumer_price', '2500');
      window.factorySetFinalRegistrationBasicValue(factory, 'purchase_price', '0');
    } else {
      factory.product.userProductName = testName;
      factory.product.productName = testName;
      factory.product.finalDb = { ...(factory.product.finalDb || {}), product_name: testName, sale_price: '2500', price: '2500' };
      factory.product.cafe24FinalRegistration = { ...(factory.product.cafe24FinalRegistration || {}), productName: testName, price: '2500', salePrice: '2500' };
      if (window.state) window.state.productName = testName;
    }
    if (window.state) {
      window.state.productName = testName;
      window.state.analysis = {
        ...(window.state.analysis || {}),
        product_name: testName,
        product_title: testName,
        category: '검증용 숨김 상품',
      };
      if (testImageBase64) {
        window.state.imageBase64 = testImageBase64;
        window.state.imagePreview = imageDataUrl;
        window.state.analysisImages = [{ base64: testImageBase64, mime: 'image/png', inputImageFingerprint: factory.product.inputImageFingerprint }];
      }
      const sections = typeof window.orderedSections === 'function' ? window.orderedSections() : [];
      if (sections.length) {
        window.state.sectionContents = {};
        window.state.sectionImages = {};
        window.state.detailImageBlocks = [];
        window.state.sectionGenerationMeta = {};
        const scope = typeof window.sectionWorkScopeMeta === 'function'
          ? window.sectionWorkScopeMeta()
          : {
            currentRunId: factory.product.currentRunId,
            productKey: factory.product.productKey,
            inputImageFingerprint: factory.product.inputImageFingerprint,
          };
        window.state.sectionWorkScope = {
          ...scope,
          scopeKey: scope.scopeKey || [scope.currentRunId || 'no_run', scope.productKey || 'no_product', scope.inputImageFingerprint || 'no_image'].join('::'),
        };
        sections.forEach((section, index) => {
          const cleanName = String(section.name || section.label || section.id || '').replace(/\\s*\\([^)]*\\)\\s*$/g, '').trim();
          const content = {
            headline: cleanName ? testName + ' ' + cleanName : testName,
            subheadline: '검증용 숨김 등록 상세 섹션',
            body_text: testName + ' 등록 검증을 위한 현재 작업 기준 상세페이지 섹션입니다. 이전 상품 이미지나 이전 상품명은 사용하지 않습니다.',
            bullets: [
              '현재 작업 실행 ID 기준',
              '현재 입력 이미지 기준',
              'Cafe24 진열안함/판매안함 검증',
            ],
            color_scheme: { background: '#ffffff', text_primary: '#1f2937', text_secondary: '#6b7280' },
            font_suggestion: { headline_size: '34px', body_size: '16px' },
            prompt_trace: { sourceMode: '종합버전 검증', imagePrompt: '' },
          };
          if (typeof window.stampSectionContentWorkScope === 'function') {
            window.stampSectionContentWorkScope(content, section.id, 'codex-e2e-hidden-cafe24');
          } else {
            content.__sectionWorkScope = {
              ...window.state.sectionWorkScope,
              sectionId: section.id,
              trigger: 'codex-e2e-hidden-cafe24',
              stampedAt: Date.now(),
            };
          }
          window.state.sectionContents[section.id] = content;
          window.state.sectionGenerationMeta[section.id] = content.__sectionWorkScope;
          if (imageDataUrl && index < 4) window.state.sectionImages[section.id] = imageDataUrl;
        });
      }
    }
    if (typeof window.factoryApplyFinalCafe24StatusToDb === 'function') window.factoryApplyFinalCafe24StatusToDb(factory);
    if (typeof window.factoryUpdateFinalDbFromFields === 'function') window.factoryUpdateFinalDbFromFields(factory);
    if (typeof window.saveLastWorkNow === 'function') window.saveLastWorkNow({ sync: false });
    if (typeof window.renderPreservingMainScroll === 'function') window.renderPreservingMainScroll();
    else if (typeof window.render === 'function') window.render();
    window.__codexFinalRegistrationTest = {
      done: false,
      result: null,
      error: null,
      testName,
      previous,
      startedAt: Date.now(),
    };
    Promise.resolve(window.factoryRunFinalRegistration?.({
      skipConfirm: true,
      historySource: 'codex-e2e-hidden-cafe24',
    })).then(result => {
      window.__codexFinalRegistrationTest.done = true;
      window.__codexFinalRegistrationTest.result = result === false ? false : true;
    }).catch(error => {
      window.__codexFinalRegistrationTest.done = true;
      window.__codexFinalRegistrationTest.error = String(error?.message || error);
    });
    return {
      testName,
      fixture: {
        hasImage: !!testImageBase64,
        sectionCount: window.state ? Object.keys(window.state.sectionContents || {}).length : 0,
        sectionScope: window.state?.sectionWorkScope || null,
      },
      settings: typeof window.factoryFinalRegistrationSettings === 'function' ? window.factoryFinalRegistrationSettings(factory) : null,
      model: typeof window.factoryFinalRegistrationCafe24Model === 'function' ? window.factoryFinalRegistrationCafe24Model(factory) : null,
      basicInfo: typeof window.factoryFinalRegistrationBasicInfoModel === 'function' ? window.factoryFinalRegistrationBasicInfoModel(factory) : null,
    };
  })()`);
  const startedAt = Date.now();
  let last = null;
  while (Date.now() - startedAt < 300000) {
    await sleep(2500);
    last = await evaluate(cdp, `(() => {
      const factory = window.factoryState?.() || {};
      const sync = typeof window.factoryEnsureOpenMarketSync === 'function'
        ? window.factoryEnsureOpenMarketSync(factory)
        : (factory.product?.openMarketSync || {});
      const test = window.__codexFinalRegistrationTest || {};
      const verification = factory.product?.cafe24LastSaveVerification || {};
      const finalDb = factory.product?.finalDb || {};
      const candidates = Array.isArray(factory.product?.cafe24Candidates) ? factory.product.cafe24Candidates : [];
      const selectedKey = String(factory.product?.selectedCafe24CandidateKey || '').trim();
      const candidateKey = item => {
        try {
          if (typeof window.factoryCafe24CandidateKey === 'function') return String(window.factoryCafe24CandidateKey(item) || '').trim();
        } catch(_) {}
        return String(item?.product_no || item?.raw?.product_no || item?.rawProduct?.product_no || '').trim();
      };
      const selectedCandidate = selectedKey
        ? candidates.find(item => candidateKey(item) === selectedKey)
        : null;
      const selectedNo = selectedCandidate?.product_no || selectedCandidate?.raw?.product_no || selectedCandidate?.rawProduct?.product_no || '';
      const latestCreated = candidates.slice().reverse().find(item => /created/i.test(String(item?.source || item?.metadata?.source || item?.match_query || '')));
      return {
        done: !!test.done,
        result: test.result,
        error: test.error || '',
        elapsedSec: Math.round((Date.now() - (test.startedAt || Date.now())) / 1000),
        testName: test.testName || '',
        finalStatus: sync.finalRegistrationStatus || '',
        finalProgress: sync.finalRegistrationProgress || 0,
        running: !!sync.finalRegistrationRunning,
        apiStatus: factory.product?.cafe24ApiStatus || '',
        productNo: verification.productNo || selectedNo || latestCreated?.product_no || finalDb.product_no || finalDb.cafe24_product_no || '',
        productName: finalDb.product_name || factory.product?.userProductName || '',
        verification: {
          type: verification.type || '',
          productNo: verification.productNo || '',
          message: verification.message || '',
          error: verification.error || '',
          checked: verification.verification?.checked || 0,
          matched: verification.verification?.matched || 0,
          missing: verification.verification?.missing || [],
          mismatches: verification.verification?.mismatches || [],
        },
        logs: (factory.logs || []).slice(0, 8).map(item => item.message || item.text || ''),
      };
    })()`);
    if (last.done && !last.running) break;
  }
  let restored = null;
  if (last && last.result === false) {
    restored = await evaluate(cdp, `(() => {
      const test = window.__codexFinalRegistrationTest || {};
      const previous = test.previous || null;
      if (!previous) return { ok: false, reason: 'restore-record-missing' };
      const factory = window.factoryState?.() || {};
      factory.product = factory.product || {};
      factory.product.userProductName = previous.userProductName || previous.productName || '';
      factory.product.productName = previous.productName || previous.userProductName || '';
      if (window.state) window.state.productName = previous.stateProductName || previous.userProductName || previous.productName || '';
      factory.product.finalDb = factory.product.finalDb || {};
      if (previous.finalDbProductName) factory.product.finalDb.product_name = previous.finalDbProductName;
      factory.product.cafe24FinalRegistration = factory.product.cafe24FinalRegistration || {};
      if (previous.finalRegistrationProductName) {
        factory.product.cafe24FinalRegistration.productName = previous.finalRegistrationProductName;
        factory.product.cafe24FinalRegistration.product_name = previous.finalRegistrationProductName;
      }
      if (typeof window.saveLastWorkNow === 'function') window.saveLastWorkNow({ sync: false });
      if (typeof window.renderPreservingMainScroll === 'function') window.renderPreservingMainScroll();
      else if (typeof window.render === 'function') window.render();
      return {
        ok: true,
        productName: factory.product.userProductName || factory.product.productName || '',
      };
    })()`);
  }
  return { started, last, restored };
}

async function runCafe24DetailReadbackProbe(cdp) {
  const productNo = String(EXTRA_ARGS[0] || '').trim();
  if (!productNo) return { ok: false, reason: 'product_no_required' };
  return evaluate(cdp, `(async () => {
    const productNo = ${JSON.stringify(productNo)};
    const detail = typeof window.fetchCafe24ProductFullByNo === 'function'
      ? await window.fetchCafe24ProductFullByNo(productNo)
      : null;
    const raw = typeof window.parseCafe24Raw === 'function'
      ? window.parseCafe24Raw(detail)
      : (detail?.raw || detail || {});
    const html = String(raw?.description || raw?.mobile_description || detail?.description || detail?.mobile_description || detail?.raw?.description || detail?.raw?.mobile_description || '');
    const check = typeof window.factoryCafe24DetailPayloadPreflight === 'function'
      ? window.factoryCafe24DetailPayloadPreflight({ description: html, mobile_description: html })
      : { ok: true, issues: [] };
    let verify = null;
    if (typeof window.factoryVerifyCafe24SavedDetailHtml === 'function') {
      verify = await window.factoryVerifyCafe24SavedDetailHtml(productNo, undefined, { attempts: 2, delayMs: 250 });
    }
    return {
      ok: !!html.trim() && !!check?.ok,
      productNo,
      detailKeys: detail && typeof detail === 'object' ? Object.keys(detail).slice(0, 12) : [],
      rawKeys: raw && typeof raw === 'object' ? Object.keys(raw).slice(0, 20) : [],
      rawProductNo: raw?.product_no || '',
      rawName: raw?.product_name || '',
      rawDisplay: raw?.display || '',
      rawSelling: raw?.selling || '',
      htmlLength: html.length,
      imgCount: (html.match(/<img\\b/gi) || []).length,
      hasBase64: /data:[^"'<>\\s]*base64\\s*,/i.test(html),
      hasDataImage: /data:image/i.test(html),
      check: {
        ok: !!check?.ok,
        issues: check?.issues || [],
        tokenHits: check?.tokenHits || [],
        hasInlineImage: !!check?.hasInlineImage,
        hasLongBase64: !!check?.hasLongBase64,
        hasLightPlaceholder: !!check?.hasLightPlaceholder,
      },
      verify: verify ? {
        htmlLength: String(verify.html || '').length,
        ok: !!verify.check?.ok,
        issues: verify.check?.issues || [],
        attempts: verify.attempts || 0,
      } : null,
    };
  })()`);
}

async function runCutsPromptAuditProbe(cdp) {
  return evaluate(cdp, `(() => {
    const len = value => typeof value === 'string' ? value.length : JSON.stringify(value || '').length;
    const compact = typeof window.compactCurrentCutPromptInlineResults === 'function'
      ? window.compactCurrentCutPromptInlineResults(window.factoryState?.() || window.state?.factory || {}, window.state?.cuts || {})
      : 'missing';
    const rows = (window.state?.cuts?.prompts || []).map((p, index) => {
      const fields = {};
      ['prompt', 'result', 'image', 'dataUrl', 'preview', 'sourceBase64', 'sourcePreview'].forEach(key => {
        if (p && p[key]) fields[key] = len(p[key]);
      });
      if (p?.metadata) fields.metadata = len(p.metadata);
      return {
        index,
        id: p?.id || '',
        label: p?.label || '',
        hasResult: !!p?.result,
        resultHead: String(p?.result || '').slice(0, 42),
        archiveId: p?.archiveId || p?.localArchive?.archiveId || p?.metadata?.localArchiveId || '',
        imagePersistence: p?.imagePersistence || '',
        matchedAsset: typeof window.factoryFindPromptAssetForCompact === 'function'
          ? (() => {
              const asset = window.factoryFindPromptAssetForCompact(p, 'cuts', window.factoryState?.() || window.state?.factory || {});
              return asset ? { id: asset.id || '', title: asset.title || '', image: asset.image || '', archiveId: asset.archiveId || '' } : null;
            })()
          : 'missing',
        simpleMatch: (window.factoryState?.().assets || []).find(asset => String(asset?.stageId || '') === 'cuts' && String(asset?.title || '').trim() === String(p?.label || '').trim())
          ? true
          : false,
        fields,
        total: len(p),
      };
    }).sort((a, b) => b.total - a.total);
    return {
      count: rows.length,
      compact,
      compactType: typeof window.compactCurrentCutPromptInlineResults,
      rows,
      assets: (window.factoryState?.().assets || []).map(asset => ({
        id: asset?.id || '',
        stageId: asset?.stageId || '',
        title: asset?.title || '',
        used: !!asset?.used,
        rejected: !!asset?.rejected,
        currentProductHidden: !!asset?.currentProductHidden,
        promptId: asset?.promptId || asset?.metadata?.promptId || asset?.sourceMap?.promptId || '',
        image: asset?.image || '',
        archiveId: asset?.archiveId || asset?.localArchive?.archiveId || asset?.metadata?.localArchiveId || '',
      })).filter(asset => asset.stageId === 'cuts' || asset.promptId),
      sourceBase64Bytes: len(window.state?.cuts?.sourceBase64 || ''),
      sourcePreviewBytes: len(window.state?.cuts?.sourcePreview || ''),
    };
  })()`);
}

const cdp = await connectCdp(await getPageWebSocketUrl());
try {
  await ensureApp(cdp);
  if (MODE === 'reload-state' || MODE === 'db-vm-timeout' || MODE === 'final-register-test') await reloadApp(cdp);
  const wantsSummary = !SUMMARYLESS_MODES.has(MODE);
  const before = wantsSummary ? await summarize(cdp) : null;
  let modeResult = null;
  if (MODE === 'db-vm-timeout') modeResult = await runDbVmTimeoutProbe(cdp);
  if (MODE === 'final-ui') modeResult = await runFinalUiProbe(cdp);
  if (MODE === 'final-ui-compact') modeResult = await runFinalUiCompactProbe(cdp);
  if (MODE === 'detail-audit') modeResult = await runDetailAuditProbe(cdp);
  if (MODE === 'detail-audit-compact') modeResult = await runDetailAuditCompactProbe(cdp);
  if (MODE === 'section-scope-audit') modeResult = await runSectionScopeAuditProbe(cdp);
  if (MODE === 'generate-detail-stage') modeResult = await runGenerateDetailStageProbe(cdp);
  if (MODE === 'detail-stage-status') modeResult = await runDetailStageStatusProbe(cdp);
  if (MODE === 'generate-all-direct') modeResult = await runGenerateAllSectionsDirectProbe(cdp);
  if (MODE === 'generate-all-status') modeResult = await runGenerateAllSectionsStatusProbe(cdp);
  if (MODE === 'state-size-audit') modeResult = await runStateSizeAuditProbe(cdp);
  if (MODE === 'cuts-prompt-audit') modeResult = await runCutsPromptAuditProbe(cdp);
  if (MODE === 'post-create-plan') modeResult = await runPostCreatePlanProbe(cdp);
  if (MODE === 'analysis-settings') modeResult = await runAnalysisSettingsProbe(cdp);
  if (MODE === 'candidate-name-lock') modeResult = await runCandidateNameLockProbe(cdp);
  if (MODE === 'restore-name') modeResult = await runRestoreNameProbe(cdp);
  if (MODE === 'final-register-test') modeResult = await runFinalRegistrationTest(cdp);
  if (MODE === 'cafe24-detail-readback') modeResult = await runCafe24DetailReadbackProbe(cdp);
  const after = wantsSummary ? await summarize(cdp) : null;
  const payload = wantsSummary
    ? { ok: true, mode: MODE, before, modeResult, after }
    : { ok: true, mode: MODE, modeResult };
  console.log(JSON.stringify(payload, null, 2));
} finally {
  cdp.close();
}
