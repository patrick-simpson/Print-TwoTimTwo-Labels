// Awana Label Print Server
// Started by install-and-run.ps1 — listens on http://localhost:3456
// Accepts POST /print and silently prints a 4×2 in label via pdf-to-printer.

'use strict';

const express = require('express');
const cors    = require('cors');
const { print } = require('pdf-to-printer');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const PORT         = 3456;
const PRINTER_NAME = process.env.PRINTER_NAME || '';

// ── Label geometry (1 pt = 1/72 inch) ────────────────────────────────────────
const PAGE_W  = 4 * 72;  // 288 pt
const PAGE_H  = 2 * 72;  // 144 pt
const INSET   = 6;        // badge margin from page edge
const BX = INSET, BY = INSET;
const BW = PAGE_W - INSET * 2;   // badge width  (276 pt)
const BH = PAGE_H - INSET * 2;   // badge height (132 pt)
const CORNER = 12;

// Columns (when icon is present)
const ICON_COL_W  = 84;                // left icon zone width
const DIVIDER_X   = BX + ICON_COL_W;
const TEXT_X      = DIVIDER_X + 8;    // right text zone start
const TEXT_W      = BX + BW - TEXT_X; // right text zone width

// ── Download a remote image into a Buffer ─────────────────────────────────────
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ── Resolve clubImageData → Buffer (or null) ──────────────────────────────────
async function resolveImageBuffer(clubImageData) {
  if (!clubImageData) return null;
  try {
    if (clubImageData.startsWith('data:')) {
      // base64 data URL
      const b64 = clubImageData.replace(/^data:[^;]+;base64,/, '');
      return Buffer.from(b64, 'base64');
    }
    if (/^https?:\/\//.test(clubImageData)) {
      return await downloadImage(clubImageData);
    }
  } catch (e) {
    console.log(`[icon] Could not load club image: ${e.message}`);
  }
  return null;
}

// ── Auto-size a font to fit within maxWidth ───────────────────────────────────
function fitFontSize(doc, text, fontName, maxWidth, maxSize = 44, minSize = 18) {
  doc.font(fontName);
  for (let size = maxSize; size >= minSize; size -= 2) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= maxWidth) return size;
  }
  return minSize;
}

// ── Generate the label PDF ────────────────────────────────────────────────────
async function generateLabel(firstName, lastName, clubName, clubImageBuffer) {
  const pdfPath = path.join(os.tmpdir(), `awana-${Date.now()}.pdf`);
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
  const out  = fs.createWriteStream(pdfPath);

  doc.pipe(out);

  const hasIcon = !!clubImageBuffer;
  const textX   = hasIcon ? TEXT_X : BX + 8;
  const textW   = hasIcon ? TEXT_W : BW - 16;

  // ── Badge border ────────────────────────────────────────────────────────────
  doc.roundedRect(BX, BY, BW, BH, CORNER)
     .lineWidth(1.5).strokeColor('#000000').stroke();

  // ── Left icon panel ─────────────────────────────────────────────────────────
  if (hasIcon) {
    // Soft gray background for the icon zone (clip to badge shape)
    doc.save();
    doc.roundedRect(BX, BY, BW, BH, CORNER).clip();
    doc.rect(BX, BY, ICON_COL_W, BH).fillColor('#f4f4f4').fill();
    doc.restore();

    // Subtle vertical divider
    doc.moveTo(DIVIDER_X, BY + 12)
       .lineTo(DIVIDER_X, BY + BH - 12)
       .lineWidth(0.5).strokeColor('#d0d0d0').stroke();

    // Club icon image (56×56 pt, centred in the icon zone)
    const iconSize = 56;
    const iconX = BX + (ICON_COL_W - iconSize) / 2;
    const iconY = BY + (BH - iconSize) / 2;
    try {
      doc.image(clubImageBuffer, iconX, iconY, { width: iconSize, height: iconSize, fit: [iconSize, iconSize], align: 'center', valign: 'center' });
    } catch {
      // Image decode failed — draw a placeholder circle
      doc.circle(BX + ICON_COL_W / 2, BY + BH / 2, 20)
         .lineWidth(1).strokeColor('#aaa').stroke();
    }
  }

  // ── Text area ───────────────────────────────────────────────────────────────
  const hasLast = lastName.trim().length > 0;
  const hasClub = clubName.trim().length > 0;

  // Measure the total block height so we can centre it vertically
  const fs1 = fitFontSize(doc, firstName, 'Helvetica-Bold', textW);
  const fs2 = 20;
  const fs3 = 12;
  const GAP = 4;
  const SEP = 9;  // gap(4) + line(1) + gap(4)

  let blockH = fs1;
  if (hasLast) blockH += GAP + fs2;
  if (hasClub) blockH += SEP + fs3;

  const centerY = BY + BH / 2;
  let y = centerY - blockH / 2;

  // First name
  doc.font('Helvetica-Bold').fontSize(fs1).fillColor('#000000');
  doc.text(firstName, textX, y, { width: textW, align: 'center', lineBreak: false });
  y += fs1;

  // Last name
  if (hasLast) {
    y += GAP;
    doc.font('Helvetica').fontSize(fs2).fillColor('#222222');
    doc.text(lastName, textX, y, { width: textW, align: 'center', lineBreak: false });
    y += fs2;
  }

  // Club name with separator
  if (hasClub) {
    y += 4;
    const sepMargin = textW * 0.1;
    doc.moveTo(textX + sepMargin, y + 0.5)
       .lineTo(textX + textW - sepMargin, y + 0.5)
       .lineWidth(0.5).strokeColor('#cccccc').stroke();
    y += 5;
    doc.font('Helvetica-Oblique').fontSize(fs3).fillColor('#444444');
    doc.text(clubName, textX, y, { width: textW, align: 'center', lineBreak: false });
  }

  doc.end();
  return new Promise((resolve, reject) => {
    out.on('finish', () => resolve(pdfPath));
    out.on('error', reject);
  });
}

// ── Express server ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));  // allow base64 image payloads

app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME || '(default)' });
});

app.post('/print', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName   = '',
    clubImageData = null
  } = req.body || {};

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = String(reqFirst || '').trim();
    lastName  = String(reqLast  || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }

  console.log(`[print] ${firstName} ${lastName} | ${clubName || '—'} | printer: ${PRINTER_NAME || 'default'}`);

  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    const pdfPath = await generateLabel(firstName, lastName, clubName, clubImageBuffer);
    const opts = PRINTER_NAME ? { printer: PRINTER_NAME } : {};
    await print(pdfPath, opts);
    fs.unlink(pdfPath, () => {});
    res.json({ success: true });
  } catch (err) {
    console.error('[print] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Extension download (serves chrome-extension as .zip) ─────────────────────
app.get('/extension-download', (req, res) => {
  const extensionDir = path.join(__dirname, '..', 'chrome-extension');

  if (!fs.existsSync(extensionDir)) {
    return res.status(404).json({ error: 'Extension folder not found' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="awana-print-extension.zip"');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('[extension-download] Error:', err.message);
    res.status(500).json({ error: err.message });
  });

  archive.pipe(res);
  archive.directory(extensionDir, 'chrome-extension');
  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`\n  Awana Print Server  •  http://localhost:${PORT}`);
  console.log(`  Printer : ${PRINTER_NAME || '(system default)'}`);
  console.log('  Waiting for check-ins. Press Ctrl+C to stop.\n');
});
