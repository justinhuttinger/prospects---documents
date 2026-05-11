/**
 * Build the public config payload for /api/online-join/config/:locationId.
 *
 * Returns the location row + active plans (with age_rule expanded) + all copy
 * keys flattened to a { copy_key: copy_value } object. ABC-side fields
 * (payment_plan_id, plan_validation_hash, campaign_id, sales_person_id) are
 * stripped — those stay server-side per spec §4.1.
 *
 * Cached for 60s via services/online-join/cache. Admin writes invalidate.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');
const cache = require('./cache');

async function loadPublicConfig(locationId) {
  const cached = cache.get(locationId);
  if (cached) return cached;

  const sb = getSupabaseAdmin();

  const { data: location, error: locErr } = await sb
    .from('online_join_locations')
    .select('wcs_location_id, display_name, address_line1, address_line2, city, state, zip, phone, hours_summary, day_one_booking_url, hero_headline, hero_subhead, active')
    .eq('wcs_location_id', locationId)
    .maybeSingle();
  if (locErr) throw new Error(`Location lookup failed: ${locErr.message}`);
  if (!location || !location.active) return null; // 404 from route layer

  const { data: plans, error: plansErr } = await sb
    .from('online_join_plans')
    .select(`
      id, plan_key, plan_label, plan_description, features, badge,
      today_amount, monthly_amount, display_order,
      age_rule:age_rule_id ( id, name, min_age, max_age, ineligible_message )
    `)
    .eq('wcs_location_id', locationId)
    .eq('active', true)
    .order('display_order')
    .order('plan_label');
  if (plansErr) throw new Error(`Plan lookup failed: ${plansErr.message}`);

  const { data: copyRows, error: copyErr } = await sb
    .from('online_join_copy')
    .select('copy_key, copy_value');
  if (copyErr) throw new Error(`Copy lookup failed: ${copyErr.message}`);
  const copy = Object.fromEntries((copyRows || []).map(r => [r.copy_key, r.copy_value]));

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
    plans: (plans || []).map(p => ({
      id: p.id,
      plan_key: p.plan_key,
      plan_label: p.plan_label,
      plan_description: p.plan_description,
      features: p.features || [],
      badge: p.badge || null,
      today_amount: parseFloat(p.today_amount),
      monthly_amount: parseFloat(p.monthly_amount),
      display_order: p.display_order,
      age_rule: p.age_rule || null,
    })),
    copy,
  };

  cache.set(locationId, payload);
  return payload;
}

module.exports = { loadPublicConfig };
