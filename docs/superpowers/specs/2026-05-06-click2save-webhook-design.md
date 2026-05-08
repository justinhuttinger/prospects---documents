# Click2Save Webhook → ABC Document Upload

**Status:** Approved 2026-05-06
**Owner:** Justin Huttinger
**Repo:** `justinhuttinger/prospects---documents`
**Deploy target:** Render (existing service)

## 1. Overview

Click2Save is West Coast Strength's retention/cancellation processing vendor. When a member's request is processed (cancellation, freeze, or save offer accepted), Click2Save fires an HMAC-signed webhook. This service receives that webhook, generates a branded PDF documenting the event, and uploads the PDF to the member's ABC Financial document store so the record lives with the member account in the MRM.

Source of truth for the webhook contract: `C:\Users\justi\Downloads\webhook-integration-guide.html` (Click2Save Webhook Integration Guide v1.0).

## 2. Goals & non-goals

**Goals**

- Receive `CANCEL`, `FREEZE`, and `OFFER` webhooks from Click2Save on a single endpoint.
- Verify HMAC-SHA256 signature before processing.
- Generate a branded PDF documenting the event using the existing PDF Shift integration.
- Upload the PDF to the ABC member's document store using the existing ABC document API.

**Non-goals**

- No persistent dedupe store; we accept rare duplicate documents in ABC if Click2Save retries after a transient failure (user accepted this tradeoff).
- No ABC alerts, no photo upload, no check-in for these events. Those are part of the new-prospect flow only.
- No GHL contact updates on these events.
- No webhook for the underlying request *creation* — only the *processed* events.

## 3. Existing system context

The repo (`prospects---documents`) is a Node 18+ Express service that today:

- Receives a GHL trial-form webhook at `POST /webhook/ghl-form`
- Creates an ABC prospect, generates a waiver PDF via PDF Shift, uploads it to ABC, adds an alert, uploads a profile photo, and posts a check-in
- Looks up ABC `clubNumber`, GHL API keys, and station IDs from `clubs-config.json`

Reusable building blocks already in `index.js`:

- `getAbcHeaders()` — ABC auth headers
- `sanitizeDocumentName(first, last)` — ABC document name rules (will be replaced for this feature; see §6.4)
- The HTML → PDF Shift call inside `generatePDF()`
- The document upload pattern: `POST {ABC_BASE_URL}/{clubNumber}/members/documents/{memberId}`

## 4. Architecture

To avoid bloating `index.js` (already ~930 lines), the new feature lives in dedicated modules. Existing helpers will be extracted only where reuse is clean; if extraction would churn the existing flow, helpers are duplicated minimally instead.

```
prospects---documents/
├── index.js                    # existing GHL flow; mounts the new route
├── lib/
│   ├── abc.js                  # ABC client: getMember, uploadDocument, shared headers
│   ├── pdfshift.js             # PDF Shift client (HTML → PDF buffer)
│   ├── c2s-signature.js        # HMAC-SHA256 verify + timestamp freshness
│   └── clubs.js                # clubs-config lookup helpers
├── routes/
│   └── click2save.js           # POST /webhook/click2save
├── templates/
│   ├── cancel.js               # HTML template for CANCEL
│   └── save.js                 # HTML template for FREEZE + OFFER
├── test/
│   └── click2save.test.js      # signed-payload integration test (node:test + supertest)
├── clubs-config.json           # unchanged structure
└── package.json                # add devDependencies: supertest, nock
```

### Route mounting

In `index.js`, before the existing JSON parser is applied to the new route, the C2S route uses `express.raw({ type: 'application/json' })` so the HMAC can be computed over the unparsed body. Sketch:

```js
const c2sRoute = require('./routes/click2save');
app.post('/webhook/click2save', express.raw({ type: 'application/json' }), c2sRoute);
```

The existing `app.use(express.json({ limit: '15mb' }))` line stays as-is and continues to apply to all other routes.

## 5. Endpoint behavior

### 5.1 Request flow

`POST /webhook/click2save`

1. Read raw body (Buffer → UTF-8 string).
2. **Verify HMAC.** Strip `sha256=` prefix from `X-C2S-Signature`, compute HMAC-SHA256 of raw body with `C2S_WEBHOOK_SECRET`, `crypto.timingSafeEqual` the hex digests. On failure → **401** + log `{ requestId, signaturePresent }`. No downstream side effects.
3. **Verify timestamp freshness.** `|nowSec - X-C2S-Timestamp| ≤ C2S_REPLAY_WINDOW_SEC` (default 300). On failure → **401** + log.
4. Parse JSON.
5. Route by `requestType`:
   - `CANCEL` → cancel handler
   - `FREEZE` → save handler (freeze-mode)
   - `OFFER` → save handler (offer-mode)
   - Anything else → log + **200** (no retry on unknown types).
