// ---------- Small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

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

// ---------- Topbar ----------
(async function initTopbar() {
  try {
    const { user } = await api('/api/me');
    if (!user) return;
    $('#whoName').textContent = user.full_name;
    $('#whoRole').textContent = user.role;
    $('#avatar').textContent = (user.full_name || 'S').trim().charAt(0).toUpperCase();
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
  catch (err) { view.innerHTML = `<div class="card"><h3>Something went wrong</h3><p>${escapeHtml(err.message)}</p></div>`; }
}
window.addEventListener('hashchange', navigate);

// ============================================================
// ROUTES
// ============================================================

// ---------- Dashboard ----------
route('dashboard', async () => {
  const [{ profile }, { payments, total_paid }] = await Promise.all([
    api('/api/student/profile'),
    api('/api/student/fees'),
  ]);
  view.innerHTML = `
    <div class="page-title"><h2>Welcome, ${escapeHtml(profile?.full_name || 'Student')}</h2>
      <span class="crumbs">${escapeHtml(profile?.department || '')} · Semester ${escapeHtml(profile?.semester || '-')}</span>
    </div>
    <div class="grid cols-4">
      <div class="card"><div class="sub">Roll No</div><div class="value">${escapeHtml(profile?.roll_no || '-')}</div></div>
      <div class="card"><div class="sub">Attendance</div><div class="value">88%</div><div class="sub">Last 30 days</div></div>
      <div class="card"><div class="sub">CGPA</div><div class="value">8.42</div><div class="sub">Cumulative</div></div>
      <div class="card"><div class="sub">Fees Paid</div><div class="value">₹ ${total_paid.toLocaleString('en-IN')}</div><div class="sub">${payments.length} transactions</div></div>
    </div>

    <div class="grid cols-2" style="margin-top:14px">
      <div class="card">
        <h3>Upcoming</h3>
        <ul style="margin:6px 0 0;padding-left:18px;color:var(--muted);line-height:1.9">
          <li>IA-2 · Data Structures · 24 Apr</li>
          <li>Project review · 28 Apr</li>
          <li>Semester fees deadline · 30 Apr</li>
        </ul>
      </div>
      <div class="card">
        <h3>Quick Links</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">
          <a class="btn small secondary" href="#/timetable/timetable">Timetable</a>
          <a class="btn small secondary" href="#/timetable/attendance">Attendance</a>
          <a class="btn small secondary" href="#/fee/pay">Pay Fees</a>
          <a class="btn small secondary" href="#/exam/revaluation">Revaluation</a>
          <a class="btn small secondary" href="#/study-material">Study Material</a>
        </div>
      </div>
    </div>
  `;
});

// ---------- Personal ----------
route('personal', async () => {
  const { profile } = await api('/api/student/profile');
  view.innerHTML = `
    <div class="page-title"><h2>Personal Details</h2></div>
    <div class="card">
      <div class="grid cols-2">
        <div><div class="sub">Full Name</div><div class="value" style="font-size:16px">${escapeHtml(profile.full_name)}</div></div>
        <div><div class="sub">Email</div><div class="value" style="font-size:16px">${escapeHtml(profile.email || '-')}</div></div>
        <div><div class="sub">Roll No</div><div class="value" style="font-size:16px">${escapeHtml(profile.roll_no || '-')}</div></div>
        <div><div class="sub">Department</div><div class="value" style="font-size:16px">${escapeHtml(profile.department || '-')}</div></div>
        <div><div class="sub">Semester</div><div class="value" style="font-size:16px">${escapeHtml(profile.semester || '-')}</div></div>
        <div><div class="sub">Date of Birth</div><div class="value" style="font-size:16px">${escapeHtml(profile.dob || '-')}</div></div>
        <div><div class="sub">Phone</div><div class="value" style="font-size:16px">${escapeHtml(profile.phone || '-')}</div></div>
        <div><div class="sub">Address</div><div class="value" style="font-size:16px">${escapeHtml(profile.address || '-')}</div></div>
      </div>
    </div>
  `;
});

// ---------- Elective Registration ----------
route('elective', async () => {
  const data = await api('/api/student/electives');
  const registeredCodes = new Set(data.registered.map(r => r.course_code));

  view.innerHTML = `
    <div class="page-title"><h2>Elective Registration</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Available Electives</h3>
        <table class="table">
          <thead><tr><th>Code</th><th>Name</th><th></th></tr></thead>
          <tbody>
            ${data.available.map(c => `
              <tr>
                <td>${escapeHtml(c.code)}</td>
                <td>${escapeHtml(c.name)}</td>
                <td style="text-align:right">
                  ${registeredCodes.has(c.code)
                    ? `<span class="badge ok">Registered</span>`
                    : `<button class="btn small" data-code="${escapeHtml(c.code)}" data-name="${escapeHtml(c.name)}">Register</button>`}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3>Your Registrations</h3>
        ${data.registered.length === 0
          ? `<div class="empty">No electives registered yet.</div>`
          : `<table class="table"><thead><tr><th>Code</th><th>Name</th><th>Registered On</th></tr></thead>
             <tbody>${data.registered.map(r => `
               <tr><td>${escapeHtml(r.course_code)}</td><td>${escapeHtml(r.course_name)}</td>
                   <td>${escapeHtml(r.created_at)}</td></tr>`).join('')}</tbody></table>`}
      </div>
    </div>
  `;

  $$('button[data-code]').forEach(b => b.addEventListener('click', async () => {
    try {
      await api('/api/student/electives', {
        method: 'POST',
        body: { course_code: b.dataset.code, course_name: b.dataset.name }
      });
      navigate();
    } catch (e) { alert(e.message); }
  }));
});

// ---------- Feedback ----------
route('feedback', async () => {
  const { items } = await api('/api/student/feedback');
  view.innerHTML = `
    <div class="page-title"><h2>Feedback</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Submit Feedback</h3>
        <form id="fbForm">
          <div class="field"><label>Subject / Faculty</label><input name="subject" required placeholder="e.g. Data Structures - Prof. Sharma"/></div>
          <div class="form-row">
            <div class="field"><label>Rating (1-5)</label>
              <select name="rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
            </div>
            <div class="field"><label>&nbsp;</label><div style="color:var(--muted);font-size:12px;padding-top:10px">Ratings are anonymous to faculty.</div></div>
          </div>
          <div class="field"><label>Comments</label><textarea name="comments" placeholder="Share your thoughts"></textarea></div>
          <button class="btn">Submit</button>
        </form>
      </div>
      <div class="card">
        <h3>Your Previous Feedback</h3>
        ${items.length === 0 ? `<div class="empty">No feedback yet.</div>` : `
          <table class="table"><thead><tr><th>Subject</th><th>Rating</th><th>Date</th></tr></thead>
          <tbody>${items.map(i => `
            <tr><td>${escapeHtml(i.subject)}</td><td><span class="badge info">${i.rating}/5</span></td>
                <td>${escapeHtml(i.created_at)}</td></tr>`).join('')}</tbody></table>`}
      </div>
    </div>
  `;
  $('#fbForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/student/feedback', {
        method: 'POST',
        body: { subject: fd.get('subject'), rating: fd.get('rating'), comments: fd.get('comments') }
      });
      navigate();
    } catch (err) { alert(err.message); }
  });
});

// ---------- Log Book ----------
route('logbook', async () => {
  const { items } = await api('/api/student/logbook');
  view.innerHTML = `
    <div class="page-title"><h2>Log Book</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>New Entry</h3>
        <form id="lbForm">
          <div class="form-row">
            <div class="field"><label>Date</label><input type="date" name="entry_date" required /></div>
            <div class="field"><label>Title</label><input name="title" required placeholder="Topic / Activity"/></div>
          </div>
          <div class="field"><label>Details</label><textarea name="details"></textarea></div>
          <button class="btn">Save Entry</button>
        </form>
      </div>
      <div class="card">
        <h3>Recent Entries</h3>
        ${items.length === 0 ? `<div class="empty">No entries yet.</div>` : `
          <table class="table"><thead><tr><th>Date</th><th>Title</th><th>Details</th></tr></thead>
          <tbody>${items.map(i => `
            <tr><td>${escapeHtml(i.entry_date)}</td><td>${escapeHtml(i.title)}</td>
                <td style="color:var(--muted)">${escapeHtml(i.details || '')}</td></tr>`).join('')}</tbody></table>`}
      </div>
    </div>
  `;
  $('#lbForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/student/logbook', {
        method: 'POST',
        body: { entry_date: fd.get('entry_date'), title: fd.get('title'), details: fd.get('details') }
      });
      navigate();
    } catch (err) { alert(err.message); }
  });
});

// ---------- Transport ----------
route('transport', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Transport</h2></div>
    <div class="grid cols-3">
      <div class="card"><div class="sub">Assigned Route</div><div class="value">R-07</div><div class="sub">Campus ↔ Kothrud</div></div>
      <div class="card"><div class="sub">Pickup Point</div><div class="value" style="font-size:18px">Kothrud Depot</div><div class="sub">07:45 AM</div></div>
      <div class="card"><div class="sub">Bus No.</div><div class="value">MH-12-JJ-0712</div><div class="sub">Driver: R. Patil</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>Stops on your route</h3>
      <table class="table">
        <thead><tr><th>#</th><th>Stop</th><th>Morning</th><th>Evening</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Kothrud Depot</td><td>07:45</td><td>17:35</td></tr>
          <tr><td>2</td><td>Karve Nagar</td><td>07:58</td><td>17:22</td></tr>
          <tr><td>3</td><td>Warje</td><td>08:10</td><td>17:10</td></tr>
          <tr><td>4</td><td>JJMMC Campus</td><td>08:35</td><td>16:45</td></tr>
        </tbody>
      </table>
    </div>
  `;
});

// ---------- Timetable / Timetable ----------
route('timetable/timetable', async () => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const slots = ['9:00', '10:00', '11:00', '12:00', '2:00', '3:00'];
  const grid = {
    Mon: ['DS', 'DBMS', 'OS', 'Lab-DS', 'Lab-DS', 'Sports'],
    Tue: ['OS', 'DS', 'Maths', 'DBMS', 'Lib', 'Lib'],
    Wed: ['DBMS', 'Maths', 'DS', 'Seminar', 'Lab-OS', 'Lab-OS'],
    Thu: ['Maths', 'OS', 'DBMS', 'DS', 'Mentoring', '-'],
    Fri: ['Lab-DB', 'Lab-DB', 'DS', 'OS', 'DBMS', 'Sports'],
    Sat: ['Seminar', 'Elective', 'Elective', '-', '-', '-'],
  };
  view.innerHTML = `
    <div class="page-title"><h2>Timetable</h2><span class="crumbs">Semester 4 · CSE-A</span></div>
    <div class="card" style="overflow:auto">
      <table class="table">
        <thead><tr><th>Day</th>${slots.map(s => `<th>${s}</th>`).join('')}</tr></thead>
        <tbody>
          ${days.map(d => `
            <tr><td><strong>${d}</strong></td>${grid[d].map(c => `<td>${c === '-' ? '<span style="color:var(--muted)">—</span>' : `<span class="badge info">${c}</span>`}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
});

// ---------- Timetable / Attendance ----------
route('timetable/attendance', async () => {
  const subjects = [
    { s: 'Data Structures', p: 38, t: 42 },
    { s: 'DBMS',            p: 35, t: 40 },
    { s: 'Operating Systems', p: 30, t: 38 },
    { s: 'Mathematics',     p: 40, t: 42 },
    { s: 'Elective - ML',   p: 18, t: 22 },
  ];
  view.innerHTML = `
    <div class="page-title"><h2>Attendance</h2></div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Subject</th><th>Attended</th><th>Total</th><th>%</th><th>Status</th></tr></thead>
        <tbody>
          ${subjects.map(x => {
            const pct = Math.round((x.p / x.t) * 100);
            const badge = pct >= 75 ? 'ok' : pct >= 60 ? 'warn' : 'err';
            return `<tr>
              <td>${x.s}</td><td>${x.p}</td><td>${x.t}</td><td>${pct}%</td>
              <td><span class="badge ${badge}">${pct >= 75 ? 'Good' : pct >= 60 ? 'Low' : 'Shortage'}</span></td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
});

// ---------- Exam / Exam Fee ----------
route('exam/fee', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Exam Fee</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Semester 4 - Regular</h3>
        <p class="sub">Last date: 30 Apr 2026</p>
        <div class="value">₹ 2,500</div>
        <button class="btn" id="payExam" style="margin-top:10px">Pay Exam Fee</button>
      </div>
      <div class="card">
        <h3>Backlog / Repeat</h3>
        <p class="sub">Per subject</p>
        <div class="value">₹ 600</div>
        <button class="btn secondary" id="payBacklog" style="margin-top:10px">Pay Per Subject</button>
      </div>
    </div>
  `;
  const pay = async (fee_type, amount) => {
    try {
      const r = await api('/api/student/fees/pay', { method: 'POST', body: { fee_type, amount } });
      alert(`Paid. Reference: ${r.reference}`);
      location.hash = '#/fee/history';
    } catch (e) { alert(e.message); }
  };
  $('#payExam').addEventListener('click', () => pay('Exam Fee - Sem 4', 2500));
  $('#payBacklog').addEventListener('click', () => pay('Exam Fee - Backlog', 600));
});

// ---------- Exam / Revaluation ----------
route('exam/revaluation', async () => {
  const { items } = await api('/api/student/revaluation');
  view.innerHTML = `
    <div class="page-title"><h2>Revaluation Application</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>New Application</h3>
        <form id="rvForm">
          <div class="field"><label>Subject</label><input name="subject" required placeholder="e.g. DBMS"/></div>
          <div class="field"><label>Exam Date</label><input type="date" name="exam_date" /></div>
          <div class="field"><label>Reason</label><textarea name="reason" placeholder="Why revaluation"></textarea></div>
          <button class="btn">Submit Application</button>
        </form>
      </div>
      <div class="card">
        <h3>Your Applications</h3>
        ${items.length === 0 ? `<div class="empty">No applications yet.</div>` : `
          <table class="table"><thead><tr><th>Subject</th><th>Exam Date</th><th>Status</th><th>Applied</th></tr></thead>
          <tbody>${items.map(i => `
            <tr><td>${escapeHtml(i.subject)}</td><td>${escapeHtml(i.exam_date || '-')}</td>
                <td><span class="badge ${i.status === 'PENDING' ? 'warn' : 'ok'}">${escapeHtml(i.status)}</span></td>
                <td>${escapeHtml(i.created_at)}</td></tr>`).join('')}</tbody></table>`}
      </div>
    </div>
  `;
  $('#rvForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/student/revaluation', {
        method: 'POST',
        body: { subject: fd.get('subject'), exam_date: fd.get('exam_date'), reason: fd.get('reason') }
      });
      navigate();
    } catch (err) { alert(err.message); }
  });
});

// ---------- IA ----------
route('ia', async () => {
  const rows = [
    ['Data Structures', 18, 20, 17, 20],
    ['DBMS',            16, 20, 19, 20],
    ['Operating Systems', 15, 20, 16, 20],
    ['Mathematics',     19, 20, 20, 20],
    ['Elective - ML',   17, 20, '-', 20],
  ];
  view.innerHTML = `
    <div class="page-title"><h2>Internal Assessment (IA)</h2></div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Subject</th><th>IA-1</th><th>Max</th><th>IA-2</th><th>Max</th></tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
});

// ---------- Academic / Scheme ----------
route('academic/scheme', async () => {
  const scheme = [
    ['CS401', 'Data Structures', 3, 1, 2, 75, 25, 100],
    ['CS402', 'DBMS',            3, 0, 2, 75, 25, 100],
    ['CS403', 'Operating Systems', 3, 1, 2, 75, 25, 100],
    ['MA401', 'Discrete Math',   3, 1, 0, 75, 25, 100],
    ['CS404', 'Elective - ML',   3, 0, 2, 75, 25, 100],
  ];
  view.innerHTML = `
    <div class="page-title"><h2>Teaching &amp; Examination Scheme</h2><span class="crumbs">Semester 4 · CSE</span></div>
    <div class="card">
      <table class="table">
        <thead><tr>
          <th>Code</th><th>Subject</th><th>L</th><th>T</th><th>P</th><th>End Sem</th><th>IA</th><th>Total</th>
        </tr></thead>
        <tbody>${scheme.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
});

// ---------- Academic / Circular ----------
route('academic/circular', async () => {
  const circs = [
    { date: '2026-04-15', title: 'Revised IA-2 Schedule', tag: 'Exam' },
    { date: '2026-04-12', title: 'Scholarship Form Deadline', tag: 'Notice' },
    { date: '2026-04-10', title: 'Cultural Fest Registrations Open', tag: 'Event' },
    { date: '2026-04-02', title: 'Library Timings Update', tag: 'General' },
  ];
  view.innerHTML = `
    <div class="page-title"><h2>Circulars</h2></div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Date</th><th>Title</th><th>Category</th><th></th></tr></thead>
        <tbody>${circs.map(c => `
          <tr>
            <td>${c.date}</td><td>${c.title}</td>
            <td><span class="badge info">${c.tag}</span></td>
            <td style="text-align:right"><a class="btn small secondary" href="#">View</a></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
  `;
});

// ---------- Event ----------
route('event', async () => {
  const events = [
    { date: '2026-04-25', title: 'TechFest 2026', loc: 'Main Audi' },
    { date: '2026-05-02', title: 'Sports Day', loc: 'Playground' },
    { date: '2026-05-15', title: 'Industry Talk - AI', loc: 'Seminar Hall' },
  ];
  view.innerHTML = `
    <div class="page-title"><h2>Events</h2></div>
    <div class="grid cols-3">
      ${events.map(e => `
        <div class="card">
          <div class="sub">${e.date}</div>
          <h3>${e.title}</h3>
          <div class="sub">${e.loc}</div>
          <button class="btn small" style="margin-top:10px">Register</button>
        </div>`).join('')}
    </div>
  `;
});

// ---------- Hostel ----------
route('hostel', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Hostel</h2></div>
    <div class="grid cols-3">
      <div class="card"><div class="sub">Block</div><div class="value">B-2</div></div>
      <div class="card"><div class="sub">Room</div><div class="value">214</div></div>
      <div class="card"><div class="sub">Warden</div><div class="value" style="font-size:18px">Mr. Deshmukh</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>Mess Menu - This Week</h3>
      <table class="table">
        <thead><tr><th>Day</th><th>Breakfast</th><th>Lunch</th><th>Dinner</th></tr></thead>
        <tbody>
          <tr><td>Mon</td><td>Poha</td><td>Dal, Rice, Sabzi</td><td>Chapati, Paneer</td></tr>
          <tr><td>Tue</td><td>Idli</td><td>Pulav, Curd</td><td>Chapati, Dal</td></tr>
          <tr><td>Wed</td><td>Paratha</td><td>Rajma, Rice</td><td>Chapati, Sabzi</td></tr>
          <tr><td>Thu</td><td>Upma</td><td>Chhole, Rice</td><td>Chapati, Dal</td></tr>
          <tr><td>Fri</td><td>Dosa</td><td>Biryani</td><td>Chapati, Paneer</td></tr>
        </tbody>
      </table>
    </div>
  `;
});

// ---------- Mentoring ----------
route('mentoring', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Mentoring</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Your Mentor</h3>
        <div class="value" style="font-size:18px">Prof. Sharma</div>
        <div class="sub">Computer Science · faculty@jjmmc.edu</div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="btn small">Book Slot</button>
          <button class="btn small secondary">Message</button>
        </div>
      </div>
      <div class="card">
        <h3>Recent Sessions</h3>
        <table class="table">
          <thead><tr><th>Date</th><th>Topic</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td>2026-04-05</td><td>Project scope review</td><td>Define milestones</td></tr>
            <tr><td>2026-03-22</td><td>IA-1 performance</td><td>Improve DBMS prep</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
});

// ---------- Fee / Pay Hostel ----------
route('fee/pay-hostel', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Pay Hostel Fees</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Hostel Fees · Semester 4</h3>
        <p class="sub">Room 214 · B-2 Block</p>
        <div class="value">₹ 28,000</div>
        <p class="sub">Includes rent + mess.</p>
        <button class="btn" id="payHostel" style="margin-top:10px">Pay ₹28,000</button>
      </div>
      <div class="card">
        <h3>Mess-only option</h3>
        <div class="value">₹ 12,000</div>
        <button class="btn secondary" id="payMess" style="margin-top:10px">Pay Mess Only</button>
      </div>
    </div>
  `;
  const pay = async (fee_type, amount) => {
    try {
      const r = await api('/api/student/fees/pay', { method: 'POST', body: { fee_type, amount } });
      alert(`Paid. Reference: ${r.reference}`);
      location.hash = '#/fee/history';
    } catch (e) { alert(e.message); }
  };
  $('#payHostel').addEventListener('click', () => pay('Hostel Fees', 28000));
  $('#payMess').addEventListener('click',   () => pay('Mess Only', 12000));
});

// ---------- Fee / Pay ----------
route('fee/pay', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Pay Fees</h2></div>
    <div class="grid cols-2">
      <div class="card">
        <h3>Tuition Fees · Semester 4</h3>
        <p class="sub">Due date: 30 Apr 2026</p>
        <div class="value">₹ 45,000</div>
        <button class="btn" id="payTuition" style="margin-top:10px">Pay Tuition</button>
      </div>
      <div class="card">
        <h3>Other Payable</h3>
        <form id="otherForm">
          <div class="field"><label>Fee Type</label>
            <select name="fee_type">
              <option>Library</option>
              <option>Lab</option>
              <option>Development</option>
              <option>Late Fine</option>
            </select>
          </div>
          <div class="field"><label>Amount (₹)</label><input type="number" name="amount" required min="1" /></div>
          <button class="btn">Pay</button>
        </form>
      </div>
    </div>
  `;
  const pay = async (fee_type, amount) => {
    try {
      const r = await api('/api/student/fees/pay', { method: 'POST', body: { fee_type, amount } });
      alert(`Paid. Reference: ${r.reference}`);
      location.hash = '#/fee/history';
    } catch (e) { alert(e.message); }
  };
  $('#payTuition').addEventListener('click', () => pay('Tuition - Sem 4', 45000));
  $('#otherForm').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    pay(fd.get('fee_type'), Number(fd.get('amount')));
  });
});

