# Claude 작업 확인 및 이어가기 기준

확인일: 2026-09-05. 이 문서는 코드·Git·Claude 원문·검증 보고서를 대조한 인계 기록이며, 현재 버전의 전체 실행 승인서는 아니다.

## 1. 가장 중요한 구분: 운영 소스와 미병합 수정본

| 구분 | 작업 경로 | 브랜치 / 확인한 HEAD |
| --- | --- | --- |
| 현재 생산관제 작업 루트 | `C:\Users\kua\Documents\GitHub\kuasangse` | `codex/상세페이지자동화` / `ddaad8eadc67816e37555ecd94f7b0cc4e47acfb` |
| Claude 별도 수정본 | `C:\Users\kua\Documents\GitHub\kuasangse-fix` | `fix/whole-program-review` / `3e3fbaae5c45606841daa707ca19bc4b3c17ff8d` |

- 확인 시작 시 두 작업 폴더 모두 미커밋 변경 없음. 이번 확인에서는 이 문서만 추가했다.
- 이전 Codex 인계 `8f4569a` 이후 현재 작업 루트에 16개 커밋이 추가됐다.
- 두 브랜치는 서로 갈라져 있다. 현재 루트에만 15개, Claude 수정본에만 23개 커밋(병합 커밋 포함)이 있다. 단순히 수정본으로 갈아타면 최신 생산관제 변경을 놓친다.
- 양쪽에서 변경한 파일: `backend/routes/api_archive.py`, `src/app-core-03.js`, `src/runtime-manifest.json`, `dist/app-runtime.bundle.js`. 겹침이 확인됐다는 뜻이며, 실제 Git 충돌 여부는 아직 검증하지 않았다.
- 현재 루트 규칙은 다른 루트에서의 수정을 금지한다. 이번에는 별도 수정본을 읽기만 했다. 이후 구현 전에 작업 루트와 Claude 동시 작업 여부를 다시 확인한다.

## 2. 현재 생산관제 소스에 반영된 작업

1. 개요의 '지금 할 일': 작업 연결·차단·필수값·컷 선택·Cafe24 승인 등 사람이 할 일을 구분하고 작업 큐의 해당 단계로 이동한다. 2시간 이상 대기는 '오래 묵음'으로 구별한다.
2. 투입 전 확인: 자동화 방식·판단 모델·이미지 모델을 보여주고 확인 후 큐로 보낸다. 사진 파일명이 제품명으로 남은 경우 경고한다.
3. 작업 큐 삭제: 확인 절차를 거쳐 실제 큐 항목을 삭제한다. 실행 중이거나 Cafe24 등록된 제품은 보호한다. 이번 확인에서는 삭제를 실행하지 않았다.
4. 이미지 부하 개선: 목록에는 작은 썸네일, 확대에는 원본을 사용한다. 썸네일 실패 시 원본을 사용한다. 경량 상태 사본에서 색상 이미지의 큰 데이터 본문을 제외한다.
5. 운영 문구 개선: 영문 예외 대신 한국어 차단 사유·저장 실패 원인을 표시한다.
6. 실행 포트 이전: 화면 `http://127.0.0.1:42011/control-tower.html`, API `http://127.0.0.1:41009`. 예전 `8082/5062`를 기준으로 진단하거나 새로 서버를 띄우지 않는다.

주요 코드: `control_tower/frontend/src/next-action-model.mjs`, `production-workbench.mjs`, `bulk-intake.mjs`, `production-board.mjs`, `control_tower/backend/factory_sync.py`, `backend/routes/api_archive.py`.

## 3. Claude 수정본에만 있는 주요 작업

