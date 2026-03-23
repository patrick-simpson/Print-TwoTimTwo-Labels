# Awana Label Print Server — First-Time Setup
# Run this script once to install dependencies, pick your label printer, and start the server.

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $scriptDir "print-server"

Write-Host ""
Write-Host "=== Awana Print Server Setup ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Opening nodejs.org..." -ForegroundColor Yellow
    Start-Process "https://nodejs.org"
    Read-Host "Install the LTS version of Node.js, then re-run this script. Press Enter to exit"
    exit 1
}
Write-Host "Node.js $(node --version) found." -ForegroundColor Green

# 2. Install npm packages (first time only)
$modulesPath = Join-Path $serverDir "node_modules"
if (-not (Test-Path $modulesPath)) {
    Write-Host ""
    Write-Host "Installing packages (first time only, ~300 MB — please wait)..." -ForegroundColor Yellow
    Push-Location $serverDir
    npm install
    $exitCode = $LASTEXITCODE
    Pop-Location
    if ($exitCode -ne 0) {
        Read-Host "npm install failed. Press Enter to exit"
        exit 1
    }
    Write-Host "Packages installed." -ForegroundColor Green
}

# 3. Pick a printer
Write-Host ""
Write-Host "Available printers on this computer:" -ForegroundColor Cyan
$printers = @(Get-Printer | Select-Object -ExpandProperty Name)

if ($printers.Count -eq 0) {
    Write-Host "No printers found. Make sure your label printer is connected and installed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

for ($i = 0; $i -lt $printers.Count; $i++) {
    Write-Host "  [$i] $($printers[$i])"
}

Write-Host ""
$idx = [int](Read-Host "Enter the number of your label printer")
if ($idx -lt 0 -or $idx -ge $printers.Count) {
    Write-Host "Invalid selection." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
$selectedPrinter = $printers[$idx]
Write-Host "Selected: $selectedPrinter" -ForegroundColor Green

# 4. Start the server
Write-Host ""
Write-Host "Starting print server at http://localhost:3456" -ForegroundColor Cyan
Write-Host "Leave this window open during check-in. Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""
$env:PRINTER_NAME = $selectedPrinter
Set-Location $serverDir
node server.js
