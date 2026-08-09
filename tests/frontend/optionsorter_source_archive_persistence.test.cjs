const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const persistenceSource = fs.readFileSync(path.join(root, 'src', 'app-core-02.js'), 'utf8');
const optionSource = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(root, 'src', 'app-core-03.js'), 'utf8');
const appHtml = fs.readFileSync(path.join(root, 'app.html'), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('lightweight option state keeps local archive references after inline image compaction', () => {
  const body = sourceSlice(
    persistenceSource,
    'function stripOptionSorterImages(',
    'function buildLightweightSessionPayload(',
  );
  const stripOptionSorterImages = new Function(`${body}; return stripOptionSorterImages;`)();
  const compact = stripOptionSorterImages({
    images: [{
      id: 'source-1',
      name: '핑크',
      mime: 'image/png',
      base64: 'heavy-inline',
      preview: 'data:image/png;base64,heavy-inline',
      archiveId: 'archive-source-1',
      imageUrl: '/api/local-archive/assets/archive-source-1/image',
      imagePersistence: 'local-archive-url',
      sourceType: 'option-sorter-source-upload',
      localArchive: { archiveId: 'archive-source-1', saved: true },
    }],
  });

  assert.deepEqual(compact.images, [{
    id: 'source-1',
    name: '핑크',
    mime: 'image/png',
    hasImageData: true,
    archiveId: 'archive-source-1',
    imageUrl: '/api/local-archive/assets/archive-source-1/image',
    imagePersistence: 'local-archive-url',
    sourceType: 'option-sorter-source-upload',
    localArchive: { archiveId: 'archive-source-1', saved: true },
  }]);
});

test('option source upload has immediate archive and same-work restore paths', () => {
  assert.match(optionSource, /function optArchiveSourceImage\(/);
  assert.match(optionSource, /function optRestoreSourceImagesFromLocalArchive\(/);
  assert.match(optionSource, /OPTION_SORTER_SOURCE_ARCHIVE_TYPE\s*=\s*['"]option-sorter-source-upload['"]/);
  assert.match(optionSource, /factoryBackendArchiveAsset\([^,]+,\s*OPTION_SORTER_SOURCE_ARCHIVE_TYPE\)/);
  assert.match(optionSource, /value\.reason/);
  assert.match(controllerSource, /restoreArchivedSourceImages:\s*optRestoreSourceImagesFromLocalArchive/);
});

test('archived option source references clear the stale browser restore warning', () => {
  const restoreCounter = sourceSlice(
    persistenceSource,
    'function countSessionAssetRestoreRefs(',
    'function wasStorageWarningDismissed(',
  );
  assert.match(restoreCounter, /\['base64', 'preview', 'dataUrl', 'imageUrl', 'archiveId', 'localArchive'\]/);
});

test('archived option results use their local archive image for card, preview, and download', () => {
  assert.match(optionSource, /function factoryOptionSorterResultDisplayImage\(/);
  assert.match(optionSource, /const resultImage = factoryOptionSorterResultDisplayImage\(result, factory\);/);
  assert.match(optionSource, /\$\{resultImage\s*\?\s*`<img src="\$\{resultImage\}"/);
  assert.match(optionSource, /const image = factoryOptionSorterResultDisplayImage\(result\);/);
});

test('past option results reconnect to an exact local archive result ID on menu entry', () => {
  assert.match(optionSource, /function optRestoreGeneratedResultsFromLocalArchive\(/);
  assert.match(optionSource, /record\?\.optionResultId/);
  assert.match(optionSource, /result\.archiveId = archiveId/);
  assert.match(optionSource, /optRestoreGeneratedResultsFromLocalArchive\(\)/);
});

test('옵션 매칭 풀은 확대 버튼과 충분한 썸네일 크기를 제공한다', () => {
  assert.match(optionSource, /class="opt-card-preview" data-opt-preview-img=/);
  assert.match(optionSource, /class="opt-source-plus"/);
  assert.match(appHtml, /\.opt-pool-list \.opt-dc\{width:104px;height:104px/);
  assert.match(appHtml, /\.opt-card-preview\{[^}]*cursor:zoom-in/);
  assert.match(appHtml, /\.opt-source-plus\{[^}]*opacity:0/);
  assert.match(appHtml, /\.opt-card-preview\{[^}]*opacity:0/);
  assert.match(appHtml, /\.opt-source-card:hover \.opt-source-plus/);
  assert.match(appHtml, /\.opt-dc:hover \.opt-card-preview/);
});

test('옵션 보관본 복원은 메뉴 진입 중 전체 작업파일 deep save를 기다리지 않는다', () => {
  const resultStart = optionSource.indexOf('async function optRestoreGeneratedResultsFromLocalArchive');
  const sourceStart = optionSource.indexOf('async function optRestoreSourceImagesFromLocalArchive');
  const archiveHelpersStart = optionSource.indexOf('function optArchiveSupported');
  assert.ok(resultStart >= 0 && sourceStart > resultStart && archiveHelpersStart > sourceStart);
  assert.doesNotMatch(optionSource.slice(resultStart, sourceStart), /saveLastWorkNow\(\{\s*force:\s*true,\s*deep:\s*true\s*\}\)/);
  assert.doesNotMatch(optionSource.slice(sourceStart, archiveHelpersStart), /saveLastWorkNow\(\{\s*force:\s*true,\s*deep:\s*true\s*\}\)/);
});

test('옵션 이미지 미리보기는 위임된 닫기와 바깥 배경 닫기 및 detached overlay 정리를 보장한다', () => {
  const previewHandler = sourceSlice(
    optionSource,
    'function handleOptionSorterPreviewClick',
    'function bindOptionSorterPreviewDelegation',
  );
  assert.match(optionSource, /data-opt-preview-close/);
  assert.match(optionSource, /data-opt-preview-backdrop/);
  assert.match(previewHandler, /optImagePreviewOverlay.*remove/);
  assert.match(previewHandler, /event\.target === backdrop/);
});
