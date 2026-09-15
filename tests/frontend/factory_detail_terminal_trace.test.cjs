'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function sourceSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return text.slice(start, end);
}

test('final_detail 요청 timeout은 terminal trace로 projection까지 보존된다', async () => {
  const factoryCore = source('src/app-core-06.js');
  const detailStageSource = sourceSlice(
    factoryCore,
    'async function factoryGenerateDetailStage(',
    'async function factoryRunStage(',
  );
  const progressSource = sourceSlice(
    source('src/app-core-03.js'),
    'function factoryControlProgress(',
    'function createFactoryControlPreflightCache(',
  );
  const factory = {
    activeStage: 'detail',
    batchJobId: 'job-final-detail',
    currentProjectId: 'workspace-final-detail',
    workspaceRevision: 12,
    product: { analysis: { product_name: 'trace fixture' } },
    stages: { detail: { status: 'idle', message: '' } },
    assets: [],
    goalRun: { running: true, progress: 86, failureReason: '' },
  };
  const state = {
    analysis: { product_name: 'trace fixture' },
    sectionContents: { header: { generation_basis: 'combined' } },
    sectionImages: { header: 'data:image/png;base64,AA==' },
    detailImageBlocks: [],
    sectionBatchRun: null,
    step: 'factory',
  };
  const context = vm.createContext({
    state,
    window: {
      generateAllSections: async operationContext => {
        operationContext.onTrace('request_start', {
          sectionId: 'key_features',
          sectionName: '핵심 특징',
          request: 'Key Features',
        });
        operationContext.onTrace('request_timeout', {
          sectionId: 'key_features',
          sectionName: '핵심 특징',
          request: 'Key Features',
          errorCode: 'factory_section_request_timeout',
        });
        return false;
      },
    },
    cloneData: value => structuredClone(value),
    factoryUpdateFromInputs: () => {},
    factoryApplyBatchControlDetailLayout: () => 0,
    factoryApplySelectedAssetsToSections: () => 0,
    factoryApplyCombinedSectionBasisForDetailStage: () => 0,
    factorySetStageStatus: (stageId, status, message, draft) => {
      draft.stages[stageId] = { ...(draft.stages[stageId] || {}), status, message };
    },
    factoryLog: () => {},
    factoryStageGoalProgressRange: () => [80, 98],
    factorySetGoalRunProgress: (progress, stage, _message, _type, options) => {
      options.factory.goalRun.progress = progress;
      options.factory.goalRun.currentStage = stage;
    },
    saveLastWorkNow: () => {},
    render: () => {},
    factoryStartGoalHeartbeat: () => 'detail-heartbeat',
    factoryStopGoalHeartbeat: () => {},
    ensureCurrentProductAnalysisForGeneration: () => {},
    analysisMatchesCurrentImageInput: () => true,
    analysisHasUsableInference: () => true,
    orderedSections: () => [
      { id: 'header', name: '헤더' },
      { id: 'key_features', name: '핵심 특징' },
    ],
    getSectionGenerationMode: () => 'mixed',
    sectionWorkScopeMeta: () => ({}),
    sectionContentBelongsToCurrentWork: sectionId => sectionId === 'header',
    factoryStageLabel: stageId => stageId,
  });
  vm.runInContext(`${detailStageSource}\n${progressSource}\nthis.runDetail = factoryGenerateDetailStage;`, context);

  const completed = await context.runDetail({ factory });

  assert.equal(completed, false);
  assert.equal(factory.stages.detail.status, 'error');
  assert.equal(factory.product.detailStageDebug.phase, 'request_timeout');
  assert.equal(factory.product.detailStageDebug.errorCode, 'factory_section_request_timeout');
  assert.equal(factory.product.detailStageDebug.currentSectionId, 'key_features');
  assert.equal(context.factoryControlProgress(factory).trace.phase, 'request_timeout');
});

