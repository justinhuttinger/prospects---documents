/**
 * Finding an existing ABC member by phone or email.
 *
 * This goes to our own `abc_members` table rather than ABC, because ABC cannot
 * do it. `GET /{club}/members` accepts no working filter — primaryPhone, phone,
 * mobilePhone, email, firstName, lastName and memberId were all probed live and
 * every one is ignored — and the response is hard-capped at 5000 rows per page
 * with no search endpoint anywhere on the resource.
 *
 * So the old approach (fetch a page, filter it client-side) only ever found
 * people who happened to land in the first 5000 records:
 *
 *     Salem       8,439 members  -> ~41% invisible
 *     Eugene     53,783 members  -> ~91% invisible
 *
 * which is exactly why entering a current member's details found nothing.
 *
 * `abc_members` is the nightly/hourly ABC sync, is complete, and is indexed by
 * club. It holds `join_status = 'Member'` only — prospects are not in it, so a
 * past trial is not matched here. That is a known gap, not an oversight.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');

/** Last 10 digits, which is how the same number survives +1 and formatting. */
function phone10(value) {
  const d = String(value || '').replace(/\D+/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function toCandidate(row) {
  return {
    memberId: row.member_id,
    personal: {
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      email: row.email || '',
      primaryPhone: row.primary_phone || '',
      memberStatus: row.member_status || '',
    },
  };
}

/**
 * Look up members at one club by phone and by email, separately, so the caller
 * can tell an agreement-on-both from a single weak signal.
 *
 * @returns {Promise<{byPhone: Array, byEmail: Array}>} ABC-shaped records.
 */
async function searchMembers(clubNumber, { phone, email }) {
  const wantPhone = phone10(phone);
  const wantEmail = String(email || '').trim().toLowerCase();

  if (!wantPhone && !wantEmail) return { byPhone: [], byEmail: [] };

  const supabase = getSupabaseAdmin();

  // PostgREST cannot express "strip punctuation then compare", and adding a SQL
  // function for it would be a schema change. Instead, prefilter with a loose
  // pattern that survives every way ABC formats a number -- "(503) 580-4556",
  // "503-580-4556", "5035804556" all match %503%580%4556% -- then re-check
  // exactly in JS below, so the loose pattern costs precision nothing.
  const groups = [wantPhone.slice(0, 3), wantPhone.slice(3, 6), wantPhone.slice(6)];
  const pattern = `%${groups.join('%')}%`;

  // Two narrow queries rather than one OR: the caller needs to know WHICH
  // channel matched, and merging then re-deriving that is easy to get wrong.
  const [phoneRes, emailRes] = await Promise.all([
    wantPhone
      ? supabase
          .from('abc_members')
          .select('member_id, first_name, last_name, email, primary_phone, mobile_phone, member_status')
          .eq('club_number', String(clubNumber))
          .or(`primary_phone.ilike.${pattern},mobile_phone.ilike.${pattern}`)
          .limit(25)
      : Promise.resolve({ data: [], error: null }),
    wantEmail
      ? supabase
          .from('abc_members')
          .select('member_id, first_name, last_name, email, primary_phone, member_status')
          .eq('club_number', String(clubNumber))
          .ilike('email', wantEmail)
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (phoneRes.error) throw new Error(`member phone search: ${phoneRes.error.message}`);
  if (emailRes.error) throw new Error(`member email search: ${emailRes.error.message}`);

  // Exact re-check: the pattern above is deliberately loose, so this is what
  // actually decides a phone match.
  const byPhone = (phoneRes.data || [])
    .filter(r => phone10(r.primary_phone) === wantPhone || phone10(r.mobile_phone) === wantPhone)
    .map(toCandidate);

  return { byPhone, byEmail: (emailRes.data || []).map(toCandidate) };
}

module.exports = { searchMembers, phone10 };
