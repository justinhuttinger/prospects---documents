/**
 * Build the public config payload for /api/online-join/config/:locationId.
 *
 * v2 shape: returns the location + a `types[]` array (membership types with
 * their amenities + a `terms[]` child list), plus flattened copy. ABC-side
 * fields (payment_plan_id*, plan_validation_hash, campaign_id, sales_person_id)
 * are stripped — those stay server-side per spec §4.1. Only our own row ids
 * (`plan_id` per term) cross the wire.
 *
 * Promo gating: a type with a promo_code is excluded unless `promo` matches it
 * AND now falls inside the optional [promo_starts_at, promo_ends_at] window.
 * Types with promo_code NULL are always included.
 *
 * Cached for 60s via services/online-join/cache, keyed by `${locationId}|${promo}`
 * so a promo'd view and the normal view don't share a cache entry. Admin writes
 * invalidate.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');
const cache = require('./cache');

function num(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// Decide whether a promo-gated type should be visible right now.
function promoVisible(type, promo, nowMs) {
  if (!type.promo_code) return true;               // normal type — always shown
  if (!promo || String(promo) !== String(type.promo_code)) return false;
  if (type.promo_starts_at && nowMs < Date.parse(type.promo_starts_at)) return false;
  if (type.promo_ends_at && nowMs > Date.parse(type.promo_ends_at)) return false;
  return true;
}

async function loadPublicConfig(locationId, promo = null) {
  const cacheKey = `${locationId}|${promo || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const sb = getSupabaseAdmin();

  const { data: location, error: locErr } = await sb
    .from('online_join_locations')
    .select('wcs_location_id, display_name, address_line1, address_line2, city, state, zip, phone, hours_summary, day_one_booking_url, hero_headline, hero_subhead, active')
    .eq('wcs_location_id', locationId)
    .maybeSingle();
  if (locErr) throw new Error(`Location lookup failed: ${locErr.message}`);
  if (!location || !location.active) return null; // 404 from route layer

  // Membership types for this location, ordered for display.
  const { data: types, error: typesErr } = await sb
    .from('online_join_membership_types')
    .select(`
      id, type_key, type_label, description, features, badge, display_order,
      promo_code, promo_starts_at, promo_ends_at,
      age_rule:age_rule_id ( id, name, min_age, max_age, ineligible_message )
    `)
    .eq('wcs_location_id', locationId)
    .eq('active', true)
    .order('display_order')
    .order('type_label');
  if (typesErr) throw new Error(`Type lookup failed: ${typesErr.message}`);

  // Active plans for this location, grouped into their type below.
  const { data: plans, error: plansErr } = await sb
    .from('online_join_plans')
    .select(`
      id, membership_type_id, term, enrollment_fee, display_order,
      today_amount, monthly_amount,
      today_amount_ach, monthly_amount_ach, payment_plan_id_ach
    `)
    .eq('wcs_location_id', locationId)
    .eq('active', true)
    .order('display_order');
  if (plansErr) throw new Error(`Plan lookup failed: ${plansErr.message}`);

  const { data: copyRows, error: copyErr } = await sb
    .from('online_join_copy')
    .select('copy_key, copy_value');
  if (copyErr) throw new Error(`Copy lookup failed: ${copyErr.message}`);
  const copy = Object.fromEntries((copyRows || []).map(r => [r.copy_key, r.copy_value]));

  // Group plans by type, shaping each into a public "term" object. ACH amounts
  // only surface when the plan has an ACH variant configured; the ACH
  // payment_plan_id itself never crosses the wire (has_ach_variant is the flag).
  const termsByType = new Map();
  for (const p of plans || []) {
    if (!p.membership_type_id || !p.term) continue; // unassigned plan — skip
    const hasAch = !!p.payment_plan_id_ach;
    const term = {
      plan_id: p.id,
      term: p.term,
      enrollment_fee: num(p.enrollment_fee),
      cc: { today: num(p.today_amount), monthly: num(p.monthly_amount) },
      ach: hasAch
        ? {
            today: p.today_amount_ach != null ? num(p.today_amount_ach) : num(p.today_amount),
            monthly: p.monthly_amount_ach != null ? num(p.monthly_amount_ach) : num(p.monthly_amount),
          }
        : null,
      has_ach_variant: hasAch,
      display_order: p.display_order,
    };
    if (!termsByType.has(p.membership_type_id)) termsByType.set(p.membership_type_id, []);
    termsByType.get(p.membership_type_id).push(term);
  }

  // Sort each type's terms: 1-Year first, then M2M, then anything else.
  const TERM_ORDER = { '1yr': 0, 'm2m': 1 };
  const nowMs = Date.parse(new Date().toISOString());

  const publicTypes = (types || [])
    .filter(t => promoVisible(t, promo, nowMs))
    .map(t => {
      const terms = (termsByType.get(t.id) || []).sort((a, b) => {
        const ao = TERM_ORDER[a.term] ?? 9;
        const bo = TERM_ORDER[b.term] ?? 9;
        if (ao !== bo) return ao - bo;
        return (a.display_order || 0) - (b.display_order || 0);
      });
      return {
        id: t.id,
        type_key: t.type_key,
        type_label: t.type_label,
        description: t.description,
        features: t.features || [],
        badge: t.badge || null,
        is_promo: !!t.promo_code,
        age_rule: t.age_rule || null,
        terms,
      };
    })
    // A type with no active/assigned terms has nothing to sell — hide it.
    .filter(t => t.terms.length > 0);

  const payload = {
    location: {
      wcs_location_id: location.wcs_location_id,
      display_name: location.display_name,
      address_line1: location.address_line1,
      address_line2: location.address_line2,
      city: location.city,
      state: location.state,
      zip: location.zip,
      phone: location.phone,
      hours_summary: location.hours_summary,
      day_one_booking_url: location.day_one_booking_url,
      hero_headline: location.hero_headline,
      hero_subhead: location.hero_subhead,
    },
    types: publicTypes,
    copy,
  };

  cache.set(cacheKey, payload);
  return payload;
}

module.exports = { loadPublicConfig };
