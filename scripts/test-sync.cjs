#!/usr/bin/env node
// Tests for signing this computer in to the Awana sync service (the
// Awana-Check-in-Display repo's worker/): the sign-in route and who may call
// it, adopting the service's display key, the old `provision` frame and the
// deck / settings rebroadcasts going quiet, publishes forwarded to the
// service, and a passphrase change elsewhere signing this computer out.
//
// The service is a stand-in on a patched global fetch; loopback requests to
// this server pass through untouched.
//
// Run: node scripts/test-sync.cjs

'use strict';

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

const PORT = Number(process.env.AWANA_TEST_PORT || 34583);
const BASE = `http://127.0.0.1:${PORT}`;
const SYNC = 'https://awana-sync.test.workers.dev';
const OLD_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const SERVICE_KEY = Buffer.alloc(32, 9).toString('base64');
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const wire = [];
const realLoad = Module._load;
Module._load = function patched(request) {
  if (request === 'pusher') {
    return class FakePusher {
      trigger(channel, event, payload) { wire.push({ channel, event, payload }); return Promise.resolve(); }
    };
  }
  // eslint-disable-next-line prefer-rest-params
  return realLoad.apply(this, arguments);
};

// The stand-in service.
const service = { calls: [], key: SERVICE_KEY, stateStatus: 200, publishStatus: 200 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith(SYNC)) return realFetch(url, init);
  const route = u.slice(SYNC.length);
  const body = init.body ? JSON.parse(init.body) : null;
  service.calls.push({ route, method: init.method || 'GET', body, auth: (init.headers || {}).Authorization || null });
  const reply = (status, b) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  if (route === '/v1/login') {
    if (body.passphrase !== 'kennebec') return reply(401, { reason: 'wrong', triesLeft: 4 });
    return reply(200, { session: SESSION, displayKey: service.key, pusher: { key: 'k', cluster: 'us2' }, state: {} });
  }
  if (route === '/v1/state') return reply(service.stateStatus, {});
  if (route === '/v1/slides') return reply(service.publishStatus, { deckRev: 5, publishedAt: '2026-10-01T18:00:00.000Z', slideCount: 1, droppedCount: 0 });
  if (route === '/v1/settings') return reply(service.publishStatus, { rev: 3, publishedAt: '2026-10-01T18:00:00.000Z', keyCount: 1 });
  return reply(404, {});
};

async function j(pathname, opts) {
  const res = await realFetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body, headers) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(headers || {}) },
  body: JSON.stringify(body || {}),
});
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-sync-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
    pusherAppId: '1', pusherKey: 'k', pusherSecret: 's', pusherCluster: 'us2',
    displayKey: OLD_KEY,
  }, null, 2));
  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => { if (listener.listening) return resolve(); listener.once('listening', resolve); });
  await settle(200);

  console.log('\nsync: before anyone signs in');
  {
    const h = await j('/health');
    check('/health says not signed in', h.body.sync && h.body.sync.signedIn === false && h.body.sync.url === null);
    check('nothing has talked to the service', service.calls.length === 0);
    // The old login keeps working until the service takes over.
    await post('/config', { displayLoginPassphrase: 'a twelve character passphrase' });
    await settle();
    check('the provision frame still goes out', wire.some((w) => w.event === 'provision'));
  }

  console.log('sync: who may sign this computer in');
  {
    const remote = await post('/config/sync-login', { passphrase: 'kennebec', url: SYNC }, { Origin: 'https://patrick-simpson.github.io' });
    check('not the display site', remote.status === 403);
    const bad = await post('/config/sync-login', { passphrase: 'kennebec', url: 'http://awana-sync.test.workers.dev' });
    check('https only', bad.status === 400);
    const empty = await post('/config/sync-login', { passphrase: '  ', url: SYNC });
    check('a passphrase is needed', empty.status === 400);
  }

  console.log('sync: signing in');
  {
    const wrong = await post('/config/sync-login', { passphrase: 'kenebec', url: SYNC });
    check('a wrong word is a 401 with the tries left', wrong.status === 401 && wrong.body.triesLeft === 4, JSON.stringify(wrong.body));
    const right = await post('/config/sync-login', { passphrase: '  Kennebec ', url: `${SYNC}/` });
    check('the right word signs in (case and spaces as a screen types them)', right.status === 200 && right.body.ok === true, JSON.stringify(right.body));
    const login = service.calls.filter((c) => c.route === '/v1/login').at(-1);
    check('it offered the key it already had, so older screens keep reading names', login.body.seedKey === OLD_KEY);
    check('and adopted the service\'s key', right.body.changedKey === true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    check('the key and the session are saved', onDisk.displayKey === SERVICE_KEY && onDisk.syncSession === SESSION && onDisk.syncUrl === SYNC);
    const h = await j('/health');
    check('/health: signed in, never the session', h.body.sync.signedIn === true && !JSON.stringify(h.body).includes(SESSION));
    const cfg = await j('/config', { headers: { Origin: 'https://patrick-simpson.github.io' } });
    check('the session is a secret: not in /config for anyone else', cfg.body && cfg.body.syncSession === undefined);
  }

  console.log('sync: the old paths go quiet');
  {
    wire.length = 0;
    await post('/config', { displayLoginPassphrase: 'another twelve character passphrase' });
    await settle();
    check('no provision frame once signed in', !wire.some((w) => w.event === 'provision'));
    const h = await j('/health');
    check('/health marks the display login retired', h.body.displayLogin.retired === true);
  }

  console.log('sync: publishes are forwarded to the service');
  {
    wire.length = 0;
    const slides = await post('/api/lobby-slides', { slides: [{ text: 'Store next week' }] });
    check('the deck went to the service', slides.status === 200 && slides.body.viaSync === true && slides.body.deckRev === 5, JSON.stringify(slides.body));
    const call = service.calls.filter((c) => c.route === '/v1/slides').at(-1);
    check('with the session, as a PUT', call && call.method === 'PUT' && call.auth === `Bearer ${SESSION}`);
    const settings = await post('/api/display-settings', { settings: { showClock: false } });
    check('the shared settings too', settings.status === 200 && settings.body.viaSync === true && settings.body.rev === 3);
    await settle();
    check('nothing was rebroadcast from here', !wire.some((w) => w.event === 'slides' || w.event === 'settings'));
  }

  console.log('sync: a passphrase change elsewhere signs this computer out');
  {
    service.publishStatus = 401;
    service.stateStatus = 401;
    const r = await post('/api/lobby-slides', { slides: [{ text: 'x' }] });
    check('the publish says why it failed', r.status === 502 && /signed out/i.test(r.body.error));
    await settle(200);
    const h = await j('/health');
    check('/health: signed out, with the fix', h.body.sync.signedIn === false && h.body.sync.state === 'signed-out' && /Sign this computer in again/.test(h.body.sync.error));
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    check('the session is gone, the key kept', onDisk.syncSession === undefined && onDisk.displayKey === SERVICE_KEY);
    service.publishStatus = 200;
    service.stateStatus = 200;
  }

  console.log('sync: signing out');
  {
    await post('/config/sync-login', { passphrase: 'kennebec', url: SYNC });
    const out = await post('/config/sync-logout');
    check('signs out', out.status === 200 && (await j('/health')).body.sync.signedIn === false);
    const remote = await post('/config/sync-logout', {}, { Origin: 'https://patrick-simpson.github.io' });
    check('only from this computer', remote.status === 403);
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
