// First-run migration from a legacy script install (install-and-run.ps1).
//
// Legacy installs live at C:\output\Print-TwoTimTwo-Labels with writable data
// (config.json, clubbers.csv, history, attendance) inside print-server/. The
// packaged app keeps its data in userData instead, so on first run we copy
// the church's data across and report any legacy shortcuts so main.js can
// offer to remove them (the old Startup shortcut would otherwise race this
// app for port 3456 on every boot).

'use strict';

const fs = require('fs');
const path = require('path');

const LEGACY_SERVER_DIRS = [
  'C:\\output\\Print-TwoTimTwo-Labels\\print-server',
];

// Files worth carrying over — roster, config, and night-history state.
const DATA_FILES = [
  'config.json',
  'clubbers.csv',
  'attendance.json',
  'print-history.json',
  'events-buffer.json',
  'church-config.json',
];

const SHORTCUT_NAMES = ['Awana Check In.lnk', 'Awana Print.lnk'];

function findLegacyShortcuts() {
  const found = [];
  const home = process.env.USERPROFILE || '';
  const appData = process.env.APPDATA || '';
  const candidates = [];
  if (home) candidates.push(path.join(home, 'Desktop'));
  if (appData) candidates.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'));
  for (const dir of candidates) {
    for (const name of SHORTCUT_NAMES) {
      const p = path.join(dir, name);
      try { if (fs.existsSync(p)) found.push(p); } catch { /* ignore */ }
    }
  }
  return found;
}

// Copies legacy data into dataDir (never overwriting anything already there)
// and returns what it found. Safe to call on every boot — it becomes a no-op
// once the marker file exists or there is no legacy install.
function runMigration(dataDir) {
  const result = { migrated: false, copied: [], legacyConfig: null, legacyDir: null, shortcuts: [] };
  if (process.platform !== 'win32') return result;

  const marker = path.join(dataDir, '.migrated-from-script-install');
  result.shortcuts = findLegacyShortcuts();
  if (fs.existsSync(marker)) return result;

  const legacyDir = LEGACY_SERVER_DIRS.find((d) => {
    try { return fs.existsSync(d); } catch { return false; }
  });
  if (!legacyDir) return result;
  result.legacyDir = legacyDir;

  fs.mkdirSync(dataDir, { recursive: true });
  for (const name of DATA_FILES) {
    const src = path.join(legacyDir, name);
    const dest = path.join(dataDir, name);
    try {
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        result.copied.push(name);
      }
    } catch (e) {
      // A locked or unreadable file must not abort the rest of the migration.
      console.warn(`[migrate] Could not copy ${name}:`, e.message);
    }
  }

  try {
    result.legacyConfig = JSON.parse(fs.readFileSync(path.join(legacyDir, 'config.json'), 'utf8'));
  } catch { /* no legacy config — wizard starts blank */ }

  try { fs.writeFileSync(marker, new Date().toISOString()); } catch { /* best-effort */ }
  result.migrated = result.copied.length > 0 || !!result.legacyConfig;
  if (result.migrated) {
    console.log(`[migrate] Imported legacy data from ${legacyDir}: ${result.copied.join(', ') || '(config only)'}`);
  }
  return result;
}

function removeShortcuts(paths) {
  const removed = [];
  for (const p of paths) {
    try { fs.unlinkSync(p); removed.push(p); } catch (e) { console.warn('[migrate] Could not remove', p, e.message); }
  }
  return removed;
}

module.exports = { runMigration, removeShortcuts, findLegacyShortcuts };
