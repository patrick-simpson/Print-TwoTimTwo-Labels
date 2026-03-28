@echo off
setlocal enabledelayedexpansion
title Awana Print
echo Starting Awana Print...

set "INSTALL_DIR=%APPDATA%\Awana-Print"
set "PROJECT_DIR=%INSTALL_DIR%\Print-TwoTimTwo-Labels"
set "SERVER_DIR=%PROJECT_DIR%\print-server"
set "CONFIG_HELPER=%INSTALL_DIR%\read-config.js"
set "VERSION_FILE=%PROJECT_DIR%\VERSION"

:: --- 1. Admin Check & Relaunch ---
:: Circuit Breaker: If we were already relaunched, skip the check to prevent infinite loops.
if "%1"=="--admin-relaunch" goto :check_for_updates

:: Robust check using PowerShell's .NET identity check
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }"
if %errorLevel% equ 0 goto :check_for_updates

echo.
echo   [!] NOT RUNNING AS ADMINISTRATOR
echo   Relaunching with elevation in 2 seconds...
timeout /t 2 /nobreak >nul

:: Relaunch with the circuit breaker flag
powershell -Command "Start-Process '%~f0' -ArgumentList '--admin-relaunch' -Verb RunAs"
exit /b

:check_for_updates
:: --- 2. Update Check ---
echo.
echo [#] Checking for updates...
set "VERSION_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION"
set "INSTALL_BAT_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install.bat"
set "TEMP_VERSION=%TEMP%\awana_version.txt"

:: Get remote version
powershell -NoProfile -ExecutionPolicy Bypass -Command "(Invoke-WebRequest -Uri '%VERSION_URL%' -UseBasicParsing -ErrorAction SilentlyContinue).Content.Trim()" > "%TEMP_VERSION%" 2>nul
set /p REMOTE_VERSION=<"%TEMP_VERSION%"
del "%TEMP_VERSION%" 2>nul

if "%REMOTE_VERSION%"=="" (
    echo [!] Could not check remote version. Continuing...
    goto :start_server
)

:: Get local version
if exist "%VERSION_FILE%" (
    set /p LOCAL_VERSION=<"%VERSION_FILE%"
) else (
    set "LOCAL_VERSION=0.0.0"
)

echo [+] Latest version: %REMOTE_VERSION%
echo [+] Local version:  %LOCAL_VERSION%

:: Compare versions
if "%LOCAL_VERSION%"=="%REMOTE_VERSION%" (
    echo [OK] You have the latest version.
    goto :start_server
)

echo.
echo [*] A newer version is available (%REMOTE_VERSION%).
echo [*] Downloading and running installer...
echo.

set "INSTALL_BAT=%TEMP%\awana_install.bat"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%INSTALL_BAT_URL%' -OutFile '%INSTALL_BAT%' -ErrorAction SilentlyContinue"

if exist "%INSTALL_BAT%" (
    :: Run the installer and then exit this script (it will be relaunched by the installer or the user)
    call "%INSTALL_BAT%"
    del "%INSTALL_BAT%" 2>nul
    exit /b
) else (
    echo [!] Failed to download installer. Continuing with local version...
)

:start_server
:: --- 3. Start Server Logic ---
echo Starting Awana Print Server...

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
start "" "%CHECKIN_URL%"

echo.
echo Awana Print is running. You can close this window.
timeout /t 3 /nobreak >nul
