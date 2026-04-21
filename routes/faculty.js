const express = require('express');
const db = require('../db');
const { requireRole, logActivity } = require('./helpers');

const router = express.Router();
const only = requireRole('faculty', 'admin');

// ── DASHBOARD ─────────────────────────────────────────────────────
router.get('/stats', only, (req, res) => {
  const fid = req.session.user.id;
  const todayStr = new Date().toISOString().split('T')[0];
  res.json({
    my_lectures_today:    db.prepare('SELECT COUNT(*) AS c FROM lectures WHERE faculty_id=? AND lecture_date=?').get(fid,todayStr).c,
    total_lectures:       db.prepare('SELECT COUNT(*) AS c FROM lectures WHERE faculty_id=?').get(fid).c,
    my_online_exams:      db.prepare("SELECT COUNT(*) AS c FROM online_exams WHERE created_by=? AND status='published'").get(fid).c,
    study_materials:      db.prepare('SELECT COUNT(*) AS c FROM study_materials WHERE uploaded_by=?').get(fid).c,
    pending_results:      db.prepare("SELECT COUNT(*) AS c FROM results r JOIN exam_schedules e ON e.id=r.exam_id WHERE e.created_by=? AND r.published=0").get(fid).c,
    my_lms_courses:       db.prepare("SELECT COUNT(*) AS c FROM lms_courses WHERE instructor_id=?").get(fid).c,
    pending_case_logs:    db.prepare("SELECT COUNT(*) AS c FROM case_logs WHERE status='pending' AND (supervisor_id=? OR supervisor_id IS NULL)").get(fid).c,
    pending_proc_logs:    db.prepare("SELECT COUNT(*) AS c FROM procedure_logs WHERE status='pending' AND (supervisor_id=? OR supervisor_id IS NULL)").get(fid).c,
    active_postings:      db.prepare("SELECT COUNT(*) AS c FROM clinical_postings WHERE supervisor_id=? AND status='ongoing'").get(fid).c,
    recent_notices:       db.prepare("SELECT * FROM notices WHERE audience IN ('all','faculty') ORDER BY created_at DESC LIMIT 5").all(),
  });
});

// ── ATTENDANCE (Mark/View) ────────────────────────────────────────
router.get('/attendance', only, (req, res) => {
  const { course_code, date } = req.query;
  if (!course_code || !date) return res.status(400).json({ error: 'course_code and date required' });
  const students = db.prepare(`SELECT u.id,u.full_name,p.roll_no,
    COALESCE((SELECT status FROM attendance WHERE student_user_id=u.id AND course_code=? AND date=?),'absent') AS status
    FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id
    WHERE u.role='student' AND u.is_active=1 ORDER BY p.roll_no`).all(course_code, date);
  res.json({ students, course_code, date });
});

router.post('/attendance', only, (req, res) => {
  const { course_code, date, records } = req.body || {};
  if (!course_code || !date || !Array.isArray(records))
    return res.status(400).json({ error: 'course_code, date and records[] required' });
  const upsert = db.prepare(`INSERT INTO attendance (student_user_id,course_code,date,status,marked_by)
    VALUES (?,?,?,?,?)
    ON CONFLICT(student_user_id,course_code,date) DO UPDATE SET status=excluded.status,marked_by=excluded.marked_by`);
  db.transaction((recs) => {
    for (const r of recs) upsert.run(r.student_user_id, course_code, date, r.status || 'present', req.session.user.id);
  })(records);
  logActivity(req.session.user.id,'MARK_ATTENDANCE','attendance',null,`${course_code} on ${date}`);
  res.json({ ok: true, count: records.length });
});

