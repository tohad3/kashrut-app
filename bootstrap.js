// bootstrap.js — מושך את קוד האפליקציה העדכני מהתיקייה המשותפת ב-OneDrive ואז מפעיל את השרת.
// כך שינויי קוד שמתפרסמים ל-"<תיקייה משותפת>\_app" מגיעים אוטומטית לכל המחשבים בהפעלה הבאה.
// מעביר רק קבצי קוד (server.js + public), לא קובצי הרצה — אין סיכון אבטחת קצה.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const HERE = __dirname;

// זהה לזיהוי שב-server.js: מאתר את התיקייה המשותפת גם עם קידומת "הקבצים של <בעלים> - "
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

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = dst + '.tmp';
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dst);
}
function copyDir(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

try {
  const shared = resolveSharedDir();
  const codeDir = shared && path.join(shared, '_app');
  if (codeDir && fs.existsSync(codeDir) && fs.existsSync(path.join(codeDir, 'server.js'))) {
    copyFile(path.join(codeDir, 'server.js'), path.join(HERE, 'server.js'));
    if (fs.existsSync(path.join(codeDir, 'public'))) copyDir(path.join(codeDir, 'public'), path.join(HERE, 'public'));
    console.log('✓ קוד האפליקציה עודכן מהתיקייה המשותפת');
  } else {
    console.log('(אין עדכון קוד משותף זמין — עובד עם הקוד המקומי)');
  }
} catch (e) {
  console.warn('עדכון הקוד נכשל, ממשיך עם הקוד המקומי: ' + e.message);
}

// הפעלת השרת (הקוד שזה עתה עודכן)
spawn(process.execPath, [path.join(HERE, 'server.js')], { stdio: 'inherit' })
  .on('exit', (code) => process.exit(code || 0));
