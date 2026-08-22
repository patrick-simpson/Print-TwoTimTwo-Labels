#!/usr/bin/env node
// Tests for the Electron app's managed copy of the Chrome extension — plain
// Node, zero deps.
//
// WHAT THIS GUARDS
//
// The extension is installed UNPACKED, and Chrome never auto-updates an
// unpacked extension. Before this, "update the extension" meant: notice the
// version banner, find the zip, download it, unzip it somewhere, remove the old
// entry in chrome://extensions, Load unpacked again. In practice that means the
// extension drifts behind the .exe for months and nobody notices — the check-in
// page keeps working, just against an older content script.
//
// The fix is not auto-update (that is not available for unpacked extensions).
// It is to make the folder Chrome loads a folder the INSTALLER owns, so an app
// update rewrites those files in place and the cost of picking them up drops to
// a Chrome restart.
//
// That only holds if the copy is trustworthy, which is what these assertions
// are about:
//
//   * Chrome may be reading the target folder DURING the copy. A half-written
//     content.js is a broken extension on the one page that must not break, so
//     every file is written to a temp name and renamed into place.
//   * A file dropped in a new version must not survive in the target. Chrome
//     loads whatever manifest.json lists, so a stale script left behind is old
//     code running alongside new code, not merely clutter.
//   * The target lives in userData, next to config.json and clubbers.csv. A
//     wrong sourceDir must therefore FAIL rather than copy an arbitrary tree
//     into the operator's profile.
//   * A symlink in the source must not be followed out of the tree.
//
// It uses the REAL module (electron-app/src/extension-sync.js), which is
// deliberately Electron-free precisely so it can be tested here.
//
// Run: npm run test:extension-sync  (or: node scripts/test-extension-sync.cjs)

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
const os = require('os');
const path = require('path');

const sync = require('../electron-app/src/extension-sync.js');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'awana-ext-sync-'));
}

