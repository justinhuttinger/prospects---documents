/**
 * Fetch a payment plan's validation hash from ABC at signup time.
 *
 * Per ABC's "POST Create Agreement" docs (rev 2025-08-12), the planValidation
 * hash can change daily for plans whose preferred-due-date is "Today" or a
 * fixed offset from agreement start. We must fetch it fresh on every /start —
 * a stored hash will silently rot.
 *
 * ABC endpoint: GET /clubs/{clubNumber}/clubs/plans/{paymentPlanId}
 * (Note: NOT /clubs/plans/{planId}/details — the /details variant returns
 * pricing/schedules but not the planValidation element.)
 *
 * The hash lives in the `response.planValidation` envelope. Field name and
 * shape are inconsistent across ABC versions, so we probe several candidates.
 */

const axios = require('axios');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

function abcHeaders() {
  const appId = process.env.ABC_APP_ID;
  const appKey = process.env.ABC_APP_KEY;
  if (!appId || !appKey) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  return { app_id: appId, app_key: appKey, Accept: 'application/json' };
}

function extractValidationHash(body) {
  const pv =
    body?.paymentPlan?.planValidation ??   // ABC's current GET /clubs/plans/{id} envelope
    body?.response?.planValidation ??
    body?.planValidation ??
    body?.result?.planValidation ??
    body?.plan?.planValidation ??
    null;
  if (pv == null) return null;
  if (typeof pv === 'string' || typeof pv === 'number') return String(pv);
  if (typeof pv === 'object') {
    return (
      pv.hash ??
      pv.value ??
      pv.planValidationHash ??
      pv.validationHash ??
      null
    );
  }
  return null;
}

async function fetchPlanValidationHash({ clubNumber, paymentPlanId }) {
  if (!clubNumber || !paymentPlanId) {
    throw Object.assign(new Error('clubNumber and paymentPlanId are required'), { status: 400 });
  }
  const url = `${ABC_BASE_URL}/${clubNumber}/clubs/plans/${paymentPlanId}`;
  const r = await axios.get(url, { headers: abcHeaders(), timeout: 20000, validateStatus: () => true });
  if (r.status < 200 || r.status >= 300) {
    throw Object.assign(
      new Error(`ABC plan lookup failed (HTTP ${r.status})`),
      { status: 502, abcStatus: r.status, abcBody: r.data }
    );
  }
  const hash = extractValidationHash(r.data);
  if (!hash) {
    throw Object.assign(
      new Error('planValidation hash missing from ABC plan response'),
      { status: 502, abcBody: r.data }
    );
  }
  return { hash, raw: r.data };
}

module.exports = { fetchPlanValidationHash, extractValidationHash };
