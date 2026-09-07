// Milwaukie: East Side branding, no tour queue, and a completed webhook that
// waits for a staff member.
//
// Three things are worth protecting here and everything below tests one of them:
//
//   1. the other six clubs are untouched — brand, tour queue and webhook timing
//      all still behave exactly as they did
//   2. the deferred webhook fires ONCE, with the outcome merged in, and carries
//      the member details from the ticket rather than from the request
//   3. the ticket cannot be forged, replayed past its expiry, or edited on a
//      tablet sitting in a public lobby

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');

const axios = require('axios');

const ROOT = path.join(__dirname, '..');
const SUPABASE_MODULE = path.join(ROOT, 'lib', 'supabase.js');

// --- stubs ------------------------------------------------------------------

let integrationRows = [];
let tourConfigRow = null;
let rpcRows = [];

// A query builder thin enough to satisfy the three call shapes in play:
// .select() awaited directly, .select().eq().eq() awaited, and .maybeSingle().
function table(name) {
  const result = () => {
    if (name === 'club_integrations') return { data: integrationRows, error: null };
    if (name === 'tour_location_config') return { data: tourConfigRow, error: null };
    return { data: [], error: null };
  };
  const chain = {
    eq: () => chain,
    maybeSingle: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return { select: () => chain };
}

require.cache[require.resolve(SUPABASE_MODULE)] = {
  id: SUPABASE_MODULE,
  filename: SUPABASE_MODULE,
  loaded: true,
  exports: {
    getSupabaseAdmin: () => ({
      from: table,
      rpc: async () => ({ data: rpcRows, error: null }),
    }),
  },
};

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
const hookCalls = () => calls.filter(c => c.url.includes('hooks.example.test'));

const COMPLETED_HOOK = 'https://hooks.example.test/milwaukie-completed';

function stubAbc() {
  respond(({ url }) => {
    if (url.includes('/prospects')) return { status: 200, data: { result: { memberId: 'ABC-9' } } };
    if (url.includes('pdfshift.io')) return { status: 200, data: Buffer.from('%PDF-1.4') };
    if (url.includes('/contacts/upsert')) return { status: 200, data: { contact: { id: 'GHL-9' } } };
    return null;
  });
}

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

test.beforeEach(() => {
  stubAxios();
  integrationRows = [{
    abc_club_number: '31601',
    kiosk_waiver_completed_webhook_url: COMPLETED_HOOK,
    active: true,
  }];
  tourConfigRow = null;
  rpcRows = [];
  require('../services/waiver/integrations').invalidate();
});

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

const MILWAUKIE = {
  location: 'milwaukie',
  firstName: 'Dana',
  lastName: 'Reyes',
  email: 'dana@example.com',
  phone: '(503) 555-1212',
  address1: '482 Liberty St NE',
  city: 'Milwaukie',
  state: 'OR',
  postalCode: '97222',
  dateOfBirth: '1992-03-14',
  gender: 'Female',
  howHeard: 'Instagram',
  photoDataUrl: PNG,
  signatureDataUrl: PNG,
  agreed: true,
};

// --- what the kiosk is told -------------------------------------------------

test('locations carry the brand and the per-club kiosk behaviour', async () => {
  const res = await request('GET', '/api/kiosk-waiver/locations');
  const by = slug => res.body.locations.find(l => l.slug === slug);

  const milwaukie = by('milwaukie');
  assert.strictEqual(milwaukie.brand.name, 'East Side Athletic Club');
  assert.strictEqual(milwaukie.brand.accent, '#111111');
  // The East Side lockup fills the attract screen: 86vw is all the width the
  // stylesheet allows, and the 104vh term is what keeps a 3:1 mark from pushing
  // the headline and the tap prompt off a landscape tablet.
  assert.strictEqual(milwaukie.brand.logoWidth, 'min(86vw, 104vh)');
  assert.strictEqual(milwaukie.displayName, 'East Side Athletic Club');
  assert.strictEqual(milwaukie.kiosk.staffOutcome, true);
  assert.strictEqual(milwaukie.kiosk.tourQueue, false);

  const salem = by('salem');
  assert.strictEqual(salem.brand.name, 'West Coast Strength');
  assert.strictEqual(salem.brand.accent, '#e31e24');
  assert.strictEqual(salem.brand.logoWidth, 'clamp(150px, 26vh, 260px)', 'the badge is unchanged');
  assert.strictEqual(salem.displayName, 'West Coast Strength Salem');
  assert.strictEqual(salem.kiosk.staffOutcome, false, 'unchanged for every other club');
  assert.strictEqual(salem.kiosk.tourQueue, true);
});

test('the club list never leaks the legal entity or the PDF assets', async () => {
  const res = await request('GET', '/api/kiosk-waiver/locations');
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes('legalName'), 'nothing on a tablet renders it');
  assert.ok(!raw.includes('pdfLogo'));
});

