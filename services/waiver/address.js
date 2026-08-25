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

// Photon returns a country-wide spread otherwise; the clubs are all in the
// Willamette Valley and southern Oregon, so biasing to Salem puts the right
// suggestions first without excluding anyone.
const BIAS_LAT = 44.94;
const BIAS_LON = -123.03;

function activeProvider() {
  return process.env.GOOGLE_PLACES_API_KEY ? 'google' : 'photon';
}

// --- Photon (keyless, OSM) --------------------------------------------------

function fromPhoton(feature) {
  const p = (feature && feature.properties) || {};
  // Photon splits the street number from the street name.
  const line1 = [p.housenumber, p.street || p.name].filter(Boolean).join(' ').trim();
  if (!line1) return null;

  return {
    line1,
    city: p.city || p.town || p.village || p.district || '',
    state: p.state ? stateToCode(p.state) : '',
    postalCode: p.postcode || '',
    label: [line1, p.city, p.state, p.postcode].filter(Boolean).join(', '),
  };
}

async function photonSuggest(query) {
  const r = await axios.get('https://photon.komoot.io/api/', {
    params: {
      q: query,
      limit: MAX_RESULTS * 3, // over-fetch: many hits have no house number
      lang: 'en',
      lat: BIAS_LAT,
      lon: BIAS_LON,
    },
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'wcs-kiosk/1.0 (+https://westcoaststrength.com)' },
  });

  return ((r.data && r.data.features) || [])
    .filter(f => f.properties && f.properties.countrycode === 'US')
    .map(fromPhoton)
    .filter(Boolean);
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
    out.push(s);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

/**
 * @param {string} query what the member has typed so far
 * @returns {Promise<{suggestions: Array, provider: string}>}
 */
async function suggestAddresses(query) {
  const q = String(query || '').trim();
  // Below this a query matches half the state and the list is noise.
  if (q.length < 4) return { suggestions: [], provider: activeProvider() };

  const provider = activeProvider();
  try {
    const raw = provider === 'google' ? await googleSuggest(q) : await photonSuggest(q);
    return { suggestions: dedupe(raw), provider };
  } catch (err) {
    console.warn(`[address-suggest] ${provider} failed:`, err.message);
    return { suggestions: [], provider, degraded: true };
  }
}

module.exports = { suggestAddresses, stateToCode, fromPhoton, fromGoogle, dedupe, activeProvider };
