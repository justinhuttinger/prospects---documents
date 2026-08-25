// Granting trial days from the tour kiosk.
//
// The two ABC behaviours that make this work are easy to break by accident, so
// they are pinned here: `personal` must ride along in the PUT, and only the two
// agreement fields may be sent (the PUT merges, so anything else we include is
// a field we could clobber).

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

const axios = require('axios');

const ROOT = path.join(__dirname, '..');

let calls = [];
let responders = [];

function stubAxios() {
  calls = [];
  responders = [];
  for (const method of ['get', 'post', 'put']) {
    axios[method] = async (url, ...rest) => {
      const body = method === 'get' ? undefined : rest[0];
      calls.push({ method, url, body });
      for (const r of responders) {
        const out = r({ method, url, body });
        if (out) return out;
      }
      return { status: 200, data: {} };
    };
  }
}

const respond = fn => responders.push(fn);

const PROSPECT_ID = 'abc123prospect';

function prospectRecord({ isActive = 'false', expirationDate = '2026-08-12', visitsAllowed = '7', visitsUsed = '1' } = {}) {
  return {
    status: 200,
    data: {
      prospects: [{
        prospectId: PROSPECT_ID,
        personal: { firstName: 'Alana', lastName: 'Vaughters', isActive },
        agreement: { expirationDate, visitsAllowed, visitsUsed },
      }],
    },
  };
}

let server;
let base;

