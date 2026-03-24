const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');

// Single instance lock — prevent two copies running on port 3456
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const PORT = 3456;
const isDev = process.env.NODE_ENV === 'development';

let tray          = null;
let setupWindow   = null;
let checkinWindow = null;
let pdfWindow     = null;
let serverInstance = null;

// ── Config helpers ─────────────────────────────────────────────────────────

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return null; }
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── Icon ───────────────────────────────────────────────────────────────────

function getIconPath() {
  const p = path.join(__dirname, 'build', 'icon.png');
  return fs.existsSync(p) ? p : null;
}

// ── Hidden PDF-render window ───────────────────────────────────────────────

function createPdfWindow() {
  pdfWindow = new BrowserWindow({
    show: false, width: 400, height: 200,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  pdfWindow.loadURL('about:blank');
}

// ── Setup / settings window ────────────────────────────────────────────────

function createSetupWindow() {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 520, height: 500, resizable: false,
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

// ── Check-in window (replaces opening an external browser) ────────────────

// Load the detector script once at startup
const CHECKIN_SCRIPT = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, 'src', 'checkin-script.js'), 'utf8');
  } catch (e) {
    console.error('Could not load checkin-script.js:', e.message);
    return '';
  }
})();

function injectCheckinScript(webContents) {
  if (!CHECKIN_SCRIPT) return;
  webContents.executeJavaScript(CHECKIN_SCRIPT).catch((err) => {
    console.warn('Script injection failed:', err.message);
  });
}

function createCheckinWindow(config) {
  if (checkinWindow && !checkinWindow.isDestroyed()) {
    checkinWindow.focus();
    return;
  }

  checkinWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Awana Check-in',
    icon: getIconPath() || undefined,
    webPreferences: {
      // No preload — we inject via executeJavaScript after each page load
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  checkinWindow.loadURL(config.checkinUrl);

  // Inject on every navigation so the script survives page refreshes
  checkinWindow.webContents.on('did-finish-load', () => {
    injectCheckinScript(checkinWindow.webContents);
  });

  checkinWindow.on('closed', () => { checkinWindow = null; });
}

// ── Tray ───────────────────────────────────────────────────────────────────

function buildTray(config) {
  const iconPath = getIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  if (!tray) tray = new Tray(icon);
  else tray.setImage(icon);

  tray.setToolTip(`Awana Label Printer  •  ${config.printerName}`);

  const menu = Menu.buildFromTemplate([
    { label: 'Awana Label Printer', enabled: false },
    { label: `Printer: ${config.printerName}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Check-in Window', click: () => createCheckinWindow(config) },
    { label: 'Settings',             click: () => createSetupWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (checkinWindow && !checkinWindow.isDestroyed()) checkinWindow.focus();
    else createCheckinWindow(config);
  });
}

// ── Print server ───────────────────────────────────────────────────────────

function startServer(config) {
  if (serverInstance) { serverInstance.close(); serverInstance = null; }
  const createServer = require('./src/server');
  serverInstance = createServer(config.printerName, pdfWindow, PORT);
}

// ── IPC handlers ───────────────────────────────────────────────────────────

ipcMain.handle('ping-server', () => {
  return new Promise((resolve) => {
    const http = require('http');
    const req  = http.get(`http://localhost:${PORT}/health`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
});

ipcMain.handle('get-printers', async () => {
  try {
    const printers = await pdfWindow.webContents.getPrintersAsync();
    return printers.map(p => ({ name: p.name, isDefault: p.isDefault }));
  } catch { return []; }
});

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (event, config) => {
  saveConfig(config);
  startServer(config);
  buildTray(config);
  // Close the setup wizard then open the check-in window
  setTimeout(() => {
    if (setupWindow) setupWindow.close();
    createCheckinWindow(config);
  }, 600);
  return { success: true };
});

// Keep this handler so the Settings UI "Open Check-in Page" button still works
ipcMain.handle('open-checkin-page', (event, url) => {
  const config = loadConfig();
  if (config) createCheckinWindow(config);
});

// ── App lifecycle ──────────────────────────────────────────────────────────

app.setAppUserModelId('com.kvbc.awana-label-printer');

app.whenReady().then(() => {
  createPdfWindow();

  const config = loadConfig();
  if (!config || !config.printerName) {
    createSetupWindow();
  } else {
    startServer(config);
    buildTray(config);
    createCheckinWindow(config);   // open the built-in window instead of external browser
  }
});

app.on('second-instance', () => {
  if (checkinWindow && !checkinWindow.isDestroyed()) checkinWindow.focus();
  else createSetupWindow();
});

app.on('window-all-closed', () => {
  if (!app.isQuitting) { /* app lives in tray */ }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverInstance) serverInstance.close();
  if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy();
});
