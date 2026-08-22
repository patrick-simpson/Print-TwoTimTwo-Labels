#!/usr/bin/env node
// Tests for the Electron app's config.json writer — plain Node, zero deps.
//
// WHAT THIS GUARDS
//
// config.json is written by more than one component with very different views of
// it. The print server owns the security and realtime keys; the Electron setup
// wizard owns exactly three (printerName, checkinUrl, launchOnBoot). The
// Electron writer used to replace the whole file with the renderer's three-key
// object, which deleted:
//
//   phonePin, lanAccess, allowedOrigins   — the v5.3.0 LAN auth gate
//   pusherAppId/Key/Secret/Cluster        — the lobby display's feed
//   schedule                              — late-arrival routing
//   historyRetentionDays, connectCard, worksheetPrinter, firstTimerInverted
//
// and the caller restarts the server straight afterwards, so the loss went live
// immediately. The realistic trigger is the worst possible moment: the printer
// jams mid-event, a volunteer opens Settings to switch to the backup printer,
// and clicks Save. Phone check-in then refuses every request (the gate fails
// closed with no PIN), the TV goes dark, and late arrivals stop being routed —
// three unrelated failures from one click, with no error shown.
//
// The regression this file exists to catch is a future edit that reintroduces a
// whole-file write. It uses the REAL module (electron-app/src/config-store.js),
// which is deliberately Electron-free precisely so it can be tested here.
//
// Run: npm run test:config-store  (or: node scripts/test-config-store.cjs)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('../electron-app/src/config-store.js');

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

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'awana-config-store-'));
}

// A config.json shaped like a real one mid-season: every key the server owns,
// including the nested schedule array that a shallow serializer would flatten.
function serverOwnedConfig() {
  return {
    printerName: 'Old Printer',
    checkinUrl: 'https://kvbchurch.twotimtwo.com/clubber/checkin',
    launchOnBoot: true,
    phonePin: '4821',
    lanAccess: true,
    allowedOrigins: ['https://kvbchurch.twotimtwo.com'],
    pusherAppId: '1234567',
    pusherKey: 'abcdef0123456789abcd',
    pusherSecret: 'fedcba9876543210fedc',
    pusherCluster: 'us2',
    historyRetentionDays: 45,
    firstTimerInverted: true,
    worksheetPrinter: 'Office Laser',
    connectCard: { enabled: true, greeting: 'Welcome!' },
    connectCardAutoFirstTimer: true,
    connectCardGreeting: "We're so glad you're here!",
    labelFooter: 'KVBC Awana · Wednesdays 6:15–8:00pm',
    seasonTheme: 'christmas',
    collectibleIcons: false,
    musicalPrinter: true,
    updateBeacon: true,
    labelTemplates: { default: { version: 1, showFooter: false }, spark: { version: 1, showIconPanel: false } },
    schedule: [
      { label: 'Large Group', startsAt: '18:05' },
      { label: 'Handbook', startsAt: '18:35' },
    ],
  };
}

// Every key the setup wizard does NOT send. If a whole-file write comes back,
// all of these vanish and the assertions below fail by name.
const SERVER_OWNED_KEYS = [
  'phonePin', 'lanAccess', 'allowedOrigins',
  'pusherAppId', 'pusherKey', 'pusherSecret', 'pusherCluster',
  'historyRetentionDays', 'firstTimerInverted', 'worksheetPrinter',
  'connectCard', 'connectCardAutoFirstTimer', 'connectCardGreeting',
  'labelFooter', 'labelTemplates', 'seasonTheme', 'collectibleIcons', 'musicalPrinter', 'updateBeacon', 'schedule',
];

