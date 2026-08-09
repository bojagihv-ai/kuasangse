const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..', '..');

const SECTION_BASIS_MODES = [
  { id: 'current', label: '현재 지시문', shortLabel: '현재 지시문' },
  { id: 'combined', label: '총합버전', shortLabel: '총합' },
];
const SECTION_GENERATION_MODES = [
  { id: 'mixed', label: '이미지 생성 + 글자 따로', shortLabel: '이미지+글자 따로', desc: '개별 혼합 생성' },
  { id: 'full_image', label: '이미지+글자 전체 생성', shortLabel: '전체 이미지형', desc: '전체 이미지 생성' },
];

function renderHelpers(section) {
  return {
    ensureCurrentProductAnalysisForGeneration: () => {},
    ensureSectionWorkScopeCurrent: () => {},
    hasCurrentProductAnalysisForGeneration: () => true,
    productAnalysisGenerationBlockReason: () => '',
    orderedSections: () => [section],
    displayableImageSrc: () => '',
    getSectionGenerationModeInfo: () => SECTION_GENERATION_MODES[0],
    sectionBasisDisplayInfo: () => SECTION_BASIS_MODES[0],
    getSectionBasisModeInfo: id => SECTION_BASIS_MODES.find(mode => mode.id === id) || SECTION_BASIS_MODES[0],
    getSectionAssembly: () => ({ cutUsage: 'none' }),
    sectionAssemblyCutUsageInfo: () => ({ shortLabel: '안 씀' }),
    getSectionInstructionSourceInfo: () => ({ label: 'AI 자동', detail: '제품 분석 기준' }),
    getSectionResultSourceInfo: () => ({ label: '미생성', detail: '아직 결과 없음' }),
    getSectionBasisDetail: () => '현재 지시문 기준',
    sectionAssemblySourceSummary: () => '현재 지시문',
    renderSectionCompactPromptPreview: () => '',
    renderSectionCompetitorPlanNotice: () => '',
    renderSectionGeneratedImagePreview: () => '',
    renderSectionImageHelper: () => '',
    renderSectionBasisChooser: () => '',
    renderSectionBasisPromptCompare: () => '',
    renderSectionAssemblyPanel: () => '',
    renderSectionModeChooser: () => '',
    renderBrandStudioPanel: () => '',
    renderFixedDetailImagePanel: () => '',
    renderFactoryLightImage: () => '',
    renderAnalysisLog: () => '',
    renderImageDirectivesPanel: () => '',
    renderCompetitorTipBankSummary: () => '',
    renderSectionAssemblySummaryPanel: () => '',
    renderSectionBatchRunPanel: () => '',
    sectionBasisOptionLabel: mode => mode.label,
    disabledAttr: disabled => disabled ? 'disabled' : '',
    escAttr: value => String(value ?? '').replaceAll('"', '&quot;'),
    escapeHtml: value => String(value ?? ''),
    SECTION_BASIS_MODES,
    SECTION_GENERATION_MODES,
  };
}

function baseView(overrides = {}) {
  return {
    sectionDriveUploadStatus: {},
    sectionGenerating: {},
    sectionContents: {},
    sectionLocks: {},
    sectionBatchSelection: {},
    sectionInstructions: {},
    activeSectionEdit: '',
    sectionBatchPreview: {
      basisMode: 'combined',
      basisLabel: '총합버전',
      generationMode: 'full_image',
      generationLabel: '이미지+글자 전체 생성',
    },
    ...overrides,
  };
}

test('미생성 카드는 개별 설정과 일괄 실행 예정값을 구조적으로 구분한다', async () => {
  const { renderSectionCards } = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', 'sections-menu-cards-view.mjs')).href);
  const section = { id: 'header', n: 1, icon: 'H', name: '헤더', desc: '첫 섹션', purpose: '상품명 강조' };
  const html = renderSectionCards(baseView(), renderHelpers(section));

  assert.match(html, /data-section-individual-settings="header"/);
  assert.match(html, /data-section-batch-preview="header"/);
  assert.match(html, /data-batch-basis="combined"/);
  assert.match(html, /data-batch-generation="full_image"/);
});

test('잠금 카드는 남은 섹션 일괄 실행 대상으로 표시하지 않는다', async () => {
  const { renderSectionCards } = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', 'sections-menu-cards-view.mjs')).href);
  const section = { id: 'specifications', n: 4, icon: 'S', name: '상세 스펙', desc: '사양', purpose: '정보' };
  const html = renderSectionCards(baseView({
    sectionLocks: { specifications: true },
  }), renderHelpers(section));

  assert.doesNotMatch(html, /data-section-batch-preview=\"specifications\"/);
  assert.match(html, /data-section-individual-settings=\"specifications\"/);
});

test('상단 일괄 실행 요약은 남은 개수와 실제 적용 모드를 함께 노출한다', async () => {
  const { renderSectionsView } = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', 'sections-menu-view.mjs')).href);
  const section = { id: 'header', n: 1, icon: 'H', name: '헤더', desc: '첫 섹션', purpose: '상품명 강조' };
  const view = baseView({
    analysis: null,
    auto: { driveConnected: false },
    competitorData: null,
    hiddenSectionIds: [],
    imagePreview: '',
    sectionBatchBasisMode: 'combined',
    sectionBatchGenerationMode: 'full_image',
    sectionBatchRun: null,
    sectionDriveFolderId: '',
  });
  const html = renderSectionsView(view, renderHelpers(section));

  assert.match(html, /data-section-batch-plan/);
  assert.match(html, /data-batch-basis="combined"/);
  assert.match(html, /data-batch-generation="full_image"/);
  assert.match(html, /동시 생성 최대 2장/);
  assert.match(html, /id="generateAllMissingSections"[^>]*>남은 1개 전체 생성<\/button>/);
});

test('생성 완료 또는 잠금 카드는 남은 섹션 일괄 실행 대상으로 표시하지 않는다', async () => {
  const { renderSectionCards } = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', 'sections-menu-cards-view.mjs')).href);
  const section = { id: 'specifications', n: 4, icon: 'S', name: '상세 스펙', desc: '사양', purpose: '정보' };
  const html = renderSectionCards(baseView({
    sectionContents: { specifications: { headline: '완료' } },
  }), renderHelpers(section));

  assert.doesNotMatch(html, /data-section-batch-preview="specifications"/);
  assert.match(html, /data-section-individual-settings="specifications"/);
});
