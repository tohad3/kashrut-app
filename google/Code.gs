/**
 * ניהול כשרות – מחלקת הכשרות, המועצה הדתית חיפה
 * צד השרת (Google Apps Script). הנתונים (דיווחים, עריכות, מיקומים) נשמרים כקובצי JSON בתיקייה ב-Drive של חשבון המחלקה,
 * והמשתמשים בגיליון Google. כניסה בקישור אישי בלבד (?k=...), בלי חשבון Google למשתתפים.
 *
 * הקמה: להריץ פעם אחת את setup() מתוך העורך, לפרוס כ"אפליקציית אינטרנט"
 * (Execute as: Me, Who has access: Anyone) ואז להריץ adminLink() לקבלת הקישור האישי שלך.
 */

// הכתובת שהמשתתפים מקבלים. ריק = כתובת הפריסה של Google. אחרי הקמת דף עוטף ב-Firebase – לכתוב כאן את הכתובת שלו
const PUBLIC_URL = 'https://kashrut-nochechut.web.app/';
const appUrl_ = () => PUBLIC_URL || ScriptApp.getService().getUrl();
const APP_NAME = 'ניהול כשרות – מחלקת הכשרות';
const MAIL_NAME = 'מחלקת הכשרות – המועצה הדתית חיפה';
// המפתחות שהאפליקציה שומרת (כמו ב-IndexedDB בגרסה ללא שרת)
const KEYS_ = ['reports', 'sites', 'meta', 'staffNotes', 'bizEdits', 'coords', 'siteEdits', 'geo', 'bizMods', 'bizAdded', 'bizDismissed', 'bizAliases', 'syncLog', 'supSynced', 'noAuto'];
const BACKUP_KEEP_ = 30;

/* ===================== הקמה ===================== */
function setup() {
  const P = PropertiesService.getScriptProperties();
  let ss = P.getProperty('SHEET_ID') ? SpreadsheetApp.openById(P.getProperty('SHEET_ID')) : null;
  if (!ss) { ss = SpreadsheetApp.create('ניהול כשרות – משתמשים'); P.setProperty('SHEET_ID', ss.getId()); }
  let users = ss.getSheetByName('משתמשים');
  if (!users) {
    users = ss.insertSheet('משתמשים');
    users.getRange(1, 1, 1, 8).setValues([['token', 'uid', 'שם', 'דוא"ל', 'מנהל מערכת', 'פעיל', 'נוצר', 'כניסה אחרונה']]).setFontWeight('bold');
    users.setFrozenRows(1); users.setRightToLeft(true);
    users.getRange(1, 1, users.getMaxRows(), 8).setNumberFormat('@');
    users.protect().setWarningOnly(true).setDescription('נערך דרך המערכת בלבד');
  }
  const s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1'); if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  if (!P.getProperty('FOLDER_ID')) P.setProperty('FOLDER_ID', DriveApp.createFolder('ניהול כשרות – נתונים').getId());
  // מאגר העסקים והמשגיחים (מקובץ Seed.gs שנוצר בבנייה) – נכתב לקובץ seed.json
  if (typeof SEED !== 'undefined') { writeFile_('seed', JSON.stringify(SEED)); Logger.log('מאגר העסקים נטען: ' + ((SEED.db && SEED.db.businesses) || []).length + ' עסקים'); }
  if (users.getLastRow() < 2) addUser_({ name: 'מנהל המערכת', email: Session.getEffectiveUser().getEmail(), admin: true });
  // גיבוי יומי
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'dailyBackup').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
  Logger.log('ההקמה הושלמה. משתמשים: ' + ss.getUrl());
  Logger.log('תיקיית הנתונים: ' + folder_().getUrl());
  Logger.log('השלב הבא: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone), ואז להריץ adminLink().');
}

function adminLink() {
  const url = appUrl_();
  if (!url) { Logger.log('המערכת עדיין לא נפרסה. בצעו Deploy > New deployment > Web app ואז הריצו שוב.'); return; }
  usersAll_().filter(u => u.admin && u.active).forEach(u => Logger.log(u.name + ': ' + url + '?k=' + u.token));
}

