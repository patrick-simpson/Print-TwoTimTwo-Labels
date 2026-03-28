// Awana Label Print Server
// Started by install-and-run.ps1 — listens on http://localhost:3456
// Accepts POST /print and silently prints a 4×2 in label via pdf-to-printer.

'use strict';

// ── Process-level safety net ──────────────────────────────────────────────────
// Last line of defence: if something unexpected bubbles all the way up, log it
// but NEVER crash the process — a live event cannot afford a dead print server.
process.on('uncaughtException',  err => console.error('[fatal] Uncaught exception (server kept alive):', err));
process.on('unhandledRejection', err => console.error('[fatal] Unhandled rejection (server kept alive):', err));

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

// Columns (when icon is present)
const ICON_COL_W  = 84;                // left icon zone width
const DIVIDER_X   = BX + ICON_COL_W;
const TEXT_X      = DIVIDER_X + 8;    // right text zone start
const TEXT_W      = BX + BW - TEXT_X; // right text zone width

// ── In-memory CSV snapshot ────────────────────────────────────────────────────
// Populated at startup and refreshed on every POST /print so changes to
// clubbers.csv (e.g. added mid-event) are picked up automatically.
let clubbers = [];

// ── CSV parser ────────────────────────────────────────────────────────────────
// Parses a raw CSV string into an array of plain objects keyed by canonical
// field names.  Handles both the TwoTimTwo export (quoted fields, spaces in
// headers like "First Name") and the manual clubbers-template.csv format
// ("FirstName").  Returns [] on empty input or any parse error — never throws.

// Map every known header variation to a canonical key.
// Add new mappings here if TwoTimTwo ever renames a column.
const HEADER_MAP = {
  // canonical ← variations (all compared lowercase, spaces/underscores stripped)
  'firstname':      'FirstName',
  'first name':     'FirstName',
  'first_name':     'FirstName',
  'lastname':       'LastName',
  'last name':      'LastName',
  'last_name':      'LastName',
  'birthdate':      'Birthdate',
  'birth date':     'Birthdate',
  'birthday':       'Birthdate',
  'date of birth':  'Birthdate',
  'dob':            'Birthdate',
  'allergies':      'Allergies',
  'allergy':        'Allergies',
  'notes':          'Notes',
  'handbookgroup':  'HandbookGroup',
  'handbook group': 'HandbookGroup',
  'handbook_group': 'HandbookGroup',
  'club':           'Club',
  'group':          'Group',
  'color':          'Color',
  'grade':          'Grade',
  'gender':         'Gender',
  'clubber id':     'ClubberID',
  'clubberid':      'ClubberID',
  'inactive':       'Inactive',
  'book':           'Book',
};

function normalizeHeader(raw) {
  const key = raw.toLowerCase().replace(/[_\s]+/g, ' ').trim();
  return HEADER_MAP[key] || raw;  // keep original if no mapping found
}

function parseCSV(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    // The TwoTimTwo CSV has quoted fields that can contain newlines (e.g. Notes,
    // Emergency Contact).  We need a proper stateful parser, not a simple
    // line-by-line split.
    const rows = [];
    let headers = [];
    let headerParsed = false;
    let pos = 0;
    const len = raw.length;

    // Parse one field starting at `pos`. Returns the field value and advances
    // `pos` past the delimiter (comma or end-of-record).
    function nextField() {
      // Skip leading whitespace (but not newlines — those are record separators)
      while (pos < len && raw[pos] === ' ') pos++;

      if (pos >= len) return '';

      if (raw[pos] === '"') {
        // Quoted field — collect until closing quote
        pos++;  // skip opening quote
        let val = '';
        while (pos < len) {
          if (raw[pos] === '"') {
            if (pos + 1 < len && raw[pos + 1] === '"') {
              // Escaped quote
              val += '"';
              pos += 2;
            } else {
              // Closing quote
              pos++;  // skip closing quote
              break;
            }
          } else {
            val += raw[pos];
            pos++;
          }
        }
        // Skip any whitespace between closing quote and delimiter
        while (pos < len && raw[pos] === ' ') pos++;
        return val.trim();
      } else {
        // Unquoted field — collect until comma or newline
        let val = '';
        while (pos < len && raw[pos] !== ',' && raw[pos] !== '\n' && raw[pos] !== '\r') {
          val += raw[pos];
          pos++;
        }
        return val.trim();
      }
    }

    function parseRecord() {
      const fields = [];
      while (pos < len) {
        fields.push(nextField());
        if (pos < len && raw[pos] === ',') {
          pos++;  // skip comma, continue to next field
        } else {
          // End of record (newline or EOF)
          break;
        }
      }
      // Skip trailing newlines between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n')) pos++;
      return fields;
    }

    while (pos < len) {
      // Skip blank lines / whitespace between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n' || raw[pos] === ' ')) pos++;
      if (pos >= len) break;

      // Stop at TwoTimTwo footer lines like "Clubber Count=116" or "FILTER,VALUE"
      const restOfLine = raw.slice(pos, raw.indexOf('\n', pos) === -1 ? len : raw.indexOf('\n', pos));
      if (/^Clubber Count=/i.test(restOfLine) || /^FILTER,/i.test(restOfLine)) break;

      const fields = parseRecord();
      if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;

      if (!headerParsed) {
        headers = fields.map(normalizeHeader);
        headerParsed = true;
        continue;
      }

      const obj = {};
      headers.forEach((h, i) => { obj[h] = fields[i] !== undefined ? fields[i] : ''; });
      rows.push(obj);
    }

    return rows;
  } catch (e) {
    console.warn('[csv] Unexpected parse error:', e.message);
    return [];
  }
}

