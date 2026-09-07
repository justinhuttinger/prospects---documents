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
//      photo, check-in, GHL write-back), then the club's "kiosk waiver
//      completed" inbound webhook and the tour-queue update. No email: the
//      member is standing in front of a coach.
//      -> { ok, abcMemberId, clubNumber, outcomeTicket, steps }
//
//      A club with kiosk.staffOutcome set HOLDS the completed webhook and
//      returns an outcomeTicket instead. Nothing else about /submit changes:
//      ABC still has the signed waiver before this route answers.
//
// GET  /staff?location=
//      Staff names for the outcome dropdown, the four outcomes, and the club's
//      Day One booking link. -> { ok, staff, outcomes, dayOneUrl }
//
// GET  /member-search?q=
//      Active members across every club, for the VIP referral field.
//
// POST /outcome                            <-- the deferred final trigger
//      Fires the held completed webhook with the staff member's answers merged
//      in. Everything about the MEMBER comes from the signed ticket, so this
//      public route cannot put anything else into a club's GHL.
//      body: { outcomeTicket, tourMember, outcome, notes, dayOneBooked,
//              referringMemberId, referringMemberName }
//
// Per-club webhook URLs come from the club_integrations table, which Admin ->
// Club Integrations edits in the staff portal, and fall back to the matching
// keys in clubs-config.json:
//   kioskWaiverLeadWebhookUrl       GHL inbound webhook, halfway
//   kioskWaiverCompletedWebhookUrl  GHL inbound webhook, on completion
//
// Per-club BEHAVIOUR comes from the `kiosk` block in clubs-config.json, and an
// absent block means what every club did before Milwaukie:
//   tourQueue      raise a card on the portal's Tour Check-In queue (default on)
//   staffOutcome   ask staff for the tour outcome on the kiosk, and hold the
//                  completed webhook until they answer (default off)

const express = require('express');

