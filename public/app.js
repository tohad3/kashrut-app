'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('he-IL') : '');
const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const HAIFA = [32.794, 34.99];

const STATUS_COLORS = {
  1: '#12a3b4', // בתהליך פתיחה
  2: '#1f9d55', // מאושר
  3: '#e0a106', // לא מאושר
  4: '#8795a1', // נסגר
  5: '#b07cc6', // בקשה להפסקת השגחה
  6: '#d64545', // הכשר בוטל
  7: '#f07b3f', // הסרה זמנית
};
const PALETTE = ['#0b3a5b', '#12a3b4', '#1f9d55', '#e0a106', '#d64545', '#7b61c9', '#f07b3f', '#4c7fd1', '#8795a1', '#2bb3a0', '#c95b8b', '#6a8f2f'];

const state = { user: null, sites: [], reports14: [], charts: {}, maps: {}, layers: {} };

/* ---------- API ---------- */

// במצב ללא שרת (קובץ עצמאי) הקריאות מטופלות בדפדפן עצמו – ראו local-api.js
const LOCAL = typeof window.localApi === 'function';

async function api(path, { method = 'GET', body } = {}) {
  if (LOCAL) {
    try { return await window.localApi(path, { method, body }); } catch (e) {
      if (e.status === 401 && path !== '/me') showLogin();
      throw e;
    }
  }
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-App': '1' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  }).catch(() => { throw new Error('אין חיבור לשרת האפליקציה. ודא שהשרת פועל ונסה שוב'); });
  const j = await res.json().catch(() => ({ error: 'שגיאת רשת' }));
  if (res.status === 401 && path !== '/login' && path !== '/me') { showLogin('ההתחברות פגה, יש להתחבר מחדש'); throw new Error(j.error); }
  if (!res.ok) throw new Error(j.error || 'שגיאה');
  return j;
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}

/* ---------- login ---------- */

function showLogin(err) {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#loginError').textContent = err || '';
  $('#loginError').classList.toggle('hidden', !err);
}

if (!LOCAL) {
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button', f);
  btn.disabled = true; btn.textContent = 'מתחבר…';
  $('#loginError').classList.add('hidden');
  try {
    const r = await api('/login', {
      method: 'POST',
      body: { username: f.username.value.trim(), password: f.password.value, authorityId: f.authorityId.value || undefined },
    });
    if (r.needAuthority) {
      f.authorityId.innerHTML = r.authorities.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');
      $('#authorityRow').classList.remove('hidden');
      $('#loginError').textContent = 'יש לבחור ארגון ולהתחבר שוב';
      $('#loginError').classList.remove('hidden');
      return;
    }
    f.password.value = '';
    if (f.password.type !== 'password') $('#pwToggle').click();
    start(r.user);
  } catch (err) {
    $('#loginError').textContent = err.message;
    $('#loginError').classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'כניסה';
  }
});

// הצגת סיסמה
const EYE_OPEN = 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z';
const EYE_CLOSED = 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M3 3l18 18';
$('#pwToggle').addEventListener('click', () => {
  const pw = $('#password'), show = pw.type === 'password';
  pw.type = show ? 'text' : 'password';
  $('#pwToggle').setAttribute('aria-pressed', String(show));
  $('#pwToggle').setAttribute('aria-label', show ? 'הסתר סיסמה' : 'הצג סיסמה');
  $('#pwToggle').title = show ? 'הסתר סיסמה' : 'הצג סיסמה';
  $('#eyeIcon').setAttribute('d', show ? EYE_CLOSED : EYE_OPEN);
  pw.focus();
});

// חיווי Caps Lock
const updateCaps = (e) => {
  if (e.getModifierState) $('#capsWarn').classList.toggle('hidden', !e.getModifierState('CapsLock'));
};
$$('#loginForm input').forEach((el) => ['keydown', 'keyup', 'click'].forEach((ev) => el.addEventListener(ev, updateCaps)));
$('#password').addEventListener('blur', () => $('#capsWarn').classList.add('hidden'));
} // !LOCAL

$('#logoutBtn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* ---------- navigation ---------- */

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) go(b.dataset.view);
});

/* --- היסטוריית ניווט: כפתור "חזרה" וגם כפתור החזרה של הדפדפן/הטלפון --- */

const nav = { depth: 0, restoring: false, last: '' };

function navSnapshot() {
  return {
    view: state.view || 'dashboard',
    sheet: state.sheet || null,
    att: {
      mode: state.attMode, role: sv('#attRole'), insp: sv('#attInspector'), sup: sv('#attSupervisor'), day: $('#attDay').value,
      status: $$('#attStatus button.active').map((b) => b.dataset.range),
    },
  };
}

// נקרא אחרי כל פעולה; מוסיף צעד להיסטוריה רק אם משהו השתנה בפועל
function pushNav(replace) {
  if (nav.restoring) return;
  const snap = navSnapshot(), key = JSON.stringify(snap);
  if (key === nav.last) return;
  nav.last = key;
  if (replace) history.replaceState(snap, '');
  else { history.pushState(snap, ''); nav.depth++; }
  $('#backBtn').disabled = nav.depth === 0;
}

function applyNav(snap) {
  nav.restoring = true;
  try {
    // מציירים מחדש רק את מה שהשתנה, כדי שחזרה מחלונית לא תסגור חלון פתוח במפה ולא תזיז אותה
    const cur = navSnapshot();
    if (JSON.stringify(cur.att) !== JSON.stringify(snap.att)) {
      state.attMode = snap.att.mode;
      $$('#attMode button').forEach((x) => x.classList.toggle('active', x.dataset.mode === state.attMode));
      $$('#attStatus button').forEach((b) => b.classList.toggle('active', snap.att.status.includes(b.dataset.range)));
      setSv('#attRole', snap.att.role);
      fillAttFilters();
      setSv('#attInspector', snap.att.insp || []);
      fillAttFilters();
      setSv('#attSupervisor', snap.att.sup);
      fillAttDays();
      if (snap.att.day) $('#attDay').value = snap.att.day;
      if (cur.view === snap.view && snap.view === 'attendance') showAttendance();
    }
    if (cur.view !== snap.view) {
      go(snap.view);
      if (snap.view === 'attendance') showAttendance();
    }
    const sh = snap.sheet;
    const rep = sh && sh.type === 'report' && [state.lastReport, ...(state.attReports || []), ...state.reports14].find((x) => x && x.id === sh.id);
    if (sh && sh.type === 'site') openSite(sh.id);
    else if (sh && sh.type === 'person') openPerson(sh.name);
    else if (rep) openReport(rep);
    else if (sh && sh.type === 'drill' && state.drill && state.drill.id === sh.id) openDrill(state.drill.title, state.drill.kind, state.drill.items);
    else hideSheet();
  } finally {
    nav.restoring = false;
    nav.last = JSON.stringify(navSnapshot());
  }
}

window.addEventListener('popstate', (e) => {
  if (!e.state || !state.user) return;
  nav.depth = Math.max(0, nav.depth - 1);
  $('#backBtn').disabled = nav.depth === 0;
  applyNav(e.state);
});
$('#backBtn').addEventListener('click', () => history.back());

function go(view) {
  state.view = view;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + view));
  try { localStorage.setItem('view', view); } catch {}
  if (view === 'map') renderBizMap();
  if (view === 'attendance') ensureAttMap();
  if (view === 'sites') { renderSiteList(); renderRequests(); if (state.sites.length) ensureTrails(); }
  if (view === 'supervisors' || view === 'inspectors') renderPeopleTabs();
  if (view === 'admin') renderAdmin();
  Object.values(state.maps).forEach((m) => [50, 350].forEach((t) => setTimeout(() => m.invalidateSize(), t)));
  pushNav();
}

$('#refreshBtn').addEventListener('click', () => loadAll(true));

/* ---------- permissions ---------- */
const ROLE_LABEL = { admin: 'מנהל', editor: 'עורך', viewer: 'צופה' };
const canEdit = () => ['admin', 'editor'].includes(state.user && state.user.role); // עורך נתוני אפליקציה
const isAdmin = () => (state.user && state.user.role) === 'admin';                  // עדכון לאתר + ניהול משתמשים

// מסך ניהול המשתמשים (מנהל בלבד). כל מי שנכנס מופיע; שינוי התפקיד נשמר ל-OneDrive המשותף.
async function renderAdmin() {
  const el = $('#adminTable');
  if (!el) return;
  el.innerHTML = '<tbody><tr><td class="muted">טוען…</td></tr></tbody>';
  let data;
  try { data = await api('/roles'); } catch (e) { el.innerHTML = `<tbody><tr><td class="error">${esc(e.message)}</td></tr></tbody>`; return; }
  const rows = Object.entries(data.roles || {}).sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'he'));
  el.innerHTML = `<thead><tr><th>שם</th><th>תפקיד</th><th>עודכן</th><th>על ידי</th></tr></thead><tbody>${rows.length ? rows.map(([id, e]) => {
    const me = String(id) === String(data.meId);
    return `<tr><td>${esc(e.name || id)}${me ? ' <span class="muted">(אתה)</span>' : ''}</td>
      <td><select data-role-for="${esc(id)}">${['admin', 'editor', 'viewer'].map((r) => `<option value="${r}" ${e.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></td>
      <td class="muted">${e.updatedAt ? fmtDate(new Date(e.updatedAt)) : ''}</td>
      <td class="muted">${esc(e.updatedBy || '')}</td></tr>`;
  }).join('') : '<tr><td class="muted" colspan="4">עדיין לא נכנסו משתמשים נוספים</td></tr>'}</tbody>`;
  el.querySelectorAll('select[data-role-for]').forEach((sel) => {
    const id = sel.dataset.roleFor, prev = [...sel.options].find((o) => o.defaultSelected)?.value || sel.value;
    sel.addEventListener('change', async () => {
      try {
        await api('/roles/' + encodeURIComponent(id), { method: 'POST', body: { role: sel.value, name: (data.roles[id] && data.roles[id].name) || '' } });
        toast('התפקיד עודכן');
        if (String(id) === String(data.meId) && state.user) { state.user.role = sel.value; document.body.dataset.role = sel.value; }
        renderAdmin();
      } catch (e) { toast(e.message, true); sel.value = prev; }
    });
  });
}

/* ---------- boot ---------- */

async function start(user) {
  state.user = user;
  document.body.dataset.role = user.role || 'viewer';
  $('#userName').textContent = user.name;
  $('#authorityName').textContent = `${user.authorityName || ''} · ${user.moduleName || 'כשרות'}${user.role ? ' · ' + ROLE_LABEL[user.role] : ''}${user.scoped ? ' · רק העסקים והמשגיחים שלך' : ''}`;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  let view = 'dashboard';
  try { view = localStorage.getItem('view') || view; } catch {}
  // במצב ללא שרת: טווח התאריכים נקבע לפי הקובץ האחרון שנטען
  if (LOCAL && window.localData && localData.lastRange) {
    const r = await localData.lastRange().catch(() => null);
    if (r) {
      $('#dashFrom').value = r.from; $('#dashTo').value = r.to;
      $('#attFrom').value = r.from; $('#attTo').value = r.to;
      $$('#dashQuick button').forEach((b) => b.classList.remove('active'));
    }
  }
  nav.restoring = true; // המסך הראשון מחליף את הרשומה הנוכחית ולא מוסיף צעד
  go(view);
  nav.restoring = false;
  pushNav(true);
  await loadAll(false);
}

async function loadAll(force) {
  $('#kpis').innerHTML = '<div class="loading">טוען נתונים…</div>';
  if (!$('#dashFrom').value) setDashRange(14);
  try {
    const [sites, home, reports] = await Promise.all([
      api('/sites' + (force ? '?refresh=1' : '')),
      api('/home'),
      api(`/reports?from=${$('#dashFrom').value}&to=${$('#dashTo').value}`),
      loadStaffExtra(),
      loadBizExtra(),
      loadSiteStatus(),
      loadMapConfig().catch(() => {}), // תוספת רשות – כשל בה לא עוצר את טעינת הנתונים
    ]);
    state.sites = cleanSites(sites);
    state.home = home;
    state.reports14 = mergeReports(reports);
    indexSites();
    fillFilters();
    renderDashboard();
    renderBizMap();
    renderSiteList();
    if (state.view === 'sites') { renderRequests(); ensureTrails(); }
    autoLoadCoords();
  } catch (e) {
    toast(e.message, true);
  }
}

// שמות שרשומים באתר כמפקחים על עסקים אבל אינם מפקחים בפועל. הם מוסרים מרשימת המפקחים באפליקציה בלבד
// (הרישום באתר "שירת הים" לא משתנה). כדי להחזיר מישהו – מוחקים את שמו מהרשימה.
const NOT_INSPECTORS = ['שמעון מרמור', 'שלמה שטרן', 'שמעון אלמליח'];
function cleanSites(list) {
  const skip = new Set(NOT_INSPECTORS.map((n) => n.trim().split(/\s+/).sort().join(' ')));
  const isSkipped = (n) => skip.has(n.trim().split(/\s+/).sort().join(' '));
  return list.map((x) => {
    const names = String(x.inspectors || '').split(',').map((n) => n.trim()).filter(Boolean);
    return names.some(isSkipped) ? { ...x, inspectors: names.filter((n) => !isSkipped(n)).join(',') } : x;
  });
}

function indexSites() { state.siteById = new Map(state.sites.map((x) => [x.id, x])); matchBizToSites(); }
// מיקום הדיווח נלקח תמיד מהעסק, כך שמיקומים שנטענו אחר כך מופיעים מיד
const coordOf = (r) => (r.siteId && state.siteById && state.siteById.get(r.siteId)?.coord) || null;

/* ---------- date ranges ---------- */

function setDashRange(days, monthBack) {
  const now = new Date();
  let from, to = now;
  if (monthBack !== undefined) {
    from = new Date(now.getFullYear(), now.getMonth() - monthBack, 1);
    if (monthBack > 0) to = new Date(now.getFullYear(), now.getMonth() - monthBack + 1, 0);
  } else from = new Date(Date.now() - (days - 1) * 864e5);
  $('#dashFrom').value = isoDay(from);
  $('#dashTo').value = isoDay(to);
  $$('#dashQuick button').forEach((b) => b.classList.toggle('active',
    monthBack !== undefined ? b.dataset.month === String(monthBack) : b.dataset.days === String(days)));
}

$('#dashQuick').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.month !== undefined) setDashRange(null, Number(b.dataset.month)); else setDashRange(Number(b.dataset.days));
  loadDashReports();
});
['#dashFrom', '#dashTo'].forEach((s) => $(s).addEventListener('change', () => $$('#dashQuick button').forEach((b) => b.classList.remove('active'))));
$('#dashLoad').addEventListener('click', loadDashReports);
$('#dashRole').addEventListener('change', renderDashboard);

function validRange(from, to) {
  if (!from || !to || from > to) { toast('טווח תאריכים לא תקין', true); return false; }
  return true;
}

async function loadDashReports() {
  const from = $('#dashFrom').value, to = $('#dashTo').value;
  if (!validRange(from, to)) return;
  $('#dashLoad').disabled = true;
  $('#kpis').style.opacity = 0.5;
  try {
    state.reports14 = mergeReports(await api(`/reports?from=${from}&to=${to}`));
    fillFilters();
    renderDashboard();
  } catch (e) { toast(e.message, true); }
  finally { $('#dashLoad').disabled = false; $('#kpis').style.opacity = ''; }
}

function daysBetween(from, to) {
  const out = [];
  for (let d = new Date(from + 'T12:00:00'); isoDay(d) <= to; d = new Date(d.getTime() + 864e5)) out.push(isoDay(d));
  return out;
}

const rangeText = (from, to) => (from === to ? fmtDate(new Date(from + 'T12:00:00')) : `${fmtDate(new Date(from + 'T12:00:00'))} – ${fmtDate(new Date(to + 'T12:00:00'))}`);

/* ---------- dashboard ---------- */

function countBy(list, key) {
  const m = new Map();
  for (const x of list) { const k = (typeof key === 'function' ? key(x) : x[key]) || 'לא צוין'; m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
}

function chart(id, cfg, onPick) {
  if (state.charts[id]) state.charts[id].destroy();
  if (onPick) {
    cfg.options = cfg.options || {};
    cfg.options.onClick = (evt, els) => { if (els.length) onPick(els[0].index, els[0].datasetIndex); };
    cfg.options.onHover = (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
  }
  const css = getComputedStyle(document.documentElement);
  Chart.defaults.color = css.getPropertyValue('--muted').trim();
  Chart.defaults.borderColor = css.getPropertyValue('--border').trim();
  Chart.defaults.font.family = 'Assistant, system-ui, sans-serif';
  state.charts[id] = new Chart($('#' + id), cfg);
}

function barCfg(pairs, color, horizontal = true) {
  return {
    type: 'bar',
    data: { labels: pairs.map((p) => p[0]), datasets: [{ data: pairs.map((p) => p[1]), backgroundColor: color, borderRadius: 4 }] },
    options: { indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false } }, maintainAspectRatio: false,
      scales: { y: { ticks: { autoSkip: false } } } },
  };
}

const inRangeClass = (r) => (r.entryInRange && r.exitInRange ? 'ok' : r.entryInRange || r.exitInRange ? 'partial' : 'bad');

/* --- בחירת סטטוסים לדשבורד (בחירה מרובה, נשמרת בדפדפן) --- */

// סטטוסים שלא מוצגים בדשבורד בכלל: לא מאושר (3), נסגר (4), בקשה להפסקת השגחה (5), הכשרות בוטלה (6)
const DASH_HIDDEN_STATUSES = new Set([3, 4, 5, 6]);
const allStatusIds = () => [...new Set(state.sites.map((x) => x.statusId))].filter((id) => !DASH_HIDDEN_STATUSES.has(id));

function pickedStatuses() {
  if (!state.dashStatuses) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('dashStatuses')); } catch {}
    state.dashStatuses = new Set(Array.isArray(saved) && saved.length ? saved : allStatusIds());
  }
  const valid = new Set(allStatusIds());
  const out = new Set([...state.dashStatuses].filter((id) => valid.has(id)));
  return out.size ? out : valid;
}

function setPickedStatuses(ids) {
  state.dashStatuses = new Set(ids);
  try { localStorage.setItem('dashStatuses', JSON.stringify([...state.dashStatuses])); } catch {}
  renderDashboard();
}

function renderStatusChips() {
  const picked = pickedStatuses();
  const groups = new Map();
  for (const x of state.sites) { if (DASH_HIDDEN_STATUSES.has(x.statusId)) continue; const g = groups.get(x.statusId) || { id: x.statusId, name: x.status, n: 0, active: x.active }; g.n++; groups.set(x.statusId, g); }
  const list = [...groups.values()].sort((a, b) => b.active - a.active || b.n - a.n);
  $('#dashStatuses').innerHTML = '<span class="chips-label">בתי עסק להצגה:</span>' +
    `<button data-preset="all" class="${picked.size === list.length ? 'active' : ''}">הכול</button>` +
    '<span class="chips-sep"></span>' +
    list.map((g) => `<button data-status="${g.id}" class="${picked.has(g.id) ? 'active' : ''}" aria-pressed="${picked.has(g.id)}"><i class="dot" style="background:${STATUS_COLORS[g.id] || '#999'}"></i> ${esc(g.name)} (${g.n})</button>`).join('');
}

$('#dashStatuses').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const all = allStatusIds();
  const isActive = (id) => state.sites.find((x) => x.statusId === id)?.active;
  if (b.dataset.preset === 'all') return setPickedStatuses(all);
  if (b.dataset.preset === 'active') return setPickedStatuses(all.filter(isActive));
  if (b.dataset.preset === 'inactive') return setPickedStatuses(all.filter((id) => !isActive(id)));
  const id = Number(b.dataset.status), cur = pickedStatuses();
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  if (!cur.size) return toast('צריך לבחור לפחות סטטוס אחד');
  setPickedStatuses(cur);
});

function renderDashboard() {
  const home = state.home;
  renderStatusChips();
  // כל מדדי העסקים והגרפים מתייחסים רק לסטטוסים שנבחרו
  const picked = pickedStatuses();
  const s = state.sites.filter((x) => picked.has(x.statusId)), active = s;
  const roles = sv('#dashRole'), role = roles.length === 1 ? roles[0] : '';
  const r = state.reports14.filter((x) => anyOf(roles, x.group));
  const from = $('#dashFrom').value, to = $('#dashTo').value;
  $$('#view-dashboard .range-label:not(.fixed)').forEach((el) => { el.textContent = '· ' + rangeText(from, to) + (roles.length ? ' · ' + roles.join(', ') : ''); });
  $('#supTableTitle').textContent = roleWord(role, ' ו');
  const okPct = r.length ? Math.round((100 * r.filter((x) => inRangeClass(x) === 'ok').length) / r.length) : 0;
  const noCoord = s.filter((x) => x.active && !x.coord).length;

  // משגיחים שמשויכים לעסקים שנבחרו, וכמה מהם דיווחו בתקופה (לפי כל הדיווחים, בלי סינון התפקיד)
  const assigned = [...new Set(s.flatMap((x) => splitNames(x.supervisors)))].sort((a, b) => a.localeCompare(b, 'he'));
  const reporters = new Set(state.reports14.map((x) => x.supervisor));
  const silent = assigned.filter((n) => !reporters.has(n));
  const repPct = assigned.length ? Math.round((100 * (assigned.length - silent.length)) / assigned.length) : 0;

  // אחוזי החתמה מתוך כלל המשגיחים (כל העסקים במערכת, בלי תלות בבחירת הסטטוסים)
  const repKeys = new Set(state.reports14.map((x) => nameKey(x.supervisor)));
  const allSup = [...new Map(state.sites.filter((x) => !DASH_HIDDEN_STATUSES.has(x.statusId)).flatMap((x) => splitNames(x.supervisors)).map((n) => [nameKey(n), n])).values()].sort((p, q) => p.localeCompare(q, 'he'));
  const allSigned = allSup.filter((n) => repKeys.has(nameKey(n)));
  // פטורים: יש להם טלפון כשר והצהרה, והם גם לא מחתימים בפועל
  const exempt = allSup.filter((n) => !repKeys.has(nameKey(n)) && staffOf(n)?.phone === 'kosher' && staffOf(n)?.declaration);
  const pctOf = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  const allPct = pctOf(allSigned.length, allSup.length), netBase = allSup.length - exempt.length, netPct = pctOf(allSigned.length, netBase);
  const pctCls = (v, d) => (!d ? '' : v >= 80 ? 'ok' : v >= 50 ? 'warn' : 'bad');

  // נוכחות יומית: כמה משגיחים דיווחו ביום מסוים מעסק שהם משויכים אליו
  const presentByDay = new Map();
  for (const x of state.reports14) {
    if (!x.date) continue;
    const site = state.siteById && state.siteById.get(x.siteId);
    if (!site || !splitNames(site.supervisors).some((n) => nameKey(n) === nameKey(x.supervisor))) continue;
    const d = isoDay(new Date(x.date));
    (presentByDay.get(d) || presentByDay.set(d, new Map()).get(d)).set(nameKey(x.supervisor), x.supervisor);
  }
  const lastDay = [...presentByDay.keys()].sort().pop();
  const lastPresent = lastDay ? [...presentByDay.get(lastDay).values()] : [];

  // תמיד מתוך כל העסקים המאושרים לתעודה, בלי תלות בבחירת הסטטוסים שלמעלה
  const approvedAll = state.sites.filter((x) => x.statusId === 2), unpaidApproved = approvedAll.filter((x) => x.paid === false);
  const allSelected = picked.size === allStatusIds().length;
  const merged = state.reports14.reduce((n, x) => n + ((x.merged || 1) - 1), 0);
  const sitesWith = (f) => () => openDrill('בתי עסק', 'sites', s.filter(f));
  kpiRender('#kpis', [
    ['', s.length, allSelected ? `בתי עסק מוצגים (מתוך ${state.sites.length} במערכת)` : `בתי עסק נבחרים (מתוך ${state.sites.length} במערכת)`, () => openDrill('בתי עסק', 'sites', s)],
    ['ok', s.filter((x) => x.statusId === 2).length, 'מאושרים לתעודה', () => openDrill('מאושרים לתעודה', 'sites', s.filter((x) => x.statusId === 2))],
    ['', s.filter((x) => x.statusId === 1).length, 'בתהליך פתיחה', () => openDrill('בתהליך פתיחה', 'sites', s.filter((x) => x.statusId === 1))],
    ['', r.length, merged ? `דיווחים בתקופה (אוחדו ${merged} כפולים)` : 'דיווחים בתקופה', () => openDrill('דיווחים בתקופה', 'reports', r)],
    ['', new Set(r.map((x) => x.supervisor)).size, `${roleWord(role)} שדיווחו`, () => openDrill(`${roleWord(role, ' ו')} שדיווחו`, 'people', [...new Set(r.map((x) => x.supervisor))])],
    [pctCls(allPct, allSup.length), allSup.length ? allPct + '%' : '–',
      `החתמה – כלל המשגיחים (${allSigned.length} מתוך ${allSup.length})`, () => openDrill('משגיחים שלא החתימו', 'people', allSup.filter((n) => !repKeys.has(nameKey(n))))],
    [pctCls(netPct, netBase), netBase ? netPct + '%' : '–',
      `החתמה – בלי בעלי טלפון כשר והצהרה שלא מחתימים (${allSigned.length} מתוך ${netBase}; ${exempt.length} לא נספרו)`, () => openDrill('לא נספרו: טלפון כשר והצהרה, ולא מחתימים', 'people', exempt)],
    ['', lastPresent.length, lastDay ? `משגיחים שנכחו בעסקים שלהם ב-${lastDay.slice(8, 10)}/${lastDay.slice(5, 7)}` : 'משגיחים שנכחו בעסקים שלהם', lastPresent.length ? () => openDrill(`נכחו בעסקים שלהם ${lastDay.slice(8, 10)}/${lastDay.slice(5, 7)}`, 'people', lastPresent) : null],
    [okPct >= 80 ? 'ok' : okPct >= 50 ? 'warn' : 'bad', okPct + '%', 'דיווחים בטווח', () => openDrill('דיווחים שאינם "כניסה ויציאה בטווח"', 'reports', r.filter((x) => inRangeClass(x) !== 'ok'))],
    [unpaidApproved.length ? 'bad' : 'ok', unpaidApproved.length, `מאושרים לתעודה שלא שילמו (מתוך ${approvedAll.length})`, () => openDrill('מאושרים לתעודה שלא שילמו', 'sites', unpaidApproved)],
    [noCoord ? 'warn' : 'ok', noCoord, 'פעילים ללא מיקום ידוע', () => openDrill('פעילים ללא מיקום', 'sites', s.filter((x) => x.active && !x.coord))],
  ]);

  // שורה לכל משגיח שלא דיווח בתקופה: המפקחים שלו (לפי העסקים), מספר העסקים והדיווח האחרון
  state.silentRows = silent.map((n) => {
    const mine = s.filter((x) => splitNames(x.supervisors).includes(n));
    return { name: n, inspectors: [...new Set(mine.flatMap((x) => splitNames(x.inspectors)))].sort((a, b) => a.localeCompare(b, 'he')), sites: mine };
  });
  state.silentTotals = { assigned: assigned.length, silent: silent.length };
  renderSilent();
  loadLastReports();

  const st = countBy(s, (x) => x.status);
  const statusIdByName = Object.fromEntries(s.map((x) => [x.status, x.statusId]));
  chart('chStatus', {
    type: 'doughnut',
    data: { labels: st.map((p) => p[0]), datasets: [{ data: st.map((p) => p[1]), backgroundColor: st.map((p) => STATUS_COLORS[statusIdByName[p[0]]] || '#999') }] },
    options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false },
  }, (i) => openDrill('סטטוס: ' + st[i][0], 'sites', s.filter((x) => (x.status || 'לא צוין') === st[i][0])));

  // עד 62 ימים – לפי יום; עד שנה – לפי שבוע; מעבר לזה – לפי חודש
  const days = daysBetween(from, to);
  const unit = days.length <= 62 ? 'day' : days.length <= 366 ? 'week' : 'month';
  const bucketOf = (iso) => {
    if (unit === 'day') return iso;
    if (unit === 'month') return iso.slice(0, 7);
    const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); return isoDay(d); // תחילת שבוע (ראשון)
  };
  const buckets = [...new Set(days.map(bucketOf))];
  const counts = { ok: new Map(), partial: new Map(), bad: new Map() };
  for (const x of r) if (x.date) { const b = bucketOf(isoDay(new Date(x.date))); const m = counts[inRangeClass(x)]; m.set(b, (m.get(b) || 0) + 1); }
  const perDay = (cls) => buckets.map((b) => counts[cls].get(b) || 0);
  const bucketLabel = (b) => (unit === 'month' ? b.slice(5, 7) + '/' + b.slice(0, 4) : (unit === 'week' ? 'שבוע ' : '') + b.slice(8, 10) + '/' + b.slice(5, 7));
  chart('chDaily', {
    type: 'bar',
    data: {
      labels: buckets.map(bucketLabel),
      datasets: [
        { label: 'בטווח', data: perDay('ok'), backgroundColor: '#1f9d55', stack: 'a' },
        { label: 'חלקי', data: perDay('partial'), backgroundColor: '#e0a106', stack: 'a' },
        { label: 'מחוץ לטווח / לא אומת', data: perDay('bad'), backgroundColor: '#d64545', stack: 'a' },
      ],
    },
    options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } },
  }, (i, ds) => {
    const cls = ['ok', 'partial', 'bad'][ds];
    openDrill(`דיווחים · ${bucketLabel(buckets[i])} · ${RANGE_LABELS[cls]}`, 'reports',
      r.filter((x) => x.date && bucketOf(isoDay(new Date(x.date))) === buckets[i] && inRangeClass(x) === cls));
  });

  // משגיחים שנכחו בעסקים שלהם: לפי יום, או ממוצע יומי לשבוע / חודש
  const presDays = (bk) => days.filter((d) => bucketOf(d) === bk);
  const presVal = (bk) => { const ds = presDays(bk); const v = ds.reduce((n, d) => n + (presentByDay.get(d)?.size || 0), 0); return unit === 'day' ? v : Math.round((10 * v) / (ds.length || 1)) / 10; };
  chart('chPresent', {
    type: 'bar',
    data: { labels: buckets.map(bucketLabel), datasets: [{ label: unit === 'day' ? 'משגיחים' : 'ממוצע משגיחים ליום', data: buckets.map(presVal), backgroundColor: '#0b3a5b' }] },
    options: { plugins: { legend: { display: false } }, maintainAspectRatio: false },
  }, (i) => {
    const names = new Map();
    for (const d of presDays(buckets[i])) for (const [k, n] of presentByDay.get(d) || []) names.set(k, n);
    openDrill(`נכחו בעסקים שלהם · ${bucketLabel(buckets[i])}`, 'people', [...names.values()]);
  });

  const byField = (title, pairs, get) => (i) => openDrill(title + ': ' + pairs[i][0], 'sites', active.filter((x) => (get(x) || 'לא צוין') === pairs[i][0]));
  const typePairs = countBy(active, 'type').slice(0, 10), areaPairs = countBy(active, 'neighborhood').slice(0, 12), levelPairs = countBy(active, (x) => x.kosherLevel);
  chart('chType', barCfg(typePairs.map(([k, v]) => [k.length > 32 ? k.slice(0, 30) + '…' : k, v]), '#0b3a5b'), byField('סוג', typePairs, (x) => x.type));
  chart('chArea', barCfg(areaPairs, '#12a3b4'), byField('אזור', areaPairs, (x) => x.neighborhood));
  chart('chLevel', barCfg(levelPairs, '#7b61c9', false), byField('רמת כשרות', levelPairs, (x) => x.kosherLevel));

  const sup = new Map();
  for (const x of r) {
    const k = x.supervisor || 'לא ידוע';
    const o = sup.get(k) || { name: k, group: x.group, n: 0, ok: 0, sites: new Set(), mins: 0 };
    o.n++; if (inRangeClass(x) === 'ok') o.ok++; o.sites.add(x.siteName);
    o.mins += durMin(x);
    sup.set(k, o);
  }
  const rows = [...sup.values()].sort((a, b) => b.n - a.n);
  $('#supTable').innerHTML = '<thead><tr><th>שם</th><th>תפקיד</th><th>דיווחים</th><th>בתי עסק</th><th>שעות</th><th>% בטווח</th></tr></thead><tbody>' +
    rows.map((o) => {
      const pct = Math.round((100 * o.ok) / o.n);
      return `<tr><td>${plink(o.name)}</td><td>${esc(o.group)}</td><td class="num">${o.n}</td><td class="num">${o.sites.size}</td><td class="num">${(o.mins / 60).toFixed(1)}</td><td class="num" style="color:var(--${pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'bad'})">${pct}%</td></tr>`;
    }).join('') + '</tbody>';
  $('#homeSummary').innerHTML = (home || []).map((g) =>
    `<div><h4>${esc(g.title)}</h4><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');

  renderInspectors();
  renderPeopleTabs();
  renderBizSeg();
}

