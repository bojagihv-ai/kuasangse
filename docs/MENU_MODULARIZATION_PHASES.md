# 메뉴 모듈화 1~8단계 완료 기준

이 문서는 진행률을 서술이나 체감 퍼센트가 아니라 재현 가능한 지표로 판정하기 위한 기준표다. 기준 코드 체크포인트는 `e7d96ed`, 8단계 코드 완료 커밋은 `9d6fb2c`다.

| 단계 | 작업 범위 | 완료 조건 | 현재 판정 |
|---|---|---|---|
| 1 | 기존 동작과 dirty worktree 기준선 고정 | 12개 메뉴·7개 조립공장 탭 특성 테스트, 소스 해시, 반응형 실패 기준 보존 | 완료 |
| 2 | ESM 계약·불변 store·소유권 표·import 규칙 도입 | 중복 ID·소유권 중첩·직접 상태 변경·순환 import를 자동 거부 | 완료 |
| 3 | 작업파일 저장 경로 단일화 | workspace 쓰기가 orchestrator를 통과하고 구버전 파일이 무손실 왕복 | 완료 |
| 4 | lease·fencing token·CAS·충돌 UI | 오래된 세션의 쓰기 차단, 409/428 충돌 처리, 읽기 전용·인계 동작 검증 | 완료 |
| 5 | 저결합 메뉴 ESM 이전 | manual·modelsettings·automation·imagecuts·optionsorter가 독립 수명주기와 테스트 보유 | 완료 |
| 6 | 상품·경쟁사·콘텐츠·상세·Cafe24 도메인 이전 | 메뉴 간 직접 상태 변경 없이 명령 경계로 연결되고 작은 화면/CJK 회귀 통과 | 완료 |
| 7 | 조립공장·shell·router·bootstrap 분리 | 19개 진입점 registry 구동, 전역 mutable state 직접 변경 0, listener·timer 누적 0 | 완료 |
| 8 | 구조 게이트·전체 회귀·생성물 일치 자동화 | import/소유권/저장/no-global/manifest/bundle/module-size/lifecycle/CAS 게이트와 full 회귀 통과 | 완료 |

## 현재 완료 조건 체크리스트

- [x] 기능 진입점 12개와 조립공장 탭 7개가 registry/ESM 경계로 관리된다.
- [x] 메뉴가 다른 메뉴의 DOM·mutable global·저장 어댑터를 직접 소유하지 못하게 하는 구조 테스트가 있다.
- [x] 작업파일 저장은 persistence orchestrator와 revision/lease 경계를 통과한다.
- [x] source/manifest/generated bundle 불일치와 import 순환을 자동 검사한다.
- [x] 반복 진입·이탈의 listener/timer 누적과 stale async write를 회귀 테스트한다.
- [x] 작은 화면의 전체 세로 스크롤 도달성과 한국어 CJK 표시를 회귀 테스트한다.
- [x] frontend·architecture·backend·full 회귀 실행 경로가 저장소에 등록돼 있다.
- [x] 코드 리뷰와 시각 검토에서 차단급 결함이 0건이다.

완료 조건은 8/8단계, 체크 항목은 8/8개다. 단, 이는 **논리적 경계와 회귀 방어 완료**를 뜻한다. `app-core-05.js`와 `app-core-06.js`의 물리적 LOC 축소 완료를 뜻하지 않으며, 실제 Cafe24 등록·유료 Vertex 생성·실제 VM 수집·OAuth 재로그인은 외부 상태를 바꾸므로 별도 출시 E2E 대상이다.

## 진행률 보고 규칙

앞으로 진행 보고는 아래 원시 출력 뒤에만 해석을 붙인다.

1. `wc -l src/app-core-*.js`와 기준 커밋 대비 증감
2. 전체 테스트의 총 통과·실패·skip·실행시간
3. `git status --short --branch`와 `git log --oneline`
4. 완료 조건 충족 수/전체 수, 미충족 조건의 정확한 이름

근거 실행 경로: `npm run test:unit:frontend`, `npm run test:unit:backend`, `npm run verify:architecture`, `npm run verify:daily:full`.
