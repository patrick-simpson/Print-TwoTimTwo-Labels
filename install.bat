@echo off
setlocal enabledelayedexpansion
title Awana Print -- Installer

:: --- 1. Admin Check ---
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ============================================================
    echo   [!] NOT RUNNING AS ADMINISTRATOR
    echo ============================================================
    echo.
    echo   This installer needs Administrative rights to:
    echo     1. Install Node.js (if missing)
    echo     2. Configure PowerShell
    echo     3. Setup Desktop Shortcuts
    echo.
    echo   Relaunching with elevation...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

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
    echo   [#] Found local setup script. Running...
    echo.
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-and-run.ps1"
    goto :done
)

:: Download the PS1 from GitHub and run it
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
