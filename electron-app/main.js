const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const os = require('os');
const { execFileSync } = require('child_process');
const { runMigration, removeShortcuts } = require('./src/migrate');
const configStore = require('./src/config-store');
const extensionSync = require('./src/extension-sync');

// ── Safe external opens ───────────────────────────────────────────────────────
// shell.openExternal() hands its argument to the OS handler, so on Windows a
// non-http scheme can launch a local program. config.checkinUrl reaches it from
// three call sites below, and POST /config used to accept that value from any
// caller with no validation — a poisoned config.json was therefore an arbitrary
// URI aimed at the shell.
//
// The server now refuses to PERSIST an unsafe checkinUrl (see
// security.isSafeExternalUrl in print-server/security.js). This is the second
// half of that fix: validate again at the sink, because a config.json can also
// be edited by hand or arrive from an older install. Deliberately implemented
// locally rather than requiring the server module — these calls can run before
// the server has loaded (or when it failed to start entirely).
function isSafeExternalUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > 2048) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

function openExternalSafely(value, context) {
  if (!isSafeExternalUrl(value)) {
    console.error(`[security] Refusing to open unsafe URL from ${context}:`, value);
    dialog.showErrorBox(
      'Awana Label Printer — blocked link',
      'The configured check-in address is not a valid web address, so it was not opened.\n\n'
      + 'Open Settings and set the check-in page URL (it should start with https://).'
    );
    return false;
  }
  shell.openExternal(value);
  return true;
}

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
// Full update lifecycle, surfaced in the tray AND the settings window so
// "is this thing updating itself?" is answerable at a glance:
//   checking → available (downloading, percent) → downloaded (restart to apply)
// upToDate is set by an explicit check that found nothing, so the UI can say
// "✓ up to date" instead of silently doing nothing.
let updateState = { checking: false, available: null, downloaded: null, percent: null, upToDate: false };
// The managed copy of the Chrome extension — see src/extension-sync.js. Filled
// in once at startup and then reported verbatim to the tray, the settings
// window and /health, so the folder the operator must load unpacked is never
// something they have to go hunting for.
let extensionState = { action: 'skipped', version: null, targetDir: null };

// ─── Chrome extension ────────────────────────────────────────────────────────

// One stable path, deliberately NOT inside resources/: an app update replaces
// resources/ wholesale, and Chrome would be left pointing at a folder that
// vanished. userData survives every update and every uninstall-reinstall.
const EXTENSION_DIR = path.join(app.getPath('userData'), 'chrome-extension');

function syncBundledExtension() {
  const sourceDir = app.isPackaged
    ? path.join(process.resourcesPath, 'chrome-extension')
    : path.join(__dirname, '..', 'chrome-extension');
  extensionState = extensionSync.syncExtension({ sourceDir, targetDir: EXTENSION_DIR });
  const { action, version, error } = extensionState;
  if (error) {
    console.warn(`[extension] ${action}: ${error}`);
  } else {
    console.log(`[extension] ${action} v${version} at ${EXTENSION_DIR}`);
  }
  return extensionState;
}

// ─── Config helpers ─────────────────────────────────────────────────────────

// Both delegate to src/config-store.js — see the long comment there for why a
// write MUST be a merge rather than a whole-file replace. Kept as thin local
// wrappers so the many call sites don't each have to thread CONFIG_PATH.
const loadConfig = () => configStore.loadConfig(CONFIG_PATH);
const saveConfig = (patch) => configStore.saveConfig(CONFIG_PATH, patch);

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

