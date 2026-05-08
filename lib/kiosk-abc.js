// Read-only ABC Financial helpers used by the iPad tour kiosk lookup.
// Kept in a dedicated file so existing imports of `lib/abc.js` are
// unaffected.

const axios = require('axios');

const BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

function headers() {
  return {
    app_id:  process.env.ABC_APP_ID,
    app_key: process.env.ABC_APP_KEY,
    Accept:  'application/json'
  };
}

function digits(s) { return String(s || '').replace(/\D+/g, ''); }

/**
 * Find a member by phone or email. Returns the first match, or null.
 * ABC's GET /{clubNumber}/members supports primaryPhone and email query
 * params and returns `{ members: [...] }`.
 */
async function searchMember(clubNumber, { phone, email }) {
  const params = {};
  const phoneDigits = digits(phone);
  if (phoneDigits) params.primaryPhone = phoneDigits;
  if (email) params.email = String(email).trim();
  if (!Object.keys(params).length) return null;

  try {
    const r = await axios.get(`${BASE_URL}/${clubNumber}/members`, {
      headers: headers(),
      params,
      timeout: 15000
    });
    const members = (r.data && r.data.members) || [];
    return members[0] || null;
  } catch (e) {
    if (e.response && e.response.status === 404) return null;
    throw e;
  }
}

/**
 * Most recent check-in timestamp for a member, or null if none.
 * Best-effort: returns null on any 404 or unexpected response shape.
 */
async function getLastCheckin(clubNumber, memberId) {
  try {
    const r = await axios.get(
      `${BASE_URL}/${clubNumber}/members/checkins/${memberId}`,
      { headers: headers(), timeout: 15000 }
    );
    const checkins = (r.data && r.data.checkins) || [];
    if (!checkins.length) return null;
    const stamps = checkins
      .map(c => (c && c.access && c.access.locationTimestamp) || c.locationTimestamp || c.timestamp || null)
      .filter(Boolean)
      .sort();
    return stamps[stamps.length - 1] || null;
  } catch (e) {
    return null;
  }
}

/**
 * Whether ABC has a profile picture on file. Returns true/false; never
 * throws. We don't return the actual picture data — too big to ship
 * back through the lookup endpoint.
 */
async function hasPhoto(clubNumber, memberId) {
  try {
    const r = await axios.get(
      `${BASE_URL}/${clubNumber}/members/pictures/${memberId}`,
      { headers: headers(), timeout: 10000 }
    );
    if (!r.data) return false;
    if (typeof r.data === 'string' && r.data.length > 0) return true;
    if (r.data.image || r.data.picture || r.data.imageBase64) return true;
    return false;
  } catch (e) {
    return false;
  }
}

module.exports = { searchMember, getLastCheckin, hasPhoto, BASE_URL };