- 서버가 저장을 거절했는데 성공처럼 보이던 경로에 경고와 수동 복구용 사본을 추가했다. 옵션 이미지의 명시적 삭제는 별도 표식으로 처리한다. `d25d2b4`.
- '다른 이름으로 저장'을 취소했을 때 원래 작업 식별자와 상태가 먼저 바뀌던 문제를 수정했다. `26ea02b`.
- 진행률·실패 판정, 로컬 서비스 준비 상태, 백엔드 외부 접속 정책과 오류 표시, 한글 IME Enter 처리를 손봤다.
- 생성 성공 후 보관 저장 실패를 '이미지 API 실패'와 구분한다. 다만 이 문구 변경이 저장 409 경합 해결을 의미하지는 않는다. `1604ed5`, `src/app-core-06.js`의 `factoryGenerationFailureMessage`, `factoryPersistGeneratedCutPromptResult`.
- Vertex 프로젝트 교체 도구 `tools/switch_vertex_project.py`와 검사 추가. `4442841`. Claude는 프로젝트 교체 후 실제 이미지 1장 생성 성공을 보고했으나, 이번 확인에서는 유료 호출이나 인증 변경을 재실행하지 않았다.
- 옵션 사진을 드래그로 모두 배정해도 생성 버튼이 활성화되지 않던 문제 수정. `fc94e61`.
- FULL-07·FULL-12 등 일부 브라우저 검사의 준비 조건과 타이밍 수정. FULL-10은 여전히 실패 기록이 있다.

## 4. 완료 기록과 남은 검증을 구분할 것

### 기존 F5 기록

- `.omo/plans/batch-production-control-tower.md`의 F5는 2026-09-02 완료로 표시됐다. 이전 'F5 미완료' 인계만 보고 처음부터 다시 시작하지 않는다.
- 근거: `.omo/evidence/batch-production-control-tower/task-16/final-verification/f5-20260902/f5-summary.md`, `.omo/start-work/ledger.jsonl`의 `F5-final-verification`, `F5-risk-remediation`.
- 당시 보고서에는 작업파일/PDP/DOM 이미지 13개 exact-set, SHA 보존, 확대·새로고침, 사용자 Chrome 확인 등이 기록돼 있다. `verify:factory` 단독 명령은 운영 백엔드 보호 때문에 거절됐으며, 대체 격리 검증으로 커버했다고 명시한다. 네 명령을 모두 그대로 실행해 0으로 끝났다고 바꿔 보고하지 않는다.
- 이 기록은 당시 버전의 증거다. 이후 변경된 현재 양쪽 소스나 미래 병합본의 전체 승인을 의미하지 않는다. `boulder.json`은 아직 `active`로 남아 있어 계획 체크 상태와 관리 상태가 불일치한다. 이번 확인에서 변경하지 않았다.

### 실제 JSON 보고서에서 확인한 결과

| 대상 | 결과 | 보고서 |
| --- | --- | --- |
| 현재 루트의 9월 3일 일일 회귀 | 155/155 통과 | `test-results/daily-regression/2026-09-03T11-02-06-231Z/report.json` |
| Claude 수정본의 9월 5일 일일 회귀 | 168/168 통과 | `../kuasangse-fix/test-results/daily-regression/2026-09-05T00-57-30-731Z/report.json` |
| Claude 수정본 FULL-07·08·12 | 3/3 통과 | `../kuasangse-fix/test-results/daily-regression/2026-09-05T01-09-12-280Z/report.json` |
| Claude 수정본 FULL-10 | 실패, 종료 코드 1 | `../kuasangse-fix/test-results/daily-regression/2026-09-05T00-56-16-755Z/report.json` |

Claude 수정본의 `latest.json`은 마지막 3개 검사 보고서로 덮여 있다. 일일 168개 기록은 위의 고정 경로를 읽는다. 두 종류의 통과를 'full 전체 통과'로 합쳐 말하지 않는다.

### 이번 확인에서 직접 실행

아래 명령: 54개 자동 테스트 통과, 실패 0, 종료 코드 0.

```sh
node --test control_tower/tests/frontend/next-action-inbox.test.cjs control_tower/tests/frontend/bulk-intake-automation-confirm.test.cjs control_tower/tests/frontend/board-grid-thumbnail.test.cjs control_tower/tests/frontend/sync-summary-line.test.cjs control_tower/tests/frontend/board-stale-action-message.test.cjs control_tower/tests/frontend/intake-product-name-from-file.test.cjs tests/frontend/lightweight_snapshot_color_images.test.cjs tests/frontend/batch_command_error_detail.test.cjs
```

