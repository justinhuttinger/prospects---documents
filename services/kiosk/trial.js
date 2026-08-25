/**
 * Granting trial days from the tour kiosk.
 *
 * A lapsed trial walks in, staff enters a number of days, and the prospect's
 * window re-opens with a matching visit allowance. One PUT does it, and
 * extending expirationDate is what flips ABC's `isActive` back to true.
 *
 * Two ABC behaviours this has to respect, both established by probing (see
 * reference_abc_prospects_write_api):
 *
 *   1. `personal` MUST be present in the body or ABC returns a bare 500 that
 *      reads exactly like a broken endpoint. So we read the prospect first,
 *      purely to carry its name back in.
 *   2. The PUT MERGES, so sending only the two agreement fields leaves the rest
 *      of the record untouched. No read-modify-write of the whole prospect.
 *
 * This works for PROSPECTS ONLY. Members live in a separate id space and their
 * agreement routes are 401/405 for us, so a cancelled member cannot be extended
 * here; the caller gets `not_a_prospect` and should send them to the desk.
 */

const axios = require('axios');

const BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

// A trial is a short-term courtesy. Anything past this is someone fat-fingering
// a number, and ABC would happily store 999999 visits.
const MAX_DAYS = 90;

function headers() {
  return {
    app_id: process.env.ABC_APP_ID,
    app_key: process.env.ABC_APP_KEY,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Today plus N days, in the club's timezone.
 *
 * Computing this in UTC would roll the date forward for anyone checking in
 * after 5pm Pacific, quietly handing out an extra day.
 */
function expirationDateFrom(days, now = new Date()) {
  const pacificNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  pacificNow.setDate(pacificNow.getDate() + Number(days));
  const p = n => String(n).padStart(2, '0');
  return `${pacificNow.getFullYear()}-${p(pacificNow.getMonth() + 1)}-${p(pacificNow.getDate())}`;
}

/** Returns the prospect record, or null when the id is not a prospect. */
async function getProspect(clubNumber, prospectId) {
  const r = await axios.get(`${BASE_URL}/${clubNumber}/prospects/${prospectId}`, {
    headers: headers(),
    timeout: 20000,
    validateStatus: () => true,
  });
  // ABC answers 200 with "No records found." for an id that exists as a member
  // but not as a prospect, so an empty list is the real not-found signal.
  const list = (r.data && r.data.prospects) || [];
  return list[0] || null;
}

function summarize(prospect) {
  const personal = (prospect && prospect.personal) || {};
  const agreement = (prospect && prospect.agreement) || {};
  return {
    firstName: personal.firstName || '',
    lastName: personal.lastName || '',
    isActive: personal.isActive === 'true' || personal.isActive === true,
    expirationDate: agreement.expirationDate || '',
    visitsAllowed: agreement.visitsAllowed || '',
    visitsUsed: agreement.visitsUsed || '',
  };
}

/**
 * Give a prospect `days` more days and the same number of visits.
 *
 * @returns {Promise<{ok, before, after, expirationDate}>}
 *          or {ok:false, error:'not_a_prospect'|'abc_error', ...}
 */
async function grantTrialDays(clubNumber, prospectId, days) {
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    return { ok: false, error: 'invalid_days', maxDays: MAX_DAYS };
  }

  const existing = await getProspect(clubNumber, prospectId);
  if (!existing) return { ok: false, error: 'not_a_prospect' };

  const before = summarize(existing);
  const expirationDate = expirationDateFrom(n);

  const body = {
    prospect: {
      // Required by ABC even though we are not changing it.
      personal: { firstName: before.firstName, lastName: before.lastName },
      agreement: { expirationDate, visitsAllowed: String(n) },
    },
  };

  const r = await axios.put(`${BASE_URL}/${clubNumber}/prospects/${prospectId}`, body, {
    headers: headers(),
    timeout: 20000,
    validateStatus: () => true,
  });

  if (r.status < 200 || r.status >= 300) {
    return {
      ok: false,
      error: 'abc_error',
      status: r.status,
      detail: (r.data && r.data.status && r.data.status.message) || null,
      before,
    };
  }

  // Read back rather than trusting the write: staff are about to tell a member
  // they have access, and ABC's own record is the thing the door will check.
  const after = summarize(await getProspect(clubNumber, prospectId));

  return { ok: true, days: n, expirationDate, before, after };
}

module.exports = { grantTrialDays, getProspect, expirationDateFrom, summarize, MAX_DAYS };
