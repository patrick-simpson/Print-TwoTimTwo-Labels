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

set "INSTALL_DIR=C:\output"
set "PROJECT_DIR=%INSTALL_DIR%\Print-TwoTimTwo-Labels"
set "SERVER_DIR=%PROJECT_DIR%\print-server"
set "CONFIG_HELPER=%INSTALL_DIR%\read-config.js"
set "VERSION_FILE=%PROJECT_DIR%\VERSION"

:: --- 0. Migrate from old %APPDATA%\Awana-Print location ---
set "OLD_DIR=%APPDATA%\Awana-Print"
if exist "%OLD_DIR%\Print-TwoTimTwo-Labels\print-server\server.js" (
    echo   [#] Migrating from old install location...
    echo       %OLD_DIR% -^> %INSTALL_DIR%

    :: Ensure new install dir exists
    if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

    :: Migrate user data (config + roster) if not already present at new location
    if exist "%OLD_DIR%\Print-TwoTimTwo-Labels\print-server\config.json" (
        if not exist "%SERVER_DIR%\config.json" (
            copy "%OLD_DIR%\Print-TwoTimTwo-Labels\print-server\config.json" "%SERVER_DIR%\config.json" >nul 2>nul
            echo       Migrated config.json
        )
    )
    if exist "%OLD_DIR%\Print-TwoTimTwo-Labels\print-server\clubbers.csv" (
        if not exist "%SERVER_DIR%\clubbers.csv" (
            copy "%OLD_DIR%\Print-TwoTimTwo-Labels\print-server\clubbers.csv" "%SERVER_DIR%\clubbers.csv" >nul 2>nul
            echo       Migrated clubbers.csv
        )
    )

    :: Kill any node processes that might lock old files
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3456 " ^| findstr "LISTENING" 2^>nul') do (
        taskkill /PID %%p /F >nul 2>nul
    )
    timeout /t 1 /nobreak >nul

    :: Remove old installation
    rmdir /s /q "%OLD_DIR%" >nul 2>nul
    if not exist "%OLD_DIR%" (
        echo   [OK] Old installation removed.
    ) else (
        echo   [!] Could not fully remove old folder. You can delete it manually:
        echo       %OLD_DIR%
    )
    echo.
)

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

echo   [#] Opening check-in page in Edge...
start "" "%CHECKIN_URL%"

echo.
echo   [ OK ] Awana Print is starting.
echo   ------------------------------------------------------------
echo.
echo   Keep this window open during check-in.
echo.

:: --- Self-healing server restart loop ---
:: Per Zero-Loop Policy: max 5 restarts to prevent infinite loops.
set "RESTART_COUNT=0"
set "MAX_RESTARTS=5"

:server_loop
if %RESTART_COUNT% GEQ %MAX_RESTARTS% (
    echo.
    echo   [!] Server crashed %MAX_RESTARTS% times. Please check for errors.
    echo   [!] Try restarting this script, or ask your tech person for help.
    pause
    exit /b 1
)

cd /d "%SERVER_DIR%"
node server.js

set /a RESTART_COUNT+=1
echo.
echo   [!] Server exited. Restarting in 3 seconds (%RESTART_COUNT%/%MAX_RESTARTS%)...
timeout /t 3 /nobreak >nul
goto :server_loop