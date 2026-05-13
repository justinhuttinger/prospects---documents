// POST /webhooks/paychex-training/:token   ← Paychex (URL-only, no custom headers)
// POST /webhooks/paychex-training           ← fallback for callers that CAN send headers
//
// Receives a Paychex Flex Learning "Transcript" export as a zip and parses
// `dashboard-transcript/learner_transcript.csv` into paychex_training_records.
//
// Body shapes accepted:
//   1. Raw zip bytes (Content-Type: application/zip | application/octet-stream)
//      — mounted with express.raw, so req.body is a Buffer.
//   2. JSON envelope { file_url, file_name? } (Content-Type: application/json)
//      — we fetch the URL and treat the response as a zip.
//
// Auth: shared secret in env PAYCHEX_WEBHOOK_SECRET. Paychex Bridge's webhook
// UI only accepts a URL (no custom headers), so the secret is passed as the
// :token URL segment. The header-based path is still supported for other
// future callers. Comparison is constant-time via crypto.timingSafeEqual.
// Skipped entirely if the env var isn't set, so first-round curl tests work.

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { parseTranscriptZip } = require('../services/paychex-training/parse-transcript');
const { createReport, finalizeReport, upsertRecords } = require('../services/paychex-training/store');

const router = express.Router();
const SECRET = process.env.PAYCHEX_WEBHOOK_SECRET || '';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireSecret(req, res, next) {
  if (!SECRET) return next();
  const provided = req.params.token || req.get('X-Webhook-Secret') || '';
  if (!safeEqual(provided, SECRET)) {
    return res.status(401).json({ error: 'invalid webhook secret' });
  }
  next();
}

async function downloadFromUrl(url) {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: 100 * 1024 * 1024, // 100 MB safety limit
  });
  return Buffer.from(res.data);
}

async function getZipBuffer(req) {
  const ct = (req.get('Content-Type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    // express.json already ran globally for json content-types.
    const url = req.body?.file_url || req.body?.url;
    if (!url) throw new Error('JSON webhook body missing file_url');
    return { buffer: await downloadFromUrl(url), fileName: req.body?.file_name || null };
  }
  // Raw zip path. Mounted below with express.raw — req.body is a Buffer.
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new Error('Empty webhook body (expected zip bytes)');
  }
  const fileName = req.get('X-File-Name') || null;
  return { buffer: req.body, fileName };
}

// Shared request handler. Bound to two routes so we can accept the token in
// the URL path (Paychex) or as an X-Webhook-Secret header (general callers).
async function handleWebhook(req, res) {
  let reportId = null;
  try {
    const { buffer, fileName } = await getZipBuffer(req);
    const report = await createReport({
      source: 'webhook',
      fileName,
      fileSize: buffer.length,
    });
    reportId = report.id;

    let parsed;
    try {
      parsed = parseTranscriptZip(buffer);
    } catch (parseErr) {
      await finalizeReport(reportId, {
        parseStatus: 'failed',
        parseError: parseErr.message,
      });
      console.error('[Paychex Training] parse failed:', parseErr.message);
      return res.status(400).json({ error: parseErr.message, report_id: reportId });
    }

    const accountName = parsed.rows.find((r) => r.account_name)?.account_name || null;
    const recordCount = await upsertRecords(reportId, parsed.rows);

    await finalizeReport(reportId, {
      parseStatus: 'success',
      recordCount,
      accountName,
    });

    console.log(`[Paychex Training] report ${reportId}: ${recordCount} record(s) upserted`);
    return res.json({
      ok: true,
      report_id: reportId,
      record_count: recordCount,
      account_name: accountName,
    });
  } catch (err) {
    console.error('[Paychex Training] webhook failed:', err.message);
    if (reportId) {
      try {
        await finalizeReport(reportId, {
          parseStatus: 'failed',
          parseError: err.message,
        });
      } catch (_) { /* ignore */ }
    }
    return res.status(500).json({ error: err.message, report_id: reportId });
  }
}

const rawZipParser = express.raw({
  type: ['application/zip', 'application/octet-stream', 'application/x-zip-compressed'],
  limit: '50mb',
});

// Paychex Bridge: token in URL path.
router.post('/webhooks/paychex-training/:token', rawZipParser, requireSecret, handleWebhook);

// Header-based fallback for other callers.
router.post('/webhooks/paychex-training', rawZipParser, requireSecret, handleWebhook);

module.exports = router;
