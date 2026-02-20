@echo off
echo ============================================
echo   상세페이지 자동 생성기 - 프론트엔드 시작
echo ============================================
cd /d "%~dp0frontend"
if not exist "node_modules" (
    echo [1/2] 패키지 설치 중...
    npm install
)
echo [2/2] 개발 서버 시작!
npm start
pause
