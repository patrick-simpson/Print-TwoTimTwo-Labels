const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const { execFileSync } = require('child_process');
const { runMigration, removeShortcuts } = require('./src/migrate');

// Single instance lock — prevent two copies of the server running on port 3456
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// The print server writes its data (config.json, clubbers.csv, history…) to
// AWANA_DATA_DIR. A packaged app must never write inside resources/, so point
// it at userData BEFORE the server module is ever required.
process.env.AWANA_DATA_DIR = app.getPath('userData');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const PORT = 3456;
const isDev = process.env.NODE_ENV === 'development';
const isAutoStart = process.argv.includes('--auto-start');
const FIREWALL_RULE = 'Awana Print Server (TCP 3456)';

let tray = null;
let setupWindow = null;
let pdfWindow = null;  // hidden window used for printer enumeration
let serverInstance = null;
let serverModule = null;
let currentConfig = null;
// Surfaced in the tray and settings window — a broken server must be SEEN,
// never silently degraded (the old slim-fallback path hid exactly this).
let serverState = { status: 'starting', error: null };
let updateState = { available: null, downloaded: null };

// ─── Config helpers ─────────────────────────────────────────────────────────

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── Auto-launch on boot ─────────────────────────────────────────────────────

function applyLoginItemSettings(config) {
  // Skip in dev — it would register the bare electron.exe as a login item.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: config.launchOnBoot !== false,
    args: ['--auto-start'],
  });
}

// ─── Auto-update (electron-updater + GitHub Releases) ────────────────────────

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (e) {
  console.warn('[update] electron-updater unavailable:', e.message);
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;  // never force a restart mid-club-night

  autoUpdater.on('update-available', (info) => {
    updateState.available = info.version;
    if (serverModule && serverModule.setLatestVersion) serverModule.setLatestVersion(info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState.downloaded = info.version;
    if (currentConfig) buildTray(currentConfig);  // adds "Restart to update"
  });
  autoUpdater.on('error', (e) => console.warn('[update] ', e && e.message));

  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline is fine */ });
  check();
  setInterval(check, 6 * 3600000);
}

function installUpdateNow() {
  if (!autoUpdater) return;
  if (updateState.downloaded) {
    app.isQuitting = true;
    autoUpdater.quitAndInstall();
  } else {
    // Not downloaded yet — kick a check; quitAndInstall once it lands.
    autoUpdater.once('update-downloaded', () => {
      app.isQuitting = true;
      autoUpdater.quitAndInstall();
    });
    autoUpdater.checkForUpdates().catch(() => { /* offline */ });
  }
}

// ─── Windows ─────────────────────────────────────────────────────────────────

function getIconPath() {
  const p = path.join(__dirname, 'build', 'icon.png');
  return fs.existsSync(p) ? p : null;
}