test.before(async () => {
  process.env.ABC_APP_ID = 'test-id';
  process.env.ABC_APP_KEY = 'test-key';
  stubAxios();
  const app = require(path.join(ROOT, 'index.js'));
  server = http.createServer(app);
  await new Promise(res => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());
test.beforeEach(() => stubAxios());

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${base}${urlPath}`,
      { method, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {} },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* ignore */ }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const post = (body) => request('POST', '/api/kiosk/extend-trial', body);

// --- the happy path ---------------------------------------------------------

test('grants the days and sets a matching visit allowance', async () => {
  let reads = 0;
  respond(({ method, url }) => {
    if (method === 'get' && url.includes('/prospects/')) {
      reads += 1;
      // Second read is the verification after the write.
      return reads === 1
        ? prospectRecord()
        : prospectRecord({ isActive: 'true', expirationDate: '2026-09-04', visitsAllowed: '10' });
    }
    return null;
  });

  const res = await post({ location: 'salem', prospectId: PROSPECT_ID, days: 10 });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.days, 10);
  assert.strictEqual(res.body.before.isActive, false);
  assert.strictEqual(res.body.after.isActive, true, 'extending the date reactivates them');
  assert.strictEqual(res.body.after.visitsAllowed, '10');
});

test('the PUT carries personal, or ABC answers a bare 500', async () => {
  respond(({ method, url }) =>
    method === 'get' && url.includes('/prospects/') ? prospectRecord() : null
  );

  await post({ location: 'salem', prospectId: PROSPECT_ID, days: 10 });

  const put = calls.find(c => c.method === 'put');
  assert.ok(put, 'expected a PUT');
  // This is the whole trick. An agreement-only body 500s.
  assert.deepStrictEqual(put.body.prospect.personal, { firstName: 'Alana', lastName: 'Vaughters' });
});

test('the PUT sends only the two agreement fields, since it merges', async () => {
  respond(({ method, url }) =>
    method === 'get' && url.includes('/prospects/') ? prospectRecord() : null
  );

  await post({ location: 'salem', prospectId: PROSPECT_ID, days: 14 });

  const put = calls.find(c => c.method === 'put');
  assert.deepStrictEqual(
    Object.keys(put.body.prospect.agreement).sort(),
    ['expirationDate', 'visitsAllowed'],
    'anything else we send is a field we could clobber'
  );
  assert.strictEqual(put.body.prospect.agreement.visitsAllowed, '14', 'sent as a string');
});

test('the PUT goes to the club the kiosk is standing in', async () => {
  respond(({ method, url }) =>
    method === 'get' && url.includes('/prospects/') ? prospectRecord() : null
  );

  await post({ location: 'medford', prospectId: PROSPECT_ID, days: 5 });

  const put = calls.find(c => c.method === 'put');
  assert.ok(put.url.includes('/32073/prospects/'), 'Medford club number');
});

// --- the date ---------------------------------------------------------------

test('the expiration is N days out in club time, not UTC', async () => {
  const { expirationDateFrom } = require(path.join(ROOT, 'services/kiosk/trial'));

  // 03:00 UTC on the 26th is still 8pm Pacific on the 25th. Computing in UTC
  // here would quietly hand out an extra day.
  const lateEvening = new Date('2026-08-26T03:00:00Z');
  assert.strictEqual(expirationDateFrom(10, lateEvening), '2026-09-04');

  const midday = new Date('2026-08-25T19:00:00Z');
  assert.strictEqual(expirationDateFrom(10, midday), '2026-09-04');
});

test('expirationDateFrom crosses a month boundary correctly', async () => {
  const { expirationDateFrom } = require(path.join(ROOT, 'services/kiosk/trial'));
  assert.strictEqual(expirationDateFrom(10, new Date('2026-08-28T19:00:00Z')), '2026-09-07');
  assert.strictEqual(expirationDateFrom(1, new Date('2026-12-31T19:00:00Z')), '2027-01-01');
});

// --- refusals ---------------------------------------------------------------

test('a cancelled member is refused as not a prospect, not as an error', async () => {
  // ABC answers 200 with an empty list for an id that exists as a member.
  respond(({ method, url }) =>
    method === 'get' && url.includes('/prospects/')
      ? { status: 200, data: { status: { message: 'No records found.' }, prospects: [] } }
      : null
  );

  const res = await post({ location: 'salem', prospectId: 'a-real-member', days: 10 });

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'not_a_prospect');
  assert.strictEqual(calls.filter(c => c.method === 'put').length, 0, 'nothing is written');
});

test('rejects a day count that is not a sane trial', async () => {
  for (const days of [0, -5, 91, 999999, 'ten', 2.5, null]) {
    const res = await post({ location: 'salem', prospectId: PROSPECT_ID, days });
    assert.strictEqual(res.status, 400, `days=${days} should be rejected`);
    assert.strictEqual(res.body.error, 'invalid_days');
  }
  assert.strictEqual(calls.filter(c => c.method === 'put').length, 0);
});

test('rejects an unknown club and a missing prospect id', async () => {
  const badClub = await post({ location: 'portland', prospectId: PROSPECT_ID, days: 10 });
  assert.strictEqual(badClub.status, 400);
  assert.strictEqual(badClub.body.error, 'unknown_location');

  const noId = await post({ location: 'salem', days: 10 });
  assert.strictEqual(noId.status, 400);
  assert.strictEqual(noId.body.error, 'missing_prospect_id');
});

test('an ABC failure is reported, not swallowed as success', async () => {
  respond(({ method, url }) => {
    if (method === 'get' && url.includes('/prospects/')) return prospectRecord();
    if (method === 'put') {
      return { status: 500, data: { status: { message: 'An unexpected error occurred.' } } };
    }
    return null;
  });

  const res = await post({ location: 'salem', prospectId: PROSPECT_ID, days: 10 });

  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.body.ok, false);
  assert.strictEqual(res.body.error, 'abc_error');
  assert.match(res.body.detail, /unexpected error/i);
});

test('the result is read back from ABC rather than assumed', async () => {
  // Staff are about to tell somebody they have access; the door checks ABC's
  // record, so the response has to reflect what ABC actually stored.
  let reads = 0;
  respond(({ method, url }) => {
    if (method === 'get' && url.includes('/prospects/')) {
      reads += 1;
      return reads === 1
        ? prospectRecord()
        : prospectRecord({ isActive: 'true', expirationDate: '2026-09-04', visitsAllowed: '10' });
    }
    return null;
  });

  const res = await post({ location: 'salem', prospectId: PROSPECT_ID, days: 10 });

  assert.strictEqual(reads, 2, 'read before and after the write');
  assert.strictEqual(res.body.after.expirationDate, '2026-09-04');
});
