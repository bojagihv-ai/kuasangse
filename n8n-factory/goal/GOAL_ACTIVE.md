# ACTIVE GOAL

**Started:** 2026-07-12  
**Status:** IN_PROGRESS  
**Workspace:** `C:\Users\kua\Documents\GitHub\kuasangse\n8n-factory`  
**App src:** DO NOT modify assembly factory UI logic (`src/app-core-*.js`)

## Goal

조립공장 필수 기능을 n8n에 빠짐없이 구현하고, `decision-policy.json`으로 무인 통과한 뒤  
Cafe24에 **진열안함 + 판매안함** 상품 등록까지 성공.

## Success

See `SUCCESS_CHECKLIST.md` A1–A12 all checked + `runs/*/SUCCESS.json`.

## Current milestone

**M0 DONE** — harness + `PDP GOAL 11 - Unattended Factory Line` imported (12 workflows)  
**Now: M1** — stage-separated hero/size/cuts/options/detail15 + stronger checklist  
Then **M3** Cafe24 진열안함/판매안함 register  

### How to run Goal 11
1. n8n http://127.0.0.1:5678  
2. Open **PDP GOAL 11 - Unattended Factory Line**  
3. Manual Trigger (policy embedded; image via host.docker.internal:5050)  
4. Ensure backend 5050 + API hub 4321 reachable from Docker
