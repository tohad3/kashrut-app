// שרת מתווך בין האפליקציה (PWA) לבין מערכת "שירת הים".
// מתחבר לאתר בשם המשתמש, שומר את עוגיות ההתחברות בזיכרון בלבד (לא את הסיסמה),
// ומעביר רק קריאות API מוגדרות מראש.
// דרישות: Node.js 18.14 ומעלה. אין תלויות חיצוניות.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPSTREAM = 'https://shirathayam.m-datit.org.il';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SESSION_IDLE_MS = 60 * 60 * 1000; // שעה ללא פעילות
const SITES_CACHE_MS = 5 * 60 * 1000;
const COORD_CONCURRENCY = 3;
const ACTIVE_STATUSES = new Set([1, 2, 3, 7]); // בתהליך פתיחה, מאושר, לא מאושר, הסרה זמנית
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KashrutDashboard/1.0';

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- shared data (OneDrive) with local backup ---------- */
// קבצים שצריכים להיות משותפים בין המשתמשים (עריכות, נתוני "לוח משגיחים", הרשאות) נשמרים בתיקייה
// המשותפת ב-OneDrive ומשוכפלים לגיבוי מקומי. מטמון מקומי (coords/trails) נשאר ב-DATA_DIR לכל מחשב.
const SHARED_FILES = new Set(['biz-extra.json', 'biz-edits.json', 'biz-links.json', 'staff-extra.json', 'staff-notes.json', 'maptiler-key.txt', 'roles.json']);
const LOCAL_SHARED_DIR = path.join(__dirname, 'data-shared'); // גיבוי מקומי של הנתונים המשותפים
fs.mkdirSync(LOCAL_SHARED_DIR, { recursive: true });

// מאתר את תיקיית הנתונים המשותפת ב-OneDrive (אצל כל משתמש, גם מי ש"הוסיף קיצור דרך לקבצים שלי").
// כשמוסיפים תיקייה ששותפה, OneDrive מוסיף קידומת "הקבצים של <בעלים> - " לשם, ולכן בודקים גם שם שמסתיים ביעד.
function resolveSharedDir() {
  if (process.env.KASHRUT_SHARED_DIR) { try { if (fs.existsSync(process.env.KASHRUT_SHARED_DIR)) return process.env.KASHRUT_SHARED_DIR; } catch {} }
  const home = process.env.USERPROFILE || process.env.HOME || require('os').homedir();
  const TARGET = 'אפליקציית כשרות - נתונים';
  // יכולות להיות כמה תיקיות בשם הזה (למשל עותק ישן שהועתק ידנית ליד קיצור הדרך לתיקייה המשותפת).
  // בוחרים את זו שהקוד בה פורסם לאחרונה (_app\version.txt), כי היא התיקייה המשותפת החיה.
  const found = [];
  try {
    for (const d of fs.readdirSync(home)) {
      if (!/^OneDrive/i.test(d)) continue;
      const base = path.join(home, d);
      try {
        for (const sub of fs.readdirSync(base)) {
          if (sub !== TARGET && !sub.endsWith(TARGET)) continue;
          const cand = path.join(base, sub);
          try { if (fs.statSync(cand).isDirectory()) found.push(cand); } catch {}
        }
      } catch {}
    }
  } catch {}
  const stamp = (dir) => { try { return fs.statSync(path.join(dir, '_app', 'version.txt')).mtimeMs; } catch { return 0; } };
  found.sort((a, b) => stamp(b) - stamp(a));
  return found[0] || null;
}
let SHARED_DIR = resolveSharedDir();
// התקנות ישנות מריצות bootstrap.js שלא מעדכן את עצמו; השרת מעדכן אותו (ואת האייקון) מ-_app, ומההפעלה הבאה
// רץ ה-bootstrap החדש, שמעדכן את האפליקציה גם בלי לסגור אותה.
if (SHARED_DIR) {
  for (const f of ['bootstrap.js', 'kashrut.ico']) {
    try {
      const src = path.join(SHARED_DIR, '_app', f), dst = path.join(__dirname, f);
      if (fs.existsSync(src) && (!fs.existsSync(dst) || !fs.readFileSync(src).equals(fs.readFileSync(dst)))) fs.copyFileSync(src, dst);
    } catch {}
  }
}
console.log(SHARED_DIR ? `נתונים משותפים: ${SHARED_DIR}` : 'נתונים משותפים: OneDrive לא נמצא — עובד מהגיבוי המקומי בלבד');

// מקומות לקריאת קובץ משותף, לפי עדיפות: OneDrive, גיבוי מקומי, המיקום הישן (data/)
function sharedReadCandidates(name) {
  const out = [];
  if (SHARED_DIR) out.push(path.join(SHARED_DIR, name));
  out.push(path.join(LOCAL_SHARED_DIR, name), path.join(DATA_DIR, name));
  return out;
}
// הנתיב לקריאה: עבור קובץ משותף — הקובץ הקיים הראשון; אחרת המיקום המקומי הרגיל
function dataReadPath(name) {
  if (!SHARED_FILES.has(name)) return path.join(DATA_DIR, name);
  for (const p of sharedReadCandidates(name)) { try { if (fs.existsSync(p)) return p; } catch {} }
  return path.join(SHARED_DIR || LOCAL_SHARED_DIR, name);
}
// כתיבה אטומית. קובץ משותף נכתב ל-OneDrive וגם לגיבוי המקומי; אחרת למיקום המקומי הרגיל.
function writeDataFile(name, buf) {
  const targets = SHARED_FILES.has(name)
    ? [SHARED_DIR ? path.join(SHARED_DIR, name) : null, path.join(LOCAL_SHARED_DIR, name)].filter(Boolean)
    : [path.join(DATA_DIR, name)];
  let wrote = false;
  for (const f of targets) {
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f); wrote = true; }
    catch (e) { console.warn(`כתיבת ${f} נכשלה: ${e.message}`); }
  }
  if (!wrote) throw new Error('שמירת הנתונים המשותפים נכשלה בכל היעדים');
}
// בהפעלה: OneDrive הוא מקור האמת — מרעננים ממנו את הגיבוי; אם אין שם קובץ, זורעים מהגיבוי/מהמיקום הישן.
function syncSharedOnStartup() {
  const has = (p) => { try { return p && fs.existsSync(p); } catch { return false; } };
  for (const name of SHARED_FILES) {
    const sp = SHARED_DIR ? path.join(SHARED_DIR, name) : null, bp = path.join(LOCAL_SHARED_DIR, name), lp = path.join(DATA_DIR, name);
    try {
      if (has(sp)) fs.copyFileSync(sp, bp);                               // OneDrive הוא המקור — לרענן גיבוי
      else if (has(bp)) { if (SHARED_DIR) fs.copyFileSync(bp, sp); }       // לזרוע OneDrive מהגיבוי
      else if (has(lp)) { fs.copyFileSync(lp, bp); if (SHARED_DIR) fs.copyFileSync(lp, sp); } // הגירה ראשונה מ-data/
    } catch (e) { console.warn(`סנכרון ${name}: ${e.message}`); }
  }
}
syncSharedOnStartup();

