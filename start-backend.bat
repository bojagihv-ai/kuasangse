@echo off
echo ============================================
echo   Product Detail Generator - Backend Start
echo ============================================
cd /d "%~dp0backend"

set "VENV_DIR=venv311"
py -3.11 --version >nul 2>&1
if %errorlevel%==0 (
    set "PYTHON_CMD=py -3.11"
) else (
    set "PYTHON_CMD=python"
)

if not exist "%VENV_DIR%\Scripts\python.exe" (
    echo [1/3] Creating Python virtual environment...
    %PYTHON_CMD% -m venv %VENV_DIR%
)

echo [2/3] Installing packages...
call %VENV_DIR%\Scripts\activate.bat
python -m pip install -r requirements.txt -q

echo [3/3] Starting backend server...
echo Backend URL: http://127.0.0.1:5050

:: SSL 인증서 경로 설정 (certifi 사용)
for /f "delims=" %%i in ('python -c "import certifi; print(certifi.where())"') do set SSL_CERT_FILE=%%i
echo SSL_CERT_FILE=%SSL_CERT_FILE%

waitress-serve --call --listen=127.0.0.1:5050 app:create_app
pause
