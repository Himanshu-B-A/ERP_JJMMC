// ---------- Small helpers ----------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function money(n) { return '₹ ' + Number(n || 0).toLocaleString('en-IN'); }
function fmtDate(s) { if (!s) return '-'; const d = new Date(s); return isNaN(d) ? s : d.toLocaleString(); }

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `
    position:fixed; bottom:22px; right:22px; z-index:9999;
    padding:10px 14px; border-radius:10px; font-size:13px; font-weight:600;
    background:${kind === 'err' ? 'rgba(239,68,68,.18)' : 'rgba(16,185,129,.18)'};
    color:${kind === 'err' ? '#fca5a5' : '#86efac'};
    border:1px solid ${kind === 'err' ? '#7f1d1d' : '#065f46'};
    box-shadow:0 10px 30px rgba(0,0,0,.35);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ---------- Topbar ----------
(async function initTopbar() {
  try {
    const { user } = await api('/api/me');
    if (!user) return;
    $('#whoName').textContent = user.full_name;
    $('#whoRole').textContent = user.role;
    $('#avatar').textContent  = (user.full_name || 'A').trim().charAt(0).toUpperCase();
  } catch {}
})();
$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ---------- Router ----------
const routes = {};
function route(name, handler) { routes[name] = handler; }
function setActive(name) {
  $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  const label = $(`#nav a[data-route="${name}"]`);
  $('#crumbs').textContent = label ? label.textContent.trim() : name;
}
async function navigate() {
  const name = (location.hash.replace(/^#\//, '') || 'dashboard');
  const handler = routes[name] || routes['dashboard'];
  setActive(name);
  view.innerHTML = `<div class="empty">Loading…</div>`;
  try { await handler(); }
  catch (err) {
    view.innerHTML = `<div class="card"><h3>Something went wrong</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', navigate);

// ============================================================
// DASHBOARD
// ============================================================
route('dashboard', async () => {
  const { totals, recentUsers } = await api('/api/admin/stats');
  view.innerHTML = `
    <div class="page-title"><h2>Admin Overview</h2>
      <span class="crumbs">Institution at a glance</span>
    </div>
    <div class="grid cols-4">
      <div class="card"><div class="sub">Total Users</div><div class="value">${totals.users}</div></div>
      <div class="card"><div class="sub">Students</div><div class="value">${totals.students}</div></div>
      <div class="card"><div class="sub">Faculty</div><div class="value">${totals.faculty}</div></div>
      <div class="card"><div class="sub">Principals</div><div class="value">${totals.principals}</div></div>
    </div>
    <div class="grid cols-4" style="margin-top:14px">
      <div class="card"><div class="sub">Departments</div><div class="value">${totals.departments}</div></div>
      <div class="card"><div class="sub">Courses</div><div class="value">${totals.courses}</div></div>
      <div class="card"><div class="sub">Notices</div><div class="value">${totals.notices}</div></div>
      <div class="card"><div class="sub">Fees Collected</div><div class="value">${money(totals.fees_paid)}</div>
        <div class="sub">${totals.fee_txns} transactions</div></div>
    </div>

    <div class="grid cols-2" style="margin-top:14px">
      <div class="card">
        <h3>Recent Users</h3>
        <table class="table">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Joined</th></tr></thead>
          <tbody>
            ${recentUsers.map(u => `
              <tr>
                <td>${escapeHtml(u.full_name)}</td>
                <td>${escapeHtml(u.username)}</td>
                <td><span class="badge info">${escapeHtml(u.role)}</span></td>
                <td>${fmtDate(u.created_at)}</td>
              </tr>`).join('') || `<tr><td colspan="4" class="empty">No users yet</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>Quick Actions</h3>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px">
          <a class="btn small" href="#/users">Manage Users</a>
          <a class="btn small secondary" href="#/departments">Departments</a>
          <a class="btn small secondary" href="#/courses">Courses</a>
          <a class="btn small secondary" href="#/notices">Post Notice</a>
          <a class="btn small secondary" href="#/fees">Fee Reports</a>
          <a class="btn small secondary" href="#/settings">Settings</a>
        </div>
      </div>
    </div>
  `;
});

// ============================================================
// USERS
// ============================================================
route('users', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Users</h2>
      <span class="crumbs">Create, edit and remove portal accounts</span>
    </div>

    <div class="card">
      <h3>Add User</h3>
      <form id="userForm">
        <div class="form-row">
          <div class="field"><label>Full name</label><input name="full_name" required /></div>
          <div class="field"><label>Username</label><input name="username" required /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Password</label><input name="password" type="text" placeholder="Initial password" required /></div>
          <div class="field"><label>Role</label>
            <select name="role" required>
              <option value="student">Student</option>
              <option value="faculty">Faculty</option>
              <option value="principal">Principal</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="form-row one">
          <div class="field"><label>Email</label><input name="email" type="email" /></div>
        </div>
        <button class="btn" type="submit">Create user</button>
      </form>
    </div>

    <div class="card" style="margin-top:14px">
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px">
        <input id="userSearch" placeholder="Search name, username or email…" style="flex:1; min-width:220px; padding:9px 12px; background:var(--panel); border:1px solid var(--border); border-radius:10px; color:var(--text)" />
        <select id="userRoleFilter" style="min-width:140px">
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="principal">Principal</option>
          <option value="faculty">Faculty</option>
          <option value="student">Student</option>
        </select>
      </div>
      <div id="usersTable"><div class="empty">Loading…</div></div>
    </div>
  `;

  async function refresh() {
    const q    = $('#userSearch').value.trim();
    const role = $('#userRoleFilter').value;
    const qs   = new URLSearchParams();
    if (q)    qs.set('q', q);
    if (role) qs.set('role', role);
    const { users } = await api('/api/admin/users?' + qs.toString());
    $('#usersTable').innerHTML = `
      <table class="table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Email</th><th>Joined</th><th></th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr data-id="${u.id}">
              <td>${escapeHtml(u.full_name)}</td>
              <td>${escapeHtml(u.username)}</td>
              <td><span class="badge info">${escapeHtml(u.role)}</span></td>
              <td>${escapeHtml(u.email || '-')}</td>
              <td>${fmtDate(u.created_at)}</td>
              <td style="text-align:right">
                <button class="btn small secondary edit-btn" data-id="${u.id}">Edit</button>
                <button class="btn small danger del-btn" data-id="${u.id}">Delete</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="6" class="empty">No users</td></tr>`}
        </tbody>
      </table>
    `;
    $$('#usersTable .del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this user? This cannot be undone.')) return;
      try {
        await api('/api/admin/users/' + b.dataset.id, { method: 'DELETE' });
        toast('User deleted');
        refresh();
      } catch (e) { toast(e.message, 'err'); }
    }));
    $$('#usersTable .edit-btn').forEach(b => b.addEventListener('click', async () => {
      const u = users.find(x => String(x.id) === b.dataset.id);
      const full_name = prompt('Full name:', u.full_name); if (full_name === null) return;
      const email     = prompt('Email:',     u.email || '');
      const role      = prompt('Role (admin|principal|faculty|student):', u.role);
      const password  = prompt('New password (leave blank to keep):', '');
      try {
        await api('/api/admin/users/' + u.id, {
          method: 'PUT',
          body: { full_name, email, role, ...(password ? { password } : {}) },
        });
        toast('User updated');
        refresh();
      } catch (e) { toast(e.message, 'err'); }
    }));
  }

  $('#userForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: Object.fromEntries(fd.entries()),
      });
      toast('User created');
      e.target.reset();
      refresh();
    } catch (err) { toast(err.message, 'err'); }
  });

  let t;
  $('#userSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(refresh, 250); });
  $('#userRoleFilter').addEventListener('change', refresh);
  refresh();
});