화면 42011과 API 41009의 `/api/health`는 HTTP 200이었다. 일부 검사는 소스 계약 검사이며, 이번 확인에서는 실제 Chrome 클릭·Ctrl+F5·Cafe24 등록을 재검증하지 않았다. 운영 탭·작업파일·인증·프로세스는 건드리지 않았다.

## 5. 마지막 Claude 요청과 정확한 이어가기 지점

원본 세션: `C:\Users\kua\.claude\projects\C--Users-kua-Documents-GitHub-kuasangse\9e7a025a-979d-449b-876d-234b2dd15f7a.jsonl`.

확인한 마지막 사용자 요청(2026-09-05 12:15 KST)은 직전 리스크 목록의 **1·2 수정, 6 사용처 조사**였다. 각각 FULL-10, 저장 409 경합, ADC 인증 계정 변경의 다른 프로그램 영향이다. 마지막 확인 메시지는 조사 시작이며 완료 결과는 아직 확인되지 않았다.

1. **FULL-10 실패 원인 분리**: `tools/verify_factory_detail_progress_cdp_v184.cjs` 머리말 및 위 고정 실패 보고서에서 시작한다. 5개 실패는 진행 중 표시, VM 수집 완료값, 작은 화면 스크롤, 오류 종료 표시, 상태 조회 실패의 보존이다. 보고서에 `statusCalls=0`, 빈 `detailStatus` 등이 있으므로 제품 버그와 낡은 테스트 계약을 먼저 분리한다. 테스트를 약하게 바꿔 통과시키지 않는다.
2. **생성 후 보관 409**: 편집권/lease 충돌과 이미지 보관 경계를 추적한다. 다른 작업의 편집권을 빼앗거나 보호 가드를 끄지 않는다. 이미 생성한 이미지를 잃지 않고 재보관하는지, 이전 이미지·선택·작업 범위를 보존하는지 검증한다. API 재생성은 비용이 있으므로 무작정 반복하지 않는다.
3. **인증 변경 영향**: 저장된 계정/프로젝트의 사용처를 읽기 전용으로 조사한다. 토큰·키·개인정보 출력 금지. 다른 앱 설정이나 인증을 임의로 되돌리지 않는다. Google Drive 인증 문제는 Claude가 별도 미해결로 보고했으며 이번 확인에서는 재현하지 않았다.
4. **검증된 수정만 통합**: 최신 생산관제 변경과 수정본의 저장/조립공장 변경을 모두 보존한다. 생성 번들은 한쪽 것을 그대로 채택하지 말고 합친 소스에서 기존 절차로 다시 만든다. 병합 후 집중 검사 → 일일 회귀 → handoff → 사용자 Chrome의 동일 작업 A+B 및 Ctrl+F5 검증이 필요하다.

## 6. 다음 세션용 프롬프트

```text
C:\Users\kua\Documents\GitHub\kuasangse 의 docs/CLAUDE_CATCHUP_2026-09-05.md 를 먼저 읽고 이어가라.
현재 HEAD, dirty 상태, Claude 동시 작업과 kuasangse-fix 브랜치의 최신 상태를 다시 확인하라.
운영 루트와 별도 수정본이 아직 갈라져 있으므로 최신 수정이 운영에 적용됐다고 가정하지 마라.
F5는 9월 2일 완료 기록이 있지만 이후 변경/통합본은 별도 검증 대상이다.
마지막 미완료 작업은 FULL-10 실패 진단·수정, 보관 409 경합 해결, ADC 변경 영향 조사다.
우선 FULL-10의 고정 실패 보고서에서 제품 문제와 검사 준비 조건을 분리하라.
기존 조립공장 엔진·저장 형식·생산관제 큐를 재구현하지 말고 A+B 보존 규칙을 지켜라.
현재 작업 루트 규칙을 지키고 다른 Claude 작업/기존 이미지/작업파일/브라우저 상태를 덮어쓰지 마라.
외부 생성·Cafe24 쓰기·OAuth 변경은 이번 인계만으로 실행하지 마라.
보고서 통과, 실제 Chrome 검증, 운영에 반영 여부를 각각 구분해서 보고하라.
```
