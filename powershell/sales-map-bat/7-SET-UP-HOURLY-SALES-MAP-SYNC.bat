@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-schedule-sales-map-sync.ps1"
echo.
pause
