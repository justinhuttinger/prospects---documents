const axios = require('axios');
const { verifySignature, isFresh } = require('../lib/c2s-signature');
const { findByClubNumber } = require('../lib/clubs');
const { getMember, uploadDocument, extractName } = require('../lib/abc');
const { htmlToPdf } = require('../lib/pdfshift');
const { retryWithBackoff } = require('../lib/retry');
const cancelTemplate = require('../templates/cancel');
const saveTemplate = require('../templates/save');

const REPLAY_WINDOW_SEC = parseInt(process.env.C2S_REPLAY_WINDOW_SEC, 10) || 300;
const RETRY_OPTS = {
  attempts: 3,
  baseMs: parseInt(process.env.C2S_RETRY_BASE_MS, 10) || 500,
};

// Fire-and-forget forward of the parsed event to a downstream consumer
// (e.g. wcs-staff-portal). Any failure is logged but never affects the
// upstream Click2Save response — the upload to ABC is the contract here,
// downstream forwarding is best-effort.
function forwardEvent(event, requestId) {
  const url = process.env.C2S_FORWARD_URL;
  if (!url) return;
  const headers = { 'Content-Type': 'application/json' };
  const sharedSecret = process.env.C2S_FORWARD_SECRET;
  if (sharedSecret) headers['x-webhook-secret'] = sharedSecret;
  axios.post(url, event, { headers, timeout: 10000 })
    .then((resp) => {
      console.log(`[c2s ${requestId}] forwarded to ${url} -> ${resp.status}`);
    })
    .catch((err) => {
      const status = err.response?.status;
      const body = err.response?.data;
      console.warn(`[c2s ${requestId}] forward to ${url} failed${status ? ` (${status})` : ''}: ${err.message}${body ? ` body=${JSON.stringify(body).slice(0, 300)}` : ''}`);
    });
}

function documentName(requestType, occurredAt, requestId) {
  const date = new Date(occurredAt);
  let yyyymmdd;
  if (Number.isNaN(date.getTime())) {
    console.warn(`[c2s ${requestId}] invalid occurredAt: ${occurredAt} — using today's date`);
    yyyymmdd = new Date().toISOString().slice(0, 10);
  } else {
    yyyymmdd = date.toISOString().slice(0, 10);
  }
  // ABC document name allowed chars: alphanumeric, spaces, and .,_!%+-@^'
  // Parentheses are silently dropped by ABC (returns 2xx but the doc never appears).
  return requestType === 'CANCEL'
    ? `Cancel Document ${yyyymmdd}.pdf`
    : `Save Document ${yyyymmdd}.pdf`;
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

  // Forward the validated event to any configured downstream consumer
  // (e.g. wcs-staff-portal). Fire-and-forget — never blocks ABC pipeline.
  forwardEvent(event, requestId);

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
    return res.status(500).json({ success: false, error: 'member_lookup_failed' });
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
    return res.status(500).json({ success: false, error: 'pdf_generation_failed' });
  }

  // 10. Upload to ABC (with retry)
  const docName = documentName(requestType, occurredAt, requestId);
  let abcResponse;
  try {
    abcResponse = await retryWithBackoff(
      () => uploadDocument(clubNumber, memberId, { pdfBuffer, documentName: docName }),
      RETRY_OPTS
    );
  } catch (err) {
    console.error(`[c2s ${requestId}] ABC document upload failed:`, err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'document_upload_failed' });
  }

  console.log(`[c2s ${requestId}] uploaded "${docName}" for ${clubNumber}/${memberId} — ABC response:`, JSON.stringify(abcResponse));
  return res.status(200).json({ success: true, requestId, documentName: docName });
}

module.exports = handler;
