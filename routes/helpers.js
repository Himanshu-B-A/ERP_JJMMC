const db = require('../db');

function requireAuth(req, res, next) {
  if (!req.session.user) {
    if (req.accepts('html')) return res.redirect('/login.html');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.session.user.role))
      return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

function logActivity(userId, action, entity, entityId, details, ip) {
  try {
    db.prepare(
      `INSERT INTO activity_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(userId || null, action, entity || null, entityId || null, details || null, ip || null);
  } catch (_) { /* non-critical */ }
}

// Paginate helper: returns { rows, total, page, per_page, pages }
function paginate(sql, countSql, args, page, perPage) {
  const total = db.prepare(countSql).get(...args)?.c || 0;
  const offset = (page - 1) * perPage;
  const rows   = db.prepare(sql + ` LIMIT ? OFFSET ?`).all(...args, perPage, offset);
  return { rows, total, page, per_page: perPage, pages: Math.ceil(total / perPage) };
}

module.exports = { requireAuth, requireRole, logActivity, paginate };
