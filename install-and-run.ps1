# Awana Label Print Server — All-in-One Installer
# Version : 1.2.0
# Updated : 2026-03-24
#
# This script:
#   1. Upgrades PowerShell to v7+ if needed
#   2. Installs Node.js LTS if needed
#   3. Downloads the Print-TwoTimTwo-Labels project
#   4. Installs npm packages (~300 MB, first time only)
#   5. Asks for printer + check-in URL
#   6. Starts the server and opens Edge

param(
    [string]$PrinterName,
    [string]$CheckinUrl,
    [string]$InstallPath,
    [switch]$SkipNodeCheck
)

$ErrorActionPreference = "Stop"
$ScriptVersion = "1.2.0"
$ScriptDate    = "2026-03-24"

Write-Host ""
Write-Host "==============================" -ForegroundColor Cyan
Write-Host "  Awana Label Print Server" -ForegroundColor Cyan
Write-Host "  All-in-One Installer" -ForegroundColor Cyan
Write-Host "  v$ScriptVersion  ($ScriptDate)" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# --- 0. Check PowerShell version ---
Write-Host "Checking PowerShell version..." -ForegroundColor Gray
$psVer = $PSVersionTable.PSVersion
if ($psVer.Major -lt 7) {
    Write-Host "  PowerShell $($psVer.Major).$($psVer.Minor) detected. Upgrading to PowerShell 7..." -ForegroundColor Yellow
    Write-Host ""

    $upgraded = $false

    # Try winget first (built into Windows 10 1709+ and Windows 11)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "  Installing via winget..." -ForegroundColor Gray
        try {
            winget install --id Microsoft.PowerShell --source winget --silent `
                --accept-package-agreements --accept-source-agreements
            if ($LASTEXITCODE -eq 0) { $upgraded = $true }
        } catch {}
    }

    # Fallback: download MSI directly
    if (-not $upgraded) {
        Write-Host "  winget unavailable. Downloading PowerShell 7 MSI..." -ForegroundColor Gray
        $ps7Url  = "https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/PowerShell-7.4.6-win-x64.msi"
        $ps7Path = Join-Path ([System.IO.Path]::GetTempPath()) "PowerShell-7-win-x64.msi"
        try {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $ps7Url -OutFile $ps7Path -ErrorAction Stop
            Start-Process msiexec.exe -ArgumentList "/i `"$ps7Path`" /qn" -Wait -ErrorAction Stop
            $upgraded = $true
        } catch {
            Write-Host "  ✗ Could not install PowerShell 7: $_" -ForegroundColor Red
            Write-Host "  Continuing with PowerShell $($psVer.Major).$($psVer.Minor)..." -ForegroundColor Yellow
        }
    }

    if ($upgraded) {
        Write-Host "✓ PowerShell 7 installed." -ForegroundColor Green
        Write-Host ""
        Write-Host "  Please close this window and re-run the script in PowerShell 7." -ForegroundColor Yellow
        Write-Host "  (Search for 'PowerShell 7' in the Start menu.)" -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 0
    }
} else {
    Write-Host "✓ PowerShell $($psVer.Major).$($psVer.Minor) found." -ForegroundColor Green
}

# --- 1. Check for Node.js and install if needed ---
Write-Host "Checking for Node.js..." -ForegroundColor Gray
if ($SkipNodeCheck) {
    Write-Host "⊘ Skipping Node.js check (per -SkipNodeCheck flag)" -ForegroundColor Gray
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
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
        Invoke-WebRequest -Uri $nodeUrl -OutFile $installerPath -ErrorAction Stop
        Write-Host "✓ Downloaded ($('{0:N0}' -f ((Get-Item $installerPath).Length)) bytes)" -ForegroundColor Green
    } catch {
        Write-Host "✗ Download failed: $_" -ForegroundColor Red
        Write-Host "  Please download Node.js LTS manually from https://nodejs.org" -ForegroundColor Yellow
        Write-Host "  Or run this script with -SkipNodeCheck if you already have Node.js installed" -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 1
    }

    Write-Host "Running Node.js installer..." -ForegroundColor Gray
    try {
        Start-Process -FilePath $installerPath -ArgumentList "/qn" -Wait -ErrorAction Stop
    } catch {
        Write-Host "✗ Node.js installation failed: $_" -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }

    # Refresh PATH - CRITICAL: must refresh before continuing
    Write-Host "Refreshing PATH environment..." -ForegroundColor Gray
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    # Verify Node.js is actually available
    $nodeCheck = $null
    try {
        $nodeCheck = Get-Command node -ErrorAction SilentlyContinue
    } catch {}

    if ($nodeCheck) {
        $nodeVersion = node --version
        Write-Host "✓ Node.js installed: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "✗ Node.js installation verification failed." -ForegroundColor Red
        Write-Host "  PATH may not have been refreshed properly." -ForegroundColor Red
        Write-Host "  Try closing PowerShell and running this script again in a new window." -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 1
    }
}

