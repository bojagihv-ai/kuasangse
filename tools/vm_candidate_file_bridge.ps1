[CmdletBinding()]
param(
    [string]$BridgeRoot = '\\VBOXSVR\KuasangseVmBridge',
    [string]$WorkerBase = 'http://127.0.0.1:5002',
    [int]$PollMilliseconds = 1500,
    [int]$JobTimeoutSeconds = 420,
    [string]$StateRoot = 'C:\ProgramData\JepumVMWorker',
    [string]$WorkerEnvPath = 'C:\JepumScraper\.env',
    [string]$HeartbeatPath = ''
)

$ErrorActionPreference = 'Stop'
$HeartbeatPath = if ($HeartbeatPath) { $HeartbeatPath } else { Join-Path $BridgeRoot '.host-watcher.heartbeat' }
$LogPath = Join-Path $StateRoot 'candidate-bridge.log'
$ApiKeyPath = Join-Path $StateRoot 'jepumscraper_worker_api_key.txt'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;

public sealed class VmCandidateBridgeHeartbeat : IDisposable
{
    private readonly string path;
    private readonly Timer timer;
    private int disposed;
    private int writing;

    public VmCandidateBridgeHeartbeat(string path, int intervalMilliseconds)
    {
        this.path = path;
        Touch(null);
        timer = new Timer(Touch, null, intervalMilliseconds, intervalMilliseconds);
    }

