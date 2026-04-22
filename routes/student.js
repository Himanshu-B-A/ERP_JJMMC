const express = require('express');
const db = require('../db');
const { requireRole } = require('./helpers');

const router = express.Router();
const only = requireRole('student');

// ── PROFILE ───────────────────────────────────────────────────────
router.get('/profile', only, (req, res) => {
  const uid = req.session.user.id;
  const row = db.prepare(`SELECT u.id,u.username,u.full_name,u.email,u.role,u.created_at,
    p.roll_no,p.university_reg_no,p.course,p.department,p.batch_id,p.mbbs_year,p.semester,p.admission_quota,p.neet_rank,
    p.dob,p.gender,p.phone,p.address,p.blood_group,p.aadhaar,p.parent_name,p.parent_phone,p.rfid_code,
    COALESCE(p.program_level,'UG') AS program_level, p.pg_specialty,
    b.name AS batch_name, b.code AS batch_code
    FROM users u
    LEFT JOIN student_profiles p ON p.user_id=u.id
    LEFT JOIN batches b ON b.id=p.batch_id
    WHERE u.id=?`).get(uid);
  res.json({ profile: row });
});
router.put('/profile', only, (req, res) => {
  const { phone, address } = req.body || {};
  db.prepare('UPDATE student_profiles SET phone=COALESCE(?,phone),address=COALESCE(?,address) WHERE user_id=?').run(phone||null,address||null,req.session.user.id);
  res.json({ ok: true });
});

// ── FEES ──────────────────────────────────────────────────────────
router.get('/fees', only, (req, res) => {
  const rows = db.prepare('SELECT * FROM fee_payments WHERE user_id=? ORDER BY paid_on DESC').all(req.session.user.id);
  const total = rows.reduce((s,r)=>s+r.amount,0);
  res.json({ payments: rows, total_paid: total });
});
router.post('/fees/pay', only, (req, res) => {
  const { fee_type, amount, gateway } = req.body || {};
  if (!fee_type || !amount) return res.status(400).json({ error: 'fee_type and amount required' });
  const ref = 'TXN-' + Math.floor(Math.random()*900000+100000);
  db.prepare(`INSERT INTO fee_payments (user_id,fee_type,amount,status,reference,gateway) VALUES (?,?,?,'PAID',?,?)`)
    .run(req.session.user.id,fee_type,Number(amount),ref,gateway||'online');
  res.json({ ok: true, reference: ref });
});

// ── ATTENDANCE ────────────────────────────────────────────────────
router.get('/attendance', only, (req, res) => {
  const uid = req.session.user.id;
  const summary = db.prepare(`SELECT course_code,
    COUNT(*) AS total,
    SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present,
    ROUND(100.0*SUM(CASE WHEN status='present' THEN 1 ELSE 0 END)/COUNT(*),1) AS percentage
    FROM attendance WHERE student_user_id=? GROUP BY course_code ORDER BY course_code`).all(uid);
  const recent = db.prepare('SELECT * FROM attendance WHERE student_user_id=? ORDER BY date DESC LIMIT 50').all(uid);
  res.json({ summary, recent });
});

// ── EXAM SCHEDULE ─────────────────────────────────────────────────
router.get('/exam-schedule', only, (req, res) => {
  const exams = db.prepare(`SELECT e.*,
    (SELECT marks_obtained FROM results WHERE student_user_id=? AND exam_id=e.id AND published=1) AS marks,
    (SELECT grade FROM results WHERE student_user_id=? AND exam_id=e.id AND published=1) AS grade
    FROM exam_schedules e ORDER BY e.exam_date`).all(req.session.user.id,req.session.user.id);
  res.json({ exams });
});

// ── RESULTS ───────────────────────────────────────────────────────
router.get('/results', only, (req, res) => {
  const rows = db.prepare(`SELECT r.*,e.title AS exam_title,e.total_marks,e.exam_date,e.course_code
    FROM results r JOIN exam_schedules e ON e.id=r.exam_id
    WHERE r.student_user_id=? AND r.published=1 ORDER BY e.exam_date DESC`).all(req.session.user.id);
  res.json({ results: rows });
});