/* ---------- supervisors who did not report ---------- */

const NO_INSP = 'ללא מפקח';
const SILENT_COLS = [
  ['name', 'משגיח', (r) => r.name],
  ['insp', 'מפקח', (r) => r.inspectors.join(', ') || NO_INSP],
  ['sites', 'בתי עסק', (r) => r.sites.length],
  ['last', 'דיווח אחרון', (r) => lastOf(r.name)?.last || 0],
  ['days', 'ימים מאז', (r) => { const l = lastOf(r.name)?.last; return l ? Math.floor((Date.now() - l) / 864e5) : Infinity; }],
  ['phone', 'טלפון כשר', (r) => PHONE_ORDER[staffOf(r.name)?.phone] ?? 9],
  ['decl', 'הצהרה', (r) => (staffOf(r.name) ? (staffOf(r.name).declaration ? 0 : 1) : 2)],
  ['cert', 'תעודה', (r) => staffOf(r.name)?.certificate || '~'],
  ['wa', 'יש WhatsApp', (r) => ({ yes: 0, no: 1 }[staffOf(r.name)?.whatsapp] ?? 2)],
];

/* --- נתוני משגיחים מ"לוח משגיחים": טלפון, טלפון כשר, הצהרה, תעודה --- */

const PHONE_LABELS = { kosher: ['כשר', 'ok'], nonkosher: ['לא כשר', 'bad'], elderly: ['מבוגר', 'warn'], unknown: ['לא ידוע', ''] };
const PHONE_ORDER = { kosher: 0, nonkosher: 1, elderly: 2, unknown: 3 };
// התאמה לפי שם בלי תלות בסדר המילים ("חיים מרדכי שטרנברג" = "שטרנברג חיים מרדכי")
// תואר "הרב" בתחילת השם לא נחשב חלק מהשם
const nameKey = (n) => String(n || '').replace(/["'׳״.]/g, '').trim().split(/\s+/).filter((w) => w !== 'הרב').sort().join(' ');
const staffOf = (name) => state.staff && state.staff.get(nameKey(name));

async function loadStaffExtra() {
  if (state.staff) return;
  try {
    const r = await api('/staff-extra');
    state.staff = new Map((r.people || []).map((p) => [nameKey(p.name), p]));
    state.staffMeta = { importedAt: r.importedAt, count: (r.people || []).length };
  } catch { state.staff = new Map(); }
}

const tag = (text, cls) => `<span class="tag ${cls || ''}">${esc(text)}</span>`;
// שלושה תאים: טלפון כשר, הצהרה, תעודה – ואחריהם מספר הטלפון
function staffCells(name) {
  const p = staffOf(name);
  if (!p) return '<td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td>';
  const [pl, pc] = PHONE_LABELS[p.phone] || PHONE_LABELS.unknown;
  const cert = p.certificate === 'V' ? tag('יש', 'ok') : p.certificate === 'X' ? tag('אין', 'bad') : p.certificate ? tag(p.certificate, 'warn') : '<span class="muted">—</span>';
  return `<td>${tag(pl, pc)}</td><td>${p.declaration ? tag('יש', 'ok') : tag('אין', '')}</td><td>${cert}</td>
    <td><select class="wa-sel ${esc(p.whatsapp || '')}" data-staff="${esc(p.id)}" aria-label="יש WhatsApp">
      ${[['', 'לא נבדק'], ['yes', 'יש'], ['no', 'אין']].map(([v, l]) => `<option value="${v}" ${(p.whatsapp || '') === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select></td>
    <td dir="ltr" style="text-align:right">${p.tel ? `<a href="tel:${esc(p.tel.replace(/[^\d+]/g, ''))}">${esc(p.tel)}</a>${waLink(p.tel)}` : '<span class="muted">—</span>'}</td>`;
}

// שמירת הסימון "יש WhatsApp" – נשמר בשרת האפליקציה בלבד (לא באתר שירת הים)
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('select.wa-sel');
  if (!sel) return;
  const p = [...state.staff.values()].find((x) => x.id === sel.dataset.staff);
  const prev = p ? p.whatsapp || '' : '';
  try {
    await api('/staff-extra/' + encodeURIComponent(sel.dataset.staff), { method: 'POST', body: { whatsapp: sel.value } });
    if (p) p.whatsapp = sel.value;
    // אותו משגיח יכול להופיע בשתי הטבלאות – מעדכנים את כל התיבות שלו
    $$(`select.wa-sel[data-staff="${sel.dataset.staff}"]`).forEach((s) => { s.value = sel.value; s.className = 'wa-sel ' + sel.value; });
    toast('נשמר');
  } catch (err) { sel.value = prev; toast(err.message, true); }
});

// קישור WhatsApp למספר נייד ישראלי (05X). אי אפשר לדעת מראש אם המספר רשום ב-WhatsApp –
// אם לא, WhatsApp עצמו מודיע על כך כשהקישור נפתח.
function waLink(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  const intl = /^05\d{8}$/.test(d) ? '972' + d.slice(1) : /^9725\d{8}$/.test(d) ? d : null;
  if (!intl) return '';
  return ` <a class="wa" href="https://wa.me/${intl}" target="_blank" rel="noopener" title="פתיחת צ'אט WhatsApp" aria-label="WhatsApp">
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.700 6.700 0 0 1-3.300-2.900c-.3-.4.300-.4.700-1.300.100-.200 0-.300 0-.500l-.8-1.800c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.300-.2.300-.9.900-.9 2.200s.9 2.500 1.100 2.700c.100.200 1.900 2.900 4.600 4 .600.300 1.100.400 1.500.500.600.200 1.200.200 1.700.100.500-.100 1.500-.600 1.700-1.200.200-.600.200-1.100.200-1.200-.100-.100-.300-.200-.500-.300z"/></svg></a>`;
}
state.silentSort = { key: 'insp', dir: 1 };
const lastOf = (name) => state.lastReports && state.lastReports.byName.get(name);

// הדיווח האחרון של כל אחד בחצי השנה האחרונה – נטען פעם אחת ברקע
async function loadLastReports() {
  if (state.lastReports || loadLastReports.busy) return;
  loadLastReports.busy = true;
  try {
    const r = await api('/last-reports?days=180');
    state.lastReports = { days: r.days, byName: new Map(r.people.map((p) => [p.name, p])) };
  } catch (e) { state.lastReportsError = e.message; }
  loadLastReports.busy = false;
  renderSilent();
}

function renderSilent() {
  const rowsAll = state.silentRows || [];
  const loaded = !!state.lastReports;
  const names = [...new Set(rowsAll.flatMap((r) => (r.inspectors.length ? r.inspectors : [NO_INSP])))].sort((a, b) => a.localeCompare(b, 'he'));
  mselFill('msInsp', names.map((n) => [n, n]));
  mselFill('msLast', [['yes', 'דיווח בחצי השנה האחרונה'], ['never', 'לא דיווח בכלל']]);
  mselFill('msPhone', [['kosher', 'כשר'], ['nonkosher', 'לא כשר'], ['elderly', 'מבוגר'], ['unknown', 'לא ידוע'], ['none', 'לא נמצא בלוח משגיחים']]);
  mselFill('msDecl', [['yes', 'יש הצהרה'], ['no', 'אין הצהרה']]);
  mselFill('msCert', [['V', 'יש תעודה'], ['X', 'אין תעודה'], ['other', 'אחר / ריק']]);
  mselFill('msWa', [['yes', 'יש WhatsApp'], ['no', 'אין WhatsApp'], ['', 'לא נבדק']]);
  // בתוך כל סינון: אחד מהערכים שסומנו. בין הסינונים: כולם יחד.
  const fInsp = mselValues('msInsp'), fLast = mselValues('msLast'), fPhone = mselValues('msPhone'), fDecl = mselValues('msDecl'), fCert = mselValues('msCert'), fWa = mselValues('msWa');
  const never = fLast.length === 1 && fLast[0] === 'never';
  const any = (sel, v) => !sel.length || sel.includes(v);
  let rows = rowsAll.filter((r) => {
    const p = staffOf(r.name);
    return (!fInsp.length || (r.inspectors.length ? r.inspectors.some((i) => fInsp.includes(i)) : fInsp.includes(NO_INSP))) &&
      any(fPhone, p ? p.phone || 'unknown' : 'none') &&
      (!fDecl.length || (p && fDecl.includes(p.declaration ? 'yes' : 'no'))) &&
      (!fCert.length || (p && fCert.includes(p.certificate === 'V' || p.certificate === 'X' ? p.certificate : 'other'))) &&
      (!fWa.length || (p && fWa.includes(p.whatsapp || '')));
  });
  const neverCount = loaded ? rows.filter((r) => !lastOf(r.name)).length : null;
  if (fLast.length && loaded) rows = rows.filter((r) => fLast.includes(lastOf(r.name) ? 'yes' : 'never'));
  const filtered = fInsp.length + fLast.length + fPhone.length + fDecl.length + fCert.length + fWa.length > 0;

  const get = SILENT_COLS.find((c) => c[0] === state.silentSort.key)[2], dir = state.silentSort.dir;
  rows = [...rows].sort((a, b) => {
    const va = get(a), vb = get(b);
    return (typeof va === 'string' ? va.localeCompare(vb, 'he') : va === vb ? 0 : va < vb ? -1 : 1) * dir || a.name.localeCompare(b.name, 'he');
  });

  const t = state.silentTotals || { assigned: 0, silent: 0 };
  $('#silentSummary').textContent = !t.assigned ? 'אין משגיחים משויכים לעסקים שנבחרו'
    : `${t.silent} מתוך ${t.assigned} משגיחים משויכים לא דיווחו בתקופה (${Math.round((100 * t.silent) / t.assigned)}%)` +
      (filtered ? ` · ${rows.length} מתאימים לסינון` : '') +
      (loaded ? ` · ${neverCount} מהם לא דיווחו בכלל בחצי השנה האחרונה` : state.lastReportsError ? ' · בדיקת חצי השנה נכשלה' : ' · בודק דיווחים בחצי השנה האחרונה…');

  const arrow = (k) => (state.silentSort.key === k ? (state.silentSort.dir > 0 ? ' ▲' : ' ▼') : '');
  $('#silentTable').innerHTML = `<thead><tr>${SILENT_COLS.map(([k, label]) => `<th class="sortable" data-sort="${k}">${label}${arrow(k)}</th>`).join('')}<th>טלפון</th><th>שמות העסקים</th></tr></thead><tbody>` +
    (never && !loaded ? '<tr><td colspan="11" class="muted">בודק דיווחים בחצי השנה האחרונה…</td></tr>' : rows.map((r) => {
      const l = lastOf(r.name);
      const last = !loaded ? '…' : l ? fmtDate(l.last) : `<b style="color:var(--bad)">לא דיווח בכלל</b>`;
      const days = !loaded ? '…' : l ? Math.floor((Date.now() - l.last) / 864e5) : '—';
      return `<tr><td>${plink(r.name)}</td><td>${r.inspectors.length ? plinks(r.inspectors) : NO_INSP}</td><td class="num">${r.sites.length}</td><td>${last}</td><td class="num">${days}</td>${staffCells(r.name)}
        <td class="wrap"><div class="site-links">${r.sites.map((x) => `<button data-site="${x.id}" title="${esc(x.status)}">${esc(x.name)}</button>`).join('')}</div></td></tr>`;
    }).join('')) + '</tbody>';
}

$('#msClear').addEventListener('click', () => { ['msInsp', 'msLast', 'msPhone', 'msDecl', 'msCert', 'msWa'].forEach(mselClear); renderSilent(); });
$('#silentTable').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const k = th.dataset.sort;
    state.silentSort = state.silentSort.key === k ? { key: k, dir: -state.silentSort.dir } : { key: k, dir: 1 };
    return renderSilent();
  }
  const b = e.target.closest('button[data-site]');
  if (b) openSite(Number(b.dataset.site));
});

