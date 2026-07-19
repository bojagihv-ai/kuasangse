const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const detailScraper = read('output/vm-rebuild/source-stage/JepumScraper/services/detail_scraper.py');
const loginAhk = read('output/vm-rebuild/source-stage/JepumScraper/tools/naver_login_click_v2.ahk');
const bootstrap = read('tools/bootstrap_jepumscraper_vm_worker.ps1');

assert.match(
  detailScraper,
  /login_click_ok\s*=\s*_run_ahk_naver_login_click\(hwnd=hwnd_target/,
  '네이버 로그인 클릭 결과를 호출부에서 받아야 합니다.',
);
assert.match(
  detailScraper,
  /"login_click_attempted":\s*True/,
  '로그인 클릭 시도를 상세수집 진단에 남겨야 합니다.',
);
assert.match(
  detailScraper,
  /"login_click_succeeded":\s*bool\(login_click_ok\)/,
  '로그인 클릭 성공 여부를 상세수집 진단에 남겨야 합니다.',
);
assert.match(
  detailScraper,
  /login_click_attempts\s*<\s*2/,
  '첫 클릭 뒤에도 로그인 화면이면 두 번째 클릭까지만 허용해야 합니다.',
);
assert.match(
  detailScraper,
  /login_click_retry_attempted/,
  '두 번째 로그인 클릭 시도도 상세수집 진단에 남겨야 합니다.',
);
assert.match(
  loginAhk,
  /A_Args\[1\]/,
  'AHK는 호출부가 전달한 Chrome HWND를 우선 사용해야 합니다.',
);
assert.match(
  loginAhk,
  /sT\s*:=\s*btnCenterY/,
  '녹색 픽셀 탐색은 로그인 버튼 중심보다 위를 훑으면 안 됩니다.',
);
assert.match(
  loginAhk,
  /sB\s*:=\s*btnCenterY\s*\+\s*140/,
  '녹색 픽셀 탐색은 로그인 버튼 아래쪽까지만 제한해야 합니다.',
);
assert.match(
  bootstrap,
  /naver_login_click_v2\.ahk/,
  'VM 부트스트랩은 최신 네이버 로그인 클릭 스크립트를 동기화해야 합니다.',
);
assert.match(
  detailScraper,
  /local_app_data\s*=\s*os\.getenv\("LOCALAPPDATA", ""\)/,
  'VM 사용자별 AutoHotkey 설치 경로를 탐색해야 합니다.',
);
assert.match(
  bootstrap,
  /function Ensure-AutoHotkey/,
  'VM 부트스트랩은 AutoHotkey 의존성을 보장해야 합니다.',
);
assert.match(
  bootstrap,
  /AutoHotkey\.AutoHotkey/,
  'VM 부트스트랩은 공식 AutoHotkey 패키지를 사용해야 합니다.',
);

console.log('VM_LOGIN_CLICK_V183_PASS');
