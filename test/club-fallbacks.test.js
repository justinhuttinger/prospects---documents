// test/club-fallbacks.test.js
//
// Admin -> Club Info supplies the values that keep a prospect alive when their
// own answer is one ABC would refuse. These tests pin the rule that matters:
// a fallback NEVER overwrites a real answer, it only fills a gap.
const { test } = require('node:test');
const assert = require('node:assert');

const { buildProspectPersonal } = require('../services/waiver/flow');

// Salem's real row, as entered in Admin -> Club Info on 2026-09-02.
const SALEM = {
  address1: '290 Moyer Lane NW',
  city: 'Salem',
  state: 'OR',
  postalCode: '97304',
  phone: '9715995704',
};

const club = { clubNumber: '30935', clubName: 'Salem', state: 'OR' };

const member = {
  first_name: 'Dana',
  last_name: 'Reyes',
  email: 'dana@example.com',
};

test('a member who answered everything keeps every one of their answers', () => {
  const p = buildProspectPersonal({
    ...member,
    phone: '5035551234',
    address1: '99 Elm St',
    city: 'Keizer',
    state: 'WA',
    postal_code: '97303',
  }, club, SALEM);

  assert.equal(p.addressLine1, '99 Elm St');
  assert.equal(p.city, 'Keizer');
  assert.equal(p.state, 'WA', 'a real out-of-state answer must survive');
  assert.equal(p.postalCode, '97303');
  assert.equal(p.primaryPhone, '5035551234');
});

test('the club fills only the fields the member left blank', () => {
  const p = buildProspectPersonal({ ...member, city: 'Keizer' }, club, SALEM);

  assert.equal(p.city, 'Keizer', 'the answer they gave is kept');
  assert.equal(p.addressLine1, '290 Moyer Lane NW');
  assert.equal(p.state, 'OR');
  assert.equal(p.postalCode, '97304');
  assert.equal(p.primaryPhone, '9715995704');
});

test('an unusable state falls back to the club, which is the outage that started this', () => {
  for (const junk of ['Not Sure', 'United States', 'N/A', '98765']) {
    const p = buildProspectPersonal({ ...member, state: junk }, club, SALEM);
    assert.equal(p.state, 'OR', `"${junk}" should fall back, not be sent`);
  }
});

test('a phone ABC would refuse is replaced by the club number, not sent malformed', () => {
  // Seven digits: previously became '' and the prospect had no phone at all.
  const p = buildProspectPersonal({ ...member, phone: '5551234' }, club, SALEM);
  assert.equal(p.primaryPhone, '9715995704');
  assert.equal(p.mobilePhone, '9715995704');
});

test('with no club row at all, behaviour is exactly what it was before', () => {
  const p = buildProspectPersonal({ ...member, state: 'Not Sure' }, club, {});
  assert.equal(p.addressLine1, 'N/A');
  assert.equal(p.city, 'Unknown');
  assert.equal(p.state, 'OR', 'clubs-config.json still carries the state');
  assert.equal(p.primaryPhone, '');
});

test('every value Salem entered survives ABC sanitizing unchanged', () => {
  const p = buildProspectPersonal(member, club, SALEM);
  assert.equal(p.addressLine1, '290 Moyer Lane NW');
  assert.equal(p.city, 'Salem');
  assert.equal(p.state, 'OR');
  assert.equal(p.postalCode, '97304');
  assert.equal(p.primaryPhone, '9715995704');
  // ABC's own limits, so a future edit that breaks them fails here first.
  assert.ok(p.addressLine1.length <= 44);
  assert.ok(/^[A-Z]{2}$/.test(p.state));
  assert.ok(/^\d{10}$/.test(p.primaryPhone));
});
