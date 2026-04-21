const express = require('express');
const db = require('../db');
const { requireRole } = require('./helpers');

const router = express.Router();
const only = requireRole('parent');

function getWardId(parentUserId) {
  const link = db.prepare('SELECT student_user_id FROM parents WHERE user_id=?').get(parentUserId);
  return link?.student_user_id || null;
}

// ── DASHBOARD ─────────────────────────────────────────────────────
router.get('/dashboard', only, (req, res) => {
  const wardId = getWardId(req.session.user.id);
  if (!wardId) return res.status(404).json({ error: 'No student linked to this parent account' });

  const ward = db.prepare(`SELECT u.full_name,u.email,p.roll_no,p.department,p.semester,p.phone
    FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id WHERE u.id=?`).get(wardId);
  const totalFees = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE user_id=? AND status='PAID'").get(wardId).s;
  const attSummary = db.prepare(`SELECT course_code,COUNT(*) AS total,
    SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present FROM attendance WHERE student_user_id=? GROUP BY course_code`).all(wardId);
  const notices = db.prepare(`SELECT * FROM notices WHERE audience IN ('all','parent') ORDER BY created_at DESC LIMIT 5`).all();
  res.json({ ward, total_fees_paid: totalFees, attendance: attSummary, notices });
});

// ── WARD ATTENDANCE ───────────────────────────────────────────────
router.get('/attendance', only, (req, res) => {
  const wardId = getWardId(req.session.user.id);
  if (!wardId) return res.status(404).json({ error: 'No linked student' });
  const summary = db.prepare(`SELECT course_code,COUNT(*) AS total,
    SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present,
    ROUND(100.0*SUM(CASE WHEN status='present' THEN 1 ELSE 0 END)/COUNT(*),1) AS percentage
    FROM attendance WHERE student_user_id=? GROUP BY course_code`).all(wardId);
  const recent = db.prepare('SELECT * FROM attendance WHERE student_user_id=? ORDER BY date DESC LIMIT 30').all(wardId);
  res.json({ summary, recent });
});

// ── WARD FEES ─────────────────────────────────────────────────────
router.get('/fees', only, (req, res) => {
  const wardId = getWardId(req.session.user.id);
  if (!wardId) return res.status(404).json({ error: 'No linked student' });
  const payments = db.prepare('SELECT * FROM fee_payments WHERE user_id=? ORDER BY paid_on DESC').all(wardId);
  const total = payments.reduce((s,r)=>s+r.amount,0);
  res.json({ payments, total_paid: total });
});

// ── WARD RESULTS ──────────────────────────────────────────────────
router.get('/results', only, (req, res) => {
  const wardId = getWardId(req.session.user.id);
  if (!wardId) return res.status(404).json({ error: 'No linked student' });
  const rows = db.prepare(`SELECT r.*,e.title AS exam_title,e.total_marks,e.exam_date FROM results r
    JOIN exam_schedules e ON e.id=r.exam_id WHERE r.student_user_id=? AND r.published=1 ORDER BY e.exam_date DESC`).all(wardId);
  res.json({ results: rows });
});

// ── NOTICES ───────────────────────────────────────────────────────
router.get('/notices', only, (req, res) => {
  const rows = db.prepare(`SELECT * FROM notices WHERE audience IN ('all','parent','student') ORDER BY created_at DESC LIMIT 20`).all();
  res.json({ items: rows });
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────
router.get('/notifications', only, (req, res) => {
  const rows = db.prepare(`SELECT n.*,un.is_read FROM user_notifications un
    JOIN notifications n ON n.id=un.notification_id
    WHERE un.user_id=? ORDER BY n.sent_at DESC LIMIT 20`).all(req.session.user.id);
  res.json({ items: rows });
});
router.put('/notifications/:id/read', only, (req, res) => {
  db.prepare('UPDATE user_notifications SET is_read=1,read_at=CURRENT_TIMESTAMP WHERE notification_id=? AND user_id=?').run(Number(req.params.id),req.session.user.id);
  res.json({ ok: true });
});

// ── WARD PROFILE ──────────────────────────────────────────────────
router.get('/ward', only, (req, res) => {
  const wardId = getWardId(req.session.user.id);
  if (!wardId) return res.status(404).json({ error: 'No linked student' });
  const row = db.prepare(`SELECT u.full_name,u.email,p.*
    FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id WHERE u.id=?`).get(wardId);
  res.json({ ward: row });
});

module.exports = router;
