// The timestamps in a kiosk webhook are read by a person in GHL, so they go out
// on the club's clock in the shape a person writes a time. The cases that
// matter are the ones where a naive UTC render would be wrong: an evening tour
// that UTC has already rolled into tomorrow, and the two halves of the year
// that sit on different offsets.

const test = require('node:test');
const assert = require('node:assert');

const { formatPacific } = require('../lib/human-time');

test('renders a UTC instant on the club clock', () => {
  // 23:05 UTC on 9 Sep is 4:05pm Pacific the same day.
  assert.strictEqual(formatPacific('2026-09-09T23:05:51.004Z'), '09/09/2026 | 4:05 PM');
});

test('rolls back to the previous day when UTC has already ticked over', () => {
  // An evening tour: 00:30 UTC on the 10th is still 5:30pm on the 9th at the
  // front desk. Sending the UTC date would report it on the wrong day.
  assert.strictEqual(formatPacific('2026-09-10T00:30:00Z'), '09/09/2026 | 5:30 PM');
});

test('follows Pacific daylight saving rather than a fixed offset', () => {
  assert.strictEqual(formatPacific('2026-01-15T20:00:00Z'), '01/15/2026 | 12:00 PM');
  assert.strictEqual(formatPacific('2026-07-15T20:00:00Z'), '07/15/2026 | 1:00 PM');
});

test('pads the date but not the hour', () => {
  assert.strictEqual(formatPacific('2026-03-04T17:07:00Z'), '03/04/2026 | 9:07 AM');
});

test('renders midnight and noon the way a person says them', () => {
  assert.strictEqual(formatPacific('2026-09-09T07:00:00Z'), '09/09/2026 | 12:00 AM');
  assert.strictEqual(formatPacific('2026-09-09T19:00:00Z'), '09/09/2026 | 12:00 PM');
});

test('accepts a Date as well as a string', () => {
  assert.strictEqual(formatPacific(new Date('2026-09-09T23:05:00Z')), '09/09/2026 | 4:05 PM');
});

test('yields an empty string for anything that is not an instant', () => {
  for (const bad of [null, undefined, '', 'not a date', NaN]) {
    assert.strictEqual(formatPacific(bad), '', `expected '' for ${String(bad)}`);
  }
});