test('미리보기 archive 이미지 복원은 현재 본문을 우선하고 빈 본문에만 archive 본문을 쓴다', async () => {
  const recoverySource = sourceSlice(
    source('src/app-core-06.js'),
    'async function factoryRecoverPreviewSectionsFromLocalArchive(',
    'function queueSectionContentLocalArchive(',
  );
  const recover = async currentContent => {
    const state = {
      sectionImages: { material_tech: '__stored_in_indexeddb__' },
      sectionContents: { material_tech: currentContent },
    };
    const archiveRecord = {
      id: 'archive-material',
      archiveId: 'archive-material',
      workspaceId: 'workspace',
      stageId: 'section_material_tech',
      productKey: '상품',
      inputImageFingerprint: 'input-1',
      imageUrl: 'https://archive.example/material.png',
    };
    const calls = [];
    const context = vm.createContext({
      state,
      URLSearchParams,
      Date,
      Map,
      factoryRuntimeReadFactory: () => ({ product: { productName: '상품' } }),
      factoryLocalArchiveSearchProductName: () => '상품',
      factoryNormalizeIdentityText: value => String(value || '').trim(),
      factoryCurrentProductKey: () => '상품',
      factoryCurrentInputImageFingerprint: () => 'input-1',
      factorySectionIdFromLocalArchiveStage: stageId => stageId === 'section_material_tech' ? 'material_tech' : '',
      factoryLocalArchiveItemHasImageFile: item => !!item.imageUrl,
      orderedSections: () => [{ id: 'material_tech', name: '소재 기술' }],
      displayableImageSrc: value => /^https:\/\//.test(String(value || '')) ? value : '',
      workspaceArchiveFetch: async url => ({
        ok: true,
        json: async () => url.includes('/assets?')
          ? { ok: true, assets: [archiveRecord] }
          : { ok: true, record: archiveRecord, metadata: { content: { price: 0, body_text: 'archive' } }, asset: { content: { price: 0 } } },
      }),
      factoryLocalArchiveImageUrl: () => archiveRecord.imageUrl,
      factoryImageOnlySectionContent: () => ({ price: '', body_text: '' }),
      applySectionContent: (sectionId, content, image) => {
        calls.push({ sectionId, content, image });
        state.sectionContents[sectionId] = content;
        state.sectionImages[sectionId] = image;
      },
      savePersistentState: () => {},
      saveLastWorkNow: () => {},
      render: () => {},
    });
    vm.runInContext(`${recoverySource}\nthis.recover = factoryRecoverPreviewSectionsFromLocalArchive;`, context);
    const result = await context.recover({ render: false, persist: false });
    return { result, calls, state };
  };

  const current = await recover({ price: 2000, body_text: '현재 본문' });
  assert.equal(current.result.restored, 1);
  assert.deepEqual(current.calls[0].content, { price: 2000, body_text: '현재 본문' }, '이미지 marker만 복원할 때 현재 본문을 archive 0원으로 덮으면 안 됩니다.');

  const empty = await recover({});
  assert.equal(empty.result.restored, 1);
  assert.deepEqual(empty.calls[0].content, { price: 0, body_text: 'archive' }, '현재 본문이 비었을 때만 archive 본문을 복원해야 합니다.');
});

