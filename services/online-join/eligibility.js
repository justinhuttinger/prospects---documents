/**
 * Server-side age-rule evaluation. The widget runs this client-side for UX,
 * but /start re-runs it server-side because client checks are advisory.
 *
 * Compute age from birthday vs today in UTC. Returns:
 *   { eligible: true }
 *   { eligible: false, ineligible_message, suggested_plans: [...] }
 *
 * "Suggested plans" are other ACTIVE plans at the same location whose
 * age rule the user IS eligible for. This is the no-dead-ends UX (spec §7.3).
 */

const { getSupabaseAdmin } = require('../../lib/supabase');

function ageFromBirthday(birthday) {
  // birthday is YYYY-MM-DD
  const m = String(birthday || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const today = new Date();
  let age = today.getUTCFullYear() - y;
  const monthDiff = (today.getUTCMonth() + 1) - mo;
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < d)) age -= 1;
  return age;
}

function ageMatchesRule(age, rule) {
  if (!rule) return true;
  if (rule.min_age != null && age < rule.min_age) return false;
  if (rule.max_age != null && age > rule.max_age) return false;
  return true;
}

/**
 * Loads the plan (with age_rule), evaluates eligibility, and on rejection
 * gathers the suggested alternate plans at the same location.
 */
async function evaluateEligibility({ planId, birthday }) {
  if (!planId) throw Object.assign(new Error('plan_id is required'), { status: 400 });
  if (!birthday) throw Object.assign(new Error('birthday is required'), { status: 400 });

  const age = ageFromBirthday(birthday);
  if (age == null || age < 0 || age > 120) {
    throw Object.assign(new Error('birthday must be a valid YYYY-MM-DD date'), { status: 400 });
  }

  const sb = getSupabaseAdmin();

  const { data: plan, error: planErr } = await sb
    .from('online_join_plans')
    .select(`
      id, wcs_location_id, plan_key, plan_label, active,
      age_rule:age_rule_id ( id, name, min_age, max_age, ineligible_message )
    `)
    .eq('id', planId)
    .maybeSingle();
  if (planErr) throw new Error(`Plan lookup failed: ${planErr.message}`);
  if (!plan || !plan.active) throw Object.assign(new Error('Plan not found or inactive'), { status: 404 });

  const rule = plan.age_rule;
  if (ageMatchesRule(age, rule)) return { eligible: true };

  // Ineligible — gather other active plans at this location whose rule the user passes.
  const { data: peers } = await sb
    .from('online_join_plans')
    .select(`
      id, plan_key, plan_label, today_amount, monthly_amount, display_order,
      age_rule:age_rule_id ( min_age, max_age )
    `)
    .eq('wcs_location_id', plan.wcs_location_id)
    .eq('active', true)
    .neq('id', plan.id)
    .order('display_order');

  const suggested = (peers || [])
    .filter(p => ageMatchesRule(age, p.age_rule))
    .map(p => ({
      id: p.id,
      plan_key: p.plan_key,
      plan_label: p.plan_label,
      today_amount: parseFloat(p.today_amount),
      monthly_amount: parseFloat(p.monthly_amount),
    }));

  return {
    eligible: false,
    ineligible_message: rule.ineligible_message,
    suggested_plans: suggested,
  };
}

module.exports = { evaluateEligibility, ageFromBirthday, ageMatchesRule };
