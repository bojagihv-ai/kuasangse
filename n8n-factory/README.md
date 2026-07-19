# 조립공장 → n8n (원본 앱 비수정)

상세페이지 **조립공장** 과정을 n8n 워크플로로 오케스트레이션합니다.  
`kuasangse` 프론트/조립공장 JS는 **건드리지 않고**, 이미 떠 있는 로컬 API만 호출합니다.

## 전제 (서버)

| 서비스 | URL | 역할 |
|--------|-----|------|
| 상세페이지 백엔드 | `http://127.0.0.1:5050` | 프로젝트·분석·섹션·이미지 파이프라인 |
| API Hub | `http://127.0.0.1:4321` | GPT OAuth / 커넥터 |
| 프론트 (선택) | `http://127.0.0.1:8081` | UI 검수 |

실행:

```powershell
# 상세페이지
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\kua\Documents\GitHub\kuasangse\launcher.ps1"

# n8n (별도 터미널)
n8n start
# 브라우저: http://localhost:5678
```

## 워크플로 맵 (조립공장 순서)

| 파일 | 단계 | 내용 |
|------|------|------|
| `01-health-gate.json` | 게이트 | 5050/4321 생존 확인 |
| `02-input-analyze.json` | 0·DB | 이미지 업로드 → 프로젝트 생성 → 제품 분석 |
| `03-competitors.json` | 경쟁사 | 경쟁 제품 검색 |
| `04-generate-all-sections.json` | 상세·이미지 | 전체 섹션 텍스트+이미지 순차 생성 |
| `05-export.json` | 저장/내보내기 | JSON/HTML export URL 정리 |
| `06-spark-analyze-optional.json` | 선택 | API Hub Spark 이미지 분석 |
| `07-db-candidates-sinhwa-cafe24.json` | DB 후보 | 신화사DB + Cafe24 후보 검색 |
| `08-drive-image-cuts-automation.json` | Drive 컷 | `/pdp/automation` 이미지컷 (기본 dry 조회) |
| `09-cafe24-openmarket-dry-run.json` | Cafe24 dry-run | 실전송 없이 등록/보내기 조건 검증 |
| `00-master-orchestrator.json` | 배치 실험 | Execute Workflow 체인 (사람 게이트 약함, 실험용) |
| **`10-hitl-factory-line.json`** | **조립공장 본선 (사람)** | **HITL** Form/Wait 게이트 |
| **`11-goal-factory-unattended.json`** | **Goal 무인 본선** | policy 자동 통과 (`goal/decision-policy.json`) |

### Master 플래그 (`Set Config`)

| 플래그 | 기본 | 설명 |
|--------|------|------|
| `runDbCandidates` | `true` | Analyze 후 신화사+Cafe24 후보 검색 (07) |
| `runCompetitors` | `true` | 경쟁사 검색 |
| `runGenerateAll` | `true` | 전체 섹션 생성 |
| `runExport` | `true` | export JSON |
| `runDriveCheck` | **`false`** | 08: Drive automation config/status 조회 (opt-in) |
| `driveActuallyRun` | **`false`** | 08: `true` 일 때만 `POST /pdp/automation/run` (비용 가능) |
| `runCafe24DryRun` | **`false`** | 09: Cafe24/오픈마켓 **dry-run only** (opt-in, live 없음) |
| `tryStartSinhwa` | `true` | 후보 분기에서 로컬 신화사 기동 시도 |
| `candidatesLimit` | `8` | 후보 검색 limit |
| `generatePollSeconds` | `15` | generate-all 폴링 간격(초) |
| `generatePollMax` | `120` | 폴링 최대 횟수 (15×120 ≈ 30분) |

후보 검색 쿼리는 `productName` 을 사용합니다. 검색 실패 시에도 `onError: continue` 로 메인 라인은 계속됩니다.  
Drive 실행은 `runDriveCheck` + `driveActuallyRun` 둘 다 true 일 때만. master는 폴링 없음(상세 폴링은 단독 `08`).  
Cafe24 **live 전송은 절대 없음**.

