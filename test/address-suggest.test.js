// Address type-ahead: normalization for both providers, and the guarantee that
// every failure path yields an empty list rather than an exception. The kiosk
// field degrades to a plain text input, so "no suggestions" is always a valid
// answer and a thrown error never is.

const test = require('node:test');
const assert = require('node:assert');

const axios = require('axios');

const {
  suggestAddresses,
  stateToCode,
  fromPhoton,
  fromGoogle,
  dedupe,
  activeProvider,
} = require('../services/waiver/address');

const realGet = axios.get;

function stubGet(handler) {
  axios.get = handler;
}

test.beforeEach(() => {
  delete process.env.GOOGLE_PLACES_API_KEY;
});

test.afterEach(() => {
  axios.get = realGet;
  delete process.env.GOOGLE_PLACES_API_KEY;
});

// --- normalization ----------------------------------------------------------

test('stateToCode maps names and passes codes through', () => {
  assert.strictEqual(stateToCode('Oregon'), 'OR');
  assert.strictEqual(stateToCode('washington'), 'WA');
  assert.strictEqual(stateToCode('OR'), 'OR');
  assert.strictEqual(stateToCode('or'), 'OR');
  assert.strictEqual(stateToCode('Atlantis'), '');
  assert.strictEqual(stateToCode(''), '');
});

test('fromPhoton joins the house number onto the street', () => {
  const s = fromPhoton({
    properties: {
      housenumber: '482',
      street: 'Liberty Street Northeast',
      city: 'Salem',
      state: 'Oregon',
      postcode: '97301',
      countrycode: 'US',
    },
  });

  assert.strictEqual(s.line1, '482 Liberty Street Northeast');
  assert.strictEqual(s.city, 'Salem');
  assert.strictEqual(s.state, 'OR', 'the state name is reduced to a code for ABC');
  assert.strictEqual(s.postalCode, '97301');
});

test('fromPhoton drops a hit with no street at all', () => {
  assert.strictEqual(fromPhoton({ properties: { city: 'Salem', state: 'Oregon' } }), null);
});

test('fromGoogle parses the prediction description', () => {
  const s = fromGoogle({ description: '482 Liberty St NE, Salem, OR, USA' });

  assert.strictEqual(s.line1, '482 Liberty St NE');
  assert.strictEqual(s.city, 'Salem');
  assert.strictEqual(s.state, 'OR');
});

test('fromGoogle picks up a ZIP when the prediction carries one', () => {
  const s = fromGoogle({ description: '482 Liberty St NE, Salem, OR 97301, USA' });

  assert.strictEqual(s.state, 'OR');
  assert.strictEqual(s.postalCode, '97301');
});

test('dedupe collapses the same address and caps the list', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    line1: `${i} Main St`, city: 'Salem', state: 'OR', postalCode: '97301',
  }));
  many.push({ line1: '0 Main St', city: 'salem', state: 'or', postalCode: '97301' });

  const out = dedupe(many);
  assert.strictEqual(out.length, 5, 'five is all a thumb wants to read');
  assert.strictEqual(new Set(out.map(s => s.line1)).size, 5);
});

// --- provider selection -----------------------------------------------------

test('provider is keyless Photon until a Google key is configured', () => {
  assert.strictEqual(activeProvider(), 'photon');
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  assert.strictEqual(activeProvider(), 'google');
});

test('a short query never reaches a provider', async () => {
  let called = false;
  stubGet(async () => { called = true; return { data: {} }; });

  const r = await suggestAddresses('482');

  assert.deepStrictEqual(r.suggestions, []);
  assert.strictEqual(called, false, 'three characters matches half the state');
});

test('Photon results are filtered to the US and normalized', async () => {
  stubGet(async () => ({
    data: {
      features: [
        { properties: { housenumber: '482', street: 'Liberty St NE', city: 'Salem', state: 'Oregon', postcode: '97301', countrycode: 'US' } },
        { properties: { housenumber: '1', street: 'Liberty Ln', city: 'Toronto', state: 'Ontario', countrycode: 'CA' } },
        { properties: { city: 'Salem', state: 'Oregon', countrycode: 'US' } },
      ],
    },
  }));

  const r = await suggestAddresses('482 Liberty');

  assert.strictEqual(r.provider, 'photon');
  assert.strictEqual(r.suggestions.length, 1, 'non-US and street-less hits are dropped');
  assert.strictEqual(r.suggestions[0].city, 'Salem');
});

test('Google is used when a key is set, and the key is sent server-side', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  let seen = null;
  stubGet(async (url, opts) => {
    seen = { url, params: opts.params };
    return { data: { status: 'OK', predictions: [{ description: '482 Liberty St NE, Salem, OR, USA' }] } };
  });

  const r = await suggestAddresses('482 Liberty');

  assert.strictEqual(r.provider, 'google');
  assert.match(seen.url, /maps\.googleapis\.com/);
  assert.strictEqual(seen.params.key, 'test-key');
  assert.strictEqual(seen.params.components, 'country:us');
  assert.strictEqual(r.suggestions[0].line1, '482 Liberty St NE');
});

// --- failure paths ----------------------------------------------------------

test('a provider outage yields an empty list, not an exception', async () => {
  stubGet(async () => { throw new Error('ECONNRESET'); });

  const r = await suggestAddresses('482 Liberty St');

  assert.deepStrictEqual(r.suggestions, []);
  assert.strictEqual(r.degraded, true);
});

test('a Google error status is handled rather than parsed as results', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  stubGet(async () => ({
    data: { status: 'REQUEST_DENIED', error_message: 'This API key is not authorized' },
  }));

  const r = await suggestAddresses('482 Liberty St');

  assert.deepStrictEqual(r.suggestions, []);
  assert.strictEqual(r.degraded, true, 'a bad key must not look like "no matches"');
});

test('ZERO_RESULTS is an empty list, not a failure', async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key';
  stubGet(async () => ({ data: { status: 'ZERO_RESULTS', predictions: [] } }));

  const r = await suggestAddresses('asdfghjkl qwerty');

  assert.deepStrictEqual(r.suggestions, []);
  assert.notStrictEqual(r.degraded, true);
});

test('a garbage provider payload does not throw', async () => {
  stubGet(async () => ({ data: null }));

  const r = await suggestAddresses('482 Liberty St');
  assert.deepStrictEqual(r.suggestions, []);
});
