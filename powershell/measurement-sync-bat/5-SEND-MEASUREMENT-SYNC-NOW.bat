@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-measurement-sync.ps1" > "%~dp0measurement-sync-send-result.txt" 2>&1
type "%~dp0measurement-sync-send-result.txt"
echo.
echo Sent. Saved as measurement-sync-send-result.txt in this folder.
pause