Cafe24 **실등록/실클릭은 제외**합니다. `09` 는 dry-run only.  
Drive 자동화 `08` 은 기본 `actuallyRun=false` (조회만).

## Import 방법 (한 번만)

**UI에서 10번 클릭하지 마세요.** Docker n8n(`n8n-docker`, 포트 5678) 기준 한 줄:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\kua\Documents\GitHub\kuasangse\n8n-factory\scripts\import-docker-n8n.ps1"
```

동작:
1. `workflows/*.json` → `import/ALL-pdp-factory.json` 번들 생성 (stable id)
2. `C:\n8n-data\import-pdp-factory.json` 으로 복사
3. 컨테이너 잠시 중지 후 동일 볼륨으로 `import:workflow` (00~09 전부)
4. `n8n-docker` 다시 기동 → http://127.0.0.1:5678

재실행해도 같은 id(`pdp-00-master-...`)로 **덮어쓰기** 됩니다.

로컬 전역 `n8n` CLI 를 쓰는 경우(비 Docker):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\kua\Documents\GitHub\kuasangse\n8n-factory\scripts\import-all-workflows.ps1" -RestartN8n
```

수동이 필요할 때만: n8n UI → Import from File → `import/ALL-pdp-factory.json` 하나.

### 2026-07 업데이트 요약

- `01-health-gate`: `/api/provider`, `/pdp/automation/status` 헬스 추가
- `04-generate-all-sections` / master 경로: `generate-all` 백그라운드 완료 **폴링** (`completed`/`error`, 기본 15s×120)
- **00 Master = Execute Workflow 체인**: 하위 01~09를 호출 (하위는 Manual 단독 실행도 가능, `When Executed by Another Workflow` 진입점)
- 앱 `src/app-core-*.js` 는 이 패키지 범위에서 **수정하지 않음**

재조립 스크립트: `scripts/rewire-master-execute.js` → `build-import-bundle.js` → `import-docker-n8n.ps1`

## 입력 규약

공통 입력 (Set Config / Manual 실행 시):

```json
{
  "backendBase": "http://127.0.0.1:5050",
  "apiHubBase": "http://127.0.0.1:4321",
  "productName": "크리스탈보자기",
  "imagePath": "C:\\\\path\\\\to\\\\product.jpg",
  "llmModel": "gpt-5.3-codex-spark"
}
```

- `imagePath`: 로컬 파일 경로 (n8n Read/Write File + HTTP multipart 사용)
- 또는 `imageUrl`: 공개/로컬 정적 URL

## 원본 조립공장과의 관계

| 조립공장 UI | n8n |
|-------------|-----|
| 1 시작·제품 입력 | `02-input-analyze` / master 앞단 |
| 2 DB 확정 | 분석 + master `runDbCandidates` (07 후보 목록, **자동 확정 없음**) |
| 3~5 생성컷 | 파이프라인 `generate-all` / 섹션 이미지 API |
| 6 상세 | 동일 |
| 7 저장 | `05-export` |
| Cafe24 등록 | UI 유지 (안전) |

브라우저 조립공장은 계속 **수동 검수·Cafe24·포토샵식 작업파일** 용도로 씁니다.  
n8n은 **배치/반복 생성 자동화** 축입니다.

## 확장 포인트

- ~~신화사 DB / Cafe24 후보~~ → master `runDbCandidates` + 단독 `07`
- ~~Drive 배치~~ → master `runDriveCheck` / `driveActuallyRun`(기본 false) + 단독 `08`
- ~~Cafe24 dry-run~~ → master `runCafe24DryRun`(기본 false) + 단독 `09` (live 없음)

## 안전 규칙

1. 원본 `src/app-core-*.js` / 조립공장 UI 로직 **수정 금지** (이 패키지 범위 밖)
2. 생성·비용 발생 노드는 Manual Trigger 기본
3. GPT-5.5 한도 시 `llmModel` 을 `gpt-5.3-codex-spark` 로 유지
