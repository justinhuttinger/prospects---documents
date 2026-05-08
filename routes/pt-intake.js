// PT Intake — receives a personal-training intake form submission and
// fans it out as one flat-key POST to a per-club inbound GHL webhook.
//
// Mounted from index.js after the global JSON parser. Adds no behavior to
// any existing route — purely additive.
//
// Route:
//   POST /webhooks/pt-intake
//        body: {
//          location: 'salem',
//          firstName, lastName, phone, email,
//          gender, experienceLevel, weightLbs, height,
//          programGoal, durationWeeks, daysPerWeek,
//          day1Focus..day7Focus,
//          limitNeck, limitShoulder, limitElbowWrist, limitHip,
//          limitLowerBack, limitKnee, limitAnkle,
//          ptNotes,
//          submittedAt
//        }
//        -> { ok: true, status }  on success
//        -> { ok: false, error }  on failure
//
// Per-club config in clubs-config.json:
//   ptIntakeWebhookUrl   GHL inbound webhook URL for the location's
//                        "PT Intake" workflow. Empty = endpoint returns
//                        missing_inbound_webhook_url cleanly.

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();

const CLUBS_FILE = path.join(__dirname, '..', 'clubs-config.json');

function loadClubs() {
  return JSON.parse(fs.readFileSync(CLUBS_FILE, 'utf8')).clubs || [];
}

function clubBySlug(slug) {
  const norm = String(slug || '').toLowerCase().trim();
  if (!norm) return null;
  return loadClubs().find(c => c.enabled && c.clubName.toLowerCase() === norm) || null;
}

function digits(s) { return String(s || '').replace(/\D+/g, ''); }

function e164(s) {
  const d = digits(s);
  if (!d) return '';
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return `+${d}`;
}

function str(v) { return v == null ? '' : String(v); }

// Router-scoped CORS — no impact on routes mounted elsewhere.
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

router.post('/webhooks/pt-intake', async (req, res) => {
  try {
    const body = req.body || {};
    const slug = String(body.location || '').toLowerCase().trim();
    const club = clubBySlug(slug);
    if (!club) return res.status(400).json({ ok: false, error: 'unknown_location', location: slug });

    const inboundUrl = club.ptIntakeWebhookUrl;
    if (!inboundUrl) {
      return res.status(500).json({
        ok: false,
        error: 'missing_inbound_webhook_url',
        hint: `Set "ptIntakeWebhookUrl" for ${club.clubName} in clubs-config.json`
      });
    }

    const firstName = str(body.firstName).trim();
    const lastName  = str(body.lastName).trim();
    const phone     = e164(body.phone);
    const email     = str(body.email).trim().toLowerCase();
    if (!firstName || !lastName || !phone || !email) {
      return res.status(400).json({ ok: false, error: 'missing_member_info' });
    }

    // Flat keys so GHL Inbound Webhook custom-data mapping is trivial.
    const payload = {
      first_name: firstName,
      last_name:  lastName,
      phone:      phone,
      email:      email,

      gender:           str(body.gender),
      experience_level: str(body.experienceLevel),
      weight_lbs:       str(body.weightLbs),
      height:           str(body.height),
      program_goal:     str(body.programGoal),
      duration_weeks:   str(body.durationWeeks),
      days_per_week:    str(body.daysPerWeek),

      day_1_focus: str(body.day1Focus),
      day_2_focus: str(body.day2Focus),
      day_3_focus: str(body.day3Focus),
      day_4_focus: str(body.day4Focus),
      day_5_focus: str(body.day5Focus),
      day_6_focus: str(body.day6Focus),
      day_7_focus: str(body.day7Focus),

      limit_neck:        str(body.limitNeck)        || 'no',
      limit_shoulder:    str(body.limitShoulder)    || 'no',
      limit_elbow_wrist: str(body.limitElbowWrist)  || 'no',
      limit_hip:         str(body.limitHip)         || 'no',
      limit_lower_back:  str(body.limitLowerBack)   || 'no',
      limit_knee:        str(body.limitKnee)        || 'no',
      limit_ankle:       str(body.limitAnkle)       || 'no',

      pt_notes: str(body.ptNotes),

      club:             club.clubName,
      location_slug:    slug,
      ghl_location_id:  club.ghlLocationId,
      source:           'PT Intake',
      submitted_at:     body.submittedAt || new Date().toISOString()
    };

    try {
      const resp = await axios.post(inboundUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });
      return res.json({ ok: true, status: resp.status });
    } catch (e) {
      const data = e.response && e.response.data;
      return res.status(502).json({
        ok:    false,
        error: data || e.message,
        status: e.response && e.response.status
      });
    }
  } catch (err) {
    console.error('[pt-intake]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
