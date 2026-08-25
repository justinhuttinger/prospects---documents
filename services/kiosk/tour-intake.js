/**
 * Putting a kiosk check-in onto the front desk's tour queue.
 *
 * The queue lives in the staff portal (`POST /webhooks/tour-intake` on the auth
 * API), backed by `tour_intakes`, and it is what makes a card appear on the
 * lobby iPad with a chime and a push notification.
 *
 * Fired twice per person, deliberately:
 *
 *   1. from /lead, the moment we have a name and a way to reach them. They are
 *      standing at the kiosk filling in the rest, so the desk should already see
 *      them. There is no photo yet.
 *   2. from /submit, carrying the id from step 1, to attach the photo and
 *      anything else collected since. The portal UPDATES that card rather than
 *      raising a second one, and does not chime again.
 *
 * Never fatal. A member must be able to finish a waiver when the portal is down,
 * so every failure here is reported in the response and swallowed otherwise.
 */

const axios = require('axios');

const PORTAL_API_URL = (process.env.PORTAL_API_URL || 'https://api.wcstrength.com').replace(/\/$/, '');
const TIMEOUT_MS = 15000;

function headers() {
  const h = { 'Content-Type': 'application/json' };
  // The portal allows an unsecured webhook when no secret is configured, so an
  // absent secret is a valid deployment rather than something to throw over.
  if (process.env.GHL_WEBHOOK_SECRET) h['x-webhook-secret'] = process.env.GHL_WEBHOOK_SECRET;
  return h;
}

async function post(payload) {
  try {
    const r = await axios.post(`${PORTAL_API_URL}/webhooks/tour-intake`, payload, {
      headers: headers(),
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (r.status >= 200 && r.status < 300) {
      return { ok: true, id: (r.data && r.data.id) || null, updated: !!(r.data && r.data.updated), status: r.status };
    }
    return {
      ok: false,
      status: r.status,
      error: `tour-intake ${r.status}`,
      detail: (r.data && (r.data.error || r.data.message)) || null,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Raise the card. Called from the halfway trigger.
 * @returns {Promise<{ok, id}>} `id` must be carried to announceCompletion.
 */
function announceArrival({ club, firstName, lastName, email, phone }) {
  return post({
    // The portal resolves our club from the GHL location id.
    location: { id: club.ghlLocationId, name: `West Coast Strength - ${club.clubName}` },
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    source: 'Kiosk Waiver',
    stage: 'started',
  });
}

/**
 * Attach the photo and final details to the card raised earlier.
 * With no `intakeId` this would create a duplicate card, so it no-ops instead.
 */
function announceCompletion({ intakeId, club, firstName, lastName, email, phone, photoDataUrl, abcMemberId }) {
  if (!intakeId) {
    return Promise.resolve({ ok: false, skipped: true, error: 'no intake id from the arrival call' });
  }
  return post({
    intake_id: intakeId,
    location: { id: club.ghlLocationId, name: `West Coast Strength - ${club.clubName}` },
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    photo_base64: photoDataUrl || undefined,
    abc_member_id: abcMemberId || undefined,
    source: 'Kiosk Waiver',
    stage: 'completed',
  });
}

module.exports = { announceArrival, announceCompletion, PORTAL_API_URL };
