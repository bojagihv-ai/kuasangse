# 상세페이지 회귀테스트 채점표

## 실행 방법

- 매일 1회 권장: 저장소 루트의 `상세페이지_매일회귀테스트.cmd`를 더블클릭한다.
- 빠른 단위 검사: `npm run verify:daily:fast`
- 메뉴·상태·수명주기 구조 검사: `npm run verify:architecture`
- 일상 전체 검사: `npm run verify:daily`
- 넓은 장기 검사: `npm run verify:daily:full`
- 최신 결과: `test-results/daily-regression/latest.md`
- 실행별 원문 로그: `test-results/daily-regression/<실행시각>/*.log`

실행기는 `127.0.0.1:8081`과 `127.0.0.1:5050`을 먼저 확인하고, 꺼져 있으면 테스트 동안만 실행한다. 백엔드를 직접 실행할 때는 `KUASANGSE_MAINTENANCE=0`으로 두어 사용자 이미지와 `output/local-archive`를 정리하지 않는다.

격리 Chrome/CDP가 앱 검증 전에 시작하지 못한 경우만 1회 재시도한다. 첫 시도 로그는 그대로 보존하며, 실제 제품 기능의 단언 실패는 재시도하지 않고 즉시 실패로 채점한다.

## 투트랙 운영 흐름

## 브라우저 로그인 운영 권한

- 사용자가 Cafe24 로그인·재연결을 명시적으로 요청한 경우, Chrome에 Cafe24 로그인 화면을 열고 진행한다.
- 로그인 화면에 사용자가 이미 입력해 둔 아이디·비밀번호가 있으면 로그인 버튼을 다시 묻지 않고 누를 수 있다.
- 아이디·비밀번호·OTP·토큰의 원문은 읽거나 출력하거나 문서·로그·메모리에 저장하지 않는다.
- 입력칸이 비어 있거나 추가 인증, OTP, CAPTCHA, 사람 확인이 나타나면 그 단계에서만 사용자 입력을 요청한다.
- 재연결 성공 판정은 화면 이동만으로 하지 않고 API Hub의 Cafe24 상태, 토큰 갱신 상태, 실제 읽기 전용 API 호출까지 확인한다.

### 1. 변경별 집중 검증

모든 코드 변경은 아래 순서로 검증한다.

1. 수정 전 실패를 실제 로그나 자동 테스트로 재현한다.
2. 변경 부위의 단위·CDP 테스트를 먼저 실행한다.
3. 같은 상태나 데이터를 공유하는 인접 공정 테스트를 함께 실행한다.
4. UI/UX 변경은 실제 브라우저에서 버튼을 눌러 진행 중·완료·실패 상태와 기존 결과 보존을 확인한다.
5. 화면 높이와 너비를 줄여도 기능이 잘리지 않고 전체 스크롤로 접근 가능한지 확인한다.
6. 실패 재현, 통과 로그, 실제 화면 스크린샷을 한 묶음으로 보관한다.

기존 집중 테스트가 있으면 보통 전체 일일 회귀 시간의 약 2~20% 범위에서 끝내는 것을 목표로 한다. 새 버그는 재현 테스트를 먼저 추가하므로 최초 검증 시간이 더 들 수 있지만, 같은 문제가 다시 생기면 수초 단위로 탐지되어야 한다.

### 2. 매일 전체 회귀

- 하루 작업 시작 전이나 종료 전에 `npm run verify:daily`를 1회 실행한다.
- 결과가 `0 실패`가 아니면 새 기능이나 리팩터링을 더 쌓지 않는다.
- 최신 요약은 `test-results/daily-regression/latest.md`, 원문은 실행시각별 `.log`에서 확인한다.
- 변경별 집중 검증이 통과했더라도 매일 전체 회귀를 생략하지 않는다.
- 새로운 재발 사례는 다음 실행부터 자동 탐지되도록 이 문서의 정답표와 `tools/regression_manifest.cjs`에 추가한다.

### 완료 보고 기준

아래 증거가 모두 있을 때만 해당 변경을 통과로 보고한다.

- 실행한 정확한 테스트 명령과 종료 코드
- 실패 0건 또는 남은 실패의 정확한 원문 로그
- UI 변경 시 실제 브라우저 확인 결과와 스크린샷 경로
- 실행하지 못한 실환경 검사의 이름과 이유
- 현재 남은 위험

## 정답 원칙

1. `workspaceId/currentRunId/productKey/inputImageFingerprint/stageId` 중 하나라도 다르면 현재 후보·현재 섹션·전송 payload로 인정하지 않는다.
2. 같은 작업파일의 Ctrl+F5는 입력 이미지, 후보 선택, 생성 이미지, 필수값 확인을 복원한다.
3. `새 작업`만 현재 문서를 빈 초안으로 초기화한다. 다른 작업파일 열기·저장 작업 불러오기·새로고침은 저장된 payload로 현재 화면을 대체할 뿐 빈 초안을 쓰지 않으며, 로컬 아카이브 원본은 삭제하지 않는다.
4. 대표·사이즈·색상옵션·이미지컷·상세 섹션은 생성 즉시 용도와 다섯 식별값을 가진 로컬 아카이브 자산이 된다.
5. 옵션표의 직접 배열 `3,3,3,3`은 미리보기와 실제 생성 모두 3칸씩 4행이어야 한다.
6. 고객 상세페이지에는 `[헤더]`, `[Header]` 같은 작업 라벨이 나오지 않는다.
7. 5초 이상 작업은 진행 중임을 표시하며, 완료·중단·실패를 서로 다른 상태로 남긴다.
8. 상세 생성 중단은 현재 섹션을 마친 뒤 멈추고, 완료된 섹션은 미리보기와 HTML에서 사용할 수 있어야 한다.
9. Cafe24 실제 등록, Vertex 실제 생성, VM 실마켓 수집은 비용·외부 상태·부작용이 있으므로 매일 자동 실행하지 않는다.
10. 작업파일 표시 이름은 제품 식별자가 아니다. 같은 작업공간의 정상 서버 스냅샷은 브라우저에 남은 오래된 상품명보다 우선하며, 표시 이름이 달라도 현재 제품 자산을 격리하지 않는다.
11. 브라우저 회귀 실행기는 전용 `regression:*` 작업공간을 사용하고 실제 전역·작업공간별 마지막 작업 스냅샷의 SHA-256을 바꾸지 않는다.
12. 작업파일의 `__stored_in_indexeddb__` 표식은 같은 섹션에 이미 복원된 로컬 아카이브 URL을 덮지 않는다. 실제 URL 15개가 있으면 저장·복원 뒤에도 15개 모두 표시 가능해야 한다.
13. 같은 저장 작업은 한 창만 편집하며, 인계 뒤 이전 창의 autosave·pagehide·IndexedDB·서버·작업파일·아카이브 쓰기는 현재 fencing token과 revision 검증 전에 어떤 부작용도 만들면 안 된다.
14. 메뉴와 조립공장 탭은 각각 등록된 target, 공개 API, 이벤트 수명주기를 소유하며 다른 메뉴 DOM이나 레거시 전역 상태를 직접 변경하지 않는다.
15. 저장은 승인된 persistence 어댑터와 migration/CAS 경계만 통과하며, 브라우저 저장소·서버 전송을 메뉴에서 직접 호출하지 않는다.
16. `src`의 모든 런타임 ESM은 manifest에 정확히 한 번 등록되고 순환 import가 없어야 하며, 생성 bundle은 반드시 manifest/source와 일치해야 한다.
17. 필수값 전체 확인·개별 확인·옵션 경로 확정은 canonical factory transaction을 먼저 commit하고, 화면 재렌더 뒤 강제 저장 예약까지 이어져야 한다. 클릭 직후만 바뀌고 새로고침에서 되돌아오면 실패다.
18. 서버 last-work 저장본은 렌더용 오래된 `state.factory`가 아니라 commit된 canonical factory snapshot을 사용한다. 작업 범위와 revision이 다른 축약본으로 풍부한 서버본을 덮거나 보호 no-op로 숨기면 실패다.
19. `옵션 없음`을 확정한 작업은 `options=done`을 유지하면서 `size_color` 섹션만 제거할 수 있다. 다른 섹션이 함께 줄거나 옵션이 미결정인데 섹션 수가 줄면 서버 저장을 거부한다.
20. 시작 복원은 편집권 획득이 끝난 뒤 mutable 세션 자산을 적용한다. 오래된 구조 테스트가 이 안전 순서와 반대로 고정되어 있으면 테스트를 완화하지 말고 최신 권위 계약에 맞춰 교정한다.
21. 서버 재시작 뒤 오래된 탭이 다시 쓰더라도 확정된 옵션 결정은 퇴행하지 않는다. 기존 `optionMode`가 구체값이고 `options=done`이면 빈 값·`pending`·`idle` 저장은 보호 no-op로 거절하되, 사용자가 확정한 다른 구체 옵션 모드 변경은 허용한다.
22. 미리보기 A/B 선택은 느린 이미지 preload를 기다리지 않고 즉시 화면에 반영한다. `A→B→A` 반복 선택 전에 현재 marker 이미지를 실체화해 비현재 후보를 잃지 않고, 동일 URL 후보도 현재 ID 하나만 활성 표시하며, Ctrl+F5·실제 작업파일 왕복 뒤에도 두 후보와 최근 생성 이미지컷을 보존한다. `a_b_cut_persistence_regression.test.cjs`
23. 모델 설정 카드 선택은 `modelConfig` 저장 어댑터를 거쳐야 하며, `GPT-5.6 Luna 선택 → F5` 뒤에도 같은 모델을 유지한다. 경쟁사 분석 상단의 분석 LLM 선택은 `analysisMatchSettings.gptOAuthModel`에 저장되고 실제 분석 실행 경로가 같은 모델을 사용해야 한다.
24. 전송 상단의 상세페이지 준비 상태와 Cafe24 최종 등록 버튼은 같은 scoped 상세페이지 게이트를 사용한다. 기준을 통과하지 못하면 둘 다 정확한 재생성 이유를 표시하고, 통과했을 때만 `Cafe24 최종 등록` 주 행동을 활성화한다. `task7_factory_publish_tab.test.cjs`
25. 작업 리포트 메뉴는 현재 편집 작업을 변경하지 않고 모든 `.kuasangse` 파일의 마지막 완료 단계·멈춘 단계·Cafe24 상품번호·등록 원본·후속 보정 파일을 표시한다. 읽기 전용 작업파일을 연 상태에서도 새로고침과 리포트 폴더 열기가 동작해야 한다. `workfile_reports_menu.test.cjs`, `test_workfile_report_api.py`
26. 375×640에서 미리보기·조립공장·작업 리포트는 가로 넘침이 없어야 한다. 미리보기 복구 버튼은 화면 안에 있고 섹션 목차는 앱의 주 세로 스크롤을 사용하며, 조립공장 1~7 탭은 선택 상태 레일보다 먼저 도달할 수 있고 리포트 액션은 오른쪽 경계를 넘지 않아야 한다. `factory_core_contracts.test.cjs`
27. 자동 제품 이미지 백업은 `lastProductImageBackup:<workspaceScope>` 전용 키와 같은 `workspaceScope`를 함께 가져야 한다. 전역 레거시 `lastProductImageBackup`은 자동 복원·조립공장 fallback·새 작업 초기화에서 읽거나 지우지 않는다. 다른 작업의 이미지·제품명이 빈 새 작업에 주입되면 실패다. `task8_restore_lifecycle_behavior.test.cjs`, `workspace_work_identity_runtime_contract.test.cjs`, `IMG-01`

### Task 8 구조 회귀 게이트

- `MENU-*`, `FACTORY-*`: 13개 사이드바 메뉴와 7개 조립공장 탭의 target·공개 명령·이벤트 소유권을 각각 검사한다.
- `ARCH-TARGETS-01`, `ARCH-IMPORTS-01`, `ARCH-ENFORCE-01`: target 등록, import 순환 0건, 다른 메뉴 DOM·레거시 전역 상태·저장 경계 우회를 차단한다.
- `ARCH-LIFECYCLE-01`: bind/dispose를 반복해도 listener와 timer가 누적되지 않아야 한다.
- `SAVE-MIGRATION-01`, `SAVE-CONCURRENCY-01`: 오래된 작업파일 이관과 lease/fencing/CAS 충돌 방지를 함께 검증한다.
- `UI-CJK-01`: 작은 창에서도 한글 단어를 음절 중간에서 자르지 않고 조립공장 7개 탭의 전체 라벨을 보존한다.
- 모든 `src/**/*.mjs`는 `src/runtime-manifest.json`에 정확히 한 번 등록되고 런타임 모듈은 순수 코드 250줄 이하를 유지한다.
- `dist/app-runtime.bundle.js`는 직접 편집하지 않고 `node tools/build_runtime_bundle.cjs`로 생성하며 `node tools/build_runtime_bundle.cjs --check`가 byte 단위 일치를 확인한다.

### 메뉴·버튼 전수 검증 규칙