test('detail stage는 marker 이미지를 먼저 복원해 export하고 못 읽으면 전체 생성 대신 차단한다', async t => {
  const detailStageSource = sourceSlice(
    source('src/app-core-06.js'),
    'async function factoryGenerateDetailStage(',
    'async function factoryRunStage(',
  );
  const run = async (recoverPreview, options = {}) => {
    const factory = {
      activeStage: 'detail', batchJobId: 'job-marker', currentProjectId: 'workspace-marker', workspaceRevision: 1,
      product: { analysis: { product_name: 'marker fixture' } }, stages: { detail: { status: 'idle', message: '' } }, assets: [],
      goalRun: { running: true, progress: 80, failureReason: '' },
    };
    const state = {
      analysis: { product_name: 'marker fixture' },
      sectionContents: { header: { generation_basis: 'combined', body_text: '현재 본문' } },
      sectionImages: { header: Object.hasOwn(options, 'initialImage') ? options.initialImage : '__stored_in_indexeddb__' },
      detailImageBlocks: [], sectionBatchRun: null, step: 'factory',
    };
    let generatorCalls = 0;
    let recoveryCalls = 0;
    let stopCalls = 0;
    let assetCalls = 0;
    let exportedHtml = '';
    const operationSignal = { aborted: false };
    const context = vm.createContext({
      state,
      window: { generateAllSections: async () => {
        generatorCalls += 1;
        state.sectionImages.header = 'https://generated.example/header.png';
        return true;
      } },
      cloneData: value => structuredClone(value),
      factoryUpdateFromInputs: () => {}, factoryApplyBatchControlDetailLayout: () => 0,
      factoryApplySelectedAssetsToSections: () => 0, factoryApplyCombinedSectionBasisForDetailStage: () => 0,
      factorySetStageStatus: (stage, status, message, draft) => { draft.stages[stage] = { ...(draft.stages[stage] || {}), status, message }; },
      factoryLog: () => {}, factoryStageGoalProgressRange: () => [80, 98],
      factorySetGoalRunProgress: (_progress, _stage, _message, _type, options) => { options.factory.goalRun.progress = _progress; },
      saveLastWorkNow: () => {}, render: () => {}, factoryStartGoalHeartbeat: () => 'heartbeat',
      factoryStopGoalHeartbeat: () => { stopCalls += 1; },
      ensureCurrentProductAnalysisForGeneration: () => {}, analysisMatchesCurrentImageInput: () => true, analysisHasUsableInference: () => true,
      orderedSections: () => [{ id: 'header', name: '헤더' }], getSectionGenerationMode: () => 'mixed', sectionWorkScopeMeta: () => ({}),
      sectionContentBelongsToCurrentWork: () => true,
      displayableImageSrc: value => /^https:\/\//.test(String(value || '')) ? value : '',
      factoryRecoverPreviewSectionsFromLocalArchive: async recoveryOptions => {
        recoveryCalls += 1;
        return recoverPreview({ state, options: recoveryOptions, operationSignal });
      },
      buildExportHtml: (_analysis, _contents, images) => { exportedHtml = `<main><img src="${images.header}"></main>`; return exportedHtml; },
      factoryRegisterAsset: (_stage, html) => {
        assetCalls += 1;
        return { id: 'detail-asset', title: '상세 HTML', html };
      }, deriveProjectName: () => 'marker fixture',
    });
    vm.runInContext(`${detailStageSource}\nthis.runDetail = factoryGenerateDetailStage;`, context);
    const result = await context.runDetail({ factory, operationSignal });
    return { result, factory, state, generatorCalls, recoveryCalls, stopCalls, assetCalls, exportedHtml };
  };

  const recovered = await run(({ state }) => {
    state.sectionImages.header = 'https://archive.example/header.png';
    return { ok: true, restored: 1, total: 1 };
  });
  assert.equal(recovered.result, true);
  assert.equal(recovered.generatorCalls, 0, 'marker 이미지는 복원 성공 뒤 유료 전체 생성으로 넘어가면 안 됩니다.');
  assert.match(recovered.exportedHtml, /archive\.example\/header\.png/);

  const blocked = await run(() => ({ ok: false, restored: 0, total: 1 }));
  assert.equal(blocked.result, false);
  assert.equal(blocked.generatorCalls, 0, '복원 실패 marker는 유료 전체 생성으로 대신 처리하면 안 됩니다.');
  assert.match(blocked.factory.stages.detail.message, /이미지 복원/);

  await t.test('이미지가 아직 없는 첫 생성은 복원 없이 기존 생성기로 진행한다', async () => {
    for (const initialImage of [null, undefined]) {
      const initial = await run(() => { throw new Error('첫 생성에서 보관본 복원을 호출하면 안 됩니다.'); }, { initialImage });
      assert.equal(initial.result, true);
      assert.equal(initial.recoveryCalls, 0);
      assert.equal(initial.generatorCalls, 1);
      assert.equal(initial.assetCalls, 1);
    }
  });

  await t.test('복원 도중 작업 취소 시 heartbeat만 종료하고 새 작업을 건드리지 않는다', async () => {
    const cancelled = await run(({ state, operationSignal }) => {
      operationSignal.aborted = true;
      state.step = 'newer-work';
      return { ok: true, restored: 0, total: 1 };
    });
    assert.equal(cancelled.result, false);
    assert.equal(cancelled.stopCalls, 1);
    assert.equal(cancelled.generatorCalls, 0);
    assert.equal(cancelled.assetCalls, 0);
    assert.equal(cancelled.state.step, 'newer-work');
  });
});

