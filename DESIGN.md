# 상세페이지 자동화 디자인 기준

## 1. 제품 성격
상세페이지 제작, 상품 DB 정리, Cafe24/마켓플러스 전송을 한 화면에서 다루는 작업용 운영 도구다. 화면은 화려한 소개 페이지가 아니라 반복 작업자가 오래 켜두고 판단할 수 있는 어두운 콘솔형 작업대여야 한다.

## 2. 색상 토큰
- 기본 배경: `--bg` #0f0f13
- 카드 배경: `--bg-card` #1a1a23
- 입력 배경: `--bg-input` #13131a
- 기본 선: `--border` #2a2a36
- 강조색: `--primary` #6366f1, `--primary-h` #818cf8
- 성공/주의/오류: `--ok`, `--warn`, `--err`
- 본문/보조 텍스트: `--text`, `--text-d`, `--text-m`

## 3. 타이포그래피
Pretendard와 Noto Sans KR을 사용한다. 제목은 18-26px 범위에서 굵게, 카드 내부 설명은 11-13px로 촘촘하지만 읽히게 유지한다. 글자 간격은 음수로 줄이지 않는다. 상태 안내문은 `word-break: keep-all`을 기본으로 하여 한국어 단어와 조사가 어색하게 분리되지 않게 한다.

## 4. 간격과 레이아웃
기본 간격은 8px 단위로 잡는다. 주요 패널은 12-16px padding, 큰 섹션은 16-20px padding을 사용한다. 화면 높이가 작아도 오른쪽 메인 스크롤로 모든 기능에 도달해야 하며, 컨트롤 바는 줄바꿈을 허용한다.

