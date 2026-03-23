const express   = require('express');
const cors      = require('cors');
const ptp       = require('pdf-to-printer');
const puppeteer = require('puppeteer');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');

const app          = express();
const PORT         = 3456;
const PRINTER_NAME = process.env.PRINTER_NAME || '';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Health check — used by the simulator's "Test Connection" button
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', printer: PRINTER_NAME || '(system default)' });
});

// List printers — used by the simulator's "List Printers" button
app.get('/printers', async (_req, res) => {
  try {
    const printers = await ptp.getPrinters();
    res.json(printers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Print a label — called by the bookmarklet via fetch
app.post('/print', async (req, res) => {
  const { firstName, lastName, clubLogoSrc } = req.body;

  if (!firstName) {
    return res.status(400).json({ error: 'firstName is required' });
  }

  const kvbcLogo = 'https://kvbchurch.twotimtwo.com/images/logos/kvbchurch2.jpg';

  // HTML/CSS matches the bookmarklet's printLabel() exactly
  const html = `<!DOCTYPE html>
<html><head><style>
  @page { size: 4in 2in; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0.1in 0.15in 0.05in;
    width: 4in; height: 2in;
    display: flex; flex-direction: column;
    font-family: Arial, sans-serif; overflow: hidden;
  }
  .main { flex: 1; display: flex; align-items: center; gap: 0.12in; }
  .club-logo { height: 0.7in; width: auto; flex-shrink: 0; }
  .first { font-size: 34pt; font-weight: bold; line-height: 1; margin: 0; }
  .last  { font-size: 19pt; line-height: 1.2; margin: 0; color: #222; }
  .footer { display: flex; justify-content: center; padding-bottom: 0.05in; }
  .kvbc-logo { height: 0.45in; width: auto; }
</style></head><body>
<div class="main">
  ${clubLogoSrc ? `<img class="club-logo" src="${clubLogoSrc}">` : ''}
  <div>
    <div class="first">${firstName}</div>
    ${lastName ? `<div class="last">${lastName}</div>` : ''}
  </div>
</div>
<div class="footer"><img class="kvbc-logo" src="${kvbcLogo}"></div>
</body></html>`;

  let browser;
  let tmp;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({ width: '4in', height: '2in', printBackground: true });
    await browser.close();
    browser = null;

    tmp = path.join(os.tmpdir(), `label-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, pdf);

    await ptp.print(tmp, PRINTER_NAME ? { printer: PRINTER_NAME } : {});
    fs.unlinkSync(tmp);

    res.json({ success: true });
  } catch (e) {
    if (browser) await browser.close().catch(() => {});
    if (tmp && fs.existsSync(tmp)) fs.unlinkSync(tmp);
    console.error('Print error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\nAwana Print Server running at http://localhost:${PORT}`);
  console.log(`Printer: ${PRINTER_NAME || '(system default)'}`);
  console.log('\nLeave this window open during your check-in session.\n');
});
