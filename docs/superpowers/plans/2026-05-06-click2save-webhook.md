# Click2Save Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `POST /webhook/click2save` endpoint that receives HMAC-signed Click2Save webhooks (CANCEL / FREEZE / OFFER), generates a branded PDF documenting the event, and uploads it to the member's ABC Financial document store.

**Architecture:** New feature lives in dedicated modules (`lib/`, `routes/`, `templates/`) rather than expanding `index.js`. Existing `/webhook/ghl-form` flow is untouched. External services (PDF Shift, ABC Financial) are wrapped in thin clients with bounded retry-with-backoff for transient errors.

**Tech Stack:** Node.js 18+, Express 4, axios, PDF Shift API, ABC Financial REST API, `node:test` for tests, supertest for HTTP, nock for axios mocking.

**Spec:** `docs/superpowers/specs/2026-05-06-click2save-webhook-design.md`

---

## File Map

**Created:**
- `lib/c2s-signature.js` — HMAC verify + timestamp freshness
- `lib/retry.js` — bounded retry with exponential backoff
- `lib/clubs.js` — clubs-config lookup
- `lib/pdfshift.js` — HTML → PDF buffer
- `lib/abc.js` — ABC member GET + document POST
- `templates/cancel.js` — CANCEL HTML template
- `templates/save.js` — FREEZE/OFFER HTML template
- `routes/click2save.js` — Express handler
- `test/c2s-signature.test.js` — unit
- `test/retry.test.js` — unit
- `test/click2save.test.js` — integration (10 cases)

**Modified:**
- `index.js` — mount new route, export `app` for tests
- `package.json` — add `supertest` and `nock` to devDependencies, add `test` script

---

## Task 1: Project setup — devDependencies and test script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add devDependencies and test script**

Replace `package.json` contents with:

```json
{
  "name": "wcs-pdf-service",
  "version": "1.0.0",
  "description": "PDF generation service for West Coast Strength form submissions",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "node --test test/"
  },
  "keywords": ["pdf", "wcs", "forms"],
  "author": "WCS",
  "license": "ISC",
  "dependencies": {
    "express": "^4.18.2",
    "puppeteer-core": "^23.11.1",
    "@sparticuz/chromium": "^131.0.0",
    "axios": "^1.6.2",
    "pdfkit": "^0.15.0"
  },
  "devDependencies": {
    "nock": "^13.5.4",
    "supertest": "^7.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: installs supertest + nock, lockfile (if any) updates, `node_modules/.bin/` has no new entries we need.

- [ ] **Step 3: Verify test runner works on empty suite**

Run: `mkdir -p test && node --test test/`
Expected: `# tests 0` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add supertest + nock devDeps and npm test script"
```

---

## Task 2: lib/c2s-signature.js — HMAC verify + timestamp freshness

**Files:**
- Create: `lib/c2s-signature.js`
- Test: `test/c2s-signature.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/c2s-signature.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifySignature, isFresh } = require('../lib/c2s-signature');

const SECRET = 'test-secret';
const BODY = '{"hello":"world"}';
const VALID_SIG = 'sha256=' + crypto.createHmac('sha256', SECRET).update(BODY).digest('hex');

test('verifySignature returns true for a valid signature', () => {
  assert.strictEqual(verifySignature(BODY, VALID_SIG, SECRET), true);
});

test('verifySignature returns false when the prefix is missing', () => {
  const noPrefix = VALID_SIG.slice(7);
  assert.strictEqual(verifySignature(BODY, noPrefix, SECRET), false);
});

test('verifySignature returns false when the body has been tampered', () => {
  assert.strictEqual(verifySignature(BODY + 'x', VALID_SIG, SECRET), false);
});

test('verifySignature returns false when the secret is wrong', () => {
  assert.strictEqual(verifySignature(BODY, VALID_SIG, 'other-secret'), false);
});

test('verifySignature returns false when the header is empty/missing', () => {
  assert.strictEqual(verifySignature(BODY, '', SECRET), false);
  assert.strictEqual(verifySignature(BODY, undefined, SECRET), false);
});

test('verifySignature returns false when received hex length differs', () => {
  assert.strictEqual(verifySignature(BODY, 'sha256=abcd', SECRET), false);
});

test('isFresh returns true within the window', () => {
  const now = 1_700_000_000;
  assert.strictEqual(isFresh(String(now - 100), 300, now), true);
  assert.strictEqual(isFresh(String(now + 100), 300, now), true);
});

test('isFresh returns false outside the window', () => {
  const now = 1_700_000_000;
  assert.strictEqual(isFresh(String(now - 400), 300, now), false);
  assert.strictEqual(isFresh(String(now + 400), 300, now), false);
});

