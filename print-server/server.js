// Awana Label Print Server
// Runs as a background Node.js process started by install-and-run.ps1
// Listens on http://localhost:3456 and prints labels silently via pdf-to-printer

const express = require('express');
const cors    = require('cors');
const { print } = require('pdf-to-printer');
const PDFDocument = require('pdfkit');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT         = 3456;
const PRINTER_NAME = process.env.PRINTER_NAME || '';

// ── Label layout constants (1 pt = 1/72 inch) ─────────────────────────────────
const PAGE_W = 4 * 72;   // 288 pt  (4 in)
const PAGE_H = 2 * 72;   // 144 pt  (2 in)
const INSET  = 7;         // badge margin from page edge (pt)
const BADGE_X = INSET, BADGE_Y = INSET;
const BADGE_W = PAGE_W - INSET * 2;   // 274 pt
const BADGE_H = PAGE_H - INSET * 2;   // 130 pt
const CORNER  = 10;       // rounded-corner radius

// ── PDF generation ─────────────────────────────────────────────────────────────
function generateLabel(firstName, lastName, clubName) {
  return new Promise((resolve, reject) => {
    const pdfPath = path.join(os.tmpdir(), `awana-label-${Date.now()}.pdf`);
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
    const out = fs.createWriteStream(pdfPath);

    doc.pipe(out);

    // Border
    doc.roundedRect(BADGE_X, BADGE_Y, BADGE_W, BADGE_H, CORNER)
       .lineWidth(1.5).stroke('#000000');

    // ── Measure block height so we can centre it vertically ──────────────────
    const H_FIRST = 48;    // firstName font size (≈ visual height in pt)
    const H_LAST  = 22;
    const H_CLUB  = 14;
    const GAP     = 4;    // spacing between elements
    const SEP_H   = 9;    // separator line area (gap + line + gap)

    const hasLast = lastName.trim().length > 0;
    const hasClub = clubName.trim().length > 0;

    let blockH = H_FIRST;
    if (hasLast) blockH += GAP + H_LAST;
    if (hasClub) blockH += SEP_H + H_CLUB;

    // Centre block within the badge
    let y = BADGE_Y + (BADGE_H - blockH) / 2;

    // ── First name ────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(H_FIRST).fillColor('#000000');
    doc.text(firstName, BADGE_X, y, { width: BADGE_W, align: 'center', lineBreak: false });
    y += H_FIRST;

    // ── Last name ─────────────────────────────────────────────────────────────
    if (hasLast) {
      y += GAP;
      doc.font('Helvetica').fontSize(H_LAST).fillColor('#000000');
      doc.text(lastName, BADGE_X, y, { width: BADGE_W, align: 'center', lineBreak: false });
      y += H_LAST;
    }

    // ── Club name with separator ──────────────────────────────────────────────
    if (hasClub) {
      y += 4;
      const sepMargin = BADGE_W * 0.15;
      doc.moveTo(BADGE_X + sepMargin, y + 0.5)
         .lineTo(BADGE_X + BADGE_W - sepMargin, y + 0.5)
         .lineWidth(0.5).strokeColor('#cccccc').stroke();
      // reset stroke for next use
      doc.strokeColor('#000000').lineWidth(1);
      y += 5;
      doc.font('Helvetica-Oblique').fontSize(H_CLUB).fillColor('#333333');
      doc.text(clubName, BADGE_X, y, { width: BADGE_W, align: 'center', lineBreak: false });
    }

    doc.end();
    out.on('finish', () => resolve(pdfPath));
    out.on('error', reject);
  });
}

// ── Express app ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME || '(default)' });
});

app.post('/print', async (req, res) => {
  const { name, firstName: reqFirst, lastName: reqLast, clubName = '' } = req.body || {};

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

  console.log(`[print] ${firstName} ${lastName} | club: ${clubName || '—'} | printer: ${PRINTER_NAME || 'default'}`);

  try {
    const pdfPath = await generateLabel(firstName, lastName, clubName);
    const opts = PRINTER_NAME ? { printer: PRINTER_NAME } : {};
    await print(pdfPath, opts);
    fs.unlink(pdfPath, () => {});
    res.json({ success: true });
  } catch (err) {
    console.error('Print error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nAwana Print Server running at http://localhost:${PORT}`);
  console.log(`Printer : ${PRINTER_NAME || '(system default)'}`);
  console.log('Leave this window open during check-in. Press Ctrl+C to stop.\n');
});