/* ---------- sessions ---------- */

const sessions = new Map(); // token -> { jar: Map, user, sitesCache, lastUsed }

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (now - s.lastUsed > SESSION_IDLE_MS) sessions.delete(t);
}, 5 * 60 * 1000).unref();

function newSession() {
  const token = crypto.randomBytes(32).toString('hex');
  const s = { jar: new Map(), user: null, sitesCache: null, lastUsed: Date.now() };
  sessions.set(token, s);
  return [token, s];
}

function getSession(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  const s = m && sessions.get(m[1]);
  if (s) s.lastUsed = Date.now();
  return s ? [m[1], s] : [null, null];
}

/* ---------- upstream ---------- */

function storeCookies(jar, res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

class UpstreamError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function upstream(s, urlPath, { method = 'GET', query, body, form, xhr = true } = {}) {
  let url = UPSTREAM + urlPath;
  if (query) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.append(k, v);
    url += (url.includes('?') ? '&' : '?') + q;
  }
  const headers = {
    'User-Agent': UA,
    Accept: xhr ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml',
    'Accept-Language': 'he-IL,he;q=0.9',
    Referer: UPSTREAM + '/',
  };
  // כותרת Cookie ריקה גורמת לחומת האש של האתר לחסום את הבקשה
  if (s.jar.size) headers.Cookie = [...s.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (method !== 'GET') headers.Origin = UPSTREAM;
  // עם הכותרת הזו האתר מחזיר תצוגה חלקית בלי window.Model, ולכן היא לא נשלחת בטעינת דפים
  if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  let payload;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json;charset=UTF-8';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  storeCookies(s.jar, res);
  const text = await res.text();
  if (res.status === 401 || (res.status === 302 && /Authentication/i.test(res.headers.get('location') || ''))) {
    console.warn(`[401] ${method} ${url.replace(UPSTREAM, '')} status=${res.status} location=${res.headers.get('location') || ''} body=${text.slice(0, 200).replace(/\s+/g, ' ')}`);
    throw new UpstreamError(401, 'פג תוקף ההתחברות לאתר');
  }
  if (text.includes('The requested URL was rejected')) {
    const support = (/support ID is:\s*([\d]+)/i.exec(text) || [])[1] || '';
    console.warn(`[blocked] ${method} ${urlPath} status=${res.status} supportId=${support}`);
    throw new UpstreamError(502, `הבקשה נחסמה על ידי האתר${support ? ` (מספר תמיכה ${support})` : ''}`);
  }
  if (!res.ok && res.status !== 302) throw new UpstreamError(502, `שגיאה מהאתר (${res.status})`);
  return text;
}

async function data(s, endpoint, opts) {
  const text = await upstream(s, '/Data/' + endpoint, opts);
  let j;
  try { j = JSON.parse(text); } catch { throw new UpstreamError(502, 'תשובה לא צפויה מהאתר'); }
  return j;
}

async function retVal(s, endpoint, opts) {
  const j = await data(s, endpoint, opts);
  if (j.ResultType !== 0) throw new UpstreamError(502, `האתר החזיר שגיאה (קוד ${j.MessageCode ?? j.ResultType})`);
  return j.RetVal;
}

/* ---------- helpers ---------- */

const msFromJsonDate = (v) => {
  const m = typeof v === 'string' && /^\/Date\((-?\d+)\)\/$/.exec(v);
  return m ? Number(m[1]) : null;
};

// ASP.NET מחזיר תאריכים כ-"/Date(ms)/". בשליחה חזרה נשלח ISO, כמו שהאתר עצמו עושה.
function datesToIso(o) {
  if (Array.isArray(o)) return o.map(datesToIso);
  if (o && typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = datesToIso(v);
    return out;
  }
  const ms = msFromJsonDate(o);
  return ms === null ? o : new Date(ms).toISOString();
}

const toSiteDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

function coordsFile(authorityId) { return path.join(DATA_DIR, `coords-${Number(authorityId)}.json`); }
const coordCaches = new Map(); // authorityId -> { coords: {siteId: [lat,lng]|null}, job }

function coordCache(authorityId) {
  if (!coordCaches.has(authorityId)) {
    let coords = {};
    try { coords = JSON.parse(fs.readFileSync(coordsFile(authorityId), 'utf8')); } catch {}
    coordCaches.set(authorityId, { coords, job: null });
  }
  return coordCaches.get(authorityId);
}

function saveCoords(authorityId) {
  fs.writeFileSync(coordsFile(authorityId), JSON.stringify(coordCache(authorityId).coords));
}

function pickAddress(list) {
  return (list || []).find((a) => a.AddressType && a.AddressType.ID === 2) || (list || [])[0] || null;
}

function parseCoord(a) {
  const lat = parseFloat(a && a.CoorX), lng = parseFloat(a && a.CoorY);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? [lat, lng] : null;
}

function normalizeSite(x, coords) {
  const statusId = x.SiteStatus && x.SiteStatus.ID;
  return {
    id: x.ID,
    number: x.LocalSiteNumber,
    name: x.SiteName,
    statusId,
    status: x.SiteStatus && x.SiteStatus.Name,
    active: ACTIVE_STATUSES.has(statusId),
    type: x.SiteType && x.SiteType.Name,
    neighborhood: x.Neighborhood && x.Neighborhood.Name,
    city: x.SiteAddress && x.SiteAddress.City && x.SiteAddress.City.CityName,
    street: x.SiteAddress && x.SiteAddress.Street && x.SiteAddress.Street.StreetName,
    addressNote: x.SiteAddress && x.SiteAddress.Comments,
    phone: x.SitePhone && x.SitePhone.PhoneNumber,
    kosherType: x.ConcatKosherType,
    kosherLevel: x.ConcatKosherLevel,
    supervisors: x.ConcatSupervisors,
    inspectors: x.ConcatInspectors,
    rabbi: x.UserRabbiApproving,
    coord: coords[x.ID] || null,
  };
}

async function getSites(s, force) {
  if (!force && s.sitesCache && Date.now() - s.sitesCache.at < SITES_CACHE_MS) return s.sitesCache.list;
  const base = { AuthorityID: s.user.authorityId, ModuleID: s.user.moduleId };
  // רשימת העסקים לא כוללת את נתון התשלום, לכן נשלפת בנוסף רשימת המשלמים (סינון "שולם: כן" = 1 באתר)
  const [raw, paidRows] = await Promise.all([
    retVal(s, 'Site/GetSearchSites', { query: base }),
    retVal(s, 'Site/GetSearchSites', { query: { ...base, IsPaid: 1 } }).catch(() => null),
  ]);
  s.sitesCache = { at: Date.now(), raw };
  const { coords } = coordCache(s.user.authorityId);
  const paidIds = paidRows && new Set(paidRows.map((x) => x.ID));
  // paid: true / false, או null כששליפת התשלומים נכשלה (לא ידוע)
  const list = raw.map((x) => ({ ...normalizeSite(x, coords), paid: paidIds ? paidIds.has(x.ID) : null }));
  s.sitesCache.list = list;
  return list;
}

/* ---------- status history of each business ---------- */

// היסטוריית שינויי הסטטוס של עסק (מתי נפתח, מתי אושר). נשמרת בקובץ, כי היסטוריה של עסק מאושר כמעט לא משתנה.
const trailCaches = new Map(); // authorityId -> { trails: {siteId: {at, rows}}, job }
function trailCache(authorityId) {
  if (!trailCaches.has(authorityId)) {
    let trails = {};
    try { trails = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `trails-${Number(authorityId)}.json`), 'utf8')); } catch {}
    trailCaches.set(authorityId, { trails, job: null });
  }
  return trailCaches.get(authorityId);
}
function saveTrails(authorityId) { writeJson(`trails-${Number(authorityId)}.json`, trailCache(authorityId).trails); }