/* ===================== כניסה ===================== */
function doGet(e) {
  const tok = String((e && e.parameter && e.parameter.k) || '');
  const u = tok && userByToken_(tok);
  if (!u) {
    return HtmlService.createHtmlOutput('<div dir="rtl" style="font-family:Arial;padding:40px;text-align:center"><h2>הקישור אינו תקף</h2><p>לכניסה למערכת יש להשתמש בקישור האישי שקיבלתם במייל. אם הקישור הפסיק לעבוד, פנו למנהל המערכת.</p></div>')
      .setTitle(APP_NAME);
  }
  touchUser_(u);
  const t = HtmlService.createTemplateFromFile('Index');
  // נתונים שמוטמעים בתוך תגית script: בלי "</" ובלי מפרידי שורות של JS
  const inline = s => s.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  t.boot = inline(JSON.stringify({ token: tok, uid: u.uid, name: u.name, email: u.email, admin: u.admin, url: appUrl_() }));
  t.seed = inline(readFile_('seed') || '{}');
  t.lib = HtmlService.createTemplateFromFile('Lib').getRawContent();
  return t.evaluate().setTitle(APP_NAME).addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ===================== API ===================== */
function api(token, op, argsJson) {
  const u = userByToken_(String(token || ''));
  if (!u) throw new Error('unauthorized');
  const a = argsJson ? JSON.parse(argsJson) : {};
  const r = API_[op];
  if (!r) throw new Error('bad_op');
  return JSON.stringify(r(a, u) ?? null);
}
const adminOnly_ = u => { if (!u.admin) throw new Error('forbidden'); };
const key_ = k => { if (KEYS_.indexOf(String(k)) < 0) throw new Error('bad_key'); return String(k); };
const API_ = {
  load: () => { const vals = {}; KEYS_.forEach(k => { const s = readFile_(k); vals[k] = s ? JSON.parse(s) : null; }); return { vals, vers: vers_() }; },
  vers: () => vers_(),
  get: a => { const k = key_(a.key); const s = readFile_(k); return { val: s ? JSON.parse(s) : null, ver: vers_()[k] || 0 }; },
  put: (a, u) => withLock_(() => { const k = key_(a.key); writeFile_(k, JSON.stringify(a.val ?? null)); return { ver: bump_(k, u) }; }),
  // שינוי חלקי של אובייקט: רק הרשומות שהשתנו, על גבי הגרסה העדכנית בשרת (כך ששני משתמשים לא דורסים זה את זה)
  patch: (a, u) => withLock_(() => {
    const k = key_(a.key); const s = readFile_(k); let cur = s ? JSON.parse(s) : {};
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
    Object.keys(a.set || {}).forEach(x => { cur[x] = a.set[x]; });
    (a.del || []).forEach(x => { delete cur[x]; });
    writeFile_(k, JSON.stringify(cur));
    return { ver: bump_(k, u) };
  }),
  geocode: a => geocode_(String(a.q || '').slice(0, 200)),
  // ניהול משתמשים – מנהל מערכת בלבד
  users: (a, u) => { adminOnly_(u); return usersAll_().map(x => ({ uid: x.uid, name: x.name, email: x.email, admin: x.admin, active: x.active, lastSeen: x.lastSeen })); },
  userSave: (a, u) => { adminOnly_(u); return withLock_(() => saveUser_(a, u)); },
  userReset: (a, u) => { adminOnly_(u); return withLock_(() => resetToken_(a.uid)); },
  userDelete: (a, u) => { adminOnly_(u); if (a.uid === u.uid) throw new Error('אי אפשר למחוק את עצמך'); return withLock_(() => deleteUser_(a.uid)); },
  userLink: (a, u) => { adminOnly_(u); return sendLink_(a.uid, u); },
  backupNow: (a, u) => { adminOnly_(u); dailyBackup(); return { ok: true }; },
};

/* ===================== קובצי הנתונים ב-Drive ===================== */
function folder_() { return DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID')); }
function withLock_(fn) { const l = LockService.getScriptLock(); l.waitLock(25000); try { return fn(); } finally { l.releaseLock(); } }
function fileOf_(k, create) {
  const P = PropertiesService.getScriptProperties(); const id = P.getProperty('F_' + k);
  if (id) { try { const f = DriveApp.getFileById(id); if (!f.isTrashed()) return f; } catch (e) { } }
  const it = folder_().getFilesByName(k + '.json');
  if (it.hasNext()) { const f = it.next(); P.setProperty('F_' + k, f.getId()); return f; }
  if (!create) return null;
  const f = folder_().createFile(k + '.json', '', 'application/json'); P.setProperty('F_' + k, f.getId()); return f;
}
function readFile_(k) { const f = fileOf_(k, false); if (!f) return null; const s = f.getBlob().getDataAsString('UTF-8'); return s || null; }
function writeFile_(k, s) { fileOf_(k, true).setContent(s); }
function vers_() { const p = PropertiesService.getScriptProperties().getProperties(); const o = {}; KEYS_.forEach(k => { o[k] = +(p['V_' + k] || 0); }); return o; }
function bump_(k, u) {
  const P = PropertiesService.getScriptProperties(); const v = +(P.getProperty('V_' + k) || 0) + 1;
  P.setProperty('V_' + k, String(v)); P.setProperty('W_' + k, u.name + ' · ' + new Date().toISOString());
  return v;
}

/* ===================== איתור מיקום לפי כתובת ===================== */
// השרת של Google פונה ל-OpenStreetMap (ואם צריך ל-Photon) – כך שסינון הרשת במחשב לא חוסם. תוצאות נשמרות במטמון ל-6 שעות
function geocode_(q) {
  if (!q) return null;
  const C = CacheService.getScriptCache(); const ck = 'g:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, q, Utilities.Charset.UTF_8));
  const hit = C.get(ck); if (hit) return JSON.parse(hit);
  const get = url => UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'kashrut-haifa-app/1.0', 'Accept-Language': 'he' } });
  let out = null, ok = false;
  try {
    const r = get('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&q=' + encodeURIComponent(q));
    if (r.getResponseCode() === 200) { const x = JSON.parse(r.getContentText())[0]; out = x ? [Number(x.lat), Number(x.lon)] : null; ok = true; }
  } catch (e) { }
  if (!ok || !out) {
    try {
      const r = get('https://photon.komoot.io/api/?limit=1&lat=32.79&lon=34.99&q=' + encodeURIComponent(q));
      if (r.getResponseCode() === 200) { const f = (JSON.parse(r.getContentText()).features || [])[0]; const c = f && f.geometry && f.geometry.coordinates; out = c ? [Number(c[1]), Number(c[0])] : out; ok = true; }
    } catch (e) { }
  }
  if (!ok) throw new Error('חיפוש הכתובת נכשל');
  C.put(ck, JSON.stringify(out), 21600);
  Utilities.sleep(1000); // OpenStreetMap מגביל לבקשה אחת בשנייה
  return out;
}

