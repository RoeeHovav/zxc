@echo off
rem Double-click to start PDF Narrator. The first start installs everything it needs.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\launch.ps1" %*
if errorlevel 1 (
  echo.
  echo PDF Narrator could not start. See the messages above.
  pause
)
