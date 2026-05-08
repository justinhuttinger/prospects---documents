// Tour Kiosk — read-only ABC member lookup, GHL Day One appointment
// detection, and tour-completed webhook fan-out. Mounted from index.js
// after the global JSON parser.
//
// All changes here are additive: new file, new routes, no modification
// to any existing handler.
//
// Routes:
//   GET  /api/kiosk/lookup?location=&phone=&email=&firstName=&lastName=
//        Searches ABC by phone AND email separately, intersects, and
//        scores each candidate by name match. Returns:
//        {
//          ok, match: 'exact'|'partial'|'none',
//          candidates: [
//            { abc_member_id, first_name, last_name, member_status,
//              last_visit, has_photo,
//              match_via: ['phone','email']|['phone']|['email'],
//              name_matches: bool }
//          ]
//        }
//        - 'exact'   -> single candidate, all three of phone/email/name agree
//        - 'partial' -> any other case with at least one candidate (UI
//                       should show "is this you?" picker)
//        - 'none'    -> no candidates
//
//   GET  /api/kiosk/check-appointment?location=&phone=&email=&sinceMinutes=
//        Looks up the GHL contact by phone/email and returns appointments
//        booked in the last sinceMinutes (default 30). Used by the Day
//        One step to detect a fresh booking automatically — no self-
//        reported "did they book" question.
//        -> { ok, appointments: [{ id, start, end, calendarId, title }] }
//
//   POST /webhooks/tour-completed
//        Fan-out the full tour state to the per-club inbound webhook
//        with a flat-key payload.
//
// Per-club config in clubs-config.json:
//   tourCompletedWebhookUrl   GHL inbound webhook URL.

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const {
  searchByPhone, searchByEmail,
  getLastCheckin, hasPhoto,
} = require('../lib/kiosk-abc');

const router = express.Router();

const CLUBS_FILE = path.join(__dirname, '..', 'clubs-config.json');
const GHL_BASE_URL    = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

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

function norm(s) { return String(s || '').trim().toLowerCase(); }

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

    const phone     = String(req.query.phone || '').trim();
    const email     = String(req.query.email || '').trim().toLowerCase();
    const firstName = String(req.query.firstName || '').trim();
    const lastName  = String(req.query.lastName  || '').trim();
    if (!phone && !email) return res.status(400).json({ ok: false, error: 'missing_lookup_input' });

    const [byPhone, byEmail] = await Promise.all([
      phone ? searchByPhone(club.clubNumber, phone).catch(() => []) : Promise.resolve([]),
      email ? searchByEmail(club.clubNumber, email).catch(() => []) : Promise.resolve([]),
    ]);

    // Dedupe + record which inputs matched
    const dedup = new Map();
    for (const m of byPhone) {
      const id = m.memberId || m.id;
      if (!id) continue;
      dedup.set(id, { member: m, viaPhone: true, viaEmail: false });
    }
    for (const m of byEmail) {
      const id = m.memberId || m.id;
      if (!id) continue;
      const existing = dedup.get(id);
      if (existing) existing.viaEmail = true;
      else dedup.set(id, { member: m, viaPhone: false, viaEmail: true });
    }

    if (!dedup.size) {
      return res.json({ ok: true, match: 'none', candidates: [] });
    }

    const candidates = await Promise.all(
      Array.from(dedup.values()).map(async ({ member, viaPhone, viaEmail }) => {
        const memberId = member.memberId || member.id;
        const personal = member.personal || {};
        const memberFirst = norm(personal.firstName);
        const memberLast  = norm(personal.lastName);
        const enteredFirst = norm(firstName);
        const enteredLast  = norm(lastName);
        const nameMatches = (enteredFirst && enteredLast)
          ? (memberFirst === enteredFirst && memberLast === enteredLast)
          : false;

        const [lastVisit, photo] = await Promise.all([
          getLastCheckin(club.clubNumber, memberId).catch(() => null),
          hasPhoto(club.clubNumber, memberId).catch(() => false),
        ]);

        return {
          abc_member_id: memberId,
          first_name:    personal.firstName || '',
          last_name:     personal.lastName  || '',
          member_status: norm(member.memberStatus || personal.memberStatus || ''),
          last_visit:    lastVisit,
          has_photo:     !!photo,
          match_via:     [viaPhone && 'phone', viaEmail && 'email'].filter(Boolean),
          name_matches:  nameMatches,
        };
      })
    );

    let match = 'partial';
    if (candidates.length === 1
        && candidates[0].match_via.length >= 2
        && candidates[0].name_matches) {
      match = 'exact';
    }

    return res.json({ ok: true, match, candidates });
  } catch (err) {
    console.error('[kiosk/lookup]', (err.response && err.response.data) || err.message);
    return res.status(500).json({ ok: false, error: (err.response && err.response.data) || err.message });
  }
});

// ---- Day One booked detector (custom-field based) ----
//
// WCS already has a GHL workflow that sets a "Day One Booked" custom field
// on the contact when a Day One appointment is created. The kiosk just
// polls this endpoint while on the Day One step; when the field flips to
// truthy, we know they booked and can advance.
//
// Configurable via env. The default key list below covers both the
// "fieldKey" and "contact." prefixed shape that GHL returns inconsistently
// across endpoints. Override with KIOSK_DAY_ONE_FIELD_KEYS as a comma-
// separated list (e.g. "day_one_booked,contact.day_one_booked") if your
// field key differs.
// WCS uses a "Day One Booked" custom field on the contact, set by a
// workflow when a Day One appointment is created. Values are yes/no.
// Match against both fieldKey shapes GHL returns (with or without
// the `contact.` prefix).
const DAY_ONE_FIELD_KEYS = (process.env.KIOSK_DAY_ONE_FIELD_KEYS
  ? process.env.KIOSK_DAY_ONE_FIELD_KEYS.split(',')
  : [
      'day_one_booked',
      'contact.day_one_booked',
    ]
).map(s => s.trim().toLowerCase()).filter(Boolean);

