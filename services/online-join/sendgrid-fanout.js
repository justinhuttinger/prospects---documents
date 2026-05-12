/**
 * SendGrid welcome email for online-join completions. Non-fatal — failures
 * log to online_signup_errors. ABC's own `sendAgreementEmail: "true"` already
 * sends the agreement copy, so this is the "welcome + Day One CTA" touch.
 *
 * Uses a dynamic template (SENDGRID_TEMPLATE_ID_ONLINE_JOIN). The template
 * receives the variables under `dynamicTemplateData` listed in `buildTemplateData`.
 */

const axios = require('axios');

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'membership@westcoaststrength.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'West Coast Strength';

function buildTemplateData({ signup, plan, location, abcMemberId }) {
  return {
    first_name: signup.first_name || '',
    last_name: signup.last_name || '',
    member_id: String(abcMemberId || ''),
    plan_label: plan.plan_label || '',
    monthly_amount: plan.monthly_amount != null ? String(plan.monthly_amount) : '',
    today_amount: plan.today_amount != null ? String(plan.today_amount) : '',
    location_name: location?.display_name || '',
    location_address: [location?.address_line1, location?.city, location?.state, location?.zip]
      .filter(Boolean).join(', '),
    location_phone: location?.phone || '',
    day_one_booking_url: location?.day_one_booking_url || '',
  };
}

/**
 * Returns { ok: true } on success, { ok: false, error, status, data } otherwise.
 */
async function sendWelcomeEmail({ signup, plan, location, abcMemberId }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const templateId = process.env.SENDGRID_TEMPLATE_ID_ONLINE_JOIN;

  if (!apiKey) return { ok: false, error: 'SENDGRID_API_KEY not set', skipped: true };
  if (!templateId) return { ok: false, error: 'SENDGRID_TEMPLATE_ID_ONLINE_JOIN not set', skipped: true };
  if (!signup.email) return { ok: false, error: 'Signup has no email', skipped: true };

  const body = {
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [
      {
        to: [{ email: signup.email, name: `${signup.first_name || ''} ${signup.last_name || ''}`.trim() }],
        dynamic_template_data: buildTemplateData({ signup, plan, location, abcMemberId }),
      },
    ],
    template_id: templateId,
  };

  try {
    const resp = await axios.post(SENDGRID_API_URL, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (resp.status >= 200 && resp.status < 300) return { ok: true, status: resp.status };
    return { ok: false, error: `SendGrid ${resp.status}`, status: resp.status, data: resp.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendWelcomeEmail };
