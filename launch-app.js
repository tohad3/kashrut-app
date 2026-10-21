// launch-app.js — מפעיל אחת מהאפליקציות המקומיות במחשב המועצה (ניהול משגיחים, מעקב אאוטלוק) ישירות עם node,
// בלי cmd/.bat (חסומים במחשב) ובלי PowerShell מוסתר (נחסם על ידי האנטי-וירוס). קיצורי הדרך מפעילים אותו;
// auto-publish.ps1 מכוון אותם לכאן.
// הפעלה: node launch-app.js --dir "<תיקיית האפליקציה>" --port <פורט>
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = arg('--dir');
const port = Number(arg('--port'));
if (!dir || !port) { console.error('usage: node launch-app.js --dir <app folder> --port <port>'); process.exit(1); }
const URL = 'http://localhost:' + port;

const up = () => new Promise((resolve) => {
  const req = http.get(URL, { timeout: 1500 }, (res) => { res.resume(); resolve(true); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});
const openBrowser = () => {
  if (process.platform === 'win32') spawn('explorer.exe', [URL], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
};

(async () => {
  // לחיצה שנייה כשהאפליקציה כבר רצה רק פותחת את הדפדפן
  if (await up()) { openBrowser(); return; }
  // השרת רץ בחלון הממוזער הזה; סגירת החלון עוצרת אותו
  const child = spawn(process.execPath, ['server.js'], { cwd: dir, stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code || 0));
  for (let i = 0; i < 90; i++) {
    if (await up()) { openBrowser(); return; }
    await new Promise((r) => setTimeout(r, 1000));
  }
})();
