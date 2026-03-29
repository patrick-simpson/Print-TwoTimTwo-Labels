# Awana Label Print Server -- Bootstrap Installer
# Usage: irm https://patrick-simpson.github.io/Print-TwoTimTwo-Labels/install.ps1 | iex
#
# Downloads and runs the full installer, targeting c:\output as the install directory.

$ErrorActionPreference = "Stop"
$InstallDir = "c:\output"

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  Awana Label Print Server -- Bootstrap Installer" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host ""

# Create install directory if it doesn't exist
if (-not (Test-Path $InstallDir)) {
    Write-Host "Creating install directory: $InstallDir" -ForegroundColor Gray
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Download the full installer script
$installerUrl = "https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/install-and-run.ps1"
$installerPath = Join-Path $InstallDir "install-and-run.ps1"

Write-Host "Downloading installer..." -ForegroundColor Gray
try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
    Write-Host "[OK] Installer downloaded." -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Could not download installer: $_" -ForegroundColor Red
    Write-Host "  Check your internet connection and try again." -ForegroundColor Yellow
    exit 1
}

# Run the full installer with c:\output as the install path
Write-Host "Launching installer..." -ForegroundColor Gray
Write-Host ""
& $installerPath -InstallPath $InstallDir
