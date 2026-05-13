// Pull every Worker for each WCS Paychex company and persist a flat
// (email_lower, company_id, location_slug) mapping into paychex_user_locations.
// The /records endpoint joins on email_lower to surface a per-row location.
//
// Idempotent — re-running just refreshes the rows in place.

const { getWorkers } = require('../../lib/paychex');
const { PAYCHEX_LOCATIONS } = require('../../lib/paychex-locations');
const { getSupabaseAdmin } = require('../../lib/supabase');

const UPSERT_BATCH_SIZE = 500;

// Paychex Worker → flat row for paychex_user_locations. Email lives on the
// worker.communications array (one item per channel — pull the personal/work
// email that's marked primary, falling back to the first email present).
function pickEmail(worker) {
  const channels = worker?.communications || [];
  const emails = channels.filter((c) => (c.channelType || '').toLowerCase() === 'email');
  if (!emails.length) return null;
  const primary = emails.find((c) => c.primary === true || c.primary === 'true');
  return (primary?.value || emails[0]?.value || '').trim() || null;
}

function workerToRow(worker, companyId, locationSlug) {
  const email = pickEmail(worker);
  if (!email) return null;
  return {
    email_lower: email.toLowerCase(),
    email,
    paychex_worker_id: worker.workerId || worker.id || null,
    display_id: worker.displayId || null,
    company_id: companyId,
    location_slug: locationSlug,
    first_name: worker.name?.firstName || null,
    last_name: worker.name?.lastName || null,
    worker_status: worker.currentStatus?.statusType || worker.status || null,
    refreshed_at: new Date().toISOString(),
  };
}

async function refreshAllLocations() {
  if (!PAYCHEX_LOCATIONS.length) {
    throw new Error('No Paychex companies configured — set PAYCHEX_COMPANY_* env vars');
  }

  const supabase = getSupabaseAdmin();
  const perLocation = [];
  let totalRows = 0;

  for (const loc of PAYCHEX_LOCATIONS) {
    try {
      const workers = await getWorkers(loc.companyId);
      const rows = workers
        .map((w) => workerToRow(w, loc.companyId, loc.slug))
        .filter(Boolean);

      for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
        const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
        const { error } = await supabase
          .from('paychex_user_locations')
          .upsert(batch, { onConflict: 'email_lower,company_id' });
        if (error) throw new Error(`upsert (${loc.slug}, batch ${i}) failed: ${error.message}`);
      }

      console.log(`[Paychex Locations] ${loc.slug}: ${workers.length} workers, ${rows.length} with email`);
      perLocation.push({ slug: loc.slug, workers: workers.length, with_email: rows.length });
      totalRows += rows.length;
    } catch (err) {
      console.error(`[Paychex Locations] ${loc.slug} failed:`, err.message);
      perLocation.push({ slug: loc.slug, error: err.message });
    }
  }

  return { totalRows, perLocation, refreshedAt: new Date().toISOString() };
}

module.exports = { refreshAllLocations, workerToRow, pickEmail };
