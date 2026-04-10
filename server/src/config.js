'use strict';

// Server configuration is a single JSON file next to server.js.
// Precedence on read: config.json on disk → env vars → hard-coded defaults.
// All writes go through save() which atomically replaces config.json.

const fs   = require('fs');
const path = require('path');
const log  = require('./log').make('config');

const DEFAULT_PORT = 3456;

function resolveConfigPath() {
  // Priority: CONFIG_FILE env var → next to server.js
  if (process.env.CONFIG_FILE) return path.resolve(process.env.CONFIG_FILE);
  return path.join(__dirname, '..', 'config.json');
}

function load() {
  const file = resolveConfigPath();
  let disk = {};
  try {
    if (fs.existsSync(file)) {
      disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    log.warn(`Failed to read ${file}: ${err.message}`);
  }
  return {
    printerName: disk.printerName || process.env.PRINTER_NAME || '',
    port:        Number(disk.port || process.env.PORT || DEFAULT_PORT),
    checkinUrl:  disk.checkinUrl  || process.env.CHECKIN_URL  || '',
  };
}

function save(patch) {
  const file = resolveConfigPath();
  const current = load();
  const next = { ...current };
  if (patch.printerName !== undefined) next.printerName = patch.printerName;
  if (patch.port        !== undefined) next.port        = Number(patch.port);
  if (patch.checkinUrl  !== undefined) next.checkinUrl  = patch.checkinUrl;

  // Atomic write: tmp file → rename. Avoids a half-written config.json if
  // the process is killed mid-write (event-night power outage, etc).
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  log.info(`Saved config to ${file}`);
  return next;
}

module.exports = { load, save, resolveConfigPath, DEFAULT_PORT };
