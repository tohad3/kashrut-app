'use strict';

// בונה קובץ HTML אחד שעובד בלי שרת: לחיצה כפולה פותחת אותו בדפדפן.
// הכול מוטמע בקובץ: עיצוב, ספריות (מפה, גרפים, קריאת Excel), הקוד, ונתוני "לוח משגיחים" / מיקומים / היסטוריה.
// שימוש: node standalone/build.js [--data <תיקייה>]... [--out <קובץ>]
// תיקיות הנתונים נבדקות לפי הסדר; לכל קובץ נלקח העותק הראשון שנמצא.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const dataDirs = [], opt = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--data') dataDirs.push(path.resolve(args[++i]));
  else if (args[i] === '--out') opt.out = path.resolve(args[++i]);
}
if (!dataDirs.length) dataDirs.push(path.join(ROOT, 'data-shared'), path.join(ROOT, 'data'));
const OUT = opt.out || path.join(ROOT, 'dist', 'ניהול כשרות - ללא שרת.html');

const read = (p) => fs.readFileSync(p, 'utf8');
const dataUri = (p, type) => `data:${type};base64,${fs.readFileSync(p).toString('base64')}`;
// תוכן שמוטמע בתוך תגית script לא יכול להכיל "</script"
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
const script = (code) => `<script>${safe(code)}</script>`;

function dataFile(name) {
  for (const d of dataDirs) {
    const p = path.join(d, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const found = [];
function json(name, fallback) {
  const p = dataFile(name);
  if (!p) return fallback;
  found.push(path.relative(ROOT, p));
  return JSON.parse(read(p));
}
const keyFile = dataFile('maptiler-key.txt');
const SEED = {
  bizExtra: json('biz-extra.json', { businesses: [] }),
  bizEdits: json('biz-edits.json', {}),
  bizLinks: json('biz-links.json', {}),
  staffExtra: json('staff-extra.json', { people: [] }),
  staffNotes: json('staff-notes.json', {}),
  db: json('db.json', null), // מסד הנתונים של ניהול משגיחים (עסקים ומשגיחים)
  coords: json('coords-3.json', {}),
  boardCoords: json('board-coords.json', {}), // מיקומי העסקים של מסד הנתונים, לפי מזהה העסק בלוח
  trails: json('trails-3.json', {}),
  maptilerKey: keyFile ? read(keyFile).trim() : '',
  builtAt: new Date().toISOString(),
};

const icon = dataUri(path.join(PUB, 'icon.svg'), 'image/svg+xml');
const LEAF = path.join(PUB, 'vendor', 'leaflet');
const leafletCss = read(path.join(LEAF, 'leaflet.css'))
  .replace(/url\(images\/([\w-]+\.png)\)/g, (_, f) => `url(${dataUri(path.join(LEAF, 'images', f), 'image/png')})`);
const leafletIcons = `L.Icon.Default.mergeOptions({
  iconUrl: ${JSON.stringify(dataUri(path.join(LEAF, 'images', 'marker-icon.png'), 'image/png'))},
  iconRetinaUrl: ${JSON.stringify(dataUri(path.join(LEAF, 'images', 'marker-icon-2x.png'), 'image/png'))},
  shadowUrl: ${JSON.stringify(dataUri(path.join(LEAF, 'images', 'marker-shadow.png'), 'image/png'))},
});`;

let html = read(path.join(PUB, 'index.html'));
const swap = (re, to) => {
  if (!re.test(html)) throw new Error('לא נמצא בקובץ index.html: ' + re);
  html = html.replace(re, () => to);
};
swap(/<section id="login"[\s\S]*?<\/section>/, read(path.join(__dirname, 'import.html')));
swap(/\s*<link rel="manifest"[^>]*>/, '');
swap(/<link rel="stylesheet" href="vendor\/leaflet\/leaflet.css">/, `<style>${leafletCss}</style>`);
// במצב ללא שרת אין ניהול משתמשים
swap(/<link rel="stylesheet" href="styles.css">/, `<style>${read(path.join(PUB, 'styles.css'))}\n#tabs [data-view="admin"]{display:none!important}</style>`);
swap(/<script src="vendor\/leaflet\/leaflet.js"><\/script>\s*<script src="vendor\/chart.umd.min.js"><\/script>\s*<script src="app.js"><\/script>/, [
  script('window.SEED = ' + JSON.stringify(SEED) + ';'),
  script(read(path.join(__dirname, 'xlsx.full.min.js'))),
  script(read(path.join(LEAF, 'leaflet.js'))),
  script(leafletIcons),
  script(read(path.join(PUB, 'vendor', 'chart.umd.min.js'))),
  script(read(path.join(PUB, 'local-api.js'))),
  script(read(path.join(PUB, 'app.js'))),
  script(read(path.join(__dirname, 'import-ui.js'))),
  script(read(path.join(__dirname, 'manage-ui.js'))),
].join('\n'));
html = html.replace(/(src|href)="icon.svg"/g, (_, a) => `${a}="${icon}"`);
html = html.replace('<title>ניהול כשרות</title>', '<title>ניהול כשרות (ללא שרת)</title>');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`נבנה: ${OUT} (${(html.length / 1048576).toFixed(1)}MB)`);
console.log(found.length ? 'נתונים: ' + found.join(', ') : 'אזהרה: לא נמצאו קובצי נתונים');
