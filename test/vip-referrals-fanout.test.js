// test/vip-referrals-fanout.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { fireRecipient } = require('../services/vip-referrals/fanout');

test('succeeds on first try -> attempt_count 1', async () => {
  let calls = 0;
  const r = await fireRecipient('https://x', { a: 1 }, {
    post: async () => { calls++; return { status: 200 }; },
    sleep: async () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempt_count, 1);
  assert.equal(calls, 1);
});

test('retries then succeeds -> attempt_count reflects retries', async () => {
  let calls = 0;
  const r = await fireRecipient('https://x', {}, {
    maxAttempts: 3,
    post: async () => { calls++; if (calls < 3) throw Object.assign(new Error('boom'), { response: { status: 502, data: 'bad' } }); return { status: 200 }; },
    sleep: async () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempt_count, 3);
});

test('all attempts fail -> ok false, error captured', async () => {
  const r = await fireRecipient('https://x', {}, {
    maxAttempts: 2,
    post: async () => { throw Object.assign(new Error('nope'), { response: { status: 500, data: { e: 1 } } }); },
    sleep: async () => {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.http_status, 500);
  assert.deepEqual(r.error_detail, { e: 1 });
  assert.equal(r.attempt_count, 2);
});
