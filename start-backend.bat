@echo off
echo ============================================
echo   상세페이지 자동 생성기 - 백엔드 서버 시작
echo ============================================
cd /d "%~dp0backend"
if not exist "venv" (
    echo [1/3] Python 가상환경 생성 중...
    python -m venv venv
)
echo [2/3] 패키지 설치 중...
call venv\Scripts\activate.bat
pip install -r requirements.txt -q
echo [3/3] 서버 시작!
python app.py
pause
