@echo off
setlocal
cd /d "%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0test.queue.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo Queue test passed.
) else if "%EXIT_CODE%"=="1" (
  echo Queue test failed due to request errors.
) else (
  echo Queue test finished with inconclusive result code %EXIT_CODE%.
)

echo Press any key to close this window.
pause >nul
endlocal
