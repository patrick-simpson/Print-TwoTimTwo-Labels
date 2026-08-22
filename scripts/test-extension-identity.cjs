#!/usr/bin/env node
// Tests for the Chrome extension's identity/dedup helpers — plain Node, zero deps.
//
// Why this file looks unusual: chrome-extension/content.js is a single IIFE that
// runs against a live page and exports nothing, so it cannot be require()'d.
// Rather than re-implement the logic here (which would test a COPY and pass
// happily while the shipped code broke), this extracts the real function source
// out of content.js and evaluates it against stubbed state. If a helper is
// renamed or deleted, extraction fails loudly instead of silently passing.
//
// What it guards: whether a child has already had a label printed. Getting this
// wrong means either a duplicate label for a child who was already printed, or a
// missed label for one who wasn't — the two failure modes that matter most at a
// check-in table.
//
// Run: npm run test:extension  (or: node scripts/test-extension-identity.cjs)

'use strict';

// A crashed suite must FAIL, not pass: server.js's uncaughtException handler
// (a production never-crash feature) can swallow a test-time crash, letting
// the event loop drain and the process exit 0 without a summary ever printing.
// If we reach 'exit' with code 0 and the suite never declared itself finished,
// force red. (Found the hard way: a ReferenceError mid-suite passed CI.)
let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('\u2717 Test suite terminated before completing (crash swallowed?) \u2014 failing.');
    process.exitCode = 1;
  }
});


const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'chrome-extension', 'content.js'),
  'utf8'
);

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

