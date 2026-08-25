// Not creating a second ABC profile for somebody who already has one.
//
// The waiver kiosk used to call createProspect unconditionally, so a returning
// member who used the wrong tablet quietly got a duplicate. These pin both
// halves of the fix: the lookup at the contact step, and submit honouring it.

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
      const config = method === 'get' ? rest[0] : rest[1];
      calls.push({ method, url, body, config });
      for (const r of responders) {
        const out = r({ method, url, body, config });
        if (out) return out;
      }
      return { status: 200, data: {} };
    };
  }
}

const respond = fn => responders.push(fn);

let server;
let base;

test.before(async () => {
  process.env.ABC_APP_ID = 'test-id';
  process.env.ABC_APP_KEY = 'test-key';
  process.env.PDFSHIFT_API_KEY = 'test-pdfshift';
  delete process.env.SENDGRID_API_KEY;
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

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const LEAD = {
  location: 'salem',
  firstName: 'Dana',
  lastName: 'Reyes',
  email: 'dana@example.com',
  phone: '(503) 555-1212',
};

const SUBMISSION = {
  ...LEAD,
  address1: '482 Liberty St NE', city: 'Salem', state: 'OR', postalCode: '97301',
  dateOfBirth: '1992-03-14', gender: 'Female', howHeard: 'Instagram',
  photoDataUrl: PNG, signatureDataUrl: PNG, agreed: true,
};

// searchByPhone/searchByEmail re-filter ABC's response against the input, so a
// fixture without a matching phone and email is silently dropped and every
// match looks like 'none'.
function abcMember({ first = 'Dana', last = 'Reyes', id = 'ABC-EXISTING' } = {}) {
  return {
    memberId: id,
    personal: {
      firstName: first,
      lastName: last,
      memberStatus: 'expired',
      primaryPhone: '(503) 555-1212',
      email: 'dana@example.com',
    },
  };
}

// The member search is hit once with primaryPhone and once with email.
function stubSearch(byPhone, byEmail) {
  respond(({ method, url, config }) => {
    if (method !== 'get' || !url.includes('/members')) return null;
    const params = (config && config.params) || {};
    if (params.primaryPhone !== undefined) return { status: 200, data: { members: byPhone } };
    if (params.email !== undefined) return { status: 200, data: { members: byEmail } };
    return { status: 200, data: { members: [] } };
  });
}

function stubPipeline() {
  respond(({ url }) => {
    if (url.includes('/prospects')) return { status: 200, data: { result: { memberId: 'ABC-NEW' } } };
    if (url.includes('pdfshift.io')) return { status: 200, data: Buffer.from('%PDF-1.4') };
    if (url.includes('/contacts/upsert')) return { status: 200, data: { contact: { id: 'GHL-1' } } };
    return null;
  });
}

// --- the lookup at the contact step -----------------------------------------

test('phone AND email AND name agreeing is an exact match', async () => {
  const m = abcMember();
  stubSearch([m], [m]);

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.body.abcMatch.match, 'exact');
  assert.strictEqual(res.body.abcMatch.candidates[0].abcMemberId, 'ABC-EXISTING');
});

test('a phone-only hit is partial, so the member gets asked', async () => {
  // A shared family phone must never silently attach a waiver to a relative.
  stubSearch([abcMember({ first: 'Chris', last: 'Reyes', id: 'ABC-SIBLING' })], []);

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.body.abcMatch.match, 'partial');
  assert.deepStrictEqual(res.body.abcMatch.candidates[0].matchVia, ['phone']);
  assert.strictEqual(res.body.abcMatch.candidates[0].nameMatches, false);
});

test('a different name on both channels is still only partial', async () => {
  const m = abcMember({ first: 'Chris', last: 'Reyes', id: 'ABC-SIBLING' });
  stubSearch([m], [m]);

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);
  assert.strictEqual(res.body.abcMatch.match, 'partial');
});

test('two candidates are never exact', async () => {
  stubSearch([abcMember({ id: 'A' })], [abcMember({ id: 'B' })]);

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.body.abcMatch.match, 'partial');
  assert.strictEqual(res.body.abcMatch.candidates.length, 2);
});

test('nobody found is a clean none', async () => {
  stubSearch([], []);

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.body.abcMatch.match, 'none');
  assert.deepStrictEqual(res.body.abcMatch.candidates, []);
});

test('an ABC outage degrades to none rather than failing the step', async () => {
  respond(({ method, url }) => {
    if (method === 'get' && url.includes('/members')) throw new Error('ABC down');
    return null;
  });

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.abcMatch.match, 'none', 'worst case is the old behaviour');
});

// --- submit honouring the match ---------------------------------------------

test('submit attaches to the existing record instead of creating one', async () => {
  stubPipeline();

  const res = await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    abcMemberId: 'ABC-EXISTING',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.abcMemberId, 'ABC-EXISTING');
  assert.strictEqual(res.body.created, false);
  assert.strictEqual(
    calls.filter(c => c.method === 'post' && c.url.endsWith('/prospects')).length,
    0,
    'no second profile'
  );
});

test('the waiver, photo and check-in still land on the existing record', async () => {
  stubPipeline();

  await request('POST', '/api/kiosk-waiver/submit', { ...SUBMISSION, abcMemberId: 'ABC-EXISTING' });

  // Attaching must not mean skipping everything else — they signed a waiver today.
  for (const frag of [
    '/members/documents/ABC-EXISTING',
    '/members/alerts/ABC-EXISTING',
    '/members/pictures/ABC-EXISTING',
    '/members/checkins/ABC-EXISTING',
  ]) {
    assert.ok(calls.some(c => c.url.includes(frag)), `expected a call to ${frag}`);
  }
});

test('no match still creates a profile, exactly as before', async () => {
  stubPipeline();

  const res = await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  assert.strictEqual(res.body.abcMemberId, 'ABC-NEW');
  assert.strictEqual(res.body.created, true);
  assert.strictEqual(calls.filter(c => c.method === 'post' && c.url.endsWith('/prospects')).length, 1);
});

test('the completed webhook says whether the profile is new', async () => {
  stubPipeline();
  const clubs = require(path.join(ROOT, 'services/waiver/clubs'));
  const salem = clubs.bySlug('salem');
  salem.kioskWaiverCompletedWebhookUrl = 'https://hooks.example.test/done';

  try {
    await request('POST', '/api/kiosk-waiver/submit', { ...SUBMISSION, abcMemberId: 'ABC-EXISTING' });

    const hook = calls.find(c => c.url === 'https://hooks.example.test/done');
    assert.strictEqual(hook.body.is_new_profile, 'no');
    assert.strictEqual(hook.body.abc_member_id, 'ABC-EXISTING');
  } finally {
    salem.kioskWaiverCompletedWebhookUrl = '';
  }
});
