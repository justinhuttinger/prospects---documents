/**
 * Build the ABC PayPage iframe URL.
 *
 * ABC PayPage is hosted at https://apipayservice.abcfinancial.net. The widget
 * embeds it in an iframe and listens for postMessage events containing the
 * transaction ID. See spec §4.3 and §13 (ABC integration questions).
 *
 * URL shape (from ABC docs):
 *   https://apipayservice.abcfinancial.net/paypage/<ppsId>?accountTypes=card
 *   https://apipayservice.abcfinancial.net/paypage/<ppsId>?accountTypes=eft
 *
 * `ppsId` comes from ABC and is the same across clubs (set via env). The
 * accountTypes filter restricts the form to card-only or ACH-only based on
 * the user's earlier choice in step 4.
 */

const PAYPAGE_HOST = process.env.ABC_PAYPAGE_HOST || 'https://apipayservice.abcfinancial.net';

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
    accountTypes: accountType,
    // signupId is echoed back in postMessage events from ABC's iframe so the
    // widget can correlate them with state. Not consumed server-side.
    referenceId: signupId,
  });
  return `${PAYPAGE_HOST}/paypage/${ppsId}?${params.toString()}`;
}

module.exports = { buildPayPageUrl };
