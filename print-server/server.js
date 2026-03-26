// Awana Label Print Server
// Started by install-and-run.ps1 — listens on http://localhost:3456
// Accepts POST /print and silently prints a 4×2 in label via pdf-to-printer.

'use strict';

const express = require('express');
const cors    = require('cors');
const { print } = require('pdf-to-printer');
const PDFDocument = require('pdfkit');
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

// Columns (when club icon is present)
const ICON_COL_W  = 84;                // left icon zone width
const DIVIDER_X   = BX + ICON_COL_W;
const TEXT_X      = DIVIDER_X + 8;    // right text zone start
const TEXT_W      = BX + BW - TEXT_X; // right text zone width (184 pt)

// ── CSV loading ───────────────────────────────────────────────────────────────
// install-and-run.ps1 downloads clubbers.csv into this directory before the
// server starts. We load it once here and use it to look up allergy notes,
// handbook group, birthdate, and club for each child that checks in.

function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Double-quote inside a quoted field is an escaped quote
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field.trim());
  return fields;
}

function loadClubbers() {
  const csvPath = path.join(__dirname, 'clubbers.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('[csv] clubbers.csv not found — allergy/handbook/birthday features disabled');
    return [];
  }
  try {
    const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    // Normalise header names: lowercase, spaces → underscores
    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
    return lines.slice(1).map(line => {
      const values = parseCsvLine(line);
      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      return row;
    });
  } catch (e) {
    console.log(`[csv] Failed to load clubbers.csv: ${e.message}`);
    return [];
  }
}

