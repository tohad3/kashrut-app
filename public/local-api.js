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
  const S = { reports: {}, sites: null, meta: {}, staffNotes: null, bizEdits: null, coords: {}, siteEdits: {}, geo: {}, bizMods: {}, bizAdded: {}, bizDismissed: {}, bizAliases: {}, syncLog: [], supSynced: {}, noAuto: {} };
  const ready = (async () => {
    for (const k of ['reports', 'sites', 'meta', 'staffNotes', 'bizEdits', 'coords', 'siteEdits', 'geo', 'bizMods', 'bizAdded', 'bizDismissed', 'bizAliases', 'syncLog', 'supSynced', 'noAuto']) {
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
  const isoDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

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
          const lo = list.reduce((a, r) => Math.min(a, r.date), Infinity), hi = list.reduce((a, r) => Math.max(a, r.date), 0);
          summary.push(`${file.name}: ${list.length} דיווחים (${added} חדשים)${list.length ? `, ${new Date(lo).toLocaleDateString('he-IL')}–${new Date(hi).toLocaleDateString('he-IL')}` : ''}`);
          // טווח התאריכים של הקובץ האחרון – ברירת המחדל של הדשבורד והנוכחות
          if (list.length) S.meta.lastRange = { from: isoDate(lo), to: isoDate(hi) };
          S.meta.reportsAt = Date.now();
          const log = await syncFromReports();
          const na = log.filter((x) => x.type === 'alias').length, ns = log.filter((x) => x.type === 'supervisors').length;
          if (na || ns) summary.push(`עודכן במסד: ${na} שמות שויכו לעסקים, ${ns} עסקים קיבלו משגיחים מהדיווחים`);
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

  const siteIdOf = (boardId) => { const l = (SEED.bizLinks || {})[boardId]; return l ? Number(l) : stableId(boardId); };

  // רשימת בתי העסק: מייצוא של שירת הים אם נטען, אחרת ממסד הנתונים של "ניהול משגיחים" (לוח משגיחים).
  // עסקים שמופיעים רק בדיווחים נוספים בסוף, כדי שכל דיווח יהיה משויך לעסק.
  function sitesList() {
    const boardCoords = Object.fromEntries(Object.entries(SEED.boardCoords || {}).map(([id, c]) => ['b:' + id, c]));
    const coords = { ...(SEED.coords || {}), ...boardCoords, ...S.coords };
    const withCoord = (x) => ({ ...x, coord: coords[x.ckey] || null });
    let list;
    if (S.sites) {
      list = S.sites.map((x) => withCoord({ ...x, name: (S.siteEdits[x.id] || {}).SiteName || x.name, ckey: x.id > 0 ? x.id : 'n:' + x.name }));
    } else {
      const board = boardData();
      const links = SEED.bizLinks || {};
      list = board.businesses.map((b) => {
        const linked = links[b.id] && coords[links[b.id]];
        const active = b.active !== false;
        return withCoord({
          id: siteIdOf(b.id), number: '', name: clean(b.name),
          status: active ? 'פעיל' : 'לא פעיל', statusId: active ? 2 : 4, active,
          type: clean(b.category), neighborhood: clean(b.cluster), city: 'חיפה',
          street: [clean(b.address), clean(b.number)].filter(Boolean).join(' '), addressNote: clean(b.subCluster), phone: '',
          kosherType: '', kosherLevel: '',
          supervisors: b.supNames.join(','), inspectors: b.inspector, rabbi: '', paid: null,
          ckey: linked ? links[b.id] : 'b:' + b.id, boardId: b.id, added: !!b.added,
        });
      });
    }
    const known = new Set(list.map((x) => bizNorm(x.name)));
    const extra = new Map();
    const key = canon();
    for (const r of Object.values(S.reports)) { const k = key(r.siteName); if (r.siteName && !known.has(k) && !extra.has(k)) extra.set(k, r.siteName); }
    const located = list.filter((x) => x.coord);
    for (const name of [...extra.values()].sort((a, b) => a.localeCompare(b, 'he'))) {
      const cluster = isCluster(name);
      const site = withCoord({
        id: stableId('n:' + name), number: '', name, status: cluster ? 'אשכול' : 'רק בדיווחים', statusId: 0, active: true, type: '', neighborhood: '',
        city: '', street: '', addressNote: '', phone: '', kosherType: '', kosherLevel: '', supervisors: '', inspectors: '', rabbi: '', paid: null,
        ckey: 'n:' + name,
      });
      if (!site.coord && cluster) site.coord = clusterCoord(name, located);
      list.push(site);
    }
    return list;
  }

  // מסד הנתונים של "ניהול משגיחים" אם הוטמע, אחרת קובצי "לוח משגיחים"
  // העסקים מנורמלים לשדות אחידים, עם השינויים שנעשו באפליקציה (bizMods) והעסקים שנוספו בה (bizAdded)
  function boardData() {
    const fromDb = SEED.db && Array.isArray(SEED.db.businesses);
    const raw = fromDb ? SEED.db.businesses : (SEED.bizExtra && SEED.bizExtra.businesses) || [];
    const staff = fromDb ? SEED.db.staff || [] : (SEED.staffExtra && SEED.staffExtra.people) || [];
    const nameOf = new Map(staff.map((x) => [x.id, x.name]));
    const idOf = new Map(staff.map((x) => [nameKey(x.name), x.id]));
    const norm = (b, extra) => {
      const m = S.bizMods[b.id] || {};
      const supNames = m.supervisors !== undefined ? splitNames(m.supervisors) : (b.supIds || b.sups || []).map((id) => nameOf.get(id)).filter(Boolean);
      return {
        ...b, ...pick(m, BOARD_FIELDS), ...extra,
        inspector: clean(m.inspector !== undefined ? m.inspector : b.inspectorId ? nameOf.get(b.inspectorId) : b.inspector),
        active: (m.active !== undefined ? m.active : b.active) !== false,
        supNames, sups: supNames.map((n) => idOf.get(nameKey(n))).filter(Boolean),
      };
    };
    const businesses = raw.map((b) => norm(b, { edited: !!S.bizMods[b.id] }));
    for (const [id, b] of Object.entries(S.bizAdded)) businesses.push(norm({ ...b, id }, { added: true }));
    return { businesses, staff };
  }
  const BOARD_FIELDS = ['name', 'address', 'number', 'cluster', 'subCluster', 'route', 'category', 'notes'];
  const nameKey = (n) => String(n || '').replace(/["'׳״.]/g, '').trim().split(/\s+/).filter((w) => w && w !== 'הרב').sort().join(' ');
  const splitNames = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

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
        if (r.ok) { const f = ((await r.json()).features || [])[0]; if (f && f.center) return [f.center[1], f.center[0]]; }
        else geoJob.noMaptiler = true;
      } catch { geoJob.noMaptiler = true; } // חסום ברשת הזו – ממשיכים עם OpenStreetMap
      // MapTiler לא מוצא הרבה כתובות בעברית, ולכן גם אז מנסים את OpenStreetMap
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
    // עסק עם כתובת – לפי הכתובת; עסק שמופיע רק בדיווחים – לפי השם שלו
    const qOf = (x) => (x.street ? `${x.street}, ${x.city || 'חיפה'}` : x.statusId === 0 && !isCluster(x.name) ? `${x.name}, חיפה` : '');
    const todo = sitesList().filter((x) => x.active && !x.coord && qOf(x) && !(('a:' + (x.street || 'n:' + x.name)) in S.geo));
    Object.assign(geoJob, { done: !todo.length, total: todo.length, fetched: 0, error: '' });
    if (!todo.length) return geoJob;
    (async () => {
      let fails = 0;
      try {
        for (const x of todo) {
          let c;
          try { c = await geocode(qOf(x)); fails = 0; }
          catch (e) { if (++fails >= 5) throw e; geoJob.fetched++; continue; } // כתובת שנכשלה תיבדק שוב בפעם הבאה
          const ok = c && inHaifa(c[0], c[1]);
          S.geo['a:' + (x.street || 'n:' + x.name)] = ok ? c : null;
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

  // מיקום לדיווח על "אשכול" (למשל "אשכול- גרנד קניון"): מרכז העסקים שבשמם מופיעות מילות האשכול,
  // ואם אין כאלה – מרכז העסקים של המשגיחים שדיווחו על האשכול, כשהם קרובים זה לזה
  function clusterCoord(name, located) {
    const w = [...words(String(name).replace(/^\s*אשכול\s*/, ''))];
    // מרכז הנקודות סביב החציון; נקודה רחוקה (מיקום שגוי של עסק אחד) לא מזיזה אותו
    const near = (p, c) => Math.abs(p[0] - c[0]) < 0.006 && Math.abs(p[1] - c[1]) < 0.007; // בערך 700 מטר
    const center = (pts) => {
      if (!pts.length) return null;
      const med = (i) => pts.map((p) => p[i]).sort((x, y) => x - y)[Math.floor(pts.length / 2)];
      const m = [med(0), med(1)], ins = pts.filter((p) => near(p, m));
      return ins.length * 2 >= pts.length ? [ins.reduce((a, c) => a + c[0], 0) / ins.length, ins.reduce((a, c) => a + c[1], 0) / ins.length] : null;
    };
    const spreadOk = () => true;
    for (let n = Math.min(w.length, 3); n >= 1; n--) {
      for (let i = 0; i + n <= w.length; i++) {
        const part = w.slice(i, i + n);
        if (n === 1 && part[0].length < 4) continue;
        const hits = located.filter((x) => { const xw = words(x.name); return part.every((t) => xw.has(t)); }).map((x) => x.coord);
        const c = center(hits);
        if (c && spreadOk(hits, c)) return c;
      }
    }
    const sups = new Set(Object.values(S.reports).filter((r) => r.siteName === name).map((r) => nameKey(r.supervisor)));
    const mine = located.filter((x) => splitNames(x.supervisors).some((n) => sups.has(nameKey(n)))).map((x) => x.coord);
    const c = center(mine);
    return c && spreadOk(mine, c) ? c : null;
  }

  // שם עסק בדיווח -> מפתח השם של העסק ברשימה (כולל שמות ששויכו ידנית לעסק קיים)
  function canon() {
    const names = new Map(boardData().businesses.map((b) => [b.id, bizNorm(b.name)]));
    return (name) => { const k = bizNorm(name), id = S.bizAliases[k]; return (id && names.get(id)) || k; };
  }

  function reportsIn(from, to) {
    const a = new Date(from + 'T00:00:00').getTime(), b = new Date(to + 'T23:59:59').getTime();
    const sites = sitesList();
    const byName = new Map();
    for (const x of sites) { const k = bizNorm(x.name); if (!byName.has(k) || x.active) byName.set(k, x); }
    const key = canon();
    return Object.values(S.reports).filter((r) => r.date >= a && r.date <= b).map((r) => {
      const site = byName.get(key(r.siteName));
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

  /* ---------- matching report names to businesses ---------- */
  // דיווח על "אשכול" (קבוצת עסקים) אינו עסק
  const isCluster = (name) => /^\s*אשכול/.test(name || '');
  const STOP = new Set(['בעמ', 'בע', 'מ', 'חיפה', 'סניף']);
  const words = (v) => new Set(bizNorm(v).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
  const pairs = (v) => { const t = bizNorm(v).replace(/ /g, ''), o = new Set(); for (let i = 0; i < t.length - 1; i++) o.add(t.slice(i, i + 2)); return o; };
  const overlap = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

  // העסק הקרוב ביותר לשם מהדיווח: דמיון במילים (בלי תלות בסדר) ובאותיות,
  // ותוספת כשהמשגיח שדיווח משויך לעסק במסד הנתונים
  function bestMatch(name, supervisors, board) {
    const w = words(name), pr = pairs(name), sups = new Set([...supervisors].map(nameKey));
    let best = null;
    for (const b of board) {
      const bw = b._w || (b._w = words(b.name)), bp = b._p || (b._p = pairs(b.name));
      if (!w.size || !bw.size) continue;
      const i = overlap(w, bw);
      const byWords = (i / Math.min(w.size, bw.size)) * 0.6 + (i / (w.size + bw.size - i)) * 0.4;
      const byLetters = overlap(pr, bp) / Math.max(1, pr.size + bp.size - overlap(pr, bp));
      const supMatch = b.supNames.some((n) => sups.has(nameKey(n)));
      const score = Math.max(byWords, byLetters) + (supMatch ? 0.25 : 0);
      if (!best || score > best.score) best = { id: b.id, name: b.name, score, supMatch };
    }
    return best;
  }
  const AUTO_SCORE = 0.85, SUGGEST_SCORE = 0.55;

  // עדכון המסד לפי הדיווחים: (1) שם שלא נמצא ברשימה ודומה מספיק לעסק – משויך אליו;
  // (2) משגיח שדיווח על עסק לפחות פעמיים ואינו משויך אליו – נוסף למשגיחי העסק.
  // כל שינוי נרשם ב-syncLog, ונעשה פעם אחת בלבד (כך שביטול ידני לא נדרס).
  async function syncFromReports() {
    const board = boardData().businesses;
    const byName = new Set(board.map((b) => bizNorm(b.name)));
    const groups = new Map();
    for (const r of Object.values(S.reports)) {
      const k = bizNorm(r.siteName);
      if (!k || isCluster(r.siteName)) continue;
      const g = groups.get(k) || { name: r.siteName, sups: new Map() };
      g.sups.set(r.supervisor, (g.sups.get(r.supervisor) || 0) + 1);
      groups.set(k, g);
    }
    const at = new Date().toISOString(), log = [];
    for (const [k, g] of groups) {
      if (byName.has(k) || S.bizAliases[k] || S.bizDismissed[k] || S.noAuto[k]) continue;
      const m = bestMatch(g.name, g.sups.keys(), board);
      if (m && m.score >= AUTO_SCORE) { S.bizAliases[k] = m.id; log.push({ type: 'alias', name: g.name, boardId: m.id, to: m.name, supMatch: m.supMatch, at }); }
    }
    const key = canon(), byKey = new Map(board.map((b) => [bizNorm(b.name), b]));
    const perBiz = new Map();
    for (const [k, g] of groups) {
      const b = byKey.get(key(g.name));
      if (!b) continue;
      const o = perBiz.get(b.id) || new Map();
      for (const [sup, n] of g.sups) o.set(sup, (o.get(sup) || 0) + n);
      perBiz.set(b.id, o);
    }
    for (const b of board) {
      const counts = perBiz.get(b.id);
      if (!counts) continue;
      const have = new Set(b.supNames.map(nameKey));
      const add = [...counts].filter(([sup, n]) => n >= 2 && !have.has(nameKey(sup)) && !S.supSynced[b.id + '|' + nameKey(sup)]).map(([sup]) => sup);
      if (!add.length) continue;
      for (const sup of add) S.supSynced[b.id + '|' + nameKey(sup)] = at;
      const list = [...b.supNames, ...add].join(', ');
      if (S.bizAdded[b.id]) S.bizAdded[b.id] = { ...S.bizAdded[b.id], supervisors: list };
      else S.bizMods[b.id] = { ...S.bizMods[b.id], supervisors: list, updatedAt: at };
      log.push({ type: 'supervisors', boardId: b.id, to: b.name, added: add, at });
    }
    if (log.length) {
      S.syncLog = [...log, ...S.syncLog].slice(0, 2000);
      await Promise.all(['bizAliases', 'bizMods', 'bizAdded', 'supSynced', 'syncLog'].map(save));
    }
    return log;
  }

  /* ---------- new / dropped businesses ---------- */
  // חדש: שם שמופיע בדיווחים (או בייצוא בתי העסק) ואין עסק כזה ברשימה.
  // ירד: עסק פעיל ברשימה שלא היה עליו אף דיווח בימים האחרונים (או שאינו בייצוא בתי העסק, אם נטען).
  function bizChanges(days) {
    const board = boardData().businesses;
    const byName = new Map(board.map((b) => [bizNorm(b.name), b]));
    const reports = Object.values(S.reports);
    const last = new Map(), seen = new Map();
    let minDate = Infinity, maxDate = 0;
    const key = canon();
    for (const r of reports) {
      const k = key(r.siteName);
      if (!k) continue;
      minDate = Math.min(minDate, r.date); maxDate = Math.max(maxDate, r.date);
      last.set(k, Math.max(last.get(k) || 0, r.date));
      const o = seen.get(k) || { name: r.siteName, count: 0, last: 0, supervisors: new Set() };
      o.count++; o.last = Math.max(o.last, r.date); o.supervisors.add(r.supervisor);
      seen.set(k, o);
    }
    const fresh = [...seen.entries()].filter(([k, o]) => !byName.has(k) && !S.bizDismissed[k] && !isCluster(o.name))
      .map(([, o]) => {
        const m = bestMatch(o.name, o.supervisors, board);
        return { name: o.name, count: o.count, last: o.last, supervisors: [...o.supervisors], suggest: m && m.score >= SUGGEST_SCORE ? { id: m.id, name: m.name, supMatch: m.supMatch } : null };
      })
      .sort((a, b) => b.last - a.last);
    if (S.sites) for (const x of S.sites) { const k = bizNorm(x.name); if (!byName.has(k) && !seen.has(k) && !S.bizDismissed[k] && x.active) fresh.push({ name: x.name, count: 0, last: 0, supervisors: splitNames(x.supervisors), fromExport: true }); }
    const covered = reports.length ? Math.round((maxDate - minDate) / 864e5) + 1 : 0;
    const since = maxDate - (Math.min(days, covered) - 1) * 864e5;
    const exportNames = S.sites && new Set(S.sites.filter((x) => x.active).map((x) => bizNorm(x.name)));
    const silent = board.filter((b) => b.active).map((b) => {
      const k = bizNorm(b.name), l = last.get(k) || 0;
      const missing = exportNames && !exportNames.has(k);
      return { id: b.id, siteId: siteIdOf(b.id), name: b.name, cluster: b.cluster, inspector: b.inspector, last: l, notInExport: !!missing, noReports: !!reports.length && l < since };
    }).filter((x) => x.notInExport || x.noReports).sort((a, b) => b.notInExport - a.notInExport || a.last - b.last);
    const dismissed = Object.values(S.bizDismissed);
    const nameOf = new Map(board.map((b) => [b.id, b.name]));
    const aliases = Object.entries(S.bizAliases).map(([k, id]) => {
      const e = S.syncLog.find((x) => x.type === 'alias' && bizNorm(x.name) === k);
      return { key: k, name: (e && e.name) || k, boardId: id, to: nameOf.get(id) || '', auto: !!e, supMatch: !!(e && e.supMatch) };
    });
    const supLog = S.syncLog.filter((x) => x.type === 'supervisors');
    return { days: Math.min(days, covered), covered, from: reports.length ? minDate : null, to: maxDate || null, fresh, silent, dismissed, aliases, supLog,
      added: board.filter((b) => b.added).map((b) => ({ id: b.id, siteId: siteIdOf(b.id), name: b.name })),
      inactive: board.filter((b) => !b.active).map((b) => ({ id: b.id, siteId: siteIdOf(b.id), name: b.name })) };
  }

  /* ---------- the API ---------- */

  const err = (status, msg) => Object.assign(new Error(msg), { status });

  async function localApi(path, { method = 'GET', body } = {}) {
    await ready;
    const url = new URL(path, 'http://x'), p = url.pathname, q = url.searchParams;
    let m;
    if (p === '/me') {
      // נתונים שנטענו לפני שהיה שיוך אוטומטי – משייכים פעם אחת
      if (Object.keys(S.reports).length && !S.meta.synced) { await syncFromReports(); S.meta.synced = 1; await save('meta'); }
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
      const board = boardData();
      const extra = { source: SEED.db ? 'מסד הנתונים של ניהול משגיחים' : 'לוח משגיחים', importedAt: SEED.db ? SEED.db.createdAt : SEED.bizExtra && SEED.bizExtra.importedAt, businesses: board.businesses };
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
    // ניהול רשימת העסקים: עדכון פרטים, הוספה, סימון לא פעיל
    if ((m = /^\/biz-manage\/([\w-]{1,40})$/.exec(p)) && method === 'POST') {
      const data = {};
      for (const k of [...BOARD_FIELDS, 'inspector', 'supervisors']) if (body && k in body) data[k] = String(body[k] ?? '').trim().slice(0, 300);
      if (body && 'active' in body) data.active = !!body.active;
      let id = m[1];
      if (id === 'new') {
        if (!data.name) throw err(400, 'חסר שם עסק');
        if (boardData().businesses.some((b) => bizNorm(b.name) === bizNorm(data.name))) throw err(400, 'כבר יש עסק בשם הזה');
        id = 'a' + Date.now().toString(36);
        S.bizAdded[id] = { active: true, ...data, addedAt: new Date().toISOString() };
        await save('bizAdded');
        return { ok: true, id, siteId: siteIdOf(id) };
      }
      if (body && body.remove) {
        if (!S.bizAdded[id]) throw err(400, 'אפשר למחוק רק עסק שנוסף באפליקציה. עסק מהמסד מסמנים כלא פעיל');
        delete S.bizAdded[id];
        await save('bizAdded');
        return { ok: true };
      }
      if (S.bizAdded[id]) { S.bizAdded[id] = { ...S.bizAdded[id], ...data }; await save('bizAdded'); }
      else if (boardData().businesses.some((b) => b.id === id)) { S.bizMods[id] = { ...S.bizMods[id], ...data, updatedAt: new Date().toISOString() }; await save('bizMods'); }
      else throw err(404, 'העסק לא נמצא');
      return { ok: true, id };
    }
    // שם מהדיווחים שאינו עסק חדש (למשל שם אחר לעסק קיים) – לא יוצג שוב כחדש
    if (p === '/biz-dismiss' && method === 'POST') {
      const n = bizNorm(body && body.name);
      if (!n) throw err(400, 'חסר שם');
      if (body.undo) delete S.bizDismissed[n]; else S.bizDismissed[n] = { name: body.name, at: new Date().toISOString() };
      await save('bizDismissed');
      return { ok: true };
    }
    // שם מהדיווחים ששייך לעסק קיים ברשימה (שם אחר לאותו עסק)
    if (p === '/biz-alias' && method === 'POST') {
      const n = bizNorm(body && body.name), id = body && body.boardId;
      if (!n || (!body.undo && !boardData().businesses.some((b) => b.id === id))) throw err(400, 'יש לבחור עסק מהרשימה');
      if (body.undo) delete S.bizAliases[n]; else S.bizAliases[n] = id;
      if (body.undo) S.noAuto[n] = 1; // שיוך שבוטל לא ייעשה שוב אוטומטית
      await Promise.all([save('bizAliases'), save('noAuto')]);
      return { ok: true };
    }
    if (p === '/biz-changes') return bizChanges(Number(q.get('days')) || 30);
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
    return JSON.stringify({ kind: 'kashrut-local-backup', at: new Date().toISOString(), ...pick(S, ['reports', 'sites', 'meta', 'staffNotes', 'bizEdits', 'coords', 'siteEdits', 'geo', 'bizMods', 'bizAdded', 'bizDismissed', 'bizAliases', 'syncLog', 'supSynced', 'noAuto']) });
  }
  async function importBackup(text) {
    const j = JSON.parse(text);
    if (j.kind !== 'kashrut-local-backup') throw new Error('זה לא קובץ גיבוי של האפליקציה');
    for (const k of ['reports', 'sites', 'meta', 'staffNotes', 'bizEdits', 'coords', 'siteEdits', 'geo', 'bizMods', 'bizAdded', 'bizDismissed', 'bizAliases', 'syncLog', 'supSynced', 'noAuto']) if (k in j) { S[k] = j[k]; await save(k); }
  }
  async function clearReports() { await ready; S.reports = {}; S.sites = null; S.meta = {}; await Promise.all(['reports', 'sites', 'meta'].map(save)); }

  window.localApi = localApi;
  window.localData = { lastRange: async () => { await ready; return S.meta.lastRange || null; }, importFiles, exportBackup, importBackup, clearReports, hasData: async () => { await ready; return hasData(); }, label: async () => { await ready; return dataLabel(); } };
})();
