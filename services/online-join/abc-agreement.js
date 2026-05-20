/**
 * Build and submit the ABC `POST /members/agreements` payload for an online
 * signup. Payment info always comes from PayPage transaction IDs — never raw
 * card data (spec §6, constraint §12.5).
 *
 * The signup row stores the snapshot of payment_plan_id, club number, and
 * contact info. The plan row stores the additional server-side ABC IDs
 * (plan_validation_hash, campaign_id, sales_person_id).
 */

const axios = require('axios');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

function getAbcHeaders() {
  const appId = process.env.ABC_APP_ID;
  const appKey = process.env.ABC_APP_KEY;
  if (!appId || !appKey) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  return {
    app_id: appId,
    app_key: appKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ABC's POST Create Agreement expects birthday as MM/DD/YYYY (rev 2025-08-12,
// docs page 5). We store the ISO YYYY-MM-DD form, so convert on the way out.
function toAbcBirthday(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

function buildAgreementPayload(signup, plan) {
  const paymentTypeIsCard = signup.paypage_payment_type === 'Credit Card';
  // Prefer the hash captured at /start time — it's the value ABC was using
  // when the user picked the plan, so it matches what they agreed to. The
  // plan-level hash is a fallback for signup rows from before this column
  // was added (or if /start's ABC fetch failed and we wrote nothing).
  const planValidationHash = signup.plan_validation_hash || plan.plan_validation_hash;

  const payload = {
    paymentPlanId: plan.payment_plan_id,
    planValidationHash,
    activePresale: 'false',
    sendAgreementEmail: 'true',
    macAddress: 'WEB',

    agreementContactInfo: {
      firstName: signup.first_name,
      lastName: signup.last_name,
      email: signup.email,
      cellPhone: signup.cell_phone,
      birthday: toAbcBirthday(signup.birthday),
      gender: signup.gender || '',
      agreementAddressInfo: {
        addressLine1: signup.address_line1,
        addressLine2: signup.address_line2 || '',
        city: signup.city,
        state: signup.state,
        zipCode: signup.zip_code,
        country: 'US',
      },
      emergencyContact: {
        ecFirstName: signup.emergency_contact?.first_name || '',
        ecLastName: signup.emergency_contact?.last_name || '',
        ecPhone: signup.emergency_contact?.phone || '',
      },
    },

    // ABC rejects payloads that include BOTH todayBillingInfo/draftBillingInfo
    // AND payPageBillingInfo (API-MEM-MEM-0094). Online-join only ever uses
    // PayPage tokens, so we omit the other envelopes entirely.
    payPageBillingInfo: paymentTypeIsCard
      ? {
          payPageDueTodayCreditCard: {
            todayCreditCardTransactionId: signup.paypage_today_transaction_id,
          },
          payPageDraftCreditCard: {
            draftCreditCardTransactionId:
              signup.paypage_draft_transaction_id || signup.paypage_today_transaction_id,
          },
        }
      : {
          payPageDraftBankAccount: {
            draftAccountTransactionId: signup.paypage_today_transaction_id,
          },
        },

    marketingPreferences: {
      email: signup.marketing_email ? 'true' : 'false',
      sms: signup.marketing_sms ? 'true' : 'false',
      directMail: 'false',
      pushNotification: 'true',
    },
  };

  if (plan.campaign_id) payload.campaignId = plan.campaign_id;
  if (plan.sales_person_id) payload.salesPersonId = plan.sales_person_id;

  return payload;
}

/**
 * Redact PayPage transaction IDs from a payload for safe logging. The error
 * logger writes to online_signup_errors and we never persist payment tokens
 * (spec §12).
 */
function redactPaypageTokens(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  try {
    const clone = JSON.parse(JSON.stringify(payload));
    const ppb = clone.payPageBillingInfo;
    if (ppb?.payPageDueTodayCreditCard) ppb.payPageDueTodayCreditCard = { todayCreditCardTransactionId: '[REDACTED]' };
    if (ppb?.payPageDraftCreditCard) ppb.payPageDraftCreditCard = { draftCreditCardTransactionId: '[REDACTED]' };
    if (ppb?.payPageDraftBankAccount) ppb.payPageDraftBankAccount = { draftAccountTransactionId: '[REDACTED]' };
    return clone;
  } catch {
    return { redacted: true };
  }
}

async function postAgreement({ clubNumber, payload }) {
  const url = `${ABC_BASE_URL}/${clubNumber}/members/agreements`;
  const response = await axios.post(url, payload, {
    headers: getAbcHeaders(),
    timeout: 30000,
    validateStatus: () => true, // we inspect the status ourselves
  });
  return response;
}

module.exports = {
  buildAgreementPayload,
  postAgreement,
  redactPaypageTokens,
};
