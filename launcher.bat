@echo off
chcp 65001 >nul

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║     상세페이지 AI 생성기  시작 중...         ║
echo  ╚══════════════════════════════════════════════╝
echo.

:: 포트 정리
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8081 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5050 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1

timeout /t 1 /nobreak >nul

echo  [1/3] API 서버 시작...
powershell -Command "Start-Process cmd.exe -ArgumentList '/k cd /d C:\Users\kua\Documents\Playground\sachyosangse\apps\api && pnpm dev' -WindowStyle Minimized"

echo  [2/3] 백엔드 서버 시작...
powershell -Command "Start-Process cmd.exe -ArgumentList '/k set SSL_CERT_FILE=C:\Users\kua\Documents\GitHub\kuasangse\backend\venv311\Lib\site-packages\certifi\cacert.pem && cd /d C:\Users\kua\Documents\GitHub\kuasangse\backend && venv311\Scripts\waitress-serve.exe --call --listen=127.0.0.1:5050 app:create_app' -WindowStyle Minimized"

echo  [3/3] 프론트엔드 서버 시작...
wscript "C:\Users\kua\Documents\GitHub\kuasangse\start_http.vbs"

echo.
echo  서버 준비 중... (13초 대기)
timeout /t 13 /nobreak >nul

echo  브라우저 실행 중...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --new-window --disk-cache-size=1 --disable-application-cache "http://127.0.0.1:8081/app.html"

exit
