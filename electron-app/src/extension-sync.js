// Keep the Chrome extension's files in step with the installed app.
//
// What this can and cannot do, stated plainly because the difference matters:
// the extension is installed UNPACKED (chrome://extensions → Load unpacked),
// and Chrome never auto-updates an unpacked extension. Self-hosting an
// `update_url` is not an option either — Chrome only honours that for Web
// Store or enterprise-policy installs. So true silent auto-update is off the
// table for how this extension is distributed.
//
// What IS achievable, and what this module does: make the folder Chrome loads
// from a folder the INSTALLER owns. The app copies its bundled extension into
// one stable path under userData on every launch, and the operator loads that
// path unpacked exactly once. From then on an app update rewrites those files
// underneath Chrome, and picking them up costs a Chrome restart instead of a
// download-unzip-reload cycle. The version banner in the page widget tells
// them when that restart is owed.
//
// Deliberately Electron-free so it can be unit-tested with a temp directory,
// same reasoning as config-store.js.

const fs = require('fs');
const path = require('path');

// A guard, not a limit: the real extension is ~10 flat files. Anything wildly
// outside that shape means we are pointed at the wrong directory, and copying
// it into userData would be the wrong move.
const MAX_FILES = 200;
const MAX_BYTES = 32 * 1024 * 1024;

function readManifestVersion(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    const version = JSON.parse(raw).version;
    return typeof version === 'string' && version.trim() ? version.trim() : null;
  } catch {
    return null;
  }
}

// Relative paths of every regular file under `dir`, depth-first, sorted.
// Symlinks are skipped rather than followed: this walks a directory we are
// about to copy wholesale into the user's profile, and a link pointing out of
// the tree would copy something we never intended to ship.
function listFiles(dir, prefix = '', out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      listFiles(path.join(dir, entry.name), rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

// Write via a temp file in the same directory + rename. Chrome may have this
// very folder loaded, and a half-written content.js that it happens to read is
// a broken extension on the check-in page — the one screen that must not break.
function writeFileAtomic(destPath, buffer) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, destPath);
}

/**
 * Copy `sourceDir` into `targetDir`, skipping the copy entirely when the two
 * already hold the same manifest version.
 *
 * @returns {{action: string, version: string|null, targetDir: string, error?: string, files?: number}}
 *   action is one of:
 *     'installed' — target did not exist, files written
 *     'updated'   — versions differed, files rewritten
 *     'current'   — versions matched, nothing touched
 *     'skipped'   — no usable source bundle (dev checkout, bad path)
 *     'failed'    — the copy itself threw; `error` says why
 */
function syncExtension({ sourceDir, targetDir, force = false } = {}) {
  const result = { action: 'skipped', version: null, targetDir: targetDir || null };
  if (!sourceDir || !targetDir) {
    result.error = 'sourceDir and targetDir are required';
    return result;
  }

  const sourceVersion = readManifestVersion(sourceDir);
  if (!sourceVersion) {
    // No bundled extension (running from a dev checkout without one, or the
    // packaged resource is missing). Report the target's state so callers can
    // still show the operator where the folder is.
    result.version = readManifestVersion(targetDir);
    result.error = 'no manifest.json in the bundled extension';
    return result;
  }

  const targetVersion = readManifestVersion(targetDir);
  if (!force && targetVersion === sourceVersion) {
    return { action: 'current', version: sourceVersion, targetDir };
  }

  const files = listFiles(sourceDir);
  if (!files.length) {
    result.version = targetVersion;
    result.error = 'the bundled extension folder is empty';
    return result;
  }
  if (files.length > MAX_FILES) {
    result.version = targetVersion;
    result.error = `refusing to copy ${files.length} files — that is not the extension folder`;
    return result;
  }

  try {
    let bytes = 0;
    for (const rel of files) {
      const buf = fs.readFileSync(path.join(sourceDir, rel));
      bytes += buf.length;
      if (bytes > MAX_BYTES) throw new Error('bundled extension is implausibly large');
      writeFileAtomic(path.join(targetDir, rel), buf);
    }

    // Drop files the new version no longer ships. A stale content script left
    // behind is not merely clutter — manifest.json can still list it, and then
    // Chrome loads old code alongside new.
    const wanted = new Set(files);
    for (const rel of listFiles(targetDir)) {
      if (wanted.has(rel) || rel.endsWith('.tmp')) continue;
      try { fs.unlinkSync(path.join(targetDir, rel)); } catch { /* best effort */ }
    }

    return {
      action: targetVersion ? 'updated' : 'installed',
      version: sourceVersion,
      targetDir,
      files: files.length,
    };
  } catch (e) {
    return {
      action: 'failed',
      version: targetVersion,
      targetDir,
      error: e && e.message ? e.message : String(e),
    };
  }
}

module.exports = { syncExtension, readManifestVersion, listFiles };
