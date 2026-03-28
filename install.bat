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

:: --- 3. Run Installer ---
:: Check if install-and-run.ps1 exists locally
if exist "%~dp0install-and-run.ps1" (
    cls
echo ============================================================
echo   Awana Label Print Server -- Installer
echo ============================================================
echo.
echo   [#] Found local setup script. Running...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-and-run.ps1"
    goto :done
)

:: Download the PS1 from GitHub and run it
cls
echo ============================================================
echo   Awana Label Print Server -- Installer
echo ============================================================
echo.
echo   [#] Downloading latest installer from GitHub...
set "PS1_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1"
set "PS1_PATH=%TEMP%\awana-install-and-run.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%PS1_PATH%' -ErrorAction Stop; Write-Host '  [OK] Downloaded.' -ForegroundColor Green } catch { Write-Host '  [FAIL] Download failed: ' $_.Exception.Message -ForegroundColor Red; exit 1 }"

if errorlevel 1 (
    echo.
    echo   [ERROR] Could not download the installer. 
    echo   Please check your internet connection and try again.
    echo.
    pause
    exit /b 1
)

echo.
cls
echo ============================================================
echo   Awana Label Print Server -- Installer
echo ============================================================
echo.
echo   [#] Starting installation...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_PATH%"

:done
echo.
echo ============================================================
echo   Installation sequence finished.
echo ============================================================
echo.
pause
