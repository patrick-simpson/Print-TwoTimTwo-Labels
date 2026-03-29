# Awana Label Print Server -- All-in-One Installer
# Version    : 1.8.2
# Updated    : 2026-03-27
#
# This script:
#   1. Checks/upgrades PowerShell to v7+
#   2. Installs Node.js LTS if needed  (requires admin on first run only)
#   3. Checks if installed version is outdated -> re-downloads if so
#   4. Downloads the Print-TwoTimTwo-Labels project + npm packages
#   5. Loads saved config (printer & check-in URL)
#   6. Downloads clubbers.csv from TwoTimTwo for enriched labels
#   7. Asks for printer + check-in URL (skippable on repeat runs)
#   8. Starts the print server and opens Edge
#
# ADMIN NOTE: Administrator rights are only needed on the very first run if
# Node.js is not yet installed. Once Node.js is installed, the script runs
# fine without elevation.

param(
    [string]$PrinterName,
    [string]$CheckinUrl,
    [string]$InstallPath,
    [switch]$SkipNodeCheck
)

$ErrorActionPreference = "Stop"
$ScriptVersion = "1.8.2"

# Global error handler: pause before exiting on error so user can see what went wrong
trap {
    Write-Host ""
    Write-Host "==========================================================================" -ForegroundColor Red
    Write-Host "  ERROR:" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "==========================================================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Set window properties
$Host.UI.RawUI.WindowTitle = "Awana Label Print Server Setup"

Write-Host ""
Write-Host "=================================================================================" -ForegroundColor Cyan
Write-Host "  Awana Label Print Server -- All-in-One Installer" -ForegroundColor Cyan
Write-Host "  Version $ScriptVersion" -ForegroundColor Cyan
Write-Host "=================================================================================" -ForegroundColor Cyan
Write-Host ""

# --- Admin rights check ---
# Node.js MSI installs to C:\Program Files and requires elevation.
# All other steps (npm, node, writing to AppData) work without admin.
# So: only warn/offer elevation if Node.js is not yet installed.
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$nodeAlreadyInstalled = (Get-Command node -ErrorAction SilentlyContinue) -ne $null

if (-not $isAdmin -and -not $nodeAlreadyInstalled -and -not $SkipNodeCheck) {
    Write-Host ""
    Write-Host "  !! Not running as Administrator" -ForegroundColor Yellow
    Write-Host "  Node.js is not installed yet. Installing it requires admin rights." -ForegroundColor Yellow
    Write-Host ""

    $scriptPath = $MyInvocation.MyCommand.Path
    if ($scriptPath) {
        # Script was saved as a file -- we can re-launch it elevated automatically
        Write-Host "  Relaunching as Administrator..." -ForegroundColor Cyan
        $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
        if ($PrinterName)  { $argList += " -PrinterName `"$PrinterName`""  }
        if ($CheckinUrl)   { $argList += " -CheckinUrl `"$CheckinUrl`""    }
        if ($InstallPath)  { $argList += " -InstallPath `"$InstallPath`""  }
        Start-Process powershell -Verb RunAs -ArgumentList $argList
        exit 0
    } else {
        # Script was pasted into PowerShell -- cannot auto-elevate (no file path)
        Write-Host "  To run as Administrator:" -ForegroundColor White
        Write-Host "    1. Close this window." -ForegroundColor White
        Write-Host "    2. Right-click PowerShell in the Start menu." -ForegroundColor White
        Write-Host "    3. Choose 'Run as administrator'." -ForegroundColor White
        Write-Host "    4. Paste and run the script again." -ForegroundColor White
        Write-Host ""
        Write-Host "  OR: if you already have Node.js installed elsewhere, press Enter to try anyway." -ForegroundColor Gray
        $null = Read-Host "  Press Enter to continue without admin, or Ctrl+C to cancel"
    }
} elseif ($isAdmin) {
    Write-Host "  Running as Administrator." -ForegroundColor Gray
} else {
    Write-Host "  (Node.js already installed -- admin not required)" -ForegroundColor Gray
}

# --- 0. Kill any existing server ---
# We must do this FIRST so that if we need to update/delete files in Step 3,
# the files are not locked by a running Node process.
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
        Start-Sleep -Milliseconds 800  # Brief pause to ensure port is released
        Write-Host "  [OK] Old server stopped." -ForegroundColor Green
    } else {
        Write-Host "  [OK] Port is free." -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Could not check port (non-critical):     Write-Host "  [WARN] Could not check port (non-critical): $(_)" -ForegroundColor Yellow" -ForegroundColor Yellow
}

# --- 1. Check PowerShell version ---
Write-Host "[1/8] Checking PowerShell version..." -ForegroundColor White
$psVer = $PSVersionTable.PSVersion
if ($psVer.Major -lt 7) {
    # Check if PS7 is already installed
    $ps7Installed = (Get-Command pwsh -ErrorAction SilentlyContinue) -or `
                    (Test-Path "C:\Program Files\PowerShell\7\pwsh.exe")

    if ($ps7Installed) {
        Write-Host "  PowerShell $($psVer.Major).$($psVer.Minor) running, but PowerShell 7 is installed." -ForegroundColor Green
        Write-Host "  Continuing with current session..." -ForegroundColor Gray
    } else {
        Write-Host "  PowerShell $($psVer.Major).$($psVer.Minor) detected. Installing PowerShell 7..." -ForegroundColor Yellow
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
                Write-Host "  [FAIL] Could not install PowerShell 7: $_" -ForegroundColor Red
                Write-Host "  Continuing with PowerShell $($psVer.Major).$($psVer.Minor)..." -ForegroundColor Yellow
            }
        }

        if ($upgraded) {
            Write-Host "[OK] PowerShell 7 installed." -ForegroundColor Green
            Write-Host ""
            Write-Host "  Please close this window and re-run the script in PowerShell 7." -ForegroundColor Yellow
            Write-Host "  (Search for 'PowerShell 7' in the Start menu.)" -ForegroundColor Yellow
            Read-Host "  Press Enter to exit"
            exit 0
        }
    }
} else {
    Write-Host "[OK] PowerShell $($psVer.Major).$($psVer.Minor) found." -ForegroundColor Green
}

# --- 2. Check for Node.js and install if needed ---
Write-Host "[2/8] Checking for Node.js..." -ForegroundColor White
if ($SkipNodeCheck) {
    Write-Host "[SKIP] Skipping Node.js check (per -SkipNodeCheck flag)" -ForegroundColor Gray
} elseif (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node --version
    Write-Host "[OK] Node.js $nodeVersion found." -ForegroundColor Green
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
        Write-Host "[OK] Downloaded ($('{0:N0}' -f ((Get-Item $installerPath).Length)) bytes)" -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] Download failed: $_" -ForegroundColor Red
        Write-Host "  Please download Node.js LTS manually from https://nodejs.org" -ForegroundColor Yellow
        Write-Host "  Or run this script with -SkipNodeCheck if you already have Node.js installed" -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 1
    }

    Write-Host "Running Node.js installer..." -ForegroundColor Gray
    try {
        Start-Process -FilePath $installerPath -ArgumentList "/qn" -Wait -ErrorAction Stop
    } catch {
        Write-Host "[FAIL] Node.js installation failed: $_" -ForegroundColor Red
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
        Write-Host "[OK] Node.js installed: $nodeVersion" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Node.js installation verification failed." -ForegroundColor Red
        Write-Host "  PATH may not have been refreshed properly." -ForegroundColor Red
        Write-Host "  Try closing PowerShell and running this script again in a new window." -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 1
    }
}

