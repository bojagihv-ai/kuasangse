'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const INTAKE = fs.readFileSync(path.resolve(ROOT, 'control_tower/frontend/src/bulk-intake.mjs'), 'utf8');

/**
 * 실측 2026-09-03: 조작자가 사진을 넣고 "작업 큐에 투입" 을 눌렀더니, 어떤 이미지 모델로
 * 어떤 자동화 방식으로 진행되는지 한 번도 보지 못한 채 곧바로 큐에 들어갔다. 두 값은 사실
 * 화면에 없는 숨은 옛 폼(#image-model-select, #batch-policy · manual-intake-panel, hidden)
 * 에서 조용히 읽혀 왔다. "자동 수동 선택하는것도 나 한번도 인식하지못했어."
 */
test('이미지 모델과 자동화 방식은 이 화면 자체의 보이는 컨트롤에서만 읽는다', () => {
  assert.doesNotMatch(INTAKE, /getElementById\('image-model-select'\)\?\.value/u);
  assert.doesNotMatch(INTAKE, /getElementById\('batch-policy'\)\?\.value/u);
  assert.match(INTAKE, /imageModelSelect\.id = 'bulk-image-model-select';/u);
  assert.match(INTAKE, /policySelect\.id = 'bulk-automation-preset-select';/u);
  assert.match(INTAKE, /const imageModel = imageModelSelect\.value \|\| '';/u);
  assert.match(INTAKE, /preset: String\(policySelect\.value \|\| ''\)\.trim\(\) \|\| 'full_auto',/u);
});

