#!/usr/bin/env node
// Tests for the extension's /clubber/checkout scraper and the print server's
// checkout feed validator.
//
// WHY THE GUARDS ARE THE POINT
//
// This feed drives a board that says which children are still in the building.
// Its dangerous failure is not a crash — it is confidently publishing an EMPTY
// or PARTIAL board, because "nobody is left" is what a volunteer will read as
// "the building is clear". Every guard below exists to stop one specific way
// that could happen:
//
//   1. wrong page (redirect, session timeout, error page) -> unknown, not empty
//   2. wrong table (the first table is an unrelated notices table)  -> unknown
//   3. club filter touched by a volunteer -> whole clubs look picked up -> refuse
//   4. rows found but none parsed (selector drift) -> unknown, not empty
//
// Only case 4's inverse — the page's own "nobody is checked in" placeholder — may
// legitimately publish an empty board.
//
// The parser is extracted from chrome-extension/feeds.js rather than
// reimplemented, so a rename or deletion fails loudly instead of testing a copy
// that has quietly diverged from what ships.
//
// jsdom is PINNED TO ^25 ON PURPOSE — do not bump it casually. jsdom 26+ pulls
// in a version of undici that calls `webidl.util.markAsUncloneable`, which does
// not exist before Node 21, so it breaks `npm test` on the Node 20 that CI and
// the shipped Electron app both run. jsdom 25 declares `engines: >=18` and has
// no undici dependency at all. It is the only non-stdlib dependency any suite in
// this repo uses, and it is here because testing a DOM parser without a DOM
// would only test the shim.
//
// Run: npm run test:checkout

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'chrome-extension', 'feeds.js'), 'utf8');

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

// Pull one `function name(...) {...}` out of feeds.js by brace matching.
function extract(name) {
  const start = SRC.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`function ${name}() not found in chrome-extension/feeds.js`);
  let depth = 0;
  let i = SRC.indexOf('{', start);
  const from = i;
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

// Evaluate the real parser against a sandbox that supplies exactly what it needs
// from the content-script environment.
function makeParser() {
  const logs = [];
  const factory = new Function('DOMParser', 'isLoginPage', 'console', 'LOG_PREFIX', `
    ${extract('parseCheckoutHtml')}
    return parseCheckoutHtml;
  `);
  const parse = factory(
    new JSDOM('').window.DOMParser,
    (html) => /name="LoginForm/.test(html),
    { log: (...a) => logs.push(a.join(' ')) },
    '[test]',
  );
  return { parse, logs };
}

// ── Page fixtures ────────────────────────────────────────────────────────────
// Built from the structure documented in docs/TWOTIMTWO.md §2.1: two tables, the
// first an unrelated notices table; blank first and third header columns; the
// identity hook on a.checkout[clubber_id]; club in img.club-icon-20[alt] with a
// trailing space; club filter checkboxes above the table.
//
// The names here are obvious placeholders, not real roster data.
const NOTICES_TABLE = `
  <table class="items table"><tr><th>Title</th></tr><tr><td>A notice</td></tr></table>`;

function filters(checkedFlags) {
  return checkedFlags.map((c, i) =>
    `<input class="filter" type="checkbox" name="clubs[${i}]"${c ? ' checked' : ''}>`).join('');
}

function row(fullName, club, id) {
  return `
    <tr class="clubber-row">
      <td><a class="checkout" href="#" clubber_id="${id}">Check out</a></td>
      <td class="clubber name F">${fullName}</td>
      <td class="center"><img class="club-icon-20" alt="${club} "></td>
      <td>Guardian Person</td>
      <td>Authorized Pickup</td>
      <td>SEC1234</td>
    </tr>`;
}

function page(opts) {
  const o = opts || {};
  const title = o.title === undefined ? 'KVBC - Checkout Clubber' : o.title;
  const bodyRows = o.rows === undefined
    ? [row('Amy Hendricks', 'Sparks', '8821'), row('Marcos Rivera', 'T&T', '8822')].join('')
    : o.rows;
  return `<!doctype html><html><head><title>${title}</title></head><body>
    ${o.skipNotices ? '' : NOTICES_TABLE}
    ${filters(o.filters || [true, true, true])}
    <table class="table">
      <tr><th></th><th>Clubber</th><th></th><th>Parent/Guardian</th><th>Other</th></tr>
      ${bodyRows}
    </table></body></html>`;
}

