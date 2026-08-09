const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const detailScraper = fs.readFileSync(
  path.join(root, 'output/vm-rebuild/source-stage/JepumScraper/services/detail_scraper.py'),
  'utf8',
);
const catalogResolver = detailScraper.match(
  /def _resolve_naver_catalog_to_seller\(\) -> bool:([\s\S]*?)\n\s+def _rebuild_naver_detail_page_via_bookmarklet/,
)?.[1] || '';

assert.ok(catalogResolver, '네이버 카탈로그 판매처 탐색 함수를 찾을 수 있어야 합니다.');
assert.ok(
  (catalogResolver.match(/_check_naver_human_intervention\(\)/g) || []).length >= 2,
  '네이버 카탈로그 판매처 탐색 중에도 영수증 확인을 즉시 중단해야 합니다.',
);

console.log('VM_NAVER_CATALOG_MANUAL_GATE_PASS');
