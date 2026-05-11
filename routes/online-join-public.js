/**
 * /api/online-join/* — public endpoints called by the WordPress widget.
 * No auth required. CORS handled at the Express level.
 *
 * Phase 4a (this file): GET /config/:locationId, POST /eligibility
 * Phase 4b (next session): POST /start, POST /submit
 */

const express = require('express');
const { loadPublicConfig } = require('../services/online-join/config-loader');
const { evaluateEligibility } = require('../services/online-join/eligibility');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/online-join/config/:locationId
// Returns location + active plans + copy. 60s in-memory cache; admin writes
// invalidate.
// ---------------------------------------------------------------------------
router.get('/config/:locationId', async (req, res) => {
  try {
    const payload = await loadPublicConfig(req.params.locationId);
    if (!payload) return res.status(404).json({ error: 'Location not found or inactive' });
    res.json(payload);
  } catch (err) {
    console.error('[online-join-public] /config error:', err.message);
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/online-join/eligibility
// Body: { plan_id, birthday: 'YYYY-MM-DD' }
// Returns:
//   { eligible: true }
//   { eligible: false, ineligible_message, suggested_plans: [...] }
// ---------------------------------------------------------------------------
router.post('/eligibility', async (req, res) => {
  try {
    const { plan_id, birthday } = req.body || {};
    const result = await evaluateEligibility({ planId: plan_id, birthday });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    console.error('[online-join-public] /eligibility error:', err.message);
    res.status(status).json({ error: err.message || 'Eligibility check failed' });
  }
});

// ---------------------------------------------------------------------------
// Placeholder stubs so the widget can wire against the real path even before
// Phase 4b lands. Both return 501 with a clear message.
// ---------------------------------------------------------------------------
router.post('/start', (req, res) => {
  res.status(501).json({ error: 'Not yet implemented — Phase 4b coming soon' });
});
router.post('/submit', (req, res) => {
  res.status(501).json({ error: 'Not yet implemented — Phase 4b coming soon' });
});

module.exports = router;