test('동일 material_tech에 선택한 일반컷은 첫 컷과 추가 이미지 블록으로 함께 내보낸다', () => {
  const factoryCore = source('src/app-core-06.js');
  const placementSource = sourceSlice(
    factoryCore,
    'function factoryApplyBatchControlDetailLayout(',
    'function factoryApplyCombinedSectionBasisForDetailStage(',
  );
  const exportSource = sourceSlice(
    factoryCore,
    'function buildExportHtml(',
    'function startAutomation(',
  );
  const detailBlockSource = sourceSlice(
    source('src/app-core-05.js'),
    'function getDetailImageBlocksAfter(',
    'function renderImageInsertModal(',
  );
  const runtimeBlockSource = sourceSlice(
    source('src/app-core-02.js'),
    'function stripRuntimeDetailBlockImages(',
    'function stripRuntimeVariantImages(',
  );
  const d50 = 'data:image/png;base64,RDUw';
  const ef = 'data:image/png;base64,RUY=';
  const oldSize = 'data:image/png;base64,T0xE';
  const newSize = 'data:image/png;base64,TkVX';
  const factory = {
    batchJobId: 'batch-selected-cut-collision',
    detailPlacement: {},
    assets: [
      { id: 'factory_cuts_mtzbwxqg_8dy8ms', title: 'D50', stageId: 'cuts', image: d50, used: true },
      { id: 'factory_cuts_mtzbwxqf_hyu0hi', title: 'EF lifestyle', stageId: 'cuts', image: ef, used: true },
      { id: 'factory_size_new', title: '새 규격표', stageId: 'size', image: newSize, used: true, placedSectionId: 'size_color' },
    ],
  };
  const state = {
    hiddenSectionIds: [],
    cuts: { placement: { material_tech: 'factory:factory_cuts_mtzbwxqf_hyu0hi', size_color: 'factory:old_size' } },
    sectionContents: { use_scenarios: { label: '이동한 위치' } },
    sectionImages: { material_tech: ef, size_color: oldSize },
    detailImageBlocks: [{
      id: 'operator-moved-ef',
      afterSectionId: 'use_scenarios',
      dataUrl: 'data:image/png;base64,T0xE',
      label: '운영자 캡션',
      note: '보존',
      factoryAssetId: 'factory_cuts_mtzbwxqf_hyu0hi',
    }],
  };
  const context = vm.createContext({
    state,
    localStorage: { setItem: () => {} },
    orderedSections: () => [
      { id: 'material_tech', name: '소재 기술', purpose: '' },
      { id: 'use_scenarios', name: '활용 사례', purpose: '' },
      { id: 'size_color', name: '사이즈', purpose: '' },
    ],
    factoryAssetHasCurrentProductPayload: () => true,
    factoryAssetDisplayImage: asset => asset.image,
    optionSorterColorImagesDisabled: () => false,
    sectionPlacementKey: (kind, id) => `${kind}:${id}`,
    getSectionDefinition: sectionId => ({ id: sectionId, name: '소재 기술' }),
    ensureSectionContentForPlacedImage: (sectionId, asset) => {
      state.sectionContents[sectionId] ||= { label: asset.label };
    },
    savePlacement: () => {},
    escAttr: value => String(value),
    escapeHtml: value => String(value),
    displayableImageSrc: value => value,
    renderSectionTemplate: (_section, _content, image) => `<section><img src="${image}"></section>`,
  });
  vm.runInContext(`${placementSource}\n${detailBlockSource}\n${exportSource}\nthis.applyLayout = factoryApplyBatchControlDetailLayout; this.applyAssets = factoryApplySelectedAssetsToSections; this.exportHtml = buildExportHtml;`, context);

  context.applyAssets(factory);
  context.applyLayout(factory);
  context.applyAssets(factory);
  context.applyAssets(factory);
  const stripContext = vm.createContext({ runtimeExternalImageSrc: () => '' });
  vm.runInContext(`${runtimeBlockSource}\nthis.strip = stripRuntimeDetailBlockImages;`, stripContext);
  const refreshed = stripContext.strip(state.detailImageBlocks);
  const html = context.exportHtml({}, state.sectionContents, state.sectionImages, state.detailImageBlocks);

  assert.equal(state.sectionImages.material_tech, d50, '첫 일반컷은 기존 섹션 이미지 계약을 유지해야 합니다.');
  assert.equal(state.sectionImages.size_color, newSize, '사이즈 선택은 기존 주 이미지 교체 계약을 유지해야 합니다.');
  assert.deepEqual(
    state.detailImageBlocks.map(block => [block.id, block.afterSectionId, block.dataUrl, block.label, block.note]),
    [['operator-moved-ef', 'use_scenarios', ef, '운영자 캡션', '보존']],
    '충돌한 다음 일반컷은 재구성해도 이동 위치와 운영자 메타데이터를 유지해야 합니다.',
  );
  assert.equal(refreshed[0].factoryAssetId, 'factory_cuts_mtzbwxqf_hyu0hi', '런타임 이미지 경량화 뒤에도 소유자 표식이 남아야 합니다.');
  assert.equal(refreshed[0].hasDataUrl, true, '런타임 이미지 경량화 뒤에도 이미지 복원 표식이 남아야 합니다.');
  assert.equal((html.match(/RDUw/g) || []).length, 1, 'restore 뒤 D50 주 이미지는 추가 block으로 중복되면 안 됩니다.');
  assert.equal((html.match(/RUY=/g) || []).length, 1, '내보낸 HTML에 EF 추가 이미지 block은 한 번이어야 합니다.');
});

