@echo off
rem GIDC handle check. Read only: it never changes a workbook.
rem Double click, pick the folder, and it checks every workbook in it and its subfolders.
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python is not installed on this PC.
  echo Get it from https://www.python.org/downloads/ and tick "Add python.exe to PATH", then run this again.
  pause
  exit /b 1
)
py -c "import openpyxl" 2>nul || py -m pip install --user openpyxl
py "%~dp0check_handles.py" %1
