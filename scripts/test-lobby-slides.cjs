#!/usr/bin/env node
// Tests for the lobby-slides publish surface — the routes, the auth matrix,
// the CORS/PNA carve-out, and what actually goes on the wire.
//
// WHAT THIS GUARDS THAT test-contracts.cjs CANNOT
//
// test-contracts proves buildSlidesDeck/buildSlidesChunks are correct in
// isolation. This proves the SERVER is wired to them: that a publish from the
// dashboard's trusted surface reaches the wire SEALED and chunked, that the
// display app's origin can publish with the token and only with the token,
// that a hostile origin gets nothing, that the deck survives on disk, and that
// the stamp the consumers order by is strictly monotonic across publishes.
//
// Run: npm run test:slides

'use strict';

// A crashed suite must FAIL, not pass: server.js's uncaughtException handler
// (a production never-crash feature) can swallow a test-time crash, letting
// the event loop drain and the process exit 0 without a summary ever printing.
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

const PORT = Number(process.env.AWANA_TEST_PORT || 34579);
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

// Intercept `pusher` so nothing reaches the network — see test-server-realtime
// for why Module._load rather than a node_modules stub.
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
  return {
    status: res.status,
    headers: res.headers,
    body: await res.json().catch(() => null),
  };
}
const post = (pathname, body, headers) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(body || {}),
});

