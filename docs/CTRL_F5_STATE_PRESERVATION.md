# Ctrl+F5 작업상태 보존 기록

## 원인

새로고침 키가 데이터를 지우는 것이 아니라, 저장 payload가 `LOCAL_SESSION_MAX_CHARS`를 넘을 때 선택되는 축약 경로가 서로 다른 수준의 상태를 저장하고 있었습니다.

- `buildMinimalLocalSessionPayload`는 top-level DB 검색 후보와 검색어를 저장하지 않았습니다.
- `buildEmergencyLocalSessionPayload`는 DB/Cafe24 후보 배열·선택키와 경쟁사 VM `marketScrape`를 저장하지 않았습니다.
- 자산관 동기화가 실패한 경우 이 로컬 payload가 새 부팅의 유일한 복구원이 되어, 게이지와 단계는 남고 후보 화면만 0건으로 보였습니다.

## 수정

`src/app-core-02.js`의 minimal/emergency fallback에 다음을 보존하도록 했습니다.

- 신화사DB/Cafe24 후보, DB 검색어·색상 옵션
- `selectedDbCandidateKey`, `selectedCafe24CandidateKey`, 후보 해석 상태
- VM `compPage.marketScrape` 결과·선택 ID·상세 이미지 metadata
- factory 후보 mirror와 현재 작업 identity

## 검증 증거

- 실패 우선: `node --test tests/frontend/critical_state_fallback.test.cjs`에서 수정 전 minimal 후보 누락을 확인했습니다.
- 수정 후: 위 테스트 `1/1 통과`.
- 인접 회귀: `local_session_payload_selection.test.cjs`와 `task8_restore_lifecycle_behavior.test.cjs` 포함 `31/32 통과`; 격리 Chrome 조건을 요구하는 `workfile_identity_f5_restore.test.cjs` 1건은 사용자 backend가 격리 조건이어서 실행 거부되었습니다.
- 번들: `node tools/build_runtime_bundle.cjs` 및 `node --check src/app-core-02.js` 통과, runtime `v682`.
- 실제 사용자 Chrome(Default/호야 프로필)에서 v682를 적용한 뒤 물리 `Ctrl+F5`를 실행했습니다. 같은 탭에서 다시 읽은 값은 `신화사DB 후보 8건`, `Cafe24 후보 24건`, `VM 후보 14건 수집 완료`, `대표 1/1, 사이즈 1/3, 이미지컷 1/1`이었습니다.
- 실제 Chrome에서 `5 생성컷 선택` 탭을 직접 열어 `사용할 대표이미지 1개`, `사용할 사이즈이미지 1개`, `사용할 이미지컷 1개`가 다시 표시되는 것을 확인했습니다.

이제 Ctrl+F5는 명시적인 `새 작업`이 아닌 이상 후보·선택·VM 수집 결과를 빈 초안으로 바꾸지 않아야 합니다. `새 작업`만 의도적으로 전체 초기화 경계입니다.

## 선택적 신화사 자산 동기화 경고의 색상 분류

작업파일은 로컬에 저장됐지만 신화사 자산관 API가 일시적으로 실패하면 다음 저장 때 재시도하도록 보류합니다. 이 경고는 로컬 작업과 후보·이미지 보존 실패가 아니므로 조립공장 전체를 빨간 `실패`로 표시하면 안 됩니다.

- `src/app-core-03.js`의 동기화 경계는 `factoryLog(..., 'warn')`과 재시도 예약을 사용합니다.
- `src/app-core-05.js`의 goal 상태 분류는 `신화사 자산관 동기화 ... 실패/보류` 문구를 `확인 필요`로 처리하고, 신화사DB·VM 공정 자체의 실패 문구는 계속 `실패`로 처리합니다.
- 실패 우선 회귀는 `tests/frontend/task8_restore_lifecycle_behavior.test.cjs`에 고정했습니다.

## 선택적 동기화 경고 실제 Chrome 재검증 (2026-08-06)

- 사용자 Chrome Default/`호야` 프로필의 같은 앱 탭에서 새 번들 `v683`을 실제 `새 빌드 적용` 컨트롤로 활성화했습니다.
- 같은 실제 탭에 물리 `Ctrl+F5`를 보낸 뒤 read-back: `빌드 v683`, `title=확인 필요`, `pill=확인 필요 · 80%`, `border=rgba(245, 158, 11, 0.62)`, `background=rgba(245, 158, 11, 0.1)`, `syncStatus=자산관 사진: 전량 저장 보류`, `isRed=false`.
- 따라서 Ctrl+F5 뒤에도 동기화 보류는 노란 확인 필요로 남고, 전체 실패 빨간 상태로 승격되지 않습니다. 이 검증은 격리 브라우저나 HTTP 응답이 아니라 사용자 Chrome 화면의 실제 키 입력과 DOM read-back으로 수행했습니다.