test('batch 주 이미지는 정확한 자동 D50 block만 정리하고 같은 id의 사용자 block은 보존한다', () => {
  const factoryCore = source('src/app-core-06.js');
  const placementSource = sourceSlice(
    factoryCore,
    'function factoryApplyBatchControlDetailLayout(',
    'function factoryApplyCombinedSectionBasisForDetailStage(',
  );
  const d50 = 'data:image/png;base64,RDUw';
  const ef = 'data:image/png;base64,RUY=';
  const d50Id = 'factory_cuts_mtzbwxqg_8dy8ms';
  const efId = 'factory_cuts_mtzbwxqf_hyu0hi';
  const apply = blocks => {
    const factory = {
      batchJobId: 'batch-selected-cut-auto-block',
      detailPlacement: { [d50Id]: 'material_tech', [efId]: 'material_tech' },
      assets: [
        { id: d50Id, title: 'D50', stageId: 'cuts', image: d50, used: true, placedSectionId: 'material_tech' },
        { id: efId, title: 'EF lifestyle', stageId: 'cuts', image: ef, used: true, placedSectionId: 'material_tech' },
      ],
    };
    const state = {
      hiddenSectionIds: [],
      cuts: { placement: { material_tech: `factory:${efId}` } },
      sectionImages: { material_tech: ef },
      sectionContents: {},
      detailImageBlocks: blocks,
    };
    const context = vm.createContext({
      state,
      orderedSections: () => [{ id: 'material_tech', name: '소재 기술', purpose: '' }, { id: 'use_scenarios', name: '활용 사례', purpose: '' }],
      factoryAssetHasCurrentProductPayload: () => true,
      factoryAssetDisplayImage: asset => asset.image,
      optionSorterColorImagesDisabled: () => false,
      sectionPlacementKey: (kind, id) => `${kind}:${id}`,
      ensureSectionContentForPlacedImage: () => {},
      savePlacement: () => {},
    });
    vm.runInContext(`${placementSource}\nthis.applyAssets = factoryApplySelectedAssetsToSections;`, context);
    context.applyAssets(factory);
    return state.detailImageBlocks;
  };
  const autoId = `factory_detail_${d50Id}`;
  const untouchedAuto = { id: autoId, afterSectionId: 'material_tech', dataUrl: d50, label: 'D50', source: '조립공장', factoryAssetId: d50Id };
  assert.equal(apply([untouchedAuto]).some(block => block.id === autoId), false, 'legacy exact auto D50 block은 새 주 이미지와 중복되면 안 됩니다.');

  const movedCaptioned = {
    ...untouchedAuto,
    afterSectionId: 'use_scenarios',
    label: '사용자 D50 캡션',
    caption: '보존',
    metadata: { operatorEdited: true },
  };
  const preserved = apply([movedCaptioned]).find(block => block.id === autoId);
  assert.deepEqual(
    { afterSectionId: preserved?.afterSectionId, label: preserved?.label, caption: preserved?.caption, metadata: preserved?.metadata },
    { afterSectionId: 'use_scenarios', label: '사용자 D50 캡션', caption: '보존', metadata: { operatorEdited: true } },
    '같은 factoryAssetId여도 사용자 이동·caption·metadata block은 삭제하면 안 됩니다.',
  );
});

