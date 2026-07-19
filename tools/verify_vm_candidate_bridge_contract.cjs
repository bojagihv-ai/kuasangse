const fs = require('fs');

const root = process.cwd();
const read = name => fs.readFileSync(`${root}/${name}`, 'utf8');
const frontend = read('src/app-core-06.js');
const backendRoute = read('backend/routes/api_vm.py');
const backendBridge = read('backend/services/vm_candidate_bridge.py');
const bootstrap = read('tools/bootstrap_jepumscraper_vm_worker.ps1');
const guestBridge = read('tools/vm_candidate_file_bridge.ps1');
const bridgeSupervisor = read('tools/vm_candidate_bridge_supervisor.ps1');
const sharedBridgeSource = String.raw`'Z:\tools\vm_candidate_file_bridge.ps1'`;
const localBridgeSource = "(Join-Path $PSScriptRoot 'vm_candidate_file_bridge.ps1')";
const checks = {
  frontendUsesVmBridge: frontend.includes("/api/vm-candidate-search") && frontend.includes('compMarketTryVmCandidateBridgeSearch'),
  frontendKeepsVmAndLocalCandidateResultsSeparate: frontend.includes("const deferMissingSiteAssistance = options.deferMissingSiteAssistance === undefined")
    && frontend.includes("? collectMode === 'vm'")
    && frontend.includes(': !!options.deferMissingSiteAssistance;'),
  frontendKeepsVmProof: frontend.includes('compMarketAssertVmRuntimeProof([latest, resultPayload])'),
  frontendKeepsIdentity: frontend.includes('identity: scope') && frontend.includes('factoryCompetitorCandidateScopePayload'),
  frontendPreservesDetailArtifactIdentity: frontend.includes('const detailWorkStamp =')
    && frontend.includes('const embeddedStamp = detailWorkStamp(img)')
    && frontend.includes('...detailWorkStamp(value, context)')
    && frontend.includes('const mergedStamp = Object.fromEntries'),
  backendSubmitRoute: backendRoute.includes('@api.route("/vm-candidate-search", methods=["POST"])'),
  backendStatusRoute: backendRoute.includes('@api.route("/vm-candidate-search/<job_id>", methods=["GET"])'),
  backendWritesSharedFolder: backendBridge.includes('output" / "vm-rebuild" / "vm-candidate-bridge"') && backendBridge.includes('requests'),
  guestCallsLocalWorker: guestBridge.includes("/api/v1/searches") && guestBridge.includes('127.0.0.1:5002'),
  guestForcesLocalExecution: guestBridge.includes("search_runtime = 'local'") && guestBridge.includes("candidate_runtime = 'local'"),
  guestPreservesVmTransport: guestBridge.includes("search_runtime = 'vm'") && guestBridge.includes("transport = 'shared_folder'"),
  guestPublishesProgress: guestBridge.includes('/api/progress?job_id=') && guestBridge.includes('current_market'),
  bridgePrioritizesNewestRequest: guestBridge.includes('Sort-Object LastWriteTimeUtc -Descending'),
  guestUsesSearchScopedDetailRoute: guestBridge.includes('vm_worker_search_id') && guestBridge.includes('"/api/v1/searches/$encodedSearchId/detail-captures"'),
  guestFallsBackToGenericDetailRoute: guestBridge.includes('$scopedError = $_.Exception.Message') && guestBridge.includes("Properties.Remove('session_id')"),
  bootstrapPrefersSharedBridgeSource: bootstrap.indexOf(sharedBridgeSource) !== -1 && bootstrap.indexOf(sharedBridgeSource) < bootstrap.indexOf(localBridgeSource),
  bootstrapStartsBridgeSupervisor: bootstrap.includes('Start-CandidateBridge') && bootstrap.includes('vm_candidate_bridge_supervisor.ps1') && bootstrap.includes('-BridgeScript'),
  bridgeSupervisorRestartsExitedBridge: bridgeSupervisor.includes('while ($true)') && bridgeSupervisor.includes('$process.WaitForExit()') && bridgeSupervisor.includes('Start-Sleep -Seconds $RestartDelaySeconds'),
};
const failures = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
const result = { ok: failures.length === 0, checks, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