## 저장본 자동 재연결·선택 mirror 보존 실제 재검증 (2026-08-06, v686)

- 원인: 저장본 포인터가 비어 있는 부팅에서 최신 IndexedDB 작업을 다시 연결하지 않아 `새 작업` 화면과 후보 0건이 나타났고, 복원 뒤 비어 있는 canonical 경쟁사 mirror가 저장된 VM 선택 ID를 덮어썼습니다.
- 수정: `src/app-core-02.js`에 명시적 `workspaceKind=blank-reset` 표식을 추가해 사용자가 누른 `새 작업`만 빈 초안으로 남기고, `src/app-core-03.js`가 빈 부팅에서 최신 저장 작업을 한 번만 재연결하도록 했습니다. canonical 후보 행이 비어 있거나 선택 버전 없는 mirror이면 저장 factory 선택을 유지하고, 실제 선택 해제 상태는 현재 선택본을 우선합니다. last-work 자산 적용에서도 빈 incoming `selectedIds`가 현재 선택을 지우지 못하게 보호했습니다.
- Red→Green: `workfile_archive_autorefresh.test.cjs`와 `workfile_legacy_candidate_scope_restore.test.cjs`의 복원·선택 회귀를 수정 전 실패로 확인한 뒤 집중 회귀를 통과시켰습니다. 최신 선택 mirror 회귀 포함 `workfile_legacy_candidate_scope_restore.test.cjs`는 `4/4 통과`입니다.
- 번들: `node tools/build_runtime_bundle.cjs`, `node tools/build_runtime_bundle.cjs --check` 통과. 실제 적용 build ID는 `v686`입니다.
- 실제 사용자 Chrome(Default/`호야`) 수동 게이트: 저장 작업 `project_msecdey5_sc2kl1`을 실제 화면에서 확인한 뒤 같은 탭에 물리 Ctrl+F5를 보냈습니다. Ctrl+F5 후 같은 탭 read-back은 `VM 후보 보기 · 14건`, `후보 14건 · 선택 1건`, `선택 1건 VM 상세수집`, `신화사DB 후보 8건`, `Cafe24 후보 24건`, `대표 1/1`, `사이즈 1/3`, `이미지컷 1/1`, 최근 작업 카드 `생성컷 5개`였습니다.
- Ctrl+F5 후 `새 작업` 전환·후보 없음·복원 건너뜀 경고는 없었고, current card의 project id는 계속 `project_msecdey5_sc2kl1`이었습니다. 이 결과는 자동 테스트나 HTTP 응답이 아니라 사용자 Chrome 화면의 실제 키 입력과 DOM read-back으로 확인했습니다.

## 부분 세션 초기 부팅의 후보 0건 재연결 (2026-08-06)

- 원인: 초기 부팅에서 입력 이미지·제품명만 먼저 복원된 상태가 `startupCurrentWorkHasContent()`에 걸려 마지막 저장 project의 DB/Cafe24 후보를 다시 연결하지 않았다. 저장본과 후보 데이터가 삭제된 것이 아니어서 작업파일을 직접 열면 신화사DB 8건·Cafe24 24건이 즉시 나타났다.
- 수정: `workspaceKind=project` 포인터가 있고 현재 후보 mirror가 비어 있을 때만 저장 project의 실제 후보 배열을 확인해 자동 복원한다. 현재 후보가 이미 있거나 저장 project에 후보가 없으면 자동 복원하지 않아 미저장 PSD식 탭의 제품명·branch를 덮지 않는다. 자동 복원은 현재 `draft:lastwork_*` branch scope를 유지하고, 명시적 작업 열기만 branch를 회전한다.
- 명시적 `새 작업`의 `blank-reset`, 미저장 `content-draft`, 다른 project identity, dirty/busy 상태는 계속 자동 복원 대상에서 제외한다.
- Red→Green: `workfile_archive_autorefresh.test.cjs`에 부분 세션·후보 배열·branch 보존 회귀를 추가해 `7/7 통과`; 인접 persistence/restore 회귀는 `50/50 통과`했다.
- 전체 격리 회귀의 선행 DB-03/SAVE-25가 처음에는 branch 회전·미저장 PSD branch 덮어쓰기로 실패했으나, 후보 존재 조건과 branch 보존 옵션을 보강한 뒤 두 건 모두 격리 harness에서 통과했다.