// תאריך מהאתר: "/Date(ms)/" או טקסט "dd/MM/yyyy HH:mm"
function parseSiteDate(row) {
  const ms = msFromJsonDate(row.CreateDate);
  if (ms) return ms;
  const m = /(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(row.CreateDateString || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : null;
}

function startTrailJob(s) {
  const cache = trailCache(s.user.authorityId);
  if (cache.job && !cache.job.done) return cache.job;
  const job = { total: 0, done: false, fetched: 0, errors: 0, startedAt: Date.now() };
  cache.job = job;
  (async () => {
    try {
      const sites = await getSites(s);
      const DAY = 864e5;
      // תמיד מרעננים עסקים בתהליך פתיחה; עסקים פעילים אחרים – אם אין היסטוריה שמורה או שהיא בת יותר משבוע
      const todo = sites.filter((x) => x.active && (x.statusId === 1 || !cache.trails[x.id] || Date.now() - cache.trails[x.id].at > 7 * DAY));
      job.total = todo.length;
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          const site = todo[i++];
          try {
            const j = await data(s, 'Site/GetSiteStatusTrail', { query: { siteID: site.id } });
            const rows = Array.isArray(j) ? j : j.RetVal || [];
            cache.trails[site.id] = { at: Date.now(), rows: rows.map((r) => ({
              from: r.FromStatus && r.FromStatus.Name, fromId: r.FromStatus && r.FromStatus.ID,
              to: r.ToStatus && r.ToStatus.Name, toId: r.ToStatus && r.ToStatus.ID,
              at: parseSiteDate(r), dateText: r.CreateDateString || '', user: r.UserName || '', reason: r.StatusReason || '',
            })) };
          } catch (e) {
            job.errors++;
            if (e.status === 401) throw e;
          }
          job.fetched++;
          if (job.fetched % 25 === 0) saveTrails(s.user.authorityId);
        }
      };
      await Promise.all(Array.from({ length: COORD_CONCURRENCY }, worker));
    } catch (e) {
      job.error = e.message;
    } finally {
      saveTrails(s.user.authorityId);
      job.done = true;
    }
  })();
  return job;
}

function startCoordJob(s, { includeInactive = false, refetch = false } = {}) {
  const cache = coordCache(s.user.authorityId);
  if (cache.job && !cache.job.done) return cache.job;
  const job = { total: 0, done: false, fetched: 0, errors: 0, startedAt: Date.now() };
  cache.job = job;
  (async () => {
    try {
      const sites = await getSites(s);
      const todo = sites.filter((x) => (includeInactive || x.active) && (refetch || !(x.id in cache.coords)));
      job.total = todo.length;
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          const site = todo[i++];
          try {
            const rv = await retVal(s, 'Site/GetSiteAddresses', { query: { siteID: site.id } });
            cache.coords[site.id] = parseCoord(pickAddress(rv.KsrSite && rv.KsrSite.lstAddresses));
          } catch (e) {
            job.errors++;
            if (e.status === 401) throw e;
          }
          job.fetched++;
          if (job.fetched % 25 === 0) saveCoords(s.user.authorityId);
        }
      };
      await Promise.all(Array.from({ length: COORD_CONCURRENCY }, worker));
    } catch (e) {
      job.error = e.message;
    } finally {
      saveCoords(s.user.authorityId);
      if (s.sitesCache) s.sitesCache.list = s.sitesCache.list.map((x) => ({ ...x, coord: cache.coords[x.id] || null }));
      job.done = true;
    }
  })();
  return job;
}

/* ---------- route handlers ---------- */

