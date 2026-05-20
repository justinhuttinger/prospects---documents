/**
 * Render the signed online-join agreement to a PDF and upload it to the
 * member's ABC document tab.
 *
 * PDF rendering uses PDFShift (same pattern as the click2save flow — env
 * var PDFSHIFT_API_KEY). ABC upload uses lib/abc.js uploadDocument().
 *
 * This is fire-and-forget from the caller's perspective: failures here
 * never block the agreement creation success response back to the widget.
 * Errors are logged to online_signup_errors so they're triaged later.
 *
 * Returns { ok: true, documentId } on success.
 * Returns { ok: false, step, error } on failure (caller decides what to do).
 */

const axios = require('axios');
const { buildSignedPdfHtml } = require('./agreement-html');
const { uploadDocument } = require('../../lib/abc');

const PDFSHIFT_URL = 'https://api.pdfshift.io/v3/convert/pdf';

// ABC's document API silently drops filenames with disallowed chars (see
// reference_abc_document_filename.md). Keep the name ASCII-only + no parens.
function sanitizeDocumentName(name) {
  return String(name || 'WCS-Online-Join-Agreement')
    .replace(/[^\w\s-]/g, '')   // strip anything not word/space/dash
    .replace(/\s+/g, '-')        // spaces → dashes
    .replace(/-+/g, '-')         // collapse repeats
    .replace(/^-|-$/g, '')        // trim leading/trailing dashes
    .slice(0, 80) || 'WCS-Online-Join-Agreement';
}

async function renderAgreementPdf(html) {
  const apiKey = process.env.PDFSHIFT_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('PDFSHIFT_API_KEY is not configured'), { code: 'PDFSHIFT_NOT_CONFIGURED' });
  }
  const resp = await axios.post(PDFSHIFT_URL, {
    source: html,
    landscape: false,
    use_print: false,
  }, {
    auth: { username: 'api', password: apiKey },
    responseType: 'arraybuffer',
    timeout: 45000,
    validateStatus: () => true,
  });
  if (resp.status < 200 || resp.status >= 300) {
    const bodyText = Buffer.isBuffer(resp.data) ? resp.data.toString('utf8').slice(0, 400) : String(resp.data).slice(0, 400);
    throw Object.assign(new Error(`PDFShift returned HTTP ${resp.status}: ${bodyText}`), { code: 'PDFSHIFT_HTTP' });
  }
  return Buffer.from(resp.data);
}

/**
 * Main entry. Builds HTML → PDF → uploads to ABC.
 */
async function renderAndUploadSignedAgreement({
  signup,
  plan,
  location,
  signatureDataUrl,
  typedSignature,
  signedAt,
}) {
  if (!signup?.abc_member_id) {
    return { ok: false, step: 'precheck', error: 'signup.abc_member_id is required' };
  }
  if (!signup?.abc_club_number) {
    return { ok: false, step: 'precheck', error: 'signup.abc_club_number is required' };
  }

  // 1. Build HTML.
  let html;
  try {
    html = buildSignedPdfHtml({ signup, plan, location, signatureDataUrl, typedSignature, signedAt });
  } catch (err) {
    return { ok: false, step: 'build_html', error: err.message };
  }

  // 2. Render to PDF.
  let pdfBuffer;
  try {
    pdfBuffer = await renderAgreementPdf(html);
  } catch (err) {
    return { ok: false, step: 'pdfshift', error: err.message, code: err.code };
  }

  // 3. Upload to ABC.
  const memberName = `${signup.first_name || ''}-${signup.last_name || ''}`.trim() || 'member';
  const documentName = sanitizeDocumentName(`WCS-Online-Join-${memberName}`);
  try {
    const result = await uploadDocument(signup.abc_club_number, signup.abc_member_id, {
      pdfBuffer,
      documentName,
    });
    const documentId =
      result?.result?.documentId ||
      result?.documentId ||
      null;
    return { ok: true, documentId, abcResponse: result, documentName };
  } catch (err) {
    return {
      ok: false,
      step: 'abc_upload',
      error: err.message,
      data: err.response?.data,
      status: err.response?.status,
    };
  }
}

module.exports = { renderAndUploadSignedAgreement, sanitizeDocumentName };
