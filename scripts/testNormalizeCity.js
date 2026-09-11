'use strict';

const { normalizeCity } = require('../lib/normalizeCity');

const cases = [
  ['Karachi',        'karachi'],
  ['KARACHI',        'karachi'],
  ['  karachi  ',    'karachi'],
  ['KHI',            'karachi'],
  ['khi',            'karachi'],
  ['KaRachi',        'karachi'],
  ['karchi',         'karachi'],
  ['Pindi',          'rawalpindi'],
  ['islmabad',       'islamabad'],
  ['',               'unknown'],
  [null,             'unknown'],
  ['Multan',         'multan'],
  ['SomeRandomTown', 'somerandomtown'],
  ['karachi',        'karachi'],
  ['unknown',        'unknown'],
  ['somerandomtown', 'somerandomtown'],
];

let passed = 0;
let failed = 0;

for (const [input, expected] of cases) {
  const result = normalizeCity(input);
  const ok = result === expected;
  const status = ok ? 'PASS' : 'FAIL';
  const inputDisplay = input === null ? 'null' : `"${input}"`;
  console.log(`[${status}] normalizeCity(${inputDisplay.padEnd(18)}) → "${result}"${ok ? '' : `  (expected "${expected}")`}`);
  if (ok) passed++; else failed++;
}

const idempotentInputs = ['KARACHI', 'KHI', '  Lahore  ', null, '', 'SomeRandomTown'];
for (const input of idempotentInputs) {
  const once  = normalizeCity(input);
  const twice = normalizeCity(once);
  const ok    = once === twice;
  const status = ok ? 'PASS' : 'FAIL';
  console.log(`[${status}] idempotent: normalizeCity("${once}") → "${twice}"${ok ? '' : '  IDEMPOTENCY BROKEN'}`);
  if (ok) passed++; else failed++;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