    private void Touch(object state)
    {
        if (Volatile.Read(ref disposed) != 0 || Interlocked.Exchange(ref writing, 1) != 0) return;
        try
        {
            string directory = Path.GetDirectoryName(path);
            if (!String.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            byte[] payload = Encoding.UTF8.GetBytes(DateTime.UtcNow.Ticks.ToString());
            using (FileStream stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
            {
                stream.Write(payload, 0, payload.Length);
                stream.Flush(true);
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        finally { Volatile.Write(ref writing, 0); }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0) timer.Dispose();
    }

    public void Pulse()
    {
        Touch(null);
    }
}
'@

function Write-BridgeLog {
    param([string]$Message)
    try {
        Add-Content -LiteralPath $LogPath -Value ("[{0}] {1}" -f (Get-Date -Format o), $Message) -Encoding UTF8
    } catch {}
}

function Ensure-BridgeDirectory {
    param([string]$Path)
    if ($Path -and -not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Test-RequestAlreadyTerminal {
    param([Parameter(Mandatory)][string]$RequestPath)

    $jobId = [IO.Path]::GetFileNameWithoutExtension($RequestPath)
    $statusPath = Join-Path (Join-Path (Join-Path $BridgeRoot 'results') $jobId) 'status.json'
    if (-not (Test-Path -LiteralPath $statusPath -PathType Leaf)) {
        return $false
    }
    try {
        $existingStatus = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        return @('completed', 'error', 'failed', 'cancelled', 'cancelled_partial', 'manual_required') -contains ([string]$existingStatus.status).ToLowerInvariant()
    } catch {
        return $false
    }
}

function Write-JsonAtomic {
    param([string]$Path, [object]$Value)
    $directory = Split-Path -Parent $Path
    Ensure-BridgeDirectory -Path $directory
    $temp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    ConvertTo-Json -InputObject $Value -Depth 80 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Get-WorkerHeaders {
    $headers = @{ Accept = 'application/json' }
    $key = ''
    if (Test-Path -LiteralPath $WorkerEnvPath -PathType Leaf) {
        foreach ($line in [IO.File]::ReadLines($WorkerEnvPath)) {
            if ($line -notmatch '^\s*(?:export\s+)?JEPUM_API_KEY\s*=\s*(?<value>.*)\s*$') { continue }
            $key = ([string]$matches.value).Trim()
            if ($key.Length -ge 2) {
                $first = $key.Substring(0, 1)
                $last = $key.Substring($key.Length - 1, 1)
                if (($first -eq "'" -and $last -eq "'") -or ($first -eq '"' -and $last -eq '"')) {
                    $key = $key.Substring(1, $key.Length - 2)
                }
            }
            break
        }
    }
    if (-not $key -and (Test-Path -LiteralPath $ApiKeyPath -PathType Leaf)) {
        $key = (Get-Content -LiteralPath $ApiKeyPath -TotalCount 1 -Encoding UTF8).Trim()
    }
    if ($key) { $headers['X-API-Key'] = $key }
    return $headers
}

function Update-BridgeHeartbeat {
    if (-not $HeartbeatPath) { return }
    if ($null -ne $script:heartbeatTimer) {
        $script:heartbeatTimer.Pulse()
        return
    }
$heartbeatDirectory = Split-Path -Parent $HeartbeatPath
Ensure-BridgeDirectory -Path $heartbeatDirectory
    try {
        [IO.File]::WriteAllText($HeartbeatPath, [datetime]::UtcNow.Ticks.ToString())
    } catch {}
}

function Invoke-WorkerJson {
    param(
        [ValidateSet('GET', 'POST')][string]$Method,
        [string]$Path,
        [object]$Body = $null,
        [int]$TimeoutSeconds = 30
    )
    $headers = Get-WorkerHeaders
    $params = @{
        Method = $Method
        Uri = "$WorkerBase$Path"
        Headers = $headers
        TimeoutSec = $TimeoutSeconds
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $params['ContentType'] = 'application/json; charset=utf-8'
        $params['Body'] = $Body | ConvertTo-Json -Depth 80 -Compress
    }
    Update-BridgeHeartbeat
    try {
        $response = Invoke-RestMethod @params
        Update-BridgeHeartbeat
        return $response
    } catch {
        Update-BridgeHeartbeat
        $worker_response = ''
        try {
            $response = $_.Exception.Response
            if ($response -and $response.PSObject.Methods['GetResponseStream']) {
                $reader = [IO.StreamReader]::new($response.GetResponseStream())
                try {
                    $worker_response = $reader.ReadToEnd()
                } finally {
                    $reader.Dispose()
                }
            } elseif ($response -and $response.Content) {
                $worker_response = [string]$response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            }
        } catch {}
        if ($worker_response.Length -gt 800) {
            $worker_response = $worker_response.Substring(0, 800)
        }
        if ($worker_response) {
            throw "$($_.Exception.Message) | worker_response=$worker_response"
        }
        throw
    }
}

function Get-ProgressSnapshot {
    param([string]$SearchId, [object]$Status)
    $events = @()
    try {
        $progress = Invoke-WorkerJson -Method GET -Path "/api/progress?job_id=$([uri]::EscapeDataString($SearchId))" -TimeoutSeconds 10
        $events = @($progress.events)
    } catch {}
    $latest = $events | Select-Object -Last 1
    $message = [string]($latest.status)
    $currentMarket = ''
    if ($message -match '^\[(?<market>[^\]]+)\]') { $currentMarket = [string]$matches.market }
    $accepted = [int]($Status.total)
    $percent = 0
    $reports = @($Status.marketReports)
    if ($reports.Count -gt 0) {
        $requested = ($reports | Measure-Object -Property requested -Sum).Sum
        $acceptedReports = ($reports | Measure-Object -Property accepted -Sum).Sum
        if ([int]$requested -gt 0) { $percent = [math]::Floor(([int]$acceptedReports * 100) / [int]$requested) }
        $accepted = [int]$acceptedReports
    }
    return [ordered]@{
        percent = [math]::Max(0, [math]::Min(100, [int]$percent))
        current_market = $currentMarket
        accepted = [math]::Max(0, $accepted)
        elapsed_seconds = [int]($Status.age_seconds)
        message = if ($message) { $message } else { [string]$Status.status }
        events = $events | Select-Object -Last 8
    }
}

function Write-JobStatus {
    param([string]$ResultDir, [hashtable]$Status)
    $Status.updated_at = (Get-Date).ToString('o')
    Write-JsonAtomic -Path (Join-Path $ResultDir 'status.json') -Value $Status
    Update-BridgeHeartbeat
}

function Resolve-WorkerPath {
    param([object]$Value, [string]$Fallback)
    $text = ([string]$Value).Trim()
    if (-not $text) { return $Fallback }
    if ($text -match '^https?://') {
        try { return ([uri]$text).PathAndQuery } catch { return $Fallback }
    }
    if (-not $text.StartsWith('/')) { return "/$text" }
    return $text
}

function Test-NaverDetailPayload {
    param([object]$Payload)
    foreach ($product in @($Payload.products)) {
        $platform = ([string]$product.platform).Trim().ToLowerInvariant()
        $url = ([string]$product.product_url).Trim().ToLowerInvariant()
        if ($platform -match 'naver|smartstore|네이버|스마트' -or $url -match 'naver\.com') {
            return $true
        }
    }
    return $false
}

function Process-DetailCaptureRequest {
    param([object]$Request, [string]$JobId, [string]$ResultDir)
    $payload = $Request.worker_payload
    if (-not $payload -or -not ($payload -is [psobject])) { throw 'VM 상세수집 worker_payload가 없습니다.' }
    $payload | Add-Member -NotePropertyName capture_runtime -NotePropertyValue 'local' -Force
    $payload | Add-Member -NotePropertyName runtime -NotePropertyValue 'local' -Force
    $payload | Add-Member -NotePropertyName execution_profile -NotePropertyValue 'local' -Force
    $optionsProperty = $payload.PSObject.Properties['options']
    $options = if ($optionsProperty) { $optionsProperty.Value } else { $null }
    if ($options -is [psobject]) {
        $options | Add-Member -NotePropertyName capture_runtime -NotePropertyValue 'local' -Force
        $options | Add-Member -NotePropertyName runtime -NotePropertyValue 'local' -Force
        $options | Add-Member -NotePropertyName execution_profile -NotePropertyValue 'local' -Force
        $options | Add-Member -NotePropertyName transport -NotePropertyValue 'shared_folder' -Force
    } else {
        $options = [pscustomobject]@{ capture_runtime = 'local'; runtime = 'local'; execution_profile = 'local'; transport = 'shared_folder' }
        if ($optionsProperty) { $optionsProperty.Value = $options } else { $payload | Add-Member -NotePropertyName options -NotePropertyValue $options -Force }
    }
    $startedAt = Get-Date
    Write-JobStatus -ResultDir $ResultDir -Status @{ ok = $true; job_id = $JobId; status = 'starting'; transport = 'shared_folder'; capture_runtime = 'vm' }
    $health = $null
    $healthDeadline = (Get-Date).AddSeconds(90)
    do {
        try { $health = Invoke-WorkerJson -Method GET -Path '/api/v1/health' -TimeoutSeconds 12 } catch { Start-Sleep -Seconds 2 }
    } while ($null -eq $health -and (Get-Date) -lt $healthDeadline)
    if ($null -eq $health) { throw 'VM 상세수집 워커 health 응답을 받지 못했습니다.' }
    $workerSearchId = [string]$payload.vm_worker_search_id
    $workerSelectedIds = @($payload.vm_selected_ids | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    $detailPath = '/api/v1/detail-captures'
    $scopedError = ''
    $created = $null
    if ($workerSearchId -and $workerSelectedIds.Count -gt 0) {
        $encodedSearchId = [uri]::EscapeDataString($workerSearchId)
        $payload | Add-Member -NotePropertyName session_id -NotePropertyValue $workerSearchId -Force
        $payload | Add-Member -NotePropertyName selected_ids -NotePropertyValue $workerSelectedIds -Force
        $payload | Add-Member -NotePropertyName source_session_id -NotePropertyValue ([string]$payload.vm_source_session_id) -Force
        $detailPath = "/api/v1/searches/$encodedSearchId/detail-captures"
        try {
            $created = Invoke-WorkerJson -Method POST -Path $detailPath -Body $payload -TimeoutSeconds 45
        } catch {
            $scopedError = $_.Exception.Message
            [void]$payload.PSObject.Properties.Remove('session_id')
            [void]$payload.PSObject.Properties.Remove('selected_ids')
            [void]$payload.PSObject.Properties.Remove('source_session_id')
            $detailPath = '/api/v1/detail-captures'
            Write-BridgeLog "detail job=$JobId scoped_create_failed=$scopedError fallback=generic_products_v1"
            $created = Invoke-WorkerJson -Method POST -Path $detailPath -Body $payload -TimeoutSeconds 45
        }
    } else {
        $created = Invoke-WorkerJson -Method POST -Path $detailPath -Body $payload -TimeoutSeconds 45
    }
    $vmJobId = [string]$created.job_id
    if (-not $vmJobId) { throw 'VM 상세수집 워커가 job_id를 반환하지 않았습니다.' }
    $statusPath = Resolve-WorkerPath -Value $created.status_url -Fallback "/api/v1/detail-captures/$vmJobId"
    $resultPath = Resolve-WorkerPath -Value $created.result_url -Fallback "/api/v1/detail-captures/$vmJobId/results"
    $requestedTimeout = if ($Request.PSObject.Properties['job_timeout_sec'] -and [int]$Request.job_timeout_sec -gt 0) {
        [int]$Request.job_timeout_sec
    } else {
        $JobTimeoutSeconds
    }
    $deadline = (Get-Date).AddSeconds([Math]::Max(30, $requestedTimeout))
    $terminal = @('success', 'partial_success', 'failed', 'error', 'cancelled', 'cancelled_partial')
    $last = $created
    do {
        Start-Sleep -Milliseconds ([math]::Max(500, $PollMilliseconds))
        $last = Invoke-WorkerJson -Method GET -Path $statusPath -TimeoutSeconds 30
        $completed = [int]($last.completed)
        $failed = [int]($last.failed)
        $total = [int]($last.total)
        $percent = if ($total -gt 0) { [math]::Floor((($completed + $failed) * 100) / $total) } else { 0 }
        $manualItems = @($last.manual_items)
        $detailSummary = $last.detail_summary
        $manualRequired = [bool]($last.manual_action_required)
        if (-not $manualRequired -and $detailSummary -and $detailSummary.manual_action_required) { $manualRequired = $true }
        if ($manualItems.Count -eq 0 -and $detailSummary -and $detailSummary.manual_items) { $manualItems = @($detailSummary.manual_items) }
        $progress = @{ percent = [math]::Max(0, [math]::Min(100, $percent)); current_market = [string]$last.current_product_id; accepted = $completed; elapsed_seconds = [int](((Get-Date) - $startedAt).TotalSeconds); message = [string]$last.status }
        Write-JobStatus -ResultDir $ResultDir -Status @{ ok = $true; job_id = $JobId; status = 'polling'; vm_job_id = $vmJobId; transport = 'shared_folder'; capture_runtime = 'vm'; worker_create_path = $detailPath; worker_scoped_error = $scopedError; worker_status = [string]$last.status; vm_status = [string]$last.status; completed = $completed; failed = $failed; total = $total; manual_action_required = $manualRequired; manual_items = $manualItems; manual_wait_remaining_sec = [int]($last.manual_wait_remaining_sec); detail_summary = $detailSummary; progress = $progress }
        if ($manualRequired) {
            try {
                Invoke-WorkerJson -Method POST -Path "$statusPath/cancel" -Body @{} -TimeoutSeconds 15 | Out-Null
            } catch {
                Write-BridgeLog "detail job=$JobId manual_cancel_warning=$($_.Exception.Message)"
            }
            $manualResult = [ordered]@{
                ok = $false
                status = 'manual_required'
                job_id = $JobId
                vm_job_id = $vmJobId
                transport = 'shared_folder'
                capture_runtime = 'vm'
                worker_status = [string]$last.status
                manual_action_required = $true
                manual_items = $manualItems
                manual_wait_remaining_sec = [int]($last.manual_wait_remaining_sec)
                completed = $completed
                failed = $failed
                total = $total
                detail_summary = $detailSummary
                progress = $progress
                result = $last
            }
            Write-JsonAtomic -Path (Join-Path $ResultDir 'result.json') -Value $manualResult
            Write-JobStatus -ResultDir $ResultDir -Status $manualResult
            Write-BridgeLog "detail job=$JobId manual_required=true worker_job=$vmJobId auto_retry=stopped"
            return
        }
    } while ($terminal -notcontains ([string]$last.status).ToLowerInvariant() -and (Get-Date) -lt $deadline)
    if ($terminal -notcontains ([string]$last.status).ToLowerInvariant()) { throw "VM 상세수집 제한시간 초과: $vmJobId" }
    $workerTerminalStatus = ([string]$last.status).ToLowerInvariant()
    $workerTerminalError = ([string]$last.error).Trim()
    $silentNaverManualRequired = (
        @('failed', 'error') -contains $workerTerminalStatus -and
        -not $workerTerminalError -and
        (Test-NaverDetailPayload -Payload $payload)
    )
    if ($silentNaverManualRequired) {
        $naverProduct = @($payload.products) |
            Where-Object {
                (([string]$_.platform).Trim().ToLowerInvariant() -match 'naver|smartstore|네이버|스마트') -or
                (([string]$_.product_url).Trim().ToLowerInvariant() -match 'naver\.com')
            } |
            Select-Object -First 1
        $manualItem = [ordered]@{
            product_id = [string]($naverProduct.product_id)
            title = [string]($naverProduct.title)
            platform = 'naver'
            product_url = [string]($naverProduct.product_url)
            status = 'manual_required'
            manual_required = $true
            manual_kind = 'receipt_or_human_verification'
            manual_title = '네이버 영수증문제입니다'
            manual_message = 'VM 화면에 표시된 답을 입력해주십시오. 입력 후 사용자 조치 완료 버튼으로 같은 상품을 다시 수집합니다.'
            manual_location = 'VM 화면'
        }
        $manualResult = [ordered]@{
            ok = $false
            status = 'manual_required'
            error_code = 'naver_manual_verification_suspected'
            job_id = $JobId
            vm_job_id = $vmJobId
            transport = 'shared_folder'
            capture_runtime = 'vm'
            worker_status = [string]$last.status
            manual_action_required = $true
            manual_items = @($manualItem)
            completed = [int]($last.completed)
            failed = [int]($last.failed)
            total = [int]($last.total)
            detail_summary = $last.detail_summary
            progress = $progress
            result = $last
        }
        Write-JsonAtomic -Path (Join-Path $ResultDir 'result.json') -Value $manualResult
        Write-JobStatus -ResultDir $ResultDir -Status $manualResult
        Write-BridgeLog "detail job=$JobId blank_naver_failure=manual_required worker_job=$vmJobId"
        return
    }
    if (@('failed', 'error', 'cancelled') -contains $workerTerminalStatus) { throw $workerTerminalError }
    $result = Invoke-WorkerJson -Method GET -Path $resultPath -TimeoutSeconds 90
    $artifactRoot = Join-Path $ResultDir 'artifacts'
    Ensure-BridgeDirectory -Path $artifactRoot
    $manifest = @()
    $scraped = $result.scraped_data
    if ($scraped) {
        foreach ($productProp in $scraped.PSObject.Properties) {
            $productId = [string]$productProp.Name
            $detail = $productProp.Value
            $urls = @($detail.screenshot_urls)
            $localSources = if ($detail.screenshots) { @($detail.screenshots) } elseif ($detail.screenshot_paths) { @($detail.screenshot_paths) } else { @() }
            $safeId = [regex]::Replace($productId, '[^0-9A-Za-z_.\-\uAC00-\uD7A3]+', '_').Trim('._')
            if (-not $safeId) { $safeId = 'product' }
            $productDir = Join-Path $artifactRoot $safeId
            Ensure-BridgeDirectory -Path $productDir
            $artifactCount = [Math]::Max($urls.Count, $localSources.Count)
            for ($index = 0; $index -lt $artifactCount; $index++) {
                $url = [string]$urls[$index]
                $localSource = [string]$localSources[$index]
                if (-not $url -and -not $localSource) { continue }
                $outPath = Join-Path $productDir ("{0}.jpg" -f ($index + 1))
                if ($localSource -and (Test-Path -LiteralPath $localSource)) {
                    Copy-Item -LiteralPath $localSource -Destination $outPath -Force
                } else {
                    $artifactPath = Resolve-WorkerPath -Value $url -Fallback ''
                    if (-not $artifactPath) { continue }
                    Invoke-WebRequest -Method GET -Uri "$WorkerBase$artifactPath" -Headers (Get-WorkerHeaders) -OutFile $outPath -TimeoutSec 90 | Out-Null
                }
                $fileName = [IO.Path]::GetFileName($outPath)
                $row = [ordered]@{ product_id = $productId; index = $index; path = $outPath; relative_path = "artifacts/$safeId/$fileName"; file_name = $fileName }
                if ($Request.identity -is [psobject]) { foreach ($identityProperty in $Request.identity.PSObject.Properties) { $row[$identityProperty.Name] = $identityProperty.Value } }
                $manifest += [pscustomobject]$row
            }
        }
    }
    Write-JsonAtomic -Path (Join-Path $ResultDir 'artifact_manifest.json') -Value $manifest
    Write-JsonAtomic -Path (Join-Path $ResultDir 'result.json') -Value ([ordered]@{ ok = $true; status = [string]$last.status; job_id = $JobId; vm_job_id = $vmJobId; transport = 'shared_folder'; capture_runtime = 'vm'; worker_create_path = $detailPath; worker_scoped_error = $scopedError; identity = $Request.identity; result = $result })
    Write-JobStatus -ResultDir $ResultDir -Status @{ ok = $true; job_id = $JobId; status = 'completed'; vm_job_id = $vmJobId; vm_status = [string]$last.status; transport = 'shared_folder'; capture_runtime = 'vm'; worker_create_path = $detailPath; worker_scoped_error = $scopedError; completed = [int]$last.completed; failed = [int]$last.failed; total = [int]$last.total; artifact_count = @($manifest).Count }
}

function Process-Request {
    param([string]$RequestPath)
    $request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $jobId = [string]$request.job_id
    if (-not $jobId) { return }
    $operation = [string]$request.operation
    $resultDir = Join-Path $BridgeRoot "results\$jobId"
    $lockPath = Join-Path $resultDir '.processing'
    Ensure-BridgeDirectory -Path $resultDir
    try { New-Item -ItemType File -Path $lockPath -ErrorAction Stop | Out-Null } catch { return }
    if (Test-Path -LiteralPath (Join-Path $resultDir 'cancelled.json') -PathType Leaf) { return }
    $existingStatusPath = Join-Path $resultDir 'status.json'
    if (Test-Path -LiteralPath $existingStatusPath -PathType Leaf) {
        try {
            $existingStatus = Get-Content -LiteralPath $existingStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if (@('error', 'failed', 'cancelled') -contains ([string]$existingStatus.status).ToLowerInvariant()) { return }
        } catch { return }
    }
    try {
        if ($operation -eq 'detail_capture') {
            Process-DetailCaptureRequest -Request $request -JobId $jobId -ResultDir $resultDir
            return
        }
        if ($operation -ne 'candidate_search') { throw "지원하지 않는 VM 브리지 작업입니다: $operation" }
        $payload = $request.worker_payload
        if ($payload -is [psobject]) {
            $payload | Add-Member -NotePropertyName search_runtime -NotePropertyValue 'local' -Force
            $payload | Add-Member -NotePropertyName candidate_runtime -NotePropertyValue 'local' -Force
            $payload | Add-Member -NotePropertyName runtime -NotePropertyValue 'local' -Force
            $optionsProperty = $payload.PSObject.Properties['options']
            $options = if ($optionsProperty) { $optionsProperty.Value } else { $null }
            if ($options -is [pscustomobject]) {
                $options | Add-Member -NotePropertyName search_runtime -NotePropertyValue 'local' -Force
                $options | Add-Member -NotePropertyName candidate_runtime -NotePropertyValue 'local' -Force
                $options | Add-Member -NotePropertyName runtime -NotePropertyValue 'local' -Force
            } else {
                $options = [pscustomobject]@{
                    search_runtime = 'local'
                    candidate_runtime = 'local'
                    runtime = 'local'
                }
                if ($optionsProperty) {
                    $optionsProperty.Value = $options
                } else {
                    $payload | Add-Member -NotePropertyName options -NotePropertyValue $options -Force
                }
            }
        }
        $status = @{ ok = $true; job_id = $jobId; status = 'starting'; transport = 'shared_folder'; search_runtime = 'vm' }
        Write-JobStatus -ResultDir $resultDir -Status $status
        $health = $null
        $healthDeadline = (Get-Date).AddSeconds(90)
        do {
            try { $health = Invoke-WorkerJson -Method GET -Path '/api/v1/health' -TimeoutSeconds 12 } catch { Start-Sleep -Seconds 2 }
        } while ($null -eq $health -and (Get-Date) -lt $healthDeadline)
        if ($null -eq $health) { throw 'VM 워커 health 응답을 받지 못했습니다.' }
        $created = Invoke-WorkerJson -Method POST -Path '/api/v1/searches' -Body $payload -TimeoutSeconds 45
        $searchId = [string]$created.search_id
        if (-not $searchId) { throw 'VM 워커가 search_id를 반환하지 않았습니다.' }
        $status = @{ ok = $true; job_id = $jobId; status = 'submitted'; search_id = $searchId; vm_search_id = $searchId; transport = 'shared_folder'; search_runtime = 'vm'; progress = @{ percent = 0; current_market = ''; accepted = 0; elapsed_seconds = 0 } }
        Write-JobStatus -ResultDir $resultDir -Status $status
        $deadline = (Get-Date).AddSeconds($JobTimeoutSeconds)
        $last = $created
        $terminal = @('success', 'zero_result', 'failed', 'error', 'cancelled', 'done', 'complete', 'completed', 'finished')
        do {
            Start-Sleep -Milliseconds ([math]::Max(500, $PollMilliseconds))
            $last = Invoke-WorkerJson -Method GET -Path "/api/v1/searches/$searchId" -TimeoutSeconds 30
            $progress = Get-ProgressSnapshot -SearchId $searchId -Status $last
            $status = @{ ok = $true; job_id = $jobId; status = 'polling'; search_id = $searchId; vm_search_id = $searchId; transport = 'shared_folder'; search_runtime = 'vm'; progress = $progress; worker_status = [string]$last.status; total = [int]$last.total }
            Write-JobStatus -ResultDir $resultDir -Status $status
        } while ($terminal -notcontains ([string]$last.status).ToLowerInvariant() -and (Get-Date) -lt $deadline)
        if ($terminal -notcontains ([string]$last.status).ToLowerInvariant()) { throw "VM 후보검색 제한시간 초과: $searchId" }
        if (@('failed', 'error', 'cancelled') -contains ([string]$last.status).ToLowerInvariant()) { throw ([string]$last.error) }
        $result = Invoke-WorkerJson -Method GET -Path "/api/v1/searches/$searchId/results" -TimeoutSeconds 60
        $progress = Get-ProgressSnapshot -SearchId $searchId -Status $result
        Write-JsonAtomic -Path (Join-Path $resultDir 'result.json') -Value ([ordered]@{ ok = $true; status = [string]$last.status; search_id = $searchId; vm_search_id = $searchId; transport = 'shared_folder'; search_runtime = 'vm'; progress = $progress; identity = $request.identity; result = $result })
        Write-JobStatus -ResultDir $resultDir -Status @{ ok = $true; job_id = $jobId; status = 'completed'; search_id = $searchId; vm_search_id = $searchId; transport = 'shared_folder'; search_runtime = 'vm'; progress = $progress; total = [int]$result.total }
    } catch {
        $message = $_.Exception.Message
        $message | Set-Content -LiteralPath (Join-Path $resultDir 'error.txt') -Encoding UTF8
        $status = @{ ok = $false; job_id = $jobId; status = 'error'; transport = 'shared_folder'; operation = $operation; error = $message }
        if ($operation -eq 'detail_capture') { $status.capture_runtime = 'vm' } else { $status.search_runtime = 'vm' }
        Write-JobStatus -ResultDir $resultDir -Status $status
        Write-BridgeLog "job=$jobId operation=$operation error=$message"
    }
}

Ensure-BridgeDirectory -Path $StateRoot
$hostLockPath = Join-Path $StateRoot 'candidate-bridge-host.lock'
$hostLockStream = $null
$heartbeatTimer = $null
try {
    $hostLockStream = [IO.File]::Open(
        $hostLockPath,
        [IO.FileMode]::OpenOrCreate,
        [IO.FileAccess]::ReadWrite,
        [IO.FileShare]::None
    )
} catch [IO.IOException] {
    Write-BridgeLog 'duplicate watcher ignored because this host already owns the bridge lock'
    exit 0
}

try {
    $heartbeatTimer = [VmCandidateBridgeHeartbeat]::new($HeartbeatPath, 1000)
    $processedRequestTokens = @{}
    Write-BridgeLog "started bridge=$BridgeRoot worker=$WorkerBase"
    Update-BridgeHeartbeat
    while ($true) {
        try {
            $requestRoot = Join-Path $BridgeRoot 'requests'
            if (Test-Path -LiteralPath $requestRoot -PathType Container) {
                $requestFiles = @(
                    Get-ChildItem -LiteralPath $requestRoot -Filter '*.json' -File -ErrorAction SilentlyContinue |
                        Sort-Object LastWriteTimeUtc -Descending
                )
                foreach ($requestFile in $requestFiles) {
                    $requestPath = $requestFile.FullName
                    $requestToken = '{0}|{1}|{2}' -f $requestPath, $requestFile.LastWriteTimeUtc.Ticks, $requestFile.Length
                    if ($processedRequestTokens.ContainsKey($requestPath) -and $processedRequestTokens[$requestPath] -eq $requestToken) {
                        continue
                    }
                    if (Test-RequestAlreadyTerminal -RequestPath $requestPath) {
                        $processedRequestTokens[$requestPath] = $requestToken
                        continue
                    }
                    try {
                        Process-Request -RequestPath $requestPath
                    } finally {
                        $processedRequestTokens[$requestPath] = $requestToken
                    }
                    break
                }
            }
        } catch { Write-BridgeLog "loop error=$($_.Exception.Message)" }
        Update-BridgeHeartbeat
        Start-Sleep -Milliseconds ([math]::Max(500, $PollMilliseconds))
    }
} finally {
    if ($null -ne $heartbeatTimer) { $heartbeatTimer.Dispose() }
    if ($null -ne $hostLockStream) { $hostLockStream.Dispose() }
}
