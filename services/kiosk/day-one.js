/**
 * The club's Day One booking link, for the staff outcome step.
 *
 * Read from `tour_location_config.day_one_base_url` in the portal database --
 * the same row the portal's Tour Check-In admin screen already edits, and the
 * same link its tour queue opens. Duplicating it into clubs-config.json would
 * give one setting two editors and guarantee they drift.
 *
 * A club with no link configured returns '', and the kiosk hides the button
 * rather than opening an empty overlay.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // ghlLocationId -> { at, url }

async function dayOneUrlFor(club) {
  const locationId = String((club && club.ghlLocationId) || '');
  if (!locationId) return '';

  const hit = cache.get(locationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.url;

  let url = '';
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('tour_location_config')
      .select('day_one_base_url, active')
      .eq('location_id', locationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data && data.active !== false) url = String(data.day_one_base_url || '');
  } catch (err) {
    // Booking is the optional half of the outcome step. Losing the link must
    // not stop a staff member recording what happened.
    console.warn('[kiosk/day-one] link unavailable:', err.message);
  }

  cache.set(locationId, { at: Date.now(), url });
  return url;
}

module.exports = { dayOneUrlFor };
