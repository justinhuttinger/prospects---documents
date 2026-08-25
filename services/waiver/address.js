/**
 * US address type-ahead for the kiosk.
 *
 * Runs server-side so no geocoding key ever ships to a tablet sitting in a gym
 * lobby, and so the provider can be swapped without redeploying the kiosk.
 *
 * Two providers, chosen by what is configured:
 *
 *   google  when GOOGLE_PLACES_API_KEY is set. Best US coverage and the
 *           familiar autocomplete behavior. Costs money per session.
 *   photon  otherwise. Keyless, OpenStreetMap-backed, good enough for street
 *           addresses in Oregon and Washington. This is what runs today, so the
 *           feature works before anyone signs up for anything.
 *
 * Both normalize to the same shape:
 *   { line1, city, state, postalCode, label }
 *
 * Every failure returns an empty list rather than throwing. The kiosk field
 * degrades to a plain text input, which is the correct outcome: an address the
 * provider has never heard of must not stop somebody joining the gym.
 */

const axios = require('axios');

const TIMEOUT_MS = 4000;
const MAX_RESULTS = 5;

// Photon's lat/lon bias barely reorders anything -- "482 Liberty St" comes back
// led by New York and San Francisco even at location_bias_scale=2. So we
// over-fetch and sort by real distance from the club instead.
//
// Approximate city centres, which is all a sort key needs. Members type an
// address near the club they are standing in.
const CLUB_COORDS = {
  salem:       [44.9429, -123.0351],
  keizer:      [45.0029, -122.9968],
  eugene:      [44.0521, -123.0868],
  springfield: [44.0462, -123.0220],
  milwaukie:   [45.4457, -122.6398],
  clackamas:   [45.4112, -122.5709],
  medford:     [42.3265, -122.8756],
};
const DEFAULT_COORDS = CLUB_COORDS.salem;
// Over-fetch: most hits have no house number, and we rank what is left.
const FETCH_LIMIT = 25;

// Local-first, but never local-only. A visiting member from out of state has to
// be able to find their own address, so nearby hits lead and the rest keep at
// least this many slots. Without the reservation the five-result cap would be
// filled by nearby streets and an out-of-state address would be unreachable no
// matter how much of it they typed.
const NEAR_MILES = 120;
const RESERVED_FAR_SLOTS = 2;

function coordsForSlug(slug) {
  return CLUB_COORDS[String(slug || '').toLowerCase().trim()] || DEFAULT_COORDS;
}

/** Great-circle miles. Only ever used as a sort key. */
function milesBetween(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function activeProvider() {
  return process.env.GOOGLE_PLACES_API_KEY ? 'google' : 'photon';
}

// --- Photon (keyless, OSM) --------------------------------------------------

function fromPhoton(feature) {
  const p = (feature && feature.properties) || {};
  // Photon splits the street number from the street name. A hit with no house
  // number is a street or a city, not somewhere a person lives.
  if (!p.housenumber) return null;
  const line1 = [p.housenumber, p.street || p.name].filter(Boolean).join(' ').trim();
  if (!line1) return null;

  const coords = (feature && feature.geometry && feature.geometry.coordinates) || null;

  return {
    _lat: coords ? coords[1] : null,
    _lon: coords ? coords[0] : null,
    line1,
    city: p.city || p.town || p.village || p.district || '',
    state: p.state ? stateToCode(p.state) : '',
    postalCode: p.postcode || '',
    label: [line1, p.city, p.state, p.postcode].filter(Boolean).join(', '),
  };
}

async function photonSuggest(query, slug) {
  const [clubLat, clubLon] = coordsForSlug(slug);

  const r = await axios.get('https://photon.komoot.io/api/', {
    params: { q: query, limit: FETCH_LIMIT, lang: 'en', lat: clubLat, lon: clubLon },
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'wcs-kiosk/1.0 (+https://westcoaststrength.com)' },
  });

  const hits = ((r.data && r.data.features) || [])
    .filter(f => f.properties && f.properties.countrycode === 'US')
    .map(fromPhoton)
    .filter(Boolean);

  // Attach distance and keep the provider's own ordering as the tiebreak --
  // for an out-of-area address, text-match quality is the only useful signal.
  return hits.map((s, rank) => ({
    ...s,
    _rank: rank,
    _miles:
      s._lat == null ? Number.POSITIVE_INFINITY : milesBetween(clubLat, clubLon, s._lat, s._lon),
  }));
}

