# Goal runner (조립공장 → n8n)

## Start / continue

Goal is **ACTIVE** (see `GOAL_ACTIVE.md`).

1. Put a product image URL into `decision-policy.json` → `imageUrl`
2. Ensure backend `:5050`, API Hub `:4321`, n8n `:5678` are up
3. Run workflow **`PDP GOAL 11 - Unattended Factory Line`** in n8n (Manual Trigger)
4. Or re-import: `scripts/docker-reimport.ps1`

## Rules

- Do not break web 조립공장 (`src/app-core-*.js`)
- Prefer n8n JSON + policy + existing APIs
- Gates stay in the graph; goalMode auto-fills decisions
- Cafe24: only 진열안함 + 판매안함 registration