// ── FEEDBACK ──────────────────────────────────────────────────────
router.get('/feedback', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM feedback WHERE user_id=? ORDER BY created_at DESC').all(req.session.user.id) });
});
router.post('/feedback', only, (req, res) => {
  const { subject, rating, comments } = req.body || {};
  if (!subject || !rating) return res.status(400).json({ error: 'subject and rating required' });
  db.prepare('INSERT INTO feedback (user_id,subject,rating,comments) VALUES (?,?,?,?)').run(req.session.user.id,subject,Number(rating),comments||'');
  res.json({ ok: true });
});

// ── LOG BOOK ──────────────────────────────────────────────────────
router.get('/logbook', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM log_book WHERE user_id=? ORDER BY entry_date DESC').all(req.session.user.id) });
});
router.post('/logbook', only, (req, res) => {
  const { entry_date, title, details } = req.body || {};
  if (!entry_date || !title) return res.status(400).json({ error: 'entry_date and title required' });
  db.prepare('INSERT INTO log_book (user_id,entry_date,title,details) VALUES (?,?,?,?)').run(req.session.user.id,entry_date,title,details||'');
  res.json({ ok: true });
});

// ── ELECTIVES ─────────────────────────────────────────────────────
router.get('/electives', only, (req, res) => {
  res.json({
    available: [
      {code:'CSE-E01',name:'Machine Learning'},
      {code:'CSE-E02',name:'Cloud Computing'},
      {code:'CSE-E03',name:'Cyber Security'},
      {code:'CSE-E04',name:'Blockchain'},
      {code:'CSE-E05',name:'Data Visualization'},
    ],
    registered: db.prepare('SELECT * FROM elective_registrations WHERE user_id=? ORDER BY created_at DESC').all(req.session.user.id),
  });
});
router.post('/electives', only, (req, res) => {
  const { course_code, course_name } = req.body || {};
  if (!course_code || !course_name) return res.status(400).json({ error: 'course required' });
  if (db.prepare('SELECT 1 FROM elective_registrations WHERE user_id=? AND course_code=?').get(req.session.user.id,course_code))
    return res.status(409).json({ error: 'Already registered' });
  db.prepare('INSERT INTO elective_registrations (user_id,course_code,course_name) VALUES (?,?,?)').run(req.session.user.id,course_code,course_name);
  res.json({ ok: true });
});

// ── REVALUATION ───────────────────────────────────────────────────
router.get('/revaluation', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM revaluation_applications WHERE user_id=? ORDER BY created_at DESC').all(req.session.user.id) });
});
router.post('/revaluation', only, (req, res) => {
  const { subject, exam_date, reason } = req.body || {};
  if (!subject) return res.status(400).json({ error: 'subject required' });
  db.prepare('INSERT INTO revaluation_applications (user_id,subject,exam_date,reason) VALUES (?,?,?,?)').run(req.session.user.id,subject,exam_date||'',reason||'');
  res.json({ ok: true });
});

// ── TIMETABLE ─────────────────────────────────────────────────────
router.get('/timetable', only, (req, res) => {
  const batch = db.prepare('SELECT batch_id FROM student_profiles WHERE user_id=?').get(req.session.user.id);
  if (!batch?.batch_id) return res.json({ items: [] });
  const rows = db.prepare(`SELECT t.*,u.full_name AS faculty_name FROM timetable t LEFT JOIN users u ON u.id=t.faculty_id WHERE t.batch_id=? ORDER BY t.day,t.period`).all(batch.batch_id);
  res.json({ items: rows });
});

// ── HOSTEL ────────────────────────────────────────────────────────
router.get('/hostel', only, (req, res) => {
  const allotment = db.prepare(`SELECT ha.*,hr.room_no,hr.block,hr.floor,hr.room_type,hr.monthly_fee
    FROM hostel_allotments ha JOIN hostel_rooms hr ON hr.id=ha.room_id
    WHERE ha.student_user_id=? AND ha.status='active'`).get(req.session.user.id);
  res.json({ allotment: allotment || null });
});

