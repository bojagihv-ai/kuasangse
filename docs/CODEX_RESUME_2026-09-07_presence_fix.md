# 생산관제 작업 재개 결과 — 2026-09-07

presence 구현의 실서버·Chrome 검증과 fix 11개 커밋 병합을 마쳤다. 긴 식별자가 작은 화면에서 잘리는 문제도 카드 CSS 두 선언으로 수정했다. 전체 정상 앱 인계는 회귀 실패로 보류한다.

## 병합과 라이브 보존

- 작업 루트: C:/Users/kua/Documents/GitHub/kuasangse
- 브랜치: codex/상세페이지자동화
- 병합 커밋: `21c4f1396704a0ab2bfd2210ad414aacd9435e13`
- 부모: `e3df41b99d0c067217452fd0ec9e93ef804c2ab1` + `5f247e4fbff1cb14eae04e6adfa02c1af7953c2a`
- 두 부모의 ancestor 검증 통과. 소스 충돌 0건. 번들/manifest 충돌만 합친 소스에서 재생성했다.
- 높은 기준 v1438에서 병합본 v1439 생성. 기존 라이브는 v1438을 보존했고 양쪽 번들은 각각의 소스와 일치한다. 이 병합을 라이브 전체 배포로 표현하지 않는다.
- 변경 대상44개: 기존 라이브와 동일5개, 다른20개 보존, 없던19개 추가. 기존 파일을 병합본으로 덮어쓰지 않았다.
- 시작 시 변경123개 중122개는 최종 SHA-256이 동일하다. control-tower.html도 이번에 추가한 CSS 블록을 빼면 백업과 정확히 같다.
- 기존 미커밋 작업과 presence 구현은 작업 트리에 보존했다. 이번 CSS 수정도 미커밋 상태다. 원격 푸시는 하지 않았다.

[20개 라이브 차이와 전체44개 목록](../.omo/evidence/resume-20260907/merge-live-differences.md) · [병합 기록](../.omo/evidence/resume-20260907/merge-result.json) · [최종 원본 보존 확인](../.omo/evidence/resume-20260907/final-preservation.json)

## 실제 실행한 검증

| 검증 | 결과 | 증거 |
|---|---|---|
| presence + 인접 backend pytest | PASS 40/40 | [로그](../.omo/evidence/resume-presence-backend-20260907.log) |
| presence board + workbench 렌더 | PASS 66/66 | [로그](../.omo/evidence/resume-presence-board-20260907.log) |
| npm run verify:control-tower | PASS backend501 + 계약45, 번들·CSS토큰·모듈캐시 | [로그](../.omo/evidence/resume-20260907/control-tower-full.log) |
| 관제탑 frontend 전체 | FAIL 351/363, 실패12 | [로그](../.omo/evidence/resume-20260907/control-tower-frontend-all.log) |
| 병합 후보의 fix frontend13개 파일 | PASS 154, skip2, fail0 | [로그](../.omo/evidence/resume-20260907/merge-targeted-tests.log) |
| 병합 후보 VM 전원 계약 | PASS 6/6 | [로그](../.omo/evidence/resume-20260907/merge-vm-tests.log) |
| 실제41009 presence POST/DELETE 및 작업 보존 | PASS, 45초 TTL 응답, 워커/작업12개 동일 | [POST](../.omo/evidence/resume-20260907/presence-http-result.json), [최종정리](../.omo/evidence/resume-20260907/presence-final-cleanup.json) |
| 실제 Chrome 375×500,768×600,1280×720 | PASS, 긴ID 줄바꿈·오른쪽 메인 스크롤 | [전후 폭](../.omo/evidence/resume-20260907/presence-width-green.json), [시각검토](../.omo/evidence/resume-20260907/visual-final-review.md) |
| CSS 수정 후 board 집중검증 | PASS 48/48 | [로그](../.omo/evidence/resume-20260907/presence-wrap-tests.log) |
| npm run verify:daily -- --no-retry | FAIL 172/175, 실패3개 실행 항목 | [원문 보고서](../test-results/daily-regression/2026-09-07T05-55-03-397Z/report.md), [요약](../.omo/evidence/resume-20260907/daily-summary.json) |
| npm run verify:handoff | FAIL REGRESSION_FAILED | [로그](../.omo/evidence/resume-20260907/handoff.log) |
| node tools/build_runtime_bundle.cjs --check / git diff --check | PASS | [최종 확인](../.omo/evidence/resume-20260907/final-preservation.json) |

