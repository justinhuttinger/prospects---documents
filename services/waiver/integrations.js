/**
 * Per-club webhook URLs, read from the club_integrations table that Admin ->
 * Club Integrations edits in the staff portal.
 *
 * clubs-config.json stays the fallback, and that is deliberate rather than
 * transitional. It means:
 *   - this ships safely before migration 075 is applied
 *   - a Supabase outage degrades to the last-known-good file values instead of
 *     silently dropping every webhook
 *   - a club with no row, or a column left blank in the admin UI, keeps whatever
 *     the file has
 *
 * The table is the source of truth ONLY when it has a non-empty value.
 *
 * Cached for 60s. An admin who fixes a URL should see it take effect within a
 * minute without a redeploy, which is the whole point of the screen; a per-
 * request query would be pointless load for config that changes monthly.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');

const TTL_MS = 60_000;

// clubs-config.json key -> club_integrations column.
// Only integrations nothing else owns. VIP referrals has vip_referral_config and
// its own admin screen; the portal's Tour Check-In owns tour_location_config.
// Routing those through here too would give one setting two editors.
const FIELD_TO_COLUMN = {
  kioskWaiverLeadWebhookUrl: 'kiosk_waiver_lead_webhook_url',
  kioskWaiverCompletedWebhookUrl: 'kiosk_waiver_completed_webhook_url',
  ptIntakeWebhookUrl: 'pt_intake_webhook_url',
};

let cache = null; // { at, byClubNumber }

async function loadOverrides() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.byClubNumber;

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('club_integrations')
      .select('*');

    if (error) throw new Error(error.message);

    const byClubNumber = {};
    for (const row of data || []) {
      if (row.active === false) continue;
      byClubNumber[String(row.abc_club_number)] = row;
    }
    cache = { at: Date.now(), byClubNumber };
    return byClubNumber;
  } catch (err) {
    // Never fatal. Cache the empty result briefly so a hard Supabase outage
    // does not turn into a query storm on every webhook fan-out.
    console.warn('[club-integrations] falling back to clubs-config.json:', err.message);
    cache = { at: Date.now(), byClubNumber: {} };
    return cache.byClubNumber;
  }
}

/**
 * Resolve one webhook URL for a club.
 *
 * @param {object} club  a clubs-config.json club object
 * @param {string} field one of the keys in FIELD_TO_COLUMN
 * @returns {Promise<string>} the URL, or '' when neither source has one
 */
async function resolveWebhookUrl(club, field) {
  const column = FIELD_TO_COLUMN[field];
  if (!column) throw new Error(`Unknown webhook field "${field}"`);

  const fileValue = String((club && club[field]) || '').trim();

  const overrides = await loadOverrides();
  const row = overrides[String(club && club.clubNumber)];
  const dbValue = String((row && row[column]) || '').trim();

  return dbValue || fileValue;
}

/**
 * The club's own contact details, used ONLY to replace a prospect's value that
 * ABC would refuse. Same table, same cache, same file fallback as the webhooks.
 *
 * Returns bare values, not a prospect: the caller decides which of them are
 * worth substituting, because that judgement differs per field. A missing state
 * is worth replacing every time; a street address is only worth replacing when
 * the alternative is losing the record.
 *
 * @param {object} club a clubs-config.json club object
 * @returns {Promise<{address1: string, city: string, state: string, postalCode: string, phone: string}>}
 */
async function resolveClubFallbacks(club) {
  const overrides = await loadOverrides();
  const row = overrides[String(club && club.clubNumber)] || {};

  const pick = (column, fileKey) =>
    String(row[column] || (club && club[fileKey]) || '').trim();

  return {
    address1: pick('fallback_address1', 'address1'),
    city: pick('fallback_city', 'city'),
    // clubs-config.json carries `state` for every club, so this is populated
    // even before anyone opens the admin screen.
    state: pick('fallback_state', 'state'),
    postalCode: pick('fallback_postal_code', 'postalCode'),
    phone: pick('fallback_phone', 'phone'),
  };
}

function invalidate() {
  cache = null;
}

module.exports = {
  resolveWebhookUrl,
  resolveClubFallbacks,
  invalidate,
  FIELD_TO_COLUMN,
  TTL_MS,
};
