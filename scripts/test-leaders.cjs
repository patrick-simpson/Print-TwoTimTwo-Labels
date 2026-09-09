#!/usr/bin/env node
// Tests for leader name tags: the remembered-leader store, the one club list
// every dropdown reads, and the batch print behind "Print selected".
//
// WHAT THIS GUARDS
//
// * The club tables cannot drift. CLUB_MONOGRAM (what the label renderer can
//   style) and CLUB_DISPLAY_NAMES (what the dropdowns offer) must stay in
//   step, and GET /clubs must serve exactly that. Five hardcoded copies of
//   this list is how the check-in widget's walk-in dropdown ended up as the
//   only one without Journey.
// * A leader is remembered only when a tag actually printed, never on a
//   failure and never in rehearsal — a chip must always mean "this person has
//   a tag".
// * The store's rules: one row per person, newest first, capped, club follows
//   the newest print, a blank club never erases a known one, a season of
//   silence hides a chip without forgetting the row, and the × forgets.
// * A leader tag is STILL not a check-in — the whole point of the feature —
//   even printed in a batch of twenty.
//
// Run: npm run test:leaders

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

const PORT = Number(process.env.AWANA_TEST_PORT || 34591);
const BASE = `http://127.0.0.1:${PORT}`;

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

// Keep Pusher off the network and record what would have gone out, so the
// "leader tags never reach the display" claim is checked, not assumed.
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

async function j(pathname, opts) {
  const res = await fetch(BASE + pathname, opts);
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (pathname, body) => j(pathname, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
});

