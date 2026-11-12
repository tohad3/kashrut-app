/* ===== שכבת חיבור ל-Google Apps Script =====
   הנתונים שהגרסה ללא שרת שומרת בדפדפן (IndexedDB) נשמרים כאן בחשבון Google של המחלקה, משותפים לכל המשתמשים.
   local-api.js קורא ל-window.LOCAL_BACKEND במקום ל-IndexedDB. */
(function () {
  const B = window.BOOT || {};
  const call = (op, args) => new Promise((res, rej) => {
    if (!window.google || !google.script) return rej(new Error('אין חיבור לשרת'));
    google.script.run.withSuccessHandler(r => res(r ? JSON.parse(r) : null)).withFailureHandler(e => {
      const m = String(e && e.message || e);
      const err = new Error(/unauthorized/.test(m) ? 'הקישור האישי אינו תקף עוד' : /forbidden/.test(m) ? 'אין הרשאה לפעולה הזו' : m);
      err.code = /unauthorized/.test(m) ? 'unauthorized' : /forbidden/.test(m) ? 'forbidden' : 'server';
      if (err.code === 'unauthorized') dead();
      rej(err);
    }).api(B.token, op, JSON.stringify(args || {}));
  });
  function dead() {
    clearInterval(timer);
    document.body.innerHTML = '<div dir="rtl" style="font-family:Arial;padding:40px;text-align:center"><h2>הקישור האישי אינו תקף עוד</h2><p>פנו למנהל המערכת לקבלת קישור חדש.</p></div>';
  }

  // טעינה מחדש של הדף: בתוך המסגרת של Google צריך לפתוח מחדש את הכתובת הראשית
  const reload = () => {
    try { window.open(B.url + (B.url.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(B.token), '_top'); }
    catch (e) { location.reload(); }
  };
  window.GS = { call, boot: B, reload };

  /* ---- מאגר: כל המפתחות נטענים פעם אחת, וכל שמירה שולחת לשרת רק את מה שהשתנה ---- */
  const vers = {};    // key -> גרסה בשרת
  const base = {};    // key -> מה שהשרת יודע (לחישוב השינויים): לאובייקט – מפה של רשומה -> JSON
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const snap = v => {
    if (!isObj(v)) return { whole: JSON.stringify(v === undefined ? null : v) };
    const m = {}; for (const k of Object.keys(v)) m[k] = JSON.stringify(v[k]); return { map: m };
  };
  let loaded = null;
  const load = () => loaded || (loaded = call('load').then(r => {
    const vals = r.vals || {};
    for (const k of Object.keys(r.vers || {})) vers[k] = r.vers[k];
    for (const k of Object.keys(vals)) base[k] = snap(vals[k]);
    window.GS.online = true;
    return vals;
  }));

  // שמירות לפי הסדר, כל מפתח בנפרד; מחוון "שומר…" ואזהרה ביציאה מהדף
  const queue = {}, latest = {};
  let saving = 0, savedTimer = null;
  const badge = () => {
    let b = document.getElementById('gSaving');
    if (!b) { b = document.createElement('div'); b.id = 'gSaving'; b.setAttribute('role', 'status'); b.style.cssText = 'position:fixed;bottom:14px;left:14px;z-index:9999;padding:7px 14px;border-radius:999px;font:600 13px Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.18);transition:opacity .3s;pointer-events:none'; document.body.appendChild(b); }
    return b;
  };
  const savingAdd = (n, failed) => {
    saving = Math.max(0, saving + n); const b = badge(); clearTimeout(savedTimer);
    if (failed) { b.textContent = 'השמירה נכשלה – בדקו את החיבור ונסו שוב'; b.style.background = '#fde2e1'; b.style.color = '#8a1c1c'; b.style.opacity = '1'; savedTimer = setTimeout(() => { b.style.opacity = '0'; }, 6000); return; }
    if (saving) { b.textContent = 'שומר שינויים…'; b.style.background = '#fff4d6'; b.style.color = '#7a5200'; b.style.opacity = '1'; }
    else { b.textContent = '✓ השינויים נשמרו'; b.style.background = '#e3f4e8'; b.style.color = '#1d6b3a'; b.style.opacity = '1'; savedTimer = setTimeout(() => { b.style.opacity = '0'; }, 1800); }
  };
  window.addEventListener('beforeunload', e => { if (saving) { e.preventDefault(); e.returnValue = 'שינויים עדיין נשמרים'; return e.returnValue; } });

  async function send(key) {
    const val = latest[key]; delete latest[key];
    const now = snap(val), was = base[key];
    let r;
    if (now.map && was && was.map) {
      const set = {}, del = [];
      for (const k of Object.keys(now.map)) if (now.map[k] !== was.map[k]) set[k] = JSON.parse(now.map[k]);
      for (const k of Object.keys(was.map)) if (!(k in now.map)) del.push(k);
      if (!Object.keys(set).length && !del.length) return;
      r = await call('patch', { key, set, del });
    } else {
      if (was && now.whole !== undefined && was.whole === now.whole) return;
      r = await call('put', { key, val: val === undefined ? null : val });
    }
    base[key] = now;
    if (r && r.ver) vers[key] = r.ver;
  }
  function put(key, val) {
    latest[key] = JSON.parse(JSON.stringify(val === undefined ? null : val));
    if (queue[key]) return queue[key].then(() => { }); // השמירה הבאה בתור תשלח את הערך האחרון
    savingAdd(1);
    let failed = false;
    const p = (async () => {
      await load();
      while (key in latest) {
        try { await send(key); } catch (e) { failed = true; console.warn('save', key, e); break; }
      }
    })().finally(() => { delete queue[key]; savingAdd(-1, failed); });
    queue[key] = p;
    return p;
  }

  /* ---- עדכונים ממשתמשים אחרים: בדיקת גרסאות כל דקה ---- */
  let timer = null;
  async function poll() {
    if (document.hidden || !window.LOCAL_BACKEND.onRemote) return;
    let r; try { r = await call('vers'); } catch (e) { return; }
    for (const k of Object.keys(r || {})) {
      if (!(r[k] > (vers[k] || 0)) || queue[k]) continue;
      try {
        const g = await call('get', { key: k });
        if (queue[k]) continue;
        vers[k] = g.ver; base[k] = snap(g.val);
        window.LOCAL_BACKEND.onRemote(k, g.val);
      } catch (e) { }
    }
  }
  timer = setInterval(poll, 60000);

  window.LOCAL_BACKEND = {
    get: async key => { const v = await load(); return v[key] === null ? undefined : v[key]; },
    put,
    geocode: q => call('geocode', { q }),
    onRemote: null
  };
})();
