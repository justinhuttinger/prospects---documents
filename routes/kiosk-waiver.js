// Kiosk Waiver — the front-desk tablet flow behind kiosk.westcoaststrength.com.
//
// The kiosk site is a static Cloudflare Worker with no secrets of its own; every
// integration runs here. Mount with a PATH PREFIX:
//
//     app.use('/api/kiosk-waiver', require('./routes/kiosk-waiver'));
//
// The prefix is not cosmetic. Several routers in this app register a CORS
// middleware with no path, which makes them answer the OPTIONS preflight for
// every URL in the app. Scoping this router to its own prefix keeps its CORS
// (and theirs) where it belongs.
//
// Routes
// ------
// GET  /locations
//      Public club list for the kiosk's slug router and its fallback picker.
//      -> { ok, locations: [{ slug, name, displayName, clubNumber }] }
//
// GET  /address-suggest?q=&location=
//      US address type-ahead for the address step. Server-side so no geocoding
//      key reaches the tablet. Google Places when GOOGLE_PLACES_API_KEY is set,
//      keyless Photon otherwise. `location` is the club slug, used to rank
//      results by distance from that club.
//
// POST /lead                                        <-- the halfway trigger
//      Fired the moment name + contact info are entered, several steps before
//      the waiver is signed. Upserts the GHL contact and fires the club's
//      "kiosk waiver started" inbound webhook, so an abandoned session is still
//      a captured lead and follow-up begins immediately.
//      body: { location, firstName, lastName, email, phone }
//      -> { ok, contactId, ghl, webhook }
//
// POST /submit                                      <-- the final trigger
//      Runs the full ABC pipeline (prospect, waiver PDF, document, alert,
//      photo, check-in, GHL write-back), then the SendGrid confirmation and
//      the club's "kiosk waiver completed" inbound webhook.
//      -> { ok, abcMemberId, clubNumber, steps }
//
// Per-club webhook URLs come from the club_integrations table, which Admin ->
// Club Integrations edits in the staff portal, and fall back to the matching
// keys in clubs-config.json:
//   kioskWaiverLeadWebhookUrl       GHL inbound webhook, halfway
//   kioskWaiverCompletedWebhookUrl  GHL inbound webhook, on completion

const express = require('express');

const clubs = require('../services/waiver/clubs');
const { processWaiverSubmission } = require('../services/waiver/flow');
const { sendWaiverConfirmation } = require('../services/waiver/sendgrid');
const { upsertKioskContact, fireInboundWebhook, e164 } = require('../services/waiver/ghl');
const { resolveWebhookUrl } = require('../services/waiver/integrations');
const { suggestAddresses } = require('../services/waiver/address');
const { announceArrival, announceCompletion } = require('../services/kiosk/tour-intake');

const router = express.Router();

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function str(v) {
  return v == null ? '' : String(v).trim();
}

function yesNo(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return str(v);
}

// The PDF template keys off this exact string. The health questionnaire and
// fitness profile the kiosk used to collect are gone; the GHL trial survey still
// sends them and the PDF still renders them when present.
const Q = {
  howHeard: 'How Did You Hear About Us',
};