// ── Load clubbers from CSV ────────────────────────────────────────────────────
// Reads clubbers.csv from the same directory as this script.
// Gracefully handles every failure mode so the server always keeps running:
//   ENOENT  — file doesn't exist yet (first run, or file was deleted)
//   EBUSY   — PowerShell is currently overwriting the file mid-event
//   other   — malformed data, permissions, etc.
function loadClubbers() {
  const csvPath = path.join(__dirname, 'clubbers.csv');
  try {
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(raw);
    if (rows.length > 0) {
      const sample = rows[0];
      const keys = Object.keys(sample);
      const has = (k) => keys.includes(k) ? k : null;
      const detected = [has('FirstName'), has('LastName'), has('Birthdate'), has('HandbookGroup'), has('Allergies'), has('Notes')].filter(Boolean);
      console.log(`[csv] Loaded ${rows.length} clubber(s) from clubbers.csv (columns: ${detected.join(', ')})`);
      // Log a few sample names to verify parsing
      const samples = rows.slice(0, 3).map(r => `${r.FirstName} ${r.LastName}`).join(', ');
      console.log(`[csv] Sample names: ${samples}`);
    } else {
      console.log('[csv] clubbers.csv is empty or has no data rows');
    }
    return rows;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('[csv] clubbers.csv not found — running without enrichment data');
    } else if (e.code === 'EBUSY') {
      // EBUSY: PowerShell may be writing this file mid-event.
      // Skip this reload; the next request will try again automatically.
      console.warn('[csv] clubbers.csv is busy (being written) — skipping reload');
    } else {
      console.warn('[csv] Failed to read/parse clubbers.csv:', e.message);
    }
    return [];
  }
}

// ── Find a child in the CSV by name ──────────────────────────────────────────
// Case-insensitive and whitespace-trimmed on both sides so "alice " matches
// "Alice" in the spreadsheet. Returns the row object or null if not found.
function findClubber(firstName, lastName) {
  const fn = (firstName || '').toLowerCase().trim();
  const ln = (lastName  || '').toLowerCase().trim();
  return clubbers.find(r =>
    (r.FirstName || '').toLowerCase().trim() === fn &&
    (r.LastName  || '').toLowerCase().trim() === ln
  ) || null;
}

// ── Birthday-week check ───────────────────────────────────────────────────────
// Returns true if the child's next birthday falls within the next 7 days
// (inclusive of today). Handles year-wrapping correctly: if today is Dec 30
// and the birthday is Jan 2, this returns true.
// Returns false — without throwing — for blank, null, "N/A", or any
// unparseable date string.
function isBirthdayWeek(birthdateStr) {
  // Guard: reject obviously bad input before touching Date
  if (!birthdateStr || String(birthdateStr).trim() === '' || birthdateStr === 'N/A') {
    return false;
  }
  try {
    // Normalise MM/DD/YYYY → YYYY-MM-DD so Date() parses it correctly on all
    // platforms (the ISO form is the only reliably portable format in Node).
    let normalised = String(birthdateStr).trim();
    const slashMatch = normalised.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      normalised = `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`;
    }

    const bday = new Date(normalised);
    // Bail out if the date couldn't be parsed (e.g. "foo", "13/45/2020")
    if (isNaN(bday.getTime())) return false;

    // Use midnight local time for today so day-difference arithmetic is clean
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build the birthday in the current calendar year
    let next = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());

    // year-wrap: if this year's birthday has already passed, look at next year
    if (next < today) {
      next = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
    }

    const diffDays = Math.round((next.getTime() - today.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= 6;
  } catch {
    // Any unexpected error (timezone edge case, etc.) — safe fallback
    return false;
  }
}