// ============================================================
// DEPARTMENTS
// ============================================================
route('departments', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Departments</h2>
      <span class="crumbs">Academic departments and their heads</span>
    </div>

    <div class="card">
      <h3>Add Department</h3>
      <form id="deptForm">
        <div class="form-row">
          <div class="field"><label>Code</label><input name="code" placeholder="e.g. CSE" required /></div>
          <div class="field"><label>Name</label><input name="name" placeholder="Computer Science & Engineering" required /></div>
        </div>
        <div class="form-row one">
          <div class="field"><label>Head of Department</label><input name="hod" /></div>
        </div>
        <button class="btn" type="submit">Add department</button>
      </form>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>All Departments</h3>
      <div id="deptTable"><div class="empty">Loading…</div></div>
    </div>
  `;

  async function refresh() {
    const { items } = await api('/api/admin/departments');
    $('#deptTable').innerHTML = `
      <table class="table">
        <thead><tr><th>Code</th><th>Name</th><th>HOD</th><th>Created</th><th></th></tr></thead>
        <tbody>
          ${items.map(d => `
            <tr>
              <td><strong>${escapeHtml(d.code)}</strong></td>
              <td>${escapeHtml(d.name)}</td>
              <td>${escapeHtml(d.hod || '-')}</td>
              <td>${fmtDate(d.created_at)}</td>
              <td style="text-align:right">
                <button class="btn small danger del-btn" data-id="${d.id}">Delete</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="5" class="empty">No departments</td></tr>`}
        </tbody>
      </table>
    `;
    $$('#deptTable .del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete department?')) return;
      try {
        await api('/api/admin/departments/' + b.dataset.id, { method: 'DELETE' });
        toast('Deleted'); refresh();
      } catch (e) { toast(e.message, 'err'); }
    }));
  }

  $('#deptForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/admin/departments', { method: 'POST', body: fd });
      toast('Department added'); e.target.reset(); refresh();
    } catch (err) { toast(err.message, 'err'); }
  });
  refresh();
});

// ============================================================
// COURSES
// ============================================================
route('courses', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Courses</h2>
      <span class="crumbs">Course catalog across departments</span>
    </div>

    <div class="card">
      <h3>Add Course</h3>
      <form id="courseForm">
        <div class="form-row">
          <div class="field"><label>Code</label><input name="code" placeholder="CSE201" required /></div>
          <div class="field"><label>Name</label><input name="name" placeholder="Data Structures" required /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Department</label><input name="department" placeholder="CSE" /></div>
          <div class="field"><label>Semester</label><input name="semester" type="number" min="1" max="10" /></div>
        </div>
        <div class="form-row one">
          <div class="field"><label>Credits</label><input name="credits" type="number" min="1" max="10" value="3" /></div>
        </div>
        <button class="btn" type="submit">Add course</button>
      </form>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Course Catalog</h3>
      <div id="courseTable"><div class="empty">Loading…</div></div>
    </div>
  `;

  async function refresh() {
    const { items } = await api('/api/admin/courses');
    $('#courseTable').innerHTML = `
      <table class="table">
        <thead><tr><th>Code</th><th>Name</th><th>Dept</th><th>Sem</th><th>Credits</th><th></th></tr></thead>
        <tbody>
          ${items.map(c => `
            <tr>
              <td><strong>${escapeHtml(c.code)}</strong></td>
              <td>${escapeHtml(c.name)}</td>
              <td>${escapeHtml(c.department || '-')}</td>
              <td>${escapeHtml(c.semester || '-')}</td>
              <td>${escapeHtml(c.credits || '-')}</td>
              <td style="text-align:right">
                <button class="btn small danger del-btn" data-id="${c.id}">Delete</button>
              </td>
            </tr>`).join('') || `<tr><td colspan="6" class="empty">No courses</td></tr>`}
        </tbody>
      </table>
    `;
    $$('#courseTable .del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete course?')) return;
      try {
        await api('/api/admin/courses/' + b.dataset.id, { method: 'DELETE' });
        toast('Deleted'); refresh();
      } catch (e) { toast(e.message, 'err'); }
    }));
  }

  $('#courseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/admin/courses', { method: 'POST', body: fd });
      toast('Course added'); e.target.reset(); refresh();
    } catch (err) { toast(err.message, 'err'); }
  });
  refresh();
});