// ── ATTENDANCE REPORT ─────────────────────────────────────────────
router.get('/attendance/report', only, (req, res) => {
  const { course_code } = req.query;
  if (!course_code) return res.status(400).json({ error: 'course_code required' });
  const rows = db.prepare(`SELECT u.full_name,p.roll_no,
    COUNT(*) AS total,
    SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END) AS present,
    SUM(CASE WHEN a.status='absent'  THEN 1 ELSE 0 END) AS absent,
    ROUND(100.0*SUM(CASE WHEN a.status='present' THEN 1 ELSE 0 END)/COUNT(*),1) AS percentage
    FROM attendance a JOIN users u ON u.id=a.student_user_id
    LEFT JOIN student_profiles p ON p.user_id=u.id
    WHERE a.course_code=?
    GROUP BY a.student_user_id ORDER BY p.roll_no`).all(course_code);
  res.json({ items: rows, course_code });
});

// ── MY COURSES ────────────────────────────────────────────────────
router.get('/courses', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM courses ORDER BY code').all() });
});

// ── LECTURES ─────────────────────────────────────────────────────
router.get('/lectures', only, (req, res) => {
  const fid = req.session.user.id;
  const rows = db.prepare(`SELECT l.*,b.name AS batch_name FROM lectures l
    LEFT JOIN batches b ON b.id=l.batch_id
    WHERE l.faculty_id=? ORDER BY l.lecture_date DESC LIMIT 100`).all(fid);
  res.json({ items: rows });
});
router.post('/lectures', only, (req, res) => {
  const { title, course_code, batch_id, lecture_date, start_time, end_time, topic, description, recording_url, notes } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO lectures (title,course_code,faculty_id,batch_id,lecture_date,start_time,end_time,topic,description,recording_url,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(title,course_code||null,req.session.user.id,batch_id?Number(batch_id):null,lecture_date||null,start_time||null,end_time||null,topic||null,description||null,recording_url||null,notes||null);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete('/lectures/:id', only, (req, res) => {
  db.prepare('DELETE FROM lectures WHERE id=? AND faculty_id=?').run(Number(req.params.id),req.session.user.id);
  res.json({ ok: true });
});

// ── EXAM RESULTS (Enter Marks) ────────────────────────────────────
router.get('/exams', only, (req, res) => {
  const rows = db.prepare('SELECT * FROM exam_schedules WHERE created_by=? ORDER BY exam_date').all(req.session.user.id);
  res.json({ items: rows });
});
router.get('/exams/all', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM exam_schedules ORDER BY exam_date').all() });
});
router.get('/results/:exam_id', only, (req, res) => {
  const rows = db.prepare(`SELECT r.*,u.full_name,p.roll_no FROM results r
    JOIN users u ON u.id=r.student_user_id LEFT JOIN student_profiles p ON p.user_id=u.id
    WHERE r.exam_id=? ORDER BY p.roll_no`).all(Number(req.params.exam_id));
  const exam = db.prepare('SELECT * FROM exam_schedules WHERE id=?').get(Number(req.params.exam_id));
  const students = db.prepare(`SELECT u.id,u.full_name,p.roll_no FROM users u
    LEFT JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' AND u.is_active=1 ORDER BY p.roll_no`).all();
  res.json({ results: rows, exam, students });
});
router.post('/results', only, (req, res) => {
  const { student_user_id, exam_id, marks_obtained, grade, remarks } = req.body || {};
  if (!student_user_id || !exam_id) return res.status(400).json({ error: 'student_user_id and exam_id required' });
  const m = Number(marks_obtained) || 0;
  const exam = db.prepare('SELECT * FROM exam_schedules WHERE id=?').get(Number(exam_id));
  const pct = exam ? (m / exam.total_marks) * 100 : 0;
  const g = grade || (pct>=90?'A+':pct>=80?'A':pct>=70?'B+':pct>=60?'B':pct>=50?'C':pct>=40?'D':'F');
  db.prepare(`INSERT INTO results (student_user_id,exam_id,marks_obtained,grade,remarks,published)
    VALUES (?,?,?,?,?,0)
    ON CONFLICT(student_user_id,exam_id) DO UPDATE SET marks_obtained=excluded.marks_obtained,grade=excluded.grade,remarks=excluded.remarks`)
    .run(Number(student_user_id),Number(exam_id),m,g,remarks||null);
  res.json({ ok: true });
});
router.put('/results/:exam_id/publish', only, (req, res) => {
  db.prepare('UPDATE results SET published=1 WHERE exam_id=?').run(Number(req.params.exam_id));
  res.json({ ok: true });
});

// ── STUDY MATERIAL ────────────────────────────────────────────────
router.get('/study-materials', only, (req, res) => {
  const { course_code } = req.query;
  let sql = `SELECT id,title,description,course_code,file_name,file_type,file_size,uploaded_by,created_at FROM study_materials WHERE 1=1`;
  const a = [];
  if (course_code) { sql += ' AND course_code=?'; a.push(course_code); }
  sql += ' ORDER BY created_at DESC';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/study-materials', only, (req, res) => {
  const { title, description, course_code, file_name, file_type, file_data } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO study_materials (title,description,course_code,file_name,file_type,file_data,uploaded_by) VALUES (?,?,?,?,?,?,?)')
    .run(title,description||null,course_code||null,file_name||null,file_type||null,file_data||null,req.session.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete('/study-materials/:id', only, (req, res) => {
  db.prepare('DELETE FROM study_materials WHERE id=? AND uploaded_by=?').run(Number(req.params.id),req.session.user.id);
  res.json({ ok: true });
});

// ── ONLINE EXAMS ──────────────────────────────────────────────────
router.get('/online-exams', only, (req, res) => {
  const rows = db.prepare(`SELECT e.*,(SELECT COUNT(*) FROM online_exam_questions WHERE exam_id=e.id) AS question_count
    FROM online_exams e WHERE e.created_by=? ORDER BY e.created_at DESC`).all(req.session.user.id);
  res.json({ items: rows });
});
router.post('/online-exams', only, (req, res) => {
  const { title, course_code, duration_mins, total_marks, passing_marks, instructions, start_time, end_time } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO online_exams (title,course_code,duration_mins,total_marks,passing_marks,instructions,start_time,end_time,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(title,course_code||null,Number(duration_mins)||60,Number(total_marks)||50,Number(passing_marks)||20,instructions||null,start_time||null,end_time||null,'draft',req.session.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put('/online-exams/:id/publish', only, (req, res) => {
  db.prepare("UPDATE online_exams SET status='published' WHERE id=? AND created_by=?").run(Number(req.params.id),req.session.user.id);
  res.json({ ok: true });
});
router.get('/online-exams/:id/questions', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM online_exam_questions WHERE exam_id=? ORDER BY id').all(Number(req.params.id)) });
});
router.post('/online-exams/:id/questions', only, (req, res) => {
  const { question, option_a, option_b, option_c, option_d, correct_option, marks } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });
  const info = db.prepare('INSERT INTO online_exam_questions (exam_id,question,option_a,option_b,option_c,option_d,correct_option,marks) VALUES (?,?,?,?,?,?,?,?)')
    .run(Number(req.params.id),question,option_a||null,option_b||null,option_c||null,option_d||null,correct_option||null,Number(marks)||1);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ── LMS COURSES ───────────────────────────────────────────────────
router.get('/lms/courses', only, (req, res) => {
  const rows = db.prepare(`SELECT c.*,(SELECT COUNT(*) FROM lms_modules WHERE course_id=c.id) AS module_count
    FROM lms_courses c WHERE c.instructor_id=? ORDER BY c.created_at DESC`).all(req.session.user.id);
  res.json({ items: rows });
});
router.post('/lms/courses', only, (req, res) => {
  const { title, description, category, duration_hours } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO lms_courses (title,description,category,instructor_id,duration_hours,status) VALUES (?,?,?,?,?,?)')
    .run(title,description||null,category||null,req.session.user.id,Number(duration_hours)||0,'draft');
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put('/lms/courses/:id/publish', only, (req, res) => {
  db.prepare("UPDATE lms_courses SET status='published' WHERE id=?").run(Number(req.params.id));
  res.json({ ok: true });
});
router.get('/lms/courses/:id/modules', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM lms_modules WHERE course_id=? ORDER BY order_no').all(Number(req.params.id)) });
});
router.post('/lms/courses/:id/modules', only, (req, res) => {
  const { title, content, video_url, order_no } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO lms_modules (course_id,title,content,video_url,order_no) VALUES (?,?,?,?,?)')
    .run(Number(req.params.id),title,content||null,video_url||null,Number(order_no)||1);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ── DAILY REPORTS ─────────────────────────────────────────────────
router.get('/daily-reports', only, (req, res) => {
  const rows = db.prepare('SELECT * FROM daily_reports WHERE user_id=? ORDER BY report_date DESC LIMIT 30').all(req.session.user.id);
  res.json({ items: rows });
});
router.post('/daily-reports', only, (req, res) => {
  const { report_date, title, activities, challenges, plan_tomorrow } = req.body || {};
  if (!report_date || !title) return res.status(400).json({ error: 'report_date and title required' });
  try {
    db.prepare('INSERT INTO daily_reports (user_id,report_date,title,activities,challenges,plan_tomorrow) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,report_date) DO UPDATE SET title=excluded.title,activities=excluded.activities,challenges=excluded.challenges,plan_tomorrow=excluded.plan_tomorrow')
      .run(req.session.user.id,report_date,title,activities||null,challenges||null,plan_tomorrow||null);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// ── REMINDERS ─────────────────────────────────────────────────────
router.get('/reminders', only, (req, res) => {
  const rows = db.prepare('SELECT * FROM reminders WHERE user_id=? AND is_done=0 ORDER BY remind_at').all(req.session.user.id);
  res.json({ items: rows });
});
router.post('/reminders', only, (req, res) => {
  const { title, description, remind_at, repeat } = req.body || {};
  if (!title || !remind_at) return res.status(400).json({ error: 'title and remind_at required' });
  const info = db.prepare('INSERT INTO reminders (user_id,title,description,remind_at,repeat) VALUES (?,?,?,?,?)').run(req.session.user.id,title,description||null,remind_at,repeat||'none');
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.put('/reminders/:id/done', only, (req, res) => {
  db.prepare('UPDATE reminders SET is_done=1 WHERE id=? AND user_id=?').run(Number(req.params.id),req.session.user.id);
  res.json({ ok: true });
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────
router.get('/notifications', only, (req, res) => {
  const rows = db.prepare(`SELECT n.*,un.is_read FROM user_notifications un
    JOIN notifications n ON n.id=un.notification_id
    WHERE un.user_id=? ORDER BY n.sent_at DESC LIMIT 20`).all(req.session.user.id);
  res.json({ items: rows });
});

// ── BATCHES ───────────────────────────────────────────────────────
router.get('/batches', only, (req, res) => {
  res.json({ items: db.prepare('SELECT b.*,(SELECT COUNT(*) FROM batch_students WHERE batch_id=b.id) AS enrolled FROM batches b ORDER BY b.code').all() });
});

// ── TIMETABLE ─────────────────────────────────────────────────────
router.get('/timetable', only, (req, res) => {
  const { batch_id } = req.query;
  let sql=`SELECT t.*,u.full_name AS faculty_name FROM timetable t LEFT JOIN users u ON u.id=t.faculty_id WHERE 1=1`;
  const a=[];
  if (batch_id) { sql+=' AND t.batch_id=?'; a.push(Number(batch_id)); }
  sql+=' ORDER BY t.day,t.period';
  res.json({ items: db.prepare(sql).all(...a) });
});

// ── PROFILE ───────────────────────────────────────────────────────
router.get('/profile', only, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE user_id=?').get(req.session.user.id);
  const user = db.prepare('SELECT id,username,full_name,email,role,created_at FROM users WHERE id=?').get(req.session.user.id);
  res.json({ user, employee: emp });
});

// ── CLINICAL POSTINGS ─────────────────────────────────────────────
router.get('/clinical-postings', only, (req, res) => {
  const fid = req.session.user.id;
  const rows = db.prepare(`
    SELECT cp.*, d.name AS dept_full,
      b.name AS batch_name, b.code AS batch_code,
      u.full_name AS student_name, sp.roll_no
    FROM clinical_postings cp
    LEFT JOIN departments d ON d.id = cp.department_id
    LEFT JOIN batches b ON b.id = cp.batch_id
    LEFT JOIN users u ON u.id = cp.student_user_id
    LEFT JOIN student_profiles sp ON sp.user_id = cp.student_user_id
    WHERE cp.supervisor_id = ? OR cp.supervisor_id IS NULL
    ORDER BY cp.start_date DESC
  `).all(fid);
  res.json({ items: rows });
});

// ── CASE LOGBOOK — verify entries ─────────────────────────────────
router.get('/case-logs', only, (req, res) => {
  const fid = req.session.user.id;
  const { status, student_user_id } = req.query;
  let sql = `SELECT cl.*, s.full_name AS student_name, sp.roll_no
             FROM case_logs cl
             LEFT JOIN users s ON s.id = cl.student_user_id
             LEFT JOIN student_profiles sp ON sp.user_id = cl.student_user_id
             WHERE (cl.supervisor_id = ? OR cl.supervisor_id IS NULL OR cl.verified_by = ?)`;
  const a = [fid, fid];
  if (status) { sql += ' AND cl.status=?'; a.push(status); }
  if (student_user_id) { sql += ' AND cl.student_user_id=?'; a.push(Number(student_user_id)); }
  sql += ' ORDER BY cl.case_date DESC LIMIT 100';
  res.json({ items: db.prepare(sql).all(...a) });
});

router.put('/case-logs/:id/verify', only, (req, res) => {
  const { action, remarks } = req.body || {};   // action: 'verified' | 'rejected'
  const status = action === 'rejected' ? 'rejected' : 'verified';
  db.prepare(
    `UPDATE case_logs SET status=?, verified_by=?, verified_at=CURRENT_TIMESTAMP, remarks=COALESCE(?,remarks) WHERE id=?`
  ).run(status, req.session.user.id, remarks || null, Number(req.params.id));
  logActivity(req.session.user.id, status === 'verified' ? 'VERIFY' : 'REJECT', 'case_log', Number(req.params.id), remarks || null);
  res.json({ ok: true });
});

// ── PROCEDURE LOGBOOK — verify entries ────────────────────────────
router.get('/procedure-logs', only, (req, res) => {
  const fid = req.session.user.id;
  const { status, student_user_id } = req.query;
  let sql = `SELECT pl.*, s.full_name AS student_name, sp.roll_no
             FROM procedure_logs pl
             LEFT JOIN users s ON s.id = pl.student_user_id
             LEFT JOIN student_profiles sp ON sp.user_id = pl.student_user_id
             WHERE (pl.supervisor_id = ? OR pl.supervisor_id IS NULL OR pl.verified_by = ?)`;
  const a = [fid, fid];
  if (status) { sql += ' AND pl.status=?'; a.push(status); }
  if (student_user_id) { sql += ' AND pl.student_user_id=?'; a.push(Number(student_user_id)); }
  sql += ' ORDER BY pl.procedure_date DESC LIMIT 100';
  res.json({ items: db.prepare(sql).all(...a) });
});

router.put('/procedure-logs/:id/verify', only, (req, res) => {
  const { action, remarks } = req.body || {};
  const status = action === 'rejected' ? 'rejected' : 'verified';
  db.prepare(
    `UPDATE procedure_logs SET status=?, verified_by=?, verified_at=CURRENT_TIMESTAMP, remarks=COALESCE(?,remarks) WHERE id=?`
  ).run(status, req.session.user.id, remarks || null, Number(req.params.id));
  logActivity(req.session.user.id, status === 'verified' ? 'VERIFY' : 'REJECT', 'procedure_log', Number(req.params.id), remarks || null);
  res.json({ ok: true });
});

module.exports = router;
