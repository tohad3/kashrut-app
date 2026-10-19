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
    // גם האייקון ו-bootstrap.js עצמו מתעדכנים (הגרסה החדשה תרוץ מההפעלה הבאה)
    for (const f of ['kashrut.ico', 'bootstrap.js']) if (fs.existsSync(path.join(codeDir, f))) copyFile(path.join(codeDir, f), path.join(HERE, f));
    console.log('✓ קוד האפליקציה עודכן מהתיקייה המשותפת');
  } else {
    console.log('(אין עדכון קוד משותף זמין — עובד עם הקוד המקומי)');
  }
} catch (e) {
  console.warn('עדכון הקוד נכשל, ממשיך עם הקוד המקומי: ' + e.message);
}

// קיצור הדרך בשולחן העבודה נבנה מחדש בכל הפעלה, כך ששינוי שם או אייקון כאן מגיע לכל המחשבים.
// מפעיל את node ישירות (בלי cmd/.bat, שחסומים בחלק ממחשבי המועצה).
const SHORTCUT_NAME = 'ניהול כשרות';
const OLD_SHORTCUT_NAMES = []; // שמות קודמים למחיקה, אם משנים את SHORTCUT_NAME
const URL = 'http://localhost:3000';

function refreshShortcut() {
  if (process.platform !== 'win32') return;
  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const ico = path.join(HERE, 'kashrut.ico');
  const ps = [
    '$d = [Environment]::GetFolderPath("Desktop")',
    ...OLD_SHORTCUT_NAMES.map((n) => `Remove-Item -LiteralPath (Join-Path $d ${q(n + '.lnk')}) -ErrorAction SilentlyContinue`),
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d ' + q(SHORTCUT_NAME + '.lnk') + '))',
    '$s.TargetPath = ' + q(process.execPath),
    '$s.Arguments = ' + q('"' + path.join(HERE, 'bootstrap.js') + '" --open'),
    '$s.WorkingDirectory = ' + q(HERE),
    '$s.WindowStyle = 7',
    fs.existsSync(ico) ? '$s.IconLocation = ' + q(ico + ',0') : '',
    '$s.Save()',
  ].filter(Boolean).join('; ');
  try {
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { stdio: 'ignore', windowsHide: true }).on('error', () => {});
  } catch {}
}

function openBrowser() {
  if (process.platform === 'win32') spawn('explorer.exe', [URL], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

// עונה אם האפליקציה כבר רצה (למשל לחיצה שנייה על קיצור הדרך)
function alreadyRunning() {
  return new Promise((resolve) => {
    const req = require('http').get(URL, { timeout: 1500 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

refreshShortcut();
const OPEN = process.argv.includes('--open');
alreadyRunning().then((running) => {
  if (running) { if (OPEN) openBrowser(); return; }
  // הפעלת השרת (הקוד שזה עתה עודכן)
  spawn(process.execPath, [path.join(HERE, 'server.js')], { stdio: 'inherit' })
    .on('exit', (code) => process.exit(code || 0));
  if (OPEN) setTimeout(openBrowser, 2000);
});
