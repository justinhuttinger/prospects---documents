/**
 * Per-club branding for the kiosk and the waiver PDF.
 *
 * Every club was West Coast Strength until Milwaukie, which trades as East Side
 * Athletic Club and has to look like it: its own wordmark, its own colour, and
 * its own legal entity in the release text a member signs.
 *
 * A club with no `brand` block in clubs-config.json gets WCS, so this changes
 * nothing for the other six. Adding the next acquisition is a config edit
 * rather than a deploy on the kiosk side, which is the same promise the slug
 * list already makes.
 *
 * The legal name is deliberately its own key rather than derived from the
 * display name. "East Side Athletic Club" is what a member reads on a tablet;
 * the entity that a liability release binds is a matter of what is registered,
 * and guessing at it by appending ", LLC" would put the wrong party on a signed
 * document.
 */

const WCS = {
  // What the kiosk shows next to the club name, e.g. "West Coast Strength Salem".
  name: 'West Coast Strength',
  // Overrides the "<name> <club>" pairing entirely when a brand does not read
  // well with a town appended.
  displayName: '',
  // The party the waiver releases. Must match what is registered.
  legalName: 'West Coast Strength, LLC',
  // Shorter form for the second and later mentions in the release text.
  legalShortName: 'West Coast Strength',
  // Served from the kiosk's own public/ directory.
  logo: '/wcs-logo.png',
  // Filename in the repo root, used by the PDF header. The WCS file is named
  // .png but holds WEBP, so its type is stated rather than inferred.
  pdfLogo: 'logo.png',
  pdfLogoMime: 'image/webp',
  // How wide the kiosk paints the logo, as a CSS length. The WCS mark is a
  // square badge; East Side is a lockup over three times as wide, and a value
  // that suits one makes the other either tiny or overbearing. Sizing by width
  // rather than height keeps the badge exactly as it has always been.
  logoWidth: 'clamp(150px, 26vh, 260px)',
  // Heading above the waiver PDF.
  pdfTitle: 'WEST COAST STRENGTH',
  accent: '#e31e24',
  accentHot: '#c4171c',
  // The state whose law the waiver is construed under.
  governingState: 'Oregon',
};

/** The full brand for a club, with every WCS default filled in. */
function brandFor(club) {
  const overrides = (club && club.brand) || {};
  const brand = { ...WCS };
  for (const key of Object.keys(WCS)) {
    const value = overrides[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      brand[key] = value;
    }
  }
  // A brand that named itself but not its legal entity would silently release
  // the wrong company, so fall back loudly to the display name rather than to
  // West Coast Strength.
  if (overrides.name && !overrides.legalName) {
    brand.legalName = overrides.name;
    brand.legalShortName = overrides.legalShortName || overrides.name;
  }
  return brand;
}

/** What the kiosk header reads: an explicit override, or "<brand> <club>". */
function displayNameFor(club) {
  const brand = brandFor(club);
  if (brand.displayName) return brand.displayName;
  return `${brand.name} ${(club && club.clubName) || ''}`.trim();
}

module.exports = { brandFor, displayNameFor, WCS };
