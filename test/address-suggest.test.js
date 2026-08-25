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

// --- local-first ranking ----------------------------------------------------
//
// The rule: nearby leads, but out-of-area is never unreachable. A member who
// lives in Texas and is visiting has to be able to find their own address.

const { rankLocalFirst, NEAR_MILES, coordsForSlug, CLUB_COORDS, milesBetween } =
  require('../services/waiver/address');

const near = (miles, rank, line1) => ({ line1, city: 'Salem', state: 'OR', _miles: miles, _rank: rank });

test('every club has its own coordinates, and an unknown slug still works', () => {
  assert.deepStrictEqual(
    Object.keys(CLUB_COORDS).sort(),
    ['clackamas', 'eugene', 'keizer', 'medford', 'milwaukie', 'salem', 'springfield']
  );
  assert.deepStrictEqual(coordsForSlug('MEDFORD'), CLUB_COORDS.medford);
  assert.deepStrictEqual(coordsForSlug('nowhere'), CLUB_COORDS.salem, 'falls back, never throws');
});

test('milesBetween is roughly right', () => {
  const [sLat, sLon] = CLUB_COORDS.salem;
  const [mLat, mLon] = CLUB_COORDS.medford;
  const d = milesBetween(sLat, sLon, mLat, mLon);
  assert.ok(d > 170 && d < 230, `Salem to Medford should be ~200mi, got ${Math.round(d)}`);
  assert.strictEqual(Math.round(milesBetween(sLat, sLon, sLat, sLon)), 0);
});

test('nearby hits lead, closest first', () => {
  const out = rankLocalFirst([
    near(40, 0, 'far-ish'),
    near(2, 1, 'closest'),
    near(15, 2, 'middle'),
  ]);
  assert.deepStrictEqual(out.map(s => s.line1), ['closest', 'middle', 'far-ish']);
});

test('an out-of-state address is still reachable when locals fill the list', () => {
  const hits = [
    near(1, 0, 'local A'), near(2, 1, 'local B'), near(3, 2, 'local C'),
    near(4, 3, 'local D'), near(5, 4, 'local E'), near(6, 5, 'local F'),
    { line1: 'Austin TX', city: 'Austin', state: 'TX', _miles: 1800, _rank: 6 },
  ];

  const out = rankLocalFirst(hits);
  const austinAt = out.findIndex(s => s.line1 === 'Austin TX');

  assert.ok(austinAt >= 0, 'the far hit must survive');
  assert.ok(austinAt < 5, 'and must land inside the five results the kiosk shows');
});

test('with no far hits, locals get the whole list', () => {
  const hits = [near(1, 0, 'A'), near(2, 1, 'B'), near(3, 2, 'C')];
  const out = rankLocalFirst(hits);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(s => s.line1), ['A', 'B', 'C']);
});

test('with no nearby hits, far results keep the provider ranking', () => {
  const hits = [
    { line1: 'third', _miles: 900, _rank: 2 },
    { line1: 'first', _miles: 1800, _rank: 0 },
    { line1: 'second', _miles: 400, _rank: 1 },
  ];
  // Distance is meaningless once nothing is local; text-match quality is all
  // that is left to go on.
  assert.deepStrictEqual(rankLocalFirst(hits).map(s => s.line1), ['first', 'second', 'third']);
});

test('the near/far boundary is the configured radius', () => {
  const out = rankLocalFirst([
    { line1: 'just outside', _miles: NEAR_MILES + 1, _rank: 0 },
    { line1: 'just inside', _miles: NEAR_MILES - 1, _rank: 1 },
  ]);
  assert.strictEqual(out[0].line1, 'just inside');
});

test('a hit with no coordinates sorts last rather than faking a distance of zero', () => {
  const out = rankLocalFirst([
    { line1: 'no coords', _miles: Number.POSITIVE_INFINITY, _rank: 0 },
    near(5, 1, 'real local'),
  ]);
  assert.strictEqual(out[0].line1, 'real local');
});

test('the sort-only internals never reach the kiosk', () => {
  const cleaned = dedupe([
    { line1: '1 A St', city: 'Salem', state: 'OR', _lat: 44.9, _lon: -123.0, _miles: 3, _rank: 0 },
  ]);
  assert.deepStrictEqual(Object.keys(cleaned[0]).sort(), ['city', 'line1', 'state']);
});
