const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(\.\d+)?$/.test(version)) {
  console.error('Usage: node bump-version.js <X.Y.Z[.W]>');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

const files = [
  {
    path: path.join(rootDir, 'install-and-run.ps1'),
    patterns: [
      { from: /# Version\s+:\s+\d+\.\d+\.\d+(\.\d+)?/g, to: '# Version    : ' + version },
      { from: /\ = "\d+\.\d+\.\d+(\.\d+)?"/g, to: ' = "' + version + '"' }
    ]
  },
  {
    path: path.join(rootDir, 'src', 'constants.ts'),
    patterns: [
      { from: /SERVER_VERSION = '\d+\.\d+\.\d+(\.\d+)?'/g, to: "SERVER_VERSION = '" + version + "'" }
    ]
  },
  {
    path: path.join(rootDir, 'print-server', 'package.json'),
    patterns: [
      { from: /"version": "\d+\.\d+\.\d+(\.\d+)?"/g, to: '"version": "' + version + '"' }
    ]
  },
  {
      path: path.join(rootDir, 'electron-app', 'package.json'),
      patterns: [
        { from: /"version": "\d+\.\d+\.\d+(\.\d+)?"/g, to: '"version": "' + version + '"' }
      ]
  },
  {
    path: path.join(rootDir, 'chrome-extension', 'manifest.json'),
    patterns: [
      { from: /"version": "\d+\.\d+\.\d+(\.\d+)?"/g, to: '"version": "' + version + '"' }
    ]
  },
  {
    path: path.join(rootDir, 'chrome-extension', 'content.js'),
    patterns: [
      { from: /EXTENSION_VERSION = '[^']+'/g, to: "EXTENSION_VERSION = '" + version + "'" }
    ]
  },
  {
    path: path.join(rootDir, 'chrome-extension', 'popup.html'),
    patterns: [
      { from: /Extension v[\d.]+/g, to: 'Extension v' + version }
    ]
  },
  {
    path: path.join(rootDir, 'package.json'),
    patterns: [
      { from: /"version": "\d+\.\d+\.\d+(\.\d+)?"/g, to: '"version": "' + version + '"' }
    ]
  },
  {
    path: path.join(rootDir, 'VERSION'),
    patterns: [
      { from: /\d+\.\d+\.\d+(\.\d+)?/g, to: version }
    ]
  }
];

files.forEach(file => {
  if (!fs.existsSync(file.path)) {
    console.warn('Warning: File not found:', file.path);
    return;
  }
  let content = fs.readFileSync(file.path, 'utf8');
  file.patterns.forEach(p => {
    content = content.replace(p.from, p.to);
  });
  fs.writeFileSync(file.path, content);
  console.log('Updated:', file.path);
});

// Rebuild the downloadable extension zips so they can't drift from the
// source we just stamped. (Found the hard way: the committed zips still
// contained the 4.0.0 extension while the repo was at 5.0.2 — the website's
// "Download chrome-extension.zip" button served a two-major-versions-stale
// extension because nothing regenerated them on bump.)
function rebuildExtensionZips() {
  const zipTargets = [
    path.join(rootDir, 'chrome-extension.zip'),
    path.join(rootDir, 'public', 'chrome-extension.zip'),
  ];
  const srcDir = path.join(rootDir, 'chrome-extension');
  const primary = zipTargets[0];
  try {
    fs.rmSync(primary, { force: true });
    if (process.platform === 'win32') {
      // Compress-Archive can't produce a zip whose entries are prefixed with
      // the folder name unless we pass the directory itself.
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${srcDir}' -DestinationPath '${primary}' -Force"`,
        { stdio: 'pipe' }
      );
    } else {
      execSync(`zip -q -r '${primary}' chrome-extension -x '*.DS_Store'`, { cwd: rootDir, stdio: 'pipe' });
    }
    for (const target of zipTargets.slice(1)) {
      fs.copyFileSync(primary, target);
    }
    zipTargets.forEach(t => console.log('Rebuilt:', t));
  } catch (e) {
    console.error('ERROR: could not rebuild chrome-extension.zip:', e.message);
    console.error('Rebuild it manually before committing — the website serves this file.');
    process.exitCode = 1;
  }
}
rebuildExtensionZips();

console.log('Successfully bumped version to:', version);