1. 13개 사이드바 메뉴는 실제 Chrome에서 하나씩 눌러 활성 메뉴, 본문 제목, 주요 상태가 같은 화면을 가리키는지 확인한다.
2. 조립공장 1~7 탭은 완료 작업을 다시 생성하지 않고 저장본으로 빠르게 순회한다. 각 탭 선택 상태, 핵심 완료값, 가로 넘침 0건을 확인한다.
3. 입력·토글·열기·닫기·탭 이동처럼 되돌릴 수 있는 UI는 실제 클릭한다. 삭제·외부 등록·유료 생성·실마켓 수집은 자동 회귀에서 실행하지 않고 이벤트 계약과 화면 내 확인창까지 검사한다.
4. 버튼이 눌려도 화면·상태·로그 중 아무것도 변하지 않으면 성공으로 보지 않는다. 라우트 활성화, 상태 필드, read-back 중 하나 이상의 실제 변화가 증거여야 한다.
5. 실사용에서 새 무반응·오표시를 찾으면 수정 전에 RED 테스트를 만들고, 수정 후 그 테스트를 `tools/regression_manifest.cjs`의 `fast` 게이트에 넣는다.
6. 작업파일 복원 검증은 대표 이미지, 분석값, 후보, 생성컷, 15개 섹션, 최종 전송 설정을 함께 본다. 결과만 있고 재편집에 필요한 원본이 없으면 실패다.
7. 조립공장→AI 분석 동기화는 사용자 확정 단위를 보존하고 Cafe24 내부 배정 객체를 사람이 읽는 카테고리로 표시하지 않는다.
8. Cafe24 신규 생성에서 `product_no`를 받는 즉시 같은 작업의 선택·확정·초안 키를 새 번호로 맞추고 후속 모드를 `기존 상품 수정`으로 바꾼다. 후속 검증이나 이미지 저장이 실패해도 다음 시도가 중복 신규 등록으로 시작하면 실패다.

## 자동 채점 범위

| 공정 | 대표 테스트 ID | 실제 검증 대상 | 합격 기준 |
|---|---|---|---|
| 공통 | `SYN-*`, `UNIT-FE-01`, `UNIT-FE-02`, `UNIT-BE-01` | 모든 분리 JS, 핵심 Python, 실제 브라우저 함수, 실제 archive 함수, 회귀 실행기 재시도 분류 | 문법 오류 0, 단위 계약 전부 통과, 제품 검증 실패는 재시도하지 않음 |
| 공통 구조 | `ARCH-*` | ESM manifest, import graph, 모듈 크기, 전역 상태·저장 경계, listener/timer 수명주기, 생성 bundle | 누락·중복·순환·우회·누적·bundle 불일치 0건 |
| 공통 복원 | `RESTORE-UI-01` | 완성 작업의 상태 정합성, 대표 이미지 백업, 이미지컷 원본 재연결 | stale 실패/진행 표시 0건, 중복 이미지 shell 0건, 결과가 있으면 재편집 원본도 복원 |
| 공통 메뉴 | `MENU-NAV-01` | 13개 메뉴와 7개 탭의 shell route, redirect, handoff | 클릭 목적지와 활성 메뉴·본문 일치, 무반응 handoff 0건 |
| 공통 반응형 | `UI-CJK-01`, `UI-RESP-01` | 작은 창 한글 줄바꿈, 조립공장 탭 전체 라벨, 주 스크롤 도달성 | 음절 중간 분리·라벨 잘림·수평 overflow 0건 |
| 메뉴·조립공장 | `MENU-*`, `FACTORY-*` | 13개 메뉴와 7개 탭의 target·공개 API·이벤트 소유권 | 20개 모듈이 각각 독립 수명주기와 등록 gate 보유 |
| 공통 동시 편집 | `UNIT-AUTH-01`, `AUTH-01` | 서버 lease/CAS, 브라우저 인계, stale writer, 작업파일 digest/revision, 작은 창 충돌 UI | 한 편집자만 허용, 409/428 안정 코드, stale 부작용 0건, 1280x480·390x600 복구 동작 모두 도달 |
| 1 제품/DB | `SCOPE-*`, `DB-*` | 식별자 드리프트, 작업파일 분리, 후보 없음, DB/Cafe24 확정 | 타 상품 후보 0건 혼입, 새로고침 후 확정 유지 |
| AI 분석 연동 | `ANALYSIS-SYNC-01` | 조립공장 확정값을 AI 분석 화면으로 가져오기 | `4.8cm/23cm` 같은 명시 단위 보존, Cafe24 category assignment JSON 노출 0건 |
| 7 Cafe24 등록 | `CAFE24-CREATE-TARGET-01` | 신규 생성 성공 직후 현재 Cafe24 대상과 후속 등록 모드 | 새 `product_no`를 선택·확정·초안 키로 저장하고 다음 실행은 update, 중복 create 0건 |
| 2 대표이미지 | `IMG-01` | 기본 이미지 IndexedDB/작업파일 복원 | Ctrl+F5 뒤 동일 이미지 지문 유지 |
| 1 시작 이미지 교체 | `IMG-03` | 기존 제품 이미지가 있는 작업에서 보이는 `이미지 교체` 버튼으로 대용량 이미지 교체 | 보이는 버튼→file input→native change 1회, 기존 캐시 키/`blob:` 충돌을 덮어쓰고 앱·조립공장 원본·inputImages·화면이 새 이미지로 수렴, 새로고침 뒤 유지, 이전 이미지/오류 0건 |
| 2~5 생성 이미지 | `IMG-02` | 대표·사이즈·컷·옵션의 로컬 저장과 복원 | 다섯 식별값 일치 자산만 현재 후보로 복원 |
| 4 색상옵션 | `OPT-*` | 배열 파싱, 드래그 순서, 생성컷 조립공장 전송 | `3,3,3,3` 유지, 선택 결과만 options 후보에 표시 |
| 4 경쟁사 | `VM-*`, `MARKET-01`, `MARKET-ANALYZE-01` | VM 브리지 계약, 현재 작업 격리, 선택 후보 상세수집, 분석 시작 실패의 화면 복구 | fallback/VM 출처 구분, 선택하지 않은 이전 후보 재수집 0건, 시작 실패 뒤 `분석 진행 중` 잔류 0건 |
| 6 상세페이지 | `DETAIL-*` | 작업 라벨 제거, 현재 섹션 후 중단 | 고객 라벨 0건, 중단 뒤 완료 섹션 사용 가능 |
| 공통 진행 | `PROGRESS-01`, `GENERATE-01` | 실행 중/완료/실패 로그와 상태 전이 | 무응답 5초 초과 0건, 종료 상태 정확 |
| 공통 성능 | `PERF-01` | 96개 후보 렌더와 메모리 | 기존 성능 스크립트 임계값 전부 통과 |
| 공통 성능 | `PERF-02` | 분석·상세생성 주기 갱신·조립공장 설명 줄바꿈 | 전용 진행 패널이 준비된 동안 full render 0회, `.factory-desc` 한국어 keep-all 유지 |
| 공통 성능 | `PERF-03` | VM 후보 브리지 폴링 | 수집 진행 중 VM 폴링이 전역 셸 렌더를 직접 호출하지 않고 주 스크롤 위치를 유지 |
| 7 저장/내보내기 | `SAVE-*` | 작업파일, 새 작업, Ctrl+F5, 로컬 아카이브 | 같은 파일은 복원, 다른 파일은 분리, 원본 삭제 0건 |
| 7 저장 이관·동시성 | `SAVE-MIGRATION-01`, `SAVE-CONCURRENCY-01`, `SAVE-CONCURRENCY-02` | 이전 schema 이관, lease/fencing/CAS 병합, 비동기 초안 3-way 병합 | 손실 없는 이관, stale writer 부작용 0건, revision 단조 증가, 늦게 끝난 작업이 최신 선택·해제를 덮어쓰지 않음 |

## 기능별 상세 정답지

