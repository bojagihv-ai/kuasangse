'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');
const BOARD = fs.readFileSync(path.resolve(ROOT, 'control_tower/frontend/src/production-board.mjs'), 'utf8');

/**
 * 실측 2026-09-03: 생산관제를 연 채 화면을 재 보니 숨겨진 생산·A컷 보드가 보관 원본
 * 서른 장(21장이 1200~1840px)을 물고 있었다. 격자 칸은 100px 남짓으로 그린다.
 * 확대해서 볼 때만 원본이 필요하다.
 */

function gridThumbSource(value) {
  // 보드 소스에 있는 규칙을 그대로 꺼내 시험한다. 화면과 다른 규칙을 시험하면 의미가 없다.
  const pattern = BOARD.match(/const matched = source\.match\((\/.*\/)\);/);
  assert.ok(pattern, '보드에서 썸네일 규칙을 찾지 못했다');
  const regex = new RegExp(pattern[1].slice(1, pattern[1].lastIndexOf('/')));
  const width = Number((BOARD.match(/const GRID_THUMB_WIDTH = (\d+);/) || [])[1]);
  assert.ok(width > 0, '격자 썸네일 크기가 없다');
  const source = String(value || '');
  const matched = source.match(regex);
  return matched ? `${matched[1]}/thumbnail?w=${width}` : source;
}

test('격자 그림은 보관 원본 대신 작은 사본을 받는다', () => {
  assert.equal(
    gridThumbSource('/api/local-archive/assets/abc123/image'),
    '/api/local-archive/assets/abc123/thumbnail?w=320',
  );
  assert.equal(
    gridThumbSource('http://127.0.0.1:5050/api/local-archive/assets/abc123/image'),
    'http://127.0.0.1:5050/api/local-archive/assets/abc123/thumbnail?w=320',
  );
});

test('보관함이 아닌 주소는 손대지 않는다', () => {
  for (const untouched of [
    '/api/pdp/work-bundles/b1/assets/a1/thumbnail',
    '/api/factory/jobs/job-1/history/assets/archive-1/thumbnail',
    'data:image/png;base64,AAAA',
    '',
  ]) {
    assert.equal(gridThumbSource(untouched), untouched);
  }
});

test('확대해서 보는 길은 원본을 그대로 쓴다', () => {
  // 확대는 dataset.zoomSrc 로 간다. 그 자리에 썸네일을 넣으면 크게 봐도 흐리다.
  const zoomAssignments = [...BOARD.matchAll(/dataset\.zoomSrc = ([^;]+);/g)].map(match => match[1].trim());
  assert.ok(zoomAssignments.length >= 3, JSON.stringify(zoomAssignments));
  for (const value of zoomAssignments) {
    assert.doesNotMatch(value, /gridThumbSource|applyGridThumb/u, value);
  }
});

test('작은 사본을 못 받으면 원본으로 한 번 되돌린다', () => {
  // 사본 경로가 없는 백엔드에서도 격자가 비면 안 된다.
  const helper = BOARD.slice(BOARD.indexOf('function applyGridThumb'), BOARD.indexOf('function applyGridThumb') + 600);
  assert.match(helper, /addEventListener\('error'/u);
  assert.match(helper, /image\.src = assetUrl \? assetUrl\(original\) : original;/u);
  assert.match(helper, /retried/u);
});

test('격자와 후보 카드는 모두 이 규칙을 지난다', () => {
  // 직접 assetUrl(...) 로 보관 원본을 넣는 자리가 남아 있으면 규칙이 새는 것이다.
  const gridSites = [...BOARD.matchAll(/applyGridThumb\(image, ([^)]+)\)/g)]
    .map(match => match[1])
    .filter(argument => argument !== 'source'); // 헬퍼 정의 자신은 뺀다
  assert.deepEqual(gridSites, ['previewCandidate.thumbnailUrl', 'fallbackThumbUrl', 'thumbnail']);
  assert.match(BOARD, /assetUrl\(gridThumbSource\(cell\.selectedThumbnailUrl\)\)/u);
});

test('작업 자료 카드도 격자 크기에 맞는 사본을 쓰고, 실패하면 원본으로 되돌린다', async () => {
  const workbench = fs.readFileSync(path.resolve(ROOT, 'control_tower/frontend/src/production-workbench.mjs'), 'utf8');
  const moduleUrl = new URL(`file://${path.resolve(ROOT, 'control_tower/frontend/src/production-workbench.mjs').split(String.fromCharCode(92)).join('/')}`).href;
  const { archiveGridThumbSource } = await import(moduleUrl);
  assert.equal(
    archiveGridThumbSource('http://127.0.0.1:5050/api/local-archive/assets/abc/image'),
    'http://127.0.0.1:5050/api/local-archive/assets/abc/thumbnail?w=320',
  );
  assert.equal(
    archiveGridThumbSource('/api/pdp/work-bundles/b/assets/a/thumbnail'),
    '/api/pdp/work-bundles/b/assets/a/thumbnail',
  );
  // 되돌리는 순서가 있어야 한다: 작은 사본 → 원본 → 캐시 우회 → 실패 문구.
  const card = workbench.slice(workbench.indexOf('export function createWorkBundleAssetCard'));
  assert.match(card, /const smallUrl = archiveGridThumbSource\(imageUrl\);/u);
  assert.match(card, /const fallbacks = \[/u);
  assert.match(card, /const next = fallbacks\.shift\(\);/u);
  assert.match(card, /placeholder\.dataset\.broken = 'true';/u);
});
