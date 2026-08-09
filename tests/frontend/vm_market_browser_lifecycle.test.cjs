const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..', '..');
const stagedRoot = path.join(root, 'output', 'vm-rebuild', 'source-stage', 'JepumScraper');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readStaged(relativePath) {
  return fs.readFileSync(path.join(stagedRoot, relativePath), 'utf8');
}

function pythonFunction(source, name) {
  const start = source.indexOf(`def ${name}(`);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const next = source.indexOf('\ndef ', start + 1);
  const nextClass = source.indexOf('\nclass ', start + 1);
  const boundaries = [next, nextClass].filter(index => index !== -1);
  const end = boundaries.length ? Math.min(...boundaries) : source.length;
  return source.slice(start, end);
}

test('CDP로 붙은 쿠팡·옥션 Chrome은 수집기가 종료하지 않는다', () => {
  const coupang = readStaged(path.join('scrapers', 'coupang_scraper.py'));
  const auction = readStaged(path.join('scrapers', 'auction_scraper.py'));

  for (const name of [
    '_run_coupang_ui_search',
    '_scrape_coupang_assisted_current_page',
    '_has_coupang_debug_page',
  ]) {
    assert.doesNotMatch(
      pythonFunction(coupang, name),
      /\bbrowser\.close\(\)/,
      `${name}는 connect_over_cdp로 연결한 원격 Chrome을 닫으면 안 됩니다.`,
    );
  }

  for (const name of [
    '_has_auction_debug_page',
    '_open_auction_search_page',
    '_scrape_auction_assisted_current_page',
  ]) {
    assert.doesNotMatch(
      pythonFunction(auction, name),
      /\bbrowser\.close\(\)/,
      `${name}는 connect_over_cdp로 연결한 원격 Chrome을 닫으면 안 됩니다.`,
    );
  }
});

test('11번가 persistent context와 browser 정리는 각각 정확히 한 번만 수행한다', () => {
  const elevenst = readStaged(path.join('scrapers', 'elevenst_scraper.py'));

  assert.doesNotMatch(
    elevenst,
    /except PwTimeout:[\s\S]{0,300}await browser\.close\(\)/,
    'persistent context 경로에서 browser=None인 상태로 close하면 안 됩니다.',
  );
  assert.equal(
    (elevenst.match(/await ctx\.close\(\)/g) || []).length,
    1,
    '11번가 context는 finally에서 한 번만 닫아야 합니다.',
  );
  assert.match(
    elevenst,
    /if browser:\s*\n\s*try:\s*\n\s*await browser\.close\(\)/,
  );
  assert.match(elevenst, /self\.last_status\s*=\s*["']error["']/);
});

test('VM 부팅 동기화 목록에 변경한 마켓 수집기 3개가 포함된다', () => {
  const bootstrap = read('tools/bootstrap_jepumscraper_vm_worker.ps1');
  for (const relativePath of [
    'scrapers\\coupang_scraper.py',
    'scrapers\\auction_scraper.py',
    'scrapers\\elevenst_scraper.py',
  ]) {
    assert.ok(
      bootstrap.includes(`Relative = '${relativePath}'`),
      `${relativePath}가 VM 워커 동기화 목록에 있어야 합니다.`,
    );
  }
});

test('VM 의존성 마커가 있어도 Playwright greenlet 런타임을 실제 import 검증한다', () => {
  const bootstrap = read('tools/bootstrap_jepumscraper_vm_worker.ps1');

  assert.match(
    bootstrap,
    /import greenlet; from playwright\.sync_api import sync_playwright/,
    '설치 마커만 믿지 말고 Playwright와 greenlet을 실제로 import해야 합니다.',
  );
  assert.match(
    bootstrap,
    /--force-reinstall[\s\S]{0,120}'greenlet'/,
    'greenlet 바이너리가 깨졌을 때 requirement satisfied로 건너뛰지 않고 복구 설치해야 합니다.',
  );
  assert.match(
    bootstrap,
    /Remove-Item -LiteralPath \$dependencyMarker/,
    '런타임 import 실패 시 잘못된 의존성 완료 마커를 제거해야 합니다.',
  );
});
