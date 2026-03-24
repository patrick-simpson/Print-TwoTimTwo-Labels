# Awana Label Print Server — All-in-One Installer
# This script:
#   1. Installs Node.js LTS if needed
#   2. Downloads the Print-TwoTimTwo-Labels project
#   3. Installs npm packages (~300 MB, first time only)
#   4. Asks for printer + check-in URL
#   5. Starts the server and opens Edge

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Awana Label Print Server" -ForegroundColor Cyan
Write-Host "  All-in-One Installer" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Check for Node.js and install if needed ---
Write-Host "Checking for Node.js..." -ForegroundColor Gray
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Host "✓ Node.js $nodeVersion found." -ForegroundColor Green
} else {
    Write-Host "Node.js not found. Installing Node.js LTS..." -ForegroundColor Yellow
    Write-Host ""

    # Download Node.js LTS installer
    $nodeUrl = "https://nodejs.org/dist/v20.10.0/node-v20.10.0-x64.msi"
    $tempDir = [System.IO.Path]::GetTempPath()
    $installerPath = Join-Path $tempDir "node-v20.10.0-x64.msi"

    Write-Host "Downloading Node.js from $nodeUrl..." -ForegroundColor Gray
    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $nodeUrl -OutFile $installerPath
        Write-Host "✓ Downloaded." -ForegroundColor Green
    } catch {
        Write-Host "✗ Download failed: $_" -ForegroundColor Red
        Write-Host "  Please download Node.js LTS manually from https://nodejs.org" -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 1
    }

    Write-Host "Running Node.js installer..." -ForegroundColor Gray
    Start-Process -FilePath $installerPath -ArgumentList "/qn" -Wait

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Host "✓ Node.js installed: $(node --version)" -ForegroundColor Green
    } else {
        Write-Host "✗ Node.js installation may have failed. Please try manual installation." -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }
}

# --- 2. Determine install location ---
Write-Host ""
$installDir = Join-Path ([System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)) "Awana-Print"
Write-Host "Install location: $installDir" -ForegroundColor Gray

if (Test-Path $installDir) {
    Write-Host "Directory already exists. Updating..." -ForegroundColor Gray
} else {
    Write-Host "Creating directory..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path $installDir | Out-Null
}

# --- 3. Download project (if not already present) ---
$projectPath = Join-Path $installDir "Print-TwoTimTwo-Labels"
$printServerPath = Join-Path $projectPath "print-server"

if (-not (Test-Path (Join-Path $printServerPath "server.js"))) {
    Write-Host ""
    Write-Host "Downloading Print-TwoTimTwo-Labels..." -ForegroundColor Gray

    $zipUrl = "https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/archive/refs/heads/main.zip"
    $zipPath = Join-Path $installDir "project.zip"

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
        Write-Host "✓ Downloaded." -ForegroundColor Green
    } catch {
        Write-Host "✗ Download failed: $_" -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }

    Write-Host "Extracting..." -ForegroundColor Gray
    Expand-Archive -Path $zipPath -DestinationPath $installDir -Force

    # Move from "Print-TwoTimTwo-Labels-main" to "Print-TwoTimTwo-Labels"
    $extractedPath = Join-Path $installDir "Print-TwoTimTwo-Labels-main"
    if (Test-Path $extractedPath) {
        if (Test-Path $projectPath) { Remove-Item $projectPath -Recurse -Force }
        Rename-Item -Path $extractedPath -NewName "Print-TwoTimTwo-Labels" | Out-Null
    }

    Remove-Item -Path $zipPath -Force
    Write-Host "✓ Extracted to $projectPath" -ForegroundColor Green
}

# --- 4. Install npm packages (if not already installed) ---
Write-Host ""
if (-not (Test-Path (Join-Path $printServerPath "node_modules"))) {
    Write-Host "Installing npm packages (~300 MB)..." -ForegroundColor Gray
    Write-Host "This may take a few minutes on first run..." -ForegroundColor Gray

    Push-Location $printServerPath
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "✗ npm install failed" -ForegroundColor Red
            Read-Host "  Press Enter to exit"
            Pop-Location
            exit 1
        }
        Write-Host "✓ Packages installed." -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "✓ npm packages already installed." -ForegroundColor Green
}

# --- 5. Configure printer and URL ---
Write-Host ""
$configPath = Join-Path $printServerPath "config.json"

# Load existing config if available
$cfg = [ordered]@{ printerName = ""; checkinUrl = "https://kvbchurch.twotimtwo.com/clubber/checkin?#" }
if (Test-Path $configPath) {
    try {
        $saved = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($saved.printerName) { $cfg.printerName = $saved.printerName }
        if ($saved.checkinUrl) { $cfg.checkinUrl = $saved.checkinUrl }
    } catch {
        # Silently ignore parse errors
    }
}

function Configure {
    Write-Host ""
    Write-Host "--- Printer Selection ---" -ForegroundColor Cyan

    $printers = @(Get-Printer | Select-Object -ExpandProperty Name)
    if ($printers.Count -eq 0) {
        Write-Host "✗ No printers found. Make sure your label printer is connected." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host "Available printers:" -ForegroundColor White
    for ($i = 0; $i -lt $printers.Count; $i++) {
        $marker = if ($printers[$i] -eq $cfg.printerName) { "  ← current" } else { "" }
        Write-Host "  [$i] $($printers[$i])$marker"
    }

    $choice = Read-Host "`nEnter printer number (or press Enter to keep: $($cfg.printerName))"
    if ($choice -match '^\d+$') {
        $idx = [int]$choice
        if ($idx -ge 0 -and $idx -lt $printers.Count) {
            $cfg.printerName = $printers[$idx]
        }
    }

    Write-Host ""
    Write-Host "--- Check-In URL ---" -ForegroundColor Cyan
    $newUrl = Read-Host "Enter check-in URL (press Enter to keep: $($cfg.checkinUrl))"
    if ($newUrl.Trim()) { $cfg.checkinUrl = $newUrl.Trim() }

    # Save config
    [PSCustomObject]@{ printerName = $cfg.printerName; checkinUrl = $cfg.checkinUrl } |
        ConvertTo-Json | Set-Content $configPath
    Write-Host ""
    Write-Host "✓ Settings saved." -ForegroundColor Green
}

# First time or config missing
if (-not $cfg.printerName -or -not $cfg.checkinUrl) {
    Write-Host "First-time configuration needed..." -ForegroundColor Cyan
    Configure
} else {
    Write-Host "Current settings:" -ForegroundColor White
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

# --- 6. Start server and open browser ---
Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Server starting..." -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Opening Microsoft Edge at check-in page..." -ForegroundColor Cyan
Start-Process "msedge" -ArgumentList $cfg.checkinUrl

Write-Host "Print server running at http://localhost:3456" -ForegroundColor Cyan
Write-Host "Leave this window open during check-in." -ForegroundColor Gray
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

$env:PRINTER_NAME = $cfg.printerName
Set-Location $printServerPath
node server.js
