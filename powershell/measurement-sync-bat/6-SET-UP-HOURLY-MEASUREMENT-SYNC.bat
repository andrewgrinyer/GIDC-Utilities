@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-schedule-measurement-sync.ps1"
echo.
pause
