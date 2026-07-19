# n8n HITL 설계 (조립공장 동일 작업)

앱 코드 수정 없음. 오케스트레이션 + 사람 게이트만 n8n.

## 선택 UI 전략 (3번)

| 게이트 | n8n에서 쓰는 수단 | 이유 |
|--------|-------------------|------|
| 제품명 확정 | **Form** (text) | 단순 |
| DB/Cafe24 후보 선택 | **Form** (dropdown/text ID) | 후보를 직전 노드가 JSON으로 넘김 |
| 필수값 기입 | **Form** (필드별 text/number) | 누락 목록만 표시 |
| VM 후보 선택 | **Form** (multi text: 1,3,5) | 목록은 메시지/필드 description |
| 사용 이미지 선택 | **Form** (multi ID) + URL 목록 | 썸네일 그리드는 Form 한계 → ID 선택 |
| 전송 승인 | **Form** (confirm boolean) | live 차단 기본 |

추후: `http://127.0.0.1:8081` 에 **읽기 전용 선택 페이지**를 두더라도,  
앱 코어를 수정하지 않고 **별도 static HTML** 또는 n8n webhook만 사용.

## Wait 패턴 (n8n 2.x)

중간 사람 입력:

1. 후보/누락을 `Prepare Form Data` Code 노드로 정리  
2. **Wait** (`resume: form` 또는 webhook)  
3. 응답을 `Apply Decision` 에 병합  
4. 다음 자동 단계

Form Trigger는 **시작 전용**으로도 쓸 수 있음 (이미지 파일 업로드 Form).

## 마스터 플로우 ID

- `pdp-hitl-00-factory-line` — 조립공장 동일 순서 HITL 마스터  
- 기존 `pdp-00-master-orchestrator` 는 배치/자동 실험용으로 유지  
- 하위: 기존 `pdp-01` … `pdp-09` 재사용 + HITL Form 게이트 삽입

## 데이터 버스 (execution json)

```json
{
  "backendBase": "http://127.0.0.1:5050",
  "apiHubBase": "http://127.0.0.1:4321",
  "productName": "",
  "imageUrl": "",
  "project_id": "",
  "analysis": {},
  "sinhwaCandidates": [],
  "cafe24Candidates": [],
  "confirmedSinhwa": null,
  "confirmedCafe24": null,
  "missingFields": [],
  "productFields": {},
  "vmCandidates": [],
  "selectedVmIndexes": [],
  "generatedAssets": { "hero": [], "cuts": [], "size": [], "options": [] },
  "selectedAssetIds": { "hero": [], "cuts": [], "size": [], "options": [] },
  "detailReady": false,
  "publishApproved": false,
  "flags": {
    "autoApplyTopDb": false,
    "runLivePublish": false
  }
}
```
