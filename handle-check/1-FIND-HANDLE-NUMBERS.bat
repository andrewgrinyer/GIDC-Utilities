@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-find-handle-numbers.ps1" > "%~dp0handle-numbers-result.txt" 2>&1
type "%~dp0handle-numbers-result.txt"
echo.
echo Nothing in Access was changed. Saved as handle-numbers-result.txt in this folder.
pause
