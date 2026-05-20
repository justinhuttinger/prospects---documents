/**
 * Build the ABC PayPage iframe URL.
 *
 * ABC PayPage is hosted at https://apipayservice.abcfinancial.net. The widget
 * embeds it in an iframe and listens for postMessage events containing the
 * transaction ID. See spec §4.3 and §13 (ABC integration questions).
 *
 * URL shape (confirmed by ABC 2026-05-20 via the ppsId delivery email):
 *   https://apipayservice.abcfinancial.net/ABC-API-CollectBillingPayPage.jsp?ppsId=<ppsId>
 *
 * `ppsId` comes from ABC and is the same across clubs (set via env).
 * accountTypes restricts the form to card-only (`card`) or ACH-only (`eft`)
 * based on the user's earlier choice in step 4. referenceId is echoed back
 * in postMessage events so the widget can correlate them with state.
 */

const PAYPAGE_HOST = process.env.ABC_PAYPAGE_HOST || 'https://apipayservice.abcfinancial.net';
const PAYPAGE_PATH = '/ABC-API-CollectBillingPayPage.jsp';

function buildPayPageUrl({ paymentMethodChoice, signupId }) {
  const ppsId = process.env.ABC_PPS_ID;
  if (!ppsId) {
    throw Object.assign(
      new Error('ABC_PPS_ID is not configured — set the PayPage ID env var.'),
      { status: 503, code: 'PAYPAGE_NOT_CONFIGURED' }
    );
  }

  const accountType = paymentMethodChoice === 'ach' ? 'eft' : 'card';
  const params = new URLSearchParams({
    ppsId,
    accountTypes: accountType,
    referenceId: signupId,
  });
  return `${PAYPAGE_HOST}${PAYPAGE_PATH}?${params.toString()}`;
}

module.exports = { buildPayPageUrl };