// ---------------------------------------------------------------------------
// GET /locations
// ---------------------------------------------------------------------------
router.get('/locations', (req, res) => {
  try {
    return res.json({ ok: true, locations: clubs.publicList() });
  } catch (err) {
    console.error('[kiosk-waiver/locations]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /address-suggest?q= — type-ahead for the address step
//
// Proxied through here so no geocoding key ships to a tablet in a gym lobby.
// Always 200 with a (possibly empty) list: the kiosk field degrades to a plain
// text input, and an address the provider has never heard of must not stop
// somebody joining the gym.
// ---------------------------------------------------------------------------
router.get('/address-suggest', async (req, res) => {
  try {
    const result = await suggestAddresses(req.query.q, req.query.location);
    // Suggestions for the same prefix do not change minute to minute, and the
    // same few streets get typed all day at a given club.
    res.set('Cache-Control', 'public, max-age=300');
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[kiosk-waiver/address-suggest]', err.message);
    return res.json({ ok: true, suggestions: [], degraded: true });
  }
});

// ---------------------------------------------------------------------------
// POST /lead — halfway trigger
// ---------------------------------------------------------------------------
router.post('/lead', async (req, res) => {
  const body = req.body || {};
  const slug = str(body.location).toLowerCase();
  const club = clubs.bySlug(slug);
  if (!club) return res.status(400).json({ ok: false, error: 'unknown_location', location: slug });

  const firstName = str(body.firstName);
  const lastName = str(body.lastName);
  const email = str(body.email).toLowerCase();
  const phone = str(body.phone);

  if (!firstName || !lastName) {
    return res.status(400).json({ ok: false, error: 'missing_name' });
  }
  if (!email && !phone) {
    return res.status(400).json({ ok: false, error: 'missing_contact_info' });
  }

  const ghl = await upsertKioskContact(
    club,
    { firstName, lastName, email, phone },
    { stage: 'lead' }
  );

  const leadWebhookUrl = await resolveWebhookUrl(club, 'kioskWaiverLeadWebhookUrl');
  const webhook = await fireInboundWebhook(leadWebhookUrl, {
    first_name: firstName,
    last_name: lastName,
    email,
    phone: e164(phone),
    ghl_contact_id: ghl.contactId || '',
    club: club.clubName,
    location_slug: slug,
    ghl_location_id: club.ghlLocationId,
    abc_club_number: String(club.clubNumber),
    source: 'Kiosk Waiver',
    stage: 'started',
    started_at: str(body.startedAt) || new Date().toISOString(),
  });

  // Put them on the front desk's tour queue right now, while they are still
  // standing at the kiosk filling in the rest. This fires unconditionally --
  // it is not gated on a per-club webhook being configured, because the queue
  // is how staff know somebody is in the lobby.
  const tourIntake = await announceArrival({
    club, firstName, lastName, email, phone: e164(phone),
  });

  // A GHL hiccup must not stop somebody finishing a waiver at the front desk,
  // so this always answers 200. The per-integration results say what landed.
  return res.json({
    ok: true,
    contactId: ghl.contactId || null,
    // The kiosk carries this back at submit so the photo lands on the same card.
    tourIntakeId: tourIntake.id || null,
    ghl,
    webhook,
    tourIntake,
  });
});

// ---------------------------------------------------------------------------
// POST /submit — final trigger
// ---------------------------------------------------------------------------
router.post('/submit', async (req, res) => {
  const body = req.body || {};
  const slug = str(body.location).toLowerCase();
  const club = clubs.bySlug(slug);
  if (!club) return res.status(400).json({ ok: false, error: 'unknown_location', location: slug });

  const firstName = str(body.firstName);
  const lastName = str(body.lastName);
  const email = str(body.email).toLowerCase();
  const phone = str(body.phone);

  if (!firstName || !lastName) return res.status(400).json({ ok: false, error: 'missing_name' });
  if (!email && !phone) return res.status(400).json({ ok: false, error: 'missing_contact_info' });
  if (!body.photoDataUrl) return res.status(400).json({ ok: false, error: 'missing_photo' });
  if (!body.signatureDataUrl) return res.status(400).json({ ok: false, error: 'missing_signature' });
  if (!body.agreed) return res.status(400).json({ ok: false, error: 'waiver_not_accepted' });

  const howHeard = str(body.howHeard);

    // Flatten into the shape the shared waiver pipeline and PDF template expect.
  const formData = {
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    address1: str(body.address1),
    city: str(body.city),
    state: str(body.state),
    postal_code: str(body.postalCode),
    date_of_birth: str(body.dateOfBirth),
    Gender: str(body.gender),

    club_number: String(club.clubNumber),
    location: { id: club.ghlLocationId, name: `West Coast Strength - ${club.clubName}` },
    location_slug: slug,
    contact_id: str(body.contactId),

    member_profile_photo: body.photoDataUrl || '',
    signature_data_url: body.signatureDataUrl,

    'Trial Start Date': str(body.trialStartDate) || new Date().toISOString().split('T')[0],
    'Service Employee': str(body.serviceEmployee),

    [Q.howHeard]: howHeard,
  };

  let result;
  try {
    result = await processWaiverSubmission(formData);
  } catch (err) {
    console.error('[kiosk-waiver/submit]', (err.response && err.response.data) || err.message);
    return res.status(502).json({
      ok: false,
      error: err.message,
      details: (err.response && err.response.data) || err.abcResponse || null,
    });
  }

  // ABC has the signed waiver on file from here on. Everything below is a
  // notification, so a failure is reported but never fails the submission.
  const completedWebhookUrl = await resolveWebhookUrl(club, 'kioskWaiverCompletedWebhookUrl');

  const [sendgrid, webhook, tourIntake] = await Promise.all([
    sendWaiverConfirmation({
      email,
      firstName,
      lastName,
      clubName: club.clubName,
      clubSlug: slug,
      abcMemberId: result.prospectId,
    }),
    fireInboundWebhook(completedWebhookUrl, {
      first_name: firstName,
      last_name: lastName,
      email,
      phone: e164(phone),
      address1: formData.address1,
      city: formData.city,
      state: formData.state,
      postal_code: formData.postal_code,
      date_of_birth: formData.date_of_birth,
      gender: formData.Gender,

      abc_member_id: String(result.prospectId),
      ghl_contact_id: formData.contact_id,
      abc_club_number: String(club.clubNumber),
      club: club.clubName,
      location_slug: slug,
      ghl_location_id: club.ghlLocationId,

      waiver_signed: 'yes',
      photo_captured: formData.member_profile_photo ? 'yes' : 'no',
      trial_start_date: formData['Trial Start Date'],
      service_employee: formData['Service Employee'],

      how_heard: howHeard,

      source: 'Kiosk Waiver',
      stage: 'completed',
      submitted_at: str(body.submittedAt) || new Date().toISOString(),
    }),
    // Attach the photo to the card raised at the contact step. Also
    // unconditional -- the desk should see a face regardless of GHL config.
    announceCompletion({
      intakeId: str(body.tourIntakeId),
      club,
      firstName,
      lastName,
      email,
      phone: e164(phone),
      photoDataUrl: body.photoDataUrl,
      abcMemberId: result.prospectId,
    }),
  ]);

  return res.json({
    ok: true,
    abcMemberId: result.prospectId,
    clubNumber: result.clubNumber,
    clubName: result.clubName,
    steps: { ...result.steps, sendgrid, webhook, tourIntake },
  });
});

module.exports = router;