/**
 * Interleave nearby and far results so the common case is fast and the rare one
 * is still possible.
 *
 * Nearby hits (within NEAR_MILES of the club) come first, closest first --
 * almost every member lives near the gym they are standing in. Far hits keep
 * RESERVED_FAR_SLOTS of the list in the provider's own relevance order, so a
 * visitor from Texas still sees their address. When there are no far hits the
 * reservation costs nothing and locals get the full list.
 */
function rankLocalFirst(hits) {
  const near = hits.filter(s => s._miles <= NEAR_MILES).sort((a, b) => a._miles - b._miles);
  const far = hits.filter(s => s._miles > NEAR_MILES).sort((a, b) => a._rank - b._rank);

  if (!far.length) return near;
  if (!near.length) return far;

  const nearSlots = Math.max(1, MAX_RESULTS - RESERVED_FAR_SLOTS);
  // Anything nearby that did not make the cut still trails the reserved far
  // slots rather than being dropped outright.
  return [...near.slice(0, nearSlots), ...far, ...near.slice(nearSlots)];
}

// --- Google Places ----------------------------------------------------------

/**
 * Places Autocomplete returns predictions without structured components, so a
 * second Details call per pick would be needed to get city/state/zip. Instead we
 * use the Geocoding-style `findplacefromtext`-free path: Autocomplete for the
 * list, then parse the description, which for US street addresses is reliably
 * "line1, city, ST, USA".
 */
function fromGoogle(prediction) {
  const description = String(prediction.description || '');
  const parts = description.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Trailing "USA" carries no information here.
  if (parts[parts.length - 1].toUpperCase() === 'USA') parts.pop();

  const line1 = parts[0];
  const city = parts[1] || '';
  // The state segment may be "OR" or "OR 97301".
  const stateSegment = parts[2] || '';
  const stateMatch = /^([A-Za-z]{2})(?:\s+(\d{5}))?/.exec(stateSegment);

  return {
    line1,
    city,
    state: stateMatch ? stateMatch[1].toUpperCase() : '',
    postalCode: stateMatch && stateMatch[2] ? stateMatch[2] : '',
    label: description,
  };
}

async function googleSuggest(query) {
  const r = await axios.get(
    'https://maps.googleapis.com/maps/api/place/autocomplete/json',
    {
      params: {
        input: query,
        key: process.env.GOOGLE_PLACES_API_KEY,
        types: 'address',
        components: 'country:us',
      },
      timeout: TIMEOUT_MS,
    }
  );

  const status = r.data && r.data.status;
  if (status && status !== 'OK' && status !== 'ZERO_RESULTS') {
    throw new Error(`Google Places ${status}: ${(r.data && r.data.error_message) || ''}`);
  }

  return ((r.data && r.data.predictions) || []).map(fromGoogle).filter(Boolean);
}

// --- shared -----------------------------------------------------------------

const STATE_NAMES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};

function stateToCode(name) {
  const clean = String(name || '').trim();
  if (clean.length === 2) return clean.toUpperCase();
  return STATE_NAMES[clean.toLowerCase()] || '';
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const key = `${s.line1}|${s.city}|${s.state}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Drop the sort-only internals; the kiosk has no use for them.
    const { _lat, _lon, _miles, _rank, ...clean } = s;
    out.push(clean);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/**
 * @param {string} query what the member has typed so far
 * @param {string} [slug] the club they are standing in, used to rank by distance
 * @returns {Promise<{suggestions: Array, provider: string}>}
 */
async function suggestAddresses(query, slug) {
  const q = String(query || '').trim();
  // Below this a query matches half the state and the list is noise.
  if (q.length < 4) return { suggestions: [], provider: activeProvider() };

  const provider = activeProvider();
  try {
    // Google Places already biases and ranks well on its own; only the keyless
    // provider needs the local-first treatment.
    const raw =
      provider === 'google'
        ? await googleSuggest(q)
        : rankLocalFirst(await photonSuggest(q, slug));
    return { suggestions: dedupe(raw), provider };
  } catch (err) {
    console.warn(`[address-suggest] ${provider} failed:`, err.message);
    return { suggestions: [], provider, degraded: true };
  }
}

module.exports = {
  suggestAddresses, stateToCode, fromPhoton, fromGoogle, dedupe, activeProvider,
  milesBetween, coordsForSlug, CLUB_COORDS, rankLocalFirst, NEAR_MILES,
};
