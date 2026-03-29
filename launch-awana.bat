@echo off
setlocal enabledelayedexpansion
title Awana Print
cls

echo.
echo   [ Awana Print ]
echo   ------------------------------------------------------------
echo.
echo   Starting server and connecting to TwoTimTwo...
echo.

:: Derive install dir from this script's own location (it lives in the install dir)
set "INSTALL_DIR=%~dp0"
:: Remove trailing backslash
if "%INSTALL_DIR:~-1%"=="\" set "INSTALL_DIR=%INSTALL_DIR:~0,-1%"
set "PROJECT_DIR=%INSTALL_DIR%\Print-TwoTimTwo-Labels"
set "SERVER_DIR=%PROJECT_DIR%\print-server"
set "CONFIG_HELPER=%INSTALL_DIR%\read-config.js"
set "VERSION_FILE=%PROJECT_DIR%\VERSION"

:: --- 1. Admin Check & Relaunch ---
if "%1"=="--admin-relaunch" goto :check_for_updates

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }"
if %errorLevel% equ 0 goto :check_for_updates

echo.
echo   [!] ADMINISTRATIVE RIGHTS NEEDED
echo   ------------------------------------------------------------
echo.
echo   Relaunching with elevation in 2 seconds...
timeout /t 2 /nobreak >nul

powershell -Command "Start-Process '%~f0' -ArgumentList '--admin-relaunch' -Verb RunAs"
exit /b

:check_for_updates
:: --- 2. Update Check ---
echo   [#] Checking for updates...
set "VERSION_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION"
set "INSTALL_BAT_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install.bat"
set "TEMP_VERSION=%TEMP%\awana_version.txt"

powershell -NoProfile -ExecutionPolicy Bypass -Command "(Invoke-WebRequest -Uri '%VERSION_URL%' -UseBasicParsing -ErrorAction SilentlyContinue).Content.Trim()" > "%TEMP_VERSION%" 2>nul
set /p REMOTE_VERSION=<"%TEMP_VERSION%"
del "%TEMP_VERSION%" 2>nul

if "%REMOTE_VERSION%"=="" (
    echo   [!] Offline: Continuing with local version.
    goto :start_server
)

if exist "%VERSION_FILE%" (
    set /p LOCAL_VERSION=<"%VERSION_FILE%"
) else (
    set "LOCAL_VERSION=0.0.0"
)

if "%LOCAL_VERSION%"=="%REMOTE_VERSION%" (
    echo   [OK] Latest version is installed.
    goto :start_server
)

echo.
echo   [*] A newer version is available (%REMOTE_VERSION%).
echo   [*] Downloading and running installer...
echo.

set "PS1_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1"
set "TEMP_PS1=%INSTALL_DIR%\install-and-run.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%TEMP_PS1%' -UseBasicParsing -ErrorAction SilentlyContinue"

if exist "%TEMP_PS1%" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS1%" -InstallPath "%INSTALL_DIR%"
    exit /b
) else (
    echo   [!] Failed to download installer. Continuing...
)

:start_server
:: --- 3. Start Server Logic ---
echo   [#] Starting Awana Print Server...

where node >nul 2>nul
if errorlevel 1 (
    echo   [!] ERROR: Node.js is missing. Please run install.bat.
    pause
    exit /b 1
)

if not exist "%SERVER_DIR%\server.js" (
    echo   [!] ERROR: Server files not found. Please run install.bat.
    pause
    exit /b 1
)

set "PRINTER_NAME="
set "CHECKIN_URL="
if exist "%CONFIG_HELPER%" (
    for /f "tokens=1,* delims==" %%a in ('node "%CONFIG_HELPER%"') do (
        set "%%a=%%b"
    )
)

if "%CHECKIN_URL%"=="" set "CHECKIN_URL=https://kvbchurch.twotimtwo.com/clubber/checkin?#"

:: Kill any stale node server on port 3456
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%p /F >nul 2>nul
)

start "Awana Print Server" /min cmd /c "cd /d "%SERVER_DIR%" && node server.js"

echo   [#] Waiting for server...
timeout /t 2 /nobreak >nul

echo   [#] Opening check-in page in Edge...
start "" "%CHECKIN_URL%"

echo.
echo   [ OK ] Awana Print is running.
echo   ------------------------------------------------------------
echo.
echo   Keep this window open during check-in.
timeout /t 3 /nobreak >nul