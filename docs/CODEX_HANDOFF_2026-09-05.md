# Codex 인계 — 2026-09-05 병합 완료 기준

앞선 인계(`docs/CLAUDE_CATCHUP_2026-09-05.md`)는 두 갈래가 **갈라진 상태**를 전제로 쓰였다.
그 갈라짐은 아래대로 해소됐다. 이 문서가 최신이며, 앞 문서는 배경으로만 읽는다.

## 1. 지금 상태 — 갈래는 하나다

| 항목 | 값 |
| --- | --- |
| 작업 루트 | `C:\Users\kua\Documents\GitHub\kuasangse` |
| 브랜치 | `codex/상세페이지자동화` (origin 과 동기화됨) |
| HEAD | `4c09c21` 병합 커밋 |
| 원격 | `origin/codex/상세페이지자동화` = 같은 커밋 (2026-09-05 푸시) |
| 작업 트리 | 깨끗 |

- 병합: `fix/whole-program-review`(`3e3fbaa`, 별도 작업본 `kuasangse-fix`) → 현재 브랜치.
- 공통 조상 `79b359a` 기준 이쪽 16커밋 + 저쪽 23커밋이 **모두** 들어왔다(`git merge-base --is-ancestor` 로 양쪽 확인).
- `kuasangse-fix` 작업본은 **건드리지 않았다.** 그쪽에서 새 커밋이 생기면 다시 병합해야 한다.
  그쪽 마지막 커밋은 `3e3fbaa` (2026-09-05 09:57), 미커밋 변경 없음이었다.

### 병합에서 실제로 충돌한 것

소스 충돌 **0건**. 양쪽이 함께 고친 `backend/routes/api_archive.py`(+65 / +100-36)와
`src/app-core-03.js`(+28-3 / +20-3)는 자동 병합됐다. 충돌은 생성물 2개뿐이었다:

- `dist/app-runtime.bundle.js`
- `src/runtime-manifest.json`

둘 다 손으로 고치지 않고 **합친 소스에서 재생성**했다(`node tools/build_runtime_bundle.cjs`).
`buildId` 는 더 높은 쪽(v1374)을 기준으로 잡아 도구가 **v1375** 로 올렸다 —
이쪽 v1368 을 기준으로 잡았다면 저쪽이 이미 다른 내용으로 쓴 v1369 를 재사용해
"같은 번호 다른 내용" 이 됐을 것이다(도구 주석이 경고하는 바로 그 상황).

## 2. 병합 뒤 검증 — 실제 실행 결과

| 항목 | 결과 | 비고 |
| --- | --- | --- |
| `npm run verify:control-tower` | PASS | 백엔드 390 + 계약 45, 번들·CSS토큰·모듈캐시 OK |
| `npm run test:unit:backend` (backend/tests) | PASS | 278/278 |
| 관제탑 프런트 전체 (`control_tower/tests/frontend`) | 304/310 | 실패 6건은 격리 backend 가드(환경 조건, 병합 전과 동일) |
| 조립공장 프런트 전체 (`npm run test:unit:frontend`) | 1875/1947 | 실패 70건 = 격리 가드 66 + 실제 단정 4 |
| `node tools/build_runtime_bundle.cjs --check` | PASS | 생성물이 합친 소스와 일치 |

### 실제 단정 실패 4건은 전부 병합 이전부터 있던 것

같은 4개 파일을 두 부모에서 각각 돌려 대조했다. **병합이 만든 신규 실패는 0건**이다.

| 실행 대상 | 실패 |
| --- | --- |
| 이쪽 병합 전 `41b9712` | 2건 |
| 저쪽 `3e3fbaa` | 4건 |
| 병합본 `4c09c21` | 4건 = 두 쪽의 합집합, 신규 없음 |

남아 있는 4건(고쳐야 할 대상):

1. `tests/frontend/competitor_analysis_persistence.test.cjs:74` — `작업파일에 연결된 초안의 후보 선택은 서버 프로젝트 스냅샷으로 저장한다`. `'draft:tab'` 기대. **양쪽 모두에서 실패**.
2. `tests/frontend/task7_factory_cafe24_writer_retirement.test.cjs:1219` — `candidate collection captures the existing Cafe24 receipt...`. `factoryCollectProductCandidatesForReview` 소스에서 `!retainedCafe24Selection` 가드를 정규식으로 찾는데 없다. **양쪽 모두에서 실패**.
3. `tests/frontend/factory_local_service_preflight.test.cjs:522` — `Cafe24-only preflight does not check or launch Sinhwa DB`. 호출 3회, 기대 2회. **저쪽에서 들어온 실패**.
4. `tests/frontend/start_button_owns_workfile.test.cjs:130` — `저장 ID를 비우는 진입점은 사람이 누르는 것뿐이다`, "사본 저장 경로가 사라졌습니다". **저쪽에서 들어온 실패**.

