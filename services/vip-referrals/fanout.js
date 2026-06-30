// services/vip-referrals/fanout.js
const axios = require('axios');

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fireRecipient(webhookUrl, payload, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 300;
  const post = opts.post ?? ((url, body) =>
    axios.post(url, body, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }));
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await post(webhookUrl, payload);
      return { ok: true, http_status: resp.status, error_detail: null, attempt_count: attempt };
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) await sleep(backoffMs * Math.pow(2, attempt - 1));
    }
  }
  return {
    ok: false,
    http_status: lastErr?.response?.status ?? null,
    error_detail: lastErr?.response?.data ?? lastErr?.message ?? 'unknown',
    attempt_count: maxAttempts,
  };
}

module.exports = { fireRecipient };
