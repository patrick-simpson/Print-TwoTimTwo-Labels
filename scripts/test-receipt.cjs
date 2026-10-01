#!/usr/bin/env node
// Tests for the receipt-printer trial (print-server/receipt.js + printLabel()).
//
// WHAT THIS GUARDS
//
// * The tag is the 4×2 label, turned and scaled, never a second layout: the
//   raster is `dots` wide and twice that long, and the label's top-left corner
//   lands at the roll's top-right (a quarter turn clockwise).
// * The ESC/POS stream: reset, GS v 0 bands that add up to the whole picture,
//   and the cut the setting asked for (65 full, 66 partial).
// * DLE EOT status: paper out or cover open refuses the job BEFORE a byte of it
//   is sent; a printer that never answers status still gets the job (unknown is
//   not broken).
// * The night-of contract, end to end through the real server against a fake
//   network printer: a label goes to the receipt printer and NOT the spooler;
//   when the receipt printer is gone the label falls back to the 4×2 printer
//   and /health says so as a {type, message} object; with no fallback the print
//   fails loudly; the trial is silent (no tune); the default (no printerType)
//   is byte-for-byte the old path.
//
// Run: node scripts/test-receipt.cjs

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { createCanvas } = require(path.join(__dirname, '..', 'print-server', 'node_modules', '@napi-rs/canvas'));