test('isFresh returns false for non-numeric input', () => {
  const now = 1_700_000_000;
  assert.strictEqual(isFresh('not-a-number', 300, now), false);
  assert.strictEqual(isFresh('', 300, now), false);
  assert.strictEqual(isFresh(undefined, 300, now), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '../lib/c2s-signature'".

- [ ] **Step 3: Implement the module**

Create `lib/c2s-signature.js`:

```js
const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  const received = signatureHeader.slice(7);
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  if (received.length !== computed.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(received, 'hex'),
      Buffer.from(computed, 'hex')
    );
  } catch {
    return false;
  }
}

function isFresh(timestampHeader, windowSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSec - ts) <= windowSec;
}

module.exports = { verifySignature, isFresh };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/c2s-signature.js test/c2s-signature.test.js
git commit -m "feat: add HMAC-SHA256 verify + timestamp freshness for C2S"
```

---

## Task 3: lib/retry.js — bounded retry with exponential backoff

**Files:**
- Create: `lib/retry.js`
- Test: `test/retry.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/retry.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { retryWithBackoff, defaultIsRetryable } = require('../lib/retry');

test('retryWithBackoff returns first-attempt result without retrying', async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    return 'ok';
  }, { attempts: 3, baseMs: 1 });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 1);
});

test('retryWithBackoff retries retryable errors and eventually succeeds', async () => {
  let calls = 0;
  const result = await retryWithBackoff(async () => {
    calls++;
    if (calls < 3) {
      const err = new Error('boom');
      err.response = { status: 503 };
      throw err;
    }
    return 'ok';
  }, { attempts: 3, baseMs: 1 });
  assert.strictEqual(result, 'ok');
  assert.strictEqual(calls, 3);
});

test('retryWithBackoff stops after attempts exhausted and rethrows last error', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(async () => {
      calls++;
      const err = new Error('boom');
      err.response = { status: 502 };
      throw err;
    }, { attempts: 3, baseMs: 1 }),
    /boom/
  );
  assert.strictEqual(calls, 3);
});

test('retryWithBackoff does not retry non-retryable errors', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithBackoff(async () => {
      calls++;
      const err = new Error('bad request');
      err.response = { status: 400 };
      throw err;
    }, { attempts: 3, baseMs: 1 }),
    /bad request/
  );
  assert.strictEqual(calls, 1);
});

test('defaultIsRetryable: 5xx, 429, network codes are retryable; 4xx is not', () => {
  assert.strictEqual(defaultIsRetryable({ response: { status: 500 } }), true);
  assert.strictEqual(defaultIsRetryable({ response: { status: 502 } }), true);
  assert.strictEqual(defaultIsRetryable({ response: { status: 429 } }), true);
  assert.strictEqual(defaultIsRetryable({ code: 'ECONNRESET' }), true);
  assert.strictEqual(defaultIsRetryable({ code: 'ETIMEDOUT' }), true);
  assert.strictEqual(defaultIsRetryable({ response: { status: 400 } }), false);
  assert.strictEqual(defaultIsRetryable({ response: { status: 404 } }), false);
  assert.strictEqual(defaultIsRetryable({}), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '../lib/retry'".

- [ ] **Step 3: Implement the module**

Create `lib/retry.js`:

```js
function defaultIsRetryable(err) {
  if (!err) return false;
  const code = err.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return true;
  }
  const status = err.response && err.response.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, { attempts = 3, baseMs = 500, isRetryable = defaultIsRetryable } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (!isRetryable(err)) break;
      await sleep(baseMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

module.exports = { retryWithBackoff, defaultIsRetryable };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all signature tests + 5 retry tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/retry.js test/retry.test.js
git commit -m "feat: add bounded retry-with-backoff utility"
```

---

## Task 4: lib/clubs.js — clubs-config lookup

**Files:**
- Create: `lib/clubs.js`

- [ ] **Step 1: Implement the module**

Create `lib/clubs.js`:

```js
const fs = require('fs');
const path = require('path');

let cached;

function loadConfig() {
  if (!cached) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'clubs-config.json'), 'utf8');
    cached = JSON.parse(text);
  }
  return cached;
}

function findByClubNumber(clubNumber) {
  if (!clubNumber) return null;
  const cfg = loadConfig();
  const target = String(clubNumber);
  return (cfg.clubs || []).find(c => c.enabled && String(c.clubNumber) === target) || null;
}

module.exports = { findByClubNumber };
```

- [ ] **Step 2: Smoke test from the command line**

Run:
```bash
node -e "console.log(require('./lib/clubs').findByClubNumber('30935'))"
```
Expected: prints the Salem club object.

Run:
```bash
node -e "console.log(require('./lib/clubs').findByClubNumber('99999'))"
```
Expected: prints `null`.

- [ ] **Step 3: Commit**

```bash
git add lib/clubs.js
git commit -m "feat: add clubs-config lookup helper"
```

---

## Task 5: lib/pdfshift.js — HTML to PDF buffer

**Files:**
- Create: `lib/pdfshift.js`

- [ ] **Step 1: Implement the module**

Create `lib/pdfshift.js`:

```js
const axios = require('axios');

async function htmlToPdf(html) {
  const response = await axios.post(
    'https://api.pdfshift.io/v3/convert/pdf',
    { source: html, landscape: false, use_print: false },
    {
      auth: { username: 'api', password: process.env.PDFSHIFT_API_KEY },
      responseType: 'arraybuffer',
    }
  );
  return Buffer.from(response.data);
}

module.exports = { htmlToPdf };
```

- [ ] **Step 2: Commit**

```bash
git add lib/pdfshift.js
git commit -m "feat: extract PDF Shift client into lib/pdfshift"
```

---

## Task 6: lib/abc.js — ABC Financial member GET + document POST

**Files:**
- Create: `lib/abc.js`

- [ ] **Step 1: Implement the module**

Create `lib/abc.js`:

```js
const axios = require('axios');

const BASE_URL = 'https://api.abcfinancial.com/rest';

function headers() {
  return {
    app_id: process.env.ABC_APP_ID,
    app_key: process.env.ABC_APP_KEY,
    'Content-Type': 'application/json',
  };
}

async function getMember(clubNumber, memberId) {
  const url = `${BASE_URL}/${clubNumber}/members/${memberId}`;
  const response = await axios.get(url, { headers: headers() });
  return response.data;
}

async function uploadDocument(clubNumber, memberId, { pdfBuffer, documentName }) {
  const url = `${BASE_URL}/${clubNumber}/members/documents/${memberId}`;
  const payload = {
    document: pdfBuffer.toString('base64'),
    documentName,
    documentType: 'pdf',
    imageType: 'member_document',
    memberId,
  };
  const response = await axios.post(url, payload, { headers: headers() });
  return response.data;
}

function extractName(memberResponse) {
  // ABC returns { members: [{ personal: { firstName, lastName, ... } }] } per their REST docs.
  // Be defensive: support nested array shape OR a flat object shape.
  const m =
    (memberResponse && memberResponse.members && memberResponse.members[0]) ||
    memberResponse ||
    {};
  const personal = m.personal || m;
  return {
    firstName: personal.firstName || '',
    lastName: personal.lastName || '',
  };
}

module.exports = { getMember, uploadDocument, extractName, BASE_URL };
```

- [ ] **Step 2: Commit**

```bash
git add lib/abc.js
git commit -m "feat: add ABC member GET + document POST client"
```

---

## Task 7: templates/cancel.js — CANCEL HTML template

**Files:**
- Create: `templates/cancel.js`

- [ ] **Step 1: Implement the template**

Create `templates/cancel.js`:

```js
const fs = require('fs');
const path = require('path');

let logoCache;
function logoBase64() {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'logo.png'));
    logoCache = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    logoCache = '';
  }
  return logoCache;
}

