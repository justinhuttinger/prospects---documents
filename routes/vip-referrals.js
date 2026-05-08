// VIP Referrals — receives a referral submission from the public widget,
// fans out to a per-club inbound GHL webhook (one POST per VIP). Also
// exposes a per-club employee dropdown source for the widget.
//
// Mounted from index.js.
//
// Routes:
//   GET  /api/vip-referrals/employees?location=<slug>
//        -> [{ id, name }, ...]    (cached 5 min)
//   POST /webhooks/vip-referrals
//        body: {
//          location: "salem",
//          member:   { firstName, lastName, phone, email|null },
//          employee: { id, name },
//          vips:     [{ firstName, lastName, phone }, ... 1..5]
//          submittedAt: ISO-8601
//        }
//        -> { ok, fired, total, results: [...] }
//
// Per-club config in clubs-config.json:
//   vipReferralWebhookUrl   GHL inbound webhook URL for the "Create VIP
//                           Referral Contact" workflow in that location.
//                           One POST per VIP is sent here with the VIP +
//                           referrer + employee + location metadata.

const express = require('express');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();

const GHL_BASE_URL    = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const EMPLOYEES_TTL_MS = 5 * 60 * 1000;

const CLUBS_FILE = path.join(__dirname, '..', 'clubs-config.json');

// ---- Helpers ----
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

// ---- CORS (widget runs on a GHL website domain) ----
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- Employees endpoint (GHL /users/ per location, lightly cached) ----
const employeesCache = new Map(); // slug -> { at, list }

router.get('/api/vip-referrals/employees', async (req, res) => {
  try {
    const slug = String(req.query.location || '').toLowerCase().trim();
    const club = clubBySlug(slug);
    if (!club) return res.status(400).json({ ok: false, error: 'unknown_location', location: slug });

    const cached = employeesCache.get(slug);
    if (cached && Date.now() - cached.at < EMPLOYEES_TTL_MS) {
      return res.json(cached.list);
    }

    const resp = await axios.get(`${GHL_BASE_URL}/users/`, {
      params:  { locationId: club.ghlLocationId },
      headers: {
        Authorization: `Bearer ${club.ghlApiKey}`,
        Version:       GHL_API_VERSION,
        Accept:        'application/json'
      },
      timeout: 10000
    });

    const users = Array.isArray(resp.data) ? resp.data : (resp.data && resp.data.users) || [];
    const list = users
      .map(u => ({
        id:   u.id,
        name: (u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || '').trim()
      }))
      .filter(u => u.id && u.name)
      .sort((a, b) => a.name.localeCompare(b.name));

    employeesCache.set(slug, { at: Date.now(), list });
    return res.json(list);
  } catch (err) {
    console.error('[vip-referrals/employees]', err.response?.data || err.message);
    return res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

// ---- Submission endpoint (fan-out to GHL inbound webhook) ----
router.post('/webhooks/vip-referrals', async (req, res) => {
  try {
    const body = req.body || {};
    const slug = String(body.location || '').toLowerCase().trim();
    const club = clubBySlug(slug);
    if (!club) return res.status(400).json({ ok: false, error: 'unknown_location', location: slug });

    const inboundUrl = club.vipReferralWebhookUrl;
    if (!inboundUrl) {
      return res.status(500).json({
        ok: false,
        error: 'missing_inbound_webhook_url',
        hint: `Set "vipReferralWebhookUrl" for ${club.clubName} in clubs-config.json`
      });
    }

    const member   = body.member   || {};
    const employee = body.employee || {};
    const vips     = Array.isArray(body.vips) ? body.vips : [];
    if (!vips.length) return res.status(400).json({ ok: false, error: 'no_vips' });

    const refFirst = String(member.firstName || '').trim();
    const refLast  = String(member.lastName  || '').trim();
    const refPhone = e164(member.phone);
    const refEmail = String(member.email || '').trim().toLowerCase() || null;
    if (!refFirst || !refLast || !refPhone) {
      return res.status(400).json({ ok: false, error: 'missing_member' });
    }

    const results = [];
    for (const v of vips) {
      const firstName = String(v.firstName || '').trim();
      const lastName  = String(v.lastName  || '').trim();
      const phone     = e164(v.phone);
      if (!firstName || !lastName || !phone) {
        results.push({ ok: false, skipped: 'incomplete', vip: { firstName, lastName, phone } });
        continue;
      }

      const payload = {
        first_name: firstName,
        last_name:  lastName,
        phone:      phone,

        // Referrer info — flat keys so GHL Inbound Webhook custom-data mapping is simple
        referred_by_first_name: refFirst,
        referred_by_last_name:  refLast,
        referred_by_full_name:  `${refFirst} ${refLast}`,
        referred_by_phone:      refPhone,
        referred_by_email:      refEmail,

        // Employee that took the referral
        referral_employee_id:   employee.id   || '',
        referral_employee_name: employee.name || '',

        // Location metadata (handy for naming/filtering inside GHL)
        club:             club.clubName,
        location_slug:    slug,
        ghl_location_id:  club.ghlLocationId,

        source:        'VIP Survey',
        submitted_at:  body.submittedAt || new Date().toISOString()
      };

      try {
        const resp = await axios.post(inboundUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        });
        results.push({
          ok:     true,
          status: resp.status,
          name:   `${firstName} ${lastName}`
        });
      } catch (e) {
        results.push({
          ok:     false,
          name:   `${firstName} ${lastName}`,
          status: e.response?.status,
          error:  e.response?.data || e.message
        });
      }
    }

    const fired = results.filter(r => r.ok).length;
    return res.json({ ok: true, fired, total: vips.length, created: fired, results });
  } catch (err) {
    console.error('[vip-referrals]', err.response?.data || err.message);
    return res.status(500).json({ ok: false, error: err.response?.data || err.message });
  }
});

module.exports = router;
