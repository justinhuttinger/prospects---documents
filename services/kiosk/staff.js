/**
 * Who a kiosk outcome can be attributed to, and who referred a VIP pass.
 *
 * Both lists already exist elsewhere and are read here rather than rebuilt:
 *
 *   staff      the GHL "Day One Booking Team Member" dropdown options, which
 *              ghl-sync rebuilds from the live ABC per-club roster. The portal's
 *              tour queue reads exactly this, and it must stay exactly this —
 *              the value is written back to a GHL field whose options come from
 *              the same place, so a name from anywhere else lands as an invalid
 *              option. `abc_employees` is the fallback, and only a fallback: it
 *              holds one row per employee, so an owner who works several clubs
 *              appears under one of them and is missing from the rest.
 *
 *   members    the portal's search_active_members RPC (migration 087), which
 *              digit-normalises phone numbers on both sides so a member is
 *              found by "991-9435" as readily as by name.
 *
 * Neither is ever fatal. A staff member with no roster can still record an
 * outcome by picking from an empty list and typing notes; a referral that
 * cannot be looked up is a missing field, not a failed check-in.
 */

const axios = require('axios');

const { getSupabaseAdmin } = require('../../lib/supabase');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const TIMEOUT_MS = 10_000;

// The roster changes when somebody is hired, not between check-ins.
const ROSTER_TTL_MS = 30 * 60 * 1000;
const rosterCache = new Map(); // slug -> { at, names }

const TEAM_FIELD_KEYS = [
  'contact.day_one_booking_team_member',
  'day_one_booking_team_member',
];

function optionsFromField(field) {
  const raw = field.picklistOptions || field.options || field.picklistOptionsV2 || [];
  return raw
    .map(o => (typeof o === 'string' ? o : o && (o.value || o.label || o.name)))
    .map(s => String(s || '').trim())
    .filter(Boolean);
}

async function fromGhl(club) {
  if (!club.ghlApiKey || !club.ghlLocationId) return [];
  const r = await axios.get(
    `${GHL_BASE_URL}/locations/${club.ghlLocationId}/customFields`,
    {
      headers: {
        Authorization: `Bearer ${club.ghlApiKey}`,
        Version: GHL_API_VERSION,
        Accept: 'application/json',
      },
      timeout: TIMEOUT_MS,
    }
  );
  const list = (r.data && (r.data.customFields || r.data.fields)) || [];
  const field = list.find(d => {
    const key = String(d.fieldKey || d.key || '').toLowerCase();
    return TEAM_FIELD_KEYS.includes(key);
  });
  return field ? optionsFromField(field) : [];
}

async function fromAbcEmployees(club) {
  const { data, error } = await getSupabaseAdmin()
    .from('abc_employees')
    .select('full_name, first_name, last_name')
    .eq('club_number', String(club.clubNumber))
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  return (data || [])
    .map(e => (e.full_name || `${e.first_name || ''} ${e.last_name || ''}`).trim())
    .filter(Boolean);
}

/** Staff names for the outcome dropdown, A-Z. Never throws. */
async function rosterFor(club, slug) {
  const cached = rosterCache.get(slug);
  if (cached && Date.now() - cached.at < ROSTER_TTL_MS) {
    return { names: cached.names, source: cached.source, cached: true };
  }

  let names = [];
  let source = 'none';
  try {
    names = await fromGhl(club);
    if (names.length) source = 'ghl';
  } catch (err) {
    console.warn('[kiosk/staff] GHL roster unavailable:', err.message);
  }

  if (!names.length) {
    try {
      names = await fromAbcEmployees(club);
      if (names.length) source = 'abc_employees';
    } catch (err) {
      console.warn('[kiosk/staff] abc_employees roster unavailable:', err.message);
    }
  }

  names = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  // An empty result is cached too, briefly by virtue of the same TTL, so a GHL
  // outage does not turn every hand-back into two failing API calls.
  rosterCache.set(slug, { at: Date.now(), names, source });
  return { names, source, cached: false };
}

/**
 * Active members matching a name, phone or email, across every club — a VIP
 * referral is regularly made by somebody who trains somewhere else.
 */
async function searchMembers(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const { data, error } = await getSupabaseAdmin().rpc('search_active_members', { q });
  if (error) throw new Error(error.message);

  return (data || []).map(m => ({
    memberId: String(m.member_id || ''),
    name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
    email: m.email || '',
    phone: m.phone || '',
    membershipType: m.membership_type || '',
    club: m.home_club || '',
  }));
}

module.exports = { rosterFor, searchMembers };
