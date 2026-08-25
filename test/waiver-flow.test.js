// Regression cover for the GHL survey path after the waiver pipeline moved into
// services/waiver. /webhook/ghl-form is the endpoint every club's trial survey
// already posts to, so its contract must not shift.

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

function stubHappyPath() {
  responders.push(({ url }) => {
    if (url.includes('/prospects')) return { status: 200, data: { result: { memberId: 'ABC-7001' } } };
    if (url.includes('pdfshift.io')) return { status: 200, data: Buffer.from('%PDF-1.4') };
    return null;
  });
}

let server;
let base;

test.before(async () => {
  process.env.ABC_APP_ID = 'test-id';
  process.env.ABC_APP_KEY = 'test-key';
  process.env.PDFSHIFT_API_KEY = 'test-pdfshift';
  stubAxios();
  const app = require(path.join(ROOT, 'index.js'));
  server = http.createServer(app);
  await new Promise(res => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());
test.beforeEach(() => stubAxios());

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${base}${urlPath}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* ignore */ }
          resolve({ status: res.statusCode, body: json, raw });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// The shape a GHL survey actually posts: a display name for the location and
// the long question strings as keys.
const SURVEY = {
  first_name: 'Dana',
  last_name: 'Reyes',
  email: 'dana@example.com',
  phone: '5035551212',
  address1: '482 Liberty St NE',
  city: 'Salem',
  state: 'Oregon',
  postal_code: '97301',
  date_of_birth: '1992-03-14',
  Gender: 'Female',
  contact_id: 'ghl-survey-contact',
  location: { id: 'uflpfHNpByAnaBLkQzu3', name: 'West Coast Strength - Salem' },
  'Legal Signature': { meta: { timestamp: '1750000000' } },
  'Do You Experience Chest Pain During Physical Activity?': 'No',
};

test('/webhook/ghl-form still resolves the club from the location display name', async () => {
  stubHappyPath();

  const res = await post('/webhook/ghl-form', {
    ...SURVEY,
    location: { name: 'West Coast Strength - Salem' },
  });

  assert.strictEqual(res.status, 200, res.raw);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(res.body.clubNumber, '30935');
  assert.strictEqual(res.body.prospectId, 'ABC-7001');
});

test('/webhook/ghl-form keeps its explicit club_number override', async () => {
  stubHappyPath();

  const res = await post('/webhook/ghl-form', {
    ...SURVEY,
    club_number: '32073', // Medford, deliberately disagreeing with the location name
  });

  assert.strictEqual(res.body.clubNumber, '32073');
  const prospect = calls.find(c => c.url.includes('/prospects'));
  assert.ok(prospect.url.includes('/32073/prospects'));
});

test('/webhook/ghl-form reads club_number out of customData too', async () => {
  stubHappyPath();

  const res = await post('/webhook/ghl-form', {
    ...SURVEY,
    location: { name: 'Somewhere Unmapped' },
    customData: { club_number: '31599' },
  });

  assert.strictEqual(res.body.clubNumber, '31599');
});

test('/webhook/ghl-form returns the old abc_responses envelope', async () => {
  stubHappyPath();

  const res = await post('/webhook/ghl-form', SURVEY);

  assert.ok(res.body.abc_responses, 'callers key off abc_responses');
  for (const key of ['prospect', 'document', 'alert', 'picture', 'checkin']) {
    assert.ok(key in res.body.abc_responses, `abc_responses.${key} still reported`);
  }
});

test('/webhook/ghl-form 500s with a readable message when no club can be resolved', async () => {
  stubHappyPath();

  const res = await post('/webhook/ghl-form', {
    ...SURVEY,
    location: { name: 'West Coast Strength - Boise' },
  });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.success, false);
  assert.match(res.body.error, /Unable to determine club/);
  assert.match(res.body.error, /Boise/, 'the message names what we were given');
});

test('/webhook/ghl-form skips the photo upload when the survey captured none', async () => {
  stubHappyPath();

  const res = await post('/webhook/ghl-form', SURVEY);

  assert.strictEqual(res.body.abc_responses.picture.skipped, true);
  assert.strictEqual(
    calls.filter(c => c.url.includes('/members/pictures/')).length,
    0
  );
});

test('/webhook/ghl-form uploads a photo sent under any of its three key spellings', async () => {
  for (const payload of [
    { ...SURVEY, member_profile_photo: 'AAAA' },
    { ...SURVEY, 'Member Profile Photo': 'AAAA' },
    { ...SURVEY, customData: { member_profile_photo: 'AAAA' } },
  ]) {
    stubAxios();
    stubHappyPath();
    await post('/webhook/ghl-form', payload);
    assert.strictEqual(
      calls.filter(c => c.url.includes('/members/pictures/')).length,
      1,
      `photo not picked up from ${Object.keys(payload).slice(-1)}`
    );
  }
});
