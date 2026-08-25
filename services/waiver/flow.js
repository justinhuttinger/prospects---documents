/**
 * The trial-waiver pipeline: one submission in, an ABC prospect with a signed
 * waiver on file out.
 *
 * Order matters. The alert and the profile photo have to be in place BEFORE the
 * check-in is posted, or the front desk gets a check-in with no picture and no
 * "new profile" flag — which is the whole point of posting one.
 *
 *   1. create the ABC prospect            (fatal on failure — nothing to attach to)
 *   2. render the waiver PDF              (fatal — the waiver is the deliverable)
 *   3. upload the document + add the alert (parallel, non-fatal)
 *   4. upload the profile photo            (non-fatal, skipped when absent)
 *   5. post the check-in                   (non-fatal)
 *   6. stamp abc_member_id back onto GHL   (non-fatal)
 *
 * Steps 3-6 are best-effort on purpose: a member standing at the kiosk should
 * not see a failure because ABC's document service was briefly slow. Every
 * step's outcome comes back in `steps` so the caller can log or alert on it.
 */

const axios = require('axios');

const clubs = require('./clubs');
const abc = require('./abc');
const { generatePDF } = require('./pdf');
const {
  formatPhoneNumber,
  getStateCode,
  sanitizeName,
  sanitizeAddress,
  sanitizeDocumentName,
} = require('./sanitize');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

/**
 * Resolve the club from whatever the caller had on hand, most specific first.
 * Returns the club config object or null.
 */
function resolveClub(formData) {
  const explicit =
    formData.club_number ||
    formData.clubNumber ||
    (formData.customData && formData.customData.club_number);

  return (
    clubs.byNumber(explicit) ||
    clubs.byGhlLocationId(formData.location && formData.location.id) ||
    clubs.byDisplayName(formData.location && formData.location.name) ||
    clubs.bySlug(formData.location_slug) ||
    null
  );
}

function buildProspectPersonal(formData) {
  const phone = formatPhoneNumber(formData.phone);
  return {
    firstName: sanitizeName(formData.first_name, 'Unknown'),
    lastName: sanitizeName(formData.last_name, 'Unknown'),
    email: formData.email,
    primaryPhone: phone,
    mobilePhone: phone,
    addressLine1: sanitizeAddress(formData.address1, 'N/A'),
    city: sanitizeName(formData.city, 'Unknown'),
    state: getStateCode(formData.state),
    postalCode: formData.postal_code || '',
    birthDate: formData.date_of_birth
      ? new Date(formData.date_of_birth).toISOString().split('T')[0]
      : '',
    gender: formData.Gender || '',
    // ABC requires both fields; the club does not collect either, and these two
    // sentinel values are what the existing OBC configuration expects.
    employer: '1',
    occupation: '2',
    countryCode: 'US',
  };
}

/**
 * Stamp the new ABC id onto the GHL contact so the ABC-to-GHL reconciler
 * matches this person instead of creating a duplicate. Non-fatal by design.
 */
async function stampGhlContact(club, contactId, abcMemberId) {
  if (!contactId) return { success: false, skipped: true, error: 'No GHL contact_id supplied' };
  if (!club.ghlApiKey) {
    return { success: false, skipped: true, error: `No GHL API key for ${club.clubName}` };
  }

  try {
    const resp = await axios.put(
      `${GHL_BASE_URL}/contacts/${contactId}`,
      { customFields: [{ key: 'abc_member_id', field_value: String(abcMemberId) }] },
      {
        headers: {
          Authorization: `Bearer ${club.ghlApiKey}`,
          'Content-Type': 'application/json',
          Version: GHL_API_VERSION,
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    if (resp.status >= 200 && resp.status < 300) return { success: true, status: resp.status };
    return { success: false, error: `GHL ${resp.status}`, data: resp.data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Run the whole pipeline.
 *
 * @param {object} formData flat submission (see the key list in routes/kiosk-waiver.js).
 *        Set `abc_member_id` to attach to an existing ABC record instead of
 *        creating one.
 * @returns {Promise<{clubNumber, clubName, prospectId, steps}>}
 * @throws when the club cannot be resolved, or when ABC refuses the prospect.
 */
async function processWaiverSubmission(formData) {
  const club = resolveClub(formData);
  if (!club) {
    const name = (formData.location && formData.location.name) || formData.location_slug || '';
    throw new Error(
      `Unable to determine club. Send club_number, or a location.id / location.name ` +
      `that matches clubs-config.json (got "${name}").`
    );
  }

  const clubNumber = String(club.clubNumber);

  // 1. The ABC record.
  //
  // When the caller already matched this person in ABC we reuse their id
  // instead of creating a second one. Everything downstream — waiver, photo,
  // alert, check-in — then lands on the record they already have. Creating
  // unconditionally is how a returning member ends up with a duplicate
  // profile, which is invisible until somebody notices two of them in DataTrak.
  const existingMemberId = String(formData.abc_member_id || '').trim();

  let prospectId;
  let prospectData;
  let created;

  if (existingMemberId) {
    prospectId = existingMemberId;
    prospectData = { reused: true, memberId: existingMemberId };
    created = false;
  } else {
    const result = await abc.createProspect(clubNumber, {
      personal: buildProspectPersonal(formData),
      agreement: {
        beginDate: formData['Trial Start Date'] || new Date().toISOString().split('T')[0],
      },
    });
    prospectId = result.prospectId;
    prospectData = result.data;
    created = true;
  }

  // 2. Waiver PDF — fatal on failure; the signed document is the deliverable.
  const pdfBuffer = await generatePDF(formData);

  // 3. Document + alert together: neither depends on the other.
  const [document, alert] = await Promise.all([
    abc.uploadDocument(clubNumber, prospectId, {
      pdfBuffer,
      documentName: sanitizeDocumentName(formData.first_name, formData.last_name),
    }),
    abc.addMemberAlert(clubNumber, prospectId),
  ]);

  // 4. Photo, before the check-in so the desk sees a face on the first scan.
  const photo =
    formData.member_profile_photo ||
    formData['Member Profile Photo'] ||
    (formData.customData && formData.customData.member_profile_photo);

  const picture = photo
    ? await abc.uploadMemberPicture(clubNumber, prospectId, photo)
    : { success: false, skipped: true, error: 'No photo provided' };

  // 5. Check-in.
  const checkin = await abc.postMemberCheckin(clubNumber, prospectId, {
    stationId: club.stationId,
  });

  // 6. GHL write-back.
  const ghl = await stampGhlContact(club, formData.contact_id, prospectId);

  return {
    clubNumber,
    clubName: club.clubName,
    prospectId,
    // Lets the caller say "welcome back" rather than "welcome", and lets us see
    // in the logs how often the dedupe is actually catching someone.
    created,
    steps: { prospect: prospectData, document, alert, picture, checkin, ghl },
  };
}

module.exports = {
  processWaiverSubmission,
  resolveClub,
  buildProspectPersonal,
  stampGhlContact,
};