6. **Resolve club.** Look up `data.clubCode` against `clubs-config.json` `clubNumber`. No match → log + **200** (config issue, no point retrying).
7. **Fetch member.** `GET {ABC_BASE_URL}/{clubNumber}/members/{memberId}` to get first/last name. Member not found → log + **200**.
8. **Render HTML** for the event using the appropriate template module.
9. **Generate PDF** via `lib/pdfshift.js`.
10. **Upload to ABC** via `lib/abc.js` `uploadDocument(clubNumber, memberId, { pdfBuffer, documentName })`.
11. Respond **200** with `{ success: true, requestId, documentName }`.

### 5.2 Retry & failure semantics

**Internal bounded retry** for transient external errors (PDFShift call, ABC `GET /members`, ABC document POST):

```js
retryWithBackoff(fn, { attempts: 3, baseMs: 500 }) // 500ms, 1000ms, 2000ms
```

Retry on: `ECONNRESET`, `ETIMEDOUT`, network errors, HTTP 5xx, HTTP 429.
Do **not** retry on: HTTP 4xx (except 429), validation errors.

After 3 internal attempts fail, return **500** so Click2Save retries the whole webhook. Click2Save manages its own retry cap, so this cannot loop infinitely.

**Errors that return 200 (no Click2Save retry)** — config/data issues retrying won't fix:

| Condition | Reason |
|---|---|
| Unknown `requestType` | Spec drift; alert via logs |
| Unknown `clubCode` | Add to `clubs-config.json` |
| Member not found in ABC | Stale data in C2S |
| Missing required envelope fields | Bad payload |

All return-200-with-error cases are logged loudly with the full payload for manual triage.

## 6. PDF templates

Both templates reuse the existing waiver styling — Bebas Neue header, red accent bar, info grid — so the C2S-generated docs look like one branded family with the existing Liability Waiver.

### 6.1 CANCEL template (`templates/cancel.js`)

Filename: `Cancel Document (YYYY-MM-DD).pdf` (date from `occurredAt`).

Sections:

1. **Header** — WCS logo + "WEST COAST STRENGTH" / "CANCELLATION RECORD"
2. **Member info** — `firstName lastName`, `email`, `memberId`, `agreementId`, `barcode`, `clubCode`
3. **Cancellation details** — `status`, `effectiveDate`, `cancelCode`, `cancelReason`, `buyerRemorseApplied`
4. **Financials** — `pastDueBalance`, `pastDueCollected`, `nextDueAmount`, `nextDueCollected`, `buyoutAmount`, `buyoutCollected`
5. **Footer** — `requestId`, `occurredAt`, "Generated by Click2Save → WCS"

### 6.2 SAVE template (`templates/save.js`) — used by FREEZE and OFFER

Filename: `Save Document (YYYY-MM-DD).pdf`.

Sections:

1. **Header** — WCS logo + "WEST COAST STRENGTH" / "RETENTION SAVE"
2. **Member info** — same fields as CANCEL
3. **Event details** — branches on `requestType`:
   - **FREEZE:** `status`, `freezeType`, `freezeCode`, `freezeReason`, `freezePeriod`, `startDate – endDate`, `fee`
   - **OFFER:** top-level `status`, then one styled card per item in `result.offers[]`. Card content dispatches on `offer`:
     - `MONETARY` — `discountDues.value` / `type` / `durationPeriod`
     - `POS` — bulleted list of SKUs from `array[].sku`
     - `FREEZE` — `reasonCode`, `freezeType`, `freezePeriod`, `startDate – endDate`, `value` (fee)
     - `LOCATION` — `fromClubCode → toClubCode`
     - `MEMBERSHIP` — `planName`
     - `CREDIT` — `amount`, `comments`
     - `MANUAL` — "Custom offer applied" + any keys present in `dict`
4. **Financials** — `pastDueBalance`, `pastDueCollected`, `nextDueAmount`, `nextDueCollected`, `buyoutCollected` (note: FREEZE/OFFER payloads omit `buyoutAmount` per the guide)
5. **Footer** — `requestId`, `occurredAt`, "Generated by Click2Save → WCS"

### 6.3 Document name builder

```js
function c2sDocumentName(requestType, occurredAt) {
  const date = new Date(occurredAt).toISOString().slice(0, 10);
  return requestType === 'CANCEL'
    ? `Cancel Document (${date}).pdf`
    : `Save Document (${date}).pdf`;
}
```

Both forms (≤30 chars) are well within ABC's 255-char document name limit and use only allowed characters.

## 7. Modules — interfaces

### 7.1 `lib/c2s-signature.js`

```js
module.exports = {
  // Returns true iff signatureHeader matches HMAC-SHA256(rawBody, secret).
  // Uses crypto.timingSafeEqual.
  verifySignature(rawBody, signatureHeader, secret),

  // Returns true iff |nowSec - timestampHeader| <= windowSec.
  isFresh(timestampHeader, windowSec = 300),
};
```

