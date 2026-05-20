/**
 * Resolve a plan row to its effective shape based on the member's payment-
 * method choice.
 *
 * ABC keeps separate paymentPlanId values for the Credit-Card and ACH
 * variants of the same logical plan (CC includes a convenience-fee profit
 * center; ACH doesn't). The DB stores both:
 *   - payment_plan_id / today_amount / monthly_amount      → CC variant
 *   - payment_plan_id_ach / today_amount_ach / monthly_amount_ach → ACH variant
 *
 * For ACH signups we return the *_ach values where they're set, falling
 * back to the CC values when the ACH columns are NULL (which is the case
 * for plans that haven't been configured for ACH yet — those are CC-only).
 *
 * The returned object is a shallow copy of the plan with payment_plan_id /
 * today_amount / monthly_amount overwritten, so downstream code (the
 * ABC agreement payload builder, the signed-PDF generator, etc.) can read
 * `effective.payment_plan_id` and `effective.monthly_amount` directly
 * without needing to know which variant it picked.
 *
 * The marker `_variant: 'ach' | 'cc'` is attached for logging only.
 */

function resolveEffectivePlan(plan, paymentMethodChoice) {
  if (!plan) return plan;
  const wantsAch = paymentMethodChoice === 'ach';
  if (wantsAch && plan.payment_plan_id_ach) {
    return {
      ...plan,
      payment_plan_id: plan.payment_plan_id_ach,
      today_amount: plan.today_amount_ach != null ? plan.today_amount_ach : plan.today_amount,
      monthly_amount: plan.monthly_amount_ach != null ? plan.monthly_amount_ach : plan.monthly_amount,
      _variant: 'ach',
    };
  }
  return { ...plan, _variant: 'cc' };
}

module.exports = { resolveEffectivePlan };
