# Task 7 analysis route ownership receipt

Scope: analysis route only. No competitor, sections, preview, model-settings, upload/manual, `dist`, git, network, or external-service work was performed.

## Criteria and evidence

1. Baseline RED
   - Scenario: the analysis menu initially does not own `#analysisHubStartBtn`.
   - Invocation: `node --test tests/frontend/task7_menu_event_ownership.test.cjs`
   - Binary observable: 13 tests, 7 pass, 6 fail; first analysis failure is `#analysisHubStartBtn: click is not owned by menu.bind()`.
   - Artifact: `.evidence/task7-analysis/01-baseline-red.log`

2. Analysis DOM event ownership and behavior
   - Scenario: root-scoped delegated handlers commit product-name input, start analysis, open/upload files, apply a DB candidate, ignore an unknown control, stay outside a foreign root, and become a no-op after route leave; the disposer removes every delegated listener.
   - Invocation: `node --test tests/frontend/task7_menu_event_ownership.test.cjs`
   - Binary observable: `Task 7 analyzing menu.bind owns rendered controls without classic bindEvents` passes; final matrix is exactly 13 tests, 8 pass, 5 remaining non-analysis failures.
   - Artifact: `.evidence/task7-analysis/12-final-13-case.log`

3. Listener lifecycle and stale route fence
   - Scenario: analysis bind/dispose/onLeave is repeated for 50 cycles and a captured click listener is invoked after route leave.
   - Invocation: `node --test --test-name-pattern="Task 7 repeated bind/dispose|Task 7 analyzing" tests/frontend/task7_menu_event_ownership.test.cjs`
   - Binary observable: 2 tests pass, 0 fail; no listener remains and the stale listener adds no action call.
   - Artifact: `.evidence/task7-analysis/06-analysis-50cycle-stale.log`

4. Task 6 analysis contracts remain compatible
   - Scenario: route command allowlist (`analyzing.stopAnalysis`, `upload.startAnalysis`), 50-cycle lifecycle, read-only rejection, and async workspace fence.
   - Invocation: `node --test --test-name-pattern="allowlist export|bind/onEnter/onLeave|읽기 전용 권한|비동기 route 명령" tests/frontend/task6_domain_route_modules.test.cjs`
   - Binary observable: 4 tests pass, 0 fail.
   - Artifact: `.evidence/task7-analysis/09-task6-analysis-focused.log`

5. Classic analysis ownership retired
   - Scenario: inspect only the `bindEvents()` slice between `function bindEvents()` and `function bindColorPickerPair` for the analysis selector/action/listener allowlists.
   - Invocation: PowerShell source-slice audit recorded in the artifact.
   - Binary observable: `analysisSelectorsRemaining=0`, `classicAnalysisActionCallsRemaining=0`, `classicAnalysisListenerAssignmentsRemaining=0`.
   - Artifact: `.evidence/task7-analysis/10-classic-analysis-owner.log`

6. Canonical selector-writer audit
   - Scenario: run the canonical v3 AST audit and select `src/app-core-05.js`.
   - Invocation: `node .omo/evidence/kuasangse-menu-modularization/task-7/remediation-B2-B3/full-selector-scope-audit-v3.cjs`
   - Binary observable: `directWriterScopes=0`, `directMutationCount=0`, `unresolvedExternalEdgeScopes=0` (`selectorCalls=65`).
   - Artifacts: `.evidence/task7-analysis/07-v3-audit.json`, `.evidence/task7-analysis/08-v3-app05-summary.log`

7. Syntax and module size
   - Scenario: parse every owned changed source/test and measure `analysis-menu.mjs` pure LOC.
   - Invocation: `node --check` for `src/menus/analysis-menu.mjs`, `src/app-core-03.js`, `src/app-core-05.js`, and `tests/frontend/task7_menu_event_ownership.test.cjs`.
   - Binary observable: four syntax passes; analysis menu pure LOC is exactly 250.
   - Artifact: `.evidence/task7-analysis/11-syntax-loc.log`

## Full Task 6 blocker classification

- Test: `Task 6 route 구현은 classic 전역과 중복 렌더 구현에 의존하지 않는다` in `tests/frontend/task6_domain_route_modules.test.cjs`.
- Invocation: `node --test tests/frontend/task6_domain_route_modules.test.cjs`.
- Exact assertion: line 265 `assert.match(app, new RegExp(...), spec.id)` for `spec.id === 'upload'`.
- Expected expression: `/state\.step === 'upload' \? renderRuntimeMenu\('upload'\)/`.
- Actual expression/state: `src/app-core-03.js` contains no per-route `state.step === 'upload' ? renderRuntimeMenu('upload')` ternary; the shared B4 work has centralized routing through `renderRuntimeMenuActivation` and `createRouteController`.
- Classification: stale source-characterization gate versus shared B4 architecture, not an analysis-route product failure. It is outside this analysis-only assignment and was not modified.
- Binary observable: full Task 6 result is 10 tests, 9 pass, 1 fail at the exact upload assertion above.
- Artifact: `.evidence/task7-analysis/05-task6-regression.log`

## Changed ownership

- `src/menus/analysis-menu.mjs`
- exact analysis action capability block in `src/app-core-03.js`
- exact classic analysis listener block removed from `src/app-core-05.js`
- analysis coverage/harness in `tests/frontend/task7_menu_event_ownership.test.cjs`
- this evidence directory
