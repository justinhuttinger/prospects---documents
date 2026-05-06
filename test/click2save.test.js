const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const nock = require('nock');

process.env.C2S_WEBHOOK_SECRET = 'test-secret';
process.env.ABC_APP_ID = 'test-app-id';
process.env.ABC_APP_KEY = 'test-app-key';
process.env.PDFSHIFT_API_KEY = 'test-pdfshift-key';
process.env.C2S_RETRY_BASE_MS = '5';

// process.env mutations above MUST happen before requiring the route — RETRY_OPTS
// and REPLAY_WINDOW_SEC are read at module-load time.
const handler = require('../routes/click2save');

function makeApp() {
  const app = express();
  app.post('/webhook/click2save', express.raw({ type: 'application/json' }), handler);
  return app;
}

function sign(rawJson, secret = 'test-secret') {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawJson).digest('hex');
}

function nowSec() { return Math.floor(Date.now() / 1000); }

function send(app, payload, { secret, timestampSec, signatureOverride } = {}) {
  const raw = JSON.stringify(payload);
  const sig = signatureOverride || sign(raw, secret);
  return request(app)
    .post('/webhook/click2save')
    .set('Content-Type', 'application/json')
    .set('X-C2S-Signature', sig)
    .set('X-C2S-Request-ID', payload.requestId)
    .set('X-C2S-Timestamp', String(timestampSec || nowSec()))
    .set('User-Agent', 'Click2Save-Webhook/1.0')
    .send(raw);
}

const SALEM_CLUB_NUMBER = '30935';

function cancelPayload(overrides = {}) {
  return {
    requestId: overrides.requestId || crypto.randomUUID(),
    requestType: 'CANCEL',
    occurredAt: '2026-05-06T10:30:00.000Z',
    producer: 'click2save',
    data: {
      brandId: 'brand-123',
      clubCode: SALEM_CLUB_NUMBER,
      member: {
        memberId: 'M001',
        barcode: 'BC001',
        agreementId: 'AG-001',
        email: 'jane@example.com',
      },
      result: {
        status: 'completed',
        effectiveDate: '2026-05-31',
        cancelCode: 'VOLUNTARY',
        cancelReason: 'Moving',
        buyerRemorseApplied: false,
      },
      financials: {
        pastDueBalance: '0.00', pastDueCollected: '0.00',
        nextDueAmount: '29.99', nextDueCollected: '0.00',
        buyoutAmount: '0.00', buyoutCollected: '0.00',
      },
    },
  };
}

function freezePayload(overrides = {}) {
  return {
    requestId: overrides.requestId || crypto.randomUUID(),
    requestType: 'FREEZE',
    occurredAt: '2026-05-06T10:30:00.000Z',
    producer: 'click2save',
    data: {
      brandId: 'brand-123',
      clubCode: SALEM_CLUB_NUMBER,
      member: {
        memberId: 'M001', barcode: 'BC001', agreementId: 'AG-001', email: 'jane@example.com',
      },
      result: {
        status: 'completed',
        freezeCode: 'MEDICAL',
        freezeReason: "Doctor's recommendation",
        freezeType: 'billing',
        freezePeriod: 60,
        startDate: '2026-05-10',
        endDate: '2026-07-10',
        fee: '10.00',
      },
      financials: {
        pastDueBalance: '0.00', pastDueCollected: '0.00',
        nextDueAmount: '29.99', nextDueCollected: '0.00',
        buyoutCollected: '0.00',
      },
    },
  };
}

function offerPayload(overrides = {}) {
  return {
    requestId: overrides.requestId || crypto.randomUUID(),
    requestType: 'OFFER',
    occurredAt: '2026-05-06T10:30:00.000Z',
    producer: 'click2save',
    data: {
      brandId: 'brand-123',
      clubCode: SALEM_CLUB_NUMBER,
      member: {
        memberId: 'M001', barcode: 'BC001', agreementId: 'AG-001', email: 'jane@example.com',
      },
      result: {
        status: 'completed',
        offers: [
          { offer: 'MONETARY', status: 'applied', dict: { discountDues: { value: '15.00', type: 'PERCENTAGE', durationPeriod: 3 } } },
          { offer: 'POS', status: 'applied', memberId: 'M001', array: [{ sku: 'YOGA-MAT-BLUE' }, { sku: 'PT-SESSION-3PK' }] },
          { offer: 'CREDIT', status: 'applied', memberId: 'M001', dict: { amount: '41.79', comments: 'Save Offer' } },
        ],
      },
      financials: {
        pastDueBalance: '0.00', pastDueCollected: '0.00',
        nextDueAmount: '29.99', nextDueCollected: '29.99',
        buyoutCollected: '0.00',
      },
    },
  };
}

const ABC = 'https://api.abcfinancial.com';
const PDF = 'https://api.pdfshift.io';

function mockMemberGet({ clubNumber = SALEM_CLUB_NUMBER, memberId = 'M001', firstName = 'Jane', lastName = 'Doe' } = {}) {
  return nock(ABC)
    .get(`/rest/${clubNumber}/members/${memberId}`)
    .reply(200, { members: [{ personal: { firstName, lastName } }] });
}

function mockPdfShift({ times = 1 } = {}) {
  return nock(PDF)
    .post('/v3/convert/pdf')
    .times(times)
    .reply(200, Buffer.from('%PDF-1.4 fake'));
}

function mockDocPost({ clubNumber = SALEM_CLUB_NUMBER, memberId = 'M001', status = 200, times = 1, capture } = {}) {
  return nock(ABC)
    .post(`/rest/${clubNumber}/members/documents/${memberId}`, body => {
      if (capture) capture(body);
      return true;
    })
    .times(times)
    .reply(status, status === 200 ? { result: 'ok' } : { error: 'boom' });
}

