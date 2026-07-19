@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo  ======================================================
echo       Detail Page AI - starting...
echo  ======================================================
echo.

if not exist "%~dp0backend\.local\drive-token.json" (
    echo  [Drive] token missing - Google login once...
    echo.
    pushd "%~dp0backend"
    call venv311\Scripts\pip install google-auth-oauthlib -q --no-warn-script-location
    venv311\Scripts\python.exe setup_drive_auth.py
    popd
    echo.
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo  Launcher failed with code %ERR%
  pause
)
exit /b %ERR%