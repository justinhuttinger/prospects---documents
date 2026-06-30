// services/vip-referrals/store.js
const { getSupabaseAdmin } = require('../../lib/supabase');

let _client = null;
function db() { return _client || getSupabaseAdmin(); }
function __setClientForTest(c) { _client = c; }

async function getLocationConfig(slug) {
  const { data } = await db()
    .from('vip_referral_config')
    .select('location_slug, abc_club_number, webhook_url, enabled')
    .eq('location_slug', slug)
    .single();
  return data || null;
}

async function createSubmission(fields) {
  const { recipients = [], ...sub } = fields;
  const { data, error } = await db()
    .from('vip_referral_submissions')
    .insert({
      location_slug: sub.location_slug,
      abc_club_number: sub.abc_club_number || null,
      audience: sub.audience || 'staff',
      referrer_first_name: sub.referrer_first_name || null,
      referrer_last_name: sub.referrer_last_name || null,
      referrer_phone: sub.referrer_phone || null,
      referrer_email: sub.referrer_email || null,
      referrer_ghl_contact_id: sub.referrer_ghl_contact_id || null,
      referrer_abc_member_id: sub.referrer_abc_member_id || null,
      employee_id: sub.employee_id || null,
      employee_name: sub.employee_name || null,
      vip_count: sub.vip_count || recipients.length,
      status: 'failed',
      raw_payload: sub.raw_payload || null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const submissionId = data.id;
  let recipientIds = [];
  if (recipients.length) {
    const rows = recipients.map(r => ({
      submission_id: submissionId,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      phone: r.phone || null,
      fanout_status: r.fanout_status || 'failed',
    }));
    const { data: recData, error: rErr } = await db()
      .from('vip_referral_recipients').insert(rows).select('id');
    if (rErr) throw new Error(rErr.message);
    recipientIds = (recData || []).map(r => r.id);
  }
  return { submissionId, recipientIds };
}

async function recordRecipientResult(recipientId, patch) {
  const { error } = await db()
    .from('vip_referral_recipients')
    .update({
      fanout_status: patch.fanout_status,
      http_status: patch.http_status ?? null,
      error_detail: patch.error_detail ?? null,
      webhook_url_used: patch.webhook_url_used ?? null,
      attempt_count: patch.attempt_count ?? 0,
      last_attempt_at: new Date().toISOString(),
      sent_at: patch.fanout_status === 'sent' ? new Date().toISOString() : null,
    })
    .eq('id', recipientId);
  if (error) throw new Error(error.message);
}

async function recomputeSubmissionStatus(submissionId) {
  const { data: recs } = await db()
    .from('vip_referral_recipients')
    .select('fanout_status')
    .eq('submission_id', submissionId);
  const list = recs || [];
  const counted = list.filter(r => r.fanout_status !== 'skipped');
  const sent = counted.filter(r => r.fanout_status === 'sent').length;
  let status = 'failed';
  if (counted.length && sent === counted.length) status = 'completed';
  else if (sent > 0) status = 'partial';
  await db().from('vip_referral_submissions').update({ status }).eq('id', submissionId);
  return status;
}

async function listSubmissions({ location, from, to, status } = {}) {
  let q = db().from('vip_referral_submissions')
    .select('*')
    .order('created_at', { ascending: false });
  if (location) q = q.eq('location_slug', location);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const counts = {
    submissions: rows.length,
    vips: rows.reduce((n, r) => n + (r.vip_count || 0), 0),
    completed: rows.filter(r => r.status === 'completed').length,
    partial: rows.filter(r => r.status === 'partial').length,
    failed: rows.filter(r => r.status === 'failed').length,
  };
  return { rows, counts };
}

async function getSubmission(id) {
  const { data: submission } = await db()
    .from('vip_referral_submissions').select('*').eq('id', id).single();
  const { data: recipients } = await db()
    .from('vip_referral_recipients').select('*').eq('submission_id', id);
  return { submission: submission || null, recipients: recipients || [] };
}

async function getRecipient(id) {
  const { data } = await db()
    .from('vip_referral_recipients').select('*').eq('id', id).single();
  return data || null;
}

async function listConfig() {
  const { data } = await db().from('vip_referral_config').select('*').order('location_slug');
  return data || [];
}

async function updateConfig(slug, patch) {
  const { data, error } = await db()
    .from('vip_referral_config')
    .upsert({ location_slug: slug, ...patch, updated_at: new Date().toISOString() })
    .select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  getLocationConfig, createSubmission, recordRecipientResult,
  recomputeSubmissionStatus, listSubmissions, getSubmission, getRecipient,
  listConfig, updateConfig, __setClientForTest,
};
