const path    = require('path');
const express = require('express');
const session = require('express-session');
require('./db'); // initialise DB + seed

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'jjmmc-erp-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 },
}));

// ── ROUTES ────────────────────────────────────────────────────────
app.use('/api', require('./routes/auth'));
app.use('/api/admin',     require('./routes/admin'));
app.use('/api/faculty',   require('./routes/faculty'));
app.use('/api/student',   require('./routes/student'));
app.use('/api/parent',    require('./routes/parent'));
app.use('/api/principal', require('./routes/principal'));

// ── ROLE-PROTECTED PAGES ──────────────────────────────────────────
function rolePage(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login.html');
    if (req.session.user.role !== role) return res.redirect(`/${req.session.user.role}/`);
    next();
  };
}

app.use('/admin',     rolePage('admin'),     express.static(path.join(__dirname, 'views', 'admin')));
app.use('/principal', rolePage('principal'), express.static(path.join(__dirname, 'views', 'principal')));
app.use('/faculty',   rolePage('faculty'),   express.static(path.join(__dirname, 'views', 'faculty')));
app.use('/student',   rolePage('student'),   express.static(path.join(__dirname, 'views', 'student')));
app.use('/parent',    rolePage('parent'),    express.static(path.join(__dirname, 'views', 'parent')));

// ── PUBLIC ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect(`/${req.session.user.role}/`);
  res.redirect('/login.html');
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n  JJMMC ERP  →  http://localhost:${PORT}\n`);
  console.log('  Logins:  admin/admin123  |  principal/principal123');
  console.log('           faculty/faculty123  |  student/student123  |  parent/parent123\n');
});
