const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const optionSource = fs.readFileSync(path.join(root, 'src', 'app-core-06.js'), 'utf8');

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test('옵션표 캔버스 합성은 cross-origin 로컬 아카이브 이미지를 안전하게 읽는다', () => {
  const loader = sourceSlice(optionSource, 'function loadImageElement(', 'function drawFittedImage(');
  const crossOriginIndex = loader.indexOf("img.crossOrigin = 'anonymous'");
  const srcIndex = loader.indexOf('img.src = src');
  assert.notEqual(crossOriginIndex, -1, 'Image crossOrigin 설정이 없습니다.');
  assert.notEqual(srcIndex, -1, 'Image src 할당이 없습니다.');
  assert.ok(crossOriginIndex < srcIndex, 'crossOrigin은 src 할당 전에 설정되어야 합니다.');
});

test('옵션 원본 아카이브 큐는 마지막 작업에서만 전체 렌더를 실행한다', () => {
  const archive = sourceSlice(optionSource, 'async function optArchiveSourceImage(', 'async function optRestoreGeneratedResultsFromLocalArchive(');
  assert.match(archive, /const archiveQueueDrained = OPT_SOURCE_ARCHIVE_PENDING_COUNT === 0/);
  assert.match(archive, /if \(archiveQueueDrained\) \{\s*optScheduleSave\(350\);\s*\}/);
  assert.match(archive, /if \(archiveQueueDrained && state\.step === 'optionsorter'\) render\(\);/);
  assert.doesNotMatch(archive, /if \(state\.step === 'optionsorter'\) render\(\);/);
});

test('옵션표 생성은 중복 실행을 단일 비행으로 차단한다', () => {
  const generation = sourceSlice(optionSource, 'async function optGenerateOptionImages()', 'function optDownloadOptionResult(');
  assert.match(generation, /ensureOptionSorterDefaults\(os\);\s*if \(os\.optionGenRunning\) return;/);
});

test('옵션표 생성은 로컬 아카이브 URL 원본을 AI 입력 payload로 복원한다', () => {
  const imagePart = sourceSlice(optionSource, 'async function optImageDataPart(', 'function optHasImagePayload(');
  assert.match(imagePart, /factoryLocalArchiveAssetImagePart/);
  const generation = sourceSlice(optionSource, 'async function optGenerateOptionImages()', 'function optDownloadOptionResult(');
  assert.ok(generation.includes('await optImageDataPart(sheet.pairs[0].img)'));
  assert.ok(generation.includes('await optImageDataPart(pair.img)'));
});
