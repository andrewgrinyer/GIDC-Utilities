@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-access-door-lookups.ps1" > "%~dp0access-door-lookups-result.txt" 2>&1
type "%~dp0access-door-lookups-result.txt"
echo.
echo Nothing in Access was changed. Saved as access-door-lookups-result.txt in this folder.
pause
