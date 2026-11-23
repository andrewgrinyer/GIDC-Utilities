@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-measurement-sync.ps1" -WhatIf > "%~dp0measurement-sync-try-result.txt" 2>&1
type "%~dp0measurement-sync-try-result.txt"
echo.
echo Nothing was sent. Saved as measurement-sync-try-result.txt in this folder.
pause
