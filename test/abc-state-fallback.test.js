// test/abc-state-fallback.test.js
//
// On 2026-09-01 three prospects were refused by ABC with "State or province
// code provided is not valid" and never reached the club. The cause was
// getStateCode ending in `substring(0, 2).toUpperCase()`, which turned any
// unrecognised answer into a plausible-looking code that ABC then rejected --
// and ABC rejects the WHOLE prospect, not just the field.
const { test } = require('node:test');
const assert = require('node:assert');

const { getStateCode } = require('../services/waiver/sanitize');
const { isAbcValidationFailure } = require('../services/waiver/flow');

test('real state names and codes still resolve', () => {
  assert.equal(getStateCode('Oregon'), 'OR');
  assert.equal(getStateCode('oregon'), 'OR');
  assert.equal(getStateCode('OR'), 'OR');
  assert.equal(getStateCode('or'), 'OR');
  assert.equal(getStateCode('California'), 'CA');
  assert.equal(getStateCode('WA'), 'WA');
});

test('the exact answers that killed a prospect no longer invent a code', () => {
  // Each of these previously produced NO / UN / N/ / 98 and failed the whole
  // submission. They must now be treated as "not a state".
  for (const junk of ['Not Sure', 'United States', 'N/A', '98765', 'none', 'XX', 'ZZ']) {
    assert.equal(getStateCode(junk), '', `"${junk}" should not resolve to a code`);
  }
});

test('an unrecognised answer falls back to the club state', () => {
  assert.equal(getStateCode('Not Sure', 'OR'), 'OR');
  assert.equal(getStateCode('', 'OR'), 'OR');
  assert.equal(getStateCode(null, 'OR'), 'OR');
  assert.equal(getStateCode(undefined, 'OR'), 'OR');
  assert.equal(getStateCode('   ', 'OR'), 'OR');
});

test('a real answer is never overridden by the club fallback', () => {
  // Somebody who genuinely lives in Washington must not be filed as Oregon.
  assert.equal(getStateCode('Washington', 'OR'), 'WA');
  assert.equal(getStateCode('WA', 'OR'), 'WA');
});

test('DC and territories are valid, and DC is not read as Washington', () => {
  assert.equal(getStateCode('DC'), 'DC');
  assert.equal(getStateCode('Washington DC'), 'DC');
  assert.equal(getStateCode('district of columbia'), 'DC');
  assert.equal(getStateCode('PR'), 'PR');
});

test('trailing punctuation does not break a two-letter code', () => {
  assert.equal(getStateCode('OR.'), 'OR');
});

test('a field refusal is retryable; an auth or network failure is not', () => {
  const refusal = new Error('ABC refused the prospect: State or province code provided is not valid.');
  refusal.abcResponse = { status: 'fail' };
  assert.equal(isAbcValidationFailure(refusal), true);

  // No abcResponse means ABC never answered - retrying with different values
  // would just call a broken endpoint twice.
  assert.equal(isAbcValidationFailure(new Error('connect ETIMEDOUT')), false);
  assert.equal(isAbcValidationFailure(new Error('Request failed with status code 401')), false);
  assert.equal(isAbcValidationFailure(null), false);

  const authWithBody = new Error('Unauthorized');
  authWithBody.abcResponse = { status: 'fail' };
  assert.equal(isAbcValidationFailure(authWithBody), false);
});