const slidesFrames = () => wire.filter((w) => w.event === 'slides');
const isSealed = (b) => Boolean(b && b.v === events.ENVELOPE_VERSION && typeof b.ct === 'string');
const openAll = () => slidesFrames().map((w) => events.openForTest(TEST_KEY, 'slides', w.payload));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-slides-'));

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

  // ── 1. Fresh install: no deck, no token ──────────────────────────────────────
  console.log('\nlobby-slides: fresh install');
  {
    const g = await j('/api/lobby-slides');
    check('GET is readable from this machine', g.status === 200);
    check('no deck yet', g.body.deckRev === 0 && g.body.publishedAt === null);
    check('no token yet', g.body.tokenConfigured === false);
    const h = await j('/health');
    check('/health carries the lobbySlides block',
      h.body.lobbySlides && h.body.lobbySlides.deckRev === 0 && h.body.lobbySlides.tokenConfigured === false);
    check('/health never carries the slide text', !JSON.stringify(h.body.lobbySlides).includes('slides":['));
  }

  // ── 2. Trusted publish (the dashboard path) ──────────────────────────────────
  console.log('lobby-slides: trusted loopback publish');
  {
    wire.length = 0;
    const r = await post('/api/lobby-slides', {
      slides: [
        { text: 'Welcome to\nAwana!', eyebrow: 'Awana Clubs', theme: 'sky' },
        { type: 'video', videoId: 'v_123', videoName: 'opener.mp4' },
        { text: 'Grand Prix — Saturday 9 AM', durationSec: 12 },
      ],
    });
    check('publish accepted', r.status === 200 && r.body.ok === true, JSON.stringify(r.body));
    check('rev 1', r.body.deckRev === 1);
    check('video entry reported dropped', r.body.slideCount === 2 && r.body.droppedCount === 1);

    const frames = slidesFrames();
    check('exactly one chunk on the wire for a small deck', frames.length === 1, `saw ${frames.length}`);
    check('the chunk is SEALED — operator text never rides plaintext when keyed',
      frames.every((f) => isSealed(f.payload)));
    const opened = openAll();
    check('opened chunk has the contract shape',
      opened[0].deckRev === 1 && opened[0].seq === 0 && opened[0].total === 1
      && typeof opened[0].publishedAt === 'string' && Array.isArray(opened[0].slides));
    check('the video slide is NOT in the sealed payload',
      !JSON.stringify(opened).includes('v_123') && !JSON.stringify(opened).includes('opener.mp4'));
    check('multi-line text survives the pipe', opened[0].slides[0].text === 'Welcome to\nAwana!');

    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'lobby-slides.json'), 'utf8'));
    check('deck persisted for restarts/rebroadcasts',
      onDisk.deckRev === 1 && onDisk.slides.length === 2 && onDisk.publishedAt === opened[0].publishedAt);

    const g = await j('/api/lobby-slides');
    check('GET reflects the published deck', g.body.deckRev === 1 && g.body.slides.length === 2);
  }

  // ── 3. Monotonic stamp across rapid publishes ────────────────────────────────
  console.log('lobby-slides: publishedAt is strictly monotonic');
  {
    wire.length = 0;
    const a = await post('/api/lobby-slides', { slides: [{ text: 'One' }] });
    const b = await post('/api/lobby-slides', { slides: [{ text: 'Two' }] });
    check('revs increment', a.body.deckRev === 2 && b.body.deckRev === 3);
    check('stamps strictly increase even back-to-back',
      Date.parse(b.body.publishedAt) > Date.parse(a.body.publishedAt),
      `${a.body.publishedAt} then ${b.body.publishedAt}`);
    const opened = openAll();
    check('every chunk of one publish carries its stamp verbatim',
      opened.filter((c) => c.deckRev === 3).every((c) => c.publishedAt === b.body.publishedAt));
  }

  // ── 4. An explicitly cleared deck propagates ─────────────────────────────────
  console.log('lobby-slides: publishing an empty deck');
  {
    wire.length = 0;
    const r = await post('/api/lobby-slides', { slides: [] });
    check('an empty deck is accepted', r.status === 200 && r.body.slideCount === 0);
    const opened = openAll();
    check('one chunk with slides:[] goes out',
      opened.length === 1 && opened[0].total === 1 && opened[0].slides.length === 0);
  }

  // ── 5. The auth matrix for the display-app path ──────────────────────────────
  console.log('lobby-slides: display-origin publishes need the token');
  {
    const noToken = await post('/api/lobby-slides', { slides: [{ text: 'x' }] }, { Origin: DISPLAY_ORIGIN });
    check('display origin without a configured token → 403 with setup guidance',
      noToken.status === 403 && /No publish token/i.test(noToken.body.error), JSON.stringify(noToken.body));

    const gen = await post('/config/slides-token/generate');
    check('token generates from the trusted surface', gen.status === 200 && /^[A-Za-z0-9_-]{24,}$/.test(gen.body.token));
    const save = await post('/config', { slidesPublishToken: gen.body.token });
    check('token saves', save.status === 200);
    check('junk tokens are refused', (await post('/config', { slidesPublishToken: 'short!' })).status === 400);

    const wrong = await post('/api/lobby-slides', { slides: [{ text: 'x' }] },
      { Origin: DISPLAY_ORIGIN, Authorization: 'Bearer nope-nope-nope-nope-nope' });
    check('wrong token → 403', wrong.status === 403 && /Wrong publish token/i.test(wrong.body.error));

    wire.length = 0;
    const right = await post('/api/lobby-slides', { slides: [{ text: 'From the display app' }] },
      { Origin: DISPLAY_ORIGIN, Authorization: `Bearer ${gen.body.token}` });
    check('right token publishes', right.status === 200 && right.body.ok === true, JSON.stringify(right.body));
    check('and it reached the wire sealed', slidesFrames().length === 1 && isSealed(slidesFrames()[0].payload));

    // The token is NOT a skeleton key: it must not open any other endpoint.
    const otherRoute = await post('/reset-tonight', { confirm: true },
      { Origin: DISPLAY_ORIGIN, Authorization: `Bearer ${gen.body.token}` });
    check('the display origin + token cannot touch any other mutating route', otherRoute.status === 403);

    const evil = await post('/api/lobby-slides', { slides: [{ text: 'x' }] },
      { Origin: 'https://evil.example', Authorization: `Bearer ${gen.body.token}` });
    check('a non-allowlisted origin is refused even WITH the token', evil.status === 403);

    // GET /config must never hand the token to a non-trusted origin.
    const cfg = await j('/config', { headers: { Origin: DISPLAY_ORIGIN } });
    check('the display origin can never READ the token back',
      !cfg.body || cfg.body.slidesPublishToken === undefined);

    const cleared = await post('/config', { slidesPublishToken: '' });
    check('clearing the token revokes the path', cleared.status === 200
      && (await post('/api/lobby-slides', { slides: [{ text: 'x' }] },
        { Origin: DISPLAY_ORIGIN, Authorization: `Bearer ${gen.body.token}` })).status === 403);
  }

  // ── 6. CORS/PNA preflight carve-out ──────────────────────────────────────────
  console.log('lobby-slides: CORS preflight for the display origin');
  {
    const pre = await j('/api/lobby-slides', {
      method: 'OPTIONS',
      headers: {
        Origin: DISPLAY_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    check('preflight passes for the display origin', pre.status === 204);
    check('exact origin echoed, never *', pre.headers.get('access-control-allow-origin') === DISPLAY_ORIGIN);
    check('Authorization is an allowed header on this path',
      /authorization/i.test(pre.headers.get('access-control-allow-headers') || ''));
    check('Private Network Access opt-in answered',
      pre.headers.get('access-control-allow-private-network') === 'true');

    const evilPre = await j('/api/lobby-slides', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    check('preflight fails for a stranger', evilPre.status === 403);

    const elsewhere = await j('/health', { headers: { Origin: DISPLAY_ORIGIN } });
    check('the display origin gets NO CORS grant outside its one path',
      elsewhere.headers.get('access-control-allow-origin') === null);
  }

  // ── 7. Size gates ────────────────────────────────────────────────────────────
  console.log('lobby-slides: the deck size gates');
  {
    const before = (await j('/api/lobby-slides')).body;

    const huge = Array.from({ length: 50 }, (_, i) => ({
      text: ('Line ' + i + ' — ').padEnd(500, '📣'),
      eyebrow: 'E'.repeat(60),
    }));
    const r = await post('/api/lobby-slides', { slides: huge });
    check('an over-budget deck is refused with a human error, never truncated',
      r.status === 413 && /too large/i.test(r.body.error), JSON.stringify(r.body));

    // The greedy-packing worst case: well under the 40 KB byte cap, but too
    // fragmented to fit the 12-chunk ceiling. Accepting this used to be the
    // silent-forever failure — ok:true, deck persisted, nothing broadcast,
    // every heartbeat failing closed. Now it must be a 413 with NOTHING
    // committed: same rev, same deck, and the next real publish still works.
    wire.length = 0;
    const cjk = Array.from({ length: 25 }, () => ({ text: '你'.repeat(380) + 'x'.repeat(120) }));
    const uc = await post('/api/lobby-slides', { slides: cjk });
    check('an unchunkable sub-40KB deck is refused, not accepted-and-muted',
      uc.status === 413 && /chunks/i.test(uc.body.error), JSON.stringify(uc.body));
    check('nothing was broadcast for it', slidesFrames().length === 0);
    const after = (await j('/api/lobby-slides')).body;
    check('nothing was committed for it',
      after.deckRev === before.deckRev && after.publishedAt === before.publishedAt);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'lobby-slides.json'), 'utf8'));
    check('the persisted deck is untouched', onDisk.deckRev === before.deckRev);
    const next = await post('/api/lobby-slides', { slides: [{ text: 'Still works' }] });
    check('the next publish proceeds normally', next.status === 200 && next.body.deckRev === before.deckRev + 1);

    check('and a non-array body is a 400',
      (await post('/api/lobby-slides', { slides: 'Welcome' })).status === 400);
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
