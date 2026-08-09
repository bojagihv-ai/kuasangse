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
const hostLockIndex = guestBridge.indexOf('[IO.FileShare]::None');
const heartbeatTimerStartIndex = guestBridge.indexOf('$heartbeatTimer = [VmCandidateBridgeHeartbeat]::new');
const checks = {
  frontendUsesVmBridge: frontend.includes("/api/vm-candidate-search") && frontend.includes('compMarketTryVmCandidateBridgeSearch'),
  frontendKeepsVmAndLocalCandidateResultsSeparate: frontend.includes("const collectMode = mode === 'local' ? 'local' : 'vm';")
    && frontend.includes("const deferMissingSiteAssistance = collectMode === 'vm'")
    && frontend.includes('? true')
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
  backendNeverAutostartsHostWatcher: backendBridge.includes('_ensure_host_watcher')
    && backendBridge.includes('VM 내부 후보 수집 watcher가 준비되지 않았습니다.')
    && !backendBridge.includes('subprocess.Popen('),
  backendNeverRestartsHostWatcher: !backendBridge.includes('process.terminate()')
    && !backendBridge.includes('process.kill()'),
  backendBoundsUnclaimedQueue: backendBridge.includes('vm_bridge_watcher_unresponsive')
    && backendBridge.includes('_wait_for_watcher_claim'),
  backendUsesHeartbeatForLiveness: backendBridge.includes('return _watcher_heartbeat_is_fresh()'),
  backendAnnotatesBusyQueue: backendBridge.includes('_watcher_has_active_job')
    && backendBridge.includes('"queue_state": "watcher_busy"')
    && backendBridge.includes('_WATCHER_BUSY_MESSAGE'),
  backendTombstonesOnlyUnclaimedTimeout: backendBridge.includes('.touch(exist_ok=False)')
    && backendBridge.includes('cancelled.json')
    && backendBridge.includes('except FileExistsError')
    && (backendBridge.match(/_mark_job_error\(/g) || []).length >= 4,
  guestCallsLocalWorker: guestBridge.includes("/api/v1/searches") && guestBridge.includes('127.0.0.1:5002'),
  bridgeLoadsEnvFallbackInMemory: guestBridge.includes("'C:\\JepumScraper\\.env'")
    && guestBridge.includes('JEPUM_API_KEY')
    && guestBridge.includes("$headers['X-API-Key'] = $key"),
  bridgeUsesExclusiveHostLock: guestBridge.includes("'candidate-bridge-host.lock'")
    && guestBridge.includes('[IO.FileShare]::None'),
  bridgeDefaultsHeartbeatBesideQueue: guestBridge.includes("Join-Path $BridgeRoot '.host-watcher.heartbeat'"),
  bridgeDoesNotRecreateExistingSharedRoot: guestBridge.includes('Ensure-BridgeDirectory -Path $heartbeatDirectory'),
  bridgeDoesNotRecreateExistingJobDirectories: guestBridge.includes('function Ensure-BridgeDirectory')
    && guestBridge.includes('Ensure-BridgeDirectory -Path $directory')
    && guestBridge.includes('Ensure-BridgeDirectory -Path $resultDir')
    && guestBridge.includes('Ensure-BridgeDirectory -Path $StateRoot')
    && guestBridge.includes('if ($Path -and -not (Test-Path -LiteralPath $Path -PathType Container))')
    && guestBridge.includes('New-Item -ItemType Directory -Force -Path $Path'),
  bridgePublishesIndependentHeartbeat: guestBridge.includes('class VmCandidateBridgeHeartbeat')
    && guestBridge.includes('new Timer(Touch')
    && guestBridge.includes('FileMode.Create')
    && guestBridge.includes('Encoding.UTF8.GetBytes')
    && guestBridge.includes('public void Pulse()')
    && guestBridge.includes('$script:heartbeatTimer.Pulse()')
    && heartbeatTimerStartIndex > hostLockIndex,
  bridgeKeepsSharedJobLock: guestBridge.includes("'.processing'")
    && guestBridge.includes('New-Item -ItemType File -Path $lockPath -ErrorAction Stop'),
  bridgeHonorsTerminalTombstone: guestBridge.includes("Join-Path $resultDir 'cancelled.json'")
    && guestBridge.includes("@('error', 'failed', 'cancelled')"),
  guestForcesLocalExecution: guestBridge.includes("search_runtime = 'local'") && guestBridge.includes("candidate_runtime = 'local'"),
  guestPreservesVmTransport: guestBridge.includes("search_runtime = 'vm'") && guestBridge.includes("transport = 'shared_folder'"),
  guestForcesLocalDetailExecution: guestBridge.includes("NotePropertyName execution_profile -NotePropertyValue 'local' -Force")
    && guestBridge.includes("execution_profile = 'local'"),
  guestPublishesProgress: guestBridge.includes('/api/progress?job_id=') && guestBridge.includes('current_market'),
  bridgePrioritizesNewestRequest: guestBridge.includes('Sort-Object LastWriteTimeUtc -Descending'),
  bridgeSkipsTerminalHistoryBeforeProcessing: guestBridge.includes('function Test-RequestAlreadyTerminal')
    && guestBridge.includes("Join-Path (Join-Path (Join-Path $BridgeRoot 'results') $jobId) 'status.json'")
    && guestBridge.includes("@('completed', 'error', 'failed', 'cancelled', 'cancelled_partial', 'manual_required')")
    && guestBridge.includes('if (Test-RequestAlreadyTerminal -RequestPath $requestPath)'),
  bridgeProcessesAtMostOneFreshRequestPerLoop: guestBridge.includes('$requestFiles = @(')
    && guestBridge.includes('foreach ($requestFile in $requestFiles)')
    && guestBridge.includes('$requestPath = $requestFile.FullName')
    && /Process-Request -RequestPath \$requestPath[\s\S]{0,260}\s+break/.test(guestBridge),
  guestUsesSearchScopedDetailRoute: guestBridge.includes('vm_worker_search_id') && guestBridge.includes('"/api/v1/searches/$encodedSearchId/detail-captures"'),
  guestFallsBackToGenericDetailRoute: guestBridge.includes('$scopedError = $_.Exception.Message') && guestBridge.includes("Properties.Remove('session_id')"),
  guestUsesConfiguredDetailTimeoutDefault: guestBridge.includes("$Request.PSObject.Properties['job_timeout_sec']")
    && guestBridge.includes('$requestedTimeout =')
    && guestBridge.includes('} else {')
    && guestBridge.includes('$JobTimeoutSeconds')
    && guestBridge.includes('[Math]::Max(30, $requestedTimeout)'),
  bootstrapPrefersSharedBridgeSource: bootstrap.indexOf(sharedBridgeSource) !== -1 && bootstrap.indexOf(sharedBridgeSource) < bootstrap.indexOf(localBridgeSource),
  bootstrapStartsBridgeSupervisor: bootstrap.includes('Start-CandidateBridge') && bootstrap.includes('vm_candidate_bridge_supervisor.ps1') && bootstrap.includes('-BridgeScript'),
  bridgeSupervisorRestartsExitedBridge: bridgeSupervisor.includes('while ($true)') && bridgeSupervisor.includes('$process.WaitForExit()') && bridgeSupervisor.includes('Start-Sleep -Seconds $RestartDelaySeconds'),
};
const failures = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
const result = { ok: failures.length === 0, checks, failures };
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
