const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifySignature, isFresh } = require('../lib/c2s-signature');

const SECRET = 'test-secret';
const BODY = '{"hello":"world"}';
const VALID_SIG = 'sha256=' + crypto.createHmac('sha256', SECRET).update(BODY).digest('hex');

test('verifySignature returns true for a valid signature', () => {
  assert.strictEqual(verifySignature(BODY, VALID_SIG, SECRET), true);
});

test('verifySignature returns false when the prefix is missing', () => {
  const noPrefix = VALID_SIG.slice(7);
  assert.strictEqual(verifySignature(BODY, noPrefix, SECRET), false);
});

test('verifySignature returns false when the body has been tampered', () => {
  assert.strictEqual(verifySignature(BODY + 'x', VALID_SIG, SECRET), false);
});

test('verifySignature returns false when the secret is wrong', () => {
  assert.strictEqual(verifySignature(BODY, VALID_SIG, 'other-secret'), false);
});

test('verifySignature returns false when the header is empty/missing', () => {
  assert.strictEqual(verifySignature(BODY, '', SECRET), false);
  assert.strictEqual(verifySignature(BODY, undefined, SECRET), false);
});

test('verifySignature returns false when received hex length differs', () => {
  assert.strictEqual(verifySignature(BODY, 'sha256=abcd', SECRET), false);
});

test('isFresh returns true within the window', () => {
  const now = 1_700_000_000;
  assert.strictEqual(isFresh(String(now - 100), 300, now), true);
  assert.strictEqual(isFresh(String(now + 100), 300, now), true);
});

test('isFresh returns false outside the window', () => {
  const now = 1_700_000_000;
  assert.strictEqual(isFresh(String(now - 400), 300, now), false);
  assert.strictEqual(isFresh(String(now + 400), 300, now), false);
});

test('isFresh returns false for non-numeric input', () => {
  const now = 1_700_000_000;
  assert.strictEqual(isFresh('not-a-number', 300, now), false);
  assert.strictEqual(isFresh('', 300, now), false);
  assert.strictEqual(isFresh(undefined, 300, now), false);
});
