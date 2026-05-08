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

function memberPhoneDigits(member) {
  const personal = (member && member.personal) || {};
  const candidates = [
    personal.primaryPhone, personal.phone, personal.mobilePhone,
    personal.workPhone, personal.homePhone,
  ];
  for (const c of candidates) {
    const d = digits(c);
    if (d) return d;
  }
  return '';
}

function memberEmail(member) {
  const personal = (member && member.personal) || {};
  return String(personal.email || '').trim().toLowerCase();
}

/**
 * Search ABC members by phone. Defensively filters the response to
 * members whose stored phone actually matches the last 10 digits of
 * the input — protects against ABC's filter being looser than expected.
 */
async function searchByPhone(clubNumber, phone) {
  const phoneDigits = digits(phone);
  if (phoneDigits.length < 10) return [];
  try {
    const r = await axios.get(`${BASE_URL}/${clubNumber}/members`, {
      headers: headers(),
      params:  { primaryPhone: phoneDigits },
      timeout: 15000
    });
    const members = (r.data && r.data.members) || [];
    const want = phoneDigits.slice(-10);
    return members.filter(m => memberPhoneDigits(m).slice(-10) === want);
  } catch (e) {
    if (e.response && e.response.status === 404) return [];
    throw e;
  }
}

/**
 * Search ABC members by email (case-insensitive exact match,
 * defensively re-filtered).
 */
async function searchByEmail(clubNumber, email) {
  const want = String(email || '').trim().toLowerCase();
  if (!want || !want.includes('@')) return [];
  try {
    const r = await axios.get(`${BASE_URL}/${clubNumber}/members`, {
      headers: headers(),
      params:  { email: want },
      timeout: 15000
    });
    const members = (r.data && r.data.members) || [];
    return members.filter(m => memberEmail(m) === want);
  } catch (e) {
    if (e.response && e.response.status === 404) return [];
    throw e;
  }
}

/**
 * @deprecated kept for callers that haven't migrated to searchByPhone /
 * searchByEmail. Returns the first member matching either phone or
 * email, defensively filtered.
 */
async function searchMember(clubNumber, { phone, email }) {
  const byPhone = await searchByPhone(clubNumber, phone || '');
  if (byPhone.length) return byPhone[0];
  const byEmail = await searchByEmail(clubNumber, email || '');
  return byEmail[0] || null;
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

module.exports = {
  searchByPhone, searchByEmail, searchMember,
  getLastCheckin, hasPhoto,
  memberPhoneDigits, memberEmail,
  BASE_URL
};
