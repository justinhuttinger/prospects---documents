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
// Per-club config in clubs-config.json:
//   kioskWaiverLeadWebhookUrl       GHL inbound webhook, halfway
//   kioskWaiverCompletedWebhookUrl  GHL inbound webhook, on completion

const express = require('express');

const clubs = require('../services/waiver/clubs');
const { processWaiverSubmission } = require('../services/waiver/flow');
const { sendWaiverConfirmation } = require('../services/waiver/sendgrid');
const { upsertKioskContact, fireInboundWebhook, e164 } = require('../services/waiver/ghl');

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

// The PDF template keys off these exact question strings, so they are defined
// once here and reused by both the pipeline payload and the webhook fan-out.
const Q = {
  heart: 'Has a Doctor Ever Said You Have a Heart Condition & Recommended Only Medically Supervised Activity?',
  chest: 'Do You Experience Chest Pain During Physical Activity?',
  joint: 'Do You Have a Bone or Joint Problem that Physical Activity Could Aggravate?',
  bloodPressure: 'Has Your Doctor Recommended Medication for your Blood Pressure?',
  otherReason: 'Are you Aware of Any Reason you Should Not Exercise Without Medical Supervision',
  routine: 'What is Your Current Workout Routine?',
  diet: 'Do You Follow a Diet / Meal Plan?',
  obstacles: 'What are your Biggest Obstacles?',
  helpMost: 'What Would Help You the Most?',
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

  const webhook = await fireInboundWebhook(club.kioskWaiverLeadWebhookUrl, {
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

  // A GHL hiccup must not stop somebody finishing a waiver at the front desk,
  // so this always answers 200. The per-integration results say what landed.
  return res.json({ ok: true, contactId: ghl.contactId || null, ghl, webhook });
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
  if (!body.signatureDataUrl) return res.status(400).json({ ok: false, error: 'missing_signature' });
  if (!body.agreed) return res.status(400).json({ ok: false, error: 'waiver_not_accepted' });

  const health = body.health || {};
  const fitness = body.fitness || {};

  const answers = {
    [Q.heart]: yesNo(health.heartCondition),
    [Q.chest]: yesNo(health.chestPain),
    [Q.joint]: yesNo(health.boneOrJoint),
    [Q.bloodPressure]: yesNo(health.bloodPressureMeds),
    [Q.otherReason]: yesNo(health.otherReason),
    [Q.routine]: str(fitness.routine),
    [Q.diet]: yesNo(fitness.dietPlan),
    [Q.obstacles]: str(fitness.obstacles),
    [Q.helpMost]: str(fitness.helpMost),
  };

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

    ...answers,
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
  const [sendgrid, webhook] = await Promise.all([
    sendWaiverConfirmation({
      email,
      firstName,
      lastName,
      clubName: club.clubName,
      clubSlug: slug,
      abcMemberId: result.prospectId,
    }),
    fireInboundWebhook(club.kioskWaiverCompletedWebhookUrl, {
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

      health_heart_condition: answers[Q.heart],
      health_chest_pain: answers[Q.chest],
      health_bone_or_joint: answers[Q.joint],
      health_blood_pressure_meds: answers[Q.bloodPressure],
      health_other_reason: answers[Q.otherReason],

      fitness_routine: answers[Q.routine],
      fitness_diet_plan: answers[Q.diet],
      fitness_obstacles: answers[Q.obstacles],
      fitness_help_most: answers[Q.helpMost],

      source: 'Kiosk Waiver',
      stage: 'completed',
      submitted_at: str(body.submittedAt) || new Date().toISOString(),
    }),
  ]);

  return res.json({
    ok: true,
    abcMemberId: result.prospectId,
    clubNumber: result.clubNumber,
    clubName: result.clubName,
    steps: { ...result.steps, sendgrid, webhook },
  });
});

module.exports = router;