console.log('\ncheckout parser: the happy path');
{
  const { parse } = makeParser();
  const entries = parse(page());
  check('reads one entry per child', Array.isArray(entries) && entries.length === 2,
    JSON.stringify(entries));
  check('keeps FIRST names only — no last name ever',
    JSON.stringify(entries) === JSON.stringify([
      { firstName: 'Amy', club: 'Sparks' },
      { firstName: 'Marcos', club: 'T&T' },
    ]), JSON.stringify(entries));
  // The row also holds guardian names, an authorized-pickup name and a security
  // code. None of it may appear anywhere in the parsed output.
  const serialized = JSON.stringify(entries);
  for (const leaked of ['Hendricks', 'Rivera', 'Guardian', 'Authorized', 'SEC1234', '8821']) {
    check(`never reads "${leaked}" off the row`, !serialized.includes(leaked));
  }
  check('trims the trailing space in the club alt', entries[0].club === 'Sparks');
}

console.log('checkout parser: an empty room is distinguishable from an unread page');
{
  const { parse } = makeParser();
  // The page renders its own placeholder when nobody is checked in. THIS is the
  // only case that may publish an empty board.
  const empty = parse(page({ rows: '<tr><td class="empty" colspan="6">No clubbers are checked in</td></tr>' }));
  check('the page\'s own empty placeholder yields an empty board',
    Array.isArray(empty) && empty.length === 0, JSON.stringify(empty));

  // Rows present but unparseable = selector drift. Must be null (unknown), NOT
  // an empty array, or the lobby is told the building is clear.
  const drifted = parse(page({ rows: '<tr><td class="somethingelse">Amy Hendricks</td></tr>' }));
  check('selector drift reads as UNKNOWN, not as an empty room', drifted === null,
    JSON.stringify(drifted));
}

console.log('checkout parser: the four guards');
{
  {
    const { parse } = makeParser();
    check('a login page is refused',
      parse('<html><body><input name="LoginForm[username]"></body></html>') === null);
    check('an empty response is refused', parse('') === null);
    check('a null response is refused', parse(null) === null);
  }
  {
    const { parse } = makeParser();
    // GUARD 1: any page that is not positively the checkout page. A redirect to
    // a dashboard would otherwise parse some other table and find zero children.
    check('a page whose title is not "Checkout Clubber" is refused',
      parse(page({ title: 'KVBC - Dashboard' })) === null);
  }
  {
    const { parse } = makeParser();
    // GUARD 2: the notices table comes FIRST in the document. A parser using
    // querySelector('table') reads that one, finds no children, and publishes an
    // empty board. Proven by checking the real data table is still found.
    const entries = parse(page());
    check('the unrelated notices table is skipped, not parsed',
      Array.isArray(entries) && entries.length === 2, JSON.stringify(entries));
  }
  {
    const { parse, logs } = makeParser();
    // GUARD 3: a volunteer unticked one club filter. The page now shows a
    // subset, so every child in the hidden clubs looks picked up.
    check('a club-FILTERED page is refused entirely',
      parse(page({ filters: [true, false, true] })) === null);
    check('and it says why', logs.some((l) => /club-filtered/i.test(l)), JSON.stringify(logs));
    // All-checked is the default view and must be accepted.
    check('an unfiltered page is accepted',
      Array.isArray(parse(page({ filters: [true, true, true] }))));
  }
  {
    const { parse } = makeParser();
    // GUARD 4: no rows at all and no placeholder.
    check('a table with only a header row reads as unknown',
      parse(page({ rows: '' })) === null);
  }
}

