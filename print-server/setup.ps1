# Awana Label Print Server
# Double-click this to start the server and open the check-in page.
# On first run it will ask for your printer and check-in URL.
# After that it starts automatically in 5 seconds — just leave it running.

$ErrorActionPreference = "Stop"
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir  = Join-Path $scriptDir "print-server"
$configPath = Join-Path $serverDir "config.json"

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Awana Label Print Server" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Check Node.js ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Opening nodejs.org..." -ForegroundColor Yellow
    Start-Process "https://nodejs.org"
    Read-Host "Install Node.js LTS then re-run this script. Press Enter to exit"
    exit 1
}
Write-Host "Node.js $(node --version) found." -ForegroundColor Green

# --- 2. Install packages (first time only) ---
if (-not (Test-Path (Join-Path $serverDir "node_modules"))) {
    Write-Host ""
    Write-Host "Installing packages (first time only, ~300 MB — please wait)..." -ForegroundColor Yellow
    Push-Location $serverDir
    npm install
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) {
        Read-Host "npm install failed. Press Enter to exit"
        exit 1
    }
    Write-Host "Packages installed." -ForegroundColor Green
}

# --- 3. Load saved config ---
$cfg = [ordered]@{ printerName = ""; checkinUrl = "" }
if (Test-Path $configPath) {
    try {
        $saved = Get-Content $configPath -Raw | ConvertFrom-Json
        $cfg.printerName = $saved.printerName
        $cfg.checkinUrl  = $saved.checkinUrl
    } catch {
        Write-Host "Could not read config.json — will reconfigure." -ForegroundColor Yellow
    }
}

# --- Configure function (printer + URL selection) ---
function Configure {
    Write-Host ""

    # Printer
    $printers = @(Get-Printer | Select-Object -ExpandProperty Name)
    if ($printers.Count -eq 0) {
        Write-Host "No printers found. Make sure your label printer is connected." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Available printers:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $printers.Count; $i++) {
        $marker = if ($printers[$i] -eq $cfg.printerName) { "  <-- current" } else { "" }
        Write-Host "  [$i] $($printers[$i])$marker"
    }
    $choice = Read-Host "`nEnter printer number (or press Enter to keep current)"
    if ($choice -match '^\d+$') {
        $idx = [int]$choice
        if ($idx -ge 0 -and $idx -lt $printers.Count) {
            $cfg.printerName = $printers[$idx]
        }
    }

    # URL
    Write-Host ""
    $currentUrl = if ($cfg.checkinUrl) { $cfg.checkinUrl } else { "https://kvbchurch.twotimtwo.com/clubber/checkin?#" }
    $newUrl = Read-Host "Check-in URL (press Enter to keep: $currentUrl)"
    if ($newUrl.Trim()) { $cfg.checkinUrl = $newUrl.Trim() } else { $cfg.checkinUrl = $currentUrl }

    # Save
    [PSCustomObject]@{ printerName = $cfg.printerName; checkinUrl = $cfg.checkinUrl } |
        ConvertTo-Json | Set-Content $configPath
    Write-Host ""
    Write-Host "Settings saved." -ForegroundColor Green
}

# --- 4. First run or subsequent run ---
if (-not $cfg.printerName -or -not $cfg.checkinUrl) {
    Write-Host "First-time setup — let's pick your printer and check-in URL." -ForegroundColor Cyan
    Configure
} else {
    Write-Host "  Printer : $($cfg.printerName)" -ForegroundColor White
    Write-Host "  URL     : $($cfg.checkinUrl)" -ForegroundColor White
    Write-Host ""
    Write-Host "Starting in 5 seconds...  Press any key to change settings." -ForegroundColor Gray

    $changed = $false
    for ($i = 5; $i -gt 0; $i--) {
        Write-Host -NoNewline "`r  $i...   "
        Start-Sleep -Milliseconds 950
        if ([Console]::KeyAvailable) {
            $null = [Console]::ReadKey($true)
            $changed = $true
            break
        }
    }
    Write-Host ""
    if ($changed) { Configure }
}

# --- 5. Open Edge at the check-in page ---
Write-Host ""
Write-Host "Opening Microsoft Edge at check-in page..." -ForegroundColor Cyan
Start-Process "msedge" -ArgumentList $cfg.checkinUrl

# --- 6. Start the print server ---
Write-Host "Print server running at http://localhost:3456" -ForegroundColor Cyan
Write-Host "Leave this window open during check-in. Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""
$env:PRINTER_NAME = $cfg.printerName
Set-Location $serverDir
node server.js
