'use strict';

// HTTP routes for the print server. Wired up by server.js. All handlers
// are defensive: bad input returns 4xx, never throws; printer/CSV errors
// are caught and returned as 5xx but the process stays alive.

const express = require('express');
const fs      = require('fs');
const https   = require('https');
const path    = require('path');

const { parseCSV, findClubber, buildFamilyIndex } = require('./csv');
const { generateLabel, resolveImageBuffer }       = require('./label');
const { enrichClubber }                           = require('./enrich');
const printer                                     = require('./printer');
const config                                      = require('./config');
const roster                                      = require('./roster');
const history                                     = require('./history');
const log                                         = require('./log').make('routes');

const SERVER_VERSION = require('../package.json').version;

// Split "FirstName LastName" input into { firstName, lastName } — accepts
// either separate fields or a single `name` string.
function splitName(body) {
  const { name, firstName: reqFirst, lastName: reqLast } = body || {};
  if (reqFirst !== undefined) {
    return {
      firstName: String(reqFirst || '').trim(),
      lastName:  String(reqLast  || '').trim(),
    };
  }
  if (name) {
    const parts = String(name).trim().split(/\s+/);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
  }
  return null;
}

// Auto-update checker. Pings GitHub for the latest VERSION file once on
// startup and then every 6 hours. Silent on any failure.
let latestVersion = null;
const UPDATE_URL = 'https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION';

function checkForUpdates() {
  https.get(UPDATE_URL, { timeout: 5000 }, (res) => {
    if (res.statusCode !== 200) return;
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const ver = data.trim();
      if (ver && /^\d+\.\d+\.\d+$/.test(ver)) {
        latestVersion = ver;
        if (ver !== SERVER_VERSION) {
          log.info(`New version available: ${ver} (current: ${SERVER_VERSION})`);
        }
      }
    });
  }).on('error', () => { /* ignore */ });
}

