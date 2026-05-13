// Paychex Flex (HR) API client. Mirrors the implementation in
// `wcs-staff-portal/auth/src/services/paychex.js` so this service can resolve
// the per-employee location independently. We only need read-only access:
// listCompanies + getWorkers.

let cachedToken = null;
let tokenExpiresAt = 0;

const TOKEN_URL = 'https://api.paychex.com/auth/oauth/v2/token';
const API_BASE = 'https://api.paychex.com';

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60_000) return cachedToken;

  const clientId = process.env.PAYCHEX_API_KEY;
  const clientSecret = process.env.PAYCHEX_API_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PAYCHEX_API_KEY and PAYCHEX_API_SECRET must be set');
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) throw new Error(`Paychex token error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function paychexGet(path, params = {}) {
  const token = await getAccessToken();
  const qs = new URLSearchParams(params).toString();
  const url = API_BASE + path + (qs ? '?' + qs : '');
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!resp.ok) throw new Error(`Paychex API error ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function getWorkers(companyId) {
  const workers = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const data = await paychexGet(`/companies/${companyId}/workers`, { offset, limit });
    const items = data.content || [];
    workers.push(...items);
    const pagination = data.metadata?.pagination;
    if (!pagination || workers.length >= pagination.itemCount) break;
    offset += limit;
  }
  return workers;
}

module.exports = { getAccessToken, paychexGet, getWorkers };