test.beforeEach(() => { nock.cleanAll(); });
test.after(() => { nock.cleanAll(); nock.enableNetConnect(); });

test('CANCEL: valid signed payload uploads Cancel Document', async () => {
  let captured;
  const app = makeApp();
  const memberScope = mockMemberGet();
  const pdfScope = mockPdfShift();
  const docScope = mockDocPost({ capture: b => { captured = b; } });

  const res = await send(app, cancelPayload({ requestId: 'r-cancel-1' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.strictEqual(memberScope.isDone(), true);
  assert.strictEqual(pdfScope.isDone(), true);
  assert.strictEqual(docScope.isDone(), true);
  assert.match(captured.documentName, /^Cancel Document \(\d{4}-\d{2}-\d{2}\)\.pdf$/);
  assert.strictEqual(captured.documentType, 'pdf');
  assert.strictEqual(captured.imageType, 'member_document');
});

test('OFFER: multiple offer subtypes are rendered into the HTML', async () => {
  let renderedHtml;
  const app = makeApp();
  const memberScope = mockMemberGet();
  const pdfScope = nock(PDF).post('/v3/convert/pdf', body => { renderedHtml = body.source; return true; }).reply(200, Buffer.from('%PDF'));
  let captured;
  const docScope = mockDocPost({ capture: b => { captured = b; } });

  const res = await send(app, offerPayload({ requestId: 'r-offer-1' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(memberScope.isDone(), true);
  assert.strictEqual(pdfScope.isDone(), true);
  assert.strictEqual(docScope.isDone(), true);
  assert.match(captured.documentName, /^Save Document \(\d{4}-\d{2}-\d{2}\)\.pdf$/);
  assert.ok(renderedHtml.includes('MONETARY'));
  assert.ok(renderedHtml.includes('YOGA-MAT-BLUE'));
  assert.ok(renderedHtml.includes('CREDIT'));
});

test('FREEZE: produces Save Document', async () => {
  let captured;
  const app = makeApp();
  const memberScope = mockMemberGet();
  const pdfScope = mockPdfShift();
  const docScope = mockDocPost({ capture: b => { captured = b; } });

  const res = await send(app, freezePayload({ requestId: 'r-freeze-1' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(memberScope.isDone(), true);
  assert.strictEqual(pdfScope.isDone(), true);
  assert.strictEqual(docScope.isDone(), true);
  assert.match(captured.documentName, /^Save Document \(\d{4}-\d{2}-\d{2}\)\.pdf$/);
});

test('Bad signature returns 401 and makes no downstream calls', async () => {
  const app = makeApp();
  const memberScope = mockMemberGet();
  const pdfScope = mockPdfShift();
  const docScope = mockDocPost();

  const res = await send(app, cancelPayload({ requestId: 'r-bad-sig' }), { signatureOverride: 'sha256=deadbeef' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(memberScope.isDone(), false);
  assert.strictEqual(pdfScope.isDone(), false);
  assert.strictEqual(docScope.isDone(), false);
});

test('Stale timestamp (>5 min) returns 401 and makes no downstream calls', async () => {
  const app = makeApp();
  const memberScope = mockMemberGet();

  const res = await send(app, cancelPayload({ requestId: 'r-stale' }), { timestampSec: nowSec() - 1000 });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(memberScope.isDone(), false);
});

test('Unknown clubCode returns 200 with no ABC calls', async () => {
  const app = makeApp();
  const memberScope = mockMemberGet({ clubNumber: '99999' });

  const payload = cancelPayload({ requestId: 'r-bad-club' });
  payload.data.clubCode = '99999';
  const res = await send(app, payload);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.skipped, 'unknown_club');
  assert.strictEqual(memberScope.isDone(), false);
});

test('Unknown requestType returns 200 with no ABC calls', async () => {
  const app = makeApp();
  const memberScope = mockMemberGet();

  const payload = cancelPayload({ requestId: 'r-bad-type' });
  payload.requestType = 'WHAT';
  const res = await send(app, payload);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.skipped, 'unknown_request_type');
  assert.strictEqual(memberScope.isDone(), false);
});

test('Member not found (ABC GET 404) returns 200 with no document POST', async () => {
  const app = makeApp();
  nock(ABC).get(`/rest/${SALEM_CLUB_NUMBER}/members/M001`).reply(404, { error: 'not found' });
  const docScope = mockDocPost();

  const res = await send(app, cancelPayload({ requestId: 'r-no-member' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.skipped, 'member_not_found');
  assert.strictEqual(docScope.isDone(), false);
});

test('ABC document POST fails 5xx three times → returns 500', async () => {
  const app = makeApp();
  mockMemberGet();
  mockPdfShift();
  nock(ABC)
    .post(`/rest/${SALEM_CLUB_NUMBER}/members/documents/M001`)
    .times(3)
    .reply(503, { error: 'service unavailable' });

  const res = await send(app, cancelPayload({ requestId: 'r-503' }));
  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.success, false);
});

test('Internal retry succeeds on attempt 2 → returns 200', async () => {
  const app = makeApp();
  mockMemberGet();
  mockPdfShift();
  nock(ABC)
    .post(`/rest/${SALEM_CLUB_NUMBER}/members/documents/M001`)
    .reply(503, { error: 'transient' });
  nock(ABC)
    .post(`/rest/${SALEM_CLUB_NUMBER}/members/documents/M001`)
    .reply(200, { result: 'ok' });

  const res = await send(app, cancelPayload({ requestId: 'r-retry' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});
