const express = require('express');
const db = require('../db');
const { requireRole } = require('./helpers');

const router = express.Router();
const only = requireRole('principal', 'admin');

// ── DASHBOARD ─────────────────────────────────────────────────────
router.get('/stats', only, (req, res) => {
  const roleCounts = db.prepare('SELECT role,COUNT(*) AS c FROM users GROUP BY role').all();
  const by = Object.fromEntries(roleCounts.map(r=>[r.role,r.c]));
  res.json({
    totals: {
      students:     by.student  || 0,
      faculty:      by.faculty  || 0,
      departments:  db.prepare('SELECT COUNT(*) AS c FROM departments').get().c,
      courses:      db.prepare('SELECT COUNT(*) AS c FROM courses').get().c,
      fees_collected: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE status='PAID'").get().s,
      open_drives:  db.prepare("SELECT COUNT(*) AS c FROM placement_drives WHERE status='open'").get().c,
    },
    recent_results: db.prepare(`SELECT r.*,u.full_name,p.roll_no,e.title AS exam_title
      FROM results r JOIN users u ON u.id=r.student_user_id
      LEFT JOIN student_profiles p ON p.user_id=u.id
      JOIN exam_schedules e ON e.id=r.exam_id
      WHERE r.published=1 ORDER BY r.created_at DESC LIMIT 8`).all(),
    department_stats: db.prepare(`SELECT p.department,COUNT(*) AS students
      FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' GROUP BY p.department`).all(),
    notices: db.prepare("SELECT * FROM notices WHERE audience IN ('all','principal') ORDER BY created_at DESC LIMIT 5").all(),
  });
});

// ── STUDENTS ──────────────────────────────────────────────────────
router.get('/students', only, (req, res) => {
  const { dept, q } = req.query;
  let sql=`SELECT u.id,u.full_name,u.email,p.roll_no,p.department,p.semester,p.phone FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student'`;
  const a=[];
  if (dept) { sql+=' AND p.department=?'; a.push(dept); }
  if (q)    { sql+=' AND (u.full_name LIKE ? OR p.roll_no LIKE ?)'; a.push(`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY p.roll_no LIMIT 100';
  res.json({ items: db.prepare(sql).all(...a) });
});

// ── FACULTY ───────────────────────────────────────────────────────
router.get('/faculty', only, (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.full_name,u.email,e.emp_code,e.department,e.designation
    FROM users u LEFT JOIN employees e ON e.user_id=u.id WHERE u.role='faculty' ORDER BY u.full_name`).all();
  res.json({ items: rows });
});

// ── ATTENDANCE OVERVIEW ───────────────────────────────────────────
router.get('/attendance', only, (req, res) => {
  const byCourse = db.prepare(`SELECT course_code,COUNT(*) AS total,
    SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present,
    ROUND(100.0*SUM(CASE WHEN status='present' THEN 1 ELSE 0 END)/COUNT(*),1) AS rate
    FROM attendance GROUP BY course_code ORDER BY course_code`).all();
  const low = db.prepare(`SELECT u.full_name,p.roll_no,p.department,
    COUNT(*) AS total,SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
    ROUND(100.0*SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END)/COUNT(*),1) AS pct
    FROM attendance a JOIN users u ON u.id=a.student_user_id LEFT JOIN student_profiles p ON p.user_id=u.id
    GROUP BY a.student_user_id HAVING pct < 75 ORDER BY pct`).all();
  res.json({ by_course: byCourse, low_attendance: low });
});

// ── RESULTS OVERVIEW ─────────────────────────────────────────────
router.get('/results', only, (req, res) => {
  const { exam_id } = req.query;
  let sql=`SELECT r.*,u.full_name,p.roll_no,e.title AS exam_title,e.total_marks FROM results r
    JOIN users u ON u.id=r.student_user_id LEFT JOIN student_profiles p ON p.user_id=u.id
    JOIN exam_schedules e ON e.id=r.exam_id WHERE r.published=1`;
  const a=[];
  if (exam_id) { sql+=' AND r.exam_id=?'; a.push(Number(exam_id)); }
  sql+=' ORDER BY e.exam_date DESC,p.roll_no LIMIT 200';
  const exams = db.prepare('SELECT * FROM exam_schedules ORDER BY exam_date').all();
  res.json({ results: db.prepare(sql).all(...a), exams });
});

// ── NOTICES ───────────────────────────────────────────────────────
router.get('/notices', only, (req, res) => {
  res.json({ items: db.prepare(`SELECT n.*,u.username AS by_user FROM notices n LEFT JOIN users u ON u.id=n.created_by ORDER BY n.created_at DESC LIMIT 50`).all() });
});
router.post('/notices', only, (req, res) => {
  const { title, body, audience } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });
  const aud = ['all','principal','faculty','student','parent'].includes(audience)?audience:'all';
  const info = db.prepare('INSERT INTO notices (title,body,audience,created_by) VALUES (?,?,?,?)').run(title,body,aud,req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid });
});

// ── FEES OVERVIEW ─────────────────────────────────────────────────
router.get('/fees', only, (req, res) => {
  const total = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE status='PAID'").get().s;
  const byType = db.prepare(`SELECT fee_type,COALESCE(SUM(amount),0) AS total FROM fee_payments GROUP BY fee_type`).all();
  const recent = db.prepare(`SELECT f.*,u.full_name,p.roll_no FROM fee_payments f JOIN users u ON u.id=f.user_id LEFT JOIN student_profiles p ON p.user_id=u.id ORDER BY f.paid_on DESC LIMIT 20`).all();
  res.json({ total_paid: total, by_type: byType, recent });
});

// ── PLACEMENT OVERVIEW ────────────────────────────────────────────
router.get('/placement', only, (req, res) => {
  const drives = db.prepare(`SELECT d.*,(SELECT COUNT(*) FROM placement_applications WHERE drive_id=d.id) AS applications FROM placement_drives d ORDER BY d.drive_date DESC`).all();
  const placed = db.prepare("SELECT COUNT(DISTINCT student_user_id) AS c FROM placement_applications WHERE status='selected'").get().c;
  res.json({ drives, total_placed: placed });
});

// ── MIS REPORTS ───────────────────────────────────────────────────
router.get('/reports', only, (req, res) => {
  const byDept = db.prepare(`SELECT p.department,COUNT(*) AS count FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' GROUP BY p.department`).all();
  const bySem  = db.prepare(`SELECT p.semester,COUNT(*) AS count FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' GROUP BY p.semester ORDER BY p.semester`).all();
  const feeMonthly = db.prepare(`SELECT strftime('%Y-%m',paid_on) AS month,COALESCE(SUM(amount),0) AS total FROM fee_payments WHERE status='PAID' GROUP BY month ORDER BY month`).all();
  const gradeStats = db.prepare(`SELECT grade,COUNT(*) AS count FROM results WHERE published=1 GROUP BY grade`).all();
  res.json({ enrollment_by_dept: byDept, enrollment_by_sem: bySem, fee_monthly: feeMonthly, grade_stats: gradeStats });
});

module.exports = router;