test('자동화 방식마다 무엇을 대신 정하는지 사람 말로 설명한다', () => {
  assert.match(INTAKE, /full_auto: '대표·사이즈·색상옵션·이미지컷·섹션·최종 상세페이지까지 전부 AI가 고릅니다/u);
  assert.match(INTAKE, /custom: '아래 공정별 설정과 각 제품의 개별 설정을 적용합니다\.'/u);
  assert.doesNotMatch(INTAKE, /automation\.snapshotRequest|automation\.snapshot\s*=/u);
});

test('첫 클릭은 확인만 하고, 진짜 투입은 두 번째 클릭에서 일어난다', () => {
  const start = INTAKE.indexOf('function onClick');
  const end = INTAKE.indexOf("root.addEventListener('click', onClick)", start);
  assert.ok(start >= 0 && end > start);
  const onClick = INTAKE.slice(start, end);
  assert.match(onClick, /if \(!confirmState \|\| confirmState\.scope !== scope \|\| version !== inputVersion\) \{/u);
  assert.match(onClick, /confirmState = \{ entries, groups: rows\.map\(row => row\.group\), scope, version: inputVersion, judgment, imageModel,/u);
  assert.match(onClick, /render\(\);\s*return;/u);
  assert.match(onClick, /void submitPlan\(confirmState\);/u);
  assert.match(onClick, /judgment = await getJudgmentSettings\?\.\(\)/u);
  assert.match(onClick, /JSON\.stringify\(confirmState\.judgment\) !== JSON\.stringify\(judgment\)/u);
});

test('선택/전체는 하나의 확인본을 전송하며 선택은 공통값을 적용하지 않는다', () => {
  assert.match(INTAKE, /submitSelected\.id = 'bulk-queue-submit-selected'/u);
  assert.match(INTAKE, /submit\.dataset\.queueScope = 'all'/u);
  assert.match(INTAKE, /submitSelected\.dataset\.queueScope = 'selected'/u);
  const submit = INTAKE.slice(INTAKE.indexOf('async function submitPlan'), INTAKE.indexOf('async function onImagePick'));
  assert.match(submit, /const \{ entries, groups \} = confirmed/u);
  assert.doesNotMatch(submit, /plan\.entries\.filter/u);
  const checkbox = INTAKE.slice(INTAKE.indexOf("commonTarget.addEventListener('change'"), INTAKE.indexOf('head.append(commonTarget)'));
  assert.match(checkbox, /invalidateConfirmation\(\)/u);
  assert.doesNotMatch(checkbox, /fillBulkProductRequiredValues|submitPlan/u);
});

test('확인 화면은 판단 모델·이미지 모델·자동화 방식과 파일명 그대로인 제품을 보여준다', () => {
  const renderer = INTAKE.slice(INTAKE.indexOf('function renderConfirmBox'), INTAKE.indexOf('function render() {'));
  assert.match(renderer, /이미지 생성 모델/u);
  assert.match(renderer, /자동화 방식/u);
  assert.match(renderer, /판단 모델 \(경쟁사·색상 등 AI 판단\)/u);
  assert.match(renderer, /looksLikeCameraFileName\(entry\.productName\)/u);
  assert.match(renderer, /그 이름으로 경쟁사도 검색됩니다/u);
});

test('투입이 실제로 시작되면 확인 상태를 지운다 — 중복 투입을 막는다', () => {
  const submit = INTAKE.slice(INTAKE.indexOf('async function submitPlan'), INTAKE.indexOf('async function submitPlan') + 500);
  assert.match(submit, /confirmState = null;/u);
});

test('확인창은 공통 전체 자동과 제품별 직접 선택을 구분해 설명한다', async () => {
  const vm = require('node:vm');
  const policy = await import('../../frontend/src/automation-policy-model.mjs');
  const { looksLikeCameraFileName } = await import('../../frontend/src/bulk-intake-model.mjs');
  const ids = Object.keys(policy.AUTOMATION_DECISIONS);
  const manualIds = ids.filter(id => !id.startsWith('competitor_') || id === 'competitor_product');
  const entries = [
    { productName: '공통 자동 제품', decisionOverrides: {} },
    { productName: '일부 직접 선택 제품', decisionOverrides: Object.fromEntries(manualIds.map(id => [id, 'manual'])) },
    { productName: '전부 직접 선택 제품', decisionOverrides: Object.fromEntries(ids.map(id => [id, 'manual'])) },
  ];
  const element = (tag, className = '', textContent = '') => ({
    tag, className, textContent, children: [], dataset: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener() {},
  });
  const confirmBox = element('div');
  const context = vm.createContext({
    element, confirmBox, looksLikeCameraFileName, ...policy, decisionOverrides: {},
    document: { createElement: tag => element(tag), getElementById: () => null },
    policyRegistry: { decisionPointIds: ids, presets: { full_auto: Object.fromEntries(ids.map(id => [id, 'auto'])) } },
    policySelect: { value: 'full_auto', selectedOptions: [{ textContent: '전체 자동' }] },
    imageModelSelect: { value: 'fixture-image-model', selectedOptions: [{ textContent: 'OpenAI' }] },
    confirmState: { entries, groups: entries.map(() => ({})), scope: 'all', excluded: 0,
      judgment: { model: 'fixture-judgment', reasoningEffort: 'low' } },
  });
  const presetCopy = INTAKE.match(/const AUTOMATION_PRESET_COPY = Object\.freeze\(\{[\s\S]*?\n\}\);/u);
  assert.ok(presetCopy);
  vm.runInContext([
    presetCopy[0],
    INTAKE.slice(INTAKE.indexOf('function policyRequestFor'), INTAKE.indexOf('async function lockPolicy')),
    INTAKE.slice(INTAKE.indexOf('function labelledConfirmRow'), INTAKE.indexOf('function render() {')),
  ].join('\n'), context);
  const before = JSON.stringify({ entries, common: context.decisionOverrides, confirmation: context.confirmState });
  const flatten = node => [node, ...node.children.flatMap(flatten)];
  const readView = () => {
    context.renderConfirmBox();
    const nodes = flatten(confirmBox);
    return { labels: nodes.filter(node => node.tag === 'dt').map(node => node.textContent),
      explanation: nodes.find(node => node.className === 'bulk-automation-copy').textContent,
      summaries: nodes.filter(node => node.className === 'bulk-policy-confirm-summary').map(node => node.textContent) };
  };
  const view = readView();
  const policies = entries.map(entry => policy.resolveInputPolicy(context.policyRegistry, context.policyRequestFor(entry)));
  assert.deepEqual(policies.map(resolved => Object.values(resolved).filter(mode => mode === 'manual').length), [0, 10, 15]);
  assert.deepEqual(view.summaries, [
    '전 공정 AI 판단',
    `직접 선택: ${manualIds.map(id => policy.AUTOMATION_DECISIONS[id]).join(' · ')}`,
    `직접 선택: ${ids.map(id => policy.AUTOMATION_DECISIONS[id]).join(' · ')}`,
  ]);
  assert.deepEqual(readView(), view, '동일 상태의 반복 렌더는 같은 실효 정책을 보여야 한다');
  assert.equal(JSON.stringify({ entries, common: context.decisionOverrides, confirmation: context.confirmState }), before);
  console.log(JSON.stringify({ ...view, counts: policies.map(resolved => policy.inputPolicySummary(resolved, 'row')), stable: true, inputUnchanged: true }));
  assert.doesNotMatch(view.explanation, /전부 AI가 고릅니다|나머지는 AI가 고릅니다/u);
  assert.ok(view.labels.includes('공통 기본 자동화 방식'));
  assert.match(view.explanation, /제품별 설정.*공통 기본.*우선/u);
  assert.match(view.explanation, /실제 적용 방식.*아래 제품별 요약/u);
});
