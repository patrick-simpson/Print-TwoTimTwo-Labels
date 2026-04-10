'use strict';

// Awana Label Print Server — entry point.
//
// Listens on http://localhost:<port> (default 3456) and accepts POST /print
// from the Chrome extension. All routing/business logic lives in ./src —
// this file just wires the modules together and starts the HTTP listener.

// ── Process-level safety net ─────────────────────────────────────────────
// Last line of defence: if something unexpected bubbles all the way up,
// log it but NEVER crash the process — a live event cannot afford a dead
// print server.
process.on('uncaughtException',  err => console.error('[fatal] Uncaught exception (server kept alive):', err));
process.on('unhandledRejection', err => console.error('[fatal] Unhandled rejection (server kept alive):', err));

const config = require('./src/config');
const { build, checkForUpdates } = require('./src/routes');
const SERVER_VERSION = require('./package.json').version;

const cfg = config.load();
const app = build();

const server = app.listen(cfg.port, () => {
  console.log(`\n  Awana Print Server v${SERVER_VERSION}  •  http://localhost:${cfg.port}`);
  console.log(`  Dashboard : http://localhost:${cfg.port}/`);
  console.log(`  Printer   : ${cfg.printerName || '(system default)'}`);
  console.log(`  Config    : ${config.resolveConfigPath()}`);
  console.log('  Waiting for check-ins. Press Ctrl+C to stop.\n');
});

// Fail loudly if the port is already in use instead of silently killing
// whatever else is there — the old PowerShell installer killed any
// process on 3456, which was unsafe.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${cfg.port} is already in use.`);
    console.error('  Another print server may already be running.');
    console.error('  Close the other copy (or change "port" in config.json) and try again.\n');
    process.exit(1);
  }
  throw err;
});

// Poll GitHub for updates on startup and every 6 hours.
checkForUpdates();
setInterval(checkForUpdates, 6 * 3600 * 1000).unref();
