@echo off
setlocal
cd /d "%~dp0"

docker compose down
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Stop failed with exit code %EXIT_CODE%.
  echo Press any key to close this window.
  pause >nul
)

endlocal