# --- 3. Determine install location and check for updates ---
Write-Host ""
Write-Host "[3/8] Checking installation..." -ForegroundColor White
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
    Write-Host "[FAIL] Failed to create/access install directory: $_" -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
}

# --- 2b. Check if installed version is outdated ---
$projectPath = Join-Path $installDir "Print-TwoTimTwo-Labels"
$versionFile = Join-Path $installDir ".script-version"

# Determine whether a fresh download is needed.
# Three cases require an update:
#   1. No version file but project folder exists  = pre-versioning install, refresh it
#   2. Version file exists but differs from current script version
#   3. Version file is unreadable (corrupt) = force refresh to be safe
$needsUpdate = $false
if (-not (Test-Path $versionFile)) {
    if (Test-Path $projectPath) {
        Write-Host "No version file found in existing install -- refreshing to v$ScriptVersion..." -ForegroundColor Cyan
        $needsUpdate = $true
    }
    # If neither file nor project exists this is a clean first install;
    # Step 3 will handle the download without any delete needed.
} else {
    try {
        $installedVersion = Get-Content $versionFile -Raw | ForEach-Object { $_.Trim() }
        if ($installedVersion -ne $ScriptVersion) {
            Write-Host "Updating from v$installedVersion to v$ScriptVersion..." -ForegroundColor Cyan
            $needsUpdate = $true
        }
    } catch {
        Write-Host "  Could not read version file -- refreshing install to be safe..." -ForegroundColor Yellow
        $needsUpdate = $true
    }
}

