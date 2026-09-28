#!/usr/bin/env node
// Tests for the free-text label: POST /print-custom and the customText branch
// of the ONE renderer.
//
// WHAT THIS GUARDS
//
// * A custom label RECORDS NOTHING. No history row, no attendance ledger
//   entry, no Pusher frame, no change to tonight's count. That is the whole
//   contract of the feature: it is a piece of tape with a word on it, not a
//   person arriving. Every other print path in this server writes at least one
//   of those, so "it wrote nothing" has to be asserted, not assumed.
// * Nothing but the text reaches the label. The renderer is shared with the
//   check-in label, and a custom label that inherited a club line, a footer or
//   a safety icon would be a label that says something untrue. This is pinned
//   by rendering the same text with every other field set and demanding the
//   bytes be identical.
// * The input rules: blank in, blank out (400); a control character never
//   reaches the canvas; a pasted newline is one line, not a ragged gap; and
//   60 characters is the ceiling.
// * The duplicate window absorbs a double-tap and says so, exactly like
//   /print-award does, rather than printing two labels.
//
// Run: node scripts/test-custom-label.cjs

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

const PORT = Number(process.env.AWANA_TEST_PORT || 34599);
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

// Record every trigger instead of reaching the network, so "publishes nothing"
// is checked against what would actually have gone ON THE WIRE. Pusher is
// configured below precisely so a stray publish WOULD land here.
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

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-custom-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-custom-bin-'));

  // printImage() shells out to `powershell`, absent on a Linux runner. Without
  // this stub every print throws at the print step and "it printed and recorded
  // nothing" would pass for entirely the wrong reason.
  const spoolLog = path.join(binDir, 'spool.log');
  fs.writeFileSync(path.join(binDir, 'powershell'), `#!/bin/sh\necho job >> ${spoolLog}\nexit 0\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: 'Fake',
    // Configured so that a stray publish would be visible in `wire`. A test
    // that asserts silence against a disconnected pipe asserts nothing.
    pusherAppId: '1', pusherKey: 'k', pusherSecret: 's', pusherCluster: 'us2',
  }, null, 2));

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);
  process.env.AWANA_BIND_HOST = '127.0.0.1';

  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const {
    generateLabel, normalizeCustomText, splitCustomTextInTwo,
    CUSTOM_TEXT_MAX_CHARS, computeTonightStats,
  } = server;
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  const historyFile = path.join(dataDir, 'print-history.json');
  const historyRows = () => {
    try { return JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch { return []; }
  };
  const spoolJobs = () => {
    try { return fs.readFileSync(spoolLog, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
  };

  // ── 1. The input rules ─────────────────────────────────────────────────────
  console.log('\ncustom label: what counts as printable text');
  {
    check('a blank string is refused', normalizeCustomText('').ok === false);
    check('so is whitespace only', normalizeCustomText('   \t  ').ok === false);
    check('and null/undefined', normalizeCustomText(null).ok === false && normalizeCustomText(undefined).ok === false);
    check('a non-string is coerced, not crashed on', normalizeCustomText(42).ok === true
      && normalizeCustomText(42).text === '42');

    check('internal whitespace is collapsed to one space',
      normalizeCustomText('  Room   4    Helper ').text === 'Room 4 Helper',
      JSON.stringify(normalizeCustomText('  Room   4    Helper ').text));
    check('a pasted newline becomes a space, not a ragged gap',
      normalizeCustomText('Kitchen\nTeam').text === 'Kitchen Team',
      JSON.stringify(normalizeCustomText('Kitchen\nTeam').text));
    check('control characters never reach the canvas',
      normalizeCustomText('VOL\u0007UN\u0000TEER').text === 'VOL UN TEER',
      JSON.stringify(normalizeCustomText('VOL\u0007UN\u0000TEER').text));

    check(`${CUSTOM_TEXT_MAX_CHARS} characters is allowed`,
      normalizeCustomText('x'.repeat(CUSTOM_TEXT_MAX_CHARS)).ok === true);
    check('one more is refused, with a reason a human can read',
      normalizeCustomText('x'.repeat(CUSTOM_TEXT_MAX_CHARS + 1)).ok === false
      && /60 characters/.test(normalizeCustomText('x'.repeat(CUSTOM_TEXT_MAX_CHARS + 1)).error));
    check('the ceiling applies AFTER collapsing, so padding is not fatal',
      normalizeCustomText('  ' + 'x'.repeat(CUSTOM_TEXT_MAX_CHARS) + '  ').ok === true);
  }

  // ── 2. Two lines, when one will not do ─────────────────────────────────────
  console.log('\ncustom label: the last-resort wrap');
  {
    check('it breaks at the space nearest the middle',
      JSON.stringify(splitCustomTextInTwo('Wednesday Kitchen Team Room Four'))
        === JSON.stringify(['Wednesday Kitchen', 'Team Room Four']),
      JSON.stringify(splitCustomTextInTwo('Wednesday Kitchen Team Room Four')));
    check('a single unbroken token splits by character rather than overflowing',
      JSON.stringify(splitCustomTextInTwo('ABCDEF')) === JSON.stringify(['ABC', 'DEF']));
    check('the two halves always rejoin to the original words',
      splitCustomTextInTwo('Room 4 Helper').join(' ') === 'Room 4 Helper');
  }

  // ── 3. Nothing but the text reaches the label ─────────────────────────────
  console.log('\ncustom label: the renderer ignores every other field');
  {
    const plain = await generateLabel({ customText: 'VOLUNTEER' });
    const loaded = await generateLabel({
      customText: 'VOLUNTEER',
      // Everything a check-in label would draw, all at once.
      firstName: 'Testkid', lastName: 'Sample', clubName: 'Sparks',
      allergyTokens: ['NUTS', 'DAIRY'], handbookGroup: 'Flight 3:16',
      isBirthday: true, birthdayAge: 7, isVisitor: true, stepUp: true, stepUpNextClub: 'T&T',
      awanaShares: 12, noPhoto: true, streakCount: 9, isNewKid: true, isLeader: true,
      greeting: 'Sparks Leader', footerText: 'KVBC Awana',
      testBanner: true,
      extras: { inverted: true, goToLine: 'Go to: Music, Rm 4', milestoneLine: '10th night' },
    });
    check('a custom label renders byte-identically however loaded the input is',
      Buffer.compare(plain.buffer, loaded.buffer) === 0,
      `${plain.buffer.length} vs ${loaded.buffer.length} bytes`);
    // Including the TEST band: the band means "this is not a real check-in",
    // and a custom label never was one in any mode.
    check('not even the TEST band', Buffer.compare(plain.buffer, loaded.buffer) === 0);

    const other = await generateLabel({ customText: 'KITCHEN' });
    check('different text really does render differently',
      Buffer.compare(plain.buffer, other.buffer) !== 0);

    const long = await generateLabel({ customText: 'Wednesday Kitchen Team, Room 4 and the back hallway' });
    check('a line too long for the floor still renders a real label',
      long.buffer.length > 1000 && long.buffer[0] === 0x89 && long.buffer[1] === 0x50);

    [plain, loaded, other, long].forEach((r) => { if (r.pngPath) fs.unlinkSync(r.pngPath); });
  }

  // ── 4. The route: refusals ────────────────────────────────────────────────
  console.log('\ncustom label: POST /print-custom refuses bad input');
  {
    const spoolBefore = spoolJobs();
    for (const [label, body] of [
      ['an empty body', {}],
      ['blank text', { text: '   ' }],
      ['control characters only', { text: '\u0001\u0002' }],
      ['text past the ceiling', { text: 'x'.repeat(CUSTOM_TEXT_MAX_CHARS + 1) }],
    ]) {
      const res = await post('/print-custom', body);
      check(`${label} is a 400 with an error`, res.status === 400
        && res.body && res.body.success === false && typeof res.body.error === 'string',
        `status ${res.status} ${JSON.stringify(res.body)}`);
    }
    const badPrinter = await post('/print-custom', { text: 'VOLUNTEER', printerName: 'Brother"; rm -rf /' });
    check('a printer name that is not a printer name is refused', badPrinter.status === 400,
      JSON.stringify(badPrinter.body));
    check('and none of those reached the printer', spoolJobs() === spoolBefore,
      `${spoolBefore} -> ${spoolJobs()}`);
  }

  // ── 5. The route: a real print records NOTHING ────────────────────────────
  console.log('\ncustom label: a print that leaves no trace');
  {
    const historyBefore = historyRows().length;
    const tonightBefore = computeTonightStats().checkedIn;
    const spoolBefore = spoolJobs();
    const wireBefore = wire.length;

    const res = await post('/print-custom', { text: 'VOLUNTEER' });
    const wireAfter = wire.slice(wireBefore);

    check('it prints', res.status === 200 && res.body && res.body.success === true && !res.body.duplicate,
      JSON.stringify(res.body));
    check('one label actually reached the printer', spoolJobs() === spoolBefore + 1,
      `${spoolBefore} -> ${spoolJobs()}`);
    check('NO history row is written', historyRows().length === historyBefore,
      `${historyBefore} -> ${historyRows().length}`);
    check('and none of tonight’s rows mention it',
      !historyRows().some((r) => JSON.stringify(r).includes('VOLUNTEER')));
    check('GET /history agrees', ((await j('/history')).body || []).length === historyBefore);
    check('tonight’s count does not move', computeTonightStats().checkedIn === tonightBefore,
      `${tonightBefore} -> ${computeTonightStats().checkedIn}`);
    check('NOTHING goes on the wire — no checkin, no recap, no tally',
      wireAfter.length === 0, JSON.stringify(wireAfter.map((w) => w.event)));
    check('no attendance ledger file appears either',
      !fs.existsSync(path.join(dataDir, 'attendance.json'))
      || Object.keys(JSON.parse(fs.readFileSync(path.join(dataDir, 'attendance.json'), 'utf8'))).length === 0);
    check('and it is not remembered as a leader',
      !((await j('/leaders')).body.leaders || []).some((l) => /VOLUNTEER/i.test(`${l.firstName} ${l.lastName}`)));
  }

  // ── 6. The duplicate window ───────────────────────────────────────────────
  console.log('\ncustom label: a double-tap is one label');
  {
    const spoolBefore = spoolJobs();
    const dup = await post('/print-custom', { text: 'volunteer' });
    check('the same text again is reported as a duplicate, not an error',
      dup.status === 200 && dup.body.success === true && dup.body.duplicate === true,
      JSON.stringify(dup.body));
    check('and nothing was sent to the printer', spoolJobs() === spoolBefore,
      `${spoolBefore} -> ${spoolJobs()}`);

    const different = await post('/print-custom', { text: 'KITCHEN' });
    check('different text is not suppressed',
      different.body.success === true && !different.body.duplicate, JSON.stringify(different.body));
    check('it printed', spoolJobs() === spoolBefore + 1);

    const historyAfter = historyRows().length;
    check('neither wrote a history row', historyAfter === 0, JSON.stringify(historyRows()));
  }

  // ── 7. The three surfaces ─────────────────────────────────────────────────
  // Source-level, like the club-list checks in test-leaders.cjs: the dashboard
  // card, the phone section and the widget checkbox are plain DOM with no way
  // to be exercised headlessly, but "it never marks a name printed and never
  // registers anyone" is exactly the kind of claim that quietly stops being
  // true, so it is pinned against the shipped source.
  console.log('\ncustom label: the dashboard, the phone and the widget');
  {
    const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    const dash = read('print-server', 'public', 'index.html');
    const phone = read('print-server', 'public', 'phone.html');
    const ext = read('chrome-extension', 'content.js');

    check('the dashboard has a Custom Label card after the leader card',
      dash.indexOf('id="custom-card"') > dash.indexOf('id="leader-card"'));
    check('its input is capped at 60 characters, like the server',
      /id="custom-text" maxlength="60"/.test(dash));
    check('it says out loud that nothing is counted or recorded',
      /not counted, not recorded/i.test(dash));
    check('Enter submits it', /getElementById\('custom-text'\)\.addEventListener\('keydown'/.test(dash));
    check('and it never reloads history afterwards (there is no row to reload)',
      !/printCustomLabel[\s\S]{0,900}loadHistory\(\)/.test(dash));

    check('the phone page has a Custom label panel after the leader panel',
      phone.indexOf('id="custom-panel"') > phone.indexOf('id="leader-panel"')
      && phone.indexOf('id="custom-panel"') < phone.indexOf('id="visitor-form"'));
    check('it posts through the PIN-carrying helper',
      /postJson\('\/print-custom', \{ pin: PIN, text: text \}\)/.test(phone));

    check('the widget has a Custom checkbox beside Leader',
      /createTextNode\('Custom'\)/.test(ext) && /walkInClubRow\.append\(clubSelect, visitorCheck, leaderCheck, customCheck\)/.test(ext));
    check('the two modes are mutually exclusive',
      /if \(leaderCb\.checked\) customCb\.checked = false;/.test(ext)
      && /if \(customCb\.checked\) leaderCb\.checked = false;/.test(ext));
    check('ticking Custom visibly retargets the row',
      /Print Custom Label/.test(ext) && /Label text/.test(ext) && /clubSelect\.disabled = custom/.test(ext));
    const customBranch = ext.slice(ext.indexOf('function printCustomLabel('),
      ext.indexOf('function printCustomLabel(') + 1400);
    check('the widget has a custom print function', customBranch.length > 200);
    check('custom mode never marks a name printed (that is check-in dedup)',
      !/markPrinted/.test(customBranch));
    check('custom mode never registers anyone in TwoTimTwo',
      !/registerWalkInFamily/.test(customBranch));
    check('and it posts to /print-custom, not /print',
      /\/print-custom/.test(customBranch) && !/PRINT_SERVER \+ '\/print'/.test(customBranch));
  }

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Suite crashed:', err);
  __suiteFinished = true;
  process.exit(1);
});