## 5. 컴포넌트
- `factory-section`: 큰 작업 단위 카드
- `factory-card`: 단계 또는 보조 패널
- `btn-primary`: 실제 실행 버튼
- `btn-sm`: 보조 실행, 이동, 토글 버튼
- `factory-pill`: 상태나 설정을 짧게 표시하는 배지
- `factory-drop`: 이미지 입력 및 드래그 입력 슬롯
- `intake-mode-switch`: 생산관제 제품 투입 방식을 `신화사 DB에서 선택`과 `신규·미등록 제품 입력`으로 나누는 두 선택 카드다. 현재 방식을 강조하고 다른 방식의 필드는 숨기되, 작은 화면에서는 세로로 쌓여 두 방식 모두 메인 스크롤로 도달 가능해야 한다.
- `product-search-results`: 신화사 원장 검색 결과를 제품명, jcode, 카테고리, 이미지 수, 준비 상태와 함께 세로 목록으로 표시한다. 선택 전에는 작업 생성 버튼을 비활성화하고, 선택 즉시 필수 입력값과 등록 대상 요약을 채운다.
- `candidate-collection-status`: 신화사DB·Cafe24 후보 패널 안에서 `확인 전`, `수집 대기`, `수집 중`, `후보 발견`, `검색 결과 없음`, `수집 실패`, `건너뜀`을 짧은 한 줄로 구분한다. 수집 전 빈 배열을 검색 결과 0건으로 표현하지 않으며, `후보 없음으로 진행` 동작은 상태 안내와 별개로 항상 유지한다.
- `image-intake-card`: 신규·미등록 제품의 기본 이미지와 색상 옵션 이미지를 썸네일, 역할, 사용자 지정 이름, 색상명, SHA-256 준비 상태로 묶어 표시한다. 기본 이미지는 최소 1개가 필요하고 색상 이미지는 선택 사항이며, 원본 전체를 한꺼번에 렌더링하지 않고 지연 썸네일을 사용한다.
- `workfile-intake-panel`: 생산관제에서 `.kuasangse` 작업파일을 읽기 전용으로 여는 입력면이다. 대용량 JSON 해석은 Web Worker에서 수행해 메인 화면을 멈추지 않고, 결과에는 제품·신화사 jcode·필수값 준비 상태·기본/색상 입력 이미지·경쟁사 자료와 대표/사이즈/옵션/일반컷/섹션 Output 후보 및 선택 A컷을 두 열로 분류한다. 작업파일 원본은 수정하지 않으며, 발견한 jcode는 `product-search-results`에 전달해 같은 신화사 제품을 자동 연결한다. 좁은 화면에서는 Input과 Output을 세로로 쌓고 내부 세로 스크롤 없이 앱의 맨 오른쪽 주 스크롤로 전체 목록에 도달해야 한다.
- `required-fields-grid`: 상품명, 카테고리, 소재, 원산지, 규격, 판매가 등 원장 필수값을 일반 입력 필드로 표시한다. 원장 requirements가 제공되면 그 응답을 우선하고, 누락·충돌·invalid 값은 빨간 상태와 구체적인 다음 행동을 함께 표시한다.
- `publication-target-summary`: 선택된 제품의 productId/productKey/categoryId, HTML·이미지 digest, run/fingerprint/revision, 안전 기본값과 idempotencyKey를 Cafe24 승인 전에 한 카드에서 보여준다. 필수 대상값이 하나라도 없으면 승인 실행을 비활성화하고 `approval_target_required`를 표시한다.
- `factory-stage-progress-rail`: 조립공장 1~7 공정 행마다 실제 상태 게이지를 표시한다. 1번 제품/DB에는 신화사DB·Cafe24·경쟁사 VM, 2번 대표이미지에는 대표이미지, 5번 이미지컷에는 이미지컷 세부 게이지를 둔다. 이미지 생성은 완료 자산 수/요청 수, 외부 수집은 연결 확인·요청·응답·완료의 실제 사건만 반영하며 경과 시간만으로 진행률을 올리지 않는다. 비동기 실행 중에는 동일 작업 draft를 계속 렌더해 대기 화면과 진행 화면이 교대로 바뀌지 않게 한다. 공정 카드와 로그는 내부 세로 스크롤을 만들지 않고 앱의 맨 오른쪽 주 스크롤 하나로 1~7번과 로그 끝까지 도달하게 한다.
- `factory-log-disclosure`: 최근 로그와 단계별 전체 로그를 기본 접힘 상태로 요약하는 네이티브 `details` 패널이다. 헤더에는 로그 종류, 최신 기록 한 줄, 전체 건수와 실제 오류 건수를 표시한다. 펼치면 필터와 원문 기록을 보여주며 내부 세로 스크롤을 만들지 않고 앱의 맨 오른쪽 주 스크롤을 사용한다.
- `section-batch-execution-preview`: 섹션 생성 화면의 상단 일괄 기준과 각 미생성 카드에 실제 실행 예정 기준/방식을 함께 표시한다. 카드의 셀렉트는 `개별 설정`으로 명시하고, 상단 일괄값이 개별값을 덮어쓸 때는 실행 전에 우선 적용 사실을 보여준다. 생성 완료·잠금 카드는 남은 섹션 일괄 대상 표시에서 제외한다.
- `selected field transfer panel`: 조립공장 `3. 필수값`의 두 열 검수 영역 아래 전체 너비에 둔다. 실시간 자동 동기화 대신 체크한 값만 신화사DB 또는 Cafe24로 보낸다. 값 체크 목록, 대상별 지원 배지, 확정 대상, 대상별 전송 버튼, 진행/완료/실패 상태를 한 패널에 표시한다. 확정 후보가 없으면 전송 버튼을 비활성화하고 선택하지 않은 값과 지원하지 않는 계약은 payload에서 제외한다.
- `opt-workflow-panel`: 옵션 분류기의 순차 작업대. `1. 업로드 사진 확인 → 2. 사진과 옵션 이름 매칭 → 3. 배치 확인 및 생성` 순서로 세로 배치하며, 각 단계의 사진 수와 완료 상태를 같은 헤더에서 보여준다. 원본 사진 목록은 첫 단계에서 항상 보이고, 자동 배치는 매칭된 사진 수를 기준으로 장당 최대 12칸까지 계산한다. 사용자가 `직접 조정`을 선택한 경우에만 행열 입력을 노출하고 그 값을 보존한다.
- `top-command-row` / `db-workfile-strip`: 화면 맨위, 오른쪽 `연결 API` 배지와 같은 높이에 놓이는 최상위 작업파일 헤더. DB 동기화 상태는 왼쪽, 현재 `.kuasangse` 작업파일명은 가운데 큰 제목, 새 작업·현재 상태 저장·다른 이름으로 저장·작업파일 불러오기는 오른쪽에 둔다. 현재 상태 저장은 이미 선택한 파일에 바로 덮어쓰고 첫 저장만 네이티브 위치 선택창을 연다. 다른 이름으로 저장은 항상 새 이름과 위치를 선택한다. 불러오기는 최근 작업파일 위치에서 시작한다. 작은 화면에서는 제목을 먼저 보여주고 모든 기능을 같은 맨위 영역 안에서 세로로 도달 가능하게 하며, 짧은 화면에서는 본문을 가리지 않도록 상단을 문서 흐름으로 전환한다.
- `factory-sync-bar`: 거절된 정적 I/O 카드 scaffold를 대체하는 조립공장 연결 헤더다. 등록된 `factory-control-command:v1` projection과 control-tower SSE만 사용해 session 연결 여부, capability version, productKey, run, revision, 마지막 event 시각을 표시한다. `다시 연결`은 cursor 이후 SSE를 재개하고 `새로고침`은 versioned worker snapshot 명령만 큐에 넣는다. 연결이 끊기면 마지막 값을 성공처럼 유지하지 않고 `blocked / factory_session_missing`을 표시한다.
- `io-progress-map`: 현재 factory projection의 `inputs[]`, `stages[]`, `progress`만으로 Input과 Output 상태를 압축해 보여주는 master 영역이다. Input은 제품·DB/수동 입력, requirements 불변 snapshot, 기본·색상·옵션 이미지와 이름, 전략·정책을 실제 count/missing으로 표시한다. Output은 대표·사이즈·옵션/색상·일반 컷·섹션 변형·최종 상세 단계의 실제 후보 수와 선택 A컷을 표시한다. 단계 진행률·현재 단계·경과·자동/수동·차단·실패·완료는 factory event 값이며 시간 추정이나 planned 카드로 만들지 않는다.
- `a-cut-contact-sheet`: 선택한 실제 Output 단계의 후보 참조만 보여주는 detail 영역이다. 한 페이지에 최대 24개만 렌더링하고 thumbnail URL은 `loading="lazy"`로 불러오며 원본·로컬 보관함을 스캔하지 않는다. `보기`는 inspector 대상만 바꾸고 A컷을 변경하지 않는다. 명시적 `A컷 선택`만 productId/productKey/stageKey/candidateId/run/fingerprint/revision/idempotencyKey를 묶은 versioned command를 전송하며, saving → receipt/revision → selected 순서를 지킨다.
- `artifact-inspector`: contact sheet에서 본 후보의 asset id, digest, source, model, confidence, rationale, generation receipt를 간결하게 표시하는 inspector다. 데스크톱에서는 문서 흐름 안의 sticky 보조 열, 좁은 화면에서는 contact sheet 아래 일반 블록으로 쌓인다. `다음 미결정`은 후보가 있으나 selectedId가 없는 다음 stage로 이동하고 키보드 focus도 해당 작업면으로 옮긴다.
- `automation-policy-matrix`: `full_auto`를 기본 preset으로 사용하되 신화사 DB, Cafe24, 5개 경쟁 마켓, 필수값, 대표·사이즈·옵션/색상·일반·섹션·최종 A컷 판단을 각각 배치/제품/단계에서 `auto|manual|inherit`로 제어한다. 유효값은 `stage > product > batch > batch_preset > auto_default` 순서와 출처를 함께 표시하고 실행 시작 시 `policySnapshotId`, `resolved`, `effectiveSources`, `locked=true`인 불변 snapshot으로 PDP job에 저장한다. snapshot 이후 UI 변경은 진행 중 실행에 소급 적용하지 않는다.
- 자동 판단은 API Hub의 `chatgpt_login_oauth` 상태와 `/api/llm/options`, `/api/gpt-oauth/exec`만 사용한다. 화면은 API 응답의 model/reasoning/service tier를 표시하며 기본은 latest model·`medium`·`standard`다. 후보가 정확히 하나면 모델을 호출하지 않고 후보 집합 digest가 있는 결정론적 receipt를 만들며, 복수 후보는 first/recent/random fallback 없이 단일 판단 또는 dual review를 수행한다. dual 불일치나 임계값 미달은 `waiting_manual`로 worker를 반납하고 다음 자동 제품을 진행한다.
- 모든 자동 판단 receipt는 후보 ID/digest 집합, 선택 ID, rationale, model, reasoning, service tier, confidence/threshold/hold reason, policy snapshot, product/run/fingerprint/revision/event identity를 포함해 기존 신화사 PDP decision API로 저장한다. 생산관제 SQLite나 브라우저 저장소는 판단 원장으로 사용하지 않는다. A컷 자동 판단이 확정되면 기존 `selectFactoryACut` worker command로만 저장하고, Cafe24는 기존 일회 승인 target gate와 F/F/F versioned bridge를 재사용한다. 승인 token이 없거나 stale/tampered이면 `approval_required`에서 멈추며 자동 우회하지 않는다.
- `factory-registration-panel`: 모든 필수 Input과 단계별 A컷이 확정된 뒤 기존 Task15 Cafe24 preflight/one-time approval/versioned execution bridge를 그대로 연결한다. productId/productKey/categoryId/htmlDigest/imageDigests, F/F/F, idempotencyKey, approval token 상태, remote readback/publication receipt를 표시하고 정확한 blocker를 나열한다. 실행은 고정된 승인 대상, 일회 token, 별도 확인 체크와 최종 확인을 모두 통과해야 하며 UI는 sender나 승인 gate를 중복 구현하지 않는다.
- `workfile-report-ledger`: `.kuasangse` 작업파일 하나를 한 카드로 표시하고 마지막 완료 단계, 멈춘 단계, 섹션 수, Cafe24 등록 상품번호·링크·등록 원본·후속 보정 파일을 함께 보여준다. 리포트는 현재 편집 작업과 분리된 읽기 전용 화면이며, 읽기 전용 작업파일을 연 상태에서도 조회·새로고침·리포트 폴더 열기가 가능해야 한다. 카드 안에 별도 세로 스크롤을 만들지 않고 작은 화면에서는 요약과 행동을 세로로 쌓아 앱의 맨 오른쪽 주 스크롤로 모두 도달하게 한다.

