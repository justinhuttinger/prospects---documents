/**
 * JWT auth + admin role middleware for /api/admin/* routes.
 *
 * Validates a Supabase-issued JWT from the `Authorization: Bearer <token>`
 * header, then looks up the corresponding row in the `staff` table to
 * confirm role === 'admin'. Mirrors the staff portal's `auth/src/middleware/auth.js`
 * pattern but trims down to what this service actually needs (no location
 * resolution — admin-only routes operate cross-location).
 *
 * On success, attaches `req.staff = { id, email, display_name, role }` for
 * audit / updated_by columns.
 */

const { getSupabaseAdmin } = require('../lib/supabase');

async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = header.slice(7);

  try {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: userResult, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !userResult?.user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const userId = userResult.user.id;

    const { data: staff, error: staffError } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, role')
      .eq('id', userId)
      .single();

    if (staffError || !staff) {
      return res.status(401).json({ error: 'Staff account not found' });
    }
    if (staff.role !== 'admin') {
      return res.status(403).json({ error: 'Admin role required' });
    }

    req.staff = staff;
    next();
  } catch (err) {
    console.error('[require-admin] verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = requireAdmin;