function createPdfWindow() {
  pdfWindow = new BrowserWindow({
    show: false,
    width: 400,
    height: 200,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  pdfWindow.loadURL('about:blank');
}

function createSetupWindow() {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: 'Awana Label Printer',
    icon: getIconPath() || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    setupWindow.loadURL('http://localhost:5173');
  } else {
    setupWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  setupWindow.on('closed', () => { setupWindow = null; });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function buildTray(config) {
  const iconPath = getIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  if (!tray) {
    tray = new Tray(icon);
  } else {
    tray.setImage(icon);
  }

  const failed = serverState.status === 'failed';
  tray.setToolTip(failed
    ? 'Awana Label Printer  •  SERVER FAILED — click for details'
    : `Awana Label Printer  •  ${config.printerName}`);

  const template = [
    { label: 'Awana Label Printer', enabled: false },
    failed
      ? { label: '⚠ Print server FAILED — open Settings', click: () => createSetupWindow() }
      : { label: `Printer: ${config.printerName}`, enabled: false },
    { label: `Server: http://localhost:${PORT}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Check-in Page',
      click: () => shell.openExternal(config.checkinUrl)
    },
    {
      label: 'Settings',
      click: () => createSetupWindow()
    },
  ];

  if (updateState.downloaded) {
    template.push({ type: 'separator' });
    template.push({
      label: `Restart to update to v${updateState.downloaded}`,
      click: () => installUpdateNow()
    });
  } else if (autoUpdater && app.isPackaged) {
    template.push({ type: 'separator' });
    template.push({
      label: 'Check for updates',
      click: () => autoUpdater.checkForUpdates().catch(() => { /* offline */ })
    });
  }

  template.push({ type: 'separator' });
  template.push({
    label: 'Quit',
    click: () => {
      app.isQuitting = true;
      app.quit();
    }
  });

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on('click', () => createSetupWindow());
}

// ─── Port conflict handling ──────────────────────────────────────────────────
// A legacy script install's Startup shortcut (launch-awana.bat) races this app
// for port 3456 on boot. Detect the squatter, name it, and offer a one-click
// stop — the old behaviour was five silent retries and then nothing.

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

function findPortOwner(port) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `
      $c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($c) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue).ParentProcessId
        @{ pid = $c.OwningProcess; name = $p.ProcessName; parentPid = $parent } | ConvertTo-Json -Compress
      }
    `], { timeout: 10000, windowsHide: true }).toString().trim();
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

function stopPortOwner(owner) {
  try {
    // Kill the process tree. If the parent is the legacy launch-awana.bat
    // restart loop (cmd.exe), kill that tree instead or it respawns the
    // server three seconds later.
    let rootPid = owner.pid;
    if (owner.parentPid) {
      try {
        const parentName = execFileSync('powershell', ['-NoProfile', '-Command',
          `(Get-Process -Id ${owner.parentPid} -ErrorAction SilentlyContinue).ProcessName`
        ], { timeout: 10000, windowsHide: true }).toString().trim();
        if (parentName === 'cmd') rootPid = owner.parentPid;
      } catch { /* parent gone — kill the node pid */ }
    }
    execFileSync('taskkill', ['/PID', String(rootPid), '/T', '/F'], { timeout: 10000, windowsHide: true });
    return true;
  } catch (e) {
    console.warn('[port] Could not stop process:', e.message);
    return false;
  }
}

async function resolvePortConflict() {
  if (process.platform !== 'win32') return;
  if (await isPortFree(PORT)) return;
  const owner = findPortOwner(PORT);
  const desc = owner ? `${owner.name} (PID ${owner.pid})` : 'another program';
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Port 3456 is in use',
    message: `The print server's port is being used by ${desc}.`,
    detail: 'This is usually a previous Awana print server still running (for example the old desktop shortcut\'s auto-start). Stop it so this app can take over?',
    buttons: ['Stop it and continue', 'Continue anyway'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0 && owner) {
    stopPortOwner(owner);
    // Give the OS a moment to release the socket; the server also retries.
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ─── Print server ─────────────────────────────────────────────────────────────

function startServer(config) {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
  // The FULL print server (roster enrichment, dedup, history, Pusher event
  // bus, phone check-in) is the ONLY server. @napi-rs/canvas ships prebuilt
  // N-API binaries, so the old "native module didn't load" failure mode is
  // gone — and if the server still fails, we show it loudly instead of
  // silently degrading to a feature-poor fallback like pre-5.0 builds did.
  try {
    const fullServerDir = app.isPackaged
      ? path.join(process.resourcesPath, 'print-server')
      : path.join(__dirname, '..', 'print-server');
    const fullServerPath = path.join(fullServerDir, 'server.js');
    if (config.printerName) process.env.PRINTER_NAME = config.printerName;
    serverModule = require(fullServerPath);
    serverModule.setUpdateHandler(() => installUpdateNow());
    if (updateState.available) serverModule.setLatestVersion(updateState.available);
    serverInstance = serverModule.startListening();
    serverState = { status: 'running', error: null };
    console.log('[server] Print server started from', fullServerDir);
  } catch (e) {
    serverState = { status: 'failed', error: `${e.message}\n${e.stack || ''}` };
    console.error('[server] Print server failed to start:', e);
    dialog.showErrorBox(
      'Awana Label Printer — server failed to start',
      'Labels canNOT print until this is fixed.\n\n' + e.message +
      '\n\nPlease send a screenshot of this message to your administrator.'
    );
  }
  if (currentConfig) buildTray(currentConfig);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-printers', async () => {
  try {
    // Use Electron's built-in printer enumeration — no subprocess, always works
    const printers = await pdfWindow.webContents.getPrintersAsync();
    return printers.map(p => ({ name: p.name, isDefault: p.isDefault }));
  } catch {
    return [];
  }
});

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (event, config) => {
  saveConfig(config);
  currentConfig = config;
  applyLoginItemSettings(config);
  startServer(config);
  buildTray(config);
  // Close wizard shortly after so the renderer can show a success state
  setTimeout(() => {
    if (setupWindow) setupWindow.close();
    shell.openExternal(config.checkinUrl);
  }, 600);
  return { success: true };
});

ipcMain.handle('open-checkin-page', (event, url) => {
  shell.openExternal(url);
});

ipcMain.handle('get-server-state', () => ({
  ...serverState,
  version: app.getVersion(),
  update: updateState,
}));

ipcMain.handle('get-lan-address', () => {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
});

// Phone check-in needs inbound TCP 3456 open. The per-user installer can't
// add a firewall rule silently; this runs the (idempotent) rule add with a
// UAC prompt when the user asks for it from Settings.
ipcMain.handle('enable-phone-checkin', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const cmd = `if (-not (Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow -Profile Private,Domain | Out-Null }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',"${cmd.replace(/"/g, '\\"')}"`
    ], { timeout: 60000, windowsHide: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Firewall rule was not added (administrator approval declined?)' };
  }
});

ipcMain.handle('install-update', () => { installUpdateNow(); return { ok: true }; });

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.setAppUserModelId('com.kvbc.awana-label-printer');

app.whenReady().then(async () => {
  createPdfWindow();
  setupAutoUpdater();

  // Import data from a legacy script install (C:\output) before anything
  // reads config — makes .exe-over-script upgrades seamless.
  const migration = runMigration(app.getPath('userData'));

  await resolvePortConflict();

  const config = loadConfig();
  currentConfig = config;
  if (!config || !config.printerName) {
    // First run — show setup wizard (prefilled from legacy config if migrated)
    createSetupWindow();
  } else {
    // Already configured — go straight to tray
    applyLoginItemSettings(config);
    startServer(config);
    buildTray(config);
    // On login-item auto-start stay silent; only open the browser when a
    // person launched the app.
    if (!isAutoStart) shell.openExternal(config.checkinUrl);
  }

  // Legacy shortcuts re-launch the old script install on every boot and fight
  // this app for port 3456 — offer to remove them once.
  if (migration.shortcuts.length && (migration.migrated || migration.legacyDir)) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Old install found',
      message: 'Remove the old "Awana Check In" shortcuts?',
      detail: 'Your roster and settings were imported. The old desktop/startup shortcuts still point at the previous script-based install and can cause port conflicts:\n\n' + migration.shortcuts.join('\n'),
      buttons: ['Remove old shortcuts', 'Keep them'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) removeShortcuts(migration.shortcuts);
  }
});

app.on('second-instance', () => createSetupWindow());

// Keep process alive for the tray when all windows are closed
app.on('window-all-closed', () => {
  if (!app.isQuitting) {
    // intentionally do nothing — app lives in tray
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverInstance) serverInstance.close();
  if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy();
});
