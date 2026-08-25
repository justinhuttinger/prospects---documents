// Kiosk Waiver route tests.
//
// The ABC, GHL, SendGrid and PDFShift calls are all axios, so the whole outside
// world is stubbed at the axios module and the tests assert on what we would
// have sent. Nothing here touches a live club.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

const axios = require('axios');

const ROOT = path.join(__dirname, '..');

// --- axios stub -------------------------------------------------------------

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

function respond(fn) {
  responders.push(fn);
}

// --- tiny HTTP client against the real express app --------------------------

let app;
let server;
let base;

async function boot() {
  process.env.ABC_APP_ID = 'test-id';
  process.env.ABC_APP_KEY = 'test-key';
  process.env.PDFSHIFT_API_KEY = 'test-pdfshift';
  delete process.env.SENDGRID_API_KEY;

  app = require(path.join(ROOT, 'index.js'));
  server = http.createServer(app);
  await new Promise(res => server.listen(0, res));
  base = `http://127.0.0.1:${server.address().port}`;
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${base}${urlPath}`,
      {
        method,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
          : {},
      },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch { /* non-JSON body */ }
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// A 1x1 PNG, enough to stand in for a photo or a signature.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SUBMISSION = {
  location: 'salem',
  contactId: 'ghl-contact-1',
  firstName: 'Dana',
  lastName: 'Reyes',
  email: 'Dana@Example.com',
  phone: '(503) 555-1212',
  address1: '482 Liberty St NE',
  city: 'Salem',
  state: 'Oregon',
  postalCode: '97301',
  dateOfBirth: '1992-03-14',
  gender: 'Female',
  photoDataUrl: PNG,
  signatureDataUrl: PNG,
  agreed: true,
  howHeard: 'Friend or Family Referral',
};

test.before(async () => {
  stubAxios();
  await boot();
});

test.after(() => server && server.close());

test.beforeEach(() => stubAxios());

// --- locations --------------------------------------------------------------

test('GET /locations returns every enabled club and leaks no credentials', async () => {
  const res = await request('GET', '/api/kiosk-waiver/locations');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);

  const slugs = res.body.locations.map(l => l.slug);
  assert.deepStrictEqual(
    slugs.sort(),
    ['clackamas', 'eugene', 'keizer', 'medford', 'milwaukie', 'salem', 'springfield']
  );

  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes('pit-'), 'GHL API keys must not reach the kiosk');
  assert.ok(!/stationId/i.test(serialized), 'station ids must not reach the kiosk');
});

test('the kiosk router answers its own CORS preflight', async () => {
  const res = await request('OPTIONS', '/api/kiosk-waiver/lead');
  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers['access-control-allow-origin'], '*');
});

// --- halfway trigger --------------------------------------------------------

test('POST /lead upserts the GHL contact and fires the started webhook', async () => {
  respond(({ url }) =>
    url.includes('/contacts/upsert')
      ? { status: 200, data: { contact: { id: 'ghl-new-1' } } }
      : null
  );

  const res = await request('POST', '/api/kiosk-waiver/lead', {
    location: 'keizer',
    firstName: 'Dana',
    lastName: 'Reyes',
    email: 'Dana@Example.com',
    phone: '(503) 555-1212',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.contactId, 'ghl-new-1');

  const upsert = calls.find(c => c.url.includes('/contacts/upsert'));
  assert.ok(upsert, 'expected a GHL upsert');
  assert.strictEqual(upsert.body.locationId, 'g75BBgiSvlCRbvxYRMAb', 'Keizer sub-account');
  assert.strictEqual(upsert.body.phone, '+15035551212');
  assert.strictEqual(upsert.body.email, 'dana@example.com');
  assert.strictEqual(upsert.body.source, 'Kiosk Waiver');
  assert.deepStrictEqual(upsert.body.tags, ['kiosk waiver started']);
});

test('POST /lead reports success even when GHL is down, so the member can keep going', async () => {
  respond(({ url }) => {
    if (url.includes('/contacts/upsert')) throw new Error('ECONNRESET');
    return null;
  });

  const res = await request('POST', '/api/kiosk-waiver/lead', {
    location: 'salem',
    firstName: 'Dana',
    lastName: 'Reyes',
    phone: '5035551212',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.contactId, null);
  assert.strictEqual(res.body.ghl.ok, false);
});

test('POST /lead rejects an unknown club and a lead with no way to reach them', async () => {
  const unknown = await request('POST', '/api/kiosk-waiver/lead', {
    location: 'portland',
    firstName: 'A',
    lastName: 'B',
    email: 'a@b.com',
  });
  assert.strictEqual(unknown.status, 400);
  assert.strictEqual(unknown.body.error, 'unknown_location');

  const noContact = await request('POST', '/api/kiosk-waiver/lead', {
    location: 'salem',
    firstName: 'A',
    lastName: 'B',
  });
  assert.strictEqual(noContact.status, 400);
  assert.strictEqual(noContact.body.error, 'missing_contact_info');
});

// --- final trigger ----------------------------------------------------------

function stubFullSubmitChain() {
  respond(({ url }) => {
    if (url.includes('/prospects')) {
      return { status: 200, data: { result: { memberId: 'ABC-9001' } } };
    }
    if (url.includes('pdfshift.io')) {
      return { status: 200, data: Buffer.from('%PDF-1.4 test') };
    }
    if (url.includes('/contacts/upsert')) {
      return { status: 200, data: { contact: { id: 'ghl-contact-1' } } };
    }
    return null;
  });
}

test('POST /submit runs the ABC sequence in order and returns the new member id', async () => {
  stubFullSubmitChain();

  const res = await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);
  assert.strictEqual(res.status, 200, res.raw);
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.abcMemberId, 'ABC-9001');
  assert.strictEqual(res.body.clubNumber, '30935');

  const urls = calls.map(c => c.url);
  const at = frag => urls.findIndex(u => u.includes(frag));

  assert.ok(at('/prospects') >= 0, 'created a prospect');
  assert.ok(at('pdfshift.io') > at('/prospects'), 'PDF is rendered after the prospect exists');
  assert.ok(at('/members/documents/ABC-9001') >= 0, 'waiver filed on the new member');
  assert.ok(at('/members/alerts/ABC-9001') >= 0, 'front-desk alert added');
  assert.ok(at('/members/pictures/ABC-9001') >= 0, 'profile photo uploaded');

  // The check-in is the point where the desk sees this person, so the alert and
  // the photo have to already be in place.
  assert.ok(
    at('/members/checkins/ABC-9001') > at('/members/alerts/ABC-9001'),
    'check-in posted after the alert'
  );
  assert.ok(
    at('/members/checkins/ABC-9001') > at('/members/pictures/ABC-9001'),
    'check-in posted after the photo'
  );
});

test('POST /submit sends ABC a sanitized prospect', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    firstName: 'José',
    lastName: "O'Brien-Smith",
    address1: '482 Liberty St. NE, Apt #7',
    state: 'Oregon',
  });

  const prospect = calls.find(c => c.url.includes('/prospects'));
  const personal = prospect.body.prospects[0].prospect.personal;

  assert.strictEqual(personal.firstName, 'Jose', 'accents normalized away');
  assert.strictEqual(personal.lastName, "O'Brien-Smith");
  assert.strictEqual(personal.addressLine1, '482 Liberty St NE Apt #7', 'periods and commas dropped');
  assert.strictEqual(personal.state, 'OR', 'state name mapped to its code');
  assert.strictEqual(personal.primaryPhone, '5035551212', 'ABC wants bare 10 digits');
  assert.strictEqual(personal.birthDate, '1992-03-14');
  assert.strictEqual(personal.countryCode, 'US');
});

test('POST /submit files the waiver under a safe document name', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    firstName: 'Dana*',
    lastName: 'Reyes/Cruz',
  });

  const doc = calls.find(c => c.url.includes('/members/documents/'));
  // ABC silently drops disallowed characters, so we strip them first.
  assert.strictEqual(doc.body.documentName, 'Waiver_Dana_ReyesCruz.pdf');
  assert.strictEqual(doc.body.documentType, 'pdf');
  assert.strictEqual(doc.body.imageType, 'member_document');
});

test('POST /submit posts the check-in with the club\'s own station id, in Pacific time', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  const checkin = calls.find(c => c.url.includes('/members/checkins/'));
  const access = checkin.body.checkins[0].access;
  assert.strictEqual(access.stationId, 'E42B9D7C33C908BEE0532AE014ACBF25', 'Salem station');
  assert.match(
    access.locationTimestamp,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
    'ABC wants YYYY-MM-DD hh:mm:ss.nnnnnn'
  );
});

test('POST /submit strips the data URI before handing ABC the photo', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  const picture = calls.find(c => c.url.includes('/members/pictures/'));
  assert.ok(!picture.body.image.startsWith('data:'), 'ABC takes bare base64');
  assert.ok(picture.body.image.startsWith('iVBORw0KGgo'), 'PNG payload preserved');
});

test('POST /submit stamps the ABC id back onto the GHL contact from the lead step', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  const stamp = calls.find(c => c.method === 'put' && c.url.includes('/contacts/ghl-contact-1'));
  assert.ok(stamp, 'expected the GHL write-back');
  assert.deepStrictEqual(stamp.body.customFields, [
    { key: 'abc_member_id', field_value: 'ABC-9001' },
  ]);
});

test('POST /submit still succeeds when the notifications fail', async () => {
  respond(({ url }) => {
    if (url.includes('/prospects')) return { status: 200, data: { result: { memberId: 'ABC-9002' } } };
    if (url.includes('pdfshift.io')) return { status: 200, data: Buffer.from('%PDF-1.4') };
    if (url.includes('/members/documents/')) throw new Error('ABC document service timeout');
    if (url.includes('/contacts/')) throw new Error('GHL down');
    return null;
  });

  const res = await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  assert.strictEqual(res.status, 200, 'the waiver is on file; notifications are best-effort');
  assert.strictEqual(res.body.abcMemberId, 'ABC-9002');
  assert.strictEqual(res.body.steps.document.success, false);
  assert.strictEqual(res.body.steps.ghl.success, false);
});

test('POST /submit fails loudly when ABC will not create the prospect', async () => {
  respond(({ url }) => {
    if (url.includes('/prospects')) {
      const err = new Error('Request failed with status code 400');
      err.response = { status: 400, data: { message: 'Invalid postal code' } };
      throw err;
    }
    return null;
  });

  const res = await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.body.ok, false);
  assert.deepStrictEqual(res.body.details, { message: 'Invalid postal code' });
});

test('POST /submit refuses an unsigned or unaccepted waiver', async () => {
  const unsigned = await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    signatureDataUrl: '',
  });
  assert.strictEqual(unsigned.status, 400);
  assert.strictEqual(unsigned.body.error, 'missing_signature');

  const unaccepted = await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    agreed: false,
  });
  assert.strictEqual(unaccepted.status, 400);
  assert.strictEqual(unaccepted.body.error, 'waiver_not_accepted');

  assert.strictEqual(
    calls.filter(c => c.url.includes('/prospects')).length,
    0,
    'nothing reaches ABC without a signature'
  );
});

test('the completed webhook carries flat keys GHL can map', async () => {
  stubFullSubmitChain();

  // Salem has no completed-webhook URL configured, so point one in for the test.
  const clubs = require(path.join(ROOT, 'services/waiver/clubs'));
  const salem = clubs.bySlug('salem');
  salem.kioskWaiverCompletedWebhookUrl = 'https://hooks.example.test/completed';

  try {
    await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

    const hook = calls.find(c => c.url === 'https://hooks.example.test/completed');
    assert.ok(hook, 'expected the completed webhook to fire');

    for (const [k, v] of Object.entries(hook.body)) {
      assert.strictEqual(typeof v, 'string', `${k} must be a flat string for GHL mapping`);
    }
    assert.strictEqual(hook.body.abc_member_id, 'ABC-9001');
    assert.strictEqual(hook.body.stage, 'completed');
    assert.strictEqual(hook.body.waiver_signed, 'yes');
    assert.strictEqual(hook.body.photo_captured, 'yes');
    assert.strictEqual(hook.body.how_heard, 'Friend or Family Referral');
    // The health questionnaire and trainer questions are gone from the kiosk.
    assert.ok(!Object.keys(hook.body).some(k => k.startsWith('health_')));
    assert.ok(!Object.keys(hook.body).some(k => k.startsWith('fitness_')));
  } finally {
    salem.kioskWaiverCompletedWebhookUrl = '';
  }
});

// --- round 2: required photo, how-heard, address suggest --------------------

test('POST /submit refuses a check-in with no photo', async () => {
  stubFullSubmitChain();

  const res = await request('POST', '/api/kiosk-waiver/submit', {
    ...SUBMISSION,
    photoDataUrl: '',
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'missing_photo');
  assert.strictEqual(
    calls.filter(c => c.url.includes('/prospects')).length,
    0,
    'nothing reaches ABC without a photo'
  );
});

test('POST /submit carries how-they-heard into the waiver PDF', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  const pdf = calls.find(c => c.url.includes('pdfshift.io'));
  assert.match(pdf.body.source, /How They Heard About Us/);
  assert.match(pdf.body.source, /Friend or Family Referral/);
});

test('the kiosk waiver PDF omits the health and trainer sections entirely', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', SUBMISSION);

  const pdf = calls.find(c => c.url.includes('pdfshift.io'));
  // A table of "N/A" on a signed legal document reads as a broken form.
  assert.ok(!pdf.body.source.includes('HEALTH QUESTIONNAIRE'));
  assert.ok(!pdf.body.source.includes('FITNESS PROFILE'));
  assert.ok(pdf.body.source.includes('WAIVER AGREEMENT'), 'the waiver itself stays');
});

test('GET /address-suggest returns suggestions and never fails the step', async () => {
  respond(({ url }) =>
    url.includes('photon.komoot.io')
      ? {
          status: 200,
          data: {
            features: [
              {
                properties: {
                  housenumber: '482', street: 'Liberty St NE', city: 'Salem',
                  state: 'Oregon', postcode: '97301', countrycode: 'US',
                },
              },
            ],
          },
        }
      : null
  );

  const res = await request('GET', '/api/kiosk-waiver/address-suggest?q=482%20Liberty');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.suggestions[0].line1, '482 Liberty St NE');
  assert.strictEqual(res.body.suggestions[0].state, 'OR');
});

test('GET /address-suggest answers 200 with an empty list when the provider dies', async () => {
  respond(({ url }) => {
    if (url.includes('photon.komoot.io')) throw new Error('ETIMEDOUT');
    return null;
  });

  const res = await request('GET', '/api/kiosk-waiver/address-suggest?q=482%20Liberty');

  assert.strictEqual(res.status, 200, 'the field degrades to a plain input');
  assert.deepStrictEqual(res.body.suggestions, []);
});

// --- phone formatting -------------------------------------------------------
//
// ABC rejects anything that is not exactly 10 digits, and that rejection fails
// the WHOLE prospect, not just the phone. A real check-in died here.

test('a 10-digit number starting with 1 keeps all ten digits', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', { ...SUBMISSION, phone: '1234560087' });

  const prospect = calls.find(c => c.url.includes('/prospects'));
  const personal = prospect.body.prospects[0].prospect.personal;
  // Stripping the leading 1 here left "234560087" and ABC refused the lot.
  assert.strictEqual(personal.primaryPhone, '1234560087');
  assert.strictEqual(personal.mobilePhone, '1234560087');
});

test('an 11-digit number loses only the country code', async () => {
  stubFullSubmitChain();

  await request('POST', '/api/kiosk-waiver/submit', { ...SUBMISSION, phone: '+1 (503) 555-1212' });

  const personal = calls.find(c => c.url.includes('/prospects')).body.prospects[0].prospect.personal;
  assert.strictEqual(personal.primaryPhone, '5035551212');
});

test('an unusable phone is sent empty rather than malformed', async () => {
  stubFullSubmitChain();

  // ABC accepts a prospect with no phone, so a missing number costs a field
  // while a bad one costs the whole person.
  await request('POST', '/api/kiosk-waiver/submit', { ...SUBMISSION, phone: '503555', email: 'dana@example.com' });

  const personal = calls.find(c => c.url.includes('/prospects')).body.prospects[0].prospect.personal;
  assert.strictEqual(personal.primaryPhone, '');
});
