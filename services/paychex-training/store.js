// Persistence layer for Paychex Training:
//   - createReport({ source, fileName, fileSize }) → creates a pending report
//   - finalizeReport(id, { status, recordCount, parseError, accountName })
//   - upsertRecords(reportId, rows) → bulk upsert into paychex_training_records,
//     stamping last_report_id + last_seen_at so we can detect stale entries.

const { getSupabaseAdmin } = require('../../lib/supabase');

const UPSERT_BATCH_SIZE = 500;

async function createReport({ source = 'webhook', fileName = null, fileSize = null }) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('paychex_training_reports')
    .insert({
      source,
      file_name: fileName,
      file_size_bytes: fileSize,
      parse_status: 'pending',
    })
    .select('id, received_at')
    .single();
  if (error) throw new Error(`createReport failed: ${error.message}`);
  return data;
}

async function finalizeReport(id, fields) {
  const supabase = getSupabaseAdmin();
  const payload = {};
  if (fields.parseStatus !== undefined) payload.parse_status = fields.parseStatus;
  if (fields.recordCount !== undefined) payload.record_count = fields.recordCount;
  if (fields.parseError !== undefined) payload.parse_error = fields.parseError;
  if (fields.accountName !== undefined) payload.account_name = fields.accountName;
  if (fields.rawZipPath !== undefined) payload.raw_zip_path = fields.rawZipPath;
  if (fields.rawCsvPath !== undefined) payload.raw_csv_path = fields.rawCsvPath;
  const { error } = await supabase
    .from('paychex_training_reports')
    .update(payload)
    .eq('id', id);
  if (error) throw new Error(`finalizeReport failed: ${error.message}`);
}

async function upsertRecords(reportId, rows) {
  if (!rows.length) return 0;
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  let total = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE).map((r) => ({
      ...r,
      last_report_id: reportId,
      last_seen_at: now,
      updated_at: now,
    }));
    const { error } = await supabase
      .from('paychex_training_records')
      .upsert(batch, { onConflict: 'user_id,learnable_id' });
    if (error) throw new Error(`upsertRecords (batch starting at ${i}) failed: ${error.message}`);
    total += batch.length;
  }
  return total;
}

module.exports = {
  createReport,
  finalizeReport,
  upsertRecords,
};
