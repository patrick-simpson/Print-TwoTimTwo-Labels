'use strict';

// Structured logger with levels. Writes to stderr for warnings/errors
// so they can be piped separately during event-night triage.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level, scope, msg, stream) {
  if (LEVELS[level] < CURRENT) return;
  const line = `${ts()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  stream.write(line + '\n');
}

function make(scope) {
  return {
    debug: (msg) => emit('debug', scope, msg, process.stdout),
    info:  (msg) => emit('info',  scope, msg, process.stdout),
    warn:  (msg) => emit('warn',  scope, msg, process.stderr),
    error: (msg) => emit('error', scope, msg, process.stderr),
  };
}

module.exports = { make };