const PORT = Number(process.env.AWANA_TEST_PORT || 34611);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// A fake ESC/POS network printer. `mode` decides how it answers DLE EOT.
function fakePrinter() {
  const state = { mode: 'ok', jobs: [], conns: 0 };
  const server = net.createServer((sock) => {
    state.conns++;
    const chunks = [];
    let answered = false;
    sock.on('data', (c) => {
      chunks.push(c);
      const all = Buffer.concat(chunks);
      if (!answered && all.length >= 6 && all[0] === 0x10 && all[1] === 0x04) {
        answered = true;
        if (state.mode === 'ok') sock.write(Buffer.from([0x12, 0x12]));
        else if (state.mode === 'paperOut') sock.write(Buffer.from([0x32, 0x72]));
        else if (state.mode === 'coverOpen') sock.write(Buffer.from([0x16, 0x12]));
        else if (state.mode === 'paperLow') sock.write(Buffer.from([0x12, 0x1e]));
        // 'silent': never answers
      }
    });
    sock.on('end', () => {
      const all = Buffer.concat(chunks);
      const job = all.subarray(6);
      if (job.length) state.jobs.push(job);
      sock.end();
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    state.port = server.address().port;
    state.close = () => new Promise(r => server.close(() => r()));
    resolve(state);
  }));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(25); }
  return fn();
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-receipt-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-receipt-bin-'));
  const spoolLog = path.join(binDir, 'spool.log');
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\necho job >> ${spoolLog}\nexit 0\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  const spoolJobs = () => { try { return fs.readFileSync(spoolLog, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };

  const printer = await fakePrinter();
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake', printerType: 'receipt', receiptHost: '127.0.0.1', receiptPort: printer.port,
    musicalPrinter: true,
  }, null, 2));
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';
  process.env.PRINTER_NAME = 'Fake';

  const receipt = require(path.join(__dirname, '..', 'print-server', 'receipt.js'));
  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => { if (listener.listening) return resolve(); listener.once('listening', resolve); });

  const post = async (p, body, headers = {}) => {
    const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const health = async () => (await fetch(BASE + '/health')).json();

  // ── 1. Settings rules ──────────────────────────────────────────────────────
  console.log('\nreceipt: settings');
  {
    check('off unless printerType is receipt', !receipt.isEnabled({}) && !receipt.isEnabled({ printerType: 'label' }) && receipt.isEnabled({ printerType: 'receipt' }));
    check('an IPv4 is a safe host', receipt.isSafeHost('192.168.1.50'));
    check('a plain DNS name is a safe host', receipt.isSafeHost('rongta.local'));
    check('blank, spaces, URLs and shell bits are not', !receipt.isSafeHost('') && !receipt.isSafeHost('a b')
      && !receipt.isSafeHost('http://x') && !receipt.isSafeHost('x;rm') && !receipt.isSafeHost(null));
    check('width rounds down to a whole byte', receipt.normalizeDots(579) === 576);
    check('width out of range is refused', receipt.normalizeDots(100) === null && receipt.normalizeDots(5000) === null);
    const o = receipt.optionsFrom({ receiptHost: ' 10.0.0.9 ' });
    check('defaults: port 9100, 576 dots, full cut', o.host === '10.0.0.9' && o.port === 9100 && o.dots === 576 && o.cut === 'full', JSON.stringify(o));
    check('partial cut only when asked', receipt.optionsFrom({ receiptCut: 'partial' }).cut === 'partial'
      && receipt.optionsFrom({ receiptCut: 'zigzag' }).cut === 'full');
  }

  // ── 2. The picture ─────────────────────────────────────────────────────────
  console.log('\nreceipt: rotate and scale');
  {
    const c = createCanvas(1200, 600);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 600);
    g.fillStyle = '#000'; g.fillRect(0, 0, 100, 100);   // the label's top-left corner
    const r = await receipt.rasterizeLabel(c.toBuffer('image/png'), 576);
    check('raster is dots wide and twice that long', r.width === 576 && r.height === 1152, `${r.width}×${r.height}`);
    const on = (x, y) => !!(r.bits[y * (r.width / 8) + (x >> 3)] & (0x80 >> (x & 7)));
    check("the label's top-left lands at the roll's top-right", on(570, 5) && !on(5, 5) && !on(570, 1140) && !on(5, 1140));
    check('everything else is white', !on(288, 576));

    // The yellow allergy warning icon is a mid-tone (luma ~196). A plain threshold
    // printed it as bare paper; it must come out as dots, while solid black stays solid.
    const y = createCanvas(1200, 600);
    const yg = y.getContext('2d');
    yg.fillStyle = '#fff'; yg.fillRect(0, 0, 1200, 600);
    yg.fillStyle = '#ffcc00'; yg.fillRect(600, 300, 200, 200);
    yg.fillStyle = '#000'; yg.fillRect(100, 300, 200, 200);
    const yr = await receipt.rasterizeLabel(y.toBuffer('image/png'), 576);
    const yon = (x, yy) => !!(yr.bits[yy * 72 + (x >> 3)] & (0x80 >> (x & 7)));
    let yInk = 0, bInk = 0, n = 0;
    // label (600..800, 300..500) → raster x = 576 - label y*0.96, y = label x*0.96
    for (let ry = 600; ry < 760; ry++) for (let rx = 100; rx < 270; rx++) { n++; if (yon(rx, ry)) yInk++; }
    let bn = 0;
    for (let ry = 110; ry < 280; ry++) for (let rx = 100; rx < 270; rx++) { bn++; if (yon(rx, ry)) bInk++; }
    check('a yellow icon prints as dots, not bare paper', yInk / n > 0.1 && yInk / n < 0.4, `ink ${(yInk / n * 100).toFixed(1)}%`);
    check('solid black stays solid', bInk === bn, `${bInk}/${bn}`);
    let paper = 0;
    for (let ry = 900; ry < 1100; ry++) for (let rx = 0; rx < 576; rx++) if (yon(rx, ry)) paper++;
    check('bare paper stays bare (no speckle)', paper === 0, `${paper} stray dots`);

    const real = await server.generateLabel({ firstName: 'Avery', lastName: 'Sample', clubName: 'Sparks' });
    const rr = await receipt.rasterizeLabel(real.pngPath, 576);
    fs.unlink(real.pngPath, () => {});
    let ink = 0; for (const b of rr.bits) ink += b ? 1 : 0;
    check('a real label rasterizes with ink on it', rr.height === 1152 && ink > 1000, `ink bytes ${ink}`);
  }

  // ── 3. The byte stream ─────────────────────────────────────────────────────
  console.log('\nreceipt: ESC/POS');
  {
    const raster = { width: 16, height: 300, bits: Buffer.alloc(2 * 300, 0xaa) };
    const full = receipt.buildEscPos(raster, { cut: 'full' });
    const partial = receipt.buildEscPos(raster, { cut: 'partial' });
    check('starts with ESC @', full[0] === 0x1b && full[1] === 0x40);
    check('ends with a full cut (GS V 65)', full.subarray(-4).equals(Buffer.from([0x1d, 0x56, 65, 0])));
    check('or a partial cut (GS V 66)', partial.subarray(-4).equals(Buffer.from([0x1d, 0x56, 66, 0])));
    let i = 2; let rows = 0; let bands = 0;
    while (full[i] === 0x1d && full[i + 1] === 0x76) {
      const xb = full[i + 4] | (full[i + 5] << 8);
      const yr = full[i + 6] | (full[i + 7] << 8);
      check('band width is bytes per row', xb === 2);
      rows += yr; bands++; i += 8 + xb * yr;
    }
    check('bands cover every row', rows === 300 && bands === 3, `rows ${rows}, bands ${bands}`);
    check('nothing between the bands and the cut', i === full.length - 4);
  }

  // ── 4. Status ──────────────────────────────────────────────────────────────
  console.log('\nreceipt: DLE EOT status');
  {
    check('no answer is unknown', receipt.parseStatus([]).unknown === true);
    check('garbage is unknown', receipt.parseStatus([0xff, 0xff]).unknown === true);
    check('all clear', receipt.statusProblem(receipt.parseStatus([0x12, 0x12])) === null);
    check('paper out', receipt.statusProblem(receipt.parseStatus([0x32, 0x72])) === 'out of paper');
    check('cover open', receipt.statusProblem(receipt.parseStatus([0x16, 0x12])) === 'the cover is open');
    const low = receipt.parseStatus([0x12, 0x1e]);
    check('paper low is a note, not a refusal', low.paperLow === true && receipt.statusProblem(low) === null);
  }

  const opts = { host: '127.0.0.1', port: printer.port, dots: 576, cut: 'full' };
  const png = (() => { const c = createCanvas(1200, 600); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 600); return c.toBuffer('image/png'); })();

  // ── 5. Talking to a printer ────────────────────────────────────────────────
  console.log('\nreceipt: the TCP conversation');
  {
    printer.jobs.length = 0;
    const r = await receipt.printPng(png, opts);
    await waitFor(() => printer.jobs.length === 1);
    const expected = receipt.buildEscPos(await receipt.rasterizeLabel(png, 576), { cut: 'full' });
    check('the job arrives whole', printer.jobs.length === 1 && printer.jobs[0].equals(expected),
      `${printer.jobs.length} job(s), ${printer.jobs[0] && printer.jobs[0].length} vs ${expected.length} bytes`);
    check('and the status came back clean', r.status && r.status.unknown === false && !r.status.paperOut);

    printer.mode = 'paperOut'; printer.jobs.length = 0;
    let err = null;
    try { await receipt.printPng(png, opts); } catch (e) { err = e; }
    await sleep(150);
    check('paper out refuses the job', err && /out of paper/.test(err.message), err && err.message);
    check('and sends none of it', printer.jobs.length === 0);

    printer.mode = 'silent'; printer.jobs.length = 0;
    const s = await receipt.printPng(png, opts);
    await waitFor(() => printer.jobs.length === 1);
    check('a printer that ignores status still prints', printer.jobs.length === 1 && s.status.unknown === true);

    printer.mode = 'ok';
    const dead = await new Promise(r => { const t = net.createServer(); t.listen(0, '127.0.0.1', () => { const p = t.address().port; t.close(() => r(p)); }); });
    err = null;
    try { await receipt.printPng(png, { ...opts, port: dead }); } catch (e) { err = e; }
    check('nobody listening is a clear error', err && /connection refused/.test(err.message), err && err.message);

    const found = await receipt.discover({ port: printer.port, timeoutMs: 300, subnets: [{ base: '127.0.0', self: '127.0.0.2' }] });
    check('find printers sees the one on the raw port', found.length === 1 && found[0].host === '127.0.0.1', JSON.stringify(found));
  }

  // ── 6. The server, end to end ──────────────────────────────────────────────
  console.log('\nreceipt: through the server');
  {
    printer.jobs.length = 0;
    const before = spoolJobs();
    let r = await post('/print-custom', { text: 'Receipt one' });
    await waitFor(() => printer.jobs.length === 1);
    check('a label prints on the receipt printer', r.status === 200 && printer.jobs.length === 1, JSON.stringify(r.body));
    check('and not on the spooler, and plays no tune', spoolJobs() === before, `${spoolJobs() - before} spool job(s)`);
    let h = await health();
    check('/health reports the last good tag', h.receiptPrinter && h.receiptPrinter.enabled && h.receiptPrinter.last.ok === true);
    check('with the address for this computer', h.receiptPrinter.host === '127.0.0.1');

    printer.mode = 'paperOut';
    r = await post('/print-custom', { text: 'Receipt two' });
    check('a failed receipt print falls back to the 4×2 printer', r.status === 200 && spoolJobs() === before + 1, `${r.status} ${JSON.stringify(r.body)}`);
    h = await health();
    const fb = (h.warnings || []).find(w => w && w.type === 'receiptFallback');
    check('and /health says so as a {type, message} object', fb && typeof fb.message === 'string' && /out of paper/.test(fb.message) && /Fake/.test(fb.message), JSON.stringify(h.warnings));

    server.setPrinterName('');
    // The config's printerName would otherwise be the fallback; take it out.
    const cfgPath = path.join(dataDir, 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); delete cfg.printerName;
    server.applySavedConfig(cfg);
    r = await post('/print-custom', { text: 'Receipt three' });
    check('with no fallback the print fails loudly', r.status === 500 && /Receipt printer: out of paper/.test(r.body && r.body.error), JSON.stringify(r.body));
    h = await health();
    check('and /health raises receiptPrinterFailed', (h.warnings || []).some(w => w && w.type === 'receiptPrinterFailed'));

    printer.mode = 'ok';
    r = await post('/receipt/test', { receiptCut: 'partial' });
    await waitFor(() => printer.jobs.length === 2);
    check('Send test tag prints with the form\'s cut', r.status === 200 && printer.jobs.length === 2
      && printer.jobs[1].subarray(-4)[2] === 66, JSON.stringify(r.body));
    h = await health();
    check('a good print clears the warning', !(h.warnings || []).some(w => w && /^receipt/.test(w.type)));

    r = await post('/receipt/test', {}, { Origin: 'https://evil.example' });
    check('the test button is dashboard-only', r.status === 403);
    r = await post('/receipt/discover', {}, { Origin: 'https://evil.example' });
    check('so is find printers', r.status === 403);

    r = await post('/config', { receiptHost: 'not a host;' });
    check('a bad address is refused at save', r.status === 400);
    r = await post('/config', { receiptDots: 4 });
    check('a bad width is refused at save', r.status === 400);
    r = await post('/config', { printerType: 'laser' });
    check('an unknown printer type is refused', r.status === 400);
    r = await post('/config', { printerType: 'label', receiptCut: 'full', receiptPort: 9100 });
    const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    check('label, full cut and port 9100 are defaults that delete their keys',
      r.status === 200 && !('printerType' in saved) && !('receiptCut' in saved) && !('receiptPort' in saved), JSON.stringify(saved));

    server.setPrinterName('Fake');
    printer.jobs.length = 0;
    const b2 = spoolJobs();
    r = await post('/print-custom', { text: 'Back to labels' });
    await sleep(200);
    check('with the trial off, labels go to the spooler as before', r.status === 200 && printer.jobs.length === 0 && spoolJobs() > b2);
    h = await health();
    check('and /health carries no receipt warnings', !(h.warnings || []).some(w => w && /^receipt/.test(w.type)) && h.receiptPrinter.enabled === false);
  }

  await printer.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