// --- the tour queue ---------------------------------------------------------

test('Milwaukie raises no card on the tour queue', async () => {
  const lead = await request('POST', '/api/kiosk-waiver/lead', MILWAUKIE);
  assert.strictEqual(lead.status, 200);
  assert.strictEqual(tourCalls().length, 0, 'there is no queue to raise it on');
  assert.strictEqual(lead.body.tourIntake.skipped, true);

  stubAbc();
  const submit = await request('POST', '/api/kiosk-waiver/submit', MILWAUKIE);
  assert.strictEqual(submit.status, 200);
  assert.strictEqual(tourCalls().length, 0);
});

test('Salem still raises one', async () => {
  respond(({ url }) =>
    url.includes('/webhooks/tour-intake') ? { status: 200, data: { id: 'INTAKE-1' } } : null
  );

  const res = await request('POST', '/api/kiosk-waiver/lead', {
    ...MILWAUKIE,
    location: 'salem',
  });

  assert.strictEqual(res.body.tourIntakeId, 'INTAKE-1');
  assert.strictEqual(tourCalls().length, 1);
});

// --- the deferred webhook ---------------------------------------------------

test('submit holds the completed webhook and hands back a ticket', async () => {
  stubAbc();

  const res = await request('POST', '/api/kiosk-waiver/submit', MILWAUKIE);

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.abcMemberId, 'ABC-9', 'ABC still has the waiver');
  assert.ok(res.body.outcomeTicket, 'the payload rides back to the tablet');
  assert.strictEqual(res.body.steps.webhook.deferred, true);
  assert.strictEqual(hookCalls().length, 0, 'nothing reaches GHL until staff answer');
});

test('every other club still fires it at submit', async () => {
  stubAbc();
  integrationRows = [{
    abc_club_number: '30935',
    kiosk_waiver_completed_webhook_url: COMPLETED_HOOK,
    active: true,
  }];
  require('../services/waiver/integrations').invalidate();

  const res = await request('POST', '/api/kiosk-waiver/submit', {
    ...MILWAUKIE,
    location: 'salem',
  });

  assert.strictEqual(res.body.outcomeTicket, null, 'nothing to wait for');
  assert.strictEqual(hookCalls().length, 1);
  assert.strictEqual(hookCalls()[0].body.stage, 'completed');
});

test('the outcome fires the held webhook with the member and the result together', async () => {
  stubAbc();
  const submit = await request('POST', '/api/kiosk-waiver/submit', MILWAUKIE);

  const res = await request('POST', '/api/kiosk-waiver/outcome', {
    outcomeTicket: submit.body.outcomeTicket,
    tourMember: 'Felix Reyes',
    outcome: 'Started VIP Pass',
    notes: 'Bringing a friend Saturday.',
    dayOneBooked: true,
    referringMemberId: 'M-4021',
    referringMemberName: 'Sam Okafor',
  });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(hookCalls().length, 1, 'exactly one event, not two');

  const sent = hookCalls()[0].body;
  // From the ticket: the tablet never re-sent any of this.
  assert.strictEqual(sent.first_name, 'Dana');
  assert.strictEqual(sent.abc_member_id, 'ABC-9');
  assert.strictEqual(sent.club, 'Milwaukie');
  assert.strictEqual(sent.waiver_signed, 'yes');
  // From the staff member.
  assert.strictEqual(sent.tour_member, 'Felix Reyes');
  assert.strictEqual(sent.tour_outcome, 'Started VIP Pass');
  assert.strictEqual(sent.tour_notes, 'Bringing a friend Saturday.');
  assert.strictEqual(sent.day_one_booked, 'yes');
  assert.strictEqual(sent.referring_member_name, 'Sam Okafor');
  assert.strictEqual(sent.tour_recorded, 'yes');
  assert.ok(sent.outcome_at, 'the gap from submitted_at is the tour');
});

