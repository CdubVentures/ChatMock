@echo off
setlocal
cd /d "%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0LLM-Eval-Lab-Launcher.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Launcher exited with code %EXIT_CODE%.
  echo Press any key to close this window.
  pause >nul
)

endlocal
