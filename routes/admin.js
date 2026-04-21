const express  = require('express');
const bcrypt   = require('bcryptjs');
const db       = require('../db');
const { requireRole, logActivity } = require('./helpers');

const router = express.Router();
const only   = requireRole('admin');

// ═══════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════════════════════════════
router.get('/stats', only, (req, res) => {
  const roleCounts = db.prepare('SELECT role, COUNT(*) AS c FROM users GROUP BY role').all();
  const by = Object.fromEntries(roleCounts.map(r => [r.role, r.c]));
  res.json({
    totals: {
      users:         db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
      students:      by.student   || 0,
      faculty:       by.faculty   || 0,
      principals:    by.principal || 0,
      admins:        by.admin     || 0,
      parents:       by.parent    || 0,
      departments:   db.prepare('SELECT COUNT(*) AS c FROM departments').get().c,
      courses:       db.prepare('SELECT COUNT(*) AS c FROM courses').get().c,
      batches:       db.prepare('SELECT COUNT(*) AS c FROM batches').get().c,
      enquiries:     db.prepare("SELECT COUNT(*) AS c FROM enquiries WHERE status != 'converted'").get().c,
      fees_paid:     db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE status='PAID'").get().s,
      total_income:  db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='income'").get().s,
      total_expense: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='expense'").get().s,
      library_books: db.prepare('SELECT COUNT(*) AS c FROM library_books').get().c,
      assets:        db.prepare('SELECT COUNT(*) AS c FROM assets').get().c,
      open_drives:   db.prepare("SELECT COUNT(*) AS c FROM placement_drives WHERE status='open'").get().c,
    },
    recentUsers: db.prepare('SELECT id,username,role,full_name,email,created_at FROM users ORDER BY created_at DESC LIMIT 6').all(),
    recentLogs:  db.prepare('SELECT l.*,u.full_name FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 8').all(),
  });
});

// ═══════════════════════════════════════════════════════════════════
// USERS CRUD
// ═══════════════════════════════════════════════════════════════════
router.get('/users', only, (req, res) => {
  const { role, q, page = 1, per = 20 } = req.query;
  let sql  = `SELECT id,username,role,full_name,email,is_active,last_login,created_at FROM users WHERE 1=1`;
  const a  = [];
  if (role) { sql += ` AND role=?`;  a.push(role); }
  if (q)    { sql += ` AND (username LIKE ? OR full_name LIKE ? OR email LIKE ?)`; a.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  const total = db.prepare(sql.replace('SELECT id,username,role,full_name,email,is_active,last_login,created_at','SELECT COUNT(*) AS c')).get(...a).c;
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const per_page = Number(per); const offset = (Number(page)-1)*per_page;
  res.json({ users: db.prepare(sql).all(...a, per_page, offset), total, page: Number(page), per_page });
});

router.post('/users', only, (req, res) => {
  const { username, password, role, full_name, email } = req.body || {};
  if (!username || !password || !role || !full_name)
    return res.status(400).json({ error: 'username, password, role, full_name required' });
  const validRoles = ['admin','principal','faculty','student','parent'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username))
    return res.status(409).json({ error: 'username already exists' });
  const info = db.prepare(
    `INSERT INTO users (username,password_hash,role,full_name,email) VALUES (?,?,?,?,?)`
  ).run(username, bcrypt.hashSync(password,10), role, full_name, email||null);
  logActivity(req.session.user.id,'CREATE_USER','users',info.lastInsertRowid,`Created ${role}: ${username}`);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/users/:id', only, (req, res) => {
  const id = Number(req.params.id);
  const { full_name, email, role, password, is_active } = req.body || {};
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(id))
    return res.status(404).json({ error: 'user not found' });
  const fields = []; const args = [];
  if (full_name  !== undefined) { fields.push('full_name=?');     args.push(full_name); }
  if (email      !== undefined) { fields.push('email=?');         args.push(email); }
  if (role       !== undefined) { fields.push('role=?');          args.push(role); }
  if (is_active  !== undefined) { fields.push('is_active=?');     args.push(Number(is_active)); }
  if (password)                 { fields.push('password_hash=?'); args.push(bcrypt.hashSync(password,10)); }
  if (fields.length) { args.push(id); db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).run(...args); }
  logActivity(req.session.user.id,'UPDATE_USER','users',id,`Updated user ${id}`);
  res.json({ ok: true });
});