// A stand-in for chrome-extension/: a manifest, a couple of scripts, an icon,
// and one nested file so the recursive walk is exercised.
function makeSource(dir, version, extra) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'KVBC Kids Check-in',
    version,
    content_scripts: [{ js: ['content.js', 'feeds.js'] }],
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'content.js'), `// v${version}\nconst EXTENSION_VERSION = '${version}';\n`);
  fs.writeFileSync(path.join(dir, 'feeds.js'), `// feeds v${version}\n`);
  fs.writeFileSync(path.join(dir, 'icon128.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'nested.js'), `// nested v${version}\n`);
  for (const [name, body] of Object.entries(extra || {})) {
    fs.writeFileSync(path.join(dir, name), body);
  }
}

console.log('\nextension-sync');
console.log('─'.repeat(60));

// ── First install ────────────────────────────────────────────────────────────
{
  const root = tmpdir();
  const source = path.join(root, 'bundled');
  const target = path.join(root, 'userData', 'chrome-extension');
  makeSource(source, '5.6.0');

  const r = sync.syncExtension({ sourceDir: source, targetDir: target });
  check('a first sync reports "installed"', r.action === 'installed', `got ${r.action}`);
  check('it reports the bundled version', r.version === '5.6.0', `got ${r.version}`);
  check('it reports the target folder', r.targetDir === target);
  check('it creates the target folder', fs.existsSync(target));
  check('every file lands, including nested ones',
    sync.listFiles(target).join(',') === 'content.js,feeds.js,icon128.png,manifest.json,sub/nested.js',
    sync.listFiles(target).join(','));
  check('file contents match the source',
    fs.readFileSync(path.join(target, 'content.js'), 'utf8').includes("'5.6.0'"));
  check('binary files survive the copy byte-for-byte',
    fs.readFileSync(path.join(target, 'icon128.png')).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  check('no .tmp files are left behind',
    !sync.listFiles(target).some((f) => f.endsWith('.tmp')),
    sync.listFiles(target).join(','));
}

// ── Same version: do nothing ─────────────────────────────────────────────────
{
  const root = tmpdir();
  const source = path.join(root, 'bundled');
  const target = path.join(root, 'target');
  makeSource(source, '5.6.0');
  sync.syncExtension({ sourceDir: source, targetDir: target });

  // Prove "current" really means untouched: an app that rewrites these files on
  // every launch churns the profile and, worse, can race a Chrome read for no
  // reason at all.
  const before = fs.statSync(path.join(target, 'content.js')).mtimeMs;
  fs.writeFileSync(path.join(target, 'local-scratch.txt'), 'left by hand');

  const r = sync.syncExtension({ sourceDir: source, targetDir: target });
  check('a matching version reports "current"', r.action === 'current', `got ${r.action}`);
  check('it does not rewrite files', fs.statSync(path.join(target, 'content.js')).mtimeMs === before);
  check('it does not prune when it did not copy', fs.existsSync(path.join(target, 'local-scratch.txt')));

  const forced = sync.syncExtension({ sourceDir: source, targetDir: target, force: true });
  check('force: true copies anyway', forced.action === 'updated', `got ${forced.action}`);
}

// ── Update ───────────────────────────────────────────────────────────────────
{
  const root = tmpdir();
  const source = path.join(root, 'bundled');
  const target = path.join(root, 'target');
  makeSource(source, '5.6.0', { 'legacy.js': '// dropped in 5.7.0\n' });
  sync.syncExtension({ sourceDir: source, targetDir: target });
  check('the retired file is present before the update', fs.existsSync(path.join(target, 'legacy.js')));

  fs.rmSync(source, { recursive: true, force: true });
  makeSource(source, '5.7.0');   // legacy.js deliberately not recreated

  const r = sync.syncExtension({ sourceDir: source, targetDir: target });
  check('a newer version reports "updated"', r.action === 'updated', `got ${r.action}`);
  check('the new version is written',
    fs.readFileSync(path.join(target, 'content.js'), 'utf8').includes("'5.7.0'"));
  check('the manifest is updated too', sync.readManifestVersion(target) === '5.7.0');
  // The one that actually bites: manifest.json can still list a script the new
  // version dropped, so a survivor means Chrome loads old code beside new.
  check('a file the new version dropped is REMOVED', !fs.existsSync(path.join(target, 'legacy.js')));
  check('files the new version still ships are kept', fs.existsSync(path.join(target, 'sub', 'nested.js')));
}

// ── Downgrade ────────────────────────────────────────────────────────────────
{
  const root = tmpdir();
  const source = path.join(root, 'bundled');
  const target = path.join(root, 'target');
  makeSource(source, '5.7.0');
  sync.syncExtension({ sourceDir: source, targetDir: target });
  fs.rmSync(source, { recursive: true, force: true });
  makeSource(source, '5.6.0');

  // Version DIFFERENCE, not version ordering: after a rollback the app on disk
  // is 5.6.0, and the extension must match the app it talks to rather than
  // stubbornly staying newer.
  const r = sync.syncExtension({ sourceDir: source, targetDir: target });
  check('a rollback rewrites the target to the older version', r.action === 'updated', `got ${r.action}`);
  check('the older files are actually written', sync.readManifestVersion(target) === '5.6.0');
}

// ── Refusals ─────────────────────────────────────────────────────────────────
{
  const root = tmpdir();
  const target = path.join(root, 'target');

  const missing = sync.syncExtension({ sourceDir: path.join(root, 'nope'), targetDir: target });
  check('a missing source is skipped, not copied', missing.action === 'skipped', `got ${missing.action}`);
  check('a missing source explains itself', /manifest/.test(missing.error || ''));
  check('a missing source creates nothing', !fs.existsSync(target));

  const noManifest = path.join(root, 'no-manifest');
  fs.mkdirSync(noManifest, { recursive: true });
  fs.writeFileSync(path.join(noManifest, 'content.js'), '// orphan\n');
  const r2 = sync.syncExtension({ sourceDir: noManifest, targetDir: target });
  check('a folder without manifest.json is skipped', r2.action === 'skipped', `got ${r2.action}`);
  check('...and nothing is copied out of it', !fs.existsSync(path.join(target, 'content.js')));

  const badJson = path.join(root, 'bad-json');
  fs.mkdirSync(badJson, { recursive: true });
  fs.writeFileSync(path.join(badJson, 'manifest.json'), '{ not json');
  check('an unparseable manifest is skipped',
    sync.syncExtension({ sourceDir: badJson, targetDir: target }).action === 'skipped');

  check('a missing targetDir is refused',
    sync.syncExtension({ sourceDir: noManifest }).action === 'skipped');
  check('no arguments at all is refused', sync.syncExtension().action === 'skipped');

  // The blast-radius guard. targetDir is inside the operator's roaming profile,
  // beside config.json and clubbers.csv, so a wrong sourceDir must stop rather
  // than mirror some large tree into it.
  const huge = path.join(root, 'huge');
  fs.mkdirSync(huge, { recursive: true });
  fs.writeFileSync(path.join(huge, 'manifest.json'), JSON.stringify({ version: '9.9.9' }));
  for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(huge, `f${i}.js`), 'x');
  const r3 = sync.syncExtension({ sourceDir: huge, targetDir: path.join(root, 'huge-target') });
  check('an implausibly large source folder is refused', r3.action === 'skipped', `got ${r3.action}`);
  check('...and it says why', /refusing to copy/.test(r3.error || ''), r3.error);
  check('...and copies nothing', !fs.existsSync(path.join(root, 'huge-target')));
}

// ── Symlinks are not followed ────────────────────────────────────────────────
// A behavioural pin, not a test of the explicit isSymbolicLink() guard: with
// readdirSync({withFileTypes:true}) a symlink is neither isFile() nor
// isDirectory(), so it is already excluded and the guard is belt-and-braces
// (verified by removing it — these assertions still pass). What this DOES catch
// is a future rewrite to follow-symlink traversal (statSync, or readdir + a
// plain existsSync), which would start copying whatever the link points at.
{
  const root = tmpdir();
  const source = path.join(root, 'bundled');
  const target = path.join(root, 'target');
  const secrets = path.join(root, 'secrets');
  makeSource(source, '5.6.0');
  fs.mkdirSync(secrets, { recursive: true });
  fs.writeFileSync(path.join(secrets, 'config.json'), '{"phonePin":"4821"}');

  let linked = false;
  try {
    fs.symlinkSync(path.join(secrets, 'config.json'), path.join(source, 'linked.json'));
    linked = true;
  } catch { /* Windows without developer mode — nothing to assert */ }

  if (linked) {
    sync.syncExtension({ sourceDir: source, targetDir: target });
    check('a symlink in the source is not copied', !fs.existsSync(path.join(target, 'linked.json')));
    check('...and listFiles omits it', !sync.listFiles(source).includes('linked.json'));
  } else {
    check('symlink test skipped (platform cannot create one)', true);
    check('symlink test skipped (platform cannot create one)', true);
  }
}

// ── readManifestVersion ──────────────────────────────────────────────────────
{
  const root = tmpdir();
  check('readManifestVersion returns null for a missing folder',
    sync.readManifestVersion(path.join(root, 'nope')) === null);
  fs.mkdirSync(path.join(root, 'blank'), { recursive: true });
  fs.writeFileSync(path.join(root, 'blank', 'manifest.json'), JSON.stringify({ version: '   ' }));
  check('readManifestVersion rejects a blank version',
    sync.readManifestVersion(path.join(root, 'blank')) === null);
  fs.writeFileSync(path.join(root, 'blank', 'manifest.json'), JSON.stringify({ version: 3 }));
  check('readManifestVersion rejects a non-string version',
    sync.readManifestVersion(path.join(root, 'blank')) === null);
}

// ── Wiring: the real repo, the real installer config ─────────────────────────
{
  const repo = path.join(__dirname, '..');
  const realExt = path.join(repo, 'chrome-extension');
  check('the real chrome-extension/ folder has a readable version',
    /^\d+\.\d+\.\d+$/.test(sync.readManifestVersion(realExt) || ''),
    String(sync.readManifestVersion(realExt)));

  // The whole scheme rests on the extension actually shipping inside the .exe.
  // Without this extraResources entry the app has nothing to copy and every
  // sync silently reports "skipped" on real installs.
  const builder = JSON.parse(fs.readFileSync(path.join(repo, 'electron-app', 'package.json'), 'utf8'));
  const resources = (builder.build && builder.build.extraResources) || [];
  const extRes = resources.find((r) => r && r.to === 'chrome-extension');
  check('electron-builder ships chrome-extension/ as an extra resource', !!extRes);
  check('...from the repo folder', !!extRes && extRes.from === '../chrome-extension');
  check('...including manifest.json',
    !!extRes && (extRes.filter || []).some((f) => f === '*.json' || f === 'manifest.json'),
    JSON.stringify(extRes && extRes.filter));
  check('...including the content scripts',
    !!extRes && (extRes.filter || []).some((f) => f === '*.js'));

  // The extension version and the app version are compared for equality by
  // checkForExtensionUpdate(); if bump-version.cjs ever stopped touching the
  // manifest, the banner would fire forever on a correct install.
  const rootPkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  check('the bundled extension version matches the app version',
    sync.readManifestVersion(realExt) === rootPkg.version,
    `${sync.readManifestVersion(realExt)} vs ${rootPkg.version}`);

  // The tmp+rename is the only thing standing between a mid-copy Chrome read
  // and a truncated content.js, and it cannot be observed from the outside once
  // the copy has finished — so pin it at the source.
  const syncSrc = fs.readFileSync(path.join(repo, 'electron-app', 'src', 'extension-sync.js'), 'utf8');
  check('files are renamed into place rather than written directly',
    /fs\.renameSync\(tmp, destPath\)/.test(syncSrc));
  check('...and nothing writes straight to the destination path',
    !/fs\.writeFileSync\(destPath/.test(syncSrc));

  const mainSrc = fs.readFileSync(path.join(repo, 'electron-app', 'main.js'), 'utf8');
  check('main.js syncs the extension at startup', /syncBundledExtension\(\)/.test(mainSrc));
  // resources/ is replaced wholesale by an app update, so a target inside it
  // would leave Chrome pointing at a folder that vanished mid-upgrade.
  check('the managed folder lives under userData, not resources/',
    /EXTENSION_DIR = path\.join\(app\.getPath\('userData'\), 'chrome-extension'\)/.test(mainSrc));
  check('main.js hands the result to the print server',
    /setExtensionInfo\(extensionState\)/.test(mainSrc));

  const serverSrc = fs.readFileSync(path.join(repo, 'print-server', 'server.js'), 'utf8');
  check('the server exports setExtensionInfo', /setExtensionInfo,/.test(serverSrc));
  // /health is CORS-reachable from the check-in site, and the folder path
  // contains the operator's Windows username.
  check('/health gates the folder path behind a loopback origin',
    /extension: extensionInfo && \(isTrustedConfigOrigin\(req\)/.test(serverSrc));
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
__suiteFinished = true;
process.exit(failed > 0 ? 1 : 0);
