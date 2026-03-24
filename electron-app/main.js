const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Single instance lock — prevent two copies of the server running on port 3456
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const PORT = 3456;
const isDev = process.env.NODE_ENV === 'development';

let tray = null;
let setupWindow = null;
let pdfWindow = null;  // hidden window used for printToPDF
let serverInstance = null;

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
    height: 500,
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

  tray.setToolTip(`Awana Label Printer  •  ${config.printerName}`);

  const menu = Menu.buildFromTemplate([
    { label: 'Awana Label Printer', enabled: false },
    { label: `Printer: ${config.printerName}`, enabled: false },
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
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => createSetupWindow());
}

// ─── Print server ─────────────────────────────────────────────────────────────

function startServer(config) {
  if (serverInstance) {
    serverInstance.close();
    serverInstance = null;
  }
  const createServer = require('./src/server');
  serverInstance = createServer(config.printerName, pdfWindow, PORT);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('ping-server', () => {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(`http://localhost:${PORT}/health`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
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

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.setAppUserModelId('com.kvbc.awana-label-printer');

app.whenReady().then(() => {
  createPdfWindow();

  const config = loadConfig();
  if (!config || !config.printerName) {
    // First run — show setup wizard
    createSetupWindow();
  } else {
    // Already configured — go straight to tray and open browser
    startServer(config);
    buildTray(config);
    shell.openExternal(config.checkinUrl);
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
