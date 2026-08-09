const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

test('모델 카드 선택은 새로고침 전에 modelConfig를 저장한다', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'src', 'menus', 'modelsettings-controller.mjs'),
    'utf8',
  );
  const start = source.indexOf('function updateModelConfig');
  const end = source.indexOf('\n  function operationStamp', start);
  assert.ok(start >= 0 && end > start, 'updateModelConfig source must be present');
  assert.match(
    source.slice(start, end),
    /savePreferences\(\{\s*modelConfig:/,
    '모델 카드 선택은 저장 어댑터를 호출해야 한다',
  );
  const runtime = fs.readFileSync(path.join(ROOT, 'src', 'app-core-02.js'), 'utf8');
  const boot = fs.readFileSync(path.join(ROOT, 'src', 'app-core-03.js'), 'utf8');
  assert.match(runtime, /modelConfig:\s*state\.modelConfig/);
  assert.match(boot, /const _savedModelConfig = normalizeModelConfig\(loadModelConfig\(\)\)/);
});

test('경쟁사 분석 입력 화면은 상단 분석 LLM 선택과 변경 이벤트를 제공한다', () => {
  const view = fs.readFileSync(
    path.join(ROOT, 'src', 'menus', 'competitor-menu-view.mjs'),
    'utf8',
  );
  const menu = fs.readFileSync(
    path.join(ROOT, 'src', 'menus', 'competitor-menu.mjs'),
    'utf8',
  );
  assert.match(view, /data-comp-analysis-model/);
  assert.match(view, /analysisMatchSettings\.gptOAuthModel/);
  assert.match(menu, /['"]setGptOAuthModel['"]/);
  assert.match(menu, /compAnalysisGptOAuthModelSelect/);
});
