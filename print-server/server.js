const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { print, getPrinters } = require('pdf-to-printer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3456;

// Load printer name: env var takes priority, then config.json
let printerName = process.env.PRINTER_NAME || '';
const configPath = path.join(__dirname, 'config.json');
try {
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!printerName && cfg.printerName) printerName = cfg.printerName;
} catch {}

if (!printerName) {
  console.error('ERROR: No printer configured.');
  console.error('  Set the PRINTER_NAME environment variable, or run install-and-run.ps1 to configure.');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

// Launch puppeteer browser once at startup and reuse across requests
let browser = null;
async function getBrowser() {
  if (!browser || !browser.connected) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  return browser;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', printer: printerName });
});

app.get('/printers', async (req, res) => {
  try {
    const printers = await getPrinters();
    res.json(printers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/print', async (req, res) => {
  const { name, firstName: reqFirst, lastName: reqLast, clubName = '' } = req.body || {};

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = reqFirst || '';
    lastName = reqLast || '';
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName required' });
  }

  console.log(`POST /print — ${firstName} ${lastName} (${clubName || 'no club'})`);

  try {
    const pdfPath = await generateLabel(firstName, lastName, clubName);
    await print(pdfPath, { printer: printerName });
    fs.unlink(pdfPath, () => {});
    res.json({ success: true });
  } catch (err) {
    console.error('Print error:', err);
    res.status(500).json({ error: err.message });
  }
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function generateLabel(firstName, lastName, clubName) {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <style>
      @page { size: 4in 2in; margin: 0; }
      body {
        margin: 0; padding: 0;
        width: 4in; height: 2in;
        display: flex; align-items: center; justify-content: center;
        font-family: Helvetica, Arial, sans-serif;
        overflow: hidden;
      }
      .badge {
        width: 3.8in; height: 1.8in;
        border: 2px solid black; border-radius: 15px;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        text-align: center; box-sizing: border-box; padding: 5px;
      }
      .first-name { font-size: 48pt; font-weight: bold; line-height: 1.1; word-break: break-word; max-width: 100%; }
      .last-name  { font-size: 22pt; margin-top: 2pt; }
      .club-name  { font-size: 14pt; font-style: italic; margin-top: 8pt; border-top: 1px solid #ccc; padding-top: 4pt; width: 70%; }
    </style>
  </head>
  <body>
    <div class="badge">
      <div class="first-name">${escapeHtml(firstName)}</div>
      ${lastName ? `<div class="last-name">${escapeHtml(lastName)}</div>` : ''}
      ${clubName ? `<div class="club-name">${escapeHtml(clubName)}</div>` : ''}
    </div>
  </body>
</html>`;

  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfPath = path.join(os.tmpdir(), `label-${Date.now()}.pdf`);
    await page.pdf({
      path: pdfPath,
      width: '4in',
      height: '2in',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' }
    });
    return pdfPath;
  } finally {
    await page.close();
  }
}

// Warm up the browser on startup so the first print isn't slow
getBrowser()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Print server running at http://localhost:${PORT}`);
      console.log(`Printer: ${printerName}`);
    });
  })
  .catch(err => {
    console.error('Failed to launch browser:', err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
