// Admin read API for the Paychex Training tile in the staff portal.
// Mounted behind requireAdmin in index.js, so every handler trusts req.staff.
//
//   GET  /api/admin/paychex-training/summary       — top-line counts
//   GET  /api/admin/paychex-training/records       — paginated rows + filters
//   GET  /api/admin/paychex-training/reports       — list of recent webhook deliveries
//   GET  /api/admin/paychex-training/courses       — distinct (learnable_id, title) tuples

const express = require('express');
const { getSupabaseAdmin } = require('../lib/supabase');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/admin/paychex-training/summary
// ---------------------------------------------------------------------------
router.get('/summary', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const [
      latestReportRes,
      totalRes,
      completedRes,
      overdueRes,
      inProgressRes,
      notStartedRes,
      requiredRes,
    ] = await Promise.all([
      supabase
        .from('paychex_training_reports')
        .select('id, received_at, record_count, account_name, parse_status')
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('paychex_training_records').select('id', { count: 'exact', head: true }),
      supabase.from('paychex_training_records').select('id', { count: 'exact', head: true }).ilike('status', 'completed'),
      supabase.from('paychex_training_records').select('id', { count: 'exact', head: true }).ilike('status', 'overdue'),
      supabase.from('paychex_training_records').select('id', { count: 'exact', head: true }).ilike('status', 'in progress'),
      supabase.from('paychex_training_records').select('id', { count: 'exact', head: true }).ilike('status', 'not started'),
      supabase.from('paychex_training_records').select('id', { count: 'exact', head: true }).eq('required', true),
    ]);

    res.json({
      latest_report: latestReportRes.data || null,
      total_records: totalRes.count || 0,
      completed: completedRes.count || 0,
      overdue: overdueRes.count || 0,
      in_progress: inProgressRes.count || 0,
      not_started: notStartedRes.count || 0,
      required: requiredRes.count || 0,
    });
  } catch (err) {
    console.error('[Paychex Training admin] /summary failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/paychex-training/records
//   ?status=Completed|Overdue|In Progress|Not Started
//   &required=true|false
//   &course=<learnable_id>
//   &q=<freeform: name/email/title>
//   &page=1&page_size=50
// ---------------------------------------------------------------------------
router.get('/records', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const pageSize = Math.min(parseInt(req.query.page_size || '50', 10) || 50, 500);
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = supabase
      .from('paychex_training_records')
      .select(
        'id, user_id, user_name, email, hris_id, manager_name, manager_email, ' +
        'title, learnable_id, learnable_type, program_titles, status, required, ' +
        'score, enrollment_date, due_date, completion_date, expiration_date, ' +
        're_enrollment_date, modification_date, account_name, certificate_link, ' +
        'user_deleted, last_seen_at, last_report_id',
        { count: 'exact' }
      );

    if (req.query.status) q = q.ilike('status', req.query.status);
    if (req.query.required === 'true') q = q.eq('required', true);
    if (req.query.required === 'false') q = q.eq('required', false);
    if (req.query.course) q = q.eq('learnable_id', req.query.course);
    if (req.query.q) {
      const pat = `%${String(req.query.q).replace(/[%_]/g, '')}%`;
      q = q.or(`user_name.ilike.${pat},email.ilike.${pat},title.ilike.${pat}`);
    }

    q = q.order('user_name', { ascending: true }).order('title', { ascending: true }).range(from, to);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    res.json({
      rows: data || [],
      page,
      page_size: pageSize,
      total: count || 0,
    });
  } catch (err) {
    console.error('[Paychex Training admin] /records failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/paychex-training/reports — recent webhook deliveries
// ---------------------------------------------------------------------------
router.get('/reports', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const limit = Math.min(parseInt(req.query.limit || '25', 10) || 25, 100);
    const { data, error } = await supabase
      .from('paychex_training_reports')
      .select('id, received_at, source, file_name, file_size_bytes, record_count, parse_status, parse_error, account_name')
      .order('received_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    res.json({ reports: data || [] });
  } catch (err) {
    console.error('[Paychex Training admin] /reports failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/paychex-training/courses — distinct courses for filter dropdown
// ---------------------------------------------------------------------------
router.get('/courses', async (req, res) => {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('paychex_training_records')
      .select('learnable_id, title, learnable_type')
      .order('title', { ascending: true });
    if (error) throw new Error(error.message);
    const seen = new Set();
    const courses = [];
    for (const r of (data || [])) {
      if (!r.learnable_id || seen.has(r.learnable_id)) continue;
      seen.add(r.learnable_id);
      courses.push({ learnable_id: r.learnable_id, title: r.title, learnable_type: r.learnable_type });
    }
    res.json({ courses });
  } catch (err) {
    console.error('[Paychex Training admin] /courses failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
