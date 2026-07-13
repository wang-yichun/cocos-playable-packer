@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node.js 22 and reopen this window.
  pause
  exit /b 1
)

echo Previewing generated files...
node ".\scripts\clean-generated.mjs"
if errorlevel 1 (
  echo.
  echo Cleanup preview failed.
  pause
  exit /b 1
)

echo.
choice /C YN /N /M "Delete the listed generated files? [Y/N]: "
if errorlevel 2 (
  echo Cancelled. No files were deleted.
  pause
  exit /b 0
)

node ".\scripts\clean-generated.mjs" --apply
if errorlevel 1 (
  echo.
  echo Cleanup failed.
  pause
  exit /b 1
)

echo.
echo Cleanup completed successfully.
pause
