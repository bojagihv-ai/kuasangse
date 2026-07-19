# 조립공장 전체 맵 (앱 로직 기준, 코드 비수정)

기준 코드: `src/app-core-02.js` `FACTORY_STAGE_DEFS` / `FACTORY_AUTOMATION_TABS`  
실행 루프: `src/app-core-06.js` (`factoryRunDbCompetitorHeroCutsFlow`, `factoryRunStage`, `factoryGenerate*`, `factoryConfirmAssetUse` 등)

> 이 문서는 **앱을 고치지 않고** 구조만 읽은 결과다.  
> n8n 이식의 **빠짐없는 체크리스트**로 쓴다.

---

## 0. 한 줄 정의

조립공장 = **입력 이미지를 잠그고 → DB/VM 후보를 모은 뒤 사람이 고르고 → 필수값을 채우고 → 대표/사이즈/옵션/컷을 생성·선택한 뒤 → 상세를 만들고 → 저장/전송** 하는 컨베이어.

앱은 자동 수집·생성과 **사람 검수 게이트**가 섞여 있다.  
n8n 이식의 성공 조건 = **같은 게이트 순서 + 같은 입출력 의미** (픽셀 단위 동일 UI 아님).

---

## 1. UI 탭 (자동화 마법사) — 사람이 보는 순서

| no | tab id | 라벨 | 핵심 행위 | 유형 |
|----|--------|------|-----------|------|
| 1 | `start` | 시작 | 제품 이미지·제품명 입력, 병렬 수집/생성 시작 버튼 | **사람 입력** + **자동 트리거** |
| 2 | `db` | DB 확정 | 신화사DB / Cafe24 후보 중 **실제 상품 선택** | **자동 수집** → **사람 선택** |
| 3 | `fields` | 필수값 | 사이즈/소재/판매가 등 **빠진 값 검수·기입** | **사람 검수** |
| 4 | `competitor` | 경쟁사 | **VM 후보 선택**, 상세 수집/분석 이미지 선택 | **자동 수집** → **사람 선택** |
| 5 | `assets` | 생성컷 선택 | 대표/사이즈/옵션/컷 중 **사용할 이미지 확정** (`used`) | **자동 생성** → **사람 선택** |
| 6 | `sections` | 섹션 생성 | DB/경쟁 소스 기준 확인 후 상세 섹션 생성 | **사람 확인** → **자동 생성** |
| 7 | `publish` | 전송 | 완성 체크 후 Cafe24/마켓플러스 전송 | **사람 최종 승인** + **브라우저/CDP** |

---

## 2. 컨베이어 스테이지 (FACTORY_STAGE_DEFS)

| id | 라벨 | 앱 함수 축 | 상태 예 | 유형 |
|----|------|------------|---------|------|
| `db` | 제품/DB | `factoryRunDbStage` / `factoryRunDbCandidatesForSelection` | running → **review**(선택 대기) / done(자동확정) | 자동+사람 |
| `hero` | 대표이미지 | `factoryRunStage('hero')` → `factoryGenerateImageCutsBackedStage` / presets 차분·모던·고급 | running → done (생성 후 **assets에서 선택**) | 자동+사람 |
| `size` | 사이즈이미지 | `factoryGenerateImageCutsBackedStage('size')` | **blocked** if no size facts | 자동+사람(규격) |
| `options` | 색상옵션 | `factoryGenerateOptionsStage` → `optGenerateOptionImages` | blocked if no option photos/names | 자동+사람(옵션분류기) |
| `cuts` | 이미지컷 | `factoryGenerateImageCutsBackedStage('cuts')` | running → done → assets 선택 | 자동+사람 |
| `detail` | 상세페이지 | `factoryGenerateDetailStage` → `generateAllSections` + 선택 자산 고정 | running → done | 자동(+선택 자산 의존) |
| `export` | 저장 | `factoryArchiveSession` | done | 자동/로컬 |

---

## 3. 첫 실행 원클릭 루프 (앱이 실제로 도는 것)

엔트리: `factoryRunDbCompetitorHeroCutsFlow` (시작 탭 메인 버튼)

```
1) factoryEnsureCurrentProductImageAnalysisForOneClick
   - 현재 업로드 이미지 기준 AI 분석 고정
2) 병렬 Promise.allSettled:
   A) factoryRunDbCandidatesForSelection   → DB 후보 (선택 대기 review)
   B) factoryRunVmCompetitorCollectionForSelection → VM 경쟁 후보
   C) factoryRunHeroAndCutsForOneClick
        - hero N장 생성
        - cuts M장 생성
3) 탭을 db / field-review 쪽으로 두고 **사람 검수 대기**
```

중요: 앱도 원클릭 후 **DB 자동 확정은 기본이 아님**  
(`candidateAutoApply` 켤 때만 1순위 자동).  
→ n8n도 기본은 **후보 수집 후 WAIT(사람 선택)** 이 정답.

---

## 4. 게이트별 입출력 (이식 계약)

### G0 시작 / 입력 잠금
| | |
|--|--|
| 입력 | 제품 이미지(binary/url), 제품명 |
| 자동 | 이미지 분석 JSON, `productName` 힌트 |
| 사람 | 제품명 수정, 잘못된 분석 시 재실행 |
| 출력 | `analysis`, `productName`, 입력 이미지 fingerprint |
| n8n | HTTP 업로드+analyze **또는** 기존 02; 이어서 **Form: 제품명 확정** |

