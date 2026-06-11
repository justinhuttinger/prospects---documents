const { test } = require('node:test');
const assert = require('node:assert');
const { buildAgreementPayload } = require('../services/online-join/abc-agreement');

const baseSignup = {
  first_name: 'Test', last_name: 'Member', email: 't@t.com', cell_phone: '5035551212',
  birthday: '2000-01-01', gender: 'M',
  address_line1: '1 Main', city: 'Clackamas', state: 'OR', zip_code: '97015',
  emergency_contact: {}, payment_method_choice: 'card',
  paypage_today_transaction_id: 'tok-today', paypage_draft_transaction_id: 'tok-draft',
  paypage_payment_type: 'Credit Card', paypage_draft_payment_type: 'Credit Card',
  plan_validation_hash: 'hash123',
};
const basePlan = { payment_plan_id: 'plan-1', plan_validation_hash: 'hash123' };

test('sends schedules as a flat array of profit-center names (List<String>)', () => {
  const signup = { ...baseSignup, abc_addon_schedules: ['Cc convenience fee'] };
  const payload = buildAgreementPayload(signup, basePlan);
  assert.deepStrictEqual(payload.schedules, ['Cc convenience fee']);
});

test('sends profit-center names verbatim (case-sensitive)', () => {
  const signup = { ...baseSignup, abc_addon_schedules: ['CC CONVENIENCE FEE'] };
  const payload = buildAgreementPayload(signup, basePlan);
  assert.deepStrictEqual(payload.schedules, ['CC CONVENIENCE FEE']);
});

test('omits schedules entirely when none captured', () => {
  for (const v of [undefined, [], null]) {
    const signup = { ...baseSignup, abc_addon_schedules: v };
    const payload = buildAgreementPayload(signup, basePlan);
    assert.ok(!('schedules' in payload), `schedules should be absent for ${JSON.stringify(v)}`);
  }
});
