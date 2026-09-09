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
let outcomeRows = null;      // null = serve the live vocabulary below
let insertedTours = [];
let insertFails = false;

// The live tour_outcomes rows. VIP is 14 days, not 7 -- and Only Tour and
// Custom Pass both have a null length while meaning opposite things, which is
// why grants_pass has to be read instead of the number.
const OUTCOME_ROWS = [
  { outcome: 'Membership Sale', label: 'Membership Sale', is_sale: true, grants_pass: false, default_pass_days: null, sort_order: 10 },
  { outcome: 'Started Trial', label: 'Started Trial', is_sale: false, grants_pass: true, default_pass_days: 7, sort_order: 20 },
  { outcome: 'Started VIP Pass', label: 'Started VIP Pass', is_sale: false, grants_pass: true, default_pass_days: 14, sort_order: 30 },
  { outcome: 'Only Tour', label: 'Only Tour', is_sale: false, grants_pass: false, default_pass_days: null, sort_order: 40 },
  { outcome: 'Custom Pass', label: 'Custom Pass', is_sale: false, grants_pass: true, default_pass_days: null, sort_order: 50 },
];

// A query builder thin enough for the call shapes in play: .select() awaited
// directly, .select().eq().eq(), .maybeSingle(), .order(), and the insert chain.
function table(name) {
  const result = () => {
    if (name === 'club_integrations') return { data: integrationRows, error: null };
    if (name === 'tour_location_config') return { data: tourConfigRow, error: null };
    if (name === 'tour_outcomes') return { data: outcomeRows === null ? OUTCOME_ROWS : outcomeRows, error: null };
    if (name === 'locations') return { data: { id: 'LOC-UUID-1' }, error: null };
    if (name === 'abc_employees') {
      return { data: [{ employee_id: 'EMP-77', full_name: 'Felix Reyes', status: 'active' }], error: null };
    }
    return { data: [], error: null };
  };
  const chain = {
    eq: () => chain,
    order: () => chain,
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return {
    select: () => chain,
    insert: row => {
      if (name === 'tour_intakes') {
        if (insertFails) {
          return { select: () => ({ single: async () => ({ data: null, error: { message: 'insert refused' } }) }) };
        }
        insertedTours.push(row);
      }
      return { select: () => ({ single: async () => ({ data: { id: 'TOUR-1' }, error: null }) }) };
    },
  };
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

// Today plus N days on the club's clock, as MM-DD-YYYY. Derived here from Intl
// rather than from the code under test, so the assertion is an independent
// check of the sum and not a restatement of it.
function expectedEnd(days) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())) p[type] = value;

  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)));
  d.setUTCDate(d.getUTCDate() + days);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${d.getUTCFullYear()}`;
}

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
  outcomeRows = null;
  insertedTours = [];
  insertFails = false;
  require('../services/waiver/integrations').invalidate();
  require('../services/kiosk/outcomes').invalidate();
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
  // Both terms are 60% of the full-bleed pair they replaced, so the mark keeps
  // its proportions and the vh term still caps how tall it can get on a
  // landscape tablet.
  assert.strictEqual(milwaukie.brand.logoWidth, 'min(52vw, 62vh)');
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
  // The gap from submitted_at is the tour. Both go out on the club's clock in
  // the shape a person writes a time, because GHL shows them to one.
  const HUMAN = /^\d{2}\/\d{2}\/\d{4} \| \d{1,2}:\d{2} (AM|PM)$/;
  assert.match(sent.outcome_at, HUMAN);
  assert.match(sent.submitted_at, HUMAN);
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
  // How the tablet knows a custom pass needs a length without hardcoding which
  // outcome that is.
  assert.strictEqual(res.body.passDays['Started Trial'], 7);
  assert.strictEqual(res.body.passDays['Custom Pass'], null);
  assert.ok(!('Only Tour' in res.body.passDays), 'a tour that went nowhere writes nothing');
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


// --- the ABC pass -----------------------------------------------------------
//
// The gap this closes: recording "Started Trial" used to fire the GHL webhook
// and nothing else, so ABC never heard about the trial, isActive stayed false,
// and the member was told they had access and then bounced off the door.

const abcCalls = () => calls.filter(c => c.url.includes('/prospects/') || c.url.includes('/members/'));

function stubProspect() {
  respond(({ method, url }) => {
    if (method === 'get' && url.includes('/prospects/')) {
      return { status: 200, data: { prospects: [{ personal: { firstName: 'Dana', lastName: 'Reyes' }, agreement: {} }] } };
    }
    if (method === 'put' && url.includes('/prospects/')) return { status: 200, data: { status: { message: 'success' } } };
    if (method === 'post' && url.includes('/members/alerts/')) {
      return { status: 200, data: { status: { message: 'success' } } };
    }
    return null;
  });
}

// /submit posts its own NEW PROFILE alert as part of the waiver pipeline, so
// anything asserting about alerts has to look only at what the OUTCOME did.
let outcomeStart = 0;
const afterOutcome = () => calls.slice(outcomeStart);

async function submitThenOutcome(outcomeBody) {
  stubProspect();
  stubAbc();
  // A real session always carries the contact id /lead returned, and the
  // reporting row needs it to join the tour to the GHL contact.
  const submit = await request('POST', '/api/kiosk-waiver/submit', {
    ...MILWAUKIE,
    contactId: 'GHL-9',
  });
  outcomeStart = calls.length;
  return request('POST', '/api/kiosk-waiver/outcome', {
    outcomeTicket: submit.body.outcomeTicket,
    ...outcomeBody,
  });
}

test('a trial grants seven days in ABC and alerts the front desk', async () => {
  const res = await submitThenOutcome({ outcome: 'Started Trial' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.pass.granted, true);
  assert.strictEqual(res.body.pass.days, 7);

  const put = afterOutcome().find(c => c.method === 'put' && c.url.includes('/prospects/'));
  assert.ok(put, 'the agreement write is what flips isActive, not the alert');
  assert.strictEqual(put.body.prospect.agreement.visitsAllowed, '7');
  assert.ok(put.body.prospect.agreement.expirationDate, 'the door checks this');
  // ABC 500s on a prospect PUT with no `personal`, however little of it changes.
  assert.ok(put.body.prospect.personal.firstName);

  const alert = afterOutcome().find(c => c.url.includes('/members/alerts/'));
  assert.ok(alert, 'the desk needs to see the pass on the next scan');
  assert.match(alert.body.text, /^PASS ACTIVE TO /);
  // Alerts cannot be listed, edited or deleted through the API, so one without
  // an expiry is permanent clutter only DataTrak can clear.
  assert.ok(alert.body.expirationDate, 'a persistent alert MUST expire');
});

test('the expiration reaches GHL, so a workflow can quote the date', async () => {
  const res = await submitThenOutcome({ outcome: 'Started Trial' });

  assert.strictEqual(res.status, 200);
  const sent = hookCalls()[0].body;
  assert.strictEqual(sent.pass_days, '7');
  assert.match(sent.pass_expiration_date, /^\d{2}-\d{2}-\d{4}$/);
  assert.strictEqual(sent.pass_mode, 'full');

  // The sum, not just the shape: seven days from today on the club's clock.
  assert.strictEqual(sent.pass_expiration_date, expectedEnd(7));
});

test('a pass ABC refused still quotes the date staff promised', async () => {
  // The window a workflow tells the member about cannot depend on ABC being
  // up. Without the fallback this went out empty and a "your pass ends on"
  // message would have quoted nothing.
  stubAbc();
  // Only the outcome's write fails. The trailing slash matches the PUT to
  // /prospects/{id}, never the POST that creates one during submit.
  respond(({ url }) => {
    if (url.includes('/prospects/') || url.includes('/members/alerts/')) {
      throw new Error('ECONNREFUSED');
    }
    return null;
  });

  const res = await submitThenOutcome({ outcome: 'Custom Pass', passDays: 14 });

  assert.strictEqual(res.status, 200, 'the outcome is still recorded');
  assert.strictEqual(res.body.pass.granted, false, 'ABC really did refuse');
  const sent = hookCalls()[0].body;
  assert.strictEqual(sent.pass_days, '14');
  assert.strictEqual(sent.pass_expiration_date, expectedEnd(14));
});

test('an outcome that grants nothing sends no end date', async () => {
  const res = await submitThenOutcome({ outcome: 'Only Tour', passDays: 30 });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(hookCalls()[0].body.pass_expiration_date, '');
});

test('a custom pass uses the number staff entered', async () => {
  const res = await submitThenOutcome({ outcome: 'Custom Pass', passDays: 21 });

  assert.strictEqual(res.body.pass.days, 21);
  const put = afterOutcome().find(c => c.method === 'put' && c.url.includes('/prospects/'));
  assert.strictEqual(put.body.prospect.agreement.visitsAllowed, '21');
});

test('a custom pass with no number writes nothing rather than guessing', async () => {
  const res = await submitThenOutcome({ outcome: 'Custom Pass' });

  assert.strictEqual(res.status, 200, 'the outcome is still recorded');
  assert.strictEqual(res.body.pass.granted, false);
  assert.strictEqual(res.body.pass.error, 'invalid_days');
  assert.strictEqual(hookCalls().length, 1, 'GHL still hears about the tour');
  assert.strictEqual(hookCalls()[0].body.pass_days, '');
});

test('a wildly long pass is refused', async () => {
  const res = await submitThenOutcome({ outcome: 'Custom Pass', passDays: 9999 });
  assert.strictEqual(res.body.pass.error, 'invalid_days');
});

test('a tour that went nowhere leaves the ABC record alone', async () => {
  const res = await submitThenOutcome({ outcome: 'Only Tour' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.pass.granted, false);
  assert.strictEqual(
    afterOutcome().filter(c => c.url.includes('/members/alerts/')).length,
    0,
    'an undeletable alert for a tour nobody acted on is permanent clutter'
  );
});

test('a membership sale grants no pass: there is no trial window left to matter', async () => {
  const res = await submitThenOutcome({ outcome: 'Membership Sale' });
  assert.strictEqual(res.body.pass.granted, false);
  assert.strictEqual(hookCalls()[0].body.tour_outcome, 'Membership Sale');
});

test('an ABC outage costs the pass, never the outcome', async () => {
  stubAbc();
  respond(({ url }) => {
    if (url.includes('/prospects/') || url.includes('/members/alerts/')) {
      throw new Error('ECONNREFUSED');
    }
    return null;
  });

  const submit = await request('POST', '/api/kiosk-waiver/submit', MILWAUKIE);
  const res = await request('POST', '/api/kiosk-waiver/outcome', {
    outcomeTicket: submit.body.outcomeTicket,
    outcome: 'Started Trial',
  });

  assert.strictEqual(res.status, 200, 'staff are standing there; do not fail on them');
  assert.strictEqual(res.body.pass.granted, false);
  assert.strictEqual(hookCalls().length, 1, 'the tour still reached GHL');
  assert.strictEqual(hookCalls()[0].body.tour_outcome, 'Started Trial');
});

// --- the vocabulary ---------------------------------------------------------
//
// tour_outcomes is the portal's source of truth: which outcomes exist, which
// grant ABC access, and for how long. Hardcoding any of it here is how the two
// halves drift, and is how a VIP pass ended up seven days instead of fourteen.

test('the outcome list and its rules come from the table', async () => {
  const res = await request('GET', '/api/kiosk-waiver/staff?location=milwaukie');

  assert.deepStrictEqual(res.body.outcomes, [
    'Membership Sale', 'Started Trial', 'Started VIP Pass', 'Only Tour', 'Custom Pass',
  ], 'in the order sort_order asks for');

  const vip = res.body.outcomeRules.find(r => r.outcome === 'Started VIP Pass');
  assert.strictEqual(vip.defaultPassDays, 14, 'a VIP pass is fourteen days');
  assert.strictEqual(vip.grantsPass, true);

  const sale = res.body.outcomeRules.find(r => r.outcome === 'Membership Sale');
  assert.strictEqual(sale.isSale, true, 'the only outcome Tour Conversion counts');
});

test('a VIP pass grants fourteen days, not a trial seven', async () => {
  const res = await submitThenOutcome({ outcome: 'Started VIP Pass' });

  assert.strictEqual(res.body.pass.days, 14);
  const put = afterOutcome().find(c => c.method === 'put' && c.url.includes('/prospects/'));
  assert.strictEqual(put.body.prospect.agreement.visitsAllowed, '14');
});

test('granting reads grants_pass, never a missing day count', async () => {
  // The trap the API doc calls out: Only Tour and Custom Pass BOTH have a null
  // default and mean opposite things. Inferring from the number would hand a
  // pass to everybody who merely toured.
  const onlyTour = OUTCOME_ROWS.find(r => r.outcome === 'Only Tour');
  const customPass = OUTCOME_ROWS.find(r => r.outcome === 'Custom Pass');
  assert.strictEqual(onlyTour.default_pass_days, customPass.default_pass_days);
  assert.notStrictEqual(onlyTour.grants_pass, customPass.grants_pass);

  const res = await submitThenOutcome({ outcome: 'Only Tour', passDays: 30 });
  assert.strictEqual(res.body.pass.granted, false, 'a length sent for it changes nothing');
  assert.strictEqual(afterOutcome().filter(c => c.url.includes('/members/alerts/')).length, 0);
});

test('a new outcome in the table needs no deploy here', async () => {
  outcomeRows = [
    ...OUTCOME_ROWS,
    { outcome: 'Started Punch Card', label: 'Started Punch Card', is_sale: false, grants_pass: true, default_pass_days: 30, sort_order: 60 },
  ];
  require('../services/kiosk/outcomes').invalidate();

  const res = await submitThenOutcome({ outcome: 'Started Punch Card' });
  assert.strictEqual(res.body.pass.days, 30);
  assert.strictEqual(res.body.tour.recorded, true);
});

test('an unreachable table still takes the check-in', async () => {
  outcomeRows = [];
  require('../services/kiosk/outcomes').invalidate();

  // Falls back to the built-in copy rather than offering no outcomes at all.
  const res = await request('GET', '/api/kiosk-waiver/staff?location=milwaukie');
  assert.ok(res.body.outcomes.includes('Started Trial'));
  assert.strictEqual(
    res.body.outcomeRules.find(r => r.outcome === 'Started VIP Pass').defaultPassDays,
    14,
    'the fallback is a copy of the live rows, VIP included'
  );
});

// --- the reporting row ------------------------------------------------------
//
// Milwaukie raises no card on the tour queue, so without this write its tours
// live in ABC and GHL and nowhere the reports can see them.

test('a recorded tour lands where the reports read it', async () => {
  const res = await submitThenOutcome({
    outcome: 'Started Trial',
    tourMember: 'Felix Reyes',
    notes: 'Liked the turf.',
  });

  assert.strictEqual(res.body.tour.recorded, true);
  assert.strictEqual(insertedTours.length, 1);

  const row = insertedTours[0];
  // Only status 'completed' is counted; 'ready' is a check-in nobody closed out.
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.outcome, 'Started Trial');
  assert.strictEqual(row.club_number, '31601');
  assert.strictEqual(row.pass_days, 7);
  assert.strictEqual(row.notes, 'Liked the turf.');
  // The only field joining a tour to a membership, so the only way tours-given
  // to members-signed can ever be measured.
  assert.strictEqual(row.abc_member_id, 'ABC-9');
  assert.strictEqual(row.ghl_contact_id, 'GHL-9');
  assert.strictEqual(row.contact_name, 'Dana Reyes');
  assert.strictEqual(row.location_id, 'LOC-UUID-1');
});

test('credit goes to whoever walked them around', async () => {
  await submitThenOutcome({ outcome: 'Only Tour', tourMember: 'Felix Reyes' });

  const row = insertedTours[0];
  assert.strictEqual(row.given_by_name, 'Felix Reyes');
  assert.strictEqual(row.given_by_employee_id, 'EMP-77', 'resolved from the club roster');
  // Nobody logs into the kiosk, so there is no session to credit. Filling this
  // with the tour giver would be the booking-vs-servicing confusion again.
  assert.strictEqual(row.completed_by, null);
});

test('an unknown name still records the tour under that name', async () => {
  await submitThenOutcome({ outcome: 'Only Tour', tourMember: 'Someone Not On The Roster' });

  const row = insertedTours[0];
  assert.strictEqual(row.given_by_name, 'Someone Not On The Roster');
  assert.strictEqual(row.given_by_employee_id, null, 'a name is an accepted fallback');
});

test('an abandoned tablet reports a check-in, never a tour', async () => {
  // What the idle timeout sends. Recording this as a tour would overstate
  // Tours Given for every tablet nobody came back to.
  const res = await submitThenOutcome({});

  assert.strictEqual(res.status, 200);
  assert.strictEqual(insertedTours.length, 0);
  assert.strictEqual(res.body.tour.skipped, true);
  assert.strictEqual(hookCalls().length, 1, 'GHL still hears about the check-in');
});

test('a reporting write that fails costs the row, never the outcome', async () => {
  insertFails = true;

  const res = await submitThenOutcome({ outcome: 'Started Trial' });

  assert.strictEqual(res.status, 200, 'staff are standing there');
  assert.strictEqual(res.body.tour.recorded, false);
  assert.ok(res.body.tour.error);
  assert.strictEqual(res.body.pass.granted, true, 'they still got their pass');
  assert.strictEqual(hookCalls().length, 1, 'GHL still heard about it');
});
