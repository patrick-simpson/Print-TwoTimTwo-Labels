@echo off
REM Awana Print Server launcher.
REM
REM Double-click this file to start the print server. On first run it will
REM install dependencies (requires Node.js 18+ installed from nodejs.org).
REM Config lives in config.json next to this file.

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed or not on PATH.
  echo   Download the LTS version from https://nodejs.org/ and re-run this file.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   First run: installing dependencies...
  echo.
  call npm install --omit=dev
  if errorlevel 1 (
    echo   Dependency install failed. Check your internet connection.
    pause
    exit /b 1
  )
)

node server.js
pause
