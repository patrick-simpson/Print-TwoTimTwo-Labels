// Awana Label Print Server
// Started by install-and-run.ps1 — listens on http://localhost:3456
// Accepts POST /print and silently prints a 4×2 in label as PNG via canvas.

'use strict';

// ── Process-level safety net ──────────────────────────────────────────────────
// Last line of defence: if something unexpected bubbles all the way up, log it
// but NEVER crash the process — a live event cannot afford a dead print server.
process.on('uncaughtException',  err => console.error('[fatal] Uncaught exception (server kept alive):', err));
process.on('unhandledRejection', err => console.error('[fatal] Unhandled rejection (server kept alive):', err));

const express = require('express');
const cors    = require('cors');
const { createCanvas, loadImage } = require('canvas');
const { execSync } = require('child_process');
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const PORT         = 3456;
const PRINTER_NAME = process.env.PRINTER_NAME || '';
const SERVER_VERSION = require('./package.json').version;

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
  if (/dye|color/i.test(s))                        tokens.push('DYE');
  return tokens;
}

// ── Text truncation helper ────────────────────────────────────────────────────
// Returns text trimmed and suffixed with '…' if it exceeds maxWidth at the
// given font/size. Prevents pdfkit text from printing off the edge of the label.

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

// ── Auto-size a font to fit within maxWidth (canvas version) ─────────────────
function fitFontSize(ctx, text, fontStyle, maxWidth, maxSize = 32, minSize = 18) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `${fontStyle} ${size}px Helvetica, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return minSize;
}

function truncateTextCanvas(ctx, text, font, maxWidth) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

// ── Draw a rounded rectangle on canvas ───────────────────────────────────────
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Generate the label as a PNG ──────────────────────────────────────────────
// Returns the path to a temporary PNG file (caller must delete it).
const DPI = 300;
const PX_W = Math.round(4 * DPI);  // 1200 px
const PX_H = Math.round(2 * DPI);  // 600 px
const SCALE = DPI / 72;            // convert pt → px

async function generateLabel(
  firstName, lastName, clubName, clubImageBuffer,
  allergyTokens = [], handbookGroup = '', isBirthday = false
) {
  allergyTokens = Array.isArray(allergyTokens) ? allergyTokens : [];
  handbookGroup = (handbookGroup || '').trim();
  isBirthday    = !!isBirthday;

  const pngPath = path.join(os.tmpdir(), `awana-${Date.now()}.png`);

  const canvas = createCanvas(PX_W, PX_H);
  const ctx = canvas.getContext('2d');

  // Scale all drawing from points to pixels
  ctx.scale(SCALE, SCALE);

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const hasIcon = !!clubImageBuffer;
  const textX   = hasIcon ? TEXT_X : BX + 8;
  const textW   = hasIcon ? TEXT_W : BW - 16;

  // ── Badge border ──────────────────────────────────────────────────────────
  roundedRect(ctx, BX, BY, BW, BH, CORNER);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  // ── Left icon panel ───────────────────────────────────────────────────────
  if (hasIcon) {
    ctx.save();
    roundedRect(ctx, BX, BY, BW, BH, CORNER);
    ctx.clip();
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(BX, BY, ICON_COL_W, BH);
    ctx.restore();

    // Subtle vertical divider
    ctx.beginPath();
    ctx.moveTo(DIVIDER_X, BY + 12);
    ctx.lineTo(DIVIDER_X, BY + BH - 12);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = '#d0d0d0';
    ctx.stroke();

    // Club icon image (56×56 pt, centred in the icon zone)
    const iconSize = 56;
    const iconX = BX + (ICON_COL_W - iconSize) / 2;
    const iconY = BY + (BH - iconSize) / 2;
    try {
      const img = await loadImage(clubImageBuffer);
      // Preserve aspect ratio
      const aspect = img.width / img.height;
      let drawW = iconSize, drawH = iconSize;
      if (aspect > 1) { drawH = iconSize / aspect; }
      else { drawW = iconSize * aspect; }
      const dx = iconX + (iconSize - drawW) / 2;
      const dy = iconY + (iconSize - drawH) / 2;
      ctx.drawImage(img, dx, dy, drawW, drawH);
    } catch {
      // Image decode failed — draw a placeholder circle
      ctx.beginPath();
      ctx.arc(BX + ICON_COL_W / 2, BY + BH / 2, 20, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#aaa';
      ctx.stroke();
    }
  }

  // ── Text area ─────────────────────────────────────────────────────────────
  const hasLast  = lastName.trim().length > 0;
  const hasClub  = clubName.trim().length > 0 && !hasIcon;
  const hasGroup = handbookGroup.length > 0;
  const hasAllergy = allergyTokens.length > 0;

  const ALLERGY_STRIP_H = hasAllergy ? 14 : 0;

  // Font sizes (in pt)
  const fs1 = fitFontSize(ctx, firstName, 'bold', textW);
  const fs2 = 20;
  const fs3 = 12;
  const fs4 = 10;
  const fs5 = 9;
  const GAP = 4;
  const SEP = 9;

  let blockH = fs1;
  if (hasLast)     blockH += GAP + fs2;
  if (hasClub)     blockH += SEP + fs3;
  if (hasGroup)    blockH += GAP + fs4;
  if (isBirthday)  blockH += GAP + fs5;

  const usableH = BH - ALLERGY_STRIP_H;
  const centerY = BY + usableH / 2;
  let y = centerY - blockH / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const textCenterX = textX + textW / 2;

  // ── First name ────────────────────────────────────────────────────────────
  const firstFont = `bold ${fs1}px Helvetica, Arial, sans-serif`;
  ctx.font = firstFont;
  const safeFirst = truncateTextCanvas(ctx, firstName, firstFont, textW);
  ctx.fillStyle = '#000000';
  ctx.fillText(safeFirst, textCenterX, y);
  y += fs1;

  // ── Last name ─────────────────────────────────────────────────────────────
  if (hasLast) {
    y += GAP;
    const lastFont = `${fs2}px Helvetica, Arial, sans-serif`;
    ctx.font = lastFont;
    const safeLast = truncateTextCanvas(ctx, lastName, lastFont, textW);
    ctx.fillStyle = '#222222';
    ctx.fillText(safeLast, textCenterX, y);
    y += fs2;
  }

  // ── Club name with separator ──────────────────────────────────────────────
  if (hasClub) {
    y += 4;
    const sepMargin = textW * 0.1;
    ctx.beginPath();
    ctx.moveTo(textX + sepMargin, y + 0.5);
    ctx.lineTo(textX + textW - sepMargin, y + 0.5);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = '#cccccc';
    ctx.stroke();
    y += 5;
    const clubFont = `italic ${fs3}px Helvetica, Arial, sans-serif`;
    ctx.font = clubFont;
    const safeClub = truncateTextCanvas(ctx, clubName, clubFont, textW);
    ctx.fillStyle = '#444444';
    ctx.fillText(safeClub, textCenterX, y);
    y += fs3;
  }

  // ── Handbook group ────────────────────────────────────────────────────────
  if (hasGroup) {
    y += GAP;
    let groupStr = handbookGroup.length > 30
      ? handbookGroup.slice(0, 29) + '…'
      : handbookGroup;
    const groupFont = `italic ${fs4}px Helvetica, Arial, sans-serif`;
    ctx.font = groupFont;
    groupStr = truncateTextCanvas(ctx, groupStr, groupFont, textW);
    ctx.fillStyle = '#666666';
    ctx.fillText(groupStr, textCenterX, y);
    y += fs4;
  }

  // ── Birthday banner ───────────────────────────────────────────────────────
  if (isBirthday) {
    y += GAP;
    ctx.font = `bold ${fs5}px Helvetica, Arial, sans-serif`;
    ctx.fillStyle = '#c0392b';
    ctx.fillText('Happy Birthday!', textCenterX, y);
  }

  // ── Allergy strip ─────────────────────────────────────────────────────────
  if (hasAllergy) {
    const stripY = BY + BH - ALLERGY_STRIP_H;
    ctx.save();
    roundedRect(ctx, BX, BY, BW, BH, CORNER);
    ctx.clip();
    ctx.fillStyle = '#c0392b';
    ctx.fillRect(BX, stripY, BW, ALLERGY_STRIP_H);
    ctx.restore();

    const allergyText = allergyTokens.join(' • ');
    const allergyFont = `bold 8px Helvetica, Arial, sans-serif`;
    ctx.font = allergyFont;
    const safeAllergy = truncateTextCanvas(ctx, allergyText, allergyFont, BW - 16);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(safeAllergy, BX + BW / 2, stripY + 3);
  }

  // Write PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return pngPath;
}

// ── Print a PNG image silently via PowerShell System.Drawing ─────────────────
function printImage(imagePath, printerName) {
  // Escape single quotes in paths/names for PowerShell
  const safePath = imagePath.replace(/'/g, "''");
  const safePrinter = printerName.replace(/'/g, "''");

  const ps = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${safePath}')
$pd = New-Object System.Drawing.Printing.PrintDocument
${printerName ? `$pd.PrinterSettings.PrinterName = '${safePrinter}'` : ''}
$pd.DefaultPageSettings.Landscape = $true
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$pd.add_PrintPage({
  param($sender, $e)
  $e.Graphics.DrawImage($img, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height)
})
$pd.Print()
$img.Dispose()
$pd.Dispose()
`.trim();

  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"')}"`, {
    timeout: 15000,
    windowsHide: true
  });
}

// ── Express server ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));  // allow base64 image payloads
app.use(express.static(path.join(__dirname, 'public')));  // serve static files (bookmarklet.html, etc)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME || '(default)', version: SERVER_VERSION });
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
  const filePath = path.join(__dirname, 'public', 'bookmarklet.min.js');
  if (fs.existsSync(filePath)) return res.type('js').sendFile(filePath);
  res.status(404).send('bookmarklet.min.js not found');
});
app.get('/bookmarklet.js', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'bookmarklet.js');
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

  console.log(`[print] ${firstName} ${lastName} | ${handbookGroup || clubName || "�"} | printer: ${PRINTER_NAME || "default"}`);

  let pngPath = null;
  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    pngPath = await generateLabel(
      firstName, lastName, clubName, clubImageBuffer,
      allergyTokens, handbookGroup, birthday
    );

    printImage(pngPath, PRINTER_NAME);

    res.json({ success: true });
  } catch (err) {
    // Log the error but keep the server alive — the next check-in must still work.
    // A jammed printer or corrupted PDF is not a reason to bring down the server.
    console.error('[print] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
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