// ============================================================
// NOTICES
// ============================================================
route('notices', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Notices &amp; Circulars</h2>
      <span class="crumbs">Broadcast announcements to a role or everyone</span>
    </div>

    <div class="card">
      <h3>Post Notice</h3>
      <form id="noticeForm">
        <div class="form-row">
          <div class="field"><label>Title</label><input name="title" required /></div>
          <div class="field"><label>Audience</label>
            <select name="audience">
              <option value="all">Everyone</option>
              <option value="student">Students</option>
              <option value="faculty">Faculty</option>
              <option value="principal">Principal</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </div>
        <div class="form-row one">
          <div class="field"><label>Body</label><textarea name="body" required placeholder="Write the announcement…"></textarea></div>
        </div>
        <button class="btn" type="submit">Publish notice</button>
      </form>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Published Notices</h3>
      <div id="noticeList"><div class="empty">Loading…</div></div>
    </div>
  `;

  async function refresh() {
    const { items } = await api('/api/admin/notices');
    $('#noticeList').innerHTML = items.length ? items.map(n => `
      <div class="card" style="margin-top:10px; background:linear-gradient(180deg,#16223b,#121a2e)">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start">
          <div>
            <h3 style="margin:0 0 4px">${escapeHtml(n.title)}</h3>
            <div class="sub">
              <span class="badge info">${escapeHtml(n.audience)}</span>
              · ${fmtDate(n.created_at)}
              ${n.created_by_username ? ` · by ${escapeHtml(n.created_by_username)}` : ''}
            </div>
          </div>
          <button class="btn small danger del-btn" data-id="${n.id}">Delete</button>
        </div>
        <p style="margin:10px 0 0; white-space:pre-wrap">${escapeHtml(n.body)}</p>
      </div>
    `).join('') : `<div class="empty">No notices yet</div>`;

    $$('#noticeList .del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Delete this notice?')) return;
      try {
        await api('/api/admin/notices/' + b.dataset.id, { method: 'DELETE' });
        toast('Deleted'); refresh();
      } catch (e) { toast(e.message, 'err'); }
    }));
  }

  $('#noticeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/admin/notices', { method: 'POST', body: fd });
      toast('Notice published'); e.target.reset(); refresh();
    } catch (err) { toast(err.message, 'err'); }
  });
  refresh();
});

// ============================================================
// FEES OVERVIEW
// ============================================================
route('fees', async () => {
  const { payments, total_paid, by_type } = await api('/api/admin/fees');
  view.innerHTML = `
    <div class="page-title"><h2>Fees Overview</h2>
      <span class="crumbs">All collections across the institution</span>
    </div>

    <div class="grid cols-3">
      <div class="card"><div class="sub">Total Collected</div><div class="value">${money(total_paid)}</div></div>
      <div class="card"><div class="sub">Transactions</div><div class="value">${payments.length}</div></div>
      <div class="card"><div class="sub">Fee Types</div><div class="value">${by_type.length}</div></div>
    </div>

    <div class="grid cols-2" style="margin-top:14px">
      <div class="card">
        <h3>By Fee Type</h3>
        <table class="table">
          <thead><tr><th>Type</th><th>Count</th><th>Total</th></tr></thead>
          <tbody>
            ${by_type.map(r => `
              <tr>
                <td>${escapeHtml(r.fee_type)}</td>
                <td>${r.count}</td>
                <td>${money(r.total)}</td>
              </tr>`).join('') || `<tr><td colspan="3" class="empty">No data</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>Recent Transactions</h3>
        <table class="table">
          <thead><tr><th>Paid by</th><th>Fee</th><th>Amount</th><th>When</th><th>Ref</th></tr></thead>
          <tbody>
            ${payments.slice(0, 25).map(p => `
              <tr>
                <td>${escapeHtml(p.full_name)} <span class="sub">(${escapeHtml(p.username)})</span></td>
                <td>${escapeHtml(p.fee_type)}</td>
                <td>${money(p.amount)}</td>
                <td>${fmtDate(p.paid_on)}</td>
                <td>${escapeHtml(p.reference || '-')}</td>
              </tr>`).join('') || `<tr><td colspan="5" class="empty">No payments</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
});