### G1 DB 후보
| | |
|--|--|
| 입력 | productName, 검색 토큰 (`factoryProductSearchAnalyzer`) |
| 자동 | 신화사 후보 목록, Cafe24 후보 목록 (분리 조회) |
| 사람 | 신화사 1개 + Cafe24 1개(또는 스킵) **선택** |
| 출력 | `confirmedSinhwa`, `confirmedCafe24`, 옵션/사이즈 시드 |
| n8n | 07 수집 → **Wait/Form: 후보 ID 선택** → 확정 payload |

### G2 필수값 (fields)
| | |
|--|--|
| 입력 | 확정 DB + 분석값 |
| 자동 | 필드 매핑, 누락 목록 계산 |
| 사람 | 누락 필수값 기입 (사이즈/소재/판매가/분류 등) |
| 출력 | `productFields` complete flag |
| n8n | Code로 누락 검사 → **Form: 빈 칸만 입력** → 재검사 루프 |

### G3 경쟁사 / VM
| | |
|--|--|
| 입력 | productName, run scope |
| 자동 | VM/마켓 후보 리스트 (`factoryRunVmCompetitorCollectionForSelection`) |
| 사람 | 상세 수집할 후보 **다중 선택**, 참고 이미지 선택 |
| 출력 | `selectedVmIds[]`, competitor reference assets |
| n8n | 후보 JSON → **Form: 선택 인덱스/ID** → (가능 시) 수집 API 호출 |

### G4 생성컷 (hero/size/options/cuts)
| | |
|--|--|
| 입력 | 확정 입력 이미지, DB 사이즈/옵션, 프롬프트 프리셋 |
| 자동 | hero/size/cuts 이미지 생성, options는 옵션분류기 하네스 |
| 사람 | assets 탭에서 `factoryConfirmAssetUse` / toggle **사용 확정** |
| 출력 | `stages[stageId].selectedAssetIds`, `asset.used=true` |
| n8n | 생성 API/서브플로 → 결과 URL 목록 → **Form: 사용할 ID 선택** |

### G5 상세 섹션
| | |
|--|--|
| 입력 | analysis + used assets 고정 배치 |
| 자동 | `generateAllSections` / detail HTML |
| 사람 | 소스 기준(DB/경쟁/혼합) 확인 후 실행 |
| 출력 | detail HTML asset |
| n8n | 04 또는 섹션 API + **실행 승인 Form** |

### G6 저장
| | |
|--|--|
| 자동 | 로컬 아카이브 / export JSON |
| n8n | 05 export, 아카이브 경로 기록 |

### G7 전송
| | |
|--|--|
| 사람 | 최종 승인 |
| 브라우저 | Cafe24/마켓플러스 CDP (`factorySafeClickMarketPlusSend` 등) |
| n8n | **승인 Wait** → 기존 백엔드 marketplus API **호출만** (앱 코드 수정 없음) |

---

## 5. 앱 전용 (n8n이 “화면”을 대신 못 하는 것)

| 영역 | 이유 | n8n 전략 |
|------|------|----------|
| 옵션분류기 드래그 캔버스 | 고밀도 UI | 결과 이미지/옵션표는 앱·엔진 호출, n8n은 트리거·선택만 |
| 이미지 썸네일 그리드 UX | Form은 텍스트/파일 위주 | URL 목록 + ID 선택 Form / 추후 얇은 선택 페이지 |
| 마켓플러스 실제 화면 클릭 | CDP·세션 | 백엔드 API 호출 (기존 엔드포인트) |
| last-work / workspace identity | 브라우저 local+서버 | n8n execution data + project_id로 대체 |

---

## 6. 스테이지 상태 머신 (앱)

공통: `idle | running | review | blocked | done | error`

- **review** = 사람 게이트 (DB 후보 등)
- **blocked** = 입력 부족 (사이즈 없음, 옵션 사진 없음…) → 사람 보충 후 재실행
- **done** = 생성 완료 (assets 선택은 별 게이트)

n8n 대응:

| 앱 상태 | n8n |
|---------|-----|
| running | HTTP/서브워크플로 실행 중 |
| review / blocked | **Wait / Form** |
| done | 다음 노드 |
| error | Error 분기 / 재시도 Form |

---

## 7. n8n 이식 원칙 (이번 미션)

1. **앱 `src/app-core-*.js` 수정 금지**
2. 게이트 **스킵 금지** (autoApply 옵션은 플래그로만)
3. 사람 결정은 Form/Wait로 **명시적 resume**
4. 무거운 생성은 기존 5050/4321 API 또는 기존 하위 워크플로 호출
5. 전송은 dry-run 기본, live는 별도 승인 플래그

---

## 8. 구현 우선순위 (하나하나)

| 순서 | 게이트 | 구현물 |
|------|--------|--------|
| P0 | G0 입력+분석 | 기존 02 + Form 제품명 확정 |
| P0 | G1 DB 선택 | 07 + Wait Form 선택 |
| P0 | G2 필수값 | Code 누락검사 + Form |
| P1 | G3 VM 선택 | 후보 수집 + Form |
| P1 | G4 컷 생성+선택 | 생성 후 `/full` 카탈로그 + **Form ID/번호 멀티선택** (HITL 10 구현됨) |
| P1 | G5 상세 | 04/섹션 + 승인 |
| P2 | G6 export | 05 |
| P2 | G7 전송 | 09 dry-run + 승인 후 API |

이 파일이 체크리스트다. 구현 PR/커밋마다 위 표의 행을 닫는다.