// ---------- Fee / History ----------
route('fee/history', async () => {
  const { payments, total_paid } = await api('/api/student/fees');
  view.innerHTML = `
    <div class="page-title"><h2>Fee History</h2>
      <span class="crumbs">Total paid: ₹ ${total_paid.toLocaleString('en-IN')}</span></div>
    <div class="card">
      ${payments.length === 0 ? `<div class="empty">No payments yet.</div>` : `
        <table class="table">
          <thead><tr><th>Date</th><th>Fee Type</th><th>Reference</th><th>Status</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${payments.map(p => `
            <tr>
              <td>${escapeHtml(p.paid_on)}</td>
              <td>${escapeHtml(p.fee_type)}</td>
              <td style="color:var(--muted)">${escapeHtml(p.reference || '-')}</td>
              <td><span class="badge ok">${escapeHtml(p.status)}</span></td>
              <td style="text-align:right">₹ ${p.amount.toLocaleString('en-IN')}</td>
            </tr>`).join('')}</tbody></table>`}
    </div>
  `;
});

// ---------- Study Material ----------
route('study-material', async () => {
  const mats = [
    { subj: 'Data Structures', items: ['Unit 1 - Arrays.pdf', 'Unit 2 - Linked List.pdf', 'Practice Set.pdf'] },
    { subj: 'DBMS', items: ['ER Diagrams.pdf', 'Normalization.pdf', 'SQL Cheatsheet.pdf'] },
    { subj: 'Operating Systems', items: ['Processes.pdf', 'Scheduling.pdf'] },
  ];
  view.innerHTML = `
    <div class="page-title"><h2>Study Material</h2></div>
    <div class="grid cols-3">
      ${mats.map(m => `
        <div class="card">
          <h3>${m.subj}</h3>
          <ul style="padding-left:18px;line-height:1.9">
            ${m.items.map(i => `<li><a href="#">${i}</a></li>`).join('')}
          </ul>
        </div>`).join('')}
    </div>
  `;
});