// ── Allergy parser ────────────────────────────────────────────────────────────
// Converts the free-text Allergies field from the CSV into a compact array of
// short tokens that can be printed on the label. Returns [] for null/blank.
function parseAllergies(allergiesStr) {
  if (!allergiesStr || !String(allergiesStr).trim()) return [];
  const s = String(allergiesStr);
  const tokens = [];
  if (/nut|peanut|tree.?nut/i.test(s))         tokens.push('NUTS');
  if (/dairy|milk|lactose/i.test(s))            tokens.push('DAIRY');
  if (/gluten|wheat/i.test(s))                  tokens.push('GLUTEN');
  if (/\begg\b/i.test(s))                       tokens.push('EGG');  // \b avoids matching "eggnog" as both EGG and NUTS
  if (/shellfish|shrimp|crab/i.test(s))         tokens.push('SHELLFISH');
  return tokens;
}

// ── Text truncation helper ────────────────────────────────────────────────────
// Returns text trimmed and suffixed with '…' if it exceeds maxWidth at the
// given font/size. Prevents pdfkit text from printing off the edge of the label.
function truncateText(doc, text, fontName, fontSize, maxWidth) {
  doc.font(fontName).fontSize(fontSize);
  if (doc.widthOfString(text) <= maxWidth) return text;
  let t = text;
  // Trim one character at a time from the right until it fits
  while (t.length > 0 && doc.widthOfString(t + '…') > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

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
// allergyTokens : string[] from parseAllergies()  (default: no allergies)
// handbookGroup : string from CSV HandbookGroup   (default: not shown)
// isBirthday    : boolean from isBirthdayWeek()   (default: no banner)
async function generateLabel(
  firstName, lastName, clubName, clubImageBuffer,
  allergyTokens = [], handbookGroup = '', isBirthday = false
) {
  // Guard the enrichment parameters defensively in case the caller passes null
  allergyTokens = Array.isArray(allergyTokens) ? allergyTokens : [];
  handbookGroup = (handbookGroup || '').trim();
  isBirthday    = !!isBirthday;

  // pdfPath is declared here so the caller's finally block can delete it even
  // if an error is thrown partway through generation.
  const pdfPath = path.join(os.tmpdir(), `awana-${Date.now()}.pdf`);

  try {
    const doc = new PDFDocument({ size: [PAGE_H, PAGE_W], margin: 0, layout: 'landscape' });
    const out  = fs.createWriteStream(pdfPath);

    doc.pipe(out);

    const hasIcon = !!clubImageBuffer;
    const textX   = hasIcon ? TEXT_X : BX + 8;
    const textW   = hasIcon ? TEXT_W : BW - 16;

    // ── Badge border ──────────────────────────────────────────────────────────
    doc.roundedRect(BX, BY, BW, BH, CORNER)
       .lineWidth(1.5).strokeColor('#000000').stroke();

    // ── Left icon panel ───────────────────────────────────────────────────────
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

    // ── Text area ─────────────────────────────────────────────────────────────
    const hasLast  = lastName.trim().length > 0;
    const hasClub  = clubName.trim().length > 0 && !hasIcon;
    const hasGroup = handbookGroup.length > 0;
    const hasAllergy = allergyTokens.length > 0;

    // Reserve space at the bottom of the badge for the allergy strip
    // (14 pt tall) so the main text block doesn't overlap it.
    const ALLERGY_STRIP_H = hasAllergy ? 14 : 0;

    // Font sizes
    const fs1 = fitFontSize(doc, firstName, 'Helvetica-Bold', textW);
    const fs2 = 20;  // last name
    const fs3 = 12;  // club name
    const fs4 = 10;  // handbook group
    const fs5 = 9;   // birthday banner
    const GAP = 4;
    const SEP = 9;   // separator gap (4 + 1 line + 4)

    // Measure total text block height so it can be vertically centred
    let blockH = fs1;
    if (hasLast)     blockH += GAP + fs2;
    if (hasClub)     blockH += SEP + fs3;
    if (hasGroup)    blockH += GAP + fs4;
    if (isBirthday)  blockH += GAP + fs5;

    // Usable vertical space above the allergy strip
    const usableH = BH - ALLERGY_STRIP_H;
    const centerY = BY + usableH / 2;
    let y = centerY - blockH / 2;

    // ── First name ────────────────────────────────────────────────────────────
    // fitFontSize already shrinks the font; truncateText guards the minSize edge
    // case where even 18pt text is wider than the column.
    const safeFirst = truncateText(doc, firstName, 'Helvetica-Bold', fs1, textW);
    doc.font('Helvetica-Bold').fontSize(fs1).fillColor('#000000');
    doc.text(safeFirst, textX, y, { width: textW, align: 'center', lineBreak: false });
    y += fs1;

    // ── Last name ─────────────────────────────────────────────────────────────
    if (hasLast) {
      y += GAP;
      const safeLast = truncateText(doc, lastName, 'Helvetica', fs2, textW);
      doc.font('Helvetica').fontSize(fs2).fillColor('#222222');
      doc.text(safeLast, textX, y, { width: textW, align: 'center', lineBreak: false });
      y += fs2;
    }

    // ── Club name with separator ──────────────────────────────────────────────
    if (hasClub) {
      y += 4;
      const sepMargin = textW * 0.1;
      doc.moveTo(textX + sepMargin, y + 0.5)
         .lineTo(textX + textW - sepMargin, y + 0.5)
         .lineWidth(0.5).strokeColor('#cccccc').stroke();
      y += 5;
      const safeClub = truncateText(doc, clubName, 'Helvetica-Oblique', fs3, textW);
      doc.font('Helvetica-Oblique').fontSize(fs3).fillColor('#444444');
      doc.text(safeClub, textX, y, { width: textW, align: 'center', lineBreak: false });
      y += fs3;
    }

    // ── Handbook group ────────────────────────────────────────────────────────
    if (hasGroup) {
      y += GAP;
      // Truncate to ~30 visible characters before passing to pdfkit so that an
      // unusually long group string (e.g. "Advanced T&T Handbook Section 4B") is
      // clipped cleanly rather than overflowing the right edge of the label.
      let groupStr = handbookGroup.length > 30
        ? handbookGroup.slice(0, 29) + '…'
        : handbookGroup;
      groupStr = truncateText(doc, groupStr, 'Helvetica-Oblique', fs4, textW);
      doc.font('Helvetica-Oblique').fontSize(fs4).fillColor('#666666');
      doc.text(groupStr, textX, y, { width: textW, align: 'center', lineBreak: false });
      y += fs4;
    }

    // ── Birthday banner ───────────────────────────────────────────────────────
    if (isBirthday) {
      y += GAP;
      doc.font('Helvetica-Bold').fontSize(fs5).fillColor('#c0392b');
      doc.text('Happy Birthday!', textX, y, { width: textW, align: 'center', lineBreak: false });
    }

    // ── Allergy strip ─────────────────────────────────────────────────────────
    // Printed as a solid red bar at the bottom of the badge so it is visually
    // unmissable and can't be confused with regular label text.
    if (hasAllergy) {
      const stripY = BY + BH - ALLERGY_STRIP_H;

      // Clip the fill to the rounded badge so the strip doesn't bleed outside
      doc.save();
      doc.roundedRect(BX, BY, BW, BH, CORNER).clip();
      doc.rect(BX, stripY, BW, ALLERGY_STRIP_H).fillColor('#c0392b').fill();
      doc.restore();

      const allergyText = allergyTokens.join(' • ');
      const safeAllergy = truncateText(doc, allergyText, 'Helvetica-Bold', 8, BW - 16);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
      doc.text(safeAllergy, BX + 8, stripY + 3, { width: BW - 16, align: 'center', lineBreak: false });
    }

    doc.end();
    return new Promise((resolve, reject) => {
      out.on('finish', () => resolve(pdfPath));
      out.on('error', reject);
    });
  } catch (err) {
    // Re-throw so the route handler's catch block can log and respond
    throw err;
  }
}

// ── Express server ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));  // allow base64 image payloads
app.use(express.static(path.join(__dirname, 'public')));  // serve static files (bookmarklet.html, etc)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME || '(default)' });
});