// Pull one `function name(...) { ... }` declaration out of the source by
// brace-matching, so we evaluate exactly what ships.
function extractFunction(name) {
  const start = SRC.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(`content.js no longer defines function ${name}() — update this test with the refactor`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '{') { depth++; opened = true; }
    else if (ch === '}') {
      depth--;
      if (opened && depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while extracting ${name}() from content.js`);
}

const HELPERS = ['nameKeyOf', 'identityKey', 'migrateLegacyKey', 'resolveIdentityKey', 'isPrinted'];

// The sentinel scanClubberList() stores when one name maps to two clubber ids.
const AMBIGUOUS_NAME = '*ambiguous*';

// Fresh sandbox per scenario: the helpers close over `printedNames` and
// `ROSTER_NAME_INDEX`, which we supply.
function sandbox() {
  const printedNames = new Set();
  const ROSTER_NAME_INDEX = {};
  const body = HELPERS.map(extractFunction).join('\n');
  const factory = new Function(
    'printedNames',
    'ROSTER_NAME_INDEX',
    'AMBIGUOUS_NAME',
    `${body}\n; return { ${HELPERS.join(', ')} };`
  );
  return Object.assign(
    factory(printedNames, ROSTER_NAME_INDEX, AMBIGUOUS_NAME),
    { printedNames, ROSTER_NAME_INDEX }
  );
}

console.log('extension identity keys — extraction');
{
  // If content.js renames or changes the sentinel, these tests would silently
  // stop covering the collision path — pin the literal.
  check("content.js still uses the '" + AMBIGUOUS_NAME + "' sentinel",
    SRC.indexOf("'" + AMBIGUOUS_NAME + "'") !== -1);
  for (const name of HELPERS) {
    check(`content.js still defines ${name}()`, extractFunction(name).length > 0);
  }
}

console.log('identityKey / nameKeyOf');
{
  const h = sandbox();
  check('a recid produces an id: key', h.identityKey('662', 'Zzclaude Demotest') === 'id:662');
  check('no recid falls back to an nm: key', h.identityKey(null, 'Jane Doe') === 'nm:' + h.nameKeyOf('Jane Doe'));
  check('name keys are case/whitespace insensitive',
    h.nameKeyOf('  JANE   Doe ') === h.nameKeyOf('jane doe'),
    `${JSON.stringify(h.nameKeyOf('  JANE   Doe '))} vs ${JSON.stringify(h.nameKeyOf('jane doe'))}`);
}

console.log('migrateLegacyKey — a mid-event update must not reprint the room');
{
  const h = sandbox();
  check('legacy bare name becomes an nm: key', h.migrateLegacyKey('jane doe') === 'nm:jane doe');
  check('an existing nm: key is untouched', h.migrateLegacyKey('nm:jane doe') === 'nm:jane doe');
  check('an existing id: key is untouched', h.migrateLegacyKey('id:42') === 'id:42');
  check('non-strings pass through safely', h.migrateLegacyKey(null) === null);
}

console.log('isPrinted — no duplicate labels, no missed labels');
{
  // The walk-in path: printed by hand under a name, then registered (F-3),
  // which checks the child in, so the reconcile report returns a real id.
  const h1 = sandbox();
  h1.printedNames.add('nm:' + h1.nameKeyOf('Zoe Guest'));
  check('walk-in printed by name counts as printed once the report supplies an id',
    h1.isPrinted('Zoe Guest', '700') === true);

  // The reverse: printed off a roster row (id known), later asked by name only.
  const h2 = sandbox();
  h2.ROSTER_NAME_INDEX[h2.nameKeyOf('Amy Zephyr')] = 'id:101';
  h2.printedNames.add('id:101');
  check('roster child printed by id counts as printed when asked by name alone',
    h2.isPrinted('Amy Zephyr', null) === true);

  // Must NOT over-suppress, or reconcile silently stops rescuing missed kids.
  const h3 = sandbox();
  check('a child who has not been printed is reported as not printed',
    h3.isPrinted('Brand New', '999') === false);

  // The collision the identity key exists to solve.
  const h4 = sandbox();
  h4.printedNames.add('id:501');
  check('two children sharing a name stay distinct by id',
    h4.isPrinted('Ava Brown', '502') === false);

  // A blank/garbage name must not accidentally match a real record.
  const h5 = sandbox();
  h5.printedNames.add('id:101');
  check('an empty name does not match an unrelated printed record',
    h5.isPrinted('', null) === false);
}

console.log('same-name collision — must never attribute one child\'s data to another');
{
  // REGRESSION GUARD: ROSTER_NAME_INDEX held ONE identity per name, so two
  // children sharing a display name resolved to whichever row was scanned
  // last. The label then printed with the other child's club and consent data
  // AND marked that child printed, so she never got a label at all. The index
  // now stores an ambiguity sentinel and callers refuse to guess.
  //
  // Note this covers the NAME-ONLY resolution path (what the last-checkin
  // observer actually uses) — distinct from the explicit-recid path above.
  const h = sandbox();
  h.ROSTER_NAME_INDEX[h.nameKeyOf('Jane Doe')] = AMBIGUOUS_NAME;

  check('an ambiguous name does NOT resolve to either child\'s id',
    h.resolveIdentityKey('Jane Doe', null) === 'nm:' + h.nameKeyOf('Jane Doe'),
    h.resolveIdentityKey('Jane Doe', null));

  // Printing one Jane must not mark the other Jane as printed via a borrowed id.
  h.printedNames.add('id:555');
  check('a child printed under one id is not implied printed by the shared name',
    h.isPrinted('Jane Doe', null) === false);

  // An explicit id still wins — the caller genuinely knows which child it is.
  check('an explicit id still resolves exactly despite the name collision',
    h.resolveIdentityKey('Jane Doe', '666') === 'id:666');
  check('the explicitly-identified printed child is still recognised',
    h.isPrinted('Jane Doe', '555') === true);

  // A non-colliding name keeps resolving through the index as before.
  const h2 = sandbox();
  h2.ROSTER_NAME_INDEX[h2.nameKeyOf('Amy Zephyr')] = 'id:101';
  check('a unique name still resolves through the index',
    h2.resolveIdentityKey('Amy Zephyr', null) === 'id:101');
}

// ── Privacy badge in the page widget ─────────────────────────────────────────
// The panel is injected into a page served by twotimtwo.com, so everything it
// renders is readable by that site's scripts. The badge therefore shows STATE
// ONLY — encrypted or not, plus the public `kid` fingerprint — and never the
// display key itself. The server also redacts displayKey for any non-loopback
// caller, so the extension has no way to obtain it; these assertions are the
// second lock, guarding a future edit that "helpfully" surfaces it here.
console.log('');
console.log('extension privacy badge');
{
  const { JSDOM } = require('jsdom');

  function render(health) {
    const dom = new JSDOM('<!doctype html><body><div id="awana-privacy-status"></div></body>');
    const { document } = dom.window;
    const factory = new Function(
      'document', 'PRINT_SERVER',
      `${extractFunction('renderPrivacyStatus')}\n; return renderPrivacyStatus;`
    );
    factory(document, 'http://localhost:3456')(health);
    return document.getElementById('awana-privacy-status');
  }

  check('content.js still defines renderPrivacyStatus()',
    extractFunction('renderPrivacyStatus').length > 0);

  // No welcome screen means no names on the wire. Silence is correct — a badge
  // here would be noise on every check-in page at a church that has no TV.
  const none = render({ pusher: { configured: false } });
  check('with no Pusher configured the badge is hidden', none.style.display === 'none');
  check('...and says nothing at all', none.textContent === '');

  const missing = render({ pusher: { configured: true }, displayKeyConfigured: false });
  check('with a screen but no key the badge is shown', missing.style.display === 'block');
  check('...and says names are NOT encrypted', /NOT encrypted/.test(missing.textContent),
    missing.textContent);
  const link = missing.querySelector('a');
  check('...and links straight to the display-key setting',
    !!link && link.href === 'http://localhost:3456/#display-key',
    link && link.href);
  check('...opening the dashboard in a new tab safely',
    !!link && link.target === '_blank' && /noopener/.test(link.rel || ''));

  const ok = render({
    pusher: { configured: true }, displayKeyConfigured: true, displayKeyId: 'a1b2c3d4',
  });
  check('with a key the badge confirms encryption', /encrypted/i.test(ok.textContent),
    ok.textContent);
  check('...and shows the kid fingerprint so two screens can be compared',
    /a1b2c3d4/.test(ok.textContent), ok.textContent);
  check('...without claiming NOT encrypted', !/NOT/.test(ok.textContent), ok.textContent);

  // The one that matters. If /health ever regressed to shipping the key, or a
  // future edit read it from somewhere, this catches it rendering in a page
  // twotimtwo.com can read.
  const SECRET = 'kAyO1YHu9r7vQ2mWxZs4tE6bN8pL0cJd5fG3hR7uT1o=';
  const leaky = render({
    pusher: { configured: true }, displayKeyConfigured: true,
    displayKeyId: 'a1b2c3d4', displayKey: SECRET, key: SECRET,
  });
  check('the key is NEVER rendered into the page, even if /health sent one',
    !leaky.innerHTML.includes(SECRET), leaky.innerHTML.slice(0, 200));

  // Same rule at the source: nothing in the extension may read a key field off
  // /health, and nothing may write one into the DOM.
  check('content.js never reads a displayKey value from the server',
    !/\.displayKey\b(?!Configured|Id)/.test(SRC),
    (SRC.match(/\.displayKey\b(?!Configured|Id)/g) || []).join(','));
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
__suiteFinished = true;
process.exit(failed > 0 ? 1 : 0);