// ---------- Other ----------
route('other', async () => {
  view.innerHTML = `
    <div class="page-title"><h2>Other Services</h2></div>
    <div class="grid cols-3">
      <div class="card"><h3>Bonafide Certificate</h3><p class="sub">Request an official bonafide letter.</p><button class="btn small" style="margin-top:8px">Request</button></div>
      <div class="card"><h3>Id Card Reissue</h3><p class="sub">Apply for a duplicate ID card.</p><button class="btn small" style="margin-top:8px">Apply</button></div>
      <div class="card"><h3>Grievance</h3><p class="sub">Raise an issue confidentially.</p><button class="btn small" style="margin-top:8px">Raise</button></div>
      <div class="card"><h3>Transcript</h3><p class="sub">Request official transcripts.</p><button class="btn small" style="margin-top:8px">Request</button></div>
      <div class="card"><h3>Alumni Form</h3><p class="sub">Register as alumnus after graduation.</p><button class="btn small" style="margin-top:8px">Open</button></div>
      <div class="card"><h3>Help Desk</h3><p class="sub">Call: +91 20 0000 0000</p><button class="btn small secondary" style="margin-top:8px">Email</button></div>
    </div>
  `;
});

// ---------- boot ----------
if (!location.hash) location.hash = '#/dashboard';
navigate();
