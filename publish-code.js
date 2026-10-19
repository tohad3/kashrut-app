// publish-code.js — מפרסם את קוד האפליקציה המקומי אל "<תיקייה משותפת>\_app" ב-OneDrive,
// כדי שיתעדכן אוטומטית אצל כל המשתמשים בהפעלה הבאה. להריץ: node publish-code.js
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
function copyDir(src, dst) { for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) copyDir(s, d); else copyFile(s, d); } }

const shared = resolveSharedDir();
if (!shared) { console.error('✗ לא נמצאה התיקייה המשותפת ב-OneDrive'); process.exit(1); }
const dst = path.join(shared, '_app');
copyFile(path.join(HERE, 'server.js'), path.join(dst, 'server.js'));
copyFile(path.join(HERE, 'bootstrap.js'), path.join(dst, 'bootstrap.js'));
if (fs.existsSync(path.join(HERE, 'kashrut.ico'))) copyFile(path.join(HERE, 'kashrut.ico'), path.join(dst, 'kashrut.ico'));
copyDir(path.join(HERE, 'public'), path.join(dst, 'public'));
// קובץ ההתקנה לעמיתים חדשים, בראש התיקייה המשותפת (רק כשהוא השתנה)
const setup = path.join(HERE, 'installer', 'release', 'kashrut-setup.exe');
const setupDst = path.join(shared, 'התקנת ניהול כשרות.exe');
try {
  if (fs.existsSync(setup) && (!fs.existsSync(setupDst) || fs.statSync(setupDst).size !== fs.statSync(setup).size || fs.statSync(setupDst).mtimeMs < fs.statSync(setup).mtimeMs)) {
    copyFile(setup, setupDst);
    console.log('✓ קובץ ההתקנה עודכן בתיקייה המשותפת');
  }
} catch (e) { console.warn('⚠ העתקת קובץ ההתקנה נכשלה: ' + e.message); }
fs.writeFileSync(path.join(dst, 'version.txt'), new Date().toISOString() + '\n');
console.log('✓ הקוד פורסם לתיקייה המשותפת: ' + dst);

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