if ($needsUpdate) {
    # Back up user data before deleting the project so it survives the update
    $csvBackupPath    = Join-Path $installDir "clubbers-backup.csv"
    $cfgBackupPath    = Join-Path $installDir "config-backup.json"
    $existingCsvPath  = Join-Path $projectPath "print-server\clubbers.csv"
    $existingCfgPath  = Join-Path $projectPath "print-server\config.json"
    if (Test-Path $existingCsvPath) {
        Copy-Item $existingCsvPath $csvBackupPath -Force
        Write-Host "  Backed up clubbers.csv" -ForegroundColor Gray
    }
    if (Test-Path $existingCfgPath) {
        Copy-Item $existingCfgPath $cfgBackupPath -Force
        Write-Host "  Backed up config.json (printer & URL settings)" -ForegroundColor Gray
    }
        Write-Host "  Clearing installation directory (aggressive)..." -ForegroundColor Gray
    # Force kill ANY node processes to release all possible file locks
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

    # Aggressive multi-pass deletion loop
    $retryCount = 0
    while ($retryCount -lt 3) {
        try {
            Get-ChildItem -Path $installDir -Exclude "clubbers-backup.csv", "config-backup.json", "project.zip" | Remove-Item -Recurse -Force -ErrorAction Stop
            break
        } catch {
            $retryCount++
            Start-Sleep -Seconds 1
        }
    }
    Write-Host "  Old installation removed." -ForegroundColor Gray
}

# --- 4a. Download project (if not already present) ---
$printServerPath = Join-Path $projectPath "print-server"

if (-not (Test-Path (Join-Path $printServerPath "server.js"))) {
    Write-Host ""
    Write-Host "[4/8] Downloading project..." -ForegroundColor White

    $zipUrl = "https://github.com/patrick-simpson/Print-TwoTimTwo-Labels/archive/refs/heads/main.zip"
    $zipPath = Join-Path $installDir "project.zip"

    try {
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
        Write-Host "[OK] Downloaded." -ForegroundColor Green
    } catch {
        Write-Host "[FAIL] Download failed: $_" -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }

    Write-Host "Extracting..." -ForegroundColor Gray
    try {
        # Clean up any partial extraction from a previous failed attempt
        Get-ChildItem -Path $installDir -Directory |
            Where-Object { $_.Name -match "Print-TwoTimTwo-Labels" } |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

        # Extract the zip
        $tempExtract = Join-Path $installDir "_extract_temp"
        if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
        New-Item -ItemType Directory -Path $tempExtract | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $tempExtract)

        # Find the extracted folder inside the temp dir
        $extractedDir = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
        if (-not $extractedDir) {
            Write-Host "[FAIL] Zip did not contain a top-level directory" -ForegroundColor Red
            Read-Host "  Press Enter to exit"
            exit 1
        }

        # Move to final location
        if (Test-Path $projectPath) { Remove-Item $projectPath -Recurse -Force }
        Move-Item -Path $extractedDir.FullName -Destination $projectPath -Force
        Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  Extracted from '$($extractedDir.Name)'" -ForegroundColor Gray
    } catch {
        Write-Host "[FAIL] Extraction failed: $_" -ForegroundColor Red
        Read-Host "  Press Enter to exit"
        exit 1
    }

    Remove-Item -Path $zipPath -Force -ErrorAction SilentlyContinue

    # Verify critical files exist
    $serverJs = Join-Path $projectPath "print-server\server.js"
    $pkgJson  = Join-Path $projectPath "print-server\package.json"
    if (-not (Test-Path $serverJs) -or -not (Test-Path $pkgJson)) {
        Write-Host "[FAIL] Extraction incomplete -- missing print-server files" -ForegroundColor Red
        Write-Host "  Expected: $serverJs" -ForegroundColor Red
        Write-Host "  Try deleting $installDir and running again." -ForegroundColor Yellow
        Read-Host "  Press Enter to exit"
        exit 1
    }
    Write-Host "[OK] Extracted to $projectPath" -ForegroundColor Green
}