/* ===================== משתמשים ===================== */
function ss_() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')); }
function usersSheet_() { return ss_().getSheetByName('משתמשים'); }
function usersAll_() {
  const c = CacheService.getScriptCache(); const hit = c.get('users');
  if (hit) return JSON.parse(hit);
  const sh = usersSheet_(); const n = sh.getLastRow() - 1;
  const list = n < 1 ? [] : sh.getRange(2, 1, n, 8).getValues().map((r, i) => ({ row: i + 2, token: String(r[0]), uid: String(r[1]), name: String(r[2]), email: String(r[3]), admin: r[4] === '1' || r[4] === true, active: r[5] !== '0' && r[5] !== false, created: String(r[6]), lastSeen: String(r[7]) }));
  c.put('users', JSON.stringify(list), 300);
  return list;
}
function userByToken_(t) { if (!t || t.length < 20) return null; return usersAll_().find(u => u.token === t && u.active) || null; }
function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40); }
function addUser_(u) {
  const sh = usersSheet_();
  const rec = [newToken_(), 'u_' + Utilities.getUuid().slice(0, 8), u.name || '', u.email || '', u.admin ? '1' : '0', '1', new Date().toISOString(), ''];
  sh.getRange(sh.getLastRow() + 1, 1, 1, 8).setNumberFormat('@').setValues([rec]);
  CacheService.getScriptCache().remove('users');
  return { uid: rec[1] };
}
function saveUser_(a, by) {
  if (!String(a.name || '').trim()) throw new Error('חסר שם');
  if (!a.uid) return addUser_(a);
  const u = usersAll_().find(x => x.uid === a.uid); if (!u) throw new Error('not_found');
  if (u.uid === by.uid && (!a.admin || a.active === false)) throw new Error('אי אפשר לבטל את ההרשאה של עצמך');
  usersSheet_().getRange(u.row, 3, 1, 4).setValues([[a.name || '', a.email || '', a.admin ? '1' : '0', a.active === false ? '0' : '1']]);
  CacheService.getScriptCache().remove('users');
  return { uid: a.uid };
}
function deleteUser_(uid) {
  const u = usersAll_().find(x => x.uid === uid); if (!u) throw new Error('not_found');
  usersSheet_().deleteRow(u.row);
  CacheService.getScriptCache().remove('users');
  return { ok: true };
}
function resetToken_(uid) {
  const u = usersAll_().find(x => x.uid === uid); if (!u) throw new Error('not_found');
  usersSheet_().getRange(u.row, 1).setValue(newToken_());
  CacheService.getScriptCache().remove('users');
  return { ok: true };
}
function touchUser_(u) { try { usersSheet_().getRange(u.row, 8).setValue(new Date().toISOString()); } catch (e) { } }
function sendLink_(uid, by) {
  const u = usersAll_().find(x => x.uid === uid); if (!u || !u.email) throw new Error('למשתמש אין כתובת דוא"ל');
  const url = appUrl_() + '?k=' + u.token;
  const html = `<div dir="rtl" style="font-family:Arial;font-size:11pt">שלום ${escH_(u.name)},<br><br>זהו הקישור האישי שלך למערכת ניהול הכשרות של מחלקת הכשרות:<br><br><a href="${url}" style="font-size:13pt;font-weight:bold">כניסה למערכת</a><br><br>הקישור אישי ומזהה אותך במערכת – אין להעבירו לאחרים. מומלץ לשמור אותו במועדפים.<br><br>בברכה,<br>${escH_(by.name)}<br>${MAIL_NAME}</div>`;
  MailApp.sendEmail({ to: u.email, subject: 'קישור אישי למערכת ניהול הכשרות – מחלקת הכשרות', htmlBody: html, name: MAIL_NAME });
  return { ok: true };
}
function escH_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }

/* ===================== גיבוי ===================== */
// כל לילה: עותק של כל קובצי הנתונים בתיקיית "גיבויים", נשמרים 30 האחרונים
function dailyBackup() {
  const root = folder_(); const it = root.getFoldersByName('גיבויים');
  const bk = it.hasNext() ? it.next() : root.createFolder('גיבויים');
  const vals = {}; KEYS_.forEach(k => { const s = readFile_(k); vals[k] = s ? JSON.parse(s) : null; });
  const name = 'גיבוי ניהול כשרות ' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd HH-mm') + '.json';
  bk.createFile(name, JSON.stringify(Object.assign({ kind: 'kashrut-local-backup', at: new Date().toISOString() }, vals)), 'application/json');
  const files = []; const fi = bk.getFiles(); while (fi.hasNext()) files.push(fi.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated()).slice(BACKUP_KEEP_).forEach(f => f.setTrashed(true));
}