test('an abandoned tablet still reports the check-in, marked as unrecorded', async () => {
  stubAbc();
  const submit = await request('POST', '/api/kiosk-waiver/submit', MILWAUKIE);

  // What the idle timeout sends: no staff member, no outcome.
  const res = await request('POST', '/api/kiosk-waiver/outcome', {
    outcomeTicket: submit.body.outcomeTicket,
  });

  assert.strictEqual(res.status, 200);
  const sent = hookCalls()[0].body;
  assert.strictEqual(sent.first_name, 'Dana', 'the check-in is not lost');
  assert.strictEqual(sent.tour_outcome, '');
  assert.strictEqual(sent.tour_recorded, 'no', 'a workflow branches on this, not on an empty string');
});

test('an outcome the reports do not know is refused', async () => {
  stubAbc();
  const submit = await request('POST', '/api/kiosk-waiver/submit', MILWAUKIE);

  const res = await request('POST', '/api/kiosk-waiver/outcome', {
    outcomeTicket: submit.body.outcomeTicket,
    outcome: 'Sold them a smoothie',
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'unknown_outcome');
  assert.strictEqual(hookCalls().length, 0);
});

// --- the ticket -------------------------------------------------------------

test('an edited ticket cannot put anything into GHL', async () => {
  stubAbc();
  const submit = await request('POST', '/api/kiosk-waiver/submit', MILWAUKIE);

  // Rewrite the payload, keep the signature: what a tampered tablet would send.
  const [body, sig] = submit.body.outcomeTicket.split('.');
  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  decoded.payload.email = 'attacker@example.com';
  const forged =
    `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${sig}`;

  const res = await request('POST', '/api/kiosk-waiver/outcome', {
    outcomeTicket: forged,
    outcome: 'Only Tour',
  });

  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'bad_signature');
  assert.strictEqual(hookCalls().length, 0);
});

test('a ticket with no signature at all is refused', async () => {
  const res = await request('POST', '/api/kiosk-waiver/outcome', {
    outcomeTicket: 'not-a-ticket',
    outcome: 'Only Tour',
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(hookCalls().length, 0);
});

test('a ticket from yesterday is gone rather than merely invalid', async () => {
  const { issueTicket, readTicket, TICKET_TTL_MS } = require('../services/kiosk/outcome');

  const ticket = issueTicket({ location_slug: 'milwaukie' });
  const real = Date.now;
  Date.now = () => real() + TICKET_TTL_MS + 1000;
  try {
    assert.strictEqual(readTicket(ticket).error, 'expired_ticket');
  } finally {
    Date.now = real;
  }

  // A fresh one still reads back cleanly, so the check is the clock and not the
  // signing.
  assert.strictEqual(readTicket(issueTicket({ a: 1 })).payload.a, 1);
});

// --- the outcome step's own lookups ----------------------------------------

test('the staff dropdown comes from the GHL Day One team-member field', async () => {
  respond(({ url }) =>
    url.includes('/customFields')
      ? {
          status: 200,
          data: {
            customFields: [
              { fieldKey: 'contact.first_name', picklistOptions: [] },
              {
                fieldKey: 'contact.day_one_booking_team_member',
                picklistOptions: ['Sam Okafor', 'Felix Reyes'],
              },
            ],
          },
        }
      : null
  );
  tourConfigRow = { day_one_base_url: 'https://book.example.test/day-one', active: true };

  const res = await request('GET', '/api/kiosk-waiver/staff?location=milwaukie');

  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.staff, ['Felix Reyes', 'Sam Okafor'], 'A-Z');
  assert.strictEqual(res.body.source, 'ghl');
  assert.strictEqual(res.body.dayOneUrl, 'https://book.example.test/day-one');
  assert.ok(res.body.outcomes.includes('Started VIP Pass'));
});

test('an unknown club is refused rather than answered with an empty roster', async () => {
  const res = await request('GET', '/api/kiosk-waiver/staff?location=nowhere');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error, 'unknown_location');
});

test('a referral search too short to mean anything queries nothing', async () => {
  const res = await request('GET', '/api/kiosk-waiver/member-search?q=a');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body.members, []);
});

test('a referral search returns members from every club', async () => {
  rpcRows = [
    {
      member_id: 'M-1',
      first_name: 'Sam',
      last_name: 'Okafor',
      email: 's@example.com',
      phone: '(503) 991-9435',
      home_club: 'Salem',
      membership_type: 'A2 CORE',
    },
  ];

  const res = await request('GET', '/api/kiosk-waiver/member-search?q=991-9435');

  assert.strictEqual(res.body.members.length, 1);
  assert.strictEqual(res.body.members[0].name, 'Sam Okafor');
  assert.strictEqual(res.body.members[0].club, 'Salem', 'a referrer often trains elsewhere');
});
