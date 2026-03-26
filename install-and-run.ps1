# Awana Label Print Server — All-in-One Installer
# Version    : 1.4.1
# Updated    : 2026-03-26
#
# This script:
#   1. Upgrades PowerShell to v7+ if needed
#   2. Installs Node.js LTS if needed  (requires admin on first run only)
#   3. Downloads the Print-TwoTimTwo-Labels project
#   3b.Creates a clubbers.csv template for enriched labels (allergy alerts,
#      birthday banners, handbook groups) — edit with your real data
#   4. Installs npm packages (~300 MB, first time only)
#   5. Asks for printer + check-in URL
#   6. Starts the server and opens Edge
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
$ScriptVersion = "1.4.1"

# Global error handler: pause before exiting on error so user can see what went wrong
trap {
    Write-Host ""
    Write-Host "╔═══════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "║ ERROR:" -ForegroundColor Red
    Write-Host "║ $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "╚═══════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Red
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Set window properties
$Host.UI.RawUI.WindowTitle = "Awana Label Print Server Setup"

Write-Host ""
Write-Host "=================================================================================" -ForegroundColor Cyan
Write-Host "  Awana Label Print Server — All-in-One Installer" -ForegroundColor Cyan
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
        # Script was saved as a file — we can re-launch it elevated automatically
        Write-Host "  Relaunching as Administrator..." -ForegroundColor Cyan
        $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
        if ($PrinterName)  { $argList += " -PrinterName `"$PrinterName`""  }
        if ($CheckinUrl)   { $argList += " -CheckinUrl `"$CheckinUrl`""    }
        if ($InstallPath)  { $argList += " -InstallPath `"$InstallPath`""  }
        Start-Process powershell -Verb RunAs -ArgumentList $argList
        exit 0
    } else {
        # Script was pasted into PowerShell — cannot auto-elevate (no file path)
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
    Write-Host "  (Node.js already installed — admin not required)" -ForegroundColor Gray
}

# --- 0. Check PowerShell version ---
Write-Host "Checking PowerShell version..." -ForegroundColor Gray
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
        Write-Host "No version file found in existing install — refreshing to v$ScriptVersion..." -ForegroundColor Cyan
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
        Write-Host "  Could not read version file — refreshing install to be safe..." -ForegroundColor Yellow
        $needsUpdate = $true
    }
}

if ($needsUpdate -and (Test-Path $projectPath)) {
    # Back up clubbers.csv before deleting the project so user data survives the update
    $csvBackupPath   = Join-Path $installDir "clubbers-backup.csv"
    $existingCsvPath = Join-Path $projectPath "print-server\clubbers.csv"
    if (Test-Path $existingCsvPath) {
        Copy-Item $existingCsvPath $csvBackupPath -Force
        Write-Host "  Backed up clubbers.csv (will restore after update)." -ForegroundColor Gray
    }
    Remove-Item $projectPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Old installation removed." -ForegroundColor Gray
}

# --- 3. Download project (if not already present) ---
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

    # Restore any clubbers.csv that was backed up before the update
    $csvBackupPath = Join-Path $installDir "clubbers-backup.csv"
    if (Test-Path $csvBackupPath) {
        $csvRestorePath = Join-Path $printServerPath "clubbers.csv"
        Move-Item $csvBackupPath $csvRestorePath -Force
        Write-Host "✓ Restored your clubbers.csv data." -ForegroundColor Green
    }
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

# --- 3b. Download clubbers.csv from TwoTimTwo or create template ---
# clubbers.csv lives alongside server.js and unlocks enriched labels:
#   - Red allergy strip (NUTS, DAIRY, GLUTEN, EGG, SHELLFISH auto-detected)
#   - "Happy Birthday!" banner for birthdays within the next 7 days
#   - Handbook group line below the club name
# The server re-reads this file on every check-in so you can edit it mid-event.
# If the file is missing or locked the server continues printing basic labels.
$clubbersCsvPath = Join-Path $printServerPath "clubbers.csv"

Write-Host ""
Write-Host "Setting up clubbers.csv..." -ForegroundColor Gray

# Always attempt to download from TwoTimTwo first (fresh data each time)
# This way updates to the roster are picked up on each run
$downloaded = $false
$twotimtwoUrl = "https://kvbchurch.twotimtwo.com/clubber/csv"
try {
    $ProgressPreference = 'SilentlyContinue'
    Write-Host "  Attempting to download from TwoTimTwo..." -ForegroundColor Gray
    $response = Invoke-WebRequest -Uri $twotimtwoUrl -ErrorAction Stop

    # Validate that we actually got CSV data, not an HTML login/error page
    $contentType = $response.Headers['Content-Type']
    $body = $response.Content
    $isHtml = ($contentType -and $contentType -match 'text/html') -or
              ($body -and ($body.TrimStart().StartsWith('<!') -or $body.TrimStart().StartsWith('<html')))

    if ($isHtml) {
        Write-Host "  ⚠ TwoTimTwo returned an HTML page instead of CSV data." -ForegroundColor Yellow
        Write-Host "    (The site may require login, or the URL may have changed.)" -ForegroundColor Yellow
        Write-Host "    Skipping — will use existing/template data instead." -ForegroundColor Yellow
    } elseif (-not $body -or $body.Trim().Length -eq 0) {
        Write-Host "  ⚠ TwoTimTwo returned an empty response — skipping." -ForegroundColor Yellow
    } else {
        # Content looks like CSV — save it
        Set-Content -Path $clubbersCsvPath -Value $body -Encoding UTF8
        $downloaded = $true
        $lineCount = ($body -split "`n" | Where-Object { $_.Trim() }).Count - 1
        Write-Host "  ✓ Downloaded fresh CSV from TwoTimTwo ($lineCount clubber(s))" -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠ Could not download from TwoTimTwo: $($_.Exception.Message)" -ForegroundColor Yellow
}

# Fallback: try GitHub template if TwoTimTwo download fails
if (-not $downloaded) {
    try {
        $ProgressPreference = 'SilentlyContinue'
        $templateUrl = "https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/print-server/clubbers-template.csv"
        Write-Host "  Downloading template from GitHub..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $templateUrl -OutFile $clubbersCsvPath -ErrorAction Stop
        $downloaded = $true
        Write-Host "  ✓ Downloaded template from GitHub" -ForegroundColor Green
    } catch {}
}

# Last resort: write a minimal template inline
if (-not $downloaded) {
    Write-Host "  Writing fallback template..." -ForegroundColor Gray
    @"
FirstName,LastName,Birthdate,Allergies,HandbookGroup
Alice,Smith,2018-03-15,peanut allergy,Cubbies A
Bob,Jones,2019-07-22,,T&T Group B
Carol,White,05/12/2020,dairy and tree nut,Sparks Yellow
"@ | Set-Content $clubbersCsvPath -Encoding UTF8
}

Write-Host "✓ clubbers.csv is ready at:" -ForegroundColor Green
Write-Host "  $clubbersCsvPath" -ForegroundColor Cyan
Write-Host ""
if (-not $downloaded) {
    Write-Host "  NOTE: If this is a template, edit it with your real clubber data:" -ForegroundColor Yellow
    Write-Host "  Columns: FirstName, LastName, Birthdate (YYYY-MM-DD or MM/DD/YYYY)," -ForegroundColor Yellow
    Write-Host "           Allergies (free text), HandbookGroup (free text)" -ForegroundColor Yellow
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
Write-Host "=================================================================================" -ForegroundColor Green
Write-Host "  Setup Complete" -ForegroundColor Green
Write-Host "=================================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Open http://localhost:3456 in your browser" -ForegroundColor Gray
Write-Host "  2. Click 'Create Bookmarklet'" -ForegroundColor Gray
Write-Host "  3. Drag the button to your bookmark bar" -ForegroundColor Gray
Write-Host "  4. Visit the check-in page and click the bookmark" -ForegroundColor Gray
Write-Host ""
Write-Host "  Optional — for enriched labels (allergy alerts, birthday banners):" -ForegroundColor Gray
Write-Host "  Edit clubbers.csv in: $printServerPath" -ForegroundColor Cyan
Write-Host "  Replace the example rows with your real clubber data." -ForegroundColor Gray
Write-Host ""
Write-Host "Opening check-in page in Microsoft Edge..." -ForegroundColor Cyan
Start-Process "msedge" -ArgumentList $cfg.checkinUrl

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
        Write-Host "  ✓ Old server stopped." -ForegroundColor Green
    } else {
        Write-Host "  ✓ Port is free." -ForegroundColor Green
    }
} catch {
    Write-Host "  ⚠ Could not check port (non-critical): $_" -ForegroundColor Yellow
}

# Save the script version for future updates
try {
    Set-Content -Path $versionFile -Value $ScriptVersion -Force -ErrorAction SilentlyContinue
} catch {
    # Silently ignore version file write errors
}

$env:PRINTER_NAME = $cfg.printerName
Set-Location $printServerPath
node server.js
