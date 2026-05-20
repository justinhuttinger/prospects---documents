/**
 * /api/admin/online-join/* — admin CRUD for the WCS Online Join data model.
 * All endpoints are gated by JWT + admin role via require-admin middleware
 * (mounted in index.js).
 *
 * Pattern:
 *   - All writes record `updated_by = req.staff.id`.
 *   - All writes invalidate the public config cache after a successful commit.
 *   - Soft-delete on locations + plans (active=false); hard-delete on
 *     age_rules (with usage guard) and copy is PATCH-only.
 *
 * Endpoints (see spec §5):
 *   GET    /locations                    list
 *   GET    /locations/:id                single
 *   POST   /locations                    create
 *   PATCH  /locations/:id                update
 *   DELETE /locations/:id                soft delete
 *
 *   GET    /plans                        list (?location=slug optional)
 *   GET    /plans/:id                    single
 *   POST   /plans                        create
 *   PATCH  /plans/:id                    update
 *   DELETE /plans/:id                    soft delete
 *
 *   GET    /age-rules                    list
 *   GET    /age-rules/:id                single (+ plan_count)
 *   POST   /age-rules                    create
 *   PATCH  /age-rules/:id                update
 *   DELETE /age-rules/:id                hard delete (guarded — refuses if plans reference)
 *
 *   GET    /copy                         list
 *   PATCH  /copy/:key                    update value
 *
 *   GET    /signups                      paginated, filterable (read-only)
 *   GET    /signups/:id                  single (+ errors)
 *
 *   POST   /cache/invalidate             clears all cached configs
 *
 *   GET    /abc-plans/:clubNumber        live proxy to ABC GET /clubs/plans
 *   GET    /abc-plans/:clubNumber/:planId  live proxy to ABC GET /clubs/plans/{planId}/details
 *                                         (used by Plans editor "Pull from ABC")
 */

const express = require('express');
const axios = require('axios');
const { getSupabaseAdmin } = require('../lib/supabase');
const cache = require('../services/online-join/cache');

const router = express.Router();

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

function abcHeaders() {
  const appId = process.env.ABC_APP_ID;
  const appKey = process.env.ABC_APP_KEY;
  if (!appId || !appKey) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  return { app_id: appId, app_key: appKey, Accept: 'application/json' };
}

function handleError(res, err, context) {
  const status = err.status || 500;
  console.error(`[online-join-admin] ${context}:`, err.message);
  res.status(status).json({ error: err.message || 'Server error' });
}

// Whitelist allowed body keys so a stray frontend field can't poison a row.
function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (k in obj) out[k] = obj[k];
  return out;
}

const LOCATION_FIELDS = [
  'display_name', 'address_line1', 'address_line2', 'city', 'state', 'zip',
  'phone', 'hours_summary', 'day_one_booking_url', 'hero_headline', 'hero_subhead',
  'ghl_location_id', 'abc_club_number', 'active',
];

const PLAN_FIELDS = [
  'wcs_location_id', 'plan_key',
  'plan_label', 'plan_description', 'features', 'badge',
  'today_amount', 'monthly_amount', 'enrollment_fee', 'display_order',
  'payment_plan_id', 'plan_validation_hash', 'campaign_id', 'sales_person_id',
  // ACH variant (optional; nullable values fall back to CC values in /start).
  'payment_plan_id_ach', 'today_amount_ach', 'monthly_amount_ach',
  'age_rule_id', 'active',
];

const AGE_RULE_FIELDS = ['name', 'min_age', 'max_age', 'ineligible_message', 'active'];

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------
router.get('/locations', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('online_join_locations').select('*').order('display_name');
    if (error) throw error;
    res.json({ locations: data || [] });
  } catch (err) { handleError(res, err, 'GET /locations'); }
});

router.get('/locations/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('online_join_locations').select('*').eq('wcs_location_id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Location not found' });
    res.json({ location: data });
  } catch (err) { handleError(res, err, 'GET /locations/:id'); }
});

router.post('/locations', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const body = pick(req.body, [...LOCATION_FIELDS, 'wcs_location_id']);
    if (!body.wcs_location_id || !body.display_name || !body.abc_club_number || !body.ghl_location_id) {
      return res.status(400).json({ error: 'wcs_location_id, display_name, abc_club_number, ghl_location_id are required' });
    }
    body.updated_by = req.staff.id;
    body.updated_at = new Date().toISOString();
    const { data, error } = await sb.from('online_join_locations').insert(body).select().single();
    if (error) throw error;
    cache.invalidateAll();
    res.status(201).json({ location: data });
  } catch (err) { handleError(res, err, 'POST /locations'); }
});

