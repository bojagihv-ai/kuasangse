@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 상세페이지 매일 회귀테스트를 시작합니다.
node tools\run_daily_regression.cjs --profile daily
echo.
echo 결과: test-results\daily-regression\latest.md
pause
