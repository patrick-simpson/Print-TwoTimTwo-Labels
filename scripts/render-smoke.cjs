// Render smoke test for the print server's label pipeline.
//
// Verifies, on any OS (no printer needed), that:
//   1. A bare require() of print-server/server.js has no side effects
//      (no port bind, no update check, no timers).
//   2. The @napi-rs/canvas render path produces real 1200x600 PNGs through
//      the actual /preview route, including CSV enrichment (allergies,
//      birthday, handbook group) and long/emoji names.
//
// Usage: node scripts/render-smoke.cjs [outDir]
// PNGs are written to outDir (default: scripts/render-smoke-out) so CI can
// upload them as artifacts for visual comparison between releases.

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const http = require('http');

const OUT_DIR = process.argv[2] || path.join(__dirname, 'render-smoke-out');
const LABEL_W = 1200; // 4in @ 300dpi
const LABEL_H = 600;  // 2in @ 300dpi

// Isolated data dir with a roster exercising the enrichment paths.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-smoke-'));
process.env.AWANA_DATA_DIR = dataDir;

const inAWeek = new Date(Date.now() + 3 * 86400000);
const birthdate = `${inAWeek.getMonth() + 1}/${inAWeek.getDate()}/2018`;
fs.writeFileSync(path.join(dataDir, 'clubbers.csv'), [
  'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease',
  `Peanut,Allergykid,${birthdate},"peanuts, tree nuts",Sparks A,Yes`,
  'Maximiliano-Alexander,Featherstonehaugh-Smythe,1/1/2017,,T&T Boys 3,Yes',
].join('\n'));

const CASES = [
  { file: 'enriched-allergy-birthday.png', query: 'firstName=Peanut&lastName=Allergykid&clubName=Sparks' },
  { file: 'long-name.png',                 query: 'firstName=Maximiliano-Alexander&lastName=Featherstonehaugh-Smythe&clubName=T%26T' },
  { file: 'visitor-no-roster-match.png',   query: 'firstName=Visiting&lastName=Friend&clubName=Cubbies' },
  { file: 'default-preview.png',           query: '' },
];

function pngSize(buf) {
  // PNG signature is 8 bytes; IHDR width/height are big-endian at 16 and 20.
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(sig)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  // Touch stdio first: Node creates stdout/stderr handles lazily on first
  // write, and the server logs during require — without this the baseline
  // misses two Socket handles and the check false-positives.
  process.stdout.write(''); process.stderr.write('');
  const handlesBefore = process._getActiveHandles().length;
  const { app } = require('../print-server/server.js');
  const handlesAfter = process._getActiveHandles().length;
  // A bare require must not bind ports or start timers. (Sockets/timers show
  // up as active handles; requiring modules does not.)
  if (handlesAfter > handlesBefore) {
    throw new Error(`bare require() leaked ${handlesAfter - handlesBefore} active handle(s) — module-scope side effect regression`);
  }
  console.log('OK  bare require() has no side effects');

  // Bind an ephemeral port directly on the exported app — startListening()
  // is pinned to 3456 and would collide with a real server on a dev box.
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let failed = 0;
  for (const c of CASES) {
    const { status, body } = await get(`${base}/preview?${c.query}`);
    const size = status === 200 ? pngSize(body) : null;
    const ok = size && size.width === LABEL_W && size.height === LABEL_H;
    if (ok) {
      fs.writeFileSync(path.join(OUT_DIR, c.file), body);
      console.log(`OK  ${c.file} (${size.width}x${size.height}, ${body.length} bytes)`);
    } else {
      failed++;
      console.error(`FAIL ${c.file}: status=${status} size=${size ? `${size.width}x${size.height}` : 'not a PNG'}`);
    }
  }

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (failed) {
    console.error(`\n${failed} render case(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll renders passed — PNGs in ${OUT_DIR}`);
  process.exit(0);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