router.patch('/locations/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const body = pick(req.body, LOCATION_FIELDS);
    body.updated_by = req.staff.id;
    body.updated_at = new Date().toISOString();
    const { data, error } = await sb.from('online_join_locations').update(body).eq('wcs_location_id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Location not found' });
    cache.invalidate(req.params.id);
    res.json({ location: data });
  } catch (err) { handleError(res, err, 'PATCH /locations/:id'); }
});

router.delete('/locations/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('online_join_locations')
      .update({ active: false, updated_by: req.staff.id, updated_at: new Date().toISOString() })
      .eq('wcs_location_id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Location not found' });
    cache.invalidate(req.params.id);
    res.json({ location: data });
  } catch (err) { handleError(res, err, 'DELETE /locations/:id'); }
});

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------
router.get('/plans', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    let q = sb.from('online_join_plans')
      .select('*, age_rule:age_rule_id ( id, name, min_age, max_age )')
      .order('wcs_location_id').order('display_order').order('plan_label');
    if (req.query.location) q = q.eq('wcs_location_id', req.query.location);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ plans: data || [] });
  } catch (err) { handleError(res, err, 'GET /plans'); }
});

router.get('/plans/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('online_join_plans')
      .select('*, age_rule:age_rule_id ( id, name, min_age, max_age, ineligible_message )')
      .eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan: data });
  } catch (err) { handleError(res, err, 'GET /plans/:id'); }
});

router.post('/plans', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const body = pick(req.body, PLAN_FIELDS);
    // plan_validation_hash is no longer required at create time — /start
    // fetches it fresh from ABC at signup. Stored value is a fallback only
    // (see services/online-join/abc-plan-fetch.js).
    const required = ['wcs_location_id', 'plan_key', 'plan_label', 'today_amount', 'monthly_amount', 'payment_plan_id'];
    const missing = required.filter(k => body[k] == null || body[k] === '');
    if (missing.length) return res.status(400).json({ error: `Required: ${missing.join(', ')}` });
    body.updated_by = req.staff.id;
    body.updated_at = new Date().toISOString();
    const { data, error } = await sb.from('online_join_plans').insert(body).select().single();
    if (error) throw error;
    cache.invalidate(body.wcs_location_id);
    res.status(201).json({ plan: data });
  } catch (err) { handleError(res, err, 'POST /plans'); }
});

router.patch('/plans/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const body = pick(req.body, PLAN_FIELDS);
    body.updated_by = req.staff.id;
    body.updated_at = new Date().toISOString();
    const { data, error } = await sb.from('online_join_plans').update(body).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plan not found' });
    cache.invalidate(data.wcs_location_id);
    res.json({ plan: data });
  } catch (err) { handleError(res, err, 'PATCH /plans/:id'); }
});

router.delete('/plans/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('online_join_plans')
      .update({ active: false, updated_by: req.staff.id, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Plan not found' });
    cache.invalidate(data.wcs_location_id);
    res.json({ plan: data });
  } catch (err) { handleError(res, err, 'DELETE /plans/:id'); }
});

// ---------------------------------------------------------------------------
// Age rules
// ---------------------------------------------------------------------------
router.get('/age-rules', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('online_join_age_rules').select('*').order('name');
    if (error) throw error;
    res.json({ age_rules: data || [] });
  } catch (err) { handleError(res, err, 'GET /age-rules'); }
});

router.get('/age-rules/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: rule, error } = await sb.from('online_join_age_rules').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!rule) return res.status(404).json({ error: 'Age rule not found' });
    const { data: plansUsing } = await sb.from('online_join_plans')
      .select('id, plan_label, wcs_location_id, active')
      .eq('age_rule_id', req.params.id);
    res.json({ age_rule: rule, plans_using: plansUsing || [] });
  } catch (err) { handleError(res, err, 'GET /age-rules/:id'); }
});

router.post('/age-rules', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const body = pick(req.body, AGE_RULE_FIELDS);
    if (!body.name || !body.ineligible_message) return res.status(400).json({ error: 'name and ineligible_message are required' });
    const { data, error } = await sb.from('online_join_age_rules').insert(body).select().single();
    if (error) throw error;
    cache.invalidateAll();
    res.status(201).json({ age_rule: data });
  } catch (err) { handleError(res, err, 'POST /age-rules'); }
});

router.patch('/age-rules/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const body = pick(req.body, AGE_RULE_FIELDS);
    body.updated_at = new Date().toISOString();
    const { data, error } = await sb.from('online_join_age_rules').update(body).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Age rule not found' });
    cache.invalidateAll();
    res.json({ age_rule: data });
  } catch (err) { handleError(res, err, 'PATCH /age-rules/:id'); }
});

