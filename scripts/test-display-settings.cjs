#!/usr/bin/env node
// Tests for the shared display settings surface (contract v6): the route, the
// auth matrix, the CORS/PNA carve-out, and what actually goes on the wire.
//
// test-contracts proves buildDisplaySettings is right in isolation; this
// proves the SERVER is wired to it: a publish from this computer or from the
// display app's origin (with the publish token, and only with it) reaches the
// wire SEALED, carries only allowlisted keys, survives on disk, and is stamped
// strictly later than the one before it, which is what consumers order by.
//
// Run: npm run test:settings

'use strict';

// A crashed suite must FAIL, not pass (see test-lobby-slides.cjs).
let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || 34581);
const BASE = `http://127.0.0.1:${PORT}`;
const DISPLAY_ORIGIN = 'https://patrick-simpson.github.io';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// Intercept `pusher` so nothing reaches the network.
const wire = [];
const realLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'pusher') {
    return class FakePusher {
      trigger(channel, event, payload) {
        wire.push({ channel, event, payload });
        return Promise.resolve();
      }
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));

// The published interop test key — protects nothing, which is the point.
const TEST_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
}
const post = (pathname, body, headers) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(body || {}),
});

const frames = () => wire.filter((w) => w.event === 'settings');
const isSealed = (b) => Boolean(b && b.v === events.ENVELOPE_VERSION && typeof b.ct === 'string');
const lastOpened = () => {
  const f = frames();
  return f.length ? events.openForTest(TEST_KEY, 'settings', f[f.length - 1].payload) : null;
};
const settle = () => new Promise((r) => setTimeout(r, 50));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-settings-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
    pusherAppId: '1', pusherKey: 'k', pusherSecret: 's', pusherCluster: 'us2',
    displayKey: TEST_KEY,
  }, null, 2));

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  console.log('\ndisplay-settings: fresh install');
  {
    const g = await j('/api/display-settings');
    check('GET is readable from this machine', g.status === 200);
    check('nothing published yet', g.body.rev === 0 && g.body.publishedAt === null);
    const h = await j('/health');
    check('/health carries the displaySettings block', h.body.displaySettings && h.body.displaySettings.rev === 0);
    check('nothing is broadcast before the first publish', frames().length === 0);
  }

  console.log('display-settings: a publish from this computer');
  {
    wire.length = 0;
    const r = await post('/api/display-settings', { settings: {
      milestoneEvery: 30, checkoutBoardFrom: '19:40', clubPhrases: { Sparks: 'Shine!' },
      backgroundSource: 'video', panicMode: true, pusherAppKey: 'x',
    } });
    check('accepted', r.status === 200 && r.body.ok === true && r.body.rev === 1, JSON.stringify(r.body));
    check('per-screen keys counted as dropped', r.body.droppedCount === 3 && r.body.keyCount === 3);
    await settle();
    check('one frame went out', frames().length === 1);
    check('and it is SEALED', isSealed(frames()[0].payload));
    const opened = lastOpened();
    check('it opens to {rev, publishedAt, settings}', opened && opened.rev === 1 && typeof opened.publishedAt === 'string');
    check('only shared keys ride it',
      JSON.stringify(opened.settings) === JSON.stringify({ clubPhrases: { sparks: 'Shine!' }, milestoneEvery: 30, checkoutBoardFrom: '19:40' }),
      JSON.stringify(opened && opened.settings));
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'display-settings.json'), 'utf8'));
    check('persisted', onDisk.rev === 1 && onDisk.settings.milestoneEvery === 30);
    check('/health has the new rev, never the values',
      (await j('/health')).body.displaySettings.rev === 1 && !JSON.stringify((await j('/health')).body).includes('Shine!'));

    const second = await post('/api/display-settings', { settings: { milestoneEvery: 40 } });
    check('a second publish is the next rev', second.body.rev === 2);
    check('stamped strictly later', Date.parse(second.body.publishedAt) > Date.parse(r.body.publishedAt));
    await settle();
    check('a publish replaces the whole set (what the screen sent is the set)', JSON.stringify(lastOpened().settings) === JSON.stringify({ milestoneEvery: 40 }));
  }

  console.log('display-settings: the display app\'s origin needs the token');
  {
    const noToken = await post('/api/display-settings', { settings: { showClock: false } }, { Origin: DISPLAY_ORIGIN });
    check('without a configured token → 403 with guidance', noToken.status === 403 && /No publish token/i.test(noToken.body.error), JSON.stringify(noToken.body));
    const gen = await post('/config/slides-token/generate');
    await post('/config', { slidesPublishToken: gen.body.token });
    const wrong = await post('/api/display-settings', { settings: { showClock: false } }, { Origin: DISPLAY_ORIGIN, Authorization: 'Bearer nope-nope-nope-nope-nope-nope' });
    check('wrong token → 403', wrong.status === 403 && /Wrong publish token/i.test(wrong.body.error));
    const right = await post('/api/display-settings', { settings: { showClock: false } }, { Origin: DISPLAY_ORIGIN, Authorization: `Bearer ${gen.body.token}` });
    check('right token publishes', right.status === 200 && right.body.ok === true, JSON.stringify(right.body));
    const evil = await post('/api/display-settings', { settings: { showClock: false } }, { Origin: 'https://evil.example', Authorization: `Bearer ${gen.body.token}` });
    check('a non-allowlisted origin is refused even WITH the token', evil.status === 403);
    const read = await j('/api/display-settings', { headers: { Origin: DISPLAY_ORIGIN } });
    check('the display origin cannot READ the settings back', read.status === 403);
  }

  console.log('display-settings: preflight from the public site');
  {
    const res = await fetch(`${BASE}/api/display-settings`, {
      method: 'OPTIONS',
      headers: {
        Origin: DISPLAY_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,authorization',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    check('preflight 204', res.status === 204);
    check('echoes the exact origin', res.headers.get('access-control-allow-origin') === DISPLAY_ORIGIN);
    check('admits Authorization', /authorization/i.test(res.headers.get('access-control-allow-headers') || ''));
    check('opts in to Private Network Access', res.headers.get('access-control-allow-private-network') === 'true');
    const other = await fetch(`${BASE}/config`, { method: 'OPTIONS', headers: { Origin: DISPLAY_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    check('the carve-out stops at the two display paths', other.status === 403);
  }

  console.log('display-settings: bad bodies');
  {
    check('a non-object body is a 400', (await post('/api/display-settings', { settings: ['showClock'] })).status === 400);
    check('a missing body is a 400', (await post('/api/display-settings', {})).status === 400);
    const phrases = {};
    for (let i = 0; i < 15; i += 1) phrases[`club${i}`] = 'p'.repeat(80);
    const big = await post('/api/display-settings', { settings: { clubPhrases: phrases, weatherLocationName: 'x'.repeat(80), calendarWelcomeText: 'y'.repeat(80) } });
    check('the largest settings the caps admit still publish', big.status === 200, JSON.stringify(big.body));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('suite crashed:', e);
  __suiteFinished = true;
  process.exit(1);
});
