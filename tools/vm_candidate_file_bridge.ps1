[CmdletBinding()]
param(
    [string]$BridgeRoot = '\\VBOXSVR\KuasangseVmBridge',
    [string]$WorkerBase = 'http://127.0.0.1:5002',
    [int]$PollMilliseconds = 1500,
    [int]$JobTimeoutSeconds = 420
)

$ErrorActionPreference = 'Stop'
$StateRoot = 'C:\ProgramData\JepumVMWorker'
$LogPath = Join-Path $StateRoot 'candidate-bridge.log'
$ApiKeyPath = Join-Path $StateRoot 'jepumscraper_worker_api_key.txt'

function Write-BridgeLog {
    param([string]$Message)
    try {
        Add-Content -LiteralPath $LogPath -Value ("[{0}] {1}" -f (Get-Date -Format o), $Message) -Encoding UTF8
    } catch {}
}

function Write-JsonAtomic {
    param([string]$Path, [object]$Value)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temp = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    $Value | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $temp -Encoding UTF8
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Get-WorkerHeaders {
    $headers = @{ Accept = 'application/json' }
    if (Test-Path -LiteralPath $ApiKeyPath -PathType Leaf) {
        $key = (Get-Content -LiteralPath $ApiKeyPath -TotalCount 1 -Encoding UTF8).Trim()
        if ($key) { $headers['X-API-Key'] = $key }
    }
    return $headers
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
    try {
        return Invoke-RestMethod @params
    } catch {
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

function Process-DetailCaptureRequest {
    param([object]$Request, [string]$JobId, [string]$ResultDir)
    $payload = $Request.worker_payload
    if (-not $payload -or -not ($payload -is [psobject])) { throw 'VM 상세수집 worker_payload가 없습니다.' }
    $payload | Add-Member -NotePropertyName capture_runtime -NotePropertyValue 'local' -Force
    $payload | Add-Member -NotePropertyName runtime -NotePropertyValue 'local' -Force
    $optionsProperty = $payload.PSObject.Properties['options']
    $options = if ($optionsProperty) { $optionsProperty.Value } else { $null }
    if ($options -is [psobject]) {
        $options | Add-Member -NotePropertyName capture_runtime -NotePropertyValue 'local' -Force
        $options | Add-Member -NotePropertyName runtime -NotePropertyValue 'local' -Force
        $options | Add-Member -NotePropertyName transport -NotePropertyValue 'shared_folder' -Force
    } else {
        $options = [pscustomobject]@{ capture_runtime = 'local'; runtime = 'local'; transport = 'shared_folder' }
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
    $deadline = (Get-Date).AddSeconds([Math]::Max(30, [int]$Request.job_timeout_sec))
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
    } while ($terminal -notcontains ([string]$last.status).ToLowerInvariant() -and (Get-Date) -lt $deadline)
    if ($terminal -notcontains ([string]$last.status).ToLowerInvariant()) { throw "VM 상세수집 제한시간 초과: $vmJobId" }
    if (@('failed', 'error', 'cancelled') -contains ([string]$last.status).ToLowerInvariant()) { throw ([string]$last.error) }
    $result = Invoke-WorkerJson -Method GET -Path $resultPath -TimeoutSeconds 90
    $artifactRoot = Join-Path $ResultDir 'artifacts'
    New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
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
            New-Item -ItemType Directory -Force -Path $productDir | Out-Null
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
                $row = [ordered]@{ product_id = $productId; index = $index; path = $outPath; file_name = [IO.Path]::GetFileName($outPath) }
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
    New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
    try { New-Item -ItemType File -Path $lockPath -ErrorAction Stop | Out-Null } catch { return }
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

New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
Write-BridgeLog "started bridge=$BridgeRoot worker=$WorkerBase"
while ($true) {
    try {
        $requestRoot = Join-Path $BridgeRoot 'requests'
        if (Test-Path -LiteralPath $requestRoot -PathType Container) {
            Get-ChildItem -LiteralPath $requestRoot -Filter '*.json' -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTimeUtc -Descending |
                ForEach-Object {
                Process-Request -RequestPath $_.FullName
            }
        }
    } catch { Write-BridgeLog "loop error=$($_.Exception.Message)" }
    Start-Sleep -Milliseconds ([math]::Max(500, $PollMilliseconds))
}
