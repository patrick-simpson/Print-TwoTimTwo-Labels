'use strict';
// ── Receipt-printer trial (80mm ESC/POS over the network) ────────────────────
// An opt-in alternative to the 4×2 label printer: the SAME label the ONE
// renderer (generateLabel) draws is rotated a quarter turn and scaled to fill
// the roll's printable width, then sent as raw ESC/POS to the printer's TCP
// port 9100 (the industry's "raw" / JetDirect port) and cut. No Windows
// driver, no PowerShell, no spooler.
//
// What this module is NOT: a second label layout. It never draws a label of
// its own; the picture is the 4×2 label at 2:1, so the tag is printable-width
// wide and twice that long (576 dots → 2.83in × 5.67in at 203 dpi).
//
// Everything here is either pure (rasterize, buildEscPos, parse) or a single
// TCP conversation, so the whole path is testable on a Linux runner against a
// fake printer (scripts/test-receipt.cjs).

const net = require('net');
const os  = require('os');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const RECEIPT_DEFAULT_PORT = 9100;
// 80mm paper on a 203 dpi head prints 72mm = 576 dots. Some heads do 512 or
// 640; the setting is bounded so a typo can't ask for a 3-foot-wide image.
const RECEIPT_DEFAULT_DOTS = 576;
const RECEIPT_MIN_DOTS = 384;
const RECEIPT_MAX_DOTS = 832;
const RECEIPT_CUTS = ['full', 'partial'];

const CONNECT_TIMEOUT_MS = 3000;
const STATUS_TIMEOUT_MS  = 800;
const JOB_TIMEOUT_MS     = 10000;
// Printers buffer raster data in modest chunks; one GS v 0 per band of this
// many rows keeps every command well inside the smallest buffers in the wild.
const BAND_ROWS = 128;
// Luma at or above PAPER_WHITE prints as bare paper, at or below SOLID_INK as
// solid ink; only what lies between is dithered (see rasterizeLabel).
const PAPER_WHITE = 224;
const SOLID_INK = 64;

// ── Settings ─────────────────────────────────────────────────────────────────
function isEnabled(cfg) {
  return !!cfg && cfg.printerType === 'receipt';
}

// A host goes only to net.connect (never a shell), but it is still persisted
// and echoed in the dashboard, so keep it to a plain IPv4 or DNS name.
function isSafeHost(host) {
  const h = String(host == null ? '' : host).trim();
  if (!h || h.length > 253) return false;
  if (net.isIPv4(h)) return true;
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,62})(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}))*$/.test(h);
}

function normalizePort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// Rounded down to a whole byte: a raster row is sent 8 dots per byte.
function normalizeDots(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < RECEIPT_MIN_DOTS || n > RECEIPT_MAX_DOTS) return null;
  return n - (n % 8);
}

// The live options from config (or a dashboard override for the test button).
function optionsFrom(cfg) {
  const c = cfg || {};
  return {
    host: String(c.receiptHost || '').trim(),
    port: normalizePort(c.receiptPort) || RECEIPT_DEFAULT_PORT,
    dots: normalizeDots(c.receiptDots) || RECEIPT_DEFAULT_DOTS,
    cut:  c.receiptCut === 'partial' ? 'partial' : 'full',
  };
}