const clubs = require('../services/waiver/clubs');
const { processWaiverSubmission } = require('../services/waiver/flow');
const { upsertKioskContact, fireInboundWebhook, e164 } = require('../services/waiver/ghl');
const { resolveWebhookUrl } = require('../services/waiver/integrations');
const { suggestAddresses } = require('../services/waiver/address');
const { announceArrival, announceCompletion } = require('../services/kiosk/tour-intake');
const { findExistingMember } = require('../services/kiosk/match');
const { issueTicket, readTicket, OUTCOMES } = require('../services/kiosk/outcome');
const { grantTrialDays, MAX_DAYS } = require('../services/kiosk/trial');
const { rosterFor, searchMembers } = require('../services/kiosk/staff');
const { dayOneUrlFor } = require('../services/kiosk/day-one');

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

  // Look them up in ABC now, at the same step that raises the queue card, so
  // submit already knows whether to create a profile or attach to theirs.
  // Failure here is not fatal: the worst case is the old behaviour.
  const [ghl, abcMatch] = await Promise.all([
    upsertKioskContact(club, { firstName, lastName, email, phone }, { stage: 'lead' }),
    findExistingMember(club, { firstName, lastName, email, phone })
      .catch(err => {
        console.error('[kiosk-waiver/lead] ABC lookup failed:', err.message);
        return { match: 'none', candidates: [], error: err.message };
      }),
  ]);

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
  // standing at the kiosk filling in the rest. Not gated on a per-club webhook
  // being configured, because the queue is how staff know somebody is in the
  // lobby -- but a club that records its outcome on the kiosk itself has no
  // queue to raise a card on, and would only be filling a list nobody reads.
  const flags = clubs.kioskFlags(club);
  const tourIntake = flags.tourQueue
    ? await announceArrival({ club, firstName, lastName, email, phone: e164(phone) })
    : { ok: true, skipped: true, reason: 'tour queue disabled for this club' };

  // A GHL hiccup must not stop somebody finishing a waiver at the front desk,
  // so this always answers 200. The per-integration results say what landed.
  return res.json({
    ok: true,
    contactId: ghl.contactId || null,
    // The kiosk carries this back at submit so the photo lands on the same card.
    tourIntakeId: tourIntake.id || null,
    // 'exact' the kiosk attaches to silently; 'partial' it must ask about.
    abcMatch,
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
  // A photo is only required when we are creating a profile. Attaching to an
  // existing ABC record means they already have one, and the kiosk skips the
  // camera step entirely for them.
  const attachingToExisting = !!str(body.abcMemberId);
  if (!attachingToExisting && !body.photoDataUrl) {
    return res.status(400).json({ ok: false, error: 'missing_photo' });
  }
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
    // Set only when the member was matched in ABC and, for a partial match,
    // confirmed it was them. Empty means create a new profile.
    abc_member_id: str(body.abcMemberId),

    member_profile_photo: body.photoDataUrl || '',
    signature_data_url: body.signatureDataUrl,

    // A minor cannot sign their own waiver, so the adult with them does. The
    // document has to name who actually signed, or it says a 15-year-old
    // released us from liability on their own authority.
    guardian_name: str(body.guardianName),
    signed_by: str(body.signedBy),

    'Trial Start Date': str(body.trialStartDate) || new Date().toISOString().split('T')[0],
    'Service Employee': str(body.serviceEmployee),

    [Q.howHeard]: howHeard,
  };

  let result;
  try {
    result = await processWaiverSubmission(formData);
  } catch (err) {
    // err.abcResponse carries ABC's own status message; without it the log says
    // only that something went wrong and the cause has to be guessed.
    console.error(
      '[kiosk-waiver/submit]',
      err.message,
      JSON.stringify((err.response && err.response.data) || err.abcResponse || null)
    );
    return res.status(502).json({
      ok: false,
      error: err.message,
      details: (err.response && err.response.data) || err.abcResponse || null,
    });
  }

  // ABC has the signed waiver on file from here on. Everything below is a
  // notification, so a failure is reported but never fails the submission.
  const flags = clubs.kioskFlags(club);
  const completedWebhookUrl = await resolveWebhookUrl(club, 'kioskWaiverCompletedWebhookUrl');

  // No confirmation email. The member is standing at the front desk with a
  // coach; a receipt in their inbox adds nothing and reads as spam to somebody
  // who has not joined anything yet.
  const completedPayload = {
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
    // Lets a GHL workflow greet a returning member differently from a new one.
    is_new_profile: result.created ? 'yes' : 'no',
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
  };

  // A club that asks its own staff for the tour outcome holds this webhook back
  // until they answer, so GHL receives ONE event carrying the check-in and its
  // result rather than two a workflow has to correlate. The payload rides back
  // to the tablet as a signed ticket -- see services/kiosk/outcome.js for why it
  // cannot simply be parked in memory here.
  const webhook = flags.staffOutcome
    ? { ok: true, deferred: true, reason: 'awaiting staff outcome' }
    : await fireInboundWebhook(completedWebhookUrl, completedPayload);

  // Attach the photo to the card raised at the contact step, for the clubs that
  // have one. Otherwise there is no card and nothing to update.
  const tourIntake = flags.tourQueue
    ? await announceCompletion({
        intakeId: str(body.tourIntakeId),
        club,
        firstName,
        lastName,
        email,
        phone: e164(phone),
        photoDataUrl: body.photoDataUrl,
        abcMemberId: result.prospectId,
      })
    : { ok: true, skipped: true, reason: 'tour queue disabled for this club' };

  return res.json({
    ok: true,
    abcMemberId: result.prospectId,
    // false when we attached to a record they already had.
    created: result.created,
    clubNumber: result.clubNumber,
    clubName: result.clubName,
    // Present only when the kiosk still has to collect an outcome. The tablet
    // hands it straight back to /outcome and never inspects it.
    outcomeTicket: flags.staffOutcome ? issueTicket(completedPayload) : null,
    steps: { ...result.steps, webhook, tourIntake },
  });
});

// ---------------------------------------------------------------------------
// GET /staff?location=  — the outcome step's dropdown and its Day One link
// ---------------------------------------------------------------------------
router.get('/staff', async (req, res) => {
  const slug = str(req.query.location).toLowerCase();
  const club = clubs.bySlug(slug);
  if (!club) return res.status(400).json({ ok: false, error: 'unknown_location', location: slug });

  // Both are optional decoration on a step whose real job is recording an
  // outcome, so neither failure is allowed to fail the request.
  const [roster, dayOneUrl] = await Promise.all([
    rosterFor(club, slug).catch(() => ({ names: [], source: 'error' })),
    dayOneUrlFor(club).catch(() => ''),
  ]);

  return res.json({
    ok: true,
    staff: roster.names,
    source: roster.source,
    outcomes: OUTCOMES,
    // Outcome -> days it grants. `null` means the tablet has to ask, which is
    // how it knows to show a day count for a custom pass without hardcoding
    // which outcome that is.
    passDays: clubs.kioskFlags(club).passDays,
    dayOneUrl,
  });
});