| ID | 실제 확인 내용 | 통과 정답 |
|---|---|---|
| `UNIT-FE-01` | 실제 프론트 함수 10건 | 식별자·병합·단계·옵션 배열·섹션 라벨·후보 범위 계약 전부 통과 |
| `UNIT-FE-02` | 회귀 실행기 실패 분류 4건 | CDP/초기 앱 로드만 재시도, 제품 단언 및 일반 테스트 실패는 재시도 0회 |
| `UNIT-BE-01` | 실제 `api_archive` 함수 10건 | 안전한 파일명·식별값·저장 경로·유효성·잘못된 입력 거부 전부 통과 |
| `UNIT-AUTH-01` | lease·fencing·CAS·작업파일·직접 명령 단위 계약 | 인계 후 이전 fence의 IDB/서버/파일/아카이브 쓰기 0건, 현재 fence만 revision 단조 증가 |
| `SAVE-CONCURRENCY-02` | 비동기 초안이 사용자 선택·선택 해제와 겹치는 저장 경쟁 | 같은 작업의 최신 사용자 변경은 유지하고, 늦게 끝난 작업의 독립 결과만 병합하며, 명시적 선택 해제는 되살리지 않음. `factory_store_async_rebase.test.cjs` |
| `AUTH-01` | 실제 두 브라우저 창 편집권 인계와 충돌 UI | A 저장 후 B 인계·최신본 복원, A의 stale 원본 덮어쓰기는 즉시 거부하되 A의 독립 `draft:` 브랜치 본문은 `inert` 없이 계속 편집, 두 작은 viewport 가로 넘침 0·주 스크롤 하단 도달 |
| `AUTH-02` | 백그라운드 탭 heartbeat 지연 복구 | Chrome이 heartbeat를 임대 만료 뒤 실행해도 같은 lease·fence이고 새 소유자가 없으면 편집권을 복구한다. 새 소유자가 이미 획득한 뒤의 이전 heartbeat는 `STALE_FENCE`로 거부한다. `test_workspace_authority_heartbeat_recovery.py` |
| `UI-BASE-01` | 앱 실제 로드와 기본 렌더 | 깨진 이미지 0건, 앱 전역 상태와 조립공장 화면 준비 완료 |
| `RESTORE-UI-01` | 완성 `.kuasangse` 작업파일 복원 | 15/15 결과와 완료 상태가 일치하고 대표 원본·이미지컷 원본이 재편집 가능하게 복원 |
| `MENU-NAV-01` | 12개 메뉴·7개 탭 route/handoff | active 메뉴와 본문 목적지가 일치하고 완료 프로젝트 redirect와 이전 결과 보기 동작이 무반응 없이 작동 |
| `ANALYSIS-SYNC-01` | 조립공장 최신값을 AI 분석에 반영 | 명시된 cm 단위를 mm로 바꾸지 않고 `category_no/recommend/new` 객체를 사용자 검색 문구로 노출하지 않음 |
| `CAFE24-CREATE-TARGET-01` | Cafe24 신규 생성 성공 뒤 후속 대상 확정 | 응답 `product_no`를 현재 선택·확정·초안 키에 즉시 붙이고 등록 모드를 update로 전환하여 재시도 중복 생성을 막음 |
| `FACTORY-PUBLISH-02` | 실제 미리보기와 최종등록 섹션 개수 일치 | 미리보기에 생성 콘텐츠가 15개 있으면 오래된 섹션 scope 메타가 13개만 일치하더라도 전송 준비·Cafe24 상세 HTML 모두 실제 미리보기 기준 `15/15`로 판단하고 최종등록 버튼을 활성화한다. 미리보기 미생성 섹션과 HTML 안전 검사는 계속 차단한다. `factory_core_contracts.test.cjs`, `task7_factory_publish_tab.test.cjs` |
| `SCOPE-01` | 상품명을 바꿀 때 식별자 갱신 | 잠긴 이전 상품은 직접 상태 변경으로 탈취 불가, 정식 변경 뒤 모든 키가 새 상품으로 일치 |
| `SCOPE-02` | 다른 작업파일 데이터 주입 | `workspaceId` 누락·불일치 후보와 섹션은 현재 작업에 0건 반영 |
| `SCOPE-REV-01` | 같은 작업파일을 연 세 창의 독립 브랜치 | 각 창은 서로 다른 `draft:*` revision·writer를 유지하면서 동일한 `project:*` 문서를 가리킨다. 한 창의 재저장은 그 창 revision만 증가시키며 다른 창의 상품명·revision은 바뀌지 않고, 이전 revision과 다른 브랜치 revision은 거부한다. `verify_three_session_workspace_revision_v230.cjs` |
| `DB-01` | 새 작업 후보와 후보 없음 | 새 초안 범위에서만 선택 가능, 작업 전환 뒤 이전 후보 선택 불가 |
| `DB-02` | 신화사DB/Cafe24 확정 | 시작 시 편집권 획득이 늦어 동기 탭 세션을 건너뛰더라도 범위가 맞는 IndexedDB 공장 자산이 `factory` 경로를 복원하며, Ctrl+F5 두 번 뒤에도 확정 후보와 후보 없음 선택이 유지 |
| `DB-02-SEL` | 경쟁사 VM 후보 선택 mirror | canonical 후보 행이 있어도 선택 버전이 없는 빈 mirror가 저장된 VM 선택을 지우지 않으며, last-work 빈 `selectedIds`도 현재 선택을 덮지 않는다. v686 실제 Chrome에서 `14건·선택 1건`을 Ctrl+F5 후 재확인 |
| `DB-03` | 초안 첫 저장·작업파일 저장 | 같은 열린 작업의 draft 범위 후보는 새 project 범위로 이관되고 `state.factory` 호환 mirror와 canonical store의 workspace·후보 scope가 함께 project로 바뀌어 DB/Cafe24 선택 버튼이 계속 활성화되며, 다른 작업 범위 후보는 이관하지 않음. 작업파일 불러오기는 durable commit 뒤 로컬 아카이브 자동 갱신까지 저장 전환 보호막을 유지해 후속 저장이 섞이지 않음 |
| `DB-04` | 기존 저장본 후보 복구 | 이미 project 범위인 저장본에 남은 `draft:lastwork` DB/Cafe24 후보는 현재 작업으로 복구하고, 같은 제품명이라도 다른 `project_*` 후보는 계속 차단 |
| `DB-05` | 브라우저 시작 복원 후보 | `pdp_session`을 읽어 앱을 다시 시작해도 같은 제품의 `draft:lastwork` DB/Cafe24 후보는 현재 project 범위로 복구되고, 다른 `project_*` 후보는 계속 차단하며, 시작 중 mutation은 workspace acquire·last-work·Cafe24 상태/토큰 갱신 allowlist 밖으로 나가지 않음(멱등 refresh 횟수 차이는 허용) |
| `DB-06` | 서버/자산 복원 후보 | 서버 마지막작업·IndexedDB 자산이 `state.factory`를 다시 적용해도 같은 제품의 `draft:lastwork` DB/Cafe24 후보는 현재 project 범위로 복구되고, 다른 `project_*` 후보는 계속 차단 |
| `DB-07` | 후보 패널 수집 상태 구분 | 신화사DB·Cafe24 빈 배열은 `확인 전`, `수집 대기`, `수집 중`, 실제 `검색 결과 없음`, `수집 실패`를 `parallelProgress` 사건으로 구분하고, 실행 중에는 현재 진행 메시지를 같은 후보 패널 안에서 갱신한다. `신화사DB 후보 없음으로 진행`과 Cafe24 신제품 진행 버튼은 상태 안내와 별개로 유지한다. `factory_core_contracts.test.cjs` |
| `DB-08` | 후보 확인 버튼의 렌더·revision 경쟁 내구성 | 신화사DB/Cafe24 후보 확인의 첫 선택 reducer는 Promise를 반환하지 않고 같은 tick 안에 owned transaction을 커밋한다. 일반 직접 클릭은 bridge가 있으면 반드시 즉시 selection→render→durable save 경로를 사용하고, lease 경로는 bridge 자체가 없는 capability fallback으로만 허용한다. 선택→상세조회→상세 반영은 하나의 operation lease로 유지하며, 외부 작업 lease에는 한 번 대기하고 같은 후보 중복 클릭만 즉시 거부한다. 클릭 직후 백그라운드 진행률 revision이 먼저 증가하는 경합을 강제로 주입해도 선택이 취소되지 않으며, 선택적 상세조회가 지연되는 동안의 revision 증가도 견딘다. 후보 scope는 수집 중인 owned draft를 기준으로 찍고, 교체된 조립공장 root에는 shell·본문 listener를 함께 다시 연결한다. 모듈형 후보 버튼은 이미 transaction을 소유한 후보 applier를 빈 outer transaction으로 다시 감싸지 않는다. `factory_candidate_identity_deferred_commit.test.cjs`, `factory_one_click_operation_identity.test.cjs`, `task7_factory_menu.test.cjs`, `task7_factory_runtime_integration.test.cjs` |
| `DB-09` | 후보 확인 버튼의 단일 소유권·렌더/적용 정합성 | 신화사DB/Cafe24 후보·후보 없음·선택 해제 버튼의 클릭 소유자는 활성 `factory/db` 탭 위임 리스너 정확히 1개여야 한다. document capture와 직접 `onclick` 중복 소유는 0건이어야 하며, 재렌더로 자식 노드가 교체된 뒤에도 물리 클릭 1회가 명령 1회만 실행해야 한다. `후보 없음`과 `선택 해제`는 클릭한 같은 tick의 transaction 뒤 DB 탭을 즉시 다시 그리고 강제 저장하며, 선택 해제는 후보 목록을 보존한다. 현재 작업 scope에서 적용 predicate가 거부할 후보는 버튼으로 렌더하지 않고 숨긴 건수와 현재 제품 재수집 버튼을 표시한다. 375/768px에서는 후보 패널이 한 열로 쌓이고 OAuth 안내·후보명이 음절 단위로 세로 분해되지 않아야 한다. `factory_candidate_click_invariant.test.cjs`, `factory_one_click_operation_identity.test.cjs`, `task7_factory_cafe24_writer_retirement.test.cjs` |
| `DB-10` | 격리 Chrome의 실제 포인터 후보 선택·잠금 복구 안내·좁은 화면 가시성 | 사용자 작업과 분리된 임시 backend·state·archive·Chrome 프로필에서 신뢰 포인터로 신화사DB/Cafe24 후보를 누른다. 버튼 위 hit-test가 실제 `BUTTON`이어야 하고, 한 번의 물리 클릭으로 선택키와 `확정됨` 표시가 즉시 반영되어야 한다. 선택 해제와 각 `사용 안 함`도 실제 포인터 클릭으로 상태가 즉시 바뀌어야 한다. 같은 작업·제품임을 기존 identity에서 복원할 수 있는 구형 후보는 계속 선택할 수 있고, 다른 제품 후보는 버튼으로 렌더되지 않아야 한다. 현재 프로젝트의 읽기 전용 잠금에서는 신화사DB/Cafe24 `사용 안 함`과 `필수값 검수로 이동`을 포함한 조작이 상태를 바꾸지 않고, 화면에 `읽기 전용` 및 `편집권 가져오기` 복구 안내를 표시해야 한다. 실제 `편집권 가져오기` 클릭은 편집 상태를 복구하고, 직후 신화사DB 후보 선택도 다시 실행되어야 한다. 764×485 화면에서는 후보 목록의 가로 overflow와 후보 버튼 글자 잘림이 없어야 하며, 작업파일 플로팅 카드는 보이는 후보 조작부나 스크롤로 중앙에 가져온 마지막 조작부를 덮으면 안 된다. `verify_factory_candidate_pointer_selection_v159.cjs` |
| `CHROME-TRANSPORT-01` | 사용자 Chrome 확장 연결 연속성 | `Default`/`호야` 프로필의 공식 확장 연결 하나에서 명령을 직렬 실행한다. 로드된 조립공장에는 전체 DOM snapshot을 요청하지 않고 제한된 상태만 읽으며, 시간 초과된 탭 핸들은 재사용하지 않는다. `tabs.list`·DB 탭 활성화·신화사DB/Cafe24 후보 선택·상태 read-back·F5 2회 복원이 한 세션에서 연속 통과해야 한다. 에이전트 생성 탭은 마지막 한 번의 `tabs.finalize`로 정리한다. `docs/CHROME_CONTROL_STABILITY.md`, 실제 Chrome 수동 게이트 |
| `CHROME-TRANSPORT-02` | 숨겨진 앱 탭의 주기 갱신 억제 | 숨겨진 정상 앱 탭은 runtime build manifest, 자동화 상태, 조립공장 진행 heartbeat, 섹션 생성 heartbeat의 주기 DOM 갱신을 실행하지 않는다. 탭이 다시 보이면 기존 폴링·진행 상태를 이어가며 작업 자체를 취소하거나 결과를 지우면 안 된다. `runtime_build_stale_guard.test.cjs`, `factory_db_render_coalescing.test.cjs` |
| `DB-11` | 신화사DB API Hub 전용 후보·상세 요청 경로 | 조립공장의 `apiHubOnly` 후보 검색·상세 보강은 PDP 상세페이지 백엔드의 인증 실패와 분리된다. PDP가 `authentication_failed`여도 PDP를 호출하지 않고 API Hub 검색·상세 결과로 계속 진행해야 하며, 기본 경로의 PDP 우선 규칙은 바꾸지 않는다. `sinhwa_api_hub_only_contract.test.cjs` |
| `DB-12` | 후보 수집 중복 전체 렌더 방지 | 상위 DB 후보 수집이 현재 작업을 한 번 렌더할 때, detached 임시 factory를 처리하는 하위 DB 단계는 `render:false`를 이어 받아 추가 전체 렌더를 만들면 안 된다. 직접 DB 단계 호출의 시작·완료 렌더는 유지한다. `factory_db_render_coalescing.test.cjs` |
| `DB-13` | 경쟁사 후보 선택·상세수집·PSD 탭 브랜치 격리 | 편집 가능한 탭 브랜치의 실제 포인터 클릭은 후보를 정확히 한 번 선택/해제하고 `선택 1건 VM 상세수집`으로 즉시 전이한다. 선택 뒤 오래 시작된 경쟁사 비동기 완료가 도착해도 더 최신 `detailSelectionVersion`의 선택·상세수집 활성 상태를 0건으로 되돌리면 안 된다. 원본 문서가 다른 창의 편집권으로 잠겨도 현재 `draft:` 탭 브랜치는 `inert`가 되지 않고 후보 선택·상세수집을 계속할 수 있어야 하며, 우하단 작업파일 카드는 원본 문서 잠금을 현재 브랜치 잠금으로 오표시하거나 불필요한 인계 버튼을 노출하면 안 된다. `verify_factory_competitor_candidate_pointer_v588.cjs` |
| `DB-14` | 명시 선택 후보의 DB 이름 드리프트 보존 | 현재 DB 확정 상품명과 VM 검색 결과명이 달라도 사용자가 명시적으로 선택한 후보 ID는 현재 작업 후보 목록에서 유지하고 `선택 1건 VM 상세수집`을 0건으로 되돌리지 않는다. 선택 해제·새 작업만 명시적 삭제 경계이며, 일반 scope 필터는 선택되지 않은 타 상품 후보에만 적용한다. `factory_core_contracts.test.cjs` |
| `DB-15` | OAuth 확인 뒤 후보 재수집 busy 잠금 해제 | 신화사DB/Cafe24 후보 수집이 성공·실패·범위 변경으로 끝나면 전역 busy 잠금을 반드시 해제한다. 같은 화면에서 `인증 확인 후 후보 다시 수집` 또는 재검색을 다시 실행하면 두 번째 실행도 실제 후보 조회 함수까지 도달하고 10% 준비 상태에 남지 않아야 한다. `factory_db_render_coalescing.test.cjs` |
| `IMG-04` | VM 상세 이미지 작업 스코프 선부착 | VM 상세 응답의 외부/entry payload에 작업 stamp가 없어도 선택 작업의 authoritative scope를 이미지에 먼저 입힌 뒤 strict current-work 필터를 적용한다. `scraped_data` object key 기반 후보 ID와 VM artifact URL을 보존해 상세 이미지가 0장으로 사라지지 않아야 한다. `factory_core_contracts.test.cjs`, 실제 Chrome VM 상세수집·복구·확대보기 수동 게이트 |
| `RUNTIME-BUILD-01` | 오래 열린 구버전 탭의 결함 코드 실행 차단 | 정상 앱은 focus·visibility 복귀·15초 주기로 `runtime-manifest.json` build ID를 확인한다. 현재 탭과 새 build가 다르면 기존 화면 위에 단일 차단 게이트를 표시하고 뒤쪽 클릭을 받지 않으며, 사용자가 `새 빌드 적용`을 눌렀을 때 현재 작업 저장을 시도한 뒤 새로고침한다. 같은 build와 생산관제 `batchWorker=1`에는 게이트를 설치하지 않는다. `runtime_build_stale_guard.test.cjs` |
| `RUNTIME-BUILD-02` | 같은 build ID를 재사용해도 ESM capability 캐시가 남지 않음 | 페이지 부팅마다 하나의 `boot-*` 토큰을 만들고 manifest에 포함된 bootstrap·authority·모든 ESM 모듈·bundle URL에 동일 토큰을 붙인다. 같은 build ID 아래 소스가 바뀐 뒤 새로고침해도 이전 capability 모양(`validateSnapshotIdentity` 누락 등)을 재사용하지 않으며, 한 부팅 안의 import map은 같은 토큰으로 고정된다. `app_loader_cache_bust.test.cjs` |
| `RUNTIME-BUILD-03` | ESM 모듈 수정 시 새 build ID 발급 | runtime bundle의 source digest는 classic script뿐 아니라 loader·authority·모든 manifest ESM module을 포함한다. 따라서 ESM 저장 로직만 고쳐도 build ID와 URL 버전이 상승해 일반 새로고침이 이전 모듈 캐시를 재사용하지 않는다. `runtime_bundle_build_id.test.cjs` |
| `FIELD-03` | 한글 IME 상품명 저장 경계 | 조합 중 첫 자모(`ㅁ`)는 canonical 상태에 저장하지 않고 `compositionend`의 완성 상품명(`모시바둑파우치`)만 커밋한다. 시작 직후 사용 입력으로 백그라운드 복원이 취소돼도 저장 게이트는 반드시 종료되어야 한다. 명시적 현재 작업파일 저장은 편집권/CAS 검사를 유지한 채 서버 보호 no-op를 강제·복구 저장으로 갱신하고, F5 뒤 입력값·작업파일명·최근 작업 카드가 모두 완성 이름과 최신 시각을 보여야 한다. |
| `IMG-01` | 업로드 기본 이미지 | Ctrl+F5 뒤 동일 이미지 지문과 원본이 복원 |
| `IMG-03` | 시작 화면 `이미지 교체` | 보이는 버튼을 실제 클릭해 12KB 초과 `.png`를 선택하고 파일 선택 중 재렌더와 동일 캐시 키의 이전 본문/`blob:`을 강제로 둔 상태에서도 native `change` 1회 후 앱 상태·조립공장 `product.imageBase64`·`inputImages`·DOM이 새 지문으로 수렴함. 새로고침 뒤 새 `blob:` 미리보기가 복원되고 `STALE_FACTORY_STORE_REVISION`, 이전 이미지, 런타임 오류가 남지 않음 |
| `IMG-02` | 대표·사이즈·이미지컷·섹션 이미지 | 생성 즉시 로컬 저장, 새로고침 뒤 현재 다섯 식별값 자산만 복원. 시작·저장·복원·검증 어느 단계에서 실패해도 격리 CDP 연결과 테스트용 Chrome을 `finally`에서 반드시 정리 |
| `OPT-01` | 옵션분류기 색상컷 연동 | 옵션분류기에서 만든 현재 작업 색상컷만 조립공장 후보에 표시 |
| `OPT-02` | `3,3,3,3` 배열과 드래그 | 3칸씩 4행 유지, 드래그한 두 옵션의 사진·이름 순서가 함께 교환 |
| `OPT-03` | 옵션 생성 결과 전송 | 조립공장으로 보낸 결과만 `options` 단계 후보가 됨 |
| `OPT-04` | 슬롯 이름 프리셋 저장·불러오기 | 현재 슬롯 이름을 이름 있는 공용 프리셋으로 저장하고 다시 불러오며, 기존 슬롯의 이미지 배정은 지우지 않고 부족한 슬롯만 추가 |
| `OPT-05` | 옵션분류기 원본 사진 로컬 보관·F5 복원 | 업로드한 원본을 즉시 현재 workspace·상품·입력 이미지 범위의 `option-images`에 저장하고 lightweight 상태에는 archive 참조를 유지한다. 인라인 payload나 이전 초안에 원본 목록이 없어도 같은 작업의 `option-sorter-source-upload` 자산만 자동 복원하며, 생성 옵션표나 다른 작업 사진은 원본 목록에 섞지 않는다. 개별/전체 삭제 뒤에는 삭제 시점·archive 제외 목록을 존중한다. `optionsorter_source_archive_persistence.test.cjs` |
| `OPT-06` | 옵션분류기 생성 결과 보관·F5 표시 복원 | 인라인 `result.image`가 lightweight 저장에서 비워져도 `archiveId/imageUrl`, 연결된 조립공장 보관 자산, 또는 options 보관 목록의 정확한 `optionResultId`로 PNG를 카드·확대보기·다운로드·샘플 지정에 다시 연결한다. 이전 작업 결과는 화면에 보이되 현재 작업 후보 전송 범위는 넓히지 않는다. `optionsorter_source_archive_persistence.test.cjs`, `verify_option_sorter_result_archive_reload_v461.cjs` |
| `OPT-07` | 색상용 이미지 단체컷·대표이미지 후보 연동 | 새 작업은 모든 색상용 이미지를 기본 선택하며 일부 색상만 다시 고를 수 있다. 선택 이미지는 콜라주가 아닌 한 장의 대표이미지형 단체컷으로 정확히 1회 생성하고 `options` 로컬 아카이브와 조립공장 `hero` 후보에 함께 연결한다. 저장 트랜잭션 실패 시 성공 문구나 `heroAssetId`를 남기지 않는다. 375/768/1280px에서 조작부가 잘리지 않고 전체 세로 스크롤로 도달 가능해야 한다. 자동 회귀는 이미지 모델을 stub으로 대체하고 실제 외부 모델 호출은 수동 비용 게이트로 둔다. `optionsorter_group_shot.test.cjs`, `task7_factory_store_authority.test.cjs`, `verify_option_group_shot_cdp_v483.cjs` |
| `OPT-08` | 옵션 빠른 배치·GPT OAuth 색상명 | 미배정 사진 더블클릭은 다음 빈 슬롯에 즉시 배정하고, 사진 드래그 종료는 상태·카운트만 갱신해 메뉴 전체와 Sortable 인스턴스를 다시 만들지 않는다. 슬롯에서 풀로 되돌린 사진도 같은 더블클릭 경로를 유지한다. GPT OAuth 이미지 판독은 실제 이미지 payload를 전송하고 확정 색상 슬롯을 `1.자주`, `2.파랑` 형식으로 저장하며 F5 뒤에도 유지한다. 자동 회귀는 OAuth payload 계약·번호명·저장 예약·역드래그 경계를 검증하고, 실제 OAuth 호출과 F5 복원은 Chrome 수동 게이트에서 확인한다. `optionsorter_quick_assign_gpt_color.test.cjs` |
| `OPT-09` | 옵션 이미지 풀 확대·진입 지연 | 미배정 풀 썸네일은 데스크톱 104px·모바일 88px 이상으로 표시하고 카드에 확대 `+`를 제공한다. 확대는 기존 이미지 모달 경로를 사용하며, 옵션 원본/결과 보관본 복원은 메뉴 진입 중 전체 deep 작업파일 저장을 기다리지 않고 lightweight 저장으로 이어져야 한다. `optionsorter_source_archive_persistence.test.cjs` 및 실제 Chrome 시각 게이트 |
| `OPT-10` | 옵션 이미지 확대 모달 닫기 | 확대 모달의 `닫기` 버튼과 모달 바깥 backdrop 클릭이 모두 모달을 닫고, `body`로 이동된 detached overlay도 남지 않는다. 모달 내부 클릭은 닫지 않는다. `optionsorter_source_archive_persistence.test.cjs` 및 실제 Chrome 수동 게이트 |
| `OPT-11` | Sortable 미탑재 옵션 이미지 드래그 폴백 | SortableJS가 없는 런타임에서도 포인터 드래그로 풀·슬롯 간 이미지와 배정 상태를 이동하고, 최초 렌더의 refresh 타이밍이 지나도 업로드·분류 이벤트가 설치된다. `optionsorter_quick_assign_gpt_color.test.cjs` 및 실제 편집권 확보 Chrome 수동 게이트 |
| `OPT-12` | 옵션표 생성·결과 보존·크게 보기 | 외부 로컬 아카이브 이미지는 `crossOrigin`을 `src`보다 먼저 설정해 캔버스 합성·옵션표 생성이 완료되어야 한다. 원본 아카이브 큐가 비워질 때만 옵션분류기 전체 렌더를 한 번 실행하고, 생성 중복 클릭은 단일 실행으로 막는다. 실제 Chrome에서 15/15 매칭 뒤 옵션표 결과 2장·결과 이미지 4개를 확인하고 Ctrl+F5 뒤에도 매칭·슬롯·결과를 동일하게 읽으며, 각 결과 카드의 `크게 보기`가 이미지 모달을 열어야 한다. `optionsorter_generation_regression.test.cjs`, `optionsorter_persistence_preview.test.cjs`, 실제 Chrome 수동 게이트 및 `output/debug-evidence/optionsorter-ctrlf5-final-after.png` |
| `OPT-13` | 색상명·사진-슬롯 조합 원자 저장 | GPT OAuth 색상명 자동 생성은 슬롯명과 첫 사진 `imgIds` 조합을 저장 완료한 뒤에만 완료 상태를 반환한다. 실제 Chrome에서 15/15 배정·15개 번호 색상명을 확인하고 즉시 Ctrl+F5를 보내도 색상명 배열·슬롯별 사진 조합·15/15 상태가 전후 동일해야 한다. `optionsorter_color_map_persistence.test.cjs`, 실제 Chrome 수동 게이트 및 `output/debug-evidence/optionsorter-color-map-ab-v702-fixed-after-ctrl-f5.jpg` |
| `WORKER-01` | 생산관제 batch worker 메모리 격리 | `batchWorker=1`은 전체 편집기·대형 자산 복원·full render를 실행하지 않고 compact worker shell과 명령/상태 브리지로 부팅한다. 9초 뒤 DOM이 compact shell로 유지되고 이미지 노드가 0개여야 하며, `batch_control_worker_contract.test.cjs` 및 격리 브라우저 수동 게이트를 통과한다. |
| `WORKER-02` | PDP work-bundle A컷 선택 원자성 | 생산관제는 신화사 PDP work-bundle의 Input/Output 역할과 인증 thumbnail만 BFF로 표시하고 페이지당 24개만 lazy render한다. 수동·GPT·제품별 자동 선택은 동일 composite 경로를 사용하며, bundle/job과 최신 factory product/run/fingerprint/revision/projection cursor를 검증하고 immutable PDP decision을 먼저 기록한 뒤에만 등록된 `selectFactoryACut`을 큐잉한다. BFF SSE event cursor는 재연결에만 쓰며 projection cursor와 섞지 않는다. bundle은 현재 product 또는 명시적 bundle ID로만 bind하고 제품 전환 시 이전 비동기 응답을 폐기한다. factory candidate는 `assetId`↔work-bundle `id`/`storedAssetId` 또는 candidate `id`↔asset `id`의 유일한 stable match만 허용하며 factory 명령에는 factory candidate ID를 보존한다. PDP 실패·membership/stage 불일치·stale/ambiguous identity는 queue 0건이며, UI는 queue 응답 뒤 `saving`을 유지하고 factory receipt와 새 revision 이후에만 `selected`가 된다. 375/1024/1280px에서 7개 메뉴와 자산 화면은 주 세로 스크롤로 도달 가능하고 가로 넘침이 없어야 한다. `test_work_bundle_selection_gap.py`, `test_pdp_workbench_client.py`, `production-workbench.test.cjs`, `work-bundle-r2.test.cjs` |
| `CONTROL-TOWER-F1` | 계획 증거 결정론적 커버리지 | Task 3-15 및 F1-F4의 체크 상태·참조·테스트 명령·증거 경로를 제한된 구역에서 파싱하고, ledger 최신 terminal verdict와 HEAD·tracked/untracked content fingerprint가 일치하는 confirmed receipt만 승인한다. `<attemptDir>` 증거는 `--evidence-root` 또는 mapping manifest 없이는 통과할 수 없으며, `output/local-archive`와 volatile log는 source fingerprint 범위에서 제외한다. `npm run verify:control-tower:coverage -- --plan .omo/plans/batch-production-control-tower.md --evidence-root .omo/evidence/batch-production-control-tower --report-dir .omo/evidence/batch-production-control-tower/final-f1` 및 `control_tower_plan_coverage.test.cjs` |
| `DETAIL-01` | 고객 상세페이지 문구 | `[헤더]`, `[Header]` 등 작업 라벨 0건 |
| `DETAIL-02` | 상세 생성 중간 중단 | 현재 섹션 완료 후 중단, 완료 섹션은 미리보기와 HTML에서 사용 가능 |
| `DETAIL-03` | 개별 섹션 다시 생성 | 헤더·핵심 특징 새 후보 추가, 생성 중 표시, 실패 시 기존 후보·이미지·문구 보존 |
| `DETAIL-05` | 남은/선택 섹션 일괄 생성 실행 전 적용값 | 상단에 대상 개수·기준·방식을 한 문장으로 표시하고, 각 미생성 카드에는 실제 일괄 실행 예정값과 `개별 설정`을 동시에 구분해 표시. 상단 값 변경 시 대상 카드 표시가 즉시 같은 값으로 갱신되고 생성 완료·잠금 카드는 일괄 대상 표시에서 제외 |
| `DETAIL-06` | 섹션 일괄 생성 처리량·완료 이미지 표시 | 미생성 섹션은 최대 2장씩 병렬 생성하고 현재 생성 묶음 완료 뒤 중지한다. 완료된 `/api/local-archive/...` 이미지는 앱 서버 `8081`이 아니라 백엔드 `5050` 기준 절대 URL로 렌더해 새로 생성하지 않고도 즉시 표시한다. |
| `DETAIL-07` | 미리보기 지시문 반영 재생성 | 편집 패널의 `지시문 반영 재생성` 버튼 클릭이 인라인 이벤트 전파 차단에 막히지 않고 미리보기 메뉴의 위임 핸들러까지 도달한다. |
| `DETAIL-08` | 미리보기 A/B/C 후보 선택 | 같은 미리보기 화면에서 권한 fencing token이 갱신돼도 후보 버튼 클릭이 새 토큰으로 dispatch되고, route leave/rebind stale guard는 유지된다. |
| `DETAIL-09` | 미리보기 A/B 반복 선택·복원 | `A→B→A`를 반복해도 현재 후보와 비현재 후보 이미지가 모두 남고 매번 활성 카드가 정확히 1개이며, 실제 작업파일 왕복과 Ctrl+F5 뒤에도 두 후보를 다시 선택할 수 있다. `a_b_cut_persistence_regression.test.cjs` |
| `DETAIL-10` | 미생성 색상옵션 섹션 이동·이미지 선택 | 미리보기 outline의 10번 색상옵션이 이미지 유무와 무관하게 `data-preview-section="size_color"` 앵커로 이동하며, 빈 카드에서 로컬 이미지 추가를 열고 옵션분류기 복원 결과 2장을 목록으로 보여 선택 시 해당 섹션 이미지·배치 상태로 적용한다. `preview_missing_section_image_selection.test.cjs` |
| `DETAIL-11` | 경쟁사 섹션 플랜 개별 생성·프롬프트 계약 | 헤더를 포함한 15개 섹션은 숨김·자동 제외 여부와 무관하게 각각 개별 생성 버튼을 제공한다. 카드에는 파이프라인·provider 프롬프트 버전, 활성/제외 출처, 가변 요청 입력, 실제 provider에 전달되는 최종 prompt를 구분해 표시한다. 최종 prompt는 실제 생성과 같은 조립 함수를 사용해 제품 사실·섹션 메타·경쟁사 reference·전역 제약·브랜드/레이아웃·응답 JSON 규격을 포함한다. 경쟁사 분석은 현재 작업 scope가 명시적으로 일치하고 이전 분석 보기 상태가 아닐 때만 총합버전에 포함하며, scope 없는 저장 리포트와 다른 상품 리포트는 제외한다. `competitor_section_plan_prompt_contract.test.cjs` |
| `ANALYSIS-LLM-01` | 모델 설정·경쟁사 분석 모델 선택 | 모델 설정 카드에서 고른 LLM이 저장되고 F5 뒤 유지되며, 경쟁사 분석 입력 상단에서 GPT OAuth 분석 모델을 바꾸고 다시 렌더해도 선택값이 유지된다. `competitor_analysis_model_selection.test.cjs` |
| `UI-CARD-01` | 빠른 비교 카드 텍스트 | 긴 LLM/이미지 모델 메타데이터가 카드·본문 열 폭을 넘지 않고 이름/메타 줄에서 ellipsis 처리된다. |
| `PROGRESS-01` | 5초 이상 작업 상태 | 진행 중·완료·실패가 구분되고 처리 중 무응답 상태가 없음 |
| `PROGRESS-02` | 실행 중 자동 복구 snapshot 격리 | `factory/runDb` operation lease가 활성인 동안 늦게 도착한 세션/제품이미지 자동 복구는 workspace를 교체하지 않고, 로컬 보관함 갱신·복원과 복구 runtime 정리는 revision을 선점하지 않는다. 진행 패널은 실행 중 draft 한 개만 유지하며 `DB/VM/이미지 작업 응답 대기 중`과 `이전 실행 확인 필요` 사이를 번갈아 표시하지 않는다. 명시적 새 작업·작업파일 열기·인계 복구는 기존 경로를 유지한다. `factory_one_click_operation_identity.test.cjs` |
| `PROGRESS-03` | 복원 공정 레일 상태 재조정 | 저장된 DB/Cafe24 선택, VM 후보/상세 이미지, 부분 상세 섹션이 있어도 초기화·hydration이 공정 레일을 `idle/0%`로 낮추지 않는다. 같은 작업의 DB 병렬 게이지는 실제 확정 근거를 `100% 완료`로, 부분 상세는 `완료수/목표수`와 계산된 진행률로 표시하며 실행 중·오류·차단 상태는 추정값이 덮지 않는다. 실제 Chrome 탭 재로드 뒤에도 후보·생성 자산·최근 작업파일이 그대로여야 한다. `factory_stage_state_reconcile.test.cjs`, `factory_parallel_progress_rail.test.cjs`, 실제 Chrome hard-reload 게이트 |
| `GENERATE-01` | 생성 공정 상태 전이 | 외부 서비스 preflight·저장 후보 승격은 고정 대역으로 격리하고 실제 런타임의 대표·사이즈·이미지컷·시작 탭 시작/완료/실패 전이, 로컬 아카이브 메타데이터, 새로고침 뒤 유령 진행 표시 0건을 검증 |
| `GENERATE-02` | 완료 사이즈컷 상태 단조성 | 현재 실행ID의 완료 사이즈 자산이 1장 이상 있으면, 후보 확정 중 엄격 범위 판정이 일시적으로 0건이어도 DB/신화사/Cafe24 후처리가 실제 사이즈값 누락을 이유로 `blocked`나 0/0으로 낮추지 않는다. 같은 실행의 표시 이미지 3장은 계속 보이고 확대·`사용`·`선택 해제`가 가능하며, 다른 제품/실행 결과는 기존 격리 규칙을 유지한다. `factory_size_vm_latency_regression.test.cjs`, `verify_factory_size_preview_confirm_cdp_v545.cjs`, 실제 Chrome 수동 게이트 |
| `GENERATE-03` | 보존 사이즈컷 원본 확대 | 현재 제품명과 입력 이미지가 같은 사이즈컷 보관 URL은 canonical 자산이 일시적으로 빠져도 `보기 전용` 후보로 계속 표시하고 기존 확대 dialog를 연다. 다른 제품/입력 원본은 재사용하지 않으며 `사용`, 드래그, 선택, 단계 상태, 저장값은 바꾸지 않는다. `factory_size_vm_latency_regression.test.cjs`, 실제 Chrome 수동 게이트 |
| `PERF-01` | 후보 96개 실제 렌더 | 기존 DOM·메모리·렌더 시간 임계값 통과, 깨진 이미지 0건 |
| `PERF-02` | 생성 이미지 확대·확정 응답성 | 확대창은 자산별 표시 이미지를 한 번만 계산하고 대형 이미지 복원도 예약 복원 또는 즉시 복원 중 한 경로만 실행한다. `이 컷 확정`은 성공·실패·비동기 진행을 버튼에 즉시 표시하고, 닫을 때 확정 상태를 원래 카드에 한 번 반영한다. `factory_size_vm_latency_regression.test.cjs`, `verify_factory_size_preview_confirm_cdp_v545.cjs` 및 실제 Chrome 수동 게이트 |
| `PERF-03` | VM 후보 폴링 화면 안정성 | 격리 Chrome에서 VM 브리지 상태를 4회 모사한다. 수집 진행 중 `compMarketTryVmCandidateBridgeSearch`가 전역 셸 렌더를 직접 호출하면 실패하며, 주 스크롤 위치와 마지막 진행 문구를 함께 확인한다. `verify_factory_vm_poll_render_stability_cdp_v002.cjs` |
| `SAVE-01` | 로컬 아카이브 비삭제 | 기존 실제 이미지/HTML payload의 SHA-256이 실행 전후 동일 |
| `SAVE-02` | 작업파일 저장·열기 | 이미지·단계·후보·Cafe24 입력 상태가 같은 파일 안에서 복원되고, 현재 작업의 상대 `local-archive` 이미지 URL도 저장 매니페스트에 보존한다. 불러온 문서는 현재 탭의 독립 `draft:*` 브랜치에 연결되며, 영속 저장 실패를 강제해도 기존 화면을 롤백·보존하고 실패 상태를 표시한다. |
| `SAVE-03` | 새 작업 | 이전 프로젝트 `factory.workspace.id`가 화면에 남아 있는 전환 중에도 새 draft 범위의 빈 체크포인트만 저장한다. 이전 프로젝트 범위의 stale 저장은 거부하고, 즉시 F5 뒤 제품명·기본이미지·후보·생성 결과가 빈 새 작업으로 유지되어야 한다. 기존 로컬 원본은 삭제하지 않음. `verify_factory_new_file_blank_cdp_v85.cjs` |
| `SAVE-04` | 같은 작업파일 새로고침 | 현재 작업 후보와 옵션 이미지 원본·이름·매핑을 복원하고 다른 작업파일 후보 0건 혼입. 동일 scope의 이미지 보완본은 현재 revision 이하만 허용하며 미래 revision과 다른 scope는 거절 |
| `SAVE-05` | Ctrl+F5 아카이브 부트스트랩 | 현재 탭의 `draft:` 분기와 연결된 문서 ID를 유지한 채 입력·대표·사이즈·색상옵션·이미지컷을 단계별 실행ID로 두 번 연속 복원한다. 자동 복원은 workspace·product·fingerprint로 제한한 읽기 전용 자산 조회만 사용하며 `project:` 편집권을 빌리거나 현재 탭의 권한·버튼 상태를 바꾸지 않는다. 이전 실행의 대표이미지는 섞이지 않고, 두 번째 Ctrl+F5 뒤에도 같은 분기·문서 ID·저장 revision이 유지되어야 한다. `local_archive_section_restore.test.cjs`, `verify_workfile_ctrl_f5_archive_bootstrap_cdp_v195.cjs` |
| `SAVE-06` | Cafe24 최종 등록 경계 | 등록용 상품명은 Cafe24 payload에만 반영되고, 등록 성공·실패 모두 현재 작업명·후보·필수값·이미지와 작업 식별자는 그대로 유지 |
| `SAVE-07` | 작업파일 표시 이름과 제품 식별자 분리 | `7월 Cafe24 등록용 최종본`처럼 제품명과 무관한 표시 이름을 써도 현재 제품의 대표·사이즈·옵션·컷·상세 자산과 선택 상태를 격리하거나 초기화하지 않음 |
| `SAVE-08` | 같은 작업공간 서버 정상본 복원 | 브라우저에 오래된 다른 상품명이 남아 있어도 같은 `workspaceId` 서버 스냅샷의 제품명·실행ID·이미지 지문을 우선 복원하고, 자산 `rejected=0`, 완료 단계와 선택을 유지 |
| `SAVE-09` | 회귀 실행기 저장소 격리 | `verify_factory_integrity_cdp_v80.cjs`가 전용 `regression:factory-integrity-v80` 작업공간만 사용하며 실제 전역·작업공간별 마지막 작업 스냅샷의 실행 전후 SHA-256이 동일 |
| `SAVE-10` | 상세 이미지 참조 보존 | 서버에서 복원된 로컬 아카이브 URL 위로 작업파일의 IndexedDB 표식이 들어와도 URL을 유지하고, 15개 고유 이미지가 모두 HTTP 200·브라우저 `naturalWidth > 0`으로 표시 |
| `SAVE-11` | 복구 상세섹션 Cafe24 전송 범위 | 최상위 `sectionWorkScope`가 없거나 오래됐어도 15개 개별 섹션의 실행ID·상품키·입력 이미지 지문이 모두 현재 작업과 일치하면 전송 허용한다. 같은 작업 범위의 14/15처럼 부분 미리보기는 `14/15개 섹션 생성` 확인창 뒤 진행할 수 있고, 실행ID·상품키·입력 이미지 지문이 하나라도 불일치하면 계속 차단한다. `factory_core_contracts.test.cjs` |
| `SAVE-11A` | Cafe24 상세 이미지 원본 fallback | 보관 로컬 이미지 `/image`가 404여도 같은 자산 메타데이터의 보존 `imageDataUrl`을 사용해 상세 HTML을 복원하고, 하나의 누락 원본 때문에 전체 상세 HTML을 텍스트로 축소하지 않는다. `cafe24_detail_image_hydration.test.cjs` |
| `SAVE-11B` | 신화사 자산관 동기화 중복 경고 억제 | 같은 작업 묶음에서 동일한 자산관 API 오류가 재시도되어도 전역 로그는 한 번만 기록하고, 다른 오류는 새로 표시하며 성공 후 같은 오류가 다시 발생하면 다시 기록한다. `work_bundle_sync_warning_dedupe.test.cjs` |
| `SAVE-12` | 최종 등록 command·lease·확인창 | 기본정보 `fieldReview` 변경을 허용한 단일 operation lease 안에서 실행하며, native `confirm` 없이 DOM 확인창의 `확인하고 등록 실행` 버튼으로 자동화 가능 |
| `SAVE-13` | 저장 초안 시작 복원 순서 | 상세 HTML 자산 정리 중 앱 `state` 초기화 전 접근이 없고, 저장된 `.kuasangse` 초안이 `ReferenceError` 없이 복원 |
| `SAVE-14` | Cafe24 상세 HTML 안전 보존 | 안전한 `style`·stylesheet `link`·charset/viewport `meta`는 유지하고, 실행 태그·이벤트 속성·위험 CSS URL·meta refresh는 차단하며 정제 결과가 비면 전송을 중단 |
| `SAVE-15` | 기존 Cafe24 상품 최종화 | 기존 상품 수정은 기본정보 저장 뒤 현재 상세 HTML과 상품 이미지 동기화를 끝내고, 읽기 API에서 상세 HTML과 이미지 경로를 다시 확인한 뒤에만 완료 처리 |
| `SAVE-16` | 최종 등록 operation revision 격리 | 최종 등록 operation lease가 활성인 동안 Cafe24 OAuth 자동 상태 갱신은 store revision을 선점하지 않아 등록 성공·실패 transaction이 stale 없이 각각 한 번 커밋 |
| `SAVE-17` | 최신 replica 뒤 자동 저장·작업파일 내보내기 | 같은 scope·lease·fence의 IndexedDB가 현재 권위보다 앞선 경우 그 revision만 관찰하고 세션 이미지 저장을 1회 재시도하며, 작업파일 내보내기는 축약 project payload 대신 현재의 풍부한 last-work 스냅샷을 서버 보호 검사에 사용해 로컬 파일 저장을 차단하지 않음 |
| `SAVE-18` | 필수값·옵션 확인의 durable commit | 전체/개별 확인과 `옵션 없음`·옵션 매칭은 owned transaction을 commit한 뒤 `force` 저장을 예약하고, 같은 작업파일을 다시 열어도 확인값과 옵션 완료 상태가 유지됨 |
| `SAVE-19` | canonical server snapshot | 자동·수동 서버 저장 payload는 commit된 factory snapshot과 동일한 scope/revision을 사용하며, 렌더용 mirror가 늦어도 이전 상태를 서버에 쓰지 않음 |
| `SAVE-20` | 옵션 없음 섹션 축소 허용 범위 | `optionMode=none`, `options=done`일 때만 `size_color` 한 섹션 제거를 허용하고, 나머지 섹션·이미지·Cafe24 설정은 그대로 보존 |
| `SAVE-21` | 백엔드 재시작 뒤 옵션 결정 보호 | 완료 스냅샷 `optionMode=none/options=done` 뒤 오래된 탭의 `pending/idle` 저장은 거절하고 서버 revision과 완료 결정을 유지하며, 구체 모드에서 다른 구체 모드로의 정상 변경은 허용 |
| `SAVE-22` | 새 작업 전 저장 선택 | `새 작업` 확인창의 실제 `저장` 버튼이 현재 입력 이름을 공유 스코프에서 읽고 브라우저 작업본과 `.kuasangse` 파일을 각각 한 번 보존한 뒤에만 새 작업 전환을 계속하며, 선언되지 않은 식별자 오류로 취소되지 않음 |
| `SAVE-23` | 새 작업 뒤 현재 작업파일 identity 분리 | 빈 새 작업의 상단 작업파일 제목·현재 보관함 기준은 legacy `state.factory` 미러가 아니라 canonical runtime snapshot을 읽고, 최근 저장 목록은 유지 |
| `SAVE-24` | 최근 작업파일 표시·새 작업 뒤 파일 위치 힌트 | 저장한 `.kuasangse` 파일명은 제품명과 분리해 최근 카드에 표시하고, 새 작업은 현재 파일 표시를 비우되 같은 세션의 저장 핸들은 다음 불러오기 `startIn`으로 유지. `menu_navigation_characterization.test.cjs`, `verify_factory_new_file_blank_cdp_v85.cjs`, `verify_workfile_picker_location_cdp_v121.cjs` |
| `SAVE-25` | PSD식 문서·탭 분기·새 작업 격리 | `.kuasangse` 파일은 문서 ID, 각 탭은 독립 `draft:` 분기다. 같은 파일을 A/B에서 열어 서로 다른 상품명으로 편집하고 Ctrl+F5해도 각 탭 값과 분기가 유지된다. A 저장은 문서 revision만 갱신하며 B의 미저장 분기를 바꾸지 않고, B가 명시적으로 다시 열 때만 A 저장본을 새 분기로 받는다. 모든 자동 복원 뒤 편집권은 각 탭 분기에 남고 전체 앱은 `inert`가 아니어야 한다. `새 작업`은 새 빈 분기를 영속화해 Ctrl+F5 뒤에도 빈 상태를 유지하며 기존 탭과 문서를 바꾸지 않는다. `workspace_work_identity_runtime_contract.test.cjs`, `persistence_destination_cas.test.cjs`, `verify_new_work_multitab_reload_isolation_v371.cjs` |
| `SAVE-26` | 현재 상태 저장 후보·자산 복원 | 상단 `현재 상태 저장`은 장시간 렌더 draft가 아니라 커밋된 Store 스냅샷으로 작업파일을 만들고, 같은 트랜잭션에 IndexedDB `sessionAssets` 복제본까지 기록한다. 저장 직후 F5에서 DB/Cafe24 대기 후보 수·OAuth 상태·최근 작업 카드가 저장 시점과 같아야 한다. `architecture_source_contracts.test.cjs` |
| `SAVE-27` | 임시 초안 F5 생성컷 범위 복구 | 현재 작업 범위와 생성컷 범위가 서로 다른 `draft:lastwork_*`이고, 대표·사이즈·이미지컷 전체가 상품키·입력 이미지 지문·실행ID·단계 기준으로 일관되며 이전 draft 범위가 정확히 하나일 때만 현재 draft 범위로 재지정한다. project↔draft, 여러 이전 범위, 식별값 불일치는 계속 격리한다. 실제 Chrome F5 두 번 뒤 대표 3·사이즈 2·이미지컷 3, `이전 제품 격리` 0건이어야 한다. `task7_workspace_startup_scope_contracts.test.cjs` |
| `SAVE-28` | 완성 프로젝트 탭 F5 bootstrap 복원 | F5 시작 시 lock이 임시 draft scope여도 현재 탭 `sessionStorage`의 fenced 프로젝트 bootstrap은 프로젝트 ID·작업명·단계를 먼저 복원할 수 있어야 한다. 다른 탭의 공유 bootstrap과 session payload는 기존 authority 검사를 계속 통과해야 하며, 완성 공정이 0% 초안으로 내려가면 실패다. `persistence_destination_cas.test.cjs` |
| `SAVE-29` | F5 서버 영수증 우선·새 작업 분리 | 프로젝트 F5 시작 복원은 같은 scope의 검증된 서버 영수증을 오래된 로컬 replica revision보다 우선 적용하고, 복원 전/중 자동저장은 큐에서 최신 서버 상태로 다시 배출한다. Cafe24 등록 뒤 F5 중 100ms 추적에서 `product_no`·등록 방식이 이전 후보로 한 번도 돌아가지 않아야 한다. 새 작업은 별도 `draft:lastwork_*` scope를 만들고 다른 탭의 상품명·상단 제목을 섞지 않는다. `architecture_source_contracts.test.cjs`, `task8_restore_lifecycle_behavior.test.cjs`, `verify_new_work_multitab_reload_isolation_v371.cjs` |
| `SAVE-30` | 미리보기 저장 표식 자동 복원 | 완성 작업의 `sectionImages`가 `__stored_in_indexeddb__` 표식만 가진 채 복원돼도 미리보기 진입 시 같은 제품·원본 지문의 로컬 섹션 보관본을 자동 연결한다. `size_color`는 동일 범위의 최신 옵션표 보관본을 사용하며, F5 뒤 15개 섹션 이미지가 모두 표시되고 깨진 이미지가 없어야 한다. `local_archive_section_restore.test.cjs` |
| `SAVE-31` | 작업파일별 로컬 이미지 자료함 | 저장·폴더 열기 때 동일 작업파일의 현재 스냅샷과 과거 초안 보관본을 14개 고정 INPUT/OUTPUT 폴더로 정리한다. 원본은 이동·삭제하지 않고 내용 해시로 중복을 제거하며, manifest에 없는 파생 사본만 제거한다. 아카이브 인덱스 5,000건 밖의 과거 자산과 안전한 로컬 이미지 URL도 포함하고, 실제 파일 수와 manifest 수가 같아야 한다. `test_local_asset_library.py`, `test_archive_contracts.py` |
| `SAVE-32` | 일부 단계만 비어 있는 로컬 아카이브 복원 | 대표·이미지컷 등 다른 단계가 이미 복원돼 있어도 현재 작업의 사이즈·색상옵션·섹션 중 빠진 단계가 있으면 아카이브 bootstrap을 생략하지 않는다. 현재 workspace·상품·입력 지문과 일치하는 빠진 단계만 보완하고 기존 복원 자산은 중복하거나 덮지 않는다. `local_archive_section_restore.test.cjs` |
| `SAVE-33` | 완전 복원 뒤 거짓 이미지 실패 경고 차단 | 실제 URL이 복원된 분석/입력 이미지와 동일 범위의 레거시 marker-only 레코드는 현재 실체 이미지로 충족된 것으로 계산한다. 명시적 다른 지문은 계속 누락으로 세고, `archived`·`rejected` 생성 자산은 경고 집계에서 제외한다. 실제 Chrome F5 뒤 입력 1장·결과 7장·사이즈 3/3 상태에서 복원 실패 경고와 오류 바가 모두 0건이어야 한다. `session_asset_restore_warning.test.cjs` |
| `SAVE-34` | 작업파일·제품명·기본이미지 불변 identity | 작업을 처음 확정할 때 `instanceId`·작업 scope·최초 제품명·최초 기본이미지 지문을 한 묶음으로 봉인한다. session/IndexedDB/server/workfile/archive 어느 복원본이든 네 값 중 하나가 다르거나 내부 제품명·이미지 지문이 충돌하면 일부 필드를 합치지 않고 그 복원본 전체를 거부한다. 활성 작업 키와 제품별 캐시는 탭 전용 `sessionStorage`에만 두며, 새 작업·다른 이름 저장에서만 새 identity를 만든다. 화면 우측 고정 카드에는 현재 작업파일·최초 제품명·기본이미지를 항상 표시한다. `workspace_work_identity_contract.test.cjs`, `workspace_work_identity_runtime_contract.test.cjs`, `persistence_destination_cas.test.cjs` |
| `SAVE-35` | 복원 입력 픽셀 지문 교차오염 차단 | F5·작업파일·세션 자산 복원 시 선언된 `initialInputImageFingerprint`와 실제 inline `base64/preview` 픽셀을 다시 계산해 비교한다. 불일치 픽셀은 활성 작업에 병합하지 않고 제거하며, 원본이 보관 표식만 있는 경우에는 `기본 이미지 복구 필요`로 표시한다. 다른 제품의 이미지를 조용히 대체하거나 정상 작업을 `혼합 차단됨`으로 오판하지 않아야 한다. `workfile_identity_f5_restore.test.cjs`, `workspace_image_identity_restore.test.cjs`, 실제 Chrome F5 게이트 |
| `SAVE-36` | 시작 복원 중 명시적 제품 전환 fence | 같은 작업 scope 안에서도 사용자가 제품명·기본 이미지를 바꾸면 background hydrate intent를 즉시 폐기한다. 이미 시작한 session/server/archive 복원은 이후 상태를 적용할 수 없고, 취소 시점에 대기 중이던 현재 사용자 입력 저장만 hydrate 완료 뒤 재개한다. `task8_restore_lifecycle_behavior.test.cjs`, `workspace_work_identity_runtime_contract.test.cjs` |
| `SAVE-37` | 작업파일 불러오기 직후 F5 기본이미지 내구성 | 작업파일 불러오기 완료는 작업 브랜치별 기본 이미지 백업을 먼저 영속화하고 문서 fence를 다시 확인한 뒤 lightweight session을 커밋해야 한다. 서버 lease가 없는 `offline-edit` 초안의 release는 같은 초안 scope를 유지하는 정상 no-op이다. 20MB 이상 작업파일을 불러온 즉시 F5 해도 입력 이미지 지문·15개 섹션·섹션 이미지가 같고 누락 원본 경고가 0건이어야 한다. `architecture_source_contracts.test.cjs`, `FULL-06` |
| `SAVE-38` | 최근 저장 작업의 보관 이미지 자동 연결 | 최근 작업 카드를 열면 범위 전환이 끝난 뒤 해당 작업의 로컬 보관 목록을 자동 갱신한다. 대표·이미지컷처럼 저장 asset이 정확한 archive ID를 가진 결과는 원본 누락으로 오표시하지 않으며, 실제 Chrome에서 작업 열기와 F5 뒤에도 보관 목록·결과 카드가 유지된다. 빈 초기화는 명시 `새 작업` 확인 뒤에만 허용한다. `workfile_archive_autorefresh.test.cjs`, `session_asset_restore_warning.test.cjs`, 실제 Chrome 수동 게이트 |
| `SAVE-39` | 부분 렌더 뒤 로컬 보관함 action 재연결 | assets 탭 본문을 부분 `morphNode()`로 교체한 뒤 현재 DOM의 `로컬 목록 새로고침`·`현재 작업 후보로 복원`·개별 보관 자산 불러오기 버튼에 직접 handler를 다시 연결한다. 전체 렌더와 부분 렌더가 같은 binder를 사용하며, 실제 Chrome에서 복원 뒤 새로고침해도 현재 작업 이미지 수가 유지되어야 한다. `local_archive_event_delegation.test.cjs`, 실제 Chrome 수동 게이트 |
| `SAVE-40` | same-input legacy marker 복원 | 현재 저장 작업에 `metadata.localArchiveId` 또는 `sourceMap.localArchiveId`만 남고 실제 image/dataUrl/result/html payload가 빠진 대표·이미지컷은 화면에 없는 stale reference다. 현재 workspace의 이미지는 중복하지 않되, 같은 상품·입력 지문의 `draft:lastwork_*` 보관본은 정확히 같은 archive ID marker가 있어도 명시 복원 대상으로 남겨야 한다. `factory_archive_identity_recovery.test.cjs`, 실제 Chrome 수동 게이트 |
| `SAVE-41` | Ctrl+F5 뒤 session revision 충돌 재조정 | 강력 새로고침 직후 탭 `pdp_session` 복구본이 같은 scope·lease·fence의 현재 lock보다 앞서 있으면, 프로젝트 편집은 서버 승인 snapshot으로 같은 revision replica를 교체한다. `offline-edit` 초안은 첫 필수값 저장 안에서 그 더 높은 tab-local revision을 관측하고 새 revision으로 한 번 재기준화해 저장한다. 따라서 사용자가 그 사이 바로 새로고침해도 첫 저장이 부분 실패로 남지 않는다. 다른 lease·fence는 계속 덮어쓰지 않는다. `session_same_revision_recovery_reconciliation.test.cjs`, 실제 Chrome 수동 게이트 |
| `SAVE-42` | 필수값 확정은 지연 타이머 전에 저장 시작 | `factory/fields:commitField` 등 `forceSave:true` 명령은 최신 canonical factory snapshot을 즉시 `saveLastWorkNow()`에 넘긴다. 이후 탭 전이나 렌더가 다른 저장 타이머를 교체해도 확정 필수값이 session commit 경계에 도달해야 한다. `force_save_immediate_persistence.test.cjs`, 실제 Chrome 수동 게이트 |
| `SAVE-43` | 실제 Chrome 강력 새로고침 저장 확인 | 수정한 필수값은 사용자 Chrome의 최신 앱 탭에서 고유 확정 컨트롤을 직접 활성화한 뒤 일반 새로고침과 캐시 무시 강력 새로고침 모두에서 같은 읽기 전용 값으로 복원되어야 한다. 자동 테스트·HTTP 응답만으로 해결 처리하지 않으며, 실제 runtime bundle build ID와 `replica revision is already occupied` 저장 오류 0건 read-back을 함께 남긴다. `session_same_revision_recovery_reconciliation.test.cjs`, `workspace_scoped_assets_contracts.test.cjs`, 실제 Chrome 수동 게이트 |
| `SAVE-38` | 최근 작업·저장 버전 교체 경계 checkpoint | 최근 작업 또는 저장 버전을 명시적으로 열 때 `markWorkspaceBlankResetBoundary()` 이후의 첫 session 저장은 일반 자동저장 fence가 아니라 교체 전용 checkpoint로 실행한다. 새 `draft:` scope와 해당 reset token을 함께 검증해 성공한 뒤에만 불러오기를 완료하며, checkpoint가 없거나 scope/token이 다르면 이전 화면을 보존한 채 실패해야 한다. `workfile_explicit_open_authority.test.cjs` |
| `ARCHIVE-LEASE-01` | 생성 중 백그라운드 로컬 복원 revision 경합 차단 | 대표·사이즈·이미지컷 생성 또는 다른 공정 lease가 살아 있는 동안 자동 로컬 아카이브 새로고침은 fetch/bootstrap/restore를 시작하지 않고, 현재 작업 signature가 같을 때 작업 종료 뒤 한 번만 재시도한다. 생성 결과가 아카이브에 저장된 뒤에도 `STALE_FACTORY_STORE_REVISION`으로 후보가 초기 대기 상태로 롤백되지 않고 현재 작업 범위의 후보 카드로 남아야 한다. `factory_archive_identity_recovery.test.cjs`, `GENERATE-01`, `task7_factory_store_authority.test.cjs`, `factory-store-runtime.mjs` lease-key 게이트 |
| `ARCHIVE-LEASE-02` | 로컬 아카이브 비동기 응답의 작업 브랜치 fence | 자동 아카이브 조회가 시작된 뒤 다른 PSD식 탭 브랜치로 전환되거나 authority fencing token이 바뀌면 이전 응답은 자산·경고·진행 상태를 0건 반영해야 한다. bootstrap은 현재 브랜치의 편집권을 빌리거나 다른 브랜치로 바꾸지 않는 읽기 전용 작업이어야 한다. `local_archive_section_restore.test.cjs` |
| `CAFE24-01` | 신규 상품 적립금 payload | `%` 적립률은 숫자 `points_rate`와 `points_unit_by_payment=P`, 원 단위 적립금은 `points_unit_by_payment=W`로 전송하여 기본 적립금 단위가 없는 몰에서도 422 없이 생성 |
| `CAFE24-02` | 상품 이미지 API 계약 | 상품 이미지 요청은 `shop_no`와 중첩 `request` envelope를 사용하고 각 슬롯을 완전한 `data:image/...;base64,...` URL로 전송하며, 저장 뒤 4개 경로를 읽기 API로 재확인 |
| `CAFE24-03` | OAuth 자동 갱신 연속성 | 일시적인 5xx/네트워크 갱신 실패는 연결을 영구 `reauth_required`로 잠그지 않고 다음 유지 주기에 재시도한다. 저장 상태가 이미 `reauth_required`여도 refresh token이 유효하면 명시적 복구 갱신을 한 번 허용하며, `invalid_grant` 또는 refresh token 만료만 재승인 상태로 유지한다. Control Tower `tokenHealth.test.ts` |
| `CAFE24-CREATE-TARGET-01` | 신규 상품 후속 대상 고정 | 상품번호를 받은 즉시 같은 상품을 update 대상으로 고정하고, 이후 작업파일 저장·복원 뒤에도 신규 등록 버튼이 같은 상품을 다시 만들지 않음 |
| `VM-01` | VM 브리지 요청·결과 계약 | VM 전송·진행·결과·상세수집 범위와 VM 출처 증거가 보존 |
| `VM-02` | VM 후보 범위 | 실행ID·상품키·이미지 지문·단계 중 하나라도 다르면 현재 후보 0건 |
| `VM-03` | VM 후보 카드 캐시 정합성 | 현재 VM 검색의 `results/groupedResults`에 후보가 있으면 빈 `vmResults/vmGroupedResults` 캐시가 있어도 선택 카드와 VM 후보 수가 실제 결과 건수로 표시 |
| `VM-04` | 최근 VM 상세이미지 복구와 공정 진행률 동기화 | 자동 복구는 같은 선택 작업 범위만 허용하고, 사용자가 누른 `최근 VM 상세이미지 불러오기`만 현재 제품명 기준 복구를 허용한다. 복구 이미지는 경쟁사 상태에, 처리 건수·검수 상태는 조립공장 `stages.detail`에 각각 커밋되어 이미지가 보이면서 공정이 `0%/5%`에 머무르지 않으며, 현재 제품 기준 복구는 `검수 필요 · 100%`로 표시한다. `factory_size_vm_latency_regression.test.cjs` |
| `VM-05` | 작업파일 후보 mirror·선택 복원 | 전체 작업키와 레거시 suffix 작업키를 동일한 run/product/image/stage 범위로 인정하고, 조립공장 canonical 후보 mirror가 비어 있어도 저장된 factory 후보 rows와 선택 1건을 화면 snapshot에서 유지한다. 저장본 열기·일반 새로고침·Ctrl+F5 뒤 실제 Chrome에서 VM 14건·선택 1건·DB 8건·Cafe24 24건을 다시 읽는다. `workfile_legacy_candidate_scope_restore.test.cjs`, 실제 Chrome 수동 게이트 |
| `VM-05` | G마켓 수동 재시도와 guest 로컬 실행 경계 | 수동 재시도는 이전 `vm_worker_search_id`·`source_session_id`를 새 상세수집 요청에 재사용하지 않고, guest 브리지는 `capture_runtime/runtime/execution_profile=local`을 강제해 다시 `/api/scrape_details`로 위임하는 재귀를 막는다. 실제 단일 G마켓 작업은 `completed=1`, `failed=0`으로 끝나며 worker create 경로가 `/api/v1/detail-captures`이고 같은 실행 뒤 중첩 `/api/scrape_details` 호출이 없어야 한다. |
| `VM-06` | 경쟁사 상세이미지 선택·확대의 렌더 교체 내구성 | 경쟁사 버튼 위임은 교체되는 `.factory-page`가 아니라 안정적인 `document` capture에 한 번만 결합한다. 이미지 선택 직후 상태 카드가 `0장→1장`으로 바뀌고 분석 버튼이 활성화되며, 확대 모달은 `body` 포털에서 열리고 포털 밖 닫기 버튼도 같은 owner 명령으로 닫힌다. 경쟁사 탭 또는 조립공장을 떠나면 포털을 제거하고, VM 진행률 저장의 `savePersistentState=false`는 후보·이미지 선택 영속 저장도 함께 건너뛰어 백그라운드 polling이 사용자 선택을 덮지 않는다. `factory_size_vm_latency_regression.test.cjs` |
| `SAVE-CUTS-01` | 작업파일 직렬화의 이미지컷 입력 이미지 중복 제거 | `stripCutsImages` 의 `preserveRecentResults` 는 '최근 생성 결과' 보존만 통제하고, '원본/작업 입력 이미지'(`sourceBase64`·`sourcePreview`·`workImageBase64`·`workImagePreview`) 제거는 `dropInputImages` 로 따로 통제한다. 직렬화 경로(`buildLightweightSessionPayload`, `currentSessionAssetsPayload`의 `includeImages:false`)만 입력 이미지를 벗기고 `hasSourceImage`/`hasWorkImage` 복원 마커를 남기며, 최근 생성 결과는 그대로 보존한다. 런타임 state 대입 경로는 플래그를 켜지 않아 작업 중 세션의 이미지를 유지하고, `assets` 권위본은 `includeImages:true` 분기로 `stripCutsImages` 를 지나지 않는다. 실측: 108.66MB 작업파일이 25.57MB 로 76% 감소(고유 이미지 1장이 20벌 저장되던 상태). `cuts_input_image_serialization.test.cjs` |
| `LLM-FALLBACK-01` | 사용량 한도 폴백 | 기본 실행 provider 는 `gpt_oauth` 로 유지하고, 응답이 사용량 한도(`codex-usage-limit`·`429`·`quota`·`rate limit`·`한도`)로 거절될 때만 사용자가 모델 설정에서 지정한 폴백(OpenAI API 또는 로컬 Ollama)으로 정확히 한 번 재시도한다. 한도가 아닌 실패(키 없음·네트워크·JSON 파싱)는 폴백하지 않고 원래 오류를 그대로 보고하며, 기본과 폴백이 같은 provider·모델이면 재시도하지 않는다. 폴백 결과에는 실제로 응답한 모델을 `__fallbackUsed` 로 표시하고 진행 로그에 전환 사실을 남긴다. 폴백 준비 실패(OpenAI 키 없음)와 폴백 자체 실패는 원래 한도 사유와 함께 한 메시지로 합쳐 보고한다. 로컬 Ollama 는 vision 실측을 통과한 모델만 등록하고(`gemma4-26b`·`mistral-small` 등 vision 미지원 모델 등록 금지), 이미지 생성 요청은 조용히 실패하지 않고 명확히 거절한다. `llm_usage_limit_fallback.test.cjs` |
| `MARKET-ANALYZE-01` | 경쟁사 이미지 분석 시작 실패의 화면 복구 | 화면의 분석 중 판정은 `compPage.subStep === 'analyzing'` 하나에 걸려 있고 그 동안 복구 버튼이 숨겨지므로, `startCompetitorAnalysis()`가 시작하지 못하고 되돌아가는 모든 경로(LLM 클라이언트 생성 실패, 이미지·HTML·URL 입력 없음)는 반드시 `subStep`을 `input`으로 되돌리고 진행률 티커를 멈추며 `market.loading=false`·`phase='analyze-error'`로 정리해 실패 사유를 남겨야 한다. 또한 부팅 시 1회 조회가 실패해 남은 `gptOAuthStatusError`로 정상 연결을 막지 않도록 `getLLMClient()` 게이트 직전에 상태를 다시 확인한다. 조용한 `return`으로 `analyzing`이 남으면 버튼이 영구히 비활성 `분석 진행 중...`이 되어 새로고침 외에는 탈출할 수 없다. `competitor_analyze_start_failure_recovery.test.cjs` |
| `VM-07` | F5 후보·상세 이미지 원자 복원 | 후보 보관함 복원 직후 빈 `vmResults/localResults`가 복원 후보를 다시 0건으로 덮지 않는다. 상세수집 성공·부분완료는 최종 factory 저장을 기다리고 같은 후보 스냅샷에 상세 이미지·분석 선택·detail operation을 동기 저장한다. 실제 Chrome에서 같은 작업을 F5 두 번 해도 VM 후보 13·선택 2·상세 이미지 4가 모두 유지되어야 한다. `comp_market_finalize_results.test.cjs`, `task7_factory_store_authority.test.cjs` |
| `VM-08` | 다른 상품 후보 재라벨링·무관 결과 격리·대체 검색 순서 | `market.results`에 남은 다른 작업의 무표식 행은 현재 `search_id`·scope로 덮어쓰지 않는다. 검색 결과가 비어 있지 않아도 후보 제목이 실행 검색어와 무관하면 선택 카드에서 격리하고 `제품명 → 자연어 힌트 → GPT 동의어/용도명` 순으로 한 검색어씩 대체한다. `양단호박바늘쌈` 검색에서 `담터 단호박 마차 50T`와 `크리스탈 보자기`는 0건으로 처리하고 `호박 모양 전통 바늘쌈지`는 관련 후보로 통과해야 한다. 사이트별 확보 수는 원시 응답이 아니라 관련성 필터를 통과한 후보 카드와 일치해야 한다. `comp_market_finalize_results.test.cjs` |
| `VM-09` | VM·내 Windows Chrome 수집 경로 선택과 무음 fallback 차단 | 조립공장 경쟁사 탭은 `VM에서 수집`과 `내 Windows Chrome에서 수집`을 별도 버튼으로 제공한다. VM 버튼은 `competitors.compPage` 쓰기 권한을 가진 명령으로 실제 VM 공유폴더 브리지에만 요청하며, 실패·0건이어도 본컴 수집으로 자동 전환하지 않는다. 실제 수동 게이트에서는 버튼 클릭 뒤 VM worker에 새로운 `search_id`가 생기고 본컴 worker 작업 수가 증가하지 않아야 한다. `factory_local_service_preflight.test.cjs`, `task7_factory_competitor_tab.test.cjs` |
| `VM-10` | 장시간 VM 결과 객체 정체성·화면 handoff | VM polling 중 상태 정규화·렌더·저장이 반복돼도 처음 실행 함수가 보유한 `marketScrape` 객체를 교체하지 않는다. 완료 뒤 화면 `search_id`는 방금 완료된 VM worker ID와 같고, 후보 카드·마켓별 승인 수는 그 ID의 결과만 표시해야 한다. `comp_market_state_identity.test.cjs`, `comp_market_finalize_results.test.cjs`, 실제 Chrome `search_992a3c99c20`·VM 후보 13건 확인 |
| `VM-11` | VM 후보 재수집 장시간 transaction 단일 lease | `rerun-vm-competitors`는 짧은 시작 커밋 뒤 operation lease를 획득하고 정확 검색·관련성 필터·자연어 힌트 재검색·후보 확정까지 유지한다. 중간 렌더·저장·진행률 동기화가 store revision을 앞질러 `STALE_FACTORY_STORE_REVISION`으로 최종 후보 반영을 취소하면 안 된다. `factory_candidate_apply_command_policy.test.cjs` |
| `VM-12` | 새 VM 수집의 stale 후보 차단·화면 handoff·완료 상태 | 새 VM 수집을 시작하면 이전 후보 snapshot 복원을 억제하고, 0건·무관 결과 뒤 자연어 대체 검색이 끝나기 전까지 이전 `search_id`와 후보를 새 성공으로 세지 않는다. guest bridge는 backend가 이미 만든 heartbeat·result·artifact 디렉터리를 다시 생성하지 않고 그대로 사용해야 한다. 성공 시 이전 실패 문구를 지우고 방금 완료된 VM `search_id`와 관련 후보만 표시한다. 저장된 전역 `competitors.compPage`가 비어 있어도 commit된 `factory.competitors.compPage`의 VM 후보가 후보 카드와 건수에 그대로 나타나야 하며, 후보 정리 뒤 병렬 공정은 `100% 완료`로 끝나야 한다. `factory_vm_result_handoff_cards.test.cjs`, `factory_local_service_preflight.test.cjs`, `verify_vm_candidate_bridge_contract.cjs`, 실제 Chrome VM 후보 16건 카드 확인 |
| `VM-13` | 영수증·보안확인 화면 수동 정지 | guest worker가 `login_required`, `manual_required`, `blocked`, `captcha_blocked`, `empty_or_blocked`, `cooldown`을 감지하면 같은 상세 job의 브라우저 fallback과 자동 재시도를 즉시 중단한다. bridge와 앱은 terminal error보다 `manual_action_required`를 먼저 보존하며, 사용자가 조치 완료를 누르기 전까지 새 브라우저 창을 열지 않는다. VM 배포는 오래된 `Z:` 매핑보다 현재 `\\VBOXSVR\KuasangseBootstrap` 공유 원본을 우선하고, 배포 뒤 guest 원본 SHA-256이 stage와 같아야 한다. `vm_detail_manual_pause.test.cjs`, `verify_vm_candidate_bridge_contract.cjs` |
| `VM-13A` | Naver 빈 오류 수동중단·재부팅 보존 | Naver 상세 worker가 빈 오류로 끝나더라도 guest bridge 원본 `status.json`은 `manual_required`와 `naver_manual_verification_suspected`를 저장한다. ProgramData 영구 bridge/bootstrap은 호스트 원본과 SHA-256이 같아야 하며, 재부팅한 watcher는 `manual_required` 요청을 명시적 재개 없이 다시 실행하지 않는다. `test_vm_naver_catalog_manual_gate.cjs`, `test_vm_naver_silent_worker_manual_gate.cjs`, `test_vm_candidate_bridge.py::test_powershell_watcher_never_reexecutes_manual_required_request` |
| `VM-14` | VM 워커 인증키 회전·공통 오류 표시 | guest watcher는 실제 워커 `.env`의 `JEPUM_API_KEY`를 정본으로 읽고 ProgramData의 이전 키는 `.env`가 없을 때만 사용한다. 오래된 상태 키가 남아도 보호 API와 후보 요청은 401 없이 완료되어야 한다. 공통 인증·브리지 오류는 장터별 실패 사유로 복제하지 않고 단일 경고로 표시하며, 보존된 초록 후보는 이전 성공 결과임을 명시한다. `test_vm_candidate_bridge.py`, `comp_market_finalize_results.test.cjs` |
| `VM-15` | 네이버 카탈로그 후보의 판매자 상세 URL 해석 | `search.shopping.naver.com/catalog/*` 후보는 주소창 스크립트보다 먼저 현재 Chrome DOM의 `smartstore.naver.com`, `brand.naver.com`, `shopping.naver.com/window-products` 직접 상품 링크를 CDP로 찾아 이동한다. 로그인·OTP 화면이면 수동 확인 상태를 보존하고, 직접 판매자 URL이면 동일 VM에서 긴 상세 이미지 수집을 완료해야 한다. `test_naver_catalog_resolution.py`, `test_naver_vm_chrome_session.py`, `test_vm_detail_transport_recovery.py` 및 실제 네이버 단일 후보 수동 게이트 |
| `VM-16` | 경쟁사 외부 실행의 request-time workspace fencing | `rerun-vm-competitors` 클릭 시 request-time operation token을 먼저 고정하고 다음 실행 tick에서 다시 검증한 뒤에만 VM worker를 시작한다. 그 사이 작업파일이 바뀌면 worker 호출 0건으로 stale 폐기하며, 장시간 완료 영수증은 원래 token을 현재 token으로 바꿔치기하지 않고 원래 workspace가 아니면 거부한다. `task7_factory_runtime_integration.test.cjs`, `task7_factory_competitor_tab.test.cjs` |
| `VM-17` | 선택 snapshot·상세수집 state 인계 | 상세수집 대기 중 선택 또는 operation이 교체되면 이전 요청의 결과는 새 목록에 반영하지 않되, 이전 goal heartbeat를 즉시 종료한다. 최신 선택 snapshot이 더 오래된 빈 canonical mirror에 전달될 때는 해당 선택만 수집하고, 더 최신의 사용자 선택 해제는 절대 되살리지 않는다. 상세수집 진행 상태는 canonical `competitors.compPage`와 화면이 읽는 `factory.competitors.compPage`에 같은 선택·operation·이미지 결과로 함께 동기화해 `선택 0건` 또는 selection-changed 오표시를 만들면 안 된다. 검색 ID가 없는 복원 VM 후보도 직접 상세수집 브리지 작업으로 제출해 legacy `/api/scrape_details` 대기 경로로 빠지지 않아야 한다. 상세수집 전 화면 프레임 대기는 background Chrome에서 영구 대기하지 않고 짧은 fallback 뒤 계속되며, 준비 확인도 실제 작업 생성과 같은 `/health` VM 브리지를 사용한다. `진행 중/96%`가 남지 않고 stale UI는 terminal review 상태가 되어 새 선택의 VM 상세수집 버튼을 다시 사용할 수 있어야 한다. `task7_factory_store_authority.test.cjs`, `factory_size_vm_latency_regression.test.cjs`, 실제 Chrome 수동 게이트 |
| `VM-18` | VM 상세수집 준비 확인의 Chrome CORS 경계 | 프런트엔드 `http://127.0.0.1:8081`이 실제 VM 브리지 `http://127.0.0.1:5050/health`를 호출할 때 `Access-Control-Allow-Origin`이 있어야 한다. 터미널의 200만으로 준비 완료를 판정하지 않고, 실제 Chrome에서 선택 후보 VM 상세수집을 활성화한 뒤 새 job ID 생성 → `completed=1`·`failed=0` → 수집 이미지 1장 이상까지 read-back한다. `backend/tests/test_scrapling_api.py::test_health_alias_allows_local_chrome_origin`, 실제 Chrome 수동 게이트 |
| `CMD-UI-01` | 경쟁사 패널 토글 명령 경계 | `전체 수집판 펼치기/접기`는 `automation.competitorPanelOpen`만 커밋하고 전체 저장을 중첩 호출해 `lastSavedAt` 경계 오류를 만들지 않음 |
| `CMD-UI-02` | 조립공장→옵션 분류기 진입 명령 경계 | `openFactoryOptionSorter`는 소유 중인 factory draft를 명시해 저장하고, `factory/assets` 명령에 `lastSavedAt` 메타데이터 쓰기를 섞어 `FACTORY_COMMAND_PATH_REJECTED`를 만들지 않음 |
| `RESTORE-UI-01` | 후보 검수 상태 색상 | `후보 선택 대기`와 보존 안내는 노란 `확인 필요`로 표시하고, 실제 `실패/오류` 문구가 있는 경우만 빨간 실패로 표시 |
| `RESTORE-UI-02` | 선택적 신화사 자산 동기화 경고 색상 | 로컬 작업파일 저장은 성공했지만 신화사 자산관 동기화가 보류된 문구는 `확인 필요` 노란 상태로 표시하고 전역 `실패`로 승격하지 않는다. 신화사DB/VM 공정 자체의 API 실패는 계속 빨간 실패로 표시한다. `task8_restore_lifecycle_behavior.test.cjs`, 실제 Chrome Ctrl+F5 수동 게이트 |
| `MARKET-01` | 선택 후보 상세수집 | 현재 선택한 후보 ID만 수집하며 선택 해제한 이전 후보는 다시 수집하지 않음 |
| `MARKET-02` | 선택형 Scrapling 상세수집 | 기본 상세수집 버튼과 실행 경로는 VM으로 유지한다. 별도 `B안 · Scrapling 상세수집` 버튼을 눌렀을 때만 현재 선택 후보의 공개 HTTP/HTTPS URL을 backend `StealthyFetcher`로 읽고 기존 상세이미지 병합 경로에 전달한다. localhost·사설 IP는 거부하고 요청당 상품 10건·이미지 80장으로 제한하며 자체 무한 재시도를 만들지 않는다. `scrapling_detail_option.test.cjs`, `test_scrapling_api.py` |
| `ANALYSIS-IMG-01` | 선택 이미지 분석 외부 응답 대기·완료·원본 보존 | 실제 사용자 Chrome에서 `선택 이미지 분석`을 직접 활성화한 뒤 `GPT OAuth 응답 대기` 상태·heartbeat와 최종 분석 보고서 표시를 읽어 확인한다. 분석 전송용 이미지만 크기 제한에 맞춰 파생 변환하고, 원본 상세이미지 카드·분석 선택·완료 상태는 분석 전후 그대로 보존한다. `tests/frontend/competitor_analysis_persistence.test.cjs`, `.debug-journal.md` 실제 Chrome 증거 |
| `CAFE24-FINAL-01` | 최종 등록 캐시·선택 이미지·14섹션 정합성 | 읽기 전용 재확인은 등록 쓰기의 idempotency key를 소비하지 않는다. 로컬 보관 대표이미지는 상세 헤더 fallback보다 우선 복원하고 URL/inline 전환 뒤에도 실행 지문은 하나로 유지한다. 같은 섹션 후보가 여러 장이어도 선택 이미지를 중복 삽입하지 않아 Cafe24 상세 HTML은 순서가 고정된 14개 섹션 이미지만 포함해야 한다. `cafe24_final_registration_write_regression.test.cjs`, `cafe24_detail_image_hydration.test.cjs`, `batch_control_worker_contract.test.cjs`, 실제 Chrome 등록·원격 read-back 게이트 |
| `CAFE24-RECEIPT-01` | 완료된 Cafe24 쓰기의 영수증 전용 복구 경계 | 완료된 immutable factory receipt만 받아 현재 product/run/revision/fingerprint, `payloadDigest`, `idempotencyKey`와 `cafe24-product-readback:v1` projection의 재귀 key 정렬·compact UTF-8·무개행 SHA-256을 검증하고 Sinhwa publication receipt만 전송한다. POST 2xx 뒤 GET publication-event에서 receipt ID와 두 digest가 일치할 때만 factory state를 `staged_verified`로 갱신하며, 503·불일치 observation은 `blocked`/`publicationReceipt=null`로 유지한다. 동일 영수증 재시도는 downstream 1회·duplicate 0건이어야 하며 stale/tampered payload는 거부하고 Cafe24 bridge·approval token·factory command 호출은 항상 0건이어야 한다. upstream 422는 503으로 뭉개지 않고 `receipt_payload_rejected` 422로 분류한다. `test_publication_recovery.py`, `test_readback_canonical.py` |

