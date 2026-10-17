@echo off
cd /d "%~dp0"
rem First run (or after a fresh clone): install Electron and the other dependencies.
if not exist "node_modules\electron\dist\electron.exe" (
  echo Setting up Cloak for the first time. This takes a minute...
  call npm install
  if errorlevel 1 (
    echo.
    echo Setup failed. Make sure Node.js is installed: https://nodejs.org
    pause
    exit /b 1
  )
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