const DAY = 24 * 60 * 60 * 1000;
const nameOf = (l) => `${l.firstName} ${l.lastName}`.trim();

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-leaders-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-leaders-bin-'));

  // printImage() shells out to `powershell`, absent on a Linux runner. Without
  // this stub every print throws at the print step and the "remembered only
  // after the tag actually printed" assertions would pass for the wrong reason.
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    checkinUrl: 'https://example.com/checkin',
  }, null, 2));

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const {
    CLUB_LIST, CLUB_DISPLAY_NAMES, CLUB_MONOGRAM, LEADERS_MAX, LEADER_ACTIVE_DAYS,
    rememberLeader, forgetLeader, activeLeaders, loadLeaders, saveLeaders, leaderKey,
    computeTonightStats, isNonCheckinRow,
  } = server;
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  // ── 1. The one club list ───────────────────────────────────────────────────
  console.log('\nleaders: the one club list');
  {
    const monogramKeys = Object.keys(CLUB_MONOGRAM);
    const displayKeys = Object.keys(CLUB_DISPLAY_NAMES);
    check('every club the renderer can style has a display name',
      monogramKeys.every((k) => typeof CLUB_DISPLAY_NAMES[k] === 'string' && CLUB_DISPLAY_NAMES[k]),
      monogramKeys.filter((k) => !CLUB_DISPLAY_NAMES[k]).join(','));
    check('and no display name exists for a club it cannot style',
      displayKeys.every((k) => CLUB_MONOGRAM[k] !== undefined),
      displayKeys.filter((k) => CLUB_MONOGRAM[k] === undefined).join(','));
    check('the served list is in club order',
      JSON.stringify(CLUB_LIST) === JSON.stringify(monogramKeys.map((k) => CLUB_DISPLAY_NAMES[k])));
    // The regression that started this: Journey existed everywhere except one
    // dropdown, so a Journey walk-in could not be printed with their own club.
    check('Journey is offerable', CLUB_LIST.includes('Journey'));
    check('all six clubs are offerable', CLUB_LIST.length === 6,
      CLUB_LIST.join(','));

    const g = await j('/clubs');
    check('GET /clubs serves exactly that list',
      g.status === 200 && JSON.stringify(g.body.clubs) === JSON.stringify(CLUB_LIST));
    const p = await post('/clubs', {});
    check('POST /clubs answers the same (the phone page sends its PIN in the body)',
      p.status === 200 && JSON.stringify(p.body.clubs) === JSON.stringify(CLUB_LIST));
  }

  // ── 2. The store's rules ───────────────────────────────────────────────────
  console.log('\nleaders: the remembered-leader store');
  {
    saveLeaders([]);
    const t0 = Date.parse('2026-09-02T23:00:00Z');

    let list = rememberLeader({ firstName: 'Amy', lastName: 'Tester', clubName: 'Sparks' }, t0);
    check('a print remembers the leader', list.length === 1 && nameOf(list[0]) === 'Amy Tester');
    check('with their club', list[0].clubName === 'Sparks');
    check('and a print count of one', list[0].printCount === 1);

    list = rememberLeader({ firstName: 'Amy', lastName: 'Tester', clubName: 'Sparks' }, t0 + DAY);
    check('printing the same leader again does not fork a second row', list.length === 1);
    check('it bumps the count', list[0].printCount === 2);
    check('and moves the last-printed stamp', list[0].lastPrintedAt === t0 + DAY);

    list = rememberLeader({ firstName: 'Amy', lastName: 'Tester', clubName: '' }, t0 + 2 * DAY);
    check('a blank club does not erase a club we already knew', list[0].clubName === 'Sparks');
    list = rememberLeader({ firstName: 'Amy', lastName: 'Tester', clubName: 'T&T' }, t0 + 3 * DAY);
    check('an explicit new club follows the newest print', list[0].clubName === 'T&T');

    list = rememberLeader({ firstName: 'Bob', lastName: 'Helper', clubName: 'Trek' }, t0 + 4 * DAY);
    check('newest print sorts first', nameOf(list[0]) === 'Bob Helper' && nameOf(list[1]) === 'Amy Tester');

    // Case and whitespace are the same person — otherwise "amy  tester" is a
    // second chip for the same volunteer.
    list = rememberLeader({ firstName: 'AMY', lastName: '  Tester ', clubName: 'Cubbies' }, t0 + 5 * DAY);
    check('case and padding do not create a duplicate', list.length === 2);
    check('the key is normalized', leaderKey(' AMY ', 'Tester  ') === 'amy tester');

    // The cap drops the least recently printed, which is the one least likely
    // to be needed tonight.
    saveLeaders([]);
    for (let i = 0; i < LEADERS_MAX + 5; i++) {
      list = rememberLeader({ firstName: 'L' + i, lastName: 'Volunteer' }, t0 + i * 1000);
    }
    check(`the store caps at ${LEADERS_MAX}`, list.length === LEADERS_MAX);
    check('the newest survives the cap', nameOf(list[0]) === `L${LEADERS_MAX + 4} Volunteer`);
    check('the oldest is the one dropped', !list.some((l) => nameOf(l) === 'L0 Volunteer'));

    // A season of silence hides a chip; the row is kept so printing them again
    // brings it straight back.
    saveLeaders([]);
    const now = t0 + 400 * DAY;
    rememberLeader({ firstName: 'Recent', lastName: 'Leader' }, now - 10 * DAY);
    let all = rememberLeader({ firstName: 'Lapsed', lastName: 'Leader' }, now - (LEADER_ACTIVE_DAYS + 5) * DAY);
    let active = activeLeaders(all, now);
    check('a leader printed this season shows', active.some((l) => nameOf(l) === 'Recent Leader'));
    check('one who missed a whole season is hidden', !active.some((l) => nameOf(l) === 'Lapsed Leader'));
    check('but is not forgotten', loadLeaders().some((l) => nameOf(l) === 'Lapsed Leader'));
    all = rememberLeader({ firstName: 'Lapsed', lastName: 'Leader' }, now);
    check('printing them again brings the chip back',
      activeLeaders(all, now).some((l) => nameOf(l) === 'Lapsed Leader'));

    // The × forgets outright.
    const before = loadLeaders().length;
    const gone = forgetLeader('lapsed leader');
    check('the × removes the row', gone.removed && gone.leaders.length === before - 1);
    check('and it stays gone', !loadLeaders().some((l) => nameOf(l) === 'Lapsed Leader'));
    check('forgetting an unknown key is a no-op, not an error', forgetLeader('nobody at all').removed === false);
    check('a nameless entry is never remembered',
      rememberLeader({ firstName: '', lastName: '' }, now).every((l) => l.key !== ''));
  }

  // ── 3. A corrupt file must not take the panel down ─────────────────────────
  console.log('\nleaders: a corrupt store degrades quietly');
  {
    fs.writeFileSync(path.join(dataDir, 'leaders.json'), '{not json at all', 'utf8');
    check('unparseable JSON reads as an empty list', loadLeaders().length === 0);
    fs.writeFileSync(path.join(dataDir, 'leaders.json'), JSON.stringify([
      { firstName: 'Good', lastName: 'Row', clubName: 'Sparks', lastPrintedAt: 111, printCount: 2 },
      { firstName: 'Good', lastName: 'Row', clubName: 'Trek', lastPrintedAt: 222 },   // duplicate key
      { firstName: '', lastName: '' },                                                // nameless
      'not an object',
      null,
      { firstName: 'Bad', lastName: 'Stamp', lastPrintedAt: 'yesterday' },
    ]), 'utf8');
    const cleaned = loadLeaders();
    check('the duplicate row is dropped, not merged', cleaned.filter((l) => l.key === 'good row').length === 1);
    check('the nameless and non-object rows are dropped', cleaned.length === 2, JSON.stringify(cleaned));
    check('an unparseable stamp becomes 0 rather than NaN',
      cleaned.find((l) => l.key === 'bad stamp').lastPrintedAt === 0);
    saveLeaders([]);
  }

  // ── 4. Printing: remembered only on success, and never a check-in ─────────
  console.log('\nleaders: printing');
  {
    const beforeTonight = computeTonightStats().checkedIn;
    const wireBefore = wire.length;

    const one = await post('/print-leader', { name: 'Cara Leader', clubName: 'Journey' });
    check('a single leader tag prints', one.status === 200 && one.body.success === true);
    const remembered = (await j('/leaders')).body;
    check('and is remembered', remembered.leaders.some((l) => nameOf(l) === 'Cara Leader'));
    check('with the club it was printed under',
      remembered.leaders.find((l) => nameOf(l) === 'Cara Leader').clubName === 'Journey');
    check('GET /leaders also serves the club list, so one call sets up a dropdown',
      JSON.stringify(remembered.clubs) === JSON.stringify(CLUB_LIST));

    // The whole point of the feature.
    check('a leader tag does not move tonight’s count',
      computeTonightStats().checkedIn === beforeTonight);
    check('nothing about a leader reaches the display',
      wire.slice(wireBefore).every((w) => w.event !== 'checkin' && w.event !== 'recap'));

    // Rehearsal prints a TEST band and teaches the chips nothing.
    const demo = await post('/print-leader', { name: 'Rehearsal Only', demo: true });
    check('a rehearsal tag prints', demo.status === 200 && demo.body.demo === true);
    check('and is NOT remembered',
      !(await j('/leaders')).body.leaders.some((l) => nameOf(l) === 'Rehearsal Only'));

    // The 25 s window still absorbs a double-tap.
    const dup = await post('/print-leader', { name: 'Cara Leader', clubName: 'Journey' });
    check('a double-tap is suppressed', dup.body.duplicate === true);

    const bad = await post('/print-leader', {});
    check('a nameless request is refused', bad.status === 400);
  }

  // ── 5. "Print selected": the batch ────────────────────────────────────────
  console.log('\nleaders: print selected');
  {
    const beforeTonight = computeTonightStats().checkedIn;
    const batch = await post('/print-leader', {
      leaders: [
        { firstName: 'Dana', lastName: 'One', clubName: 'Sparks' },
        { firstName: 'Eli', lastName: 'Two', clubName: 'Trek' },
        { firstName: '', lastName: '' },                            // one bad row among good ones
      ],
    });
    check('the batch answers 200 even with a bad row (the body is the record)', batch.status === 200);
    check('it reports per name', Array.isArray(batch.body.results) && batch.body.results.length === 3);
    check('the two good tags printed', batch.body.printed === 2);
    check('the bad row is reported, not silently dropped',
      batch.body.failed === 1 && batch.body.results[2].success === false);
    check('success is false when any tag failed', batch.body.success === false);
    check('a partial batch still names what failed', typeof batch.body.results[2].error === 'string');

    const after = (await j('/leaders')).body.leaders.map(nameOf);
    check('every printed leader in the batch is remembered',
      after.includes('Dana One') && after.includes('Eli Two'));
    check('a whole batch of leader tags still moves nothing about tonight',
      computeTonightStats().checkedIn === beforeTonight);

    const empty = await post('/print-leader', { leaders: [] });
    check('an empty batch is refused', empty.status === 400);
    const huge = await post('/print-leader', { leaders: Array.from({ length: 40 }, (_, i) => ({ name: 'X' + i })) });
    check('an implausibly large batch is refused', huge.status === 400 && /max/i.test(huge.body.error));

    // Every history row a leader print writes must be excluded from counting,
    // batch or not — the predicate everything else keys on.
    check('leader history rows are non-checkin rows',
      isNonCheckinRow({ isLeader: true }) === true);
  }

  // ── 6. Forgetting over HTTP ───────────────────────────────────────────────
  console.log('\nleaders: forgetting from the chips');
  {
    const list = (await j('/leaders')).body.leaders;
    const target = list.find((l) => nameOf(l) === 'Dana One');
    const res = await post('/leaders/forget', { key: target.key });
    check('the × forgets over HTTP', res.status === 200 && res.body.removed === true);
    check('and the response carries the fresh list, so the UI needs no second call',
      !res.body.leaders.some((l) => nameOf(l) === 'Dana One'));
    const again = await post('/leaders/forget', { key: target.key });
    check('forgetting twice is not an error', again.status === 200 && again.body.removed === false);
    const noKey = await post('/leaders/forget', {});
    check('a missing key is refused', noKey.status === 400);
  }

  // ── 7. The surfaces read the ONE list ─────────────────────────────────────
  // Source-level, deliberately: these are the three files that each used to
  // keep their own copy of the club list, and the drift between them is the
  // whole reason this endpoint exists. A behavioural test cannot see a
  // hardcoded <option> that quietly disagrees with the server, so this pins
  // the structure instead — if a surface goes back to its own list, this fails.
  console.log('\nleaders: every surface reads the one club list');
  {
    const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const ext = read('chrome-extension/content.js');
    const dash = read('print-server/public/index.html');
    const phone = read('print-server/public/phone.html');

    check('the check-in widget fetches /clubs', /\/clubs'/.test(ext) || ext.includes("+ '/clubs'"));
    check('the dashboard fetches /clubs', dash.includes("'/clubs'"));
    check('the phone page fetches /clubs', phone.includes("'/clubs'"));

    // The regression: a second hardcoded club list living in a dropdown. The
    // widget keeps ONE baked list as an offline fallback (named so it is
    // obviously a fallback); the two server-served pages keep none.
    const hardcodedOptions = (html) => (html.match(/<option>(?:Puggles|Cubbies|Sparks|Trek|Journey)<\/option>/g) || []).length;
    check('the dashboard has no hardcoded club options', hardcodedOptions(dash) === 0);
    check('the phone page has no hardcoded club options', hardcodedOptions(phone) === 0);
    check('the widget labels its offline list as a fallback', /CLUB_FALLBACK/.test(ext));

    // A leader tag is not a check-in, and the panel shares the guest row — so
    // the one thing that must never happen is a leader entering the session
    // dedup set or TwoTimTwo registration.
    const leaderBranch = ext.slice(ext.indexOf('if (isLeaderMode())'), ext.indexOf('if (isLeaderMode())') + 700);
    check('the widget has a leader branch in the walk-in handler', leaderBranch.length > 100);
    check('leader mode never marks the name printed (that is check-in dedup)',
      !/markPrinted/.test(leaderBranch));
    check('leader mode never registers anyone in TwoTimTwo',
      !/registerWalkInFamily/.test(leaderBranch));
    // Renamed in v6.11.0 (a guest FAMILY registers under one household), so
    // pin the real name — a scan for a function that no longer exists passes
    // while testing nothing.
    check('...and that is the real registration function name',
      /function registerWalkInFamily\(/.test(ext));
    check('leader mode prints through the leader path', /printLeaders\(/.test(leaderBranch));
    check('ticking Leader visibly retargets the row rather than leaving it identical',
      /Print Leader Tag/.test(ext) && /visitorCb\.disabled/.test(ext) && /registerCb\.disabled/.test(ext));
    check('the remembered-leader chips are in the panel layout', /leaderChipsWrap/.test(ext)
      && ext.indexOf('leaderChipsWrap,') > 0);
  }

  listener.close();
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  __suiteFinished = true;
  process.exit(1);
});