# Restore any user data that was backed up before a version update.
# This runs unconditionally so backups are never left orphaned.
$csvBackupPath = Join-Path $installDir "clubbers-backup.csv"
$cfgBackupPath = Join-Path $installDir "config-backup.json"
if ((Test-Path $csvBackupPath) -and (Test-Path $printServerPath)) {
    Move-Item $csvBackupPath (Join-Path $printServerPath "clubbers.csv") -Force
    Write-Host "[OK] Restored your clubbers.csv data." -ForegroundColor Green
}
if ((Test-Path $cfgBackupPath) -and (Test-Path $printServerPath)) {
    Move-Item $cfgBackupPath (Join-Path $printServerPath "config.json") -Force
    Write-Host "[OK] Restored your printer & URL settings." -ForegroundColor Green
}

# --- 4b. Install npm packages (if not already installed) ---
Write-Host ""
if (-not (Test-Path (Join-Path $printServerPath "node_modules"))) {
    Write-Host "[4/8] Installing npm packages (~300 MB)..." -ForegroundColor White
    Write-Host "This may take a few minutes on first run..." -ForegroundColor Gray

    Push-Location $printServerPath
    try {
        npm install
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAIL] npm install failed" -ForegroundColor Red
            Read-Host "  Press Enter to exit"
            Pop-Location
            exit 1
        }
        Write-Host "[OK] Packages installed." -ForegroundColor Green
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[OK] npm packages already installed." -ForegroundColor Green
}

# --- 5. Load config (needed for CSV download URL) ---
Write-Host ""
Write-Host "[5/8] Loading saved settings..." -ForegroundColor White
$configPath = Join-Path $printServerPath "config.json"

$cfg = [ordered]@{ printerName = ""; checkinUrl = "https://kvbchurch.twotimtwo.com/clubber/checkin?#" }
if (Test-Path $configPath) {
    try {
        $saved = Get-Content $configPath -Raw | ConvertFrom-Json
        if ($saved.printerName) { $cfg.printerName = $saved.printerName }
        if ($saved.checkinUrl)  { $cfg.checkinUrl  = $saved.checkinUrl  }
    } catch {}
}
if ($PrinterName) { $cfg.printerName = $PrinterName }
if ($CheckinUrl)  { $cfg.checkinUrl  = $CheckinUrl  }

# --- 6. Download clubbers.csv from TwoTimTwo or create template ---
# clubbers.csv lives alongside server.js and unlocks enriched labels:
#   - Red allergy strip (NUTS, DAIRY, GLUTEN, EGG, SHELLFISH auto-detected)
#   - "Happy Birthday!" banner for birthdays within the next 7 days
#   - Handbook group line below the club name
# The server re-reads this file on every check-in so you can edit it mid-event.
# If the file is missing or locked the server continues printing basic labels.
$clubbersCsvPath = Join-Path $printServerPath "clubbers.csv"

Write-Host ""
Write-Host "[6/8] Setting up clubbers.csv..." -ForegroundColor White

# If a real CSV was restored from backup, keep it -- don't overwrite with a template.
# The bookmarklet will sync fresh data from the authenticated browser session anyway.
$hasRealCsv = $false
if (Test-Path $clubbersCsvPath) {
    $csvLines = @(Get-Content $clubbersCsvPath -ErrorAction SilentlyContinue | Where-Object { $_.Trim() })
    if ($csvLines.Count -gt 4) {
        $hasRealCsv = $true
        Write-Host "  [OK] Using existing clubbers.csv ($($csvLines.Count - 1) clubber(s))" -ForegroundColor Green
        Write-Host "  The bookmarklet will sync fresh data when you open the check-in page." -ForegroundColor Gray
    }
}

