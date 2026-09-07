/**
 * Recording a kiosk tour where the reports can see it.
 *
 * Tours are reported from `tour_intakes` rows with `status = 'completed'`:
 * Tours Given and Tour Conversion on Membership Snapshot, and the tour columns
 * on Salesperson Performance. A row still at `ready` is a check-in nobody
 * closed out rather than a tour that happened, and is not counted.
 *
 * The portal exposes `POST /tours/complete` for this, but it sits behind the
 * staff-session middleware and the kiosk is deliberately login-free. The iPad
 * check-in app has the same problem and solves it the same way: write the
 * identical columns directly. `docs/TOUR_COMPLETION_API.md` is explicit that
 * both paths produce the same row shape so a report cannot tell them apart.
 *
 * Why this exists at all: Milwaukie's kiosk raises no card on the tour queue,
 * so there is no intake row for anything to complete. Without this write its
 * tours are invisible to every report, which is exactly what happened.
 *
 * Never fatal. The tour is already in ABC and already in GHL by the time this
 * runs; losing the reporting row is worth a log line, not a failed check-in in
 * front of a member.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');

// Resolved from the club's GHL location id, which is the only location key the
// kiosk carries. Rarely changes, so it is worth not asking every time.
const LOCATION_TTL_MS = 30 * 60 * 1000;
const locationCache = new Map(); // ghlLocationId -> { at, id }

async function locationIdFor(club) {
  const ghlId = String((club && club.ghlLocationId) || '');
  if (!ghlId) return null;

  const hit = locationCache.get(ghlId);
  if (hit && Date.now() - hit.at < LOCATION_TTL_MS) return hit.id;

  let id = null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('locations')
      .select('id')
      .eq('ghl_location_id', ghlId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    id = (data && data.id) || null;
  } catch (err) {
    console.warn('[kiosk/tour-record] location lookup failed:', err.message);
  }

  locationCache.set(ghlId, { at: Date.now(), id });
  return id;
}

/**
 * The ABC employee id for a staff name, when we can find one.
 *
 * The doc asks for the id and takes the name as a fallback, so a miss is fine.
 * Matched within the club: `abc_employees` holds one row per employee, and a
 * name is only unique enough to trust inside a single roster.
 */
async function employeeIdFor(clubNumber, name) {
  const full = String(name || '').trim();
  if (!full || !clubNumber) return '';
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('abc_employees')
      .select('employee_id, full_name')
      .eq('club_number', String(clubNumber))
      .eq('status', 'active');
    if (error) throw new Error(error.message);
    const hit = (data || []).find(
      e => String(e.full_name || '').trim().toLowerCase() === full.toLowerCase()
    );
    return (hit && String(hit.employee_id)) || '';
  } catch (err) {
    console.warn('[kiosk/tour-record] employee lookup failed:', err.message);
    return '';
  }
}

/**
 * Write the completed tour.
 *
 * @returns {Promise<{recorded: boolean, id?: string, error?: string}>}
 */
async function recordTour({ club, ticket, outcome, tourMember, notes, passDays, memberStatus, completedAt }) {
  // An outcome nobody recorded is not a tour. The idle timeout still notifies
  // GHL that somebody checked in, but reporting a tour that never happened
  // would overstate Tours Given for every abandoned tablet.
  if (!outcome) return { recorded: false, skipped: true, reason: 'no outcome' };

  const clubNumber = String(ticket.abc_club_number || '');
  const [locationId, employeeId] = await Promise.all([
    locationIdFor(club),
    employeeIdFor(clubNumber, tourMember),
  ]);

  const row = {
    status: 'completed',
    outcome,
    notes: notes || null,
    completed_at: completedAt || new Date().toISOString(),
    // Who WALKED them around. The portal stores the posting staff session
    // separately in completed_by, and the kiosk has no session -- nobody logs
    // in to it -- so that stays null rather than crediting the wrong person.
    completed_by: null,
    given_by_employee_id: employeeId || null,
    given_by_name: tourMember || null,
    tour_member: tourMember || null,
    // The only field that lets a tour be joined to a membership, and so the
    // only way "tours given -> members signed" is ever measurable.
    abc_member_id: ticket.abc_member_id || null,
    club_number: clubNumber || null,
    location_id: locationId,
    ghl_contact_id: ticket.ghl_contact_id || null,
    contact_name: [ticket.first_name, ticket.last_name].filter(Boolean).join(' ') || null,
    contact_email: ticket.email || null,
    contact_phone: ticket.phone || null,
    pass_days: Number.isInteger(passDays) ? passDays : null,
    member_status_at_tour: memberStatus || null,
    received_at: ticket.submitted_at || new Date().toISOString(),
  };

  try {
    const { data, error } = await getSupabaseAdmin()
      .from('tour_intakes')
      .insert(row)
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { recorded: true, id: data && data.id };
  } catch (err) {
    console.error('[kiosk/tour-record] insert failed:', err.message);
    return { recorded: false, error: err.message };
  }
}

module.exports = { recordTour, locationIdFor, employeeIdFor };
