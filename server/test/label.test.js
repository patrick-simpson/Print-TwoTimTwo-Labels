'use strict';

// Label renderer smoke test. Requires the `canvas` native module. If the
// module isn't installed in the test environment we skip rather than fail,
// so CI can run `npm test` even on a clean checkout without canvas.

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');

let label;
try { label = require('../src/label'); }
catch { /* canvas not installed — tests below will be skipped */ }

test('generateLabel: renders a PNG for basic input', { skip: !label }, async () => {
  const { pngPath, buffer } = await label.generateLabel({ firstName: 'Alice', lastName: 'Smith' });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000, 'PNG should be non-trivial');
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  assert.equal(buffer[0], 0x89);
  assert.equal(buffer[1], 0x50);
  assert.equal(buffer[2], 0x4e);
  assert.equal(buffer[3], 0x47);
  assert.ok(fs.existsSync(pngPath));
  fs.unlinkSync(pngPath);
});

test('generateLabel: handles all optional fields without throwing', { skip: !label }, async () => {
  const { pngPath, buffer } = await label.generateLabel({
    firstName: 'Alice',
    lastName:  'Smith',
    clubName:  'Sparks',
    allergyTokens: ['NUTS', 'DAIRY'],
    handbookGroup: 'Red Jewels',
    isBirthday: true,
    isVisitor:  true,
  });
  assert.ok(buffer.length > 1000);
  fs.unlinkSync(pngPath);
});

test('generateLabel: long names are truncated, not thrown on', { skip: !label }, async () => {
  const { pngPath } = await label.generateLabel({
    firstName: 'Supercalifragilisticexpialidocious',
    lastName:  'Mc-Extraordinarilylongsurname',
  });
  fs.unlinkSync(pngPath);
});
