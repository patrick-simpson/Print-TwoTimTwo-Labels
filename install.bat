@echo off
setlocal enabledelayedexpansion
title Awana Print -- Installer

:: --- 1. Admin Check & Relaunch ---
if "%1"=="--admin-relaunch" goto :pretty_header

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }"
if %errorLevel% equ 0 goto :pretty_header

cls
echo.
echo   [!] ADMINISTRATIVE RIGHTS REQUIRED
echo   ------------------------------------------------------------
echo.
echo   This installer needs permission to:
echo     - Install Node.js
echo     - Configure PowerShell
echo     - Create Desktop Shortcuts
echo.
echo   Relaunching with elevation in 3 seconds...
timeout /t 3 /nobreak >nul

powershell -Command "Start-Process '%~f0' -ArgumentList '--admin-relaunch' -Verb RunAs"
exit /b

:pretty_header
cls
echo.
echo   [ Awana Print ] - Installer v1.8.0
echo   ------------------------------------------------------------
echo.
echo   Welcome! This script will prepare your computer for
echo   silent label printing from TwoTimTwo.com.
echo.

:: --- 3. Version Check ---
echo   [#] Checking for updates...
set "PS1_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1"
set "VERSION_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION"
set "LOCAL_PS1=%~dp0install-and-run.ps1"

for /f "usebackq" %%v in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Invoke-WebRequest -Uri '%VERSION_URL%' -UseBasicParsing -ErrorAction SilentlyContinue).Content.Trim()"` ) do set "REMOTE_VERSION=%%v"

if "%REMOTE_VERSION%"=="" (
    echo   [!] Offline: Using local installer if available.
) else (
    echo   [+] Latest version: %REMOTE_VERSION%
)

set "LOCAL_VERSION=0.0.0"
if exist "%LOCAL_PS1%" (
    for /f "tokens=3" %%a in ('findstr /C:"# Version    :" "%LOCAL_PS1%"') do (
        set "LOCAL_VERSION=%%a"
    )
    echo   [+] Local version:  !LOCAL_VERSION!
)

if "%REMOTE_VERSION%"=="" goto :run_local
if "!LOCAL_VERSION!"=="%REMOTE_VERSION%" (
    echo   [OK] Everything is up to date.
    goto :run_local
)

echo.
echo   [*] A newer version is available.
echo   [*] Downloading update...

powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; `$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%LOCAL_PS1%' -UseBasicParsing -ErrorAction Stop"

if %errorLevel% equ 0 (
    echo   [OK] Download complete.
) else (
    echo.
    echo   [!] Update failed. Attempting to continue with local version...
)

:run_local
if exist "%LOCAL_PS1%" (
    echo.
    echo   [#] Starting installation engine...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_PS1%"
    goto :done
)

cls
echo.
echo   [ ERROR ]
echo   ------------------------------------------------------------
echo.
echo   The setup script could not be found or downloaded.
echo   Please check your internet connection and try again.
echo.
pause
exit /b 1

:done
echo.
echo   ------------------------------------------------------------
echo   Installation finished.
echo   ------------------------------------------------------------
echo.
pause