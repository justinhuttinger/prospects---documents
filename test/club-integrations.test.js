// Tests for the club_integrations reader.
//
// The whole point of this module is that it degrades safely: a missing table, a
// missing row, a blank column, or a Supabase outage must all fall back to
// clubs-config.json rather than dropping a webhook on the floor. That is what
// these cover.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SUPABASE_MODULE = path.join(__dirname, '..', 'lib', 'supabase.js');

// Stub lib/supabase before the reader loads it.
let rows = [];
let queryError = null;
let queryCount = 0;

require.cache[require.resolve(SUPABASE_MODULE)] = {
  id: SUPABASE_MODULE,
  filename: SUPABASE_MODULE,
  loaded: true,
  exports: {
    getSupabaseAdmin: () => ({
      from: () => ({
        select: async () => {
          queryCount += 1;
          if (queryError) throw new Error(queryError);
          return { data: rows, error: null };
        },
      }),
    }),
  },
};

const { resolveWebhookUrl, invalidate, FIELD_TO_COLUMN } = require('../services/waiver/integrations');

const SALEM = {
  clubNumber: '30935',
  clubName: 'Salem',
  kioskWaiverLeadWebhookUrl: 'https://file.example.test/lead',
  kioskWaiverCompletedWebhookUrl: '',
  ptIntakeWebhookUrl: '',
};

test.beforeEach(() => {
  rows = [];
  queryError = null;
  queryCount = 0;
  invalidate();
});

test('a stored URL wins over the one in clubs-config.json', async () => {
  rows = [{
    abc_club_number: '30935',
    kiosk_waiver_lead_webhook_url: 'https://db.example.test/lead',
    active: true,
  }];

  const url = await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  assert.strictEqual(url, 'https://db.example.test/lead');
});

test('a blank column falls back to the file rather than clearing the webhook', async () => {
  rows = [{
    abc_club_number: '30935',
    kiosk_waiver_lead_webhook_url: '',
    active: true,
  }];

  const url = await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  assert.strictEqual(url, 'https://file.example.test/lead', 'blank means "not set here"');
});

test('a null column falls back to the file too', async () => {
  rows = [{ abc_club_number: '30935', kiosk_waiver_lead_webhook_url: null, active: true }];

  const url = await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  assert.strictEqual(url, 'https://file.example.test/lead');
});

test('a club with no row uses the file', async () => {
  rows = [{ abc_club_number: '99999', kiosk_waiver_lead_webhook_url: 'https://db.example.test/x', active: true }];

  const url = await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  assert.strictEqual(url, 'https://file.example.test/lead');
});

test('an inactive row is ignored', async () => {
  rows = [{
    abc_club_number: '30935',
    kiosk_waiver_lead_webhook_url: 'https://db.example.test/lead',
    active: false,
  }];

  const url = await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  assert.strictEqual(url, 'https://file.example.test/lead');
});

test('a Supabase outage falls back to the file instead of throwing', async () => {
  queryError = 'relation "club_integrations" does not exist';

  const url = await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  assert.strictEqual(url, 'https://file.example.test/lead', 'this ships before migration 075');
});

test('an outage does not turn into a query storm', async () => {
  queryError = 'connection refused';

  await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  await resolveWebhookUrl(SALEM, 'kioskWaiverCompletedWebhookUrl');
  await resolveWebhookUrl(SALEM, 'ptIntakeWebhookUrl');

  assert.strictEqual(queryCount, 1, 'the failure is cached for the TTL like any other result');
});

test('neither source configured yields an empty string, not undefined', async () => {
  const url = await resolveWebhookUrl(SALEM, 'ptIntakeWebhookUrl');
  assert.strictEqual(url, '', 'callers treat empty as "skip this webhook"');
});

test('repeated reads inside the TTL hit Supabase once', async () => {
  rows = [{ abc_club_number: '30935', kiosk_waiver_lead_webhook_url: 'https://db.example.test/a', active: true }];

  await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');

  assert.strictEqual(queryCount, 1);
});

test('invalidate forces the next read to go back to Supabase', async () => {
  rows = [{ abc_club_number: '30935', kiosk_waiver_lead_webhook_url: 'https://db.example.test/a', active: true }];
  await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');

  invalidate();
  rows = [{ abc_club_number: '30935', kiosk_waiver_lead_webhook_url: 'https://db.example.test/b', active: true }];

  const url = await resolveWebhookUrl(SALEM, 'kioskWaiverLeadWebhookUrl');
  assert.strictEqual(url, 'https://db.example.test/b');
  assert.strictEqual(queryCount, 2);
});

test('an unknown field name is a programming error, not a silent empty string', async () => {
  await assert.rejects(
    () => resolveWebhookUrl(SALEM, 'notAWebhook'),
    /Unknown webhook field/
  );
});

test('only integrations without their own editor are routed through here', () => {
  assert.deepStrictEqual(Object.keys(FIELD_TO_COLUMN).sort(), [
    'kioskWaiverCompletedWebhookUrl',
    'kioskWaiverLeadWebhookUrl',
    'ptIntakeWebhookUrl',
  ]);
  // VIP referrals owns vip_referral_config; the portal's Tour Check-In owns
  // tour_location_config. Adding either here would give one setting two editors.
  assert.ok(!('vipReferralWebhookUrl' in FIELD_TO_COLUMN));
  assert.ok(!('tourCompletedWebhookUrl' in FIELD_TO_COLUMN));
});
