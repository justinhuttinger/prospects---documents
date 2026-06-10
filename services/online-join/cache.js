/**
 * In-memory cache for the public /api/online-join/config/:locationId payload.
 * Admin writes call invalidateAll() (or invalidate(locationId)) to drop stale
 * entries. TTL is 60s as a backstop in case an admin write somehow bypasses
 * the invalidation hook.
 *
 * v2: keys are composite `${locationId}|${promo||''}` so a promo'd view and the
 * normal view cache separately. invalidate(locationId) therefore drops every
 * promo variant for that location via prefix match.
 */

const TTL_MS = 60_000;
const store = new Map(); // `${locationId}|${promo}` -> { data, expiresAt }

function get(locationId) {
  const entry = store.get(locationId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    store.delete(locationId);
    return null;
  }
  return entry.data;
}

function set(locationId, data) {
  store.set(locationId, { data, expiresAt: Date.now() + TTL_MS });
}

function invalidate(locationId) {
  // Keys are `${locationId}|${promo}` — drop the bare key plus every promo
  // variant for this location.
  store.delete(locationId);
  const prefix = `${locationId}|`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function invalidateAll() {
  store.clear();
}

function stats() {
  return { size: store.size, ttlMs: TTL_MS };
}

module.exports = { get, set, invalidate, invalidateAll, stats };
