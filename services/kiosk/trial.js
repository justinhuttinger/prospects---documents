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

const { addMemberAlert } = require('../waiver/abc');

const BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

// A trial is a short-term courtesy. Anything past this is someone fat-fingering
// a number, and ABC would happily store 999999 visits.
const MAX_DAYS = 90;

// How long the "pass active until" alert outlives the pass itself. Someone who
// turns up on their last day, or a couple of days late, should still have the
// desk see what they were given.
const ALERT_GRACE_DAYS = 3;

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

/** YYYY-MM-DD plus n days, calendar-safe across month and year boundaries. */
function addDays(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(n));
  const p = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * MM-DD for the alert.
 *
 * A hyphen, not a slash: ABC rejects alert text containing "/" outright, and
 * caps the whole string at 22 characters (alpha, numeric, spaces and ,_!%+-@^).
 * "PASS ACTIVE TO 09-04" is 20, which leaves room and still reads at a glance.
 */
function formatAlertDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[2]}-${m[3]}` : String(iso || '');
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

/**
 * Put the pass window in front of whoever scans them in, on every visit for as
 * long as it is valid.
 *
 * showOneTime is false because the desk needs this on each check-in, not just
 * the next one. That is only safe because the alert carries its own
 * expirationDate: alerts cannot be listed, edited or deleted through the API,
 * so without an expiry a persistent alert would be permanent clutter nobody
 * could clear outside DataTrak.
 *
 * The expiry runs ALERT_GRACE_DAYS past the pass end, so somebody arriving on
 * their last day, or a day or two late, still shows the desk what they had.
 */
function postPassAlert(clubNumber, memberId, expirationDate) {
  return addMemberAlert(clubNumber, memberId, {
    text: `PASS ACTIVE TO ${formatAlertDate(expirationDate)}`,
    color: 'Blue',
    showOneTime: 'false',
    expirationDate: addDays(expirationDate, ALERT_GRACE_DAYS),
  });
}

/** The member record, or null. Members and prospects are separate id spaces. */
async function getMember(clubNumber, memberId) {
  const r = await axios.get(`${BASE_URL}/${clubNumber}/members/${memberId}`, {
    headers: headers(),
    timeout: 20000,
    validateStatus: () => true,
  });
  const list = (r.data && r.data.members) || [];
  return list[0] || null;
}

function summarizeMember(member) {
  const personal = (member && member.personal) || {};
  const agreement = (member && member.agreement) || {};
  return {
    firstName: personal.firstName || '',
    lastName: personal.lastName || '',
    isActive: String(personal.memberStatus || '').toLowerCase() === 'active',
    expirationDate: agreement.expirationDate || '',
    visitsAllowed: '',
    visitsUsed: '',
  };
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

  const expirationDate = expirationDateFrom(n);

  const existing = await getProspect(clubNumber, prospectId);

  if (!existing) {
    // A real member, not a prospect. ABC gives us no writable agreement route
    // for members, so their expiration and visit allowance cannot be changed --
    // but the ALERT endpoint works on any member id, and telling the front desk
    // "PASS ACTIVE TO 09-04" is most of the value. Do that rather than refuse.
    const member = await getMember(clubNumber, prospectId);
    if (!member) return { ok: false, error: 'not_found' };

    const alert = await postPassAlert(clubNumber, prospectId, expirationDate);
    return {
      ok: true,
      // The caller shows this differently: the desk is flagged, but ABC's own
      // expiration is untouched and the door will not know about it.
      mode: 'alert_only',
      days: n,
      expirationDate,
      before: summarizeMember(member),
      after: summarizeMember(member),
      alert,
    };
  }

  const before = summarize(existing);

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

  const alert = await postPassAlert(clubNumber, prospectId, expirationDate);

  return { ok: true, mode: 'full', days: n, expirationDate, before, after, alert };
}

module.exports = {
  grantTrialDays, getProspect, getMember, expirationDateFrom, summarize, formatAlertDate, addDays,
  MAX_DAYS, ALERT_GRACE_DAYS,
};
