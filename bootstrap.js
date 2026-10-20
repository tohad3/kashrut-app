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
  // יכולות להיות כמה תיקיות בשם הזה (למשל עותק ישן שהועתק ידנית ליד קיצור הדרך לתיקייה המשותפת).
  // בוחרים את זו שהקוד בה פורסם לאחרונה (_app\version.txt), כי היא התיקייה המשותפת החיה.
  const found = [];
  try {
    for (const d of fs.readdirSync(home)) {
      if (!/^OneDrive/i.test(d)) continue;
      const base = path.join(home, d);
      try {
        for (const sub of fs.readdirSync(base)) {
          if (sub !== TARGET && !sub.endsWith(TARGET)) continue;
          const cand = path.join(base, sub);
          try { if (fs.statSync(cand).isDirectory()) found.push(cand); } catch {}
        }
      } catch {}
    }
  } catch {}
  const stamp = (dir) => { try { return fs.statSync(path.join(dir, '_app', 'version.txt')).mtimeMs; } catch { return 0; } };
  found.sort((a, b) => stamp(b) - stamp(a));
  return found[0] || null;
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

const shared = resolveSharedDir();
const codeDir = shared && path.join(shared, '_app');
const versionOf = () => { try { return fs.readFileSync(path.join(codeDir, 'version.txt'), 'utf8').trim(); } catch { return ''; } };

// מעתיק את הקוד מ-_app. מחזיר true אם הועתק.
function pullCode() {
  try {
    if (!codeDir || !fs.existsSync(path.join(codeDir, 'server.js'))) return false;
    copyFile(path.join(codeDir, 'server.js'), path.join(HERE, 'server.js'));
    if (fs.existsSync(path.join(codeDir, 'public'))) copyDir(path.join(codeDir, 'public'), path.join(HERE, 'public'));
    // גם האייקון ו-bootstrap.js עצמו מתעדכנים (הגרסה החדשה של bootstrap תרוץ מההפעלה הבאה)
    for (const f of ['kashrut.ico', 'bootstrap.js']) if (fs.existsSync(path.join(codeDir, f))) copyFile(path.join(codeDir, f), path.join(HERE, f));
    return true;
  } catch (e) {
    console.warn('עדכון הקוד נכשל, ממשיך עם הקוד המקומי: ' + e.message);
    return false;
  }
}

let version = versionOf();
console.log(pullCode() ? '✓ קוד האפליקציה עודכן מהתיקייה המשותפת' : '(אין עדכון קוד משותף זמין — עובד עם הקוד המקומי)');

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

// יומן הפעלה קצר ליד האפליקציה, כדי שאפשר יהיה לראות למה קיצור הדרך לא נפתח
const LAUNCH_LOG = path.join(HERE, 'launch.log');
function launchLog(msg) {
  try {
    if (fs.existsSync(LAUNCH_LOG) && fs.statSync(LAUNCH_LOG).size > 200000) fs.renameSync(LAUNCH_LOG, LAUNCH_LOG + '.old');
    fs.appendFileSync(LAUNCH_LOG, new Date().toISOString() + '  ' + String(msg).trimEnd() + '\n');
  } catch {}
}
process.on('uncaughtException', (e) => { launchLog('bootstrap error: ' + (e && e.stack || e)); process.exit(1); });

function openBrowser() {
  if (process.platform !== 'win32') return;
  launchLog('opening browser');
  spawn('explorer.exe', [URL], { stdio: 'ignore', detached: true }).on('error', (e) => launchLog('explorer failed: ' + e.message)).unref();
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
launchLog('start ' + process.execPath + ' ' + process.argv.slice(1).join(' ') + ' | shared: ' + (shared || 'not found') + ' | version: ' + (version || '-'));
// פותח את הדפדפן רק כשהשרת כבר עונה (במחשב איטי או עם OneDrive עמוס זה יכול לקחת יותר מכמה שניות)
async function openWhenReady() {
  for (let i = 0; i < 90; i++) {
    if (await alreadyRunning()) { openBrowser(); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  launchLog('server did not answer on ' + URL + ' within 90s');
}
alreadyRunning().then((running) => {
  if (running) { launchLog('already running'); if (OPEN) openBrowser(); return; }
  // הפעלת השרת (הקוד שזה עתה עודכן). הפלט מוצג בחלון וגם נשמר ביומן, כדי שתקלה בהפעלה לא תיעלם עם החלון.
  let child, restarting = false;
  const start = () => {
    child = spawn(process.execPath, [path.join(HERE, 'server.js')], { stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', (b) => process.stdout.write(b));
    child.stderr.on('data', (b) => { process.stderr.write(b); launchLog('server: ' + b); });
    child.on('error', (e) => launchLog('server failed to start: ' + e.message));
    child.on('exit', (code) => {
      if (restarting) { restarting = false; start(); return; }
      launchLog('server exited with code ' + code);
      process.exit(code || 0);
    });
  };
  start();
  if (OPEN) openWhenReady();

  // עדכון בלי לסגור את האפליקציה: כשמתפרסמת גרסה חדשה ל-_app, מעתיקים ומפעילים את השרת מחדש.
  // אחרי זה מספיק לרענן את הדף בדפדפן.
  let pending = '';
  setInterval(() => {
    const v = versionOf();
    if (!v || v === version) { pending = ''; return; }
    // OneDrive מסנכרן קבצים בסדר לא ידוע, לכן ממתינים בדיקה אחת נוספת לפני ההעתקה
    if (pending !== v) { pending = v; return; }
    version = v; pending = '';
    if (!pullCode()) return;
    console.log('✓ גרסה חדשה הגיעה (' + v + '), מפעיל מחדש את השרת. רענן את הדף בדפדפן.');
    restarting = true;
    child.kill();
  }, Number(process.env.KASHRUT_UPDATE_MS) || 2 * 60 * 1000);
});