| `SAVE-44` | 로컬 세션 용량 fallback 핵심 상태 보존 | 저장 payload가 compact/minimal/emergency fallback으로 축약되어도 신화사DB·Cafe24 후보와 선택키, DB 검색어, VM 수집 결과·선택 이미지, factory 후보 mirror를 제거하지 않는다. 실제 사용자 Chrome에서 v682 번들 적용 후 물리 `Ctrl+F5`를 실행해 DB 8건·Cafe24 24건·VM 14건, 대표/사이즈/이미지컷 선택 상태를 다시 읽었다. `critical_state_fallback.test.cjs`, 실제 Chrome 수동 게이트(node_repl 화면 캡처·read-back) |

| `SAVE-45` | 부분 세션의 저장 project 후보 자동 재연결 | 초기 부팅에서 제품명·입력 이미지만 먼저 복원되어도 `workspaceKind=project`와 저장 payload의 실제 DB/Cafe24 후보가 있고 현재 후보 mirror가 비어 있으면 마지막 저장 project를 같은 `draft:lastwork_*` branch에 자동 재연결한다. 현재 후보가 이미 있거나 저장 project에 후보가 없거나 명시적 `새 작업`/미저장 draft이면 덮어쓰지 않는다. `workfile_archive_autorefresh.test.cjs`, DB-03, SAVE-25, 실제 Chrome Ctrl+F5 게이트 |
| `SAVE-46` | 같은 후보 재적용 필수값 보존 | 이미 사용자가 확정한 `size`, 가로/세로, 소재, 사용용도와 `automation.fieldReview`는 같은 DB/Cafe24 후보를 다시 적용하거나 hydration할 때 자동 후보값·scoped clear로 덮어쓰지 않는다. 명시적 새 후보·선택 해제·새 작업만 초기화를 허용한다. `factory_required_fields_preservation.test.cjs`, 실제 Chrome Ctrl+F5 게이트 |
| `SAVE-47` | 필수값 하단 카드 전체 F5/Ctrl+F5 보존 | 실제 Chrome에서 `제품명`, 가격/재고, 사이즈·가로·세로·무게·소재·사용용도를 A 상태로 read-back한 뒤 `현재 상태 저장`을 실행하고 일반 `F5`와 `Ctrl+F5`를 각각 전송한다. 저장본에 필수값이 있고 현재 화면 값이 비어 있으면 다른 자산 점수와 무관하게 서버 복원을 선택해야 하며, 사용자가 값을 다시 입력하지 않아야 한다. 하단 카드가 윗부분만 캡처된 상태를 성공으로 인정하지 않으며, 10개 값·초록 `✓ 확인됨` 10개·`생성컷 선택으로 이동` 버튼을 새로고침 후 화면에서 다시 확인해야 한다. `required_field_ctrl_f5_persistence.test.cjs`, `required_field_hydration_gate.test.cjs`, 실제 Chrome 증거 `factory-required-fields-lower-after-real-f5-v723.jpg`·`factory-required-fields-lower-after-real-ctrl-f5-v723.jpg` |
| `SAVE-48` | 옵션분류기·경쟁사 부분 복원 A+B 무감소 | 같은 상품·입력 지문의 부분 hydration snapshot은 현재 옵션 원본·슬롯별 배정과 이름·생성 결과·로그 또는 경쟁사 후보·선택·상세 이미지·분석 결과·로그를 더 적은 값으로 낮추지 않고 합집합으로 복원한다. 실행 ID·workspace가 달라도 상품키·입력 지문·단계가 정확히 같으면 이전 저장 자산을 복원하되, 명시적 원본 삭제·새 수집·`새 작업`만 감소를 허용한다. 자동 회귀는 옵션 15장/15슬롯/결과 5개와 경쟁사 후보 14건/선택/상세/분석의 부분 snapshot 감소를 하드 실패시키며, 실제 Chrome에서 옵션 원본 15장·경쟁사 후보 14건을 읽고 Ctrl+F5 전후 개수·선택·상세·로그를 비교한다. `option_sorter_live_scope_recovery.test.cjs`, `optionsorter_source_archive_persistence.test.cjs`, `comp_market_finalize_results.test.cjs`, 실제 Chrome 수동 게이트 |

