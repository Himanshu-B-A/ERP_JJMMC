const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { logActivity } = require('./helpers');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const program = String(req.body?.program || 'UG').toUpperCase();
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' });
  if (program !== 'UG' && program !== 'PG')
    return res.status(400).json({ error: 'program must be UG or PG' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password' });
  if (!user.is_active)
    return res.status(403).json({ error: 'Account is deactivated' });

  // Enforce the UG/PG toggle:
  //  - Students: must match their student_profiles.program_level
  //  - Other roles: must match their users.program_level (defaults to 'UG')
  let expectedProgram = 'UG';
  if (user.role === 'student') {
    const profile = db
      .prepare('SELECT program_level FROM student_profiles WHERE user_id = ?')
      .get(user.id);
    expectedProgram = (profile?.program_level || 'UG').toUpperCase();
  } else {
    expectedProgram = (user.program_level || 'UG').toUpperCase();
  }
  if (expectedProgram !== program) {
    return res.status(401).json({
      error: `This account belongs to the ${expectedProgram} programme. Please switch the toggle to ${expectedProgram} and try again.`,
    });
  }

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  req.session.user = {
    id: user.id, username: user.username,
    role: user.role, full_name: user.full_name, email: user.email,
    program,
  };

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  logActivity(user.id, 'LOGIN', 'users', user.id, `Login from ${ip} (${program})`, ip);

  const suffix = program === 'PG' ? '-pg' : '';
  res.json({ ok: true, user: req.session.user, redirect: `/${user.role}${suffix}/` });
});

router.post('/logout', (req, res) => {
  const uid = req.session?.user?.id;
  req.session.destroy(() => {
    if (uid) logActivity(uid, 'LOGOUT', 'users', uid, 'User logged out');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });

  // Fetch unread notification count
  const unread = db.prepare(
    'SELECT COUNT(*) AS c FROM user_notifications WHERE user_id=? AND is_read=0'
  ).get(req.session.user.id);

  res.json({ user: req.session.user, unread_notifications: unread?.c || 0 });
});

router.put('/me/password', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password)
    return res.status(400).json({ error: 'old_password and new_password required' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.user.id);
  if (!bcrypt.compareSync(old_password, user.password_hash))
    return res.status(401).json({ error: 'Old password is incorrect' });

  db.prepare('UPDATE users SET password_hash=? WHERE id=?')
    .run(bcrypt.hashSync(new_password, 10), user.id);
  logActivity(user.id, 'CHANGE_PASSWORD', 'users', user.id, 'Password changed');
  res.json({ ok: true });
});

module.exports = router;
