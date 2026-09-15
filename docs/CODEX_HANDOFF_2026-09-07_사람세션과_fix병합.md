# Codex 인계 — 2026-09-07 (사람 세션 계약 제안 + fix 갈래 재병합 목록)

앞선 인계 `docs/CODEX_HANDOFF_2026-09-05.md` 이후, 별도 작업본 `kuasangse-fix`(브랜치 `fix/whole-program-review`)에
커밋 11개가 더 쌓였다. 그리고 관제탑 쪽에 **사람 세션** 개념이 필요해졌다. 두 가지를 이 문서에 적는다.
관제탑(`control_tower/**`)은 코덱스가 편집 중이므로 이쪽(클로드)은 손대지 않았다.

## 1. fix 갈래에 새로 쌓인 커밋 (3e3fbaa 이후, 오래된 것부터)

| 커밋 | 내용 | 사장님 앱 적용 |
| --- | --- | --- |
| `2853a8b` | VM 이 꺼져 있으면 "켤까요?" 를 묻는다 | 라이브 미적용 |
| `1c31585` | Cafe24 후보 없음 확정이 화면에 반영되는지 보는 눈 | 라이브 미적용 |
| `1add2fe` | 생성 이미지 기준을 작업파일 하나로 모은다 | v1425 국소 패치 |
| `503b0a0` | 생성 중 새 빌드 창 미루기 + 끊긴 생성 "N개 중 M개만" 솔직 표시 | v1425 |
| `f47f509` | 끊긴 단계에 "나머지 N개만 생성" | v1426 |
| `309693a` | 조립공장 시작이 유사 제품 분석도 같이 (화면 이동 없음) | v1427 |
| `ae17209` | 관제탑 작업이 앱에 보이고 복사본으로 불러오기 | v1429 |
| `b218498` | 관제탑 SSE 구독 → 목록 자동 갱신 | v1434 |
| `4b98b3a` | 신화사DB 추가검색 버튼 | v1436 |
| `82486b4` | 강종 뒤에도 마지막 초안 유지 (빈 탭 표식 금지 · 후순위 탐색 · 새 작업만 놓아줌) + 관제탑 카드 행 폭 | v1438 |
| `5f247e4` | FULL-10 통과 (VM 브리지 가짜 + 저장소 정본 거울 + 작은 화면 안쪽 스크롤 예외) | app.html 만 |

- 사장님 앱(`kuasangse` 라이브)에는 위 항목을 **앵커 검증 국소 패치**(`src/**` 해당 조각만)로 넣었다. 백업은
  세션 스크래치패드 `live-backup/` 에 있다. 즉 라이브 `src/**` 와 fix 갈래의 같은 파일은 내용이 같아야 정상이고,
  다르면 그 차이는 라이브에서 코덱스가 따로 고친 것이다(예: `src/app-core-03.js` 09:26 수정, `dist` v1437 재빌드).
- 병합 절차는 앞 인계와 같다: 소스 병합 → `dist/app-runtime.bundle.js` · `src/runtime-manifest.json` 은
  손대지 말고 `node tools/build_runtime_bundle.cjs` 로 재생성(buildId 는 높은 쪽 기준). fix 갈래 전체 회귀는 199/199.

## 2. 사람 세션 — 관제탑에 부탁하는 계약

### 왜 필요한가

합의된 "관제탑 ↔ 상세페이지 앱 통합 4단계" 중 (1)(2)(4)는 앱 쪽에서 끝났다:
관제탑 작업 목록이 앱에 보이고(`GET /api/factory/jobs`), 복사본으로 불러오고, SSE(`/api/factory/events`)로 자동 갱신한다.
남은 (3) **"사람이 쥔 작업이 관제탑에 보이기"** 는 앱이 `factory_sync.hello` 를 보내면 안 된다:

- `hello` 는 단일 세션(`self._factory_session`)이라 사람 탭의 hello 가 **워커 세션을 대체**한다
  (`replaced_session_id` → `_recover_inflight_products_locked` · `_rebind_selection_orders_locked`). 진행 중 워커 작업이 회수된다.
- 그래서 앱은 (3)을 구현하지 않고 멈춰 있다.

### 제안 (관제탑 쪽, 코덱스 판단으로 모양은 바꿔도 된다)

워커 세션과 **분리된 존재 표시(presence)** 하나만 있으면 된다. 세션 교체·회수·재바인딩과 무관해야 한다.

```
POST /api/factory/presence            (CSRF 는 다른 tab 명령과 같은 규칙)
{
  "presenceId": "human:<앱 탭 workIdentity 또는 draft/project scope id>",
  "role": "human",
  "productName": "팔각자개상자",
  "workspaceId": "draft:lastwork_… | project:project_…",
  "stageKey": "detail", "stageLabel": "상세페이지",
  "message": "사이즈컷 3장 생성 중",
  "buildId": "20260811-webmcp-hydration-bridge-v1438",
  "sentAt": 1788742321223
}
→ 200 { "ok": true, "expiresInMs": 45000 }
DELETE /api/factory/presence/<presenceId>   (탭이 떠날 때 · 없어도 만료로 사라짐)
GET  /api/factory/jobs 응답에 "humanPresences": [ …위 필드… ] 를 덧붙이거나,
     생산관제 화면에 "사람이 쥔 작업 N" 카드로 보여 주면 된다.
```

- 앱은 15초마다 보낸다(초안 심장박동과 같은 주기). 45초 동안 안 오면 관제탑이 지운다.
- 워커 세션(`hello`/cursor/checkpoint)과는 **아무 관계도 없어야** 한다. presence 가 들어와도
  `replaced_session_id` 가 생기면 안 되고, `_assert_no_active_tab_command_locked` 도 타지 않아야 한다.
- 같은 productName 이 관제탑 작업으로도 있으면(사람이 복사본으로 불러온 경우) 화면에서 "사람이 복사본 작업 중" 정도로만 표시.
  관제탑이 그 작업을 회수하거나 순서를 바꾸지 않는다.

앱 쪽(클로드)은 이 엔드포인트가 생기면 `src/app-core-06.js` 의 관제탑 절(`factoryControlTowerBases` 옆)에
`factoryTowerPresenceStart/Stop` 을 붙여 15초 심장박동을 보내고, 회귀 TOWER-PRESENCE-01/02 를 추가한다.
엔드포인트가 없으면(404) 조용히 건너뛴다 — 지금의 관제탑에 아무 요청도 보내지 않는다.

## 3. 참고 — 이번에 실측으로 확인한 관제탑 사실

- `GET /api/factory/events` 는 세션 쿠키가 필요하고 **`cursor=0` 금지**: 쌓인 이벤트 1,300건이 4초에 쏟아져 연결이 고갈된다.
  앱은 `GET /api/session` → `GET /api/factory/state` 의 `eventCursor` 부터 듣는다.
- 워커 문서 저장 범위는 `project:batch:<jobId>` (앱 백엔드 `GET /api/last-work?workspaceId=project:batch:<jobId>`).
- 관제탑 API 는 41009, 화면은 42011 (포트 관리국).
