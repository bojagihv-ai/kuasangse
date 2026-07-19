# 생산관제 Task 1 격리 런타임

## 목적

생산관제는 기존 상세페이지 조립공장과 별도 프로세스로 실행되는 읽기 전용 상태 셸이다. Task 1의 경계는 실행 환경과 신뢰 경계를 고정하고, 이후 작업이 기존 조립공장의 이미지 생성·작업파일·Cafe24 전송 구현을 복사하지 않도록 하는 데 있다.

프로그램 식별자는 `batch-production-control`, 화면 표시 이름은 `생산관제`다.

## 프로세스와 기본 주소

| 구성 | 기본 주소 | 소유 범위 |
| --- | --- | --- |
| 생산관제 백엔드 | `127.0.0.1:5062` | Flask `GET /api/health` |
| 생산관제 정적 화면 | `127.0.0.1:8082` | `control_tower/frontend/control-tower.html` |
| 기존 조립공장 화면 | `127.0.0.1:8081` | 읽기 전용 연결 대상, 이 작업에서 시작·종료하지 않음 |
| 기존 조립공장 백엔드 | `127.0.0.1:5050` | 읽기 전용 연결 대상, 이 작업에서 시작·종료하지 않음 |
| API Hub | `127.0.0.1:4321` | 링크만 표시, Task 1에서 호출하지 않음 |

백엔드와 정적 서버의 bind host는 `127.0.0.1`만 허용한다. 백엔드 포트와 정적 프론트 포트는 환경 경계에서 1부터 65535까지의 십진 정수로 파싱한다. 잘못된 값, 0, overflow, 숫자가 아닌 값은 Flask가 준비되기 전에 `ConfigurationError`와 종료 코드 2로 실패한다.

## 실행

기존 의존성을 재사용하고 새 패키지는 설치하지 않는다.

```powershell
backend\venv311\Scripts\python.exe -m control_tower.backend.app
backend\venv311\Scripts\python.exe -m http.server 8082 --bind 127.0.0.1 --directory control_tower\frontend
```

환경값 예시는 다음과 같다.

```powershell
$env:CONTROL_TOWER_BACKEND_PORT = "5062"
$env:CONTROL_TOWER_FRONTEND_PORT = "8082"
$env:CONTROL_TOWER_CORS_ORIGINS = "http://127.0.0.1:8082"
```

`CONTROL_TOWER_CORS_ORIGINS`는 쉼표로 구분할 수 있지만 `http://127.0.0.1:<port>` 또는 `http://localhost:<port>` 형태만 허용한다. wildcard, 자격증명, 경로, query, fragment, non-loopback host는 설정 단계에서 거부한다.

## HTTP 경계

`GET /api/health`는 다음의 결정적 JSON을 반환한다.

- `service`: `batch-production-control`
- `displayName`: `생산관제`
- `status`: `ready`
- `version`: `1.0.0`
- `schemaVersion`: `1`
- `listen`: 실제 백엔드 bind host와 port
- `links`: 기존 조립공장 화면·백엔드와 API Hub의 설정된 기본 URL

health 응답에는 timestamp, 임의 ID, 환경변수 전체, 비밀값을 넣지 않는다. 등록되지 않은 경로는 `404`와 `status=error`를 반환하며 준비 상태를 위조하지 않는다.

## CORS 신뢰 경계

허용 origin은 설정된 로컬 origin만 사용한다. 허용 GET은 정확한 `Access-Control-Allow-Origin`과 `Vary: Origin`만 반환한다. 허용 preflight는 `GET, HEAD, OPTIONS`와 `Content-Type`만 광고한다. credentials와 wildcard는 사용하지 않는다. 허용 목록 밖의 `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`는 `403`이며 `Access-Control-Allow-Origin`을 내보내지 않는다. 불허 GET은 브라우저가 읽을 수 있는 CORS 허용 헤더를 받지 않는다.

## Task 1에서 하지 않는 일

- 작업 생성, claim, heartbeat, 장기 폴링, mutation API를 제공하지 않는다.
- 이미지 생성, 후보 선택, Cafe24 전송, 기존 백엔드 import를 수행하지 않는다.
- 5050 또는 8081 프로세스를 시작·종료·재설정하지 않는다.
- 화면에는 가짜 진행률이나 실제 확인하지 않은 연결 성공 상태를 표시하지 않는다.

## 프론트엔드 스크롤 계약

정적 화면의 `html`이 유일한 세로 스크롤 소유자다. 문서와 주요 셸에는 고정 높이와 nested overflow를 두지 않는다. `scrollbar-gutter: stable`로 오른쪽 주 스크롤바가 유지되며, intrinsic grid와 wrap 레이아웃으로 작은 높이와 좁은 폭에서도 모든 상태 정보에 도달할 수 있다. 화면은 health 응답을 받아야만 준비 상태를 표시하고, 요청 실패는 별도의 오류 상태로 표시한다.
