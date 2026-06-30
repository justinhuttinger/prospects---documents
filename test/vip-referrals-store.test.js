// test/vip-referrals-store.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const store = require('../services/vip-referrals/store');

function fakeClient(tables) {
  // tables: { tableName: { rows:[], insertReturn, selectReturn, singleReturn, ... } }
  return {
    from(name) {
      const t = tables[name] || (tables[name] = { rows: [] });
      const q = {
        _filters: [],
        _afterInsert: false,
        insert(vals) { t.lastInsert = vals; q._afterInsert = true; return q; },
        update(vals) { t.lastUpdate = vals; return q; },
        upsert(vals) { t.lastUpsert = vals; return q; },
        select() { return q; },
        eq(col, val) { q._filters.push([col, val]); return q; },
        gte() { return q; },
        lte() { return q; },
        order() { return q; },
        single() { return Promise.resolve({ data: t.singleReturn ?? null, error: null }); },
        then(res) {
          const data = q._afterInsert ? (t.selectReturn ?? []) : (t.selectReturn ?? t.rows);
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      return q;
    },
  };
}

test('createSubmission inserts a submission and returns its id', async () => {
  const tables = {
    vip_referral_submissions: { singleReturn: { id: 'sub-1' } },
    vip_referral_recipients: { selectReturn: [{ id: 'rec-1' }] },
  };
  store.__setClientForTest(fakeClient(tables));
  const res = await store.createSubmission({
    location_slug: 'salem', audience: 'staff', vip_count: 2,
    recipients: [{ first_name: 'A', last_name: 'B', phone: '+15035551212', fanout_status: 'failed' }],
  });
  assert.equal(res.submissionId, 'sub-1');
  assert.deepEqual(res.recipientIds, ['rec-1']);
  assert.equal(tables.vip_referral_submissions.lastInsert.location_slug, 'salem');
  assert.ok(Array.isArray(tables.vip_referral_recipients.lastInsert));
});

test('getLocationConfig returns the row for a slug', async () => {
  store.__setClientForTest(fakeClient({
    vip_referral_config: { singleReturn: { location_slug: 'salem', webhook_url: 'https://x' } },
  }));
  const cfg = await store.getLocationConfig('salem');
  assert.equal(cfg.webhook_url, 'https://x');
});
