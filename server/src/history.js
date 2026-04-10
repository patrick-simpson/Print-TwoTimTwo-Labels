'use strict';

// Print history: small ring-buffer persisted to print-history.json. Used
// by the dashboard and by /reprint. Every operation is wrapped in
// try/catch and fails soft — a corrupt history file must never block a
// live print.

const fs   = require('fs');
const path = require('path');
const log  = require('./log').make('history');

const HISTORY_FILE = path.join(__dirname, '..', 'print-history.json');
const MAX_HISTORY  = 200;

function load() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (err) {
    log.warn(`Failed to load history: ${err.message}`);
  }
  return [];
}

function save(entries) {
  try {
    const tmp = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
    fs.renameSync(tmp, HISTORY_FILE);
  } catch (err) {
    log.warn(`Failed to save history: ${err.message}`);
  }
}

function add(entry) {
  const entries = load();
  entries.unshift({
    firstName:     entry.firstName,
    lastName:      entry.lastName,
    clubName:      entry.clubName || '',
    clubImageData: entry.clubImageData || null,
    printer:       entry.printer || '',
    success:       entry.success,
    timestamp:     new Date().toISOString(),
  });
  if (entries.length > MAX_HISTORY) entries.length = MAX_HISTORY;
  save(entries);
  return entries;
}

function today() {
  const prefix = new Date().toISOString().slice(0, 10);
  return load().filter(e => e.timestamp && e.timestamp.startsWith(prefix));
}

module.exports = { load, add, today, HISTORY_FILE };
