# 조립공장 n8n API 맵

Base: `http://127.0.0.1:5050` (Flask)  
API Hub: `http://127.0.0.1:4321`

## 파이프라인 (백엔드)

| Method | Path | n8n 단계 |
|--------|------|----------|
| POST | `/api/projects` | multipart: `image`, form: `product_name` → `project_id` |
| GET | `/api/projects/{id}` | 진행률/상태 |
| GET | `/api/projects/{id}/full` | 전체 결과 |
| POST | `/api/projects/{id}/analyze` | 제품 이미지 분석 (Gemini/Vertex 서버 설정) |
| POST | `/api/projects/{id}/search-competitors` | 경쟁사 검색 |
| POST | `/api/projects/{id}/sections/{section_id}/generate` | 섹션 텍스트 |
| POST | `/api/projects/{id}/sections/{section_id}/generate-image` | 섹션 이미지 |
| POST | `/api/projects/{id}/generate-all` | 전체 섹션 순차 (오래 걸림) |
| GET | `/api/projects/{id}/export` | export JSON |
| GET | `/api/projects/{id}/export-html` | HTML |
| GET | `/api/sections` | 섹션 정의 health |
| GET | `/api/provider` | Gemini/Vertex 라우트 |
| POST | `/api/gemini/generate-content` | Gemini 직접 프록시 |

## API Hub (GPT OAuth)

| Method | Path | 용도 |
|--------|------|------|
| GET | `/api/status` | Hub 생존 |
| GET | `/api/playbooks/gpt-oauth/status` | 로그인 세션 |
| GET | `/api/gpt-oauth/status` | 모델 옵션 포함 상태 |
| POST | `/api/gpt-oauth/exec` | body: `prompt`, `model`, `reasoningEffort`, `serviceTier`, `timeoutMs`, `jsonOnly`, optional `images[]` |

권장 모델 (한도 여유 시):

- `gpt-5.3-codex-spark` — ChatGPT OAuth 지원 확인됨
- `gpt-5.4` / `gpt-5.5` — 일반 한도 주의

## 신화사 / Cafe24 후보 (07)

| Method | URL | body |
|--------|-----|------|
| POST | `{apiHub}/api/invoke/{sinhwaConnector}/{searchEndpoint}` | `{ query: { q, limit_each } }` |
| GET | `http://127.0.0.1:8200/api/v1/search?q=&limit_each=` | fallback |
| POST | `{apiHub}/api/invoke/cafe24_control_tower/products` | `{ query: { q, limit } }` |
| GET | `{backend}/api/sinhwa-db/status` | 로컬 프로그램 상태 |
| POST | `{backend}/api/sinhwa-db/start` | 로컬 기동 |

기본 connector (앱과 동일):

- sinhwa: `db_7db4f9f8f4074c80`
- search endpoint: `api-search-api-v1-search-get_0cd83217e9d84714`
- cafe24: `cafe24_control_tower` / `products`

## Drive 이미지컷 자동화 (08) — prefix `/pdp`

| Method | Path | 용도 |
|--------|------|------|
| GET | `/pdp/automation/config` | 프로필·Drive 폴더 ID |
| PUT | `/pdp/automation/config` | 프로필 패치 (`profiles.image-cuts`) |
| GET | `/pdp/automation/status` | 실행 중 여부·진행 |
| POST | `/pdp/automation/run` | `{ mode, imageModel, outputImageSize }` 즉시 실행 |
| POST | `/pdp/automation/stop` | 중지 |
| GET | `/pdp/automation/output-images` | 결과 이미지 목록 |

`mode`: `image-cuts` | `detail-page`

## Cafe24 / 오픈마켓 dry-run (09)

| Method | Path | 용도 |
|--------|------|------|
| GET | `/api/marketplus/browser-status` | Chrome 디버그 탭 상태 |
| POST | `/api/marketplus/internal-replay/dry-run` | 레시피 구조 dry-run (쿠키/실전송 없음) |
| GET | `/api/marketplus/send-limit-status` | 수량 제한 안내 읽기 전용 |
| POST | `{apiHub}/api/openmarket-seller/{channelId}/register-product` | body에 **`dryRun: true`** |

실전송(`dryRun:false` / safe-click)은 n8n 패키지에 포함하지 않음.

## 조립공장 UI 전용

- 옵션 분류기 캔버스, last-work 확정 UI, Cafe24 실등록 클릭
