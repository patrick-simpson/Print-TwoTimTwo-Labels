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

// Fresh sandbox per scenario: the helpers close over `printedNames` and
// `ROSTER_NAME_INDEX`, which we supply.
function sandbox() {
  const printedNames = new Set();
  const ROSTER_NAME_INDEX = {};
  const body = HELPERS.map(extractFunction).join('\n');
  const factory = new Function(
    'printedNames',
    'ROSTER_NAME_INDEX',
    `${body}\n; return { ${HELPERS.join(', ')} };`
  );
  return Object.assign(factory(printedNames, ROSTER_NAME_INDEX), { printedNames, ROSTER_NAME_INDEX });
}

console.log('extension identity keys — extraction');
{
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

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
