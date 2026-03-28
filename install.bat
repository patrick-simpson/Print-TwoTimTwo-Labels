@echo off
title Awana Print -- Installer
echo ============================================
echo   Awana Label Print Server -- Installer
echo ============================================
echo.

:: Check if install-and-run.ps1 exists locally (user cloned the repo or has it nearby)
if exist "%~dp0install-and-run.ps1" (
    echo Found local install script. Running...
    echo.
    powershell -ExecutionPolicy Bypass -File "%~dp0install-and-run.ps1"
    goto :done
)

:: Download the PS1 from GitHub and run it
echo Downloading installer from GitHub...
echo.
set "PS1_URL=https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1"
set "PS1_PATH=%TEMP%\awana-install-and-run.ps1"

powershell -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%PS1_PATH%' -ErrorAction Stop; Write-Host '[OK] Downloaded.' -ForegroundColor Green } catch { Write-Host '[FAIL] Download failed:' $_.Exception.Message -ForegroundColor Red; exit 1 }"

if errorlevel 1 (
    echo.
    echo Could not download the installer. Check your internet connection.
    echo You can also download manually from:
    echo   https://github.com/patrick-simpson/Print-TwoTimTwo-Labels
    echo.
    pause
    exit /b 1
)

echo.
echo Running installer...
echo.
powershell -ExecutionPolicy Bypass -File "%PS1_PATH%"

:done
echo.
pause