// ── TRANSPORT ─────────────────────────────────────────────────────
router.get('/transport', only, (req, res) => {
  const allotment = db.prepare(`SELECT ta.*,tr.route_no,tr.name AS route_name,tr.vehicle_no,tr.driver_name,tr.driver_phone,tr.stops,tr.monthly_fee
    FROM transport_allotments ta JOIN transport_routes tr ON tr.id=ta.route_id
    WHERE ta.student_user_id=? AND ta.status='active'`).get(req.session.user.id);
  res.json({ allotment: allotment || null });
});

// ── LIBRARY ───────────────────────────────────────────────────────
router.get('/library', only, (req, res) => {
  const issued = db.prepare(`SELECT i.*,b.title AS book_title,b.author,b.isbn FROM library_issues i
    JOIN library_books b ON b.id=i.book_id WHERE i.user_id=? ORDER BY i.issue_date DESC`).all(req.session.user.id);
  res.json({ issued });
});

// ── STUDY MATERIAL ────────────────────────────────────────────────
router.get('/study-materials', only, (req, res) => {
  const { course_code } = req.query;
  let sql=`SELECT id,title,description,course_code,file_name,file_type,file_size,created_at FROM study_materials WHERE 1=1`;
  const a=[];
  if (course_code) { sql+=' AND course_code=?'; a.push(course_code); }
  sql+=' ORDER BY created_at DESC';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.get('/study-materials/:id/download', only, (req, res) => {
  const mat = db.prepare('SELECT * FROM study_materials WHERE id=?').get(Number(req.params.id));
  if (!mat) return res.status(404).json({ error: 'not found' });
  if (!mat.file_data) return res.status(404).json({ error: 'No file data' });
  const buf = Buffer.from(mat.file_data, 'base64');
  res.set('Content-Type', mat.file_type || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${mat.file_name || 'file'}"`);
  res.send(buf);
});

// ── PLACEMENT ─────────────────────────────────────────────────────
router.get('/placement/drives', only, (req, res) => {
  const rows = db.prepare(`SELECT d.*,
    (SELECT status FROM placement_applications WHERE drive_id=d.id AND student_user_id=?) AS applied_status
    FROM placement_drives d WHERE d.status='open' ORDER BY d.drive_date`).all(req.session.user.id);
  res.json({ items: rows });
});
router.post('/placement/apply', only, (req, res) => {
  const { drive_id } = req.body || {};
  if (!drive_id) return res.status(400).json({ error: 'drive_id required' });
  try {
    db.prepare('INSERT INTO placement_applications (drive_id,student_user_id,status) VALUES (?,?,?)').run(Number(drive_id),req.session.user.id,'applied');
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'Already applied' }); }
});
router.get('/placement/applications', only, (req, res) => {
  const rows = db.prepare(`SELECT pa.*,pd.company,pd.role,pd.package_lpa,pd.drive_date FROM placement_applications pa
    JOIN placement_drives pd ON pd.id=pa.drive_id WHERE pa.student_user_id=? ORDER BY pa.applied_at DESC`).all(req.session.user.id);
  res.json({ items: rows });
});

// ── LMS ───────────────────────────────────────────────────────────
router.get('/lms/courses', only, (req, res) => {
  const rows = db.prepare(`SELECT c.*,u.full_name AS instructor_name,
    (SELECT COUNT(*) FROM lms_modules WHERE course_id=c.id) AS total_modules,
    (SELECT completed_modules FROM lms_enrollments WHERE user_id=? AND course_id=c.id) AS completed_modules
    FROM lms_courses c LEFT JOIN users u ON u.id=c.instructor_id
    WHERE c.status='published' ORDER BY c.title`).all(req.session.user.id);
  res.json({ items: rows });
});
router.post('/lms/enroll', only, (req, res) => {
  const { course_id } = req.body || {};
  if (!course_id) return res.status(400).json({ error: 'course_id required' });
  const total = db.prepare('SELECT COUNT(*) AS c FROM lms_modules WHERE course_id=?').get(Number(course_id)).c;
  try {
    db.prepare('INSERT INTO lms_enrollments (user_id,course_id,completed_modules) VALUES (?,?,0)').run(req.session.user.id,Number(course_id));
    res.json({ ok: true });
  } catch { res.status(409).json({ error: 'Already enrolled' }); }
});
router.get('/lms/courses/:id/modules', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM lms_modules WHERE course_id=? ORDER BY order_no').all(Number(req.params.id)) });
});

