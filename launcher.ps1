# 상세페이지 AI 생성기 런처
$Host.UI.RawUI.WindowTitle = "상세페이지 AI 생성기 시작 중..."

Write-Host ""
Write-Host "  ======================================================"
Write-Host "       상세페이지 AI 생성기  시작 중..."
Write-Host "  ======================================================"
Write-Host ""

# 포트 정리
foreach ($port in @(8081, 4000, 5050)) {
    $pids = (netstat -ano | Select-String ":$port " | Where-Object { $_ -match "LISTENING" }) | ForEach-Object {
        ($_ -split '\s+')[-1]
    }
    foreach ($p in $pids) {
        if ($p -match '^\d+$') {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
    }
}
Start-Sleep -Seconds 1

# [1/3] API 서버
Write-Host "  [1/3] API 서버 시작..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/k cd /d C:\Users\kua\Documents\Playground\sachyosangse\apps\api && pnpm dev" -WindowStyle Minimized

# [2/3] 백엔드 서버
Write-Host "  [2/3] 백엔드 서버 시작..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/k set SSL_CERT_FILE=C:\Users\kua\Documents\GitHub\kuasangse\backend\venv311\Lib\site-packages\certifi\cacert.pem && cd /d C:\Users\kua\Documents\GitHub\kuasangse\backend && venv311\Scripts\waitress-serve.exe --call --listen=127.0.0.1:5050 app:create_app" -WindowStyle Minimized

# [3/3] 프론트엔드 서버 (Python http.server)
Write-Host "  [3/3] 프론트엔드 서버 시작..."
Start-Process -FilePath "C:\Python314\python.exe" -ArgumentList "-m", "http.server", "8081", "--directory", "C:\Users\kua\Documents\GitHub\kuasangse" -WindowStyle Minimized

Write-Host ""
Write-Host "  서버 준비 중... (13초 대기)"
Start-Sleep -Seconds 13

Write-Host "  브라우저 실행 중..."
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList "--new-window", "--disk-cache-size=1", "--disable-application-cache", "http://127.0.0.1:8081/app.html"