app.get('/roster-status', (req, res) => {
  res.json({ count: clubbers.length });
});

// Explicit route for bookmarklet page
app.get('/bookmarklet.html', (req, res) => {
  const bookmarkletPath = path.join(__dirname, 'public', 'bookmarklet.html');
  res.sendFile(bookmarkletPath);
});

// Serve bookmarklet JS files from project root (one level up from print-server/)
app.get('/bookmarklet.min.js', (req, res) => {
  const filePath = path.join(__dirname, '..', 'bookmarklet.min.js');
  if (fs.existsSync(filePath)) return res.type('js').sendFile(filePath);
  res.status(404).send('bookmarklet.min.js not found');
});
app.get('/bookmarklet.js', (req, res) => {
  const filePath = path.join(__dirname, '..', 'bookmarklet.js');
  if (fs.existsSync(filePath)) return res.type('js').sendFile(filePath);
  res.status(404).send('bookmarklet.js not found');
});

// ── Receive CSV from the bookmarklet (authenticated browser session) ─────────
// The bookmarklet fetches /clubber/csv from the same origin (which has the
// user's session cookies) and POSTs the raw CSV text here so the server can
// write it to clubbers.csv for enriched label data.
app.post('/update-csv', (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'csv field is required (string)' });
  }
  const csvPath = path.join(__dirname, 'clubbers.csv');
  try {
    fs.writeFileSync(csvPath, csv, 'utf8');
    const rows = parseCSV(csv);
    clubbers = rows;
    console.log(`[csv] Updated clubbers.csv from browser (${rows.length} clubber(s))`);
    res.json({ ok: true, count: rows.length });
  } catch (e) {
    console.error('[csv] Failed to write clubbers.csv:', e.message);
    res.status(500).json({ error: 'Failed to write CSV' });
  }
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

  // Reload CSV on every request so mid-event additions are always picked up.
  // If the file is locked or missing, loadClubbers() returns [] and logs a
  // warning — this request continues with a basic label.
  clubbers = loadClubbers();

  // Attempt to enrich the label with data from the CSV
  const record = findClubber(firstName, lastName);

  let allergyTokens, handbookGroup, birthday;
  if (record) {
    // TwoTimTwo CSV has "Notes" instead of a dedicated "Allergies" column.
    // Check Allergies first (manual CSV), fall back to Notes (TwoTimTwo).
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    handbookGroup = record.HandbookGroup || '';
    birthday      = isBirthdayWeek(record.Birthdate);
    console.log(`[csv] Enriched: ${firstName} ${lastName} | group: ${handbookGroup || '(none)'} | allergies: ${allergyTokens.join(', ') || '(none)'} | birthday: ${birthday}`);
  } else {
    // Child not in CSV (new visitor, typo, or CSV unavailable) — print a basic
    // label using only the data from the POST request. No crash, no skip.
    allergyTokens = [];
    handbookGroup = '';
    birthday      = false;
    if (firstName || lastName) {
      console.log(`[csv] '${firstName} ${lastName}' not found in CSV — printing basic label`);
    }
  }

  console.log(`[print] ${firstName} ${lastName} | ${clubName || '—'} | printer: ${PRINTER_NAME || 'default'}`);

  // pdfPath is declared outside try so the finally block can always delete it,
  // even if generateLabel throws before returning the path.
  let pdfPath = null;
  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    pdfPath = await generateLabel(
      firstName, lastName, clubName, clubImageBuffer,
      allergyTokens, handbookGroup, birthday
    );

    const opts = PRINTER_NAME ? { printer: PRINTER_NAME } : {};
    await print(pdfPath, opts);

    res.json({ success: true });
  } catch (err) {
    // Log the error but keep the server alive — the next check-in must still work.
    // A jammed printer or corrupted PDF is not a reason to bring down the server.
    console.error('[print] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // Always clean up the temp PDF, whether printing succeeded or failed.
    // Without this, every failed print leaves a file in the OS temp folder.
    if (pdfPath) fs.unlink(pdfPath, () => {});
  }
});

// ── Start up ──────────────────────────────────────────────────────────────────
// Load clubbers before accepting requests so the first print has data ready
clubbers = loadClubbers();

app.listen(PORT, () => {
  console.log(`\n  Awana Print Server  •  http://localhost:${PORT}`);
  console.log(`  Printer : ${PRINTER_NAME || '(system default)'}`);
  console.log('  Waiting for check-ins. Press Ctrl+C to stop.\n');
});