if (-not $hasRealCsv) {
    # No real CSV on disk -- try to get one via the user's authenticated browser session.
    # PowerShell can't authenticate with TwoTimTwo, but Edge has session cookies.
    # Strategy: open the CSV URL in Edge, watch the Downloads folder for the file.

    $twotimtwoUrl = "https://kvbchurch.twotimtwo.com/clubber/csv"
    try {
        $checkinUri = [System.Uri]$cfg.checkinUrl
        $twotimtwoUrl = "$($checkinUri.Scheme)://$($checkinUri.Host)/clubber/csv"
    } catch {}

    $downloaded = $false

    # Find the user's Downloads folder
    $downloadsDir = Join-Path ([System.Environment]::GetFolderPath('UserProfile')) "Downloads"

    # Snapshot existing CSV files in Downloads before opening the browser
    $beforeFiles = @()
    if (Test-Path $downloadsDir) {
        $beforeFiles = @(Get-ChildItem -Path $downloadsDir -Filter "*.csv" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    }

    Write-Host "  Opening TwoTimTwo CSV download in default browser..." -ForegroundColor Gray
    Write-Host "  (Using your browser's login session)" -ForegroundColor Gray
    Start-Process $twotimtwoUrl

    # Wait for a new CSV file to appear in Downloads (up to 15 seconds)
    $timeout = 15
    $elapsed = 0
    $newCsvPath = $null
    while ($elapsed -lt $timeout) {
        Start-Sleep -Seconds 1
        $elapsed++
        Write-Host -NoNewline "`r  Waiting for download... ($elapsed/$timeout sec)   "

        $afterFiles = @(Get-ChildItem -Path $downloadsDir -Filter "*.csv" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
        $newFiles = @($afterFiles | Where-Object { $_ -notin $beforeFiles })

        if ($newFiles.Count -gt 0) {
            # Pick the most recently modified new CSV
            $newCsvPath = $newFiles | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1
            break
        }
    }
    Write-Host ""

    if ($newCsvPath) {
        # Validate it looks like CSV (not HTML error page)
        $csvContent = Get-Content $newCsvPath -Raw -ErrorAction SilentlyContinue
        $isHtml = $csvContent -and ($csvContent.TrimStart().StartsWith('<!') -or $csvContent.TrimStart().StartsWith('<html'))

        if ($isHtml -or -not $csvContent -or $csvContent.Trim().Length -eq 0) {
            Write-Host "  [WARN] Downloaded file was not valid CSV (login may be required)." -ForegroundColor Yellow
        } else {
            Copy-Item $newCsvPath $clubbersCsvPath -Force
            $downloaded = $true
            $lineCount = ($csvContent -split "`n" | Where-Object { $_.Trim() }).Count - 1
            Write-Host "  [OK] Downloaded roster from TwoTimTwo ($lineCount clubber(s))" -ForegroundColor Green
        }
    } else {
        Write-Host "  [WARN] No CSV download detected." -ForegroundColor Yellow
        Write-Host "    You may need to log in to TwoTimTwo first." -ForegroundColor Yellow
    }

    if (-not $downloaded) {
        Write-Host "  No roster data yet -- the bookmarklet will sync it from your browser." -ForegroundColor Yellow
        Write-Host "  (Labels will print without enrichment until then.)" -ForegroundColor Gray
    }
}

Write-Host "[OK] clubbers.csv setup complete." -ForegroundColor Green
Write-Host ""

# --- 7. Configure printer and URL ---
Write-Host ""
Write-Host "[7/8] Printer & URL configuration" -ForegroundColor White

function Configure {
    Write-Host ""
    Write-Host "--- Printer Selection ---" -ForegroundColor Cyan

    $printers = @(Get-Printer | Select-Object -ExpandProperty Name)
    if ($printers.Count -eq 0) {
        Write-Host "[FAIL] No printers found. Make sure your label printer is connected." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }

    Write-Host "Available printers:" -ForegroundColor White
    for ($i = 0; $i -lt $printers.Count; $i++) {
        $marker = if ($printers[$i] -eq $cfg.printerName) { "  <- current" } else { "" }
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
    Write-Host "[OK] Settings saved." -ForegroundColor Green
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
    Write-Host "[OK] Settings saved." -ForegroundColor Green
}

# --- 8. Start server and open browser ---
Write-Host ""
Write-Host "[8/8] Starting print server..." -ForegroundColor White
Write-Host ""
Write-Host "=================================================================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "=================================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "How it works:" -ForegroundColor White
Write-Host "  1. Drag the bookmarklet to your bookmark bar (first time only)" -ForegroundColor Gray
Write-Host "  2. Go to the check-in page and click the bookmarklet" -ForegroundColor Gray
Write-Host "  3. Labels print automatically when a child is checked in" -ForegroundColor Gray
Write-Host ""
# Open the check-in page in Edge, plus the bookmarklet setup page so the
# user can drag it to their bookmark bar on first run.
Write-Host "Opening check-in page in default browser..." -ForegroundColor Cyan
Start-Process $cfg.checkinUrl
Write-Host ""
Write-Host "  If this is your first time, drag the bookmarklet button to your bookmark bar." -ForegroundColor Yellow
Write-Host "  After that, just click it on the check-in page to arm auto-printing." -ForegroundColor Yellow

Write-Host ""
Write-Host "Print server running" -ForegroundColor Green
Write-Host "  Server: http://localhost:3456" -ForegroundColor Cyan
Write-Host "  Printer: $($cfg.printerName)" -ForegroundColor White
Write-Host ""
Write-Host "Keep this window open during check-in." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Yellow
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
        Write-Host "  [OK] Old server stopped." -ForegroundColor Green
    } else {
        Write-Host "  [OK] Port is free." -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Could not check port (non-critical): $_" -ForegroundColor Yellow
}

# Save the script version for future updates
try {
    Set-Content -Path $versionFile -Value $ScriptVersion -Force -ErrorAction SilentlyContinue
} catch {
    # Silently ignore version file write errors
}

# --- Set up desktop launcher (launch-awana.bat + read-config.js + shortcut) ---
Write-Host ""
Write-Host "Setting up desktop launcher..." -ForegroundColor Gray
try {
    # Copy launcher files to install dir (one level above project, survives re-downloads)
    $launcherSrc = Join-Path $projectPath "launch-awana.bat"
    $configHelperSrc = Join-Path $projectPath "read-config.js"
    $launcherDest = Join-Path $installDir "launch-awana.bat"
    $configHelperDest = Join-Path $installDir "read-config.js"

    if (Test-Path $launcherSrc) {
        Copy-Item $launcherSrc $launcherDest -Force
    }
    if (Test-Path $configHelperSrc) {
        Copy-Item $configHelperSrc $configHelperDest -Force
    }

    # Copy icon for the shortcut
    $iconSrc = Join-Path $projectPath "electron-app\build\icon.ico"
    $iconDest = Join-Path $installDir "awana-print.ico"
    if (Test-Path $iconSrc) {
        Copy-Item $iconSrc $iconDest -Force
    }

    # Create desktop shortcut if it doesn't already exist
    $desktop = [System.Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop "Awana Print.lnk"
    if (-not (Test-Path $lnkPath)) {
        $ws = New-Object -ComObject WScript.Shell
        $shortcut = $ws.CreateShortcut($lnkPath)
        $shortcut.TargetPath = $launcherDest
        $shortcut.WorkingDirectory = $installDir
        $shortcut.Description = "Start Awana label print server and open check-in page"
        if (Test-Path $iconDest) {
            $shortcut.IconLocation = "$iconDest,0"
        } else {
            $shortcut.IconLocation = "msedge.exe,0"
        }
        $shortcut.Save()
        Write-Host "  [OK] Created desktop shortcut: Awana Print" -ForegroundColor Green
    } else {
        Write-Host "  [OK] Desktop shortcut already exists." -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Could not create desktop shortcut (non-critical): $_" -ForegroundColor Yellow
}

$env:PRINTER_NAME = $cfg.printerName
Set-Location $printServerPath
node server.js