router.delete('/users/:id', only, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.session.user.id) return res.status(400).json({ error: 'Cannot delete own account' });
  const info = db.prepare('DELETE FROM users WHERE id=?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  logActivity(req.session.user.id,'DELETE_USER','users',id,`Deleted user ${id}`);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// STUDENT PROFILES
// ═══════════════════════════════════════════════════════════════════
router.get('/students', only, (req, res) => {
  const { dept, q, page=1, per=20 } = req.query;
  let sql = `SELECT u.id,u.username,u.full_name,u.email,u.is_active,
    p.roll_no,p.department,p.semester,p.phone,p.rfid_code
    FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id
    WHERE u.role='student'`;
  const a=[];
  if (dept) { sql+=' AND p.department=?'; a.push(dept); }
  if (q)    { sql+=' AND (u.full_name LIKE ? OR p.roll_no LIKE ? OR u.email LIKE ?)'; a.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  const total = db.prepare(sql.replace(/SELECT.*FROM users/s,'SELECT COUNT(*) AS c FROM users')).get(...a).c;
  sql+=' ORDER BY p.roll_no LIMIT ? OFFSET ?';
  res.json({ students: db.prepare(sql).all(...a,Number(per),(Number(page)-1)*Number(per)), total });
});

router.put('/students/:id/profile', only, (req, res) => {
  const { roll_no, department, semester, dob, phone, address, blood_group, parent_name, parent_phone, rfid_code } = req.body||{};
  db.prepare(`INSERT INTO student_profiles (user_id,roll_no,department,semester,dob,phone,address,blood_group,parent_name,parent_phone,rfid_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET roll_no=excluded.roll_no,department=excluded.department,
    semester=excluded.semester,dob=excluded.dob,phone=excluded.phone,address=excluded.address,
    blood_group=excluded.blood_group,parent_name=excluded.parent_name,parent_phone=excluded.parent_phone,rfid_code=excluded.rfid_code`
  ).run(Number(req.params.id),roll_no||null,department||null,semester?Number(semester):null,dob||null,phone||null,address||null,blood_group||null,parent_name||null,parent_phone||null,rfid_code||null);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════
router.get('/departments', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM departments ORDER BY code').all() });
});
router.post('/departments', only, (req, res) => {
  const { code, name, hod } = req.body||{};
  if (!code||!name) return res.status(400).json({ error: 'code and name required' });
  try {
    const info = db.prepare('INSERT INTO departments (code,name,hod) VALUES (?,?,?)').run(code,name,hod||null);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'code already exists' }); }
});
router.put('/departments/:id', only, (req, res) => {
  const { code, name, hod } = req.body||{};
  db.prepare('UPDATE departments SET code=COALESCE(?,code),name=COALESCE(?,name),hod=COALESCE(?,hod) WHERE id=?')
    .run(code||null,name||null,hod||null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/departments/:id', only, (req, res) => {
  const info = db.prepare('DELETE FROM departments WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// COURSES
// ═══════════════════════════════════════════════════════════════════
router.get('/courses', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM courses ORDER BY department,semester,code').all() });
});
router.post('/courses', only, (req, res) => {
  const { code, name, department, semester, credits } = req.body||{};
  if (!code||!name) return res.status(400).json({ error: 'code and name required' });
  try {
    const info = db.prepare('INSERT INTO courses (code,name,department,semester,credits) VALUES (?,?,?,?,?)')
      .run(code,name,department||null,semester?Number(semester):null,credits?Number(credits):3);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'code already exists' }); }
});
router.put('/courses/:id', only, (req, res) => {
  const { code, name, department, semester, credits } = req.body||{};
  db.prepare('UPDATE courses SET code=COALESCE(?,code),name=COALESCE(?,name),department=COALESCE(?,department),semester=COALESCE(?,semester),credits=COALESCE(?,credits) WHERE id=?')
    .run(code||null,name||null,department||null,semester?Number(semester):null,credits?Number(credits):null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/courses/:id', only, (req, res) => {
  const info = db.prepare('DELETE FROM courses WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// BATCHES
// ═══════════════════════════════════════════════════════════════════
router.get('/batches', only, (req, res) => {
  const batches = db.prepare('SELECT b.*,(SELECT COUNT(*) FROM batch_students WHERE batch_id=b.id) AS enrolled FROM batches b ORDER BY b.code').all();
  res.json({ items: batches });
});
router.post('/batches', only, (req, res) => {
  const { code, name, department, academic_year, semester, start_date, end_date, capacity } = req.body||{};
  if (!code||!name) return res.status(400).json({ error: 'code and name required' });
  try {
    const info = db.prepare('INSERT INTO batches (code,name,department,academic_year,semester,start_date,end_date,capacity) VALUES (?,?,?,?,?,?,?,?)')
      .run(code,name,department||null,academic_year||null,semester?Number(semester):null,start_date||null,end_date||null,capacity?Number(capacity):60);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'code already exists' }); }
});
router.delete('/batches/:id', only, (req, res) => {
  const info = db.prepare('DELETE FROM batches WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok:true });
});
router.get('/batches/:id/students', only, (req, res) => {
  const rows = db.prepare(`SELECT u.id,u.full_name,u.username,p.roll_no,p.department,bs.enrolled_on
    FROM batch_students bs JOIN users u ON u.id=bs.student_user_id
    LEFT JOIN student_profiles p ON p.user_id=u.id
    WHERE bs.batch_id=? ORDER BY p.roll_no`).all(Number(req.params.id));
  res.json({ items: rows });
});
router.post('/batches/:id/students', only, (req, res) => {
  const { student_user_id } = req.body||{};
  if (!student_user_id) return res.status(400).json({ error: 'student_user_id required' });
  try {
    db.prepare('INSERT INTO batch_students (batch_id,student_user_id) VALUES (?,?)').run(Number(req.params.id),Number(student_user_id));
    res.json({ ok:true });
  } catch { res.status(409).json({ error: 'already enrolled' }); }
});
router.delete('/batches/:id/students/:sid', only, (req, res) => {
  db.prepare('DELETE FROM batch_students WHERE batch_id=? AND student_user_id=?').run(Number(req.params.id),Number(req.params.sid));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// NOTICES
// ═══════════════════════════════════════════════════════════════════
router.get('/notices', only, (req, res) => {
  const rows = db.prepare(`SELECT n.*,u.username AS by_user FROM notices n LEFT JOIN users u ON u.id=n.created_by ORDER BY n.created_at DESC`).all();
  res.json({ items: rows });
});
router.post('/notices', only, (req, res) => {
  const { title, body, audience } = req.body||{};
  if (!title||!body) return res.status(400).json({ error: 'title and body required' });
  const aud = ['all','admin','principal','faculty','student','parent'].includes(audience)?audience:'all';
  const info = db.prepare('INSERT INTO notices (title,body,audience,created_by) VALUES (?,?,?,?)').run(title,body,aud,req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/notices/:id', only, (req, res) => {
  const info = db.prepare('DELETE FROM notices WHERE id=?').run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// FEES
// ═══════════════════════════════════════════════════════════════════
router.get('/fees', only, (req, res) => {
  const rows = db.prepare(`SELECT f.*,u.username,u.full_name FROM fee_payments f JOIN users u ON u.id=f.user_id ORDER BY f.paid_on DESC LIMIT 200`).all();
  const total = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM fee_payments WHERE status='PAID'").get().s;
  const byType = db.prepare(`SELECT fee_type,COUNT(*) AS count,COALESCE(SUM(amount),0) AS total FROM fee_payments WHERE status='PAID' GROUP BY fee_type ORDER BY total DESC`).all();
  res.json({ payments: rows, total_paid: total, by_type: byType });
});
router.get('/fee-structures', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM fee_structures ORDER BY department,semester').all() });
});
router.post('/fee-structures', only, (req, res) => {
  const { name, department, semester, academic_year, tuition_fee, hostel_fee, transport_fee, library_fee, lab_fee, other_fee } = req.body||{};
  if (!name) return res.status(400).json({ error: 'name required' });
  const t=Number(tuition_fee)||0, h=Number(hostel_fee)||0, tr=Number(transport_fee)||0,
        l=Number(library_fee)||0, lb=Number(lab_fee)||0, o=Number(other_fee)||0;
  const info = db.prepare(`INSERT INTO fee_structures (name,department,semester,academic_year,tuition_fee,hostel_fee,transport_fee,library_fee,lab_fee,other_fee,total_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(name,department||null,semester?Number(semester):null,academic_year||null,t,h,tr,l,lb,o,t+h+tr+l+lb+o);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/fee-structures/:id', only, (req, res) => {
  db.prepare('DELETE FROM fee_structures WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// INCOME & EXPENSES
// ═══════════════════════════════════════════════════════════════════
router.get('/transactions', only, (req, res) => {
  const { type, from, to } = req.query;
  let sql = `SELECT t.*,u.full_name AS created_by_name FROM transactions t LEFT JOIN users u ON u.id=t.created_by WHERE 1=1`;
  const a=[];
  if (type) { sql+=' AND t.type=?'; a.push(type); }
  if (from) { sql+=' AND t.transaction_date>=?'; a.push(from); }
  if (to)   { sql+=' AND t.transaction_date<=?'; a.push(to); }
  sql+=' ORDER BY t.transaction_date DESC LIMIT 200';
  const summary = {
    income:  db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='income'").get().s,
    expense: db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='expense'").get().s,
  };
  summary.balance = summary.income - summary.expense;
  res.json({ items: db.prepare(sql).all(...a), summary });
});
router.post('/transactions', only, (req, res) => {
  const { type, category, amount, description, reference, transaction_date } = req.body||{};
  if (!type||!category||!amount||!transaction_date) return res.status(400).json({ error: 'type,category,amount,date required' });
  const info = db.prepare('INSERT INTO transactions (type,category,amount,description,reference,transaction_date,created_by) VALUES (?,?,?,?,?,?,?)')
    .run(type,category,Number(amount),description||null,reference||null,transaction_date,req.session.user.id);
  logActivity(req.session.user.id,'CREATE_TRANSACTION','transactions',info.lastInsertRowid,`${type}: ${category} ₹${amount}`);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/transactions/:id', only, (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// HRM & PAYROLL
// ═══════════════════════════════════════════════════════════════════
router.get('/employees', only, (req, res) => {
  const rows = db.prepare(`SELECT e.*,u.full_name,u.email,u.username,u.role FROM employees e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.emp_code`).all();
  res.json({ items: rows });
});
router.post('/employees', only, (req, res) => {
  const { user_id, emp_code, department, designation, join_date, salary, bank_account, pan, phone, address } = req.body||{};
  if (!emp_code) return res.status(400).json({ error: 'emp_code required' });
  try {
    const info = db.prepare('INSERT INTO employees (user_id,emp_code,department,designation,join_date,salary,bank_account,pan,phone,address) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(user_id?Number(user_id):null,emp_code,department||null,designation||null,join_date||null,Number(salary)||0,bank_account||null,pan||null,phone||null,address||null);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'emp_code already exists' }); }
});
router.put('/employees/:id', only, (req, res) => {
  const { designation, department, salary, bank_account, phone, address } = req.body||{};
  db.prepare('UPDATE employees SET designation=COALESCE(?,designation),department=COALESCE(?,department),salary=COALESCE(?,salary),bank_account=COALESCE(?,bank_account),phone=COALESCE(?,phone),address=COALESCE(?,address) WHERE id=?')
    .run(designation||null,department||null,salary?Number(salary):null,bank_account||null,phone||null,address||null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/employees/:id', only, (req, res) => {
  db.prepare('DELETE FROM employees WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/payroll', only, (req, res) => {
  const { month } = req.query;
  let sql = `SELECT p.*,e.emp_code,e.designation,u.full_name FROM payroll p JOIN employees e ON e.id=p.employee_id LEFT JOIN users u ON u.id=e.user_id WHERE 1=1`;
  const a=[];
  if (month) { sql+=' AND p.month=?'; a.push(month); }
  sql+=' ORDER BY p.month DESC,e.emp_code';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/payroll', only, (req, res) => {
  const { employee_id, month, basic, hra, da, other_allowances, pf_deduction, tax_deduction, other_deductions } = req.body||{};
  if (!employee_id||!month) return res.status(400).json({ error: 'employee_id and month required' });
  const b=Number(basic)||0, h=Number(hra)||0, d=Number(da)||0, oa=Number(other_allowances)||0;
  const pf=Number(pf_deduction)||0, tx=Number(tax_deduction)||0, od=Number(other_deductions)||0;
  const net = b+h+d+oa-pf-tx-od;
  try {
    const info = db.prepare('INSERT INTO payroll (employee_id,month,basic,hra,da,other_allowances,pf_deduction,tax_deduction,other_deductions,net_salary,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(Number(employee_id),month,b,h,d,oa,pf,tx,od,net,'processed');
    res.json({ ok:true, id: info.lastInsertRowid, net_salary: net });
  } catch { res.status(409).json({ error: 'Payroll already generated for this month' }); }
});
router.put('/payroll/:id/status', only, (req, res) => {
  const { status } = req.body||{};
  db.prepare('UPDATE payroll SET status=? WHERE id=?').run(status,Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════════════
router.get('/attendance', only, (req, res) => {
  const { course_code, date, student_id } = req.query;
  let sql = `SELECT a.*,u.full_name,p.roll_no FROM attendance a JOIN users u ON u.id=a.student_user_id LEFT JOIN student_profiles p ON p.user_id=u.id WHERE 1=1`;
  const args=[];
  if (course_code) { sql+=' AND a.course_code=?'; args.push(course_code); }
  if (date)        { sql+=' AND a.date=?';         args.push(date); }
  if (student_id)  { sql+=' AND a.student_user_id=?'; args.push(Number(student_id)); }
  sql+=' ORDER BY a.date DESC,u.full_name LIMIT 500';
  res.json({ items: db.prepare(sql).all(...args) });
});

// ═══════════════════════════════════════════════════════════════════
// EXAM SCHEDULES & RESULTS
// ═══════════════════════════════════════════════════════════════════
router.get('/exams', only, (req, res) => {
  res.json({ items: db.prepare('SELECT e.*,u.username AS created_by_name FROM exam_schedules e LEFT JOIN users u ON u.id=e.created_by ORDER BY e.exam_date').all() });
});
router.post('/exams', only, (req, res) => {
  const { title, course_code, exam_date, exam_time, duration_mins, room, total_marks, passing_marks, academic_year } = req.body||{};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO exam_schedules (title,course_code,exam_date,exam_time,duration_mins,room,total_marks,passing_marks,academic_year,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(title,course_code||null,exam_date||null,exam_time||null,Number(duration_mins)||180,room||null,Number(total_marks)||100,Number(passing_marks)||40,academic_year||null,req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/exams/:id', only, (req, res) => {
  db.prepare('DELETE FROM exam_schedules WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/results', only, (req, res) => {
  const { exam_id, student_id } = req.query;
  let sql=`SELECT r.*,u.full_name,p.roll_no,e.title AS exam_title FROM results r JOIN users u ON u.id=r.student_user_id JOIN exam_schedules e ON e.id=r.exam_id LEFT JOIN student_profiles p ON p.user_id=u.id WHERE 1=1`;
  const a=[];
  if (exam_id)    { sql+=' AND r.exam_id=?';         a.push(Number(exam_id)); }
  if (student_id) { sql+=' AND r.student_user_id=?'; a.push(Number(student_id)); }
  sql+=' ORDER BY e.exam_date,u.full_name';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/results', only, (req, res) => {
  const { student_user_id, exam_id, marks_obtained, grade, remarks } = req.body||{};
  if (!student_user_id||!exam_id) return res.status(400).json({ error: 'student_user_id and exam_id required' });
  const m = Number(marks_obtained)||0;
  const exam = db.prepare('SELECT * FROM exam_schedules WHERE id=?').get(Number(exam_id));
  const g = grade || calcGrade(m, exam?.total_marks||100);
  try {
    db.prepare('INSERT INTO results (student_user_id,exam_id,marks_obtained,grade,remarks,published) VALUES (?,?,?,?,?,0) ON CONFLICT(student_user_id,exam_id) DO UPDATE SET marks_obtained=excluded.marks_obtained,grade=excluded.grade,remarks=excluded.remarks')
      .run(Number(student_user_id),Number(exam_id),m,g,remarks||null);
    res.json({ ok:true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/results/:id/publish', only, (req, res) => {
  db.prepare('UPDATE results SET published=1 WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

function calcGrade(m, total) {
  const p = (m/total)*100;
  if (p>=90) return 'A+'; if (p>=80) return 'A'; if (p>=70) return 'B+';
  if (p>=60) return 'B';  if (p>=50) return 'C'; if (p>=40) return 'D';
  return 'F';
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════
router.get('/notifications', only, (req, res) => {
  res.json({ items: db.prepare('SELECT n.*,u.full_name AS sent_by_name FROM notifications n LEFT JOIN users u ON u.id=n.sent_by ORDER BY n.sent_at DESC LIMIT 100').all() });
});
router.post('/notifications', only, (req, res) => {
  const { title, message, type, audience } = req.body||{};
  if (!title||!message) return res.status(400).json({ error: 'title and message required' });
  const info = db.prepare('INSERT INTO notifications (title,message,type,audience,sent_by) VALUES (?,?,?,?,?)')
    .run(title,message,type||'app',audience||'all',req.session.user.id);
  // Fan out to all relevant users
  let usersQuery = 'SELECT id FROM users WHERE is_active=1';
  if (audience && audience !== 'all') usersQuery += ` AND role='${audience}'`;
  const users = db.prepare(usersQuery).all();
  const ins = db.prepare('INSERT OR IGNORE INTO user_notifications (notification_id,user_id) VALUES (?,?)');
  db.transaction((us) => us.forEach(u => ins.run(info.lastInsertRowid, u.id)))(users);
  res.json({ ok:true, id: info.lastInsertRowid, sent_to: users.length });
});

// ═══════════════════════════════════════════════════════════════════
// CONTACTS
// ═══════════════════════════════════════════════════════════════════
router.get('/contacts', only, (req, res) => {
  const { q } = req.query;
  let sql=`SELECT * FROM contacts WHERE 1=1`;
  const a=[];
  if (q) { sql+=' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)'; a.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY name';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/contacts', only, (req, res) => {
  const { name, role, department, phone, email, address, tags } = req.body||{};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO contacts (name,role,department,phone,email,address,tags) VALUES (?,?,?,?,?,?,?)').run(name,role||null,department||null,phone||null,email||null,address||null,tags||null);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/contacts/:id', only, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// STUDY MATERIAL
// ═══════════════════════════════════════════════════════════════════
router.get('/study-materials', only, (req, res) => {
  const { course_code } = req.query;
  let sql=`SELECT id,title,description,course_code,file_name,file_type,file_size,uploaded_by,created_at FROM study_materials WHERE 1=1`;
  const a=[];
  if (course_code) { sql+=' AND course_code=?'; a.push(course_code); }
  sql+=' ORDER BY created_at DESC';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/study-materials', only, (req, res) => {
  const { title, description, course_code, file_name, file_type, file_data } = req.body||{};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO study_materials (title,description,course_code,file_name,file_type,file_data,uploaded_by) VALUES (?,?,?,?,?,?,?)')
    .run(title,description||null,course_code||null,file_name||null,file_type||null,file_data||null,req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/study-materials/:id', only, (req, res) => {
  db.prepare('DELETE FROM study_materials WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// LIBRARY
// ═══════════════════════════════════════════════════════════════════
router.get('/library/books', only, (req, res) => {
  const { q } = req.query;
  let sql=`SELECT * FROM library_books WHERE 1=1`;
  const a=[];
  if (q) { sql+=' AND (title LIKE ? OR author LIKE ? OR isbn LIKE ?)'; a.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  sql+=' ORDER BY title';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/library/books', only, (req, res) => {
  const { isbn, title, author, publisher, category, edition, copies, rack_no } = req.body||{};
  if (!title) return res.status(400).json({ error: 'title required' });
  const c = Number(copies)||1;
  const info = db.prepare('INSERT INTO library_books (isbn,title,author,publisher,category,edition,copies,available,rack_no) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(isbn||null,title,author||null,publisher||null,category||null,edition||null,c,c,rack_no||null);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/library/books/:id', only, (req, res) => {
  db.prepare('DELETE FROM library_books WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/library/issues', only, (req, res) => {
  const rows = db.prepare(`SELECT i.*,b.title AS book_title,b.isbn,u.full_name FROM library_issues i JOIN library_books b ON b.id=i.book_id JOIN users u ON u.id=i.user_id ORDER BY i.issue_date DESC LIMIT 200`).all();
  res.json({ items: rows });
});
router.post('/library/issues', only, (req, res) => {
  const { book_id, user_id, due_date } = req.body||{};
  if (!book_id||!user_id) return res.status(400).json({ error: 'book_id and user_id required' });
  const book = db.prepare('SELECT * FROM library_books WHERE id=?').get(Number(book_id));
  if (!book||book.available<1) return res.status(400).json({ error: 'No copies available' });
  db.prepare('UPDATE library_books SET available=available-1 WHERE id=?').run(Number(book_id));
  const info = db.prepare('INSERT INTO library_issues (book_id,user_id,issue_date,due_date,status) VALUES (?,?,CURRENT_DATE,?,?)')
    .run(Number(book_id),Number(user_id),due_date||null,'issued');
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.put('/library/issues/:id/return', only, (req, res) => {
  const issue = db.prepare('SELECT * FROM library_issues WHERE id=?').get(Number(req.params.id));
  if (!issue) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE library_issues SET return_date=CURRENT_DATE,status=? WHERE id=?').run('returned',Number(req.params.id));
  db.prepare('UPDATE library_books SET available=available+1 WHERE id=?').run(issue.book_id);
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// HOSTEL
// ═══════════════════════════════════════════════════════════════════
router.get('/hostel/rooms', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM hostel_rooms ORDER BY block,room_no').all() });
});
router.post('/hostel/rooms', only, (req, res) => {
  const { room_no, block, floor, capacity, room_type, monthly_fee } = req.body||{};
  if (!room_no) return res.status(400).json({ error: 'room_no required' });
  try {
    const info = db.prepare('INSERT INTO hostel_rooms (room_no,block,floor,capacity,room_type,monthly_fee) VALUES (?,?,?,?,?,?)').run(room_no,block||null,floor?Number(floor):null,Number(capacity)||2,room_type||'sharing',Number(monthly_fee)||0);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'room_no already exists' }); }
});
router.delete('/hostel/rooms/:id', only, (req, res) => {
  db.prepare('DELETE FROM hostel_rooms WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/hostel/allotments', only, (req, res) => {
  const rows = db.prepare(`SELECT ha.*,hr.room_no,hr.block,u.full_name,p.roll_no FROM hostel_allotments ha JOIN hostel_rooms hr ON hr.id=ha.room_id JOIN users u ON u.id=ha.student_user_id LEFT JOIN student_profiles p ON p.user_id=u.id WHERE ha.status='active' ORDER BY hr.block,hr.room_no`).all();
  res.json({ items: rows });
});
router.post('/hostel/allotments', only, (req, res) => {
  const { room_id, student_user_id, allotment_date } = req.body||{};
  if (!room_id||!student_user_id) return res.status(400).json({ error: 'room_id and student_user_id required' });
  const room = db.prepare('SELECT * FROM hostel_rooms WHERE id=?').get(Number(room_id));
  if (!room||room.occupied>=room.capacity) return res.status(400).json({ error: 'Room full' });
  db.prepare('UPDATE hostel_rooms SET occupied=occupied+1 WHERE id=?').run(Number(room_id));
  const info = db.prepare('INSERT INTO hostel_allotments (room_id,student_user_id,allotment_date,status) VALUES (?,?,?,?)').run(Number(room_id),Number(student_user_id),allotment_date||new Date().toISOString().split('T')[0],'active');
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.put('/hostel/allotments/:id/vacate', only, (req, res) => {
  const a = db.prepare('SELECT * FROM hostel_allotments WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'not found' });
  db.prepare("UPDATE hostel_allotments SET status='vacated',vacate_date=CURRENT_DATE WHERE id=?").run(Number(req.params.id));
  db.prepare('UPDATE hostel_rooms SET occupied=MAX(0,occupied-1) WHERE id=?').run(a.room_id);
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// TRANSPORT
// ═══════════════════════════════════════════════════════════════════
router.get('/transport/routes', only, (req, res) => {
  const rows = db.prepare(`SELECT r.*,(SELECT COUNT(*) FROM transport_allotments WHERE route_id=r.id AND status='active') AS enrolled FROM transport_routes r ORDER BY r.route_no`).all();
  res.json({ items: rows });
});
router.post('/transport/routes', only, (req, res) => {
  const { route_no, name, vehicle_no, driver_name, driver_phone, stops, monthly_fee } = req.body||{};
  if (!route_no||!name) return res.status(400).json({ error: 'route_no and name required' });
  try {
    const info = db.prepare('INSERT INTO transport_routes (route_no,name,vehicle_no,driver_name,driver_phone,stops,monthly_fee) VALUES (?,?,?,?,?,?,?)').run(route_no,name,vehicle_no||null,driver_name||null,driver_phone||null,stops||null,Number(monthly_fee)||0);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'route_no already exists' }); }
});
router.delete('/transport/routes/:id', only, (req, res) => {
  db.prepare('DELETE FROM transport_routes WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/transport/allotments', only, (req, res) => {
  const rows = db.prepare(`SELECT ta.*,tr.route_no,tr.name AS route_name,u.full_name,p.roll_no FROM transport_allotments ta JOIN transport_routes tr ON tr.id=ta.route_id JOIN users u ON u.id=ta.student_user_id LEFT JOIN student_profiles p ON p.user_id=u.id WHERE ta.status='active' ORDER BY tr.route_no`).all();
  res.json({ items: rows });
});
router.post('/transport/allotments', only, (req, res) => {
  const { route_id, student_user_id, stop_name } = req.body||{};
  if (!route_id||!student_user_id) return res.status(400).json({ error: 'route_id and student_user_id required' });
  const info = db.prepare('INSERT INTO transport_allotments (route_id,student_user_id,stop_name,status) VALUES (?,?,?,?)').run(Number(route_id),Number(student_user_id),stop_name||null,'active');
  res.json({ ok:true, id: info.lastInsertRowid });
});

// ═══════════════════════════════════════════════════════════════════
// ASSETS
// ═══════════════════════════════════════════════════════════════════
router.get('/assets', only, (req, res) => {
  const { category, status } = req.query;
  let sql=`SELECT a.*,u.full_name AS assigned_to_name FROM assets a LEFT JOIN users u ON u.id=a.assigned_to WHERE 1=1`;
  const args=[];
  if (category) { sql+=' AND a.category=?'; args.push(category); }
  if (status)   { sql+=' AND a.status=?';   args.push(status); }
  sql+=' ORDER BY a.asset_code';
  res.json({ items: db.prepare(sql).all(...args) });
});
router.post('/assets', only, (req, res) => {
  const { asset_code, name, category, brand, model, serial_no, purchase_date, purchase_cost, location, status } = req.body||{};
  if (!asset_code||!name) return res.status(400).json({ error: 'asset_code and name required' });
  try {
    const info = db.prepare('INSERT INTO assets (asset_code,name,category,brand,model,serial_no,purchase_date,purchase_cost,location,status) VALUES (?,?,?,?,?,?,?,?,?,?)').run(asset_code,name,category||null,brand||null,model||null,serial_no||null,purchase_date||null,Number(purchase_cost)||0,location||null,status||'active');
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'asset_code already exists' }); }
});
router.put('/assets/:id', only, (req, res) => {
  const { name, location, assigned_to, status } = req.body||{};
  db.prepare('UPDATE assets SET name=COALESCE(?,name),location=COALESCE(?,location),assigned_to=?,status=COALESCE(?,status) WHERE id=?')
    .run(name||null,location||null,assigned_to?Number(assigned_to):null,status||null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/assets/:id', only, (req, res) => {
  db.prepare('DELETE FROM assets WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════
router.get('/store/items', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM store_items ORDER BY category,name').all() });
});
router.post('/store/items', only, (req, res) => {
  const { code, name, category, unit, quantity, min_quantity, unit_price } = req.body||{};
  if (!code||!name) return res.status(400).json({ error: 'code and name required' });
  try {
    const info = db.prepare('INSERT INTO store_items (code,name,category,unit,quantity,min_quantity,unit_price) VALUES (?,?,?,?,?,?,?)').run(code,name,category||null,unit||'pcs',Number(quantity)||0,Number(min_quantity)||5,Number(unit_price)||0);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'code already exists' }); }
});
router.delete('/store/items/:id', only, (req, res) => {
  db.prepare('DELETE FROM store_items WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/store/transactions', only, (req, res) => {
  const rows = db.prepare(`SELECT st.*,si.name AS item_name,u.full_name AS created_by_name FROM store_transactions st JOIN store_items si ON si.id=st.item_id LEFT JOIN users u ON u.id=st.created_by ORDER BY st.created_at DESC LIMIT 200`).all();
  res.json({ items: rows });
});
router.post('/store/transactions', only, (req, res) => {
  const { item_id, type, quantity, notes } = req.body||{};
  if (!item_id||!type||!quantity) return res.status(400).json({ error: 'item_id, type and quantity required' });
  const q = Number(quantity);
  const item = db.prepare('SELECT * FROM store_items WHERE id=?').get(Number(item_id));
  if (!item) return res.status(404).json({ error: 'item not found' });
  if (type==='out'&&item.quantity<q) return res.status(400).json({ error: 'Insufficient stock' });
  const newQty = type==='in' ? item.quantity+q : item.quantity-q;
  db.prepare('UPDATE store_items SET quantity=? WHERE id=?').run(newQty, Number(item_id));
  const info = db.prepare('INSERT INTO store_transactions (item_id,type,quantity,notes,created_by) VALUES (?,?,?,?,?)').run(Number(item_id),type,q,notes||null,req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid, new_quantity: newQty });
});

// ═══════════════════════════════════════════════════════════════════
// ONLINE EXAMS
// ═══════════════════════════════════════════════════════════════════
router.get('/online-exams', only, (req, res) => {
  const rows = db.prepare(`SELECT e.*,(SELECT COUNT(*) FROM online_exam_questions WHERE exam_id=e.id) AS question_count FROM online_exams e ORDER BY e.created_at DESC`).all();
  res.json({ items: rows });
});
router.post('/online-exams', only, (req, res) => {
  const { title, course_code, duration_mins, total_marks, passing_marks, instructions, start_time, end_time } = req.body||{};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO online_exams (title,course_code,duration_mins,total_marks,passing_marks,instructions,start_time,end_time,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(title,course_code||null,Number(duration_mins)||60,Number(total_marks)||50,Number(passing_marks)||20,instructions||null,start_time||null,end_time||null,'draft',req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.put('/online-exams/:id/publish', only, (req, res) => {
  db.prepare("UPDATE online_exams SET status='published' WHERE id=?").run(Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/online-exams/:id', only, (req, res) => {
  db.prepare('DELETE FROM online_exams WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/online-exams/:id/questions', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM online_exam_questions WHERE exam_id=? ORDER BY id').all(Number(req.params.id)) });
});
router.post('/online-exams/:id/questions', only, (req, res) => {
  const { question, option_a, option_b, option_c, option_d, correct_option, marks } = req.body||{};
  if (!question) return res.status(400).json({ error: 'question required' });
  const info = db.prepare('INSERT INTO online_exam_questions (exam_id,question,option_a,option_b,option_c,option_d,correct_option,marks) VALUES (?,?,?,?,?,?,?,?)').run(Number(req.params.id),question,option_a||null,option_b||null,option_c||null,option_d||null,correct_option||null,Number(marks)||1);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/online-exams/questions/:qid', only, (req, res) => {
  db.prepare('DELETE FROM online_exam_questions WHERE id=?').run(Number(req.params.qid));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// LMS
// ═══════════════════════════════════════════════════════════════════
router.get('/lms/courses', only, (req, res) => {
  const rows = db.prepare(`SELECT c.*,u.full_name AS instructor_name,(SELECT COUNT(*) FROM lms_modules WHERE course_id=c.id) AS module_count,(SELECT COUNT(*) FROM lms_enrollments WHERE course_id=c.id) AS enrollments FROM lms_courses c LEFT JOIN users u ON u.id=c.instructor_id ORDER BY c.created_at DESC`).all();
  res.json({ items: rows });
});
router.post('/lms/courses', only, (req, res) => {
  const { title, description, category, instructor_id, duration_hours } = req.body||{};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO lms_courses (title,description,category,instructor_id,duration_hours,status) VALUES (?,?,?,?,?,?)').run(title,description||null,category||null,instructor_id?Number(instructor_id):null,Number(duration_hours)||0,'draft');
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.put('/lms/courses/:id/publish', only, (req, res) => {
  db.prepare("UPDATE lms_courses SET status='published' WHERE id=?").run(Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/lms/courses/:id', only, (req, res) => {
  db.prepare('DELETE FROM lms_courses WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/lms/courses/:id/modules', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM lms_modules WHERE course_id=? ORDER BY order_no').all(Number(req.params.id)) });
});
router.post('/lms/courses/:id/modules', only, (req, res) => {
  const { title, content, video_url, order_no } = req.body||{};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO lms_modules (course_id,title,content,video_url,order_no) VALUES (?,?,?,?,?)').run(Number(req.params.id),title,content||null,video_url||null,Number(order_no)||1);
  res.json({ ok:true, id: info.lastInsertRowid });
});

// ═══════════════════════════════════════════════════════════════════
// PLACEMENT
// ═══════════════════════════════════════════════════════════════════
router.get('/placement/drives', only, (req, res) => {
  const rows = db.prepare(`SELECT d.*,(SELECT COUNT(*) FROM placement_applications WHERE drive_id=d.id) AS applications FROM placement_drives d ORDER BY d.drive_date DESC`).all();
  res.json({ items: rows });
});
router.post('/placement/drives', only, (req, res) => {
  const { company, role, description, package_lpa, eligibility, drive_date, last_date, location } = req.body||{};
  if (!company||!role) return res.status(400).json({ error: 'company and role required' });
  const info = db.prepare('INSERT INTO placement_drives (company,role,description,package_lpa,eligibility,drive_date,last_date,location,status) VALUES (?,?,?,?,?,?,?,?,?)').run(company,role,description||null,package_lpa?Number(package_lpa):null,eligibility||null,drive_date||null,last_date||null,location||null,'open');
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.put('/placement/drives/:id/status', only, (req, res) => {
  const { status } = req.body||{};
  db.prepare('UPDATE placement_drives SET status=? WHERE id=?').run(status,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/placement/drives/:id', only, (req, res) => {
  db.prepare('DELETE FROM placement_drives WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/placement/applications', only, (req, res) => {
  const { drive_id } = req.query;
  let sql=`SELECT pa.*,pd.company,pd.role,u.full_name,p.roll_no FROM placement_applications pa JOIN placement_drives pd ON pd.id=pa.drive_id JOIN users u ON u.id=pa.student_user_id LEFT JOIN student_profiles p ON p.user_id=u.id WHERE 1=1`;
  const a=[];
  if (drive_id) { sql+=' AND pa.drive_id=?'; a.push(Number(drive_id)); }
  sql+=' ORDER BY pa.applied_at DESC';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.put('/placement/applications/:id/status', only, (req, res) => {
  const { status } = req.body||{};
  db.prepare('UPDATE placement_applications SET status=? WHERE id=?').run(status,Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// ENQUIRIES
// ═══════════════════════════════════════════════════════════════════
router.get('/enquiries', only, (req, res) => {
  const { status } = req.query;
  let sql=`SELECT e.*,u.full_name AS assigned_to_name FROM enquiries e LEFT JOIN users u ON u.id=e.assigned_to WHERE 1=1`;
  const a=[];
  if (status) { sql+=' AND e.status=?'; a.push(status); }
  sql+=' ORDER BY e.created_at DESC';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/enquiries', only, (req, res) => {
  const { name, phone, email, course_interest, source, notes, assigned_to } = req.body||{};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO enquiries (name,phone,email,course_interest,source,status,notes,assigned_to) VALUES (?,?,?,?,?,?,?,?)').run(name,phone||null,email||null,course_interest||null,source||'walk-in','new',notes||null,assigned_to?Number(assigned_to):null);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.put('/enquiries/:id', only, (req, res) => {
  const { status, notes, assigned_to } = req.body||{};
  db.prepare('UPDATE enquiries SET status=COALESCE(?,status),notes=COALESCE(?,notes),assigned_to=COALESCE(?,assigned_to) WHERE id=?').run(status||null,notes||null,assigned_to?Number(assigned_to):null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/enquiries/:id', only, (req, res) => {
  db.prepare('DELETE FROM enquiries WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});
router.get('/enquiries/:id/followups', only, (req, res) => {
  res.json({ items: db.prepare(`SELECT f.*,u.full_name FROM enquiry_followups f JOIN users u ON u.id=f.user_id WHERE f.enquiry_id=? ORDER BY f.created_at DESC`).all(Number(req.params.id)) });
});
router.post('/enquiries/:id/followups', only, (req, res) => {
  const { notes, next_follow_up } = req.body||{};
  if (!notes) return res.status(400).json({ error: 'notes required' });
  db.prepare('INSERT INTO enquiry_followups (enquiry_id,user_id,notes,next_follow_up) VALUES (?,?,?,?)').run(Number(req.params.id),req.session.user.id,notes,next_follow_up||null);
  db.prepare("UPDATE enquiries SET status='follow-up' WHERE id=? AND status='new'").run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════════════════════
router.get('/clients', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM clients ORDER BY name').all() });
});
router.post('/clients', only, (req, res) => {
  const { name, company, industry, contact_person, phone, email, address, notes } = req.body||{};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO clients (name,company,industry,contact_person,phone,email,address,notes) VALUES (?,?,?,?,?,?,?,?)').run(name,company||null,industry||null,contact_person||null,phone||null,email||null,address||null,notes||null);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/clients/:id', only, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════
router.get('/campaigns', only, (req, res) => {
  res.json({ items: db.prepare('SELECT c.*,u.full_name AS created_by_name FROM campaigns c LEFT JOIN users u ON u.id=c.created_by ORDER BY c.created_at DESC').all() });
});
router.post('/campaigns', only, (req, res) => {
  const { title, type, description, target_audience, start_date, end_date, budget } = req.body||{};
  if (!title) return res.status(400).json({ error: 'title required' });
  const info = db.prepare('INSERT INTO campaigns (title,type,description,target_audience,start_date,end_date,budget,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(title,type||'email',description||null,target_audience||null,start_date||null,end_date||null,Number(budget)||0,'planned',req.session.user.id);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.put('/campaigns/:id', only, (req, res) => {
  const { status, leads_generated, conversions } = req.body||{};
  db.prepare('UPDATE campaigns SET status=COALESCE(?,status),leads_generated=COALESCE(?,leads_generated),conversions=COALESCE(?,conversions) WHERE id=?').run(status||null,leads_generated!=null?Number(leads_generated):null,conversions!=null?Number(conversions):null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/campaigns/:id', only, (req, res) => {
  db.prepare('DELETE FROM campaigns WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// DEVICES
// ═══════════════════════════════════════════════════════════════════
router.get('/devices', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM devices ORDER BY device_code').all() });
});
router.post('/devices', only, (req, res) => {
  const { device_code, name, type, location, ip_address } = req.body||{};
  if (!device_code||!name) return res.status(400).json({ error: 'device_code and name required' });
  try {
    const info = db.prepare('INSERT INTO devices (device_code,name,type,location,ip_address,status) VALUES (?,?,?,?,?,?)').run(device_code,name,type||'biometric',location||null,ip_address||null,'active');
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'device_code already exists' }); }
});
router.put('/devices/:id', only, (req, res) => {
  const { status, ip_address, location } = req.body||{};
  db.prepare('UPDATE devices SET status=COALESCE(?,status),ip_address=COALESCE(?,ip_address),location=COALESCE(?,location),last_sync=CURRENT_TIMESTAMP WHERE id=?').run(status||null,ip_address||null,location||null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/devices/:id', only, (req, res) => {
  db.prepare('DELETE FROM devices WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// SCHOOLS (Multi-School)
// ═══════════════════════════════════════════════════════════════════
router.get('/schools', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM schools ORDER BY code').all() });
});
router.post('/schools', only, (req, res) => {
  const { code, name, address, phone, email, principal, established } = req.body||{};
  if (!code||!name) return res.status(400).json({ error: 'code and name required' });
  try {
    const info = db.prepare('INSERT INTO schools (code,name,address,phone,email,principal,established) VALUES (?,?,?,?,?,?,?)').run(code,name,address||null,phone||null,email||null,principal||null,established?Number(established):null);
    res.json({ ok:true, id: info.lastInsertRowid });
  } catch { res.status(409).json({ error: 'code already exists' }); }
});
router.put('/schools/:id', only, (req, res) => {
  const { name, address, phone, email, principal, is_active } = req.body||{};
  db.prepare('UPDATE schools SET name=COALESCE(?,name),address=COALESCE(?,address),phone=COALESCE(?,phone),email=COALESCE(?,email),principal=COALESCE(?,principal),is_active=COALESCE(?,is_active) WHERE id=?').run(name||null,address||null,phone||null,email||null,principal||null,is_active!=null?Number(is_active):null,Number(req.params.id));
  res.json({ ok:true });
});
router.delete('/schools/:id', only, (req, res) => {
  db.prepare('DELETE FROM schools WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════
router.get('/settings', only, (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  res.json({ settings: Object.fromEntries(rows.map(r=>[r.key,r.value])) });
});
router.put('/settings', only, (req, res) => {
  const up = db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
  db.transaction((obj) => { for (const [k,v] of Object.entries(obj)) up.run(k,String(v??'')); })(req.body||{});
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// ACTIVITY LOGS
// ═══════════════════════════════════════════════════════════════════
router.get('/activity-logs', only, (req, res) => {
  const { user_id, entity, page=1, per=50 } = req.query;
  let sql=`SELECT l.*,u.full_name,u.role FROM activity_logs l LEFT JOIN users u ON u.id=l.user_id WHERE 1=1`;
  const a=[];
  if (user_id) { sql+=' AND l.user_id=?'; a.push(Number(user_id)); }
  if (entity)  { sql+=' AND l.entity=?';  a.push(entity); }
  const total = db.prepare(sql.replace('SELECT l.*,u.full_name,u.role','SELECT COUNT(*) AS c')).get(...a).c;
  sql+=' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
  res.json({ items: db.prepare(sql).all(...a,Number(per),(Number(page)-1)*Number(per)), total });
});

// ═══════════════════════════════════════════════════════════════════
// MIS REPORTS
// ═══════════════════════════════════════════════════════════════════
router.get('/reports/enrollment', only, (req, res) => {
  const byDept = db.prepare(`SELECT p.department,COUNT(*) AS count FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' GROUP BY p.department ORDER BY count DESC`).all();
  const bySem  = db.prepare(`SELECT p.semester,COUNT(*) AS count FROM users u JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' GROUP BY p.semester ORDER BY p.semester`).all();
  res.json({ by_department: byDept, by_semester: bySem });
});
router.get('/reports/fees', only, (req, res) => {
  const monthly = db.prepare(`SELECT strftime('%Y-%m',paid_on) AS month,COALESCE(SUM(amount),0) AS total,COUNT(*) AS count FROM fee_payments WHERE status='PAID' GROUP BY month ORDER BY month`).all();
  const byType  = db.prepare(`SELECT fee_type,COALESCE(SUM(amount),0) AS total,COUNT(*) AS count FROM fee_payments GROUP BY fee_type`).all();
  res.json({ monthly, by_type: byType });
});
router.get('/reports/attendance', only, (req, res) => {
  const byCourse = db.prepare(`SELECT course_code,COUNT(*) AS total,SUM(CASE WHEN status='present' THEN 1 ELSE 0 END) AS present FROM attendance GROUP BY course_code ORDER BY course_code`).all();
  res.json({ by_course: byCourse });
});
router.get('/reports/results', only, (req, res) => {
  const byGrade = db.prepare(`SELECT grade,COUNT(*) AS count FROM results WHERE published=1 GROUP BY grade ORDER BY grade`).all();
  const passRate = db.prepare(`SELECT e.title,COUNT(*) AS total,SUM(CASE WHEN r.grade!='F' THEN 1 ELSE 0 END) AS passed FROM results r JOIN exam_schedules e ON e.id=r.exam_id WHERE r.published=1 GROUP BY r.exam_id`).all();
  res.json({ by_grade: byGrade, pass_rate: passRate });
});

// ═══════════════════════════════════════════════════════════════════
// DATA EXPORT
// ═══════════════════════════════════════════════════════════════════
router.get('/export/students', only, (req, res) => {
  const rows = db.prepare(`SELECT u.username,u.full_name,u.email,p.roll_no,p.department,p.semester,p.phone,p.dob,p.address FROM users u LEFT JOIN student_profiles p ON p.user_id=u.id WHERE u.role='student' ORDER BY p.roll_no`).all();
  const csv = ['Username,Full Name,Email,Roll No,Department,Semester,Phone,DOB,Address',
    ...rows.map(r=>`${r.username},${r.full_name},${r.email||''},${r.roll_no||''},${r.department||''},${r.semester||''},${r.phone||''},${r.dob||''},${(r.address||'').replace(/,/g,' ')}`)
  ].join('\n');
  res.set('Content-Type','text/csv');
  res.set('Content-Disposition','attachment; filename=students.csv');
  res.send(csv);
});
router.get('/export/fees', only, (req, res) => {
  const rows = db.prepare(`SELECT u.full_name,p.roll_no,f.fee_type,f.amount,f.status,f.paid_on,f.reference FROM fee_payments f JOIN users u ON u.id=f.user_id LEFT JOIN student_profiles p ON p.user_id=u.id ORDER BY f.paid_on DESC`).all();
  const csv = ['Full Name,Roll No,Fee Type,Amount,Status,Paid On,Reference',
    ...rows.map(r=>`${r.full_name},${r.roll_no||''},${r.fee_type},${r.amount},${r.status},${r.paid_on},${r.reference||''}`)
  ].join('\n');
  res.set('Content-Type','text/csv');
  res.set('Content-Disposition','attachment; filename=fees.csv');
  res.send(csv);
});

// ═══════════════════════════════════════════════════════════════════
// BACKUP
// ═══════════════════════════════════════════════════════════════════
router.get('/backup', only, (req, res) => {
  const dbPath = require('path').join(__dirname,'..','data','erp.db');
  logActivity(req.session.user.id,'BACKUP','system',null,'Database backup downloaded');
  res.download(dbPath, `erp-backup-${new Date().toISOString().split('T')[0]}.db`);
});

// ═══════════════════════════════════════════════════════════════════
// TIMETABLE
// ═══════════════════════════════════════════════════════════════════
router.get('/timetable', only, (req, res) => {
  const { batch_id } = req.query;
  let sql=`SELECT t.*,u.full_name AS faculty_name FROM timetable t LEFT JOIN users u ON u.id=t.faculty_id WHERE 1=1`;
  const a=[];
  if (batch_id) { sql+=' AND t.batch_id=?'; a.push(Number(batch_id)); }
  sql+=' ORDER BY t.day,t.period';
  res.json({ items: db.prepare(sql).all(...a) });
});
router.post('/timetable', only, (req, res) => {
  const { batch_id, day, period, start_time, end_time, course_code, faculty_id, room } = req.body||{};
  if (!day||!period) return res.status(400).json({ error: 'day and period required' });
  const info = db.prepare('INSERT INTO timetable (batch_id,day,period,start_time,end_time,course_code,faculty_id,room) VALUES (?,?,?,?,?,?,?,?)').run(batch_id?Number(batch_id):null,day,Number(period),start_time||null,end_time||null,course_code||null,faculty_id?Number(faculty_id):null,room||null);
  res.json({ ok:true, id: info.lastInsertRowid });
});
router.delete('/timetable/:id', only, (req, res) => {
  db.prepare('DELETE FROM timetable WHERE id=?').run(Number(req.params.id));
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// ROLE PERMISSIONS
// ═══════════════════════════════════════════════════════════════════
router.get('/permissions', only, (req, res) => {
  res.json({ items: db.prepare('SELECT * FROM role_permissions ORDER BY role,module').all() });
});
router.post('/permissions', only, (req, res) => {
  const { role, module, can_view, can_create, can_edit, can_delete } = req.body||{};
  if (!role||!module) return res.status(400).json({ error: 'role and module required' });
  db.prepare(`INSERT INTO role_permissions (role,module,can_view,can_create,can_edit,can_delete) VALUES (?,?,?,?,?,?) ON CONFLICT(role,module) DO UPDATE SET can_view=excluded.can_view,can_create=excluded.can_create,can_edit=excluded.can_edit,can_delete=excluded.can_delete`)
    .run(role,module,Number(can_view)||0,Number(can_create)||0,Number(can_edit)||0,Number(can_delete)||0);
  res.json({ ok:true });
});

// ═══════════════════════════════════════════════════════════════════
// LECTURES
// ═══════════════════════════════════════════════════════════════════
router.get('/lectures', only, (req, res) => {
  const rows = db.prepare(`SELECT l.*,u.full_name AS faculty_name,b.name AS batch_name FROM lectures l LEFT JOIN users u ON u.id=l.faculty_id LEFT JOIN batches b ON b.id=l.batch_id ORDER BY l.lecture_date DESC LIMIT 100`).all();
  res.json({ items: rows });
});

// ═══════════════════════════════════════════════════════════════════
// REMINDERS
// ═══════════════════════════════════════════════════════════════════
router.get('/reminders', only, (req, res) => {
  const rows = db.prepare(`SELECT r.*,u.full_name FROM reminders r JOIN users u ON u.id=r.user_id WHERE r.is_done=0 ORDER BY r.remind_at`).all();
  res.json({ items: rows });
});
router.post('/reminders', only, (req, res) => {
  const { title, description, remind_at, repeat } = req.body||{};
  if (!title||!remind_at) return res.status(400).json({ error: 'title and remind_at required' });
  const info = db.prepare('INSERT INTO reminders (user_id,title,description,remind_at,repeat) VALUES (?,?,?,?,?)').run(req.session.user.id,title,description||null,remind_at,repeat||'none');
  res.json({ ok:true, id: info.lastInsertRowid });
});

// ═══════════════════════════════════════════════════════════════════
// CLINICAL POSTINGS  (Medical College)
// ═══════════════════════════════════════════════════════════════════
router.get('/clinical-postings', only, (req, res) => {
  const { batch_id, department_id, status } = req.query;
  let sql = `SELECT cp.*, b.name AS batch_name, b.code AS batch_code,
             d.name AS dept_name, u.full_name AS student_name, sp.roll_no,
             sup.full_name AS supervisor_name
             FROM clinical_postings cp
             LEFT JOIN batches b ON b.id = cp.batch_id
             LEFT JOIN departments d ON d.id = cp.department_id
             LEFT JOIN users u ON u.id = cp.student_user_id
             LEFT JOIN student_profiles sp ON sp.user_id = cp.student_user_id
             LEFT JOIN users sup ON sup.id = cp.supervisor_id
             WHERE 1=1`;
  const a = [];
  if (batch_id)      { sql += ' AND cp.batch_id=?';      a.push(Number(batch_id)); }
  if (department_id) { sql += ' AND cp.department_id=?'; a.push(Number(department_id)); }
  if (status)        { sql += ' AND cp.status=?';        a.push(status); }
  sql += ' ORDER BY cp.start_date DESC';
  res.json({ items: db.prepare(sql).all(...a) });
});

router.post('/clinical-postings', only, (req, res) => {
  const { batch_id, student_user_id, department_id, ward, shift,
          start_date, end_date, supervisor_id, status, notes } = req.body || {};
  if (!department_id || !start_date || !end_date)
    return res.status(400).json({ error: 'department_id, start_date, end_date required' });
  const dept = db.prepare('SELECT name FROM departments WHERE id=?').get(Number(department_id));
  const info = db.prepare(
    `INSERT INTO clinical_postings (batch_id,student_user_id,department_id,department,ward,shift,start_date,end_date,supervisor_id,status,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    batch_id ? Number(batch_id) : null,
    student_user_id ? Number(student_user_id) : null,
    Number(department_id), dept?.name || null,
    ward || null, shift || 'morning',
    start_date, end_date,
    supervisor_id ? Number(supervisor_id) : null,
    status || 'scheduled', notes || null
  );
  logActivity(req.session.user.id, 'CREATE', 'clinical_posting', info.lastInsertRowid,
              `${dept?.name||''} ${start_date} → ${end_date}`);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/clinical-postings/:id', only, (req, res) => {
  const { ward, shift, start_date, end_date, supervisor_id, status, notes } = req.body || {};
  db.prepare(
    `UPDATE clinical_postings SET ward=?,shift=?,start_date=COALESCE(?,start_date),end_date=COALESCE(?,end_date),supervisor_id=?,status=COALESCE(?,status),notes=? WHERE id=?`
  ).run(ward || null, shift || 'morning', start_date || null, end_date || null,
        supervisor_id ? Number(supervisor_id) : null, status || null, notes || null,
        Number(req.params.id));
  logActivity(req.session.user.id, 'UPDATE', 'clinical_posting', Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/clinical-postings/:id', only, (req, res) => {
  db.prepare('DELETE FROM clinical_postings WHERE id=?').run(Number(req.params.id));
  logActivity(req.session.user.id, 'DELETE', 'clinical_posting', Number(req.params.id));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// CASE LOGBOOK (Clinical case entries)
// ═══════════════════════════════════════════════════════════════════
router.get('/case-logs', only, (req, res) => {
  const { student_user_id, status, department } = req.query;
  let sql = `SELECT cl.*, s.full_name AS student_name, sp.roll_no,
             sup.full_name AS supervisor_name, v.full_name AS verifier_name
             FROM case_logs cl
             LEFT JOIN users s ON s.id = cl.student_user_id
             LEFT JOIN student_profiles sp ON sp.user_id = cl.student_user_id
             LEFT JOIN users sup ON sup.id = cl.supervisor_id
             LEFT JOIN users v ON v.id = cl.verified_by
             WHERE 1=1`;
  const a = [];
  if (student_user_id) { sql += ' AND cl.student_user_id=?'; a.push(Number(student_user_id)); }
  if (status)          { sql += ' AND cl.status=?';          a.push(status); }
  if (department)      { sql += ' AND cl.department=?';      a.push(department); }
  sql += ' ORDER BY cl.case_date DESC LIMIT 200';
  res.json({ items: db.prepare(sql).all(...a) });
});

router.delete('/case-logs/:id', only, (req, res) => {
  db.prepare('DELETE FROM case_logs WHERE id=?').run(Number(req.params.id));
  logActivity(req.session.user.id, 'DELETE', 'case_log', Number(req.params.id));
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════
// PROCEDURE LOGBOOK (Skills performed/assisted/observed)
// ═══════════════════════════════════════════════════════════════════
router.get('/procedure-logs', only, (req, res) => {
  const { student_user_id, status, department, level } = req.query;
  let sql = `SELECT pl.*, s.full_name AS student_name, sp.roll_no,
             sup.full_name AS supervisor_name, v.full_name AS verifier_name
             FROM procedure_logs pl
             LEFT JOIN users s ON s.id = pl.student_user_id
             LEFT JOIN student_profiles sp ON sp.user_id = pl.student_user_id
             LEFT JOIN users sup ON sup.id = pl.supervisor_id
             LEFT JOIN users v ON v.id = pl.verified_by
             WHERE 1=1`;
  const a = [];
  if (student_user_id) { sql += ' AND pl.student_user_id=?'; a.push(Number(student_user_id)); }
  if (status)          { sql += ' AND pl.status=?';          a.push(status); }
  if (department)      { sql += ' AND pl.department=?';      a.push(department); }
  if (level)           { sql += ' AND pl.level=?';           a.push(level); }
  sql += ' ORDER BY pl.procedure_date DESC LIMIT 200';
  res.json({ items: db.prepare(sql).all(...a) });
});

router.delete('/procedure-logs/:id', only, (req, res) => {
  db.prepare('DELETE FROM procedure_logs WHERE id=?').run(Number(req.params.id));
  logActivity(req.session.user.id, 'DELETE', 'procedure_log', Number(req.params.id));
  res.json({ ok: true });
});

// CBME compliance report — per-student case/procedure counts
router.get('/cbme-report', only, (req, res) => {
  const rows = db.prepare(`
    SELECT s.id AS student_id, s.full_name, sp.roll_no, sp.mbbs_year,
      (SELECT COUNT(*) FROM case_logs      cl WHERE cl.student_user_id=s.id) AS cases_total,
      (SELECT COUNT(*) FROM case_logs      cl WHERE cl.student_user_id=s.id AND cl.status='verified') AS cases_verified,
      (SELECT COUNT(*) FROM procedure_logs pl WHERE pl.student_user_id=s.id) AS proc_total,
      (SELECT COUNT(*) FROM procedure_logs pl WHERE pl.student_user_id=s.id AND pl.level='performed') AS proc_performed,
      (SELECT COUNT(*) FROM procedure_logs pl WHERE pl.student_user_id=s.id AND pl.level='assisted')  AS proc_assisted,
      (SELECT COUNT(*) FROM procedure_logs pl WHERE pl.student_user_id=s.id AND pl.level='observed')  AS proc_observed
    FROM users s
    LEFT JOIN student_profiles sp ON sp.user_id = s.id
    WHERE s.role='student'
    ORDER BY sp.mbbs_year, s.full_name
  `).all();
  res.json({ items: rows });
});

module.exports = router;
