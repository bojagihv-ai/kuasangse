'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `source block must be extractable: ${startMarker}`);
  return source.slice(start, end);
}

test('저장 스냅샷은 assets가 메타데이터뿐이어도 lightweight의 경쟁사 분석 시각을 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const helper = sourceBetween(
    core02,
    'function lastWorkCompAnalysisTime(',
    'function getCurrentCompAnalysisTime(',
  );
  const context = vm.createContext({});
  vm.runInContext(`${helper}\nglobalThis.readAnalysisTime = lastWorkCompAnalysisTime;`, context);

  const snapshot = {
    savedAt: 300,
    assets: { compPage: { uploadedImages: [], evidenceImages: [] } },
    lightweight: {
      compPage: { analysisResult: { analyzedAt: 1234 }, savedAt: 1234 },
    },
  };

  assert.equal(context.readAnalysisTime(snapshot), 1234);
});

test('서버 복원은 assets 적용 여부와 무관하게 lightweight의 완료 분석을 별도로 복원한다', () => {
  const core02 = read('src/app-core-02.js');
  const applySource = sourceBetween(
    core02,
    'function applyServerLastWorkSnapshot(',
    'async function hydrateServerLastWorkSnapshot(',
  );

  assert.match(applySource, /lightweightCompPage/);
  assert.match(
    applySource,
    /applyCompAnalysisSnapshot\(\s*lightweightCompPage,/,
    'assets에 분석 본문이 없어도 lightweight 분석 복원 경계가 필요합니다.',
  );
});

test('완료 분석 새로고침은 assets에 본문이 없을 때 lightweight 분석을 선택하고 현재 선택은 읽기 전용으로 보존한다', () => {
  const core02 = read('src/app-core-02.js');
  const refreshSource = sourceBetween(
    core02,
    'async function refreshCompetitorAnalysisFromServer(',
    'async function saveSessionAssetsToDb(',
  );

  assert.match(refreshSource, /assetComp/);
  assert.match(refreshSource, /lightweightComp/);
  assert.match(
    refreshSource,
    /previousAnalysisViewOnly/,
    '현재 선택과 저장 분석이 다르면 이전 분석 읽기 전용 상태를 표시해야 합니다.',
  );
  assert.doesNotMatch(
    refreshSource,
    /if \(requiredSelection\?\.key[\s\S]*?\) \{\s*return false;\s*\}/,
    '선택이 다르다는 이유로 보존된 분석 자체를 불러오지 않으면 안 됩니다.',
  );
});

test('경쟁사 리포트 열기는 저장된 이전 분석을 읽기 전용으로 열고, 플랜 생성·적용은 현재 이미지 분석을 요구한다', () => {
  const core03 = read('src/app-core-03.js');
  const core05 = read('src/app-core-05.js');
  const openSource = sourceBetween(
    core03,
    "if (action === 'open-competitor-report')",
    "if (action === 'refresh-competitor-analysis')",
  );
  const guardSource = sourceBetween(
    core05,
    'function compMarketRequireCurrentImageAnalysis(',
    'function compMarketMarkSelectionChanged(',
  );

  assert.match(openSource, /allowPreviousResult:\s*true/);
  assert.match(guardSource, /allowPreviousResult/);
  assert.match(guardSource, /previousAnalysisViewOnly/);
});

test('분석 결과 리포트의 프리셋 저장 버튼과 저장 API는 계속 연결되어 있다', () => {
  const reportView = read('src/app-core-05.js');
  const menu = read('src/menus/competitor-menu.mjs');
  const core03 = read('src/app-core-03.js');

  assert.match(reportView, /data-comp-style-save/);
  assert.match(menu, /data-comp-style-save[\s\S]*?call\('applyStylePreset', true\)/);
  assert.match(core03, /function applyCompetitorStylePreset\(saveAsPreset = false\)/);
  assert.match(core03, /saveBrandPresets\(state\.brandPresets\)/);
});

test('GPT OAuth 경쟁사 이미지 입력은 원본을 보존하면서 지나치게 큰 캡처만 분석 전송용으로 축소한다', () => {
  const core01 = read('src/app-core-01.js');
  const scaleSource = sourceBetween(
    core01,
    'function gptOAuthVisionImageScale(',
    'async function compactGptOAuthVisionImage(',
  );
  const context = vm.createContext({ Math });
  vm.runInContext(`${scaleSource}\nglobalThis.scaleImage = gptOAuthVisionImageScale;`, context);

  const tall = context.scaleImage(1905, 39323);
  assert.equal(tall.changed, true);
  assert.ok(tall.width < 1905 && tall.height < 39323);
  const normal = context.scaleImage(1905, 7877);
  assert.equal(normal.width, 1905);
  assert.equal(normal.height, 7877);
  assert.equal(normal.changed, false);
  assert.match(
    core01,
    /const preparedImages = await prepareGptOAuthVisionImages\(imagesArray\)/,
    '경쟁사 분석은 저장된 원본이 아니라 분석 전송용 파생 이미지를 사용해야 합니다.',
  );
});
