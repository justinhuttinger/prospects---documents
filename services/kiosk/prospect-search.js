/**
 * Finding somebody in ABC's PROSPECTS from what they just typed.
 *
 * The member lookup cannot answer this. It reads our synced `abc_members`,
 * which holds join_status = 'Member' and nothing else -- 101,091 rows, zero
 * prospects -- so anybody whose only ABC record is a past trial is invisible to
 * it, and the kiosk creates them a fresh prospect every single visit. Somebody
 * who tries the gym three times over a year ends up as three profiles.
 *
 * This goes to ABC live rather than to a table, because there is no prospects
 * table to go to yet. That brings two limits worth knowing:
 *
 *   - ABC caps a prospect date range at 31 days, so this looks back 30. A
 *     prospect from last spring is still missed. The proper fix is to sync
 *     prospects the way members are synced; this catches the common case, which
 *     is somebody coming back within a few weeks.
 *   - ABC ignores every filter parameter on the resource, so the range is the
 *     only narrowing available and the matching happens here.
 *
 * A single-day range returns NOTHING from ABC, which is why the window is a
 * span rather than today.
 */

const axios = require('axios');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const WINDOW_DAYS = 30;
const TIMEOUT_MS = 8000;

/** Last 10 digits, which is how the same number survives +1 and formatting. */
function phone10(value) {
  const d = String(value || '').replace(/\D+/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/**
 * Recent prospects at one club, matched on phone and on email separately so the
 * caller can tell agreement-on-both from a single weak signal -- the same shape
 * searchMembers returns, so both feed one scorer.
 *
 * Never throws: a member standing at the kiosk must be able to finish a waiver
 * when ABC is slow. The worst case is the behaviour we already had.
 *
 * @returns {Promise<{byPhone: Array, byEmail: Array}>} ABC-shaped records.
 */
async function searchProspects(clubNumber, { phone, email }) {
  const empty = { byPhone: [], byEmail: [] };
  const wantPhone = phone10(phone);
  const wantEmail = String(email || '').trim().toLowerCase();
  if (!clubNumber || (!wantPhone && !wantEmail)) return empty;

  let list = [];
  try {
    const res = await axios.get(`${ABC_BASE_URL}/${clubNumber}/prospects`, {
      headers: {
        app_id: process.env.ABC_APP_ID,
        app_key: process.env.ABC_APP_KEY,
        Accept: 'application/json',
      },
      // End tomorrow: a prospect created minutes ago at a club an hour behind us
      // can otherwise sit outside a range that ends today.
      params: { beginDateRange: `${isoDaysAgo(WINDOW_DAYS)},${isoDaysAgo(-1)}` },
      timeout: TIMEOUT_MS,
    });
    list = (res.data && res.data.prospects) || [];
  } catch (err) {
    console.error('[kiosk/prospect-search] ABC lookup failed:', err.message);
    return empty;
  }

  const byPhone = [];
  const byEmail = [];

  for (const p of list) {
    const per = p.personal || {};
    const id = p.prospectId || p.memberId || p.id;
    if (!id) continue;

    // ABC calls a prospect a member the moment one is created, so the shape
    // downstream is identical apart from where the id lives.
    const candidate = {
      memberId: id,
      isProspect: true,
      personal: {
        firstName: per.firstName || '',
        lastName: per.lastName || '',
        email: per.email || '',
        primaryPhone: per.primaryPhone || per.mobilePhone || '',
        memberStatus: 'prospect',
      },
    };

    const theirPhone = phone10(per.primaryPhone) || phone10(per.mobilePhone);
    const theirEmail = String(per.email || '').trim().toLowerCase();

    if (wantPhone && theirPhone && theirPhone === wantPhone) byPhone.push(candidate);
    if (wantEmail && theirEmail && theirEmail === wantEmail) byEmail.push(candidate);
  }

  return { byPhone, byEmail };
}

module.exports = { searchProspects, phone10, WINDOW_DAYS };