// ── Picture → 1-bit raster ───────────────────────────────────────────────────
// The label is rotated a quarter turn clockwise: its left edge (where the name
// starts) comes out of the printer first, its top edge lies along the right
// side of the roll. Scaled uniformly so the label's 2in side fills `dots`.
// Black and white stay solid; mid-tones are dithered (see below).
async function rasterizeLabel(png, dots) {
  const img = await loadImage(png);
  const width = dots;                                         // across the head
  const height = Math.round(width * (img.width / img.height)); // along the feed
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, 0, 0, height, width);
  const px = ctx.getImageData(0, 0, width, height).data;
  const lum = new Float32Array(width * height);
  const solid = new Uint8Array(width * height);   // 1 = ink, 2 = paper, 0 = tone
  for (let p = 0; p < lum.length; p++) {
    const i = p * 4;
    const a = px[i + 3] / 255;
    // Composite on white, then Rec. 601 luma.
    const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * a + 255 * (1 - a);
    lum[p] = l;
    solid[p] = l <= SOLID_INK ? 1 : l >= PAPER_WHITE ? 2 : 0;
  }
  // Floyd-Steinberg on the mid-tones only. Near-black (text, the logo's ink)
  // prints solid and near-white (paper, the badge panel's pale wash) prints
  // bare, and neither sends or takes error, so text edges stay crisp and the
  // paper never speckles. What's left are the colour emoji (the yellow allergy
  // warning icon, the birthday cake), which become dots, as the 4x2 printer's
  // Windows driver does to them today. A plain threshold erased the yellow
  // warning icon entirely.
  const rowBytes = width / 8;
  const bits = Buffer.alloc(rowBytes * height);
  const spread = (q, e) => { if (!solid[q]) lum[q] += e; };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (solid[p]) {
        if (solid[p] === 1) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
        continue;
      }
      const ink = lum[p] < 128;
      if (ink) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
      const err = lum[p] - (ink ? 0 : 255);
      if (x + 1 < width) spread(p + 1, err * 7 / 16);
      if (y + 1 < height) {
        if (x > 0) spread(p + width - 1, err * 3 / 16);
        spread(p + width, err * 5 / 16);
        if (x + 1 < width) spread(p + width + 1, err / 16);
      }
    }
  }
  return { width, height, bits };
}

// ── ESC/POS job ──────────────────────────────────────────────────────────────
// ESC @ (reset) · GS v 0 bands · GS V m n (feed to the cutter, then cut;
// m=65 full, 66 partial). Pure: the byte stream is the testable artifact.
function buildEscPos(raster, opts = {}) {
  const { width, height, bits } = raster;
  const rowBytes = width / 8;
  const parts = [Buffer.from([0x1b, 0x40])];
  for (let y0 = 0; y0 < height; y0 += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - y0);
    parts.push(Buffer.from([
      0x1d, 0x76, 0x30, 0x00,
      rowBytes & 0xff, (rowBytes >> 8) & 0xff,
      rows & 0xff, (rows >> 8) & 0xff,
    ]));
    parts.push(bits.subarray(y0 * rowBytes, (y0 + rows) * rowBytes));
  }
  parts.push(Buffer.from([0x1d, 0x56, opts.cut === 'partial' ? 66 : 65, 0x00]));
  return Buffer.concat(parts);
}

// ── Real-time status (DLE EOT) ───────────────────────────────────────────────
// DLE EOT 2 (offline cause) and DLE EOT 4 (paper sensor) each answer one byte
// whose fixed bits read 0b0xx1xx10 (byte & 0x93 === 0x12). A printer that
// doesn't answer, or answers garbage, is UNKNOWN, never "fine" and never
// "broken": it still gets the job, because plenty of clones skip DLE EOT.
const STATUS_QUERY = Buffer.from([0x10, 0x04, 0x02, 0x10, 0x04, 0x04]);

function parseStatus(bytes) {
  if (!bytes || bytes.length < 2) return { unknown: true };
  const [offline, paper] = bytes;
  if ((offline & 0x93) !== 0x12 || (paper & 0x93) !== 0x12) return { unknown: true };
  return {
    unknown: false,
    coverOpen: !!(offline & 0x04),
    paperOut: !!(offline & 0x20) || (paper & 0x60) === 0x60,
    error: !!(offline & 0x40),
    paperLow: (paper & 0x0c) === 0x0c,
  };
}

function statusProblem(st) {
  if (!st || st.unknown) return null;
  if (st.paperOut) return 'out of paper';
  if (st.coverOpen) return 'the cover is open';
  if (st.error) return 'the printer reports an error (check for a jam or the cutter)';
  return null;
}

