#!/usr/bin/env node
// Integration tests for the print server's trust model (v5.3.0).
//
// These assert the properties that keep children's names and allergy data off
// the network. They are integration tests rather than unit tests on purpose:
// every one of the original holes was a WIRING mistake — middleware order, a
// route that forgot its auth check, a bind call missing its host argument —
// and none of those are visible from a pure function test.
//
// A real non-loopback request is needed to exercise the LAN path, so the suite
// binds 0.0.0.0 and connects to a non-loopback local IPv4 address. If the host
// has no such address the LAN cases are skipped (loudly) rather than passing
// vacuously.
//
// Run: npm run test:security

'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || 34561);
const PIN = 'test-pin-9182';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.error(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

function request(opts) {
  const { host, method = 'GET', pathname, headers = {}, body } = opts;
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host,
      port: PORT,
      method,
      path: pathname,
      headers: {
        ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function json(res) {
  try { return JSON.parse(res.body); } catch { return null; }
}

async function main() {
  const lan = lanAddress();

  // ── Fixture data dir ────────────────────────────────────────────────────────
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-sec-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: '',
    checkinUrl: 'https://example.twotimtwo.com/clubber/checkin',
    phonePin: PIN,
    lanAccess: true,
    pusherSecret: 'SECRET-MUST-NOT-LEAK',
    pusherKey: 'key-abc',
    pusherAppId: '12345',
  }, null, 2));
  // One roster row and one history row so the PII endpoints have something to
  // leak if the gate fails — a test that passes because the file was empty
  // would be worthless.
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
    + 'Testkid,Leakcanary,2018-03-15,peanut allergy,Cubbies A,y\n');
  fs.writeFileSync(path.join(dataDir, 'print-history.json'), JSON.stringify([{
    firstName: 'Testkid', lastName: 'Leakcanary', clubName: 'Cubbies',
    printer: '', success: true, visitor: false, isAward: false, award: '',
    timestamp: new Date().toISOString(),
  }], null, 2));

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);     // don't collide with a real install on 3456
  process.env.AWANA_BIND_HOST = '0.0.0.0';   // so the LAN cases can connect at all

  // require() the server AFTER the env is set — DATA_DIR is read at module load.
  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  // ── Loopback is trusted ─────────────────────────────────────────────────────
  {
    const res = await request({ host: '127.0.0.1', pathname: '/stats/tonight' });
    check('loopback GET /stats/tonight is allowed', res.status === 200, `status ${res.status}`);
    const body = json(res) || {};
    check('loopback /stats/tonight still returns the data the dashboard needs',
      Array.isArray(body.allergyKids), 'allergyKids missing');
  }
  {
    const res = await request({ host: '127.0.0.1', pathname: '/config' });
    const cfg = json(res) || {};
    check('loopback GET /config exposes secrets to the dashboard',
      cfg.pusherSecret === 'SECRET-MUST-NOT-LEAK' && cfg.phonePin === PIN,
      'the dashboard could not read its own settings');
  }

  // ── The LAN is not trusted ──────────────────────────────────────────────────
  if (!lan) {
    console.warn('  ! No non-loopback IPv4 address on this host — LAN cases SKIPPED');
    check('LAN cases were exercised', false, 'no non-loopback address available');
  } else {
    // The phone page itself must load — it is the PIN entry form.
    {
      const res = await request({ host: lan, pathname: '/phone' });
      check('LAN GET /phone serves the PIN form', res.status === 200, `status ${res.status}`);
      check('LAN GET /phone carries no roster data', !res.body.includes('Leakcanary'));
    }

    // ── Happy path first ──────────────────────────────────────────────────────
    // Ordered before the refusal sweep on purpose: a correct PIN clears the
    // limiter, and the sweep below deliberately trips it.
    {
      const res = await request({
        host: lan, method: 'POST', pathname: '/phone/roster', body: { pin: PIN },
      });
      check('LAN POST /phone/roster succeeds with the right PIN', res.status === 200, `status ${res.status}`);
      const body = json(res) || {};
      check('LAN phone roster returns kids', Array.isArray(body.kids) && body.kids.length === 1,
        JSON.stringify(body).slice(0, 120));
    }
    {
      const res = await request({
        host: lan, pathname: '/stats/tonight', headers: { 'X-Awana-Pin': PIN },
      });
      check('LAN GET /stats/tonight succeeds with the PIN header', res.status === 200, `status ${res.status}`);
    }

    // Secrets stay on the machine even for an authenticated LAN caller.
    {
      const res = await request({ host: lan, pathname: '/config', headers: { 'X-Awana-Pin': PIN } });
      check('LAN GET /config is allowed with the PIN', res.status === 200, `status ${res.status}`);
      check('LAN GET /config withholds the Pusher secret', !res.body.includes('SECRET-MUST-NOT-LEAK'));
      check('LAN GET /config withholds the PIN itself', !res.body.includes(PIN));
    }
    // ...and a LAN caller cannot WRITE them either.
    {
      const res = await request({
        host: lan, method: 'POST', pathname: '/config',
        headers: { 'X-Awana-Pin': PIN }, body: { pin: PIN, pusherSecret: 'attacker' },
      });
      check('LAN POST /config refuses to set the Pusher secret', res.status === 403, `status ${res.status}`);
    }

    // ── Refusal sweep ─────────────────────────────────────────────────────────
    // Every endpoint that can return roster data, plus the dashboard itself.
    // A missing PIN counts toward the rate limiter, so later paths in this list
    // legitimately answer 429 instead of 403 — both mean "refused, no data",
    // which is the property under test.
    const PII_PATHS = [
      '/stats/tonight',
      '/history',
      '/history/today',
      '/checkin-csv-export',
      '/siblings?name=Testkid%20Leakcanary',
      '/roster-status',
      '/failures',
      '/diagnostics',
      '/config',
      '/',                       // the dashboard itself
      '/preview?name=Testkid%20Leakcanary',
    ];
    for (const p of PII_PATHS) {
      const res = await request({ host: lan, pathname: p });
      check(`LAN GET ${p} is refused without a PIN`,
        res.status === 403 || res.status === 429, `status ${res.status}`);
      check(`LAN GET ${p} leaks no roster name`, !res.body.includes('Leakcanary'),
        'response contained a child name');
    }
    {
      const res = await request({ host: lan, method: 'POST', pathname: '/phone/roster', body: {} });
      check('LAN POST /phone/roster is refused without a PIN',
        res.status === 403 || res.status === 429, `status ${res.status}`);
      check('LAN POST /phone/roster leaks no roster name', !res.body.includes('Leakcanary'));
    }

    // ── Brute force ───────────────────────────────────────────────────────────
    // Runs last: it leaves the address locked out.
    {
      let sawLockout = false;
      let lastStatus = 0;
      for (let i = 0; i < 12; i++) {
        const res = await request({
          host: lan, pathname: '/stats/tonight', headers: { 'X-Awana-Pin': 'wrong-' + i },
        });
        lastStatus = res.status;
        if (res.status === 429) { sawLockout = true; break; }
      }
      check('repeated wrong PINs trigger a lockout', sawLockout, `last status ${lastStatus}`);
      // The lockout must apply to a correct PIN too, or it is trivially bypassed
      // by interleaving one guess with one known-good request.
      const after = await request({
        host: lan, pathname: '/stats/tonight', headers: { 'X-Awana-Pin': PIN },
      });
      check('lockout also blocks the correct PIN while active', after.status === 429,
        `status ${after.status}`);
    }
  }

  // ── Origin policy ───────────────────────────────────────────────────────────
  {
    const res = await request({
      host: '127.0.0.1', pathname: '/stats/tonight',
      headers: { Origin: 'https://evil.example' },
    });
    check('a stranger origin gets no Access-Control-Allow-Origin',
      !res.headers['access-control-allow-origin'],
      `got ${res.headers['access-control-allow-origin']}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', pathname: '/stats/tonight',
      headers: { Origin: 'http://evil.example:' + PORT },
    });
    check('the old :3456 port-suffix bypass is closed',
      !res.headers['access-control-allow-origin'],
      `got ${res.headers['access-control-allow-origin']}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', pathname: '/stats/tonight',
      headers: { Origin: 'https://kvbchurch.twotimtwo.com' },
    });
    check('the check-in site origin is allowed to read',
      res.headers['access-control-allow-origin'] === 'https://kvbchurch.twotimtwo.com',
      `got ${res.headers['access-control-allow-origin']}`);
    check('the allowlist never answers with a wildcard',
      res.headers['access-control-allow-origin'] !== '*');
  }
  {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/print',
      headers: { Origin: 'https://evil.example' },
      body: { firstName: 'Drive', lastName: 'By' },
    });
    check('a cross-origin write from a stranger is refused', res.status === 403, `status ${res.status}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', method: 'OPTIONS', pathname: '/print',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    check('a stranger preflight is refused', res.status === 403, `status ${res.status}`);
  }

  // ── checkinUrl validation (the shell.openExternal / Start-Process sink) ─────
  for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'data:text/html,x']) {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/config', body: { checkinUrl: bad },
    });
    check(`POST /config rejects checkinUrl ${bad.slice(0, 24)}`, res.status === 400, `status ${res.status}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/config',
      body: { checkinUrl: 'https://example.twotimtwo.com/clubber/checkin' },
    });
    check('POST /config still accepts a normal https check-in URL', res.status === 200, `status ${res.status}`);
  }

  // ── PIN policy on write ─────────────────────────────────────────────────────
  {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/config', body: { phonePin: '12' },
    });
    check('POST /config rejects a too-short PIN', res.status === 400, `status ${res.status}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/config',
      body: { allowedOrigins: ['*', 'https://ok.example', 'not a url'] },
    });
    check('POST /config accepts allowedOrigins', res.status === 200, `status ${res.status}`);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    check('allowedOrigins drops a wildcard entry',
      Array.isArray(saved.allowedOrigins) && !saved.allowedOrigins.includes('*'),
      JSON.stringify(saved.allowedOrigins));
    check('allowedOrigins keeps the valid entry',
      saved.allowedOrigins.includes('https://ok.example'),
      JSON.stringify(saved.allowedOrigins));
  }

  listener.close();
  // The server sets interval timers for club-night publishing; unref the loop.
  await new Promise((r) => setTimeout(r, 50));

  // ── The default bind is loopback-only ───────────────────────────────────────
  // The most important property in this file, and it cannot be tested in-process
  // because the bind happens once at listen() time. A child process with a
  // default config (no lanAccess, no AWANA_BIND_HOST) must be UNREACHABLE on the
  // LAN address — not merely PIN-protected there.
  if (lan) {
    const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-sec-default-'));
    fs.writeFileSync(path.join(defaultDir, 'config.json'), JSON.stringify({
      printerName: '', checkinUrl: 'https://example.twotimtwo.com/clubber/checkin',
    }, null, 2));
    const childPort = PORT + 1;
    const child = require('child_process').spawn(
      process.execPath,
      [path.join(__dirname, '..', 'print-server', 'server.js')],
      {
        env: {
          ...process.env,
          AWANA_DATA_DIR: defaultDir,
          AWANA_PORT: String(childPort),
          AWANA_BIND_HOST: '',           // exercise the real default
        },
        stdio: 'ignore',
      }
    );
    // Give it a moment to bind.
    await new Promise((r) => setTimeout(r, 1500));

    const reach = (host) => new Promise((resolve) => {
      const req = http.request({ host, port: childPort, path: '/stats/tonight', timeout: 3000 },
        (res) => { res.resume(); resolve({ ok: true, status: res.statusCode }); });
      req.on('error', (e) => resolve({ ok: false, code: e.code }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'timeout' }); });
      req.end();
    });

    const viaLoopback = await reach('127.0.0.1');
    check('default install still serves the dashboard over loopback',
      viaLoopback.ok && viaLoopback.status === 200, JSON.stringify(viaLoopback));

    const viaLan = await reach(lan);
    check('default install is NOT reachable on the LAN address at all',
      !viaLan.ok, `reachable with status ${viaLan.status}`);

    child.kill('SIGKILL');
    try { fs.rmSync(defaultDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }

  // ── Static check: the dashboard escapes untrusted values ────────────────────
  // The stored-XSS chain ran through print-history.json into the dashboard's
  // innerHTML, and the dashboard is served from the one origin allowed to read
  // the Pusher secret and the PIN. These are the fields an attacker controls (or
  // that carry a child's name); each must be wrapped in esc() at every
  // interpolation site.
  {
    const dash = fs.readFileSync(
      path.join(__dirname, '..', 'print-server', 'public', 'index.html'), 'utf8');
    check('dashboard defines esc()', /function esc\(/.test(dash));

    const MUST_ESCAPE = [
      'e.firstName', 'e.lastName', 'e.clubName', 'e.printer',
      'k.name', 'f.name', 'f.club', 'f.error',
      'r.test', 'r.detail', 's.stage', 's.detail',
      'row.club', 'row.startTime', 'row.location', 'row.room',
    ];
    const lines = dash.split('\n');
    for (const field of MUST_ESCAPE) {
      const escaped = field.replace('.', '\\.');
      // A concatenation of this field into a string: "+ field" or "+ (field".
      const concatenated = new RegExp('\\+\\s*\\(?\\s*' + escaped + '\\b');
      // The same, but safely wrapped: "esc(field" or "esc((field".
      const wrapped = new RegExp('esc\\(\\s*\\(?\\s*' + escaped + '\\b');
      const offending = [];
      lines.forEach((line, i) => {
        if (!concatenated.test(line)) return;
        if (line.includes('textContent')) return;      // not an HTML sink
        if (wrapped.test(line)) return;                // already escaped
        offending.push(i + 1);
      });
      check(`dashboard escapes ${field}`, offending.length === 0,
        offending.length ? `unescaped at line(s) ${offending.join(', ')}` : '');
    }
  }

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error('  - ' + f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
