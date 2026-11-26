@echo off
cd /d "%~dp0"
echo The first time, this looks up every address at one a second.
echo It can take an hour or two. Leave this window open until it says ok.
echo If it is closed early, nothing is lost: the next run carries on.
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0gidc-sales-map-sync.ps1" -MaxMinutes 240
echo.
pause
