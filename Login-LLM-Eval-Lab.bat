@echo off
setlocal
cd /d "%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-LLM-Eval-Lab.ps1" -LoginOnly
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Login failed with exit code %EXIT_CODE%.
  echo Press any key to close this window.
  pause >nul
)

endlocal