console.log('checkout feed: the server-side validator');
{
  const feeds = require(path.join(__dirname, '..', 'print-server', 'feeds.js'));
  const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));
  let clock = 1_000_000;
  const submit = (body) => { clock += 60_000; return feeds.submitFeed('checkout', body, clock); };

  check('checkout is a registered feed', feeds.FEED_NAMES.includes('checkout'));
  check('and it is throttled harder than the aggregate feeds',
    feeds.FEED_THROTTLE_MS.checkout > 5000, String(feeds.FEED_THROTTLE_MS.checkout));

  const ok = submit({ entries: [{ firstName: 'Amy', club: 'Sparks' }], printed: 43 });
  check('a well-formed board is accepted', ok.valid === true && !ok.throttled, JSON.stringify(ok));
  check('and carries entries + at + printed',
    ok.payload && Array.isArray(ok.payload.entries) && ok.payload.at && ok.payload.printed === 43);

  // The builder is the structural privacy boundary — assert it here too, because
  // this is the path a real scraper regression would take.
  const dirty = submit({
    entries: [{
      firstName: 'Amy', club: 'Sparks', lastName: 'Hendricks',
      allergies: 'peanuts', clubberId: '8821', guardian: 'R. Hendricks', securityCode: 'SEC1234',
    }],
    printed: 43,
  });
  check('extra fields are stripped, not passed through',
    JSON.stringify(dirty.payload.entries) === JSON.stringify([{ firstName: 'Amy', club: 'Sparks' }]),
    JSON.stringify(dirty.payload.entries));
  for (const leaked of ['Hendricks', 'peanuts', '8821', 'SEC1234']) {
    check(`the payload cannot carry ${leaked}`, !JSON.stringify(dirty.payload).includes(leaked));
  }

  check('an empty board is valid (everyone went home)',
    submit({ entries: [], printed: 43 }).valid === true);
  const missing = submit({ printed: 43 });
  check('a MISSING entries array is a 400, not an empty board',
    missing.valid === false && /not an empty board/.test(missing.reason), JSON.stringify(missing));
  check('a non-object body is rejected', submit('Amy').valid === false);
  check('a negative printed is rejected', submit({ entries: [], printed: -1 }).valid === false);
  check('an oversized board is rejected',
    submit({ entries: Array.from({ length: events.CHECKOUT_MAX + 5 }, () => ({ firstName: 'A' })) }).valid === false);
  const allBad = submit({ entries: [{ firstName: '   ' }, { firstName: '' }] });
  check('a non-empty board whose every entry is unusable is rejected as drift',
    allBad.valid === false && /drifted/.test(allBad.reason), JSON.stringify(allBad));

  // Throttling: this payload is the most sensitive on the channel, so a
  // re-scraping loop must not republish it repeatedly.
  clock += 60_000;
  const first = feeds.submitFeed('checkout', { entries: [] }, clock);
  const second = feeds.submitFeed('checkout', { entries: [] }, clock + 1000);
  check('a rapid re-post is throttled',
    first.throttled === false && second.throttled === true,
    `${first.throttled} / ${second.throttled}`);
}

console.log('checkout transport: the board is sealed like a check-in');
{
  const events = require(path.join(__dirname, '..', 'print-server', 'events.js'));
  check('checkout is in the encrypted set', events.ENCRYPTED_EVENTS.has('checkout'));
  // A list of who is still unattended is the most sensitive payload this system
  // produces; it must never be the one event that rides in the clear.
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'envelope-vectors.json'), 'utf8'));
  events.setDisplayKey(fixture.testKey);
  const sealed = events.seal('checkout', events.buildCheckout(
    [{ firstName: 'Amy', club: 'Sparks' }], 43));
  check('it seals', Boolean(sealed && sealed.ct));
  check('and no name appears in the sealed frame', !JSON.stringify(sealed).includes('Amy'));
  const opened = events.openForTest(fixture.testKey, 'checkout', sealed);
  check('and it opens back to the board', opened.entries[0].firstName === 'Amy');
  let replayed = false;
  try { events.openForTest(fixture.testKey, 'checkin', sealed); replayed = true; } catch { /* expected */ }
  check('a checkout frame cannot be replayed as a checkin', replayed === false);

  // Realistic worst case must stay under Pusher's per-event ceiling.
  const big = events.seal('checkout', events.buildCheckout(
    Array.from({ length: events.CHECKOUT_MAX }, () => ({
      firstName: 'Nathaniel', club: 'Truth & Training' })), 200));
  const bytes = Buffer.from(JSON.stringify(big), 'utf8').length;
  check(`a full ${events.CHECKOUT_MAX}-child board stays under Pusher's ceiling`,
    bytes < events.PUSHER_MAX_BYTES, `${bytes} bytes`);
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
