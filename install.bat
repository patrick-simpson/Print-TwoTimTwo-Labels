@echo off
setlocal enabledelayedexpansion
title Awana Print -- Installer

:: --- 1. Admin Check & Relaunch ---
:: Circuit Breaker: If we were already relaunched, skip the check to prevent infinite loops.
if "%1"=="--admin-relaunch" goto :pretty_header

:: Robust check using PowerShell's .NET identity check
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 1 }"
if %errorLevel% equ 0 goto :pretty_header

echo ============================================================
echo   [!] NOT RUNNING AS ADMINISTRATOR
echo ============================================================
echo.
echo   This installer needs Administrative rights to:
echo     1. Install Node.js (if missing)
echo     2. Configure PowerShell
echo     3. Setup Desktop Shortcuts
echo.
echo   Relaunching with elevation in 3 seconds...
timeout /t 3 /nobreak >nul

:: Relaunch with the circuit breaker flag
powershell -Command "Start-Process '%~f0' -ArgumentList '--admin-relaunch' -Verb RunAs"
exit /b

:pretty_header
:: --- 2. Pretty Header ---
cls
echo ============================================================
echo   Awana Label Print Server -- Installer
echo ============================================================
echo.
echo   Welcome! This script will prepare your computer for
echo   silent label printing from TwoTimTwo.com.
echo.

:: --- 3. Version Check ---
echo   [#] Checking for updates...
set "PS1_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1"
set "VERSION_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION"
set "LOCAL_PS1=%~dp0install-and-run.ps1"

:: Get remote version
for /f "usebackq" %%v in (powershell -NoProfile -ExecutionPolicy Bypass -Command "(Invoke-WebRequest -Uri '%VERSION_URL%' -UseBasicParsing -ErrorAction SilentlyContinue).Content.Trim()") do set "REMOTE_VERSION=%%v"

if "%REMOTE_VERSION%"=="" (
    echo   [!] Could not check remote version. Continuing with local script if available.
) else (
    echo   [+] Latest version: %REMOTE_VERSION%
)

:: Get local version from install-and-run.ps1 if it exists
set "LOCAL_VERSION=0.0.0"
if exist "%LOCAL_PS1%" (
    for /f "tokens=3" %%a in ('findstr /C:"# Version    :" "%LOCAL_PS1%"') do set "LOCAL_VERSION=%%a"
    echo   [+] Local version:  !LOCAL_VERSION!
)

:: Compare versions
if "%REMOTE_VERSION%"=="" goto :run_local
if "!LOCAL_VERSION!"=="%REMOTE_VERSION%" (
    echo   [OK] You have the latest version.
    goto :run_local
)

echo.
echo   [*] A newer version is available (%REMOTE_VERSION%).
echo   [*] Downloading update...

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Continue = 'SilentlyContinue'; Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%LOCAL_PS1%' -ErrorAction Stop; Write-Host '  [OK] Update downloaded.' -ForegroundColor Green } catch { Write-Host '  [FAIL] Update failed: ' .Exception.Message -ForegroundColor Red; exit 1 }"

if errorlevel 1 (
    echo   [!] Update failed. Attempting to continue with local script...
)

:run_local
:: --- 4. Run Installer ---
if exist "%LOCAL_PS1%" (
    echo.
    echo   [#] Starting installation...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCAL_PS1%"
    goto :done
)

:: If we got here, we don't have a local script and download failed
cls
echo ============================================================
echo   Awana Label Print Server -- Installer
echo ============================================================
echo.
echo   [ERROR] Setup script not found and could not be downloaded.
echo   Please check your internet connection and try again.
echo.
pause
exit /b 1

:done
echo.
echo ============================================================
echo   Installation sequence finished.
echo ============================================================
echo.
pause
