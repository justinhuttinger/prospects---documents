// routes/vip-referrals-admin.js
// /api/admin/vip-referrals/* — admin tracking for VIP referrals.
// Mounted behind requireAdmin + CORS shim in index.js (mirrors online-join-admin).
const express = require('express');
const fs = require('fs');
const path = require('path');
let store = require('../services/vip-referrals/store');
const { fireRecipient } = require('../services/vip-referrals/fanout');

const CLUBS_FILE = path.join(__dirname, '..', 'clubs-config.json');
function clubBySlug(slug) {
  try {
    const clubs = JSON.parse(fs.readFileSync(CLUBS_FILE, 'utf8')).clubs || [];
    const norm = String(slug || '').toLowerCase().trim();
    return clubs.find(c => c.clubName && c.clubName.toLowerCase() === norm) || null;
  } catch { return null; }
}

const router = express.Router();
function __setStoreForTest(s) { store = s; }

function handleError(res, err, ctx) {
  console.error(`[vip-referrals-admin] ${ctx}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
}

router.get('/submissions', async (req, res) => {
  try {
    const { location, from, to, status } = req.query;
    res.json(await store.listSubmissions({ location, from, to, status }));
  } catch (e) { handleError(res, e, 'list'); }
});

router.get('/submissions/:id', async (req, res) => {
  try { res.json(await store.getSubmission(req.params.id)); }
  catch (e) { handleError(res, e, 'detail'); }
});

router.post('/recipients/:id/retry', async (req, res) => {
  try {
    const rec = await store.getRecipient(req.params.id);
    if (!rec) return res.status(404).json({ error: 'recipient_not_found' });
    const { submission } = await store.getSubmission(rec.submission_id);
    const cfg = await store.getLocationConfig(submission.location_slug);
    const url = (cfg && cfg.webhook_url) || rec.webhook_url_used;
    if (!url) return res.status(400).json({ error: 'no_webhook_url' });

    const club = clubBySlug(submission.location_slug);
    const payload = {
      first_name: rec.first_name, last_name: rec.last_name, phone: rec.phone,
      referred_by_first_name: submission.referrer_first_name,
      referred_by_last_name: submission.referrer_last_name,
      referred_by_full_name: `${submission.referrer_first_name || ''} ${submission.referrer_last_name || ''}`.trim(),
      referred_by_phone: submission.referrer_phone,
      referred_by_email: submission.referrer_email,
      referred_by_contact_id: submission.referrer_ghl_contact_id || '',
      referred_by_abc_member_id: submission.referrer_abc_member_id || '',
      referral_employee_id: submission.employee_id || '',
      referral_employee_name: submission.employee_name || '',
      club: club ? club.clubName : submission.location_slug,
      location_slug: submission.location_slug,
      ghl_location_id: club ? club.ghlLocationId : '',
      source: 'VIP Survey (retry)', submitted_at: new Date().toISOString(),
    };
    const r = await fireRecipient(url, payload);
    await store.recordRecipientResult(rec.id, {
      fanout_status: r.ok ? 'sent' : 'failed', http_status: r.http_status,
      error_detail: r.error_detail, webhook_url_used: url,
      attempt_count: (rec.attempt_count || 0) + r.attempt_count,
    });
    const status = await store.recomputeSubmissionStatus(rec.submission_id);
    res.json({ ok: r.ok, recipient_id: rec.id, submission_status: status });
  } catch (e) { handleError(res, e, 'retry'); }
});

router.get('/config', async (req, res) => {
  try { res.json(await store.listConfig()); }
  catch (e) { handleError(res, e, 'config-list'); }
});

router.patch('/config/:slug', async (req, res) => {
  try {
    const patch = {};
    for (const k of ['abc_club_number', 'webhook_url', 'enabled']) if (k in req.body) patch[k] = req.body[k];
    res.json(await store.updateConfig(req.params.slug, patch));
  } catch (e) { handleError(res, e, 'config-update'); }
});

module.exports = router;
module.exports.__setStoreForTest = __setStoreForTest;
