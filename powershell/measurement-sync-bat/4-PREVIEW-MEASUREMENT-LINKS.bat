@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-measurement-sync.ps1" -Preview > "%~dp0measurement-sync-preview-result.txt" 2>&1
type "%~dp0measurement-sync-preview-result.txt"
echo.
echo No job was changed. Saved as measurement-sync-preview-result.txt in this folder.
pause
