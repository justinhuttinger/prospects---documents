const test = require('node:test');
const assert = require('node:assert');
const { retryWithBackoff, defaultIsRetryable } = require('../lib/retry');

test('retryWithBackoff returns first-attempt result without retrying', async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    return 'ok';
  }, { attempts: 3, baseMs: 1 });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 1);
});

test('retryWithBackoff retries retryable errors and eventually succeeds', async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    if (calls < 3) {
      const err = new Error('boom');
      err.response = { status: 503 };
      throw err;
    }
    return 'ok';
  }, { attempts: 3, baseMs: 1 });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 3);
});

test('retryWithBackoff stops after attempts exhausted and rethrows last error', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(async () => {
      calls++;
      const err = new Error('boom');
      err.response = { status: 502 };
      throw err;
    }, { attempts: 3, baseMs: 1 }),
    /boom/
  );
  assert.strictEqual(calls, 3);
});

test('retryWithBackoff does not retry non-retryable errors', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(async () => {
      calls++;
      const err = new Error('bad request');
      err.response = { status: 400 };
      throw err;
    }, { attempts: 3, baseMs: 1 }),
    /bad request/
  );
  assert.strictEqual(calls, 1);
});

test('defaultIsRetryable: 5xx, 429, network codes are retryable; 4xx is not', () => {
  assert.strictEqual(defaultIsRetryable({ response: { status: 500 } }), true);
  assert.strictEqual(defaultIsRetryable({ response: { status: 502 } }), true);
  assert.strictEqual(defaultIsRetryable({ response: { status: 429 } }), true);
  assert.strictEqual(defaultIsRetryable({ code: 'ECONNRESET' }), true);
  assert.strictEqual(defaultIsRetryable({ code: 'ETIMEDOUT' }), true);
  assert.strictEqual(defaultIsRetryable({ response: { status: 400 } }), false);
  assert.strictEqual(defaultIsRetryable({ response: { status: 404 } }), false);
  assert.strictEqual(defaultIsRetryable({}), false);
});
