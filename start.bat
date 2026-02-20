@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   상세페이지 자동 생성기 - 로컬 서버 시작    ║
echo  ╚══════════════════════════════════════════════╝
echo.
echo  브라우저에서 접속하세요:
echo  → http://localhost:8080
echo.
echo  종료하려면 이 창에서 Ctrl+C 를 누르세요
echo  ─────────────────────────────────────────────
echo.
cd /d "%~dp0"
python -m http.server 8080
pause
