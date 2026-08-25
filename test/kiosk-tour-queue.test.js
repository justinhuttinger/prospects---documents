// The kiosk raising and then updating a card on the front desk's tour queue.
//
// Two things carry the whole design: the card appears at the CONTACT step so
// staff see somebody in the lobby while they are still filling the form in, and
// the second call carries the id so the photo lands on that same card rather
// than raising a duplicate.

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
        const out = r({ method, url, body });
        if (out) return out;
      }
      return { status: 200, data: {} };
    };
  }
}

const respond = fn => responders.push(fn);
const tourCalls = () => calls.filter(c => c.url.includes('/webhooks/tour-intake'));

let server;
let base;

test.before(async () => {
  process.env.ABC_APP_ID = 'test-id';
  process.env.ABC_APP_KEY = 'test-key';
  process.env.PDFSHIFT_API_KEY = 'test-pdfshift';
  process.env.GHL_WEBHOOK_SECRET = 'test-secret';
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
  address1: '482 Liberty St NE',
  city: 'Salem',
  state: 'OR',
  postalCode: '97301',
  dateOfBirth: '1992-03-14',
  gender: 'Female',
  howHeard: 'Instagram',
  photoDataUrl: PNG,
  signatureDataUrl: PNG,
  agreed: true,
};

function stubQueue(id = 'INTAKE-1') {
  respond(({ url }) =>
    url.includes('/webhooks/tour-intake') ? { status: 200, data: { success: true, id } } : null
  );
}

function stubAbc() {
  respond(({ url }) => {
    if (url.includes('/prospects')) return { status: 200, data: { result: { memberId: 'ABC-1' } } };
    if (url.includes('pdfshift.io')) return { status: 200, data: Buffer.from('%PDF-1.4') };
    if (url.includes('/contacts/upsert')) return { status: 200, data: { contact: { id: 'GHL-1' } } };
    return null;
  });
}

// --- the arrival call -------------------------------------------------------

test('the contact step raises a card on the tour queue', async () => {
  stubQueue();

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.tourIntakeId, 'INTAKE-1', 'returned so submit can update the same card');

  const hit = tourCalls()[0];
  assert.ok(hit, 'expected the queue to be called');
  assert.strictEqual(hit.body.first_name, 'Dana');
  assert.strictEqual(hit.body.phone, '+15035551212');
  assert.strictEqual(hit.body.stage, 'started');
  assert.strictEqual(hit.body.location.id, 'uflpfHNpByAnaBLkQzu3', 'portal resolves the club from this');
  assert.ok(!hit.body.intake_id, 'no id yet: this call creates the card');
});

test('the card is raised even with no per-club GHL webhook configured', async () => {
  stubQueue();

  // Salem has no kioskWaiverLeadWebhookUrl set, so the GHL fan-out skips. The
  // queue is how staff know somebody is in the lobby and must not skip with it.
  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.body.webhook.skipped, true);
  assert.strictEqual(tourCalls().length, 1, 'the queue still got called');
  assert.strictEqual(res.body.tourIntake.ok, true);
});

test('a queue outage does not stop the member continuing', async () => {
  respond(({ url }) => {
    if (url.includes('/webhooks/tour-intake')) throw new Error('ECONNREFUSED');
    return null;
  });

  const res = await request('POST', '/api/kiosk-waiver/lead', LEAD);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.tourIntakeId, null);
  assert.strictEqual(res.body.tourIntake.ok, false);
});

// --- the completion call ----------------------------------------------------

test('submit updates the same card and attaches the photo', async () => {
  stubQueue();
  stubAbc();

  const res = await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    tourIntakeId: 'INTAKE-1',
  });

  assert.strictEqual(res.status, 200);

  const hit = tourCalls()[0];
  assert.strictEqual(hit.body.intake_id, 'INTAKE-1', 'updates rather than duplicating');
  assert.ok(hit.body.photo_base64, 'the photo is the point of the second call');
  assert.strictEqual(hit.body.abc_member_id, 'ABC-1');
  assert.strictEqual(hit.body.stage, 'completed');
});

test('submit does not raise a second card when the arrival call failed', async () => {
  stubQueue();
  stubAbc();

  // No tourIntakeId: the lead-time call never landed. Posting without one would
  // create a duplicate card for somebody already on the queue.
  const res = await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(tourCalls().length, 0, 'nothing posted');
  assert.strictEqual(res.body.steps.tourIntake.skipped, true);
});

test('a queue failure at submit does not fail the check-in', async () => {
  stubAbc();
  respond(({ url }) => {
    if (url.includes('/webhooks/tour-intake')) return { status: 500, data: { error: 'boom' } };
    return null;
  });

  const res = await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    tourIntakeId: 'INTAKE-1',
  });

  assert.strictEqual(res.status, 200, 'the waiver is on file; the card is a notification');
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.steps.tourIntake.ok, false);
});

// --- auth -------------------------------------------------------------------

test('the webhook secret rides on the request when one is configured', async () => {
  stubQueue();
  await request('POST', '/api/kiosk-waiver/lead', LEAD);

  const headers = tourCalls()[0].config.headers;
  // Without this the portal answers 401 and no card ever appears.
  assert.strictEqual(headers['x-webhook-secret'], 'test-secret');
  assert.strictEqual(headers['Content-Type'], 'application/json');
});

test('no secret header is sent when none is configured', async () => {
  const saved = process.env.GHL_WEBHOOK_SECRET;
  delete process.env.GHL_WEBHOOK_SECRET;
  try {
    stubQueue();
    await request('POST', '/api/kiosk-waiver/lead', LEAD);
    // The portal treats an absent secret as an open webhook, so sending an
    // empty header would be worse than sending none.
    assert.ok(!('x-webhook-secret' in tourCalls()[0].config.headers));
  } finally {
    process.env.GHL_WEBHOOK_SECRET = saved;
  }
});