3·4번은 저쪽의 저장 경로 수정(`d25d2b4` 계열)과 관련이 있어 보이나 원인은 확인하지 않았다.
테스트를 약하게 고쳐 통과시키지 말 것 — 제품 버그인지 낡은 검사 계약인지 먼저 가른다.

### 아직 안 돌린 것

- `npm run verify:daily` / `verify:daily:full` — **이번에 실행하지 않았다.** 이 러너는 자체 CDP 크롬 창을 여러 개 띄운다. 사용자가 PC 를 쓰는 중이라 예고 없이 돌리지 않았다. 병합본의 공식 게이트는 이것이므로 **코덱스가 이어서 돌려야 한다.**
- 실제 Chrome 에서의 Ctrl+F5 / Cafe24 등록 재검증도 하지 않았다.
- 앞 문서의 FULL-10 은 저쪽에서 `3e3fbaa` 로 원인 일부만 걷어낸 상태이며 **여전히 실패 중**이다.

## 3. 이번 세션(2026-09-04~05, Claude)이 생산관제에 넣은 것

| 커밋 | 내용 |
| --- | --- |
| `41bd0f2` | 작업 큐 **삭제** — 저장 파일에서 실제로 지운다. 진행 중 / 워크스페이스가 보는 중 / Cafe24 등록 완료(staged_verified) 작업은 거부. `DELETE /api/factory/jobs/<job_id>` + 확인창. |
| `226b285` | 막힌 사유에 조립공장 로더의 영문 예외가 새지 않게. `operatorMessage()` 가 한글 없는 영문을 통과시키던 마지막 분기를 막았다. |
| `06bed37` | 맨 위 동기화 막대의 접힘 한 줄을 `describeSyncSummary()` 로 재작성. 제품이 없는데 "작업 차단 확인 필요" 라고 하던 오류 제거. |
| `ddaad8e` | 2시간 넘게 기다린 할 일을 "오래 묵음" 으로 구별(`STALE_AFTER_MS`), 머리글에 건수. |
| `41b9712` | 앞 인계 문서 보존(내가 쓴 문서가 아님). |

운영 데이터 정리: 오염된 `IMG_5968` 작업을 새 삭제 API 로 실제 삭제했다(큐 11→10, 저장 파일에서 소거).
대체본 "직사파우치"(`factory-job-1fbe5a14…`)는 큐에 그대로 있다.

## 4. 실행 포트 (예전 8082/5062 로 진단하지 말 것)

- 화면 `http://127.0.0.1:42011/control-tower.html`
- API `http://127.0.0.1:41009`
- 기동/정지: `control_tower/launch.ps1 -Action Start|Stop|Status -NoBrowser -NoDialog -Json`
- 백엔드 Python 코드를 고쳤으면 **재기동해야 반영된다.** 프런트 `.mjs` 를 고쳤으면 부르는 쪽 import 의 캐시 번호(`?xxx=N`)를 올려야 브라우저가 새로 받는다(`verify:control-tower` 가 검사한다).

## 5. 다음 할 일 (권장 순서)

1. `npm run verify:daily` 를 돌려 병합본의 공식 게이트를 통과시킨다. 실패하면 위 4건과 겹치는지부터 본다.
2. 남은 단정 실패 4건 처리 — 제품 버그와 낡은 검사 계약을 분리한다.
3. FULL-10 실패 진단(앞 문서 5장), 생성 후 보관 409 경합, ADC 인증 변경 영향 조사.
4. `kuasangse-fix` 에 새 커밋이 생겼는지 확인하고, 생겼으면 다시 병합한다.

## 6. 지켜야 할 것

- 조립공장 엔진·저장 형식·생산관제 큐를 재구현하지 않는다. 기존 명령 경계를 그대로 쓴다.
- 사용자 크롬 창을 복원·최소화·전면화하지 않는다(2026-09-04 사고). 화면 검증은 자체 하네스나 새 탭에서.
- 검증 없이 "고쳤다" 라고 보고하지 않는다. PASS/FAIL 과 증거를 함께 남긴다.
- 외부 Cafe24 쓰기·OAuth 변경은 사용자의 별도 승인 없이 실행하지 않는다.