### 생산관제 factory API 동기화 계약
- source of truth는 최신 조립공장의 public store projection, 일곱 factory-tab 계약, composition command API, 등록된 ESM/versioned command bridge다. 생산관제 브라우저는 classic store, DOM, 저장소를 직접 읽거나 쓰지 않는다.
- initial snapshot은 현재 제품/input snapshot/requirements, 기본·색상·옵션 이미지와 이름, 실제 생성 후보, 단계별 selectedId, workfile/revision/run/fingerprint, 진행 event와 Cafe24 preflight를 stable key로 투영한다. capability가 있으나 산출물이 비어 있으면 `아직 생성되지 않음`, factory session이 없으면 `조립공장 연결 끊김`이다.
- incremental SSE는 productId/productKey/run/fingerprint/revision/sequence를 확인한 뒤 한 제품·한 stage 또는 전체 snapshot만 갱신한다. stale run/fingerprint/revision/event는 거부하며 reconnect는 `Last-Event-ID`/cursor 이후부터 중복 없이 재개한다.
- A컷 선택은 대표·사이즈·옵션/색상·일반 컷·섹션 변형·최종 상세 모두 같은 `selectFactoryACut` command/receipt 의미를 사용한다. 저장 성공 후 진행 event가 재개되고, 모든 필수 A컷이 해결되면 Cafe24 preflight가 `approval_required`로 이동한다.
- Cafe24는 기존 Task15 `cafe24_staging`, one-time approval gate, worker route와 `factory-cafe24-command:v1`만 사용한다. 상태 순서는 `blocked → ready/approval_required → executing → staged_verified|failed`이며 stale/reused/tampered approval은 성공으로 표시하지 않는다.
- 100개와 200개 제품은 기존 virtual queue 또는 최대 15개 API page를 유지한다. 후보 contact sheet는 최대 24개 thumbnail metadata만 DOM에 두고, 모든 영역은 별도 주요 세로 스크롤 없이 문서 루트의 오른쪽 스크롤바 하나로 도달한다.

