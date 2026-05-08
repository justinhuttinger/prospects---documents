// Tour Kiosk — read-only ABC member lookup + tour-completed webhook
// fan-out. Mounted from index.js after the global JSON parser.
//
// All changes here are additive: new file, new routes, no modification
// to any existing handler.
//
// Routes:
//   GET  /api/kiosk/lookup?location=<slug>&phone=<>&email=<>
//        -> { ok, found, abc_member_id, first_name, last_name,
//             last_visit, has_photo, member_status }
//
//   POST /webhooks/tour-completed
//        body: { location, member, employee, vip, dayOne,
//                tourQuestions, tourSummary, submittedAt }
//        -> { ok, status }
//
// Per-club config in clubs-config.json:
//   tourCompletedWebhookUrl   GHL inbound webhook URL for the
//                             "Tour Completed" workflow per location.

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const { searchMember, getLastCheckin, hasPhoto } = require('../lib/kiosk-abc');

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

function flatKey(s) {
  return 'tour_q_' + String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Router-scoped CORS — does not affect routes mounted elsewhere.
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- Member lookup ----
router.get('/api/kiosk/lookup', async (req, res) => {
  try {
    const slug = String(req.query.location || '').toLowerCase().trim();
    const club = clubBySlug(slug);
    if (!club) return res.status(400).json({ ok: false, error: 'unknown_location' });

    const phone = String(req.query.phone || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!phone && !email) return res.status(400).json({ ok: false, error: 'missing_lookup_input' });

    const member = await searchMember(club.clubNumber, { phone, email });
    if (!member) {
      return res.json({
        ok: true,
        found: false,
        abc_member_id: null,
        last_visit: null,
        has_photo: false,
        member_status: null
      });
    }

    const memberId = member.memberId || member.id;
    const status   = String((member.memberStatus || (member.personal && member.personal.memberStatus) || '')).toLowerCase();

    const [lastVisit, photo] = await Promise.all([
      getLastCheckin(club.clubNumber, memberId).catch(() => null),
      hasPhoto(club.clubNumber, memberId).catch(() => false)
    ]);

    return res.json({
      ok:            true,
      found:         true,
      abc_member_id: memberId,
      first_name:    (member.personal && member.personal.firstName) || '',
      last_name:     (member.personal && member.personal.lastName)  || '',
      last_visit:    lastVisit,
      has_photo:     !!photo,
      member_status: status
    });
  } catch (err) {
    console.error('[kiosk/lookup]', (err.response && err.response.data) || err.message);
    return res.status(500).json({ ok: false, error: (err.response && err.response.data) || err.message });
  }
});

// ---- Tour completed webhook (final fan-out) ----
router.post('/webhooks/tour-completed', async (req, res) => {
  try {
    const body = req.body || {};
    const slug = String(body.location || '').toLowerCase().trim();
    const club = clubBySlug(slug);
    if (!club) return res.status(400).json({ ok: false, error: 'unknown_location' });

    const inboundUrl = club.tourCompletedWebhookUrl;
    if (!inboundUrl) {
      return res.status(500).json({
        ok: false,
        error: 'missing_inbound_webhook_url',
        hint: `Set "tourCompletedWebhookUrl" for ${club.clubName} in clubs-config.json`
      });
    }

    const member   = body.member   || {};
    const employee = body.employee || {};
    const vip      = body.vip      || {};
    const dayOne   = body.dayOne   || {};
    const tourQ    = body.tourQuestions || {};

    const vipNames  = Array.isArray(vip.names)  ? vip.names  : [];
    const vipPhones = Array.isArray(vip.phones) ? vip.phones : [];

    const payload = {
      first_name: String(member.firstName || '').trim(),
      last_name:  String(member.lastName  || '').trim(),
      phone:      e164(member.phone),
      email:      String(member.email || '').trim().toLowerCase(),

      abc_member_id:       String(member.abcMemberId || ''),
      was_existing_member: member.wasExisting ? 'yes' : 'no',

      tour_employee_id:   String(employee.id || ''),
      tour_employee_name: String(employee.name || ''),

      vip_count: String(vip.count == null ? (vipNames.filter(Boolean).length || 0) : vip.count),
      vip_1_name: String(vipNames[0] || ''), vip_1_phone: String(vipPhones[0] || ''),
      vip_2_name: String(vipNames[1] || ''), vip_2_phone: String(vipPhones[1] || ''),
      vip_3_name: String(vipNames[2] || ''), vip_3_phone: String(vipPhones[2] || ''),
      vip_4_name: String(vipNames[3] || ''), vip_4_phone: String(vipPhones[3] || ''),
      vip_5_name: String(vipNames[4] || ''), vip_5_phone: String(vipPhones[4] || ''),

      day_one_booked:        String(dayOne.booked || 'skipped'),
      day_one_datetime:      String(dayOne.datetime || ''),
      day_one_employee_name: String(dayOne.employeeName || ''),

      tour_summary: String(body.tourSummary || ''),

      club:             club.clubName,
      location_slug:    slug,
      ghl_location_id:  club.ghlLocationId,
      source:           'Tour Completed',
      submitted_at:     body.submittedAt || new Date().toISOString()
    };

    // Spread tour_q_* keys directly so each question is a top-level field
    // GHL's Inbound Webhook custom-data mapping can bind to.
    Object.keys(tourQ).forEach(k => {
      const key = flatKey(k);
      if (key === 'tour_q_') return;
      const v = tourQ[k];
      payload[key] = (v == null) ? '' : (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));
    });

    try {
      const resp = await axios.post(inboundUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });
      return res.json({ ok: true, status: resp.status });
    } catch (e) {
      return res.status(502).json({
        ok:     false,
        error:  (e.response && e.response.data) || e.message,
        status: e.response && e.response.status
      });
    }
  } catch (err) {
    console.error('[kiosk/tour-completed]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
