@echo off
title Awana Print
echo Starting Awana Print Server...

set "INSTALL_DIR=%APPDATA%\Awana-Print"
set "PROJECT_DIR=%INSTALL_DIR%\Print-TwoTimTwo-Labels"
set "SERVER_DIR=%PROJECT_DIR%\print-server"
set "CONFIG_HELPER=%INSTALL_DIR%\read-config.js"

:: Check node is available
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not on PATH.
    echo Please run install.bat first.
    pause
    exit /b 1
)

:: Check project exists
if not exist "%SERVER_DIR%\server.js" (
    echo ERROR: Print server not found at %SERVER_DIR%
    echo Please run install.bat first.
    pause
    exit /b 1
)

:: Read config via Node helper
set "PRINTER_NAME="
set "CHECKIN_URL="
if exist "%CONFIG_HELPER%" (
    for /f "tokens=1,* delims==" %%a in ('node "%CONFIG_HELPER%"') do (
        set "%%a=%%b"
    )
)

:: Fallback check-in URL
if "%CHECKIN_URL%"=="" set "CHECKIN_URL=https://kvbchurch.twotimtwo.com/clubber/checkin?#"

:: Kill any stale node server on port 3456
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%p /F >nul 2>nul
)

:: Start print server in minimized window
set "PRINTER_NAME=%PRINTER_NAME%"
start "Awana Print Server" /min cmd /c "cd /d "%SERVER_DIR%" && node server.js"

:: Wait for server to start
echo Waiting for server...
timeout /t 2 /nobreak >nul

:: Open Edge to check-in page and bookmarklet page
echo Opening check-in page in Edge...
start msedge "%CHECKIN_URL%"
start msedge "http://localhost:3456/bookmarklet.html"

echo.
echo Awana Print is running. You can close this window.
timeout /t 3 /nobreak >nul
