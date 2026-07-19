# 조립공장 UI ↔ n8n 단계 대응

## 조립공장 컨베이어

| UI 단계 | id | n8n |
|---------|-----|-----|
| 제품/DB | db | `02-input-analyze` + master `runDbCandidates`(07 후보) |
| 대표이미지 | hero | `04-generate-all` 내 섹션 이미지로 근사 / 추후 전용 컷 API |
| 사이즈 | size | 동일 |
| 색상옵션 | options | 1차 범위 밖 (브라우저 옵션분류기) |
| 이미지컷 | cuts | 동일 (generate-all / 추후 Drive 자동화 연결) |
| 상세 | detail | `04-generate-all-sections` |
| 저장 | export | `05-export` |
| Cafe24 등록 | publish | **UI 유지** (의도적 제외) |

## 자동화 탭

| 탭 | n8n |
|----|-----|
| 시작 | Set Config + 이미지 입력 |
| DB 확정 | Analyze + 후보 목록(master/07) 후 **브라우저에서 수동 확정** |
| 필수값 | 확장 포인트 |
| 경쟁사 | `03-competitors` |
| 생성컷 선택 | 생성 후 UI 검수 |
| 섹션 생성 | `04` |
| 전송 | Cafe24 UI |

## 확장 워크플로 (1·2·3)

| # | 파일 | 조립공장 대응 |
|---|------|----------------|
| 1 | `07-db-candidates-sinhwa-cafe24` | DB/Cafe24 후보 수집 |
| 2 | `08-drive-image-cuts-automation` | 자동화 탭 Drive 이미지컷 |
| 3 | `09-cafe24-openmarket-dry-run` | 오픈마켓 dry-run / 보내기 조건 |

### 07 사용
- 단독: `query` = 제품명
- master 내장: `runDbCandidates=true` (기본) → Analyze 직후 동일 경로 실행, 쿼리는 `productName`
- 신화사: API Hub connector → 실패 시 `8200` direct
- Cafe24: `cafe24_control_tower` / `products`
- **자동 확정 안 함** (후보 목록만). Final Summary 에 `sinhwaCount` / `cafe24Count` / top 5
- 검색 실패해도 master 메인 라인 유지 (`onError: continueRegularOutput`)

### 08 사용
- 단독: 기본 `actuallyRun=false` → config/status 조회만
- master: `runDriveCheck=false`(기본). 조회만 하려면 true, 실행은 `driveActuallyRun=true` 추가
- 실행 시 Drive 입력 폴더 이미지에 비용 발생 가능
- master는 POST 후 폴링 없음 → 장시간 폴링은 단독 `08`
- `mode` / `driveMode`: `image-cuts` 또는 `detail-page`

### 09 사용
- 단독·master 모두 dry-run / read-only
- master: `runCafe24DryRun=false`(기본, opt-in)
- API Hub `openmarket-seller/{channel}/register-product` + `dryRun:true` 하드코딩
- 백엔드 marketplus recipe dry-run + browser status
- **live POST 없음**

## 여전히 브라우저 전용

- 옵션 분류기 캔버스/픽셀 규칙
- Cafe24 실등록 클릭·CDP 자동 전송
