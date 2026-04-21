# JJMMC ERP

A starter ERP for JJMMC with role-based login (Admin, Principal, Faculty, Student) and a full Student portal that covers every module you listed.

## Tech stack

- Node.js + Express
- SQLite via `better-sqlite3`
- Session auth with `express-session`
- Passwords hashed with `bcryptjs`
- Vanilla HTML/CSS/JS front-end (dark, modern UI)

## Quick start

```bash
npm install
npm start
```

Then open http://localhost:3000

### Default logins

| Role      | Username    | Password       |
|-----------|-------------|----------------|
| Admin     | `admin`     | `admin123`     |
| Principal | `principal` | `principal123` |
| Faculty   | `faculty`   | `faculty123`   |
| Student   | `student`   | `student123`   |

Users are seeded on first run into `data/erp.db`. Delete the `data/` folder to reset.

## What's included

**Login**
- Role selector (Admin / Principal / Faculty / Student)
- Server rejects mismatched role even with correct credentials

**Student portal** (fully wired end-to-end, data persisted in SQLite)
- Dashboard
- Personal
- Elective Registration
- Feedback
- Log Book
- Transport
- Timetable → Timetable
- Timetable → Attendance
- Exam → Exam Fee
- Exam → Revaluation Application
- IA
- Academic → Teaching & Examination Scheme
- Academic → Circular
- Event
- Hostel
- Mentoring
- Fee → Pay Hostel Fees
- Fee → Pay Fees
- Fee → Fee History
- Study Material
- Other

**Admin / Principal / Faculty**
- Clean starter dashboards protected by role. Extend with module-specific pages.

## Project layout

```
ERP JJMMC/
├── server.js            Express app + APIs
├── db.js                SQLite schema + seed
├── package.json
├── public/              Public static files
│   ├── css/style.css
│   ├── js/student.js
│   └── login.html
└── views/               Role-protected static pages
    ├── admin/index.html
    ├── principal/index.html
    ├── faculty/index.html
    └── student/index.html
```

## Security notes

This is a starter. Before production:

- Change `session.secret` in `server.js` and move it to an env var
- Put Express behind HTTPS and set `cookie.secure = true`
- Add rate limiting on `/api/login`
- Review and harden every API route
