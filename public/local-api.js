'use strict';

// מצב עצמאי: האפליקציה פועלת בלי שרת ובלי חיבור לאתר "שירת הים".
// הנתונים נטענים מקובצי ייצוא (CSV / Excel) שהמשתמש בוחר, ונשמרים בדפדפן (IndexedDB).
// נתוני "לוח משגיחים", מיקומים והיסטוריית סטטוסים מוטמעים בקובץ בזמן הבנייה (window.SEED).
// הקובץ מחליף את קריאות ה-API של server.js: app.js קורא ל-window.localApi במקום ל-fetch.

(() => {
  const SEED = window.SEED || {};
  const DB_NAME = 'kashrut-local', STORE = 'kv';
  const ACTIVE_STATUSES = new Set([1, 2, 3, 7]);
  const STATUS_IDS = [
    [1, /בתהליך פתיחה/], [2, /^מאושר/], [3, /לא מאושר/], [4, /נסגר/], [5, /הפסקת השגחה/], [6, /בוטל/], [7, /הסרה זמנית/],
  ];
  const STAFF_FIELDS = ['tel', 'phone', 'phoneNote', 'declaration', 'certificate', 'whatsapp', 'active', 'notes'];
  const BIZ_FIELDS = ['area', 'cluster', 'subCluster', 'route', 'category', 'opinion', 'grade', 'hoursQuota', 'price', 'openHours', 'inspector', 'notes'];
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
  const USER = { name: 'משתמש מקומי', userId: 'local', authorityName: 'מועצה דתית חיפה', moduleName: 'כשרות · ללא שרת', role: 'admin' };

  /* ---------- storage ---------- */

  let dbp;
  function db() {
    dbp = dbp || new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function get(key) {
    const d = await db();
    return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  }
  async function put(key, val) {
    const d = await db();
    return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
  }

  // מצב בזיכרון: נטען פעם אחת מהדפדפן
  const S = { reports: {}, sites: null, meta: {}, staffNotes: null, bizEdits: null, coords: {}, siteEdits: {}, geo: {} };
  const ready = (async () => {
    for (const k of ['reports', 'sites', 'meta', 'staffNotes', 'bizEdits', 'coords', 'siteEdits', 'geo']) {
      try { const v = await get(k); if (v !== undefined) S[k] = v; } catch {}
    }
    S.staffNotes = S.staffNotes || { ...(SEED.staffNotes || {}) };
    S.bizEdits = S.bizEdits || { ...(SEED.bizEdits || {}) };
  })();
  const save = (k) => put(k, S[k]).catch((e) => console.warn('save', k, e));

  /* ---------- parsing ---------- */

  const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const hkey = (v) => clean(v).replace(/["'׳״.]/g, '');

  // תאריך: אובייקט Date, מספר סידורי של Excel או טקסט dd/mm/yyyy
  function parseDate(v) {
    if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate()).getTime();
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime(); }
    const m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(String(v || ''));
    if (!m) return null;
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[2] - 1, +m[1]).getTime();
  }
  function parseTime(v) {
    if (v instanceof Date && !isNaN(v)) return String(v.getHours()).padStart(2, '0') + ':' + String(v.getMinutes()).padStart(2, '0');
    if (typeof v === 'number' && v >= 0 && v < 1) { const m = Math.round(v * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
    const m = /(\d{1,2}):(\d{2})/.exec(String(v || ''));
    return m ? m[1].padStart(2, '0') + ':' + m[2] : '';
  }

  // קריאת קובץ לטבלת שורות (מערכים). CSV נקרא כטקסט כדי לשמור את התאריכים כפי שהם
  async function readTable(file) {
    if (!window.XLSX) throw new Error('רכיב קריאת האקסל לא נטען');
    const isCsv = /\.(csv|txt)$/i.test(file.name);
    const wb = isCsv
      ? XLSX.read((await file.text()).replace(/^﻿/, ''), { type: 'string', raw: true })
      : XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const out = [];
    for (const name of wb.SheetNames) out.push(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }));
    return out;
  }

  // מוצא את שורת הכותרות ומחזיר פונקציה שמביאה ערך לפי אחד משמות העמודה האפשריים
  function headerOf(rows, must) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const h = rows[i].map(hkey);
      if (must.every((alts) => alts.some((a) => h.includes(hkey(a))))) {
        const idx = (alts) => { for (const a of alts) { const j = h.indexOf(hkey(a)); if (j >= 0) return j; } return -1; };
        return { at: i, idx, headers: rows[i].map(clean).filter(Boolean) };
      }
    }
    return null;
  }

  const REPORT_COLS = {
    group: ['משגיח/מפקח', 'תפקיד'], supervisor: ['שם', 'שם משגיח', 'משגיח'], site: ['עסק/אשכול', 'עסק', 'שם עסק'],
    date: ['ת. השגחה', 'תאריך השגחה', 'תאריך'], from: ['משעה', 'שעת כניסה'], to: ['עד שעה', 'שעת יציאה'],
    cont: ['המשך טיפול'], done: ['טיפול הסתיים'], source: ['מקור הדיווח', 'מקור'], statusIn: ['מיקום כניסה'], statusOut: ['מיקום יציאה'],
    id: ['Id', 'ID', 'מזהה'], description: ['תיאור', 'תיאור פעילות', 'הערות'],
  };
  const SITE_COLS = {
    id: ['Id', 'ID', 'מזהה', 'מזהה עסק'], number: ['מספר עסק', 'מס עסק', 'מס מקומי', 'מספר מקומי', 'מס'],
    name: ['שם עסק', 'שם בית העסק', 'שם בית עסק', 'שם האתר', 'עסק', 'שם'], status: ['סטטוס', 'סטטוס עסק', 'סטטוס בית העסק'],
    type: ['סוג עסק', 'סוג בית עסק', 'סוג'], neighborhood: ['שכונה', 'אזור'], city: ['עיר', 'ישוב', 'יישוב'],
    street: ['רחוב', 'כתובת'], house: ['מספר בית', 'מס בית'], phone: ['טלפון', 'טלפון עסק'],
    kosherType: ['סוג כשרות', 'כשרות'], kosherLevel: ['רמת כשרות', 'רמה'], supervisors: ['משגיחים', 'משגיח'],
    inspectors: ['מפקחים', 'מפקח'], rabbi: ['רב מאשר', 'רב'], paid: ['שולם', 'תשלום', 'אגרה'],
  };

  const inRange = (v) => clean(v) === 'דיווח בטווח';

  function parseReports(rows, h) {
    const c = Object.fromEntries(Object.entries(REPORT_COLS).map(([k, a]) => [k, h.idx(a)]));
    const v = (r, k) => (c[k] >= 0 ? r[c[k]] : '');
    const out = [];
    for (const r of rows.slice(h.at + 1)) {
      const date = parseDate(v(r, 'date'));
      const supervisor = clean(v(r, 'supervisor')), siteName = clean(v(r, 'site'));
      if (!date || !supervisor) continue;
      const from = parseTime(v(r, 'from')), to = parseTime(v(r, 'to'));
      const rawId = clean(v(r, 'id'));
      // לדיווח בלי מזהה בונים מפתח קבוע, כדי שטעינה חוזרת של אותו קובץ לא תכפיל אותו
      const id = rawId ? Number(rawId) || rawId : `k:${supervisor}|${siteName}|${date}|${from}|${to}`;
      out.push({
        id, date, from, to, supervisor, siteName,
        group: clean(v(r, 'group')),
        source: clean(v(r, 'source')),
        statusIn: clean(v(r, 'statusIn')), statusOut: clean(v(r, 'statusOut')),
        entryInRange: inRange(v(r, 'statusIn')), exitInRange: inRange(v(r, 'statusOut')),
        description: clean(v(r, 'description')) || (clean(v(r, 'cont')) ? 'המשך טיפול: ' + clean(v(r, 'cont')) : ''),
      });
    }
    return out;
  }

  // סטטוס שלא מוכר מקבל מספר קבוע משלו (100 ומעלה), כדי שיופיע כקבוצה נפרדת בדשבורד
  const extraStatus = new Map();
  function statusIdOf(name) {
    for (const [id, re] of STATUS_IDS) if (re.test(name)) return id;
    if (!extraStatus.has(name)) extraStatus.set(name, 100 + extraStatus.size);
    return extraStatus.get(name);
  }
  const yes = (v) => /^(כן|1|true|v|✓|שולם)$/i.test(clean(v));
  const no = (v) => /^(לא|0|false|x|לא שולם)$/i.test(clean(v));

  function parseSites(rows, h) {
    const c = Object.fromEntries(Object.entries(SITE_COLS).map(([k, a]) => [k, h.idx(a)]));
    const v = (r, k) => (c[k] >= 0 ? clean(r[c[k]]) : '');
    const out = [];
    for (const r of rows.slice(h.at + 1)) {
      const name = v(r, 'name');
      if (!name) continue;
      const status = v(r, 'status'), statusId = statusIdOf(status);
      const idRaw = v(r, 'id') || v(r, 'number');
      out.push({
        id: Number(idRaw) || -(out.length + 1), number: v(r, 'number'), name, status, statusId,
        active: statusId < 100 ? ACTIVE_STATUSES.has(statusId) : true,
        type: v(r, 'type'), neighborhood: v(r, 'neighborhood'), city: v(r, 'city'),
        street: [v(r, 'street'), v(r, 'house')].filter(Boolean).join(' '), addressNote: '', phone: v(r, 'phone'),
        kosherType: v(r, 'kosherType'), kosherLevel: v(r, 'kosherLevel'),
        supervisors: v(r, 'supervisors'), inspectors: v(r, 'inspectors'), rabbi: v(r, 'rabbi'),
        paid: c.paid < 0 ? null : yes(v(r, 'paid')) ? true : no(v(r, 'paid')) ? false : null,
      });
    }
    return out;
  }

  // טעינת קבצים: מזהה לבד אם זה ייצוא דיווחי משגיחים או רשימת בתי עסק
  async function importFiles(files) {
    await ready;
    const summary = [];
    for (const file of files) {
      const sheets = await readTable(file);
      let done = false;
      for (const rows of sheets) {
        let h = headerOf(rows, [REPORT_COLS.date, REPORT_COLS.supervisor, REPORT_COLS.site]);
        if (h && (h.idx(REPORT_COLS.from) >= 0 || h.idx(REPORT_COLS.statusIn) >= 0)) {
          const list = parseReports(rows, h);
          let added = 0;
          for (const r of list) { if (!S.reports[r.id]) added++; S.reports[r.id] = r; }
          await save('reports');
          const ds = list.map((r) => r.date);
          summary.push(`${file.name}: ${list.length} דיווחים (${added} חדשים)${ds.length ? `, ${new Date(Math.min(...ds)).toLocaleDateString('he-IL')}–${new Date(Math.max(...ds)).toLocaleDateString('he-IL')}` : ''}`);
          S.meta.reportsAt = Date.now();
          done = true; break;
        }
        h = headerOf(rows, [SITE_COLS.name, SITE_COLS.status]);
        if (h) {
          S.sites = parseSites(rows, h);
          await save('sites');
          summary.push(`${file.name}: ${S.sites.length} בתי עסק`);
          S.meta.sitesAt = Date.now();
          done = true; break;
        }
      }
      if (!done) {
        const first = (sheets[0] || []).find((r) => r.some((x) => clean(x))) || [];
        throw new Error(`לא זיהיתי את סוג הקובץ "${file.name}". הכותרות בו: ${first.map(clean).filter(Boolean).join(', ') || 'אין'}`);
      }
    }
    await save('meta');
    return summary;
  }

  /* ---------- derived data ---------- */

  const bizNorm = (v) => String(v || '').replace(/["'׳״`]/g, '').replace(/[-–—_/\\().,:;|+&]/g, ' ').replace(/\s+/g, ' ').trim();

  // מזהה מספרי קבוע (שלילי, כדי לא להתנגש במזהי שירת הים) לעסק שאין לו מזהה באתר
  const stableId = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return -((h >>> 0) % 2e9 + 1); };

  // רשימת בתי העסק: מייצוא של שירת הים אם נטען, אחרת ממסד הנתונים של "ניהול משגיחים" (לוח משגיחים).
  // עסקים שמופיעים רק בדיווחים נוספים בסוף, כדי שכל דיווח יהיה משויך לעסק.
  function sitesList() {
    const coords = { ...(SEED.coords || {}), ...S.coords };
    const withCoord = (x) => ({ ...x, coord: coords[x.ckey] || null });
    let list;
    if (S.sites) {
      list = S.sites.map((x) => withCoord({ ...x, name: (S.siteEdits[x.id] || {}).SiteName || x.name, ckey: x.id > 0 ? x.id : 'n:' + x.name }));
    } else {
      const board = boardData();
      const names = new Map(board.staff.map((x) => [x.id, x.name]));
      const links = SEED.bizLinks || {};
      list = board.businesses.map((b) => {
        const linked = links[b.id] && coords[links[b.id]];
        const active = b.active !== false;
        return withCoord({
          id: links[b.id] ? Number(links[b.id]) : stableId(b.id), number: '', name: clean(b.name),
          status: active ? 'פעיל' : 'לא פעיל', statusId: active ? 2 : 4, active,
          type: clean(b.category), neighborhood: clean(b.cluster), city: 'חיפה',
          street: [clean(b.address), clean(b.number)].filter(Boolean).join(' '), addressNote: clean(b.subCluster), phone: '',
          kosherType: '', kosherLevel: '',
          supervisors: (b.supIds || b.sups || []).map((id) => names.get(id)).filter(Boolean).join(','),
          inspectors: clean(b.inspectorId ? names.get(b.inspectorId) : b.inspector), rabbi: '', paid: null,
          ckey: linked ? links[b.id] : 'b:' + b.id,
        });
      });
    }
    const known = new Set(list.map((x) => bizNorm(x.name)));
    const extra = new Map();
    for (const r of Object.values(S.reports)) { const k = bizNorm(r.siteName); if (r.siteName && !known.has(k) && !extra.has(k)) extra.set(k, r.siteName); }
    for (const name of [...extra.values()].sort((a, b) => a.localeCompare(b, 'he'))) {
      list.push(withCoord({
        id: stableId('n:' + name), number: '', name, status: 'רק בדיווחים', statusId: 0, active: true, type: '', neighborhood: '',
        city: '', street: '', addressNote: '', phone: '', kosherType: '', kosherLevel: '', supervisors: '', inspectors: '', rabbi: '', paid: null,
        ckey: 'n:' + name,
      }));
    }
    return list;
  }

  // מסד הנתונים של "ניהול משגיחים" אם הוטמע, אחרת קובצי "לוח משגיחים"
  function boardData() {
    if (SEED.db && Array.isArray(SEED.db.businesses)) return { businesses: SEED.db.businesses, staff: SEED.db.staff || [] };
    return { businesses: (SEED.bizExtra && SEED.bizExtra.businesses) || [], staff: (SEED.staffExtra && SEED.staffExtra.people) || [] };
  }

  /* ---------- geocoding ---------- */
  // לעסקים בלי מיקום מחפשים את הכתובת (MapTiler עם המפתח של האפליקציה, ואם אין – OpenStreetMap).
  // התוצאה נשמרת בדפדפן, כך שכל כתובת נבדקת פעם אחת בלבד.
  const geoJob = { done: true, total: 0, fetched: 0 };
  const inHaifa = (lat, lng) => lat > 32.68 && lat < 32.93 && lng > 34.93 && lng < 35.16;
  async function geocode(q) {
    const key = SEED.maptilerKey;
    if (key && !geoJob.noMaptiler) {
      try {
        const r = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json?key=${encodeURIComponent(key)}&country=il&language=he&limit=1&proximity=34.99,32.79`);
        if (r.ok) { const f = ((await r.json()).features || [])[0]; return f && f.center ? [f.center[1], f.center[0]] : null; }
      } catch {}
      geoJob.noMaptiler = true; // חסום ברשת הזו – ממשיכים עם OpenStreetMap
    }
    await new Promise((res) => setTimeout(res, 1100)); // OpenStreetMap מגביל לבקשה אחת בשנייה
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('חיפוש הכתובות נכשל');
    const x = (await r.json())[0];
    return x ? [Number(x.lat), Number(x.lon)] : null;
  }
  function startGeocode() {
    if (!geoJob.done) return geoJob;
    S.geo = S.geo || {};
    const todo = sitesList().filter((x) => x.active && !x.coord && x.street && !(('a:' + x.street) in S.geo));
    Object.assign(geoJob, { done: !todo.length, total: todo.length, fetched: 0, error: '' });
    if (!todo.length) return geoJob;
    (async () => {
      let fails = 0;
      try {
        for (const x of todo) {
          let c;
          try { c = await geocode(`${x.street}, ${x.city || 'חיפה'}`); fails = 0; }
          catch (e) { if (++fails >= 5) throw e; geoJob.fetched++; continue; } // כתובת שנכשלה תיבדק שוב בפעם הבאה
          const ok = c && inHaifa(c[0], c[1]);
          S.geo['a:' + x.street] = ok ? c : null;
          if (ok) S.coords[x.ckey] = c;
          geoJob.fetched++;
          if (geoJob.fetched % 20 === 0) { save('coords'); save('geo'); }
        }
      } catch (e) { geoJob.error = 'חיפוש המיקומים לפי כתובת נכשל (אין חיבור לאינטרנט?)'; }
      await Promise.all([save('coords'), save('geo')]);
      geoJob.done = true;
    })();
    return geoJob;
  }

  function reportsIn(from, to) {
    const a = new Date(from + 'T00:00:00').getTime(), b = new Date(to + 'T23:59:59').getTime();
    const sites = sitesList();
    const byName = new Map();
    for (const x of sites) { const k = bizNorm(x.name); if (!byName.has(k) || x.active) byName.set(k, x); }
    return Object.values(S.reports).filter((r) => r.date >= a && r.date <= b).map((r) => {
      const site = byName.get(bizNorm(r.siteName));
      return { ...r, siteId: site ? site.id : null, coord: site ? site.coord : null };
    });
  }

  function staffExtra() {
    const extra = SEED.db && Array.isArray(SEED.db.staff)
      ? { importedAt: SEED.db.createdAt, people: JSON.parse(JSON.stringify(SEED.db.staff)) }
      : JSON.parse(JSON.stringify(SEED.staffExtra || { people: [] }));
    const notes = S.staffNotes;
    const known = new Set((extra.people || []).map((x) => x.id));
    extra.people = (extra.people || []).map((x) => ({ ...x, whatsapp: '', ...pick(notes[x.id], STAFF_FIELDS), edited: !!notes[x.id] }));
    for (const [id, n] of Object.entries(notes)) if (!known.has(id) && n.name) extra.people.push({ id, name: n.name, tel: '', phone: 'unknown', phoneNote: '', declaration: false, certificate: '', active: true, notes: '', whatsapp: '', ...pick(n, STAFF_FIELDS), edited: true, added: true });
    return extra;
  }

  function hasData() { return !!(S.sites || Object.keys(S.reports).length || boardData().businesses.length); }

  /* ---------- the API ---------- */

  const err = (status, msg) => Object.assign(new Error(msg), { status });

  async function localApi(path, { method = 'GET', body } = {}) {
    await ready;
    const url = new URL(path, 'http://x'), p = url.pathname, q = url.searchParams;
    let m;
    if (p === '/me') {
      let force = false;
      try { force = sessionStorage.getItem('showImport') === '1'; sessionStorage.removeItem('showImport'); } catch {}
      if (force || !hasData()) throw err(401, 'יש לטעון קובץ');
      return { user: { ...USER, authorityName: dataLabel() } };
    }
    if (p === '/logout') { try { sessionStorage.setItem('showImport', '1'); } catch {} return { ok: true }; }
    if (p === '/ping') return { ok: true };
    if (p === '/home') return [];
    if (p === '/config') return { maptilerKey: /^[A-Za-z0-9_-]{8,80}$/.test(SEED.maptilerKey || '') ? SEED.maptilerKey : '' };
    if (p === '/sites') return sitesList();
    if (p === '/reports') return reportsIn(q.get('from'), q.get('to'));
    if (p === '/last-reports') {
      const days = Math.min(Math.max(Number(q.get('days')) || 180, 30), 366), since = Date.now() - days * 864e5;
      const people = new Map();
      for (const r of Object.values(S.reports)) {
        if (r.date < since) continue;
        const o = people.get(r.supervisor) || { name: r.supervisor, group: r.group, last: 0, count: 0 };
        o.count++; o.last = Math.max(o.last, r.date);
        people.set(r.supervisor, o);
      }
      return { days, people: [...people.values()] };
    }
    // אין חיבור לאתר: פעיל / לא פעיל נלקח מ"לוח משגיחים"
    if (p === '/staff-status') return { people: staffExtra().people.map((x) => ({ id: x.id, name: x.name, role: 'משגיח', queriedActive: x.active !== false })) };
    if (p === '/staff-extra') return staffExtra();
    if ((m = /^\/staff-extra\/([\w-]{1,40})$/.exec(p)) && method === 'POST') {
      const data = pick(body, STAFF_FIELDS);
      for (const k of ['declaration', 'active']) if (k in data) data[k] = !!data[k];
      for (const k of ['tel', 'phoneNote', 'certificate', 'notes']) if (k in data) data[k] = String(data[k] ?? '').slice(0, 500);
      let id = m[1];
      if (id === 'new') {
        const name = String((body && body.name) || '').trim().slice(0, 80);
        if (!name) throw err(400, 'חסר שם');
        id = 'x' + Date.now().toString(36);
        S.staffNotes[id] = { name };
      }
      S.staffNotes[id] = { ...S.staffNotes[id], ...data, updatedAt: new Date().toISOString(), updatedBy: USER.name };
      await save('staffNotes');
      return { ok: true, id };
    }
    if (p === '/biz-extra') {
      const board = boardData(), names = new Map(board.staff.map((x) => [x.id, x.name]));
      const extra = SEED.db && Array.isArray(SEED.db.businesses)
        ? { source: 'מסד הנתונים של ניהול משגיחים', importedAt: SEED.db.createdAt, businesses: board.businesses.map((b) => ({ ...b, inspector: names.get(b.inspectorId) || b.inspector || '', sups: b.supIds || b.sups || [] })) }
        : JSON.parse(JSON.stringify(SEED.bizExtra || { businesses: [] }));
      extra.edits = S.bizEdits;
      extra.links = SEED.bizLinks || {};
      return extra;
    }
    if ((m = /^\/biz-edit\/([\w:-]+)$/.exec(p)) && method === 'POST') {
      const data = pick(body, BIZ_FIELDS);
      for (const k of Object.keys(data)) data[k] = String(data[k] ?? '').trim().slice(0, 500);
      S.bizEdits[m[1]] = { ...S.bizEdits[m[1]], ...data, updatedAt: new Date().toISOString(), updatedBy: USER.name };
      await save('bizEdits');
      return { ok: true };
    }
    if (p === '/trails') {
      const t = SEED.trails || {};
      return { job: { done: true, total: 0, fetched: 0 }, trails: Object.fromEntries(Object.entries(t).map(([id, x]) => [id, x.rows])) };
    }
    if (p === '/coords/refresh' && method === 'POST') return { ...startGeocode() };
    if (p === '/coords/status') return { ...geoJob };
    if (p === '/trails/refresh') return { done: true, total: 0, fetched: 0 };
    if (p === '/roles') return { roles: {}, meId: USER.userId };
    if ((m = /^\/site\/([\w:-]+)$/.exec(p))) {
      const id = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1];
      const s = sitesList().find((x) => String(x.id) === String(id));
      if (!s) throw err(404, 'בית העסק לא נמצא');
      if (method === 'POST') throw err(400, 'במצב ללא שרת אי אפשר לעדכן את שירת הים');
      return {
        id, fields: { SiteName: s.name, SiteCompany: '', SiteDescription: '', NameWrittenOnCheque: '', EmailAddress: '', Comments: '' },
        businessOpenDate: null, address: { city: s.city, street: s.street, house: '', comments: s.addressNote }, coord: s.coord, certificates: [],
      };
    }
    if ((m = /^\/site\/([\w:-]+)\/location$/.exec(p)) && method === 'POST') {
      const lat = Number(body && body.lat), lng = Number(body && body.lng);
      if (!(lat > 29 && lat < 34 && lng > 34 && lng < 36)) throw err(400, 'המיקום מחוץ לגבולות ישראל');
      const s = sitesList().find((x) => String(x.id) === m[1]);
      if (!s) throw err(404, 'בית העסק לא נמצא');
      S.coords[s.ckey] = [lat, lng];
      await save('coords');
      return { ok: true };
    }
    throw err(404, 'לא זמין במצב ללא שרת');
  }

  function dataLabel() {
    const n = Object.keys(S.reports).length, parts = [];
    parts.push(S.sites ? `${S.sites.length} בתי עסק מהייצוא` : `${boardData().businesses.length} בתי עסק ממסד הנתונים`);
    if (n) parts.push(`${n.toLocaleString('he-IL')} דיווחים`);
    const at = Math.max(S.meta.reportsAt || 0, S.meta.sitesAt || 0);
    return `ללא שרת · ${parts.join(', ')}${at ? ' · נטען ' + new Date(at).toLocaleDateString('he-IL') : ''}`;
  }

  // גיבוי ושחזור של כל מה שנשמר בדפדפן (להעברה למחשב אחר)
  async function exportBackup() {
    await ready;
    return JSON.stringify({ kind: 'kashrut-local-backup', at: new Date().toISOString(), ...pick(S, ['reports', 'sites', 'meta', 'staffNotes', 'bizEdits', 'coords', 'siteEdits', 'geo']) });
  }
  async function importBackup(text) {
    const j = JSON.parse(text);
    if (j.kind !== 'kashrut-local-backup') throw new Error('זה לא קובץ גיבוי של האפליקציה');
    for (const k of ['reports', 'sites', 'meta', 'staffNotes', 'bizEdits', 'coords', 'siteEdits', 'geo']) if (k in j) { S[k] = j[k]; await save(k); }
  }
  async function clearReports() { await ready; S.reports = {}; S.sites = null; S.meta = {}; await Promise.all(['reports', 'sites', 'meta'].map(save)); }

  window.localApi = localApi;
  window.localData = { importFiles, exportBackup, importBackup, clearReports, hasData: async () => { await ready; return hasData(); }, label: async () => { await ready; return dataLabel(); } };
})();
