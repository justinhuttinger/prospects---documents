/**
 * Club lookups for the waiver flow, read once from clubs-config.json.
 *
 * Three different keys identify a club depending on who is calling:
 *   - club_number      ABC's id, what every ABC call needs
 *   - ghlLocationId    which GHL sub-account (and therefore which API key)
 *   - clubName / slug  what the kiosk URL carries (/salem, /keizer, ...)
 *
 * `auth` elsewhere in the portal keys clubs by clubCode; this service keys by
 * clubNumber. Mixing the two silently matches nothing, so everything here is
 * explicit about which id it takes.
 */

const fs = require('fs');
const path = require('path');

const CLUBS_FILE = path.join(__dirname, '..', '..', 'clubs-config.json');

let cache = null;

function loadClubs() {
  if (!cache) {
    cache = (JSON.parse(fs.readFileSync(CLUBS_FILE, 'utf8')).clubs || []).filter(c => c.enabled);
  }
  return cache;
}

function slugOf(club) {
  return String(club.clubName || '').toLowerCase().trim();
}

function byNumber(clubNumber) {
  const target = String(clubNumber || '').trim();
  if (!target) return null;
  return loadClubs().find(c => String(c.clubNumber) === target) || null;
}

function bySlug(slug) {
  const target = String(slug || '').toLowerCase().trim();
  if (!target) return null;
  return loadClubs().find(c => slugOf(c) === target) || null;
}

function byGhlLocationId(locationId) {
  const target = String(locationId || '').trim();
  if (!target) return null;
  return loadClubs().find(c => c.ghlLocationId === target) || null;
}

// The GHL survey path sends only the location's display name, e.g.
// "West Coast Strength - Salem". Kept for that caller.
function byDisplayName(name) {
  const target = String(name || '').trim().toLowerCase();
  if (!target) return null;
  return loadClubs().find(c => `west coast strength - ${slugOf(c)}` === target) || null;
}

// Public shape for the kiosk site — no keys, no station ids.
function publicList() {
  return loadClubs().map(c => ({
    slug: slugOf(c),
    name: c.clubName,
    displayName: `West Coast Strength ${c.clubName}`,
    clubNumber: String(c.clubNumber),
  }));
}

module.exports = { loadClubs, slugOf, byNumber, bySlug, byGhlLocationId, byDisplayName, publicList };
