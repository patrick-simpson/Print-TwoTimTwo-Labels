const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node bump-version.js <X.Y.Z>');
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');

const files = [
  {
    path: path.join(rootDir, 'install-and-run.ps1'),
    patterns: [
      { from: /# Version\s+:\s+\d+\.\d+\.\d+/g, to: '# Version    : ' + version },
      { from: /\ = "\d+\.\d+\.\d+"/g, to: ' = "' + version + '"' }
    ]
  },
  {
    path: path.join(rootDir, 'src', 'constants.ts'),
    patterns: [
      { from: /SERVER_VERSION = '\d+\.\d+\.\d+'/g, to: "SERVER_VERSION = '" + version + "'" }
    ]
  },
  {
    path: path.join(rootDir, 'print-server', 'package.json'),
    patterns: [
      { from: /"version": "\d+\.\d+\.\d+"/g, to: '"version": "' + version + '"' }
    ]
  },
  {
      path: path.join(rootDir, 'electron-app', 'package.json'),
      patterns: [
        { from: /"version": "\d+\.\d+\.\d+"/g, to: '"version": "' + version + '"' }
      ]
  },
  {
    path: path.join(rootDir, 'chrome-extension', 'manifest.json'),
    patterns: [
      { from: /"version": "\d+\.\d+\.\d+"/g, to: '"version": "' + version + '"' }
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
      { from: /"version": "\d+\.\d+\.\d+"/g, to: '"version": "' + version + '"' }
    ]
  },
  {
    path: path.join(rootDir, 'VERSION'),
    patterns: [
      { from: /\d+\.\d+\.\d+/g, to: version }
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

console.log('Successfully bumped version to:', version);
