'use strict';

// בונה את גרסת Google Apps Script של ניהול הכשרות לתיקייה google/dist (שנדחפת עם clasp).
// הקוד זהה לגרסה ללא שרת, אבל הנתונים נשמרים בחשבון Google של המחלקה (gshim.js) והכניסה בקישור אישי (Code.gs).
// שימוש: node google/build.js [--data <תיקייה>]... [--seed-html <קובץ ללא שרת קיים>]
//   --data: תיקיות עם db.json / board-coords.json וכו' (כמו standalone/build.js)
//   --seed-html: לקחת את מאגר העסקים מתוך קובץ "ניהול כשרות - ללא שרת.html" שכבר נבנה
// מאגר העסקים נכתב ל-dist/Seed.gs בלבד (התיקייה לא עולה ל-GitHub), ו-setup() מעביר אותו לקובץ ב-Drive.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const SA = path.join(ROOT, 'standalone');
const OUT = path.join(__dirname, 'dist');
const args = process.argv.slice(2);
const dataDirs = []; let seedHtml = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--data') dataDirs.push(path.resolve(args[++i]));
  else if (args[i] === '--seed-html') seedHtml = path.resolve(args[++i]);
}
dataDirs.push(SA); // board-coords.json

const read = (p) => fs.readFileSync(p, 'utf8');
const dataUri = (p, type) => `data:${type};base64,${fs.readFileSync(p).toString('base64')}`;

/* ---------- מאגר העסקים (Seed.gs) ---------- */
let SEED = null;
if (seedHtml) {
  const h = read(seedHtml), a = h.indexOf('window.SEED = ');
  if (a < 0) throw new Error('לא נמצא window.SEED בקובץ ' + seedHtml);
  SEED = JSON.parse(h.slice(a + 'window.SEED = '.length, h.indexOf(';</script>', a)));
} else if (dataDirs.length > 1) {
  const json = (name, fb) => { for (const d of dataDirs) { const p = path.join(d, name); if (fs.existsSync(p)) return JSON.parse(read(p)); } return fb; };
  const key = dataDirs.map((d) => path.join(d, 'maptiler-key.txt')).find((p) => fs.existsSync(p));
  SEED = {
    bizExtra: json('biz-extra.json', { businesses: [] }), bizEdits: json('biz-edits.json', {}), bizLinks: json('biz-links.json', {}),
    staffExtra: json('staff-extra.json', { people: [] }), staffNotes: json('staff-notes.json', {}), db: json('db.json', null),
    coords: json('coords-3.json', {}), boardCoords: json('board-coords.json', {}), trails: json('trails-3.json', {}),
    maptilerKey: key ? read(key).trim() : '',
  };
}
if (SEED) {
  SEED.builtAt = new Date().toISOString();
  const n = ((SEED.db && SEED.db.businesses) || []).length;
  if (!n) console.warn('אזהרה: אין עסקים במאגר (חסר db.json)');
  console.log('מאגר העסקים:', n, 'עסקים');
}

/* ---------- Index.html ---------- */
let html = read(path.join(PUB, 'index.html'));
const swap = (from, to) => {
  const hit = from instanceof RegExp ? from.test(html) : html.includes(from);
  if (!hit) throw new Error('לא נמצא: ' + String(from).slice(0, 90));
  html = html.replace(from, () => to);
};
let importHtml = read(path.join(SA, 'import.html'));
const swapI = (a, b) => { if (!importHtml.includes(a)) throw new Error('לא נמצא במסך הטעינה: ' + a.slice(0, 80)); importHtml = importHtml.replace(a, b); };
swapI(/<p class="muted">גרסה ללא שרת\.[^<]*<\/p>/.exec(importHtml)[0],
  '<p class="muted">בתי העסק והמשגיחים כבר כלולים (ממסד הנתונים של ניהול משגיחים). כדי לראות דיווחים ונוכחות, בוחרים קובץ ייצוא של דיווחי משגיחים מ"שירת הים" (CSV או Excel). אפשר לטעון גם ייצוא של רשימת בתי העסק. מה שנטען כאן משותף לכל המשתמשים.</p>');