// Roster state lives in a closure so /update-csv can replace it without
// a circular require. All handlers grab the current rows through getRows().
function build(deps) {
  const app = express();
  app.use(require('cors')());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  let rows = roster.load();
  function reloadRoster() {
    rows = roster.load();
    return rows;
  }

  // ── Health ──────────────────────────────────────────────────────────
  let cachedWarnings = { list: [], checkedAt: 0 };
  const WARNINGS_TTL = 60 * 1000;

  function checkWarnings() {
    const now = Date.now();
    if (now - cachedWarnings.checkedAt < WARNINGS_TTL) return cachedWarnings.list;
    const warnings = [];
    const csvPath = roster.resolveCsvPath();
    try {
      if (!fs.existsSync(csvPath)) {
        warnings.push({ type: 'csvMissing', message: 'clubbers.csv not found' });
      } else {
        const stat = fs.statSync(csvPath);
        if (rows.length === 0) warnings.push({ type: 'csvEmpty', message: 'clubbers.csv has no data rows' });
        const ageHours = (now - stat.mtimeMs) / 3600000;
        if (ageHours > 24) warnings.push({ type: 'csvStale', message: `clubbers.csv is ${Math.round(ageHours)}h old` });
      }
    } catch { /* ignore */ }

    const cfg = config.load();
    if (cfg.printerName && printer.IS_WINDOWS) {
      const names = printer.listPrinters().map(p => p.name);
      if (names.length > 0 && !names.includes(cfg.printerName)) {
        warnings.push({ type: 'printerNotFound', message: `Printer "${cfg.printerName}" not found` });
      }
    }

    cachedWarnings = { list: warnings, checkedAt: now };
    return warnings;
  }

  app.get('/health', (req, res) => {
    const cfg = config.load();
    res.json({
      status:        'ok',
      ready:         true,
      version:       SERVER_VERSION,
      latestVersion: latestVersion,
      printer:       cfg.printerName || '(system default)',
      port:          cfg.port,
      uptime:        Math.round(process.uptime()),
      rosterCount:   rows.length,
      warnings:      checkWarnings(),
    });
  });

  // ── Config ──────────────────────────────────────────────────────────
  app.get('/config', (req, res) => {
    res.json(config.load());
  });

  app.post('/config', (req, res) => {
    try {
      const next = config.save(req.body || {});
      res.json({ ok: true, config: next });
    } catch (err) {
      log.error(`Failed to save config: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Printers ────────────────────────────────────────────────────────
  app.get('/printers', (req, res) => {
    const list = printer.listPrinters();
    const cfg  = config.load();
    res.json({ printers: list, serverDefault: cfg.printerName || null });
  });

  // ── Roster ──────────────────────────────────────────────────────────
  app.get('/roster-status', (req, res) => {
    res.json({ count: rows.length });
  });

  app.get('/siblings', (req, res) => {
    const rawName = (req.query.name || '').trim();
    if (!rawName) return res.status(400).json({ error: 'name query param required' });
    const idx = buildFamilyIndex(rows);
    res.json({ siblings: idx.get(rawName.toLowerCase()) || [] });
  });

  app.post('/update-csv', (req, res) => {
    const { csv } = req.body || {};
    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'csv field is required (string)' });
    }
    try {
      rows = roster.write(csv);
      res.json({ ok: true, count: rows.length });
    } catch (err) {
      log.error(`Failed to write CSV: ${err.message}`);
      res.status(500).json({ error: 'Failed to write CSV' });
    }
  });

  // ── Label generation (PNG, no printing) ─────────────────────────────
  app.post('/label', async (req, res) => {
    const split = splitName(req.body);
    if (!split) return res.status(400).json({ error: 'name or firstName is required' });
    const { firstName, lastName } = split;
    const { clubName = '', clubImageData = null, visitor = false } = req.body || {};

    rows = reloadRoster();
    const record = findClubber(rows, firstName, lastName);
    const enrichment = enrichClubber(record);

    let pngPath = null;
    try {
      const clubImageBuffer = await resolveImageBuffer(clubImageData);
      const result = await generateLabel({
        firstName, lastName, clubName, clubImageBuffer,
        ...enrichment, isVisitor: !!visitor,
      });
      pngPath = result.pngPath;
      res.set('Content-Type', 'image/png');
      res.send(result.buffer);
    } catch (err) {
      log.error(`/label: ${err.message}`);
      res.status(500).json({ error: err.message });
    } finally {
      if (pngPath) fs.unlink(pngPath, () => {});
    }
  });

  // ── Print ───────────────────────────────────────────────────────────
  app.post('/print', async (req, res) => {
    const split = splitName(req.body);
    if (!split) return res.status(400).json({ error: 'name or firstName is required' });
    const { firstName, lastName } = split;
    const { clubName = '', clubImageData = null, printerName: reqPrinter = '', visitor = false } = req.body || {};

    const cfg = config.load();
    const effectivePrinter = printer.resolvePrinter(reqPrinter, cfg.printerName);

    rows = reloadRoster();
    const record = findClubber(rows, firstName, lastName);
    const enrichment = enrichClubber(record);
    if (!record && (firstName || lastName)) {
      log.info(`'${firstName} ${lastName}' not in CSV — printing basic label`);
    }

    log.info(`${firstName} ${lastName} | ${enrichment.handbookGroup || clubName || '—'} | printer: ${effectivePrinter || 'default'}`);

    let pngPath = null;
    try {
      const clubImageBuffer = await resolveImageBuffer(clubImageData);
      const result = await generateLabel({
        firstName, lastName, clubName, clubImageBuffer,
        ...enrichment, isVisitor: !!visitor,
      });
      pngPath = result.pngPath;

      printer.printImage(pngPath, effectivePrinter);
      history.add({ firstName, lastName, clubName, clubImageData, printer: effectivePrinter, success: true });
      res.json({ success: true });
    } catch (err) {
      log.error(`/print: ${err.message}`);
      res.status(500).json({ error: err.message });
    } finally {
      if (pngPath) fs.unlink(pngPath, () => {});
    }
  });

  // ── Preview (unauthenticated, for the website) ──────────────────────
  app.get('/preview', async (req, res) => {
    const { name, firstName: qFirst, lastName: qLast, clubName = '' } = req.query;
    let firstName, lastName;
    if (qFirst) {
      firstName = String(qFirst).trim();
      lastName  = String(qLast || '').trim();
    } else if (name) {
      const parts = String(name).trim().split(/\s+/);
      firstName = parts[0] || 'Preview';
      lastName  = parts.slice(1).join(' ') || '';
    } else {
      firstName = 'Preview';
      lastName  = 'Label';
    }

    rows = reloadRoster();
    const record = findClubber(rows, firstName, lastName);
    const enrichment = enrichClubber(record);

    let pngPath = null;
    try {
      const result = await generateLabel({ firstName, lastName, clubName, ...enrichment });
      pngPath = result.pngPath;
      res.set('Content-Type', 'image/png');
      res.send(result.buffer);
    } catch (err) {
      log.error(`/preview: ${err.message}`);
      res.status(500).json({ error: err.message });
    } finally {
      if (pngPath) fs.unlink(pngPath, () => {});
    }
  });

  // ── History + reprint ───────────────────────────────────────────────
  app.get('/history',       (req, res) => res.json(history.load()));
  app.get('/history/today', (req, res) => res.json(history.today()));

  app.post('/reprint', async (req, res) => {
    const { name, index } = req.body || {};
    const entries = history.load();

    let entry;
    if (typeof index === 'number' && index >= 0 && index < entries.length) {
      entry = entries[index];
    } else if (name) {
      const search = String(name).toLowerCase().trim();
      entry = entries.find(e => `${e.firstName} ${e.lastName}`.toLowerCase().trim() === search);
    }
    if (!entry) return res.status(404).json({ error: 'No matching print history entry found' });

    const cfg = config.load();
    const effectivePrinter = printer.resolvePrinter(req.body.printerName, entry.printer || cfg.printerName);

    let pngPath = null;
    try {
      rows = reloadRoster();
      const record = findClubber(rows, entry.firstName, entry.lastName);
      const enrichment = enrichClubber(record);
      const clubImageBuffer = await resolveImageBuffer(entry.clubImageData);
      const result = await generateLabel({
        firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
        clubImageBuffer, ...enrichment,
      });
      pngPath = result.pngPath;
      printer.printImage(pngPath, effectivePrinter);
      history.add({ ...entry, printer: effectivePrinter, success: true });
      log.info(`reprint: ${entry.firstName} ${entry.lastName}`);
      res.json({ success: true, name: `${entry.firstName} ${entry.lastName}` });
    } catch (err) {
      log.error(`/reprint: ${err.message}`);
      res.status(500).json({ error: err.message });
    } finally {
      if (pngPath) fs.unlink(pngPath, () => {});
    }
  });

  // ── Diagnostics ─────────────────────────────────────────────────────
  app.get('/diagnostics', async (req, res) => {
    const results = [];
    results.push({ test: 'Server running', passed: true, detail: `v${SERVER_VERSION}, uptime ${Math.round(process.uptime())}s` });

    const cfg = config.load();
    if (printer.IS_WINDOWS) {
      const list = printer.listPrinters();
      if (list.length === 0) {
        results.push({ test: 'Printer detected', passed: false, detail: 'No printers found' });
      } else {
        const target = cfg.printerName || list.find(p => p.isWindowsDefault)?.name || '(none)';
        const found = list.some(p => p.name === cfg.printerName) || (!cfg.printerName && list.some(p => p.isWindowsDefault));
        results.push({ test: 'Printer detected', passed: found, detail: target });
      }
    } else {
      results.push({ test: 'Printer detected', passed: false, detail: 'Not on Windows' });
    }

    const csvPath = roster.resolveCsvPath();
    const csvExists = fs.existsSync(csvPath);
    results.push({ test: 'CSV loaded', passed: csvExists && rows.length > 0, detail: csvExists ? `${rows.length} clubbers` : 'File not found' });

    try {
      const testResult = await generateLabel({ firstName: 'Test', lastName: 'Child' });
      fs.unlink(testResult.pngPath, () => {});
      results.push({ test: 'Label rendering', passed: true, detail: `${testResult.buffer.length} bytes` });
    } catch (err) {
      results.push({ test: 'Label rendering', passed: false, detail: err.message });
    }

    res.json(results);
  });

  return app;
}

module.exports = { build, checkForUpdates };
