@echo off
echo ============================================
echo   상세페이지 자동 생성기 - 전체 시작
echo ============================================
echo.
echo 백엔드 서버를 시작합니다...
start "Backend Server" cmd /k "cd /d "%~dp0" && start-backend.bat"
echo.
echo 3초 후 프론트엔드를 시작합니다...
timeout /t 3 /nobreak > nul
start "Frontend Dev" cmd /k "cd /d "%~dp0" && start-frontend.bat"
echo.
echo ============================================
echo   백엔드: http://localhost:5000
echo   프론트엔드: http://localhost:3000
echo ============================================
pause