/* ---------- supervisors by inspector ---------- */

const splitNames = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const NO_SUP = 'ללא משגיח';

function renderInspectors() {
  const sel = $('#inspSel');
  const inspectors = [...new Set(state.sites.flatMap((x) => splitNames(x.inspectors)))].sort((a, b) => a.localeCompare(b, 'he'));
  const cur = sel.value;
  sel.innerHTML = inspectors.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  // ברירת מחדל: המשתמש המחובר אם הוא מפקח, אחרת הראשון ברשימה
  sel.value = inspectors.includes(cur) ? cur : inspectors.includes(state.user.name) ? state.user.name : inspectors[0] || '';
  const insp = sel.value, activeOnly = $('#inspScope').value === 'active';
  const sites = state.sites.filter((x) => splitNames(x.inspectors).includes(insp) && (!activeOnly || x.active));

  const bySup = new Map();
  for (const x of sites) {
    const names = splitNames(x.supervisors);
    for (const n of names.length ? names : [NO_SUP]) { const a = bySup.get(n) || []; a.push(x); bySup.set(n, a); }
  }
  // דיווחים בתקופה שנבחרה בדשבורד, רק בעסקים של המפקח הזה
  const ids = new Set(sites.map((x) => x.id));
  const repBy = new Map();
  for (const r of state.reports14) if (ids.has(r.siteId)) repBy.set(r.supervisor, (repBy.get(r.supervisor) || 0) + 1);

  const rows = [...bySup].sort((a, b) => (a[0] === NO_SUP) - (b[0] === NO_SUP) || b[1].length - a[1].length || a[0].localeCompare(b[0], 'he'));
  const supCount = rows.filter((r) => r[0] !== NO_SUP).length;
  const noSup = (bySup.get(NO_SUP) || []).length;
  $('#inspSummary').textContent = insp
    ? `${supCount} משגיחים ב-${sites.length} בתי עסק${activeOnly ? ' פעילים' : ''}${noSup ? ` · ${noSup} עסקים ללא משגיח` : ''}`
    : 'לא נמצאו מפקחים ברשימת העסקים';
  state.inspRows = rows;
  $('#inspTable').innerHTML = '<thead><tr><th>משגיח</th><th>בתי עסק</th><th>דיווחים בתקופה</th><th>טלפון כשר</th><th>הצהרה</th><th>תעודה</th><th>יש WhatsApp</th><th>טלפון</th><th>שמות העסקים</th></tr></thead><tbody>' +
    rows.map(([name, list], i) => `<tr><td>${name === NO_SUP ? `<b style="color:var(--bad)">${NO_SUP}</b>` : plink(name)}</td>
      <td class="num">${list.length}</td><td class="num">${name === NO_SUP ? '—' : repBy.get(name) || 0}</td>${name === NO_SUP ? '<td></td><td></td><td></td><td></td><td></td>' : staffCells(name)}
      <td class="wrap"><div class="site-links">${list.map((x) => `<button data-site="${x.id}" title="${esc(x.status)}">${esc(x.name)}</button>`).join('')}</div></td></tr>`).join('') +
    '</tbody>';
}

['#inspSel', '#inspScope'].forEach((s) => $(s).addEventListener('change', renderInspectors));
$('#inspTable').addEventListener('click', (e) => { const b = e.target.closest('button[data-site]'); if (b) openSite(Number(b.dataset.site)); });

/* ---------- filters ---------- */

// ערכי הבחירה של תפריט סינון (בחירה מרובה). רשימה ריקה = בלי סינון.
const sv = (sel) => [...$(sel).selectedOptions].map((o) => o.value).filter((v) => v !== '');
const setSv = (sel, values) => { const want = [].concat(values || []); [...$(sel).options].forEach((o) => { o.selected = want.includes(o.value); }); };
const anyOf = (picked, v) => !picked.length || picked.includes(v);

function fillSelect(sel, values, keepFirst = 1) {
  const cur = [...sel.selectedOptions].map((o) => o.value);
  const head = [...sel.options].slice(0, keepFirst).map((o) => `<option value="${esc(o.value)}">${esc(o.text)}</option>`).join('');
  sel.innerHTML = head + values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (sel.multiple) [...sel.options].forEach((o) => { o.selected = o.value !== '' && cur.includes(o.value); });
  else if ([...sel.options].some((o) => o.value === cur[0])) sel.value = cur[0];
}

function fillFilters() {
  const s = state.sites;
  const types = [...new Set(s.map((x) => x.type).filter(Boolean))].sort();
  const levels = [...new Set(s.flatMap((x) => (x.kosherLevel || '').split(',')).map((x) => x.trim()).filter(Boolean))].sort();
  // סדר התפריט: "מאושר לקבלת תעודת כשרות" ראשון (סדר אלפביתי הפוך)
  const statuses = [...new Set(s.map((x) => x.status).filter(Boolean))].sort().reverse();
  fillSelect($('#mapType'), types);
  fillSelect($('#siteType'), types);
  fillSelect($('#mapLevel'), levels);
  fillSelect($('#mapInspector'), [...new Set(s.flatMap((x) => splitNames(x.inspectors)))].sort((a, b) => a.localeCompare(b, 'he')));
  fillSelect($('#mapStatus'), statuses, 2);
  fillSelect($('#siteStatus'), statuses);
  fillSelect($('#dashRole'), [...new Set(state.reports14.map((x) => x.group).filter(Boolean))].sort());
}

/* ---------- business map ---------- */

// סגנונות מפה. ברשת עם סינון תוכן (למשל אינטרנט רימון) חלק מתמונות המפה הרגילה מוחלפות בתמונה לבנה ריקה.
// נבדק מהרשת הזו: OSM רגילה – 11 מתוך 52 אריחים נחסמו; Wikimedia – 0 מתוך 44; Esri – 0 מתוך 52.
// (CARTO נפסל: בלי מפתח API כל האריחים שלו הם כיתוב "API KEY REQUIRED". Israel Hiking נפסל: מפת טיולים בלי שמות רחובות.)
// next = הסגנון שעוברים אליו אוטומטית כשהנוכחי נחסם או לא נטען.
// שתי מפות בלבד, בלי דרישת Referer (הקובץ העצמאי נפתח מהמחשב, ואז שרתי OpenStreetMap ו-Wikimedia חוסמים אותו).
// MapTiler (נוספת כשיש מפתח) מציגה את השמות המקומיים מ-OpenStreetMap – בישראל בעברית. Esri היא הגיבוי.
const TILE_STYLES = {
  esri: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19, maxNativeZoom: 18, attribution: 'Tiles © Esri' }, next: null },
};
const MAP_STYLE_KEY = 'mapStyle4'; // מפתח חדש: מי שעבר אוטומטית ל-Esri ינסה שוב מפה בעברית
const tileLayers = new Map(); // map -> שכבת האריחים שלו
function mapStyle() {
  const def = TILE_STYLES.maptiler ? 'maptiler' : 'esri';
  try { const v = localStorage.getItem(MAP_STYLE_KEY); return TILE_STYLES[v] ? v : def; } catch { return def; }
}

function addTiles(map) {
  const style = mapStyle(), def = TILE_STYLES[style];
  const layer = L.tileLayer(def.url, def.opts);
  let failed = 0, loaded = 0;
  const fallback = () => {
    if (!def.next || mapStyle() !== style) return;
    setMapStyle(def.next);
    toast('חלק מתמונות המפה לא נטענו ברשת הזו – עברתי לסגנון מפה אחר. אפשר לשנות ב"סגנון מפה".');
  };
  // אריח שנכשל נטען מחדש עד 3 פעמים; כשכמה אריחים נכשלים סופית – עוברים לסגנון הבא
  layer.on('tileerror', (ev) => {
    const img = ev.tile, tries = Number(img.dataset.tries || 0);
    // עוברים סגנון רק כשהכשל גורף (כמה אריחים, ויותר מחצי ממה שנטען), לא בגלל אריח בודד או הזזה מהירה
    if (tries >= 3) { if (++failed >= 4 && failed > loaded / 2) fallback(); return; }
    img.dataset.tries = tries + 1;
    const u = layer.getTileUrl(ev.coords);
    setTimeout(() => { img.src = u + (u.includes('?') ? '&' : '?') + 'r=' + (tries + 1); }, 400 * (tries + 1));
  });
  // אריח שחזר כתמונה זעירה (1x1 / 1x2) נחסם בסינון הרשת
  layer.on('tileload', (ev) => { if (ev.tile.naturalWidth && ev.tile.naturalWidth < 256) fallback(); else loaded++; });
  tileLayers.set(map, layer);
  map.on('unload', () => tileLayers.delete(map));
  return layer.addTo(map);
}

// המפה בעברית מ-MapTiler, כשיש מפתח; אם היא חסומה ברשת עוברים ל-Esri
async function loadMapConfig() {
  if (loadMapConfig.done) return;
  loadMapConfig.done = true;
  let key = '';
  try { key = (await api('/config')).maptilerKey || ''; } catch {}
  if (!key) return;
  TILE_STYLES.maptiler = {
    url: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=' + encodeURIComponent(key),
    opts: { maxZoom: 20, attribution: '© MapTiler © OpenStreetMap contributors' }, next: 'esri',
  };
  $$('.map-style').forEach((sel) => {
    if (![...sel.options].some((o) => o.value === 'maptiler')) sel.querySelector('option[value="esri"]').insertAdjacentHTML('beforebegin', '<option value="maptiler">סגנון מפה: עברית (MapTiler)</option>');
    sel.value = mapStyle();
  });
  // מפה שנוצרה לפני שהמפתח נטען עוברת ל-MapTiler (אלא אם נבחרה Esri)
  if (mapStyle() === 'maptiler' && tileLayers.size) setMapStyle('maptiler');
}

function setMapStyle(style) {
  if (!TILE_STYLES[style]) return;
  try { localStorage.setItem(MAP_STYLE_KEY, style); } catch {}
  for (const [map, layer] of [...tileLayers]) { layer.remove(); tileLayers.delete(map); addTiles(map).bringToBack(); }
  $$('.map-style').forEach((sel) => { sel.value = style; });
}
document.addEventListener('change', (ev) => { if (ev.target.classList && ev.target.classList.contains('map-style')) setMapStyle(ev.target.value); });
document.addEventListener('DOMContentLoaded', () => $$('.map-style').forEach((sel) => { sel.value = mapStyle(); }));

// כפתור מסך מלא למפה; Esc או לחיצה נוספת מחזירים
function addFullscreen(m) {
  const el = m.getContainer();
  const Ctl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const box = L.DomUtil.create('div', 'leaflet-bar');
      const b = L.DomUtil.create('button', 'map-full-btn', box);
      b.type = 'button'; b.textContent = '⛶'; b.title = 'מסך מלא'; b.setAttribute('aria-label', 'מסך מלא');
      L.DomEvent.disableClickPropagation(box);
      b.onclick = () => toggle();
      this.btn = b;
      return box;
    },
  });
  const ctl = new Ctl().addTo(m);
  const toggle = (force) => {
    const on = force !== undefined ? force : !el.classList.contains('map-full');
    el.classList.toggle('map-full', on);
    document.body.classList.toggle('has-full-map', on);
    ctl.btn.textContent = on ? '✕' : '⛶';
    ctl.btn.title = on ? 'יציאה ממסך מלא' : 'מסך מלא';
    setTimeout(() => m.invalidateSize(), 50);
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.classList.contains('map-full') && $('#sheet').classList.contains('hidden')) toggle(false); });
}

function makeMap(id) {
  if (state.maps[id]) return state.maps[id];
  const m = L.map(id, { preferCanvas: true }).setView(HAIFA, 13);
  addTiles(m);
  if (id !== 'miniMap') addFullscreen(m);
  state.maps[id] = m;
  return m;
}

function sitePopup(x) {
  return `<h4>${esc(x.name)}</h4>
    <div>${esc(x.status)}</div>
    <div class="muted">${esc(x.type || '')}</div>
    <div>${esc([x.street, x.addressNote].filter(Boolean).join(' · '))}</div>
    <div>${esc([x.kosherType, x.kosherLevel].filter(Boolean).join(' · '))}</div>
    ${bizLine(x.id)}
    ${x.inspectors ? `<div>מפקח: ${plinks(x.inspectors)}</div>` : ''}
    ${x.supervisors ? `<div>משגיחים: ${plinks(x.supervisors)}</div>` : ''}
    <p><button class="btn primary" onclick="openSite(${Number(x.id)})">פרטים ועריכה</button></p>`;
}

const mapFiltersEls = ['#mapSearch', '#mapStatus', '#mapType', '#mapLevel', '#mapCluster', '#mapInspector', '#mapColorBy'];
mapFiltersEls.forEach((s) => $(s).addEventListener('input', renderBizMap));

// צבע קבוע לכל מפקח (לפי הסדר האלפביתי של כל המפקחים), כדי שהצבע לא ישתנה כשמסננים
const INSPECTOR_COLORS = ['#d64545', '#1f77d0', '#1f9d55', '#e0a106', '#7b61c9', '#f07b3f', '#12a3b4', '#c95b8b', '#6a8f2f', '#0b3a5b', '#a0522d', '#e377c2'];
const NO_INSP_COLOR = '#8795a1';
function inspectorColor(name) {
  if (!name) return NO_INSP_COLOR;
  const all = [...new Set(state.sites.flatMap((x) => splitNames(x.inspectors)))].sort((a, b) => a.localeCompare(b, 'he'));
  const i = all.indexOf(name);
  if (i < 0) return NO_INSP_COLOR;
  // אחרי שנגמרת הרשימה הקבועה – גוונים נוספים מפוזרים על גלגל הצבעים
  return i < INSPECTOR_COLORS.length ? INSPECTOR_COLORS[i] : `hsl(${Math.round((i * 137.5) % 360)}, 65%, 42%)`;
}
// המפקח שקובע את הצבע: הראשון מבין המסוננים אם יש סינון, אחרת הראשון של העסק
const siteInspector = (x, insp) => { const names = splitNames(x.inspectors); return (insp.length && names.find((n) => insp.includes(n))) || names[0] || ''; };
try { const v = localStorage.getItem('mapColorBy'); if (v) $('#mapColorBy').value = v; } catch {}
$('#mapColorBy').addEventListener('change', () => { try { localStorage.setItem('mapColorBy', $('#mapColorBy').value); } catch {} });

function renderBizMap() {
  if ($('#view-map').classList.contains('hidden') && !state.maps.bizMap) return;
  const m = makeMap('bizMap');
  if (state.layers.biz) state.layers.biz.remove();
  const q = $('#mapSearch').value.trim(), st = sv('#mapStatus'), ty = sv('#mapType'), lv = sv('#mapLevel'), cl = sv('#mapCluster'), insp = sv('#mapInspector');
  const list = state.sites.filter((x) => x.coord &&
    (!st.length || (st.includes('active') && x.active) || st.includes(x.status)) &&
    anyOf(ty, x.type) && (!lv.length || lv.some((l) => (x.kosherLevel || '').includes(l))) && (!cl.length || cl.includes(bizOf(x.id)?.cluster)) &&
    (!insp.length || splitNames(x.inspectors).some((n) => insp.includes(n))) &&
    (!q || x.name.includes(q)));
  const byInsp = $('#mapColorBy').value !== 'status';
  const layer = L.layerGroup();
  for (const x of list) {
    const fill = byInsp ? inspectorColor(siteInspector(x, insp)) : STATUS_COLORS[x.statusId] || '#999';
    L.circleMarker(x.coord, { radius: 7, color: '#fff', weight: 1.5, fillColor: fill, fillOpacity: 0.9 })
      .bindPopup(sitePopup(x)).addTo(layer);
  }
  layer.addTo(m);
  state.layers.biz = layer;
  if (list.length && (q || !renderBizMap.fitted)) { m.fitBounds(L.latLngBounds(list.map((x) => x.coord)).pad(0.1)); renderBizMap.fitted = true; }
  if (byInsp) {
    const n = new Map();
    for (const x of list) { const k = siteInspector(x, insp); n.set(k, (n.get(k) || 0) + 1); }
    const names = [...n.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'he'));
    if (n.has('')) names.push('');
    $('#mapLegend').innerHTML = `<span><b>${list.length}</b>&nbsp;על המפה</span>` + names.map((k) =>
      `<span><i class="dot" style="background:${inspectorColor(k)}"></i>${esc(k || NO_INSP)} (${n.get(k)})</span>`).join('');
    return;
  }
  const counts = countBy(list, 'status');
  $('#mapLegend').innerHTML = `<span><b>${list.length}</b>&nbsp;על המפה</span>` + counts.map(([k, n]) => {
    const id = state.sites.find((x) => x.status === k)?.statusId;
    return `<span><i class="dot" style="background:${STATUS_COLORS[id] || '#999'}"></i>${esc(k)} (${n})</span>`;
  }).join('');
}

/* ---------- coordinates cache ---------- */

async function checkCoords() {
  const missing = state.sites.filter((x) => x.active && !x.coord).length;
  const job = await api('/coords/status').catch(() => null);
  const b = $('#coordBanner');
  if (job && !job.done) {
    b.innerHTML = `<span>${LOCAL ? 'מאתר מיקומים של בתי עסק לפי הכתובת…' : 'טוען מיקומים של בתי עסק מהאתר…'} ${job.fetched}/${job.total}</span><div class="progress"><i style="width:${job.total ? (100 * job.fetched) / job.total : 0}%"></i></div>`;
    b.classList.remove('hidden');
    clearTimeout(checkCoords.t);
    checkCoords.running = true;
    checkCoords.t = setTimeout(checkCoords, 2000);
    return;
  }
  if (checkCoords.running) {
    checkCoords.running = false;
    state.sites = cleanSites(await api('/sites'));
    indexSites();
    renderDashboard(); renderBizMap(); renderSiteList();
    if (state.attReports && !$('#view-attendance').classList.contains('hidden')) showAttendance();
    if (job.error) toast(job.error, true);
    return checkCoords();
  }
  if (missing) {
    b.innerHTML = LOCAL ? `<span>ל-${missing} בתי עסק פעילים אין מיקום. אפשר להוסיף מיקום מכרטיס העסק.</span>`
      : `<span>ל-${missing} בתי עסק פעילים אין מיקום באתר "שירת הים". אפשר להוסיף מיקום מכרטיס העסק.</span><button class="btn ghost" id="loadCoords">נסה לטעון שוב</button>`;
    b.classList.remove('hidden');
    if ($('#loadCoords')) $('#loadCoords').onclick = async () => {
      await api('/coords/refresh', { method: 'POST', body: { refetch: true } });
      checkCoords();
    };
  } else b.classList.add('hidden');
}

