@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-web-leads-sync.ps1" -WhatIf > "%~dp0web-leads-try-result.txt" 2>&1
type "%~dp0web-leads-try-result.txt"
echo.
echo Nothing was sent. Saved as web-leads-try-result.txt in this folder.
pause