async function login(req, res, body) {
  const { username, password, authorityId } = body || {};
  if (!username || !password) return send(res, 400, { error: 'יש להזין שם משתמש וסיסמה' });
  let [token, s] = getSession(req);
  if (s && !authorityId) { sessions.delete(token); s = null; } // ניסיון חדש מתחיל נקי; בבחירת ארגון ממשיכים באותו חיבור
  if (!s || s.user) [token, s] = newSession();
  await upstream(s, '/Authentication', { xhr: false }); // עוגיות ראשוניות
  const text = await upstream(s, '/Authentication', {
    method: 'POST',
    form: { LoginName: username, Password: password, AuthorityID: authorityId || '', 'X-Requested-With': 'XMLHttpRequest' },
  });
  let r;
  try { r = JSON.parse(text); } catch { return send(res, 502, { error: 'תשובה לא צפויה ממסך הכניסה' }); }
  const cookie = `sid=${token}; HttpOnly; Path=/; SameSite=Lax${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;
  if (r.ErrorCode === 739) {
    return send(res, 200, { needAuthority: true, authorities: (r.ListAuthorities || []).map((a) => ({ id: a.ID, name: a.Name })) }, { 'Set-Cookie': cookie });
  }
  // האתר מחזיר לפעמים ErrorCode 0 גם בכישלון, ואז Url ריק
  if (r.ErrorCode !== 0 || !r.Url) {
    console.warn(`[login] failed code=${r.ErrorCode} msg=${r.ErrorMessage || ''}`);
    return send(res, 401, { error: r.ErrorMessage || 'הכניסה נכשלה' });
  }
  console.log(`[login] ok -> ${r.Url}`);

  if (r.Url && r.Url.startsWith('/')) await upstream(s, r.Url, { xhr: false });
  const page = await upstream(s, '/', { xhr: false });
  const m = /window\.Model\s*=\s*(\{.*\})\s*;?\s*$/m.exec(page);
  if (!m) return send(res, 502, { error: 'לא הצלחתי לקרוא את פרטי המשתמש מהאתר' });
  const model = JSON.parse(m[1]);
  s.user = {
    name: model.Name,
    userId: model.UserID,
    authorityId: model.Authority && model.Authority.ID,
    authorityName: model.Authority && model.Authority.AuthorityName,
    moduleId: (model.ChosenModule && model.ChosenModule.ModuleID) || 2,
    moduleName: model.ChosenModule && model.ChosenModule.ModuleName,
  };
  s.user.role = resolveRole(s.user); // תפקיד באפליקציה: מנהל / עורך / צופה
  // האתר טוען את ההרשאות לחיבור בקריאות האלה (כמו שהדפדפן עושה בטעינה). בלעדיהן מסכים מוגנים מחזירים 401
  for (const ep of ['Authentication/GetUserTreeRoles', 'General/GetAuthorityAndAuthorityTypeByModules']) {
    try {
      await data(s, ep, { query: ep.startsWith('Authentication') ? { moduleID: s.user.moduleId } : { ModuleID: s.user.moduleId } });
    } catch (e) { console.warn(`[login] ${ep}: ${e.message}`); }
  }
  try { s.user.inspector = await isInspector(s); } catch (e) { console.warn(`[login] inspector check: ${e.message}`); }
  try { s.user.scoped = !!(await scopeOf(s)); } catch (e) { console.warn(`[login] scope: ${e.message}`); }
  send(res, 200, { user: s.user }, { 'Set-Cookie': cookie });
}

async function homeSummary(s) {
  const rv = await retVal(s, 'General/GetHomePageDetails', { query: { ExpandQueries: false, ModuleID: s.user.moduleId } });
  return (rv.lstHomePageMarriageTasks || []).map((g) => ({
    title: g.TaskTypeDesc,
    items: (g.lstPageTask || []).map((t) => t.TaskDescription.replace(/\s+/g, ' ').trim()),
  }));
}

const inRange = (st) => !!st && (st.Name || '').trim() === 'דיווח בטווח';

// הדיווח האחרון של כל משגיח/מפקח בתקופה ארוכה (ברירת מחדל: חצי שנה).
// מוחזר רק סיכום לכל אדם, כדי לא להעביר עשרות אלפי שורות לטלפון.
async function lastReports(s, q) {
  const days = Math.min(Math.max(Number(q.get('days')) || 180, 30), 366);
  if (s.lastReports && s.lastReports.days === days && Date.now() - s.lastReports.at < 30 * 60 * 1000) return s.lastReports.result;
  const people = new Map();
  const dayMs = 864e5, end = Date.now();
  for (let b = end; b > end - days * dayMs; b -= 31 * dayMs) {
    const a = Math.max(b - 30 * dayMs, end - days * dayMs);
    const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
    const rows = await retVal(s, 'Site/GetSiteSupervisorReport', {
      query: { AuthorityID: s.user.authorityId, FromDate: toSiteDate(iso(a)), ToDate: toSiteDate(iso(b)) },
    });
    for (const r of rows) {
      const name = r.SupervisorUser && r.SupervisorUser.Name;
      if (!name) continue;
      const o = people.get(name) || { name, group: r.Group && r.Group.Name, last: 0, count: 0 };
      o.count++;
      o.last = Math.max(o.last, msFromJsonDate(r.SupervisionDate) || 0);
      people.set(name, o);
    }
  }
  const result = { days, people: [...people.values()] };
  s.lastReports = { days, at: Date.now(), result };
  return result;
}

async function reports(s, q) {
  const from = q.get('from'), to = q.get('to');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new UpstreamError(400, 'טווח תאריכים לא תקין');
  if (from > to) throw new UpstreamError(400, 'טווח תאריכים לא תקין');
  // טווחים ארוכים נשלפים בחלקים של עד 31 יום, כדי לא להעמיס על האתר ולא לחרוג מזמן התגובה
  const chunks = [];
  for (let d = new Date(from + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= to;) {
    const start = d.toISOString().slice(0, 10);
    const endD = new Date(d.getTime() + 30 * 864e5);
    const end = endD.toISOString().slice(0, 10) < to ? endD.toISOString().slice(0, 10) : to;
    chunks.push([start, end]);
    d = new Date(new Date(end + 'T00:00:00Z').getTime() + 864e5);
  }
  s.reportsCache = s.reportsCache || new Map();
  const rv = [];
  for (const [a, b] of chunks) {
    const key = `${a}|${b}`;
    const hit = s.reportsCache.get(key);
    // חלקים שהסתיימו לפני היום נשמרים ל-10 דקות; החלק של היום תמיד מתרענן
    const today = new Date().toISOString().slice(0, 10);
    if (hit && b < today && Date.now() - hit.at < 10 * 60 * 1000) { rv.push(...hit.rows); continue; }
    const rows = await retVal(s, 'Site/GetSiteSupervisorReport', {
      query: { AuthorityID: s.user.authorityId, FromDate: toSiteDate(a), ToDate: toSiteDate(b), SupervisorUserID: q.get('supervisorId') },
    });
    s.reportsCache.set(key, { at: Date.now(), rows });
    rv.push(...rows);
  }
  const sites = await getSites(s);
  const byName = new Map();
  for (const x of sites) if (!byName.has(x.name) || x.active) byName.set(x.name, x);
  return rv.map((r) => {
    const site = byName.get(r.Site && r.Site.Name);
    return {
      id: r.ID,
      date: msFromJsonDate(r.SupervisionDate),
      from: r.FromTime,
      to: r.ToTime,
      group: r.Group && r.Group.Name,
      supervisor: r.SupervisorUser && r.SupervisorUser.Name,
      siteName: r.Site && r.Site.Name,
      siteId: site ? site.id : null,
      coord: site ? site.coord : null,
      source: r.SiteSupervisorReportSource && r.SiteSupervisorReportSource.Name,
      statusIn: r.SiteSupervisorReportStatusIn && r.SiteSupervisorReportStatusIn.Name,
      statusOut: r.SiteSupervisorReportStatusOut && r.SiteSupervisorReportStatusOut.Name,
      // השדות IsEntryInRange/IsExitInRange תמיד false ברשימה, לכן מחשבים לפי שם הסטטוס
      entryInRange: inRange(r.SiteSupervisorReportStatusIn),
      exitInRange: inRange(r.SiteSupervisorReportStatusOut),
      description: r.ActivityDescription,
    };
  });
}

async function siteDetails(s, id) {
  const [details, addr, certs] = await Promise.all([
    retVal(s, 'Site/GetSiteDetails', { query: { siteID: id } }),
    retVal(s, 'Site/GetSiteAddresses', { query: { siteID: id } }),
    retVal(s, 'Site/GetCertificateRequests', { query: { siteID: id } }),
  ]);
  const k = details.KsrSite;
  const a = pickAddress(addr.KsrSite && addr.KsrSite.lstAddresses);
  const coord = parseCoord(a);
  coordCache(s.user.authorityId).coords[id] = coord;
  return {
    id,
    fields: {
      SiteName: k.SiteName,
      SiteCompany: k.SiteCompany,
      SiteDescription: k.SiteDescription,
      NameWrittenOnCheque: k.NameWrittenOnCheque,
      EmailAddress: k.EmailAddress,
      Comments: k.Comments,
    },
    businessOpenDate: msFromJsonDate(k.BusinessOpenDate),
    address: a && {
      city: a.City && a.City.CityName,
      street: a.Street && a.Street.StreetName,
      house: a.HouseNumber,
      comments: a.Comments,
    },
    coord,
    certificates: (certs.lstKosherCertificats || []).map((c) => ({
      id: c.ID,
      type: c.KosherCertificateType && c.KosherCertificateType.Name,
      kosherType: c.KosherType && c.KosherType.Name,
      level: c.KosherLevel && c.KosherLevel.Name,
      passoverYear: c.PassoverYear,
      validTo: msFromJsonDate(c.ValidTo),
      remark: c.CertificateRemark,
    })),
  };
}

const EDITABLE_FIELDS = ['SiteName', 'SiteCompany', 'SiteDescription', 'NameWrittenOnCheque', 'EmailAddress', 'Comments'];

async function updateSite(s, id, body) {
  const fields = (body && body.fields) || {};
  const details = await retVal(s, 'Site/GetSiteDetails', { query: { siteID: id } });
  const site = datesToIso(details.KsrSite);
  for (const f of EDITABLE_FIELDS) if (f in fields) site[f] = fields[f] == null ? '' : String(fields[f]);
  if (!site.SiteName) throw new UpstreamError(400, 'שם בית העסק הוא שדה חובה');
  const r = await data(s, 'Site/UpdateSite', { method: 'POST', body: site });
  if (r.ResultType !== 0) throw new UpstreamError(502, `העדכון נדחה על ידי האתר (קוד ${r.MessageCode})`);
  s.sitesCache = null;
  return { ok: true };
}

async function updateLocation(s, id, body) {
  const lat = Number(body && body.lat), lng = Number(body && body.lng);
  if (!(lat > 29 && lat < 34 && lng > 34 && lng < 36)) throw new UpstreamError(400, 'המיקום מחוץ לגבולות ישראל');
  const rv = await retVal(s, 'Site/GetSiteAddresses', { query: { siteID: id } });
  const site = datesToIso(rv.KsrSite);
  const a = pickAddress(site.lstAddresses);
  if (!a) throw new UpstreamError(400, 'לבית העסק אין כתובת במערכת. יש להוסיף כתובת באתר עצמו');
  a.CoorX = lat;
  a.CoorY = lng;
  const r = await data(s, 'Site/UpdateSiteAddress', { method: 'POST', body: site });
  if (r.ResultType !== 0) throw new UpstreamError(502, `העדכון נדחה על ידי האתר (קוד ${r.MessageCode})`);
  coordCache(s.user.authorityId).coords[id] = [lat, lng];
  saveCoords(s.user.authorityId);
  if (s.sitesCache) s.sitesCache.list = s.sitesCache.list.map((x) => (x.id === id ? { ...x, coord: [lat, lng] } : x));
  return { ok: true };
}

const STAFF_FIELDS = ['tel', 'phone', 'phoneNote', 'declaration', 'certificate', 'whatsapp', 'active', 'notes'];
const BIZ_FIELDS = ['area', 'cluster', 'subCluster', 'route', 'category', 'opinion', 'grade', 'hoursQuota', 'price', 'openHours', 'inspector', 'notes'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
function readJson(name) { try { return JSON.parse(fs.readFileSync(dataReadPath(name), 'utf8')); } catch { return {}; } }
// כתיבה לקובץ זמני והחלפה (אטומית); קובץ משותף נכתב ל-OneDrive וגם לגיבוי המקומי
function writeJson(name, obj) { writeDataFile(name, JSON.stringify(obj, null, 1)); }

function readStaffNotes() {
  try { return JSON.parse(fs.readFileSync(dataReadPath('staff-notes.json'), 'utf8')); } catch { return {}; }
}

/* ---------- user roles (admin / editor / viewer) ---------- */
// קובץ ההרשאות משותף ב-OneDrive: { "<userId>": { role, name, updatedAt, updatedBy } }. מפתח = מזהה המשתמש בשירת הים.
const ROLES = ['admin', 'editor', 'viewer'];
function readRoles() { const r = readJson('roles.json'); return r && typeof r === 'object' ? r : {}; }
function roleOf(userId) { const e = readRoles()[String(userId)]; return e && e.role; }
function hasAnyAdmin() { return Object.values(readRoles()).some((e) => e && e.role === 'admin'); }
function setRole(userId, role, name, by) {
  const r = readRoles();
  r[String(userId)] = { role, name: name || (r[String(userId)] && r[String(userId)].name) || '', updatedAt: new Date().toISOString(), updatedBy: by || '' };
  writeJson('roles.json', r);
}
// נקבע בכניסה. אתחול המנהל קורה פעם אחת בלבד – כשאין עדיין קובץ הרשאות משותף (ההקמה הראשונית אצל הבעלים).
// אם התיקייה המשותפת לא נמצאה (למשל OneDrive עדיין לא סונכרן אצל עמית) – צופה, בלי לכתוב ובלי להפוך למנהל.
function resolveRole(user) {
  const existing = roleOf(user.userId);
  if (existing) return existing;
  if (!SHARED_DIR) return 'viewer';
  if (!fs.existsSync(path.join(SHARED_DIR, 'roles.json'))) { // אין עדיין קובץ הרשאות – אתחול מנהל ראשוני
    setRole(user.userId, 'admin', user.name, 'אתחול המערכת');
    return 'admin';
  }
  setRole(user.userId, 'viewer', user.name, 'כניסה ראשונה'); // משתמש חדש – צופה כברירת מחדל
  return 'viewer';
}

/* ---------- inspector scope ---------- */
// מפקח שנכנס (ואינו מנהל) רואה רק את העסקים שהוא רשום עליהם כמפקח בשירת הים,
// ורק את המשגיחים שרשומים על העסקים האלה. מנהל רואה הכול.
const nameKey = (n) => String(n || '').replace(/["'׳״.]/g, '').trim().split(/\s+/).filter((w) => w && w !== 'הרב').sort().join(' ');
const splitNames = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const bizNorm = (v) => String(v || '').replace(/["'׳״`]/g, '').replace(/[-–—_/\\().,:;|+&]/g, ' ').replace(/\s+/g, ' ').trim();

