// publish-code.js — בונה את "ניהול כשרות - ללא שרת.html" אל התיקייה המשותפת ב-OneDrive. להריץ: node publish-code.js
// הפרסום לתיקייה המשותפת ב-OneDrive הופסק לבקשת אוהד (2026-10-25). כדי להחזיר – למחוק את שתי השורות הבאות.
console.log('· הפרסום לתיקייה המשותפת הופסק – לא נכתב דבר ל-OneDrive');
process.exit(0);
const fs = require('fs');
const path = require('path');
const HERE = __dirname;

function resolveSharedDir() {
  if (process.env.KASHRUT_SHARED_DIR) { try { if (fs.existsSync(process.env.KASHRUT_SHARED_DIR)) return process.env.KASHRUT_SHARED_DIR; } catch {} }
  const home = process.env.USERPROFILE || process.env.HOME || require('os').homedir();
  const TARGET = 'אפליקציית כשרות - נתונים';
  try {
    for (const d of fs.readdirSync(home)) {
      if (!/^OneDrive/i.test(d)) continue;
      const base = path.join(home, d);
      try { const exact = path.join(base, TARGET); if (fs.existsSync(exact)) return exact; } catch {}
      try { for (const sub of fs.readdirSync(base)) { if (sub === TARGET || sub.endsWith(TARGET)) { const c = path.join(base, sub); try { if (fs.statSync(c).isDirectory()) return c; } catch {} } } } catch {}
    }
  } catch {}
  return null;
}

function copyFile(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst + '.tmp'); fs.renameSync(dst + '.tmp', dst); }

const shared = resolveSharedDir();
if (!shared) { console.error('✗ לא נמצאה התיקייה המשותפת ב-OneDrive'); process.exit(1); }
// העדכון האוטומטי של גרסת השרת (_app, version.txt וסקריפטי ההתקנה) הוסר: מפרסמים רק את הקובץ ללא שרת.
// סקריפטי ההתקנה הישנים נמחקים מהתיקייה המשותפת.
for (const old of ['התקנת ניהול כשרות.ps1', 'התקנת-עדכון-אוטומטי.ps1', 'התקנת ניהול כשרות.exe']) {
  try { const f = path.join(shared, old); if (fs.existsSync(f)) { fs.unlinkSync(f); console.log('✓ נמחק מהתיקייה המשותפת: ' + old); } } catch (e) { console.warn('⚠ לא הצלחתי למחוק ' + old + ': ' + e.message); }
}
// התקנת מעקב אאוטלוק (נבנית במאגר outlook-tracker). מגיעה דרך הסנכרון של OneDrive, כי ברשת המועצה הורדת exe נחסמת
try {
  const src = path.join(HERE, 'installer', 'outlook-tracker-setup.exe'), out = path.join(shared, 'התקנת מעקב אאוטלוק.exe');
  if (fs.existsSync(src) && (!fs.existsSync(out) || fs.statSync(out).size !== fs.statSync(src).size)) {
    copyFile(src, out);
    console.log('✓ התקנת מעקב אאוטלוק הועתקה לתיקייה המשותפת');
  }
  console.log('· בתיקייה המשותפת: התקנת מעקב אאוטלוק ' + (fs.existsSync(out) ? Math.round(fs.statSync(out).size / 1e6) + 'MB' : 'חסרה'));
} catch (e) { console.warn('⚠ פרסום התקנת מעקב אאוטלוק נכשל: ' + e.message); }
// גרסה ללא שרת: קובץ HTML אחד בראש התיקייה המשותפת, נפתח בלחיצה כפולה ונטען מקובצי ייצוא של שירת הים
try {
  const out = path.join(shared, 'ניהול כשרות - ללא שרת.html');
  const mashgichim = path.join(path.dirname(shared), 'ניהול משגיחים - נתונים'); // מסד הנתונים של ניהול משגיחים
  require('child_process').execFileSync(process.execPath, [path.join(HERE, 'standalone', 'build.js'), '--data', shared, '--data', path.join(HERE, 'data'), '--data', mashgichim, '--out', out], { stdio: 'inherit' });
} catch (e) { console.warn('⚠ בניית הגרסה ללא שרת נכשלה: ' + e.message); }
console.log('✓ הקוד פורסם לתיקייה המשותפת: ' + shared);

// גיבוי ל-GitHub: שומר גרסה ודוחף. כישלון כאן לא עוצר את הפרסום לתיקייה המשותפת.
function gitBackup() {
  const { execFileSync } = require('child_process');
  const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MinGit', 'cmd', 'git.exe');
  const git = fs.existsSync(local) ? local : 'git';
  const run = (...args) => execFileSync(git, args, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try { run('rev-parse', '--git-dir'); } catch { console.log('· אין גיבוי git בתיקייה הזו, מדלג'); return; }
  try {
    run('add', '-A');
    if (run('status', '--porcelain')) run('commit', '-q', '-m', 'פרסום ' + new Date().toLocaleString('he-IL'));
    if (!run('remote')) { console.log('✓ נשמרה גרסה בגיבוי המקומי (עדיין לא מחובר ל-GitHub)'); return; }
    run('push', '-q', 'origin', 'HEAD');
    console.log('✓ הגיבוי ב-GitHub עודכן');
  } catch (e) { console.error('⚠ הגיבוי ל-GitHub נכשל (הפרסום עצמו הצליח): ' + String(e.stderr || e.message).trim()); }
}
gitBackup();