const STYLES = `
@page { margin: 40px; }
body { font-family: Arial, sans-serif; font-size: 11px; line-height: 1.5; color: #333; }
.header { display: flex; align-items: center; margin-bottom: 10px; padding-bottom: 10px; }
.logo { width: 80px; height: 80px; margin-right: 20px; }
h1 { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 28px; color: #000; margin: 0; letter-spacing: 1px; }
h2 { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 20px; color: #000; margin: 0 0 5px 0; letter-spacing: 0.5px; }
.red-line { height: 3px; background-color: #E31837; margin: 15px 0 20px 0; }
.section { margin-bottom: 20px; }
.section-header { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 16px; color: #000; margin-bottom: 10px; letter-spacing: 0.5px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px; }
.info-item { font-size: 10px; }
.label { font-weight: bold; color: #000; }
.fin-table { width: 100%; font-size: 10px; border-collapse: collapse; }
.fin-table td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
.fin-table td:first-child { font-weight: bold; width: 60%; }
.footer { margin-top: 40px; font-size: 9px; color: #666; }
`;

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function render({ requestId, occurredAt, data, member }) {
  const m = data.member || {};
  const r = data.result || {};
  const f = data.financials || {};
  const fullName = `${member.firstName} ${member.lastName}`.trim() || '(name not on file)';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
  <style>${STYLES}</style>
</head>
<body>
  <div class="header">
    <img src="${logoBase64()}" class="logo" alt="WCS Logo">
    <div>
      <h1>WEST COAST STRENGTH</h1>
      <h2>CANCELLATION RECORD</h2>
    </div>
  </div>
  <div class="red-line"></div>

  <div class="section">
    <div class="section-header">MEMBER</div>
    <div class="info-grid">
      <div class="info-item"><span class="label">Name:</span> ${escape(fullName)}</div>
      <div class="info-item"><span class="label">Email:</span> ${escape(m.email)}</div>
      <div class="info-item"><span class="label">Member ID:</span> ${escape(m.memberId)}</div>
      <div class="info-item"><span class="label">Agreement ID:</span> ${escape(m.agreementId)}</div>
      <div class="info-item"><span class="label">Barcode:</span> ${escape(m.barcode)}</div>
      <div class="info-item"><span class="label">Club Code:</span> ${escape(data.clubCode)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">CANCELLATION DETAILS</div>
    <div class="info-grid">
      <div class="info-item"><span class="label">Status:</span> ${escape(r.status)}</div>
      <div class="info-item"><span class="label">Effective Date:</span> ${escape(r.effectiveDate)}</div>
      <div class="info-item"><span class="label">Cancel Code:</span> ${escape(r.cancelCode)}</div>
      <div class="info-item"><span class="label">Cancel Reason:</span> ${escape(r.cancelReason)}</div>
      <div class="info-item"><span class="label">Buyer's Remorse:</span> ${r.buyerRemorseApplied ? 'Yes' : 'No'}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">FINANCIALS</div>
    <table class="fin-table">
      <tr><td>Past Due Balance</td><td>$${escape(f.pastDueBalance)}</td></tr>
      <tr><td>Past Due Collected</td><td>$${escape(f.pastDueCollected)}</td></tr>
      <tr><td>Next Due Amount</td><td>$${escape(f.nextDueAmount)}</td></tr>
      <tr><td>Next Due Collected</td><td>$${escape(f.nextDueCollected)}</td></tr>
      <tr><td>Buyout Amount</td><td>$${escape(f.buyoutAmount)}</td></tr>
      <tr><td>Buyout Collected</td><td>$${escape(f.buyoutCollected)}</td></tr>
    </table>
  </div>

  <div class="footer">
    Generated by Click2Save → WCS &nbsp;·&nbsp; Request ID: ${escape(requestId)} &nbsp;·&nbsp; Occurred At: ${escape(occurredAt)}
  </div>
</body>
</html>`;
}

module.exports = { render };
```

- [ ] **Step 2: Commit**

```bash
git add templates/cancel.js
git commit -m "feat: add CANCEL PDF template"
```

---

## Task 8: templates/save.js — FREEZE/OFFER HTML template

**Files:**
- Create: `templates/save.js`

- [ ] **Step 1: Implement the template**

Create `templates/save.js`:

```js
const fs = require('fs');
const path = require('path');

let logoCache;
function logoBase64() {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'logo.png'));
    logoCache = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    logoCache = '';
  }
  return logoCache;
}

const STYLES = `
@page { margin: 40px; }
body { font-family: Arial, sans-serif; font-size: 11px; line-height: 1.5; color: #333; }
.header { display: flex; align-items: center; margin-bottom: 10px; padding-bottom: 10px; }
.logo { width: 80px; height: 80px; margin-right: 20px; }
h1 { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 28px; color: #000; margin: 0; letter-spacing: 1px; }
h2 { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 20px; color: #000; margin: 0 0 5px 0; letter-spacing: 0.5px; }
.red-line { height: 3px; background-color: #E31837; margin: 15px 0 20px 0; }
.section { margin-bottom: 20px; }
.section-header { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 16px; color: #000; margin-bottom: 10px; letter-spacing: 0.5px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px; }
.info-item { font-size: 10px; }
.label { font-weight: bold; color: #000; }
.fin-table { width: 100%; font-size: 10px; border-collapse: collapse; }
.fin-table td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
.fin-table td:first-child { font-weight: bold; width: 60%; }
.offer-card { border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; font-size: 10px; }
.offer-card .offer-type { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 13px; color: #E31837; letter-spacing: 0.5px; margin-bottom: 4px; }
.footer { margin-top: 40px; font-size: 9px; color: #666; }
`;

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function freezeBody(r) {
  return `
    <div class="info-grid">
      <div class="info-item"><span class="label">Status:</span> ${escape(r.status)}</div>
      <div class="info-item"><span class="label">Freeze Type:</span> ${escape(r.freezeType)}</div>
      <div class="info-item"><span class="label">Reason Code:</span> ${escape(r.freezeCode)}</div>
      <div class="info-item"><span class="label">Reason:</span> ${escape(r.freezeReason)}</div>
      <div class="info-item"><span class="label">Period (days):</span> ${escape(r.freezePeriod)}</div>
      <div class="info-item"><span class="label">Dates:</span> ${escape(r.startDate)} – ${escape(r.endDate)}</div>
      <div class="info-item"><span class="label">Fee:</span> $${escape(r.fee)}</div>
    </div>`;
}

function offerCard(o) {
  const type = String(o.offer || '').toUpperCase();
  const d = o.dict || {};
  let body = '';

  if (type === 'MONETARY') {
    const dd = d.discountDues || {};
    body = `
      <div><span class="label">Discount Value:</span> ${escape(dd.value)}</div>
      <div><span class="label">Type:</span> ${escape(dd.type)}</div>
      <div><span class="label">Duration (cycles):</span> ${escape(dd.durationPeriod)}</div>`;
  } else if (type === 'POS') {
    const items = Array.isArray(o.array) ? o.array : [];
    const list = items.map(i => `<li>${escape(i.sku)}</li>`).join('') || '<li>(none)</li>';
    body = `<div><span class="label">SKUs:</span><ul style="margin: 4px 0 0 18px;">${list}</ul></div>`;
  } else if (type === 'FREEZE') {
    body = `
      <div><span class="label">Reason:</span> ${escape(d.reasonCode)} ${d.reasonName ? '— ' + escape(d.reasonName) : ''}</div>
      <div><span class="label">Freeze Type:</span> ${escape(d.freezeType)}</div>
      <div><span class="label">Period (days):</span> ${escape(d.freezePeriod)}</div>
      <div><span class="label">Dates:</span> ${escape(d.startDate)} – ${escape(d.endDate)}</div>
      <div><span class="label">Fee:</span> $${escape(d.value)}</div>`;
  } else if (type === 'LOCATION') {
    body = `<div><span class="label">Transfer:</span> ${escape(d.fromClubCode)} → ${escape(d.toClubCode)}</div>`;
  } else if (type === 'MEMBERSHIP') {
    body = `<div><span class="label">Plan:</span> ${escape(d.planName)}</div>`;
  } else if (type === 'CREDIT') {
    body = `
      <div><span class="label">Amount:</span> $${escape(d.amount)}</div>
      <div><span class="label">Comments:</span> ${escape(d.comments)}</div>`;
  } else if (type === 'MANUAL') {
    const keys = Object.keys(d || {});
    body = keys.length
      ? keys.map(k => `<div><span class="label">${escape(k)}:</span> ${escape(d[k])}</div>`).join('')
      : '<div>Custom offer applied</div>';
  } else {
    body = `<div>Unknown offer type — raw: <code>${escape(JSON.stringify(o))}</code></div>`;
  }

  return `
    <div class="offer-card">
      <div class="offer-type">${escape(type)} &nbsp;<span style="color:#666;font-family:inherit;">${escape(o.status || '')}</span></div>
      ${body}
    </div>`;
}

function offerBody(r) {
  const offers = Array.isArray(r.offers) ? r.offers : [];
  const cards = offers.map(offerCard).join('') || '<div>(no offer items)</div>';
  return `
    <div class="info-item" style="margin-bottom:8px;"><span class="label">Status:</span> ${escape(r.status)}</div>
    ${cards}`;
}

function render({ requestId, requestType, occurredAt, data, member }) {
  const m = data.member || {};
  const r = data.result || {};
  const f = data.financials || {};
  const fullName = `${member.firstName} ${member.lastName}`.trim() || '(name not on file)';

  const eventBlock = requestType === 'FREEZE' ? freezeBody(r) : offerBody(r);
  const sectionLabel = requestType === 'FREEZE' ? 'FREEZE DETAILS' : 'SAVE OFFER';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
  <style>${STYLES}</style>
</head>
<body>
  <div class="header">
    <img src="${logoBase64()}" class="logo" alt="WCS Logo">
    <div>
      <h1>WEST COAST STRENGTH</h1>
      <h2>RETENTION SAVE</h2>
    </div>
  </div>
  <div class="red-line"></div>

  <div class="section">
    <div class="section-header">MEMBER</div>
    <div class="info-grid">
      <div class="info-item"><span class="label">Name:</span> ${escape(fullName)}</div>
      <div class="info-item"><span class="label">Email:</span> ${escape(m.email)}</div>
      <div class="info-item"><span class="label">Member ID:</span> ${escape(m.memberId)}</div>
      <div class="info-item"><span class="label">Agreement ID:</span> ${escape(m.agreementId)}</div>
      <div class="info-item"><span class="label">Barcode:</span> ${escape(m.barcode)}</div>
      <div class="info-item"><span class="label">Club Code:</span> ${escape(data.clubCode)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">${sectionLabel}</div>
    ${eventBlock}
  </div>

  <div class="section">
    <div class="section-header">FINANCIALS</div>
    <table class="fin-table">
      <tr><td>Past Due Balance</td><td>$${escape(f.pastDueBalance)}</td></tr>
      <tr><td>Past Due Collected</td><td>$${escape(f.pastDueCollected)}</td></tr>
      <tr><td>Next Due Amount</td><td>$${escape(f.nextDueAmount)}</td></tr>
      <tr><td>Next Due Collected</td><td>$${escape(f.nextDueCollected)}</td></tr>
      <tr><td>Buyout Collected</td><td>$${escape(f.buyoutCollected)}</td></tr>
    </table>
  </div>

  <div class="footer">
    Generated by Click2Save → WCS &nbsp;·&nbsp; Request ID: ${escape(requestId)} &nbsp;·&nbsp; Occurred At: ${escape(occurredAt)}
  </div>
</body>
</html>`;
}

module.exports = { render };
```

- [ ] **Step 2: Commit**

```bash
git add templates/save.js
git commit -m "feat: add SAVE PDF template (FREEZE + OFFER)"
```

---

## Task 9: routes/click2save.js — handler + integration tests

**Files:**
- Create: `routes/click2save.js`
- Test: `test/click2save.test.js`

- [ ] **Step 1: Write the integration tests**

Create `test/click2save.test.js`:

```js
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
  mockMemberGet();
  mockPdfShift();
  mockDocPost({ capture: b => { captured = b; } });

  const res = await send(app, cancelPayload({ requestId: 'r-cancel-1' }));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
  assert.match(captured.documentName, /^Cancel Document \(\d{4}-\d{2}-\d{2}\)\.pdf$/);
  assert.strictEqual(captured.documentType, 'pdf');
  assert.strictEqual(captured.imageType, 'member_document');
});

test('OFFER: multiple offer subtypes are rendered into the HTML', async () => {
  let renderedHtml;
  const app = makeApp();
  mockMemberGet();
  nock(PDF).post('/v3/convert/pdf', body => { renderedHtml = body.source; return true; }).reply(200, Buffer.from('%PDF'));
  let captured;
  mockDocPost({ capture: b => { captured = b; } });

  const res = await send(app, offerPayload({ requestId: 'r-offer-1' }));
  assert.strictEqual(res.status, 200);
  assert.match(captured.documentName, /^Save Document \(\d{4}-\d{2}-\d{2}\)\.pdf$/);
  assert.ok(renderedHtml.includes('MONETARY'));
  assert.ok(renderedHtml.includes('YOGA-MAT-BLUE'));
  assert.ok(renderedHtml.includes('CREDIT'));
});

test('FREEZE: produces Save Document', async () => {
  let captured;
  const app = makeApp();
  mockMemberGet();
  mockPdfShift();
  mockDocPost({ capture: b => { captured = b; } });

  const res = await send(app, freezePayload({ requestId: 'r-freeze-1' }));
  assert.strictEqual(res.status, 200);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL with "Cannot find module '../routes/click2save'".

- [ ] **Step 3: Implement the route handler**

Create `routes/click2save.js`:

```js
const { verifySignature, isFresh } = require('../lib/c2s-signature');
const { findByClubNumber } = require('../lib/clubs');
const { getMember, uploadDocument, extractName } = require('../lib/abc');
const { htmlToPdf } = require('../lib/pdfshift');
const { retryWithBackoff } = require('../lib/retry');
const cancelTemplate = require('../templates/cancel');
const saveTemplate = require('../templates/save');

const REPLAY_WINDOW_SEC = parseInt(process.env.C2S_REPLAY_WINDOW_SEC, 10) || 300;
const RETRY_OPTS = { attempts: 3, baseMs: 500 };

function documentName(requestType, occurredAt) {
  const date = new Date(occurredAt);
  const yyyymmdd = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
  return requestType === 'CANCEL'
    ? `Cancel Document (${yyyymmdd}).pdf`
    : `Save Document (${yyyymmdd}).pdf`;
}

async function handler(req, res) {
  const requestId = req.headers['x-c2s-request-id'] || '(no-request-id)';

  // 1. Read raw body
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  if (!rawBody) {
    console.warn(`[c2s ${requestId}] empty body`);
    return res.status(400).json({ success: false, error: 'empty body' });
  }

  // 2. Verify signature
  const secret = process.env.C2S_WEBHOOK_SECRET;
  const signatureHeader = req.headers['x-c2s-signature'];
  if (!secret) {
    console.error(`[c2s ${requestId}] C2S_WEBHOOK_SECRET not configured`);
    return res.status(500).json({ success: false, error: 'server not configured' });
  }
  if (!verifySignature(rawBody, signatureHeader, secret)) {
    console.warn(`[c2s ${requestId}] invalid signature`);
    return res.status(401).json({ success: false, error: 'invalid signature' });
  }

  // 3. Check timestamp freshness
  const timestampHeader = req.headers['x-c2s-timestamp'];
  if (!isFresh(timestampHeader, REPLAY_WINDOW_SEC)) {
    console.warn(`[c2s ${requestId}] stale timestamp: ${timestampHeader}`);
    return res.status(401).json({ success: false, error: 'stale timestamp' });
  }

  // 4. Parse JSON
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.warn(`[c2s ${requestId}] invalid JSON`);
    return res.status(400).json({ success: false, error: 'invalid JSON' });
  }

  const { requestType, occurredAt, data } = event;

  // 5. Validate requestType
  if (!['CANCEL', 'FREEZE', 'OFFER'].includes(requestType)) {
    console.warn(`[c2s ${requestId}] unknown requestType: ${requestType}`);
    return res.status(200).json({ success: true, skipped: 'unknown_request_type', requestId });
  }

  if (!data || !data.clubCode || !data.member || !data.member.memberId) {
    console.warn(`[c2s ${requestId}] missing required fields in data`);
    return res.status(200).json({ success: true, skipped: 'missing_fields', requestId });
  }

  // 6. Resolve club
  const club = findByClubNumber(data.clubCode);
  if (!club) {
    console.warn(`[c2s ${requestId}] unknown clubCode: ${data.clubCode}`);
    return res.status(200).json({ success: true, skipped: 'unknown_club', requestId });
  }

  const clubNumber = club.clubNumber;
  const memberId = data.member.memberId;

  // 7. Fetch member from ABC
  let member;
  try {
    const memberResp = await retryWithBackoff(
      () => getMember(clubNumber, memberId),
      RETRY_OPTS
    );
    member = extractName(memberResp);
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 404) {
      console.warn(`[c2s ${requestId}] member not found: ${clubNumber}/${memberId}`);
      return res.status(200).json({ success: true, skipped: 'member_not_found', requestId });
    }
    console.error(`[c2s ${requestId}] member GET failed:`, err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'member_lookup_failed', details: err.response?.data || err.message });
  }

  // 8. Render HTML
  const tmplArgs = { requestId: event.requestId, requestType, occurredAt, data, member };
  const html = requestType === 'CANCEL'
    ? cancelTemplate.render(tmplArgs)
    : saveTemplate.render(tmplArgs);

  // 9. Generate PDF (with retry)
  let pdfBuffer;
  try {
    pdfBuffer = await retryWithBackoff(() => htmlToPdf(html), RETRY_OPTS);
  } catch (err) {
    console.error(`[c2s ${requestId}] PDFShift failed:`, err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'pdf_generation_failed', details: err.response?.data || err.message });
  }

  // 10. Upload to ABC (with retry)
  const docName = documentName(requestType, occurredAt);
  try {
    await retryWithBackoff(
      () => uploadDocument(clubNumber, memberId, { pdfBuffer, documentName: docName }),
      RETRY_OPTS
    );
  } catch (err) {
    console.error(`[c2s ${requestId}] ABC document upload failed:`, err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'document_upload_failed', details: err.response?.data || err.message });
  }

  console.log(`[c2s ${requestId}] uploaded "${docName}" for ${clubNumber}/${memberId}`);
  return res.status(200).json({ success: true, requestId, documentName: docName });
}

module.exports = handler;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: 10 click2save integration tests + 9 signature tests + 5 retry tests pass.

If a retry test runs slowly because the real backoff (500/1000ms) kicks in: confirm `RETRY_OPTS.baseMs` is 500 in the route — but for the 5xx-thrice and retry-succeeds tests this means up to 1.5s per test. Acceptable. If it crosses the test runner's default 30s timeout, lower the test-time backoff via env: change `RETRY_OPTS` to `{ attempts: 3, baseMs: parseInt(process.env.C2S_RETRY_BASE_MS, 10) || 500 }`, then set `process.env.C2S_RETRY_BASE_MS = '5'` at the top of `test/click2save.test.js`. Apply that change only if needed.

- [ ] **Step 5: Commit**

```bash
git add routes/click2save.js test/click2save.test.js
git commit -m "feat: add /webhook/click2save route + integration tests"
```

---

## Task 10: Mount the route in index.js

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Mount the route and export the app**

In `index.js`, find this block near the bottom (currently lines ~928–931):

```js
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

Replace with:

```js
// Mount Click2Save webhook BEFORE the global JSON parser is applied.
// The handler reads the raw body to verify HMAC; the body parser is local to this route.
const click2saveHandler = require('./routes/click2save');
app.post('/webhook/click2save', require('express').raw({ type: 'application/json' }), click2saveHandler);

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
```

> Note: `app.use(express.json({ limit: '15mb' }))` near the top of `index.js` does not affect this route because Express applies route-specific middleware (the `express.raw(...)` argument) and skips the JSON parser when the route already provided a body parser. The raw parser will populate `req.body` as a Buffer.

- [ ] **Step 2: Smoke test — start the server and hit /health**

Run in one terminal:
```bash
PDFSHIFT_API_KEY=x ABC_APP_ID=x ABC_APP_KEY=x C2S_WEBHOOK_SECRET=x node index.js
```
Expected: prints `Loaded clubs: [...]` and `Server running on port 3000`.

In another terminal:
```bash
curl -s http://localhost:3000/health
```
Expected: `{"status":"healthy","timestamp":"..."}`.

Stop the server (Ctrl+C).

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass (signature + retry + click2save).

- [ ] **Step 4: Commit**

```bash
git add index.js
git commit -m "feat: mount /webhook/click2save in app and export app for tests"
```

---

## Task 11: Local end-to-end signed-payload check (manual)

**Files:** none

- [ ] **Step 1: Run the server locally with dummy creds**

```bash
PDFSHIFT_API_KEY=x ABC_APP_ID=x ABC_APP_KEY=x C2S_WEBHOOK_SECRET=test-secret node index.js
```

- [ ] **Step 2: Generate a signed test payload and send it**

In another terminal (PowerShell):

```powershell
$body = '{"requestId":"manual-001","requestType":"CANCEL","occurredAt":"2026-05-06T10:00:00.000Z","producer":"click2save","data":{"brandId":"b","clubCode":"30935","member":{"memberId":"M001","barcode":"BC","agreementId":"AG","email":"e@x.com"},"result":{"status":"completed","effectiveDate":"2026-05-31","cancelCode":"VOLUNTARY","cancelReason":"Test","buyerRemorseApplied":false},"financials":{"pastDueBalance":"0.00","pastDueCollected":"0.00","nextDueAmount":"29.99","nextDueCollected":"0.00","buyoutAmount":"0.00","buyoutCollected":"0.00"}}}'
$secret = 'test-secret'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
$keyBytes = [System.Text.Encoding]::UTF8.GetBytes($secret)
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = $keyBytes
$sig = ($hmac.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
$ts = [int][double]::Parse((Get-Date -UFormat %s))
curl.exe -s -X POST http://localhost:3000/webhook/click2save `
  -H "Content-Type: application/json" `
  -H "X-C2S-Signature: sha256=$sig" `
  -H "X-C2S-Request-ID: manual-001" `
  -H "X-C2S-Timestamp: $ts" `
  --data $body
```

Expected:
- The server logs `[c2s manual-001] member GET failed: ...` (because real ABC creds are dummies). That's expected — this validates that signature verification, timestamp check, club lookup, and routing are all working. We see a 500 only from the downstream call, not from auth.
- Confirm a response body of `{"success":false,"error":"member_lookup_failed",...}` rather than `invalid signature` / `stale timestamp` / `unknown_club`.

- [ ] **Step 3: Confirm 401 on bad signature**

Same `curl` but with `X-C2S-Signature: sha256=deadbeef`. Expected: `{"success":false,"error":"invalid signature"}` and HTTP 401.

- [ ] **Step 4: Stop the server**

Ctrl+C.

No commit (manual verification only).

---

## Task 12: Final repo check + summary

**Files:** none

- [ ] **Step 1: Final test run**

Run: `npm test`
Expected: full green.

- [ ] **Step 2: Verify no leftover debug code**

Run: `git diff origin/main..HEAD -- '*.js'`
Inspect for `console.log` calls left over from debugging that aren't structured logs. The handler intentionally uses `console.log/warn/error` with `[c2s ${requestId}]` prefixes — those are wanted.

- [ ] **Step 3: Document required Render env vars**

Tell the user (no commit needed) that the following env var must be set in the Render dashboard for the existing service before launch:

- `C2S_WEBHOOK_SECRET` — provided by the Click2Save account manager.

Optional:
- `C2S_REPLAY_WINDOW_SEC` — only set if 5-min default needs widening.

- [ ] **Step 4: Push to GitHub (only if user confirms)**

Do NOT push without user confirmation. When confirmed:

```bash
git push origin main
```

Render will auto-deploy from main per the existing setup.

---

## Self-review (already performed)

- **Spec coverage:** Each spec section is covered:
  - §4 Architecture → file map + Tasks 2–9
  - §5.1 Request flow → Task 9 handler steps 1–11
  - §5.2 Retry semantics → Task 3 (retry util) + Task 9 retry wrappers + integration tests cases 9 and 10
  - §6 PDF templates → Tasks 7 and 8 with full per-event content
  - §6.3 Document name builder → Task 9 `documentName(...)`
  - §7 Module interfaces → Tasks 2–8
  - §8 Env vars → Task 9 reads `C2S_WEBHOOK_SECRET` and `C2S_REPLAY_WINDOW_SEC`; Task 12 documents them
  - §9 Test plan, all 10 cases → Task 9 integration tests
  - §10 Open assumptions — `clubCode === clubNumber` is implemented in `lib/clubs.js`; if the smoke test in Task 11 reveals different codes, the user adds a `c2sClubCode` field per club and switches lookup (single-line change).

- **Placeholder scan:** No TBD/TODO. Every code step contains the actual code. Every test step contains the actual test.

- **Type/name consistency:** All module/function names referenced across tasks match: `verifySignature`, `isFresh`, `retryWithBackoff`, `defaultIsRetryable`, `findByClubNumber`, `htmlToPdf`, `getMember`, `uploadDocument`, `extractName`, `cancelTemplate.render`, `saveTemplate.render`, `documentName(...)`. Property names on the rendered template args (`requestId`, `requestType`, `occurredAt`, `data`, `member`) are consistent between Tasks 7, 8, and 9.