### 7.2 `lib/abc.js`

```js
module.exports = {
  getAbcHeaders(),                          // existing pattern, copied here
  getMember(clubNumber, memberId),          // GET /{clubNumber}/members/{memberId}
  uploadDocument(clubNumber, memberId, {    // POST /{clubNumber}/members/documents/{memberId}
    pdfBuffer, documentName,
  }),
};
```

### 7.3 `lib/pdfshift.js`

```js
module.exports = {
  // Posts HTML to PDF Shift, returns Buffer.
  htmlToPdf(html),
};
```

### 7.4 `lib/clubs.js`

```js
module.exports = {
  // Loads clubs-config.json once; exposes lookup by ABC clubNumber.
  // For C2S we assume clubCode === clubNumber; if smoke test reveals otherwise,
  // we add findByC2sClubCode() and a c2sClubCode field in config.
  findByClubNumber(clubNumber),
};
```

### 7.5 `routes/click2save.js`

Default-exports an Express handler implementing the flow in §5.

### 7.6 `templates/cancel.js`, `templates/save.js`

Each exports `render({ member, data, requestId, occurredAt })` returning an HTML string.

## 8. Configuration

### 8.1 New environment variables (Render)

| Name | Required | Default | Notes |
|---|---|---|---|
| `C2S_WEBHOOK_SECRET` | yes | — | HMAC secret from Click2Save account manager |
| `C2S_REPLAY_WINDOW_SEC` | no | `300` | Widen only if clock-skew issues appear |

Existing env vars (`ABC_APP_ID`, `ABC_APP_KEY`, `PDFSHIFT_API_KEY`, GHL keys) are unchanged.

### 8.2 `clubs-config.json`

No schema change at launch. **Open assumption:** Click2Save sends our ABC `clubNumber` as `data.clubCode`. We will smoke-test with one real delivery; if codes differ, we add a `c2sClubCode` field per club entry and switch the lookup. This is a single-line code change in `lib/clubs.js`.

## 9. Test plan

Add `test/click2save.test.js` using `node:test` (built-in) + `supertest` for HTTP and `nock` for axios mocking. Add `npm test` script.

### 9.1 Cases

1. **CANCEL: valid payload + correct signature** → 200; ABC member GET called once; ABC document POST called once with `Cancel Document (YYYY-MM-DD).pdf`; PDF Shift called once.
2. **OFFER: valid payload with multiple offer subtypes** → 200; rendered HTML (snapshot or string-contains check) includes a section per subtype; document name is `Save Document (...).pdf`.
3. **FREEZE: valid payload** → 200; document name is `Save Document (...).pdf`.
4. **Bad signature** → 401; no member GET, no PDFShift, no document POST.
5. **Stale timestamp (>5 min old)** → 401; no downstream calls.
6. **Unknown clubCode** → 200; no ABC calls.
7. **Unknown requestType** → 200; no ABC calls.
8. **Member not found (ABC GET 404)** → 200; no document POST.
9. **ABC document POST fails 5xx three times** → endpoint returns 500 after internal retries exhausted; PDFShift called once (PDF generation isn't retried per failed upload).
10. **Internal retry succeeds on attempt 2** → endpoint returns 200; ABC document POST called twice total.

### 9.2 What is mocked vs real

- **Mocked at HTTP boundary:** PDFShift API, ABC API. Everything else (signature verification, template rendering, doc-name builder, retry helper, route dispatch) runs real.
- **No real network calls** in CI.

## 10. Open assumptions to confirm with first real delivery

1. `data.clubCode` from Click2Save equals our ABC `clubNumber`. (Confirm with first signed test payload.)
2. `data.member.memberId` is the ABC member ID. (User confirmed.)
3. Both FREEZE and OFFER use the "Save Document" filename. (User confirmed by example.)

## 11. Out of scope (for this spec)

- Retries-of-retries / per-`requestId` ceiling on our side (Click2Save manages this; can be added later if its behavior surprises us).
- Multi-brand routing (`brandId` is logged but not used to route).
- Persistent storage of received events for reporting (the document in ABC is the system of record per user direction).

## 12. Acceptance criteria

- [ ] `POST /webhook/click2save` accepts and verifies HMAC-signed Click2Save webhooks.
- [ ] CANCEL events produce `Cancel Document (YYYY-MM-DD).pdf` in the member's ABC documents with all fields from §6.1.
- [ ] FREEZE and OFFER events produce `Save Document (YYYY-MM-DD).pdf` in the member's ABC documents with all fields from §6.2.
- [ ] Signature/timestamp failures return 401 with no downstream side effects.
- [ ] Config/data failures return 200 (no Click2Save retry); transient external failures return 500 after bounded internal retry.
- [ ] All 10 test cases in §9.1 pass under `npm test`.
- [ ] `C2S_WEBHOOK_SECRET` is set on Render before launch.
