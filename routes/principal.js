const express = require('express');
const db = require('../db');
const { requireRole } = require('./helpers');

const router = express.Router();
const only = requireRole('principal', 'admin');

// ── OVERVIEW (Principal home) ─────────────────────────────────────
router.get('/stats', only, (req, res) => {
  const roleCounts = db.prepare('SELECT role,COUNT(*) AS c FROM users GROUP BY role').all();
  const by = Object.fromEntries(roleCounts.map(r=>[r.role,r.c]));

  // UG / PG split (defensive — column may not exist yet on older DBs)
  let ugCount = 0, pgCount = 0;
  try {
    const ugPg = db.prepare(`SELECT COALESCE(program_level,'UG') AS lvl, COUNT(*) AS c
      FROM student_profiles GROUP BY lvl`).all();
    ugPg.forEach(r => { if (r.lvl === 'PG') pgCount = r.c; else ugCount += r.c; });
  } catch { ugCount = by.student || 0; }

  const byYear = db.prepare(`SELECT COALESCE(mbbs_year,0) AS year,COUNT(*) AS c
      FROM student_profiles GROUP BY year ORDER BY year`).all();
  const attnByYear = db.prepare(`SELECT COALESCE(sp.mbbs_year,0) AS year,
      COUNT(*) AS total,
      SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present
      FROM attendance a
      JOIN users u ON u.id=a.student_user_id
      LEFT JOIN student_profiles sp ON sp.user_id=u.id
      GROUP BY year ORDER BY year`).all();
  const passRate = db.prepare(`SELECT
      SUM(CASE WHEN grade IN ('F','FAIL') THEN 0 ELSE 1 END) AS pass,
      COUNT(*) AS total FROM results WHERE published=1`).get();
  const feeMonthly = db.prepare(`SELECT strftime('%Y-%m',paid_on) AS month,
      COALESCE(SUM(amount),0) AS total
      FROM fee_payments WHERE status='PAID'
      GROUP BY month ORDER BY month DESC LIMIT 6`).all();
  const lowAttn = db.prepare(`SELECT u.full_name,sp.roll_no,sp.mbbs_year,
      COUNT(*) AS total,
      SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
      ROUND(100.0*SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END)/COUNT(*),1) AS pct
      FROM attendance a
      JOIN users u ON u.id=a.student_user_id
      LEFT JOIN student_profiles sp ON sp.user_id=u.id
      GROUP BY a.student_user_id HAVING pct < 75 ORDER BY pct LIMIT 6`).all();

  res.json({
    totals: {
      students:      by.student  || 0,
      students_ug:   ugCount,
      students_pg:   pgCount,
      faculty:       by.faculty  || 0,
      parents:       by.parent   || 0,
      departments:   db.prepare('SELECT COUNT(*) AS c FROM departments').get().c,
      courses:       db.prepare('SELECT COUNT(*) AS c FROM courses').get().c,
      batches:       db.prepare('SELECT COUNT(*) AS c FROM batches').get().c,
      fees_collected: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE status='PAID'").get().s,
      pass_pct:      passRate && passRate.total ? Math.round((passRate.pass/passRate.total)*100) : 0,
    },
    by_year: byYear,
    attendance_by_year: attnByYear.map(r => ({
      year: r.year,
      total: r.total,
      pct: r.total ? Math.round(100*r.present/r.total) : 0,
    })),
    fee_monthly: feeMonthly,
    low_attendance: lowAttn,
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

// ── SUBJECTS ──────────────────────────────────────────────────────
router.get('/subjects', only, (req, res) => {
  const { year, department, q } = req.query;
  let sql = `SELECT c.*, d.name AS dept_name, d.category AS dept_category
             FROM courses c LEFT JOIN departments d ON d.name=c.department
             WHERE 1=1`;
  const a = [];
  if (year)       { sql += ` AND c.mbbs_year=?`; a.push(Number(year)); }
  if (department) { sql += ` AND c.department=?`; a.push(department); }
  if (q)          { sql += ` AND (c.name LIKE ? OR c.code LIKE ?)`; a.push(`%${q}%`,`%${q}%`); }
  sql += ` ORDER BY c.mbbs_year, c.department, c.code`;
  const items = db.prepare(sql).all(...a);
  const byYear = db.prepare(`SELECT COALESCE(mbbs_year,0) AS year,COUNT(*) AS c FROM courses GROUP BY year ORDER BY year`).all();
  const departments = db.prepare(`SELECT DISTINCT department FROM courses WHERE department IS NOT NULL ORDER BY department`).all();
  res.json({ items, by_year: byYear, departments: departments.map(d=>d.department) });
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

// ── MIS REPORTS ───────────────────────────────────────────────────
router.get('/reports', only, (req, res) => {
  const byDept = db.prepare(`SELECT p.department,COUNT(*) AS count FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' GROUP BY p.department`).all();
  const bySem  = db.prepare(`SELECT p.semester,COUNT(*) AS count FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' GROUP BY p.semester ORDER BY p.semester`).all();
  const feeMonthly = db.prepare(`SELECT strftime('%Y-%m',paid_on) AS month,COALESCE(SUM(amount),0) AS total FROM fee_payments WHERE status='PAID' GROUP BY month ORDER BY month`).all();
  const gradeStats = db.prepare(`SELECT grade,COUNT(*) AS count FROM results WHERE published=1 GROUP BY grade`).all();
  res.json({ enrollment_by_dept: byDept, enrollment_by_sem: bySem, fee_monthly: feeMonthly, grade_stats: gradeStats });
});

module.exports = router;