// Rebuild the tray to reflect current server/update state. Safe to call from
// any event handler: no-ops until the initial buildTray has run.
function refreshTray() {
  if (tray && currentConfig) buildTray(currentConfig);
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;  // never force a restart mid-club-night

  autoUpdater.on('checking-for-update', () => {
    updateState.checking = true;
    refreshTray();
  });
  autoUpdater.on('update-available', (info) => {
    updateState.checking = false;
    updateState.available = info.version;
    updateState.upToDate = false;
    if (serverModule && serverModule.setLatestVersion) serverModule.setLatestVersion(info.version);
    refreshTray();  // shows "Downloading update vX…"
  });
  autoUpdater.on('update-not-available', () => {
    updateState.checking = false;
    updateState.available = null;
    updateState.upToDate = true;
    refreshTray();  // shows "✓ Up to date"
  });
  autoUpdater.on('download-progress', (p) => {
    // Settings window polls this via get-server-state; no tray rebuild per tick.
    updateState.percent = Math.round(p.percent || 0);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState.checking = false;
    updateState.downloaded = info.version;
    refreshTray();  // adds "Restart to update"
  });
  autoUpdater.on('error', (e) => {
    updateState.checking = false;
    console.warn('[update] ', e && e.message);
    refreshTray();
  });

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
    ? 'Awana Label Printer  •  SERVER NOT RUNNING — click to start it'
    : `Awana Label Printer  •  ${config.printerName || 'system default printer'}`);

  const template = [
    { label: `Awana Label Printer v${app.getVersion()}`, enabled: false },
    failed
      ? { label: '⚠ Print server NOT RUNNING — open Settings', click: () => createSetupWindow() }
      : { label: `Printer: ${config.printerName || '(system default)'}`, enabled: false },
    { label: `Server: http://localhost:${PORT}`, enabled: false },
    { type: 'separator' },
    {
      // The easy button. When the server is down this (re)starts it in one
      // click; when it's up, it's a harmless restart for "when in doubt".
      label: failed ? '▶ Start print server' : 'Restart print server',
      click: () => startServer(currentConfig || loadConfig() || {})
    },
  ];
  if (config.checkinUrl) {
    template.push({
      label: 'Open Check-in Page',
      click: () => openExternalSafely(config.checkinUrl, 'tray menu')
    });
  }
  template.push({
    label: config.printerName ? 'Settings' : 'Finish Setup…',
    click: () => createSetupWindow()
  });
  if (extensionState.targetDir && extensionState.action !== 'skipped') {
    template.push({
      // "Load unpacked" wants a folder, and a folder is exactly the thing a
      // file dialog is worst at finding. Open it in Explorer so the operator
      // can drag it onto the dialog or paste the path from the title bar.
      label: 'Open Chrome extension folder',
      click: () => shell.openPath(extensionState.targetDir)
    });
  }

  // Update status: always show exactly where the auto-updater is.
  if (autoUpdater && app.isPackaged) {
    template.push({ type: 'separator' });
    if (updateState.downloaded) {
      template.push({
        label: `⬇ Restart to update to v${updateState.downloaded}`,
        click: () => installUpdateNow()
      });
    } else if (updateState.available) {
      template.push({ label: `Downloading update v${updateState.available}…`, enabled: false });
    } else if (updateState.checking) {
      template.push({ label: 'Checking for updates…', enabled: false });
    } else {
      template.push({
        label: updateState.upToDate ? `✓ Up to date — check again` : 'Check for updates',
        click: () => autoUpdater.checkForUpdates().catch(() => { /* offline */ })
      });
    }
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
    // The require cache keeps this module alive across restarts, so its
    // load-time state (printer name from env, config.json snapshot) goes
    // stale the moment settings change — and is EMPTY when the server starts
    // before first-time setup. Push the current truth into the live module.
    if (serverModule.setPrinterName) serverModule.setPrinterName(config.printerName || '');
    if (serverModule.applySavedConfig) serverModule.applySavedConfig(loadConfig() || {});
    serverModule.setUpdateHandler(() => installUpdateNow());
    if (updateState.available) serverModule.setLatestVersion(updateState.available);
    if (serverModule.setExtensionInfo) serverModule.setExtensionInfo(extensionState);
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

// True when something is actually answering on the server port — the ground
// truth "is it running?", regardless of what this process thinks it started.
function probeServer(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/health', timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Launching the app is the operator's "make it work" gesture — every entry
// point (fresh launch, second launch via the desktop shortcut, the Start
// Server button) funnels through here: if nothing answers on the port, start
// the server.
async function ensureServerRunning(context) {
  if (await probeServer()) return true;
  console.log(`[server] Nothing answering on port ${PORT} (${context}) — starting the print server.`);
  startServer(currentConfig || loadConfig() || {});
  return false;
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

ipcMain.handle('save-config', (event, patch) => {
  // Act on the MERGED config, not the renderer's patch — startServer needs the
  // Pusher credentials and the PIN, and buildTray needs the printer name, none
  // of which the setup wizard sends.
  const config = saveConfig(patch);
  currentConfig = config;
  applyLoginItemSettings(config);
  startServer(config);
  buildTray(config);
  // Close wizard shortly after so the renderer can show a success state
  setTimeout(() => {
    if (setupWindow) setupWindow.close();
    openExternalSafely(config.checkinUrl, 'setup wizard');
  }, 600);
  // Hand back the merged config so the renderer's state matches what is on
  // disk rather than the partial patch it sent.
  return { success: true, config };
});

ipcMain.handle('open-checkin-page', (event, url) => {
  // Renderer-supplied URL: same validation, same reason.
  openExternalSafely(url, 'open-checkin-page IPC');
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

ipcMain.handle('get-extension-info', () => ({ ...extensionState }));

ipcMain.handle('open-extension-folder', () => {
  if (!extensionState.targetDir) return { ok: false, error: 'no managed extension folder' };
  shell.openPath(extensionState.targetDir);
  return { ok: true, path: extensionState.targetDir };
});

// The Settings window's "Start Server" button. Unconditional restart rather
// than probe-first: the person clicking it believes the server is down, and a
// restart of a healthy server is cheap and harmless.
ipcMain.handle('start-server', () => {
  startServer(currentConfig || loadConfig() || {});
  return { ...serverState };
});

// Explicit update check with a real answer. checkForUpdates() resolves after
// the feed is fetched, so the event handlers above have already stamped
// updateState by the time we return it.
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater || !app.isPackaged) {
    return { supported: false, ...updateState };
  }
  updateState.upToDate = false;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    updateState.checking = false;  // offline — leave upToDate false, no lie
  }
  return { supported: true, ...updateState };
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.setAppUserModelId('com.kvbc.awana-label-printer');

app.whenReady().then(async () => {
  createPdfWindow();
  setupAutoUpdater();

  // Import data from a legacy script install (C:\output) before anything
  // reads config — makes .exe-over-script upgrades seamless.
  const migration = runMigration(app.getPath('userData'));

  await resolvePortConflict();

  // Before the server starts, so the very first /health already reports the
  // folder and version. An update landed this launch; the operator should be
  // told about the owed Chrome restart from the moment the page loads.
  syncBundledExtension();

  const config = loadConfig() || {};
  currentConfig = config;

  // The server starts on EVERY launch — including the very first one, before
  // setup has been completed. Pre-5.5 the server didn't exist until the
  // wizard was saved, so "I installed it and nothing is listening" was the
  // designed behaviour. Without a configured printer it prints to the system
  // default until the wizard save restarts it with the chosen one.
  applyLoginItemSettings(config);
  startServer(config);
  buildTray(config);

  if (!config.printerName) {
    // First run — show setup wizard (prefilled from legacy config if migrated)
    createSetupWindow();
  } else if (!isAutoStart) {
    // On login-item auto-start stay silent; only open the browser when a
    // person launched the app.
    openExternalSafely(config.checkinUrl, 'startup');
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

app.on('second-instance', () => {
  // The operator double-clicked the shortcut while the app was already in the
  // tray — almost always because "it isn't printing". Make sure the server is
  // actually up, not just assumed up, then show the window.
  ensureServerRunning('app relaunched');
  createSetupWindow();
});

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