console.log('\nconfig-store: merge semantics');
{
  const dir = tmpdir();
  const p = path.join(dir, 'config.json');
  const before = serverOwnedConfig();
  fs.writeFileSync(p, JSON.stringify(before, null, 2));

  // Exactly what electron-app/renderer/components/SetupWizard.jsx sends.
  const patch = { printerName: 'Backup Printer', checkinUrl: before.checkinUrl, launchOnBoot: true };
  const merged = store.saveConfig(p, patch);
  const onDisk = JSON.parse(fs.readFileSync(p, 'utf8'));

  check('the patched key is applied', onDisk.printerName === 'Backup Printer');
  check('saveConfig returns the merged config, not the patch',
    merged.phonePin === '4821' && merged.printerName === 'Backup Printer');

  for (const k of SERVER_OWNED_KEYS) {
    check(`${k} survives a setup-wizard save`,
      JSON.stringify(onDisk[k]) === JSON.stringify(before[k]),
      `expected ${JSON.stringify(before[k])}, got ${JSON.stringify(onDisk[k])}`);
  }

  // The nested schedule must survive with its shape intact, not stringified.
  check('schedule stays an array of objects (not flattened to strings)',
    Array.isArray(onDisk.schedule)
    && onDisk.schedule.length === 2
    && typeof onDisk.schedule[0] === 'object'
    && onDisk.schedule[0].startsAt === '18:05');

  check('no key is lost overall',
    Object.keys(before).every((k) => k in onDisk),
    `missing: ${Object.keys(before).filter((k) => !(k in onDisk)).join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('config-store: first run and malformed files');
{
  const dir = tmpdir();
  const p = path.join(dir, 'nested', 'config.json');

  // First run: no file, no parent directory.
  const merged = store.saveConfig(p, { printerName: 'New' });
  check('a missing config is created, parent dirs and all',
    fs.existsSync(p) && merged.printerName === 'New');
  check('loadConfig round-trips what saveConfig wrote',
    store.loadConfig(p).printerName === 'New');

  // Corrupt file: must not throw, must not merge into garbage.
  fs.writeFileSync(p, '{ this is not json');
  check('a corrupt config reads as null rather than throwing',
    store.loadConfig(p) === null);
  const recovered = store.saveConfig(p, { printerName: 'Recovered' });
  check('a corrupt config is replaced rather than crashing the app',
    recovered.printerName === 'Recovered');

  // A JSON scalar/array is valid JSON but not a config — must not be merged
  // into, or Object.assign would produce index keys from an array.
  fs.writeFileSync(p, '[1,2,3]');
  check('a JSON array is not treated as a config', store.loadConfig(p) === null);
  const fromArray = store.saveConfig(p, { printerName: 'X' });
  check('merging over a JSON array does not produce index keys',
    Object.keys(fromArray).join(',') === 'printerName');
  fs.writeFileSync(p, '"a string"');
  check('a JSON string is not treated as a config', store.loadConfig(p) === null);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('config-store: durability');
{
  const dir = tmpdir();
  const p = path.join(dir, 'config.json');
  fs.writeFileSync(p, JSON.stringify({ phonePin: '1111' }, null, 2));
  store.saveConfig(p, { printerName: 'P' });

  check('no .tmp file is left behind', !fs.existsSync(`${p}.tmp`));
  check('the written file is valid, indented JSON',
    /\n {2}"/.test(fs.readFileSync(p, 'utf8')));

  // An undefined/null patch must be a no-op read-write, not a wipe. main.js
  // passes whatever the renderer sent, and IPC can deliver undefined.
  const untouched = store.saveConfig(p, undefined);
  check('an empty patch preserves the existing config',
    untouched.phonePin === '1111' && untouched.printerName === 'P');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ── Source-level guards ──────────────────────────────────────────────────────
// The unit tests above prove config-store.js is correct. These prove nobody has
// gone around it — the actual regression risk, since the bug being fixed was a
// bare writeFileSync in main.js rather than a wrong merge.
console.log('config-store: nobody bypasses the store');
{
  const mainSrc = fs.readFileSync(
    path.join(__dirname, '..', 'electron-app', 'main.js'), 'utf8');

  check('main.js requires the config store',
    /require\(['"]\.\/src\/config-store['"]\)/.test(mainSrc));
  check('main.js never writes CONFIG_PATH directly',
    !/writeFileSync\(\s*CONFIG_PATH/.test(mainSrc),
    'a direct write to CONFIG_PATH is the exact bug this file guards');
  check('the save-config IPC handler acts on the merged result',
    /const config = saveConfig\(patch\)/.test(mainSrc),
    'it must not pass the renderer patch to startServer/buildTray');

  const wizardSrc = fs.readFileSync(
    path.join(__dirname, '..', 'electron-app', 'renderer', 'components', 'SetupWizard.jsx'), 'utf8');
  check('the setup wizard renders from the merged config it gets back',
    /onSaved\(result\.config \|\| config\)/.test(wizardSrc));

  // The deprecated PowerShell installer read-modify-writes correctly, but
  // ConvertTo-Json defaults to depth 2 on PowerShell 5.1, which serialises
  // config.schedule[].label as a type-name string instead of JSON.
  const ps1 = fs.readFileSync(path.join(__dirname, '..', 'install-and-run.ps1'), 'utf8');
  const converts = ps1.match(/ConvertTo-Json[^\r\n|]*/g) || [];
  check('every ConvertTo-Json that writes config passes -Depth',
    converts.length > 0 && converts.every((c) => /-Depth\s+\d+/.test(c)),
    `found: ${JSON.stringify(converts)}`);
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