// ── One TCP conversation: status → job → close ───────────────────────────────
function sendJob(opts, jobBytes, { statusOnly = false } = {}) {
  const { host, port } = opts;
  return new Promise((resolve, reject) => {
    if (!isSafeHost(host)) return reject(new Error('no printer address is set'));
    let settled = false;
    const reply = [];
    let status = { unknown: true };
    const socket = net.createConnection({ host, port });
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) socket.destroy();
      else socket.end();
      // Let the FIN go out, then make sure nothing lingers.
      setTimeout(() => socket.destroy(), 500).unref();
      if (err) reject(err); else resolve(value);
    };
    let timer = setTimeout(() => done(new Error(`could not reach ${host}:${port} (timed out)`)), CONNECT_TIMEOUT_MS);
    socket.on('error', (e) => {
      const why = e.code === 'ECONNREFUSED' ? 'connection refused'
        : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? 'not reachable on this network'
        : e.code === 'ENOTFOUND' ? 'address not found'
        : (e.code || e.message);
      done(new Error(`could not reach ${host}:${port} (${why})`));
    });
    socket.on('data', (chunk) => { for (const b of chunk) reply.push(b); });
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.write(STATUS_QUERY);
      const started = Date.now();
      const waitStatus = () => {
        if (settled) return;
        if (reply.length >= 2 || Date.now() - started >= STATUS_TIMEOUT_MS) {
          status = parseStatus(reply.slice(0, 2));
          if (statusOnly) return done(null, { status });
          const problem = statusProblem(status);
          if (problem) return done(new Error(problem));
          timer = setTimeout(() => done(new Error('the printer stopped accepting data (timed out)')), JOB_TIMEOUT_MS);
          socket.write(jobBytes, (err) => {
            if (err) return done(new Error(`sending failed (${err.code || err.message})`));
            done(null, { status, bytes: jobBytes.length });
          });
          return;
        }
        setTimeout(waitStatus, 20);
      };
      waitStatus();
    });
  });
}

// Jobs are serialized: a sibling batch prints back to back, and many network
// printers take only one connection at a time.
let queue = Promise.resolve();
function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function printPng(png, opts) {
  const raster = await rasterizeLabel(png, opts.dots);
  const job = buildEscPos(raster, { cut: opts.cut });
  return enqueue(() => sendJob(opts, job));
}

function checkStatus(opts) {
  return enqueue(() => sendJob(opts, null, { statusOnly: true }));
}

// ── "Find printers": who on this PC's subnets answers on the raw port ────────
// Only private /24s of this machine's own interfaces, so it can never wander
// the internet; bounded concurrency and a short timeout keep it ~2–4 s.
function localSubnets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const p = a.address.split('.').map(Number);
      const isPrivate = p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
      if (!isPrivate) continue;
      const base = `${p[0]}.${p[1]}.${p[2]}`;
      if (!out.some(s => s.base === base)) out.push({ base, self: a.address });
    }
  }
  return out.slice(0, 4);
}

function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    const finish = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => finish(false));
    s.once('connect', () => finish(true));
    s.once('error', () => finish(false));
  });
}

async function discover({ port = RECEIPT_DEFAULT_PORT, timeoutMs = 400, concurrency = 64, subnets } = {}) {
  const nets = subnets || localSubnets();
  const hosts = [];
  for (const n of nets) {
    for (let i = 1; i <= 254; i++) {
      const h = `${n.base}.${i}`;
      if (h !== n.self) hosts.push(h);
    }
  }
  const found = [];
  let next = 0;
  async function worker() {
    while (next < hosts.length) {
      const h = hosts[next++];
      if (await probe(h, port, timeoutMs)) found.push(h);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  const key = (h) => h.split('.').map(n => n.padStart(3, '0')).join('.');
  return found.sort((a, b) => key(a).localeCompare(key(b))).map(host => ({ host, port }));
}

module.exports = {
  RECEIPT_DEFAULT_PORT, RECEIPT_DEFAULT_DOTS, RECEIPT_MIN_DOTS, RECEIPT_MAX_DOTS, RECEIPT_CUTS,
  isEnabled, isSafeHost, normalizePort, normalizeDots, optionsFrom,
  rasterizeLabel, buildEscPos, parseStatus, statusProblem,
  printPng, checkStatus, discover, localSubnets,
};