swapI('<summary>גיבוי והעברה למחשב אחר</summary>', '<summary>גיבוי והעברת נתונים</summary>');
swapI('<p>הנתונים והעריכות נשמרים בדפדפן של המחשב הזה בלבד. אפשר לשמור אותם לקובץ ולטעון אותו במחשב אחר.</p>',
  '<p>הנתונים נשמרים בחשבון Google של המחלקה, ונשמר מהם גיבוי בכל לילה. כדי להעביר לכאן נתונים מהגרסה הקודמת (הקובץ ללא שרת): שם לוחצים "שמירת גיבוי לקובץ", וכאן "טעינת גיבוי".</p>');
swapI('<p class="fine">הקבצים נקראים בדפדפן בלבד ולא נשלחים לשום מקום.</p>', '<p class="fine">הנתונים נשמרים בחשבון Google של מחלקת הכשרות בלבד.</p>');
swap(/<section id="login"[\s\S]*?<\/section>/, importHtml);
swap(/\s*<link rel="manifest"[^>]*>/, '');
const LEAF = path.join(PUB, 'vendor', 'leaflet');
const leafletCss = read(path.join(LEAF, 'leaflet.css'))
  .replace(/url\(images\/([\w-]+\.png)\)/g, (_, f) => `url(${dataUri(path.join(LEAF, 'images', f), 'image/png')})`);
swap('<link rel="stylesheet" href="vendor/leaflet/leaflet.css">', `<style>${leafletCss}</style>`);
swap('<link rel="stylesheet" href="styles.css">', `<style>${read(path.join(PUB, 'styles.css'))}\n#tabs [data-view="admin"]{display:none!important}</style>`);

let app = read(path.join(PUB, 'app.js'));
const swapA = (a, b) => { if (!app.includes(a)) throw new Error('לא נמצא ב-app.js: ' + a.slice(0, 80)); app = app.split(a).join(b); };
// "טעינת קובץ" פותח את מסך הטעינה בלי לטעון את הדף מחדש
swapA("  await api('/logout', { method: 'POST' }).catch(() => {});\n  location.reload();", "  showLogin();");
let importUi = read(path.join(SA, 'import-ui.js'));
const swapU = (a, b) => { if (!importUi.includes(a)) throw new Error('לא נמצא ב-import-ui.js: ' + a.slice(0, 80)); importUi = importUi.split(a).join(b); };
swapU('setTimeout(() => location.reload(), 900);', 'setTimeout(() => GS.reload(), 900);');
swapU("status('הגיבוי נטען'); refreshContinue();", "status('הגיבוי נטען'); setTimeout(() => GS.reload(), 900);");
swapU("    status('הנתונים נמחקו');\n    refreshContinue();", "    status('הנתונים נמחקו');\n    setTimeout(() => GS.reload(), 900);");
swapU("if (!confirm('למחוק את הדיווחים ואת רשימת בתי העסק שנטענו? עריכות ומיקומים נשארים.')) return;",
  "if (!confirm('למחוק את הדיווחים ואת רשימת בתי העסק שנטענו, אצל כל המשתמשים? עריכות ומיקומים נשארים.')) return;");

let localApi = read(path.join(PUB, 'local-api.js'));
for (const [x, y] of [["moduleName: 'כשרות · ללא שרת'", "moduleName: 'כשרות'"], ["return `ללא שרת · ${parts.join(', ')}", "return `${parts.join(', ')}"], ["name: 'משתמש מקומי'", "name: (window.BOOT && BOOT.name) || 'משתמש'"]]) {
  if (!localApi.includes(x)) throw new Error('לא נמצא ב-local-api.js: ' + x);
  localApi = localApi.replace(x, y);
}