// Optional companion field keys used for date/time + assigned trainer if
// they exist (also override-able via env).
const DAY_ONE_DATE_KEYS = (process.env.KIOSK_DAY_ONE_DATE_FIELD_KEYS
  ? process.env.KIOSK_DAY_ONE_DATE_FIELD_KEYS.split(',')
  : [
      'day_one_date',
      'contact.day_one_date',
      'day_one_appointment_date',
      'contact.day_one_appointment_date',
    ]
).map(s => s.trim().toLowerCase()).filter(Boolean);

const DAY_ONE_TRAINER_KEYS = (process.env.KIOSK_DAY_ONE_TRAINER_FIELD_KEYS
  ? process.env.KIOSK_DAY_ONE_TRAINER_FIELD_KEYS.split(',')
  : [
      'day_one_trainer',
      'contact.day_one_trainer',
      'day_one_booking_team_member',
      'contact.day_one_booking_team_member',
    ]
).map(s => s.trim().toLowerCase()).filter(Boolean);

// Cache custom-field-defs (id -> fieldKey) per club for 30 minutes.
const fieldDefsCache = new Map(); // slug -> { at, byId: { [id]: 'key' } }

async function getFieldDefMap(club, slug) {
  const cached = fieldDefsCache.get(slug);
  if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.byId;
  try {
    const r = await axios.get(
      `${GHL_BASE_URL}/locations/${club.ghlLocationId}/customFields`,
      {
        headers: {
          Authorization: `Bearer ${club.ghlApiKey}`,
          Version:       GHL_API_VERSION,
          Accept:        'application/json',
        },
        timeout: 10000,
      }
    );
    const list = (r.data && (r.data.customFields || r.data.fields)) || [];
    const byId = {};
    list.forEach(d => {
      const k = d.fieldKey || d.key || d.name;
      if (d.id && k) byId[d.id] = String(k).toLowerCase();
    });
    fieldDefsCache.set(slug, { at: Date.now(), byId });
    return byId;
  } catch (e) {
    return {};
  }
}

function isTruthyFieldValue(v) {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  if (['no', 'false', '0', 'null', 'undefined'].includes(s)) return false;
  return true;
}

router.get('/api/kiosk/check-day-one', async (req, res) => {
  try {
    const slug = String(req.query.location || '').toLowerCase().trim();
    const club = clubBySlug(slug);
    if (!club) return res.status(400).json({ ok: false, error: 'unknown_location' });

    const phone = String(req.query.phone || '').trim();
    const email = String(req.query.email || '').trim().toLowerCase();
    if (!phone && !email) return res.status(400).json({ ok: false, error: 'missing_lookup_input' });

    const ghlHeaders = {
      Authorization: `Bearer ${club.ghlApiKey}`,
      Version:       GHL_API_VERSION,
      Accept:        'application/json',
    };

    // 1. Find contact by phone (fall back to email).
    let contact = null;
    try {
      if (phone) {
        const resp = await axios.get(`${GHL_BASE_URL}/contacts/search/duplicate`, {
          params:  { locationId: club.ghlLocationId, number: e164(phone) },
          headers: ghlHeaders,
          timeout: 10000,
          validateStatus: s => (s >= 200 && s < 300) || s === 404,
        });
        contact = resp.data && (resp.data.contact || (resp.data.contacts && resp.data.contacts[0]));
      }
      if (!contact && email) {
        const resp = await axios.get(`${GHL_BASE_URL}/contacts/search/duplicate`, {
          params:  { locationId: club.ghlLocationId, email },
          headers: ghlHeaders,
          timeout: 10000,
          validateStatus: s => (s >= 200 && s < 300) || s === 404,
        });
        contact = resp.data && (resp.data.contact || (resp.data.contacts && resp.data.contacts[0]));
      }
    } catch (e) {
      // best-effort — frontend will keep polling
    }

    if (!contact || !contact.id) {
      return res.json({ ok: true, contact_found: false, day_one_booked: false });
    }

    // 2. Build keyed view of contact's custom fields and look up the flag(s).
    const cf = (contact.customFields || []).slice();
    const defsById = await getFieldDefMap(club, slug);

    function findValueByKeys(targetKeys) {
      const set = new Set(targetKeys.map(k => k.toLowerCase()));
      for (const f of cf) {
        const id = f.id;
        const fk = (defsById[id] || f.fieldKey || f.key || '').toLowerCase();
        const stripped = fk.replace(/^contact\./, '');
        if (set.has(fk) || set.has(stripped)) {
          return f.value != null ? f.value : (f.fieldValue != null ? f.fieldValue : '');
        }
      }
      return null;
    }

    const flag    = findValueByKeys(DAY_ONE_FIELD_KEYS);
    const dateVal = findValueByKeys(DAY_ONE_DATE_KEYS);
    const trainer = findValueByKeys(DAY_ONE_TRAINER_KEYS);

    return res.json({
      ok:                    true,
      contact_found:         true,
      contact_id:            contact.id,
      day_one_booked:        isTruthyFieldValue(flag),
      day_one_datetime:      dateVal ? String(dateVal) : '',
      day_one_employee_name: trainer ? String(trainer) : '',
    });
  } catch (err) {
    console.error('[kiosk/check-day-one]', (err.response && err.response.data) || err.message);
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

      day_one_booked:        String(dayOne.booked || 'no'),
      day_one_datetime:      String(dayOne.datetime || ''),
      day_one_employee_name: String(dayOne.employeeName || ''),

      tour_outcome: String(body.tourOutcome || ''),
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