// טעינת מיקומי העסקים הפעילים פעם אחת ברקע (נשמר בשרת)
async function autoLoadCoords() {
  if (!autoLoadCoords.started && state.sites.some((x) => x.active && !x.coord)) {
    autoLoadCoords.started = true;
    await api('/coords/refresh', { method: 'POST', body: {} }).catch(() => {});
  }
  checkCoords();
}

/* ---------- attendance ---------- */

const RANGE_COLORS = { ok: '#1f9d55', partial: '#e0a106', bad: '#d64545' };
const ROLE_COLORS = ['#4c7fd1', '#7b61c9', '#f07b3f', '#2bb3a0', '#c95b8b'];
state.attMode = 'sites';

// שעה ריקה = לא ידוע (null), ולא 00:00
const toMin = (t) => { if (!t || !String(t).includes(':')) return null; const [h, m] = String(t).split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const dayOf = (r) => (r.date ? isoDay(new Date(r.date)) : '');
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('');
const roleColor = (group) => {
  const roles = [...new Set((state.attReports || []).map((x) => x.group).filter(Boolean))].sort();
  return ROLE_COLORS[Math.max(0, roles.indexOf(group)) % ROLE_COLORS.length];
};

function ensureAttMap() {
  makeMap('attMap');
  if (!$('#attFrom').value) {
    $('#attFrom').value = isoDay(new Date());
    $('#attTo').value = isoDay(new Date());
  }
  if (state.user && !state.attLoaded) { state.attLoaded = true; loadAttendance(); }
}

$('#attLoad').addEventListener('click', loadAttendance);
$('#attRole').addEventListener('change', () => { fillAttFilters(); showAttendance(); });
$('#attInspector').addEventListener('change', () => { fillAttFilters(); showAttendance(); });
$('#attSupervisor').addEventListener('change', () => { fillAttDays(); showAttendance(); });
$('#attDay').addEventListener('change', showAttendance);
$('#attMode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  state.attMode = b.dataset.mode;
  $$('#attMode button').forEach((x) => x.classList.toggle('active', x === b));
  fillAttDays();
  showAttendance();
});

async function loadAttendance() {
  const from = $('#attFrom').value, to = $('#attTo').value;
  if (!validRange(from, to)) return;
  const days = (new Date(to) - new Date(from)) / 864e5;
  if (days > 92) toast('טווח ארוך – הטעינה עשויה להימשך עד דקה');
  $('#attLoad').disabled = true; $('#attLoad').textContent = 'טוען…';
  try {
    state.attReports = mergeReports(await api(`/reports?from=${from}&to=${to}`));
    fillAttFilters();
    showAttendance();
  } catch (e) { toast(e.message, true); }
  finally { $('#attLoad').disabled = false; $('#attLoad').textContent = 'הצג'; }
}

// המפקחים של דיווח = המפקחים של בית העסק שעליו הוא נרשם
const repInspectors = (x) => splitNames((state.siteById && state.siteById.get(x.siteId) || {}).inspectors || '');

function fillAttFilters() {
  const all = state.attReports || [];
  fillSelect($('#attRole'), [...new Set(all.map((x) => x.group).filter(Boolean))].sort());
  const roles = sv('#attRole');
  fillSelect($('#attInspector'), [...new Set(all.flatMap(repInspectors))].sort((a, b) => a.localeCompare(b, 'he')));
  const insp = sv('#attInspector');
  fillSelect($('#attSupervisor'), [...new Set(all.filter((x) => anyOf(roles, x.group) && (!insp.length || repInspectors(x).some((n) => insp.includes(n)))).map((x) => x.supervisor).filter(Boolean))].sort());
  fillAttDays();
}

function fillAttDays() {
  const isRoute = state.attMode === 'route';
  $('#attDayRow').classList.toggle('hidden', !isRoute);
  if (!isRoute) return;
  const sups = sv('#attSupervisor');
  const days = [...new Set((state.attReports || []).filter((x) => anyOf(sups, x.supervisor)).map(dayOf).filter(Boolean))].sort().reverse();
  const cur = $('#attDay').value;
  $('#attDay').innerHTML = days.map((d) => `<option value="${d}">${fmtDate(new Date(d + 'T12:00:00'))}</option>`).join('');
  if (days.includes(cur)) $('#attDay').value = cur;
}

function attFiltered() {
  const roles = sv('#attRole'), sups = sv('#attSupervisor'), insp = sv('#attInspector');
  const base = (state.attReports || []).filter((x) => anyOf(roles, x.group) && anyOf(sups, x.supervisor) &&
    (!insp.length || repInspectors(x).some((n) => insp.includes(n))));
  // סינון לפי מצב הדיווח: בלי בחירה – הכול; עם בחירה – רק המצבים המסומנים
  const picked = $$('#attStatus button.active').map((b) => b.dataset.range);
  $$('#attStatus button').forEach((b) => { $('b', b).textContent = base.filter((x) => inRangeClass(x) === b.dataset.range).length; });
  return picked.length ? base.filter((x) => picked.includes(inRangeClass(x))) : base;
}

function showAttendance() {
  if (!state.attReports) return;
  const m = makeMap('attMap');
  if (state.layers.att) state.layers.att.remove();
  const layer = L.layerGroup().addTo(m);
  state.layers.att = layer;

  let list = attFiltered();
  let pts = [];
  if (state.attMode === 'route') {
    const sups = sv('#attSupervisor'), sup = sups.length === 1 ? sups[0] : '', day = $('#attDay').value;
    if (!sup) {
      $('#attLegend').innerHTML = '<span>מסלול יומי מוצג לאדם אחד: בחר משגיח או מפקח אחד בלבד</span>';
      list = [];
    } else {
      list = list.filter((x) => dayOf(x) === day).sort((a, b) => (toMin(a.from) ?? 0) - (toMin(b.from) ?? 0));
      pts = drawRoute(layer, list);
    }
  } else if (state.attMode === 'staff') {
    pts = drawStaff(layer, list);
  } else {
    pts = drawBySite(layer, list);
  }
  if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(state.attMode === 'route' ? 0.3 : 0.15), { maxZoom: 17 }); // במסלול – מרווח לסיכות המאוחדות

  const ok = list.filter((x) => inRangeClass(x) === 'ok').length;
  const noLoc = list.filter((x) => !coordOf(x)).length;
  const mins = list.reduce((s, x) => s + durMin(x), 0);
  const roleLbl = roleWord(sv('#attRole').length === 1 ? sv('#attRole')[0] : '');
  const sitesOf = (rows) => (state.siteById ? [...new Set(rows.map((x) => x.siteId).filter(Boolean))].map((id) => state.siteById.get(id)).filter(Boolean) : []);
  const peopleOf = (rows) => [...new Set(rows.map((x) => x.supervisor).filter(Boolean))];
  // כרטיסים לחיצים: לחיצה פותחת את הנתונים הרלוונטיים (דיווחים / אנשים / עסקים)
  kpiRender('#attKpis', [
    ['', list.length, 'דיווחים', list.length ? () => openDrill('דיווחים', 'reports', list) : null],
    ['', peopleOf(list).length, roleLbl, peopleOf(list).length ? () => openDrill(roleLbl, 'people', peopleOf(list)) : null],
    ['', sitesOf(list).length, 'בתי עסק', sitesOf(list).length ? () => openDrill('בתי עסק', 'sites', sitesOf(list)) : null],
    ['', (mins / 60).toFixed(1), 'שעות מדווחות', list.length ? () => openDrill('דיווחים (לפי שעות)', 'reports', list) : null],
    [list.length && ok / list.length >= 0.8 ? 'ok' : 'warn', list.length ? Math.round((100 * ok) / list.length) + '%' : '–', 'בטווח', ok ? () => openDrill('דיווחים בטווח', 'reports', list.filter((x) => inRangeClass(x) === 'ok')) : null],
    [noLoc ? 'warn' : '', noLoc, 'בלי מיקום על המפה', noLoc ? () => openDrill('דיווחים בלי מיקום', 'reports', list.filter((x) => !coordOf(x))) : null],
  ]);

  renderAttTable(list);
  pushNav();
}

/* --- reports table: sorting + row popup --- */

const RANGE_LABELS = { ok: 'כניסה ויציאה בטווח', partial: 'חלקי', bad: 'מחוץ לטווח / לא אומת' };
const RANGE_ORDER = { ok: 0, partial: 1, bad: 2 };
// משך בדקות; 0 כשחסרה שעת כניסה או יציאה
const durMin = (x) => { const f = toMin(x.from), t = toMin(x.to); return f !== null && t !== null && t > f ? t - f : 0; };
const ATT_COLS = [
  ['range', 'מצב', (x) => RANGE_ORDER[inRangeClass(x)]],
  ['date', 'תאריך', (x) => (x.date || 0) + (toMin(x.from) || 0) * 60000],
  ['hours', 'שעות', (x) => toMin(x.from) ?? -1],
  ['dur', 'משך', durMin],
  ['name', 'שם', (x) => x.supervisor || ''],
  ['role', 'תפקיד', (x) => x.group || ''],
  ['site', 'בית עסק', (x) => x.siteName || ''],
  ['in', 'כניסה', (x) => x.statusIn || ''],
  ['out', 'יציאה', (x) => x.statusOut || ''],
  ['source', 'מקור', (x) => x.source || ''],
];
state.attSort = null; // null = ברירת מחדל (חדש קודם; במסלול – לפי שעה)

function renderAttTable(list) {
  const isRoute = state.attMode === 'route';
  const order = new Map(list.map((x, i) => [x, i + 1])); // מספר העצירה במסלול
  let rows = [...list];
  if (state.attSort) {
    const get = ATT_COLS.find((c) => c[0] === state.attSort.key)[2], dir = state.attSort.dir;
    rows.sort((a, b) => { const va = get(a), vb = get(b); return (typeof va === 'string' ? va.localeCompare(vb, 'he') : va - vb) * dir; });
  } else if (!isRoute) rows.sort((a, b) => (b.date - a.date) || String(b.from).localeCompare(a.from));
  const total = rows.length;
  rows = rows.slice(0, 500);
  state.attRows = rows;

  const arrow = (k) => (state.attSort && state.attSort.key === k ? (state.attSort.dir > 0 ? ' ▲' : ' ▼') : '');
  $('#attTable').innerHTML = `<thead><tr>${isRoute ? '<th>#</th>' : ''}${ATT_COLS.map(([k, label]) => `<th class="sortable" data-sort="${k}" title="מיון לפי ${label}">${label}${arrow(k)}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((x, i) => `<tr class="clickable" data-i="${i}">${isRoute ? `<td class="num">${order.get(x)}</td>` : ''}
      <td><i class="dot ${inRangeClass(x)}"></i> ${RANGE_LABELS[inRangeClass(x)]}</td><td>${fmtDate(x.date)}</td><td>${esc(x.from)}–${esc(x.to)}${x.merged > 1 ? ` <span class="tag warn" title="אוחדו ${x.merged} דיווחים כפולים">×${x.merged}</span>` : ''}</td><td class="num">${durMin(x) ? durMin(x) + " ד'" : '—'}</td>
      <td>${plink(x.supervisor)}</td><td>${esc(x.group)}</td><td>${esc(x.siteName)}${coordOf(x) ? '' : ' 📍?'}</td><td>${esc(x.statusIn)}</td><td>${esc(x.statusOut)}</td><td>${esc(x.source)}</td></tr>`).join('') +
    '</tbody>' + (total > rows.length ? `<caption class="muted">מוצגים ${rows.length} מתוך ${total}</caption>` : '');
}

$('#attTable').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) {
    const k = th.dataset.sort, cur = state.attSort;
    // לחיצה ראשונה – עולה, שנייה – יורד, שלישית – חזרה לברירת המחדל
    state.attSort = !cur || cur.key !== k ? { key: k, dir: 1 } : cur.dir === 1 ? { key: k, dir: -1 } : null;
    return showAttendance();
  }
  if (e.target.closest('[data-person]')) return;
  const tr = e.target.closest('tr[data-i]');
  if (tr) openReport(state.attRows[Number(tr.dataset.i)]);
});

$('#attStatus').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-range]');
  if (!b) return;
  b.classList.toggle('active');
  showAttendance();
});