// ── ONLINE EXAMS ──────────────────────────────────────────────────
router.get('/online-exams', only, (req, res) => {
  const now = new Date().toISOString();
  const rows = db.prepare(`SELECT e.*,
    (SELECT status FROM online_exam_attempts WHERE exam_id=e.id AND user_id=?) AS attempt_status,
    (SELECT score FROM online_exam_attempts WHERE exam_id=e.id AND user_id=?) AS my_score
    FROM online_exams e WHERE e.status='published' ORDER BY e.start_time`).all(req.session.user.id,req.session.user.id);
  res.json({ items: rows });
});
router.get('/online-exams/:id', only, (req, res) => {
  const exam = db.prepare('SELECT * FROM online_exams WHERE id=?').get(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: 'not found' });
  const attempt = db.prepare('SELECT * FROM online_exam_attempts WHERE exam_id=? AND user_id=?').get(Number(req.params.id),req.session.user.id);
  if (attempt && attempt.status === 'submitted') return res.json({ exam, attempt, questions: [] });
  const questions = db.prepare('SELECT id,question,option_a,option_b,option_c,option_d,marks FROM online_exam_questions WHERE exam_id=? ORDER BY id').all(Number(req.params.id));
  if (!attempt) db.prepare("INSERT OR IGNORE INTO online_exam_attempts (exam_id,user_id,status) VALUES (?,?,'in-progress')").run(Number(req.params.id),req.session.user.id);
  res.json({ exam, questions, attempt });
});
router.post('/online-exams/:id/submit', only, (req, res) => {
  const { answers } = req.body || {};
  const exam = db.prepare('SELECT * FROM online_exams WHERE id=?').get(Number(req.params.id));
  if (!exam) return res.status(404).json({ error: 'not found' });
  const questions = db.prepare('SELECT * FROM online_exam_questions WHERE exam_id=?').all(Number(req.params.id));
  let score = 0;
  if (answers && questions.length) {
    const ans = typeof answers === 'string' ? JSON.parse(answers) : answers;
    for (const q of questions) {
      if (ans[q.id] && ans[q.id] === q.correct_option) score += q.marks;
    }
  }
  db.prepare(`UPDATE online_exam_attempts SET answers=?,score=?,status='submitted',submitted_at=CURRENT_TIMESTAMP WHERE exam_id=? AND user_id=?`)
    .run(JSON.stringify(answers||{}),score,Number(req.params.id),req.session.user.id);
  res.json({ ok: true, score, total: exam.total_marks });
});

