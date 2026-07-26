@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\package-creator-extension.ps1"
if errorlevel 1 (
  echo.
  echo Packaging failed. See the error above.
  pause
  exit /b 1
)

echo.
echo Packaging completed successfully. The ZIP is in the release folder.
pause