// Try multiple possible column name variations for a given field.
// TwoTimTwo may use "First Name", "firstname", "first_name", etc.
function getField(row, ...aliases) {
  for (const alias of aliases) {
    const key = alias.toLowerCase().replace(/\s+/g, '_');
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

function findClubber(clubbers, firstName, lastName) {
  const fn = firstName.toLowerCase().trim();
  const ln = lastName.toLowerCase().trim();
  return clubbers.find(row => {
    const rf   = getField(row, 'first_name', 'first', 'firstname').toLowerCase();
    const rl   = getField(row, 'last_name', 'last', 'lastname').toLowerCase();
    const full = getField(row, 'name', 'full_name').toLowerCase();
    return (rf === fn && rl === ln) || full === `${fn} ${ln}`;
  }) || null;
}

// Load CSV at startup so it is ready for the first print request
const CLUBBERS = loadClubbers();
console.log(`[csv] Loaded ${CLUBBERS.length} clubbers`);

// ── Birthday check ─────────────────────────────────────────────────────────────
// Birthday week is only shown for these club programmes — Trek and others
// are intentionally excluded per the product spec.
const BIRTHDAY_CLUBS = /\b(puggles|cubbies|sparks|t&t|t\s+and\s+t)\b/i;

function isBirthdayThisWeek(birthdateStr) {
  if (!birthdateStr) return false;
  const m = birthdateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const bMonth = parseInt(m[2], 10);
  const bDay   = parseInt(m[3], 10);
  // Walk forward 7 days from today and check if month+day matches
  const today = new Date();
  for (let i = 0; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    if (d.getMonth() + 1 === bMonth && d.getDate() === bDay) return true;
  }
  return false;
}

// ── Food allergy parser ────────────────────────────────────────────────────────
// Returns an array of { iconPath } objects for any food allergies found in the
// child's Notes column.  Non-food medical conditions and explicitly excluded
// terms are stripped from the string before allergy keywords are tested, to
// prevent false positives (e.g. "penicillin" near "nut").
//
// All icon paths are SVG path strings defined in a ±9-unit coordinate space.
// Use doc.transform(scale,0,0,scale,cx,cy) to position and size them on the PDF.
function parseFoodAllergies(notesString) {
  if (!notesString || !notesString.trim()) return [];

  // "no longer X" is consumed up to the next sentence delimiter so that
  // "no longer has nut allergy" does not leave a dangling "nut allergy" match.
  const notes = notesString
    .replace(/no\s+longer[^.;,]*/gi, '')
    .replace(/\b(penicillin|sulfa|asthma|adhd|autism|asd|pineapple|kiwi|none)\b/gi, '')
    .replace(/\bn\/a\b/gi, '')
    .toLowerCase();

  const found = [];

  // Dye / artificial colouring — liquid drop shape
  if (/\b(dye|dyes|artificial|coloring|colouring)\b/.test(notes)) {
    found.push({
      iconPath: 'M 0,-9 C 5,-4 9,2 9,5 A 9,9 0 0,1 -9,5 C -9,2 -5,-4 0,-9 Z'
    });
  }

  // Peanut / tree nut — figure-8 / two-lobe peanut silhouette
  if (/\b(peanuts?|nuts?)\b/.test(notes)) {
    found.push({
      iconPath: 'M -9,0 C -9,-9 0,-9 0,0 C 0,-9 9,-9 9,0 C 9,9 0,9 0,0 C 0,9 -9,9 -9,0 Z'
    });
  }

  // Dairy / lactose — cheese wedge (filled triangle)
  if (/\b(dairy|milk|cheese|lactose)\b/.test(notes)) {
    found.push({
      iconPath: 'M 0,-9 L 9,7 L -9,7 Z'
    });
  }

  // Gluten / wheat / celiac — grain oval with X strike-through
  if (/\b(gluten|wheat|celiac|coeliac)\b/.test(notes)) {
    found.push({
      iconPath:
        'M 0,-9 C 6,-7 9,-2 9,0 C 9,2 6,7 0,9 C -6,7 -9,2 -9,0 C -9,-2 -6,-7 0,-9 Z ' +
        'M -8,-6 L -6,-8 L 8,6 L 6,8 Z ' +   // diagonal /
        'M 6,-8 L 8,-6 L -6,8 L -8,6 Z'        // diagonal \
    });
  }

  return found;
}

// ── Birthday icon — gift box with bow ─────────────────────────────────────────
// Defined in ±9-unit space. Draw with doc.transform() to position and scale.
const BIRTHDAY_ICON_PATH =
  'M -8,1 L 8,1 L 8,9 L -8,9 Z ' +                            // box body
  'M -9,-1 L 9,-1 L 9,1 L -9,1 Z ' +                           // lid band
  'M 0,-1 C -3,-1 -7,-5 -4,-7 C -2,-8 0,-4 0,-1 Z ' +          // bow left loop
  'M 0,-1 C 3,-1 7,-5 4,-7 C 2,-8 0,-4 0,-1 Z';                // bow right loop

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
//
// Layout overview (all coordinates in points; badge origin is BX=6, BY=6):
//
//  ┌──────────────────────────────────────────────────────────┐
//  │ [club    │  First Name (bold, auto-sized)    [🎁 bday] │
//  │  image ] │  Last Name  (20pt)                           │
//  │          │  ─────────────────                           │
//  │          │  Club Name  (italic 12pt)                    │
//  │          │  Handbook Group (italic 8pt, if set)         │
//  │  ·  ·  · · · · · · allergy icons · · · · · · ·  ·  ·  │
//  └──────────────────────────────────────────────────────────┘
//
// csvRow is the matched row from clubbers.csv (or null if not found).
async function generateLabel(firstName, lastName, clubName, clubImageBuffer, csvRow) {

  // ── Extract per-child fields from the CSV row ──────────────────────────────
  const notes         = csvRow ? getField(csvRow, 'notes', 'note')                        : '';
  const handbookGroup = csvRow ? getField(csvRow, 'handbook_group', 'group', 'handbook')  : '';
  const birthdateStr  = csvRow ? getField(csvRow, 'birthdate', 'birth_date', 'birthday', 'dob') : '';
  const csvClub       = csvRow ? getField(csvRow, 'club', 'club_name', 'clubname')        : '';
  const effectiveClub = csvClub || clubName;

  // ── Feature flags ──────────────────────────────────────────────────────────
  const allergies    = parseFoodAllergies(notes);
  const hasAllergies = allergies.length > 0;

  // Handbook group is suppressed when blank or a generic catch-all value
  const GENERIC_GROUPS = /^(all|general|unknown|unassigned)$/i;
  const showGroup = handbookGroup.trim() !== '' && !GENERIC_GROUPS.test(handbookGroup.trim());

  // Birthday indicator only for eligible clubs with an upcoming birthday
  const showBirthday = BIRTHDAY_CLUBS.test(effectiveClub) && isBirthdayThisWeek(birthdateStr);

  // ── PDF document setup ────────────────────────────────────────────────────
  const pdfPath = path.join(os.tmpdir(), `awana-${Date.now()}.pdf`);
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0 });
  const out  = fs.createWriteStream(pdfPath);
  doc.pipe(out);

  const hasClubIcon = !!clubImageBuffer;
  const textX = hasClubIcon ? TEXT_X      : BX + 8;
  const textW = hasClubIcon ? TEXT_W      : BW - 16;

  // ── Badge border ──────────────────────────────────────────────────────────
  doc.roundedRect(BX, BY, BW, BH, CORNER)
     .lineWidth(1.5).strokeColor('#000000').stroke();

  // ── Left club icon panel (when image available) ───────────────────────────
  if (hasClubIcon) {
    // Soft gray background clipped to badge shape
    doc.save();
    doc.roundedRect(BX, BY, BW, BH, CORNER).clip();
    doc.rect(BX, BY, ICON_COL_W, BH).fillColor('#f4f4f4').fill();
    doc.restore();

    // Subtle vertical divider between icon column and text
    doc.moveTo(DIVIDER_X, BY + 12)
       .lineTo(DIVIDER_X, BY + BH - 12)
       .lineWidth(0.5).strokeColor('#d0d0d0').stroke();

    // Club icon centred in the icon zone (56×56 pt)
    const iconSize = 56;
    const iconX = BX + (ICON_COL_W - iconSize) / 2;
    const iconY = BY + (BH - iconSize) / 2;
    try {
      doc.image(clubImageBuffer, iconX, iconY, {
        width: iconSize, height: iconSize,
        fit: [iconSize, iconSize], align: 'center', valign: 'center'
      });
    } catch {
      // Image decode failed — placeholder circle
      doc.circle(BX + ICON_COL_W / 2, BY + BH / 2, 20)
         .lineWidth(1).strokeColor('#aaa').stroke();
    }
  }

  // ── Birthday gift icon (top-right corner of badge) ────────────────────────
  // Drawn in warm orange so it stands out. Placed in the top-right corner of
  // the full badge (including the icon column area) to avoid text collision.
  if (showBirthday) {
    const BDAY_SCALE = 0.85;         // ±9 unit path → ~15 pt rendered
    const BDAY_CX    = BX + BW - 14; // 14 pt from right edge
    const BDAY_CY    = BY + 14;      // 14 pt from top edge
    doc.save();
    doc.transform(BDAY_SCALE, 0, 0, BDAY_SCALE, BDAY_CX, BDAY_CY);
    doc.path(BIRTHDAY_ICON_PATH).fillColor('#e07020').fill();
    doc.restore();
  }

  // ── Text block: measure total height for vertical centring ────────────────
  const hasLast = lastName.trim().length > 0;
  const hasClub = clubName.trim().length > 0;

  const fs1 = fitFontSize(doc, firstName, 'Helvetica-Bold', textW);
  const fs2 = 20;   // last name
  const fs3 = 12;   // club name
  const fs4 = 8;    // handbook group
  const GAP = 4;    // gap between name lines
  const SEP = 9;    // separator gap: 4 + 1pt line + 4

  let blockH = fs1;
  if (hasLast)   blockH += GAP + fs2;
  if (hasClub)   blockH += SEP + fs3;
  if (showGroup) blockH += 3 + fs4;

  // Reserve the bottom strip for allergy icons; compress the vertical centre
  // zone so the name block never overlaps the icons.
  const ALLERGY_STRIP_H = 22;
  const availH  = hasAllergies ? BH - ALLERGY_STRIP_H : BH;
  const centerY = BY + availH / 2;
  let y = centerY - blockH / 2;

  // If the birthday icon is in the top-right, push the text block down enough
  // so the first name doesn't print directly behind the icon.
  if (showBirthday) y = Math.max(y, BY + 26);

  // ── First name ────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(fs1).fillColor('#000000');
  doc.text(firstName, textX, y, { width: textW, align: 'center', lineBreak: false });
  y += fs1;

  // ── Last name ─────────────────────────────────────────────────────────────
  if (hasLast) {
    y += GAP;
    doc.font('Helvetica').fontSize(fs2).fillColor('#222222');
    doc.text(lastName, textX, y, { width: textW, align: 'center', lineBreak: false });
    y += fs2;
  }

  // ── Club name (with thin separator above) ─────────────────────────────────
  if (hasClub) {
    y += 4;
    const sepMargin = textW * 0.1;
    doc.moveTo(textX + sepMargin, y + 0.5)
       .lineTo(textX + textW - sepMargin, y + 0.5)
       .lineWidth(0.5).strokeColor('#cccccc').stroke();
    y += 5;
    doc.font('Helvetica-Oblique').fontSize(fs3).fillColor('#444444');
    doc.text(clubName, textX, y, { width: textW, align: 'center', lineBreak: false });
    y += fs3;
  }

  // ── Handbook group (directly below club name) ─────────────────────────────
  if (showGroup) {
    y += 3;
    doc.font('Helvetica-Oblique').fontSize(fs4).fillColor('#666666');
    doc.text(handbookGroup.trim(), textX, y, { width: textW, align: 'center', lineBreak: false });
  }

  // ── Allergy icons (bottom strip, icons only — no text labels) ────────────
  // Icons are SVG paths defined in ±9-unit space, scaled and positioned using
  // doc.transform(scale,0,0,scale,centerX,centerY).
  if (hasAllergies) {
    const ICON_SCALE = 0.65;                  // ±9 units → ~11.7 pt rendered
    const ICON_SIZE  = 9 * ICON_SCALE * 2;   // diameter ≈ 11.7 pt
    const ICON_GAP   = 7;
    const stripCY    = BY + BH - ALLERGY_STRIP_H / 2;  // vertical centre of strip

    // Light separator line at the top of the allergy strip
    doc.moveTo(BX + 8, BY + BH - ALLERGY_STRIP_H)
       .lineTo(BX + BW - 8, BY + BH - ALLERGY_STRIP_H)
       .lineWidth(0.4).strokeColor('#e0e0e0').stroke();

    // Centre the row of icons across the full badge width
    const totalW = allergies.length * ICON_SIZE + (allergies.length - 1) * ICON_GAP;
    let ax = BX + (BW - totalW) / 2 + ICON_SIZE / 2;  // cx of first icon

    for (const { iconPath } of allergies) {
      doc.save();
      doc.transform(ICON_SCALE, 0, 0, ICON_SCALE, ax, stripCY);
      doc.path(iconPath).fillColor('#cc0000').fill();
      doc.restore();
      ax += ICON_SIZE + ICON_GAP;
    }
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME || '(default)', clubbers: CLUBBERS.length });
});

app.get('/bookmarklet.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'bookmarklet.html'));
});

app.post('/print', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
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

  // Look up the child in the CSV for allergy, handbook group, and birthday data
  const csvRow = findClubber(CLUBBERS, firstName, lastName);
  console.log(`[print] ${firstName} ${lastName} | club: ${clubName || '—'} | csv: ${csvRow ? 'matched' : 'not found'} | printer: ${PRINTER_NAME || 'default'}`);

  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    const pdfPath = await generateLabel(firstName, lastName, clubName, clubImageBuffer, csvRow);
    const opts = PRINTER_NAME ? { printer: PRINTER_NAME } : {};
    await print(pdfPath, opts);
    fs.unlink(pdfPath, () => {});
    res.json({ success: true });
  } catch (err) {
    console.error('[print] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Awana Print Server  •  http://localhost:${PORT}`);
  console.log(`  Printer : ${PRINTER_NAME || '(system default)'}`);
  console.log('  Waiting for check-ins. Press Ctrl+C to stop.\n');
});
