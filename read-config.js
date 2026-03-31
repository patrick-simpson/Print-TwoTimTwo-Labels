// read-config.js — Prints config values for batch consumption
// Used by launch-awana.bat to read config.json without PowerShell
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, 'Print-TwoTimTwo-Labels', 'print-server', 'config.json');

try {
  const raw = fs.readFileSync(configPath, 'utf8');
  const cfg = JSON.parse(raw);
  console.log('PRINTER_NAME=' + (cfg.printerName || ''));
  console.log('CHECKIN_URL=' + (cfg.checkinUrl || 'https://kvbchurch.twotimtwo.com/clubber/checkin?#'));
} catch (e) {
  // Defaults if config is missing
  console.log('PRINTER_NAME=');
  console.log('CHECKIN_URL=https://kvbchurch.twotimtwo.com/clubber/checkin?#');
}
