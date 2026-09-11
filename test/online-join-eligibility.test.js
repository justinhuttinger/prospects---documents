const { test } = require('node:test');
const assert = require('node:assert');
const { suggestedPlans } = require('../services/online-join/eligibility');

const youth = { min_age: 13, max_age: 18 };
const plan = (over) => ({
  id: over.id, plan_key: over.id, plan_label: over.id, today_amount: '10', monthly_amount: '50',
  promo_code: null, age_rule: null, membership_type: { promo_code: null, age_rule: null }, ...over,
});

test('promo plans and plans under a promo type are never suggested', () => {
  const peers = [
    plan({ id: 'single-m2m' }),
    plan({ id: 'salempromo', membership_type: { promo_code: 'summer26', age_rule: null } }),
    plan({ id: 'promo-plan', promo_code: 'save130' }),
  ];
  assert.deepStrictEqual(suggestedPlans(peers, 30).map(p => p.id), ['single-m2m']);
});

test('only plans whose age rule fits are suggested', () => {
  const peers = [
    plan({ id: 'single-m2m' }),
    plan({ id: 'youth-m2m', membership_type: { promo_code: null, age_rule: youth } }),
  ];
  assert.deepStrictEqual(suggestedPlans(peers, 30).map(p => p.id), ['single-m2m']);
  assert.deepStrictEqual(suggestedPlans(peers, 15).map(p => p.id), ['single-m2m', 'youth-m2m']);
});