### Task 13 메뉴 shell 계약
- `menu-shell`: 생산관제의 7개 메뉴를 `개요`, `입력·소스`, `경쟁사`, `생산·A컷`, `자동판단`, `Cafe24`, `감사·동기화`로 고정한다. 메뉴 registry가 key, label, tab, panel을 한 번만 정의하고 API projection을 복제하지 않는다.
- `menu-tab`: `role=tablist` 안에서 `role=tab`, `aria-selected`, `aria-controls`, roving `tabindex`를 사용한다. 클릭과 Arrow/Home/End/Enter/Space 키보드 동작은 같은 active key를 갱신하며 활성 메뉴만 패널을 표시한다.
- `menu-panel`: `role=tabpanel`과 `hidden`을 사용해 비활성 기능을 문서 흐름과 렌더 트리에서 숨긴다. 기능을 삭제하지 않으며 상태 store/SSE 수명은 메뉴 전환과 독립적이다. 모든 패널의 길이는 문서 root `main.page` 오른쪽 scrollbar로 도달한다.
- `persistent-sync-bar`: header에 current product/job, factory session, capability, stage, percent, elapsed, revision, SSE cursor, reconnect/refresh를 계속 표시한다. 연결·진행 값은 실제 factory projection/event에서만 갱신하고 메뉴를 바꿔도 유지한다.
- `stage-subnav`: `생산·A컷` 안에 제품·DB, 대표, 사이즈, 옵션·색상, 일반컷, 섹션, 최종 상세 7개 stage key를 compact switch로 둔다. 후보 `보기`와 명시적 A컷 선택은 기존 command/receipt 경계를 그대로 사용한다.
- grouping/visibility: Input source와 intake는 `입력·소스`, 시장별 수집은 `경쟁사`, factory stages와 A컷은 `생산·A컷`, GPT/policy는 `자동판단`, 기존 Task15 preflight/approval/readback은 `Cafe24`, SSE/event/receipt는 `감사·동기화`에만 둔다. 메뉴 badge는 projection의 missing/manual/blocked/synced 상태와 count에서만 계산한다.
- responsive/accessibility: 1280/1024px에서는 메뉴와 패널 내부 grid를 compact하게 유지하고 375px에서는 tab/stage control을 wrap/stack한다. 고정 높이·주요 nested scroll·sticky로 콘텐츠를 가리지 않으며 CJK는 `word-break: keep-all`, focus-visible outline, semantic heading/nav/button을 보장한다.