test('Cafe24 현재 상세 HTML은 충돌 컷의 주 이미지와 추가 블록을 모두 보존한다', () => {
  const payloadSource = source('src/cafe24-payloads.js');
  const resolverSource = sourceSlice(
    payloadSource,
    'function factoryCafe24CurrentScopedDetailHtml(',
    'function factoryCafe24GeneratedDetailHtml(',
  );
  const d50 = 'data:image/png;base64,RDUw';
  const ef = 'data:image/png;base64,RUY=';
  const currentHtml = `<section><img src="${d50}" alt="소재 기술"></section><div><img src="${ef}" alt="EF lifestyle"></div>`;
  const resolve = (cutAssets, selectedDetail = false) => {
    const factory = {
      detailPlacement: Object.fromEntries(cutAssets.map(asset => [asset.id, 'material_tech'])),
      assets: [...cutAssets, ...(selectedDetail ? [{ id: 'detail-selected', stageId: 'detail', type: 'html', html: currentHtml, used: true }] : [])],
      product: {},
      stages: { detail: { selectedAssetIds: selectedDetail ? ['detail-selected'] : [] } },
    };
    const state = {
      analysis: {},
      sectionContents: { material_tech: { headline: '소재 기술' } },
      sectionImages: { material_tech: d50 },
      detailImageBlocks: [{ id: 'factory_detail_ef', afterSectionId: 'material_tech', dataUrl: ef, label: 'EF lifestyle', factoryAssetId: 'factory_cuts_mtzbwxqf_hyu0hi' }],
      cuts: { placement: { material_tech: 'factory:factory_cuts_mtzbwxqg_8dy8ms' } },
    };
    const context = vm.createContext({
      state,
      SECTIONS: [{ id: 'material_tech', name: '소재 기술' }],
      factoryRuntimeReadFactory: () => factory,
      factoryAssetDisplayImage: asset => asset.image || '',
      factoryCafe24StripDetailAdminLabels: html => html,
      factoryCurrentPreviewSectionStatus: () => ({ generated: 1, requiredSections: [{ id: 'material_tech' }], requiredIds: ['material_tech'], generatedIds: ['material_tech'] }),
      sectionWorkScopeMeta: () => ({}),
      factoryCafe24ResolveSectionScopeCheck: () => ({ ok: true, productKeyWarning: false, message: '' }),
      buildExportHtml: () => currentHtml,
      factoryCafe24DetailHtmlPreflight: () => ({ ok: true, hasAdminLabels: false, hasLightPlaceholder: false, adminLabelHits: [] }),
      factoryCafe24DetailForeignProductCheck: () => ({ ok: true, conflicts: [], locations: [], lockedLocations: [] }),
      escAttr: value => String(value),
    });
    vm.runInContext(`${resolverSource}\nthis.resolve = factoryCafe24CurrentScopedDetailHtml;`, context);
    return context.resolve(factory).html;
  };
  const d50Asset = { id: 'factory_cuts_mtzbwxqg_8dy8ms', stageId: 'cuts', image: d50, used: true, placedSectionId: 'material_tech' };
  const efAsset = { id: 'factory_cuts_mtzbwxqf_hyu0hi', stageId: 'cuts', image: ef, used: true, placedSectionId: 'material_tech' };

  for (const html of [resolve([d50Asset, efAsset]), resolve([efAsset, d50Asset]), resolve([efAsset, d50Asset], true), resolve([d50Asset, efAsset])]) {
    assert.equal((html.match(/RDUw/g) || []).length, 1, 'Cafe24 최종 HTML에 D50 주 이미지가 한 번 있어야 합니다.');
    assert.equal((html.match(/RUY=/g) || []).length, 1, 'Cafe24 최종 HTML에 EF 추가 블록이 한 번 있어야 합니다.');
  }
});
