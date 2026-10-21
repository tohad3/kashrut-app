'use strict';

// מסך טעינת הקבצים במצב ללא שרת. משתמש ב-start ו-showLogin מ-app.js
(() => {
  const status = (msg, bad) => {
    const el = $(bad ? '#loginError' : '#importStatus');
    $('#importStatus').classList.add('hidden'); $('#loginError').classList.add('hidden');
    el.textContent = msg; el.classList.remove('hidden');
  };
  const refreshContinue = async () => $('#importContinue').classList.toggle('hidden', !(await localData.hasData()));
  const enter = async () => { const r = await localApi('/me'); location.hash = ''; start(r.user); };

  $('#logoutBtn').textContent = 'טעינת קובץ';
  $('#logoutBtn').title = 'טעינת קובץ ייצוא חדש';
  $('#refreshBtn').title = 'הצגה מחדש של הנתונים';
  refreshContinue();

  $('#importForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = [...$('#importFiles').files];
    if (!files.length) return status('יש לבחור קובץ', true);
    const btn = $('button[type=submit]', e.target);
    btn.disabled = true; status('קורא את הקבצים…');
    try {
      const summary = await localData.importFiles(files);
      status('נטען: ' + summary.join(' · '));
      // אחרי טעינה מציגים את הנתונים מחדש (המטמון של app.js מתאפס בטעינת הדף)
      setTimeout(() => location.reload(), 900);
    } catch (err) { status(err.message, true); }
    finally { btn.disabled = false; }
  });

  $('#importContinue').addEventListener('click', () => enter().catch((e) => status(e.message, true)));

  $('#backupSave').addEventListener('click', async () => {
    const blob = new Blob([await localData.exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `גיבוי ניהול כשרות ${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  $('#backupLoad').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { await localData.importBackup(await f.text()); status('הגיבוי נטען'); refreshContinue(); }
    catch (err) { status(err.message, true); }
  });
  $('#importClear').addEventListener('click', async () => {
    if (!confirm('למחוק את הדיווחים ואת רשימת בתי העסק שנטענו? עריכות ומיקומים נשארים.')) return;
    await localData.clearReports();
    status('הנתונים נמחקו');
    refreshContinue();
  });
})();
