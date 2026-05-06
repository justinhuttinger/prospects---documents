const fs = require('fs');
const path = require('path');

let cached;

function loadConfig() {
  if (!cached) {
    const text = fs.readFileSync(path.join(__dirname, '..', 'clubs-config.json'), 'utf8');
    cached = JSON.parse(text);
  }
  return cached;
}

function findByClubNumber(clubNumber) {
  if (!clubNumber) return null;
  const cfg = loadConfig();
  const target = String(clubNumber);
  return (cfg.clubs || []).find(c => c.enabled && String(c.clubNumber) === target) || null;
}

module.exports = { findByClubNumber };