// ── REMINDERS ─────────────────────────────────────────────────────
router.get('/reminders', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM reminders WHERE user_id=? AND is_done=0 ORDER BY remind_at').all(req.session.user.id) });
});
router.post('/reminders', only, (req, res) => {
  const { title, description, remind_at } = req.body || {};
  if (!title || !remind_at) return res.status(400).json({ error: 'title and remind_at required' });
  const info = db.prepare('INSERT INTO reminders (user_id,title,description,remind_at) VALUES (?,?,?,?)').run(req.session.user.id,title,description||null,remind_at);
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
router.put('/notifications/:id/read', only, (req, res) => {
  db.prepare('UPDATE user_notifications SET is_read=1,read_at=CURRENT_TIMESTAMP WHERE notification_id=? AND user_id=?').run(Number(req.params.id),req.session.user.id);
  res.json({ ok: true });
});

// ── BOOKMARKS ─────────────────────────────────────────────────────
router.get('/bookmarks', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM bookmarks WHERE user_id=? ORDER BY created_at DESC').all(req.session.user.id) });
});
router.post('/bookmarks', only, (req, res) => {
  const { title, url, notes } = req.body || {};
  if (!title || !url) return res.status(400).json({ error: 'title and url required' });
  const info = db.prepare('INSERT INTO bookmarks (user_id,title,url,notes) VALUES (?,?,?,?)').run(req.session.user.id,title,url,notes||null);
  res.json({ ok: true, id: info.lastInsertRowid });
});
router.delete('/bookmarks/:id', only, (req, res) => {
  db.prepare('DELETE FROM bookmarks WHERE id=? AND user_id=?').run(Number(req.params.id),req.session.user.id);
  res.json({ ok: true });
});

// ── CLINICAL POSTINGS (Medical) ───────────────────────────────────
router.get('/clinical-postings', only, (req, res) => {
  const uid = req.session.user.id;
  const prof = db.prepare('SELECT batch_id FROM student_profiles WHERE user_id=?').get(uid);
  const batch_id = prof?.batch_id || 0;
  const rows = db.prepare(`
    SELECT cp.*, d.name AS dept_full, sup.full_name AS supervisor_name
    FROM clinical_postings cp
    LEFT JOIN departments d ON d.id = cp.department_id
    LEFT JOIN users sup ON sup.id = cp.supervisor_id
    WHERE cp.student_user_id = ? OR cp.batch_id = ?
    ORDER BY cp.start_date DESC
  `).all(uid, batch_id);
  res.json({ items: rows });
});

// ── CASE LOGBOOK ──────────────────────────────────────────────────
router.get('/case-logs', only, (req, res) => {
  const uid = req.session.user.id;
  const rows = db.prepare(`
    SELECT cl.*, sup.full_name AS supervisor_name, v.full_name AS verifier_name
    FROM case_logs cl
    LEFT JOIN users sup ON sup.id = cl.supervisor_id
    LEFT JOIN users v   ON v.id   = cl.verified_by
    WHERE cl.student_user_id = ?
    ORDER BY cl.case_date DESC
  `).all(uid);
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) AS pending
    FROM case_logs WHERE student_user_id = ?
  `).get(uid);
  res.json({ items: rows, counts });
});

router.post('/case-logs', only, (req, res) => {
  const { case_date, patient_code, age, gender, department, ward,
          chief_complaint, diagnosis, management, learning_points, supervisor_id } = req.body || {};
  if (!case_date || !diagnosis)
    return res.status(400).json({ error: 'case_date and diagnosis required' });
  const info = db.prepare(`
    INSERT INTO case_logs (student_user_id,case_date,patient_code,age,gender,department,ward,chief_complaint,diagnosis,management,learning_points,supervisor_id,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending')
  `).run(
    req.session.user.id, case_date, patient_code || null,
    age ? Number(age) : null, gender || null,
    department || null, ward || null,
    chief_complaint || null, diagnosis,
    management || null, learning_points || null,
    supervisor_id ? Number(supervisor_id) : null
  );
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/case-logs/:id', only, (req, res) => {
  const { case_date, patient_code, age, gender, department, ward,
          chief_complaint, diagnosis, management, learning_points } = req.body || {};
  const existing = db.prepare('SELECT status,student_user_id FROM case_logs WHERE id=?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.student_user_id !== req.session.user.id) return res.status(403).json({ error: 'forbidden' });
  if (existing.status === 'verified') return res.status(400).json({ error: 'cannot edit verified entry' });
  db.prepare(`
    UPDATE case_logs SET case_date=?,patient_code=?,age=?,gender=?,department=?,ward=?,chief_complaint=?,diagnosis=?,management=?,learning_points=?
    WHERE id=? AND student_user_id=?
  `).run(case_date, patient_code||null, age?Number(age):null, gender||null, department||null,
         ward||null, chief_complaint||null, diagnosis, management||null, learning_points||null,
         Number(req.params.id), req.session.user.id);
  res.json({ ok: true });
});

router.delete('/case-logs/:id', only, (req, res) => {
  const existing = db.prepare('SELECT status,student_user_id FROM case_logs WHERE id=?').get(Number(req.params.id));
  if (!existing || existing.student_user_id !== req.session.user.id) return res.status(403).json({ error: 'forbidden' });
  if (existing.status === 'verified') return res.status(400).json({ error: 'cannot delete verified entry' });
  db.prepare('DELETE FROM case_logs WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ── PROCEDURE LOGBOOK ─────────────────────────────────────────────
router.get('/procedure-logs', only, (req, res) => {
  const uid = req.session.user.id;
  const rows = db.prepare(`
    SELECT pl.*, sup.full_name AS supervisor_name, v.full_name AS verifier_name
    FROM procedure_logs pl
    LEFT JOIN users sup ON sup.id = pl.supervisor_id
    LEFT JOIN users v   ON v.id   = pl.verified_by
    WHERE pl.student_user_id = ?
    ORDER BY pl.procedure_date DESC
  `).all(uid);
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN level='performed' THEN 1 ELSE 0 END) AS performed,
      SUM(CASE WHEN level='assisted'  THEN 1 ELSE 0 END) AS assisted,
      SUM(CASE WHEN level='observed'  THEN 1 ELSE 0 END) AS observed,
      SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified
    FROM procedure_logs WHERE student_user_id = ?
  `).get(uid);
  res.json({ items: rows, counts });
});

