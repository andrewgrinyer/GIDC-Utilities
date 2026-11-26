@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-schedule-web-leads-sync.ps1"
echo.
pause
