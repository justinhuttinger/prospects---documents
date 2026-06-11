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

// ABC expects gender as male|female|unknown (API-MEM-VAL-0030). The widget
// stores M/F/O, so map on the way out. Blank stays blank (ABC tolerates it).
function toAbcGender(g) {
  switch (String(g || '').trim().toUpperCase()) {
    case 'M': case 'MALE': return 'male';
    case 'F': case 'FEMALE': return 'female';
    case 'O': case 'U': case 'UNKNOWN': return 'unknown';
    default: return '';
  }
}

// Assemble payPageBillingInfo from the today + draft tokens and their methods.
// Generalizes all three modes (PayPage tokens only, never raw billing — so we
// never trip API-MEM-MEM-0094):
//   - Card-only:      today=card, draft=card  → dueTodayCC + draftCC
//   - Bank-only ($0): no today,  draft=bank  → draftBank (no today charge)
//   - Hybrid (EFT+today due): today=card, draft=bank → dueTodayCC + draftBank
// `paypage_draft_payment_type` may differ from `paypage_payment_type` (today)
// only in the hybrid; older rows without it fall back to the today method.
function buildPayPageBillingInfo(signup) {
  const todayId = signup.paypage_today_transaction_id || null;
  const draftId = signup.paypage_draft_transaction_id || signup.paypage_today_transaction_id || null;
  const todayIsCard = signup.paypage_payment_type === 'Credit Card';
  const draftIsCard = (signup.paypage_draft_payment_type || signup.paypage_payment_type) === 'Credit Card';

  const ppb = {};
  // A today charge is only collectible via credit card (ABC has no bank
  // "due today"). For a bank-only $0-today signup there's no card token, so we
  // simply omit the today leg.
  if (todayId && todayIsCard) {
    ppb.payPageDueTodayCreditCard = { todayCreditCardTransactionId: todayId };
  }
  if (draftIsCard) {
    ppb.payPageDraftCreditCard = { draftCreditCardTransactionId: draftId };
  } else {
    ppb.payPageDraftBankAccount = { draftAccountTransactionId: draftId };
  }
  return ppb;
}

function buildAgreementPayload(signup, plan) {
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
      // Club 30935 requires homePhone (API-MEM-VAL-0123) — the widget only
      // collects one phone, so mirror cell_phone into both slots. Most members
      // don't have a separate landline anyway.
      homePhone: signup.cell_phone,
      cellPhone: signup.cell_phone,
      birthday: toAbcBirthday(signup.birthday),
      gender: toAbcGender(signup.gender),
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

    // PayPage tokens only — we never send todayBillingInfo/draftBillingInfo
    // alongside this (API-MEM-MEM-0094). See buildPayPageBillingInfo for the
    // three modes (card-only / bank-only-$0 / EFT card-today hybrid).
    payPageBillingInfo: buildPayPageBillingInfo(signup),

    marketingPreferences: {
      email: signup.marketing_email ? 'true' : 'false',
      sms: signup.marketing_sms ? 'true' : 'false',
      directMail: 'false',
      pushNotification: 'true',
    },
  };

  // Household / secondary members (family plans). They ride on the same
  // agreement; the size-matched paymentPlanId already carries the combined dues.
  // Address is inherited from the primary. DOB is sent ISO (per ABC's example).
  const secondaries = Array.isArray(signup.secondary_members) ? signup.secondary_members : [];
  if (secondaries.length) {
    payload.secondaryMembers = {
      secondaryMemberInfo: secondaries.map((m) => ({
        secondaryFirstName: m.first_name || '',
        secondaryLastName: m.last_name || '',
        secondaryDateOfBirth: m.birthday || '',
        secondaryEmail: m.email || '',
        secondaryMobilePhone: m.cell_phone || '',
        secondaryHomePhone: m.cell_phone || '',
        secondaryMailingAddress: 'true',
        secondaryCity: signup.city || '',
        secondaryState: signup.state || '',
        secondaryPostalCode: signup.zip_code || '',
        secondaryCountry: 'US',
      })),
    };
  }

  // Required add-on schedules (e.g. a CC convenience fee billed as a separate
  // recurring line). ABC rejects the agreement (API-MEM-MEM-0024) unless every
  // defaultChecked add-on schedule is echoed back under `schedules.addon` as the
  // exact profit-center name from the plan detail. We captured those names live
  // at /start (signup.abc_addon_schedules) so the casing matches verbatim.
  const addonSchedules = Array.isArray(signup.abc_addon_schedules) ? signup.abc_addon_schedules : [];
  if (addonSchedules.length) {
    payload.schedules = { addon: addonSchedules };
  }

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