// ---------------------------------------------------------------------------
// GET /member-search?q=  — who referred a VIP pass
// ---------------------------------------------------------------------------
router.get('/member-search', async (req, res) => {
  const q = str(req.query.q);
  if (q.length < 2) return res.json({ ok: true, members: [] });

  try {
    return res.json({ ok: true, members: await searchMembers(q) });
  } catch (err) {
    console.warn('[kiosk-waiver/member-search]', err.message);
    // An empty list reads as "no match" on the tablet, which is the right
    // outcome for a lookup that is a convenience on an optional field.
    return res.json({ ok: true, members: [], error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /outcome — the deferred final trigger
// ---------------------------------------------------------------------------
//
// Fires the "kiosk waiver completed" webhook that /submit held back, with the
// staff member's answers merged in. Everything describing the member comes from
// the signed ticket rather than from this request, so the only thing the tablet
// can put into GHL here is the outcome itself.
router.post('/outcome', async (req, res) => {
  const body = req.body || {};

  const ticket = readTicket(body.outcomeTicket);
  if (!ticket.ok) {
    // 410 rather than 400 for an expired ticket: the request was well formed,
    // the window closed. The kiosk shows a different message for each.
    const gone = ticket.error === 'expired_ticket';
    return res.status(gone ? 410 : 400).json({ ok: false, error: ticket.error });
  }

  const club = clubs.bySlug(str(ticket.payload.location_slug).toLowerCase());
  if (!club) return res.status(400).json({ ok: false, error: 'unknown_location' });

  const outcome = str(body.outcome);
  if (outcome && !OUTCOMES.includes(outcome)) {
    return res.status(400).json({ ok: false, error: 'unknown_outcome', outcome });
  }

  // Give them their access in ABC BEFORE telling GHL about it, so the webhook
  // can carry the real expiration date rather than a promise of one.
  //
  // grantTrialDays writes the agreement AND posts the desk alert: extending
  // expirationDate is what flips ABC's isActive, so without this a member is
  // told they have a pass and then bounces off the door. A real member rather
  // than a prospect gets the alert only -- ABC exposes no writable member
  // agreement route -- and says so in `mode`.
  const pass = await grantPass({ club, ticket: ticket.payload, outcome, body });

  // A blank outcome is legitimate: the idle timeout fires this so a tour nobody
  // recorded still reaches GHL as a check-in. `tour_recorded` is what a workflow
  // branches on, so it never has to infer intent from an empty string.
  const url = await resolveWebhookUrl(club, 'kioskWaiverCompletedWebhookUrl');
  const webhook = await fireInboundWebhook(url, {
    ...ticket.payload,
    tour_member: str(body.tourMember),
    tour_outcome: outcome,
    tour_notes: str(body.notes),
    day_one_booked: body.dayOneBooked ? 'yes' : 'no',
    // Only ever set alongside a VIP pass, and only when staff picked somebody.
    referring_member_id: str(body.referringMemberId),
    referring_member_name: str(body.referringMemberName),
    tour_recorded: outcome ? 'yes' : 'no',
    // Distinct from submitted_at: the gap between them is the tour.
    outcome_at: str(body.outcomeAt) || new Date().toISOString(),

    // Empty for an outcome that grants nothing, so a workflow can send a
    // "your pass runs to..." message without first working out whether there
    // is a pass.
    pass_days: pass.days ? String(pass.days) : '',
    pass_expiration_date: pass.expirationDate || '',
    // 'full' wrote the ABC agreement; 'alert_only' could not, so the door does
    // not know. Worth a different follow-up.
    pass_mode: pass.mode || '',
  });

  return res.json({ ok: true, webhook, pass });
});

/**
 * Turn an outcome into ABC access, when it is the kind of outcome that grants
 * any.
 *
 * Never throws and never fails the request. The tour happened, the waiver is
 * filed, and a staff member is standing there: an ABC outage must not cost us
 * the outcome as well. The failure is reported back so it is visible rather
 * than silent.
 */
async function grantPass({ club, ticket, outcome, body }) {
  const passDays = clubs.kioskFlags(club).passDays;
  if (!outcome || !(outcome in passDays)) return { granted: false };

  // A configured number, or the staff member's own for a custom pass.
  const configured = passDays[outcome];
  const days = configured == null ? Number(body.passDays) : Number(configured);

  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    return { granted: false, error: 'invalid_days', days: body.passDays, maxDays: MAX_DAYS };
  }

  const memberId = str(ticket.abc_member_id);
  const clubNumber = str(ticket.abc_club_number);
  if (!memberId || !clubNumber) return { granted: false, error: 'no_abc_member' };

  try {
    const result = await grantTrialDays(clubNumber, memberId, days);
    return { granted: !!result.ok, days, ...result };
  } catch (err) {
    console.error('[kiosk-waiver/outcome] ABC pass failed:', err.message);
    return { granted: false, days, error: err.message };
  }
}

module.exports = router;
