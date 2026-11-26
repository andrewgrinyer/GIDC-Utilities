@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-sales-map-sync.ps1" -WhatIf > "%~dp0sales-map-try-result.txt" 2>&1
type "%~dp0sales-map-try-result.txt"
echo.
echo Nothing was sent. Saved as sales-map-try-result.txt in this folder.
pause
