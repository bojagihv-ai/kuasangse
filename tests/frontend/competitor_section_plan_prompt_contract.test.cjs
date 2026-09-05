const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { functionSource, readSourceLf } = require('./source_slice_utils.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CURRENT_PRODUCT_KEY = '양단호박바늘쌈';
const CURRENT_INPUT_FINGERPRINT = 'fixture-current-product-image';

function currentAnalysisFixture() {
  return {
    product_name: CURRENT_PRODUCT_KEY,
    productKey: CURRENT_PRODUCT_KEY,
    inputImageFingerprint: CURRENT_INPUT_FINGERPRINT,
  };
}

function helpers({ analysis = currentAnalysisFixture(), hasAnalysis = true } = {}) {
  return {
    ensureCurrentProductAnalysisForGeneration() {},
    hasCurrentProductAnalysisForGeneration: () => Boolean(
      hasAnalysis
      && analysis?.productKey === CURRENT_PRODUCT_KEY
      && analysis?.inputImageFingerprint === CURRENT_INPUT_FINGERPRINT
    ),
    orderedSections: () => [
      'header', 'hook', 'key_features', 'specifications', 'use_scenarios',
      'competitive_edge', 'material_tech', 'certifications', 'reviews',
      'size_color', 'promotion', 'shipping', 'faq', 'brand_story', 'cta_footer',
    ].map((id, index) => ({ id, n: index + 1, icon: 'S', name: `섹션 ${index + 1}` })),
    getSectionGenerationModeInfo: () => ({ id: 'full_image', label: '이미지+글자 전체 생성', desc: '전체 이미지형' }),
    sectionBasisDisplayInfo: () => ({ id: 'combined', label: '총합버전' }),
    getSectionBasisModeInfo: () => ({ id: 'combined', label: '총합버전' }),
    getSectionBasisDetail: () => '여러 소스를 종합합니다.',
    sectionBasisOptionLabel: mode => mode.label,
    renderPlanInstructionReadable: () => '<div data-readable-plan></div>',
    renderPlanImprovementBridge: () => '<div data-improvement-bridge></div>',
    getSectionPromptResolutionInfo: sectionId => ({
      version: 'section-prompt-v2',
      providerVersion: 'section-content-provider-v1',
      providerLabel: 'GPT OAuth',
      basisId: 'combined',
      basisLabel: '총합버전',
      modeId: 'full_image',
      modeLabel: '이미지+글자 전체 생성',
      requestInputs: `request-inputs:${sectionId}`,
      resolvedPrompt: `final-provider-payload:${sectionId}`,
      competitorStatus: '현재 경쟁사 분석 리포트와 섹션 플랜 반영',
      sources: [
        { id: 'product_analysis_db', label: '제품 분석/DB', active: true },
        { id: 'competitor_report', label: '경쟁사 리포트', active: true },
        { id: 'competitor_plan', label: '경쟁사 섹션 플랜', active: true },
      ],
    }),
    productAnalysisGenerationBlockReason: () => '현재 제품 분석이 필요합니다.',
    disabledAttr: (disabled, reason = '') => disabled ? `disabled title="${reason}"` : '',
    escAttr: value => String(value ?? '').replaceAll('"', '&quot;'),
    escapeHtml: value => String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    SECTION_BASIS_MODES: [
      { id: 'current', label: '현재 지시문' },
      { id: 'combined', label: '총합버전' },
    ],
    SECTION_GENERATION_MODES: [
      { id: 'mixed', label: '이미지 생성 + 글자 따로' },
      { id: 'full_image', label: '이미지+글자 전체 생성' },
    ],
  };
}

function view({ analysis = currentAnalysisFixture() } = {}) {
  const sectionIds = [
    'header', 'hook', 'key_features', 'specifications', 'use_scenarios',
    'competitive_edge', 'material_tech', 'certifications', 'reviews',
    'size_color', 'promotion', 'shipping', 'faq', 'brand_story', 'cta_footer',
  ];
  return {
    analysis,
    sectionContents: {},
    compPage: {
      sectionPlan: {
        recommended_sections: sectionIds.map(sectionId => ({
          section_id: sectionId,
          recommended_instructions: `${sectionId} 경쟁사 플랜`,
        })),
      },
      planEdits: {},
      sectionStatus: {},
    },
  };
}

test('제품 분석이 없어도 헤더를 포함한 모든 섹션의 개별 생성 버튼은 이유와 함께 보인다', async () => {
  globalThis.renderCompetitorFlowNav = () => '';
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', 'competitor-menu-plan-view.mjs')).href);
  const emptyView = view({ analysis: null });
  const html = module.renderCompetitorPlanView(emptyView, helpers({ analysis: emptyView.analysis, hasAnalysis: false }));

  const buttons = [...html.matchAll(/data-comp-gen-section="([^"]+)"[^>]*disabled/g)]
    .map(match => match[1]);
  assert.equal(buttons.length, 15);
  assert.deepEqual(buttons, [
    'header', 'hook', 'key_features', 'specifications', 'use_scenarios',
    'competitive_edge', 'material_tech', 'certifications', 'reviews',
    'size_color', 'promotion', 'shipping', 'faq', 'brand_story', 'cta_footer',
  ]);
  assert.match(html, /현재 제품 분석이 필요합니다/);
});

test('현재 제품 분석이 유효하면 헤더를 포함한 15개 개별 생성 버튼이 모두 활성화된다', async () => {
  globalThis.renderCompetitorFlowNav = () => '';
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', 'competitor-menu-plan-view.mjs')).href);
  const currentView = view();
  const html = module.renderCompetitorPlanView(
    currentView,
    helpers({ analysis: currentView.analysis, hasAnalysis: true }),
  );
  const buttonTags = [...html.matchAll(/<button[^>]*data-comp-gen-section="([^"]+)"[^>]*>/g)];

  assert.equal(buttonTags.length, 15);
  assert.deepEqual(buttonTags.map(match => match[1]), [
    'header', 'hook', 'key_features', 'specifications', 'use_scenarios',
    'competitive_edge', 'material_tech', 'certifications', 'reviews',
    'size_color', 'promotion', 'shipping', 'faq', 'brand_story', 'cta_footer',
  ]);
  buttonTags.forEach(match => assert.doesNotMatch(match[0], /\bdisabled\b/));
});

test('섹션 플랜 화면은 실제 런타임 프롬프트 버전·조립 소스·최종 프롬프트를 구분해 표시한다', async () => {
  globalThis.renderCompetitorFlowNav = () => '';
  const module = await import(pathToFileURL(path.join(ROOT, 'src', 'menus', 'competitor-menu-plan-view.mjs')).href);
  const html = module.renderCompetitorPlanView(view(), helpers());

  assert.match(html, /data-prompt-pipeline-version="section-prompt-v2"/);
  assert.match(html, /data-provider-prompt-version="section-content-provider-v1"/);
  assert.match(html, /data-prompt-basis="combined"/);
  assert.match(html, /data-prompt-source="competitor_report"[^>]*data-active="true"/);
  assert.match(html, /request-inputs:header/);
  assert.match(html, /final-provider-payload:header/);
  assert.match(html, /GPT OAuth/);
  assert.match(html, /경쟁사 섹션 플랜 원문 \(편집 가능\)/);
  assert.doesNotMatch(html, /위 내용을 반영한 최종 프롬프트 \(편집 가능\)/);
});

test('표시용 프롬프트 정보는 실제 생성과 동일한 조립 함수와 경쟁사 컨텍스트 함수를 사용한다', () => {
  const core = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  assert.match(core, /const SECTION_PROMPT_PIPELINE_VERSION = 'section-prompt-v2'/);
  assert.match(core, /function getSectionPromptResolutionInfo\(sectionId\)[\s\S]*const requestInputs = formatSectionGenerationRequestInputs\(contentPrompt, competitorReference\)[\s\S]*requestInputs,/);
  assert.match(core, /function getSectionPromptResolutionInfo\(sectionId\)[\s\S]*resolvedPrompt:\s*providerPrompt/);
  assert.match(core, /function getSectionPromptResolutionInfo\(sectionId\)[\s\S]*buildSectionContentProviderPrompt\(/);
  assert.match(core, /function getSectionPromptResolutionInfo\(sectionId\)[\s\S]*buildSectionCompetitorReferenceForPrompt\(sectionId, basis\.id\)/);
  assert.match(core, /function getSectionPromptResolutionInfo\(sectionId\)[\s\S]*hasCurrentProductAnalysisForGeneration\(\)[\s\S]*currentProductAnalysis/);
  assert.match(core, /buildSectionScopedAnalysisPayload\(sectionId, currentProductAnalysis\)/);
  assert.match(core, /function buildSectionCompetitorReferenceForPrompt\(sectionId,[\s\S]*getCompetitorPromptReportInfo\(\)\.report/);
  assert.match(core, /promptPipelineVersion:\s*SECTION_PROMPT_PIPELINE_VERSION/);
});

test('범위가 없거나 이전 상품인 경쟁사 리포트는 현재 생성 프롬프트에서 제외한다', () => {
  // 줄 끝은 readSourceLf 가 LF 로 맞춘다 — CRLF 작업본에서 `\n}\n` 을 못 찾던 거짓 실패 방지(2026-09-02).
  const core = readSourceLf(path.join(ROOT, 'src', 'app-core-03.js'));
  const match = functionSource(core, 'competitorPromptReportIsCurrent');
  assert.ok(match, 'competitorPromptReportIsCurrent 함수가 필요합니다.');
  const create = new Function('sectionWorkScopeMatches', `${match}; return competitorPromptReportIsCurrent;`);
  const isCurrent = create((reportScope, currentScope) => reportScope.scopeKey === currentScope.scopeKey);

  assert.equal(isCurrent(null, { scopeKey: 'product:a' }, false), false);
  assert.equal(isCurrent({ scopeKey: 'product:a' }, { scopeKey: '' }, false), false);
  assert.equal(isCurrent({ scopeKey: 'product:a' }, { scopeKey: 'product:b' }, false), false);
  assert.equal(isCurrent({ scopeKey: 'product:a' }, { scopeKey: 'product:a' }, true), false);
  assert.equal(isCurrent({ scopeKey: 'product:a' }, { scopeKey: 'product:a' }, false), true);
});

test('화면의 실제 생성 요청 입력에는 content prompt와 별도 competitor reference가 모두 포함된다', () => {
  const core = readSourceLf(path.join(ROOT, 'src', 'app-core-03.js'));
  const match = functionSource(core, 'formatSectionGenerationRequestInputs');
  assert.ok(match, 'formatSectionGenerationRequestInputs 함수가 필요합니다.');
  const format = new Function(`${match}; return formatSectionGenerationRequestInputs;`)();

  assert.equal(format('CONTENT', ''), '[section_content_prompt]\nCONTENT');
  assert.equal(
    format('CONTENT', 'COMPETITOR'),
    '[section_content_prompt]\nCONTENT\n\n[competitor_reference]\nCOMPETITOR',
  );
});

test('최종 provider prompt 미리보기와 실제 세 provider 실행은 같은 조립 함수를 사용한다', () => {
  const core = readSourceLf(path.join(ROOT, 'src', 'app-core-01.js'));
  const match = functionSource(core, 'buildSectionContentProviderPrompt');
  assert.ok(match, 'buildSectionContentProviderPrompt 함수가 필요합니다.');
  const create = new Function(
    'getEffectiveImageDirectives',
    'buildBrandPromptBlock',
    'buildLayoutPromptBlock',
    `${match}; return buildSectionContentProviderPrompt;`,
  );
  const build = create(() => ['로고 금지'], () => 'BRAND_BLOCK', () => 'LAYOUT_BLOCK');
  const prompt = build(
    { name: '헤더', n: 1, purpose: '첫인상' },
    { product_name: '양단호박바늘쌈' },
    'CONTENT_PROMPT',
    'COMPETITOR_REFERENCE',
    { variant: 'gpt_oauth' },
  );

  assert.match(prompt, /Section-scoped product facts:[\s\S]*양단호박바늘쌈/);
  assert.match(prompt, /Section to create: 헤더/);
  assert.match(prompt, /User custom instructions: CONTENT_PROMPT/);
  assert.match(prompt, /Competitor Reference: COMPETITOR_REFERENCE/);
  assert.match(prompt, /STRICT USER CONSTRAINTS:[\s\S]*로고 금지/);
  assert.match(prompt, /BRAND_BLOCK/);
  assert.match(prompt, /LAYOUT_BLOCK/);
  assert.match(prompt, /Return ONLY JSON:/);
  assert.equal((core.match(/const prompt = buildSectionContentProviderPrompt\(/g) || []).length, 3);
});

test('섹션 플랜 화면은 숨김·자동 제외 여부와 무관하게 전체 섹션 정의를 요청한다', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'menus', 'competitor-menu-plan-view.mjs'),
    'utf8',
  );
  assert.match(source, /orderedSections\(\{\s*includeHidden:\s*true,\s*includeAutoExcluded:\s*true\s*}\)/);
});