function openReport(r) {
  if (!r) return;
  const site = r.siteId && state.siteById.get(r.siteId);
  const cls = inRangeClass(r);
  if (state.maps.mini) { state.maps.mini.remove(); delete state.maps.mini; }
  $('#sheetContent').innerHTML = `
    <h2>דיווח ${esc(r.group || '')}</h2>
    <p><span class="badge" style="background:${RANGE_COLORS[cls]}22;color:${RANGE_COLORS[cls]};margin:0">${RANGE_LABELS[cls]}</span></p>
    <dl class="info">
      <dt>שם</dt><dd><b>${plink(r.supervisor)}</b></dd>
      <dt>תפקיד</dt><dd>${esc(r.group || '—')}</dd>
      <dt>מפקח</dt><dd>${repInspectors(r).length ? plinks(repInspectors(r)) : '—'}</dd>
      <dt>בית עסק</dt><dd><b>${esc(r.siteName)}</b></dd>
      ${site ? `<dt>כתובת</dt><dd>${esc([site.street, site.addressNote, site.neighborhood].filter(Boolean).join(' · ') || '—')}</dd>
      <dt>סוג עסק</dt><dd>${esc(site.type || '—')}</dd>
      <dt>סטטוס עסק</dt><dd>${esc(site.status || '—')}</dd>` : ''}
      <dt>תאריך</dt><dd>${fmtDate(r.date)}</dd>
      <dt>שעות</dt><dd>${esc(r.from)}–${esc(r.to)}${durMin(r) ? ` (${durMin(r)} דקות)` : ''}</dd>
      <dt>כניסה</dt><dd><i class="dot ${r.entryInRange ? 'ok' : 'bad'}"></i> ${esc(r.statusIn || 'אין דיווח')}</dd>
      <dt>יציאה</dt><dd><i class="dot ${r.exitInRange ? 'ok' : 'bad'}"></i> ${esc(r.statusOut || 'אין דיווח')}</dd>
      <dt>מקור הדיווח</dt><dd>${esc(r.source || '—')}</dd>
      ${r.description ? `<dt>תיאור פעילות</dt><dd>${esc(r.description)}</dd>` : ''}
      <dt>מס' דיווח</dt><dd>${esc((r.ids || [r.id]).join(', '))}${r.merged > 1 ? ` (אוחדו ${r.merged} דיווחים כפולים)` : ''}</dd>
    </dl>
    ${coordOf(r) ? '<div id="miniMap" class="mini-map"></div>' : '<p class="muted">📍 לבית העסק אין מיקום, או שהדיווח רשום על אשכול.</p>'}
    <div class="row section">
      ${site ? `<button class="btn primary" id="repSite">כרטיס בית העסק</button>` : ''}
      <button class="btn ghost" id="repRoute">🧭 המסלול של ${esc(r.supervisor)} ביום הזה</button>
    </div>`;
  $('#sheet').classList.remove('hidden');
  $('#sheet').classList.remove('wide');
  state.lastReport = r;
  state.sheet = { type: 'report', id: r.id };
  pushNav();
  if (site) $('#repSite').onclick = () => openSite(site.id);
  $('#repRoute').onclick = () => { hideSheet(); window.showRouteFor(r.supervisor, dayOf(r)); $('#attMap').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  if (coordOf(r)) {
    const mini = L.map('miniMap').setView(coordOf(r), 17);
    state.maps.mini = mini;
    addTiles(mini);
    L.circleMarker(coordOf(r), { radius: 10, color: '#fff', weight: 2, fillColor: RANGE_COLORS[cls], fillOpacity: 0.9 }).addTo(mini);
    [100, 400].forEach((t) => setTimeout(() => mini.invalidateSize(), t));
  }
}

const rangeLegend = '<span><i class="dot ok"></i>כניסה ויציאה בטווח</span><span><i class="dot partial"></i>חלקי</span><span><i class="dot bad"></i>מחוץ לטווח / לא אומת</span>';

function drawBySite(layer, list) {
  const bySite = new Map();
  for (const x of list) { const c = coordOf(x); if (c) { const a = bySite.get(x.siteId) || []; a.push(x); bySite.set(x.siteId, a); } }
  for (const reps of bySite.values()) {
    const worst = reps.some((x) => inRangeClass(x) === 'bad') ? 'bad' : reps.some((x) => inRangeClass(x) === 'partial') ? 'partial' : 'ok';
    // מהחלון אפשר לפתוח דיווח בודד, את רשימת כל הדיווחים של העסק, ואת כרטיס העסק
    const sid = Number(reps[0].siteId);
    reps.sort((a, b) => (b.date - a.date) || String(b.from).localeCompare(a.from));
    const insps = repInspectors(reps[0]);
    const html = `<h4><button class="plain-link" onclick="openSite(${sid})">${esc(reps[0].siteName)}</button></h4>` +
      (insps.length ? `<div class="muted">מפקח: ${plinks(insps)}</div>` : '') + reps.slice(0, 12).map((x, i) =>
      `<div><button class="plain-link rep-line" onclick="openMapReport(${sid}, ${i})"><i class="dot ${inRangeClass(x)}"></i> ${fmtDate(x.date)} ${esc(x.from)}–${esc(x.to)}</button> · ${plink(x.supervisor)}</div>`).join('') +
      (reps.length > 12 ? `<div class="muted">ועוד ${reps.length - 12}…</div>` : '') +
      `<p class="popup-actions"><button class="btn primary" onclick="openMapReports(${sid})">רשימת הדיווחים (${reps.length})</button> <button class="btn ghost" onclick="openSite(${sid})">כרטיס העסק</button></p>`;
    L.circleMarker(coordOf(reps[0]), { radius: 6 + Math.min(reps.length, 10), color: '#fff', weight: 1.5, fillColor: RANGE_COLORS[worst], fillOpacity: 0.85 })
      .bindPopup(html).addTo(layer);
  }
  state.attBySite = bySite;
  $('#attLegend').innerHTML = rangeLegend;
  return [...bySite.values()].map((r) => coordOf(r[0]));
}
// נקראים מחלון העסק במפת הנוכחות
window.openMapReports = (siteId) => { const reps = state.attBySite && state.attBySite.get(siteId); if (reps) openDrill('דיווחים · ' + reps[0].siteName, 'reports', reps); };
window.openMapReport = (siteId, i) => { const reps = state.attBySite && state.attBySite.get(siteId); if (reps && reps[i]) openReport(reps[i]); };

// המפקחים של משגיח: המפקחים של העסקים שהוא משובץ בהם, ואם אין – של העסק שעליו דיווח
function staffInspectors(r) {
  const names = new Set(state.sites.filter((x) => splitNames(x.supervisors).includes(r.supervisor)).flatMap((x) => splitNames(x.inspectors)));
  if (!names.size) repInspectors(r).forEach((n) => names.add(n));
  names.delete(r.supervisor);
  return [...names].sort((a, b) => a.localeCompare(b, 'he'));
}

// המיקום האחרון הידוע של כל משגיח/מפקח לפי הדיווח האחרון שלו בתקופה
function drawStaff(layer, list) {
  const last = new Map();
  for (const x of list) {
    if (!coordOf(x)) continue;
    const key = x.supervisor, cur = last.get(key);
    const t = (x.date || 0) + (toMin(x.from) || 0) * 60000;
    if (!cur || t > cur.t) last.set(key, { r: x, t, n: 0 });
  }
  for (const x of list) { const o = last.get(x.supervisor); if (o) o.n++; }
  // פיזור קל כשכמה אנשים באותו עסק
  const seen = new Map();
  const pts = [];
  for (const { r, n } of last.values()) {
    const c = coordOf(r), k = c.join(','), i = seen.get(k) || 0; seen.set(k, i + 1);
    const pos = i ? [c[0] + 0.00012 * Math.cos(i * 2.1), c[1] + 0.00016 * Math.sin(i * 2.1)] : c;
    pts.push(pos);
    const color = roleColor(r.group);
    const insps = staffInspectors(r);
    L.marker(pos, { icon: L.divIcon({ className: 'staff-pin', html: `<span style="background:${color}">${esc(initials(r.supervisor))}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }) })
      .bindTooltip(esc(r.supervisor) + (insps.length ? `<div class="staff-insp">מפקח: ${esc(insps.join(', '))}</div>` : ''), { direction: 'top', offset: [0, -16], className: 'staff-label' })
      .bindPopup(`<h4>${esc(r.supervisor)}</h4><div class="muted">${esc(r.group)}</div>
        ${insps.length ? `<div>מפקח: ${plinks(insps)}</div>` : ''}
        <div>דיווח אחרון: <b>${esc(r.siteName)}</b></div>
        <div>${fmtDate(r.date)} ${esc(r.from)}–${esc(r.to)}</div>
        <div>${n} דיווחים בתקופה</div>
        <p><button class="btn ghost" onclick="showRouteFor(${esc(JSON.stringify(r.supervisor))}, '${dayOf(r)}')">🧭 מסלול היום הזה</button></p>`)
      .addTo(layer);
  }
  const roles = [...new Set(list.map((x) => x.group).filter(Boolean))].sort();
  $('#attLegend').innerHTML = `<span><b>${last.size}</b>&nbsp;אנשי צוות על המפה (לפי הדיווח האחרון)</span>` +
    roles.map((g) => `<span><i class="dot" style="background:${roleColor(g)}"></i>${esc(g)}</span>`).join('');
  return pts;
}

function drawRoute(layer, list) {
  const stops = list.filter((x) => coordOf(x));
  const line = stops.map(coordOf);
  if (line.length > 1) {
    L.polyline(line, { color: '#0b3a5b', weight: 4, opacity: 0.75, dashArray: '8 6' }).addTo(layer);
  }
  // עצירות באותו מקום (ביקור חוזר באותו עסק, או עסקים באותה כתובת) מתאחדות לסיכה אחת עם כל המספרים,
  // אחרת הסיכה האחרונה מסתירה לגמרי את המספרים שמתחתיה
  const groups = [];
  stops.forEach((x) => {
    const c = coordOf(x);
    const g = groups.find((g) => L.latLng(g.c).distanceTo(c) < 40); // סיכות קרובות יותר מזה מסתירות זו את זו
    if (g) g.items.push(x); else groups.push({ c, items: [x] });
  });
  groups.forEach((g, i) => {
    const nums = g.items.map((x) => list.indexOf(x) + 1);
    const html = g.items.map((x, j) => `<span style="background:${RANGE_COLORS[inRangeClass(x)]}">${nums[j]}</span>`).join('');
    const w = 26 * g.items.length;
    L.marker(g.c, { zIndexOffset: i, icon: L.divIcon({ className: 'route-pin', html, iconSize: [w, 26], iconAnchor: [w / 2, 13] }) })
      .bindPopup(g.items.map((x, j) => `<h4>${nums[j]}. ${esc(x.siteName)}</h4><div>${esc(x.from)}–${esc(x.to)}</div><div>כניסה: ${esc(x.statusIn || '—')}</div><div>יציאה: ${esc(x.statusOut || '—')}</div>${x.siteId ? `<p><button class="btn ghost" onclick="openSite(${Number(x.siteId)})">כרטיס עסק</button></p>` : ''}`).join('<hr>'))
      .addTo(layer);
  });
  const first = list[0], lastR = list[list.length - 1];
  $('#attLegend').innerHTML = list.length
    ? `<span><b>${esc($('#attSupervisor').value)}</b></span><span>${list.length} עצירות · ${esc(first.from)} עד ${esc(lastR.to)}</span>` + rangeLegend +
      (stops.length < list.length ? `<span>בלי מיקום על המפה: ${list.filter((x) => !coordOf(x)).map((x) => `${list.indexOf(x) + 1}. ${esc(x.siteName)}`).join(' · ')}</span>` : '')
    : '<span>אין דיווחים ביום הזה</span>';
  return line;
}

window.showRouteFor = (name, day) => {
  $('#attRole').value = '';
  $('#attInspector').value = '';
  fillAttFilters();
  $('#attSupervisor').value = name;
  state.attMode = 'route';
  $$('#attMode button').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'route'));
  fillAttDays();
  $('#attDay').value = day;
  showAttendance();
};

/* ---------- site list ---------- */

['#siteSearch', '#siteStatus', '#siteType', '#siteCluster', '#sitePaid'].forEach((s) => $(s).addEventListener('input', renderSiteList));

function renderSiteList() {
  if ($('#view-sites').classList.contains('hidden')) return;
  const q = $('#siteSearch').value.trim(), st = sv('#siteStatus'), ty = sv('#siteType'), cl = sv('#siteCluster'), pd = sv('#sitePaid');
  const list = state.sites.filter((x) => anyOf(st, x.status) && anyOf(ty, x.type) && (!cl.length || (cl.includes('__none') && !bizOf(x.id)) || cl.includes(bizOf(x.id)?.cluster)) && (!pd.length || pd.includes(x.paid === true ? 'yes' : x.paid === false ? 'no' : '-')) &&
    (!q || [x.name, x.number, x.street, x.addressNote, x.supervisors, x.inspectors, x.neighborhood].some((v) => String(v ?? '').includes(q))));
  $('#siteCount').textContent = `${list.length} בתי עסק`;
  $('#siteList').innerHTML = list.slice(0, 300).map((x) => `
    <button class="site" data-id="${x.id}">
      <h4>${esc(x.name)}<span class="badge" style="background:${STATUS_COLORS[x.statusId] || '#999'}22;color:${STATUS_COLORS[x.statusId] || '#999'}">${esc(x.status)}</span></h4>
      <p>${esc([x.type, x.neighborhood].filter(Boolean).join(' · '))}</p>
      ${bizOf(x.id) ? `<p>${esc(['אשכול ' + bizOf(x.id).cluster, bizOf(x.id).category, bizOf(x.id).grade ? 'דרגה ' + bizOf(x.id).grade : ''].filter(Boolean).join(' · '))}</p>` : ''}
      <p>${esc([x.street, x.addressNote].filter(Boolean).join(' · '))}</p>
      <p>${esc([x.kosherType, x.kosherLevel].filter(Boolean).join(' · '))}${x.coord ? '' : ' · 📍 ללא מיקום'}${x.paid === false ? ' · <b style="color:var(--bad)">לא שולם</b>' : ''}</p>
    </button>`).join('') + (list.length > 300 ? '<p class="muted">מוצגים 300 ראשונים, צמצם את החיפוש</p>' : '');
}
$('#siteList').addEventListener('click', (e) => { const b = e.target.closest('.site'); if (b) openSite(Number(b.dataset.id)); });

/* ---------- site sheet (view + edit) ---------- */

const FIELD_LABELS = {
  SiteName: 'שם בית העסק', SiteCompany: 'שם חברה / פרטי', NameWrittenOnCheque: 'השם הרשום על השיק',
  EmailAddress: 'דוא"ל', SiteDescription: 'תיאור', Comments: 'הערות',
};

function hideSheet() {
  state.sheet = null;
  $('#sheet').classList.remove('full');
  $('#sheet').classList.remove('wide');
  $('#sheet').classList.add('hidden');
  if (state.maps.mini) { state.maps.mini.remove(); delete state.maps.mini; }
}
// סגירה = צעד אחד אחורה, כך שחוזרים למה שהיה פתוח קודם (למשל מכרטיס עסק חזרה לדיווח)
function closeSheet() {
  if ($('#sheet').classList.contains('hidden')) return;
  if (state.sheet && nav.depth > 0) history.back(); else hideSheet();
}
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

async function openSite(id) {
  const s = state.sites.find((x) => x.id === id);
  $('#sheetContent').innerHTML = `<h2>${esc(s ? s.name : 'בית עסק')}</h2><div class="loading">${LOCAL ? 'טוען פרטים…' : 'טוען פרטים מהאתר…'}</div>`;
  $('#sheet').classList.remove('hidden');
  $('#sheet').classList.remove('wide');
  state.sheet = { type: 'site', id };
  pushNav();
  if (state.maps.mini) { state.maps.mini.remove(); delete state.maps.mini; }
  let d;
  try { d = await api('/site/' + id); } catch (e) { $('#sheetContent').innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }

  $('#sheetContent').innerHTML = `
    <h2>${esc(d.fields.SiteName)}</h2>
    ${s ? `<dl class="info">
      <dt>סטטוס</dt><dd>${esc(s.status)}</dd>
      <dt>אגרה</dt><dd>${s.paid === true ? tag('שולם', 'ok') : s.paid === false ? tag('לא שולם', 'bad') : '—'}</dd>
      <dt>סוג</dt><dd>${esc(s.type)}</dd>
      <dt>מס' מקומי</dt><dd>${esc(s.number)}</dd>
      <dt>כתובת</dt><dd>${esc([d.address?.street, d.address?.house, d.address?.city].filter(Boolean).join(' '))} ${esc(d.address?.comments || '')}</dd>
      <dt>כשרות</dt><dd>${esc([s.kosherType, s.kosherLevel].filter(Boolean).join(' · '))}</dd>
      <dt>משגיחים</dt><dd>${s.supervisors ? plinks(s.supervisors) : '—'}</dd>
      <dt>מפקחים</dt><dd>${s.inspectors ? plinks(s.inspectors) : '—'}</dd>
      <dt>רב מאשר</dt><dd>${esc(s.rabbi || '—')}</dd>
      ${bizRows(s.id)}
      ${d.businessOpenDate ? `<dt>תאריך פתיחה</dt><dd>${fmtDate(d.businessOpenDate)}</dd>` : ''}
    </dl>` : ''}

    ${LOCAL ? '' : `<div class="section">
      <h3>תעודות כשרות</h3>
      ${d.certificates.length ? `<div class="table-wrap"><table><thead><tr><th>סוג תעודה</th><th>כשרות</th><th>רמה</th><th>שנה / תוקף</th><th>הערה</th></tr></thead><tbody>
        ${d.certificates.map((c) => `<tr><td>${esc(c.type)}</td><td>${esc(c.kosherType)}</td><td>${esc(c.level)}</td><td>${esc(c.passoverYear || fmtDate(c.validTo))}</td><td>${esc(c.remark || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">אין תעודות</p>'}
    </div>`}

    ${s ? bizFormHtml(id) : ''}
    ${isAdmin() && !LOCAL ? `<form class="section" id="siteForm">
      <h3>עדכון פרטים</h3>
      <div class="form-grid">
        ${Object.entries(FIELD_LABELS).map(([k, label]) => `<label class="${k === 'Comments' || k === 'SiteDescription' ? 'full' : ''}">${label}
          ${k === 'Comments' || k === 'SiteDescription'
            ? `<textarea name="${k}">${esc(d.fields[k])}</textarea>`
            : `<input name="${k}" value="${esc(d.fields[k])}" ${k === 'SiteName' ? 'required' : ''} ${k === 'EmailAddress' ? 'type="email"' : ''}>`}
        </label>`).join('')}
      </div>
      <button class="btn primary" type="submit">שמירה באתר</button>
    </form>` : ''}

    <div class="section">
      <h3>מיקום על המפה</h3>
      <p class="muted">${isAdmin() ? (d.coord ? 'גרור את הסמן או לחץ על המפה כדי לשנות מיקום.' : 'אין מיקום. לחץ על המפה כדי לקבוע מיקום.') : 'לצפייה בלבד.'}</p>
      <div id="miniMap" class="mini-map"></div>
      ${isAdmin() ? `<div class="row">
        <button class="btn ghost" id="myLoc" type="button">📍 המיקום הנוכחי שלי</button>
        <button class="btn primary" id="saveLoc" type="button" disabled>${LOCAL ? 'שמירת מיקום' : 'שמירת מיקום באתר'}</button>
        <span class="muted" id="locText"></span>
      </div>` : ''}
    </div>`;

  bindBizForm(id);
  const original = { ...d.fields };
  const siteForm = $('#siteForm');
  if (siteForm) siteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, changed = {};
    for (const k of Object.keys(FIELD_LABELS)) if ((f[k].value || '') !== (original[k] || '')) changed[k] = f[k].value;
    if (!Object.keys(changed).length) return toast('לא בוצעו שינויים');
    const summary = Object.entries(changed).map(([k, v]) => `• ${FIELD_LABELS[k]}: "${original[k] || ''}" ← "${v}"`).join('\n');
    if (!confirm(`לעדכן באתר "שירת הים"?\n\n${summary}`)) return;
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      await api('/site/' + id, { method: 'POST', body: { fields: changed } });
      Object.assign(original, changed);
      toast('הפרטים עודכנו באתר');
      if (changed.SiteName && s) { s.name = changed.SiteName; renderSiteList(); }
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  });

  const mini = L.map('miniMap').setView(d.coord || (s && s.coord) || HAIFA, d.coord ? 17 : 13);
  state.maps.mini = mini;
  addTiles(mini);
  const editLoc = isAdmin(); // עדכון מיקום באתר – מנהל בלבד
  let marker = d.coord ? L.marker(d.coord, { draggable: editLoc }).addTo(mini) : null;
  let pending = null;
  const setPending = (ll) => {
    pending = [Number(ll.lat.toFixed(6)), Number(ll.lng.toFixed(6))];
    if (!marker) { marker = L.marker(ll, { draggable: editLoc }).addTo(mini); marker.on('dragend', () => setPending(marker.getLatLng())); }
    else marker.setLatLng(ll);
    const sl = $('#saveLoc'); if (sl) sl.disabled = false;
    const lt = $('#locText'); if (lt) lt.textContent = `${pending[0]}, ${pending[1]}`;
  };
  if (editLoc) {
    if (marker) marker.on('dragend', () => setPending(marker.getLatLng()));
    mini.on('click', (e) => setPending(e.latlng));
  }
  [100, 400].forEach((t) => setTimeout(() => mini.invalidateSize(), t));

  const myLocBtn = $('#myLoc');
  if (myLocBtn) myLocBtn.addEventListener('click', () => {
    if (!navigator.geolocation) return toast('הדפדפן לא תומך במיקום', true);
    navigator.geolocation.getCurrentPosition(
      (p) => { const ll = L.latLng(p.coords.latitude, p.coords.longitude); mini.setView(ll, 18); setPending(ll); },
      () => toast('לא התקבלה הרשאת מיקום', true), { enableHighAccuracy: true, timeout: 15000 });
  });
  const saveLocBtn = $('#saveLoc');
  if (saveLocBtn) saveLocBtn.addEventListener('click', async () => {
    if (!pending || !confirm(LOCAL ? `לשמור את המיקום של "${d.fields.SiteName}"? (נשמר במחשב הזה בלבד)` : `לעדכן את מיקום "${d.fields.SiteName}" באתר?`)) return;
    saveLocBtn.disabled = true;
    try {
      await api(`/site/${id}/location`, { method: 'POST', body: { lat: pending[0], lng: pending[1] } });
      if (s) s.coord = pending;
      toast(LOCAL ? 'המיקום נשמר' : 'המיקום עודכן באתר');
      renderBizMap();
    } catch (err) { toast(err.message, true); saveLocBtn.disabled = false; }
  });
}
window.openSite = openSite;

/* ---------- active / inactive status as registered on the site ---------- */

// האתר מחזיק לכל משגיח ומפקח סימון פעיל / לא פעיל. נטען פעם אחת בכל טעינת דף.
async function loadSiteStatus() {
  if (state.siteStatus) return;
  try {
    const r = await api('/staff-status');
    const m = new Map();
    // מי שמופיע גם כפעיל וגם כלא פעיל (בתפקידים שונים) נחשב פעיל
    for (const x of r.people || []) { const k = nameKey(x.name); if (x.queriedActive || !m.has(k)) m.set(k, { name: x.name, active: !!x.queriedActive, role: x.role }); }
    state.siteStatus = m;
  } catch { state.siteStatus = null; }
}
const siteStatusOf = (name) => { const s = state.siteStatus && state.siteStatus.get(nameKey(name)); return s ? (s.active ? 'active' : 'inactive') : state.siteStatus ? 'none' : 'unknown'; };
const STATUS_TAGS = { active: ['פעיל', 'ok'], inactive: ['לא פעיל', 'bad'], none: ['לא רשום באתר', 'warn'], unknown: ['…', ''] };
const statusTag = (name) => { const [l, c] = STATUS_TAGS[siteStatusOf(name)]; return tag(l, c); };

/* ---------- people: supervisors tab, inspectors tab, person sheet ---------- */

// שם לחיץ שפותח את כרטיס האדם. plinks מקבל רשימה או מחרוזת מופרדת בפסיקים.
const plink = (name) => (name ? `<button type="button" class="plink" data-person="${esc(name)}">${esc(name)}</button>` : '');
const plinks = (v) => (Array.isArray(v) ? v : splitNames(v)).map(plink).join(', ');
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-person]');
  if (b) { e.preventDefault(); openPerson(b.dataset.person); }
}, true); // בשלב ה-capture, כי חלונות המפה (Leaflet) עוצרים את הלחיצה לפני שהיא מגיעה למסמך

// אוסף את כל האנשים: משיוך לעסקים, מהדיווחים בתקופה ומנתוני "לוח משגיחים"
function buildPeople(activeOnly) {
  const sites = state.sites.filter((x) => !activeOnly || x.active);
  const sup = new Map(), insp = new Map();
  const get = (map, name) => {
    const k = nameKey(name);
    if (!map.has(k)) map.set(k, { name, sites: [], inspectors: new Set(), supervisors: new Set(), n: 0, ok: 0, mins: 0, group: '' });
    return map.get(k);
  };
  for (const x of sites) {
    const sNames = splitNames(x.supervisors), iNames = splitNames(x.inspectors);
    for (const n of sNames) { const o = get(sup, n); o.sites.push(x); iNames.forEach((i) => o.inspectors.add(i)); }
    for (const n of iNames) { const o = get(insp, n); o.sites.push(x); sNames.forEach((s) => o.supervisors.add(s)); }
  }
  for (const r of state.reports14) {
    if (!r.supervisor) continue;
    const k = nameKey(r.supervisor);
    // מי שדיווח ואינו משויך לעסק: לפי התפקיד שבדיווח
    const o = insp.get(k) || sup.get(k) || get(/מפקח/.test(r.group || '') ? insp : sup, r.supervisor);
    o.n++; if (inRangeClass(r) === 'ok') o.ok++; o.mins += durMin(r); o.group = r.group || o.group;
    if (insp.has(k) && sup.has(k)) { const o2 = sup.get(k); o2.n++; if (inRangeClass(r) === 'ok') o2.ok++; o2.mins += durMin(r); }
  }
  for (const p of (state.staff ? state.staff.values() : [])) if (!sup.has(nameKey(p.name)) && !insp.has(nameKey(p.name))) get(sup, p.name);
  // משגיחים שרשומים באתר ואינם משויכים לעסק (רובם לא פעילים) – כדי שאפשר יהיה לסנן ולראות גם אותם
  for (const [k, v] of (state.siteStatus || [])) if (v.role === 'משגיח' && !sup.has(k) && !insp.has(k)) get(sup, v.name);
  return { sup: [...sup.values()], insp: [...insp.values()] };
}

const pctCell = (ok, n) => (n ? `<span style="color:var(--${ok / n >= 0.8 ? 'ok' : ok / n >= 0.5 ? 'warn' : 'bad'})">${Math.round((100 * ok) / n)}%</span>` : '—');
const lastCell = (name) => {
  if (!state.lastReports) return '…';
  const l = lastOf(name);
  return l ? fmtDate(l.last) : '<b style="color:var(--bad)">לא דיווח בכלל</b>';
};
const sortRows = (rows, cols, sort) => {
  const get = cols.find((c) => c[0] === sort.key)[2];
  return [...rows].sort((a, b) => {
    const va = get(a), vb = get(b);
    return (typeof va === 'string' ? va.localeCompare(vb, 'he') : va === vb ? 0 : va < vb ? -1 : 1) * sort.dir || a.name.localeCompare(b.name, 'he');
  });
};
const sortHead = (cols, sort) => cols.map(([k, label]) => `<th class="sortable" data-sort="${k}">${label}${sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
const bindSort = (tableSel, stateKey) => $(tableSel).addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const s = state[stateKey], k = th.dataset.sort;
  state[stateKey] = s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: 1 };
  renderPeopleTabs();
});

const SUP_COLS = [
  ['name', 'משגיח', (r) => r.name],
  ['st', 'סטטוס באתר', (r) => ({ active: 0, inactive: 1, none: 2, unknown: 3 }[siteStatusOf(r.name)])],
  ['insp', 'מפקחים', (r) => [...r.inspectors].sort().join(', ') || '~'],
  ['sites', 'בתי עסק', (r) => r.sites.length],
  ['n', 'דיווחים בתקופה', (r) => r.n],
  ['pct', '% בטווח', (r) => (r.n ? r.ok / r.n : -1)],
  ['last', 'דיווח אחרון', (r) => lastOf(r.name)?.last || 0],
  ['phone', 'טלפון כשר', (r) => PHONE_ORDER[staffOf(r.name)?.phone] ?? 9],
  ['decl', 'הצהרה', (r) => (staffOf(r.name) ? (staffOf(r.name).declaration ? 0 : 1) : 2)],
  ['cert', 'תעודה', (r) => staffOf(r.name)?.certificate || '~'],
  ['wa', 'יש WhatsApp', (r) => ({ yes: 0, no: 1 }[staffOf(r.name)?.whatsapp] ?? 2)],
];
const INSP_COLS = [
  ['name', 'מפקח', (r) => r.name],
  ['sites', 'בתי עסק', (r) => r.sites.length],
  ['sups', 'משגיחים', (r) => r.supervisors.size],
  ['rep', 'משגיחים שדיווחו', (r) => (r.supervisors.size ? r.reporting / r.supervisors.size : -1)],
  ['n', 'דיווחים שלו בתקופה', (r) => r.n],
  ['pct', '% בטווח', (r) => (r.n ? r.ok / r.n : -1)],
  ['last', 'דיווח אחרון', (r) => lastOf(r.name)?.last || 0],
];
state.supSort = { key: 'name', dir: 1 };
state.inspSort = { key: 'sites', dir: -1 };
bindSort('#supTabTable', 'supSort');
bindSort('#inspTabTable', 'inspSort');
['#supSearch', '#supInsp', '#supPhone', '#supRep', '#supStatus', '#supScope', '#inspScope2'].forEach((s) => $(s).addEventListener('input', renderPeopleTabs));

function renderPeopleTabs() {
  if (!state.sites.length) return;
  const range = rangeText($('#dashFrom').value, $('#dashTo').value);
  const reporters = new Set(state.reports14.map((x) => nameKey(x.supervisor)));

  if (!$('#view-supervisors').classList.contains('hidden')) {
    const { sup } = buildPeople($('#supScope').value === 'active');
    fillSelect($('#supInsp'), [...new Set(sup.flatMap((r) => [...r.inspectors]))].sort((a, b) => a.localeCompare(b, 'he')));
    const q = $('#supSearch').value.trim(), fi = sv('#supInsp'), fp = sv('#supPhone'), fr = sv('#supRep'), fs = sv('#supStatus');
    const phoneHit = (r, v) => (v === 'nodecl' ? !staffOf(r.name)?.declaration : v === 'wa' ? staffOf(r.name)?.whatsapp === 'yes' : (staffOf(r.name)?.phone || 'unknown') === v);
    const repHit = (r, v) => (v === 'yes' ? r.n > 0 : v === 'no' ? r.n === 0 : v === 'never' ? state.lastReports && !lastOf(r.name) : r.sites.length === 0);
    const stOf = (r) => { const s = siteStatusOf(r.name); return s === 'unknown' ? 'active' : s; };
    let rows = sup.filter((r) => (!q || r.name.includes(q) || r.sites.some((x) => x.name.includes(q))) &&
      (!fi.length || fi.some((i) => r.inspectors.has(i))) && anyOf(fs, stOf(r)) &&
      (!fp.length || fp.some((v) => phoneHit(r, v))) && (!fr.length || fr.some((v) => repHit(r, v))));
    rows = sortRows(rows, SUP_COLS, state.supSort);
    $('#supCount').textContent = `${rows.length} משגיחים · דיווחים בתקופה ${range} (התקופה נבחרת בדשבורד)`;
    $('#supTabTable').innerHTML = `<thead><tr>${sortHead(SUP_COLS, state.supSort)}<th>טלפון</th></tr></thead><tbody>` +
      rows.slice(0, 400).map((r) => `<tr><td>${plink(r.name)}</td><td>${statusTag(r.name)}</td><td>${r.inspectors.size ? plinks([...r.inspectors].sort()) : '<span class="muted">—</span>'}</td>
        <td class="num">${r.sites.length || '<span class="muted">לא משויך</span>'}</td><td class="num">${r.n}</td><td class="num">${pctCell(r.ok, r.n)}</td><td>${lastCell(r.name)}</td>${staffCells(r.name)}</tr>`).join('') + '</tbody>';
  }

  if (!$('#view-inspectors').classList.contains('hidden')) {
    const { insp } = buildPeople($('#inspScope2').value === 'active');
    insp.forEach((r) => { r.reporting = [...r.supervisors].filter((n) => reporters.has(nameKey(n))).length; });
    const rows = sortRows(insp, INSP_COLS, state.inspSort);
    $('#inspCount').textContent = `${rows.length} מפקחים · דיווחים בתקופה ${range} (התקופה נבחרת בדשבורד)`;
    $('#inspTabTable').innerHTML = `<thead><tr>${sortHead(INSP_COLS, state.inspSort)}</tr></thead><tbody>` +
      rows.map((r) => `<tr><td>${plink(r.name)}</td><td class="num">${r.sites.length}</td><td class="num">${r.supervisors.size}</td>
        <td class="num">${r.supervisors.size ? `${r.reporting} מתוך ${r.supervisors.size} (${pctCell(r.reporting, r.supervisors.size)})` : '—'}</td>
        <td class="num">${r.n}</td><td class="num">${pctCell(r.ok, r.n)}</td><td>${lastCell(r.name)}</td></tr>`).join('') + '</tbody>';
  }
}

/* --- person sheet --- */

function openPerson(name) {
  if (!name) return;
  if (state.maps.mini) { state.maps.mini.remove(); delete state.maps.mini; }
  const key = nameKey(name);
  const asSup = state.sites.filter((x) => splitNames(x.supervisors).some((n) => nameKey(n) === key));
  const asInsp = state.sites.filter((x) => splitNames(x.inspectors).some((n) => nameKey(n) === key));
  const reps = state.reports14.filter((r) => nameKey(r.supervisor) === key).sort((a, b) => (b.date - a.date) || String(b.from).localeCompare(a.from));
  const p = staffOf(name), l = lastOf(name) || [...(state.lastReports ? state.lastReports.byName.values() : [])].find((x) => nameKey(x.name) === key);
  const roles = [asInsp.length ? 'מפקח' : '', asSup.length ? 'משגיח' : ''].filter(Boolean).join(' · ') || (reps[0] && reps[0].group) || 'לא משויך לעסק';
  const ok = reps.filter((r) => inRangeClass(r) === 'ok').length;
  const mins = reps.reduce((s, r) => s + durMin(r), 0);
  const range = rangeText($('#dashFrom').value, $('#dashTo').value);
  const act = (list) => list.filter((x) => x.active);
  const siteBtns = (list) => `<div class="site-links">${list.map((x) => `<button data-site-open="${x.id}" title="${esc(x.status)}"${x.active ? '' : ' style="opacity:.6"'}>${esc(x.name)}</button>`).join('')}</div>`;
  const [pl, pc] = PHONE_LABELS[(p && p.phone) || 'unknown'];

  // למפקח: המשגיחים שתחתיו (בעסקים הפעילים) והאם דיווחו בתקופה
  const reporters = new Set(state.reports14.map((x) => nameKey(x.supervisor)));
  const under = new Map();
  for (const x of act(asInsp)) for (const n of splitNames(x.supervisors)) under.set(n, (under.get(n) || 0) + 1);
  const underRows = [...under].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'));
  const underRep = underRows.filter(([n]) => reporters.has(nameKey(n))).length;
  const myInspectors = [...new Set(act(asSup).flatMap((x) => splitNames(x.inspectors)))].sort((a, b) => a.localeCompare(b, 'he'));

  $('#sheetContent').innerHTML = `
    <h2>${esc(name)}</h2>
    <p class="muted" style="margin-top:-6px">${esc(roles)}${p && p.active === false ? ' · <b style="color:var(--bad)">לא פעיל</b>' : ''}</p>

    <dl class="info">
      <dt>סטטוס באתר</dt><dd>${statusTag(name)}${p && p.active === false && siteStatusOf(name) === 'active' ? ' · ב"לוח משגיחים" מסומן לא פעיל' : ''}</dd>
      <dt>טלפון</dt><dd dir="ltr" style="text-align:right">${p && p.tel ? `<a href="tel:${esc(p.tel.replace(/[^\d+]/g, ''))}">${esc(p.tel)}</a>${waLink(p.tel)}` : '—'}</dd>
      ${p ? `<dt>טלפון כשר</dt><dd>${tag(pl, pc)}${p.phoneNote ? ' ' + esc(p.phoneNote) : ''}</dd>
      <dt>הצהרה</dt><dd>${p.declaration ? tag('יש', 'ok') : tag('אין', '')}</dd>
      <dt>תעודה</dt><dd>${p.certificate === 'V' ? tag('יש', 'ok') : p.certificate === 'X' ? tag('אין', 'bad') : esc(p.certificate || '—')}</dd>
      <dt>יש WhatsApp</dt><dd>${{ yes: tag('יש', 'bad'), no: tag('אין', 'ok') }[p.whatsapp] || tag('לא נבדק', '')}</dd>
      ${p.notes ? `<dt>הערות</dt><dd>${esc(p.notes)}</dd>` : ''}` : '<dt>נתוני לוח משגיחים</dt><dd class="muted">לא נמצא ב"לוח משגיחים"</dd>'}
      ${myInspectors.length ? `<dt>מפקחים</dt><dd>${plinks(myInspectors)}</dd>` : ''}
      <dt>דיווח אחרון</dt><dd>${!state.lastReports ? '…' : l ? `${fmtDate(l.last)} (${l.count} דיווחים בחצי השנה האחרונה)` : '<b style="color:var(--bad)">לא דיווח בכלל בחצי השנה האחרונה</b>'}</dd>
    </dl>

    ${personFormHtml(name)}
    <div class="kpis small section">
      <div class="kpi"><b>${reps.length}</b><span>דיווחים בתקופה</span></div>
      <div class="kpi ${reps.length ? (ok / reps.length >= 0.8 ? 'ok' : 'warn') : ''}"><b>${reps.length ? Math.round((100 * ok) / reps.length) + '%' : '–'}</b><span>בטווח</span></div>
      <div class="kpi"><b>${(mins / 60).toFixed(1)}</b><span>שעות מדווחות</span></div>
      <div class="kpi"><b>${new Set(reps.map((r) => r.siteName)).size}</b><span>עסקים שביקר</span></div>
    </div>
    <p class="muted">התקופה: ${esc(range)} (נבחרת בדשבורד)</p>
    <div class="row">
      <button class="btn primary" id="perAtt" ${reps.length ? '' : 'disabled'}>הצג בנוכחות</button>
      <button class="btn ghost" id="perRoute" ${reps.length ? '' : 'disabled'}>🧭 מסלול יומי</button>
    </div>

    ${asInsp.length ? `<div class="section"><h3>מפקח על ${act(asInsp).length} עסקים פעילים${asInsp.length > act(asInsp).length ? ` (ועוד ${asInsp.length - act(asInsp).length} לא פעילים)` : ''}</h3>
      <p class="muted">${underRows.length} משגיחים, מתוכם ${underRep} דיווחו בתקופה</p>
      <div class="table-wrap"><table><thead><tr><th>משגיח</th><th>עסקים</th><th>דיווח בתקופה</th><th>טלפון כשר</th></tr></thead><tbody>
        ${underRows.map(([n, c]) => { const sp = staffOf(n); const [a, b] = PHONE_LABELS[(sp && sp.phone) || 'unknown']; return `<tr><td>${plink(n)}</td><td class="num">${c}</td><td>${reporters.has(nameKey(n)) ? tag('דיווח', 'ok') : tag('לא דיווח', 'bad')}</td><td>${sp ? tag(a, b) : '—'}</td></tr>`; }).join('')}
      </tbody></table></div>
      <details style="margin-top:10px"><summary>רשימת העסקים (${asInsp.length})</summary>${siteBtns(asInsp)}</details></div>` : ''}

    ${act(asSup).length ? `<div class="section"><h3>משגיח ב-${act(asSup).length} עסקים פעילים${asSup.length > act(asSup).length ? ` (${asSup.length - act(asSup).length} לא פעילים מוסתרים)` : ''}</h3>${siteBtns(act(asSup))}</div>` : ''}

    <div class="section"><h3>דיווחים אחרונים בתקופה</h3>
      ${reps.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>תאריך</th><th>שעות</th><th>בית עסק</th><th>כניסה</th><th>יציאה</th></tr></thead><tbody>
        ${reps.slice(0, 30).map((r, i) => `<tr class="clickable" data-rep="${i}"><td><i class="dot ${inRangeClass(r)}"></i></td><td>${fmtDate(r.date)}</td><td>${esc(r.from)}–${esc(r.to)}</td><td>${esc(r.siteName)}</td><td>${esc(r.statusIn)}</td><td>${esc(r.statusOut)}</td></tr>`).join('')}
      </tbody></table></div>${reps.length > 30 ? `<p class="muted">מוצגים 30 מתוך ${reps.length}. לכל הדיווחים: "הצג בנוכחות".</p>` : ''}` : '<p class="muted">אין דיווחים בתקופה שנבחרה.</p>'}
    </div>`;

  $('#sheet').classList.remove('hidden');
  $('.sheet-body').scrollTop = 0;
  $('#sheet').classList.remove('wide');
  state.sheet = { type: 'person', name };
  pushNav();

  const toAttendance = (mode) => {
    const repName = reps[0].supervisor;
    $('#attFrom').value = $('#dashFrom').value;
    $('#attTo').value = $('#dashTo').value;
    state.attReports = state.reports14;
    hideSheet();
    if (mode === 'route') { go('attendance'); setTimeout(() => window.showRouteFor(repName, dayOf(reps[0])), 80); return; }
    $('#attRole').value = '';
    $('#attInspector').value = '';
    fillAttFilters();
    $('#attSupervisor').value = repName;
    state.attMode = 'sites';
    $$('#attMode button').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'sites'));
    go('attendance');
    setTimeout(showAttendance, 80);
  };
  bindPersonForm(name);
  $('#perAtt').onclick = () => toAttendance('sites');
  $('#perRoute').onclick = () => toAttendance('route');
  $('#sheetContent').onclick = (e) => {
    const sb = e.target.closest('[data-site-open]');
    if (sb) return openSite(Number(sb.dataset.siteOpen));
    const tr = e.target.closest('tr[data-rep]');
    if (tr && state.sheet && state.sheet.type === 'person') openReport(reps[Number(tr.dataset.rep)]);
  };
}
window.openPerson = openPerson;

/* ---------- business segmentation from "לוח משגיחים" ---------- */

// איחוד וריאציות כתיב של אותו ערך, כדי שלא יופיעו כשתי קבוצות נפרדות
const SEG_ALIASES = {
  'צק פוסט': "צ'ק פוסט",
  'מאפיה או קונדטוריה': 'מאפיה או קונדיטוריה',
  'מפעלי תעשיה': 'מפעלי תעשייה', 'תעשיה': 'מפעלי תעשייה',
  'איטליז ומפעלי בשר': 'אטליז ומפעלי בשר',
  'חומוסייה/פלאפל': 'חומוסיה / פלאפל',
  'גלידריה': 'גלידרייה',
  'יצחק ממו': 'יצחק מאמו', 'הושעאל סייג': 'הושעאל ניסים סייג',
};
const segNorm = (v) => { const s = String(v || '').trim(); return SEG_ALIASES[s] || s; };
// המחיר והכימות הם טקסט חופשי; נלקח המספר הראשון (למשל "4000/3000" נספר כ-4000)
const firstNum = (v) => { const m = /\d+(?:\.\d+)?/.exec(String(v || '').replace(/,/g, '')); return m ? Number(m[0]) : null; };

async function loadBizExtra() {
  if (state.bizExtra) return;
  try {
    const r = await api('/biz-extra');
    state.bizBoard = (r.businesses || []).map((b) => ({ ...b, cluster: segNorm(b.cluster), category: segNorm(b.category), inspector: segNorm(b.inspector), opinion: segNorm(b.opinion) }));
    state.bizExtra = state.bizBoard.map((b) => ({ ...b }));
    state.bizEdits = r.edits || {};
    state.bizLinks = r.links || {};
    state.bizExtraMeta = r.importedAt;
  } catch { state.bizExtra = []; }
}

['#segCluster', '#segInsp', '#segOpinion'].forEach((s) => $(s).addEventListener('change', renderBizSeg));

function renderBizSeg() {
  const all = state.bizExtra || [];
  $('#segCard').classList.toggle('hidden', !all.length);
  ['chSegCluster', 'chSegInsp', 'chSegOpinion', 'chSegGrade', 'chSegQuota', 'chSegCat'].forEach((id) => $('#' + id).closest('.card').classList.toggle('hidden', !all.length));
  if (!all.length) return;
  const uniq = (f) => [...new Set(all.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  fillSelect($('#segCluster'), uniq((b) => b.cluster));
  fillSelect($('#segInsp'), uniq((b) => b.inspector));
  fillSelect($('#segOpinion'), uniq((b) => b.opinion));
  const fc = sv('#segCluster'), fi = sv('#segInsp'), fo = sv('#segOpinion');
  const list = all.filter((b) => anyOf(fc, b.cluster) && anyOf(fi, b.inspector) && anyOf(fo, b.opinion));

  const prices = list.map((b) => firstNum(b.price)).filter((n) => n !== null);
  const quotas = list.map((b) => firstNum(b.hoursQuota)).filter((n) => n !== null);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const positive = list.filter((b) => b.opinion.startsWith('חיובי')).length;
  $('#segMeta').textContent = state.bizExtraMeta ? '· יובא ב-' + fmtDate(new Date(state.bizExtraMeta).getTime()) : '';
  const noSup = list.filter((b) => !b.sups.length);
  kpiRender('#segKpis', [
    ['', list.length, list.length === all.length ? 'עסקים בלוח' : `עסקים (מתוך ${all.length})`, () => openDrill('עסקים בלוח משגיחים', 'biz', list)],
    ['', new Set(list.map((b) => b.cluster)).size, 'אשכולות', () => openDrill('עסקים לפי אשכול', 'biz', [...list].sort((p, q) => p.cluster.localeCompare(q.cluster, 'he')))],
    ['', new Set(list.map((b) => b.category)).size, 'סיווגים', () => openDrill('עסקים לפי סיווג', 'biz', [...list].sort((p, q) => p.category.localeCompare(q.category, 'he')))],
    [positive / (list.length || 1) >= 0.7 ? 'ok' : 'warn', list.length ? Math.round((100 * positive) / list.length) + '%' : '–', 'חוות דעת חיובית', () => openDrill('חוות דעת שאינה חיובית', 'biz', list.filter((b) => !b.opinion.startsWith('חיובי')))],
    ['', sum(quotas).toLocaleString('he-IL', { maximumFractionDigits: 1 }), `סך כימות שעות (${quotas.length} עסקים)`, () => openDrill('כימות שעות – מהגבוה לנמוך', 'biz', [...list].sort((p, q) => (firstNum(q.hoursQuota) ?? -1) - (firstNum(p.hoursQuota) ?? -1)))],
    ['', '₪' + sum(prices).toLocaleString('he-IL'), `סך מחיר (${prices.length} עסקים)`, () => openDrill('מחיר – מהגבוה לנמוך', 'biz', [...list].sort((p, q) => (firstNum(q.price) ?? -1) - (firstNum(p.price) ?? -1)))],
    [noSup.length ? 'warn' : '', noSup.length, 'בלי משגיח משויך', () => openDrill('בלי משגיח משויך', 'biz', noSup)],
  ]);

  const segPick = (title, pairs, field) => (i) => openDrill(title + ': ' + pairs[i][0], 'biz', list.filter((b) => (b[field] || 'לא צוין') === pairs[i][0]));
  const pCluster = countBy(list, 'cluster'), pInsp = countBy(list, 'inspector'), op = countBy(list, 'opinion');
  chart('chSegCluster', barCfg(pCluster, '#0b3a5b'), segPick('אשכול', pCluster, 'cluster'));
  chart('chSegInsp', barCfg(pInsp, '#12a3b4'), segPick('מפקח', pInsp, 'inspector'));
  const opColor = (k) => (k.startsWith('חיובי') ? '#1f9d55' : k.startsWith('שלילי') ? '#d64545' : k.includes('מבוגר') ? '#e0a106' : k.startsWith('ללא') ? '#8795a1' : '#7b61c9');
  chart('chSegOpinion', { type: 'doughnut', data: { labels: op.map((p) => p[0]), datasets: [{ data: op.map((p) => p[1]), backgroundColor: op.map((p) => opColor(p[0])) }] },
    options: { plugins: { legend: { position: 'bottom' } }, maintainAspectRatio: false } }, segPick('חוות דעת', op, 'opinion'));
  const numFirst = (a, b) => (firstNum(a[0]) ?? 1e9) - (firstNum(b[0]) ?? 1e9) || a[0].localeCompare(b[0], 'he');
  const pGrade = countBy(list, 'grade').sort(numFirst), pQuota = countBy(list, 'hoursQuota').sort(numFirst), pCat = countBy(list, 'category').slice(0, 25);
  chart('chSegGrade', barCfg(pGrade, '#7b61c9', false), segPick('דרגה', pGrade, 'grade'));
  chart('chSegQuota', barCfg(pQuota, '#f07b3f', false), segPick('כימות שעות', pQuota, 'hoursQuota'));
  chart('chSegCat', barCfg(pCat, '#2bb3a0'), segPick('סיווג', pCat, 'category'));
  renderBizMatch();
}

/* ---------- linking "לוח משגיחים" businesses to site records (by name) ---------- */

// שם מנורמל: בלי גרשיים, סימני פיסוק, "בע"מ" ורווחים כפולים
const bizNorm = (s) => String(s || '').replace(/["'׳״`]/g, '').replace(/[-–—_/\\().,:;|+&]/g, ' ')
  .replace(/\s+/g, ' ').split(' ').filter((w) => w && w !== 'בעמ').join(' '); // \b לא עובד על אותיות עבריות, לכן מסננים מילה
const bizTokens = (s) => bizNorm(s).split(' ').filter((w) => w.length > 1);
// דמיון בין שתי מילים (1 = זהות) לפי מרחק עריכה
function wordSim(a, b) {
  if (a === b) return 1;
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 3) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}
const bizOf = (siteId) => (state.bizBySite && state.bizBySite.get(siteId)) || null;

function matchBizToSites() {
  // נבנה מחדש מהלוח המקורי בכל פעם, ואז מולבשות העריכות מהאפליקציה
  if (state.bizBoard) state.bizExtra = state.bizBoard.map((b) => ({ ...b }));
  const biz = state.bizExtra || [];
  state.bizBySite = new Map();
  if (!state.sites.length) return;
  if (!biz.length) return applyBizEdits();
  const byNorm = new Map(), byKey = new Map();
  for (const x of state.sites) {
    const n = bizNorm(x.name), k = bizTokens(x.name).sort().join(' ');
    (byNorm.get(n) || byNorm.set(n, []).get(n)).push(x);
    (byKey.get(k) || byKey.set(k, []).get(k)).push(x);
  }
  const used = new Set();
  // כשיש כמה עסקים באתר עם אותו שם: קודם פעיל, ואז לפי התאמת רחוב/אזור
  const pick = (cands, b) => {
    const addr = bizNorm(b.address), cl = bizNorm(b.cluster);
    const score = (x) => (used.has(x.id) ? -100 : 0) + (x.active ? 10 : 0) +
      (addr && bizNorm([x.street, x.addressNote].join(' ')).includes(addr) ? 5 : 0) + (cl && bizNorm(x.neighborhood).includes(cl) ? 2 : 0);
    return [...cands].sort((p, q) => score(q) - score(p))[0];
  };
  const link = (b, x, type) => { b.siteId = x.id; b.matchType = type; used.add(x.id); state.bizBySite.set(x.id, b); };
  for (const b of biz) { b.siteId = null; b.matchType = null; }

  // 0. חיבורים ידניים (עסקים שרשומים בשם אחר לגמרי באתר, למשל באנגלית)
  for (const b of biz) { const x = state.siteById.get(Number((state.bizLinks || {})[b.id])); if (x && !used.has(x.id)) link(b, x, 'linked'); }

  // 1. שם זהה (אחרי נרמול)  2. אותן מילים בסדר אחר
  for (const b of biz) {
    if (b.siteId) continue;
    const c = byNorm.get(bizNorm(b.name)) || byKey.get(bizTokens(b.name).sort().join(' '));
    const x = c && pick(c.filter((s) => !used.has(s.id)), b);
    if (x) link(b, x, 'exact');
  }
  // 3. התאמה משוערת: שם אחד מוכל בשני, או רוב המילים משותפות – רק מול עסקים פעילים שעוד לא שויכו
  const free = state.sites.filter((x) => x.active && !used.has(x.id)).map((x) => ({ x, n: bizNorm(x.name), t: new Set(bizTokens(x.name)) }));
  for (const b of biz.filter((v) => !v.siteId)) {
    const n = bizNorm(b.name), t = bizTokens(b.name), addr = bizNorm(b.address);
    if (n.length < 3) continue;
    let best = null, second = 0;
    for (const f of free) {
      if (used.has(f.x.id)) continue;
      // מילה נחשבת משותפת גם כשהכתיב מעט שונה ("מעדניה"/"מעדנייה", "סודוק"/"סודוך")
      const common = t.filter((w) => f.t.has(w) || [...f.t].some((v) => wordSim(w, v) >= 0.75)).length;
      const jac = common / (new Set([...t, ...f.t]).size || 1);
      const contains = (n.length >= 4 && f.n.includes(n)) || (f.n.length >= 4 && n.includes(f.n));
      let sc = Math.max(jac, contains ? 0.75 : 0);
      if (sc < 0.5) continue;
      if (addr && bizNorm([f.x.street, f.x.addressNote].join(' ')).includes(addr)) sc += 0.2;
      if (!best || sc > best.sc) { second = best ? best.sc : 0; best = { f, sc }; } else if (sc > second) second = sc;
    }
    // מקבלים רק התאמה ברורה: ציון גבוה, ופער ברור מהמועמד הבא
    if (best && best.sc >= 0.7 && best.sc - second >= 0.1) link(b, best.f.x, 'fuzzy');
  }
  applyBizEdits();
}

// שורה קצרה לחלון עסק במפה
function bizLine(siteId) {
  const b = bizOf(siteId);
  return b ? `<div class="muted">${esc(['אשכול ' + b.cluster, b.grade ? 'דרגה ' + b.grade : '', b.opinion ? 'חוות דעת: ' + b.opinion : ''].filter(Boolean).join(' · '))}</div>` : '';
}

// שורה בכרטיס בית העסק: האם העסק מחובר ל"לוח משגיחים" (השדות עצמם מוצגים בטופס העריכה שמתחת)
function bizRows(siteId) {
  const b = bizOf(siteId);
  if (!b) return '<dt>לוח משגיחים</dt><dd class="muted">לא נמצא ב"לוח משגיחים" – אפשר למלא את הנתונים בטופס שלמטה</dd>';
  return `<dt>לוח משגיחים</dt><dd>${b.matchType === 'fuzzy' ? `${tag('התאמה משוערת', 'warn')} לפי השם "${esc(b.name)}"` : b.matchType === 'manual' ? tag('הוזן באפליקציה', '') : b.matchType === 'linked' ? `${tag('מחובר ידנית', 'ok')} לשם בלוח "${esc(b.name)}"` : tag('מותאם', 'ok')}${b.edited ? ' ' + tag('נערך באפליקציה', '') : ''}</dd>`;
}

/* ---------- editing the extra business fields (saved in the app, for every business) ---------- */

const BIZ_FORM = [
  ['area', 'אזור'], ['cluster', 'אשכול'], ['subCluster', 'תת אשכול'], ['route', 'מסלול'], ['category', 'סיווג'], ['opinion', 'חוות דעת'], ['grade', 'דרגה'],
  ['hoursQuota', 'כימות שעות'], ['price', 'מחיר'], ['inspector', 'מפקח'], ['openHours', 'ימים ושעות פתיחה'], ['notes', 'הערות'],
];
const BIZ_LISTS = ['area', 'cluster', 'subCluster', 'category', 'opinion', 'inspector']; // שדות עם הצעות מתוך הערכים הקיימים
const BIZ_NORM = ['cluster', 'category', 'inspector', 'opinion'];

// מלביש את העריכות שנשמרו באפליקציה על נתוני הלוח; לעסק שאינו בלוח נוצרת רשומה חדשה
function applyBizEdits() {
  state.bizBySite = state.bizBySite || new Map();
  state.bizExtra = state.bizExtra || [];
  for (const [sid, e] of Object.entries(state.bizEdits || {})) {
    const site = state.siteById && state.siteById.get(Number(sid));
    if (!site) continue;
    let rec = state.bizBySite.get(site.id);
    if (!rec) {
      rec = { id: 'e' + sid, name: site.name, siteId: site.id, matchType: 'manual', sups: [], number: '', address: '' };
      BIZ_FORM.forEach(([k]) => { rec[k] = ''; });
      state.bizExtra.push(rec);
      state.bizBySite.set(site.id, rec);
    }
    for (const [k] of BIZ_FORM) if (k in e) rec[k] = BIZ_NORM.includes(k) ? segNorm(e[k]) : e[k];
    rec.edited = true;
    if ('area' in e) { if (!('neighborhoodSite' in site)) site.neighborhoodSite = site.neighborhood; site.neighborhood = e.area || site.neighborhoodSite; }
  }
}

function bizFormHtml(siteId) {
  if (!canEdit()) return ''; // צופה: ללא עריכה
  const site = state.siteById.get(siteId) || {};
  const b = { ...(bizOf(siteId) || {}) };
  if (!b.area) b.area = site.neighborhood || '';
  const all = state.bizExtra || [];
  const lists = BIZ_LISTS.map((k) => `<datalist id="dl-${k}">${[...new Set((k === 'area' ? state.sites.map((x) => x.neighborhood) : all.map((x) => x[k])).filter(Boolean))].sort((p, q) => p.localeCompare(q, 'he')).map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`).join('');
  return `<form class="section" id="bizForm">
      <h3>נתוני ניהול העסק</h3>
      <p class="muted">אזור, אשכול, סיווג, דרגה, כימות שעות ומחיר. נשמר באפליקציה בלבד (לא באתר "שירת הים").${site.neighborhoodSite !== undefined && site.neighborhoodSite !== site.neighborhood ? ` האזור באתר: ${esc(site.neighborhoodSite || 'ריק')}.` : ''}</p>
      ${lists}
      <div class="form-grid">
        ${BIZ_FORM.map(([k, label]) => `<label class="${k === 'notes' || k === 'openHours' ? 'full' : ''}">${label}
          ${k === 'notes' ? `<textarea name="${k}">${esc(b[k] || '')}</textarea>` : `<input name="${k}" value="${esc(b[k] || '')}" ${BIZ_LISTS.includes(k) ? `list="dl-${k}"` : ''} autocomplete="off">`}
        </label>`).join('')}
      </div>
      <button class="btn primary" type="submit">שמירת נתוני הניהול</button>
    </form>`;
}

function bindBizForm(siteId) {
  const f = $('#bizForm');
  if (!f) return;
  const before = Object.fromEntries(BIZ_FORM.map(([k]) => [k, f[k].value]));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const changed = {};
    for (const [k] of BIZ_FORM) if (f[k].value.trim() !== before[k].trim()) changed[k] = f[k].value.trim();
    if (!Object.keys(changed).length) return toast('לא בוצעו שינויים');
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      await api('/biz-edit/' + siteId, { method: 'POST', body: changed });
      state.bizEdits = state.bizEdits || {};
      state.bizEdits[siteId] = { ...state.bizEdits[siteId], ...changed };
      Object.assign(before, changed);
      matchBizToSites();
      renderBizSeg(); renderSiteList();
      toast('נתוני הניהול נשמרו');
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; }
  });
}

/* ---------- editing a supervisor / inspector record (saved in the app) ---------- */

function personFormHtml(name) {
  if (!canEdit()) return ''; // צופה: ללא עריכה
  const p = staffOf(name) || {};
  const opt = (v, l, cur) => `<option value="${v}" ${String(cur ?? '') === v ? 'selected' : ''}>${l}</option>`;
  const certKnown = ['', 'V', 'X'].includes(p.certificate || '');
  return `<details class="section" id="personEdit">
      <summary><b>עריכת פרטים</b> – טלפון, טלפון כשר, הצהרה, תעודה, WhatsApp, הערות</summary>
      <form id="personForm">
        <p class="muted">נשמר באפליקציה בלבד (לא באתר "שירת הים").${staffOf(name) ? '' : ' לאדם הזה עוד אין רשומה – השמירה תיצור אותה.'}</p>
        <div class="form-grid">
          <label>טלפון<input name="tel" value="${esc(p.tel || '')}" inputmode="tel" dir="ltr" autocomplete="off"></label>
          <label>טלפון כשר<select name="phone">${opt('unknown', 'לא ידוע', p.phone || 'unknown')}${opt('kosher', 'כשר', p.phone)}${opt('nonkosher', 'לא כשר', p.phone)}${opt('elderly', 'מבוגר', p.phone)}</select></label>
          <label>הערה על הטלפון<input name="phoneNote" value="${esc(p.phoneNote || '')}" autocomplete="off"></label>
          <label>הצהרה<select name="declaration">${opt('no', 'אין', p.declaration ? 'yes' : 'no')}${opt('yes', 'יש', p.declaration ? 'yes' : 'no')}</select></label>
          <label>תעודה<select name="certificate">${opt('', 'לא צוין', p.certificate || '')}${opt('V', 'יש', p.certificate)}${opt('X', 'אין', p.certificate)}${certKnown ? '' : opt(esc(p.certificate), esc(p.certificate), p.certificate)}</select></label>
          <label>יש WhatsApp<select name="whatsapp">${opt('', 'לא נבדק', p.whatsapp || '')}${opt('yes', 'יש', p.whatsapp)}${opt('no', 'אין', p.whatsapp)}</select></label>
          <label>פעיל (בלוח משגיחים)<select name="active">${opt('yes', 'פעיל', p.active === false ? 'no' : 'yes')}${opt('no', 'לא פעיל', p.active === false ? 'no' : 'yes')}</select></label>
          <label class="full">הערות<textarea name="notes">${esc(p.notes || '')}</textarea></label>
        </div>
        <button class="btn primary" type="submit">שמירה</button>
      </form>
    </details>`;
}

function bindPersonForm(name) {
  const f = $('#personForm');
  if (!f) return;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = staffOf(name);
    const data = {
      tel: f.tel.value.trim(), phone: f.phone.value, phoneNote: f.phoneNote.value.trim(), declaration: f.declaration.value === 'yes',
      certificate: f.certificate.value, whatsapp: f.whatsapp.value, active: f.active.value === 'yes', notes: f.notes.value.trim(),
    };
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try {
      const r = await api('/staff-extra/' + (p ? encodeURIComponent(p.id) : 'new'), { method: 'POST', body: p ? data : { ...data, name } });
      if (p) Object.assign(p, data, { edited: true });
      else state.staff.set(nameKey(name), { id: r.id, name, ...data, edited: true, added: true });
      toast('הפרטים נשמרו');
      nav.restoring = true; // רענון הכרטיס במקום, בלי להוסיף צעד להיסטוריה
      try { openPerson(name); } finally { nav.restoring = false; }
      renderSilent(); renderInspectors(); renderPeopleTabs();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
}

// סיכום ההתאמה + רשימות של מה שלא הותאם, בתוך אזור הפילוח בדשבורד
function renderBizMatch() {
  const biz = state.bizExtra || [], el = $('#segUnmatched');
  if (!biz.length || !state.sites.length) { el.innerHTML = ''; return; }
  const exact = biz.filter((b) => b.matchType === 'exact' || b.matchType === 'linked').length, fuzzy = biz.filter((b) => b.matchType === 'fuzzy');
  const missing = biz.filter((b) => !b.siteId);
  const notInBoard = state.sites.filter((x) => x.active && !bizOf(x.id));
  const clusters = [...new Set(biz.map((b) => b.cluster).filter(Boolean))].sort((p, q) => p.localeCompare(q, 'he'));
  fillSelect($('#mapCluster'), clusters);
  fillSelect($('#siteCluster'), clusters, 2);
  el.innerHTML = `<summary>חיבור לאתר "שירת הים": ${exact + fuzzy.length} מתוך ${biz.length} הותאמו (${exact} לפי שם זהה, ${fuzzy.length} בהתאמה משוערת) · ${missing.length} לא נמצאו באתר · ${notInBoard.length} עסקים פעילים באתר שאינם בלוח</summary>
    ${fuzzy.length ? `<h4>התאמות משוערות – כדאי לעבור עליהן (${fuzzy.length})</h4><div class="table-wrap"><table><thead><tr><th>שם בלוח משגיחים</th><th>שם באתר</th><th>אשכול</th></tr></thead><tbody>
      ${fuzzy.map((b) => `<tr><td>${esc(b.name)}</td><td><button class="plain-link" data-site-open="${b.siteId}">${esc(state.siteById.get(b.siteId)?.name)}</button></td><td>${esc(b.cluster)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${missing.length ? `<h4>בלוח משגיחים ולא נמצאו באתר (${missing.length})</h4><div class="pills">${missing.map((b) => `<span class="pill">${esc(b.name)} <small>${esc(b.cluster)}</small></span>`).join('')}</div>` : ''}
    ${notInBoard.length ? `<h4>פעילים באתר ואינם בלוח משגיחים (${notInBoard.length})</h4><div class="site-links">${notInBoard.map((x) => `<button data-site-open="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}`;
}
$('#segUnmatched').addEventListener('click', (e) => { const b = e.target.closest('[data-site-open]'); if (b) openSite(Number(b.dataset.siteOpen)); });

/* ---------- duplicate reports ---------- */

// דיווח כפול = אותו אדם, אותו עסק, אותו יום, וזמנים זהים או חופפים.
// הדיווחים מאוחדים לדיווח אחד: מהשעה המוקדמת עד המאוחרת, סטטוס הכניסה מהראשון וסטטוס היציאה מהאחרון.
function mergeReports(list) {
  const groups = new Map();
  for (const r of list) {
    const k = [nameKey(r.supervisor), r.siteName, r.date].join('|');
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    // לכל רשומה טווח [התחלה, סוף]; רשומה עם שעה אחת בלבד (למשל יציאה בלי כניסה) היא נקודה
    const span = (r) => { const f = toMin(r.from), t = toMin(r.to); return [f ?? t, t ?? f]; };
    g.sort((p, q) => (span(p)[0] ?? 0) - (span(q)[0] ?? 0) || (span(p)[1] ?? 0) - (span(q)[1] ?? 0));
    let cur = null, curStart = null, curEnd = null;
    for (const r of g) {
      const [s, e] = span(r);
      const point = s === e;
      // כפול: מתחיל באותה דקה, חופף לטווח הקיים, או נקודה שנוגעת בקצה שלו
      const dup = cur && s !== null && curStart !== null && (s === curStart || s < curEnd || (s === curEnd && (point || curStart === curEnd)));
      if (!dup) { cur = { ...r, merged: 1, ids: [r.id] }; out.push(cur); curStart = s; curEnd = e; continue; }
      cur.merged++; cur.ids.push(r.id);
      const f = toMin(r.from), t = toMin(r.to), cf = toMin(cur.from), ct = toMin(cur.to);
      if (f !== null && (cf === null || f < cf)) { cur.from = r.from; if (r.statusIn) { cur.statusIn = r.statusIn; cur.entryInRange = r.entryInRange; } }
      if (t !== null && (ct === null || t > ct)) { cur.to = r.to; if (r.statusOut) { cur.statusOut = r.statusOut; cur.exitInRange = r.exitInRange; } }
      if (!cur.statusIn && r.statusIn) { cur.statusIn = r.statusIn; cur.entryInRange = r.entryInRange; }
      if (!cur.statusOut && r.statusOut) { cur.statusOut = r.statusOut; cur.exitInRange = r.exitInRange; }
      if (r.description && !String(cur.description || '').includes(r.description)) cur.description = [cur.description, r.description].filter(Boolean).join(' · ');
      curEnd = Math.max(curEnd, e);
    }
  }
  return out;
}

/* ---------- drill-down: every dashboard number opens the records behind it ---------- */

// כרטיסי מדד לחיצים. rows: [class, value, label, onClick]
function kpiRender(sel, rows) {
  const el = $(sel);
  el.innerHTML = rows.map(([c, v, l, fn], i) => `<button type="button" class="kpi ${c} ${fn ? 'kpi-btn' : ''}" data-kpi="${i}" ${fn ? '' : 'disabled'}><b>${esc(v)}</b><span>${esc(l)}</span></button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-kpi]'); const fn = b && rows[Number(b.dataset.kpi)][3]; if (fn) fn(); };
}

// תקרת בטיחות בלבד (טווח דיווחים של שנה יכול להגיע לעשרות אלפי שורות ולהאט את הדפדפן)
const DRILL_LIMIT = 5000;
let drillSeq = 0;

function drillCols(kind) {
  const num = (v) => { const n = firstNum(v); return n === null ? -Infinity : n; };
  if (kind === 'sites') return [
    ['בית עסק', (x) => x.name, (x) => `<button class="plain-link" data-site-open="${x.id}">${esc(x.name)}</button>`],
    ['סטטוס', (x) => x.status || '', (x) => `<span class="badge" style="margin:0;background:${STATUS_COLORS[x.statusId] || '#999'}22;color:${STATUS_COLORS[x.statusId] || '#999'}">${esc(x.status)}</span>`],
    ['סוג', (x) => x.type || '', (x) => esc(x.type || '')],
    ['אזור', (x) => x.neighborhood || '', (x) => esc(x.neighborhood || '')],
    ['אשכול', (x) => bizOf(x.id)?.cluster || '', (x) => esc(bizOf(x.id)?.cluster || '')],
    ['משגיחים', (x) => x.supervisors || '', (x) => plinks(x.supervisors)],
    ['מפקחים', (x) => x.inspectors || '', (x) => plinks(x.inspectors)],
    ['אגרה', (x) => (x.paid === true ? 0 : x.paid === false ? 1 : 2), (x) => (x.paid === true ? tag('שולם', 'ok') : x.paid === false ? tag('לא שולם', 'bad') : '—')],
  ];
  if (kind === 'reports') return [
    ['מצב', (x) => RANGE_ORDER[inRangeClass(x)], (x) => `<i class="dot ${inRangeClass(x)}"></i> ${RANGE_LABELS[inRangeClass(x)]}`],
    ['תאריך', (x) => (x.date || 0) + (toMin(x.from) ?? toMin(x.to) ?? 0) * 60000, (x) => fmtDate(x.date)],
    ['שעות', (x) => toMin(x.from) ?? toMin(x.to) ?? -1, (x) => `${esc(x.from)}–${esc(x.to)}${x.merged > 1 ? ` <span class="tag warn">×${x.merged}</span>` : ''}`],
    ['משך', (x) => durMin(x), (x) => (durMin(x) ? durMin(x) + " ד'" : '—'), 'num'],
    ['שם', (x) => x.supervisor || '', (x) => plink(x.supervisor)],
    ['תפקיד', (x) => x.group || '', (x) => esc(x.group || '')],
    ['בית עסק', (x) => x.siteName || '', (x) => esc(x.siteName)],
    ['כניסה', (x) => x.statusIn || '', (x) => esc(x.statusIn || '')],
    ['יציאה', (x) => x.statusOut || '', (x) => esc(x.statusOut || '')],
  ];
  if (kind === 'people') {
    const cnt = new Map();
    for (const r of state.reports14) cnt.set(nameKey(r.supervisor), (cnt.get(nameKey(r.supervisor)) || 0) + 1);
    const p = (n) => staffOf(n);
    return [
      ['שם', (n) => n, (n) => plink(n)],
      ['סטטוס באתר', (n) => ({ active: 0, inactive: 1, none: 2, unknown: 3 }[siteStatusOf(n)]), (n) => statusTag(n)],
      ['דיווחים בתקופה', (n) => cnt.get(nameKey(n)) || 0, (n) => (cnt.get(nameKey(n)) ? cnt.get(nameKey(n)) : tag('לא דיווח', 'bad')), 'num'],
      ['דיווח אחרון', (n) => lastOf(n)?.last || 0, (n) => lastCell(n)],
      ['טלפון כשר', (n) => PHONE_ORDER[p(n)?.phone] ?? 9, null],
      ['הצהרה', (n) => (p(n) ? (p(n).declaration ? 0 : 1) : 2), null],
      ['תעודה', (n) => p(n)?.certificate || '~', null],
      ['יש WhatsApp', (n) => ({ yes: 0, no: 1 }[p(n)?.whatsapp] ?? 2), null],
      ['טלפון', (n) => p(n)?.tel || '~', (n) => staffCells(n), 'raw5'], // staffCells מחזיר את חמשת התאים האחרונים יחד
    ];
  }
  if (kind === 'requests') return [
    ['עסק', (r) => r.site.name, (r) => `<button class="plain-link" data-site-open="${r.site.id}">${esc(r.site.name)}</button>`],
    ['סטטוס', (r) => r.site.status || '', (r) => `<span class="badge" style="margin:0;background:${STATUS_COLORS[r.site.statusId] || '#999'}22;color:${STATUS_COLORS[r.site.statusId] || '#999'}">${esc(r.site.status)}</span>`],
    ['הבקשה נפתחה', (r) => r.opened || 0, (r) => (r.opened ? fmtDate(r.opened) : '<span class="muted">אין היסטוריה</span>')],
    ['אושרה', (r) => r.approved || 0, (r) => (r.approved ? fmtDate(r.approved) : tag('ממתינה', 'warn'))],
    ['ימים', (r) => r.days ?? -1, (r) => (r.days === null ? '—' : r.days), 'num'],
    ['אזור', (r) => r.site.neighborhood || '', (r) => esc(r.site.neighborhood || '')],
    ['סוג', (r) => r.site.type || '', (r) => esc(r.site.type || '')],
    ['מפקחים', (r) => r.site.inspectors || '', (r) => plinks(r.site.inspectors)],
  ];
  return [ // biz
    ['עסק', (b) => b.name, (b) => (b.siteId ? `<button class="plain-link" data-site-open="${b.siteId}">${esc(b.name)}</button>` : esc(b.name) + ' <span class="muted" title="לא נמצא באתר שירת הים">·לא באתר</span>')],
    ['אשכול', (b) => b.cluster, (b) => esc(b.cluster)],
    ['תת אשכול', (b) => b.subCluster, (b) => esc(b.subCluster)],
    ['סיווג', (b) => b.category, (b) => esc(b.category)],
    ['חוות דעת', (b) => b.opinion, (b) => esc(b.opinion)],
    ['דרגה', (b) => num(b.grade), (b) => esc(b.grade), 'num'],
    ['כימות שעות', (b) => num(b.hoursQuota), (b) => esc(b.hoursQuota), 'num'],
    ['מחיר', (b) => num(b.price), (b) => esc(b.price), 'num'],
    ['מפקח', (b) => b.inspector, (b) => plink(b.inspector)],
  ];
}

function openDrill(title, kind, items) {
  if (state.maps.mini) { state.maps.mini.remove(); delete state.maps.mini; }
  const reuse = state.drill && state.drill.items === items && state.drill.title === title;
  state.drill = reuse ? state.drill : { id: ++drillSeq, title, kind, items, sort: null };
  const d = state.drill, cols = drillCols(kind);
  let list = items;
  if (d.sort) {
    const get = cols[d.sort.i][1], dir = d.sort.dir;
    list = [...items].sort((a, b) => { const va = get(a), vb = get(b); return (typeof va === 'string' ? va.localeCompare(String(vb), 'he') : va === vb ? 0 : va < vb ? -1 : 1) * dir; });
  }
  const shown = list.slice(0, DRILL_LIMIT);
  const head = cols.map(([label], i) => `<th class="sortable" data-dsort="${i}" title="מיון לפי ${label}">${label}${d.sort && d.sort.i === i ? (d.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const rowHtml = (x) => cols.map(([, , cell, cls]) => (cell === null ? '' : cls === 'raw5' ? cell(x) : `<td${cls === 'num' ? ' class="num"' : ''}>${cell(x)}</td>`)).join('');
  const rows = shown.map((x, i) => `<tr${kind === 'reports' ? ` class="clickable" data-rep="${i}"` : ''}>${rowHtml(x)}</tr>`).join('');

  $('#sheetContent').innerHTML = `<h2>${esc(title)}</h2>
    <p class="muted">${items.length} רשומות${items.length > shown.length ? ` · מוצגות ${shown.length} ראשונות` : ''} · לחיצה על כותרת עמודה ממיינת</p>
    ${items.length ? `<div class="table-wrap tall"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">אין רשומות.</p>'}`;
  $('#sheet').classList.remove('hidden');
  $('#sheet').classList.add('wide');
  if (!reuse) $('.sheet-body').scrollTop = 0;
  state.sheet = { type: 'drill', id: d.id };
  pushNav();
  $('#sheetContent').onclick = (e) => {
    const th = e.target.closest('th[data-dsort]');
    if (th) {
      // לחיצה ראשונה – עולה, שנייה – יורד, שלישית – חזרה לסדר המקורי
      const i = Number(th.dataset.dsort), s = d.sort;
      d.sort = !s || s.i !== i ? { i, dir: 1 } : s.dir === 1 ? { i, dir: -1 } : null;
      return openDrill(d.title, d.kind, d.items);
    }
    if (e.target.closest('[data-person]')) return;
    const sb = e.target.closest('[data-site-open]');
    if (sb) return openSite(Number(sb.dataset.siteOpen));
    const tr = e.target.closest('tr[data-rep]');
    if (tr && state.sheet && state.sheet.type === 'drill') openReport(shown[Number(tr.dataset.rep)]);
  };
}

/* ---------- wording by selected role ---------- */

// כשמסננים לפי תפקיד, הכיתוב מדבר רק על אותו תפקיד ("משגיחים" / "מפקחים")
function roleWord(role, joiner = '/') {
  if (!role) return 'משגיחים' + joiner + 'מפקחים';
  if (/מפקח/.test(role)) return 'מפקחים';
  if (/משגיח/.test(role)) return 'משגיחים';
  return role;
}

/* ---------- multi-select filter (checkbox dropdown) ---------- */

// <div class="msel" id="..." data-label="..."> – נבנה פעם אחת, ואחר כך רק מתעדכנות האפשרויות בלי לאבד את הבחירה
function mselFill(id, options) {
  const el = $('#' + id);
  const sig = JSON.stringify(options);
  if (el.dataset.sig === sig) return;
  const keep = new Set(mselValues(id));
  el.dataset.sig = sig;
  el.innerHTML = `<button type="button" class="msel-btn" aria-haspopup="true" aria-expanded="false"><span class="msel-text"></span><span class="msel-caret">▾</span></button>
    <div class="msel-pop hidden">${options.length > 8 ? '<input type="search" class="msel-q" placeholder="חיפוש…" aria-label="חיפוש ברשימה">' : ''}${options.map(([v, l]) => `<label><input type="checkbox" value="${esc(v)}" ${keep.has(String(v)) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
  mselLabel(el);
}
const mselValues = (id) => $$('#' + id + ' input:checked').map((i) => i.value);
const mselClear = (id) => { $$('#' + id + ' input:checked').forEach((i) => { i.checked = false; }); mselLabel($('#' + id)); };
function mselLabel(el) {
  const picked = $$('input:checked', el).map((i) => i.parentElement.textContent.trim());
  $('.msel-text', el).textContent = el.dataset.label + (picked.length === 0 ? ': הכול' : picked.length === 1 ? ': ' + picked[0] : ` (${picked.length})`);
  el.classList.toggle('on', picked.length > 0);
}
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.msel-btn');
  $$('.msel-pop').forEach((p) => {
    const mine = btn && p.parentElement === btn.parentElement;
    const open = mine ? p.classList.contains('hidden') : !p.classList.contains('hidden') && !!e.target.closest('.msel-pop') && p.contains(e.target);
    p.classList.toggle('hidden', !open);
    $('.msel-btn', p.parentElement).setAttribute('aria-expanded', String(open));
  });
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('.msel');
  if (!el) return;
  mselLabel(el);
  if (el.closest('#view-dashboard')) renderSilent();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $$('.msel-pop').forEach((p) => p.classList.add('hidden')); });

/* ---------- sheet tools: full screen + search inside the open window ---------- */

$('#sheetFull').addEventListener('click', () => {
  const on = $('#sheet').classList.toggle('full');
  $('#sheetFull').setAttribute('aria-pressed', String(on));
  $('#sheetFull').title = on ? 'יציאה ממסך מלא' : 'מסך מלא';
  Object.values(state.maps).forEach((m) => setTimeout(() => m.invalidateSize(), 60));
});

// החיפוש מסנן את שורות הטבלאות שבחלון הפתוח (כל טקסט בשורה). מוצג רק כשיש בחלון טבלה ארוכה.
function filterSheet() {
  const q = $('#sheetSearch').value.trim().toLowerCase();
  const rows = $$('#sheetContent tbody tr');
  let shown = 0;
  for (const tr of rows) { const hit = !q || tr.textContent.toLowerCase().includes(q); tr.style.display = hit ? '' : 'none'; if (hit) shown++; }
  $('#sheetSearchCount').textContent = q ? `${shown} מתוך ${rows.length}` : '';
}
$('#sheetSearch').addEventListener('input', filterSheet);
let sheetKey = '';
new MutationObserver(() => {
  const key = JSON.stringify(state.sheet);
  if (key !== sheetKey) { sheetKey = key; $('#sheetSearch').value = ''; } // חלון אחר – חיפוש חדש; מיון באותו חלון שומר את החיפוש
  $('#sheetSearch').classList.toggle('hidden', $$('#sheetContent tbody tr').length < 8);
  filterSheet();
}).observe($('#sheetContent'), { childList: true });

/* ---------- searchable dropdowns ---------- */

// הופך <select> רגיל לתפריט עם שדה חיפוש בהקלדה חופשית. ה-select המקורי נשאר (מוסתר) ומקבל את הערך
// ואת אירועי input/change, כך שכל הקוד שמאזין לו ממשיך לעבוד בלי שינוי.
const SEARCHABLE_SELECTS = '#attSupervisor, #attInspector, #inspSel, #supInsp, #segInsp, #segCluster, #segOpinion, #mapStatus, #mapType, #mapLevel, #mapCluster, #mapInspector, #siteStatus, #siteType, #sitePaid, #siteCluster, #dashRole, #attRole, #supPhone, #supRep, #supStatus';
const ssList = [];
function enhanceSelect(sel) {
  if (sel.dataset.ss) return;
  sel.dataset.ss = '1';
  sel.classList.add('ss-native');
  sel.tabIndex = -1;
  const box = document.createElement('div');
  box.className = 'ss';
  box.innerHTML = '<button type="button" class="ss-btn" aria-haspopup="listbox" aria-expanded="false"><span class="ss-text"></span><span class="msel-caret">▾</span></button>' +
    '<div class="ss-pop hidden"><input type="search" class="ss-q" placeholder="הקלד לחיפוש…" aria-label="חיפוש"><div class="ss-list" role="listbox"></div></div>';
  sel.insertAdjacentElement('afterend', box);
  const btn = $('.ss-btn', box), pop = $('.ss-pop', box), q = $('.ss-q', box), list = $('.ss-list', box);
  const multi = sel.multiple;
  const chosen = () => [...sel.selectedOptions].filter((o) => o.value !== '');
  const label = () => {
    let t;
    if (!multi) { const o = sel.selectedOptions[0]; t = o ? o.text : ''; }
    else { const c = chosen(), all = [...sel.options].find((o) => o.value === ''); t = c.length === 0 ? (all ? all.text : 'הכול') : c.length === 1 ? c[0].text : c.length + ' נבחרו'; }
    if ($('.ss-text', box).textContent !== t) $('.ss-text', box).textContent = t;
    box.classList.toggle('on', multi && chosen().length > 0);
  };
  const render = () => {
    const f = q.value.trim().toLowerCase();
    const opts = [...sel.options].filter((o) => (!multi || o.value !== '') && (!f || o.text.toLowerCase().includes(f)));
    list.innerHTML = (multi && chosen().length ? '<button type="button" class="ss-clear" data-clear="1">ניקוי הבחירה</button>' : '') +
      (opts.map((o) => `<button type="button" role="option" aria-selected="${multi ? o.selected : o.value === sel.value}" data-v="${esc(o.value)}" class="${(multi ? o.selected : o.value === sel.value) ? 'sel' : ''}">${multi ? `<span class="ss-check">${o.selected ? '✓' : ''}</span>` : ''}${esc(o.text)}</button>`).join('') || '<div class="muted ss-empty">לא נמצא</div>');
  };
  const close = () => { pop.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    ssList.forEach((x) => x.close());
    q.value = ''; render();
    pop.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true');
    q.focus();
    const cur = $('.sel', list); if (cur) cur.scrollIntoView({ block: 'nearest' });
  };
  const fire = () => { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); };
  const pick = (v) => {
    if (multi) { // בחירה מרובה: מסמנים / מבטלים, והתפריט נשאר פתוח
      const o = [...sel.options].find((x) => x.value === v); if (o) o.selected = !o.selected;
      [...sel.options].forEach((x) => { if (x.value === '') x.selected = false; });
      label(); render(); fire(); return;
    }
    sel.value = v; label(); close(); btn.focus();
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
  btn.addEventListener('click', () => (pop.classList.contains('hidden') ? open() : close()));
  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const first = $('button[data-v]', list); if (first) pick(first.dataset.v); }
    if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); }
  });
  list.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { [...sel.options].forEach((o) => { o.selected = false; }); label(); render(); fire(); return; }
    const b = e.target.closest('button[data-v]'); if (b) pick(b.dataset.v);
  });
  ssList.push({ box, close, label });
  label();
}
$$(SEARCHABLE_SELECTS).forEach(enhanceSelect);
document.addEventListener('click', (e) => ssList.forEach((x) => { if (!x.box.contains(e.target)) x.close(); }));
// הערך והאפשרויות של ה-select משתנים גם מהקוד (בלי אירוע), לכן הכיתוב מסונכרן מחזורית
setInterval(() => ssList.forEach((x) => x.label()), 400);

// חיפוש בתוך תפריט בחירה מרובה
document.addEventListener('input', (e) => {
  if (!e.target.classList || !e.target.classList.contains('msel-q')) return;
  const f = e.target.value.trim().toLowerCase();
  $$('label', e.target.parentElement).forEach((l) => { l.style.display = !f || l.textContent.toLowerCase().includes(f) ? '' : 'none'; });
});

/* ---------- new certificate requests and handling time (from each business's status history) ---------- */

// לכל עסק: מתי נכנס ל"בתהליך פתיחה" (פתיחת הבקשה) ומתי עבר ל"מאושר לקבלת תעודת כשרות".
// לעסקים ותיקים אין היסטוריה באתר, ולכן הם לא נכללים בחישוב זמן הטיפול.
function requestRows() {
  const out = [];
  for (const [sid, rows0] of Object.entries(state.trails || {})) {
    const site = state.siteById.get(Number(sid));
    if (!site || !rows0.length) continue;
    const rows = rows0.filter((r) => r.at).sort((a, b) => a.at - b.at);
    const isOpen = (r) => r.toId === 1 || /בתהליך פתיחה/.test(r.to || '');
    const isOk = (r) => r.toId === 2 || /^מאושר לקבלת/.test(r.to || '');
    const o = rows.find(isOpen);
    if (!o) continue;
    const a = rows.find((r) => isOk(r) && r.at >= o.at);
    const end = a ? a.at : Date.now();
    out.push({ site, opened: o.at, approved: a ? a.at : null, days: Math.max(0, Math.round((end - o.at) / 864e5)), pending: !a && site.statusId === 1 });
  }
  return out;
}

async function ensureTrails() {
  if (ensureTrails.started) return;
  ensureTrails.started = true;
  try {
    await api('/trails/refresh', { method: 'POST', body: {} });
    for (;;) {
      const r = await api('/trails');
      state.trails = r.trails;
      state.trailJob = r.job;
      renderRequests();
      if (r.job.done) break;
      await new Promise((res) => setTimeout(res, 2500));
    }
  } catch (e) { state.trailError = e.message; ensureTrails.started = false; renderRequests(); }
}

function renderRequests() {
  const el = $('#reqKpis');
  if (!el || !state.sites.length) return;
  const job = state.trailJob, rows = requestRows();
  const now = Date.now(), DAY = 864e5, yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const inProcess = state.sites.filter((x) => x.statusId === 1);
  const pending = rows.filter((r) => r.pending).sort((a, b) => b.days - a.days);
  const new30 = rows.filter((r) => now - r.opened <= 30 * DAY), newYear = rows.filter((r) => r.opened >= yearStart);
  const done = rows.filter((r) => r.approved), doneYear = done.filter((r) => r.approved >= yearStart), done12 = done.filter((r) => now - r.approved <= 365 * DAY);
  const avg = (a) => (a.length ? Math.round(a.reduce((s, r) => s + r.days, 0) / a.length) : null);
  const median = (a) => { if (!a.length) return null; const d = a.map((r) => r.days).sort((x, y) => x - y); return d.length % 2 ? d[(d.length - 1) / 2] : Math.round((d[d.length / 2 - 1] + d[d.length / 2]) / 2); };
  const d = (v) => (v === null ? '–' : v + ' ימים');
  const loading = job && !job.done;

  $('#reqNote').textContent = state.trailError ? 'טעינת ההיסטוריה נכשלה: ' + state.trailError
    : loading ? `טוען היסטוריית סטטוסים מהאתר… ${job.fetched} מתוך ${job.total}`
    : !state.trails ? 'טוען…'
    : `לפי היסטוריית הסטטוסים באתר: מהכניסה ל"בתהליך פתיחה" ועד "מאושר לקבלת תעודת כשרות". יש היסטוריה ל-${rows.length} עסקים פעילים; לעסקים ותיקים אין.`;
  const open = (title, list, sortKey) => () => openDrill(title, 'requests', [...list].sort((a, b) => b[sortKey] - a[sortKey]));
  kpiRender('#reqKpis', [
    [inProcess.length ? 'warn' : 'ok', inProcess.length, 'בתהליך פתיחה עכשיו', () => openDrill('בתהליך פתיחה עכשיו', 'requests', inProcess.map((x) => rows.find((r) => r.site.id === x.id) || { site: x, opened: null, approved: null, days: null, pending: true }).sort((a, b) => (b.days ?? -1) - (a.days ?? -1)))],
    ['', new30.length, 'בקשות חדשות ב-30 הימים האחרונים', open('בקשות חדשות ב-30 הימים האחרונים', new30, 'opened')],
    ['', newYear.length, `בקשות חדשות מתחילת ${new Date().getFullYear()}`, open('בקשות חדשות מתחילת השנה', newYear, 'opened')],
    ['ok', doneYear.length, `אושרו מתחילת ${new Date().getFullYear()}`, open('בקשות שאושרו מתחילת השנה', doneYear, 'approved')],
    ['', d(avg(done12)), `זמן טיפול ממוצע עד אישור (${done12.length} בקשות, 12 חודשים)`, open('בקשות שאושרו ב-12 החודשים האחרונים – לפי זמן טיפול', done12, 'days')],
    ['', d(median(done12)), 'זמן טיפול חציוני', open('בקשות שאושרו ב-12 החודשים האחרונים – לפי זמן טיפול', done12, 'days')],
    [pending.length && pending[0].days > 60 ? 'bad' : '', pending.length ? d(pending[0].days) : '–', pending.length ? `ההמתנה הארוכה ביותר: ${pending[0].site.name}` : 'אין בקשות ממתינות', pending.length ? () => openSite(pending[0].site.id) : null],
  ]);
}

/* ---------- keep-alive ---------- */

// האתר מנתק חיבור אחרי זמן קצר בלי פעילות. כל 4 דקות נשלחת פנייה קלה,
// אבל רק אם המשתמש היה פעיל בשעה האחרונה – חיבור שנשכח פתוח יפוג כרגיל.
const KEEPALIVE_MS = 4 * 60 * 1000, IDLE_LIMIT_MS = 60 * 60 * 1000;
let lastActivity = Date.now();
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));

async function keepAlive() {
  if (!state.user || Date.now() - lastActivity > IDLE_LIMIT_MS) return;
  try { await api('/ping'); } catch {} // 401 מטופל ב-api() ומחזיר למסך הכניסה
}
setInterval(keepAlive, KEEPALIVE_MS);
// כשחוזרים ללשונית אחרי הפסקה – בדיקה מיידית
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAlive(); });

/* ---------- init ---------- */

if (!LOCAL && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

api('/me').then((r) => start(r.user)).catch(() => showLogin());
