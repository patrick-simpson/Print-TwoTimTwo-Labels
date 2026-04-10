'use strict';

// In-memory roster cache: loads `clubbers.csv` from disk, re-reads it on
// every print request so mid-event additions are picked up automatically.
// Gracefully handles every failure mode (missing file, EBUSY during write,
// malformed rows) so a bad roster never crashes the server — the caller
// just gets an empty array and falls back to a basic label.

const fs   = require('fs');
const path = require('path');
const { parseCSV } = require('./csv');
const log  = require('./log').make('roster');

function resolveCsvPath() {
  if (process.env.CLUBBERS_CSV) return path.resolve(process.env.CLUBBERS_CSV);
  return path.join(__dirname, '..', 'clubbers.csv');
}

function load() {
  const csvPath = resolveCsvPath();
  try {
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(raw);
    if (rows.length > 0) {
      const keys = Object.keys(rows[0]);
      const has = (k) => keys.includes(k) ? k : null;
      const detected = [has('FirstName'), has('LastName'), has('Birthdate'), has('HandbookGroup'), has('Allergies'), has('Notes')].filter(Boolean);
      log.info(`Loaded ${rows.length} clubber(s) (columns: ${detected.join(', ')})`);
    } else {
      log.warn('clubbers.csv is empty or has no data rows');
    }
    return rows;
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.warn('clubbers.csv not found — running without enrichment data');
    } else if (err.code === 'EBUSY') {
      log.warn('clubbers.csv is busy (being written) — skipping reload');
    } else {
      log.warn(`Failed to read/parse clubbers.csv: ${err.message}`);
    }
    return [];
  }
}

function write(csvText) {
  const csvPath = resolveCsvPath();
  const tmp = csvPath + '.tmp';
  fs.writeFileSync(tmp, csvText, 'utf8');
  fs.renameSync(tmp, csvPath);
  const rows = parseCSV(csvText);
  log.info(`Updated clubbers.csv from browser (${rows.length} clubber(s))`);
  return rows;
}

module.exports = { load, write, resolveCsvPath };