일일 회귀는 KUA Port Authority에서 발급받은 CDP45100–45274, backend41022, frontend42027로 격리해 실행했다. 175개 항목 모두 실행됐으며 약10분24초 걸렸다. VM 단위 테스트는 가짜 테스트 키와 기본 인증서 환경으로 실행했고 실제 모델 호출을 하지 않았다.

## 이번에 고친 화면 문제

긴 공백 없는 workspaceId/buildId에서375px 화면의 앱 폭360px에 대해 scrollWidth955px, 카드 오른쪽938.375px로 넘쳤다. `control_tower/frontend/control-tower.html`의 `.board-human-presence-card`에 `min-inline-size: 0`과 `overflow-wrap: anywhere`만 추가했다.

수정 후 실제 Chrome에서 앱 폭/scrollWidth360/360, 카드 폭/scrollWidth300/300, 카드 오른쪽331px를 확인했다. 768px와1280px도 가로 넘침이 없다. presence 데이터는 worker hello/heartbeat/checkpoint와 분리되고 갱신·만료가 기존 작업 행을 교체하지 않는다는 계약도 확인했다.

[실패 기록](../.omo/evidence/resume-20260907/presence-width-red.txt) · [성공 기록](../.omo/evidence/resume-20260907/presence-width-green.json) · [재실행 검증](../.omo/evidence/resume-20260907/check-presence-width.mjs) · [작은 화면](../.omo/evidence/resume-20260907/presence-wrap-small.png) · [하단 행동](../.omo/evidence/resume-20260907/presence-wrap-small-bottom.png)

## 남은 실패와 리스크

1. CMD-UI-02: 옵션 분류기 진입 저장 메타데이터 테스트가 예상 호출6회에 대해7회를 관측한다. 이번 작업에서 해당 라이브 소스/테스트를 수정하지 않았다.
2. UNIT-BE-01: backend297통과/6실패. 추가된 VM 전원 테스트가 보존된 라이브 백엔드에 아직 없는 기능을 검사한다. 같은6개 테스트는 병합 후보에서는 모두 통과한다. 라이브의 VM 실행 제안 기능도 차이 목록에 남겼다.
3. DB-03: 작업파일 전환 뒤 후보 적용 검증에서 currentDb의 globalStateUnchanged=false로 probe 격리 검사가 실패했다. backend/recovery 보존은true다. 실제 사용자 자료 유실로 단정하지 않았으며 앱 소스는 변경하지 않았다.
4. 관제탑 전체 frontend 실패12건은 병합 전에 실행해 확인했다.6건은 전용 backend/state/archive 없이 실행된 브라우저 검증 차단, 나머지6건은 숨겨진 next-action 또는 workfile-job-tab selector 시간 초과다.
5. 전체F6·Cafe24 실제 등록·정상 앱 인계를 통과했다고 보고하지 않는다. 외부 등록이나 OAuth 재로그인은 이번 재개 작업에서 실행하지 않았다.

다음 조치는 라이브 보존 차이의 선택 반영 판단, CMD-UI-02/DB-03의 실패 원인 분리, 격리환경에서 관제탑 브라우저6건 재실행이다. 실패 테스트를 지우거나 약화하지 않았다.

## 정리 상태

임시 presence는 삭제했고 기존12개 작업은 그대로다. QA 갱신기와 일일 회귀 실행기는 종료됐다. 이번 검증에서 만든 Chrome 임시 탭만 정리하고 최신 생산관제 탭 하나를 남겼으며 화면 크기는 원래대로 복구했다. 초기 탭 조회에서 인증값이 포함된 로그인 URL이 도구 출력에 나온 실수가 있었고, 이후 조회는 URL 쿼리를 제외했다. 이 보고서에는 인증값을 저장하지 않았다.
