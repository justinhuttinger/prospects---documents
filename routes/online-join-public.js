/**
 * /api/online-join/* — public endpoints called by the WordPress widget.
 * No auth required. CORS handled at the Express level (see index.js).
 *
 * Phase 4a: GET /config/:locationId, POST /eligibility
 * Phase 4b: POST /start, POST /submit
 */

const express = require('express');
const { loadPublicConfig } = require('../services/online-join/config-loader');
const { evaluateEligibility, ageFromBirthday, ageMatchesRule } = require('../services/online-join/eligibility');
const { buildPayPageUrl } = require('../services/online-join/paypage-url');
const {
  digitsOnly,
  validateContact,
  validateEmergencyContact,
  validatePaymentMethod,
} = require('../services/online-join/validators');
const { buildAgreementPayload, postAgreement, redactPaypageTokens } =
  require('../services/online-join/abc-agreement');
const { fetchPlanValidationHash } = require('../services/online-join/abc-plan-fetch');
const { upsertOnlineJoinContact } = require('../services/online-join/ghl-fanout');
const { sendWelcomeEmail } = require('../services/online-join/sendgrid-fanout');
const { logSignupError } = require('../services/online-join/error-log');
const { getSupabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/online-join/locations
// Returns the list of active locations with public fields only — used by the
// widget's step 1 location picker. ABC + GHL IDs are stripped server-side.
// ---------------------------------------------------------------------------
router.get('/locations', async (req, res) => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from('online_join_locations')
      .select('wcs_location_id, display_name, address_line1, city, state, zip, phone, hours_summary, hero_headline, hero_subhead, day_one_booking_url')
      .eq('active', true)
      .order('display_name');
    if (error) throw error;
    res.json({ locations: data || [] });
  } catch (err) {
    console.error('[online-join-public] /locations error:', err.message);
    res.status(500).json({ error: 'Failed to load locations' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/online-join/config/:locationId
// Returns location + active plans + copy. 60s in-memory cache; admin writes
// invalidate.
// ---------------------------------------------------------------------------
router.get('/config/:locationId', async (req, res) => {
  try {
    const payload = await loadPublicConfig(req.params.locationId);
    if (!payload) return res.status(404).json({ error: 'Location not found or inactive' });
    res.json(payload);
  } catch (err) {
    console.error('[online-join-public] /config error:', err.message);
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/online-join/eligibility
// Body: { plan_id, birthday: 'YYYY-MM-DD' }
// Returns:
//   { eligible: true }
//   { eligible: false, ineligible_message, suggested_plans: [...] }
// ---------------------------------------------------------------------------
router.post('/eligibility', async (req, res) => {
  try {
    const { plan_id, birthday } = req.body || {};
    const result = await evaluateEligibility({ planId: plan_id, birthday });
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    console.error('[online-join-public] /eligibility error:', err.message);
    res.status(status).json({ error: err.message || 'Eligibility check failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/online-join/start
// Creates the signup row and returns the PayPage URL.
// Body:
//   {
//     wcs_location_id, plan_id, payment_method_choice: 'card'|'ach',
//     contact: { first_name, last_name, email, cell_phone, birthday,
//                gender?, address_line1, address_line2?, city, state, zip_code },
//     emergency_contact: { first_name, last_name, phone },
//     marketing: { email: bool, sms: bool },
//     attribution: { fbclid?, fbp?, utm_source?, utm_medium?, utm_campaign? }
//   }
// Returns: { signup_id, paypage_url }
// ---------------------------------------------------------------------------
router.post('/start', async (req, res) => {
  const body = req.body || {};
  const sb = getSupabaseAdmin();

  try {
    const {
      wcs_location_id,
      plan_id,
      payment_method_choice,
      contact = {},
      emergency_contact = {},
      marketing = {},
      attribution = {},
    } = body;

    if (!wcs_location_id) return res.status(400).json({ error: 'wcs_location_id is required' });
    if (!plan_id) return res.status(400).json({ error: 'plan_id is required' });

    // Collect all field errors at once so the widget can show them together.
    const errors = [
      ...validatePaymentMethod(payment_method_choice),
      ...validateContact(contact),
      ...validateEmergencyContact(emergency_contact),
    ];
    if (errors.length) return res.status(400).json({ error: 'Validation failed', errors });

    // Plan must exist, be active, and match the location. Load the server-side
    // ABC fields here too — we snapshot payment_plan_id into the signup row.
    const { data: plan, error: planErr } = await sb
      .from('online_join_plans')
      .select(`
        id, wcs_location_id, plan_key, plan_label, active,
        payment_plan_id, plan_validation_hash, campaign_id, sales_person_id,
        today_amount, monthly_amount,
        age_rule:age_rule_id ( id, name, min_age, max_age, ineligible_message )
      `)
      .eq('id', plan_id)
      .maybeSingle();
    if (planErr) throw new Error(`Plan lookup failed: ${planErr.message}`);
    if (!plan || !plan.active) return res.status(404).json({ error: 'Plan not found or inactive' });
    if (plan.wcs_location_id !== wcs_location_id) {
      return res.status(400).json({ error: 'Plan does not belong to this location' });
    }

    // Location → abc_club_number, used both for the signup row and routing.
    const { data: location, error: locErr } = await sb
      .from('online_join_locations')
      .select('wcs_location_id, abc_club_number, active')
      .eq('wcs_location_id', wcs_location_id)
      .maybeSingle();
    if (locErr) throw new Error(`Location lookup failed: ${locErr.message}`);
    if (!location || !location.active) return res.status(404).json({ error: 'Location not found or inactive' });

    // Server-side eligibility (spec §12.3 — client check is advisory).
    const age = ageFromBirthday(contact.birthday);
    if (age == null || age < 0 || age > 120) {
      return res.status(400).json({ error: 'Birthday is invalid' });
    }
    if (plan.age_rule && !ageMatchesRule(age, plan.age_rule)) {
      return res.status(422).json({
        error: 'Not eligible for this plan',
        eligibility: {
          eligible: false,
          ineligible_message: plan.age_rule.ineligible_message,
        },
      });
    }

    // Fetch a fresh planValidation hash from ABC (the stored plan-level hash
    // can be stale — ABC says it rotates daily for plans with dynamic due
    // dates). Fall back to the stored hash if the fetch fails, so a transient
    // ABC outage doesn't block signups outright.
    let planValidationHash = plan.plan_validation_hash || null;
    try {
      const { hash } = await fetchPlanValidationHash({
        clubNumber: location.abc_club_number,
        paymentPlanId: plan.payment_plan_id,
      });
      planValidationHash = hash;
    } catch (err) {
      await logSignupError({
        step: 'start',
        errorType: 'PLAN_HASH_FETCH_FAILED',
        errorMessage: err.message,
        errorPayload: err.abcBody || null,
      });
      if (!planValidationHash) {
        return res.status(502).json({
          error: 'Could not validate plan with ABC. Please try again or call the club.',
          code: 'PLAN_HASH_UNAVAILABLE',
        });
      }
      // else: continue with the stored fallback hash.
    }

    // Normalize before insert (digits-only phone, trimmed state).
    const insertRow = {
      status: 'payment_pending',
      wcs_location_id,
      plan_id: plan.id,
      payment_plan_id: plan.payment_plan_id,
      plan_validation_hash: planValidationHash,
      abc_club_number: location.abc_club_number,

      first_name: String(contact.first_name || '').trim(),
      last_name: String(contact.last_name || '').trim(),
      email: String(contact.email || '').trim().toLowerCase(),
      cell_phone: digitsOnly(contact.cell_phone),
      birthday: contact.birthday,
      gender: contact.gender || null,
      address_line1: String(contact.address_line1 || '').trim(),
      address_line2: contact.address_line2 ? String(contact.address_line2).trim() : null,
      city: String(contact.city || '').trim(),
      state: String(contact.state || '').trim().toUpperCase(),
      zip_code: String(contact.zip_code || '').trim(),
      emergency_contact: {
        first_name: String(emergency_contact.first_name || '').trim(),
        last_name: String(emergency_contact.last_name || '').trim(),
        phone: digitsOnly(emergency_contact.phone),
      },

      payment_method_choice,

      marketing_email: marketing.email !== false,
      marketing_sms: marketing.sms !== false,

      fbclid: attribution.fbclid || null,
      fbp: attribution.fbp || null,
      client_ip: req.headers['cf-connecting-ip'] || req.ip || null,
      user_agent: (req.headers['user-agent'] || '').slice(0, 500),
      utm_source: attribution.utm_source || null,
      utm_medium: attribution.utm_medium || null,
      utm_campaign: attribution.utm_campaign || null,

      started_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertErr } = await sb
      .from('online_signups')
      .insert(insertRow)
      .select('id')
      .single();
    if (insertErr) throw new Error(`Insert signup failed: ${insertErr.message}`);

    let paypageUrl;
    try {
      paypageUrl = buildPayPageUrl({
        paymentMethodChoice: payment_method_choice,
        signupId: inserted.id,
      });
    } catch (err) {
      await logSignupError({
        signupId: inserted.id,
        step: 'start',
        errorType: 'PAYPAGE_NOT_CONFIGURED',
        errorMessage: err.message,
      });
      return res.status(err.status || 503).json({
        error: err.message,
        code: err.code || 'PAYPAGE_NOT_CONFIGURED',
      });
    }

    res.json({ signup_id: inserted.id, paypage_url: paypageUrl });
  } catch (err) {
    console.error('[online-join-public] /start error:', err.message);
    await logSignupError({
      step: 'start',
      errorType: 'UNHANDLED',
      errorMessage: err.message,
      requestPayload: redactPaypageTokens(body),
    });
    res.status(500).json({ error: 'Failed to start signup' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/online-join/submit
// Receives PayPage transaction ID, posts ABC agreement, fans out.
// Body: { signup_id, paypage_transaction_id, paypage_payment_type }
// Returns: { success, member_id, day_one_booking_url, plan_label, monthly_amount }
//          OR { success: false, error, code }
// ---------------------------------------------------------------------------
router.post('/submit', async (req, res) => {
  const { signup_id, paypage_transaction_id, paypage_payment_type } = req.body || {};
  const sb = getSupabaseAdmin();

  if (!signup_id) return res.status(400).json({ error: 'signup_id is required' });
  if (!paypage_transaction_id) return res.status(400).json({ error: 'paypage_transaction_id is required' });
  if (paypage_payment_type !== 'Credit Card' && paypage_payment_type !== 'Bank Account') {
    return res.status(400).json({ error: 'paypage_payment_type must be "Credit Card" or "Bank Account"' });
  }

  try {
    // 1. Load signup row.
    const { data: signup, error: sErr } = await sb
      .from('online_signups')
      .select('*')
      .eq('id', signup_id)
      .maybeSingle();
    if (sErr) throw new Error(`Signup lookup failed: ${sErr.message}`);
    if (!signup) return res.status(404).json({ error: 'Signup not found' });

    // 2. Idempotency: if already completed, replay the success response.
    if (signup.status === 'agreement_created') {
      const { data: plan } = await sb
        .from('online_join_plans')
        .select('plan_label, monthly_amount')
        .eq('id', signup.plan_id)
        .maybeSingle();
      const { data: location } = await sb
        .from('online_join_locations')
        .select('day_one_booking_url')
        .eq('wcs_location_id', signup.wcs_location_id)
        .maybeSingle();
      return res.json({
        success: true,
        already_completed: true,
        member_id: signup.abc_member_id,
        plan_label: plan?.plan_label || null,
        monthly_amount: plan?.monthly_amount != null ? Number(plan.monthly_amount) : null,
        day_one_booking_url: location?.day_one_booking_url || null,
      });
    }

    // 3. Status must be payment_pending. Refuse anything else.
    if (signup.status !== 'payment_pending') {
      return res.status(409).json({
        error: `Signup is in status "${signup.status}" — cannot submit`,
        code: 'BAD_STATUS',
      });
    }

    // 4. Record PayPage token + payment type before posting to ABC.
    const { error: updErr } = await sb
      .from('online_signups')
      .update({
        paypage_today_transaction_id: paypage_transaction_id,
        paypage_draft_transaction_id: paypage_transaction_id,
        paypage_payment_type,
        status: 'submitted_to_abc',
        payment_at: new Date().toISOString(),
      })
      .eq('id', signup_id);
    if (updErr) throw new Error(`Update signup failed: ${updErr.message}`);

    // 5. Load plan (server-side ABC IDs needed for payload).
    const { data: plan, error: planErr } = await sb
      .from('online_join_plans')
      .select('*')
      .eq('id', signup.plan_id)
      .maybeSingle();
    if (planErr) throw new Error(`Plan lookup failed: ${planErr.message}`);
    if (!plan) throw new Error('Plan not found');

    // 6. Build + POST ABC agreement.
    const inMemSignup = {
      ...signup,
      paypage_today_transaction_id: paypage_transaction_id,
      paypage_draft_transaction_id: paypage_transaction_id,
      paypage_payment_type,
    };
    const abcPayload = buildAgreementPayload(inMemSignup, plan);
    const abcResp = await postAgreement({
      clubNumber: signup.abc_club_number,
      payload: abcPayload,
    });

    // 7. Extract member/agreement IDs from ABC response.
    // ABC returns HTTP 200 with an embedded error body on validation failures
    // (e.g. {status: {messageCode: "API-MEM-VAL-0111", message: "..."}, result:
    // {memberId: null}}), so we must inspect the body — not just the HTTP code.
    const abcData = abcResp.data || {};
    const abcMemberId =
      abcData?.agreement?.memberId ||
      abcData?.result?.memberId ||
      abcData?.memberId ||
      null;
    const abcAgreementId =
      abcData?.agreement?.agreementId ||
      abcData?.result?.agreementId ||
      abcData?.result?.agreementNumber ||
      abcData?.agreementId ||
      null;
    const abcEmbeddedErrorCode = abcData?.status?.messageCode || null;
    const abcEmbeddedErrorMsg = abcData?.status?.message || null;
    const isHttpError = abcResp.status < 200 || abcResp.status >= 300;
    const isEmbeddedError =
      (abcEmbeddedErrorCode && abcEmbeddedErrorCode.startsWith('API-')) ||
      !abcMemberId;

    if (isHttpError || isEmbeddedError) {
      const errorType = isHttpError
        ? `ABC_${abcResp.status}`
        : `ABC_${abcEmbeddedErrorCode || 'NO_MEMBER_ID'}`;
      const errorMessage = abcEmbeddedErrorMsg
        || (typeof abcData === 'string' ? abcData : JSON.stringify(abcData).slice(0, 500));
      await logSignupError({
        signupId: signup_id,
        step: 'submit',
        errorType,
        errorMessage,
        errorPayload: abcData || null,
        requestPayload: redactPaypageTokens(abcPayload),
      });
      await sb.from('online_signups').update({
        status: 'failed',
        abc_response: abcData,
      }).eq('id', signup_id);
      return res.status(502).json({
        success: false,
        error: 'Membership could not be created. Our team has been notified — please call the club.',
        code: 'ABC_REJECTED',
      });
    }

    await sb.from('online_signups').update({
      status: 'agreement_created',
      abc_member_id: abcMemberId,
      abc_agreement_id: abcAgreementId,
      abc_response: abcData,
      submitted_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    }).eq('id', signup_id);

    // 8. Fan-out (non-fatal — failures log to online_signup_errors).
    // GHL upsert.
    try {
      const ghlResult = await upsertOnlineJoinContact({
        signup: inMemSignup,
        plan,
        abcMemberId,
        abcAgreementId,
      });
      if (ghlResult.ok) {
        if (ghlResult.contactId) {
          await sb.from('online_signups').update({ ghl_contact_id: ghlResult.contactId }).eq('id', signup_id);
        }
      } else {
        await logSignupError({
          signupId: signup_id,
          step: 'fanout',
          errorType: 'GHL_UPSERT',
          errorMessage: ghlResult.error,
          errorPayload: ghlResult.data || null,
        });
      }
    } catch (err) {
      await logSignupError({
        signupId: signup_id,
        step: 'fanout',
        errorType: 'GHL_UPSERT_THREW',
        errorMessage: err.message,
      });
    }

    // SendGrid welcome.
    let location = null;
    try {
      const { data: loc } = await sb
        .from('online_join_locations')
        .select('*')
        .eq('wcs_location_id', signup.wcs_location_id)
        .maybeSingle();
      location = loc;
      const sgResult = await sendWelcomeEmail({
        signup: inMemSignup,
        plan,
        location,
        abcMemberId,
      });
      if (sgResult.ok) {
        await sb.from('online_signups').update({ confirmation_email_sent: true }).eq('id', signup_id);
      } else if (!sgResult.skipped) {
        await logSignupError({
          signupId: signup_id,
          step: 'fanout',
          errorType: 'SENDGRID',
          errorMessage: sgResult.error,
          errorPayload: sgResult.data || null,
        });
      }
    } catch (err) {
      await logSignupError({
        signupId: signup_id,
        step: 'fanout',
        errorType: 'SENDGRID_THREW',
        errorMessage: err.message,
      });
    }

    // 9. Respond to user.
    res.json({
      success: true,
      member_id: abcMemberId,
      plan_label: plan.plan_label,
      monthly_amount: plan.monthly_amount != null ? Number(plan.monthly_amount) : null,
      day_one_booking_url: location?.day_one_booking_url || null,
    });
  } catch (err) {
    console.error('[online-join-public] /submit error:', err.message);
    await logSignupError({
      signupId: signup_id,
      step: 'submit',
      errorType: 'UNHANDLED',
      errorMessage: err.message,
    });
    res.status(500).json({ success: false, error: 'Failed to submit signup', code: 'INTERNAL' });
  }
});

module.exports = router;