// ============================================================
// SETTINGS
// ============================================================
route('settings', async () => {
  const { settings } = await api('/api/admin/settings');
  view.innerHTML = `
    <div class="page-title"><h2>System Settings</h2>
      <span class="crumbs">Institution-wide configuration</span>
    </div>
    <div class="card">
      <form id="settingsForm">
        <div class="form-row">
          <div class="field"><label>Institution Name</label>
            <input name="institution_name" value="${escapeHtml(settings.institution_name || '')}" /></div>
          <div class="field"><label>Academic Year</label>
            <input name="academic_year" value="${escapeHtml(settings.academic_year || '')}" /></div>
        </div>
        <div class="form-row">
          <div class="field"><label>Support Email</label>
            <input name="support_email" type="email" value="${escapeHtml(settings.support_email || '')}" /></div>
          <div class="field"><label>Maintenance Mode</label>
            <select name="maintenance_mode">
              <option value="off" ${settings.maintenance_mode === 'off' ? 'selected' : ''}>Off</option>
              <option value="on"  ${settings.maintenance_mode === 'on'  ? 'selected' : ''}>On</option>
            </select>
          </div>
        </div>
        <button class="btn" type="submit">Save settings</button>
      </form>
    </div>
  `;

  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/admin/settings', { method: 'PUT', body: fd });
      toast('Settings saved');
    } catch (err) { toast(err.message, 'err'); }
  });
});

// ---------- Boot ----------
if (!location.hash) location.hash = '#/dashboard';
navigate();