## 6. 상태 표현
작업 중, 대기, 완료, 검수 필요, 오류를 숨기지 않는다. 자동화 UI는 다음 행동을 명확히 제시하고, 기존 수동 전광판은 항상 남겨서 사용자가 원하면 직접 개입할 수 있게 한다.

- 신화사DB·Cafe24 후보 확정은 사이즈값을 준비하고 `사이즈이미지 생성 대기` 상태만 표시한다. DB/Cafe24 후보 확인 패널에 대기 이유와 명시적 생성 버튼을 남기며, 이 확정 행동만으로 이미지 생성 엔진을 시작하지 않는다. 사용자가 `사이즈이미지 생성` 또는 `전체 자동 실행`을 명시했을 때만 size 단계를 실행한다.
- 긴 일괄 생성에는 `현재 섹션까지만 생성` 제어를 둔다. 누르면 현재 섹션의 텍스트와 이미지 저장을 끝낸 뒤 다음 섹션을 시작하지 않으며, 버튼은 즉시 `현재 섹션 마무리 중` 상태로 바뀐다. 부분 완료 결과는 미리보기와 내보내기에서 그대로 사용할 수 있어야 한다.

## 7. 금지 사항
기존 동작을 새 로직으로 갈아엎지 않는다. 자동화 화면은 기존 기능을 호출하는 지휘판이어야 하며, 옵션표/이미지컷/Cafe24/마켓플러스 세부 구현을 중복 작성하지 않는다.