const leafletIcons = `L.Icon.Default.mergeOptions({
  iconUrl: ${JSON.stringify(dataUri(path.join(LEAF, 'images', 'marker-icon.png'), 'image/png'))},
  iconRetinaUrl: ${JSON.stringify(dataUri(path.join(LEAF, 'images', 'marker-icon-2x.png'), 'image/png'))},
  shadowUrl: ${JSON.stringify(dataUri(path.join(LEAF, 'images', 'marker-shadow.png'), 'image/png'))},
});`;

// HtmlService של Google מסיר הערות מהקוד ופוגע בו – לכן כל קוד JS נארז ב-base64url ונטען בזמן ריצה (כמו במערכת קליטת העסקים)
const LOADER = '<script>window.__run=function(b){b=b.replace(/-/g,"+").replace(/_/g,"\\x2f");var s=atob(b),u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);var e=document.createElement("script");e.textContent=new TextDecoder().decode(u);document.head.appendChild(e)};</script>';
const packed = (code) => `<script>__run("${Buffer.from(code, 'utf8').toString('base64url')}")</script>`;

swap(/<script src="vendor\/leaflet\/leaflet.js"><\/script>\s*<script src="vendor\/chart.umd.min.js"><\/script>\s*<script src="app.js"><\/script>/, [
  LOADER,
  '<script>window.BOOT=<?!= boot ?>;window.SEED=<?!= seed ?>;</script>',
  packed(read(path.join(__dirname, 'gshim.js'))),
  '<?!= lib ?>',
  packed(localApi),
  packed(app),
  packed(importUi),
  packed(read(path.join(SA, 'manage-ui.js'))),
  packed(read(path.join(__dirname, 'admin-ui.js'))),
].join('\n'));
const icon = dataUri(path.join(PUB, 'icon.svg'), 'image/svg+xml');
html = html.replace(/(src|href)="icon.svg"/g, (_, a) => `${a}="${icon}"`);
html = html.replace('<title>ניהול כשרות</title>', '<title>ניהול כשרות – מחלקת הכשרות</title>');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8"><base target="_blank">');

// בדיקות: בלי סקריפטים חיצוניים, ובלי "<?" מלבד תגיות התבנית
const tags = html.match(/<\?[\s\S]*?\?>/g) || [];
if (tags.join('|') !== '<?!= boot ?>|<?!= seed ?>|<?!= lib ?>') throw new Error('תגיות תבנית לא צפויות: ' + tags.join(' '));
if (/<script\s+src=/i.test(html)) throw new Error('נשאר סקריפט חיצוני');

const lib = [
  packed(read(path.join(SA, 'xlsx.full.min.js'))),
  packed(read(path.join(LEAF, 'leaflet.js'))),
  packed(leafletIcons),
  packed(read(path.join(PUB, 'vendor', 'chart.umd.min.js'))),
].join('\n');

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'Index.html'), html);
fs.writeFileSync(path.join(OUT, 'Lib.html'), lib + '\n');
fs.copyFileSync(path.join(__dirname, 'Code.gs'), path.join(OUT, 'Code.gs'));
fs.copyFileSync(path.join(__dirname, 'appsscript.json'), path.join(OUT, 'appsscript.json'));
if (SEED) fs.writeFileSync(path.join(OUT, 'Seed.gs'), '// מאגר העסקים והמשגיחים – נוצר בבנייה. setup() מעביר אותו ל-Drive\nconst SEED = ' + JSON.stringify(SEED) + ';\n');
else if (!fs.existsSync(path.join(OUT, 'Seed.gs'))) console.warn('אזהרה: לא נוצר Seed.gs (אין --data או --seed-html)');
const kb = (f) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + 'KB';
console.log('נבנה:', ['Index.html', 'Lib.html', 'Code.gs', 'appsscript.json', 'Seed.gs'].filter((f) => fs.existsSync(path.join(OUT, f))).map((f) => f + ' ' + kb(f)).join(', '));
