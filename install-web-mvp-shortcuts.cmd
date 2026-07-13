@echo off
setlocal
title Cocos Playable Packer - Install Shortcuts

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-web-mvp-shortcuts.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Press any key to close this window.
pause >nul
exit /b %EXIT_CODE%