# --- 2. Determine install location ---
Write-Host ""
if ($InstallPath) {
    $installDir = $InstallPath
    Write-Host "Using custom install path: $installDir" -ForegroundColor Gray
} else {
    $installDir = Join-Path ([System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::ApplicationData)) "Awana-Print"
    Write-Host "Install location: $installDir" -ForegroundColor Gray
}

try {
    if (Test-Path $installDir) {
        Write-Host "  Directory already exists. Updating..." -ForegroundColor Gray
    } else {
        Write-Host "  Creating directory..." -ForegroundColor Gray
        New-Item -ItemType Directory -Path $installDir | Out-Null
    }
} catch {
    Write-Host "✗ Failed to create/access install directory: $_" -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
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
    try {
        # Clean up any partial extraction from a previous failed attempt
        Get-ChildItem -Path $installDir -Directory |
            Where-Object { $_.Name -match "Print-TwoTimTwo-Labels" } |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

        # Use .NET ZipFile directly — avoids a Windows PowerShell 5.1 bug where
        # Expand-Archive fails on zip entries with hidden directories (e.g. .github)
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $installDir)
    } catch {
        Write-Host "✗ Extraction failed: $_" -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }

    # Find the extracted directory (dynamically - don't hardcode)
    $extractedDir = Get-ChildItem -Path $installDir -Directory | Where-Object { $_.Name -match "Print-TwoTimTwo-Labels" } | Select-Object -First 1
    if (-not $extractedDir) {
        Write-Host "✗ Could not find extracted project directory" -ForegroundColor Red
        Write-Host "  Expected 'Print-TwoTimTwo-Labels*' folder in $installDir" -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }

    # Rename if necessary
    if ($extractedDir.Name -ne "Print-TwoTimTwo-Labels") {
        $extractedPath = $extractedDir.FullName
        if (Test-Path $projectPath) { Remove-Item $projectPath -Recurse -Force }
        Rename-Item -Path $extractedPath -NewName "Print-TwoTimTwo-Labels" | Out-Null
        Write-Host "  Renamed from '$($extractedDir.Name)'" -ForegroundColor Gray
    }

    Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue
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

# Load existing config if available, or use command-line parameters
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

# Override with command-line parameters if provided
if ($PrinterName) { $cfg.printerName = $PrinterName }
if ($CheckinUrl) { $cfg.checkinUrl = $CheckinUrl }

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

# If parameters provided and both are set, skip interactive configuration
$skipInteractive = $PrinterName -and $CheckinUrl

# First time or config missing
if ((-not $cfg.printerName -or -not $cfg.checkinUrl) -and -not $skipInteractive) {
    Write-Host "First-time configuration needed..." -ForegroundColor Cyan
    Configure
} elseif (-not $skipInteractive) {
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
} else {
    Write-Host "Configuration provided via parameters (non-interactive mode)" -ForegroundColor Cyan
    Write-Host "  Printer : $($cfg.printerName)" -ForegroundColor White
    Write-Host "  URL     : $($cfg.checkinUrl)" -ForegroundColor White
    Write-Host ""

    # Save config
    [PSCustomObject]@{ printerName = $cfg.printerName; checkinUrl = $cfg.checkinUrl } |
        ConvertTo-Json | Set-Content $configPath
    Write-Host "✓ Settings saved." -ForegroundColor Green
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

# --- Kill any existing process on port 3456 ---
Write-Host "Checking for existing server on port 3456..." -ForegroundColor Gray
try {
    $conns = @(Get-NetTCPConnection -LocalPort 3456 -ErrorAction SilentlyContinue)
    if ($conns.Count -gt 0) {
        foreach ($conn in $conns) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Host "  Found: $($proc.Name) (PID $($proc.Id)). Stopping..." -ForegroundColor Yellow
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Milliseconds 500  # Brief pause to ensure port is released
        Write-Host "  ✓ Old server stopped." -ForegroundColor Green
    } else {
        Write-Host "  ✓ Port is free." -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠ Could not check port (non-critical): $_" -ForegroundColor Yellow
}

$env:PRINTER_NAME = $cfg.printerName
Set-Location $printServerPath
node server.js