`SYN-JS-01~13`은 실제 프론트 소스 13개를 각각 `node --check`로 검사하고, `SYN-MJS-01~03`은 revision/authority/authority-protocol 모듈을, `SYN-PY-01`은 백엔드 핵심 모듈을 `py_compile`로 검사한다. `full` 프로필은 여기에 필수값·탭 이동·마켓 누적/UI·작업파일 불러오기 성능·옵션 전체 흐름·Cafe24 링크·15섹션 진행률·수동 로그인 요청을 추가한다.

## 실환경 수동 게이트

- Vertex 실제 생성: 대표/사이즈/이미지컷을 각각 1장만 생성하고 로컬 아카이브 저장까지 확인한다.
- VM 실제 수집: 마켓별 4건으로 쿠팡/스마트스토어/G마켓/옥션/11번가의 썸네일·상품명·마켓·가격·URL을 확인한다.
- VM 실제 상세수집: 사용자 Chrome에서 후보 1건을 선택해 `선택 1건 VM 상세수집`을 직접 활성화하고, 새 VM job ID가 생성된 뒤 `completed=1`·`failed=0`과 수집 이미지 1장 이상을 화면과 job read-back으로 모두 확인한다.
- 로그인 개입: 자동 로그인 버튼까지 시도하고 OTP·영수증 번호처럼 사람 입력이 필요한 경우에만 요청 창을 확인한다.
- Cafe24 실제 등록: 마지막에만 새 상품·진열안함·판매안함·오픈마켓 안 함으로 등록하고, 새 `product_no`와 `display=F`·`selling=F`, 상세 HTML과 4개 상품 이미지 경로를 읽기 API로 확인한다. 기준 상품에서 복사한 적립금 설정은 `points_unit_by_payment`를 명시해 422가 없어야 한다.
