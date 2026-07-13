@echo off
setlocal
title Cocos Playable Packer - Start Web MVP

where node.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node.js 22 and reopen this launcher.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\web-mvp-launcher.mjs" start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo The launcher window can now be closed. The Web MVP service continues in the background.
)
echo Press any key to close this window.
pause >nul
exit /b %EXIT_CODE%
