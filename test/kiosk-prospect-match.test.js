// Not creating a second PROSPECT for somebody who tried the gym before.
//
// abc_members holds join_status = 'Member' and nothing else, so the member
// lookup could never see a past trial. Anybody whose only ABC record was a
// prospect got a brand new one every visit -- three visits over a year, three
// profiles. These pin the prospect half of the lookup.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const axios = require('axios');

const ROOT = path.join(__dirname, '..');
const SEARCH = path.join(ROOT, 'services/kiosk/prospect-search.js');
const MEMBER_SEARCH = path.join(ROOT, 'services/kiosk/member-search.js');
const MATCH = path.join(ROOT, 'services/kiosk/match.js');

function withAbc(prospects, run) {
  const realGet = axios.get;
  const seen = [];
  axios.get = async (url, config) => {
    seen.push({ url, params: config && config.params });
    if (prospects instanceof Error) throw prospects;
    return { data: { prospects } };
  };
  delete require.cache[SEARCH];
  const mod = require(SEARCH);
  return run(mod, seen).finally(() => { axios.get = realGet; });
}

const prospect = (over = {}) => ({
  prospectId: 'p-1',
  personal: {
    firstName: 'Dana', lastName: 'Reid',
    email: 'dana@example.com', primaryPhone: '(503) 555-0147',
    ...over,
  },
});

test('a past trial is found by phone', async () => {
  await withAbc([prospect()], async ({ searchProspects }) => {
    const r = await searchProspects('30935', { phone: '5035550147' });
    assert.equal(r.byPhone.length, 1);
    assert.equal(r.byPhone[0].memberId, 'p-1');
    assert.equal(r.byPhone[0].isProspect, true);
  });
});

test('and by email, reported separately so agreement on both is visible', async () => {
  await withAbc([prospect()], async ({ searchProspects }) => {
    const r = await searchProspects('30935', { phone: '5035550147', email: 'DANA@example.com' });
    assert.equal(r.byPhone.length, 1);
    assert.equal(r.byEmail.length, 1);
  });
});

test('a formatted or +1 number is the same number', async () => {
  await withAbc([prospect()], async ({ searchProspects }) => {
    const r = await searchProspects('30935', { phone: '+1 (503) 555-0147' });
    assert.equal(r.byPhone.length, 1);
  });
});

test('the mobile number counts when there is no primary', async () => {
  await withAbc(
    [prospect({ primaryPhone: '', mobilePhone: '5035550147' })],
    async ({ searchProspects }) => {
      const r = await searchProspects('30935', { phone: '5035550147' });
      assert.equal(r.byPhone.length, 1);
    }
  );
});

test('somebody else is not a match', async () => {
  await withAbc([prospect()], async ({ searchProspects }) => {
    const r = await searchProspects('30935', { phone: '5035559999', email: 'other@example.com' });
    assert.equal(r.byPhone.length, 0);
    assert.equal(r.byEmail.length, 0);
  });
});

test('the range is a SPAN, because a single day returns nothing from ABC', async () => {
  await withAbc([], async ({ searchProspects }, seen) => {
    await searchProspects('30935', { phone: '5035550147' });
    const [begin, end] = seen[0].params.beginDateRange.split(',');
    assert.ok(begin && end, 'both ends of the range must be sent');
    assert.notEqual(begin, end, 'a single-day range returns zero rows from ABC');
    assert.ok(new Date(end) > new Date(begin));
  });
});

test('an ABC failure never stops somebody finishing a waiver', async () => {
  await withAbc(new Error('ETIMEDOUT'), async ({ searchProspects }) => {
    const r = await searchProspects('30935', { phone: '5035550147' });
    assert.deepEqual(r, { byPhone: [], byEmail: [] });
  });
});

test('no phone and no email never calls ABC at all', async () => {
  await withAbc([prospect()], async ({ searchProspects }, seen) => {
    const r = await searchProspects('30935', {});
    assert.deepEqual(r, { byPhone: [], byEmail: [] });
    assert.equal(seen.length, 0);
  });
});

// --- the scorer, with both sources feeding it -------------------------------

function withSources({ members, prospects }, run) {
  require.cache[MEMBER_SEARCH] = {
    id: MEMBER_SEARCH, filename: MEMBER_SEARCH, loaded: true,
    exports: { searchMembers: async () => members },
  };
  require.cache[SEARCH] = {
    id: SEARCH, filename: SEARCH, loaded: true,
    exports: { searchProspects: async () => prospects },
  };
  delete require.cache[MATCH];
  const { findExistingMember } = require(MATCH);
  return run(findExistingMember);
}

const none = { byPhone: [], byEmail: [] };
const asCandidate = (id, over = {}) => ({
  memberId: id,
  personal: { firstName: 'Dana', lastName: 'Reid', ...over },
});

test('a prospect matching on both phone and email attaches without asking', async () => {
  const p = { ...asCandidate('p-1'), isProspect: true };
  await withSources(
    { members: none, prospects: { byPhone: [p], byEmail: [p] } },
    async findExistingMember => {
      const r = await findExistingMember(
        { clubNumber: '30935' },
        { firstName: 'Dana', lastName: 'Reid', phone: '5035550147', email: 'dana@example.com' }
      );
      assert.equal(r.match, 'exact');
      assert.equal(r.candidates[0].abcMemberId, 'p-1');
      assert.equal(r.candidates[0].isProspect, true);
    }
  );
});

test('a prospect on one signal alone has to be confirmed', async () => {
  const p = { ...asCandidate('p-1'), isProspect: true };
  await withSources(
    { members: none, prospects: { byPhone: [p], byEmail: [] } },
    async findExistingMember => {
      const r = await findExistingMember(
        { clubNumber: '30935' },
        { firstName: 'Dana', lastName: 'Reid', phone: '5035550147' }
      );
      // Guessing here staples a signed waiver to a stranger.
      assert.equal(r.match, 'partial');
    }
  );
});

test('a member and a prospect for one person offer both, member first', async () => {
  const m = asCandidate('m-1');
  const p = { ...asCandidate('p-1'), isProspect: true };
  await withSources(
    { members: { byPhone: [m], byEmail: [m] }, prospects: { byPhone: [p], byEmail: [p] } },
    async findExistingMember => {
      const r = await findExistingMember(
        { clubNumber: '30935' },
        { firstName: 'Dana', lastName: 'Reid', phone: '5035550147', email: 'dana@example.com' }
      );
      assert.equal(r.match, 'partial', 'two records is never a silent attach');
      // The membership is the record with their history on it.
      assert.equal(r.candidates[0].abcMemberId, 'm-1');
      assert.equal(r.candidates[0].isProspect, false);
      assert.equal(r.candidates[1].isProspect, true);
    }
  );
});

test('nobody anywhere still means create, as before', async () => {
  await withSources({ members: none, prospects: none }, async findExistingMember => {
    const r = await findExistingMember(
      { clubNumber: '30935' },
      { firstName: 'Dana', lastName: 'Reid', phone: '5035550147' }
    );
    assert.equal(r.match, 'none');
    assert.equal(r.candidates.length, 0);
  });
});
