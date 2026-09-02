/**
 * ABC Financial field sanitizers.
 *
 * ABC's REST API rejects a whole prospect payload when any single field breaks
 * its character rules, and the error it returns names the rule, not the field.
 * Sanitizing on the way in is cheaper than decoding those failures later, so
 * every caller runs values through here before building a prospect.
 *
 * Extracted verbatim from index.js so the kiosk and the GHL survey webhook
 * share one implementation.
 */

const STATE_CODES = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

/**
 * ABC wants exactly 10 digits and rejects anything else outright, which fails
 * the whole prospect -- not just the phone.
 *
 * The leading 1 is only a country code when there are 11 digits. Stripping it
 * from any number starting with 1 turns a 10-digit "1234560087" into a 9-digit
 * "234560087", which is precisely how a check-in died in production.
 *
 * Anything that still is not 10 digits comes back empty rather than malformed:
 * ABC accepts a prospect with no phone, so a missing number costs us a field
 * while a bad one costs us the whole person.
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return national.length === 10 ? national : '';
}

// Territories and DC are valid ABC state codes too, and somebody typing "DC"
// or "PR" is not an error.
const EXTRA_CODES = ['DC', 'PR', 'VI', 'GU', 'AS', 'MP'];

const VALID_STATE_CODES = new Set(
  Object.values(STATE_CODES).concat(EXTRA_CODES)
);

const STATE_NAMES_LOWER = {};
for (const [name, code] of Object.entries(STATE_CODES)) {
  STATE_NAMES_LOWER[name.toLowerCase()] = code;
}
STATE_NAMES_LOWER['district of columbia'] = 'DC';
STATE_NAMES_LOWER['washington dc'] = 'DC';
STATE_NAMES_LOWER['washington d.c.'] = 'DC';
STATE_NAMES_LOWER['puerto rico'] = 'PR';

/**
 * A US state code ABC will accept, or `fallback`.
 *
 * The old version ended with `substring(0, 2).toUpperCase()`, which turned any
 * unrecognised answer into a plausible-looking code: "Not Sure" became "NO",
 * "United States" became "UN", "N/A" became "N/", a postcode became "98". ABC
 * rejects the code AND THE WHOLE PROSPECT with "State or province code provided
 * is not valid", so one unusable answer in a form field cost us the entire
 * person -- three times on 2026-09-01 alone.
 *
 * Now nothing is invented: a value is either recognisably a state or it is not,
 * and an unrecognised one falls back to the club's own state rather than to a
 * guess that is certain to be refused.
 */
function getStateCode(state, fallback = '') {
  const cleanState = String(state == null ? '' : state).trim();
  if (!cleanState) return fallback;

  // Trailing punctuation is common in free text ("Ore.", "OR.").
  const bare = cleanState.replace(/[.]+$/, '').trim();

  if (bare.length === 2) {
    const upper = bare.toUpperCase();
    return VALID_STATE_CODES.has(upper) ? upper : fallback;
  }

  const byName = STATE_NAMES_LOWER[bare.toLowerCase()];
  return byName || fallback;
}

// Names: 1-19 alphanumerics, apostrophes, hyphens, spaces. Cannot begin with a
// number or a space.
function sanitizeName(name, fallback = 'Unknown') {
  if (!name) return fallback;
  let sanitized = String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9'\- ]/g, '')
    .replace(/^[\d ]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 19);
  return sanitized || fallback;
}

// Addresses: 1-44 alphanumerics, spaces, forward slashes, pound signs.
function sanitizeAddress(address, fallback = 'N/A') {
  if (!address) return fallback;
  let sanitized = String(address)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 /#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 44);
  return sanitized || fallback;
}

// Document names: max 255 chars, alphanumerics, spaces and .,_!%+-@^'
// ABC silently DROPS disallowed characters rather than erroring, which is how
// documents end up filed under a mangled name — so strip them here.
function sanitizeDocumentName(firstName, lastName) {
  const clean = v => String(v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9 .,_!%+\-@^']/g, '')
    .trim();

  const cleanFirst = clean(firstName);
  const cleanLast = clean(lastName);

  if (!cleanFirst && !cleanLast) return 'Waiver.pdf';

  let docName;
  if (cleanFirst && cleanLast) docName = `Waiver_${cleanFirst}_${cleanLast}.pdf`;
  else if (cleanFirst) docName = `Waiver_${cleanFirst}.pdf`;
  else docName = `Waiver_${cleanLast}.pdf`;

  if (docName.length > 255) docName = docName.substring(0, 251) + '.pdf';
  return docName;
}

module.exports = {
  VALID_STATE_CODES,
  STATE_CODES,
  formatPhoneNumber,
  getStateCode,
  sanitizeName,
  sanitizeAddress,
  sanitizeDocumentName,
};