// האם המשתמש רשום באתר כמפקח (קבוצה 20)
async function isInspector(s) {
  const j = await data(s, 'General/GetUsersByGroupAndAuthority', { query: { GroupID: 20, AuthorityID: s.user.authorityId, IsActive: true } });
  const rows = (Array.isArray(j) ? j : j.RetVal) || [];
  return rows.some((x) => String(x.ID ?? x.UserID) === String(s.user.userId));
}

// null = רואה הכול. אחרת: העסקים של המפקח והמשגיחים שלהם
async function scopeOf(s) {
  if (s.user.role === 'admin') return null;
  const me = nameKey(s.user.name);
  const mine = (await getSites(s)).filter((x) => splitNames(x.inspectors).some((n) => nameKey(n) === me));
  if (!mine.length && !s.user.inspector) return null;
  return {
    me,
    siteIds: new Set(mine.map((x) => x.id)),
    siteNames: new Set(mine.map((x) => bizNorm(x.name))),
    people: new Set([me, ...mine.flatMap((x) => splitNames(x.supervisors).map(nameKey))]),
  };
}

// נתוני המשגיחים מ"לוח משגיחים" + עריכות מהאפליקציה
function staffExtra() {
  let extra = { people: [] };
  try { extra = JSON.parse(fs.readFileSync(dataReadPath('staff-extra.json'), 'utf8')); } catch {}
  const notes = readJson('staff-notes.json');
  const known = new Set((extra.people || []).map((x) => x.id));
  extra.people = (extra.people || []).map((x) => ({ ...x, whatsapp: '', ...pick(notes[x.id], STAFF_FIELDS), edited: !!notes[x.id] }));
  // אנשים שנוספו מהאפליקציה ואינם ב"לוח משגיחים"
  for (const [id, n] of Object.entries(notes)) if (!known.has(id) && n.name) extra.people.push({ id, name: n.name, tel: '', phone: 'unknown', phoneNote: '', declaration: false, certificate: '', active: true, notes: '', whatsapp: '', ...pick(n, STAFF_FIELDS), edited: true, added: true });
  return extra;
}

