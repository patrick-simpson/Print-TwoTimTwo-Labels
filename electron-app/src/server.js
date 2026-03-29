const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render label HTML into the hidden Electron BrowserWindow and export as PNG.
async function generateLabel(pdfWindow, firstName, lastName, clubName) {
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
        background: white;
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

  await pdfWindow.loadURL('data:text/html,' + encodeURIComponent(html));
  
  // Wait a moment for rendering
  await new Promise(r => setTimeout(r, 100));

  // Capture as PNG (at screen resolution, but we can scale in PowerShell)
  const image = await pdfWindow.webContents.capturePage();
  const pngBuffer = image.toPNG();

  const pngPath = path.join(os.tmpdir(), `label-${Date.now()}.png`);
  fs.writeFileSync(pngPath, pngBuffer);
  return pngPath;
}

// ── Print a PNG image silently via PowerShell System.Drawing ─────────────────
function printImage(imagePath, printerName) {
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

function createServer(printerName, pdfWindow, port) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', printer: printerName });
  });

  app.get('/printers', async (req, res) => {
    try {
      // In Electron context, we might want to use a different way to list printers
      // but let's keep it simple for now as it's not the primary issue.
      res.json([]); 
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/print', async (req, res) => {
    const { name, firstName: reqFirst, lastName: reqLast, clubName = '' } = req.body || {};

    let firstName, lastName;
    if (reqFirst !== undefined) {
      firstName = reqFirst || '';
      lastName  = reqLast  || '';
    } else if (name) {
      const parts = String(name).trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName  = parts.slice(1).join(' ') || '';
    } else {
      return res.status(400).json({ error: 'name or firstName required' });
    }

    console.log(`POST /print — ${firstName} ${lastName} (${clubName || 'no club'})`);

    let pngPath = null;
    try {
      pngPath = await generateLabel(pdfWindow, firstName, lastName, clubName);
      printImage(pngPath, printerName);
      res.json({ success: true });
    } catch (err) {
      console.error('Print error:', err);
      res.status(500).json({ error: err.message });
    } finally {
      if (pngPath && fs.existsSync(pngPath)) {
        fs.unlink(pngPath, () => {});
      }
    }
  });

  const server = app.listen(port, () => {
    console.log(`Print server running at http://localhost:${port}`);
    console.log(`Printer: ${printerName}`);
  });

  return server;
}

module.exports = createServer;