router.delete('/age-rules/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    // Guard: refuse if any ACTIVE plan references this rule.
    const { data: refs } = await sb.from('online_join_plans')
      .select('id, plan_label, wcs_location_id')
      .eq('age_rule_id', req.params.id)
      .eq('active', true);
    if ((refs || []).length > 0) {
      return res.status(409).json({
        error: 'Age rule is referenced by active plans — deactivate or reassign those plans first.',
        plans_using: refs,
      });
    }
    const { error } = await sb.from('online_join_age_rules').delete().eq('id', req.params.id);
    if (error) throw error;
    cache.invalidateAll();
    res.json({ deleted: true });
  } catch (err) { handleError(res, err, 'DELETE /age-rules/:id'); }
});

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------
router.get('/copy', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.from('online_join_copy').select('*').order('copy_key');
    if (error) throw error;
    res.json({ copy: data || [] });
  } catch (err) { handleError(res, err, 'GET /copy'); }
});

router.patch('/copy/:key', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { copy_value } = req.body;
    if (typeof copy_value !== 'string') return res.status(400).json({ error: 'copy_value (string) is required' });
    const { data, error } = await sb.from('online_join_copy')
      .update({ copy_value, updated_by: req.staff.id, updated_at: new Date().toISOString() })
      .eq('copy_key', req.params.key).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Copy key not found' });
    cache.invalidateAll();
    res.json({ copy: data });
  } catch (err) { handleError(res, err, 'PATCH /copy/:key'); }
});

// ---------------------------------------------------------------------------
// Signups (read-only)
// ---------------------------------------------------------------------------
router.get('/signups', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const from = (page - 1) * limit;
    let q = sb.from('online_signups').select('*', { count: 'exact' }).order('started_at', { ascending: false });
    if (req.query.location) q = q.eq('wcs_location_id', req.query.location);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.start_date) q = q.gte('started_at', req.query.start_date);
    if (req.query.end_date) q = q.lte('started_at', req.query.end_date + 'T23:59:59.999Z');
    q = q.range(from, from + limit - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ signups: data || [], page, limit, total: count || 0 });
  } catch (err) { handleError(res, err, 'GET /signups'); }
});

router.get('/signups/:id', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data: signup, error } = await sb.from('online_signups').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!signup) return res.status(404).json({ error: 'Signup not found' });
    const { data: errors } = await sb.from('online_signup_errors').select('*').eq('signup_id', req.params.id).order('occurred_at', { ascending: false });
    res.json({ signup, errors: errors || [] });
  } catch (err) { handleError(res, err, 'GET /signups/:id'); }
});

// ---------------------------------------------------------------------------
// Cache invalidation
// ---------------------------------------------------------------------------
router.post('/cache/invalidate', (req, res) => {
  cache.invalidateAll();
  res.json({ invalidated: true, ...cache.stats() });
});

// ---------------------------------------------------------------------------
// ABC plan discovery (used by Plans editor "Pull from ABC")
// ---------------------------------------------------------------------------
router.get('/abc-plans/:clubNumber', async (req, res) => {
  try {
    const r = await axios.get(`${ABC_BASE_URL}/${req.params.clubNumber}/clubs/plans`, {
      headers: abcHeaders(),
      timeout: 30000,
    });
    res.json(r.data);
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || err.message });
  }
});

router.get('/abc-plans/:clubNumber/:planId', async (req, res) => {
  // Call both ABC endpoints and merge — `/details` returns pricing + schedules
  // but no planValidation; the bare `/clubs/plans/{planId}` endpoint returns
  // the validation hash (see ABC POST Create Agreement docs rev 2025-08-12).
  const { clubNumber, planId } = req.params;
  try {
    const [planResp, detailsResp] = await Promise.allSettled([
      axios.get(`${ABC_BASE_URL}/${clubNumber}/clubs/plans/${planId}`, { headers: abcHeaders(), timeout: 30000 }),
      axios.get(`${ABC_BASE_URL}/${clubNumber}/clubs/plans/${planId}/details`, { headers: abcHeaders(), timeout: 30000 }),
    ]);
    if (planResp.status === 'rejected' && detailsResp.status === 'rejected') {
      const err = planResp.reason;
      const status = err.response?.status || 500;
      return res.status(status).json({ error: err.response?.data || err.message });
    }
    const planBody = planResp.status === 'fulfilled' ? planResp.value.data : null;
    const detailsBody = detailsResp.status === 'fulfilled' ? detailsResp.value.data : null;
    // Merge plan + details responses; pass through both raw bodies for the
    // picker's defensive field probing.
    res.json({
      ...(detailsBody?.response || detailsBody || {}),
      ...(planBody?.response || planBody || {}),
      _plan: planBody,
      _details: detailsBody,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({ error: err.response?.data || err.message });
  }
});

module.exports = router;
