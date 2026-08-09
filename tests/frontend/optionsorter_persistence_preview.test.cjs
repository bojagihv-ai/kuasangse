'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const APP_CORE_06 = path.join(ROOT, 'src', 'app-core-06.js');
const GENERATION_BINDINGS = path.join(ROOT, 'src', 'menus', 'optionsorter-generation-bindings.mjs');
const VIEW = path.join(ROOT, 'src', 'menus', 'optionsorter-view.mjs');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('OPTIONS-RESULT-RELOAD: 보관 아카이브가 가진 누락 결과 레코드도 복원 경로가 유지된다', () => {
  const source = fs.readFileSync(APP_CORE_06, 'utf8');
  const restore = sourceSlice(
    source,
    'async function optRestoreGeneratedResultsFromLocalArchive()',
    'async function optRestoreSourceImagesFromLocalArchive()',
  );
  assert.match(restore, /optionResultId/);
  assert.match(restore, /optionResults\.push/);
  assert.match(restore, /imageUrl/);
  assert.match(restore, /currentRunId/);
});

test('OPTIONS-RESULT-SAVE: 생성 결과 완료 경계에서 비동기 저장을 기다린다', () => {
  const source = fs.readFileSync(APP_CORE_06, 'utf8');
  const generation = sourceSlice(
    source,
    'async function optGenerateOptionImages()',
    '\nfunction optDownloadOptionResult',
  );
  assert.match(generation, /await optPersistGeneratedResultState\(\)/);
});

test('OPTIONS-PREVIEW: 결과 크게 보기 버튼은 직접 미리보기 API를 호출하고 sort 화면에 모달을 포함한다', () => {
  const bindings = fs.readFileSync(GENERATION_BINDINGS, 'utf8');
  assert.match(bindings, /optOpenImagePreview/);
  assert.match(bindings, /optOpenImagePreview\(null, resultId\)/);

  const view = fs.readFileSync(VIEW, 'utf8');
  const sortView = sourceSlice(view, "if (os.subStep === 'sort')", "  // ── 업로드 화면");
  assert.match(sortView, /renderOptionSorterImagePreviewModal\(os\)/);
});
