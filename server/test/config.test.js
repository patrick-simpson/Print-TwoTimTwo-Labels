'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

// Run config through a temp CONFIG_FILE so the real config.json stays untouched.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-config-test-'));
const tmpFile = path.join(tmpDir, 'config.json');
process.env.CONFIG_FILE = tmpFile;

const config = require('../src/config');

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('load: defaults when config.json missing', () => {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  const loaded = config.load();
  assert.equal(loaded.port, 3456);
  assert.equal(loaded.printerName, '');
});

test('save: writes JSON and load() reads it back', () => {
  config.save({ printerName: 'DYMO 450', port: 4444, checkinUrl: 'https://example.com' });
  const loaded = config.load();
  assert.equal(loaded.printerName, 'DYMO 450');
  assert.equal(loaded.port, 4444);
  assert.equal(loaded.checkinUrl, 'https://example.com');
});

test('save: atomic — tmp file is removed after rename', () => {
  config.save({ printerName: 'Brother QL' });
  assert.equal(fs.existsSync(tmpFile + '.tmp'), false);
});

test('save: partial patch only updates provided fields', () => {
  config.save({ printerName: 'A', port: 5555 });
  config.save({ printerName: 'B' });
  const loaded = config.load();
  assert.equal(loaded.printerName, 'B');
  assert.equal(loaded.port, 5555);
});