router.post('/procedure-logs', only, (req, res) => {
  const { procedure_date, procedure_name, department, patient_code, level, supervisor_id, remarks } = req.body || {};
  if (!procedure_date || !procedure_name)
    return res.status(400).json({ error: 'procedure_date and procedure_name required' });
  const info = db.prepare(`
    INSERT INTO procedure_logs (student_user_id,procedure_date,procedure_name,department,patient_code,level,supervisor_id,status,remarks)
    VALUES (?,?,?,?,?,?,?, 'pending', ?)
  `).run(
    req.session.user.id, procedure_date, procedure_name,
    department || null, patient_code || null,
    level || 'observed',
    supervisor_id ? Number(supervisor_id) : null,
    remarks || null
  );
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.delete('/procedure-logs/:id', only, (req, res) => {
  const existing = db.prepare('SELECT status,student_user_id FROM procedure_logs WHERE id=?').get(Number(req.params.id));
  if (!existing || existing.student_user_id !== req.session.user.id) return res.status(403).json({ error: 'forbidden' });
  if (existing.status === 'verified') return res.status(400).json({ error: 'cannot delete verified entry' });
  db.prepare('DELETE FROM procedure_logs WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

// Expose faculty list for supervisor picker
router.get('/supervisors', only, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.full_name, e.department, e.designation
    FROM users u LEFT JOIN employees e ON e.user_id = u.id
    WHERE u.role='faculty' AND u.is_active=1 ORDER BY u.full_name
  `).all();
  res.json({ items: rows });
});

// ── Allocations assigned to me or to a batch I'm in ──────────────
router.get('/allocations', only, (req, res) => {
  const uid = req.session.user.id;
  const { status, category } = req.query;
  let sql = `SELECT a.*,
      b.code AS batch_code, b.name AS batch_name,
      creator.full_name AS created_by_name
      FROM allocations a
      LEFT JOIN batches b ON b.id = CASE WHEN a.assignee_type='batch' THEN a.assignee_id ELSE a.batch_id END
      LEFT JOIN users creator ON creator.id=a.created_by
      WHERE (
        (a.assignee_type='student' AND a.assignee_id=?)
        OR (a.assignee_type='batch' AND a.assignee_id IN
            (SELECT batch_id FROM batch_students WHERE student_user_id=?))
      )`;
  const a = [uid, uid];
  if (status)   { sql += ' AND a.status=?';   a.push(status); }
  if (category) { sql += ' AND a.category=?'; a.push(category); }
  sql += ' ORDER BY a.priority DESC, COALESCE(a.due_date, a.created_at) DESC LIMIT 200';
  res.json({ items: db.prepare(sql).all(...a) });
});

router.put('/allocations/:id/status', only, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['pending','in-progress','completed','cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'invalid status' });
  const uid = req.session.user.id;
  const row = db.prepare(`SELECT * FROM allocations WHERE id=? AND (
      (assignee_type='student' AND assignee_id=?)
      OR (assignee_type='batch' AND assignee_id IN
          (SELECT batch_id FROM batch_students WHERE student_user_id=?))
    )`).get(Number(req.params.id), uid, uid);
  if (!row) return res.status(404).json({ error: 'allocation not found or not yours' });
  db.prepare('UPDATE allocations SET status=? WHERE id=?').run(status, Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
