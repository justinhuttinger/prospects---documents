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
const { resolveClubFallbacks } = require('./integrations');
const abc = require('./abc');
const { generatePDF } = require('./pdf');
const {
  formatPhoneNumber,
  getStateCode,
  sanitizeName,
  sanitizeAddress,
  sanitizeDocumentName,
} = require('./sanitize');

/**
 * Did ABC refuse this because of a field value, as opposed to auth, a network
 * blip, or ABC being down? Only a value problem is worth retrying with
 * different values; retrying a 401 just calls it twice.
 */
function isAbcValidationFailure(err) {
  if (!err) return false;
  // createProspect attaches ABC's own body when it refuses a prospect.
  if (!err.abcResponse) return false;
  return /not valid|invalid|required|must be|cannot|length|format/i.test(err.message || '');
}

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

function buildProspectPersonal(formData, club = {}, fallbacks = {}) {
  // The member's own number when ABC will take it, the club's when it will not.
  // ABC accepts a prospect with no phone at all, so this is the least important
  // of the substitutions - but a reachable club number beats a blank field.
  const phone =
    formatPhoneNumber(formData.phone) || formatPhoneNumber(fallbacks.phone);
  return {
    firstName: sanitizeName(formData.first_name, 'Unknown'),
    lastName: sanitizeName(formData.last_name, 'Unknown'),
    email: formData.email,
    primaryPhone: phone,
    mobilePhone: phone,
    // 'N/A' and 'Unknown' remain the last resort. The club's address is used
    // only when the member gave none: a real answer is never overwritten, and
    // filing somebody at the gym's address is a cost worth paying only against
    // losing the record entirely.
    addressLine1: sanitizeAddress(formData.address1 || fallbacks.address1, 'N/A'),
    city: sanitizeName(formData.city || fallbacks.city, 'Unknown'),
    // The club's own state when the form's answer is not a state. ABC refuses
    // the WHOLE prospect over one bad code, so guessing is worse than
    // defaulting to the state the gym is standing in.
    state: getStateCode(formData.state, fallbacks.state || club.state || ''),
    postalCode: formData.postal_code || fallbacks.postalCode || '',
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

  // Admin -> Club Info, falling back to clubs-config.json. Never fatal: a
  // Supabase blip must not stop a waiver, it just means fewer substitutions.
  let fallbacks = {};
  try {
    fallbacks = await resolveClubFallbacks(club);
  } catch (err) {
    console.warn('[waiver] club fallbacks unavailable:', err.message);
  }

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
    const beginDate =
      formData['Trial Start Date'] || new Date().toISOString().split('T')[0];

    let result;
    try {
      result = await abc.createProspect(clubNumber, {
        personal: buildProspectPersonal(formData, club, fallbacks),
        agreement: { beginDate },
      });
    } catch (err) {
      // ABC rejects the entire prospect over a single unusable field and names
      // the rule, not the field, so there is no reliable way to know in advance
      // which value it will refuse. One retry with the optional fields dropped
      // is worth it: the alternative is what happened on 2026-09-01, where the
      // person never reached ABC at all and nobody noticed until the front desk
      // went looking for them.
      //
      // Name, email and date of birth are kept - a prospect without them is not
      // worth creating. Address, phone and gender are not worth losing a member
      // over, so the retry sends the club's state and nothing else optional.
      if (!isAbcValidationFailure(err)) throw err;

      // The retry leans entirely on the club's own details rather than
      // blanking the address: a prospect filed at the gym is still findable,
      // and by this point the alternative is no ABC record at all.
      const minimal = buildProspectPersonal(formData, club, fallbacks);
      const retryPhone = formatPhoneNumber(fallbacks.phone);
      const retried = {
        ...minimal,
        addressLine1: sanitizeAddress(fallbacks.address1, 'N/A'),
        city: sanitizeName(fallbacks.city, 'Unknown'),
        state: fallbacks.state || club.state || '',
        postalCode: fallbacks.postalCode || '',
        primaryPhone: retryPhone,
        mobilePhone: retryPhone,
        gender: '',
      };
      console.warn(
        `[waiver] ABC refused the prospect for ${club.clubName}, retrying without ` +
        `optional fields. Original refusal: ${err.message}`
      );
      result = await abc.createProspect(clubNumber, {
        personal: retried,
        agreement: { beginDate },
      });
      // Recorded so the caller can see the record is thinner than the form was.
      result.degraded = true;
      result.originalRefusal = err.message;
    }

    prospectId = result.prospectId;
    prospectData = result.degraded
      ? { ...result.data, degraded: true, originalRefusal: result.originalRefusal }
      : result.data;
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
    // The alert is what the front desk reads on the check-in that follows, so
    // it has to describe what actually happened. Telling staff "NEW PROFILE"
    // for somebody who has been coming for a year is worse than no alert.
    abc.addMemberAlert(clubNumber, prospectId, created
      ? undefined
      : { text: 'WAIVER SIGNED TODAY', color: 'Blue' }),
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
  isAbcValidationFailure,
  resolveClub,
  buildProspectPersonal,
  stampGhlContact,
};
