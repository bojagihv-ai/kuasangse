const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const core05 = read('src/app-core-05.js');
const core06 = read('src/app-core-06.js');
const mainPy = read('output/vm-rebuild/source-stage/JepumScraper/main.py');
const detailScraper = read('output/vm-rebuild/source-stage/JepumScraper/services/detail_scraper.py');
const loginAhk = read('output/vm-rebuild/source-stage/JepumScraper/tools/naver_login_click_v2.ahk');
const bootstrap = read('tools/bootstrap_jepumscraper_vm_worker.ps1');

assert.match(core05, /manualIntervention:\s*null/, '상세수집 상태에 수동 개입 슬롯이 있어야 합니다.');
assert.match(core05, /function compMarketLegacyManualInterventionFromText/, '구작업의 추가 확인 로그도 수동 개입 상태로 복구해야 합니다.');
assert.match(core05, /renderCompMarketManualInterventionPanel/, '수동 개입 패널 렌더러가 있어야 합니다.');
assert.match(core05, /data-factory-manual-intervention/, '전광판에도 수동 개입 경고가 노출되어야 합니다.');
assert.match(core05, /compMarketManualResume/, '같은 상세수집 작업 재개 버튼이 있어야 합니다.');
assert.match(core06, /function compMarketManualInterventionFromInfo/, 'VM 수동 개입 상태 변환기가 있어야 합니다.');
assert.match(core06, /async function compMarketResumeDetailJob/, '같은 상세수집 작업 재개 함수가 있어야 합니다.');
assert.match(core06, /resume-comp-market-detail/, '전광판에서 같은 VM 상세수집 작업 재개를 호출해야 합니다.');
assert.match(core06, /manualStatusDetected/, '수동 대기 결과를 결과 API 호출로 덮어쓰지 않아야 합니다.');
assert.match(mainPy, /manual_resume_requested/, 'VM 작업에 사람 조치 후 재개 플래그가 있어야 합니다.');
assert.match(mainPy, /detail-captures\/.*resume|api_v1_resume_detail_capture/, '상세수집 재개 API가 있어야 합니다.');
assert.match(bootstrap, /services\\vm_capture_client\.py/, 'VM 워커 부트스트랩은 상세수집 전송 모듈도 최신 소스로 동기화해야 합니다.');
assert.match(detailScraper, /bodyText/, '네이버 본문 기반 화면 판정이 있어야 합니다.');
assert.match(detailScraper, /정답을 입력|영수증|보안 확인을 완료해 주세요/, '영수증/보안확인 화면 마커를 판정해야 합니다.');
assert.match(detailScraper, /def _has_naver_human_markers/, '네이버 사람 확인 판정을 재사용 가능한 검사로 묶어야 합니다.');
assert.match(detailScraper, /def _check_naver_human_intervention/, '캡처 진입/루프에서 늦게 나타난 네이버 사람 확인 화면을 재검사해야 합니다.');
assert.ok(
  (detailScraper.match(/_has_naver_human_markers\(dom_body_lower\)/g) || []).length >= 3,
  '로그인 전·로그인 폴링 중·재탐색 직후에 사람 확인 화면을 다시 검사해야 합니다.',
);
assert.ok(
  (detailScraper.match(/_check_naver_human_intervention\(\)/g) || []).length >= 3,
  '네이버 캡처 진입과 캡처 루프에서 늦은 사람 확인 화면을 재검사해야 합니다.',
);
assert.match(loginAhk, /A_Args\[1\]/, '네이버 로그인 자동 클릭은 VM에서 감지한 대상 창을 우선 사용해야 합니다.');
assert.match(loginAhk, /wX \+ 20/, '네이버 로그인 버튼은 전체 콘텐츠 영역에서 찾아야 합니다.');
assert.match(loginAhk, /wX \+ wW - 20/, '네이버 로그인 버튼의 우측 탐색 경계가 있어야 합니다.');
assert.match(bootstrap, /api\/v1\/health/, 'VM 워커 재사용 전에 인증 상태를 확인해야 합니다.');
assert.match(bootstrap, /auth\.enabled/, '오래된 인증 활성 워커를 정상 VM 워커로 오인하지 않아야 합니다.');
assert.match(bootstrap, /Get-NetTCPConnection\s+-LocalPort\s+\$Port/, '오래된 VM 워커를 교체할 때 포트 점유 프로세스를 찾아야 합니다.');
assert.match(bootstrap, /Stop-Process\s+-Id\s+\$listenerPid/, '오래된 인증 활성 VM 워커를 종료한 뒤 새 환경으로 시작해야 합니다.');

console.log('VM_MANUAL_INTERVENTION_V181_PASS');