/* ---------- http plumbing ---------- */

function send(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new UpstreamError(400, 'JSON לא תקין')); } });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(req, res, p);

  // הגנת CSRF בסיסית: בקשות שמשנות מידע חייבות להגיע מהאפליקציה עצמה
  if (req.method !== 'GET' && req.headers['x-app'] !== '1') return send(res, 403, { error: 'בקשה לא מורשית' });

  try {
    if (p === '/api/login' && req.method === 'POST') return await login(req, res, await readBody(req));

    const [token, s] = getSession(req);
    if (p === '/api/logout' && req.method === 'POST') {
      if (s && s.user) { try { await data(s, 'Authentication/LogOut', { method: 'POST', body: {} }); } catch {} }
      if (token) sessions.delete(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
    }
    if (!s || !s.user) return send(res, 401, { error: 'יש להתחבר' });

    // הרשאות אפליקציה: ניהול משתמשים ועדכון לאתר – מנהל בלבד; עריכת נתוני אפליקציה – עורך/מנהל; צפייה ורענון מטמון – כולם
    const role = s.user.role || 'viewer';
    if (/^\/api\/roles(\/|$)/.test(p) && role !== 'admin') return send(res, 403, { error: 'ניהול ההרשאות מותר למנהל בלבד' });
    if (req.method === 'POST') {
      if (/^\/api\/site\/\d+(\/location)?$/.test(p) && role !== 'admin') return send(res, 403, { error: 'עדכון לאתר שירת הים מותר למנהל בלבד' });
      if (/^\/api\/(staff-extra|biz-edit)\//.test(p) && role === 'viewer') return send(res, 403, { error: 'אין לך הרשאת עריכה' });
    }

    let m;
    if (p === '/api/me') return send(res, 200, { user: s.user });
    // מפקח: רק העסקים והמשגיחים שלו (נבדק רק בנתיבים שמחזירים עסקים או משגיחים)
    const scope = /^\/api\/(sites|biz-extra|biz-edit\/|staff-extra|staff-status|last-reports|reports|trails|site\/)/.test(p) ? await scopeOf(s) : null;
    if (scope) {
      if ((m = /^\/api\/(?:site|biz-edit)\/(\d+)/.exec(p)) && !scope.siteIds.has(Number(m[1]))) return send(res, 403, { error: 'העסק אינו משויך אליך' });
      if ((m = /^\/api\/staff-extra\/([\w-]{1,40})$/.exec(p)) && m[1] !== 'new') {
        const x = staffExtra().people.find((y) => y.id === m[1]);
        if (!x || !scope.people.has(nameKey(x.name))) return send(res, 403, { error: 'המשגיח אינו משויך לעסקים שלך' });
      }
    }
    // ניהול הרשאות (מנהל בלבד – מגודר למעלה)
    if (p === '/api/roles' && req.method === 'GET') return send(res, 200, { roles: readRoles(), meId: s.user.userId });
    if ((m = /^\/api\/roles\/([\w-]{1,40})$/.exec(p)) && req.method === 'POST') {
      const b = await readBody(req);
      if (!ROLES.includes(b.role)) throw new UpstreamError(400, 'תפקיד לא תקין');
      const r = readRoles();
      if (r[m[1]] && r[m[1]].role === 'admin' && b.role !== 'admin' && Object.values(r).filter((e) => e.role === 'admin').length <= 1)
        throw new UpstreamError(400, 'חייב להישאר לפחות מנהל אחד במערכת');
      setRole(m[1], b.role, b.name, s.user.name);
      return send(res, 200, { ok: true });
    }
    // שמירת החיבור לאתר חי: קריאה קלה, נשלחת מהאפליקציה רק כשהיא פתוחה ובשימוש
    if (p === '/api/ping') {
      await data(s, 'Authentication/GetUserTreeRoles', { query: { moduleID: s.user.moduleId } });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/home') return send(res, 200, await homeSummary(s));
    if (p === '/api/sites') {
      const list = await getSites(s, url.searchParams.get('refresh') === '1');
      return send(res, 200, scope ? list.filter((x) => scope.siteIds.has(x.id)) : list);
    }
    // נתוני משגיחים שאינם באתר (טלפון, טלפון כשר, הצהרה, תעודה) – מיובאים מ"לוח משגיחים" לקובץ מקומי
    // נתוני משגיחים שאינם באתר (טלפון, טלפון כשר, הצהרה, תעודה...) – יובאו מ"לוח משגיחים" לקובץ מקומי.
    // עריכות מהאפליקציה נשמרות בקובץ נפרד (staff-notes.json) ומולבשות על הרשומה, כך שייבוא חוזר לא מוחק אותן.
    if (p === '/api/staff-extra') {
      const extra = staffExtra();
      if (scope) extra.people = extra.people.filter((x) => scope.people.has(nameKey(x.name)));
      return send(res, 200, extra);
    }
    if ((m = /^\/api\/staff-extra\/([\w-]{1,40})$/.exec(p)) && req.method === 'POST') {
      const b = await readBody(req);
      const data = pick(b, STAFF_FIELDS);
      if ('whatsapp' in data && !['yes', 'no', ''].includes(data.whatsapp)) throw new UpstreamError(400, 'ערך WhatsApp לא תקין');
      if ('phone' in data && !['kosher', 'nonkosher', 'elderly', 'unknown'].includes(data.phone)) throw new UpstreamError(400, 'ערך טלפון כשר לא תקין');
      for (const k of ['declaration', 'active']) if (k in data) data[k] = !!data[k];
      for (const k of ['tel', 'phoneNote', 'certificate', 'notes']) if (k in data) data[k] = String(data[k] ?? '').slice(0, 500);
      const notes = readJson('staff-notes.json');
      let id = m[1];
      if (id === 'new') { // אדם שלא קיים ב"לוח משגיחים": נוצרת לו רשומה מקומית לפי שם
        const name = String(b.name || '').trim().slice(0, 80);
        if (!name) throw new UpstreamError(400, 'חסר שם');
        id = 'x' + Date.now().toString(36);
        notes[id] = { name };
      }
      notes[id] = { ...notes[id], ...data, updatedAt: new Date().toISOString(), updatedBy: s.user.name };
      writeJson('staff-notes.json', notes);
      return send(res, 200, { ok: true, id });
    }
    // נתוני עסקים מ"לוח משגיחים" (אשכול, סיווג, חוות דעת, דרגה, כימות שעות, מחיר) – קובץ מקומי,
    // ועריכות מהאפליקציה לפי מזהה העסק באתר (biz-edits.json)
    if (p === '/api/biz-extra') {
      let extra = { businesses: [] };
      try { extra = JSON.parse(fs.readFileSync(dataReadPath('biz-extra.json'), 'utf8')); } catch {}
      extra.edits = readJson('biz-edits.json');
      extra.links = readJson('biz-links.json'); // חיבור ידני: מזהה עסק בלוח -> מזהה עסק באתר (כשהשמות שונים)
      if (scope) {
        const sups = new Set(staffExtra().people.filter((x) => scope.people.has(nameKey(x.name))).map((x) => x.id));
        extra.businesses = (extra.businesses || [])
          .filter((b) => scope.siteIds.has(Number(extra.links[b.id])) || scope.siteNames.has(bizNorm(b.name)) || nameKey(b.inspector) === scope.me)
          .map((b) => (Array.isArray(b.sups) ? { ...b, sups: b.sups.filter((id) => sups.has(id)) } : b));
        const keep = new Set(extra.businesses.map((b) => b.id));
        extra.links = Object.fromEntries(Object.entries(extra.links).filter(([id]) => keep.has(id)));
        extra.edits = Object.fromEntries(Object.entries(extra.edits).filter(([id]) => scope.siteIds.has(Number(id))));
      }
      return send(res, 200, extra);
    }
    if ((m = /^\/api\/biz-edit\/(\d+)$/.exec(p)) && req.method === 'POST') {
      const b = await readBody(req);
      const data = pick(b, BIZ_FIELDS);
      for (const k of Object.keys(data)) data[k] = String(data[k] ?? '').trim().slice(0, 500);
      const edits = readJson('biz-edits.json');
      edits[m[1]] = { ...edits[m[1]], ...data, updatedAt: new Date().toISOString(), updatedBy: s.user.name };
      writeJson('biz-edits.json', edits);
      return send(res, 200, { ok: true });
    }
    // הגדרות לצד הלקוח. מפתח MapTiler נקרא מהקובץ data/maptiler-key.txt (או ממשתנה הסביבה MAPTILER_KEY)
    // בכל בקשה, כך שאפשר להדביק אותו לקובץ בלי להפעיל את השרת מחדש.
    if (p === '/api/config') {
      let key = process.env.MAPTILER_KEY || '';
      try { key = fs.readFileSync(dataReadPath('maptiler-key.txt'), 'utf8').trim() || key; } catch {}
      return send(res, 200, { maptilerKey: /^[A-Za-z0-9_-]{8,80}$/.test(key) ? key : '' });
    }
    // כלי פיתוח: קריאה בלבד של נקודת "Get..." באתר, רק מהמחשב שבו השרת רץ. משמש למיפוי שדות חדשים.
    if (p === '/api/debug/get') {
      const ip = req.socket.remoteAddress || '';
      const ep = url.searchParams.get('ep') || '';
      if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip) || req.headers['x-forwarded-for']) return send(res, 403, { error: 'זמין רק מהמחשב המקומי' });
      if (!/^[A-Za-z]+\/Get[A-Za-z]+$/.test(ep)) return send(res, 400, { error: 'מותרות רק נקודות קריאה (Get...)' });
      const q = Object.fromEntries([...url.searchParams].filter(([k]) => k !== 'ep'));
      let text;
      try { text = await upstream(s, '/Data/' + ep, { query: q }); }
      catch (e) { return send(res, 502, { error: 'debug: ' + e.message, upstreamStatus: e.status || null }); } // לא מנתק את החיבור
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(text);
    }
    // משגיחים (קבוצה 21) ומפקחים (קבוצה 20) כפי שהם רשומים באתר, פעילים ולא פעילים
    if (p === '/api/staff-status') {
      const out = [];
      const sample = {};
      for (const [groupId, role] of [[21, 'משגיח'], [20, 'מפקח']]) {
        for (const isActive of [true, false]) {
          const j = await data(s, 'General/GetUsersByGroupAndAuthority', { query: { GroupID: groupId, AuthorityID: s.user.authorityId, IsActive: isActive } });
          const rows = Array.isArray(j) ? j : j.RetVal; // הנקודה הזו מחזירה רשימה ישירה, בלי עטיפת RetVal
          if (rows && rows[0] && !sample[groupId]) sample[groupId] = Object.keys(rows[0]);
          for (const x of rows || []) {
            out.push({
              id: x.ID ?? x.UserID ?? null,
              name: String(x.Name || x.UserName || [x.FirstName, x.LastName].filter(Boolean).join(' ') || '').trim(),
              role, queriedActive: isActive,
              isActive: x.IsActive ?? null, state: x.State ?? null,
            });
          }
        }
      }
      return send(res, 200, { people: scope ? out.filter((x) => scope.people.has(nameKey(x.name))) : out, sampleKeys: sample });
    }
    if (p === '/api/last-reports') {
      const r = await lastReports(s, url.searchParams);
      return send(res, 200, scope ? { ...r, people: r.people.filter((x) => scope.people.has(nameKey(x.name))) } : r);
    }
    if (p === '/api/reports') {
      const rows = await reports(s, url.searchParams);
      return send(res, 200, scope ? rows.filter((x) => scope.people.has(nameKey(x.supervisor))) : rows);
    }
    if (p === '/api/trails') {
      const c = trailCache(s.user.authorityId);
      return send(res, 200, { job: c.job || { done: true, total: 0, fetched: 0 }, trails: Object.fromEntries(Object.entries(c.trails).filter(([id]) => !scope || scope.siteIds.has(Number(id))).map(([id, t]) => [id, t.rows])) });
    }
    if (p === '/api/trails/refresh' && req.method === 'POST') return send(res, 200, startTrailJob(s));
    if (p === '/api/coords/status') return send(res, 200, coordCache(s.user.authorityId).job || { done: true, total: 0, fetched: 0 });
    if (p === '/api/coords/refresh' && req.method === 'POST') {
      const b = await readBody(req);
      return send(res, 200, startCoordJob(s, { includeInactive: !!b.includeInactive, refetch: !!b.refetch }));
    }
    if ((m = /^\/api\/site\/(\d+)$/.exec(p))) {
      const id = Number(m[1]);
      if (req.method === 'GET') return send(res, 200, await siteDetails(s, id));
      if (req.method === 'POST') return send(res, 200, await updateSite(s, id, await readBody(req)));
    }
    if ((m = /^\/api\/site\/(\d+)\/location$/.exec(p)) && req.method === 'POST') {
      return send(res, 200, await updateLocation(s, Number(m[1]), await readBody(req)));
    }
    send(res, 404, { error: 'לא נמצא' });
  } catch (e) {
    const status = e.status || 500;
    if (status === 401) { const [t] = getSession(req); if (t) sessions.delete(t); }
    if (status === 500) console.error(e);
    send(res, status, { error: e.message || 'שגיאה' });
  }
});

server.listen(PORT, () => console.log(`האפליקציה פועלת: http://localhost:${PORT}`));
