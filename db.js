const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// On Vercel (or any read-only FS), write the DB to a writable tmp dir.
// Note: /tmp on Vercel is EPHEMERAL — data resets between cold starts.
const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const DATA_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'jjmmc-erp-data')
  : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'erp.db'));
// WAL doesn't play well with ephemeral /tmp; use DELETE mode on serverless.
db.pragma(IS_SERVERLESS ? 'journal_mode = DELETE' : 'journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA  (JJMMC — Medical College ERP)
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    email         TEXT,
    school_id     INTEGER DEFAULT 1,
    is_active     INTEGER DEFAULT 1,
    last_login    DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS student_profiles (
    user_id           INTEGER PRIMARY KEY,
    roll_no           TEXT,
    university_reg_no TEXT,
    course            TEXT DEFAULT 'MBBS',   -- MBBS / BDS / B.Sc Nursing / B.Pharm
    department        TEXT,                  -- posting specialty if applicable
    batch_id          INTEGER,
    mbbs_year         INTEGER,               -- 1..5 (5 = Intern / CRRI)
    semester          INTEGER,
    admission_quota   TEXT,                  -- Govt / Management / NRI
    neet_rank         INTEGER,
    dob               TEXT,
    gender            TEXT,
    phone             TEXT,
    address           TEXT,
    blood_group       TEXT,
    aadhaar           TEXT,
    parent_name       TEXT,
    parent_phone      TEXT,
    photo_url         TEXT,
    rfid_code         TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS fee_payments (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    fee_type  TEXT NOT NULL,
    amount    REAL NOT NULL,
    status    TEXT NOT NULL DEFAULT 'PAID',
    paid_on   DATETIME DEFAULT CURRENT_TIMESTAMP,
    reference TEXT,
    gateway   TEXT DEFAULT 'cash',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    subject    TEXT NOT NULL,
    rating     INTEGER NOT NULL,
    comments   TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS log_book (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    title      TEXT NOT NULL,
    details    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS elective_registrations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    course_code TEXT NOT NULL,
    course_name TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS revaluation_applications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    subject    TEXT NOT NULL,
    exam_date  TEXT,
    reason     TEXT,
    status     TEXT NOT NULL DEFAULT 'PENDING',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS departments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    category   TEXT,                  -- pre-clinical / para-clinical / clinical
    hod        TEXT,
    school_id  INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS courses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    department TEXT,
    mbbs_year  INTEGER,
    semester   INTEGER,
    credits    INTEGER DEFAULT 3,
    school_id  INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notices (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    audience   TEXT NOT NULL DEFAULT 'all',
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS schools (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    address     TEXT,
    phone       TEXT,
    email       TEXT,
    logo_url    TEXT,
    principal   TEXT,
    established INTEGER,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS enquiries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    course_interest TEXT,
    source          TEXT DEFAULT 'walk-in',
    status          TEXT DEFAULT 'new',
    assigned_to     INTEGER,
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS enquiry_followups (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    enquiry_id      INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    notes           TEXT NOT NULL,
    next_follow_up  DATE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (enquiry_id) REFERENCES enquiries(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT NOT NULL,
    category         TEXT NOT NULL,
    amount           REAL NOT NULL,
    description      TEXT,
    reference        TEXT,
    transaction_date DATE NOT NULL,
    created_by       INTEGER,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS parents (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER UNIQUE,
    student_user_id  INTEGER NOT NULL,
    relation         TEXT DEFAULT 'parent',
    phone            TEXT,
    occupation       TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS employees (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER UNIQUE,
    emp_code        TEXT UNIQUE NOT NULL,
    department      TEXT,
    designation     TEXT,                 -- Professor, Assoc Prof, Asst Prof, Sr Resident, Jr Resident
    specialization  TEXT,                 -- Cardiology, Neurology, Gen. Surgery, etc.
    qualification   TEXT,                 -- MD, MS, DNB, PhD, MBBS
    council_reg_no  TEXT,                 -- State Medical Council reg no
    join_date       DATE,
    salary          REAL DEFAULT 0,
    bank_account    TEXT,
    pan             TEXT,
    pf_number       TEXT,
    phone           TEXT,
    address         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS payroll (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id      INTEGER NOT NULL,
    month            TEXT NOT NULL,
    basic            REAL DEFAULT 0,
    hra              REAL DEFAULT 0,
    da               REAL DEFAULT 0,
    other_allowances REAL DEFAULT 0,
    pf_deduction     REAL DEFAULT 0,
    tax_deduction    REAL DEFAULT 0,
    other_deductions REAL DEFAULT 0,
    net_salary       REAL DEFAULT 0,
    status           TEXT DEFAULT 'pending',
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employee_id, month)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    title    TEXT NOT NULL,
    message  TEXT NOT NULL,
    type     TEXT DEFAULT 'app',
    audience TEXT DEFAULT 'all',
    sent_by  INTEGER,
    sent_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS user_notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    notification_id INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    is_read         INTEGER DEFAULT 0,
    read_at         DATETIME,
    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(notification_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS batches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    course        TEXT DEFAULT 'MBBS',
    department    TEXT,
    academic_year TEXT,
    mbbs_year     INTEGER,
    semester      INTEGER,
    start_date    DATE,
    end_date      DATE,
    capacity      INTEGER DEFAULT 150,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS batch_students (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id        INTEGER NOT NULL,
    student_user_id INTEGER NOT NULL,
    enrolled_on     DATE DEFAULT CURRENT_DATE,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(batch_id, student_user_id)
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_user_id INTEGER NOT NULL,
    course_code     TEXT NOT NULL,
    date            DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'present',
    session_type    TEXT DEFAULT 'theory',    -- theory / practical / clinical / ward
    marked_by       INTEGER,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(student_user_id, course_code, date, session_type)
  );

  CREATE TABLE IF NOT EXISTS exam_schedules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    course_code   TEXT,
    exam_type     TEXT DEFAULT 'Theory',    -- Theory / Practical / Viva / OSCE
    professional  TEXT,                     -- 1st Prof / 2nd Prof / 3rd Prof Part-1 / Final
    exam_date     DATE,
    exam_time     TEXT,
    duration_mins INTEGER DEFAULT 180,
    room          TEXT,
    total_marks   INTEGER DEFAULT 100,
    passing_marks INTEGER DEFAULT 50,
    academic_year TEXT,
    created_by    INTEGER,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS results (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_user_id INTEGER NOT NULL,
    exam_id         INTEGER NOT NULL,
    marks_obtained  REAL DEFAULT 0,
    grade           TEXT,
    remarks         TEXT,
    published       INTEGER DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    UNIQUE(student_user_id, exam_id)
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    role       TEXT,
    department TEXT,
    phone      TEXT,
    email      TEXT,
    address    TEXT,
    tags       TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS study_materials (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    course_code TEXT,
    file_name   TEXT,
    file_type   TEXT,
    file_size   INTEGER,
    file_data   TEXT,
    uploaded_by INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT UNIQUE NOT NULL,
    color      TEXT DEFAULT '#1A73E8',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    title      TEXT NOT NULL,
    url        TEXT NOT NULL,
    notes      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  INTEGER,
    details    TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_code    TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    category      TEXT,
    brand         TEXT,
    model         TEXT,
    serial_no     TEXT,
    purchase_date DATE,
    purchase_cost REAL DEFAULT 0,
    location      TEXT,
    assigned_to   INTEGER,
    status        TEXT DEFAULT 'active',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS library_books (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    isbn       TEXT,
    title      TEXT NOT NULL,
    author     TEXT,
    publisher  TEXT,
    category   TEXT,
    edition    TEXT,
    copies     INTEGER DEFAULT 1,
    available  INTEGER DEFAULT 1,
    rack_no    TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS library_issues (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    issue_date  DATE DEFAULT CURRENT_DATE,
    due_date    DATE,
    return_date DATE,
    fine        REAL DEFAULT 0,
    status      TEXT DEFAULT 'issued',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES library_books(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS store_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    category     TEXT,
    unit         TEXT DEFAULT 'pcs',
    quantity     INTEGER DEFAULT 0,
    min_quantity INTEGER DEFAULT 5,
    unit_price   REAL DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS store_transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id    INTEGER NOT NULL,
    type       TEXT NOT NULL,
    quantity   INTEGER NOT NULL,
    notes      TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES store_items(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS hostel_rooms (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_no     TEXT UNIQUE NOT NULL,
    block       TEXT,
    floor       INTEGER,
    capacity    INTEGER DEFAULT 2,
    occupied    INTEGER DEFAULT 0,
    room_type   TEXT DEFAULT 'sharing',
    gender      TEXT DEFAULT 'boys',
    monthly_fee REAL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hostel_allotments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id         INTEGER NOT NULL,
    student_user_id INTEGER NOT NULL,
    allotment_date  DATE DEFAULT CURRENT_DATE,
    vacate_date     DATE,
    status          TEXT DEFAULT 'active',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES hostel_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transport_routes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    route_no     TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    vehicle_no   TEXT,
    driver_name  TEXT,
    driver_phone TEXT,
    stops        TEXT,
    monthly_fee  REAL DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transport_allotments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id        INTEGER NOT NULL,
    student_user_id INTEGER NOT NULL,
    stop_name       TEXT,
    allotment_date  DATE DEFAULT CURRENT_DATE,
    status          TEXT DEFAULT 'active',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (route_id) REFERENCES transport_routes(id) ON DELETE CASCADE,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS online_exams (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    course_code   TEXT,
    duration_mins INTEGER DEFAULT 60,
    total_marks   INTEGER DEFAULT 50,
    passing_marks INTEGER DEFAULT 20,
    instructions  TEXT,
    start_time    DATETIME,
    end_time      DATETIME,
    status        TEXT DEFAULT 'draft',
    created_by    INTEGER,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS online_exam_questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id        INTEGER NOT NULL,
    question       TEXT NOT NULL,
    option_a       TEXT,
    option_b       TEXT,
    option_c       TEXT,
    option_d       TEXT,
    correct_option TEXT,
    marks          INTEGER DEFAULT 1,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES online_exams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS online_exam_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id      INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    answers      TEXT,
    score        REAL DEFAULT 0,
    submitted_at DATETIME,
    status       TEXT DEFAULT 'pending',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES online_exams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(exam_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS lectures (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    course_code    TEXT,
    faculty_id     INTEGER,
    batch_id       INTEGER,
    lecture_date   DATE,
    start_time     TEXT,
    end_time       TEXT,
    topic          TEXT,
    description    TEXT,
    recording_url  TEXT,
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS lms_courses (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    title          TEXT NOT NULL,
    description    TEXT,
    category       TEXT,
    instructor_id  INTEGER,
    duration_hours REAL DEFAULT 0,
    status         TEXT DEFAULT 'draft',
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS lms_modules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id  INTEGER NOT NULL,
    title      TEXT NOT NULL,
    content    TEXT,
    video_url  TEXT,
    order_no   INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES lms_courses(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lms_enrollments (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id            INTEGER NOT NULL,
    course_id          INTEGER NOT NULL,
    completed_modules  INTEGER DEFAULT 0,
    enrolled_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES lms_courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id)
  );

  CREATE TABLE IF NOT EXISTS placement_drives (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company      TEXT NOT NULL,            -- Hospital / Institute name
    role         TEXT NOT NULL,            -- Junior Resident / Fellowship / MO
    description  TEXT,
    package_lpa  REAL,
    eligibility  TEXT,
    drive_date   DATE,
    last_date    DATE,
    location     TEXT,
    status       TEXT DEFAULT 'open',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS placement_applications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    drive_id        INTEGER NOT NULL,
    student_user_id INTEGER NOT NULL,
    status          TEXT DEFAULT 'applied',
    applied_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (drive_id) REFERENCES placement_drives(id) ON DELETE CASCADE,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(drive_id, student_user_id)
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    remind_at   DATETIME NOT NULL,
    repeat      TEXT DEFAULT 'none',
    is_done     INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_reports (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL,
    report_date    DATE NOT NULL,
    title          TEXT NOT NULL,
    activities     TEXT,
    challenges     TEXT,
    plan_tomorrow  TEXT,
    submitted_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, report_date)
  );

  CREATE TABLE IF NOT EXISTS clients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    company        TEXT,
    industry       TEXT,
    contact_person TEXT,
    phone          TEXT,
    email          TEXT,
    address        TEXT,
    status         TEXT DEFAULT 'active',
    notes          TEXT,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    title            TEXT NOT NULL,
    type             TEXT DEFAULT 'email',
    description      TEXT,
    target_audience  TEXT,
    start_date       DATE,
    end_date         DATE,
    budget           REAL DEFAULT 0,
    leads_generated  INTEGER DEFAULT 0,
    conversions      INTEGER DEFAULT 0,
    status           TEXT DEFAULT 'planned',
    created_by       INTEGER,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    type        TEXT DEFAULT 'biometric',
    location    TEXT,
    ip_address  TEXT,
    status      TEXT DEFAULT 'active',
    last_sync   DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL,
    module     TEXT NOT NULL,
    can_view   INTEGER DEFAULT 1,
    can_create INTEGER DEFAULT 0,
    can_edit   INTEGER DEFAULT 0,
    can_delete INTEGER DEFAULT 0,
    UNIQUE(role, module)
  );

  CREATE TABLE IF NOT EXISTS fee_structures (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    course       TEXT DEFAULT 'MBBS',
    department   TEXT,
    mbbs_year    INTEGER,
    semester     INTEGER,
    academic_year TEXT,
    tuition_fee  REAL DEFAULT 0,
    hostel_fee   REAL DEFAULT 0,
    transport_fee REAL DEFAULT 0,
    library_fee  REAL DEFAULT 0,
    lab_fee      REAL DEFAULT 0,
    other_fee    REAL DEFAULT 0,
    total_fee    REAL DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS timetable (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id    INTEGER,
    day         TEXT NOT NULL,
    period      INTEGER NOT NULL,
    start_time  TEXT,
    end_time    TEXT,
    course_code TEXT,
    faculty_id  INTEGER,
    room        TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── CLINICAL POSTINGS (Medical College) ───────────────────────────────────
  CREATE TABLE IF NOT EXISTS clinical_postings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id        INTEGER,
    student_user_id INTEGER,
    department_id   INTEGER,
    department      TEXT,
    ward            TEXT,
    shift           TEXT DEFAULT 'morning',    -- morning / evening / night
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    supervisor_id   INTEGER,
    status          TEXT DEFAULT 'scheduled',  -- scheduled / ongoing / completed / cancelled
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
    FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── CASE LOGBOOK (Clinical cases seen by student) ─────────────────────────
  CREATE TABLE IF NOT EXISTS case_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_user_id INTEGER NOT NULL,
    case_date       DATE NOT NULL,
    patient_code    TEXT,                   -- anonymised: "IPD-1234" / "OPD-56"
    age             INTEGER,
    gender          TEXT,
    department      TEXT,
    ward            TEXT,
    chief_complaint TEXT,
    diagnosis       TEXT,
    management      TEXT,
    learning_points TEXT,
    supervisor_id   INTEGER,
    status          TEXT DEFAULT 'pending',  -- pending / verified / rejected
    verified_by     INTEGER,
    verified_at     DATETIME,
    remarks         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── PROCEDURE LOGBOOK (Skills/procedures done) ────────────────────────────
  CREATE TABLE IF NOT EXISTS procedure_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_user_id INTEGER NOT NULL,
    procedure_date  DATE NOT NULL,
    procedure_name  TEXT NOT NULL,
    department      TEXT,
    patient_code    TEXT,
    level           TEXT DEFAULT 'observed', -- observed / assisted / performed
    supervisor_id   INTEGER,
    status          TEXT DEFAULT 'pending',
    verified_by     INTEGER,
    verified_at     DATETIME,
    remarks         TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (supervisor_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
  );
`);

// ─────────────────────────────────────────────────────────────────────────────
// SEED  (Medical college sample data)
// ─────────────────────────────────────────────────────────────────────────────
function seed() {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;

  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, role, full_name, email) VALUES (?, ?, ?, ?, ?)`
  );
  const seedUsers = [
    ['admin',     'admin123',     'admin',     'System Administrator',     'admin@jjmmc.edu.in'],
    ['principal', 'principal123', 'principal', 'Dr. Anand Kulkarni (Dean)', 'dean@jjmmc.edu.in'],
    ['faculty',   'faculty123',   'faculty',   'Dr. R. Sharma, MD (Medicine)', 'rsharma@jjmmc.edu.in'],
    ['faculty2',  'faculty123',   'faculty',   'Dr. S. Iyer, MS (Anatomy)',   'siyer@jjmmc.edu.in'],
    ['student',   'student123',   'student',   'Aarav Kulkarni',            'aarav@jjmmc.edu.in'],
    ['student2',  'student123',   'student',   'Priya Mehta',               'priya@jjmmc.edu.in'],
    ['parent',    'parent123',    'parent',    'Mr. Dinesh Kulkarni',       'dkulkarni@gmail.com'],
  ];
  db.transaction((rows) => {
    for (const [u, p, r, n, e] of rows) {
      insertUser.run(u, bcrypt.hashSync(p, 10), r, n, e);
    }
  })(seedUsers);

  const student  = db.prepare('SELECT id FROM users WHERE username = ?').get('student');
  const student2 = db.prepare('SELECT id FROM users WHERE username = ?').get('student2');
  const faculty  = db.prepare('SELECT id FROM users WHERE username = ?').get('faculty');
  const faculty2 = db.prepare('SELECT id FROM users WHERE username = ?').get('faculty2');
  const parent   = db.prepare('SELECT id FROM users WHERE username = ?').get('parent');

  // ── Student profiles (MBBS) ────────────────────────────────────────────────
  db.prepare(
    `INSERT INTO student_profiles
      (user_id,roll_no,university_reg_no,course,mbbs_year,semester,admission_quota,neet_rank,dob,gender,phone,address,blood_group,aadhaar,parent_name,parent_phone)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(student.id, 'MBBS2023021', 'JJMMC/MBBS/2023/021', 'MBBS', 2, 3, 'Govt', 15420, '2005-06-12', 'Male',
        '+91 98765 43210', 'Vidyanagar, Davangere, Karnataka', 'O+', 'XXXX-XXXX-1234', 'Dinesh Patil', '+91 98765 00001');
  db.prepare(
    `INSERT INTO student_profiles
      (user_id,roll_no,university_reg_no,course,mbbs_year,semester,admission_quota,neet_rank,dob,gender,phone,address,blood_group,aadhaar,parent_name,parent_phone)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(student2.id, 'MBBS2022017', 'JJMMC/MBBS/2022/017', 'MBBS', 3, 5, 'Management', 28710, '2004-09-20', 'Female',
        '+91 98765 43211', 'P.B. Road, Davangere, Karnataka', 'A+', 'XXXX-XXXX-5678', 'Ramesh Hegde', '+91 98765 00002');

  // Parent ↔ student link
  db.prepare(
    `INSERT INTO parents (user_id, student_user_id, relation, phone, occupation) VALUES (?,?,?,?,?)`
  ).run(parent.id, student.id, 'Father', '+91 98765 00001', 'Civil Engineer');

  // ── Fee payments ───────────────────────────────────────────────────────────
  const insertPay = db.prepare(`INSERT INTO fee_payments (user_id, fee_type, amount, status, reference) VALUES (?,?,?,?,?)`);
  insertPay.run(student.id,  'Tuition (MBBS Yr 2)', 500000, 'PAID', 'TXN-MBBS-10021');
  insertPay.run(student.id,  'Hostel (Yr 2)',        75000, 'PAID', 'TXN-MBBS-10022');
  insertPay.run(student.id,  'Lab & Library',        25000, 'PAID', 'TXN-MBBS-10023');
  insertPay.run(student.id,  'Exam Fee',              8000, 'PAID', 'TXN-MBBS-10024');
  insertPay.run(student2.id, 'Tuition (MBBS Yr 3)', 500000, 'PAID', 'TXN-MBBS-10025');
  insertPay.run(student2.id, 'Hostel (Yr 3)',        75000, 'PAID', 'TXN-MBBS-10026');

  // ── Employee records ───────────────────────────────────────────────────────
  const insEmp = db.prepare(
    `INSERT INTO employees (user_id, emp_code, department, designation, specialization, qualification, council_reg_no, join_date, salary, phone)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  insEmp.run(faculty.id,  'JJMMC-FAC-0001', 'General Medicine', 'Professor & HOD',    'Internal Medicine', 'MD (General Medicine)', 'KMC/12345', '2012-07-01', 185000, '+91 87654 32109');
  insEmp.run(faculty2.id, 'JJMMC-FAC-0002', 'Anatomy',          'Associate Professor', 'Clinical Anatomy', 'MS (Anatomy)',          'KMC/67890', '2015-08-15', 145000, '+91 87654 32110');
}

// ─────────────────────────────────────────────────────────────────────────────
// PG SEED — idempotent. Runs on every start so existing databases created
// before the PG programme was added get the PG demo accounts automatically.
// ─────────────────────────────────────────────────────────────────────────────
function seedPG() {
  const safe = (label, fn) => {
    try { fn(); } catch (err) { console.warn(`[seedPG] skipped ${label}: ${err.message}`); }
  };

  const pgUsers = [
    ['adminpg',     'adminpg123',     'admin',     'PG Programme Administrator',    'adminpg@jjmmc.edu.in'],
    ['principalpg', 'principalpg123', 'principal', 'Dr. V. Rao (PG Dean)',          'pgdean@jjmmc.edu.in'],
    ['facultypg',   'facultypg123',   'faculty',   'Dr. N. Patel, MD (PG Guide)',   'npatel@jjmmc.edu.in'],
    ['studentpg',   'studentpg123',   'student',   'Dr. Rohit Singh (MD Medicine)', 'rohit.pg@jjmmc.edu.in'],
    ['studentpg2',  'studentpg123',   'student',   'Dr. Neha Gupta (MS Surgery)',   'neha.pg@jjmmc.edu.in'],
    ['parentpg',    'parentpg123',    'parent',    'Mr. Vinod Singh',               'vsingh@gmail.com'],
  ];
  const getUser = db.prepare('SELECT id FROM users WHERE username = ?');
  const insertUserPG = db.prepare(
    `INSERT INTO users (username, password_hash, role, full_name, email, program_level) VALUES (?, ?, ?, ?, ?, 'PG')`
  );
  for (const [u, p, r, n, e] of pgUsers) {
    if (!getUser.get(u)) insertUserPG.run(u, bcrypt.hashSync(p, 10), r, n, e);
  }
  // Make sure every seeded PG account is tagged PG (handy if they existed
  // without program_level from an earlier run).
  db.prepare(
    `UPDATE users SET program_level='PG' WHERE username IN ('adminpg','principalpg','facultypg','studentpg','studentpg2','parentpg')`
  ).run();

  const pgStudent  = getUser.get('studentpg');
  const pgStudent2 = getUser.get('studentpg2');
  const pgFaculty  = getUser.get('facultypg');
  const pgParent   = getUser.get('parentpg');
  if (!pgStudent || !pgStudent2 || !pgFaculty || !pgParent) return;

  safe('student_profiles', () => {
    const hasProfile = db.prepare('SELECT 1 FROM student_profiles WHERE user_id=?');
    const insertProfile = db.prepare(
      `INSERT INTO student_profiles
        (user_id,roll_no,university_reg_no,course,program_level,pg_specialty,department,mbbs_year,semester,admission_quota,dob,gender,phone,address,blood_group,parent_name,parent_phone)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    if (!hasProfile.get(pgStudent.id)) {
      insertProfile.run(pgStudent.id, 'MD2024005', 'JJMMC/MD/2024/005', 'MD (General Medicine)', 'PG', 'General Medicine',
        'General Medicine', 1, 1, 'Govt', '1999-03-14', 'Male',
        '+91 98765 55501', 'Shamanur Road, Davangere, Karnataka', 'B+', 'Vinod Singh', '+91 98765 55601');
    }
    if (!hasProfile.get(pgStudent2.id)) {
      insertProfile.run(pgStudent2.id, 'MS2024008', 'JJMMC/MS/2024/008', 'MS (General Surgery)', 'PG', 'General Surgery',
        'General Surgery', 2, 3, 'Management', '1998-11-05', 'Female',
        '+91 98765 55502', 'Bengaluru, Karnataka', 'O+', 'Suresh Gupta', '+91 98765 55602');
    }
  });

  safe('parents', () => {
    const parentExists = db.prepare('SELECT 1 FROM parents WHERE user_id=?').get(pgParent.id);
    if (!parentExists) {
      db.prepare(`INSERT INTO parents (user_id, student_user_id, relation, phone, occupation) VALUES (?,?,?,?,?)`)
        .run(pgParent.id, pgStudent.id, 'Father', '+91 98765 55601', 'Bank Manager');
    }
  });

  safe('employees', () => {
    const empExists = db.prepare('SELECT 1 FROM employees WHERE user_id=?').get(pgFaculty.id);
    if (!empExists) {
      db.prepare(
        `INSERT INTO employees (user_id, emp_code, department, designation, specialization, qualification, council_reg_no, join_date, salary, phone)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(pgFaculty.id, 'JJMMC-FAC-0003', 'General Medicine', 'PG Guide / Professor',
            'Nephrology', 'DM (Nephrology)', 'KMC/33445', '2016-06-01', 220000, '+91 87654 55555');
    }
  });

  safe('fee_payments', () => {
    const payExists = db.prepare('SELECT 1 FROM fee_payments WHERE reference=?');
    const insertPayPG = db.prepare(`INSERT INTO fee_payments (user_id, fee_type, amount, status, reference) VALUES (?,?,?,?,?)`);
    if (!payExists.get('TXN-PG-20001')) insertPayPG.run(pgStudent.id,  'PG Tuition (MD Yr 1)', 1200000, 'PAID', 'TXN-PG-20001');
    if (!payExists.get('TXN-PG-20002')) insertPayPG.run(pgStudent.id,  'PG Hostel (Yr 1)',      90000,  'PAID', 'TXN-PG-20002');
    if (!payExists.get('TXN-PG-20003')) insertPayPG.run(pgStudent2.id, 'PG Tuition (MS Yr 2)', 1200000, 'PAID', 'TXN-PG-20003');
  });
}

function seedAdminData() {
  // ── School ────────────────────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM schools').get().c === 0) {
    db.prepare(`INSERT INTO schools (code,name,address,phone,email,principal,established)
      VALUES ('JJMMC','J.J.M. Medical College, Davangere','MCC "B" Block, Davangere 577 004, Karnataka, India','+91-8192-231285','erpjjmmc@gmail.com','Dr. Anand Patil (Dean)',1965)`).run();
  }
  // Idempotent sync — keep the school row aligned with current branding even
  // on pre-existing databases that were seeded with the older Pune/MUHS values.
  try {
    db.prepare(`UPDATE schools SET
      name        = 'J.J.M. Medical College, Davangere',
      address     = 'MCC "B" Block, Davangere 577 004, Karnataka, India',
      phone       = '+91-8192-231285',
      email       = 'erpjjmmc@gmail.com',
      principal   = 'Dr. Anand Patil (Dean)',
      established = 1965
      WHERE code='JJMMC' AND (email <> 'erpjjmmc@gmail.com' OR phone <> '+91-8192-231285' OR name <> 'J.J.M. Medical College, Davangere')`).run();
  } catch (_) { /* column may not exist on very old schema */ }

  // ── Medical Departments ───────────────────────────────────────────────────
  // Canonical JJMMC department list (NMC-aligned). This block runs on every
  // start and *synchronises* the departments table to this list: any missing
  // departments are inserted, and any legacy ones (e.g. old "Radiology") are
  // updated in place so existing databases stay in sync with code changes.
  {
    const canonical = [
      // Pre-clinical
      ['ANA', 'Anatomy',                                 'pre-clinical', 'Dr. S. Iyer'],
      ['BIO', 'Biochemistry',                            'pre-clinical', 'Dr. M. Gokhale'],
      ['PHY', 'Physiology',                              'pre-clinical', 'Dr. V. Deshpande'],
      // Para-clinical
      ['MIC', 'Microbiology',                            'para-clinical','Dr. L. Joshi'],
      ['PHM', 'Pharmacology',                            'para-clinical','Dr. N. Rao'],
      ['PAT', 'Pathology',                               'para-clinical','Dr. K. Patil'],
      ['FMT', 'Forensic Medicine',                       'para-clinical','Dr. R. Desai'],
      ['CMD', 'Community Medicine',                      'para-clinical','Dr. P. Shinde'],
      // Clinical
      ['ENT', 'E.N.T',                                   'clinical',     'Dr. V. Bhosale'],
      ['OPH', 'Ophthalmology',                           'clinical',     'Dr. B. Chavan'],
      ['MED', 'General Medicine',                        'clinical',     'Dr. R. Sharma'],
      ['SUR', 'General Surgery',                         'clinical',     'Dr. A. Joshi'],
      ['ORT', 'Orthopaedics',                            'clinical',     'Dr. D. Mane'],
      ['ANE', 'Anaesthesiology',                         'clinical',     'Dr. N. Phadke'],
      ['OBG', 'Obstetrics & Gynaecology',                'clinical',     'Dr. S. Kulkarni'],
      ['PED', 'Pediatrics',                              'clinical',     'Dr. H. Pawar'],
      ['PSY', 'Psychiatry',                              'clinical',     'Dr. U. Pandit'],
      ['RAD', 'Radiodiagnosis',                          'clinical',     'Dr. S. Agashe'],
      ['DER', 'Dermatology, Venereology & Leprosy',      'clinical',     'Dr. K. Naik'],
      ['PUL', 'Pulmonary Medicine',                      'clinical',     'Dr. T. Kamble'],
      ['EME', 'Emergency Medicine',                      'clinical',     'Dr. Y. Shetty'],
      ['NEO', 'Neonatology',                             'clinical',     'Dr. R. Kale'],
      // Medical Education Unit
      ['MEU', 'Medical Education Unit',                  'med-edu',      'Dr. S. Karnik'],
    ];

    const upsert = db.prepare(`
      INSERT INTO departments (code, name, category, hod) VALUES (?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        name     = excluded.name,
        category = excluded.category,
        hod      = COALESCE(excluded.hod, departments.hod)
    `);
    db.transaction(() => {
      for (const row of canonical) upsert.run(...row);
    })();
  }

  // ── Subjects (MBBS CBME curriculum) ───────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM courses').get().c === 0) {
    const c = db.prepare(`INSERT INTO courses (code,name,department,mbbs_year,semester,credits) VALUES (?,?,?,?,?,?)`);
    [
      // MBBS Year 1
      ['ANAT101','Human Anatomy',        'Anatomy',         1, 1, 8],
      ['PHYS101','Human Physiology',     'Physiology',      1, 1, 8],
      ['BIOC101','Biochemistry',         'Biochemistry',    1, 1, 6],
      ['AETC101','AETCOM Module 1',      'Community Medicine', 1, 1, 2],
      // MBBS Year 2
      ['PATH201','General Pathology',    'Pathology',       2, 3, 8],
      ['PHAR201','Pharmacology',         'Pharmacology',    2, 3, 8],
      ['MICR201','Microbiology',         'Microbiology',    2, 3, 6],
      ['FRMD201','Forensic Medicine',    'Forensic Medicine', 2, 3, 3],
      ['CMD201', 'Community Medicine I', 'Community Medicine', 2, 3, 3],
      // MBBS Year 3 Part 1
      ['CMD301', 'Community Medicine II','Community Medicine', 3, 5, 4],
      ['ENT301', 'E.N.T',                'E.N.T',                     3, 5, 4],
      ['OPH301', 'Ophthalmology',        'Ophthalmology',   3, 5, 4],
      // MBBS Year 3 Part 2 / Year 4
      ['MED401','General Medicine',      'General Medicine',4, 7, 10],
      ['SUR401','General Surgery',       'General Surgery', 4, 7, 10],
      ['OBG401','Obstetrics & Gynaecology','Obstetrics & Gynaecology', 4, 7, 8],
      ['PED401','Pediatrics',            'Pediatrics',      4, 7, 6],
      ['ORT401','Orthopaedics',          'Orthopaedics',    4, 7, 4],
    ].forEach(r => c.run(...r));
  }

  // ── Notices ───────────────────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM notices').get().c === 0) {
    const admin = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
    const n = db.prepare(`INSERT INTO notices (title,body,audience,created_by) VALUES (?,?,?,?)`);
    [
      ['Welcome to JJMMC Medical College Portal',
       'Online portal is now live for Students, Parents, Faculty and Administration. Please log in with your credentials.',
       'all', admin?.id],
      ['2nd Professional MBBS Theory Examination Schedule',
       'Pathology, Pharmacology & Microbiology exams begin 15-May-2026. Detailed timetable on the Exam Schedule page.',
       'student', admin?.id],
      ['NMC Inspection — 12 May 2026',
       'All HODs to submit CBME logbook compliance reports by 05-May-2026.',
       'faculty', admin?.id],
      ['Clinical Postings Rotation — April batch',
       'Year-3 & Year-4 MBBS students — revised ward allocation published. Check your Clinical Postings tab.',
       'student', admin?.id],
      ['CME: "Recent Advances in Cardiology"',
       'On 28-Apr-2026 at Auditorium Block-A. Registration compulsory for faculty.',
       'faculty', admin?.id],
    ].forEach(r => n.run(...r));
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  // Canonical institution settings. Upserted on every start so older databases
  // with MUHS/Pune values get migrated to Davangere/RGUHS automatically.
  {
    const upsertS = db.prepare(
      `INSERT INTO settings (key,value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
    const canonicalOverride = [
      ['institution_name',    'J.J.M. Medical College, Davangere'],
      ['institution_short',   'JJMMC'],
      ['institution_type',    'Medical College (MBBS)'],
      ['institution_address', 'MCC "B" Block, Davangere 577 004, Karnataka, India'],
      ['institution_phone',   '+91-8192-231285'],
      ['institution_city',    'Davangere'],
      ['institution_state',   'Karnataka'],
      ['affiliated_to',       'Rajiv Gandhi University of Health Sciences (RGUHS), Bangalore'],
      ['recognised_by',       'National Medical Commission (NMC)'],
      ['established_year',    '1965'],
      ['institution_email',   'erpjjmmc@gmail.com'],
      ['support_email',       'erpjjmmc@gmail.com'],
    ];
    const defaultsIfMissing = [
      ['academic_year',    '2026-2027'],
      ['maintenance_mode', 'off'],
      ['sms_provider',     'none'],
      ['timezone',         'Asia/Kolkata'],
      ['currency',         'INR'],
      ['session_timeout',  '480'],
      ['max_login_attempts','5'],
      ['two_factor_auth',  'off'],
      ['min_attendance_pct','75'],
    ];
    const getS = db.prepare('SELECT value FROM settings WHERE key=?');
    const insS = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
    for (const [k, v] of canonicalOverride) upsertS.run(k, v);
    for (const [k, v] of defaultsIfMissing) if (!getS.get(k)) insS.run(k, v);
  }

  // ── Batches (MBBS admission-year batches) ─────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM batches').get().c === 0) {
    const b = db.prepare(`INSERT INTO batches (code,name,course,department,academic_year,mbbs_year,semester,start_date,end_date,capacity) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    [
      ['MBBS-2025', 'MBBS Batch 2025 (Year 1)', 'MBBS', 'Pre-clinical',  '2025-2026', 1, 1, '2025-08-01', '2026-07-31', 150],
      ['MBBS-2024', 'MBBS Batch 2024 (Year 2)', 'MBBS', 'Para-clinical', '2025-2026', 2, 3, '2024-08-01', '2026-01-31', 150],
      ['MBBS-2023', 'MBBS Batch 2023 (Year 2)', 'MBBS', 'Para-clinical', '2026-2027', 2, 3, '2023-08-01', '2027-07-31', 150],
      ['MBBS-2022', 'MBBS Batch 2022 (Year 3)', 'MBBS', 'Clinical',      '2026-2027', 3, 5, '2022-08-01', '2027-07-31', 150],
      ['MBBS-2021', 'MBBS Batch 2021 (Year 4)', 'MBBS', 'Clinical',      '2026-2027', 4, 7, '2021-08-01', '2026-07-31', 150],
      ['MBBS-2020', 'MBBS Batch 2020 (Intern)', 'MBBS', 'Internship',    '2026-2027', 5, 9, '2020-08-01', '2026-07-31', 150],
    ].forEach(r => b.run(...r));

    const b23 = db.prepare('SELECT id FROM batches WHERE code=?').get('MBBS-2023');
    const b22 = db.prepare('SELECT id FROM batches WHERE code=?').get('MBBS-2022');
    const s1 = db.prepare('SELECT id FROM users WHERE username=?').get('student');
    const s2 = db.prepare('SELECT id FROM users WHERE username=?').get('student2');
    if (b23 && s1) db.prepare('INSERT OR IGNORE INTO batch_students (batch_id,student_user_id) VALUES (?,?)').run(b23.id, s1.id);
    if (b22 && s2) db.prepare('INSERT OR IGNORE INTO batch_students (batch_id,student_user_id) VALUES (?,?)').run(b22.id, s2.id);

    // Update student profile batch_id
    if (b23 && s1) db.prepare('UPDATE student_profiles SET batch_id=? WHERE user_id=?').run(b23.id, s1.id);
    if (b22 && s2) db.prepare('UPDATE student_profiles SET batch_id=? WHERE user_id=?').run(b22.id, s2.id);
  }

  // ── Exam schedules (Professional exams) ───────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM exam_schedules').get().c === 0) {
    const admin = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
    const e = db.prepare(`INSERT INTO exam_schedules
      (title,course_code,exam_type,professional,exam_date,exam_time,duration_mins,room,total_marks,passing_marks,academic_year,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    [
      ['Pathology Theory Paper I',  'PATH201','Theory',    '2nd Prof','2026-05-15','10:00',180,'Exam Hall A',100,50,'2026-2027',admin?.id],
      ['Pathology Theory Paper II', 'PATH201','Theory',    '2nd Prof','2026-05-17','10:00',180,'Exam Hall A',100,50,'2026-2027',admin?.id],
      ['Pharmacology Theory',       'PHAR201','Theory',    '2nd Prof','2026-05-20','10:00',180,'Exam Hall B',100,50,'2026-2027',admin?.id],
      ['Pharmacology Practical',    'PHAR201','Practical', '2nd Prof','2026-05-25','09:00',240,'Pharma Lab', 50, 25,'2026-2027',admin?.id],
      ['Microbiology Theory',       'MICR201','Theory',    '2nd Prof','2026-05-22','10:00',180,'Exam Hall A',100,50,'2026-2027',admin?.id],
      ['Medicine End-Posting Viva', 'MED401', 'Viva',      '3rd Prof Part-2','2026-06-10','14:00',60,'Medicine Dept',50,25,'2026-2027',admin?.id],
    ].forEach(r => e.run(...r));

    const stu = db.prepare('SELECT id FROM users WHERE username=?').get('student');
    const stu2= db.prepare('SELECT id FROM users WHERE username=?').get('student2');
    const exams = db.prepare('SELECT id FROM exam_schedules ORDER BY id').all();
    const r = db.prepare(`INSERT OR IGNORE INTO results (student_user_id,exam_id,marks_obtained,grade,published) VALUES (?,?,?,?,?)`);
    if (stu)  { r.run(stu.id,  exams[0]?.id, 72, 'B+',1); r.run(stu.id,  exams[2]?.id, 68, 'B', 1); r.run(stu.id,  exams[4]?.id, 78, 'A', 1); }
    if (stu2) { r.run(stu2.id, exams[5]?.id, 42, 'A', 1); }
  }

  // ── Library books (Medical textbooks) ─────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM library_books').get().c === 0) {
    const b = db.prepare(`INSERT INTO library_books (isbn,title,author,publisher,category,edition,copies,available,rack_no) VALUES (?,?,?,?,?,?,?,?,?)`);
    [
      ['978-0323393041', "Gray's Anatomy for Students",             'Drake, Vogl & Mitchell', 'Elsevier',      'Anatomy',        '4th',  12, 8, 'R-A1'],
      ['978-9354653148', 'BD Chaurasia Human Anatomy Vol 1',         'B. D. Chaurasia',        'CBS Publishers','Anatomy',        '9th',  15,10, 'R-A2'],
      ['978-9355653635', 'Guyton & Hall Textbook of Medical Physiology','J. Hall',            'Elsevier',      'Physiology',     '14th', 10, 7, 'R-A3'],
      ['978-9352700950', 'Harper’s Illustrated Biochemistry',        'Murray et al',           'McGraw-Hill',   'Biochemistry',   '31st', 8,  6, 'R-B1'],
      ['978-0323531139', 'Robbins Basic Pathology',                  'Kumar, Abbas, Aster',    'Elsevier',      'Pathology',      '10th', 14,10, 'R-B2'],
      ['978-9352709410', 'KD Tripathi Essentials of Medical Pharmacology','K. D. Tripathi',   'Jaypee',        'Pharmacology',   '8th',  20,14, 'R-B3'],
      ['978-8131263655', 'Ananthanarayan & Paniker Textbook of Microbiology','Paniker CKJ',  'Universities Press','Microbiology','11th',10, 7, 'R-C1'],
      ['978-9389587166', "Park's Textbook of Preventive & Social Medicine",'K. Park',         'Banarsidas Bhanot','Community Medicine','27th',18,12,'R-C2'],
      ['978-1260464504', "Harrison's Principles of Internal Medicine",'Jameson et al',         'McGraw-Hill',   'Medicine',       '21st',  6, 4, 'R-D1'],
      ['978-0702083884', 'Davidson’s Principles and Practice of Medicine','Ralston et al',    'Elsevier',      'Medicine',       '24th', 10, 7, 'R-D2'],
      ['978-1498796507', 'Bailey & Love’s Short Practice of Surgery', 'Williams et al',        'CRC Press',     'Surgery',        '28th',  8, 5, 'R-D3'],
      ['978-9352705856', 'Ghai Essential Pediatrics',                 'Paul & Bagga',           'CBS Publishers','Pediatrics',     '9th',  10, 8, 'R-E1'],
      ['978-9389034561', 'Dutta’s Textbook of Obstetrics',            'D. C. Dutta',            'Jaypee',        'Obstetrics & Gynae','10th',8,5, 'R-E2'],
      ['978-0323795159', 'Nelson Textbook of Pediatrics',             'Kliegman et al',         'Elsevier',      'Pediatrics',     '22nd',  4, 3, 'R-E3'],
    ].forEach(r => b.run(...r));
  }

  // ── Hostel rooms (Boys/Girls blocks) ──────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM hostel_rooms').get().c === 0) {
    const r = db.prepare(`INSERT INTO hostel_rooms (room_no,block,floor,capacity,occupied,room_type,gender,monthly_fee) VALUES (?,?,?,?,?,?,?,?)`);
    [
      ['B-101','Boys-A', 1,3,2,'triple-sharing','boys', 6500],
      ['B-102','Boys-A', 1,3,0,'triple-sharing','boys', 6500],
      ['B-201','Boys-A', 2,2,1,'twin-sharing', 'boys', 8000],
      ['B-202','Boys-A', 2,2,0,'twin-sharing', 'boys', 8000],
      ['G-101','Girls-B',1,3,2,'triple-sharing','girls',6500],
      ['G-102','Girls-B',1,3,0,'triple-sharing','girls',6500],
      ['G-201','Girls-B',2,2,1,'twin-sharing', 'girls',8000],
      ['I-301','Interns-C',3,1,1,'single',     'boys',12000],
      ['I-302','Interns-C',3,1,0,'single',     'girls',12000],
    ].forEach(r2 => r.run(...r2));
    const room = db.prepare('SELECT id FROM hostel_rooms WHERE room_no=?').get('B-101');
    const stu  = db.prepare('SELECT id FROM users WHERE username=?').get('student');
    if (room && stu) db.prepare(`INSERT OR IGNORE INTO hostel_allotments (room_id,student_user_id,allotment_date,status) VALUES (?,?,?,?)`).run(room.id, stu.id, '2025-08-01', 'active');
    const room2 = db.prepare('SELECT id FROM hostel_rooms WHERE room_no=?').get('G-201');
    const stu2  = db.prepare('SELECT id FROM users WHERE username=?').get('student2');
    if (room2 && stu2) db.prepare(`INSERT OR IGNORE INTO hostel_allotments (room_id,student_user_id,allotment_date,status) VALUES (?,?,?,?)`).run(room2.id, stu2.id, '2024-08-01', 'active');
  }

  // ── Transport routes (Davangere city & outskirts) ─────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM transport_routes').get().c === 0) {
    const r = db.prepare(`INSERT INTO transport_routes (route_no,name,vehicle_no,driver_name,driver_phone,stops,monthly_fee) VALUES (?,?,?,?,?,?,?)`);
    [
      ['R-01','Vidyanagar → JJMMC Campus','KA-17-AB-1234','Ramesh Kumar',   '+91 99887 76655','Vidyanagar, P.B. Road, Shamanur Rd, MCC Road, Campus Gate', 1200],
      ['R-02','Shamanur → JJMMC Campus',  'KA-17-CD-5678','Suresha Gowda',  '+91 99887 76656','Shamanur, Avaragere, Nittuvalli, MCC B-Block, Campus Gate',1400],
      ['R-03','Harihara → JJMMC Campus',  'KA-17-EF-9012','Mahesh Naik',    '+91 99887 76657','Harihara, Malebennur, Bilichodu, Anagodu, Campus Gate',    1500],
    ].forEach(r2 => r.run(...r2));
  }
  // Idempotent sync for pre-existing Pune-era rows.
  try {
    const up = db.prepare(`UPDATE transport_routes SET name=?, vehicle_no=?, driver_name=?, driver_phone=?, stops=?, monthly_fee=? WHERE route_no=?`);
    up.run('Vidyanagar → JJMMC Campus','KA-17-AB-1234','Ramesh Kumar','+91 99887 76655','Vidyanagar, P.B. Road, Shamanur Rd, MCC Road, Campus Gate',1200,'R-01');
    up.run('Shamanur → JJMMC Campus',  'KA-17-CD-5678','Suresha Gowda','+91 99887 76656','Shamanur, Avaragere, Nittuvalli, MCC B-Block, Campus Gate',1400,'R-02');
    up.run('Harihara → JJMMC Campus',  'KA-17-EF-9012','Mahesh Naik',  '+91 99887 76657','Harihara, Malebennur, Bilichodu, Anagodu, Campus Gate',1500,'R-03');
  } catch (_) {}

  // ── Finance transactions ──────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM transactions').get().c === 0) {
    const admin = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
    const t = db.prepare(`INSERT INTO transactions (type,category,amount,description,transaction_date,created_by) VALUES (?,?,?,?,?,?)`);
    [
      ['income', 'MBBS Fee Collection', 7500000, 'MBBS Yr 1 (150 seats) annual tuition', '2026-01-15', admin?.id],
      ['income', 'MBBS Fee Collection', 7500000, 'MBBS Yr 2 (150 seats) annual tuition', '2026-01-15', admin?.id],
      ['income', 'Hostel Fee',          1200000, 'Hostel collection Q1',                   '2026-02-01', admin?.id],
      ['income', 'OPD Revenue (Teaching Hospital)', 450000, 'OPD Jan 2026',                 '2026-01-31', admin?.id],
      ['income', 'Donation',            200000,  'Alumni endowment — Anatomy Museum',      '2026-02-05', admin?.id],
      ['expense','Faculty Salaries',    1850000, 'Teaching staff salaries Jan 2026',       '2026-01-31', admin?.id],
      ['expense','Medical Consumables', 380000,  'Hospital consumables Jan 2026',          '2026-01-31', admin?.id],
      ['expense','Utilities',           150000,  'Electricity, water, oxygen supply',      '2026-01-31', admin?.id],
      ['expense','Lab Reagents',         95000,  'Pathology & Microbiology reagents',      '2026-02-10', admin?.id],
      ['expense','NMC Fee',              50000,  'Annual recognition renewal fee',         '2026-02-15', admin?.id],
    ].forEach(r => t.run(...r));
  }

  // ── Medical Assets ────────────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM assets').get().c === 0) {
    const a = db.prepare(`INSERT INTO assets (asset_code,name,category,brand,model,serial_no,purchase_date,purchase_cost,location,status) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    [
      ['AST-ANAT-001','Dissection Table (stainless steel)','Anatomy Equipment','Kailash','DT-600','KL-A001','2015-05-10',85000,'Dissection Hall','active'],
      ['AST-ANAT-002','Human Skeleton (articulated)',       'Specimen',         'Anatomy Lab','—','SK-2015-05','2015-06-01',45000,'Anatomy Museum','active'],
      ['AST-PATH-001','Binocular Microscope',               'Lab Equipment',    'Olympus','CX23','OL-CX23-01','2022-07-12',120000,'Pathology Lab','active'],
      ['AST-PHY-001', 'Sphygmomanometer (Mercury)',         'Clinical',         'Diamond','Mercury-D','DM-S-045','2020-03-05', 4500,'Physiology Lab','active'],
      ['AST-RAD-001', 'Digital X-Ray Machine',              'Imaging',          'Siemens','Multix','SI-MX-2021-07','2021-11-20',4500000,'Radiology Dept','active'],
      ['AST-RAD-002', 'Ultrasound Machine',                 'Imaging',          'GE Healthcare','Logiq P9','GE-LP9-3312','2022-02-15',3200000,'Radiology Dept','active'],
      ['AST-MED-001', 'Defibrillator',                      'Emergency',        'Philips','HeartStart','PH-HS-0054','2023-01-18',185000,'Emergency Dept','active'],
      ['AST-ANE-001', 'Anaesthesia Workstation',            'OT Equipment',     'Drager','Fabius plus','DR-FP-0021','2020-09-10',1200000,'OT-1','active'],
      ['AST-ICU-001', 'Mechanical Ventilator',              'ICU',              'Philips','V60','PH-V60-0014','2021-04-22',850000,'MICU','active'],
      ['AST-IT-001',  'Dell Laptop (Faculty)',              'IT',               'Dell','Latitude 5420','DL-L54-0091','2023-06-01',75000,'Dean Office','active'],
    ].forEach(r => a.run(...r));
  }

  // ── Store items (medical/hospital supplies) ───────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM store_items').get().c === 0) {
    const s = db.prepare(`INSERT INTO store_items (code,name,category,unit,quantity,min_quantity,unit_price) VALUES (?,?,?,?,?,?,?)`);
    [
      ['STR-001','Disposable Gloves (pair)', 'Consumables',   'pcs', 5000, 500, 8],
      ['STR-002','Surgical Mask (3-ply)',    'PPE',           'pcs', 8000, 1000, 3],
      ['STR-003','Povidone-Iodine 500 ml',   'Antiseptic',    'btl', 120,  20,  180],
      ['STR-004','Hand Sanitizer 500 ml',    'Hygiene',       'btl', 200,  40,  150],
      ['STR-005','Disposable Syringe 5 ml',  'Consumables',   'pcs', 3000, 300, 4],
      ['STR-006','IV Cannula 20G',           'Consumables',   'pcs', 1500, 200, 22],
      ['STR-007','Cotton Roll 400 g',        'Dressing',      'pcs', 80,   15,  95],
      ['STR-008','Gauze Bandage 10 cm',      'Dressing',      'pcs', 250,  50,  28],
      ['STR-009','Paracetamol 500 mg strip', 'Pharmacy',      'strip',500, 100, 12],
      ['STR-010','Microscope Slides (box-50)','Lab Supplies', 'box', 35,   10,  180],
      ['STR-011','A4 Paper Ream',            'Stationery',    'ream',150,  30,  350],
    ].forEach(r => s.run(...r));
  }

  // ── Placement drives — residency / fellowships / jobs ─────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM placement_drives').get().c === 0) {
    const d = db.prepare(`INSERT INTO placement_drives (company,role,description,package_lpa,eligibility,drive_date,last_date,location,status) VALUES (?,?,?,?,?,?,?,?,?)`);
    [
      ['Apollo Hospitals, Mumbai',  'Junior Resident (MBBS)',        'One-year JR post across departments. Stipend + accommodation.', 9.0, 'MBBS graduate, permanent registration','2026-05-20','2026-05-10','Mumbai','open'],
      ['AIIMS Delhi',               'NEET-PG Residency Orientation', 'Information session on NEET-PG prep & AIIMS MD/MS seats.',     0,   'Final-year MBBS / Interns','2026-05-05','2026-05-02','Delhi','open'],
      ['Bapuji Hospital, Davangere','Medical Officer (Casualty)',    'Full-time MO role in Emergency Dept. at a 700-bed teaching hospital.', 8.5, 'MBBS + KMC registration','2026-06-01','2026-05-25','Davangere','open'],
      ['Christian Medical College Vellore','Fellowship in Pediatrics','1-year observership-cum-fellowship program.',                 6.0, 'MBBS + 6 mo clinical','2026-06-15','2026-05-30','Vellore','open'],
      ['Aster DM Healthcare',       'House Surgeon',                 'Compulsory Rotatory Residential Internship post.',             6.5, 'MBBS — internship completion','2026-07-01','2026-06-20','Bengaluru','open'],
    ].forEach(r => d.run(...r));
  }

  // ── Online exam (Pharmacology MCQs) ───────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM online_exams').get().c === 0) {
    const faculty = db.prepare('SELECT id FROM users WHERE username=?').get('faculty');
    db.prepare(`INSERT INTO online_exams (title,course_code,duration_mins,total_marks,passing_marks,instructions,start_time,end_time,status,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        'Pharmacology — ANS Drugs (Practice MCQ)','PHAR201',30,20,10,
        'Read each stem carefully. No negative marking. Best of luck.',
        '2026-04-25 10:00','2026-04-25 12:00','published',faculty?.id);

    const exam = db.prepare('SELECT id FROM online_exams LIMIT 1').get();
    if (exam) {
      const q = db.prepare(`INSERT INTO online_exam_questions (exam_id,question,option_a,option_b,option_c,option_d,correct_option,marks) VALUES (?,?,?,?,?,?,?,?)`);
      q.run(exam.id,'The drug of choice for anaphylactic shock is:','Atropine','Adrenaline (Epinephrine)','Noradrenaline','Dopamine','b',2);
      q.run(exam.id,'Atropine is primarily used to treat:','Hypertension','Organophosphate poisoning','Asthma','Depression','b',2);
      q.run(exam.id,'Propranolol is a:','Selective β1 blocker','Non-selective β blocker','α1 blocker','Calcium channel blocker','b',2);
      q.run(exam.id,'Salbutamol acts primarily on which receptor?','β1','β2','α1','M3','b',2);
      q.run(exam.id,'Which is a cholinesterase inhibitor used in myasthenia gravis?','Neostigmine','Atracurium','Hyoscine','Dobutamine','a',2);
    }
  }

  // ── LMS courses — medical topics ──────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM lms_courses').get().c === 0) {
    const faculty = db.prepare('SELECT id FROM users WHERE username=?').get('faculty');
    const c = db.prepare(`INSERT INTO lms_courses (title,description,category,instructor_id,duration_hours,status) VALUES (?,?,?,?,?,?)`);
    c.run('Clinical ECG Interpretation',         'Stepwise approach to ECG reading for MBBS students.', 'Clinical Skills', faculty?.id, 12, 'published');
    c.run('Basic Life Support (BLS) Refresher',  'AHA-aligned BLS skills for MBBS & interns.',          'Emergency',       faculty?.id, 6,  'published');
    c.run('Clinical Anatomy Revision',           'Applied anatomy relevant for 2nd & 3rd year clinical postings.','Pre-clinical', faculty?.id, 20, 'published');
    c.run('Antibiotic Stewardship',              'Rational use of antibiotics — case-based learning.',  'Pharmacology',    faculty?.id, 8,  'published');

    const courses = db.prepare('SELECT id FROM lms_courses ORDER BY id').all();
    const m = db.prepare(`INSERT INTO lms_modules (course_id,title,content,order_no) VALUES (?,?,?,?)`);
    if (courses[0]) {
      m.run(courses[0].id,'Basics of ECG lead placement',    'Placement of 12 leads & calibration.',1);
      m.run(courses[0].id,'Normal ECG waveforms',            'P, QRS, T waves — normal ranges.',    2);
      m.run(courses[0].id,'Arrhythmia recognition',          'AF, VT, SVT — pattern recognition.',  3);
      m.run(courses[0].id,'MI localisation on ECG',          'ST changes & territory mapping.',     4);
    }
    if (courses[1]) {
      m.run(courses[1].id,'BLS algorithm — adult',           'Chain of survival & CAB approach.',   1);
      m.run(courses[1].id,'CPR compression technique',       'Rate, depth, recoil — hands-on.',     2);
      m.run(courses[1].id,'AED operation',                    'Automated external defibrillator use.',3);
    }
  }

  // ── Devices (Biometrics / RFID at hospital & college) ─────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM devices').get().c === 0) {
    const d = db.prepare(`INSERT INTO devices (device_code,name,type,location,ip_address,status) VALUES (?,?,?,?,?,?)`);
    [
      ['DEV-001','College Main Gate Biometric','biometric','Main Campus Entrance','192.168.10.11','active'],
      ['DEV-002','Hospital OPD Biometric',     'biometric','OPD Block Entrance',  '192.168.10.12','active'],
      ['DEV-003','Anatomy Lab RFID Reader',    'rfid',     'Dissection Hall',     '192.168.10.13','active'],
      ['DEV-004','Library RFID Turnstile',     'rfid',     'Central Library',     '192.168.10.14','active'],
      ['DEV-005','Boys Hostel Biometric',      'biometric','Boys-A Block',        '192.168.10.15','active'],
      ['DEV-006','Girls Hostel Biometric',     'biometric','Girls-B Block',       '192.168.10.16','active'],
      ['DEV-007','OT Access Control',          'biometric','Operation Theatre 1', '192.168.10.17','active'],
    ].forEach(r => d.run(...r));
  }

  // ── Contacts ──────────────────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM contacts').get().c === 0) {
    const c = db.prepare(`INSERT INTO contacts (name,role,department,phone,email) VALUES (?,?,?,?,?)`);
    [
      ['Dr. R. Sharma',   'HOD & Professor', 'General Medicine', '+91 98001 11111','rsharma@jjmmc.edu.in'],
      ['Dr. S. Iyer',     'Associate Prof.', 'Anatomy',          '+91 98001 22222','siyer@jjmmc.edu.in'],
      ['Dr. A. Joshi',    'HOD & Professor', 'General Surgery',  '+91 98001 33333','ajoshi@jjmmc.edu.in'],
      ['Dr. S. Kulkarni', 'HOD & Professor', 'Obstetrics & Gynae','+91 98001 44444','skulkarni@jjmmc.edu.in'],
      ['Ms. P. Kadam',    'Office Supt.',    'Dean Office',      '+91 98001 55555','pkadam@jjmmc.edu.in'],
      ['Mr. A. Pawar',    'Lab Technician',  'Pathology',        '+91 98001 66666','apawar@jjmmc.edu.in'],
      ['Sr. Vimala',      'Nursing Supt.',   'Nursing',          '+91 98001 77777','nursing@jjmmc.edu.in'],
    ].forEach(r => c.run(...r));
  }

  // ── Admission enquiries ───────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM enquiries').get().c === 0) {
    const e = db.prepare(`INSERT INTO enquiries (name,phone,email,course_interest,source,status,notes) VALUES (?,?,?,?,?,?,?)`);
    [
      ['Rohan Desai',  '+91 90001 11111','rohan@email.com','MBBS',         'walk-in',     'follow-up','NEET rank 45210; interested in Management quota'],
      ['Sneha Joshi',  '+91 90001 22222','sneha@email.com','MBBS',         'social-media','new',      'Enquired about NRI seat availability'],
      ['Amit Shah',    '+91 90001 33333','amit@email.com','BDS',           'referral',    'converted','Converted — BDS2026-007'],
      ['Kavya Nair',   '+91 90001 44444','kavya@email.com','B.Sc Nursing', 'website',     'new',      'Called for prospectus'],
      ['Ishaan Reddy', '+91 90001 55555','ishaan@email.com','MBBS',        'counsellor',  'follow-up','Waiting for NEET result'],
    ].forEach(r => e.run(...r));
  }

  // ── Marketing campaigns ───────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM campaigns').get().c === 0) {
    const admin = db.prepare('SELECT id FROM users WHERE username=?').get('admin');
    const c = db.prepare(`INSERT INTO campaigns (title,type,description,target_audience,start_date,end_date,budget,leads_generated,conversions,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    c.run('MBBS Admission 2026-27 (Management Quota)','social','Digital campaign targeting NEET qualifiers', 'NEET-UG qualified students','2026-03-01','2026-07-31',250000,380,95,'active',admin?.id);
    c.run('Free Health Camp — OPD Outreach',           'event', 'Village health camp for community outreach','General public — 30 km radius','2026-04-20','2026-04-22',85000,0,0,'planned',admin?.id);
    c.run('Alumni Reunion 2026 (Diamond Jubilee)',     'email', 'Invite all JJMMC alumni for Diamond Jubilee (60 years since 1965)','Alumni (JJMMC 1970-2025)','2026-05-01','2026-08-15',120000,0,0,'planned',admin?.id);
  }

  // ── Clients (hospital tie-ups, pharma, etc.) ──────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM clients').get().c === 0) {
    const c = db.prepare(`INSERT INTO clients (name,company,industry,contact_person,phone,email,status) VALUES (?,?,?,?,?,?,?)`);
    [
      ['Apollo Partnerships','Apollo Hospitals Mumbai','Healthcare',         'Dr. R. Kumar',   '+91 80000 11111','academics@apollohospitals.com','active'],
      ['Max Healthcare',     'Max Super Speciality',   'Healthcare',         'Dr. M. Nair',    '+91 80000 22222','training@maxhealthcare.com',  'active'],
      ['Pfizer India',       'Pfizer Pharmaceuticals', 'Pharmaceutical',     'Mr. S. Patil',   '+91 80000 33333','research@pfizer.co.in',       'active'],
      ['Cipla R&D',          'Cipla Ltd',              'Pharmaceutical',     'Dr. P. Desai',   '+91 80000 44444','academia@cipla.com',          'active'],
      ['Red Cross — Davangere','Indian Red Cross Society','NGO / Blood Bank', 'Mr. A. Shetty',  '+91 80000 55555','davangere@indianredcross.org','active'],
    ].forEach(r => c.run(...r));
  }

  // ── MBBS Fee structures ───────────────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM fee_structures').get().c === 0) {
    const f = db.prepare(`INSERT INTO fee_structures (name,course,department,mbbs_year,semester,academic_year,tuition_fee,hostel_fee,transport_fee,library_fee,lab_fee,other_fee,total_fee) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    f.run('MBBS Year 1 — Govt Quota',       'MBBS','Pre-clinical', 1,1,'2026-2027',500000,75000,0,10000,15000,8000,608000);
    f.run('MBBS Year 1 — Management Quota','MBBS','Pre-clinical',  1,1,'2026-2027',1200000,75000,0,10000,15000,8000,1308000);
    f.run('MBBS Year 1 — NRI Quota',        'MBBS','Pre-clinical', 1,1,'2026-2027',2500000,100000,0,15000,20000,15000,2650000);
    f.run('MBBS Year 2 — Govt Quota',       'MBBS','Para-clinical',2,3,'2026-2027',500000,75000,0,10000,15000,8000,608000);
    f.run('MBBS Year 3 — Govt Quota',       'MBBS','Clinical',     3,5,'2026-2027',500000,75000,0,10000,10000,10000,605000);
    f.run('MBBS Year 4 — Govt Quota',       'MBBS','Clinical',     4,7,'2026-2027',500000,75000,0,10000,10000,15000,610000);
    f.run('MBBS Internship',                'MBBS','Internship',   5,9,'2026-2027',100000,75000,0,10000,0,25000,210000);
  }

  // ── Clinical Postings — rotation schedule ─────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM clinical_postings').get().c === 0) {
    const batch22 = db.prepare('SELECT id FROM batches WHERE code=?').get('MBBS-2022');
    const batch21 = db.prepare('SELECT id FROM batches WHERE code=?').get('MBBS-2021');
    const stu2    = db.prepare('SELECT id FROM users WHERE username=?').get('student2');
    const fac     = db.prepare('SELECT id FROM users WHERE username=?').get('faculty');
    const med     = db.prepare('SELECT id FROM departments WHERE code=?').get('MED');
    const sur     = db.prepare('SELECT id FROM departments WHERE code=?').get('SUR');
    const obg     = db.prepare('SELECT id FROM departments WHERE code=?').get('OBG');
    const ped     = db.prepare('SELECT id FROM departments WHERE code=?').get('PED');
    const path    = db.prepare('SELECT id FROM departments WHERE code=?').get('PAT');

    const cp = db.prepare(`INSERT INTO clinical_postings (batch_id,student_user_id,department_id,department,ward,shift,start_date,end_date,supervisor_id,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    // Year-3 batch rotation
    cp.run(batch22?.id, null, med?.id, 'General Medicine',       'MICU / General Ward', 'morning',  '2026-04-01','2026-04-30', fac?.id, 'ongoing',   '4-week clinical posting in General Medicine');
    cp.run(batch22?.id, null, sur?.id, 'General Surgery',        'Surgical Ward-1',     'morning',  '2026-05-01','2026-05-30', null,    'scheduled', 'General Surgery 4-week posting');
    cp.run(batch22?.id, null, obg?.id, 'Obstetrics & Gynaecology','Labour Ward',        'morning',  '2026-06-01','2026-06-30', null,    'scheduled', 'OBG posting — labour ward focus');
    cp.run(batch22?.id, null, ped?.id, 'Pediatrics',             'Paeds Ward / NICU',   'morning',  '2026-07-01','2026-07-30', null,    'scheduled', 'Pediatrics — Ward + NICU exposure');
    // Individual student (Priya) additional posting
    cp.run(null, stu2?.id, med?.id, 'General Medicine', 'Cardiology Unit', 'evening', '2026-04-15','2026-04-22', fac?.id, 'ongoing',   'Extra cardiology rotation for Priya Mehta');
    // Year-2 (Aarav) pathology posting
    const stu  = db.prepare('SELECT id FROM users WHERE username=?').get('student');
    cp.run(null, stu?.id, path?.id, 'Pathology', 'Histopathology Lab', 'morning', '2026-04-15','2026-04-28', null, 'ongoing', 'Year-2 Pathology lab posting (14 days)');
  }

  // ── Case logbook sample entries ───────────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM case_logs').get().c === 0) {
    const stu2 = db.prepare('SELECT id FROM users WHERE username=?').get('student2');
    const fac  = db.prepare('SELECT id FROM users WHERE username=?').get('faculty');
    if (stu2) {
      const cl = db.prepare(`INSERT INTO case_logs (student_user_id,case_date,patient_code,age,gender,department,ward,chief_complaint,diagnosis,management,learning_points,supervisor_id,status,verified_by,verified_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      cl.run(stu2.id,'2026-04-02','IPD-1202',58,'Male','General Medicine','MICU',
             'Breathlessness, chest pain on exertion x 2 days',
             'Acute Coronary Syndrome (NSTEMI)',
             'Loaded with Aspirin + Clopidogrel + Atorvastatin. IV Heparin. Cardiology referral.',
             'Time-is-muscle principle; importance of early troponin; door-to-needle targets',
             fac?.id,'verified',fac?.id,'2026-04-03 18:20');
      cl.run(stu2.id,'2026-04-05','OPD-3381',42,'Female','General Medicine','OPD',
             'Polyuria, polydipsia, weight loss x 1 month',
             'Type 2 Diabetes Mellitus (newly diagnosed)',
             'Metformin 500 mg BD, lifestyle modification, dietitian referral.',
             'Diagnostic criteria HbA1c ≥ 6.5%; importance of patient education',
             fac?.id,'verified',fac?.id,'2026-04-06 10:15');
      cl.run(stu2.id,'2026-04-09','IPD-1245',65,'Male','General Medicine','Resp Ward',
             'Productive cough, fever, dyspnoea x 5 days',
             'Community-Acquired Pneumonia (CAP) — CURB-65 score 2',
             'IV Ceftriaxone 1g BD + Azithromycin. O2 via NC 2 L/min. Chest physio.',
             'CURB-65 scoring; empirical antibiotic selection for CAP',
             fac?.id,'pending',null,null);
      cl.run(stu2.id,'2026-04-12','IPD-1263',30,'Female','General Medicine','Ward-3',
             'Acute onset generalised seizure x 1 episode',
             'New-onset seizure — likely idiopathic generalised epilepsy',
             'IV Lorazepam stat. Started on Levetiracetam. Neuro & EEG planned.',
             'Acute seizure management algorithm; EEG & MRI indications',
             null,'pending',null,null);
    }
  }

  // ── Procedure logbook sample entries ──────────────────────────────────────
  if (db.prepare('SELECT COUNT(*) AS c FROM procedure_logs').get().c === 0) {
    const stu2 = db.prepare('SELECT id FROM users WHERE username=?').get('student2');
    const fac  = db.prepare('SELECT id FROM users WHERE username=?').get('faculty');
    if (stu2) {
      const pl = db.prepare(`INSERT INTO procedure_logs (student_user_id,procedure_date,procedure_name,department,patient_code,level,supervisor_id,status,verified_by,verified_at,remarks)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
      pl.run(stu2.id,'2026-04-02','IV Cannulation (20G)',        'General Medicine','IPD-1202','performed', fac?.id,'verified',fac?.id,'2026-04-03 18:25','Successful first attempt — left forearm');
      pl.run(stu2.id,'2026-04-03','Urinary Catheterisation',     'General Medicine','IPD-1202','assisted',  fac?.id,'verified',fac?.id,'2026-04-04 11:00','Assisted resident — male Foley 16Fr');
      pl.run(stu2.id,'2026-04-08','Venous Blood Sampling',       'General Medicine','OPD-3381','performed', fac?.id,'verified',fac?.id,'2026-04-09 09:30','Routine fasting blood sugar sample');
      pl.run(stu2.id,'2026-04-10','Lumbar Puncture',             'General Medicine','IPD-1245','observed',  fac?.id,'pending', null,null,'Observed senior resident perform LP');
      pl.run(stu2.id,'2026-04-12','IV Cannulation (18G)',        'General Medicine','IPD-1263','performed', null,   'pending', null,null,'Emergency cannulation during seizure');
    }
  }

  // ── Idempotent Davangere / RGUHS branding sync ────────────────────────────
  // Runs on every start so databases seeded with older Pune/MUHS data get
  // migrated in place. Safe to re-run — each statement only updates rows that
  // still carry a stale value.
  try {
    db.prepare(`UPDATE student_profiles SET address='Vidyanagar, Davangere, Karnataka' WHERE address='Pune, Maharashtra'`).run();
    db.prepare(`UPDATE student_profiles SET address='Bengaluru, Karnataka'            WHERE address='Mumbai, Maharashtra'`).run();
    db.prepare(`UPDATE student_profiles SET address='Shamanur Road, Davangere, Karnataka' WHERE address='Pune, Maharashtra ' OR address LIKE 'Pune%'`).run();
  } catch (_) {}
  try {
    db.prepare(`UPDATE student_profiles SET parent_name='Dinesh Patil' WHERE parent_name='Dinesh Kulkarni'`).run();
    db.prepare(`UPDATE student_profiles SET parent_name='Ramesh Hegde' WHERE parent_name='Ramesh Mehta'`).run();
  } catch (_) {}
  try {
    db.prepare(`UPDATE employees SET council_reg_no = REPLACE(council_reg_no, 'MMC/', 'KMC/') WHERE council_reg_no LIKE 'MMC/%'`).run();
  } catch (_) {}
  try {
    db.prepare(`UPDATE clients SET name='Red Cross — Davangere', email='davangere@indianredcross.org', contact_person='Mr. A. Shetty' WHERE name='Red Cross — Pune'`).run();
  } catch (_) {}
  try {
    db.prepare(`UPDATE placement_drives SET company='Bapuji Hospital, Davangere', location='Davangere', eligibility=REPLACE(eligibility,'MMC','KMC') WHERE company='Fortis Hospital, Pune'`).run();
  } catch (_) {}
  try {
    db.prepare(`UPDATE campaigns SET title='Alumni Reunion 2026 (Diamond Jubilee)', description='Invite all JJMMC alumni for Diamond Jubilee (60 years since 1965)', target_audience='Alumni (JJMMC 1970-2025)' WHERE title='Alumni Reunion 2026'`).run();
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATIONS — idempotent ALTERs for DBs that were created before new columns
// were added. Each attempt is wrapped in try/catch because better-sqlite3
// throws if the column already exists.
// ─────────────────────────────────────────────────────────────────────────────
function addColumn(table, colDef) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch { /* already exists */ }
}

// IA exams — tag which IA round an exam is (1, 2 or 3) for a Professional
addColumn('exam_schedules', `ia_number INTEGER`);

// Programme tag for every user (UG / PG). Students still resolve through
// student_profiles.program_level, but non-student roles (admin / principal /
// faculty / parent) use this column directly to decide which portal tree to
// serve after login.
addColumn('users', `program_level TEXT DEFAULT 'UG'`);

// Older DBs may be missing medical-college columns added later to `employees`.
[
  `specialization TEXT`,
  `qualification TEXT`,
  `council_reg_no TEXT`,
  `join_date DATE`,
  `salary REAL DEFAULT 0`,
  `bank_account TEXT`,
  `pan TEXT`,
  `pf_number TEXT`,
  `phone TEXT`,
  `address TEXT`,
].forEach((col) => addColumn('employees', col));

// UG / PG + program details on student profiles
addColumn('student_profiles', `program_level TEXT DEFAULT 'UG'`);
addColumn('student_profiles', `pg_specialty TEXT`);

// Older DBs may be missing the medical-college columns that were added to
// student_profiles later. Re-run these idempotently so existing databases
// get upgraded without a manual wipe.
[
  `roll_no TEXT`,
  `university_reg_no TEXT`,
  `course TEXT DEFAULT 'MBBS'`,
  `department TEXT`,
  `batch_id INTEGER`,
  `mbbs_year INTEGER`,
  `semester INTEGER`,
  `admission_quota TEXT`,
  `neet_rank INTEGER`,
  `dob TEXT`,
  `gender TEXT`,
  `phone TEXT`,
  `address TEXT`,
  `blood_group TEXT`,
  `aadhaar TEXT`,
  `parent_name TEXT`,
  `parent_phone TEXT`,
  `photo_url TEXT`,
  `rfid_code TEXT`,
].forEach((col) => addColumn('student_profiles', col));

// Batch hierarchy: parent batch → sub-batches (theory / practical / clinical)
addColumn('batches', `parent_id INTEGER REFERENCES batches(id) ON DELETE CASCADE`);
addColumn('batches', `section_type TEXT DEFAULT 'theory'`);   // theory / practical / clinical / mentor-group
addColumn('batches', `mentor_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);

// Timetable slots come from the time_schedule master when selected
addColumn('timetable', `schedule_slot_id INTEGER REFERENCES time_schedule(id) ON DELETE SET NULL`);
addColumn('timetable', `academic_year TEXT`);
addColumn('timetable', `section_type TEXT`);

// Per-batch faculty (mentor / clinical faculty / lecturer assignments)
db.exec(`
  CREATE TABLE IF NOT EXISTS batch_faculty (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id   INTEGER NOT NULL,
    faculty_id INTEGER NOT NULL,
    role       TEXT DEFAULT 'faculty',          -- mentor / clinical / theory / practical / faculty
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id)   REFERENCES batches(id) ON DELETE CASCADE,
    FOREIGN KEY (faculty_id) REFERENCES users(id)   ON DELETE CASCADE,
    UNIQUE(batch_id, faculty_id, role)
  );

  -- Master list of time slots (9:00-10:00, 10:00-11:00, ...) used by Timetable
  CREATE TABLE IF NOT EXISTS time_schedule (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    period_no     INTEGER NOT NULL,
    label         TEXT,                         -- "P1", "Lunch", "Morning Session"
    start_time    TEXT NOT NULL,                -- "09:00"
    end_time      TEXT NOT NULL,                -- "10:00"
    kind          TEXT DEFAULT 'class',         -- class / break / clinical / practical
    academic_year TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period_no, academic_year)
  );

  -- Generic allocation system: admin assigns a task / patient message / duty
  -- to one of a batch, a student, or a faculty member.
  CREATE TABLE IF NOT EXISTS allocations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT NOT NULL DEFAULT 'task',      -- task / duty / patient_message / announcement / other
    title         TEXT NOT NULL,
    message       TEXT,
    assignee_type TEXT NOT NULL,                     -- batch / student / faculty
    assignee_id   INTEGER,                           -- user_id or batch_id depending on assignee_type
    batch_id      INTEGER,                           -- optional filter-within-batch (for student assignments)
    priority      TEXT DEFAULT 'normal',             -- low / normal / high / urgent
    due_date      DATE,
    status        TEXT DEFAULT 'pending',            -- pending / in-progress / completed / cancelled
    created_by    INTEGER,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (batch_id)   REFERENCES batches(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)   ON DELETE SET NULL
  );
`);

// Seed a default time-schedule grid if empty
if (db.prepare('SELECT COUNT(*) AS c FROM time_schedule').get().c === 0) {
  const ts = db.prepare(`INSERT INTO time_schedule (period_no,label,start_time,end_time,kind,academic_year) VALUES (?,?,?,?,?,?)`);
  const ay = '2026-2027';
  [
    [1,'P1','09:00','10:00','class',ay],
    [2,'P2','10:00','11:00','class',ay],
    [3,'Break','11:00','11:15','break',ay],
    [4,'P3','11:15','12:15','class',ay],
    [5,'P4','12:15','13:15','class',ay],
    [6,'Lunch','13:15','14:00','break',ay],
    [7,'P5','14:00','15:00','clinical',ay],
    [8,'P6','15:00','16:00','clinical',ay],
    [9,'P7','16:00','17:00','practical',ay],
  ].forEach(r => { try { ts.run(...r); } catch {} });
}

seed();
seedAdminData();
seedPG();

module.exports = db;
