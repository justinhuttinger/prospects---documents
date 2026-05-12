/**
 * Insert a row into online_signup_errors. Used by /start and /submit when
 * a step fails. Never throws — error logging is best-effort and must not
 * mask the originating failure.
 *
 * Callers MUST pre-redact payment tokens before passing request_payload /
 * error_payload. See abc-agreement.js#redactPaypageTokens.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');

async function logSignupError({
  signupId,
  step,
  errorType,
  errorMessage,
  errorPayload,
  requestPayload,
}) {
  try {
    const sb = getSupabaseAdmin();
    await sb.from('online_signup_errors').insert({
      signup_id: signupId || null,
      step,
      error_type: errorType || null,
      error_message: (errorMessage || '').slice(0, 1000),
      error_payload: errorPayload || null,
      request_payload: requestPayload || null,
    });
  } catch (err) {
    console.error('[online-join] failed to log error:', err.message);
  }
}

module.exports = { logSignupError };
